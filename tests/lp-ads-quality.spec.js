// Landing pages and ads, reviewed as a performance marketer would (2026-11-08).
// The operator: "need much better landing pages and ads to be created in the
// smart brain". Four brands (a skincare store with a catalogue, prices and a
// compare-at; a news publisher; a services practice; an app) were built through
// the shipped buildCampaign on the template and the scripted-model paths, every
// landing page rendered at 1280 and 390 and every static rendered in Chromium.
// What was wrong, each fixed at source and measured here:
//   - a framed hero's rule cut across the split photograph, which spilled past it;
//   - an outline theme left the page's one action above the fold a hollow box;
//   - a brand with no product got "Ledgerline Gazette / Ledgerline Gazette" as
//     eyebrow and headline, and variant B was the same page as A;
//   - the hero's sub line carried the tagline the reveal then printed again;
//   - a "The details" section of one row repeating the hero's eyebrow;
//   - the long-read template's headline ~180px right of every section under it;
//   - no static ever took the offer template (every static is variant 'Static',
//     the rule tested for 'A'), so a stated compare-at was never shown struck;
//   - the stated compare-at was on the page and in no ad's words;
//   - video scripts "Discover X. Explore the collection at X." with 8-12s empty;
//   - Google RSA sets saying one line four ways ("Shop now at X", "X: Shop now",
//     "X online", "Discover X") and descriptions repeating one another.
//
// Run: npx playwright test tests/lp-ads-quality.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];
const AT = require(path.join(ROOT, 'api', '_shared', 'asset-themes.js'));
const { BRANDS } = require('./lib/sweep-brands.js');

const SKIN = {
  id: 'device:arya', slug: 'arya', name: 'Arya Organics', website: 'https://aryaorganics.example', industry: 'skincare',
  tagline: 'Cold-pressed skincare made in small batches in Jaipur', claims: ['Cold-pressed oils', 'Made in small batches in Jaipur', 'No added fragrance'],
  palette: { primary: '#B4547A', accent: '#F0C987', ink: '#2E1A24', surface: '#FFF9FB' }, regions: [{ code: 'IN', currency: 'INR', home: true }],
  legal_entity: 'Arya Organics Pvt Ltd, Jaipur, India',
};
const P = (t, n, price, extra) => Object.assign({ sku: 'A' + n, title: t, handle: 'p' + n, image: `https://aryaorganics.example/img/${n}.jpg`, price, url: `https://aryaorganics.example/products/p${n}`, category: 'Face oil' }, extra || {});
const NEWS = BRANDS.find((b) => b.slug === 'gazette');

function slot(brand, extra) {
  return Object.assign({
    id: `lpq-${brand.slug}`, date: '2026-11-10', market: 'IN', objective: 'reactivation', brand: JSON.parse(JSON.stringify(brand)),
    cohort: { name: 'At Risk', size: 1500, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 },
  }, extra || {});
}
const skinSlot = (extra) => slot(SKIN, Object.assign({ heroProduct: P('Rosehip Face Oil 30ml', 1, 899, { compare_at: 1199 }), supportingProducts: [P('Kumkumadi Night Serum 15ml', 2, 1299), P('Saffron Glow Cream 50g', 3, 749)] }, extra || {}));

// A landing page built with ONE theme and template, so each rule is measured
// on the shape it is about (asset-themes.pick is read at call time).
async function build(entry, landing) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error(`network blocked: ${u}`); };
  const realPick = AT.pick;
  if (landing) AT.pick = function (e, kind, name, o) { const p = realPick.call(this, e, kind, name, o); return kind === 'landing' ? Object.assign({}, p, { theme: Object.assign({}, AT.THEMES[landing.theme]), template: landing.template, id: `${landing.theme}.${landing.template}.test` }) : p; };
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return await require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js')).buildCampaign(JSON.parse(JSON.stringify(entry)), smartConfig({}), { noLLM: true, withCreatives: false });
  } finally {
    AT.pick = realPick; global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#9b8"/></svg>';
async function open(page, html, w) {
  await page.setViewportSize({ width: w, height: w > 600 ? 900 : 844 });
  await page.unrouteAll();
  await page.route('**/*', (r) => (r.request().resourceType() === 'image' ? r.fulfill({ contentType: 'image/svg+xml', body: PHOTO }) : r.abort()));
  await page.setContent(html, { waitUntil: 'load' });
}
const lp = (c, v) => c.assets.landing_pages.find((l) => l.variant === v).html;
const textOf = (h) => String(h).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<title>[\s\S]*?<\/title>/i, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('a framed split hero keeps its photograph inside the frame, and its button is filled', async ({ page }) => {
  const c = await build(skinSlot(), { theme: 'luxe', template: 'split' });
  for (const w of [1280, 390]) {
    await open(page, lp(c, 'A'), w);
    const m = await page.evaluate(() => {
      const hero = document.querySelector('.hero'); const img = document.querySelector('.hero-media img'); const btn = document.querySelector('.hero .btn');
      const h = hero.getBoundingClientRect(); const i = img.getBoundingClientRect(); const off = -parseFloat(getComputedStyle(hero).outlineOffset);
      return { outline: getComputedStyle(hero).outlineStyle, frame: { l: h.left + off, r: h.right - off, t: h.top + off, b: h.bottom - off }, img: { l: i.left, r: i.right, t: i.top, b: i.bottom }, btnBg: getComputedStyle(btn).backgroundColor };
    });
    expect(m.outline, 'the luxe ground is framed').toBe('solid');
    expect(m.img.l, `photo left of the frame at ${w}`).toBeGreaterThanOrEqual(m.frame.l);
    expect(m.img.r, `photo right of the frame at ${w}`).toBeLessThanOrEqual(m.frame.r);
    expect(m.img.t, `photo above the frame at ${w}`).toBeGreaterThanOrEqual(m.frame.t);
    expect(m.img.b, `photo below the frame at ${w}`).toBeLessThanOrEqual(m.frame.b);
    expect(m.btnBg, 'the hero button is filled, not a hollow outline').not.toBe('rgba(0, 0, 0, 0)');
  }
});

test('a brand with no product: A is brand-led without the name twice, B leads with its own tagline, each line once', async ({ page }) => {
  const c = await build(slot(NEWS, { cohort: { name: 'Champions', size: 900, rules: ['r'] }, objective: 'premium bundle expansion' }));
  await open(page, lp(c, 'A'), 1280);
  const a = await page.evaluate(() => ({ eyebrow: (document.querySelector('.hero .eyebrow') || {}).textContent || '', h1: document.querySelector('.hero h1').textContent, reveal: !!document.querySelector('[data-tagline-reveal]') }));
  expect(a.h1).toBe('Ledgerline Gazette');
  expect(a.eyebrow.trim().toLowerCase(), 'eyebrow repeats the headline').not.toBe(a.h1.toLowerCase());
  expect(a.reveal, 'A keeps the tagline reveal').toBe(true);
  await open(page, lp(c, 'B'), 1280);
  const b = await page.evaluate(() => ({ h1: document.querySelector('.hero h1').textContent, reveal: !!document.querySelector('[data-tagline-reveal]') }));
  expect(b.h1, 'B leads with the brand\'s own tagline').toBe(NEWS.tagline);
  expect(b.reveal, 'the tagline is the headline, so it is not revealed again').toBe(false);
  expect(textOf(lp(c, 'B')).split(NEWS.tagline).length - 1, 'the tagline is said once').toBe(1);
  expect(b.h1, 'A and B are two directions, not one page twice').not.toBe(a.h1);
});

test('the hero sub line never carries the tagline the page also reveals', async () => {
  const c = await build(skinSlot());
  for (const l of c.assets.landing_pages) {
    if (!/data-tagline-reveal/.test(l.html)) continue;
    const sub = (l.html.match(/<p data-ds="hero-body">([^<]*)<\/p>/) || [])[1] || '';
    expect(sub, `variant ${l.variant}`).not.toContain(SKIN.tagline);
    expect(textOf(l.html).split(SKIN.tagline).length - 1, `variant ${l.variant}: tagline said once`).toBe(1);
  }
});

test('no "The details" section that only repeats the type the hero already shows', async () => {
  const c = await build(skinSlot());
  const html = lp(c, 'A');
  const eyebrow = (html.match(/<p class="eyebrow">([^<]*)<\/p>/) || [])[1] || '';
  expect(eyebrow).toBe('Face oil');
  expect(html, 'a one-row details section repeating the eyebrow').not.toMatch(/<section class="sec details">/);
  // A product that states its size still gets the section, with the size.
  const sized = await build(skinSlot({ heroProduct: P('Rosehip Face Oil 30ml', 1, 899, { compare_at: 1199, unit_spec: '30 ml' }) }));
  expect(textOf(lp(sized, 'A'))).toMatch(/The details .*Size/);
});

test('the long-read hero starts on the same left edge as the sections under it', async ({ page }) => {
  const c = await build(slot(BRANDS.find((b) => b.slug === 'famapp'), { cohort: { name: 'Hibernating', size: 900, rules: ['r'] } }), { theme: 'poster', template: 'editorial' });
  await open(page, lp(c, 'A'), 1280);
  const m = await page.evaluate(() => ({ h1: document.querySelector('.hero h1').getBoundingClientRect().left, h2: document.querySelector('.wrap .sec h2').getBoundingClientRect().left }));
  expect(Math.abs(m.h1 - m.h2), JSON.stringify(m)).toBeLessThanOrEqual(2);
  // Any left-aligned theme, with no picture in the hero, does the same.
  const svc = require('./lib/sweep-brands.js').MODEL_BRANDS.find((b) => b.slug === 'plumbline');
  const d = await build(slot(svc, { cohort: { name: 'New Customers', size: 900, rules: ['r'] } }), { theme: 'editorial', template: 'immersive' });
  await open(page, lp(d, 'A'), 1280);
  const n = await page.evaluate(() => ({ h1: document.querySelector('.hero h1').getBoundingClientRect().left, h2: document.querySelector('.wrap .sec h2').getBoundingClientRect().left }));
  expect(Math.abs(n.h1 - n.h2), JSON.stringify(n)).toBeLessThanOrEqual(2);
});

test('a stated compare-at puts the static on the offer template with the price struck, and the ads say it', async ({ page }) => {
  const c = await build(skinSlot());
  const meta = c.assets.ads.find((a) => a.platform === 'meta' && a.creative_type === 'static');
  expect(meta.variant).toBe('Static');
  expect(meta.creative.design.template).toBe('offer');
  await page.setViewportSize({ width: 1100, height: 1400 });
  await page.route('**/*', (r) => (r.request().resourceType() === 'image' ? r.fulfill({ contentType: 'image/svg+xml', body: PHOTO }) : r.abort()));
  await page.setContent(meta.creative.static_html, { waitUntil: 'load' });
  const s = await page.evaluate(() => { const cmp = document.querySelector('[data-ad-compare]'); return { cmp: cmp && cmp.textContent, deco: cmp && getComputedStyle(cmp).textDecorationLine, price: (document.querySelector('[data-ad-price]') || {}).textContent }; });
  expect(s.cmp).toBe('₹1,199');
  expect(s.deco).toContain('line-through');
  expect(s.price).toBe('₹899');
  expect(meta.primary_text).toContain('₹899, was ₹1,199');
  expect(meta.primary_text.length).toBeLessThanOrEqual(125);
  // No compare-at stated: no "was", no offer panel forced.
  const plain = await build(skinSlot({ heroProduct: P('Rosehip Face Oil 30ml', 1, 899) }));
  for (const a of plain.assets.ads) expect(String(a.primary_text || '') + String(a.script || '')).not.toMatch(/\bwas\b/);
});

test('every video script speaks for all 15 seconds and says something in each beat', async () => {
  for (const entry of [skinSlot(), slot(NEWS), slot(BRANDS.find((b) => b.slug === 'famapp'))]) {
    const c = await build(entry);
    for (const ad of c.assets.ads.filter((a) => a.creative_type === 'video' && a.script)) {
      const beats = [...ad.script.matchAll(/(\d+)-(\d+)s:/g)].map((m) => [Number(m[1]), Number(m[2])]);
      expect(beats[0][0], ad.script).toBe(0);
      expect(beats[beats.length - 1][1], ad.script).toBe(15);
      for (let i = 1; i < beats.length; i += 1) expect(beats[i][0], `a gap before beat ${i}: ${ad.script}`).toBe(beats[i - 1][1] + 1);
      expect(ad.script).not.toMatch(/Explore the collection|^0-2s: Discover/);
    }
  }
  const c = await build(skinSlot());
  expect(c.assets.ads.find((a) => a.creative_type === 'video').script).toContain('₹899, was ₹1,199');
});

test('a Google RSA says each line once: no filler beside real lines, no description inside another', async () => {
  for (const entry of [skinSlot(), slot(NEWS), slot(BRANDS.find((b) => b.slug === 'famapp')), slot(BRANDS.find((b) => b.slug === 'brewfold'), { heroProduct: BRANDS.find((b) => b.slug === 'brewfold').__hero })]) {
    const c = await build(entry);
    const g = c.assets.ads.find((a) => a.platform === 'google' && a.creative_type === 'static');
    const words = (t) => t.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff ]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    const ws = g.headlines.map(words);
    expect(new Set(ws).size, `one line said twice: ${g.headlines.join(' | ')}`).toBe(ws.length);
    expect(g.headlines.length).toBeGreaterThanOrEqual(Math.min(5, g.headlines.length));
    const content = g.headlines.filter((h) => !/ online$|^Discover |: (Shop now|Learn more|Start reading|Get in touch)$/.test(h));
    if (content.length >= 5) expect(g.headlines.filter((h) => / online$|^Discover /.test(h)), g.headlines.join(' | ')).toEqual([]);
    for (const d of g.descriptions) {
      const k = d.toLowerCase().replace(/[.!\s]+$/, '');
      expect(g.descriptions.filter((o) => o !== d && o.toLowerCase().includes(k)), `"${d}" is inside another description`).toEqual([]);
    }
    expect(g.descriptions.length).toBeGreaterThanOrEqual(2);
  }
});
