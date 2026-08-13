// Measurement honesty — the invariants that stop a MISSING number being
// reported as a MEASURED one.
//
// WHAT THIS PROTECTS. Every defect these tests cover was individually plausible
// code that produced a confidently wrong figure:
//
//   * a blended ROAS of null (an account whose checkout happens on a third
//     party, where no purchase can ever be attributed) compared straight against
//     a threshold, because JavaScript coerces `null < 1.5` to true — so an
//     account with no attribution raised a critical "low ROAS" alert, then threw
//     formatting `null.toFixed(2)` and took the hourly run down with it;
//   * a UK export with no "Returning customers" COLUMN publishing a 0.0%
//     returning rate — while the same export states the rate outright (21%);
//   * a demo overlay that declares itself synthetic relabelling an honest CSV
//     export as a "Live Shopify Admin snapshot";
//   * a promotional frequency cap that only ever tested the ABSOLUTE limit, so a
//     cohort planned for exactly 3 sends in 7 days — above the preferred cap of
//     2, needing a documented override — came back clean;
//   * an RFM engine measuring recency against a date literal;
//   * a channel "open rate" that was an unweighted mean of per-campaign rates,
//     so a 100-recipient send at 80% outvoted a 100,000-recipient send at 20%.
//
// These drive the REAL modules, not fixtures, so a renamed field fails here.
//
// Run: npx playwright test tests/measurement-honesty.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');

const dataAnalysis = require('../api/_shared/data-analysis-core.js');
const adRows = require('../api/_shared/ad-rows-core.js');
const marketAnalytics = require('../api/_shared/market-analytics.js');
const rfm = require('../api/_shared/rfm-core.js');
const brainAnalysis = require('../api/_shared/brain-analysis.js');
const SM = require('../api/_shared/scenario-model.js');
const services = require('../lib/smart-brain/services.js');

const DAY = 86400000;

// ── Paid media: a threshold may only be applied to a measured number ─────────

// A real Meta insights payload for an account that spent money and attributed
// no purchases — the shape a retail-media or marketplace account returns.
function metaPayloadNoAttribution() {
  return {
    ok: true, connected: true, platform: 'meta', level: 'campaign',
    data: [{
      campaign_id: '1', campaign_name: 'Awareness prospecting',
      spend: '4200.55', impressions: '900000', clicks: '12000',
      actions: [], action_values: [],
    }],
  };
}
function marketPayload(adKpis, platforms) {
  return {
    ads: { kpis: adKpis, platforms: platforms || [] },
    mailer: { kpis: {} },
    landing: { kpis: {} },
  };
}
const SETTINGS = dataAnalysis.DEFAULT_SETTINGS;

test('spend with no attributed conversions never trips the ROAS threshold', () => {
  const rows = adRows.rowsFor(metaPayloadNoAttribution());
  const kpis = adRows.rollup(rows);

  // Precondition: the rollup really does report these as unmeasurable, which is
  // the whole reason the detector must not compare them.
  expect(kpis.roas).toBeNull();
  expect(kpis.conversion_rate).toBeNull();
  expect(kpis.revenue_trustworthy).toBe(false);
  expect(kpis.spend).toBeGreaterThan(SETTINGS.thresholds.ad_spend_no_conversion);

  const anomalies = dataAnalysis.detectHourly({
    markets: { US: marketPayload(kpis) },
    actionData: { kpis: { error_rate: 0, guardrail_breaches: 0, error_observations: 0 }, connector_runs: [] },
    previous: null, settings: SETTINGS, workspaceId: 'ws-1',
  });

  // No ROAS anomaly at all: ROAS was not low, it was not measured.
  expect(anomalies.filter((a) => a.metric === 'ROAS')).toHaveLength(0);

  // The operator is still told about the spend — but as an ATTRIBUTION finding,
  // not as "this campaign sold nothing".
  const spendAlert = anomalies.find((a) => /no attributed conversions/i.test(a.metric));
  expect(spendAlert).toBeTruthy();
  expect(spendAlert.message).toMatch(/not the same as selling nothing/i);
  expect(spendAlert.message).toMatch(/unmeasured, not as 0/i);
});

test('an unmeasured CTR is not reported as a CTR drop against a prior run', () => {
  // Impressions absent -> ctr is null. A prior run that DID measure CTR must not
  // turn that absence into "CTR fell".
  const kpis = adRows.rollup([{ platform: 'Meta', spend: 500, impressions: 0, clicks: 0, conversions: 0, revenue: 0, reach: 0 }]);
  expect(kpis.ctr).toBeNull();

  const anomalies = dataAnalysis.detectHourly({
    markets: { US: marketPayload(kpis) },
    actionData: { kpis: { error_rate: 0, guardrail_breaches: 0, error_observations: 0 }, connector_runs: [] },
    previous: { payload: { markets: { US: { ads: { kpis: { ctr: 0.02, spend: 400 } } } } } },
    settings: SETTINGS, workspaceId: 'ws-1',
  });
  expect(anomalies.filter((a) => a.metric === 'CTR drop')).toHaveLength(0);
});

test('an execution error rate is not raised from a single recorded run', () => {
  const anomalies = dataAnalysis.detectHourly({
    markets: {},
    // One run, and it failed. That is an incident, not a 100% error rate.
    actionData: { kpis: { error_rate: 1, guardrail_breaches: 0, error_observations: 1 }, connector_runs: [] },
    previous: null, settings: SETTINGS, workspaceId: 'ws-1',
  });
  expect(anomalies.filter((a) => a.metric === 'Execution error rate')).toHaveLength(0);
});

test('paid media is not served to a workspace that cannot be resolved', async () => {
  // No brand context on the request -> an empty result naming the connection,
  // never the ad accounts this DEPLOYMENT happens to hold.
  const out = await dataAnalysis.ads({ market: 'US' });
  expect(out.data_scope.level).not.toBe('deployment');
  expect(out.rows).toEqual([]);
  expect(String(out.note)).toMatch(/paid media/i);
});

// ── Market export: an absent column is not a measured zero ──────────────────

test('the UK returning-customer rate is the rate the export measured, not zero', () => {
  const uk = marketAnalytics.audienceUnscoped('UK');
  expect(uk.ok).toBe(true);

  // The export carries a "Returning customer rate" column and no "Returning
  // customers" count. Report the rate it measured; leave the count unmeasured.
  expect(uk.returning_rate_pct).toBeGreaterThan(0);
  expect(uk.basis.returning_rate).toBe('measured');
  expect(uk.returning_customers).toBeNull();
  expect(uk.basis.returning_customers).toBe('unset');

  // new + returning is not a total when returning was never counted.
  expect(uk.purchasing_customers).toBeNull();
  expect(uk.note).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
});

test('the US export, which carries every column, is unchanged and fully measured', () => {
  const us = marketAnalytics.audienceUnscoped('US');
  expect(us.basis.returning_customers).toBe('measured');
  expect(us.purchasing_customers).toBe(us.new_customers + us.returning_customers);
  expect(us.returning_rate_pct).toBeGreaterThan(0);
  expect(us.note).not.toMatch(/DATA REQUIRED BEFORE LAUNCH/);
});

test('a synthetic overlay may not relabel a CSV export as a live Admin pull', () => {
  // Read the overlay's OWN declaration rather than assuming what ships today.
  const overlay = require('../data/analytics/live-shopify.json');
  const declaresItselfDemo = /\b(demo|synthetic|sample|seeded|simulat)/i
    .test(String(overlay.generated_note || '') + ' ' + String(overlay.source || ''));
  expect(declaresItselfDemo).toBe(true); // the shipped overlay says it is demo data

  for (const market of ['US', 'UK']) {
    const p = marketAnalytics.performanceUnscoped(market);
    if (!p.ok) continue;
    // A file that says it is not real may not make the payload say it is live.
    expect(p.data_source).not.toBe('shopify_admin_live');
    expect(p.window_note).not.toMatch(/Live Shopify Admin snapshot/);
    const a = marketAnalytics.audienceUnscoped(market);
    expect(a.source).not.toMatch(/Live Shopify Admin snapshot/);
  }
});

test('a market the overlay only names is not reported as measured and empty', () => {
  const india = marketAnalytics.performanceUnscoped('IN');
  expect(india.ok).toBe(false);
  expect(String(india.error)).toMatch(/No market analytics loaded for IN/);
});

// ── Frequency cap: the preferred cap is a cap ────────────────────────────────

function planWith(cohorts, days) {
  const cfg = services.smartConfig({ markets: ['US'], calendarDays: days, cohortsPerDay: 1 });
  const svc = new services.CalendarIntelligenceService(cfg);
  return svc.generate({
    analysis: {
      cohorts, productScores: [{ product: { title: 'Hero', sku: 'SKU-1' }, score: 0.9 }],
      winningCampaigns: [], mvtLearnings: [], source: 'test',
    },
    competitorBenchmarks: { byChannel: {}, trendingHooks: [] },
    startDate: '2026-09-01', days,
  });
}

test('three promotional sends in a rolling 7 days is flagged, not passed', () => {
  const plan = planWith(
    [{ name: 'Champions', count: 5000 }, { name: 'Winback', count: 1200 }, { name: 'New Buyers', count: 800 }],
    10,
  );
  const capped = plan.entries.map((e) => e.reach.frequency_cap);
  const three = capped.filter((c) => c.sends_in_rolling_7d === 3);
  expect(three.length).toBeGreaterThan(0);
  for (const c of three) {
    expect(c.per_rolling_7d).toBe(2);
    expect(c.absolute_max).toBe(3);
    // Above preferred, at absolute: allowed only with a documented override.
    expect(c.over_preferred).toBe(true);
    expect(c.over_cap).toBe(false);
    expect(c.status).toBe('REDUCE_AUDIENCE');
    expect(c.action).toMatch(/documented|override/i);
  }
});

test('breaching the absolute cap is BLOCKED and says it is not launch ready', () => {
  const plan = planWith([{ name: 'Champions', count: 5000 }], 10);
  const blocked = plan.entries.map((e) => e.reach.frequency_cap).filter((c) => c.status === 'BLOCKED');
  expect(blocked.length).toBeGreaterThan(0);
  for (const c of blocked) {
    expect(c.over_cap).toBe(true);
    expect(c.sends_in_rolling_7d).toBeGreaterThan(3);
    expect(c.action).toMatch(/NOT LAUNCH READY/i);
  }
});

test('a slot with a partial look-back window says so', () => {
  const plan = planWith([{ name: 'Champions', count: 5000 }], 10);
  const first = plan.entries[0].reach.frequency_cap;
  expect(first.window_complete).toBe(false);
  expect(first.action).toMatch(/partial/i);
  const last = plan.entries[plan.entries.length - 1].reach.frequency_cap;
  expect(last.window_complete).toBe(true);
});

// ── RFM: recency is measured against today ──────────────────────────────────

test('recency is measured against now, not against a date literal in the source', () => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const users = [
    { id: 'a', market: 'US', last_order_at: iso(Date.now() - 30 * DAY), orders_count: 3, total_spent: 300 },
    { id: 'b', market: 'US', last_order_at: iso(Date.now() - 31 * DAY), orders_count: 3, total_spent: 310 },
  ];
  // No `now` passed — this is the default path, and it must still be today.
  const cohorts = rfm.buildRfmCohorts(users);
  const recency = cohorts.reduce((s, c) => s + (c.metrics.avg_recency_days || 0), 0) / cohorts.length;
  expect(recency).toBeGreaterThan(25);
  expect(recency).toBeLessThan(36);
});

test('a member who never ordered has no recency, and is not counted as ordering today', () => {
  const users = [
    { id: 'a', market: 'US', last_order_at: null, orders_count: 0, total_spent: 0 },
    { id: 'b', market: 'US', last_order_at: null, orders_count: 0, total_spent: 0 },
  ];
  const [cohort] = rfm.buildRfmCohorts(users, { now: Date.now() });
  expect(cohort.metrics.avg_recency_days).toBeNull();
  expect(cohort.metrics.never_ordered).toBe(2);
  expect(cohort.metrics.recency_measured_for).toBe(0);
});

// ── Campaign scoring + channel rollups ──────────────────────────────────────

test('a campaign is not failed on a ROAS that was never measurable', () => {
  const kb = require('../api/_shared/brain-kb.js');
  // A real metrics row set with clicks and impressions but no recorded spend —
  // kpisFor returns roas: null for it.
  const kpis = kb.kpisFor('meta', [{ impressions: 100000, clicks: 3000, sends: 0, conversions: 0, revenue: 0, spend: 0 }]);
  expect(kpis.roas).toBeNull();

  const scored = brainAnalysis.scoreCampaign({ channel: 'meta', kpis }, { meta: { ctr: 0.009, roas: 1.6 } });
  const roasCheck = scored.checks.find((c) => c.name === 'roas');
  expect(roasCheck.pass).toBeNull();
  expect(roasCheck.basis).toBe('unset');
  expect(scored.unmeasured_checks).toContain('roas');
  expect(scored.basis).toBe('partial');
});

test('a campaign with nothing measurable cannot pass', () => {
  const scored = brainAnalysis.scoreCampaign(
    { channel: 'email', kpis: { sends: 0, open_rate: 0, click_rate: 0, rpr: 0 } },
    { email: { open_rate: 0.22, click_rate: 0.018, rpr: 0.08 } },
  );
  expect(scored.passed).toBe(false);
  expect(scored.basis).toBe('unset');
  expect(scored.measured_checks).toBe(0);
});

test('a channel rate is the pooled ratio, not a mean of per-campaign rates', () => {
  const library = [
    { channel: 'email', kpis: { sends: 100, opens: 80, clicks: 5, impressions: 0, conversions: 0, revenue: 0, spend: 0, open_rate: 0.8, ctr: 0.05, roas: null } },
    { channel: 'email', kpis: { sends: 100000, opens: 20000, clicks: 1000, impressions: 0, conversions: 0, revenue: 0, spend: 0, open_rate: 0.2, ctr: 0.01, roas: null } },
  ];
  const roll = brainAnalysis.channelRollup(library).email;
  // 20080 / 100100 = 0.2006. The unweighted mean would be 0.50 — more than
  // double what the channel actually did.
  expect(roll.open_rate).toBeCloseTo(0.2006, 3);
  expect(roll.avg_open_rate).toBeCloseTo(0.5, 3);
  expect(roll.rate_basis).toMatch(/pooled/i);
  expect(roll.roas).toBeNull();
});

// ── Competitor benchmarks: the denominator is the observed span ─────────────

test('competitor cadence is divided by the span actually observed', () => {
  const competitor = require('../api/_shared/brain-competitor.js');
  const dayAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
  // 20 captures, 2 brands, spread across 10 days. The real cadence is
  // 20 / 2 / (10/7) = 7 per brand per week. Dividing by a fixed 8.5 weeks - the
  // old behaviour - reports 1.18, six times too low, and a planner sets their
  // own send frequency against that number.
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({ channel: 'email', brand: i % 2 ? 'A' : 'B', angle: 'promo', promo: i % 3 === 0, captured_at: dayAgo(i % 10), title: 't' });
  }
  const email = competitor.summarize(rows).email;
  expect(email.cadence_per_brand_per_week).toBeGreaterThan(5);
  expect(email.observed_span_days).toBeGreaterThan(7);
  expect(email.cadence_basis).toMatch(/observed days/);
});

test('a capture window too short for a weekly rate returns null, not a small number', () => {
  const competitor = require('../api/_shared/brain-competitor.js');
  const rows = [
    { channel: 'email', brand: 'A', captured_at: new Date().toISOString() },
    { channel: 'email', brand: 'A', captured_at: new Date(Date.now() - DAY).toISOString() },
  ];
  const email = competitor.summarize(rows).email;
  expect(email.cadence_per_brand_per_week).toBeNull();
  expect(email.cadence_basis).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
});

// ── Projections: the assumption travels with the number ─────────────────────

test('a projection built on the fallback AOV declares itself modelled', () => {
  const benchmark = SM.buildEngine1Benchmark({}, 'US');
  expect(benchmark.valuePerConvBasis).toBe('assumed');

  const projection = SM.projectMetrics(
    [{ date: '2026-09-01', segment: 'Champions', segment_size: 1000 }],
    SM.SCENARIO_LEVERS.medium, benchmark,
  );
  expect(projection.projection_basis).toBe('modelled');
  expect(projection.value_per_conversion_basis).toBe('assumed');
  expect(projection.assumptions.join(' ')).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
  // The VALUE has to be visible, not just the word "DEFAULTS".
  expect(projection.assumptions.join(' ')).toContain(String(projection.value_per_conversion));
});

test('a projection built on measured inputs is not labelled modelled', () => {
  const benchmark = SM.buildEngine2Benchmark(
    { channelBenchmarks: { email: { avgConversionRate: 0.011, avgClickRate: 0.022 }, meta: { avgRoas: 2.4 } } },
    'US', 400,
  );
  expect(benchmark.ratesBasis).toBe('measured');
  const projection = SM.projectMetrics(
    [{ date: '2026-09-01', cohort: { name: 'Champions', size: 1000 }, channels: ['email'] }],
    SM.SCENARIO_LEVERS.medium, benchmark,
  );
  // The conversion value is still a modelled split of a measured LTV, so the
  // projection stays honest about being derived rather than fully measured.
  expect(projection.value_per_conversion_basis).toBe('derived');
  expect(projection.assumptions.join(' ')).toMatch(/first-order share is a planning constant/i);
});

test('a revenue forecast names the inputs it assumed', () => {
  const model = require('../api/_shared/revenue-model.js');
  const day = model.forecastDay({ date: '2026-09-01', sends: [{ cohort: 'Champions', recipients: 20000 }] });
  expect(day.basis).toBe('modelled');
  expect(day.assumed_inputs).toEqual(expect.arrayContaining(['aov', 'clickRate', 'closeRate']));
  expect(day.sends[0].note).toMatch(/DATA REQUIRED BEFORE LAUNCH/);

  const measured = model.forecastDay({ date: '2026-09-01', sends: [{ cohort: 'Champions', recipients: 20000, aov: 157.37, clickRate: 0.02, closeRate: 0.04 }] });
  expect(measured.basis).toBe('measured');
  expect(measured.assumed_inputs).toEqual([]);
});
