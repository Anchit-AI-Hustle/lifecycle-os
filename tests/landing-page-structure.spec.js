// The long-form landing page (2026-10-24). The operator, with a tea brand's own
// landing pages and reusable-section library: "ensure proper well thought of
// structure of landing pages ... implement it for any brand". The page follows
// that structure - offer bar, hero, reasons, details, a buy box against the
// compare-at, the other products, reviews, who the brand is, questions, a
// closing button, the legal footer - and draws each section ONLY from what the
// brand or its catalogue states: nothing invented to fill one (no rating, no
// countdown, no stock level, no gift, no study), and each claim said once.
//
// Executed: Smart Brain's shipped buildCampaign (template path) for a brand
// with claims, a description and a product with a compare-at and servings, and
// for a bare brand with none of those; the pages rendered in Chromium at 1280
// and 390.
//
// Run: npx playwright test tests/landing-page-structure.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];
const CLAIMS = ['Free shipping across India', '30-day easy returns', 'Single-estate teas', 'Packed within days of picking'];
const ABOUT = 'Leafline sources single-estate teas directly from family gardens in the hills and packs them within days of picking.';
const RICH = {
  id: 'device:leafline', slug: 'leafline', name: 'Leafline Tea', website: 'https://www.leafline.example', description: ABOUT, claims: CLAIMS,
  palette: { primary: '#1F4A33', accent: '#C9A227', ink: '#1A1A1A', surface: '#FFFFFF' },
  regions: [{ code: 'IN', currency: 'INR', store_url: 'https://www.leafline.example', home: true }],
};
const P = (t, n, price, extra) => Object.assign({ sku: 'S' + n, title: t, handle: 'p' + n, image: `https://www.leafline.example/img/${n}.jpg`, price, url: `https://www.leafline.example/p${n}.html` }, extra || {});
const slot = (brand, hero) => ({
  id: 'lf-1', date: '2026-10-28', market: 'IN', objective: 'reactivation', brand,
  cohort: { name: 'At Risk', size: null, estimated: true }, channels: ['email', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 },
  heroProduct: hero,
  supportingProducts: [P('Assam Breakfast Black Tea', 2, 549), P('Nilgiri Green Tea', 3, 499)],
});

async function build(entry) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return await require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js')).buildCampaign(JSON.parse(JSON.stringify(entry)), smartConfig({}), { noLLM: true, withCreatives: false });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const textOf = (built) => String(built || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<title>[\s\S]*?<\/title>/i, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const count = (hay, needle) => String(hay).split(needle).length - 1;
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#9b8"/></svg>';

test('a brand with stated facts gets every section those facts fill, each claim once, nothing invented', async ({ page }) => {
  const c = await build(slot(RICH, P('Highland First Flush Black Tea', 1, 759, { compare_at: 999, servings: 50, unit_spec: '100 grams' })));
  const a = c.assets.landing_pages.find((l) => l.variant === 'A');
  const built = a.html; const t = textOf(built);
  expect(built, 'offer bar').toMatch(/class="annc">Free shipping across India</);
  expect(built, 'buy box').toMatch(/<section class="sec buy"/);
  expect(t).toMatch(/₹759 ₹999 24% off/);
  expect(t, 'per serving from the stated servings').toContain('₹15 per serving');
  expect(t).toContain('100 grams · 50 servings');
  expect(t, 'the details').toMatch(/The details .*Size 100 grams .*Servings 50/);
  expect(t, 'who the brand is, in its own words').toContain(`About Leafline Tea ${ABOUT}`);
  expect(built, 'a closing button').toMatch(/<section class="endcta">/);
  for (const claim of CLAIMS) expect(count(t, claim), `"${claim}" printed more than once`).toBeLessThanOrEqual(1);
  // Nothing the record does not state: no rating, countdown, stock level, gift or study.
  expect(t).not.toMatch(/★|Rated \d|ends in|left at this price|in stock|free gift|clinical|study|\d+%\s+(lower|better|less)/i);
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.route('**/*', (r) => (r.request().resourceType() === 'image' ? r.fulfill({ contentType: 'image/svg+xml', body: PHOTO }) : r.abort()));
    await page.setContent(built, { waitUntil: 'load' });
    const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, buyCols: getComputedStyle(document.querySelector('.buybox')).gridTemplateColumns.split(' ').length }));
    expect(m.over, `scrolls sideways at ${w}`).toBeLessThanOrEqual(0);
    expect(m.buyCols, `buy box columns at ${w}`).toBe(w < 760 ? 1 : 2);
    await page.unrouteAll();
  }
});

test('a bare brand gets no empty sections: no offer bar, no details, no about, no checklist', async () => {
  const bare = Object.assign({}, RICH, { claims: [], description: '' });
  const c = await build(slot(bare, P('Highland First Flush Black Tea', 1, 759)));
  const built = c.assets.landing_pages.find((l) => l.variant === 'A').html;
  expect(built).not.toMatch(/class="annc"|class="sec details"|class="sec about"|class="chk"|class="off"/);
  // The buy box still carries what the store states: its price.
  expect(textOf(built)).toContain('₹759');
});

// The page FORMAT follows the audience (2026-10-25, from the landing-page
// benchmark, data/benchmarks/landing-reference.json): a lapsed cohort whose
// brand states three or more reasons gets a listicle as variant B (the product
// at item two, a button after every reason, the buy box last); a warm cohort, or
// a brand with fewer stated reasons, never gets one. Every reason is the brand's
// own line.
test('a lapsed cohort gets a listicle built only from the brand\'s own reasons; a warm one does not', async ({ page }) => {
  const REASONS = ['Single-estate teas', 'Packed within days of picking', 'Sourced directly from family gardens'];
  const brand = Object.assign({}, RICH, { claims: ['Free shipping across India'].concat(REASONS) });
  const lapsed = await build(slot(brand, P('Highland First Flush Black Tea', 1, 759)));
  const b = lapsed.assets.landing_pages.find((l) => l.variant === 'B');
  expect(b.format).toBe('listicle');
  const t = textOf(b.html);
  expect(t).toContain('3 reasons to come back to Leafline Tea');
  const items = [...b.html.matchAll(/<li><span class="num">(\d)<\/span><div><h3>([^<]+)<\/h3>/g)].map((m) => m[2]);
  expect(items).toEqual(REASONS);
  // The product enters after the first reason, and the buy box closes the page.
  expect(b.html.indexOf('class="lcard"')).toBeGreaterThan(b.html.indexOf(REASONS[0]));
  expect(b.html.indexOf('class="lcard"')).toBeLessThan(b.html.indexOf(REASONS[1]));
  expect(b.html.indexOf('<section class="sec buy"')).toBeGreaterThan(b.html.indexOf(REASONS[2]));
  for (const r of REASONS) expect(count(t, r), `"${r}" said twice`).toBe(1);
  // Variant A stays the direct offer.
  expect(lapsed.assets.landing_pages.find((l) => l.variant === 'A').format).toBe('direct-offer');
  // A warm cohort: no listicle.
  const warm = await build(Object.assign(slot(brand, P('Highland First Flush Black Tea', 1, 759)), { objective: 'premium bundle expansion', cohort: { name: 'Champions', size: null, estimated: true } }));
  expect(warm.assets.landing_pages.find((l) => l.variant === 'B').format).not.toBe('listicle');
  // Two stated reasons are not padded to three.
  const thin = await build(slot(Object.assign({}, brand, { claims: ['Free shipping across India', REASONS[0], REASONS[1]] }), P('Highland First Flush Black Tea', 1, 759)));
  expect(thin.assets.landing_pages.find((l) => l.variant === 'B').format).not.toBe('listicle');
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.route('**/*', (r) => (r.request().resourceType() === 'image' ? r.fulfill({ contentType: 'image/svg+xml', body: PHOTO }) : r.abort()));
    await page.setContent(b.html, { waitUntil: 'load' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `scrolls sideways at ${w}`).toBeLessThanOrEqual(0);
    await page.unrouteAll();
  }
});
