'use strict';
/**
 * router-harness.js — drive a shipped api/*.js router the way @vercel/node does.
 * ---------------------------------------------------------------------------
 * Shared by tests/router-{brain,calendar,competitor,kb}.spec.js. Not a spec
 * (no `.spec.js` suffix), so Playwright does not collect it and the
 * executed-tests ratchet does not scan it.
 *
 * WHAT IT GIVES A SPEC
 *
 *   serve(rel)     a real http.Server whose handler applies the Vercel request
 *                  shape (req.query, a LAZY req.body parsed from the drained
 *                  bytes with the stream restored — mirrored from @vercel/node
 *                  13.0.1 helpers.ts, the same replica meta-webhook-raw-body
 *                  uses) and the response helpers (status/json/send), then
 *                  calls `require(rel)` AT REQUEST TIME so a router that was
 *                  reloaded with a stubbed dependency is the one that answers.
 *                  `x-mode: bare` leaves the stream untouched (vercel dev);
 *                  `x-mode: drained` reads it and does not restore it. Every
 *                  request counts how many times the handler read req.body.
 *
 *   request()      one HTTP request over a socket, JSON or raw bytes.
 *
 *   netGuard()     replaces global.fetch with one that THROWS on any URL it
 *                  was not told about, records every attempt, and answers the
 *                  fake Supabase project (auth, workspace scoping, the credit
 *                  meter) so the routers' own gates can run for real. A
 *                  refusal that had already reached a provider or a store
 *                  would show up as an escaped call, not a silent success.
 *
 *   Stubs          require.cache interception. `on(rel, fn, impl)` replaces
 *                  ONE exported function on the cached module object with a
 *                  recording stub — which intercepts only when the router
 *                  reaches the function THROUGH the module object at call
 *                  time. A module that exports the function itself (llm.js,
 *                  calendar-generate.js, calendar-trigger.js) or a router that
 *                  destructures at load (calendar.js and lib/smart-brain/
 *                  services.js) needs `swap()` + `reload()`: replace the cache
 *                  entry's exports, then re-require the router so its load-time
 *                  bindings point at the stub. `on()` refuses to stub a name
 *                  that is not an exported function, because a stub on a key
 *                  that does not exist intercepts nothing and proves nothing
 *                  (the 2026-09-15 finding).
 *
 *   tokens         SESSION is a JWT-shaped token the fake auth endpoint accepts;
 *                  FORGED is JWT-shaped too (so the scoping code decodes a
 *                  `sub` from it, as it would from any stolen-looking token)
 *                  and is refused by /auth/v1/user; CRON is the scheduler
 *                  secret. WS is the signed-in user's active workspace.
 * ---------------------------------------------------------------------------
 */

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { PassThrough } = require('stream');

const ROOT = path.resolve(__dirname, '..');

/* ── identities ─────────────────────────────────────────────────────────── */

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function jwtShaped(sub) {
  return `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ sub, role: 'authenticated', exp: 4102444800 }))}.${crypto.randomBytes(8).toString('hex')}`;
}

const USER_ID = 'user_harness_0001';
const SESSION = jwtShaped(USER_ID);
const FORGED = jwtShaped('attacker_0001');
const CRON = 'cron_secret_' + crypto.randomBytes(12).toString('hex');
const WS = 'ws_harness_active';
const WS_OLDEST = 'ws_harness_oldest';
const SUPABASE_URL = 'https://harness.supabase.test';
const SELF_BASE_URL = 'https://self.harness.test';
const ORIGIN = 'https://app.harness.test';

/** The active workspace's brand record, as brand_workspaces would return it. */
const BRAND_ROW = {
  id: WS, name: 'Harness Brand', slug: 'harness-brand', owner_id: USER_ID, status: 'active',
  industry: 'test fixtures', tagline: 'a brand that exists only inside a test',
  palette: { primary: '#1d4ed8', accent: '#f59e0b', surface: '#ffffff', ink: '#111827' },
  typography: { heading: 'Arial', body: 'Arial' },
  voice: { tone: 'plain', banned: [] },
  regions: [{ code: 'UK', name: 'United Kingdom', currency: 'GBP', store_url: 'https://harness.example', home: true },
    { code: 'US', name: 'United States', currency: 'USD', store_url: 'https://harness.example/us' }],
  claims: [], offerings: [], competitors: [],
};

/* ── environment ────────────────────────────────────────────────────────── */

/** Set (or delete, for undefined/null) env vars; returns the restore function. */
function pinEnv(values) {
  const saved = {};
  for (const [k, v] of Object.entries(values)) {
    saved[k] = process.env[k];
    if (v === undefined || v === null) delete process.env[k]; else process.env[k] = String(v);
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
}

/** The environment every router spec runs under: a fake project, no provider keys. */
function routerEnv(extra) {
  return pinEnv(Object.assign({
    SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL: undefined,
    SUPABASE_ANON_KEY: 'anon-harness-key', NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
    SUPABASE_SERVICE_ROLE_KEY: 'service-harness-key', SUPABASE_SERVICE_KEY: undefined,
    SMART_BRAIN_SUPABASE_URL: undefined, SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY: undefined, SMART_BRAIN_SUPABASE_KEY: undefined,
    SMART_BRAIN_WORKSPACE_ID: undefined, WORKSPACE_ID: undefined,
    CRON_SECRET: CRON, VERCEL_ENV: 'production', VERCEL_URL: undefined, SELF_BASE_URL,
    INGEST_TOKEN: undefined, AGENT_BUILDER_API_KEY: undefined, ELEVENLABS_API_KEY: undefined, ELEVENLABS_VOICE_ID: undefined,
    META_APP_SECRET: undefined, META_WEBHOOK_VERIFY_TOKEN: undefined,
    GOOGLE_SHEET_ID: undefined, GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: undefined,
    GCP_WORKLOAD_IDENTITY_PROVIDER: undefined, GCP_SERVICE_ACCOUNT_EMAIL: undefined, VERCEL_OIDC_TOKEN: undefined,
    KLAVIYO_API_KEY: undefined, CONNECTION_SECRET_KEY: undefined,
    OPENAI_API_KEY: undefined, OPENAI_API_KEY_2: undefined, OPENAI_API_KEY_3: undefined, ANTHROPIC_API_KEY: undefined,
    GEMINI_API_KEY: undefined, XAI_API_KEY: undefined, GROQ_API_KEY: undefined, CEREBRAS_API_KEY: undefined,
    OPENROUTER_API_KEY: undefined, OpenRouter_API_KEY: undefined, GITHUB_MODELS_TOKEN: undefined, GITHUB_TOKEN: undefined,
    OLLAMA_BASE_URL: undefined, SAKANA_BASE_URL: undefined, APP_AI_PROVIDER: undefined,
  }, extra || {}));
}

/* ── the network guard ──────────────────────────────────────────────────── */

function lowerKeys(h) {
  const out = {};
  if (!h) return out;
  if (typeof h.forEach === 'function' && !Array.isArray(h)) { h.forEach((v, k) => { out[String(k).toLowerCase()] = v; }); return out; }
  for (const [k, v] of Object.entries(h)) out[String(k).toLowerCase()] = v;
  return out;
}

/** A fetch Response look-alike. */
function reply(status, body, headers) {
  const isBuf = Buffer.isBuffer(body);
  const text = isBuf ? body.toString('latin1') : (typeof body === 'string' ? body : JSON.stringify(body));
  const bytes = isBuf ? body : Buffer.from(text, 'utf8');
  const h = lowerKeys(headers);
  return {
    ok: status >= 200 && status < 300, status, url: '',
    headers: { get: (k) => (Object.prototype.hasOwnProperty.call(h, String(k).toLowerCase()) ? h[String(k).toLowerCase()] : null) },
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const bearerOf = (headers) => { const m = /^Bearer\s+(.+)$/i.exec(String((headers && headers.authorization) || '').trim()); return m ? m[1].trim() : ''; };

/**
 * Replace global.fetch. Routes are tried in order; the first whose `test`
 * matches answers. Anything else throws and is recorded as `escaped`.
 */
function netGuard(opts) {
  const o = opts || {};
  const real = global.fetch;
  const calls = [];
  const routes = [];
  const g = {
    calls, routes,
    route(test, handle) { routes.push({ test, handle }); return g; },
    /** URLs the guard refused because nothing claimed them. */
    get escaped() { return calls.filter((c) => c.escaped).map((c) => `${c.method} ${c.url}`); },
    /** Fake-Supabase REST calls, optionally filtered by a regex on the URL. */
    rest(re) { return calls.filter((c) => c.url.startsWith(SUPABASE_URL + '/rest/v1/') && (!re || re.test(c.url))); },
    /**
     * REST calls that are NOT the router's own workspace-scoping lookups, nor
     * the credit meter's read of the price list (credit_prices: the catalog's
     * overrides, read before the meter asks who the caller is - a price, not
     * anybody's data).
     */
    restBeyondScoping() {
      return g.rest().filter((c) => !/\/rest\/v1\/(brand_user_prefs|brand_workspaces|credit_prices)\b/.test(c.url));
    },
    /** Every call that would have MOVED a credit balance. */
    get balanceMoves() { return calls.filter((c) => /\/rest\/v1\/rpc\/credit_(grant|hold|spend|release|settle|fulfil)/.test(c.url)); },
    get authChecks() { return calls.filter((c) => /\/auth\/v1\/user/.test(c.url)); },
    restore() { global.fetch = real; },
  };
  global.fetch = async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    const i = init || {};
    const call = { url: u, method: String(i.method || 'GET').toUpperCase(), headers: lowerKeys(i.headers), body: i.body, escaped: false };
    calls.push(call);
    for (const r of routes) {
      const hit = typeof r.test === 'function' ? r.test(u, call) : r.test.test(u);
      if (hit) return r.handle(u, i, call);
    }
    call.escaped = true;
    throw new Error(`network call escaped the router harness: ${call.method} ${u}`);
  };
  if (o.supabase !== false) fakeSupabase(g, o);
  return g;
}

/**
 * The fake project. Only what the routers' OWN gates and scoping need:
 *   /auth/v1/user           200 for SESSION, 401 for anything else
 *   brand_user_prefs        the signed-in user's active workspace
 *   brand_workspaces        the oldest workspace (userless calls) and the
 *                           active brand's own row
 *   credit_*                the meter (calendar.js is metered): a funded
 *                           wallet, a hold that succeeds, settle, release
 * Any other table is NOT answered and escapes — a spec that needs one adds a
 * route for it explicitly, so a read the spec did not expect is visible.
 */
function fakeSupabase(g, o) {
  const base = SUPABASE_URL;
  g.route((u) => u.startsWith(base + '/auth/v1/user'), (u, init) => {
    const t = bearerOf(lowerKeys(init.headers));
    if (t === SESSION) return reply(200, { id: USER_ID, email: 'operator@harness.test', aud: 'authenticated' });
    return reply(401, { msg: 'invalid token', code: 401 });
  });
  g.route((u) => u.startsWith(base + '/rest/v1/brand_user_prefs'), (u) => {
    const m = /user_id=eq\.([^&]+)/.exec(u);
    const who = m ? decodeURIComponent(m[1]) : '';
    return reply(200, who === USER_ID ? [{ active_workspace_id: (o && o.activeWorkspace !== undefined) ? o.activeWorkspace : WS }] : []);
  });
  g.route((u) => u.startsWith(base + '/rest/v1/brand_workspaces'), (u) => {
    if (/order=created_at\.asc/.test(u)) return reply(200, [{ id: WS_OLDEST }]);
    const m = /id=eq\.([^&]+)/.exec(u);
    const id = m ? decodeURIComponent(m[1]) : '';
    return reply(200, id === WS ? [BRAND_ROW] : []);
  });
  g.route((u) => u.startsWith(base + '/rest/v1/credit_prices'), () => reply(200, []));
  g.route((u) => u.startsWith(base + '/rest/v1/credit_wallets'), () => reply(200, [{ id: 'wallet_harness', user_id: USER_ID, workspace_id: WS, balance: 500, held: 0 }]));
  g.route((u) => u.startsWith(base + '/rest/v1/credit_ledger'), () => reply(200, [{ id: 'ledger_welcome' }]));
  const args = (init) => { try { return JSON.parse(String(init.body || '{}')); } catch (_) { return {}; } };
  g.route((u) => u.startsWith(base + '/rest/v1/rpc/credit_hold'), (u, init) => reply(200, { ok: true, hold_id: 'hold_harness', balance: 500 - (Number(args(init).p_amount) || 0) }));
  // Echo what the meter asked to charge, so a receipt assertion is about the CATALOG price, not this fake.
  g.route((u) => u.startsWith(base + '/rest/v1/rpc/credit_settle'), (u, init) => reply(200, { ok: true, charged: Number(args(init).p_actual) || 0, refunded: 0, balance: 500 - (Number(args(init).p_actual) || 0) }));
  g.route((u) => u.startsWith(base + '/rest/v1/rpc/credit_release'), () => reply(200, { ok: true, released: 0, balance: 500 }));
}

/* ── require.cache stubs ────────────────────────────────────────────────── */

class Stubs {
  constructor() { this.reached = []; this._undo = []; }
  abs(rel) { return path.isAbsolute(rel) ? rel : path.join(ROOT, rel); }
  mod(rel) {
    const abs = this.abs(rel);
    require(abs);
    const m = require.cache[abs];
    if (!m) throw new Error(`${rel} is not in require.cache after require()`);
    return m;
  }
  /** Replace one exported FUNCTION with a recording stub. */
  on(rel, fn, impl) {
    const m = this.mod(rel);
    const orig = m.exports[fn];
    if (typeof orig !== 'function') {
      throw new Error(`${rel} does not export a function named ${fn}; a stub there would intercept nothing`);
    }
    const self = this;
    m.exports[fn] = function routerHarnessStub(...args) {
      self.reached.push({ module: rel, fn, args });
      return typeof impl === 'function' ? impl.apply(this, args) : impl;
    };
    this._undo.push(() => { m.exports[fn] = orig; });
    return this;
  }
  /** Set any exported value (a class, a constant) without a recording wrapper. */
  set(rel, name, value) {
    const m = this.mod(rel);
    const had = Object.prototype.hasOwnProperty.call(m.exports, name);
    const orig = m.exports[name];
    m.exports[name] = value;
    this._undo.push(() => { if (had) m.exports[name] = orig; else delete m.exports[name]; });
    return this;
  }
  /** Replace a cache entry's whole exports (for modules that export a function). */
  swap(rel, exportsValue) {
    const m = this.mod(rel);
    const orig = m.exports;
    m.exports = exportsValue;
    this._undo.push(() => { m.exports = orig; });
    return this;
  }
  /**
   * Re-execute a module so its load-time `require()` bindings pick up whatever
   * is in the cache now. On restore the entry is dropped (not re-required), so
   * the next spec that needs it loads it fresh against the real modules.
   */
  reload(rel) {
    const abs = this.abs(rel);
    delete require.cache[abs];
    require(abs);
    this._undo.push(() => { delete require.cache[abs]; });
    return this;
  }
  hits(rel, fn) { return this.reached.filter((r) => r.module === rel && (!fn || r.fn === fn)); }
  hit(rel, fn) { const h = this.hits(rel, fn); return h.length ? h[h.length - 1] : null; }
  restore() { while (this._undo.length) this._undo.pop()(); this.reached.length = 0; }
}

/* ── what Vercel does to a request before a handler runs ───────────────── */

async function drain(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
function restoreBody(req, bytes) {
  const replicateBody = new PassThrough();
  const on = replicateBody.on.bind(replicateBody);
  const originalOn = req.on.bind(req);
  req.read = replicateBody.read.bind(replicateBody);
  req.on = req.addListener = (name, cb) => (name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb));
  replicateBody.write(bytes);
  replicateBody.end();
}
function vercelBodyParser(bytes, contentType) {
  return () => {
    const type = String(contentType || '').split(';')[0].trim();
    if (!type) return undefined;
    if (type === 'application/json') {
      try { const s = bytes.toString(); return s ? JSON.parse(s) : {}; }
      catch (_) { const e = new Error('Invalid JSON'); e.statusCode = 400; throw e; }
    }
    if (type === 'text/plain') return bytes.toString();
    return undefined;
  };
}

/**
 * A real http.Server around the shipped router at `rel`. `srv.stats[i]` is the
 * i-th request's { mode, bodyReads, url }.
 */
function serve(rel) {
  // ONE router at `rel`, or SEVERAL keyed by pathname: `{ '/api/brain':
  // 'api/brain.js', '/api/calendar': 'api/calendar.js', ... }` (2026-09-29,
  // for the agents specs, whose pages call four routers from one origin). A
  // pathname the map does not name is a 404 JSON, so a page that reaches for a
  // fifth router is visible in the log rather than answered by a default.
  const many = rel && typeof rel === 'object' ? rel : null;
  const absOf = (r) => (path.isAbsolute(r) ? r : path.join(ROOT, r));
  const abs = many ? null : absOf(rel);
  const stats = [];
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      const stat = { mode: req.headers['x-mode'] || 'vercel', bodyReads: 0, url: req.url };
      stats.push(stat);
      const parsed = new URL(req.url, 'http://x');
      const q = {};
      parsed.searchParams.forEach((v, k) => { q[k] = v; });
      req.query = q;
      let target = abs;
      if (many) {
        const hit = many[parsed.pathname];
        if (!hit) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ harness_error: `no router mounted at ${parsed.pathname}` })); return; }
        target = absOf(typeof hit === 'string' ? hit : hit.rel);
        // A mount may pin a query value the deployment's rewrite adds (for
        // example /api/ai/landing-page -> /api/ai/generate?action=landing-page).
        if (hit && typeof hit === 'object' && hit.query) Object.assign(req.query, hit.query);
      }
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (j) => { if (!res.headersSent) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j)); return res; };
      res.send = (x) => { res.end(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)); return res; };
      const counted = (parse) => Object.defineProperty(req, 'body', {
        configurable: true, enumerable: true,
        // MEMOISED on first read, as @vercel/node's setLazyProp does (it
        // redefines the property with the value it computed). Re-parsing on
        // every read made a handler's own write to the parsed body vanish:
        // api/ai/generate.js stamps req.body.__brand and then reads req.body
        // again, so under this harness every generate.js prompt was built for
        // tenant zero whatever the request carried (2026-10-10).
        get() {
          stat.bodyReads += 1;
          const v = parse();
          Object.defineProperty(req, 'body', { configurable: true, enumerable: true, writable: true, value: v });
          return v;
        },
        // @vercel/node lets a handler overwrite req.body; so does this.
        set(v) { Object.defineProperty(req, 'body', { configurable: true, enumerable: true, writable: true, value: v }); },
      });
      try {
        if (stat.mode === 'bare') {
          counted(() => undefined);
        } else {
          const bytes = await drain(req);
          counted(vercelBodyParser(bytes, req.headers['content-type']));
          if (stat.mode === 'vercel') restoreBody(req, bytes);
        }
        await require(target)(req, res);
        if (!res.writableEnded) { res.statusCode = 599; res.end(JSON.stringify({ harness_error: 'the router returned without answering' })); }
      } catch (e) {
        if (!res.writableEnded) {
          res.statusCode = (e && e.statusCode) || 500;
          res.end(JSON.stringify({ harness_error: String((e && e.message) || e) }));
        }
      }
    });
    srv.stats = stats;
    srv.listen(0, '127.0.0.1', () => {
      srv.port = srv.address().port;
      srv.close = ((close) => () => new Promise((r) => close.call(srv, r)))(srv.close);
      resolve(srv);
    });
  });
}

/**
 * One request. `json` sends a JSON body; `raw` sends bytes as given. `auth`
 * is 'session' | 'forged' | 'cron' | 'none'; `origin: true` makes it look
 * like a browser (Origin + Referer).
 */
function request(port, o) {
  const opts = o || {};
  const raw = opts.raw != null ? opts.raw : (opts.json !== undefined ? JSON.stringify(opts.json) : null);
  const h = {};
  if (raw != null) { h['content-type'] = opts.contentType || 'application/json'; h['content-length'] = Buffer.byteLength(raw); }
  const auth = opts.auth || 'none';
  if (auth === 'session') h.authorization = `Bearer ${SESSION}`;
  else if (auth === 'forged') h.authorization = `Bearer ${FORGED}`;
  else if (auth === 'cron') h.authorization = `Bearer ${CRON}`;
  if (opts.origin) { h.origin = ORIGIN; h.referer = ORIGIN + '/page'; }
  Object.assign(h, opts.headers || {});
  const method = opts.method || (raw != null ? 'POST' : 'GET');
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: opts.path, method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let out = null;
        try { out = text ? JSON.parse(text) : null; } catch (_) { out = null; }
        resolve({ status: res.statusCode, headers: res.headers, text, out, bytes: buf });
      });
    });
    req.on('error', reject);
    if (raw != null) req.end(raw); else req.end();
  });
}

/** Build ?a=b&c=d from an object, skipping undefined. */
function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
}

/* ── a fake brain-core LinkedDb ─────────────────────────────────────────── */

/**
 * What `core.db()` hands the brain router. Every call is recorded on the
 * Stubs instance under module 'db' with args [table, opts]; rows come from
 * `db.rows[table]` (default []).
 */
function fakeDb(S) {
  const db = { rows: Object.create(null), connected: true };
  const rec = (fn, args, ret) => { S.reached.push({ module: 'db', fn, args }); return ret; };
  db.select = async (table, opts) => rec('select', [table, opts], (db.rows[table] || []).slice());
  db.insert = async (table, rows) => rec('insert', [table, rows], (Array.isArray(rows) ? rows : [rows]).map((r, i) => Object.assign({ id: `${table}_${i + 1}` }, r)));
  db.upsert = async (table, rows, onConflict) => rec('upsert', [table, rows, onConflict], Array.isArray(rows) ? rows : [rows]);
  db.update = async (table, filters, patch) => rec('update', [table, filters, patch], [patch]);
  db.remove = async (table, filters) => rec('remove', [table, filters], true);
  return db;
}

/* ── action enumeration ─────────────────────────────────────────────────── */

const fs = require('fs');
/**
 * The router's source, comments stripped, for enumerating its dispatch table.
 * Full-line `//` comments go FIRST: brain.js has `api/*.js` inside one, and
 * stripping block comments first read that `/*` as an opener and swallowed
 * ~500 lines (47 case labels) up to the next `*\/`.
 */
function routerCode(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}
const uniqSorted = (arr) => [...new Set(arr)].sort();

module.exports = {
  ROOT, USER_ID, SESSION, FORGED, CRON, WS, WS_OLDEST, SUPABASE_URL, SELF_BASE_URL, ORIGIN, BRAND_ROW,
  pinEnv, routerEnv, netGuard, reply, Stubs, serve, request, qs, fakeDb, routerCode, uniqSorted, jwtShaped,
};
