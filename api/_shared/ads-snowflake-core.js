'use strict';

/**
 * api/_shared/ads-snowflake-core.js — LIVE ads analysis from a Snowflake
 * warehouse (READ ONLY).
 *
 * Reads Meta / Google / TikTok ad tables through the Snowflake SQL REST API v2.
 * It discovers the columns actually present in each source table
 * (INFORMATION_SCHEMA) so the dashboard can slice by whatever
 * demographic/geo/behavioural dimension that table carries (age, gender,
 * language, country, region, device, placement, …).
 *
 * ── NOTHING IS BUNDLED. THE TABLES COME FROM ENV, AND THERE ARE NO DEFAULTS ──
 *
 * This module used to ship a hardcoded registry: nineteen named ad-account
 * feeds with real platform account ids, lifetime spend and fully-qualified
 * warehouse table names, plus a Target/Costco retail-media funnel. None of it
 * belonged to this product. It was one advertiser's warehouse layout, carried
 * across when this repo was copied from a sibling project and rebranded by
 * search-and-replace: the brand token in `<BRAND>_DB` was rewritten, while the
 * loader schemas and the table names underneath it were not. The result named a
 * database that exists in no warehouse — not this deployment's, and not the
 * original owner's either — while still shipping that owner's schema, account
 * ids and spend to every tenant of this platform.
 *
 * So there is no default table name here. Each feed is named by its own env
 * var (below) and a feed whose var is unset simply does not exist: `sources()`
 * reports it as null and every op returns the honest not-configured envelope
 * naming the variable to set. A wrong default is worse than no default,
 * because a wrong default renders.
 *
 * SCOPE. A Snowflake warehouse is a DEPLOYMENT-level connection, not a
 * workspace-level one — there is no per-workspace Snowflake credential in
 * `workspace-connections-core.js`. Every payload therefore carries
 * `data_scope: { level: 'deployment' }` so a surface can say whose figures
 * these are instead of rendering them under whichever brand happens to be
 * signed in. Per-brand paid media is the platform reporting path
 * (`ad-insights-core.js`), which reads the ad accounts the WORKSPACE connected.
 *
 * READ ONLY: only SELECT / SHOW / INFORMATION_SCHEMA reads are ever issued — no
 * INSERT/UPDATE/MERGE/DELETE. Until SNOWFLAKE_* env vars are set, every op
 * returns a { connected:false, would_query } envelope with the exact SQL it
 * would run — never a fabricated number.
 *
 * Auth: SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PAT (Programmatic Access
 * Token), SNOWFLAKE_WAREHOUSE, SNOWFLAKE_DATABASE, SNOWFLAKE_ROLE.
 */

function cfg() {
  return {
    account: (process.env.SNOWFLAKE_ACCOUNT || '').trim(),
    user: (process.env.SNOWFLAKE_USER || '').trim(),
    pat: (process.env.SNOWFLAKE_PAT || process.env.SNOWFLAKE_PAT_TOKEN || '').trim(),
    warehouse: (process.env.SNOWFLAKE_WAREHOUSE || '').trim(),
    database: (process.env.SNOWFLAKE_DATABASE || '').trim(),
    role: (process.env.SNOWFLAKE_ROLE || '').trim(),
  };
}
const { liveConnectorsEnabled } = require('./live-connectors.js');
// Live connectors are off by default (LIVE_CONNECTORS=on to enable). With the
// switch off, isConfigured() is false so every op returns the read-only
// would_query stub and no connection to Snowflake is ever opened.
function isConfigured() { const c = cfg(); return liveConnectorsEnabled() && !!(c.account && c.user && c.pat && c.warehouse); }

const PLATFORMS = ['meta', 'google', 'tiktok'];

/**
 * Every figure this module can return comes from a warehouse the DEPLOYMENT
 * configured, never from the signed-in workspace. Stamped onto each payload so
 * a page renders that fact beside the numbers rather than implying they are the
 * active brand's own.
 */
const DATA_SCOPE = {
  level: 'deployment',
  note: 'These figures come from the Snowflake warehouse configured on this DEPLOYMENT, not from the signed-in brand workspace. They are not this brand\'s own performance. A workspace reads its own paid media from the ad accounts it connected under Connections.',
};

/**
 * Daily budget cap used for pacing alerts, in the warehouse's own currency.
 * There is deliberately NO default: a cap is a commercial decision that belongs
 * to whoever runs the accounts, and a bundled figure would be presented as
 * theirs. Unset means pacing reports spend without a cap rather than inventing
 * one. Read-only — the app never edits budgets on the ad platforms.
 */
function budgets() {
  const raw = String(process.env.ADS_DAILY_BUDGET_CAP || '').trim();
  const cap = raw && !isNaN(Number(raw)) ? Number(raw) : null;
  return {
    daily_cap: cap,
    currency: (process.env.ADS_BUDGET_CURRENCY || 'USD').trim().toUpperCase(),
    basis: 'per day', configured: cap != null, editable: true,
    note: cap != null
      ? 'Daily budget cap for reference/alerting only. Read-only — the app never edits budgets on the ad platforms.'
      : '[DATA REQUIRED BEFORE LAUNCH: daily budget cap] Set ADS_DAILY_BUDGET_CAP to pace spend against a cap. No cap is assumed.',
  };
}

/**
 * Table config. One env var per feed, NO defaults — see the header.
 * A value may be DB.SCHEMA.TABLE, or SCHEMA.TABLE (prefixed with
 * SNOWFLAKE_DATABASE).
 */
const TABLE_ENV = {
  meta: {
    ads: 'SF_META_ADS_TABLE',
    age_gender: 'SF_META_AGE_GENDER_TABLE',
    device: 'SF_META_DEVICE_TABLE',
    creatives: 'SF_META_CREATIVES_TABLE',
  },
  google: {
    ads: 'SF_GOOGLE_ADS_TABLE',
    adgroup_ad: 'SF_GOOGLE_ADGROUP_AD_TABLE',
  },
  tiktok: {
    account: 'SF_TIKTOK_ADS_TABLE',
    campaign: 'SF_TIKTOK_CAMPAIGN_TABLE',
    adgroup: 'SF_TIKTOK_ADGROUP_TABLE',
    ad: 'SF_TIKTOK_AD_TABLE',
    age_gender: 'SF_TIKTOK_AGE_GENDER_TABLE',
    country: 'SF_TIKTOK_COUNTRY_TABLE',
  },
};

/** Resolves one env var to a fully-qualified table, or null when it is unset. */
function tableRef(envKey) {
  const raw = String(process.env[envKey] || '').trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length >= 3) return raw.toUpperCase();           // db.schema.table given
  const db = (process.env.SNOWFLAKE_DATABASE || '').trim();  // schema.table -> prefix db
  return (db ? db + '.' + raw : raw).toUpperCase();
}

/** The configured tables, shaped by platform. Unset feeds read null. */
function sources() {
  const out = {};
  for (const [platform, feeds] of Object.entries(TABLE_ENV)) {
    out[platform] = {};
    for (const [feed, envKey] of Object.entries(feeds)) out[platform][feed] = tableRef(envKey);
  }
  return out;
}

/** Which env var names a given feed — so an empty state can say what to set. */
function tableEnvNames() {
  return Object.fromEntries(Object.entries(TABLE_ENV).map(([p, feeds]) => [p, Object.assign({}, feeds)]));
}

/**
 * Column maps per PLATFORM, not per account.
 *
 * The three platforms genuinely do not share column naming, and that is a
 * property of each platform's own export, not of any one advertiser:
 *   Meta insights   bare upper-case identifiers, spend in currency units
 *   Google Ads      dotted lower-case GAQL field names, cost in micros
 *   TikTok reports  bare upper-case identifiers, metrics loaded as text
 * Every query is built from the map for its platform, so no query hardcodes a
 * column that platform does not have.
 */
function platformCols(platform) {
  // quoteIdent is a hoisted function declaration further down the file.
  const q = (n) => ({ raw: n, sql: quoteIdent(n) });
  const micros = (n) => ({ raw: n, sql: `(${quoteIdent(n)} / 1000000.0)` });
  const nul = { raw: null, sql: 'null' };
  if (platform === 'google') {
    return { date: q('segments.date'), spend: micros('metrics.cost_micros'), impressions: q('metrics.impressions'),
      clicks: q('metrics.clicks'), link_clicks: q('metrics.clicks'), campaign: q('campaign.name'),
      adset: q('ad_group.name'), ad: q('ad_group.name'), ad_id: q('ad_group_ad.ad.id'),
      account: q('customer.descriptive_name'), account_id: q('customer.id'),
      objective: q('campaign.status'), conversions: q('metrics.conversions'), revenue: q('metrics.conversions_value') };
  }
  if (platform === 'tiktok') {
    return { date: q('STAT_TIME_DAY'), spend: q('SPEND'), impressions: q('IMPRESSIONS'), clicks: q('CLICKS'),
      link_clicks: q('CLICKS'), campaign: q('CAMPAIGN_NAME'), adset: q('ADGROUP_NAME'),
      ad: q('AD_NAME'), ad_id: q('AD_ID'), account: q('ACCOUNTNAME'), account_id: q('ACCOUNTID'),
      objective: nul, conversions: nul, revenue: nul };
  }
  return { date: q('DATE_START'), spend: q('SPEND'), impressions: q('IMPRESSIONS'), clicks: q('CLICKS'),
    link_clicks: q('INLINE_LINK_CLICKS'), campaign: q('CAMPAIGN_NAME'), adset: q('ADSET_NAME'),
    ad: q('AD_NAME'), ad_id: q('AD_ID'), account: q('ACCOUNT_NAME'), account_id: q('ACCOUNT_ID'),
    objective: q('OBJECTIVE'), conversions: nul, revenue: nul };
}

/**
 * Meta purchases and revenue arrive as nested `actions` / `action_values`
 * arrays, and an Airbyte-normalised load unnests them into two sibling tables
 * keyed by the stream's hash id. That is the LOADER's convention, so it is
 * derived from the configured table's own name rather than named anywhere:
 * `<STREAM>_ACTIONS`, `<STREAM>_ACTION_VALUES`, joined on `_AIRBYTE_<STREAM>_HASHID`.
 * Opt in with SF_META_ACTION_TABLES=on; without it the base table is read on its
 * own and conversions/revenue come back null (not tracked) rather than zero.
 */
function metaRevenueJoin(table) {
  const on = String(process.env.SF_META_ACTION_TABLES || '').trim().toLowerCase();
  if (!(on === 'on' || on === '1' || on === 'true' || on === 'yes')) return null;
  const stem = String(table || '').split('.').pop();
  if (!stem) return null;
  return { hash: `_AIRBYTE_${stem}_HASHID`, actions: `${stem}_ACTIONS`, values: `${stem}_ACTION_VALUES`,
    action_type: (process.env.SF_META_ACTION_TYPE || 'purchase').trim() };
}

/**
 * The ad sources this deployment has actually configured, derived from the env
 * above. One entry per configured feed. There are no labels, account ids,
 * regions, purposes or historic figures here: those describe somebody's
 * business, and this module has no way to know whose. Anything a UI wants to
 * say about an account has to come from the warehouse read itself.
 */
function adSources() {
  const s = sources();
  const out = [];
  if (s.meta.ads) {
    out.push({ id: 'meta', platform: 'meta', table: s.meta.ads, env: TABLE_ENV.meta.ads,
      cols: platformCols('meta'), revenue: metaRevenueJoin(s.meta.ads),
      kpi: metaRevenueJoin(s.meta.ads) ? 'roas' : 'traffic' });
  }
  if (s.google.ads) {
    out.push({ id: 'google', platform: 'google', table: s.google.ads, env: TABLE_ENV.google.ads,
      cols: platformCols('google'), kpi: 'roas' });
  }
  if (s.google.adgroup_ad) {
    out.push({ id: 'google_ad', platform: 'google', table: s.google.adgroup_ad, env: TABLE_ENV.google.adgroup_ad,
      cols: platformCols('google'), kpi: 'roas' });
  }
  const tiktok = s.tiktok.ad || s.tiktok.campaign || s.tiktok.account;
  if (tiktok) {
    out.push({ id: 'tiktok', platform: 'tiktok', table: tiktok,
      env: s.tiktok.ad ? TABLE_ENV.tiktok.ad : s.tiktok.campaign ? TABLE_ENV.tiktok.campaign : TABLE_ENV.tiktok.account,
      cols: platformCols('tiktok'), kpi: 'traffic' });
  }
  return out;
}

/** True when at least one ad table is configured. */
function hasSources() { return adSources().length > 0; }

/** The envelope for "the credentials may be fine, but no table is named yet". */
function noSources(extra) {
  return Object.assign({
    ok: false, connected: false, not_connected: true, no_sources: true,
    data_scope: DATA_SCOPE, sources: [], would_query: null,
    need_env: TABLE_ENV,
    hint: 'No ad table is configured for this deployment. Set at least one of SF_META_ADS_TABLE, SF_GOOGLE_ADS_TABLE or SF_TIKTOK_AD_TABLE to the fully-qualified warehouse table (DB.SCHEMA.TABLE) that holds your ad rows. There is no default: a bundled table name would be somebody else\'s warehouse.',
  }, extra || {});
}

/** Every configured source, optionally narrowed to one platform or feed id. */
function pickSources(accounts, dflt) {
  const all = adSources();
  if (!accounts || accounts === 'all' || accounts === 'every') return dflt || all;
  const want = String(accounts).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const chosen = all.filter((s) => want.includes(s.id) || want.includes(s.platform));
  return chosen.length ? chosen : (dflt || all);
}

/**
 * Everything a UI may say about a source without querying it — which is only
 * what the deployment configured. No label, account id, region, purpose or
 * historic figure: this module cannot know whose account a table holds, and a
 * guess would render as a claim.
 */
function describeAccount(s) {
  return { id: s.id, platform: s.platform, table: s.table, env: s.env,
    kpi: s.kpi, tracks_revenue: !!s.revenue,
    kpi_note: s.kpi === 'roas'
      ? 'Conversions and revenue are read from this feed, so ROAS and CPA are computed from it.'
      : 'This feed carries no conversion or revenue column, so revenue, ROAS and CPA return null rather than 0. Judge it on CTR, CPC, CPM and reach.' };
}

function srcWhere(s, since, until) {
  const parts = [];
  if (since && until) parts.push(`${s.cols.date.sql} between '${since}' and '${until}'`);
  if (s.filter) parts.push(s.filter);
  return parts.length ? ` where ${parts.join(' and ')}` : '';
}

// One SELECT per source, normalized to identical output columns, UNION ALL-ed so
// every configured feed appears in one result set regardless of its platform's
// naming. Every column is cast explicitly: the same logical field is NUMBER in
// one platform's export and TEXT in another's, and an uncast UNION ALL across
// those fails outright. Sources without a revenue/conversions column emit null
// rather than 0 so the UI can tell "not tracked here" from "tracked, zero".
function unionSelect(sources, { since, until } = {}) {
  const s_ = (e) => (e && e.sql !== 'null' ? `(${e.sql})::string` : 'null::string');
  const n_ = (e) => (e && e.sql !== 'null' ? `(${e.sql})::float` : 'null::float');
  return sources.map((s) => {
    const c = s.cols;
    return `select '${s.id}' as source_id, '${s.platform}' as platform, ${s_(c.account)} as account_name,
       ${s_(c.account_id)} as account_id, (${c.date.sql})::date as day, ${n_(c.spend)} as spend,
       ${n_(c.impressions)} as impressions, ${n_(c.clicks)} as clicks, ${n_(c.link_clicks)} as link_clicks,
       ${s_(c.campaign)} as campaign_name, ${s_(c.adset)} as adset_name, ${s_(c.ad)} as ad_name,
       ${s_(c.ad_id)} as ad_id, ${s_(c.objective)} as objective,
       ${n_(c.conversions)} as conversions, ${n_(c.revenue)} as revenue
  from ${s.table}${srcWhere(s, since, until)}`;
  }).join('\n  union all\n');
}
function nulSql() { return { sql: 'null' }; }

/**
 * Live catalogue: every CONFIGURED feed and how fresh the warehouse is for it.
 * The account name and id come from the warehouse rows themselves — they are
 * never asserted from a bundled registry, because this module has no registry.
 */
async function accounts({ since = '2025-01-01', until, accounts: acct = 'every' } = {}) {
  const to = until || new Date().toISOString().slice(0, 10);
  const srcs = pickSources(acct);
  if (!srcs.length) return noSources({ since, until: to });
  const registry = srcs.map(describeAccount);
  const sql = `with u as (\n  ${unionSelect(srcs, { since, until: to })}\n)
select source_id, platform, account_name, account_id, count(distinct ad_id) as ads,
       count(distinct campaign_name) as campaigns, max(day) as last_day, min(day) as first_day,
       round(sum(spend),2) as spend, sum(impressions) as impressions, sum(link_clicks) as link_clicks,
       round(sum(conversions),1) as conversions, round(sum(revenue),2) as revenue
  from u group by 1,2,3,4 order by spend desc nulls last`;
  if (!isConfigured()) return notConnected(sql, { registry });
  const r = await runStatement(sql);
  const byId = {};
  (r.rows || []).forEach((x) => { byId[x.source_id] = x; });
  return { ok: true, connected: true, source: 'snowflake', data_scope: DATA_SCOPE, since, until: to,
    registry,
    rows: registry.map((d) => {
      const x = byId[d.id] || {};
      const spend = Number(x.spend) || 0;
      const revenue = x.revenue == null ? null : Number(x.revenue);
      return Object.assign({}, d, {
        account: x.account_name || null, account_id: x.account_id || null,
        ads: Number(x.ads) || 0, campaigns: Number(x.campaigns) || 0,
        first_day: x.first_day ? String(x.first_day).slice(0, 10) : null,
        last_day: x.last_day ? String(x.last_day).slice(0, 10) : null,
        spend, impressions: Number(x.impressions) || 0, link_clicks: Number(x.link_clicks) || 0,
        conversions: x.conversions == null ? null : Number(x.conversions),
        revenue, roas: (revenue != null && spend > 0) ? Number((revenue / spend).toFixed(2)) : null,
        in_window: !!byId[d.id],
      });
    }),
    note: 'Every ad feed configured for this deployment. Feeds are not comparable on one KPI: revenue, ROAS and CPA are real only where the feed carries a conversion or revenue column, and are null (never 0) where it does not.' };
}

/** Per-day series across one or more configured feeds. */
async function multiDaily({ since, until, accounts: acct, by = 'day' } = {}) {
  const to = until || new Date().toISOString().slice(0, 10);
  const from = since || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const srcs = pickSources(acct);
  if (!srcs.length) return noSources({ since: from, until: to, by });
  const group = by === 'account' ? 'source_id, platform, account_name' : 'day, source_id, platform, account_name';
  const sql = `with u as (\n  ${unionSelect(srcs, { since: from, until: to })}\n)
select ${group}, count(distinct ad_id) as ads_live, count(distinct campaign_name) as campaigns,
       round(sum(spend),2) as spend, sum(impressions) as impressions, sum(clicks) as clicks,
       sum(link_clicks) as link_clicks, round(sum(conversions),1) as conversions, round(sum(revenue),2) as revenue
  from u group by ${group} order by ${by === 'account' ? 'spend desc nulls last' : 'day'}`;
  if (!isConfigured()) return notConnected(sql, { since: from, until: to, accounts: srcs.map(describeAccount) });
  const r = await runStatement(sql);
  return { ok: true, connected: true, source: 'snowflake', data_scope: DATA_SCOPE, since: from, until: to,
    accounts: srcs.map(describeAccount),
    rows: (r.rows || []).map((x) => ({ day: x.day ? String(x.day).slice(0, 10) : null, source_id: x.source_id,
      platform: x.platform, account: x.account_name, ads_live: Number(x.ads_live) || 0,
      campaigns: Number(x.campaigns) || 0, spend: Number(x.spend) || 0,
      impressions: Number(x.impressions) || 0, clicks: Number(x.clicks) || 0,
      link_clicks: Number(x.link_clicks) || 0,
      conversions: x.conversions == null ? null : Number(x.conversions),
      revenue: x.revenue == null ? null : Number(x.revenue) })) };
}

/**
 * Per-campaign performance for one feed, scored on the KPI that feed can
 * actually be judged on. A Meta feed with the Airbyte action tables enabled
 * picks purchases and revenue up from its own sibling tables; a Google feed
 * reads its own conversion columns; a feed with neither returns null revenue
 * rather than 0.
 */
function campaignSql(s, since, until, level) {
  const c = s.cols;
  const dim = level === 'ad' ? c.ad.sql : (level === 'adset' ? c.adset.sql : c.campaign.sql);
  // Some loaders store metrics as TEXT holding a decimal, so cast every numeric.
  const n = (e) => (e && e.sql !== 'null' ? `(${e.sql})::float` : 'null::float');
  const rv = s.revenue;
  if (rv) {
    const [db, schema] = s.table.split('.');
    const pre = `${db}.${schema}.`;
    return `with base as (
  select ${dim} as dim, ${(c.objective || nulSql()).sql} as objective, ${c.date.sql} as day,
         ${n(c.spend)} as spend, ${n(c.impressions)} as impressions, ${n(c.clicks)} as clicks,
         ${n(c.link_clicks)} as link_clicks, ${c.ad_id.sql} as ad_id, ${quoteIdent(rv.hash)} as h
    from ${s.table}${srcWhere(s, since, until)}
), pur as (
  select ${quoteIdent(rv.hash)} as h, sum("VALUE"::float) as purchases
    from ${pre}${rv.actions} where ACTION_TYPE = '${rv.action_type}' group by 1
), rev as (
  select ${quoteIdent(rv.hash)} as h, sum("VALUE"::float) as revenue
    from ${pre}${rv.values} where ACTION_TYPE = '${rv.action_type}' group by 1
)
select b.dim, any_value(b.objective) as objective, count(distinct b.ad_id) as ads,
       min(b.day) as first_day, max(b.day) as last_day, round(sum(b.spend),2) as spend,
       sum(b.impressions) as impressions, sum(b.clicks) as clicks, sum(b.link_clicks) as link_clicks,
       round(sum(coalesce(p.purchases,0)),0) as conversions, round(sum(coalesce(r.revenue,0)),2) as revenue
  from base b left join pur p on p.h = b.h left join rev r on r.h = b.h
 group by b.dim having sum(b.spend) > 0 order by spend desc`;
  }
  return `select ${dim} as dim, any_value(${(c.objective || nulSql()).sql}) as objective,
       count(distinct ${c.ad_id.sql}) as ads, min(${c.date.sql}) as first_day, max(${c.date.sql}) as last_day,
       round(sum(${n(c.spend)}),2) as spend, sum(${n(c.impressions)}) as impressions,
       sum(${n(c.clicks)}) as clicks, sum(${n(c.link_clicks)}) as link_clicks,
       round(sum(${n(c.conversions)}),1) as conversions,
       round(sum(${n(c.revenue)}),2) as revenue
  from ${s.table}${srcWhere(s, since, until)}
 group by 1 having sum(${n(c.spend)}) > 0 order by spend desc`;
}

async function campaigns({ since, until, account, level = 'campaign' } = {}) {
  const to = until || new Date().toISOString().slice(0, 10);
  const from = since || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const lv = ['campaign', 'adset', 'ad'].includes(String(level)) ? String(level) : 'campaign';
  const srcs = pickSources(account);
  if (!srcs.length) return noSources({ since: from, until: to, level: lv });
  const s = srcs[0];
  const sql = campaignSql(s, from, to, lv);
  if (!isConfigured()) return notConnected(sql, { since: from, until: to, account: describeAccount(s), level: lv });
  const r = await runStatement(sql);
  const rows = (r.rows || []).map((x) => {
    const spend = Number(x.spend) || 0;
    const impressions = Number(x.impressions) || 0;
    const link_clicks = Number(x.link_clicks) || 0;
    const conv = x.conversions == null ? null : Number(x.conversions);
    const rev = x.revenue == null ? null : Number(x.revenue);
    const tracked = s.kpi === 'roas';
    return { name: x.dim, objective: x.objective || null, ads: Number(x.ads) || 0,
      first_day: x.first_day ? String(x.first_day).slice(0, 10) : null,
      last_day: x.last_day ? String(x.last_day).slice(0, 10) : null,
      spend, impressions, clicks: Number(x.clicks) || 0, link_clicks,
      ctr_pct: impressions ? Number((100 * link_clicks / impressions).toFixed(2)) : null,
      cpc: link_clicks ? Number((spend / link_clicks).toFixed(2)) : null,
      cpm: impressions ? Number((1000 * spend / impressions).toFixed(2)) : null,
      conversions: tracked ? conv : null,
      revenue: tracked ? rev : null,
      roas: (tracked && rev != null && spend > 0) ? Number((rev / spend).toFixed(2)) : null,
      cpa: (tracked && conv) ? Number((spend / conv).toFixed(2)) : null };
  });
  return { ok: true, connected: true, source: 'snowflake', data_scope: DATA_SCOPE, since: from, until: to, level: lv,
    account: describeAccount(s), kpi: s.kpi, rows };
}

function primaryTable(platform, level) {
  const s = sources();
  if (platform === 'meta') return s.meta.ads;
  if (platform === 'google') return s.google.ads || s.google.adgroup_ad;
  if (platform === 'tiktok') return s.tiktok[String(level || 'campaign').toLowerCase()] || s.tiktok.campaign || s.tiktok.ad || s.tiktok.account;
  return null;
}

// Dedicated demographic/geo breakdown table for a (platform, dimension) — the
// real source of cohort splits (base insight tables carry targeting settings,
// not delivery breakdowns).
function cohortTable(platform, dimension) {
  const s = sources();
  if (platform === 'meta') {
    if (dimension === 'age' || dimension === 'gender') return s.meta.age_gender;
    if (dimension === 'device' || dimension === 'placement') return s.meta.device;
    return null;
  }
  if (platform === 'tiktok') {
    if (dimension === 'age' || dimension === 'gender') return s.tiktok.age_gender;
    if (dimension === 'country' || dimension === 'region') return s.tiktok.country;
    return null;
  }
  return null;
}
// Candidate column names for cohort dimensions + core measures (case-insensitive;
// resolved against the real column list from describe()).
const DIMENSION_CANDIDATES = {
  age: ['age', 'age_range', 'age_group', 'age_bucket'],
  gender: ['gender', 'sex'],
  language: ['language', 'locale', 'lang'],
  country: ['country', 'country_code', 'geo_country', 'country_id'],
  region: ['region', 'state', 'province', 'dma', 'geo_region'],
  city: ['city', 'geo_city'],
  device: ['device', 'device_platform', 'platform_device', 'impression_device'],
  placement: ['placement', 'publisher_platform', 'network', 'ad_network_type'],
};
// The three platforms do NOT share column naming, which is why every query
// resolves its columns from INFORMATION_SCHEMA instead of assuming one
// convention:
//   Meta    date_start      / account_name               / spend
//   TikTok  stat_time_day   / accountname                / spend
//   Google  "segments.date" / "customer.descriptive_name" / "metrics.cost_micros"
// Google's are literal dotted, lower-case identifiers and must be quoted; its
// cost is in micros and is converted to currency units on read.
const DATE_CANDIDATES = ['date_start', 'stat_time_day', 'segments.date', 'date', 'day', 'stat_date', 'report_date', 'date_stop', 'segments_date', 'event_date'];
const ACCOUNT_CANDIDATES = ['account_name', 'accountname', 'customer.descriptive_name', 'account', 'advertiser_name', 'advertisername', 'advertiser', 'customer_name', 'ad_account_name'];
const SPEND_CANDIDATES = ['spend', 'metrics.cost_micros', 'cost_micros', 'cost', 'total_cost'];
const MICRO_COLS = ['metrics.cost_micros', 'cost_micros'];

// Snowflake folds unquoted identifiers to upper case, so a column actually
// named `segments.date` (dotted, lower case, as Airbyte creates it) only
// resolves when quoted verbatim. Bare upper-case names are left unquoted.
function quoteIdent(name) {
  const n = String(name || '');
  if (!n) return n;
  return /^[A-Z_][A-Z0-9_]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`;
}
// A spend expression in currency units, converting micros where needed.
function spendExpr(col) {
  if (!col) return null;
  const q = quoteIdent(col);
  return MICRO_COLS.includes(String(col).toLowerCase()) ? `(${q} / 1000000)` : q;
}
// Resolves the real date / account / spend columns for a table, case-insensitively.
async function resolveCols(fqn) {
  const { db, schema, table } = splitTable(fqn);
  const sql = `select column_name from ${db}.information_schema.columns where table_schema = '${schema}' and table_name = '${table}'`;
  const r = await runStatement(sql);
  const names = (r.rows || []).map((x) => String(x.column_name || ''));
  const lower = names.map((n) => n.toLowerCase());
  const pick = (cands) => {
    for (const c of cands) { const i = lower.indexOf(String(c).toLowerCase()); if (i >= 0) return names[i]; }
    return null;
  };
  return { columns: names, date: pick(DATE_CANDIDATES), account: pick(ACCOUNT_CANDIDATES), spend: pick(SPEND_CANDIDATES) };
}

// ── Snowflake SQL REST API v2 (read-only) ─────────────────────────────────────
function sqlApiUrl(c) {
  const host = /snowflakecomputing\.com$/i.test(c.account) ? c.account : `${c.account}.snowflakecomputing.com`;
  return `https://${host}/api/v2/statements`;
}
const WRITE_RE = /\b(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|call|copy)\b/i;
async function runStatement(sql, timeoutMs = 45000) {
  if (WRITE_RE.test(sql)) throw new Error('READ-ONLY: only SELECT/SHOW/DESCRIBE statements are permitted against Snowflake.');
  const c = cfg();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(sqlApiUrl(c), {
      method: 'POST', signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${c.pat}`,
        'Content-Type': 'application/json', Accept: 'application/json',
        'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
      },
      body: JSON.stringify({ statement: sql, warehouse: c.warehouse, database: c.database || undefined, role: c.role || undefined, timeout: 60 }),
    });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    if (!res.ok) { const e = new Error(`snowflake ${res.status}: ${(json && (json.message || json.code)) || text || res.statusText}`); e.status = res.status; throw e; }
    const cols = ((json && json.resultSetMetaData && json.resultSetMetaData.rowType) || []).map((r) => String(r.name || '').toLowerCase());
    const rows = ((json && json.data) || []).map((row) => { const o = {}; cols.forEach((n, i) => { o[n] = row[i]; }); return o; });
    return { columns: cols, rows };
  } finally { clearTimeout(timer); }
}

function notConnected(sql, extra) {
  const gated = !liveConnectorsEnabled();
  return Object.assign({ ok: false, connected: false, not_connected: true, live_connectors_disabled: gated, would_query: sql,
    hint: gated
      ? 'Live connectors are disabled (LIVE_CONNECTORS is off). The app is running on cached/snapshot data and will not query Snowflake. Set LIVE_CONNECTORS=on (plus the SNOWFLAKE_* env vars) to run this read-only query for real. The SQL above is exactly what would be sent.'
      : 'Set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PAT, SNOWFLAKE_WAREHOUSE (+ SNOWFLAKE_DATABASE/ROLE) in Vercel env to run this read-only query for real. The SQL above is exactly what will be sent.' }, extra || {});
}

function splitTable(fqn) {
  const p = fqn.split('.');
  return p.length >= 3 ? { db: p[0], schema: p[1], table: p.slice(2).join('_') } : { db: cfg().database, schema: p[0], table: p[1] };
}

// Introspect the columns of any table (defaults to the platform's primary table
// for the given level). Auto-detects date / account / cohort-dimension columns.
async function describe({ platform = 'meta', level, table: tblOverride } = {}) {
  const t = tblOverride || primaryTable(platform, level);
  if (!t) return noSources({ platform, level: level || null });
  const { db, schema, table } = splitTable(t);
  const sql = `select column_name, data_type from ${db}.information_schema.columns where table_schema = '${schema}' and table_name = '${table}' order by ordinal_position`;
  if (!isConfigured()) return notConnected(sql, { platform, table: t });
  const r = await runStatement(sql);
  const cols = r.rows.map((x) => ({ name: String(x.column_name || '').toLowerCase(), type: x.data_type }));
  const names = cols.map((c) => c.name);
  const found = (cands) => cands.find((c) => names.includes(c)) || null;
  const dimensions = Object.fromEntries(Object.entries(DIMENSION_CANDIDATES).map(([k, v]) => [k, found(v)]));
  return {
    ok: true, connected: true, platform, table: t, source: 'snowflake',
    columns: cols,
    detected: { date: found(DATE_CANDIDATES), account: found(ACCOUNT_CANDIDATES), dimensions },
  };
}

function accountFilter(col, account) {
  if (!account || !col) return '';
  return ` and lower(${quoteIdent(col)}) like '%${String(account).toLowerCase().replace(/'/g, '')}%'`;
}
function dateFilter(col, since, until) {
  if (!col || !since || !until) return '';
  return ` and ${quoteIdent(col)} between '${since}' and '${until}'`;
}

// Recent rows (all available metrics) for a platform, optionally filtered by a
// substring of the account-name column, and a date range. "SELECT *" so every
// metric the table carries is returned — nothing is dropped or invented.
async function metrics({ platform = 'meta', account, since, until, level, limit = 500 } = {}) {
  const t = primaryTable(platform, level);
  if (!t) return noSources({ platform, level: level || null, account: account || null });
  const cap = Math.min(+limit || 500, 5000);
  if (!isConfigured()) {
    // Unconnected preview uses the most likely names per platform; the live
    // path below resolves them for real from INFORMATION_SCHEMA.
    const guessDate = platform === 'tiktok' ? 'stat_time_day' : platform === 'google' ? 'segments.date' : 'date_start';
    const guessAcct = platform === 'tiktok' ? 'accountname' : platform === 'google' ? 'customer.descriptive_name' : 'account_name';
    const sql = `select * from ${t} where 1=1${accountFilter(guessAcct, account)}${dateFilter(guessDate, since, until)} order by ${quoteIdent(guessDate)} desc limit ${cap}`;
    return notConnected(sql, { platform, account: account || null, level: level || null, table: t });
  }
  // Resolve the real column names — Meta, TikTok and Google each name their
  // date and account columns differently (see the candidate lists above).
  const cols = await resolveCols(t);
  const where = `where 1=1${accountFilter(cols.account, account)}${dateFilter(cols.date, since, until)}`;
  const order = cols.date ? ` order by ${quoteIdent(cols.date)} desc` : '';
  const sql = `select * from ${t} ${where}${order} limit ${cap}`;
  const r = await runStatement(sql);
  // Expose a normalized `spend` alongside the raw columns so the UI totals are
  // correct even where the platform reports cost in micros (Google).
  const spendCol = cols.spend;
  const isMicro = spendCol && MICRO_COLS.includes(String(spendCol).toLowerCase());
  const rows = (r.rows || []).map((row) => {
    if (!spendCol) return row;
    const raw = row[String(spendCol).toLowerCase()];
    const v = raw == null || raw === '' || isNaN(Number(raw)) ? null : Number(raw) / (isMicro ? 1e6 : 1);
    return (v == null || row.spend != null) ? row : Object.assign({}, row, { spend: v });
  });
  return { ok: true, connected: true, platform, level: level || null, account: account || null, table: t,
    source: 'snowflake', resolved_columns: { date: cols.date, account: cols.account, spend: spendCol, spend_in_micros: !!isMicro },
    columns: r.columns.indexOf('spend') >= 0 ? r.columns : r.columns.concat(spendCol ? ['spend'] : []), rows };
}

// Aggregate a measure by a cohort dimension (age/gender/country/…) — the raw
// material for building demographic / geo / behavioural cohorts. Resolves the
// real column names from describe() first so it adapts to each table.
async function cohort({ platform = 'meta', dimension = 'country', measure = 'spend', account, since, until, level } = {}) {
  // Prefer the dedicated demographic/geo breakdown table for this dimension;
  // fall back to the primary table (e.g. device/placement columns present there).
  const t = cohortTable(platform, dimension) || primaryTable(platform, level);
  if (!t) return noSources({ platform, dimension, measure });
  const buildSql = (dimCol, dateCol, acctCol, measureExpr) => {
    const where = `where 1=1${accountFilter(acctCol, account)}${dateFilter(dateCol, since, until)}`;
    const dq = quoteIdent(dimCol);
    return `select ${dq} as cohort, sum(${measureExpr}) as value, count(*) as rows
            from ${t} ${where} group by ${dq} order by value desc nulls last limit 200`;
  };
  if (!isConfigured()) {
    const guessDim = (DIMENSION_CANDIDATES[dimension] || [dimension])[0];
    const guessDate = platform === 'tiktok' ? 'stat_time_day' : platform === 'google' ? 'segments.date' : 'date_start';
    const guessAcct = platform === 'tiktok' ? 'accountname' : platform === 'google' ? 'customer.descriptive_name' : 'account_name';
    return notConnected(buildSql(guessDim, guessDate, guessAcct, quoteIdent(measure)), { platform, dimension, measure, account: account || null, table: t });
  }
  const d = await describe({ platform, table: t });
  const dimCol = d.detected && d.detected.dimensions && d.detected.dimensions[dimension];
  if (!dimCol) return { ok: false, connected: true, platform, dimension, table: t, error: `Dimension '${dimension}' is not a column in ${t}. Available dimensions: ${Object.entries((d.detected || {}).dimensions || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none detected'}.` };
  // Resolve the measure against the real columns; fall back to the table's own
  // spend column (which may be micros, e.g. Google) rather than a literal 'spend'.
  const names = (d.columns || []).map((c) => c.name);
  const lower = names.map((n) => n.toLowerCase());
  const askedIdx = lower.indexOf(String(measure).toLowerCase());
  const cols = await resolveCols(t);
  const measureCol = askedIdx >= 0 ? names[askedIdx] : cols.spend;
  if (!measureCol) return { ok: false, connected: true, platform, dimension, table: t, error: `Measure '${measure}' is not a column in ${t} and no spend column was found.` };
  const sql = buildSql(dimCol, cols.date, cols.account, spendExpr(measureCol));
  const r = await runStatement(sql);
  return { ok: true, connected: true, platform, dimension, dimension_column: dimCol, measure: measureCol,
    measure_in_micros: MICRO_COLS.includes(String(measureCol).toLowerCase()),
    account: account || null, table: t, source: 'snowflake', rows: r.rows };
}

function status() {
  const srcs = adSources();
  return {
    ok: true, configured: isConfigured(), source: 'snowflake',
    data_scope: DATA_SCOPE,
    platforms: PLATFORMS, budgets: budgets(),
    tables: sources(), table_env: tableEnvNames(),
    sources: srcs.map(describeAccount), has_sources: srcs.length > 0,
    live_connectors_disabled: !liveConnectorsEnabled(),
    note: !srcs.length
      ? 'No ad table is configured for this deployment, so there is nothing to read. Set SF_META_ADS_TABLE / SF_GOOGLE_ADS_TABLE / SF_TIKTOK_AD_TABLE to your own fully-qualified warehouse tables. There is deliberately no default table name: a bundled one would point at somebody else\'s warehouse.'
      : (isConfigured()
        ? 'Snowflake connected — live ad data from the configured tables (read-only).'
        : (!liveConnectorsEnabled()
          ? 'Live connectors are disabled (LIVE_CONNECTORS is off). No connection to Snowflake is made and no figure is shown. Set LIVE_CONNECTORS=on plus the SNOWFLAKE_* env vars to pull live data.'
          : 'Snowflake not configured. Set SNOWFLAKE_* env vars to pull live ad data; every op returns the exact read-only SQL it will run until then. No figures are fabricated.')),
  };
}

// Live connection test — runs a trivial read (SELECT 1) so the UI can verify the
// warehouse is actually REACHABLE with the configured credentials, not merely
// that env vars are present. Reports which env vars are missing when unconfigured,
// and the exact upstream error (e.g. 401 = bad/expired PAT) when a request fails,
// so the connection can be diagnosed without guesswork. Read-only.
async function ping() {
  const c = cfg();
  const present = { account: !!c.account, user: !!c.user, pat: !!c.pat, warehouse: !!c.warehouse, database: !!c.database, role: !!c.role };
  const missing = ['account', 'user', 'pat', 'warehouse'].filter((k) => !present[k]).map((k) => `SNOWFLAKE_${k.toUpperCase()}`);
  if (!liveConnectorsEnabled()) {
    return { ok: false, connected: false, configured: false, reachable: false, live_connectors_disabled: true, present,
      hint: 'Live connectors are disabled (LIVE_CONNECTORS is off). The app runs on cached/snapshot data and will not reach Snowflake. Set LIVE_CONNECTORS=on (plus the SNOWFLAKE_* env vars) to test a live connection.' };
  }
  if (!isConfigured()) {
    return { ok: false, connected: false, configured: false, reachable: false, present, missing,
      hint: `Set ${missing.join(', ')} in Vercel (a read-only PAT for SNOWFLAKE_PAT). SNOWFLAKE_ACCOUNT is the ORG-ACCOUNT identifier for your own Snowflake account, in the form ORGNAME-ACCOUNTNAME; the bare account locator does not work with the SQL API v2.` };
  }
  const started = Date.now();
  try {
    const r = await runStatement('select 1 as ok', 20000);
    const ok = Array.isArray(r.rows) && r.rows.length > 0;
    return { ok, connected: true, configured: true, reachable: ok, present,
      latency_ms: Date.now() - started, account_host: sqlApiUrl(c).replace(/^https:\/\//, '').replace(/\/api.*/, ''),
      warehouse: c.warehouse, database: c.database || null, role: c.role || null,
      note: 'Live SELECT 1 succeeded — the warehouse is reachable read-only with the configured credentials.' };
  } catch (e) {
    return { ok: false, connected: true, configured: true, reachable: false, present,
      latency_ms: Date.now() - started, status: e.status || null, error: e.message || String(e),
      hint: e.status === 401 || e.status === 403
        ? 'Credentials rejected: check SNOWFLAKE_PAT (a valid, non-expired Programmatic Access Token) and SNOWFLAKE_USER, and that the PAT/role can use the warehouse.'
        : 'Configured but the request failed. Verify SNOWFLAKE_ACCOUNT (the ORG-ACCOUNT identifier, not the account locator), SNOWFLAKE_WAREHOUSE and network access.' };
  }
}

module.exports = {
  status, ping, describe, metrics, cohort, budgets, runStatement,
  isConfigured, PLATFORMS, DIMENSION_CANDIDATES, sources, tableEnvNames,
  adSources, hasSources, noSources, describeAccount, accounts, multiDaily, campaigns,
  pickSources, unionSelect, DATA_SCOPE,
};
