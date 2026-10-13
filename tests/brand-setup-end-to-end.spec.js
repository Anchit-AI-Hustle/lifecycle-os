/**
 * Brand setup, end to end, as the operator sees it (2026-10-13).
 * ---------------------------------------------------------------------------
 * The operator: "check the entire repo and test each step of it to ensure
 * correct final output with live simulation of ongoing step for user
 * transparency - ensure appropriate humanly engaging content usage".
 *
 * One signed-in owner with NO brand opens /onboarding, types the website and
 * presses "Set up from my website". Everything below the page is the SHIPPED
 * code: the rendered reader (real Chromium) over a fixture site, the brand
 * router over tests/lib/brand-save-fake.js, the catalogue importer over the
 * same site. Only the context pack's GitHub search is answered canned.
 *
 * Asserted, in the order the operator lives it:
 *   1. every step is shown WORKING while it works (a live row that says what
 *      it is doing and for how long), then done, in the wizard's order;
 *   2. the words are a person's: no raw marker, no code, no "page(s)";
 *   3. the final output is correct: the record is SAVED with the name, colours,
 *      type and logo the site renders, the catalogue is imported under the
 *      home market, the page wears the brand's own tokens, and the run lands
 *      on Review with the brand activatable;
 *   4. no dialog, no page error.
 * ---------------------------------------------------------------------------
 */
const { test, expect } = require('@playwright/test');
delete process.env.BRAND_RENDER;
const fs = require('fs');
const path = require('path');
const sites = require('./lib/rendered-sites.js');
const { makeReq, makeRes, BASE, ANON_KEY, SERVICE_KEY } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = require.resolve('../api/public-config.js');
const CORE = require.resolve('../api/_shared/brand-workspace-core.js');
const EXTRACT = require.resolve('../api/_shared/brand-extract.js');
const RENDER = require.resolve('../api/_shared/brand-render.js');
const NET = require.resolve('../api/_shared/render-net.js');
const LLM = require.resolve('../api/_shared/llm.js');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const HOST = 'http://127.0.0.1:9';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.owner.sig';
const OWNER = 'aaaaaaaa-0000-4000-8000-0000000000e2';
const SITE = 'https://verdant.example';
const ROUTES = Object.assign({}, sites.siteRoutes('a'));
// The site states where the company is: its legal address, as structured data
// (a strong home-market signal; the brand sells in India).
ROUTES['/'] = Object.assign({}, ROUTES['/'], { body: String(ROUTES['/'].body).replace('</head>', '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Verdant Supply","legalName":"Verdant Supply Private Limited","address":{"@type":"PostalAddress","addressLocality":"Pune","addressCountry":"IN"}}</script></head>') });
// The store's own product feed (the one feed the importer calls), then an empty page.
const PRODUCTS = ['Fern', 'Monstera', 'Pothos'].map((t, i) => ({
  id: 100 + i, title: t, handle: t.toLowerCase(), product_type: 'Plant', vendor: 'Verdant Supply',
  images: [{ src: SITE + '/p' + i + '.svg' }], variants: [{ id: 900 + i, sku: 'VS-' + i, price: String(20 + i) + '.00', available: true }],
}));
const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'BRAND_RENDER', 'CRON_SECRET', 'SELF_BASE_URL', 'VERCEL_URL'];

function world() {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  for (const m of [ENTRY, CORE, EXTRACT, RENDER, NET, LLM]) delete require.cache[m];
  const llm = async function callLLM() { return { text: '{"tone":"Calm, practical and warm","why":"fixture"}', provider: 'fixture', model: 'none' }; };
  llm.parseJSON = (t) => JSON.parse(t);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: llm };
  const db = require('./lib/brand-save-fake.js').makeDb(TOKEN, OWNER);
  // brand_catalog_merge(), reduced to its contract (supabase/migrations/
  // 20261010002000_catalog_import_merge.sql): upsert by (workspace, region,
  // handle, sku), record the run's state and source on the workspace row.
  db.rpc.brand_catalog_merge = (a) => {
    const t = db.table('brand_catalog_products');
    let inserted = 0, updated = 0;
    for (const r of a.p_rows || []) {
      const key = (x) => [x.workspace_id, x.region, x.handle || null, x.sku || null].join('|');
      const row = Object.assign({}, r, { workspace_id: a.p_workspace, region: a.p_region, last_seen_run: a.p_run, stale_at: null });
      const have = t.find((x) => key(x) === key(row));
      if (have) { Object.assign(have, row); updated += 1; } else { t.push(Object.assign({ id: 'p' + t.length, created_at: new Date().toISOString() }, row)); inserted += 1; }
    }
    const ws = db.table('brand_workspaces').find((w) => w.id === a.p_workspace);
    if (ws && a.p_state) ws.catalog_import = a.p_state;
    if (ws && a.p_source) ws.catalog_source = a.p_source;
    return { inserted, updated, staled: 0, live: t.filter((x) => x.workspace_id === a.p_workspace && !x.stale_at).length };
  };
  db.install();
  process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  const dns = require('dns').promises;
  const realLookup = dns.lookup;
  dns.lookup = async (h, o) => (String(h).endsWith('.example') ? [{ address: '93.184.216.34', family: 4 }] : realLookup(h, o));
  const dbFetch = global.fetch;
  global.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.origin === SITE) {
      if (u.pathname === '/products.json') {
        const page = +(u.searchParams.get('page') || 1);
        const body = JSON.stringify({ products: page === 1 ? PRODUCTS : [] });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const r = ROUTES[u.pathname];
      if (!r) return new Response('nf', { status: 404, headers: { 'content-type': 'text/plain' } });
      return new Response(r.body, { status: r.status || 200, headers: { 'content-type': r.type } });
    }
    return dbFetch(url, init);
  };
  const rn = require(NET);
  const realTransport = rn.transport;
  rn.transport = async (url) => {
    const u = new URL(url);
    if (u.origin !== SITE) return { error: 'not in the test world' };
    const r = ROUTES[u.pathname];
    if (!r) return { status: 404, headers: { 'content-type': 'text/plain' }, body: Buffer.from('nf') };
    return { status: r.status || 200, headers: Object.assign({ 'content-type': r.type }, r.headers || {}), body: Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body) };
  };
  const handler = require(ENTRY);
  const core = require(CORE);
  return {
    db, handler, core,
    restore() {
      global.fetch = dbFetch; db.restore(); dns.lookup = realLookup; rn.transport = realTransport;
      for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      for (const m of [ENTRY, CORE, EXTRACT, RENDER, NET, LLM]) delete require.cache[m];
    },
  };
}

async function wire(page, w, log) {
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  await page.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
  });
  await page.route((u) => !String(u).startsWith(HOST), (route) => {
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});' : 'window.tailwind=window.tailwind||{};' });
  });
  await page.route(HOST + '/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname.startsWith('/api/')) {
      const action = u.searchParams.get('action') || '', op = u.searchParams.get('op') || '';
      if (!action) return json({ ok: true });
      if (action === 'auth') return op === 'status' ? json({ ok: true, mode: 'google' }) : json({ ok: false }, 401);
      if (action !== 'brand') return json({ ok: true, features: [], packs: [] });
      let body = {};
      try { body = req.postDataJSON() || {}; } catch (_) { body = {}; }
      log.ops.push(op);
      if (op === 'context-build') return json({ ok: true, done: true, pack: { site_url: SITE, stage: 'done' } });
      if (op === 'context-pack') return json({ ok: true, pack: { site_url: SITE, stage: 'done' }, current: true });
      const r = makeReq({ token: TOKEN, query: Object.fromEntries(u.searchParams), body: req.method() === 'POST' ? body : undefined, method: req.method() });
      const res = makeRes();
      await (op === 'extract' ? w.handler(r, res) : w.core.handle(r, res));
      if (op === 'extract') log.extract = res.payload;
      return json(res.payload, res.code || 200);
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
}

/** Press "Set up from my website" on a brand-new account and record every row the operator sees. */
async function runSetup(page, w, log) {
  await wire(page, w, log);
  await page.goto(HOST + '/onboarding.html?step=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#xSetup', { timeout: 20000 });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded, null, { timeout: 20000 });
  await page.evaluate(() => {
    window.__rows = [];
    new MutationObserver(() => {
      document.querySelectorAll('[data-setup-log] li[data-setup-step]').forEach((li) => {
        const rec = [li.getAttribute('data-setup-step'), li.getAttribute('data-state'), (li.querySelector('.srun-text') || {}).textContent || '', (li.querySelector('[data-setup-live]') || {}).textContent || ''];
        const last = window.__rows.filter((r) => r[0] === rec[0]).pop();
        if (!last || last.join('|') !== rec.join('|')) window.__rows.push(rec);
      });
    }).observe(document.getElementById('setupRun'), { childList: true, subtree: true, attributes: true, characterData: true });
  });
  await page.fill('#xUrl', SITE);
  // Opt-in evidence: SETUP_SHOTS=<dir> SETUP_SHOT_W=<width> captures the run mid-way and at the end.
  const shots = process.env.SETUP_SHOTS, sw = Number(process.env.SETUP_SHOT_W || 0);
  if (shots && sw) await page.setViewportSize({ width: sw, height: sw < 600 ? 844 : 1000 });
  await page.click('#xSetup');
  if (shots && sw) {
    await page.waitForSelector('[data-setup-log] li[data-setup-step="catalog"][data-state="running"]', { timeout: 60000 }).catch(() => {});
    await page.locator('#setupRun').screenshot({ path: path.join(shots, `setup-running-${sw}.png`) }).catch(() => {});
  }
  await page.waitForFunction(() => {
    const run = document.querySelector('[data-setup-run]');
    const review = document.querySelector('[data-setup-log] li[data-setup-step="review"]');
    return run && !run.hasAttribute('aria-busy') && review && review.getAttribute('data-state') !== 'running';
  }, null, { timeout: 200000 });
  await page.waitForFunction(() => /[?&]step=6\b/.test(location.search), null, { timeout: 15000 });
  if (shots && sw) await page.screenshot({ path: path.join(shots, `setup-done-${sw}.png`), fullPage: false });
  const rows = await page.evaluate(() => window.__rows);
  const final = await page.$$eval('[data-setup-log] li', (els) => els.map((e) => [e.getAttribute('data-setup-step'), e.getAttribute('data-state'), e.querySelector('.srun-text').textContent]));
  return { rows, final, say: JSON.stringify(final, null, 1) };
}

/** What every run must hold: live rows, in the wizard's order, in a person's words. */
function liveAndPlain({ rows, final, say }) {
  for (const step of ['brand', 'catalog', 'pack', 'review']) {
    const running = rows.filter((r) => r[0] === step && r[1] === 'running');
    expect(running.length, `${step} was never shown working\n${say}`).toBeGreaterThan(0);
    expect(running.some((r) => /\d+ s|just started/.test(r[3])), `${step} showed no live detail while working\n${JSON.stringify(running)}`).toBe(true);
  }
  expect(final.map((r) => r[0]), say).toEqual(['brand', 'colour', 'type', 'voice', 'catalog', 'pack', 'review']);
  for (const [step, , words] of final) {
    expect(words, `${step}: a launch marker shown to the operator`).not.toMatch(/DATA REQUIRED BEFORE LAUNCH/);
    expect(words, `${step}: a unit written for a machine`).not.toMatch(/\(s\)/);
    expect(words, `${step}: code shown to the operator`).not.toMatch(/[{}<>]|_[a-z]+_|\bnull\b|undefined|rpc\//);
  }
}

test('a new owner sets a brand up from its website: every step shown live, in plain words, ending on a correct, saved, ACTIVE brand', async ({ page }) => {
  test.setTimeout(240000);
  if (require(RENDER).resetRateLimits) require(RENDER).resetRateLimits();
  const w = world();
  const log = { dialogs: [], errors: [], ops: [], extract: null };
  try {
    const run = await runSetup(page, w, log);
    liveAndPlain(run);
    // The rendered read applies; nothing is left for the person on the four read steps or the catalogue.
    expect(run.final.filter((r) => ['brand', 'colour', 'type', 'catalog', 'pack'].includes(r[0])).map((r) => r[0] + ':' + r[1]), run.say)
      .toEqual(['brand:done', 'colour:done', 'type:done', 'catalog:done', 'pack:done']);
    const ws = w.db.table('brand_workspaces').filter((r) => r.owner_id === OWNER);
    expect(ws.length, 'no brand was saved').toBe(1);
    const rec = ws[0];
    expect(rec.name).toBe('Verdant Supply');
    expect(rec.website).toMatch(/^https:\/\/verdant\.example/);
    const measured = log.extract.rendered.apply['palette.primary'];
    expect(measured && measured.value, 'the read measured no primary').toMatch(/^#[0-9a-f]{6}$/i);
    expect(String(rec.palette.primary).toLowerCase()).toBe(String(measured.value).toLowerCase());
    expect(rec.logo_url, 'the logo the site renders was not kept').toMatch(/verdant\.example\/logo\.svg/);
    expect((rec.regions || []).filter((r) => r.home).map((r) => r.code), 'the home market the site states').toEqual(['IN']);
    const products = w.db.table('brand_catalog_products').filter((r) => r.workspace_id === rec.id && !r.stale_at);
    expect(products.map((r) => r.title).sort(), 'the catalogue was not imported').toEqual(['Fern', 'Monstera', 'Pothos']);
    expect(products.every((r) => String(r.region).toUpperCase() === 'IN'), 'products not filed under the home market').toBe(true);
    const token = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim().toLowerCase());
    expect(token).toBe(String(rec.palette.primary).toLowerCase());
    // Activate: the brand goes live.
    await page.click('#activate');
    await expect.poll(() => (w.db.table('brand_workspaces').find((r) => r.id === rec.id) || {}).status, { timeout: 15000 }).toBe('active');
    await expect.poll(() => (w.db.table('brand_user_prefs').find((r) => r.user_id === OWNER) || {}).active_workspace_id, { timeout: 15000 }).toBe(rec.id);
    expect(log.dialogs).toEqual([]);
    expect(log.errors).toEqual([]);
  } finally {
    w.restore();
  }
});

test('a site that will not let the browser in: the setup still ends on a saved brand, taking what the stylesheet declares for empty fields', async ({ page }) => {
  test.setTimeout(240000);
  const w = world();
  process.env.BRAND_RENDER = 'off';
  const log = { dialogs: [], errors: [], ops: [], extract: null };
  try {
    const run = await runSetup(page, w, log);
    liveAndPlain(run);
    expect(log.extract.read && log.extract.read.method, 'this case is the parsed read').toBe('parsed');
    const rec = w.db.table('brand_workspaces').filter((r) => r.owner_id === OWNER)[0];
    expect(rec && rec.name, `no brand was saved\n${run.say}`).toBe('Verdant Supply');
    const proposed = (log.extract.fields.palette && log.extract.fields.palette.proposed) || {};
    const colour = run.final.find((r) => r[0] === 'colour');
    if (proposed.primary && !(log.extract.fields.palette.conflicts || []).length) {
      expect(colour[1], run.say).toBe('done');
      expect(String(rec.palette.primary).toLowerCase()).toBe(String(proposed.primary).toLowerCase());
      const origin = ((rec.brand_data || {}).field_origins || {})['palette.primary'];
      expect(origin && (origin.origin || origin), 'the adopted colour is not recorded as read from the site').toMatch(/site-parse/);
    } else {
      expect(colour[1], run.say).toBe('needs-you');
    }
    expect(run.final.find((r) => r[0] === 'review')[1], run.say).not.toBe('failed');
    // The home market the site states is taken into the empty list, so the
    // catalogue has a market and the run brings the products in.
    expect((rec.regions || []).filter((r) => r.home).map((r) => r.code), run.say).toEqual(['IN']);
    expect(run.final.find((r) => r[0] === 'catalog')[1], run.say).toBe('done');
    expect(w.db.table('brand_catalog_products').filter((r) => r.workspace_id === rec.id).length, 'the catalogue was not imported').toBe(3);
    expect(log.errors).toEqual([]);
  } finally {
    w.restore();
  }
});
