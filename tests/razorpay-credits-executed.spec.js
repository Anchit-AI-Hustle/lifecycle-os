// Buying credits with Razorpay (India, INR), EXECUTED.
//
// The shipped router (api/_shared/credits-core.js -> razorpay-credits.js) runs
// unmodified against the in-memory Supabase in tests/lib/fake-supabase.js and a
// model of the four Razorpay endpoints it calls (POST /v1/orders, GET
// /v1/payments/{id}, POST /v1/payments/{id}/capture), which checks the Basic
// auth it is sent the way Razorpay does. Any other URL throws. Every assertion
// is on money that moved or did not: a wallet row, a ledger row, an order row,
// the body Razorpay was sent, the Location the browser is sent to.
//
// Run: npx playwright test tests/razorpay-credits-executed.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { FakeSupabase, installCreditsRpc, makeReq, makeRes, envScope, response, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const credits = require(path.join(ROOT, 'api', '_shared', 'credits-core.js'));
const catalog = require(path.join(ROOT, 'api', '_shared', 'credit-catalog.js'));

const KEY_ID = 'rzp_test_FixtureKey01';
const KEY_SECRET = 'fixture-key-secret-never-leaves-the-server';
const HOOK_SECRET = 'fixture-webhook-secret-also-server-only';
const STARTER_PAISE = 49900;

const ENV = envScope([
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'CREDIT_WELCOME_GRANT', 'CREDIT_PACK_PRICES',
  'CREDITS_ALLOW_SELF_SERVE', 'CREDITS_COMP_ACCOUNTS', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
]);
let REAL_FETCH;

test.beforeAll(() => {
  ENV.save();
  REAL_FETCH = global.fetch;
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = HOOK_SECRET;
  // Starter and Growth in rupees; Scale in dollars, which Razorpay here does not take.
  process.env.CREDIT_PACK_PRICES = JSON.stringify({
    starter: { currency: 'INR', amount_minor: STARTER_PAISE },
    growth: { currency: 'INR', amount_minor: 199900 },
    scale: { currency: 'USD', amount_minor: 9900 },
  });
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'CREDIT_WELCOME_GRANT', 'CREDITS_ALLOW_SELF_SERVE', 'CREDITS_COMP_ACCOUNTS']) delete process.env[k];
});
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; });

/* ── the world: a project, two buyers, and Razorpay ───────────────────────── */

const alnum = (n) => crypto.randomBytes(n).toString('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(n, 'x').slice(0, n);

function world() {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test')
    .addUser('tok-b', 'user-b', 'b@example.test')
    .addWorkspace('ws-a', 'user-a').addWorkspace('ws-b', 'user-b')
    .setActive('user-a', 'ws-a').setActive('user-b', 'ws-b')
    .syncIdentityTables();
  installCreditsRpc(db);

  const rzp = { orders: new Map(), payments: new Map(), calls: [], keyOk: true };
  db.route((url) => url.startsWith('https://api.razorpay.com/'), async (url, init) => {
    const method = String(init.method || 'GET').toUpperCase();
    const p = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    rzp.calls.push({ method, path: p, body, auth: init.headers && init.headers.Authorization });
    const expected = 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
    if (!rzp.keyOk || (init.headers && init.headers.Authorization) !== expected) {
      return response(401, { error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } });
    }
    if (method === 'POST' && p === '/v1/orders') {
      const o = { id: 'order_' + alnum(14), entity: 'order', amount: body.amount, currency: body.currency, receipt: body.receipt, notes: body.notes, status: 'created' };
      rzp.orders.set(o.id, o);
      return response(200, o);
    }
    let m = /^\/v1\/payments\/(pay_[A-Za-z0-9]+)$/.exec(p);
    if (method === 'GET' && m) {
      const pay = rzp.payments.get(m[1]);
      return pay ? response(200, pay) : response(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } });
    }
    m = /^\/v1\/payments\/(pay_[A-Za-z0-9]+)\/capture$/.exec(p);
    if (method === 'POST' && m) {
      const pay = rzp.payments.get(m[1]);
      if (!pay || pay.status !== 'authorized' || body.amount !== pay.amount) return response(400, { error: { code: 'BAD_REQUEST_ERROR' } });
      pay.status = 'captured';
      return response(200, pay);
    }
    return response(404, { error: { code: 'NOT_FOUND' } });
  });
  db.install();
  return { db, rzp };
}

/** The buyer pays at Razorpay: a payment exists for the order, and the checkout signs it. */
function pay(rzp, orderId, { amount, status = 'captured', currency = 'INR' } = {}) {
  const o = rzp.orders.get(orderId);
  const id = 'pay_' + alnum(14);
  rzp.payments.set(id, { id, entity: 'payment', order_id: orderId, amount: amount == null ? o.amount : amount, currency, status });
  return {
    razorpay_order_id: orderId,
    razorpay_payment_id: id,
    razorpay_signature: crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${id}`).digest('hex'),
  };
}

async function call(op, { token, body, query, headers, rawBody, method } = {}) {
  const req = makeReq({ token, body, method, headers, query: Object.assign({ action: 'credits', op }, query || {}) });
  if (rawBody !== undefined) req.rawBody = rawBody;
  const res = makeRes();
  await credits.handle(req, res);
  return res;
}

const walletOf = (db, user = 'user-a', ws = 'ws-a') => db.find('credit_wallets', (w) => w.user_id === user && (w.workspace_id || null) === ws);
const purchases = (db) => db.table('credit_ledger').filter((l) => l.kind === 'purchase' || l.kind === 'topup');

async function startStarter(db, token = 'tok-a', ws = 'ws-a', extra) {
  const r = await call('rzp-order', { token, body: Object.assign({ pack_key: 'starter', workspace_id: ws }, extra || {}) });
  expect(r.code, JSON.stringify(r.payload)).toBe(200);
  return r.payload;
}

const STARTER_CREDITS = (() => { const p = catalog.pack('starter'); return p.credits + (p.bonus || 0); })();

/* ── the order ────────────────────────────────────────────────────────────── */

test('the catalogue amount wins: a client that sends its own amount and currency is ignored', async () => {
  const { db, rzp } = world();
  const c = await startStarter(db, 'tok-a', 'ws-a', { amount: 100, currency: 'USD', credits: 999999 });

  const sent = rzp.calls.find((x) => x.method === 'POST' && x.path === '/v1/orders');
  expect(sent.body.amount).toBe(STARTER_PAISE);
  expect(sent.body.currency).toBe('INR');
  expect(sent.body.receipt.length).toBeLessThanOrEqual(40);
  expect(sent.body.notes).toMatchObject({ pack: 'starter', credits: String(STARTER_CREDITS), wallet: walletOf(db).id });

  expect(c).toMatchObject({ ok: true, keyId: KEY_ID, amount: STARTER_PAISE, currency: 'INR', pack: { key: 'starter', credits: STARTER_CREDITS } });
  expect(c.orderId).toMatch(/^order_/);
  const row = db.find('credit_orders', (o) => o.id === c.credit_order_id);
  expect(row).toMatchObject({ status: 'pending', provider: 'razorpay', provider_ref: c.orderId, amount_minor: STARTER_PAISE, currency: 'INR', credits: STARTER_CREDITS, user_id: 'user-a' });
});

test('a pack priced in another currency is refused before Razorpay is called', async () => {
  const { rzp } = world();
  const r = await call('rzp-order', { token: 'tok-a', body: { pack_key: 'scale' } });
  expect(r.code).toBe(409);
  expect(r.payload.error).toBe('razorpay_currency');
  expect(rzp.calls).toHaveLength(0);
});

test('no session, no order', async () => {
  const { db, rzp } = world();
  const r = await call('rzp-order', { body: { pack_key: 'starter' } });
  expect(r.code).toBe(401);
  expect(rzp.calls).toHaveLength(0);
  expect(db.table('credit_orders')).toHaveLength(0);
});

/* ── verify ───────────────────────────────────────────────────────────────── */

test('a good signature credits the wallet once, and a replay credits nothing more', async () => {
  const { db, rzp } = world();
  const c = await startStarter(db);
  const before = Number(walletOf(db).balance);
  const proof = pay(rzp, c.orderId);

  const first = await call('rzp-verify', { token: 'tok-a', body: proof });
  expect(first.code, JSON.stringify(first.payload)).toBe(200);
  expect(first.payload).toMatchObject({ credited: true, credits: STARTER_CREDITS, balance: before + STARTER_CREDITS });
  expect(Number(walletOf(db).balance)).toBe(before + STARTER_CREDITS);
  const row = db.find('credit_orders', (o) => o.id === c.credit_order_id);
  expect(row).toMatchObject({ status: 'paid', provider: 'razorpay', provider_ref: proof.razorpay_payment_id });

  const again = await call('rzp-verify', { token: 'tok-a', body: proof });
  expect(again.code).toBe(200);
  expect(again.payload).toMatchObject({ credited: false, credits: 0, balance: before + STARTER_CREDITS });
  expect(Number(walletOf(db).balance)).toBe(before + STARTER_CREDITS);
  expect(purchases(db)).toHaveLength(1);
});

test('an authorized payment is captured for the order amount, then credited', async () => {
  const { db, rzp } = world();
  const c = await startStarter(db);
  const proof = pay(rzp, c.orderId, { status: 'authorized' });
  const r = await call('rzp-verify', { token: 'tok-a', body: proof });
  expect(r.code).toBe(200);
  expect(r.payload.credited).toBe(true);
  const cap = rzp.calls.find((x) => x.path.endsWith('/capture'));
  expect(cap.body).toEqual({ amount: STARTER_PAISE, currency: 'INR' });
  expect(rzp.payments.get(proof.razorpay_payment_id).status).toBe('captured');
});

test('missing fields, a bad signature, another order, another buyer and the wrong amount are 400 and credit nothing', async () => {
  const { db, rzp } = world();
  const c = await startStarter(db);
  const balance = () => Number(walletOf(db).balance);
  const start = balance();
  const good = pay(rzp, c.orderId);

  // Missing fields.
  for (const drop of ['razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature']) {
    const body = Object.assign({}, good); delete body[drop];
    const r = await call('rzp-verify', { token: 'tok-a', body });
    expect(r.code, drop).toBe(400);
    expect(r.payload.error).toBe('payment_incomplete');
  }

  // A signature made with any other secret.
  const forged = Object.assign({}, good, { razorpay_signature: crypto.createHmac('sha256', 'not-the-secret').update(`${good.razorpay_order_id}|${good.razorpay_payment_id}`).digest('hex') });
  expect((await call('rzp-verify', { token: 'tok-a', body: forged })).code).toBe(400);

  // A payment Razorpay says belongs to another order, correctly signed for this one.
  const other = await startStarter(db);
  const elsewhere = pay(rzp, other.orderId);
  const swapped = {
    razorpay_order_id: c.orderId, razorpay_payment_id: elsewhere.razorpay_payment_id,
    razorpay_signature: crypto.createHmac('sha256', KEY_SECRET).update(`${c.orderId}|${elsewhere.razorpay_payment_id}`).digest('hex'),
  };
  const r3 = await call('rzp-verify', { token: 'tok-a', body: swapped });
  expect(r3.code).toBe(400);
  expect(r3.payload.error).toBe('payment_other_order');

  // Another buyer presenting a's paid proof.
  const r4 = await call('rzp-verify', { token: 'tok-b', body: good });
  expect(r4.code).toBe(400);
  expect(r4.payload.error).toBe('payment_other_order');

  // A payment for less than the pack.
  const third = await startStarter(db);
  const cheap = pay(rzp, third.orderId, { amount: 100 });
  const r5 = await call('rzp-verify', { token: 'tok-a', body: cheap });
  expect(r5.code).toBe(400);
  expect(r5.payload.error).toBe('payment_amount_mismatch');

  // A payment that never completed.
  const fourth = await startStarter(db);
  const failed = pay(rzp, fourth.orderId, { status: 'failed' });
  expect((await call('rzp-verify', { token: 'tok-a', body: failed })).code).toBe(400);

  expect(balance()).toBe(start);
  expect(purchases(db)).toHaveLength(0);
  expect(db.table('credit_orders').every((o) => o.status === 'pending')).toBe(true);
});

/* ── the redirect callback ────────────────────────────────────────────────── */

test('callback: a paid form answers 303 to /credits#paid and credits once; an error or a bad form answers #unpaid', async () => {
  const { db, rzp } = world();
  const c = await startStarter(db);
  const before = Number(walletOf(db).balance);
  const proof = pay(rzp, c.orderId);

  // No session on this request: the browser is coming back from the bank.
  const r = await call('rzp-callback', { method: 'POST', body: proof });
  expect(r.code).toBe(303);
  expect(r.headers.location).toBe('/credits#paid');
  expect(Number(walletOf(db).balance)).toBe(before + STARTER_CREDITS);

  // The same form posted again (a back button) is still #paid, and adds nothing.
  const again = await call('rzp-callback', { method: 'POST', body: proof });
  expect(again.headers.location).toBe('/credits#paid');
  expect(purchases(db)).toHaveLength(1);

  // Razorpay reports the failure as error[...] fields.
  const c2 = await startStarter(db);
  const failed = await call('rzp-callback', { method: 'POST', body: { 'error[code]': 'BAD_REQUEST_ERROR', 'error[description]': 'Payment failed', 'error[metadata]': JSON.stringify({ order_id: c2.orderId }) } });
  expect(failed.code).toBe(303);
  expect(failed.headers.location).toBe('/credits#unpaid');

  // A forged form.
  const forged = Object.assign({}, pay(rzp, c2.orderId), { razorpay_signature: '0'.repeat(64) });
  const bad = await call('rzp-callback', { method: 'POST', body: forged });
  expect(bad.headers.location).toBe('/credits#unpaid');

  // A form body that arrives as a raw urlencoded stream (no parser in front).
  const c3 = await startStarter(db);
  const p3 = pay(rzp, c3.orderId);
  const raw = await call('rzp-callback', { method: 'POST', rawBody: Buffer.from(new URLSearchParams(p3).toString()) });
  expect(raw.headers.location).toBe('/credits#paid');

  expect(purchases(db)).toHaveLength(2);
  expect(db.find('credit_orders', (o) => o.id === c2.credit_order_id).status).toBe('pending');
});

/* ── the webhook ──────────────────────────────────────────────────────────── */

function signedEvent(event, payment, order) {
  const body = Buffer.from(JSON.stringify({
    entity: 'event', event,
    payload: Object.assign({ payment: { entity: payment } }, order ? { order: { entity: order } } : {}),
  }));
  return { rawBody: body, headers: { 'x-razorpay-signature': crypto.createHmac('sha256', HOOK_SECRET).update(body).digest('hex') } };
}

test('webhook: order.paid credits once however often it arrives, after or before verify; a bad signature is 400', async () => {
  const { db, rzp } = world();
  const c = await startStarter(db);
  const before = Number(walletOf(db).balance);
  const proof = pay(rzp, c.orderId);
  const payment = rzp.payments.get(proof.razorpay_payment_id);

  const ev = signedEvent('order.paid', payment, rzp.orders.get(c.orderId));
  const first = await call('rzp-webhook', Object.assign({ method: 'POST' }, ev));
  expect(first.code, JSON.stringify(first.payload)).toBe(200);
  expect(first.payload).toMatchObject({ ok: true, credited: true });
  // A webhook trusts its own signature: it makes no API call.
  expect(rzp.calls.filter((x) => x.method === 'GET')).toHaveLength(0);

  const again = await call('rzp-webhook', Object.assign({ method: 'POST' }, ev));
  expect(again.payload.credited).toBe(false);
  const captured = await call('rzp-webhook', Object.assign({ method: 'POST' }, signedEvent('payment.captured', payment)));
  expect(captured.payload.credited).toBe(false);
  const verified = await call('rzp-verify', { token: 'tok-a', body: proof });
  expect(verified.payload.credited).toBe(false);

  expect(Number(walletOf(db).balance)).toBe(before + STARTER_CREDITS);
  expect(purchases(db)).toHaveLength(1);

  // Bad signature: 400, nothing credited.
  const c2 = await startStarter(db);
  const p2 = rzp.payments.get(pay(rzp, c2.orderId).razorpay_payment_id);
  const forged = signedEvent('order.paid', p2);
  forged.headers['x-razorpay-signature'] = crypto.createHmac('sha256', 'wrong').update(forged.rawBody).digest('hex');
  const bad = await call('rzp-webhook', Object.assign({ method: 'POST' }, forged));
  expect(bad.code).toBe(400);
  // A body changed after signing.
  const tampered = signedEvent('order.paid', p2);
  tampered.rawBody = Buffer.from(tampered.rawBody.toString().replace(String(p2.amount), '1'));
  expect((await call('rzp-webhook', Object.assign({ method: 'POST' }, tampered))).code).toBe(400);
  expect(db.find('credit_orders', (o) => o.id === c2.credit_order_id).status).toBe('pending');

  // Events it does not handle, and orders it never made, are acknowledged.
  const other = await call('rzp-webhook', Object.assign({ method: 'POST' }, signedEvent('refund.created', p2)));
  expect(other.code).toBe(200);
  expect(other.payload.ignored).toBe('refund.created');
  const stranger = await call('rzp-webhook', Object.assign({ method: 'POST' }, signedEvent('payment.captured', { id: 'pay_' + alnum(14), order_id: 'order_' + alnum(14), amount: 100, currency: 'INR', status: 'captured' })));
  expect(stranger.code).toBe(200);
  expect(stranger.payload.ignored).toBe('unknown_order');

  expect(purchases(db)).toHaveLength(1);
});

/* ── errors and secrets ───────────────────────────────────────────────────── */

test('Razorpay refusing our keys is a calm 500 that logs only the code, and the order is marked failed', async () => {
  const { db, rzp } = world();
  rzp.keyOk = false;
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.map(String).join(' '));
  let r;
  try { r = await call('rzp-order', { token: 'tok-a', body: { pack_key: 'starter' } }); }
  finally { console.error = orig; }
  expect(r.code).toBe(500);
  expect(r.payload.error).toBe('payments_misconfigured');
  expect(r.payload.message).toMatch(/Nothing was charged/);
  expect(logs.join('\n')).toMatch(/401 BAD_REQUEST_ERROR/);
  for (const s of [KEY_SECRET, KEY_ID, 'Authentication failed', String(STARTER_PAISE)]) expect(logs.join('\n')).not.toContain(s);
  expect(db.table('credit_orders').map((o) => o.status)).toEqual(['failed']);
});

test('no secret reaches a response or any file the browser can load', async () => {
  const { db, rzp } = world();
  const payloads = [];
  const keep = (r) => { payloads.push(JSON.stringify(r.payload || '') + JSON.stringify(r.headers || {})); return r; };
  const cat = keep(await call('catalog'));
  keep(await call('balance', { token: 'tok-a', query: { workspace_id: 'ws-a' } }));
  const o = keep(await call('rzp-order', { token: 'tok-a', body: { pack_key: 'starter' } }));
  const proof = pay(rzp, o.payload.orderId);
  keep(await call('rzp-verify', { token: 'tok-a', body: proof }));
  keep(await call('rzp-callback', { method: 'POST', body: proof }));
  keep(await call('rzp-webhook', Object.assign({ method: 'POST' }, signedEvent('order.paid', rzp.payments.get(proof.razorpay_payment_id)))));

  const all = payloads.join('\n');
  expect(all).toContain(KEY_ID);                 // the key id is public by design
  expect(all).not.toContain(KEY_SECRET);
  expect(all).not.toContain(HOOK_SECRET);
  expect(cat.payload.razorpay).toBe(true);

  // Nothing served from the deployment root names the secrets' values or reads them.
  const served = fs.readdirSync(ROOT).filter((f) => /\.(html|js)$/.test(f));
  expect(served).toContain('credits.js');
  for (const f of served) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    expect(text, f).not.toMatch(/RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET/);
  }
  void db;
});
