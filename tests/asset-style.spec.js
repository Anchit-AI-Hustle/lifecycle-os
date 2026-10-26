'use strict';
/**
 * Every asset gets its own composition, for every brand (2026-10-23, the
 * operator: "styles of assets designs and everything is updated and uniquely
 * created every single time for every asset for every brand").
 * Executed: the shipped landing-page renderer and mail renderer over many
 * slots of two brands, measured in Chromium. The brand's palette, type and
 * radii never change between slots; the arrangement does, and the same slot
 * rebuilt is the same design.
 *
 * Changed on purpose (2026-10-26, asset-themes.js): a landing page now also
 * has a TEMPLATE. The immersive one lays the words on a brand panel OVER the
 * bottom of the photograph, on purpose; there the rule this test protects (the
 * words never sit on a picture they cannot be read on) is checked as the panel
 * having its own opaque ground. The editorial one sets the picture under the
 * words ("media-bottom"). Every other arrangement must still not overlap, and
 * at least three distinct arrangements must render over nine slots.
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
        const pos = a.bottom <= z.top + 1 ? 'media-top' : (a.top >= z.bottom - 1 ? 'media-bottom' : (a.right <= z.left + 1 ? 'media-left' : (a.left >= z.right - 1 ? 'media-right' : 'overlap')));
        if (pos !== 'overlap' || document.body.dataset.template !== 'immersive') return pos;
        // The immersive panel: its own ground, fully opaque, under the words.
        const bg = getComputedStyle(c).backgroundColor;
        const m2 = bg.match(/rgba?\(([^)]+)\)/); const parts = m2 ? m2[1].split(',').map(Number) : [];
        return parts.length >= 3 && (parts.length === 3 || parts[3] === 1) ? 'panel-over-media' : 'overlap';
      });
      seen.add(box);
    }
    expect(seen.has('overlap'), `${b.name}: a hero arrangement overlapped`).toBe(false);
    expect(seen.size, `${b.name}: arrangements actually rendered (${[...seen].join(', ')})`).toBeGreaterThanOrEqual(3);
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

test('a motion ad\'s type position and opening move vary by slot, and the type never sits on the button or the rail', async ({ page }) => {
  const motion = require('../scripts/lib/motion-ad.js');
  await page.setViewportSize({ width: 405, height: 720 });
  const seen = new Set();
  for (let d = 1; d <= 9; d++) {
    const layout = S.recipe(slot(BRANDS[0], d), 'ad:meta:video');
    expect(layout).toEqual(S.recipe(slot(BRANDS[0], d), 'ad:meta:video'));
    const html = motion.renderMotionAd({ brand: BRANDS[0], scenes: [{ headline: 'Paper that keeps up with you', sub: 'Write it down.', image: '' }], cta: 'Shop now', layout, loop: false });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const box = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const t = r('.type'), a = r('.bottom-action'), s = r('.social-rail'), st = r('.stage');
      return { at: Math.round(((t.top - st.top) / st.height) * 3), hitsCta: t.bottom > a.top, hitsRail: t.bottom > s.top && t.right > s.left };
    });
    expect(box.hitsCta, `slot ${d} (${layout.text_at}): the type covers the button`).toBe(false);
    expect(box.hitsRail, `slot ${d} (${layout.text_at}): the type runs into the share rail`).toBe(false);
    seen.add(layout.text_at);
    // Reduced motion composes one still frame with the type at the top, whatever the recipe.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const top = await page.evaluate(() => { const t = document.querySelector('.type').getBoundingClientRect(); const st = document.querySelector('.stage').getBoundingClientRect(); return (t.top - st.top) / st.height; });
    expect(top).toBeLessThan(0.2);
  }
  expect(seen.size, 'type positions actually used over 9 slots').toBeGreaterThan(1);
});
