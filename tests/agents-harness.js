'use strict';
/**
 * agents-harness.js — the world the agent specs run in. Not a spec (no
 * `.spec.js` suffix), so Playwright does not collect it and the executed-tests
 * ratchet does not scan it.
 * ---------------------------------------------------------------------------
 * Shared by tests/agents-executed.spec.js (the routers over a socket) and
 * tests/agents-pages.spec.js (the real pages in Chromium, with their /api/
 * calls forwarded to those same routers). Everything here is about running
 * the SHIPPED code in the three states a caller can be in:
 *
 *   anonymous       no token at all;
 *   phone           a SERVER-mode mobile+PIN session - the ONE sign-in the
 *                   app has - whose token requireUser() verifies against
 *                   app_sessions in the Neon database. The database is an
 *                   in-memory `sql` tagged template handed to the real core
 *                   through the neon driver's require.cache entry, so
 *                   mobile-auth-core's own connect() path runs unmodified;
 *   device          a mobile+PIN session kept only in the browser: its token
 *                   is never sent, so on the wire it IS the anonymous state,
 *                   and the specs assert exactly that.
 *
 * The workspace database is tests/lib/fake-supabase.js with the credit ledger
 * RPCs re-implemented from the SQL, so a listed phone number's wallet moves
 * the way Postgres would move it. Every model call goes to a scripted llm.js
 * swapped into require.cache BEFORE any module binds it (brain-agent,
 * brand-llm, social-core and the rest bind `callLLM` at load, so a swap after
 * they are cached reaches nothing - the 2026-09-28 router finding). Anything
 * else on the network THROWS, so a refusal that had already spent a provider
 * call shows up as an escaped call rather than a quiet 401.
 * ---------------------------------------------------------------------------
 */

const http = require('http');
const path = require('path');
const H = require('./router-harness');
const { FakeSupabase, installCreditsRpc, response, BASE, SERVICE_KEY, ANON_KEY } = require('./lib/fake-supabase.js');

const ROOT = H.ROOT;
const LLM = path.join(ROOT, 'api/_shared/llm.js');
const ROUTERS = {
  '/api/brain': 'api/brain.js',
  '/api/calendar': 'api/calendar.js',
  '/api/public-config': 'api/public-config.js',
  '/api/ai/generate': 'api/ai/generate.js',
  // vercel.json rewrites /api/ai/landing-page onto generate.js?action=landing-page.
  '/api/ai/landing-page': { rel: 'api/ai/generate.js', query: { action: 'landing-page' } },
};

const PHONE = { phone: '9876543210', cc: '+91', e164: '+919876543210', name: 'Asha', pin: '7391' };
const OTHER_PHONE = { phone: '9123456780', cc: '+91', e164: '+919123456780', name: 'Bala', pin: '8052' };
const DATABASE_URL = 'postgres://u:p@ep-agents-fixture.neon.tech/db';
const ORIGIN = 'https://app.agents.test';

const PRESET = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'times-of-india.json'), 'utf8'));
/** The origin of the carried brand's own website, the one host a generation may legitimately read. */
const BRAND_SITE = (() => { try { return new URL(PRESET.website).origin; } catch (_) { return 'https://brand-site.invalid'; } })();

/** The brand a device account carries with its requests: a preset, and not tenant zero. */
function deviceBrand() {
  const preset = PRESET;
  return {
    id: 'local-toi000000000001', slug: preset.slug, name: preset.name, tagline: preset.tagline, industry: preset.industry,
    website: preset.website, palette: preset.palette, typography: preset.typography, voice: preset.voice, regions: preset.regions,
    claims: (preset.brand_data && preset.brand_data.claims) || preset.claims || [], offerings: (preset.brand_data && preset.brand_data.offerings) || preset.offerings || [],
    competitors: preset.competitors || [], catalog_source: preset.catalog_source || {},
    asset_hosts: preset.asset_hosts, brand_data: preset.brand_data || {},
    status: 'active', onboarding_step: 6, owner_id: null, storage: 'device',
    created_at: '2026-09-20T00:00:00.000Z', updated_at: '2026-09-20T00:00:00.000Z',
  };
}

/* ── the Neon database, in memory ───────────────────────────────────────── */

/**
 * The statements mobile-auth-core emits for status / enter / verifyToken /
 * signout, answered over three arrays. Anything else throws, so a statement
 * the core adds later cannot pass by accident. Statements run one at a time.
 */
function fakeSql() {
  const db = { app_users: [], app_sessions: [], app_rate_limits: [], down: false, log: [] };
  let seq = 0;
  const uuid = () => 'aaaaaaaa-0000-4000-8000-' + String(++seq).padStart(12, '0');
  const copy = (r) => Object.assign({}, r);
  let chain = Promise.resolve();
  const store = (strings, ...vals) => {
    const run = chain.then(() => exec(strings, vals));
    chain = run.catch(() => {});
    return run;
  };
  const exec = async (strings, vals) => {
    const text = strings.join(' $ ').replace(/\s+/g, ' ').trim().toLowerCase();
    db.log.push(text);
    if (db.down) throw new Error('connect ECONNREFUSED ep-agents-fixture.neon.tech');
    if (/^create (table|index)/.test(text)) return [];
    if (text === 'select 1') return [{ '?column?': 1 }];
    if (text.startsWith('insert into app_rate_limits')) {
      const [bucket, key] = vals;
      let row = db.app_rate_limits.find((r) => r.bucket === bucket && r.k === key);
      if (!row) { row = { bucket, k: key, window_start: Date.now(), n: 1 }; db.app_rate_limits.push(row); } else row.n += 1;
      return [{ n: row.n }];
    }
    if (/^select id, name, phone, pin_hash, pin_salt, pin_tries, locked_until from app_users where phone = \$/.test(text)) {
      return db.app_users.filter((u) => u.phone === vals[0]).map(copy);
    }
    if (text.startsWith('insert into app_users')) {
      const [phone, cc, local, name, hash, salt] = vals;
      if (db.app_users.some((u) => u.phone === phone)) { const dup = new Error('duplicate key value violates unique constraint "app_users_phone_key"'); dup.code = '23505'; throw dup; }
      const row = { id: uuid(), phone, phone_cc: cc, phone_local: local, name, pin_hash: hash, pin_salt: salt, pin_set_at: new Date().toISOString(), pin_tries: 0, locked_until: null };
      db.app_users.push(row);
      return [copy(row)];
    }
    if (text.startsWith('update app_users set pin_tries = 0, locked_until = null')) {
      const u = db.app_users.find((x) => x.id === vals[0]);
      if (u) { u.pin_tries = 0; u.locked_until = null; }
      return [];
    }
    if (text.startsWith('insert into app_sessions')) {
      const [token_hash, user_id, device, expires_at] = vals;
      db.app_sessions.push({ token_hash, user_id, device, expires_at, last_used_at: new Date().toISOString() });
      return [];
    }
    if (text.startsWith('delete from app_sessions where expires_at < now()')) { db.app_sessions = db.app_sessions.filter((s) => new Date(s.expires_at) > new Date()); return []; }
    if (text.startsWith('select s.user_id, s.expires_at, u.name, u.phone from app_sessions s')) {
      const h = vals[0];
      return db.app_sessions.filter((s) => s.token_hash === h && new Date(s.expires_at) > new Date())
        .map((s) => { const u = db.app_users.find((x) => x.id === s.user_id) || {}; return { user_id: s.user_id, expires_at: s.expires_at, name: u.name, phone: u.phone }; });
    }
    if (text.startsWith('update app_sessions set last_used_at')) return [];
    if (text.startsWith('delete from app_sessions where token_hash')) { db.app_sessions = db.app_sessions.filter((s) => s.token_hash !== vals[0]); return []; }
    if (text.startsWith('delete from app_sessions where user_id')) { db.app_sessions = db.app_sessions.filter((s) => s.user_id !== vals[0]); return []; }
    throw new Error('fake sql: unhandled statement: ' + text);
  };
  store.db = db;
  return store;
}

/* ── the module tree ────────────────────────────────────────────────────── */

/** Drop every cached module under api/ and lib/, so the next require binds against what is in the cache NOW. */
function dropTree() {
  const under = [path.join(ROOT, 'api') + path.sep, path.join(ROOT, 'lib') + path.sep];
  for (const k of Object.keys(require.cache)) if (under.some((u) => k.startsWith(u))) delete require.cache[k];
}

/**
 * The scripted model. Stage-aware so every consumer gets the shape it parses:
 * the KicksGPT loop wants a JSON action, a JSON-mode stage wants an object,
 * everything else prose. `calls` records every stage reached.
 */
function scriptedLlm() {
  const calls = [];
  const fn = async function callLLMStub(o) {
    const opts = o || {};
    calls.push({ stage: opts.stage || '', tier: opts.tier || '', json: !!(opts.responseFormat && opts.responseFormat.type === 'json_object') });
    const stage = String(opts.stage || '');
    let text;
    if (stage === 'kicksgpt') text = JSON.stringify({ action: 'final', reply: 'Scripted reply for this turn, with no figure invented.' });
    else if (opts.responseFormat && opts.responseFormat.type === 'json_object') text = JSON.stringify({ objective: 'scripted objective', score: 8, pass: true, ideas: [], insights: [], action_items: [], summary: 'scripted', cohorts: [], heroAngles: [] });
    else text = 'Scripted reply for this turn, with no figure invented.';
    return { ok: true, text, provider: 'scripted', model: 'scripted' };
  };
  return { fn, calls };
}

/* ── the world ──────────────────────────────────────────────────────────── */

/**
 * Pin the environment, install the fake databases, swap the model, load the
 * routers fresh and serve them. Returns everything a spec drives, and one
 * `close()` that undoes all of it - including dropping the loaded tree, so
 * the next spec in this worker loads against the real modules.
 */
async function world(opts) {
  const o = opts || {};
  const restoreEnv = H.pinEnv({
    SUPABASE_URL: BASE, NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_ANON_KEY: ANON_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_SERVICE_KEY: undefined,
    SMART_BRAIN_SUPABASE_URL: undefined, SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY: undefined, SMART_BRAIN_SUPABASE_KEY: undefined,
    SMART_BRAIN_WORKSPACE_ID: undefined, WORKSPACE_ID: undefined,
    // Server mode (a database behind the sign-in) unless the spec asks for the
    // deployment production is in today: no DATABASE_URL, every session on the device.
    DATABASE_URL: o.serverMode === false ? undefined : DATABASE_URL, NEON_DATABASE_URL: undefined, POSTGRES_URL: undefined,
    CRON_SECRET: H.CRON, VERCEL_ENV: 'production', VERCEL_URL: undefined, SELF_BASE_URL: H.SELF_BASE_URL,
    INGEST_TOKEN: undefined, AGENT_BUILDER_API_KEY: undefined, ELEVENLABS_API_KEY: undefined, ELEVENLABS_VOICE_ID: undefined,
    META_APP_SECRET: undefined, META_WEBHOOK_VERIFY_TOKEN: undefined,
    GOOGLE_SHEET_ID: undefined, GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: undefined,
    GCP_WORKLOAD_IDENTITY_PROVIDER: undefined, GCP_SERVICE_ACCOUNT_EMAIL: undefined, VERCEL_OIDC_TOKEN: undefined,
    KLAVIYO_API_KEY: undefined, CONNECTION_SECRET_KEY: undefined,
    // One provider key, so generate.js's "any key at all" check passes and the
    // scripted model is what answers; llm.js itself is never reached.
    OPENAI_API_KEY: 'sk-scripted-never-sent', OPENAI_API_KEY_2: undefined, OPENAI_API_KEY_3: undefined, ANTHROPIC_API_KEY: undefined,
    GEMINI_API_KEY: undefined, XAI_API_KEY: undefined, GROQ_API_KEY: undefined, CEREBRAS_API_KEY: undefined,
    OPENROUTER_API_KEY: undefined, OpenRouter_API_KEY: undefined, GITHUB_MODELS_TOKEN: undefined, GITHUB_TOKEN: undefined,
    OLLAMA_BASE_URL: undefined, SAKANA_BASE_URL: undefined, APP_AI_PROVIDER: undefined,
    CREDITS_COMP_PHONES: o.compPhones === undefined ? undefined : o.compPhones,
    CREDITS_COMP_ACCOUNTS: undefined, CREDITS_ALLOW_SELF_SERVE: undefined, CREDIT_WELCOME_GRANT: undefined, CREDIT_PACK_PRICES: undefined,
  });

  // The Neon database: the real driver module is replaced by one that hands
  // the core the in-memory store, so connect() and ensureSchema() run as
  // shipped over a fixture. Restored on close.
  const store = fakeSql();
  const NEON = require.resolve('@neondatabase/serverless');
  const realNeon = require.cache[NEON];
  const built = [];
  require.cache[NEON] = { id: NEON, filename: NEON, loaded: true, exports: { neon: (url) => { built.push(url); return store; } } };

  // The workspace database. The anon key is a caller too (brain-core's
  // LinkedDb pairs the URL with the anon key); it sees the smart_* tables the
  // way the real project's policies let it.
  const db = new FakeSupabase();
  db.addUser('tok-owner', 'user-owner', 'owner@example.test')
    .addUser(ANON_KEY, 'anon-role', '')
    .addWorkspace('ws-oldest', 'user-owner', { name: 'Oldest Brand', slug: 'oldest-brand', industry: 'test fixtures',
      palette: { primary: '#1d4ed8', accent: '#f59e0b', surface: '#ffffff', ink: '#111827' }, typography: { heading: 'Arial', body: 'Arial' },
      voice: { tone: 'plain', banned: [] }, regions: [{ code: 'UK', name: 'United Kingdom', currency: 'GBP', store_url: 'https://oldest.example', home: true }] })
    .setActive('user-owner', 'ws-oldest')
    .syncIdentityTables();
  installCreditsRpc(db);
  db.route((u) => u.startsWith(H.SELF_BASE_URL), () => ({ ok: true, chained: true }));
  // The carried brand's OWN website. A generation for a brand reads that
  // brand's testimonials off that brand's site (brand-reviews.js, riding the
  // site crawl) - legitimate egress to the brand's own origin, answered here
  // with a 404 so the crawl finds nothing and nothing is invented. Every
  // OTHER host still throws.
  db.route((u) => u.startsWith(BRAND_SITE), () => response(404, 'not found'));
  db.install();

  // The model, swapped in BEFORE the tree loads.
  dropTree();
  const realLlm = require(LLM);
  const llm = scriptedLlm();
  for (const k of Object.keys(realLlm)) llm.fn[k] = realLlm[k];
  require.cache[LLM].exports = llm.fn;
  for (const rel of Object.values(ROUTERS)) require(path.join(ROOT, typeof rel === 'string' ? rel : rel.rel));

  const srv = await H.serve(ROUTERS);

  // The phone accounts, created through the real state machine.
  const core = require(path.join(ROOT, 'api/_shared/mobile-auth-core.js'));
  core._reset && core._reset();
  const made = await core.enter(store, { phone: PHONE.phone, cc: PHONE.cc, name: PHONE.name, pin: PHONE.pin }, '203.0.113.9');
  if (!made.body || !made.body.token) throw new Error('the fixture phone account could not be created: ' + JSON.stringify(made.body));
  const other = await core.enter(store, { phone: OTHER_PHONE.phone, cc: OTHER_PHONE.cc, name: OTHER_PHONE.name, pin: OTHER_PHONE.pin }, '203.0.113.10');
  if (!other.body || !other.body.token) throw new Error('the second fixture phone account could not be created: ' + JSON.stringify(other.body));

  const tokens = { phone: made.body.token, other: other.body.token, phoneUserId: made.body.user.id, otherUserId: other.body.user.id };
  // The pages spec seeds a session the way auth.js stores one; this is the record for the listed account.
  const session = (mode) => ({
    token: tokens.phone, mode, provider: 'mobile-pin',
    user: { id: tokens.phoneUserId, name: PHONE.name, phone: PHONE.e164 }, expires: new Date(Date.now() + 80 * 86400000).toISOString(),
    storage: mode === 'server'
      ? { mode: 'server', host: 'ep-agents-fixture.neon.tech', message: 'Account saved in the database.' }
      : { mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' },
  });

  const w = {
    srv, port: srv.port, db, store, llm, tokens, built, session, ORIGIN, ROUTERS, PHONE, OTHER_PHONE, DATABASE_URL,
    /** Forget every per-request cache a spec can leave behind. */
    reset() {
      db.clearCalls(); llm.calls.length = 0;
      try { require(path.join(ROOT, 'api/_shared/workspace-scope.js')).invalidate(); } catch (_) {}
      try { require(path.join(ROOT, 'api/_shared/brand-runtime.js')).invalidate(); } catch (_) {}
    },
    /** Headers for one of the three states. */
    headersFor(state, extra) {
      const h = { origin: ORIGIN, referer: ORIGIN + '/page' };
      if (state === 'phone') { h['x-lifecycle-token'] = tokens.phone; h.authorization = 'Bearer ' + tokens.phone; }
      if (state === 'other') { h['x-lifecycle-token'] = tokens.other; h.authorization = 'Bearer ' + tokens.other; }
      if (state === 'server') { delete h.origin; delete h.referer; }
      return Object.assign(h, extra || {});
    },
    /** One request over the socket. */
    request(pathname, o) {
      const r = o || {};
      return H.request(srv.port, {
        method: r.method || (r.json !== undefined ? 'POST' : 'GET'),
        path: pathname + H.qs(r.query || {}), json: r.json, headers: w.headersFor(r.state || 'anonymous', r.headers),
      });
    },
    /** Every fetch that left for a host the fixtures do not claim (the guard threw on it); a routed host is answered, not escaped. */
    escaped() {
      const routed = (u) => db.routes.some((r) => { try { return !!r.test(u, {}); } catch (_) { return false; } });
      return db.external().filter((c) => !routed(c.url)).map((c) => `${c.method} ${c.url}`);
    },
    async close() {
      await srv.close();
      db.restore();
      if (realNeon) require.cache[NEON] = realNeon; else delete require.cache[NEON];
      dropTree();
      restoreEnv();
    },
  };
  return w;
}

/* ── forwarding a browser's /api/ request to the routers ───────────────── */

/**
 * A Playwright route handler body: take the page's request, replay it over
 * the socket to the served routers, and fulfil with what came back. The page
 * therefore talks to the SHIPPED handlers, not to a model of them.
 */
function forward(port) {
  return async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const headers = Object.assign({}, req.headers());
    delete headers.host; delete headers['content-length']; delete headers['accept-encoding'];
    const body = req.postDataBuffer();
    const out = await new Promise((resolve, reject) => {
      const r = http.request({ hostname: '127.0.0.1', port, path: u.pathname + u.search, method: req.method(), headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      r.on('error', reject);
      if (body) r.end(body); else r.end();
    });
    const ct = String(out.headers['content-type'] || 'application/json');
    return route.fulfill({ status: out.status, contentType: ct, body: out.body, headers: { 'access-control-allow-origin': '*' } });
  };
}

module.exports = { world, fakeSql, forward, deviceBrand, ROUTERS, PHONE, OTHER_PHONE, ORIGIN, DATABASE_URL, BRAND_SITE, ROOT, BASE, ANON_KEY, SERVICE_KEY };
