'use strict';
/**
 * region-revenue-server.js - the server half of "Revenue by region"
 * (brain.js ?action=region-revenue, 2026-10-11).
 *
 * Reads the CALLER's workspace AS THE CALLER (brand-workspace-core.restAs: the
 * user's own JWT, so RLS - is_brand_member on smart_orders / shopify_orders /
 * brand_catalog_products / brand_fx_rates - is the boundary), names the
 * workspace on every query, pages until an EMPTY page (PostgREST answers at
 * most max_rows whatever `limit` asks; a short page is not the end), and hands
 * the rows to region-revenue.js, the pure aggregation the browser runs too.
 *
 * Sources, per region, never two in one region (the same sale synced into both
 * tables would be counted twice):
 *   1. shopify_orders  - the brand's store orders polled into the workspace
 *                         (region = the country an order ships to, when that
 *                         country is one of the brand's markets);
 *   2. smart_orders    - the workspace's synced orders (each states its market);
 *   3. the sales export compiled into this build - TENANT ZERO ONLY, through
 *      market-analytics.ownsBundledExport(workspace), and only for a region
 *      the workspace's own orders do not cover. Another brand never gets it.
 * A region none of them covers gets the marker, never 0.
 *
 * Exchange rates are the OPERATOR's: entered here (op=fx-save, editor role),
 * stored on the brand with the date and who entered them, never fetched or
 * assumed (brand_fx_rates, 20261011045000).
 */

const RR = require('./region-revenue.js');

const PAGE = 1000;
const MAX_ORDER_ROWS = 200000;
const MAX_CATALOG_ROWS = 20000;

function core() { return require('./brand-workspace-core.js'); }

/**
 * Every row a PostgREST path returns, newest first, to a ceiling. Advances by
 * the rows RECEIVED and stops only on an empty page. A failed page throws (the
 * caller states it); a ceiling that is hit is reported, never silent.
 */
async function readAll(token, pathWithQuery, maxRows) {
  const rows = [];
  while (rows.length < maxRows) {
    const page = await core().restAs(token, `${pathWithQuery}&limit=${PAGE}&offset=${rows.length}`);
    if (!Array.isArray(page) || !page.length) return { rows, hitCeiling: false };
    rows.push(...page.slice(0, maxRows - rows.length));
  }
  const probe = await core().restAs(token, `${pathWithQuery}&limit=1&offset=${rows.length}`);
  return { rows, hitCeiling: Array.isArray(probe) && probe.length > 0 };
}

/** The brand's markets as the aggregation needs them: code, currency, zone, home. */
function regionsOf(brand) {
  const loc = require('./brand-locale.js');
  const list = (brand && Array.isArray(brand.regions)) ? brand.regions.filter((r) => r && r.code) : [];
  const home = require('./brand-runtime.js').homeRegion(brand || {});
  return list.map((r) => {
    const code = String(r.code).toUpperCase();
    const l = loc.localeFor(brand, code);
    return { code, currency: l.currency || '', timezone: l.timeZone || '', home: code === home };
  });
}

/** The regions a request asked for, held to the brand's own list. */
function selectionOf(asked, regions) {
  const raw = Array.isArray(asked) ? asked : String(asked || '').split(',');
  const words = raw.map((s) => String(s || '').trim()).filter(Boolean);
  if (words.some((w) => /^all$/i.test(w))) return { selected: regions.map((r) => r.code), refused: [] };
  const selected = [];
  const refused = [];
  for (const w of words) {
    const c = RR.resolveRegion(w, regions);
    if (c) { if (!selected.includes(c)) selected.push(c); } else refused.push(w);
  }
  if (!selected.length) { const h = regions.find((r) => r.home); if (h) selected.push(h.code); }
  return { selected, refused };
}

function brandNameOf(brand) { return (brand && typeof brand.name === 'string' && brand.name.trim()) || 'this brand'; }

/** A failed read, said as a sentence naming the table; never "no data". */
function readFailure(table, e) {
  const status = Number(e && e.status) || 0;
  return status === 401 || status === 403
    ? `${table} could not be read for your account (${status}).`
    : `${table} could not be read: ${String((e && e.message) || e).slice(0, 160)}`;
}

/**
 * Drop the oldest day of a newest-first read that hit its ceiling (it may be
 * partial) and say from when the window is complete.
 */
function trimToCompleteDays(rows, dateKey) {
  let oldest = '';
  for (const r of rows) { const d = String(r[dateKey] || '').slice(0, 10); if (d && (!oldest || d < oldest)) oldest = d; }
  return { rows: oldest ? rows.filter((r) => String(r[dateKey] || '').slice(0, 10) > oldest) : [], complete_from: oldest || null };
}

async function readOrders(auth, ws, regions) {
  const id = encodeURIComponent(ws);
  const sources = [];
  const out = {};
  const plans = [
    { kind: 'shopify_orders', label: 'store orders synced from Shopify (shopify_orders)', date: 'created_at_shopify',
      path: `shopify_orders?select=shopify_order_id,total_price,currency,created_at_shopify,raw_payload&workspace_id=eq.${id}&order=created_at_shopify.desc,shopify_order_id.desc`,
      norm: RR.fromShopifyOrders },
    { kind: 'smart_orders', label: 'this workspace\'s synced orders (smart_orders)', date: 'created_at',
      path: `smart_orders?select=id,user_id,market,total,created_at,product_sku,metadata&workspace_id=eq.${id}&order=created_at.desc,id.desc`,
      norm: RR.fromSmartOrders },
  ];
  for (const p of plans) {
    const s = { kind: p.kind, label: p.label, read: false, rows: 0, error: null, truncated: null, complete_from: null, unattributed: 0, unattributed_markets: [], dropped: {} };
    try {
      const r = await readAll(auth.token, p.path, MAX_ORDER_ROWS);
      let rows = r.rows;
      if (r.hitCeiling) {
        const t = trimToCompleteDays(rows, p.date);
        rows = t.rows; s.complete_from = t.complete_from;
        s.truncated = `Only the newest ${MAX_ORDER_ROWS.toLocaleString('en')} rows of ${p.kind} were read; orders before ${t.complete_from} were not read.`;
      }
      const n = p.norm(rows, regions);
      s.read = true; s.rows = rows.length; s.dropped = n.dropped;
      const un = n.orders.filter((o) => !o.region);
      s.unattributed = un.length;
      s.unattributed_markets = Array.from(new Set(un.map((o) => o.market_raw || '(none stated)'))).slice(0, 8);
      out[p.kind] = n.orders.filter((o) => o.region);
    } catch (e) {
      s.error = readFailure(p.kind, e);
      out[p.kind] = null;
    }
    sources.push(s);
  }
  return { sources, byKind: out };
}

async function readCatalogue(auth, ws, brand) {
  try {
    const r = await readAll(auth.token, `brand_catalog_products?select=region,sku,handle,title,source_url,product_url&workspace_id=eq.${encodeURIComponent(ws)}&stale_at=is.null&order=id.asc`, MAX_CATALOG_ROWS);
    // Another brand's catalogue rows are not this brand's (brand-coherence's
    // own verdict, the rule generation uses).
    let rows = r.rows;
    try {
      const C = require('./brand-coherence.js');
      const v = C.catalogIdentity(brand);
      if (v) rows = rows.filter((p) => !C.catalogRowForeign(p, v));
    } catch (_) { /* no verdict: every row is the workspace's */ }
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: readFailure('brand_catalog_products', e) };
  }
}

async function readRates(auth, ws) {
  try {
    const rows = await core().restAs(auth.token, `brand_fx_rates?select=id,from_currency,to_currency,rate,as_of,entered_by,entered_by_email,entered_at&workspace_id=eq.${encodeURIComponent(ws)}&order=entered_at.desc&limit=500`);
    return { rates: (Array.isArray(rows) ? rows : []).map(rateOut), error: null };
  } catch (e) {
    return { rates: [], error: readFailure('brand_fx_rates', e) };
  }
}
function rateOut(r) {
  return { id: r.id, from: r.from_currency, to: r.to_currency, rate: Number(r.rate), as_of: r.as_of, entered_by: r.entered_by_email || r.entered_by || null, entered_at: r.entered_at };
}

/**
 * The per-region read. opts: { auth, workspaceId, brand, query }
 * query: regions (comma list or ALL), days | from + to, granularity, base.
 */
async function read({ auth, workspaceId, brand, query }) {
  const q = query || {};
  const name = brandNameOf(brand);
  const regions = regionsOf(brand);
  if (!regions.length) {
    return { ok: true, brand: { name }, regions: [], selected: [], results: {}, marker: RR.marker('home market', name), message: `${name} declares no market, so there is no region to report on. Add its markets on the brand record first.` };
  }
  const { selected, refused } = selectionOf(q.regions, regions);
  const today = new Date().toISOString().slice(0, 10);
  const win = RR.windowOf({ from: q.from, to: q.to, days: q.days, today });
  const [orders, catalogue, fx] = await Promise.all([readOrders(auth, workspaceId, regions), readCatalogue(auth, workspaceId, brand), readRates(auth, workspaceId)]);
  const base = String(q.base || '').toUpperCase() || ((regions.find((r) => r.home) || {}).currency || '');
  const results = {};
  let bundled = null;
  for (const code of selected) {
    let picked = null;
    for (const s of orders.sources) {
      const list = orders.byKind[s.kind];
      if (!list) continue;
      const mine = list.filter((o) => o.region === code);
      if (!mine.length) continue;
      const agg = RR.aggregate(mine, {
        regions, selected: [code], from: win.from, to: win.to, today, granularity: q.granularity, brand: name,
        source: { kind: s.kind, label: s.label }, catalogue: catalogue.rows, complete_from: s.complete_from, truncated: s.truncated,
      });
      picked = agg.regions[code];
      break;
    }
    if (!picked) {
      if (bundled === null) bundled = await require('./market-analytics.js').ownsBundledExport(workspaceId).catch(() => false);
      if (bundled) {
        const ma = require('./market-analytics.js');
        const data = ma.data();
        const key = ma.normMarket(code);
        if (data.markets && data.markets[key]) {
          picked = RR.fromExport(data.markets[key], code, { from: win.from, to: win.to, today, brand: name, currency: ma.cur(key) });
        }
      }
    }
    if (!picked) {
      const failed = orders.sources.filter((s) => s.error).map((s) => s.error);
      picked = {
        code, available: false, window: { from: win.from, to: win.to },
        marker: RR.marker('order history', name, code),
        reason: failed.length
          ? `No orders for ${code} were read. ${failed.join(' ')} Nothing is borrowed from another market.`
          : `No orders for ${code} are stored for ${name} (shopify_orders, smart_orders). Connect its store or sync its orders; nothing is borrowed from another market.`,
      };
    }
    results[code] = picked;
  }
  return {
    ok: true, brand: { name }, regions, selected, refused,
    refused_message: refused.length ? `${refused.join(', ')} ${refused.length === 1 ? 'is' : 'are'} not among ${name}'s markets (${regions.map((r) => r.code).join(', ')}), so ${refused.length === 1 ? 'it was' : 'they were'} left out.` : '',
    window: win, granularity: RR.granularityFor(win.days, q.granularity),
    results,
    totals: RR.totals(results, { base, rates: fx.rates }, name),
    fx: { base, rates: fx.rates, error: fx.error },
    sources: orders.sources.map((s) => ({ kind: s.kind, label: s.label, read: s.read, rows: s.rows, error: s.error, truncated: s.truncated, unattributed: s.unattributed, unattributed_markets: s.unattributed_markets, dropped: s.dropped })),
    catalogue: { rows: catalogue.rows.length, error: catalogue.error },
    bundled_export: bundled === true,
  };
}

/** op=fx-save: an operator enters one dated rate. Editors and owners only. */
async function saveRate({ auth, workspaceId, body }) {
  await core().assertCanWrite(auth, workspaceId, 'enter exchange rates');
  const today = new Date().toISOString().slice(0, 10);
  const v = RR.validRate(body || {}, today);
  if (!v.ok) { const e = new Error(v.message); e.status = 400; e.code = 'invalid_rate'; throw e; }
  const rows = await core().restAs(auth.token, 'brand_fx_rates?select=id,from_currency,to_currency,rate,as_of,entered_by,entered_by_email,entered_at', {
    method: 'POST', prefer: 'return=representation',
    body: { workspace_id: workspaceId, from_currency: v.rate.from, to_currency: v.rate.to, rate: v.rate.rate, as_of: v.rate.as_of, entered_by: auth.user_id, entered_by_email: auth.email || null },
  });
  return { ok: true, rate: rateOut((Array.isArray(rows) && rows[0]) || {}) };
}

/** op=fx-delete: remove one entered rate (editors and owners). */
async function deleteRate({ auth, workspaceId, body }) {
  await core().assertCanWrite(auth, workspaceId, 'remove exchange rates');
  const id = String((body && body.id) || '');
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) { const e = new Error('Name the rate to remove.'); e.status = 400; e.code = 'invalid_rate'; throw e; }
  await core().restAs(auth.token, `brand_fx_rates?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`, { method: 'DELETE' });
  return { ok: true, deleted: id };
}

/** The router's entry: answers { status, body }. */
async function handle(op, ctx) {
  try {
    if (op === 'fx-save') return { status: 200, body: await saveRate(ctx) };
    if (op === 'fx-delete') return { status: 200, body: await deleteRate(ctx) };
    if (op && op !== 'read') return { status: 400, body: { ok: false, error: 'unknown_op', message: `region-revenue has no "${op}" op (read, fx-save, fx-delete).` } };
    return { status: 200, body: await read(ctx) };
  } catch (e) {
    const status = Number(e && e.status) || 500;
    return { status, body: { ok: false, error: e.code || (status === 403 ? 'forbidden' : 'region_revenue_failed'), message: String((e && e.message) || e) } };
  }
}

module.exports = { read, saveRate, deleteRate, handle, regionsOf, selectionOf, readAll, MAX_ORDER_ROWS };
