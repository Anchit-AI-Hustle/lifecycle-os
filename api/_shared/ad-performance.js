'use strict';
/**
 * ad-performance.js - the brand's OWN ads ranked by what each result cost
 * (2026-11-02, against usefastlane.ai: "rank ads by cost per result").
 * ---------------------------------------------------------------------------
 * ad-history.js keeps every ad with the figures its platform returned. Click-
 * through rate says which ads were clicked; cost per result says which ads
 * bought what the account was paying for. This ranks by the second wherever
 * the platform gave enough to know it, and says plainly where it did not.
 *
 * COST PER RESULT, per ad, from the platform's own figures only:
 *   - `reported`: the platform returned it (Meta's cost_per_conversion, kept by
 *     ad-history only when Meta returned exactly ONE action value);
 *   - `computed`: spend / results, both as the platform returned them, when
 *     results > 0 (Google Ads: cost_micros / 1e6 over metrics.conversions);
 *   - otherwise null WITH the reason: spend not returned, results not
 *     returned, or results reported as 0 (a cost per result of "infinity" is
 *     not a figure; that ad is counted apart as "spent with no result").
 *
 * THE RULES.
 *   - Per platform AND per currency: never pooled. A Meta ad's cost in INR and
 *     a Google ad's cost in an unread currency are not one list.
 *   - A median and a winner / loser only from MIN_RATED (3) or more ads that
 *     carry the figure, the same rule as the median click-through rate.
 *   - Lower is better: a winner costs less per result than this brand's own
 *     median on that platform.
 *   - `winnersFor()` is what evidence and variations read: cost per result
 *     where available, else click-through rate above the brand's own median,
 *     and it SAYS which (`basis`).
 * Pure, no I/O.
 * ---------------------------------------------------------------------------
 */

const MIN_RATED = 3;
const LABEL = { meta: 'Meta', google_ads: 'Google Ads', tiktok_ads: 'TikTok', pinterest: 'Pinterest' };
const METRIC_CPR = 'cost per result (spend / results, as the platform reported them; lower is better)';
const METRIC_CTR = 'click-through rate (clicks / impressions, as the platform reported it)';

const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One ad's cost per result: { value, basis: 'reported'|'computed'|null, reason }. */
function costPerResult(metrics) {
  const x = metrics && typeof metrics === 'object' ? metrics : {};
  const reported = num(x.cost_per_result);
  if (reported != null && reported >= 0) return { value: reported, basis: 'reported', reason: '' };
  const spend = num(x.spend);
  const results = num(x.conversions);
  if (spend != null && results != null) {
    if (results > 0) return { value: spend / results, basis: 'computed', reason: '' };
    return { value: null, basis: null, no_result: spend > 0, reason: spend > 0 ? 'spent with no result reported' : 'no spend and no result reported' };
  }
  if (spend == null && results == null) return { value: null, basis: null, reason: 'spend and results not returned' };
  return { value: null, basis: null, reason: spend == null ? 'spend not returned' : 'results not returned' };
}

/** The ranking of one brand's ads by cost per result, per platform and currency. */
function rankByCostPerResult(ads) {
  const groups = {};
  for (const a of (Array.isArray(ads) ? ads : [])) {
    if (!a) continue;
    const key = `${a.provider || 'unknown'}|${a.currency || ''}`;
    (groups[key] = groups[key] || []).push(a);
  }
  const out = Object.keys(groups).sort().map((key) => {
    const [provider, currency] = key.split('|');
    const list = groups[key];
    const label = LABEL[provider] || provider;
    const rows = list.map((a) => {
      const c = costPerResult(a.metrics);
      return { ad_id: a.ad_id, name: a.name || a.ad_id, cost_per_result: c.value, basis: c.basis, reason: c.reason, no_result: !!c.no_result,
        spend: num(a.metrics && a.metrics.spend), results: num(a.metrics && a.metrics.conversions), ctr: num(a.metrics && a.metrics.ctr) };
    });
    const rated = rows.filter((r) => r.cost_per_result != null)
      .sort((x, y) => x.cost_per_result - y.cost_per_result || (y.spend || 0) - (x.spend || 0) || String(x.ad_id).localeCompare(String(y.ad_id)));
    rated.forEach((r, i) => { r.rank = i + 1; });
    const unrated = rows.filter((r) => r.cost_per_result == null).map((r) => ({ ad_id: r.ad_id, name: r.name, reason: r.reason, no_result: r.no_result }));
    const mid = rated.length >= MIN_RATED ? median(rated.map((r) => r.cost_per_result)) : null;
    for (const r of rated) r.verdict = mid == null ? null : (r.cost_per_result < mid ? 'below_median' : (r.cost_per_result > mid ? 'above_median' : 'at_median'));
    const reported = rated.filter((r) => r.basis === 'reported').length;
    return {
      provider, label, currency: currency || null, ads: list.length, rated: rated.length, median_cpr: mid,
      ranked: rated, unrated, spent_without_result: unrated.filter((r) => r.no_result).length,
      basis_note: rated.length
        ? `${reported} of ${rated.length} as ${label} reported it, ${rated.length - reported} worked out as spend / results, both as ${label} returned them.`
        : '',
      reason: mid == null
        ? `${rated.length} of these ${list.length} ${label} ads carry a cost per result, under ${MIN_RATED}, so none is called the cheapest or the dearest.`
        : '',
    };
  });
  return { metric: METRIC_CPR, min_rated: MIN_RATED, platforms: out };
}

/**
 * The brand's own winning (and losing) ads per platform: by cost per result
 * where 3+ ads carry it, else by click-through rate where 3+ ads carry it,
 * else none with the reason. Each ad carries its figure and the median it beat.
 */
function winnersFor(ads, { limit = 3 } = {}) {
  const list = (Array.isArray(ads) ? ads : []).filter(Boolean);
  const byProvider = {};
  for (const a of list) (byProvider[a.provider || 'unknown'] = byProvider[a.provider || 'unknown'] || []).push(a);
  const cpr = rankByCostPerResult(list);
  return Object.keys(byProvider).sort().map((prov) => {
    const label = LABEL[prov] || prov;
    const mine = byProvider[prov];
    // The currency group with the most rated ads on this platform; any other is said.
    const groups = cpr.platforms.filter((g) => g.provider === prov).sort((x, y) => y.rated - x.rated);
    const g = groups[0];
    const other = groups.slice(1).reduce((s, x) => s + x.ads, 0);
    if (g && g.median_cpr != null) {
      const byId = Object.fromEntries(mine.map((a) => [String(a.ad_id), a]));
      const view = (r) => Object.assign({ ad: byId[String(r.ad_id)], value: r.cost_per_result, value_basis: r.basis }, { ad_id: r.ad_id, name: r.name });
      return {
        provider: prov, label, basis: 'cost_per_result', metric: METRIC_CPR, currency: g.currency, median: g.median_cpr, rated: g.rated, ads: mine.length,
        winners: g.ranked.filter((r) => r.verdict === 'below_median').slice(0, limit).map(view),
        losers: g.ranked.filter((r) => r.verdict === 'above_median').slice().reverse().slice(0, limit).map(view),
        note: other ? `${other} ${label} ads in another currency are not compared with these.` : '',
        cpr_reason: '',
      };
    }
    const cprReason = g ? g.reason : `No ${label} ad carries a cost per result.`;
    const rated = mine.filter((a) => num(a.metrics && a.metrics.ctr) != null);
    if (rated.length < MIN_RATED) {
      return { provider: prov, label, basis: null, metric: null, median: null, rated: rated.length, ads: mine.length, winners: [], losers: [], note: '', cpr_reason: cprReason,
        reason: `${rated.length} ${label} ad${rated.length === 1 ? '' : 's'} carry a reported click-through rate, too few for a median, and too few carry a cost per result, so no ${label} ad is called a winner or tiring.` };
    }
    const mid = median(rated.map((a) => Number(a.metrics.ctr)));
    const view = (a) => ({ ad: a, ad_id: a.ad_id, name: a.name || a.ad_id, value: Number(a.metrics.ctr), value_basis: 'reported' });
    return {
      provider: prov, label, basis: 'ctr', metric: METRIC_CTR, currency: null, median: mid, rated: rated.length, ads: mine.length,
      winners: rated.filter((a) => Number(a.metrics.ctr) > mid).sort((x, y) => Number(y.metrics.ctr) - Number(x.metrics.ctr)).slice(0, limit).map(view),
      losers: rated.filter((a) => Number(a.metrics.ctr) < mid).sort((x, y) => Number(x.metrics.ctr) - Number(y.metrics.ctr)).slice(0, limit).map(view),
      note: '', cpr_reason: cprReason,
    };
  });
}

/** How far one winner is from its median, as a share of the median (for choosing across platforms). */
function lead(w, pl) {
  if (!w || !pl || pl.median == null || !pl.median) return 0;
  return pl.basis === 'cost_per_result' ? (pl.median - w.value) / pl.median : (w.value - pl.median) / pl.median;
}

module.exports = { costPerResult, rankByCostPerResult, winnersFor, lead, median, MIN_RATED, METRIC_CPR, METRIC_CTR, LABEL };
