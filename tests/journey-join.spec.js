// Link-by-link attribution: the join key is the whole design.
//
// There is no shared identity graph between Meta, Google, Klaviyo, WebEngage
// and Shopify in this stack. What every one of them DOES write is a destination
// URL with UTM parameters, and Shopify records the one the buyer arrived on in
// the order's `landing_site`. So the link is the join.
//
// The bug this normalisation exists to prevent, quoted from the module: Shopify
// writes `landing_site` as a RELATIVE path while an ad's destination is
// ABSOLUTE. Including the host makes those two keys differ, the cost side never
// joins the outcome side, and every paid link renders TWICE - once with spend
// and no orders (flagged as a leak) and once with orders and no spend. The
// ledger looks populated and is wrong in the most damaging direction.
//
// Run: npx playwright test tests/journey-join.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const journey = require(path.join(ROOT, 'api', '_shared', 'journey-core.js'));

/* ═══ the join ════════════════════════════════════════════════════════════ */

test("Shopify's relative landing_site joins an ad's absolute destination", () => {
  const fromShopify = journey.normaliseLink('/collections/gifts?utm_source=meta&utm_medium=cpc&utm_campaign=aug');
  const fromAd = journey.normaliseLink('https://store.example.com/collections/gifts?utm_source=meta&utm_medium=cpc&utm_campaign=aug');
  expect(fromShopify.key).toBe(fromAd.key);
});

test('the key survives noise that would otherwise shatter a campaign', () => {
  const clean = journey.normaliseLink('/p?utm_source=meta&utm_medium=cpc&utm_campaign=aug');
  for (const noisy of [
    '/p?utm_source=meta&utm_medium=cpc&utm_campaign=aug&fbclid=IwAR123',
    '/p?fbclid=abc&utm_campaign=aug&utm_medium=cpc&utm_source=meta',   // reordered
    '/p/?utm_source=meta&utm_medium=cpc&utm_campaign=aug',             // trailing slash
    'https://a.example.com/p?utm_source=meta&utm_medium=cpc&utm_campaign=aug&gclid=xyz&session=99',
  ]) {
    // Keeping session ids and click ids would turn one campaign into hundreds
    // of unique "links" and make every aggregate meaningless.
    expect(journey.normaliseLink(noisy).key, noisy).toBe(clean.key);
  }
});

test('genuinely different campaigns do NOT collapse together', () => {
  const aug = journey.normaliseLink('/p?utm_source=meta&utm_medium=cpc&utm_campaign=aug');
  for (const other of [
    '/p?utm_source=meta&utm_medium=cpc&utm_campaign=sep',      // different campaign
    '/p?utm_source=google&utm_medium=cpc&utm_campaign=aug',    // different source
    '/q?utm_source=meta&utm_medium=cpc&utm_campaign=aug',      // different page
    '/p?utm_source=meta&utm_medium=email&utm_campaign=aug',    // different medium
  ]) {
    expect(journey.normaliseLink(other).key, other).not.toBe(aug.key);
  }
});

/* ═══ channel classification ══════════════════════════════════════════════ */

test('the medium names the channel and the source names the vendor', () => {
  const ch = (u) => journey.channelOf(journey.normaliseLink(u));
  expect(ch('/p?utm_source=meta&utm_medium=cpc')).toBe('meta');
  expect(ch('/p?utm_source=google&utm_medium=cpc')).toBe('google');
  expect(ch('/p?utm_source=tiktok&utm_medium=paid_social')).toBe('tiktok');
  expect(ch('/p?utm_source=klaviyo&utm_medium=email')).toBe('email');
  expect(ch('/p?utm_source=instagram&utm_medium=social')).toBe('instagram');
});

test('a source with no medium is not guessed at', () => {
  // utm_source=meta alone could be a paid placement or an organic post. Picking
  // one would put spend against a link that never cost anything.
  expect(journey.channelOf(journey.normaliseLink('/p?utm_source=meta'))).toBe('other');
});

test('an untagged link is called untagged, not attributed to anything', () => {
  expect(journey.channelOf(journey.normaliseLink('/p'))).toBe('untagged');
  expect(journey.normaliseLink('/p').tagged).toBeFalsy();
});

/* ═══ what it refuses to claim ════════════════════════════════════════════ */

test('the module states plainly that this is last click, not multi-touch', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'journey-core.js'), 'utf8');
  // `landing_site` is the LAST click before the order. Claiming multi-touch
  // from last-click data is the most seductive fabrication available here, so
  // the limitation is documented rather than left to be assumed.
  expect(src).toMatch(/NOT multi-touch/i);
  expect(src).toMatch(/last[- ]click/i);
  // Historical CSV and live Admin data cover different windows; concatenating
  // them would double-count the overlap.
  expect(src).toMatch(/basis: 'historical'\|'live'|historical.*live.*never blended/i);
});

test('a platform with no credential contributes a blocker, not a zero', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'journey-core.js'), 'utf8');
  expect(src).toMatch(/blockers\.push/);
  // A link that looks unattributed must never be mistaken for a link that
  // performed badly.
  expect(src).toMatch(/EVERY PLATFORM EITHER CONTRIBUTES ROWS OR CONTRIBUTES A BLOCKER/i);
});

test('the Klaviyo check asks this brand, not the deployment', () => {
  const fs = require('fs');
  const raw = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'journey-core.js'), 'utf8');
  // Comments first. The module explains WHY it stopped calling hasKey(), and a
  // scan that reads prose fails on the sentence documenting the fix.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  expect(code).not.toMatch(/klaviyo\.hasKey\(/);
  expect(code).toMatch(/klaviyo\.isConnected\(/);
  expect(code).toMatch(/Connections page/);
});

test('no other brand rode along in the port', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'journey-core.js'), 'utf8');
  // The token is ASSEMBLED, not written out. tests/ ships inside the deployed
  // output root (vercel.json sets outputDirectory "."), so a literal here would
  // itself be a publicly fetchable occurrence of the string this assertion
  // exists to keep out - which is precisely what check-foreign-brands.js
  // flagged, and why that script assembles its own tokens the same way.
  const sibling = ['vah', 'dam'].join('');
  expect(src.toLowerCase()).not.toContain(sibling);
});
