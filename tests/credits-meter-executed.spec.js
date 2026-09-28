// The credit meter, EXECUTED: hold, settle, release, and the money-moving router.
//
// Everything here runs api/_shared/credits-core.js unmodified against an
// in-memory Supabase (tests/lib/fake-supabase.js) whose ledger RPCs are
// re-implemented from the SQL in 20260809130000_credits.sql, so "the balance
// moved" is measured on a wallet row rather than inferred from a call being
// made. Nothing asserts on source text.
//
// What has to hold, in the order it matters to somebody's money:
//
//   - a feature key that is not in the catalogue THROWS before a hold, before
//     the session is checked and before the wallet is read: the feature never
//     runs, and it never runs free;
//   - a successful run takes the reservation at hold time and converts it to a
//     spend at settle time - the balance moves once;
//   - a run that throws, a handler that answers 5xx, and a 200 that carries a
//     fallback result all RELEASE the whole reservation (the refund test is the
//     one a no-op release() fails);
//   - a ledger that is down at settle time never blocks the user's response,
//     and leaves the reservation visible as `held` rather than silently spent
//     or silently refunded;
//   - the welcome grant lands once per USER, so a second workspace is not a
//     second grant, and the unique index absorbs a concurrent first touch;
//   - the three complimentary accounts recharge free and are still metered.
//
// Run: npx playwright test tests/credits-meter-executed.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const { FakeSupabase, installCreditsRpc, makeReq, makeRes, envScope, response, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const CREDITS = path.resolve(__dirname, '..', 'api', '_shared', 'credits-core.js');
const credits = require(CREDITS);
const ORIGINAL_ENTRY = require.cache[CREDITS];
const catalog = require(path.resolve(__dirname, '..', 'api', '_shared', 'credit-catalog.js'));

const COMP_EMAIL = 'anchit.tandon@gmail.com';
const CRON = 'cron-secret-for-tests';

const ENV = envScope([
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'CREDIT_WELCOME_GRANT', 'CREDIT_PACK_PRICES',
  'CREDITS_ALLOW_SELF_SERVE', 'CREDITS_COMP_ACCOUNTS', 'CRON_SECRET',
]);
let REAL_FETCH;

test.beforeAll(() => {
  ENV.save();
  REAL_FETCH = global.fetch;
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CRON_SECRET = CRON;
  // A priced deployment, so a recharge records an amount rather than refusing.
  process.env.CREDIT_PACK_PRICES = JSON.stringify(Object.fromEntries(catalog.PACKS.map((p) => [p.key, { currency: 'INR', amount_minor: 49900 }])));
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'CREDIT_WELCOME_GRANT', 'CREDITS_ALLOW_SELF_SERVE', 'CREDITS_COMP_ACCOUNTS']) delete process.env[k];
});
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; });
test.afterEach(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY; require.cache[CREDITS] = ORIGINAL_ENTRY; });

/* ── the world ──────────────────────────────────────────────────────────── */

function world() {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test')
    .addUser('tok-comp', 'user-comp', COMP_EMAIL)
    .addUser('tok-b', 'user-b', 'b@example.test')
    .addWorkspace('ws-a', 'user-a').addWorkspace('ws-a2', 'user-a').addWorkspace('ws-c', 'user-comp').addWorkspace('ws-b', 'user-b')
    .setActive('user-a', 'ws-a').setActive('user-comp', 'ws-c')
    .syncIdentityTables();
  installCreditsRpc(db);
  db.install();
  return db;
}

const wallet = (db, user = 'user-a', ws = 'ws-a') => db.find('credit_wallets', (w) => w.user_id === user && (w.workspace_id || null) === ws);
const kinds = (db) => db.table('credit_ledger').map((l) => l.kind);
const req = (token, extra) => makeReq(Object.assign({ token }, extra || {}));

/** The credits module with a cold price-override cache, for the tests that set one. */
function freshCredits() {
  delete require.cache[CREDITS];
  const m = require(CREDITS);
  return m;
}

/* ── 1. an unpriced feature never runs ──────────────────────────────────── */

test('a feature key absent from the catalogue throws before any hold, any session check and any wallet read', async () => {
  const db = world();
  let err = null;
  try { await credits.meter(req('tok-a'), 'not.in.the.catalogue'); } catch (e) { err = e; }
  expect(err && err.code).toBe('unpriced_feature');
  expect(err.status).toBe(500);
  expect(err.message).toContain('credit-catalog.js');
  // Nothing downstream of the catalogue check happened.
  expect(db.calls.some((c) => c.url.includes('/auth/v1/user'))).toBe(false);
  expect(db.calls.some((c) => /credit_hold|credit_wallets|credit_wallet_id/.test(c.url))).toBe(false);
  expect(db.table('credit_ledger')).toHaveLength(0);

  // enforce() writes the failure itself and the endpoint stays a single `if`.
  const res = makeRes();
  const gate = await credits.enforce(req('tok-a'), res, 'not.in.the.catalogue');
  expect(gate.ok).toBe(false);
  expect(res.code).toBe(500);
  expect(res.payload.error).toBe('unpriced_feature');

  // metered(): the handler behind an unpriced key is never invoked, so the
  // feature cannot run free by way of a typo.
  let ran = 0;
  const handler = credits.metered(async (_r, r) => { ran += 1; r.status(200).json({ ok: true }); }, () => 'not.in.the.catalogue');
  const res2 = makeRes();
  await handler(req('tok-a', { body: {} }), res2);
  expect(ran).toBe(0);
  expect(res2.code).toBe(500);
  expect(res2.payload.error).toBe('unpriced_feature');
  expect(db.table('credit_ledger')).toHaveLength(0);
});

/* ── 2. hold, then settle ───────────────────────────────────────────────── */

test('a successful run takes the reservation at hold time and converts it to a spend at settle: the balance moves exactly once', async () => {
  const db = world();
  const m = await credits.meter(req('tok-a'), 'mailer.generate');      // 20 credits
  expect(m.ok).toBe(true);
  expect(m.free).toBe(false);
  expect(m.workspace_id).toBe('ws-a');                                   // the ACTIVE brand's wallet, resolved from the session
  expect(m.quote.total).toBe(20);
  expect(m.auth.user_id).toBe('user-a');

  // First touch created the wallet with the welcome grant, then held 20.
  expect(wallet(db)).toMatchObject({ balance: 480, held: 20, lifetime_granted: 500, lifetime_spent: 0 });
  expect(m.balance).toBe(480);
  expect(kinds(db)).toEqual(['grant', 'hold']);

  const r = await m.settle();
  expect(r).toMatchObject({ ok: true, charged: 20, refunded: 0, balance: 480 });
  expect(wallet(db)).toMatchObject({ balance: 480, held: 0, lifetime_spent: 20 });
  expect(m.receipt).toMatchObject({ feature: 'mailer.generate', label: 'Generate mailer', cost: 20, units: 1, charged: 20, refunded: 0, balance: 480 });
  expect(kinds(db)).toEqual(['grant', 'hold', 'spend']);

  // A second settle, or a late release, never reaches the ledger again.
  const before = db.calls.length;
  expect(await m.settle()).toEqual({ ok: true, already: true });
  expect(await m.release()).toEqual({ ok: true, already: true });
  expect(db.calls.length).toBe(before);
  expect(wallet(db)).toMatchObject({ balance: 480, held: 0 });
});

/* ── 3. a thrown failure is refunded in full ────────────────────────────── */

test('a run that throws costs nothing: withCredits releases the whole reservation and the ledger records why', async () => {
  const db = world();
  const boom = new Error('provider exploded mid-run');
  let heldDuringRun = null;
  await expect(credits.withCredits(req('tok-a'), 'landing.generate', {}, async () => {   // 22 credits
    heldDuringRun = wallet(db).held;
    throw boom;
  })).rejects.toBe(boom);

  expect(heldDuringRun, 'the hold is real while the run is in flight').toBe(22);
  expect(wallet(db)).toMatchObject({ balance: 500, held: 0, lifetime_spent: 0 });
  const release = db.table('credit_ledger').find((l) => l.kind === 'release');
  expect(release).toBeTruthy();
  expect(release.delta).toBe(22);
  expect(release.note).toBe('provider exploded mid-run');
  expect(db.calls.some((c) => /credit_settle/.test(c.url))).toBe(false);

  // The success path of the same wrapper: the receipt rides on the result and
  // the private __units field is consumed, not echoed.
  const out = await credits.withCredits(req('tok-a'), 'audio.tts', { units: 5 }, async () => ({ text: 'ok', __units: 2 }));
  expect(out.__units).toBeUndefined();
  expect(out.credits).toMatchObject({ feature: 'audio.tts', units: 2, charged: 4, refunded: 6 });
  expect(wallet(db)).toMatchObject({ balance: 496, held: 0, lifetime_spent: 4 });
});

/* ── 4. metered units ───────────────────────────────────────────────────── */

test('a metered feature is settled on the units actually used, never above the reservation, and an explicit zero refunds everything', async () => {
  const db = world();
  const m = await credits.meter(req('tok-a'), 'telesuite.transcription', { units: 10 });   // 4 x 10 reserved
  expect(m.quote.total).toBe(40);
  expect(wallet(db)).toMatchObject({ balance: 460, held: 40 });
  const r = await m.settle(3.2);                                          // 4 minutes billed
  expect(r).toMatchObject({ charged: 16, refunded: 24, balance: 484 });
  expect(m.receipt.units).toBe(4);

  const z = await credits.meter(req('tok-a'), 'audio.tts');               // estimate 1 -> 2 reserved
  expect(wallet(db)).toMatchObject({ balance: 482, held: 2 });
  expect(await z.settle(0)).toMatchObject({ charged: 0, refunded: 2, balance: 484 });

  // Asking to bill MORE than was reserved is capped by the ledger: the
  // reservation is the most a run can ever cost.
  const over = await credits.meter(req('tok-a'), 'audio.tts', { units: 1 });
  expect(await over.settle(50)).toMatchObject({ charged: 2, refunded: 0 });
  expect(wallet(db)).toMatchObject({ balance: 482, held: 0, lifetime_spent: 18 });
});

/* ── 5. the endpoint wrapper ────────────────────────────────────────────── */

test('the endpoint wrapper: a 2xx settles and stamps the receipt on the payload; a 5xx, a thrown handler and a fallback 200 all release', async () => {
  const db = world();
  const wrap = (handler, opts) => credits.metered(handler, () => 'ads.generate', undefined, opts);   // 18 credits

  // 2xx: buffered, settled, then flushed with the receipt attached.
  let res = makeRes();
  await wrap(async (_r, r) => { r.status(200).json({ ok: true, ads: 3 }); })(req('tok-a', { body: { x: 1 } }), res);
  expect(res.code).toBe(200);
  expect(res.payload.ads).toBe(3);
  expect(res.payload.credits).toMatchObject({ feature: 'ads.generate', charged: 18, refunded: 0 });
  expect(wallet(db)).toMatchObject({ balance: 482, held: 0, lifetime_spent: 18 });

  // 5xx: the reservation comes back, and the body the handler wrote is what goes out.
  res = makeRes();
  await wrap(async (_r, r) => { r.status(502).json({ ok: false, error: 'upstream' }); })(req('tok-a'), res);
  expect(res.code).toBe(502);
  expect(res.payload.error).toBe('upstream');
  expect(wallet(db)).toMatchObject({ balance: 482, held: 0, lifetime_spent: 18 });
  let releases = db.table('credit_ledger').filter((l) => l.kind === 'release');
  expect(releases).toHaveLength(1);
  expect(releases[0].note).toBe('endpoint returned 502');

  // A handler that throws: released, and the error still reaches the caller.
  res = makeRes();
  await expect(wrap(async () => { throw new Error('handler crashed'); })(req('tok-a'), res)).rejects.toThrow('handler crashed');
  expect(wallet(db)).toMatchObject({ balance: 482, held: 0 });
  releases = db.table('credit_ledger').filter((l) => l.kind === 'release');
  expect(releases).toHaveLength(2);
  expect(releases[1].note).toBe('endpoint returned 500');
  expect(res.payload).toBeNull();                                           // nothing was written for it

  // A 200 that the endpoint itself says is a fallback: the user did not get
  // what they paid for, so it refunds.
  res = makeRes();
  await wrap(async (_r, r) => { r.status(200).json({ ok: true, provider: 'template-fallback' }); },
    { successIf: (p) => p.provider !== 'template-fallback' })(req('tok-a'), res);
  expect(res.code).toBe(200);
  expect(wallet(db)).toMatchObject({ balance: 482, held: 0 });
  releases = db.table('credit_ledger').filter((l) => l.kind === 'release');
  expect(releases).toHaveLength(3);
  expect(releases[2].note).toBe('endpoint returned a fallback result');

  // A handler that ends the response without JSON still settles.
  res = makeRes();
  await wrap(async (_r, r) => { r.status(200); r.end('plain text'); })(req('tok-a'), res);
  expect(res.ended).toEqual(['plain text']);
  expect(wallet(db)).toMatchObject({ balance: 464, held: 0, lifetime_spent: 36 });

  // A read-only mode (featureFor -> null) runs free: no session check, no hold.
  res = makeRes();
  const before = db.calls.length;
  await credits.metered(async (_r, r) => r.status(200).json({ ok: true }), () => null)(req('tok-a'), res);
  expect(db.calls.length).toBe(before);
  expect(res.payload.credits).toBeUndefined();

  // OPTIONS is passed straight through to the handler.
  res = makeRes();
  let optionsSeen = 0;
  await wrap(async (_r, r) => { optionsSeen += 1; r.status(204).end(); })(req('tok-a', { method: 'OPTIONS' }), res);
  expect(optionsSeen).toBe(1);
  expect(db.calls.length).toBe(before);
});

/* ── 6. a ledger that is down at settle time ────────────────────────────── */

test('a ledger that fails at settle time never blocks the response: the answer goes out and the reservation stays visible as held', async () => {
  const db = world();
  db.rpcFailures.credit_settle = 500;
  const res = makeRes();
  await credits.metered(async (_r, r) => r.status(200).json({ ok: true, html: '<p>x</p>' }), () => 'mailer.generate')(req('tok-a'), res);
  expect(res.code).toBe(200);
  expect(res.payload.ok).toBe(true);
  expect(res.payload.credits).toMatchObject({ feature: 'mailer.generate', charged: 20 });   // the up-front receipt
  // Not spent, not refunded: HELD, which is where the wallet page shows it.
  expect(wallet(db)).toMatchObject({ balance: 480, held: 20, lifetime_spent: 0 });
  expect(kinds(db)).toEqual(['grant', 'hold']);

  // The same outage on the release side: the refusal is swallowed, the
  // response still goes out, and the hold remains for the operator to see.
  db.rpcFailures.credit_release = 500;
  const res2 = makeRes();
  await credits.metered(async (_r, r) => r.status(500).json({ ok: false }), () => 'mailer.generate')(req('tok-a'), res2);
  expect(res2.code).toBe(500);
  expect(wallet(db)).toMatchObject({ balance: 460, held: 40 });
});

/* ── 7. insufficient credits ────────────────────────────────────────────── */

test('a wallet that cannot cover the run answers 402 with the shortfall, and nothing is held', async () => {
  const db = world();
  db.insert('credit_wallets', { user_id: 'user-a', workspace_id: 'ws-a', balance: 10, held: 0, lifetime_granted: 500, lifetime_spent: 490, low_balance_threshold: 50 });
  db.insert('credit_ledger', { user_id: 'user-a', workspace_id: 'ws-a', kind: 'grant', ref: 'welcome', delta: 500, balance_after: 500 });

  const m = await credits.meter(req('tok-a'), 'mailer.generate');
  expect(m).toMatchObject({ ok: false, status: 402, error: 'insufficient_credits', balance: 10, required: 20, short_by: 10, feature: 'mailer.generate' });
  expect(wallet(db)).toMatchObject({ balance: 10, held: 0 });
  expect(db.table('credit_ledger').filter((l) => l.kind === 'hold')).toHaveLength(0);

  const res = makeRes();
  expect((await credits.enforce(req('tok-a'), res, 'mailer.generate')).ok).toBe(false);
  expect(res.code).toBe(402);
  expect(res.payload.short_by).toBe(10);

  await expect(credits.withCredits(req('tok-a'), 'mailer.generate', {}, async () => 'never')).rejects.toMatchObject({ status: 402 });

  // A cheaper feature still runs on what is left.
  const ok = await credits.meter(req('tok-a'), 'kb.search');
  expect(ok.ok).toBe(true);
  expect(wallet(db)).toMatchObject({ balance: 9, held: 1 });
});

/* ── 8. the welcome grant ───────────────────────────────────────────────── */

test('the welcome grant lands once per user: a second workspace starts empty, and a concurrent first touch is absorbed', async () => {
  const db = world();
  const a = await credits.meter(req('tok-a'), 'kb.search', { workspace_id: 'ws-a' });
  expect(a.ok).toBe(true);
  expect(wallet(db)).toMatchObject({ balance: 499, held: 1 });

  // Same user, another workspace: a wallet, but no second grant.
  const b = await credits.meter(req('tok-a'), 'kb.search', { workspace_id: 'ws-a2' });
  expect(b).toMatchObject({ ok: false, error: 'insufficient_credits', balance: 0 });
  expect(wallet(db, 'user-a', 'ws-a2')).toMatchObject({ balance: 0, held: 0 });
  expect(db.table('credit_ledger').filter((l) => l.ref === 'welcome')).toHaveLength(1);
  expect(db.calls.filter((c) => /credit_grant/.test(c.url))).toHaveLength(1);

  // A race: two tabs both see no grant row, the unique index catches the
  // second, and the meter carries on rather than failing the run.
  const db2 = world();
  db2.rpc.credit_grant = () => response(409, { code: '23505', message: 'duplicate key value violates unique constraint "credit_ledger_welcome_once_user_idx"' });
  const c = await credits.meter(req('tok-a'), 'kb.search');
  expect(c).toMatchObject({ ok: false, error: 'insufficient_credits' });   // absorbed, then judged on the real balance

  // Any OTHER failure of the grant is not swallowed.
  const db3 = world();
  db3.rpc.credit_grant = () => response(500, { message: 'ledger down' });
  await expect(credits.meter(req('tok-a'), 'kb.search')).rejects.toMatchObject({ status: 502 });
});

/* ── 9. the router ──────────────────────────────────────────────────────── */

test('the router: prices are public, everything else needs a session, and fulfilment needs the operator secret', async () => {
  const db = world();
  const run = async (query, token, body, headers) => {
    const res = makeRes();
    await credits.handle(makeReq({ token, query, body, headers, method: body ? 'POST' : 'GET' }), res);
    return res;
  };

  let r = await run({ op: 'catalog' });
  expect(r.code).toBe(200);
  expect(r.payload).toMatchObject({ ok: true, configured: true, welcome_grant: 500 });
  expect(r.payload.features.find((f) => f.key === 'mailer.generate').cost).toBe(20);
  expect(r.payload.packs.every((p) => p.price.configured)).toBe(true);
  expect(db.calls.some((c) => c.url.includes('/auth/v1/user'))).toBe(false);

  r = await run({ op: 'balance' });
  expect(r.code).toBe(401);
  r = await run({ op: 'balance', workspace_id: 'ws-a' }, 'tok-a');
  expect(r.code).toBe(200);
  expect(r.payload.wallet).toMatchObject({ balance: 500, held: 0, workspace_id: 'ws-a' });   // first touch: the welcome grant
  expect(r.payload.comp).toBe(false);
  expect(r.payload.low).toBe(false);
  // No workspace named: the PERSONAL wallet, which is a different wallet and
  // gets no second grant - it opens empty and reports itself as low.
  r = await run({ op: 'balance' }, 'tok-a');
  expect(r.payload.wallet).toMatchObject({ balance: 0, held: 0, workspace_id: null });
  expect(r.payload.low).toBe(true);
  r = await run({ op: 'balance', workspace_id: 'ws-c' }, 'tok-comp');
  expect(r.payload.comp).toBe(true);

  const m = await credits.meter(req('tok-a'), 'mailer.generate', { workspace_id: 'ws-a' });
  await m.settle();
  r = await run({ op: 'ledger', workspace_id: 'ws-a' }, 'tok-a');
  expect(r.payload.entries.map((e) => e.kind)).toEqual(['spend', 'hold', 'grant']);
  r = await run({ op: 'usage', workspace_id: 'ws-a' }, 'tok-a');
  expect(r.payload.usage[0]).toMatchObject({ feature_key: 'mailer.generate', runs: 1, credits: 20 });
  r = await run({ op: 'quote', feature: 'video.generate' }, 'tok-a');
  expect(r.payload.quote.total).toBe(200);

  r = await run({ op: 'recharge', workspace_id: 'ws-a' }, 'tok-a', { pack_key: 'starter' });
  expect(r.code).toBe(200);
  expect(r.payload).toMatchObject({ ok: true, status: 'pending', credited: false });
  const order = db.table('credit_orders')[0];
  expect(order).toMatchObject({ user_id: 'user-a', workspace_id: 'ws-a', pack_key: 'starter', credits: 500, status: 'pending', amount_minor: 49900, currency: 'INR' });
  r = await run({ op: 'orders' }, 'tok-a');
  expect(r.payload.orders).toHaveLength(1);

  // A signed-in member is not an operator.
  r = await run({ op: 'fulfil' }, 'tok-a', { order_id: order.id });
  expect(r.code).toBe(403);
  expect(r.payload.error).toBe('operator_only');
  expect(order.status).toBe('pending');
  expect(wallet(db)).toMatchObject({ balance: 480 });

  r = await run({ op: 'teleport' }, 'tok-a');
  expect(r.code).toBe(400);
  expect(r.payload.available).toContain('balance');

  // Unconfigured: paid features are refused with a 503 the UI can explain,
  // and the price list is still served.
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  r = await run({ op: 'balance' }, 'tok-a');
  expect(r.code).toBe(503);
  expect(r.payload.error).toBe('credits_unavailable');
  expect(r.payload.features.length).toBeGreaterThan(0);
  expect(await credits.meter(req('tok-a'), 'mailer.generate')).toMatchObject({ ok: false, status: 503, error: 'credits_unavailable' });
  expect(credits.configured()).toBe(false);
});

test('enforce() on an unconfigured meter lets a legacy endpoint through unmetered only when the endpoint opted in', async () => {
  world();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let res = makeRes();
  const gate = await credits.enforce(req('tok-a'), res, 'mailer.generate');
  expect(gate).toMatchObject({ ok: true, free: true, unmetered: true, receipt: null });
  expect(res.payload).toBeNull();
  res = makeRes();
  const strict = await credits.enforce(req('tok-a'), res, 'mailer.generate', { optional: false });
  expect(strict.ok).toBe(false);
  expect(res.code).toBe(503);
  expect(res.payload.error).toBe('credits_unavailable');
});

/* ── 10. complimentary accounts ─────────────────────────────────────────── */

test('a complimentary account is metered like everyone else, and only its recharge is free', async () => {
  const db = world();
  const m = await credits.meter(req('tok-comp'), 'mailer.generate', { workspace_id: 'ws-c' });
  expect(m.ok).toBe(true);
  expect(db.calls.some((c) => /credit_hold/.test(c.url))).toBe(true);
  expect(wallet(db, 'user-comp', 'ws-c')).toMatchObject({ balance: 480, held: 20 });
  await m.settle();
  expect(wallet(db, 'user-comp', 'ws-c').lifetime_spent).toBe(20);

  // The recharge lands immediately, through the same router, recorded as what it is.
  const res = makeRes();
  await credits.handle(makeReq({ token: 'tok-comp', query: { op: 'recharge', workspace_id: 'ws-c' }, body: { pack_key: 'growth' } }), res);
  expect(res.payload).toMatchObject({ ok: true, comp: true, credited: true, credits: 2750 });
  expect(wallet(db, 'user-comp', 'ws-c')).toMatchObject({ balance: 480 + 2750 });
  expect(db.table('credit_orders')[0]).toMatchObject({ status: 'paid', provider: 'comp_account', provider_ref: `comp:${COMP_EMAIL}`, amount_minor: 0 });
});

/* ── 11. free features ──────────────────────────────────────────────────── */

test('a free feature takes no hold, writes no ledger row and needs no session', async () => {
  const db = world();
  const m = await credits.meter(makeReq({}), 'brand.onboard');
  expect(m).toMatchObject({ ok: true, free: true, hold_id: null, charged: 0 });
  expect(await m.settle()).toEqual({ ok: true, charged: 0 });
  expect(await m.release()).toEqual({ ok: true, released: 0 });
  expect(db.calls.filter((c) => !/credit_prices/.test(c.url))).toHaveLength(0);
  expect(db.table('credit_ledger')).toHaveLength(0);
  // An explicit zero on a metered feature is also free: the caller said no billable work.
  const z = await credits.meter(makeReq({}), 'telesuite.transcription', { units: 0 });
  expect(z.free).toBe(true);
  expect(z.quote.total).toBe(0);
});

/* ── 12. operator price overrides ───────────────────────────────────────── */

test('an operator price row overrides the catalogue for the charge, the receipt and the price list, and a pack price row makes a pack purchasable', async () => {
  const db = world();
  db.insert('credit_prices', { feature_key: 'mailer.generate', cost: 7, unit_label: 'per mailer (promo)' });
  db.insert('credit_pack_prices', { pack_key: 'starter', currency: 'USD', amount_minor: 1999 });
  const fresh = freshCredits();                                            // a cold override cache
  const m = await fresh.meter(req('tok-a'), 'mailer.generate');
  expect(m.quote).toMatchObject({ cost: 7, total: 7, unit: 'per mailer (promo)' });
  expect(wallet(db)).toMatchObject({ balance: 493, held: 7 });
  await m.settle();
  expect(m.receipt).toMatchObject({ cost: 7, charged: 7 });

  const list = await fresh.priceList();
  expect(list.find((f) => f.key === 'mailer.generate')).toMatchObject({ cost: 7, overridden: true });
  expect(list.find((f) => f.key === 'ads.generate')).toMatchObject({ cost: 18, overridden: false });
  // The packs reach the browser only through the router, priced.
  const res = makeRes();
  await fresh.handle(makeReq({ query: { op: 'catalog' } }), res);
  const packs = res.payload.packs;
  expect(packs.find((p) => p.key === 'starter').price).toMatchObject({ configured: true, source: 'operator', currency: 'USD', amount_minor: 1999, display: '$19.99' });
  expect(packs.find((p) => p.key === 'growth').price).toMatchObject({ configured: true, source: 'environment', currency: 'INR' });
  expect(res.payload.features.find((f) => f.key === 'mailer.generate')).toMatchObject({ cost: 7, overridden: true });
});

/* ═══ found by running it ═════════════════════════════════════════════════ */

// The operator fulfilment op existed, read correctly, and could never be
// reached: it sat behind requireUser(), which verifies the bearer against
// /auth/v1/user, and then compared the SAME bearer to CRON_SECRET. No token
// satisfies both. Every order that was not complimentary or self-serve stayed
// `pending` for good. The operator now presents CRON_SECRET and no session.
test('the operator confirms an off-platform payment with CRON_SECRET, exactly once, and a session cannot stand in for it', async () => {
  const db = world();
  const run = async (body, headers) => {
    const res = makeRes();
    await credits.handle(makeReq({ query: { op: 'fulfil' }, body, headers, method: 'POST' }), res);
    return res;
  };
  const order = db.insert('credit_orders', { user_id: 'user-a', workspace_id: 'ws-a', pack_key: 'starter', credits: 500, status: 'pending', amount_minor: 49900, currency: 'INR' });
  const asOperator = { authorization: `Bearer ${CRON}` };

  let r = await run({ order_id: order.id, provider: 'bank_transfer', provider_ref: 'TXN-1' }, asOperator);
  expect(r.code).toBe(200);
  expect(r.payload).toMatchObject({ ok: true, credited: true, credits: 500 });
  expect(order).toMatchObject({ status: 'paid', provider: 'bank_transfer', provider_ref: 'TXN-1' });
  expect(wallet(db)).toMatchObject({ balance: 500, lifetime_granted: 500 });   // the purchase, not a welcome grant
  expect(db.table('credit_ledger').map((l) => l.kind)).toEqual(['purchase']);
  expect(db.calls.some((c) => c.url.includes('/auth/v1/user')), 'no session is looked up for an operator').toBe(false);

  // Paid once: a retry, a webhook and an operator racing all land on the same row.
  r = await run({ order_id: order.id, provider: 'bank_transfer', provider_ref: 'TXN-1' }, asOperator);
  expect(r.payload.credited).toBe(false);
  expect(r.payload.message).toMatch(/already fulfilled/i);
  expect(wallet(db)).toMatchObject({ balance: 500 });

  r = await run({ order_id: 'no-such-order' }, asOperator);
  expect(r.code).toBe(404);
  r = await run({ order_id: order.id }, { authorization: 'Bearer not-the-secret' });
  expect(r.code).toBe(403);
  r = await run({ order_id: order.id }, { authorization: `Bearer ${CRON}x` });
  expect(r.code).toBe(403);
  r = await run({ order_id: order.id }, {});
  expect(r.code).toBe(403);
  delete process.env.CRON_SECRET;
  r = await run({ order_id: order.id }, { authorization: 'Bearer ' });
  expect(r.code, 'no secret configured means nobody is the operator').toBe(403);
  process.env.CRON_SECRET = CRON;

  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  r = await run({ order_id: order.id }, asOperator);
  expect(r.code).toBe(503);
  expect(r.payload.error).toBe('credits_unavailable');
});
