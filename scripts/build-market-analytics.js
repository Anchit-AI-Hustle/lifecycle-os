'use strict';
/**
 * scripts/build-market-analytics.js
 * ---------------------------------------------------------------------------
 * Reads the exported US + UK market CSVs under data/market/{us,uk}/ and emits a
 * single self-contained JS module (data/analytics/market-data.js) that sets
 * window.LIFECYCLE_ANALYTICS. The Data Analysis dashboard (data-analysis.html)
 * consumes this global, so the page renders real numbers with no upload and no
 * server round-trip. Re-run this whenever the CSVs change:
 *     node scripts/build-market-analytics.js
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'analytics', 'market-data.js');

// Minimal CSV parser (handles quoted fields + commas inside quotes).
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inStr = false; }
      else field += c;
    } else {
      if (c === '"') inStr = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function readCSVObjects(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return [];
  const rows = parseCSV(fs.readFileSync(p, 'utf8').trim());
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
}
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };

// ── Cohort retention matrix ────────────────────────────────────────────────
// Group by cohort quarter; retention[n] = customers active n quarters after the
// cohort's earliest observed period, normalised to that base. Keep the most
// recent N cohorts with a usable base so the heatmap reads like Shopify's.
function buildCohortMatrix(rel, maxCohorts, maxPeriods) {
  const rows = readCSVObjects(rel);
  const byCohort = {};
  rows.forEach((r) => {
    const q = r['Customer cohort quarter'];
    const since = num(r['Quarters since first purchase']);
    const custs = num(r['Customers']);
    if (!q) return;
    (byCohort[q] = byCohort[q] || {})[since] = custs;
  });
  const cohorts = Object.keys(byCohort).sort();
  const recent = cohorts.slice(-maxCohorts);
  return recent.map((q) => {
    const periods = byCohort[q];
    const keys = Object.keys(periods).map(Number).sort((a, b) => a - b);
    const base = periods[keys[0]] || 1;
    const series = [];
    for (let n = 0; n < maxPeriods; n++) {
      const off = keys[0] + n;
      series.push(periods[off] != null ? Math.round((periods[off] / base) * 1000) / 10 : null);
    }
    return { cohort: q, base, retention: series };
  });
}

function usData() {
  const summary = readCSVObjects('data/market/us/us_market_overall_summary.csv')[0] || {};
  return {
    summary: {
      orders: num(summary['Orders']),
      total_sales: num(summary['Total sales']),
      net_sales: num(summary['Net sales']),
      gross_sales: num(summary['Gross sales']),
      aov: num(summary['Average order value']),
      quantity: num(summary['Quantity ordered']),
      new_customers: num(summary['New customers']),
      returning_customers: num(summary['Returning customers']),
      // Compute returning rate the SAME way as UK — returning / (new + returning)
      // — so the two markets' tiles and thresholds are directly comparable. (The
      // Shopify "Returning customer rate" column uses a different, smaller
      // customer denominator, which made US and UK non-comparable.)
      returning_rate: (num(summary['New customers']) + num(summary['Returning customers'])) ? num(summary['Returning customers']) / (num(summary['New customers']) + num(summary['Returning customers'])) : 0,
    },
    monthly: readCSVObjects('data/market/us/us_monthly_order_revenue_trend.csv').map((r) => ({
      month: r['Month'], orders: num(r['Orders']), sales: num(r['Total sales']), aov: num(r['Average order value']),
    })),
    weekly: readCSVObjects('data/market/us/us_weekly_sales_trend.csv').map((r) => ({
      week: r['Week'], orders: num(r['Orders']), sales: num(r['Total sales']), net: num(r['Net sales']), aov: num(r['Average order value']),
    })),
    aov_trend: readCSVObjects('data/market/us/us_aov_trend_by_month.csv').map((r) => ({
      month: r['Month'], aov: num(r['Average order value']), orders: num(r['Orders']), sales: num(r['Total sales']),
    })),
    channels: readCSVObjects('data/market/us/us_sales_by_sales_channel.csv').map((r) => ({
      channel: r['Sales channel'], orders: num(r['Orders']), sales: num(r['Total sales']), net: num(r['Net sales']), aov: num(r['Average order value']),
    })),
    product_types: readCSVObjects('data/market/us/us_sales_by_product_type.csv').map((r) => ({
      type: r['Product type'], net: num(r['Net sales']), orders: num(r['Orders']), quantity: num(r['Quantity ordered']),
    })),
    discount: readCSVObjects('data/market/us/us_sales_by_discount_usage.csv').map((r) => ({
      discounted: String(r['Is discounted sale']).toLowerCase() === 'true', orders: num(r['Orders']), sales: num(r['Total sales']), net: num(r['Net sales']), aov: num(r['Average order value']),
    })),
    day_of_week: readCSVObjects('data/market/us/us_sales_by_day_of_week.csv').map((r) => ({
      dow: num(r['Day of week']), orders: num(r['Orders']), sales: num(r['Total sales']), net: num(r['Net sales']), aov: num(r['Average order value']),
    })),
    new_vs_returning: readCSVObjects('data/market/us/us_new_vs_returning_customers_by_month.csv').map((r) => ({
      month: r['Month'], new_c: num(r['New customers']), ret_c: num(r['Returning customers']), new_o: num(r['Orders (first-time)']), ret_o: num(r['Orders (returning)']),
    })),
    returning_rate: readCSVObjects('data/market/us/us_returning_customer_rate_by_month.csv').map((r) => ({
      month: r['Month'], rate: num(r['Returning customer rate']), ret_c: num(r['Returning customers']), new_c: num(r['New customers']),
    })),
    acquisition: readCSVObjects('data/market/us/us_customer_acquisition_by_month.csv').map((r) => ({
      month: r['Month'], new_c: num(r['New customers']), orders: num(r['Orders (first-time)']), sales: num(r['Total sales (first-time)']),
    })),
    top_products: readCSVObjects('data/market/us/us_top_50_products_by_net_sales.csv').map((r) => ({
      title: r['Product title'], net: num(r['Net sales']), quantity: num(r['Quantity ordered']), orders: num(r['Orders']),
    })),
    top_by_qty: readCSVObjects('data/market/us/us_top_20_products_by_quantity.csv').map((r) => ({
      title: r['Product title'], net: num(r['Net sales']), quantity: num(r['Quantity ordered']), orders: num(r['Orders']),
    })),
    cohort: buildCohortMatrix('data/market/us/us_customer_cohort_analysis.csv', 8, 8),
  };
}

function ukData() {
  const t = readCSVObjects('data/market/uk/uk_1_market_totals_last_12_months.csv')[0] || {};
  return {
    summary: {
      orders: num(t['Orders']), total_sales: num(t['Total sales']), gross_sales: num(t['Gross sales']),
      net_sales: num(t['Net sales']), aov: num(t['Average order value']), quantity: num(t['Net items sold']),
      new_customers: num(t['New customers']), returning_customers: num(t['Returning customers']),
      returning_rate: (num(t['New customers']) + num(t['Returning customers'])) ? num(t['Returning customers']) / (num(t['New customers']) + num(t['Returning customers'])) : 0,
    },
    monthly: readCSVObjects('data/market/uk/uk_2_monthly_trend.csv').map((r) => ({
      month: r['Month'], orders: num(r['Orders']), sales: num(r['Total sales']), aov: num(r['Average order value']),
    })),
    top_products: readCSVObjects('data/market/uk/uk_3_top_products.csv').map((r) => ({
      title: r['Product title'], net: num(r['Net sales']), gross: num(r['Gross sales']), orders: num(r['Orders']), quantity: num(r['Quantity ordered']),
    })),
    shipping_country: readCSVObjects('data/market/uk/uk_5_sales_by_shipping_country.csv').map((r) => ({
      country: r['Shipping country'] || 'Unknown', orders: num(r['Orders']), sales: num(r['Total sales']),
    })),
    cohort: buildCohortMatrix('data/market/uk/uk_4_customer_cohort_retention.csv', 8, 8),
  };
}

const payload = {
  generated_note: 'Auto-generated by scripts/build-market-analytics.js from data/market/*.csv. Do not edit by hand.',
  currency: { US: 'USD', UK: 'GBP' },
  markets: { US: usData(), UK: ukData() },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const banner = '/* AUTO-GENERATED by scripts/build-market-analytics.js from data/market/*.csv — do not edit by hand. */\n';
fs.writeFileSync(OUT, banner + 'window.LIFECYCLE_ANALYTICS = ' + JSON.stringify(payload) + ';\n');
// Also emit a pure-JSON copy the SERVER can require() (Vercel bundles required
// JSON reliably; a filesystem read of a data/*.csv is not trace-included). This
// is what api/_shared/market-analytics.js reads so KicksGPT answers product /
// revenue / performance questions from the SAME real Shopify-export numbers the
// Data Analysis dashboard shows.
const OUT_JSON = path.join(ROOT, 'data', 'analytics', 'market-data.json');
fs.writeFileSync(OUT_JSON, JSON.stringify(payload));
console.log('Wrote ' + path.relative(ROOT, OUT) + ' (' + fs.statSync(OUT).size + ' bytes)');
console.log('Wrote ' + path.relative(ROOT, OUT_JSON) + ' (' + fs.statSync(OUT_JSON).size + ' bytes)');
console.log('US orders:', payload.markets.US.summary.orders, '| UK orders:', payload.markets.UK.summary.orders);
console.log('US cohorts:', payload.markets.US.cohort.length, '| UK cohorts:', payload.markets.UK.cohort.length);
