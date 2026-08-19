// The brain plans a cohort, and the cohort has to reach the asset.
//
// THE DEFECT THIS FILE EXISTS FOR. `objectiveFor()` tested a cohort name with
// `/winback|at-risk/i` — hyphenated. The function that actually names this
// repo's cohorts, `rfm-core.segmentFor()`, emits "At Risk" with a SPACE. So the
// test never matched, and neither did "Can't Lose Them", "Hibernating", "Lost",
// "About to Sleep", "Need Attention" or "Promising", none of which contain any
// of the four literals it looked for. Eight of the eleven canonical segments
// fell through to the default — and the default is the objective written for
// somebody who has never bought anything.
//
// That is not a labelling slip. The objective briefs the copywriter, sets the
// offer depth and shapes every asset on the slot, so a customer weeks from
// churning was sent an introduction to the brand, and the reviewer saw a
// coherent campaign and approved it.
//
// Every test here RUNS the planner. The segment names are read out of
// rfm-core rather than typed into this file, so a new segment added there
// arrives here automatically instead of being silently unplanned.
//
// Run: npx playwright test tests/brain-cohort-planning.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const rfm = require(path.join(ROOT, 'api', '_shared', 'rfm-core.js'));
const { smartConfig, CalendarIntelligenceService } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const sbPlan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));

/** Every segment rfm-core can actually emit, derived by walking the quintile
 *  space rather than by copying a list that would drift out of date. */
function canonicalSegments() {
  const names = new Set();
  for (let r = 1; r <= 5; r++) {
    for (let f = 1; f <= 5; f++) {
      for (let m = 1; m <= 5; m++) names.add(rfm.segmentFor(r, f, m).name);
    }
  }
  return [...names].sort();
}

/** Run the real planner over a given set of cohorts. */
function plan(cohortNames, over = {}) {
  const cfg = smartConfig(Object.assign({
    markets: ['US'], cohortsPerDay: cohortNames.length,
  }, over.config || {}));
  const svc = new CalendarIntelligenceService(cfg);
  return svc.generate({
    analysis: {
      source: 'test',
      cohorts: cohortNames.map((n, i) => ({ name: n, count: 1000 + i, rules: ['r'] })),
      productScores: [
        { product: { sku: 'A', title: 'Alpha 01', handle: 'alpha-01', category: 'kicks' }, score: 0.9 },
        { product: { sku: 'B', title: 'Beta 02', handle: 'beta-02', category: 'kicks' }, score: 0.5 },
      ],
      winningCampaigns: [],
      mvtLearnings: [],
    },
    startDate: '2026-09-01',
    days: over.days || 1,
    brand: over.brand || { name: 'TestBrand' },
    // Deliberately omitted: competitorBenchmarks. A brand with no competitor
    // set is a documented normal state and must still get a calendar.
  }).entries;
}

const objectiveByCohort = (entries) => {
  const m = {};
  for (const e of entries) m[e.cohort.name] = e.objective;
  return m;
};

/* ═══ every canonical segment gets an objective written for it ════════════ */

test('no canonical segment falls through to the never-purchased objective', () => {
  const segments = canonicalSegments();
  expect(segments.length).toBeGreaterThanOrEqual(11);
  const got = objectiveByCohort(plan(segments));

  // Anyone who has bought before has, by definition, been educated about the
  // brand. Handing them the education objective is the bug.
  const buyers = segments.filter((n) => !/never|prospect|unknown/i.test(n));
  for (const n of buyers) {
    expect(got[n], `"${n}" was planned but got no objective`).toBeTruthy();
    expect(got[n], `"${n}" is a past buyer and got the never-purchased objective`)
      .not.toBe('education-led conversion');
  }
});

test('a churn-risk segment is planned as a save, not as an introduction', () => {
  const got = objectiveByCohort(plan(canonicalSegments()));
  // Each of these is a customer the brand already has and is losing.
  expect(got['At Risk']).toMatch(/reactivation/);
  expect(got['Hibernating']).toMatch(/reactivation/);
  expect(got["Can't Lose Them"]).toMatch(/reactivation/);
  expect(got['Lost']).toMatch(/reactivation/);
  // Still active, but the gap is stretching — cheaper to hold than to win back,
  // so it must not be lumped in with the already-gone.
  expect(got['About to Sleep']).toBe('pre-lapse retention');
  expect(got['Need Attention']).toBe('pre-lapse retention');
});

test("the brand's best customers are planned for expansion", () => {
  const got = objectiveByCohort(plan(canonicalSegments()));
  expect(got['Champions']).toBe('premium bundle expansion');
  expect(got['Loyal Customers']).toBe('premium bundle expansion');
});

test('a one-time buyer is planned for the second order, not upsold', () => {
  const got = objectiveByCohort(plan(canonicalSegments()));
  expect(got['New Customers']).toBe('second-order activation');
  expect(got['Promising']).toBe('second-order activation');
  // The subtle one: "Potential Loyalist" contains "Loyal", so an order-sensitive
  // rule set upsells a buyer who has not yet formed the habit.
  expect(got['Potential Loyalist']).toBe('second-order activation');
});

test('an audience the app does not recognise still gets the safe default', () => {
  const got = objectiveByCohort(plan(['Never Purchased', 'Engaged Non-Buyers', 'Some Future Segment']));
  for (const n of Object.keys(got)) expect(got[n]).toBe('education-led conversion');
});

test('the objectives are genuinely distinct, not one label reused', () => {
  const got = objectiveByCohort(plan(canonicalSegments()));
  expect(new Set(Object.values(got)).size).toBeGreaterThanOrEqual(5);
});

/* ═══ the calendar itself ═════════════════════════════════════════════════ */

test('every cohort is planned, in every market, on every day', () => {
  const cohorts = ['Champions', 'At Risk', 'Never Purchased'];
  const cfg = { markets: ['US', 'UK'] };
  const entries = plan(cohorts, { days: 3, config: cfg });
  expect(entries.length).toBe(3 * 2 * cohorts.length);

  for (const date of ['2026-09-01', '2026-09-02', '2026-09-03']) {
    for (const market of cfg.markets) {
      const here = entries.filter((e) => e.date === date && e.market === market);
      expect(here.length, `${date} ${market} has the wrong slot count`).toBe(cohorts.length);
      // No cohort mailed twice on the same day in the same market.
      expect(new Set(here.map((e) => e.cohort.name)).size).toBe(cohorts.length);
    }
  }
});

test('a slot carries the cohort it is for, with its rules', () => {
  // The cohort is what the copywriter is briefed with. A slot that names one
  // without its definition briefs on a label.
  for (const e of plan(['Champions', 'At Risk'])) {
    expect(e.cohort.name).toBeTruthy();
    expect(Array.isArray(e.cohort.rules)).toBe(true);
    expect(e.cohort.size).toBeGreaterThan(0);
  }
});

test('the plan is stable across syncs: the same date resolves to the same slots', () => {
  // Rotation is keyed on an absolute day number, not on the offset from a
  // moving start date. If it drifted, the daily sync would churn every id and
  // an approved slot would detach from its assets.
  const a = plan(['Champions', 'At Risk', 'Never Purchased'], { days: 3 });
  const b = plan(['Champions', 'At Risk', 'Never Purchased'], { days: 3 });
  expect(a.map((e) => e.id + '|' + e.cohort.name)).toEqual(b.map((e) => e.id + '|' + e.cohort.name));
});

test('a brand with no competitor set still gets a full calendar', () => {
  // A brand whose record names no competitors gets an empty universe by design.
  // Reading `.byChannel` off that absence threw out of the planner, so one
  // unconfigured feature took down every market's calendar.
  const entries = plan(['Champions', 'At Risk'], { days: 2 });
  expect(entries.length).toBe(4);
  for (const e of entries) {
    expect(Array.isArray(e.competitorContext)).toBe(true);
    // Absent benchmarks read as null — the honest value for "no competitor set" —
    // never as a fabricated figure.
    for (const c of e.competitorContext) expect(c.benchmark).toBeNull();
  }
});

/* ═══ whose products are these ════════════════════════════════════════════ */

test('a brand with no catalogue gets a stated gap, not another brand\'s product', () => {
  // The fallback here used to be a literal tenant-zero assortment, so a brand
  // whose analysis carried no product scores got 90 days of calendar in which
  // every slot planned a campaign for another company's product.
  const svc = new CalendarIntelligenceService(smartConfig({ markets: ['US'], cohortsPerDay: 1 }));
  const entries = svc.generate({
    analysis: { source: 'test', cohorts: [{ name: 'Champions', count: 100 }], productScores: [], winningCampaigns: [], mvtLearnings: [] },
    startDate: '2026-09-01', days: 1, brand: { name: 'Some Other Brand' },
  }).entries;

  expect(entries.length).toBe(1);
  const hero = entries[0].heroProduct;
  expect(hero.title).toMatch(/^\[DATA REQUIRED BEFORE LAUNCH: product catalogue, Some Other Brand/);
  expect(hero.placeholder).toBe(true);
  expect(hero.sku).toBeNull();
  // The specific string that used to leak.
  expect(JSON.stringify(entries)).not.toMatch(/KNICKGASM[- ](BUNDLE|Sneaker Assortment)/i);
});

/* ═══ and it reaches the asset ════════════════════════════════════════════ */

test('the cohort on the slot is the cohort in the prompt the operator copies', async () => {
  test.setTimeout(180_000);
  const cfg = smartConfig({});
  for (const cohort of ['At Risk', 'Champions', 'Never Purchased']) {
    const c = await sbPlan.buildCampaign({
      id: 'slot-' + cohort, date: '2026-09-02', market: 'US',
      objective: 'reactivation and replenishment',
      cohort: { name: cohort, size: 2000, rules: ['r'] },
      channels: ['email', 'meta', 'landing_page'], confidence: 0.8,
      heroProduct: { sku: 'A', title: 'Alpha 01', handle: 'alpha-01' },
      offer: { code: null, depth: 'none', pct: 0, why: 'n/a' },
      rationale: 'Slot for ' + cohort,
    }, cfg, { noLLM: true, withCreatives: false });

    // Not just present on the campaign — present in the text that gets pasted
    // into another model, which is where a wrong audience actually does harm.
    expect(c.assets.email.master_prompt_v2, `${cohort} is missing from the mailer prompt`).toContain(cohort);
    for (const ad of c.assets.ads) {
      expect(ad.master_prompt, `${cohort} is missing from the ${ad.platform} ad prompt`).toContain(cohort);
    }
  }
});

test('the market on the slot is the market in the prompt', async () => {
  test.setTimeout(180_000);
  const cfg = smartConfig({});
  for (const market of ['US', 'UK']) {
    const c = await sbPlan.buildCampaign({
      id: 'slot-' + market, date: '2026-09-02', market,
      objective: 'reactivation and replenishment',
      cohort: { name: 'At Risk', size: 2000, rules: ['r'] },
      channels: ['email'], confidence: 0.8,
      heroProduct: { sku: 'A', title: 'Alpha 01', handle: 'alpha-01' },
      offer: { code: null, depth: 'none', pct: 0, why: 'n/a' },
      rationale: 'x',
    }, cfg, { noLLM: true, withCreatives: false });
    expect(c.assets.email.master_prompt_v2).toMatch(new RegExp(`MARKET: ${market}\\b`));
  }
});
