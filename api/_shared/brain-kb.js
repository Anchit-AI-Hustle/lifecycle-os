'use strict';

/**
 * brain-kb.js — Knowledge Base service (Module 1).
 *
 * DB-linked KB over the provided linked DB: own catalog, brand assets,
 * brand kit, and the complete historical campaign library indexed down to
 * creative level with performance metrics, enriched with user-level data.
 *
 * Contract:
 *   snapshot()            → { products, assets, brand_kit, campaigns[] }   (campaigns joined with creatives+metrics)
 *   libraryIndex()        → per-campaign index: hooks/angles/formats/archetypes + computed KPIs per creative
 *   patterns(library)     → aggregated "what worked": by angle / hook / archetype / format / channel
 */

const { db, pct, round, sum, groupBy } = require('./brain-core.js');

function kpisFor(channel, m) {
  const sends = sum(m, (x) => x.sends), imps = sum(m, (x) => x.impressions);
  const opens = sum(m, (x) => x.opens), clicks = sum(m, (x) => x.clicks);
  const conv = sum(m, (x) => x.conversions), rev = sum(m, (x) => x.revenue), spend = sum(m, (x) => x.spend);
  return {
    sends, impressions: imps, opens, clicks, conversions: conv,
    revenue: round(rev, 2), spend: round(spend, 2),
    open_rate: round(pct(opens, sends)), click_rate: round(pct(clicks, channel === 'email' ? sends : imps)),
    ctr: round(pct(clicks, imps || sends)), cvr: round(pct(conv, clicks)),
    rpr: round(pct(rev, sends)), roas: spend > 0 ? round(rev / spend, 2) : null,
    aov: conv > 0 ? round(rev / conv, 2) : 0,
  };
}

async function snapshot() {
  const d = db();
  const [products, assets, campaigns, creatives, metrics] = await Promise.all([
    d.select('smart_products', { limit: 2000, filters: { active: 'eq.true' } }),
    d.select('smart_assets', { limit: 200 }),
    d.select('smart_campaigns', { limit: 5000, order: 'started_at.desc' }),
    d.select('smart_campaign_assets', { limit: 20000 }),
    d.select('smart_campaign_metrics', { limit: 50000 }),
  ]);
  const creativesBy = groupBy(creatives, (c) => c.campaign_id);
  const metricsBy = groupBy(metrics, (m) => m.campaign_id);
  const joined = campaigns.map((c) => {
    const ms = metricsBy[c.id] || [];
    const metricsByCreative = groupBy(ms.filter((m) => m.creative_id), (m) => m.creative_id);
    return {
      ...c,
      creatives: (creativesBy[c.id] || []).map((cr) => ({
        ...cr,
        kpis: kpisFor(c.channel, metricsByCreative[cr.creative_id] || []),
      })),
      kpis: kpisFor(c.channel, ms),
    };
  });
  const brandKitRow = assets.find((a) => a.kind === 'brand_kit');
  return { products, assets, brand_kit: brandKitRow ? brandKitRow.content : null, campaigns: joined };
}

async function libraryIndex() {
  const snap = await snapshot();
  return snap.campaigns.map((c) => ({
    id: c.id, name: c.name, channel: c.channel, market: c.market,
    campaign_type: c.campaign_type, started_at: c.started_at,
    theme: c.theme, hook: c.hook, angle: c.angle, format: c.format,
    archetype: c.archetype, festival: c.festival, audience: c.audience,
    kpis: c.kpis,
    creatives: c.creatives.map((cr) => ({ creative_id: cr.creative_id, kind: cr.kind, content: cr.content, variant: (cr.meta || {}).variant, kpis: cr.kpis })),
  }));
}

/** Aggregate what worked, by dimension. Pure own-data — no competitor input. */
function patterns(library) {
  const dims = ['angle', 'hook', 'archetype', 'format', 'theme'];
  const out = {};
  for (const dim of dims) {
    const grouped = groupBy(library.filter((c) => c[dim]), (c) => c[dim]);
    out[dim] = Object.entries(grouped).map(([value, items]) => {
      const revenue = sum(items, (c) => c.kpis.revenue);
      const conv = sum(items, (c) => c.kpis.conversions);
      const score = round(revenue / Math.max(items.length, 1), 2);
      return { value, campaigns: items.length, revenue: round(revenue, 2), conversions: conv, revenue_per_campaign: score };
    }).sort((a, b) => b.revenue_per_campaign - a.revenue_per_campaign);
  }
  // per-channel winners
  out.by_channel = {};
  for (const [channel, items] of Object.entries(groupBy(library, (c) => c.channel))) {
    out.by_channel[channel] = items
      .slice()
      .sort((a, b) => (b.kpis.revenue || 0) - (a.kpis.revenue || 0))
      .slice(0, 5)
      .map((c) => ({ id: c.id, name: c.name, angle: c.angle, hook: c.hook, archetype: c.archetype, revenue: c.kpis.revenue, roas: c.kpis.roas, open_rate: c.kpis.open_rate }));
  }
  return out;
}

module.exports = { snapshot, libraryIndex, patterns, kpisFor };
