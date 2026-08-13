// Asset provenance — a generated asset uses the ACTIVE brand's own catalogue,
// or no asset at all.
//
// WHAT THIS PROTECTS. The Times of India (a news publisher, market IN) opened
// Smart Brain and generated a mailer. The copy was right for a news brand -
// "Inside India's Cities: Stories That Shape Your World", reporters on the
// ground, city beat. The IMAGE in the hero slot was a custom Nike Air Force 1:
// tenant zero's product. `catalog-image.js` read data/catalog/products_us.json
// off disk into a module-level `CACHE[region]` with no workspace awareness at
// all, and the loose keyword matcher turned "Times of India City" into
// "Chelsea City F.C. x Nike Air Force 1".
//
// Every renderer, ad builder and landing page in the OS resolves imagery
// through that one module, so the leak was platform-wide and completely silent:
// the copy read correctly, the palette was right, and only the photograph
// belonged to another company.
//
// The tests below drive the real modules with no network. They are the pair to
// scripts/test-brand-isolation.js (`npm run test:isolation`), which scans whole
// generated funnels for tenant-zero tokens; this file covers the parts that
// scan cannot reach - the async per-workspace read, the cache key, and
// concurrency between two brands generating at the same instant.
//
// Run: npx playwright test tests/brand-catalog-scope.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const catalogServer = require('../api/_shared/brand-catalog-server.js');
const catalogImage = require('../api/_shared/catalog-image.js');

const ZERO = { slug: catalogServer.tenantZeroSlug() || 'knickgasm', name: 'KNICKGASM', is_default: true };
const TOI = { id: 'ws_toi_0001', slug: 'times-of-india', name: 'The Times of India' };
const APPLE = { id: 'ws_apple_0002', slug: 'apple', name: 'Apple' };

/** The shipped catalogue, i.e. the rows that belong to tenant zero and nobody else. */
function shippedRows() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalog/products_us.json'), 'utf8'));
  } catch (_) { return []; }
}

/** Every URL in a blob that is served off tenant zero's product CDN. */
function foreignImageUrls(blob) {
  const rows = shippedRows();
  const prefixes = new Set();
  for (const r of rows) {
    if (typeof r.i !== 'string') continue;
    try {
      const u = new URL(r.i);
      prefixes.add(u.host + u.pathname.split('/').slice(0, 5).join('/'));
    } catch (_) { /* not attributable */ }
  }
  const s = String(blob);
  return [...prefixes].filter((p) => s.includes(p));
}

// ── 1. THE CENTRAL RULE ─────────────────────────────────────────────────────

test('a workspace with no catalogue gets NO image, and never a URL from data/catalog', () => {
  const rows = shippedRows();
  test.skip(!rows.length, 'no built catalogue on disk — run npm run build');

  // The hardest possible inputs: tenant zero's own product names and handles,
  // plus the real editorial words that triggered the production bug.
  const inputs = [
    ...rows.slice(0, 8).map((r) => ({ title: r.n, handle: r.h })),
    { title: 'City' }, { title: 'Times of India City' }, { title: 'Cricket' },
    { title: 'Inside India\'s Cities: Stories That Shape Your World' },
  ];

  for (const brand of [TOI, APPLE]) {
    for (const input of inputs) {
      const opts = { brand };
      expect(catalogImage.imageFor(input, 'IN', opts), `imageFor ${brand.slug} / ${input.title}`).toBeNull();
      expect(catalogImage.imagesFor(input, 'IN', opts), `imagesFor ${brand.slug} / ${input.title}`).toEqual([]);
      expect(catalogImage.handleFor(input, 'IN', opts), `handleFor ${brand.slug} / ${input.title}`).toBeNull();
      expect(catalogImage.match(input, 'IN', opts), `match ${brand.slug} / ${input.title}`).toBeNull();
    }
  }
});

test('the missing image is REPORTED, in the spec\'s marker form', () => {
  const r = catalogImage.resolveImage({ heroProduct: { title: 'City Desk' } }, 'IN', { brand: TOI });
  expect(r.url).toBeNull();
  expect(r.source).toBe('none');
  // [DATA REQUIRED BEFORE LAUNCH: field, product, region]
  expect(r.marker).toBe('[DATA REQUIRED BEFORE LAUNCH: product image, City Desk, IN]');
  // The reason names the brand and says what to do, so the empty state is not a
  // dead end for whoever reads it.
  expect(r.reason).toContain('The Times of India');
  expect(r.reason).toMatch(/never substituted/i);
});

test('a full Smart Brain campaign for a news brand carries no tenant-zero asset', async () => {
  const plan = require('../api/_shared/smart-brain-plan.js');
  const { smartConfig } = require('../lib/smart-brain/services.js');
  const preset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands/presets/times-of-india.json'), 'utf8'));
  const brand = Object.assign({}, preset, { id: TOI.id });
  const offering = (brand.offerings || [])[0] || { kind: 'section', name: 'City' };

  const campaign = await plan.buildCampaign({
    id: 'scope_toi', date: '2026-09-01', market: 'IN', status: 'needs_human_verification',
    cohort: { name: 'Nurture', size: 0 }, objective: 'Drive the reader to act.',
    theme: `${offering.name} (${offering.kind})`, heroOffering: offering, offering,
    heroProduct: { title: offering.name, category: offering.kind },
    channels: ['email', 'meta', 'google', 'landing_page'], cta: 'Read more', brand,
  }, smartConfig({ workspace_id: TOI.id }), { withCreatives: false, noLLM: true });

  const blob = JSON.stringify(campaign);
  expect(foreignImageUrls(blob), 'tenant-zero CDN URLs in a Times of India campaign').toEqual([]);
  expect(blob).not.toMatch(/data\/catalog\/products_/);
  // The gap is declared rather than left silent.
  expect(campaign.catalog_source).toBe('none');
  expect((campaign.data_gaps || []).join(' ')).toMatch(/^\[DATA REQUIRED BEFORE LAUNCH: product image, /);
});

// ── 2. TENANT ZERO IS UNCHANGED ─────────────────────────────────────────────
//
// A "fix" that switched every brand off would satisfy every assertion above and
// break the product. Tenant zero owns the shipped catalogue and must keep it.

test('tenant zero still resolves its own catalogue photos', () => {
  const rows = shippedRows();
  test.skip(!rows.length, 'no built catalogue on disk — run npm run build');
  const withImage = rows.find((r) => typeof r.i === 'string' && /^https?:\/\//.test(r.i));

  const img = catalogImage.imageFor({ title: withImage.n, handle: withImage.h }, 'US', { brand: ZERO });
  expect(img).toBeTruthy();
  expect(img).toContain(new URL(withImage.i).host);
  expect(catalogImage.handleFor({ handle: withImage.h }, 'US', { brand: ZERO })).toBe(withImage.h);
  expect(catalogImage.imagesFor({ handle: withImage.h }, 'US', { brand: ZERO }).length).toBeGreaterThan(0);
  // The width boost is still applied, so image quality is unchanged too.
  expect(catalogImage.imageFor({ handle: withImage.h }, 'US', { brand: ZERO, width: 1200 })).toContain('width=1200');
});

test('tenant zero is recognised from its own brand record, not a hardcoded slug', () => {
  const defaultBrand = require('../api/_shared/brand-runtime.js').defaultBrand();
  expect(catalogServer.tenantZeroSlug()).toBe(String(defaultBrand.slug || defaultBrand.name || '').toLowerCase());
  expect(catalogServer.isTenantZeroBrand(defaultBrand)).toBe(true);
  expect(catalogServer.isTenantZeroBrand({ is_default: true })).toBe(true);
  expect(catalogServer.isTenantZeroBrand(TOI)).toBe(false);
  // No brand supplied is UNDECIDED, not "yes" — the caller must fall through to
  // the workspace rules rather than treat silence as ownership.
  expect(catalogServer.isTenantZeroBrand(null)).toBeNull();
  expect(catalogServer.isTenantZeroBrand({})).toBeNull();
});

// ── 3. THE CACHE KEY ────────────────────────────────────────────────────────
//
// The old cache was `CACHE[region]` — keyed by region, shared by every brand in
// a warm runtime. A per-workspace read cached the same way would be a leak of
// its own, so the key has to be the workspace.

test('the pinned catalogue is keyed by workspace, so one brand cannot read another\'s', async () => {
  const rowsFor = (ws, titles) => titles.map((t, i) => ({
    workspace_id: ws, region: 'in', handle: `${ws}-${i}`, title: t,
    image_url: `https://cdn.example-${ws}.test/${i}.jpg`, product_url: `https://example-${ws}.test/p/${i}`,
    price: null, collections: [], product_type: '', sku: '', compare_at: null, currency: 'INR',
  }));

  const toiRows = rowsFor(TOI.id, ['City Desk Daily', 'Sports Wrap']).map(catalogServer.fromRow);
  const appleRows = rowsFor(APPLE.id, ['iPhone 17 Pro', 'Mac Studio']).map(catalogServer.fromRow);

  // Pin TOI's catalogue, then ask for APPLE's products inside that scope. The
  // scope key does not match, so it must not be handed TOI's rows.
  await catalogServer.withCatalog({ brand: TOI, workspaceId: TOI.id }, async () => {
    const mine = catalogServer.productsFor('IN', { brand: TOI, workspaceId: TOI.id });
    expect(mine.source).toBe('none');           // nothing was seeded, so nothing is served
    const theirs = catalogServer.productsFor('IN', { brand: APPLE, workspaceId: APPLE.id });
    expect(theirs.products).toEqual([]);
    expect(theirs.source).toBe('none');
  });

  // And the region narrowing keeps a brand's own rows without ever widening
  // across brands.
  expect(catalogServer.forRegion(toiRows, 'IN').map((p) => p.n)).toEqual(['City Desk Daily', 'Sports Wrap']);
  expect(catalogServer.forRegion(toiRows, 'US').map((p) => p.n)).toEqual(['City Desk Daily', 'Sports Wrap']);
  expect(catalogServer.forRegion(appleRows, 'IN').every((p) => !toiRows.some((t) => t.n === p.n))).toBe(true);
});

test('two brands generating concurrently never see each other\'s catalogue', async () => {
  // AsyncLocalStorage, not a module variable: a warm Node runtime serves several
  // requests from one process, and this is the interleaving that would expose a
  // shared variable.
  const seen = {};
  const run = (brand, label) => catalogServer.withCatalog({ brand, workspaceId: brand.id }, async () => {
    await new Promise((r) => setTimeout(r, label === 'a' ? 5 : 1));
    const scope = catalogServer.currentScope();
    seen[label] = { key: scope.key, source: scope.source, img: catalogImage.imageFor({ title: 'City' }, 'IN') };
  });

  await Promise.all([run(TOI, 'a'), run(APPLE, 'b')]);
  expect(seen.a.key).toBe(TOI.id);
  expect(seen.b.key).toBe(APPLE.id);
  expect(seen.a.img).toBeNull();
  expect(seen.b.img).toBeNull();
  // Outside every scope the store is gone, so nothing leaks into the next call.
  expect(catalogServer.currentScope()).toBeNull();
});

test('tenant zero pinned in one continuation does not leak the shipped rows into another', async () => {
  const rows = shippedRows();
  test.skip(!rows.length, 'no built catalogue on disk — run npm run build');
  const title = rows[0].n;

  let zeroImg = null, toiImg = null;
  await Promise.all([
    catalogServer.withCatalog({ brand: ZERO }, async () => {
      await new Promise((r) => setTimeout(r, 4));
      zeroImg = catalogImage.imageFor({ title }, 'US');
    }),
    catalogServer.withCatalog({ brand: TOI, workspaceId: TOI.id }, async () => {
      await new Promise((r) => setTimeout(r, 2));
      toiImg = catalogImage.imageFor({ title }, 'US');
    }),
  ]);
  expect(zeroImg).toBeTruthy();
  expect(toiImg).toBeNull();
});

// ── 4. THE SHIPPED FILES ARE GATED THE SAME WAY AS THE SALES EXPORT ─────────

test('the shipped catalogue is gated by ownsBundledExport, not by a second answer', async () => {
  const mkt = require('../api/_shared/market-analytics.js');
  // The helper takes an explicit workspace so a server job generating FOR a
  // workspace gets that workspace's answer, not the ambient one.
  expect(typeof mkt.ownsBundledExport).toBe('function');
  expect(mkt.ownsBundledExport.length).toBe(1);
  // brand-catalog-server must be the only place the server reads the files.
  const src = fs.readFileSync(path.join(ROOT, 'api/_shared/brand-catalog-server.js'), 'utf8');
  expect(src).toContain("require('./market-analytics.js').ownsBundledExport(");
});

test('no server module reads data/catalog off disk except the one gatekeeper', () => {
  const dir = path.join(ROOT, 'api/_shared');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    if (f === 'brand-catalog-server.js') continue;      // the gatekeeper itself
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // A path join to data/catalog, or a products_<region>.json literal being
    // read, is the pattern that has to stay in exactly one file.
    if (/readFileSync\([^)]*catalog/i.test(src)) offenders.push(f);
    if (/['"`]data['"`],\s*['"`]catalog['"`]/.test(src)) offenders.push(f);
  }
  expect([...new Set(offenders)]).toEqual([]);
});

// ── 5. THE OTHER RESOLVERS ──────────────────────────────────────────────────

test('the brand assistant cites only the active brand\'s products, and says so when it has none', () => {
  const bl = require('../api/_shared/brand-llm.js');
  const out = bl.catalogProducts({ market: 'IN', brand: TOI });
  expect(out.count).toBe(0);
  expect(out.products).toEqual([]);
  expect(out.source).toBe('none');
  // The note must not tell the model these are valid product names when there
  // are none - that sentence is what turned a leak into a confident claim.
  expect(out.note).not.toMatch(/ONLY valid product names/);
  expect(out.note).toMatch(/DATA REQUIRED BEFORE LAUNCH: product catalogue/);
  expect(out.store).toBe('');                    // no store URL on file, none invented

  const rows = shippedRows();
  if (rows.length) {
    const zeroOut = bl.catalogProducts({ market: 'US', brand: ZERO });
    expect(zeroOut.count).toBeGreaterThan(0);    // tenant zero unchanged
    expect(zeroOut.note).toMatch(/ONLY valid product names/);
  }
});

test('the in-app assistant offers no product or storefront link it cannot attribute', () => {
  const jarvis = require('../api/_shared/jarvis.js');
  const rows = shippedRows();
  test.skip(!rows.length, 'no built catalogue on disk — run npm run build');
  const text = `Tell me about the ${rows[0].n}, and open the shop`;

  const foreign = jarvis.detectNavActions('open the shop', text, { market: 'IN', brand: TOI });
  expect(foreign.filter((a) => a.kind === 'product')).toEqual([]);
  for (const a of foreign) expect(a.href).not.toMatch(/knickgasm/i);

  // Tenant zero keeps its product navigation.
  const own = jarvis.detectNavActions('open the shop', text, { market: 'US' });
  expect(own.some((a) => a.kind === 'product')).toBe(true);
});

test('the /lp/:id fallback page renders no product it does not own', () => {
  const { buildFallbackLanding } = require('../api/_shared/landing-fallback.js');
  const html = buildFallbackLanding({ id: 'x', region: 'us', hint: 'city desk', brand: TOI });
  expect(foreignImageUrls(html), 'tenant-zero CDN URLs in a Times of India landing page').toEqual([]);
  expect(html).toContain('The Times of India');

  const rows = shippedRows();
  if (rows.length) {
    const zeroHtml = buildFallbackLanding({ id: 'x', region: 'us', hint: 'air force', brand: ZERO });
    expect(zeroHtml).toMatch(/<img\s/);          // tenant zero still gets a hero photo
  }
});

test('the calendar CSV export lists no product from another brand', () => {
  const ex = require('../api/_shared/calendar-export.js');
  const rows = shippedRows();
  test.skip(!rows.length, 'no built catalogue on disk — run npm run build');

  // Deliberately hostile input: the entry names one of TENANT ZERO'S products.
  // The export may echo back what the caller handed it, but it must not RESOLVE
  // that name into a catalogue row - no photo, no price, no PDP link, and no
  // supporting products lifted from another brand's shelf.
  const csv = ex.buildExportCsv([{
    id: 'e1', date: '2026-09-01', market: 'IN', brand: TOI,
    cohort: { name: 'Nurture', size: 0 },
    heroProduct: { title: rows[0].n, handle: rows[0].h },
  }]);
  expect(foreignImageUrls(csv), 'tenant-zero CDN URLs in a Times of India export').toEqual([]);
  expect(csv).not.toContain(`/products/${rows[0].h}`);
  // Titles OTHER than the one the entry itself named (several catalogue rows
  // share a title, so the echoed hero has to be excluded by value, not index).
  const other = [...new Set(rows.map((r) => r.n))]
    .filter((n) => n && n !== rows[0].n)
    .filter((n) => csv.includes(n));
  expect(other, 'supporting products pulled from another brand\'s catalogue').toEqual([]);
  // The standing instructions in the prompt columns belong to THIS brand.
  expect(csv).not.toMatch(/knickgasm\.com/i);
  expect(csv).toContain('The Times of India');
});

test('the browser resolver and the server resolver agree on who owns the shipped files', () => {
  // brand-catalog.js (client) and brand-catalog-server.js must not drift: both
  // hand the static JSON to tenant zero only.
  const client = fs.readFileSync(path.join(ROOT, 'brand-catalog.js'), 'utf8');
  const clientSlug = (client.match(/SHIPPED_SLUG\s*=\s*'([^']+)'/) || [])[1];
  expect(clientSlug).toBe(catalogServer.tenantZeroSlug());
});

test('the 3D storefront resolves through the shared brand resolver', () => {
  const html = fs.readFileSync(path.join(ROOT, 'storefront-3d.html'), 'utf8');
  expect(html).toContain('/brand-catalog.js');
  expect(html).toContain('window.BrandCatalog');
  // The direct fetch may remain as the signed-out tenant-zero demo path, but it
  // must sit BEHIND the brand-scoped resolver, never in front of it.
  const scopedAt = html.indexOf('brandScopedCatalog()');
  const directAt = html.indexOf("fetch(RC.cat");
  expect(scopedAt).toBeGreaterThan(-1);
  expect(directAt).toBeGreaterThan(scopedAt);
});
