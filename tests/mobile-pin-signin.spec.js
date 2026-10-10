/**
 * Sign in and sign up with a mobile number and a 4-digit PIN (2026-09-28).
 * ---------------------------------------------------------------------------
 * The operator's words: "signin/signup with mobile number and a 4 digit password
 * - save in db (neon) or local browser cache whichever can be used - just like
 * in parwah-hq", and "comment out all other signin and signup".
 *
 * WHAT IS ASSERTED, AND HOW. Every claim here is about what the code DOES:
 *
 *   A. api/_shared/mobile-auth-core.js is REQUIRED and DRIVEN against an
 *      in-memory `store` tagged template (the three tables as arrays), so the
 *      state machine, the lockout, the hashing, the session lifetime and the
 *      per-IP budget are all exercised without a database anywhere.
 *   B. api/public-config.js - the shipped entry point, with its request-scope
 *      wrapper - is executed with stubbed req/res, both with no DATABASE_URL
 *      (device mode) and with the fake store injected through require.cache.
 *   C. The gates: brand-workspace-core.requireUser() accepts a server-mode
 *      token and refuses a device-shaped one EXACTLY like an anonymous call;
 *      restAs() refuses a phone account with a sentence instead of PostgREST's
 *      401; credits.meter() refuses a phone account before any wallet exists.
 *   D. The REAL pages in Chromium, served from 127.0.0.1 (WebCrypto's PBKDF2
 *      exists only in a secure context, which the http://app.example.test
 *      route-fixture the other specs use is not): device-mode sign-up through
 *      the rail's panel, a reload keeping the session, five wrong PINs locking
 *      the account, sign out; server mode through page.route on the auth
 *      endpoint; every page that loads auth.js pressing Sign in and never
 *      calling signInWithOAuth (the stub records calls) and never showing a
 *      Google button; and the browser's copy of the phone and PIN rules held
 *      to the server's over the same inputs.
 *
 * Run: npx playwright test tests/mobile-pin-signin.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CORE = require.resolve('../api/_shared/mobile-auth-core.js');
const PHONE = require.resolve('../api/_shared/phone-rules.js');
const BRAND_CORE = require.resolve('../api/_shared/brand-workspace-core.js');
const PUBLIC_CONFIG = require.resolve('../api/public-config.js');
const CREDITS = require.resolve('../api/_shared/credits-core.js');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const ENV_KEYS = ['DATABASE_URL', 'NEON_DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'CRON_SECRET'];
const saved = {};
test.beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
test.afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

/* ═══════════════════════════════════════════════════════════════════════════
   The in-memory database: a `store` tagged template over three arrays.
   It answers exactly the statement shapes the core emits, and throws on any
   other, so a query the core adds later cannot pass by accident.
   ═══════════════════════════════════════════════════════════════════════════ */
function fakeSql(opts) {
  const o = opts || {};
  const db = { app_users: [], app_sessions: [], app_rate_limits: [], down: false, log: [] };
  let seq = 0;
  const uuid = () => 'aaaaaaaa-0000-4000-8000-' + String(++seq).padStart(12, '0');
  const copy = (r) => Object.assign({}, r);
  // Statements run ONE AT A TIME, in the order they were issued - a single
  // connection's view of the world - so two `enter()` calls in flight at once
  // interleave at every statement boundary exactly as they would against a
  // database, and a read-modify-write in JavaScript is visible as the race it is.
  let chain = Promise.resolve();
  const store = (strings, ...vals) => {
    const run = chain.then(() => exec(strings, vals));
    chain = run.catch(() => {});
    return run;
  };
  const exec = async (strings, vals) => {
    const text = strings.join(' $ ').replace(/\s+/g, ' ').trim().toLowerCase();
    db.log.push(text);
    if (db.down) throw new Error('connect ECONNREFUSED ' + (o.host || 'db'));
    if (/^create (table|index)/.test(text)) return [];
    if (text === 'select 1') return [{ '?column?': 1 }];
    if (text.startsWith('insert into app_rate_limits')) {
      const [bucket, key, windowSec] = vals;
      let row = db.app_rate_limits.find((r) => r.bucket === bucket && r.k === key);
      const now = Date.now();
      if (!row) { row = { bucket, k: key, window_start: now, n: 1 }; db.app_rate_limits.push(row); }
      else if (row.window_start < now - windowSec * 1000) { row.window_start = now; row.n = 1; }
      else row.n += 1;
      return [{ n: row.n }];
    }
    if (/^select id, name, phone, pin_hash, pin_salt, pin_tries, locked_until from app_users where phone = \$/.test(text)) {
      return db.app_users.filter((u) => u.phone === vals[0]).map(copy);
    }
    if (text.startsWith('insert into app_users')) {
      const [phone, cc, local, name, hash, salt] = vals;
      if (db.app_users.some((u) => u.phone === phone)) {
        // Postgres' unique_violation, with the code the driver surfaces.
        const dup = new Error('duplicate key value violates unique constraint "app_users_phone_key"');
        dup.code = '23505';
        throw dup;
      }
      const row = { id: uuid(), phone, phone_cc: cc, phone_local: local, name, pin_hash: hash, pin_salt: salt, pin_set_at: new Date().toISOString(), pin_tries: 0, locked_until: null };
      db.app_users.push(row);
      return [copy(row)];
    }
    if (text.startsWith('update app_users set pin_hash = $')) {
      const [hash, salt, id] = vals; const u = db.app_users.find((x) => x.id === id);
      if (u) { u.pin_hash = hash; u.pin_salt = salt; u.pin_tries = 0; u.locked_until = null; }
      return [];
    }
    if (text.startsWith('update app_users set pin_tries = 0, locked_until = null')) {
      const u = db.app_users.find((x) => x.id === vals[0]);
      if (u) { u.pin_tries = 0; u.locked_until = null; }
      return [];
    }
    // THE CLAIM (2026-10-09): one statement counts the try BEFORE the PIN is
    // checked, only while the row is not locked, and an expired lock starts
    // the count again at one - as Postgres evaluates it, against the row's
    // CURRENT value, returning what it wrote, and NO row while it is locked.
    // (Counting only after a wrong verify - the 2026-09-29 statement - is
    // gone on purpose: a core that regresses to it hits the unhandled-statement
    // throw below.)
    if (/^update app_users set pin_tries = case when locked_until is not null and locked_until <= now\(\) then 1 else pin_tries \+ 1 end, locked_until = case when locked_until is not null and locked_until <= now\(\) then null else locked_until end where id = \$ and \(locked_until is null or locked_until <= now\(\)\) returning pin_tries$/.test(text)) {
      const [id] = vals; const u = db.app_users.find((x) => x.id === id);
      if (!u) return [];
      const now = new Date();
      if (u.locked_until && new Date(u.locked_until) > now) return [];
      if (u.locked_until) { u.pin_tries = 1; u.locked_until = null; } else u.pin_tries = (u.pin_tries || 0) + 1;
      return [{ pin_tries: u.pin_tries }];
    }
    // The lock: set once, by whichever try reached the limit first.
    if (/^update app_users set pin_tries = 0, locked_until = \$ ::timestamptz where id = \$ and \(locked_until is null or locked_until <= now\(\)\)$/.test(text)) {
      const [until, id] = vals; const u = db.app_users.find((x) => x.id === id);
      if (u && !(u.locked_until && new Date(u.locked_until) > new Date())) { u.pin_tries = 0; u.locked_until = until; }
      return [];
    }
    if (text === 'select locked_until from app_users where id = $') {
      return db.app_users.filter((u) => u.id === vals[0]).map((u) => ({ locked_until: u.locked_until }));
    }
    if (text.startsWith('insert into app_sessions')) {
      const [token_hash, user_id, device, expires_at] = vals;
      db.app_sessions.push({ token_hash, user_id, device, expires_at, last_used_at: new Date().toISOString() });
      return [];
    }
    if (text.startsWith('delete from app_sessions where expires_at < now()')) {
      db.app_sessions = db.app_sessions.filter((s) => new Date(s.expires_at) > new Date());
      return [];
    }
    if (text.startsWith('select s.user_id, s.expires_at, u.name, u.phone from app_sessions s')) {
      const h = vals[0];
      return db.app_sessions.filter((s) => s.token_hash === h && new Date(s.expires_at) > new Date())
        .map((s) => { const u = db.app_users.find((x) => x.id === s.user_id) || {}; return { user_id: s.user_id, expires_at: s.expires_at, name: u.name, phone: u.phone }; });
    }
    if (text.startsWith('update app_sessions set last_used_at')) {
      const s = db.app_sessions.find((x) => x.token_hash === vals[0]); if (s) s.last_used_at = new Date().toISOString();
      return [];
    }
    if (text.startsWith('delete from app_sessions where token_hash')) { db.app_sessions = db.app_sessions.filter((s) => s.token_hash !== vals[0]); return []; }
    if (text.startsWith('delete from app_sessions where user_id')) { db.app_sessions = db.app_sessions.filter((s) => s.user_id !== vals[0]); return []; }
    throw new Error('fake sql: unhandled statement: ' + text);
  };
  store.db = db;
  return store;
}

function freshCore() {
  delete require.cache[CORE];
  delete require.cache[PHONE];
  return require(CORE);
}

const IN = { phone: '9876543210', cc: '+91' };
const PIN = '7391';
const sha = (t) => createHash('sha256').update(t).digest('hex');

/* ═══════════════════════════════════════════════════════════════════════════
   A. THE CORE, DRIVEN
   ═══════════════════════════════════════════════════════════════════════════ */

test('sign-up is one step: an unknown number asks for a name, then name + PIN creates the account and signs in', async () => {
  const core = freshCore();
  const store = fakeSql();
  const first = await core.enter(store, IN, '203.0.113.9');
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ ok: true, exists: false });
  expect(first.body.token).toBeUndefined();
  expect(store.db.app_users.length, 'an account was created before a name and PIN were given').toBe(0);

  const made = await core.enter(store, Object.assign({ name: 'Asha', pin: PIN }, IN), '203.0.113.9');
  expect(made.status).toBe(200);
  expect(made.body).toMatchObject({ ok: true, exists: true, created: true, mode: 'server' });
  expect(made.body.user).toEqual({ id: store.db.app_users[0].id, name: 'Asha', phone: '+919876543210' });
  expect(made.body.token).toMatch(/^[A-Za-z0-9_-]{40,90}$/);
  expect(new Date(made.body.expires) - Date.now()).toBeGreaterThan(89 * 86400000);
  // The PIN is never stored: a salted scrypt hash is, and it verifies.
  const u = store.db.app_users[0];
  // Never a substring check: the salt and hash are random hex, and four digits
  // WILL appear inside 96 hex characters now and then (CI saw the PIN inside a
  // salt once). What must hold is that no stored VALUE is the PIN and that the
  // hash is not the PIN in any encoding.
  expect(Object.values(u).map(String)).not.toContain(PIN);
  expect(u.pin_hash).not.toBe(PIN);
  expect(u.pin_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(u.pin_salt).toMatch(/^[0-9a-f]{32}$/);
  expect(core.verifyPin(PIN, u.pin_salt, u.pin_hash)).toBe(true);
  expect(core.verifyPin('7392', u.pin_salt, u.pin_hash)).toBe(false);
  // Only the sha256 of the token is stored - a copy of the table is not a login.
  expect(store.db.app_sessions.length).toBe(1);
  expect(store.db.app_sessions[0].token_hash).not.toBe(made.body.token);
  expect(store.db.app_sessions[0].token_hash).toBe(sha(made.body.token));
  expect(JSON.stringify(store.db)).not.toContain(made.body.token);
});

test('sign-in asks for the PIN, refuses a wrong one with the tries left, and signs in on the right one', async () => {
  const core = freshCore();
  const store = fakeSql();
  await core.enter(store, Object.assign({ name: 'Asha', pin: PIN }, IN), 'ip');
  const ask = await core.enter(store, IN, 'ip');
  expect(ask.body).toMatchObject({ ok: true, exists: true, needPin: true });
  expect(ask.body.token).toBeUndefined();
  // Never a name before the PIN: anyone can type any number.
  expect(ask.body.name, 'the account holder\'s name was told to someone who only typed the number').toBeUndefined();
  expect(JSON.stringify(ask.body)).not.toContain('Asha');
  const wrong = await core.enter(store, Object.assign({ pin: '1357' }, IN), 'ip');
  expect(wrong.status).toBe(401);
  expect(wrong.body).toMatchObject({ ok: false, wrongPin: true, left: 4, error: 'pin_wrong' });
  expect(wrong.body.message).toMatch(/4 tries left/);
  const right = await core.enter(store, Object.assign({ pin: PIN }, IN), 'ip');
  expect(right.status).toBe(200);
  expect(right.body.token).toBeTruthy();
  expect(right.body.created).toBe(false);
  expect(store.db.app_users[0].pin_tries, 'a successful sign-in did not reset the try counter').toBe(0);
  // The same number typed with spaces, or in full E.164, is the same account.
  const spaced = await core.enter(store, { phone: '98765 43210', cc: '+91', pin: PIN }, 'ip');
  expect(spaced.body.user.id).toBe(right.body.user.id);
  const e164 = await core.enter(store, { phone: '+919876543210', pin: PIN }, 'ip');
  expect(e164.body.user.id).toBe(right.body.user.id);
});

test('five wrong PINs lock the account for fifteen minutes, and the right PIN does not open it while locked', async () => {
  const core = freshCore();
  const store = fakeSql();
  await core.enter(store, Object.assign({ name: 'Asha', pin: PIN }, IN), 'ip');
  const lefts = [];
  let last;
  for (let i = 0; i < 5; i++) {
    last = await core.enter(store, Object.assign({ pin: '1357' }, IN), 'ip');
    lefts.push(last.body.left);
  }
  expect(lefts.slice(0, 4)).toEqual([4, 3, 2, 1]);
  expect(last.status).toBe(429);
  expect(last.body).toMatchObject({ ok: false, locked: true, error: 'pin_locked' });
  expect(last.body.message).toMatch(/Too many wrong PINs\. Try again in 15 minutes\./);
  const until = new Date(store.db.app_users[0].locked_until) - Date.now();
  expect(until).toBeGreaterThan(14 * 60000);
  expect(until).toBeLessThanOrEqual(15 * 60000);
  const still = await core.enter(store, Object.assign({ pin: PIN }, IN), 'ip');
  expect(still.status, 'the right PIN opened a locked account').toBe(429);
  expect(still.body.locked).toBe(true);
  expect(still.body.token).toBeUndefined();
  // The lock expires: the right PIN then signs in and clears it.
  store.db.app_users[0].locked_until = new Date(Date.now() - 1000).toISOString();
  const after = await core.enter(store, Object.assign({ pin: PIN }, IN), 'ip');
  expect(after.status).toBe(200);
  expect(store.db.app_users[0].locked_until).toBeNull();
});

/* ─────────────────────────────────────────────────────────────────────────────
   REVIEW FINDINGS (2026-09-29), each reproduced here BEFORE it was fixed.
   ───────────────────────────────────────────────────────────────────────────── */

test('REVIEW P1: the loser of a sign-up race for one number is not handed the winner account - it is held to the PIN check like any sign-in', async () => {
  const core = freshCore();
  const store = fakeSql();
  // Two first sign-ups for the SAME new number, in flight at once, with
  // DIFFERENT PINs (two tabs, two people, a double-tap). Both read "no row",
  // both insert; the unique index lets one through and answers the other with
  // 23505. The one that lost must then be treated as a sign-IN to the account
  // that now exists - which means its PIN is checked against the winner's.
  const [a, b] = await Promise.all([
    core.enter(store, Object.assign({ name: 'Asha', pin: PIN }, IN), '203.0.113.1'),
    core.enter(store, Object.assign({ name: 'Bala', pin: '8052' }, IN), '203.0.113.2'),
  ]);
  expect(store.db.app_users.length, 'one number, one account').toBe(1);
  const winner = a.body.created ? a : b;
  const loser = a.body.created ? b : a;
  expect(winner.status).toBe(200);
  expect(winner.body.token).toBeTruthy();
  expect(store.db.app_users[0].name).toBe(winner.body.user.name);
  // The finding: the loser kept `isNew`, skipped the PIN branch, and was
  // issued a session for an account whose PIN it never typed.
  expect(loser.body.token, 'the loser of the insert race was issued a session for the winner\'s account').toBeUndefined();
  expect(loser.body.created).not.toBe(true);
  expect(loser.status).toBe(401);
  expect(loser.body).toMatchObject({ ok: false, wrongPin: true, error: 'pin_wrong', left: 4 });
  expect(store.db.app_sessions.length, 'sessions issued for two enters with one right PIN').toBe(1);
  expect(store.db.app_sessions[0].user_id).toBe(store.db.app_users[0].id);
  expect(store.db.app_users[0].pin_tries, 'the wrong PIN did not count as a try').toBe(1);
  // Same race, but the loser typed the SAME PIN as the winner: that is a
  // correct sign-in and gets its own session.
  const twin = fakeSql();
  const [c, d] = await Promise.all([
    core.enter(twin, Object.assign({ name: 'Asha', pin: PIN }, IN), 'ip'),
    core.enter(twin, Object.assign({ name: 'Asha', pin: PIN }, IN), 'ip'),
  ]);
  expect([c.status, d.status]).toEqual([200, 200]);
  expect([c.body.created, d.body.created].sort()).toEqual([false, true]);
  expect(twin.db.app_sessions.length).toBe(2);
});

test('REVIEW P1: five wrong PINs arriving AT ONCE each count, and the account locks', async () => {
  const core = freshCore();
  const store = fakeSql();
  await core.enter(store, Object.assign({ name: 'Asha', pin: PIN }, IN), 'ip');
  // The finding: pin_tries was read, incremented in JavaScript and written
  // back, so N concurrent wrong PINs all read 0, all wrote 1, and the lock
  // never fired - a script could try every PIN five at a time.
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => core.enter(store, Object.assign({ pin: '1357' }, IN), 'ip')));
  const u = store.db.app_users[0];
  expect(results.some((r) => r.body.locked), 'five concurrent wrong PINs did not lock the account').toBe(true);
  expect(u.locked_until, 'the row was not locked').toBeTruthy();
  expect(new Date(u.locked_until) - Date.now()).toBeGreaterThan(14 * 60000);
  // Every attempt was counted, not just the last one to write.
  expect(results.filter((r) => r.body.wrongPin).map((r) => r.body.left).sort()).toEqual([1, 2, 3, 4]);
  expect(results.filter((r) => r.body.locked).length).toBe(1);
  expect(results.every((r) => !r.body.token)).toBe(true);
  // The right PIN does not open it now.
  const still = await core.enter(store, Object.assign({ pin: PIN }, IN), 'ip');
  expect(still.status).toBe(429);
  expect(still.body.token).toBeUndefined();
  // Ten at once: the lock still fires exactly as it does for five in a row,
  // and the surplus attempts are answered as locked, never as "tries left".
  const ten = fakeSql();
  await core.enter(ten, Object.assign({ name: 'Asha', pin: PIN }, IN), 'ip');
  const burst = await Promise.all(Array.from({ length: 10 }, () => core.enter(ten, Object.assign({ pin: '1357' }, IN), 'ip')));
  expect(burst.filter((r) => r.body.wrongPin).length).toBe(4);
  expect(burst.filter((r) => r.body.locked).length).toBe(6);
  expect(ten.db.app_users[0].locked_until).toBeTruthy();
});

test('a weak PIN, a straight run, a wrong length and non-digits are all refused with a sentence', async () => {
  const core = freshCore();
  const store = fakeSql();
  for (const weak of ['1234', '4321', '0000', '9999', '2580', '1122', '2020', '6969', '0007', '4200']) {
    const r = await core.enter(store, Object.assign({ name: 'Asha', pin: weak }, IN), 'ip');
    expect(r.body, weak).toMatchObject({ ok: true, exists: false, needPin: true, error: 'pin_invalid' });
    expect(r.body.message, weak).toMatch(/first anyone would try/);
  }
  for (const run of ['3456', '6543', '0123', '9876']) {
    expect(core.pinError(run), run).toMatch(/first anyone would try/);
  }
  expect(core.pinError('12345')).toMatch(/4 digits, you typed 5/);
  expect(core.pinError('739')).toMatch(/4 digits, you typed 3/);
  expect(core.pinError('ab12')).toMatch(/numbers only/);
  expect(core.pinError('')).toMatch(/numbers only/);
  expect(core.pinError(null)).toMatch(/numbers only/);
  expect(core.pinError(PIN)).toBeNull();
  expect(core.pinError('2468')).toBeNull();
  expect(store.db.app_users.length, 'an account was created with a refused PIN').toBe(0);
  // The list is the operator's, in full.
  expect(core.WEAK_PINS).toEqual(expect.arrayContaining(['0000', '1111', '9999', '1234', '4321', '2580', '0852', '1212', '2121', '1122', '2211', '1010', '0101', '2020', '2000', '2001', '1004', '6969', '0007', '4200']));
});

test('phone numbers are validated per country: +91, +1 and +44 shapes', async () => {
  const core = freshCore();
  const p = core.phone;
  expect(p.normPhone('9876543210', '+91')).toEqual({ e164: '+919876543210', cc: '+91', local: '9876543210' });
  expect(p.normPhone('5876543210', '+91'), 'an Indian mobile starts with 6-9').toBeNull();
  expect(p.normPhone('987654321', '+91'), 'nine digits is not an Indian mobile').toBeNull();
  expect(p.normPhone('2015550123', '+1')).toEqual({ e164: '+12015550123', cc: '+1', local: '2015550123' });
  expect(p.normPhone('1015550123', '+1'), 'a NANP number does not start with 1').toBeNull();
  expect(p.normPhone('7700900123', '+44')).toEqual({ e164: '+447700900123', cc: '+44', local: '7700900123' });
  expect(p.normPhone('770090012', '+44')).toEqual({ e164: '+44770090012', cc: '+44', local: '770090012' });
  expect(p.normPhone('77009001', '+44'), 'eight digits is too short for the UK').toBeNull();
  expect(p.normPhone('+44 7700 900123')).toEqual({ e164: '+447700900123', cc: '+44', local: '7700900123' });
  expect(p.normPhone('abc', '+91')).toBeNull();
  expect(p.normPhone('', '+91')).toBeNull();
  expect(p.phoneError('+91')).toMatch(/India number has 10 digits/);
  expect(p.phoneError('+1')).toMatch(/USA \/ Canada number has 10 digits/);
  expect(p.phoneError('+44')).toMatch(/UK number has 9-10 digits/);
  expect(p.phoneError('nonsense')).toMatch(/India/);
  const store = fakeSql();
  const bad = await core.enter(store, { phone: '5876543210', cc: '+91', name: 'X', pin: PIN }, 'ip');
  expect(bad.status).toBe(400);
  expect(bad.body).toMatchObject({ ok: false, error: 'phone_invalid' });
  expect(bad.body.message).toMatch(/India number/);
});

test('sign-out kills that session only; sign-out-everywhere kills all; an expired session is refused', async () => {
  const core = freshCore();
  const store = fakeSql();
  const a = (await core.enter(store, Object.assign({ name: 'Asha', pin: PIN }, IN), 'ip')).body.token;
  const b = (await core.enter(store, Object.assign({ pin: PIN }, IN), 'ip')).body.token;
  expect(a).not.toBe(b);
  expect(store.db.app_sessions.length).toBe(2);
  expect(await core.sessionUser(store, a)).toMatchObject({ name: 'Asha', phone: '+919876543210' });

  const res = mockRes();
  await core.handle({ method: 'POST', query: { action: 'auth', op: 'signout' }, headers: { 'x-lifecycle-token': a }, body: {} }, res.res, { sql: store });
  expect(res.out.code).toBe(200);
  expect(res.out.body).toMatchObject({ ok: true, signed_out: true });
  expect(await core.sessionUser(store, a), 'the signed-out session still works').toBeNull();
  expect(await core.sessionUser(store, b), 'signing out one session killed another').not.toBeNull();

  const c = (await core.enter(store, Object.assign({ pin: PIN }, IN), 'ip')).body.token;
  const all = mockRes();
  await core.handle({ method: 'POST', query: { action: 'auth', op: 'signout_all' }, headers: { 'x-lifecycle-token': b }, body: {} }, all.res, { sql: store });
  expect(all.out.code).toBe(200);
  expect(await core.sessionUser(store, b)).toBeNull();
  expect(await core.sessionUser(store, c)).toBeNull();
  expect(store.db.app_sessions.length).toBe(0);

  const d = (await core.enter(store, Object.assign({ pin: PIN }, IN), 'ip')).body.token;
  store.db.app_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  expect(await core.sessionUser(store, d), 'an expired session was accepted').toBeNull();
  const me = mockRes();
  await core.handle({ method: 'GET', query: { action: 'auth', op: 'me' }, headers: { authorization: 'Bearer ' + d } }, me.res, { sql: store });
  expect(me.out.code).toBe(401);
  expect(me.out.body).toMatchObject({ ok: false, error: 'invalid_session' });
  expect(me.out.body.message).toMatch(/expired/i);
  // signout_all without a session is refused, not silently a no-op.
  const anon = mockRes();
  await core.handle({ method: 'POST', query: { action: 'auth', op: 'signout_all' }, headers: {}, body: {} }, anon.res, { sql: store });
  expect(anon.out.code).toBe(401);
});

test('the per-IP budget on enter trips at the 26th attempt in ten minutes, and another address is unaffected', async () => {
  const core = freshCore();
  const store = fakeSql();
  let last;
  for (let i = 0; i < 25; i++) last = await core.enter(store, IN, '198.51.100.7');
  expect(last.status, 'the 25th attempt was refused').toBe(200);
  const tripped = await core.enter(store, IN, '198.51.100.7');
  expect(tripped.status).toBe(429);
  expect(tripped.body).toMatchObject({ ok: false, error: 'rate_limited' });
  expect(tripped.body.message).toMatch(/Too many sign-in attempts/);
  const other = await core.enter(store, IN, '198.51.100.8');
  expect(other.status).toBe(200);
  expect(core.ENTER_LIMIT).toBe(25);
  expect(core.ENTER_WINDOW_SEC).toBe(600);
  // The window resets.
  store.db.app_rate_limits.find((r) => r.k === '198.51.100.7').window_start = Date.now() - 601000;
  expect((await core.enter(store, IN, '198.51.100.7')).status).toBe(200);
});

test('an account whose PIN an operator cleared asks for a new one (the reset path), and never signs in on the number alone', async () => {
  const core = freshCore();
  const store = fakeSql();
  await core.enter(store, Object.assign({ name: 'Asha', pin: PIN }, IN), 'ip');
  store.db.app_users[0].pin_hash = null; store.db.app_users[0].pin_salt = null;
  const ask = await core.enter(store, IN, 'ip');
  expect(ask.body).toMatchObject({ ok: true, exists: true, setPin: true, error: null });
  expect(ask.body.name, 'a name before the PIN').toBeUndefined();
  expect(ask.body.token).toBeUndefined();
  const weak = await core.enter(store, Object.assign({ pin: '1234' }, IN), 'ip');
  expect(weak.body).toMatchObject({ setPin: true, error: 'pin_invalid' });
  const set = await core.enter(store, Object.assign({ pin: '8052' }, IN), 'ip');
  expect(set.status).toBe(200);
  expect(set.body.token).toBeTruthy();
  expect(core.verifyPin('8052', store.db.app_users[0].pin_salt, store.db.app_users[0].pin_hash)).toBe(true);
});

test('status is honest about where accounts are saved: no URL, an unreachable database, a live one', async () => {
  const core = freshCore();
  expect(await core.status()).toMatchObject({ ok: true, mode: 'device', reason: 'no_database_url' });
  expect((await core.status()).message).toMatch(/Saved on this device only: no database is configured/);
  process.env.DATABASE_URL = 'postgres://user:pw@ep-fixture-123.eu-central-1.aws.neon.tech/neondb';
  const down = fakeSql({ host: 'ep-fixture-123.eu-central-1.aws.neon.tech' });
  down.db.down = true;
  const unreachable = await core.status({ sql: down, timeoutMs: 500 });
  expect(unreachable).toMatchObject({ mode: 'device', reason: 'database_unreachable', host: 'ep-fixture-123.eu-central-1.aws.neon.tech' });
  expect(unreachable.message).toMatch(/not answering/);
  const up = await core.status({ sql: fakeSql() });
  expect(up).toMatchObject({ mode: 'server', host: 'ep-fixture-123.eu-central-1.aws.neon.tech' });
  expect(up.message).toBe('Account saved in the database.');
  // A `select 1` that hangs is "unreachable", never "server": a mode decided
  // on a call that has not answered is a guess.
  const hang = () => new Promise(() => {});
  const slow = await core.status({ sql: hang, timeoutMs: 50 });
  expect(slow.mode).toBe('device');
  expect(slow.reason).toBe('database_unreachable');
});

test('the driver is built ONCE per URL and the schema ensured ONCE per warm instance, across gated requests; status is answered from cache', async () => {
  // The real driver path, with @neondatabase/serverless stubbed through
  // require.cache: `neon(url)` hands back the in-memory store, and every
  // construction is counted. verifyToken() is what requireUser() calls on
  // every gated request, so two of them in a row are the shape of two
  // requests to one warm instance.
  process.env.DATABASE_URL = 'postgres://u:p@ep-fixture.neon.tech/db';
  const NEON = require.resolve('@neondatabase/serverless');
  const realNeon = require.cache[NEON];
  const built = [];
  const store = fakeSql();
  require.cache[NEON] = { id: NEON, filename: NEON, loaded: true, exports: { neon: (url) => { built.push(url); return store; } } };
  try {
    const core = freshCore();
    const token = (await core.enter(store, Object.assign({ name: 'Asha', pin: PIN }, IN), 'ip')).body.token;
    store.db.log.length = 0;
    const a = await core.verifyToken(token);
    const b = await core.verifyToken(token);
    expect(a.ok && b.ok, 'the real driver path did not verify the session').toBe(true);
    expect(built, 'neon() was constructed more than once for one URL').toEqual(['postgres://u:p@ep-fixture.neon.tech/db']);
    const ddl = store.db.log.filter((t) => /^create (table|index)/.test(t));
    expect(ddl.length, 'the schema was ensured more than once (4 statements per run)').toBe(4);
    // A different URL gets its own client.
    process.env.DATABASE_URL = 'postgres://u:p@ep-other.neon.tech/db';
    await core.verifyToken(token);
    expect(built.length).toBe(2);
    // status: one probe answers two asks on a warm instance...
    process.env.DATABASE_URL = 'postgres://u:p@ep-fixture.neon.tech/db';
    store.db.log.length = 0;
    expect((await core.status()).mode).toBe('server');
    expect((await core.status()).mode).toBe('server');
    expect(store.db.log.filter((t) => t === 'select 1').length, 'status probed the database on every ask').toBe(1);
    // ...and an op on a warm instance costs neither DDL nor a probe of its own.
    store.db.log.length = 0;
    const me = mockRes();
    await core.handle({ method: 'GET', query: { action: 'auth', op: 'me' }, headers: { 'x-lifecycle-token': token } }, me.res);
    expect(me.out.code).toBe(200);
    expect(store.db.log.filter((t) => /^create /.test(t) || t === 'select 1'), 'a warm op re-ran setup work').toEqual([]);
    // A "device" answer is cached too, briefly: two asks while the database is
    // down cost one probe (a stream of requests must not each wait out the
    // probe's timeout), and its TTL is short so a database that comes back is
    // noticed within seconds, not thirty.
    core._reset();
    store.db.down = true;
    store.db.log.length = 0;
    expect((await core.status()).mode).toBe('device');
    expect((await core.status()).mode).toBe('device');
    expect(store.db.log.filter((t) => t === 'select 1').length, 'a down database was probed on every ask').toBe(1);
    store.db.down = false;
    expect(core.STATUS_TTL_MS.device).toBeLessThanOrEqual(5000);
    expect(core.STATUS_TTL_MS.server).toBeGreaterThanOrEqual(30000);
    // An injected sql bypasses the cache: a test always drives the real probe.
    expect((await core.status({ sql: store })).mode).toBe('server');
  } finally { if (realNeon) require.cache[NEON] = realNeon; else delete require.cache[NEON]; }
});

test('the token travels in X-Lifecycle-Token, then a bearer of our shape, then the body; a JWT is never mistaken for ours', () => {
  const core = freshCore();
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH';
  const own = core.newToken();
  expect(core.looksLikeToken(own)).toBe(true);
  expect(core.looksLikeToken(jwt), 'a Supabase JWT read as a mobile token').toBe(false);
  expect(core.tokenOf({ headers: { 'x-lifecycle-token': own } })).toBe(own);
  expect(core.tokenOf({ headers: { authorization: 'Bearer ' + own } })).toBe(own);
  expect(core.tokenOf({ headers: { authorization: 'Bearer ' + jwt } }), 'a JWT bearer was taken as ours').toBe('');
  expect(core.tokenOf({ headers: {}, body: { token: own } })).toBe(own);
  expect(core.tokenOf({ headers: {}, body: {} })).toBe('');
  expect(core.tokenHash(own)).toBe(sha(own));
  expect(core.tokenHash(own)).not.toBe(own);
});

/* ═══════════════════════════════════════════════════════════════════════════
   B. THE SHIPPED ENTRY POINT, EXECUTED
   ═══════════════════════════════════════════════════════════════════════════ */

function mockRes() {
  const out = { code: 0, body: null, headers: {} };
  const res = {
    status(c) { out.code = c; return res; },
    json(b) { out.body = b; return res; },
    setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; },
    removeHeader(k) { delete out.headers[String(k).toLowerCase()]; },
    end() { return res; },
  };
  return { res, out };
}

/** The shipped router, with the core's `handle` given the fake store through require.cache. */
function publicConfigWith(store) {
  delete require.cache[PUBLIC_CONFIG];
  delete require.cache[CORE];
  const real = require(CORE);
  if (store) {
    const proxy = Object.assign({}, real, { handle: (req, res) => real.handle(req, res, { sql: store }), verifyToken: (t) => real.verifyToken(t, { sql: store }) });
    require.cache[CORE] = { id: CORE, filename: CORE, loaded: true, exports: proxy };
  }
  return require(PUBLIC_CONFIG);
}
test.afterEach(() => { delete require.cache[CORE]; delete require.cache[PUBLIC_CONFIG]; delete require.cache[BRAND_CORE]; delete require.cache[CREDITS]; });

test('public-config?action=auth&op=status answers device mode when there is no DATABASE_URL, and enter says so instead of pretending', async () => {
  const handler = publicConfigWith(null);
  const st = mockRes();
  await handler({ method: 'GET', query: { action: 'auth', op: 'status' }, headers: {} }, st.res);
  expect(st.out.code).toBe(200);
  expect(st.out.body).toMatchObject({ ok: true, mode: 'device', reason: 'no_database_url' });
  expect(st.out.headers['cache-control']).toBe('no-store');
  expect(st.out.headers['access-control-allow-headers']).toMatch(/X-Lifecycle-Token/);

  const en = mockRes();
  await handler({ method: 'POST', query: { action: 'auth', op: 'enter' }, headers: {}, body: Object.assign({ name: 'Asha', pin: PIN }, IN) }, en.res);
  expect(en.out.code).toBe(503);
  expect(en.out.body).toMatchObject({ ok: false, error: 'no_database', mode: 'device' });
  expect(en.out.body.message).toMatch(/No database is configured/);
  expect(en.out.body.token).toBeUndefined();

  const bad = mockRes();
  await handler({ method: 'GET', query: { action: 'auth', op: 'frobnicate' }, headers: {} }, bad.res);
  expect(bad.out.code).toBe(400);
  expect(bad.out.body.available).toEqual(['status', 'enter', 'me', 'signout', 'signout_all']);
});

test('public-config?action=auth signs up, answers me, and signs out through the shipped handler', async () => {
  process.env.DATABASE_URL = 'postgres://u:p@ep-fixture.neon.tech/db';
  const store = fakeSql();
  const handler = publicConfigWith(store);
  const st = mockRes();
  await handler({ method: 'GET', query: { action: 'auth', op: 'status' }, headers: {} }, st.res);
  expect(st.out.body).toMatchObject({ mode: 'server', host: 'ep-fixture.neon.tech' });

  const en = mockRes();
  await handler({ method: 'POST', query: { action: 'auth', op: 'enter' }, headers: { 'x-forwarded-for': '203.0.113.5' }, body: Object.assign({ name: 'Asha', pin: PIN }, IN) }, en.res);
  expect(en.out.code).toBe(200);
  expect(en.out.body).toMatchObject({ ok: true, created: true, mode: 'server' });
  const token = en.out.body.token;

  const me = mockRes();
  await handler({ method: 'GET', query: { action: 'auth', op: 'me' }, headers: { 'x-lifecycle-token': token } }, me.res);
  expect(me.out.code).toBe(200);
  expect(me.out.body.user).toMatchObject({ name: 'Asha', phone: '+919876543210' });

  const get = mockRes();
  await handler({ method: 'GET', query: { action: 'auth', op: 'enter' }, headers: {} }, get.res);
  expect(get.out.code, 'enter must be a POST').toBe(405);

  const out = mockRes();
  await handler({ method: 'POST', query: { action: 'auth', op: 'signout' }, headers: { authorization: 'Bearer ' + token }, body: {} }, out.res);
  expect(out.out.body).toMatchObject({ ok: true, signed_out: true });
  const gone = mockRes();
  await handler({ method: 'GET', query: { action: 'auth', op: 'me' }, headers: { 'x-lifecycle-token': token } }, gone.res);
  expect(gone.out.code).toBe(401);
});

/* ═══════════════════════════════════════════════════════════════════════════
   C. THE GATES
   ═══════════════════════════════════════════════════════════════════════════ */

test('requireUser accepts a server-mode token, and refuses an unverifiable one exactly like an anonymous call', async () => {
  process.env.DATABASE_URL = 'postgres://u:p@ep-fixture.neon.tech/db';
  process.env.SUPABASE_URL = 'https://live.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const store = fakeSql();
  publicConfigWith(store);                       // installs the fake-store core in require.cache
  delete require.cache[BRAND_CORE];
  const brand = require(BRAND_CORE);
  const core = require(CORE);
  const token = (await core.enter(store, Object.assign({ name: 'Asha', pin: PIN }, IN), 'ip')).body.token;

  const realFetch = global.fetch;
  const fetches = [];
  global.fetch = async (u) => { fetches.push(String(u)); throw new Error('no network in this test'); };
  try {
    const ok = await brand.requireUser({ headers: { 'x-lifecycle-token': token } });
    expect(ok).toMatchObject({ ok: true, provider: 'mobile-pin', phone: '+919876543210', name: 'Asha', email: '' });
    expect(ok.user_id).toBe(store.db.app_users[0].id);
    expect(fetches, 'a mobile token was sent to Supabase for verification').toEqual([]);

    const anon = await brand.requireUser({ headers: {} });
    // A device-mode token is 43 base64url characters the server has never
    // seen. With a database it must get the SAME status and code as no token.
    const device = await brand.requireUser({ headers: { 'x-lifecycle-token': core.newToken() } });
    expect(device.ok).toBe(false);
    expect([device.status, device.error]).toEqual([anon.status, anon.error]);
    expect(device.error).toBe('sign_in_required');
    expect(device.message).toMatch(/not signed in/i);
    // ...and nothing about it is trusted from the body.
    const forged = await brand.requireUser({ headers: {}, body: { token: core.newToken(), user: { id: 'forged' } } });
    expect(forged.ok).toBe(false);
    expect(forged.error).toBe('sign_in_required');
    expect(fetches).toEqual([]);
  } finally { global.fetch = realFetch; }

  // With NO database a well-shaped token from a page is a device principal;
  // without Origin it is still anonymous (a well-shaped token is not a secret).
  delete process.env.DATABASE_URL;
  delete require.cache[BRAND_CORE]; delete require.cache[CORE];
  const brand2 = require(BRAND_CORE);
  const noOrigin = await brand2.requireUser({ headers: { 'x-lifecycle-token': token } });
  expect(noOrigin).toMatchObject({ ok: false, status: 401, error: 'sign_in_required' });
  expect(String(noOrigin.message)).toMatch(/did not come from a page/i);
  const fromPage = await brand2.requireUser({
    headers: { 'x-lifecycle-token': token, origin: 'https://app.example.test' },
  });
  expect(fromPage.ok, JSON.stringify(fromPage)).toBe(true);
  expect(fromPage.mode).toBe('device');
  expect(fromPage.phone).toBe('');
});

test('restAs refuses a phone account with a sentence, before any PostgREST call', async () => {
  process.env.SUPABASE_URL = 'https://live.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  delete require.cache[BRAND_CORE]; delete require.cache[CORE];
  const brand = require(BRAND_CORE);
  const core = require(CORE);
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 401, text: async () => '{"message":"JWT"}', statusText: 'Unauthorized' }; };
  try {
    await expect(brand.restAs(core.newToken(), 'brand_workspaces?select=id')).rejects.toMatchObject({ status: 403, code: 'account_type_unsupported' });
    expect(calls, 'PostgREST was called with a mobile token').toBe(0);
  } finally { global.fetch = realFetch; }
});

test('the credit meter refuses a phone account before a wallet could be created', async () => {
  process.env.SUPABASE_URL = 'https://live.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';      // the meter IS configured: the refusal must not depend on it being off
  delete require.cache[CREDITS]; delete require.cache[BRAND_CORE]; delete require.cache[CORE];
  const credits = require(CREDITS);
  const realFetch = global.fetch;
  const urls = [];
  global.fetch = async (u) => { urls.push(String(u)); return { ok: true, status: 200, text: async () => '[]', json: async () => [] }; };
  try {
    const m = await credits.meter({ query: {}, body: {} }, 'analytics.run', { auth: { ok: true, provider: 'mobile-pin', user_id: 'aaaaaaaa-0000-4000-8000-000000000001', email: '' } });
    expect(m).toMatchObject({ ok: false, status: 403, error: 'credits_require_account' });
    expect(m.message).toMatch(/mobile-number sign-in has no wallet/);
    expect(urls.filter((u) => /credit_wallets|credit_ledger|rpc\/credit_/.test(u)), 'a wallet was touched for a phone account').toEqual([]);
  } finally { global.fetch = realFetch; }
});

/* ═══════════════════════════════════════════════════════════════════════════
   D. THE REAL PAGES, IN CHROMIUM
   ═══════════════════════════════════════════════════════════════════════════ */

let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

/**
 * Every page that LOADS auth.js - a <script src>, not a mention. campaign.html
 * says "auth.js" in a comment explaining why it deliberately does not load it
 * (it document.write()s an artefact over itself), so it has no rail and no
 * Sign in chip.
 */
const PAGES = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  .filter((f) => /<script[^>]+src=["'][^"']*\bauth\.js/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  .sort();

const WITH_BACKEND = { supabase: { url: 'https://live.supabase.co', anonKey: 'anon' } };
const DEVICE_STATUS = { ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured. Set DATABASE_URL to keep accounts in a database.' };

/**
 * A tiny in-test server for the auth endpoint: the same state machine, so the
 * page's server-mode flow can be driven without Neon. `store.answer` lets a
 * case override any op.
 */
function authServer() {
  const store = { users: {}, sessions: {}, calls: [], mode: 'server', answer: null, status: { ok: true, mode: 'server', host: 'ep-fixture.neon.tech', message: 'Account saved in the database.' } };
  store.handle = (op, method, headers, body) => {
    store.calls.push({ op, method, headers, body });
    if (store.answer) { const a = store.answer(op, headers, body); if (a) return a; }
    if (op === 'status') return { status: 200, body: store.status };
    if (store.mode !== 'server') return { status: 503, body: { ok: false, error: 'database_unreachable', mode: 'device', host: store.status.host, message: 'The database (' + store.status.host + ') is not answering, so "' + op + '" cannot run on the server right now.' } };
    const token = headers['x-lifecycle-token'] || (headers.authorization || '').replace(/^Bearer /, '') || (body && body.token) || '';
    if (op === 'me') { const s = store.sessions[token]; return s ? { status: 200, body: { ok: true, mode: 'server', user: store.users[s], message: store.status.message } } : { status: 401, body: { ok: false, error: 'invalid_session', message: 'Your sign-in has expired or was signed out.' } }; }
    if (op === 'signout') { delete store.sessions[token]; return { status: 200, body: { ok: true, mode: 'server', signed_out: true } }; }
    if (op === 'enter') {
      const phone = '+91' + String(body.phone || '').replace(/\D/g, '');
      let u = store.users[phone];
      if (!u) {
        if (!body.name) return { status: 200, body: { ok: true, exists: false } };
        if (!/^\d{4}$/.test(body.pin || '')) return { status: 200, body: { ok: true, exists: false, needPin: true, error: 'pin_invalid', message: 'Your PIN is 4 digits.' } };
        u = { id: 'srv-' + Object.keys(store.users).length, name: body.name, phone, pin: body.pin, tries: 0 };
        store.users[phone] = u;
      } else {
        if (!body.pin) return { status: 200, body: { ok: true, exists: true, needPin: true } };
        if (body.pin !== u.pin) { u.tries++; return { status: 401, body: { ok: false, wrongPin: true, left: 5 - u.tries, error: 'pin_wrong', message: 'That PIN is not right. ' + (5 - u.tries) + ' tries left.' } }; }
      }
      const tok = 'srvtok_' + Math.random().toString(36).slice(2).padEnd(38, 'x');
      store.sessions[tok] = phone;
      return { status: 200, body: { ok: true, exists: true, token: tok, mode: 'server', expires: new Date(Date.now() + 90 * 86400000).toISOString(), user: { id: u.id, name: u.name, phone } } };
    }
    return { status: 400, body: { ok: false, error: 'unknown_auth_operation' } };
  };
  return store;
}

/** Serve a page from 127.0.0.1 with a live Supabase config (so the localhost preview stub is NOT taken) and the given auth server. */
async function open(page, file, opts) {
  const o = opts || {};
  const log = { dialogs: [], errors: [], apiHeaders: [], navigations: [] };
  page.on('dialog', (d) => { log.dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) log.navigations.push(f.url()); });
  await page.addInitScript(() => {
    window.__OAUTH_CALLS__ = [];
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async (x) => { window.__OAUTH_CALLS__.push(x); return { error: null }; },
          signOut: async () => ({}),
        },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      }),
    };
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    if (/\/auth\/v1\/health/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/\/auth\/v1\/authorize/.test(url)) { log.navigations.push(url); return route.abort('failed'); }
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(url);
    return route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: esm ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};window.Papa=window.Papa||{parse(){}};',
    });
  });
  await page.route(/\/api\//, (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const headers = req.headers();
    log.apiHeaders.push({ url: u.pathname + u.search, authorization: headers.authorization || '', token: headers['x-lifecycle-token'] || '' });
    const action = u.searchParams.get('action');
    if (action === 'auth') {
      const op = u.searchParams.get('op');
      let body = {};
      try { body = req.postDataJSON() || {}; } catch (_) { body = {}; }
      const r = o.auth ? o.auth.handle(op, req.method(), headers, body) : (op === 'status' ? { status: 200, body: DEVICE_STATUS } : { status: 503, body: { ok: false, error: 'no_database', mode: 'device', message: 'No database is configured on this deployment, so "' + op + '" cannot run on the server.' } });
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    }
    if (!action && !u.searchParams.has('health')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WITH_BACKEND) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }) });
  });
  await page.goto(base + '/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending'), null, { timeout: 15000 });
  return log;
}

/** Press the rail's Sign-in; dispatch the click where a fixed element overlaps the footer. */
async function pressSignIn(page) {
  const btn = page.locator('#lnav-signin');
  await btn.waitFor({ state: 'attached', timeout: 15000 });
  try { await btn.click({ timeout: 4000 }); } catch (e) {
    if (!/intercepts pointer events|Timeout/.test(String(e.message))) throw e;
    await btn.evaluate((el) => el.click());
  }
  await page.waitForSelector('#lnav-mauth', { state: 'attached', timeout: 5000 });
}

const readAuth = (page) => page.evaluate(() => {
  const a = window.LifecycleAuth || {};
  const bc = window.BrandContext;
  let storage = null;
  try { storage = bc && bc.storage ? bc.storage() : null; } catch (_) {}
  return {
    name: (document.querySelector('#lifecycle-nav .lnav-uname') || {}).textContent || null,
    signin: !!document.querySelector('#lnav-signin'),
    umode: (document.querySelector('#lnav-umode') || {}).textContent || null,
    panel: !!document.querySelector('#lnav-mauth'),
    state: (document.querySelector('#lnav-mauth') || { getAttribute: () => null }).getAttribute('data-state'),
    modeLine: (document.querySelector('#lnav-mauth-mode') || {}).textContent || null,
    err: (document.querySelector('#lnav-mauth-err') || {}).textContent || '',
    session: a.session ? { provider: a.session.provider, mode: a.session.mode, hasToken: !!a.session.access_token, user: a.session.user, verified: a.session.verified } : null,
    user: a.user || null,
    internal: a.internal,
    backend: a.backend ? { kind: a.backend.kind, session: a.backend.session, supabase: a.backend.supabase } : null,
    stored: (() => { try { return JSON.parse(localStorage.getItem('lifecycle.auth.session') || 'null'); } catch (_) { return null; } })(),
    users: (() => { try { return JSON.parse(localStorage.getItem('lifecycle.auth.device.users') || 'null'); } catch (_) { return null; } })(),
    storage: storage ? { mode: storage.mode, session: storage.session, sentence: storage.account_sentence, serverOpen: storage.server_open } : null,
    google: /Sign in with (Google|Gmail)/i.test(document.body.innerText || ''),
    oauth: (window.__OAUTH_CALLS__ || []).length,
    noteKind: (document.getElementById('lnav-signin-note') || { getAttribute: () => null }).getAttribute('data-kind'),
  };
});

async function typeAndContinue(page, fields) {
  for (const [id, value] of Object.entries(fields)) {
    if (id === 'cc') await page.selectOption('#lnav-mauth-cc', value);
    else await page.fill('#lnav-mauth-' + id, value);
  }
  await page.click('#lnav-mauth-go');
  await page.waitForTimeout(150);
}

test('DEVICE MODE: sign-up in the rail panel, a reload keeps the session, five wrong PINs lock the account, sign out', async ({ page }) => {
  test.setTimeout(120_000);
  const log = await open(page, 'smart-brain.html');
  let a = await readAuth(page);
  expect(a.signin, 'no Sign in chip to press').toBe(true);
  expect(a.session).toBeNull();

  await pressSignIn(page);
  await expect(page.locator('#lnav-mauth-mode')).toHaveText(/Saved on this device only: no database is configured/, { timeout: 8000 });
  expect(await page.evaluate(() => location.pathname)).toContain('smart-brain.html');

  // The number first. A new number is SAID to be new, then asks for a name
  // and a PIN in one step.
  await typeAndContinue(page, { cc: '+91', phone: '98765 43210' });
  await page.waitForSelector('#lnav-mauth[data-state="new"]');
  expect(await page.locator('#lnav-mauth-newnote').textContent()).toMatch(/This number is new here/);
  expect(await page.locator('#lnav-mauth-go').textContent()).toMatch(/Create my account and continue/);
  // A weak PIN is refused by the browser's own rules, with the sentence.
  await typeAndContinue(page, { name: 'Asha', pin: '1234' });
  await expect(page.locator('#lnav-mauth-err')).toContainText(/first anyone would try/);
  expect(await page.locator('#lnav-mauth-err [data-failure]').count(), 'the refusal is not in the failure frame').toBe(1);
  await typeAndContinue(page, { pin: PIN });
  await page.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 8000 });

  a = await readAuth(page);
  expect(a.name).toBe('Asha');
  expect(a.panel, 'the panel stayed open after signing in').toBe(false);
  expect(a.session).toMatchObject({ provider: 'mobile-pin', mode: 'device', hasToken: true, user: { name: 'Asha', phone: '+919876543210' } });
  expect(a.user.provider).toBe('mobile-pin');
  expect(a.internal, 'a phone account was granted internal access').toBe(false);
  expect(a.backend.kind).toBe('signed-in');
  expect(a.backend.session).toMatchObject({ provider: 'mobile-pin', mode: 'device', name: 'Asha' });
  expect(a.umode).toMatch(/Local \/ Demo Mode/);
  expect(a.umode).toMatch(/Saved on this device only: no database is configured/);
  expect(a.stored).toMatchObject({ mode: 'device', user: { name: 'Asha', phone: '+919876543210' } });
  // The device store holds a PBKDF2 hash, never the PIN, and the lockout fields.
  const u = a.users['+919876543210'];
  expect(u).toMatchObject({ name: 'Asha', tries: 0, lockedUntil: null });
  expect(u.hash).toMatch(/^[0-9a-f]{64}$/);
  expect(u.salt).toMatch(/^[0-9a-f]{32}$/);
  expect(u.iterations).toBeGreaterThanOrEqual(100000);
  // No stored value is the PIN (a substring check over random hex is flaky: the
  // salt or hash can contain the four digits by chance, and did once in CI).
  expect(Object.values(u).map(String)).not.toContain(PIN);
  expect(Object.keys(u)).not.toContain('pin');
  // Brand ops route to the device store, and the sentence says both halves.
  expect(a.storage.mode).toBe('device');
  expect(a.storage.sentence).toBe('Signed in as Asha · workspaces are saved on this device');
  // A device sign-in's token is sent and, with no database, the server admits
  // it as a device principal from a page (#115) - so "Read my site" is ON for
  // it (2026-10-03: signing in with a phone never turns a feature off).
  expect(a.storage.serverOpen, 'a device sign-in turned "Read my site" off, though the server reads the site for it').toBe(true);
  // Sign-in itself stays local: no enter, no me. The device token IS sent on
  // API calls so features can run (2026-09-30).
  expect(log.apiHeaders.filter((h) => /op=enter|op=me/.test(h.url))).toEqual([]);
  expect(await page.evaluate(() => window.LifecycleAuth.apiToken())).toMatch(/^[A-Za-z0-9_-]{40,90}$/);
  await page.evaluate(() => fetch('/api/public-config?action=brand&op=active', { cache: 'no-store' }).then((r) => r.json()));
  const brandCall = log.apiHeaders.filter((h) => /op=active/.test(h.url)).pop();
  expect(brandCall, 'the probe request was not seen').toBeTruthy();
  const sent = (brandCall.token || '').trim() || String(brandCall.authorization || '').replace(/^Bearer\s+/i, '').trim();
  expect(sent, 'a device-mode token was not sent on an API call').toMatch(/^[A-Za-z0-9_-]{40,90}$/);

  // A reload keeps the session, without asking the server anything.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 8000 });
  a = await readAuth(page);
  expect(a.name).toBe('Asha');
  expect(a.session.mode).toBe('device');
  expect(log.apiHeaders.filter((h) => /op=me/.test(h.url)), 'a device session was validated with the server').toEqual([]);

  // Sign out: the chip goes, the session goes, the account stays.
  await page.locator('#lnav-signout').evaluate((el) => el.click());
  await page.waitForFunction(() => !!document.querySelector('#lnav-signin'), null, { timeout: 8000 });
  a = await readAuth(page);
  expect(a.session).toBeNull();
  expect(a.stored).toBeNull();
  expect(a.users['+919876543210'], 'signing out deleted the account').toBeTruthy();

  // Five wrong PINs lock it; the right PIN does not open it while locked.
  await pressSignIn(page);
  await typeAndContinue(page, { cc: '+91', phone: '9876543210' });
  await page.waitForSelector('#lnav-mauth[data-state="need-pin"]');
  // No name before the PIN: anyone can type any number.
  expect(await page.locator('#lnav-mauth-pinnote').textContent()).toBe('Welcome back. Type your PIN.');
  expect(await page.locator('#lnav-mauth-go').textContent()).toBe('Sign in');
  const lefts = [];
  for (let i = 0; i < 5; i++) {
    await typeAndContinue(page, { pin: '1357' });
    await page.waitForFunction(() => /left|Too many/.test((document.getElementById('lnav-mauth-err') || {}).textContent || ''), null, { timeout: 5000 });
    const txt = await page.locator('#lnav-mauth-err').textContent();
    const m = txt.match(/(\d) (?:try|tries) left/);
    lefts.push(m ? Number(m[1]) : txt);
  }
  expect(lefts.slice(0, 4)).toEqual([4, 3, 2, 1]);
  expect(lefts[4]).toMatch(/Too many wrong PINs\. Try again in 15 minutes\./);
  expect(await page.locator('#lnav-mauth').getAttribute('data-state')).toBe('locked');
  await typeAndContinue(page, { pin: PIN });
  await page.waitForTimeout(400);
  a = await readAuth(page);
  expect(a.session, 'the right PIN opened a locked account').toBeNull();
  expect(a.err).toMatch(/Too many wrong PINs/);
  expect(a.users['+919876543210'].lockedUntil).toBeTruthy();
  expect(log.dialogs).toEqual([]);
  expect(log.errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e))).toEqual([]);
  expect(a.oauth).toBe(0);
  expect(a.google).toBe(false);
});

test('SERVER MODE: the account goes to the database, the token travels in the header, op=me validates every boot, a 401 clears it, an unreachable database is SAID', async ({ page }) => {
  test.setTimeout(120_000);
  const auth = authServer();
  const log = await open(page, 'onboarding.html', { auth });
  await pressSignIn(page);
  await expect(page.locator('#lnav-mauth-mode')).toHaveText('Account saved in the database.', { timeout: 8000 });
  await typeAndContinue(page, { cc: '+91', phone: '9876543210' });
  await page.waitForSelector('#lnav-mauth[data-state="new"]');
  await typeAndContinue(page, { name: 'Ravi', pin: PIN });
  await page.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 8000 });

  let a = await readAuth(page);
  expect(a.name).toBe('Ravi');
  expect(a.session).toMatchObject({ provider: 'mobile-pin', mode: 'server', hasToken: true, verified: true });
  expect(a.umode).toBe('Account saved in the database.');
  expect(a.internal).toBe(false);
  expect(a.storage.mode, 'a phone account keeps its workspaces on the device even in server mode').toBe('device');
  expect(a.storage.sentence).toBe('Signed in as Ravi · workspaces are saved on this device · account in the database');
  expect(a.storage.serverOpen, 'a server-mode session is checkable, so extract is open').toBe(true);
  expect(a.users, 'a server-mode sign-up wrote a device account').toBeNull();
  const enter = auth.calls.filter((c) => c.op === 'enter');
  expect(enter.length).toBe(2);
  expect(enter[1].body).toMatchObject({ phone: '9876543210', cc: '+91', name: 'Ravi', pin: PIN });
  const token = Object.keys(auth.sessions)[0];
  expect(a.stored.token).toBe(token);

  // Same-origin API calls now carry the token, in both headers.
  await page.evaluate(() => fetch('/api/public-config?action=brand&op=active', { cache: 'no-store' }).then((r) => r.json()));
  const call = log.apiHeaders.filter((h) => /op=active/.test(h.url)).pop();
  expect(call.token).toBe(token);
  expect(call.authorization).toBe('Bearer ' + token);

  // A reload validates with op=me, once, with the token; the chip persists.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 8000 });
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.session && window.LifecycleAuth.session.verified === true, null, { timeout: 8000 });
  const me = auth.calls.filter((c) => c.op === 'me');
  expect(me.length).toBe(1);
  expect(me[0].headers['x-lifecycle-token']).toBe(token);
  a = await readAuth(page);
  expect(a.name).toBe('Ravi');

  // The database stops answering: the session is KEPT, and the line says so
  // rather than showing a device sign-up as if it were the same account.
  auth.mode = 'device';
  auth.status = { ok: true, mode: 'device', reason: 'database_unreachable', host: 'ep-fixture.neon.tech', message: 'Saved on this device only: the database (ep-fixture.neon.tech) is not answering.' };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 8000 });
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.session && window.LifecycleAuth.session.verified === false, null, { timeout: 8000 });
  a = await readAuth(page);
  expect(a.name).toBe('Ravi');
  expect(a.session.verified).toBe(false);
  expect(a.umode).toMatch(/Account in the database \(ep-fixture\.neon\.tech\), which is not answering right now/);
  // Its database is not answering, so the server cannot verify it - and for
  // exactly that request (backend_unreachable) it opens extract's own path and
  // reads the public site with the model off. ON is what the server does.
  expect(a.storage.serverOpen, 'the wizard says OFF where the server reads the site').toBe(true);
  // Opening the panel in this state warns that a sign-up here is a SEPARATE account.
  await page.evaluate(() => window.LifecycleAuth.openSignIn());
  await expect(page.locator('#lnav-mauth-mode')).toContainText(/separate account on this device only/, { timeout: 8000 });
  await expect(page.locator('#lnav-mauth-mode')).toContainText(/ep-fixture\.neon\.tech/);
  await page.click('#lnav-mauth-cancel');

  // The session was signed out elsewhere (or expired): a 401 clears it and says so.
  auth.mode = 'server';
  auth.status = { ok: true, mode: 'server', host: 'ep-fixture.neon.tech', message: 'Account saved in the database.' };
  delete auth.sessions[token];
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('#lnav-signin'), null, { timeout: 8000 });
  a = await readAuth(page);
  expect(a.session).toBeNull();
  expect(a.stored).toBeNull();
  expect(a.noteKind).toBe('expired');
  expect(await page.locator('#lnav-signin-note').textContent()).toMatch(/expired or was signed out/);
  expect(a.backend.kind).toBe('signed-out');

  // Sign in again, then Sign out: the server is told, with the token.
  await pressSignIn(page);
  await typeAndContinue(page, { cc: '+91', phone: '9876543210' });
  await page.waitForSelector('#lnav-mauth[data-state="need-pin"]');
  await typeAndContinue(page, { pin: PIN });
  await page.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 8000 });
  const second = Object.keys(auth.sessions)[0];
  await page.locator('#lnav-signout').evaluate((el) => el.click());
  await page.waitForFunction(() => !!document.querySelector('#lnav-signin'), null, { timeout: 8000 });
  const out = auth.calls.filter((c) => c.op === 'signout');
  expect(out.length).toBe(1);
  expect(out[0].headers['x-lifecycle-token']).toBe(second);
  expect(Object.keys(auth.sessions)).toEqual([]);
  expect(log.dialogs).toEqual([]);
  expect(log.errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e))).toEqual([]);
});

/* ── the rail's panel, driven: sign up / sign in / sign out (the page reloads on sign-out) ── */
async function signUp(page, phone, name, pin) {
  await pressSignIn(page);
  await typeAndContinue(page, { cc: '+91', phone });
  await page.waitForSelector('#lnav-mauth[data-state="new"]');
  await typeAndContinue(page, { name, pin });
  await page.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 8000 });
}
async function signIn(page, phone, pin) {
  await pressSignIn(page);
  await typeAndContinue(page, { cc: '+91', phone });
  await page.waitForSelector('#lnav-mauth[data-state="need-pin"]');
  await typeAndContinue(page, { pin });
  await page.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 8000 });
}
async function signOut(page) {
  await page.locator('#lnav-signout').evaluate((el) => el.click());
  await page.waitForFunction(() => !!document.querySelector('#lnav-signin'), null, { timeout: 8000 });
  await page.waitForFunction(() => !!(window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending'), null, { timeout: 15000 });
}
const DEVICE_STORE = 'lifecycle.brand.device.workspaces';

test('REVIEW P1: on a shared browser the device store is the signed-in account\'s own - B never sees A\'s brands, sign-in adopts no anonymous rows, sign-out deletes none', async ({ page }) => {
  test.setTimeout(180_000);
  const log = await open(page, 'smart-brain.html');
  const names = () => page.evaluate(() => window.BrandContext.api('list').then((r) => r.workspaces.map((w) => w.name)));
  const save = (name) => page.evaluate((n) => window.BrandContext.api('save', { body: { brand: { name: n, palette: { primary: '#1a6b3c', accent: '#b8531f', ink: '#111111', surface: '#ffffff' } } } }).then((r) => r.brand.id), name);
  const storeKeys = () => page.evaluate((k) => Object.keys(localStorage).filter((x) => x.indexOf(k) === 0).sort(), DEVICE_STORE);
  const painted = () => page.evaluate(() => (window.BrandContext.brand && window.BrandContext.brand.name) || null);

  // 1. Nobody is signed in. A brand typed now lives under the unscoped key -
  //    the state onboarding-without-backend relies on - and is painted.
  await save('Anonymous Draft');
  expect(await names()).toEqual(['Anonymous Draft']);
  await page.evaluate(() => window.BrandContext.refresh());
  expect(await painted()).toBe('Anonymous Draft');

  // 2. A signs up. Her list is EMPTY: a sign-in does not silently adopt what an
  //    anonymous visitor typed, and what they typed stops being on screen.
  await signUp(page, '9876543210', 'Asha', PIN);
  const aId = await page.evaluate(() => window.LifecycleAuth.session.user.id);
  expect(await names(), 'signing in adopted the anonymous rows').toEqual([]);
  await page.waitForFunction(() => !window.BrandContext.brand, null, { timeout: 8000 }).catch(() => {});
  expect(await painted(), 'the anonymous brand stayed on screen after A signed in').toBeNull();
  await save('Asha Brand');
  expect(await names()).toEqual(['Asha Brand']);

  // 3. A signs out (the page reloads). The anonymous draft is still there -
  //    sign-out deletes nothing - and A's brand is not.
  await signOut(page);
  expect(await names(), 'signing out deleted the anonymous rows, or left A\'s in the open').toEqual(['Anonymous Draft']);

  // 4. B signs up on the same browser: EMPTY. Not A's brand, not the anonymous one.
  await signUp(page, '9123456780', 'Bala', '8052');
  const bId = await page.evaluate(() => window.LifecycleAuth.session.user.id);
  expect(bId).not.toBe(aId);
  expect(await names(), 'B sees brands that are not hers').toEqual([]);
  await page.waitForFunction(() => !window.BrandContext.brand, null, { timeout: 8000 }).catch(() => {});
  expect(await painted(), 'another account\'s brand stayed on screen after B signed in').toBeNull();
  await save('Bala Brand');
  expect(await names()).toEqual(['Bala Brand']);
  await signOut(page);

  // 5. A signs back in: her brand is back, painted, and only hers.
  await signIn(page, '9876543210', PIN);
  expect(await names()).toEqual(['Asha Brand']);
  await page.waitForFunction(() => window.BrandContext.brand && window.BrandContext.brand.name === 'Asha Brand', null, { timeout: 8000 }).catch(() => {});
  expect(await painted(), 'A\'s own brand was not painted when she signed back in').toBe('Asha Brand');
  // A reload paints it from the first frame, from her namespace.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded, null, { timeout: 15000 });
  expect(await painted()).toBe('Asha Brand');
  expect(await names()).toEqual(['Asha Brand']);

  // Three namespaces, nothing lost: the anonymous key and one per account.
  expect(await storeKeys()).toEqual([DEVICE_STORE, DEVICE_STORE + '.' + aId, DEVICE_STORE + '.' + bId].sort());
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).workspaces.map((w) => w.name), DEVICE_STORE)).toEqual(['Anonymous Draft']);
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).workspaces.map((w) => w.name), DEVICE_STORE + '.' + bId)).toEqual(['Bala Brand']);
  expect(log.dialogs).toEqual([]);
  expect(log.errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e))).toEqual([]);
});

/* ═══════════════════════════════════════════════════════════════════════════
   E. FOUND BY DRIVING PRODUCTION'S DEPLOYED BYTES (2026-09-29)
   The live host cannot be opened from the CI container, so the files Vercel
   serves for the production deployment (commit 2b2a992, verified byte for
   byte) were served from 127.0.0.1 and the whole flow was driven in Chromium.
   Each test below reproduces a defect that drive found BEFORE the fix, or
   closes a gap it showed in this suite's coverage.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Is the rail drawer's backdrop over the page right now, and is the rail a drawer at all? */
const coverOf = (p) => p.evaluate(() => {
  const nav = document.getElementById('lifecycle-nav');
  const bd = document.getElementById('lnav-backdrop');
  const burger = document.getElementById('lnav-burger');
  const el = document.elementFromPoint(Math.round(innerWidth * 0.6), Math.round(innerHeight * 0.5));
  return {
    navOpen: !!(nav && nav.classList.contains('open')),
    blocks: !!(el && el.id === 'lnav-backdrop'),
    pointer: bd ? getComputedStyle(bd).pointerEvents : null,
    opacity: bd ? Number(getComputedStyle(bd).opacity) : null,
    // Rendered, not `display`: the burger's own computed display is `flex` on
    // a desktop too, because it is its parent bar the media query hides.
    burger: burger && burger.getClientRects().length > 0 ? 'rendered' : 'none',
  };
});

test('PROD DRIVE: the panel opens the rail drawer only where the rail IS a drawer, and closes what it opened - a desktop page is never dimmed or blocked after Sign in, sign-in or Cancel; on a phone the drawer the panel opened closes on sign-in and one the person opened stays', async ({ page, browser }) => {
  test.setTimeout(150_000);
  // The finding: mauthOpenPanel() added `open` to #lifecycle-nav
  // unconditionally ("the rail is a drawer on a phone"), and the drawer's
  // backdrop - a 55% black, pointer-catching sheet - is not scoped to the
  // phone breakpoint. On a 1280px desktop, where the rail is always visible,
  // pressing Sign in dimmed the whole page, and it STAYED dim and unclickable
  // after the person had signed in or pressed Cancel: the wizard's own Next
  // button could not be pressed (Playwright: "#lnav-backdrop intercepts
  // pointer events"). The only ways out were clicking the dark area or
  // pressing Escape, and nothing said so.
  const log = await open(page, 'smart-brain.html');
  let c = await coverOf(page);
  expect(c.burger, 'at 1280px the rail is not a drawer, so there is nothing to open').toBe('none');
  await pressSignIn(page);
  c = await coverOf(page);
  expect(c.navOpen, 'pressing Sign in on a desktop switched the phone drawer on').toBe(false);
  expect(c.blocks, 'the backdrop sits over the page content while the panel is open').toBe(false);
  await page.click('#lnav-mauth-cancel');
  c = await coverOf(page);
  expect(c.navOpen || c.blocks, 'Cancel left the page dimmed').toBe(false);
  await signUp(page, '9876543210', 'Asha', PIN);
  c = await coverOf(page);
  expect(c.navOpen, 'the drawer class was left on after signing in').toBe(false);
  expect(c.blocks, 'the page is dimmed and unclickable after signing in').toBe(false);
  expect(c.pointer).toBe('none');
  expect(c.opacity).toBe(0);
  // A real click on the page's own content is not intercepted. `trial` runs
  // Playwright's actionability checks - the same ones that reported the
  // defect - without dispatching the click.
  await page.locator('h1').first().click({ trial: true, timeout: 5000 });
  expect(log.dialogs).toEqual([]);

  // On a phone the rail IS a drawer: the panel opens it (the chip lives in
  // it), and closes it again on sign-in, because it was the panel that opened
  // it. A drawer the person opened with the burger is theirs and stays.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await ctx.newPage();
  try {
    await open(phone, 'smart-brain.html');
    let m = await coverOf(phone);
    expect(m.burger, 'at 390px the rail is a drawer').not.toBe('none');
    expect(m.navOpen).toBe(false);
    await pressSignIn(phone);
    m = await coverOf(phone);
    expect(m.navOpen, 'on a phone the panel must open the drawer it lives in').toBe(true);
    await expect(phone.locator('#lnav-mauth')).toBeVisible();
    await typeAndContinue(phone, { cc: '+91', phone: '9123456780' });
    await phone.waitForSelector('#lnav-mauth[data-state="new"]');
    await typeAndContinue(phone, { name: 'Bala', pin: '8052' });
    await phone.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 8000 });
    m = await coverOf(phone);
    expect(m.navOpen, 'the drawer the panel opened stayed over the page after sign-in').toBe(false);
    expect(m.blocks).toBe(false);
    await signOut(phone);
    // Signed out on a phone, the standing bar ("Sign in with your mobile
    // number ... the Sign in chip in the menu") must not sit on top of the
    // burger that opens that menu. It did on production's bytes: sticky at
    // top:0 with a z-index above the fixed top bar's, so the first press on
    // the menu button landed on the notice, and the way to Sign in was to find
    // Dismiss first. The notice is still there, below the bar.
    await expect(phone.locator('#lc-authnotice')).toBeVisible();
    const over = await phone.evaluate(() => {
      const b = document.getElementById('lnav-burger').getBoundingClientRect();
      const bar = document.getElementById('lc-authnotice').getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { hit: hit ? (hit.id || hit.className) : null, barTop: Math.round(bar.top), burgerBottom: Math.round(b.bottom) };
    });
    expect(over.hit, 'the signed-out notice covers the menu button on a phone').toBe('lnav-burger');
    expect(over.barTop, 'the notice starts above the bottom of the top bar').toBeGreaterThanOrEqual(over.burgerBottom - 1);
    await phone.locator('#lnav-burger').click({ trial: true, timeout: 5000 });
    await phone.click('#lnav-burger', { timeout: 5000 });
    m = await coverOf(phone);
    expect(m.navOpen, 'the burger opens the drawer').toBe(true);
    await pressSignIn(phone);
    await typeAndContinue(phone, { cc: '+91', phone: '9123456780' });
    await phone.waitForSelector('#lnav-mauth[data-state="need-pin"]');
    await typeAndContinue(phone, { pin: '8052' });
    await phone.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 8000 });
    m = await coverOf(phone);
    expect(m.navOpen, 'a drawer the person opened themselves was closed behind them').toBe(true);
    // ...and Cancel on a panel that opened the drawer closes the drawer too.
    await signOut(phone);
    await pressSignIn(phone);
    expect((await coverOf(phone)).navOpen).toBe(true);
    await phone.click('#lnav-mauth-cancel');
    expect((await coverOf(phone)).navOpen, 'Cancel left the drawer the panel opened').toBe(false);
  } finally { await ctx.close(); }
});

test('PROD DRIVE: a device-mode session signed in on one page is the session on every other page of the origin, from the first frame, without asking the server', async ({ page }) => {
  test.setTimeout(120_000);
  const log = await open(page, 'smart-brain.html');
  await signUp(page, '9876543210', 'Asha', PIN);
  const uid = await page.evaluate(() => window.LifecycleAuth.session.user.id);
  for (const next of ['onboarding.html', 'index.html', 'dashboard.html']) {
    await page.goto(base + '/' + next, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#lifecycle-nav .lnav-uname', { timeout: 10000 });
    await page.waitForFunction(() => !!(window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending'), null, { timeout: 15000 });
    const a = await readAuth(page);
    expect(a.name, next).toBe('Asha');
    expect(a.session, next).toMatchObject({ provider: 'mobile-pin', mode: 'device', hasToken: true, user: { id: uid, phone: '+919876543210' } });
    expect(a.backend.kind, next).toBe('signed-in');
    expect(a.umode, next).toMatch(/Local \/ Demo Mode/);
    expect(a.umode, next).toMatch(/Saved on this device only: no database is configured/);
    expect(a.storage && a.storage.sentence, next).toBe('Signed in as Asha · workspaces are saved on this device');
    expect(await page.evaluate(() => window.BrandContext.device.key()), next).toBe(DEVICE_STORE + '.' + uid);
    expect(a.internal, next).toBe(false);
  }
  expect(log.apiHeaders.filter((h) => /op=me|op=enter/.test(h.url)), 'a device session asked the server on navigation').toEqual([]);
  expect(log.dialogs).toEqual([]);
});

test('PROD DRIVE: op=me refuses a forged, a malformed and a signed-out token with 401 through the shipped handler, and a page booting with a forged stored session clears it and says so', async ({ page }) => {
  test.setTimeout(90_000);
  process.env.DATABASE_URL = 'postgres://u:p@ep-fixture.neon.tech/db';
  const store = fakeSql();
  const handler = publicConfigWith(store);
  const core = require(CORE);
  const en = mockRes();
  await handler({ method: 'POST', query: { action: 'auth', op: 'enter' }, headers: {}, body: Object.assign({ name: 'Asha', pin: PIN }, IN) }, en.res);
  const real = en.out.body.token;
  expect(real).toBeTruthy();
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH';
  for (const [label, headers] of [['forged', { 'x-lifecycle-token': core.newToken() }], ['malformed', { 'x-lifecycle-token': 'nonsense' }], ['jwt-shaped bearer', { authorization: 'Bearer ' + jwt }], ['no token', {}]]) {
    const me = mockRes();
    await handler({ method: 'GET', query: { action: 'auth', op: 'me' }, headers }, me.res);
    expect(me.out.code, label).toBe(401);
    expect(me.out.body, label).toMatchObject({ ok: false, error: 'invalid_session' });
    expect(me.out.body.message, label).toMatch(/expired or was signed out/);
    expect(me.out.body.user, label).toBeUndefined();
  }
  const ok = mockRes();
  await handler({ method: 'GET', query: { action: 'auth', op: 'me' }, headers: { 'x-lifecycle-token': real } }, ok.res);
  expect(ok.out.code).toBe(200);
  const all = mockRes();
  await handler({ method: 'POST', query: { action: 'auth', op: 'signout_all' }, headers: { 'x-lifecycle-token': real }, body: {} }, all.res);
  expect(all.out.body).toMatchObject({ ok: true, signed_out_all: true });
  const after = mockRes();
  await handler({ method: 'GET', query: { action: 'auth', op: 'me' }, headers: { 'x-lifecycle-token': real } }, after.res);
  expect(after.out.code, 'a session survived signout_all').toBe(401);

  // THE PAGE: a server-mode session somebody wrote into localStorage with a
  // token the database has never issued. It is seated provisionally (the rail
  // must not wait ~25 s for the network), checked with op=me, and taken back
  // with the reason under the chip - never left as a signed-in state.
  const forged = 'srvtok_forged0forged0forged0forged0forged0f';
  const auth = authServer();
  await page.addInitScript((tok) => {
    localStorage.setItem('lifecycle.auth.session', JSON.stringify({ token: tok, user: { id: 'srv-forged', phone: '+919876543210', name: 'Mallory' }, mode: 'server', expires: new Date(Date.now() + 86400000).toISOString(), provider: 'mobile-pin', storage: { mode: 'server', host: 'ep-fixture.neon.tech', message: 'Account saved in the database.' } }));
  }, forged);
  const log = await open(page, 'smart-brain.html', { auth });
  await page.waitForFunction(() => !!document.querySelector('#lnav-signin'), null, { timeout: 10000 });
  const a = await readAuth(page);
  expect(a.session).toBeNull();
  expect(a.stored, 'the forged session is still in localStorage').toBeNull();
  expect(a.name).toBeNull();
  expect(a.noteKind).toBe('expired');
  expect(await page.locator('#lnav-signin-note').textContent()).toMatch(/expired or was signed out elsewhere/);
  expect(a.backend.kind).toBe('signed-out');
  const me = auth.calls.filter((c) => c.op === 'me');
  expect(me.length).toBe(1);
  expect(me[0].headers['x-lifecycle-token']).toBe(forged);
  // Until op=me answers, the stored token IS sent on the page's own early
  // requests (the server is the judge, and a database that is slow to answer
  // must not log a real person out) - so what must hold is that once the 401
  // has cleared it, nothing carries it any more.
  const before = log.apiHeaders.length;
  await page.evaluate(() => fetch('/api/public-config?action=brand&op=active', { cache: 'no-store' }).then((r) => r.json()));
  const later = log.apiHeaders.slice(before);
  expect(later.length).toBeGreaterThan(0);
  expect(later.filter((h) => h.token || h.authorization), 'a cleared session was still sent as a token').toEqual([]);
  expect(await page.evaluate(() => window.LifecycleAuth.apiToken())).toBe('');
  expect(await page.evaluate(() => window.BrandContext.device.key()), 'a rejected stored session opened a device namespace').toBe(DEVICE_STORE);
  expect(log.dialogs).toEqual([]);
});

test('PROD DRIVE: requireUser answers a server-mode token whose database is not answering as UNREACHABLE (503, the host named), never as a sign-in kept on this device', async () => {
  // The finding: verifyToken() already separates `unreachable` (a URL is set,
  // the lookup threw) from `no_database` and `invalid`, and requireUser()
  // flattened the first two into one 401 reading "a sign-in kept on this
  // device only cannot be checked by the server". A token of our shape reaches
  // the server ONLY from a server-mode sign-in (auth.js never sends a device
  // token), so that sentence told a person whose account is in the database
  // that they were signed in on a device - while the rail's own mode line said
  // the opposite - and the 401 is the code every catch reads as "sign in
  // again", which cannot help when the database is down.
  process.env.DATABASE_URL = 'postgres://u:p@ep-fixture.neon.tech/db';
  process.env.SUPABASE_URL = 'https://live.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const store = fakeSql({ host: 'ep-fixture.neon.tech' });
  publicConfigWith(store);
  delete require.cache[BRAND_CORE];
  const brand = require(BRAND_CORE);
  const core = require(CORE);
  const RC = require.resolve('../api/_shared/require-caller.js');
  delete require.cache[RC];
  const { requireCaller } = require(RC);
  const token = (await core.enter(store, Object.assign({ name: 'Asha', pin: PIN }, IN), 'ip')).body.token;
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('no network in this test'); };
  try {
    expect((await brand.requireUser({ headers: { 'x-lifecycle-token': token } })).ok).toBe(true);
    store.db.down = true;
    const r = await brand.requireUser({ headers: { 'x-lifecycle-token': token } });
    expect(r.ok).toBe(false);
    expect(r.status, 'a database that is down was reported as the caller being signed out').toBe(503);
    expect(r.error).toBe('backend_unreachable');
    expect(r.backend_unreachable).toBe(true);
    expect(r.message).toContain('ep-fixture.neon.tech');
    expect(r.message).not.toMatch(/kept on this device only/);
    expect(r.message).not.toMatch(/not signed in/i);
    expect(r.mobile_reason).toBe('unreachable');
    // The AI routes' gate passes that status and sentence through as a 503.
    const res = mockRes();
    const admitted = await requireCaller({ method: 'POST', headers: { 'x-lifecycle-token': token, origin: 'http://127.0.0.1' }, query: {}, body: {} }, res.res);
    expect(admitted).toBe(false);
    expect(res.out.code).toBe(503);
    expect(res.out.body.error).toBe('backend_unreachable');
    expect(res.out.body.message).toContain('ep-fixture.neon.tech');
    // The database comes back: the same token is accepted again, and nothing
    // about the account changed while it was down.
    store.db.down = false;
    expect((await brand.requireUser({ headers: { 'x-lifecycle-token': token } })).ok).toBe(true);
    expect(store.db.app_sessions.length).toBe(1);
    // Without a database URL the same token is a DEVICE principal from a page,
    // and still anonymous without Origin (a well-shaped token is not a secret).
    delete process.env.DATABASE_URL;
    delete require.cache[BRAND_CORE]; delete require.cache[CORE];
    const brand2 = require(BRAND_CORE);
    const noOrigin = await brand2.requireUser({ headers: { 'x-lifecycle-token': token } });
    expect(noOrigin).toMatchObject({ ok: false, status: 401, error: 'sign_in_required' });
    expect(String(noOrigin.message)).toMatch(/did not come from a page/i);
    const fromPage = await brand2.requireUser({
      headers: { 'x-lifecycle-token': token, origin: 'https://app.example.test' },
    });
    expect(fromPage.ok, JSON.stringify(fromPage)).toBe(true);
    expect(fromPage.mode).toBe('device');
    expect(fromPage.user_id).toMatch(/^device:/);
    expect(fromPage.phone).toBe('');
  } finally { global.fetch = realFetch; }
});

test('PROD DRIVE: five wrong PINs arriving at once THROUGH THE SHIPPED HANDLER each count, and the row locks', async () => {
  process.env.DATABASE_URL = 'postgres://u:p@ep-fixture.neon.tech/db';
  const store = fakeSql();
  const handler = publicConfigWith(store);
  const post = async (body) => { const r = mockRes(); await handler({ method: 'POST', query: { action: 'auth', op: 'enter' }, headers: { 'x-forwarded-for': '203.0.113.9' }, body }, r.res); return r.out; };
  expect((await post(Object.assign({ name: 'Asha', pin: PIN }, IN))).code).toBe(200);
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => post(Object.assign({ pin: '1357' }, IN))));
  expect(burst.map((r) => r.code).sort()).toEqual([401, 401, 401, 401, 429]);
  expect(burst.filter((r) => r.body.locked).length).toBe(1);
  expect(burst.filter((r) => r.body.wrongPin).map((r) => r.body.left).sort()).toEqual([1, 2, 3, 4]);
  expect(burst.every((r) => !r.body.token)).toBe(true);
  expect(store.db.app_users[0].locked_until).toBeTruthy();
  expect(new Date(store.db.app_users[0].locked_until) - Date.now()).toBeGreaterThan(14 * 60000);
  const still = await post(Object.assign({ pin: PIN }, IN));
  expect(still.code, 'the right PIN opened a locked account through the handler').toBe(429);
  expect(still.body.token).toBeUndefined();
  expect(still.body.message).toMatch(/Too many wrong PINs\. Try again in 15 minutes\./);
});

test('REVIEW: the privacy policy describes the sign-in that exists (a mobile number and a PIN hash) and does not claim a Google sign-in', async ({ page }) => {
  await page.goto(base + '/privacy.html', { waitUntil: 'domcontentloaded' });
  const policy = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  expect(policy.length).toBeGreaterThan(800);
  expect(policy).toMatch(/mobile number and a 4-digit PIN/i);
  expect(policy).toMatch(/salted hash of your PIN, never the PIN itself/i);
  expect(policy).toMatch(/not verified by SMS/i);
  expect(policy).toMatch(/90 days/);
  expect(policy).toMatch(/browser's local storage/i);
  expect(policy).not.toMatch(/when signing in with Google/i);
  expect(policy).not.toMatch(/Sign-in is with Gmail/i);
  expect(await page.evaluate(() => document.querySelector('title').textContent)).toMatch(/Privacy/);
});

test('EVERY page that loads auth.js: pressing Sign in opens the panel on that page, never calls signInWithOAuth, never navigates, shows no Google button', async ({ page }) => {
  test.setTimeout(900_000);
  expect(PAGES.length, 'no pages carrying auth.js were found').toBeGreaterThan(20);
  const failures = [];
  let pressed = 0;
  for (const f of PAGES) {
    let log;
    try { log = await open(page, f); } catch (e) { failures.push(`${f}: auth.js never decided a backend state: ${String(e.message).split('\n')[0]}`); continue; }
    try { await pressSignIn(page); } catch (e) { failures.push(`${f}: the Sign in chip could not be pressed: ${String(e.message).split('\n')[0]}`); continue; }
    pressed++;
    const a = await readAuth(page);
    const here = await page.evaluate(() => location.pathname);
    if (!a.panel) failures.push(`${f}: no inline panel opened`);
    if (a.oauth) failures.push(`${f}: signInWithOAuth was called (${a.oauth}x)`);
    if (a.google) failures.push(`${f}: a "Sign in with Google" control is still offered`);
    if (!here.endsWith('/' + f)) failures.push(`${f}: pressing Sign in navigated to ${here}`);
    if (log.navigations.some((u) => /authorize/.test(u))) failures.push(`${f}: the browser was sent to an OAuth authorize URL`);
    if (log.dialogs.length) failures.push(`${f}: a native dialog opened: ${log.dialogs.join(' | ')}`);
    const real = log.errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e));
    if (real.length) failures.push(`${f}: page error: ${real[0].slice(0, 160)}`);
  }
  expect(failures, `\n  ${failures.join('\n  ')}`).toEqual([]);
  expect(pressed, 'the sweep pressed Sign in on too few pages to mean anything').toBe(PAGES.length);
});

test('the browser copy of the phone and PIN rules agrees with the server, input for input', async ({ page }) => {
  await open(page, 'index.html');
  const core = freshCore();
  const phone = require(PHONE);
  const PHONES = [
    ['9876543210', '+91'], ['5876543210', '+91'], ['98765 43210', '+91'], ['+919876543210', ''], ['987654321', '+91'],
    ['2015550123', '+1'], ['1015550123', '+1'], ['7700900123', '+44'], ['770090012', '+44'], ['77009001', '+44'],
    ['501234567', '+971'], ['81234567', '+65'], ['21234567', '+65'], ['+33612345678', ''], ['+7', ''], ['abc', '+91'], ['', '+91'],
  ];
  const PINS = ['7391', '1234', '4321', '0000', '3456', '6543', '2468', '12345', '739', 'ab12', '', '8052', '0007', '1122'];
  const CCS = ['+91', '+1', '+44', '+971', '+65', 'nonsense', ''];
  const browser = await page.evaluate(({ phones, pins, ccs }) => {
    const r = window.LifecycleAuth.mobile.rules;
    return {
      phones: phones.map(([v, cc]) => r.normPhone(v, cc)),
      pins: pins.map((p) => r.pinError(p)),
      errors: ccs.map((cc) => r.phoneError(cc)),
      table: Object.fromEntries(Object.entries(r.PHONE_CC).map(([k, v]) => [k, { min: v.min, max: v.max, re: v.re || null, name: v.name }])),
      weak: r.WEAK_PINS, len: r.PIN_LEN, tries: r.MAX_TRIES, lock: r.LOCK_MINUTES, days: r.SESSION_DAYS, cc: r.DEFAULT_CC,
    };
  }, { phones: PHONES, pins: PINS, ccs: CCS });
  expect(browser.phones).toEqual(PHONES.map(([v, cc]) => phone.normPhone(v, cc)));
  expect(browser.pins).toEqual(PINS.map((p) => core.pinError(p)));
  expect(browser.errors).toEqual(CCS.map((cc) => phone.phoneError(cc)));
  expect(browser.table).toEqual(Object.fromEntries(Object.entries(phone.PHONE_CC).map(([k, v]) => [k, { min: v.min, max: v.max, re: v.re ? v.re.source : null, name: v.name }])));
  expect(browser.weak).toEqual(core.WEAK_PINS);
  expect([browser.len, browser.tries, browser.lock, browser.days, browser.cc]).toEqual([core.PIN_LEN, core.MAX_TRIES, core.LOCK_MINUTES, core.SESSION_DAYS, phone.DEFAULT_CC]);
  // A check that inspects nothing passes everything.
  expect(browser.phones.filter(Boolean).length).toBeGreaterThan(6);
  expect(browser.pins.filter(Boolean).length).toBeGreaterThan(6);
});
