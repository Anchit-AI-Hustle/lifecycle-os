'use strict';

/**
 * KNICKGASM Smart Brain service layer.
 *
 * The module is intentionally dependency-light so it can run inside one Vercel
 * serverless function. It exposes clean service contracts for KB, Analysis,
 * Competitor Benchmarking, Calendar Intelligence, Generation, and Review.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildEntryAnalysis, buildGenerationAnalysis, explainConfidence } = require('../../api/_shared/output-reasoning');
// Per-market daily attributed-email revenue target in USD (spec §24a). Drives
// per-slot revenue-feasibility so sub-threshold cohorts are flagged, not assumed
// viable. US floor is $1,000/day per the product owner (2026-07-12); other
// markets default to $1,500 until set. Region-aware so each market's feasibility
// is judged against ITS OWN target, never a single blanket number.
const DAILY_REVENUE_TARGET_USD = { US: 1000, UK: 1500, GLOBAL: 1500, DEFAULT: 1500 };
function dailyRevenueTargetFor(market) {
  const m = String(market || '').toUpperCase();
  return DAILY_REVENUE_TARGET_USD[m] || DAILY_REVENUE_TARGET_USD.DEFAULT;
}
let reviewRecovery = null;
try { reviewRecovery = require('../../api/_shared/review-recovery.js'); } catch (_) { reviewRecovery = null; }

const DEFAULT_CONFIG = {
  markets: ['US', 'UK'],
  // Rolling horizon the Smart Brain plans + prebuilds ahead. 90 days so every
  // slot in the next quarter always exists AND has its assets prebuilt (see the
  // convergent prebuild queue in api/_shared/smart-brain-plan.js). Was 15.
  calendarDays: 90,
  // Daily freshness window: near-term tentative slots (this many days out) have
  // their prebuilt mailer/ads/landing assets REGENERATED every daily sync so the
  // reviewer always sees creatives built against the latest competitor
  // benchmarks + campaign data (as of the last sync). Slots beyond the window
  // stay built-once until they materially re-plan (bounds daily generation cost).
  prebuildRefreshDays: 7,
  performanceThresholds: {
    email: { openRate: 0.22, clickRate: 0.018, conversionRate: 0.006, revenuePerRecipient: 0.08 },
    meta: { ctr: 0.009, cvr: 0.012, roas: 1.6 },
    google: { ctr: 0.025, cvr: 0.018, roas: 1.8 },
    tiktok: { ctr: 0.007, cvr: 0.008, roas: 1.3 },
    landing_page: { conversionRate: 0.018 },
  },
  confidence: {
    minHumanVerificationConfidence: 0.82,
    weeklyRecalibrationDays: 7,
  },
  capacity: {
    emailPerMarketPerWeek: 4,
    paidCampaignsPerMarketPerWeek: 5,
  },
  // Reach + per-user frequency policy the daily planner targets. Each send aims
  // for minRecipients..targetRecipients real recipients (widening from the core
  // cohort to adjacent/broad audiences at ESP time when the core cohort is
  // smaller than the floor). Per-user weekly frequency is held to
  // minPerUserPerWeek..maxPerUserPerWeek — the calendar rotates cohorts so the
  // whole base is covered at that cadence; the hard per-user cap is enforced at
  // ESP send time (Phase 2), the planner sizes + documents the target here.
  frequency: {
    minRecipientsPerSend: 20000,
    targetRecipientsPerSend: 30000,
    minPerUserPerWeek: 2,
    maxPerUserPerWeek: 3,
  },
  // Sends scheduled PER DAY PER MARKET. 3-4 distinct cohorts a day keeps the whole
  // base covered at the 2-3/user/week cadence and underpins the >=70-80k USD/month
  // (~1000-1500 USD/day) revenue target. Each cohort is a separate calendar row
  // (MAILER 1/N ... N/N), deduped by the ESP suppression waterfall.
  cohortsPerDay: 4,
  // Rough revenue model for the monthly projection surfaced in the console KPIs.
  // Blended revenue-per-recipient for an at-cap lifecycle send; deliberately
  // conservative. Real numbers replace this once ESP send data flows in.
  revenuePerRecipient: 0.06,
  tableNames: {
    products: 'smart_products',
    assets: 'smart_assets',
    campaigns: 'smart_campaigns',
    campaignAssets: 'smart_campaign_assets',
    campaignMetrics: 'smart_campaign_metrics',
    users: 'smart_users',
    orders: 'smart_orders',
    events: 'smart_events',
    competitors: 'smart_competitor_campaigns',
    mvtResults: 'smart_mvt_results',
    feedback: 'smart_feedback',
    generatedCampaigns: 'smart_generated_campaigns',
    runs: 'smart_brain_runs',
    calendarEntries: 'smart_calendar_entries',
    adsGenerated: 'ads_generated',
    landingPagesGenerated: 'landing_pages_generated',
    mailersGenerated: 'mailers_generated',
  },
};

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return { ...base };
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v;
  }
  return out;
}

function smartConfig(overrides = {}) {
  let fileConfig = {};
  const cfgPath = path.join(process.cwd(), 'smart-brain.config.json');
  if (fs.existsSync(cfgPath)) {
    try { fileConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) { fileConfig = {}; }
  }
  return deepMerge(deepMerge(DEFAULT_CONFIG, fileConfig), overrides);
}

function idFor(prefix, input) {
  return `${prefix}_${crypto.createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 12)}`;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function round(n, digits = 4) { return Number.isFinite(+n) ? Number((+n).toFixed(digits)) : 0; }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function asArray(x) { return Array.isArray(x) ? x : []; }
function norm(s) { return String(s || '').trim(); }
function slug(s) { return norm(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'campaign'; }

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (quote && c === '"' && next === '"') { cell += '"'; i++; continue; }
    if (c === '"') { quote = !quote; continue; }
    if (!quote && c === ',') { row.push(cell); cell = ''; continue; }
    if (!quote && (c === '\n' || c === '\r')) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function readCsvIfExists(rel) {
  const p = path.join(process.cwd(), rel);
  if (!fs.existsSync(p)) return [];
  return parseCsv(fs.readFileSync(p, 'utf8'));
}

function loadFestivals() {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'festivals.json'), 'utf8')); }
  catch (_) { return {}; }
}

class SmartBrainDbAdapter {
  constructor(config = smartConfig()) {
    this.config = config;
    // Linked-DB-first: data/linked-db.json is the provided linked database.
    let linked = {};
    try { linked = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'linked-db.json'), 'utf8')); } catch (_) {}
    this.url = (process.env.SMART_BRAIN_SUPABASE_URL || linked.url || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    // Key precedence: a SERVICE-ROLE key must always win — it is the only key
    // that bypasses RLS, and without it every write is silently blocked (the
    // plan stays stored:false). The linked integration's ANON key is the LAST
    // resort, never ahead of a real service-role key, otherwise a linked anon
    // key masks the service-role key and no data persists.
    this.key = process.env.SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY
      || process.env.SMART_BRAIN_SUPABASE_KEY
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_KEY
      || linked.serviceRoleKey || linked.service_role_key
      || linked.anonKey || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    this.usingServiceRole = Boolean(process.env.SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY || process.env.SMART_BRAIN_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || linked.serviceRoleKey || linked.service_role_key);
  }
  get connected() { return Boolean(this.url && this.key); }
  headers() { return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }; }
  async select(table, params = {}) {
    if (!this.connected) return null;
    const search = new URLSearchParams({ select: params.select || '*' });
    if (params.limit) search.set('limit', String(params.limit));
    if (params.order) search.set('order', params.order);
    for (const [k, v] of Object.entries(params.filters || {})) search.set(k, v);
    const r = await fetch(`${this.url}/rest/v1/${table}?${search}`, { headers: this.headers() });
    if (!r.ok) {
      // Degrade gracefully: a failed read (missing table, wrong project, key
      // mismatch, transient error) returns no rows instead of throwing and
      // blanking the whole calendar. Writes still surface warnings elsewhere.
      let detail = ''; try { detail = (await r.text()).slice(0, 160); } catch (_) {}
      try { console.warn(`[smart-brain-db] select ${table} failed: ${r.status} ${detail} — returning []`); } catch (_) {}
      return [];
    }
    return r.json();
  }
  async insert(table, rows) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    const r = await fetch(`${this.url}/rest/v1/${table}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(rows) });
    if (!r.ok) return { ok: false, warning: `Supabase insert ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  async upsert(table, rows, onConflict = 'id', { resolution = 'merge-duplicates' } = {}) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    // resolution='ignore-duplicates' makes an insert that NEVER overwrites an existing
    // row — used by syncDaily so a slot approved mid-window is not clobbered back to tentative.
    const headers = { ...this.headers(), Prefer: `return=representation,resolution=${resolution}` };
    const r = await fetch(`${this.url}/rest/v1/${table}?on_conflict=${onConflict}`, { method: 'POST', headers, body: JSON.stringify(rows) });
    if (!r.ok) return { ok: false, warning: `Supabase upsert ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  async update(table, filters, patch) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(filters || {})) search.set(k, v);
    const r = await fetch(`${this.url}/rest/v1/${table}?${search}`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(patch) });
    if (!r.ok) return { ok: false, warning: `Supabase update ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  async delete(table, filters) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(filters || {})) search.set(k, v);
    // Guard: refuse an unfiltered DELETE (would wipe the table).
    if (![...search.keys()].length) return { ok: false, warning: `Supabase delete ${table} refused: no filters` };
    const r = await fetch(`${this.url}/rest/v1/${table}?${search}`, { method: 'DELETE', headers: this.headers() });
    if (!r.ok) return { ok: false, warning: `Supabase delete ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  async ownData() {
    if (this.connected) {
      const t = this.config.tableNames;
      const [products, assets, campaigns, campaignAssets, campaignMetrics, users, orders, events, mvtResults, feedback] = await Promise.all([
        this.select(t.products, { limit: 5000 }), this.select(t.assets, { limit: 5000 }),
        this.select(t.campaigns, { limit: 5000 }), this.select(t.campaignAssets, { limit: 10000 }),
        this.select(t.campaignMetrics, { limit: 20000 }), this.select(t.users, { limit: 20000 }),
        this.select(t.orders, { limit: 20000 }), this.select(t.events, { limit: 50000 }),
        this.select(t.mvtResults, { limit: 5000 }).catch(() => []), this.select(t.feedback, { limit: 5000 }).catch(() => []),
      ]);
      return { source: 'supabase', products, assets, campaigns, campaignAssets, campaignMetrics, users, orders, events, mvtResults, feedback };
    }
    return this.localFallbackData();
  }
  async competitorData() {
    if (this.connected) {
      const competitors = await this.select(this.config.tableNames.competitors, { limit: 5000, order: 'observed_at.desc' }).catch(() => []);
      return { source: 'supabase', competitors };
    }
    return { source: 'local-empty', competitors: [] };
  }
  localFallbackData() {
    const productsRaw = readCsvIfExists('input/uploaded_by_anchit/shopify_products.csv')
      .concat(readCsvIfExists('Knickgasm Product Catalog RegionWise/products_export_usa.csv'))
      .concat(readCsvIfExists('Knickgasm Product Catalog RegionWise/products_export_uk.csv'));
    const ordersRaw = readCsvIfExists('input/uploaded_by_anchit/shopify_orders.csv');
    const customersRaw = readCsvIfExists('input/uploaded_by_anchit/shopify_customers.csv');
    const campaignsRaw = readCsvIfExists('input/uploaded_by_anchit/klaviyo_campaigns.csv').concat(readCsvIfExists('data/klaviyo/campaigns.csv'));
    const products = productsRaw.slice(0, 500).map((p, i) => ({
      id: p.id || p.ID || p.Handle || `local_product_${i}`,
      sku: p.Variant_SKU || p['Variant SKU'] || p.SKU || p.Handle || `SKU-${i}`,
      title: p.Title || p.title || p.Name || p.Handle || `KNICKGASM Product ${i + 1}`,
      handle: p.Handle || p.handle || slug(p.Title || p.Name || `product-${i}`),
      category: p.Type || p['Product Category'] || p.Category || 'Sneaker & Streetwear',
      market: /uk/i.test(p.__file || '') ? 'UK' : 'US',
      price: num(p['Variant Price'] || p.Price || p.price, 0),
      tags: String(p.Tags || p.tags || '').split(',').map((x) => x.trim()).filter(Boolean),
    }));
    const campaigns = campaignsRaw.slice(0, 500).map((c, i) => ({
      id: c.id || c.Campaign_ID || c.Name || `local_campaign_${i}`,
      name: c.Name || c.Campaign || c.subject || c.Subject || `Lifecycle Campaign ${i + 1}`,
      channel: c.channel || c.Channel || 'email',
      market: c.market || c.Market || 'US',
      campaign_type: c.type || c.Type || 'lifecycle',
      subject: c.Subject || c.subject || c.Name || '',
      sent_at: c.Sent_At || c['Send Time'] || c.date || '',
      cohort_key: c.segment || c.Segment || 'All Customers',
    }));
    // No Supabase connection means no real performance metrics source. We do
    // NOT fabricate sends/opens/clicks/revenue — an empty metrics set is the
    // honest state (rollups compute to zero and campaigns simply don't clear
    // performance thresholds until real metrics are connected).
    const campaignMetrics = [];
    // User and order monetary fields come from the CSV only. When a column is
    // absent we leave the value at 0 (unknown) rather than inventing a spend or
    // order count from the row index.
    const users = customersRaw.slice(0, 1000).map((u, i) => ({
      id: u.id || u.ID || u.Email || `user_${i}`,
      email: u.Email || u.email || '',
      market: u.Country || u.country || 'US',
      total_spend: num(u['Total Spent'] || u.total_spend, 0),
      orders_count: num(u['Orders Count'] || u.orders_count, 0),
      last_order_at: u['Last Order Date'] || u.last_order_at || '',
      accepts_marketing: u['Accepts Marketing'] !== 'no',
      tags: String(u.Tags || '').split(',').map((x) => x.trim()).filter(Boolean),
    }));
    const orders = ordersRaw.slice(0, 2000).map((o, i) => ({
      id: o.id || o.Name || `order_${i}`,
      user_id: o.Customer_ID || o.Email || `user_${i % Math.max(users.length, 1)}`,
      market: o.Country || o['Shipping Country'] || 'US',
      total: num(o.Total || o['Total Price'] || o.Subtotal, 0),
      created_at: o.Created_At || o['Created at'] || o.created_at || '',
      product_sku: o.SKU || '',
    }));
    return { source: 'local-csv (no performance metrics)', products, assets: [], campaigns, campaignAssets: [], campaignMetrics, users, orders, events: [], mvtResults: [], feedback: [] };
  }
}

class KnowledgeBaseService {
  constructor(config) { this.config = config; }
  build(data) {
    const assetByCampaign = new Map();
    for (const ca of asArray(data.campaignAssets)) {
      const list = assetByCampaign.get(ca.campaign_id) || [];
      const asset = asArray(data.assets).find((a) => String(a.id) === String(ca.asset_id)) || ca;
      list.push(asset);
      assetByCampaign.set(ca.campaign_id, list);
    }
    const metricByCampaign = new Map();
    for (const m of asArray(data.campaignMetrics)) {
      const list = metricByCampaign.get(m.campaign_id) || [];
      list.push(normalizeMetric(m));
      metricByCampaign.set(m.campaign_id, list);
    }
    const indexedCampaigns = asArray(data.campaigns).map((c) => {
      const metrics = metricByCampaign.get(c.id) || [];
      const rollup = rollupMetrics(metrics);
      return {
        ...c,
        assets: assetByCampaign.get(c.id) || [],
        metrics,
        performance: rollup,
        hooks: extractHooks(c, assetByCampaign.get(c.id) || []),
        angles: extractAngles(c),
        formats: [...new Set((assetByCampaign.get(c.id) || []).map((a) => a.format || a.asset_type).filter(Boolean))],
      };
    });
    return {
      source: data.source,
      indexed_at: new Date().toISOString(),
      catalog: asArray(data.products),
      brandAssets: asArray(data.assets).filter((a) => /brand|logo|font|kit/i.test(`${a.asset_type || ''} ${a.tags || ''}`)),
      indexedCampaigns,
      userCount: asArray(data.users).length,
      orderCount: asArray(data.orders).length,
    };
  }
}

function normalizeMetric(m) {
  const sends = num(m.sends || m.recipients || m.delivered || m.impressions, 0);
  const impressions = num(m.impressions || sends, sends);
  const clicks = num(m.clicks, 0);
  const conversions = num(m.conversions || m.orders, 0);
  const spend = num(m.spend, 0);
  const revenue = num(m.revenue || m.attributed_revenue, 0);
  return {
    ...m,
    openRate: round(num(m.open_rate, num(m.opens, 0) / Math.max(sends, 1))),
    clickRate: round(num(m.click_rate || m.ctr, clicks / Math.max(impressions || sends, 1))),
    conversionRate: round(num(m.conversion_rate || m.cvr, conversions / Math.max(clicks || impressions || sends, 1))),
    revenuePerRecipient: round(revenue / Math.max(sends, 1)),
    // ROAS is undefined without spend (e.g. owned email) — report null (N/A),
    // never a sentinel like 999 that would masquerade as a real ratio.
    roas: spend > 0 ? round(revenue / spend, 2) : null,
    revenue,
    spend,
    sends,
    impressions,
    clicks,
    conversions,
  };
}

function rollupMetrics(metrics) {
  const total = metrics.reduce((a, m) => ({
    sends: a.sends + num(m.sends), impressions: a.impressions + num(m.impressions), clicks: a.clicks + num(m.clicks), conversions: a.conversions + num(m.conversions), revenue: a.revenue + num(m.revenue), spend: a.spend + num(m.spend), opens: a.opens + num(m.opens),
  }), { sends: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0, spend: 0, opens: 0 });
  return normalizeMetric(total);
}
function extractHooks(c, assets) {
  return [...new Set([c.subject, c.headline, c.hook, ...assets.map((a) => a.hook || a.alt || a.title)].filter(Boolean).map(String).slice(0, 8))];
}
function extractAngles(c) {
  const text = `${c.name || ''} ${c.subject || ''} ${c.campaign_type || ''}`.toLowerCase();
  return ['gift', 'anime', 'football', 'sport', 'gaming', 'wedding', 'pets', 'bling', 'air force', 'jordan', 'accessories', 'sale', 'holiday', 'drop'].filter((x) => text.includes(x));
}

class AnalysisService {
  constructor(config) { this.config = config; }
  analyze(kb, data) {
    const cohorts = buildCohorts(data.users, data.orders);
    const winningCampaigns = kb.indexedCampaigns.filter((c) => campaignClearsThreshold(c, this.config.performanceThresholds));
    const productScores = scoreProducts(kb.catalog, data.orders, winningCampaigns);
    const channelBenchmarks = buildChannelBenchmarks(kb.indexedCampaigns);
    const mvtLearnings = summarizeMvt(data.mvtResults);
    return {
      analyzed_at: new Date().toISOString(),
      thresholds: this.config.performanceThresholds,
      cohorts,
      winningCampaigns,
      productScores,
      channelBenchmarks,
      mvtLearnings,
      dailyInsights: buildDailyInsights({ cohorts, winningCampaigns, productScores, channelBenchmarks, mvtLearnings }),
    };
  }
}

function campaignClearsThreshold(c, thresholds) {
  const channel = String(c.channel || 'email').toLowerCase();
  const t = thresholds[channel] || thresholds.email;
  const p = c.performance || {};
  if (channel === 'email') return p.openRate >= t.openRate && p.clickRate >= t.clickRate && (p.conversionRate >= t.conversionRate || p.revenuePerRecipient >= t.revenuePerRecipient);
  return p.clickRate >= (t.ctr || 0) && p.conversionRate >= (t.cvr || 0) && p.roas >= (t.roas || 0);
}
function daysSince(dateish) {
  const t = new Date(dateish || 0).getTime();
  if (!t) return 9999;
  return Math.floor((Date.now() - t) / 86400000);
}
function cohortName(u) {
  const recency = daysSince(u.last_order_at || u.last_seen_at);
  const spend = num(u.total_spend || u.lifetime_value);
  const orders = num(u.orders_count || u.order_count);
  if (orders >= 4 && recency <= 90 && spend >= 180) return 'Champions';
  if (orders >= 3 && recency <= 120) return 'Loyalists';
  if (orders <= 1 && recency <= 45) return 'New Buyers';
  if (recency > 180 && spend >= 100) return 'Winback High-LTV';
  if (recency > 120) return 'At-Risk';
  return 'Nurture';
}
function buildCohorts(users, orders) {
  const byUser = new Map();
  for (const u of asArray(users)) byUser.set(String(u.id || u.email), { ...u });
  for (const o of asArray(orders)) {
    const id = String(o.user_id || o.customer_id || o.email || 'unknown');
    const u = byUser.get(id) || { id, market: o.market, total_spend: 0, orders_count: 0 };
    u.total_spend = num(u.total_spend) + num(o.total);
    u.orders_count = num(u.orders_count) + 1;
    if (!u.last_order_at || new Date(o.created_at) > new Date(u.last_order_at)) u.last_order_at = o.created_at;
    byUser.set(id, u);
  }
  const grouped = new Map();
  for (const u of byUser.values()) {
    const name = cohortName(u);
    const g = grouped.get(name) || { name, count: 0, revenue: 0, markets: {}, rules: [] };
    g.count += 1; g.revenue += num(u.total_spend || u.lifetime_value);
    const market = norm(u.market || u.country || 'Global');
    g.markets[market] = (g.markets[market] || 0) + 1;
    grouped.set(name, g);
  }
  return [...grouped.values()].map((g) => ({ ...g, revenue: round(g.revenue, 2), avgLtv: round(g.revenue / Math.max(g.count, 1), 2), rules: cohortRules(g.name) })).sort((a, b) => b.revenue - a.revenue);
}
function cohortRules(name) {
  const map = {
    Champions: ['orders_count >= 4', 'last_order_at <= 90 days', 'total_spend >= premium threshold'],
    Loyalists: ['orders_count >= 3', 'last_order_at <= 120 days'],
    'New Buyers': ['orders_count <= 1', 'first/last order <= 45 days'],
    'Winback High-LTV': ['last_order_at > 180 days', 'total_spend >= high-LTV threshold'],
    'At-Risk': ['last_order_at > 120 days'],
    Nurture: ['all remaining opted-in profiles'],
  };
  return map[name] || [];
}
function scoreProducts(products, orders, winningCampaigns) {
  const score = new Map();
  for (const p of asArray(products)) score.set(p.sku || p.id, { product: p, orderCount: 0, revenue: 0, winningMentions: 0, score: 0 });
  for (const o of asArray(orders)) {
    const key = o.product_sku || o.sku || o.variant_sku;
    if (!score.has(key)) continue;
    const s = score.get(key); s.orderCount += 1; s.revenue += num(o.total || o.line_total);
  }
  for (const c of asArray(winningCampaigns)) {
    const key = c.hero_sku || c.product_sku;
    if (score.has(key)) score.get(key).winningMentions += 1;
  }
  return [...score.values()].map((s) => ({ ...s, score: round(s.orderCount * 1.5 + s.revenue / 100 + s.winningMentions * 10, 2) })).sort((a, b) => b.score - a.score).slice(0, 50);
}
function buildChannelBenchmarks(campaigns) {
  const groups = {};
  for (const c of asArray(campaigns)) {
    const ch = String(c.channel || 'email').toLowerCase();
    groups[ch] ||= [];
    groups[ch].push(c.performance || {});
  }
  return Object.fromEntries(Object.entries(groups).map(([ch, ms]) => [ch, {
    count: ms.length,
    avgClickRate: round(ms.reduce((a, m) => a + num(m.clickRate), 0) / Math.max(ms.length, 1)),
    avgConversionRate: round(ms.reduce((a, m) => a + num(m.conversionRate), 0) / Math.max(ms.length, 1)),
    // Only campaigns with spend have a ROAS; average over those, null if none.
    avgRoas: (() => {
      const withRoas = ms.filter((m) => Number.isFinite(m.roas));
      return withRoas.length ? round(withRoas.reduce((a, m) => a + Math.min(m.roas, 20), 0) / withRoas.length, 2) : null;
    })(),
  }]));
}
function summarizeMvt(rows) {
  return asArray(rows).map((r) => ({ variable: r.variable || r.test_name, winner: r.winner || r.winning_variant, lift: num(r.lift || r.relative_lift), confidence: num(r.confidence, 0.5) })).filter((r) => r.confidence >= 0.7).slice(0, 25);
}
function buildDailyInsights({ cohorts, winningCampaigns, productScores, mvtLearnings }) {
  return [
    `${winningCampaigns.length} own campaigns clear current performance thresholds and are eligible for creative reuse.`,
    `Top cohort by revenue is ${cohorts[0]?.name || 'N/A'} (${cohorts[0]?.count || 0} profiles).`,
    `Highest-scored hero product is ${productScores[0]?.product?.title || 'N/A'}.`,
    `${mvtLearnings.length} statistically useful MVT learnings are active in generation rules.`,
  ];
}

class CompetitorBenchmarkingService {
  constructor(config) { this.config = config; }
  benchmark(data) {
    const competitors = asArray(data.competitors).map((c) => ({ ...c, channel: String(c.channel || c.campaign_type || 'unknown').toLowerCase() }));
    const byChannel = {};
    const hooks = {};
    for (const c of competitors) {
      byChannel[c.channel] ||= { count: 0, activeBrands: new Set(), formats: {} };
      byChannel[c.channel].count += 1;
      if (c.brand) byChannel[c.channel].activeBrands.add(c.brand);
      const fmt = c.format || c.asset_type || 'unknown';
      byChannel[c.channel].formats[fmt] = (byChannel[c.channel].formats[fmt] || 0) + 1;
      for (const h of [c.hook, c.headline, c.subject].filter(Boolean)) hooks[h] = (hooks[h] || 0) + 1;
    }
    return {
      source: data.source,
      isolated: true,
      observed_at: new Date().toISOString(),
      byChannel: Object.fromEntries(Object.entries(byChannel).map(([k, v]) => [k, { ...v, activeBrands: [...v.activeBrands] }])),
      trendingHooks: Object.entries(hooks).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([hook, count]) => ({ hook, count })),
      note: 'Competitive benchmarks inform prioritization only; they are not used to qualify own campaign-library winners.',
    };
  }
}

class CalendarIntelligenceService {
  constructor(config) { this.config = config; this.festivals = loadFestivals(); }
  generate({ analysis, competitorBenchmarks, startDate = todayIso(), days = this.config.calendarDays, feedback = [] }) {
    const entries = [];
    const cohorts = analysis.cohorts.length ? analysis.cohorts : [{ name: 'Nurture', count: 0 }];
    const products = analysis.productScores.length ? analysis.productScores : [{ product: { title: 'KNICKGASM Sneaker Assortment', sku: 'KNICKGASM-BUNDLE' }, score: 1 }];
    const winners = analysis.winningCampaigns;
    const feedbackMap = summarizeFeedback(feedback);
    // 3-4 distinct cohorts per day per market (config.cohortsPerDay). Cohort +
    // product picks rotate on an ABSOLUTE day number (not the offset from a
    // moving startDate) so a given calendar date always resolves to the SAME
    // cohorts across daily syncs → stable ids, no churn.
    const perDay = Math.max(1, Math.min(this.config.cohortsPerDay || 3, cohorts.length));
    const fq = this.config.frequency || {};
    for (let d = 0; d < days; d++) {
      const date = addDays(startDate, d);
      const epoch = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) || d;
      for (const market of this.config.markets) {
        const festival = festivalOn(this.festivals, market, date);
        for (let k = 0; k < perDay; k++) {
          const cohort = cohorts[(epoch + k) % cohorts.length];
          // Vary the hero per cohort-slot (k) with a stride coprime-ish to the
          // catalog size so 4 same-day sends don't all share one hero.
          const product = products[(epoch + k + market.length) % products.length].product;
          // 1-2 supporting products for a bundle, distinct from the hero.
          const supporting = [1, 2]
            .map((o) => products[(epoch + k + o) % products.length].product)
            .filter((p) => (p.sku || p.id) !== (product.sku || product.id))
            .filter((p, i, a) => a.findIndex((q) => (q.sku || q.id) === (p.sku || p.id)) === i)
            .slice(0, 2);
          const winningTemplate = winners[(epoch + k + entries.length) % Math.max(winners.length, 1)] || null;

          // Every slot ships the FULL funnel so no asset is ever missing from a
          // preview/approval: mailer + Meta + Google + TikTok ads + landing page.
          const channels = ['email', 'meta', 'google', 'tiktok', 'landing_page'];
          const objective = objectiveFor(cohort.name, festival);
          const offer = offerDecision(cohort.name, objective);
          // Reach plan: aim each send at min..target real recipients. If the core
          // cohort is smaller than the floor, the send widens to adjacent/broad
          // audiences at ESP time to still reach the minimum.
          const minR = fq.minRecipientsPerSend || 20000;
          const targetR = fq.targetRecipientsPerSend || 30000;
          const cohortSize = cohort.count || 0;
          // Zero-fabrication reach: only report a recipient count when a REAL
          // cohort base is present. With no ESP/Klaviyo feed wired (blocker B3)
          // the true eligible count is unknown, so planned_recipients stays null
          // and the note flags the data dependency instead of inventing ~20k.
          const hasRealBase = cohortSize > 0;
          const reach = {
            cohort_size: hasRealBase ? cohortSize : null,
            cohort_size_estimated: !hasRealBase,
            min_recipients: minR,
            target_recipients: targetR,
            planned_recipients: hasRealBase ? Math.min(cohortSize, targetR) : null,
            meets_floor_from_core: hasRealBase ? cohortSize >= minR : false,
            per_user_per_week: { min: fq.minPerUserPerWeek || 2, max: fq.maxPerUserPerWeek || 3 },
            // Promotional frequency policy the plan-time pass below enforces per
            // (market, cohort); true cross-cohort per-profile capping runs at ESP
            // send-time once the profile feed (B3) is wired.
            frequency_cap: { per_rolling_7d: 2, absolute_max: 3, sends_in_rolling_7d: null, over_cap: false, enforced_at: 'plan-time per-(market,cohort) check + ESP send-time suppression' },
            widen_note: hasRealBase
              ? (cohortSize >= minR
                ? 'Core cohort alone meets the recipient floor.'
                : `Core cohort (${cohortSize}) is below the ${minR} floor; widen to adjacent/broad audiences at ESP to reach the minimum.`)
              : `[DATA REQUIRED BEFORE LAUNCH: real eligible-segment size for "${cohort.name}" in ${market}. Wire the ESP/Klaviyo feed (B3); reach is not estimated to avoid fabrication.]`,
          };
          // Revenue feasibility per slot. A send's projected revenue = real
          // recipients × blended revenue-per-recipient, compared to this slot's
          // share of the daily target. Tiny cohorts (the honest reality without a
          // wider eligible base) are flagged, never silently treated as viable.
          const rpr = this.config.revenuePerRecipient || 0.06;
          const dailyTarget = dailyRevenueTargetFor(market);
          const perSendTarget = round((dailyTarget / Math.max(1, this.config.cohortsPerDay || 3)), 0);
          const projectedRevenue = hasRealBase ? round(cohortSize * rpr, 2) : null;
          const feasibility = {
            daily_target: dailyTarget,
            per_send_target: perSendTarget,
            projected_revenue: projectedRevenue,
            currency: 'USD',
            status: !hasRealBase
              ? 'DATA REQUIRED'
              : (projectedRevenue >= perSendTarget
                ? 'FEASIBLE'
                : ((cohortSize >= minR * 0.25 || projectedRevenue >= perSendTarget * 0.5)
                  ? 'REQUIRES MORE ELIGIBLE REACH'
                  : 'NOT FEASIBLE')),
            note: hasRealBase
              ? `~${cohortSize} recipients × $${rpr}/recipient ≈ $${projectedRevenue} vs ~$${perSendTarget}/send (${market} target $${dailyTarget}/day).`
              : `No real eligible-segment size yet (wire the ESP feed, B3). ${market} daily target $${dailyTarget}.`,
          };
          const mvtPlan = buildMvtPlan(analysis.mvtLearnings, channels);
          const competitorCtx = competitorContext(competitorBenchmarks, channels);
          // Confidence VARIES per slot from real signals (no flat 0.70). The old
          // model gave every row the winner bonus + nothing else, so scores
          // collapsed to base+0.18. Now graduated cohort reach (which honestly
          // PENALISES thin cohorts), product score, festival weight and offer
          // depth spread the score across its true range.
          const pscore = products.find((p) => (p.product && (p.product.sku || p.product.id)) === (product.sku || product.id))?.score;
          const conf = explainConfidence([
            { when: !!winningTemplate, label: 'Informed by a prior own-campaign winner', delta: 0.10, detail: winningTemplate ? `Patterns from "${winningTemplate.name}".` : '' },
            { when: (festival?.weight >= 7), label: 'High-weight festival window', delta: 0.08, detail: festival ? `Timed to ${festival.name} (weight ${festival.weight}).` : '' },
            { when: (festival && festival.weight >= 4 && festival.weight < 7), label: 'Seasonal window', delta: 0.04, detail: festival ? `Aligned to ${festival.name}.` : '' },
            { when: (cohortSize >= 5000), label: 'Large addressable cohort', delta: 0.10, detail: `${cohortSize} profiles gives statistically stable reach.` },
            { when: (cohortSize >= 1000 && cohortSize < 5000), label: 'Solid cohort size', delta: 0.06, detail: `${cohortSize} profiles is a workable base.` },
            { when: (cohortSize > 0 && cohortSize < 100), label: 'Thin cohort — low statistical reach', delta: -0.10, detail: `${cohortSize} profiles is well below a viable send size.` },
            { when: (typeof pscore === 'number' && pscore >= 0.8), label: 'Top-scored hero product', delta: 0.08, detail: `Hero product scores ${round(pscore, 2)} on the affinity model.` },
            { when: (typeof pscore === 'number' && pscore > 0 && pscore < 0.4), label: 'Lower-scored hero product', delta: -0.05, detail: `Hero product scores only ${round(pscore, 2)}.` },
            { when: (offer && offer.pct >= 0.15), label: 'At-cap incentive', delta: 0.04, detail: `${Math.round((offer.pct || 0) * 100)}% offer is the strongest allowed nudge.` },
            { when: (feedbackMap.positive > feedbackMap.negative), label: 'Positive reviewer feedback trend', delta: 0.06, detail: 'Recent human approvals outweigh rejections for similar slots.' },
          ]);
          const analysisObj = buildEntryAnalysis({
            cohort: { name: cohort.name, size: cohort.count },
            product: { title: product.title, sku: product.sku || product.id, score: products.find((p) => (p.product && (p.product.sku || p.product.id)) === (product.sku || product.id))?.score, category: product.category },
            festival,
            ownCampaign: winningTemplate ? { name: winningTemplate.name, performance: winningTemplate.performance } : null,
            competitor: competitorCtx,
            mvt: mvtPlan,
            channels,
            objective,
            market,
            confidence: conf,
            dataSource: analysis.source || 'preview',
            feedback: feedbackMap,
          });
          // Full "why this decision" object for the per-row decision panel.
          const decision = buildDecision({ cohort, product, supporting, festival, objective, offer, market, reach });

          entries.push({
            id: idFor('cal', { date, market, cohort: cohort.name }),
            date,
            market,
            status: 'needs_human_verification',
            confidence: conf.score,
            cohort: { name: cohort.name, size: cohort.count, rules: cohort.rules || [] },
            reach,
            feasibility,
            mailer_index: k + 1,
            mailer_total: perDay,
            channels,
            objective,
            offer,
            festival: festival ? { name: festival.name, weight: festival.weight, tags: festival.tags || [] } : null,
            heroProduct: { sku: product.sku || product.id, title: product.title, handle: product.handle, category: product.category },
            supportingProducts: supporting.map((p) => ({ sku: p.sku || p.id, title: p.title, handle: p.handle, category: p.category })),
            ownDataReference: winningTemplate ? { campaign_id: winningTemplate.id, name: winningTemplate.name, hooks: winningTemplate.hooks, performance: winningTemplate.performance } : null,
            competitorContext: competitorCtx,
            mvtPlan,
            rationale: buildCalendarRationale({ cohort, product, festival, winningTemplate }),
            analysis: analysisObj,
            decision,
          });
        }
      }
    }
    // Low-rated-product review recovery: if any product has a REAL rating below
    // the threshold (3.5), also schedule a review-invitation send to the
    // finished-packet, last-order cohort for that product. Fires only when real
    // rating data is present (productScores carry a rating) — never invents a
    // low rating or a send.
    if (reviewRecovery) {
      try {
        const extra = reviewRecovery.reviewRecoverySlots({ productScores: analysis.productScores || [], markets: this.config.markets, startDate, idFor });
        if (extra.length) entries.push(...extra);
      } catch (_) { /* review recovery is additive; never break the base plan */ }
    }
    // Plan-time promotional frequency cap. The contract caps a profile at 2
    // (absolute 3) promotional sends per rolling 7 days. Because a profile maps
    // largely to one cohort per rotation, an over-count of promotional sends to
    // a (market, cohort) means its members would breach the cap — so we count
    // sends in the rolling 7-day window ending on each slot's date and flag the
    // ones that exceed the absolute cap for a reviewer / ESP suppression to
    // reduce or delay. Non-promotional slots (no offer code) are not counted.
    (function enforceFrequencyCap() {
      const dayNum = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
      const isPromo = (e) => !!(e && e.offer && e.offer.code);
      const keyOf = (e) => `${e.market}|${(e.cohort && e.cohort.name) || ''}`;
      for (const e of entries) {
        const cap = e && e.reach && e.reach.frequency_cap;
        if (!cap) continue;
        const dn = dayNum(e.date);
        if (!isFinite(dn)) continue;
        const count = entries.filter((o) => isPromo(o) && keyOf(o) === keyOf(e) && isFinite(dayNum(o.date)) && dayNum(o.date) <= dn && dayNum(o.date) > dn - 7).length;
        cap.sends_in_rolling_7d = count;
        cap.over_cap = isPromo(e) && count > cap.absolute_max;
        if (cap.over_cap) cap.action = `Reduce or delay: ${count} promotional sends to "${(e.cohort && e.cohort.name) || 'cohort'}" (${e.market}) inside a rolling 7 days exceeds the absolute cap of ${cap.absolute_max}.`;
      }
    })();
    return { generated_at: new Date().toISOString(), start_date: startDate, days, entries, review: { dailyAutomation: true, weeklyHumanRecalibrationRequired: true } };
  }
}
function festivalOn(festivals, market, date) {
  const mmdd = date.slice(5);
  return [...(festivals[market] || []), ...(festivals.Global || [])].find((f) => f.date === mmdd || f.date_iso === date) || null;
}
function objectiveFor(cohort, festival) {
  if (festival) return 'seasonal conversion moment';
  if (/winback|at-risk/i.test(cohort)) return 'reactivation and replenishment';
  if (/champion|loyal/i.test(cohort)) return 'premium bundle expansion';
  if (/new/i.test(cohort)) return 'second-order activation';
  return 'education-led conversion';
}
function confidenceFor({ winningTemplate, festival, feedbackMap, cohort }) {
  let c = 0.52;
  if (winningTemplate) c += 0.18;
  if (festival?.weight >= 7) c += 0.08;
  if ((cohort.count || 0) > 1000) c += 0.08;
  if (feedbackMap.positive > feedbackMap.negative) c += 0.06;
  return round(Math.min(c, 0.96), 2);
}
function competitorContext(bench, channels) {
  return channels.filter((c) => c !== 'landing_page').map((channel) => ({ channel, benchmark: bench.byChannel[channel] || null, trendingHooks: bench.trendingHooks.slice(0, 3) }));
}
function buildMvtPlan(learnings, channels) {
  const variables = ['hook', 'offer_depth', 'hero_visual', 'cta', 'landing_page_length'];
  return variables.slice(0, Math.min(3, channels.length)).map((variable, i) => ({ variable, variants: [`control_${variable}`, `challenger_${variable}_${i + 1}`], apply_prior_learning: learnings.find((l) => l.variable === variable) || null }));
}
function summarizeFeedback(feedback) {
  return asArray(feedback).reduce((a, f) => { /reject|bad|negative/i.test(f.verdict || f.rating) ? a.negative++ : a.positive++; return a; }, { positive: 0, negative: 0 });
}
function buildCalendarRationale({ cohort, product, festival, winningTemplate }) {
  const parts = [`Targets ${cohort.name} using ${product.title || product.sku}.`];
  if (winningTemplate) parts.push(`Reuses patterns from high-performing own campaign "${winningTemplate.name}".`);
  if (festival) parts.push(`Aligned to ${festival.name}.`);
  return parts.join(' ');
}
// Discount decision for a slot — all codes are at/below the 15% cap (matches
// api/_shared/calendar-guardrails.js CODES). Returns {depth,pct,code,why}.
function offerDecision(cohortName, objective) {
  const s = `${cohortName || ''} ${objective || ''}`.toLowerCase();
  const mk = (depth, pct, code, why) => ({ depth, pct, code: pct > 0 ? code : '', why });
  if (/post.?purchase|nurture|thank|welcome ritual/.test(s) && !/new sub|non.?buyer|activation/.test(s)) return mk('none', 0, '', 'No discount right after purchase: protect margin, deepen the ritual before the next window.');
  if (/vip|champion|single.?studio|prestige|connoisseur|loyal/.test(s)) return mk('fif', 0.15, 'VIP15', 'VIP / loyal tier earns the full at-cap recognition offer.');
  if (/cart|checkout/.test(s)) return mk('fif', 0.15, 'CART15', 'High-intent cart recovery: at-cap incentive closes the loop.');
  if (/winback|win.?back|lapsed|at.?risk|non.?engager/.test(s)) return mk('fif', 0.15, 'IAMBACK', 'Lapsed buyers need the strongest allowed offer to re-activate.');
  if (/new|first.?purchase|activation|non.?buyer/.test(s)) return mk('fif', 0.15, 'NEW15', 'First-purchase activation: at-cap to convert a 0-order subscriber.');
  if (/gift|high.?aov/.test(s)) return mk('fif', 0.15, 'SAVE15', 'Gifting / high-AOV: at-cap with a $75 minimum that self-selects intent.');
  if (/replenish|subscribe|subscription|repeat/.test(s)) return mk('fif', 0.15, 'KNICKGASM15', 'Replenishment / subscription: at-cap to lock in the repeat ritual.');
  if (/affinity|black|green|kicks|streetwear|themed|iced|summer/.test(s)) return mk('fif', 0.15, 'SUMMER15', 'Affinity cohort with high repurchase intent: seasonal at-cap offer.');
  if (/browse|discovery|sampler|variety|undecided|cross/.test(s)) return mk('ten', 0.10, 'HELLO10', 'Discovery / browse: a light nudge, not a deep cut.');
  return mk('ten', 0.10, 'KNICKGASM10', 'General audience: light 10% nudge.');
}
function designArchetypeFor(objective) {
  const s = String(objective || '').toLowerCase();
  if (/reactivation|winback/.test(s)) return 'founder-note';
  if (/premium|bundle|expansion/.test(s)) return 'gift-bundle-showcase';
  if (/activation|second-order|education/.test(s)) return 'hero-spotlight';
  if (/seasonal|festival/.test(s)) return 'editorial-lookbook';
  return 'hero-spotlight';
}
// Full, human-readable "why this decision" object for the per-row detail panel:
// theme, topic, product (hero + bundle), offer/coupon, and design selection.
function buildDecision({ cohort, product, supporting, festival, objective, offer, market, reach }) {
  const sup = (supporting || []).map((p) => p.title).filter(Boolean);
  return {
    theme: { choice: objective + (festival ? ` · ${festival.name}` : ''), why: `Objective "${objective}" fits ${cohort.name}${festival ? ` and lands in the ${festival.name} window (weight ${festival.weight}/10)` : ''}.` },
    topic: { choice: product.title, why: `${product.title} is the top-scored hero for ${cohort.name} in ${market}.` },
    product: { hero: product.title, supporting: sup, why: sup.length ? `Hero ${product.title}, bundled with ${sup.join(' and ')} to lift average order value.` : `Single hero ${product.title}; no bundle needed for this cohort.` },
    offer: { code: offer.code || null, depth: offer.depth, pct: offer.pct, why: offer.why },
    design: { variants: '2 Text + 2 Text + Visual', archetype: designArchetypeFor(objective), why: `${objective} reads best as a ${designArchetypeFor(objective)} layout; brand-locked palette (violet / lava / chalk) + Montserrat / Instrument Sans, real product photography.` },
    reach: { planned_recipients: reach.planned_recipients, per_user_per_week: reach.per_user_per_week, why: reach.widen_note },
  };
}

class GenerationService {
  constructor(config) { this.config = config; }
  generate(entry) {
    const baseName = `${entry.market} ${entry.objective} · ${entry.heroProduct.title}`;
    const campaignId = idFor('campaign', entry);
    const audience = buildAudienceSpec(entry);
    const funnel = buildFunnelSpec(entry);
    const email = entry.channels.includes('email') ? buildEmailAsset(entry, campaignId) : null;
    const landing = entry.channels.includes('landing_page') ? buildLandingPageAsset(entry, campaignId) : [];
    const ads = buildAdAssets(entry, campaignId);
    return {
      schema_version: 'smart-campaign.v1',
      campaign_id: campaignId,
      name: baseName,
      status: entry.confidence >= this.config.confidence.minHumanVerificationConfidence ? 'ready_for_human_final_check' : 'needs_human_verification',
      approval: { required: true, reason: 'Launch-state safety policy requires human verification for every campaign before final.' },
      // Complete "why this was generated" analysis carried onto the campaign so
      // the reviewer sees the data-grounded reasoning, not just the assets.
      analysis: buildGenerationAnalysis(entry),
      market: entry.market,
      objective: entry.objective,
      cohort: entry.cohort,
      audience,
      retargeting: buildRetargetingSpec(entry),
      similarAudienceLogic: buildSimilarAudienceSpec(entry),
      funnel,
      assets: { email, landing_pages: landing, ads },
      platform_ready: {
        google_ads: ads.filter((a) => a.platform === 'google').map(platformAdObject),
        meta_ads: ads.filter((a) => a.platform === 'meta').map(platformAdObject),
        tiktok_ads: ads.filter((a) => a.platform === 'tiktok').map(platformAdObject),
        lifecycle_messaging: email ? [platformEmailObject(email, audience)] : [],
      },
      no_live_push: true,
      created_at: new Date().toISOString(),
    };
  }
}
function buildAudienceSpec(entry) {
  return { name: `${entry.market}_${slug(entry.cohort.name)}`, market: entry.market, inclusion_rules: entry.cohort.rules || [], exclusions: ['unsubscribed users', 'recent purchasers inside suppression window', 'users with unresolved support escalation'] };
}
function buildRetargetingSpec(entry) {
  return { windows: [{ name: 'site_view_no_purchase_14d', days: 14 }, { name: 'email_click_no_purchase_7d', days: 7 }, { name: 'cart_no_purchase_3d', days: 3 }], message: `Retarget ${entry.heroProduct.title} viewers with proof-led bundle or replenishment angle.` };
}
function buildSimilarAudienceSpec(entry) {
  return { seed: `${entry.cohort.name} purchasers in ${entry.market}`, similarity: '1-3% platform lookalike/equivalent', guardrails: ['exclude active purchasers already in lifecycle flow', 'separate prospecting from retargeting budget'] };
}
function buildFunnelSpec(entry) {
  return { steps: [{ step: 'creative', goal: 'earn click with cohort-specific hook' }, { step: 'landing_page', goal: 'convert with product proof, offer framing, reviews' }, { step: 'mailer_follow_up', goal: 'recover non-purchasers with education and urgency-safe reminder' }] };
}
function safeCopy(text) {
  // Full CLAUDE.md banned-phrase list (kept in sync with api/_shared/scenario-model.js
  // sanitizeBrand) — the prior regex missed game-changer / last chance /
  // while supplies last.
  return String(text || '')
    .replace(/LIMITED TIME/g, 'time-bound')
    .replace(/streetwear journey|liquid lava|game[\s-]?changer|hurry|don'?t miss out|last chance|while supplies last/gi, 'premium daily ritual')
    .replace(/\btransform(ing|ed|s|ation)?\b/gi, 'restore');
}
function buildEmailAsset(entry, campaignId) {
  const subject = safeCopy(`${entry.festival ? `${entry.festival.name}: ` : ''}${entry.heroProduct.title} for ${entry.cohort.name}`);
  const preheader = safeCopy(`A premium KNICKGASM edit built for ${entry.market} ${entry.cohort.name}.`);
  const HEAD = "'Montserrat','Raleway',Georgia,serif";
  const BODY = "'Instrument Sans','Helvetica Neue',Arial,sans-serif";
  const meta = `<!--\nSUBJECT_PRIMARY: ${subject}\nPREHEADER: ${preheader}\n-->\n`;
  const html = `${meta}<!doctype html><html><head><meta charset="utf-8"><title>${subject}</title></head><body style="margin:0;background:#FFFFFF;color:#111111;font-family:${BODY}"><main style="max-width:680px;margin:auto;background:#fff"><section style="background:#D0473E;color:#FFFFFF;padding:36px"><p style="color:#6A33D8;letter-spacing:.16em;text-transform:uppercase;font-family:${BODY}">KNICKGASM</p><h1 style="font-family:${HEAD};font-weight:500">${subject}</h1><p style="font-family:${BODY}">${preheader}</p></section><section style="padding:32px"><h2 style="font-family:${HEAD};color:#D0473E;font-weight:500">${entry.heroProduct.title}</h2><p style="font-family:${BODY}">Crafted around ${entry.objective}, this send connects the creative, landing page, and follow-up logic into one cohort-specific funnel.</p><a href="{{landing_page_url}}" style="background:#D0473E;color:#FFFFFF;padding:14px 20px;text-decoration:none;border-radius:2px;display:inline-block;font-family:${BODY};letter-spacing:1.4px;text-transform:uppercase">Shop the edit</a></section></main></body></html>`;
  return { id: `${campaignId}_email`, type: 'html_email', platform_targets: ['klaviyo', 'webengage'], subject, preheader, html, text: `${subject}\n${preheader}\nShop the edit: {{landing_page_url}}` };
}
function buildLandingPageAsset(entry, campaignId) {
  // Two variants, always: A = conversion/proof-led, B = story/editorial-led.
  // applyCopy() gives B a distinct headline + the real catalog product photo so
  // the pair is a genuine A/B (message + imagery). B is served at /lp/:id?v=b.
  const mk = (variant, title, blurb, sections) => ({
    id: `${campaignId}_landing_${variant.toLowerCase()}`, variant, type: 'landing_page',
    path: variant === 'A' ? `/lp/${campaignId}` : `/lp/${campaignId}?v=b`,
    title,
    html: `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:Arial,sans-serif;color:#111111;background:#FFFFFF"><section style="padding:56px 24px;background:#D0473E;color:#FFFFFF;text-align:center"><p style="color:#6A33D8;letter-spacing:.18em;text-transform:uppercase">KNICKGASM</p><h1>${title}</h1><p>${blurb}</p></section><section style="max-width:920px;margin:auto;padding:40px 24px"><h2>Why this edit</h2><ul><li>Premium sneaker and streetwear assortment selected for ${entry.cohort.name}.</li><li>Proof-led product storytelling and reviews section placeholder.</li><li>Retargeting and mailer follow-up are aligned to this same page promise.</li></ul><button style="background:#6A33D8;border:0;padding:16px 24px;font-weight:bold">Add to cart</button></section></body></html>`,
    sections,
  });
  const titleA = safeCopy(`${entry.heroProduct.title} · ${entry.market} ${entry.cohort.name} Edit`);
  const titleB = safeCopy(`The daily ritual behind ${entry.heroProduct.title}`);
  return [
    mk('A', titleA, safeCopy(entry.rationale || ''), ['hero', 'proof', 'product_grid', 'reviews', 'faq', 'sticky_cta']),
    mk('B', titleB, safeCopy(`Why ${entry.cohort.name} keep coming back to it.`), ['story_hero', 'ritual', 'single_product_spotlight', 'founder_note', 'reviews', 'sticky_cta']),
  ];
}
function buildAdAssets(entry, campaignId) {
  const hero = entry.heroProduct.title;
  const cohort = (entry.cohort && entry.cohort.name) || entry.market;
  // Ads ship in exactly TWO creative types — STATIC and VIDEO — never text-only.
  // (A paid ad is a designed image or a video, not a paragraph.) Static carries an
  // image design spec + overlay; Video carries a shot-by-shot storyboard + script.
  // Both follow paid-social benchmarking (Meta/TikTok/Google ad libraries): a hook
  // that lands in ~1.5s, Z-pattern visual hierarchy, social proof, ONE sticky CTA,
  // brand palette only, platform text-safe zones, and no fabricated offer/claim.
  const prodLed = safeCopy(`${hero}, chosen for ${cohort}. The KNICKGASM edit.`);
  const benefitLed = safeCopy(`The daily ritual ${cohort} keep coming back to. Meet ${hero}.`);
  const BRAND = 'brand palette only (violet #D0473E, lava #6A33D8, chalk #FFFFFF); real one-of-one packshot; WCAG-AA contrast; NO text baked into the base image (overlays are added in-platform)';
  const staticAd = (platform, aspect, placement) => ({
    id: `${campaignId}_${platform}_static`, platform, creative_type: 'static', variant: 'Static', format: 'static_image',
    placement, aspect, headline: safeCopy(hero), primary_text: prodLed, cta: 'Shop Now',
    creative_brief: `STATIC ${aspect} for ${placement}: hero packshot of ${hero} on ${BRAND}. Above-the-fold hook readable in 1.5s; headline overlay top (Z-pattern), a rating/social-proof chip, and one high-contrast CTA button bottom-right.`,
    overlay: { headline: safeCopy(hero), proof: 'Hand-painted one-of-one', cta: 'Shop Now' },
  });
  const videoAd = (platform, placement) => ({
    id: `${campaignId}_${platform}_video`, platform, creative_type: 'video', variant: 'Video', format: 'video',
    placement, aspect: '9:16', duration_s: 15, caption: benefitLed, cta: 'Shop Now',
    hook: safeCopy(`${cohort}: your calmer daily ritual starts here`),
    storyboard: [
      { t: '0-2s', scene: `HOOK: extreme close-up pour of ${hero}, on-screen hook text, sound-on stinger` },
      { t: '3-7s', scene: `the ${entry.objective} moment, hands cradling the pair, unhurried mood` },
      { t: '8-12s', scene: 'proof: packshot + rating/reviews + one-of-one origin cue' },
      { t: '13-15s', scene: 'CTA end-card: logo + Shop Now to the landing page' },
    ],
    script: `0-2s hook line; 3-7s benefit (${entry.objective}); 8-12s proof; 13-15s CTA to the landing page.`,
  });
  // Every relevant paid channel ships BOTH a Static AND a Video ad (two independent
  // creative types). The core paid mix (Meta, Google, YouTube, TikTok) always gets
  // both; Pinterest is added when the slot plans it. video_first orders the pair the
  // way the platform is consumed (video-native placements lead with the video).
  const AD_PLATFORMS = [
    { key: 'meta',      s_aspect: '1:1',    s_place: 'Feed 1:1 / 4:5',                v_place: 'Reels / Stories',            video_first: false },
    { key: 'google',    s_aspect: '1.91:1', s_place: 'Responsive Display / Demand Gen', v_place: 'Demand Gen video',        video_first: false },
    { key: 'youtube',   s_aspect: '1.91:1', s_place: 'Masthead / Companion banner',   v_place: 'Shorts / In-stream',         video_first: true  },
    { key: 'tiktok',    s_aspect: '9:16',   s_place: 'In-feed image card',            v_place: 'In-Feed video',              video_first: true  },
    { key: 'pinterest', s_aspect: '2:3',    s_place: 'Standard Pin',                  v_place: 'Idea / Video Pin',           video_first: false },
  ];
  const CORE = new Set(['meta', 'google', 'youtube', 'tiktok']); // always run both types
  const chans = entry.channels || [];
  const out = [];
  AD_PLATFORMS.forEach((p) => {
    if (!CORE.has(p.key) && !chans.includes(p.key)) return;
    const s = staticAd(p.key, p.s_aspect, p.s_place);
    const v = videoAd(p.key, p.v_place);
    out.push(...(p.video_first ? [v, s] : [s, v]));
  });
  return out;
}
function platformAdObject(a) { return { external_platform: a.platform, creative_id: a.id, format: a.format, copy: a, destination_url: '{{landing_page_url}}', push_status: 'not_integrated_phase_2' }; }
function platformEmailObject(email, audience) { return { external_platforms: email.platform_targets, message_id: email.id, audience, subject: email.subject, html: email.html, push_status: 'not_integrated_phase_2' }; }

class ReviewService {
  constructor(config) { this.config = config; }
  review(calendar, campaigns) {
    const needsHuman = campaigns.filter((c) => c.approval.required || c.status !== 'final');
    return {
      daily_review_completed_at: new Date().toISOString(),
      calendar_entries_reviewed: calendar.entries.length,
      generated_campaigns: campaigns.length,
      human_verification_required: needsHuman.length,
      weekly_recalibration: { required: true, minimum_frequency_days: this.config.confidence.weeklyRecalibrationDays, checklist: ['approve/reject calendar direction', 'validate cohorts and suppression rules', 'review performance thresholds', 'approve competitive benchmark use', 'sign off on generated assets'] },
      policy: 'Daily automated review updates plans without human involvement; every campaign still needs human verification before final, and full-system recalibration is mandatory weekly.',
    };
  }
}

async function runDailySmartBrain({ config: cfg = {}, startDate = todayIso(), days, persist = false } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const ownData = await db.ownData();
  const competitorData = await db.competitorData();
  const kb = new KnowledgeBaseService(config).build(ownData);
  const analysis = new AnalysisService(config).analyze(kb, ownData);
  const competitorBenchmarks = new CompetitorBenchmarkingService(config).benchmark(competitorData);
  const calendar = new CalendarIntelligenceService(config).generate({ analysis, competitorBenchmarks, startDate, days: days || config.calendarDays, feedback: ownData.feedback });
  const generator = new GenerationService(config);
  const campaigns = calendar.entries.map((entry) => generator.generate(entry));
  const review = new ReviewService(config).review(calendar, campaigns);
  const result = { ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', kb, analysis, competitorBenchmarks, calendar, campaigns, review };
  if (persist) {
    result.persistence = await db.insert(config.tableNames.runs, [{ id: idFor('run', { startDate, days, at: Date.now() }), payload: result, created_at: new Date().toISOString() }]);
  }
  return result;
}

function schemaAssumptions(config = smartConfig()) {
  return {
    tables: config.tableNames,
    required_contracts: {
      products: ['id', 'sku', 'title', 'handle', 'category', 'market', 'price', 'tags jsonb'],
      assets: ['id', 'asset_type', 'format', 'url', 'title', 'tags jsonb', 'metadata jsonb'],
      campaigns: ['id', 'name', 'channel', 'market', 'campaign_type', 'subject/headline', 'sent_at', 'cohort_key'],
      campaign_assets: ['campaign_id', 'asset_id', 'role'],
      campaign_metrics: ['campaign_id', 'creative_id', 'channel', 'market', 'sends/impressions', 'opens', 'clicks', 'conversions', 'revenue', 'spend', 'observed_at'],
      users: ['id', 'email/phone hash allowed', 'market', 'total_spend', 'orders_count', 'last_order_at', 'accepts_marketing', 'tags jsonb'],
      orders: ['id', 'user_id', 'market', 'total', 'created_at', 'product_sku'],
      competitor_campaigns: ['id', 'brand', 'channel', 'campaign_type', 'asset_type', 'hook/headline/subject', 'asset_url', 'observed_at'],
      generated_campaigns: ['id', 'payload jsonb', 'status', 'human_verified_at', 'created_at'],
      feedback: ['id', 'target_type', 'target_id', 'verdict', 'notes', 'created_at'],
    },
  };
}

module.exports = { smartConfig, SmartBrainDbAdapter, KnowledgeBaseService, AnalysisService, CompetitorBenchmarkingService, CalendarIntelligenceService, GenerationService, ReviewService, runDailySmartBrain, schemaAssumptions };
