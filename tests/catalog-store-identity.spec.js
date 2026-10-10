/**
 * A catalogue import reads THIS brand's store, says where it read, and never
 * resumes another brand's (2026-10-10).
 * ---------------------------------------------------------------------------
 * Measured on production's database: the only workspace, "DelhiChic", website
 * https://delichic.co.in, had ONE region (IN) whose store_url was
 * https://www.nike.in, and Nike's hosts in asset_hosts. The import took "the IN
 * store URL on the brand's own record", read nike.in and filed 734 of Nike's
 * products under DelhiChic - while catalog_source.url said
 * https://delichic.co.in. The coherence rule only WARNED on the store and the
 * hosts. Then the operator corrected the store to delichic.co.in on screen,
 * typed delichic.co.in into the import box and pressed Import: the coverage
 * still said "read from https://www.nike.in ... at URL 439 of 2430", because
 * the import read the SAVED regions and Continue resumed nike.in's cursor; and
 * "612 products in this workspace" counted Nike's rows as the brand's.
 *
 * Every case here runs the SHIPPED code: the coherence rule, importCatalog over
 * a fake project (tests/lib/fake-supabase.js + the merge from
 * tests/lib/catalog-merge-fake.js), deviceCatalogImport, the daily refresh,
 * productTally and core.handle, brand-catalog-server's resolve, and the wizard
 * in Chromium over core.handle. The stores are answered in-process; a request
 * to nike.in is RECORDED, so "nothing was read from it" is a measurement.
 *
 * Run: npx playwright test tests/catalog-store-identity.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const dns = require('dns');

const ROOT = path.resolve(__dirname, '..');
const COH = require('../api/_shared/brand-coherence.js');
const core = require('../api/_shared/brand-workspace-core.js');
const imp = require('../api/_shared/catalog-import.js');
const bcs = require('../api/_shared/brand-catalog-server.js');
const { FakeSupabase, makeReq, makeRes, BASE, ANON_KEY, SERVICE_KEY } = require('./lib/fake-supabase.js');
const { installMerge } = require('./lib/catalog-merge-fake.js');
const { makeDb } = require('./lib/brand-save-fake.js');
const LIVE = require('./fixtures/live-delhichic.js');
const { startStores } = require('./lib/catalog-fixture-stores.js');

test.describe.configure({ mode: 'serial' });

const clone = (o) => JSON.parse(JSON.stringify(o));
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.owner.sig';
const OWNER = 'aaaaaaaa-0000-4000-8000-0000000000d1';
const WS = LIVE.record.id;
const PHONE = { ok: true, provider: 'mobile-pin', mode: 'device', user_id: 'device:abc', token: 'MPINtokenFIXTURE0123456789abcdefghijklmnopqrs' };
const said = (cov) => (cov && cov.sentences ? cov.sentences.join(' ') : '');

/* ── two stores, answered in-process; every request recorded per host ───── */
const SHOP_HEAD = (cur) => `<meta name="generator" content="Shopify"><script>var Shopify = Shopify || {}; Shopify.shop = "x.myshopify.com"; Shopify.currency = {"active":"${cur}","rate":"1.0"};</script>`;
function feedProduct(host, i, word) {
  const handle = `${word}-${i}`;
  return {
    id: 100 + i, title: `${word[0].toUpperCase()}${word.slice(1)} ${i}`, handle, body_html: `<p>${word} ${i}</p>`, product_type: word, tags: [],
    variants: [{ id: 900 + i, title: 'Default', sku: `${word.toUpperCase()}-${i}`, available: true, price: (100 + i).toFixed(2), compare_at_price: null }],
    images: [{ id: 500 + i, position: 1, src: `https://${host}/cdn/shop/files/${handle}.jpg` }],
  };
}
const STORES = {
  'delichic.co.in': { word: 'salami', count: 3 },
  'shop.delichic.co.in': { word: 'sausage', count: 2 },
  'nike.in': { word: 'shoe', count: 5 },
};
const hits = {};
function storeFor(host) { return STORES[host.replace(/^www\./, '')] || null; }
function answer(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  (hits[host] = hits[host] || []).push(u.pathname + u.search);
  const s = storeFor(u.hostname);
  const out = (status, type, body) => { const r = new Response(body, { status, headers: { 'content-type': type } }); Object.defineProperty(r, 'url', { value: url }); return r; };
  if (!s) return out(404, 'text/html', 'nf');
  if (u.pathname === '/robots.txt') return out(200, 'text/plain', 'User-agent: *\nDisallow: /cart\n');
  if (u.pathname === '/products.json') {
    const page = Number(u.searchParams.get('page') || 1);
    const list = page === 1 ? Array.from({ length: s.count }, (_, i) => feedProduct(u.hostname, i + 1, s.word)) : [];
    return out(200, 'application/json', JSON.stringify({ products: list }));
  }
  if (u.pathname === '/' || u.pathname === '') return out(200, 'text/html; charset=utf-8', `<!doctype html><html><head><title>${host}</title>${SHOP_HEAD('INR')}${s.hreflang ? `<link rel="alternate" hreflang="en-in" href="${s.hreflang}">` : ''}</head><body class="shopify-section"></body></html>`);
  return out(404, 'text/html', 'nf');
}
const isStore = (url) => { try { return !!storeFor(new URL(String(url)).hostname); } catch (_) { return false; } };
const hitCount = (host) => (hits[host] || []).length;
function resetHits() { for (const k of Object.keys(hits)) delete hits[k]; }

let realLookup = null;
function stubDns() {
  if (realLookup) return;
  realLookup = dns.promises.lookup;
  dns.promises.lookup = async (host, opts) => (storeFor(String(host)) || /\.example$/i.test(String(host))
    ? ((opts && opts.all) ? [{ address: '93.184.216.34', family: 4 }] : { address: '93.184.216.34', family: 4 })
    : realLookup(host, opts));
}
function unstubDns() { if (realLookup) dns.promises.lookup = realLookup; realLookup = null; }

const ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'BRAND_RENDER'];
/** The live record in a fake project, owned by OWNER, Nike's rows beside it. */
function world({ db: given, rows = true } = {}) {
  resetHits();
  const saved = {};
  for (const k of ENV) saved[k] = process.env[k];
  process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.BRAND_RENDER = 'off';
  const db = given || new FakeSupabase();
  if (!given) db.addUser(TOKEN, OWNER, 'owner@example.test');
  const rec = clone(LIVE.record);
  db.addWorkspace(WS, OWNER, Object.assign(rec, { updated_at: '2026-10-10T21:49:01.312Z' }));
  db.syncIdentityTables && db.syncIdentityTables();
  if (rows) for (const r of LIVE.PRODUCT_ROWS) db.insert('brand_catalog_products', Object.assign({ workspace_id: WS, stale_at: null, last_seen_run: rec.catalog_import.run }, r));
  installMerge(db);
  db.route(isStore, (u) => answer(u));
  db.install();
  stubDns();
  bcs.invalidate();
  return {
    db, auth: { ok: true, token: TOKEN, user_id: OWNER },
    wsRow: () => db.table('brand_workspaces').find((w) => w.id === WS),
    rows: () => db.table('brand_catalog_products').filter((r) => r.workspace_id === WS),
    restore() {
      db.restore(); unstubDns();
      for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      bcs.invalidate();
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. The rule: a store on another site is an IDENTITY conflict
   ═══════════════════════════════════════════════════════════════════════════ */

test('the live record: its nike.in store and Nike\'s hosts BLOCK, its rows from nike.in are excluded for generation', () => {
  const c = COH.brandCoherence(LIVE.record);
  const byId = Object.fromEntries(c.conflicts.map((x) => [x.id, x]));
  expect(byId['cross_domain:regions:nike.in'], 'the IN store on nike.in is not reported').toBeTruthy();
  expect(byId['cross_domain:regions:nike.in'].severity).toBe('block');
  expect(byId['cross_domain:regions:nike.in'].message).toContain('https://www.nike.in');
  expect(byId['cross_domain:regions:nike.in'].message).toContain('delichic.co.in');
  expect(byId['cross_domain:asset_hosts:nike.com'].severity).toBe('block');
  expect(byId['cross_domain:asset_hosts:nike.in'].severity).toBe('block');
  expect(c.blocking).toBe(true);
  // The summary names the foreign sites, never the brand's own as "foreign".
  expect(c.summary).not.toMatch(/delichic\.co\.in, not delichic/);

  // Generation: the catalogue recorded as delichic.co.in is not excluded
  // whole, but every row from nike.in is (judged by its own page).
  const v = COH.catalogIdentity(LIVE.record);
  expect(v.allowed).toEqual(['delichic.co.in']);
  for (const r of LIVE.PRODUCT_ROWS) expect(COH.catalogRowForeign(r, v), r.product_url).toBe(true);
  expect(COH.catalogRowForeign({ product_url: 'https://delichic.co.in/products/salami-1' }, v)).toBe(false);
});

test('an asset host on a brand CDN under another name (no foreign store beside it) still only warns', () => {
  const rec = { name: 'Lumen Coffee', website: 'https://www.lumencoffee.com', regions: [{ code: 'US', store_url: 'https://www.lumencoffee.com' }], asset_hosts: ['lumen-cdn.net'], brand_data: {} };
  const c = COH.brandCoherence(rec);
  const x = c.conflicts.find((y) => y.field === 'asset_hosts');
  expect(x && x.severity).toBe('warn');
  expect(c.blocking).toBe(false);
});

test('the browser\'s copy of the rule answers the live record exactly as the server does', async ({ page }) => {
  const src = fs.readFileSync(path.join(ROOT, 'brand-context.js'), 'utf8');
  const B = '/* BRAND-COHERENCE:BEGIN */', E = '/* BRAND-COHERENCE:END */';
  const block = src.slice(src.indexOf(B), src.indexOf(E) + E.length);
  await page.setContent('<!doctype html><title>x</title>');
  await page.addScriptTag({ content: block + '\nwindow.__C = COHERENCE;' });
  const web = await page.evaluate((r) => window.__C.brandCoherence(r), LIVE.record);
  expect(web).toEqual(JSON.parse(JSON.stringify(COH.brandCoherence(LIVE.record))));
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. The import: the brand's own site, and the base it actually read
   ═══════════════════════════════════════════════════════════════════════════ */

test('a fresh import on the live record reads delichic.co.in, sends nothing to nike.in, and says why in a sentence', async () => {
  const w = world();
  try {
    const out = await core.importCatalog(w.auth, { workspace_id: WS, region: 'in', kind: 'storefront', url: 'https://delichic.co.in' });
    expect(hitCount('nike.in'), 'a request went to nike.in: ' + JSON.stringify(hits['nike.in'])).toBe(0);
    expect(hitCount('delichic.co.in')).toBeGreaterThan(0);
    expect(out.imported).toBe(3);
    const fresh = w.rows().filter((r) => /delichic\.co\.in/.test(r.product_url || ''));
    expect(fresh).toHaveLength(3);
    expect(said(out.coverage)).toContain('read from https://delichic.co.in (the URL given)');
    expect(said(out.coverage)).toContain('The IN store URL on this brand\'s record, https://www.nike.in, is on another site (nike.in), not this brand\'s website (delichic.co.in), so it was not read');
    expect(w.wsRow().catalog_source.url).toBe('https://delichic.co.in');
    expect(w.wsRow().catalog_source.coverage.base).toBe('https://delichic.co.in');
    // The run read the brand's whole store, so Nike's rows (not listed there)
    // are marked stale: kept, never used. What is live is the brand's own.
    expect(out.complete).toBe(true);
    expect(w.rows().filter((r) => /nike\.in/.test(r.product_url || '')).every((r) => r.stale_at)).toBe(true);
    expect(out.own).toBe(3);
    expect(out.excluded).toBe(0);
  } finally { w.restore(); }
});

test('catalog_source.url records the store ACTUALLY read when it is not the URL asked for', async () => {
  const st = await startStores();
  st.reset(); st.install();
  try {
    const regions = [{ code: 'US', home: true, store_url: 'https://regional.example' }, { code: 'UK', store_url: 'https://regional.example/en-gb' }];
    const uk = await core.importCatalog(PHONE, { region: 'uk', kind: 'storefront', url: 'https://regional.example', brand: { website: 'https://regional.example', regions } });
    expect(uk.coverage.base).toBe('https://regional.example/en-gb');
    expect(uk.source.url, 'the source names the URL asked for, not the store read').toBe('https://regional.example/en-gb');
  } finally { st.restore(); await st.close(); }
});

test('the URL in the import box is the source: a typed store replaces the record\'s store_url', async () => {
  const w = world({ rows: false });
  try {
    // The record's IN store is made the brand's own (shop.delichic.co.in); the
    // person typed delichic.co.in itself... the website, so the record's store
    // is read. Typing ANOTHER store than the website reads that store.
    w.wsRow().regions = [{ code: 'IN', home: true, store_url: 'https://shop.delichic.co.in' }];
    w.wsRow().asset_hosts = [];
    const viaRecord = await core.importCatalog(w.auth, { workspace_id: WS, region: 'in', kind: 'storefront', url: 'https://delichic.co.in' });
    expect(viaRecord.coverage.base).toBe('https://shop.delichic.co.in');
    w.wsRow().website = 'https://shop.delichic.co.in';
    resetHits();
    const typed = await core.importCatalog(w.auth, { workspace_id: WS, region: 'in', kind: 'storefront', url: 'https://delichic.co.in' });
    expect(typed.coverage.base, said(typed.coverage)).toBe('https://delichic.co.in');
    expect(hitCount('shop.delichic.co.in')).toBe(0);
  } finally { w.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Continue import never resumes another source
   ═══════════════════════════════════════════════════════════════════════════ */

for (const withUrl of [true, false]) {
  test(`Continue import on the live record (${withUrl ? 'the box says delichic.co.in' : 'no URL sent'}) discards nike.in's cursor and reads the brand's own site`, async () => {
    const w = world();
    try {
      const out = await core.importCatalog(w.auth, Object.assign({ workspace_id: WS, region: 'in', continue: true }, withUrl ? { url: 'https://delichic.co.in' } : {}));
      expect(hitCount('nike.in'), 'the nike.in cursor was resumed: ' + JSON.stringify(hits['nike.in'])).toBe(0);
      expect(out.coverage.base).toBe('https://delichic.co.in');
      expect(said(out.coverage)).toContain('The unfinished import was not continued: it was reading https://www.nike.in, which is on another site (nike.in), not this brand\'s website (delichic.co.in). This import reads https://delichic.co.in from the beginning.');
      expect(w.wsRow().catalog_import.url).toBe('https://delichic.co.in');
      expect(w.wsRow().catalog_import.base).toBe('https://delichic.co.in');
    } finally { w.restore(); }
  });
}

test('Continue import with a URL other than the one the cursor was reading starts again from that URL', async () => {
  const w = world({ rows: false });
  try {
    const ws = w.wsRow();
    ws.regions = [{ code: 'IN', home: true }];
    ws.asset_hosts = [];
    ws.catalog_import = clone(ws.catalog_import);
    Object.assign(ws.catalog_import.cursor, { start: 'https://shop.delichic.co.in', base: 'https://shop.delichic.co.in', pending: ['https://shop.delichic.co.in/products/sausage-9'] });
    ws.catalog_import.url = 'https://shop.delichic.co.in';
    const out = await core.importCatalog(w.auth, { workspace_id: WS, region: 'in', continue: true, url: 'https://delichic.co.in' });
    expect(hitCount('shop.delichic.co.in'), 'the old cursor was resumed').toBe(0);
    expect(out.coverage.base).toBe('https://delichic.co.in');
    expect(said(out.coverage)).toContain('it was reading https://shop.delichic.co.in, and this import asks for https://delichic.co.in');
  } finally { w.restore(); }
});

test('the device path: a kept nike.in cursor is discarded, the brand\'s own site is read, and the source names it', async () => {
  resetHits();
  const saved = global.fetch;
  global.fetch = async (u) => { if (isStore(u)) return answer(String(u)); throw new Error('escaped: ' + u); };
  stubDns();
  try {
    const out = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://delichic.co.in', brand: clone(LIVE.record), cursor: clone(LIVE.record.catalog_import.cursor) });
    expect(hitCount('nike.in')).toBe(0);
    expect(out.products.map((p) => p.product_url).every((u) => /delichic\.co\.in/.test(u))).toBe(true);
    expect(out.source.url).toBe('https://delichic.co.in');
    expect(said(out.coverage)).toContain('which is on another site (nike.in)');
  } finally { global.fetch = saved; unstubDns(); }
});

test('the daily refresh continues the live record from the brand\'s own site, never nike.in', async () => {
  const w = world();
  try {
    const out = await imp.refreshDue({ maxWorkspaces: 1, budgetMs: 20000 });
    expect(out.refreshed[0] && out.refreshed[0].error, JSON.stringify(out)).toBeFalsy();
    expect(hitCount('nike.in'), 'the refresh read nike.in').toBe(0);
    expect(w.wsRow().catalog_source.url).toBe('https://delichic.co.in');
  } finally { w.restore(); }
});

test('the daily refresh of a catalogue recorded as read from another site reads the brand\'s own site instead', async () => {
  const w = world();
  try {
    const ws = w.wsRow();
    ws.catalog_import = {};
    ws.catalog_source = Object.assign({}, ws.catalog_source, { url: 'https://www.nike.in', imported_at: '2026-01-01T00:00:00Z' });
    const out = await imp.refreshDue({ maxWorkspaces: 1, budgetMs: 20000 });
    expect(out.refreshed[0] && out.refreshed[0].error, JSON.stringify(out)).toBeFalsy();
    expect(hitCount('nike.in'), 'the refresh read nike.in').toBe(0);
    expect(w.wsRow().catalog_source.url).toBe('https://delichic.co.in');
  } finally { w.restore(); }
});

test('the site\'s own hreflang alternate on ANOTHER brand\'s site is not followed', async () => {
  const w = world({ rows: false });
  STORES['delichic.co.in'].hreflang = 'https://www.nike.in/';
  try {
    const ws = w.wsRow();
    ws.regions = [{ code: 'IN', home: true }];
    ws.asset_hosts = ['www.nike.in'];
    const out = await core.importCatalog(w.auth, { workspace_id: WS, region: 'in', kind: 'storefront', url: 'https://delichic.co.in' });
    expect(hitCount('nike.in'), 'the hreflang alternate on nike.in was read').toBe(0);
    expect(out.coverage.base).toBe('https://delichic.co.in');
  } finally { delete STORES['delichic.co.in'].hreflang; w.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. The count a person reads, and what a generator gets
   ═══════════════════════════════════════════════════════════════════════════ */

test('the brand payload counts the brand\'s own products and the excluded ones apart; readiness is not satisfied by another site\'s rows', async () => {
  const w = world();
  try {
    const res = makeRes();
    await core.handle(makeReq({ token: TOKEN, query: { action: 'brand', op: 'get', id: WS }, method: 'GET' }), res);
    expect(res.code, JSON.stringify(res.payload)).toBe(200);
    expect(res.payload.brand.products).toBe(0);
    expect(res.payload.brand.products_excluded).toBe(4);
    expect(res.payload.brand.products_excluded_domains).toEqual(['nike.in']);
    expect(JSON.stringify(res.payload.brand.readiness)).toContain('product catalog');

    // The generators' reader agrees: none of Nike's rows reach a mailer.
    const got = await bcs.resolve({ workspaceId: WS, brand: w.wsRow() });
    expect(got.source, JSON.stringify(got).slice(0, 300)).not.toBe('shipped');
    expect(JSON.stringify(got.products || [])).not.toMatch(/nike/i);
  } finally { w.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. The wizard: what is on screen is what is imported
   ═══════════════════════════════════════════════════════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
async function openWizard(page, db, log) {
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  await page.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const u = route.request().url();
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});' : 'window.tailwind=window.tailwind||{};' });
  });
  await page.route(/^http:\/\/127\.0\.0\.1:9\/.*/, async (route) => {
    const u = new URL(route.request().url());
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.startsWith('/api/')) {
      const action = u.searchParams.get('action');
      const op = u.searchParams.get('op');
      if (!action) return json({ ok: true });
      if (action === 'auth') return op === 'status' ? json({ ok: true, mode: 'google', pin_signin: false }) : json({ ok: false, error: 'invalid_session' }, 401);
      if (action !== 'brand') return json({ ok: true });
      let body = null;
      try { body = route.request().postDataJSON(); } catch (_) { body = null; }
      log.ops.push({ op, body });
      const res = makeRes();
      await core.handle(makeReq({ token: TOKEN, query: Object.fromEntries(u.searchParams), body: body || undefined, method: route.request().method() }), res);
      return json(res.payload, res.code);
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto('http://127.0.0.1:9/onboarding.html?id=' + WS + '&step=5', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded, null, { timeout: 20000 });
  await page.waitForSelector('#impUrl', { timeout: 20000 });
  await page.waitForFunction(() => /DelhiChic|products/.test((document.getElementById('impStatus') || {}).textContent || ''), null, { timeout: 15000 });
}

test('the wizard: the box is not prefilled with another site, a store edited on screen is SAVED before the import, and the count says what is excluded', async ({ page }) => {
  test.setTimeout(90_000);
  const db = makeDb(TOKEN, OWNER);
  const w = world({ db });
  const log = { dialogs: [], errors: [], ops: [] };
  try {
    await openWizard(page, db, log);
    // The record's IN store is nike.in: the import box does not offer it.
    await expect(page.locator('#impUrl')).not.toHaveValue(/nike/);
    // The count on load: the brand's own rows, and Nike's said apart.
    const status = page.locator('#impStatus');
    await expect(status).toContainText('0 products in this workspace are DelhiChic\'s.');
    await expect(status).toContainText('4 more were read from another site (nike.in) and are excluded');

    // The operator's repro: correct the IN store to the brand's own site, type
    // it into the import box, press Import - without saving first.
    await page.fill('[data-r="store_url"][data-i="0"]', 'https://delichic.co.in');
    await page.fill('#impUrl', 'https://delichic.co.in');
    await page.click('#doImport');
    await expect(status).toContainText('3 products imported', { timeout: 30000 });
    const ops = log.ops.map((o) => o.op);
    const iImport = ops.indexOf('catalog-import');
    const iSave = ops.lastIndexOf('save', iImport);
    expect(iSave, 'no save before the import: ' + ops.join(',')).toBeGreaterThanOrEqual(0);
    expect(iSave).toBeLessThan(iImport);
    expect(w.wsRow().regions[0].store_url).toBe('https://delichic.co.in');
    expect(hitCount('nike.in'), 'the import read nike.in').toBe(0);
    await expect(page.locator('#impCoverage')).toContainText('Market IN: read from https://delichic.co.in');
    await expect(page.locator('#impCoverage')).not.toContainText('nike.in (the IN store URL');
    await expect(status).toContainText('3 in DelhiChic\'s catalogue now');
    // The whole store was read, so Nike's rows are stale (kept, never used)
    // and none is left live to exclude.
    await expect(status).toContainText('4 the store no longer lists marked stale');
    await expect(status).not.toContainText('another site');
    expect(log.dialogs).toEqual([]);
    expect(log.errors).toEqual([]);
  } finally { w.restore(); }
});
