'use strict';

/**
 * Calendar SCENARIO MODEL — single source of truth (v1).
 *
 * The calendar generator no longer emits one plan; it emits 4–5 SCENARIO
 * plans, each driven by a different set of levers (cadence, spend, channel
 * mix, creative risk, product strategy, targets, segment focus) and shipping
 * with its own assumptions + grounded projected metrics.
 *
 * This module is intentionally an `api/_shared/` underscore module so it is
 * EXCLUDED from Vercel's 12-function count. It is require()d by BOTH calendar
 * engines so the levers + projection math are defined exactly once:
 *   - api/_shared/calendar-generate.js   (Engine 1 — deterministic ?action=generate)
 *   - api/_shared/smart-brain-plan.js    (Engine 2 — rolling Smart Brain plan)
 *
 * Design contracts:
 *   - `medium` is the IDENTITY transform: building the medium scenario must
 *     reproduce today's exact deterministic output. It is the DEFAULT that goes
 *     live and the active Smart Brain rolling plan. best/conservative/emergency/
 *     instant are variations of it.
 *   - `projectMetrics()` is a PURE function (no network, no Date.now, no random)
 *     that never returns NaN/Infinity. Numbers move only via real plan size ×
 *     real audience sizes × published constants × scenario multipliers — fully
 *     reproducible, zero hallucination. best is flagged as an optimistic UPPER
 *     bound; emergency as a retention FLOOR.
 *   - Scenario data is INTERNAL ONLY (it carries revenue/spend projections).
 *     `INTERNAL_KEYS` / `stripInternal()` keep those numbers out of any buyer-
 *     facing asset builder.
 */

const CONSTANTS_VERSION = 'cal-scenarios.v1';

// Fixed canonical order. Labels are a stable contract used across both engines,
// the response shape, and the persisted payload.standby map.
const SCENARIO_LABELS = ['best', 'medium', 'conservative', 'emergency', 'instant'];

// Channels that imply paid spend (everything else is owned/organic).
const PAID_CHANNELS = new Set(['meta', 'google', 'tiktok']);

// ── Benchmark constants (the ONLY response-rate magic in the system) ─────────
// These mirror lib/smart-brain/services.js DEFAULT_CONFIG.performanceThresholds
// verbatim, so the projection layer introduces no new assumptions — it reuses
// the engine's own P50 thresholds as the median band, then applies the scenario
// responseMultiplier to shift it to the P75 (best) / P25 (conservative) bands.
const DEFAULTS = {
  EMAIL_CONVERSION_RATE: 0.006,    // services email.conversionRate
  EMAIL_REV_PER_RECIPIENT: 0.08,   // services email.revenuePerRecipient (reference anchor)
  EMAIL_CLICK_RATE: 0.018,         // services email.clickRate
  PAID_ROAS: 1.6,                  // services meta.roas
  DEFAULT_PAID_SPEND_PER_PAID_ROW: 50,  // $ notional paid spend per paid-supported plan row at spendIndex 1.0
  FATIGUE_DECAY: 0.85,             // k-th repeat send to a segment in a week weighted by 0.85^(k-1)
  SEGMENT_SEND_CEILING: 4,         // hard cap on sends to ONE segment per week (deliverability guard)
  AOV_FALLBACK_BY_MARKET: { US: 42, UK: 38, Global: 40, IN: 18, EU: 40, AU: 40 },
  LTV_FIRST_ORDER_SHARE: 0.35,     // Engine 2 only: share of cohort.avgLtv credited to a single send
  VALUE_PER_CONV_CLAMP: [10, 300],
};

// ── Scenario levers (concrete, numeric) ─────────────────────────────────────
// cadenceMultiplier : scales per-market weekly capacity AND per-segment cadence
// horizonDays       : >=30 means "use the full requested horizon"; <30 caps it
// spendIndex        : relative paid spend (medium = 1.0; emergency = 0)
// channelMix        : channels this scenario runs (emergency = owned only)
// creativeRisk      : high | moderate | low | none — informs archetype/creative selection
// productStrategy   : launch-push | current | bestseller-only — informs hero pick
// targetMultiplier  : headline target band (== responseMultiplier, kept explicit)
// segmentFocus      : all | high-value | retention-only | high-intent
// responseMultiplier: response band applied to projected metrics (P75/P50/P25/floor)
const SCENARIO_LEVERS = {
  best: {
    label: 'best',
    cadenceMultiplier: 1.5, horizonDays: 30, spendIndex: 1.6,
    channelMix: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
    creativeRisk: 'high', productStrategy: 'launch-push',
    targetMultiplier: 1.3, segmentFocus: 'all', responseMultiplier: 1.3,
  },
  medium: {
    label: 'medium',
    cadenceMultiplier: 1.0, horizonDays: 30, spendIndex: 1.0,
    channelMix: ['email', 'meta', 'google', 'landing_page'],
    creativeRisk: 'moderate', productStrategy: 'current',
    targetMultiplier: 1.0, segmentFocus: 'all', responseMultiplier: 1.0,
  },
  conservative: {
    label: 'conservative',
    cadenceMultiplier: 0.75, horizonDays: 30, spendIndex: 0.6,
    channelMix: ['email', 'meta', 'google', 'landing_page'],
    creativeRisk: 'low', productStrategy: 'bestseller-only',
    targetMultiplier: 0.75, segmentFocus: 'high-value', responseMultiplier: 0.75,
  },
  emergency: {
    label: 'emergency',
    cadenceMultiplier: 0.5, horizonDays: 14, spendIndex: 0.0,
    channelMix: ['email', 'landing_page'],
    creativeRisk: 'none', productStrategy: 'bestseller-only',
    targetMultiplier: 0.45, segmentFocus: 'retention-only', responseMultiplier: 0.45,
  },
  instant: {
    label: 'instant',
    cadenceMultiplier: 1.25, horizonDays: 7, spendIndex: 1.2,
    channelMix: ['email', 'meta', 'google', 'landing_page'],
    creativeRisk: 'low', productStrategy: 'bestseller-only',
    targetMultiplier: 1.15, segmentFocus: 'high-intent', responseMultiplier: 1.15,
  },
};

// ── Scenario profiles (hand-authored, pre-vetted brand-clean) ───────────────
// display_name / one_liner / assumptions are the operator-facing rationale.
// They never contain a banned phrase; sanitizeBrand() is applied at emit time
// as a tripwire in case a future edit drifts.
const SCENARIO_PROFILES = {
  best: {
    label: 'best',
    display_name: 'Best Case — Aggressive Growth',
    one_liner: 'Everything-goes-right upper bound: max safe cadence, premium and new-launch creative, stretch paid spend across all markets. Reported as an optimistic ceiling, never a committed target.',
    assumptions: [
      'Deliverability is healthy and the list can absorb ~50% more send volume without meaningful open-rate decay.',
      'Paid budget is approved at ~1.6x baseline and channels are not CPM-constrained; ROAS holds near the trailing average.',
      'At least one new-launch or under-promoted hero SKU is in stock across the horizon.',
      'Response rates land at the optimistic (P75) band, not the median.',
      'Creative can produce premium variants at the higher cadence.',
    ],
  },
  medium: {
    label: 'medium',
    display_name: 'Medium — Realistic Baseline (default, goes live)',
    one_liner: 'The proven balanced plan that ships: median response rates, sustainable cadence, balanced channel mix. This is the default that goes live and the active rolling plan.',
    assumptions: [
      'Response rates land at the historical median (P50).',
      'Deliverability and budget are nominal with no shocks.',
      'Cadence stays at the sustainable baseline (per-market weekly capacity unchanged).',
      'This is the scenario mirrored to the legacy top-level fields and run as the active Smart Brain plan.',
    ],
  },
  conservative: {
    label: 'conservative',
    display_name: 'Conservative — Margin-Protecting Hedge',
    one_liner: 'Soft-performance hedge that still spends: lower cadence, bestsellers only, paid trimmed to ~0.6x and reallocated to efficient retargeting and search, protecting contribution margin and list health.',
    assumptions: [
      'Response rates are assumed at the pessimistic (P25) band.',
      'Margins are under pressure or recent engagement is soft; protect deliverability and contribution margin over top line.',
      'No new-launch dependency — rely on proven high-converters only.',
      'Paid is trimmed but not frozen; below-threshold paid is cut.',
    ],
  },
  emergency: {
    label: 'emergency',
    display_name: 'Emergency — Zero-New-Spend Retention Floor (pre-staged, dormant)',
    one_liner: 'Worst-case break contingency (deliverability crash, budget freeze, or supply issue): retention-only evergreen owned flows, near-zero new paid, reputation-safe suppression. Pre-staged and dormant; promoted only by an explicit human switch.',
    assumptions: [
      'A break has occurred or is being hedged: paid is frozen, sender reputation is degraded, or hero supply is out of stock.',
      'Only owned channels and already-running evergreen flows remain — no new creative production required.',
      'Projected revenue is a floor, not a target: what the owned base produces with minimal touches and no acquisition.',
      'Reactivation pushes are suppressed to defend deliverability; only the engaged core is contacted.',
    ],
  },
  instant: {
    label: 'instant',
    display_name: 'Instant Win — Fast Revenue Now (pre-staged, dormant)',
    one_liner: 'Quick-win deploy-today push: a 7-day horizon of flash, bestseller, and cart-abandon sends to proven high-converters on warm, high-intent audiences, with concentrated retargeting spend for the fastest payback.',
    assumptions: [
      'Revenue is needed inside about 7 days; spend is concentrated on warm, high-intent audiences.',
      'Only proven high-converting creative and offers are used — no production lead time.',
      'Highest-intent segments and retargeting pools are addressable immediately.',
      'Inventory exists for the chosen bestseller or flash SKU.',
    ],
  },
};

// ── small numeric helpers (local, dependency-light) ─────────────────────────
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function fin(n) { return Number.isFinite(n) ? n : 0; }
function round(n, digits = 0) { const f = fin(+n); return Number(f.toFixed(digits)); }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function scenarioLevers(label) {
  return SCENARIO_LEVERS[label] || SCENARIO_LEVERS.medium;
}

// Full requested horizon when horizonDays >= 30; otherwise cap (instant=7, emergency=14).
function scenarioDays(levers, requestedDays) {
  const req = Math.max(1, num(requestedDays, 30));
  return levers.horizonDays >= 30 ? req : Math.min(req, levers.horizonDays);
}

// Per-MARKET weekly send capacity. Scales freely with cadence — NOT clamped to
// the per-segment ceiling (those are different axes: capacity = sends/market/week
// across all segments; SEGMENT_SEND_CEILING = sends to one segment/week).
function effectiveCapacity(levers, baseCapacity) {
  return Math.max(1, Math.round(num(baseCapacity, 4) * num(levers.cadenceMultiplier, 1)));
}

// Per-SEGMENT weekly cadence table, scaled by the lever and capped at the
// deliverability ceiling. medium (×1.0) returns the base table unchanged.
function scaleCadence(baseTable, levers) {
  const mult = num(levers.cadenceMultiplier, 1);
  const out = {};
  for (const [k, v] of Object.entries(baseTable || {})) {
    out[k] = v <= 0 ? 0 : clamp(Math.round(v * mult), 0, DEFAULTS.SEGMENT_SEND_CEILING);
  }
  return out;
}

// Filter a segment/cohort name list by the scenario's segmentFocus. Works across
// BOTH segment taxonomies (Engine 1: Champions/Loyal/Promising/New/Need-Attention/
// At-Risk/Hibernating; Engine 2 cohorts: Champions/Loyalists/New Buyers/Winback/
// At-Risk/Nurture) via pattern matching. Never returns an empty list — if a focus
// filters everything out it falls back to the full list (so no scenario ships an
// empty plan).
const RX_HIGH_VALUE = /champion|loyal|promising|vip|high.?ltv/i;
const RX_REACTIVATION = /at.?risk|hibernat|sleep|winback|win-back|lost|dormant/i;
const RX_HIGH_INTENT = /champion|loyal|promising|new|need.?att|cart|browse|intent/i;
function eligibleSegments(allNames, levers) {
  const names = Array.isArray(allNames) ? allNames.slice() : [];
  const focus = levers.segmentFocus || 'all';
  if (focus === 'all') return names;
  let filtered;
  if (focus === 'high-value') {
    filtered = names.filter((n) => RX_HIGH_VALUE.test(n));
  } else if (focus === 'retention-only') {
    filtered = names.filter((n) => RX_HIGH_VALUE.test(n) && !RX_REACTIVATION.test(n));
  } else if (focus === 'high-intent') {
    filtered = names.filter((n) => RX_HIGH_INTENT.test(n) && !/lost|hibernat/i.test(n));
  } else {
    filtered = names;
  }
  return filtered.length ? filtered : names;
}

// ── Benchmark builders (each engine supplies its own grounded inputs) ────────

// Engine 1 has no live performance data — derive an AOV from the analytics
// product/segment revenue so the conversion value is grounded, not invented.
function deriveAOV(analytics, market) {
  const a = analytics || {};
  const products = Array.isArray(a.products) ? a.products : [];
  const segments = Array.isArray(a.segments) ? a.segments : [];
  const [lo, hi] = DEFAULTS.VALUE_PER_CONV_CLAMP;
  const pRev = products.reduce((s, p) => s + num(p.revenue), 0);
  const pUnits = products.reduce((s, p) => s + num(p.units), 0);
  if (pUnits > 0 && pRev > 0) return clamp(pRev / pUnits, lo, hi);
  const sRev = segments.reduce((s, x) => s + num(x.revenue), 0);
  const sCount = segments.reduce((s, x) => s + num(x.count), 0);
  if (sCount > 0 && sRev > 0) return clamp(sRev / sCount, lo, hi);
  return clamp(DEFAULTS.AOV_FALLBACK_BY_MARKET[market] || 40, lo, hi);
}

function buildEngine1Benchmark(analytics, market) {
  return {
    conversionRate: DEFAULTS.EMAIL_CONVERSION_RATE,
    revPerRecipient: DEFAULTS.EMAIL_REV_PER_RECIPIENT,
    clickRate: DEFAULTS.EMAIL_CLICK_RATE,
    paidRoas: DEFAULTS.PAID_ROAS,
    valuePerConv: deriveAOV(analytics, market),
    source: 'DEFAULTS',
  };
}

// Engine 2 has live channel benchmarks (AnalysisService.channelBenchmarks) and
// per-cohort LTV — use them when present, fall back to the same DEFAULTS when not.
// Guarded against an empty {} channelBenchmarks object.
function buildEngine2Benchmark(analysis, market, cohortAvgLtv) {
  const cb = (analysis && analysis.channelBenchmarks) || {};
  const email = cb.email || {};
  const meta = cb.meta || {};
  const live = num(email.avgConversionRate) > 0;
  const [lo, hi] = DEFAULTS.VALUE_PER_CONV_CLAMP;
  const valuePerConv = num(cohortAvgLtv) > 0
    ? clamp(num(cohortAvgLtv) * DEFAULTS.LTV_FIRST_ORDER_SHARE, lo, hi)
    : clamp(DEFAULTS.AOV_FALLBACK_BY_MARKET[market] || 40, lo, hi);
  return {
    conversionRate: live ? num(email.avgConversionRate) : DEFAULTS.EMAIL_CONVERSION_RATE,
    revPerRecipient: DEFAULTS.EMAIL_REV_PER_RECIPIENT,
    clickRate: num(email.avgClickRate) > 0 ? num(email.avgClickRate) : DEFAULTS.EMAIL_CLICK_RATE,
    paidRoas: num(meta.avgRoas) > 0 ? num(meta.avgRoas) : DEFAULTS.PAID_ROAS,
    valuePerConv,
    source: live ? 'live-channelBenchmarks' : 'DEFAULTS',
  };
}

// ── The single projection function (pure, reused by both engines) ───────────
//
// plan      : the scenario's already-built rows.
//             Engine 1 rows look like { date, segment, segment_size }.
//             Engine 2 rows look like { date, cohort:{name,size}, channels[] }.
// levers    : SCENARIO_LEVERS[label]
// benchmark : buildEngine1Benchmark() / buildEngine2Benchmark()
//
// Owned (email) revenue is fatigue-dampened so extra cadence does not credit
// linearly: the k-th send to a segment in a week is weighted FATIGUE_DECAY^(k-1),
// capped at SEGMENT_SEND_CEILING effective sends/segment/week. Paid is an
// indicative planning overlay (notional spend/row × spendIndex × ROAS), tagged
// as such and zeroed when the channel mix carries no paid channel.
function projectMetrics(plan, levers, benchmark) {
  const rows = Array.isArray(plan) ? plan : [];
  const L = levers || SCENARIO_LEVERS.medium;
  const B = benchmark || buildEngine1Benchmark({});
  const mult = num(L.responseMultiplier, 1);
  const channelMixHasPaid = (L.channelMix || []).some((c) => PAID_CHANNELS.has(c));

  // earliest date anchors weekly bucketing (rows without dates fall in week 0)
  let minTime = Infinity;
  for (const r of rows) {
    const t = r && r.date ? Date.parse(r.date) : NaN;
    if (Number.isFinite(t) && t < minTime) minTime = t;
  }
  if (!Number.isFinite(minTime)) minTime = 0;

  // group rows by segment/cohort → { size, weeks:{wk:count} } + paid row count
  const groups = new Map();
  let paidRows = 0;
  for (const r of rows) {
    if (!r) continue;
    const seg = r.segment || (r.cohort && r.cohort.name) || 'all';
    const size = num(r.segment_size != null ? r.segment_size : (r.cohort && r.cohort.size));
    const t = r.date ? Date.parse(r.date) : NaN;
    const wk = Number.isFinite(t) ? Math.floor((t - minTime) / (7 * 86400000)) : 0;
    const g = groups.get(seg) || { size: 0, weeks: {} };
    g.size = Math.max(g.size, size);
    g.weeks[wk] = (g.weeks[wk] || 0) + 1;
    groups.set(seg, g);
    const isPaid = Array.isArray(r.channels) ? r.channels.some((c) => PAID_CHANNELS.has(c)) : channelMixHasPaid;
    if (isPaid) paidRows += 1;
  }

  // fatigue-weighted effective exposures
  let totalExposures = 0;
  let estRecipients = 0;
  for (const g of groups.values()) {
    estRecipients += g.size;
    let weightSum = 0;
    for (const cnt of Object.values(g.weeks)) {
      const k = Math.min(cnt, DEFAULTS.SEGMENT_SEND_CEILING);
      for (let i = 0; i < k; i++) weightSum += Math.pow(DEFAULTS.FATIGUE_DECAY, i);
    }
    totalExposures += g.size * weightSum;
  }

  const conversions = totalExposures * B.conversionRate * mult;
  const clicks = totalExposures * B.clickRate * mult;
  const ownedRevenue = conversions * B.valuePerConv;
  const paidSpend = paidRows * DEFAULTS.DEFAULT_PAID_SPEND_PER_PAID_ROW * num(L.spendIndex, 1);
  const paidRevenue = paidSpend * B.paidRoas;
  const projectedRevenue = ownedRevenue + paidRevenue;
  const blendedRoas = paidSpend > 0 ? round(projectedRevenue / paidSpend, 2) : null;

  const band = { best: 'P75', medium: 'P50', conservative: 'P25', emergency: 'floor', instant: 'P50+warm' }[L.label] || 'P50';
  const out = {
    scenario: L.label,
    horizon_days: L.horizonDays,
    sends_planned: rows.length,
    est_recipients: round(estRecipients),
    projected_owned_revenue: round(ownedRevenue),
    projected_paid_spend: round(paidSpend),
    projected_paid_revenue: round(paidRevenue),
    projected_total_revenue: round(projectedRevenue),
    projected_conversions: round(conversions),
    projected_clicks: round(clicks),
    blended_roas: blendedRoas,
    response_band: band,
    bound: L.label === 'best' ? 'upper' : L.label === 'emergency' ? 'lower' : 'point',
    basis: `owned: conversions x value-per-conv (${B.source}); paid: indicative planning estimate (spendIndex x notional/row x ROAS)`,
    constants_version: CONSTANTS_VERSION,
    _internal: true,
  };
  if (L.label === 'best') {
    out.optimistic_upper_bound = true;
    out.confidence_low = round(projectedRevenue / 1.6); // conservative haircut so best is never read as a target
  }
  if (L.label === 'emergency') out.retention_floor = true;
  if (L.label === 'instant') out.window_days = 7;
  return out;
}

// ── Brand-safety scrub ──────────────────────────────────────────────────────
// Full CLAUDE.md banned-phrase list (superset of lib/smart-brain/services.js
// safeCopy, which misses game-changer / last chance / while supplies last /
// don't miss out). Applied at emit time to every generated scenario string.
const BANNED_RX = /streetwear journey|liquid lava|game[\s-]?changer|hurry|don'?t miss out|last chance|while supplies last/gi;
const BANNED_TRANSFORM_RX = /\btransform(ing|ed|s|ation)?\b/gi;
const BANNED_CAPS_RX = /LIMITED TIME/g; // caps form specifically

// No em dashes (—) or en dashes (–) in any generated output (product-owner
// rule 2026-07-04). Spaced dashes become " - "; bare dashes become " - " too,
// then double spaces are collapsed so surrounding text stays clean.
function scrubDashes(str) {
  if (str == null) return str;
  return String(str)
    .replace(/\s[—–]\s/g, ' - ')
    .replace(/[—–]/g, ' - ')
    .replace(/ {2,}/g, ' ');
}

function sanitizeBrand(str) {
  if (str == null) return str;
  return scrubDashes(String(str)
    .replace(BANNED_CAPS_RX, 'time-bound')
    .replace(BANNED_RX, 'premium daily ritual')
    .replace(BANNED_TRANSFORM_RX, 'restore'))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Dev-only tripwire: throw outside production if a banned phrase survives, so a
// future edit to the static profiles can't silently reintroduce one.
const ALL_BANNED_RX = /streetwear journey|\btransform\b|liquid lava|game[\s-]?changer|LIMITED TIME|hurry|don'?t miss out|last chance|while supplies last/i;
function assertNoBanned(str, where = '') {
  if (str == null) return;
  if (process.env.VERCEL_ENV !== 'production' && ALL_BANNED_RX.test(String(str))) {
    throw new Error(`[scenario-model] banned phrase in ${where}: ${String(str).slice(0, 120)}`);
  }
}

// ── Internal-only key protection ────────────────────────────────────────────
// Keys carrying revenue/spend projections or scenario plumbing. They must be
// stripped from any object handed to a buyer-facing asset builder (lpHtml /
// emailHtml / ad builders) so projected numbers can never leak into creative.
const INTERNAL_KEYS = new Set([
  'projected_metrics', 'scenario_projections', 'spend_index', 'target_multiplier',
  'baseline_paid', 'standby', 'levers', '__medium_snapshot', 'active_scenario',
  'scenario_model_version',
]);
function stripInternal(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? obj.slice() : { ...obj };
  for (const k of INTERNAL_KEYS) delete out[k];
  return out;
}

module.exports = {
  CONSTANTS_VERSION,
  SCENARIO_LABELS,
  PAID_CHANNELS,
  DEFAULTS,
  SCENARIO_LEVERS,
  SCENARIO_PROFILES,
  scenarioLevers,
  scenarioDays,
  effectiveCapacity,
  scaleCadence,
  eligibleSegments,
  deriveAOV,
  buildEngine1Benchmark,
  buildEngine2Benchmark,
  projectMetrics,
  sanitizeBrand,
  scrubDashes,
  assertNoBanned,
  INTERNAL_KEYS,
  stripInternal,
};
