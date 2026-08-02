'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// 5-scenario calendar presenter — a thin, DETERMINISTIC adapter over the single
// canonical engine in scenario-model.js. (Reconciled: this file no longer has
// its own scenario logic or any LLM-fabricated numbers — projections come from
// the same pure projectMetrics() the Smart Brain rolling plan uses, so the
// agentic flow, the /api/brain?action=calendar-scenarios route, and the rolling
// plan all agree on the numbers.)
//
//   best / medium (default, goes live) / conservative / emergency / instant
//
// Same public API as before (buildScenarios) so callers need no change.
// ─────────────────────────────────────────────────────────────────────────────

const SM = require('./scenario-model.js');

function avgCohortLtv(analysis) {
  const cs = (analysis && analysis.cohorts) || [];
  const vals = cs.map((c) => Number(c.avgLtv || c.avg_ltv || 0)).filter((n) => n > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

// Build the scenario's plan rows from the base calendar: cap to the scenario's
// horizon and restrict each row's channels to the scenario's channel mix. The
// response-band differentiation (P75/P50/P25/floor) is applied inside
// projectMetrics() via the lever's responseMultiplier — pure + deterministic.
function planRowsForScenario(entries, L, minTime) {
  const horizonMs = (L.horizonDays || 30) * 86400000;
  return entries
    .filter((e) => { const t = Date.parse(e.date); return !Number.isFinite(t) || !Number.isFinite(minTime) || (t - minTime) <= horizonMs; })
    .map((e) => ({
      date: e.date,
      cohort: e.cohort || { name: e.segment || 'all', size: e.segment_size || e.audience_size || 0 },
      channels: Array.isArray(e.channels) ? e.channels.filter((c) => L.channelMix.includes(c)) : L.channelMix.slice(),
    }));
}

function spendLabel(spendIndex) {
  if (spendIndex === 0) return 'none';
  if (spendIndex < 1) return 'reduced';
  if (spendIndex > 1) return 'elevated';
  return 'normal';
}

/**
 * buildScenarios({ analysis, baseCalendar, market, tier }) → { ok, default, scenarios[] }
 * `tier` is accepted for API compatibility but does NOT change the numbers
 * (projections are deterministic — the LLM never alters them).
 */
async function buildScenarios({ analysis = {}, baseCalendar = {}, market = 'US' } = {}) {
  const entries = Array.isArray(baseCalendar.entries) ? baseCalendar.entries : [];
  const benchmark = SM.buildEngine2Benchmark(analysis, market, avgCohortLtv(analysis));
  let minTime = Infinity;
  for (const e of entries) { const t = Date.parse(e.date); if (Number.isFinite(t) && t < minTime) minTime = t; }

  const scenarios = SM.SCENARIO_LABELS.map((key) => {
    const L = SM.SCENARIO_LEVERS[key];
    const profile = (SM.SCENARIO_PROFILES && SM.SCENARIO_PROFILES[key]) || { label: key };
    const rows = planRowsForScenario(entries, L, minTime);
    const p = SM.projectMetrics(rows, L, benchmark);
    return {
      key,
      label: SM.sanitizeBrand(profile.display_name || key),
      assumptions: SM.sanitizeBrand(profile.one_liner || ''),
      assumption_list: (profile.assumptions || []).map((a) => SM.sanitizeBrand(a)),
      cadenceMultiplier: L.cadenceMultiplier,
      cadencePerWeek: Math.max(1, Math.round((L.cadenceMultiplier || 1) * 4)), // ~4/wk medium baseline, for display
      channelMix: L.channelMix,
      spend: spendLabel(L.spendIndex),
      productStrategy: L.productStrategy,
      segmentFocus: L.segmentFocus,
      horizonDays: L.horizonDays,
      projected: {
        revenueIndex: null, // filled below, relative to medium = 100
        totalRevenue: p.projected_total_revenue,
        conversions: p.projected_conversions,
        responseBand: p.response_band,
        sends: p.sends_planned,
        blendedRoas: p.blended_roas,
        bound: p.bound,
      },
    };
  });

  // revenueIndex relative to medium = 100 (deterministic)
  const med = scenarios.find((s) => s.key === 'medium');
  const baseRev = med && med.projected.totalRevenue > 0 ? med.projected.totalRevenue : 0;
  for (const s of scenarios) {
    s.projected.revenueIndex = baseRev > 0 ? Math.round((s.projected.totalRevenue / baseRev) * 100) : null;
  }

  return { ok: true, provider: 'scenario-model', engine: 'deterministic', default: 'medium', scenarios };
}

module.exports = { buildScenarios, SCENARIOS: SM.SCENARIO_LABELS };
