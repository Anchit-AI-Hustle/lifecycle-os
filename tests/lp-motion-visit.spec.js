// @ts-check
// The operator's "make it feel expensive" slides, on every generated landing page,
// executed: a campaign is BUILT through the shipped builder and rendered in Chromium.
//  - The headline is revealed letter by letter, once, on load: transform only (its
//    colour never changes), words never broken, read once by a screen reader; no
//    script or reduced motion = the plain heading.
//  - A curtain reveal on the hero picture (clip-path), ending fully shown.
//  - A horizontal gallery of the other products on a phone, inside its own row:
//    the page never gets wider than the screen.
//  - Hours and address only when the brand's record states them.
const { test, expect } = require('@playwright/test');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const PRODUCTS = ['Rosehip Face Oil', 'Neem Face Wash', 'Aloe Day Cream', 'Vitamin C Serum'].map((t, i) => ({
  sku: 'P' + i, title: t, handle: 'p' + i, price: 400 + i * 50, image: `https://img.example/p${i}.jpg`,
  url: `https://plumbline.example/products/p${i}`, category: 'Skincare',
  description: 'A light daily product. It absorbs in under a minute. Use two drops at night.',
}));
const BRAND = {
  id: 'device:plumb', slug: 'plumbline', name: 'Plumbline Botanics', website: 'https://plumbline.example',
  palette: { primary: '#2f6b3a', accent: '#e0a030', ink: '#1b1b1b', surface: '#fbf8f2' },
  regions: [{ code: 'IN', home: true, currency: 'INR' }],
};
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];

async function landing(brand) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error(`network blocked: ${u}`); };
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const plan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
    const entry = {
      id: 'motion-' + brand.slug, date: '2026-11-10', market: 'IN', objective: 'reactivation', brand: JSON.parse(JSON.stringify(brand)),
      heroProduct: PRODUCTS[0], supportingProducts: PRODUCTS.slice(1), cohort: { name: 'At Risk', size: 900, rules: ['r'] },
      channels: ['email', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 },
    };
    const c = await plan.buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
    return c.assets.landing_pages[0].html;
  } finally {
    global.fetch = realFetch;
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
async function open(page, html) {
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith('https://lp.test/')) return r.fulfill({ contentType: 'text/html', body: html });
    if (/img\.example/.test(u)) return r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#cfa"/></svg>' });
    return r.fulfill({ status: 204, body: '' });
  });
  await page.goto('https://lp.test/');
}

test('the headline is revealed letter by letter, ends in place, keeps its colour and its words', async ({ page }) => {
  const html = await landing(BRAND);
  await open(page, html);
  const before = await page.$eval('.hero h1', (h) => ({ label: h.getAttribute('aria-label'), letters: h.querySelectorAll('.lt').length, words: h.querySelectorAll('.lw').length, text: h.textContent.replace(/\s+/g, ' ').trim(), color: getComputedStyle(h).color }));
  expect(before.letters).toBeGreaterThan(5);
  expect(before.label.replace(/\s+/g, ' ').trim()).toBe(before.text);
  expect(before.words).toBe(before.text.split(' ').length);
  await page.waitForTimeout(2200);
  const after = await page.$$eval('.hero h1 .lt', (ls) => ls.map((l) => getComputedStyle(l).transform));
  expect(after.every((t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)'), 'every letter ends in place: ' + [...new Set(after)].join(' | ')).toBe(true);
  const colours = await page.$$eval('.hero h1 .lt', (ls) => [...new Set(ls.map((l) => getComputedStyle(l).color))]);
  expect(colours).toEqual([before.color]);
  // A word never breaks across lines: every letter of a word sits on one line.
  const broken = await page.$$eval('.hero h1 .lw', (ws) => ws.filter((w) => new Set([...w.querySelectorAll('.lt')].map((l) => Math.round(l.getBoundingClientRect().top))).size > 1).length);
  expect(broken).toBe(0);
  // The hero picture's curtain ends fully open.
  if (await page.$('.hero-media')) expect(await page.$eval('.hero-media', (m) => getComputedStyle(m).clipPath)).toMatch(/^(none|inset\((0(px|%)?\s*)+\))$/);
});

test('with no script or reduced motion the headline is the plain heading', async ({ browser }) => {
  const html = await landing(BRAND);
  for (const opts of [{ javaScriptEnabled: false }, { reducedMotion: 'reduce' }]) {
    const ctx = await browser.newContext(opts);
    const p = await ctx.newPage();
    await open(p, html);
    expect(await p.$$eval('.hero h1 .lt', (l) => l.length)).toBe(0);
    expect(await p.evaluate(() => document.documentElement.classList.contains('lp-motion'))).toBe(false);
    await ctx.close();
  }
});

test('on a phone the other products are a horizontal gallery inside their own row, the page no wider than the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, await landing(BRAND));
  const g = await page.$eval('.others', (o) => ({ cls: o.className, display: getComputedStyle(o).display, overflow: getComputedStyle(o).overflowX, scroll: o.scrollWidth > o.clientWidth, n: o.children.length }));
  expect(g.n).toBeGreaterThanOrEqual(3);
  expect(g.cls).toMatch(/gallery/);
  expect(g.display).toBe('flex');
  expect(g.overflow).toBe('auto');
  expect(g.scroll).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('hours and address only when the record states them, printed as written', async ({ page }) => {
  expect(await landing(BRAND)).not.toMatch(/data-visit/);
  const html = await landing(Object.assign({}, BRAND, { brand_data: { hours: ['Mon to Sat: 10am to 8pm'], locations: [{ name: 'Bandra store', address: '14 Hill Road, Mumbai 400050' }] } }));
  await open(page, html);
  const t = await page.$eval('[data-visit]', (s) => s.innerText);
  expect(t).toContain('14 Hill Road, Mumbai 400050');
  expect(t).toContain('Mon to Sat: 10am to 8pm');
  expect(t).toContain('Bandra store');
});
