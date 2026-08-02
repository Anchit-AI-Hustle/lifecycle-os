'use strict';
/**
 * Engine 2 (Smart Brain rolling plan) scenario tests.
 * Run with Supabase env cleared to force the deterministic local-fallback path:
 *   env -u SUPABASE_URL -u SUPABASE_ANON_KEY ... node scripts/_test-scenarios-brain.js
 */
const path = require('path');
const SM = require(path.join('..', 'api', '_shared', 'scenario-model.js'));
const plan = require(path.join('..', 'api', '_shared', 'smart-brain-plan.js'));

const BANNED = /streetwear journey|\btransform\b|liquid lava|game[\s-]?changer|LIMITED TIME|hurry|don'?t miss out|last chance|while supplies last/i;

let failures = 0;
function ok(cond, msg) { if (cond) { console.log('  ✓', msg); } else { console.error('  ✗', msg); failures++; } }
function finiteAll(o) { return Object.values(o).every((v) => typeof v !== 'number' || Number.isFinite(v)); }

(async () => {
  console.log('Engine 2 / scenario-model unit tests');

  // A) Engine-2 benchmark guards against empty channelBenchmarks
  const bEmpty = SM.buildEngine2Benchmark({ channelBenchmarks: {} }, 'US', 0);
  ok(bEmpty.source === 'DEFAULTS', 'buildEngine2Benchmark falls back to DEFAULTS on empty benchmarks');
  ok(bEmpty.conversionRate === 0.006 && bEmpty.paidRoas === 1.6, 'default conversion/ROAS applied');
  const bLive = SM.buildEngine2Benchmark({ channelBenchmarks: { email: { avgConversionRate: 0.02, avgClickRate: 0.03 }, meta: { avgRoas: 3.1 } } }, 'US', 120);
  ok(bLive.source === 'live-channelBenchmarks' && bLive.conversionRate === 0.02 && bLive.paidRoas === 3.1, 'live channel benchmarks used when present');
  ok(bLive.valuePerConv === SM.DEFAULTS.LTV_FIRST_ORDER_SHARE * 120, 'valuePerConv = avgLtv × first-order share');

  // B) emergency projection: zero paid, null roas, floor flag, finite
  const row = { cohort: { name: 'Champions', size: 1000 }, channels: ['email', 'landing_page'], date: '2026-07-01' };
  const em = SM.projectMetrics([row], SM.SCENARIO_LEVERS.emergency, bEmpty);
  ok(em.projected_paid_spend === 0, 'emergency paid spend = 0');
  ok(em.blended_roas === null, 'emergency blended_roas null (not Infinity)');
  ok(em.retention_floor === true && em.bound === 'lower', 'emergency floor flags');
  ok(finiteAll(em), 'emergency metrics finite');

  // C) best projection: paid present, upper bound
  const paidRow = { cohort: { name: 'Champions', size: 1000 }, channels: ['email', 'meta', 'google'], date: '2026-07-01' };
  const be = SM.projectMetrics([paidRow], SM.SCENARIO_LEVERS.best, bLive);
  ok(typeof be.blended_roas === 'number' && be.blended_roas > 0, 'best blended_roas computed');
  ok(be.bound === 'upper' && be.optimistic_upper_bound === true, 'best upper-bound flags');
  ok(finiteAll(be), 'best metrics finite');

  // D) stripInternal removes projection/plumbing keys
  const stripped = SM.stripInternal({ id: 'x', cohort: { name: 'A' }, projected_metrics: { a: 1 }, standby: {}, levers: {}, active_scenario: 'emergency', scenario_projections: {}, __medium_snapshot: {} });
  ok(stripped.id === 'x' && stripped.cohort, 'stripInternal keeps operational fields');
  ok(!('projected_metrics' in stripped) && !('standby' in stripped) && !('levers' in stripped) && !('active_scenario' in stripped) && !('scenario_projections' in stripped) && !('__medium_snapshot' in stripped), 'stripInternal removes all internal keys');

  // E) activateScenario validation + no-DB graceful skip
  let threw = false;
  try { await plan.activateScenario({ scenario: 'bogus' }); } catch (_) { threw = true; }
  ok(threw, 'activateScenario rejects unknown scenario');

  // F) attachScenarioLayer wiring (DB-independent) — medium active + 4 standby pre-staged
  const ctx = {
    analysis: {
      cohorts: [{ name: 'Champions', avgLtv: 180 }, { name: 'At-Risk', avgLtv: 60 }],
      productScores: [
        { product: { sku: 'DRJ-100', title: 'Jordan Summer Black' }, winningMentions: 3 },
        { product: { sku: 'WHT-600', title: 'Silver Tips White' }, winningMentions: 0 },
      ],
      channelBenchmarks: { email: { avgConversionRate: 0.015, avgClickRate: 0.02 }, meta: { avgRoas: 2.4 } },
    },
  };
  const entry = {
    id: 'cal_2026-07-01_us', date: '2026-07-01', market: 'US',
    cohort: { name: 'Champions', size: 800 }, channels: ['email', 'meta', 'google', 'landing_page'],
    objective: 'premium bundle expansion', heroProduct: { sku: 'DRJ-100', title: 'Jordan Summer Black' },
  };
  const cohortLtv = { Champions: 180, 'At-Risk': 60 };
  plan.attachScenarioLayer(entry, ctx, cohortLtv);
  ok(entry.active_scenario === 'medium', 'attachScenarioLayer: active scenario is medium');
  ok(['best', 'conservative', 'emergency', 'instant'].every((l) => entry.standby[l]), 'all 4 standby scenarios pre-staged');
  ok(Object.keys(entry.scenario_projections).length === 5, 'scenario_projections covers all 5 scenarios');
  ok(entry.standby.emergency.channels.every((c) => c === 'email' || c === 'landing_page'), 'emergency standby = owned channels only');
  ok(entry.standby.emergency.projected_metrics.projected_paid_spend === 0, 'emergency standby zero paid spend');
  ok(entry.standby.emergency.status === 'dormant', 'emergency standby is dormant');
  ok(entry.standby.best.heroProduct.sku === 'WHT-600', 'best (launch-push) picks the under-promoted SKU');
  ok(entry.standby.instant.heroProduct.sku === 'DRJ-100', 'instant (bestseller-only) picks the top product');
  ok(!BANNED.test(JSON.stringify(entry)), 'no banned phrase in enriched entry');

  // G) promoteScenario switch + lossless revert
  const payload = JSON.parse(JSON.stringify(entry));
  plan.promoteScenario(payload, 'emergency');
  ok(payload.active_scenario === 'emergency', 'promoteScenario sets active=emergency');
  ok(payload.channels.every((c) => c === 'email' || c === 'landing_page'), 'promote merges emergency channels onto top level');
  ok(payload.__medium_snapshot && payload.__medium_snapshot.channels.includes('meta'), 'medium snapshot captured for lossless revert');
  plan.promoteScenario(payload, 'medium');
  ok(payload.active_scenario === 'medium' && payload.channels.includes('meta') && !payload.__medium_snapshot, 'revert to medium restores channels and clears snapshot');

  // H) effectiveEntry merges active variant + strips internal keys
  const switched = JSON.parse(JSON.stringify(entry)); switched.active_scenario = 'emergency';
  const eff = plan.effectiveEntry(switched);
  ok(eff.channels.every((c) => c === 'email' || c === 'landing_page'), 'effectiveEntry uses active emergency channels');
  ok(!('standby' in eff) && !('projected_metrics' in eff) && !('scenario_projections' in eff) && !('active_scenario' in eff), 'effectiveEntry strips internal keys before asset generation');
  ok(eff.id === entry.id && eff.cohort, 'effectiveEntry keeps operational fields');

  console.log(failures ? `\nFAILED: ${failures} assertion(s)` : '\nALL ENGINE-2 TESTS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
