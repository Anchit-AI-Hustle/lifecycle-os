'use strict';

/**
 * ad-rows-core.js — the ONE place a Meta / Google Ads / TikTok reporting payload
 * becomes a common row.
 *
 * The three platforms disagree about almost everything:
 *
 *   Google  reports cost in MICROS and wraps results in `searchStream` batches,
 *           each with its own `results` array.
 *   TikTok  nests under `data.list`, splits dimensions from metrics, and returns
 *           rates sometimes as a percentage and sometimes as a fraction
 *           depending on the metric and the API version.
 *   Meta    returns purchases as an array of {action_type, value} objects under
 *           several different action types at once.
 *
 * Without one mapper, every consumer that wants "spend and revenue per campaign"
 * has to know all of that, and they drift: one view normalises all three
 * correctly while another sums a Meta-shaped `spend` field across platforms and
 * silently reports Google spend a million times too high.
 *
 * THE COMMON ROW
 *   platform level entity entity_id campaign ad_group status
 *   account_id account_name
 *   spend impressions clicks ctr cpc cpm
 *   conversions conversion_rate cpa revenue roas reach frequency
 *
 * Rates are FRACTIONS (0.0321) on every platform, never percentages.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 */

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const text = (v) => String(v == null ? '' : v).trim();
const rate = (a, b) => (b ? a / b : 0);

/**
 * Meta reports purchases under several action types depending on how the pixel
 * and the conversions API are configured. Take the FIRST match, never the sum:
 * `purchase`, `omni_purchase` and `offsite_conversion.fb_pixel_purchase`
 * routinely all appear for the same order, so adding them triples the revenue.
 */
function actionValue(rows, names) {
  const keys = names.map((x) => x.toLowerCase());
  for (const x of Array.isArray(rows) ? rows : []) {
    const k = text(x.action_type || x.actionType).toLowerCase();
    if (keys.some((q) => k === q || k.includes(q))) return n(x.value);
  }
  return 0;
}
const PURCHASE = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'];

function metaRows(r) {
  return ((r && r.data) || []).map((x) => {
    const spend = n(x.spend), impressions = n(x.impressions), clicks = n(x.clicks);
    const conversions = actionValue(x.actions, PURCHASE);
    const revenue = actionValue(x.action_values, PURCHASE);
    const level = r.level || 'account';
    const entity = level === 'ad' ? x.ad_name || x.ad_id
      : level === 'adset' ? x.adset_name || x.adset_id
        : level === 'campaign' ? x.campaign_name || x.campaign_id
          : x.account_name || x.account_id;
    return {
      platform: 'Meta', level, entity: entity || '(unnamed)',
      entity_id: x.ad_id || x.adset_id || x.campaign_id || x.account_id || '',
      campaign: x.campaign_name || '', ad_group: x.adset_name || '', status: '',
      account_id: x.account_id || '', account_name: x.account_name || '',
      spend, impressions, clicks,
      // Meta reports ctr as a percentage; the common row is a fraction.
      ctr: x.ctr != null ? n(x.ctr) / 100 : rate(clicks, impressions),
      cpc: x.cpc != null ? n(x.cpc) : rate(spend, clicks),
      cpm: x.cpm != null ? n(x.cpm) : rate(spend * 1000, impressions),
      conversions, conversion_rate: rate(conversions, clicks), cpa: rate(spend, conversions),
      revenue,
      roas: Array.isArray(x.purchase_roas) && x.purchase_roas[0]
        ? n(x.purchase_roas[0].value) : rate(revenue, spend),
      reach: n(x.reach), frequency: n(x.frequency),
    };
  });
}

function googleRows(r) {
  // searchStream returns an ARRAY OF BATCHES, each with its own `results`.
  // Treating the response as a flat row list loses every batch after the first.
  const batches = Array.isArray(r && r.data) ? r.data : [];
  const rows = batches.flatMap((b) => (Array.isArray(b && b.results) ? b.results : []));
  return rows.map((x) => {
    const m = x.metrics || {};
    const spend = n(m.costMicros) / 1e6;          // Google reports cost in micros
    const impressions = n(m.impressions), clicks = n(m.clicks);
    const conversions = n(m.conversions || m.allConversions);
    const revenue = n(m.conversionsValue || m.allConversionsValue);
    const level = (r && r.level) || 'account';
    const entity = level === 'ad'
      ? x.adGroupAd && x.adGroupAd.ad && (x.adGroupAd.ad.name || x.adGroupAd.ad.id)
      : (level === 'adgroup' || level === 'adset') ? x.adGroup && (x.adGroup.name || x.adGroup.id)
        : level === 'campaign' ? x.campaign && (x.campaign.name || x.campaign.id)
          : x.customer && (x.customer.descriptiveName || x.customer.id);
    return {
      platform: 'Google', level, entity: entity || '(unnamed)',
      entity_id: String((x.adGroupAd && x.adGroupAd.ad && x.adGroupAd.ad.id)
        || (x.adGroup && x.adGroup.id) || (x.campaign && x.campaign.id)
        || (x.customer && x.customer.id) || ''),
      campaign: (x.campaign && x.campaign.name) || '',
      ad_group: (x.adGroup && x.adGroup.name) || '',
      status: (x.adGroupAd && x.adGroupAd.status) || (x.adGroup && x.adGroup.status)
        || (x.campaign && x.campaign.status) || '',
      account_id: String((x.customer && x.customer.id) || ''),
      account_name: (x.customer && x.customer.descriptiveName) || '',
      spend, impressions, clicks,
      ctr: m.ctr != null ? n(m.ctr) : rate(clicks, impressions),
      cpc: m.averageCpc != null ? n(m.averageCpc) / 1e6 : rate(spend, clicks),
      cpm: rate(spend * 1000, impressions),
      conversions, conversion_rate: rate(conversions, clicks), cpa: rate(spend, conversions),
      revenue, roas: rate(revenue, spend),
      // Google Ads does not return reach or frequency on these reports. A zero
      // here means "this platform did not report it", not "nobody was reached".
      reach: 0, frequency: 0,
    };
  });
}

function tiktokRows(r) {
  const root = (r && r.data) || {};
  const rows = Array.isArray(root.list) ? root.list : (Array.isArray(root) ? root : []);
  return rows.map((x) => {
    const d = x.dimensions || {};
    const m = x.metrics || x;
    const spend = n(m.spend), impressions = n(m.impressions), clicks = n(m.clicks);
    const conversions = n(m.complete_payment || m.real_time_conversion || m.conversion);
    const revenue = n(m.total_complete_payment_value || m.complete_payment_value);
    const level = (r && r.level) || 'account';
    const entity = d.ad_name || d.ad_id || d.adgroup_name || d.adgroup_id
      || d.campaign_name || d.campaign_id || d.advertiser_name || d.advertiser_id || '(unnamed)';
    // TikTok returns some rates as percentages and some as fractions depending
    // on the metric and the API version; anything above 1 is a percentage.
    const norm = (v) => (n(v) > 1 ? n(v) / 100 : n(v));
    return {
      platform: 'TikTok', level, entity,
      entity_id: String(d.ad_id || d.adgroup_id || d.campaign_id || d.advertiser_id || ''),
      campaign: d.campaign_name || '', ad_group: d.adgroup_name || '', status: d.status || '',
      account_id: String(d.advertiser_id || ''), account_name: d.advertiser_name || '',
      spend, impressions, clicks,
      ctr: m.ctr != null ? norm(m.ctr) : rate(clicks, impressions),
      cpc: m.cpc != null ? n(m.cpc) : rate(spend, clicks),
      cpm: m.cpm != null ? n(m.cpm) : rate(spend * 1000, impressions),
      conversions,
      conversion_rate: m.conversion_rate != null ? norm(m.conversion_rate) : rate(conversions, clicks),
      cpa: m.cost_per_conversion != null ? n(m.cost_per_conversion) : rate(spend, conversions),
      revenue, roas: rate(revenue, spend),
      reach: n(m.reach), frequency: n(m.frequency),
    };
  });
}

/** Normalise whichever platform this insights response came from. */
function rowsFor(result) {
  if (!result || !result.ok) return [];
  const p = String(result.platform || '').toLowerCase();
  if (p === 'meta' || p === 'facebook' || p === 'instagram') return metaRows(result);
  if (p === 'google' || p === 'google_ads' || p === 'googleads') return googleRows(result);
  if (p === 'tiktok') return tiktokRows(result);
  return [];
}

/**
 * Roll a set of common rows up.
 *
 * `revenue_trustworthy` is the load-bearing part. An ad account can report zero
 * purchases BY CONSTRUCTION rather than by failing: retail-media and marketplace
 * accounts send traffic to a checkout on someone else's property, where this
 * brand's pixel never fires, and awareness campaigns are not optimised to a
 * purchase at all. Averaging those rows into a single ROAS drags it toward zero
 * and makes healthy spend look unprofitable.
 *
 * So ROAS, CPA and conversion rate are returned as NULL, never 0, when the rows
 * carry no conversions. A zero would be read as "sold nothing"; a null says "not
 * measurable from these rows", which is the truth, and it forces the caller to
 * judge those accounts on CTR, CPC, CPM and reach instead.
 */
function rollup(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const t = list.reduce((a, r) => {
    a.spend += n(r.spend); a.impressions += n(r.impressions); a.clicks += n(r.clicks);
    a.conversions += n(r.conversions); a.revenue += n(r.revenue); a.reach += n(r.reach);
    return a;
  }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0, reach: 0 });

  const trustworthy = t.conversions > 0 || t.revenue > 0;
  return {
    ...t,
    entities: list.length,
    ctr: t.impressions ? t.clicks / t.impressions : null,
    cpc: t.clicks ? t.spend / t.clicks : null,
    cpm: t.impressions ? (t.spend * 1000) / t.impressions : null,
    conversion_rate: trustworthy && t.clicks ? t.conversions / t.clicks : null,
    cpa: trustworthy && t.conversions ? t.spend / t.conversions : null,
    roas: trustworthy && t.spend ? t.revenue / t.spend : null,
    revenue_trustworthy: trustworthy,
    revenue_note: trustworthy ? null
      : 'No conversions or revenue are reported for these rows. That is expected where checkout happens on a third party and this brand\'s pixel never fires (retail media and marketplaces), and for campaigns not optimised to a purchase. Judge these on CTR, CPC, CPM and reach. ROAS, CPA and conversion rate are null rather than 0 so they are not read as having sold nothing.',
  };
}

module.exports = { metaRows, googleRows, tiktokRows, rowsFor, rollup, actionValue, PURCHASE };
