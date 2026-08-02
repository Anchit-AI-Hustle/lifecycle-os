'use strict';

/**
 * READ-ONLY paid-media reporting for KNICKGASM.
 *
 * Pulls fresh reporting data from Meta, Google Ads and TikTok. Supports account,
 * campaign, ad-group/ad-set and ad level so Data Analysis can inspect the exact
 * creative/entity driving a result. No campaign mutation endpoint is present.
 */

const GRAPH_VER = String(process.env.META_GRAPH_VERSION || 'v25.0').trim();
const GADS_VER = String(process.env.GOOGLE_ADS_API_VERSION || 'v24').trim();
const TIKTOK_BASE = 'https://business-api.tiktok.com/open_api/v1.3';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const PLATFORMS = ['meta', 'google', 'tiktok'];
const METRIC_GROUPS = ['conversion', 'traffic', 'engagement', 'all'];
const LEVELS = ['account', 'campaign', 'adgroup', 'adset', 'ad'];

function normMarket(m) {
  const s = String(m || 'US').trim().toUpperCase();
  if (['US', 'USA', 'UNITED STATES'].includes(s)) return 'US';
  if (['UK', 'GB', 'UNITED KINGDOM', 'BRITAIN'].includes(s)) return 'UK';
  if (['IN', 'IND', 'INDIA'].includes(s)) return 'IN';
  return s;
}
function normLevel(level) {
  const l = String(level || 'account').trim().toLowerCase().replace(/[-_ ]/g, '');
  if (l === 'adgroup') return 'adgroup';
  if (l === 'adset') return 'adset';
  if (l === 'campaign') return 'campaign';
  if (l === 'ad') return 'ad';
  return 'account';
}
function envFor(base, market) {
  const mk = normMarket(market);
  return String(process.env[`${base}_${mk}`] || process.env[base] || '').trim();
}
function qs(obj) {
  return Object.entries(obj || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
function toIso(d) { return d.toISOString().slice(0, 10); }
function defaultRange(days = 30) {
  const until = new Date();
  const since = new Date(Date.now() - days * 86400000);
  return { since: toIso(since), until: toIso(until) };
}
function uniq(xs) { return [...new Set(xs)]; }
function notConnected(platform, market, wouldRequest, needEnv, level) {
  return {
    ok: false, connected: false, not_connected: true,
    platform, market: normMarket(market), level: normLevel(level),
    would_request: wouldRequest,
    need_env: needEnv,
    hint: `Set ${needEnv.join(', ')} in Vercel env (append _${normMarket(market)} for a market-specific account) to fetch real ${platform} results. No ad figure is fabricated.`,
  };
}
async function fetchJson(url, opts = {}, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
    return { status: res.status, ok: res.ok, json };
  } finally { clearTimeout(t); }
}

// ── Meta Ads Insights ────────────────────────────────────────────────────────
const META_FIELDS = {
  conversion: ['spend', 'actions', 'action_values', 'purchase_roas', 'cost_per_action_type', 'impressions', 'clicks'],
  traffic: ['impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'reach', 'frequency', 'inline_link_clicks', 'spend'],
  engagement: ['impressions', 'reach', 'frequency', 'actions', 'cost_per_action_type', 'spend'],
};
const META_IDENT = {
  account: ['account_id', 'account_name'],
  campaign: ['account_id', 'account_name', 'campaign_id', 'campaign_name'],
  adset: ['account_id', 'account_name', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name'],
  adgroup: ['account_id', 'account_name', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name'],
  ad: ['account_id', 'account_name', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name'],
};
function metaMetricFields(group) {
  if (group === 'all') return uniq(Object.values(META_FIELDS).flat());
  return META_FIELDS[group] || META_FIELDS.conversion;
}
async function metaInsights({ market, metricGroup = 'conversion', since, until, level = 'account' } = {}) {
  const token = envFor('META_ACCESS_TOKEN', market);
  const acct = envFor('META_AD_ACCOUNT_ID', market);
  const l = normLevel(level) === 'adgroup' ? 'adset' : normLevel(level);
  const fields = uniq([...(META_IDENT[l] || META_IDENT.account), ...metaMetricFields(metricGroup)]);
  const range = (since && until) ? { since, until } : defaultRange();
  const path = `act_${acct || '{META_AD_ACCOUNT_ID}'}/insights`;
  const params = { level: l, fields: fields.join(','), time_range: JSON.stringify(range), limit: 5000 };
  const url = `https://graph.facebook.com/${GRAPH_VER}/${path}`;
  if (!token || !acct) return notConnected('meta', market, { method: 'GET', url, params }, ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'], l);
  const full = `${url}?${qs({ ...params, access_token: token })}`;
  const r = await fetchJson(full);
  if (!r.ok) return { ok: false, connected: true, platform: 'meta', market: normMarket(market), level: l, status: r.status, error: (r.json && r.json.error && r.json.error.message) || 'meta insights request failed', raw: r.json };
  return {
    ok: true, connected: true, platform: 'meta', market: normMarket(market), level: l,
    metric_group: metricGroup, window: range, source: `meta_graph_insights_${GRAPH_VER}`,
    fetched_at: new Date().toISOString(), data: (r.json && r.json.data) || [], paging: r.json && r.json.paging,
  };
}

// ── Google Ads GAQL ─────────────────────────────────────────────────────────
const GADS_METRICS = {
  conversion: ['metrics.conversions', 'metrics.conversions_value', 'metrics.cost_per_conversion', 'metrics.all_conversions', 'metrics.all_conversions_value', 'metrics.cost_micros'],
  traffic: ['metrics.impressions', 'metrics.clicks', 'metrics.ctr', 'metrics.average_cpc', 'metrics.cost_micros'],
  engagement: ['metrics.engagements', 'metrics.engagement_rate', 'metrics.interactions', 'metrics.interaction_rate', 'metrics.video_views', 'metrics.video_view_rate', 'metrics.cost_micros'],
};
const GADS_LEVEL = {
  account: { from: 'customer', fields: ['customer.id', 'customer.descriptive_name'] },
  campaign: { from: 'campaign', fields: ['campaign.id', 'campaign.name', 'campaign.status', 'campaign.advertising_channel_type'] },
  adgroup: { from: 'ad_group', fields: ['campaign.id', 'campaign.name', 'ad_group.id', 'ad_group.name', 'ad_group.status'] },
  adset: { from: 'ad_group', fields: ['campaign.id', 'campaign.name', 'ad_group.id', 'ad_group.name', 'ad_group.status'] },
  ad: { from: 'ad_group_ad', fields: ['campaign.id', 'campaign.name', 'ad_group.id', 'ad_group.name', 'ad_group_ad.ad.id', 'ad_group_ad.status', 'ad_group_ad.ad.type', 'ad_group_ad.ad.final_urls'] },
};
function googleMetricFields(group) {
  if (group === 'all') return uniq(Object.values(GADS_METRICS).flat());
  return GADS_METRICS[group] || GADS_METRICS.conversion;
}
function gaqlFor(metricGroup, since, until, level) {
  const spec = GADS_LEVEL[normLevel(level)] || GADS_LEVEL.account;
  const fields = uniq([...spec.fields, ...googleMetricFields(metricGroup)]).join(', ');
  const where = (since && until) ? `WHERE segments.date BETWEEN '${since}' AND '${until}'` : 'WHERE segments.date DURING LAST_30_DAYS';
  return `SELECT ${fields} FROM ${spec.from} ${where} ORDER BY metrics.cost_micros DESC LIMIT 5000`;
}
async function googleAccessToken(market) {
  const cid = envFor('GOOGLE_ADS_CLIENT_ID', market);
  const cs = envFor('GOOGLE_ADS_CLIENT_SECRET', market);
  const rt = envFor('GOOGLE_ADS_REFRESH_TOKEN', market);
  if (!cid || !cs || !rt) return null;
  const r = await fetchJson(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: qs({ client_id: cid, client_secret: cs, refresh_token: rt, grant_type: 'refresh_token' }),
  });
  return (r.json && r.json.access_token) || null;
}
async function googleInsights({ market, metricGroup = 'conversion', since, until, level = 'account' } = {}) {
  const l = normLevel(level);
  const dev = envFor('GOOGLE_ADS_DEVELOPER_TOKEN', market);
  const cust = envFor('GOOGLE_ADS_CUSTOMER_ID', market).replace(/-/g, '');
  const login = envFor('GOOGLE_ADS_LOGIN_CUSTOMER_ID', market).replace(/-/g, '');
  const range = (since && until) ? { since, until } : defaultRange();
  const query = gaqlFor(metricGroup, range.since, range.until, l);
  const url = `https://googleads.googleapis.com/${GADS_VER}/customers/${cust || '{GOOGLE_ADS_CUSTOMER_ID}'}/googleAds:searchStream`;
  const need = ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'];
  if (!dev || !cust) return notConnected('google', market, { method: 'POST', url, headers: { 'developer-token': '{GOOGLE_ADS_DEVELOPER_TOKEN}', authorization: 'Bearer {oauth_access_token}' }, body: { query } }, need, l);
  const token = await googleAccessToken(market);
  if (!token) return notConnected('google', market, { method: 'POST', url, body: { query } }, need, l);
  const headers = { authorization: `Bearer ${token}`, 'developer-token': dev, 'content-type': 'application/json' };
  if (login) headers['login-customer-id'] = login;
  const r = await fetchJson(url, { method: 'POST', headers, body: JSON.stringify({ query }) });
  if (!r.ok) return { ok: false, connected: true, platform: 'google', market: normMarket(market), level: l, status: r.status, error: 'google ads request failed', raw: r.json, query };
  return {
    ok: true, connected: true, platform: 'google', market: normMarket(market), level: l,
    metric_group: metricGroup, window: range, source: `google_ads_api_${GADS_VER}`,
    fetched_at: new Date().toISOString(), query, data: r.json,
  };
}

// ── TikTok Ads integrated report ─────────────────────────────────────────────
const TIKTOK_METRICS = {
  conversion: ['spend', 'conversion', 'cost_per_conversion', 'conversion_rate', 'complete_payment', 'total_complete_payment_rate', 'total_complete_payment_value', 'value_per_complete_payment', 'real_time_conversion', 'real_time_cost_per_conversion'],
  traffic: ['impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'reach', 'frequency', 'spend'],
  engagement: ['impressions', 'video_play_actions', 'video_watched_2s', 'video_watched_6s', 'video_views_p25', 'video_views_p50', 'video_views_p75', 'video_views_p100', 'likes', 'comments', 'shares', 'spend'],
};
const TIKTOK_LEVEL = {
  account: { dataLevel: 'AUCTION_ADVERTISER', dimensions: ['advertiser_id'] },
  campaign: { dataLevel: 'AUCTION_CAMPAIGN', dimensions: ['campaign_id'] },
  adgroup: { dataLevel: 'AUCTION_ADGROUP', dimensions: ['adgroup_id'] },
  adset: { dataLevel: 'AUCTION_ADGROUP', dimensions: ['adgroup_id'] },
  ad: { dataLevel: 'AUCTION_AD', dimensions: ['ad_id'] },
};
function tiktokMetricFields(group) {
  if (group === 'all') return uniq(Object.values(TIKTOK_METRICS).flat());
  return TIKTOK_METRICS[group] || TIKTOK_METRICS.conversion;
}
async function tiktokInsights({ market, metricGroup = 'conversion', since, until, level = 'account' } = {}) {
  const l = normLevel(level);
  const spec = TIKTOK_LEVEL[l] || TIKTOK_LEVEL.account;
  const token = envFor('TIKTOK_ACCESS_TOKEN', market);
  const adv = envFor('TIKTOK_ADVERTISER_ID', market);
  const range = (since && until) ? { since, until } : defaultRange();
  const params = {
    advertiser_id: adv || '{TIKTOK_ADVERTISER_ID}', report_type: 'BASIC',
    data_level: spec.dataLevel, dimensions: JSON.stringify(spec.dimensions),
    metrics: JSON.stringify(tiktokMetricFields(metricGroup)), start_date: range.since, end_date: range.until,
    page_size: 1000,
  };
  const url = `${TIKTOK_BASE}/report/integrated/get/`;
  if (!token || !adv) return notConnected('tiktok', market, { method: 'GET', url, params, headers: { 'Access-Token': '{TIKTOK_ACCESS_TOKEN}' } }, ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'], l);
  const r = await fetchJson(`${url}?${qs(params)}`, { headers: { 'Access-Token': token } });
  if (!r.ok || (r.json && r.json.code && r.json.code !== 0)) return { ok: false, connected: true, platform: 'tiktok', market: normMarket(market), level: l, status: r.status, error: (r.json && r.json.message) || 'tiktok report request failed', raw: r.json };
  return {
    ok: true, connected: true, platform: 'tiktok', market: normMarket(market), level: l,
    metric_group: metricGroup, window: range, source: 'tiktok_business_report_v1.3',
    fetched_at: new Date().toISOString(), data: (r.json && r.json.data) || r.json,
  };
}

function isConnected(platform, market) {
  switch (platform) {
    case 'meta': return !!(envFor('META_ACCESS_TOKEN', market) && envFor('META_AD_ACCOUNT_ID', market));
    case 'google': return !!(envFor('GOOGLE_ADS_DEVELOPER_TOKEN', market) && envFor('GOOGLE_ADS_CUSTOMER_ID', market) && envFor('GOOGLE_ADS_REFRESH_TOKEN', market) && envFor('GOOGLE_ADS_CLIENT_ID', market) && envFor('GOOGLE_ADS_CLIENT_SECRET', market));
    case 'tiktok': return !!(envFor('TIKTOK_ACCESS_TOKEN', market) && envFor('TIKTOK_ADVERTISER_ID', market));
    default: return false;
  }
}
function status(market) {
  const mk = normMarket(market);
  return {
    ok: true, market: mk,
    platforms: PLATFORMS.map((p) => ({ platform: p, connected: isConnected(p, mk) })),
    any_connected: PLATFORMS.some((p) => isConnected(p, mk)),
    supported_levels: ['account', 'campaign', 'adgroup', 'ad'],
    versions: { meta: GRAPH_VER, google: GADS_VER, tiktok: 'v1.3' },
    note: 'Fresh reporting is fetched read-only from each platform. Reporting freshness still follows the source platform attribution and processing latency.',
  };
}
async function insights({ platform, market = 'US', metricGroup = 'conversion', metric_group, since, until, level = 'account' } = {}) {
  const mg = metricGroup || metric_group || 'conversion';
  const p = String(platform || '').toLowerCase();
  const args = { market, metricGroup: mg, since, until, level };
  if (p === 'meta' || p === 'facebook' || p === 'instagram') return metaInsights(args);
  if (p === 'google' || p === 'google_ads' || p === 'googleads') return googleInsights(args);
  if (p === 'tiktok') return tiktokInsights(args);
  return { ok: false, error: `Unknown ad platform '${platform}'. Use one of: ${PLATFORMS.join(', ')}.` };
}
async function summary({ market = 'US', metricGroup = 'conversion', metric_group, since, until, level = 'account' } = {}) {
  const mg = metricGroup || metric_group || 'conversion';
  const mk = normMarket(market);
  const l = normLevel(level);
  const results = await Promise.all(PLATFORMS.map((p) => insights({ platform: p, market: mk, metricGroup: mg, since, until, level: l }).catch((e) => ({ ok: false, platform: p, level: l, error: e.message }))));
  const connected = results.filter((r) => r && r.connected && r.ok).map((r) => r.platform);
  const pending = results.filter((r) => r && r.not_connected).map((r) => r.platform);
  return {
    ok: true, market: mk, level: l, metric_group: mg,
    window: (since && until) ? { since, until } : defaultRange(), fetched_at: new Date().toISOString(),
    connected_platforms: connected, pending_platforms: pending, platforms: results,
    note: pending.length ? `Live figures for: ${connected.join(', ') || 'none yet'}. Awaiting credentials for: ${pending.join(', ')}. No ad numbers are fabricated.` : 'Fresh figures returned from all connected platforms.',
  };
}

module.exports = {
  insights, summary, status, isConnected,
  metaInsights, googleInsights, tiktokInsights,
  PLATFORMS, METRIC_GROUPS, LEVELS, normMarket, normLevel, envFor,
};
