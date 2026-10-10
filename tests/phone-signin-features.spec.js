/**
 * Signing in with a phone never turns a feature off (2026-10-03).
 * ---------------------------------------------------------------------------
 * The operator's words, with a phone screenshot of production `/onboarding`
 * after signing in with a mobile number and PIN: "All features must work even
 * with signin by number and pin". The screenshot showed "Read my site"
 * disabled with "Not available on a mobile-number account". The same sentence
 * sat on Import catalog and Build context pack, and Suggest options said "Not
 * available while this sign-in is kept on this device only" - four controls on
 * the FIRST SCREEN that signing in turned OFF.
 *
 * Production is DEVICE mode: no DATABASE_URL, the Supabase project paused. Since
 * 2026-09-30 (PR #115) the page sends a device sign-in's token and the server
 * admits it as a device principal from a page. The wizard never caught up: it
 * still decided by account type. And two of the four (catalogue, pack) were
 * FILED in the workspace database, which a phone account has no row in - so the
 * server reads the store / the site and hands the result back, and the browser
 * keeps it beside the brand on the device.
 *
 * HOW THIS IS MEASURED. The real onboarding page in Chromium, served as a real
 * host (auth.js treats localhost as a preview). Every brand op goes to the
 * SHIPPED entry point (`api/public-config.js`, request-scope wrapper and all)
 * running in this Node process, with the request's real headers (Origin and
 * Referer included). `global.fetch` answers ONLY: the brand's own fixture site,
 * the paused Supabase host (which does not resolve), and GitHub (unreachable,
 * so the pack must say "not searched", never "no repositories"). Any other host
 * is recorded and fails the test. `llm.js` is replaced in `require.cache` (the
 * module IS the function) and counted per stage. Dialogs fail.
 *
 * And the other side of the door, executed: a request with no token, a forged
 * Supabase JWT, and a device token with no Origin all stay refused for every
 * op this opens, and none of them reaches a model (#115's rule).
 *
 * ── 2026-10-10: RETIRED IN PART - GOOGLE IS THE ONLY SIGN-IN ───────────────
 * The owner's words: "No signin with mobile number - only Google signin pls".
 * The mobile-number sign-in this file turned ON is switched off, so the five
 * "signed in with a phone ..." tests, the device-token pack run and the
 * device-catalogue refusal are RETIRED: no phone principal exists for them to
 * drive, and a phone token is refused like no token (gated in
 * tests/google-only-signin.spec.js). What stays is the door, executed - no
 * token, a forged JWT, and a device token from a page OR with no Origin reach
 * no model and no store for any op this file opened - and the signed-out
 * wizard, whose three controls now name Google as the sign-in that turns
 * them on.
 *
 * Run: npx playwright test tests/phone-signin-features.spec.js --project=desktop-1280
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
const PACK = require.resolve('../api/_shared/brand-context-pack.js');
const SUGGEST = require.resolve('../api/_shared/brand-suggest.js');
const LLM = require.resolve('../api/_shared/llm.js');
const MOBILE = require.resolve('../api/_shared/mobile-auth-core.js');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const HOST = 'http://app.example.test';
const PAUSED = 'paused-project.supabase.co';
const SITE = 'https://harbourlight.example';

/** Production's answer to `?action=auth&op=status`, verbatim. */
const PROD_STATUS = { ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured. Set DATABASE_URL to keep accounts in a database.' };
const DEVICE_USER = { id: 'dev-features0001', phone: '+919876543210', cc: '+91', local: '9876543210', name: 'Asha' };
const DEVICE_TOKEN = 'DEVICEtokenFEATURES0123456789abcdefghijklmn';
const BRAND_ID = 'local-harbour000000001';
const BRAND_ID_2 = 'local-harbour000000002';

/* ── the brand's own site ─────────────────────────────────────────────────── */
const PRODUCTS = [
  { title: 'Quay Lantern', handle: 'quay-lantern', body_html: 'Hand-made brass lantern.', product_type: 'Lantern', variants: [{ price: '120.00', sku: 'QL-1' }], images: [{ src: SITE + '/img/quay.jpg' }] },
  { title: 'Harbour Lamp', handle: 'harbour-lamp', body_html: 'Table lamp, recycled glass.', product_type: 'Lamp', variants: [{ price: '85.00', sku: 'HL-2' }], images: [{ src: SITE + '/img/lamp.jpg' }] },
  { title: 'Tide Candle', handle: 'tide-candle', body_html: 'Soy candle.', product_type: 'Candle', variants: [{ price: '18.00', sku: 'TC-3' }] },
];
const PAGES = {
  '/': {
    ct: 'text/html',
    body: `<!doctype html><html lang="en"><head><title>Harbourlight Goods</title>
      <meta property="og:site_name" content="Harbourlight Goods">
      <meta name="description" content="Lamps and lanterns made by hand on the harbour.">
      <meta name="theme-color" content="#1a6b3c">
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
    body: '<!doctype html><html><head><title>About Harbourlight</title><meta name="description" content="Who makes the lamps."></head><body><h1>About</h1>'
      + '<h2>Our workshop</h2><p>Harbourlight Goods Ltd, 4 Quay Street. Every lamp is finished by hand.</p></body></html>',
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

/* ── the server: production's configuration, in this process ─────────────── */
const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'DATABASE_URL', 'NEON_DATABASE_URL', 'POSTGRES_URL', 'GITHUB_TOKEN'];
const MODULES = [ENTRY, CORE, EXTRACT, PACK, SUGGEST, LLM, MOBILE];

function serverWorld() {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  // Production: no DATABASE_URL, and SUPABASE_URL names a paused project.
  process.env.SUPABASE_URL = 'https://' + PAUSED;
  process.env.SUPABASE_ANON_KEY = 'anon-key-for-test';
  for (const m of MODULES) delete require.cache[m];

  const llm = { calls: 0, stages: [] };
  const stub = async function callLLM(o) {
    llm.calls += 1;
    llm.stages.push(String((o && o.stage) || ''));
    if (o && o.stage === 'brand-suggest') {
      return { text: JSON.stringify({ options: [
        { value: 'Warm and plain-spoken, like a maker talking at the workbench', why: 'Matches the hand-made story on the site.' },
        { value: 'Quietly confident, never salesy', why: 'Fits a considered purchase.' },
        { value: 'Coastal and unhurried', why: 'The harbour is the brand.' },
      ] }), provider: 'fixture', model: 'none' };
    }
    return { text: '{"tone":"warm, plain-spoken","why_not":null,"evidence":[]}', provider: 'fixture', model: 'none' };
  };
  stub.parseJSON = (t) => JSON.parse(t);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };

  const dns = require('dns').promises;
  const realLookup = dns.lookup;
  dns.lookup = async (host, opts) => (String(host).endsWith('.example') ? [{ address: '93.184.216.34', family: 4 }] : realLookup(host, opts));

  const net = { supabase: 0, github: 0, site: [], escaped: [] };
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === PAUSED) { net.supabase += 1; throw new Error('getaddrinfo ENOTFOUND ' + PAUSED); }
    if (/(^|\.)github(usercontent)?\.com$/.test(u.hostname)) { net.github += 1; throw new Error('getaddrinfo ENOTFOUND ' + u.hostname); }
    if (u.origin === SITE) {
      net.site.push(u.pathname + u.search);
      if (u.pathname === '/products.json') {
        const page = +(u.searchParams.get('page') || 1);
        return response(200, 'application/json', JSON.stringify({ products: page === 1 ? PRODUCTS : [] }), String(url));
      }
      const row = PAGES[u.pathname];
      return row ? response(200, row.ct, row.body, String(url)) : response(404, 'text/plain', '', String(url));
    }
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
      for (const m of MODULES) delete require.cache[m];
    },
  };
}

/** Call the shipped entry point with a Vercel-shaped request. */
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
    send(b) { out.body = b; if (!out.code) out.code = 200; return res; },
    end() { if (!out.code) out.code = 200; return res; },
  };
  const lower = {};
  for (const [k, v] of Object.entries(headers || {})) lower[String(k).toLowerCase()] = v;
  await handler({ method, url: u.pathname + u.search, headers: lower, query: Object.fromEntries(u.searchParams), body: body || {} }, res);
  return out;
}

/* ── the device: a phone sign-in made on production, and its brand ───────── */
function brandRow(id, extra) {
  return Object.assign({
    id, slug: 'harbourlight-goods', name: 'Harbourlight Goods', legal_name: null,
    tagline: 'Lamps and lanterns made by hand', industry: 'Home goods: hand-made lamps and lanterns',
    website: SITE, logo_url: null, favicon_url: null,
    palette: { primary: '#1a6b3c', accent: '#b8531f', ink: '#15201c', surface: '#fbfaf6' },
    typography: { heading: { family: 'Fraunces', stack: "'Fraunces',Georgia,serif" }, body: { family: 'Inter', stack: "'Inter',system-ui,sans-serif" } },
    voice: { tone: '', preferred: [], banned: [], no_em_dashes: true },
    regions: [{ code: 'US', name: 'United States', currency: 'USD', store_url: SITE, home: true }],
    asset_hosts: [], catalog_source: {}, brand_data: {},
    status: 'draft', onboarding_step: 1, owner_id: null,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', storage: 'device',
  }, extra || {});
}

async function openWizard(page, world, { session = true, query = '' } = {}) {
  const log = { dialogs: [], errors: [], api: [], downloads: [] };
  page.on('dialog', (d) => { log.dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));

  await page.addInitScript((seed) => {
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
      // The device store is seeded once per test, not on every navigation:
      // a reload must read back what the page itself kept.
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const k of Object.keys(localStorage)) if (/^lifecycle\./.test(k)) localStorage.removeItem(k);
      if (seed.session) {
        localStorage.setItem('lifecycle.auth.session', JSON.stringify(seed.session));
        localStorage.setItem('lifecycle.auth.device.users', JSON.stringify(seed.users));
      }
      localStorage.setItem(seed.deviceKey, JSON.stringify(seed.workspaces));
    } catch (_) {}
  }, seedFor(session));

  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.abort('addressunreachable');
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
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (action === 'auth') {
      // The account mount on a deployment with no DATABASE_URL: status says
      // "device"; nothing else runs on the server (auth.js runs it locally).
      if (op === 'status') return json(PROD_STATUS);
      return json({ ok: false, error: 'no_database', mode: 'device', message: 'No database is configured on this deployment, so "' + op + '" cannot run on the server.' }, 503);
    }
    if (u.pathname === '/api/public-config' && (!action || action === 'brand')) {
      let body = {};
      try { body = req.postDataJSON() || {}; } catch (_) { body = {}; }
      const out = await callShipped(world.handler, { method: req.method(), url: u.pathname + u.search, headers, body });
      log.api.push({ op, headers, sent: body, code: out.code, body: out.body });
      return json(out.body, out.code || 200);
    }
    return json({ ok: true, features: [], packs: [] });
  });

  await page.goto(HOST + '/onboarding.html' + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const a = window.LifecycleAuth;
    const b = a && a.backend;
    if (!b || b.kind === 'pending') return false;
    if (a.session && b.supabase === 'pending') return false;
    const bc = window.BrandContext;
    if (!bc || !bc.loaded || !bc.storage || !bc.storage().known) return false;
    const st = bc.storage();
    return (!st.read_site || st.read_site.decided) && (!st.server_actions || st.server_actions.decided);
  }, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  return log;
}

function seedFor(session) {
  const expires = new Date(Date.now() + 80 * 86400000).toISOString();
  const users = {};
  users[DEVICE_USER.phone] = Object.assign({}, DEVICE_USER, { salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null, createdAt: expires, pinSetAt: expires });
  return {
    users,
    session: session ? {
      token: DEVICE_TOKEN, mode: 'device', provider: 'mobile-pin',
      user: { id: DEVICE_USER.id, name: DEVICE_USER.name, phone: DEVICE_USER.phone }, expires,
      storage: { mode: 'device', reason: PROD_STATUS.reason, host: '', message: PROD_STATUS.message },
    } : null,
    deviceKey: session ? 'lifecycle.brand.device.workspaces.' + DEVICE_USER.id : 'lifecycle.brand.device.workspaces',
    workspaces: { version: 1, active_id: BRAND_ID, workspaces: [brandRow(BRAND_ID), brandRow(BRAND_ID_2, { slug: 'harbourlight-two' })] },
  };
}

/** What the device holds for a brand, read the way brand-context.js keys it. */
function deviceSide(page, kind, id) {
  return page.evaluate(({ kind, id, uid }) => {
    const raw = localStorage.getItem('lifecycle.brand.device.workspaces.' + uid + '.' + kind + '.' + id);
    return raw ? JSON.parse(raw) : null;
  }, { kind, id, uid: DEVICE_USER.id });
}

async function stepState(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const card = document.getElementById('stepCard');
    return {
      present: !!el,
      enabled: !!el && !el.disabled && el.getAttribute('aria-disabled') !== 'true',
      notes: Array.from(document.querySelectorAll('#stepCard p[data-needs-account]')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
      failures: card ? card.querySelectorAll('.vh-failure').length : -1,
      phoneWords: /not available on a mobile-number account|kept on this device only/i.test(card ? card.innerText : ''),
    };
  }, sel);
}

/** The request the browser sent carried the device token, from a page. */
function expectDeviceRequest(entry) {
  const tok = entry.headers['x-lifecycle-token'] || String(entry.headers.authorization || '').replace(/^Bearer\s+/i, '');
  expect(tok, 'the device sign-in\'s token was not sent').toBe(DEVICE_TOKEN);
  expect(entry.headers.origin || entry.headers.referer, 'the request carried no page Origin/Referer').toBeTruthy();
}

function cleanErrors(log) { return log.errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e)); }

/* ═══════════════════════════════════════════════════════════════════════════
   1. READ MY SITE — the control in the screenshot
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   2. SUGGEST OPTIONS
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   3. IMPORT CATALOG — read by the server, kept on the device
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   4. BUILD CONTEXT PACK — the same stages, driven by this page, kept here
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   5. THE OTHER SIDE OF THE DOOR — still shut, executed
   ═══════════════════════════════════════════════════════════════════════════ */

const DOOR_OPS = [
  { op: 'extract', body: { url: SITE + '/' } },
  { op: 'suggest', body: { field: 'voice.tone', brand: brandRow(BRAND_ID) } },
  { op: 'catalog-import', body: { workspace_id: BRAND_ID, region: 'us', kind: 'storefront', url: SITE, brand: brandRow(BRAND_ID) } },
  { op: 'context-build', body: { workspace_id: BRAND_ID, refresh: true, brand: brandRow(BRAND_ID) } },
];
const CALLERS = {
  'no token': { 'content-type': 'application/json', origin: HOST },
  'a forged Supabase JWT': { 'content-type': 'application/json', origin: HOST, authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged' },
  'a device token with no page Origin': { 'content-type': 'application/json', 'x-lifecycle-token': DEVICE_TOKEN },
  'a device token from a page (admitted until 2026-10-10)': { 'content-type': 'application/json', origin: HOST, referer: HOST + '/onboarding.html', 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN },
};

for (const [who, headers] of Object.entries(CALLERS)) {
  test(`${who}: nothing this opens for a phone sign-in reaches a model or the store`, async () => {
    const world = serverWorld();
    try {
      for (const { op, body } of DOOR_OPS) {
        const out = await callShipped(world.handler, { method: 'POST', url: '/api/public-config?action=brand&op=' + op, headers, body });
        if (op === 'extract' && out.code === 200) {
          // The visitor's path (2026-09-15/29): nothing could check a session,
          // so the public page is read - with the model forced OFF.
          expect(out.body.signed_out).toBe(true);
          expect(out.body.voice_skipped).toBe(true);
        } else {
          expect([401, 503], `${op} answered ${out.code} for ${who}: ${JSON.stringify(out.body).slice(0, 200)}`).toContain(out.code);
          expect(out.body.ok).toBe(false);
          expect(out.body.message, `${op} refused with no sentence`).toBeTruthy();
        }
      }
      expect(world.llm.calls, `${who} reached a model`).toBe(0);
      expect(world.net.site.some((p) => p.startsWith('/products.json')), `${who} had the server read a store`).toBe(false);
      expect(world.net.escaped).toEqual([]);
    } finally { world.restore(); }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. SIGNED OUT — off, with the remedy that now works
   ═══════════════════════════════════════════════════════════════════════════ */

test('signed out on production, the three are off with a sentence naming the sign-in that turns them on', async ({ page }) => {
  test.setTimeout(90_000);
  const world = serverWorld();
  try {
    const log = await openWizard(page, world, { session: false, query: '?id=' + BRAND_ID + '&step=4' });
    await page.waitForSelector('[data-suggest-off="voice.tone"]');
    await expect(page.locator('p[data-needs-account="suggest"]')).toContainText(/sign in with Google/i);
    await page.click('.step-pip[data-step="5"]');
    await expect(page.locator('#doImport')).toBeDisabled();
    await expect(page.locator('p[data-needs-account="catalog-import"]')).toContainText(/sign in with Google/i);
    await page.click('.step-pip[data-step="6"]');
    await expect(page.locator('#packBuild')).toBeDisabled();
    await expect(page.locator('p[data-needs-account="context-pack"]')).toContainText(/sign in with Google/i);
    expect((await stepState(page, '#packBuild')).failures).toBe(0);
    expect(log.api.filter((x) => /^(suggest|catalog-import|context-)/.test(x.op))).toEqual([]);
    expect(world.llm.calls).toBe(0);
    expect(log.dialogs).toEqual([]);
  } finally { world.restore(); }
});

/* Codex #8 (2026-10-03): a catalogue the browser refuses to keep stops the build and says so. */