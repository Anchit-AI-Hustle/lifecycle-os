'use strict';
/**
 * Local verification harness for the calendar scenario model.
 * Not a Vercel function (scripts/, underscore-prefixed). Run: node scripts/_test-scenarios.js
 * Exercises Engine 1 (?action=generate) end-to-end with a fixed seed analytics
 * + the scenario-model projection function directly. Exits non-zero on failure.
 */
const path = require('path');
const generate = require(path.join('..', 'api', '_shared', 'calendar-generate.js'));
const SM = require(path.join('..', 'api', '_shared', 'scenario-model.js'));

const BANNED = /wellness journey|\btransform\b|liquid gold|game[\s-]?changer|LIMITED TIME|hurry|don'?t miss out|last chance|while supplies last/i;

const SEED = {
  segments: [
    { name: 'Champions', count: 480, revenue: 92000 },
    { name: 'Loyal', count: 1200, revenue: 168000 },
    { name: 'Promising', count: 760, revenue: 41000 },
    { name: 'New', count: 900, revenue: 28000 },
    { name: 'Need-Attention', count: 720, revenue: 38000 },
    { name: 'About-to-Sleep', count: 540, revenue: 22000 },
    { name: 'At-Risk', count: 410, revenue: 16000 },
    { name: 'Hibernating', count: 380, revenue: 12000 },
  ],
  products: [
    { sku: 'DRJ-100', title: 'Jordan Summer Black', category: 'Black sneaker', revenue: 38500, units: 1700, promos: 4 },
    { sku: 'CHA-400', title: 'Hand-painted Kicks Classic', category: 'Kicks', revenue: 31200, units: 1450, promos: 5 },
    { sku: 'GFT-900', title: 'Discovery Gift Set', category: 'Gift', revenue: 28100, units: 580, promos: 2 },
    { sku: 'GRN-300', title: 'Signature Green', category: 'Green sneaker', revenue: 21500, units: 980, promos: 3 },
    { sku: 'BLD-810', title: 'Sleep Colorway', category: 'Streetwear', revenue: 18600, units: 700, promos: 1 },
    { sku: 'WHT-600', title: 'Silver Tips White', category: 'White sneaker', revenue: 17200, units: 350, promos: 0 },
  ],
  bestHourByMarket: { US: 14, UK: 9, Global: 6, IN: 4 },
};

function invoke(body) {
  return new Promise((resolve, reject) => {
    const res = {
      _status: 200,
      setHeader() {}, status(c) { this._status = c; return this; },
      json(obj) { resolve({ status: this._status, body: obj }); return this; },
      end() { resolve({ status: this._status, body: null }); return this; },
    };
    Promise.resolve().then(() => generate({ method: 'POST', body, query: {} }, res)).catch(reject);
  });
}

let failures = 0;
function ok(cond, msg) { if (cond) { console.log('  ✓', msg); } else { console.error('  ✗', msg); failures++; } }
function findScenario(scenarios, label) { return scenarios.find((s) => s.label === label); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function hasBadNumber(obj) {
  for (const v of Object.values(obj)) {
    if (typeof v === 'number' && !Number.isFinite(v)) return true;
  }
  return false;
}

(async () => {
  console.log('Engine 1 (?action=generate) scenario tests');
  const body = { start_date: '2026-07-01', days: 30, markets: ['US', 'UK', 'Global'], capacity_per_market_per_week: 4, analytics: SEED };
  const r1 = await invoke(body);
  ok(r1.status === 200, 'returns 200');
  const d = r1.body;

  // (a) backward-compat top-level fields
  ok(Array.isArray(d.plan), 'top-level data.plan is an array');
  ok(d.meta && d.meta.archetype_distribution, 'top-level data.meta.archetype_distribution exists');
  ok(typeof d.total_sends_planned === 'number', 'top-level data.total_sends_planned is a number');
  ok(Array.isArray(d.markets) && d.markets.length === 3, 'top-level data.markets preserved');

  // (b) top-level === medium scenario
  const medium = findScenario(d.scenarios, 'medium');
  ok(!!medium, 'medium scenario present');
  ok(d.plan === medium.plan, 'top-level plan IS the medium scenario plan (same reference)');
  ok(d.total_sends_planned === medium.total_sends_planned, 'top-level total === medium total');
  ok(deepEqual(d.meta, medium.meta), 'top-level meta deep-equals medium meta');

  // (c) 5 scenarios, correct labels
  ok(d.scenarios.length === 5, 'exactly 5 scenarios');
  ok(deepEqual(d.scenarios.map((s) => s.label), ['best', 'medium', 'conservative', 'emergency', 'instant']), 'labels in canonical order');
  ok(d.default_scenario === 'medium', 'default_scenario is medium');
  ok(d.scenario_model_version === SM.CONSTANTS_VERSION, 'scenario_model_version stamped');

  // (d) deterministic — run twice, identical (ignoring generated_at timestamp)
  const r2 = await invoke(body);
  const strip = (x) => { const c = JSON.parse(JSON.stringify(x.body)); delete c.generated_at; return c; };
  ok(deepEqual(strip(r1), strip(r2)), 'deterministic: two runs produce identical output');

  // (e) best=upper bound / emergency=floor + roas null
  const best = findScenario(d.scenarios, 'best');
  const emergency = findScenario(d.scenarios, 'emergency');
  const instant = findScenario(d.scenarios, 'instant');
  const conservative = findScenario(d.scenarios, 'conservative');
  ok(best.projected_metrics.bound === 'upper', 'best bound = upper');
  ok(best.projected_metrics.optimistic_upper_bound === true, 'best flagged optimistic_upper_bound');
  ok(typeof best.projected_metrics.confidence_low === 'number', 'best carries confidence_low haircut');
  ok(emergency.projected_metrics.bound === 'lower', 'emergency bound = lower');
  ok(emergency.projected_metrics.retention_floor === true, 'emergency flagged retention_floor');
  ok(emergency.projected_metrics.blended_roas === null, 'emergency blended_roas is null (not Infinity)');
  ok(emergency.projected_metrics.projected_paid_spend === 0, 'emergency has zero paid spend');

  // (f) no NaN/Infinity anywhere in projected metrics
  let allFinite = true;
  for (const s of d.scenarios) if (hasBadNumber(s.projected_metrics)) allFinite = false;
  ok(allFinite, 'no NaN/Infinity in any projected_metrics');

  // (g) brand safety across the entire response
  ok(!BANNED.test(JSON.stringify(d)), 'no banned phrase anywhere in the response JSON');

  // (h) lever-driven invariants
  ok(best.total_sends_planned >= medium.total_sends_planned, 'best cadence >= medium cadence (more sends)');
  ok(conservative.total_sends_planned <= medium.total_sends_planned, 'conservative cadence <= medium');
  ok(emergency.days === 14, 'emergency horizon capped to 14 days');
  ok(instant.days === 7, 'instant horizon capped to 7 days');
  ok(emergency.plan.every((p) => /champion|loyal|promising/i.test(p.segment)), 'emergency targets retention core only');
  ok(best.projected_metrics.projected_total_revenue >= medium.projected_metrics.projected_total_revenue, 'best revenue >= medium revenue');
  ok(conservative.projected_metrics.projected_total_revenue <= medium.projected_metrics.projected_total_revenue, 'conservative revenue <= medium revenue');

  // (i) empty-analytics guard preserved
  const rEmpty = await invoke({ analytics: {} });
  ok(rEmpty.status === 400, 'empty analytics → 400 guard preserved');

  // (j) maxpower with no LLM keys falls back gracefully + identical numbers
  const rMax = await invoke({ ...body, tier: 'maxpower' });
  ok(rMax.body.tier === 'maxpower', 'maxpower tier echoed');
  ok(['ok', 'skipped_timeout', 'skipped_error', 'skipped_no_llm'].includes(rMax.body.narrative_status), `narrative_status valid (${rMax.body.narrative_status})`);
  const numbersOnly = (x) => x.scenarios.map((s) => s.projected_metrics);
  ok(deepEqual(numbersOnly(d), numbersOnly(rMax.body)), 'maxpower projected numbers identical to budget (LLM never changes numbers)');

  console.log(failures ? `\nFAILED: ${failures} assertion(s)` : '\nALL ENGINE-1 TESTS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
