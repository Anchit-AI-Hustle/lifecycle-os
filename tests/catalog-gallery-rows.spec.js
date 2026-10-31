// A page with no product data: only pictures that read as products become rows (2026-10-31).
//
// Production, a bakery (no prices, no JSON-LD; its menus are PDFs): the import
// filed 144 "products" that were its banner slide headlines ("Festive gifting
// for every heart you want to make happy"), numbered pictures ("Bread 1") and
// layout images ("Good food strip desktop"), each with a made-up #anchor link.
// The fixture is that home page's own <img> tags. Executed through rowFromPage.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const ci = require('../api/_shared/catalog-import.js');

test('banner headlines, numbered and layout pictures and the site name are not products', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'bakery-home-imgs.html'), 'utf8');
  const out = ci.rowFromPage(html, 'https://www.bakery.example/', { region: 'in', source: 'crawl' });
  const titles = (out.rows || []).map((r) => r.title);
  for (const real of ['Multigrain bread', 'Garlic bread', 'Masala bread', 'Brown bread', 'Choco chip cookies', 'Crispy cake rusk', 'Authentic italian biscotti box', 'Jam jar']) {
    expect(titles, real).toContain(real);
  }
  for (const not of [/festive/i, /slice of sweetness/i, /^Bread \d/, /strip/i, /carousel/i, /banner/i, /button/i, /baker/i, /^Store$/, / home$/i, / m$/]) {
    expect(titles.filter((t) => not.test(t)), String(not)).toEqual([]);
  }
  expect(titles.length).toBeLessThanOrEqual(10);
  // No price is stated, so none is invented.
  expect((out.rows || []).every((r) => r.price == null)).toBe(true);
});

test('no brand is named in the shared importer', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', '_shared', 'catalog-import.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
  expect(src).not.toMatch(/nik\s*\\s\*baker|nik\s*baker/i);
});
