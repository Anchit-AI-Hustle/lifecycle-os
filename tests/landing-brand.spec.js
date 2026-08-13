// Landing-page generation, per brand: the store it links to, the interaction
// axis it designs around, and the scrub that runs over the finished document.
//
// Each of these three was a way one brand's page could come out carrying
// another brand's facts, another market's checkout, or broken JavaScript.
//
// Run: npx playwright test tests/landing-brand.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const lp = require('../api/_shared/landing-page-core.js');
const brandRuntime = require('../api/_shared/brand-runtime.js');
const TENANT_ZERO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/brands/_default.json'), 'utf8'));

// ── The store a page links to ───────────────────────────────────────────────

test('the store matches the REQUESTED market, not merely a configured one', () => {
  // The market picker offers every market. A brand configured only for UK must
  // not have its UK checkout served as the US page: regionFacts() falls back to
  // the first configured region, which is right for a currency example and
  // wrong for a link.
  const ukOnly = {
    name: 'UK Only', slug: 'uk-only', website: 'https://example.com',
    regions: [{ code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://example.co.uk' }],
  };
  expect(lp.resolveStore(ukOnly, 'UK')).toBe('https://example.co.uk');
  expect(lp.resolveStore(ukOnly, 'US')).not.toContain('example.co.uk');
  expect(lp.resolveStore(ukOnly, 'US')).toBe('https://example.com');
});

test('a brand with no region for the market never inherits tenant zero', () => {
  // isDefault() is true for any brand object without a workspace id, so a
  // half-filled onboarding record would otherwise be handed tenant zero's
  // storefront and ship a page pointing at another company.
  const half = { name: 'Half Onboarded', slug: 'half-onboarded' };
  const out = lp.resolveStore(half, 'US');
  expect(out).toContain('DATA REQUIRED BEFORE LAUNCH');
  expect(out).not.toContain(String(TENANT_ZERO.website).replace(/^https?:\/\//, ''));
});

test('tenant zero still resolves its own markets', () => {
  for (const market of ['US', 'UK', 'IN']) {
    const out = lp.resolveStore(TENANT_ZERO, market);
    expect(out).toMatch(/^https:\/\//);
    expect(out).not.toContain('DATA REQUIRED');
  }
});

// ── The interaction axis ────────────────────────────────────────────────────

test('the interactive axis follows what the brand sells', () => {
  const publisher = { name: 'Pub', brand_data: { offerings: [{ kind: 'section', name: 'Markets' }] } };
  expect(lp.sensoryAxis(publisher)).toMatch(/reader states/i);

  const events = { name: 'Ev', offerings: [{ kind: 'event', name: 'Run', starts_at: '2027-01-01' }] };
  expect(lp.sensoryAxis(events)).toMatch(/run-up to the date/i);

  const service = { name: 'Svc', offerings: [{ kind: 'service', name: 'Commission' }] };
  expect(lp.sensoryAxis(service)).toMatch(/Enquiry, Scope, Delivery/i);
});

test('a persisted workspace shape is read, not just a preset file', () => {
  // brand_workspaces rows keep offerings under brand_data. Reading only the top
  // level gives every onboarded brand the generic fallback.
  const persisted = { name: 'Persisted', brand_data: { offerings: [{ kind: 'plan', name: 'Membership' }] } };
  expect(lp.sensoryAxis(persisted)).toMatch(/tiers or usage levels/i);
});

// ── The scrub that runs over the finished document ──────────────────────────

test('scrubbing a document preserves newlines, so inline JS still runs', () => {
  // scrubForBrand is a PROSE normaliser: it collapses every whitespace run to a
  // single space. Run over a document that puts a line comment above a call,
  // the call ends up inside the comment: the page renders, validates, and
  // silently does nothing when the user interacts with it.
  const html = [
    '<!doctype html><html><body>',
    '<script>',
    '// set up the pointer parallax',
    'startInteractions();',
    '</scr' + 'ipt>',
    '</body></html>',
  ].join('\n');

  const safe = brandRuntime.scrubHtmlForBrand(html, TENANT_ZERO);
  expect(safe.split('\n').length).toBe(html.split('\n').length);
  expect(safe).toMatch(/\/\/ set up the pointer parallax\nstartInteractions\(\);/);

  // And confirm the prose scrubber really would have broken it, so this test
  // documents a live hazard rather than a hypothetical one.
  const prose = brandRuntime.scrubForBrand(html, TENANT_ZERO);
  expect(prose.split('\n').length).toBe(1);
});

test('the document scrub still removes this brand\'s banned phrases', () => {
  const banned = ((TENANT_ZERO.voice || {}).banned || [])[0];
  expect(banned, 'tenant zero should declare at least one banned phrase').toBeTruthy();

  const html = `<!doctype html><html><body>\n<p>A line with ${banned} inside it.</p>\n</body></html>`;
  const safe = brandRuntime.scrubHtmlForBrand(html, TENANT_ZERO);
  expect(safe.toLowerCase()).not.toContain(String(banned).toLowerCase());
  expect(safe.split('\n').length).toBe(html.split('\n').length);
});

test('a brand with no banned list gets its document back untouched', () => {
  const html = '<!doctype html><html><body>\n  <p>spaced   out</p>\n</body></html>';
  expect(brandRuntime.scrubHtmlForBrand(html, { name: 'Plain', voice: {} })).toBe(html);
});
