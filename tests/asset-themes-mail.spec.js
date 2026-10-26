// @ts-check
/**
 * Every brand's mail is its own theme and its own template, every send
 * (2026-10-26).
 *
 * The operator: "why does every brand mailer, video and ad have only one common
 * structure and layout - ensure complete unique personalisation in each and
 * every generation for each brand", then "no complete different templates,
 * themes everything". The mail renderer drew ONE document for every brand and
 * every send; asset-style.js flipped a few switches inside it.
 *
 * Executed here: asset-themes.js ranking themes from five brands' own records;
 * Smart Brain's shipped buildCampaign over ten sends of one brand (no model),
 * reading which theme and template each mail was drawn in; every visual and
 * text template, pinned, rendered and fingerprinted in Chromium by the order of
 * its sections; every theme read back off computed styles; every theme x
 * template measured for WCAG AA text and for a dark-neutral ground, for a pale
 * brand and a brand whose primary is near-black; and the same send rebuilt is
 * the same bytes.
 *
 * Run: npx playwright test tests/asset-themes-mail.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AT = require(path.join(ROOT, 'api', '_shared', 'asset-themes.js'));
const CT = require(path.join(ROOT, 'api', '_shared', 'calendar-trigger.js')).helpers;
const PLAN = path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js');

const BRANDS = [
  { id: 'w-oak', name: 'Oak Bakers', website: 'https://oak.example', industry: 'artisan bakery', voice: { tone: 'warm, friendly, playful' }, palette: { primary: '#C2410C', accent: '#1F5C99', surface: '#FFFBF5', ink: '#222222', surface_alt: '#F3EBDD' }, regions: [{ code: 'UK', currency: 'GBP', home: true }] },
  { id: 'w-quill', name: 'Quill Gazette', website: 'https://quill.example', industry: 'news publisher', voice: { tone: 'clear, authoritative, informed' }, typography: { heading: { family: 'Playfair Display' } }, palette: { primary: '#1F3A5F', accent: '#B45309', surface: '#FFFFFF', ink: '#1A1A1A' }, regions: [{ code: 'IN', currency: 'INR', home: true }] },
  { id: 'w-aurum', name: 'Aurum Atelier', website: 'https://aurum.example', industry: 'fine jewellery', voice: { tone: 'elegant, refined, timeless' }, palette: { primary: '#7A6A4F', accent: '#2F4F4F', surface: '#FAF7F2', ink: '#2B2B2B' }, regions: [{ code: 'US', currency: 'USD', home: true }] },
  { id: 'w-kick', name: 'Kickline', website: 'https://kick.example', industry: 'sneakers and streetwear', voice: { tone: 'bold, loud, street' }, palette: { primary: '#E11D48', accent: '#111827', surface: '#FFFFFF', ink: '#111111' }, regions: [{ code: 'US', currency: 'USD', home: true }] },
  { id: 'w-ledger', name: 'Ledgerly', website: 'https://ledger.example', industry: 'fintech software platform', voice: { tone: 'precise, expert' }, palette: { primary: '#4B5563', accent: '#2563EB', surface: '#FFFFFF', ink: '#111827' }, regions: [{ code: 'US', currency: 'USD', home: true }] },
];
// A brand whose primary is near-black: no section may be drawn in it.
const DARK = { id: 'w-dark', name: 'Nocturne', website: 'https://noct.example', industry: 'fragrance', palette: { primary: '#141414', accent: '#C9A227', surface: '#FFFFFF', ink: '#141414' }, claims: ['Made in small batches', 'Free returns in 30 days'], regions: [{ code: 'US', currency: 'USD', home: true }] };

const img = (b, n) => `${b.website}/img/${n}.jpg`;
const prods = (b) => ['Seeded Rye', 'Sourdough Boule', 'Cinnamon Knots', 'Lemon Drizzle'].map((t, i) => ({ title: t, price: 4 + i, image: img(b, i + 1), url: `${b.website}/p/${i + 1}`, description: `${t} baked every morning.` }));
const opts = (b, style, design) => ({
  brand: Object.assign({ claims: ['Baked fresh every morning', 'Free delivery over 40'], legal_entity: { name: `${b.name} Ltd`, address: '1 Mill Lane' }, offerings: [{ name: 'Breads', url: `${b.website}/breads` }, { name: 'Cakes', url: `${b.website}/cakes` }] }, b),
  style, design, market: b.regions[0].code, subject: 'Fresh this week', hero_headline: 'Fresh from the oven', hero_subline: 'Back on the shelf this morning.',
  body_blocks: [{ heading: '', body: 'We bake it slowly overnight.' }, { heading: 'What you get', body: 'A dense loaf\n\nSeeds in every slice' }],
  cta_text: 'Order now', cta_url: `${b.website}/p/1`, hero_product: 'Seeded Rye', hero_image_url: img(b, 1), products: prods(b),
  product_list: prods(b).slice(0, 3).map((p) => ({ title: p.title, price: p.price, url: p.url })), collection_url: `${b.website}/collections/all`,
});
const pinned = (theme, template) => ({ theme: AT.THEMES[theme], template });
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#c9b79c"/></svg>';

async function open(page, html) {
  await page.route(/^https?:\/\//, (r) => r.fulfill({ contentType: 'image/svg+xml', body: PHOTO }));
  await page.setContent(html, { waitUntil: 'load' });
}

test('brands of different kinds get different theme families, each with its reasons', () => {
  const fams = BRANDS.map((b) => AT.affinity(b));
  const leads = new Set(fams.map((f) => f.family[0]));
  expect(leads.size, `lead themes ${fams.map((f) => f.family[0])}`).toBeGreaterThanOrEqual(4);
  expect(new Set(fams.map((f) => f.family.join(','))).size, 'no two brands share a family').toBe(BRANDS.length);
  // The reasons come from the brand's own record.
  expect(AT.affinity(BRANDS[1]).ranked.find((r) => r.id === AT.affinity(BRANDS[1]).family[0]).reasons.join(' ')).toMatch(/publishing|serif|news/);
  expect(AT.affinity(BRANDS[3]).family.slice(0, 2)).toContain('bold');
  expect(AT.affinity(BRANDS[2]).family.slice(0, 2)).toContain('luxe');
});

test('ten sends of one brand, built by Smart Brain: at least four templates and three themes, recorded on the campaign', async () => {
  test.setTimeout(120000);
  const b = Object.assign({ claims: ['Baked fresh every morning'], legal_entity: 'Oak Bakers Ltd, 1 Mill Lane, London' }, BRANDS[0]);
  const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
  delete require.cache[PLAN];
  const plan = require(PLAN);
  const seenT = new Set(), seenM = new Set();
  const first = [];
  for (let d = 1; d <= 10; d++) {
    const ps = prods(b);
    const entry = { id: `oak-${d}`, date: `2026-11-${String(d).padStart(2, '0')}`, market: 'UK', objective: 'reactivation', brand: b, cohort: { name: 'At Risk', size: 400, rules: ['r'] }, channels: ['email'], confidence: 0.6, offer: { depth: 'none', pct: 0 }, heroProduct: Object.assign({ sku: 'r1', handle: 'r1' }, ps[0]), supportingProducts: ps.slice(1).map((p, i) => Object.assign({ sku: `s${i}`, handle: `s${i}` }, p)) };
    const c = await plan.buildCampaign(JSON.parse(JSON.stringify(entry)), smartConfig({}), { noLLM: true, withCreatives: false });
    const vs = c.assets.email.variants;
    expect(Array.isArray(c.design && c.design.mail), 'the campaign records which design drew each mail').toBe(true);
    for (const v of vs) {
      const th = (v.html.match(/data-theme="([a-z]+)"/) || [])[1];
      const tp = (v.html.match(/data-template="([a-z]+)"/) || [])[1];
      expect(th && tp, `${v.key} carries its theme and template`).toBeTruthy();
      expect(v.design.theme).toBe(th);
      expect(v.design.why).toMatch(/Oak Bakers/);
      if (v.type === 'Text + Visual') { seenT.add(th); seenM.add(tp); }
    }
    first.push(vs.map((v) => v.design.template).join('|'));
    // The two visual variants of one send are not the same document.
    const a = vs.find((v) => v.key === 'visual_a'), z = vs.find((v) => v.key === 'visual_b');
    expect(`${a.design.theme}.${a.design.template}`, `send ${d}: visual A and B`).not.toBe(`${z.design.theme}.${z.design.template}`);
  }
  expect(seenM.size, `templates over ten sends: ${[...seenM]}`).toBeGreaterThanOrEqual(4);
  expect(seenT.size, `themes over ten sends: ${[...seenT]}`).toBeGreaterThanOrEqual(3);
  expect(new Set(first).size, 'neighbouring sends differ').toBeGreaterThanOrEqual(6);
});

test('every template is its own structure, read off the rendered sections', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 1000 });
  const prints = {};
  const shape = () => {
    const box = document.querySelector('[data-template]');
    const rows = [...box.children[0].children].filter((x) => x.tagName === 'TR');
    return rows.map((r) => {
      if (r.querySelector('[data-mail-footer]') || r.matches('[data-mail-footer]') || r.querySelector('td[data-mail-footer]')) return 'F';
      if (r.querySelector('[data-mail-logo]')) return 'L';
      const h = !!r.querySelector('h1'), i = !!r.querySelector('img[data-mail-hero]'), b = !!r.querySelector('[data-ds="button-primary"]');
      if (h && i) return 'HI';
      if (r.querySelector('[data-mail-card]')) return 'G';
      if (r.querySelector('[data-mail-item]')) return 'R';
      if (h) return 'H';
      if (i) return 'I';
      if (b) return 'B';
      if (r.querySelector('[data-mail-body]')) return 'T';
      return r.innerText.trim() ? 'x' : '';
    }).filter(Boolean).join('-');
  };
  for (const tp of AT.TEMPLATES.mail) {
    await open(page, CT.renderTextVariant(opts(BRANDS[0], 'visual', pinned('editorial', tp))));
    expect(await page.getAttribute('[data-template]', 'data-template')).toBe(tp);
    prints[tp] = await page.evaluate(shape);
  }
  expect(new Set(Object.values(prints)).size, JSON.stringify(prints, null, 1)).toBe(AT.TEMPLATES.mail.length);
  const textPrints = new Set();
  for (const tp of AT.TEMPLATES.text) {
    await open(page, CT.renderTextVariant(opts(BRANDS[0], 'editorial', pinned('editorial', tp))));
    textPrints.add(await page.evaluate(() => `${document.querySelectorAll('td[data-mail-stack]').length}|${[...document.querySelectorAll('td')].filter((t) => /^\d+\.$/.test(t.innerText.trim())).length}`));
  }
  expect(textPrints.size, 'letter, memo and numbered are three structures').toBe(3);
});

test('every theme looks different: type, corners, button, frame and ground read off computed styles', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 1000 });
  const sigs = {};
  for (const th of AT.THEME_IDS) {
    await open(page, CT.renderTextVariant(opts(BRANDS[0], 'visual', pinned(th, 'stack'))));
    sigs[th] = await page.evaluate(() => {
      const h = getComputedStyle(document.querySelector('h1'));
      const b = getComputedStyle(document.querySelector('[data-ds="button-primary"]'));
      const box = getComputedStyle(document.querySelector('[data-template]'));
      return [h.textTransform, h.fontWeight, h.letterSpacing, h.textAlign, b.borderTopLeftRadius, b.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'outline' : 'fill', box.borderTopStyle, getComputedStyle(document.body).backgroundColor].join(' ');
    });
  }
  expect(new Set(Object.values(sigs)).size, JSON.stringify(sigs, null, 1)).toBe(AT.THEME_IDS.length);
});

test('the same send rebuilt is the same bytes; a regenerate take is a new design', () => {
  for (const b of BRANDS) {
    const e = { id: `${b.id}-1`, date: '2026-11-05', market: b.regions[0].code, brand: b };
    const d1 = AT.pick(e, 'mail', 'mail:visual:visual_a');
    expect(AT.pick(e, 'mail', 'mail:visual:visual_a')).toEqual(d1);
    expect(CT.renderTextVariant(opts(b, 'visual', d1))).toBe(CT.renderTextVariant(opts(b, 'visual', d1)));
    const takes = new Set([0, 1, 2, 3, 4, 5].map((t) => { const d = AT.pick(Object.assign({ __take: t }, e), 'mail', 'mail:visual:visual_a'); return `${d.theme.id}.${d.template}`; }));
    expect(takes.size, `${b.name}: six presses of regenerate`).toBeGreaterThanOrEqual(3);
  }
});

test('every theme x template keeps AA text and never draws a dark-neutral ground, for a pale brand and a near-black one', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 700, height: 1000 });
  const measure = () => {
    const rgb = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const a = m[1].split(',').map(Number); return { r: a[0], g: a[1], b: a[2], a: a[3] == null ? 1 : a[3] }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const bad = [], dark = [];
    let texts = 0, grounds = 0;
    for (const el of document.querySelectorAll('body, body *')) {
      const cs = getComputedStyle(el);
      const bg = rgb(cs.backgroundColor);
      if (bg && bg.a > 0.5 && el.getBoundingClientRect().height > 20) {
        grounds++;
        const mx = Math.max(bg.r, bg.g, bg.b), mn = Math.min(bg.r, bg.g, bg.b);
        if (lum(bg) < 0.03 && mx - mn < 24) dark.push(`${el.tagName} ${cs.backgroundColor}`);
      }
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own || el.getBoundingClientRect().width === 0) continue;
      texts++;
      const r = ratio(rgb(cs.color), bgOf(el));
      const size = parseFloat(cs.fontSize), big = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
      if (r < (big ? 3 : 4.5)) bad.push(`"${el.textContent.trim().slice(0, 30)}" ${r.toFixed(2)}`);
    }
    return { bad, dark, texts, grounds };
  };
  let n = 0;
  for (const b of [BRANDS[0], DARK]) {
    for (const th of AT.THEME_IDS) {
      const all = AT.TEMPLATES.mail.map((tp) => ['visual', tp]).concat(AT.TEMPLATES.text.map((tp) => ['founder', tp]));
      for (const [style, tp] of all) {
        await open(page, CT.renderTextVariant(opts(b, style, pinned(th, tp))));
        const m = await page.evaluate(measure);
        expect(m.texts, 'measured real text').toBeGreaterThan(8);
        expect(m.grounds).toBeGreaterThan(1);
        expect(m.bad, `${b.name} ${th}/${style}/${tp}: text under AA`).toEqual([]);
        expect(m.dark, `${b.name} ${th}/${style}/${tp}: dark-neutral ground`).toEqual([]);
        n++;
      }
    }
  }
  expect(n).toBe(2 * AT.THEME_IDS.length * (AT.TEMPLATES.mail.length + AT.TEMPLATES.text.length));
});

test('a template that needs a picture is not drawn without one; a mail with none leads on the brand\'s ground', async ({ page }) => {
  for (const tp of ['split', 'spotlight', 'magazine']) {
    const html = CT.renderTextVariant(Object.assign(opts(BRANDS[0], 'visual', pinned('soft', tp)), { hero_image_url: undefined, products: [] }));
    expect(html).not.toMatch(new RegExp(`data-template="${tp}"`));
    expect(html, `${tp} falls back to a template led by the brand's ground`).toContain('Brand-palette hero block');
  }
  await page.setViewportSize({ width: 375, height: 800 });
  for (const th of AT.THEME_IDS) {
    for (const tp of AT.TEMPLATES.mail) {
      await open(page, CT.renderTextVariant(opts(BRANDS[0], 'visual', pinned(th, tp))));
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(over, `${th}/${tp} on a phone: no sideways scroll`).toBeLessThanOrEqual(0);
    }
  }
});
