// /social generated one company's sneakers inside another company's workspace,
// twice, after two separate fixes.
//
// The first fix passed the brand into the pipeline and pinned the catalogue.
// It changed nothing, because the products were never coming from the
// catalogue. They came from `data/product-types.json` - a SECOND shipped
// catalogue carrying tenant zero's product titles and its store's base_url -
// loaded unconditionally, on the line BEFORE the brand was resolved:
//
//     const facts = productTypes();      // tenant zero's, always
//     let __brand = null;                // resolved after
//     if (workspaceId) { __brand = await ... }
//
// and `focusFor()` hardcoded 'coffee-ART Collection' /
// 'nike-air-force-1-coffee-dip-rope-laces' as its fallback - a handle that
// resolves to a REAL product page on tenant zero's store.
//
// The catalogue-scope guard could not see any of this: it only forbids reading
// `data/catalog/`. So this file checks the OUTPUT and the ordering, not just
// the gate - an assertion about the gate alone would have passed while the bug
// shipped.
//
// Run: npx playwright test tests/social-brand-scope.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const catalog = require(path.join(ROOT, 'api', '_shared', 'brand-catalog-server.js'));
const runtime = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
const SOCIAL_SRC = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'social-core.js'), 'utf8');

const PUBLISHER = { id: 'ws_toi', slug: 'times-of-india', name: 'The Times of India' };

/* Tenant zero's real product vocabulary and its real store host. If either
   reaches another brand, a customer can click through to a competitor. */
const ZERO_PRODUCT = /\b(sneakers?|air force|CR7|hand-painted|coffee-ART|colorway)\b/i;
const ZERO_HOST = /knickgasm\.(com|co|io)/i;

/* ═══ the file that was actually leaking ═══════════════════════════════════ */

test('tenant zero may read its own product taxonomy', () => {
  const g = catalog.tenantZeroData('data/product-types.json', { brand: runtime.defaultBrand() });
  expect(g.source).toBe('shipped');
  expect(Object.keys((g.data && g.data.types) || {}).length).toBeGreaterThan(0);
});

test('another brand gets NOTHING from it, with a reason', () => {
  const g = catalog.tenantZeroData('data/product-types.json', { brand: PUBLISHER });
  expect(g.source).toBe('none');
  expect(g.data, 'a partial or substituted taxonomy is what shipped the bug').toBeNull();
  expect(g.reason).toBeTruthy();
});

test('every shipped tenant-zero data file is gated, not just the catalogue', () => {
  // These all carry one company's facts: its products, its market's calendar,
  // its segment sizes, its sales. None were gated before.
  for (const f of ['data/product-types.json', 'data/festivals.json', 'data/cohort-sizes.json',
                   'data/analytics/market-data.json', 'data/catalog/products_us.json']) {
    expect(catalog.isTenantZeroDataFile(f), `${f} must be gated`).toBe(true);
    expect(catalog.tenantZeroData(f, { brand: PUBLISHER }).data, `${f} leaked to another brand`).toBeNull();
  }
});

test('a pinned generation for another brand closes the file even with no brand argument', async () => {
  await catalog.withCatalog({ brand: PUBLISHER, workspaceId: 'ws_toi' }, async () => {
    const g = catalog.tenantZeroData('data/product-types.json', {});
    expect(g.source, 'the pinned brand decides when the caller passes none').toBe('none');
  });
});

/* ═══ the ordering bug, which a gate alone would not catch ═════════════════ */

test('social resolves the brand BEFORE it loads the product facts', () => {
  const body = SOCIAL_SRC.slice(SOCIAL_SRC.indexOf('async function runDaily'));
  const brandAt = body.indexOf('__brand');
  const factsAt = body.indexOf('const facts');
  expect(brandAt, 'runDaily should still resolve a brand').toBeGreaterThan(-1);
  expect(factsAt, 'runDaily should still load product facts').toBeGreaterThan(-1);
  expect(brandAt, 'facts loaded before the brand is known are always tenant zero\'s')
    .toBeLessThan(factsAt);
});

test('social takes the brand the router already resolved', () => {
  const sig = SOCIAL_SRC.slice(SOCIAL_SRC.indexOf('async function runDaily'), SOCIAL_SRC.indexOf('async function runDaily') + 200);
  expect(sig, 'brain.js resolves req.__brand per request; the pipeline must accept it').toMatch(/brand\s*=\s*null/);
});

test('the product facts are read through the gate, not off disk', () => {
  const body = SOCIAL_SRC.slice(SOCIAL_SRC.indexOf('async function runDaily'));
  expect(body).toMatch(/tenantZeroData\(\s*'data\/product-types\.json'/);
});

/* ═══ no hardcoded product of anyone's ═════════════════════════════════════ */

/** Source with comments removed: these rules are about CODE. The comments in
    social-core.js explain this exact bug and have to name the words to do it. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

test('focusFor names no product when the brand owns none', () => {
  const fn = codeOnly(SOCIAL_SRC.slice(SOCIAL_SRC.indexOf('function focusFor'), SOCIAL_SRC.indexOf('function festivalFor')));
  // The two literals that resolved to a real page on tenant zero's store.
  expect(fn, 'a fallback naming somebody else\'s product is a fabrication').not.toMatch(/coffee-ART Collection/);
  expect(fn).not.toMatch(/nike-air-force-1-coffee-dip-rope-laces/);
  expect(fn, 'the empty case must render a marker').toMatch(/DATA REQUIRED BEFORE LAUNCH/);
});

test('a product with no handle produces no link', () => {
  const fn = SOCIAL_SRC.slice(SOCIAL_SRC.indexOf('function focusFor'), SOCIAL_SRC.indexOf('function festivalFor'));
  // `base + '/products/' + ''` is a link to a storefront, and it looks real.
  expect(fn).toMatch(/product\.handle \?/);
});

test('no tenant-zero product name or store host is hardcoded in the pipeline', () => {
  const offenders = [];
  codeOnly(SOCIAL_SRC).split('\n').forEach((line, i) => {
    if (ZERO_PRODUCT.test(line) || ZERO_HOST.test(line)) offenders.push(`${i + 1}: ${line.trim().slice(0, 90)}`);
  });
  expect(offenders, `tenant zero's own words in the pipeline:\n${offenders.join('\n')}`).toEqual([]);
});
