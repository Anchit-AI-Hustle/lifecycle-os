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
 *   2. Snowflake KNICKGASM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS (Maplemonk pipeline,
 *      per-day rows incl. the current partial day; verified live 2026-07-25:
 *      22,620 rows since May 1 for "Knickgasm India USA New EST Main Account",
 *      today's partial day present). Columns used: DATE_START, AD_ID, AD_NAME,
 *      ADSET_NAME, CAMPAIGN_NAME, ACCOUNT_NAME, SPEND, IMPRESSIONS, CLICKS,
 *      INLINE_LINK_CLICKS, INLINE_LINK_CLICK_CTR, UPDATED_TIME.
 *   3. Neither configured -> { connected:false, would_query/would_request } with
 *      the exact SQL or HTTP request that would run. No numbers are invented.
 *
 * Future-dated days are NEVER given performance figures: a future day can only
 * carry PLANNED items (scheduled campaigns), which is why calendar() marks each
 * day past | today | future and only past/today days carry actuals.
 */

const snow = require('./ads-snowflake-core.js');

const META_TABLE = (process.env.SF_META_ADS_TABLE || 'KNICKGASM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS').toUpperCase();

/**
 * The US Meta accounts this page reports as "live". KNICKGASM runs two of them and
 * they sit in different tables with different column naming, so the warehouse
 * path unions them through the registry in ads-snowflake-core rather than
 * querying one hardcoded table (which is why only the DTC account used to show).
 *   dtc    1303870183798748  Knickgasm India USA New EST Main Account  -> own site
 *   retail 804570870670763   KNICKGASM USA - Sneaker Ad Account            -> Target / Costco
 * Override with ADS_LIVE_ACCOUNTS (comma-separated registry ids).
 */
function liveSources() { return snow.pickSources(process.env.ADS_LIVE_ACCOUNTS || 'dtc,retail'); }
function liveUnion(from, to) { return snow.unionSelect(liveSources(), { since: from, until: to }); }
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
  // The ad account reports on US Eastern ("New EST Main Account"), so "today"
  // must be Eastern-relative or the current partial day looks empty after UTC
  // midnight. Overridable via ADS_REPORT_TZ.
  const zone = tz || process.env.ADS_REPORT_TZ || 'America/New_York';
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (_) { return new Date().toISOString().slice(0, 10); }
}
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function acctFilter(account) {
  if (!account || account === 'all') return '';
  const a = String(account).toLowerCase().replace(/'/g, '');
  // A registry id (dtc / retail) selects a whole ad account. Anything else —
  // notably target and costco, which share the one retail account — is matched
  // case-insensitively against the campaign name.
  if (liveSources().some((s) => s.id === a)) return ` and source_id = '${a}'`;
  return ` and lower(campaign_name) like '%${a}%'`;
}

// ── Per-day series (charts + calendar actuals) ───────────────────────────────
async function daily({ since, until, account } = {}) {
  const to = until || todayISO();
  const from = since || addDays(to, -29);
  const sql = `with u as (\n  ${liveUnion(from, to)}\n)
select day, count(distinct ad_id) as ads_live, count(distinct campaign_name) as campaigns,
       count(distinct source_id) as accounts, round(sum(spend),2) as spend, sum(impressions) as impressions,
       sum(clicks) as clicks, sum(link_clicks) as link_clicks
  from u
 where 1=1${acctFilter(account)}
 group by day order by day`;

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
  if (!snow.isConfigured()) {
    return Object.assign({ ok: false, connected: false, not_connected: true, since: from, until: to, today: todayISO(), rows: [],
      would_query: sql, would_request: metaConfigured() ? metaWouldRequest({ level: 'account', since: from, until: to }) : null,
      hint: 'Set META_ACCESS_TOKEN + META_AD_ACCOUNT_ID for the minute-fresh Meta link, or SNOWFLAKE_* (+ LIVE_CONNECTORS=on) for the per-day warehouse mirror. Until then the page renders the committed snapshot and labels it as such.' });
  }
  const r = await snow.runStatement(sql);
  return { ok: true, connected: true, source: 'snowflake', accounts: liveSources().map(snow.describeAccount),
    since: from, until: to, today: todayISO(),
    rows: (r.rows || []).map((x) => ({ day: String(x.day).slice(0, 10), ads_live: num(x.ads_live), campaigns: num(x.campaigns),
      accounts: num(x.accounts), spend: round(x.spend), impressions: num(x.impressions),
      clicks: num(x.clicks), link_clicks: num(x.link_clicks) })) };
}

// ── Today: is it live yet, and how is it pacing ──────────────────────────────
async function today({ account } = {}) {
  const d = todayISO();
  const sql = `with u as (\n  ${liveUnion(d, d)}\n)
select source_id, account_name, ad_id, ad_name, adset_name, campaign_name, round(sum(spend),2) as spend,
       sum(impressions) as impressions, sum(clicks) as clicks, sum(link_clicks) as link_clicks
  from u
 where 1=1${acctFilter(account)}
 group by source_id, account_name, ad_id, ad_name, adset_name, campaign_name order by spend desc`;

  let rows = null, source = null;
  if (metaConfigured()) {
    try { rows = (await metaFetch({ level: 'ad', datePreset: 'today' })).map(normalizeMetaRow); source = 'meta-marketing-api'; }
    catch (_) { rows = null; }
  }
  if (!rows) {
    if (!snow.isConfigured()) {
      return { ok: false, connected: false, not_connected: true, day: d, ads: [], would_query: sql,
        would_request: metaConfigured() ? metaWouldRequest({ level: 'ad', datePreset: 'today' }) : null,
        hint: 'No live source configured — see the Ops tab. The dashboard falls back to the committed snapshot and never invents a live figure.' };
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
  const b = budgets();
  const cap = account === 'costco' ? b.costco : account === 'target' ? b.target : b.target + b.costco;
  // Per-account rollup: the two US accounts are not comparable on one KPI (the
  // retail account has no pixel), so the UI needs them split, not blended.
  const perAccount = {};
  live.forEach((x) => {
    const k = x.source_id || 'meta';
    const a = perAccount[k] || (perAccount[k] = { source_id: k, account: x.account || null, ads_live: 0, spend: 0, impressions: 0, clicks: 0, link_clicks: 0, campaigns: new Set() });
    a.ads_live += 1; a.spend = round(a.spend + x.spend); a.impressions += x.impressions;
    a.clicks += x.clicks; a.link_clicks += x.link_clicks; a.campaigns.add(x.campaign);
  });
  const accountsRollup = Object.values(perAccount).map((a) => {
    const meta = liveSources().find((s) => s.id === a.source_id);
    return { source_id: a.source_id, account: a.account || (meta && meta.label) || null,
      label: (meta && meta.label) || a.account, kpi: (meta && meta.kpi) || null,
      used_for: (meta && meta.used_for) || null, ads_live: a.ads_live, campaigns: a.campaigns.size,
      spend: a.spend, impressions: a.impressions, clicks: a.clicks, link_clicks: a.link_clicks,
      ctr: a.impressions ? round(a.link_clicks / a.impressions * 100, 2) : null,
      cpc: a.link_clicks ? round(a.spend / a.link_clicks, 3) : null,
      cpm: a.impressions ? round(a.spend / a.impressions * 1000, 2) : null };
  }).sort((x, y) => y.spend - x.spend);
  return {
    ok: true, connected: true, source, day: d,
    sources: source === 'snowflake' ? liveSources().map(snow.describeAccount) : null,
    accounts: accountsRollup,
    live_count: live.length, not_live_count: rows.length - live.length, campaigns: [...new Set(live.map((x) => x.campaign))].length,
    totals, ctr: totals.impressions ? round(totals.link_clicks / totals.impressions * 100, 2) : null,
    cpc: totals.link_clicks ? round(totals.spend / totals.link_clicks, 3) : null,
    budget_cap: cap, pacing_pct: cap ? round(totals.spend / cap * 100, 1) : null,
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
    not_connected: series.not_connected || false, would_query: series.would_query || null,
    days,
    totals: days.reduce((s, d) => ({ spend: round(s.spend + num(d.spend)), impressions: s.impressions + num(d.impressions), link_clicks: s.link_clicks + num(d.link_clicks) }), { spend: 0, impressions: 0, link_clicks: 0 }),
    note: 'Past and current days carry live actuals from the ad account. Future days carry only planned/scheduled items — no forecast figures are shown as if they were performance.',
  };
}

function status() {
  const c = metaCfg();
  return {
    ok: true, source: 'ads-live',
    meta_api: { configured: metaConfigured(), account_set: !!c.account, token_set: !!c.token, api_version: META_API_VERSION,
      note: metaConfigured() ? 'Meta Marketing API configured — today is read minute-fresh with date_preset=today.' : 'Meta Marketing API not configured (META_ACCESS_TOKEN + META_AD_ACCOUNT_ID). Falling back to the Snowflake per-day mirror.' },
    snowflake: { configured: snow.isConfigured(), table: META_TABLE,
      accounts: liveSources().map(snow.describeAccount) },
    report_timezone: process.env.ADS_REPORT_TZ || 'America/New_York',
    today: todayISO(), budgets: budgets(),
  };
}

module.exports = { status, today, daily, calendar, budgets, todayISO };
