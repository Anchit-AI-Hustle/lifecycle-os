'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Output reasoning — the shared "why behind every output" builder.
//
// Every input-driven feature (calendar entries, daily-plan slots, generated
// campaigns / mailers) must ship a COMPLETE, data-grounded analysis of WHY it
// was produced — not a one-line templated string. This module turns the raw
// signals an engine already has (cohort value, product score, festival weight,
// proven own-campaign performance, competitor share, MVT priors, feedback) into
// a single structured `analysis` object and an EXPLAINABLE confidence score.
//
// It is deterministic (no LLM call), so it works on every provider tier —
// including the free ones — and never blocks generation. Engines that also run
// an LLM narrative can attach it as `analysis.narrative`; this module fills the
// grounded skeleton either way.
//
// Shape of the analysis object (stable contract — the UIs render this):
//   {
//     summary:        "one-sentence plain-English reason this output exists",
//     drivers:        [{ signal, value, implication }],   // the data that led here
//     hypothesis:     "If we <do X> for <cohort>, then <metric> should <dir> because <reason>",
//     expected_impact:{ metric, direction, basis },
//     evidence:       { own_campaign, festival, competitor, mvt, data_source, feedback },
//     confidence:     { score, label, factors: [{ label, delta, detail }] }
//   }
// ─────────────────────────────────────────────────────────────────────────────

function round(n, d = 2) { const p = Math.pow(10, d); return Math.round((Number(n) || 0) * p) / p; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function pct(n) { return `${Math.round((Number(n) || 0) * 100)}%`; }
function num(n) { const v = Number(n); return Number.isFinite(v) ? v.toLocaleString('en-US') : null; }
function firstText(...vals) { for (const v of vals) { if (v != null && String(v).trim() !== '') return String(v).trim(); } return ''; }

// ── Explainable confidence ──────────────────────────────────────────────────
// Instead of returning a bare number, return the score AND the factor-by-factor
// breakdown that produced it, so the plan can show WHY a slot is 78% vs 52%.
// `factors` is an array of { when(bool), label, delta, detail } — only the ones
// that fired are kept. `base` is the starting prior.
function explainConfidence(factors = [], base = 0.52) {
  const fired = [];
  let score = base;
  fired.push({ label: 'Baseline planning prior', delta: round(base), detail: 'Starting confidence for any data-backed slot before signals are applied.' });
  for (const f of factors) {
    if (!f || !f.when) continue;
    const delta = round(f.delta || 0);
    score += delta;
    fired.push({ label: f.label, delta, detail: f.detail || '' });
  }
  score = round(clamp(score, 0.05, 0.98));
  return { score, label: confidenceLabel(score), factors: fired };
}

function confidenceLabel(score) {
  if (score >= 0.8) return 'high';
  if (score >= 0.62) return 'moderate';
  return 'exploratory';
}

// ── Calendar / daily-plan entry analysis ─────────────────────────────────────
// Inputs (all optional — the builder degrades gracefully):
//   cohort            { name, size|count, value_rank }
//   product           { title, sku, score, category }
//   festival          { name, weight, tags }
//   ownCampaign       { name, performance }   (a proven winning template being reused)
//   competitor        { channel, benchmark, share } or trendingHooks[]
//   mvt               [{ variable, apply_prior_learning }]
//   channels          ['email','meta',...]
//   objective         string
//   market            string
//   dataSource        'supabase' | 'preview' | 'local-csv-fallback'
//   feedback          { positive, negative }
//   confidence        pre-computed {score,factors} OR raw number (we'll wrap it)
function buildEntryAnalysis(input = {}) {
  const cohort = input.cohort || {};
  const product = input.product || {};
  const festival = input.festival || null;
  const own = input.ownCampaign || null;
  const channels = Array.isArray(input.channels) ? input.channels : [];
  const cohortName = firstText(cohort.name, 'the target cohort');
  const cohortSize = cohort.size != null ? cohort.size : cohort.count;
  const productName = firstText(product.title, product.sku, 'the hero assortment');
  const objective = firstText(input.objective, 'lifecycle conversion');
  const market = firstText(input.market, 'this market');

  // Drivers — the concrete data points that produced this decision.
  const drivers = [];
  drivers.push({
    signal: 'Target cohort',
    value: cohortSize != null ? `${cohortName} · ${num(cohortSize) || cohortSize} profiles` : cohortName,
    implication: cohortImplication(cohortName, cohortSize),
  });
  drivers.push({
    signal: 'Hero product',
    value: product.score != null ? `${productName} (score ${round(product.score)})` : productName,
    implication: product.score != null
      ? 'Ranked top by the analysis engine on recent revenue and margin, so it anchors the offer.'
      : 'Chosen as the offer anchor for this cohort and moment.',
  });
  if (festival && festival.name) {
    drivers.push({
      signal: 'Calendar moment',
      value: `${festival.name}${festival.weight != null ? ` (weight ${festival.weight})` : ''}`,
      implication: (festival.weight || 0) >= 7
        ? 'High-intent seasonal window with historically elevated demand, so timing is deliberate.'
        : 'Seasonal hook that lets the creative lead with a timely reason to open.',
    });
  }
  if (own && (own.name || own.performance)) {
    drivers.push({
      signal: 'Proven pattern reused',
      value: firstText(own.name, 'a prior winning campaign'),
      implication: own.performance
        ? `Cleared performance thresholds previously (${describePerf(own.performance)}), so its structure is reused to de-risk.`
        : 'Cleared performance thresholds previously, so its structure is reused to de-risk.',
    });
  }
  const compDriver = competitorDriver(input.competitor, input.trendingHooks);
  if (compDriver) drivers.push(compDriver);
  if (Array.isArray(input.mvt) && input.mvt.length) {
    const applied = input.mvt.filter((m) => m && m.apply_prior_learning).length;
    drivers.push({
      signal: 'Experiment plan',
      value: `${input.mvt.length} variable${input.mvt.length === 1 ? '' : 's'} under test${applied ? `, ${applied} with prior learning` : ''}`,
      implication: applied
        ? 'Prior MVT learnings are pre-applied so this send compounds on what already worked.'
        : 'A controlled test is attached so the next cycle learns from this send.',
    });
  }
  if (channels.length) {
    drivers.push({
      signal: 'Channel mix',
      value: channels.join(', '),
      implication: channelImplication(channels),
    });
  }

  // Confidence — accept a pre-built breakdown, a raw number, or nothing.
  let confidence = input.confidence;
  if (typeof confidence === 'number') confidence = { score: round(confidence), label: confidenceLabel(confidence), factors: [] };
  if (!confidence) confidence = explainConfidence(defaultConfidenceFactors(input));

  // Hypothesis — a falsifiable, plain-English performance bet.
  const metric = impactMetric(objective, channels);
  const hypothesis = `If we run a ${objective} send to ${cohortName} in ${market} anchored on ${productName}` +
    `${festival && festival.name ? ` timed to ${festival.name}` : ''}, then ${metric} should improve versus a generic send, because ` +
    `${hypothesisReason({ cohortName, own, festival, product })}.`;

  const summary = `Chosen to drive ${objective} for ${cohortName}${cohortSize != null ? ` (${num(cohortSize) || cohortSize} profiles)` : ''}` +
    ` with ${productName}${festival && festival.name ? `, timed to ${festival.name}` : ''}.`;

  return {
    summary,
    drivers,
    hypothesis,
    expected_impact: {
      metric,
      direction: 'up',
      basis: firstText(
        own && own.name && `proven template "${own.name}"`,
        festival && festival.name && `${festival.name} demand window`,
        `cohort-fit offer on ${productName}`
      ),
    },
    evidence: {
      own_campaign: own ? { name: own.name || null, performance: own.performance || null } : null,
      festival: festival && festival.name ? { name: festival.name, weight: festival.weight ?? null, tags: festival.tags || [] } : null,
      competitor: summarizeCompetitor(input.competitor, input.trendingHooks),
      mvt: Array.isArray(input.mvt) ? input.mvt.map((m) => (m && m.variable) || m).filter(Boolean) : [],
      feedback: input.feedback || null,
      data_source: firstText(input.dataSource, 'preview'),
    },
    confidence,
  };
}

// Default confidence factor set — mirrors the historical confidenceFor() logic
// but returns an explainable breakdown. Engines can pass their own instead.
function defaultConfidenceFactors(input = {}) {
  const cohort = input.cohort || {};
  const size = cohort.size != null ? cohort.size : cohort.count;
  const festival = input.festival || null;
  const fb = input.feedback || {};
  return [
    { when: !!input.ownCampaign, label: 'Reuses a proven winning template', delta: 0.18, detail: 'A prior own-campaign winner is being reused, which historically lifts performance.' },
    { when: (festival && (festival.weight || 0) >= 7), label: 'High-weight festival window', delta: 0.08, detail: `Timed to ${festival && festival.name ? festival.name : 'a strong seasonal moment'} (weight ${festival ? festival.weight : ''}).` },
    { when: ((size || 0) > 1000), label: 'Large addressable cohort', delta: 0.08, detail: `${num(size) || size} profiles gives statistically stable reach.` },
    { when: ((fb.positive || 0) > (fb.negative || 0)), label: 'Positive reviewer feedback trend', delta: 0.06, detail: 'Recent human approvals outweigh rejections for similar slots.' },
    { when: !!(input.product && input.product.score != null && input.product.score >= 1), label: 'Top-ranked hero product', delta: 0.04, detail: 'Hero product leads the analysis engine ranking.' },
  ];
}

// ── Generated-campaign / mailer analysis ─────────────────────────────────────
// Explains WHY a concrete asset bundle was generated the way it was, reusing the
// planning entry's analysis where available and adding channel/asset reasoning.
function buildGenerationAnalysis(entry = {}, opts = {}) {
  const base = entry.analysis || buildEntryAnalysis({
    cohort: entry.cohort,
    product: entry.heroProduct || entry.hero_product,
    festival: entry.festival,
    ownCampaign: entry.ownDataReference,
    competitor: entry.competitorContext,
    mvt: entry.mvtPlan,
    channels: entry.channels,
    objective: entry.objective,
    market: entry.market,
    confidence: entry.confidence,
    dataSource: opts.dataSource,
  });
  const channels = Array.isArray(entry.channels) ? entry.channels : [];
  const hero = firstText((entry.heroProduct || entry.hero_product || {}).title, 'the hero product');
  const cohortName = firstText((entry.cohort || {}).name, 'the cohort');
  return {
    summary: `Assets built for ${cohortName} around ${hero} to deliver "${firstText(entry.objective, 'the objective')}".`,
    why_generated: base.summary,
    targeting_logic: base.drivers.filter((d) => ['Target cohort', 'Hero product', 'Calendar moment'].includes(d.signal)),
    channel_logic: channels.map((c) => ({ channel: c, role: channelRole(c) })),
    hypothesis: base.hypothesis,
    expected_impact: base.expected_impact,
    evidence: base.evidence,
    confidence: base.confidence,
  };
}

// ── small grounded-language helpers ──────────────────────────────────────────
function cohortImplication(name, size) {
  const n = String(name || '').toLowerCase();
  if (/champion|loyal|vip|high/.test(n)) return 'Highest-value segment, so the send leans premium bundle and expansion rather than discount.';
  if (/winback|at.?risk|lapsed|dormant|non.?engag/.test(n)) return 'Re-engagement segment, so the send leads with a reactivation reason and replenishment.';
  if (/new|first|prospect|acqui/.test(n)) return 'Early-lifecycle segment, so the send focuses on second-order activation and education.';
  if ((size || 0) > 1000) return 'Sizeable, addressable segment worth a dedicated send.';
  return 'Segment matched to the objective for this send.';
}
function channelImplication(channels) {
  const has = (c) => channels.includes(c);
  const bits = [];
  if (has('email')) bits.push('email carries the full narrative');
  if (has('meta') || has('google') || has('tiktok')) bits.push('paid earns the click');
  if (has('landing_page')) bits.push('the landing page converts it');
  return bits.length ? `Coordinated funnel: ${bits.join(', ')}.` : 'Channels matched to how this cohort responds.';
}
function channelRole(c) {
  return ({
    email: 'Owned narrative + offer delivery to the cohort inbox.',
    meta: 'Paid social to earn the click and retarget viewers.',
    google: 'Intent capture on search + display.',
    tiktok: 'Short-form hook for discovery-led demand.',
    landing_page: 'Conversion surface with proof, offer framing and reviews.',
    sms: 'High-open nudge for time-sensitive reminders.',
  })[c] || `Channel: ${c}.`;
}
function impactMetric(objective, channels) {
  const o = String(objective || '').toLowerCase();
  if (/reactiv|winback|replenish/.test(o)) return 'reactivation rate and repeat revenue';
  if (/bundle|expansion|premium|aov/.test(o)) return 'average order value';
  if (/activation|second.?order|new/.test(o)) return 'second-order conversion rate';
  if (Array.isArray(channels) && channels.includes('email')) return 'revenue per send';
  return 'conversion rate';
}
function hypothesisReason({ cohortName, own, festival, product }) {
  const parts = [];
  if (own && own.name) parts.push('it reuses a structure that already beat thresholds');
  if (festival && festival.name) parts.push('purchase intent is elevated in this window');
  parts.push(`the offer is matched to ${String(cohortName).toLowerCase()} and led by a top-ranked product`);
  return parts.join(', and ');
}
function describePerf(perf) {
  if (perf == null) return 'above threshold';
  if (typeof perf === 'object') {
    const bits = Object.entries(perf).slice(0, 3).map(([k, v]) => `${k} ${v}`);
    return bits.join(', ') || 'above threshold';
  }
  return String(perf);
}
function competitorDriver(competitor, trendingHooks) {
  const c = summarizeCompetitor(competitor, trendingHooks);
  if (!c) return null;
  const bits = [];
  if (c.active_brands != null) bits.push(`${c.active_brands} rivals active`);
  if (c.top_hook) bits.push(`trending angle "${c.top_hook}"`);
  if (!bits.length) return null;
  return {
    signal: 'Competitor context',
    value: bits.join(' · '),
    implication: 'Benchmarks inform prioritization and angle differentiation, not our own winner qualification.',
  };
}
function summarizeCompetitor(competitor, trendingHooks) {
  let hooks = Array.isArray(trendingHooks) ? trendingHooks : [];
  let activeBrands = null;
  if (Array.isArray(competitor)) {
    for (const c of competitor) {
      if (c && c.benchmark && c.benchmark.activeBrands) activeBrands = c.benchmark.activeBrands.length;
      if (c && Array.isArray(c.trendingHooks) && !hooks.length) hooks = c.trendingHooks;
    }
  } else if (competitor && typeof competitor === 'object') {
    if (competitor.benchmark && competitor.benchmark.activeBrands) activeBrands = competitor.benchmark.activeBrands.length;
    if (Array.isArray(competitor.trendingHooks) && !hooks.length) hooks = competitor.trendingHooks;
  }
  const topHook = hooks.length ? firstText(hooks[0].hook, hooks[0]) : null;
  if (activeBrands == null && !topHook) return null;
  return { active_brands: activeBrands, top_hook: topHook };
}

// One-line human string for legacy `rationale` fields that expect a plain string.
function analysisToRationale(a) {
  if (!a) return '';
  return firstText(a.summary, a.hypothesis);
}

module.exports = {
  explainConfidence,
  confidenceLabel,
  buildEntryAnalysis,
  buildGenerationAnalysis,
  analysisToRationale,
  round,
};
