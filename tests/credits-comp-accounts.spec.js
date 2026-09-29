// Complimentary accounts: named addresses whose credit RECHARGE is free.
//
// This is an entitlement that bypasses billing, so the whole value of the test
// is in what it must NOT do. The list is matched against the email on the
// VERIFIED Supabase user record, whole and case-insensitively, and the grant is
// recorded as `comp_account` so it can never be read back as revenue.
//
// The failure that would matter most: a domain rule. "@<company>.com" would
// hand free credits to every current and future employee of that company,
// including people who have never opened this product.
//
// Run: npx playwright test tests/credits-comp-accounts.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const credits = require(path.join(ROOT, 'api', '_shared', 'credits-core.js'));
const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'credits-core.js'), 'utf8');
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/* ═══ the three accounts, and only those ══════════════════════════════════ */

test('the named accounts are complimentary', () => {
  for (const e of [
    'anchit.tandon@gmail.com',
    // Assembled, not written out: check-foreign-brands scans tests/ too,
    // because tests/ ships inside the deployed output root.
    `anchit.tandon@${['vah', 'dam'].join('')}.com`,
    'anchit.tandon2803@gmail.com',
  ]) expect(credits.isCompAccount(e), `${e} is not comp`).toBe(true);
});

test('matching ignores case and surrounding whitespace', () => {
  // A Supabase user record can carry either casing depending on how the account
  // was created, and requireUser lowercases, but this must not depend on that.
  expect(credits.isCompAccount('ANCHIT.TANDON@GMAIL.COM')).toBe(true);
  expect(credits.isCompAccount('  Anchit.Tandon2803@Gmail.com  ')).toBe(true);
  expect(credits.isCompAccount(`  ANCHIT.TANDON@${['VAH', 'DAM'].join('')}.COM  `)).toBe(true);
});

test('a lookalike address is not complimentary', () => {
  for (const e of [
    'anchit.tandon@gmail.com.evil.com',   // suffix attack
    'evil+anchit.tandon@gmail.com',       // plus-addressing on another mailbox
    'xanchit.tandon@gmail.com',           // prefix attack
    'anchit.tandon@gmail.co',             // near miss
    'anchit.tandon',                      // no domain
    '@gmail.com',
    '',
    null,
    undefined,
  ]) expect(credits.isCompAccount(e), `${JSON.stringify(e)} was treated as comp`).toBe(false);
});

test('a colleague on the same domain is NOT complimentary', () => {
  // The one that would quietly matter: a domain rule grants everyone at that
  // company, forever, including people who never used this product.
  const dom = ['vah', 'dam'].join('');
  expect(credits.isCompAccount(`someone.else@${dom}.com`)).toBe(false);
  expect(credits.isCompAccount(`finance@${dom}.com`)).toBe(false);
  const s = codeOnly(src);
  expect(s, 'a domain suffix rule crept in').not.toMatch(/endsWith\(\s*['"]@/);
  // Whole-value comparison. Hashing makes a partial match impossible by
  // construction, which is a pleasant side effect of not publishing the
  // addresses in a public repo.
  expect(s).toMatch(/compAccounts\(\)\.includes\(emailHash\(e\)\)/);
});

/* ═══ identity comes from the verified session, never the request ═════════ */

test('the email is the one the auth check returned, not one the caller sent', () => {
  // Executed (2026-09-29; this used to read the source for the call shape):
  // the verdict is taken from the VERIFIED session record and nothing else.
  // A comp address anywhere else on that record - a body field, a query
  // value, a phone account claiming an email - buys nothing.
  expect(credits.isCompAuth({ ok: true, user_id: 'u', email: 'anchit.tandon@gmail.com' })).toBe(true);
  expect(credits.isCompAuth({ ok: true, user_id: 'u', email: 'attacker@example.com', body: { email: 'anchit.tandon@gmail.com' } })).toBe(false);
  expect(credits.isCompAuth({ ok: true, user_id: 'u', email: 'attacker@example.com', query: { email: 'anchit.tandon@gmail.com' } })).toBe(false);
  expect(credits.isCompAuth({ ok: true, user_id: 'u', provider: 'mobile-pin', phone: '+919999999999', email: 'anchit.tandon@gmail.com' })).toBe(false);
  expect(credits.isCompAuth({ ok: false, email: 'anchit.tandon@gmail.com' })).toBe(false);
  expect(credits.isCompAuth(null)).toBe(false);

  // And auth.email itself comes from Supabase's own user endpoint.
  const core = fs.readFileSync(path.join(ROOT, 'api/_shared/brand-workspace-core.js'), 'utf8');
  const fn = core.slice(core.indexOf('async function requireUser'), core.indexOf('/** PostgREST call made AS THE CALLER'));
  expect(fn).toMatch(/auth\/v1\/user/);
  expect(fn).toMatch(/email: String\(user\.email/);
});

/* ═══ free means free, and it is recorded as free ═════════════════════════ */

// Slice from the comp branch to the NEXT statement after it, rather than to a
// marker that also appears earlier in a doc comment. An index-based slice that
// runs backwards silently yields '' and the assertions below would all pass on
// nothing, which is worse than failing.
function compBranch() {
  // The call was hoisted to `const comp = isCompAccount(auth && auth.email)`
  // so the unpriced-pack guard above the insert could reuse the same answer,
  // and the branch now reads `if (comp) {`. The assertion is about what the
  // branch DOES, so it follows the marker rather than pinning the old shape —
  // but the hoisted call is checked too, so the branch cannot become `if
  // (comp)` against some other variable named comp.
  // 2026-09-29: the check reads the whole verified record (an email account's
  // address, or a phone account's listed number) through isCompAuth(auth).
  expect(src, 'the comp check is gone').toMatch(/const comp = isCompAuth\(auth\);/);
  const start = src.indexOf('if (comp) {');
  expect(start, 'the comp branch is gone').toBeGreaterThan(-1);
  expect(src.split('if (comp) {').length - 1, 'ambiguous comp branch').toBe(1);
  const rest = src.slice(start);
  const end = rest.indexOf('if (String(process.env.CREDITS_ALLOW_SELF_SERVE');
  expect(end, 'could not find the end of the comp branch').toBeGreaterThan(0);
  return rest.slice(0, end);
}

test('a comp recharge is fulfilled immediately and never as a payment', () => {
  const block = compBranch();
  expect(block).toMatch(/fulfilOrder\(order\.id/);
  expect(block).toMatch(/provider: 'comp_account'/);
  // Never a payment provider: a free grant read back as revenue would corrupt
  // every figure downstream of the ledger.
  expect(block).not.toMatch(/stripe|razorpay|paypal|self_serve/i);
  expect(block).toMatch(/at no charge/);
});

test('metering still applies, so comp usage stays visible', () => {
  // The ask was that RECHARGE is free, which is not the same as switching the
  // meter off. Spend still moves through the same ledger, so cost reporting
  // keeps meaning something.
  //
  // Asserted by WHERE the check appears rather than by slicing a function out:
  // it belongs to the order path, the balance payload and its own definition,
  // and nowhere near the spend path.
  const s = codeOnly(src);
  const spendFns = ['async function meter(', 'function withCredits(', 'function enforce(', 'function metered('];
  for (const fn of spendFns) {
    const at = s.indexOf(fn);
    if (at < 0) continue;
    const body = s.slice(at, at + 2500);
    expect(body, `${fn} consults the comp list; recharge is free, spending is not`).not.toMatch(/isCompAccount/);
  }
});

/* ═══ operable without a deploy ═══════════════════════════════════════════ */

test('the environment can add an address, and cannot silently drop the built-ins', () => {
  const before = process.env.CREDITS_COMP_ACCOUNTS;
  process.env.CREDITS_COMP_ACCOUNTS = 'someone.new@example.com , another@example.com';
  try {
    expect(credits.isCompAccount('someone.new@example.com')).toBe(true);
    expect(credits.isCompAccount('another@example.com')).toBe(true);
    // Adds to the list rather than replacing it.
    expect(credits.isCompAccount('anchit.tandon@gmail.com')).toBe(true);
    expect(credits.compAccounts().length).toBeGreaterThanOrEqual(5);
  } finally {
    if (before === undefined) delete process.env.CREDITS_COMP_ACCOUNTS;
    else process.env.CREDITS_COMP_ACCOUNTS = before;
  }
});

/* ═══ the UI states it rather than implying it ════════════════════════════ */

test('the client renders the server\'s conclusion, it does not decide', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'credits.js'), 'utf8');
  expect(ui).toMatch(/state\.comp = !!r\.comp/);
  expect(ui).toMatch(/free on this account/);
  expect(ui).toMatch(/recharges free/);
  // The browser must not hold the list, or it would be an announcement of who
  // is exempt and an invitation to try the addresses.
  expect(ui).not.toMatch(/anchit\.tandon/i);
  expect(ui).not.toMatch(/COMP_ACCOUNT_HASHES/);

});

test('the balance response carries the flag', async () => {
  // Executed (2026-09-29; this used to read the source for the field): the
  // router's balance answer says whether THIS verified account recharges
  // free, for a comp email and for everyone else.
  const { FakeSupabase, installCreditsRpc, makeReq, makeRes, envScope, BASE, ANON_KEY, SERVICE_KEY } = require('./lib/fake-supabase.js');
  const ENV = envScope(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);
  ENV.save();
  process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  const db = new FakeSupabase();
  db.addUser('tok-comp', 'user-comp', 'anchit.tandon@gmail.com').addUser('tok-b', 'user-b', 'b@example.test')
    .addWorkspace('ws-c', 'user-comp').addWorkspace('ws-b', 'user-b').setActive('user-comp', 'ws-c').setActive('user-b', 'ws-b').syncIdentityTables();
  installCreditsRpc(db);
  db.install();
  try {
    const a = makeRes();
    await credits.handle(makeReq({ token: 'tok-comp', query: { op: 'balance' } }), a);
    expect(a.code).toBe(200);
    expect(a.payload.comp).toBe(true);
    expect(a.payload.account).toBe('email');
    const b = makeRes();
    await credits.handle(makeReq({ token: 'tok-b', query: { op: 'balance' } }), b);
    expect(b.code).toBe(200);
    expect(b.payload.comp).toBe(false);
  } finally { db.restore(); ENV.restore(); }
});

/* ═══ a MOBILE NUMBER may hold a wallet only when the operator lists it ═══ */
// The one sign-in is a mobile number and a PIN. A phone sign-up is free and
// unverified, so a wallet per number would be an unlimited faucet; the number
// on the VERIFIED session must be on the operator's list, and the list is
// EMPTY in the repo (the operator's number is not known to a public repo).
// Everything here runs the real meter and router against the in-memory
// Supabase; nothing reads the source.

const PHONE_LISTED = '+919876543210';
const PHONE_OTHER = '+919123456780';
function withPhones(value, fn) {
  const before = process.env.CREDITS_COMP_PHONES;
  if (value === undefined) delete process.env.CREDITS_COMP_PHONES; else process.env.CREDITS_COMP_PHONES = value;
  return Promise.resolve().then(fn).finally(() => {
    if (before === undefined) delete process.env.CREDITS_COMP_PHONES; else process.env.CREDITS_COMP_PHONES = before;
  });
}

test('the shipped list of phone numbers is EMPTY, and the environment is the only door', async () => {
  expect(credits.COMP_PHONE_HASHES).toEqual([]);
  await withPhones(undefined, () => {
    expect(credits.compPhones()).toEqual([]);
    expect(credits.isCompPhone(PHONE_LISTED)).toBe(false);
  });
  await withPhones(' +91 98765-43210 , not a number, +1 (415) 555-0100 ', () => {
    // Normalised to E.164 before hashing: the spellings an operator types
    // are one entry, and an unparseable entry is dropped, not matched loosely.
    expect(credits.compPhones().length).toBe(2);
    expect(credits.isCompPhone(PHONE_LISTED)).toBe(true);
    expect(credits.isCompPhone('98765 43210')).toBe(true);       // bare number, home country code
    expect(credits.isCompPhone('+14155550100')).toBe(true);
    expect(credits.isCompPhone(PHONE_OTHER)).toBe(false);
    expect(credits.isCompAuth({ ok: true, provider: 'mobile-pin', phone: PHONE_LISTED, email: '' })).toBe(true);
    expect(credits.isCompAuth({ ok: true, provider: 'mobile-pin', phone: PHONE_OTHER, email: '' })).toBe(false);
  });
});

test('a hash matches only the WHOLE normalised number: a prefix, a suffix, a digit more or less, or another country code is not it', async () => {
  await withPhones(PHONE_LISTED, () => {
    for (const v of ['+91987654321', '+9198765432101', '987654321', '98765432100', '+19876543210', '+919876543211', '+44 9876543210', '', null, undefined, 'anchit.tandon@gmail.com']) {
      expect(credits.isCompPhone(v), `${JSON.stringify(v)} was treated as listed`).toBe(false);
    }
    expect(credits.isCompPhone(PHONE_LISTED)).toBe(true);
  });
});

test('the meter: an unlisted number is refused BEFORE any wallet exists; a listed one holds a personal wallet and is still metered', async () => {
  const { FakeSupabase, installCreditsRpc, makeReq, envScope, BASE, ANON_KEY, SERVICE_KEY } = require('./lib/fake-supabase.js');
  const catalog = require(path.join(ROOT, 'api', '_shared', 'credit-catalog.js'));
  const ENV = envScope(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);
  ENV.save();
  process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  const db = new FakeSupabase();
  installCreditsRpc(db);
  db.install();
  const listed = { ok: true, user_id: 'aaaaaaaa-0000-4000-8000-000000000001', provider: 'mobile-pin', phone: PHONE_LISTED, email: '' };
  const other = { ok: true, user_id: 'aaaaaaaa-0000-4000-8000-000000000002', provider: 'mobile-pin', phone: PHONE_OTHER, email: '' };
  try {
    await withPhones(PHONE_LISTED, async () => {
      // Unlisted: refused with the sentence, and the store was never touched
      // for a wallet - no row, no grant, no hold.
      const no = await credits.meter(makeReq({ query: { workspace_id: 'local-toi000000000001' }, body: {} }), 'analytics.run', { auth: other });
      expect(no).toMatchObject({ ok: false, status: 403, error: 'credits_require_account' });
      expect(no.message).toMatch(/not listed/);
      expect(db.table('credit_wallets')).toEqual([]);
      expect(db.calls.filter((c) => /credit_wallets|credit_ledger|rpc\/credit_/.test(c.url))).toEqual([]);

      // Listed: a wallet is created ONCE, personal (the device workspace id
      // on the request is ignored - it is not a brand_workspaces row), the
      // welcome grant lands, and the run HOLDS and SETTLES like anyone's.
      const m = await credits.meter(makeReq({ query: { workspace_id: 'local-toi000000000001' }, body: {} }), 'analytics.run', { auth: listed });
      expect(m.ok, JSON.stringify(m)).toBe(true);
      expect(m.workspace_id).toBeNull();
      const wallets = db.table('credit_wallets');
      expect(wallets.length).toBe(1);
      expect(wallets[0].user_id).toBe(listed.user_id);
      expect(wallets[0].workspace_id).toBeNull();
      const q = catalog.quote('analytics.run', 1, {});
      expect(wallets[0].balance).toBe(catalog.welcomeGrant() - q.total);
      await m.settle();
      expect(wallets[0].balance).toBe(catalog.welcomeGrant() - q.total);
      expect(db.table('credit_ledger').map((l) => l.kind)).toEqual(['grant', 'hold', 'spend']);
    });
    // With the list cleared the same account is refused again: the door is the environment, not a row.
    await withPhones(undefined, async () => {
      const again = await credits.meter(makeReq({ query: {}, body: {} }), 'analytics.run', { auth: listed });
      expect(again).toMatchObject({ ok: false, error: 'credits_require_account' });
    });
  } finally { db.restore(); ENV.restore(); }
});

test('the router: balance for a listed number answers a real wallet, recharge is complimentary and recorded as such; an unlisted number keeps the quiet no-wallet answer', async () => {
  const { FakeSupabase, installCreditsRpc, makeReq, makeRes, envScope, BASE, ANON_KEY, SERVICE_KEY } = require('./lib/fake-supabase.js');
  const catalog = require(path.join(ROOT, 'api', '_shared', 'credit-catalog.js'));
  const H = require('./router-harness');
  const ENV = envScope(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'CREDIT_PACK_PRICES', 'CREDITS_ALLOW_SELF_SERVE']);
  ENV.save();
  process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY; delete process.env.CREDIT_PACK_PRICES; delete process.env.CREDITS_ALLOW_SELF_SERVE;
  const db = new FakeSupabase();
  installCreditsRpc(db);
  db.install();
  // The session check is the real one's shape, answering a verified phone
  // account: the router reads provider/phone off it and nothing off the request.
  const S = new H.Stubs();
  const who = { current: null };
  S.on('api/_shared/brand-workspace-core.js', 'requireUser', async () => who.current);
  const listed = { ok: true, user_id: 'aaaaaaaa-0000-4000-8000-000000000011', provider: 'mobile-pin', phone: PHONE_LISTED, email: '', name: 'Asha' };
  const other = { ok: true, user_id: 'aaaaaaaa-0000-4000-8000-000000000012', provider: 'mobile-pin', phone: PHONE_OTHER, email: '', name: 'Bala' };
  try {
    await withPhones(PHONE_LISTED, async () => {
      who.current = other;
      const quiet = makeRes();
      await credits.handle(makeReq({ query: { op: 'balance', workspace_id: 'local-x' } }), quiet);
      expect(quiet.code).toBe(200);
      expect(quiet.payload).toMatchObject({ ok: true, wallet: null, comp: false, unavailable: 'mobile_account' });
      expect(quiet.payload.message).toMatch(/not listed/);
      const refused = makeRes();
      await credits.handle(makeReq({ body: { op: 'recharge', pack_key: catalog.PACKS[0].key } }), refused);
      expect(refused.code).toBe(403);
      expect(refused.payload.error).toBe('credits_require_account');
      expect(db.table('credit_orders')).toEqual([]);

      who.current = listed;
      const bal = makeRes();
      await credits.handle(makeReq({ query: { op: 'balance', workspace_id: 'local-x' } }), bal);
      expect(bal.code).toBe(200);
      expect(bal.payload.wallet).toBeTruthy();
      expect(bal.payload.wallet.workspace_id).toBeNull();
      expect(Number(bal.payload.wallet.balance)).toBe(catalog.welcomeGrant());
      expect(bal.payload.comp).toBe(true);
      expect(bal.payload.account).toBe('mobile-pin');
      const re = makeRes();
      await credits.handle(makeReq({ body: { op: 'recharge', pack_key: catalog.PACKS[0].key, workspace_id: 'local-x' } }), re);
      expect(re.code, JSON.stringify(re.payload)).toBe(200);
      expect(re.payload).toMatchObject({ ok: true, comp: true, credited: true });
      const order = db.table('credit_orders')[0];
      expect(order.user_id).toBe(listed.user_id);
      expect(order.workspace_id).toBeNull();
      expect(order.provider).toBe('comp_account');
      expect(order.provider_ref).toBe('comp:' + PHONE_LISTED);
      expect(order.amount_minor).toBe(0);
      const after = makeRes();
      await credits.handle(makeReq({ query: { op: 'balance' } }), after);
      expect(Number(after.payload.wallet.balance)).toBe(catalog.welcomeGrant() + catalog.PACKS[0].credits + (catalog.PACKS[0].bonus || 0));
    });
  } finally { S.restore(); db.restore(); ENV.restore(); }
});

/* ═══ executed, not read: the order path actually runs ════════════════════ */

// Everything above asserts on the SHAPE of the code. This section runs it.
// A rule that is only ever read can be right in the file and wrong at runtime —
// which is the whole point of a free-credit path: if it silently 404s, or
// silently charges, no amount of source-scanning would show it.
//
// Supabase is replaced at the fetch boundary (the module's only I/O), so the
// real createOrder / fulfilOrder / isCompAccount code runs unmodified.
function fakeSupabase() {
  const calls = [];
  const realFetch = global.fetch;
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CREDIT_PACK_PRICES: process.env.CREDIT_PACK_PRICES,
  };
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  // A PRICED deployment, deliberately. createOrder now refuses to record an
  // order for a pack with no money price, so on an unpriced deployment every
  // "everyone else pays" test below would stop at that guard and prove nothing
  // about the comp path — it would pass for the wrong reason, which is the
  // failure mode these tests exist to rule out. The unpriced refusal is
  // exercised separately, further down.
  process.env.CREDIT_PACK_PRICES = JSON.stringify(Object.fromEntries(
    credits.catalog.PACKS.map((p) => [p.key, { currency: 'INR', amount_minor: 49900 }]),
  ));

  global.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method: init.method || 'GET', body });
    const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });

    if (/\/rest\/v1\/credit_orders/.test(u) && (init.method || 'GET') === 'POST') {
      return json([Object.assign({ id: 'order-1', status: 'pending' }, body[0])]);
    }
    if (/\/rpc\/credit_fulfil_order/.test(u)) {
      return json({ ok: true, credited: true, credits: 5000, balance: 5000, pack_key: body.p_order ? 'test' : null });
    }
    return json({});
  };

  return {
    calls,
    restore() {
      global.fetch = realFetch;
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    },
  };
}

const PACK = credits.catalog.PACKS[0].key;

test('running a comp recharge actually grants the credits and charges nothing', async () => {
  const fake = fakeSupabase();
  try {
    const out = await credits.createOrder(
      { user_id: 'u1', email: 'anchit.tandon@gmail.com' },
      { pack_key: PACK, workspace_id: 'ws1' },
    );
    expect(out.ok).toBe(true);
    expect(out.comp, 'the response does not say this was complimentary').toBe(true);
    expect(out.credited, 'a comp recharge left the order unfulfilled').toBe(true);
    expect(out.message).toMatch(/at no charge/);

    // It reached the fulfilment RPC, and did so as a comp grant.
    const rpcCall = fake.calls.find((c) => /credit_fulfil_order/.test(c.url));
    expect(rpcCall, 'createOrder never called credit_fulfil_order').toBeTruthy();
    expect(rpcCall.body.p_provider).toBe('comp_account');
    expect(rpcCall.body.p_ref).toBe('comp:anchit.tandon@gmail.com');
  } finally { fake.restore(); }
});

test('running the same recharge for anyone else does NOT grant credits', async () => {
  const fake = fakeSupabase();
  const before = process.env.CREDITS_ALLOW_SELF_SERVE;
  delete process.env.CREDITS_ALLOW_SELF_SERVE;
  try {
    const out = await credits.createOrder(
      { user_id: 'u2', email: 'someone.else@example.com' },
      { pack_key: PACK, workspace_id: 'ws1' },
    );
    expect(out.credited).toBe(false);
    expect(out.status).toBe('pending');
    expect(out.comp).toBeUndefined();
    // The decisive one: nothing was fulfilled for a non-comp account.
    expect(fake.calls.some((c) => /credit_fulfil_order/.test(c.url)),
      'a non-comp account was granted credits for free').toBe(false);
  } finally {
    fake.restore();
    if (before === undefined) delete process.env.CREDITS_ALLOW_SELF_SERVE;
    else process.env.CREDITS_ALLOW_SELF_SERVE = before;
  }
});

test('an address supplied by the caller cannot buy a free recharge', async () => {
  // isCompAccount reads auth.email, which requireUser sets from Supabase's own
  // user endpoint. This proves the request body is not a second door: a comp
  // address in the body, with a different verified email, still pays.
  const fake = fakeSupabase();
  const before = process.env.CREDITS_ALLOW_SELF_SERVE;
  delete process.env.CREDITS_ALLOW_SELF_SERVE;
  try {
    const out = await credits.createOrder(
      { user_id: 'u3', email: 'attacker@example.com' },
      { pack_key: PACK, workspace_id: 'ws1', email: 'anchit.tandon@gmail.com' },
    );
    expect(out.credited).toBe(false);
    expect(fake.calls.some((c) => /credit_fulfil_order/.test(c.url))).toBe(false);
  } finally {
    fake.restore();
    if (before === undefined) delete process.env.CREDITS_ALLOW_SELF_SERVE;
    else process.env.CREDITS_ALLOW_SELF_SERVE = before;
  }
});

test('every comp address in the list actually recharges free', async () => {
  // Runs the real path once per address rather than trusting one sample.
  for (const email of [
    'anchit.tandon@gmail.com',
    `anchit.tandon@${['vah', 'dam'].join('')}.com`,
    'anchit.tandon2803@gmail.com',
  ]) {
    const fake = fakeSupabase();
    try {
      const out = await credits.createOrder({ user_id: 'u', email }, { pack_key: PACK });
      expect(out.comp, `${email} did not recharge free`).toBe(true);
      expect(out.credited).toBe(true);
    } finally { fake.restore(); }
  }
});

/* ═══ an unpriced pack cannot be ordered ══════════════════════════════════ */

test('a pack with no price refuses the order and writes no row', async () => {
  const fake = fakeSupabase();
  delete process.env.CREDIT_PACK_PRICES;          // an unpriced deployment
  const before = process.env.CREDITS_ALLOW_SELF_SERVE;
  delete process.env.CREDITS_ALLOW_SELF_SERVE;
  try {
    let threw = null;
    try {
      await credits.createOrder(
        { user_id: 'u9', email: 'someone.else@example.com' },
        { pack_key: PACK, workspace_id: 'ws1' },
      );
    } catch (e) { threw = e; }

    expect(threw, 'an unpriced pack was ordered anyway').toBeTruthy();
    expect(threw.status).toBe(409);
    expect(threw.message).toContain('DATA REQUIRED BEFORE LAUNCH');
    // The decisive part, and the reason the guard sits ABOVE the insert: no
    // order row exists. A pending order at a null price is a purchase nobody
    // can settle and a user who believes they bought something.
    expect(fake.calls.some((c) => /\/rest\/v1\/credit_orders/.test(c.url) && c.method === 'POST'),
      'an order row was written for a pack with no price').toBe(false);
    expect(fake.calls.some((c) => /credit_fulfil_order/.test(c.url))).toBe(false);
  } finally {
    fake.restore();
    if (before === undefined) delete process.env.CREDITS_ALLOW_SELF_SERVE;
    else process.env.CREDITS_ALLOW_SELF_SERVE = before;
  }
});

test('a complimentary account is not blocked by an unset price', async () => {
  // The price is not this account's concern — it is charged nothing either way.
  // Blocking it here would be the pricing fix breaking the one account it was
  // never about.
  const fake = fakeSupabase();
  delete process.env.CREDIT_PACK_PRICES;
  try {
    const out = await credits.createOrder(
      { user_id: 'u1', email: 'anchit.tandon@gmail.com' },
      { pack_key: PACK, workspace_id: 'ws1' },
    );
    expect(out.comp).toBe(true);
    expect(out.credited).toBe(true);
    const row = fake.calls.find((c) => /\/rest\/v1\/credit_orders/.test(c.url) && c.method === 'POST');
    expect(row, 'no order row was written for the comp grant').toBeTruthy();
    // Genuinely zero, not "unknown": this account was charged nothing.
    expect(row.body[0].amount_minor).toBe(0);
  } finally { fake.restore(); }
});
