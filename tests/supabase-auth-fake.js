'use strict';
/**
 * supabase-auth-fake.js - a faithful fake of the hosted Supabase endpoints the
 * phone-account sign-in uses, answered at the `fetch` boundary.
 * ---------------------------------------------------------------------------
 * Not a spec (no `.spec.js` suffix): Playwright does not collect it and the
 * executed-tests ratchet does not scan it. Shared by
 * tests/supabase-phone-accounts.spec.js (server side, as `global.fetch`) and
 * its Chromium cases (the browser's own calls, through page.route).
 *
 * EVERY ENDPOINT HERE IS ONE THE CODE CALLS, MODELLED ON ITS DOCUMENTATION.
 * Shapes are read from the Auth server's own OpenAPI description
 * (github.com/supabase/auth, openapi.yaml) and the Supabase docs page named
 * beside each handler. Anything else THROWS, so a request the code adds later
 * cannot pass by being answered with a default.
 *
 *   GET  /auth/v1/health                       OpenAPI `/health`
 *   POST /auth/v1/admin/users                  docs/reference/javascript/auth-admin-createuser
 *   PUT  /auth/v1/admin/users/{id}             OpenAPI `/admin/users/{userId}` put
 *   POST /auth/v1/token?grant_type=password    docs/guides/auth/passwords (HTTP tab, phone)
 *   POST /auth/v1/token?grant_type=refresh_token  OpenAPI `/token` refresh_token example
 *   GET  /auth/v1/user                         OpenAPI `/user` get
 *   POST /auth/v1/logout?scope=                OpenAPI `/logout` (204)
 *   POST /rest/v1/rpc/<fn>                     docs/reference/javascript/rpc (PostgREST)
 *   /rest/v1/<table>                           PostgREST tables, RLS modelled per policy
 *
 * Errors follow the OpenAPI ErrorSchema: `{ code: <http status>, error_code,
 * msg }`, with the codes listed on docs/guides/auth/debugging/error-codes.
 *
 * THE PIN FUNCTIONS mirror supabase/migrations/20260929173555_mobile_pin_
 * supabase_accounts.sql statement for statement, and are reachable ONLY as
 * service_role, as the migration's REVOKE/GRANT makes them. Each RPC runs to
 * completion before the next starts - one statement under its row lock - but
 * every call first yields to the event loop, so two requests in flight
 * interleave at every await exactly as they would against a database.
 *
 * Passwords are stored as a SHA-256 (standing in for GoTrue's bcrypt): what
 * matters to the tests is that the fake never needs the plain value back, and
 * that `minimum_password_length` (6, the CLI's default) is enforced.
 * ---------------------------------------------------------------------------
 */
const crypto = require('crypto');

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const uuid = () => crypto.randomUUID();
const nowS = () => Math.floor(Date.now() / 1000);

function lowerKeys(h) {
  const out = {};
  if (!h) return out;
  if (typeof h.forEach === 'function' && !Array.isArray(h)) { h.forEach((v, k) => { out[String(k).toLowerCase()] = v; }); return out; }
  for (const [k, v] of Object.entries(h)) out[String(k).toLowerCase()] = v;
  return out;
}

/** A fetch Response look-alike. */
function response(status, body, headers) {
  const text = body === undefined || body === null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  const h = lowerKeys(Object.assign({ 'content-type': 'application/json' }, headers || {}));
  return {
    ok: status >= 200 && status < 300, status, url: '',
    headers: { get: (k) => (Object.prototype.hasOwnProperty.call(h, String(k).toLowerCase()) ? h[String(k).toLowerCase()] : null) },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/** OpenAPI ErrorSchema. */
const authError = (status, error_code, msg) => ({ status, body: { code: status, error_code, msg } });

function createFake(opts) {
  const o = opts || {};
  const f = {
    url: o.url || 'https://lifecycle-os-fake.supabase.test',
    anonKey: o.anonKey || 'anon-fake-' + crypto.randomBytes(6).toString('hex'),
    serviceKey: o.serviceKey || 'service-fake-' + crypto.randomBytes(6).toString('hex'),
    config: { phoneEnabled: true, minPasswordLength: 6, jwtExpiry: 3600, wrongPasswordCode: 'invalid_credentials' },
    healthy: true,     // GET /auth/v1/health answers 200
    down: false,       // nothing answers at all (a network failure)
    users: new Map(),            // id -> auth.users row
    sessions: new Map(),         // session id -> { user_id, revoked }
    access: new Map(),           // access token -> { session_id, user_id, exp }
    refresh: new Map(),          // refresh token -> { session_id, used }
    tables: {
      mobile_pin_accounts: new Map(),     // phone -> row
      mobile_pin_rate_limits: new Map(),  // bucket|k -> row
      brand_workspaces: [],
      brand_user_prefs: new Map(),        // user_id -> row
      credit_wallets: [],
      credit_ledger: [],
      credit_orders: [],
    },
    calls: [],
  };

  /* ── who is calling (PostgREST roles; GoTrue admin) ────────────────────── */
  function bearer(h) { const m = /^Bearer\s+(.+)$/i.exec(String(h.authorization || '').trim()); return m ? m[1].trim() : ''; }
  function validKey(h) { return h.apikey === f.anonKey || h.apikey === f.serviceKey; }
  function isService(h) { return h.apikey === f.serviceKey && (!h.authorization || bearer(h) === f.serviceKey); }
  /** The session behind an access token, or a reason it is not one. */
  function sessionOf(token) {
    const a = f.access.get(token);
    if (!a) return { error: authError(403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature') };
    if (a.exp <= nowS()) return { error: authError(403, 'bad_jwt', 'invalid JWT: token is expired') };
    const s = f.sessions.get(a.session_id);
    if (!s || s.revoked) return { error: authError(403, 'session_not_found', 'Session from session_id claim in JWT does not exist') };
    const u = f.users.get(a.user_id);
    if (!u) return { error: authError(403, 'user_not_found', 'User from sub claim in JWT does not exist') };
    return { user: u, session_id: a.session_id };
  }
  /** PostgREST: service_role, authenticated (with uid) or anon. */
  function roleOf(h) {
    if (isService(h)) return { role: 'service_role' };
    if (!validKey(h)) return { error: { status: 401, body: { message: 'Invalid API key' } } };
    const t = bearer(h);
    if (!t || t === f.anonKey) return { role: 'anon' };
    const s = sessionOf(t);
    if (s.error) return { error: { status: 401, body: { code: 'PGRST301', message: 'JWT expired or invalid' } } };
    return { role: 'authenticated', uid: s.user.id };
  }

  /* ── GoTrue objects ────────────────────────────────────────────────────── */
  function publicUser(u) {
    return {
      id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email || '', phone: u.phone || '',
      phone_confirmed_at: u.phone_confirmed_at || null, confirmed_at: u.phone_confirmed_at || null,
      app_metadata: Object.assign({}, u.app_metadata), user_metadata: Object.assign({}, u.user_metadata),
      identities: [], created_at: u.created_at, updated_at: u.updated_at, is_anonymous: false,
    };
  }
  function mint(userId, sessionId) {
    const u = f.users.get(userId);
    const exp = nowS() + f.config.jwtExpiry;
    const payload = { sub: userId, aud: 'authenticated', role: 'authenticated', exp, session_id: sessionId, phone: u.phone, app_metadata: u.app_metadata, user_metadata: u.user_metadata };
    const access_token = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify(payload)) + '.' + crypto.randomBytes(16).toString('base64url');
    const refresh_token = crypto.randomBytes(12).toString('base64url');
    f.access.set(access_token, { session_id: sessionId, user_id: userId, exp });
    f.refresh.set(refresh_token, { session_id: sessionId, used: false });
    return { access_token, token_type: 'bearer', expires_in: f.config.jwtExpiry, expires_at: exp, refresh_token, user: publicUser(u) };
  }
  /** GoTrue stores a phone without its '+'. */
  const storedPhone = (p) => String(p || '').replace(/\D/g, '');

  /* ── GoTrue ───────────────────────────────────────────────────────────── */
  function gotrue(method, path, q, h, body) {
    if (!validKey(h)) return { status: 401, body: { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' } };
    if (path === '/auth/v1/health' && method === 'GET') {
      return f.healthy ? { status: 200, body: { version: 'fake', name: 'GoTrue', description: 'GoTrue is a user registration and authentication API' } } : { status: 503, body: { message: 'unhealthy' } };
    }
    if (path === '/auth/v1/admin/users' && method === 'POST') {
      if (!isService(h)) return authError(403, 'not_admin', 'User not allowed');
      const phone = storedPhone(body.phone);
      if (!phone && !body.email) return authError(400, 'validation_failed', 'Unable to validate request');
      if (body.password != null && String(body.password).length < f.config.minPasswordLength) {
        return authError(422, 'weak_password', 'Password should be at least ' + f.config.minPasswordLength + ' characters.');
      }
      if (phone && [...f.users.values()].some((u) => u.phone === phone)) return authError(422, 'phone_exists', 'Phone number already registered by another user');
      const at = new Date().toISOString();
      const u = {
        id: uuid(), phone, email: body.email || '',
        password_hash: body.password != null ? sha(body.password) : null,
        phone_confirmed_at: body.phone_confirm ? at : null,
        // GoTrue sets provider/providers itself and merges what the admin sent.
        app_metadata: Object.assign({ provider: phone ? 'phone' : 'email', providers: [phone ? 'phone' : 'email'] }, body.app_metadata || {}),
        user_metadata: Object.assign({}, body.user_metadata || {}),
        created_at: at, updated_at: at,
      };
      f.users.set(u.id, u);
      return { status: 200, body: publicUser(u) };
    }
    let m = /^\/auth\/v1\/admin\/users\/([^/]+)$/.exec(path);
    if (m && method === 'PUT') {
      if (!isService(h)) return authError(403, 'not_admin', 'User not allowed');
      const u = f.users.get(decodeURIComponent(m[1]));
      if (!u) return authError(404, 'user_not_found', 'User not found');
      if (body.password != null) {
        if (String(body.password).length < f.config.minPasswordLength) return authError(422, 'weak_password', 'Password should be at least ' + f.config.minPasswordLength + ' characters.');
        u.password_hash = sha(body.password);
      }
      if (body.app_metadata) u.app_metadata = Object.assign({}, u.app_metadata, body.app_metadata);
      if (body.user_metadata) u.user_metadata = Object.assign({}, u.user_metadata, body.user_metadata);
      u.updated_at = new Date().toISOString();
      return { status: 200, body: publicUser(u) };
    }
    if (path === '/auth/v1/token' && method === 'POST' && q.get('grant_type') === 'password') {
      if (body.phone != null && !f.config.phoneEnabled) return authError(422, 'phone_provider_disabled', 'Phone logins are disabled');
      const phone = storedPhone(body.phone);
      const u = [...f.users.values()].find((x) => phone && x.phone === phone);
      if (!u || !u.password_hash || u.password_hash !== sha(body.password)) return authError(400, f.config.wrongPasswordCode, 'Invalid login credentials');
      if (!u.phone_confirmed_at) return authError(400, 'phone_not_confirmed', 'Phone not confirmed');
      const sid = uuid();
      f.sessions.set(sid, { user_id: u.id, revoked: false });
      return { status: 200, body: mint(u.id, sid) };
    }
    if (path === '/auth/v1/token' && method === 'POST' && q.get('grant_type') === 'refresh_token') {
      const r = f.refresh.get(String(body.refresh_token || ''));
      if (!r) return authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      const s = f.sessions.get(r.session_id);
      if (!s || s.revoked) return authError(400, 'session_not_found', 'Invalid Refresh Token: Session Expired (Revoked by Newer Login)');
      if (r.used) return authError(400, 'refresh_token_already_used', 'Invalid Refresh Token: Already Used');
      r.used = true;
      return { status: 200, body: mint(s.user_id, r.session_id) };
    }
    if (path === '/auth/v1/user' && method === 'GET') {
      const t = bearer(h);
      if (!t) return authError(401, 'no_authorization', 'This endpoint requires a Bearer token');
      const s = sessionOf(t);
      if (s.error) return s.error;
      return { status: 200, body: publicUser(s.user) };
    }
    if (path === '/auth/v1/logout' && method === 'POST') {
      const t = bearer(h);
      if (!t) return authError(401, 'no_authorization', 'This endpoint requires a Bearer token');
      const s = sessionOf(t);
      if (s.error) return s.error;
      const scope = q.get('scope') || 'global';
      for (const [sid, row] of f.sessions) {
        if (row.user_id !== s.user.id) continue;
        if (scope === 'local' && sid !== s.session_id) continue;
        if (scope === 'others' && sid === s.session_id) continue;
        row.revoked = true;
      }
      return { status: 204, body: null };
    }
    throw new Error('supabase-auth-fake: no GoTrue endpoint ' + method + ' ' + path + (q.toString() ? '?' + q : ''));
  }

  /* ── the migration's functions, as service_role only ──────────────────── */
  const ACC = f.tables.mobile_pin_accounts;
  const accountJson = (p, stale) => {
    const a = ACC.get(p);
    if (!a) return { exists: false };
    return {
      exists: true, pending: a.user_id == null,
      stale: a.user_id == null && a.claimed_at < Date.now() - stale * 1000,
      user_id: a.user_id, name: a.name, pin_tries: a.pin_tries,
      locked_until: a.locked_until ? new Date(a.locked_until).toISOString() : null,
      locked: !!(a.locked_until && a.locked_until > Date.now()), pin_set: a.pin_set_at != null,
    };
  };
  const RPC = {
    mobile_pin_rate_hit({ p_bucket, p_key, p_limit, p_window_seconds }) {
      for (const [k, r] of f.tables.mobile_pin_rate_limits) if (r.window_start < Date.now() - 86400000) f.tables.mobile_pin_rate_limits.delete(k);
      const key = p_bucket + '|' + p_key;
      let r = f.tables.mobile_pin_rate_limits.get(key);
      if (!r) { r = { window_start: Date.now(), n: 1 }; f.tables.mobile_pin_rate_limits.set(key, r); }
      else if (r.window_start < Date.now() - p_window_seconds * 1000) { r.window_start = Date.now(); r.n = 1; }
      else r.n += 1;
      return r.n <= p_limit;
    },
    mobile_pin_account({ p_phone, p_stale_seconds }) { return accountJson(p_phone, p_stale_seconds == null ? 120 : p_stale_seconds); },
    mobile_pin_claim({ p_phone, p_name, p_stale_seconds }) {
      if (!/^\+[1-9][0-9]{6,14}$/.test(p_phone)) throw Object.assign(new Error('violates check constraint "mobile_pin_accounts_phone_e164"'), { pg: '23514' });
      const a = ACC.get(p_phone);
      if (!a) { ACC.set(p_phone, { phone: p_phone, user_id: null, name: p_name, pin_tries: 0, locked_until: null, pin_set_at: null, claimed_at: Date.now() }); return { claimed: true }; }
      if (a.user_id == null && a.claimed_at < Date.now() - (p_stale_seconds == null ? 120 : p_stale_seconds) * 1000) {
        Object.assign(a, { name: p_name, claimed_at: Date.now(), pin_tries: 0, locked_until: null });
        return { claimed: true };
      }
      return { claimed: false };
    },
    mobile_pin_bind({ p_phone, p_user_id }) {
      const a = ACC.get(p_phone);
      if (!a || !(a.user_id == null || a.user_id === p_user_id)) return { ok: false, error: 'not_claimed' };
      Object.assign(a, { user_id: p_user_id, pin_set_at: Date.now(), pin_tries: 0, locked_until: null });
      return { ok: true, user_id: a.user_id, name: a.name };
    },
    mobile_pin_unclaim({ p_phone }) {
      const a = ACC.get(p_phone);
      if (a && a.user_id == null) { ACC.delete(p_phone); return true; }
      return false;
    },
    mobile_pin_attempt({ p_phone, p_max, p_lock_seconds }) {
      const a = ACC.get(p_phone);
      const expired = !!(a && a.locked_until && a.locked_until <= Date.now());
      if (a && a.user_id != null && (!a.locked_until || a.locked_until <= Date.now())) {
        const tries = expired ? 1 : a.pin_tries + 1;
        a.locked_until = tries >= p_max ? Date.now() + p_lock_seconds * 1000 : (expired ? null : a.locked_until);
        a.pin_tries = tries;
        return { allowed: true, tries, locked_until: a.locked_until ? new Date(a.locked_until).toISOString() : null, user_id: a.user_id, last: tries >= p_max };
      }
      if (!a) return { allowed: false, error: 'no_account' };
      return { allowed: false, tries: a.pin_tries, locked_until: a.locked_until ? new Date(a.locked_until).toISOString() : null, user_id: a.user_id, error: a.user_id == null ? 'pending' : 'locked' };
    },
    mobile_pin_settle({ p_phone, p_outcome, p_max }) {
      const a = ACC.get(p_phone);
      if (p_outcome === 'ok') { if (a) { a.pin_tries = 0; a.locked_until = null; } }
      else if (p_outcome === 'void') {
        if (a && a.pin_tries > 0) { const before = a.pin_tries; a.pin_tries = Math.max(before - 1, 0); if (before - 1 < p_max) a.locked_until = null; }
      } else throw Object.assign(new Error('mobile_pin_settle: outcome must be ok or void'), { pg: '22023' });
      return { ok: true, tries: a ? a.pin_tries : 0, locked_until: a && a.locked_until ? new Date(a.locked_until).toISOString() : null };
    },
  };
  const SERVICE_ONLY = new Set(Object.keys(RPC).concat(['credit_wallet_id', 'credit_grant', 'credit_hold', 'credit_settle', 'credit_release', 'credit_fulfil_order']));

  /* ── the credit functions the meter calls (service role) ──────────────── */
  Object.assign(RPC, {
    credit_wallet_id({ p_user, p_workspace }) {
      let w = f.tables.credit_wallets.find((x) => x.user_id === p_user && (x.workspace_id || null) === (p_workspace || null));
      if (!w) { w = { id: uuid(), user_id: p_user, workspace_id: p_workspace || null, balance: 0, held: 0, lifetime_granted: 0, lifetime_spent: 0, low_balance_threshold: 0 }; f.tables.credit_wallets.push(w); }
      return w.id;
    },
    credit_grant({ p_user, p_workspace, p_amount, p_ref, p_kind }) {
      const w = f.tables.credit_wallets.find((x) => x.user_id === p_user && (x.workspace_id || null) === (p_workspace || null));
      if (!w) throw new Error('no wallet');
      w.balance += Number(p_amount) || 0; w.lifetime_granted += Number(p_amount) || 0;
      f.tables.credit_ledger.push({ id: uuid(), user_id: p_user, workspace_id: p_workspace || null, kind: p_kind || 'grant', amount: p_amount, ref: p_ref || null });
      return { ok: true, balance: w.balance };
    },
    credit_hold({ p_user, p_workspace, p_amount }) {
      const w = f.tables.credit_wallets.find((x) => x.user_id === p_user && (x.workspace_id || null) === (p_workspace || null));
      if (!w || w.balance - w.held < p_amount) return { ok: false, error: 'insufficient_credits', balance: w ? w.balance : 0, required: p_amount };
      w.held += p_amount;
      const hold_id = uuid();
      f.tables.credit_ledger.push({ id: hold_id, user_id: p_user, kind: 'hold', amount: p_amount, open: true, wallet: w.id });
      return { ok: true, hold_id, balance: w.balance - w.held };
    },
    credit_settle({ p_hold, p_actual }) {
      const h = f.tables.credit_ledger.find((x) => x.id === p_hold && x.open);
      if (!h) return { ok: true, already: true };
      const w = f.tables.credit_wallets.find((x) => x.id === h.wallet);
      h.open = false; w.held -= h.amount; w.balance -= p_actual; w.lifetime_spent += p_actual;
      return { ok: true, charged: p_actual, refunded: h.amount - p_actual, balance: w.balance };
    },
    credit_fulfil_order({ p_order, p_provider, p_ref }) {
      const o = f.tables.credit_orders.find((x) => x.id === p_order);
      if (!o) return { ok: false };
      if (o.status !== 'pending') return { ok: true, credited: false, already_fulfilled: true, status: o.status };
      o.status = 'paid'; o.provider = p_provider; o.provider_ref = p_ref;
      RPC.credit_wallet_id({ p_user: o.user_id, p_workspace: o.workspace_id });
      const g = RPC.credit_grant({ p_user: o.user_id, p_workspace: o.workspace_id, p_amount: o.credits, p_ref: 'order:' + o.id, p_kind: 'purchase' });
      return { ok: true, credited: true, order_id: o.id, credits: o.credits, balance: g.balance };
    },
    credit_release({ p_hold }) {
      const h = f.tables.credit_ledger.find((x) => x.id === p_hold && x.open);
      if (!h) return { ok: true, already: true };
      const w = f.tables.credit_wallets.find((x) => x.id === h.wallet);
      h.open = false; w.held -= h.amount;
      return { ok: true, released: h.amount };
    },
  });

  /* ── PostgREST ────────────────────────────────────────────────────────── */
  function eqFilters(q) {
    const out = {};
    q.forEach((v, k) => { if (/^eq\./.test(v)) out[k] = decodeURIComponent(v.slice(3)); else if (v === 'is.null') out[k] = null; });
    return out;
  }
  const match = (row, flt) => Object.entries(flt).every(([k, v]) => (v === null ? row[k] == null : String(row[k]) === v));
  function postgrest(method, path, q, h, body) {
    const who = roleOf(h);
    if (who.error) return who.error;
    let m = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(path);
    if (m && method === 'POST') {
      const fn = m[1];
      if (fn === 'brand_fields_claim_user') {
        if (who.role !== 'authenticated') return { status: 401, body: { code: '42501', message: 'permission denied for function brand_fields_claim_user' } };
        return { status: 200, body: Array.isArray(body.p_fields) ? body.p_fields.length : 0 };
      }
      if (!RPC[fn]) return { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.' + fn + ' in the schema cache' } };
      // REVOKE ... FROM public, anon, authenticated; GRANT EXECUTE TO service_role.
      if (SERVICE_ONLY.has(fn) && who.role !== 'service_role') {
        return { status: who.role === 'anon' ? 401 : 403, body: { code: '42501', message: 'permission denied for function ' + fn } };
      }
      try { return { status: 200, body: RPC[fn](body || {}) }; }
      catch (e) { return { status: 400, body: { code: e.pg || 'P0001', message: e.message } }; }
    }
    m = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(path);
    if (!m) throw new Error('supabase-auth-fake: no PostgREST path ' + method + ' ' + path);
    const table = m[1];
    const flt = eqFilters(q);
    // The two PIN tables: RLS on, no policy, no grants to anon/authenticated.
    if (table === 'mobile_pin_accounts' || table === 'mobile_pin_rate_limits') {
      if (who.role !== 'service_role') return { status: who.role === 'anon' ? 401 : 403, body: { code: '42501', message: 'permission denied for table ' + table } };
      const rows = table === 'mobile_pin_accounts' ? [...ACC.values()] : [...f.tables.mobile_pin_rate_limits.values()];
      return { status: 200, body: rows.filter((r) => match(r, flt)) };
    }
    if (table === 'brand_workspaces') {
      // RLS: a member reads; the owner inserts (owner_id = auth.uid()) and updates.
      if (who.role !== 'authenticated') return { status: 200, body: [] };
      const mine = f.tables.brand_workspaces.filter((w) => w.owner_id === who.uid);
      if (method === 'GET') {
        let rows = mine.filter((r) => match(r, flt));
        if (q.get('limit')) rows = rows.slice(0, Number(q.get('limit')));
        return { status: 200, body: rows };
      }
      if (method === 'POST') {
        const at = new Date().toISOString();
        const given = Array.isArray(body) ? body : [body];
        if (given.some((r) => r.owner_id !== who.uid)) return { status: 403, body: { code: '42501', message: 'new row violates row-level security policy for table "brand_workspaces"' } };
        const rows = given.map((r) => Object.assign({ id: uuid(), created_at: at, updated_at: at }, r));
        f.tables.brand_workspaces.push(...rows);
        return { status: 201, body: rows };
      }
      if (method === 'PATCH') {
        const rows = mine.filter((r) => match(r, flt));
        for (const r of rows) Object.assign(r, body, { updated_at: new Date().toISOString() });
        return { status: 200, body: rows };
      }
    }
    if (table === 'brand_user_prefs') {
      if (who.role !== 'authenticated') return { status: 200, body: [] };
      if (method === 'GET') { const r = f.tables.brand_user_prefs.get(who.uid); return { status: 200, body: r && match(r, flt) ? [r] : [] }; }
      if (method === 'POST') {
        for (const r of (Array.isArray(body) ? body : [body])) {
          if (r.user_id !== who.uid) return { status: 403, body: { code: '42501', message: 'new row violates row-level security policy for table "brand_user_prefs"' } };
          f.tables.brand_user_prefs.set(r.user_id, Object.assign({}, f.tables.brand_user_prefs.get(r.user_id) || {}, r));
        }
        return { status: 201, body: null };
      }
    }
    if (table === 'brand_catalog_products') return { status: 200, body: [] };
    if (/^credit_/.test(table)) {
      if (who.role !== 'service_role') return { status: 200, body: [] };
      if (method === 'GET') {
        const rows = (f.tables[table] || []).filter((r) => match(r, flt));
        return { status: 200, body: q.get('limit') ? rows.slice(0, Number(q.get('limit'))) : rows };
      }
      if (method === 'POST' && table === 'credit_orders') {
        const rows = (Array.isArray(body) ? body : [body]).map((r) => Object.assign({ id: uuid() }, r));
        f.tables.credit_orders.push(...rows);
        return { status: 201, body: rows };
      }
    }
    // A table the code reads that this fake does not model: PostgREST's own
    // answer for a relation that is not in the schema cache.
    return { status: 404, body: { code: 'PGRST205', message: 'Could not find the table public.' + table + ' in the schema cache' } };
  }

  /** One request: { status, body }. Throws for anything not modelled. */
  f.handle = function handle(method, rawUrl, headers, bodyText) {
    const u = new URL(rawUrl);
    const h = lowerKeys(headers);
    let body = {};
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch (_) { body = {}; }
    const call = { method, url: rawUrl, path: u.pathname, query: u.search, headers: h, body: bodyText || '' };
    f.calls.push(call);
    if (u.pathname.startsWith('/auth/v1/')) return gotrue(method, u.pathname, u.searchParams, h, body);
    if (u.pathname.startsWith('/rest/v1/')) return postgrest(method, u.pathname, u.searchParams, h, body);
    throw new Error('supabase-auth-fake: no endpoint ' + method + ' ' + rawUrl);
  };

  /** A drop-in `fetch` for the project's host; anything else is `others(url, init)` or a throw. */
  f.fetch = function makeFetch(others) {
    return async (input, init) => {
      const url = String(input && input.url ? input.url : input);
      const i = init || {};
      if (!url.startsWith(f.url + '/')) {
        if (others) return others(url, i);
        throw new Error('network call outside the fake Supabase project: ' + url);
      }
      // Yield first, so requests in flight interleave at every await.
      await new Promise((r) => setImmediate(r));
      if (f.down) throw new TypeError('fetch failed (getaddrinfo ENOTFOUND ' + new URL(f.url).hostname + ')');
      const r = f.handle(String(i.method || 'GET').toUpperCase(), url, i.headers, typeof i.body === 'string' ? i.body : (i.body ? String(i.body) : ''));
      return response(r.status, r.body);
    };
  };

  /* ── what the tests ask ────────────────────────────────────────────────── */
  f.gotrueCalls = () => f.calls.filter((c) => c.path.startsWith('/auth/v1/') && c.path !== '/auth/v1/health');
  f.grants = () => f.calls.filter((c) => c.path === '/auth/v1/token' && /grant_type=password/.test(c.query));
  f.userByPhone = (e164) => [...f.users.values()].find((u) => u.phone === storedPhone(e164)) || null;
  /** Everything this fake was ever sent or holds, as one string (for "the PIN never left"). */
  f.everything = () => JSON.stringify({ calls: f.calls, users: [...f.users.values()], accounts: [...ACC.values()] });
  return f;
}

module.exports = { createFake, response, lowerKeys };
