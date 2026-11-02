// @ts-check
/**
 * A template's offerings belong to a brand only when the record IS that
 * template (2026-11-03). Production /brain for "The Times of India" showed ads
 * for "Marathon training plan (multi-week)", an offering of the TOI Health &
 * Fitness template, which sits on the same host. Executed: the shipped planner
 * (smart-brain-plan) and the browser resolver (brand-catalog.js in Chromium,
 * over the real preset files).
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const TPL = require('../api/_shared/template-offerings.js');
const plan = require('../api/_shared/smart-brain-plan.js');

const HF = require('../data/brands/presets/toi-health-fitness.json');
const MARATHON = 'Marathon training plan (multi-week)';

const toiRenamed = {
  id: 'ws-toi', name: 'The Times of India', website: 'https://timesofindia.indiatimes.com',
  regions: [{ code: 'IN', currency: 'INR', home: true }],
  brand_data: { template: { slug: 'toi-health-fitness', name: HF.name, website: HF.website, demo: true } },
};
const hfItself = {
  id: 'ws-hf', name: HF.name, website: HF.website,
  regions: [{ code: 'IN', currency: 'INR', home: true }],
  brand_data: { template: { slug: 'toi-health-fitness', name: HF.name, website: HF.website, demo: true } },
};

const names = (list) => list.map((o) => o.name || o.title);

test.describe('template offerings follow the template, not the host', () => {
  test('a record renamed The Times of India does not get the Health & Fitness programmes', () => {
    expect(names(plan.__test_resolveBrandOfferings(toiRenamed))).not.toContain(MARATHON);
    expect(plan.__test_resolveBrandOfferings(toiRenamed)).toEqual([]);
  });

  test('the template itself keeps its offerings', () => {
    expect(names(plan.__test_resolveBrandOfferings(hfItself))).toContain(MARATHON);
  });

  test('a rename keeps the template\'s offerings; another section of the host does not', () => {
    expect(names(TPL.templateOfferings(Object.assign({}, hfItself, { name: 'My Fitness Desk' })))).toContain(MARATHON);
    const otherPath = Object.assign({}, hfItself, { website: 'https://timesofindia.indiatimes.com/city' });
    expect(TPL.templateOfferings(otherPath)).toEqual([]);
  });

  test('a copy of a template offering stored on the record is dropped; the brand\'s own one is kept', () => {
    const copied = Object.assign({}, toiRenamed, {
      brand_data: Object.assign({}, toiRenamed.brand_data, {
        offerings: [HF.offerings.find((o) => o.name === MARATHON), { kind: 'section', name: 'City', url: 'https://timesofindia.indiatimes.com/city' }],
      }),
    });
    expect(names(plan.__test_resolveBrandOfferings(copied))).toEqual(['City']);
    const typed = Object.assign({}, toiRenamed, {
      brand_data: Object.assign({}, toiRenamed.brand_data, { offerings: [{ kind: 'programme', name: MARATHON, cadence: 'weekly' }] }),
    });
    expect(names(plan.__test_resolveBrandOfferings(typed))).toEqual([MARATHON]);
  });

  test('a stored slot naming the other template\'s offering is judged another brand\'s', () => {
    const slot = { id: 's1', market: 'IN', objective: 'Nurture', heroOffering: { kind: 'programme', name: MARATHON }, heroProduct: { title: MARATHON } };
    const v = TPL.slotTemplateVerdict(slot, toiRenamed);
    expect(v && v.offering).toBe(MARATHON);
    expect(v.sentence).toContain('not of The Times of India');
    expect(TPL.slotTemplateVerdict(slot, hfItself)).toBeNull();
    // A catalogue product of the same name on a brand with no template or host
    // link is never judged.
    const stranger = { name: 'Run Club', website: 'https://runclub.example', brand_data: {} };
    expect(TPL.slotTemplateVerdict({ heroProduct: { title: MARATHON } }, stranger)).toBeNull();
  });

  test('scrubForeignProducts clears that slot before it is built', () => {
    const entry = { id: 's2', market: 'IN', objective: 'Nurture', brand: toiRenamed, heroOffering: { kind: 'programme', name: MARATHON }, heroProduct: { title: MARATHON }, supportingProducts: [] };
    const fn = plan.__test_scrubForeignProducts || null;
    test.skip(!fn, 'scrubForeignProducts is not exported');
    const v = fn(entry);
    expect(v && v.template).toBeTruthy();
    expect(entry.heroOffering).toBeNull();
    // Only the explanation may name it; nothing an asset is built from does.
    const built = { hero: entry.heroProduct, offering: entry.offering, supporting: entry.supportingProducts, theme: entry.theme, cta: entry.cta, analysis: entry.analysis };
    expect(JSON.stringify(built)).not.toContain('Marathon training plan');
    expect(entry.heroProduct.placeholder).toBe(true);
  });

  test('brand-catalog.js in the browser gives the renamed record none of the template\'s offerings', async ({ page }) => {
    const dir = path.join(__dirname, '..', 'data', 'brands', 'presets');
    await page.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/api/public-config') {
        const slug = u.searchParams.get('slug');
        const body = slug ? { preset: JSON.parse(fs.readFileSync(path.join(dir, slug + '.json'), 'utf8')) } : JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (u.pathname === '/brand-catalog.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, '..', 'brand-catalog.js'), 'utf8') });
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    });
    await page.goto('http://app.example.test/');
    const run = async (brand) => page.evaluate(async (b) => {
      window.BrandContext = { brand: b, ready: () => Promise.resolve(b) };
      if (!window.BrandCatalog) await new Promise((res) => { const s = document.createElement('script'); s.src = '/brand-catalog.js'; s.onload = res; document.head.appendChild(s); });
      const o = await window.BrandCatalog.loadOfferings(new Date('2026-11-03'));
      return o.evergreen.concat(o.upcoming).map((x) => x.name || x.title);
    }, brand);
    expect(await run(toiRenamed)).not.toContain(MARATHON);
    expect(await run(hfItself)).toContain(MARATHON);
  });
});
