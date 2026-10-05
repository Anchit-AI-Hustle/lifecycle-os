/**
 * The starter brands carry what their OWN sites render, or they say why not.
 * ---------------------------------------------------------------------------
 * The operator's screenshot of /onboarding's starter-brand gallery: "styles
 * need to be correct for these too". 22 of 40 cards carried the repo's grey
 * placeholder, and several that HAD been read were wrong - a red telecom read
 * as #000000, four type lines reading `system-ui`, a primary equal to its
 * accent. The reader behind them parsed HTML/CSS and could not see what a
 * browser renders.
 *
 * Now every preset is read by the platform's ONE rendered reader
 * (api/_shared/brand-render.js `readSite`), scheduled by
 * scripts/harvest-presets.js and mapped by scripts/lib/preset-observation.js.
 * This spec EXECUTES that path:
 *
 *   1. the harvester over fixture sites on 127.0.0.1 (a storefront with a web
 *      font, a monochrome site, a bot wall), through the real reader in real
 *      Chromium, writing observed files, then the real builder writing presets
 *      into a temporary directory;
 *   2. the honesty rules on the mapping and the builder, each run with an
 *      input built to break it - a blocked read must never carry a palette;
 *   3. the real /onboarding gallery in Chromium, fed the regenerated index:
 *      named swatches painted with the read values, the family each role
 *      renders in (a brand's own web font named and marked as shown in
 *      fallback), the reason a default card is still a default, and every
 *      piece of card text measured at WCAG AA.
 *
 * Nothing here reads a source file to assert on it.
 *
 * Run: npx playwright test tests/preset-harvest.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const obsLib = require(path.join(ROOT, 'scripts', 'lib', 'preset-observation.js'));
const { harvest } = require(path.join(ROOT, 'scripts', 'harvest-presets.js'));
const { startSites, EXPECT, HAS_FONT } = require('./lib/preset-fixture-sites.js');

const DAY = '2026-10-04';

/* The reader launches its own Chromium (render-browser.js). On CI that is the
   browser `npx playwright install` put beside @playwright/test; in a sandbox
   with a preinstalled Chromium, that one. */
(function pointReaderAtABrowser() {
  if (process.env.BRAND_RENDER_CHROMIUM) return;
  try {
    const p = require('@playwright/test').chromium.executablePath();
    if (p && fs.existsSync(p)) { process.env.BRAND_RENDER_CHROMIUM = p; return; }
  } catch (_) { /* fall through */ }
  const pre = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  if (fs.existsSync(pre)) process.env.BRAND_RENDER_CHROMIUM = pre;
})();

function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), `preset-harvest-${tag}-`)); }

/** The real builder, into a temporary library, from the given observations. */
function build(observedDir) {
  const out = tmpDir('out');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-brand-presets.js'), '--observed', observedDir, '--out', out], { stdio: 'pipe' });
  const index = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
  const load = (slug) => JSON.parse(fs.readFileSync(path.join(out, `${slug}.json`), 'utf8'));
  return { out, index, load, row: (slug) => index.presets.find((p) => p.slug === slug) };
}

/* A manifest in the reader's own shape (design-manifest/1), for the rules
   that need a specific input rather than a fixture site. */
function manifest(over) {
  const src = (role, selector) => ({ page: 'https://brand.example/', role, selector, viewport: 'desktop', property: 'background-color', signal: 'computed' });
  return Object.assign({
    version: 'design-manifest/1', url: 'https://brand.example/', start: 'https://brand.example', read_at: `${DAY}T10:00:00.000Z`,
    pages: [{ url: 'https://brand.example/', role: 'home' }],
    colors: {
      primary: { value: '#c8102e', source: src('theme-color', 'meta[name=theme-color]'), signal: 'meta theme-color', from_role: 'identity' },
      accent: { value: '#1d4ed8', source: src('primary call to action', 'main > a.cta'), from_role: 'action' },
      surface: { value: '#ffffff', source: src('page ground', 'body') },
      ink: { value: '#1a1a1a', source: src('body copy', 'main > p') },
    },
    fonts: {
      heading: { family: 'Brand Sans', kind: 'webfont', google: false, stack: "'Brand Sans',Arial,sans-serif", weights: ['700'], source: src('h1', 'h1') },
      body: { family: 'Inter', kind: 'webfont', google: true, stack: "'Inter',sans-serif", weights: ['400', '600'], source: src('body copy', 'main > p') },
    },
    assets: { logo: { url: 'https://brand.example/logo.svg', source: src('logo', 'header a img') }, images: [] },
    read: { desktop: { roles: {} } },
  }, over || {});
}

/* ═══ 1. the harvester, end to end, over sites on this machine ═══════════ */

test.describe.serial('the rendered harvest of fixture sites', () => {
  let sites;
  let harvested;
  let built;

  test.beforeAll(async () => {
    sites = await startSites(['brand-a', 'brand-mono', 'walled']);
  });
  test.afterAll(async () => { if (sites) await sites.close(); });

  test('each site is read in Chromium and written as an observation, a bot wall as blocked', async () => {
    test.setTimeout(240_000);
    const dir = tmpDir('fixture');
    // Real preset slugs with fixture addresses: the builder only knows real
    // presets, and which brand a slug names is beside the point here.
    const index = { presets: [
      { slug: 'new-balance', name: 'New Balance', website: `${sites.origins['brand-a']}/` },
      { slug: 'zara', name: 'Zara', website: `${sites.origins['brand-mono']}/` },
      { slug: 'adidas', name: 'Adidas', website: `${sites.origins.walled}/` },
    ] };
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
    const observed = path.join(dir, 'observed');
    const artifacts = path.join(dir, 'artifacts');
    const run = await harvest({
      index: path.join(dir, 'index.json'), out: observed, artifacts,
      allowOrigins: Object.values(sites.origins), concurrency: 3, deadlineMs: 100000, maxPages: 1,
      observedAt: DAY, quiet: true,
    });
    expect(run.summary.environment_failures, JSON.stringify(run.summary.environment_failures)).toEqual([]);
    expect(run.summary.rendered).toBe(2);
    expect(run.summary.blocked).toEqual(['adidas']);

    const read = (slug) => JSON.parse(fs.readFileSync(path.join(observed, `${slug}.observed.json`), 'utf8'));
    const a = read('new-balance');
    expect(a.format).toBe('preset-observation/3');
    expect(a.renderer).toBe('rendered');
    expect(a.observed_at).toBe(DAY);
    expect(a.reader.module).toBe('api/_shared/brand-render.js');
    expect(a.reader.manifest_version).toMatch(/^design-manifest\//);
    // Every role is the value the browser computed on the fixture.
    for (const role of ['primary', 'accent', 'surface', 'ink']) {
      expect(a.palette[role], role).toBe(EXPECT['brand-a'][role]);
      const ev = a.palette_evidence[role];
      expect(ev.derived, `${role} was derived on a site that renders it`).toBe(false);
      expect(ev.source.page, `${role} names no page`).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(ev.source.selector, `${role} names no selector`).toBeTruthy();
      expect(ev.source.viewport).toBe('desktop');
    }
    expect(a.palette_evidence.primary.from_role).toBe('identity');
    expect(a.palette_evidence.accent.from_role).toBe('action');
    // The family each role RENDERS in, and whether the app can load it.
    expect(a.typography.body.family).toBe(EXPECT['brand-a'].body);
    if (HAS_FONT) {
      expect(a.typography.heading.family).toBe(EXPECT['brand-a'].heading);
      expect(a.typography.heading.kind).toBe('webfont');
      expect(a.typography.heading.loadable).toBe(false);
      expect(a.typography.heading.note).toMatch(/brand font, shown in fallback/);
    }
    // The regression of our own renderers against the site ran and scored.
    expect(a.regression, 'no regression score').toBeTruthy();
    expect(typeof a.regression.score).toBe('number');
    expect(a.regression.surfaces).toBeTruthy();
    // And the screenshots and the per-brand report are in the artifacts.
    expect(fs.existsSync(path.join(artifacts, 'new-balance', 'desktop-fold.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(artifacts, 'new-balance', 'report.json'))).toBe(true);

    const mono = read('zara');
    expect(mono.renderer).toBe('rendered');
    expect(mono.palette.primary).toBe(EXPECT['brand-mono'].primary);
    expect(mono.palette_evidence.primary.from_role).toBe('action');
    expect(mono.palette_evidence.primary.signal).toMatch(/monochrome/);
    expect(mono.palette.surface).toBe(EXPECT['brand-mono'].surface);

    const walled = read('adidas');
    expect(walled.renderer).toBe('blocked');
    expect(walled.ok).toBe(false);
    expect(walled.palette, 'a bot wall was given a palette').toBeFalsy();
    expect(walled.typography, 'a bot wall was given a typeface').toBeFalsy();
    expect(walled.read_attempt).toEqual(expect.objectContaining({ renderer: 'blocked', at: DAY, host: '127.0.0.1' }));
    expect(walled.reason).toMatch(/403/);
    harvested = observed;
  });

  test('the builder turns those observations into presets, and leaves the walled one on the default', async () => {
    test.skip(!harvested, 'the harvest above did not run');
    built = build(harvested);
    const nb = built.load('new-balance');
    expect(nb.preset.palette_source).toBe('verified');
    expect(nb.preset.verified_at).toBe(DAY);
    expect(nb.preset.needs_extraction).toBe(false);
    expect(nb.preset.renderer).toBe('rendered');
    expect(nb.palette.primary).toBe(EXPECT['brand-a'].primary);
    expect(nb.preset.source).toContain(EXPECT['brand-a'].primary);
    expect(nb.typography.body.family).toBe('Georgia');
    expect(nb.rights_note).toMatch(/not a licence/i);
    expect(core.validatePalette(nb.palette).ok).toBe(true);
    const row = built.row('new-balance');
    expect(row.swatches.map((s) => s.role)).toEqual(['primary', 'accent', 'surface', 'ink']);
    expect(row.swatches.map((s) => s.value)).toEqual(['primary', 'accent', 'surface', 'ink'].map((r) => EXPECT['brand-a'][r]));
    if (HAS_FONT) expect(row.heading_line).toBe('Harbour Display (brand font, shown in fallback)');
    expect(typeof row.regression.score).toBe('number');

    const ad = built.load('adidas');
    expect(ad.preset.palette_source).toBe('default');
    expect(ad.preset.typography_source).toBe('default');
    expect(ad.preset.verified_at).toBeNull();
    expect(ad.preset.needs_extraction).toBe(true);
    expect(ad.palette.primary).toBe('#2B2B2B');
    expect(built.row('adidas').read_note).toBe(`127.0.0.1 blocked an automated read on ${DAY}.`);
  });

  test('the gallery paints those presets: named swatches, the rendered families, the reason a card is a default', async ({ page }) => {
    test.skip(!built, 'the build above did not run');
    const h = await galleryHarness(page, built.index);
    await page.goto(`${HOST}/onboarding.html`);
    await expect(page.locator('#presetGallery [data-preset]').first()).toBeVisible({ timeout: 15000 });
    const card = page.locator('[data-preset="new-balance"]');
    // Each swatch is the read value, painted, and named by its role.
    const sw = await card.locator('.psw').evaluateAll((els) => els.map((e) => ({
      role: e.getAttribute('data-role'), label: e.querySelector('b').textContent, bg: getComputedStyle(e.querySelector('i')).backgroundColor,
    })));
    expect(sw.map((s) => s.role)).toEqual(['primary', 'accent', 'surface', 'ink']);
    for (const s of sw) {
      expect(s.label).toBe(s.role);
      expect(rgbHex(s.bg), s.role).toBe(EXPECT['brand-a'][s.role]);
    }
    const type = await card.locator('.ptype').textContent();
    expect(type).toContain('Body: Georgia (system font)');
    if (HAS_FONT) {
      expect(type).toContain('Headings: Harbour Display (brand font, shown in fallback)');
      // The name is set in the brand's stack, so the fallback the card shows is
      // the site's own fallback, not this app's.
      expect(await card.locator('.pname').evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/^"?Harbour Display"?/);
    }
    const walled = page.locator('[data-preset="adidas"]');
    await expect(walled.locator('.pchip')).toHaveText(/Default palette, not this brand/);
    await expect(walled.locator('.pwhy')).toHaveText(`127.0.0.1 blocked an automated read on ${DAY}.`);
    await assertCardsReadable(page);
    expect(h.dialogs).toEqual([]);
    expect(h.errors).toEqual([]);
  });
});

/* ═══ 2. the honesty rules, each with an input built to break it ═════════ */

test('a blocked, timed-out or unavailable read carries its reason and no colour, type or logo', () => {
  const preset = { slug: 'adidas', name: 'Adidas', website: 'https://www.adidas.com' };
  for (const [renderer, reason, sentence] of [
    ['blocked', 'www.adidas.com answered HTTP 403 to the browser\'s request.', `www.adidas.com blocked an automated read on ${DAY}.`],
    ['timeout', 'reading the site took longer than 62000ms', `www.adidas.com did not answer an automated read within its time limit on ${DAY}.`],
    ['unavailable', 'The site could not be opened: DNS lookup failed.', `www.adidas.com could not be read on ${DAY}: The site could not be opened: DNS lookup failed.`],
  ]) {
    // A result that ALSO carries a manifest must not leak it through.
    const obs = obsLib.observationFromRead(preset, { ok: false, renderer, reason, manifest: manifest() }, DAY);
    expect(obs.renderer).toBe(renderer);
    expect(obs.ok).toBe(false);
    expect(obs.palette_ok).toBe(false);
    expect(obs.palette, `${renderer} read was given a palette`).toBeFalsy();
    expect(obs.typography).toBeFalsy();
    expect(obs.logo_url).toBeFalsy();
    expect(obs.assets).toBeFalsy();
    expect(obs.read_attempt).toEqual({ renderer, at: DAY, host: 'www.adidas.com', reason });
    expect(obsLib.readSentence(obs.read_attempt)).toBe(sentence);
  }
  // A reader answer that is none of the three is never reported as a block.
  expect(obsLib.observationFromRead(preset, { ok: false, renderer: 'weird', reason: 'x' }, DAY).renderer).toBe('unavailable');
});

test('the builder never applies a palette from a read that did not render, even one that carries a palette', () => {
  const dir = tmpDir('forged');
  const forged = Object.assign(obsLib.failureObservation({ slug: 'adidas', website: 'https://www.adidas.com' }, { ok: false, renderer: 'blocked', reason: 'HTTP 403' }, DAY), {
    // Everything a careless writer might leave behind on a blocked read.
    palette_ok: true,
    palette: { primary: '#ff0000', accent: '#00ff00', ink: '#111111', surface: '#ffffff', surface_alt: '#ffffff', muted: '#555555' },
    typography: { heading: { family: 'Remembered Sans', stack: "'Remembered Sans',sans-serif" }, body: { family: 'Remembered Sans', stack: "'Remembered Sans',sans-serif" } },
    source: 'Remembered, not read.',
  });
  fs.writeFileSync(path.join(dir, 'adidas.observed.json'), JSON.stringify(forged));
  // And a rendered read whose palette failed the gate: still no palette.
  const gated = obsLib.observationFromRead({ slug: 'puma', website: 'https://www.puma.com' }, { ok: true, manifest: manifest({ colors: {} }) }, DAY);
  expect(gated.renderer).toBe('rendered');
  expect(gated.palette_ok).toBe(false);
  fs.writeFileSync(path.join(dir, 'puma.observed.json'), JSON.stringify(Object.assign(gated, { palette: { primary: '#123456', ink: '#111111', surface: '#ffffff' } })));
  const b = build(dir);
  for (const slug of ['adidas', 'puma']) {
    const p = b.load(slug);
    expect(p.preset.palette_source, `${slug} took a palette from a read that did not produce one`).toBe('default');
    expect(p.palette.primary).toBe('#2B2B2B');
    expect(p.typography.heading.family).toBe('system-ui');
    expect(p.preset.verified_at).toBeNull();
    expect(p.preset.read_attempt.renderer).toBe(slug === 'adidas' ? 'blocked' : 'rendered');
  }
  expect(b.row('adidas').read_note).toBe(`www.adidas.com blocked an automated read on ${DAY}.`);
  // The host is the one the reader LANDED on, which is what was read.
  expect(b.row('puma').read_note).toMatch(/^brand\.example was read on 2026-10-04, and the rendered site shows no brand colour/);
});

test('a site that renders nothing coloured gets no primary, and a monochrome one keeps its black', () => {
  const none = obsLib.paletteFromManifest(manifest({ colors: { surface: { value: '#ffffff' }, ink: { value: '#111111' } } }));
  expect(none.ok).toBe(false);
  expect(none.palette).toBeNull();
  const mono = obsLib.paletteFromManifest(manifest({
    colors: { surface: { value: '#ffffff' }, ink: { value: '#111111' } },
    read: { desktop: { roles: { button_primary: { selector: 'main > a.buy', style: { background: '#111111' } } } } },
  }));
  expect(mono.ok).toBe(true);
  expect(mono.palette.primary).toBe('#111111');
  expect(mono.evidence.primary.source.selector).toBe('main > a.buy');
  // No second colour: no accent at all, never the primary repeated
  // (2026-10-05; a card used to paint the primary twice and call one of them
  // the accent).
  expect(mono.palette.accent).toBeUndefined();
  expect(mono.evidence.accent.absent).toBe(true);
  expect(mono.evidence.accent.note).toMatch(/no chromatic colour at all; this preset has no accent/);
  // One brand colour on a site that does render one: no accent either.
  const one = obsLib.paletteFromManifest(manifest({ colors: { primary: { value: '#c8102e', from_role: 'identity', signal: 'meta theme-color' }, surface: { value: '#ffffff' }, ink: { value: '#1a1a1a' } } }));
  expect(one.palette.accent).toBeUndefined();
  expect(one.evidence.accent.note).toMatch(/one brand colour; this preset has no accent rather than the primary repeated/);
  expect(core.validatePalette(one.palette).ok).toBe(true);
});

/* Found by the first real harvest (2026-10-04): the reader's "brand colour"
   was, on three sites, a tint of the page - the palest step of a token scale
   (`--hds-color-core-brand-25`, #f5f5ff), a pale tab and a pale chat pill -
   and on another the accent came off a cookie-consent button. A preset whose
   primary is #f5f5ff on a white page has invisible buttons. */
test('a tint of the page is passed over for the next colour the site renders, and said', () => {
  const src = (selector) => ({ page: 'https://brand.example/', role: 'x', selector, viewport: 'desktop', property: 'background-color', signal: 'computed' });
  const tinted = obsLib.paletteFromManifest(manifest({ colors: {
    primary: { value: '#f5f5ff', from_role: 'identity', signal: '--brand-25 as computed on :root', source: src(':root') },
    accent: { value: '#533afd', from_role: 'action', source: src('main a.button--primary') },
    surface: { value: '#ffffff' }, ink: { value: '#1a1a1a' },
  } }));
  expect(tinted.ok).toBe(true);
  expect(tinted.palette.primary).toBe('#533afd');
  expect(tinted.evidence.primary.from_role).toBe('action');
  expect(tinted.evidence.primary.source.selector).toBe('main a.button--primary');
  expect(tinted.evidence.primary.passed_over).toEqual([expect.objectContaining({ value: '#f5f5ff', why: expect.stringMatching(/tint of the page/) })]);

  // A pale call to action and nothing else: no primary at all, and the reason.
  const pale = obsLib.paletteFromManifest(manifest({ colors: {
    primary: { value: '#ecf0f4', from_role: 'action', source: src('nav button.tab') },
    surface: { value: '#ffffff' }, ink: { value: '#1a1a1a' },
  } }));
  expect(pale.ok).toBe(false);
  expect(pale.reason).toMatch(/#ecf0f4 from the reader's primary: .*tint of the page/);

  // A consent banner's button is the vendor's colour, and a white "accent"
  // on a light page is no second colour at all.
  for (const [accent, selector, why] of [['#008248', 'button#truste-consent-button', /consent or cookie banner/], ['#ffffff', 'div.hero a.action-link', /tint of the page/]]) {
    const out = obsLib.paletteFromManifest(manifest({ colors: {
      primary: { value: '#006341', from_role: 'identity', signal: 'meta theme-color', source: src('meta[name=theme-color]') },
      accent: { value: accent, from_role: 'action', source: src(selector) },
      surface: { value: '#f2f2f2' }, ink: { value: '#1a1a1a' },
    } }));
    expect(out.ok).toBe(true);
    expect(out.palette.primary).toBe('#006341');
    // Not taken, and not replaced by the primary repeated: no accent.
    expect(out.palette.accent, `${accent} on ${selector}`).toBeUndefined();
    expect(out.evidence.accent.absent).toBe(true);
    expect(out.evidence.accent.exact).toBe(accent);
    expect(out.evidence.accent.note).toMatch(why);
  }
});

test('body copy that does not read on the page gives way to text the site renders that does', () => {
  const out = obsLib.paletteFromManifest(manifest({
    colors: { primary: { value: '#2a55e5', from_role: 'identity', signal: 'meta theme-color' }, surface: { value: '#ffffff' }, ink: { value: '#ffffff' } },
    read: { desktop: { roles: { display: { selector: 'main h1', type: { color: '#212121' } } } } },
  }));
  expect(out.ok).toBe(true);
  expect(out.palette.ink).toBe('#212121');
  expect(out.evidence.ink).toEqual(expect.objectContaining({ derived: true, exact: '#ffffff', from_role: 'display heading' }));
  expect(out.evidence.ink.source.selector).toBe('main h1');
});

test('a dark site keeps its exact colours beside the derived ones a preset can activate with', () => {
  const dark = obsLib.paletteFromManifest(manifest({ colors: {
    primary: { value: '#1ed760', from_role: 'identity', signal: 'meta theme-color' },
    surface: { value: '#121212' }, ink: { value: '#ffffff' }, muted: { value: '#b3b3b3' },
  } }));
  expect(dark.ok).toBe(true);
  expect(dark.palette.primary).toBe('#1ed760');
  expect(dark.palette.surface).toBe('#ffffff');
  expect(dark.evidence.surface).toEqual(expect.objectContaining({ derived: true, exact: '#121212' }));
  expect(dark.evidence.surface.note).toMatch(/DERIVED/);
  // The light body copy does not read on the light preset surface. The dark
  // ground the site paints is a colour it renders, so that ground is the ink
  // and the exact value kept is the ground.
  expect(dark.palette.ink).toBe('#121212');
  expect(dark.evidence.ink).toEqual(expect.objectContaining({ derived: true, exact: '#121212', from_role: 'page ground' }));
  expect(core.contrast(dark.palette.ink, dark.palette.surface)).toBeGreaterThanOrEqual(4.5);
  expect(core.isDarkNeutral(dark.palette.surface)).toBe(false);
  expect(core.validatePalette(dark.palette).ok).toBe(true);
});

test('a family is the one the role renders in, and a brand web font is never presented as loadable', () => {
  const t = obsLib.typographyFromManifest(manifest());
  expect(t.heading.family).toBe('Brand Sans');
  expect(t.heading.google).toBe(false);
  expect(t.heading.loadable).toBe(false);
  expect(t.heading.note).toMatch(/^Brand Sans \(brand font, shown in fallback\)/);
  expect(t.heading.stack).toBe("'Brand Sans','Arial',sans-serif");
  expect(t.heading.source.selector).toBe('h1');
  expect(t.body.family).toBe('Inter');
  expect(t.body.google).toBe(true);
  expect(t.body.loadable).toBe(true);
  expect(t.body.weights).toBe('400;600');
  // No heading face rendered: the body face, said, never a lookalike.
  const only = obsLib.typographyFromManifest(manifest({ fonts: { body: { family: 'Inter', kind: 'webfont', google: true, stack: "'Inter',sans-serif" } } }));
  expect(only.heading.family).toBe('Inter');
  expect(only.heading.note).toMatch(/no distinct heading face/);
  expect(obsLib.typographyFromManifest(manifest({ fonts: {} }))).toBeNull();
});

/* ═══ 3. the shipped gallery, over the shipped index ═════════════════════ */

test('the shipped gallery paints every card from its index, and says why each default is one', async ({ page }) => {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'index.json'), 'utf8'));
  const h = await galleryHarness(page, index);
  await page.goto(`${HOST}/onboarding.html`);
  await expect(page.locator('#presetGallery [data-preset]').first()).toBeVisible({ timeout: 15000 });
  const cards = await page.locator('#presetGallery [data-preset]').evaluateAll((els) => els.map((e) => ({
    slug: e.getAttribute('data-preset'),
    swatches: Array.from(e.querySelectorAll('.psw')).map((s) => ({ role: s.getAttribute('data-role'), bg: getComputedStyle(s.querySelector('i')).backgroundColor })),
    chip: (e.querySelector('.pchip') || {}).textContent || '',
    why: (e.querySelector('.pwhy') || {}).textContent || '',
    type: (e.querySelector('.ptype') || {}).textContent || '',
  })));
  expect(cards.length).toBe(index.presets.length);
  expect(cards.length).toBeGreaterThan(30);
  for (const c of cards) {
    const row = index.presets.find((p) => p.slug === c.slug);
    // The roles the preset HAS, in this order: a brand with no second colour
    // shows no accent swatch rather than its primary twice.
    expect(c.swatches.map((s) => s.role)).toEqual(['primary', 'accent', 'surface', 'ink'].filter((r) => row.swatches.some((x) => x.role === r)));
    expect(c.swatches.map((s) => s.role)).toEqual(expect.arrayContaining(['primary', 'surface', 'ink']));
    for (const s of c.swatches) {
      expect(rgbHex(s.bg), `${c.slug} ${s.role}`).toBe(String(row.swatches.find((x) => x.role === s.role).value).toLowerCase());
    }
    if (row.palette_source === 'default') {
      expect(c.chip, c.slug).toMatch(/Default palette, not this brand/);
      expect(c.type, `${c.slug} shows a type line for a default`).toBe('');
      if (row.read_note) expect(c.why).toBe(row.read_note);
    } else {
      expect(c.type, c.slug).toContain(`Headings: ${row.heading_line}`);
      expect(c.type, c.slug).toContain(`Body: ${row.body_line}`);
      expect(c.chip).toBe('');
    }
  }
  await assertCardsReadable(page);
  expect(h.errors).toEqual([]);
});

/* ═══ harness ═════════════════════════════════════════════════════════════ */

const HOST = 'http://app.example.test';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function rgbHex(css) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(css));
  return m ? '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('') : String(css);
}

/** The real page as a real host, signed out, with the gallery fed `index`. */
async function galleryHarness(page, index) {
  const log = { dialogs: [], errors: [] };
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  await page.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
  });
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    if (route.request().resourceType() === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
    return route.abort('failed');
  });
  await page.route(HOST + '/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action');
    const op = u.searchParams.get('op');
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (!action && !u.searchParams.has('health')) return json({});
    if (action === 'auth' && op === 'status') return json({ ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only.' });
    if (action === 'brand' && op === 'presets') return json(Object.assign({ ok: true }, index));
    if (action === 'brand' && op === 'defaults') return json({ ok: true, brand: {} });
    return json({ ok: true });
  });
  return log;
}

/**
 * Every piece of text on every card, measured as the reader sees it: its own
 * colour, composited through every ancestor's opacity onto the first opaque
 * ground behind it, against WCAG AA. And no card ground is a dark neutral.
 */
async function assertCardsReadable(page) {
  // The step fades in. Measure the settled page, not a frame of the fade.
  await page.waitForFunction(() => {
    const card = document.querySelector('#presetGallery [data-preset]');
    let a = 1;
    for (let n = card; n && n.nodeType === 1; n = n.parentElement) a *= parseFloat(getComputedStyle(n).opacity);
    return a >= 0.999;
  }, null, { timeout: 15000 });
  const rows = await page.evaluate(() => {
    const parse = (c) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c || ''); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null; };
    const over = (t, u) => [0, 1, 2].map((i) => t[i] * t[3] + u[i] * (1 - t[3]));
    const lum = (c) => { const ch = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const groundOf = (el) => {
      const layers = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
      }
      let g = [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i--) g = over(layers[i], g);
      return g;
    };
    const out = [];
    for (const card of document.querySelectorAll('#presetGallery [data-preset]')) {
      out.push({ kind: 'card', slug: card.getAttribute('data-preset'), ground: groundOf(card) });
      for (const el of card.querySelectorAll('*')) {
        const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.nodeValue.trim()).map((n) => n.nodeValue.trim()).join(' ');
        if (!own) continue;
        let alpha = 1;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) alpha *= parseFloat(getComputedStyle(n).opacity);
        const fg = parse(getComputedStyle(el).color);
        const ground = groundOf(el);
        const seen = over([fg[0], fg[1], fg[2], fg[3] * alpha], ground);
        out.push({ kind: 'text', slug: card.getAttribute('data-preset'), text: own.slice(0, 40), alpha, fg: getComputedStyle(el).color, ground, ratio: Math.round(ratio(seen, ground) * 100) / 100 });
      }
    }
    return out;
  });
  const texts = rows.filter((r) => r.kind === 'text');
  expect(texts.length, 'measured no card text').toBeGreaterThan(100);
  const failing = texts.filter((r) => r.ratio < 4.5);
  expect(failing, `card text under AA: ${JSON.stringify(failing.slice(0, 6))}`).toEqual([]);
  for (const c of rows.filter((r) => r.kind === 'card')) {
    const hex = '#' + c.ground.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    expect(core.isDarkNeutral(hex), `${c.slug} card ground ${hex} is a dark neutral`).toBe(false);
  }
}
