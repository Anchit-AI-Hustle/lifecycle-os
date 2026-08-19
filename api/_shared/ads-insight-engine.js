'use strict';

/**
 * ads-insight-engine.js — turns REAL ad rows into insights, actionables and a
 * creative read. Pure functions over rows that ad-insights-core already fetched;
 * this module never calls a platform and never invents a row.
 *
 * ZERO FABRICATION IS THE WHOLE POINT.
 * Every finding here quotes figures taken from the rows it was given, and names
 * the entity they came from. A finding that cannot cite a number is not emitted.
 * With no rows the result is an empty list plus the caller's blocker — never a
 * plausible-sounding observation, because an invented insight about ad spend is
 * the most expensive kind of fabrication in this repo: someone acts on it.
 *
 * NULL IS NOT ZERO. The warehouse mirror has no conversion or revenue columns,
 * so on that path conversions/revenue/ROAS arrive as null. Treating null as 0
 * would report "this campaign sold nothing" when the truth is "this source
 * cannot know". Every rule below skips a row whose driving metric is null and
 * says so in `coverage`, rather than counting it as a zero.
 */

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const pct = (a, b) => (a == null || !b ? null : (a / b) * 100);
const money = (v, cur) => (v == null ? null : `${cur || ''}${Number(v).toFixed(2)}`);

function median(xs) {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Normalise whatever shape a platform returned into the fields the rules use.
// Missing stays missing: a field this cannot find is null, never a default.
function normalise(row) {
  const spend = num(row.spend);
  const impressions = num(row.impressions);
  const clicks = num(row.clicks != null ? row.clicks : row.link_clicks);
  const reach = num(row.reach);
  const conversions = num(row.conversions);
  const revenue = num(row.revenue);
  return {
    name: row.campaign_name || row.ad_name || row.adset_name || row.account_name || row.name || row.entity_id || 'unnamed',
    level: row.level || null,
    platform: row.platform || null,
    entity_id: row.entity_id || row.ad_id || row.campaign_id || null,
    spend, impressions, clicks, reach, conversions, revenue,
    frequency: num(row.frequency) != null ? num(row.frequency) : (reach && impressions ? impressions / reach : null),
    ctr: num(row.ctr) != null ? num(row.ctr) : pct(clicks, impressions),
    cpc: num(row.cpc) != null ? num(row.cpc) : (clicks ? spend / clicks : null),
    cpm: num(row.cpm) != null ? num(row.cpm) : (impressions ? (spend / impressions) * 1000 : null),
    roas: num(row.purchase_roas) != null ? num(row.purchase_roas) : (revenue != null && spend ? revenue / spend : null),
    video_3s: num(row.video_3s_views != null ? row.video_3s_views : row.video_plays_3s),
    video_p75: num(row.video_p75_watched != null ? row.video_p75_watched : row.video_plays_75),
    currency: row.currency || '',
  };
}

/**
 * Insights — observations, each carrying the figures that produced it.
 * severity: 'critical' | 'watch' | 'good'
 */
function deriveInsights(rawRows, opts = {}) {
  const rows = (rawRows || []).map(normalise).filter((r) => r.spend != null || r.impressions != null);
  const out = [];
  const coverage = {};
  if (!rows.length) return { insights: [], coverage: { rows: 0 }, note: 'No rows were returned, so nothing is analysed. Nothing is inferred from an empty result.' };

  const totalSpend = rows.reduce((s, r) => s + (r.spend || 0), 0);
  coverage.rows = rows.length;
  coverage.total_spend = totalSpend;

  // 1. SPEND CONCENTRATION. Where the money actually is, before anything else.
  const bySpend = rows.filter((r) => r.spend != null).sort((a, b) => b.spend - a.spend);
  if (bySpend.length > 2 && totalSpend > 0) {
    const top = bySpend.slice(0, 3);
    const share = (top.reduce((s, r) => s + r.spend, 0) / totalSpend) * 100;
    out.push({
      id: 'spend-concentration',
      severity: share >= 70 ? 'watch' : 'good',
      title: `Top 3 carry ${share.toFixed(1)}% of spend`,
      detail: `${top.map((r) => `${r.name} (${money(r.spend, r.currency)})`).join(', ')} out of ${money(totalSpend, rows[0].currency)} total across ${rows.length} rows.`,
      metric: 'spend', value: share,
      evidence: top.map((r) => ({ name: r.name, spend: r.spend })),
    });
  }

  // 2. ZERO-CONVERSION SPEND. Only where conversions are actually MEASURED —
  // a null conversion count means the source cannot see conversions, which is
  // not the same as a campaign that sold nothing.
  const measurable = rows.filter((r) => r.conversions != null && r.spend != null);
  coverage.conversion_rows = measurable.length;
  if (measurable.length) {
    const dead = measurable.filter((r) => r.conversions === 0 && r.spend > 0).sort((a, b) => b.spend - a.spend);
    if (dead.length) {
      const wasted = dead.reduce((s, r) => s + r.spend, 0);
      out.push({
        id: 'zero-conversion-spend',
        severity: 'critical',
        title: `${money(wasted, dead[0].currency)} spent with zero recorded conversions`,
        detail: `${dead.length} of ${measurable.length} rows with conversion tracking recorded 0 conversions. Largest: ${dead.slice(0, 3).map((r) => `${r.name} (${money(r.spend, r.currency)})`).join(', ')}.`,
        metric: 'conversions', value: wasted,
        evidence: dead.slice(0, 5).map((r) => ({ name: r.name, spend: r.spend, conversions: 0 })),
      });
    }
  } else {
    out.push({
      id: 'no-conversion-coverage',
      severity: 'watch',
      title: 'No conversion data in this result',
      detail: 'These rows carry no conversion or revenue column, so ROAS and cost-per-conversion cannot be computed from them. That is a property of the source, not a result of zero sales.',
      metric: 'conversions', value: null, evidence: [],
    });
  }

  // 3. FREQUENCY FATIGUE. The single clearest creative-fatigue signal, and the
  // one thing a warehouse mirror usually can still see.
  const freqRows = rows.filter((r) => r.frequency != null);
  coverage.frequency_rows = freqRows.length;
  const fatigued = freqRows.filter((r) => r.frequency >= 3).sort((a, b) => b.frequency - a.frequency);
  if (fatigued.length) {
    out.push({
      id: 'frequency-fatigue',
      severity: fatigued.some((r) => r.frequency >= 5) ? 'critical' : 'watch',
      title: `${fatigued.length} row${fatigued.length > 1 ? 's' : ''} serving at frequency 3+`,
      detail: `${fatigued.slice(0, 3).map((r) => `${r.name} (${r.frequency.toFixed(2)}x)`).join(', ')}. The same people are seeing the same creative repeatedly, which raises CPM and depresses CTR before it shows up in spend.`,
      metric: 'frequency', value: fatigued[0].frequency,
      evidence: fatigued.slice(0, 5).map((r) => ({ name: r.name, frequency: r.frequency, reach: r.reach })),
    });
  }

  // 4. EFFICIENCY OUTLIERS against this account's OWN median, never an industry
  // benchmark — we have no verified benchmark and would be inventing one.
  const cpcs = rows.map((r) => r.cpc).filter((x) => x != null && isFinite(x));
  const medCpc = median(cpcs);
  if (medCpc && cpcs.length >= 4) {
    const pricey = rows.filter((r) => r.cpc != null && r.cpc > medCpc * 2 && r.spend > 0).sort((a, b) => b.spend - a.spend);
    if (pricey.length) {
      out.push({
        id: 'cpc-outliers',
        severity: 'watch',
        title: `${pricey.length} row${pricey.length > 1 ? 's' : ''} paying over 2x the account median CPC`,
        detail: `Median CPC across ${cpcs.length} rows is ${money(medCpc, rows[0].currency)}. ${pricey.slice(0, 3).map((r) => `${r.name} at ${money(r.cpc, r.currency)}`).join(', ')}. Compared against this account's own median, not an external benchmark.`,
        metric: 'cpc', value: medCpc,
        evidence: pricey.slice(0, 5).map((r) => ({ name: r.name, cpc: r.cpc, spend: r.spend })),
      });
    }
  }

  // 5. CTR LEADERS — what to read across, stated positively so the panel is not
  // purely a list of problems.
  const ctrRows = rows.filter((r) => r.ctr != null && r.impressions >= 1000).sort((a, b) => b.ctr - a.ctr);
  if (ctrRows.length >= 3) {
    const best = ctrRows[0];
    const med = median(ctrRows.map((r) => r.ctr));
    if (med && best.ctr > med * 1.5) {
      out.push({
        id: 'ctr-leader',
        severity: 'good',
        title: `${best.name} is out-clicking the account by ${(best.ctr / med).toFixed(1)}x`,
        detail: `${best.ctr.toFixed(2)}% CTR against a median of ${med.toFixed(2)}% across ${ctrRows.length} rows with 1,000+ impressions. Worth reading for what the rest can copy.`,
        metric: 'ctr', value: best.ctr,
        evidence: ctrRows.slice(0, 3).map((r) => ({ name: r.name, ctr: r.ctr, impressions: r.impressions })),
      });
    }
  }

  const order = { critical: 0, watch: 1, good: 2 };
  out.sort((a, b) => order[a.severity] - order[b.severity]);
  return { insights: out, coverage };
}

/**
 * Actionables — an insight becomes an action only when there is something
 * specific to DO and a figure to justify doing it. Anything that would read as
 * "monitor performance" is deliberately not emitted; it is not an action.
 */
function deriveActionables(rawRows) {
  const { insights, coverage } = deriveInsights(rawRows);
  const actions = [];
  const find = (id) => insights.find((i) => i.id === id);

  const dead = find('zero-conversion-spend');
  if (dead) {
    actions.push({
      priority: 1,
      action: 'Pause or rebuild the zero-conversion rows',
      why: dead.detail,
      target_metric: 'wasted spend',
      expected: `Recovers up to ${dead.value != null ? dead.value.toFixed(2) : 'the stated'} in the window if the rest holds, minus whatever the pause costs in learning.`,
      evidence: dead.evidence,
    });
  }

  const fat = find('frequency-fatigue');
  if (fat) {
    actions.push({
      priority: fat.severity === 'critical' ? 1 : 2,
      action: 'Refresh creative on the high-frequency sets',
      why: fat.detail,
      target_metric: 'frequency, then CPM',
      expected: 'Frequency falls toward 1.5-2.0 as new creative enters the auction; CPM usually follows within a few days.',
      evidence: fat.evidence,
    });
  }

  const cpc = find('cpc-outliers');
  if (cpc) {
    actions.push({
      priority: 2,
      action: 'Review targeting and placements on the high-CPC rows',
      why: cpc.detail,
      target_metric: 'CPC',
      expected: `Bringing them to the account median of ${cpc.value != null ? cpc.value.toFixed(2) : 'median'} is the ceiling on the saving; treat that as an upper bound, not a forecast.`,
      evidence: cpc.evidence,
    });
  }

  const win = find('ctr-leader');
  if (win) {
    actions.push({
      priority: 3,
      action: 'Read the leading creative and port its angle to the rest',
      why: win.detail,
      target_metric: 'CTR',
      expected: 'No figure is claimed here: a copied angle is a hypothesis, and its effect has to be measured rather than predicted.',
      evidence: win.evidence,
    });
  }

  actions.sort((a, b) => a.priority - b.priority);
  return { actions, coverage, note: actions.length ? null : 'No action is proposed. The rows returned did not trigger any rule, and a generic recommendation would not be grounded in them.' };
}

/**
 * Creative analysis — per-creative read. Hook rate and through rate are the two
 * numbers that separate a creative problem from a targeting problem, and both
 * are only computable where video metrics are present, so their absence is
 * reported rather than filled in.
 */
function deriveCreativeAnalysis(rawRows) {
  const rows = (rawRows || []).map(normalise);
  const creatives = rows
    .filter((r) => r.impressions != null && r.impressions > 0)
    .map((r) => {
      const hook = r.video_3s != null ? pct(r.video_3s, r.impressions) : null;
      const through = (r.video_p75 != null && r.video_3s) ? pct(r.video_p75, r.video_3s) : null;
      return {
        name: r.name, entity_id: r.entity_id, platform: r.platform, level: r.level,
        spend: r.spend, impressions: r.impressions, reach: r.reach, frequency: r.frequency,
        ctr: r.ctr, cpc: r.cpc, cpm: r.cpm, conversions: r.conversions, roas: r.roas,
        hook_rate: hook, through_rate: through,
        // A creative can fail in three distinguishable places, and naming which
        // one is the entire value of this view. Only stated where the metric
        // needed to tell them apart is actually present.
        diagnosis: hook == null
          ? 'No video metrics on this row, so hook and through rate cannot be computed. Not a judgement on the creative.'
          : hook < 20
            ? 'Weak hook: most impressions never became a 3-second view. The opening frame is the problem, not the offer.'
            : through != null && through < 15
              ? 'Strong hook, weak hold: people start and leave. The middle of the creative is the problem.'
              : r.ctr != null && r.ctr < 0.5
                ? 'Watched but not clicked. The creative works and the call to action does not.'
                : 'No failure signal in the metrics present on this row.',
      };
    })
    .sort((a, b) => (b.spend || 0) - (a.spend || 0));

  const withVideo = creatives.filter((c) => c.hook_rate != null).length;
  return {
    creatives,
    coverage: {
      rows: creatives.length,
      with_video_metrics: withVideo,
      note: withVideo === 0 && creatives.length
        ? 'None of these rows carry video metrics, so hook and through rate are absent throughout. Request ad-level video metrics from the platform to populate them.'
        : null,
    },
  };
}

module.exports = { deriveInsights, deriveActionables, deriveCreativeAnalysis, normalise, median };
