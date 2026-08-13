'use strict';

/**
 * brain-competitor.js — Competitor Benchmarking (Module 3).
 *
 * FULLY ISOLATED real-time stream. Reads ONLY smart_competitor_* tables
 * (fed by the live capture pipeline — Gmail IMAP→Sheet sync via
 * /api/competitor, plus direct stream rows). It never reads own-campaign
 * tables and own-library scoring never reads these.
 *
 * Output: benchmark SIGNALS (angle frequency, promo depth, channel cadence)
 * that the calendar may use as an *advisory input* — clearly labelled
 * source='competitor' so the isolation stays auditable.
 */

const { db, round, groupBy, sum } = require('./brain-core.js');

async function pull({ days = 60, market, channel } = {}) {
  const filters = { captured_at: `gte.${new Date(Date.now() - days * 86400000).toISOString()}` };
  if (market) filters.market = `eq.${market}`;
  if (channel) filters.channel = `eq.${channel}`;
  return db().select('smart_competitor_campaigns', { limit: 2000, order: 'captured_at.desc', filters });
}

// A CADENCE NEEDS THE SPAN IT WAS OBSERVED OVER, NOT A CONSTANT.
//
// `cadence_per_brand_per_week` used to divide by a literal 8.5 — the number of
// weeks in the 60-day window `pull()` happens to request. summarize() cannot see
// that window, so the divisor was right only by coincidence: capture that had
// been running for ten days was divided by eight and a half weeks and reported a
// competitor cadence six times lower than what was actually observed, which is
// the number a planner sets their own send frequency against.
//
// The span is now measured from the captures themselves, and a span too short to
// support a weekly rate returns null instead of a small number.
const MIN_SPAN_DAYS_FOR_WEEKLY_RATE = 7;
function observedSpanDays(items) {
  const times = items.map((r) => Date.parse(r.captured_at)).filter((t) => Number.isFinite(t));
  if (times.length < 2) return null;
  const span = (Math.max(...times) - Math.min(...times)) / 86400000;
  return span > 0 ? span : null;
}
function summarize(rows) {
  const byChannel = groupBy(rows, (r) => r.channel);
  const channels = {};
  for (const [ch, items] of Object.entries(byChannel)) {
    const angles = groupBy(items.filter((r) => r.angle), (r) => r.angle);
    const brands = groupBy(items, (r) => r.brand);
    const span = observedSpanDays(items);
    const weeks = span ? span / 7 : null;
    const brandCount = Math.max(Object.keys(brands).length, 1);
    channels[ch] = {
      captured: items.length,
      active_brands: Object.keys(brands).length,
      promo_share: round(items.filter((r) => r.promo).length / Math.max(items.length, 1), 3),
      top_angles: Object.entries(angles)
        .map(([angle, xs]) => ({ angle, count: xs.length }))
        .sort((a, b) => b.count - a.count).slice(0, 4),
      cadence_per_brand_per_week: (span && span >= MIN_SPAN_DAYS_FOR_WEEKLY_RATE)
        ? round(items.length / brandCount / weeks, 2) : null,
      cadence_basis: (span && span >= MIN_SPAN_DAYS_FOR_WEEKLY_RATE)
        ? `${items.length} captures / ${Object.keys(brands).length} brand(s) over ${round(span, 1)} observed days`
        : `[DATA REQUIRED BEFORE LAUNCH: at least ${MIN_SPAN_DAYS_FOR_WEEKLY_RATE} days of competitor capture on this channel. ${span == null ? 'Fewer than two captures carry a timestamp' : `Only ${round(span, 1)} day(s) observed`}, which is too short to state a weekly cadence.]`,
      observed_span_days: span == null ? null : round(span, 1),
      recent: items.slice(0, 5).map((r) => ({ brand: r.brand, title: r.title, angle: r.angle, promo: r.promo, captured_at: r.captured_at })),
    };
  }
  return channels;
}

/** Advisory signals for the calendar. Persisted to smart_competitor_signals. */
async function benchmarks({ persist = false } = {}) {
  const rows = await pull({ days: 60 });
  const byMarket = groupBy(rows, (r) => r.market);
  const out = {};
  const signalRows = [];
  for (const [market, items] of Object.entries(byMarket)) {
    const channels = summarize(items);
    out[market] = channels;
    for (const [channel, signal] of Object.entries(channels)) {
      signalRows.push({ signal_date: new Date().toISOString().slice(0, 10), market, channel, signal });
    }
  }
  // Cross-market advisory notes.
  //
  // NO CAPTURES IS NOT "MODERATE PRESSURE". The else branch here used to assert
  // "Competitor promo pressure is moderate - brand-story slots are safe" even
  // when `rows` was empty, which is a positive claim about the competitive field
  // made from zero observations, and it feeds straight into the calendar's
  // slot-level reasoning. An unobserved field is reported as unobserved.
  const captured = rows.length;
  const promoHeavy = Object.values(out).some((m) => Object.values(m).some((c) => c.promo_share > 0.5));
  out._advisory = {
    isolation: 'competitor signals are advisory inputs only; own-library performance filtering never uses them',
    basis: captured ? 'measured' : 'unset',
    captures_in_window: captured,
    notes: [
      !captured
        ? 'No competitor campaigns were captured in the last 60 days, so nothing is known about competitor promo pressure right now. [DATA REQUIRED BEFORE LAUNCH: competitor capture feed.] No inference about whether brand-story slots are safe is drawn from an empty field.'
        : (promoHeavy
          ? `Competitor field is promo-heavy right now (over half of ${captured} captures carry a promotion) - differentiate with story/origin angles instead of matching discounts.`
          : `Competitor promo pressure is moderate: under half of ${captured} captures in the last 60 days carry a promotion, so brand-story slots are safe.`),
    ],
  };
  if (persist && signalRows.length) {
    try { await db().insert('smart_competitor_signals', signalRows); } catch (_) { /* non-fatal */ }
  }
  return out;
}

module.exports = { pull, benchmarks, summarize };
