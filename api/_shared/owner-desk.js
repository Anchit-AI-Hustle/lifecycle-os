/**
 * owner-desk.js - the arithmetic behind the Owner's Desk (2026-10-23).
 *
 * The operator, with seven "run your business like an agency" prompts (brand
 * style, a launch in one prompt, fix your worst ad, mine your reviews, the
 * money X-ray, the what-if model, the monthly CEO report): match them. A
 * model is good at the words of those jobs and bad at their numbers, so every
 * number on the desk is computed HERE, in code, from the operator's own
 * files (a sales export, receipts / an expense sheet, an ad report, reviews).
 * A model only writes sentences and copy, and is handed these figures.
 *
 * Rules, one per prompt line that invites a guess:
 *   - "If a number looks off or is missing, ask me before you guess": a
 *     figure that needs data the files do not hold is null, and a QUESTION
 *     says what is missing. Margin is never computed for a month with no
 *     expenses; profit is never computed without a cost per order.
 *   - "Rank them by profit": a scenario that rests on an assumption the
 *     operator has not given (how many orders a price rise loses, what share
 *     of orders the ads bring) states it, with how far it can be wrong before
 *     the scenario stops paying.
 *   - "with how often each comes up": theme counts are counted here from the
 *     model's per-review labels, never a number the model writes.
 *   - "Same format every month": one report shape, versioned (FORMAT).
 *
 * UMD: window.OwnerDesk in the browser (root /owner-desk.js, byte-identical),
 * module.exports in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OwnerDesk = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 'owner-report.v1';

  /* ── CSV ──────────────────────────────────────────────────────────────── */

  /** RFC 4180 CSV (quotes, doubled quotes, CRLF), comma, semicolon or tab separated. */
  function parseCsv(text) {
    var s = String(text || '').replace(/^﻿/, '');
    var first = s.split(/\r?\n/)[0] || '';
    var sep = [',', ';', '\t'].map(function (c) { return [c, first.split(c).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var rows = []; var row = []; var cell = ''; var q = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(function (c) { return String(c).trim() !== ''; })) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(function (c) { return String(c).trim() !== ''; })) rows.push(row);
    if (!rows.length) return { headers: [], rows: [] };
    var headers = rows[0].map(function (h) { return String(h).trim(); });
    return {
      headers: headers,
      rows: rows.slice(1).map(function (r) { var o = {}; headers.forEach(function (h, k) { o[h] = r[k] == null ? '' : String(r[k]).trim(); }); return o; }),
    };
  }

  function norm(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  /** The first header matching one of the patterns, tried in order. */
  function pickColumn(headers, patterns) {
    for (var p = 0; p < patterns.length; p++) {
      for (var i = 0; i < headers.length; i++) if (patterns[p].test(norm(headers[i]))) return headers[i];
    }
    return null;
  }

  /** "₹1,23,456.50", "$1,200", "(45.00)", "1.234,50" -> a number, or null. */
  function num(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s) return null;
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^0-9.,()-]/g, ''));
    s = s.replace(/[^0-9.,]/g, '');
    if (!s) return null;
    // "1.234,50" (comma decimal) vs "1,234.50" / "1,23,456".
    if (/,\d{1,2}$/.test(s) && s.indexOf('.') >= 0 && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    var n = Number(s);
    if (!isFinite(n)) return null;
    return neg ? -Math.abs(n) : n;
  }

  /** A date cell -> 'YYYY-MM-DD', or null. ISO, "2026-10-03 14:02:11 +0530", "03/10/2026" (day first unless impossible). */
  function day(v) {
    var s = String(v || '').trim();
    if (!s) return null;
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (m) {
      var a = Number(m[1]); var b = Number(m[2]); var y = m[3].length === 2 ? '20' + m[3] : m[3];
      var d = a; var mo = b;
      if (b > 12 && a <= 12) { d = b; mo = a; }
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return y + '-' + pad(mo) + '-' + pad(d);
    }
    var t = Date.parse(s);
    if (!isFinite(t)) return null;
    return new Date(t).toISOString().slice(0, 10);
  }
  function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }
  function month(d) { return d ? d.slice(0, 7) : null; }
  function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }
  function pct(a, b) { return (a == null || b == null || b === 0) ? null : (a - b) / Math.abs(b); }
  function median(list) {
    var a = list.filter(function (x) { return x != null && isFinite(x); }).slice().sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var h = Math.floor(a.length / 2);
    return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
  }

  /* ── Reading each file ────────────────────────────────────────────────── */

  var SALES_COLS = {
    date: [/^(created at|order date|date|paid at|processed at|day|month)$/, /date|created/],
    order: [/^(name|order|order id|order number|order name|id)$/, /order/],
    product: [/^(lineitem name|product|product title|product name|item|item name|title|sku)$/, /product|item/],
    qty: [/^(lineitem quantity|quantity|qty|units|net quantity|units sold)$/, /quantity|qty|units/],
    line_price: [/^(lineitem price|unit price|price)$/],
    total: [/^(total|order total|total sales|net sales|gross sales|sales|revenue|amount|line total|subtotal)$/, /total|sales|revenue|amount/],
    currency: [/^(currency|currency code)$/],
  };

  /**
   * A sales export -> orders + product lines. Shopify's order export repeats an
   * order across its line items and states Total on the first line only, so an
   * order's revenue is its stated Total (once), else the sum of its lines.
   */
  function readSales(csv) {
    var t = typeof csv === 'string' ? parseCsv(csv) : csv;
    var h = t.headers;
    var col = {}; Object.keys(SALES_COLS).forEach(function (k) { col[k] = pickColumn(h, SALES_COLS[k]); });
    var issues = [];
    if (!col.date) issues.push('The sales file has no date column, so nothing can be put in a month. Which column is the order date?');
    if (!col.total && !col.line_price) issues.push('The sales file has no total or price column. Which column holds what each order or line sold for?');
    var orders = {}; var lines = []; var skipped = 0; var currencies = {};
    t.rows.forEach(function (r, i) {
      var d = col.date ? day(r[col.date]) : null;
      var qty = col.qty ? num(r[col.qty]) : null;
      var lp = col.line_price ? num(r[col.line_price]) : null;
      var tot = col.total ? num(r[col.total]) : null;
      var id = col.order ? r[col.order] : '';
      if (!id) id = 'row-' + (i + 2);
      if (col.currency && r[col.currency]) currencies[r[col.currency].toUpperCase()] = true;
      var o = orders[id];
      if (!o) { o = orders[id] = { id: id, date: d, total: null, lines_sum: 0, lines: 0 }; }
      if (!o.date && d) o.date = d;
      if (tot != null && o.total == null) o.total = tot;
      var lineAmount = lp != null ? lp * (qty != null ? qty : 1) : (col.order ? null : tot);
      if (lineAmount != null) { o.lines_sum += lineAmount; o.lines++; }
      if (col.product && r[col.product]) lines.push({ order: id, date: d || o.date, product: r[col.product], qty: qty != null ? qty : 1, amount: lineAmount });
      if (!d && !o.date) skipped++;
    });
    var list = Object.keys(orders).map(function (k) {
      var o = orders[k];
      var revenue = o.total != null ? o.total : (o.lines ? o.lines_sum : null);
      return { id: o.id, date: o.date, revenue: revenue };
    });
    var undated = list.filter(function (o) { return !o.date; }).length;
    if (undated) issues.push(undated + ' order' + (undated === 1 ? ' has' : 's have') + ' no readable date and ' + (undated === 1 ? 'is' : 'are') + ' left out. Is the date column in another format?');
    var noAmount = list.filter(function (o) { return o.date && o.revenue == null; }).length;
    if (noAmount) issues.push(noAmount + ' order' + (noAmount === 1 ? ' has' : 's have') + ' no amount and ' + (noAmount === 1 ? 'is' : 'are') + ' left out of revenue. Were they free, or is the amount in another column?');
    var cur = Object.keys(currencies);
    if (cur.length > 1) issues.push('The sales are in ' + cur.join(' and ') + '. They are not added together: which currency should the report be in, and at what rate?');
    return {
      columns: col, orders: list.filter(function (o) { return o.date && o.revenue != null; }),
      lines: lines.filter(function (l) { return l.date; }), currency: cur.length === 1 ? cur[0] : null,
      currencies: cur, issues: issues, rows: t.rows.length,
    };
  }

  var EXP_COLS = {
    date: [/^(date|transaction date|receipt date|paid on|posted date|month)$/, /date/],
    category: [/^(category|type|account|expense type|expense category)$/, /categ/],
    vendor: [/^(vendor|merchant|payee|supplier|description|memo|details|name)$/, /vendor|merchant|payee|description/],
    amount: [/^(amount|total|cost|debit|spend|value|amount paid)$/, /amount|total|cost|debit/],
  };

  /** Receipts / an expense sheet -> dated expenses, each with a category (the sheet's own, else its vendor). */
  function readExpenses(csv) {
    var t = typeof csv === 'string' ? parseCsv(csv) : csv;
    var col = {}; Object.keys(EXP_COLS).forEach(function (k) { col[k] = pickColumn(t.headers, EXP_COLS[k]); });
    var issues = [];
    if (!col.date) issues.push('The expenses file has no date column. Which column is the date paid?');
    if (!col.amount) issues.push('The expenses file has no amount column. Which column holds what was paid?');
    var out = []; var bad = 0; var uncategorised = 0;
    t.rows.forEach(function (r) {
      var d = col.date ? day(r[col.date]) : null;
      var a = col.amount ? num(r[col.amount]) : null;
      if (!d || a == null) { bad++; return; }
      var c = (col.category && r[col.category]) || (col.vendor && r[col.vendor]) || '';
      if (!c) uncategorised++;
      out.push({ date: d, category: c || 'Not categorised', vendor: col.vendor ? r[col.vendor] : '', amount: Math.abs(a) });
    });
    if (bad) issues.push(bad + ' expense row' + (bad === 1 ? ' has' : 's have') + ' no readable date or amount and ' + (bad === 1 ? 'is' : 'are') + ' left out. Should ' + (bad === 1 ? 'it' : 'they') + ' be included?');
    if (uncategorised) issues.push(uncategorised + ' expense' + (uncategorised === 1 ? ' has' : 's have') + ' no category or vendor, so ' + (uncategorised === 1 ? 'it is' : 'they are') + ' grouped as "Not categorised". What ' + (uncategorised === 1 ? 'is it' : 'are they') + '?');
    return { columns: col, expenses: out, issues: issues, rows: t.rows.length };
  }

  var AD_COLS = {
    ad: [/^(ad|ad name|ad id|headline 1|headline|creative|ad group ad)$/, /^ad\b|headline|creative/],
    campaign: [/^(campaign|campaign name)$/],
    cost: [/^(cost|spend|amount spent|amount spent inr|amount spent usd|cost micros)$/, /cost|spend|spent/],
    conversions: [/^(conversions|all conversions|results|purchases|website purchases)$/, /conversion|purchase|result/],
    clicks: [/^(clicks|link clicks|clicks all)$/, /click/],
    impressions: [/^(impressions|impr|impr\.)$/, /impr/],
    value: [/^(conv value|conversion value|all conv value|purchases conversion value|revenue)$/, /value/],
  };

  /** An ad report export (Google Ads "Ads" report, Meta Ads Manager export) -> one row per ad. */
  function readAds(csv) {
    var t = typeof csv === 'string' ? parseCsv(csv) : csv;
    var col = {}; Object.keys(AD_COLS).forEach(function (k) { col[k] = pickColumn(t.headers, AD_COLS[k]); });
    var issues = [];
    if (!col.cost) issues.push('The ad report has no cost or spend column. Which column is what each ad cost?');
    if (!col.conversions) issues.push('The ad report has no conversions column, so a cost per conversion cannot be worked out. Can you export it with conversions (or results)?');
    var micros = col.cost && /micros/.test(norm(col.cost));
    var ads = t.rows.map(function (r, i) {
      var name = (col.ad && r[col.ad]) || ('Ad on row ' + (i + 2));
      var cost = col.cost ? num(r[col.cost]) : null;
      if (cost != null && micros) cost = cost / 1e6;
      return {
        ad: name, campaign: col.campaign ? r[col.campaign] : '',
        cost: cost, conversions: col.conversions ? num(r[col.conversions]) : null,
        clicks: col.clicks ? num(r[col.clicks]) : null, impressions: col.impressions ? num(r[col.impressions]) : null,
        value: col.value ? num(r[col.value]) : null,
      };
    }).filter(function (a) { return !/^(total|totals|grand total)/i.test(a.ad); });
    return { columns: col, ads: ads, issues: issues, rows: t.rows.length };
  }

  var REVIEW_COLS = {
    text: [/^(review|review text|comment|text|body|content|feedback)$/, /review|comment|text/],
    rating: [/^(rating|stars|star rating|score)$/, /rating|star/],
    date: [/^(date|review date|created|created at|published)$/, /date/],
    author: [/^(reviewer|author|name|customer|reviewer name)$/],
  };

  /** Reviews -> [{i, text, rating, date, author}]; a rating is read only when the file states one. */
  function readReviews(csv) {
    var t = typeof csv === 'string' ? parseCsv(csv) : csv;
    var col = {}; Object.keys(REVIEW_COLS).forEach(function (k) { col[k] = pickColumn(t.headers, REVIEW_COLS[k]); });
    var issues = [];
    if (!col.text) issues.push('The reviews file has no review text column. Which column holds what the customer wrote?');
    var list = [];
    t.rows.forEach(function (r) {
      var text = col.text ? r[col.text] : '';
      if (!text) return;
      var rating = col.rating ? num(String(r[col.rating]).replace(/\/\s*5.*/, '')) : null;
      if (rating != null && (rating < 0 || rating > 5)) rating = null;
      list.push({ i: list.length, text: text, rating: rating, date: col.date ? day(r[col.date]) : null, author: col.author ? r[col.author] : '' });
    });
    return { columns: col, reviews: list, issues: issues, rows: t.rows.length };
  }

  /* ── The money X-ray ─────────────────────────────────────────────────── */

  var COST_OF_GOODS = /(cogs|cost of goods|inventory|stock|raw material|materials|packaging|purchase|wholesale|supplier|manufactur|courier|shipping|delivery|freight|logistics|fulfil)/i;
  var ADVERTISING = /(advert|ads\b|\bad\b|marketing|meta|facebook|instagram|google ads|adwords|tiktok|promotion|influencer|sponsor)/i;

  /**
   * Revenue by month, top 5 products, biggest expenses, profit margin, and the
   * questions to answer before trusting them.
   */
  function xray(sales, expenses) {
    var s = sales || { orders: [], lines: [], issues: [] };
    var e = expenses || { expenses: [], issues: [] };
    var months = {};
    function m(k) { return months[k] || (months[k] = { month: k, revenue: 0, orders: 0, expenses: 0, has_sales: false, has_expenses: false }); }
    s.orders.forEach(function (o) { var r = m(month(o.date)); r.revenue += o.revenue; r.orders++; r.has_sales = true; });
    e.expenses.forEach(function (x) { var r = m(month(x.date)); r.expenses += x.amount; r.has_expenses = true; });
    var byMonth = Object.keys(months).sort().map(function (k) {
      var r = months[k];
      var margin = (r.has_sales && r.has_expenses && r.revenue > 0) ? (r.revenue - r.expenses) / r.revenue : null;
      return {
        month: k, revenue: r.has_sales ? round2(r.revenue) : null, orders: r.has_sales ? r.orders : null,
        aov: r.has_sales && r.orders ? round2(r.revenue / r.orders) : null,
        expenses: r.has_expenses ? round2(r.expenses) : null,
        profit: (r.has_sales && r.has_expenses) ? round2(r.revenue - r.expenses) : null,
        margin: margin == null ? null : Math.round(margin * 1000) / 1000,
      };
    });
    var products = {};
    s.lines.forEach(function (l) { if (l.amount == null) return; var p = products[l.product] || (products[l.product] = { product: l.product, revenue: 0, units: 0 }); p.revenue += l.amount; p.units += l.qty || 0; });
    var top = Object.keys(products).map(function (k) { return products[k]; }).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 5)
      .map(function (p) { return { product: p.product, revenue: round2(p.revenue), units: p.units }; });
    var cats = {};
    e.expenses.forEach(function (x) { var c = cats[x.category] || (cats[x.category] = { category: x.category, amount: 0, by_month: {} }); c.amount += x.amount; c.by_month[month(x.date)] = (c.by_month[month(x.date)] || 0) + x.amount; });
    var biggest = Object.keys(cats).map(function (k) { return cats[k]; }).sort(function (a, b) { return b.amount - a.amount; })
      .map(function (c) { return { category: c.category, amount: round2(c.amount), by_month: c.by_month }; });

    var both = byMonth.filter(function (r) { return r.profit != null; });
    var revBoth = both.reduce(function (a, r) { return a + r.revenue; }, 0);
    var expBoth = both.reduce(function (a, r) { return a + r.expenses; }, 0);
    var overall = both.length ? { months: both.map(function (r) { return r.month; }), revenue: round2(revBoth), expenses: round2(expBoth), profit: round2(revBoth - expBoth), margin: revBoth > 0 ? Math.round((revBoth - expBoth) / revBoth * 1000) / 1000 : null } : null;

    var questions = [].concat(s.issues || [], e.issues || []);
    byMonth.forEach(function (r) {
      if (r.revenue != null && r.expenses == null && e.expenses.length) questions.push('There are no expenses for ' + r.month + ', so its margin is not worked out. Were there none, or are receipts missing?');
      if (r.expenses != null && r.revenue == null && s.orders.length) questions.push('There are expenses but no sales for ' + r.month + '. Is that month missing from the sales file?');
    });
    if (!s.orders.length) questions.push('No sales were read yet. Add a sales export (date, product, amount).');
    if (!e.expenses.length) questions.push('No expenses were read yet. Add your receipts or an expense sheet (date, category, amount) so profit and margin can be worked out.');

    return {
      by_month: byMonth, top_products: top, biggest_expenses: biggest.slice(0, 8).map(function (c) { return { category: c.category, amount: c.amount }; }),
      _categories: biggest, overall: overall, currency: s.currency || null, questions: questions,
      summary: xraySentences(byMonth, biggest, overall, s.currency, questions),
    };
  }

  function money(n, cur) {
    if (n == null) return '';
    var abs = Math.abs(n);
    var str = abs >= 100 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(2);
    return (n < 0 ? '-' : '') + (cur ? cur + ' ' : '') + str;
  }

  /** The three sentences: where money goes, the biggest cost, and what to look at first. Only from the figures above. */
  function xraySentences(byMonth, cats, overall, cur, questions) {
    if (!overall) return ['Profit cannot be worked out yet: it needs sales and expenses for the same month. ' + (questions[0] || '')];
    var out = [];
    var span = overall.months.length === 1 ? overall.months[0] : overall.months[0] + ' to ' + overall.months[overall.months.length - 1];
    out.push(overall.profit < 0
      ? 'Over ' + span + ' you spent ' + money(-overall.profit, cur) + ' more than you sold (' + money(overall.expenses, cur) + ' out, ' + money(overall.revenue, cur) + ' in): you are losing money.'
      : 'Over ' + span + ' you kept ' + money(overall.profit, cur) + ' of ' + money(overall.revenue, cur) + ' in sales, a margin of ' + Math.round(overall.margin * 100) + '%.');
    var big = cats[0];
    if (big) out.push('Your biggest cost is ' + big.category + ' at ' + money(big.amount, cur) + (overall.revenue ? ', ' + Math.round(big.amount / overall.revenue * 100) + '% of sales over the same months.' : '.'));
    // Look first at the large cost that grew most between its last two months.
    var ms = byMonth.map(function (r) { return r.month; });
    var grow = null;
    cats.slice(0, 5).forEach(function (c) {
      var have = ms.filter(function (k) { return c.by_month[k] != null; });
      if (have.length < 2) return;
      var a = c.by_month[have[have.length - 2]]; var b = c.by_month[have[have.length - 1]];
      if (b > a && (!grow || b - a > grow.delta)) grow = { c: c, a: a, b: b, from: have[have.length - 2], to: have[have.length - 1], delta: b - a };
    });
    if (grow) out.push('Cut first where costs are climbing: ' + grow.c.category + ' rose from ' + money(grow.a, cur) + ' in ' + grow.from + ' to ' + money(grow.b, cur) + ' in ' + grow.to + '.');
    else if (big) out.push('No cost grew month on month in these files, so the first place to cut is the biggest one, ' + big.category + '.');
    if (questions.length) out.push('Answer the ' + questions.length + ' question' + (questions.length === 1 ? '' : 's') + ' below before trusting these figures.');
    return out;
  }

  /* ── The what-if model ───────────────────────────────────────────────── */

  /**
   * The model's starting point, from the X-ray where the files say it, each
   * value with where it came from. A value the files cannot give is null and
   * the operator types it (no cost per order is assumed, ever).
   */
  function baseline(x) {
    var rows = (x && x.by_month || []).filter(function (r) { return r.revenue != null; });
    var last = rows.slice(-3);
    var orders = last.length ? last.reduce(function (a, r) { return a + r.orders; }, 0) / last.length : null;
    var revenue = last.length ? last.reduce(function (a, r) { return a + r.revenue; }, 0) / last.length : null;
    var months = last.map(function (r) { return r.month; });
    var cats = (x && x._categories) || [];
    function avgOf(re) {
      var hit = cats.filter(function (c) { return re.test(c.category); });
      if (!hit.length || !months.length) return null;
      var sum = 0; months.forEach(function (k) { hit.forEach(function (c) { sum += c.by_month[k] || 0; }); });
      return { value: sum / months.length, from: hit.map(function (c) { return c.category; }) };
    }
    var ads = avgOf(ADVERTISING);
    var cogs = avgOf(COST_OF_GOODS);
    var allExp = months.length ? months.reduce(function (a, k) { return a + cats.reduce(function (s, c) { return s + (c.by_month[k] || 0); }, 0); }, 0) / months.length : null;
    var fixed = allExp == null ? null : allExp - (ads ? ads.value : 0) - (cogs ? cogs.value : 0);
    var src = months.length ? 'the average of ' + months.join(', ') : '';
    return {
      price: { value: orders ? round2(revenue / orders) : null, source: orders ? 'average order value, ' + src : 'needs a sales file' },
      orders: { value: orders == null ? null : Math.round(orders), source: orders ? 'orders per month, ' + src : 'needs a sales file' },
      ad_spend: { value: ads ? round2(ads.value) : null, source: ads ? 'expenses named ' + ads.from.join(', ') + ', ' + src : 'no expense category reads as advertising: type your monthly ad spend' },
      cost_per_order: { value: (cogs && orders) ? round2(cogs.value / orders) : null, source: (cogs && orders) ? 'expenses named ' + cogs.from.join(', ') + ' divided by orders, ' + src : 'no expense category reads as product, packaging or shipping cost: type what one order costs you to make and send' },
      fixed_costs: { value: fixed == null ? null : round2(Math.max(0, fixed)), source: fixed == null ? 'needs an expense file' : 'every other expense, ' + src },
    };
  }

  /** Profit and break-even for one set of values. Null when a value it needs is missing. */
  function evaluate(v) {
    var need = ['price', 'orders', 'ad_spend', 'cost_per_order', 'fixed_costs'].filter(function (k) { return v[k] == null || !isFinite(v[k]); });
    if (need.length) return { profit: null, break_even_orders: null, missing: need };
    var unit = v.price - v.cost_per_order + (v.upsell_margin_per_order || 0);
    var profit = v.orders * unit - v.ad_spend - v.fixed_costs;
    return {
      profit: round2(profit), revenue: round2(v.orders * (v.price + (v.upsell_revenue_per_order || 0))),
      margin_per_order: round2(unit),
      break_even_orders: unit > 0 ? Math.ceil((v.ad_spend + v.fixed_costs) / unit) : null,
      loses_per_order: unit <= 0, missing: [],
    };
  }

  /**
   * The three scenarios, ranked by profit, each with the assumption it rests
   * on and how far that assumption can be wrong before it stops paying.
   * opts: { upsell_price, upsell_take (0-1), price_order_loss (0-1, orders lost
   * by a 10% rise), ad_order_share (0-1, share of orders the ads bring) }.
   */
  function scenarios(values, opts) {
    var o = opts || {};
    var today = evaluate(values);
    if (today.profit == null) return { today: today, ranked: [], recommend: null, missing: today.missing };
    var p = values.price; var c = values.cost_per_order; var n = values.orders; var ad = values.ad_spend;
    var list = [];
    // 1. Raise prices by 10%.
    var loss = o.price_order_loss != null && isFinite(o.price_order_loss) ? Math.max(0, Math.min(1, o.price_order_loss)) : null;
    var a = evaluate(Object.assign({}, values, { price: p * 1.1, orders: n * (1 - (loss || 0)) }));
    var room = (1.1 * p - c) > 0 ? 1 - (p - c) / (1.1 * p - c) : null;
    list.push({
      key: 'price_up_10', label: 'Raise prices by 10%', profit: a.profit, change: round2(a.profit - today.profit),
      assumption: loss == null ? 'Orders stay the same. You have not said how many a 10% rise would lose.' : 'You expect to lose ' + Math.round(loss * 100) + '% of orders.',
      holds_if: room == null ? null : 'It still pays unless more than ' + Math.round(room * 100) + '% of orders are lost.',
      safety: room,
    });
    // 2. Cut ad spend by 20%.
    var share = o.ad_order_share != null && isFinite(o.ad_order_share) ? Math.max(0, Math.min(1, o.ad_order_share)) : null;
    var lostOrders = share == null ? 0 : n * share * 0.2;
    var b = evaluate(Object.assign({}, values, { ad_spend: ad * 0.8, orders: n - lostOrders }));
    var canLose = (p - c) > 0 ? (0.2 * ad) / (p - c) : null;
    list.push({
      key: 'ads_down_20', label: 'Cut ad spend by 20%', profit: b.profit, change: round2(b.profit - today.profit),
      assumption: share == null ? 'Orders stay the same. You have not said what share of orders the ads bring.' : 'Ads bring ' + Math.round(share * 100) + '% of orders, and a fifth of those go with the cut.',
      holds_if: canLose == null ? null : 'It still pays unless the cut loses more than ' + Math.floor(canLose) + ' orders a month (' + (n ? Math.round(canLose / n * 100) : 0) + '% of today\'s).',
      safety: canLose == null || !n ? null : canLose / n,
    });
    // 3. Add an upsell.
    if (o.upsell_price != null && isFinite(o.upsell_price) && o.upsell_take != null && isFinite(o.upsell_take)) {
      var take = Math.max(0, Math.min(1, o.upsell_take));
      var ratio = p > 0 ? c / p : 0;
      var up = evaluate(Object.assign({}, values, { upsell_margin_per_order: take * o.upsell_price * (1 - ratio), upsell_revenue_per_order: take * o.upsell_price }));
      list.push({
        key: 'upsell', label: 'Add a ' + o.upsell_price + ' upsell', profit: up.profit, change: round2(up.profit - today.profit),
        assumption: Math.round(take * 100) + '% of orders take it, and it costs you the same share of its price as an order does (' + Math.round(ratio * 100) + '%).',
        holds_if: 'Any take above zero adds profit at that cost; at ' + Math.round(take * 100) + '% it adds ' + round2(up.profit - today.profit) + ' a month.',
        safety: null,
      });
    } else {
      list.push({ key: 'upsell', label: 'Add an upsell', profit: null, change: null, assumption: 'Needs the upsell price and the share of orders you expect to take it.', holds_if: null, safety: null, missing: ['upsell_price', 'upsell_take'] });
    }
    var ranked = list.filter(function (x) { return x.profit != null; }).sort(function (x, y) { return y.profit - x.profit; });
    var unranked = list.filter(function (x) { return x.profit == null; });
    var best = ranked[0] || null;
    var recommend = best ? {
      key: best.key,
      sentence: 'Test "' + best.label + '" first: it ranks highest at ' + best.profit + ' a month (' + (best.change >= 0 ? '+' : '') + best.change + ' on today). ' + (best.holds_if ? best.holds_if + ' ' : '') + 'The test is whether that holds: ' + best.assumption,
    } : null;
    return { today: today, ranked: ranked, unranked: unranked, recommend: recommend, missing: [] };
  }

  /* ── Fix your worst ad ────────────────────────────────────────────────── */

  /**
   * Cost per conversion for every ad and the one burning the most money: the
   * most spend above what its conversions would have cost at the account's
   * own median cost per conversion. An ad with spend and no conversion is
   * measured the same way (its whole spend is above).
   */
  function worstAd(report) {
    var ads = (report && report.ads || []).filter(function (a) { return a.cost != null && a.cost > 0; });
    if (!ads.length) return { ok: false, ads: [], worst: null, note: 'No ad with spend was read.', questions: (report && report.issues) || [] };
    var withConv = report.columns && report.columns.conversions;
    var rows = ads.map(function (a) {
      return Object.assign({}, a, {
        cpa: (a.conversions && a.conversions > 0) ? round2(a.cost / a.conversions) : null,
        ctr: (a.clicks != null && a.impressions) ? a.clicks / a.impressions : null,
        cvr: (a.conversions != null && a.clicks) ? a.conversions / a.clicks : null,
        cpc: (a.clicks) ? a.cost / a.clicks : null,
      });
    });
    var medCpa = median(rows.map(function (r) { return r.cpa; }));
    var medCtr = median(rows.map(function (r) { return r.ctr; }));
    var medCvr = median(rows.map(function (r) { return r.cvr; }));
    var medCpc = median(rows.map(function (r) { return r.cpc; }));
    if (!withConv || medCpa == null) {
      return { ok: false, ads: rows, worst: null, note: 'Without conversions, cost per conversion cannot be worked out and no ad can be called the worst.', questions: report.issues || [] };
    }
    rows.forEach(function (r) { r.excess = round2(r.cost - (r.conversions || 0) * medCpa); });
    var sorted = rows.slice().sort(function (x, y) { return y.excess - x.excess; });
    var worst = sorted[0];
    var why = [];
    if (!worst.conversions) why.push('It spent ' + round2(worst.cost) + ' and brought no conversion; at the account\'s median of ' + round2(medCpa) + ' per conversion that spend should have brought about ' + Math.floor(worst.cost / medCpa) + '.');
    else why.push('Each conversion costs ' + worst.cpa + ', against a median of ' + round2(medCpa) + ' across your ads: ' + round2(worst.excess) + ' more than its conversions were worth at that rate.');
    if (worst.ctr != null && medCtr != null) {
      if (worst.ctr < medCtr * 0.75) why.push('People see it and scroll past: ' + (worst.ctr * 100).toFixed(2) + '% click, against ' + (medCtr * 100).toFixed(2) + '% for your other ads. The headline is not landing.');
      else if (worst.cvr != null && medCvr != null && worst.cvr < medCvr * 0.75) why.push('People click (' + (worst.ctr * 100).toFixed(2) + '%, in line with your other ads) but few buy: ' + (worst.cvr * 100).toFixed(2) + '% of clicks convert, against ' + (medCvr * 100).toFixed(2) + '%. The ad promises something the page after the click does not deliver.');
    }
    if (worst.cpc != null && medCpc != null && worst.cpc > medCpc * 1.3) why.push('Each click costs ' + round2(worst.cpc) + ', against ' + round2(medCpc) + ' for your other ads, so it is paying more to reach people.');
    return {
      ok: true, ads: sorted, worst: worst, why: why,
      medians: { cpa: round2(medCpa), ctr: medCtr, cvr: medCvr, cpc: medCpc == null ? null : round2(medCpc) },
      questions: report.issues || [],
    };
  }

  /* ── Mine your reviews ───────────────────────────────────────────────── */

  /**
   * Theme counts from per-review labels: labels = [{i, themes:[{theme, kind:'praise'|'complaint'}]}].
   * Counted here, so "how often each comes up" is a count, not a model's word.
   */
  function reviewThemes(reviews, labels) {
    var byI = {}; (reviews || []).forEach(function (r) { byI[r.i] = r; });
    var themes = {};
    (labels || []).forEach(function (l) {
      if (!byI[l.i]) return;
      var seen = {};
      (l.themes || []).forEach(function (t) {
        var name = String(t.theme || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
        var kind = t.kind === 'complaint' ? 'complaint' : 'praise';
        if (!name) return;
        var key = kind + '|' + name;
        if (seen[key]) return; seen[key] = true;
        var x = themes[key] || (themes[key] = { theme: name, kind: kind, count: 0, reviews: [] });
        x.count++; x.reviews.push(l.i);
      });
    });
    var list = Object.keys(themes).map(function (k) { return themes[k]; }).sort(function (a, b) { return b.count - a.count; });
    var total = (reviews || []).length;
    list.forEach(function (t) { t.share = total ? Math.round(t.count / total * 1000) / 1000 : null; });
    var rated = (reviews || []).filter(function (r) { return r.rating != null; });
    return {
      total: total, rated: rated.length,
      average: rated.length ? Math.round(rated.reduce(function (a, r) { return a + r.rating; }, 0) / rated.length * 100) / 100 : null,
      praise: list.filter(function (t) { return t.kind === 'praise'; }),
      complaints: list.filter(function (t) { return t.kind === 'complaint'; }),
    };
  }

  /** Is this review negative: a stated rating of 3 or less, else a review labelled only with complaints. */
  function isNegative(review, label) {
    if (review.rating != null) return review.rating <= 3;
    var t = (label && label.themes) || [];
    return t.length > 0 && t.every(function (x) { return x.kind === 'complaint'; });
  }

  /* ── The monthly CEO report ──────────────────────────────────────────── */

  function sum(list, f) { return list.reduce(function (a, x) { var v = f(x); return v == null ? a : a + v; }, 0); }

  /**
   * One month's numbers from whatever files are on hand. `period` = 'YYYY-MM'.
   * A figure whose file is missing is null, never 0.
   */
  function monthFigures(period, data) {
    var d = data || {};
    var orders = (d.sales && d.sales.orders || []).filter(function (o) { return month(o.date) === period; });
    var lines = (d.sales && d.sales.lines || []).filter(function (l) { return month(l.date) === period; });
    var exp = (d.expenses && d.expenses.expenses || []).filter(function (x) { return month(x.date) === period; });
    var ads = d.adsByMonth && d.adsByMonth[period];
    var reviews = (d.reviews && d.reviews.reviews || []).filter(function (r) { return month(r.date) === period; });
    var products = {}; lines.forEach(function (l) { if (l.amount != null) products[l.product] = (products[l.product] || 0) + l.amount; });
    var adSpend = ads ? ads.cost : (d.expenses ? sum(exp.filter(function (x) { return ADVERTISING.test(x.category); }), function (x) { return x.amount; }) : null);
    var rated = reviews.filter(function (r) { return r.rating != null; });
    var hasSales = !!(d.sales && d.sales.orders && d.sales.orders.length);
    var revenue = hasSales ? round2(sum(orders, function (o) { return o.revenue; })) : null;
    return {
      period: period,
      revenue: revenue, orders: hasSales ? orders.length : null,
      aov: hasSales && orders.length ? round2(revenue / orders.length) : null,
      ad_spend: adSpend == null ? null : round2(adSpend),
      ad_source: ads ? 'ad report' : (d.expenses ? 'expenses named as advertising' : null),
      expenses: d.expenses ? round2(sum(exp, function (x) { return x.amount; })) : null,
      new_reviews: d.reviews ? reviews.length : null,
      average_rating: rated.length ? Math.round(sum(rated, function (r) { return r.rating; }) / rated.length * 100) / 100 : null,
      products: products,
    };
  }

  var METRICS = [
    ['revenue', 'Sales'], ['orders', 'Orders'], ['aov', 'Average order'], ['ad_spend', 'Ad spend'],
    ['expenses', 'All expenses'], ['new_reviews', 'New reviews'], ['average_rating', 'Average rating of new reviews'],
  ];

  /**
   * The report, the same shape every month: numbers first (this month, last
   * month, change), what grew, what dropped, why (only what the files show),
   * and three moves for next week, each with its expected impact and the
   * figure it rests on.
   */
  function ceoReport(period, data, extras) {
    var x = extras || {};
    var prevPeriod = (function () { var y = Number(period.slice(0, 4)); var mo = Number(period.slice(5, 7)) - 1; if (mo === 0) { y--; mo = 12; } return y + '-' + pad(mo); })();
    var cur = monthFigures(period, data); var prev = monthFigures(prevPeriod, data);
    var numbers = METRICS.map(function (m) {
      var a = cur[m[0]]; var b = prev[m[0]];
      return { key: m[0], label: m[1], this_month: a, last_month: b, change: (a != null && b != null) ? round2(a - b) : null, change_pct: pct(a, b) == null ? null : Math.round(pct(a, b) * 1000) / 1000 };
    });
    var grew = numbers.filter(function (n) { return n.change != null && n.change > 0; }).sort(function (a, b) { return Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0); });
    var dropped = numbers.filter(function (n) { return n.change != null && n.change < 0; }).sort(function (a, b) { return Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0); });
    // Why: the products that moved sales most, and what changed beside them.
    var why = [];
    var names = {}; Object.keys(cur.products).concat(Object.keys(prev.products)).forEach(function (k) { names[k] = true; });
    var moves = Object.keys(names).map(function (k) { return { product: k, now: cur.products[k] || 0, before: prev.products[k] || 0, delta: (cur.products[k] || 0) - (prev.products[k] || 0) }; })
      .sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
    moves.slice(0, 3).forEach(function (m) {
      if (!m.delta) return;
      why.push(m.product + (m.delta > 0 ? ' sold ' : ' sold ') + round2(m.now) + ' against ' + round2(m.before) + ' last month (' + (m.delta > 0 ? '+' : '') + round2(m.delta) + ').');
    });
    var spend = numbers[3]; var rev = numbers[0];
    if (spend.change && rev.change != null) why.push('Ad spend ' + (spend.change > 0 ? 'rose' : 'fell') + ' by ' + Math.abs(spend.change) + ' while sales ' + (rev.change >= 0 ? 'rose' : 'fell') + ' by ' + Math.abs(rev.change) + '. These files cannot say how much of the sales the ads caused.');
    if (!why.length) why.push('The files on hand do not show why: add the sales export with product lines for both months.');

    // Three moves, each tied to a figure.
    var plan = [];
    if (x.worst_ad && x.worst_ad.worst) {
      var w = x.worst_ad.worst;
      plan.push({ move: 'Pause or replace the ad "' + w.ad + '".', impact: 'Up to ' + w.excess + ' of spend a month back, the amount it cost above your median cost per conversion.', basis: 'ad report' });
    }
    var riser = moves.filter(function (m) { return m.delta > 0; })[0];
    if (riser) plan.push({ move: 'Lead next week\'s mail and ads with ' + riser.product + '.', impact: 'It added ' + round2(riser.delta) + ' this month (' + round2(riser.now) + ' in total); a week of it at that rate is about ' + round2(riser.now / 4.3) + ' in sales.', basis: 'sales export' });
    if (x.reviews && x.reviews.complaints && x.reviews.complaints.length) {
      var c = x.reviews.complaints[0];
      plan.push({ move: 'Fix what customers complain about most: ' + c.theme + '.', impact: 'It comes up in ' + c.count + ' of ' + x.reviews.total + ' reviews (' + Math.round((c.share || 0) * 100) + '%).', basis: 'reviews' });
    }
    if (plan.length < 3 && x.xray && x.xray.summary && x.xray._categories && x.xray._categories[0]) {
      var big = x.xray._categories[0];
      plan.push({ move: 'Review your biggest cost, ' + big.category + '.', impact: 'It is ' + big.amount + ' over the months on file; every 10% saved is ' + round2(big.amount * 0.1) + '.', basis: 'expenses' });
    }
    var faller = moves.filter(function (m) { return m.delta < 0; })[0];
    if (plan.length < 3 && faller) plan.push({ move: 'Find out why ' + faller.product + ' slowed.', impact: 'It sold ' + round2(-faller.delta) + ' less than last month.', basis: 'sales export' });
    var gaps = [];
    if (cur.revenue == null) gaps.push('sales export');
    if (cur.ad_spend == null) gaps.push('ad report or expenses');
    if (cur.new_reviews == null) gaps.push('reviews');
    return { format: FORMAT, period: period, previous: prevPeriod, numbers: numbers, grew: grew, dropped: dropped, why: why, moves: plan.slice(0, 3), missing: gaps };
  }

  /** Ad report rows dated by month (an export of one month per file) -> {month: {cost, conversions}}. */
  function adsForMonth(report, period) {
    var a = report && report.ads || [];
    var out = {}; out[period] = { cost: round2(sum(a, function (r) { return r.cost; })), conversions: sum(a, function (r) { return r.conversions; }) };
    return out;
  }

  /* ── Report as text (the same layout every month) ─────────────────────── */

  function reportMarkdown(r, brandName, cur) {
    var L = [];
    L.push('# ' + (brandName ? brandName + ': ' : '') + 'monthly report, ' + r.period);
    L.push('');
    L.push('## Numbers');
    L.push('| | ' + r.period + ' | ' + r.previous + ' | Change |');
    L.push('|---|---|---|---|');
    r.numbers.forEach(function (n) {
      L.push('| ' + n.label + ' | ' + (n.this_month == null ? 'not in the files' : n.this_month) + ' | ' + (n.last_month == null ? 'not in the files' : n.last_month) + ' | ' + (n.change == null ? '' : (n.change > 0 ? '+' : '') + n.change + (n.change_pct == null ? '' : ' (' + Math.round(n.change_pct * 100) + '%)')) + ' |');
    });
    L.push('');
    L.push('## What grew');
    L.push(r.grew.length ? r.grew.map(function (n) { return '- ' + n.label + ': ' + n.last_month + ' to ' + n.this_month; }).join('\n') : '- Nothing in the files grew.');
    L.push('');
    L.push('## What dropped');
    L.push(r.dropped.length ? r.dropped.map(function (n) { return '- ' + n.label + ': ' + n.last_month + ' to ' + n.this_month; }).join('\n') : '- Nothing in the files dropped.');
    L.push('');
    L.push('## Why');
    L.push(r.why.map(function (w) { return '- ' + w; }).join('\n'));
    L.push('');
    L.push('## Three moves for next week');
    L.push(r.moves.length ? r.moves.map(function (m, i) { return (i + 1) + '. ' + m.move + ' Expected impact: ' + m.impact + ' (from the ' + m.basis + ')'; }).join('\n') : '1. Add the files below so the moves can be worked out.');
    if (r.missing.length) { L.push(''); L.push('Not in this report: ' + r.missing.join(', ') + '.'); }
    L.push('');
    L.push('_' + r.format + (cur ? ', figures in ' + cur : '') + '_');
    return L.join('\n');
  }

  return {
    FORMAT: FORMAT, parseCsv: parseCsv, num: num, day: day,
    readSales: readSales, readExpenses: readExpenses, readAds: readAds, readReviews: readReviews,
    xray: xray, baseline: baseline, evaluate: evaluate, scenarios: scenarios,
    worstAd: worstAd, reviewThemes: reviewThemes, isNegative: isNegative,
    monthFigures: monthFigures, ceoReport: ceoReport, adsForMonth: adsForMonth, reportMarkdown: reportMarkdown,
    COST_OF_GOODS: COST_OF_GOODS, ADVERTISING: ADVERTISING,
  };
});
