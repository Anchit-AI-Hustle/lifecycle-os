// @ts-check
/**
 * Static ads in complete, different templates and themes, per brand and per
 * send (2026-10-26, the operator: "why does every brand mailer, video and ad
 * have only one common structure and layout", then "no complete different
 * templates, themes everything").
 *
 * Every static ad of every brand was one picture under one dark gradient with
 * one button. Executed here: the shipped builder (buildCampaign, noLLM) for
 * brands of different kinds over many sends, and the shipped renderer
 * (scripts/lib/static-ad.js) in Chromium, every template x several themes x
 * every ratio x three palettes (one with a near-black primary, one pale) over a
 * white, a black and a striped photograph:
 *   - templates and themes rotate within a brand; two brands get different
 *     theme families; the same send rebuilt is the same creative; a
 *     regeneration (a take) moves it;
 *   - the six templates are six different layouts in the rendered page;
 *   - every word clears AA against the PIXELS behind it (the text is hidden,
 *     the page photographed, every pixel under each word measured);
 *   - no ground is a dark neutral.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const P = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const SA = require(path.join(ROOT, 'scripts', 'lib', 'static-ad.js'));
const AT = require(path.join(ROOT, 'api', '_shared', 'asset-themes.js'));
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));

const BRANDS = [
  { id: 'w-oak', name: 'Oak Bakers', industry: 'bakery', website: 'https://oak.example', voice: { tone: 'warm, friendly, playful' }, palette: { primary: '#C2410C', accent: '#F5C542', surface: '#FFFBF5', ink: '#222222' }, regions: [{ code: 'IN', currency: 'INR', home: true }] },
  { id: 'w-aurum', name: 'Aurum Atelier', industry: 'fine jewellery', website: 'https://aurum.example', voice: { tone: 'elegant, refined, timeless' }, palette: { primary: '#6B5B3E', accent: '#C9A227', surface: '#FFFFFF', ink: '#1F1A14' }, typography: { heading: { family: 'Cormorant Garamond' } }, regions: [{ code: 'UK', currency: 'GBP', home: true }] },
  { id: 'w-dash', name: 'Dashline', industry: 'running shoes and sportswear', website: 'https://dash.example', voice: { tone: 'bold, energetic, fearless' }, palette: { primary: '#E11D48', accent: '#111111', surface: '#FFFFFF', ink: '#111111' }, regions: [{ code: 'US', currency: 'USD', home: true }] },
];
const slot = (b, d, extra) => Object.assign({
  id: `${b.id}-${d}`, date: `2026-11-${String(d).padStart(2, '0')}`, market: b.regions[0].code, brand: b,
  objective: 'reactivation', cohort: { name: 'At Risk', size: 2000, rules: ['r'] },
  channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
  heroProduct: { title: 'House Signature', price: 240, image: `${b.website}/hero.jpg`, product_url: `${b.website}/products/house-signature` },
  offer: { depth: 'none' },
}, extra || {});

async function statics(entry) {
  const c = await P.buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
  return (c.assets.ads || []).filter((a) => a.creative_type !== 'video');
}

test.describe.configure({ mode: 'serial' });

test('templates and themes rotate per send, brands differ, a rebuild is identical and a regeneration moves it', async () => {
  test.setTimeout(180_000);
  const families = {};
  for (const b of BRANDS) {
    const themes = new Set(); const templates = new Set(); const pairs = new Set();
    for (let d = 1; d <= 6; d++) {
      for (const ad of await statics(slot(b, d))) {
        const dz = ad.creative && ad.creative.design;
        expect(ad.creative.static_html, `${b.name} ${ad.platform}: no composed creative`).toMatch(/^<!doctype html>/);
        expect(ad.creative.static_html).toContain(`data-template="${dz.template}"`);
        expect(ad.creative.static_html).toContain(`data-theme="${dz.theme}"`);
        themes.add(dz.theme); templates.add(dz.template); pairs.add(`${dz.theme}/${dz.template}`);
        // Its words are the ad's own; its picture the ad's own photo.
        expect(ad.creative.static_html).toContain(ad.creative.image);
      }
    }
    expect(templates.size, `${b.name}: templates over 6 sends`).toBeGreaterThanOrEqual(5);
    expect(themes.size, `${b.name}: themes over 6 sends`).toBeGreaterThanOrEqual(3);
    expect(pairs.size, `${b.name}: distinct designs over 6 sends`).toBeGreaterThanOrEqual(12);
    families[b.name] = AT.affinity(b).family;
  }
  // Different kinds of brand lead with different themes.
  expect(new Set(Object.values(families).map((f) => f[0])).size, JSON.stringify(families)).toBe(3);
  expect(families['Aurum Atelier'].slice(0, 2)).toContain('luxe');
  expect(families.Dashline.slice(0, 2)).toContain('bold');
  // The same send rebuilt is the same creative (what was approved ships).
  const a = (await statics(slot(BRANDS[0], 3))).map((x) => x.creative.static_html);
  const b2 = (await statics(slot(BRANDS[0], 3))).map((x) => x.creative.static_html);
  expect(b2).toEqual(a);
  // A regeneration is a new generation.
  const moved = (await statics(slot(BRANDS[0], 3, { __take: 'regen-1' }))).map((x) => x.creative.design.id);
  expect(moved).not.toEqual((await statics(slot(BRANDS[0], 3))).map((x) => x.creative.design.id));
});

test('no photograph: the typographic template, and the gap is listed, not printed', async () => {
  const b = BRANDS[0];
  const c = await P.buildCampaign(slot(b, 4, { heroProduct: { title: 'House Signature', price: 240 } }), smartConfig({}), { noLLM: true, withCreatives: false });
  const st = (c.assets.ads || []).filter((x) => x.creative_type !== 'video');
  expect(st.length).toBeGreaterThan(0);
  for (const ad of st) {
    expect(ad.creative.design.template).toBe('type');
    expect(ad.creative.static_html).not.toMatch(/DATA REQUIRED/);
    expect(ad.creative.static_html).not.toMatch(/<img data-ad-photo/);
  }
  expect((c.data_gaps || []).join(' ')).toMatch(/product image/);
});

const PHOTOS = {
  white: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#ffffff"/></svg>',
  black: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#000000"/></svg>',
  stripes: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><defs><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="20" height="40" fill="#ffffff"/><rect x="20" width="20" height="40" fill="#000000"/></pattern></defs><rect width="900" height="900" fill="url(#p)"/></svg>',
};
const PALETTES = [
  { primary: '#C2410C', accent: '#F5C542', surface: '#FFFBF5', ink: '#222222' },
  { primary: '#111111', accent: '#2563EB', surface: '#FFFFFF', ink: '#111111' },
  { primary: '#F3E9D2', accent: '#A7F3D0', surface: '#FFFFFF', ink: '#1A1A1A' },
];
const rgbOf = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
const hexOf = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

test('six layouts, every word AA against the pixels behind it, no dark-neutral ground', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 540, height: 1000 });
  let photo = 'white';
  await page.route('https://img.example/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: PHOTOS[photo] }));
  const layouts = new Set();
  let words = 0; let grounds = 0;
  const failures = [];
  for (const pal of PALETTES) {
    for (const theme of ['soft', 'bold', 'luxe', 'editorial']) {
      for (const template of SA.TEMPLATE_IDS) {
        for (const ratio of ['1:1', '9:16', '1.91:1']) {
          for (const ph of Object.keys(PHOTOS)) {
            photo = ph;
            const out = SA.renderStaticAd({ brandName: 'Oak Bakers', ratio, headline: 'Bread worth waking up for', line: 'Seeded rye, baked at dawn every day.', price: '₹240', proof: 'Baked daily', cta: 'Shop now', image: 'https://img.example/p.svg', palette: pal, theme, template, seed: ph.length });
            expect(out.template).toBe(template);
            await page.setContent(out.html, { waitUntil: 'load' });
            const info = await page.evaluate(() => {
              const ad = document.querySelector('.ad').getBoundingClientRect();
              const items = [];
              for (const el of document.querySelectorAll('[data-ad-text]')) {
                const cs = getComputedStyle(el);
                // The words only: a decorative rule beside an eyebrow is not text.
                const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                const all = [];
                for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.textContent.trim()) continue; const rng = document.createRange(); rng.selectNodeContents(n); all.push(...rng.getClientRects()); }
                const rects = all.filter((r) => r.width > 1 && r.height > 1)
                  .filter((r) => r.bottom > ad.top && r.top < ad.bottom && r.right > ad.left && r.left < ad.right)
                  .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
                const clip = el.closest('[data-ad-copy], [data-ad-panel], [data-ad-scrim], .ad');
                if (rects.length) items.push({ color: cs.color, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400, rects, text: el.textContent.trim().slice(0, 30) });
              }
              // Grounds: a box a person reads as a section or panel (a thin
              // decorative rule is a line, not a ground).
              const bgs = [...document.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; }).map((e) => getComputedStyle(e).backgroundColor).filter((c) => c && c !== 'transparent' && !/rgba\(\d+, \d+, \d+, 0\)/.test(c));
              const h = document.querySelector('[data-ad-headline]');
              const hr = h ? h.getBoundingClientRect() : null;
              return { items, bgs, head: hr ? [Math.round((hr.left - ad.left) / ad.width * 10), Math.round((hr.top - ad.top) / ad.height * 10)] : null, adRect: { x: ad.left, y: ad.top, w: ad.width, h: ad.height } };
            });
            if (ph === 'white' && info.head) layouts.add(`${template}|${ratio}|${info.head.join(',')}`);
            for (const c of info.bgs) {
              const [r, g, b, a] = rgbOf(c);
              if (a !== undefined && a < 0.5) continue;
              grounds++;
              if (core.isDarkNeutral(hexOf(r, g, b))) failures.push(`${theme}/${template}/${ratio}: dark-neutral ground ${c}`);
            }
            await page.addStyleTag({ content: '[data-ad-text],[data-ad-text] *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-decoration-color:transparent!important}' });
            const shot = PNG.sync.read(await page.screenshot());
            for (const it of info.items) {
              words++;
              const [tr, tg, tb] = rgbOf(it.color);
              const fg = hexOf(tr, tg, tb);
              const large = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700);
              const want = large ? 3 : 4.5;
              let worst = 99;
              for (const r of it.rects) {
                const x0 = Math.max(Math.ceil(r.x), Math.ceil(info.adRect.x)), x1 = Math.min(Math.floor(r.x + r.w), Math.floor(info.adRect.x + info.adRect.w) - 1);
                const y0 = Math.max(Math.ceil(r.y), Math.ceil(info.adRect.y)), y1 = Math.min(Math.floor(r.y + r.h), Math.floor(info.adRect.y + info.adRect.h) - 1);
                for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
                  if (x < 0 || y < 0 || x >= shot.width || y >= shot.height) continue;
                  const i = (y * shot.width + x) * 4;
                  const cr = core.contrast(fg, hexOf(shot.data[i], shot.data[i + 1], shot.data[i + 2]));
                  if (cr < worst) worst = cr;
                }
              }
              if (worst < want - 0.05) failures.push(`${theme}/${template}/${ratio}/${ph}/${pal.primary}: "${it.text}" ${worst.toFixed(2)}:1 (needs ${want})`);
            }
          }
        }
      }
    }
  }
  expect(words, 'words measured').toBeGreaterThan(1000);
  expect(grounds, 'grounds measured').toBeGreaterThan(1000);
  const kinds = [...new Set(failures.map((f) => f.replace(/\/(white|black|stripes)\//, '/').replace(/ [0-9.]+:1/, "")))];
  expect(kinds.slice(0, 30), `${failures.length} failures`).toEqual([]);
  // Six templates are six layouts: the headline sits in a different place.
  const per = {};
  for (const l of layouts) { const [t, r, pos] = l.split('|'); (per[r] = per[r] || {})[t] = (per[r][t] || new Set()).add(pos); }
  for (const r of Object.keys(per)) {
    const positions = new Set(Object.values(per[r]).map((s) => [...s].sort().join('|')));
    expect(positions.size, `${r}: distinct headline placements across the six templates`).toBeGreaterThanOrEqual(4);
  }
});
