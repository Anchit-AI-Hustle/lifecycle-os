'use strict';

/**
 * /api/calendar/generate
 *
 * Generates a 30-day marketing calendar from:
 *  - past campaign performance (rates, fatigue, best-send-time per market)
 *  - customer segmentation (RFM segments + their value/responsiveness)
 *  - product intelligence (top products, cross-sell affinity, gap analysis)
 *  - festivals + cultural moments (data/festivals.json)
 *
 * Output: a 30-day plan, one row per send, with:
 *  - date, send_window (UTC hour)
 *  - market (US / UK / Global)
 *  - segment (Champions / Loyal / New / etc.)
 *  - archetype (one of the 11 layout archetypes)
 *  - content_type (promo / editorial / lifecycle / etc.)
 *  - hero_product_sku
 *  - subject_line_hint
 *  - rationale (one sentence explaining WHY this send on this date)
 *
 * This endpoint does NOT call the LLM by itself. The downstream
 * /api/calendar/trigger-mailer endpoint takes one row and pipes it
 * into the existing /api/ai/pipeline stages to produce the actual
 * HTML email.
 *
 * Body shape:
 *  {
 *    start_date?: 'YYYY-MM-DD',           // default = today
 *    days?: number,                       // default 30
 *    markets?: ['US','UK','Global'],      // default all 3
 *    capacity_per_market_per_week?: number, // default 4 (≈ industry safe send freq)
 *    analytics: {
 *      campaigns: [...], customers: [...], orders: [...]   // analytics summary from /api/analytics/compute
 *    }
 *  }
 */

const fs = require('fs');
const path = require('path');
const SM = require('./scenario-model.js');
const { buildEntryAnalysis, explainConfidence } = require('./output-reasoning.js');

let FESTIVALS = null;
function loadFestivals() {
  if (FESTIVALS) return FESTIVALS;
  try {
    const p = path.join(process.cwd(), 'data', 'festivals.json');
    FESTIVALS = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.error('[calendar/generate] could not load festivals.json:', e.message);
    FESTIVALS = { US: [], UK: [], Global: [] };
  }
  return FESTIVALS;
}

const ARCHETYPES = [
  'hero-led-editorial',
  'product-grid-conversion',
  'storytelling-narrative',
  'single-product-spotlight',
  'gift-bundle-showcase',
  'ritual-journey',
  'comparison-discovery',
  'founder-note',
  'editorial-trend-roundup',
  'limited-drop-countdown',
  'subscription-anchor',
];

const CONTENT_TYPES = ['promo', 'editorial', 'lifecycle', 'launch', 'winback', 'transactional'];

// Canonical asset-type order for plan rows (additive `asset_types` field).
const ASSET_TYPES = ['mailer', 'meta_ad', 'google_ad', 'tiktok_ad', 'landing_page', 'social_post'];

// Default segment cadence — how often the same segment can be hit per week.
const SEGMENT_CADENCE_PER_WEEK = {
  'Champions':     3,  // engaged + valuable → can sustain frequency
  'Loyal':         3,
  'Promising':     2,
  'New':           2,
  'Need-Attention':2,
  'About-to-Sleep':1,
  'At-Risk':       1,
  'Hibernating':   1,  // careful — too much frequency drives unsubs
  'Lost':          0,  // skip in 30-day plan
};

// Weekly segment focus pattern — week rotation so segments aren't always paired with same archetype.
const WEEK_FOCUS = ['acquire', 'retain', 'reactivate', 'loyalty'];

function dateAddDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function findFestivalForDate(market, dateStr) {
  const mmdd = dateStr.slice(5);
  const all = loadFestivals();
  return (all[market] || []).find((f) => f.date === mmdd) || null;
}

function pickBestSendHourUTC(market, analytics) {
  // From analytics.bestHourByMarket if present; else market default (UTC).
  const a = analytics?.bestHourByMarket?.[market];
  if (typeof a === 'number') return a;
  // Reasonable defaults: target local 9-10am for each market
  // US-Eastern 9:30am ≈ 14 UTC · UK 9am ≈ 9 UTC · IN 9:30am ≈ 4 UTC · Global 6 UTC
  if (market === 'US') return 14;
  if (market === 'UK') return 9;
  if (market === 'IN') return 4;
  return 6;
}

function pickArchetype(segment, festival, content_type) {
  if (festival?.archetype_hint) return festival.archetype_hint;
  if (content_type === 'launch')        return 'single-product-spotlight';
  if (content_type === 'editorial')     return 'storytelling-narrative';
  if (content_type === 'lifecycle')     return 'ritual-journey';
  if (content_type === 'winback')       return 'founder-note';
  if (content_type === 'transactional') return 'subscription-anchor';
  // promo defaults by segment
  if (segment === 'Champions') return 'editorial-trend-roundup';
  if (segment === 'Loyal')     return 'hero-led-editorial';
  if (segment === 'New')       return 'ritual-journey';
  if (segment === 'Need-Attention' || segment === 'About-to-Sleep') return 'product-grid-conversion';
  if (segment === 'At-Risk' || segment === 'Hibernating') return 'limited-drop-countdown';
  return 'hero-led-editorial';
}

function pickContentType(weekIdx, segment, festival) {
  if (festival?.weight >= 8) return festival.tags?.includes('sale') ? 'promo' : 'editorial';
  const focus = WEEK_FOCUS[weekIdx % WEEK_FOCUS.length];
  if (focus === 'acquire')    return segment === 'New' || segment === 'Promising' ? 'lifecycle' : 'editorial';
  if (focus === 'retain')     return segment === 'Loyal' || segment === 'Champions' ? 'lifecycle' : 'editorial';
  if (focus === 'reactivate') return segment === 'At-Risk' || segment === 'Hibernating' ? 'winback' : 'promo';
  if (focus === 'loyalty')    return segment === 'Champions' ? 'editorial' : 'lifecycle';
  return 'editorial';
}

// Stable string→index hash so hero selection is reproducible (replaces a prior
// Math.random() call that made plans non-deterministic between identical runs).
function stableIndex(str, n) {
  if (n <= 1) return 0;
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

// Deterministically choose which asset types a plan slot needs, from its
// content_type / archetype / festival. No randomness: fixed rules plus the
// same stableIndex hash used for hero rotation. Rules:
//  - every slot ships a mailer
//  - promo slots and festival slots add the paid + landing set (meta_ad, google_ad, landing_page)
//  - launch slots add the paid + landing set plus a tiktok_ad
//  - editorial slots and storytelling-leaning archetypes add a social_post
//  - lifecycle / winback slots rotate a social_post onto every second slot (stableIndex on the slot key)
function pickAssetTypes({ content_type, archetype, festival, key }) {
  const set = new Set(['mailer']);
  if (content_type === 'promo' || festival) {
    set.add('meta_ad'); set.add('google_ad'); set.add('landing_page');
  }
  if (content_type === 'launch') {
    set.add('meta_ad'); set.add('google_ad'); set.add('landing_page'); set.add('tiktok_ad');
  }
  if (content_type === 'editorial' || archetype === 'storytelling-narrative' || archetype === 'founder-note' || archetype === 'editorial-trend-roundup') {
    set.add('social_post');
  }
  if ((content_type === 'lifecycle' || content_type === 'winback') && stableIndex(String(key), 2) === 0) {
    set.add('social_post');
  }
  return ASSET_TYPES.filter((t) => set.has(t));
}

// productStrategy lever (from the scenario model) overrides the per-segment
// rotation: 'bestseller-only' always picks the top revenue product; 'launch-push'
// favours the under-promoted/new SKU; 'current' (medium) keeps today's logic.
function pickHeroProduct(segment, festival, analytics, productStrategy = 'current') {
  // Festival hint trumps.
  if (festival?.tags?.includes('gift')) {
    const gift = (analytics?.products || []).find((p) => /gift|bundle|set/i.test(p.title || p.category || ''));
    if (gift) return gift;
  }
  // For retention-focused segments push their primary category's top product.
  const top = (analytics?.products || []).slice().sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  if (!top.length) return { sku: 'DRJ-100', title: 'Jordan Summer Black' };

  // Scenario product-strategy overrides (deterministic).
  if (productStrategy === 'bestseller-only') return top[0];
  if (productStrategy === 'launch-push') {
    const underPromoted = top.find((p) => (p.promos || 0) <= 1);
    return underPromoted || top[0];
  }

  // 'current' = today's segment-based rotation.
  if (segment === 'New' || segment === 'Promising') {
    // Show breadth → bestseller
    return top[0];
  }
  if (segment === 'Champions' || segment === 'Loyal') {
    // Surface something new or under-promoted to extend repertoire
    const underPromoted = top.find((p) => (p.promos || 0) <= 1);
    return underPromoted || top[Math.min(2, top.length - 1)];
  }
  if (segment === 'At-Risk' || segment === 'Hibernating') {
    // High-conviction comeback offer = bestseller
    return top[0];
  }
  return top[stableIndex(segment, Math.min(3, top.length))];
}

function buildSubjectHint(segment, festival, hero, content_type, market) {
  const productName = hero.title || hero.sku;
  if (festival) {
    if (festival.tags?.includes('gift')) return `${festival.name} · gifts that say something`;
    if (festival.tags?.includes('sale')) return `${festival.name}: only the sneakers worth queuing for`;
    return `${festival.name} · a sneaker moment worth pausing for`;
  }
  if (content_type === 'winback')  return `${market === 'UK' ? 'Hello' : 'Hey'}, it's been a while`;
  if (content_type === 'lifecycle')return `Your ${productName.split(' ').slice(0, 2).join(' ')} ritual, refilled`;
  if (content_type === 'editorial')return `Why ${productName} keeps winning the morning`;
  if (content_type === 'promo')    return `${productName} — and three sneakers that pair with it`;
  if (content_type === 'launch')   return `Just landed: ${productName}`;
  return `Today on the detailing table: ${productName}`;
}

function buildRationale({ segment, festival, content_type, archetype, hero, segValueRank, market }) {
  const parts = [];
  if (festival) {
    parts.push(`Aligned with ${festival.name} (weight ${festival.weight}/10) for ${market}.`);
  }
  parts.push(`Segment ${segment} ranks #${segValueRank} by value in this window.`);
  parts.push(`${content_type} archetype "${archetype}" historically converts best for this segment.`);
  parts.push(`Hero: ${hero.title || hero.sku}${hero.promos === 0 ? ' — under-promoted, expands repertoire.' : '.'}`);
  return parts.join(' ');
}

function rankSegmentsByValue(analytics) {
  const segs = analytics?.segments || [];
  return segs
    .slice()
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
    .map((s, i) => ({ ...s, valueRank: i + 1 }));
}

function nextSegmentForDay({ sendsThisWeekBySeg, segmentList, cadenceTable }) {
  // Score each segment: high value, has remaining cadence (per the scenario's
  // scaled cadence table), hasn't exhausted its weekly slots.
  const candidates = segmentList
    .filter((s) => (sendsThisWeekBySeg[s.name] || 0) < (cadenceTable[s.name] ?? 0))
    .sort((a, b) => a.valueRank - b.valueRank);
  return candidates[0] || null;
}

// ─── Plan builder (pure — shared by every scenario) ──────────────────────────
// Extracted verbatim from the original handler loop. Given a pre-filtered
// segment list, a per-segment cadence table, a per-market weekly capacity and a
// product strategy, it builds the day-by-day plan + meta. Calling it with the
// medium scenario's levers (cadence ×1.0, all segments, productStrategy 'current')
// reproduces the original deterministic output.
function buildPlan({ startDate, days, markets, capacity, analytics, segmentsRanked, cadenceTable, productStrategy }) {
  const plan = [];
  for (let m = 0; m < markets.length; m++) {
    const market = markets[m];
    const sendsThisWeekBySeg = {};
    let sendsThisWeek = 0;
    let weekIdx = 0;

    for (let d = 0; d < days; d++) {
      const day = dateAddDays(startDate, d);
      const dateStr = isoDate(day);

      // Reset weekly counters on Mondays (UTC)
      if (day.getUTCDay() === 1) {
        weekIdx++;
        sendsThisWeek = 0;
        for (const k in sendsThisWeekBySeg) sendsThisWeekBySeg[k] = 0;
      }

      const festival = findFestivalForDate(market, dateStr);

      // Festivals override capacity if weight >= 8
      const isHighFestival = festival && festival.weight >= 8;

      // Per-market weekly capacity (festivals get bonus slots)
      const maxThisWeek = capacity + (isHighFestival ? 1 : 0);
      if (sendsThisWeek >= maxThisWeek && !isHighFestival) continue;

      // Pick segment
      let segment;
      if (festival && Array.isArray(festival.recommended_segments)) {
        const rec = festival.recommended_segments
          .map((n) => segmentsRanked.find((s) => s.name === n))
          .filter(Boolean)
          .filter((s) => (sendsThisWeekBySeg[s.name] || 0) < (cadenceTable[s.name] ?? 0));
        segment = rec[0] || nextSegmentForDay({ sendsThisWeekBySeg, segmentList: segmentsRanked, cadenceTable });
      } else {
        segment = nextSegmentForDay({ sendsThisWeekBySeg, segmentList: segmentsRanked, cadenceTable });
      }
      if (!segment) continue;

      const content_type = pickContentType(weekIdx, segment.name, festival);
      const archetype    = pickArchetype(segment.name, festival, content_type);
      const hero         = pickHeroProduct(segment.name, festival, analytics, productStrategy);
      const send_hour    = pickBestSendHourUTC(market, analytics);
      const subject_hint = buildSubjectHint(segment.name, festival, hero, content_type, market);
      const rationale    = buildRationale({ segment: segment.name, festival, content_type, archetype, hero, segValueRank: segment.valueRank, market });
      const asset_types  = pickAssetTypes({ content_type, archetype, festival, key: `${dateStr}_${market}_${segment.name}` });

      // Explainable confidence + complete analysis for this RFM slot.
      const conf = explainConfidence([
        { when: (segment.valueRank === 1), label: 'Top-ranked RFM segment', delta: 0.16, detail: `${segment.name} is #1 by revenue in this window.` },
        { when: (segment.valueRank === 2 || segment.valueRank === 3), label: 'High-value RFM segment', delta: 0.10, detail: `${segment.name} ranks #${segment.valueRank} by revenue.` },
        { when: (festival && festival.weight >= 8), label: 'Major festival window', delta: 0.10, detail: festival ? `${festival.name} (weight ${festival.weight}/10) drives elevated demand.` : '' },
        { when: (festival && festival.weight >= 5 && festival.weight < 8), label: 'Festival window', delta: 0.05, detail: festival ? `${festival.name} (weight ${festival.weight}/10).` : '' },
        { when: ((segment.count || 0) > 1000), label: 'Large addressable segment', delta: 0.06, detail: `${segment.count} profiles gives stable reach.` },
        { when: (hero.promos === 0), label: 'Under-promoted hero expands repertoire', delta: 0.04, detail: `${hero.title || hero.sku} has not been over-sent, reducing fatigue risk.` },
      ]);
      const analysisObj = buildEntryAnalysis({
        cohort: { name: segment.name, size: segment.count, value_rank: segment.valueRank },
        product: { title: hero.title, sku: hero.sku, category: hero.category },
        festival: festival ? { name: festival.name, weight: festival.weight, tags: festival.tags || [] } : null,
        channels: (asset_types || []).map((a) => ({ mailer: 'email', meta_ad: 'meta', google_ad: 'google', tiktok_ad: 'tiktok', landing_page: 'landing_page', social_post: 'meta' }[a] || a)).filter((v, i, arr) => arr.indexOf(v) === i),
        objective: content_type,
        market,
        confidence: conf,
        dataSource: analytics?.source || 'analytics',
      });

      plan.push({
        id: `${dateStr}_${market}_${segment.name}_${plan.length}`,
        date: dateStr,
        send_hour_utc: send_hour,
        market,
        segment: segment.name,
        segment_size: segment.count || null,
        archetype,
        content_type,
        hero_sku: hero.sku || null,
        hero_product: hero.title || null,
        hero_handle: hero.handle || hero.h || null,
        subject_hint,
        festival: festival ? festival.name : null,
        festival_weight: festival ? festival.weight : null,
        festival_tags: festival ? (festival.tags || []) : [],
        rationale,
        confidence: conf.score,
        analysis: analysisObj,
        asset_types,
        status: 'planned',
      });

      sendsThisWeek++;
      sendsThisWeekBySeg[segment.name] = (sendsThisWeekBySeg[segment.name] || 0) + 1;
    }
  }

  plan.sort((a, b) => (a.date + a.send_hour_utc).localeCompare(b.date + b.send_hour_utc));

  const meta = {
    segments_used: segmentsRanked.map((s) => ({ name: s.name, valueRank: s.valueRank, revenue: s.revenue, count: s.count })),
    archetype_distribution: ARCHETYPES.reduce((mp, a) => ({ ...mp, [a]: plan.filter((p) => p.archetype === a).length }), {}),
    content_type_distribution: CONTENT_TYPES.reduce((mp, c) => ({ ...mp, [c]: plan.filter((p) => p.content_type === c).length }), {}),
    asset_type_distribution: ASSET_TYPES.reduce((mp, t) => ({ ...mp, [t]: plan.filter((p) => (p.asset_types || []).includes(t)).length }), {}),
  };
  return { plan, meta };
}

// ─── Scenario builder ────────────────────────────────────────────────────────
// Applies one scenario's levers (cadence / horizon / segment focus / product
// strategy) and attaches grounded projected metrics + the hand-authored,
// brand-scrubbed rationale.
function buildScenario(label, { startDate, daysReq, markets, capacity, analytics }) {
  const L = SM.SCENARIO_LEVERS[label];
  const days = SM.scenarioDays(L, daysReq);
  const cap = SM.effectiveCapacity(L, capacity);
  const cadenceTable = SM.scaleCadence(SEGMENT_CADENCE_PER_WEEK, L);

  const fullRanked = rankSegmentsByValue(analytics);
  const eligible = new Set(SM.eligibleSegments(fullRanked.map((s) => s.name), L));
  const segmentsRanked = fullRanked.filter((s) => eligible.has(s.name));

  const { plan, meta } = buildPlan({ startDate, days, markets, capacity: cap, analytics, segmentsRanked, cadenceTable, productStrategy: L.productStrategy });

  const benchmark = SM.buildEngine1Benchmark(analytics, markets[0]);
  const projected_metrics = SM.projectMetrics(plan, L, benchmark);

  const profile = SM.SCENARIO_PROFILES[label];
  const display_name = SM.sanitizeBrand(profile.display_name);
  const one_liner = SM.sanitizeBrand(profile.one_liner);
  const assumptions = profile.assumptions.map((a) => SM.sanitizeBrand(a));
  SM.assertNoBanned(`${display_name} ${one_liner} ${assumptions.join(' ')}`, `scenario:${label}`);

  return {
    label,
    display_name,
    one_liner,
    assumptions,
    levers: L,
    days,
    capacity_per_market_per_week: cap,
    total_sends_planned: plan.length,
    plan,
    meta,
    projected_metrics,
  };
}

// ─── MaxPower strategist narrative (optional, time-boxed, fallback-safe) ──────
// Only runs for tier='maxpower'. It writes ONLY qualitative narrative onto each
// scenario AFTER the deterministic result is fully built — it never touches any
// plan row or projected number. Any failure/timeout leaves the deterministic
// body unchanged. Returns a narrative_status string for the UI.
async function attachStrategistNarratives(scenarios) {
  let callLLM, parseJSON;
  try { callLLM = require('./llm.js'); parseJSON = require('./llm.js').parseJSON; } catch (_) { return 'skipped_no_llm'; }
  if (typeof callLLM !== 'function') return 'skipped_no_llm';

  const summary = scenarios.map((s) => ({
    label: s.label, display_name: s.display_name, sends: s.total_sends_planned, horizon_days: s.days,
    projected: {
      total_revenue: s.projected_metrics.projected_total_revenue,
      paid_spend: s.projected_metrics.projected_paid_spend,
      blended_roas: s.projected_metrics.blended_roas,
      band: s.projected_metrics.response_band,
    },
    assumptions: s.assumptions,
  }));
  const sys = "You are KNICKGASM's senior growth strategist. Voice: warm, precise, story-driven. NEVER use: \"wellness journey\", \"transform\", \"liquid gold\", \"game-changer\", \"LIMITED TIME\" in caps, \"hurry\", \"don't miss out\", \"last chance\", \"while supplies last\". Return STRICT JSON only, no markdown fences.";
  const user = `For each calendar scenario, write a 2-3 sentence strategist_narrative: why these levers fit, what must be true for the projection to hold, and — for best, why it is a stretch ceiling not a committed target; for emergency, why it is the right floor. Scenarios:\n${JSON.stringify(summary)}\n\nReturn JSON: { "narratives": { "best": "", "medium": "", "conservative": "", "emergency": "", "instant": "" } }`;

  let timer;
  const llmCall = Promise.resolve().then(() => callLLM({
    systemPrompt: sys, userMessage: user, responseFormat: { type: 'json_object' },
    maxTokens: 900, temperature: 0.6, timeoutMs: 25000, stage: 'calendar-scenario-strategist', tier: 'maxpower',
  }));
  const guard = new Promise((resolve) => { timer = setTimeout(() => resolve(null), 25000); });
  const result = await Promise.race([llmCall, guard]).catch(() => null);
  clearTimeout(timer);
  if (!result || !result.text) return 'skipped_timeout';

  let json = null;
  try { json = parseJSON ? parseJSON(result.text) : JSON.parse(result.text); } catch (_) { json = null; }
  if (!json || !json.narratives) return 'skipped_error';

  let applied = 0;
  for (const s of scenarios) {
    const raw = json.narratives[s.label];
    if (raw && String(raw).trim()) {
      const clean = SM.sanitizeBrand(raw);
      if (clean) { s.strategist_narrative = clean; applied += 1; }
    }
  }
  return applied ? 'ok' : 'skipped_error';
}

// ─── Main handler ───────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const startDate = body.start_date ? new Date(body.start_date) : new Date();
  const daysReq = Math.min(90, Math.max(7, +body.days || 30));
  const markets = Array.isArray(body.markets) && body.markets.length ? body.markets : ['US', 'UK', 'Global', 'IN'];
  const capacity = +body.capacity_per_market_per_week || 4;
  const analytics = body.analytics || {};
  // Single mode: maxpower is the default, so the Plan Calendar always adds the
  // strategist narrative on top of the deterministic plan. Only an explicit
  // tier=budget opts out (kept as a safe escape hatch); the narrative pass is
  // time-boxed and fallback-safe, so this never errors.
  const tier = String(body.tier || (req.query && req.query.tier) || 'maxpower').toLowerCase() === 'budget' ? 'budget' : 'maxpower';

  // Empty-analytics guard BEFORE building any scenario (unchanged contract).
  if (!rankSegmentsByValue(analytics).length) {
    return res.status(400).json({ error: 'analytics.segments missing — call /api/analytics/compute first or paste a precomputed summary in body.analytics' });
  }

  // Build all 5 scenarios. Each is self-contained (its own plan + meta +
  // projected_metrics) so the internal UI can render any scenario standalone.
  const scenarios = SM.SCENARIO_LABELS.map((label) => buildScenario(label, { startDate, daysReq, markets, capacity, analytics }));
  const medium = scenarios.find((s) => s.label === 'medium') || scenarios[0];

  // MaxPower-only: attach narratives after the deterministic result exists.
  let narrative_status = tier === 'maxpower' ? 'pending' : 'skipped_budget';
  if (tier === 'maxpower') {
    narrative_status = await attachStrategistNarratives(scenarios).catch(() => 'skipped_error');
  }

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    start_date: isoDate(startDate),
    days: daysReq,
    markets,
    // ── Legacy top-level fields = the medium scenario (calendar.html reads these) ──
    total_sends_planned: medium.total_sends_planned,
    capacity_per_market_per_week: capacity,
    plan: medium.plan,         // same array reference as the medium scenario (no drift)
    meta: medium.meta,
    // ── New, additive (ignored by old consumers) ──
    default_scenario: 'medium',
    tier,
    narrative_status,
    scenario_model_version: SM.CONSTANTS_VERSION,
    scenarios,
  });
};
