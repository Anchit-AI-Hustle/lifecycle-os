// @ts-check
/**
 * A brand that is not a shop is not written to as one (2026-11-03).
 *
 * The operator, with production /brain for The Times of India (a news brand,
 * no model answering, so every asset came from the TEMPLATE path), called it
 * "atrocious": "Thank you for your first order with The Times of India" to a
 * reader; a Meta video's text cut to "General news coverage from"; "General
 * news coverage from The Times of India. The Times of India."; every ad headed
 * by the brand's name; the subject "The Times of India for you: India News,
 * Latest News, Breaking News" (the site's SEO title kept as its tagline); a
 * video script saying "Explore the collection", "Made to enjoy every day" and
 * "Read today now"; a storyboard asking to film "[DATA REQUIRED ...]"; and a
 * Story video end card whose lower half was an empty block of red.
 *
 * Executed through the shipped buildCampaign (noLLM) for one brand per business
 * model (asset-playbooks.BUSINESS_MODELS) and every lifecycle objective, and
 * the end card rendered in Chromium.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { readerText } = require('./lib/reader-text.js');
const { BRANDS, MODEL_BRANDS } = require('./lib/sweep-brands.js');

const OBJECTIVES = ['Education', 'Second-order activation', 'Pre-lapse retention', 'Premium bundle expansion', 'Reactivation', 'Last-chance'];
// Words that are true only of a shop. A financial disclaimer's "buy or sell
// securities" is the regulator's wording, not an offer.
const COMMERCE = /\b(orders?|ordered|shop|shopping|cart|collection|buy|buying|checkout|customers?)\b/i;

function preset(slug) {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, `data/brands/presets/${slug}.json`), 'utf8'));
  b.id = 'ws-' + slug;
  b.imagery = (b.brand_assets || []).map((a) => ({ url: a.url, page: a.found_on || b.website, role: a.role }));
  return b;
}
function brandsByModel() {
  const P = require(path.join(ROOT, 'api/_shared/asset-playbooks.js'));
  const all = [preset('times-of-india'), preset('economic-times'), ...MODEL_BRANDS, ...BRANDS];
  const out = {};
  for (const b of all) { const m = P.businessModel(b); (out[m] = out[m] || []).push(b); }
  return out;
}
async function build(brand, objective) {
  const plan = require(path.join(ROOT, 'api/_shared/smart-brain-plan.js'));
  const { smartConfig } = require(path.join(ROOT, 'lib/smart-brain/services.js'));
  const market = (brand.regions && brand.regions[0] && brand.regions[0].code) || 'IN';
  const entry = { id: `nc-${brand.slug}-${objective}`, date: '2026-11-05', market, objective, cohort: { name: 'New Customers' },
    channels: ['email', 'landing_page', 'meta', 'google', 'tiktok', 'sms', 'whatsapp', 'push'], brand: JSON.parse(JSON.stringify(brand)), strategy_only: true,
    heroProduct: { title: `[DATA REQUIRED BEFORE LAUNCH: product catalogue, ${brand.name}, ${market}]`, placeholder: true } };
  entry.cta = plan.__test_strategyCta(objective, brand);
  return plan.buildCampaign(entry, smartConfig({}), { noLLM: true });
}
const count = (hay, needle) => (needle ? String(hay).toLowerCase().split(String(needle).toLowerCase()).length - 1 : 0);
// A field a platform shows as running text ends where a sentence ends.
const RUNNING = /\.(primary_text|caption|hook)$|\.placements\.[a-z_]+\.primary_text$/;

test('every business model is covered: news, market data, subscription, events, services and commerce', () => {
  const P = require(path.join(ROOT, 'api/_shared/asset-playbooks.js'));
  const by = brandsByModel();
  for (const m of P.BUSINESS_MODELS) expect(by[m] && by[m].length, m).toBeGreaterThan(0);
});

test('no asset of a brand that is not a shop says order, shop, cart, collection, buy or customer', async () => {
  test.setTimeout(240000);
  const by = brandsByModel();
  const found = [];
  let measured = 0;
  for (const [model, list] of Object.entries(by)) {
    if (model === 'commerce') continue;
    for (const b of list) for (const o of OBJECTIVES) {
      const rows = readerText(await build(b, o));
      measured += rows.length;
      for (const r of rows) if (r.kind !== 'board' && COMMERCE.test(r.text.replace(/\bbuy or sell\b/gi, ''))) found.push(`${model} ${b.name} ${o} ${r.where}: ${r.text}`);
    }
  }
  expect(measured, 'the sweep read the assets').toBeGreaterThan(2000);
  expect(found).toEqual([]);
});

test('every running line ends at a sentence, names the brand once, and no script or storyboard carries a marker', async () => {
  test.setTimeout(240000);
  const by = brandsByModel();
  const cut = []; const twice = []; const marker = []; const seo = [];
  for (const [model, list] of Object.entries(by)) for (const b of list) for (const o of OBJECTIVES) {
    const c = await build(b, o);
    for (const r of readerText(c)) {
      const tag = `${model} ${b.name} ${o} ${r.where}: ${r.text}`;
      if (RUNNING.test(r.where) && !/[.!?)"'”]$/.test(r.text)) cut.push(tag);
      if (r.kind !== 'board' && !/\.(headlines|descriptions)\[/.test(r.where) && !/^email\.html|variants|landing_pages|static_html/.test(r.where) && count(r.text, b.name) > 1) twice.push(tag);
      if (r.kind !== 'copy' && /\[DATA REQUIRED/.test(r.text)) marker.push(tag);
      if (/subject|headline/.test(r.where) && require(path.join(ROOT, 'api/_shared/asset-playbooks.js')).isSiteTitle(b.tagline) && r.text.includes(b.tagline)) seo.push(tag);
    }
  }
  expect(cut, 'a running line cut mid-sentence').toEqual([]);
  expect(twice, 'the brand named twice in one field').toEqual([]);
  expect(marker, 'a marker in a script or storyboard').toEqual([]);
  expect(seo, 'a site SEO title printed as a subject or headline').toEqual([]);
});

test('The Times of India reads as a news brand: the lines the operator saw, before and after', async () => {
  const toi = preset('times-of-india');
  const a = await build(toi, 'Second-order activation');
  const s = JSON.stringify(readerText(a).map((r) => r.text));
  expect(s).not.toContain('first order');
  expect(s).toContain('Thank you for reading The Times of India.');
  expect(a.assets.email.subject).toBe('The Times of India: What to read next');
  const meta = a.assets.ads.find((x) => x.platform === 'meta' && x.creative_type === 'video');
  expect(meta.headline).toBe('What to read next');
  expect(meta.primary_text).not.toMatch(/coverage from$/);
  expect(meta.script).not.toMatch(/collection|Made to enjoy|today now/);
  expect(meta.storyboard[0].scene).not.toMatch(/DATA REQUIRED/);
  const e = await build(toi, 'Education');
  const g = e.assets.ads.find((x) => x.platform === 'google' && x.creative_type === 'video');
  expect(g.caption).toBe('General news coverage from The Times of India.');
  expect(e.assets.email.subject).not.toContain('India News, Latest News');
  // The record itself is untouched: only the build leaves the SEO title out.
  expect(toi.tagline).toBe('India News, Latest News, Breaking News');
});

test('a site SEO title is told apart from a tagline', () => {
  const { isSiteTitle } = require(path.join(ROOT, 'api/_shared/asset-playbooks.js'));
  for (const t of ['India News, Latest News, Breaking News', 'Business News, Markets, Economy', 'Nike | Official Site', 'Shoes - Clothing - Official Site']) expect(isSiteTitle(t), t).toBe(true);
  for (const t of ['Fast, Fresh, Local', 'Pune news, checked twice by the desk', 'Black basics, cut in Tiruppur', 'Small-lot coffee roasted on Tuesdays', '']) expect(isSiteTitle(t), t).toBe(false);
});

test('a commerce brand still thanks a customer for an order and keeps its collection line', async () => {
  const shop = BRANDS.find((b) => b.slug === 'brewfold');
  const c = await build(shop, 'Second-order activation');
  const s = JSON.stringify(readerText(c).map((r) => r.text));
  expect(s).toContain('Thank you for your first order with Brewfold Coffee.');
  expect(s).toContain('Brewfold Coffee customer');
  const v = c.assets.ads.find((x) => x.creative_type === 'video');
  expect(v.script).not.toContain('Made to enjoy every day');   // a claim no record made, for any brand
});

test('the Story video end card is a centred stack, not a top-heavy block of brand colour', async ({ page }) => {
  test.setTimeout(120000);
  const toi = preset('times-of-india');
  await page.addInitScript(() => { /** @type {any} */ (window).__STORY_RENDER = true; });
  await page.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
  const seenTemplates = new Set();
  for (const o of OBJECTIVES) {
    const c = await build(toi, o);
    for (const ad of c.assets.ads.filter((x) => x.creative && x.creative.story_html)) {
      const tpl = ad.creative.story_brief.look.template;
      if (seenTemplates.has(tpl)) continue;
      seenTemplates.add(tpl);
      await page.setContent(ad.creative.story_html);
      const m = await page.evaluate(() => {
        const s = /** @type {any} */ (window).__story; const T = s.total(); s.frame(T - 0.3);
        const d = s.canvas.getContext('2d').getImageData(0, 0, 1080, 1920).data;
        const px = (x, y) => { const i = (y * 1080 + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
        const bg = px(540, 1900);
        let first = -1; let last = -1;
        for (let y = 140; y < 1920; y += 4) {
          let ink = 0;
          for (let x = 0; x < 1080; x += 4) { const p = px(x, y); if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 90) ink++; }
          if (ink > 2) { if (first < 0) first = y; last = y; }
        }
        return { first, last };
      });
      expect(m.first, `${tpl}: the end card drew something`).toBeGreaterThan(0);
      const centre = (m.first + m.last) / 2 / 1920;
      expect(centre, `${tpl}: the end card's stack sits mid-frame (${m.first}-${m.last})`).toBeGreaterThan(0.4);
      expect(centre, `${tpl}: the end card's stack sits mid-frame (${m.first}-${m.last})`).toBeLessThan(0.6);
      // The space left under the stack is not a block several times the space
      // above it (the defect: 232 px above, 748 px of bare brand colour below).
      expect(1920 - m.last, `${tpl}: empty brand colour under the end card (${m.first}-${m.last})`).toBeLessThanOrEqual(1.6 * (m.first - 140));
    }
  }
  expect(seenTemplates.size, 'at least one Story template measured').toBeGreaterThan(0);
});
