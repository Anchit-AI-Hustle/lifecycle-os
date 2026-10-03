/**
 * Signing in never turns "Read my site" off when signing out left it on.
 * ---------------------------------------------------------------------------
 * The operator's words: "not working after signin". Production (deployed
 * `2b2a992`, main identical at this spot), `/onboarding`: signed in with a
 * mobile number and a PIN in DEVICE mode (no DATABASE_URL; the rail said
 * "Saved on this device only: no database is configured"), the Supabase
 * project PAUSED. On step 1 they typed their site and "Read my site" was
 * DISABLED with "Not available on a mobile-number account ... the server
 * cannot check it". A signed-out visitor in the same backend state had the
 * control ON. SIGNING IN TURNED THE FIRST SCREEN'S HEADLINE CONTROL OFF.
 *
 * Two layers, both found by RUNNING it against the shipped server handler:
 *
 *   1. The wizard decided by ACCOUNT TYPE. `server_open` (brand-context.js)
 *      read `kind` - and for a phone session auth.js publishes kind
 *      'signed-in', with the Supabase state on `backend.supabase` - so every
 *      device session was "not open", whatever the server would do. But a
 *      device token is never sent (LifecycleAuth.apiToken()), so to the
 *      server the signed-in request IS the signed-out one: no token.
 *
 *   2. And the server refused that request too. `requireUser()` answers a
 *      request with no token `sign_in_required` BEFORE it looks at any
 *      backend, so `openWithoutBackend` (which needs `backend_unreachable`)
 *      could only open for a caller who PRESENTED a token nobody could check.
 *      Nobody presents one any more: Google sign-in is commented out, so no
 *      browser holds a Supabase JWT, and a device token is never sent. The
 *      2026-09-15 tests all sent `'a-stale-token'`; the no-token request -
 *      the only one a browser makes - was never driven. So on production the
 *      signed-out visitor's ON button answered 401 as well.
 *
 * WHAT IS ASSERTED, AND HOW. The real onboarding page in Chromium, served as a
 * real host (auth.js treats localhost as a preview). Every `/api/public-config`
 * config and brand request is answered by the SHIPPED entry point
 * (`api/public-config.js`, request-scope wrapper and all) running in this
 * Node process, with `global.fetch` answering a fixture site for the crawl, a
 * paused Supabase host that does not resolve, and THROWING on any other host.
 * `op=status` is production's own JSON, verbatim. `llm.js` is replaced in
 * `require.cache` (the module IS the function) and counted.
 *
 * SUPERSEDED IN PART BY #115 (2026-09-30) AND 2026-10-03. A device sign-in's
 * token IS sent now, and with no database the server admits it as a device
 * principal from a page - so the device session is read FOR the person (voice
 * included), not on the visitor's path, and it is ON whatever Supabase is
 * doing. The one device state that stays OFF is a sign-in kept on this device
 * on a deployment that now keeps accounts in a database: that token is not in
 * its session table. tests/phone-signin-features.spec.js drives the rest of
 * the wizard's server-run controls in the same state.
 *
 * Section 3 is the rule itself: over every state a browser can be in, the
 * wizard's decision must equal what the shipped handler answers to the
 * request that browser would send. A decision copied from somewhere other
 * than the server drifts, which is how this happened.
 *
 * `page.on('dialog')` is registered before anything else: any dialog fails.
 *
 * Run: npx playwright test tests/read-site-after-signin.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = require.resolve('../api/public-config.js');
const CORE = require.resolve('../api/_shared/brand-workspace-core.js');
const EXTRACT = require.resolve('../api/_shared/brand-extract.js');
const LLM = require.resolve('../api/_shared/llm.js');
const MOBILE = require.resolve('../api/_shared/mobile-auth-core.js');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const HOST = 'http://app.example.test';
const PAUSED = 'paused-project.supabase.co';
const LIVE = 'live-project.supabase.co';
const SITE = 'https://harbourlight.example';

/** Production's answer to `?action=auth&op=status`, verbatim (2026-09-29). */
const PROD_STATUS = { ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured. Set DATABASE_URL to keep accounts in a database.' };
/** A deployment that keeps accounts in its database (DATABASE_URL set and answering). */
const SERVER_STATUS = { ok: true, mode: 'server', host: 'ep-fixture.neon.tech', message: 'Account saved in the database.' };

const DEVICE_USER = { id: 'dev-readsite0001', phone: '+919876543210', cc: '+91', local: '9876543210', name: 'Asha' };
const SERVER_TOKEN = 'MPINtokenREADSITE0123456789abcdefghijklmnopqr';
const SERVER_USER = { id: 'aaaaaaaa-0000-4000-8000-000000000101', phone: '+919876543210', name: 'Ravi' };
const DEVICE_TOKEN = 'DEVICEtokenREADSITE0123456789abcdefghijklmn';

/* ── the brand's own site, as the server's crawler reads it ─────────────── */
const PAGES = {
  '/': {
    ct: 'text/html',
    body: `<!doctype html><html lang="en"><head><title>Harbourlight Goods</title>
      <meta property="og:site_name" content="Harbourlight Goods">
      <meta name="description" content="Lamps and lanterns made by hand on the harbour.">
      <link rel="stylesheet" href="/theme.css"></head>
      <body><h1>Harbourlight Goods</h1><a href="/about">About</a>
      <p>We have made lamps and lanterns by hand on the harbour since 2012, and we ship them wrapped in recycled paper.</p>
      </body></html>`,
  },
  '/theme.css': {
    ct: 'text/css',
    body: ':root{--brand-primary:#1a6b3c;--brand-accent:#b8531f;--brand-ink:#15201c;--brand-surface:#fbfaf6}'
      + 'h1{font-family:"Fraunces",Georgia,serif;font-size:44px;font-weight:600;color:#15201c}'
      + 'body{font-family:"Inter",system-ui;font-size:16px;color:#15201c;background:#fbfaf6}',
  },
  '/about': {
    ct: 'text/html',
    body: '<!doctype html><html><head><title>About</title></head><body><h1>About</h1>'
      + '<p>Harbourlight Goods Ltd, 4 Quay Street.</p></body></html>',
  },
  '/robots.txt': { ct: 'text/plain', body: 'User-agent: *\nAllow: /\n' },
};

function response(status, ct, body, url) {
  return {
    ok: status >= 200 && status < 300, status, url,
    headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? ct : null) },
    text: async () => body,
    json: async () => JSON.parse(body || '{}'),
  };
}

/* ── the server's world, per state ─────────────────────────────────────────
   supabase: 'unreachable' (production: the env names a host that does not
             resolve), 'unconfigured' (no SUPABASE_URL), 'reachable'.
   store:    'device' (no DATABASE_URL - production) or 'server' (accounts in
             a database that answers; the account module's status and token
             check are answered here, the rest of it runs untouched). */
const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'DATABASE_URL', 'NEON_DATABASE_URL', 'POSTGRES_URL'];

function serverWorld(state) {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  if (state.supabase !== 'unconfigured') {
    process.env.SUPABASE_URL = 'https://' + (state.supabase === 'reachable' ? LIVE : PAUSED);
    process.env.SUPABASE_ANON_KEY = 'anon-key-for-test';
  }
  for (const m of [ENTRY, CORE, EXTRACT, LLM, MOBILE]) delete require.cache[m];

  // The model: counted, and answered, so a verified caller's voice step has
  // something to read. Every unverified path must leave the count at zero.
  const llm = { calls: 0 };
  const stub = async function callLLM() { llm.calls += 1; return { text: '{"tone":null,"why_not":"fixture"}', provider: 'fixture', model: 'none' }; };
  stub.parseJSON = (t) => JSON.parse(t);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };

  if (state.store === 'server') {
    const real = require(MOBILE);
    require.cache[MOBILE].exports = Object.assign({}, real, {
      status: async () => SERVER_STATUS,
      verifyToken: async (t) => (t === SERVER_TOKEN
        ? { ok: true, user: { id: SERVER_USER.id, name: SERVER_USER.name, phone: SERVER_USER.phone }, expires_at: new Date(Date.now() + 86400000).toISOString() }
        : { ok: false, reason: 'invalid' }),
    });
  }

  // assertPublicUrl() resolves the host for real; the fixture has no DNS
  // record, so it alone is answered with one public address. The guard's
  // scheme, port and private-range checks run untouched.
  const dns = require('dns').promises;
  const realLookup = dns.lookup;
  dns.lookup = async (host, opts) => (String(host).endsWith('.example') ? [{ address: '93.184.216.34', family: 4 }] : realLookup(host, opts));

  const net = { supabase: [], escaped: [] };
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === PAUSED) { net.supabase.push(u.pathname); throw new Error('getaddrinfo ENOTFOUND ' + PAUSED); }
    if (u.hostname === LIVE) { net.supabase.push(u.pathname); return response(/\/auth\/v1\/user/.test(u.pathname) ? 401 : 200, 'application/json', '{}', String(url)); }
    if (u.origin === SITE) { const row = PAGES[u.pathname]; return row ? response(200, row.ct, row.body, String(url)) : response(404, 'text/plain', '', String(url)); }
    net.escaped.push(String(url));
    throw new Error('a request left the test world: ' + url);
  };

  const handler = require(ENTRY);
  return {
    handler, llm, net,
    restore() {
      global.fetch = realFetch;
      dns.lookup = realLookup;
      for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
      for (const m of [ENTRY, CORE, EXTRACT, LLM, MOBILE]) delete require.cache[m];
    },
  };
}

/** Call the shipped entry point with a Vercel-shaped request; resolve what it sent. */
async function callShipped(handler, { method, url, headers, body }) {
  const u = new URL(url, HOST);
  const out = { code: 0, body: null, headers: {} };
  const res = {
    statusCode: 200,
    setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return out.headers[String(k).toLowerCase()]; },
    removeHeader(k) { delete out.headers[String(k).toLowerCase()]; },
    status(c) { out.code = c; this.statusCode = c; return res; },
    json(b) { out.body = b; if (!out.code) out.code = 200; return res; },
    end() { if (!out.code) out.code = 200; return res; },
  };
  const lower = {};
  for (const [k, v] of Object.entries(headers || {})) lower[String(k).toLowerCase()] = v;
  await handler({ method, url: u.pathname + u.search, headers: lower, query: Object.fromEntries(u.searchParams), body: body || {} }, res);
  return out;
}

/** The request the wizard sends for "Read my site", as THIS browser would send it. */
function browserExtractRequest(session, url) {
  // From the page: Origin is what a same-origin POST carries.
  const headers = { 'content-type': 'application/json', origin: HOST };
  // Every phone sign-in sends its token (LifecycleAuth.apiToken(), since
  // 2026-09-30); a visitor sends none.
  if (session === 'server') { headers['x-lifecycle-token'] = SERVER_TOKEN; headers.authorization = 'Bearer ' + SERVER_TOKEN; }
  if (session === 'device') { headers['x-lifecycle-token'] = DEVICE_TOKEN; headers.authorization = 'Bearer ' + DEVICE_TOKEN; }
  return { method: 'POST', url: '/api/public-config?action=brand&op=extract', headers, body: { url } };
}

/* ── the browser ─────────────────────────────────────────────────────────── */
async function openWizard(page, state, world) {
  const log = { dialogs: [], errors: [], api: [], extract: [] };
  page.on('dialog', (d) => { log.dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));

  await page.addInitScript((seed) => {
    // The anonymous supabase-js stand-in auth.js builds its client from. It
    // never holds a session: the mobile+PIN session is the one sign-in.
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => ({}),
        },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      }),
    };
    try {
      if (seed.session) {
        localStorage.setItem('lifecycle.auth.session', JSON.stringify(seed.session));
        if (seed.users) localStorage.setItem('lifecycle.auth.device.users', JSON.stringify(seed.users));
      } else {
        localStorage.removeItem('lifecycle.auth.session');
        localStorage.removeItem('lifecycle.auth.device.users');
      }
    } catch (_) {}
  }, seedFor(state));

  // Broadest first, most specific last: Playwright's last matching route wins.
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    // auth.js's one reachability probe, answered the way each host answers.
    if (/\/auth\/v1\/health/.test(u)) {
      return state.supabase === 'reachable'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        : route.abort('addressunreachable');
    }
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: esm
        ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};',
    });
  });
  await page.route(HOST + '/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const action = u.searchParams.get('action') || '';
    const op = u.searchParams.get('op') || '';
    const headers = await req.allHeaders();
    log.api.push({ url: u.pathname + u.search, headers });
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (action === 'auth') {
      if (op === 'status') return json(state.store === 'server' ? SERVER_STATUS : PROD_STATUS);
      if (op === 'me') {
        return state.store === 'server' && headers['x-lifecycle-token'] === SERVER_TOKEN
          ? json({ ok: true, mode: 'server', user: SERVER_USER, message: SERVER_STATUS.message })
          : json({ ok: false, error: 'invalid_session', message: 'Your sign-in has expired or was signed out.' }, 401);
      }
      return json({ ok: false, error: 'no_database', mode: 'device', message: 'No database is configured on this deployment, so "' + op + '" cannot run on the server.' }, 503);
    }
    // The config and every brand op: the SHIPPED entry point, in this process.
    if (u.pathname === '/api/public-config' && (!action || action === 'brand')) {
      let body = {};
      try { body = req.postDataJSON() || {}; } catch (_) { body = {}; }
      const out = await callShipped(world.handler, { method: req.method(), url: u.pathname + u.search, headers, body });
      if (op === 'extract') log.extract.push({ headers, sent: body, code: out.code, body: out.body });
      return json(out.body, out.code || 200);
    }
    return json({ ok: true, features: [], packs: [] });
  });

  await page.goto(HOST + '/onboarding.html', { waitUntil: 'domcontentloaded' });
  // auth.js has decided, the Supabase state has been probed where a session
  // carries it, and the wizard has painted on the decision.
  await page.waitForFunction(() => {
    const a = window.LifecycleAuth;
    const b = a && a.backend;
    if (!b || b.kind === 'pending') return false;
    if (a.session && b.supabase === 'pending') return false;
    const bc = window.BrandContext;
    if (!bc || !bc.loaded || !bc.storage || !bc.storage().known) return false;
    const rs = bc.storage().read_site;
    return !rs || rs.decided;
  }, null, { timeout: 20000 });
  await page.waitForSelector('#xRun');
  await page.waitForTimeout(300);
  return log;
}

function seedFor(state) {
  const expires = new Date(Date.now() + 80 * 86400000).toISOString();
  if (state.session === 'device') {
    const users = {};
    users[DEVICE_USER.phone] = Object.assign({}, DEVICE_USER, { salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null, createdAt: expires, pinSetAt: expires });
    return {
      users,
      // Exactly how auth.js stores a device-mode sign-in made on production.
      session: {
        token: DEVICE_TOKEN, mode: 'device', provider: 'mobile-pin',
        user: { id: DEVICE_USER.id, name: DEVICE_USER.name, phone: DEVICE_USER.phone }, expires,
        storage: { mode: 'device', reason: PROD_STATUS.reason, host: '', message: PROD_STATUS.message },
      },
    };
  }
  if (state.session === 'server') {
    return {
      session: {
        token: SERVER_TOKEN, mode: 'server', provider: 'mobile-pin',
        user: { id: SERVER_USER.id, name: SERVER_USER.name, phone: SERVER_USER.phone }, expires,
        storage: { mode: 'server', reason: '', host: SERVER_STATUS.host, message: SERVER_STATUS.message },
      },
    };
  }
  return { session: null };
}

/** The wizard's step 1, as a reader sees it. */
function readStep(page) {
  return page.evaluate(() => {
    const btn = document.getElementById('xRun');
    const note = document.querySelector('[data-needs-account="extract"]:not(button)');
    const card = document.getElementById('stepCard');
    return {
      enabled: !!btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true',
      note: note ? note.textContent.replace(/\s+/g, ' ').trim() : '',
      failures: card ? card.querySelectorAll('[data-failure], .vh-failure').length : -1,
      kind: (window.LifecycleAuth.backend || {}).kind,
      supabase: (window.LifecycleAuth.backend || {}).supabase,
      session: window.LifecycleAuth.session ? { mode: window.LifecycleAuth.session.mode, provider: window.LifecycleAuth.session.provider } : null,
      umode: (document.querySelector('#lnav-umode') || {}).textContent || '',
    };
  });
}

/** Type the site and press Read my site, retrying past a re-render of the step. */
async function readMySite(page, url) {
  await expect(async () => {
    await page.fill('#xUrl', url);
    await page.click('#xRun', { timeout: 2000 });
    await expect(page.locator('.xtract h3').filter({ hasText: /Read from|Could not read/ })).toHaveCount(1, { timeout: 8000 });
  }).toPass({ timeout: 30000 });
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE REPORT: signed in on this device, the database paused
   ═══════════════════════════════════════════════════════════════════════════ */

test('signed in on this device with the database paused (production), "Read my site" is ON, sends the device token, and the report renders', async ({ page }) => {
  test.setTimeout(90_000);
  const state = { supabase: 'unreachable', store: 'device', session: 'device' };
  const world = serverWorld(state);
  try {
    const log = await openWizard(page, state, world);
    const seen = await readStep(page);
    // The fixture IS production's state, or nothing below means anything.
    expect(seen.kind, 'not signed in').toBe('signed-in');
    expect(seen.session).toEqual({ mode: 'device', provider: 'mobile-pin' });
    expect(seen.supabase, 'the Supabase host was not found unreachable').toBe('unreachable');
    expect(seen.umode).toContain('Saved on this device only: no database is configured');

    await page.fill('#xUrl', SITE + '/');
    expect(seen.enabled, `signing in turned "Read my site" off: ${seen.note}`).toBe(true);
    expect(seen.note, 'a disabled-control note is still painted beside an enabled control').toBe('');

    await readMySite(page, SITE + '/');

    // The request that left carries the device sign-in, from the page (#115):
    // the server reads the site FOR this person, not on the visitor's path.
    expect(log.extract.length, 'op=extract was not sent').toBe(1);
    const sent = log.extract[0];
    expect(sent.headers['x-lifecycle-token'] || String(sent.headers.authorization || '').replace(/^Bearer /, '')).toBe(DEVICE_TOKEN);
    expect(sent.headers.origin || sent.headers.referer).toBeTruthy();
    expect(sent.code, `the server refused: ${JSON.stringify(sent.body)}`).toBe(200);
    expect(sent.body.ok).toBe(true);
    expect(sent.body.signed_out).toBeUndefined();

    // The report, as the operator reads it.
    const report = await page.locator('.xtract').filter({ hasText: 'Read from' }).innerText();
    expect(report).toContain('Read from ' + SITE);
    expect(report).toContain('Harbourlight Goods');
    // Never "without signing in" to a person who is signed in.
    expect(report).not.toMatch(/without signing in|without an account/i);
    expect((await readStep(page)).failures, 'the report rendered a failure frame').toBe(0);

    // A device principal from a page may reach a model (#115); the voice step ran.
    expect(world.llm.calls, 'the voice step did not run for a signed-in person').toBe(1);
    expect(world.net.escaped, 'the server reached a host the test did not claim').toEqual([]);
    expect(log.dialogs).toEqual([]);
    expect(log.errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e))).toEqual([]);
  } finally { world.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. THE SAME REQUEST, SIGNED OUT: it was broken on the server too
   ═══════════════════════════════════════════════════════════════════════════ */

test('signed out with the database paused, the ON button actually reads the site (the server used to answer 401 to a request with no token)', async ({ page }) => {
  test.setTimeout(90_000);
  const state = { supabase: 'unreachable', store: 'device', session: 'none' };
  const world = serverWorld(state);
  try {
    const log = await openWizard(page, state, world);
    const seen = await readStep(page);
    expect(seen.kind).toBe('unreachable');
    expect(seen.session).toBeNull();
    expect(seen.enabled).toBe(true);

    await readMySite(page, SITE + '/');
    expect(log.extract.length).toBe(1);
    expect(log.extract[0].headers.authorization).toBeUndefined();
    expect(log.extract[0].code, `the server refused a visitor it has no way to verify: ${JSON.stringify(log.extract[0].body)}`).toBe(200);
    const report = await page.locator('.xtract').filter({ hasText: 'Read from' }).innerText();
    expect(report).toContain('Harbourlight Goods');
    expect(world.llm.calls).toBe(0);
    expect(world.net.escaped).toEqual([]);
    expect(log.dialogs).toEqual([]);
  } finally { world.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE RULE: the wizard's decision IS the server's answer, in every state
   ───────────────────────────────────────────────────────────────────────────
   For each state a browser can be in, the page is loaded and its decision read;
   then the request THAT browser would send is handed to the shipped entry
   point. ON must mean the server reads the site; OFF must mean it refuses.
   An OFF control must say why in words that are true for this person: never
   "sign in" to someone who is signed in, and never "sign in" to a visitor for
   whom signing in would not turn it on.
   ═══════════════════════════════════════════════════════════════════════════ */

const MATRIX = [
  // production today, signed out and signed in on the device
  { supabase: 'unreachable', store: 'device', session: 'none', on: true },
  { supabase: 'unreachable', store: 'device', session: 'device', on: true },
  // no Supabase configured at all
  { supabase: 'unconfigured', store: 'device', session: 'none', on: true },
  { supabase: 'unconfigured', store: 'device', session: 'device', on: true },
  // the project restored: a session could be checked, so the gate is real for
  // a visitor - and a device sign-in IS one the server acts for (#115)
  { supabase: 'reachable', store: 'device', session: 'none', on: false },
  { supabase: 'reachable', store: 'device', session: 'device', on: true },
  // accounts in a database (DATABASE_URL), Supabase still paused: a device
  // sign-in from before that is not in the session table, and is refused
  { supabase: 'unreachable', store: 'server', session: 'none', on: false },
  { supabase: 'unreachable', store: 'server', session: 'device', on: false },
  { supabase: 'unreachable', store: 'server', session: 'server', on: true },
  // accounts in a database, Supabase restored
  { supabase: 'reachable', store: 'server', session: 'none', on: false },
  { supabase: 'reachable', store: 'server', session: 'server', on: true },
];

for (const state of MATRIX) {
  const name = `supabase ${state.supabase}, accounts on the ${state.store}, ${state.session === 'none' ? 'signed out' : state.session + '-mode sign-in'}`;
  test(`the wizard's decision equals the server's answer: ${name}`, async ({ page }) => {
    test.setTimeout(60_000);
    const world = serverWorld(state);
    try {
      const log = await openWizard(page, state, world);
      const seen = await readStep(page);
      expect(!!seen.session, 'the fixture has the wrong session').toBe(state.session !== 'none');

      // What the shipped handler answers to the request this browser sends.
      const before = world.llm.calls;
      const out = await callShipped(world.handler, browserExtractRequest(state.session, SITE + '/'));
      const served = out.code === 200 && !!(out.body && out.body.ok);
      expect(served, `the server's own answer changed for this state: ${out.code} ${JSON.stringify(out.body).slice(0, 240)}`).toBe(state.on);
      expect(seen.enabled, `the wizard says ${seen.enabled ? 'ON' : 'OFF'} and the server ${served ? 'reads' : 'refuses'} (${seen.note})`).toBe(served);

      // Nothing the server did not act FOR reaches a model, in any state: a
      // server-mode account, or a device principal from a page (#115).
      // A device principal is unmetered (#115) and its voice step runs. A
      // server-mode number the operator has NOT listed has no wallet, so its
      // voice step is skipped and said so (2026-10-03, review): an unlisted
      // number never reaches a provider.
      const actedFor = state.session === 'device' && served;
      expect(world.llm.calls - before, actedFor ? 'a signed-in person\'s voice step did not run' : 'a model was called for a caller that may not spend').toBe(actedFor ? 1 : 0);
      if (served && !actedFor) expect(out.body.voice_skipped).toBe(true);

      if (!seen.enabled) {
        expect(seen.note, 'a disabled control with no reason').not.toBe('');
        expect(seen.failures, 'a disabled control was rendered as a failure').toBe(0);
        if (state.session !== 'none') {
          // THE operator's words: "not working after signin". Never tell a
          // signed-in person to sign in.
          expect(seen.note).not.toMatch(/\bsign in\b|\bsign-in first\b|not signed in/i);
        }
        if (state.session === 'none') {
          // Signing in IS the remedy on every deployment now: a server-mode
          // sign-in is verified, and a device-mode one is admitted (#115).
          expect(seen.note, 'signing in IS the remedy here, and the note does not say so').toMatch(/\bsign in\b/i);
        }
        if (state.session === 'device') {
          // The stale device sign-in: the remedy is to sign in AGAIN.
          expect(seen.note).toMatch(/entering your number again/i);
        }
      }
      expect(world.net.escaped).toEqual([]);
      expect(log.dialogs).toEqual([]);
    } finally { world.restore(); }
  });
}
