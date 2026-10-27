// @ts-check
// The parts of Elaya's landing-page-design skill (github.com/elayadesign/ai-design-skills,
// MIT) that the generated landing page takes, executed: a campaign is BUILT through the
// shipped builder and the page is rendered and scrolled in Chromium.
//  - B11: the brand's own tagline in large type, its words muted until they cross a line
//    on scroll, lit in reading order, once; full colour with no script or reduced motion;
//    the muted tone still 3:1 off the ground (AA for large text); said once on the page.
//  - B1: every px font size on the page's own CSS is a Tailwind step (a measured design
//    system's own block is left alone).
//  - B9/B10: a skip link the keyboard reaches first, one <main>, a visible focus ring.
//  - A5: the page's button never says "Learn more".  A7: a campaign page is noindex.
// Not taken (this repo's rules win): invented names, testimonials and numbers (zero
// fabrication), the skill's fonts (the brand's own), dark grounds, the grey hero gradient.
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const craft = require(path.join(ROOT, 'api', '_shared', 'lp-craft.js'));

const TAGLINE = 'Slow food from small farms, delivered to your door every week';
const BRAND = {
  id: 'device:bramble', slug: 'brambleweld', name: 'Brambleweld Larder', website: 'https://brambleweld.example',
  tagline: TAGLINE, palette: { primary: '#2f6b3a', accent: '#e0a030', ink: '#1b1b1b', surface: '#fbf8f2' },
  claims: ['Free delivery over £40'], regions: [{ code: 'UK', home: true, currency: 'GBP' }],
};
const BARE = { id: 'device:bare', slug: 'bareco', name: 'Bareco', regions: [{ code: 'IN', home: true }] };

const slot = (brand) => ({
  id: 'craft-' + brand.slug, date: '2026-11-02', market: brand.regions[0].code, objective: 'reactivation', brand,
  cohort: { name: 'At Risk', size: 1200, rules: ['r'] }, channels: ['email', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 },
});

const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
async function landing(brand) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const plan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
    const c = await plan.buildCampaign(slot(brand), smartConfig({}), { noLLM: true });
    return c.assets.landing_pages[0].html;
  } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

async function open(page, html) {
  await page.route('**/*', (r) => (r.request().url().startsWith('https://lp.test/') ? r.fulfill({ contentType: 'text/html', body: html }) : r.fulfill({ status: 204, body: '' })));
  await page.goto('https://lp.test/');
}
// What the rendered page holds, read from the DOM and the CSSOM.
const facts = (page) => page.evaluate(() => {
  const own = [...document.styleSheets].filter((sh) => !/^(ds|brand-fonts)$/.test((sh.ownerNode && sh.ownerNode.id) || ''));
  const sizes = [];
  const walk = (rules) => { for (const r of rules) { if (r.cssRules) walk(r.cssRules); if (r.style && /px$/.test(r.style.fontSize)) sizes.push(parseFloat(r.style.fontSize)); } };
  for (const sh of own) { try { walk(sh.cssRules); } catch (_) { /* cross origin */ } }
  for (const el of document.querySelectorAll('[style]')) if (/px$/.test(el.style.fontSize)) sizes.push(parseFloat(el.style.fontSize));
  const body = document.body.innerText;
  return {
    reveal: !!document.querySelector('section[data-tagline-reveal]'),
    revealJs: !!document.querySelector('script[data-tagline-reveal-js]'),
    robots: (document.querySelector('meta[name="robots"]') || {}).content || '',
    skip: (document.querySelector('a.skip') || {}).getAttribute ? document.querySelector('a.skip').getAttribute('href') : null,
    mains: document.querySelectorAll('main').length,
    body, sizes,
  };
});

test('the page carries the tagline reveal, said once, with noindex, a skip link, one main and a scale for its type', async ({ page }) => {
  await open(page, await landing(BRAND));
  const f = await facts(page);
  expect(f.reveal).toBe(true);
  expect(f.revealJs).toBe(true);
  expect(f.body.split(TAGLINE).length - 1, 'the tagline is printed once on the page').toBe(1);
  expect(f.robots).toBe('noindex');
  expect(f.skip).toBe('#main');
  expect(f.mains).toBe(1);
  expect(f.sizes.length).toBeGreaterThan(10);
  for (const sz of f.sizes) expect(craft.TYPE_STEPS, `font-size ${sz}px is not a Tailwind step`).toContain(sz);
});

test('a brand with no tagline gets no reveal, and its button never says "Learn more"', async ({ page }) => {
  await open(page, await landing(BARE));
  const f = await facts(page);
  expect(f.reveal).toBe(false);
  expect(f.body).not.toMatch(/Learn more/i);
  expect(f.body).toContain('Visit Bareco');
});

test('the muted tone is a colour 3:1 off the ground, never the ink itself', () => {
  for (const [ink, ground] of [['#1b1b1b', '#fbf8f2'], ['#3a1450', '#fffaf0'], ['#000000', '#ffffff']]) {
    const m = craft.mutedTone(ink, ground);
    expect(m.toLowerCase()).not.toBe(ink.toLowerCase());
    expect(craft.contrast(m, ground)).toBeGreaterThanOrEqual(3);
  }
  for (const [n, s] of [[13, 12], [15, 14], [19, 18], [22, 20], [26, 24], [34, 30], [41, 36], [11, 12]]) expect(craft.snapFont(n)).toBe(s);
});

const wordState = (page) => page.$$eval('[data-tagline-reveal] .tw', (ws) => ws.map((w) => ({ lit: w.classList.contains('lit'), color: getComputedStyle(w).color })));

test('in Chromium the words start muted below the line and light one by one, in reading order, as the page scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const html = await landing(BRAND);
  await open(page, html);
  expect(await page.evaluate(() => document.documentElement.classList.contains('tw-on'))).toBe(true);
  const before = await wordState(page);
  expect(before.length).toBe(TAGLINE.split(' ').length);
  expect(before.every((w) => !w.lit), 'nothing is lit before it is reached').toBe(true);
  const inkRgb = await page.evaluate(() => getComputedStyle(document.body).color);
  expect(before[0].color).not.toBe(inkRgb);
  // Scroll so the statement's first line has crossed the trigger line (60% down the
  // screen) and its last line has not: the first words lit, the last not yet.
  const lines = await page.$eval('[data-tagline-reveal] .tr-text', (p) => { const r = p.getBoundingClientRect(); return { h: r.height, lh: parseFloat(getComputedStyle(p).lineHeight) }; });
  expect(Math.round(lines.h / lines.lh), 'the statement fills at least two lines').toBeGreaterThanOrEqual(2);
  await page.$eval('[data-tagline-reveal] .tr-text', (p) => { const r = p.getBoundingClientRect(); window.scrollBy(0, r.top - window.innerHeight * 0.6 + 20); });
  await expect.poll(async () => (await wordState(page)).filter((w) => w.lit).length, { message: 'words light as they cross the line' }).toBeGreaterThan(0);
  await page.waitForTimeout(200);
  const mid = await wordState(page);
  expect(mid[0].lit, 'the first word has crossed the line').toBe(true);
  expect(mid[mid.length - 1].lit, 'the last word has not: words light one at a time, not the block at once').toBe(false);
  const firstUnlit = mid.findIndex((w) => !w.lit);
  expect(mid.slice(firstUnlit).every((w) => !w.lit), 'words light in reading order').toBe(true);
  await page.$eval('[data-tagline-reveal]', (s) => s.scrollIntoView({ block: 'start' }));
  await expect.poll(async () => (await wordState(page)).every((w) => w.lit), { message: 'every word lit once passed' }).toBe(true);
  await expect.poll(async () => (await wordState(page))[0].color).toBe(inkRgb);
  // Once: scrolling back up does not dim them again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  expect((await wordState(page)).every((w) => w.lit)).toBe(true);
});

test('with reduced motion or no script every word is full from the start', async ({ browser }) => {
  const html = await landing(BRAND);
  const reduced = await browser.newContext({ reducedMotion: 'reduce' });
  const p1 = await reduced.newPage();
  await open(p1, html);
  const ink1 = await p1.evaluate(() => getComputedStyle(document.body).color);
  expect(await p1.evaluate(() => document.documentElement.classList.contains('tw-on'))).toBe(false);
  expect((await wordState(p1)).every((w) => w.color === ink1)).toBe(true);
  await reduced.close();
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const p2 = await noJs.newPage();
  await open(p2, html);
  const ink2 = await p2.evaluate(() => getComputedStyle(document.body).color);
  expect((await wordState(p2)).every((w) => w.color === ink2)).toBe(true);
  await noJs.close();
});

test('reduced motion turned on with the page open shows every word at full colour at once', async ({ page }) => {
  await open(page, await landing(BRAND));
  expect(await page.evaluate(() => document.documentElement.classList.contains('tw-on'))).toBe(true);
  const ink = await page.evaluate(() => getComputedStyle(document.body).color);
  expect((await wordState(page))[0].color, 'muted before').not.toBe(ink);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await wordState(page)).every((w) => w.color === ink), { message: 'every word full once reduced motion is on' }).toBe(true);
});

test('the keyboard reaches the skip link first and it shows; a focused button has a visible ring', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, await landing(BRAND));
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { cls: a.className, top: r.top, href: a.getAttribute('href') }; });
  expect(skip.cls).toBe('skip');
  expect(skip.href).toBe('#main');
  expect(skip.top).toBeGreaterThanOrEqual(0);
  const ring = await page.evaluate(() => { const b = document.querySelector('.hero .btn, .btn'); b.focus(); const cs = getComputedStyle(b); return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }; });
  expect(ring.style).toBe('solid');
  expect(ring.width).toBeGreaterThanOrEqual(2);
});
