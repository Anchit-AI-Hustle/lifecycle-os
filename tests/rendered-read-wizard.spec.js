/**
 * "Read my site" in the WIZARD: rendered, applied completely, scored, reversible.
 * ---------------------------------------------------------------------------
 * The operator's words: "read my site should actually be fetching the exact
 * styling and branding of the website entered and apply that complete
 * accurately". This drives the real /onboarding page in Chromium, in the two
 * states production is in today - nobody signed in with the Supabase project
 * paused and no DATABASE_URL (the open path), and signed in with a mobile number
 * and PIN kept on this device (a device principal) - and asserts what the
 * operator sees:
 *   - the brand's tokens on <html> (--brand-*) are the RENDERED values,
 *     including a component token (the CTA's corner radius) the shell reads;
 *   - a field the operator typed before the read is KEPT, and said to be;
 *   - the panel shows the score with the side-by-side screenshots;
 *   - Revert puts every field and token back;
 *   - no dialog and no page error, on either path.
 *
 * Every /api/public-config request is answered by the SHIPPED entry point
 * running in this Node process. The site is a fixture (tests/lib/rendered-
 * sites.js, the utility-first one); `.example` hosts resolve to a public
 * address (the existing harness's convention), the parser reads them through a
 * global.fetch stand-in, and the browser reads them through render-net.js's
 * transport replaced in-process - the SSRF policy in front of it runs for real.
 *
 * Run: npx playwright test tests/rendered-read-wizard.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
delete process.env.BRAND_RENDER;
const fs = require('fs');
const path = require('path');
const sites = require('./lib/rendered-sites.js');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = require.resolve('../api/public-config.js');
const CORE = require.resolve('../api/_shared/brand-workspace-core.js');
const EXTRACT = require.resolve('../api/_shared/brand-extract.js');
const RENDER = require.resolve('../api/_shared/brand-render.js');
const NET = require.resolve('../api/_shared/render-net.js');
const LLM = require.resolve('../api/_shared/llm.js');
const MOBILE = require.resolve('../api/_shared/mobile-auth-core.js');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const HOST = 'http://app.example.test';
const PAUSED = 'paused-project.supabase.co';
const SITE = 'https://verdant.example';
const ROUTES = sites.siteRoutes('a');
const PROD_STATUS = { ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured. Set DATABASE_URL to keep accounts in a database.' };
const DEVICE_USER = { id: 'dev-renderread0001', phone: '+919876543210', name: 'Asha' };
const DEVICE_TOKEN = 'DEVICEtokenRENDERREAD0123456789abcdefghijkl';
const TYPED_LOGO = 'https://cdn.mybrand.example/my-own-logo.png';
const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'DATABASE_URL', 'NEON_DATABASE_URL', 'POSTGRES_URL', 'CREDITS_COMP_PHONES', 'BRAND_RENDER'];

test.describe.configure({ mode: 'serial' });

function serverWorld() {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SUPABASE_URL = 'https://' + PAUSED;
  process.env.SUPABASE_ANON_KEY = 'anon-key-for-test';
  for (const m of [ENTRY, CORE, EXTRACT, RENDER, NET, LLM, MOBILE]) delete require.cache[m];
  const llm = { calls: 0 };
  const stub = async function callLLM() { llm.calls += 1; return { text: '{"tone":null,"why_not":"fixture"}', provider: 'fixture', model: 'none' }; };
  stub.parseJSON = (t) => JSON.parse(t);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
  const dns = require('dns').promises;
  const realLookup = dns.lookup;
  dns.lookup = async (h, o) => (String(h).endsWith('.example') ? [{ address: '93.184.216.34', family: 4 }] : realLookup(h, o));
  const net = { escaped: [], browser: [] };
  // The parser's fetches.
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === PAUSED) throw new Error('getaddrinfo ENOTFOUND ' + PAUSED);
    if (u.origin === SITE) {
      const r = ROUTES[u.pathname];
      const body = r ? (Buffer.isBuffer(r.body) ? r.body.toString('latin1') : r.body) : '';
      return { ok: !!r && (r.status || 200) < 300, status: r ? (r.status || 200) : 404, url: String(url), headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? (r ? r.type : 'text/plain') : null) }, text: async () => body, json: async () => JSON.parse(body || '{}') };
    }
    net.escaped.push(String(url));
    throw new Error('a request left the test world: ' + url);
  };
  // The browser's fetches: render-net's transport, replaced in-process. The
  // policy (scheme, port, private ranges, DNS answers) has already run.
  const rn = require(NET);
  const realTransport = rn.transport;
  rn.transport = async (url) => {
    const u = new URL(url);
    net.browser.push(url);
    if (u.origin !== SITE) { net.escaped.push(url); return { error: 'not in the test world' }; }
    const r = ROUTES[u.pathname];
    if (!r) return { status: 404, headers: { 'content-type': 'text/plain' }, body: Buffer.from('nf') };
    return { status: r.status || 200, headers: Object.assign({ 'content-type': r.type }, r.headers || {}), body: Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body) };
  };
  const handler = require(ENTRY);
  return {
    handler, llm, net,
    restore() {
      global.fetch = realFetch; dns.lookup = realLookup; rn.transport = realTransport;
      for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
      for (const m of [ENTRY, CORE, EXTRACT, RENDER, NET, LLM, MOBILE]) delete require.cache[m];
    },
  };
}

async function callShipped(handler, { method, url, headers, body }) {
  const u = new URL(url, HOST);
  const out = { code: 0, body: null };
  const res = {
    statusCode: 200, setHeader() {}, getHeader() {}, removeHeader() {},
    status(c) { out.code = c; this.statusCode = c; return res; },
    json(b) { out.body = b; if (!out.code) out.code = 200; return res; },
    end() { if (!out.code) out.code = 200; return res; },
    send(b) { out.body = b; return res; },
  };
  const lower = {};
  for (const [k, v] of Object.entries(headers || {})) lower[String(k).toLowerCase()] = v;
  await handler({ method, url: u.pathname + u.search, headers: lower, query: Object.fromEntries(u.searchParams), body: body || {} }, res);
  return out;
}

async function openWizard(page, session, world) {
  const log = { dialogs: [], errors: [], extract: [] };
  page.on('dialog', (d) => { log.dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  await page.addInitScript((seed) => {
    window.supabase = {
      createClient: () => ({
        auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      }),
    };
    try {
      if (seed.session) { localStorage.setItem('lifecycle.auth.session', JSON.stringify(seed.session)); localStorage.setItem('lifecycle.auth.device.users', JSON.stringify(seed.users)); }
      else { localStorage.removeItem('lifecycle.auth.session'); localStorage.removeItem('lifecycle.auth.device.users'); }
    } catch (_) {}
  }, seedFor(session));
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.abort('addressunreachable');
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});' : 'window.tailwind=window.tailwind||{};' });
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
    const json = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (action === 'auth') {
      if (op === 'status') return json(PROD_STATUS);
      return json({ ok: false, error: 'no_database', mode: 'device', message: 'No database is configured on this deployment.' }, 503);
    }
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
  await page.waitForFunction(() => {
    const a = window.LifecycleAuth; const b = a && a.backend;
    if (!b || b.kind === 'pending') return false;
    const bc = window.BrandContext;
    if (!bc || !bc.loaded || !bc.storage || !bc.storage().known) return false;
    const rs = bc.storage().read_site;
    return !rs || rs.decided;
  }, null, { timeout: 20000 });
  await page.waitForSelector('#xRun');
  return log;
}

function seedFor(session) {
  if (session !== 'device') return { session: null };
  const expires = new Date(Date.now() + 80 * 86400000).toISOString();
  const users = {};
  users[DEVICE_USER.phone] = Object.assign({}, DEVICE_USER, { salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null, createdAt: expires, pinSetAt: expires });
  return {
    users,
    session: {
      token: DEVICE_TOKEN, mode: 'device', provider: 'mobile-pin',
      user: { id: DEVICE_USER.id, name: DEVICE_USER.name, phone: DEVICE_USER.phone }, expires,
      storage: { mode: 'device', reason: PROD_STATUS.reason, host: '', message: PROD_STATUS.message },
    },
  };
}

const tokensOnHtml = (page) => page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const g = (k) => cs.getPropertyValue(k).trim();
  return { primary: g('--brand-primary'), surface: g('--brand-surface'), ink: g('--brand-ink'), surfaceAlt: g('--brand-surface-alt'), head: g('--brand-font-head'), radius: g('--brand-radius-control'), radiusCard: g('--brand-radius-card') };
});

for (const session of ['none', 'device']) {
  test(`${session === 'none' ? 'no backend, signed out (production today)' : 'phone sign-in kept on this device'}: the rendered read is applied completely, scored, keeps what was typed, and reverts`, async ({ page }) => {
    test.setTimeout(170000);
    require(RENDER).resetRateLimits();
    const world = serverWorld();
    try {
      const log = await openWizard(page, session, world);
      // The operator types their own logo URL BEFORE the read.
      await page.fill('[data-path="logo_url"]', TYPED_LOGO);
      const before = await tokensOnHtml(page);
      await expect(async () => {
        await page.fill('#xUrl', SITE + '/');
        await page.click('#xRun', { timeout: 2000 });
        await expect(page.locator('.xr[data-read-method]')).toHaveCount(1, { timeout: 140000 });
      }).toPass({ timeout: 150000 });

      // The request and the path it took.
      expect(log.extract).toHaveLength(1);
      const sent = log.extract[0];
      expect(sent.code, JSON.stringify(sent.body).slice(0, 400)).toBe(200);
      expect(sent.body.read).toMatchObject({ method: 'rendered', renderer: 'chromium' });
      if (session === 'device') {
        expect(sent.headers['x-lifecycle-token'] || String(sent.headers.authorization || '').replace(/^Bearer /, '')).toBe(DEVICE_TOKEN);
        expect(sent.body.signed_out).toBeUndefined();
      } else {
        expect(sent.body.signed_out).toBe(true);
        expect(world.llm.calls, 'the open path reached a model').toBe(0);
      }

      // Applied to the SHELL: the tokens on <html> are the rendered values.
      const t = await tokensOnHtml(page);
      expect(t.primary).toBe('#0f5132');
      expect(t.surface).toBe('#f6faf7');
      expect(t.ink).toBe('#3a4a40');
      expect(t.surfaceAlt).toBe('#ffffff');
      expect(t.head).toContain('ui-sans-serif');
      expect(t.radius).toBe('8px');
      expect(t.radiusCard).toBe('12px');

      // The panel: rendered, applied, scored, with the side-by-side screenshots.
      const panel = page.locator('.xr[data-read-method="rendered"]');
      await expect(panel).toContainText('Rendered in Chromium and applied to this brand');
      const score = await panel.getAttribute('data-render-score');
      expect(Number(score)).toBeGreaterThanOrEqual(95);
      await expect(panel.locator('[data-score]')).toHaveText(`${score}%`);
      await expect(panel.locator('[data-surface="landing page"]')).toHaveCount(1);
      expect(await panel.locator('figure img').count()).toBeGreaterThanOrEqual(4);
      await expect(panel.locator('[data-components] tbody tr').first()).toBeVisible();
      // The typed field was KEPT, and said to be.
      await expect(panel.locator('[data-kept="logo_url"]')).toContainText('kept as you set it (you typed it)');
      await expect(page.locator('[data-path="logo_url"]')).toHaveValue(TYPED_LOGO);
      await expect(panel.locator('[data-applied]')).toContainText('Primary colour');
      await expect(panel.locator('[data-applied]')).toContainText('#0f5132');
      // The non-visual fields the same read found are applied too.
      await expect(page.locator('[data-path="name"]')).toHaveValue('Verdant Supply');
      await expect(panel.locator('[data-applied]')).toContainText('Brand name');
      // And it was SAVED, through the path this browser uses (the device store
      // here), with the measured design system on the record.
      const stored = await page.evaluate(() => {
        const raw = localStorage.getItem(window.BrandContext.device.key());
        const rows = raw ? (JSON.parse(raw).workspaces || []) : [];
        const w = rows.find((x) => x.name === 'Verdant Supply');
        return w ? { primary: w.palette && w.palette.primary, ds: !!(w.brand_data && w.brand_data.design_system && w.brand_data.design_system.version), origin: w.brand_data && w.brand_data.field_origin } : null;
      });
      expect(stored, 'the applied brand was not saved on the device').toBeTruthy();
      expect(stored.primary).toBe('#0f5132');
      expect(stored.ds).toBe(true);
      expect(stored.origin).toMatchObject({ 'palette.primary': 'site-render', logo_url: 'user', name: 'site-parse' });

      // Revert: every token back to the brand as it was before the read.
      await panel.locator('[data-xrevert]').click();
      await expect(page.locator('.xr h3')).toHaveText('Rendered, then reverted');
      const after = await tokensOnHtml(page);
      expect(after.primary.toLowerCase()).not.toBe('#0f5132');
      expect(after.radius).toBe('');
      await expect(page.locator('[data-path="logo_url"]')).toHaveValue(TYPED_LOGO);
      // The wizard's default palette came back, exactly.
      expect(after.primary.toLowerCase()).toBe('#1f5fd0');
      expect(before).toBeTruthy();

      expect(log.dialogs, 'a native dialog opened').toEqual([]);
      expect(log.errors, 'a page error was thrown').toEqual([]);
      expect(world.net.escaped, 'a request left the test world').toEqual([]);
      expect(world.net.browser.some((u) => /\/app\.css$/.test(u)), 'the browser did not read the site').toBe(true);
    } finally { world.restore(); }
  });
}
