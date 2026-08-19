// Reading a brand's own site end to end, and keeping images as URLs.
//
// A preset carrying a palette and a voice could still produce a mailer with an
// empty hero, because nothing captured the PHOTOGRAPHS a brand publishes.
// brand-harvest.js rides the existing crawl and records them.
//
// The rule that matters most here is the boring one: an image is a URL, never a
// payload. A base64 hero adds about a third to its own size, Gmail clips a
// message past roughly 102KB so the layout is cut mid-way, most clients refuse
// to render base64 at all, and an embedded copy can never be swapped or
// resized.
//
// Run: npx playwright test tests/brand-harvest.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const harvest = require(path.join(ROOT, 'api', '_shared', 'brand-harvest.js'));
const contracts = require(path.join(ROOT, 'api', '_shared', 'asset-contracts.js'));
const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'brand-harvest.js'), 'utf8');
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const PAGE = 'https://shop.example.com/products/x';

/* ═══ images are references, never payloads ══════════════════════════════ */

test('an inline base64 image is not harvested as an image URL', () => {
  const out = harvest.imagesOnPage('<img src="data:image/png;base64,AAAA" alt="inline">', PAGE);
  expect(out, 'a payload was recorded as if it were a reference').toEqual([]);
});

test('every harvested image is an absolute URL', () => {
  const out = harvest.imagesOnPage('<img src="/a.jpg" alt="A"><img src="b.jpg" alt="B">', PAGE);
  expect(out).toHaveLength(2);
  for (const i of out) expect(i.url).toMatch(/^https:\/\//);
});

test('the widest srcset candidate wins over a thumbnail', () => {
  // Harvesting the 200px version and using it as a hero is how a mailer ends up
  // with a blurry product shot.
  const out = harvest.imagesOnPage(
    '<img srcset="/s-200.jpg 200w, /s-1600.jpg 1600w" src="/s-200.jpg" alt="P">', PAGE);
  expect(out[0].url).toContain('s-1600.jpg');
  expect(out[0].from).toBe('srcset');
});

test('tracking pixels and spacers are not photographs', () => {
  const out = harvest.imagesOnPage(
    '<img src="/tracking-1x1.gif"><img src="/img/spacer.gif"><img src="/real.jpg" alt="r">', PAGE);
  expect(out.map((i) => i.url)).toEqual(['https://shop.example.com/real.jpg']);
});

test('every image carries where it was found', () => {
  const out = harvest.imagesOnPage('<img src="/a.jpg" alt="A" width="1200">', PAGE);
  expect(out[0].found_on).toBe(PAGE);
  expect(out[0].width).toBe(1200);
  expect(out[0].alt).toBe('A');
});

test('a share card is recorded as a share card, not as the hero', () => {
  const out = harvest.imagesOnPage(
    '<meta property="og:image" content="https://cdn.example.com/card.jpg">', PAGE);
  expect(out[0].from).toBe('opengraph');
  expect(out[0].note).toMatch(/often not the on-page hero/i);
});

test('a role is a guess and the payload says so', () => {
  expect(harvest.roleOf('<img class="site-logo">', '/logo.svg')).toBe('logo');
  expect(harvest.roleOf('<img>', '/hero-banner.jpg')).toBe('hero');
  expect(harvest.roleOf('<img>', '/products/thing.jpg')).toBe('product');
  expect(harvest.roleOf('<img>', '/media/1234.jpg')).toBe('unknown');
  expect(src).toMatch(/`role` is a guess from context/);
});

/* ═══ it rides the existing crawl, and does not add a second one ══════════ */

test('there is one crawler, and this is a rider on it', () => {
  const s = codeOnly(src);
  expect(s).toMatch(/require\('\.\/brand-extract\.js'\)/);
  expect(s).toMatch(/onPage/);
  // No independent fetch loop: scope, robots and SSRF live in site-crawl.
  expect(s).not.toMatch(/new AbortController|await fetch\(/);
});

/* ═══ unreachable is not empty ════════════════════════════════════════════ */

test('a blocked network reports itself rather than returning an empty site', async () => {
  // This is the live behaviour in this container, whose egress proxy refuses
  // brand hosts. An empty result here would be indistinguishable from a brand
  // that publishes nothing.
  const out = await harvest.harvest('https://www.example-brand-that-is-blocked.com', { maxPages: 1 });
  expect(out.ok).toBe(false);
  expect(out.reachable).toBe(false);
  expect(out.images).toEqual([]);
  expect(out.note).toMatch(/says nothing about the site/i);
});

test('the runner writes nothing for a brand it could not read', () => {
  const runner = fs.readFileSync(path.join(ROOT, 'scripts', 'harvest-presets.js'), 'utf8');
  const block = runner.slice(runner.indexOf('if (!out.reachable)'), runner.indexOf('const file ='));
  expect(block).toMatch(/continue;/);
  expect(block).not.toMatch(/writeFileSync/);
  // And a run that read nothing at all is a failure, not a success with zeros.
  expect(runner).toMatch(/if \(!done\.length\) process\.exitCode = 1/);
});

/* ═══ the same rule, enforced on the finished asset ═══════════════════════ */

test('a rendered asset that embeds a raster image is blocked', () => {
  const b64 = 'data:image/png;base64,iVBORw0KGgo=';
  const out = contracts.check({ subject: 's', preheader: 'p', html: `<table><img alt="x" src="${b64}"></table>` });
  expect(out.ok).toBe(false);
  expect(out.violations.some((v) => /base64/.test(v.message))).toBe(true);
});

test('a hosted URL passes, and an inline SVG texture is still allowed', () => {
  expect(contracts.check({ subject: 's', preheader: 'p', html: '<table><img alt="x" src="https://cdn.example.com/a.png"></table>' }).ok).toBe(true);
  // Small uncompressed markup used for grain, not a photograph pretending to be
  // a URL. The ad compositor relies on it.
  expect(contracts.check({ subject: 's', preheader: 'p', html: '<table><img alt="x" src="data:image/svg+xml,%3Csvg/%3E"></table>' }).ok).toBe(true);
});

/* ═══ placeholder catalogue: usable, and unmistakably not the brand's ═════ */

const DIR = path.join(ROOT, 'data', 'brands', 'presets');
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const load = (slug) => JSON.parse(fs.readFileSync(path.join(DIR, `${slug}.json`), 'utf8'));
const templates = () => index.presets.filter((p) => p.palette_source === 'default');

test('every template preset ships a placeholder catalogue so layouts can render', () => {
  for (const row of templates()) {
    const p = load(row.slug);
    expect(p.catalog_placeholder.length, `${row.slug} has no placeholder catalogue`).toBeGreaterThan(0);
    expect(p.catalog_source.kind).toBe('placeholder');
    expect(row.placeholder_products).toBe(p.catalog_placeholder.length);
  }
});

test('a placeholder product states no price, no URL and no image', () => {
  for (const row of templates()) {
    for (const item of load(row.slug).catalog_placeholder) {
      expect(item.placeholder, `${row.slug}: a row is not marked placeholder`).toBe(true);
      // A price is a fact about a brand. Inventing one is the thing this repo
      // refuses everywhere else.
      expect(item.price).toBeNull();
      expect(item.compare_at).toBeNull();
      // No borrowed photography, and no URL that would 404 or, worse, resolve.
      expect(item.image_url).toBe('');
      expect(item.product_url).toBe('');
    }
  }
});

test('a placeholder name could not be mistaken for a real product', () => {
  // Generic by construction. A plausible-looking real model name is the failure
  // here, because an operator would believe it.
  for (const row of templates()) {
    for (const item of load(row.slug).catalog_placeholder) {
      expect(item.title).toMatch(/ \d{2}$/);
      expect(item.title.toLowerCase()).not.toContain(row.name.toLowerCase());
    }
  }
});

test('a placeholder catalogue is never advertised as a live feed', () => {
  for (const row of templates()) {
    expect(row.has_catalog, `${row.slug} claims a live catalogue`).toBe(false);
    expect(row.catalog_kind).toBe('placeholder');
  }
  // Tenant zero's real feed is untouched by any of this.
  const zero = index.presets.find((p) => p.slug === 'knickgasm');
  expect(zero.has_catalog).toBe(true);
  expect(zero.catalog_kind).toBe('shopify_public');
});

test('the gallery says the products are placeholders', () => {
  const html = fs.readFileSync(path.join(ROOT, 'onboarding.html'), 'utf8');
  expect(html).toMatch(/placeholder products so the layouts render/);
});
