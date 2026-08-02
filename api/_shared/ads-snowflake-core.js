'use strict';

/**
 * api/_shared/ads-snowflake-core.js — LIVE ads analysis from Snowflake (READ ONLY).
 *
 * Pulls Meta / Google / TikTok ad data straight from the warehouse via the
 * Snowflake SQL REST API v2, for the Costco and Target US ad accounts. Built for
 * the cohort/segmentation framework: it discovers the columns actually present in
 * each source table (INFORMATION_SCHEMA) so the dashboard can slice by any
 * available demographic/geo/behavioural dimension (age, gender, language,
 * country, region, device, placement, …) to build cohorts.
 *
 * Source tables (override each via env; DB.SCHEMA.TABLE or SCHEMA.TABLE — a
 * 2-part value is prefixed with SNOWFLAKE_DATABASE):
 *   TikTok : DATON.RAW.TIKTOK_ADS_USA        (SF_TIKTOK_ADS_TABLE)
 *   Meta   : MAPLEMONK.META_USA_ADS          (SF_META_ADS_TABLE)
 *            MAPLEMONK1.META_USA_ADS         (SF_META_ADS1_TABLE)
 *            MAPLEMONK1.META_USA_AD_CREATIVES (SF_META_CREATIVES_TABLE)
 *   Google : MAPLEMONK.GOOGLE_ADS_US_AD_GROUP_AD_REPORT (SF_GOOGLE_ADS_TABLE)
 *
 * Live-verified 2026-07-25 (Snowflake connector, INFORMATION_SCHEMA):
 *   META_USA_ADS_INSIGHTS 129,741 rows spanning 2024-05-15 → 2026-07-25;
 *   TIKTOK_ADS_USA_{CAMPAIGN 1,012 / ADGROUP 3,842 / AD 13,838}_REPORT_DAILY
 *   (+ AGE_GENDER 7,453, COUNTRY 1,114); GOOGLE_ADS_US_AD_GROUP_AD_REPORT
 *   91,135 rows. MAPLEMONK1 breakdown tables were NOT found in the live
 *   warehouse — the age/gender/device/creatives defaults below stay
 *   env-overridable and unverified.
 *
 * READ ONLY: only SELECT / SHOW / INFORMATION_SCHEMA reads are ever issued — no
 * INSERT/UPDATE/MERGE/DELETE. Until SNOWFLAKE_* env vars are set, every op returns
 * a { connected:false, would_query } envelope with the exact SQL it would run —
 * never a fabricated number.
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
const ACCOUNTS = ['target', 'costco']; // budgets: Target $1000/day, Costco $300/day (editable)

// Editable daily budget caps (USD). Overridable via env; a settings UI can also
// persist overrides later. Read-only here — no push to the ad platforms.
function budgets() {
  return {
    target: Number(process.env.ADS_BUDGET_TARGET_DAILY || 1000),
    costco: Number(process.env.ADS_BUDGET_COSTCO_DAILY || 300),
    currency: 'USD', basis: 'per day', editable: true,
    note: 'Daily budget caps for reference/alerting only. Read-only — the app never edits budgets on the ad platforms.',
  };
}

function tableRef(envKey, dflt) {
  const raw = (process.env[envKey] || dflt).trim();
  const parts = raw.split('.');
  if (parts.length >= 3) return raw.toUpperCase();           // db.schema.table given
  const db = (process.env.SNOWFLAKE_DATABASE || '').trim();  // schema.table -> prefix db
  return (db ? db + '.' + raw : raw).toUpperCase();
}
// Verified against the live warehouse (Saras/Daton + Maplemonk pipelines). Each
// is env-overridable. TikTok reports are per level; Meta/TikTok expose dedicated
// demographic/geo breakdown tables used for cohorts.
function sources() {
  return {
    tiktok: {
      account: tableRef('SF_TIKTOK_ADS_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY'),
      campaign: tableRef('SF_TIKTOK_CAMPAIGN_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY'),
      adgroup: tableRef('SF_TIKTOK_ADGROUP_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_ADGROUP_REPORT_DAILY'),
      ad: tableRef('SF_TIKTOK_AD_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_AD_REPORT_DAILY'),
      age_gender: tableRef('SF_TIKTOK_AGE_GENDER_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY_AGE_GENDER'),
      country: tableRef('SF_TIKTOK_COUNTRY_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY_COUNTRY'),
    },
    meta: {
      ads: tableRef('SF_META_ADS_TABLE', 'KNICKGASM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS'),
      age_gender: tableRef('SF_META_AGE_GENDER_TABLE', 'KNICKGASM_DB.MAPLEMONK1.META_USA_ADS_INSIGHTS_AGE_AND_GENDER'),
      device: tableRef('SF_META_DEVICE_TABLE', 'KNICKGASM_DB.MAPLEMONK1.META_USA_ADS_INSIGHTS_PLATFORM_AND_DEVICE'),
      creatives: tableRef('SF_META_CREATIVES_TABLE', 'KNICKGASM_DB.MAPLEMONK1.META_USA_AD_CREATIVES'),
    },
    // GOOGLE_ADS_USA does not exist in the warehouse. Neither does the live US
    // Google feed sit in GOOGLE_ADS_US_AD_GROUP_AD_REPORT — that table holds the
    // RETIRED customer 2769294429 ("KNICKGASM - USA - Old") and stops 2023-11-24,
    // which is why US Google looked dead. The live feed is the consolidated view
    // (verified 2026-07-26: 124,545 rows, fresh to 2026-07-25, 23 campaigns and
    // $72,343.46 spend in 2026 YTD). See adAccounts() for the full registry.
    google: {
      ads: tableRef('SF_GOOGLE_ADS_TABLE', 'KNICKGASM_DB.MAPLEMONK.US_GOOGLE_ADS_CONSOLIDATED'),
      adgroup_ad: tableRef('SF_GOOGLE_ADGROUP_AD_TABLE', 'KNICKGASM_DB.MAPLEMONK.US_GADS_AD_GROUP_AD_REPORT'),
      amazon: tableRef('SF_GOOGLE_AMZ_TABLE', 'KNICKGASM_DB.MAPLEMONK.US_AMZ_GADS_AD_GROUP_AD_REPORT'),
      retired: tableRef('SF_GOOGLE_RETIRED_TABLE', 'KNICKGASM_DB.MAPLEMONK.GOOGLE_ADS_US_AD_GROUP_AD_REPORT'),
    },
  };
}
/**
 * Ad-account registry — the full set of KNICKGASM ad accounts held in the warehouse,
 * enumerated live on 2026-07-26 by unioning every base insights / ad-performance
 * table in KNICKGASM_DB and grouping by account. Two things make this necessary:
 *
 *  1. KNICKGASM runs SEVERAL US accounts per platform, and they do NOT share a
 *     schema or a naming convention. The Target/Costco Meta account sits in
 *     MAPLEMONK under the non-obvious name USA_TEA_ADS_ADS_INSIGHTS (not
 *     META_USA%), and the live US Google feed is US_GOOGLE_ADS_CONSOLIDATED —
 *     NOT GOOGLE_ADS_US_AD_GROUP_AD_REPORT, which holds a retired customer id
 *     and stops in 2023. Searching by the obvious name finds one account and
 *     makes the rest look absent.
 *  2. The accounts are not comparable on one KPI. The DTC and Google accounts
 *     carry pixel purchases and revenue, so ROAS/CPA is meaningful. The retail
 *     (Target/Costco) and Amazon accounts send traffic to a THIRD-PARTY
 *     checkout — target.com, Instacart, amazon.com — so they record zero
 *     purchases by construction and must be judged on CTR / CPC / CPM / reach.
 *     Ranking them on ROAS would report every retail campaign as a total
 *     failure. Each entry therefore declares its own `kpi` and `attribution`.
 *
 * Column naming differs by pipeline: Maplemonk insights tables use bare
 * UPPER-CASE identifiers, Maplemonk's Google reports use dotted lower-case GAQL
 * field names with cost in micros, and DC_RAW (Datachannel) uses quoted
 * lower-case ones exposing unique_inline_link_clicks rather than
 * inline_link_clicks. Every entry carries its own column map and each query is
 * built from that map, so no query hardcodes a column that may not exist.
 *
 * `verified` records the figures read straight from the warehouse when the entry
 * was written, so a later drift is visible rather than silent.
 */
function adAccounts() {
  const q = (n) => ({ raw: n, sql: quoteIdent(n) });
  const micros = (n) => ({ raw: n, sql: `(${quoteIdent(n)} / 1000000.0)` });
  // Retail-media feeds land as Airbyte CSV loads, so every figure arrives as TEXT
  // carrying a currency symbol and thousands separators ('$125.95', '2,907,903')
  // and every date as DD-MM-YYYY text. Casting those straight to a number fails
  // outright, so they are cleaned in the column expression itself.
  const cash = (n) => ({ raw: n, sql: `try_to_double(replace(replace(${quoteIdent(n)},'$',''),',',''))` });
  const qty = (n) => ({ raw: n, sql: `try_to_double(replace(${quoteIdent(n)},',',''))` });
  // Some of these feeds carry TWO date shapes in one column: 'DD-MM-YYYY' for the
  // older rows and 'DD-MM-YYYY H:MI' for the newer ones. Parsing only the bare
  // form silently drops the newest rows — it made Target sell-through look like it
  // ended 2026-07-13 when it actually runs to 2026-07-23. Split on the space first.
  const dmy = (n) => ({ raw: n, sql: `try_to_date(split_part(${quoteIdent(n)},' ',1),'DD-MM-YYYY')` });
  const lit = (v) => ({ raw: v, sql: `'${String(v).replace(/'/g, "''")}'` });
  const nul = { raw: null, sql: 'null' };
  // Meta insights tables (Maplemonk/Airbyte): purchases and revenue live in
  // sibling _ACTIONS / _ACTION_VALUES tables joined on the Airbyte hash id.
  const metaRev = (stem) => ({ hash: `_AIRBYTE_${stem}_HASHID`, actions: `${stem}_ACTIONS`, values: `${stem}_ACTION_VALUES`, action_type: 'purchase' });
  return [
    // ---------------------------------------------------------------- Meta, US
    { id: 'dtc', platform: 'meta', region: 'US', status: 'live',
      label: 'Knickgasm India USA New EST Main Account', account_id: '1303870183798748',
      table: tableRef('SF_META_ADS_TABLE', 'KNICKGASM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS'), schema: 'MAPLEMONK',
      fresh_to: '2026-07-25', partial_day: true,
      purpose: 'US direct-to-consumer storefront. The revenue account: coffee, airbrush and supplement scale campaigns plus evergreen sneaker, all landing on knickgasm.com with the Meta pixel firing.',
      used_for: 'Prospecting and retargeting to own-site checkout',
      kpi: 'roas', attribution: 'meta_pixel',
      verified: { rows: 129741, first_day: '2024-05-15', last_day: '2026-07-25', campaigns: 106, ads: 2299, spend: 425107.22 },
      revenue: metaRev('META_USA_ADS_INSIGHTS'),
      cols: { date: q('DATE_START'), spend: q('SPEND'), impressions: q('IMPRESSIONS'), clicks: q('CLICKS'),
        link_clicks: q('INLINE_LINK_CLICKS'), campaign: q('CAMPAIGN_NAME'), adset: q('ADSET_NAME'),
        ad: q('AD_NAME'), ad_id: q('AD_ID'), account: q('ACCOUNT_NAME'), account_id: q('ACCOUNT_ID'),
        objective: q('OBJECTIVE') } },
    { id: 'retail', platform: 'meta', region: 'US', status: 'live',
      label: 'KNICKGASM USA - Sneaker Ad Account (Target / Costco)', account_id: '804570870670763',
      table: tableRef('SF_META_RETAIL_TABLE', 'KNICKGASM_DB.MAPLEMONK.USA_TEA_ADS_ADS_INSIGHTS'), schema: 'MAPLEMONK',
      fresh_to: '2026-07-25', partial_day: true,
      purpose: 'US retail-partner demand generation. Drives shoppers to Target stores and target.com, and to Costco via Instacart — the Page Deck sales sets, the scored UGC video sets, influencer link-click sets, Costco Bay Area reach buys and Target giveaways.',
      used_for: 'Sell-through at Target and Costco (third-party checkout)',
      kpi: 'traffic', attribution: 'none',
      attribution_note: 'Zero purchases by construction: checkout happens on target.com, Instacart or in store, so no KNICKGASM pixel fires. Judge on CTR, CPC, CPM and reach — never ROAS.',
      verified: { rows: 6556, first_day: '2025-09-24', last_day: '2026-07-25', campaigns: 26, ads: 214, spend: 50248.24 },
      revenue: metaRev('USA_TEA_ADS_ADS_INSIGHTS'),
      cols: { date: q('DATE_START'), spend: q('SPEND'), impressions: q('IMPRESSIONS'), clicks: q('CLICKS'),
        link_clicks: q('INLINE_LINK_CLICKS'), campaign: q('CAMPAIGN_NAME'), adset: q('ADSET_NAME'),
        ad: q('AD_NAME'), ad_id: q('AD_ID'), account: q('ACCOUNT_NAME'), account_id: q('ACCOUNT_ID'),
        objective: q('OBJECTIVE') } },
    { id: 'retail_dc', platform: 'meta', region: 'US', status: 'superseded',
      label: 'KNICKGASM USA - Sneaker Ad Account (Datachannel mirror)', account_id: '804570870670763',
      table: tableRef('SF_META_RETAIL_DC_TABLE', 'KNICKGASM_DB.DC_RAW.FB2_KNICKGASM_KNICKGASMUSATEA_US_FBADS_ADPERFORMANCE'), schema: 'DC_RAW',
      fresh_to: '2026-05-31', partial_day: false,
      purpose: 'Older Datachannel mirror of the same retail account. Superseded by the Maplemonk feed above, which is both fresher and far more complete (26 campaigns / $50,248.24 against 7 / $4,056.11).',
      used_for: 'History only — do not use for current retail reporting',
      kpi: 'traffic', attribution: 'none',
      stale_note: 'Feed ends 2026-05-31 and holds only 7 of the 26 retail campaigns. Kept so the pre-Maplemonk history stays queryable.',
      verified: { rows: 8953, first_day: '2024-11-11', last_day: '2026-05-31', campaigns: 7, ads: 56, spend: 4056.11 },
      cols: { date: q('date_start'), spend: q('spend'), impressions: q('impressions'), clicks: q('clicks'),
        link_clicks: q('unique_inline_link_clicks'), campaign: q('campaign_name'), adset: q('adset_name'),
        ad: q('ad_name'), ad_id: q('ad_id'), account: q('account_name'), account_id: q('account_id'),
        objective: nul } },
    { id: 'dtc_dc', platform: 'meta', region: 'US', status: 'superseded',
      label: 'Knickgasm India USA New EST Main Account (Datachannel mirror)', account_id: '1303870183798748',
      table: tableRef('SF_META_DTC_DC_TABLE', 'KNICKGASM_DB.DC_RAW.FB2_KNICKGASM_KNICKGASMINDIAUSA_US_FBADS_ADPERFORMANCE'), schema: 'DC_RAW',
      fresh_to: '2026-06-01', partial_day: false,
      purpose: 'Datachannel mirror of the DTC account. Its value is DEPTH, not freshness: it reaches back to 2023-01-16 and carries 147 campaigns against the Maplemonk feed 106 from 2024-05-15, so pre-May-2024 DTC history is only available here.',
      used_for: 'Pre-May-2024 DTC history',
      kpi: 'traffic', attribution: 'none',
      stale_note: 'Feed ends 2026-06-01. Use the Maplemonk DTC feed for anything current.',
      verified: { rows: 133948, first_day: '2023-01-16', last_day: '2026-06-01', campaigns: 147, ads: 2601, spend: 471130.03 },
      cols: { date: q('date_start'), spend: q('spend'), impressions: q('impressions'), clicks: q('clicks'),
        link_clicks: q('unique_inline_link_clicks'), campaign: q('campaign_name'), adset: q('adset_name'),
        ad: q('ad_name'), ad_id: q('ad_id'), account: q('account_name'), account_id: q('account_id'),
        objective: nul } },
    { id: 'legacy', platform: 'meta', region: 'US', status: 'stale',
      label: 'Knickgasm USA - New Account', account_id: '277324470754263',
      table: tableRef('SF_META_LEGACY_TABLE', 'KNICKGASM_DB.DC_RAW.FB2_KNICKGASM_KNICKGASMUSA_US_FBADS_ADPERFORMANCE'), schema: 'DC_RAW',
      fresh_to: '2026-01-29', partial_day: false,
      purpose: 'Small secondary US account, wound down in January 2026. No Target or Costco campaigns.',
      used_for: 'History only',
      kpi: 'traffic', attribution: 'none',
      stale_note: 'Feed ends 2026-01-29 — history only.',
      verified: { rows: 165157, first_day: '2023-01-01', last_day: '2026-01-29', campaigns: 61, ads: 214, spend: 14689.84 },
      cols: { date: q('date_start'), spend: q('spend'), impressions: q('impressions'), clicks: q('clicks'),
        link_clicks: q('unique_inline_link_clicks'), campaign: q('campaign_name'), adset: q('adset_name'),
        ad: q('ad_name'), ad_id: q('ad_id'), account: q('account_name'), account_id: q('account_id'),
        objective: nul } },
    { id: 'meta_us_2022', platform: 'meta', region: 'US', status: 'archive',
      label: 'Knickgasm - USA (pre-2023 main account)', account_id: '591998667827917',
      table: tableRef('SF_META_US2022_TABLE', 'KNICKGASM_DB.MAPLEMONK.FB_USA_MAIN_ADS_INSIGHTS'), schema: 'MAPLEMONK',
      fresh_to: '2022-08-08', partial_day: false,
      purpose: 'The original US main account and still the largest single US Meta spender on record at $1.11M. Useful as a long-run benchmark for what US scale looked like in 2021-22.',
      used_for: 'Historic benchmark',
      kpi: 'traffic', attribution: 'none',
      stale_note: 'Closed feed, ends 2022-08-08.',
      verified: { rows: 308008, first_day: '2021-01-01', last_day: '2022-08-08', campaigns: 228, ads: 4525, spend: 1108896.95 },
      cols: { date: q('DATE_START'), spend: q('SPEND'), impressions: q('IMPRESSIONS'), clicks: q('CLICKS'),
        link_clicks: q('INLINE_LINK_CLICKS'), campaign: q('CAMPAIGN_NAME'), adset: q('ADSET_NAME'),
        ad: q('AD_NAME'), ad_id: q('AD_ID'), account: q('ACCOUNT_NAME'), account_id: q('ACCOUNT_ID'),
        objective: q('OBJECTIVE') } },
    { id: 'meta_us_agency', platform: 'meta', region: 'US', status: 'archive',
      label: 'PH - KNICKGASM (agency-run US account)', account_id: '324830121807495',
      table: tableRef('SF_META_USAGENCY_TABLE', 'KNICKGASM_DB.MAPLEMONK.BMG_US_FB_ADS_INSIGHTS'), schema: 'MAPLEMONK',
      fresh_to: '2022-08-08', partial_day: false,
      purpose: 'US account run by an outside agency in 2021-22, $420,666.79 across 20 campaigns.',
      used_for: 'Historic benchmark',
      kpi: 'traffic', attribution: 'none',
      stale_note: 'Closed feed, ends 2022-08-08.',
      verified: { rows: 38259, first_day: '2021-10-01', last_day: '2022-08-08', campaigns: 20, ads: 798, spend: 420666.79 },
      cols: { date: q('DATE_START'), spend: q('SPEND'), impressions: q('IMPRESSIONS'), clicks: q('CLICKS'),
        link_clicks: q('INLINE_LINK_CLICKS'), campaign: q('CAMPAIGN_NAME'), adset: q('ADSET_NAME'),
        ad: q('AD_NAME'), ad_id: q('AD_ID'), account: q('ACCOUNT_NAME'), account_id: q('ACCOUNT_ID'),
        objective: q('OBJECTIVE') } },
    { id: 'meta_us_influencer', platform: 'meta', region: 'US', status: 'archive',
      label: 'Influencer Account (US)', account_id: '277324470754263',
      table: tableRef('SF_META_USINFL_TABLE', 'KNICKGASM_DB.MAPLEMONK.INFLUENCER_USA_ADS_INSIGHTS'), schema: 'MAPLEMONK',
      fresh_to: '2022-08-08', partial_day: false,
      purpose: 'Creator/influencer whitelisting account, $305,688.18 across 55 campaigns. Shares its account id with the "Knickgasm USA - New Account" feed but reports under a different name.',
      used_for: 'Historic influencer-amplification benchmark',
      kpi: 'traffic', attribution: 'none',
      stale_note: 'Closed feed, ends 2022-08-08.',
      verified: { rows: 60569, first_day: '2021-06-05', last_day: '2022-08-08', campaigns: 55, ads: 1111, spend: 305688.18 },
      cols: { date: q('DATE_START'), spend: q('SPEND'), impressions: q('IMPRESSIONS'), clicks: q('CLICKS'),
        link_clicks: q('INLINE_LINK_CLICKS'), campaign: q('CAMPAIGN_NAME'), adset: q('ADSET_NAME'),
        ad: q('AD_NAME'), ad_id: q('AD_ID'), account: q('ACCOUNT_NAME'), account_id: q('ACCOUNT_ID'),
        objective: q('OBJECTIVE') } },
    // -------------------------------------------------------------- Meta, other
    { id: 'meta_uk', platform: 'meta', region: 'UK', status: 'live',
      label: 'KNICKGASM UK', account_id: '573128874469619',
      table: tableRef('SF_META_UK_TABLE', 'KNICKGASM_DB.MAPLEMONK.META_UK_ADS_INSIGHTS'), schema: 'MAPLEMONK',
      fresh_to: '2026-07-26', partial_day: true,
      purpose: 'UK direct-to-consumer account on knickgasm.com. The freshest feed in the warehouse.',
      used_for: 'UK D2C acquisition and retention',
      kpi: 'roas', attribution: 'meta_pixel',
      verified: { rows: 154585, last_day: '2026-07-26', campaigns: 37, spend: 661518.68 },
      revenue: metaRev('META_UK_ADS_INSIGHTS'),
      cols: { date: q('DATE_START'), spend: q('SPEND'), impressions: q('IMPRESSIONS'), clicks: q('CLICKS'),
        link_clicks: q('INLINE_LINK_CLICKS'), campaign: q('CAMPAIGN_NAME'), adset: q('ADSET_NAME'),
        ad: q('AD_NAME'), ad_id: q('AD_ID'), account: q('ACCOUNT_NAME'), account_id: q('ACCOUNT_ID'),
        objective: q('OBJECTIVE') } },
    { id: 'meta_in', platform: 'meta', region: 'IN', status: 'live',
      label: 'KNICKGASM', account_id: '70950428',
      table: tableRef('SF_META_IN_TABLE', 'KNICKGASM_DB.MAPLEMONK.META_INDIA_ADS_INSIGHTS'), schema: 'MAPLEMONK',
      fresh_to: '2026-07-25', partial_day: true,
      purpose: 'India D2C account on knickgasm.com and by far the largest Meta spender in the group at INR 36.87M lifetime. Reports in INR, so never sum it with the USD accounts.',
      used_for: 'India D2C acquisition and retention',
      kpi: 'roas', attribution: 'meta_pixel', currency: 'INR',
      verified: { rows: 117863, last_day: '2026-07-25', campaigns: 89, spend: 36866447.39 },
      revenue: metaRev('META_INDIA_ADS_INSIGHTS'),
      cols: { date: q('DATE_START'), spend: q('SPEND'), impressions: q('IMPRESSIONS'), clicks: q('CLICKS'),
        link_clicks: q('INLINE_LINK_CLICKS'), campaign: q('CAMPAIGN_NAME'), adset: q('ADSET_NAME'),
        ad: q('AD_NAME'), ad_id: q('AD_ID'), account: q('ACCOUNT_NAME'), account_id: q('ACCOUNT_ID'),
        objective: q('OBJECTIVE') } },
    // -------------------------------------------------------------- Google Ads
    { id: 'google_us', platform: 'google', region: 'US', status: 'live',
      label: 'KNICKGASM (US Google Ads)', account_id: '9797311905',
      table: tableRef('SF_GOOGLE_ADS_TABLE', 'KNICKGASM_DB.MAPLEMONK.US_GOOGLE_ADS_CONSOLIDATED'), schema: 'MAPLEMONK',
      filter: "ACCOUNT = 'Google US CONSOLIDATED'",
      fresh_to: '2026-07-25', partial_day: true,
      purpose: 'US Google Ads: brand and non-brand search, the VM_ PMax family across all products and top cities, Shopping, Demand Gen and remarketing. Carries Google-attributed conversions and conversion value, so ROAS is meaningful.',
      used_for: 'US search, Shopping and PMax demand capture',
      kpi: 'roas', attribution: 'google_conversions',
      verified: { rows: 32236, first_day: '2023-01-17', last_day: '2026-07-25', campaigns: 131, spend: 457180.35,
        note: 'Row count is the ACCOUNT-filtered live slice; the table holds 124,545 rows in total, the rest under the archived "Google US" label that stops 2023-11-24.' },
      cols: { date: q('SEGMENTS_DATE'), spend: q('SPEND'), impressions: q('IMPRESSIONS'), clicks: q('CLICKS'),
        link_clicks: q('CLICKS'), campaign: q('CAMPAIGN_NAME'), adset: q('AD_GROUP_NAME'),
        ad: q('AD_GROUP_NAME'), ad_id: q('AD_GROUP_AD_ID'), account: q('ACCOUNT'), account_id: lit('9797311905'),
        objective: q('CHANNEL'), conversions: q('CONVERSIONS'), revenue: q('CONVERSION_VALUE') } },
    { id: 'google_us_adgroup', platform: 'google', region: 'US', status: 'live',
      label: 'KNICKGASM (US Google Ads, ad-level detail)', account_id: '9797311905',
      table: tableRef('SF_GOOGLE_ADGROUP_AD_TABLE', 'KNICKGASM_DB.MAPLEMONK.US_GADS_AD_GROUP_AD_REPORT'), schema: 'MAPLEMONK',
      fresh_to: '2026-07-25', partial_day: true,
      purpose: 'Same US Google account at ad level, with ad strength, approval status, headlines and creative assets. Use it for creative diagnosis; use the consolidated feed for spend reporting (it also covers Shopping and PMax rows the ad-group-ad report does not).',
      used_for: 'US Google creative and ad-strength diagnosis',
      kpi: 'roas', attribution: 'google_conversions',
      verified: { rows: 25416, first_day: '2023-03-19', last_day: '2026-07-25', campaigns: 79, spend: 165033.03,
        note: 'Customer 9797311905 reports under four historic descriptive names (KNICKGASM, KNICKGASM - US, KNICKGASM - USA - New, KNICKGASM (US) - New); these figures span all four. The current name alone is 51 campaigns / $142,876.86.' },
      cols: { date: q('segments.date'), spend: micros('metrics.cost_micros'), impressions: q('metrics.impressions'),
        clicks: q('metrics.clicks'), link_clicks: q('metrics.clicks'), campaign: q('campaign.name'),
        adset: q('ad_group.name'), ad: q('ad_group.name'), ad_id: q('ad_group_ad.ad.id'),
        account: q('customer.descriptive_name'), account_id: q('customer.id'),
        objective: q('campaign.status'), conversions: q('metrics.conversions'), revenue: q('metrics.conversions_value') } },
    { id: 'google_amazon', platform: 'google', region: 'US', status: 'live',
      label: 'Raghuvansh (Amazon marketplace, Ampd)', account_id: '3036820580',
      table: tableRef('SF_GOOGLE_AMZ_TABLE', 'KNICKGASM_DB.MAPLEMONK.US_AMZ_GADS_AD_GROUP_AD_REPORT'), schema: 'MAPLEMONK',
      fresh_to: '2026-07-25', partial_day: true,
      purpose: 'Google Ads bought through Ampd to drive traffic to KNICKGASM ASINs on amazon.com and amazon.ca. One campaign per ASIN — Crimson, Amla, Moringa, Curcumin, Dandelion Root, Pastel and so on.',
      used_for: 'Amazon marketplace demand capture',
      kpi: 'traffic', attribution: 'marketplace',
      attribution_note: 'Records zero Google conversions because checkout happens inside Amazon; sales appear in Amazon Seller Central, not here. Judge on CTR and CPC.',
      verified: { rows: 5417, first_day: '2024-05-11', last_day: '2026-07-25', campaigns: 64, spend: 66839.97 },
      cols: { date: q('segments.date'), spend: micros('metrics.cost_micros'), impressions: q('metrics.impressions'),
        clicks: q('metrics.clicks'), link_clicks: q('metrics.clicks'), campaign: q('campaign.name'),
        adset: q('ad_group.name'), ad: q('ad_group.name'), ad_id: q('ad_group_ad.ad.id'),
        account: q('customer.descriptive_name'), account_id: q('customer.id'),
        objective: q('campaign.status'), conversions: q('metrics.conversions'), revenue: q('metrics.conversions_value') } },
    { id: 'google_us_retired', platform: 'google', region: 'US', status: 'archive',
      label: 'KNICKGASM - USA - Old (retired Google customer)', account_id: '2769294429',
      table: tableRef('SF_GOOGLE_RETIRED_TABLE', 'KNICKGASM_DB.MAPLEMONK.GOOGLE_ADS_US_AD_GROUP_AD_REPORT'), schema: 'MAPLEMONK',
      fresh_to: '2023-11-24', partial_day: false,
      purpose: 'The retired US Google customer 2769294429, migrated to 9797311905 in 2023. This is the table that made US Google look dead: it is still refreshed by the pipeline but has held no new rows since 2023-11-24.',
      used_for: 'Pre-migration Google history (2018-2023)',
      kpi: 'roas', attribution: 'google_conversions',
      stale_note: 'Ends 2023-11-24 by design — the account was closed, not the feed. Point current US Google reporting at US_GOOGLE_ADS_CONSOLIDATED.',
      verified: { rows: 91135, first_day: '2018-12-19', last_day: '2023-11-24', campaigns: 294, spend: 514353.99 },
      cols: { date: q('segments.date'), spend: micros('metrics.cost_micros'), impressions: q('metrics.impressions'),
        clicks: q('metrics.clicks'), link_clicks: q('metrics.clicks'), campaign: q('campaign.name'),
        adset: q('ad_group.name'), ad: q('ad_group.name'), ad_id: q('ad_group_ad.ad.id'),
        account: q('customer.descriptive_name'), account_id: q('customer.id'),
        objective: q('campaign.status'), conversions: q('metrics.conversions'), revenue: q('metrics.conversions_value') } },
    { id: 'google_uk', platform: 'google', region: 'UK', status: 'live',
      label: 'KNICKGASM UK (Google Ads)', account_id: '3861674115',
      table: tableRef('SF_GOOGLE_UK_TABLE', 'KNICKGASM_DB.MAPLEMONK.GOOGLE_ADS_UK_AD_GROUP_AD_REPORT'), schema: 'MAPLEMONK',
      fresh_to: '2026-07-25', partial_day: true,
      purpose: 'UK Google Ads, a tight 5-campaign account spending GBP 51,968.24 since September 2025.',
      used_for: 'UK search and Shopping demand capture',
      kpi: 'roas', attribution: 'google_conversions', currency: 'GBP',
      verified: { rows: 1352, first_day: '2025-09-17', last_day: '2026-07-25', campaigns: 5, spend: 51968.24 },
      cols: { date: q('segments.date'), spend: micros('metrics.cost_micros'), impressions: q('metrics.impressions'),
        clicks: q('metrics.clicks'), link_clicks: q('metrics.clicks'), campaign: q('campaign.name'),
        adset: q('ad_group.name'), ad: q('ad_group.name'), ad_id: q('ad_group_ad.ad.id'),
        account: q('customer.descriptive_name'), account_id: q('customer.id'),
        objective: q('campaign.status'), conversions: q('metrics.conversions'), revenue: q('metrics.conversions_value') } },
    { id: 'google_in', platform: 'google', region: 'IN', status: 'live',
      label: 'KNICKGASM - India (Google Ads)', account_id: '7719984554',
      table: tableRef('SF_GOOGLE_IN_TABLE', 'KNICKGASM_DB.MAPLEMONK.GADS_IN_AD_GROUP_AD_REPORT'), schema: 'MAPLEMONK',
      fresh_to: '2026-07-25', partial_day: true,
      purpose: 'India Google Ads, the longest-running account in the warehouse (from 2019-08-03) and the largest by spend at INR 11.72M across 260 campaigns. Reports in INR.',
      used_for: 'India search, Shopping and PMax demand capture',
      kpi: 'roas', attribution: 'google_conversions', currency: 'INR',
      verified: { rows: 204660, first_day: '2019-08-03', last_day: '2026-07-25', campaigns: 260, spend: 11715204.83 },
      cols: { date: q('segments.date'), spend: micros('metrics.cost_micros'), impressions: q('metrics.impressions'),
        clicks: q('metrics.clicks'), link_clicks: q('metrics.clicks'), campaign: q('campaign.name'),
        adset: q('ad_group.name'), ad: q('ad_group.name'), ad_id: q('ad_group_ad.ad.id'),
        account: q('customer.descriptive_name'), account_id: q('customer.id'),
        objective: q('campaign.status'), conversions: q('metrics.conversions'), revenue: q('metrics.conversions_value') } },
    // ------------------------------------------- Retail media (MAPLEMONK1)
    // MAPLEMONK1 is NOT just breakdown tables for the DTC account. It carries the
    // whole retail-partner stack — Target's own Roundel ad platform, Target
    // sell-through, Ibotta, Target Aisle, Walmart and the Amazon Ads console —
    // which is where the retail programme is actually measured. Missing this is
    // what made the Target/Costco Meta account look unmeasurable: its shoppers
    // buy in Target, and Target reports that back here, not to the Meta pixel.
    { id: 'target_roundel', platform: 'target_roundel', region: 'US', status: 'live',
      label: 'KNICKGASM Global Inc. - RMS (Target Roundel)', account_id: 'RMS',
      table: tableRef('SF_TARGET_ADS_TABLE', 'KNICKGASM_DB.MAPLEMONK1.TARGET_ADS_DAY_TARGET_ADS_REPORT'), schema: 'MAPLEMONK1',
      fresh_to: '2026-07-22', partial_day: false,
      purpose: 'Target Roundel Media Studio — retail media bought inside Target, on Target search and Target-owned placements. Unlike the Meta retail account this one DOES report attributed sales and units, because Target matches the ad to the basket, so it is the one Target channel with a real ROAS.',
      used_for: 'Paid placement inside Target search and Target.com',
      kpi: 'roas', attribution: 'target_attributed_sales',
      attribution_note: 'ROAS here is Target-attributed sales over actualized vendor spend, matched by Target, not pixel-based. It is comparable across Roundel campaigns but not directly against Meta pixel ROAS.',
      verified: { rows: 804, first_day: '2026-05-04', last_day: '2026-07-22', campaigns: 10, spend: 40314.74,
        attributed_sales: 23264.68, roas: 0.58,
        note: 'Blended Roundel ROAS is 0.58. The spread is wide: "Coffee - Ingredients" returns 1.95 on $2,327.44 at a 3.94% CTR, while the three Manual powder lines (Airbrush_Powder_M1, Curry_Powder_M1, Moringa_Powder_M1) burn $15,636.48 combined at 0.09 to 0.42.' },
      cols: { date: dmy('Event Date'), spend: cash('Actualized Vendor Spend'), impressions: qty('IMPRESSIONS'),
        clicks: qty('CLICKS'), link_clicks: qty('CLICKS'), campaign: q('Campaign Name'), adset: q('Media Name'),
        ad: q('Media Name'), ad_id: q('Campaign Name'), account: q('Account Name'), account_id: lit('RMS'),
        objective: q('Media Name'), conversions: qty('Attributed Total Units'), revenue: cash('Attributed Total Sales') } },
    { id: 'target_roundel_kw', platform: 'target_roundel', region: 'US', status: 'live',
      label: 'Target Roundel — keyword level', account_id: 'RMS',
      table: tableRef('SF_TARGET_KW_TABLE', 'KNICKGASM_DB.MAPLEMONK1.TARGET_ADS_KEYWORD_TARGET_ADS_REPORT'), schema: 'MAPLEMONK1',
      fresh_to: '2026-07-22', partial_day: false,
      purpose: 'The same Roundel spend broken out by keyword (98,647 rows). Use it to find which Target search terms carry the winning campaigns and which are draining the manual powder lines.',
      used_for: 'Target search-term diagnosis',
      kpi: 'roas', attribution: 'target_attributed_sales',
      verified: { rows: 98647, last_day: '2026-07-22' },
      cols: { date: dmy('Event Date'), spend: cash('Actualized Vendor Spend'), impressions: qty('IMPRESSIONS'),
        clicks: qty('CLICKS'), link_clicks: qty('CLICKS'), campaign: q('Campaign Name'), adset: q('KEYWORD'),
        ad: q('KEYWORD'), ad_id: q('KEYWORD'), account: q('Account Name'), account_id: lit('RMS'),
        objective: q('Media Name'), conversions: qty('Attributed Total Units'), revenue: cash('Attributed Total Sales') } },
    // ------------------------------------------------------------------ TikTok
    { id: 'tiktok_us', platform: 'tiktok', region: 'US', status: 'paused',
      label: 'KNICKGASM USA (TikTok Ads)', account_id: '7393105007056388112',
      table: tableRef('SF_TIKTOK_AD_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_AD_REPORT_DAILY'), schema: 'DATON.RAW',
      fresh_to: '2026-07-14', partial_day: false,
      purpose: 'US TikTok Ads, 25 campaigns and $68,178.71 since April 2025, run as link-click traffic buys.',
      used_for: 'US TikTok traffic',
      kpi: 'traffic', attribution: 'tiktok_pixel',
      stale_note: 'Last spend 2026-07-14 — the account is paused, not disconnected. The campaign-level report (TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY) carries empty rows through 2026-07-23.',
      verified: { rows: 13838, first_day: '2025-04-01', last_day: '2026-07-14', campaigns: 25, spend: 68178.71 },
      cols: { date: q('STAT_TIME_DAY'), spend: q('SPEND'), impressions: q('IMPRESSIONS'), clicks: q('CLICKS'),
        link_clicks: q('CLICKS'), campaign: q('CAMPAIGN_NAME'), adset: q('ADGROUP_NAME'),
        ad: q('AD_NAME'), ad_id: q('AD_ID'), account: q('ACCOUNTNAME'), account_id: q('ACCOUNTID'),
        objective: nul } },
  ];
}

/** Accounts that should drive current reporting for a region (default US). */
function liveAccounts(region) {
  const r = String(region || 'US').toUpperCase();
  return adAccounts().filter((a) => a.status === 'live' && (r === 'ALL' || a.region === r));
}

function pickSources(accounts, dflt) {
  const all = adAccounts();
  if (!accounts || accounts === 'all') return dflt || all.filter((a) => a.status === 'live' && a.region === 'US');
  if (accounts === 'every') return all;
  const want = String(accounts).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const chosen = all.filter((s) => want.includes(s.id) || want.includes(s.account_id)
    || want.includes(s.platform) || want.includes(String(s.region).toLowerCase())
    || want.some((w) => s.label.toLowerCase().includes(w)));
  return chosen.length ? chosen : (dflt || all.filter((a) => a.status === 'live' && a.region === 'US'));
}

/** Everything a UI needs to describe an account without querying it. */
function describeAccount(s) {
  return { id: s.id, label: s.label, platform: s.platform, region: s.region, status: s.status,
    account_id: s.account_id, table: s.table, schema: s.schema, fresh_to: s.fresh_to,
    partial_day: !!s.partial_day, purpose: s.purpose, used_for: s.used_for, kpi: s.kpi,
    attribution: s.attribution, attribution_note: s.attribution_note || null,
    currency: s.currency || 'USD', stale_note: s.stale_note || null, verified: s.verified || null };
}

function srcWhere(s, since, until) {
  const parts = [];
  if (since && until) parts.push(`${s.cols.date.sql} between '${since}' and '${until}'`);
  if (s.filter) parts.push(s.filter);
  return parts.length ? ` where ${parts.join(' and ')}` : '';
}

// One SELECT per source, normalized to identical output columns, UNION ALL-ed so
// every account appears in one result set regardless of its pipeline's naming.
// Every column is cast explicitly: the same logical field is NUMBER in Maplemonk,
// TEXT in DC_RAW and TEXT-holding-a-decimal in Daton, and an uncast UNION ALL
// across those fails outright. Sources without a revenue/conversions column emit
// null rather than 0 so the UI can tell "not tracked here" from "tracked, zero".
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
 * Live catalogue: every account in the registry, what it is for, and how fresh
 * the warehouse actually is for it. `registry` is returned even when Snowflake is
 * unreachable so the dashboard can always describe the studio.
 */
async function accounts({ since = '2025-01-01', until, accounts: acct = 'every' } = {}) {
  const to = until || new Date().toISOString().slice(0, 10);
  const srcs = pickSources(acct, adAccounts());
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
  return { ok: true, connected: true, source: 'snowflake', since, until: to,
    registry,
    rows: registry.map((d) => {
      const x = byId[d.id] || {};
      const spend = Number(x.spend) || 0;
      const revenue = x.revenue == null ? null : Number(x.revenue);
      return Object.assign({}, d, {
        account: x.account_name || d.label,
        ads: Number(x.ads) || 0, campaigns: Number(x.campaigns) || 0,
        first_day: x.first_day ? String(x.first_day).slice(0, 10) : null,
        last_day: x.last_day ? String(x.last_day).slice(0, 10) : null,
        spend, impressions: Number(x.impressions) || 0, link_clicks: Number(x.link_clicks) || 0,
        conversions: x.conversions == null ? null : Number(x.conversions),
        revenue, roas: (revenue != null && spend > 0) ? Number((revenue / spend).toFixed(2)) : null,
        in_window: !!byId[d.id],
      });
    }),
    note: 'Every KNICKGASM ad account held in the warehouse. Accounts differ in what they can be judged on: roas where a pixel or Google conversion is tracked, traffic (CTR/CPC/CPM) where checkout happens on a third-party site such as target.com, Instacart or amazon.com.' };
}

/** Per-day series across one or more accounts (defaults to the live US set). */
async function multiDaily({ since, until, accounts: acct, by = 'day' } = {}) {
  const to = until || new Date().toISOString().slice(0, 10);
  const from = since || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const srcs = pickSources(acct);
  const group = by === 'account' ? 'source_id, platform, account_name' : 'day, source_id, platform, account_name';
  const sql = `with u as (\n  ${unionSelect(srcs, { since: from, until: to })}\n)
select ${group}, count(distinct ad_id) as ads_live, count(distinct campaign_name) as campaigns,
       round(sum(spend),2) as spend, sum(impressions) as impressions, sum(clicks) as clicks,
       sum(link_clicks) as link_clicks, round(sum(conversions),1) as conversions, round(sum(revenue),2) as revenue
  from u group by ${group} order by ${by === 'account' ? 'spend desc nulls last' : 'day'}`;
  if (!isConfigured()) return notConnected(sql, { since: from, until: to, accounts: srcs.map(describeAccount) });
  const r = await runStatement(sql);
  return { ok: true, connected: true, source: 'snowflake', since: from, until: to,
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
 * Per-campaign performance for one account, scored on the KPI that account can
 * actually be judged on. Meta sources pick purchases and revenue up from their
 * sibling _ACTIONS / _ACTION_VALUES tables; Google sources read their own
 * conversion columns; traffic-only accounts return null revenue rather than 0.
 */
function campaignSql(s, since, until, level) {
  const c = s.cols;
  const dim = level === 'ad' ? c.ad.sql : (level === 'adset' ? c.adset.sql : c.campaign.sql);
  // Daton stores TikTok metrics as TEXT holding a decimal, so cast every numeric.
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
  return { ok: true, connected: true, source: 'snowflake', since: from, until: to, level: lv,
    account: describeAccount(s), kpi: s.kpi, rows };
}

/**
 * Retail funnel — the view that makes the Target programme measurable at all.
 *
 * The Meta retail account (804570870670763) records ZERO purchases because its
 * shoppers check out inside Target, not on knickgasm.com. Judged on its own it
 * looks like pure cost. The measurement lives one schema over: MAPLEMONK1 carries
 * Target's own Roundel ad platform (which DOES report attributed sales, matched by
 * Target to the basket) and TARGET_SALES_TARGET_SALES, the actual store-level
 * sell-through. Joining spend from MAPLEMONK to outcomes in MAPLEMONK1 is the only
 * way to answer "is retail working", which is why both schemas are required.
 *
 * Returns three tiers, each labelled with what it can and cannot claim:
 *   spend      — Meta retail (demand generation, unattributable) + Roundel (attributed)
 *   attributed — Roundel attributed sales and units, Target-matched
 *   actual     — Target sell-through: dollars and units rung up in Target stores
 * The ratio of sell-through to total retail spend is reported as a BLENDED figure,
 * never as a causal ROAS: nothing in the warehouse attributes a Target basket to a
 * Meta impression, and pretending otherwise would be fabrication.
 */
const RETAIL_TABLES = () => ({
  meta: tableRef('SF_META_RETAIL_TABLE', 'KNICKGASM_DB.MAPLEMONK.USA_TEA_ADS_ADS_INSIGHTS'),
  roundel: tableRef('SF_TARGET_ADS_TABLE', 'KNICKGASM_DB.MAPLEMONK1.TARGET_ADS_DAY_TARGET_ADS_REPORT'),
  sales: tableRef('SF_TARGET_SALES_TABLE', 'KNICKGASM_DB.MAPLEMONK1.TARGET_SALES_TARGET_SALES'),
  ibotta: tableRef('SF_TARGET_IBOTTA_TABLE', 'KNICKGASM_DB.MAPLEMONK1.TARGET_IBOTTA_REPORT_TARGET_IBOTTA_REPORT'),
  aisle: tableRef('SF_TARGET_AISLE_TABLE', 'KNICKGASM_DB.MAPLEMONK1.TARGET_AISLE_TARGET_AISLE_REPORT'),
});
async function retailFunnel({ since, until, by = 'month' } = {}) {
  const to = until || new Date().toISOString().slice(0, 10);
  const from = since || '2026-05-01';
  const t = RETAIL_TABLES();
  const grain = by === 'day' ? 'd' : "date_trunc('month', d)";
  const cash = (n) => `try_to_double(replace(replace(${quoteIdent(n)},'$',''),',',''))`;
  const qty = (n) => `try_to_double(replace(${quoteIdent(n)},',',''))`;
  // Same two-shape date problem as the registry's dmy(): split on the space so
  // rows carrying a time component are not silently dropped.
  const day = (n) => `try_to_date(split_part(${quoteIdent(n)},' ',1),'DD-MM-YYYY')`;
  const sql = `with meta as (
  select DATE_START::date as d, SPEND::float as spend, IMPRESSIONS::float as impressions,
         INLINE_LINK_CLICKS::float as clicks
    from ${t.meta} where DATE_START between '${from}' and '${to}'
), roundel as (
  select ${day('Event Date')} as d,
         ${cash('Actualized Vendor Spend')} as spend, ${qty('IMPRESSIONS')} as impressions,
         ${qty('CLICKS')} as clicks, ${cash('Attributed Total Sales')} as attr_sales,
         ${qty('Attributed Total Units')} as attr_units
    from ${t.roundel}
   where ${day('Event Date')} between '${from}' and '${to}'
), sales as (
  select ${day('DATE')} as d,
         ${cash('SALES $')} as sell_through, ${qty('SALES U')} as units,
         ${quoteIdent('LOCATION ID')} as store
    from ${t.sales}
   where ${day('DATE')} between '${from}' and '${to}'
), g as (
  select ${grain} as period, sum(spend) as meta_spend, sum(impressions) as meta_impressions,
         sum(clicks) as meta_clicks, 0 as roundel_spend, 0 as roundel_attr_sales, 0 as roundel_attr_units,
         0 as sell_through, 0 as units_sold, null as store
    from meta group by 1
  union all
  select ${grain}, 0, 0, 0, sum(spend), sum(attr_sales), sum(attr_units), 0, 0, null from roundel group by 1
  union all
  select ${grain}, 0, 0, 0, 0, 0, 0, sum(sell_through), sum(units), count(distinct store) from sales group by 1
)
select period, round(sum(meta_spend),2) as meta_spend, sum(meta_impressions)::int as meta_impressions,
       sum(meta_clicks)::int as meta_clicks, round(sum(roundel_spend),2) as roundel_spend,
       round(sum(roundel_attr_sales),2) as roundel_attr_sales, sum(roundel_attr_units)::int as roundel_attr_units,
       round(sum(sell_through),2) as target_sell_through, sum(units_sold)::int as target_units,
       max(store) as target_stores
  from g group by period order by period`;
  if (!isConfigured()) {
    return notConnected(sql, { since: from, until: to, by,
      tables: t,
      note: 'Retail measurement spans BOTH schemas: spend in MAPLEMONK, outcomes in MAPLEMONK1.' });
  }
  const r = await runStatement(sql);
  const rows = (r.rows || []).map((x) => {
    const meta_spend = Number(x.meta_spend) || 0;
    const roundel_spend = Number(x.roundel_spend) || 0;
    const total_spend = Number((meta_spend + roundel_spend).toFixed(2));
    const attr = Number(x.roundel_attr_sales) || 0;
    const sell = Number(x.target_sell_through) || 0;
    return { period: String(x.period || '').slice(0, 10),
      meta_spend, meta_impressions: Number(x.meta_impressions) || 0, meta_clicks: Number(x.meta_clicks) || 0,
      roundel_spend, roundel_attr_sales: attr, roundel_attr_units: Number(x.roundel_attr_units) || 0,
      roundel_roas: roundel_spend > 0 ? Number((attr / roundel_spend).toFixed(2)) : null,
      target_sell_through: sell, target_units: Number(x.target_units) || 0,
      target_stores: Number(x.target_stores) || 0,
      total_retail_spend: total_spend,
      // Blended, NOT causal — see the note below.
      sell_through_per_dollar: total_spend > 0 ? Number((sell / total_spend).toFixed(2)) : null };
  });
  const tot = rows.reduce((a, x) => ({
    meta_spend: Number((a.meta_spend + x.meta_spend).toFixed(2)),
    roundel_spend: Number((a.roundel_spend + x.roundel_spend).toFixed(2)),
    roundel_attr_sales: Number((a.roundel_attr_sales + x.roundel_attr_sales).toFixed(2)),
    target_sell_through: Number((a.target_sell_through + x.target_sell_through).toFixed(2)),
    target_units: a.target_units + x.target_units,
  }), { meta_spend: 0, roundel_spend: 0, roundel_attr_sales: 0, target_sell_through: 0, target_units: 0 });
  const totalSpend = Number((tot.meta_spend + tot.roundel_spend).toFixed(2));
  return { ok: true, connected: true, source: 'snowflake', since: from, until: to, by, tables: t, rows,
    totals: Object.assign({}, tot, { total_retail_spend: totalSpend,
      roundel_roas: tot.roundel_spend > 0 ? Number((tot.roundel_attr_sales / tot.roundel_spend).toFixed(2)) : null,
      sell_through_per_dollar: totalSpend > 0 ? Number((tot.target_sell_through / totalSpend).toFixed(2)) : null }),
    tiers: {
      spend: 'Meta retail (demand generation, no attribution possible) + Target Roundel (attributed by Target).',
      attributed: 'Roundel attributed sales and units only. Target matches these to the basket; they are NOT pixel conversions and are not comparable with Meta pixel ROAS.',
      actual: 'Target sell-through: dollars and units actually rung up across Target stores, from TARGET_SALES_TARGET_SALES.',
    },
    caveat: 'sell_through_per_dollar is a BLENDED ratio of Target sell-through to total retail ad spend. It is not a causal ROAS: nothing in the warehouse attributes a Target basket to a Meta impression, and sell-through includes baseline demand that would have happened without any advertising.' };
}

function primaryTable(platform, level) {
  const s = sources();
  if (platform === 'meta') return s.meta.ads;
  if (platform === 'google') return s.google.ads;
  if (platform === 'tiktok') return s.tiktok[String(level || 'campaign').toLowerCase()] || s.tiktok.campaign;
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
// Verified against the live warehouse 2026-07-25/26 — the three platforms do
// NOT share column naming, which is why every query resolves its columns from
// INFORMATION_SCHEMA instead of assuming one convention:
//   Meta   META_USA_ADS_INSIGHTS            date_start / account_name / spend
//   TikTok TIKTOK_ADS_USA_*_REPORT_DAILY    stat_time_day / accountname / spend
//   Google GOOGLE_ADS_US_AD_GROUP_AD_REPORT "segments.date" / "customer.descriptive_name" / "metrics.cost_micros"
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
  if (!t) return { ok: false, error: `Unknown platform '${platform}'.` };
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

// Recent rows (all available metrics) for a platform, optionally scoped to an
// account (target|costco) and date range. "SELECT *" so every metric the table
// carries is returned — nothing is dropped or invented.
async function metrics({ platform = 'meta', account, since, until, level, limit = 500 } = {}) {
  const t = primaryTable(platform, level);
  if (!t) return { ok: false, error: `Unknown platform '${platform}'.` };
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
  if (!t) return { ok: false, error: `Unknown platform '${platform}'.` };
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
  return {
    ok: true, configured: isConfigured(), source: 'snowflake',
    platforms: PLATFORMS, accounts: ACCOUNTS, budgets: budgets(),
    tables: sources(),
    live_connectors_disabled: !liveConnectorsEnabled(),
    note: isConfigured()
      ? 'Snowflake connected — live ad data from the configured tables (read-only).'
      : (!liveConnectorsEnabled()
        ? 'Live connectors are disabled (LIVE_CONNECTORS is off) — running on cached/snapshot ad data. No connection to Snowflake is made. Set LIVE_CONNECTORS=on plus SNOWFLAKE_* env vars to pull live data. No figures are fabricated.'
        : 'Snowflake not configured. Set SNOWFLAKE_* env vars to pull live ad data; every op returns the exact read-only SQL it will run until then. No figures are fabricated.'),
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
      hint: `Set ${missing.join(', ')} in Vercel (a read-only PAT for SNOWFLAKE_PAT). The account is the org-account identifier, e.g. UXDEIHW-MO06981.` };
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
        : 'Configured but the request failed. Verify SNOWFLAKE_ACCOUNT (org-account id, e.g. UXDEIHW-MO06981), SNOWFLAKE_WAREHOUSE and network access.' };
  }
}

module.exports = {
  status, ping, describe, metrics, cohort, budgets, runStatement,
  isConfigured, PLATFORMS, ACCOUNTS, DIMENSION_CANDIDATES, sources,
  adAccounts, liveAccounts, describeAccount, accounts, multiDaily, campaigns,
  pickSources, unionSelect, retailFunnel,
};
