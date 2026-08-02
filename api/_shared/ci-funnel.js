'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Competitive Intelligence — FUNNEL reconstruction.
//
// Connects a brand's captured assets into ordered timelines:
//   Ad → Landing Page → Email → Offer/Checkout change
// keyed by the landing-page URL that ties an ad to the rest of the journey.
//
// Pure read+aggregate over ci_* tables; writes the assembled timeline back to
// ci_funnels so the UI renders without recomputing.
// ─────────────────────────────────────────────────────────────────────────────

const supa = require('./supa');

function urlHashOf(url) { return url ? supa.sha1(require('./ci-collect').canonicalUrl(url)) : null; }

// Rebuild every funnel for one brand. A funnel cluster is keyed by a landing
// page url_hash; ads pointing at that URL + emails from the brand around the
// same window + offers on those assets all join into one timeline.
async function rebuildForBrand(brandId) {
  const [ads, lps, emails, offers] = await Promise.all([
    supa.select('ci_ads', { filters: { brand_id: `eq.${brandId}` }, order: 'first_seen.asc', limit: 1000 }),
    supa.select('ci_landing_pages', { filters: { brand_id: `eq.${brandId}` }, order: 'captured_at.asc', limit: 1000 }),
    supa.select('ci_emails', { filters: { brand_id: `eq.${brandId}` }, order: 'send_date.asc', limit: 1000 }),
    supa.select('ci_offers', { filters: { brand_id: `eq.${brandId}` }, order: 'first_seen.asc', limit: 1000 })
  ]);
  const offerByAsset = new Map();
  for (const o of offers) offerByAsset.set(`${o.asset_type}:${o.asset_id}`, o.offer_type);

  // Cluster landing pages by url_hash → funnel_key.
  const clusters = new Map();
  const ensure = (key, seed) => {
    if (!clusters.has(key)) clusters.set(key, { funnel_key: key, events: [], region: seed?.region, category: seed?.product_category });
    return clusters.get(key);
  };

  for (const lp of lps) {
    const c = ensure(lp.url_hash, { region: lp.region, category: lp.product_category });
    c.events.push({ date: lp.captured_at, stage: 'landing', asset_type: 'landing', asset_id: lp.id,
      label: lp.url, offer_type: offerByAsset.get(`landing:${lp.id}`) || null });
  }
  for (const ad of ads) {
    const key = ad.landing_url ? urlHashOf(ad.landing_url) : `ad-${ad.source}`;
    const c = ensure(key);
    c.events.push({ date: ad.first_seen, stage: 'ad', asset_type: 'ad', asset_id: ad.id,
      label: `${ad.source}: ${ad.headline || ad.primary_copy || ad.ad_id || ''}`.slice(0, 120),
      offer_type: offerByAsset.get(`ad:${ad.id}`) || null });
  }
  // Emails aren't URL-linked; attach them to the most active cluster as the
  // brand-wide nurture track (a dedicated "email" cluster if none exist).
  if (emails.length) {
    const c = ensure('email-track');
    for (const em of emails) c.events.push({ date: em.send_date || em.created_at, stage: 'email',
      asset_type: 'email', asset_id: em.id, label: em.subject || '(no subject)',
      offer_type: offerByAsset.get(`email:${em.id}`) || null });
  }

  const brandRows = await supa.select('brands', { filters: { id: `eq.${brandId}` }, limit: 1 });
  const brand = brandRows[0] || {};
  const saved = [];
  for (const c of clusters.values()) {
    c.events.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    if (!c.events.length) continue;
    const row = {
      brand_id: brandId, brand_name: brand.name || null, funnel_key: c.funnel_key,
      product_category: c.category || brand.category || null, region: c.region || brand.region || null,
      started_at: c.events[0].date, last_event_at: c.events[c.events.length - 1].date,
      events: c.events, updated_at: new Date().toISOString()
    };
    const [r] = await supa.insert('ci_funnels', [row], { upsertOn: 'brand_id,funnel_key' });
    saved.push(r || row);
  }
  return { brand_id: brandId, funnels: saved.length };
}

async function rebuildAll() {
  const brands = await supa.select('brands', { filters: { active: 'eq.true', is_own: 'eq.false' }, limit: 1000 });
  const out = [];
  for (const b of brands) { try { out.push(await rebuildForBrand(b.id)); } catch (e) { out.push({ brand_id: b.id, error: e.message }); } }
  return out;
}

async function getForBrand(brandId) {
  return supa.select('ci_funnels', { filters: { brand_id: `eq.${brandId}` }, order: 'last_event_at.desc', limit: 200 });
}

module.exports = { rebuildForBrand, rebuildAll, getForBrand };
