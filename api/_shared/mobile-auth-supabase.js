'use strict';
/**
 * mobile-auth-supabase.js - a mobile number + 4-digit PIN account that IS a
 * Supabase Auth user (2026-09-29).
 * ---------------------------------------------------------------------------
 * The operator's words: "use supabase cli and remote host for supabase account
 * creation", and, on production after signing in with the phone, "not working
 * after signin". A phone account kept in Neon or in the browser has no
 * Supabase identity, so every feature gated by RLS (brand workspaces, credits,
 * connections, the agents' workspace scope) refused it after a sign-in that
 * had visibly worked. Here the account is a real auth.users row and the
 * browser holds a real Supabase session, so `auth.uid()` names the person and
 * RLS lets them in like any account.
 *
 * SAME STATE MACHINE, SAME UI. One `enter` does sign-up and sign-in (new
 * number -> name + PIN; known number -> PIN; wrong -> "N tries left"; five ->
 * a fifteen-minute lock). The PIN rules (4 digits, the weak list, straight
 * runs) are mobile-auth-core's, unchanged. The browser never talks to GoTrue
 * to sign up or sign in: this module brokers both, with the service key.
 *
 * WHY THE PIN IS NOT THE GOTRUE PASSWORD. GoTrue's minimum password length is
 * 6, and even if it were 4, a 4-digit password would be ten thousand guesses
 * against a PUBLIC endpoint (`/auth/v1/token?grant_type=password` answers
 * anyone holding the anon key, which every browser has). So the password is
 * DERIVED on the server:
 *
 *     password = "Pn1." + base64url(HMAC-SHA256(MOBILE_PIN_PEPPER, "lifecycle-os/mobile-pin/v1|" + E.164 + "|" + PIN))
 *
 * 47 characters, 256 bits from the HMAC: nobody without the pepper can produce
 * a password GoTrue will accept, so the only place a PIN can be guessed is
 * THIS module, behind the lockout. The "Pn1." prefix carries one lowercase,
 * one uppercase, one digit and one symbol, so the derived password passes any
 * character-class rule a project can switch on; the length is under bcrypt's
 * 72-byte limit. With no pepper (or one shorter than 32 characters) nothing
 * is sent anywhere: `enter` refuses with 503 and a sentence. FAIL CLOSED.
 *
 * ROTATING THE PEPPER. Set the new value in MOBILE_PIN_PEPPER and the old one
 * in MOBILE_PIN_PEPPER_PREVIOUS. A sign-in that the new pepper does not open
 * is retried with the previous one; if THAT opens it, the account is re-keyed
 * on the spot (admin update, the new derived password) and the person notices
 * nothing. Both attempts are ONE reserved try: the lockout counts PIN guesses,
 * not HTTP calls. Remove PREVIOUS once the people who matter have signed in;
 * anyone who has not is reset by an operator (clear `pin_set_at` on their
 * mobile_pin_accounts row, and they choose a new PIN on the next sign-in).
 *
 * THE LOCKOUT IS DECIDED BEFORE ANY GOTRUE CALL, in the database, in one
 * statement (supabase/migrations/20260929173555_mobile_pin_supabase_accounts.sql,
 * mobile_pin_attempt). A try is RESERVED before the PIN is checked, so five
 * wrong PINs in flight at once use up the five, and the sixth is refused
 * without being evaluated. A right PIN clears it; a try that got no verdict
 * (the auth service did not answer) is handed back, so an outage cannot lock
 * a person out. The per-address budget (25 `enter` per 10 minutes) is counted
 * in the same database, keyed by a SHA-256 of the address.
 *
 * GOTRUE'S OWN RATE LIMITS ARE PER IP, AND EVERY CALL HERE COMES FROM VERCEL.
 * The password grant is on `/auth/v1/token`, which Supabase limits by IP
 * address (https://supabase.com/docs/guides/auth/rate-limits). Brokered from a
 * serverless function, all users share Vercel's addresses. Three things keep
 * that from locking everyone out: (1) the lockout and the per-address budget
 * above stop a guesser before GoTrue is asked, so an attacker cannot spend the
 * shared bucket faster than our own limits allow; (2) with a SECRET key
 * (`sb_secret_...`) this module sends `Sb-Forwarded-For: <caller address>`,
 * which that page documents as the way to have Auth rate-limit by the END
 * user's address - it needs the "IP address forwarding" setting on, and it is
 * not sent with a legacy service_role key, which the page says is not
 * supported; (3) token REFRESH is done by the browser against GoTrue directly
 * (auth.js), so the hourly refresh of every signed-in person is limited by
 * THEIR address, not ours. A 429 from GoTrue is not a wrong PIN: the reserved
 * try is handed back and the person is told the service is busy.
 *
 * WHO IS A PHONE ACCOUNT, TRUSTED. At creation this module writes
 * `app_metadata: { lifecycle_account: 'mobile-pin', phone_e164 }`. Supabase
 * documents user_metadata as editable by the user and app_metadata as not
 * (lint 0015, https://supabase.com/docs/guides/database/database-advisors?lint=0015_rls_references_user_metadata):
 * only the service role writes it. phoneIdentity() reads THAT, so
 * brand-workspace-core.requireUser() can report `provider:'mobile-pin'` and
 * credits keep the phone rules. A user with no email and a phone but no marker
 * (someone who signed up against GoTrue directly, which the runbook turns off)
 * is ALSO treated as a phone account - the stricter rules - never as an email
 * account with a welcome grant.
 *
 * EVERY ENDPOINT CALLED, AND WHERE IT IS DOCUMENTED. Two sources for each:
 * the Supabase docs page, and the Auth server's own OpenAPI description
 * (github.com/supabase/auth, openapi.yaml - "Supabase Auth REST API"), which
 * is where the request and response SHAPES below were read from.
 *   GET  /auth/v1/health                      OpenAPI `/health` "Service healthcheck."
 *        https://supabase.com/docs/guides/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR
 *   POST /auth/v1/admin/users                 { phone, password, phone_confirm, user_metadata, app_metadata }
 *        https://supabase.com/docs/reference/javascript/auth-admin-createuser
 *        (app_metadata = raw_app_meta_data, "metadata that the user should not be
 *        able to update": https://supabase.com/docs/guides/platform/migrating-to-supabase/auth0)
 *   PUT  /auth/v1/admin/users/{userId}        { password }   (PIN reset, pepper rotation)
 *        OpenAPI `/admin/users/{userId}` put "Update user's account data."
 *        https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid
 *   POST /auth/v1/token?grant_type=password   { phone, password } - the HTTP tab of
 *        "Signing in with a phone number and password":
 *        https://supabase.com/docs/guides/auth/passwords
 *        Response: OpenAPI AccessTokenResponseSchema (access_token, refresh_token,
 *        expires_in, expires_at, user).
 *   POST /auth/v1/token?grant_type=refresh_token  { refresh_token } - called by the
 *        BROWSER (auth.js), not here: OpenAPI `/token` example "grant_type=refresh_token";
 *        https://supabase.com/docs/reference/javascript/auth-refreshsession
 *   GET  /auth/v1/user                        the person's own token as the bearer
 *        OpenAPI `/user` get; https://supabase.com/docs/reference/javascript/auth-getuser
 *   POST /auth/v1/logout?scope=local|global   the person's own token as the bearer;
 *        OpenAPI `/logout` (scope global | local | others, 204 on success);
 *        https://supabase.com/docs/guides/auth/signout
 *   POST /rest/v1/rpc/<fn>                    a Postgres function over PostgREST
 *        https://supabase.com/docs/reference/javascript/rpc ,
 *        https://docs.postgrest.org/en/stable/references/api/functions.html
 *   Errors: OpenAPI ErrorSchema (`error_code` the string, `code` the HTTP status,
 *        `msg`); the codes themselves (invalid_credentials, phone_exists,
 *        over_request_rate_limit, phone_provider_disabled) from
 *        https://supabase.com/docs/guides/auth/debugging/error-codes
 *   Keys (a secret key goes in `apikey` only, never as a bearer):
 *        https://supabase.com/docs/guides/getting-started/api-keys
 *   Sb-Forwarded-For (secret key only, "IP Address Forwarding" switched on):
 *        https://supabase.com/docs/guides/auth/rate-limits
 *
 * The plain PIN is never stored, never logged and never sent anywhere: it
 * exists in this process only long enough to be hashed into the password.
 *
 * NOT A FUNCTION FILE (api/_shared/ is outside the Hobby 12-function cap).
 * Reached through mobile-auth-core.handle() when status() answers 'supabase'.
 * ---------------------------------------------------------------------------
 */

const crypto = require('node:crypto');
const phoneRules = require('./phone-rules.js');

const MARK = 'lifecycle_account';
const MARK_VALUE = 'mobile-pin';
const PEPPER_MIN = 32;
const TIMEOUT_MS = 8000;
const STALE_CLAIM_SECONDS = 120;
const MIGRATION = 'supabase/migrations/20260929173555_mobile_pin_supabase_accounts.sql';

/* ── configuration ───────────────────────────────────────────────────────── */

function hostOf(url) { try { return new URL(url).hostname; } catch (_) { return ''; } }

/**
 * The project, or null when this deployment has no Supabase URL and server key.
 * `SUPABASE_SECRET_KEY` (sb_secret_...) is preferred; the legacy
 * SUPABASE_SERVICE_ROLE_KEY works the same except for IP forwarding.
 */
function config() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serverKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !serverKey) return null;
  const pub = publicKey();
  return { url, serverKey, anonKey: pub || serverKey, publicKey: pub, secretKey: /^sb_secret_/.test(serverKey), host: hostOf(url) || 'the configured Supabase host' };
}

/**
 * The key the BROWSER may hold: the anon key or the publishable key, in that
 * order, and never a server key. Review finding (2026-10-03): the server
 * accepted SUPABASE_PUBLISHABLE_KEY while /api/public-config published only
 * the anon variables, so a deployment configured with a publishable key had a
 * browser that could not renew its session, and every session went
 * unverified after an hour. public-config now publishes THIS, so the two
 * cannot disagree; status() does not report supabase mode without it.
 * A value that is a server key is refused rather than published: an
 * `sb_secret_` key, the configured service key itself, or a JWT whose `role`
 * claim is service_role.
 */
function publicKey() {
  const k = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!k || isServerKey(k)) return '';
  return k;
}
function isServerKey(k) {
  if (/^sb_secret_/.test(k)) return true;
  const servers = [process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_SERVICE_KEY].map((x) => String(x || '').trim()).filter(Boolean);
  if (servers.includes(k)) return true;
  const parts = k.split('.');
  if (parts.length === 3) {
    try { const c = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); if (c && c.role === 'service_role') return true; } catch (_) { /* not a JWT */ }
  }
  return false;
}

function pepper() {
  const p = String(process.env.MOBILE_PIN_PEPPER || '').trim();
  return p.length >= PEPPER_MIN ? p : '';
}
function previousPepper() {
  const p = String(process.env.MOBILE_PIN_PEPPER_PREVIOUS || '').trim();
  return p.length >= PEPPER_MIN ? p : '';
}

/** The GoTrue password for this number and PIN under this pepper. Never logged. */
function derivePassword(pep, e164, pin) {
  const mac = crypto.createHmac('sha256', pep).update('lifecycle-os/mobile-pin/v1|' + e164 + '|' + String(pin)).digest('base64url');
  return 'Pn1.' + mac;
}

/** The address, as a rate-limit key only: hashed, never stored as typed. */
function addressKey(ip) {
  return crypto.createHash('sha256').update('lifecycle-os/address|' + String(ip || 'unknown')).digest('hex');
}

/* ── HTTP ────────────────────────────────────────────────────────────────── */

/** Headers for a call made AS THE SERVER. A secret key rides in `apikey` only. */
function serverHeaders(cfg, extra) {
  const h = { apikey: cfg.serverKey, 'Content-Type': 'application/json' };
  if (!cfg.secretKey) h.Authorization = 'Bearer ' + cfg.serverKey;
  return Object.assign(h, extra || {});
}
/** Headers for a call made WITH THE PERSON'S access token. */
function userHeaders(cfg, jwt) {
  return { apikey: cfg.anonKey, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' };
}

/**
 * One call. Never throws: `{ status, json, code, message, network }`, where
 * `network` is true when nothing answered (a refused connection, a DNS
 * failure, a timeout) - the difference between "the service said no" and
 * "the service is not there".
 */
async function call(cfg, method, path, opts) {
  const o = opts || {};
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), o.timeoutMs || TIMEOUT_MS) : null;
  try {
    const res = await fetch(cfg.url + path, {
      method, headers: o.headers || serverHeaders(cfg), cache: 'no-store',
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: ctl ? ctl.signal : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    const j = json && typeof json === 'object' ? json : {};
    return {
      status: res.status, ok: res.status >= 200 && res.status < 300, json,
      // OpenAPI ErrorSchema: `error_code` is the string, `code` the HTTP
      // status (an integer), `error` the older OAuth-style field.
      code: String(j.error_code || (typeof j.code === 'string' ? j.code : '') || j.error || ''),
      message: String(j.msg || j.message || j.error_description || ''),
      network: false,
    };
  } catch (err) {
    return { status: 0, ok: false, json: null, code: 'network', message: String(err && err.message || err), network: true };
  } finally { if (timer) clearTimeout(timer); }
}

/** A refusal this module answers with: a code for code, a sentence for people. */
class AuthStepError extends Error {
  constructor(status, error, message, extra) { super(message); this.status = status; this.error = error; this.extra = extra || {}; }
}

/** A PostgREST RPC as the service role, over the migration's functions. */
async function rpc(cfg, fn, args) {
  const r = await call(cfg, 'POST', '/rest/v1/rpc/' + fn, { headers: serverHeaders(cfg), body: args || {} });
  if (r.ok) return r.json;
  if (r.network) {
    throw new AuthStepError(503, 'backend_unreachable', 'The account database (' + cfg.host + ') is not answering, so nothing could be checked or saved. Try again once it answers.');
  }
  if (r.status === 404 || /PGRST20[25]/.test(r.code)) {
    throw new AuthStepError(503, 'accounts_schema_missing',
      'Sign-in is not set up on this database yet: the mobile_pin_* functions are missing. An operator applies ' + MIGRATION + ' with `npm run db:push` (the Supabase CLI).',
      { function: fn });
  }
  throw new AuthStepError(503, 'accounts_store_failed', 'The account database (' + cfg.host + ') refused the request, so nothing was saved. Try again in a moment.', { function: fn, status: r.status });
}

/* ── who is this, from a GoTrue user ─────────────────────────────────────── */

/**
 * The phone identity a GoTrue user carries, or null for an email account.
 * Read from app_metadata (service-role-only) first; a phone-only user without
 * the marker is a phone account too, never an email one.
 */
function phoneIdentity(user) {
  if (!user || typeof user !== 'object') return null;
  const am = user.app_metadata && typeof user.app_metadata === 'object' ? user.app_metadata : {};
  const um = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  const name = String(um.name || '').slice(0, 60);
  if (am[MARK] === MARK_VALUE) {
    const np = phoneRules.normPhone(am.phone_e164);
    const digits = String(user.phone || '').replace(/\D/g, '');
    const fallback = digits ? phoneRules.normPhone('+' + digits) : null;
    const e164 = (np && np.e164) || (fallback && fallback.e164) || '';
    return { e164, name, source: 'broker' };
  }
  const email = String(user.email || '').trim();
  const digits = String(user.phone || '').replace(/\D/g, '');
  if (!email && digits) {
    const np = phoneRules.normPhone('+' + digits);
    return { e164: np ? np.e164 : '+' + digits, name, source: 'gotrue' };
  }
  return null;
}

/* ── the three GoTrue steps ──────────────────────────────────────────────── */

function busyOrDown(cfg, r) {
  if (r.status === 429 || r.code === 'over_request_rate_limit') {
    return new AuthStepError(429, 'auth_service_busy', 'The account service (' + cfg.host + ') is busy right now and asked us to slow down. Nothing was counted against your PIN; try again in a minute.');
  }
  if (r.code === 'phone_provider_disabled' || /phone logins are disabled|phone.*disabled/i.test(r.message)) {
    return new AuthStepError(503, 'phone_provider_disabled', 'The account service (' + cfg.host + ') has phone sign-in switched off, so nobody can sign in with a mobile number yet. An operator enables the Phone provider (Authentication > Sign In / Providers). Nothing was counted against your PIN.');
  }
  return new AuthStepError(503, 'auth_service_unavailable', 'The account service (' + cfg.host + ') did not answer, so you are not signed in. Nothing was counted against your PIN; try again in a moment.');
}

/**
 * The password grant. `{ ok, session, user }`, or `{ ok:false, wrong:true }`,
 * or throws a busy/down/configuration refusal.
 *
 * WHICH ANSWERS COUNT AS A WRONG PIN. Only three answers hand the reserved try
 * back: 429 (the service asked us to slow down), 5xx / no answer (the service
 * is down), and `phone_provider_disabled` (the project is misconfigured). Every
 * OTHER refusal counts against the PIN - not only `invalid_credentials`.
 * Listing the wrong-PIN codes instead would make the lockout depend on the
 * auth service never adding or renaming one: an unrecognised refusal would be
 * refunded, and a guesser handed unlimited tries. Fail closed.
 */
async function passwordGrant(cfg, e164, password, ip) {
  const headers = { apikey: cfg.serverKey, 'Content-Type': 'application/json' };
  if (cfg.secretKey && ip && ip !== 'unknown') headers['Sb-Forwarded-For'] = ip;
  const r = await call(cfg, 'POST', '/auth/v1/token?grant_type=password', { headers, body: { phone: e164, password } });
  if (r.ok && r.json && r.json.access_token && r.json.refresh_token) return { ok: true, session: r.json, user: r.json.user || null };
  if (r.network || r.status === 429 || r.status >= 500 || r.code === 'over_request_rate_limit' || r.code === 'phone_provider_disabled') throw busyOrDown(cfg, r);
  if (r.ok) throw busyOrDown(cfg, { status: 502, code: 'no_session', message: 'answered without a session' });
  return { ok: false, wrong: true, code: r.code };
}

async function createUser(cfg, e164, password, name) {
  return call(cfg, 'POST', '/auth/v1/admin/users', {
    headers: serverHeaders(cfg),
    body: {
      phone: e164, password, phone_confirm: true,
      user_metadata: { name },
      app_metadata: { [MARK]: MARK_VALUE, phone_e164: e164 },
    },
  });
}

async function setPassword(cfg, userId, password) {
  return call(cfg, 'PUT', '/auth/v1/admin/users/' + encodeURIComponent(userId), { headers: serverHeaders(cfg), body: { password } });
}

/* ── the answer the browser gets on success ──────────────────────────────── */

function signedIn(session, fallbackUser, name, e164, created) {
  const u = session.user || fallbackUser || {};
  const expiresAt = Number(session.expires_at) || (Math.floor(Date.now() / 1000) + (Number(session.expires_in) || 3600));
  return {
    status: 200,
    body: {
      ok: true, exists: true, created: !!created, mode: 'supabase',
      token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: expiresAt,
      expires: null,
      user: { id: u.id, name, phone: e164 },
      message: created ? 'Account created and saved in the database.' : 'Signed in.',
    },
  };
}

/* ── enter: sign up or sign in, one step ─────────────────────────────────── */

const ENTER_LIMIT = 25;
const ENTER_WINDOW_SEC = 600;

/**
 * Returns { status, body }. `core` is mobile-auth-core (the PIN rules and the
 * sentences), passed in so the two modules cannot drift and cannot require
 * each other in a loop.
 */
async function enter(core, cfg, body, ip) {
  const b = body && typeof body === 'object' ? body : {};

  // 0. No pepper, no sign-in, and nothing is sent anywhere: FAIL CLOSED. A
  //    PIN cannot be turned into a password GoTrue accepts without it, so
  //    every later step would be a request that can only end in a refusal.
  if (!pepper()) return pepperRefusal();

  // 1. The per-address budget, counted in the database, before anything else.
  const allowed = await rpc(cfg, 'mobile_pin_rate_hit', { p_bucket: 'auth-enter', p_key: addressKey(ip), p_limit: ENTER_LIMIT, p_window_seconds: ENTER_WINDOW_SEC });
  if (allowed !== true) {
    return { status: 429, body: { ok: false, error: 'rate_limited', message: 'Too many sign-in attempts from this device. Please wait a few minutes and try again.' } };
  }

  // 2. The number, checked against its country's shape. Nothing is sent for a bad one.
  const np = phoneRules.normPhone(b.phone, b.cc);
  if (!np || !/^\+[1-9]\d{6,14}$/.test(np.e164)) {
    return { status: 400, body: { ok: false, error: 'phone_invalid', message: phoneRules.phoneError(b.cc) } };
  }
  const e164 = np.e164;

  // 3. Known, new, or being set up right now?
  const acct = (await rpc(cfg, 'mobile_pin_account', { p_phone: e164, p_stale_seconds: STALE_CLAIM_SECONDS })) || {};
  if (!acct.exists || (acct.pending && acct.stale)) return signUp(core, cfg, b, e164, ip, acct);
  if (acct.pending) {
    return { status: 409, body: { ok: false, error: 'account_pending', message: 'An account for this number is being set up right now. Try again in a moment.' } };
  }
  return signIn(core, cfg, b, e164, acct, ip);
}

async function signUp(core, cfg, b, e164, ip) {
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) {
    return { status: 200, body: { ok: true, exists: false, message: 'This number is new here, so we will set you up. Already have an account? Check the number.' } };
  }
  const perr = core.pinError(b.pin);
  if (perr) return { status: 200, body: { ok: true, exists: false, needPin: true, error: 'pin_invalid', message: perr } };
  const pep = pepper();
  if (!pep) return pepperRefusal();

  const claim = (await rpc(cfg, 'mobile_pin_claim', { p_phone: e164, p_name: name, p_stale_seconds: STALE_CLAIM_SECONDS })) || {};
  if (!claim.claimed && claim.locked) {
    const until = new Date(claim.locked_until || Date.now() + core.LOCK_MINUTES * 60000).toISOString();
    return { status: 429, body: { ok: false, locked: true, error: 'pin_locked', until, message: core.lockMessage(until) } };
  }
  if (!claim.claimed) {
    // Another sign-up for this number got there first. This request is a
    // SIGN-IN to that account and is held to the PIN check like any other.
    const acct = (await rpc(cfg, 'mobile_pin_account', { p_phone: e164, p_stale_seconds: STALE_CLAIM_SECONDS })) || {};
    if (acct.pending) return { status: 409, body: { ok: false, error: 'account_pending', message: 'An account for this number is being set up right now. Try again in a moment.' } };
    return signIn(core, cfg, b, e164, acct, ip);
  }

  const password = derivePassword(pep, e164, b.pin);
  const made = await createUser(cfg, e164, password, name);
  let userId = made.ok && made.json && made.json.id;
  let session = null;
  if (!userId) {
    if (made.code === 'phone_exists' || made.status === 422) {
      // An auth user with this number exists but was never bound here (a
      // sign-up whose function died after the auth service answered, or a
      // phone user made some other way). Only this server can derive its
      // password, so if the same PIN opens it, it is the same account: adopt
      // it. THAT IS A PIN CHECK, so it goes through the lockout first, keyed
      // by the phone on the claimed row (review finding, 2026-10-03): it used
      // to run unreserved, and a wrong PIN deleted the row and its count, so
      // the number could be guessed at the per-address budget alone.
      const res = (await rpc(cfg, 'mobile_pin_attempt', { p_phone: e164, p_max: core.MAX_TRIES, p_lock_seconds: core.LOCK_MINUTES * 60, p_pending: true })) || {};
      if (!res.allowed) {
        await rpc(cfg, 'mobile_pin_unclaim', { p_phone: e164 });
        const until = new Date(res.locked_until || Date.now() + core.LOCK_MINUTES * 60000).toISOString();
        return { status: 429, body: { ok: false, locked: true, error: 'pin_locked', until, message: core.lockMessage(until) } };
      }
      let g = null;
      try { g = await passwordGrant(cfg, e164, password, ip); } catch (e) {
        await rpc(cfg, 'mobile_pin_settle', { p_phone: e164, p_outcome: 'void', p_max: core.MAX_TRIES });
        await rpc(cfg, 'mobile_pin_unclaim', { p_phone: e164 });
        throw e;
      }
      if (!g.ok) {
        // Counted. The row is KEPT (unclaim only makes the claim stale while it
        // carries tries), so the next sign-up takes it over with the count.
        await rpc(cfg, 'mobile_pin_unclaim', { p_phone: e164 });
        const tries = Number(res.tries) || 0;
        if (res.last || tries >= core.MAX_TRIES) {
          const until = new Date(res.locked_until || Date.now() + core.LOCK_MINUTES * 60000).toISOString();
          return { status: 429, body: { ok: false, locked: true, error: 'pin_locked', until, message: core.lockMessage(until) } };
        }
        const left = Math.max(0, core.MAX_TRIES - tries);
        return { status: 409, body: { ok: false, error: 'phone_taken', left, message: 'This number already has an account in the account service, and that PIN does not open it. ' + left + ' ' + (left === 1 ? 'try' : 'tries') + ' left. If it is not yours, an operator can remove it from Authentication > Users.' } };
      }
      await rpc(cfg, 'mobile_pin_settle', { p_phone: e164, p_outcome: 'ok', p_max: core.MAX_TRIES });
      userId = g.user && g.user.id;
      session = g.session;
    } else {
      await rpc(cfg, 'mobile_pin_unclaim', { p_phone: e164 });
      throw busyOrDown(cfg, made);
    }
  }
  const bound = (await rpc(cfg, 'mobile_pin_bind', { p_phone: e164, p_user_id: userId })) || {};
  if (!bound.ok) {
    return { status: 409, body: { ok: false, error: 'account_pending', message: 'Another sign-up for this number finished first. Sign in with its PIN.' } };
  }
  if (!session) {
    const g = await passwordGrant(cfg, e164, password, ip);
    if (!g.ok) {
      // Created a moment ago with this exact password: a refusal here is the
      // service's configuration, not the person's PIN.
      throw new AuthStepError(503, 'auth_service_refused', 'Your account was created, but the account service (' + cfg.host + ') would not sign it in. Try signing in again in a moment.');
    }
    session = g.session;
  }
  return signedIn(session, made.json, name, e164, true);
}

async function signIn(core, cfg, b, e164, acct, ip) {
  const name = String(acct.name || '');
  if (acct.locked) {
    return { status: 429, body: { ok: false, locked: true, error: 'pin_locked', until: new Date(acct.locked_until).toISOString(), message: core.lockMessage(acct.locked_until) } };
  }
  if (!acct.pin_set) return resetPin(core, cfg, b, e164, acct, ip);
  if (!b.pin) return { status: 200, body: { ok: true, exists: true, needPin: true, name, message: 'Welcome back, ' + name + '. Type your PIN.' } };
  if (!/^\d{4}$/.test(String(b.pin))) {
    return { status: 200, body: { ok: true, exists: true, needPin: true, name, error: 'pin_invalid', message: 'Your PIN is ' + core.PIN_LEN + ' digits.' } };
  }
  const pep = pepper();
  if (!pep) return pepperRefusal();

  // THE LOCKOUT, BEFORE GOTRUE: reserve the try, or be refused.
  const res = (await rpc(cfg, 'mobile_pin_attempt', { p_phone: e164, p_max: core.MAX_TRIES, p_lock_seconds: core.LOCK_MINUTES * 60 })) || {};
  if (!res.allowed) {
    if (res.error === 'pending') return { status: 409, body: { ok: false, error: 'account_pending', message: 'An account for this number is being set up right now. Try again in a moment.' } };
    if (res.error === 'no_account') return { status: 409, body: { ok: false, error: 'account_pending', message: 'That account was just removed or is being set up again. Try again in a moment.' } };
    const until = res.locked_until || new Date(Date.now() + core.LOCK_MINUTES * 60000).toISOString();
    return { status: 429, body: { ok: false, locked: true, error: 'pin_locked', until: new Date(until).toISOString(), message: core.lockMessage(until) } };
  }

  let g;
  try {
    g = await passwordGrant(cfg, e164, derivePassword(pep, e164, b.pin), ip);
    if (!g.ok && previousPepper()) {
      // A pepper rotation in progress: the same PIN under the previous pepper.
      const old = await passwordGrant(cfg, e164, derivePassword(previousPepper(), e164, b.pin), ip);
      if (old.ok) {
        // Signed in either way; a re-key that fails is simply tried again on
        // the next sign-in, which the previous pepper still opens.
        await setPassword(cfg, old.user && old.user.id, derivePassword(pep, e164, b.pin));
        g = old;
      }
    }
  } catch (e) {
    await rpc(cfg, 'mobile_pin_settle', { p_phone: e164, p_outcome: 'void', p_max: core.MAX_TRIES });
    throw e;
  }

  if (g.ok) {
    if (acct.user_id && g.user && g.user.id && g.user.id !== acct.user_id) {
      // The number now belongs to a different auth user than the one on record.
      await rpc(cfg, 'mobile_pin_settle', { p_phone: e164, p_outcome: 'void', p_max: core.MAX_TRIES });
      throw new AuthStepError(409, 'account_mismatch', 'This number is linked to a different account than the one on record, so you were not signed in. An operator can check it in Authentication > Users.');
    }
    await rpc(cfg, 'mobile_pin_settle', { p_phone: e164, p_outcome: 'ok', p_max: core.MAX_TRIES });
    return signedIn(g.session, null, name, e164, false);
  }

  // A wrong PIN. Its reservation already counted it.
  const tries = Number(res.tries) || 0;
  if (res.last || tries >= core.MAX_TRIES) {
    const until = res.locked_until || new Date(Date.now() + core.LOCK_MINUTES * 60000).toISOString();
    return { status: 429, body: { ok: false, locked: true, error: 'pin_locked', until: new Date(until).toISOString(), message: core.lockMessage(until) } };
  }
  const left = Math.max(0, core.MAX_TRIES - tries);
  return { status: 401, body: { ok: false, wrongPin: true, left, error: 'pin_wrong', message: core.triesMessage(left) } };
}

/** An operator cleared pin_set_at: this sign-in chooses a new PIN. */
async function resetPin(core, cfg, b, e164, acct, ip) {
  const name = String(acct.name || '');
  const perr = core.pinError(b.pin);
  if (perr) {
    return { status: 200, body: { ok: true, exists: true, setPin: true, name, error: b.pin ? 'pin_invalid' : null, message: b.pin ? perr : 'Choose a new ' + core.PIN_LEN + '-digit PIN for this account.' } };
  }
  const pep = pepper();
  if (!pep) return pepperRefusal();
  const password = derivePassword(pep, e164, b.pin);
  const upd = await setPassword(cfg, acct.user_id, password);
  if (!upd.ok) throw busyOrDown(cfg, upd);
  await rpc(cfg, 'mobile_pin_bind', { p_phone: e164, p_user_id: acct.user_id });
  const g = await passwordGrant(cfg, e164, password, ip);
  if (!g.ok) throw new AuthStepError(503, 'auth_service_refused', 'Your new PIN was saved, but the account service (' + cfg.host + ') would not sign you in. Try signing in again in a moment.');
  return signedIn(g.session, null, name, e164, false);
}

function pepperRefusal() {
  return {
    status: 503,
    body: {
      ok: false, error: 'pin_pepper_missing',
      message: 'Sign-in is not available: this deployment has no MOBILE_PIN_PEPPER (32 or more random characters), which is what turns a PIN into a password the account service accepts. Nothing was sent and no account was made. An operator sets it in the deployment environment.',
    },
  };
}

/* ── the rest of the router, for this mode ───────────────────────────────── */

/** A Supabase access token: three base64url segments. */
function looksLikeJwt(t) { return typeof t === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(t) && t.length < 8192; }

function jwtOf(req) {
  const h = (req && req.headers) || {};
  const b = String(h.authorization || h.Authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(b.trim());
  if (m && looksLikeJwt(m[1].trim())) return m[1].trim();
  const own = String(h['x-lifecycle-token'] || h['X-Lifecycle-Token'] || '').trim();
  if (looksLikeJwt(own)) return own;
  return '';
}

/** GET /auth/v1/user with the person's token. `{ ok, user }` / `{ ok:false, status, network }`. */
async function getUser(cfg, jwt) {
  if (!looksLikeJwt(jwt)) return { ok: false, status: 401 };
  const r = await call(cfg, 'GET', '/auth/v1/user', { headers: userHeaders(cfg, jwt) });
  if (r.ok && r.json && r.json.id) return { ok: true, user: r.json };
  return { ok: false, status: r.network ? 0 : r.status, network: r.network, code: r.code };
}

async function me(cfg, req) {
  const u = await getUser(cfg, jwtOf(req));
  if (u.ok) {
    const id = phoneIdentity(u.user);
    return { status: 200, body: { ok: true, mode: 'supabase', user: { id: u.user.id, name: (id && id.name) || '', phone: (id && id.e164) || '' }, message: modeMessage(cfg) } };
  }
  if (u.network || u.status >= 500) {
    return { status: 503, body: { ok: false, error: 'backend_unreachable', mode: 'supabase', host: cfg.host, message: 'The account service (' + cfg.host + ') is not answering, so your sign-in cannot be checked right now.' } };
  }
  return { status: 401, body: { ok: false, error: 'invalid_session', message: 'Your sign-in has expired or was signed out. Sign in again with your mobile number and PIN.' } };
}

/** POST /auth/v1/logout?scope=local (this session) or global (every session of this account). */
async function signout(cfg, req, scope) {
  const jwt = jwtOf(req);
  if (!jwt) return { status: 200, body: { ok: true, mode: 'supabase', signed_out: false } };
  const r = await call(cfg, 'POST', '/auth/v1/logout?scope=' + (scope === 'global' ? 'global' : 'local'), { headers: userHeaders(cfg, jwt) });
  if (r.ok) return { status: 200, body: { ok: true, mode: 'supabase', signed_out: true, scope: scope === 'global' ? 'global' : 'local' } };
  if (scope === 'global' && !r.network && r.status < 500) {
    return { status: 401, body: { ok: false, error: 'invalid_session', message: 'Sign in first, then sign out everywhere.' } };
  }
  // A token GoTrue no longer recognises is already signed out; one it could
  // not be asked about is reported as not signed out, so the browser says so.
  return { status: 200, body: { ok: true, mode: 'supabase', signed_out: !r.network && r.status < 500, detail: r.code || r.message || '' } };
}

function modeMessage(cfg) {
  return 'Account saved in the database (' + cfg.host + '); brands are saved to your account.';
}

/** Is the auth service there? GET /auth/v1/health. */
async function health(cfg, timeoutMs) {
  const r = await call(cfg, 'GET', '/auth/v1/health', { headers: { apikey: cfg.anonKey }, timeoutMs: timeoutMs || 4000 });
  return { ok: r.ok, status: r.status, network: r.network, detail: r.ok ? '' : (r.message || r.code || ('HTTP ' + r.status)) };
}

/**
 * The router body for mode 'supabase'. Every AuthStepError becomes its status
 * and sentence; anything else is left to public-config's catch, which answers
 * a sentence without the throw's message.
 */
async function handle(core, cfg, req, res, op, method, body) {
  try {
    if (op === 'enter') {
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed', message: 'Sign in with a POST.' }); }
      const r = await enter(core, cfg, body, core.clientIp(req));
      return res.status(r.status).json(r.body);
    }
    if (op === 'me') { const r = await me(cfg, req); return res.status(r.status).json(r.body); }
    if (op === 'signout' || op === 'signout_all') {
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed', message: 'Sign out with a POST.' }); }
      const r = await signout(cfg, req, op === 'signout_all' ? 'global' : 'local');
      if (op === 'signout_all' && r.status === 200) r.body.signed_out_all = !!r.body.signed_out;
      return res.status(r.status).json(r.body);
    }
    return res.status(400).json({ ok: false, error: 'unknown_auth_operation', message: 'That sign-in operation does not exist.' });
  } catch (e) {
    if (e instanceof AuthStepError) return res.status(e.status).json(Object.assign({ ok: false, error: e.error, message: e.message, mode: 'supabase' }, e.extra));
    throw e;
  }
}

module.exports = {
  MARK, MARK_VALUE, PEPPER_MIN, MIGRATION, ENTER_LIMIT, ENTER_WINDOW_SEC, STALE_CLAIM_SECONDS,
  config, publicKey, pepper, previousPepper, derivePassword, addressKey, phoneIdentity, looksLikeJwt, jwtOf,
  health, getUser, enter, me, signout, handle, modeMessage, AuthStepError,
};
