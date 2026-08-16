// A brand that fails to resolve must not become tenant zero.
//
// /social ran the full 7-agent pipeline and produced a day of posts about one
// company's sneakers - with that company's REAL product URLs - inside another
// company's workspace. Nothing in the pipeline was "wrong" in isolation:
//
//   api/brain.js         passed `workspaceId` to social.runDaily() and no brand
//   social-core.js       brandRecord(ctx) required ctx.brand.id, so with none
//                        it fell through to defaultBrand() = TENANT ZERO
//   catalog lookups      ran with no pinned scope at all
//
// The same `if (!b) b = defaultBrand()` fallback existed at ~26 sites across
// the generators. Each one silently converts "I do not know whose brand this
// is" into "it is tenant zero's", which is the single most damaging answer the
// platform can give.
//
// Run: npx playwright test tests/brand-fallback.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
const catalog = require(path.join(ROOT, 'api', '_shared', 'brand-catalog-server.js'));

/* ═══ the primitive ════════════════════════════════════════════════════════ */

test('with nothing in scope, the generator brand is UNRESOLVED, not tenant zero', () => {
  const b = runtime.scopedBrand(null);
  expect(runtime.isUnresolved(b)).toBe(true);
  expect(b.name).toMatch(/DATA REQUIRED BEFORE LAUNCH/);

  // The specific failure: it must not be tenant zero wearing a different label.
  const zero = runtime.defaultBrand();
  expect(b.slug).not.toBe(zero.slug);
  expect(String(b.name)).not.toMatch(new RegExp(zero.name, 'i'));

  // An empty palette lets the page's own --brand-* tokens show through. Tenant
  // zero's palette would paint another brand's colours and look CORRECT, which
  // is worse than looking broken.
  expect(Object.keys(b.palette || {})).toHaveLength(0);
});

test('a brand it was handed wins over everything', () => {
  const mine = { id: 'ws_x', slug: 'daily-record', name: 'The Daily Record' };
  expect(runtime.scopedBrand(mine).slug).toBe('daily-record');
});

test('the pinned generation brand is used when the caller passes none', async () => {
  const pinned = { id: 'ws_news', slug: 'daily-record', name: 'The Daily Record' };
  await catalog.withCatalog({ brand: pinned, workspaceId: 'ws_news' }, async () => {
    const b = runtime.scopedBrand(null);
    expect(b.slug, 'inside a pinned generation, that brand is the answer').toBe('daily-record');
    expect(runtime.isUnresolved(b)).toBe(false);
  });
  // ...and the pin does not leak out of its subtree.
  expect(runtime.isUnresolved(runtime.scopedBrand(null))).toBe(true);
});

test('tenant zero is still reachable, but only by asking for it', () => {
  const zero = runtime.defaultBrand();
  expect(zero.slug, 'the shipped record must still resolve').toBeTruthy();
  expect(runtime.scopedBrand(null, { allowTenantZero: true }).slug).toBe(zero.slug);
});

/* Tenant zero's IDENTITY must keep coming from defaultBrand(). brand-catalog-
   server's tenantZeroSlug() reads it there to decide who owns the bundled
   catalogue - if that ever returned the active brand instead, every brand would
   test as tenant zero and the shipped files would open to all of them. */
test('changing the generator fallback did not disturb who owns the shipped catalogue', () => {
  const zero = runtime.defaultBrand();
  const other = { id: 'ws_news', slug: 'daily-record', name: 'The Daily Record' };
  expect(catalog.productsFor('US', { brand: zero }).source).toBe('shipped');
  expect(catalog.productsFor('US', { brand: other }).source, 'a non-zero brand may never reach the shipped files').toBe('none');
});

/* ═══ the wiring that actually shipped the bug ═════════════════════════════ */

test('brain.js resolves the brand record, not just the workspace id', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
  expect(src, 'the request must carry a resolved brand for every handler').toMatch(/req\.__brand\s*=/);
});

test('social-run-daily is handed the brand and runs with a pinned catalogue', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
  const i = src.indexOf("case 'social-run-daily'");
  expect(i, 'the social action should still exist').toBeGreaterThan(-1);
  const block = src.slice(i, i + 1600);
  expect(block, 'social.runDaily must receive the brand, not only a workspace id').toMatch(/brand:\s*req\.__brand/);
  expect(block, 'its image lookups need a pinned catalogue').toMatch(/withCatalog/);
});

test('no generator still turns an unknown brand into tenant zero', () => {
  const GENERATORS = [
    'social-core.js', 'brand-llm.js', 'lifecycle-mailer-build.js',
    'review-recovery.js', 'smart-brain-plan.js',
  ];
  const offenders = [];
  for (const f of GENERATORS) {
    const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', f), 'utf8');
    src.split('\n').forEach((line, i) => {
      // The exact shape of the bug: a falsy brand replaced by tenant zero.
      if (/\breturn\s+\w+\s*=|if \(!\w+\)/.test(line) && /defaultBrand\(\)/.test(line)) {
        offenders.push(`${f}:${i + 1}`);
      }
    });
  }
  expect(offenders, `these still fall back to tenant zero: ${offenders.join(', ')}`).toEqual([]);
});
