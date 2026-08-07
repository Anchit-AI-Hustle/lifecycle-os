#!/usr/bin/env node
'use strict';
/**
 * scripts/gen-demo-analytics.js
 * ---------------------------------------------------------------------------
 * DEMO DATA GENERATOR — deterministic, catalog-grounded sample analytics.
 *
 * The platform shipped without first-party KNICKGASM sales exports (those live
 * in the Shopify admin). Until real exports are dropped into
 * input/uploaded_by_anchit/ and ingested, the Data Analysis surfaces run on the
 * SAMPLE dataset this script emits. Every number is synthetic — derived from
 * the REAL live catalog (data/catalog/products_us.json: titles, prices, tags)
 * through a seeded PRNG, so the demo looks like the actual business (AF1-led
 * mix, custom-sneaker AOV, IN/US/UK split) but is clearly not real history.
 *
 * Regenerate: node scripts/gen-demo-analytics.js  (then build-market-analytics)
 * Replace:    export real CSVs from Shopify admin into data/market/{us,uk}/.
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalog/products_us.json'), 'utf8'));
const CAT_UK = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalog/products_uk.json'), 'utf8'));

// Deterministic PRNG (mulberry32) — same demo data on every run.
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const DEMO_NOTE = 'DEMO SAMPLE DATA — synthetic, generated from the live knickgasm.com catalog by scripts/gen-demo-analytics.js. Not real sales history. Replace with Shopify admin exports.';

// Type mix approximating the real catalog (AF1-led custom sneakers).
function productType(p) {
  const t = (p.type || '').toLowerCase();
  if (t.includes('air force')) return 'Nike Air Force 1 Customs';
  if (t.includes('jordan')) return 'Air Jordan Customs';
  if (t.includes('converse')) return 'Converse Customs';
  if (t.includes('adidas')) return 'Adidas Customs';
  if (t.includes('court')) return 'Court Vision Customs';
  if (t.includes('lace') || t.includes('accessor')) return 'Laces & Accessories';
  if (t.includes('dunk')) return 'Dunk Customs';
  return 'Other Customs';
}

function money(x) { return Math.round(x * 100) / 100; }

function monthly(rand, months, baseOrders, growth, aov, aovJitter) {
  const rows = [];
  for (let i = 0; i < months.length; i++) {
    const season = 1 + 0.25 * Math.sin((i / 12) * 2 * Math.PI + 4.2) + (months[i].slice(5, 7) === '11' || months[i].slice(5, 7) === '12' ? 0.35 : 0); // BFCM/holiday bump
    const orders = Math.max(8, Math.round(baseOrders * Math.pow(1 + growth, i) * season * (0.9 + 0.2 * rand())));
    const a = aov * (1 - aovJitter / 2 + aovJitter * rand());
    rows.push({ month: months[i], orders, aov: money(a), sales: money(orders * a) });
  }
  return rows;
}

function monthsBack(n, endYear, endMonth) {
  const out = [];
  let y = endYear, m = endMonth;
  for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, '0')}-01`); m--; if (m === 0) { m = 12; y--; } }
  return out;
}

function csv(rows) { return rows.map((r) => r.map((v) => (typeof v === 'string' && (v.includes(',') || v.includes('"')) ? `"${v.replace(/"/g, '""')}"` : `"${v}"`).toString()).join(',')).join('\n') + '\n'; }
function csvRaw(header, rows) { return header + '\n' + rows.join('\n') + '\n'; }

// ── US market (24 months to 2026-07) ────────────────────────────────────────
const rUS = rng(20260803);
const mUS = monthsBack(24, 2026, 7);
const trendUS = monthly(rUS, mUS, 120, 0.045, 158, 0.18); // custom-sneaker AOV ~ $150-170
const usDir = path.join(ROOT, 'data/market/us');

const totals = trendUS.reduce((s, r) => ({ orders: s.orders + r.orders, sales: s.sales + r.sales }), { orders: 0, sales: 0 });
const usAOV = money(totals.sales / totals.orders);
const usNew = Math.round(totals.orders * 0.62), usRet = Math.round(totals.orders * 0.24);

fs.writeFileSync(path.join(usDir, 'us_aov_trend_by_month.csv'), csvRaw('"Month","Average order value","Orders","Total sales"', trendUS.map((r) => `"${r.month}",${r.aov},${r.orders},${r.sales}`)));
fs.writeFileSync(path.join(usDir, 'us_monthly_order_revenue_trend.csv'), csvRaw('"Month","Orders","Total sales","Average order value"', trendUS.map((r) => `"${r.month}",${r.orders},${r.sales},${r.aov}`)));
fs.writeFileSync(path.join(usDir, 'us_market_overall_summary.csv'), csvRaw('"Orders","Total sales","Net sales","Gross sales","Average order value","Quantity ordered","New customers","Returning customers","Returning customer rate"', [`${totals.orders},${money(totals.sales)},${money(totals.sales * 0.94)},${money(totals.sales * 1.07)},${usAOV},${Math.round(totals.orders * 1.18)},${usNew},${usRet},${money(usRet / (usNew + usRet))}`]));
fs.writeFileSync(path.join(usDir, 'us_customer_acquisition_by_month.csv'), csvRaw('"Month","New customers","Orders (first-time)","Total sales (first-time)"', trendUS.map((r) => { const n = Math.round(r.orders * 0.62); return `"${r.month}",${n},${n},${money(n * r.aov)}`; })));
fs.writeFileSync(path.join(usDir, 'us_new_vs_returning_customers_by_month.csv'), csvRaw('"Month","New customers","Returning customers","Orders (first-time)","Orders (returning)"', trendUS.map((r) => { const n = Math.round(r.orders * 0.62), q = Math.round(r.orders * 0.24); return `"${r.month}",${n},${q},${n},${r.orders - n}`; })));
fs.writeFileSync(path.join(usDir, 'us_returning_customer_rate_by_month.csv'), csvRaw('"Month","Returning customer rate","Returning customers","New customers"', trendUS.map((r) => { const n = Math.round(r.orders * 0.62), q = Math.round(r.orders * 0.24); return `"${r.month}",${money(q / (q + n))},${q},${n}`; })));

// Day-of-week + discount + channel
const dowW = [0.16, 0.12, 0.12, 0.13, 0.14, 0.16, 0.17];
fs.writeFileSync(path.join(usDir, 'us_sales_by_day_of_week.csv'), csvRaw('"Day of week","Orders","Total sales","Net sales","Average order value"', dowW.map((w, d) => { const o = Math.round(totals.orders * w); const s = money(totals.sales * w); return `${d},${o},${s},${money(s * 0.94)},${money(s / o)}`; })));
fs.writeFileSync(path.join(usDir, 'us_sales_by_discount_usage.csv'), csvRaw('"Is discounted sale","Orders","Total sales","Net sales","Average order value"', [ `false,${Math.round(totals.orders * 0.71)},${money(totals.sales * 0.74)},${money(totals.sales * 0.74 * 0.94)},${money((totals.sales * 0.74) / (totals.orders * 0.71))}`, `true,${Math.round(totals.orders * 0.29)},${money(totals.sales * 0.26)},${money(totals.sales * 0.26 * 0.94)},${money((totals.sales * 0.26) / (totals.orders * 0.29))}` ]));
fs.writeFileSync(path.join(usDir, 'us_sales_by_sales_channel.csv'), csvRaw('"Sales channel","Orders","Total sales","Net sales","Average order value"', [ `"Online Store",${Math.round(totals.orders * 0.86)},${money(totals.sales * 0.87)},${money(totals.sales * 0.87 * 0.94)},${usAOV}`, `"Instagram",${Math.round(totals.orders * 0.11)},${money(totals.sales * 0.10)},${money(totals.sales * 0.10 * 0.94)},${money(usAOV * 0.92)}`, `"WhatsApp Concierge",${Math.round(totals.orders * 0.03)},${money(totals.sales * 0.03)},${money(totals.sales * 0.03 * 0.94)},${money(usAOV * 1.1)}` ]));

// Product type + top products from the REAL catalog
const byType = {};
for (const p of CAT) { const t = productType(p); (byType[t] = byType[t] || []).push(p); }
const typeShare = { 'Nike Air Force 1 Customs': 0.55, 'Air Jordan Customs': 0.12, 'Converse Customs': 0.07, 'Adidas Customs': 0.07, 'Court Vision Customs': 0.04, 'Dunk Customs': 0.03, 'Laces & Accessories': 0.08, 'Other Customs': 0.04 };
fs.writeFileSync(path.join(usDir, 'us_sales_by_product_type.csv'), csvRaw('"Product type","Net sales","Orders","Quantity ordered"', Object.entries(typeShare).filter(([t]) => byType[t] && byType[t].length).map(([t, w]) => { const s = money(totals.sales * 0.94 * w); const o = Math.round(totals.orders * w); return `"${t}",${s},${o},${Math.round(o * 1.12)}`; })));

const rTop = rng(436436);
const weighted = CAT.filter((p) => p.price).map((p) => ({ p, w: (productType(p) === 'Nike Air Force 1 Customs' ? 2.2 : 1) * (0.4 + rTop()) }));
weighted.sort((a, b) => b.w - a.w);
function topRows(n) { let rem = totals.sales * 0.94 * 0.6; return weighted.slice(0, n).map(({ p }, i) => { const share = 0.6 / n + (n - i) * (0.8 / (n * n)); const s = money(totals.sales * 0.94 * 0.6 * share); const qty = Math.max(3, Math.round(s / parseFloat(p.price || usAOV))); return { title: p.n.replace(/"/g, "'"), s, qty, o: Math.max(3, Math.round(qty * 0.96)) }; }); }
fs.writeFileSync(path.join(usDir, 'us_top_20_products_by_net_sales.csv'), csvRaw('"Product title","Net sales","Quantity ordered","Orders"', topRows(20).map((r) => `"${r.title}",${r.s},${r.qty},${r.o}`)));
fs.writeFileSync(path.join(usDir, 'us_top_20_products_by_quantity.csv'), csvRaw('"Product title","Quantity ordered","Net sales","Orders"', topRows(20).sort((a, b) => b.qty - a.qty).map((r) => `"${r.title}",${r.qty},${r.s},${r.o}`)));
fs.writeFileSync(path.join(usDir, 'us_top_50_products_by_net_sales.csv'), csvRaw('"Product title","Net sales","Quantity ordered","Orders"', topRows(50).map((r) => `"${r.title}",${r.s},${r.qty},${r.o}`)));

// Weekly trend (last 26 weeks) + cohort analysis (8 quarters)
const rW = rng(777); const weeks = [];
for (let i = 25; i >= 0; i--) { const d = new Date(Date.UTC(2026, 6, 27) - i * 7 * 864e5); const wOrders = Math.round((totals.orders / 104) * (0.75 + 0.5 * rW())); const wS = money(wOrders * usAOV * (0.9 + 0.2 * rW())); weeks.push(`"${d.toISOString().slice(0, 10)}",${wOrders},${wS},${money(wS / wOrders)}`); }
fs.writeFileSync(path.join(usDir, 'us_weekly_sales_trend.csv'), csvRaw('"Week","Orders","Total sales","Average order value"', weeks));
const rC = rng(888); const cohortRows = [];
for (let q = 0; q < 8; q++) { const y = 2024 + Math.floor((6 + q) / 4); const qm = ((6 + q) % 4) * 3 + 1; const cohortCust = Math.round(220 * Math.pow(1.14, q) * (0.85 + 0.3 * rC())); for (let since = 0; since < 8 - q; since++) { const retained = Math.round(cohortCust * (since === 0 ? 1 : 0.16 * Math.pow(0.82, since - 1))); if (!retained) continue; const orders = Math.round(retained * (since === 0 ? 1 : 1.25)); cohortRows.push(`"${y}-${String(qm).padStart(2, '0')}-01",${since},${retained},${orders},${money(orders * usAOV * (0.92 + 0.16 * rC()))}`); } }
fs.writeFileSync(path.join(usDir, 'us_customer_cohort_analysis.csv'), csvRaw('"Customer cohort quarter","Quarters since first purchase","Customers","Orders","Net sales"', cohortRows));

// ── UK market (12 months, GBP, ~30% of US volume) ───────────────────────────
const rUK = rng(20260804);
const mUK = monthsBack(12, 2026, 7);
const trendUK = monthly(rUK, mUK, 34, 0.05, 132, 0.16); // GBP AOV
const ukDir = path.join(ROOT, 'data/market/uk');
const tUK = trendUK.reduce((s, r) => ({ orders: s.orders + r.orders, sales: s.sales + r.sales }), { orders: 0, sales: 0 });
fs.writeFileSync(path.join(ukDir, 'uk_1_market_totals_last_12_months.csv'), csvRaw('"Orders","Total sales","Net sales","Average order value","New customers","Returning customer rate"', [`${tUK.orders},${money(tUK.sales)},${money(tUK.sales * 0.94)},${money(tUK.sales / tUK.orders)},${Math.round(tUK.orders * 0.66)},${money(0.21)}`]));
fs.writeFileSync(path.join(ukDir, 'uk_2_monthly_trend.csv'), csvRaw('"Month","Orders","Total sales","Average order value"', trendUK.map((r) => `"${r.month}",${r.orders},${r.sales},${r.aov}`)));
const rTopUK = rng(101010);
const ukWeighted = CAT_UK.filter((p) => p.price).map((p) => ({ p, w: (productType(p) === 'Nike Air Force 1 Customs' ? 2 : 1) * (0.4 + rTopUK()) })).sort((a, b) => b.w - a.w).slice(0, 15);
fs.writeFileSync(path.join(ukDir, 'uk_3_top_products.csv'), csvRaw('"Product title","Net sales","Quantity ordered"', ukWeighted.map(({ p }, i) => { const s = money(tUK.sales * 0.94 * (0.14 - i * 0.007)); return `"${p.n.replace(/"/g, "'")}",${s},${Math.max(2, Math.round(s / parseFloat(p.price)))}`; })));
const rCU = rng(999); const ukCoh = [];
for (let q = 0; q < 4; q++) { const y = 2025 + Math.floor((2 + q) / 4); const qm = ((2 + q) % 4) * 3 + 1; const c = Math.round(70 * Math.pow(1.2, q) * (0.9 + 0.2 * rCU())); for (let s = 0; s < 4 - q; s++) { const kept = Math.round(c * (s === 0 ? 1 : 0.14 * Math.pow(0.8, s - 1))); if (kept) ukCoh.push(`"${y}-${String(qm).padStart(2, '0')}-01",${s},${kept},${money(kept * 130 * (s === 0 ? 1 : 1.2))}`); } }
fs.writeFileSync(path.join(ukDir, 'uk_4_customer_cohort_retention.csv'), csvRaw('"Customer cohort quarter","Quarters since first purchase","Customers","Net sales"', ukCoh));
fs.writeFileSync(path.join(ukDir, 'uk_5_sales_by_shipping_country.csv'), csvRaw('"Shipping country","Orders","Total sales","Net sales"', [ `"United Kingdom",${Math.round(tUK.orders * 0.88)},${money(tUK.sales * 0.88)},${money(tUK.sales * 0.88 * 0.94)}`, `"Ireland",${Math.round(tUK.orders * 0.07)},${money(tUK.sales * 0.07)},${money(tUK.sales * 0.07 * 0.94)}`, `"Netherlands",${Math.round(tUK.orders * 0.05)},${money(tUK.sales * 0.05)},${money(tUK.sales * 0.05 * 0.94)}` ]));

// ── README + demo-flagged JSON surfaces ─────────────────────────────────────
fs.writeFileSync(path.join(ROOT, 'data/market/README.md'), `# data/market — DEMO SAMPLE DATA\n\n${DEMO_NOTE}\n\nThe real numbers come from Shopify admin exports (Analytics → Reports) dropped\ninto these folders with the same filenames, or via input/uploaded_by_anchit/ +\nthe ingest pipeline. knickgasm-verified-metrics.md in this folder is the only\nfile here containing REAL sourced figures.\n`);

const inrRate = 87.5;
fs.writeFileSync(path.join(ROOT, 'data/analytics/live-shopify.json'), JSON.stringify({
  generated_note: DEMO_NOTE,
  source: 'scripts/gen-demo-analytics.js (seeded synthetic; catalog prices are REAL from knickgasm.com)',
  pulled_at: '2026-08-03T00:00:00Z',
  markets: {
    US: { currency: 'USD', orders_12m: Math.round(totals.orders / 2), sales_12m: money(totals.sales / 2), aov: usAOV, top_type: 'Nike Air Force 1 Customs' },
    UK: { currency: 'GBP', orders_12m: tUK.orders, sales_12m: money(tUK.sales), aov: money(tUK.sales / tUK.orders), top_type: 'Nike Air Force 1 Customs' },
    IN: { currency: 'INR', note: 'Primary market. DEMO scaling: ~4x US order volume at INR list prices.', orders_12m: Math.round((totals.orders / 2) * 4), aov: money(usAOV * inrRate) },
  },
}, null, 2));

const yr = (mult, aovM) => ({ orders: Math.round((totals.orders / 2) * mult), sales: money((totals.sales / 2) * mult * aovM) });
fs.writeFileSync(path.join(ROOT, 'data/analytics/usa-d2c-report-2026-07-13.json'), JSON.stringify({
  _note: DEMO_NOTE + ' Shapes preserved for the USA D2C dashboard.',
  source: 'scripts/gen-demo-analytics.js',
  all_time: { orders: totals.orders, total_sales: money(totals.sales), aov: usAOV, first_order: '2024-08-01' },
  yearly: { '2024': yr(0.18, 0.94), '2025': yr(0.95, 0.99), '2026_ytd': yr(0.87, 1.04) },
  ytd_2025_vs_2026: { orders_growth_pct: 32.4, sales_growth_pct: 41.2, aov_growth_pct: 6.6 },
  top_products_h1_2026: topRows(10).map((r) => ({ title: r.title, net_sales: r.s, orders: r.o })),
  top_products_h1_2025: topRows(10).slice(2).map((r) => ({ title: r.title, net_sales: money(r.s * 0.7), orders: Math.round(r.o * 0.7) })),
  rs_100cr_bridge: { _note: 'DEMO planning scaffold: path from current demo run-rate to Rs 100 Cr GMV. Recompute with real exports.', current_annual_gmv_inr_cr: money(((totals.sales / 2) * 5 * inrRate) / 1e7), target_gmv_inr_cr: 100 },
  data_caveats: ['Synthetic demo dataset', 'Catalog titles/prices are real (knickgasm.com)', 'Replace via Shopify admin exports'],
}, null, 2));

fs.writeFileSync(path.join(ROOT, 'data/cohort-sizes.json'), JSON.stringify({
  _note: 'DEMO SAMPLE cohort sizing — synthetic scaffold generated from the demo dataset (scripts/gen-demo-analytics.js). NOT real KNICKGASM customer counts: real sizes come from Shopify/Klaviyo exports via the ingest pipeline. [DATA REQUIRED BEFORE LAUNCH: real cohort sizes, all segments, per region]',
  pulled: '2026-08-03 (synthetic)',
  base_total_est: usNew + usRet + Math.round(tUK.orders * 0.7),
  store: 'knickgasm.com',
  cohorts: {
    Champions: { size: Math.round((usNew + usRet) * 0.06), definition: 'R5F5M5 — repeat custom buyers, 90d active' },
    'Loyal Customers': { size: Math.round((usNew + usRet) * 0.11), definition: 'F>=3 or M top-quintile' },
    'Potential Loyalist': { size: Math.round((usNew + usRet) * 0.15), definition: '2nd order within 60d window' },
    'New Customers': { size: Math.round((usNew + usRet) * 0.24), definition: 'first order <=30d' },
    Promising: { size: Math.round((usNew + usRet) * 0.12), definition: 'first order 31-90d, engaged' },
    'Need Attention': { size: Math.round((usNew + usRet) * 0.10), definition: 'slipping recency, mid F/M' },
    'About to Sleep': { size: Math.round((usNew + usRet) * 0.09), definition: 'R low, last order 90-180d' },
    'At Risk': { size: Math.round((usNew + usRet) * 0.08), definition: 'high M historic, R very low' },
    Hibernating: { size: Math.round((usNew + usRet) * 0.05), definition: '>180d inactive' },
  },
}, null, 2));

console.log(`DEMO analytics generated: US ${totals.orders} orders / $${money(totals.sales)} · UK ${tUK.orders} orders / £${money(tUK.sales)} · AOV $${usAOV}`);
