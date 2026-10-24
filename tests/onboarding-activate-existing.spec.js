/**
 * Activate on Review when the account already holds this brand (2026-10-24).
 * ---------------------------------------------------------------------------
 * Production, /onboarding?new=1&step=6 with the Economic Times template: the
 * account already had a record for economictimes.indiatimes.com, so every save
 * the wizard made on the way was refused "brand_exists" (one brand has one
 * record) - silently. Review said "Save this brand first" under the context
 * pack, and Activate showed a toast that went away with nothing to press.
 *
 * Driven here through the SHIPPED brand router over tests/lib/brand-save-fake.js
 * and the real wizard in Chromium:
 *   - the review says the brand is already in the account and names it,
 *     with a link to open it;
 *   - Activate reads "Open and activate <name>" and makes THAT record live
 *     (status active, the account's active brand), creating no second record
 *     and changing nothing else on it;
 *   - a brand that is NOT already in the account activates as before.
 * Mutation-checked: restoring the toast-only Activate fails the first test.
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


const ET = require('../data/brands/presets/economic-times.json');

async function toReview(page, w, log) {
  await wire(page, w, log);
  await page.goto(HOST + '/onboarding.html?new=1&step=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded, null, { timeout: 20000 });
  await page.waitForSelector('[data-preset="economic-times"]', { timeout: 20000 });
  await page.click('[data-preset="economic-times"]');
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector('[data-go="next"]', { timeout: 15000 });
    await page.click('[data-go="next"]');
  }
  await page.waitForSelector('#activate', { timeout: 20000 });
}

test('the brand is already in the account: Review says so and Activate opens and activates THAT record', async ({ page }) => {
  test.setTimeout(120000);
  const w = world();
  const log = { dialogs: [], errors: [], ops: [], extract: null };
  try {
    w.db.table('brand_workspaces').push({
      id: 'ws-et-old', owner_id: OWNER, name: 'The Economic Times', slug: 'the-economic-times',
      website: 'https://economictimes.indiatimes.com', status: 'draft', tagline: 'Kept as it was',
      palette: ET.palette, typography: ET.typography || {}, voice: {}, regions: ET.regions, brand_data: {},
    });
    await toReview(page, w, log);
    const note = page.locator('[data-brand-exists="ws-et-old"]');
    await expect(note, 'Review did not say the brand is already in the account').toBeVisible({ timeout: 15000 });
    await expect(note).toContainText('The Economic Times');
    await expect(note.locator('a[data-open-existing]')).toHaveAttribute('href', '/onboarding?id=ws-et-old&step=6');
    await expect(page.locator('#activate')).toHaveText('Open and activate The Economic Times');
    await expect(page.locator('body')).not.toContainText('Save this brand first');
    await page.click('#activate');
    await expect.poll(() => (w.db.table('brand_user_prefs').find((r) => r.user_id === OWNER) || {}).active_workspace_id, { timeout: 15000 }).toBe('ws-et-old');
    const rows = w.db.table('brand_workspaces').filter((r) => r.owner_id === OWNER);
    expect(rows.map((r) => r.id), 'a second record of the same brand was created').toEqual(['ws-et-old']);
    expect(rows[0].status).toBe('active');
    expect(rows[0].tagline, 'the existing record was overwritten by the template').toBe('Kept as it was');
    await page.waitForURL((u) => u.pathname === '/' || u.pathname === '/index.html', { timeout: 15000 });
    expect(log.dialogs).toEqual([]);
    expect(log.errors).toEqual([]);
  } finally { w.restore(); }
});

test('a brand that is not in the account yet activates from the template as before', async ({ page }) => {
  test.setTimeout(120000);
  const w = world();
  const log = { dialogs: [], errors: [], ops: [], extract: null };
  try {
    await toReview(page, w, log);
    await expect(page.locator('[data-brand-exists]')).toHaveCount(0);
    await page.click('#activate');
    await expect.poll(() => w.db.table('brand_workspaces').filter((r) => r.owner_id === OWNER).map((r) => r.name + ':' + r.status).join(','), { timeout: 15000 }).toBe('The Economic Times:active');
    const id = w.db.table('brand_workspaces').find((r) => r.owner_id === OWNER).id;
    await expect.poll(() => (w.db.table('brand_user_prefs').find((r) => r.user_id === OWNER) || {}).active_workspace_id, { timeout: 15000 }).toBe(id);
    expect(log.errors).toEqual([]);
  } finally { w.restore(); }
});
