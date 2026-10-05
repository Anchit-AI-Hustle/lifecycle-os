// Replenishment: when will this customer buy this again, MEASURED, not assumed.
//
// The roadmap's example assumed a consumption rate ("1.5 cups a day"). A rate
// and a pack size are product facts, and this repo does not invent them. The
// model reads the brand's own order history instead: the inter-purchase
// interval per product (median, p25, p75, n), each customer's own cadence
// shrunk toward it, quantity only when the order states it AND the data shows
// it matters, and a backtest that ships the naive baseline whenever the model
// cannot beat it.
//
// Every test here RUNS the module, the planner or the adapter. Histories are
// synthetic with KNOWN intervals, so each expected number is computed in this
// file from first principles and compared with what the module produced.
//
// Run: npx playwright test tests/replenishment-model.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RM = require(path.join(ROOT, 'api', '_shared', 'replenishment-model.js'));
const CE = require(path.join(ROOT, 'api', '_shared', 'cohort-engine.js'));
const GR = require(path.join(ROOT, 'api', '_shared', 'calendar-guardrails.js'));
const svc = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const { FakeSupabase, SERVICE_KEY, BASE, envScope } = require('./lib/fake-supabase.js');

const D0 = RM.dayOf('2025-01-01');

/* ── fixtures ─────────────────────────────────────────────────────────────── */

/** A canonical order line (what every reader produces). */
function L(customer, day, { sku = 'SKU-A', type = 'Type A', qty = null, market = 'US', title = null } = {}) {
  return { customer_id: customer, order_id: `${customer}#${day}#${sku}`, day, sku, product_type: type, quantity: qty, market, title: title || `${sku} title` };
}
function hist(lines) { return RM.history('test', { lines, dropped: {} }); }

/** Type-7 quantile, written out here so the module is checked, not echoed. */
function q7(values, p) {
  const s = values.slice().sort((a, b) => a - b);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 41 customers, each two purchases of SKU-A, intervals exactly 20..60 days. */
function exactLines() {
  const out = [];
  for (let i = 0; i <= 40; i++) {
    const c = `exact-${i}`;
    out.push(L(c, D0 + i), L(c, D0 + i + 20 + i));
  }
  return out;
}

/* ═══ 1. the distribution is the data's, and a thin product says so ═════════ */

test('a product distribution is exactly the observed intervals: median, p25, p75 and n', () => {
  // A split basket - a second order the same day - is one purchase occasion,
  // not a 0-day repurchase that would drag every median toward zero.
  const lines = exactLines().concat([Object.assign(L('exact-0', D0), { order_id: 'split-basket' })]);
  const model = RM.fitAll(lines, RM.MIN_REPEAT_CUSTOMERS);
  const fit = model.fits.get('US|sku|SKU-A');
  expect(fit.state).toBe('ok');
  // Intervals 20..60, 41 of them: type-7 quartiles land on whole days.
  expect(fit.distribution).toMatchObject({ n: 41, median: 40, p25: 30, p75: 50, min: 20, max: 60 });
  expect(fit.n_customers).toBe(41);
  expect(fit.n_intervals).toBe(41);
  // The type key sees the same purchases.
  expect(model.fits.get('US|type|type a').distribution).toMatchObject({ median: 40, p25: 30, p75: 50 });
  // The minimum is stated once and is what the module enforces.
  expect(RM.MIN_REPEAT_CUSTOMERS).toBe(30);
});

test('below the minimum sample a product reports insufficient_history WITH its count, and no interval is guessed', () => {
  const lines = exactLines();
  // 29 customers bought Rare twice, 5 more bought it once.
  for (let i = 0; i < 29; i++) lines.push(L(`rare-${i}`, D0 + i, { sku: 'R-1', type: 'Rare' }), L(`rare-${i}`, D0 + i + 45, { sku: 'R-1', type: 'Rare' }));
  for (let i = 0; i < 5; i++) lines.push(L(`rare1-${i}`, D0 + 100 + i, { sku: 'R-1', type: 'Rare' }));
  const a = RM.analyse(hist(lines));
  const rare = a.products.find((p) => p.key === 'US|type|rare');
  expect(rare.state).toBe('insufficient_history');
  expect(rare.n_customers).toBe(29);
  expect(rare.buyers).toBe(34);
  expect(rare.distribution).toBeUndefined();
  expect(rare.reason).toContain('29 customer(s)');
  expect(rare.reason).toContain('30 are needed');
  // Nobody who bought Rare is predicted from anything - not from Type A, not from a default.
  expect(a.predictions.filter((p) => /^rare/.test(p.customer_id))).toEqual([]);
  expect(a.counts.customers_unpredictable).toBe(34);
  // And a history where NOTHING clears the bar plans nothing.
  const thin = RM.analyse(hist(lines.filter((l) => /^rare/.test(l.customer_id))));
  expect(thin.state).toBe('insufficient_history');
  expect(thin.predictions).toEqual([]);
});

test('a SKU with too few repeat buyers falls back to its product type; one with enough uses its own', () => {
  const lines = [];
  for (let i = 0; i < 35; i++) lines.push(L(`big-${i}`, D0 + i, { sku: 'K-big', type: 'Kicks' }), L(`big-${i}`, D0 + i + 30, { sku: 'K-big', type: 'Kicks' }));
  for (let i = 0; i < 3; i++) lines.push(L(`small-${i}`, D0 + i, { sku: 'K-small', type: 'Kicks' }), L(`small-${i}`, D0 + i + 90, { sku: 'K-small', type: 'Kicks' }));
  const { predictions } = RM.predictAll(RM.fitAll(lines, 30), 'baseline');
  const big = predictions.find((p) => p.customer_id === 'big-0');
  const small = predictions.find((p) => p.customer_id === 'small-0');
  expect(big).toMatchObject({ level: 'sku', key: 'US|sku|K-big' });
  expect(small).toMatchObject({ level: 'type', key: 'US|type|kicks' });
  // One prediction per customer per product group, never one per level.
  expect(predictions.filter((p) => p.customer_id === 'small-0')).toHaveLength(1);
});

test('an interval measured in one market is never applied to another', () => {
  const lines = exactLines();
  // A UK buyer of the same SKU, with no UK history to speak of.
  lines.push(L('uk-1', D0 + 10, { market: 'UK' }), L('uk-1', D0 + 40, { market: 'UK' }));
  const a = RM.analyse(hist(lines));
  expect(a.products.find((p) => p.key === 'UK|type|type a').state).toBe('insufficient_history');
  expect(a.predictions.find((p) => p.customer_id === 'uk-1')).toBeUndefined();
});

/* ═══ 2. per-customer shrinkage is the stated rule, executed ════════════════ */

/** 60 customers who genuinely differ: 30 buy every ~10 days, 30 every ~90. */
function cadenceLines() {
  const out = [];
  const jit = [0, 1, -1];
  for (let i = 0; i < 60; i++) {
    const c = `cad-${i}`;
    const base = i < 30 ? 9 + (i % 3) : 85 + (i % 7);
    let d = D0 + i;
    out.push(L(c, d, { sku: 'S-1', type: 'Staple' }));
    for (let j = 0; j < 3; j++) { d += base + jit[(i + j) % 3]; out.push(L(c, d, { sku: 'S-1', type: 'Staple' })); }
  }
  return out;
}

test('shrinkage follows the stated empirical-Bayes rule exactly', () => {
  const lines = cadenceLines();
  const model = RM.fitAll(lines, 30);
  const fit = model.fits.get('US|sku|S-1');
  // Recompute everything from the raw lines, independently.
  const byC = new Map();
  for (const l of lines) { if (!byC.has(l.customer_id)) byC.set(l.customer_id, []); byC.get(l.customer_id).push(l.day); }
  const logs = [];
  const all = [];
  for (const days of byC.values()) {
    days.sort((a, b) => a - b);
    const iv = days.slice(1).map((d, i) => d - days[i]);
    all.push(...iv);
    logs.push(iv.map(Math.log));
  }
  let ss = 0; let df = 0;
  for (const ys of logs) { const m = avg(ys); for (const y of ys) ss += (y - m) ** 2; df += ys.length - 1; }
  const sigma2 = ss / df;
  const means = logs.map(avg);
  const mm = avg(means);
  const varMeans = means.reduce((s, x) => s + (x - mm) ** 2, 0) / (means.length - 1);
  const tau2 = Math.max(0, varMeans - sigma2 * avg(logs.map((ys) => 1 / ys.length)));
  const w3 = tau2 / (tau2 + sigma2 / 3);
  const med = q7(all, 0.5);

  expect(tau2).toBeGreaterThan(0.5);                    // these customers really do differ
  expect(fit.shrinkage.status).toBe('estimated');
  expect(fit.shrinkage.sigma2_within).toBeCloseTo(sigma2, 3);
  expect(fit.shrinkage.tau2_between).toBeCloseTo(tau2, 3);
  expect(fit.shrinkage.weight_at['3']).toBeCloseTo(w3, 3);

  const { predictions } = RM.predictAll(model, 'model');
  for (const id of ['cad-0', 'cad-45']) {
    const ys = logs[[...byC.keys()].indexOf(id)];
    const expected = Math.exp(w3 * avg(ys) + (1 - w3) * Math.log(med));
    const p = predictions.find((x) => x.customer_id === id);
    expect(p.weight).toBeCloseTo(w3, 3);
    expect(p.interval_days).toBeCloseTo(expected, 1);
  }
  // The baseline ignores the customer entirely.
  const base = RM.predictAll(model, 'baseline').predictions.find((x) => x.customer_id === 'cad-45');
  expect(base.interval_days).toBe(fit.distribution.median);
});

test('when customers do not differ (tau2 = 0) the model gives everyone the product median', () => {
  // Every customer has intervals {30, 60, 90} in a different order: identical cadence.
  const orders = [[30, 60, 90], [60, 90, 30], [90, 30, 60]];
  const lines = [];
  for (let i = 0; i < 45; i++) {
    let d = D0 + i;
    lines.push(L(`iid-${i}`, d));
    for (const g of orders[i % 3]) { d += g; lines.push(L(`iid-${i}`, d)); }
  }
  const model = RM.fitAll(lines, 30);
  const fit = model.fits.get('US|sku|SKU-A');
  expect(fit.shrinkage.tau2_between).toBe(0);
  for (const p of RM.predictAll(model, 'model').predictions) {
    expect(p.weight).toBe(0);
    expect(p.interval_days).toBe(60);
  }
});

/* ═══ 3. quantity: tested on the data, never assumed ════════════════════════ */

/** 60 customers alternating 1 and 2 units; `after2` = the wait multiplier after 2 units. */
function qtyLines(after2, { stated = true } = {}) {
  const out = [];
  for (let i = 0; i < 60; i++) {
    let d = D0 + i;
    for (let j = 0; j < 4; j++) {
      const q = j % 2 === 0 ? 1 : 2;
      out.push(L(`q-${i}`, d, { qty: stated ? q : null }));
      const base = 25 + ((i * 7 + j * 3) % 11);
      d += q === 2 ? Math.round(base * after2) : base;
    }
  }
  return out;
}

test('quantity scales the wait only when the measured ratio supports proportional scaling', () => {
  const fit = RM.fitAll(qtyLines(2), 30).fits.get('US|sku|SKU-A');
  expect(fit.quantity.status).toBe('proportional');
  expect(fit.quantity.ratio_ci95[0]).toBeGreaterThan(1);
  expect(fit.quantity.ratio_ci95[0]).toBeLessThanOrEqual(fit.quantity.mean_multi_quantity);
  expect(fit.quantity.ratio_ci95[1]).toBeGreaterThanOrEqual(fit.quantity.mean_multi_quantity);
  // A customer whose last purchase was 2 units waits ~2x one whose last was 1.
  const lines = qtyLines(2);
  lines.push(L('last1', D0 + 400, { qty: 1 }), L('last2', D0 + 400, { qty: 2 }));
  const preds = RM.predictAll(RM.fitAll(lines, 30), 'model').predictions;
  const p1 = preds.find((p) => p.customer_id === 'last1');
  const p2 = preds.find((p) => p.customer_id === 'last2');
  expect(p2.interval_days / p1.interval_days).toBeCloseTo(2, 1);
});

test('quantity that does not change the wait is ignored, and a quantity nobody stated is never assumed', () => {
  const none = RM.fitAll(qtyLines(1), 30).fits.get('US|sku|SKU-A');
  expect(none.quantity.status).toBe('no_effect');
  expect(none.quantity.ratio_ci95[0]).toBeLessThanOrEqual(1);
  expect(none.quantity.ratio_ci95[1]).toBeGreaterThanOrEqual(1);
  expect(none.normalised_distribution).toBeNull();

  const unstated = RM.fitAll(qtyLines(2, { stated: false }), 30).fits.get('US|sku|SKU-A');
  expect(unstated.quantity.status).toBe('not_stated');
  const lines = qtyLines(2, { stated: false });
  lines.push(L('nq', D0 + 400));
  const p = RM.predictAll(RM.fitAll(lines, 30), 'model').predictions.find((x) => x.customer_id === 'nq');
  expect(p.interval_days).toBe(unstated.distribution.median);
});

test('a real but non-proportional quantity effect uses the MEASURED ratio, nothing extrapolated', () => {
  const fit = RM.fitAll(qtyLines(1.4), 30).fits.get('US|sku|SKU-A');
  expect(fit.quantity.status).toBe('non_proportional');
  expect(fit.quantity.ratio).toBeGreaterThan(1.25);
  expect(fit.quantity.ratio).toBeLessThan(1.55);
  const lines = qtyLines(1.4);
  lines.push(L('n1', D0 + 400, { qty: 1 }), L('n2', D0 + 400, { qty: 2 }));
  const preds = RM.predictAll(RM.fitAll(lines, 30), 'model').predictions;
  const r = preds.find((p) => p.customer_id === 'n2').interval_days / preds.find((p) => p.customer_id === 'n1').interval_days;
  expect(r).toBeCloseTo(fit.quantity.ratio, 1);
});

/* ═══ 4. trigger and lapse dates, and who is due ═════════════════════════════ */

test('trigger = last purchase + p25, lapse = + p75, next = + median, and due windows follow from them', () => {
  const lines = exactLines();                     // p25 30, median 40, p75 50
  const S = D0 + 400;
  lines.push(L('due-now', S - 35));               // trigger S-5 (passed), lapse S+15: due, sent on S
  lines.push(L('due-later', S - 10));             // trigger S+20: due, sent on S+20
  lines.push(L('lapsed', S - 60));                // lapse S-10: past its window
  lines.push(L('not-yet', S));                    // trigger S+30, outside a 30-day plan
  // A repeat buyer of ANOTHER SKU in the same type (so SKU-A's distribution stays
  // exact): predicted from the type, own interval 40, trigger ~S-10, lapse ~S+10.
  lines.push(L('repeat', S - 80, { sku: 'SKU-B' }), L('repeat', S - 40, { sku: 'SKU-B' }));
  const a = RM.analyse(hist(lines));
  const by = (id) => a.predictions.find((p) => p.customer_id === id);
  expect(by('due-now')).toMatchObject({ last_day: S - 35, next_day: S + 5, trigger_day: S - 5, lapse_day: S + 15, interval_days: 40, total_orders: 1 });
  expect(by('due-later')).toMatchObject({ trigger_day: S + 20, next_day: S + 30 });

  const due = RM.dueBuckets(a, { startDate: RM.isoOf(S), days: 30, markets: ['US'] });
  const ids = (cohort) => due.buckets.filter((b) => b.cohort === cohort).flatMap((b) => b.customer_ids);
  expect(ids('second_order')).toEqual(expect.arrayContaining(['due-now', 'due-later']));
  expect(ids('second_order')).not.toContain('lapsed');
  expect(ids('second_order')).not.toContain('not-yet');
  expect(ids('repeat')).toEqual(['repeat']);
  expect(due.counts.lapsed).toBeGreaterThanOrEqual(1);
  expect(due.counts.not_yet).toBeGreaterThanOrEqual(1);
  // Nobody in a bucket is mailed after their own trigger.
  const later = due.buckets.find((b) => b.customer_ids.includes('due-later'));
  expect(later.send_date).toBe(RM.isoOf(S + 20));
  expect(due.buckets.find((b) => b.customer_ids.includes('due-now')).send_date).toBe(RM.isoOf(S));
  // The bucket names the product, its n, its interval and its lead time.
  const ev = later.products[0];
  expect(ev).toMatchObject({ key: 'US|sku|SKU-A', n_customers: 41, median_days: 40, p25_days: 30, p75_days: 50 });
  expect(ev.lead).toMatchObject({ trigger_quantile: 0.25, trigger_fraction: 0.75, lead_days_at_median: 10 });
  expect(ev.lead.reasoning).toContain('a quarter of this product');
  // A market the plan does not cover is counted, not planned.
  const uk = RM.dueBuckets(a, { startDate: RM.isoOf(S), days: 30, markets: ['UK'] });
  expect(uk.buckets).toEqual([]);
  expect(uk.counts.out_of_market).toBeGreaterThan(0);
});

/* ═══ 5. the backtest decides, honestly ═════════════════════════════════════ */

/** Customers with stable, very different cadences over ~two years. */
function backtestLines() {
  const out = [];
  for (let i = 0; i < 80; i++) {
    const cad = i < 40 ? 12 + (i % 8) : 80 + (i % 16);
    for (let d = D0 + (i % 23), j = 0; d <= D0 + 720; d += cad + ((j++ % 3) - 1)) out.push(L(`bt-${i}`, d, { sku: 'B-1', type: 'Bt' }));
  }
  return out;
}

test('the backtest scores the baseline exactly as defined, recomputed here from the raw lines', () => {
  const lines = backtestLines();
  const bt = RM.backtest(lines, { holdoutWeeks: 26 });
  const lastDay = Math.max(...lines.map((l) => l.day));
  const cutoff = lastDay - 26 * 7;
  expect(bt.cutoff).toBe(RM.isoOf(cutoff));
  // Independent baseline: training median for everyone.
  const train = lines.filter((l) => l.day <= cutoff);
  const byC = new Map();
  for (const l of train) { if (!byC.has(l.customer_id)) byC.set(l.customer_id, new Set()); byC.get(l.customer_id).add(l.day); }
  const ivs = [];
  for (const s of byC.values()) { const d = [...s].sort((a, b) => a - b); for (let i = 1; i < d.length; i++) ivs.push(d[i] - d[i - 1]); }
  const med = Math.round(q7(ivs, 0.5) * 10) / 10;
  const p25 = Math.round(q7(ivs, 0.25) * 10) / 10;
  const p75 = Math.round(q7(ivs, 0.75) * 10) / 10;
  const errs = []; let triggered = 0; let hits = 0;
  for (const [c, s] of byC) {
    const last = Math.max(...s);
    const actual = lines.filter((l) => l.customer_id === c && l.day > cutoff).map((l) => l.day).sort((a, b) => a - b)[0];
    const next = Math.round(last + med);
    if (actual != null) errs.push(Math.abs(actual - next));
    const trig = Math.round(last + med * (p25 / med));
    const lapse = Math.round(last + med * (p75 / med));
    if (trig <= lastDay && lapse >= cutoff) { triggered += 1; if (actual != null) hits += 1; }
  }
  expect(bt.baseline.evaluated).toBe(byC.size);
  expect(bt.baseline.repurchased).toBe(errs.length);
  expect(bt.baseline.mae_days).toBeCloseTo(avg(errs), 1);
  expect(bt.baseline.triggered).toBe(triggered);
  expect(bt.baseline.hit_rate).toBeCloseTo(hits / triggered, 3);
  expect(bt.definitions.hit_rate).toContain('would have mailed');
});

test('a model that genuinely beats the baseline is selected, with the numbers that justify it', () => {
  const a = RM.analyse(hist(backtestLines()));
  const bt = a.backtest;
  expect(bt.state).toBe('ok');
  expect(bt.model.mae_days).toBeLessThan(bt.baseline.mae_days);
  expect(bt.mae_improvement_days.ci95[0]).toBeGreaterThan(0);
  expect(bt.model.hit_rate).toBeGreaterThanOrEqual(bt.baseline.hit_rate);
  expect(a.method.selected).toBe('model');
  expect(a.method.reason).toContain('The model is used');
});

test('a model that does not beat the baseline is NOT shipped: the baseline is, and the analysis says so', () => {
  // Identical cadence for everyone: nothing for a per-customer model to learn.
  const lines = [];
  const gaps = [20, 35, 50];
  for (let i = 0; i < 90; i++) {
    for (let d = D0 + (i % 29), j = 0; d <= D0 + 720; d += gaps[(i + j++) % 3]) lines.push(L(`flat-${i}`, d));
  }
  const a = RM.analyse(hist(lines));
  expect(a.backtest.state).toBe('ok');
  expect(a.method.selected).toBe('baseline');
  expect(a.method.reason).toContain('did not beat the baseline');
  // Predictions are the baseline's: the product median for everyone.
  const med = a.products.find((p) => p.key === 'US|sku|SKU-A').distribution.median;
  expect(new Set(a.predictions.map((p) => p.interval_days))).toEqual(new Set([med]));
});

test('a holdout too small to judge ships the baseline, and says why', () => {
  const bt = RM.backtest(exactLines(), { holdoutWeeks: 4 });
  expect(bt.state).toBe('insufficient');
  expect(bt.verdict.selected).toBe('baseline');
  expect(bt.verdict.reason).toMatch(/needed to judge the model/);
});

/* ═══ 6. readers: absent is not a default ═══════════════════════════════════ */

test('the Shopify export reader keeps completed orders, normalises the market, and reads sample data as sample data', () => {
  const orders = [
    { id: '1', customer_id: 'c1', created_at: '2025-02-09 14:25:10', shipping_country_code: 'GB', financial_status: 'paid', email: 'a@example.com' },
    { id: '2', customer_id: 'c1', created_at: '2025-03-01 09:00:00', shipping_country_code: 'GB', financial_status: 'refunded', email: 'a@example.com' },
    { id: '3', customer_id: 'c2', created_at: '2025-03-02 09:00:00', shipping_country_code: 'US', financial_status: 'paid', cancelled_at: '2025-03-03', email: 'b@example.com' },
  ];
  const items = [
    { order_id: '1', sku: 'S1', product_type: 'Kicks', quantity: '2', title: 'Pair one' },
    { order_id: '2', sku: 'S1', product_type: 'Kicks', quantity: '1', title: 'Pair one' },
    { order_id: '3', sku: 'S1', product_type: 'Kicks', quantity: '1', title: 'Pair one' },
  ];
  const read = RM.linesFromShopifyExport(orders, items);
  expect(read.lines).toEqual([{ customer_id: 'c1', order_id: '1', day: Math.floor(Date.UTC(2025, 1, 9, 14, 25, 10) / 86400000), sku: 'S1', product_type: 'Kicks', quantity: 2, market: 'UK', title: 'Pair one' }]);
  expect(read.excluded_orders).toEqual({ cancelled: 1, refunded_or_voided: 1 });
  expect(read.synthetic).toBe(true);
  const real = RM.linesFromShopifyExport([Object.assign({}, orders[0], { email: 'a@brand-store.co' })], items.slice(0, 1));
  expect(real.synthetic).toBe(false);
});

test('synced orders: an unstated quantity stays unknown, a missing market is dropped (not US), the type comes from the catalogue', () => {
  const read = RM.linesFromSmartOrders([
    { id: 'o1', user_id: 'u1', market: 'US', created_at: '2025-01-05', product_sku: 'P1' },
    { id: 'o2', user_id: 'u2', created_at: '2025-01-06', product_sku: 'P1' },
    { id: 'o3', user_id: 'u3', market: 'IN', created_at: '2025-01-07', metadata: { line_items: [{ sku: 'P2', quantity: 3, title: 'Two' }] } },
  ], [{ sku: 'P1', category: 'Cat One', title: 'One' }, { sku: 'P2', category: 'Cat Two' }]);
  expect(read.dropped).toEqual({ no_market: 1 });
  expect(read.lines).toEqual([
    { customer_id: 'u1', order_id: 'o1', day: RM.dayOf('2025-01-05'), sku: 'P1', product_type: 'Cat One', quantity: null, market: 'US', title: 'One' },
    { customer_id: 'u3', order_id: 'o3', day: RM.dayOf('2025-01-07'), sku: 'P2', product_type: 'Cat Two', quantity: 3, market: 'IN', title: 'Two' },
  ]);
});

test('no order history is a stated state, never an empty success', () => {
  const a = RM.analyse(RM.noHistory());
  expect(a.state).toBe('no_history');
  expect(a.note).toContain('[DATA REQUIRED BEFORE LAUNCH: order history');
  expect(a.note).toContain('never assumed');
  expect(a.predictions).toEqual([]);
  expect(RM.insight(a)).toContain('[DATA REQUIRED BEFORE LAUNCH: order history');
  expect(RM.dueBuckets(a, { startDate: '2026-01-01', days: 30 }).buckets).toEqual([]);
});

test('the serialised analysis carries distributions and counts, never the customer list', () => {
  const a = RM.analyse(hist(exactLines()));
  expect(a.predictions.length).toBe(41);
  const wire = JSON.stringify(a);
  expect(wire).not.toContain('exact-7');
  expect(JSON.parse(wire).predictions).toBeUndefined();
});

/* ═══ 7. the cap and the tiers are the existing ones ════════════════════════ */

test('a trigger audience is filtered by the SAME engagement tiers and cross-channel cap, and unknowns are unchecked, not passed', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const contacts = RM.contactsIndex([
    { id: 'capped', sends_7d: CE.FREQUENCY.promotional_per_7d, last_open_at: '2026-09-28' },
    { id: 'fresh', sends_7d: 0, last_open_at: '2026-09-28' },
    { id: 'gone', last_open_at: '2025-01-01' },
    { id: 'bounced', hard_bounced: true },
    { id: 'blank' },                                   // carries nothing: not indexed
  ]);
  expect(contacts.has('blank')).toBe(false);
  const e = CE.triggerEligibility(['capped', 'fresh', 'gone', 'bounced', 'blank', 'stranger'], contacts, { messagePriority: 'promotional', now });
  expect(e.eligible_ids).toEqual(['fresh', 'blank', 'stranger']);
  expect(e.excluded.count).toBe(3);
  expect(e.excluded.reasons).toEqual({ 'engagement tier inactive': 1, 'hard bounce': 1, 'at the promotional cap (2 touches in 7 days)': 1 });
  expect(e.unchecked).toBe(2);
  expect(e.frequency.computed).toBe(true);
  // With no send history anywhere, nothing is asserted to be inside the cap.
  const blind = CE.triggerEligibility(['a', 'b'], new Map(), {});
  expect(blind.frequency.computed).toBe(false);
  expect(blind.frequency.note).toContain('ESP send-time suppression');
  expect(blind.eligible_ids).toEqual(['a', 'b']);
  // The replenishment priority never reaches the inactive tier.
  expect(CE.recommendCohorts('replenishment').cohorts).not.toContain('inactive');
});

/* ═══ 8. the planner: the right objective, the evidence on the slot ═════════ */

function planWith(lines, { startDate, days = 30, markets = ['US'], users = [] } = {}) {
  const config = svc.smartConfig({ markets, cohortsPerDay: 1 });
  const analysis = new svc.AnalysisService(config).analyze(
    { indexedCampaigns: [], catalog: [] },
    { orderHistory: hist(lines), users, orders: [], products: [], mvtResults: [] },
  );
  return { analysis, calendar: new svc.CalendarIntelligenceService(config).generate({ analysis, startDate, days, brand: { name: 'TestBrand' } }) };
}

test('due customers become slots with the right objective, the measured evidence and a cap status', () => {
  const lines = exactLines();
  const S = D0 + 400;
  for (let i = 0; i < 4; i++) lines.push(L(`one-${i}`, S - 35 + i));
  lines.push(L('two', S - 80, { sku: 'SKU-B' }), L('two', S - 40, { sku: 'SKU-B' }));
  const { calendar, analysis } = planWith(lines, { startDate: RM.isoOf(S) });
  const reps = calendar.entries.filter((e) => e.replenishment);
  const second = reps.find((e) => e.cohort.trigger === 'second_order');
  const repeat = reps.find((e) => e.cohort.trigger === 'repeat');
  // The name carries the trigger kind AND the product group the slot is for.
  expect(second.cohort.name).toBe('Replenishment due: second order · Type A');
  expect(second.cohort.slot_key).toMatch(/^repl-2nd-[0-9a-f]{8}$/);
  expect(second.objective).toBe('second-order activation');
  expect(repeat.objective).toBe('replenishment');
  expect(second.cohort.key).toBe(CE.REPLENISHMENT_COHORT.key);
  // The offer is the replenishment slot's, not the first-purchase activation rule.
  expect(second.offer.slot).toBe('replenishment');
  expect(GR.offerFor('Replenishment due: second order', 'second-order activation', null).slot).toBe('replenishment');
  // The audience is exactly the due customers, never widened.
  expect(second.replenishment.audience.customer_ids.sort()).toEqual(['one-0', 'one-1', 'one-2', 'one-3']);
  expect(second.reach).toMatchObject({ cohort_size: 4, planned_recipients: 4, cohort_size_estimated: false, trigger: true });
  // The evidence is the measurement.
  expect(second.replenishment.products[0]).toMatchObject({ product: 'SKU-A', n_customers: 41, median_days: 40, p25_days: 30, p75_days: 50 });
  expect(second.replenishment.products[0].lead.trigger_quantile).toBe(0.25);
  expect(second.rationale).toContain('median 40 days');
  expect(second.heroProduct.title).toBe('SKU-A title');
  // The cap pass ran over the trigger slots like every other slot.
  expect(['SAFE', 'REDUCE_AUDIENCE', 'BLOCKED']).toContain(second.reach.frequency_cap.status);
  expect(calendar.replenishment.slots).toBe(reps.length);
  expect(analysis.dailyInsights.some((l) => /^Replenishment/.test(l))).toBe(true);
  // The trigger cohort decides the objective; it is never said to the customer.
  const built = new svc.GenerationService(svc.smartConfig({})).generate(second);
  const words = `${built.assets.email.subject} ${built.assets.email.html}`;
  expect(words).not.toMatch(/replenishment due|second order/i);
  expect(built.objective).toBe('second-order activation');
});

test('a due customer already at the cross-channel cap is not in the slot; a slot nobody may receive is withheld', () => {
  const lines = exactLines();
  const S = D0 + 400;
  lines.push(L('solo', S - 35));
  const users = [{ id: 'solo', sends_7d: 3, last_open_at: RM.isoOf(S - 1) }];
  const { calendar } = planWith(lines, { startDate: RM.isoOf(S), users });
  expect(calendar.entries.filter((e) => e.replenishment && e.cohort.trigger === 'second_order')).toEqual([]);
  expect(calendar.replenishment.withheld[0]).toMatchObject({ cohort: 'second_order', due: 1 });
});

/* ═══ 9. whose orders: the gate, executed ════════════════════════════════════ */

/* ═══ 10. review findings on #135, each reproduced first ═══════════════════ */

test('(a) customers due for DIFFERENT products in the same week get separate slots, each carrying its own product', () => {
  // Codex P1 on #135: the bucket key was market|week|cohort, so customers due
  // for product A and product B in the same week shared one slot whose hero was
  // products[0] - every B buyer was sent A's creative.
  const lines = exactLines();                                   // Type A / SKU-A: p25 30, p75 50
  for (let i = 0; i < 35; i++) lines.push(L(`bb-${i}`, D0 + i, { sku: 'SKU-B2', type: 'Type B' }), L(`bb-${i}`, D0 + i + 20 + i, { sku: 'SKU-B2', type: 'Type B' }));
  const S = D0 + 400;
  for (let i = 0; i < 3; i++) {
    lines.push(L(`dueA-${i}`, S - 35));
    lines.push(L(`dueB-${i}`, S - 35, { sku: 'SKU-B2', type: 'Type B' }));
  }
  // One repeat customer due for BOTH products in the same week.
  lines.push(L('both', S - 36), L('both', S - 35, { sku: 'SKU-B2', type: 'Type B' }));
  const { calendar } = planWith(lines, { startDate: RM.isoOf(S) });
  const second = calendar.entries.filter((e) => e.replenishment && e.cohort.trigger === 'second_order');
  expect(second).toHaveLength(2);
  const forA = second.find((e) => e.heroProduct.title === 'SKU-A title');
  const forB = second.find((e) => e.heroProduct.title === 'SKU-B2 title');
  expect(forA.replenishment.audience.customer_ids.sort()).toEqual(['dueA-0', 'dueA-1', 'dueA-2']);
  expect(forB.replenishment.audience.customer_ids.sort()).toEqual(['dueB-0', 'dueB-1', 'dueB-2']);
  // Each recipient's own last-bought SKU travels with the audience.
  expect(forB.replenishment.audience.last_bought['dueB-1']).toBe('SKU-B2');
  expect(forA.replenishment.audience.last_bought['dueA-1']).toBe('SKU-A');
  expect(forA.cohort.name).not.toBe(forB.cohort.name);
  expect(forA.id).not.toBe(forB.id);
  // A customer due for two products in one week gets ONE replenishment send.
  const slotsWithBoth = calendar.entries.filter((e) => e.replenishment && e.replenishment.audience.customer_ids.includes('both'));
  expect(slotsWithBoth).toHaveLength(1);
  expect(calendar.replenishment.counts.same_week_other_product).toBe(1);
});

test('(#141-3) a BUILT campaign carries each recipient\'s own SKU as merge data keyed by a hashed profile id, and the hero slot uses it', () => {
  // Codex P2 on #141: `audience.last_bought` lived only on the calendar entry;
  // GenerationService rebuilt the audience without it, so the campaign that
  // goes to the ESP still had one static hero for everyone in the group.
  const lines = exactLines();                                   // SKU-A, Type A: enough history
  const S = D0 + 400;
  lines.push(L('cust-7f3a', S - 35));                           // last bought SKU-A
  lines.push(L('cust-9b2c', S - 34, { sku: 'SKU-C' }));          // last bought SKU-C, same type
  const { calendar } = planWith(lines, { startDate: RM.isoOf(S) });
  const slot = calendar.entries.find((e) => e.replenishment && e.replenishment.audience.customer_ids.includes('cust-9b2c'));
  expect(slot.replenishment.audience.customer_ids.sort()).toEqual(['cust-7f3a', 'cust-9b2c']);
  slot.brand = { id: 'ws-test', name: 'TestBrand' };            // what the plan stamps before building
  const built = new svc.GenerationService(svc.smartConfig({})).generate(slot);
  const p = built.audience.personalisation;
  expect(p.keyed_by).toBe('profile_hash');
  expect(p.values).toEqual({
    [CE.hashProfileId('cust-7f3a', 'ws-test')]: { sku: 'SKU-A', title: 'SKU-A title' },
    [CE.hashProfileId('cust-9b2c', 'ws-test')]: { sku: 'SKU-C', title: 'SKU-C title' },
  });
  expect(p.fallback).toEqual({ sku: slot.heroProduct.sku, title: slot.heroProduct.title });
  // The ESP-bound message carries the same data.
  expect(built.platform_ready.lifecycle_messaging[0].audience.personalisation.values).toEqual(p.values);
  // The hero slot names the recipient's own product, the group hero only as fallback.
  const tag = `{{ ${p.field}|default:'${slot.heroProduct.title}' }}`;
  expect(built.assets.email.html).toContain(`>${tag}</h2>`);
  expect(built.assets.email.subject).toContain(tag);
  // No raw customer id anywhere in what is built.
  const wire = JSON.stringify(built);
  expect(wire).not.toContain('cust-7f3a');
  expect(wire).not.toContain('cust-9b2c');
  // A slot that is not a trigger keeps its static hero.
  const plain = calendar.entries.find((e) => !e.replenishment);
  expect(new svc.GenerationService(svc.smartConfig({})).generate(plain).assets.email.html).not.toContain(p.field);
});

const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SMART_BRAIN_SUPABASE_URL', 'SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY', 'SMART_BRAIN_SUPABASE_KEY', 'SMART_BRAIN_WORKSPACE_ID',
  'CONTACT_HASH_SALT'];

test.describe('whose order history the planner reads', () => {
  const env = envScope(ENV_KEYS);
  let db = null;
  test.beforeEach(() => { env.save(); for (const k of ENV_KEYS) delete process.env[k]; require(path.join(ROOT, 'api', '_shared', 'workspace-scope.js')).invalidate(); });
  test.afterEach(() => { if (db) db.restore(); db = null; env.restore(); require(path.join(ROOT, 'api', '_shared', 'workspace-scope.js')).invalidate(); });

  function world() {
    db = new FakeSupabase();
    db.addWorkspace('ws-zero', 'owner-zero', { slug: 'knickgasm', name: 'KNICKGASM', created_at: '2026-01-01T00:00:00Z', regions: [{ code: 'US', home: true }] });
    db.addWorkspace('ws-other', 'owner-other', { slug: 'other-brand', name: 'Other Brand', created_at: '2026-06-01T00:00:00Z', regions: [{ code: 'US', home: true }] });
    db.syncIdentityTables();
    db.install();
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    return db;
  }

  test('tenant zero reads the export compiled into the build; another workspace never does, and says it has no history', async () => {
    world();
    const zero = await new svc.SmartBrainDbAdapter(svc.smartConfig({ workspace_id: 'ws-zero' })).orderHistory();
    expect(zero.kind).toBe('bundled_export');
    expect(zero.lines.length).toBeGreaterThan(1000);
    expect(zero.synthetic).toBe(true);

    const other = await new svc.SmartBrainDbAdapter(svc.smartConfig({ workspace_id: 'ws-other' })).orderHistory();
    expect(other.kind).toBe('none');
    expect(other.lines).toEqual([]);
    expect(other.reason).toContain('another brand\'s orders are never used');
  });

  test('the full plan: tenant zero gets trigger slots from its bundled history, another workspace gets none from it', async () => {
    test.setTimeout(120000);
    world();
    const startDate = '2025-03-31';                 // the day after the bundled export ends
    const z = await svc.runDailySmartBrain({ config: { workspace_id: 'ws-zero', markets: ['US', 'UK'] }, startDate, days: 14 });
    const zr = z.calendar.entries.filter((e) => e.replenishment);
    expect(zr.length).toBeGreaterThan(0);
    for (const e of zr) {
      expect(e.replenishment.source).toMatchObject({ kind: 'bundled_export', synthetic: true });
      expect(e.replenishment.products[0].n_customers).toBeGreaterThanOrEqual(30);
      expect(e.replenishment.products[0].median_days).toBeGreaterThan(0);
      expect(['replenishment', 'second-order activation']).toContain(e.objective);
      // Sample data is never presented with full confidence.
      expect(e.analysis && JSON.stringify(e)).toContain('History is demo sample data');
    }

    const o = await svc.runDailySmartBrain({ config: { workspace_id: 'ws-other', markets: ['US', 'UK'] }, startDate, days: 14 });
    expect(o.calendar.entries.filter((e) => e.replenishment)).toEqual([]);
    expect(o.analysis.replenishment.state).toBe('no_history');
    expect(o.analysis.dailyInsights.join(' ')).toContain('[DATA REQUIRED BEFORE LAUNCH: order history');
  });

  test('a phone request with no workspace is never handed tenant zero\'s orders', async () => {
    world();
    const rs = require(path.join(ROOT, 'api', '_shared', 'request-scope.js'));
    const req = { headers: { 'x-lifecycle-token': 'p'.repeat(48) }, query: {}, body: {} };
    const h = await rs.run(req, () => new svc.SmartBrainDbAdapter(svc.smartConfig({}), null).orderHistory());
    expect(h.kind).toBe('none');
    expect(h.lines).toEqual([]);
  });

  test('with no Supabase project a script reads the build\'s export, but a phone request still does not', async () => {
    // No world(): every Supabase variable is unset (beforeEach), so this is the
    // single-tenant answer ownsBundledExport() documents - for a caller with no
    // person in scope only.
    const script = await new svc.SmartBrainDbAdapter(svc.smartConfig({}), null).orderHistory();
    expect(script.kind).toBe('bundled_export');
    const rs = require(path.join(ROOT, 'api', '_shared', 'request-scope.js'));
    const req = { headers: { 'x-lifecycle-token': 'p'.repeat(48) }, query: {}, body: {} };
    const phone = await rs.run(req, () => new svc.SmartBrainDbAdapter(svc.smartConfig({}), null).orderHistory());
    expect(phone.kind).toBe('none');
    // And a caller that knows the brand is not tenant zero is never asked.
    const told = await new svc.SmartBrainDbAdapter(svc.smartConfig({}), null).orderHistory({ allowBundled: false });
    expect(told.kind).toBe('none');
  });

  test('another workspace with its OWN synced orders gets slots built from its rows only', async () => {
    test.setTimeout(120000);
    world();
    const today = RM.dayOf(new Date().toISOString().slice(0, 10));
    for (let i = 0; i < 40; i++) {
      // 40 repeat buyers at a 30-day cadence, plus their latest purchase 25 days ago: due now.
      for (const back of [85, 55, 25]) {
        db.insert('smart_orders', { id: `o-${i}-${back}`, workspace_id: 'ws-other', user_id: `other-cust-${i}`, market: 'US', created_at: RM.isoOf(today - back - (i % 3)), product_sku: 'OB-1', metadata: { product_type: 'Other Goods', title: 'Other Goods One' } });
      }
    }
    const plan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
    const res = await plan.getPlan({ config: { workspace_id: 'ws-other' } });
    const reps = res.entries.filter((e) => e.replenishment);
    expect(reps.length).toBeGreaterThan(0);
    const ids = reps.flatMap((e) => e.replenishment.audience.customer_ids);
    expect(ids.every((id) => /^other-cust-/.test(id))).toBe(true);
    for (const e of reps) {
      expect(e.replenishment.source.kind).toBe('workspace_orders');
      expect(e.heroProduct.title).toBe('Other Goods One');
      expect(e.id).toMatch(/_w[0-9a-f]{8}$/);                 // this workspace's id namespace
      expect(e.reach.frequency_cap.status).toBeTruthy();
    }
  });

  /* ── review findings on #135 ───────────────────────────────────────────── */

  test('(b) more than 20,000 synced orders are read in full, and a ceiling that IS hit is stated, never silent', async () => {
    // Codex P1 on #135: smart_orders was read with limit=20000 and no paging, so
    // a larger brand was measured on whichever 20,000 rows came back - silently.
    test.setTimeout(180000);
    world();
    const base = RM.dayOf('2026-01-01');
    for (let i = 0; i < 12500; i++) {
      for (const k of [0, 1]) {
        db.insert('smart_orders', { id: `pg-${i}-${k}`, workspace_id: 'ws-other', user_id: `pg-cust-${i}`, market: 'US', created_at: RM.isoOf(base + (i % 200) + k * 30), product_sku: 'PG-1', metadata: { product_type: 'Paged' } });
      }
    }
    const adapter = new svc.SmartBrainDbAdapter(svc.smartConfig({ workspace_id: 'ws-other' }));
    const full = await adapter.orderHistory();
    expect(full.lines.length).toBe(25000);
    expect(full.truncated).toBe(false);
    // ownData() reads orders with its own 20,000 cap; it must not hand that on.
    const data = await adapter.ownData();
    expect(data.orderHistory.lines.length).toBe(25000);
    // A deliberately low ceiling: the newest window is read, complete, and SAID.
    const capped = await new svc.SmartBrainDbAdapter(svc.smartConfig({ workspace_id: 'ws-other', replenishment: { maxOrderRows: 10000, orderPageSize: 3000 } })).orderHistory();
    expect(capped.truncated).toBe(true);
    expect(capped.lines.length).toBeLessThan(10000);
    expect(capped.lines.length).toBeGreaterThan(9000);
    const from = RM.dayOf(capped.complete_from);
    expect(Math.min(...capped.lines.map((l) => l.day))).toBe(from);
    // Every order on or after complete_from is present: the window is complete.
    const inWindow = db.where('smart_orders', (r) => RM.dayOf(r.created_at) >= from).length;
    expect(capped.lines.length).toBe(inWindow);
    const a = RM.analyse(capped);
    expect(a.source.truncated).toBe(true);
    expect(a.note).toContain(`orders before ${capped.complete_from} were not read`);
  });

  function otherWorkspaceDueNow() {
    const today = RM.dayOf(new Date().toISOString().slice(0, 10));
    for (let i = 0; i < 40; i++) {
      for (const back of [85, 55, 25]) {
        db.insert('smart_orders', { id: `o-${i}-${back}`, workspace_id: 'ws-other', user_id: `other-cust-${i}`, market: 'US', created_at: RM.isoOf(today - back - (i % 3)), product_sku: 'OB-1', metadata: { product_type: 'Other Goods', title: 'Other Goods One' } });
      }
    }
    return today;
  }

  test('(c)+(d) another workspace\'s audience is filtered by ITS OWN engagement scores, joined by profile id or the same email hash', async () => {
    // Codex P1 on #135: the offering planner analysed with NO contacts, and the
    // tenant-zero path read smart_users, which carries none of the engagement
    // fields - so bounced, complained and capped buyers were all kept.
    test.setTimeout(120000);
    world();
    const today = otherWorkspaceDueNow();
    // other-cust-0: hard bounce, matched by ESP profile id = customer id.
    db.insert('subscriber_engagement_scores', { workspace_id: 'ws-other', provider: 'klaviyo', external_profile_id: 'other-cust-0', hard_bounced: true, sends_7d: 0 });
    // other-cust-1: already at the promotional cap, matched through its email hash.
    db.insert('smart_users', { id: 'other-cust-1', workspace_id: 'ws-other', email: 'One@Shop.test' });
    db.insert('subscriber_engagement_scores', { workspace_id: 'ws-other', provider: 'klaviyo', external_profile_id: 'kl-001', email_hash: CE.hashEmail('one@shop.test', 'ws-other'), sends_7d: 2, last_open_at: RM.isoOf(today - 2) });
    // other-cust-3: suppressed by the deliverability layer.
    db.insert('subscriber_engagement_scores', { workspace_id: 'ws-other', provider: 'klaviyo', external_profile_id: 'other-cust-3', suppressed: true, suppressed_reason: 'sunset', sends_7d: 0 });
    // other-cust-2: a complaint in ANOTHER workspace must not leak into this one.
    db.insert('subscriber_engagement_scores', { workspace_id: 'ws-zero', provider: 'klaviyo', external_profile_id: 'other-cust-2', complained: true, sends_7d: 0 });
    // A second product group due the same days, whose name shares the slug
    // prefix a calendar id keeps ("Other Goods" / "Other Gear"): its slots must
    // not collide with the first group's.
    for (let i = 0; i < 40; i++) {
      for (const back of [85, 55, 25]) {
        db.insert('smart_orders', { id: `g-${i}-${back}`, workspace_id: 'ws-other', user_id: `gear-cust-${i}`, market: 'US', created_at: RM.isoOf(today - back - (i % 3)), product_sku: 'OG-1', metadata: { product_type: 'Other Gear', title: 'Other Gear One' } });
      }
    }

    const plan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
    const res = await plan.getPlan({ config: { workspace_id: 'ws-other' } });
    const reps = res.entries.filter((e) => e.replenishment);
    const ids = reps.flatMap((e) => e.replenishment.audience.customer_ids);
    expect(ids).not.toContain('other-cust-0');
    expect(ids).not.toContain('other-cust-1');
    expect(ids).not.toContain('other-cust-3');
    expect(ids).toContain('other-cust-2');
    const reasons = Object.assign({}, ...reps.map((e) => e.reach.eligibility.excluded.reasons));
    expect(Object.keys(reasons).sort()).toEqual(['at the promotional cap (2 touches in 7 days)', 'hard bounce', 'suppressed (sunset)']);
    expect(reps.some((e) => e.reach.eligibility.frequency.computed)).toBe(true);
    // Two product groups, two sets of slots, every id distinct, each hero its own.
    expect(new Set(reps.map((e) => e.cohort.product_group))).toEqual(new Set(['Other Goods', 'Other Gear']));
    expect(new Set(reps.map((e) => e.id)).size).toBe(reps.length);
    for (const e of reps) expect(e.heroProduct.title).toBe(e.cohort.product_group === 'Other Gear' ? 'Other Gear One' : 'Other Goods One');
  });

  test('(d) tenant zero\'s trigger audience is filtered by its engagement scores, not by smart_users', async () => {
    test.setTimeout(120000);
    world();
    const startDate = '2025-03-31';
    const due = RM.dueBuckets(RM.analyse(RM.loadBundledExport()), { startDate, days: 14, markets: ['US', 'UK'] });
    const victim = due.buckets[0].customer_ids[0];
    db.insert('subscriber_engagement_scores', { workspace_id: 'ws-zero', provider: 'klaviyo', external_profile_id: victim, hard_bounced: true, sends_7d: 0 });
    // A smart_users row carries none of the engagement fields: it decides nothing.
    db.insert('smart_users', { id: due.buckets[0].customer_ids[1], workspace_id: 'ws-zero', email: 'x@example.com' });
    const z = await svc.runDailySmartBrain({ config: { workspace_id: 'ws-zero', markets: ['US', 'UK'] }, startDate, days: 14 });
    const reps = z.calendar.entries.filter((e) => e.replenishment);
    expect(reps.length).toBeGreaterThan(0);
    expect(reps.flatMap((e) => e.replenishment.audience.customer_ids)).not.toContain(victim);
    expect(reps.some((e) => (e.reach.eligibility.excluded.reasons || {})['hard bounce'] === 1)).toBe(true);
  });

  /* ── review findings on #141 ───────────────────────────────────────────── */

  test('(#141-1) the server caps every page at max_rows; orders and profiles past it are still read, and a failed page is not a complete read', async () => {
    // Codex P1 on #141: supabase/config.toml sets max_rows = 1000, so a request
    // for a 10,000-row page answers 1,000 and `page.length < limit` ended the
    // read there - orders AND engagement profiles silently cut at 1,000, and
    // ownData() took its own capped read for a complete one.
    test.setTimeout(180000);
    world();
    expect(db.maxRows).toBe(1000);                              // read from supabase/config.toml
    const base = RM.dayOf('2026-01-01');
    for (let i = 0; i < 1300; i++) {
      for (const k of [0, 1]) db.insert('smart_orders', { id: `mx-${String(i).padStart(4, '0')}-${k}`, workspace_id: 'ws-other', user_id: `mx-cust-${i}`, market: 'US', created_at: RM.isoOf(base + (i % 90) + k * 30), product_sku: 'MX-1', metadata: { product_type: 'Maxed' } });
    }
    for (let i = 0; i < 1500; i++) {
      db.insert('subscriber_engagement_scores', { id: `ev-${String(i).padStart(4, '0')}`, workspace_id: 'ws-other', provider: 'klaviyo', external_profile_id: `mx-cust-${i}`, sends_7d: 0, hard_bounced: i === 1499 });
    }
    // The fake answers like the server: a 10,000-row request returns 1,000.
    const raw = await (await fetch(`${BASE}/rest/v1/smart_orders?select=id&limit=10000`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })).json();
    expect(raw.length).toBe(1000);
    const adapter = new svc.SmartBrainDbAdapter(svc.smartConfig({ workspace_id: 'ws-other' }));
    const data = await adapter.ownData();
    expect(data.orders.length).toBe(2600);
    expect(data.orderHistory.lines.length).toBe(2600);
    expect(data.orderHistory.truncated).toBe(false);
    expect(data.engagement.rows).toBe(1500);
    expect(data.engagement.map.get('mx-cust-1499').hard_bounced).toBe(true);
    // A page that FAILS part-way: what was read is a stated window, never "complete".
    const { response } = require('./lib/fake-supabase.js');
    const rest = db.rest.bind(db);
    db.rest = (table, qs, ...rest2) => ((table === 'smart_orders' && /(^|&)offset=2000(&|$)/.test(qs)) ? response(503, { message: 'fixture: page 3 is down' }) : rest(table, qs, ...rest2));
    const broken = await new svc.SmartBrainDbAdapter(svc.smartConfig({ workspace_id: 'ws-other' })).orderHistory();
    expect(broken.truncated).toBe(true);
    expect(broken.read_error).toBeTruthy();
    expect(broken.lines.length).toBeLessThan(2000);
    expect(broken.lines.length).toBe(db.where('smart_orders', (r) => RM.dayOf(r.created_at) >= RM.dayOf(broken.complete_from)).length);
  });

  for (const order of ['clean row first', 'flagged row first']) {
    test(`(#141-2) evidence from two providers merges fail-closed, whatever the row order (${order})`, async () => {
      // Codex P1 on #141: one profile can have a row per provider, and the
      // reader kept whichever row came last in an arbitrary order - a clean row
      // could erase another provider's complaint, bounce, suppression or sends.
      world();
      const now = Date.now();
      const recent = new Date(now - 3 * 86400000).toISOString();
      const [first, second] = order === 'clean row first' ? ['e1', 'e2'] : ['e2', 'e1'];
      const put = (id, row) => db.insert('subscriber_engagement_scores', Object.assign({ id, workspace_id: 'ws-other' }, row));
      // A: clean in one provider, a spam complaint in the other.
      put(`${first}-a`, { provider: 'klaviyo', external_profile_id: 'cust-a', sends_7d: 0, last_open_at: recent });
      put(`${second}-a`, { provider: 'webengage', external_profile_id: 'cust-a', complained: true, sends_7d: 0 });
      // B: one send in each provider - two cross-channel touches, at the promotional cap.
      put(`${first}-b`, { provider: 'klaviyo', external_profile_id: 'cust-b', sends_7d: 1, last_open_at: recent });
      put(`${second}-b`, { provider: 'webengage', external_profile_id: 'cust-b', sends_7d: 1 });
      // C: a recent open in one provider, an old one in the other - engaged.
      put(`${first}-c`, { provider: 'klaviyo', external_profile_id: 'cust-c', sends_7d: 0, last_open_at: recent });
      put(`${second}-c`, { provider: 'webengage', external_profile_id: 'cust-c', sends_7d: 0, last_open_at: '2023-01-01T00:00:00Z' });
      // D: clean under its profile id, unsubscribed under its email hash elsewhere.
      db.insert('smart_users', { id: 'cust-d', workspace_id: 'ws-other', email: 'd@shop.test' });
      put(`${first}-d`, { provider: 'klaviyo', external_profile_id: 'cust-d', sends_7d: 0, last_open_at: recent });
      put(`${second}-d`, { provider: 'webengage', external_profile_id: 'we-d', email_hash: CE.hashEmail('d@shop.test', 'ws-other'), suppressed: true, suppressed_reason: 'unsubscribed', sends_7d: 0 });
      const ev = await new svc.SmartBrainDbAdapter(svc.smartConfig({ workspace_id: 'ws-other' })).engagementContacts();
      const e = CE.triggerEligibility(['cust-a', 'cust-b', 'cust-c', 'cust-d'], RM.contactsIndex(ev.map), { messagePriority: 'promotional', now });
      expect(e.eligible_ids).toEqual(['cust-c']);
      expect(e.excluded.reasons).toEqual({ 'spam complaint': 1, 'at the promotional cap (2 touches in 7 days)': 1, 'suppressed (unsubscribed)': 1 });
      expect(ev.map.get('cust-b').sends_7d).toBe(2);
      expect(ev.map.get('cust-c').last_open_at).toBe(recent);
      expect(ev.map.get('cust-a').providers).toEqual(['klaviyo', 'webengage']);
    });
  }
});
