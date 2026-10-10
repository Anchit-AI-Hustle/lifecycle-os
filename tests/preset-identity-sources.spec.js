/**
 * A starter brand's identity is read from its OWN mark and its OWN published
 * material, or the card says why not (2026-10-05).
 * ---------------------------------------------------------------------------
 * The operator, with screenshots of production /onboarding: "still wrong brand
 * details - check all & fix all". 23 of 40 cards wore the grey placeholder
 * (home pages that refused an automated reader, or timed out), and several
 * that HAD been read were wrong: a pale tab taken for a brand colour, a
 * brand's own blue thrown away because the reader saw it on a cookie banner,
 * a grey header promoted to primary, a declared theme-color beating the mark.
 *
 * What changed, each part EXECUTED here:
 *   1. the reader (api/_shared/brand-render.js + render-capture.js) takes the
 *      LOGO as its strongest identity signal - an inline SVG's paint by area,
 *      a raster or CSS-sprite logo's pixels - plus the mask-icon colour, the
 *      browserconfig.xml TileColor, the manifest's background_color, the site
 *      icons' pixels and a guidelines page's LABELLED swatches. A neutral mark
 *      is recorded and never promoted; a multicolour mark proposes nothing;
 *      a colour shown only on a consent banner is never measured;
 *   2. the mapping (scripts/lib/preset-observation.js) ranks every candidate
 *      from every read by strength and agreement, never takes a grey header,
 *      and gives a preset an accent only when the brand renders a second
 *      colour;
 *   3. the harvest (scripts/harvest-presets.js) reads a brand's OTHER own
 *      material when its home page refuses - only URLs on the brand's own
 *      registrable domain or linked from a page read there
 *      (scripts/lib/brand-ownership.js) - tries a timed-out read once more,
 *      and the builder applies a palette only when every value names a read
 *      that produced it;
 *   4. the shipped data: every machine-read value names its page, signal and
 *      date, on a domain the brand owns.
 *
 * Fixture sites on 127.0.0.1 (and 127.0.0.2, a different registrable
 * domain) through the real reader in real Chromium. Nothing here reads a
 * source file to assert on it.
 *
 * Run: npx playwright test tests/preset-identity-sources.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const br = require(path.join(ROOT, 'api', '_shared', 'brand-render.js'));
const signals = require(path.join(ROOT, 'api', '_shared', 'identity-signals.js'));
const obsLib = require(path.join(ROOT, 'scripts', 'lib', 'preset-observation.js'));
const own = require(path.join(ROOT, 'scripts', 'lib', 'brand-ownership.js'));
const { harvest } = require(path.join(ROOT, 'scripts', 'harvest-presets.js'));
const { startSites, EXPECT, png } = require('./lib/identity-fixture-sites.js');

const DAY = '2026-10-05';

(function pointReaderAtABrowser() {
  if (process.env.BRAND_RENDER_CHROMIUM) return;
  try {
    const p = require('@playwright/test').chromium.executablePath();
    if (p && fs.existsSync(p)) { process.env.BRAND_RENDER_CHROMIUM = p; return; }
  } catch (_) { /* fall through */ }
  const pre = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  if (fs.existsSync(pre)) process.env.BRAND_RENDER_CHROMIUM = pre;
})();

function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), `preset-identity-${tag}-`)); }

/* ═══ 1. the reader: the mark and the declarations ════════════════════════ */

test.describe.serial('the rendered reader takes identity from the mark and the site\'s own declarations', () => {
  let sites;
  let browser;
  const reads = {};

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    sites = await startSites(['logo-svg', 'logo-raster', 'logo-css', 'multicolour', 'neutral-logo', 'consent', 'tint', 'declared', 'guidelines', 'heading-navy', 'social-tokens', 'product-cta']);
    const { chromium } = require('playwright-core');
    browser = await chromium.launch({ executablePath: process.env.BRAND_RENDER_CHROMIUM });
    const allow = new Set(Object.values(sites.origins));
    for (const k of Object.keys(sites.origins)) {
      reads[k] = await br.readRendered(`${sites.origins[k]}/`, { browser, policy: { allowOrigins: allow }, maxPages: k === 'product-cta' ? 1 : 0, mobile: false, screenshots: false, deadlineMs: 40000 });
    }
  });
  test.afterAll(async () => { if (browser) await browser.close(); if (sites) await sites.close(); });

  const kinds = (m) => m.identity.candidates.map((c) => `${c.kind}:${c.value}`);

  test('the logo\'s own paint outranks a theme-color that disagrees with it, and both stay on the record', () => {
    const m = reads['logo-svg'];
    expect(m.colors.primary.value).toBe(EXPECT['logo-svg'].primary);
    expect(m.colors.primary.kind).toBe('logo-svg');
    expect(m.colors.primary.source.role).toBe('logo');
    // The declared theme-color is a candidate, not the answer; the small
    // yellow dot in the mark is not the mark's colour.
    expect(kinds(m)).toContain(`theme-color:${EXPECT['logo-svg'].theme}`);
    expect(m.identity.logo_colours.paints[0]).toEqual(expect.objectContaining({ hex: EXPECT['logo-svg'].primary }));
    expect(m.identity.candidates.some((c) => c.value === EXPECT['logo-svg'].minor)).toBe(false);
    // The call to action is the ACTION colour, reported beside it.
    expect(m.colors.accent.value).toBe(EXPECT['logo-svg'].action);
  });

  test('a raster logo and a CSS-sprite logo are read from their PIXELS', () => {
    expect(reads['logo-raster'].colors.primary).toEqual(expect.objectContaining({ value: EXPECT['logo-raster'].primary, kind: 'logo-image' }));
    const sprite = reads['logo-css'];
    expect(sprite.colors.primary).toEqual(expect.objectContaining({ value: EXPECT['logo-css'].primary, kind: 'logo-image' }));
    expect(sprite.identity.logo_colours.kind).toBe('css');
    // The sprite's white wordmark is recorded, as a neutral.
    expect(sprite.identity.logo_colours.pixels.find((p) => p.hex === '#ffffff')).toEqual(expect.objectContaining({ chromatic: false }));
  });

  test('a multicolour mark proposes nothing; a neutral mark is recorded, never promoted', () => {
    const multi = reads.multicolour;
    expect(multi.identity.candidates.filter((c) => /^logo/.test(c.kind))).toEqual([]);
    expect(multi.notes.join(' ')).toMatch(/several colours .* none dominates/);
    expect(multi.colors.primary.value).toBe(EXPECT.multicolour.action);
    expect(multi.colors.primary.from_role).toBe('action');
    const neutral = reads['neutral-logo'];
    expect(neutral.identity.logo_colours.paints[0].hex).toBe(EXPECT['neutral-logo'].logo);
    expect(neutral.identity.candidates.filter((c) => !c.neutral)).toEqual([]);
    expect(neutral.colors.primary).toBeUndefined();
    expect(neutral.notes.join(' ')).toMatch(/#000000, a neutral: recorded, never proposed/);
  });

  test('a colour on a consent banner is never measured; the same brand colour on the mark is taken from the mark', () => {
    const m = reads.consent;
    expect(m.colors.primary).toEqual(expect.objectContaining({ value: EXPECT.consent.primary, kind: 'logo-svg' }));
    const all = JSON.stringify({ c: m.identity.candidates, colors: m.colors, buttons: m.read.desktop.roles.button_candidates });
    expect(all).not.toContain(EXPECT.consent.banner);
  });

  test('a pale tab is not a call to action, and the mark gives the brand colour', () => {
    const m = reads.tint;
    expect(m.colors.primary.value).toBe(EXPECT.tint.primary);
    expect(JSON.stringify(m.colors)).not.toContain(EXPECT.tint.tab);
  });

  test('the mask-icon colour, the browserconfig TileColor and the manifest background are read as the site declares them', () => {
    const m = reads.declared;
    expect(m.colors.primary).toEqual(expect.objectContaining({ value: EXPECT.declared.mask, kind: 'mask-icon' }));
    expect(kinds(m)).toEqual(expect.arrayContaining([`tile-color:${EXPECT.declared.tile}`, `manifest-background:${EXPECT.declared.manifestBg}`]));
    const tile = m.identity.candidates.find((c) => c.kind === 'tile-color');
    expect(tile.source.page).toMatch(/\/browserconfig\.xml$/);
    // A near-white splash background is recorded and is not a colour.
    expect(m.identity.candidates.find((c) => c.kind === 'manifest-background').neutral).toBe(true);
  });

  test('a guidelines page\'s swatch counts only when it is painted AND labelled with its own value', () => {
    const m = reads.guidelines;
    expect(m.identity.swatches.map((s) => s.hex)).toEqual([EXPECT.guidelines.first, EXPECT.guidelines.second]);
    expect(m.identity.swatches[0].label).toMatch(/Brand Red/);
    expect(m.colors.primary).toEqual(expect.objectContaining({ value: EXPECT.guidelines.first, kind: 'guideline-swatch' }));
    // Written but painted something else: not a swatch.
    expect(JSON.stringify(m.identity)).not.toContain('#123456');
  });

  test('a chromatic heading is a weak identity signal, and never outranks a coloured call to action', () => {
    const m = reads['heading-navy'];
    expect(m.identity.candidates.map((c) => `${c.kind}:${c.value}`)).toEqual([`heading-text:${EXPECT['heading-navy'].primary}`]);
    expect(m.colors.primary).toEqual(expect.objectContaining({ value: EXPECT['heading-navy'].primary, kind: 'heading-text' }));
    // The grey header is not a colour at all.
    expect(JSON.stringify(m.identity.candidates)).not.toContain(EXPECT['heading-navy'].header);
    expect(m.page_seen).toEqual(expect.objectContaining({ title: 'Clear Frames', h1: 'Eyewear for every face', status: 200 }));
    // A heading colour beside a chromatic CTA: the CTA, never the heading.
    const withCta = obsLib.paletteFromManifest(Object.assign({}, m, { read: { desktop: { roles: Object.assign({}, m.read.desktop.roles, { button_primary: { selector: 'main a.buy', style: { background: '#e4002b' } } }) } } }));
    expect(withCta.palette.primary).toBe('#e4002b');
  });

  test('a token named for another network (--brand-facebook) is never this brand\'s colour', () => {
    const m = reads['social-tokens'];
    expect(m.colors.primary).toEqual(expect.objectContaining({ value: EXPECT['social-tokens'].primary, kind: 'token' }));
    const all = JSON.stringify(m.identity.candidates);
    for (const h of EXPECT['social-tokens'].social) expect(all, h).not.toContain(h);
  });

  test('the call to action on another page the reader opened is an action signal', () => {
    const m = reads['product-cta'];
    expect(m.colors.primary).toBeUndefined();
    expect(m.actions_elsewhere).toEqual([expect.objectContaining({ value: EXPECT['product-cta'].action, role: 'product', label: 'Add to cart' })]);
    const pal = obsLib.paletteFromManifest(m);
    expect(pal.palette.primary).toBe(EXPECT['product-cta'].action);
    expect(pal.evidence.primary.kind).toBe('action');
    expect(pal.evidence.primary.source.page).toMatch(/\/products\/rockerz-450$/);
  });
});

test('an anti-aliased logo is one colour: tints of one hue fold together', () => {
  // One brand's blue logo, read from its pixels: the fill and four edge tints.
  const v = signals.markIdentity([{ hex: '#1642b9', share: 0.4 }, { hex: '#fedd14', share: 0.15 }, { hex: '#5071ca', share: 0.15 }, { hex: '#8098d9', share: 0.1 }, { hex: '#c4cfed', share: 0.05 }]);
  expect(v).toEqual(expect.objectContaining({ verdict: 'colour', hex: '#1642b9' }));
  // Four DIFFERENT hues stay four.
  expect(signals.markIdentity([{ hex: '#f25022', share: 0.25 }, { hex: '#7fba00', share: 0.25 }, { hex: '#00a4ef', share: 0.25 }, { hex: '#ffb900', share: 0.25 }]).verdict).toBe('multicolour');
});

test('typography comes from every page read, slot by slot, each naming its page', () => {
  const f = (family, kind) => ({ family, kind: kind || 'webfont', google: false, stack: `'${family}',sans-serif`, source: { page: 'x', role: 'h1', selector: 'h1' } });
  const t = obsLib.typographyFromReads([
    { url: 'https://brand.example/', manifest: manifest({ fonts: { heading: f('Brand Display') } }) },
    { url: 'https://about.brand.example/', manifest: manifest({ fonts: { heading: f('Other Display'), body: f('Brand Text') } }) },
  ]);
  expect(t.heading).toEqual(expect.objectContaining({ family: 'Brand Display', read_url: 'https://brand.example/' }));
  expect(t.body).toEqual(expect.objectContaining({ family: 'Brand Text', read_url: 'https://about.brand.example/' }));
  // Nobody rendered body copy: the heading face, said so.
  const only = obsLib.typographyFromReads([{ url: 'https://brand.example/', manifest: manifest({ fonts: { heading: f('Brand Display') } }) }]);
  expect(only.body.family).toBe('Brand Display');
  expect(only.body.note).toMatch(/No body copy was rendered/);
  expect(obsLib.typographyFromReads([{ url: 'u', manifest: manifest({ fonts: {} }) }])).toBeNull();
});

test('a dark site\'s own ground is the ink on the light surface, not a darkened primary', () => {
  const out = obsLib.paletteFromManifest(manifest({ colors: {
    primary: { value: '#e50914', from_role: 'identity', signal: 'logo', kind: 'logo-image' },
    surface: { value: '#141414', source: { page: 'https://brand.example/', role: 'page ground', selector: 'body' } }, ink: { value: '#ffffff' },
  } }));
  expect(out.palette.surface).toBe('#ffffff');
  expect(out.palette.ink).toBe('#141414');
  expect(out.evidence.ink).toEqual(expect.objectContaining({ derived: true, exact: '#141414', from_role: 'page ground' }));
});

test('an accent must stand off the page (3:1), and a declared value is the exact one a logo\'s pixels agree with', () => {
  const out = obsLib.paletteFromManifest(manifest({ identity: { candidates: [
    cand('token', '#533afd', ':root'), cand('token', '#adadff', ':root'), cand('token', '#0a8f3c', ':root'),
  ] } }));
  expect(out.palette.primary).toBe('#533afd');
  // The pale lavender (1.9:1) is a tint, not a second colour.
  expect(out.palette.accent).toBe('#0a8f3c');
  const px = obsLib.paletteFromManifest(manifest({ identity: { candidates: [cand('logo-image', '#d02030', 'header a img'), cand('token', '#cf0a2c', ':root')] } }));
  expect(px.palette.primary).toBe('#cf0a2c');
  expect(px.evidence.primary).toEqual(expect.objectContaining({ kind: 'logo-image', drawn: '#d02030', exact_from: expect.objectContaining({ kind: 'token' }) }));
});

test('a mark\'s colours: one dominant colour, neutral, or multicolour, by area', () => {
  expect(signals.markIdentity([{ hex: '#2874f0', share: 0.97 }, { hex: '#ffe11b', share: 0.03 }])).toEqual(expect.objectContaining({ verdict: 'colour', hex: '#2874f0' }));
  expect(signals.markIdentity([{ hex: '#000000', share: 0.98 }, { hex: '#ff0000', share: 0.02 }]).verdict).toBe('neutral');
  expect(signals.markIdentity([{ hex: '#f25022', share: 0.25 }, { hex: '#7fba00', share: 0.25 }, { hex: '#00a4ef', share: 0.25 }, { hex: '#ffb900', share: 0.25 }]).verdict).toBe('multicolour');
  // White wordmark beside an orange smile: the smile is the colour.
  expect(signals.markIdentity([{ hex: '#ffffff', share: 0.6 }, { hex: '#ff9900', share: 0.4 }])).toEqual(expect.objectContaining({ verdict: 'colour', hex: '#ff9900' }));
  // A navy mark is a colour (the lightness rule filed it as black).
  expect(signals.chromatic('#000042')).toBe(true);
  expect(signals.chromatic('#4d4d4d')).toBe(false);
  expect(signals.chromatic('#ecf0f4')).toBe(false);
  // Pixels: the exact fill, not its anti-aliased edge; the ground left out.
  const shot = png(40, 20, [[0, 0, 40, 20, '#ffffff'], [5, 5, 35, 15, '#1428a0'], [4, 4, 36, 5, '#8a94d0']]);
  const px = signals.pixelColours(shot, '#ffffff');
  expect(px[0].hex).toBe('#1428a0');
  expect(px.some((p) => p.hex === '#ffffff')).toBe(false);
});

/* ═══ 2. the mapping ══════════════════════════════════════════════════════ */

function manifest(over) {
  const src = (role, selector) => ({ page: 'https://brand.example/', role, selector, viewport: 'desktop', property: 'background-color', signal: 'computed' });
  return Object.assign({
    version: 'design-manifest/1', url: 'https://brand.example/', start: 'https://brand.example', read_at: `${DAY}T10:00:00.000Z`,
    colors: { surface: { value: '#ffffff', source: src('page ground', 'body') }, ink: { value: '#1a1a1a', source: src('body copy', 'main p') } },
    identity: { candidates: [] },
    read: { desktop: { roles: {} } },
  }, over || {});
}
const cand = (kind, value, selector) => ({ kind, value, signal: `${kind} signal`, neutral: !signals.chromatic(value), source: { page: 'https://brand.example/', role: kind, selector: selector || kind, viewport: 'desktop', property: 'x', signal: 'computed' } });

test('a grey header is never a primary; a navy mark is', () => {
  const grey = obsLib.paletteFromManifest(manifest({ read: { desktop: { roles: { header: { selector: 'div#header > nav', style: { background: '#4d4d4d' } } } } } }));
  expect(grey.ok).toBe(false);
  const navy = obsLib.paletteFromManifest(manifest({
    identity: { candidates: [cand('logo-image', '#000042', 'header a img')] },
    read: { desktop: { roles: { header: { selector: 'div#header > nav', style: { background: '#4d4d4d' } } } } },
  }));
  expect(navy.ok).toBe(true);
  expect(navy.palette.primary).toBe('#000042');
  expect(navy.evidence.primary.kind).toBe('logo-image');
});

test('the strongest signal wins, the ones that agree are recorded, the ones it outranks are kept', () => {
  const out = obsLib.paletteFromManifest(manifest({
    colors: { surface: { value: '#ffffff' }, ink: { value: '#212121' }, primary: { value: '#56adff', from_role: 'identity', signal: 'meta theme-color', kind: 'theme-color' } },
    identity: { candidates: [cand('logo-image', '#2874f0', 'header a img'), cand('theme-color', '#56adff', 'meta[name=theme-color]')] },
    read: { desktop: { roles: { button_primary: { selector: 'main a.buy', style: { background: '#2874f0' } }, link: { selector: 'main a', type: { color: '#2874f0' } } } } },
  }));
  expect(out.palette.primary).toBe('#2874f0');
  expect(out.evidence.primary.kind).toBe('logo-image');
  expect(out.evidence.primary.corroborated_by.map((c) => c.kind)).toContain('action');
  expect(out.evidence.primary.outranked).toEqual([expect.objectContaining({ value: '#56adff', kind: 'theme-color' })]);
  // The theme-color is a colour the site declares, but at 2.3:1 on white it
  // cannot carry a fill or a rule: no accent rather than a tint.
  expect(out.palette.accent).toBeUndefined();
});

test('a brand colour seen on a consent banner is taken from the mark that agrees with it, never from the banner', () => {
  const banner = cand('action', '#1429a0', 'div#onetrust-banner-sdk > button#onetrust-accept-btn-handler');
  const alone = obsLib.paletteFromManifest(manifest({ identity: { candidates: [banner] } }));
  expect(alone.ok).toBe(false);
  expect(alone.reason).toMatch(/consent or cookie banner/);
  const withMark = obsLib.paletteFromManifest(manifest({ identity: { candidates: [banner, cand('logo-svg', '#1428a0', 'header a svg')] } }));
  expect(withMark.palette.primary).toBe('#1428a0');
  expect(withMark.evidence.primary.kind).toBe('logo-svg');
  expect(withMark.evidence.primary.passed_over).toEqual([expect.objectContaining({ value: '#1429a0', why: expect.stringMatching(/consent or cookie banner; the same colour is the brand's by logo-svg signal/) })]);
});

test('a guidelines page keeps the logo colour it shows twice, and a one-off content logo does not beat the site icon', () => {
  const content = (value) => {
    const c = cand('logo-image', value, 'main img');
    c.source.role = 'content logo';
    c.source.page = 'https://developer.brand.example/design';
    return c;
  };
  const guide = obsLib.paletteFromManifest(manifest({
    url: 'https://developer.brand.example/design',
    identity: { candidates: [content('#8860a7'), content('#2fe58f'), content('#1ed760')] },
  }));
  expect(guide.palette.primary).toBe('#1ed760');
  // The purple tile is one logo nothing else agrees with: not the accent.
  expect(guide.palette.accent).toBeUndefined();
  const peach = cand('logo-image', '#f5a885', 'main img.sample');
  peach.source.role = 'content logo';
  peach.source.page = 'https://design.brand.example/';
  const icon = cand('icon', '#0c4da2', 'link[rel=icon]');
  icon.source.page = 'https://www.brand.example/';
  const site = obsLib.paletteFromManifest(manifest({ identity: { candidates: [peach, icon] } }));
  expect(site.palette.primary).toBe('#0c4da2');
  expect(site.evidence.primary.kind).toBe('icon');
  expect(site.palette.accent).toBeUndefined();
  // A careers page's Glassdoor token is the vendor's colour, not a second brand colour.
  const vendor = cand('token', '#008000', ':root');
  vendor.signal = '--glassdoor-brand-color as computed on :root';
  const brand = cand('token', '#cf0a2c', ':root');
  const nb = obsLib.paletteFromManifest(manifest({ identity: { candidates: [vendor, brand] } }));
  expect(nb.palette.primary).toBe('#cf0a2c');
  expect(nb.palette.accent).toBeUndefined();
});

test('an empty capture is not a rendered page, and a page that is only a logo still is', () => {
  const { blankCapture } = require(path.join(ROOT, 'api', '_shared', 'brand-render.js'));
  expect(blankCapture({ title: '', status: 202, roles: {} })).toBe(true);
  expect(blankCapture({ title: 'redirect', status: 202, roles: { body: { chars: 0 } } })).toBe(true);
  expect(blankCapture({ title: 'Brand', status: 200, roles: { logo: { selector: 'header img' }, body: { chars: 0 } } })).toBe(false);
  expect(blankCapture({ title: '', status: 200, roles: {} })).toBe(true);
  expect(blankCapture({ title: 'Newsroom', status: 200, roles: { headings: { h1: { text: 'News' } }, body: { chars: 400 } } })).toBe(false);
});

test('a monochrome brand keeps its black call to action and says its mark is neutral too; no accent', () => {
  const out = obsLib.paletteFromManifest(manifest({
    identity: { candidates: [], logo_colours: { kind: 'svg', paints: [{ hex: '#000000', share: 1 }], pixels: [] } },
    read: { desktop: { roles: { button_primary: { selector: 'main a.buy', style: { background: '#191919' } } } } },
  }));
  expect(out.palette.primary).toBe('#191919');
  expect(out.evidence.primary.from_role).toBe('action');
  expect(out.evidence.primary.signal).toMatch(/monochrome \(its logo mark is #000000, also neutral\)/);
  expect(out.palette.accent).toBeUndefined();
});

test('a value from another page of the brand names that page, the read and the date', () => {
  const home = manifest();
  const guide = manifest({ url: 'https://brand.brand.example/colour', identity: { candidates: [cand('guideline-swatch', '#eb0a1e', 'main div.chip')] } });
  guide.identity.candidates[0].source.page = 'https://brand.brand.example/colour';
  const out = obsLib.paletteFromReads([
    { manifest: home, url: 'https://brand.example', role: 'home', observed_at: DAY, owned: { how: 'website' } },
    { manifest: guide, url: 'https://brand.brand.example/colour', role: 'identity source', observed_at: DAY, owned: { how: 'same-registrable-domain' } },
  ]);
  expect(out.palette.primary).toBe('#eb0a1e');
  expect(out.evidence.primary).toEqual(expect.objectContaining({ read_url: 'https://brand.brand.example/colour', read_role: 'identity source', observed_at: DAY, kind: 'guideline-swatch' }));
  // Surface and ink come from the DESIGN read: the home page.
  expect(out.evidence.surface.read_url).toBe('https://brand.example');
});

test('a favicon generator\'s default colour is not a declaration, and a near-black mark gives way to a brighter declared colour', () => {
  // RealFaviconGenerator's mask-icon #5bbad5 and TileColor #da532c: values
  // nobody at the brand chose (one brand's pinned-tab colour was exactly that).
  const desk = { url: 'https://brand.example/', meta: { tile_color: '#da532c' }, roles: {}, assets: { icons: [{ rel: 'mask-icon', url: 'https://brand.example/m.svg', color: '#5bbad5' }] } };
  const defaults = br.markCandidates(desk, {});
  expect(defaults.filter((c) => c.kind === 'mask-icon' || c.kind === 'tile-color')).toEqual([]);
  expect(defaults.notes.join(' ')).toMatch(/#5bbad5 is a favicon generator's default/);
  // A real declaration is read.
  const real = br.markCandidates(Object.assign({}, desk, { meta: {}, assets: { icons: [{ rel: 'mask-icon', url: 'https://brand.example/m.svg', color: '#e50914' }] } }), {});
  expect(real.map((c) => `${c.kind}:${c.value}`)).toEqual(['mask-icon:#e50914']);
  // A mark painted near-black (#061b31) is kept as a DARK mark...
  const dark = br.markCandidates({ url: 'https://brand.example/', meta: {}, assets: {}, roles: { logo: { kind: 'svg', selector: 'header a svg', paints: [{ hex: '#061b31', share: 1 }], pixels: [] } } }, {});
  expect(dark.map((c) => c.kind)).toEqual(['logo-dark']);
  // ...and a brighter colour the site declares outranks it; a navy mark with
  // nothing brighter declared is still the brand's colour.
  const out = obsLib.paletteFromManifest(manifest({ identity: { candidates: [Object.assign(cand('logo-dark', '#061b31', 'header a svg')), cand('token', '#635bff', ':root')] } }));
  expect(out.palette.primary).toBe('#635bff');
  const navy = obsLib.paletteFromManifest(manifest({ identity: { candidates: [cand('logo-dark', '#000042', 'header a img')] }, read: { desktop: { roles: { button_primary: { selector: 'main a', style: { background: '#11daac' } } } } } }));
  expect(navy.palette.primary).toBe('#000042');
});

test('the mark outranks declarations from a previous palette even when they agree with each other', () => {
  const out = obsLib.paletteFromManifest(manifest({ identity: { candidates: [
    cand('logo-svg', '#ff385c', 'header a svg'), cand('mask-icon', '#ff5a5f', 'link[rel=mask-icon]'),
    cand('theme-color', '#ff5a5f', 'meta[name=theme-color]'), cand('icon', '#ff5a5f', 'link[rel=icon]'),
  ] } }));
  expect(out.palette.primary).toBe('#ff385c');
  expect(out.evidence.primary.kind).toBe('logo-svg');
});

test('a brand with no second colour never borrows tenant zero\'s accent in a renderer', () => {
  const motion = require(path.join(ROOT, 'scripts', 'lib', 'motion-ad.js'));
  const brand = { name: 'Red Brand', palette: { primary: '#e50914', ink: '#141414', surface: '#ffffff' } };
  expect(motion.paletteOf({ brand }).lava).toBe('#e50914');
  const rendered = motion.renderMotionAd({ brand, loop: false, headline: 'Watch now', cta: 'Start', scenes: [{ seconds: 2, headline: 'One', sub: 'Two' }] });
  expect(rendered.toLowerCase()).not.toContain('#6a33d8');
  expect(rendered).toContain('--lava:#e50914');
});

/* ═══ 3. ownership ════════════════════════════════════════════════════════ */

test('only the brand\'s own registrable domain, or a host its own page links to, is read', () => {
  expect(own.registrableDomain('brand.netflix.com')).toBe('netflix.com');
  expect(own.registrableDomain('www2.hm.com')).toBe('hm.com');
  expect(own.registrableDomain('press.example.co.uk')).toBe('example.co.uk');
  expect(own.registrableDomain('example.co.uk')).toBe('example.co.uk');
  expect(own.ownership('https://brand.netflix.com/en/', 'https://www.netflix.com').how).toBe('same-registrable-domain');
  // The same name on the brand's other suffix, and the group's own site.
  expect(own.ownership('https://www.sony.co.jp/en/', 'https://www.sony.com').how).toBe('same-brand-label');
  expect(own.ownership('https://www.tesla.cn/', 'https://www.tesla.com').how).toBe('same-brand-label');
  expect(own.ownership('https://hmgroup.com/brands/', 'https://www2.hm.com').how).toBe('corporate-sibling');
  expect(own.ownership('https://www.adidas-group.com/en/', 'https://www.adidas.com').how).toBe('corporate-sibling');
  expect(own.ownership('https://www.press.bmwgroup.com/global', 'https://www.bmw.com').how).toBe('corporate-sibling');
  // An address is not a brand name: 127.0.0.2 is not "the same brand" as 127.0.0.1.
  expect(own.brandLabel('127.0.0.1')).toBe('');
  expect(own.brandLabel('::1')).toBe('');
  expect(own.ownership('https://127.0.0.2/logo.png', 'https://127.0.0.1/', []).ok).toBe(false);
  // A third party is never the brand's, whatever it says about the brand.
  for (const u of ['https://brandcolors.net/b/netflix', 'https://en.wikipedia.org/wiki/Netflix', 'https://netflix.com.evil.example/', 'https://notnetflix.com/', 'https://brand-colours.example/toyota']) {
    const v = own.ownership(u, 'https://www.netflix.com', []);
    expect(v.ok, u).toBe(false);
    expect(v.reason).toMatch(/not shown to be the brand's own/);
  }
  // Linked: only when a page read ON the brand's domain links to that host.
  const ev = [{ page: 'https://www.amazon.com/', link_hosts: ['www.aboutamazon.com'] }];
  expect(own.ownership('https://www.aboutamazon.com/', 'https://www.amazon.com', ev)).toEqual(expect.objectContaining({ ok: true, how: 'linked-from', linked_from: 'https://www.amazon.com/' }));
  expect(own.ownership('https://www.aboutamazon.com/', 'https://www.amazon.com', [{ page: 'https://elsewhere.example/', link_hosts: ['www.aboutamazon.com'] }]).ok).toBe(false);
});

/* ═══ 4. the harvest: a refused home page, the brand's own other material ═ */

test.describe.serial('a home page that refuses is not forced: the brand\'s own material is read instead', () => {
  let logoHost;
  let sites;
  let observed;
  let built;
  const iconSite = { hits: [] };

  test.beforeAll(async () => {
    logoHost = await startSites(['logo-file'], { host: '127.0.0.2' });
    sites = await startSites(['walled', ['guidelines', { links: [`${logoHost.origins['logo-file']}/logo.png`] }], ['logo-svg', { name: 'slow', slowFirstMs: 3500 }], ['walled-icons', iconSite]]);
  });
  test.afterAll(async () => { if (sites) await sites.close(); if (logoHost) await logoHost.close(); });

  test('the harvest reads the guidelines page and the linked logo file, refuses a third party, and retries a timeout', async () => {
    test.setTimeout(300_000);
    const dir = tmpDir('harvest');
    const index = { presets: [
      { slug: 'toyota', name: 'Toyota', website: `${sites.origins.walled}/`, identity_sources: [
        { url: 'https://brand-colours.example/toyota', kind: 'page', what: 'a third-party colours page' },
        { url: `${logoHost.origins['logo-file']}/logo.png`, kind: 'image', what: 'the brand\'s logo file' },
        { url: `${sites.origins.guidelines}/brand/colour`, kind: 'page', what: 'brand guidelines: colour' },
      ] },
      { slug: 'flipkart', name: 'Flipkart', website: `${sites.origins.slow}/` },
      // Walled, with no listed sources: the site's own icons at their
      // well-known paths are read, robots.txt honoured.
      { slug: 'levis', name: "Levi's", website: `${sites.origins['walled-icons']}/` },
    ] };
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
    observed = path.join(dir, 'observed');
    const run = await harvest({
      index: path.join(dir, 'index.json'), out: observed, allowOrigins: [...Object.values(sites.origins), ...Object.values(logoHost.origins)],
      concurrency: 2, deadlineMs: 60000, sourceDeadlineMs: 45000, firstDocumentMs: 1500, maxPages: 0, regression: false, observedAt: DAY, quiet: true,
    });
    expect(run.summary.environment_failures).toEqual([]);
    const read = (slug) => JSON.parse(fs.readFileSync(path.join(observed, `${slug}.observed.json`), 'utf8'));

    const t = read('toyota');
    expect(t.renderer).toBe('blocked');
    expect(t.palette_ok).toBe(true);
    expect(t.palette.primary).toBe(EXPECT.guidelines.first);
    const p = t.palette_evidence.primary;
    expect(p.read_role).toBe('identity source');
    expect(p.observed_at).toBe(DAY);
    expect(['guideline-swatch', 'logo-image']).toContain(p.kind);
    // The swatch and the logo file agree: both are on the record.
    expect(p.corroborated_by.map((c) => c.kind)).toContain(p.kind === 'guideline-swatch' ? 'logo-image' : 'guideline-swatch');
    // Surface and ink came from the guidelines page, the only page that rendered.
    expect(t.palette_evidence.surface.read_url).toBe(`${sites.origins.guidelines}/brand/colour`);
    const rows = Object.fromEntries(t.reads.map((r) => [r.url, r]));
    expect(rows['https://brand-colours.example/toyota']).toEqual(expect.objectContaining({ renderer: 'refused', ok: false }));
    expect(rows['https://brand-colours.example/toyota'].reason).toMatch(/not shown to be the brand's own/);
    expect(rows[`${sites.origins.guidelines}/brand/colour`].owned.how).toBe('same-registrable-domain');
    expect(rows[`${logoHost.origins['logo-file']}/logo.png`].owned).toEqual(expect.objectContaining({ how: 'linked-from', linked_from: expect.stringContaining(sites.origins.guidelines) }));
    expect(rows[`${logoHost.origins['logo-file']}/logo.png`].renderer).toBe('image');
    expect(t.home_attempt).toEqual(expect.objectContaining({ renderer: 'blocked', host: '127.0.0.1' }));

    // The slow site timed out once and was read on the second attempt.
    const f = read('flipkart');
    expect(f.renderer).toBe('rendered');
    expect(f.reads[0].attempts).toBe(2);
    expect(f.palette.primary).toBe(EXPECT['logo-svg'].primary);

    const l = read('levis');
    expect(l.renderer).toBe('blocked');
    expect(l.palette_ok).toBe(true);
    expect(l.palette.primary).toBe(EXPECT['walled-icons'].icon);
    expect(l.palette_evidence.primary).toEqual(expect.objectContaining({ kind: 'logo-image', read_role: 'identity source', read_url: `${sites.origins['walled-icons']}/favicon.svg` }));
    const lr = Object.fromEntries(l.reads.map((r) => [new URL(r.url).pathname, r]));
    expect(lr['/favicon.svg']).toEqual(expect.objectContaining({ renderer: 'image', ok: true }));
    // robots.txt disallows the touch icon: refused before any request for it.
    expect(lr['/apple-touch-icon.png']).toEqual(expect.objectContaining({ renderer: 'blocked', ok: false }));
    expect(lr['/apple-touch-icon.png'].reason).toMatch(/robots\.txt/);
    expect(iconSite.hits).toEqual([]);
    expect(lr['/favicon.ico']).toEqual(expect.objectContaining({ renderer: 'blocked' }));
    // A home page that rendered is not followed by icon reads.
    expect(f.reads.map((r) => r.role)).toEqual(['home']);
  });

  test('the builder applies that palette, names where it was read, and the gallery shows it', async ({ page }) => {
    test.skip(!observed, 'the harvest above did not run');
    const out = tmpDir('out');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-brand-presets.js'), '--observed', observed, '--out', out], { stdio: 'pipe' });
    built = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
    const row = built.presets.find((x) => x.slug === 'toyota');
    expect(row.palette_source).toBe('verified');
    expect(row.read_from.sort()).toEqual(['127.0.0.1', '127.0.0.2']);
    expect(row.swatches[0]).toEqual(expect.objectContaining({ role: 'primary', value: EXPECT.guidelines.first }));
    // The brand renders one colour (its swatch and its logo agree; its grey is
    // a neutral): no accent swatch, rather than the primary painted twice.
    expect(row.swatches.map((x) => x.role)).toEqual(['primary', 'surface', 'ink']);
    const rec = JSON.parse(fs.readFileSync(path.join(out, 'toyota.json'), 'utf8'));
    expect(core.validatePalette(rec.palette).ok).toBe(true);
    expect(rec.preset.home_attempt.renderer).toBe('blocked');

    await page.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/api/')) {
        const op = u.searchParams.get('op');
        if (u.searchParams.get('action') === 'brand' && op === 'presets') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Object.assign({ ok: true }, built)) });
        if (u.searchParams.get('action') === 'auth') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'device', reason: 'no_database_url' }) });
        return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
      }
      if (u.hostname !== 'app.example.test') return route.abort();
      const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(f) });
    });
    await page.goto('http://app.example.test/onboarding.html');
    const card = page.locator('[data-preset="toyota"]');
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.locator('.pchip')).toHaveCount(0);
    // Both of the brand's own sources that supplied a value are named: the
    // logo file (127.0.0.2, linked from the guidelines page) and the
    // guidelines page (127.0.0.1) - never the refused home page alone.
    await expect(card.locator('.pmeta')).toContainText(new RegExp(`Read from (127\\.0\\.0\\.2, 127\\.0\\.0\\.1|127\\.0\\.0\\.1, 127\\.0\\.0\\.2) on ${DAY}`));
    const bg = await card.locator('.psw[data-role="primary"] i').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).toBe('rgb(235, 10, 30)');
    expect(await card.locator('.psw').evaluateAll((els) => els.map((e) => e.getAttribute('data-role')))).toEqual(['primary', 'surface', 'ink']);
    // The card says the home page refused and where the values came from.
    await expect(card.locator('.pwhy')).toHaveText(/127\.0\.0\.1 refused an automated read \(blocked\); these values come from the brand's own 127\.0\.0\.[12], 127\.0\.0\.[12]\./);
  });
});

test('the builder refuses a palette whose values name a read that produced nothing, or one that was refused', () => {
  const dir = tmpDir('forged');
  const good = obsLib.observationFromReads(
    { slug: 'toyota', website: 'https://www.toyota.com' },
    { ok: false, renderer: 'blocked', reason: 'HTTP 403' },
    [{ url: 'https://brand.toyota.com/guidelines/visual/brand-colors', kind: 'page', owned: { ok: true, how: 'same-registrable-domain' }, result: { ok: true, manifest: manifest({ url: 'https://brand.toyota.com/guidelines/visual/brand-colors', identity: { candidates: [cand('logo-svg', '#eb0a1e', 'header a svg')] } }) } }],
    DAY,
  );
  expect(good.palette_ok).toBe(true);
  // Rewrite the record so its primary claims to come from the refused home page.
  const forged = JSON.parse(JSON.stringify(good));
  forged.palette_evidence.primary.read_url = 'https://www.toyota.com';
  fs.writeFileSync(path.join(dir, 'toyota.observed.json'), JSON.stringify(forged));
  // And one whose only "rendered" read was never the brand's own.
  const stray = JSON.parse(JSON.stringify(good));
  stray.slug = 'nike';
  stray.reads = stray.reads.map((r) => Object.assign({}, r, { owned: null }));
  fs.writeFileSync(path.join(dir, 'nike.observed.json'), JSON.stringify(stray));
  const out = tmpDir('forged-out');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-brand-presets.js'), '--observed', dir, '--out', out], { stdio: 'pipe' });
  for (const slug of ['toyota', 'nike']) {
    const rec = JSON.parse(fs.readFileSync(path.join(out, `${slug}.json`), 'utf8'));
    expect(rec.preset.palette_source, slug).toBe('default');
    expect(rec.palette.primary).toBe('#2B2B2B');
  }
  // The genuine one is applied.
  const ok = tmpDir('genuine');
  fs.writeFileSync(path.join(ok, 'toyota.observed.json'), JSON.stringify(good));
  const out2 = tmpDir('genuine-out');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-brand-presets.js'), '--observed', ok, '--out', out2], { stdio: 'pipe' });
  expect(JSON.parse(fs.readFileSync(path.join(out2, 'toyota.json'), 'utf8')).palette.primary).toBe('#eb0a1e');
});

test('the before/after table calls a palette hand-verified only when the builder kept one by that rule', () => {
  const { report } = require(path.join(ROOT, 'scripts', 'harvest-presets.js'));
  const dir = tmpDir('report');
  // A template whose read rendered with no colour, and a hand-verified one.
  fs.writeFileSync(path.join(dir, 'zara.observed.json'), JSON.stringify({ format: 'preset-observation/3', ok: true, renderer: 'rendered', palette_ok: false }));
  fs.writeFileSync(path.join(dir, 'apple.observed.json'), JSON.stringify({ format: 'preset-observation/2', ok: true, renderer: 'rendered', palette_ok: true }));
  const sw = (v) => [{ role: 'primary', value: v }, { role: 'surface', value: '#ffffff' }, { role: 'ink', value: '#111111' }];
  const after = { presets: [
    { slug: 'zara', palette_source: 'verified', renderer: null, hand_verified: false, swatches: sw('#000000') },
    { slug: 'apple', palette_source: 'verified', renderer: null, hand_verified: true, swatches: sw('#0071e3') },
  ] };
  const lines = report({ presets: [] }, after, dir).split('\n');
  expect(lines.find((l) => l.startsWith('| zara '))).not.toMatch(/hand-verified/);
  expect(lines.find((l) => l.startsWith('| apple '))).toMatch(/hand-verified palette kept/);
});

/* ═══ 5. the shipped data: every machine-read value says where it was read ═ */

test('every shipped preset read by machine names, per value, an owned page, a signal and a date', () => {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'index.json'), 'utf8'));
  let checked = 0;
  for (const row of index.presets) {
    if (row.palette_source === 'default' || row.hand_verified) continue;
    const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', `${row.slug}.json`), 'utf8'));
    const obs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'observed', `${row.slug}.observed.json`), 'utf8'));
    expect(['preset-observation/2', 'preset-observation/3'], row.slug).toContain(obs.format);
    const ev = rec.preset.palette_evidence;
    const v3 = obs.format === 'preset-observation/3';
    for (const role of ['primary', 'surface', 'ink']) {
      const e = ev[role];
      const page = e.read_url || (e.source && e.source.page);
      // A v2 home-page read dates the observation; a v3 value dates itself.
      expect(e.observed_at || obs.observed_at, `${row.slug} ${role} has no date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A derived surface or ink from a logo file alone has no page: the note
      // says the page could not be rendered. Every other value names one.
      if (e.derived && !page) {
        expect(e.note, `${row.slug} ${role} is derived with no page and no reason`).toMatch(/DERIVED/);
        continue;
      }
      expect(page, `${row.slug} ${role} names no page`).toMatch(/^https:\/\//);
      if (!v3) {
        // The home page alone: the value's page is that site (a regional
        // storefront is the same registrable domain).
        expect(obs.renderer, row.slug).toBe('rendered');
        expect(own.registrableDomain(own.hostOf(page)), `${row.slug} ${role} ${page}`).toBe(own.registrableDomain(own.hostOf(rec.website)));
        continue;
      }
      const read = (obs.reads || []).find((r) => r.url === e.read_url);
      expect(read, `${row.slug} ${role} names a read that is not on the record`).toBeTruthy();
      expect(read.ok).toBe(true);
      // The page is the brand's own: its website, the same registrable
      // domain, the same name on another suffix, the group's site, or a
      // host a page read on its domain links to.
      const how = read.owned && read.owned.how;
      expect(['website', 'same-registrable-domain', 'linked-from', 'same-brand-label', 'corporate-sibling'], `${row.slug} ${role}`).toContain(how);
      if (how === 'website' || how === 'same-registrable-domain') expect(own.registrableDomain(own.hostOf(page)), `${row.slug} ${role} ${page}`).toBe(own.registrableDomain(own.hostOf(rec.website)));
    }
    expect(ev.primary.kind || ev.primary.signal, `${row.slug} primary has no signal`).toBeTruthy();
    // An accent is the brand's second colour, never its primary repeated.
    if (rec.palette.accent) expect(rec.palette.accent.toLowerCase(), row.slug).not.toBe(rec.palette.primary.toLowerCase());
    expect(core.validatePalette(rec.palette).ok, row.slug).toBe(true);
    checked += 1;
  }
  expect(checked, 'checked no machine-read preset').toBeGreaterThan(10);
});
