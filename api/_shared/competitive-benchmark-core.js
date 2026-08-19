'use strict';
/**
 * competitive-benchmark-core.js — benchmark THIS brand against a competitor,
 * using the same platform stack the rest of the app runs on.
 *
 * ── The boundary this module exists to enforce ──────────────────────────────
 * Our Meta / Google Ads / TikTok credentials report on the WORKSPACE'S OWN ad
 * accounts. They cannot return a competitor's spend, CTR, CPM, ROAS or
 * conversion count: that data lives inside the competitor's account and no
 * public API exposes it. The same is true of Klaviyo and WebEngage, which hold
 * this brand's list performance and nobody else's.
 *
 * So there are two clearly separated sides and they are never blurred:
 *
 *   comparable — observable on BOTH sides by the SAME method, so the comparison
 *                means something (catalogue size and price band are read from
 *                /products.json for us and for them, identically).
 *   own_only   — we have it and no competitor value can exist. Reported with
 *                competitor: null and a reason, never with a guessed number.
 *
 * A benchmark that quietly presented our own CPM as "category CPM" would be
 * fabrication in the most damaging place: a number that looks sourced. The
 * split IS the module.
 *
 * ── THREE THINGS THE PORT HAD TO CHANGE ────────────────────────────────────
 * Adapted from the single-tenant sibling, where each of these was safe and here
 * is not:
 *
 * 1. WHOSE STOREFRONT IS "OURS". The original hardcoded five storefront hosts
 *    as OWN_STOREFRONT. Dropped in unchanged, every tenant's own baseline would
 *    be read from ANOTHER COMPANY'S SHOP, and the comparison would silently be
 *    that company against the competitor. `ownStorefront()` now reads the
 *    ACTIVE brand's own `regions[].store_url`, and a brand with no store URL
 *    for the market gets a marker instead of a fallback: there is no honest
 *    default for "which shop is mine".
 *
 * 2. WHERE THE COMPETITOR LIST LIVES. The original read a Google Sheet. This
 *    repo moved the competitor universe into `brand_competitors`, per
 *    workspace, precisely because one spreadsheet cannot hold more than one
 *    tenant's universe. benchmarkSet() reads that.
 *
 * 3. SSRF. `storefront()` fetches a domain the OPERATOR supplies, from the
 *    SERVER. That is the feature and it is also a request-forgery primitive
 *    pointed at the deployment's own network. It goes through the same
 *    `assertPublicUrl` guard the catalogue importer and reference-intel use.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 */

const adsLive = require('./ads-live-core.js');
const adInsights = require('./ad-insights-core.js');
const shopify = require('./shopify-core.js');
const klaviyo = require('./klaviyo-core.js');
const webengage = require('./webengage-core.js');
const core = require('./brand-workspace-core.js');

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
const round = (v, n = 2) => Math.round(num(v) * 10 ** n) / 10 ** n;
const normMarket = (m) => adInsights.normMarket(m);

function hostOf(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  try { return new URL(s.startsWith('http') ? s : `https://${s}`).host.toLowerCase(); } catch (_) { return ''; }
}
function median(xs) {
  const a = xs.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : round((a[m - 1] + a[m]) / 2);
}

/**
 * Which shop is OURS, for this market, according to this brand's own record.
 * Returns '' when the brand has not published one. There is deliberately no
 * fallback: reading somebody else's storefront and labelling it "own" is the
 * single worst thing this module could do.
 */
function ownStorefront(brand, market) {
  const mk = normMarket(market);
  const regions = (brand && Array.isArray(brand.regions)) ? brand.regions : [];
  const exact = regions.find((r) => r && String(r.code || '').toUpperCase() === mk);
  const any = regions.find((r) => r && r.store_url);
  const url = (exact && exact.store_url) || (any && any.store_url) || '';
  return { host: hostOf(url), exact_market: !!(exact && exact.store_url) };
}

/**
 * Read a public Shopify storefront's catalogue. Works for any Shopify store
 * without credentials, and returns a structured "not readable" result for
 * anything that is not one rather than guessing at the catalogue.
 */
async function storefront(domain, { limit = 250, timeoutMs = 15000 } = {}) {
  const host = hostOf(domain);
  const out = { host, readable: false, source: 'public_storefront_products_json' };
  if (!host) return Object.assign(out, { error: 'no domain' });

  const url = `https://${host}/products.json?limit=${Math.min(parseInt(limit, 10) || 250, 250)}`;
  // The operator chooses this host, and the server is what connects. Same guard
  // as every other operator-supplied fetch in this repo: public addresses only,
  // re-resolved, so http://169.254.169.254/ and the private ranges cannot be
  // reached through a competitor domain field.
  try { await core.assertPublicUrl(url); }
  catch (e) { return Object.assign(out, { url, error: `refused: ${e.message}`, note: 'Only public internet addresses can be read.' }); }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return Object.assign(out, { url, error: `HTTP ${res.status}`, note: 'Not a readable Shopify storefront (or products.json is disabled).' });
    const ct = String(res.headers.get('content-type') || '');
    if (!ct.includes('json')) return Object.assign(out, { url, error: 'non-json response', note: 'Storefront did not return JSON, so it is probably not Shopify.' });
    const json = await res.json();
    const products = Array.isArray(json && json.products) ? json.products : [];
    const prices = products.flatMap((p) => (p.variants || []).map((v) => Number(v.price))).filter((n) => Number.isFinite(n) && n > 0);
    const types = [...new Set(products.map((p) => String(p.product_type || '').trim()).filter(Boolean))];
    return {
      ...out, readable: true, url,
      products: products.length,
      // products.json pages at 250, so a full page means the catalogue is AT
      // LEAST this big, not exactly this big. Say so rather than imply a total.
      products_truncated: products.length >= 250,
      price_min: prices.length ? round(Math.min(...prices)) : null,
      price_median: median(prices),
      price_max: prices.length ? round(Math.max(...prices)) : null,
      product_types: types.slice(0, 12),
      sample_titles: products.slice(0, 5).map((p) => p.title),
    };
  } catch (e) {
    return Object.assign(out, { url, error: String((e && e.message) || e).slice(0, 160) });
  } finally { clearTimeout(timer); }
}

/* ── Own side: real figures from this workspace's connected platforms ─────── */

async function ownBaseline({ market = 'US', days = 30, brand = null } = {}) {
  const mk = normMarket(market);
  const own = ownStorefront(brand, mk);
  const [paid, live, commerce, store] = await Promise.all([
    adsLive.daily({}).catch((e) => ({ ok: false, error: e.message })),
    adsLive.today({}).catch((e) => ({ ok: false, error: e.message })),
    shopify.summary({ market: mk, days }).catch((e) => ({ ok: false, error: e.message })),
    own.host
      ? storefront(own.host)
      : Promise.resolve({
        readable: false,
        error: 'no_own_storefront',
        note: `[DATA REQUIRED BEFORE LAUNCH: store URL, ${(brand && brand.name) || 'this brand'}, ${mk}] Add this market's store URL in brand setup. No storefront is assumed, because reading somebody else's shop and labelling it "own" would make every comparison below wrong in a way that looks right.`,
      }),
  ]);

  // Roll the per-day series into window totals. Only the direct API path
  // carries conversions and revenue, so ROAS stays null on the warehouse
  // fallback rather than reading as zero return.
  const rows = (paid && paid.rows) || [];
  const t = rows.reduce((s, r) => ({
    spend: round(s.spend + num(r.spend)), impressions: s.impressions + num(r.impressions),
    link_clicks: s.link_clicks + num(r.link_clicks), conversions: s.conversions + num(r.conversions),
    revenue: round(s.revenue + num(r.revenue)),
  }), { spend: 0, impressions: 0, link_clicks: 0, conversions: 0, revenue: 0 });
  const complete = !!(paid && paid.complete_metrics);

  return {
    side: 'own', market: mk, window_days: days,
    storefront_source: own.host
      ? { host: own.host, from: own.exact_market ? 'this brand\'s store URL for this market' : 'this brand\'s only recorded store URL, which is not market-specific' }
      : { host: null, from: null },
    paid_media: {
      connected: !!(paid && paid.connected), source: (paid && paid.source) || null,
      metrics_complete: complete,
      spend: rows.length ? t.spend : null,
      impressions: rows.length ? t.impressions : null,
      link_clicks: rows.length ? t.link_clicks : null,
      ctr_pct: t.impressions ? round(t.link_clicks / t.impressions * 100, 2) : null,
      cpm: t.impressions ? round(t.spend / t.impressions * 1000, 2) : null,
      cpc: t.link_clicks ? round(t.spend / t.link_clicks, 3) : null,
      conversions: complete ? t.conversions : null,
      revenue: complete ? t.revenue : null,
      roas: complete && t.spend ? round(t.revenue / t.spend, 2) : null,
      active_creatives: (live && live.ok && live.live_count != null) ? live.live_count : null,
      platforms: adInsights.status(mk).platforms,
      blocker: (paid && paid.not_connected) ? (paid.hint || 'No live paid-media source configured.') : null,
    },
    commerce: commerce && commerce.ok
      ? { connected: true, orders: commerce.orders, revenue: commerce.revenue, aov: commerce.aov, returning_rate_pct: commerce.returning_rate_pct, currency: commerce.currency }
      : { connected: false, blocker: (commerce && (commerce.blocker || commerce.error)) || 'Shopify is not connected for this workspace.' },
    catalog: store,
    lifecycle: {
      klaviyo: { connected: klaviyo.isConnected(), blocker: klaviyo.isConnected() ? null : 'Connect Klaviyo on the Connections page to read this brand\'s own send performance.' },
      webengage: { connected: !!webengage.env().key, blocker: webengage.env().key ? null : 'Connect WebEngage on the Connections page and run its sync.' },
    },
  };
}

/* ── Competitor side: PUBLIC sources only ─────────────────────────────────── */

function transparencyLinks(brandName, country) {
  const q = encodeURIComponent(String(brandName || '').trim());
  const cc = String(country || 'US').toUpperCase();
  return {
    // Neither Google nor TikTok exposes a public competitor-reporting API, so a
    // deep link into the official public library is the honest maximum. An
    // endpoint invented here would 404 at best and fabricate at worst.
    google_ads: { source: 'deep_link', why_no_api: 'Google Ads Transparency Center has no public reporting API: advertiser data is browsable, not queryable.', url: `https://adstransparency.google.com/?region=${cc}&domain=${q}` },
    tiktok_ads: { source: 'deep_link', why_no_api: 'TikTok Creative Center Top Ads has no public per-advertiser reporting API.', url: `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=${cc}&keyword=${q}` },
  };
}

async function competitorSignals({ brand, domain, country = 'US', limit = 20 } = {}) {
  const name = String(brand || '').trim();
  if (!name && !domain) return { ok: false, error: 'missing brand or domain' };
  const competitor = require('./competitor-core.js');
  const [ads, store] = await Promise.all([
    competitor.fetchMetaAds({ brand: name, country, limit }).catch((e) => ({ ok: false, error: e.message, ads: [] })),
    domain ? storefront(domain) : Promise.resolve({ readable: false, note: 'No domain on this competitor record, so no storefront can be read.' }),
  ]);
  return {
    side: 'competitor', brand: name, domain: hostOf(domain) || null, country,
    storefront: store,
    meta_ads: {
      source: (ads && ads.source) || null,
      active_creatives: (ads && ads.ads && ads.ads.length) || 0,
      deep_link: ads && ads.deepLink,
      ads: (ads && ads.ads) || [],
      note: ads && ads.note,
    },
    ...transparencyLinks(name, country),
    not_observable: {
      fields: ['spend', 'ctr', 'cpm', 'cpc', 'roas', 'conversions', 'revenue', 'email_open_rate', 'email_click_rate', 'aov', 'list_size'],
      reason: 'These live inside the competitor\'s own ad and ESP accounts. No public API exposes them, and our platform credentials only ever report on our own accounts. They are reported as null, never estimated.',
    },
  };
}

/* ── The comparison ───────────────────────────────────────────────────────── */

function compare(own, comp) {
  const os = own.catalog || {};
  const cs = comp.storefront || {};
  const both = (a, b) => a != null && b != null;
  const row = (metric, unit, o, c, note) => ({
    metric, unit, own: o, competitor: c,
    delta: both(o, c) ? round(o - c) : null,
    // A ratio only means something when the competitor side is a real non-zero
    // reading, so it is omitted rather than shown as Infinity.
    ratio: both(o, c) && c ? round(o / c, 2) : null,
    note: note || null,
  });

  const comparable = [];
  if (os.readable && cs.readable) {
    comparable.push(
      row('catalog_size', 'products', os.products, cs.products,
        (os.products_truncated || cs.products_truncated) ? 'One or both catalogues hit the 250-product page cap, so these are floors rather than totals.' : null),
      row('price_min', 'currency', os.price_min, cs.price_min, 'Storefront currency is each store\'s own. Do not compare across markets.'),
      row('price_median', 'currency', os.price_median, cs.price_median, 'Storefront currency is each store\'s own. Do not compare across markets.'),
      row('price_max', 'currency', os.price_max, cs.price_max, 'Storefront currency is each store\'s own. Do not compare across markets.'),
    );
  } else if (!os.readable && os.error === 'no_own_storefront') {
    comparable.push({
      metric: 'catalog_size', unit: 'products', own: null, competitor: cs.readable ? cs.products : null,
      delta: null, ratio: null, note: os.note,
    });
  }

  // Active-creative count is observable on both sides but by DIFFERENT methods
  // (our ad account vs their Ad Library listing), so it is flagged indicative.
  const ourAds = (own.paid_media && own.paid_media.active_creatives != null) ? own.paid_media.active_creatives : null;
  comparable.push(Object.assign(
    row('active_meta_creatives', 'ads', ourAds, comp.meta_ads ? comp.meta_ads.active_creatives : null),
    { note: 'Indicative only: our side counts ads in our own account, theirs counts public Ad Library listings. Collected differently, so not strictly like for like.' },
  ));

  const ownOnly = [
    'spend', 'ctr_pct', 'cpm', 'cpc', 'conversions', 'revenue', 'roas', 'aov', 'returning_rate_pct', 'email_open_rate', 'email_click_rate',
  ].map((m) => ({
    metric: m,
    own: (own.paid_media && own.paid_media[m] != null) ? own.paid_media[m]
      : (own.commerce && own.commerce[m] != null ? own.commerce[m] : null),
    competitor: null,
    reason: 'Private to the competitor\'s ad or ESP account. No public source exposes it, and it is never estimated here.',
  }));

  return { comparable: comparable.filter((r) => r.own != null || r.competitor != null || r.note), own_only: ownOnly };
}

async function benchmark({ brand, domain, market = 'US', country, days = 30, limit = 20, ownBrand = null } = {}) {
  const mk = normMarket(market);
  const cc = String(country || (mk === 'UK' ? 'GB' : mk)).toUpperCase();
  const [own, comp] = await Promise.all([
    ownBaseline({ market: mk, days, brand: ownBrand }),
    competitorSignals({ brand, domain, country: cc, limit }),
  ]);
  if (comp && comp.ok === false) return comp;
  const cmp = compare(own, comp);
  return {
    ok: true, generated_at: new Date().toISOString(), market: mk, country: cc, window_days: days,
    own, competitor: comp, ...cmp,
    method: {
      own_sources: ['meta marketing api or warehouse mirror (paid)', 'shopify admin api (commerce)', 'this brand\'s own public storefront products.json (catalogue)', 'klaviyo + webengage (lifecycle)'],
      competitor_sources: ['public shopify storefront products.json', 'meta ad library', 'google ads transparency center (link)', 'tiktok creative center (link)'],
      rule: 'Our ad and ESP credentials report on OUR accounts only. No competitor performance figure is derived from them and none is estimated. Metrics with no possible competitor value are listed under own_only with competitor: null.',
    },
  };
}

/**
 * Benchmark against this WORKSPACE'S competitor universe, ranked by catalogue
 * size. The set comes from `brand_competitors` (this brand's own universe), not
 * from a shared spreadsheet: one sheet cannot hold more than one tenant's list,
 * which is why that moved.
 */
async function benchmarkSet({ market = 'US', category, days = 30, max = 6, store = null, workspaceId = null, ownBrand = null } = {}) {
  const mk = normMarket(market);
  const universe = require('./competitor-universe.js');

  if (!store || !workspaceId) {
    return {
      ok: false, error: 'workspace_unresolved',
      note: 'No active brand on this request, so no competitor universe is read. Another brand\'s list is never substituted.',
    };
  }

  let brands = [];
  try {
    const res = await universe.listUniverse(store, workspaceId);
    brands = (res && res.brands) || [];
  } catch (e) {
    return {
      ok: false, error: `Could not read this brand's competitor universe: ${e.message}`,
      hint: 'The universe lives in brand_competitors for this workspace. Activating a brand seeds it from that brand\'s own record.',
    };
  }

  const pick = brands
    .filter((b) => !category || String(b.category || '').toLowerCase() === String(category).toLowerCase())
    .slice(0, Math.min(parseInt(max, 10) || 6, 12));

  if (!pick.length) {
    return {
      ok: true, market: mk, category: category || null, brands: [],
      note: `[DATA REQUIRED BEFORE LAUNCH: competitor set, ${(ownBrand && ownBrand.name) || 'this brand'}] No competitors are recorded for this workspace. They are seeded from this brand's own record on activation, and never from another brand's list.`,
    };
  }

  const own = await ownBaseline({ market: mk, days, brand: ownBrand });
  const rows = await Promise.all(pick.map(async (b) => {
    const store = await storefront(b.domain || b.website_url || b.websiteUrl);
    return {
      brand: b.brand_name || b.brandName || b.name,
      domain: hostOf(b.domain || b.website_url || b.websiteUrl),
      category: b.category || null,
      positioning: b.positioning || null,
      verification: b.verification || null,
      storefront: store,
    };
  }));

  return {
    ok: true, generated_at: new Date().toISOString(), market: mk, category: category || null,
    own_catalog: own.catalog,
    brands: rows.sort((a, c) => num(c.storefront.products) - num(a.storefront.products)),
    note: 'Catalogue and price band only: those are the fields a public storefront actually exposes. Competitor spend, CTR and ROAS are not obtainable and are not shown.',
  };
}

module.exports = {
  benchmark, benchmarkSet, ownBaseline, competitorSignals, storefront, compare,
  ownStorefront, median, hostOf,
};
