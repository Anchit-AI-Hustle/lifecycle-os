'use strict';

/**
 * brain-calendar.js — Calendar Intelligence (Module 4).
 *
 *   extractFestivals()  — auto-detect sales peaks from smart_sales_history
 *                         (trailing-baseline spike detection) → smart_festivals (source='auto')
 *   generate()          — tentative 15-day rolling calendar: mailers + Google/
 *                         Meta/TikTok ads + landing pages for both, per market,
 *                         cohort-targeted, driven by: filtered own library,
 *                         learned weights (MVT + feedback), festivals, and
 *                         competitor signals as a clearly-labelled advisory.
 *   dailyReview()       — re-check calendar vs latest data, apply feedback,
 *                         swap weak themes, fill gaps; logs smart_calendar_reviews.
 *   applyMvt()          — fold smart_mvt_results into learned_weights.
 */

const { db, getConfig, setConfig, todayIso, addDays, round, groupBy, sum, idFor } = require('./brain-core.js');
const analysis = require('./brain-analysis.js');
const competitor = require('./brain-competitor.js');
const { buildEntryAnalysis, explainConfidence } = require('./output-reasoning.js');

// ── Festival / seasonal-peak auto-extraction ────────────────────────────────
async function extractFestivals({ persist = true } = {}) {
  const cfgAll = await getConfig();
  const cfg = cfgAll.peak_detection;
  const rows = await db().select('smart_sales_history', { limit: 5000, order: 'sale_date.asc' });
  const byMarket = groupBy(rows, (r) => r.market);
  const found = [];
  for (const [market, days] of Object.entries(byMarket)) {
    for (let i = 0; i < days.length; i++) {
      const win = days.slice(Math.max(0, i - cfg.baseline_window_days), i);
      if (win.length < 10) continue;
      const baseline = sum(win, (d) => Number(d.revenue)) / win.length;
      const rev = Number(days[i].revenue);
      if (baseline > 0 && rev / baseline >= cfg.spike_ratio) {
        const mmdd = days[i].sale_date.slice(5);
        found.push({ market, mmdd, date: days[i].sale_date, ratio: round(rev / baseline, 2), revenue: rev });
      }
    }
  }
  // collapse consecutive days into windows, name by proximity to known moments
  const known = await db().select('smart_festivals', { limit: 500 });
  const merged = [];
  const grouped = groupBy(found, (f) => `${f.market}|${f.mmdd.slice(0, 2)}`);
  for (const [key, spikes] of Object.entries(grouped)) {
    const [market, month] = key.split('|');
    const best = spikes.sort((a, b) => b.ratio - a.ratio)[0];
    const near = known.find((k) => k.market === market && Math.abs(parseInt(k.mmdd.slice(3), 10) - parseInt(best.mmdd.slice(3), 10)) <= 7 && k.mmdd.slice(0, 2) === month);
    merged.push({
      id: `fest_auto_${market.toLowerCase()}_${best.mmdd.replace('-', '')}`,
      market, mmdd: best.mmdd,
      name: near ? `${near.name} (peak confirmed)` : `Detected sales peak ${best.mmdd}`,
      weight: Math.min(10, Math.max(4, Math.round(best.ratio * 3))),
      source: 'auto',
      evidence: { spike_ratio: best.ratio, observed_dates: spikes.map((s) => s.date).slice(0, 6), baseline_window_days: cfg.baseline_window_days },
    });
  }
  if (persist && merged.length) await db().upsert('smart_festivals', merged, 'id');
  return merged;
}

// ── Slot planning helpers ────────────────────────────────────────────────────
function festivalFor(dateIso, market, festivals) {
  const mmdd = dateIso.slice(5);
  const within = (f) => {
    const d1 = parseInt(mmdd.replace('-', ''), 10), d2 = parseInt(f.mmdd.replace('-', ''), 10);
    return f.market === market && Math.abs(d1 - d2) <= 10; // ±10 day window (rough, month-aware enough for planning)
  };
  return festivals.filter(within).sort((a, b) => b.weight - a.weight)[0] || null;
}

function pickWeighted(list, weightFn) {
  if (!list.length) return null;
  const weights = list.map((x) => Math.max(weightFn(x), 0.01));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = (total * ((Date.now() % 9973) / 9973));
  for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

// ── 15-day rolling calendar generation ──────────────────────────────────────
async function generate({ startDate, days, persist = true, regenerate = false } = {}) {
  const config = await getConfig();
  const start = startDate || todayIso();
  const horizon = days || config.calendar.days || 15;

  // inputs — each labelled in slot.source for auditability
  const [daily, festivalsAll, feedbackRows, compSignals, existing] = await Promise.all([
    analysis.runDaily({ persist }),                       // own data: patterns + cohorts + filtered scores
    db().select('smart_festivals', { limit: 500 }),
    db().select('smart_feedback', { limit: 500, order: 'created_at.desc' }),
    competitor.benchmarks({ persist: false }),            // advisory only
    db().select('smart_calendar', { limit: 2000, filters: { slot_date: `gte.${start}` } }),
  ]);
  const learned = config.learned_weights || {};
  const cohorts = daily.cohorts;
  const patterns = daily.patterns;

  // negative feedback → suppress angles/themes the humans rejected
  const suppressed = new Set(
    feedbackRows.filter((f) => f.verdict === 'reject' && f.notes)
      .map((f) => (f.notes.match(/angle:(\S+)/) || [])[1]).filter(Boolean)
  );

  const angleRank = (patterns.angle || []).filter((a) => !suppressed.has(a.value));
  const boost = (dim, v) => Number(((learned[`${dim}_boost`] || {})[v]) || 0);

  const existingKey = new Set(existing.map((s) => `${s.slot_date}|${s.market}|${s.channel}|${s.slot_type}`));
  const protectedSlots = new Set(existing.filter((s) => ['approved', 'generated', 'in_review', 'final'].includes(s.status)).map((s) => s.id));

  const slots = [];
  const perWeekCount = {}; // capacity guard
  const cohortLastUsed = {};

  for (let d = 0; d < horizon; d++) {
    const date = addDays(start, d);
    const week = `${date.slice(0, 7)}w${Math.ceil(parseInt(date.slice(8), 10) / 7)}`;
    for (const market of config.calendar.markets) {
      const fest = festivalFor(date, market, festivalsAll);
      const marketCohorts = cohorts.filter((c) => c.market === market);

      // EMAIL — Mon/Wed/Fri/Sun style cadence: schedule when day index matches capacity spread
      const emailCapacity = config.capacity.email_per_market_per_week;
      const emailKey = `${week}|${market}|email`;
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const emailDays = [1, 3, 5, 0].slice(0, emailCapacity);
      if (emailDays.includes(dow) && (perWeekCount[emailKey] || 0) < emailCapacity) {
        perWeekCount[emailKey] = (perWeekCount[emailKey] || 0) + 1;
        const cohort = pickWeighted(
          marketCohorts.filter((c) => (cohortLastUsed[c.id] == null || d - cohortLastUsed[c.id] >= config.calendar.min_gap_days_same_cohort)),
          (c) => c.value_score + (fest && c.id.includes('gift') ? 1 : 0)
        ) || marketCohorts[0];
        if (cohort) cohortLastUsed[cohort.id] = d;
        const angle = fest && fest.weight >= 8
          ? (angleRank.find((a) => a.value === 'gifting') || angleRank[0])
          : pickWeighted(angleRank.slice(0, 4), (a) => a.revenue_per_campaign / 1000 + boost('angle', a.value));
        const winners = (patterns.by_channel.email || []);
        const ref = winners[d % Math.max(winners.length, 1)] || null;
        slots.push(slotRow({
          date, market, channel: 'email', slot_type: 'campaign', cohort, angle: angle && angle.value,
          hook: ref ? ref.hook : null, theme: fest ? fest.name : (ref ? ref.archetype : 'Morning Ritual'),
          archRef: ref, fest, config,
          rationale: [
            `cohort ${cohort ? cohort.name : 'n/a'} (value ${cohort ? cohort.value_score : 0})`,
            `angle '${angle ? angle.value : 'n/a'}' ranks top-4 by revenue/campaign in own library`,
            fest ? `festival window: ${fest.name} (w${fest.weight}, ${fest.source})` : 'no festival window',
          ].join(' · '),
          source: {
            own_library: ref ? { campaign: ref.id, revenue: ref.revenue } : null,
            festival: fest ? { id: fest.id, source: fest.source } : null,
            competitor_advisory: ((compSignals[market] || {}).email || {}).top_angles || null,
            learned_weights_applied: boost('angle', angle ? angle.value : '') !== 0,
          },
        }));
        // matching landing page for the mailer
        slots.push(slotRow({
          date, market, channel: 'landing_email', slot_type: 'campaign', cohort,
          angle: angle && angle.value, hook: ref ? ref.hook : null,
          theme: `LP — ${fest ? fest.name : 'Mailer companion'}`, archRef: ref, fest, config,
          rationale: 'conversion-optimized landing page paired to the mailer of the same day/cohort',
          source: { paired_channel: 'email' },
        }));
      }

      // PAID — rotate google/meta/tiktok across the week
      const paidKey = `${week}|${market}|paid`;
      const paidCapacity = config.capacity.paid_campaigns_per_market_per_week;
      const paidChannels = config.calendar.channels.filter((c) => c !== 'email');
      if ([1, 2, 4, 5, 6].includes(dow) && (perWeekCount[paidKey] || 0) < paidCapacity) {
        perWeekCount[paidKey] = (perWeekCount[paidKey] || 0) + 1;
        const channel = paidChannels[(d + (market === 'UK' ? 1 : 0)) % paidChannels.length];
        const compCh = ((compSignals[market] || {})[channel] || {});
        const cohort = pickWeighted(marketCohorts, (c) => c.value_score * (c.metrics.ads_engaged_pct || 0.3) + 0.05) || marketCohorts[0];
        const angle = pickWeighted(angleRank.slice(0, 5), (a) => a.revenue_per_campaign / 1000 + boost('angle', a.value));
        const winners = (patterns.by_channel[channel] || []);
        const ref = winners[d % Math.max(winners.length, 1)] || null;
        slots.push(slotRow({
          date, market, channel, slot_type: 'campaign', cohort, angle: angle && angle.value,
          hook: ref ? ref.hook : null, theme: fest ? fest.name : (ref ? ref.name.split('—')[0].trim() : 'One-of-One Heritage'),
          archRef: ref, fest, config,
          rationale: [
            `${channel} slot — cohort ${cohort ? cohort.name : 'n/a'}`,
            ref ? `seeded by passing campaign ${ref.id} (rev ${ref.revenue})` : 'no prior winner — exploratory slot',
            compCh.promo_share > 0.5 ? 'competitor field promo-heavy → differentiate on story' : 'normal competitive pressure',
          ].join(' · '),
          source: { own_library: ref ? { campaign: ref.id } : null, competitor_advisory: compCh.top_angles || null, festival: fest ? fest.id : null },
        }));
        // landing page for ads every other paid slot
        if ((perWeekCount[paidKey] % 2) === 1) {
          slots.push(slotRow({
            date, market, channel: 'landing_ads', slot_type: 'campaign', cohort,
            angle: angle && angle.value, hook: ref ? ref.hook : null,
            theme: `LP — ${channel} ${fest ? fest.name : 'campaign'}`, archRef: ref, fest, config,
            rationale: `conversion-optimized landing page paired to the ${channel} campaign`,
            source: { paired_channel: channel },
          }));
        }
        // retargeting follow-up 3 days later
        if (d + 3 < horizon) {
          slots.push(slotRow({
            date: addDays(start, d + 3), market, channel, slot_type: 'retargeting', cohort,
            angle: 'social-proof', hook: null, theme: `Retargeting — ${fest ? fest.name : (angle ? angle.value : 'campaign')}`,
            archRef: ref, fest, config,
            rationale: `auto retargeting wave for the ${date} ${channel} campaign (engaged-viewers audience)`,
            source: { retargets: `${date}|${market}|${channel}` },
          }));
        }
      }
    }
  }

  // de-dup against existing; keep protected slots untouched
  const fresh = slots.filter((s) => !existingKey.has(`${s.slot_date}|${s.market}|${s.channel}|${s.slot_type}`));
  if (persist) {
    if (regenerate) {
      // drop ONLY tentative future slots, keep human-touched ones
      try { await db().remove('smart_calendar', { slot_date: `gte.${start}`, status: 'eq.tentative' }); } catch (_) {}
    }
    if (fresh.length) await db().upsert('smart_calendar', fresh, 'id');
  }
  return { ok: true, start, days: horizon, created: fresh.length, kept_existing: existing.length, slots: fresh, daily_summary: daily.summary };
}

function slotRow({ date, market, channel, slot_type, cohort, angle, hook, theme, archRef, fest, rationale, source, config }) {
  const id = idFor('slot', { date, market, channel, slot_type, cohort: cohort && cohort.id });
  const src = source || {};
  // Explainable confidence from the evidence this slot actually stands on,
  // replacing the previous hardcoded confidence:0.
  const conf = explainConfidence([
    { when: !!src.own_library, label: 'Seeded by a passing own campaign', delta: 0.18, detail: src.own_library && src.own_library.campaign ? `Reuses winner ${src.own_library.campaign}${src.own_library.revenue != null ? ` (rev ${src.own_library.revenue})` : ''}.` : 'Reuses a prior own-library winner.' },
    { when: (fest && (fest.weight || 0) >= 8), label: 'Major festival window', delta: 0.10, detail: fest ? `${fest.name} (weight ${fest.weight}).` : '' },
    { when: (fest && (fest.weight || 0) >= 5 && (fest.weight || 0) < 8), label: 'Festival window', delta: 0.05, detail: fest ? `${fest.name} (weight ${fest.weight}).` : '' },
    { when: !!src.learned_weights_applied, label: 'Learned angle weights applied', delta: 0.06, detail: 'Angle weighting reflects learned performance boosts.' },
    { when: !!(cohort && (cohort.value_score || 0) >= 3), label: 'High-value cohort', delta: 0.06, detail: cohort ? `${cohort.name} value score ${cohort.value_score}.` : '' },
  ], 0.5);
  // Complete analysis, reusing the shared shape and this slot's own evidence.
  const a = buildEntryAnalysis({
    cohort: cohort ? { name: cohort.name, size: cohort.size, value_rank: cohort.value_score } : {},
    product: { title: theme || angle || 'brand hero' },
    festival: fest ? { name: fest.name, weight: fest.weight } : null,
    ownCampaign: src.own_library ? { name: src.own_library.campaign, performance: src.own_library.revenue != null ? { revenue: src.own_library.revenue } : null } : null,
    competitor: src.competitor_advisory ? { trendingHooks: (Array.isArray(src.competitor_advisory) ? src.competitor_advisory : []).map((h) => ({ hook: h })) } : null,
    channels: [channel === 'landing_email' ? 'landing_page' : channel],
    objective: slot_type === 'campaign' ? (angle || 'conversion') : slot_type,
    market,
    confidence: conf,
    dataSource: 'smart-brain',
  });
  if (rationale) a.evidence.slot_rationale = rationale;
  // The smart_calendar table has no dedicated analysis column, so the full
  // analysis lives inside the existing `source` JSONB (audit) column. Consumers
  // read slot.source.analysis; persistence stays schema-compatible.
  src.analysis = a;
  return {
    id, slot_date: date, market, channel, slot_type,
    cohort_id: cohort ? cohort.id : null,
    theme: theme || null, angle: angle || null, hook: hook || null,
    products: [],
    festival: fest ? fest.name : null,
    rationale, mvt: { dimensions: ['hook', 'cta'], variants: 2 },
    status: 'tentative',
    confidence: conf.score,
    source: src,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ── Daily automated review ───────────────────────────────────────────────────
async function dailyReview({ persist = true } = {}) {
  const config = await getConfig();
  const today = todayIso();
  const [daily, feedbackRows, slots] = await Promise.all([
    analysis.runDaily({ persist }),
    db().select('smart_feedback', { limit: 300, order: 'created_at.desc', filters: { applied: 'eq.false' } }),
    db().select('smart_calendar', { limit: 2000, filters: { slot_date: `gte.${today}` }, order: 'slot_date.asc' }),
  ]);
  const changes = [];
  const angleRank = (daily.patterns.angle || []);
  const goodAngles = new Set(angleRank.slice(0, 4).map((a) => a.value));
  const angleBest = angleRank[0] ? angleRank[0].value : 'ritual';

  // 1. apply human feedback to tentative slots
  for (const f of feedbackRows) {
    const slot = slots.find((s) => s.id === f.target_id);
    if (!slot) continue;
    if (f.verdict === 'reject' && slot.status === 'tentative') {
      changes.push({ slot: slot.id, action: 'skipped', reason: `human feedback #${f.id}: ${f.notes || 'rejected'}` });
      if (persist) await db().update('smart_calendar', { id: `eq.${slot.id}` }, { status: 'skipped', updated_at: new Date().toISOString() });
    }
    if (f.verdict === 'approve' && slot.status === 'tentative') {
      changes.push({ slot: slot.id, action: 'approved', reason: `human feedback #${f.id}` });
      if (persist) await db().update('smart_calendar', { id: `eq.${slot.id}` }, { status: 'approved', updated_at: new Date().toISOString() });
    }
    if (f.verdict === 'adjust' && f.notes) {
      const m = f.notes.match(/angle:(\S+)/);
      if (m && slot.status === 'tentative') {
        changes.push({ slot: slot.id, action: 'angle_adjusted', reason: `human feedback: ${m[1]}` });
        if (persist) await db().update('smart_calendar', { id: `eq.${slot.id}` }, { angle: m[1], updated_at: new Date().toISOString() });
      }
    }
    if (persist) await db().update('smart_feedback', { id: `eq.${f.id}` }, { applied: true });
  }

  // 2. swap angles that dropped out of the top set (latest data wins, never blindly follow)
  for (const slot of slots.filter((s) => s.status === 'tentative' && s.angle)) {
    if (!goodAngles.has(slot.angle) && slot.angle !== 'social-proof') {
      changes.push({ slot: slot.id, action: 'angle_swapped', from: slot.angle, to: angleBest, reason: 'angle fell below top-4 by revenue/campaign in today’s analysis' });
      if (persist) await db().update('smart_calendar', { id: `eq.${slot.id}` }, { angle: angleBest, updated_at: new Date().toISOString() });
    }
  }

  // 3. roll the horizon forward: ensure full 15-day coverage
  const gen = await generate({ persist });
  if (gen.created > 0) changes.push({ action: 'horizon_extended', new_slots: gen.created });

  // 4. fold MVT learnings into weights
  const mvt = await applyMvt({ persist });
  if (mvt.applied) changes.push({ action: 'mvt_weights_updated', learnings: mvt.count });

  const review = {
    review_date: today, automated: true, changes,
    reasons: { pass_rate: daily.summary.pass_rate, top_angles: daily.summary.top_angles },
  };
  if (persist) await db().insert('smart_calendar_reviews', [review]);
  return { ok: true, review, daily_summary: daily.summary };
}

// ── MVT loop ─────────────────────────────────────────────────────────────────
async function applyMvt({ persist = true } = {}) {
  const config = await getConfig();
  const results = await db().select('smart_mvt_results', { limit: 500, order: 'created_at.desc' });
  if (!results.length) return { applied: false, count: 0 };
  const learned = config.learned_weights || { angle_boost: {}, hook_boost: {}, mvt_learnings: [] };
  let count = 0;
  for (const r of results.filter((x) => x.winner)) {
    const l = r.learned || {};
    if (l.angle) { learned.angle_boost[l.angle] = round((learned.angle_boost[l.angle] || 0) + 0.05, 3); count++; }
    if (l.hook) { learned.hook_boost[l.hook] = round((learned.hook_boost[l.hook] || 0) + 0.05, 3); count++; }
  }
  learned.mvt_learnings = results.slice(0, 20).map((r) => ({ dimension: r.dimension, variant: r.variant, winner: r.winner, learned: r.learned }));
  if (persist && count) await setConfig('learned_weights', learned);
  return { applied: count > 0, count, learned_weights: learned };
}

module.exports = { extractFestivals, generate, dailyReview, applyMvt };
