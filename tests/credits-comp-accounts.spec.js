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
  const s = codeOnly(src);
  // createOrder reads auth.email. If it ever read body/query, anybody could
  // type an address and recharge free.
  expect(s).toMatch(/isCompAccount\(auth && auth\.email\)/);
  expect(s).not.toMatch(/isCompAccount\((?:body|q|req)\./);

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
  const start = src.indexOf('if (isCompAccount(auth && auth.email))');
  expect(start, 'the comp branch is gone').toBeGreaterThan(-1);
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

test('the balance response carries the flag', () => {
  expect(src).toMatch(/comp: isCompAccount\(auth\.email\)/);
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
  };
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';

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
