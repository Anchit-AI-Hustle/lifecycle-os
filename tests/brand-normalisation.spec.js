// A persisted brand must arrive hoisted at BOTH boundaries.
//
// `brand_workspaces` has a fixed set of columns plus one JSON column,
// `brand_data`, holding offerings, claims and the market study. Generators read
// the top level, so a raw row loses all of it and every asset prints
// "[DATA REQUIRED BEFORE LAUNCH: verifiable claims]".
//
// There are TWO ways a workspace enters the system and they are easy to confuse:
//
//   brandRuntime.resolve()            the CALLER's token, RLS-checked. Interactive
//                                     requests from the browser.
//   workspaceScope.brandForWorkspace() the SERVICE ROLE. Cron, the prebuild
//                                     queue, approve, the social run, the brand
//                                     LLM - the paths that build most assets.
//
// Fixing only the first left every scheduled and background generation broken,
// which is why both are pinned here.
//
// Run: npx playwright test tests/brand-normalisation.spec.js
const { test, expect } = require('@playwright/test');

const brandRuntime = require('../api/_shared/brand-runtime.js');
const wsScope = require('../api/_shared/workspace-scope.js');

/** Exactly what Postgres returns for an onboarded workspace. */
function rawRow(overrides) {
  return Object.assign({
    id: 'ws_norm_1', slug: 'northwind', name: 'Northwind Books',
    industry: 'Publishing', website: 'https://northwind.example',
    palette: { primary: '#1F4E79', accent: '#C8102E', ink: '#1A1A1A', surface: '#FFFFFF' },
    typography: { heading: { family: 'Merriweather' }, body: { family: 'Inter' } },
    voice: { tone: 'considered', banned: [] },
    regions: [{ code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://northwind.example' }],
    catalog_source: { kind: 'manual', offering_kinds: ['section'] },
    brand_data: {
      offerings: [{ kind: 'section', name: 'Fiction' }, { kind: 'section', name: 'Essays' }],
      claims: ['Independent since 1998', 'Every title printed in the UK'],
      market_study: { UK: { headline: 'UK indie publishing', sizing: [], tiers: [], reads: [], gaps: [] } },
      legal_entity: 'Northwind Books Ltd',
    },
  }, overrides || {});
}

test('normalizeBrand hoists brand_data onto the brand', () => {
  const out = brandRuntime.normalizeBrand(rawRow());
  expect(out.claims).toEqual(['Independent since 1998', 'Every title printed in the UK']);
  expect(out.offerings).toHaveLength(2);
  expect(out.market_study).toBeTruthy();
  expect(out.legal_entity).toBe('Northwind Books Ltd');
  expect(out.brand_data).toBeTruthy();          // the source is left intact
});

test('a real column always beats brand_data', () => {
  // brand_data is the overflow for fields that have no column, never an
  // override for one that does.
  const row = rawRow({ website: 'https://real-column.example' });
  row.brand_data.website = 'https://from-brand-data.example';
  expect(brandRuntime.normalizeBrand(row).website).toBe('https://real-column.example');
});

test('an empty array does not block the hoist', () => {
  // A column that exists but is empty should still take the brand_data value:
  // an empty claims array is absence, not a decision.
  const row = rawRow({ claims: [] });
  expect(brandRuntime.normalizeBrand(row).claims).toHaveLength(2);
});

test('a brand with no brand_data is returned untouched', () => {
  const row = rawRow({ brand_data: null, claims: ['Stated at the top level'] });
  const out = brandRuntime.normalizeBrand(row);
  expect(out).toBe(row);                        // same object, no needless copy
  expect(out.claims).toEqual(['Stated at the top level']);
});

test('the brand block states the claims as the only assertable facts', () => {
  const block = brandRuntime.brandBlock(brandRuntime.normalizeBrand(rawRow()));
  expect(block).toContain('Independent since 1998');
  expect(block).toMatch(/ONLY statements that may be presented as fact/i);
});

test('a brand with no claims is told to write no proof line at all', () => {
  const block = brandRuntime.brandBlock({ name: 'Bare', palette: {}, typography: {}, voice: {}, regions: [] });
  expect(block).toMatch(/VERIFIABLE CLAIMS: \[DATA REQUIRED/);
  expect(block).toMatch(/write no proof, guarantee or credential line at all/i);
});

test('the SERVICE-ROLE path hoists too', async () => {
  // Cron, prebuild, approve and the social run all reach a workspace through
  // brandForWorkspace and never touch resolve(). Fixing only resolve() left
  // every background generation handing generators an unhoisted row.
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => [rawRow({ id: 'ws_service_1' })] });
  try {
    const brand = await wsScope.brandForWorkspace(
      { url: 'https://example.supabase.co', key: 'service-role-key' },
      'ws_service_1',
    );
    expect(brand).toBeTruthy();
    expect(brand.claims, 'service-role path returned an unhoisted row').toEqual([
      'Independent since 1998', 'Every title printed in the UK',
    ]);
    expect(brand.offerings).toHaveLength(2);
  } finally {
    global.fetch = realFetch;
  }
});
