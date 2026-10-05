// A brand with no catalogue and no orders still gets a rolling calendar.
//
// The empty state used to be the whole answer: "Nothing was generated" plus a
// DATA REQUIRED note. The note stays true (nothing is invented), and the
// calendar is still built from the lifecycle sequence the planner already
// uses: education, second order, pre-lapse retention, expansion, reactivation.
// Product, price, audience size and revenue stay unmarked.
//
// Run: npx playwright test tests/strategy-calendar.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const plan = require(path.join(__dirname, '..', 'api', '_shared', 'smart-brain-plan.js'));
const { applyContactPolicy } = require(path.join(__dirname, '..', 'lib', 'smart-brain', 'services.js'));

const BRAND = {
  id: 'ws-food',
  slug: 'food-for-thought',
  name: 'Food For Thought',
  regions: [{ code: 'IN', name: 'India', home: true }],
};
const NS = plan.__test_workspaceNs(BRAND.id, false);

const JOBS = {
  'Never Purchased': 'education-led conversion',
  'New Customers': 'second-order activation',
  'Need Attention': 'pre-lapse retention',
  Champions: 'premium bundle expansion',
  'At Risk': 'reactivation and replenishment',
  Hibernating: 'reactivation and replenishment',
  Lost: 'last-chance reactivation',
};

test('a brand with no catalogue gets one lifecycle job a day, and no invented facts', () => {
  const entries = plan.__test_strategyPlanEntries(BRAND, '2026-09-01', 7, NS);
  expect(entries).toHaveLength(7);
  expect(entries.map((e) => e.market)).toEqual(['IN', 'IN', 'IN', 'IN', 'IN', 'IN', 'IN']);

  const counts = {};
  for (const e of entries) {
    counts[e.cohort.name] = (counts[e.cohort.name] || 0) + 1;
    expect(e.objective).toBe(JOBS[e.cohort.name]);
    expect(e.strategy_only).toBe(true);
    expect(e.heroProduct.placeholder).toBe(true);
    expect(e.heroProduct.sku).toBeNull();
    expect(e.heroProduct.title).toMatch(/^\[DATA REQUIRED BEFORE LAUNCH: product catalogue, Food For Thought, IN\]$/);
    expect(e.cohort.size).toBeNull();
    expect(Array.isArray(e.cohort.rules)).toBe(true);
    expect(e.cohort.rules.length).toBeGreaterThan(0);
    expect(e.reach.cohort_size).toBeNull();
    expect(e.reach.planned_recipients).toBeNull();
    expect(e.reach.widen_note).toMatch(/DATA REQUIRED BEFORE LAUNCH: real eligible-segment size/);
    expect(e.feasibility).toMatchObject({ status: 'DATA REQUIRED', projected_revenue: null, daily_target: null });
    expect(e.offer.code).toBe('');
    expect(e.cta_url).toBeNull();
    expect(e.demo_numbers).toBe(false);
    expect(e.analysis.hypothesis).not.toMatch(/top-ranked product/i);
    expect(e.analysis.evidence.data_source).toBe('lifecycle-strategy');
    expect(e.confidence).toBe(0.35);
    const blob = JSON.stringify(e);
    expect(blob).not.toMatch(/\$\d/);
    expect(blob).not.toMatch(/KNICKGASM|Signature Blend/i);
  }
  expect(counts).toEqual({
    'Never Purchased': 1,
    'New Customers': 1,
    'Need Attention': 1,
    Champions: 1,
    'At Risk': 1,
    Hibernating: 1,
    Lost: 1,
  });
  expect(entries[0].strategy_note).toMatch(/DATA REQUIRED BEFORE LAUNCH: catalogue and analytics, Food For Thought, IN/);
  expect(entries[0].strategy_note).toMatch(/lifecycle strategy/);

  // Each audience is mailed once in the week, so the preferred cap (2) holds.
  const capped = applyContactPolicy(entries, null, null, '2026-09-01', null);
  expect(capped.map((e) => e.reach.frequency_cap.status)).toEqual(['SAFE', 'SAFE', 'SAFE', 'SAFE', 'SAFE', 'SAFE', 'SAFE']);
  expect(capped.every((e) => e.reach.planned_recipients == null)).toBe(true);
  expect(capped.every((e) => e.feasibility.projected_revenue == null)).toBe(true);
});

test('the same calendar date keeps the same job when the window moves', () => {
  const fromStart = plan.__test_strategyPlanEntries(BRAND, '2026-09-01', 14, NS);
  const later = plan.__test_strategyPlanEntries(BRAND, '2026-09-08', 7, NS);
  const onEighth = fromStart.find((e) => e.date === '2026-09-08');
  expect(later[0].id).toBe(onEighth.id);
  expect(later[0].cohort.name).toBe(onEighth.cohort.name);
  expect(later.map((e) => e.id)).toEqual(fromStart.filter((e) => e.date >= '2026-09-08').map((e) => e.id));
});

test('a brand with no region is not assigned a guessed country', () => {
  const bare = { id: 'ws-bare', slug: 'bare', name: 'Bare Brand', regions: [] };
  const entries = plan.__test_strategyPlanEntries(bare, '2026-09-01', 3, plan.__test_workspaceNs(bare.id, false));
  expect(entries).toHaveLength(3);
  expect(entries.map((e) => e.market)).toEqual(['UNDECLARED', 'UNDECLARED', 'UNDECLARED']);
  expect(entries[0].heroProduct.title).toMatch(/home market undeclared/);
  expect(entries[0].strategy_note).toMatch(/home market undeclared/);
  expect(JSON.stringify(entries.map((e) => e.market))).not.toMatch(/US|UK|IN/);
});

test('two brands do not share a strategy slot id', () => {
  const other = { id: 'ws-other', slug: 'other', name: 'Other Brand', regions: [{ code: 'IN' }] };
  const a = plan.__test_strategyPlanEntries(BRAND, '2026-09-01', 3, NS);
  const b = plan.__test_strategyPlanEntries(other, '2026-09-01', 3, plan.__test_workspaceNs(other.id, false));
  const ids = new Set(a.map((e) => e.id));
  expect(b.filter((e) => ids.has(e.id))).toEqual([]);
});

test('a catalogue still plans from the catalogue, and strategy fills only an empty plan', () => {
  const offering = [{ kind: 'product', name: 'Masala Box', url: 'https://example.com/masala' }];
  const fromCatalogue = plan.__test_offeringPlanEntries(BRAND, offering, '2026-09-01', 3, NS);
  expect(fromCatalogue.length).toBeGreaterThan(0);
  expect(fromCatalogue.every((e) => e.heroProduct.title === 'Masala Box')).toBe(true);
  expect(fromCatalogue.every((e) => !e.strategy_only)).toBe(true);

  const kept = plan.__test_withStrategyFallback(BRAND, fromCatalogue, '2026-09-01', 7, NS);
  expect(kept.source).toBe('data');
  expect(kept.entries).toBe(fromCatalogue);

  const filled = plan.__test_withStrategyFallback(BRAND, [], '2026-09-01', 7, NS);
  expect(filled.source).toBe('lifecycle-strategy');
  expect(filled.entries).toHaveLength(7);
  expect(filled.entries.every((e) => e.strategy_only)).toBe(true);

  expect(plan.__test_withStrategyFallback(null, [], '2026-09-01', 7, NS).source).toBe('empty');
});
