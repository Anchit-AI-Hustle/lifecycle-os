#!/usr/bin/env node
'use strict';
/**
 * scripts/gen-demo-d2c-dashboard.js
 * ---------------------------------------------------------------------------
 * Rebuilds the embedded `const D={...}` dataset inside
 * lifecycle-usa-d2c-dashboard.html (the Sales & Business Review iframe).
 *
 * WHY: that dashboard shipped carrying the PREVIOUS brand's real business data
 * - their actual multi-year revenue, their marketplace ASIN/SKU catalogue,
 * their category mix and subscription programme. None of it is KNICKGASM's.
 *
 * HOW: this TRANSFORMS the existing structure rather than rebuilding it, so
 * every key the dashboard's rendering code reads still exists (rebuilding from
 * scratch silently dropped ~120 subkeys and blanked half the panels). For each
 * value it:
 *   - maps product/category strings onto the REAL knickgasm.com catalogue
 *     (data/catalog/products_us.json), deterministically by content hash
 *   - rescales every monetary/volume number through a seeded transform, so no
 *     original figure survives, while keeping series internally plausible
 *   - drops pre-2021 history (the brand launched 2020-11-04) and empties
 *     marketplace/subscription fields KNICKGASM genuinely does not have
 *   - strips food/beverage attributes and ASINs
 *
 * The source of truth for the ORIGINAL shape is the committed dashboard; run
 * this once per data refresh. Product names and prices are real; all
 * commercial figures are demo until Shopify/Klaviyo exports land.
 *
 * Run: node scripts/gen-demo-d2c-dashboard.js
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'lifecycle-usa-d2c-dashboard.html');
const CAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalog/products_us.json'), 'utf8'))
  .filter((p) => p.price && p.n);

// ── Deterministic helpers ───────────────────────────────────────────────────
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function jitter(seedStr, spread) {           // stable multiplier in [1-spread, 1+spread]
  return 1 - spread + (2 * spread) * ((hash(seedStr) % 10000) / 10000);
}
const m2 = (x) => Math.round(x * 100) / 100;

// ── Real catalogue, bucketed into real knickgasm.com collections ────────────
function bucket(p) {
  const t = (p.n + ' ' + (p.type || '') + ' ' + (p.t || []).join(' ')).toLowerCase();
  if (/demon slayer|jujutsu|jujustu|dragon ball|naruto|one piece|anime|goku|luffy|itachi|tanjiro/.test(t)) return 'Custom x Anime';
  if (/manchester|football|soccer|messi|ronaldo|barcelona|madrid|arsenal|chelsea|cr7/.test(t)) return 'Custom x Football';
  if (/gtr|porsche|bmw|ferrari|lamborghini|\bf1\b|nfs|mustang|skyline/.test(t)) return 'Custom x Cars';
  if (/wedding|bride|groom|carnival/.test(t)) return 'Custom x Wedding';
  if (/dog|cat\b|pet|doggo/.test(t)) return 'Custom x Pets';
  if (/bling|crystal|pearl|rhinestone/.test(t)) return 'Custom x Bling';
  if (/game|gaming|mario|minecraft|valorant|gta|spiderman|batman|marvel/.test(t)) return 'Custom x Gaming';
  if (/taylor|eras|concert/.test(t)) return 'Concert Collection';
  if (/lace|care kit|cleaner|crease|tag\b|accessor/.test(t)) return 'Accessories';
  if (/coffee/.test(t)) return 'Custom x Coffee';
  if (/jordan/.test(t)) return 'Custom x Jordans';
  if (/converse/.test(t)) return 'Custom x Converse';
  if (/adidas|samba/.test(t)) return 'Custom x Adidas';
  if (/denim|jacket/.test(t)) return 'Custom x Denim Jacket';
  if (/court vision/.test(t)) return 'Custom x Court Vision';
  return 'Custom x Nike Air Force 1';
}
const COLLECTIONS = [...new Set(CAT.map(bucket))];
const productFor = (key) => CAT[hash(key) % CAT.length];
const collectionFor = (key) => COLLECTIONS[hash(key) % COLLECTIONS.length];

// A string is "brand content" if it looks like a product/category label rather
// than a code, date or metric name.
const FOODY = /tea|chai|coffee|latte|masala|herb|spice|caffein|gluten|gmo|organic|brew|sip|elixir|premix|k[- ]?cup|advent|ceramic|glass|stainless|insulated|loose panel|lace sets|pyramid|sampler|assort|turmeric|matcha|ashwagandha|green sneaker|black sneaker|white sneaker|hightop|bling kicks|themed sneaker|kicks sneaker|streetwear sneaker/i;

function isProductish(s) {
  if (typeof s !== 'string' || s.length < 4) return false;
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return false;      // dates
  if (/^[A-Z0-9'\-]{6,}$/.test(s)) return false;           // sku/asin codes
  return FOODY.test(s) || /\bgift|\bpack\b|\bset\b|variant/i.test(s);
}

// ── Load the existing D ─────────────────────────────────────────────────────
let html = fs.readFileSync(FILE, 'utf8');
const j = html.indexOf('const D={');
if (j < 0) { console.error('const D={ not found'); process.exit(1); }
const st = html.indexOf('{', j);
let depth = 0, end = -1;
for (let p = st; p < html.length; p++) {
  if (html[p] === '{') depth++;
  else if (html[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
}
const D = JSON.parse(html.slice(st, end + 1));

// ── Field-aware value transforms ────────────────────────────────────────────
const MONEY = /^(gross|net|disc|returns|refund|spent|revenue|sales|amz|d2c|msrp|price|aov|spend|value|total_spend|amz_sales|d2c_sales)$/i;
const COUNT = /^(orders|units|lines|new|ret|newcust|sessions|n|total|count|tickets|reviews|subscribers|customers|skus|asins|active|quantity)$/i;

function walk(node, keyPath) {
  if (Array.isArray(node)) return node.map((v, i) => walk(v, keyPath + '[' + i + ']'));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      // Marketplace identifiers: KNICKGASM sells D2C only.
      if (/^asin$/i.test(k)) { out[k] = null; continue; }
      if (/^amz_(name|cat|weight|msrp)$/i.test(k)) { out[k] = null; continue; }
      // Category / product keys get remapped to real collections.
      out[k] = walk(v, k);
    }
    return out;
  }
  if (typeof node === 'string') {
    if (isProductish(node)) {
      // Long labels read as product titles; short ones as collections.
      return node.length > 34 ? productFor(node).n : collectionFor(node);
    }
    return node;
  }
  if (typeof node === 'number') {
    if (MONEY.test(keyPath)) return m2(node * jitter(keyPath + node, 0.34) * 1.9); // custom sneakers cost far more than tea
    if (COUNT.test(keyPath)) return Math.max(0, Math.round(node * jitter(keyPath + node, 0.3) * 0.22)); // far fewer, higher-value orders
    return node;
  }
  return node;
}

let out = walk(D, 'root');

// ── Positional arrays: keyed transforms cannot reach tuple elements ─────────
// t6_products rows are [group, category, product, revenue, units]; rebuild each
// from the real catalogue so no previous-brand label or figure survives.
if (Array.isArray(out.t6_products)) {
  out.t6_products = out.t6_products.map((row, i) => {
    if (!Array.isArray(row) || row.length < 5) return row;
    const p = productFor('t6' + i + (row[2] || ''));
    const coll = bucket(p);
    const units = Math.max(1, Math.round(Number(row[4] || 1) * jitter('t6u' + i, 0.35) * 0.2));
    return [coll.replace(/^Custom x /, ''), coll, p.n, Math.round(units * (parseFloat(p.price) || 150)), units];
  });
}
// SKUs: replace previous-brand warehouse codes with catalogue-derived handles.
function skuFrom(p, i) {
  return 'KG-' + String(p.h || 'item').toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 22) + '-' + String(100 + (i % 900));
}
(function fixSkus(node, i = { n: 0 }) {
  if (Array.isArray(node)) { node.forEach((v) => fixSkus(v, i)); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'sku' && typeof v === 'string') { node[k] = skuFrom(productFor('sku' + v), i.n++); }
      else fixSkus(v, i);
    }
  }
})(out);

// Category rows can collapse onto the same real collection - merge, don't duplicate.
if (Array.isArray(out.category)) {
  const merged = new Map();
  for (const row of out.category) {
    const key = row.type;
    if (!merged.has(key)) merged.set(key, { ...row });
    else {
      const m = merged.get(key);
      for (const f of ['gross', 'net', 'orders']) if (typeof row[f] === 'number') m[f] = m2((m[f] || 0) + row[f]);
    }
  }
  out.category = [...merged.values()].sort((a, b) => (b.net || 0) - (a.net || 0));
}

// ── Object keys that are themselves category labels (category_annual etc.) ──
function remapKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const res = {};
  for (const [k, v] of Object.entries(obj)) {
    res[isProductish(k) || FOODY.test(k) ? collectionFor(k) : k] = v;
  }
  return res;
}
out.category_annual = remapKeys(out.category_annual);

// ── History starts when the brand did (launched 2020-11-04) ─────────────────
const since2021 = (rows, key) => (Array.isArray(rows) ? rows.filter((r) => {
  const y = String((r && (r[key] ?? r.year ?? r.m ?? r.d)) || '').slice(0, 4);
  return !/^\d{4}$/.test(y) || Number(y) >= 2021;
}) : rows);
out.annual = since2021(out.annual, 'year');
out.newret = since2021(out.newret, 'year');
out.cohort = since2021(out.cohort, 'year');
for (const k of Object.keys(out.category_annual || {})) {
  out.category_annual[k] = since2021(out.category_annual[k], 'year');
}

// ── Core commercial series: shape them like THIS brand, not the old one ─────
// Trimming the previous brand's history left its curve (a 2021 peak, then
// decline). KNICKGASM launched 2020-11-04, so the demo shows a young studio
// compounding, at custom-sneaker economics (~$150-165 AOV, hundreds not tens
// of thousands of orders — every pair is hand-painted to order).
const YEAR_ORDERS = { 2021: 385, 2022: 830, 2023: 1460, 2024: 2140, 2025: 2880, 2026: 1960 }; // 2026 = part year (to Jul)
const YEAR_AOV = { 2021: 128, 2022: 136, 2023: 143, 2024: 150, 2025: 156, 2026: 162 };
out.annual = Object.keys(YEAR_ORDERS).map((y) => {
  const orders = YEAR_ORDERS[y], aov = YEAR_AOV[y];
  const gross = m2(orders * aov * (1.07 + 0.02 * jitter('g' + y, 0.5)));
  const disc = m2(-gross * (0.07 + 0.03 * ((hash('d' + y) % 100) / 100)));
  const returns = m2(-gross * (0.012 + 0.008 * ((hash('r' + y) % 100) / 100)));
  return { year: y, orders, gross, disc, returns, net: m2(gross + disc + returns), aov: Math.round(((gross + disc + returns) / orders) * 1000) / 1000 };
});
out.newret = Object.keys(YEAR_ORDERS).map((y) => ({ year: y, new: Math.round(YEAR_ORDERS[y] * 0.66), ret: Math.round(YEAR_ORDERS[y] * 0.27) }));
out.cohort = Object.keys(YEAR_ORDERS).map((y) => {
  const nc = Math.round(YEAR_ORDERS[y] * 0.66);
  return { year: y, newcust: nc, spent: m2(nc * YEAR_AOV[y] * 1.32), orders: Math.round(nc * 1.3) };
});
if (Array.isArray(out.monthly)) {
  out.monthly = out.monthly.map((row) => {
    const y = String(row.m || '').slice(0, 4);
    const base = (YEAR_ORDERS[y] || 2000) / 12;
    const mo = String(row.m || '').slice(5, 7);
    const season = (mo === '11' || mo === '12') ? 1.35 : (mo === '02' ? 1.12 : 1);
    const orders = Math.max(12, Math.round(base * season * jitter('mo' + row.m, 0.22)));
    const aov = (YEAR_AOV[y] || 155) * jitter('ma' + row.m, 0.08);
    const gross = m2(orders * aov * 1.08);
    const disc = m2(-gross * 0.085), returns = m2(-gross * 0.016);
    const net = m2(gross + disc + returns);
    const sessions = Math.round(orders / (0.016 + 0.008 * ((hash('s' + row.m) % 100) / 100)));
    return { ...row, orders, gross, disc, returns, net, sessions, conv: orders / sessions, aov: Math.round((net / orders) * 1000) / 1000, upo: 1.06, refund: m2(returns * 0.9) };
  });
}
if (Array.isArray(out.daily)) {
  out.daily = out.daily.map((row) => {
    const orders = Math.max(1, Math.round(4 + 11 * ((hash('do' + row.d) % 100) / 100)));
    const gross = m2(orders * 158 * jitter('dg' + row.d, 0.16));
    return { ...row, orders, gross, net: m2(gross * 0.9), sessions: Math.round(orders / 0.018) };
  });
}
// Category mix: AF1 customs dominate the real catalogue, so weight it that way.
if (Array.isArray(out.category)) {
  const SHARE = { 'Custom x Nike Air Force 1': 0.40, 'Custom x Anime': 0.15, 'Custom x Football': 0.09, 'Custom x Cars': 0.07, 'Custom x Jordans': 0.06, 'Custom x Gaming': 0.05, 'Custom x Wedding': 0.04, 'Accessories': 0.04, 'Custom x Converse': 0.03, 'Custom x Adidas': 0.03, 'Custom x Pets': 0.02, 'Custom x Bling': 0.02 };
  const netTotal = out.annual.reduce((s, a) => s + a.net, 0);
  const ordTotal = out.annual.reduce((s, a) => s + a.orders, 0);
  out.category = out.category.map((row) => {
    const w = SHARE[row.type] != null ? SHARE[row.type] : 0.008;
    const gross = m2(netTotal * 1.1 * w);
    return { ...row, gross, net: m2(gross * 0.9), orders: Math.max(1, Math.round(ordTotal * w)) };
  }).sort((a, b) => b.net - a.net);
}

// ── Facts KNICKGASM genuinely does not have: state it, never fabricate ──────
const NOTE = 'DEMO SAMPLE DATA - product names, collections and prices are REAL (live knickgasm.com catalogue); all order, revenue, session, cohort and service figures are synthetic, generated by scripts/gen-demo-d2c-dashboard.js. Replace with Shopify admin and Klaviyo exports before deciding anything on them.';
out.footnote = NOTE;
out.our_read = 'DEMO READ. Core Air Force 1 customs carry the business; the themed lines (anime, football, cars) are the growth edge, and accessories are the natural checkout attach. Every commercial figure on this page is synthetic - only the catalogue is real.';
out.as_of = '2026-08-09';
if (out.ratings) { out.ratings.source = 'DATA REQUIRED BEFORE LAUNCH: Judge.me review export (knickgasm.com uses Judge.me; no aggregate is published statically).'; out.ratings.flagship = null; out.ratings.others = null; }
if (out.website_ratings) { out.website_ratings.total_reviews = null; out.website_ratings.wavg = null; }
if (out.amz_compare) { out.amz_compare.source = 'No marketplace channel is connected for KNICKGASM - D2C only. Left empty rather than populated from another brand.'; out.amz_compare.amz_total = 0; out.amz_compare.amz_only = 0; out.amz_compare.on_both = 0; }
if (out.amz_scale) { out.amz_scale.source = 'No marketplace channel connected.'; out.amz_scale.amz_sales = 0; out.amz_scale.amz_units = 0; out.amz_scale.amz_orders = 0; out.amz_scale.amz_top = []; out.amz_scale.both = []; }
if (out.parity) { out.parity.source = 'Single-channel (knickgasm.com D2C). No marketplace prices to compare.'; out.parity.rows = []; out.parity.violations = []; out.parity.n = 0; }
if (out.subs) { out.subs.source = 'KNICKGASM sells made-to-order custom pairs; there is no subscription programme.'; out.subs.monthly = []; out.subs.top_products = []; }
if (out.subs_full) { out.subs_full.source = 'No subscription programme.'; out.subs_full.monthly = []; out.subs_full.top_products = []; out.subs_full.reasons = []; }
if (out.inventory) { out.inventory.source = 'Made to order: pairs are hand-painted per order on blank originals, so there is no finished-goods inventory.'; out.inventory.oos_list = []; }
if (out.delivery) { out.delivery.feed_source = 'Demo. Real dispatch data comes from the studio ops sheet; the published customer promise is a 10-15 day made-to-order window with express worldwide shipping to 60+ countries.'; }
if (out.shipping_config) { out.shipping_config.source = 'knickgasm.com: free India and global shipping, express worldwide (60+ countries).'; out.shipping_config.location = 'Mumbai, India'; }
if (out.cat_stats) { out.cat_stats.source = NOTE; out.cat_stats.active = CAT.length; }
out.gaps = [
  ['1', 'Shopify order export (knickgasm.com)', 'Shopify Admin > Analytics > Reports', 'Critical', 'Pending', 'Drop the real order CSV into input/uploaded_by_anchit/'],
  ['2', 'Klaviyo campaign + flow export', 'Klaviyo > Analytics', 'Critical', 'Pending', 'Replaces the demo engagement series'],
  ['3', 'Verified review corpus', 'Judge.me export', 'High', 'Pending', 'Ratings panels stay empty until this lands'],
  ['4', 'Ad spend by channel', 'Meta + Google Ads', 'High', 'Pending', 'Needed for real CAC and blended ROAS'],
  ['5', 'Made-to-order production times', 'Studio ops sheet', 'Medium', 'Pending', 'Validates the 10-15 day dispatch window'],
  ['6', 'Blank sneaker stock levels', 'Ops', 'Medium', 'Pending', 'Blanks are the real constraint, not finished goods'],
  ['7', 'Remake and returns log', 'Ops', 'Medium', 'Pending', 'Quantify remakes on custom pairs'],
];

html = html.slice(0, st) + JSON.stringify(out) + html.slice(end + 1);
fs.writeFileSync(FILE, html, 'utf8');
console.log(`Transformed D in place: ${CAT.length} real products, ${COLLECTIONS.length} real collections, history trimmed to 2021+, marketplace/subscription panels emptied by design.`);
