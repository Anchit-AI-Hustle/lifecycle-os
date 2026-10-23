'use strict';
/**
 * What a brand sells, and how each offering is doing, from what its own store
 * STATES (2026-10-23). Rewritten from the first version (#315), which asserted
 * invented values: a 4.9 rating and 1,240 reviews defaulted onto any product a
 * description called "popular", "#1 Bestseller" on the first three rows, and
 * claim phrases relabelled ("chemical free" became "No Preservatives").
 *
 * The DeliChic defects, each modelled by `meatshop.co.in` in
 * tests/lib/catalog-fixture-stores.js and driven through the SHIPPED import
 * (brand-workspace-core.rowsFromStore):
 *   - three WordPress blog posts on the home page were imported as products
 *     ("57 of 55");
 *   - the menu's "Turkey" (a meat) became market TR, and the record's typo'd
 *     IN store URL (/produc) was read as IN's store;
 *   - nothing said which products the store itself sells most.
 */
const { test, expect } = require('@playwright/test');
const { startStores } = require('./lib/catalog-fixture-stores.js');
const core = require('../api/_shared/brand-workspace-core.js');
const imp = require('../api/_shared/catalog-import.js');
const extract = require('../api/_shared/brand-extract.js');
const intel = require('../api/_shared/offering-intelligence.js');
const kinds = require('../api/_shared/offering-kinds.js');
const oc = require('../api/_shared/offering-campaign.js');
const plan = require('../api/_shared/smart-brain-plan.js');

test.describe.configure({ mode: 'serial' });

let st;
test.beforeAll(async () => { st = await startStores(); });
test.afterAll(async () => { if (st) { st.restore(); await st.close(); } });

const BRAND = {
  name: 'Meat Shop', website: 'https://meatshop.co.in',
  regions: [
    { code: 'IN', currency: 'INR', home: true, store_url: 'https://meatshop.co.in/produc' },
    { code: 'TR', currency: 'TRY', store_url: 'https://meatshop.co.in/category/turkey' },
  ],
};

async function importAll() {
  st.reset();
  st.install();
  try {
    let cursor = null, out;
    for (let i = 0; i < 8; i++) {
      out = await core.rowsFromStore('https://meatshop.co.in', 'IN', BRAND, { cursor, budgetMs: 25000 });
      cursor = out.cursor;
      if (!cursor || out.complete) break;
    }
    return out;
  } finally { st.restore(); }
}

test('a WooCommerce store: every product read, no blog post, no market from a meat called Turkey', async () => {
  const truth = st.stores['meatshop.co.in'].truth;
  const out = await importAll();
  expect(out.rows.length, 'every product the product sitemap declares, and nothing else').toBe(truth.products);
  for (const r of out.rows) {
    expect(r.product_url).toMatch(/\/product\//);
    expect(r.region).toBe('in');
  }
  expect(out.markets.map((m) => m.code)).toEqual(['IN']);
  const said = out.coverage.sentences.join(' ');
  expect(said).toContain('(https://meatshop.co.in/produc) is a page of the site, not a regional store');
  expect(said).toContain('(https://meatshop.co.in/category/turkey) is a page of the site, not a regional store');
  // The home page's blog cards, read directly, are not rows either.
  const home = await (async () => { st.install(); try { return await (await fetch('https://meatshop.co.in/')).text(); } finally { st.restore(); } })();
  const got = imp.rowFromPage(home, 'https://meatshop.co.in/', { region: 'in', source: 'sitemap_jsonld' });
  expect(got.rows || [], 'a blog post card is not a product').toEqual([]);
});

test('the store\'s OWN popularity order ranks the products; a description saying "popular" ranks nothing', async () => {
  const truth = st.stores['meatshop.co.in'].truth;
  const out = await importAll();
  const first = out.rows.find((r) => r.metrics && r.metrics.popularity_rank === 1);
  expect(first && first.product_url).toContain(truth.most_popular);
  expect(first.metrics.popularity_basis).toContain('Sort by popularity');
  expect(first.metrics.popularity_source).toBe('https://meatshop.co.in/shop/?orderby=popularity');
  // Product 5's description says "Our most popular cut": the store ranks it 8th.
  const five = out.rows.find((r) => /chicken-cut-05/.test(r.product_url));
  expect(five.metrics.popularity_rank).toBe(8);
  expect(five.metrics.bestseller).toBeUndefined();
  // The facts ride in raw.facts (the jsonb every store keeps), as stated.
  expect(five.raw.facts.unit_spec).toBe('500gm'.replace('gm', 'g'));
  expect(five.raw.facts.servings).toBe('Serves 2-3');
  expect(five.raw.facts.claims).toEqual(['Antibiotic residue free']);
  expect(five.raw.facts.metrics.popularity_rank).toBe(8);
  // A rating only where a page states one.
  expect(out.rows.filter((r) => r.metrics && r.metrics.rating != null).length).toBe(truth.rated);
  expect(out.coverage.sentences.join(' ')).toContain('Most popular: ranked by the store\'s own "Sort by popularity"');
});

test('a country name as link text is a market only when the link\'s own address says so', () => {
  const html = '<a href="https://meatshop.co.in/category/turkey/">Turkey</a><a href="https://meatshop.co.in/contact/us/">Contact us</a>'
    + '<a href="https://meatshop.co.in/en-tr/">Turkey</a><a href="https://shop.example/?country=GB">United Kingdom</a>';
  const r = extract.regionCandidates({ html, url: 'https://meatshop.co.in/', meta: {}, ld: [] });
  const codes = r.regions.map((x) => [x.code, x.store_url]);
  expect(codes).toEqual([['TR', 'https://meatshop.co.in/en-tr/'], ['GB', 'https://shop.example/?country=GB']]);
});

test('analysis ranks only by what the store states, and says what it needs for the rest', async () => {
  const truth = st.stores['meatshop.co.in'].truth;
  const out = await importAll();
  const a = intel.analyzeCatalogOfferings(out.rows, BRAND);
  expect(a.sells.kind).toBe('product');
  expect(a.sells.basis).toContain('12 products read from Meat Shop\'s own site');
  expect(a.rankings.most_popular.items[0].url).toContain(truth.most_popular);
  expect(a.rankings.top_rated.items.length).toBe(truth.rated);
  expect(a.rankings.most_viewed.items).toEqual([]);
  expect(a.rankings.most_viewed.missing).toBe('[DATA REQUIRED BEFORE LAUNCH: view or read counts, Meat Shop]');
  expect(a.most_engaged.item.url).toContain(truth.most_popular);
  // Nothing defaulted: an unrated product has no rating, no reviews, no views.
  const unrated = a.offerings.find((o) => o.rating == null);
  expect(unrated.reviews_count).toBeNull();
  expect(unrated.views).toBeNull();
  expect(a.offerings.find((o) => /chicken-cut-12/.test(o.url)).badge).toBe('Most popular on meatshop.co.in');
  expect(a.offerings.find((o) => /chicken-cut-05/.test(o.url)).badge).toBeNull();
  // Units in words, prices as the page states them.
  const twelve = a.offerings.find((o) => /chicken-cut-12/.test(o.url));
  expect(twelve.price_display, 'the page states no compare-at price, so none is shown').toBe('₹220 for 500 grams');
  expect(intel.formatPriceWithUnit(160, 180, 'INR', '500g')).toBe('₹160 for 500 grams (was ₹180, save ₹20)');
  expect(a.coverage_note).toContain('a rating on 4');
});

test('a media brand sells stories; its ranking is the reads each page states', () => {
  const html = `<!doctype html><html><head><title>Chip sovereignty</title><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: 'Chip sovereignty, explained', author: { '@type': 'Person', name: 'A. Writer' },
    datePublished: '2026-10-20T08:00:00Z', wordCount: 1400, interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ReadAction', userInteractionCount: 42000 },
  })}</script></head><body></body></html>`;
  const row = imp.rowFromPage(html, 'https://brief.example/chips', { region: 'us', source: 'sitemap_jsonld' }).row;
  expect(row.offering_kind).toBe('story');
  expect(row.read_time).toBe('7 min read');
  expect(row.metrics.views).toBe(42000);
  expect(row.metrics.engagement_score).toBeUndefined();
  const other = Object.assign({}, row, { title: 'Another story', product_url: 'https://brief.example/other', metrics: {} });
  const a = intel.analyzeCatalogOfferings([other, row], { name: 'Brief' });
  expect(a.sells.kind).toBe('story');
  expect(a.rankings.most_viewed.items.map((x) => x.title)).toEqual(['Chip sovereignty, explained']);
  const show = intel.showcaseFor(a.rankings.most_viewed.items[0], 'email');
  expect(show.byline).toBe('By A. Writer · 7 min read');
  expect(show.proof).toBe('42,000 reads');
  expect(show.price).toBeUndefined();
});

test('an offering keeps its page, facts and metrics into the send brief', () => {
  const o = kinds.normalizeOffering({ kind: 'product', name: 'Chicken Curry Cut', price: 160, compare_at: 180, currency: 'INR', unit_spec: '500g', url: 'https://meatshop.co.in/product/curry-cut/',
    claims: ['Antibiotic residue free'], metrics: { popularity_rank: 1, popularity_of: 12, popularity_basis: 'the store\'s own "Sort by popularity"' } });
  expect(o.url).toBe('https://meatshop.co.in/product/curry-cut/');
  const lines = oc.planSend(o, '2026-11-01').promptLines.join('\n');
  expect(lines).toContain('price INR 160 (was 180), size 500 grams');
  expect(lines).toContain('Antibiotic residue free');
  expect(lines).toContain('#1 of 12 in the store\'s own "Sort by popularity"');
  expect(lines).toContain('linking to https://meatshop.co.in/product/curry-cut/');
  expect(kinds.normalizeOffering({ kind: 'story', name: 'A story', author: 'A. Writer', url: 'https://x.example/s' }).kind).toBe('story');
});

test('the landing page badge is a stated fact, never a stored or default "#1 Bestseller"', () => {
  const base = { market: 'IN', brand: { name: 'Meat Shop', website: 'https://meatshop.co.in', regions: [{ code: 'IN', currency: 'INR', home: true, store_url: 'https://meatshop.co.in' }] }, cta: 'Shop now' };
  const copy = { landing: { hero_headline: 'Curry cut, cut fresh daily', hero_sub: 'Antibiotic residue free.', cta: 'Shop now', why_bullets: [] } };
  const ranked = plan.lpHtml(Object.assign({}, base, { heroProduct: { title: 'Chicken Cut 12 (500gm)', product_url: 'https://meatshop.co.in/product/chicken-cut-12-500gm/', price: 220,
    metrics: { popularity_rank: 1, popularity_of: 12, popularity_basis: 'x', popularity_source: 'https://meatshop.co.in/shop/?orderby=popularity' } } }), copy, 'c1', null);
  expect(ranked).toContain('Most popular on meatshop.co.in');
  const claimed = plan.lpHtml(Object.assign({}, base, { heroProduct: { title: 'Chicken Cut 05', price: 150, badge: '🔥 #1 Bestseller • Most Ordered Cut', metrics: { bestseller: true } } }), copy, 'c2', null);
  expect(claimed).not.toContain('Bestseller');
  expect(claimed).not.toContain('hero-badge');
});
