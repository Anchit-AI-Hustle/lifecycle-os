// The long-form landing page (2026-10-24). The operator, with VAHDAM's own
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
const ABOUT = 'Leafline sources single-estate teas directly from family gardens in Darjeeling and Assam and packs them within days of picking.';
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
const textOf = (html) => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<title>[\s\S]*?<\/title>/i, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const count = (hay, needle) => String(hay).split(needle).length - 1;
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#9b8"/></svg>';

test('a brand with stated facts gets every section those facts fill, each claim once, nothing invented', async ({ page }) => {
  const c = await build(slot(RICH, P('Darjeeling First Flush Black Tea', 1, 759, { compare_at: 999, servings: 50, unit_spec: '100 grams' })));
  const a = c.assets.landing_pages.find((l) => l.variant === 'A');
  const html = a.html; const t = textOf(html);
  expect(html, 'offer bar').toMatch(/class="annc">Free shipping across India</);
  expect(html, 'buy box').toMatch(/<section class="sec buy"/);
  expect(t).toMatch(/₹759 ₹999 24% off/);
  expect(t, 'per serving from the stated servings').toContain('₹15 per serving');
  expect(t).toContain('100 grams · 50 servings');
  expect(t, 'the details').toMatch(/The details .*Size 100 grams .*Servings 50/);
  expect(t, 'who the brand is, in its own words').toContain(`About Leafline Tea ${ABOUT}`);
  expect(html, 'a closing button').toMatch(/<section class="endcta">/);
  for (const claim of CLAIMS) expect(count(t, claim), `"${claim}" printed more than once`).toBeLessThanOrEqual(1);
  // Nothing the record does not state: no rating, countdown, stock level, gift or study.
  expect(t).not.toMatch(/★|Rated \d|ends in|left at this price|in stock|free gift|clinical|study|\d+%\s+(lower|better|less)/i);
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.route('**/*', (r) => (r.request().resourceType() === 'image' ? r.fulfill({ contentType: 'image/svg+xml', body: PHOTO }) : r.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, buyCols: getComputedStyle(document.querySelector('.buybox')).gridTemplateColumns.split(' ').length }));
    expect(m.over, `scrolls sideways at ${w}`).toBeLessThanOrEqual(0);
    expect(m.buyCols, `buy box columns at ${w}`).toBe(w < 760 ? 1 : 2);
    await page.unrouteAll();
  }
});

test('a bare brand gets no empty sections: no offer bar, no details, no about, no checklist', async () => {
  const bare = Object.assign({}, RICH, { claims: [], description: '' });
  const c = await build(slot(bare, P('Darjeeling First Flush Black Tea', 1, 759)));
  const html = c.assets.landing_pages.find((l) => l.variant === 'A').html;
  expect(html).not.toMatch(/class="annc"|class="sec details"|class="sec about"|class="chk"|class="off"/);
  // The buy box still carries what the store states: its price.
  expect(textOf(html)).toContain('₹759');
});
