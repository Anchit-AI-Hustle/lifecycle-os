#!/usr/bin/env node
'use strict';

/**
 * Ad collector — discovers competitor ads and feeds them into the Competitive-
 * Intelligence repository (ci_ads, with dedup + version history + offer
 * extraction handled DB-side by api/_shared/ci-collect.js).
 *
 * WHY a worker (not a Vercel function):
 *   Structured ad-library pulls use a third-party scraper (Apify) and/or a real
 *   browser, neither of which fits the 12-function Hobby budget. Like
 *   auto-subscribe.js, this reuses the SAME tested core the server uses —
 *   competitor-core.fetchMetaAds() to discover, ci-collect.collectAd() to
 *   persist — writing straight to Supabase with a service-role key from
 *   .env.local (the deployed API sits behind Vercel SSO).
 *
 * SOURCES:
 *   • Meta Ad Library  — fully working via fetchMetaAds (Apify token → structured
 *     creatives; without a token it records the deep-link so nothing is lost).
 *   • Google Ads Transparency / TikTok Creative Center — these libraries have no
 *     stable public API and aggressively block headless DOM scraping; this
 *     worker records the per-brand deep-link as a discovery breadcrumb and
 *     leaves structured capture to a future authenticated/3rd-party connector
 *     (see docs). It NEVER pretends to have scraped what it could not.
 *
 * USAGE:
 *   npm run collect:ads                 # all active competitor brands
 *   ONLY="Bird & Colorway,Shoe Surgeon" npm run collect:ads
 *   MAX=10 COUNTRY=GB npm run collect:ads
 */

require('./_env')();
const core = require('../api/_shared/competitor-core');
const ciCollect = require('../api/_shared/ci-collect');
const supa = require('../api/_shared/supa');

const MAX = Number(process.env.MAX || 0);
const COUNTRY = (process.env.COUNTRY || 'ALL').toUpperCase();
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function googleTransparencyLink(name) {
  return 'https://adstransparency.google.com/?region=anywhere&query=' + encodeURIComponent(name);
}
function tiktokCreativeLink(name) {
  return 'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?keyword=' + encodeURIComponent(name);
}

async function loadBrands() {
  // Prefer the Supabase brands table; fall back to the legacy Google Sheet.
  try {
    const rows = await supa.select('brands', { filters: { active: 'eq.true', is_own: 'eq.false' }, limit: 1000 });
    if (rows.length) return rows.map(b => ({ id: b.id, name: b.name, domain: b.domain, region: b.region }));
  } catch (e) { console.warn('[ads] supabase brands unavailable:', e.message); }
  try {
    const sheet = await core.getBrands();
    return sheet.map(b => ({ name: b.name || b.Name || b.brand, domain: b.domain || b.website || b.Website }));
  } catch (e) { console.warn('[ads] sheet brands unavailable:', e.message); return []; }
}

async function collectMetaForBrand(brand) {
  const r = await core.fetchMetaAds({ brand: brand.name, country: COUNTRY, limit: 50 });
  const ads = (r && r.ads) || [];
  let stored = 0, changed = 0;
  for (const a of ads) {
    const res = await ciCollect.collectAd({
      brand_id: brand.id, brand_name: brand.name, domain: brand.domain,
      source: 'meta', ad_id: a.id,
      creative_type: a.image ? 'image' : 'text',
      image_urls: a.image ? [a.image] : [],
      primary_copy: a.body || '',
      landing_url: a.link && !a.link.includes('facebook.com/ads/library') ? a.link : null,
      source_link: a.link || r.deepLink || null,
      raw_json: a
    });
    if (res.status === 'new') stored++;
    if (res.status === 'changed') changed++;
  }
  return { source: r.source, found: ads.length, stored, changed, deepLink: r.deepLink };
}

(async () => {
  let brands = await loadBrands();
  if (ONLY.length) brands = brands.filter(b => ONLY.some(o => (b.name || '').toLowerCase().includes(o)));
  if (MAX) brands = brands.slice(0, MAX);
  if (!brands.length) { console.error('No competitor brands found. Seed the brands table first.'); process.exit(1); }

  console.log(`[ads] collecting for ${brands.length} brand(s), country=${COUNTRY}`);
  const summary = [];
  for (const brand of brands) {
    try {
      const meta = await collectMetaForBrand(brand);
      // Record the Google/TikTok discovery breadcrumbs (deep-links only).
      summary.push({ brand: brand.name, meta,
        google: googleTransparencyLink(brand.name), tiktok: tiktokCreativeLink(brand.name) });
      console.log(`  ✓ ${brand.name}: meta ${meta.source} found=${meta.found} new=${meta.stored} changed=${meta.changed}`);
    } catch (e) {
      console.warn(`  ✗ ${brand.name}: ${e.message}`);
      summary.push({ brand: brand.name, error: e.message });
    }
  }
  const totals = summary.reduce((a, s) => ({
    found: a.found + (s.meta?.found || 0), stored: a.stored + (s.meta?.stored || 0), changed: a.changed + (s.meta?.changed || 0)
  }), { found: 0, stored: 0, changed: 0 });
  console.log(`[ads] done — found=${totals.found} new=${totals.stored} changed=${totals.changed}`);
})().catch(e => { console.error('[ads] fatal:', e); process.exit(1); });
