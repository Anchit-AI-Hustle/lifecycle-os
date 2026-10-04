// The preset gallery ships two kinds of card, and the difference is the whole
// point of this file.
//
//   palette_source: 'verified'   every colour and font was read from that
//                                brand's own live site on verified_at.
//   palette_source: 'default'    nothing about the brand's design was read.
//                                The card carries this repo's neutral
//                                placeholder so the operator can still start
//                                from a real sector shape.
//
// The failure this guards is narrow and specific: a "default" card that quietly
// carries a colour somebody typed from memory. It would look identical to a
// verified one - same swatch, same layout - and an operator picking it has no
// reason to check. So a default preset's palette must be BYTE-IDENTICAL to the
// shared neutral, and a preset may only claim verified_at if it really was.
//
// Run: npx playwright test tests/brand-presets.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'brands', 'presets');
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));

const load = (slug) => JSON.parse(fs.readFileSync(path.join(DIR, `${slug}.json`), 'utf8'));
const defaults = () => index.presets.filter((p) => p.palette_source === 'default');
const verified = () => index.presets.filter((p) => p.palette_source !== 'default');

/* ═══ the library is there and split ══════════════════════════════════════ */

test('the gallery ships both kinds, and the index says which is which', () => {
  expect(index.presets.length).toBe(index.count);
  expect(verified().length).toBeGreaterThan(0);
  // A template whose own site could not be read stays on the neutral default.
  // When every site answered, there is nothing left to be a default, and that
  // is the point of the observation rather than a missing card.
  for (const p of index.presets) {
    expect(['verified', 'default']).toContain(p.palette_source);
    expect(p.slug, 'a preset with no file').toBeTruthy();
    expect(fs.existsSync(path.join(DIR, `${p.slug}.json`))).toBe(true);
  }
});

/* ═══ a default is a DEFAULT, not a guess wearing the label ═══════════════ */

test('every default-palette preset carries the identical neutral, not a brand colour', () => {
  const rows = defaults();
  if (!rows.length) return;
  const first = load(rows[0].slug).palette;
  for (const row of rows) {
    const p = load(row.slug).palette;
    // Byte-identical across all of them. The moment one differs, somebody has
    // put a specific brand's colour behind a label that says they did not.
    expect(p, `${row.slug} has its own palette while claiming the default`).toEqual(first);
  }
  // And the neutral really is neutral: a grey has equal channels, so no card
  // can be carrying a recognisable hue under this label.
  for (const role of ['primary', 'accent', 'ink', 'surface', 'surface_alt', 'muted', 'line']) {
    const hex = String(first[role] || '').replace('#', '');
    const [r, g, b] = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)];
    expect(r === g && g === b, `default ${role} (${first[role]}) is not a neutral`).toBe(true);
  }
});

test('a default preset never claims a verification it did not do', () => {
  for (const row of defaults()) {
    const p = load(row.slug);
    expect(p.preset.verified_at, `${row.slug} claims a verification date`).toBeNull();
    expect(p.preset.needs_extraction).toBe(true);
    expect(p.preset.source).toMatch(/Not read from the brand's own site/);
    // It tells the operator which button to press, so it has to be the button's
    // real label - extractBlock() renders "Read my site".
    const label = fs.readFileSync(path.join(ROOT, 'onboarding.html'), 'utf8').match(/'(Read my site)'/);
    expect(label, 'the extract button was renamed; the presets still name the old one').toBeTruthy();
    expect(p.preset.source).toContain(label[1]);
    // The card in the gallery has to be able to say so too.
    expect(row.needs_extraction).toBe(true);
    expect(row.typography_source).toBe('default');
  }
});

test('a verified preset states the date and the exact source it was read from', () => {
  for (const row of verified()) {
    const p = load(row.slug);
    expect(p.preset.verified_at, `${row.slug} is marked verified with no date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(p.preset.source).length, `${row.slug} names no source`).toBeGreaterThan(20);
    expect(p.preset.needs_extraction).toBeFalsy();
  }
});

/* ═══ nothing about the brand is invented to fill the gap ═════════════════ */

test('a default preset asserts a name, a URL and a sector, and nothing else', () => {
  for (const row of defaults()) {
    const p = load(row.slug);
    expect(p.website).toMatch(/^https:\/\//);

    // Voice written from memory reads as approved guidance and is not. banned
    // in particular can never be machine-filled, by standing rule.
    expect(p.voice.tone).toBe('');
    expect(p.voice.banned).toEqual([]);
    expect(p.voice.preferred).toEqual([]);
    expect(p.voice.notes).toMatch(/DATA REQUIRED BEFORE LAUNCH/);

    // No claims, no products, no store URLs invented to make the card look full.
    expect(p.offerings).toEqual([]);
    expect(p.regions).toEqual([]);
    expect(p.claims.join(' ')).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
    expect(p.claims.join(' ')).toContain(p.name);
    expect(p.data_gaps.length).toBeGreaterThan(0);
    // A tagline is a brand's own sentence about itself. There is no honest way
    // to supply one without reading it.
    expect(p.tagline).toBe('');
  }
});

/* ═══ the default still has to be a usable design ═════════════════════════ */

test('the neutral default passes the same palette gate as any brand', () => {
  // A placeholder that fails validation would block activation on every one of
  // these cards, which turns an honest default into a dead end. When no
  // default remains, the gate is checked against the shared neutral itself.
  const sample = defaults().length ? load(defaults()[0].slug).palette : {
    primary: '#2B2B2B', accent: '#5A5A5A', ink: '#111111', surface: '#FFFFFF',
    surface_alt: '#F5F5F5', muted: '#6A6A6A', line: '#E4E4E4',
    ok: '#1a7f37', warn: '#c9a227', err: '#c0392b',
  };
  const v = core.validatePalette(sample);
  expect(v.errors, JSON.stringify(v.errors)).toEqual([]);
  expect(v.ok).toBe(true);
});

/* One shipped preset does NOT pass, and it is listed here rather than skipped.
   toi-health-fitness carries that publication's own red (#EB1B24, read from its
   live vertical). White on it measures 4.45:1 and its ink measures less, so
   validatePalette blocks activation - correctly: a button nobody can read is a
   real defect, and 4.45 is not 4.5.

   It is NOT "fixed" by darkening the red, because the red is a verified value
   and editing it would turn a fact into a preference while still claiming
   verified_at. The fix is a DERIVED button colour, the way brand-context-pack
   already emits adjusted text tokens labelled "DERIVED from <input>", and that
   is a change to the palette model rather than to this data file.

   So the list is pinned. Anything NEW that fails shows up as a failure here,
   and this one cannot quietly grow into "the presets do not have to pass". */
const KNOWN_BLOCKED = { 'toi-health-fitness': /4\.4\d:1/ };

test('every preset passes the palette gate, except the one known blocker', () => {
  const failed = [];
  for (const row of index.presets) {
    const v = core.validatePalette(load(row.slug).palette);
    if (v.errors.length) failed.push([row.slug, v.errors.map((e) => e.message).join(' ')]);
  }
  for (const [slug, msg] of failed) {
    expect(KNOWN_BLOCKED[slug], `${slug} fails the palette gate and is not a known blocker: ${msg}`).toBeTruthy();
    expect(msg, `${slug} now fails for a different reason: ${msg}`).toMatch(KNOWN_BLOCKED[slug]);
  }
  // And the blocker has to still be blocked - if it starts passing, the entry
  // above is stale and should be deleted rather than left as folklore.
  for (const slug of Object.keys(KNOWN_BLOCKED)) {
    expect(failed.map((f) => f[0]), `${slug} passes now; remove it from KNOWN_BLOCKED`).toContain(slug);
  }
});

/* ═══ the gallery cannot render a default as if it were verified ══════════ */
// Executed in tests/preset-harvest.spec.js: the real /onboarding gallery is
// driven in Chromium over the shipped index, and every default card must carry
// the "Default palette, not this brand's" chip and the reason it is one.

/* ═══ a colour is taken from the page, or it is not taken ════════════════ */

const HAND_PRIMARY = {
  knickgasm: '#d0473e',
  'economic-times': '#d51131',
  'times-of-india': '#e21b22',
  'toi-health-fitness': '#eb1b24',
  apple: '#0071e3',
};

// What a page's colours MEAN (identity, action, monochrome, nothing at all) is
// decided by the one rendered reader, api/_shared/brand-render.js, and mapped
// onto a preset by scripts/lib/preset-observation.js. Both are executed in
// tests/preset-harvest.spec.js, over fixture sites in real Chromium.

test('the five hand-verified palettes stay the colours that were read for them', () => {
  for (const [slug, hex] of Object.entries(HAND_PRIMARY)) {
    expect(load(slug).palette.primary.toLowerCase()).toBe(hex);
  }
});

test('an observed template carries that observation and nothing else', () => {
  for (const row of index.presets) {
    if (HAND_PRIMARY[row.slug]) continue;
    const obsPath = path.join(ROOT, 'data', 'brands', 'observed', `${row.slug}.observed.json`);
    if (!fs.existsSync(obsPath)) continue;
    const obs = JSON.parse(fs.readFileSync(obsPath, 'utf8'));
    const preset = load(row.slug);
    if (!obs.ok || obs.palette_ok === false) {
      expect(row.palette_source, `${row.slug} was given a brand colour from a page that was not read`).toBe('default');
      // A read that did not produce a palette says why, in the observation
      // and on the card (the rendered reader's format; the 2026-09-30 one
      // carried only a note).
      if (obs.format === 'preset-observation/2') {
        expect(['blocked', 'timeout', 'unavailable', 'rendered']).toContain(obs.read_attempt.renderer);
        expect(row.read_note, `${row.slug} is a default with no reason on its card`).toBeTruthy();
      }
      continue;
    }
    expect(row.palette_source, row.slug).toBe('verified');
    expect(preset.palette.primary.toLowerCase()).toBe(String(obs.palette.primary).toLowerCase());
    expect(preset.preset.source.toLowerCase()).toContain(String(obs.palette.primary).toLowerCase());
    expect(preset.preset.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (obs.logo_url) expect(preset.logo_url).toBe(obs.logo_url);
    const allowed = new Set((obs.assets || []).map((a) => a.url));
    for (const asset of preset.brand_assets || []) {
      expect(allowed.has(asset.url), `${row.slug} asset ${asset.url} was not on the observed page`).toBe(true);
      expect(asset.url).toMatch(/^https:\/\//);
    }
    if ((obs.assets || []).length) {
      expect((preset.brand_assets || []).length, `${row.slug} dropped the images its site published`).toBeGreaterThan(0);
    }
  }
});

test('the rights note is on every preset, template or not', () => {
  expect(index.rights_note).toMatch(/not a licence/i);
  for (const row of index.presets) {
    expect(load(row.slug).rights_note, `${row.slug} ships with no rights note`).toMatch(/not a licence/i);
  }
});

/* ═══ a real photograph is not the picture of a placeholder line ═════════ */
// 2026-10-03. The build used to deal the photographs a brand's home page
// published out to its placeholder rows in order, so "Signature Blend 01"
// carried a touch icon and "Seasonal Drink 01" a gift card. Each URL was
// real; each pairing was invented, and a mailer renders a row's image as that
// product's picture. The photographs belong in `brand_assets` with the page
// they were found on; a placeholder row stays image-free.
test('no placeholder catalogue row carries an image, and the observed photographs stay in brand_assets', () => {
  let rows = 0;
  let withAssets = 0;
  for (const row of index.presets) {
    const preset = load(row.slug);
    for (const line of preset.catalog_placeholder || []) {
      if (!line.placeholder) continue;
      rows += 1;
      expect(line.image_url || '', `${row.slug} · ${line.title} was given a photograph it was never published with`).toBe('');
    }
    if ((preset.brand_assets || []).length) withAssets += 1;
  }
  // A check that inspects nothing passes everything.
  expect(rows).toBeGreaterThan(50);
  expect(withAssets).toBeGreaterThan(5);
});
