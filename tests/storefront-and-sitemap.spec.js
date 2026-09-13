/**
 * WHICH STORE IS THIS, and DID WE READ ALL OF IT.
 * ---------------------------------------------------------------------------
 * Two gaps in brand setup-from-URL, both found by RUNNING the pipeline rather
 * than reading it, and both measured before anything was written.
 *
 * 1. THE STORE PLATFORM WAS NEVER DETECTED. A fixture declaring Shopify four
 *    separate ways - `<meta name="generator" content="Shopify">`,
 *    `Shopify.shop = "…myshopify.com"`, a `cdn.shopify.com` script and
 *    `class="shopify-section"` - produced an extraction report containing the
 *    string "shopify" ZERO times. Four published declarations, none read.
 *    The cost was not cosmetic: importCatalog established the catalogue route
 *    by firing /products.json and reading the failure, so every non-Shopify
 *    store paid a wasted request and its owner was told "Public product feed
 *    not available at that URL" - a sentence that is true of every WooCommerce
 *    and Magento store on earth and reads as a fault in their site.
 *
 * 2. THE SITE'S OWN URL LIST WAS FETCHED AND THROWN AWAY. site-crawl already
 *    fetched robots.txt on every run, and its parser read `user-agent` and
 *    `disallow` and discarded everything else - including the `Sitemap:`
 *    directive pointing at the site's own declaration of its own pages. With a
 *    20-product fixture whose home page links ONE product and whose sitemap
 *    lists all 20, the crawl found 1 of 20. That is the normal shape of a
 *    store: products live behind a paginated grid a depth-limited walk never
 *    unrolls.
 *
 * Both are asserted on BEHAVIOUR - the report a real extraction returns and the
 * offerings a real crawl collects - never on the source of the modules.
 *
 * Run: npx playwright test tests/storefront-and-sitemap.spec.js
 */
const { test, expect } = require('@playwright/test');
const crawl = require('../api/_shared/site-crawl.js');
const bx = require('../api/_shared/brand-extract.js');
const sd = require('../api/_shared/storefront-detect.js');

const page = (b) => ({ body: b, contentType: 'text/html; charset=utf-8' });
const xml = (b) => ({ body: b, contentType: 'application/xml' });
const txt = (b) => ({ body: b, contentType: 'text/plain' });
const sheet = (b) => ({ body: b, contentType: 'text/css' });

const fetchOf = (site, log) => async (u) => {
  const k = String(u).split('#')[0];
  if (log) log.push(k);
  const row = site[k] || site[k.replace(/\/$/, '')];
  return row
    ? { ok: true, status: 200, body: row.body, url: k, contentType: row.contentType }
    : { ok: false, status: 404, body: '', url: k, contentType: 'text/plain' };
};

const HOST = 'https://tealight.example';
const BRAND = { website: HOST };

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE STORE PLATFORM
   ═══════════════════════════════════════════════════════════════════════════ */

// Every way a real Shopify storefront announces itself, on one page.
const SHOPIFY_HOME = `<!doctype html><html><head>
<title>Tealight Co</title>
<meta name="generator" content="Shopify">
<link rel="stylesheet" href="/theme.css">
<script>var Shopify = Shopify || {}; Shopify.shop = "tealight-co.myshopify.com";</script>
<script src="https://cdn.shopify.com/s/files/1/0001/t/1/assets/theme.js"></script>
</head><body class="shopify-section template-index"><h1>Tealight Co</h1>
<a href="/about">About</a></body></html>`;

test('the store platform is read off what the site publishes about itself', async () => {
  const site = {
    [`${HOST}/`]: page(SHOPIFY_HOME),
    [`${HOST}/theme.css`]: sheet(':root{--brand-primary:#2E6F5E}'),
    [`${HOST}/about`]: page('<h1>About</h1>'),
    [`${HOST}/robots.txt`]: txt('User-agent: *\nAllow: /'),
  };
  const r = await bx.extractBrand(`${HOST}/`, { fetchImpl: fetchOf(site) });

  const s = r.fields.storefront;
  expect(s.detected, 'a site declaring Shopify four ways was not detected as a store').toBe(true);
  expect(s.platform.id).toBe('shopify');
  expect(s.platform.name).toBe('Shopify');
  expect(s.platform.kind).toBe('commerce');
  // The strongest signal wins, not the most numerous one.
  expect(s.platform.confidence).toBe('declared');
  // Provenance, exactly like every other extracted value.
  expect(s.platform.source_url).toBe(`${HOST}/`);
  expect(s.platform.why).toMatch(/generator meta tag/i);
  expect(s.marker).toBe('');
  // The store's own identifier on its platform, kept because it is the value an
  // operator pastes into a Shopify integration.
  expect(s.platform.store_handle).toBe('tealight-co.myshopify.com');
  // And the whole point: the catalogue route is now a decision with a reason.
  expect(s.catalog_route.kind).toBe('shopify_public');
  expect(s.catalog_route.path).toBe('/products.json');
});

test('a non-Shopify store routes to the site crawl and is NOT told its feed is broken', async () => {
  const site = {
    [`${HOST}/`]: page(`<!doctype html><html><head><title>Tealight</title>
      <meta name="generator" content="WooCommerce 8.4.0">
      <meta name="generator" content="WordPress 6.5">
      <script src="/wp-content/plugins/woocommerce/assets/js/frontend.js"></script>
      </head><body class="woocommerce-page"><h1>Tealight</h1></body></html>`),
    [`${HOST}/robots.txt`]: txt('User-agent: *\nAllow: /'),
  };
  const r = await bx.extractBrand(`${HOST}/`, { fetchImpl: fetchOf(site) });
  const s = r.fields.storefront;

  expect(s.detected).toBe(true);
  expect(s.platform.id).toBe('woocommerce');
  // A WooCommerce site is also a WordPress site. Collapsing the two would route
  // the catalogue import as if the brand had no store at all.
  expect(s.cms).not.toBeNull();
  expect(s.cms.id).toBe('wordpress');

  // No endpoint this repo cannot source. Detecting a platform does not conjure
  // a feed for it.
  expect(s.catalog_route.kind).toBe('site_crawl');
  expect(s.catalog_route.path).toBeNull();
  expect(s.catalog_route.note).toMatch(/WooCommerce publishes no unauthenticated product feed/i);
  // And the sentence an operator reads must not imply their store is at fault.
  expect(s.catalog_route.note).toMatch(/Nothing is lost by this/i);
});

test('"no platform declared" is a statement about the signals, never "no store"', async () => {
  const site = {
    [`${HOST}/`]: page('<!doctype html><html><head><title>Tealight</title></head><body><h1>Tealight</h1></body></html>'),
    [`${HOST}/robots.txt`]: txt('User-agent: *\nAllow: /'),
  };
  const r = await bx.extractBrand(`${HOST}/`, { fetchImpl: fetchOf(site) });
  const s = r.fields.storefront;

  expect(s.detected).toBe(false);
  expect(s.platform).toBeNull();
  expect(s.marker).toMatch(/DATA REQUIRED BEFORE LAUNCH: store platform/);
  // The exact distinction this module exists to keep.
  expect(s.note).toMatch(/statement about the SIGNALS, not about the site/i);
  expect(s.note).toMatch(/headless storefront|bespoke build/i);
  // Not detecting a platform must never block the import.
  expect(s.catalog_route.kind).toBe('site_crawl');
  expect(s.catalog_route.note).toMatch(/does not depend on knowing the platform/i);
  // And it must not be reported as an absence of a store.
  expect(s.note).not.toMatch(/no store (?:was )?found/i);
});

test('a platform name in prose is not a platform declaration', async () => {
  // The signal table matches a generator tag, a platform's own global object,
  // its own CDN host and its own namespaced classes. A blog post ABOUT Shopify
  // is none of those, and reading the page body for the word would make every
  // agency site a Shopify store.
  const site = {
    [`${HOST}/`]: page(`<!doctype html><html><head><title>Tealight</title></head><body>
      <h1>Why we left Shopify for a custom build</h1>
      <p>We used to run on Shopify. We no longer do.</p></body></html>`),
    [`${HOST}/robots.txt`]: txt('User-agent: *\nAllow: /'),
  };
  const r = await bx.extractBrand(`${HOST}/`, { fetchImpl: fetchOf(site) });
  expect(r.fields.storefront.detected).toBe(false);
});

test('two commerce platforms at once is reported, not resolved', async () => {
  const pages = [[
    `${HOST}/`,
    `<meta name="generator" content="Shopify">
     <script src="/wp-content/plugins/woocommerce/assets/js/frontend.js"></script>`,
  ]];
  const s = sd.detectStorefront(pages);
  expect(s.conflicts).toHaveLength(1);
  expect(s.conflicts[0].message).toMatch(/More than one commerce platform is declared/i);
  expect(s.conflicts[0].candidates.map((c) => c.id).sort()).toEqual(['shopify', 'woocommerce']);
  // Reported AND still routed, so a conflict never leaves the import with
  // nowhere to go.
  expect(s.catalog_route.kind).toBeTruthy();
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. THE SITE'S OWN URL LIST
   ═══════════════════════════════════════════════════════════════════════════ */

const N = 20;
const product = (i) => page(`<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Product', name: `Tea ${i}`, sku: `T-${i}`,
  offers: { '@type': 'Offer', price: String(10 + i), priceCurrency: 'GBP' },
})}</script><h1>Tea ${i}</h1>`);

/** A store whose home page links ONE product and whose sitemap lists all 20. */
function storeFixture({ withSitemap, robotsDeclares, extra }) {
  const site = {
    [`${HOST}/`]: page('<a href="/products/tea-1">Featured</a><a href="/about">About</a>'),
    [`${HOST}/about`]: page('<p>About us.</p>'),
    [`${HOST}/robots.txt`]: txt(
      (robotsDeclares ? `Sitemap: ${HOST}/sitemap.xml\n` : '') + 'User-agent: *\nDisallow: /cart\n'),
  };
  for (let i = 1; i <= N; i++) site[`${HOST}/products/tea-${i}`] = product(i);
  if (withSitemap) {
    const locs = [];
    for (let i = 1; i <= N; i++) locs.push(`<url><loc>${HOST}/products/tea-${i}</loc></url>`);
    site[`${HOST}/sitemap.xml`] = xml(
      `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.join('')}</urlset>`);
  }
  return Object.assign(site, extra || {});
}

test('the catalogue is read from the site OWN declared URL list, not the home nav', async () => {
  const without = await crawl.crawlSite(`${HOST}/`, {
    brand: BRAND, fetchImpl: fetchOf(storeFixture({ withSitemap: false, robotsDeclares: false })),
  });
  const withSm = await crawl.crawlSite(`${HOST}/`, {
    brand: BRAND, fetchImpl: fetchOf(storeFixture({ withSitemap: true, robotsDeclares: true })),
  });

  // The measurement that motivated this, asserted rather than described.
  expect(without.offerings, 'a home-page walk should reach only the featured product').toHaveLength(1);
  expect(withSm.offerings, 'the sitemap declares all 20 products and every one should be read').toHaveLength(N);
  expect(withSm.offerings.map((o) => o.name).sort()).toContain('Tea 17');
});

test('the Sitemap directive is read even when it sits ABOVE the first User-agent line', async () => {
  // It is group-independent in the robots.txt spec and conventionally written at
  // the top of the file. Reading it inside the `*`-group gate - the obvious
  // place, right beside `disallow` - discards it on the most common layout there
  // is, and the crawl would silently fall back to the home-page walk.
  const site = storeFixture({ withSitemap: true, robotsDeclares: true });
  const out = await crawl.crawlSite(`${HOST}/`, { brand: BRAND, fetchImpl: fetchOf(site) });

  expect(out.sitemap.found).toBe(true);
  expect(out.sitemap.from).toBe('robots.txt Sitemap directive');
  expect(out.sitemap.declared).toBe(N);
  expect(out.sitemap.seeded).toBe(N);
  expect(out.offerings).toHaveLength(N);
});

test('robots.txt Disallow still applies to sitemap-declared URLs', async () => {
  // A sitemap is the site saying "these are my pages". It is not the site
  // withdrawing a Disallow, and a crawler that treated it that way would fetch
  // exactly the paths the operator asked it not to.
  const site = storeFixture({ withSitemap: true, robotsDeclares: true });
  site[`${HOST}/robots.txt`] = txt(`Sitemap: ${HOST}/sitemap.xml\nUser-agent: *\nDisallow: /products/tea-7\n`);
  const log = [];
  const out = await crawl.crawlSite(`${HOST}/`, { brand: BRAND, fetchImpl: fetchOf(site, log) });

  expect(log).not.toContain(`${HOST}/products/tea-7`);
  expect(out.offerings.map((o) => o.name)).not.toContain('Tea 7');
  expect(out.offerings).toHaveLength(N - 1);
  expect(out.notes.join(' ')).toMatch(/skipped \(robots\.txt\)/);
});

test('a Disallow is a PREFIX rule over sitemap URLs, not an exact path', async () => {
  // `Disallow: /products/tea-1` covers tea-1 AND tea-10..tea-19, which is what
  // the robots.txt spec says and what the crawler already did. It is asserted
  // rather than assumed because the seeded-URL path is new and a rule applied
  // as an exact match there would quietly fetch eleven disallowed pages.
  const site = storeFixture({ withSitemap: true, robotsDeclares: true });
  site[`${HOST}/robots.txt`] = txt(`Sitemap: ${HOST}/sitemap.xml\nUser-agent: *\nDisallow: /products/tea-1\n`);
  const out = await crawl.crawlSite(`${HOST}/`, { brand: BRAND, fetchImpl: fetchOf(site) });

  const names = out.offerings.map((o) => o.name);
  expect(names).not.toContain('Tea 1');
  expect(names).not.toContain('Tea 13');
  expect(names).toContain('Tea 2');
  expect(out.offerings).toHaveLength(9);   // 20 minus tea-1 and tea-10..tea-19
});

test('brand-extract honours robots.txt — robots.txt is not a page and must not go through the page filter', async () => {
  // It never did. brand-extract wraps its fetcher to keep non-HTML out of the
  // page reader, which is correct and necessary — and robots.txt is text/plain,
  // so every robots.txt read as unreachable, the disallow list came back empty,
  // and the user-agent this module sends ("respects robots.txt") was not true.
  // Nothing errored. Only executing it shows this.
  const site = {
    [`${HOST}/`]: page('<html><head><title>T</title></head><body><a href="/secret">S</a><a href="/open">O</a></body></html>'),
    [`${HOST}/secret`]: page('<html><head><title>SECRET</title></head><body>hidden</body></html>'),
    [`${HOST}/open`]: page('<html><head><title>Open</title></head><body>ok</body></html>'),
    [`${HOST}/robots.txt`]: txt('User-agent: *\nDisallow: /secret\n'),
  };
  const log = [];
  const r = await bx.extractBrand(`${HOST}/`, { fetchImpl: fetchOf(site, log) });

  expect(log).not.toContain(`${HOST}/secret`);
  expect(r.pages).not.toContain(`${HOST}/secret`);
  expect(r.pages).toContain(`${HOST}/open`);
});

test('a sitemap on another host is refused, however robots.txt declares it', async () => {
  // robots.txt may legally name a sitemap on another host. Fetching one would
  // take a different company's URL list as this brand's - the single worst
  // thing this crawler can do, arrived at without following an off-site link.
  const site = storeFixture({ withSitemap: false, robotsDeclares: false });
  site[`${HOST}/robots.txt`] = txt('Sitemap: https://competitor.example/sitemap.xml\nUser-agent: *\n');
  site['https://competitor.example/sitemap.xml'] = xml(
    `<?xml version="1.0"?><urlset><url><loc>https://competitor.example/products/rival</loc></url></urlset>`);
  site['https://competitor.example/products/rival'] = product(99);

  const log = [];
  const out = await crawl.crawlSite(`${HOST}/`, { brand: BRAND, fetchImpl: fetchOf(site, log) });

  expect(log).not.toContain('https://competitor.example/sitemap.xml');
  expect(out.sitemap.found).toBe(false);
  expect(JSON.stringify(out)).not.toContain('rival');
  expect(out.notes.join(' ')).toMatch(/sitemap off-origin/i);
});

test('a sitemap index is followed one level to its children', async () => {
  const site = storeFixture({ withSitemap: false, robotsDeclares: true });
  site[`${HOST}/sitemap.xml`] = xml(`<?xml version="1.0"?><sitemapindex>
    <sitemap><loc>${HOST}/sitemap-products.xml</loc></sitemap></sitemapindex>`);
  const locs = [];
  for (let i = 1; i <= N; i++) locs.push(`<url><loc>${HOST}/products/tea-${i}</loc></url>`);
  site[`${HOST}/sitemap-products.xml`] = xml(`<?xml version="1.0"?><urlset>${locs.join('')}</urlset>`);

  const out = await crawl.crawlSite(`${HOST}/`, { brand: BRAND, fetchImpl: fetchOf(site) });
  expect(out.sitemap.sources.map((s) => s.kind)).toEqual(['index', 'urlset']);
  expect(out.offerings).toHaveLength(N);
});

test('"no sitemap" and "sitemap not checked" are different answers', async () => {
  const none = await crawl.crawlSite(`${HOST}/`, {
    brand: BRAND, fetchImpl: fetchOf(storeFixture({ withSitemap: false, robotsDeclares: false })),
  });
  expect(none.sitemap.checked).toBe(true);
  expect(none.sitemap.found).toBe(false);
  expect(none.coverage_note).toMatch(/publishes no sitemap/i);

  // A RESUMED batch arrives with the frontier batch one persisted. Re-reading
  // the sitemap there would re-queue pages already visited and spend the whole
  // budget arriving where it started.
  const resumed = await crawl.crawlSite(`${HOST}/`, {
    brand: BRAND, fetchImpl: fetchOf(storeFixture({ withSitemap: true, robotsDeclares: true })),
    frontier: [{ url: `${HOST}/about`, depth: 1 }],
  });
  expect(resumed.sitemap.checked).toBe(false);
  expect(resumed.sitemap.found).toBe(false);
});

test('a page count is reported AS COVERAGE, against what the site declares', async () => {
  // "14 pages read" is excellent coverage of a 14-page site and 2% of a
  // 700-page one. Only the site's own declaration can tell the two apart, and
  // only the second number tells an operator to raise the budget.
  const out = await crawl.crawlSite(`${HOST}/`, {
    brand: BRAND, maxPages: 6,
    fetchImpl: fetchOf(storeFixture({ withSitemap: true, robotsDeclares: true })),
  });
  expect(out.stopped).toBe('page_limit');
  expect(out.coverage_note).toMatch(/sitemap declares 20 URL\(s\)/);
  expect(out.coverage_note).toMatch(/PARTIAL view of the site/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. THEY MEET IN THE EXTRACTION REPORT
   ═══════════════════════════════════════════════════════════════════════════ */

test('one crawl serves both: no extra request is opened for either', async () => {
  const site = storeFixture({
    withSitemap: true, robotsDeclares: true,
    extra: { [`${HOST}/`]: page(SHOPIFY_HOME), [`${HOST}/theme.css`]: sheet(':root{--brand-primary:#2E6F5E}') },
  });
  const log = [];
  const r = await bx.extractBrand(`${HOST}/`, { fetchImpl: fetchOf(site, log) });

  expect(r.fields.storefront.detected).toBe(true);
  expect(r.sitemap.found).toBe(true);

  // robots.txt and sitemap.xml are fetched exactly once each, and every page is
  // fetched at most once: both readers ride the one crawl rather than each
  // running their own with their own copy of the scope and robots rules.
  const count = (u) => log.filter((x) => x === u).length;
  expect(count(`${HOST}/robots.txt`)).toBe(1);
  expect(count(`${HOST}/sitemap.xml`)).toBe(1);
  expect(count(`${HOST}/about`)).toBeLessThanOrEqual(1);
});
