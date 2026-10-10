/**
 * "Catalog fetching? How to fix that for each brand and ensure everything
 * fetched." - a brand's WHOLE catalogue, for every brand, and an exact account
 * of what was not read.
 * ---------------------------------------------------------------------------
 * Every case runs the SHIPPED import paths over real stores on 127.0.0.1
 * (tests/lib/catalog-fixture-stores.js): importCatalog for an account (writing
 * through PostgREST into tests/lib/fake-supabase.js, whose brand_catalog_merge
 * is re-implemented from 20261010002000_catalog_import_merge.sql, and that SQL
 * is EXECUTED on PGlite below), deviceCatalogImport for a phone sign-in, the
 * context pack's catalogue stage, the daily refresh, and the generators'
 * reader (brand-catalog-server.resolve). Nothing reads module source.
 *
 * Measured BEFORE the fix, through the same paths (CLAUDE.md, 2026-10-10):
 *   Shopify, 2,600 products       2,499 read (a 10-page cap); variants 0 of
 *                                 7,800; images 2,600 of 7,800; currency none;
 *                                 device kept 2,000; generators saw 500
 *   Shopify, feed off, 60         1      (sitemaps never read: XML refused)
 *   WooCommerce, 300, gz sitemaps 2
 *   UK store under /en-gb/        40 rows filed under UK at US prices
 *   robots.txt, 35 allowed of 40  2, and a DISALLOWED page fetched
 *   slow store, 150               1
 *   429 + Retry-After, 600        0 ("No usable product rows")
 *
 * Run: npx playwright test tests/catalog-import-complete.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const { startStores } = require('./lib/catalog-fixture-stores.js');
const { FakeSupabase, SERVICE_KEY, ANON_KEY, BASE, response } = require('./lib/fake-supabase.js');
const core = require('../api/_shared/brand-workspace-core.js');
const imp = require('../api/_shared/catalog-import.js');
const bcs = require('../api/_shared/brand-catalog-server.js');
const pack = require('../api/_shared/brand-context-pack.js');

const OWNER = '11111111-1111-4111-8111-111111111111';
const EDITOR = '22222222-2222-4222-8222-222222222222';
const VIEWER = '44444444-4444-4444-8444-444444444444';
const WS = '33333333-3333-4333-8333-333333333333';
const PHONE = { ok: true, provider: 'mobile-pin', mode: 'device', user_id: 'device:abc', token: 'MPINtokenFIXTURE0123456789abcdefghijklmnopqrs' };

test.describe.configure({ mode: 'serial' });

let st;
test.beforeAll(async () => { st = await startStores(); });
test.afterAll(async () => { if (st) await st.close(); });

/* ── the account world: GoTrue + PostgREST over the stores ──────────────── */

/** brand_catalog_merge(), as 20261010002000_catalog_import_merge.sql defines it. */
function installMerge(db) {
  const editorOf = (ws, who) => {
    const w = db.workspaces[ws];
    if (!w) return false;
    if (w.owner_id === who.id) return true;
    return db.members.some((m) => m.workspace_id === ws && m.user_id === who.id && (m.role === 'owner' || m.role === 'editor'));
  };
  db.rpc.brand_catalog_merge = (a, who) => {
    if (who !== 'service' && !editorOf(a.p_workspace, who)) return response(403, { code: '42501', message: 'not authorized to write this workspace\'s catalog' });
    if (!Array.isArray(a.p_rows)) return response(400, { message: 'p_rows must be a jsonb array' });
    const t = db.table('brand_catalog_products');
    const now = db.tick();
    let inserted = 0, updated = 0, staled = 0;
    // (workspace, region, handle, sku) with NULL equal to NULL, indexed once per call.
    const keyOf = (h, k) => JSON.stringify([h == null ? null : String(h), k == null ? null : String(k)]);
    const index = new Map();
    for (const x of t) {
      if (x.workspace_id !== a.p_workspace || x.region !== a.p_region) continue;
      const k = keyOf(x.handle, x.sku);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(x);
    }
    for (const r of a.p_rows) {
      if (!r.title) continue;
      const handle = r.handle || null, sku = r.sku || null;
      const cols = {
        title: r.title, description: r.description || null, product_type: r.product_type || null, collections: r.collections || [],
        price: r.price == null || r.price === '' ? null : Number(r.price), compare_at: r.compare_at == null || r.compare_at === '' ? null : Number(r.compare_at),
        currency: r.currency || null, image_url: r.image_url || null, image_urls: r.image_urls || [], variants: r.variants || [],
        product_url: r.product_url || null, in_stock: r.in_stock == null ? null : !!r.in_stock, tags: r.tags || [], raw: r.raw || {},
        source: r.source || 'manual', source_url: r.source_url || null,
        import_batch: a.p_run, last_seen_run: a.p_run, last_seen_at: now, stale_at: null, updated_at: now,
      };
      const hits = index.get(keyOf(handle, sku)) || [];
      if (hits.length) { for (const h of hits) Object.assign(h, cols); updated += 1; }
      else { index.set(keyOf(handle, sku), [db.insert('brand_catalog_products', Object.assign({ workspace_id: a.p_workspace, region: a.p_region, handle, sku }, cols))]); inserted += 1; }
    }
    if (a.p_complete) {
      for (const x of db.table('brand_catalog_products')) {
        if (x.workspace_id !== a.p_workspace || x.region !== a.p_region || x.stale_at || x.last_seen_run === a.p_run) continue;
        if (!(a.p_family || []).includes(x.source)) continue;
        x.stale_at = now; staled += 1;
      }
    }
    if (a.p_state || a.p_source) {
      for (const w of db.table('brand_workspaces').filter((x) => x.id === a.p_workspace)) {
        if (a.p_state) w.catalog_import = a.p_state;
        if (a.p_source) w.catalog_source = a.p_source;
      }
    }
    const live = db.table('brand_catalog_products').filter((x) => x.workspace_id === a.p_workspace && x.region === a.p_region && !x.stale_at).length;
    return { ok: true, inserted, updated, staled, run: a.p_run, region: a.p_region, live };
  };
}

const ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
function world(brand) {
  st.reset();
  const saved = {};
  for (const k of ENV) saved[k] = process.env[k];
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  const db = new FakeSupabase();
  db.addUser('tok-owner', OWNER, 'owner@harbour.example').addUser('tok-editor', EDITOR, 'editor@harbour.example').addUser('tok-viewer', VIEWER, 'viewer@harbour.example');
  db.addWorkspace(WS, OWNER, Object.assign({ name: 'Harbourlight Goods', slug: 'harbourlight', website: '', regions: [], asset_hosts: [], catalog_source: {}, catalog_import: {}, brand_data: {}, palette: {}, typography: {}, voice: {}, updated_at: new Date().toISOString() }, brand || {}));
  db.addMember(WS, EDITOR, 'editor').addMember(WS, VIEWER, 'viewer');
  db.syncIdentityTables();
  installMerge(db);
  db.route((u) => st.isFixture(u), (u, init) => st.routeFetch(u, init));
  db.install();
  st.installDns();
  bcs.invalidate();
  return {
    db,
    owner: { ok: true, token: 'tok-owner', user_id: OWNER },
    editor: { ok: true, token: 'tok-editor', user_id: EDITOR },
    viewer: { ok: true, token: 'tok-viewer', user_id: VIEWER },
    rows: () => db.table('brand_catalog_products').filter((r) => r.workspace_id === WS),
    wsRow: () => db.table('brand_workspaces').find((w) => w.id === WS),
    restore() {
      db.restore(); st.restore();
      for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      bcs.invalidate();
    },
  };
}

/** A phone sign-in's world: no database at all, only the stores. */
function deviceWorld() {
  st.reset();
  st.install();
  return { restore() { st.restore(); } };
}

const hitsOf = (host, rx) => (st.hits[host] || []).filter((h) => rx.test(h.path));
const said = (cov) => (cov && cov.sentences ? cov.sentences.join(' ') : '');

/* ═══════════════════════════════════════════════════════════════════════════
   1. A Shopify store larger than ten pages
   ═══════════════════════════════════════════════════════════════════════════ */

test('a Shopify store of 2,600 products: every product, variant and image, in the currency the store declares, and every generator sees all of them', async () => {
  test.setTimeout(120_000);
  const w = world({ website: 'https://bigshop.example', regions: [{ code: 'US', home: true }] });
  try {
    const out = await core.importCatalog(w.owner, { workspace_id: WS, region: 'us', kind: 'storefront', url: 'https://bigshop.example' });
    expect(out.complete).toBe(true);
    expect(out.resume_available).toBe(false);
    expect(out.imported).toBe(2600);

    const rows = w.rows();
    expect(rows).toHaveLength(2600);
    expect(rows.reduce((n, r) => n + r.variants.length, 0)).toBe(7800);
    expect(rows.reduce((n, r) => n + r.image_urls.length, 0)).toBe(7800);
    expect(new Set(rows.map((r) => r.currency))).toEqual(new Set(['USD']));
    const k3 = rows.find((r) => r.handle === 'kick-0003');
    expect(k3.price).toBe(43);
    expect(k3.compare_at).toBe(63);                          // stated on the feed: kept
    expect(rows.find((r) => r.handle === 'kick-0001').compare_at).toBe(null);   // not stated: never filled
    expect(k3.variants.map((v) => v.sku)).toEqual(['K0003-7', 'K0003-8', 'K0003-9']);
    expect(k3.in_stock).toBe(true);
    expect(k3.source).toBe('shopify_public');
    expect(rows.some((r) => r.handle === 'kick-0760')).toBe(false);   // not on the online store: not invented

    // Paged to the EMPTY page: page 4 came back one short and was not the end.
    const pages = hitsOf('bigshop.example', /^\/products\.json/).map((h) => new URL('https://x' + h.path).searchParams);
    expect(pages.map((p) => p.get('limit'))).toEqual(Array(12).fill('250'));
    expect(pages.map((p) => Number(p.get('page')))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // The platform's own user agent, never a borrowed one.
    expect(new Set((st.hits['bigshop.example'] || []).map((h) => h.ua))).toEqual(new Set([imp.USER_AGENT]));

    expect(said(out.coverage)).toContain('Found 2,600 of the 2,600 products the site declares');
    expect(said(out.coverage)).toContain('2,600 from the store\'s product feed (/products.json, 11 pages)');
    expect(said(out.coverage)).toContain('priced in USD as that storefront declares');
    expect(said(out.coverage)).toContain('Complete');

    // Recorded on the brand's row, in the same transaction as the rows.
    expect(w.wsRow().catalog_source.complete).toBe(true);
    expect(w.wsRow().catalog_source.found).toBe(2600);
    expect(w.wsRow().catalog_import.cursor).toBe(null);

    const status = await core.catalogStatus(w.owner, WS);
    expect(status.live).toBe(2600);
    expect(status.stale).toBe(0);
    expect(status.resume_available).toBe(false);

    // The generators read ALL of it through brand-catalog-server, past
    // PostgREST's 1,000-row max_rows - not the first 500 by title.
    const brand = { id: WS, name: 'Harbourlight Goods', slug: 'harbourlight' };
    const got = await bcs.resolve({ workspaceId: WS, brand });
    expect(got.source).toBe('brand');
    expect(got.products).toHaveLength(2600);
    const p3 = got.products.find((p) => p.h === 'kick-0003');
    expect(p3.imgs).toHaveLength(3);
    expect(await bcs.withCatalog({ brand, workspaceId: WS }, async () => bcs.productsFor('us', { brand, workspaceId: WS }).products.length)).toBe(2600);
  } finally { w.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Re-import: upsert, never a duplicate; what the store dropped is STALE
   ═══════════════════════════════════════════════════════════════════════════ */

test('a re-import upserts, never duplicates, and marks what the store no longer lists as stale - kept, never used', async () => {
  test.setTimeout(150_000);
  const w = world({ website: 'https://bigshop.example', regions: [{ code: 'US', home: true }] });
  try {
    await core.importCatalog(w.owner, { workspace_id: WS, region: 'us', kind: 'storefront', url: 'https://bigshop.example' });
    // A CSV row the operator added in the same market: a store re-read never stales it.
    await core.importCatalog(w.owner, { workspace_id: WS, region: 'us', kind: 'csv', text: 'title,price\nGift card,25\n', replace: false });
    expect(w.rows()).toHaveLength(2601);

    st.stores['bigshop.example'].drop([5, 2600]);
    const again = await core.importCatalog(w.editor, { workspace_id: WS, region: 'us', kind: 'storefront', url: 'https://bigshop.example' });
    expect(again.complete).toBe(true);
    expect(again.inserted).toBe(0);
    expect(again.updated).toBe(2598);
    expect(again.staled).toBe(2);
    const rows = w.rows();
    expect(rows).toHaveLength(2601);                                         // nothing duplicated, nothing deleted
    expect(rows.filter((r) => r.stale_at).map((r) => r.handle).sort()).toEqual(['kick-0005', 'kick-2600']);
    expect(rows.find((r) => r.title === 'Gift card').stale_at).toBe(null);  // another source family
    // An editor's import records its source too (the row's PATCH policy is owner-only).
    expect(w.wsRow().catalog_source.found).toBe(2598);

    bcs.invalidate();
    const got = await bcs.resolve({ workspaceId: WS, brand: { id: WS, name: 'Harbourlight Goods', slug: 'harbourlight' } });
    expect(got.products).toHaveLength(2599);
    expect(got.products.some((p) => p.h === 'kick-0005')).toBe(false);
    expect((await core.catalogStatus(w.owner, WS)).stale).toBe(2);

    // The product comes back: the same row comes back to life.
    st.stores['bigshop.example'].undrop();
    const back = await core.importCatalog(w.owner, { workspace_id: WS, region: 'us', kind: 'storefront', url: 'https://bigshop.example' });
    expect(back.inserted).toBe(0);
    expect(w.rows().filter((r) => r.stale_at)).toHaveLength(0);

    // An additive import (replace:false) never marks anything stale.
    st.stores['bigshop.example'].drop([7]);
    const add = await core.importCatalog(w.owner, { workspace_id: WS, region: 'us', kind: 'storefront', url: 'https://bigshop.example', replace: false });
    expect(add.staled).toBe(0);
    expect(w.rows().filter((r) => r.stale_at)).toHaveLength(0);

    // A CSV with no sku and no handle column, imported twice: one row each, not two.
    await core.importCatalog(w.owner, { workspace_id: WS, region: 'us', kind: 'csv', text: 'title,price\nGift card,25\nTote,12\n', replace: false });
    await core.importCatalog(w.owner, { workspace_id: WS, region: 'us', kind: 'csv', text: 'title,price\nGift card,25\nTote,12\n', replace: false });
    expect(w.rows().filter((r) => r.title === 'Gift card')).toHaveLength(1);
    expect(w.rows().filter((r) => r.title === 'Tote')).toHaveLength(1);

    // A viewer may read the brand and may not write its catalogue.
    await expect(core.importCatalog(w.viewer, { workspace_id: WS, region: 'us', kind: 'csv', text: 'title\nX\n' })).rejects.toMatchObject({ status: 403 });
  } finally { w.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. A Shopify store with its feed off; a WooCommerce store
   ═══════════════════════════════════════════════════════════════════════════ */

test('Shopify with its feed switched off: all 60 products from its sitemap and their JSON-LD, though its home page links one', async () => {
  test.setTimeout(60_000);
  const d = deviceWorld();
  try {
    const out = await core.importCatalog(PHONE, { region: 'us', kind: 'storefront', url: 'https://oneshop.example', brand: { website: 'https://oneshop.example' } });
    expect(out.storage).toBe('device');
    expect(out.complete).toBe(true);
    expect(out.products).toHaveLength(60);
    expect(out.products.every((p) => p.source === 'sitemap_jsonld')).toBe(true);
    expect(out.products.reduce((n, p) => n + p.image_urls.length, 0)).toBe(120);
    expect(out.products.find((p) => p.handle === 'tee-007')).toMatchObject({ title: 'Tee 007', price: 27, currency: 'USD', sku: 'T007', source_url: 'https://oneshop.example/products/tee-007' });
    expect(said(out.coverage)).toContain('Found 60 of the 60 products the site declares');
    expect(said(out.coverage)).toContain('feed was not available (answered 404)');
    // Each product page read once; the about page in the pages sitemap never.
    expect(hitsOf('oneshop.example', /^\/products\/tee-/)).toHaveLength(60);
    expect(hitsOf('oneshop.example', /^\/pages\/about/)).toHaveLength(0);
  } finally { d.restore(); }
});

test('WooCommerce: gzipped child sitemaps, three JSON-LD shapes, no feed request, and the 12 products that state no price carry the marker, never a number', async () => {
  test.setTimeout(90_000);
  const w = world({ website: 'https://wooshop.example', regions: [{ code: 'DE', home: true }] });
  try {
    const out = await core.importCatalog(w.owner, { workspace_id: WS, region: 'de', kind: 'storefront', url: 'https://wooshop.example' });
    expect(out.complete).toBe(true);
    const rows = w.rows();
    expect(rows).toHaveLength(300);
    expect(rows.filter((r) => r.price == null).map((r) => r.handle).sort()).toEqual(['mug-025', 'mug-050', 'mug-075', 'mug-100', 'mug-125', 'mug-150', 'mug-175', 'mug-200', 'mug-225', 'mug-250', 'mug-275', 'mug-300']);
    expect(rows.filter((r) => r.price != null).every((r) => r.currency === 'EUR')).toBe(true);
    const grouped = rows.find((r) => r.handle === 'mug-002');     // a ProductGroup with hasVariant
    expect(grouped.variants.map((v) => v.sku)).toEqual(['M002-S', 'M002-L']);
    expect(grouped.price).toBe(12);
    const aggregate = rows.find((r) => r.handle === 'mug-001');   // an @graph AggregateOffer
    expect(aggregate.price).toBe(11);
    expect(rows.find((r) => r.handle === 'mug-003').image_urls).toEqual(['https://wooshop.example/wp-content/uploads/mug-3.jpg', 'https://wooshop.example/wp-content/uploads/mug-3-side.jpg']);
    expect(hitsOf('wooshop.example', /^\/products\.json/)).toHaveLength(0);   // WooCommerce declared: no Shopify feed guessed at
    expect(hitsOf('wooshop.example', /\.xml\.gz$/)).toHaveLength(2);
    expect(said(out.coverage)).toContain('Found 300 of the 300 products the site declares');
    expect(said(out.coverage)).toContain('12 products state no price; they carry [DATA REQUIRED BEFORE LAUNCH: price, <product>, DE] rather than a number.');
    expect(out.coverage.missing_examples).toContain('[DATA REQUIRED BEFORE LAUNCH: price, Mug 025, DE]');
  } finally { w.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Each market from its own store
   ═══════════════════════════════════════════════════════════════════════════ */

test('a UK import reads the UK store - from the brand\'s record, else the site\'s own hreflang - never the US price list', async () => {
  test.setTimeout(60_000);
  const d = deviceWorld();
  try {
    const regions = [{ code: 'US', home: true, store_url: 'https://regional.example' }, { code: 'UK', store_url: 'https://regional.example/en-gb' }];
    const uk = await core.importCatalog(PHONE, { region: 'uk', kind: 'storefront', url: 'https://regional.example', brand: { website: 'https://regional.example', regions } });
    expect(uk.products).toHaveLength(40);
    expect(uk.products[0]).toMatchObject({ region: 'uk', price: 41, currency: 'GBP', product_url: 'https://regional.example/en-gb/products/kick-0001' });
    expect(said(uk.coverage)).toContain('Market UK: read from https://regional.example/en-gb (the UK store URL on the brand\'s own record), priced in GBP');

    // No UK store on the record: the site's own hreflang names it.
    const viaHreflang = await core.importCatalog(PHONE, { region: 'uk', kind: 'storefront', url: 'https://regional.example', brand: { website: 'https://regional.example', regions: [{ code: 'US', home: true }] } });
    expect(viaHreflang.products[0]).toMatchObject({ price: 41, currency: 'GBP' });
    expect(said(viaHreflang.coverage)).toContain('the site\'s own hreflang="en-gb" alternate');

    const us = await core.importCatalog(PHONE, { region: 'us', kind: 'storefront', url: 'https://regional.example', brand: { website: 'https://regional.example', regions } });
    expect(us.products[0]).toMatchObject({ region: 'us', price: 51, currency: 'USD' });
  } finally { d.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. robots.txt
   ═══════════════════════════════════════════════════════════════════════════ */

test('robots.txt is honoured: 35 of 40, no disallowed page is ever requested, and a robots.txt that answers 503 means nothing is read', async () => {
  test.setTimeout(60_000);
  const w = world({ website: 'https://robots.example', regions: [{ code: 'UK', home: true }] });
  try {
    const out = await core.importCatalog(w.owner, { workspace_id: WS, region: 'uk', kind: 'storefront', url: 'https://robots.example' });
    expect(w.rows()).toHaveLength(35);
    expect(hitsOf('robots.example', /private-/)).toHaveLength(0);
    expect(out.coverage.skipped.robots).toBe(5);
    expect(said(out.coverage)).toContain('5 pages skipped because robots.txt disallows them');

    // RFC 9309 2.3.1.4: an unreachable robots.txt is "disallow everything".
    st.reset();
    st.stores['robots.example'].robotsStatus = 503;
    const shut = await core.importCatalog(w.owner, { workspace_id: WS, region: 'uk', kind: 'storefront', url: 'https://robots.example' });
    expect(shut.complete).toBe(false);
    expect(shut.imported).toBe(0);
    expect(shut.resume_available).toBe(true);
    expect(hitsOf('robots.example', /^\/(?!robots\.txt)/)).toHaveLength(0);
    expect(said(shut.coverage)).toContain('RFC 9309 says to treat that as "disallow everything", so nothing was read');
    // A partial run marks nothing stale: it cannot know what disappeared.
    expect(w.rows().filter((r) => r.stale_at)).toHaveLength(0);
  } finally { w.restore(); }
});

test('site-crawl with its DEFAULT fetcher reads robots.txt (text/plain) and the XML sitemap, so every crawl reader honours robots.txt in production', async () => {
  test.setTimeout(60_000);
  const d = deviceWorld();
  try {
    const crawl = require('../api/_shared/site-crawl.js');
    // No fetchImpl: exactly what rowsFromSite, the knowledge stage and the
    // review reader get in production.
    const out = await crawl.crawlSite('https://robots.example', { brand: { website: 'https://robots.example' }, maxPages: 80 });
    expect(out.sitemap.found).toBe(true);
    expect(out.sitemap.declared).toBe(40);
    expect(hitsOf('robots.example', /private-/)).toHaveLength(0);
    expect(out.offerings.filter((o) => o.kind === 'product')).toHaveLength(35);
  } finally { d.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. A store too slow for one call; a store that rate-limits
   ═══════════════════════════════════════════════════════════════════════════ */

test('a store too slow for one call is read in steps from a cursor on the brand\'s row; Continue import finishes it and reads nothing twice', async () => {
  test.setTimeout(150_000);
  const w = world({ website: 'https://slowshop.example', regions: [{ code: 'US', home: true }] });
  try {
    await expect(core.importCatalog(w.owner, { workspace_id: WS, continue: true })).rejects.toMatchObject({ status: 409, code: 'nothing_to_continue' });

    const first = await core.importCatalog(w.owner, { workspace_id: WS, region: 'us', kind: 'storefront', url: 'https://slowshop.example', budgetMs: 2500 });
    expect(first.complete).toBe(false);
    expect(first.resume_available).toBe(true);
    expect(first.imported).toBeGreaterThan(0);
    expect(first.imported).toBeLessThan(150);
    expect(first.coverage.stopped.reason).toBe('time');
    expect(said(first.coverage)).toMatch(/PARTIAL: this run's time ran out at URL \d+ of 150\. Continue import resumes exactly there/);
    expect(w.wsRow().catalog_import.cursor).toBeTruthy();
    expect(w.wsRow().catalog_source.complete).toBe(false);
    expect((await core.catalogStatus(w.owner, WS)).resume_available).toBe(true);

    let last = first, steps = 1;
    while (!last.complete && steps < 20) {
      last = await core.importCatalog(w.owner, { workspace_id: WS, continue: true, budgetMs: 2500 });
      steps += 1;
    }
    expect(last.complete).toBe(true);
    expect(steps).toBeGreaterThan(2);
    expect(w.rows()).toHaveLength(150);
    expect(last.coverage.found).toBe(150);
    expect(w.wsRow().catalog_import.cursor).toBe(null);
    const perPage = {};
    for (const h of hitsOf('slowshop.example', /^\/item\//)) perPage[h.path] = (perPage[h.path] || 0) + 1;
    expect(Object.keys(perPage)).toHaveLength(150);
    expect(Math.max(...Object.values(perPage))).toBe(1);
  } finally { w.restore(); }
});

test('a phone sign-in continues from the cursor its device kept, and the rows merge without a duplicate', async () => {
  test.setTimeout(150_000);
  const d = deviceWorld();
  try {
    const brand = { website: 'https://slowshop.example' };
    let held = [];
    let r = await core.importCatalog(PHONE, { region: 'us', kind: 'storefront', url: 'https://slowshop.example', brand, budgetMs: 2500 });
    expect(r.storage).toBe('device');
    expect(r.complete).toBe(false);
    expect(r.cursor).toBeTruthy();
    held = imp.mergeRows(held, r.products, { run: r.run, complete: r.complete, family: r.family }).rows;
    let n = 0;
    while (!r.complete && n < 20) {
      r = await core.importCatalog(PHONE, { region: 'us', kind: 'storefront', url: 'https://slowshop.example', brand, cursor: r.cursor, budgetMs: 2500 });
      held = imp.mergeRows(held, r.products, { run: r.run, complete: r.complete, family: r.family }).rows;
      n += 1;
    }
    expect(r.complete).toBe(true);
    expect(n).toBeGreaterThan(1);
    expect(held).toHaveLength(150);
    expect(new Set(held.map((p) => p.handle)).size).toBe(150);
  } finally { d.restore(); }
});

test('a 429 with Retry-After is waited out page by page; one longer than the call stops it with a cursor instead of "no products"', async () => {
  test.setTimeout(90_000);
  const d = deviceWorld();
  try {
    const out = await core.importCatalog(PHONE, { region: 'us', kind: 'storefront', url: 'https://ratelimit.example', brand: { website: 'https://ratelimit.example' } });
    expect(out.complete).toBe(true);
    expect(out.products).toHaveLength(600);
    const feed = hitsOf('ratelimit.example', /^\/products\.json/);
    const byPage = {};
    for (const h of feed) (byPage[new URL('https://x' + h.path).searchParams.get('page')] = byPage[new URL('https://x' + h.path).searchParams.get('page')] || []).push(h.at);
    expect(Object.keys(byPage).sort()).toEqual(['1', '2', '3', '4']);
    for (const ats of Object.values(byPage)) {
      expect(ats).toHaveLength(2);
      expect(ats[1] - ats[0]).toBeGreaterThanOrEqual(950);       // Retry-After: 1 was obeyed
    }
    expect(said(out.coverage)).toContain('every Retry-After was obeyed');

    // A Retry-After the call cannot afford: stop, keep the place, say why.
    st.reset();
    st.stores['ratelimit.example'].retryAfter = '120';
    const held = await core.importCatalog(PHONE, { region: 'us', kind: 'storefront', url: 'https://ratelimit.example', brand: { website: 'https://ratelimit.example' } });
    expect(held.complete).toBe(false);
    expect(held.products).toHaveLength(0);
    expect(held.cursor).toBeTruthy();
    expect(held.coverage.stopped).toMatchObject({ reason: 'rate_limited', retry_after: '120' });
    expect(said(held.coverage)).toContain('the store asked to slow down (429, Retry-After 120) at feed page 1');
    expect(hitsOf('ratelimit.example', /^\/products\.json/)).toHaveLength(1);   // asked once, then waited for the next call
  } finally { d.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. The context pack's catalogue stage, and the daily refresh
   ═══════════════════════════════════════════════════════════════════════════ */

test('the context pack\'s catalogue stage reads the whole store for a phone sign-in and hands every product back once', async () => {
  test.setTimeout(90_000);
  const d = deviceWorld();
  try {
    const out = await pack.devicePackStep({
      workspaceId: 'local-oneshop', brand: { name: 'One Shop', website: 'https://oneshop.example', regions: [{ code: 'US', home: true }] },
      pack: null, auth: PHONE,
    });
    expect(out.products).toHaveLength(60);
    expect(out.row.catalog.complete).toBe(true);
    expect(out.row.catalog.coverage.found).toBe(60);
    expect(out.row.catalog.products).toBeUndefined();
    expect(out.row.catalog.cursor).toBeUndefined();
  } finally { d.restore(); }
});

test('the daily refresh continues an import that stopped part-way, then re-reads the store read longest ago; a CSV catalogue is never touched', async () => {
  test.setTimeout(150_000);
  const w = world({ website: 'https://slowshop.example', regions: [{ code: 'US', home: true }] });
  try {
    const first = await core.importCatalog(w.owner, { workspace_id: WS, region: 'us', kind: 'storefront', url: 'https://slowshop.example', budgetMs: 2500 });
    expect(first.complete).toBe(false);
    // A second brand whose catalogue is a CSV: nothing to re-read.
    const WS2 = '55555555-5555-4555-8555-555555555555';
    w.db.table('brand_workspaces').push({ id: WS2, owner_id: OWNER, website: 'https://bigshop.example', regions: [], asset_hosts: [], catalog_source: { kind: 'csv', region: 'us', imported_at: '2026-01-01T00:00:00Z' }, catalog_import: {}, updated_at: '2026-01-01T00:00:00Z' });
    w.db.clearCalls();
    const sweep = await imp.refreshDue({ maxWorkspaces: 2, budgetMs: 60000 });
    expect(sweep.refreshed).toHaveLength(1);
    expect(sweep.refreshed[0]).toMatchObject({ workspace_id: WS, continued: true, complete: true, found: 150 });
    expect(w.rows()).toHaveLength(150);
    // Service role, and the workspace named on every write.
    const merges = w.db.calls.filter((c) => /rpc\/brand_catalog_merge/.test(c.url));
    expect(merges.length).toBeGreaterThan(0);
    expect(merges.every((c) => c.token === SERVICE_KEY && c.body.p_workspace === WS)).toBe(true);

    // Complete and fresh: not due. Older than a day: read again whole.
    expect((await imp.refreshDue({ maxWorkspaces: 2, budgetMs: 30000 })).due).toBe(0);
    w.wsRow().catalog_import.updated_at = '2026-01-01T00:00:00Z';
    st.reset();
    const again = await imp.refreshDue({ maxWorkspaces: 2, budgetMs: 60000 });
    expect(again.refreshed[0]).toMatchObject({ workspace_id: WS, continued: false, complete: true, updated: 150, inserted: 0 });
    expect(w.rows()).toHaveLength(150);
  } finally { w.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. The SQL itself, executed (PGlite: Postgres in WebAssembly)
   ═══════════════════════════════════════════════════════════════════════════ */

const MIG = path.join(ROOT, 'supabase', 'migrations');
const PLATFORM = `
  create role authenticated; create role anon; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid $$;
`;
const EDITOR_FN = `
  alter table public.brand_catalog_products add column if not exists import_batch uuid;
  create or replace function public.is_brand_editor(ws uuid, uid uuid) returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.brand_workspaces w where w.id = ws and w.owner_id = uid)
        or exists (select 1 from public.brand_workspace_members m where m.workspace_id = ws and m.user_id = uid and m.role in ('owner','editor')) $$;
`;
async function database() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(PLATFORM);
  await db.exec(fs.readFileSync(path.join(MIG, '20260809120000_brand_workspaces.sql'), 'utf8'));
  await db.exec(EDITOR_FN);
  await db.exec(fs.readFileSync(path.join(MIG, '20261010002000_catalog_import_merge.sql'), 'utf8'));
  await db.exec(`set test.uid = '${OWNER}'`);
  await db.query(`insert into public.brand_workspaces (id, owner_id, slug, name) values ($1, $2, 'harbour', 'Harbourlight Goods')`, [WS, OWNER]);
  await db.query(`insert into public.brand_workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')`, [WS, VIEWER]);
  const merge = async (rows, run, complete, extra) => (await db.query(
    'select public.brand_catalog_merge($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8::jsonb) as r',
    [WS, 'us', JSON.stringify(rows), run, !!complete, (extra && extra.family) || ['shopify_public', 'sitemap_jsonld', 'site_crawl'], extra && extra.state ? JSON.stringify(extra.state) : null, null],
  )).rows[0].r;
  const all = async () => (await db.query('select handle, sku, title, price, stale_at, last_seen_run, source, image_urls, variants from public.brand_catalog_products where workspace_id = $1 order by title', [WS])).rows;
  return { db, merge, all };
}
const RUN1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const RUN2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const RUN3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const ROW = (handle, extra) => Object.assign({ region: 'us', handle, sku: null, title: handle.toUpperCase(), price: 10, source: 'sitemap_jsonld', image_urls: ['https://s.example/' + handle + '.jpg'], variants: [{ sku: handle + '-1', price: 10 }] }, extra || {});

test('SQL: brand_catalog_merge upserts with NULL equal to NULL, stales only after a COMPLETE run of the same source family, and records the state', async () => {
  const d = await database();
  const one = await d.merge([ROW('a'), ROW('b'), ROW('c')], RUN1, true);
  expect(one).toMatchObject({ inserted: 3, updated: 0, staled: 0, live: 3 });
  // The same rows again (sku NULL): updated in place, not inserted twice.
  const two = await d.merge([ROW('a', { price: 12 }), ROW('b')], RUN2, false);
  expect(two).toMatchObject({ inserted: 0, updated: 2, staled: 0 });
  expect((await d.all())).toHaveLength(3);
  expect((await d.all()).find((r) => r.handle === 'a').price).toBe('12');
  // A partial run marked nothing stale; the complete one that follows does.
  const three = await d.merge([ROW('a')], RUN2, true);
  expect(three.staled).toBe(1);
  // c was seen only by RUN1; b by RUN2 earlier in the same run is NOT stale.
  // (b was seen in RUN2's first step; the complete step closes the run.)
  const rows = await d.all();
  expect(rows.find((r) => r.handle === 'b').stale_at).toBe(null);
  expect(rows.find((r) => r.handle === 'c').stale_at).not.toBe(null);
  expect(rows.find((r) => r.handle === 'a').variants).toEqual([{ sku: 'a-1', price: 10 }]);
  // A CSV row is another family: a store run never stales it.
  await d.merge([ROW('gift', { source: 'csv' })], RUN3, true, { family: ['csv', 'json'] });
  const four = await d.merge([ROW('a'), ROW('b')], 'aaaaaaaa-0000-4000-8000-000000000004', true, { state: { cursor: null, coverage: { found: 2 } } });
  expect(four.staled).toBe(0);
  expect((await d.all()).find((r) => r.handle === 'gift').stale_at).toBe(null);
  const ws = (await d.db.query('select catalog_import from public.brand_workspaces where id = $1', [WS])).rows[0];
  expect(ws.catalog_import).toEqual({ cursor: null, coverage: { found: 2 } });
  // A stale product listed again comes back to life.
  await d.merge([ROW('c')], 'aaaaaaaa-0000-4000-8000-000000000005', false);
  expect((await d.all()).find((r) => r.handle === 'c').stale_at).toBe(null);
});

test('SQL: only an editor (or the service role) may merge; a viewer is refused', async () => {
  const d = await database();
  await d.db.exec(`set test.uid = '${VIEWER}'`);
  await expect(d.merge([ROW('a')], RUN1, false)).rejects.toThrow(/not authorized/);
  await d.db.exec(`set test.uid = ''`);   // no user: the service role's daily refresh
  expect((await d.merge([ROW('a')], RUN1, false)).inserted).toBe(1);
});

test('the device merge in the browser and the server merge agree on the same input', async ({ page }) => {
  const existing = [
    { region: 'us', handle: 'a', sku: null, title: 'A', source: 'shopify_public' },
    { region: 'us', handle: 'b', sku: '1', title: 'B', source: 'shopify_public' },
    { region: 'us', handle: 'c', sku: null, title: 'C', source: 'csv' },
    { region: 'uk', handle: 'd', sku: null, title: 'D', source: 'shopify_public' },
  ];
  const incoming = [
    { region: 'us', handle: 'a', sku: null, title: 'A2', source: 'shopify_public' },
    { region: 'us', handle: 'e', sku: null, title: 'E', source: 'sitemap_jsonld' },
  ];
  const opts = { run: 'r1', complete: true, family: ['shopify_public', 'sitemap_jsonld', 'site_crawl'], at: '2026-10-10T00:00:00.000Z' };
  const server = imp.mergeRows(existing, incoming, opts);
  const srv = http.createServer((req, res) => {
    if (req.url === '/brand-context.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(ROOT, 'brand-context.js'))); }
    if (req.url.startsWith('/api/')) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"ok":false}'); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html><head><script src="/brand-context.js"></script></head><body></body></html>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window.BrandContext && window.BrandContext.device && window.BrandContext.device.mergeCatalog));
    const browser = await page.evaluate(([e, i, o]) => window.BrandContext.device.mergeCatalog(e, i, o), [existing, incoming, opts]);
    expect(browser).toEqual(JSON.parse(JSON.stringify(server)));
    expect(server.staled).toBe(1);                    // b: same family, same region, unseen
    expect(server.rows.find((r) => r.handle === 'c').stale_at).toBe(undefined);   // csv: another family
    expect(server.rows.find((r) => r.handle === 'd').stale_at).toBe(undefined);   // another market
  } finally { await new Promise((r) => srv.close(r)); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   9. What the operator sees: the onboarding catalogue step and /connections
   ═══════════════════════════════════════════════════════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
function appServer() {
  return http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
}

/** Two REAL answers of the shipped importer for the slow store: a partial step, then the rest. */
async function realSteps() {
  const w = world({ website: 'https://slowshop.example', regions: [{ code: 'US', home: true }] });
  try {
    const first = await core.importCatalog(w.owner, { workspace_id: WS, region: 'us', kind: 'storefront', url: 'https://slowshop.example', budgetMs: 2500 });
    let last = first;
    for (let i = 0; i < 20 && !last.complete; i++) last = await core.importCatalog(w.owner, { workspace_id: WS, continue: true, budgetMs: 4000 });
    return { first, last, status: await core.catalogStatus(w.owner, WS) };
  } finally { w.restore(); }
}

test('onboarding: a partial import shows its coverage and Continue import, which resumes (not restarts) and then says complete', async ({ page }) => {
  test.setTimeout(150_000);
  const { first, last } = await realSteps();
  expect(first.complete).toBe(false);
  const BRAND = { id: WS, slug: 'slow', name: 'Slow Shop', website: 'https://slowshop.example', palette: { primary: '#1F4E79', accent: '#C8102E', ink: '#1A1A1A', surface: '#FFFFFF', surface_alt: '#F6F7F9', muted: '#5A6270' }, typography: { heading: { family: 'Inter' }, body: { family: 'Inter' } }, voice: {}, brand_data: {}, regions: [{ code: 'US', home: true, store_url: 'https://slowshop.example', currency: 'USD' }] };
  const srv = appServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const calls = [];
  try {
    await page.route('**/api/public-config**', async (route) => {
      const u = new URL(route.request().url());
      const op = u.searchParams.get('op') || '';
      let sent = null; try { sent = JSON.parse(route.request().postData() || 'null'); } catch (_) { sent = null; }
      calls.push({ op, sent });
      let payload;
      if (op === 'catalog-import') payload = sent && sent.continue ? last : first;
      else if (op === 'catalog-status') payload = { ok: true, coverage: null, resume_available: false };
      else if (op === 'save') payload = { ok: true, brand: BRAND };
      else payload = { ok: true, brand: BRAND, workspaces: [], active_id: BRAND.id, pack: null, presets: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('http://127.0.0.1:' + srv.address().port + '/onboarding.html', { waitUntil: 'load' });
    await expect(page.locator('#title')).toContainText('Edit Slow Shop', { timeout: 15000 });
    const pip = page.locator('.step-pip[data-step="5"]');
    await pip.waitFor({ state: 'visible', timeout: 15000 });
    await pip.click({ force: true });
    await page.fill('#impUrl', 'https://slowshop.example');
    await page.locator('#doImport').click();
    const box = page.locator('#impCoverage');
    await expect(box).toBeVisible({ timeout: 10000 });
    await expect(box).toContainText('Catalogue read in part');
    await expect(box).toContainText('PARTIAL: this run\'s time ran out');
    await expect(page.locator('#impStatus')).toContainText(first.imported + ' products imported in this step');
    // An ordinary state, in the accent rule: not a failure frame.
    await expect(page.locator('#impStatus .vh-failure, #impCoverage .vh-failure')).toHaveCount(0);

    await page.locator('#impContinue').click();
    await expect(box).toContainText('Catalogue read completely', { timeout: 10000 });
    await expect(box).toContainText('Complete: every product the source lists was read.');
    await expect(page.locator('#impContinue')).toHaveCount(0);
    const imports = calls.filter((c) => c.op === 'catalog-import');
    expect(imports).toHaveLength(2);
    expect(imports[1].sent).toMatchObject({ workspace_id: WS, region: 'us', continue: true });
    expect(imports[1].sent.url).toBeUndefined();               // resumes; does not restart from a URL
  } finally { await new Promise((r) => srv.close(r)); }
});

test('/connections shows the active brand\'s catalogue coverage and offers Continue import when it is partial', async ({ page }) => {
  test.setTimeout(150_000);
  const { first, last } = await realSteps();
  const partialStatus = { ok: true, workspace_id: WS, coverage: first.coverage, resume_available: true, live: first.imported, stale: 0 };
  const BRAND = { id: WS, slug: 'slow', name: 'Slow Shop', website: 'https://slowshop.example', palette: { primary: '#1F4E79', accent: '#C8102E', ink: '#1A1A1A', surface: '#FFFFFF' }, typography: {}, voice: {}, regions: [{ code: 'US', home: true }] };
  const srv = appServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const calls = [];
  try {
    await page.route('**/api/public-config**', async (route) => {
      const u = new URL(route.request().url());
      const action = u.searchParams.get('action') || '';
      const op = u.searchParams.get('op') || '';
      let sent = null; try { sent = JSON.parse(route.request().postData() || 'null'); } catch (_) { sent = null; }
      calls.push({ action, op, sent });
      let payload;
      if (action === 'brand' && op === 'catalog-status') payload = partialStatus;
      else if (action === 'brand' && op === 'catalog-import') payload = last;
      else if (action === 'connections') payload = { ok: true, providers: [], connections: [], routing: { entries: [], use_platform_fallback: true }, secrets_storage: {} };
      else payload = { ok: true, brand: BRAND, workspaces: [], active_id: BRAND.id };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('http://127.0.0.1:' + srv.address().port + '/brand-connections.html', { waitUntil: 'load' });
    const card = page.locator('#catalogCard');
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card).toContainText('Product catalogue: read in part');
    await expect(card).toContainText('Found ' + first.coverage.found);
    await page.locator('#catalogContinue').click();
    await expect(card).toContainText('Product catalogue: read completely', { timeout: 10000 });
    const cont = calls.filter((c) => c.action === 'brand' && c.op === 'catalog-import');
    expect(cont).toHaveLength(1);
    expect(cont[0].sent).toMatchObject({ workspace_id: WS, continue: true });
  } finally { await new Promise((r) => srv.close(r)); }
});
