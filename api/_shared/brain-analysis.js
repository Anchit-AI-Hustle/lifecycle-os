'use strict';

/**
 * brain-analysis.js — Data Analysis Engine (Module 2).
 *
 * Always reads the linked DB fresh (perfectly in sync — no local caches).
 *   runDaily()        → full daily analysis: channel/campaign/creative KPIs,
 *                       threshold scoring of the library, cohort rebuild.
 *                       Persists smart_library_scores + smart_cohorts.
 *   filteredLibrary() → ONLY campaigns that cleared performance thresholds
 *                       (cohort + performance filtering), with reasons.
 *   buildCohorts()    → personalized cohorts from user-level data.
 *
 * Own-data only. Competitor data NEVER enters scoring (see brain-competitor.js).
 */

const { db, getConfig, round, pct, sum, groupBy, idFor } = require('./brain-core.js');
const kb = require('./brain-kb.js');
const rfm = require('./rfm-core.js');

// ── Threshold scoring ────────────────────────────────────────────────────────
// A CHECK NEEDS SOMETHING TO CHECK. brain-kb.kpisFor() returns roas as NULL when
// the campaign recorded no spend, and pct() returns 0 when the denominator is
// absent. Both used to be coerced into the comparison - `k.roas ?? 0` most
// explicitly - so a campaign whose ROAS was never measurable FAILED the ROAS
// threshold and was dropped from the winning library, and its score was computed
// as if it had earned nothing per pound. That silently biases every downstream
// "what worked" pattern toward campaigns that happened to have spend recorded.
//
// An unmeasured check is now recorded as `pass: null` and excluded from both the
// verdict and the score, and the campaign reports which checks it could not be
// judged on. A campaign with NO measurable check at all cannot pass: there is no
// evidence it worked, which is different from evidence it did not.
const measurable = (v) => Number.isFinite(Number(v)) && v !== null;
function scoreCampaign(c, thresholds) {
  const t = thresholds[c.channel] || {};
  const k = c.kpis;
  const checks = [];
  const add = (name, actual, min, denominator) => {
    const known = measurable(actual) && (denominator === undefined || Number(denominator) > 0);
    checks.push({ name, actual: known ? actual : null, min, pass: known ? actual >= min : null, basis: known ? 'measured' : 'unset' });
  };
  if (c.channel === 'email') {
    add('open_rate', k.open_rate, t.open_rate ?? 0.22, k.sends);
    add('click_rate', k.click_rate, t.click_rate ?? 0.018, k.sends);
    add('rpr', k.rpr, t.rpr ?? 0.08, k.sends);
  } else if (c.channel === 'landing_page') {
    add('cvr', pct(k.conversions, k.impressions), t.cvr ?? 0.018, k.impressions);
  } else {
    add('ctr', k.ctr, t.ctr ?? 0.01, k.impressions);
    add('roas', k.roas, t.roas ?? 1.5, k.spend);
  }
  const judged = checks.filter((x) => x.pass !== null);
  const passed = judged.length > 0 && judged.every((x) => x.pass);
  const score = judged.length
    ? round(judged.reduce((s, x) => s + Math.min(x.min > 0 ? x.actual / x.min : 1, 2), 0) / judged.length, 4)
    : 0;
  return {
    passed, score, checks,
    measured_checks: judged.length,
    unmeasured_checks: checks.filter((x) => x.pass === null).map((x) => x.name),
    basis: judged.length === checks.length ? 'measured' : (judged.length ? 'partial' : 'unset'),
  };
}

// ── Cohort builder (user-level data) ────────────────────────────────────────
// Primary path: statistically-grounded RFM quintile segmentation (rfm-core.js) —
// data-relative cutoffs, mutually-exclusive segments (no double-counting), with
// behavioural interests as overlays. Falls back to the legacy absolute-threshold
// definitions only if RFM produces nothing (e.g. no order/recency fields).
function defineCohorts(users) {
  try {
    const cohorts = rfm.buildRfmCohorts(users || [], { now: Date.now() });
    if (cohorts.length) {
      return cohorts.map((c) => ({
        id: c.id, name: c.name, market: c.market,
        definition: { rule: `RFM quintile segment "${c.segment}" (data-relative, mutually exclusive)`, intent: c.segment },
        size: c.size,
        value_score: round((c.metrics.avg_spent || 0) / 100, 4),
        metrics: c.metrics,
        overlays: c.overlays,
        source: 'rfm', active: true, updated_at: new Date().toISOString(),
      }));
    }
  } catch (e) { console.warn('[brain-analysis] RFM segmentation failed, using legacy thresholds:', e.message); }
  return legacyDefineCohorts(users);
}

function legacyDefineCohorts(users) {
  const now = Date.now(), day = 86400000;
  const daysSince = (ts) => (ts ? Math.floor((now - new Date(ts).getTime()) / day) : 9999);
  const defs = [
    { key: 'vip_ritualists', name: 'VIP Ritualists', test: (u) => u.orders_count >= 8 && u.total_spent >= 300, definition: { rule: 'orders_count >= 8 AND total_spent >= 300', intent: 'retention + early access' } },
    // Fandom buyers: anime / sport / gaming / auto design families. Keys are the
    // real catalogue tags (see scripts/build-catalog.js deriveTags).
    { key: 'fandom_seekers', name: 'Fandom Seekers', test: (u) => (u.categories || []).some((c) => ['anime', 'sport', 'gaming', 'auto', 'celebrity'].includes(c)), definition: { rule: "categories ∩ {anime,sport,gaming,auto,celebrity} ≠ ∅", intent: 'self-expression and fandom angle' } },
    { key: 'af1_loyalists', name: 'AF1 Loyalists', test: (u) => (u.categories || []).some((c) => ['af1', 'jordan', 'nike-other'].includes(c)), definition: { rule: "categories ∩ {af1,jordan,nike-other} ≠ ∅", intent: 'core silhouette stories, next-pair upsell' } },
    { key: 'occasion_buyers', name: 'Occasion Buyers', test: (u) => (u.categories || []).some((c) => ['wedding', 'pets', 'bling'].includes(c)), definition: { rule: "categories ∩ {wedding,pets,bling} ≠ ∅", intent: 'personal-occasion commissions' } },
    { key: 'gift_buyers', name: 'Gift Buyers', test: (u) => (u.categories || []).some((c) => ['gift', 'accessories'].includes(c)), definition: { rule: "categories ∩ {gift,accessories} ≠ ∅", intent: 'festival gifting funnels, care-kit attach' } },
    { key: 'new_customers', name: 'New Customers (≤60d)', test: (u) => daysSince(u.first_order_at) <= 60, definition: { rule: 'first_order ≤ 60 days', intent: 'onboarding funnel, second purchase' } },
    { key: 'at_risk_winback', name: 'At-Risk / Win-back', test: (u) => daysSince(u.last_order_at) > 120 && u.orders_count >= 2, definition: { rule: 'last_order > 120d AND orders ≥ 2', intent: 'win-back offer, low discount affinity guard' } },
    { key: 'discount_responsive', name: 'Discount Responsive', test: (u) => Number(u.discount_affinity) >= 0.25, definition: { rule: 'discount_affinity ≥ 0.25', intent: 'promo windows only — never brand-story slots' } },
    { key: 'engaged_nonbuyers', name: 'Engaged Non-buyers (90d)', test: (u) => u.email_engaged && daysSince(u.last_order_at) > 90, definition: { rule: 'email_engaged AND last_order > 90d', intent: 'mid-funnel nudges + retargeting seed' } },
  ];
  const out = [];
  for (const market of ['US', 'UK']) {
    const mu = users.filter((u) => u.market === market);
    for (const d of defs) {
      const members = mu.filter(d.test);
      if (!members.length) continue;
      const totalSpent = sum(members, (u) => u.total_spent);
      out.push({
        id: `coh_${market.toLowerCase()}_${d.key}`,
        name: `${d.name} · ${market}`,
        market,
        definition: d.definition,
        size: members.length,
        value_score: round(totalSpent / Math.max(members.length, 1) / 100, 4),
        metrics: {
          avg_orders: round(sum(members, (u) => u.orders_count) / members.length, 2),
          avg_spent: round(totalSpent / members.length, 2),
          email_engaged_pct: round(members.filter((u) => u.email_engaged).length / members.length, 3),
          ads_engaged_pct: round(members.filter((u) => u.ads_engaged).length / members.length, 3),
        },
        source: 'auto',
        active: true,
        updated_at: new Date().toISOString(),
      });
    }
  }
  return out;
}

async function buildCohorts({ persist = true } = {}) {
  // Degrade gracefully: if the analytics table is unavailable (missing in this
  // project, or a transient DB error), return no cohorts rather than throwing
  // and blanking the whole calendar. The rest of planning still runs.
  let users = [];
  try { users = await db().select('smart_users', { limit: 20000 }); }
  catch (e) { console.warn('[brain-analysis] smart_users unavailable, continuing without cohort data:', e.message); return []; }
  const cohorts = defineCohorts(users);
  if (persist && cohorts.length) await db().upsert('smart_cohorts', cohorts, 'id');
  return cohorts;
}

// ── Channel rollups ──────────────────────────────────────────────────────────
// A CHANNEL RATE IS A RATIO OF TOTALS, NOT A MEAN OF RATIOS.
//
// These were unweighted means across campaigns, so a 100-recipient send at an
// 80% open rate counted exactly as much as a 100,000-recipient send at 20%, and
// the reported "channel open rate" could sit far above anything the channel
// actually did - Simpson's paradox, presented as the headline number for the
// channel. Every rate below is now the pooled ratio (total numerator / total
// denominator), which is the rate the channel really achieved, and it is null
// rather than 0 when the denominator is absent.
//
// The unweighted per-campaign means are still reported alongside, named for what
// they are, because "the average campaign" is a legitimate but different
// question from "the channel".
function channelRollup(library) {
  const out = {};
  const ratio = (a, b) => (b > 0 ? round(a / b, 4) : null);
  const meanOf = (xs) => (xs.length ? round(xs.reduce((s, v) => s + v, 0) / xs.length, 4) : null);
  for (const [channel, items] of Object.entries(groupBy(library, (c) => c.channel))) {
    const k = items.map((c) => c.kpis);
    const sends = sum(k, (x) => x.sends);
    const impressions = sum(k, (x) => x.impressions);
    const opens = sum(k, (x) => x.opens);
    const clicks = sum(k, (x) => x.clicks);
    const revenue = sum(k, (x) => x.revenue);
    const spend = sum(k, (x) => x.spend);
    const withRoas = k.filter((x) => x.roas != null).map((x) => Number(x.roas));
    out[channel] = {
      campaigns: items.length,
      revenue: round(revenue, 2),
      spend: round(spend, 2),
      conversions: sum(k, (x) => x.conversions),
      sends, impressions, opens, clicks,
      // Pooled (volume-weighted) rates — what the channel actually did.
      open_rate: ratio(opens, sends),
      ctr: ratio(clicks, impressions || sends),
      roas: spend > 0 ? round(revenue / spend, 2) : null,
      rate_basis: 'pooled: total numerator / total denominator across the channel',
      // Unweighted per-campaign means — a different question, labelled as such.
      avg_open_rate: meanOf(k.filter((x) => Number(x.sends) > 0).map((x) => Number(x.open_rate) || 0)),
      avg_ctr: meanOf(k.filter((x) => (Number(x.impressions) || Number(x.sends)) > 0).map((x) => Number(x.ctr) || 0)),
      avg_roas: withRoas.length ? round(withRoas.reduce((s, v) => s + v, 0) / withRoas.length, 2) : null,
      avg_basis: 'unweighted mean across campaigns; every campaign counts once regardless of size',
      roas_measured_for: withRoas.length,
    };
  }
  return out;
}

// ── Daily run ────────────────────────────────────────────────────────────────
async function runDaily({ persist = true } = {}) {
  const config = await getConfig();
  const library = await kb.libraryIndex();
  const patterns = kb.patterns(library);

  // score every campaign against thresholds
  const scored = library.map((c) => ({ c, s: scoreCampaign(c, config.thresholds) }));
  const sortedScores = scored.map((x) => x.s.score).sort((a, b) => a - b);
  const pctile = (v) => round((sortedScores.filter((s) => s <= v).length / sortedScores.length) * 100, 2);
  const scoreRows = scored.map(({ c, s }) => ({
    campaign_id: c.id, channel: c.channel, market: c.market,
    score: s.score, percentile: pctile(s.score), passed: s.passed,
    reasons: { checks: s.checks }, scored_at: new Date().toISOString(),
  }));

  const cohorts = await buildCohorts({ persist });
  if (persist) await db().upsert('smart_library_scores', scoreRows, 'campaign_id');

  const passedCount = scoreRows.filter((r) => r.passed).length;
  const summary = {
    library_size: library.length,
    passed_thresholds: passedCount,
    pass_rate: round(passedCount / Math.max(library.length, 1), 3),
    cohorts: cohorts.length,
    channels: channelRollup(library),
    top_angles: (patterns.angle || []).slice(0, 3),
    top_archetypes: (patterns.archetype || []).slice(0, 3),
  };
  return { ok: true, summary, patterns, cohorts, scores: scoreRows };
}

// ── Filtered library (performance + cohort filter) ──────────────────────────
async function filteredLibrary({ channel, market, cohortId } = {}) {
  const [library, scores, cohorts] = await Promise.all([
    kb.libraryIndex(),
    db().select('smart_library_scores', { limit: 5000 }),
    db().select('smart_cohorts', { limit: 200, filters: { active: 'eq.true' } }),
  ]);
  const scoreBy = Object.fromEntries(scores.map((s) => [s.campaign_id, s]));
  let items = library
    .map((c) => ({ ...c, scoring: scoreBy[c.id] || null }))
    .filter((c) => c.scoring && c.scoring.passed);
  if (channel) items = items.filter((c) => c.channel === channel);
  if (market) items = items.filter((c) => c.market === market);
  if (cohortId) {
    const coh = cohorts.find((x) => x.id === cohortId);
    if (coh) {
      // surface campaigns whose audience segments overlap cohort intent
      const want = JSON.stringify(coh.definition).toLowerCase();
      items = items.sort((a, b) => {
        const rel = (c) => ((c.angle && want.includes(c.angle.split('-')[0])) ? 1 : 0);
        return rel(b) - rel(a) || b.scoring.score - a.scoring.score;
      });
    }
  } else {
    items = items.sort((a, b) => b.scoring.score - a.scoring.score);
  }
  return { count: items.length, items };
}

module.exports = { runDaily, buildCohorts, filteredLibrary, scoreCampaign, channelRollup };
