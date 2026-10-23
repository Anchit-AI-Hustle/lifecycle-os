'use strict';
/**
 * Every asset gets its own composition, for every brand (2026-10-23, the
 * operator: "styles of assets designs and everything is updated and uniquely
 * created every single time for every asset for every brand").
 * Executed: the shipped landing-page renderer and mail renderer over many
 * slots of two brands, measured in Chromium. The brand's palette, type and
 * radii never change between slots; the arrangement does, and the same slot
 * rebuilt is the same design.
 */
const { test, expect } = require('@playwright/test');
const S = require('../api/_shared/asset-style.js');
const P = require('../api/_shared/smart-brain-plan.js');

const BRANDS = [
  { id: 'w-ink', name: 'Inkwell Co', website: 'https://inkwell.example', palette: { primary: '#1F5C99', accent: '#E0A100', surface: '#FFFFFF', ink: '#1A1A1A' }, regions: [{ code: 'IN', currency: 'INR', home: true }] },
  { id: 'w-fern', name: 'Fernhouse', website: 'https://fernhouse.example', palette: { primary: '#2E7D4F', accent: '#C2410C', surface: '#FFFBF5', ink: '#222222' }, regions: [{ code: 'UK', currency: 'GBP', home: true }] },
];
const slot = (b, d) => ({ id: `${b.id}-slot-${d}`, date: `2026-11-${String(d).padStart(2, '0')}`, market: b.regions[0].code, brand: b, heroProduct: { title: 'Field Notebook', product_url: `${b.website}/products/field-notebook` } });
const lp = (e) => P.__test_lpHtml(e, { landing: { hero_headline: 'Write it down', hero_sub: 'Paper that keeps up.' } }, `c-${e.id}`, `${e.brand.website}/hero.jpg`);
const rootVars = (html) => (html.match(/:root\{[^}]*\}/) || [''])[0];

test('the same slot rebuilt is the same design; neighbouring slots differ', () => {
  for (const b of BRANDS) {
    const a = S.recipe(slot(b, 3), 'landing:x');
    expect(S.recipe(slot(b, 3), 'landing:x')).toEqual(a);
    const heroes = new Set(Array.from({ length: 12 }, (_, i) => S.recipe(slot(b, i + 1), 'landing:x').hero));
    expect(heroes.size, `${b.name}: landing heroes over 12 slots`).toBe(3);
    const mails = new Set(Array.from({ length: 12 }, (_, i) => S.recipe(slot(b, i + 1), 'mail:visual').id));
    expect(mails.size).toBe(12);
    // Two variants of one slot are composed differently too.
    expect(S.recipe(slot(b, 3), 'mail:visual').id).not.toBe(S.recipe(slot(b, 3), 'mail:editorial').id);
  }
  // The same slot id for two brands is two designs.
  expect(S.recipe(Object.assign(slot(BRANDS[0], 1), { id: 'same' }), 'landing:x').id).not.toBe(S.recipe(Object.assign(slot(BRANDS[1], 1), { id: 'same' }), 'landing:x').id);
});

test('the arrangement changes in the rendered page; the brand\'s own tokens do not', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const b of BRANDS) {
    const seen = new Set();
    let tokens = null;
    for (let d = 1; d <= 9; d++) {
      const html = lp(slot(b, d));
      if (tokens === null) tokens = rootVars(html); else expect(rootVars(html), `${b.name} slot ${d}: brand tokens changed`).toBe(tokens);
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const box = await page.evaluate(() => {
        const m = document.querySelector('.hero-media'); const c = document.querySelector('.hero-copy');
        const a = m.getBoundingClientRect(), z = c.getBoundingClientRect();
        return a.bottom <= z.top + 1 ? 'media-top' : (a.right <= z.left + 1 ? 'media-left' : (a.left >= z.right - 1 ? 'media-right' : 'overlap'));
      });
      seen.add(box);
    }
    expect(seen.has('overlap'), `${b.name}: a hero arrangement overlapped`).toBe(false);
    expect(seen.size, `${b.name}: arrangements actually rendered`).toBe(3);
  }
});

test('a mail recipe varies the composition within what the studied category uses', () => {
  const studied = { hero_full_width: true, product_grid: true, grid_columns: 2, grid_max: 4, service_strip: true, shop_by_links: false, split_feature: false, secondary_outline: false };
  for (let d = 1; d <= 20; d++) {
    const out = S.mailLayout(studied, S.recipe(slot(BRANDS[0], d), 'mail:visual'));
    expect(out.split_feature, 'a block the category does not use stays off').toBe(false);
    expect(out.shop_by_links).toBe(false);
    expect([2, 3]).toContain(out.grid_columns);
  }
});
