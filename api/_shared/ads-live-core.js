'use strict';

/**
 * api/_shared/ads-live-core.js — REAL-TIME ads status for the Ad Campaigns
 * Master Dashboard (tracker + calendar + live view). READ ONLY.
 *
 * Answers four questions the dashboard asks:
 *   today()    — what is live RIGHT NOW, spend so far today, pacing vs the daily cap
 *   daily()    — the per-day series behind every chart (spend / impressions / clicks / ads live)
 *   calendar() — one row per calendar day for the month grid (past · today · future)
 *   liveAds()  — the ad-level list for today, so "is it live yet" is answerable per ad
 *
 * Source ladder (never fabricates — the first available source wins and is
 * always named in `source`):
 *   1. Meta Marketing API (direct, minute-fresh) when META_ACCESS_TOKEN +
 *      META_AD_ACCOUNT_ID are set. This is the true real-time link to the ad
 *      account: today's insights are read with date_preset=today.
 *   2. The Snowflake ad tables this DEPLOYMENT configured (see
 *      ads-snowflake-core: one env var per feed, no default table names).
 *   3. Neither configured -> { connected:false, would_query/would_request } with
 *      the exact SQL or HTTP request that would run, or a no_sources envelope
 *      naming the env var to set. No numbers are invented, and there is no
 *      bundled snapshot to fall back to.
 *
 * SCOPE. Both sources are DEPLOYMENT-level credentials, so every payload
 * carries ads-snowflake-core's `data_scope` and a surface must render it. A
 * workspace's own paid media comes from the ad accounts it connected
 * (ad-insights-core.js), not from here.
 *
 * Future-dated days are NEVER given performance figures: a future day can only
 * carry PLANNED items (scheduled campaigns), which is why calendar() marks each
 * day past | today | future and only past/today days carry actuals.
 */

const snow = require('./ads-snowflake-core.js');

/**
 * The warehouse feeds this page reports as "live" — whichever ad tables the
 * deployment configured, unioned through ads-snowflake-core so feeds with
 * different column naming still land in one result set. Narrow with
 * ADS_LIVE_ACCOUNTS (comma-separated source ids or platforms).
 *
 * There is no hardcoded account list here any more. There used to be two named
 * ad accounts with their platform ids written into this comment; they belonged
 * to the advertiser this repo was copied from, not to any tenant of it.
 */
function liveSources() { return snow.pickSources(process.env.ADS_LIVE_ACCOUNTS || 'all'); }
function liveUnion(from, to) { return snow.unionSelect(liveSources(), { since: from, until: to }); }

const NO_SOURCE_HINT = 'No ad source is configured for this deployment. Connect a live ad account: set META_ACCESS_TOKEN + META_AD_ACCOUNT_ID for the Meta Marketing API, or point SF_META_ADS_TABLE / SF_GOOGLE_ADS_TABLE / SF_TIKTOK_AD_TABLE at your own warehouse tables (with SNOWFLAKE_* and LIVE_CONNECTORS=on). Nothing is shown until one of those exists — there is no bundled snapshot.';
const NOT_CONNECTED_HINT = 'A warehouse table is named but the connection is not live. Set META_ACCESS_TOKEN + META_AD_ACCOUNT_ID for the minute-fresh Meta link, or SNOWFLAKE_* (+ LIVE_CONNECTORS=on) for the per-day warehouse read. Until then the exact query is shown and no figure is invented.';
const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';

function metaCfg() {
  return {
    token: (process.env.META_ACCESS_TOKEN || '').trim(),
    account: (process.env.META_AD_ACCOUNT_ID || '').trim(),
  };
}
function metaConfigured() { const c = metaCfg(); return !!(c.token && c.account); }
function actPath(id) { return String(id).startsWith('act_') ? String(id) : `act_${id}`; }

function budgets() { return snow.budgets(); }

// ── Meta Marketing API (read-only insights) ─────────────────────────────────
const META_FIELDS = 'ad_id,ad_name,adset_name,campaign_name,spend,impressions,clicks,inline_link_clicks,inline_link_click_ctr,date_start,date_stop';

function metaUrl({ level = 'ad', datePreset, since, until, limit = 500 }) {
  const c = metaCfg();
  const p = new URLSearchParams({ level, fields: META_FIELDS, limit: String(limit) });
  if (datePreset) p.set('date_preset', datePreset);
  else if (since && until) {
    p.set('time_range', JSON.stringify({ since, until }));
    p.set('time_increment', '1'); // one row per day — what the charts and calendar need
  }
  return `https://graph.facebook.com/${META_API_VERSION}/${actPath(c.account)}/insights?${p.toString()}`;
}
async function metaFetch(opts, timeoutMs = 25000) {
  const url = metaUrl(opts);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Authorization: `Bearer ${metaCfg().token}` } });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    if (!res.ok) {
      const msg = (json && json.error && (json.error.message || json.error.type)) || text || res.statusText;
      const e = new Error(`meta ${res.status}: ${msg}`); e.status = res.status; throw e;
    }
    return (json && json.data) || [];
  } finally { clearTimeout(timer); }
}
// Redacts the token — safe to show in a not_connected envelope.
function metaWouldRequest(opts) {
  return { method: 'GET', url: metaUrl(opts).replace(/access_token=[^&]*/, 'access_token=REDACTED'), auth: 'Bearer META_ACCESS_TOKEN' };
}

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
const round = (v, n = 2) => Math.round(num(v) * 10 ** n) / 10 ** n;

function normalizeMetaRow(r) {
  return {
    day: r.date_start, ad_id: r.ad_id, ad: r.ad_name, adset: r.adset_name, campaign: r.campaign_name,
    spend: round(r.spend), impressions: num(r.impressions), clicks: num(r.clicks),
    link_clicks: num(r.inline_link_clicks), ctr: round(r.inline_link_click_ctr, 4),
  };
}
function normalizeSnowRow(r) {
  const impressions = num(r.impressions);
  const link_clicks = num(r.link_clicks != null ? r.link_clicks : r.inline_link_clicks);
  // The unioned warehouse query carries no CTR column (the two source tables
  // name it differently), so derive it from the two figures that are always
  // present rather than reporting a blank.
  const ctr = r.ctr != null ? round(r.ctr, 4)
    : (r.inline_link_click_ctr != null ? round(r.inline_link_click_ctr, 4)
      : (impressions ? round(link_clicks / impressions * 100, 4) : null));
  return {
    day: String(r.day || r.date_start || '').slice(0, 10), source_id: r.source_id || null,
    account: r.account_name || null, ad_id: r.ad_id, ad: r.ad_name, adset: r.adset_name,
    campaign: r.campaign_name, spend: round(r.spend), impressions, clicks: num(r.clicks),
    link_clicks, ctr,
  };
}
function todayISO(tz) {
  // "Today" is relative to the timezone the AD ACCOUNT reports in, not the
  // server's: get it wrong and the current partial day looks empty. Set
  // ADS_REPORT_TZ to the account's reporting timezone. Defaults to UTC, because
  // a default of one particular account's timezone is a guess about whose
  // account this is.
  const zone = tz || process.env.ADS_REPORT_TZ || 'UTC';
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (_) { return new Date().toISOString().slice(0, 10); }
}
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function acctFilter(account) {
  if (!account || account === 'all') return '';
  const a = String(account).toLowerCase().replace(/'/g, '');
  // A configured source id (meta / google / tiktok …) selects a whole feed.
  // Anything else is treated as a free-text campaign-name filter typed by the
  // reader, matched case-insensitively.
  if (liveSources().some((s) => s.id === a)) return ` and source_id = '${a}'`;
  return ` and lower(campaign_name) like '%${a}%'`;
}

// ── Per-day series (charts + calendar actuals) ───────────────────────────────
async function daily({ since, until, account } = {}) {
  const to = until || todayISO();
  const from = since || addDays(to, -29);
  const srcs = liveSources();
  const sql = srcs.length ? `with u as (\n  ${liveUnion(from, to)}\n)
select day, count(distinct ad_id) as ads_live, count(distinct campaign_name) as campaigns,
       count(distinct source_id) as accounts, round(sum(spend),2) as spend, sum(impressions) as impressions,
       sum(clicks) as clicks, sum(link_clicks) as link_clicks
  from u
 where 1=1${acctFilter(account)}
 group by day order by day` : null;

  if (metaConfigured()) {
    try {
      const rows = await metaFetch({ level: 'account', since: from, until: to });
      const byDay = {};
      rows.forEach((r) => {
        const d = r.date_start; byDay[d] = byDay[d] || { day: d, spend: 0, impressions: 0, clicks: 0, link_clicks: 0 };
        byDay[d].spend = round(byDay[d].spend + num(r.spend)); byDay[d].impressions += num(r.impressions);
        byDay[d].clicks += num(r.clicks); byDay[d].link_clicks += num(r.inline_link_clicks);
      });
      return { ok: true, connected: true, source: 'meta-marketing-api', since: from, until: to, today: todayISO(), rows: Object.values(byDay).sort((a, c) => a.day.localeCompare(c.day)) };
    } catch (e) { /* fall through to the warehouse */ }
  }
  if (!srcs.length) return snow.noSources({ since: from, until: to, today: todayISO(), rows: [], hint: NO_SOURCE_HINT });
  if (!snow.isConfigured()) {
    return Object.assign({ ok: false, connected: false, not_connected: true, data_scope: snow.DATA_SCOPE,
      since: from, until: to, today: todayISO(), rows: [],
      would_query: sql, would_request: metaConfigured() ? metaWouldRequest({ level: 'account', since: from, until: to }) : null,
      hint: NOT_CONNECTED_HINT });
  }
  const r = await snow.runStatement(sql);
  return { ok: true, connected: true, source: 'snowflake', data_scope: snow.DATA_SCOPE,
    accounts: srcs.map(snow.describeAccount),
    since: from, until: to, today: todayISO(),
    rows: (r.rows || []).map((x) => ({ day: String(x.day).slice(0, 10), ads_live: num(x.ads_live), campaigns: num(x.campaigns),
      accounts: num(x.accounts), spend: round(x.spend), impressions: num(x.impressions),
      clicks: num(x.clicks), link_clicks: num(x.link_clicks) })) };
}

// ── Today: is it live yet, and how is it pacing ──────────────────────────────
async function today({ account } = {}) {
  const d = todayISO();
  const srcs = liveSources();
  const sql = srcs.length ? `with u as (\n  ${liveUnion(d, d)}\n)
select source_id, account_name, ad_id, ad_name, adset_name, campaign_name, round(sum(spend),2) as spend,
       sum(impressions) as impressions, sum(clicks) as clicks, sum(link_clicks) as link_clicks
  from u
 where 1=1${acctFilter(account)}
 group by source_id, account_name, ad_id, ad_name, adset_name, campaign_name order by spend desc` : null;

  let rows = null, source = null;
  if (metaConfigured()) {
    try { rows = (await metaFetch({ level: 'ad', datePreset: 'today' })).map(normalizeMetaRow); source = 'meta-marketing-api'; }
    catch (_) { rows = null; }
  }
  if (!rows) {
    if (!srcs.length) return snow.noSources({ day: d, ads: [], hint: NO_SOURCE_HINT });
    if (!snow.isConfigured()) {
      return { ok: false, connected: false, not_connected: true, data_scope: snow.DATA_SCOPE,
        day: d, ads: [], would_query: sql,
        would_request: metaConfigured() ? metaWouldRequest({ level: 'ad', datePreset: 'today' }) : null,
        hint: NOT_CONNECTED_HINT };
    }
    const r = await snow.runStatement(sql);
    rows = (r.rows || []).map(normalizeSnowRow); source = 'snowflake';
  }
  // An ad counts as LIVE today once it has delivered (impressions > 0);
  // spend without impressions is still "starting". No impressions = not live yet.
  const live = rows.filter((x) => x.impressions > 0);
  const totals = live.reduce((t, x) => ({
    spend: round(t.spend + x.spend), impressions: t.impressions + x.impressions,
    clicks: t.clicks + x.clicks, link_clicks: t.link_clicks + x.link_clicks,
  }), { spend: 0, impressions: 0, clicks: 0, link_clicks: 0 });
  // Pacing needs a cap somebody actually set. There is no bundled default, so
  // an unset cap means pacing_pct is null rather than a percentage of a number
  // this product invented.
  const cap = budgets().daily_cap;
  // Per-feed rollup: feeds are not comparable on one KPI (one may carry
  // conversions and another may not), so the UI needs them split, not blended.
  const perAccount = {};
  live.forEach((x) => {
    const k = x.source_id || 'meta';
    const a = perAccount[k] || (perAccount[k] = { source_id: k, account: x.account || null, ads_live: 0, spend: 0, impressions: 0, clicks: 0, link_clicks: 0, campaigns: new Set() });
    a.ads_live += 1; a.spend = round(a.spend + x.spend); a.impressions += x.impressions;
    a.clicks += x.clicks; a.link_clicks += x.link_clicks; a.campaigns.add(x.campaign);
  });
  const accountsRollup = Object.values(perAccount).map((a) => {
    const feed = srcs.find((s) => s.id === a.source_id);
    // The account NAME comes from the warehouse row, never from a bundled
    // label — this module has no registry of who owns which account.
    return { source_id: a.source_id, account: a.account || null,
      label: a.account || (feed && feed.platform) || a.source_id,
      kpi: (feed && feed.kpi) || null, table: (feed && feed.table) || null,
      ads_live: a.ads_live, campaigns: a.campaigns.size,
      spend: a.spend, impressions: a.impressions, clicks: a.clicks, link_clicks: a.link_clicks,
      ctr: a.impressions ? round(a.link_clicks / a.impressions * 100, 2) : null,
      cpc: a.link_clicks ? round(a.spend / a.link_clicks, 3) : null,
      cpm: a.impressions ? round(a.spend / a.impressions * 1000, 2) : null };
  }).sort((x, y) => y.spend - x.spend);
  return {
    ok: true, connected: true, source, day: d, data_scope: snow.DATA_SCOPE,
    sources: source === 'snowflake' ? srcs.map(snow.describeAccount) : null,
    accounts: accountsRollup,
    live_count: live.length, not_live_count: rows.length - live.length, campaigns: [...new Set(live.map((x) => x.campaign))].length,
    totals, ctr: totals.impressions ? round(totals.link_clicks / totals.impressions * 100, 2) : null,
    cpc: totals.link_clicks ? round(totals.spend / totals.link_clicks, 3) : null,
    budget_cap: cap, pacing_pct: cap ? round(totals.spend / cap * 100, 1) : null,
    budget_note: cap == null ? budgets().note : null,
    ads: rows.map((x) => Object.assign({}, x, { status: x.impressions > 0 ? 'live' : (x.spend > 0 ? 'starting' : 'not_live_yet') })),
    note: 'Today is a PARTIAL day — spend and delivery accrue through the day. Status: live = delivering (impressions today), starting = spend but no impressions yet, not_live_yet = no delivery recorded today.',
  };
}

// ── Calendar: one row per day, past · today · future ─────────────────────────
async function calendar({ month, account } = {}) {
  const t = todayISO();
  const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : t.slice(0, 7);
  const first = `${m}-01`;
  const lastDay = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  const last = `${m}-${String(lastDay).padStart(2, '0')}`;
  // Actuals only up to today; future days carry planned items, never figures.
  const actualsUntil = last <= t ? last : t;
  const series = first > t ? { ok: true, connected: false, rows: [], source: 'none-future-month' } : await daily({ since: first, until: actualsUntil, account });
  const byDay = {};
  (series.rows || []).forEach((r) => { byDay[r.day] = r; });
  const days = [];
  for (let i = 1; i <= lastDay; i++) {
    const iso = `${m}-${String(i).padStart(2, '0')}`;
    const rel = iso < t ? 'past' : iso === t ? 'today' : 'future';
    days.push(Object.assign({ date: iso, rel, has_actuals: !!byDay[iso] }, byDay[iso] || {}));
  }
  return {
    ok: true, month: m, today: t, source: series.source || null, connected: !!series.connected,
    not_connected: series.not_connected || false, no_sources: series.no_sources || false,
    would_query: series.would_query || null, hint: series.hint || null,
    data_scope: snow.DATA_SCOPE,
    days,
    totals: days.reduce((s, d) => ({ spend: round(s.spend + num(d.spend)), impressions: s.impressions + num(d.impressions), link_clicks: s.link_clicks + num(d.link_clicks) }), { spend: 0, impressions: 0, link_clicks: 0 }),
    note: 'Past and current days carry live actuals from the ad account. Future days carry only planned/scheduled items — no forecast figures are shown as if they were performance.',
  };
}

function status() {
  const c = metaCfg();
  const srcs = liveSources();
  return {
    ok: true, source: 'ads-live', data_scope: snow.DATA_SCOPE,
    meta_api: { configured: metaConfigured(), account_set: !!c.account, token_set: !!c.token, api_version: META_API_VERSION,
      note: metaConfigured() ? 'Meta Marketing API configured — today is read minute-fresh with date_preset=today.' : 'Meta Marketing API not configured (META_ACCESS_TOKEN + META_AD_ACCOUNT_ID). Falling back to the Snowflake per-day mirror.' },
    snowflake: { configured: snow.isConfigured(), has_sources: srcs.length > 0,
      table_env: snow.tableEnvNames(), accounts: srcs.map(snow.describeAccount) },
    report_timezone: process.env.ADS_REPORT_TZ || 'UTC',
    today: todayISO(), budgets: budgets(),
    hint: srcs.length ? null : NO_SOURCE_HINT,
  };
}

module.exports = { status, today, daily, calendar, budgets, todayISO };
