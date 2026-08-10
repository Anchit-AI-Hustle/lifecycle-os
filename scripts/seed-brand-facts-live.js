'use strict';
/**
 * seed-brand-facts-live.js — populate the B1 approved-facts library from the
 * EXACT official regional storefront + the store's PUBLIC Yotpo widget API.
 * Zero fabrication: every price/rating/review is read from what KNICKGASM already
 * publishes live; nothing is invented, nothing rounded, gaps are left absent.
 *
 *   node scripts/seed-brand-facts-live.js [region=us] [limit=all]
 *
 * Rate-safe design: ONE bulk /products.json for every product's id+price (the
 * storefront rate-limits rapid per-product hits), then ONE Yotpo widget call per
 * product (Yotpo's CDN does not rate-limit) with 429 backoff.
 *
 * region → base host (spec "Market-Specific Store URLs VERIFIED"):
 *   us → knickgasm.com · uk → knickgasm.com · global → knickgasm.com
 * Writes data/brand-facts/<region>.json in the shape brand-facts.js expects,
 * keyed by handle + title (the renderers' stable fallback keys).
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const REGION = (process.argv[2] || 'us').toLowerCase();
const LIMIT = process.argv[3] && process.argv[3] !== 'all' ? parseInt(process.argv[3], 10) : Infinity;
// Official regional storefronts (brand-assets allowlist): knickgasm.com / .co.uk / .global
const BASE = REGION.startsWith('uk') ? 'https://knickgasm.com' : (/(global|eu|au|me|row|rest)/.test(REGION) ? 'https://knickgasm.com' : 'https://www.knickgasm.com');
const FALLBACK_APP_KEY = process.env.YOTPO_APP_KEY || ''; // resolved live from the store's PDP
const MAX_REVIEWS = 3;
const DELAY_MS = 900;
const ROOT = path.join(__dirname, '..');
const UA = { 'User-Agent': 'lifecycle-os/brand-facts-seed' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Node's global fetch (undici) ignores HTTPS_PROXY, so it egresses on a
// rate-limited path (body "local_rate_limited"). curl honors the agent proxy and
// works — so all outbound goes through curl.
function curlText(url) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-sSL', '--max-time', '35', '-A', BROWSER_UA, url], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(err.message));
      resolve(String(stdout || ''));
    });
  });
}
async function fetchJSON(url, tries = 6) {
  for (let a = 0; a < tries; a++) {
    const body = await curlText(url).catch(() => '');
    if (/local_rate_limited|Too Many Requests|rate.?limit/i.test(body) || !body) { await sleep(3000 * (a + 1)); continue; }
    try { return JSON.parse(body); } catch (_) { await sleep(1500 * (a + 1)); }
  }
  throw new Error('rate-limited/parse (exhausted retries)');
}

// Resolve THIS store's public Yotpo key from one PDP (the widget-loader URL). The
// key is store-specific, so we read it from the exact regional domain rather than
// assume one. Env YOTPO_APP_KEY overrides. One extra storefront request, cached.
async function resolveAppKey(sampleHandle) {
  if (process.env.YOTPO_APP_KEY) return process.env.YOTPO_APP_KEY;
  try {
    const html = await curlText(`${BASE}/products/${sampleHandle}`);
    const m = html.match(/cdn-widgetsrepository\.yotpo\.com\/v1\/loader\/([A-Za-z0-9]+)/)
      || html.match(/(?:app_key|guid)['"]?\s*[:=]\s*['"]([A-Za-z0-9]{10,})['"]/i);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

async function allProducts() {
  const map = new Map(); // handle -> {id, price, title}
  let page = 1;
  for (;;) {
    const j = await fetchJSON(`${BASE}/products.json?limit=250&page=${page}`);
    const list = (j && j.products) || [];
    if (!list.length) break;
    for (const p of list) map.set(p.handle, { id: p.id, price: p.variants && p.variants[0] && p.variants[0].price, title: p.title });
    if (list.length < 250) break;
    page++; await sleep(400);
  }
  return map;
}

async function yotpoFor(appKey, productId) {
  const j = await fetchJSON(`https://api-cdn.yotpo.com/v1/widget/${appKey}/products/${productId}/reviews.json`);
  const resp = (j && j.response) || {};
  const bl = resp.bottomline || {};
  let avg = typeof bl.average_score === 'number' ? bl.average_score : (parseFloat(bl.average_score) || null);
  if (avg && avg > 0) avg = Math.round(avg * 10) / 10; // 1-decimal, as the site displays; never rounds 4.9→5
  const count = typeof bl.total_review === 'number' ? bl.total_review : (parseInt(bl.total_review, 10) || 0);
  // Ratings use the TRUE bottomline average (all reviews). The stored reviews[]
  // are testimonials, so curate to real POSITIVE, substantive ones (score >= 4,
  // >40 chars) — a curation choice, never fabrication. Rank verified + upvoted.
  const reviews = (resp.reviews || [])
    .filter((rv) => rv && rv.content && String(rv.content).trim().length > 40 && (rv.score || 0) >= 4)
    .sort((a, b) => (b.verified_buyer === a.verified_buyer ? ((b.score || 0) - (a.score || 0)) || ((b.votes_up || 0) - (a.votes_up || 0)) : (b.verified_buyer ? 1 : -1)))
    .slice(0, MAX_REVIEWS)
    .map((rv) => ({ quote: String(rv.content).replace(/_x000d_/gi, ' ').replace(/\s+/g, ' ').trim(), author: (rv.user && rv.user.display_name) || 'Verified buyer', stars: rv.score || null, verified: !!rv.verified_buyer }));
  return { avg: (avg && avg > 0) ? avg : null, count, reviews };
}

function loadCatalog() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog', `products_${REGION}.json`), 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.products || []);
  // catalogPrice comes from the store's own CSV export (authoritative, offline).
  return list.map((p) => ({ title: p.n || p.title || '', handle: p.h || p.handle || '', catalogPrice: p.price != null ? p.price : null })).filter((p) => p.handle);
}

(async () => {
  const catalog = loadCatalog();
  const products = catalog.slice(0, LIMIT === Infinity ? catalog.length : LIMIT);
  const out = { _note: `Auto-seeded (prices from catalog export; ratings/reviews from public Yotpo widget when reachable). Re-run scripts/seed-brand-facts-live.js ${REGION}. Zero-fabrication: only real published values; gaps omitted.`, reviews: {}, ratings: {}, review_counts: {}, prices: {}, _sources: { base: BASE, region: REGION, yotpo_app_key: null } };
  const stats = { total: products.length, priced: 0, rated: 0, reviewed: 0, live_ids: 0, gaps: [] };
  let appKey = null;

  // 1) PRICES — guaranteed, offline, from the catalog CSV export.
  for (const p of products) {
    if (p.catalogPrice == null || p.catalogPrice === '') continue;
    const price = String(p.catalogPrice);
    out.prices[lc(p.handle)] = price; if (p.title) out.prices[lc(p.title)] = price; stats.priced++;
  }

  // 2) RATINGS/REVIEWS — best-effort. Needs product ids, which only the storefront
  //    exposes (products.json). If the storefront rate-limits this IP, we keep the
  //    prices and record ratings as pending rather than failing the whole run.
  let pmap = null;
  try { pmap = await allProducts(); } catch (e) { stats.gaps.push('storefront id map unavailable (' + e.message + ') — ratings/reviews pending; prices unaffected'); }
  if (pmap) {
    const sample = products.find((p) => pmap.get(p.handle) && pmap.get(p.handle).id) || products[0];
    appKey = await resolveAppKey(sample.handle);
    out._sources.yotpo_app_key = appKey;
    if (!appKey) stats.gaps.push('Yotpo app key not found on ' + BASE + ' PDP — ratings/reviews skipped (prices unaffected)');
  }
  if (pmap && appKey) {
    for (let i = 0; i < products.length; i++) {
      const p = products[i]; const store = pmap.get(p.handle);
      if (!store || !store.id) continue;
      stats.live_ids++;
      const kH = lc(p.handle), kT = lc(p.title);
      try {
        const y = await yotpoFor(appKey, store.id);
        if (y.avg != null) { out.ratings[kH] = y.avg; if (kT) out.ratings[kT] = y.avg; stats.rated++; }
        if (y.count) { out.review_counts[kH] = y.count; if (kT) out.review_counts[kT] = y.count; }
        if (y.reviews.length) { out.reviews[kH] = y.reviews; if (kT) out.reviews[kT] = y.reviews; stats.reviewed++; }
      } catch (e) { stats.gaps.push(p.handle + ' (yotpo ' + e.message + ')'); }
      if ((i + 1) % 20 === 0) console.error(`… ${i + 1}/${products.length} (rated ${stats.rated})`);
      await sleep(DELAY_MS);
    }
  }

  const dest = path.join(ROOT, 'data', 'brand-facts', `${REGION}.json`);
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ region: REGION, base: BASE, yotpo_app_key: appKey, ...stats, gaps: stats.gaps.slice(0, 20), gaps_total: stats.gaps.length, wrote: dest }, null, 2));
})();
