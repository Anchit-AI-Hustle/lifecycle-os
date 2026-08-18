'use strict';

/**
 * shopify-core.js — LIVE, READ-ONLY Shopify Admin reads.
 *
 * Until now the only Admin API call anywhere in the project was the
 * `shop.json` liveness probe in connectors-health: the health page could say
 * "Shopify is live" while nothing in the app could actually read an order. The
 * store's real numbers came from CSV exports (market-analytics) and public
 * storefront scraping, both of which are real but neither of which is live.
 * This module is the missing live path.
 *
 * READ-ONLY by construction, three ways over:
 *   1. every request goes through guardedFetch, which throws on any verb other
 *      than GET/HEAD aimed at a Shopify host (read-only-egress.js),
 *   2. no mutating endpoint is implemented here at all, and
 *   3. the credential itself should be a read-scoped Admin token
 *      (read_orders, read_products, read_customers, read_inventory).
 *
 * Gated on the LIVE_CONNECTORS kill switch like every other outbound connector,
 * so the documented "default is OFF, never opens a live external connection"
 * contract holds for Shopify too.
 *
 * Never fabricates. With no credential (or the switch off) every op returns a
 * structured { connected:false, would_request } envelope naming the exact HTTP
 * request that would have run, so callers can render an honest empty state.
 *
 * ── WHOSE STORE, IN A MULTI-BRAND PLATFORM ─────────────────────────────────
 * Ported from the single-tenant sibling, where the store was the deployment's
 * and lived entirely in env vars. Here it is the WORKSPACE'S: credentials come
 * from that brand's own `shopify` connection first (stored AES-256-GCM encrypted
 * by workspace-connections-core), and the deployment env is only a fallback for
 * tenant zero and for cron jobs that run with no request to resolve a workspace
 * from. Reading one brand's orders under another brand's session is the failure
 * this whole codebase keeps guarding against, so the credential is resolved per
 * request rather than at require-time.
 *
 * Env fallback (append _<MARKET> for a market-specific store):
 *   SHOPIFY_STORE_DOMAIN   e.g. your-store.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN    read-scoped Admin API access token
 *   SHOPIFY_API_VERSION    optional, defaults below
 */

const { guardedFetch } = require('./read-only-egress.js');
const { liveConnectorsEnabled } = require('./live-connectors.js');

const API_VERSION = String(process.env.SHOPIFY_API_VERSION || '2026-04').trim();
const PAGE_MAX = 250; // Shopify's hard per-page ceiling

/**
 * A market is whatever the BRAND calls its regions, not a fixed list. The
 * sibling hardcoded US/UK/IN because that was one company's footprint; a
 * platform that any brand onboards cannot assume it. Normalising is therefore
 * limited to case and the handful of aliases that are unambiguous worldwide.
 */
const MARKET_ALIASES = {
  USA: 'US', 'UNITED STATES': 'US',
  GB: 'UK', 'UNITED KINGDOM': 'UK', BRITAIN: 'UK',
  IND: 'IN', INDIA: 'IN',
};
function normMarket(m) {
  const s = String(m || 'US').trim().toUpperCase();
  return MARKET_ALIASES[s] || s.replace(/[^A-Z0-9_]/g, '');
}
function envFor(base, market) {
  const mk = normMarket(market);
  return String(process.env[`${base}_${mk}`] || process.env[base] || '').trim();
}

/**
 * The workspace's store, pinned for the duration of one generation.
 *
 * AsyncLocalStorage rather than a module variable, for the same reason
 * brand-catalog-server.withCatalog() uses it: a warm serverless runtime serves
 * concurrent requests from ONE process, and a module-level "current store"
 * would let brand A's request read brand B's orders. This is the identical bug
 * class, one table over.
 */
const { AsyncLocalStorage } = require('async_hooks');
const STORE = new AsyncLocalStorage();

/** Pin a workspace's Shopify credentials for everything `fn` does. */
function withStore(creds, fn) {
  return STORE.run({ creds: creds || null }, fn);
}
function pinnedCreds() {
  const s = STORE.getStore();
  return (s && s.creds) || null;
}

/**
 * Credentials for this request's workspace, or the deployment's as a fallback.
 * Explicit `creds` wins, then whatever `withStore()` pinned, then env.
 */
function cfg(market, creds) {
  const c = creds || pinnedCreds() || {};
  const domain = String(c.shop_domain || '').trim() || envFor('SHOPIFY_STORE_DOMAIN', market);
  const token = String(c.admin_access_token || '').trim() || envFor('SHOPIFY_ADMIN_TOKEN', market);
  return {
    domain: domain.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    token,
    version: String(c.api_version || '').trim() || API_VERSION,
    source: (c.shop_domain && c.admin_access_token) ? 'workspace' : (domain && token ? 'deployment' : 'none'),
  };
}
function isConnected(market, creds) {
  const c = cfg(market, creds);
  return liveConnectorsEnabled() && !!(c.domain && c.token);
}

function qs(obj) {
  return Object.entries(obj || {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
function urlFor(market, path, query) {
  const c = cfg(market);
  const host = c.domain || '{SHOPIFY_STORE_DOMAIN}';
  const q = qs(query);
  return `https://${host}/admin/api/${c.version}/${path}${q ? `?${q}` : ''}`;
}

// The blocker is reported per-reason so the UI can tell "no credential" apart
// from "credential present but the kill switch is off" — they need different fixes.
function blockerFor(market) {
  const c = cfg(market);
  if (!liveConnectorsEnabled()) return 'Live connectors are disabled — set LIVE_CONNECTORS=on to allow outbound reads.';
  const missing = [];
  if (!c.domain) missing.push('a shop domain');
  if (!c.token) missing.push('an Admin API access token');
  if (!missing.length) return null;
  // The sibling this was ported from told the reader to set Vercel env vars.
  // That is the wrong instruction on a platform a brand operator uses: they do
  // not have the deployment. Their store is connected on their own Connections
  // page, and the env fallback is for tenant zero and cron only.
  return `Connect Shopify for this brand on the Connections page — it needs ${missing.join(' and ')}. `
    + 'The token must be read-scoped (read_orders, read_products, read_customers, read_inventory); this platform never writes to a store. '
    + `A deployment-wide fallback also exists via SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN (append _${normMarket(market)} for one market), for the platform's own store and for scheduled jobs.`;
}
function notConnected(market, op, path, query) {
  return {
    ok: false, connected: false, not_connected: true,
    platform: 'shopify', market: normMarket(market), op,
    would_request: { method: 'GET', url: urlFor(market, path, query), headers: { 'X-Shopify-Access-Token': 'REDACTED' } },
    blocker: blockerFor(market),
    hint: 'No store figure is fabricated. The app falls back to the CSV market exports and public storefront data, both of which are labelled as not-live.',
  };
}

async function read(market, op, path, query = {}, timeoutMs = 20000) {
  if (!isConnected(market)) return notConnected(market, op, path, query);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const url = urlFor(market, path, query);
  try {
    const res = await guardedFetch(url, {
      signal: ctrl.signal, cache: 'no-store',
      headers: { 'X-Shopify-Access-Token': cfg(market).token, Accept: 'application/json' },
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text.slice(0, 400) }; }
    if (!res.ok) {
      return {
        ok: false, connected: true, platform: 'shopify', market: normMarket(market), op,
        status: res.status,
        error: (json && (json.errors || json.error)) || `shopify ${res.status}`,
        // A 401/403 here almost always means the token lacks the read scope for
        // this resource rather than being wholly invalid — say so, since the fix differs.
        hint: (res.status === 401 || res.status === 403)
          ? 'Token rejected for this resource. Check the read scope it was granted (read_orders / read_products / read_customers / read_inventory).'
          : null,
      };
    }
    return {
      ok: true, connected: true, platform: 'shopify', market: normMarket(market), op,
      source: `shopify_admin_${cfg(market).version}`, fetched_at: new Date().toISOString(),
      data: json,
    };
  } catch (e) {
    // A read-only violation must surface as itself, not as a generic fetch failure.
    if (e && e.read_only_blocked) throw e;
    return { ok: false, connected: true, platform: 'shopify', market: normMarket(market), op, error: e.message };
  } finally { clearTimeout(timer); }
}

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
const round = (v, n = 2) => Math.round(num(v) * 10 ** n) / 10 ** n;
const clamp = (v, d, max = PAGE_MAX) => Math.min(Math.max(parseInt(v, 10) || d, 1), max);
function isoDaysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString(); }

// ── Ops ─────────────────────────────────────────────────────────────────────
async function shop({ market } = {}) { return read(market, 'shop', 'shop.json'); }

// landing_site / referring_site / source_name are what make an order's ORIGIN
// knowable. They were not requested before, so no attribution question could be
// answered from this data at all.
const ORDER_FIELDS = 'id,name,created_at,processed_at,cancelled_at,test,total_price,currency,financial_status,fulfillment_status,customer,line_items,discount_codes,source_name,landing_site,referring_site,note_attributes';

async function orders({ market, days = 30, limit = PAGE_MAX, status = 'any' } = {}) {
  return read(market, 'orders', 'orders.json', {
    status, limit: clamp(limit, PAGE_MAX), created_at_min: isoDaysAgo(clamp(days, 30, 365)),
    fields: ORDER_FIELDS,
  });
}

// ── Paged read ──────────────────────────────────────────────────────────────
// A single Shopify page caps at 250 orders, so "all orders" over any real window
// needs cursor pagination via the Link header. maxPages bounds the work so this
// cannot run past a serverless timeout; when the cap is hit the result says so
// rather than quietly returning a partial answer as if it were complete.
async function readPagedOrders(market, { days, status = 'any', maxPages = 20 } = {}) {
  if (!isConnected(market)) {
    return notConnected(market, 'orders-paged', 'orders.json', { status, fields: ORDER_FIELDS });
  }
  const all = [];
  let url = urlFor(market, 'orders.json', {
    status, limit: PAGE_MAX, created_at_min: isoDaysAgo(clamp(days, 30, 365)), fields: ORDER_FIELDS,
  });
  let pages = 0, truncated = false;
  while (url) {
    if (pages >= maxPages) { truncated = true; break; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try {
      res = await guardedFetch(url, {
        signal: ctrl.signal, cache: 'no-store',
        headers: { 'X-Shopify-Access-Token': cfg(market).token, Accept: 'application/json' },
      });
    } finally { clearTimeout(timer); }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    if (!res.ok) {
      return {
        ok: false, connected: true, platform: 'shopify', market: normMarket(market), op: 'orders-paged',
        status: res.status, error: (json && (json.errors || json.error)) || `shopify ${res.status}`,
        hint: (res.status === 401 || res.status === 403)
          ? 'Token rejected. read_orders scope is required to read order attribution.' : null,
      };
    }
    all.push(...((json && json.orders) || []));
    pages++;
    // Shopify returns the cursor in a Link header; there is no page-number API.
    const link = res.headers && res.headers.get && res.headers.get('link');
    const next = link && /<([^>]+)>;\s*rel="next"/.exec(link);
    url = next ? next[1] : null;
  }
  return {
    ok: true, connected: true, platform: 'shopify', market: normMarket(market), op: 'orders-paged',
    source: `shopify_admin_${cfg(market).version}`, fetched_at: new Date().toISOString(),
    pages, truncated, orders: all,
  };
}
async function products({ market, limit = PAGE_MAX } = {}) {
  return read(market, 'products', 'products.json', {
    limit: clamp(limit, PAGE_MAX), fields: 'id,title,handle,status,product_type,tags,variants,created_at,updated_at',
  });
}
async function customers({ market, limit = PAGE_MAX } = {}) {
  return read(market, 'customers', 'customers.json', {
    limit: clamp(limit, PAGE_MAX), fields: 'id,created_at,orders_count,total_spent,state,tags,last_order_id',
  });
}
async function inventory({ market, limit = PAGE_MAX } = {}) {
  const locs = await read(market, 'locations', 'locations.json', { fields: 'id,name,active' });
  if (!locs.ok) return locs;
  const ids = ((locs.data && locs.data.locations) || []).filter((l) => l.active !== false).map((l) => l.id);
  if (!ids.length) return { ok: true, connected: true, platform: 'shopify', market: normMarket(market), op: 'inventory', data: { inventory_levels: [] }, note: 'No active locations returned.' };
  return read(market, 'inventory', 'inventory_levels.json', { location_ids: ids.join(','), limit: clamp(limit, PAGE_MAX) });
}

/**
 * summary() — the rollup the dashboards actually want: real revenue, order
 * count, AOV and returning-customer share over a window, computed from live
 * orders rather than from an export. Derived only from figures Shopify
 * returned; nothing is modelled or estimated.
 */
async function summary({ market, days = 30 } = {}) {
  const o = await orders({ market, days });
  if (!o.ok) return Object.assign({}, o, { op: 'summary' });
  const rows = (o.data && o.data.orders) || [];
  const revenue = rows.reduce((s, r) => s + num(r.total_price), 0);
  // orders_count > 1 marks a repeat buyer at the time the order was placed.
  const returning = rows.filter((r) => r.customer && num(r.customer.orders_count) > 1).length;
  const currency = (rows.find((r) => r.currency) || {}).currency || null;
  return {
    ok: true, connected: true, platform: 'shopify', market: normMarket(market), op: 'summary',
    source: o.source, fetched_at: o.fetched_at, window_days: clamp(days, 30, 365), currency,
    orders: rows.length, revenue: round(revenue),
    aov: rows.length ? round(revenue / rows.length) : null,
    returning_orders: returning,
    returning_rate_pct: rows.length ? round(returning / rows.length * 100, 1) : null,
    note: rows.length === PAGE_MAX
      ? `Exactly ${PAGE_MAX} orders returned — this is one page, so the window is truncated and these totals are a floor, not the full period.`
      : null,
  };
}

function status(market) {
  const c = cfg(market);
  return {
    ok: true, platform: 'shopify', market: normMarket(market),
    connected: isConnected(market),
    domain_set: !!c.domain, token_set: !!c.token,
    live_connectors: liveConnectorsEnabled(), api_version: c.version,
    blocker: blockerFor(market),
    read_only: true,
    note: 'Read-only: only GET is permitted to Shopify hosts (read-only-egress.js). No mutation endpoint is implemented.',
  };
}

const OPS = {
  status: async (p) => status(p.market),
  shop, orders, products, customers, inventory, summary,
  // Declared here but defined below; the object is only read at dispatch time.
  attribution: (p) => attribution(p),
};

// ── Order source attribution ────────────────────────────────────────────────
// WHAT THIS IS: last-click attribution read from the order's own landing_site
// UTMs, with referring_site as a fallback. It is NOT Shopify's multi-touch
// customer journey (that lives in the GraphQL customerJourneySummary and needs a
// different scope), and it is not Klaviyo's self-reported attribution — which is
// the point. Counting email-sourced orders straight off the order record is an
// INDEPENDENT check on what the email platform claims for itself.
//
// THE HONESTY RULE THAT MATTERS MOST: an order with no UTM and no referrer is
// `direct_or_unknown`, which is NOT the same as "not email". An email click that
// lost its UTMs (pasted link, stripped redirect, app browser) lands there. So the
// unattributed share is reported alongside every conclusion — if it is large, a
// "peak email day" is weakly supported and the caller is told so rather than
// being handed a confident-looking date.
const EMAIL_SOURCES = /^(klaviyo|mailchimp|email|e-mail|webengage|sendgrid|braze|omnisend)$/i;
const EMAIL_MEDIUMS = /^(e?mail|newsletter|lifecycle|flow|campaign_email)$/i;
const PAID_MEDIUMS = /^(cpc|ppc|paid|paidsocial|paid_social|paid-social|display|retargeting)$/i;
const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex)\./i;
const SOCIAL_HOSTS = /(^|\.)(facebook|instagram|tiktok|pinterest|twitter|x|linkedin|reddit|snapchat|youtube)\./i;

function utmsOf(landingSite) {
  const out = {};
  if (!landingSite) return out;
  try {
    // landing_site is usually a path+query, so give URL a base to resolve against.
    const u = new URL(String(landingSite), 'https://shop.invalid');
    u.searchParams.forEach((v, k) => { out[k.toLowerCase()] = v; });
  } catch (_) { /* unparseable landing_site contributes nothing, never a guess */ }
  return out;
}
function hostOf(ref) {
  if (!ref) return '';
  try { return new URL(String(ref)).hostname.toLowerCase(); } catch (_) { return ''; }
}

/**
 * Classify ONE order. Returns { channel, why } where `why` names the evidence, so
 * every number in the rollup can be traced back to the field that produced it.
 */
function classifyOrder(order) {
  const src = String((order && order.source_name) || '').toLowerCase();
  if (src === 'pos') return { channel: 'pos', why: 'source_name=pos' };
  if (src.indexOf('draft') >= 0) return { channel: 'draft_order', why: `source_name=${src}` };

  const utm = utmsOf(order && order.landing_site);
  const medium = String(utm.utm_medium || '').toLowerCase();
  const source = String(utm.utm_source || '').toLowerCase();

  // MEDIUM WINS OVER SOURCE, always. Klaviyo and WebEngage send email, SMS and
  // push from the same utm_source, so inferring "email" from the source alone
  // counts SMS and push orders as email — inflating the email total and able to
  // move the peak day onto a date whose spike was actually an SMS blast.
  // An explicit medium is direct evidence; the source is only ever a fallback.
  if (/^sms$/i.test(medium)) return { channel: 'sms', why: `utm_medium=${medium} (source ${source || '-'} sends several channels)` };
  if (/^(push|web_?push|app_?push)$/i.test(medium)) return { channel: 'push', why: `utm_medium=${medium}` };
  if (EMAIL_MEDIUMS.test(medium)) return { channel: 'email', why: `utm_medium=${medium}` };
  if (PAID_MEDIUMS.test(medium)) return { channel: 'paid', why: `utm_source=${source || '-'} utm_medium=${medium}` };
  // No medium at all: an email-platform source is suggestive, so it counts, but
  // the reason records that it was INFERRED rather than stated.
  if (!medium && (EMAIL_SOURCES.test(source) || /klaviyo/i.test(source))) {
    return { channel: 'email', why: `utm_source=${source} with no utm_medium - inferred email` };
  }
  if (medium || source) return { channel: 'other_campaign', why: `utm_source=${source || '-'} utm_medium=${medium || '-'}` };

  const host = hostOf(order && order.referring_site);
  if (host && SEARCH_HOSTS.test(host)) return { channel: 'organic_search', why: `referring_site=${host}` };
  if (host && SOCIAL_HOSTS.test(host)) return { channel: 'organic_social', why: `referring_site=${host}` };
  if (host) return { channel: 'referral', why: `referring_site=${host}` };

  // No UTM, no referrer. NOT evidence of "not email".
  return { channel: 'direct_or_unknown', why: 'no utm on landing_site, no referring_site' };
}

// An order that was cancelled, refunded or placed as a test is not a result. It
// was still counted before, so a single cancelled order could win a day the peak,
// and a refunded high-value order could carry a date on revenue. Shopify's
// status=any deliberately includes cancelled orders, so this has to be filtered
// here rather than assumed away by the query.
//
// Excluded orders are REPORTED, not silently dropped: the gross count stays
// visible alongside the net so the difference is auditable rather than a number
// that quietly shrank.
function orderQuality(o) {
  if (o && o.test === true) return { counts: false, reason: 'test order' };
  if (o && o.cancelled_at) return { counts: false, reason: 'cancelled' };
  const fs = String((o && o.financial_status) || '').toLowerCase();
  if (fs === 'refunded' || fs === 'voided') return { counts: false, reason: fs };
  return { counts: true, reason: null };
}

// Bucket by the SHOP's local date, not UTC. An evening send in America/New_York
// straddles two UTC dates, which would split its orders across two buckets and
// move the apparent peak by a day.
function localDate(iso, tz) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (!tz) return d.toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch (_) { return d.toISOString().slice(0, 10); }
}

async function attribution({ market, days = 90, maxPages = 20, timezone } = {}) {
  const paged = await readPagedOrders(market, { days, maxPages });
  if (!paged.ok) return paged;

  // The shop's own timezone, so the day boundary is the one the business uses.
  let tz = timezone || null, tzSource = timezone ? 'caller' : null;
  if (!tz) {
    const s = await shop({ market }).catch(() => null);
    tz = (s && s.ok && s.data && s.data.shop && s.data.shop.iana_timezone) || null;
    tzSource = tz ? 'shop.iana_timezone' : 'utc_fallback';
  }

  const byDate = new Map();
  const channelTotals = {};
  const emailExamples = [];
  const excluded = {};
  let excludedTotal = 0, emailGross = 0;
  for (const o of paged.orders) {
    const { channel, why } = classifyOrder(o);
    const date = localDate(o.processed_at || o.created_at, tz);
    if (!date) continue;
    if (channel === 'email') emailGross++;
    const q = orderQuality(o);
    if (!q.counts) {
      excluded[q.reason] = (excluded[q.reason] || 0) + 1;
      excludedTotal++;
      continue;                       // never lets a cancelled order win a day
    }
    channelTotals[channel] = (channelTotals[channel] || 0) + 1;
    if (!byDate.has(date)) byDate.set(date, { date, total: 0, channels: {}, email_revenue: 0 });
    const row = byDate.get(date);
    row.total++;
    row.channels[channel] = (row.channels[channel] || 0) + 1;
    if (channel === 'email') {
      row.email_revenue = round(row.email_revenue + num(o.total_price));
      if (emailExamples.length < 5) emailExamples.push({ order: o.name, at: o.created_at, why, landing_site: o.landing_site });
    }
  }

  const days_rows = [...byDate.values()]
    .map((r) => ({ ...r, email: r.channels.email || 0 }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const ranked = [...days_rows].sort((a, b) => b.email - a.email || b.email_revenue - a.email_revenue);
  const peak = ranked[0] || null;
  // A tie is a real outcome, not something to hide behind "the" peak day.
  const tied = peak ? ranked.filter((r) => r.email === peak.email).map((r) => r.date) : [];

  const total = paged.orders.length;
  // The unattributed SHARE must be measured against the orders that were actually
  // counted, not against gross. Dividing by gross silently dilutes it every time
  // an order is excluded — 1 of 10 counted became "7.69%" of 13 read, which
  // understates exactly the caveat a reader relies on to judge the answer.
  const counted = Object.values(channelTotals).reduce((a, n) => a + n, 0);
  const unattributed = channelTotals.direct_or_unknown || 0;
  const unattributed_pct = counted ? round((unattributed / counted) * 100) : null;

  return {
    ok: true, connected: true, platform: 'shopify', market: normMarket(market), op: 'attribution',
    source: paged.source, fetched_at: paged.fetched_at,
    window_days: clamp(days, 30, 365), orders_read: total, orders_counted: counted, pages: paged.pages,
    truncated: paged.truncated,
    timezone: tz || 'UTC', timezone_source: tzSource,
    method: 'last-click from the order landing_site UTMs, referring_site as fallback',
    channel_totals: channelTotals,
    email_orders: channelTotals.email || 0,
    email_orders_gross: emailGross,
    excluded_orders: excludedTotal,
    excluded_breakdown: excluded,
    peak_email_day: peak ? { date: peak.date, email_orders: peak.email, email_revenue: peak.email_revenue, orders_that_day: peak.total } : null,
    peak_is_tied_with: tied.length > 1 ? tied : [],
    email_examples: emailExamples,
    by_date: days_rows,
    // Stated with every answer, because it bounds how much the answer is worth.
    unattributed_orders: unattributed,
    unattributed_pct,
    caveats: [
      'Last-click only. This is NOT Shopify multi-touch attribution (customerJourneySummary, GraphQL, separate scope) and NOT Klaviyo self-reported attribution - being independent of Klaviyo is the point of this check.',
      excludedTotal
        ? `${excludedTotal} order(s) excluded as not-a-result (${Object.entries(excluded).map(([k, v]) => `${v} ${k}`).join(', ')}). Email gross was ${emailGross}, net ${channelTotals.email || 0}. status=any includes cancelled orders, so this filter is what stops a cancelled order winning a day.`
        : 'No cancelled, refunded, voided or test orders in the window - gross and net are the same.',
      `${unattributed} of ${counted} counted orders (${unattributed_pct == null ? '-' : unattributed_pct}%) have no UTM and no referrer. Those are direct_or_unknown, NOT "not email": an email click that lost its UTMs lands there, so the true email count is a floor, not an exact figure.`,
      paged.truncated ? `Stopped at the ${maxPages}-page cap, so this is a PARTIAL read of the window and the peak day may be wrong. Narrow --days or raise maxPages.` : `Complete read of the window across ${paged.pages} page(s).`,
      tz ? `Dates bucketed in the shop timezone ${tz} (${tzSource}).` : 'Shop timezone unavailable; dates bucketed in UTC, which can split an evening send across two days.',
    ],
  };
}

/**
 * Resolve the ACTIVE WORKSPACE's Shopify credentials for the request being
 * served, and pin them for the whole op. Returns null when there is no request
 * or the workspace has not connected Shopify, in which case cfg() falls back to
 * the deployment env exactly as the single-tenant original did.
 *
 * Never throws: a credential lookup failure must degrade to the honest
 * not-connected envelope, not to a 500.
 */
async function workspaceCreds() {
  try {
    const conn = require('./workspace-connections-core.js');
    return await conn.credentialsForCurrentRequest('shopify');
  } catch (_) { return null; }
}

async function dispatch(op, params = {}) {
  const fn = OPS[String(op || 'summary').toLowerCase()];
  if (!fn) return { ok: false, error: `Unknown Shopify op '${op}'`, available: Object.keys(OPS) };
  // Resolve once, pin for the op. Every helper below reads it synchronously.
  const creds = (params && params.credentials) || await workspaceCreds();
  return withStore(creds, () => fn(params || {}));
}

module.exports = {
  dispatch, OPS, status, isConnected, cfg, normMarket, withStore, workspaceCreds,
  shop, orders, products, customers, inventory, summary,
  attribution, classifyOrder, orderQuality, readPagedOrders, localDate,
};
