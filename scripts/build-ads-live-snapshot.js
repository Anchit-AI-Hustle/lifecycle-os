#!/usr/bin/env node
'use strict';

/**
 * scripts/build-ads-live-snapshot.js
 *
 * Builds data/ads/ads-live-snapshot.json from the committed warehouse extract in
 * data/ads/warehouse-extract-2026-07-26.txt.
 *
 * Why a snapshot at all: the Ad Campaigns Master Dashboard reads live figures
 * from /api/brain?action=ads-live, which needs either META_ACCESS_TOKEN or the
 * SNOWFLAKE_* vars. Neither is set on the deployment yet, so the page falls back
 * to this snapshot and labels it as a snapshot. It must therefore be REAL data,
 * and it must cover BOTH live US Meta accounts — an earlier build carried only
 * the DTC account and asserted the Target/Costco account was absent from the
 * warehouse, which was wrong (it is in MAPLEMONK.USA_TEA_ADS_ADS_INSIGHTS under
 * a name that does not match META_USA%).
 *
 * The extract is checked in verbatim rather than re-queried at build time so the
 * build is reproducible without warehouse credentials and every figure here is
 * traceable to a specific read. Regenerate the extract with the queries recorded
 * in its header when you want a fresher snapshot.
 *
 *   node scripts/build-ads-live-snapshot.js        (npm run build:ads-snapshot)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXTRACT = path.join(ROOT, 'data', 'ads', 'warehouse-extract-2026-07-26.txt');
const OUT = path.join(ROOT, 'data', 'ads', 'ads-live-snapshot.json');
const REGISTRY_OUT = path.join(ROOT, 'data', 'ads', 'ad-accounts.json');
const CAPTURED_AT = '2026-07-26';

// The two live US Meta accounts, mirroring adAccounts() in
// api/_shared/ads-snowflake-core.js. `kpi` is what each can honestly be judged
// on: the retail account has no KNICKGASM pixel because checkout happens on
// target.com / Instacart / in store, so ROAS is not computable there and the
// dashboard must not present its zero purchases as failure.
const ACCOUNTS = {
  D: {
    key: 'dtc', id: '1303870183798748', name: 'Knickgasm India USA New EST Main Account',
    table: 'KNICKGASM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS',
    used_for: 'US direct-to-consumer storefront (knickgasm.com)',
    purpose: 'The revenue account: the coffee-ART and airbrush design collections at scale, plus the evergreen custom-sneaker sets and the low-ticket accessories lane (rope laces, lace tags, care kits), all landing on own site with the Meta pixel firing.',
    kpi: 'roas', attribution: 'meta_pixel',
    rows_total: 129741, campaigns_total: 106, data_fresh_to: '2026-07-25',
  },
  R: {
    key: 'retail', id: '804570870670763', name: 'KNICKGASM USA - Retail Ad Account',
    table: 'KNICKGASM_DB.MAPLEMONK.USA_TEA_ADS_ADS_INSIGHTS',
    used_for: 'Retail sell-through at Target and Costco (third-party checkout)',
    purpose: 'Drives shoppers to Target stores and target.com, and to Costco via Instacart: Page Deck sales sets, scored UGC video sets, influencer link-click sets, Costco Bay Area reach buys, Target giveaways.',
    kpi: 'traffic', attribution: 'none',
    attribution_note: 'Zero purchases by construction — checkout happens on target.com, Instacart or in store, so no KNICKGASM pixel fires. Judge on CTR, CPC, CPM and reach, never ROAS.',
    rows_total: 6556, campaigns_total: 26, data_fresh_to: '2026-07-25',
  },
};

function r2(n) { return Math.round(n * 100) / 100; }
function r3(n) { return Math.round(n * 1000) / 1000; }

function parseExtract(text) {
  const daily = [];
  const campaigns = [];
  const retail = [];
  let section = null;
  text.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    if (line === '[DAILY]' || line === '[CAMPAIGNS]' || line === '[RETAIL_FUNNEL]') { section = line; return; }
    if (section === '[RETAIL_FUNNEL]') {
      const [period, ms, rs, ras, st, units, stores] = line.split(/\s+/);
      const meta_spend = +ms, roundel_spend = +rs, total = r2(meta_spend + roundel_spend);
      retail.push({ period, meta_spend, roundel_spend, total_retail_spend: total,
        roundel_attr_sales: +ras,
        roundel_roas: roundel_spend > 0 ? r2(+ras / roundel_spend) : null,
        target_sell_through: +st, target_units: +units, target_stores: +stores,
        sell_through_per_dollar: total > 0 ? r2(+st / total) : null });
      return;
    }
    if (section === '[DAILY]') {
      const [date, acct, ads, camps, spend, impressions, clicks, link_clicks] = line.split(/\s+/);
      daily.push({ date, account: ACCOUNTS[acct].key, ads_live: +ads, campaigns: +camps,
        spend: +spend, impressions: +impressions, clicks: +clicks, link_clicks: +link_clicks });
    } else if (section === '[CAMPAIGNS]') {
      const p = line.split('~');
      const a = ACCOUNTS[p[0]];
      const spend = +p[6], impressions = +p[7], clicks = +p[8], link_clicks = +p[9];
      const purchases = +p[10], revenue = +p[11];
      const tracked = a.kpi === 'roas';
      campaigns.push({
        campaign: p[1], account: a.key, account_name: a.name, objective: p[2], ads: +p[3],
        first_day: p[4], last_day: p[5], spend, impressions, clicks, link_clicks,
        ctr: impressions ? r2(100 * link_clicks / impressions) : null,
        cpc: link_clicks ? r3(spend / link_clicks) : null,
        cpm: impressions ? r2(1000 * spend / impressions) : null,
        // Only reported where the account can actually attribute a sale.
        purchases: tracked ? purchases : null,
        revenue: tracked ? revenue : null,
        roas: (tracked && spend > 0) ? r2(revenue / spend) : null,
        cpa: (tracked && purchases > 0) ? r2(spend / purchases) : null,
        kpi: a.kpi,
      });
    }
  });
  return { daily, campaigns, retail };
}

function rollup(rows, keys) {
  const out = {};
  rows.forEach((r) => {
    const k = keys.map((x) => r[x]).join('|');
    const t = out[k] || (out[k] = { spend: 0, impressions: 0, clicks: 0, link_clicks: 0, ads_live: 0, campaigns: 0 });
    t.spend = r2(t.spend + r.spend); t.impressions += r.impressions;
    t.clicks += r.clicks; t.link_clicks += r.link_clicks;
    t.ads_live = Math.max(t.ads_live, r.ads_live || 0);
    t.campaigns = Math.max(t.campaigns, r.campaigns || 0);
  });
  return out;
}

function build() {
  const { daily, campaigns, retail } = parseExtract(fs.readFileSync(EXTRACT, 'utf8'));
  const dates = [...new Set(daily.map((d) => d.date))].sort();
  const since = dates[0];
  const until = dates[dates.length - 1];

  // Per-day, both accounts blended (what the charts plot) plus the split, so a
  // reader can always see which account moved a day.
  const byDay = {};
  daily.forEach((d) => {
    const t = byDay[d.date] || (byDay[d.date] = { date: d.date, ads_live: 0, campaigns: 0, spend: 0, impressions: 0, clicks: 0, link_clicks: 0, accounts: {} });
    t.ads_live += d.ads_live; t.campaigns += d.campaigns; t.spend = r2(t.spend + d.spend);
    t.impressions += d.impressions; t.clicks += d.clicks; t.link_clicks += d.link_clicks;
    t.accounts[d.account] = { ads_live: d.ads_live, campaigns: d.campaigns, spend: d.spend,
      impressions: d.impressions, clicks: d.clicks, link_clicks: d.link_clicks };
  });
  const dailyRows = dates.map((d) => byDay[d]);

  const perAccount = rollup(daily, ['account']);
  const accountRollup = Object.keys(ACCOUNTS).map((code) => {
    const a = ACCOUNTS[code];
    const t = perAccount[a.key] || { spend: 0, impressions: 0, clicks: 0, link_clicks: 0 };
    const camps = campaigns.filter((c) => c.account === a.key);
    const rev = a.kpi === 'roas' ? r2(camps.reduce((s, c) => s + (c.revenue || 0), 0)) : null;
    const pur = a.kpi === 'roas' ? camps.reduce((s, c) => s + (c.purchases || 0), 0) : null;
    const days = daily.filter((d) => d.account === a.key);
    return {
      key: a.key, account: a.name, account_id: a.id, table: a.table,
      used_for: a.used_for, purpose: a.purpose, kpi: a.kpi, attribution: a.attribution,
      attribution_note: a.attribution_note || null,
      rows_total: a.rows_total, campaigns_total: a.campaigns_total, data_fresh_to: a.data_fresh_to,
      window_first_day: days.length ? days[0].date : null,
      window_last_day: days.length ? days[days.length - 1].date : null,
      campaigns_in_window: camps.length,
      spend: t.spend, impressions: t.impressions, clicks: t.clicks, link_clicks: t.link_clicks,
      ctr: t.impressions ? r2(100 * t.link_clicks / t.impressions) : null,
      cpc: t.link_clicks ? r3(t.spend / t.link_clicks) : null,
      cpm: t.impressions ? r2(1000 * t.spend / t.impressions) : null,
      purchases: pur, revenue: rev,
      roas: (rev != null && t.spend > 0) ? r2(rev / t.spend) : null,
      cpa: (pur) ? r2(t.spend / pur) : null,
      realtime_ready: true,
    };
  }).sort((x, y) => y.spend - x.spend);

  const totals = dailyRows.reduce((s, d) => ({
    spend: r2(s.spend + d.spend), impressions: s.impressions + d.impressions,
    clicks: s.clicks + d.clicks, link_clicks: s.link_clicks + d.link_clicks,
  }), { spend: 0, impressions: 0, clicks: 0, link_clicks: 0 });

  const lastDay = dailyRows[dailyRows.length - 1];
  const snapshot = {
    id: 'ads-live-snapshot',
    captured_at: CAPTURED_AT,
    generated_by: 'scripts/build-ads-live-snapshot.js from data/ads/warehouse-extract-2026-07-26.txt',
    source: 'Snowflake KNICKGASM_DB.MAPLEMONK — META_USA_ADS_INSIGHTS (DTC) + USA_TEA_ADS_ADS_INSIGHTS (Target / Costco retail), read live via the Snowflake connector',
    accounts: accountRollup,
    window: { since, until, days: dates.length },
    totals: Object.assign({}, totals, {
      ctr: totals.impressions ? r2(100 * totals.link_clicks / totals.impressions) : null,
      cpc: totals.link_clicks ? r3(totals.spend / totals.link_clicks) : null,
      note: 'Both US Meta accounts blended. Revenue and ROAS are deliberately NOT blended: only the DTC account can attribute a sale, so a blended ROAS would be arithmetic on incomparable numbers.',
    }),
    daily: dailyRows,
    campaigns: campaigns.sort((a, b) => b.spend - a.spend),
    today: {
      date: lastDay.date,
      ads_live: lastDay.ads_live,
      campaigns_live: lastDay.campaigns,
      spend_so_far: lastDay.spend,
      impressions: lastDay.impressions,
      link_clicks: lastDay.link_clicks,
      by_account: lastDay.accounts,
      note: 'Partial day at capture time. The dashboard re-reads this live via /api/brain?action=ads-live&op=today; the figures here are the snapshot taken at capture.',
    },
    // Retail measurement, so the Accounts tab can answer "is Target working" even
    // with no warehouse credentials. The Meta retail account has no pixel; Target
    // reports the outcome instead (Roundel attributed sales + store sell-through).
    retail_funnel: {
      rows: retail,
      totals: (() => {
        const t = retail.reduce((a, x) => ({
          meta_spend: r2(a.meta_spend + x.meta_spend),
          roundel_spend: r2(a.roundel_spend + x.roundel_spend),
          roundel_attr_sales: r2(a.roundel_attr_sales + x.roundel_attr_sales),
          target_sell_through: r2(a.target_sell_through + x.target_sell_through),
          target_units: a.target_units + x.target_units,
        }), { meta_spend: 0, roundel_spend: 0, roundel_attr_sales: 0, target_sell_through: 0, target_units: 0 });
        const total = r2(t.meta_spend + t.roundel_spend);
        return Object.assign(t, { total_retail_spend: total,
          roundel_roas: t.roundel_spend > 0 ? r2(t.roundel_attr_sales / t.roundel_spend) : null,
          sell_through_per_dollar: total > 0 ? r2(t.target_sell_through / total) : null });
      })(),
      tables: {
        meta: 'KNICKGASM_DB.MAPLEMONK.USA_TEA_ADS_ADS_INSIGHTS',
        roundel: 'KNICKGASM_DB.MAPLEMONK1.TARGET_ADS_DAY_TARGET_ADS_REPORT',
        sales: 'KNICKGASM_DB.MAPLEMONK1.TARGET_SALES_TARGET_SALES',
      },
      caveat: 'sell_through_per_dollar is a BLENDED ratio of Target sell-through to total retail ad spend. It is not a causal ROAS: nothing in the warehouse attributes a Target basket to a Meta impression, and sell-through includes baseline demand that would have happened without any advertising.',
    },
    account_notes: [
      'Corrects an earlier snapshot which stated the Target/Costco account was NOT in the warehouse. It is: KNICKGASM_DB.MAPLEMONK.USA_TEA_ADS_ADS_INSIGHTS, 6,556 rows, fresh to 2026-07-25. It was missed because its table name does not match META_USA%.',
      'A second, older mirror of the same retail account exists at KNICKGASM_DB.DC_RAW.FB2_KNICKGASM_KNICKGASMUSATEA_US_FBADS_ADPERFORMANCE, but it ends 2026-05-31 and holds only 7 of the 26 campaigns. Do not report from it.',
      'Cross-checks to the KT Master Ad Tracking Sheet: May retail spend $3,608.06 and June $14,422.93 both match the workbook to the cent, and "Trendyfavefinds - Target Awareness" matches at $156.77.',
    ],
  };
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n');
  const rt = accountRollup.find((a) => a.key === 'retail');
  const dtc = accountRollup.find((a) => a.key === 'dtc');
  console.log(`ads-live-snapshot: ${dates.length} days, ${dailyRows.length} day rows, ${campaigns.length} campaigns`);
  console.log(`  dtc    $${dtc.spend.toLocaleString()} · ROAS ${dtc.roas} · ${dtc.campaigns_in_window} campaigns`);
  console.log(`  retail $${rt.spend.toLocaleString()} · CTR ${rt.ctr}% · CPC $${rt.cpc} · ${rt.campaigns_in_window} campaigns`);
  console.log(`  total  $${totals.spend.toLocaleString()} -> ${path.relative(ROOT, OUT)}`);
  console.log(`  retail funnel: ${retail.length} periods, Target sell-through $${retail.reduce((s, x) => s + x.target_sell_through, 0).toLocaleString()}`);
}

/**
 * The Accounts tab has to render the studio even with no serverless function and
 * no warehouse credentials (a static preview, or the current deployment). Rather
 * than duplicate the descriptions in the HTML, emit them from the ONE source of
 * truth — adAccounts() in api/_shared/ads-snowflake-core.js — so the page and the
 * API can never drift apart.
 */
function buildRegistry() {
  const core = require(path.join(ROOT, 'api', '_shared', 'ads-snowflake-core.js'));
  const rows = core.adAccounts().map(core.describeAccount);
  const byPlatform = {};
  rows.forEach((r) => { byPlatform[r.platform] = (byPlatform[r.platform] || 0) + 1; });
  fs.writeFileSync(REGISTRY_OUT, JSON.stringify({
    id: 'ad-accounts',
    captured_at: CAPTURED_AT,
    generated_by: 'scripts/build-ads-live-snapshot.js from adAccounts() in api/_shared/ads-snowflake-core.js',
    counts: {
      feeds: rows.length,
      distinct_accounts: new Set(rows.map((r) => r.platform + ':' + r.account_id)).size,
      live: rows.filter((r) => r.status === 'live').length,
      by_platform: byPlatform,
    },
    statuses: {
      live: 'Feed is current and should drive reporting.',
      paused: 'Feed is connected but the account has stopped spending.',
      superseded: 'A second mirror of an account that is better served by another feed. History only.',
      stale: 'Account wound down; the feed stops where the account stopped.',
      archive: 'Closed account kept as a historic benchmark.',
    },
    kpis: {
      roas: 'A pixel or Google conversion is tracked, so revenue, ROAS and CPA are real.',
      traffic: 'Checkout happens on a third-party site (target.com, Instacart, amazon.com) so no purchase is ever attributed here. Judge on CTR, CPC, CPM and reach — a zero ROAS is an attribution fact, not a result.',
    },
    accounts: rows,
  }, null, 2) + '\n');
  console.log(`ad-accounts: ${rows.length} feeds across ${new Set(rows.map((r) => r.platform + ':' + r.account_id)).size} accounts -> ${path.relative(ROOT, REGISTRY_OUT)}`);
}

build();
buildRegistry();
