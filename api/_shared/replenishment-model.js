'use strict';
/**
 * replenishment-model.js — when is this customer likely to buy this again,
 * MEASURED from the brand's own order history.
 * ---------------------------------------------------------------------------
 * The roadmap asked for "individual consumption velocity" and gave an example
 * built on an assumed rate ("1.5 cups a day"). A consumption rate and a pack
 * size are product facts, and this repo does not invent product facts. So
 * nothing here assumes how fast anything is used up. What it does instead is
 * read how long the brand's own customers actually waited between purchases
 * of the same thing, and how much that wait differs from one customer to the
 * next, and it says so when there is too little history to know.
 *
 * ── WHAT IS MEASURED ───────────────────────────────────────────────────────
 *   Per product, per market   the empirical inter-purchase interval: median,
 *                             p25, p75 and n, from customers who bought that
 *                             product at least twice. SKU first; a SKU with too
 *                             few repeat buyers falls back to its product type.
 *                             Below MIN_REPEAT_CUSTOMERS the product reports
 *                             `insufficient_history` WITH its count - never a
 *                             guessed interval.
 *   Per customer              their own intervals, shrunk toward the product
 *                             median by an empirical-Bayes rule (stated below)
 *                             when they have bought it at least twice; the
 *                             product distribution when they have not.
 *   Quantity                  used ONLY when the order line states it, and only
 *                             scaled when the data shows quantity changes the
 *                             wait. Proportional scaling is used only when the
 *                             measured ratio is consistent with it; otherwise
 *                             the measured group ratio is used; no detectable
 *                             effect means quantity is ignored.
 *   Trigger                   predicted next purchase, brought forward to the
 *                             point where the product's own p25 repeat buyer had
 *                             already re-bought - so roughly three in four repeat
 *                             buyers are reached before they buy again.
 *   Lapse                     past the p75 point the customer is no longer "due",
 *                             they are lapsing; that is the reactivation cohorts'
 *                             job, and a replenishment send would be the wrong
 *                             message.
 *
 * ── THE MODEL HAS TO EARN ITS PLACE ────────────────────────────────────────
 * `backtest()` holds out the last HOLDOUT_WEEKS of history, fits on the rest,
 * and scores both the per-customer model and the naive baseline (the same
 * product median for everyone) on what actually happened in the holdout. The
 * model is used only when its mean absolute error is lower with a paired
 * bootstrap interval that excludes zero AND its hit-rate is not lower. Anything
 * else - including a holdout too small to judge - ships the baseline, and the
 * analysis says which and why.
 *
 * ── WHOSE ORDERS ───────────────────────────────────────────────────────────
 * This module never decides whose history it is reading. The caller hands it
 * lines: the workspace's own synced orders, or - for tenant zero ONLY, behind
 * market-analytics.ownsBundledExport() - the order export compiled into this
 * build (`loadBundledExport()`). The gate lives with the caller
 * (SmartBrainDbAdapter.orderHistory) so there is one door, not two.
 *
 * Pure and deterministic (seeded bootstrap, no network, no LLM).
 * NOT a function file (api/_shared/ is outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const DAY = 86400000;
const MODEL_VERSION = 'replenishment-v1';

/** Every estimate this module reports needs at least this many independent
 *  customers behind it: a product's interval distribution (repeat buyers),
 *  the within-customer variance the shrinkage needs (customers with two or
 *  more intervals), each quantity group (intervals), and the backtest
 *  (repurchasers in the holdout). One number, stated once. */
const MIN_REPEAT_CUSTOMERS = 30;
/** Trigger at the point where this share of the product's repeat buyers had
 *  already re-bought. 0.25 => ~75% are reached before their next purchase. */
const TRIGGER_QUANTILE = 0.25;
/** Past this point a customer is lapsing, not due. */
const LAPSE_QUANTILE = 0.75;
const HOLDOUT_WEEKS = 26;
const BUCKET_DAYS = 7;
const BOOTSTRAP_RESAMPLES = 200;
const BOOTSTRAP_SEED = 20261004;
/** Orders that are not a completed purchase decision. */
const EXCLUDED_FINANCIAL = /^(refunded|voided)$/i;
const NO_HISTORY_MARKER = '[DATA REQUIRED BEFORE LAUNCH: order history, this brand]';

/* ── small numeric helpers ────────────────────────────────────────────────── */

function round1(n) { return Number.isFinite(n) ? Math.round(n * 10) / 10 : null; }
function round3(n) { return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null; }
function mean(xs) { let s = 0; for (const x of xs) s += x; return xs.length ? s / xs.length : NaN; }
function sampleVariance(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs); let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (xs.length - 1);
}
/** Linear-interpolation quantile of an ascending array (R type 7 / numpy default). */
function quantileSorted(sorted, p) {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}
function sortedCopy(xs) { return Float64Array.from(xs).sort(); }
function median(xs) { return quantileSorted(sortedCopy(xs), 0.5); }
function summarize(values) {
  const s = sortedCopy(values);
  return {
    n: s.length,
    median: round1(quantileSorted(s, 0.5)),
    p25: round1(quantileSorted(s, 0.25)),
    p75: round1(quantileSorted(s, 0.75)),
    min: s.length ? s[0] : null,
    max: s.length ? s[s.length - 1] : null,
  };
}
/** Deterministic PRNG so a bootstrap gives the same answer on every run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function resampleMedian(xs, rnd) {
  const out = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) out[i] = xs[Math.floor(rnd() * xs.length)];
  out.sort();
  return quantileSorted(out, 0.5);
}

/* ── dates ────────────────────────────────────────────────────────────────── */

/**
 * A UTC day number. A timestamp with no zone ("2025-02-09 14:25:10", the
 * Shopify/Matrixify export shape) is read as UTC rather than as whatever zone
 * the server happens to run in, so the same file gives the same intervals on
 * every machine.
 */
function dayOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.floor(v / DAY) : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? Math.floor(v.getTime() / DAY) : null;
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  else s = s.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / DAY) : null;
}
function isoOf(day) { return Number.isFinite(day) ? new Date(day * DAY).toISOString().slice(0, 10) : null; }

/* ── order lines ──────────────────────────────────────────────────────────── */

/** A quantity the order line STATES. Absent is not 1. */
function statedQty(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Market code. An absent market is NOT defaulted to US: an interval measured
 * on one region's buyers is not applied to another's (the closed source-of-truth
 * rule), so a line nobody can place is dropped and counted.
 */
function marketOf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  try { return require('./market-analytics.js').normMarket(s); } catch (_) { return s.toUpperCase(); }
}

function typeKey(t) { return String(t || '').trim().toLowerCase().replace(/\s+/g, ' '); }

/**
 * The one canonical line every reader produces:
 *   { customer_id, order_id, day, sku, product_type, quantity, market, title }
 * Returns { line } or { drop: reason }.
 */
function canonical(r) {
  const customer = r.customer_id != null && r.customer_id !== '' ? String(r.customer_id) : '';
  if (!customer) return { drop: 'no_customer' };
  const day = dayOf(r.at);
  if (day == null) return { drop: 'no_date' };
  const market = marketOf(r.market);
  if (!market) return { drop: 'no_market' };
  const sku = r.sku != null && String(r.sku).trim() ? String(r.sku).trim() : null;
  const type = r.product_type != null && String(r.product_type).trim() ? String(r.product_type).trim() : null;
  if (!sku && !type) return { drop: 'no_product' };
  return {
    line: {
      customer_id: customer,
      order_id: r.order_id != null && r.order_id !== '' ? String(r.order_id) : null,
      day, sku, product_type: type,
      quantity: statedQty(r.quantity),
      market,
      title: r.title ? String(r.title) : null,
    },
  };
}

function collect(raw) {
  const lines = [];
  const dropped = {};
  for (const r of raw) {
    const c = canonical(r);
    if (c.line) lines.push(c.line);
    else dropped[c.drop] = (dropped[c.drop] || 0) + 1;
  }
  return { lines, dropped };
}

/**
 * The workspace's own synced orders (`smart_orders`: id, user_id, market,
 * total, created_at, product_sku, metadata). A product type and a title come
 * from the order (metadata, or a Shopify `line_items` payload) or from the
 * brand's own catalogue row for that SKU - never inferred from a name. A
 * quantity is used only when the order states one.
 */
function linesFromSmartOrders(orders, products) {
  const bySku = new Map();
  for (const p of Array.isArray(products) ? products : []) {
    if (!p) continue;
    const info = { type: p.product_type || p.type || p.category || null, title: p.title || null };
    for (const k of [p.sku, p.id, p.handle]) if (k != null && k !== '' && !bySku.has(String(k))) bySku.set(String(k), info);
  }
  const raw = [];
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o) continue;
    const md = (o.metadata && typeof o.metadata === 'object') ? o.metadata : {};
    if (o.cancelled_at || md.cancelled_at || EXCLUDED_FINANCIAL.test(String(md.financial_status || o.financial_status || ''))) continue;
    const base = {
      customer_id: o.user_id != null ? o.user_id : o.customer_id,
      order_id: o.id,
      at: o.created_at || md.created_at,
      market: o.market || md.market || md.shipping_country_code,
    };
    const items = Array.isArray(md.line_items) && md.line_items.length ? md.line_items : null;
    if (items) {
      for (const li of items) {
        if (!li) continue;
        const sku = li.sku || li.product_sku || null;
        const cat = sku != null ? bySku.get(String(sku)) : null;
        raw.push(Object.assign({}, base, {
          sku,
          product_type: li.product_type || (cat && cat.type) || null,
          quantity: li.quantity,
          title: li.title || (cat && cat.title) || null,
        }));
      }
      continue;
    }
    const sku = o.product_sku || o.sku || md.sku || null;
    const cat = sku != null ? bySku.get(String(sku)) : null;
    raw.push(Object.assign({}, base, {
      sku,
      product_type: md.product_type || md.category || (cat && cat.type) || null,
      quantity: md.quantity != null ? md.quantity : o.quantity,
      title: md.title || (cat && cat.title) || null,
    }));
  }
  return collect(raw);
}

/**
 * A Shopify / Matrixify export: `orders.csv` rows and `order_line_items.csv`
 * rows, joined on order id. Cancelled, refunded and voided orders are not a
 * completed purchase and are excluded (counted, not silently lost).
 */
function linesFromShopifyExport(orderRows, lineRows) {
  const byId = new Map();
  const excluded = { cancelled: 0, refunded_or_voided: 0 };
  for (const o of Array.isArray(orderRows) ? orderRows : []) {
    if (!o || o.id == null) continue;
    if (o.cancelled_at) { excluded.cancelled += 1; continue; }
    if (EXCLUDED_FINANCIAL.test(String(o.financial_status || ''))) { excluded.refunded_or_voided += 1; continue; }
    byId.set(String(o.id), o);
  }
  const raw = [];
  let orphan = 0;
  for (const li of Array.isArray(lineRows) ? lineRows : []) {
    const o = li && byId.get(String(li.order_id));
    if (!o) { orphan += 1; continue; }
    raw.push({
      customer_id: o.customer_id,
      order_id: o.id,
      at: o.created_at || o.processed_at,
      market: o.shipping_country_code || o.shipping_country,
      sku: li.sku || null,
      product_type: li.product_type || null,
      quantity: li.quantity,
      title: li.title || null,
    });
  }
  const out = collect(raw);
  out.excluded_orders = excluded;
  out.lines_without_kept_order = orphan;
  // Is this a real store's history? Read off the file, not off a label beside
  // it: when EVERY order's email sits on a domain RFC 2606 reserves for
  // examples, no real customer placed these orders. Only the verdict is kept;
  // no address is.
  let withEmail = 0, reserved = 0;
  for (const o of byId.values()) {
    const m = /@([^@\s>]+)\s*$/.exec(String(o.email || ''));
    if (!m) continue;
    withEmail += 1;
    if (RESERVED_DOMAIN.test(m[1])) reserved += 1;
  }
  out.synthetic = withEmail > 0 && reserved === withEmail;
  out.synthetic_evidence = out.synthetic ? `All ${withEmail} kept orders carry an email on a reserved example domain (RFC 2606), so this is sample data, not a store's sales history.` : null;
  return out;
}
const RESERVED_DOMAIN = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;

/* ── histories: what the caller hands in ──────────────────────────────────── */

function boundsOf(lines) {
  let lo = Infinity, hi = -Infinity;
  const customers = new Set();
  for (const l of lines) { if (l.day < lo) lo = l.day; if (l.day > hi) hi = l.day; customers.add(l.customer_id); }
  return { start: lines.length ? isoOf(lo) : null, end: lines.length ? isoOf(hi) : null, customers: customers.size };
}

/** Wrap a reader's output as a history the analysis accepts. */
function history(kind, read, extra) {
  const lines = (read && read.lines) || [];
  const b = boundsOf(lines);
  return Object.assign({
    kind,
    lines,
    dropped: (read && read.dropped) || {},
    history_start: b.start,
    history_end: b.end,
    customers: b.customers,
  }, read && read.excluded_orders ? { excluded_orders: read.excluded_orders } : {}, extra || {});
}

/** The explicit no-history state. Never an empty success. */
function noHistory(reason) {
  return { kind: 'none', lines: [], dropped: {}, history_start: null, history_end: null, customers: 0, reason: reason || NO_HISTORY_MARKER };
}

/**
 * Tenant zero's order export, compiled into this build (data/matrixify).
 *
 * The CALLER decides whether the caller may read it (ownsBundledExport); this
 * only reads the files. Parsed once per process and shared, which is safe
 * because it is one immutable file with one owner - the gate runs on every
 * call before this is reached. Paths are literal `path.join(__dirname, ...)`
 * so the deployment's file tracer bundles them with the function.
 */
let BUNDLED;
function loadBundledExport() {
  if (BUNDLED !== undefined) return BUNDLED;
  try {
    const fs = require('fs');
    const path = require('path');
    const ordersText = fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'matrixify', 'orders.csv'), 'utf8');
    const linesText = fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'matrixify', 'order_line_items.csv'), 'utf8');
    const { parseCsv } = require('./brand-workspace-core.js');
    const objects = (text) => {
      const grid = parseCsv(text);
      const head = (grid.shift() || []).map((h) => String(h).trim());
      return grid.map((r) => { const o = {}; head.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i]; }); return o; });
    };
    const read = linesFromShopifyExport(objects(ordersText), objects(linesText));
    BUNDLED = history('bundled_export', read, {
      label: 'Order export compiled into this build (data/matrixify/orders.csv + order_line_items.csv)',
      // What the file itself shows it is - carried, never relabelled.
      synthetic: read.synthetic,
      synthetic_evidence: read.synthetic_evidence,
    });
  } catch (e) {
    BUNDLED = null;
  }
  return BUNDLED;
}

/* ── purchase events ──────────────────────────────────────────────────────── */

/**
 * key -> { key, market, level, value, customers: Map<cid, Map<day, event>> }
 *
 * Two orders of the same thing on the same day are ONE purchase occasion: a
 * 0-day "interval" is a split basket, not a repurchase, and would drag every
 * median toward zero.
 */
function buildEvents(lines) {
  const keys = new Map();
  const orders = new Map();         // cid -> Set(order id or day)
  const typeless = new Set();       // sku keys whose lines carried no type
  const add = (key, market, level, value, l) => {
    let k = keys.get(key);
    if (!k) { k = { key, market, level, value, customers: new Map() }; keys.set(key, k); }
    let days = k.customers.get(l.customer_id);
    if (!days) { days = new Map(); k.customers.set(l.customer_id, days); }
    let ev = days.get(l.day);
    if (!ev) { ev = { day: l.day, qty: 0, qtyKnown: true, skus: new Map() }; days.set(l.day, ev); }
    if (l.quantity == null) ev.qtyKnown = false; else ev.qty += l.quantity;
    if (l.sku) {
      const s = ev.skus.get(l.sku) || { qty: 0, title: l.title || null, type: l.product_type || null };
      s.qty += l.quantity == null ? 1 : l.quantity;
      if (!s.title && l.title) s.title = l.title;
      ev.skus.set(l.sku, s);
    }
  };
  for (const l of lines) {
    if (l.sku) {
      add(`${l.market}|sku|${l.sku}`, l.market, 'sku', l.sku, l);
      if (!l.product_type) typeless.add(`${l.market}|sku|${l.sku}`);
    }
    if (l.product_type) add(`${l.market}|type|${typeKey(l.product_type)}`, l.market, 'type', l.product_type, l);
    let set = orders.get(l.customer_id);
    if (!set) { set = new Set(); orders.set(l.customer_id, set); }
    set.add(l.order_id || `day:${l.day}`);
  }
  // Freeze each customer's events into day order with the quantity resolved.
  for (const k of keys.values()) {
    for (const [cid, days] of k.customers) {
      const evs = [...days.values()].sort((a, b) => a.day - b.day).map((e) => ({
        day: e.day,
        qty: e.qtyKnown ? e.qty : null,
        skus: e.skus,
      }));
      k.customers.set(cid, evs);
    }
  }
  return { keys, orders, typeless };
}

function intervalsOf(evs) {
  const out = [];
  for (let i = 1; i < evs.length; i++) out.push({ days: evs[i].day - evs[i - 1].day, prevQty: evs[i - 1].qty });
  return out;
}

/* ── the quantity test ────────────────────────────────────────────────────── */

/**
 * Does buying more units change how long the customer waits? Tested, not
 * assumed. Intervals that FOLLOW a single-unit purchase are compared with those
 * that follow a multi-unit purchase; the ratio of medians gets a seeded
 * bootstrap 95% interval.
 *   CI contains 1                      -> no effect; quantity ignored.
 *   CI excludes 1, contains mean qty   -> proportional; wait scales with units.
 *   CI excludes both                   -> non-proportional; the measured group
 *                                         ratio is used, nothing extrapolated.
 * The factor f(q) is relative to the whole population, so an interval with no
 * stated quantity keeps f = 1 (the population's own mix) rather than being
 * treated as a single unit.
 */
function quantityEffect(repeaters, minN) {
  const one = () => 1;
  const single = [], multi = [], multiQty = [], all = [];
  let unstated = 0;
  for (const c of repeaters) {
    for (const iv of c.intervals) {
      if (iv.prevQty == null) { unstated += 1; continue; }
      all.push(iv.days);
      if (iv.prevQty <= 1) single.push(iv.days);
      else { multi.push(iv.days); multiQty.push(iv.prevQty); }
    }
  }
  if (!all.length) {
    return { factor: one, applied: false, report: { status: 'not_stated', note: 'No order line in this history states a quantity, so quantity is not used. Pack size is never assumed.' } };
  }
  if (single.length < minN || multi.length < minN) {
    return {
      factor: one, applied: false,
      report: { status: 'insufficient', intervals_after_single_unit: single.length, intervals_after_multi_unit: multi.length, unstated, note: `Quantity is stated, but testing it needs ${minN} intervals after single-unit AND after multi-unit purchases; quantity is not used.` },
    };
  }
  const mAll = median(all), m1 = median(single), m2 = median(multi);
  const ratio = m2 / m1;
  const rnd = mulberry32(BOOTSTRAP_SEED);
  const rs = [];
  for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) rs.push(resampleMedian(multi, rnd) / resampleMedian(single, rnd));
  const sr = sortedCopy(rs);
  const ci = [quantileSorted(sr, 0.025), quantileSorted(sr, 0.975)];
  const meanQ = mean(multiQty);
  let status;
  if (ci[0] <= 1 && ci[1] >= 1) status = 'no_effect';
  else if (ci[0] <= meanQ && ci[1] >= meanQ) status = 'proportional';
  else status = 'non_proportional';
  const s1 = m1 / mAll;
  const s2 = m2 / mAll;
  let factor = one;
  if (status === 'proportional') factor = (q) => (q == null ? 1 : q * s1);
  else if (status === 'non_proportional') factor = (q) => (q == null ? 1 : (q <= 1 ? s1 : s2));
  return {
    factor,
    applied: status === 'proportional' || status === 'non_proportional',
    report: {
      status,
      median_after_single_unit: round1(m1),
      median_after_multi_unit: round1(m2),
      ratio: round3(ratio),
      ratio_ci95: [round3(ci[0]), round3(ci[1])],
      mean_multi_quantity: round3(meanQ),
      intervals_after_single_unit: single.length,
      intervals_after_multi_unit: multi.length,
      unstated,
      note: status === 'no_effect'
        ? `Buying more units did not measurably change the wait (median ratio ${round3(ratio)}, 95% interval ${round3(ci[0])}-${round3(ci[1])} includes 1), so quantity is ignored.`
        : status === 'proportional'
          ? `The wait after a multi-unit purchase is ${round3(ratio)}x the single-unit wait (95% interval ${round3(ci[0])}-${round3(ci[1])}), consistent with the mean ${round3(meanQ)} units bought, so the wait scales with quantity.`
          : `Quantity changes the wait (ratio ${round3(ratio)}, 95% interval ${round3(ci[0])}-${round3(ci[1])}) but not in proportion to the ${round3(meanQ)} units bought, so the MEASURED group ratio is used and nothing is extrapolated.`,
    },
  };
}

/* ── shrinkage ────────────────────────────────────────────────────────────── */

/**
 * Empirical Bayes on log intervals (normal-normal, method of moments).
 *   sigma2  within-customer variance, pooled over customers with >= 2 intervals
 *   tau2    between-customer variance of customer means, minus the share the
 *           within variance explains: max(0, var(means) - sigma2 * mean(1/k))
 *   w(k)    tau2 / (tau2 + sigma2 / k)   - how much a customer's own k intervals
 *           are trusted over the product median
 *   predict exp( w * mean(own log intervals) + (1 - w) * log(product median) )
 * tau2 = 0 means the data show no real difference between customers, and every
 * customer gets the product median: the model collapses to the baseline rather
 * than fitting noise.
 */
function shrinkage(norm, minN) {
  const multi = norm.filter((c) => c.ys.length >= 2);
  if (multi.length < minN) {
    return {
      weight: () => 0,
      report: { status: 'not_estimable', customers_with_two_or_more_intervals: multi.length, note: `Shrinkage needs ${minN} customers with at least two intervals to measure how much one customer varies; ${multi.length} have them, so every customer gets the product median.` },
    };
  }
  let ss = 0, df = 0;
  for (const c of multi) {
    const m = mean(c.ys);
    for (const y of c.ys) ss += (y - m) * (y - m);
    df += c.ys.length - 1;
  }
  const sigma2 = ss / df;
  const means = norm.map((c) => mean(c.ys));
  const invK = mean(norm.map((c) => 1 / c.ys.length));
  const tau2 = Math.max(0, sampleVariance(means) - sigma2 * invK);
  const weight = (k) => (tau2 > 0 && k > 0 ? tau2 / (tau2 + sigma2 / k) : 0);
  return {
    weight,
    report: {
      status: 'estimated',
      rule: 'Empirical Bayes on log intervals: w(k) = tau2 / (tau2 + sigma2 / k); prediction = exp(w * own mean log interval + (1 - w) * log(product median)).',
      sigma2_within: round3(sigma2),
      tau2_between: round3(tau2),
      customers_with_two_or_more_intervals: multi.length,
      weight_at: { 1: round3(weight(1)), 2: round3(weight(2)), 3: round3(weight(3)), 5: round3(weight(5)) },
      note: tau2 > 0
        ? `Customers genuinely differ (tau2 ${round3(tau2)} on the log scale), so a customer with k intervals of their own is weighted ${round3(weight(1))} at k=1 and ${round3(weight(3))} at k=3.`
        : 'Customers do not differ beyond what one customer varies from order to order (tau2 = 0), so every customer gets the product median.',
    },
  };
}

/* ── fitting ──────────────────────────────────────────────────────────────── */

function fitKey(entry, minN) {
  const custs = [];
  for (const [cid, evs] of entry.customers) custs.push({ cid, events: evs, intervals: intervalsOf(evs) });
  const repeaters = custs.filter((c) => c.intervals.length >= 1);
  const raw = [];
  for (const c of repeaters) for (const iv of c.intervals) raw.push(iv.days);
  const base = {
    key: entry.key, market: entry.market, level: entry.level, value: entry.value,
    buyers: custs.length, n_customers: repeaters.length, n_intervals: raw.length,
  };
  if (repeaters.length < minN) {
    return Object.assign(base, {
      state: 'insufficient_history',
      reason: `${repeaters.length} customer(s) bought this ${entry.level === 'sku' ? 'SKU' : 'product type'} in ${entry.market} at least twice; ${minN} are needed before an interval is reported. No interval is guessed.`,
      _customers: new Map(custs.map((c) => [c.cid, c])),
    });
  }
  const distribution = summarize(raw);
  const qty = quantityEffect(repeaters, minN);
  const f = qty.factor;
  const norm = repeaters.map((c) => ({ cid: c.cid, ys: c.intervals.map((iv) => Math.log(iv.days / f(iv.prevQty))) }));
  const normDays = [];
  for (const c of norm) for (const y of c.ys) normDays.push(Math.exp(y));
  const nd = qty.applied ? summarize(normDays) : distribution;
  const shrink = shrinkage(norm, minN);
  const triggerFraction = nd.p25 / nd.median;
  const lapseFraction = nd.p75 / nd.median;
  return Object.assign(base, {
    state: 'ok',
    distribution,
    quantity: qty.report,
    normalised_distribution: qty.applied ? nd : null,
    shrinkage: shrink.report,
    lead: {
      trigger_quantile: TRIGGER_QUANTILE,
      trigger_fraction: round3(triggerFraction),
      lapse_quantile: LAPSE_QUANTILE,
      lapse_fraction: round3(lapseFraction),
      lead_days_at_median: round1(nd.median - nd.p25),
      reasoning: `Sent at ${round3(triggerFraction)} of each customer's predicted interval: the point by which a quarter of this product's ${repeaters.length} repeat buyers had already re-bought (p25 ${nd.p25}d vs median ${nd.median}d), so about three in four are reached before they buy again. Past ${round3(lapseFraction)} times the predicted interval (the p75 point) a customer is lapsing, not due.`,
    },
    _f: f,
    _nd: nd,
    _shrink: shrink,
    _customers: new Map(custs.map((c) => [c.cid, c])),
  });
}

function fitAll(lines, minN) {
  const ev = buildEvents(lines);
  const fits = new Map();
  for (const [key, entry] of ev.keys) fits.set(key, fitKey(entry, minN));
  return { ev, fits };
}

/** The SKU a purchase occasion was mostly about (largest quantity, then name). */
function dominantSku(event) {
  let best = null;
  for (const [sku, s] of event.skus) {
    if (!best || s.qty > best.qty || (s.qty === best.qty && sku < best.sku)) best = { sku, qty: s.qty, title: s.title, type: s.type };
  }
  return best;
}

/**
 * One prediction for one customer at one fit.
 * method 'baseline' = the product median for everyone (no quantity, no
 * customer history). method 'model' = shrunk own intervals + quantity.
 */
function predictOne(fit, cust, method) {
  const last = cust.events[cust.events.length - 1];
  let interval, weight = 0, own = cust.intervals.length;
  let ref;
  if (method === 'baseline') {
    interval = fit.distribution.median;
    ref = fit.distribution;
  } else {
    ref = fit._nd;
    const ys = cust.intervals.map((iv) => Math.log(iv.days / fit._f(iv.prevQty)));
    weight = own ? fit._shrink.weight(own) : 0;
    const centre = Math.log(fit._nd.median);
    const mu = own ? weight * mean(ys) + (1 - weight) * centre : centre;
    interval = Math.exp(mu) * fit._f(last.qty);
  }
  const tf = ref.p25 / ref.median;
  const lf = ref.p75 / ref.median;
  return {
    last_day: last.day,
    last_qty: last.qty,
    own_intervals: own,
    weight: round3(weight),
    interval_days: round1(interval),
    next_day: Math.round(last.day + interval),
    trigger_day: Math.round(last.day + interval * tf),
    lapse_day: Math.round(last.day + interval * lf),
  };
}

/**
 * One prediction per (customer, market, product group). The group is the
 * product TYPE when the lines state one, else the SKU. Within a group the SKU
 * level is used when the customer's last purchase was mostly one SKU that has
 * enough repeat buyers of its own; otherwise the type level; otherwise the
 * customer is counted under `insufficient`, never guessed.
 */
function predictAll(model, method) {
  const { ev, fits } = model;
  const out = [];
  const insufficient = new Map();     // group key -> customers not predicted
  const groups = [];
  for (const [key, entry] of ev.keys) {
    if (entry.level === 'type' || ev.typeless.has(key)) groups.push(entry);
  }
  for (const g of groups) {
    const gFit = fits.get(g.key);
    for (const [cid, evs] of g.customers) {
      const last = evs[evs.length - 1];
      const dom = dominantSku(last);
      let fit = null, cust = null;
      if (g.level === 'type' && dom) {
        const sFit = fits.get(`${g.market}|sku|${dom.sku}`);
        if (sFit && sFit.state === 'ok' && sFit._customers.has(cid)) { fit = sFit; cust = sFit._customers.get(cid); }
      }
      if (!fit && gFit && gFit.state === 'ok') { fit = gFit; cust = gFit._customers.get(cid); }
      if (!fit) { insufficient.set(g.key, (insufficient.get(g.key) || 0) + 1); continue; }
      const p = predictOne(fit, cust, method);
      const orders = ev.orders.get(cid);
      out.push(Object.assign({
        customer_id: cid,
        market: g.market,
        group: g.key,
        key: fit.key,
        level: fit.level,
        product: {
          sku: dom ? dom.sku : (g.level === 'sku' ? g.value : null),
          title: dom ? dom.title : null,
          type: g.level === 'type' ? g.value : ((dom && dom.type) || null),
        },
        total_orders: orders ? orders.size : 1,
      }, p));
    }
  }
  return { predictions: out, insufficient };
}

/* ── the backtest ─────────────────────────────────────────────────────────── */

/**
 * Hold out the last `holdoutWeeks`, fit on everything before, score both
 * methods on the same (customer, product) pairs.
 *
 * Definitions (also returned, so the numbers can be read without this file):
 *   evaluated   pairs with a purchase before the cutoff whose product had enough
 *               repeat buyers IN THE TRAINING DATA to be predicted
 *   repurchased evaluated pairs that bought the same product again inside the
 *               holdout
 *   MAE         mean |actual next purchase - predicted next purchase| in days,
 *               over the repurchased pairs (identical set for both methods)
 *   triggered   pairs the method would have sent to during the holdout: trigger
 *               date before the holdout ends and not already lapsed at the cutoff
 *   hit-rate    repurchased / triggered (of the people it would have mailed, how
 *               many really were about to buy)
 *   coverage    triggered / all repurchased (of the people who re-bought, how
 *               many it would have reached)
 *   in time     of triggered pairs that re-bought, the share whose send date
 *               (max(trigger, cutoff)) fell on or before the purchase
 * MAE is only over people who re-bought inside the window, which favours short
 * intervals; both methods are scored on exactly the same pairs, so the
 * COMPARISON is fair even though the absolute MAE is optimistic.
 */
function backtest(lines, { holdoutWeeks = HOLDOUT_WEEKS, minN = MIN_REPEAT_CUSTOMERS } = {}) {
  const definitions = {
    evaluated: 'customer-product pairs with a purchase before the cutoff whose product had enough repeat buyers in the training data',
    mae_days: 'mean absolute error of the predicted next-purchase date, over pairs that re-bought inside the holdout (same pairs for both methods)',
    hit_rate: 'of pairs the method would have mailed during the holdout, the share that re-bought inside it',
    coverage: 'of pairs that re-bought inside the holdout, the share the method would have mailed',
    in_time: 'of mailed pairs that re-bought, the share whose send date was on or before the purchase',
    baseline: 'the same product median for every customer (trigger at product p25, lapse at p75)',
  };
  if (!lines.length) return { state: 'not_run', reason: 'No order lines.', definitions };
  let lastDay = -Infinity;
  for (const l of lines) if (l.day > lastDay) lastDay = l.day;
  const cutoff = lastDay - holdoutWeeks * 7;
  const train = lines.filter((l) => l.day <= cutoff);
  const base = { holdout_weeks: holdoutWeeks, cutoff: isoOf(cutoff), holdout_end: isoOf(lastDay), training_lines: train.length, holdout_lines: lines.length - train.length, definitions };
  if (!train.length) return Object.assign(base, { state: 'insufficient', reason: `No orders before the ${holdoutWeeks}-week holdout.` });

  const trained = fitAll(train, minN);
  // Actual purchases after the cutoff, per (key, customer): first day only.
  const after = new Map();
  const full = buildEvents(lines.filter((l) => l.day > cutoff));
  for (const [key, entry] of full.keys) {
    for (const [cid, evs] of entry.customers) after.set(`${key}#${cid}`, evs[0].day);
  }
  const score = (method) => {
    const { predictions } = predictAll(trained, method);
    return predictions.map((p) => {
      const actual = after.get(`${p.key}#${p.customer_id}`);
      return Object.assign(p, { actual_day: actual == null ? null : actual });
    });
  };
  const evalOf = (preds) => {
    const repurchased = preds.filter((p) => p.actual_day != null);
    const triggered = preds.filter((p) => p.trigger_day <= lastDay && p.lapse_day >= cutoff);
    const trigRe = triggered.filter((p) => p.actual_day != null);
    const inTime = trigRe.filter((p) => Math.max(p.trigger_day, cutoff) <= p.actual_day);
    const errs = repurchased.map((p) => Math.abs(p.actual_day - p.next_day));
    return {
      errs, repurchasedIdx: repurchased,
      out: {
        evaluated: preds.length,
        repurchased: repurchased.length,
        mae_days: errs.length ? round1(mean(errs)) : null,
        triggered: triggered.length,
        hit_rate: triggered.length ? round3(trigRe.length / triggered.length) : null,
        coverage: repurchased.length ? round3(trigRe.length / repurchased.length) : null,
        in_time: trigRe.length ? round3(inTime.length / trigRe.length) : null,
      },
    };
  };
  // Both methods predict the SAME (customer, product group) pairs - level
  // selection does not depend on the method - but the pairing is made by key
  // rather than trusted to iteration order, because the paired bootstrap below
  // is only meaningful if error i of one method is error i of the other.
  const modelPreds = score('model');
  const byPair = new Map(score('baseline').map((p) => [`${p.group}#${p.customer_id}`, p]));
  const basePreds = modelPreds.map((p) => byPair.get(`${p.group}#${p.customer_id}`));
  if (basePreds.some((p) => !p)) throw new Error('replenishment backtest: model and baseline predicted different pairs');
  const m = evalOf(modelPreds);
  const b = evalOf(basePreds);
  const result = Object.assign(base, { model: m.out, baseline: b.out });
  if (m.out.repurchased < minN) {
    return Object.assign(result, {
      state: 'insufficient',
      verdict: { selected: 'baseline', reason: `Only ${m.out.repurchased} customer-product pairs re-bought inside the ${holdoutWeeks}-week holdout; ${minN} are needed to judge the model, so the baseline (product median for everyone) is used.` },
    });
  }
  // Paired bootstrap of the MAE difference (baseline - model) over the SAME pairs.
  const diffs = m.errs.map((e, i) => b.errs[i] - e);
  const rnd = mulberry32(BOOTSTRAP_SEED + 1);
  const boots = [];
  for (let k = 0; k < BOOTSTRAP_RESAMPLES; k++) {
    let s = 0;
    for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(rnd() * diffs.length)];
    boots.push(s / diffs.length);
  }
  const sb = sortedCopy(boots);
  const ci = [round1(quantileSorted(sb, 0.025)), round1(quantileSorted(sb, 0.975))];
  const improvement = round1(mean(diffs));
  const hitOk = (m.out.hit_rate || 0) >= (b.out.hit_rate || 0);
  const beats = ci[0] > 0 && hitOk;
  return Object.assign(result, {
    state: 'ok',
    mae_improvement_days: { estimate: improvement, ci95: ci },
    verdict: beats
      ? { selected: 'model', reason: `The per-customer model's next-purchase error is ${m.out.mae_days} days against the baseline's ${b.out.mae_days} (improvement ${improvement} days, 95% interval ${ci[0]} to ${ci[1]}), and its hit-rate is ${m.out.hit_rate} against ${b.out.hit_rate}. The model is used.` }
      : { selected: 'baseline', reason: `The per-customer model did not beat the baseline on this history: error ${m.out.mae_days} vs ${b.out.mae_days} days (improvement ${improvement}, 95% interval ${ci[0]} to ${ci[1]}${ci[0] > 0 ? '' : ', which includes no improvement'}), hit-rate ${m.out.hit_rate} vs ${b.out.hit_rate}${hitOk ? '' : ' (lower)'}. The baseline - the product median for every customer - is used.` },
  });
}

/* ── the analysis ─────────────────────────────────────────────────────────── */

function publicFit(f) {
  if (f.state !== 'ok') {
    return { key: f.key, market: f.market, level: f.level, value: f.value, state: f.state, buyers: f.buyers, n_customers: f.n_customers, n_intervals: f.n_intervals, reason: f.reason };
  }
  return {
    key: f.key, market: f.market, level: f.level, value: f.value, state: 'ok',
    buyers: f.buyers, n_customers: f.n_customers, n_intervals: f.n_intervals,
    distribution: f.distribution, normalised_distribution: f.normalised_distribution,
    quantity: f.quantity, shrinkage: f.shrinkage, lead: f.lead,
  };
}

/** Attach in-process data without putting customer rows on the wire. */
function hidden(obj, name, value) {
  Object.defineProperty(obj, name, { value, enumerable: false, configurable: true, writable: true });
}

const MEMO = new WeakMap();

/**
 * The whole analysis for one history.
 *
 * `predictions` (one per customer and product group) and `contacts` are
 * attached NON-ENUMERABLE: the planner reads them in-process, while anything
 * that serialises the analysis - an API response, a stored run - carries the
 * distributions, the backtest and the counts, not a list of customers.
 *
 * Memoised per history object: the bundled export is one shared, immutable
 * history, so a warm runtime fits it once, not once per request.
 */
function analyse(hist, { holdoutWeeks = HOLDOUT_WEEKS, minN = MIN_REPEAT_CUSTOMERS, contacts = null } = {}) {
  const h = hist || noHistory();
  const memoKey = `${holdoutWeeks}|${minN}`;
  const memo = MEMO.get(h) || {};
  let core = memo[memoKey];
  if (!core) {
    core = analyseCore(h, holdoutWeeks, minN);
    memo[memoKey] = core;
    MEMO.set(h, memo);
  }
  if (!contacts) return core;
  const out = Object.assign({}, core);
  hidden(out, 'predictions', core.predictions);
  hidden(out, 'contacts', contactsIndex(contacts));
  return out;
}

/** Product groups are what a prediction is made FOR: a product type, or a SKU
 *  whose lines state no type. A SKU below the threshold inside a type that has
 *  enough history is not "unpredictable" - it falls back to its type - so it is
 *  counted, not listed one row per SKU per market. */
function isGroupFit(f, typeless) { return f.level === 'type' || typeless.has(f.key); }

function analyseCore(h, holdoutWeeks, minN) {
  const source = {
    kind: h.kind, label: h.label || null, synthetic: !!h.synthetic, synthetic_evidence: h.synthetic_evidence || null,
    history_start: h.history_start, history_end: h.history_end,
    lines: (h.lines || []).length, customers: h.customers || 0,
    dropped: h.dropped || {}, excluded_orders: h.excluded_orders || null,
    truncated: !!h.truncated, complete_from: h.complete_from || null,
  };
  let out;
  if (!h.lines || !h.lines.length) {
    out = {
      version: MODEL_VERSION, state: 'no_history', source, min_repeat_customers: minN,
      products: [], method: null, backtest: null,
      note: `${h.reason || NO_HISTORY_MARKER} No order history is available to this brand, so no repurchase interval is measured and no replenishment trigger is planned. Intervals are never assumed from a consumption rate or a pack size.`,
    };
    hidden(out, 'predictions', []);
  } else {
    const model = fitAll(h.lines, minN);
    const bt = backtest(h.lines, { holdoutWeeks, minN });
    const selected = (bt.verdict && bt.verdict.selected) || 'baseline';
    const { predictions, insufficient } = predictAll(model, selected);
    const fits = [...model.fits.values()];
    const listed = fits.filter((f) => f.state === 'ok' || isGroupFit(f, model.ev.typeless));
    const skuFallbacks = fits.filter((f) => f.state !== 'ok' && !isGroupFit(f, model.ev.typeless));
    const products = listed.map(publicFit).sort((a, b) => (a.state === b.state ? (b.n_customers - a.n_customers || (a.key < b.key ? -1 : 1)) : (a.state === 'ok' ? -1 : 1)));
    const okCount = products.filter((p) => p.state === 'ok').length;
    out = {
      version: MODEL_VERSION,
      state: okCount ? 'ok' : 'insufficient_history',
      source,
      min_repeat_customers: minN,
      products,
      method: {
        selected,
        reason: (bt.verdict && bt.verdict.reason) || bt.reason || 'The backtest could not run, so the baseline is used.',
      },
      backtest: bt,
      counts: {
        products_with_interval: okCount,
        products_insufficient: products.length - okCount,
        customers_predicted: new Set(predictions.map((p) => p.customer_id)).size,
        predictions: predictions.length,
        customers_unpredictable: [...insufficient.values()].reduce((s, n) => s + n, 0),
      },
      // SKUs below the threshold whose product type carries the prediction.
      sku_fallbacks: {
        count: skuFallbacks.length,
        max_repeat_customers: skuFallbacks.reduce((mx, f) => Math.max(mx, f.n_customers), 0),
        note: `${skuFallbacks.length} SKU-market pair(s) have fewer than ${minN} repeat buyers of that exact SKU; a customer who last bought one is predicted from its product type when the type has enough history, and is otherwise counted as unpredictable.`,
      },
      note: okCount
        ? `${okCount} product group(s) have at least ${minN} repeat buyers; ${products.length - okCount} report insufficient_history with their counts. Intervals are measured from ${source.lines} order lines (${source.history_start} to ${source.history_end}); none is assumed.`
        : `No product in this history has ${minN} customers who bought it twice, so no interval is reported and no trigger is planned. Every product reports insufficient_history with its count.`,
    };
    hidden(out, 'predictions', predictions);
  }
  if (source.truncated) {
    out.note += ` Only the newest ${source.lines} order lines fit under the read ceiling: orders before ${source.complete_from} were not read, so a customer's earlier purchases can be missing and some repeat buyers read as first-time.`;
  }
  return out;
}

/**
 * Contact evidence by customer id, kept only when it carries engagement, send
 * or suppression history. Takes either rows carrying their own id, or a Map
 * already keyed by CUSTOMER id - which is what
 * SmartBrainDbAdapter.engagementContacts() builds from the workspace's
 * subscriber_engagement_scores (an engagement row's own id is a profile id,
 * not a customer id, so the key is the join's, not the row's).
 */
function contactsIndex(rows) {
  const map = new Map();
  const entries = rows instanceof Map
    ? [...rows.entries()]
    : (Array.isArray(rows) ? rows : []).map((r) => [r && (r.id != null ? r.id : r.customer_id), r]);
  for (const [key, r] of entries) {
    if (!r || key == null || key === '') continue;
    const hasSends = r.sends_7d != null && r.sends_7d !== '' && Number.isFinite(Number(r.sends_7d));
    const hasEng = !!(r.last_open_at || r.last_click_at || r.hard_bounced || r.complained || r.suppressed);
    if (!hasSends && !hasEng) continue;
    map.set(String(key), r);
  }
  return map;
}

/* ── due windows for a plan ───────────────────────────────────────────────── */

/**
 * Who is due inside [startDate, startDate + days), grouped into weekly sends.
 *
 * A customer is DUE when their trigger date falls before the horizon ends and
 * their lapse date has not passed by the start. Each bucket is sent on the
 * EARLIEST trigger date in it, so nobody in a bucket is mailed after their own
 * trigger. Customers whose total order count is one are split from repeat
 * customers: for them the next order is Order #2, which is a different job.
 *
 * ONE PRODUCT GROUP PER BUCKET (review finding on #135). The key used to be
 * market|week|cohort, so customers due for different products in the same
 * week shared one slot - and the slot's single hero was the first product's,
 * so every buyer of the second product was sent the first one's creative. The
 * group is part of the key now, and `last_bought` maps every customer in a
 * bucket to the SKU they last bought in that group, so the claim "each
 * recipient sees the product they bought" is carried as data, not asserted.
 *
 * ONE REPLENISHMENT SEND PER CUSTOMER PER WEEK. A customer due for two product
 * groups in the same week is planned for the one due FIRST, and the other is
 * counted (`same_week_other_product`), so splitting buckets by product cannot
 * double the pressure on one person.
 */
function dueBuckets(analysis, { startDate, days = 90, markets = null, bucketDays = BUCKET_DAYS } = {}) {
  const preds = (analysis && analysis.predictions) || [];
  const S = dayOf(startDate);
  const E = S + Math.max(1, Number(days) || 1);
  const allow = Array.isArray(markets) && markets.length ? new Set(markets.map((m) => marketOf(m))) : null;
  const counts = { due: 0, lapsed: 0, not_yet: 0, out_of_market: 0, same_week_other_product: 0 };
  const outOfMarket = {};
  const firstPerWeek = new Map();
  for (const p of preds) {
    if (p.trigger_day >= E) { counts.not_yet += 1; continue; }
    if (p.lapse_day < S) { counts.lapsed += 1; continue; }
    if (allow && !allow.has(p.market)) { counts.out_of_market += 1; outOfMarket[p.market] = (outOfMarket[p.market] || 0) + 1; continue; }
    counts.due += 1;
    const sendDay = Math.max(p.trigger_day, S);
    const week = Math.floor((sendDay - S) / bucketDays);
    const k = `${p.market}|${p.customer_id}|${week}`;
    const cur = firstPerWeek.get(k);
    if (!cur || p.trigger_day < cur.p.trigger_day || (p.trigger_day === cur.p.trigger_day && p.group < cur.p.group)) firstPerWeek.set(k, { p, sendDay, week });
  }
  counts.same_week_other_product = counts.due - firstPerWeek.size;

  const fitByKey = new Map(((analysis && analysis.products) || []).map((f) => [f.key, f]));
  const buckets = new Map();
  for (const { p, sendDay, week } of firstPerWeek.values()) {
    const cohort = p.total_orders <= 1 ? 'second_order' : 'repeat';
    const bk = `${p.market}|${week}|${cohort}|${p.group}`;
    let b = buckets.get(bk);
    if (!b) {
      const g = fitByKey.get(p.group);
      b = {
        market: p.market, week, cohort, sendDay, group: p.group,
        group_label: (g && g.value) || (p.product && (p.product.type || p.product.sku)) || p.group,
        customers: new Set(), byKey: new Map(), lastBought: new Map(), skus: new Map(),
      };
      buckets.set(bk, b);
    }
    if (sendDay < b.sendDay) b.sendDay = sendDay;
    b.customers.add(p.customer_id);
    const k = b.byKey.get(p.key) || { key: p.key, level: p.level, due: 0, customers: new Set(), lastBought: new Map() };
    if (!k.customers.has(p.customer_id)) { k.customers.add(p.customer_id); k.due += 1; }
    b.byKey.set(p.key, k);
    if (p.product && p.product.sku) {
      b.lastBought.set(p.customer_id, p.product.sku);
      if (!b.skus.has(p.product.sku)) b.skus.set(p.product.sku, p.product.title || null);
    }
    // What these customers last bought IN THIS GROUP - the slot's hero.
    if (p.product && (p.product.sku || p.product.type)) {
      const hk = p.product.sku || `type:${p.product.type}`;
      const hero = k.lastBought.get(hk) || Object.assign({ count: 0 }, p.product);
      hero.count += 1;
      k.lastBought.set(hk, hero);
    }
  }
  const list = [...buckets.values()].map((b) => ({
    market: b.market,
    cohort: b.cohort,
    week: b.week,
    group: b.group,
    group_label: b.group_label,
    send_date: isoOf(b.sendDay),
    window: { from: isoOf(S + b.week * bucketDays), to: isoOf(Math.min(E, S + (b.week + 1) * bucketDays) - 1) },
    customer_ids: [...b.customers].sort(),
    last_bought: Object.fromEntries([...b.lastBought.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))),
    skus: Object.fromEntries(b.skus),
    products: [...b.byKey.values()].sort((x, y) => y.due - x.due || (x.key < y.key ? -1 : 1)).map((k) => {
      const f = fitByKey.get(k.key) || {};
      return {
        key: k.key, level: k.level, market: f.market || b.market, product: f.value || null, due: k.due,
        n_customers: f.n_customers, n_intervals: f.n_intervals,
        median_days: f.distribution ? f.distribution.median : null,
        p25_days: f.distribution ? f.distribution.p25 : null,
        p75_days: f.distribution ? f.distribution.p75 : null,
        lead: f.lead || null,
        quantity: f.quantity ? f.quantity.status : null,
        last_bought: [...k.lastBought.values()]
          .sort((x, y) => y.count - x.count || String(x.sku || x.type).localeCompare(String(y.sku || y.type)))
          .slice(0, 3),
      };
    }),
  })).sort((x, y) => (x.send_date < y.send_date ? -1 : x.send_date > y.send_date ? 1
    : x.market < y.market ? -1 : x.market > y.market ? 1
      : x.cohort < y.cohort ? -1 : x.cohort > y.cohort ? 1
        : (x.group < y.group ? -1 : x.group > y.group ? 1 : 0)));
  const lastDay = analysis && analysis.source && analysis.source.history_end ? dayOf(analysis.source.history_end) : null;
  return {
    as_of: isoOf(S),
    horizon_end: isoOf(E - 1),
    history_end: analysis && analysis.source ? analysis.source.history_end : null,
    history_age_days: lastDay != null ? S - lastDay : null,
    counts,
    out_of_market: outOfMarket,
    buckets: list,
  };
}

/** One line for the daily insights panel. Says the no-history state outright. */
function insight(analysis, due) {
  if (!analysis) return null;
  if (analysis.state === 'no_history') return `Replenishment: ${NO_HISTORY_MARKER} - no order history, so no repurchase interval is measured and no trigger is planned.`;
  if (analysis.state !== 'ok') return `Replenishment: no product has ${analysis.min_repeat_customers} repeat buyers yet; every product reports insufficient_history, so no trigger is planned.`;
  const ok = analysis.products.filter((p) => p.state === 'ok');
  const top = ok[0];
  const parts = [`Replenishment (${analysis.method.selected === 'model' ? 'per-customer model' : 'product-median baseline'}${analysis.source && analysis.source.synthetic ? ', on SAMPLE data, not real sales' : ''}): ${ok.length} product group(s) measured; ${top.value} (${top.market}) median ${top.distribution.median}d between purchases from ${top.n_customers} repeat buyers.`];
  if (due) {
    parts.push(`${due.counts.due} customer-product pair(s) due in this plan, ${due.counts.lapsed} past their window (lapsing, left to reactivation)${due.history_age_days != null && due.history_age_days > 0 ? `; history ends ${due.history_end}, ${due.history_age_days} days before this plan` : ''}.`);
  }
  return parts.join(' ');
}

module.exports = {
  MODEL_VERSION, MIN_REPEAT_CUSTOMERS, TRIGGER_QUANTILE, LAPSE_QUANTILE, HOLDOUT_WEEKS, BUCKET_DAYS, NO_HISTORY_MARKER,
  dayOf, isoOf, statedQty,
  linesFromSmartOrders, linesFromShopifyExport, loadBundledExport, history, noHistory,
  buildEvents, quantityEffect, shrinkage, fitAll, predictAll, backtest,
  analyse, dueBuckets, insight, contactsIndex,
  _internals: { quantileSorted, summarize, median, mulberry32 },
};
