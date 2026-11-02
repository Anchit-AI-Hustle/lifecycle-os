// Static ad quality pass (2026-11-02): every template of scripts/lib/static-ad.js
// at every ratio, for sweep brands that stress it (a coffee store with a
// catalogue price, a 65-character name with a long tagline, a pale palette, a
// near-black palette), drawn in Chromium and MEASURED: no word outside the
// frame or cut by its box, no headline cut short by its line clamp, no word on
// top of the photograph unless it sits on the scrim, every word at WCAG AA on
// what is actually behind it, and no price or compare-at price the store did
// not state.
const { test, expect } = require('@playwright/test');
const SA = require('../scripts/lib/static-ad.js');
const AT = require('../api/_shared/asset-themes.js');
const { BRANDS } = require('./lib/sweep-brands.js');
const F = require('./lib/remix-fixtures');

const PHOTO = 'https://cdn.sweep.example.test/p.png';
const photo = F.photoPng(600, 600, 5);
const pick = (id) => BRANDS.find((b) => b.id === id);
const CASES = [
  { brand: pick('device:store'), headline: 'Small-lot coffee roasted on Tuesdays', price: '₹640', compare: '₹800', cta: 'Shop now', proof: 'Roasted every Tuesday' },
  { brand: pick('device:long'), headline: pick('device:long').tagline, price: '', compare: '₹900' /* a compare-at with no price: never drawn */, cta: 'Start reading', proof: '' },
  { brand: pick('device:pale'), headline: 'Linen for slow mornings', price: '£48', compare: '', cta: 'Shop now', proof: 'Stonewashed European linen' },
  { brand: pick('device:dark'), headline: 'Black basics, cut in Tiruppur', price: '₹1,299', compare: '₹1,599', cta: 'Shop now', proof: '' },
];

/** In the page: every defect of one drawn ad. */
function measure() {
  const ad = document.querySelector('.ad');
  const A = ad.getBoundingClientRect();
  const out = [];
  let texts = 0;
  const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const grounds = (el) => {
    // What is behind the text: the nearest painted ground, blended over the
    // photograph's two extremes when it is translucent.
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const b = parse(getComputedStyle(e).backgroundColor);
      if (b && b[3] > 0) {
        if (b[3] >= 0.999) return [b.slice(0, 3)];
        return [[255, 255, 255], [0, 0, 0]].map((u) => b.slice(0, 3).map((v, i) => v * b[3] + u[i] * (1 - b[3])));
      }
    }
    return [[255, 255, 255]];
  };
  const photos = [...document.querySelectorAll('[data-ad-photo]')].map((p) => p.getBoundingClientRect());
  for (const el of document.querySelectorAll('[data-ad-text]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    texts++;
    const name = (el.textContent || '').trim().slice(0, 30);
    if (r.left < A.left - 1 || r.right > A.right + 1 || r.top < A.top - 1 || r.bottom > A.bottom + 1) out.push(`outside the frame: "${name}"`);
    // Clipped by an ancestor that hides overflow.
    for (let e = el.parentElement; e && e !== ad; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.overflowX === 'hidden') {
        const q = e.getBoundingClientRect();
        if (r.bottom > q.bottom + 1 || r.right > q.right + 1 || r.top < q.top - 1 || r.left < q.left - 1) { out.push(`cut by its panel: "${name}"`); break; }
      }
    }
    if (el.scrollWidth > el.clientWidth + 2) out.push(`wider than its box: "${name}"`);
    if (el.scrollHeight > el.clientHeight + 2) out.push(`${el.hasAttribute('data-ad-headline') ? 'headline' : 'text'} cut by its line clamp: "${name}"`);
    // On the photograph, not on a scrim, panel or chip.
    let onGround = false;
    for (let e = el; e && e !== ad; e = e.parentElement) { const b = parse(getComputedStyle(e).backgroundColor); if (b && b[3] > 0) { onGround = true; break; } }
    if (!onGround && photos.some((p) => r.left < p.right - 1 && p.left < r.right - 1 && r.top < p.bottom - 1 && p.top < r.bottom - 1)) out.push(`on the photograph with no ground: "${name}"`);
    const fg = parse(getComputedStyle(el).color);
    const size = parseFloat(getComputedStyle(el).fontSize); const bold = parseInt(getComputedStyle(el).fontWeight, 10) >= 700;
    const want = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    for (const g of grounds(el)) { const c = ratio(fg.slice(0, 3), g); if (c < want - 0.05) { out.push(`contrast ${c.toFixed(2)}:1 under ${want}: "${name}"`); break; } }
  }
  return { out, texts };
}

test('every template at every ratio, for four sweep brands: nothing cut, outside, unreadable or unstated', async ({ page }) => {
  test.setTimeout(600_000);
  const defects = [];
  let drawn = 0; let measured = 0;
  for (const c of CASES) {
    const b = c.brand;
    for (const ratio of ['1:1', '4:5', '9:16', '1.91:1']) {
      for (const template of SA.TEMPLATE_IDS) {
        const theme = AT.THEME_IDS[drawn % AT.THEME_IDS.length];
        const safe = ratio === '9:16' ? SA.safeZoneFor('meta') : null;
        const r = SA.renderStaticAd({ theme, template, seed: drawn, ratio, safe, brandName: b.name, headline: c.headline, line: b.tagline || '', price: c.price, compare: c.compare,
          benefits: b.claims || [], proof: c.proof, cta: c.cta, image: PHOTO, palette: b.palette, fonts: { head: 'Georgia, serif', body: 'Arial, sans-serif' } });
        await page.setViewportSize({ width: 540, height: 960 });
        await page.unroute('**/*').catch(() => {});
        await page.route('**/*', (rt) => (rt.request().url() === PHOTO ? rt.fulfill({ status: 200, contentType: 'image/png', body: photo }) : rt.fulfill({ status: 200, contentType: 'text/html', body: r.html })));
        await page.goto('https://draw.invalid/');
        await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((x) => { i.onload = x; i.onerror = x; })))));
        const got = await page.evaluate(measure);
        drawn++; measured += got.texts;
        for (const d of got.out) defects.push(`${b.slug} ${ratio} ${r.template}/${theme}: ${d}`);
        // A price the store did not state is never drawn; a compare-at only beside a price.
        const prices = await page.locator('[data-ad-price]').allTextContents();
        if (!c.price && prices.length) defects.push(`${b.slug} ${ratio} ${r.template}: a price drawn with none stated: ${prices.join(' / ')}`);
        if ((!c.compare || !c.price) && (await page.locator('[data-ad-compare]').count())) defects.push(`${b.slug} ${ratio} ${r.template}: a compare-at price drawn with ${c.compare ? 'no price beside it' : 'none stated'}`);
      }
    }
  }
  expect(drawn).toBe(CASES.length * 4 * SA.TEMPLATE_IDS.length);
  // A check that measured nothing would pass everything.
  expect(measured, 'text runs measured').toBeGreaterThan(drawn * 3);
  expect(defects, 'defects in the drawn ads').toEqual([]);
});
