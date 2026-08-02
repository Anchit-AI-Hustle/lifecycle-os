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

function summarize(rows) {
  const byChannel = groupBy(rows, (r) => r.channel);
  const channels = {};
  for (const [ch, items] of Object.entries(byChannel)) {
    const angles = groupBy(items.filter((r) => r.angle), (r) => r.angle);
    const brands = groupBy(items, (r) => r.brand);
    channels[ch] = {
      captured: items.length,
      active_brands: Object.keys(brands).length,
      promo_share: round(items.filter((r) => r.promo).length / Math.max(items.length, 1), 3),
      top_angles: Object.entries(angles)
        .map(([angle, xs]) => ({ angle, count: xs.length }))
        .sort((a, b) => b.count - a.count).slice(0, 4),
      cadence_per_brand_per_week: round(items.length / Math.max(Object.keys(brands).length, 1) / 8.5, 2),
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
  // cross-market advisory notes
  const promoHeavy = Object.values(out).some((m) => Object.values(m).some((c) => c.promo_share > 0.5));
  out._advisory = {
    isolation: 'competitor signals are advisory inputs only; own-library performance filtering never uses them',
    notes: [
      promoHeavy ? 'Competitor field is promo-heavy right now — differentiate with story/origin angles instead of matching discounts.' : 'Competitor promo pressure is moderate — brand-story slots are safe.',
    ],
  };
  if (persist && signalRows.length) {
    try { await db().insert('smart_competitor_signals', signalRows); } catch (_) { /* non-fatal */ }
  }
  return out;
}

module.exports = { pull, benchmarks, summarize };
