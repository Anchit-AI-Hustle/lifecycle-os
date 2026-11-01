// The offer panel on a static ad (2026-11-01), measured against Fastlane's
// statics (photo, headline on a brand band, price struck beside the price
// paid, ticked benefits, button). Rendered in Chromium; every word is the ad's
// or the record's, so the test also checks nothing is added.
const { test, expect } = require('@playwright/test');
const SA = require('../scripts/lib/static-ad.js');
const core = require('../api/_shared/brand-workspace-core.js');

const base = {
  brandName: 'Testbrand', ratio: '4:5', template: 'offer', theme: 'bold', headline: 'Calm energy ritual',
  price: '$34.99', compare: '$99.99', benefits: ['Mental clarity', 'Boosts energy', 'A claim far too long to fit on one benefit line of an ad'],
  cta: 'Shop now', image: 'https://img.example.test/p.jpg',
  palette: { primary: '#0F5C3A', accent: '#E8B931', surface: '#FFFFFF', ink: '#1A1A1A' }, fonts: { head: 'Arial', body: 'Arial' },
};

async function open(page, spec) {
  await page.route('https://img.example.test/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect width="8" height="6" fill="#c9a37a"/></svg>' }));
  const out = SA.renderStaticAd(spec);
  await page.setViewportSize({ width: 540, height: 700 });
  await page.setContent(out.html);
  return out;
}

test('offer: price struck beside the price paid, the brand\'s short claims ticked, AA text', async ({ page }) => {
  const out = await open(page, base);
  expect(out.template).toBe('offer');
  const r = await page.evaluate(() => {
    const cmp = document.querySelector('[data-ad-compare]');
    const items = [...document.querySelectorAll('[data-ad-benefits] li')].map((li) => li.textContent.replace(/✓/, '').trim());
    const runs = [...document.querySelectorAll('[data-ad-text]')].map((el) => {
      let n = el, bg = '';
      while (n && (!bg || bg === 'rgba(0, 0, 0, 0)')) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
      return { fg: getComputedStyle(el).color, bg };
    });
    return { cmp: cmp && cmp.textContent, deco: cmp && getComputedStyle(cmp).textDecorationLine, price: document.querySelector('[data-ad-price]').textContent, items, runs };
  });
  expect(r.cmp).toBe('$99.99');
  expect(r.deco).toContain('line-through');
  expect(r.price).toBe('$34.99');
  expect(r.items).toEqual(['Mental clarity', 'Boosts energy']); // the long claim is left out, never cut
  const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  expect(r.runs.length).toBeGreaterThan(4);
  for (const x of r.runs) expect(core.contrast(hex(x.fg), hex(x.bg)), JSON.stringify(x)).toBeGreaterThanOrEqual(4.5);
});

test('offer: no struck price when the store states none; no price and no claims falls back to the band', async ({ page }) => {
  let out = await open(page, Object.assign({}, base, { compare: '' }));
  expect(out.template).toBe('offer');
  expect(await page.locator('[data-ad-compare]').count()).toBe(0);
  out = await open(page, Object.assign({}, base, { compare: '$34.99' }));
  expect(await page.locator('[data-ad-compare]').count()).toBe(0);
  out = SA.renderStaticAd(Object.assign({}, base, { price: '', compare: '', benefits: [] }));
  expect(out.template).toBe('band');
});
