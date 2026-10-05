'use strict';
/**
 * mobile-auth-core.js - sign in and sign up with a mobile number and a 4-digit PIN.
 * ---------------------------------------------------------------------------
 * THE ONE SIGN-IN (2026-09-28). The operator's words: "signin/signup with mobile
 * number and a 4 digit password - save in db (neon) or local browser cache
 * whichever can be used - just like in parwah-hq". Google/Supabase OAuth is
 * commented out in auth.js, the Studio's own overlay login is commented out,
 * and this module is what replaced them.
 *
 * ONE ACTION DOES BOTH DIRECTIONS. `op=enter` with a phone:
 *   - phone known, PIN right         -> a session
 *   - phone known, no PIN sent       -> { exists:true, needPin:true, name }
 *   - phone known, PIN wrong         -> 401 { wrongPin:true, left }  (5 tries)
 *   - phone known, locked            -> 429 { locked:true }          (15 minutes)
 *   - phone known, no PIN on record  -> { exists:true, setPin:true } (the reset path:
 *                                       an operator cleared pin_hash in the database)
 *   - phone unknown, no name         -> { exists:false }  the client asks for name + PIN
 *   - phone unknown, name + PIN      -> the account is created and signed in, one step
 * A skippable "set a PIN later" step is how an account ends up without one, so a
 * new person chooses the PIN in the same breath as their name.
 *
 * FOUR DIGITS IS THE OPERATOR'S SPEC, which makes the lockout matter MORE, not
 * less: there are only ten thousand PINs, so the only thing standing between a
 * guess and an account is how many guesses are allowed and how long each takes.
 *   - the first-guessed PINs are refused outright (WEAK_PINS + any straight run),
 *   - scrypt with a per-user salt, compared in constant time,
 *   - MAX_TRIES 5 then LOCK_MINUTES 15, counted on the account row so it holds
 *     across serverless instances,
 *   - a per-IP budget of 25 `enter` calls per 10 minutes, counted in the database
 *     for the same reason.
 *
 * SESSIONS: a random 32-byte token, base64url, of which ONLY the sha256 is
 * stored - a copy of app_sessions is not a set of working logins. 90 days. The
 * token travels in the `X-Lifecycle-Token` header (the body is accepted too);
 * auth.js also sends it as `Authorization: Bearer` so the gates that already
 * read a bearer see it without a second code path.
 *
 * TWO STORAGE MODES, chosen honestly. `op=status` answers `mode:'server'` only
 * when a database URL is set AND `select 1` answers; otherwise `mode:'device'`
 * with the reason (no URL / unreachable, with the host). In device mode the
 * BROWSER runs the same state machine against localStorage (auth.js).
 *
 * ── STANDALONE / NO DATABASE_URL (2026-09-30) ────────────────────────────
 * Production often has model keys and no DATABASE_URL. Until this date a
 * device token was refused exactly like an anonymous call, so every agent and
 * every metered button said "this sign-in is saved on this device only" and
 * nothing ran. Features that can run without a ledger (a model turn over the
 * brand the request CARRIES, a calendar, a mailer) now admit a well-shaped
 * token as a device principal: `mode:'device'`, `user.id` is `device:<hash>`
 * of the token (rate-limit key, never a Neon row), no phone, no wallet. The
 * identity is the token's hash, never a name or number from the body. A
 * deployment that HAS a database still refuses a token that is not in
 * app_sessions - a forged or leftover device token is not a server session.
 * An anonymous call (no token) is still anonymous.
 *
 * ── SUPABASE MODE (2026-10-03) ─────────────────────────────────────────────
 * A THIRD store, and the first in precedence: `supabase`, when SUPABASE_URL
 * and a server key are set AND the auth service answers GET /auth/v1/health.
 * The account is then a real auth.users row and the browser holds a real
 * Supabase session, so RLS, requireUser(), restAs(), credits and the agents
 * see a person - see mobile-auth-supabase.js, which this module hands every
 * op to in that mode. Precedence: supabase > server (Neon) > device. A
 * configured project that does not answer falls through to the next mode and
 * the answer SAYS so (`supabase:{host, reachable:false}`), because "no
 * project" and "a project that is down" are different things to be told.
 *
 * NOT A FUNCTION FILE. Mounted on api/public-config.js?action=auth (the Hobby
 * plan caps this project at 12 serverless functions and it is at the cap). The
 * driver is required lazily so this file loads - and its rules can be tested -
 * on a clone with nothing installed and no database anywhere.
 *
 * TABLES (created idempotently on first use): app_users, app_sessions,
 * app_rate_limits - in the NEON database named by DATABASE_URL. Not to be
 * confused with the Supabase `public.app_users` table the (now commented-out)
 * profile modal read: different database, different schema, no relation.
 * ---------------------------------------------------------------------------
 */

const { scryptSync, randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const phone = require('./phone-rules.js');

/* ── the PIN ─────────────────────────────────────────────────────────────── */

const PIN_LEN = 4;

// The ones a thief tries first. Blocking them costs a person nothing and
// removes the handful that would otherwise be guessed immediately.
const WEAK_PINS = [
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '2580', '0852', '1212', '2121', '1122', '2211', '1010', '0101',
  '2020', '2000', '2001', '1004', '6969', '0007', '4200',
];
const WEAK = new Set(WEAK_PINS);

/** null when the PIN is acceptable, else the sentence saying why not. */
function pinError(pin) {
  const p = String(pin == null ? '' : pin);
  if (!/^[0-9]+$/.test(p)) return 'Your PIN is ' + PIN_LEN + ' digits, numbers only.';
  if (p.length !== PIN_LEN) return 'Your PIN is ' + PIN_LEN + ' digits, you typed ' + p.length + '.';
  if (WEAK.has(p)) return 'That PIN is one of the first anyone would try. Please pick another.';
  // A run like 3456, forwards or backwards, is the same problem.
  let up = true;
  let down = true;
  for (let i = 1; i < p.length; i++) {
    if (+p[i] !== +p[i - 1] + 1) up = false;
    if (+p[i] !== +p[i - 1] - 1) down = false;
  }
  if (up || down) return 'That PIN is one of the first anyone would try. Please pick another.';
  return null;
}

// scrypt, not a bare hash: with ten thousand possible PINs the only thing
// standing between a stolen table and every PIN in it is how long a guess takes.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function hashPin(pin, salt) {
  const s = salt || randomBytes(16).toString('hex');
  const key = scryptSync(String(pin), s, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return { salt: s, hash: key.toString('hex') };
}

function verifyPin(pin, salt, hash) {
  if (!salt || !hash) return false;
  const a = Buffer.from(hashPin(pin, salt).hash, 'hex');
  const b = Buffer.from(String(hash), 'hex');
  // Constant time, so the answer cannot be found one digit at a time by
  // watching how long the reply takes.
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── lockout ─────────────────────────────────────────────────────────────── */

const MAX_TRIES = 5;
const LOCK_MINUTES = 15;

function lockMessage(until) {
  const mins = Math.max(1, Math.ceil((new Date(until) - Date.now()) / 60000));
  return 'Too many wrong PINs. Try again in ' + mins + (mins === 1 ? ' minute' : ' minutes') + '.';
}

function triesMessage(left) {
  return 'That PIN is not right. ' + left + ' ' + (left === 1 ? 'try' : 'tries') + ' left.';
}

/* ── the session ─────────────────────────────────────────────────────────── */

const SESSION_DAYS = 90;
const TOKEN_HEADER = 'x-lifecycle-token';

function newToken() { return randomBytes(32).toString('base64url'); }
function tokenHash(t) { return createHash('sha256').update(String(t)).digest('hex'); }
/** The shape of OUR tokens: base64url, no dots. A Supabase JWT has two dots. */
function looksLikeToken(t) { return typeof t === 'string' && /^[A-Za-z0-9_-]{40,90}$/.test(t); }

/**
 * Where the token travels: the X-Lifecycle-Token header first (never in a
 * query string, which lands in logs and Referers), then a bearer of OUR shape,
 * then the body. A bearer that is not our shape is somebody else's token and is
 * left for that gate to read.
 */
function tokenOf(req) {
  const h = (req && req.headers) || {};
  const own = h[TOKEN_HEADER] || h['X-Lifecycle-Token'];
  if (own) return String(own).trim();
  const b = String(h.authorization || h.Authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(b.trim());
  if (m && looksLikeToken(m[1].trim())) return m[1].trim();
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  return body.token ? String(body.token) : '';
}

/** The caller's address, as a rate-limit key only. Never stored against a person. */
function clientIp(req) {
  const h = (req && req.headers) || {};
  const fwd = String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim();
  return fwd || 'unknown';
}

/* ── the database ────────────────────────────────────────────────────────── */

function databaseUrl() {
  return String(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.POSTGRES_URL || '').trim();
}

/** True when this process has no session store at all. Not the same as a URL that does not answer. */
function standaloneMode() {
  return !databaseUrl();
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { return ''; }
}

/**
 * The tagged-template query function. `deps.sql` (a test's in-memory fake)
 * wins; otherwise the neon driver over DATABASE_URL; null when there is no URL.
 * The driver is required HERE, lazily, so the rules above load anywhere.
 *
 * ONE DRIVER PER URL, for the life of the warm instance. `neon(url)` used to be
 * constructed on every call, and ensureSchema's guard is keyed by that
 * function - so every gated request (requireUser -> verifyToken -> connect +
 * ensureSchema) re-ran the four DDL statements. Keyed by the URL STRING: a
 * test's `deps.sql` never touches this map, and a URL change still gets a
 * fresh client.
 */
const DRIVERS = new Map();
function connect(deps) {
  if (deps && typeof deps.sql === 'function') return deps.sql;
  const url = databaseUrl();
  if (!url) return null;
  let sql = DRIVERS.get(url);
  if (!sql) {
    const { neon } = require('@neondatabase/serverless');
    sql = neon(url);
    DRIVERS.set(url, sql);
  }
  return sql;
}

const schemaReady = new WeakSet();

/** Idempotent: every statement is `if not exists`, and it runs once per sql. */
async function ensureSchema(sql) {
  if (schemaReady.has(sql)) return;
  await sql`create table if not exists app_users (
    id uuid primary key default gen_random_uuid(),
    phone text unique not null,
    phone_cc text,
    phone_local text,
    name text not null,
    pin_hash text,
    pin_salt text,
    pin_set_at timestamptz,
    pin_tries int not null default 0,
    locked_until timestamptz,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists app_sessions (
    token_hash text primary key,
    user_id uuid not null references app_users(id) on delete cascade,
    device text,
    created_at timestamptz not null default now(),
    last_used_at timestamptz not null default now(),
    expires_at timestamptz not null
  )`;
  await sql`create index if not exists app_sessions_user on app_sessions (user_id)`;
  await sql`create table if not exists app_rate_limits (
    bucket text not null,
    k text not null,
    window_start timestamptz not null default now(),
    n integer not null default 0,
    primary key (bucket, k)
  )`;
  schemaReady.add(sql);
}

function withTimeout(promise, ms, label) {
  let timer;
  const cap = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(label || 'timed out')), ms); });
  return Promise.race([promise, cap]).finally(() => clearTimeout(timer));
}

/**
 * Fixed-window rate limit, counted in the database so it holds across every
 * serverless instance. Returns true when the call is allowed. A limiter that
 * cannot reach the database never blocks a real person: the database being
 * down is reported by the call that follows, not disguised as "too many".
 */
async function rateLimit(sql, bucket, key, limit, windowSec) {
  try {
    const rows = await sql`
      insert into app_rate_limits (bucket, k, window_start, n) values (${bucket}, ${key}, now(), 1)
      on conflict (bucket, k) do update set
        n = case when app_rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1 else app_rate_limits.n + 1 end,
        window_start = case when app_rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now() else app_rate_limits.window_start end
      returning n`;
    return rows[0].n <= limit;
  } catch (_) { return true; }
}

const ENTER_LIMIT = 25;          // per IP
const ENTER_WINDOW_SEC = 600;    // 10 minutes

/**
 * Who holds this token. Touched (last_used_at) rather than rotated: a shared
 * tablet with two people signed in on two tabs would otherwise log one of them
 * out mid-sentence.
 */
async function sessionUser(sql, token) {
  if (!looksLikeToken(token)) return null;
  const h = tokenHash(token);
  const rows = await sql`select s.user_id, s.expires_at, u.name, u.phone from app_sessions s
                         join app_users u on u.id = s.user_id
                         where s.token_hash = ${h} and s.expires_at > now()`;
  if (!rows[0]) return null;
  try { await sql`update app_sessions set last_used_at = now() where token_hash = ${h}`; } catch (_) { /* best effort */ }
  return { id: rows[0].user_id, name: rows[0].name, phone: rows[0].phone, expires_at: rows[0].expires_at };
}

/* ── which mode is this deployment in ────────────────────────────────────── */

/**
 * `mode:'server'` ONLY when a URL is set and the database answers. Anything
 * else is `mode:'device'` with the reason - "no database" and "a database that
 * is not answering" are different things to be told, and the host is printed
 * because that is the value an operator has to change.
 *
 * The answer is CACHED per URL on the real driver path: `handle()` asks it
 * before every op and the panel asks it once per page load, and each ask was
 * a `select 1` round trip. A "server" answer holds for 30 s; a "device" answer
 * (the database not answering) for 5 s, so a database that comes back is seen
 * within seconds while a stream of requests against one that is down does not
 * each wait out the probe's timeout. An injected `deps.sql` bypasses the cache,
 * so a test drives the real probe every time.
 */
const STATUS_TTL_MS = { supabase: 30000, server: 30000, device: 5000 };
let statusCache = null;   // { url, at, answer }

/**
 * The Supabase half of the status answer, or null when no project is
 * configured. Cached per URL like the Neon probe: a project that answers for
 * 30 s, one that does not for 5 s. `deps.fresh` (a test) bypasses the cache.
 */
let supaCache = null;     // { url, at, answer }
async function supabaseStatus(deps) {
  const supa = require('./mobile-auth-supabase.js');
  const cfg = supa.config();
  if (!cfg) return null;
  // TWO QUESTIONS, kept apart (review finding, 2026-10-03):
  //   reachable  - does the PROJECT answer? Always probed when a URL and a
  //                server key are set. This is what decides whether a device
  //                token may be admitted (verifyToken), so it must never be
  //                answered "no" without asking.
  //   offerable  - can supabase mode be OFFERED to browsers? Also needs a key
  //                the browser may hold, or a session could be issued and
  //                never renewed.
  // Folding the second into the first answered "unreachable" for a live
  // project with no public key, and verifyToken then admitted leftover device
  // tokens as UNMETERED principals beside a working credit ledger.
  const fresh = !!(deps && (deps.fresh || typeof deps.sql === 'function'));
  let base;
  if (!fresh && supaCache && supaCache.url === cfg.url && Date.now() - supaCache.at < (supaCache.answer.reachable ? 30000 : 5000)) base = supaCache.answer;
  else {
    const h = await supa.health(cfg, (deps && deps.timeoutMs) || 4000);
    base = { configured: true, reachable: !!h.ok, host: cfg.host, detail: h.ok ? '' : h.detail };
    if (!fresh) supaCache = { url: cfg.url, at: Date.now(), answer: base };
  }
  const answer = Object.assign({}, base, { pin_ready: !!supa.pepper(), offerable: !!(base.reachable && cfg.publicKey) });
  if (base.reachable && !cfg.publicKey) {
    answer.reason = 'no_public_key';
    answer.detail = 'no browser-visible key: set SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY)';
  }
  return answer;
}

/**
 * Is a credit ledger reachable at all? The auth service answering is one
 * proof; the ledger's own table answering (credit_prices, the read the meter
 * already makes) is the other, for a project whose auth health check fails
 * while its database does not. A device principal runs UNMETERED, so it may
 * exist only when neither answers.
 */
async function ledgerReachable(deps, sb) {
  if (sb && sb.reachable) return true;
  try {
    const credits = require('./credits-core.js');
    if (!credits.configured()) return false;
    const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
    const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');
    const r = await withTimeout(fetch(url + '/rest/v1/credit_prices?select=feature_key&limit=1', {
      headers: { apikey: key, authorization: 'Bearer ' + key }, cache: 'no-store',
    }), (deps && deps.timeoutMs) || 4000, 'ledger probe timed out');
    return !!(r && r.status && r.status < 500);
  } catch (_) { return false; }
}

async function status(deps) {
  // SUPABASE FIRST (2026-10-03). A project that answers outranks everything.
  const sb = await supabaseStatus(deps);
  if (sb && sb.offerable) {
    return {
      ok: true, mode: 'supabase', host: sb.host, pin_ready: sb.pin_ready,
      message: 'Account saved in the database (' + sb.host + '); brands are saved to your account.',
    };
  }
  const below = await storeStatus(deps);
  if (sb) {
    // Configured, not answering: said, and the mode below it is used.
    return Object.assign({}, below, {
      supabase: { configured: true, reachable: !!sb.reachable, host: sb.host, detail: sb.detail, reason: sb.reason || 'unreachable' },
      message: below.message + (sb.reason === 'no_public_key'
        ? ' The account service (' + sb.host + ') is configured without a browser-visible key (SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY), so accounts there cannot be used yet.'
        : ' The account service (' + sb.host + ') is not answering, so accounts there cannot be used until it does.'),
    });
  }
  return below;
}

/** The Neon / device answer, exactly as before Supabase mode existed. */
async function storeStatus(deps) {
  const url = databaseUrl();
  const injected = !!(deps && typeof deps.sql === 'function');
  if (!injected && statusCache && statusCache.url === url && Date.now() - statusCache.at < STATUS_TTL_MS[statusCache.answer.mode]) {
    return statusCache.answer;
  }
  const sql = connect(deps);
  let answer;
  if (!sql) {
    answer = {
      ok: true, mode: 'device', reason: 'no_database_url', host: '',
      message: 'Saved on this device only: no database is configured. Set DATABASE_URL to keep accounts in a database.',
    };
  } else {
    const host = hostOf(url) || 'the configured database';
    try {
      await withTimeout(sql`select 1`, (deps && deps.timeoutMs) || 4000, 'select 1 timed out');
      answer = { ok: true, mode: 'server', host, message: 'Account saved in the database.' };
    } catch (err) {
      answer = {
        ok: true, mode: 'device', reason: 'database_unreachable', host,
        message: 'Saved on this device only: the database (' + host + ') is not answering.',
        detail: String(err && err.message || err),
      };
    }
  }
  if (!injected && url) statusCache = { url, at: Date.now(), answer };
  return answer;
}

/**
 * Verify a token against app_sessions. `ok:false` carries WHY, because the
 * caller decides how to say it; every non-ok reason is treated by the gates as
 * an anonymous call (a token nobody can check proves nothing).
 *
 * With no database URL the token cannot be looked up, but it is still a
 * session this browser minted (2026-09-30). Admitted as `mode:'device'` with
 * a stable `device:<hash>` id so rate limits and carried-brand seeds have
 * something to key on. A phone number is NEVER invented from the request: a
 * listed number is the only thing that spends a wallet, and a standalone
 * deployment has no wallet. A URL that is SET and does not answer is still
 * `unreachable` - that is a server-mode account whose store is down.
 */
async function verifyToken(token, deps) {
  if (!token) return { ok: false, reason: 'no_token' };
  if (!looksLikeToken(token)) return { ok: false, reason: 'not_a_token' };
  // SUPABASE MODE (2026-10-03): every account is a Supabase user and the
  // browser holds a Supabase JWT, which never matches this shape. A token of
  // OUR shape is then a leftover device session or a forgery, and admitting
  // it as a device principal would run features UNMETERED beside a working
  // credit ledger - the faucet the phone rules exist to shut. Only a project
  // that ANSWERS counts: a configured one that is down falls back to the
  // modes below, exactly as status() does, so #115's standalone path holds.
  // Whether or not supabase mode can be OFFERED (a public key), and whether
  // the answer came from the auth service or the ledger itself: a device
  // principal is unmetered, so it exists only when no ledger answers at all.
  //   - supabase mode is ON (offered): every account is a Supabase user, so
  //     a token of our shape is refused outright, Neon's included.
  //   - otherwise a Neon session is checked against app_sessions as before
  //     (it is metered: it is never a device principal), and only the DEVICE
  //     path - no DATABASE_URL - is refused while the project or its ledger
  //     answers (review finding: a live project with no public key used to
  //     admit device tokens unmetered).
  let sb = null;
  try { sb = await supabaseStatus(deps); } catch (_) { sb = null; /* a probe that throws is a project that did not answer */ }
  if (sb && sb.offerable) return { ok: false, reason: 'supabase_mode', host: sb.host };
  const sql = connect(deps);
  if (!sql) {
    if (sb && sb.reachable) return { ok: false, reason: 'supabase_mode', host: sb.host };
    if (sb && await ledgerReachable(deps, sb)) return { ok: false, reason: 'ledger_reachable', host: sb.host };
    return {
      ok: true, mode: 'device',
      user: { id: 'device:' + tokenHash(token).slice(0, 32), name: '', phone: '' },
    };
  }
  try {
    await ensureSchema(sql);
    const u = await withTimeout(sessionUser(sql, token), (deps && deps.timeoutMs) || 6000, 'session lookup timed out');
    if (!u) return { ok: false, reason: 'invalid' };
    return { ok: true, mode: 'server', user: { id: u.id, name: u.name, phone: u.phone }, expires_at: u.expires_at };
  } catch (err) {
    return { ok: false, reason: 'unreachable', host: hostOf(databaseUrl()), detail: String(err && err.message || err) };
  }
}

/* ── enter: sign in or sign up, one step ─────────────────────────────────── */

const USER_COLS_SQL = (sql, e164) => sql`select id, name, phone, pin_hash, pin_salt, pin_tries, locked_until
                                         from app_users where phone = ${e164}`;

/** Returns { status, body }. Every refusal carries `error` (a code) AND `message` (a sentence). */
async function enter(sql, body, ip) {
  const b = body && typeof body === 'object' ? body : {};
  const allowed = await rateLimit(sql, 'auth-enter', ip || 'unknown', ENTER_LIMIT, ENTER_WINDOW_SEC);
  if (!allowed) {
    return { status: 429, body: { ok: false, error: 'rate_limited', message: 'Too many sign-in attempts from this device. Please wait a few minutes and try again.' } };
  }
  const np = phone.normPhone(b.phone, b.cc);
  if (!np) return { status: 400, body: { ok: false, error: 'phone_invalid', message: phone.phoneError(b.cc) } };

  let rows = await USER_COLS_SQL(sql, np.e164);
  let isNew = !rows[0];
  if (isNew) {
    const name = String(b.name || '').trim().slice(0, 60);
    if (!name) {
      return { status: 200, body: { ok: true, exists: false, message: 'This number is new here, so we will set you up. Already have an account? Check the number.' } };
    }
    const perr = pinError(b.pin);
    if (perr) return { status: 200, body: { ok: true, exists: false, needPin: true, error: 'pin_invalid', message: perr } };
    const h = hashPin(b.pin);
    try {
      rows = await sql`insert into app_users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at)
                       values (${np.e164}, ${np.cc}, ${np.local}, ${name}, ${h.hash}, ${h.salt}, now())
                       returning id, name, phone, pin_hash, pin_salt, pin_tries, locked_until`;
    } catch (_) {
      // Raced with another sign-up for the same number: the unique index let
      // one insert through and refused this one. The account that now exists
      // is somebody's, and this request is a SIGN-IN to it - so it goes through
      // the PIN check below like any other. Review finding 2026-09-29: `isNew`
      // stayed true here, the PIN branch was skipped, and the loser was issued
      // a session for the winner's account with a PIN it never typed.
      rows = await USER_COLS_SQL(sql, np.e164);
      isNew = false;
    }
  }
  const user = rows[0];
  if (!user) return { status: 500, body: { ok: false, error: 'account_not_created', message: 'The account could not be created. Nothing was saved; please try again.' } };

  if (!isNew) {
    if (!user.pin_hash) {
      // An account with no PIN on record: an operator cleared it in the database
      // (the reset path - there is no SMS to fall back on). Set one now.
      const perr = pinError(b.pin);
      if (perr) {
        return { status: 200, body: { ok: true, exists: true, setPin: true, name: user.name, error: b.pin ? 'pin_invalid' : null, message: b.pin ? perr : 'Choose a new ' + PIN_LEN + '-digit PIN for this account.' } };
      }
      const h = hashPin(b.pin);
      await sql`update app_users set pin_hash = ${h.hash}, pin_salt = ${h.salt}, pin_set_at = now(), pin_tries = 0, locked_until = null where id = ${user.id}`;
    } else {
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return { status: 429, body: { ok: false, locked: true, error: 'pin_locked', until: new Date(user.locked_until).toISOString(), message: lockMessage(user.locked_until) } };
      }
      if (!b.pin) return { status: 200, body: { ok: true, exists: true, needPin: true, name: user.name, message: 'Welcome back, ' + user.name + '. Type your PIN.' } };
      if (!verifyPin(b.pin, user.pin_salt, user.pin_hash)) {
        // ONE statement counts the try and locks the row when the count
        // reaches MAX_TRIES, and the decision is read from what the database
        // RETURNS. Review finding 2026-09-29: this was read-increment-write in
        // JavaScript, so N wrong PINs in flight at once all read 0, all wrote
        // 1, and the lock never fired - five guesses at a time, for ever.
        const until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
        const counted = await sql`update app_users
                                     set pin_tries = case when pin_tries + 1 >= ${MAX_TRIES} then 0 else pin_tries + 1 end,
                                         locked_until = case when pin_tries + 1 >= ${MAX_TRIES} then ${until}::timestamptz else locked_until end
                                   where id = ${user.id}
                                   returning pin_tries, locked_until`;
        const c = counted[0] || {};
        if (c.locked_until && new Date(c.locked_until) > new Date()) {
          const lockedUntil = new Date(c.locked_until).toISOString();
          return { status: 429, body: { ok: false, locked: true, error: 'pin_locked', until: lockedUntil, message: lockMessage(lockedUntil) } };
        }
        const left = Math.max(0, MAX_TRIES - (Number(c.pin_tries) || 0));
        return { status: 401, body: { ok: false, wrongPin: true, left, error: 'pin_wrong', message: triesMessage(left) } };
      }
      // Locking sets pin_tries to 0, so a lock that has EXPIRED leaves a stale
      // locked_until behind with nothing to reset it - found by driving this
      // through the lock and out the other side. Both fields go together.
      if (user.pin_tries || user.locked_until) await sql`update app_users set pin_tries = 0, locked_until = null where id = ${user.id}`;
    }
  }

  // Signed in. From here the token is what proves who this is.
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await sql`insert into app_sessions (token_hash, user_id, device, expires_at)
            values (${tokenHash(token)}, ${user.id}, ${String(b.device || '').slice(0, 80) || null}, ${expires})`;
  // Old sessions are pruned opportunistically, so the table does not grow for
  // ever on a deployment nobody runs a cron against.
  try { await sql`delete from app_sessions where expires_at < now()`; } catch (_) { /* best effort */ }
  return {
    status: 200,
    body: {
      ok: true, exists: true, created: isNew, token, expires, mode: 'server',
      user: { id: user.id, name: user.name, phone: user.phone },
      message: isNew ? 'Account created and saved in the database.' : 'Signed in.',
    },
  };
}

/* ── the router: public-config.js?action=auth&op=… ───────────────────────── */

const OPS = ['status', 'enter', 'me', 'signout', 'signout_all'];

function deviceModeRefusal(st, opName) {
  return {
    ok: false, status: 503, error: st.reason === 'no_database_url' ? 'no_database' : 'database_unreachable',
    mode: 'device', reason: st.reason, host: st.host || '',
    message: (st.reason === 'no_database_url'
      ? 'No database is configured on this deployment, so "' + opName + '" cannot run on the server. Accounts are saved on this device instead.'
      : 'The database (' + (st.host || 'the configured host') + ') is not answering, so "' + opName + '" cannot run on the server right now. '
        + 'An account saved in the database cannot be used until it answers; accounts made meanwhile are saved on this device only.'),
  };
}

async function handle(req, res, deps) {
  const q = (req && req.query) || {};
  let body = req && req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  const op = String(q.op || body.op || '').toLowerCase();
  const method = String((req && req.method) || 'GET').toUpperCase();

  if (!OPS.includes(op)) {
    return res.status(400).json({ ok: false, error: 'unknown_auth_operation', available: OPS, message: 'That sign-in operation does not exist.' });
  }

  if (op === 'status') return res.status(200).json(await status(deps));

  const st = await status(deps);
  if (st.mode === 'supabase') {
    const supa = require('./mobile-auth-supabase.js');
    return supa.handle(module.exports, supa.config(), req, res, op, method, body);
  }
  // ROUTE BY THE TOKEN, NOT ONLY BY THE MODE (review finding, 2026-10-03).
  // A Supabase JWT belongs to the Supabase project whatever this moment's
  // health probe said. With Neon also configured, a single failed probe (and
  // its 5-second negative cache) used to send op=me with a Supabase JWT to
  // Neon's sessionUser(), which answered 401 - and the browser cleared a
  // valid session. The project not answering is "cannot be checked right
  // now" (503, the session is kept), never "signed out".
  const supaCfg = require('./mobile-auth-supabase.js').config();
  const jwt = supaCfg ? require('./mobile-auth-supabase.js').jwtOf(req) : '';
  if (jwt && (op === 'me' || op === 'signout' || op === 'signout_all')) {
    if (op === 'signout') return res.status(200).json({ ok: true, mode: 'supabase', signed_out: false, host: supaCfg.host, message: 'The account service (' + supaCfg.host + ') is not answering, so this session could not be revoked there; it has been removed from this browser.' });
    return res.status(503).json({
      ok: false, error: 'backend_unreachable', backend_unreachable: true, mode: 'supabase', host: supaCfg.host,
      message: 'The account service (' + supaCfg.host + ') is not answering, so your sign-in cannot be checked right now. Nothing about your account has changed.',
    });
  }
  if (st.mode !== 'server') {
    // signout with nothing to sign out of on the server is not a failure: the
    // browser clears its own device session and says so.
    if (op === 'signout') return res.status(200).json({ ok: true, mode: 'device', signed_out: false, message: st.message });
    return res.status(503).json(deviceModeRefusal(st, op));
  }
  const sql = connect(deps);
  await ensureSchema(sql);

  if (op === 'enter') {
    if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed', message: 'Sign in with a POST.' }); }
    const r = await enter(sql, body, clientIp(req));
    return res.status(r.status).json(r.body);
  }

  const token = tokenOf(req);

  if (op === 'me') {
    const u = await sessionUser(sql, token);
    if (!u) return res.status(401).json({ ok: false, error: 'invalid_session', message: 'Your sign-in has expired or was signed out. Sign in again with Google.' });
    return res.status(200).json({ ok: true, mode: 'server', user: { id: u.id, name: u.name, phone: u.phone }, expires: u.expires_at, message: st.message });
  }

  if (op === 'signout') {
    if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed', message: 'Sign out with a POST.' }); }
    let n = 0;
    if (looksLikeToken(token)) {
      try { await sql`delete from app_sessions where token_hash = ${tokenHash(token)}`; n = 1; } catch (_) { /* the token stops working when the row is gone; a failed delete is retried on the next sign-out */ }
    }
    return res.status(200).json({ ok: true, mode: 'server', signed_out: n === 1 });
  }

  if (op === 'signout_all') {
    if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed', message: 'Sign out with a POST.' }); }
    const u = await sessionUser(sql, token);
    if (!u) return res.status(401).json({ ok: false, error: 'invalid_session', message: 'Sign in first, then sign out everywhere.' });
    await sql`delete from app_sessions where user_id = ${u.id}`;
    return res.status(200).json({ ok: true, mode: 'server', signed_out_all: true });
  }
  return res.status(400).json({ ok: false, error: 'unknown_auth_operation', message: 'That sign-in operation does not exist.' });
}

module.exports = {
  PIN_LEN, WEAK_PINS, MAX_TRIES, LOCK_MINUTES, SESSION_DAYS, TOKEN_HEADER, ENTER_LIMIT, ENTER_WINDOW_SEC, OPS, STATUS_TTL_MS,
  pinError, hashPin, verifyPin, lockMessage, triesMessage,
  newToken, tokenHash, looksLikeToken, tokenOf, clientIp,
  databaseUrl, standaloneMode, hostOf, connect, ensureSchema, rateLimit, sessionUser,
  status, storeStatus, supabaseStatus, verifyToken, enter, handle,
  phone,
  /** Drop the memoised drivers and the status answer (tests; a rotated URL needs neither). */
  _reset() { DRIVERS.clear(); statusCache = null; supaCache = null; },
};
