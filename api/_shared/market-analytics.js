'use strict';
/**
 * api/_shared/market-analytics.js — server reader for the REAL Shopify-export
 * market analytics (the exact numbers the /analytics dashboard shows).
 *
 * Reads the build-generated JSON (data/analytics/market-data.json). A required
 * JSON is bundled reliably by Vercel; a runtime fs read of data/market/*.csv is
 * NOT trace-included, so we go through the JSON. Regenerate with
 * `node scripts/build-market-analytics.js` whenever the CSVs change.
 *
 * Powers KicksGPT's `market_performance` tool so it answers product / revenue /
 * top-seller / performance questions from real data (previously it hit empty
 * Supabase order tables and returned $0). Zero fabrication: every figure is a
 * straight export total; the current-month number is a clearly-labelled
 * run-rate projection, never presented as an actual.
 */

let DATA = null;
function data() {
  if (DATA) return DATA;
  let base;
  try { base = require('../../data/analytics/market-data.json'); }
  catch (_) { base = { currency: {}, markets: {} }; }
  DATA = mergeLive(base);
  return DATA;
}

// LIVE Shopify Admin overlay (pulled via the connected Shopify MCP). When a
// market is present here, its fresher figures win over the CSV-derived export.
// Rebuild-safe: scripts/build-market-analytics.js never touches this file.
let LIVE = undefined;
function live() {
  if (LIVE !== undefined) return LIVE;
  try { LIVE = require('../../data/analytics/live-shopify.json'); }
  catch (_) { LIVE = { markets: {} }; }
  return LIVE;
}

// Merge the live overlay onto the CSV base. Live monthly / summary / top_products /
// referrers / sessions replace the CSV equivalents for that market; every other
// CSV field (weekly, product_types, cohort, ...) is preserved. Markets that exist
// ONLY in the live overlay (e.g. GLOBAL, IN once authorized) are added wholesale.
function mergeLive(base) {
  const lv = live();
  const out = { ...base, currency: { ...(base.currency || {}) }, markets: { ...(base.markets || {}) } };
  for (const [mk, l] of Object.entries(lv.markets || {})) {
    const prev = out.markets[mk] || {};
    out.markets[mk] = {
      ...prev,
      ...(l.monthly ? { monthly: l.monthly } : {}),
      ...(l.summary ? { summary: { ...(prev.summary || {}), ...l.summary } } : {}),
      ...(l.top_products ? { top_products: l.top_products } : {}),
      ...(l.referrers ? { referrers: l.referrers } : {}),
      ...(l.sessions ? { sessions: l.sessions } : {}),
      ...(l.customers_monthly ? { customers_monthly: l.customers_monthly } : {}),
      live: { source: lv.source || 'shopify_admin_mcp', pulled_at: l.pulled_at || lv.pulled_at || null, shop: l.shop || null, store_url: l.store_url || null },
    };
    if (l.currency) out.currency[mk] = l.currency;
  }
  return out;
}

// Supported markets = whatever the CSV base or the live overlay actually carry.
// Everything else resolves to itself so performance() honestly returns ok:false
// (never silently serve US numbers for a market we have no data for).
function normMarket(m) {
  const s = String(m || 'US').toUpperCase().replace(/[^A-Z]/g, '');
  if (s === 'UK' || s === 'GB' || s === 'GBR' || s === 'UNITEDKINGDOM' || s === 'BRITAIN' || s === 'ENGLAND') return 'UK';
  if (s === 'US' || s === 'USA' || s === 'AMERICA' || s === 'UNITEDSTATES' || s === '') return 'US';
  if (s === 'IN' || s === 'IND' || s === 'INDIA' || s === 'BHARAT') return 'IN';
  if (s === 'GLOBAL' || s === 'INTERNATIONAL' || s === 'WORLD' || s === 'ROW' || s === 'GLOBE') return 'GLOBAL';
  return s; // EU, AU, ... -> unsupported unless present in data -> ok:false downstream
}
function cur(market) { const d = data(); return (d.currency && d.currency[normMarket(market)]) || (normMarket(market) === 'UK' ? 'GBP' : 'USD'); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function monthLabel(m) { return String(m || '').slice(0, 7); }         // 2026-07-01 -> 2026-07
function pctChange(a, b) { return b ? Math.round(((a - b) / b) * 1000) / 10 : null; }

// Run-rate projection for the current calendar month — ONLY when the latest
// export month IS the current month (otherwise null; we never project a stale
// month). Basis is stated so it reads as an estimate, not a fact.
function projectCurrentMonth(monthly) {
  if (!monthly || !monthly.length) return null;
  const last = monthly[monthly.length - 1];
  const lbl = monthLabel(last.month);
  const now = new Date();
  if (lbl !== now.toISOString().slice(0, 7)) return null;
  const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = Math.max(1, now.getUTCDate());
  const f = dim / elapsed;
  return {
    month: lbl, mtd_sales: round2(last.sales), mtd_orders: last.orders,
    days_elapsed: elapsed, days_in_month: dim,
    projected_sales: round2(last.sales * f), projected_orders: Math.round(last.orders * f),
    basis: `month-to-date ${round2(last.sales)} ÷ ${elapsed} elapsed days × ${dim} days in month`,
  };
}

/**
 * REAL customer / audience base for a market, straight from the Shopify export
 * (live Admin snapshot when present, else the CSV export) — NEVER the seeded
 * smart_cohorts sample. "Purchasing customers" = unique buyers on the store over
 * the export window (new + returning). Total email/SMS list size is a Klaviyo
 * figure and is NOT reported here (Klaviyo not connected) — so we never conflate
 * a 600-row modelled RFM sample with the real customer base.
 */
function audience(market) {
  const mk = normMarket(market);
  const m = (data().markets || {})[mk];
  const s = m && m.summary;
  if (!m || !s) {
    const have = Object.keys((data().markets) || {}).join(', ') || 'none';
    return { ok: false, market: mk, error: `No customer data loaded for ${mk} yet. Available now: ${have}. To add ${mk}, authorize the ${mk} Shopify store via the connected Shopify MCP (or drop its CSV export) — audience numbers are never fabricated for a market we have no data for.` };
  }
  const monthly = m.monthly || [];
  const newC = Number(s.new_customers || 0);
  const retC = Number(s.returning_customers || 0);
  const total = newC + retC;
  const src = m.live ? `Live Shopify Admin snapshot (${m.live.store_url || m.live.shop || 'connected store'}, pulled ${m.live.pulled_at || 'recently'})` : 'Real Shopify CSV export';
  const win = monthly.length ? `${monthLabel(monthly[0].month)} → ${monthLabel(monthly[monthly.length - 1].month)}` : 'the export window';
  return {
    ok: true, market: mk, currency: cur(mk),
    data_source: m.live ? 'shopify_admin_live' : 'shopify_csv_export',
    source: src,
    window: win,
    purchasing_customers: total,
    new_customers: newC,
    returning_customers: retC,
    returning_rate_pct: round2((s.returning_rate || 0) * 100),
    orders: Number(s.orders || 0),
    note: `Purchasing customers = unique buyers on the ${mk} store over ${win} (Shopify). Total email/SMS list size (all subscribers, including non-buyers) is a Klaviyo figure and is not counted here.`,
  };
}

/** Rich real performance snapshot for a market — the payload KicksGPT reasons over. */
function performance(market) {
  const mk = normMarket(market);
  const m = (data().markets || {})[mk];
  if (!m) {
    const have = Object.keys((data().markets) || {}).join(', ') || 'none';
    return { ok: false, market: mk, error: `No market analytics loaded for ${mk} yet. Available now: ${have}. To add ${mk}, authorize the ${mk} Shopify store via the connected Shopify MCP (or drop its CSV export) — no numbers are ever fabricated for a market we have no data for.` };
  }
  const monthly = m.monthly || [];
  const topRev = (m.top_products || []).slice(0, 10);
  const topQty = (m.top_by_qty || m.top_products || []).slice().sort((a, b) => (b.quantity || 0) - (a.quantity || 0)).slice(0, 10);
  const mom = monthly.length >= 2 ? (() => {
    const a = monthly[monthly.length - 1], b = monthly[monthly.length - 2];
    return { latest: monthLabel(a.month), latest_sales: round2(a.sales), prev: monthLabel(b.month), prev_sales: round2(b.sales), change_pct: pctChange(a.sales, b.sales), note: 'latest month is partial — compare with the run-rate projection, not the raw month total' };
  })() : null;
  const src = m.live ? `Live Shopify Admin snapshot (${m.live.store_url || m.live.shop || 'connected store'}, pulled ${m.live.pulled_at || 'recently'})` : 'Real Shopify CSV export';
  return {
    ok: true, market: mk, currency: cur(mk),
    data_source: m.live ? 'shopify_admin_live' : 'shopify_csv_export',
    live: m.live || null,
    window_note: `${src}${monthly.length ? ` covering ${monthLabel(monthly[0].month)} → ${monthLabel(monthly[monthly.length - 1].month)}` : ''}. The latest month is partial (in progress).`,
    summary: m.summary || null,
    top_products_by_revenue: topRev,
    top_products_by_units: topQty,
    monthly_trend: monthly.map((r) => ({ month: monthLabel(r.month), sales: round2(r.sales), orders: r.orders, aov: round2(r.aov) })),
    month_on_month: mom,
    current_month_projection: projectCurrentMonth(monthly),
    product_types: (m.product_types || []).slice(0, 12),
    channels: m.channels || [],
    referrers: m.referrers || [],
    sessions: m.sessions || [],
    discount_split: m.discount || [],
    returning_customer_rate: m.summary ? round2((m.summary.returning_rate || 0) * 100) : null,
  };
}

// Market-level month-on-month dips (real). Product-level dips are NOT possible
// from these exports (top_products is a trailing TOTAL, not a monthly series);
// that needs a per-product monthly feed, flagged rather than fabricated.
function marketDips(market, dropPct = 0.15) {
  const p = performance(market);
  if (!p.ok || !p.month_on_month || p.month_on_month.change_pct == null) return [];
  const c = p.month_on_month.change_pct;
  if (c <= -dropPct * 100) return [{ market: p.market, metric: 'Revenue (month-on-month)', change_pct: c, latest: p.month_on_month.latest, note: 'latest month is partial; confirm against run-rate' }];
  return [];
}

module.exports = { performance, audience, marketDips, data, normMarket, cur };
