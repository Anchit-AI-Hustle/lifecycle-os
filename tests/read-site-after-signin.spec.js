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
 *      Nobody presents one any more: Google sign-in is removed, so no
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
 * SUPERSEDED AGAIN (2026-10-10): Google is the only sign-in (the owner's
 * words: "No signin with mobile number - only Google signin pls"). There is
 * no device principal and no account in Neon: a mobile-number session left
 * in this browser is ended on boot (auth.js endLegacyPhoneSession), so that
 * browser IS a signed-out one, and its old token is refused by the server
 * exactly like no token. The signed-in state is a Google session supabase-js
 * restores; the server verifies it at the project's /auth/v1/user. The
 * "accounts in a database" dimension is gone with the accounts.
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
// op=extract RENDERS the site in a browser first (2026-10-04, brand-render.js).
// This spec is about the gate and the parser path, so the browser read is
// switched off with the operator's own switch; the rendered path has its own
// specs (rendered-brand-read*.spec.js), which switch it back on.
process.env.BRAND_RENDER = 'off';
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

/** A Google sign-in: a Supabase access token (a JWT, two dots) and its user. */
const GOOGLE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYWFhYWFhYS0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAxMDEifQ.Zml4dHVyZQ';
const GOOGLE_USER = { id: 'aaaaaaaa-0000-4000-8000-000000000101', email: 'ravi@example.test', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { name: 'Ravi' }, identities: [{ provider: 'google' }] };
/** A mobile-number session from before 2026-10-10, as auth.js stored it. */
const PHONE_TOKEN = 'DEVICEtokenREADSITE0123456789abcdefghijklmn';
const PHONE_SESSION = {
  token: PHONE_TOKEN, mode: 'device', provider: 'mobile-pin',
  user: { id: 'dev-readsite0001', name: 'Asha', phone: '+919876543210' },
  expires: new Date(Date.now() + 80 * 86400000).toISOString(),
};

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
             resolve), 'unconfigured' (no SUPABASE_URL), 'reachable' (the
             project answers, and verifies the Google token at /auth/v1/user). */
const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'DATABASE_URL', 'NEON_DATABASE_URL', 'POSTGRES_URL', 'CREDITS_COMP_PHONES'];

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

  // assertPublicUrl() resolves the host for real; the fixture has no DNS
  // record, so it alone is answered with one public address. The guard's
  // scheme, port and private-range checks run untouched.
  const dns = require('dns').promises;
  const realLookup = dns.lookup;
  dns.lookup = async (host, opts) => (String(host).endsWith('.example') ? [{ address: '93.184.216.34', family: 4 }] : realLookup(host, opts));

  const net = { supabase: [], escaped: [] };
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname === PAUSED) { net.supabase.push(u.pathname); throw new Error('getaddrinfo ENOTFOUND ' + PAUSED); }
    if (u.hostname === LIVE) {
      net.supabase.push(u.pathname);
      if (/\/auth\/v1\/user/.test(u.pathname)) {
        const h = (init && init.headers) || {};
        const auth = String(h.authorization || h.Authorization || '');
        return auth === 'Bearer ' + GOOGLE_TOKEN
          ? response(200, 'application/json', JSON.stringify(GOOGLE_USER), String(url))
          : response(401, 'application/json', '{}', String(url));
      }
      return response(200, 'application/json', '{}', String(url));
    }
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
  // A Google sign-in sends its access token; a visitor sends none, and so
  // does a browser whose mobile-number session was ended on boot.
  if (session === 'google') headers.authorization = 'Bearer ' + GOOGLE_TOKEN;
  return { method: 'POST', url: '/api/public-config?action=brand&op=extract', headers, body: { url } };
}

/* ── the browser ─────────────────────────────────────────────────────────── */
async function openWizard(page, state, world) {
  const log = { dialogs: [], errors: [], api: [], extract: [] };
  page.on('dialog', (d) => { log.dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));

  await page.addInitScript((seed) => {
    // The supabase-js stand-in auth.js builds its client from: for 'google'
    // it restores the Google session, as the real client does from storage.
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: seed.google || null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => ({}),
        },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      }),
    };
    try {
      if (seed.phone) {
        localStorage.setItem('lifecycle.auth.session', JSON.stringify(seed.phone));
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
    // The config, the switched-off PIN router (a leftover session's signout
    // goes there) and every brand op: the SHIPPED entry point, in this process.
    if (u.pathname === '/api/public-config' && (!action || action === 'brand' || action === 'auth')) {
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
  if (state.session === 'google') {
    return { google: { access_token: GOOGLE_TOKEN, refresh_token: 'r-fixture', expires_at: Math.floor(Date.now() / 1000) + 86400, user: GOOGLE_USER } };
  }
  if (state.session === 'phone') return { phone: PHONE_SESSION };
  return {};
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
      session: window.LifecycleAuth.session ? { id: (window.LifecycleAuth.session.user || {}).id } : null,
      stored: localStorage.getItem('lifecycle.auth.session'),
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
   1. THE REPORT: signed in with Google, the project answering
   ═══════════════════════════════════════════════════════════════════════════ */

test('signed in with Google, "Read my site" is ON, sends the Google token, the server reads FOR this person, and the report renders', async ({ page }) => {
  test.setTimeout(90_000);
  const state = { supabase: 'reachable', session: 'google' };
  const world = serverWorld(state);
  try {
    const log = await openWizard(page, state, world);
    const seen = await readStep(page);
    expect(seen.kind, 'not signed in').toBe('signed-in');
    expect(seen.session).toEqual({ id: GOOGLE_USER.id });
    expect(seen.enabled, `signing in turned "Read my site" off: ${seen.note}`).toBe(true);
    expect(seen.note).toBe('');

    await readMySite(page, SITE + '/');
    expect(log.extract.length, 'op=extract was not sent').toBe(1);
    const sent = log.extract[0];
    expect(sent.headers.authorization).toBe('Bearer ' + GOOGLE_TOKEN);
    expect(sent.headers['x-lifecycle-token'], 'a PIN-era header was sent').toBeUndefined();
    expect(sent.code, `the server refused: ${JSON.stringify(sent.body)}`).toBe(200);
    expect(sent.body.ok).toBe(true);
    expect(sent.body.signed_out).toBeUndefined();
    expect(world.net.supabase, 'the server did not verify the Google token').toContain('/auth/v1/user');

    const report = await page.locator('.xtract').filter({ hasText: 'Read from' }).innerText();
    expect(report).toContain('Read from ' + SITE);
    expect(report).toContain('Harbourlight Goods');
    expect(report).not.toMatch(/without signing in|without an account/i);
    expect((await readStep(page)).failures, 'the report rendered a failure frame').toBe(0);
    // A verified Google account may reach a model: the voice step ran.
    expect(world.llm.calls, 'the voice step did not run for a signed-in person').toBe(1);
    expect(world.net.escaped, 'the server reached a host the test did not claim').toEqual([]);
    expect(log.dialogs).toEqual([]);
    expect(log.errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e))).toEqual([]);
  } finally { world.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. SIGNED OUT WITH THE PROJECT PAUSED (production): the open path
   ═══════════════════════════════════════════════════════════════════════════ */

test('signed out with the project paused, the ON button actually reads the site (the server used to answer 401 to a request with no token)', async ({ page }) => {
  test.setTimeout(90_000);
  const state = { supabase: 'unreachable', session: 'none' };
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
   An OFF control says why: "Sign in with Google" to a visitor for whom
   signing in turns it on, never "sign in" to someone who is signed in.
   A mobile-number session from before 2026-10-10 is ended on boot, so that
   browser is a signed-out one, and its old token gets the anonymous answer.
   ═══════════════════════════════════════════════════════════════════════════ */

const MATRIX = [
  // production today: the project paused
  { supabase: 'unreachable', session: 'none', on: true },
  { supabase: 'unreachable', session: 'phone', on: true },
  // no Supabase configured at all
  { supabase: 'unconfigured', session: 'none', on: true },
  { supabase: 'unconfigured', session: 'phone', on: true },
  // the project answering: a session can be checked, so the gate is real
  { supabase: 'reachable', session: 'none', on: false },
  { supabase: 'reachable', session: 'phone', on: false },
  { supabase: 'reachable', session: 'google', on: true },
];

for (const state of MATRIX) {
  const name = `supabase ${state.supabase}, ${state.session === 'none' ? 'signed out' : state.session === 'phone' ? 'a leftover mobile-number session' : 'signed in with Google'}`;
  test(`the wizard's decision equals the server's answer: ${name}`, async ({ page }) => {
    test.setTimeout(60_000);
    const world = serverWorld(state);
    try {
      const log = await openWizard(page, state, world);
      const seen = await readStep(page);
      expect(!!seen.session, 'the fixture has the wrong session').toBe(state.session === 'google');
      if (state.session === 'phone') expect(seen.stored, 'the mobile-number session was not ended on boot').toBeNull();

      // What the shipped handler answers to the request this browser sends.
      const before = world.llm.calls;
      const out = await callShipped(world.handler, browserExtractRequest(state.session, SITE + '/'));
      const served = out.code === 200 && !!(out.body && out.body.ok);
      expect(served, `the server's own answer changed for this state: ${out.code} ${JSON.stringify(out.body).slice(0, 240)}`).toBe(state.on);
      expect(seen.enabled, `the wizard says ${seen.enabled ? 'ON' : 'OFF'} and the server ${served ? 'reads' : 'refuses'} (${seen.note})`).toBe(served);

      // Only a verified Google account reaches a model.
      const actedFor = state.session === 'google' && served;
      expect(world.llm.calls - before, actedFor ? 'a signed-in person did not get the voice step' : 'a model was called for a caller nobody verified').toBe(actedFor ? 1 : 0);

      if (state.session === 'phone') {
        // Had the old token still been sent, the server answers it as it
        // answers nobody: the same status, and no model.
        const old = await callShipped(world.handler, Object.assign(browserExtractRequest('none', SITE + '/'), {
          headers: { 'content-type': 'application/json', origin: HOST, 'x-lifecycle-token': PHONE_TOKEN, authorization: 'Bearer ' + PHONE_TOKEN },
        }));
        expect([old.code, !!(old.body && old.body.ok)]).toEqual([out.code, served]);
        expect(world.llm.calls - before).toBe(0);
      }

      if (!seen.enabled) {
        expect(seen.note, 'a disabled control with no reason').not.toBe('');
        expect(seen.failures, 'a disabled control was rendered as a failure').toBe(0);
        // Signing in IS the remedy, and the sign-in is Google.
        expect(seen.note, 'the note does not name the remedy').toMatch(/sign in with Google/i);
        expect(seen.note).not.toMatch(/mobile|number|PIN/i);
      }
      expect(world.net.escaped).toEqual([]);
      expect(log.dialogs).toEqual([]);
    } finally { world.restore(); }
  });
}
