/**
 * Phone accounts live in Supabase Auth (2026-10-03).
 * ---------------------------------------------------------------------------
 * The operator's words: "use supabase cli and remote host for supabase account
 * creation", then "All features must work even with signin by number and pin".
 *
 * A mobile number + 4-digit PIN sign-up creates a real auth.users row in a
 * hosted Supabase project, and sign-in gives the browser a real Supabase
 * session - so requireUser(), restAs(), RLS-backed workspaces, credits and the
 * agents see a person. Everything below is EXECUTED:
 *
 *   A. The shipped entry point api/public-config.js?action=auth, with
 *      `global.fetch` replaced by tests/supabase-auth-fake.js - a fake of the
 *      exact GoTrue and PostgREST endpoints the code calls, each modelled on
 *      its documentation, which THROWS on anything else. The PIN functions in
 *      the fake mirror the migration statement for statement and answer only
 *      the service role.
 *   B. The gates the session has to pass: brand-workspace-core.requireUser(),
 *      the credit meter and its handler, brand-runtime.
 *   C. The real pages in Chromium, served from 127.0.0.1, with /api/public-config
 *      answered by the SHIPPED handler in this process and the browser's own
 *      calls to the auth service (the refresh, the health probe) answered by
 *      the same fake through page.route.
 *
 * Run: npx playwright test tests/supabase-phone-accounts.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createFake } = require('./supabase-auth-fake.js');

const ROOT = path.resolve(__dirname, '..');
const MODS = [
  '../api/public-config.js', '../api/_shared/mobile-auth-core.js', '../api/_shared/mobile-auth-supabase.js',
  '../api/_shared/brand-workspace-core.js', '../api/_shared/credits-core.js', '../api/_shared/brand-runtime.js',
].map((m) => require.resolve(m));
const ENV_KEYS = [
  'DATABASE_URL', 'NEON_DATABASE_URL', 'POSTGRES_URL',
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY',
  'MOBILE_PIN_PEPPER', 'MOBILE_PIN_PEPPER_PREVIOUS', 'CREDITS_COMP_PHONES', 'CREDITS_COMP_ACCOUNTS', 'CRON_SECRET',
];
const PEPPER = 'pepper-for-tests-only-' + 'k'.repeat(24);
const PIN = '4831';
const PHONE = '9876543210';
const E164 = '+919876543210';

let realFetch;
const saved = {};
test.beforeEach(() => {
  realFetch = global.fetch;
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const m of MODS) delete require.cache[m];
});
test.afterEach(() => {
  global.fetch = realFetch;
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  for (const m of MODS) delete require.cache[m];
});

/** A fake project, wired in: env + global.fetch. */
function project(extraEnv) {
  const f = createFake();
  Object.assign(process.env, { SUPABASE_URL: f.url, SUPABASE_ANON_KEY: f.anonKey, SUPABASE_SERVICE_ROLE_KEY: f.serviceKey, MOBILE_PIN_PEPPER: PEPPER }, extraEnv || {});
  for (const [k, v] of Object.entries(extraEnv || {})) if (v === undefined) delete process.env[k];
  global.fetch = f.fetch();
  return f;
}

/** The shipped handler, called the way Vercel calls it. */
function auth(op, body, headers) {
  const handler = require('../api/public-config.js');
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; }, removeHeader() {}, getHeader(k) { return this.headers[k]; },
      status(c) { this.statusCode = c; return this; },
      json(j) { resolve({ status: this.statusCode, body: j }); return this; },
      end() { resolve({ status: this.statusCode, body: null }); return this; },
    };
    Promise.resolve(handler({
      method: body ? 'POST' : 'GET', query: { action: 'auth', op },
      headers: Object.assign({ 'x-forwarded-for': '203.0.113.7' }, headers || {}), body: body || undefined,
    }, res)).catch(reject);
  });
}
const bearer = (t) => ({ authorization: 'Bearer ' + t });
async function signUp(f, phone, name, pin) {
  const r = await auth('enter', { phone: phone || PHONE, cc: '+91', name: name || 'Ravi', pin: pin || PIN });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

/* ═══════════════════════════════════════════════════════════════════════════
   A. THE AUTH OPS, THROUGH THE SHIPPED HANDLER
   ═══════════════════════════════════════════════════════════════════════════ */

test('status precedence: a Supabase project that answers outranks Neon, which outranks the device; a configured project that does not answer is SAID', async () => {
  // 1. Supabase answers - even with a Neon URL set, it wins (and Neon is never asked).
  let f = project({ DATABASE_URL: 'postgres://u:p@ep-fixture.neon.tech/db' });
  let r = await auth('status');
  expect(r.body).toMatchObject({ ok: true, mode: 'supabase', host: new URL(f.url).hostname, pin_ready: true });
  expect(f.calls.map((c) => c.path)).toEqual(['/auth/v1/health']);

  // 2. Configured but its auth service is unhealthy, with a Neon store that answers: server, and the project is named.
  const core = require('../api/_shared/mobile-auth-core.js');
  f.healthy = false;
  const neon = async (strings) => { if (strings.join('').trim() === 'select 1') return [{ '?column?': 1 }]; throw new Error('unexpected: ' + strings.join('$')); };
  let st = await core.status({ sql: neon, fresh: true });
  expect(st).toMatchObject({ mode: 'server', supabase: { configured: true, reachable: false, host: new URL(f.url).hostname } });
  expect(st.message).toMatch(/account service \(lifecycle-os-fake\.supabase\.test\) is not answering/);

  // 3. Configured, nothing answers at all, no Neon URL: device (#115's standalone path), project named.
  delete process.env.DATABASE_URL;
  f.down = true;
  st = await core.status({ fresh: true });
  expect(st).toMatchObject({ mode: 'device', reason: 'no_database_url', supabase: { reachable: false } });

  // 4. Not configured at all: exactly the device answer from before this change, and nothing is fetched.
  for (const m of MODS) delete require.cache[m];
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  f = createFake(); global.fetch = f.fetch();
  r = await auth('status');
  expect(r.body).toMatchObject({ ok: true, mode: 'device', reason: 'no_database_url' });
  expect(r.body.supabase).toBeUndefined();
  expect(f.calls).toEqual([]);
});

test('sign-up creates the auth user with the trusted phone marker in app_metadata, and the raw PIN is never sent anywhere or stored', async () => {
  const f = project();
  const first = await auth('enter', { phone: PHONE, cc: '+91' });
  expect(first.body).toMatchObject({ ok: true, exists: false });
  expect(f.gotrueCalls(), 'a number-only step reached the auth service').toEqual([]);

  const r = await signUp(f);
  expect(r).toMatchObject({ ok: true, created: true, mode: 'supabase', user: { name: 'Ravi', phone: E164 } });
  expect(r.token.split('.').length, 'the session token is a Supabase JWT').toBe(3);
  expect(typeof r.refresh_token).toBe('string');
  expect(r.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));

  const create = f.calls.filter((c) => c.path === '/auth/v1/admin/users');
  expect(create.length).toBe(1);
  const sent = JSON.parse(create[0].body);
  expect(create[0].headers.apikey, 'the admin call is made with the server key').toBe(f.serviceKey);
  expect(sent).toMatchObject({ phone: E164, phone_confirm: true, app_metadata: { lifecycle_account: 'mobile-pin', phone_e164: E164 }, user_metadata: { name: 'Ravi' } });
  expect(sent.user_metadata.lifecycle_account, 'the marker must live where only the service role writes').toBeUndefined();
  // The password is DERIVED: 47 characters, never the PIN, never derivable without the pepper.
  expect(sent.password).toMatch(/^Pn1\.[A-Za-z0-9_-]{43}$/);
  const supa = require('../api/_shared/mobile-auth-supabase.js');
  expect(sent.password).toBe(supa.derivePassword(PEPPER, E164, PIN));
  expect(sent.password).not.toBe(supa.derivePassword('another-pepper-of-sufficient-length-xx', E164, PIN));

  // The PIN never left this process: not as a value in any body, query or header,
  // and not in anything the project holds.
  const everything = f.everything();
  expect(everything.includes('"' + PIN + '"'), 'the PIN appeared as a value').toBe(false);
  expect(everything.includes('pin=' + PIN) || everything.includes(':' + PIN + ','), 'the PIN appeared in a query or field').toBe(false);
  const user = f.userByPhone(E164);
  expect(user.app_metadata).toMatchObject({ lifecycle_account: 'mobile-pin', phone_e164: E164 });
  expect(f.tables.mobile_pin_accounts.get(E164)).toMatchObject({ user_id: user.id, name: 'Ravi', pin_tries: 0 });
  expect(Object.keys(f.tables.mobile_pin_accounts.get(E164)).some((k) => /pin_hash|pin_salt|^pin$/.test(k)), 'a PIN or hash of one was stored').toBe(false);
});

test('sign-in yields a session requireUser() accepts as provider mobile-pin, mode supabase; a marker in user_metadata is NOT trusted', async () => {
  const f = project();
  await signUp(f);
  const known = await auth('enter', { phone: PHONE, cc: '+91' });
  expect(known.body).toMatchObject({ ok: true, exists: true, needPin: true, name: 'Ravi' });
  const r = await auth('enter', { phone: PHONE, cc: '+91', pin: PIN });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ ok: true, created: false, mode: 'supabase' });

  const core = require('../api/_shared/brand-workspace-core.js');
  const a = await core.requireUser({ headers: Object.assign(bearer(r.body.token), { 'x-lifecycle-token': r.body.token }) });
  expect(a).toMatchObject({ ok: true, provider: 'mobile-pin', mode: 'supabase', phone: E164, name: 'Ravi', user_id: f.userByPhone(E164).id, email: '' });

  const me = await auth('me', null, bearer(r.body.token));
  expect(me.body).toMatchObject({ ok: true, mode: 'supabase', user: { phone: E164, name: 'Ravi' } });

  // Somebody who writes the marker into user_metadata (which a user CAN edit)
  // is not a phone account, and keeps the email rules.
  const forger = f.handle('POST', f.url + '/auth/v1/admin/users', { apikey: f.serviceKey, authorization: 'Bearer ' + f.serviceKey },
    JSON.stringify({ email: 'someone@example.org', password: 'a-long-password', user_metadata: { lifecycle_account: 'mobile-pin', phone_e164: '+919999999999' } }));
  expect(forger.status).toBe(200);
  const sid = 'sess-forger';
  f.sessions.set(sid, { user_id: forger.body.id, revoked: false });
  const tok = 'eyJ.forger.' + 'x'.repeat(20);
  f.access.set(tok, { session_id: sid, user_id: forger.body.id, exp: Math.floor(Date.now() / 1000) + 600 });
  for (const m of MODS) delete require.cache[m];
  const b = await require('../api/_shared/brand-workspace-core.js').requireUser({ headers: bearer(tok) });
  expect(b.ok).toBe(true);
  expect(b.provider).toBeUndefined();
  expect(b.email).toBe('someone@example.org');
});

test('wrong PINs count down 4, 3, 2, 1, then lock for fifteen minutes; while locked the right PIN is refused WITHOUT asking the auth service', async () => {
  const f = project();
  await signUp(f);
  const lefts = [];
  for (let i = 0; i < 4; i++) {
    const r = await auth('enter', { phone: PHONE, cc: '+91', pin: '5926' });
    expect(r.status).toBe(401);
    lefts.push(r.body.left);
    expect(r.body.message).toBe('That PIN is not right. ' + r.body.left + ' ' + (r.body.left === 1 ? 'try' : 'tries') + ' left.');
  }
  expect(lefts).toEqual([4, 3, 2, 1]);
  const fifth = await auth('enter', { phone: PHONE, cc: '+91', pin: '5926' });
  expect(fifth.status).toBe(429);
  expect(fifth.body).toMatchObject({ locked: true, error: 'pin_locked' });
  expect(fifth.body.message).toMatch(/Try again in 1[45] minutes/);

  const grantsBefore = f.grants().length;
  const locked = await auth('enter', { phone: PHONE, cc: '+91', pin: PIN });
  expect(locked.status).toBe(429);
  expect(f.grants().length, 'a locked account still reached the password grant').toBe(grantsBefore);

  // The lock runs out: the right PIN opens it and the count starts again.
  f.tables.mobile_pin_accounts.get(E164).locked_until = Date.now() - 1000;
  const after = await auth('enter', { phone: PHONE, cc: '+91', pin: PIN });
  expect(after.status).toBe(200);
  expect(f.tables.mobile_pin_accounts.get(E164)).toMatchObject({ pin_tries: 0, locked_until: null });
});

test('a refusal the auth service words differently still COUNTS against the PIN; only busy, down or misconfigured hands the try back', async () => {
  const f = project();
  await signUp(f);
  // A code this module has never heard of (the service adds or renames one):
  // refunding it would hand a guesser unlimited tries.
  f.config.wrongPasswordCode = 'some_future_code';
  const r = await auth('enter', { phone: PHONE, cc: '+91', pin: '5926' });
  expect(r.status).toBe(401);
  expect(r.body.left).toBe(4);
  expect(f.tables.mobile_pin_accounts.get(E164).pin_tries).toBe(1);
  // The service asking us to slow down is NOT a wrong PIN: the try comes back.
  f.config.wrongPasswordCode = 'invalid_credentials';
  const real = f.handle;
  f.handle = (m, u, h, b) => (/grant_type=password/.test(u) ? { status: 429, body: { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' } } : real(m, u, h, b));
  const busy = await auth('enter', { phone: PHONE, cc: '+91', pin: '5926' });
  expect(busy.status).toBe(429);
  expect(busy.body.error).toBe('auth_service_busy');
  expect(f.tables.mobile_pin_accounts.get(E164).pin_tries, 'a 429 from the auth service was counted as a wrong PIN').toBe(1);
  f.handle = real;
});

test('twenty wrong PINs sent AT ONCE: at most five reach the password grant, and the account locks', async () => {
  const f = project();
  await signUp(f);
  const before = f.grants().length;
  const out = await Promise.all(Array.from({ length: 20 }, (_, i) => auth('enter', { phone: PHONE, cc: '+91', pin: String(5000 + i * 7).padStart(4, '0') }, { 'x-forwarded-for': '198.51.100.' + i })));
  const evaluated = f.grants().length - before;
  expect(evaluated, 'more guesses were evaluated than the lockout allows').toBeLessThanOrEqual(5);
  expect(out.filter((r) => r.status === 200).length).toBe(0);
  expect(out.filter((r) => r.status === 429 && r.body.locked).length).toBeGreaterThanOrEqual(15);
  const row = f.tables.mobile_pin_accounts.get(E164);
  expect(row.locked_until).toBeGreaterThan(Date.now());
});

test('a weak PIN, a straight run, a short PIN and a bad number are refused before any call to the auth service', async () => {
  const f = project();
  for (const pin of ['1234', '0000', '3456', '9876', '12', '12a4']) {
    const r = await auth('enter', { phone: PHONE, cc: '+91', name: 'Ravi', pin });
    expect(r.body, pin).toMatchObject({ ok: true, exists: false, needPin: true, error: 'pin_invalid' });
  }
  for (const [phone, cc] of [['12345', '+91'], ['5876543210', '+91'], ['1234567890', '+1']]) {
    const r = await auth('enter', { phone, cc, name: 'Ravi', pin: PIN });
    expect(r.status, phone).toBe(400);
    expect(r.body.error).toBe('phone_invalid');
  }
  expect(f.gotrueCalls(), 'a refused PIN or number reached the auth service').toEqual([]);
  expect(f.users.size).toBe(0);
});

test('missing or short MOBILE_PIN_PEPPER fails CLOSED: enter refuses with a sentence and nothing at all is sent', async () => {
  for (const pepper of [undefined, 'too-short']) {
    for (const m of MODS) delete require.cache[m];
    const f = project({ MOBILE_PIN_PEPPER: pepper });
    const status = await auth('status');
    expect(status.body).toMatchObject({ mode: 'supabase', pin_ready: false });
    const before = f.calls.length;
    for (const body of [{ phone: PHONE, cc: '+91' }, { phone: PHONE, cc: '+91', name: 'Ravi', pin: PIN }]) {
      const r = await auth('enter', body);
      expect(r.status).toBe(503);
      expect(r.body.error).toBe('pin_pepper_missing');
      expect(r.body.message).toMatch(/MOBILE_PIN_PEPPER/);
    }
    expect(f.calls.length - before, 'a request left with no pepper').toBe(0);
    expect(f.users.size).toBe(0);
  }
});

test('sign-out REVOKES the session on the auth service: op=me and requireUser refuse the old token; sign-out everywhere ends every session', async () => {
  const f = project();
  const a = await signUp(f);
  const b = (await auth('enter', { phone: PHONE, cc: '+91', pin: PIN })).body;
  const out = await auth('signout', { op: 'signout' }, bearer(a.token));
  expect(out.body).toMatchObject({ ok: true, signed_out: true, scope: 'local' });
  const logout = f.calls.filter((c) => c.path === '/auth/v1/logout');
  expect(logout.length).toBe(1);
  expect(logout[0].query).toBe('?scope=local');
  expect(logout[0].headers.authorization).toBe('Bearer ' + a.token);

  expect((await auth('me', null, bearer(a.token))).status).toBe(401);
  for (const m of MODS) delete require.cache[m];
  const gone = await require('../api/_shared/brand-workspace-core.js').requireUser({ headers: bearer(a.token) });
  expect(gone).toMatchObject({ ok: false, status: 401 });
  // The other session is untouched by a local sign-out...
  expect((await auth('me', null, bearer(b.token))).status).toBe(200);
  // ...and its refresh token is dead after sign-out-everywhere.
  const all = await auth('signout_all', { op: 'signout_all' }, bearer(b.token));
  expect(all.body).toMatchObject({ ok: true, signed_out_all: true });
  expect((await auth('me', null, bearer(b.token))).status).toBe(401);
  const rf = f.handle('POST', f.url + '/auth/v1/token?grant_type=refresh_token', { apikey: f.anonKey }, JSON.stringify({ refresh_token: b.refresh_token }));
  expect(rf.status).toBe(400);
});

test('a refreshed access token is a session requireUser accepts; a refresh token works ONCE', async () => {
  const f = project();
  const a = await signUp(f);
  // The call auth.js makes, as the browser makes it (anon key, JSON body).
  const r1 = f.handle('POST', f.url + '/auth/v1/token?grant_type=refresh_token', { apikey: f.anonKey, 'content-type': 'application/json' }, JSON.stringify({ refresh_token: a.refresh_token }));
  expect(r1.status).toBe(200);
  expect(r1.body.access_token).not.toBe(a.token);
  const core = require('../api/_shared/brand-workspace-core.js');
  expect(await core.requireUser({ headers: bearer(r1.body.access_token) })).toMatchObject({ ok: true, provider: 'mobile-pin', phone: E164 });
  const again = f.handle('POST', f.url + '/auth/v1/token?grant_type=refresh_token', { apikey: f.anonKey }, JSON.stringify({ refresh_token: a.refresh_token }));
  expect(again.body.error_code).toBe('refresh_token_already_used');
});

test('two first sign-ups for one number at once: one account, and the loser is held to the PIN check - never handed the winner\'s session', async () => {
  const f = project();
  const [x, y] = await Promise.all([
    auth('enter', { phone: PHONE, cc: '+91', name: 'Ravi', pin: PIN }),
    auth('enter', { phone: PHONE, cc: '+91', name: 'Mallory', pin: '7350' }),
  ]);
  expect(f.users.size).toBe(1);
  const winners = [x, y].filter((r) => r.status === 200 && r.body.token);
  expect(winners.length).toBe(1);
  const loser = winners[0] === x ? y : x;
  expect(loser.body.token).toBeUndefined();
  expect([401, 409]).toContain(loser.status);
});

test('a device-shaped token is REFUSED while the project answers (no unmetered side door), and admitted again as #115\'s device principal once it does not', async () => {
  const f = project();
  const deviceToken = 'd'.repeat(43);
  const headers = { 'x-lifecycle-token': deviceToken, authorization: 'Bearer ' + deviceToken, origin: 'http://127.0.0.1' };
  let a = await require('../api/_shared/brand-workspace-core.js').requireUser({ headers });
  expect(a).toMatchObject({ ok: false, status: 401, mobile_reason: 'supabase_mode' });
  for (const m of MODS) delete require.cache[m];
  f.down = true;
  a = await require('../api/_shared/brand-workspace-core.js').requireUser({ headers });
  expect(a).toMatchObject({ ok: true, mode: 'device', provider: 'mobile-pin' });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B. CREDITS AND WORKSPACES FOR A SUPABASE PHONE ACCOUNT
   ═══════════════════════════════════════════════════════════════════════════ */

function credits(op, headers, body) {
  const handler = require('../api/public-config.js');
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, removeHeader() {}, status(c) { this.statusCode = c; return this; }, json(j) { resolve({ status: this.statusCode, body: j }); return this; }, end() { resolve({ status: this.statusCode }); } };
    handler({ method: body ? 'POST' : 'GET', query: { action: 'credits', op }, headers, body }, res);
  });
}

test('credits keep the phone rules: an UNLISTED number has no wallet and no welcome grant, even with no Neon database; a metered run is refused before any wallet is touched', async () => {
  const f = project();
  const s = await signUp(f);
  const creditsCore = require('../api/_shared/credits-core.js');
  const req = { headers: bearer(s.token), query: {}, body: {} };
  const m = await creditsCore.meter(req, 'calendar.generate');
  expect(m).toMatchObject({ ok: false, status: 403, error: 'credits_require_account' });
  expect(m.unmetered, 'a Supabase phone account ran UNMETERED because DATABASE_URL is unset').toBeUndefined();
  const bal = await credits('balance', bearer(s.token));
  expect(bal.body).toMatchObject({ ok: true, wallet: null, unavailable: 'mobile_account' });
  const walletCalls = f.calls.filter((c) => /\/rest\/v1\/(credit_wallets|credit_ledger|rpc\/credit_)/.test(c.path));
  expect(walletCalls, 'a wallet was touched for an unlisted number').toEqual([]);
  expect(f.tables.credit_wallets).toEqual([]);
  expect(require('../api/_shared/credits-core.js').spenderRefusal(await require('../api/_shared/brand-workspace-core.js').requireUser(req))).toMatchObject({ error: 'credits_require_account' });
});

test('credits keep the phone rules: a number in CREDITS_COMP_PHONES holds ONE personal wallet keyed to its Supabase user, is metered on it, and recharges free', async () => {
  const f = project({ CREDITS_COMP_PHONES: '+91 98765-43210' });
  const s = await signUp(f);
  const uid = f.userByPhone(E164).id;
  const bal = await credits('balance', bearer(s.token));
  expect(bal.status).toBe(200);
  expect(bal.body).toMatchObject({ ok: true, comp: true, account: 'mobile-pin', wallet: { workspace_id: null } });
  expect(f.tables.credit_wallets).toHaveLength(1);
  expect(f.tables.credit_wallets[0]).toMatchObject({ user_id: uid, workspace_id: null });
  const rech = await credits('recharge', bearer(s.token), { pack_key: require('../api/_shared/credit-catalog.js').packList(null)[0].key });
  expect(rech.status, JSON.stringify(rech.body)).toBe(200);
  expect(rech.body).toMatchObject({ comp: true });
  const order = f.tables.credit_orders[0];
  expect(order).toMatchObject({ user_id: uid, workspace_id: null, amount_minor: 0, status: 'paid', provider: 'comp_account', provider_ref: 'comp:' + E164 });
  const m = await require('../api/_shared/credits-core.js').meter({ headers: bearer(s.token), query: {}, body: {} }, 'calendar.generate');
  expect(m).toMatchObject({ ok: true, free: false });
  expect(m.hold_id).toBeTruthy();
  await m.release('test');
});

test('an email account keeps the email rules beside phone accounts: its complimentary status is by address, never by a phone list', async () => {
  const f = project({ CREDITS_COMP_ACCOUNTS: 'operator@example.org', CREDITS_COMP_PHONES: E164 });
  const made = f.handle('POST', f.url + '/auth/v1/admin/users', { apikey: f.serviceKey, authorization: 'Bearer ' + f.serviceKey }, JSON.stringify({ email: 'operator@example.org', password: 'a-long-password', email_confirm: true }));
  f.sessions.set('s-op', { user_id: made.body.id, revoked: false });
  const tok = 'eyJ.op.' + 'y'.repeat(20);
  f.access.set(tok, { session_id: 's-op', user_id: made.body.id, exp: Math.floor(Date.now() / 1000) + 600 });
  const a = await require('../api/_shared/brand-workspace-core.js').requireUser({ headers: bearer(tok) });
  expect(a).toMatchObject({ ok: true, email: 'operator@example.org', mode: 'supabase' });
  expect(a.provider).toBeUndefined();
  const c = require('../api/_shared/credits-core.js');
  expect(c.isCompAuth(a)).toBe(true);
  expect(c.isCompAuth(Object.assign({}, a, { email: 'other@example.org' }))).toBe(false);
});

test('a Supabase phone account has WORKSPACES: saving a brand writes brand_workspaces as that user, and brand-runtime resolves it instead of the device placeholder', async () => {
  const f = project();
  const s = await signUp(f);
  const uid = f.userByPhone(E164).id;
  const handler = require('../api/public-config.js');
  const brandOp = (op, body) => new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, removeHeader() {}, status(c) { this.statusCode = c; return this; }, json(j) { resolve({ status: this.statusCode, body: j }); return this; } };
    handler({ method: body ? 'POST' : 'GET', query: { action: 'brand', op }, headers: bearer(s.token), body }, res);
  });
  const saved = await brandOp('save', { brand: { name: 'Ravi Kicks', palette: { primary: '#2f6fdf', accent: '#c2410c', ink: '#1f2937', surface: '#ffffff' } } });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(f.tables.brand_workspaces).toHaveLength(1);
  expect(f.tables.brand_workspaces[0]).toMatchObject({ owner_id: uid, name: 'Ravi Kicks' });
  expect(f.tables.brand_user_prefs.get(uid)).toMatchObject({ active_workspace_id: f.tables.brand_workspaces[0].id });
  const list = await brandOp('list');
  expect(list.body.workspaces.map((w) => w.name)).toEqual(['Ravi Kicks']);
  const brand = await require('../api/_shared/brand-runtime.js').resolve({ headers: bearer(s.token), query: {}, body: {} });
  expect(brand.name).toBe('Ravi Kicks');
});

/* ═══════════════════════════════════════════════════════════════════════════
   C. THE REAL PAGES, IN CHROMIUM, AGAINST THE SHIPPED HANDLER AND THE FAKE
   ═══════════════════════════════════════════════════════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

/** Static files from the repo, and /api/public-config answered by the SHIPPED handler in this process. */
function appServer(log) {
  const handler = () => require('../api/public-config.js');
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const text = Buffer.concat(chunks).toString('utf8');
      let body; try { body = text ? JSON.parse(text) : undefined; } catch (_) { body = undefined; }
      const query = {}; u.searchParams.forEach((v, k) => { query[k] = v; });
      const entry = { path: u.pathname, query, authorization: req.headers.authorization || '', token: req.headers['x-lifecycle-token'] || '', referer: req.headers.referer || '' };
      log.push(entry);
      if (u.pathname !== '/api/public-config') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
      const shim = {
        statusCode: 200,
        setHeader: (k, v) => res.setHeader(k, v), removeHeader: (k) => res.removeHeader(k), getHeader: (k) => res.getHeader(k),
        status(c) { this.statusCode = c; return this; },
        json(j) { res.statusCode = this.statusCode; res.setHeader('Content-Type', 'application/json'); entry.status = this.statusCode; res.end(JSON.stringify(j)); return this; },
        end(x) { res.statusCode = this.statusCode; res.end(x); return this; },
        send(x) { res.statusCode = this.statusCode; res.end(typeof x === 'string' ? x : JSON.stringify(x)); return this; },
      };
      try { await handler()(Object.assign(req, { query, body }), shim); }
      catch (e) { if (!res.writableEnded) { res.statusCode = 500; res.end(JSON.stringify({ harness_error: String(e && e.message) })); } }
      return;
    }
    const file = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

async function wire(page, f, log) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss().catch(() => {}); });
  await page.addInitScript(() => {
    // The supabase-js CDN is not reachable here: a stand-in that records what
    // the page hands it (setSession) and is otherwise anonymous.
    window.__SET_SESSION__ = [];
    window.__SIGNOUT__ = [];
    window.__OAUTH_CALLS__ = [];
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          setSession: async (s) => { window.__SET_SESSION__.push(s); return { data: { session: s }, error: null }; },
          signInWithOAuth: async (x) => { window.__OAUTH_CALLS__.push(x); return { error: null }; },
          signOut: async (o) => { window.__SIGNOUT__.push(o || null); return {}; },
        },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      }),
    };
  });
  // The browser's OWN calls to the auth service (the health probe, the refresh).
  await page.route((url) => url.href.startsWith(f.url + '/'), async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    log.push({ browser: true, url: req.url(), method: req.method(), headers: req.headers(), body: req.postData() || '' });
    // Knobs for the renewal: `browserRefreshFault` makes it unreachable (a
    // network failure, or a status such as 503 / 429), `browserRefreshDelayMs`
    // holds the ANSWER back (the request is handled on arrival, as a server
    // would) so two tabs can be made to spend one refresh token at once.
    if (/grant_type=refresh_token/.test(req.url())) {
      const fault = f.browserRefreshFault;
      if (fault === 'abort') return route.abort('failed');
      if (typeof fault === 'number') return route.fulfill({ status: fault, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: fault, error_code: fault === 429 ? 'over_request_rate_limit' : 'unexpected_failure', msg: 'unavailable' }) });
      const r0 = f.handle(req.method(), req.url(), req.headers(), req.postData() || '');
      if (f.browserRefreshDelayMs) await new Promise((res) => setTimeout(res, f.browserRefreshDelayMs));
      return route.fulfill({ status: r0.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r0.body == null ? '' : JSON.stringify(r0.body) });
    }
    const r = f.handle(req.method(), req.url(), req.headers(), req.postData() || '');
    return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.body == null ? '' : JSON.stringify(r.body) });
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    if (url.startsWith(f.url + '/')) return route.fallback();
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(url);
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});' : 'window.tailwind=window.tailwind||{};window.Papa=window.Papa||{parse(){}};' });
  });
  return errors;
}

const readState = (page) => page.evaluate(() => {
  const a = window.LifecycleAuth || {};
  let stored = null; try { stored = JSON.parse(localStorage.getItem('lifecycle.auth.session') || 'null'); } catch (_) {}
  let st = null; try { st = window.BrandContext && window.BrandContext.storage ? window.BrandContext.storage() : null; } catch (_) {}
  return {
    name: (document.querySelector('#lifecycle-nav .lnav-uname') || {}).textContent || null,
    umode: (document.querySelector('#lnav-umode') || {}).textContent || null,
    session: a.session ? { provider: a.session.provider, mode: a.session.mode, token: a.session.access_token, verified: a.session.verified } : null,
    apiToken: typeof a.apiToken === 'function' ? a.apiToken() : null,
    internal: a.internal,
    stored,
    storage: st ? { mode: st.mode, sentence: st.account_sentence, serverOpen: st.server_open } : null,
    setSession: window.__SET_SESSION__ || [],
    signOuts: window.__SIGNOUT__ || [],
    signin: !!document.querySelector('#lnav-signin'),
    oauth: (window.__OAUTH_CALLS__ || []).length,
  };
});

test('SUPABASE MODE IN THE BROWSER: sign up in the rail, the session survives a reload and another page, onboarding saves the brand to the ACCOUNT, Read my site sends the Supabase token, the access token is refreshed, sign-out revokes it', async ({ page }) => {
  test.setTimeout(180_000);
  const f = project();
  const log = [];
  const srv = appServer(log);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const errors = await wire(page, f, log);
    await page.goto(base + '/onboarding.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending'), null, { timeout: 20000 });

    // Sign up through the rail's panel - the same panel and state machine as every other mode.
    const btn = page.locator('#lnav-signin');
    await btn.waitFor({ state: 'attached', timeout: 15000 });
    await btn.evaluate((el) => el.click());
    await page.waitForSelector('#lnav-mauth');
    await expect(page.locator('#lnav-mauth-mode')).toContainText('Account saved in the database (lifecycle-os-fake.supabase.test)', { timeout: 8000 });
    await page.selectOption('#lnav-mauth-cc', '+91');
    await page.fill('#lnav-mauth-phone', PHONE);
    await page.click('#lnav-mauth-go');
    await page.waitForSelector('#lnav-mauth[data-state="new"]');
    await page.fill('#lnav-mauth-name', 'Ravi');
    await page.fill('#lnav-mauth-pin', PIN);
    await page.click('#lnav-mauth-go');
    await page.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 10000 });

    const uid = f.userByPhone(E164).id;
    let s = await readState(page);
    expect(s.name).toBe('Ravi');
    expect(s.session).toMatchObject({ provider: 'mobile-pin', mode: 'supabase', verified: true });
    expect(s.session.token.split('.').length).toBe(3);
    expect(s.apiToken, 'apiToken() must be the Supabase access token').toBe(s.session.token);
    expect(s.stored).toMatchObject({ mode: 'supabase', user: { id: uid, phone: E164, name: 'Ravi' } });
    expect(typeof s.stored.refresh_token).toBe('string');
    expect(s.stored.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(JSON.stringify(s.stored).includes('"' + PIN + '"'), 'the PIN was kept in the browser').toBe(false);
    expect(s.internal).toBe(false);
    expect(s.oauth).toBe(0);
    expect(s.setSession.pop(), 'the supabase-js client was not given the session').toMatchObject({ access_token: s.session.token, refresh_token: s.stored.refresh_token });
    expect(s.umode).toMatch(/^Account saved in the database \(lifecycle-os-fake\.supabase\.test\); brands are saved to your account\.$/);

    // Onboarding saves to the ACCOUNT now: brand-context takes the server path.
    await page.waitForFunction(() => window.BrandContext && window.BrandContext.storage && window.BrandContext.storage().mode === 'server', null, { timeout: 10000 });
    s = await readState(page);
    expect(s.storage).toMatchObject({ mode: 'server', serverOpen: true, sentence: 'Signed in as Ravi · brands are saved to your account' });
    // The save's tail (making it the active brand) answers slowly here, as it
    // did on a loaded CI runner: the row exists before the response does.
    f.slow = { match: /brand_user_prefs|brand_competitors/, ms: 1500 };
    const nameInput = page.locator('input[data-path="name"]');
    await nameInput.waitFor({ timeout: 15000 });
    await nameInput.fill('Ravi Kicks');
    await page.locator('[data-go="next"]').first().click();
    await expect.poll(() => f.tables.brand_workspaces.length, { timeout: 10000 }).toBe(1);
    expect(f.tables.brand_workspaces[0]).toMatchObject({ owner_id: uid, name: 'Ravi Kicks' });
    const save = log.filter((l) => l.query && l.query.action === 'brand' && l.query.op === 'save').pop();
    expect(save.authorization).toBe('Bearer ' + s.session.token);
    // The row appears BEFORE the response finishes (CI, 2026-10-03: reading
    // the status at that moment read `undefined`). Wait for the answer itself.
    await expect.poll(() => save.status, { timeout: 15000 }).toBe(200);
    f.slow = null;
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys.filter((k) => /^lifecycle\.brand\.device\.workspaces/.test(k)), 'the brand was ALSO written to the device').toEqual([]);

    // Read my site sends the Supabase token, and the server knows who it is (not 401).
    await page.locator('[data-go="back"]').first().click();
    await page.waitForSelector('#xRun:not([disabled])', { timeout: 10000 });
    await page.fill('#xUrl', 'https://brand.example.org');
    await page.click('#xRun');
    await expect.poll(() => log.filter((l) => l.query && l.query.op === 'extract').length, { timeout: 15000 }).toBeGreaterThan(0);
    const extract = log.filter((l) => l.query && l.query.op === 'extract').pop();
    expect(extract.authorization).toBe('Bearer ' + s.session.token);
    await expect.poll(() => (log.filter((l) => l.query && l.query.op === 'extract').pop() || {}).status, { timeout: 30000 }).toBeDefined();
    expect(log.filter((l) => l.query && l.query.op === 'extract').pop().status, 'Read my site was refused as signed out').not.toBe(401);

    // A reload keeps the session, and op=me verifies it with the token.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.session && window.LifecycleAuth.session.verified === true, null, { timeout: 15000 });
    expect((await readState(page)).name).toBe('Ravi');
    const me = log.filter((l) => l.query && l.query.action === 'auth' && l.query.op === 'me').pop();
    expect(me.authorization).toBe('Bearer ' + s.session.token);
    expect(me.status).toBe(200);

    // Another page of the origin: the same person, with the same token on its API calls.
    await page.goto(base + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.session && window.LifecycleAuth.session.verified === true, null, { timeout: 15000 });
    s = await readState(page);
    expect(s.name).toBe('Ravi');
    expect(s.session.mode).toBe('supabase');

    // The access token is about to expire: the page renews it straight against
    // the auth service BEFORE asking op=me, and uses the new one from then on.
    const oldRefresh = s.stored.refresh_token;
    const oldToken = s.session.token;
    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('lifecycle.auth.session'));
      st.expires_at = Math.floor(Date.now() / 1000) + 20;
      localStorage.setItem('lifecycle.auth.session', JSON.stringify(st));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction((old) => window.LifecycleAuth && window.LifecycleAuth.session && window.LifecycleAuth.session.verified === true && window.LifecycleAuth.session.access_token !== old, oldToken, { timeout: 15000 });
    const refreshCall = log.filter((l) => l.browser && /grant_type=refresh_token/.test(l.url)).pop();
    expect(refreshCall, 'the page did not renew the session').toBeTruthy();
    expect(refreshCall.headers.apikey, 'the renewal is made with the PUBLIC anon key, never a server key').toBe(f.anonKey);
    expect(JSON.parse(refreshCall.body)).toEqual({ refresh_token: oldRefresh });
    s = await readState(page);
    expect(s.stored.refresh_token).not.toBe(oldRefresh);
    expect(s.apiToken).toBe(s.session.token);
    // op=me is asked AFTER the renewal, with the renewed token (the renewal
    // itself already proves the pair, so the page may show it first).
    await expect.poll(() => { const i = log.indexOf(refreshCall); return log.slice(i + 1).filter((l) => l.query && l.query.op === 'me').map((l) => l.authorization).pop() || ''; }, { timeout: 10000 })
      .toBe('Bearer ' + s.session.token);

    // Sign out: the server is told, the session is REVOKED at the auth service.
    const live = s.session.token;
    await page.locator('#lnav-signout').evaluate((el) => el.click());
    await page.waitForFunction(() => !!document.querySelector('#lnav-signin'), null, { timeout: 15000 });
    const out = log.filter((l) => l.query && l.query.op === 'signout').pop();
    expect(out.authorization).toBe('Bearer ' + live);
    expect(f.calls.filter((c) => c.path === '/auth/v1/logout').length).toBe(1);
    const check = f.handle('GET', f.url + '/auth/v1/user', { apikey: f.anonKey, authorization: 'Bearer ' + live }, '');
    expect(check.status, 'the access token still works after sign-out').toBe(403);
    expect((await readState(page)).stored).toBeNull();
    expect(errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e))).toEqual([]);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('a Supabase phone session whose project went away is KEPT and said, never shown a device sign-up as the same account', async ({ page }) => {
  test.setTimeout(90_000);
  const f = project();
  const s = await signUp(f);
  const log = [];
  const srv = appServer(log);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    await wire(page, f, log);
    await page.addInitScript((sess) => { localStorage.setItem('lifecycle.auth.session', JSON.stringify(sess)); }, {
      token: s.token, refresh_token: s.refresh_token, expires_at: s.expires_at, user: s.user, mode: 'supabase', expires: null, provider: 'mobile-pin',
      storage: { mode: 'supabase', host: new URL(f.url).hostname, message: '' },
    });
    f.down = true; f.healthy = false;
    await page.goto(base + '/onboarding.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.session && window.LifecycleAuth.session.verified === false, null, { timeout: 20000 });
    const st = await readState(page);
    expect(st.name).toBe('Ravi');
    expect(st.stored, 'a session was thrown away because the project did not answer').not.toBeNull();
    expect(st.umode).toMatch(/not answering right now/);
    expect(st.storage.mode, 'an unverifiable session wrote to an account it cannot reach').toBe('device');
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

/* ── review findings (2026-10-03): a renewal that could not be made is not a session that ended ── */

/** A page whose stored Supabase session is the one `s` (from signUp), with the app served by the shipped handler. */
async function openWithSession(page, f, log, base, s, extra) {
  await wire(page, f, log);
  await page.addInitScript((sess) => {
    if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('lifecycle.auth.session', JSON.stringify(sess)); sessionStorage.setItem('__seeded', '1'); }
  }, Object.assign({
    token: s.token, refresh_token: s.refresh_token, expires_at: s.expires_at, user: s.user, mode: 'supabase', expires: null, provider: 'mobile-pin',
    storage: { mode: 'supabase', host: new URL(f.url).hostname, message: '' },
  }, extra || {}));
}
const settled = async (page) => {
  try {
    await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending' && (window.LifecycleAuth.backend.supabase !== 'pending' || window.LifecycleAuth.backend.kind === 'signed-out'), null, { timeout: 20000 });
  } catch (e) {
    throw new Error(e.message + ' :: ' + JSON.stringify(await page.evaluate(() => ({ backend: window.LifecycleAuth && window.LifecycleAuth.backend, session: window.LifecycleAuth && window.LifecycleAuth.session, stored: localStorage.getItem('lifecycle.auth.session') }))));
  }
};

for (const fault of ['abort', 503, 429, 400]) {
  test('REVIEW P1 (' + fault + '): an access token that ran out while the renewal is UNREACHABLE keeps the session, says so, and renews it when the service is back - before and after op=me answers 401', async ({ page }) => {
    test.setTimeout(120_000);
    const f = project();
    const s = await signUp(f);
    const log = [];
    const srv = appServer(log);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + srv.address().port;
    try {
      // BEFORE: this browser's clock says the token has run out, and so does the service.
      f.access.get(s.token).exp = Math.floor(Date.now() / 1000) - 30;
      f.browserRefreshFault = fault;
      await page.clock.install();
      await openWithSession(page, f, log, base, s, { expires_at: Math.floor(Date.now() / 1000) - 30 });
      await page.goto(base + '/onboarding.html', { waitUntil: 'domcontentloaded' });
      await settled(page);
      let st = await readState(page);
      expect(st.stored, 'the session was thrown away because the renewal could not be MADE').not.toBeNull();
      expect(st.stored.refresh_token).toBe(s.refresh_token);
      expect(st.session).toMatchObject({ mode: 'supabase', verified: false });
      expect(st.name).toBe('Ravi');
      expect(st.umode).toMatch(/not answering right now/);
      expect(log.filter((l) => l.browser && /grant_type=refresh_token/.test(l.url)).length, 'no renewal was attempted').toBeGreaterThan(0);

      // The service comes back: the scheduled retry renews it and the page says so.
      f.browserRefreshFault = null;
      await page.clock.fastForward('03:00');
      await page.waitForFunction(() => window.LifecycleAuth.session && window.LifecycleAuth.session.verified === true, null, { timeout: 15000 });
      st = await readState(page);
      expect(st.stored.refresh_token).not.toBe(s.refresh_token);
      expect(st.umode).toMatch(/brands are saved to your account/);

      // AFTER: our clock thinks the token is fine, op=me answers 401 (the service
      // expired it), and the renewal is unreachable again: still kept.
      const cur = st.stored;
      f.access.get(cur.token).exp = Math.floor(Date.now() / 1000) - 5;
      f.browserRefreshFault = fault;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await settled(page);
      const me = log.filter((l) => l.query && l.query.op === 'me').pop();
      expect(me.status).toBe(401);
      st = await readState(page);
      expect(st.stored, 'a 401 from op=me plus an unreachable renewal cleared the session').not.toBeNull();
      expect(st.stored.refresh_token).toBe(cur.refresh_token);
      expect(st.session).toMatchObject({ mode: 'supabase', verified: false });
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });
}

test('REVIEW P1: a renewal the service REFUSES (refresh token revoked) still ends the session, with the note', async ({ page }) => {
  test.setTimeout(90_000);
  const f = project();
  const s = await signUp(f);
  const log = [];
  const srv = appServer(log);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    for (const row of f.sessions.values()) row.revoked = true;   // signed out everywhere, elsewhere
    await openWithSession(page, f, log, base, s, { expires_at: Math.floor(Date.now() / 1000) - 30 });
    await page.goto(base + '/onboarding.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.querySelector('#lnav-signin'), null, { timeout: 20000 });
    const st = await readState(page);
    expect(st.stored).toBeNull();
    expect(st.session).toBeNull();
    expect(await page.evaluate(() => (document.getElementById('lnav-signin-note') || {}).textContent || '')).toMatch(/expired or was signed out/);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

for (const locks of [true, false]) {
  test('REVIEW P2 (' + (locks ? 'Web Locks' : 'no Web Locks') + '): two tabs renewing one single-use refresh token at once never wipe the session - both end signed in on the newest pair', async ({ browser }) => {
    test.setTimeout(120_000);
    const f = project();
    const s = await signUp(f);
    const log = [];
    const srv = appServer(log);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + srv.address().port;
    const context = await browser.newContext();
    try {
      if (!locks) await context.addInitScript(() => { try { Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }); } catch (_) {} });
      f.browserRefreshDelayMs = 700;
      const a = await context.newPage();
      const b = await context.newPage();
      await wire(a, f, log); await wire(b, f, log);
      // ONE seed for the whole context (localStorage is shared): the token has
      // run out. Written from a bare page BEFORE either tab boots, so no tab
      // can re-seed the old pair after another has renewed it.
      const seed = await context.newPage();
      await seed.route(base + '/__seed', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>seed</title>' }));
      await seed.goto(base + '/__seed');
      await seed.evaluate((sess) => localStorage.setItem('lifecycle.auth.session', JSON.stringify(sess)), {
        token: s.token, refresh_token: s.refresh_token, expires_at: Math.floor(Date.now() / 1000) - 30, user: s.user, mode: 'supabase', expires: null, provider: 'mobile-pin',
        storage: { mode: 'supabase', host: new URL(f.url).hostname, message: '' },
      });
      await seed.close();
      await Promise.all([a.goto(base + '/onboarding.html', { waitUntil: 'domcontentloaded' }), b.goto(base + '/smart-brain.html', { waitUntil: 'domcontentloaded' })]);
      await Promise.all([settled(a), settled(b)]);
      await a.waitForTimeout(1500);
      const sa = await readState(a);
      const sb = await readState(b);
      const stored = sa.stored;
      expect(stored, 'the race wiped the stored session').not.toBeNull();
      expect(stored.refresh_token).not.toBe(s.refresh_token);
      for (const st of [sa, sb]) {
        expect(st.session, 'a tab lost its session in the race').not.toBeNull();
        expect(st.session.token).toBe(stored.token);
      }
      // The pair in storage is a LIVE one.
      const check = f.handle('GET', f.url + '/auth/v1/user', { apikey: f.anonKey, authorization: 'Bearer ' + stored.token }, '');
      expect(check.status).toBe(200);
      if (locks) expect(log.filter((l) => l.browser && /grant_type=refresh_token/.test(l.url)).length, 'with Web Locks only ONE tab spends the refresh token').toBe(1);
    } finally {
      await context.close();
      await new Promise((r) => srv.close(r));
    }
  });
}

/* ── review findings, second round (2026-10-03) ── */

test('REVIEW P1 (routing): with Neon ALSO configured, a failed Supabase probe never sends a Supabase JWT to Neon - op=me answers 503 (kept), not 401 (cleared)', async () => {
  const f = project({ DATABASE_URL: 'postgres://u:p@ep-fixture.neon.tech/db' });
  const s = await signUp(f);
  for (const m of MODS) delete require.cache[m];
  const core = require('../api/_shared/mobile-auth-core.js');
  // A Neon store that answers (select 1, schema, an empty session table).
  const neon = async (strings) => { const t = strings.join('$').replace(/\s+/g, ' ').trim().toLowerCase(); if (t === 'select 1') return [{ '?column?': 1 }]; return []; };
  f.healthy = false;   // one failed health probe
  const call = (op, body) => new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(j) { resolve({ status: this.statusCode, body: j }); return this; } };
    core.handle({ method: body ? 'POST' : 'GET', query: { op }, headers: { authorization: 'Bearer ' + s.token, 'x-lifecycle-token': s.token }, body }, res, { sql: neon });
  });
  const me = await call('me');
  expect(me.status, 'a Supabase JWT was judged by the Neon session store').toBe(503);
  expect(me.body).toMatchObject({ error: 'backend_unreachable', mode: 'supabase' });
  const out = await call('signout', { op: 'signout' });
  expect(out.body).toMatchObject({ ok: true, signed_out: false, mode: 'supabase' });
  // And a Neon token is still Neon's: the routing is by the token, not a blanket switch.
  const neonMe = await new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(j) { resolve({ status: this.statusCode, body: j }); return this; } };
    core.handle({ method: 'GET', query: { op: 'me' }, headers: { 'x-lifecycle-token': 'n'.repeat(43) }, body: {} }, res, { sql: neon });
  });
  expect(neonMe.status).toBe(401);
});

test('REVIEW P2 (public key): the browser is handed the same public key the broker accepts, never a server key; with none, Supabase mode is not reported', async () => {
  const cfgOf = () => new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, removeHeader() {}, status(c) { this.statusCode = c; return this; }, json(j) { resolve(j); return this; } };
    require('../api/public-config.js')({ method: 'GET', query: {}, headers: {} }, res);
  });
  // 1. Only a PUBLISHABLE key: published, and the mode is supabase.
  let f = project({ SUPABASE_ANON_KEY: undefined, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture123' });
  f.anonKey = 'sb_publishable_fixture123';
  expect((await cfgOf()).supabase.anonKey).toBe('sb_publishable_fixture123');
  expect((await auth('status')).body).toMatchObject({ mode: 'supabase' });
  // 2. No browser-visible key at all: nothing published, and NOT supabase mode, with the reason.
  for (const m of MODS) delete require.cache[m];
  f = project({ SUPABASE_ANON_KEY: undefined, SUPABASE_PUBLISHABLE_KEY: undefined });
  expect((await cfgOf()).supabase.anonKey).toBe('');
  let st = (await auth('status')).body;
  expect(st.mode).not.toBe('supabase');
  expect(st.supabase).toMatchObject({ configured: true, reachable: false, reason: 'no_public_key' });
  expect(st.message).toMatch(/SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY/);
  // 3. A "public" variable that holds a server key is never published.
  const jwtRole = 'x.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.y';
  for (const bad of ['SERVICE', 'sb_secret_abcdef', jwtRole]) {
    for (const m of MODS) delete require.cache[m];
    f = project();
    process.env.SUPABASE_ANON_KEY = bad === 'SERVICE' ? f.serviceKey : bad;
    expect((await cfgOf()).supabase.anonKey, 'a server key was published to the browser: ' + bad.slice(0, 12)).toBe('');
  }
});

/** Two pages of one context, signed in with the same stored Supabase session. */
async function twoTabs(browser, f, log, base, s, extra) {
  const context = await browser.newContext();
  const seed = await context.newPage();
  await seed.route(base + '/__seed', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>seed</title>' }));
  await seed.goto(base + '/__seed');
  await seed.evaluate((sess) => localStorage.setItem('lifecycle.auth.session', JSON.stringify(sess)), Object.assign({
    token: s.token, refresh_token: s.refresh_token, expires_at: s.expires_at, user: s.user, mode: 'supabase', expires: null, provider: 'mobile-pin',
    storage: { mode: 'supabase', host: new URL(f.url).hostname, message: '' },
  }, extra || {}));
  await seed.close();
  const a = await context.newPage();
  const b = await context.newPage();
  await wire(a, f, log); await wire(b, f, log);
  return { context, a, b };
}

test('REVIEW P1 (cross-tab sign-out): signing out in one tab ends the session in every other tab at once - no session, no token, no supabase-js session, the Sign in chip', async ({ browser }) => {
  test.setTimeout(120_000);
  const f = project();
  const s = await signUp(f);
  const log = [];
  const srv = appServer(log);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const { context, a, b } = await twoTabs(browser, f, log, base, s, { state: 'verified' });
  try {
    await a.goto(base + '/onboarding.html', { waitUntil: 'domcontentloaded' });
    await b.goto(base + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
    for (const p of [a, b]) await p.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.session && window.LifecycleAuth.session.verified === true, null, { timeout: 20000 });
    await a.locator('#lnav-signout').evaluate((el) => el.click());
    await b.waitForFunction(() => !window.LifecycleAuth.session, null, { timeout: 5000 }).catch(() => {});
    const st = await readState(b);
    expect(st.session, 'the other tab kept the signed-out session').toBeNull();
    expect(st.apiToken).toBe('');
    expect(st.signin).toBe(true);
    expect(st.signOuts, 'the other tab\'s supabase-js client kept the session').toEqual([{ scope: 'local' }]);
    expect(await b.evaluate(() => window.LifecycleAuth.backend.kind)).toBe('signed-out');
  } finally {
    await context.close();
    await new Promise((r) => srv.close(r));
  }
});

test('REVIEW (failed renew): a scheduled renewal that cannot be made marks the session UNVERIFIED - said, brands on the device, no dead token sent - and a sibling tab adopts the VERIFIED state when the other tab recovers', async ({ browser }) => {
  test.setTimeout(150_000);
  const f = project();
  const s = await signUp(f);
  const log = [];
  const srv = appServer(log);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  // Verified, with an access token that runs out in 90 s.
  const soon = Math.floor(Date.now() / 1000) + 90;
  f.access.get(s.token).exp = soon;
  const { context, a, b } = await twoTabs(browser, f, log, base, s, { state: 'verified', expires_at: soon });
  try {
    await a.clock.install(); await b.clock.install();
    await a.goto(base + '/onboarding.html', { waitUntil: 'domcontentloaded' });
    await b.goto(base + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
    for (const p of [a, b]) await p.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.session && window.LifecycleAuth.session.verified === true, null, { timeout: 20000 });

    // The renewal is due and the auth service does not answer.
    f.browserRefreshFault = 'abort';
    await a.clock.fastForward('02:00');
    await a.waitForFunction(() => window.LifecycleAuth.session && window.LifecycleAuth.session.verified === false, null, { timeout: 10000 });
    let st = await readState(a);
    expect(st.stored).toMatchObject({ state: 'unverified', refresh_token: s.refresh_token });
    expect(st.umode).toMatch(/not answering right now/);
    expect(st.apiToken, 'a dead access token is still sent').toBe('');
    expect(st.storage.mode, 'brands stayed on the server path with a session nobody can check').toBe('device');
    // The sibling learns the same state from the record, without its own renewal.
    await b.waitForFunction(() => window.LifecycleAuth.session && window.LifecycleAuth.session.verified === false, null, { timeout: 5000 });

    // The service is back: tab A's retry renews and re-checks; tab B ADOPTS
    // the verified state (its own clock is not advanced at all).
    f.browserRefreshFault = null;
    const renewalsBefore = log.filter((l) => l.browser && /grant_type=refresh_token/.test(l.url)).length;
    const checksBefore = log.filter((l) => l.query && l.query.op === 'me').length;
    await a.clock.fastForward('01:30');
    await a.waitForFunction(() => window.LifecycleAuth.session && window.LifecycleAuth.session.verified === true, null, { timeout: 10000 });
    await b.waitForFunction(() => window.LifecycleAuth.session && window.LifecycleAuth.session.verified === true, null, { timeout: 5000 });
    const sa = await readState(a); const sb = await readState(b);
    expect(sa.stored.state).toBe('verified');
    expect(sb.session.token).toBe(sa.stored.token);
    expect(sb.apiToken).toBe(sa.stored.token);
    expect(log.filter((l) => l.browser && /grant_type=refresh_token/.test(l.url) && l.body.indexOf(s.refresh_token) >= 0).length - 0, 'the sibling spent the refresh token too').toBeGreaterThan(0);
    expect(log.filter((l) => l.browser && /grant_type=refresh_token/.test(l.url)).length - renewalsBefore, 'more than one renewal after recovery').toBe(1);
    // ONE tab renewed and checked; the other became verified by ADOPTING the
    // record it wrote, not by checking again itself (the clock is the
    // context's, so both tabs' retries fall due together).
    await a.waitForTimeout(500);
    expect(log.filter((l) => l.query && l.query.op === 'me').length - checksBefore, 'both tabs re-checked instead of one adopting the other\'s verified state').toBe(1);
  } finally {
    await context.close();
    await new Promise((r) => srv.close(r));
  }
});

test('REVIEW SECURITY (adoption): twenty wrong PINs against an auth user this table never bound reach at most FIVE password checks, then lock - and a sign-up that died after the create is still recovered with the right PIN', async () => {
  const f = project();
  // A phone user the server never bound: made in the dashboard, say, with a password nobody here knows.
  const made = f.handle('POST', f.url + '/auth/v1/admin/users', { apikey: f.serviceKey, authorization: 'Bearer ' + f.serviceKey },
    JSON.stringify({ phone: E164, password: 'a-password-from-elsewhere', phone_confirm: true }));
  expect(made.status).toBe(200);
  const out = [];
  for (let i = 0; i < 20; i++) {
    out.push(await auth('enter', { phone: PHONE, cc: '+91', name: 'Mallory', pin: String(5000 + i * 7).padStart(4, '0') }, { 'x-forwarded-for': '198.51.100.' + i }));
  }
  expect(f.grants().length, 'the adoption path checked more PINs than the lockout allows').toBeLessThanOrEqual(5);
  expect(out.slice(-10).every((r) => r.status === 429 && r.body.locked), JSON.stringify(out.slice(-3).map((r) => r.body))).toBe(true);
  expect(out.every((r) => !r.body.token)).toBe(true);
  const row = f.tables.mobile_pin_accounts.get(E164);
  expect(row, 'a failure deleted the row that carries the count').toBeTruthy();
  expect(row.locked_until).toBeGreaterThan(Date.now());

  // A sign-up whose function died AFTER the create: the auth user exists with
  // the derived password, the row was never bound. A wrong PIN counts; the
  // right one adopts it and clears the count.
  const g = project();
  const supa = require('../api/_shared/mobile-auth-supabase.js');
  const other = '+919812345678';
  g.handle('POST', g.url + '/auth/v1/admin/users', { apikey: g.serviceKey, authorization: 'Bearer ' + g.serviceKey },
    JSON.stringify({ phone: other, password: supa.derivePassword(PEPPER, other, PIN), phone_confirm: true, app_metadata: { lifecycle_account: 'mobile-pin', phone_e164: other } }));
  const wrong = await auth('enter', { phone: '9812345678', cc: '+91', name: 'Ravi', pin: '5926' });
  expect(wrong.body.token).toBeUndefined();
  expect(g.tables.mobile_pin_accounts.get(other).pin_tries).toBe(1);
  const right = await auth('enter', { phone: '9812345678', cc: '+91', name: 'Ravi', pin: PIN });
  expect(right.status, JSON.stringify(right.body)).toBe(200);
  expect(right.body.token).toBeTruthy();
  expect(g.tables.mobile_pin_accounts.get(other)).toMatchObject({ user_id: g.userByPhone(other).id, pin_tries: 0, locked_until: null });
});

test('REVIEW (cross-tab adopt): another person signing in in another tab replaces the WHOLE session here - name, user, token and brand namespace - never the old name over the new token', async ({ browser }) => {
  test.setTimeout(120_000);
  const f = project();
  const ravi = await signUp(f);
  // A different person who happens to share the display name: only the
  // account id tells the two sessions apart.
  const priya = await signUp(f, '9811111111', 'Ravi', '6082');
  const log = [];
  const srv = appServer(log);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const { context, a, b } = await twoTabs(browser, f, log, base, ravi, { state: 'verified' });
  try {
    await a.goto(base + '/onboarding.html', { waitUntil: 'domcontentloaded' });
    await b.goto(base + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
    for (const p of [a, b]) await p.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.session && window.LifecycleAuth.session.verified === true, null, { timeout: 20000 });
    // Tab A now holds Priya's session (she signed in there).
    await a.evaluate((sess) => localStorage.setItem('lifecycle.auth.session', JSON.stringify(sess)), {
      token: priya.token, refresh_token: priya.refresh_token, expires_at: priya.expires_at, user: priya.user, mode: 'supabase', expires: null, provider: 'mobile-pin',
      state: 'verified', storage: { mode: 'supabase', host: new URL(f.url).hostname, message: '' },
    });
    await b.waitForFunction((id) => window.LifecycleAuth.session && window.LifecycleAuth.session.user && window.LifecycleAuth.session.user.id === id, priya.user.id, { timeout: 5000 }).catch(() => {});
    const st = await readState(b);
    expect(await b.evaluate(() => window.LifecycleAuth.session && window.LifecycleAuth.session.user.id), 'the other tab still holds the previous person').toBe(priya.user.id);
    expect(await b.evaluate(() => window.LifecycleAuth.session.user.phone)).toBe('+919811111111');
    expect(st.session.token).toBe(priya.token);
    expect(st.apiToken).toBe(priya.token);
    expect(await b.evaluate(() => window.LifecycleAuth.user && window.LifecycleAuth.user.id)).toBe(priya.user.id);
    expect(await b.evaluate(() => window.BrandContext && window.BrandContext.device && window.BrandContext.device.key ? window.BrandContext.device.key() : '')).toMatch(new RegExp(priya.user.id + '$'));
  } finally {
    await context.close();
    await new Promise((r) => srv.close(r));
  }
});

test('REVIEW (device -> Supabase): a device account made while the project was down keeps working on the device when it comes back, sends no token the server refuses, says in ONE sentence how to move, and moving offers its brands for sync', async ({ page }) => {
  test.setTimeout(150_000);
  const f = project();
  const log = [];
  const srv = appServer(log);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    await wire(page, f, log);
    // 1. The project is down: the account and a brand are made ON THIS DEVICE.
    f.down = true; f.healthy = false;
    await page.goto(base + '/onboarding.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending'), null, { timeout: 20000 });
    await page.locator('#lnav-signin').evaluate((el) => el.click());
    await page.waitForSelector('#lnav-mauth');
    await expect(page.locator('#lnav-mauth')).toHaveAttribute('data-mode', 'device', { timeout: 8000 });
    await page.selectOption('#lnav-mauth-cc', '+91');
    await page.fill('#lnav-mauth-phone', PHONE);
    await page.click('#lnav-mauth-go');
    await page.waitForSelector('#lnav-mauth[data-state="new"]');
    await page.fill('#lnav-mauth-name', 'Ravi');
    await page.fill('#lnav-mauth-pin', PIN);
    await page.click('#lnav-mauth-go');
    await page.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 10000 });
    let st = await readState(page);
    expect(st.session).toMatchObject({ mode: 'device' });
    const deviceToken = st.session.token;
    await page.evaluate(() => window.BrandContext.api('save', { body: { brand: { name: 'Ravi Kicks', palette: { primary: '#2f6fdf', accent: '#c2410c', ink: '#1f2937', surface: '#ffffff' } } } }));

    // 2. The project comes back (after this page's own calls have settled, so
    //    every call counted below belongs to the boot that follows).
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    f.down = false; f.healthy = true;
    require('../api/_shared/mobile-auth-core.js')._reset();
    const mark = log.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.session && window.LifecycleAuth.session.transition === 'supabase', null, { timeout: 15000 });
    st = await readState(page);
    expect(st.name).toBe('Ravi');
    expect(st.session.mode, 'the device account stopped working').toBe('device');
    expect(st.apiToken, 'a device token the server now refuses is still sent').toBe('');
    expect(st.umode).toMatch(/sign in again with the same number and PIN/i);
    expect(st.storage.mode, 'the device brands are no longer usable').toBe('device');
    expect(await page.evaluate(() => (window.BrandContext.device.list() || []).map((w) => w.name))).toEqual(['Ravi Kicks']);
    const refusal = await page.evaluate(() => window.LifecycleAuth.serverActionRefusal('Generating the plan'));
    expect(refusal, 'a server action would be sent and refused with a bare 401').toBeTruthy();
    expect(log.slice(mark).filter((l) => l.token === deviceToken || l.authorization === 'Bearer ' + deviceToken), 'the device token was sent to a server that refuses it').toEqual([]);

    // 3. Moving: the same number and PIN create the account in the project,
    //    and this device's brands are OFFERED for sync - nothing is uploaded.
    await page.locator('#lnav-utransition').click();
    await page.waitForSelector('#lnav-mauth');
    await expect(page.locator('#lnav-mauth-phone')).toHaveValue(PHONE);
    await page.click('#lnav-mauth-go');
    await page.waitForSelector('#lnav-mauth[data-state="new"]');
    await expect(page.locator('#lnav-mauth-name')).toHaveValue('Ravi');
    await page.fill('#lnav-mauth-pin', PIN);
    await page.click('#lnav-mauth-go');
    await page.waitForFunction(() => window.LifecycleAuth.session && window.LifecycleAuth.session.mode === 'supabase' && window.LifecycleAuth.session.verified === true, null, { timeout: 15000 });
    expect(f.userByPhone(E164)).toBeTruthy();
    await page.waitForFunction(() => window.BrandContext.storage().mode === 'server' && window.BrandContext.storage().device_count === 1, null, { timeout: 10000 });
    expect(f.tables.brand_workspaces, 'a device brand was uploaded unasked').toEqual([]);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
