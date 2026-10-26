// @ts-check
/**
 * Video ads and landing pages: complete different templates and themes, per
 * brand and per send (2026-10-26). The operator: "why does every brand mailer,
 * video and ad have only one common structure and layout - ensure complete
 * unique personalisation in each and every generation for each brand", then
 * "no complete different templates, themes everything".
 *
 * Executed: Smart Brain's shipped buildCampaign (template path) for three
 * brands of different kinds over several sends, the Story video player drawn
 * frame by frame in Chromium for every template, and the shipped landing page
 * rendered in Chromium for every template it picks, its text measured against
 * the ground it actually sits on.
 *
 * Run: npx playwright test tests/asset-themes-video-lp.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SA = require(path.join(ROOT, 'scripts', 'lib', 'story-ad.js'));
const MA = require(path.join(ROOT, 'scripts', 'lib', 'motion-ad.js'));
const TH = require(path.join(ROOT, 'api', '_shared', 'asset-themes.js'));
const PLAN = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];

const BRANDS = [
  { id: 'device:oak', slug: 'oak', name: 'Oak Bakers', industry: 'bakery', website: 'https://oak.example', voice: { tone: 'warm, friendly, playful' },
    palette: { primary: '#832622', accent: '#E0A100', surface: '#FFFBF5', ink: '#2a1a12' }, regions: [{ code: 'UK', currency: 'GBP', store_url: 'https://oak.example', home: true }], claims: ['Baked at dawn', 'Organic flour'] },
  { id: 'device:aurum', slug: 'aurum', name: 'Aurum', industry: 'fine jewellery', website: 'https://aurum.example', voice: { tone: 'elegant, refined, timeless' },
    typography: { heading: { family: 'Playfair Display' } },
    palette: { primary: '#5B4A2F', accent: '#C9A227', surface: '#FFFFFF', ink: '#1d1a16' }, regions: [{ code: 'IN', currency: 'INR', store_url: 'https://aurum.example', home: true }], claims: ['Hallmarked gold'] },
  { id: 'device:volt', slug: 'volt', name: 'Volt Runners', industry: 'running shoes and sportswear', website: 'https://volt.example', voice: { tone: 'bold, energetic, punchy' },
    palette: { primary: '#E4002B', accent: '#111111', surface: '#FFFFFF', ink: '#111111' }, regions: [{ code: 'US', currency: 'USD', store_url: 'https://volt.example', home: true }], claims: ['Free returns'] },
];
const prod = (b, n, price) => ({ sku: `S${n}`, title: ['Seeded Rye Loaf', 'Sourdough', 'Cinnamon Knot', 'Spelt Bloomer'][n - 1], handle: `p${n}`, image: `https://cdn.${b.slug}.example/${n}.jpg`, price, url: `${b.website}/p${n}` });
const slot = (b, d) => ({
  id: `${b.slug}-${d}`, date: `2026-11-${String(d).padStart(2, '0')}`, market: b.regions[0].code, objective: 'reactivation', brand: b,
  cohort: { name: 'At Risk', size: null, estimated: true }, channels: ['email', 'meta', 'tiktok', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 },
  heroProduct: prod(b, 1, 9), supportingProducts: [prod(b, 2, 12), prod(b, 3, 4)],
});

async function build(entry) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return await PLAN.buildCampaign(JSON.parse(JSON.stringify(entry)), smartConfig({}), { noLLM: true, withCreatives: false });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const videos = (c) => ((c.assets && c.assets.ads) || []).filter((a) => a.creative_type === 'video');

test('every video ad is drawn in one of its brand\'s own themes and a template that rotates by send; brands differ; a send rebuilt is the same', async () => {
  test.setTimeout(240_000);
  const perBrand = {};
  for (const b of BRANDS) {
    const fam = TH.affinity(b).family;
    const templates = new Set(), themes = new Set();
    const byPlatform = {};
    for (let d = 1; d <= 6; d++) {
      const c = await build(slot(b, d));
      const vs = videos(c);
      expect(vs.length, `${b.name} ${d}: no video ad was built`).toBeGreaterThan(0);
      for (const ad of vs) {
        expect(SA.VIDEO_TEMPLATES).toContain(ad.look.template);
        expect(fam, `${b.name}: a theme from outside its own family`).toContain(ad.look.theme);
        expect(ad.look.why).toMatch(new RegExp(b.name));
        // The page carries the look, and reading it back gives the same one (code-video.js renders from that).
        expect(ad.creative.story_html).toContain(`data-template="${ad.look.template}" data-theme="${ad.look.theme}"`);
        const back = SA.storyDataFrom(ad.creative.story_html);
        expect(back.look).toEqual({ theme: ad.look.theme, template: ad.look.template });
        expect(SA.storyPage(back)).toContain(`data-template="${ad.look.template}"`);
        expect(ad.creative.story_brief.look.template).toBe(ad.look.template);
        // The transitional variant has its own look, drawn in its own style block.
        expect(ad.creative.motion_html).toContain(`data-look="${ad.motion_look.template}.${ad.motion_look.theme}"`);
        templates.add(ad.look.template); themes.add(ad.look.theme);
        templates.add(ad.motion_look.template);
        (byPlatform[ad.platform] = byPlatform[ad.platform] || []).push(ad.look.template);
      }
      if (d === 2) {
        const again = await build(slot(b, d));
        expect(videos(again).map((a) => [a.look.theme, a.look.template, a.motion_look.theme, a.motion_look.template]))
          .toEqual(vs.map((a) => [a.look.theme, a.look.template, a.motion_look.theme, a.motion_look.template]));
      }
    }
    expect(templates.size, `${b.name}: video templates over six sends`).toBeGreaterThanOrEqual(3);
    // One platform's video, send after send: never the same template twice running.
    for (const [pf, seq] of Object.entries(byPlatform)) {
      for (let i = 1; i < seq.length; i++) expect(seq[i], `${b.name} ${pf}: sends ${i} and ${i + 1} have the same template (${seq.join(', ')})`).not.toBe(seq[i - 1]);
      expect(new Set(seq).size, `${b.name} ${pf}: ${seq.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    expect(themes.size, `${b.name}: video themes over six sends`).toBeGreaterThanOrEqual(2);
    perBrand[b.name] = { fam: fam.join(','), themes: [...themes].sort().join(',') };
  }
  const fams = new Set(Object.values(perBrand).map((x) => x.fam));
  expect(fams.size, 'three different brands were given the same theme family').toBe(3);
});

test('a look the page does not know is drawn as the default, never trusted', () => {
  expect(SA.cleanLook({ theme: 'evil<script>', template: 'x' })).toEqual({ theme: '', template: 'lower' });
  expect(SA.cleanLook({ theme: 'luxe', template: 'frame' })).toEqual({ theme: 'luxe', template: 'frame' });
  const html = SA.renderStoryAd({ brandName: 'Oak', hook: 'Hi', products: [], cta: 'Go', look: { theme: 'luxe', template: 'frame' } });
  const raw = html.replace('"template":"frame"', '"template":"<img>"').replace('"theme":"luxe"', '"theme":"x"');
  expect(SA.storyDataFrom(raw).look).toEqual({ theme: '', template: 'lower' });
});

test('each video template draws a different frame: the photo, the words and the brand ground move', async ({ page }) => {
  test.setTimeout(90_000);
  const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#7d93b8"/><circle cx="400" cy="500" r="200" fill="#2d3a52"/></svg>';
  await page.route('https://img.test/**', (r) => r.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: PHOTO }));
  const PRIMARY = [0x83, 0x26, 0x22];
  const sigs = {};
  for (const template of SA.VIDEO_TEMPLATES) {
    const html = SA.renderStoryAd({ brandName: 'Oak Bakers', hook: 'Fresh from the oven this week', look: { template, theme: template === 'lower' ? '' : 'bold' },
      palette: { primary: '#832622', on_primary: '#ffffff', accent: '#ffffff', on_accent: '#832622', surface: '#ffffff', ink: '#2a1a12' },
      products: [{ title: 'Seeded Rye Loaf', price_text: '£9', image: 'https://img.test/a.svg' }], lines: ['Baked at dawn'], cta: 'Order now', store: 'https://oak.example' });
    await page.setContent(html.replace('<script>', '<script>window.__STORY_RENDER=true;</script><script>'));
    const m = await page.evaluate(async () => {
      const S = window.__story; await S.ready();
      S.frame(5.5);
      const cx = S.canvas.getContext('2d');
      const px = (x, y) => Array.from(cx.getImageData(x, y, 1, 1).data.slice(0, 3));
      return { corner: px(30, 1820), lowMid: px(540, 1650), top: px(980, 300), mid: px(540, 900), endCorner: (S.frame(S.total() - 0.2), px(30, 1820)) };
    });
    sigs[template] = m;
  }
  const near = (a, b, d) => a.every((v, i) => Math.abs(v - b[i]) <= d);
  // The brand ground is the frame's lower corner in title, split and frame; a photo (under a shade) in the others.
  for (const t of ['title', 'split', 'frame']) expect(near(sigs[t].corner, PRIMARY, 24), `${t}: the brand ground is not under the words`).toBe(true);
  for (const t of ['lower', 'editorial']) expect(near(sigs[t].corner, PRIMARY, 24), `${t}: the photograph is not full frame`).toBe(false);
  // Five templates, five different frames.
  const keys = new Set(Object.values(sigs).map((m) => JSON.stringify([m.corner, m.lowMid, m.top, m.mid].map((p) => p.map((v) => Math.round(v / 24))))));
  expect(keys.size, 'two templates drew the same frame').toBe(SA.VIDEO_TEMPLATES.length);
  // The split end card is two grounds; the centred one is one.
  expect(near(sigs.split.endCorner, [255, 255, 255], 20)).toBe(true);
  expect(near(sigs.lower.endCorner, PRIMARY, 24)).toBe(true);
});

const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('landing pages: every template renders for real, the structure differs, the text is AA on the ground it sits on, no section is dark-neutral, a slot rebuilt is the same page', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/*', (r) => (r.request().resourceType() === 'image'
    ? r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#c9a27a"/></svg>' })
    : r.continue()));
  const copy = { landing: { hero_headline: 'Fresh from the oven', hero_sub: 'Bread that keeps up.', why_bullets: ['Baked at dawn', 'Organic flour'] } };
  const lp = (e) => PLAN.__test_lpHtml(e, copy, `c-${e.id}`, `${e.brand.website}/hero.jpg`);
  const all = new Set();
  const shapes = {};
  for (const b of BRANDS) {
    const tpls = new Set();
    for (let d = 1; d <= 14; d++) {
      const e = slot(b, d);
      const html = lp(e);
      expect(lp(slot(b, d)), `${b.name} ${d}: the same slot rebuilt is a different page`).toBe(html);
      const tpl = html.match(/<body data-template="([^"]+)" data-theme="([^"]+)"/);
      expect(tpl, 'the page names its template and theme').not.toBeNull();
      expect(TH.affinity(b).family).toContain(tpl[2]);
      tpls.add(tpl[1]); all.add(tpl[1]);
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const m = await page.evaluate(() => {
        const rgb = (s) => { const x = String(s).match(/rgba?\(([^)]+)\)/); if (!x) return null; const p = x[1].split(',').map(Number); return p.length === 4 && p[3] < 0.99 ? null : p.slice(0, 3); };
        const ground = (el) => { for (let n = el; n; n = n.parentElement) { const g = rgb(getComputedStyle(n).backgroundColor); if (g) return g; } return [255, 255, 255]; };
        const fails = [], dark = [];
        const sat = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx === 0 ? 0 : (mx - mn) / mx; };
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const bg = rgb(cs.backgroundColor);
          if (bg && !el.matches('.btn, .btn *, a.btn, .deal, .off, .m-pill, .f-pill') && el.getBoundingClientRect().width > 200) {
            const L = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
            if (L < 40 && sat(bg) < 0.15) dark.push(el.className || el.tagName);
          }
          const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!own || el.closest('.hero-media')) continue;
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
          fails.push({ c: rgb(cs.color), g: ground(el), size: parseFloat(cs.fontSize), w: Number(cs.fontWeight), t: el.textContent.trim().slice(0, 30), cls: el.className });
        }
        const grid = document.querySelector('.hero-grid'), copy = document.querySelector('.hero-copy'), media = document.querySelector('.hero-media');
        const a = media.getBoundingClientRect(), z = copy.getBoundingClientRect();
        return {
          runs: fails, dark,
          shape: [getComputedStyle(grid).display, getComputedStyle(grid).flexDirection, getComputedStyle(document.querySelector('.hero')).paddingTop, a.top < z.top ? 'media-first' : 'copy-first', Math.round(a.width / 100), getComputedStyle(document.querySelector('.hero')).textAlign,
            getComputedStyle(document.querySelector('.hero h1')).textTransform, getComputedStyle(document.querySelector('.hero h1')).fontWeight, getComputedStyle(document.querySelector('.btn')).borderRadius].join('|'),
        };
      });
      expect(m.runs.length, 'the page drew no text').toBeGreaterThan(10);
      for (const r of m.runs) {
        if (!r.c) continue;
        const large = r.size >= 24 || (r.size >= 18.66 && r.w >= 700);
        expect(ratio(r.c, r.g), `${b.name} ${tpl[1]}/${tpl[2]}: "${r.t}" (.${r.cls}) at ${ratio(r.c, r.g).toFixed(2)}:1`).toBeGreaterThanOrEqual(large ? 3 : 4.5);
      }
      expect(m.dark, `${b.name} ${tpl[1]}/${tpl[2]}: a dark-neutral section`).toEqual([]);
      (shapes[tpl[1]] = shapes[tpl[1]] || new Set()).add(m.shape);
    }
    expect(tpls.size, `${b.name}: landing templates over 14 sends`).toBeGreaterThanOrEqual(3);
  }
  expect([...all].sort()).toEqual([...TH.TEMPLATES.landing].sort());
  // The templates are different structures, not one structure relabelled.
  const firstShape = Object.fromEntries(Object.entries(shapes).map(([k, v]) => [k, [...v][0]]));
  expect(new Set(Object.values(firstShape)).size, JSON.stringify(firstShape, null, 1)).toBe(Object.keys(firstShape).length);
});

test('the transitional variant moves its words with the template and keeps them off the button and the rail', async ({ page }) => {
  await page.setViewportSize({ width: 405, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const seen = new Set();
  for (const template of MA.MOTION_TEMPLATES) {
    const html = MA.renderMotionAd({ brand: BRANDS[0], scenes: [{ headline: 'Fresh from the oven this week', sub: 'Baked at dawn.', image: '' }], cta: 'Order now', look: { theme: 'poster', template }, loop: false });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const box = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const t = r('.scene .type'), rail = r('.scene .social-rail'), btn = r('.scene .bottom-action');
      return { top: Math.round(t.top), bottom: t.bottom, rail: rail.top, btn: btn.top, h2: getComputedStyle(document.querySelector('.type h2')).fontWeight };
    });
    expect(box.h2, 'the theme\'s weight').toBe('800');
    seen.add(box.top);
  }
  expect(seen.size, 'the words sit in the same place in every template').toBeGreaterThanOrEqual(3);
});
