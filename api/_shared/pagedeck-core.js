'use strict';

/**
 * Read-only PageDeck analytics and competitor-intelligence adapter.
 *
 * PageDeck's public documentation describes its analytics and A/B-test metrics,
 * but does not publish a stable public REST contract. This adapter therefore
 * supports two explicit, non-fabricated ingestion paths:
 *   1. PageDeck-provided JSON export/webhook URLs configured in env; or
 *   2. mirrored Supabase tables populated by a sanctioned export.
 *
 * No guessed PageDeck endpoint is ever called.
 */

const supa = require('./supa.js');
// Global live-connector kill-switch (default OFF).
const { liveConnectorsEnabled } = require('./live-connectors.js');

function clean(v) { return String(v == null ? '' : v).trim(); }
function nowIso() { return new Date().toISOString(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function first(o, keys, fallback) {
  for (const k of keys) if (o && o[k] != null) return o[k];
  return fallback;
}

async function fetchConfigured(url, kind) {
  // Live connectors default OFF — never fetch a live PageDeck export URL while
  // disabled; callers fall back to the Supabase mirror table.
  if (!liveConnectorsEnabled()) return { ok: false, connected: false, live_connectors_disabled: true, rows: [], source: kind, note: 'Live connectors are disabled (LIVE_CONNECTORS is off) — using the Supabase mirror table instead of a live PageDeck fetch.' };
  if (!url) return { ok: false, connected: false, rows: [], source: kind, note: `Set ${kind} export URL or load the Supabase mirror table.` };
  const headers = { accept: 'application/json' };
  const key = clean(process.env.PAGEDECK_API_KEY);
  if (key) headers.authorization = `Bearer ${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { method: 'GET', headers, signal: ctrl.signal, cache: 'no-store' });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = null; }
    if (!r.ok || body == null) return { ok: false, connected: true, rows: [], source: kind, status: r.status, error: body || text.slice(0, 200) };
    const rows = Array.isArray(body) ? body : (body.data || body.rows || body.results || []);
    return { ok: true, connected: true, rows: Array.isArray(rows) ? rows : [], source: kind, fetched_at: nowIso() };
  } catch (e) {
    return { ok: false, connected: true, rows: [], source: kind, error: String(e && e.message || e) };
  } finally { clearTimeout(timer); }
}

async function mirror(table, order = 'updated_at.desc', limit = 1000) {
  try {
    const rows = await supa.select(table, { order, limit });
    return { ok: true, connected: true, rows: Array.isArray(rows) ? rows : [], source: `supabase:${table}`, fetched_at: nowIso() };
  } catch (e) {
    return { ok: false, connected: false, rows: [], source: `supabase:${table}`, error: String(e && e.message || e) };
  }
}

async function sourceWithFallback(envName, table) {
  const live = await fetchConfigured(clean(process.env[envName]), envName);
  if (live.ok && live.rows.length) return live;
  const db = await mirror(table);
  if (db.ok && db.rows.length) return db;
  return {
    ok: false,
    connected: live.connected || db.connected,
    rows: [],
    source: live.connected ? live.source : db.source,
    note: live.note || `No rows in ${table}.`,
    errors: [live.error, db.error].filter(Boolean),
  };
}

function normalizePage(r) {
  const visitors = num(first(r, ['visitors', 'unique_visitors', 'users'], 0));
  const views = num(first(r, ['page_views', 'pageviews', 'views'], 0));
  const clicks = num(first(r, ['external_clicks', 'clicks', 'outbound_clicks'], 0));
  const conversions = num(first(r, ['conversions', 'orders', 'purchases'], 0));
  const revenue = num(first(r, ['revenue', 'conversion_value', 'sales'], 0));
  return {
    id: String(first(r, ['id', 'page_id', 'slug', 'url'], '')),
    name: String(first(r, ['name', 'title', 'page_name', 'slug'], '(unnamed page)')),
    url: first(r, ['url', 'page_url', 'live_url'], null),
    market: String(first(r, ['market', 'region', 'country'], 'ALL')).toUpperCase(),
    status: first(r, ['status', 'state'], null),
    visitors,
    page_views: views,
    avg_view_duration: num(first(r, ['avg_view_duration', 'average_view_duration', 'avg_time_seconds'], 0)),
    external_clicks: clicks,
    ctr: num(first(r, ['ctr', 'click_through_rate'], visitors ? clicks / visitors : 0)),
    conversions,
    conversion_rate: num(first(r, ['conversion_rate', 'cvr'], visitors ? conversions / visitors : 0)),
    revenue,
    aov: num(first(r, ['aov', 'average_order_value'], conversions ? revenue / conversions : 0)),
    bounce_rate: num(first(r, ['bounce_rate'], 0)),
    scroll_depth: num(first(r, ['scroll_depth', 'avg_scroll_depth'], 0)),
    load_ms: num(first(r, ['load_ms', 'load_time_ms', 'lcp_ms'], 0)),
    source: first(r, ['source', 'traffic_source'], null),
    updated_at: first(r, ['updated_at', 'synced_at', 'date'], null),
    raw: r,
  };
}

function twoProp(aVisitors, aConv, bVisitors, bConv) {
  const n1 = num(aVisitors), x1 = num(aConv), n2 = num(bVisitors), x2 = num(bConv);
  if (n1 < 30 || n2 < 30 || x1 > n1 || x2 > n2) return { z: null, confidence: null, significant: false };
  const p1 = x1 / n1, p2 = x2 / n2, pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(Math.max(0, pooled * (1 - pooled) * (1 / n1 + 1 / n2)));
  if (!se) return { z: null, confidence: null, significant: false };
  const z = (p2 - p1) / se;
  // Normal CDF approximation; enough for a directional experiment readout.
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  const confidence = Math.max(0, Math.min(1, erf));
  return { z, confidence, significant: confidence >= 0.95 };
}

function variantsOf(r) {
  const raw = first(r, ['variants', 'arms', 'pages'], []);
  if (Array.isArray(raw) && raw.length) return raw;
  const a = first(r, ['variant_a', 'control'], null);
  const b = first(r, ['variant_b', 'treatment'], null);
  return [a, b].filter(Boolean);
}

function normalizeExperiment(r) {
  const variants = variantsOf(r).map((v, i) => {
    const visitors = num(first(v, ['visitors', 'users', 'sessions'], 0));
    const conversions = num(first(v, ['conversions', 'orders', 'purchases'], 0));
    const revenue = num(first(v, ['revenue', 'sales', 'conversion_value'], 0));
    return {
      id: String(first(v, ['id', 'page_id'], i === 0 ? 'A' : `V${i + 1}`)),
      name: String(first(v, ['name', 'label', 'title'], i === 0 ? 'Control' : `Variant ${String.fromCharCode(65 + i)}`)),
      visitors,
      conversions,
      conversion_rate: num(first(v, ['conversion_rate', 'cvr'], visitors ? conversions / visitors : 0)),
      revenue,
      revenue_per_visitor: num(first(v, ['revenue_per_visitor', 'rpv'], visitors ? revenue / visitors : 0)),
      allocation: num(first(v, ['allocation', 'split', 'traffic_share'], 0)),
    };
  });
  const control = variants[0] || { visitors: 0, conversions: 0, conversion_rate: 0 };
  const challenger = variants.slice(1).sort((a, b) => b.conversion_rate - a.conversion_rate)[0] || null;
  const stat = challenger ? twoProp(control.visitors, control.conversions, challenger.visitors, challenger.conversions) : { confidence: null, significant: false, z: null };
  const totalVisitors = variants.reduce((a, b) => a + b.visitors, 0);
  const expected = variants.length ? totalVisitors / variants.length : 0;
  const srm = expected > 0 && variants.some((v) => Math.abs(v.visitors - expected) / expected > 0.15);
  const lift = challenger && control.conversion_rate > 0 ? (challenger.conversion_rate / control.conversion_rate) - 1 : null;
  return {
    id: String(first(r, ['id', 'experiment_id', 'test_id'], '')),
    name: String(first(r, ['name', 'title', 'test_name'], '(unnamed experiment)')),
    status: String(first(r, ['status', 'state'], 'unknown')),
    started_at: first(r, ['started_at', 'start_date'], null),
    ended_at: first(r, ['ended_at', 'end_date'], null),
    variants,
    winner: first(r, ['winner', 'winning_variant'], stat.significant && challenger ? challenger.name : null),
    lift,
    confidence: num(first(r, ['confidence', 'statistical_confidence'], stat.confidence)),
    significant: Boolean(first(r, ['significant'], stat.significant)),
    sample_ratio_mismatch: Boolean(first(r, ['sample_ratio_mismatch', 'srm'], srm)),
    revenue_impact: num(first(r, ['revenue_impact', 'incremental_revenue'], 0)),
    raw: r,
  };
}

function normalizeCompetitor(r) {
  return {
    id: String(first(r, ['id', 'page_id', 'url'], '')),
    brand: String(first(r, ['brand', 'brand_name', 'domain'], '(unknown brand)')),
    page: String(first(r, ['page', 'title', 'page_name', 'url'], '(unnamed page)')),
    url: first(r, ['url', 'page_url'], null),
    page_type: first(r, ['page_type', 'type'], null),
    offer: first(r, ['offer', 'offer_type'], null),
    first_seen: first(r, ['first_seen', 'created_at'], null),
    last_seen: first(r, ['last_seen', 'updated_at'], null),
    active_days: num(first(r, ['active_days', 'days_live'], 0)),
    linked_ads: num(first(r, ['linked_ads', 'ad_count', 'ads'], 0)),
    estimated_spend: first(r, ['estimated_spend', 'spend'], null),
    conversion_rate: first(r, ['conversion_rate', 'cvr'], null),
    source: first(r, ['source'], 'PageDeck / Lander Library export'),
    raw: r,
  };
}

function marketFilter(rows, market) {
  const m = String(market || '').toUpperCase();
  if (!m || m === 'GLOBAL' || m === 'ALL') return rows;
  return rows.filter((r) => !r.market || r.market === 'ALL' || r.market === m || (m === 'IN' && r.market === 'INDIA'));
}

async function analytics({ market } = {}) {
  const [pagesRaw, experimentsRaw, competitorsRaw] = await Promise.all([
    sourceWithFallback('PAGEDECK_ANALYTICS_EXPORT_URL', 'pagedeck_pages'),
    sourceWithFallback('PAGEDECK_EXPERIMENTS_EXPORT_URL', 'pagedeck_experiments'),
    sourceWithFallback('PAGEDECK_COMPETITOR_EXPORT_URL', 'pagedeck_competitor_pages'),
  ]);
  const pages = marketFilter(pagesRaw.rows.map(normalizePage), market);
  const experiments = experimentsRaw.rows.map(normalizeExperiment);
  const competitors = competitorsRaw.rows.map(normalizeCompetitor);
  const visitors = pages.reduce((a, b) => a + b.visitors, 0);
  const views = pages.reduce((a, b) => a + b.page_views, 0);
  const conversions = pages.reduce((a, b) => a + b.conversions, 0);
  const revenue = pages.reduce((a, b) => a + b.revenue, 0);
  const clicks = pages.reduce((a, b) => a + b.external_clicks, 0);
  return {
    ok: true,
    generated_at: nowIso(),
    market: market || 'ALL',
    connector: {
      connected: pagesRaw.connected || experimentsRaw.connected || competitorsRaw.connected,
      api_key_present: !!clean(process.env.PAGEDECK_API_KEY),
      sources: [pagesRaw.source, experimentsRaw.source, competitorsRaw.source],
      note: 'PageDeck data is read only from configured exports or Supabase mirrors; no undocumented endpoint is guessed.',
    },
    kpis: {
      pages: pages.length,
      visitors,
      page_views: views,
      external_clicks: clicks,
      ctr: visitors ? clicks / visitors : 0,
      conversions,
      conversion_rate: visitors ? conversions / visitors : 0,
      revenue,
      revenue_per_visitor: visitors ? revenue / visitors : 0,
      aov: conversions ? revenue / conversions : 0,
      live_experiments: experiments.filter((e) => /live|running|active/i.test(e.status)).length,
      significant_winners: experiments.filter((e) => e.significant && e.winner).length,
      srm_flags: experiments.filter((e) => e.sample_ratio_mismatch).length,
      competitor_pages: competitors.length,
      competitor_brands: new Set(competitors.map((c) => c.brand)).size,
    },
    pages,
    experiments,
    competitors,
    availability: {
      pages: { connected: pagesRaw.connected, rows: pages.length, note: pagesRaw.note, errors: pagesRaw.errors },
      experiments: { connected: experimentsRaw.connected, rows: experiments.length, note: experimentsRaw.note, errors: experimentsRaw.errors },
      competitors: { connected: competitorsRaw.connected, rows: competitors.length, note: competitorsRaw.note, errors: competitorsRaw.errors },
    },
  };
}

module.exports = { analytics, normalizePage, normalizeExperiment, normalizeCompetitor, twoProp };
