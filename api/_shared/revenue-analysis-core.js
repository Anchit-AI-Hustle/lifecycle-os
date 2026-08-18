'use strict';

/**
 * revenue-analysis-core.js — ONE combined revenue analysis across every
 * dimension the business actually has: region, channel, platform, campaign →
 * ad set → ad, mailer, landing page, product, cohort and time.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 * Every cut is ALWAYS present in the response, so the UI can render a tab for
 * each and nothing is silently missing. Each cut declares its own provenance:
 *
 *   { key, label, available, source, grain, rows, blocker, note }
 *
 * `available:false` + a `blocker` means "this analysis exists and is scoped,
 * but the source that could answer it is not connected". It never means an
 * empty array of zeroes dressed up as a finding.
 *
 * ── Where the numbers come from, and what is NOT used ───────────────────────
 * REAL: data/analytics/market-data.json, built by scripts/build-market-analytics.js
 * from the actual Shopify CSV exports (US 20,620 orders / UK). This is the only
 * first-party revenue truth in the repo, and it carries far more dimensions than
 * anything was reading: channel, product type, product, month, week, day of
 * week, discount split, new vs returning, acquisition and cohort retention.
 *
 * DELIBERATELY NOT USED: the `smart_*` Supabase tables (smart_orders,
 * smart_sales_history, smart_campaign_metrics …). They look like a perfect
 * revenue substrate — 4,530 orders, market/channel/campaign/spend/revenue
 * columns spanning 2024-06 to 2026-06 — but they are SEED FIXTURES, not real
 * trade: sequential ids (o_01317, u_0130), placeholder SKUs (VAH-US-004), totals
 * that are always whole dollars, discounts only ever 0/5/10/15, and a single
 * rfm_segment value ("champions"). Building revenue reporting on them would put
 * fabricated money in front of the business, which is the one thing this project
 * must never do. They are reported in `excluded_sources` so the exclusion is
 * visible rather than silent.
 *
 * LIVE WHEN CONNECTED: platform / campaign / ad set / ad revenue comes from the
 * ad platforms (Meta action_values, Google conversions_value, TikTok complete
 * payment value); mailer revenue from Klaviyo + WebEngage; landing-page revenue
 * from PageDeck. None is connected today, so each returns its blocker.
 */

const market = require('./market-analytics.js');
const adInsights = require('./ad-insights-core.js');
const adRows = require('./ad-rows-core.js');
const snow = require('./ads-snowflake-core.js');
const klaviyo = require('./klaviyo-core.js');
const webengage = require('./webengage-core.js');
const pagedeck = require('./pagedeck-core.js');
const shopify = require('./shopify-core.js');

const n = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
const round = (v, d = 2) => Math.round(n(v) * 10 ** d) / 10 ** d;
const rate = (a, b) => (n(b) ? round(n(a) / n(b), 4) : null);
const iso = () => new Date().toISOString();

// The seed tables we refuse to report as revenue, and why. Surfaced in the
// payload so "why isn't this using the orders table?" has an answer in-product.
const EXCLUDED_SOURCES = [{
  source: 'supabase smart_orders / smart_sales_history / smart_campaign_metrics',
  rows_present: '4530 / 1122 / 192',
  excluded_because: 'Seed fixtures, not real trade. Sequential ids (o_01317), placeholder SKUs (VAH-US-004), whole-dollar totals, discounts only ever 0/5/10/15, a single rfm_segment value. Reporting these as revenue would present fabricated money as real.',
  to_make_usable: 'Replace with a real order feed (Shopify Admin via /api/shopify, or a warehouse mirror of live orders).',
}];

/**
 * The ad account connector registry, scoped to a market. Exposed alongside the
 * cuts so a reader can see WHICH accounts the revenue figures could have come
 * from, and how many of them are structurally incapable of reporting revenue.
 */
function accountRegistry(mk) {
  let all = [];
  try { all = snow.adAccounts().map(snow.describeAccount); }
  catch (_) { return { accounts: [], summary: null }; }
  const scoped = all.filter((a) => !mk || !a.region || a.region === mk);
  const accounts = scoped.map((a) => ({
    id: a.id, label: a.label, platform: a.platform, region: a.region, status: a.status,
    account_id: a.account_id, kpi: a.kpi, attribution: a.attribution,
    can_report_revenue: a.kpi === 'roas',
    attribution_note: a.attribution_note || null,
    fresh_to: a.fresh_to, stale_days: a.stale_days, freshness: a.freshness,
  }));
  const byPlatform = {};
  accounts.forEach((a) => { byPlatform[a.platform] = (byPlatform[a.platform] || 0) + 1; });
  return {
    accounts,
    summary: {
      feeds: accounts.length,
      live: accounts.filter((a) => a.status === 'live').length,
      by_platform: byPlatform,
      revenue_capable: accounts.filter((a) => a.can_report_revenue).length,
      traffic_only: accounts.filter((a) => !a.can_report_revenue).length,
      note: 'traffic_only accounts are retail-media feeds whose checkout happens on a third-party site, so the brand pixel never fires. They report zero purchases by construction — judge them on CTR, CPC, CPM and reach, never ROAS.',
    },
  };
}

function cut(key, label, grain, extra) {
  return Object.assign({ key, label, grain, available: false, source: null, rows: [], blocker: null, note: null }, extra || {});
}

// ── Region ──────────────────────────────────────────────────────────────────
function byRegion() {
  const all = market.data().markets || {};
  const rows = Object.keys(all).map((mk) => {
    const s = (all[mk] || {}).summary || {};
    return {
      region: mk, orders: n(s.orders), gross_sales: round(s.gross_sales), net_sales: round(s.net_sales),
      total_sales: round(s.total_sales), aov: round(s.aov), quantity: n(s.quantity),
      new_customers: n(s.new_customers), returning_customers: n(s.returning_customers),
      returning_rate: s.returning_rate == null ? null : round(s.returning_rate, 4),
      revenue_per_customer: rate(s.total_sales, n(s.new_customers) + n(s.returning_customers)),
    };
  }).sort((a, b) => b.total_sales - a.total_sales);
  return cut('region', 'Revenue by region', 'market', {
    available: rows.length > 0, source: 'Shopify CSV export (data/analytics/market-data.json)', rows,
    note: rows.length ? `Regions with a loaded export: ${rows.map((r) => r.region).join(', ')}. Other markets need their export dropped into data/market/.` : null,
    blocker: rows.length ? null : 'No market export loaded — run scripts/build-market-analytics.js.',
  });
}

// ── Simple pass-through cuts off the real export ─────────────────────────────
function section(mk, name) {
  const m = (market.data().markets || {})[market.normMarket(mk)] || {};
  return Array.isArray(m[name]) ? m[name] : [];
}
function exportCut(key, label, grain, mk, name, map, blockerHint) {
  const rows = section(mk, name).map(map);
  return cut(key, label, grain, {
    available: rows.length > 0, source: 'Shopify CSV export (data/analytics/market-data.json)', rows,
    blocker: rows.length ? null : (blockerHint || `The ${mk} export carries no "${name}" section.`),
  });
}

function realCuts(mk) {
  return [
    exportCut('channel', 'Revenue by sales channel', 'channel', mk, 'channels', (r) => ({
      channel: r.channel, orders: n(r.orders), sales: round(r.sales), net: round(r.net), aov: round(r.aov),
      share_of_sales: null, // filled after totals are known
    })),
    exportCut('product_type', 'Revenue by product type / category', 'product_type', mk, 'product_types', (r) => ({
      product_type: r.type, net: round(r.net), orders: n(r.orders), quantity: n(r.quantity),
      net_per_order: rate(r.net, r.orders), net_per_unit: rate(r.net, r.quantity),
    })),
    exportCut('product', 'Revenue by product', 'product', mk, 'top_products', (r) => ({
      product: r.title, net: round(r.net), quantity: n(r.quantity), orders: n(r.orders),
      net_per_unit: rate(r.net, r.quantity),
    })),
    exportCut('month', 'Revenue by month', 'month', mk, 'monthly', (r) => ({
      month: r.month, orders: n(r.orders), sales: round(r.sales), aov: round(r.aov),
    })),
    exportCut('week', 'Revenue by week', 'week', mk, 'weekly', (r) => ({
      week: r.week, orders: n(r.orders), sales: round(r.sales), net: round(r.net), aov: round(r.aov),
    })),
    exportCut('day_of_week', 'Revenue by day of week', 'weekday', mk, 'day_of_week', (r) => ({
      day: r.dow, orders: n(r.orders), sales: round(r.sales), net: round(r.net), aov: round(r.aov),
    })),
    exportCut('discount', 'Discounted vs full price', 'discount_flag', mk, 'discount', (r) => ({
      discounted: r.discounted, orders: n(r.orders), sales: round(r.sales), net: round(r.net), aov: round(r.aov),
    })),
    exportCut('new_vs_returning', 'New vs returning revenue', 'month', mk, 'new_vs_returning', (r) => ({
      month: r.month, new_customers: n(r.new_c), returning_customers: n(r.ret_c),
      new_orders: n(r.new_o), returning_orders: n(r.ret_o),
      returning_order_share: rate(r.ret_o, n(r.new_o) + n(r.ret_o)),
    })),
    exportCut('acquisition', 'Acquisition cohort revenue', 'month', mk, 'acquisition', (r) => ({
      month: r.month, new_customers: n(r.new_c), orders: n(r.orders), sales: round(r.sales),
      sales_per_new_customer: rate(r.sales, r.new_c),
    })),
    exportCut('cohort_retention', 'Cohort retention', 'cohort', mk, 'cohort', (r) => ({
      cohort: r.cohort, base: n(r.base), retention: r.retention,
    })),
    exportCut('aov_trend', 'AOV trend', 'month', mk, 'aov_trend', (r) => ({
      month: r.month, aov: round(r.aov), orders: n(r.orders), sales: round(r.sales),
    })),
  ];
}

// ── Paid media: platform → campaign → ad set → ad ───────────────────────────
// Revenue per ad entity is only knowable from the ad platform itself. Meta
// reports it in action_values, Google in conversions_value, TikTok in
// total_complete_payment_value.
const AD_LEVELS = [
  { key: 'platform', label: 'Revenue by platform', level: 'account', grain: 'platform' },
  { key: 'campaign', label: 'Revenue by campaign', level: 'campaign', grain: 'campaign' },
  { key: 'adset', label: 'Revenue by ad set / ad group', level: 'adset', grain: 'adset' },
  { key: 'ad', label: 'Revenue by ad / creative', level: 'ad', grain: 'ad' },
];

/**
 * Every ad cut reads ALL THREE platforms through the shared normaliser in
 * ad-rows-core, so Meta, Google Ads and TikTok each contribute real rows. This
 * previously mapped Meta only and told the reader that Google and TikTok were
 * "served by the Live Ads view", which meant a connected Google account
 * contributed nothing to revenue by campaign.
 */
async function adCut(spec, mk, since, until, registry) {
  const results = await Promise.all(adInsights.PLATFORMS.map((p) =>
    adInsights.insights({ platform: p, market: mk, metricGroup: 'conversion', level: spec.level, since, until })
      .catch((e) => ({ ok: false, platform: p, error: e.message }))));

  const rows = [];
  const blockers = [];
  const contributing = [];
  for (const r of results) {
    if (!r) continue;
    if (r.not_connected) { blockers.push(`${r.platform}: set ${(r.need_env || []).join(', ')}`); continue; }
    if (!r.ok) { blockers.push(`${r.platform}: ${String(r.error).slice(0, 90)}`); continue; }
    const mapped = adRows.rowsFor(r);
    contributing.push(`${r.platform} (${mapped.length})`);
    mapped.forEach((x) => rows.push({
      platform: x.platform, level: x.level, entity: x.entity, entity_id: x.entity_id,
      campaign: x.campaign, adset: x.ad_group, account: x.account_name || x.account_id || null,
      spend: round(x.spend), revenue: round(x.revenue), conversions: round(x.conversions, 2),
      // A retail-media row has no pixel, so 0 conversions is expected, not a
      // result. Reporting ROAS 0 there would read as "sold nothing".
      roas: x.conversions || x.revenue ? round(x.roas, 2) : null,
      cpa: x.conversions ? round(x.cpa) : null,
      profit: x.revenue ? round(x.revenue - x.spend) : null,
      impressions: x.impressions, clicks: x.clicks,
      ctr: round(x.ctr, 4), cpc: round(x.cpc, 3), cpm: round(x.cpm),
    }));
  }
  const totals = adRows.rollup(rows.map((x) => ({ ...x, ad_group: x.adset })));
  return cut(spec.key, spec.label, spec.grain, {
    available: rows.length > 0,
    source: rows.length ? `Ad platform reporting APIs — ${contributing.join(', ')}` : null,
    rows: rows.sort((a, b) => n(b.revenue) - n(a.revenue) || n(b.spend) - n(a.spend)),
    totals: rows.length ? totals : null,
    accounts: registry && registry.length ? registry : null,
    blocker: rows.length ? null : (blockers.join(' · ') || 'No ad platform connected.'),
    note: 'Ad-platform revenue is platform-attributed and will not tie exactly to Shopify totals — attribution windows and view-through differ by platform.'
      + (rows.length && !totals.revenue_trustworthy ? ' ' + totals.revenue_note : ''),
  });
}

// ── Mailer + landing page ───────────────────────────────────────────────────
async function mailerCut(mk, hours) {
  const [we, klCon] = await Promise.all([
    webengage.campaignPerformance({ event: 'Notification Clicked', hours, market: mk, top: 100 }).catch((e) => ({ ok: false, error: e.message })),
    Promise.resolve(klaviyo.isConnected()),
  ]);
  const rows = [];
  if (we && we.ok && Array.isArray(we.campaigns)) {
    we.campaigns.forEach((c) => rows.push({
      mailer: c.campaign, source: 'WebEngage', events: n(c.events), unique_users: n(c.unique_users),
      revenue: c.revenue == null ? null : round(c.revenue),
    }));
  }
  const blockers = [];
  if (!klCon) blockers.push('Klaviyo: set KLAVIYO_API_KEY (+ LIVE_CONNECTORS=on) for per-campaign attributed revenue');
  if (!we || !we.ok) blockers.push(`WebEngage: ${(we && we.error) || 'no stored events'}`);
  return cut('mailer', 'Revenue by mailer / campaign send', 'mailer', {
    available: rows.some((r) => r.revenue != null),
    source: rows.length ? 'WebEngage stored events' : null, rows,
    blocker: rows.some((r) => r.revenue != null) ? null : (blockers.join(' · ') || 'No mailer source connected.'),
    note: 'Attributed mailer revenue requires Klaviyo — WebEngage events alone give engagement, not money.',
  });
}

async function landingCut(mk) {
  const d = await pagedeck.analytics({ market: mk }).catch((e) => ({ ok: false, error: e.message }));
  const pages = (d && Array.isArray(d.pages)) ? d.pages : [];
  const rows = pages.map((p) => ({
    page: p.name, status: p.status || null, visitors: n(p.visitors), conversions: n(p.conversions),
    conversion_rate: p.conversion_rate == null ? null : round(p.conversion_rate, 4),
    revenue: p.revenue == null ? null : round(p.revenue), aov: p.aov == null ? null : round(p.aov),
    revenue_per_visitor: rate(p.revenue, p.visitors),
  })).sort((a, b) => n(b.revenue) - n(a.revenue));
  return cut('landing_page', 'Revenue by landing page', 'landing_page', {
    available: rows.length > 0, source: rows.length ? ((d.connector && d.connector.sources || []).join(' · ') || 'PageDeck') : null, rows,
    blocker: rows.length ? null : ((d && d.connector && d.connector.note) || 'PageDeck not connected — set PAGEDECK_ANALYTICS_EXPORT_URL or populate the pagedeck_pages mirror.'),
  });
}

// ── Commerce truth check ────────────────────────────────────────────────────
async function liveCommerce(mk, days) {
  const s = await shopify.summary({ market: mk, days }).catch((e) => ({ ok: false, error: e.message }));
  return cut('live_orders', 'Live order feed (reconciliation)', 'window', {
    available: !!(s && s.ok),
    source: s && s.ok ? s.source : null,
    rows: s && s.ok ? [{ window_days: s.window_days, orders: s.orders, revenue: s.revenue, aov: s.aov,
      // shopify-core reports returning_rate_pct on a 0-100 scale; every rate in
      // this payload is a FRACTION, and both dashboards format _rate fields by
      // multiplying by 100 - passing the pct through rendered 54.3 as 5430%.
      returning_rate: s.returning_rate_pct == null ? null : round(s.returning_rate_pct / 100, 4),
      currency: s.currency }] : [],
    blocker: s && s.ok ? null : ((s && (s.blocker || s.error)) || 'Shopify not connected.'),
    note: 'The export cuts above are a point-in-time file. This is the live feed to reconcile them against.',
  });
}

/**
 * The whole analysis. `market` scopes the export-backed cuts; region is
 * cross-market by definition.
 */
async function revenue({ market: mk = 'US', since, until, days = 30, hours = 720 } = {}) {
  const mkN = market.normMarket(mk);
  const perf = market.performance(mkN);

  // The ad ACCOUNT CONNECTORS: which accounts exist, on which platform, whether
  // the feed is live, and — the part that changes the numbers — whether the
  // account can attribute revenue at all. A retail-media feed (a marketplace or
  // grocery retailer running ads for the brand on its own storefront) completes
  // the checkout OFF-SITE, where the brand pixel never fires, so it is
  // kpi:'traffic' and can never produce a ROAS. Which retailers those are is a
  // property of the connected accounts, not something this file should name:
  // the sibling listed its own four here, and that list is one company's
  // distribution footprint rather than a fact about the platform.
  const registry = accountRegistry(mkN);

  const [platform, campaign, adset, ad, mailer, landing, live] = await Promise.all([
    ...AD_LEVELS.map((spec) => adCut(spec, mkN, since, until, registry.accounts)),
    mailerCut(mkN, hours),
    landingCut(mkN),
    liveCommerce(mkN, days),
  ]);

  const cuts = [byRegion(), ...realCuts(mkN), platform, campaign, adset, ad, mailer, landing, live];

  // Share-of-sales is computed against the SUM OF THE CUT'S OWN ROWS, never
  // against summary.total_sales. The summary is a 2026-YTD window while the
  // channel breakdown spans the full export, so dividing one by the other put
  // "Online Store" at 167% of total. A share must only ever be taken over rows
  // that share a window.
  const chan = cuts.find((c) => c.key === 'channel');
  if (chan && chan.rows.length) {
    const cutTotal = chan.rows.reduce((a, r) => a + n(r.sales), 0);
    chan.rows.forEach((r) => { r.share_of_sales = rate(r.sales, cutTotal); });
    chan.note = `Share is of the ${round(cutTotal)} total across these channels, which spans the full export window — NOT the ${perf.ok && perf.summary ? perf.summary.window || 'summary' : 'summary'} figure shown in the header.`;
  }

  const available = cuts.filter((c) => c.available);
  return {
    ok: true, generated_at: iso(), market: mkN,
    currency: market.cur ? market.cur(mkN) : null,
    summary: perf.ok ? perf.summary : null,
    summary_source: perf.ok ? (perf.source || 'Shopify CSV export') : null,
    coverage: {
      total_cuts: cuts.length,
      available: available.length,
      blocked: cuts.length - available.length,
      available_keys: available.map((c) => c.key),
      blocked_keys: cuts.filter((c) => !c.available).map((c) => c.key),
    },
    cuts,
    ad_accounts: registry.summary,
    excluded_sources: EXCLUDED_SOURCES,
    note: 'Every revenue cut is listed whether or not it has data. A blocked cut names the source that would answer it — no cut is filled with zeroes or estimates.',
  };
}

module.exports = { revenue, byRegion, realCuts, AD_LEVELS, EXCLUDED_SOURCES };
