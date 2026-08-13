// site-crawl — what it takes, and more importantly what it refuses.
//
// A catalogue crawler's value is in its refusals. Following one off-site link
// ingests a competitor's product as the brand's own; reading a price out of
// body text invents a catalogue that looks right and is wrong. Both are tested
// here against fixtures, with no network, because that is exactly the
// behaviour that must hold when the network is involved.
//
// Run: npx playwright test tests/site-crawl.spec.js
const { test, expect } = require('@playwright/test');
const crawl = require('../api/_shared/site-crawl.js');

const BRAND = {
  name: 'Northwind Books',
  website: 'https://northwind.example',
  regions: [{ code: 'UK', store_url: 'https://shop.northwind.example' }],
  asset_hosts: ['cdn.northwind.example'],
};

const HOSTS = crawl.allowedHosts(BRAND);

const page = (body) => `<!doctype html><html><head></head><body>${body}</body></html>`;

/** A fixture site: url -> html. Anything not listed is a 404. */
function fixtureFetch(site) {
  return async (url) => {
    const key = url.split('#')[0];
    if (!(key in site)) return { ok: false, status: 404, body: '' };
    return { ok: true, status: 200, body: site[key], url: key };
  };
}

// ── Scope ───────────────────────────────────────────────────────────────────

test('the brand\'s own hosts are in scope and nothing else is', () => {
  expect(crawl.inScope('https://northwind.example/x', HOSTS)).toBe(true);
  expect(crawl.inScope('https://shop.northwind.example/p/1', HOSTS)).toBe(true);
  expect(crawl.inScope('https://cdn.northwind.example/i.jpg', HOSTS)).toBe(true);
  expect(crawl.inScope('https://www.northwind.example/x', HOSTS)).toBe(true);

  // A competitor, a lookalike domain, and a CDN nobody declared.
  expect(crawl.inScope('https://competitor.example/p/1', HOSTS)).toBe(false);
  expect(crawl.inScope('https://northwind.example.evil.com/x', HOSTS)).toBe(false);
  expect(crawl.inScope('https://cdn.shopify.com/i.jpg', HOSTS)).toBe(false);
});

test('off-site links are never queued', () => {
  const html = page(`
    <a href="/about">About</a>
    <a href="https://competitor.example/product/rival">Rival product</a>
    <a href="https://shop.northwind.example/p/1">Our shop</a>
  `);
  const links = crawl.linksFrom(html, 'https://northwind.example/', HOSTS);
  expect(links).toContain('https://northwind.example/about');
  expect(links).toContain('https://shop.northwind.example/p/1');
  expect(links.join(' ')).not.toContain('competitor.example');
});

test('the scope is the BRAND\'s, not a hardcoded tenant list', () => {
  // brand-assets-core ships an ALLOWLIST of one tenant's domains. Reusing it
  // would scope every brand's crawl to that tenant's storefront.
  const hosts = crawl.allowedHosts(BRAND);
  expect([...hosts].join(' ')).not.toMatch(/knickgasm/i);
  expect(hosts.has('northwind.example')).toBe(true);
});

// ── Extraction ──────────────────────────────────────────────────────────────

test('a declared JSON-LD Product is taken in full', () => {
  const html = page(`<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    name: 'The Winter Edition', sku: 'NW-001',
    image: 'https://cdn.northwind.example/winter.jpg',
    description: 'A collected edition.',
    offers: { '@type': 'Offer', price: '24.00', priceCurrency: 'GBP' },
  })}</script>`);
  const { offerings, images } = crawl.extract(html, 'https://northwind.example/p/winter', HOSTS);

  expect(offerings).toHaveLength(1);
  expect(offerings[0]).toMatchObject({
    kind: 'product', name: 'The Winter Edition', sku: 'NW-001',
    price: '24.00', currency: 'GBP', source: 'json-ld:Product',
  });
  // Everything is attributable to the page it came from.
  expect(offerings[0].found_on).toBe('https://northwind.example/p/winter');
  expect(images[0].url).toBe('https://cdn.northwind.example/winter.jpg');
});

test('Events and Articles are recognised, so non-product brands work too', () => {
  const ev = page(`<script type="application/ld+json">${JSON.stringify({
    '@type': 'Event', name: 'Spring Reading', startDate: '2027-03-01T19:00',
    location: { '@type': 'Place', name: 'The Library' },
  })}</script>`);
  const a = crawl.extract(ev, 'https://northwind.example/events/spring', HOSTS).offerings[0];
  expect(a).toMatchObject({ kind: 'event', name: 'Spring Reading', location: 'The Library' });
  expect(a.starts_at).toContain('2027-03-01');

  const art = page(`<script type="application/ld+json">${JSON.stringify({
    '@type': 'NewsArticle', headline: 'What the budget means', datePublished: '2026-08-01',
  })}</script>`);
  expect(crawl.extract(art, 'https://northwind.example/news/budget', HOSTS).offerings[0])
    .toMatchObject({ kind: 'section', name: 'What the budget means' });
});

test('an @graph wrapper and arrays are both handled', () => {
  const html = page(`<script type="application/ld+json">${JSON.stringify({
    '@graph': [{ '@type': 'WebSite' }, { '@type': 'Product', name: 'Graphed', offers: { price: '9' } }],
  })}</script>`);
  expect(crawl.extract(html, 'https://northwind.example/p/g', HOSTS).offerings[0].name).toBe('Graphed');
});

test('a malformed JSON-LD block is skipped, not guessed at', () => {
  const html = page('<script type="application/ld+json">{ this is not json }</script>');
  expect(crawl.extract(html, 'https://northwind.example/x', HOSTS).offerings).toEqual([]);
});

test('prices in prose are NOT read as facts', () => {
  // The whole failure mode this module avoids: a crawler that reads body text
  // produces a catalogue that looks right and is wrong.
  const html = page('<h1>The Winter Edition</h1><p>Only £24.00 this week! SKU NW-001</p>');
  const { offerings } = crawl.extract(html, 'https://northwind.example/p/winter', HOSTS);
  expect(offerings).toEqual([]);
});

test('OpenGraph is used only when JSON-LD described nothing', () => {
  const og = page('') .replace('<head></head>', `<head>
    <meta property="og:type" content="product">
    <meta property="og:title" content="OG Edition">
    <meta property="og:image" content="https://cdn.northwind.example/og.jpg">
    <meta property="product:price:amount" content="19.00">
  </head>`);
  const out = crawl.extract(og, 'https://northwind.example/p/og', HOSTS);
  expect(out.offerings[0]).toMatchObject({ kind: 'product', name: 'OG Edition', price: '19.00', source: 'opengraph' });
});

// ── Images ──────────────────────────────────────────────────────────────────

test('another site\'s images are never collected', () => {
  const html = page(`
    <img src="https://competitor.example/their-product.jpg" alt="Rival">
    <img src="https://cdn.northwind.example/ours.jpg" alt="Our cover">
  `);
  const { images } = crawl.extract(html, 'https://northwind.example/x', HOSTS);
  expect(images).toHaveLength(1);
  expect(images[0].url).toContain('cdn.northwind.example');
  expect(images[0].alt).toBe('Our cover');
});

test('an image with no alt text is not kept', () => {
  // The asset library has to stay describable; an unlabelled file cannot be
  // placed correctly in a generated asset later.
  const html = page('<img src="https://cdn.northwind.example/mystery.jpg">');
  expect(crawl.extract(html, 'https://northwind.example/x', HOSTS).images).toEqual([]);
});

test('relative image and link URLs resolve against the page they were on', () => {
  const html = page('<img src="../img/cover.jpg" alt="Cover"><a href="./next">Next</a>');
  const out = crawl.extract(html, 'https://northwind.example/books/winter/', HOSTS);
  expect(out.images[0].url).toBe('https://northwind.example/books/img/cover.jpg');
  expect(crawl.linksFrom(html, 'https://northwind.example/books/winter/', HOSTS))
    .toContain('https://northwind.example/books/winter/next');
});

// ── Crawl ───────────────────────────────────────────────────────────────────

test('the crawl follows interlinked pages within the brand and collects each', async () => {
  const site = {
    'https://northwind.example/': page('<a href="/p/a">A</a><a href="/p/b">B</a><a href="https://competitor.example/p/x">X</a>'),
    'https://northwind.example/p/a': page(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Book A', offers: { price: '10', priceCurrency: 'GBP' } })}</script>`),
    'https://northwind.example/p/b': page(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Book B', offers: { price: '12', priceCurrency: 'GBP' } })}</script>`),
    'https://competitor.example/p/x': page(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'RIVAL BOOK' })}</script>`),
  };
  const out = await crawl.crawlSite('https://northwind.example/', { brand: BRAND, fetchImpl: fixtureFetch(site) });

  expect(out.ok).toBe(true);
  const names = out.offerings.map((o) => o.name).sort();
  expect(names).toEqual(['Book A', 'Book B']);
  expect(JSON.stringify(out)).not.toContain('RIVAL BOOK');
  expect(out.pages_visited).toBe(3);
});

test('a start URL outside the brand is refused outright', async () => {
  const out = await crawl.crawlSite('https://competitor.example/', { brand: BRAND, fetchImpl: fixtureFetch({}) });
  expect(out.ok).toBe(false);
  expect(out.error).toBe('start_url_out_of_scope');
  expect(out.offerings).toEqual([]);
});

test('a partial crawl says so rather than passing as the whole catalogue', async () => {
  const site = { 'https://northwind.example/': page('<a href="/p/a">A</a>'), 'https://northwind.example/p/a': page('') };
  const out = await crawl.crawlSite('https://northwind.example/', {
    brand: BRAND, fetchImpl: fixtureFetch(site), maxPages: 1,
  });
  expect(out.stopped).toBe('page_limit');
  expect(out.coverage_note).toMatch(/PARTIAL view/);

  const full = await crawl.crawlSite('https://northwind.example/', { brand: BRAND, fetchImpl: fixtureFetch(site) });
  expect(full.stopped).toBe('exhausted');
  expect(full.coverage_note).toMatch(/Every reachable page/);
});

test('robots.txt disallow rules are honoured', async () => {
  const site = {
    'https://northwind.example/robots.txt': 'User-agent: *\nDisallow: /private\n',
    'https://northwind.example/': page('<a href="/private/secret">S</a><a href="/p/a">A</a>'),
    'https://northwind.example/private/secret': page(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'SECRET' })}</script>`),
    'https://northwind.example/p/a': page(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Book A' })}</script>`),
  };
  const out = await crawl.crawlSite('https://northwind.example/', { brand: BRAND, fetchImpl: fixtureFetch(site) });
  expect(JSON.stringify(out.offerings)).not.toContain('SECRET');
  expect(out.offerings.map((o) => o.name)).toContain('Book A');
  expect(out.notes.join(' ')).toMatch(/robots\.txt/);
});

test('duplicate sightings collapse to one row', async () => {
  const p = page(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Book A', url: 'https://northwind.example/p/a' })}</script>`);
  const site = {
    'https://northwind.example/': page('<a href="/p/a">A</a><a href="/dup">dup</a>'),
    'https://northwind.example/p/a': p,
    'https://northwind.example/dup': p,
  };
  const out = await crawl.crawlSite('https://northwind.example/', { brand: BRAND, fetchImpl: fixtureFetch(site) });
  expect(out.offerings.filter((o) => o.name === 'Book A')).toHaveLength(1);
});
