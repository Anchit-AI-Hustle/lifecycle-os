#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
// scrape-catalog.js — Refresh catalog data from the LIVE public storefront JSON
//
// Knickgasm's Shopify Admin API is NOT authorized for this project, so we read the
// public storefront endpoints (no auth) instead:
//   {base}/products.json?limit=250&page=N   (paginated until empty)
//
// Markets (verified 2026-06-21):
//   us / global → https://knickgasm.com  (live, USD)
//   uk          → no reachable JSON storefront (knickgasm.com is NXDOMAIN,
//                 .co.uk is a lander) → skipped; keep local products_uk.json.
//
// Output: data/catalog/products_{market}.live.json  (same compact shape as
//         build-catalog.js, minus CSV-only metafields the storefront omits).
//
// With --merge: updates price / compare_at / availability on the canonical
//         data/catalog/products_{market}.json in place (non-destructive to other
//         fields; matches by handle). Default run is non-destructive.
//
// Run: node scripts/scrape-catalog.js [--merge]
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { deriveTags } = require('./build-catalog.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'catalog');

// Markets with a reachable live storefront. UK intentionally omitted — see header.
const MARKETS = [
  { market: 'us',     base: 'https://knickgasm.com' },
  { market: 'global', base: 'https://knickgasm.com' }
];

const MERGE = process.argv.includes('--merge');

async function fetchAllProducts(base) {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const url = `${base}/products.json?limit=250&page=${page}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'lifecycle-os/catalog-scraper' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    const body = await res.json();
    const products = (body && body.products) || [];
    if (!products.length) break;
    all.push(...products);
    if (products.length < 250) break; // last page
  }
  return all;
}

// Map a storefront product object → the compact catalog shape used app-wide.
function toCatalog(p) {
  const v = (p.variants && p.variants[0]) || {};
  const img = (p.images && p.images[0] && p.images[0].src) || '';
  const tags = deriveTags(Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || ''), p.product_type, p.title);
  if (!tags.length) tags.push('general');

  const out = { n: (p.title || '').trim(), i: img, t: tags, h: p.handle };
  if (v.price) out.price = String(v.price);
  if (v.compare_at_price && v.compare_at_price !== v.price) out.compare_at = String(v.compare_at_price);
  if (p.product_type) out.type = p.product_type;
  // Availability is live-only signal the CSV never had — useful for "in stock" filtering.
  if (typeof v.available === 'boolean') out.available = v.available;
  return out;
}

function mergeLive(market, liveProducts) {
  const canonPath = path.join(OUT_DIR, `products_${market}.json`);
  if (!fs.existsSync(canonPath)) {
    console.warn(`  ⚠ no canonical products_${market}.json to merge into — skipping merge`);
    return;
  }
  const canon = JSON.parse(fs.readFileSync(canonPath, 'utf8'));
  const liveByHandle = new Map(liveProducts.map(p => [p.h, p]));
  let updated = 0;
  for (const prod of canon) {
    const live = liveByHandle.get(prod.h);
    if (!live) continue;
    if (live.price && live.price !== prod.price) { prod.price = live.price; updated++; }
    if (live.compare_at) prod.compare_at = live.compare_at;
    else delete prod.compare_at;
    if (typeof live.available === 'boolean') prod.available = live.available;
  }
  fs.writeFileSync(canonPath, JSON.stringify(canon), 'utf8');
  console.log(`  ↻ merged live price/availability into ${path.basename(canonPath)} (${updated} price changes)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const { market, base } of MARKETS) {
    try {
      console.log(`Scraping ${market} ← ${base}/products.json ...`);
      const raw = await fetchAllProducts(base);
      const products = raw.map(toCatalog).filter(p => p.n && p.h);
      const outPath = path.join(OUT_DIR, `products_${market}.live.json`);
      fs.writeFileSync(outPath, JSON.stringify(products), 'utf8');
      const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
      console.log(`  ✓ ${products.length} products → ${path.basename(outPath)} (${sizeKB} KB)`);
      if (MERGE) mergeLive(market, products);
    } catch (err) {
      console.error(`  ✗ ${market} scrape failed: ${err.message}`);
      process.exitCode = 1;
    }
  }
  console.log('\nNote: UK has no live storefront — keep data/catalog/products_uk.json (CSV-built).');
}

main();
