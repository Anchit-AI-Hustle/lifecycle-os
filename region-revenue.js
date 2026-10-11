/**
 * region-revenue.js - revenue and sales PER REGION, from the brand's own data.
 * ===========================================================================
 * The operator (2026-10-11): "As a founder, I would look at revenue and sales
 * of each region. This app must support that. Multiple region selection must
 * be allowed too."
 *
 * Pure: no I/O. The server (region-revenue-server.js) reads the workspace's
 * own stored orders and hands them here; the browser loads the byte-identical
 * root /region-revenue.js and runs the SAME code over an order export kept on
 * this device for a device brand. One aggregation, two places it runs, so the
 * figures a founder reads cannot depend on where the brand is stored.
 *
 * The rules, each enforced here rather than left to a page:
 *   - ONE REGION'S FIGURES COME FROM THAT REGION'S ORDERS. An order belongs to
 *     the market it STATES (or, for a store order, the country it ships to
 *     when that country is one of the brand's markets). An order no market
 *     claims is counted as unattributed and said, never folded into a market.
 *   - NO SOURCE IS NOT ZERO. A region with no orders read gets the spec's
 *     marker for that region, never 0 and never another region's number.
 *   - EVERY FIGURE CARRIES ITS SOURCE AND WINDOW (`basis`, `window`).
 *   - NET ONLY WHERE STATED. Gross is the order totals as stated; net is gross
 *     minus refunds, and only when every order in the window states its refund
 *     (zero is a statement). Discounts likewise. Units only when every order
 *     states a quantity. Otherwise null with how many orders did state it.
 *   - EACH REGION IN ITS OWN CURRENCY. Two currencies are never added. A
 *     combined total across currencies exists only through rates the operator
 *     ENTERED (dated, with who entered them); otherwise the totals are per
 *     currency and `combined_reason` says why there is no single number.
 *
 * UMD: window.RegionRevenue in the browser, module.exports in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RegionRevenue = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var MAX_TOP = 10;
  /* Financial states that are not a completed sale (Shopify's own words). */
  var EXCLUDED_FINANCIAL = /^(voided|refunded|cancelled|canceled)$/i;

  /* The spellings a record, a store and an export use for ONE market. Same
     equivalence as region-context.js (labelling, never a list of markets:
     the markets are only ever the brand's). */
  var FAMILY = {
    US: 'US', USA: 'US', UNITEDSTATES: 'US', AMERICA: 'US',
    UK: 'UK', GB: 'UK', GBR: 'UK', UNITEDKINGDOM: 'UK', BRITAIN: 'UK', ENGLAND: 'UK',
    IN: 'IN', IND: 'IN', INDIA: 'IN', BHARAT: 'IN',
    GLOBAL: 'GLOBAL', WORLDWIDE: 'GLOBAL', ROW: 'GLOBAL', INTL: 'GLOBAL', INTERNATIONAL: 'GLOBAL', WW: 'GLOBAL',
    EU: 'EU', EUROPE: 'EU', AU: 'AU', AUS: 'AU', AUSTRALIA: 'AU', ME: 'ME', MIDDLEEAST: 'ME', AE: 'AE', UAE: 'AE',
  };
  function family(v) {
    var k = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z]/g, '');
    return FAMILY[k] || k;
  }

  /** The brand's own code for a market spelt any way, or ''. */
  function resolveRegion(v, regions) {
    var f = family(v);
    if (!f) return '';
    var list = Array.isArray(regions) ? regions : [];
    for (var i = 0; i < list.length; i++) {
      var c = String((list[i] && list[i].code) || '').toUpperCase();
      if (c && (c === String(v).toUpperCase() || family(c) === f)) return c;
    }
    return '';
  }

  function marker(field, brand, region) {
    return '[DATA REQUIRED BEFORE LAUNCH: ' + field + ', ' + (brand || 'this brand') + (region ? ', ' + region : '') + ']';
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(String(v).replace(/[,\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }
  function cur(v) { var c = String(v == null ? '' : v).trim().toUpperCase(); return /^[A-Z]{3}$/.test(c) ? c : ''; }

  /* ── days ────────────────────────────────────────────────────────────── */
  /** 'YYYY-MM-DD' of an instant in a time zone ('' zone = UTC), or ''. */
  function dayOf(at, timeZone) {
    if (at == null || at === '') return '';
    var s = String(at);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var t = Date.parse(s);
    if (!isFinite(t)) return '';
    if (timeZone) {
      try {
        var parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t));
        var o = {};
        parts.forEach(function (p) { o[p.type] = p.value; });
        if (o.year && o.month && o.day) return o.year + '-' + o.month + '-' + o.day;
      } catch (e) { /* an unknown zone: UTC, and the basis says which */ }
    }
    return new Date(t).toISOString().slice(0, 10);
  }
  function dnum(day) { return Math.round(Date.parse(day + 'T00:00:00Z') / DAY); }
  function dstr(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function addDays(day, k) { return dstr(dnum(day) + k); }
  function bucketOf(day, gran) {
    if (gran === 'month') return day.slice(0, 7);
    if (gran === 'week') {
      var n = dnum(day);
      var dow = (new Date(n * DAY).getUTCDay() + 6) % 7;   // Monday = 0
      return dstr(n - dow);
    }
    return day;
  }

  /* ── normalisers: one shape for every source ─────────────────────────── */
  /*
   * { id, region, currency, day, gross, discount, refund, units, customer, lines[] }
   * `gross` is the order total as the source states it. discount / refund /
   * units are null when the source does not state them.
   */
  function linesOf(items) {
    var out = [];
    (Array.isArray(items) ? items : []).forEach(function (li) {
      if (!li || typeof li !== 'object') return;
      var qty = num(li.quantity != null ? li.quantity : li.qty);
      var price = num(li.price);
      var amount = num(li.amount != null ? li.amount : li.line_total);
      if (amount == null && price != null && qty != null) amount = price * qty;
      out.push({ sku: String(li.sku || li.product_sku || '').trim(), title: String(li.title || li.name || li.product || '').trim(), handle: String(li.handle || '').trim(), qty: qty, amount: amount });
    });
    return out;
  }
  function unitsOf(lines, stated) {
    if (stated != null) return stated;
    if (!lines.length) return null;
    var s = 0;
    for (var i = 0; i < lines.length; i++) { if (lines[i].qty == null) return null; s += lines[i].qty; }
    return s;
  }
  function tzFor(region, regions) {
    var list = Array.isArray(regions) ? regions : [];
    for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].code).toUpperCase() === region) return list[i].timezone || '';
    return '';
  }
  function pushOrder(out, dropped, o) {
    if (o.gross == null) { dropped.no_total = (dropped.no_total || 0) + 1; return; }
    if (!o.day) { dropped.no_date = (dropped.no_date || 0) + 1; return; }
    out.push(o);
  }

  /** The workspace's synced orders (smart_orders: id, user_id, market, total, created_at, product_sku, metadata). */
  function fromSmartOrders(rows, regions) {
    var out = [], dropped = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r) return;
      var md = (r.metadata && typeof r.metadata === 'object') ? r.metadata : {};
      if (r.cancelled_at || md.cancelled_at || EXCLUDED_FINANCIAL.test(String(md.financial_status || r.financial_status || ''))) { dropped.cancelled_or_refunded = (dropped.cancelled_or_refunded || 0) + 1; return; }
      var region = resolveRegion(r.market || md.market || md.region, regions);
      var lines = linesOf(md.line_items);
      if (!lines.length && (r.product_sku || md.sku || md.title)) lines = [{ sku: String(r.product_sku || md.sku || '').trim(), title: String(md.title || '').trim(), handle: String(md.handle || '').trim(), qty: num(md.quantity != null ? md.quantity : r.quantity), amount: null }];
      pushOrder(out, dropped, {
        id: String(r.id), region: region, market_raw: String(r.market || md.market || ''),
        currency: cur(md.currency || md.presentment_currency || r.currency),
        day: dayOf(r.created_at || md.created_at, tzFor(region, regions)),
        gross: num(r.total), discount: num(md.total_discounts != null ? md.total_discounts : md.discount),
        refund: num(md.total_refunded != null ? md.total_refunded : md.refund),
        units: unitsOf(lines, num(md.quantity)), customer: r.user_id != null && r.user_id !== '' ? String(r.user_id) : null, lines: lines,
      });
    });
    return { orders: out, dropped: dropped };
  }

  /** Shopify orders polled into shopify_orders (raw_payload is the Admin order). */
  function fromShopifyOrders(rows, regions) {
    var out = [], dropped = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r) return;
      var p = (r.raw_payload && typeof r.raw_payload === 'object') ? r.raw_payload : {};
      if (p.cancelled_at || EXCLUDED_FINANCIAL.test(String(p.financial_status || ''))) { dropped.cancelled_or_refunded = (dropped.cancelled_or_refunded || 0) + 1; return; }
      var ship = p.shipping_address || p.billing_address || {};
      var region = resolveRegion(ship.country_code || ship.country || '', regions);
      var refund = null;
      if (Array.isArray(p.refunds)) {
        refund = 0;
        p.refunds.forEach(function (rf) {
          (Array.isArray(rf && rf.transactions) ? rf.transactions : []).forEach(function (t) {
            if (t && /refund/i.test(String(t.kind || 'refund')) && !/failure|error/i.test(String(t.status || ''))) refund += num(t.amount) || 0;
          });
        });
      }
      var lines = linesOf(p.line_items);
      pushOrder(out, dropped, {
        id: String(r.shopify_order_id || p.id || r.id), region: region, market_raw: String(ship.country_code || ''),
        currency: cur(r.currency || p.currency || p.presentment_currency),
        day: dayOf(r.created_at_shopify || p.created_at, tzFor(region, regions)),
        gross: num(r.total_price != null ? r.total_price : p.total_price),
        discount: num(p.total_discounts), refund: refund,
        units: unitsOf(lines, null),
        customer: p.customer && p.customer.id != null ? String(p.customer.id) : null, lines: lines,
      });
    });
    return { orders: out, dropped: dropped };
  }

  /* A CSV the operator exports from their own store, kept on this device for
     a device brand. Header names are matched loosely; a row repeats per line
     item and the order total is read from the first row that states it. */
  var CSV_COLS = {
    id: ['id', 'order_id', 'order', 'name', 'order_number'],
    region: ['region', 'market', 'country', 'shipping_country', 'shipping_country_code'],
    at: ['ordered_at', 'created_at', 'date', 'order_date', 'processed_at'],
    total: ['total', 'order_total', 'total_price', 'amount'],
    currency: ['currency'],
    customer: ['customer_id', 'customer', 'email_hash'],
    sku: ['sku', 'lineitem_sku', 'product_sku'],
    title: ['title', 'product', 'lineitem_name', 'product_title'],
    qty: ['qty', 'quantity', 'lineitem_quantity'],
    price: ['price', 'lineitem_price'],
    discount: ['discount', 'discount_amount', 'total_discounts'],
    refund: ['refund', 'refunded', 'refunded_amount', 'total_refunded'],
    status: ['financial_status', 'status'],
  };
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false, s = String(text || '');
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(function (c) { return c !== ''; })) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(function (c) { return c !== ''; })) rows.push(row);
    return rows;
  }
  function fromCsv(text, regions) {
    var grid = parseCsv(text);
    var dropped = {};
    if (grid.length < 2) return { orders: [], dropped: { empty: 1 }, columns: {} };
    var head = grid[0].map(function (h) { return String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); });
    var col = {};
    Object.keys(CSV_COLS).forEach(function (k) {
      for (var i = 0; i < CSV_COLS[k].length; i++) { var j = head.indexOf(CSV_COLS[k][i]); if (j >= 0) { col[k] = j; return; } }
    });
    if (col.id == null || col.total == null || col.at == null) return { orders: [], dropped: { missing_columns: 1 }, columns: col, missing: ['id', 'total', 'ordered_at'].filter(function (k, i) { return [col.id, col.total, col.at][i] == null; }) };
    var by = {}, order = [];
    for (var r = 1; r < grid.length; r++) {
      var g = grid[r];
      var get = function (k) { return col[k] == null ? '' : String(g[col[k]] == null ? '' : g[col[k]]).trim(); };
      var id = get('id');
      if (!id) { dropped.no_id = (dropped.no_id || 0) + 1; continue; }
      var o = by[id];
      if (!o) { o = by[id] = { id: id, raw: {}, lines: [] }; order.push(id); }
      ['region', 'at', 'total', 'currency', 'customer', 'discount', 'refund', 'status'].forEach(function (k) { if (o.raw[k] == null && get(k) !== '') o.raw[k] = get(k); });
      if (get('sku') || get('title')) o.lines.push({ sku: get('sku'), title: get('title'), qty: num(get('qty')), price: num(get('price')) });
    }
    var out = [];
    order.forEach(function (id) {
      var o = by[id];
      if (EXCLUDED_FINANCIAL.test(String(o.raw.status || ''))) { dropped.cancelled_or_refunded = (dropped.cancelled_or_refunded || 0) + 1; return; }
      var region = resolveRegion(o.raw.region, regions);
      var lines = linesOf(o.lines);
      pushOrder(out, dropped, {
        id: id, region: region, market_raw: String(o.raw.region || ''), currency: cur(o.raw.currency),
        day: dayOf(o.raw.at, tzFor(region, regions)), gross: num(o.raw.total),
        discount: num(o.raw.discount), refund: col.refund == null ? null : (num(o.raw.refund) == null ? 0 : num(o.raw.refund)),
        units: unitsOf(lines, null), customer: o.raw.customer || null, lines: lines,
      });
    });
    return { orders: out, dropped: dropped, columns: col };
  }

  /* ── the aggregation ─────────────────────────────────────────────────── */
  function regionRow(regions, code) {
    var list = Array.isArray(regions) ? regions : [];
    for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].code).toUpperCase() === code) return list[i];
    return null;
  }

  /**
   * The window the figures cover: { from, to } inclusive days. `days` back
   * from `to` (default today in UTC) when no `from` is named.
   */
  function windowOf(opts) {
    var o = opts || {};
    var today = o.today || new Date().toISOString().slice(0, 10);
    var to = /^\d{4}-\d{2}-\d{2}$/.test(String(o.to || '')) ? o.to : today;
    var days = Math.max(1, Math.min(3660, Number(o.days) || 30));
    var from = /^\d{4}-\d{2}-\d{2}$/.test(String(o.from || '')) ? o.from : addDays(to, -(days - 1));
    if (from > to) { var t = from; from = to; to = t; }
    var len = dnum(to) - dnum(from) + 1;
    return { from: from, to: to, days: len, prev: { from: addDays(from, -len), to: addDays(from, -1), days: len } };
  }

  /** The bucket a trend uses: the one asked for, else one that keeps it readable. */
  function granularityFor(days, asked) {
    return /^(day|week|month)$/.test(String(asked || '')) ? asked : (days > 120 ? 'month' : (days > 31 ? 'week' : 'day'));
  }

  function fig(value, extra) { var f = { value: value }; for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) f[k] = extra[k]; return f; }

  /**
   * Per-region figures for the SELECTED regions.
   * opts: { regions:[{code,currency,timezone,home}], selected:[codes], from, to,
   *         days, today, granularity: day|week|month, brand, source:{kind,label},
   *         catalogue:[{region, sku, handle, title}], unattributed: n,
   *         complete_from: 'YYYY-MM-DD' | null }
   */
  function aggregate(orders, opts) {
    var o = opts || {};
    var regions = Array.isArray(o.regions) ? o.regions : [];
    var w = windowOf(o);
    var gran = granularityFor(w.days, o.granularity);
    var src = o.source || { kind: 'orders', label: 'orders' };
    var selected = (Array.isArray(o.selected) && o.selected.length ? o.selected : regions.filter(function (r) { return r.home; }).map(function (r) { return r.code; }))
      .map(function (c) { return resolveRegion(c, regions); })
      .filter(function (c, i, a) { return c && a.indexOf(c) === i; });
    var byRegion = {};
    (Array.isArray(orders) ? orders : []).forEach(function (x) {
      if (!x || !x.region) return;
      (byRegion[x.region] = byRegion[x.region] || []).push(x);
    });
    var out = {};
    selected.forEach(function (code) {
      out[code] = one(code, byRegion[code] || [], regionRow(regions, code), w, gran, o, src);
    });
    return { window: w, granularity: gran, selected: selected, regions: out };
  }

  function one(code, all, row, w, gran, o, src) {
    var brand = o.brand || 'this brand';
    var recCurrency = cur(row && row.currency);
    if (!all.length) {
      return {
        code: code, available: false, source: src, window: { from: w.from, to: w.to },
        marker: marker('order history', brand, code),
        reason: 'No ' + src.label + ' for ' + code + ' were read, so there is no figure for this market. Nothing is borrowed from another market.',
      };
    }
    var basisWindow = { from: w.from, to: w.to };
    var earliest = all.reduce(function (m, x) { return !m || x.day < m ? x.day : m; }, '');
    var latest = all.reduce(function (m, x) { return !m || x.day > m ? x.day : m; }, '');
    if (w.to < earliest) {
      return {
        code: code, available: false, source: src, window: { from: w.from, to: w.to }, data_span: { earliest: earliest, latest: latest },
        marker: marker('order history ' + w.from + ' to ' + w.to, brand, code),
        reason: 'The ' + src.label + ' read for ' + code + ' start ' + earliest + ', after this window ends, so the window is unknown rather than zero.',
      };
    }
    var inW = all.filter(function (x) { return x.day >= w.from && x.day <= w.to; });
    var inP = all.filter(function (x) { return x.day >= w.prev.from && x.day <= w.prev.to; });
    var currencyOf = function (x) { return x.currency || recCurrency || ''; };
    var currencies = [];
    inW.forEach(function (x) { var c = currencyOf(x); if (currencies.indexOf(c) < 0) currencies.push(c); });
    var stated = inW.filter(function (x) { return !!x.currency; }).length;
    var currency = currencies.length === 1 ? currencies[0] : (currencies.length ? null : (recCurrency || ''));
    var curBasis = !inW.length ? (recCurrency ? 'the brand record' : '')
      : (stated === inW.length ? 'stated on every order' : (stated ? 'stated on ' + stated + ' of ' + inW.length + ' orders; the rest take the brand record\'s currency for ' + code : 'the brand record\'s currency for ' + code + ' (the orders state none)'));
    var notes = [];
    if (currency === '') notes.push(marker('currency', brand, code));
    var sum = function (list, k) { var s = 0; for (var i = 0; i < list.length; i++) s += list[i][k] || 0; return s; };
    var allStated = function (list, k) { for (var i = 0; i < list.length; i++) if (list[i][k] == null) return false; return true; };
    var countStated = function (list, k) { return list.filter(function (x) { return x[k] != null; }).length; };
    var base = { source: src.label, window: basisWindow };
    var mixed = currency === null;
    var gross = mixed ? null : round2(sum(inW, 'gross'));
    var figures = {};
    figures.revenue = fig(gross, Object.assign({ currency: currency, basis: 'gross: order totals as stated' + (mixed ? '; not summed, the orders are in ' + currencies.join(' and ') : '') }, base));
    var refundsStated = allStated(inW, 'refund');
    figures.refunds = fig(refundsStated && !mixed ? round2(sum(inW, 'refund')) : null, Object.assign({ currency: currency, basis: refundsStated ? 'refunds stated on every order' : 'refunds stated on ' + countStated(inW, 'refund') + ' of ' + inW.length + ' orders' }, base));
    figures.net = fig(refundsStated && !mixed && inW.length ? round2(gross - figures.refunds.value) : null, Object.assign({
      currency: currency,
      basis: refundsStated && inW.length ? 'gross minus stated refunds' : 'not shown: refunds are not stated on every order in this window (' + countStated(inW, 'refund') + ' of ' + inW.length + ')',
    }, base));
    var discStated = allStated(inW, 'discount');
    figures.discounts = fig(discStated && !mixed && inW.length ? round2(sum(inW, 'discount')) : null, Object.assign({ currency: currency, basis: discStated && inW.length ? 'discounts stated on every order' : 'discounts stated on ' + countStated(inW, 'discount') + ' of ' + inW.length + ' orders' }, base));
    figures.orders = fig(inW.length, Object.assign({ basis: 'completed orders (cancelled, voided and fully refunded excluded)' }, base));
    var unitsStated = allStated(inW, 'units');
    figures.units = fig(unitsStated ? sum(inW, 'units') : null, Object.assign({ basis: unitsStated ? 'quantities stated on every order' : 'quantities stated on ' + countStated(inW, 'units') + ' of ' + inW.length + ' orders' }, base));
    figures.aov = fig(!mixed && inW.length ? round2(gross / inW.length) : null, Object.assign({ currency: currency, basis: 'revenue / orders' }, base));
    // Customers: only orders that NAME one. First order is read from this
    // market's own orders, never another market's.
    var firstDay = {};
    all.forEach(function (x) { if (x.customer && (!firstDay[x.customer] || x.day < firstDay[x.customer])) firstDay[x.customer] = x.day; });
    var custs = {};
    var anon = 0;
    inW.forEach(function (x) { if (x.customer) custs[x.customer] = 1; else anon += 1; });
    var ids = Object.keys(custs);
    var nNew = ids.filter(function (c) { return firstDay[c] >= w.from; }).length;
    var history = o.complete_from ? 'orders read from ' + o.complete_from : 'orders read since ' + earliest;
    var custBasis = 'distinct customers named on orders' + (anon ? '; ' + anon + ' order' + (anon === 1 ? '' : 's') + ' name no customer and are not counted' : '');
    figures.customers = fig(ids.length || anon === 0 ? ids.length : null, Object.assign({ basis: custBasis }, base));
    figures.new_customers = fig(ids.length || !anon ? nNew : null, Object.assign({ basis: 'first order in ' + code + ' falls in this window (' + history + ')' }, base));
    figures.returning_customers = fig(ids.length || !anon ? ids.length - nNew : null, Object.assign({ basis: 'ordered in ' + code + ' before this window (' + history + ')' }, base));

    // Previous period: only when the orders read reach back to its start.
    var previous;
    if (earliest > w.prev.from) {
      previous = { available: false, window: { from: w.prev.from, to: w.prev.to }, reason: 'The orders read for ' + code + ' start ' + earliest + ', after the previous period began (' + w.prev.from + '), so there is no like-for-like comparison.' };
    } else {
      var pc = []; inP.forEach(function (x) { var c = currencyOf(x); if (pc.indexOf(c) < 0) pc.push(c); });
      var pMixed = pc.length > 1 || (pc.length === 1 && currency !== null && pc[0] !== currency);
      var pg = pMixed ? null : round2(sum(inP, 'gross'));
      previous = {
        available: true, window: { from: w.prev.from, to: w.prev.to },
        revenue: pg, orders: inP.length, currency: pMixed ? null : (currency || pc[0] || ''),
        revenue_change_pct: pg && gross != null ? Math.round(((gross - pg) / pg) * 1000) / 10 : null,
        orders_change_pct: inP.length ? Math.round(((inW.length - inP.length) / inP.length) * 1000) / 10 : null,
        basis: 'the ' + w.days + ' days immediately before this window',
      };
    }

    // Trend: a bucket before the first order read is unknown (null), not 0.
    var buckets = [], seen = {};
    for (var d = dnum(w.from); d <= dnum(w.to); d++) {
      var key = bucketOf(dstr(d), gran);
      if (!seen[key]) { seen[key] = { key: key, first: dstr(d), revenue: 0, orders: 0 }; buckets.push(seen[key]); }
    }
    inW.forEach(function (x) { var b = seen[bucketOf(x.day, gran)]; if (b) { b.revenue += x.gross || 0; b.orders += 1; } });
    var points = buckets.map(function (b) {
      var before = bucketOf(earliest, gran) > b.key;
      return { key: b.key, revenue: before || mixed ? null : round2(b.revenue), orders: before ? null : b.orders, before_data: before };
    });

    // Top products, joined to THIS region's catalogue only.
    var cat = (Array.isArray(o.catalogue) ? o.catalogue : []).filter(function (p) { return p && resolveRegion(p.region, o.regions) === code; });
    var catBy = {};
    cat.forEach(function (p) { [p.sku, p.handle].forEach(function (k) { if (k) catBy[String(k).toLowerCase()] = p; }); if (p.title) catBy['t:' + String(p.title).toLowerCase()] = p; });
    var prod = {};
    var lineAmounts = true;
    inW.forEach(function (x) {
      var single = x.lines.length === 1;
      x.lines.forEach(function (li) {
        var key = (li.sku || li.handle || ('t:' + li.title)).toLowerCase();
        if (!key || key === 't:') return;
        var p = prod[key] = prod[key] || { key: key, sku: li.sku || null, title: li.title || '', revenue: 0, revenue_known: true, units: 0, units_known: true, orders: {} };
        var amt = li.amount != null ? li.amount : (single ? x.gross : null);
        if (amt == null) { p.revenue_known = false; lineAmounts = false; } else p.revenue += amt;
        if (li.qty == null) p.units_known = false; else p.units += li.qty;
        p.orders[x.id] = 1;
      });
    });
    var rows = Object.keys(prod).map(function (k) {
      var p = prod[k];
      var c = (p.sku && catBy[p.sku.toLowerCase()]) || catBy[k] || (p.title && catBy['t:' + p.title.toLowerCase()]) || null;
      return {
        sku: p.sku, title: (c && c.title) || p.title || p.sku, in_catalogue: !!c, handle: c ? (c.handle || null) : null,
        revenue: p.revenue_known && !mixed ? round2(p.revenue) : null, units: p.units_known ? p.units : null, orders: Object.keys(p.orders).length,
      };
    });
    rows.sort(function (a, b) { return ((b.revenue == null ? -1 : b.revenue) - (a.revenue == null ? -1 : a.revenue)) || (b.orders - a.orders) || String(a.title).localeCompare(String(b.title)); });
    var byCurrency = null;
    if (mixed) {
      byCurrency = currencies.map(function (c) {
        var l = inW.filter(function (x) { return currencyOf(x) === c; });
        return { currency: c, revenue: round2(sum(l, 'gross')), orders: l.length };
      });
      notes.push('Orders in ' + code + ' are in ' + currencies.join(' and ') + '; each currency is shown on its own and never added together.');
    }
    if (earliest > w.from) notes.push('The orders read for ' + code + ' start ' + earliest + '; the part of this window before that is unknown, not zero.');
    if (o.truncated) notes.push(o.truncated);
    return {
      code: code, available: true, source: src, window: basisWindow, currency: currency, currency_basis: curBasis,
      data_span: { earliest: earliest, latest: latest },
      figures: figures, previous: previous, by_currency: byCurrency,
      trend: { granularity: gran, window: basisWindow, basis: 'order totals per ' + gran + (gran === 'day' ? '' : ' (weeks start Monday)') + '; a ' + gran + ' before the first order read is unknown, not zero', points: points },
      top_products: { window: basisWindow, basis: (lineAmounts ? 'line amounts as stated' : 'line amounts where stated (a single-line order counts its total)') + '; matched to ' + code + '\'s own catalogue (' + cat.length + ' products)', rows: rows.slice(0, MAX_TOP) },
      notes: notes,
    };
  }

  /**
   * One region's figures from tenant zero's bundled SALES EXPORT (aggregates,
   * not orders). Every figure keeps the window the export states it for: the
   * monthly series is sliced to whole months inside the asked window; the
   * summary, customers and top products are the export's WHOLE window.
   */
  function fromExport(market, code, opts) {
    var o = opts || {};
    var w = windowOf(o);
    var brand = o.brand || 'this brand';
    var src = { kind: 'bundled_export', label: o.label || 'the store\'s sales export compiled into this build' };
    if (!market || !market.summary) {
      return { code: code, available: false, source: src, window: { from: w.from, to: w.to }, marker: marker('order history', brand, code), reason: 'The sales export holds no ' + code + ' figures.' };
    }
    var monthly = Array.isArray(market.monthly) ? market.monthly : [];
    var months = monthly.map(function (m) { return String(m.month || '').slice(0, 7); }).filter(Boolean).sort();
    var span = { from: months.length ? months[0] + '-01' : null, to: months.length ? lastDay(months[months.length - 1]) : null };
    var s = market.summary || {};
    var basis = market.summary_basis || {};
    var measured = function (k) { return basis[k] ? basis[k] === 'measured' : s[k] != null; };
    var val = function (k) { return measured(k) && s[k] != null ? Number(s[k]) : null; };
    var currency = cur(o.currency);
    var whole = { source: src.label, window: span };
    var inside = monthly.filter(function (m) { var k = String(m.month || '').slice(0, 7); return k + '-01' >= w.from && lastDay(k) <= w.to; });
    var winSpan = inside.length ? { from: String(inside[0].month).slice(0, 7) + '-01', to: lastDay(String(inside[inside.length - 1].month).slice(0, 7)) } : null;
    var rev = inside.length ? round2(inside.reduce(function (a, m) { return a + (Number(m.sales) || 0); }, 0)) : null;
    var ord = inside.length ? inside.reduce(function (a, m) { return a + (Number(m.orders) || 0); }, 0) : null;
    var figures = {
      revenue: fig(rev, { currency: currency, source: src.label, window: winSpan, basis: inside.length ? 'total sales as stated per month in the export, whole months inside the window' : 'no whole month of the export falls inside ' + w.from + '..' + w.to + ' (the export covers ' + span.from + '..' + span.to + ')' }),
      orders: fig(ord, { source: src.label, window: winSpan, basis: 'orders per month as stated in the export' }),
      aov: fig(rev != null && ord ? round2(rev / ord) : null, { currency: currency, source: src.label, window: winSpan, basis: 'revenue / orders' }),
      net: fig(val('net_sales'), Object.assign({ currency: currency, basis: 'net sales as stated in the export (its whole window)' }, whole)),
      refunds: fig(null, Object.assign({ basis: 'not stated separately in the export' }, whole)),
      discounts: fig(null, Object.assign({ basis: 'not read from the export' }, whole)),
      units: fig(val('quantity'), Object.assign({ basis: val('quantity') == null ? 'not stated in this market\'s export' : 'quantity as stated in the export (its whole window)' }, whole)),
      customers: fig(val('new_customers') != null && val('returning_customers') != null ? val('new_customers') + val('returning_customers') : null, Object.assign({ basis: 'new + returning as stated in the export (its whole window)' }, whole)),
      new_customers: fig(val('new_customers'), Object.assign({ basis: 'as stated in the export (its whole window)' }, whole)),
      returning_customers: fig(val('returning_customers'), Object.assign({ basis: val('returning_customers') == null ? 'not stated in this market\'s export' : 'as stated in the export (its whole window)' }, whole)),
    };
    var points = monthly.filter(function (m) { var k = String(m.month || '').slice(0, 7); return lastDay(k) >= w.from && k + '-01' <= w.to; })
      .map(function (m) { return { key: String(m.month).slice(0, 7), revenue: round2(Number(m.sales) || 0), orders: Number(m.orders) || 0, before_data: false }; });
    var tp = (Array.isArray(market.top_products) ? market.top_products : []).slice(0, MAX_TOP).map(function (p) {
      return { sku: p.sku || null, title: p.title || '', in_catalogue: null, handle: null, revenue: p.net != null ? round2(Number(p.net)) : null, units: p.quantity != null ? Number(p.quantity) : null, orders: p.orders ? Number(p.orders) : null };
    });
    return {
      code: code, available: true, source: src, window: winSpan || { from: w.from, to: w.to }, currency: currency, currency_basis: 'the export\'s own currency for ' + code,
      data_span: { earliest: span.from, latest: span.to },
      figures: figures,
      previous: { available: false, reason: 'The export is monthly aggregates; a period-over-period comparison is shown on the monthly trend instead.' },
      by_currency: null,
      trend: { granularity: 'month', window: span, basis: 'total sales per month as stated in the export (its grain is a month)', points: points },
      top_products: { window: span, basis: 'net sales per product as stated in the export (its whole window)', rows: tp },
      notes: ['These figures are the export compiled into this build, not live orders; each figure names the window it covers.'],
    };
  }
  function lastDay(ym) {
    var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }

  /* ── totals across the selected regions ───────────────────────────────── */
  /**
   * fx: { base, rates:[{from, to, rate, as_of, entered_by, entered_at}] }.
   * Only a rate ENTERED from a currency to the base converts it; an inverse or
   * a chain is not used, and nothing is assumed.
   */
  function totals(regionsOut, fx, brand) {
    var by = {}, codes = Object.keys(regionsOut || {});
    var missing = [];
    codes.forEach(function (c) {
      var r = regionsOut[c];
      if (!r || !r.available) { missing.push(c); return; }
      var parts = r.by_currency ? r.by_currency : [{ currency: r.currency, revenue: r.figures.revenue.value, orders: r.figures.orders.value }];
      parts.forEach(function (p) {
        if (p.revenue == null) return;
        var k = p.currency || '';
        var b = by[k] = by[k] || { currency: k, revenue: 0, orders: 0, regions: [] };
        b.revenue = round2(b.revenue + p.revenue); b.orders += p.orders || 0;
        if (b.regions.indexOf(c) < 0) b.regions.push(c);
      });
    });
    var list = Object.keys(by).map(function (k) { return by[k]; });
    var out = { by_currency: list, regions_without_data: missing, combined: null, combined_reason: '' };
    if (!list.length) { out.combined_reason = 'None of the selected markets has revenue to total.'; return out; }
    if (list.some(function (b) { return !b.currency; })) {
      out.combined_reason = 'A market has no currency on record (' + marker('currency', brand) + '), so its revenue cannot be added to anything.';
      return out;
    }
    if (list.length === 1) {
      out.combined = { currency: list[0].currency, revenue: list[0].revenue, orders: list[0].orders, converted: false, rates_used: [], basis: 'every selected market with data is in ' + list[0].currency + '; nothing was converted' };
      return out;
    }
    var f = fx || {};
    var base = cur(f.base);
    var rates = Array.isArray(f.rates) ? f.rates : [];
    if (!base) { out.combined_reason = 'The selected markets are in ' + list.map(function (b) { return b.currency; }).join(', ') + '. There is no single total until you enter exchange rates; nothing is converted at a rate you did not enter.'; return out; }
    var used = [], lacking = [];
    var sumBase = 0, orders = 0;
    list.forEach(function (b) {
      orders += b.orders;
      if (b.currency === base) { sumBase += b.revenue; return; }
      var r = latestRate(rates, b.currency, base);
      if (!r) { lacking.push(b.currency + ' to ' + base); return; }
      used.push(r);
      sumBase += b.revenue * Number(r.rate);
    });
    if (lacking.length) {
      out.combined_reason = 'No single total in ' + base + ': no rate has been entered for ' + lacking.join(', ') + '. The totals are shown per currency instead; nothing is converted at a rate you did not enter.';
      return out;
    }
    out.combined = { currency: base, revenue: round2(sumBase), orders: orders, converted: true, rates_used: used, basis: 'converted to ' + base + ' at the rates entered for this brand (each shown with its date and who entered it)' };
    return out;
  }
  function latestRate(rates, from, to) {
    var best = null;
    rates.forEach(function (r) {
      if (!r || cur(r.from) !== from || cur(r.to) !== to) return;
      var v = Number(r.rate);
      if (!isFinite(v) || v <= 0) return;
      if (!best || String(r.as_of || '') > String(best.as_of || '') || (String(r.as_of || '') === String(best.as_of || '') && String(r.entered_at || '') > String(best.entered_at || ''))) best = r;
    });
    return best ? { from: from, to: to, rate: Number(best.rate), as_of: best.as_of || null, entered_by: best.entered_by || null, entered_at: best.entered_at || null, id: best.id || null } : null;
  }

  /** Validate an entered rate; { ok, rate } or { ok:false, message }. */
  function validRate(input, today) {
    var i = input || {};
    var from = cur(i.from), to = cur(i.to);
    var v = Number(i.rate);
    var asOf = String(i.as_of || '').slice(0, 10);
    if (!from || !to) return { ok: false, message: 'Name both currencies as three-letter codes (for example GBP and INR).' };
    if (from === to) return { ok: false, message: 'A rate converts one currency into another; ' + from + ' to ' + from + ' is not a rate.' };
    if (!isFinite(v) || v <= 0) return { ok: false, message: 'The rate must be a positive number: how many ' + to + ' one ' + from + ' is worth.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !isFinite(Date.parse(asOf + 'T00:00:00Z'))) return { ok: false, message: 'Give the date the rate is for (YYYY-MM-DD).' };
    if (today && asOf > today) return { ok: false, message: 'The date of a rate cannot be in the future.' };
    return { ok: true, rate: { from: from, to: to, rate: v, as_of: asOf } };
  }

  return {
    family: family, resolveRegion: resolveRegion, marker: marker, dayOf: dayOf, windowOf: windowOf, bucketOf: bucketOf, granularityFor: granularityFor,
    fromSmartOrders: fromSmartOrders, fromShopifyOrders: fromShopifyOrders, fromCsv: fromCsv, parseCsv: parseCsv,
    aggregate: aggregate, fromExport: fromExport, totals: totals, latestRate: latestRate, validRate: validRate,
  };
});
