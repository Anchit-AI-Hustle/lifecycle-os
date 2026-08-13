// Generated visuals must belong to the brand that asked for them.
//
// The image prompts used to name one tenant, its four hex colours and its
// product category, so every other brand received that: a publisher asking for
// a hero image got a photograph of another company's product in another
// company's palette. The audio beds were worse - handing another brand a file
// labelled "cleared for paid media" is a licensing claim that brand cannot
// stand behind, because the clearance does not travel with the file.
//
// Run: npx playwright test tests/brand-visuals.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const { buildPreamble, MODES } = require('../api/_shared/image-prompt.js');
const { audioBedFor } = require('../api/_shared/video-core.js');

const ROOT = path.resolve(__dirname, '..');
const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const TENANT_ZERO = load('data/brands/_default.json');
const PUBLISHER = load('data/brands/presets/economic-times.json');
const HEALTH = load('data/brands/presets/toi-health-fitness.json');

// Tenant zero's identity, in the forms a prompt could leak it.
const ZERO_TOKENS = [/knickgasm/i, /sneakers?/i, /\bkicks\b/i, /#D0473E/i, /#6A33D8/i];

test('no brand receives tenant zero\'s name, palette or category', () => {
  for (const brand of [PUBLISHER, HEALTH]) {
    for (const mode of MODES) {
      const prompt = buildPreamble(brand, mode);
      for (const rx of ZERO_TOKENS) {
        expect(prompt, `${brand.name} / ${mode} leaked ${rx}`).not.toMatch(rx);
      }
    }
  }
});

test('each brand\'s own palette is the one instructed', () => {
  const pub = buildPreamble(PUBLISHER, 'ad');
  expect(pub).toContain(PUBLISHER.palette.primary);
  expect(pub).toContain(PUBLISHER.palette.accent);

  const zero = buildPreamble(TENANT_ZERO, 'ad');
  expect(zero).toContain(TENANT_ZERO.palette.primary);
});

test('the SUBJECT follows what the brand sells', () => {
  // A publisher has no packaging and no product shot; a store does.
  const pub = buildPreamble(PUBLISHER, 'photo');
  expect(pub).toMatch(/editorial/i);
  expect(pub).toMatch(/No product, no packaging/i);

  const store = buildPreamble(TENANT_ZERO, 'photo');
  expect(store).toMatch(/product this brand sells/i);

  // A brand whose offerings are date-bound gets a venue, not a product.
  const events = { name: 'Runs', palette: {}, typography: {}, offerings: [{ kind: 'event', name: 'City Run' }] };
  expect(buildPreamble(events, 'photo')).toMatch(/venue or gathering/i);
});

test('the anti-fabrication rules hold for every brand and every mode', () => {
  // A generated image is the easiest place in the product to invent a fact, so
  // these are not the brand's to relax.
  for (const brand of [TENANT_ZERO, PUBLISHER, HEALTH]) {
    for (const mode of MODES) {
      const p = buildPreamble(brand, mode);
      expect(p).toMatch(/star ratings, review counts, award badges/i);
      expect(p).toMatch(/NEVER render/i);
    }
  }
});

test('only the ad mode is allowed to render text', () => {
  const brand = PUBLISHER;
  expect(buildPreamble(brand, 'ad')).toMatch(/ONLY text in frame is the supplied headline/i);
  for (const mode of ['photo', 'ambient', 'reels']) {
    expect(buildPreamble(brand, mode), mode).toMatch(/NO text anywhere in frame/i);
  }
});

test('a brand with nothing on record still gets a usable, honest brief', () => {
  const bare = { name: 'Bare Brand' };
  const p = buildPreamble(bare, 'photo');
  expect(p).toContain('Bare Brand');
  expect(p).toMatch(/no invented brand colours/i);
  expect(p).toMatch(/Invent nothing the brand has not supplied/i);
});

// ── Audio beds ──────────────────────────────────────────────────────────────

test('another brand is never handed tenant zero\'s licensed audio', () => {
  const other = { slug: 'northwind', name: 'Northwind Books' };
  const bed = audioBedFor(12, { brand: other });
  expect(bed.bed).toBeNull();
  expect(bed.origin).toContain('DATA REQUIRED BEFORE LAUNCH');
  expect(JSON.stringify(bed)).not.toMatch(/knickgasm/i);
  // And it says WHY, so the operator can act rather than wonder.
  expect(bed.note).toMatch(/not licensed for it/i);
});

test('a brand with its own bed on file gets that one', () => {
  const withOwn = { slug: 'nw', name: 'NW', audio_beds: { reels: '/media/nw-reels.wav', hero: '/media/nw-hero.wav' } };
  expect(audioBedFor(12, { brand: withOwn }).bed).toBe('/media/nw-reels.wav');
  expect(audioBedFor(30, { brand: withOwn }).bed).toBe('/media/nw-hero.wav');
  expect(audioBedFor(12, { brand: withOwn }).origin).toMatch(/NW owned/i);
});

test('tenant zero keeps its own beds', () => {
  const bed = audioBedFor(12, { brand: TENANT_ZERO });
  expect(bed.bed).toBeTruthy();
  expect(bed.origin).toMatch(/cleared for paid media/i);
});
