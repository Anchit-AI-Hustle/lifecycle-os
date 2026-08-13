'use strict';
/**
 * connectors-health.js — REAL live probes for every data platform, so "is the
 * live data working?" is answered by an actual round-trip, not by guessing from
 * which env vars are set. Each probe hits the platform (or its stored table) and
 * reports {live, latency_ms, sample, blocker}. Never fabricates: a platform with
 * no credential is reported live:false with the exact blocker.
 *
 * Exposed at /api/connectors-health (GET). Reused by the connectors page + the
 * dashboard so the UI shows the true state of Shopify / Klaviyo / WebEngage.
 */
const klaviyo = require('./klaviyo-core.js');
const webengage = require('./webengage-core.js');
const market = require('./market-analytics.js');

async function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`timeout ${ms}ms`)), ms))]); }

// ── Klaviyo: a real read (metrics) confirms the key + live API. ──────────────
async function probeKlaviyo() {
  const base = { id: 'klaviyo', name: 'Klaviyo', kind: 'live-api' };
  if (!klaviyo.isConnected()) return { ...base, live: false, blocker: 'Set KLAVIYO_API_KEY in Vercel env.' };
  const t = Date.now();
  try {
    const r = await withTimeout(klaviyo.getMetrics(), 15000);
    const n = r && r.ok && r.data && Array.isArray(r.data.data) ? r.data.data.length : null;
    return { ...base, live: !!(r && r.ok), latency_ms: Date.now() - t, sample: r && r.ok ? `${n} metrics reachable` : null, error: r && r.ok ? null : JSON.stringify((r && r.error) || 'unknown').slice(0, 140) };
  } catch (e) { return { ...base, live: false, latency_ms: Date.now() - t, error: e.message }; }
}

// ── Shopify: live Admin API if a token is set; else honest export fallback. ──
async function probeShopify() {
  const base = { id: 'shopify', name: 'Shopify', kind: 'live-api' };
  const dom = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
  const tok = (process.env.SHOPIFY_ADMIN_TOKEN || '').trim();
  const exportsOk = (await market.performance('US')).ok; // the bundled export, and only for the workspace it belongs to
  if (!dom || !tok) {
    return { ...base, live: false, source: exportsOk ? 'public storefront + CSV market exports (real, not live)' : 'none', blocker: 'Set SHOPIFY_STORE_DOMAIN (e.g. knickgasm.myshopify.com) + a read-scoped SHOPIFY_ADMIN_TOKEN (read_orders, read_products, read_customers, read_inventory).' };
  }
  const t = Date.now();
  try {
    const ver = process.env.SHOPIFY_API_VERSION || '2026-04';
    const r = await withTimeout(fetch(`https://${dom}/admin/api/${ver}/shop.json`, { headers: { 'X-Shopify-Access-Token': tok, Accept: 'application/json' } }), 15000);
    let name = null; if (r.ok) { try { name = (await r.json()).shop?.name; } catch (_) {} }
    return { ...base, live: r.ok, latency_ms: Date.now() - t, sample: r.ok ? `shop: ${name}` : null, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) { return { ...base, live: false, latency_ms: Date.now() - t, error: e.message }; }
}

// ── WebEngage: table reachable + has rows (populated by the 12h sync). ───────
async function probeWebengage() {
  const base = { id: 'webengage', name: 'WebEngage', kind: 'stored-table' };
  const e = webengage.env();
  if (!e.url || !e.key) return { ...base, live: false, blocker: 'Set SUPABASE_SERVICE_ROLE_KEY (+ WEBENGAGE_EXPORT_URL/API_KEY or the webengage-dumps bucket).' };
  const t = Date.now();
  try {
    const r = await withTimeout(fetch(`${e.url}/rest/v1/webengage_events?select=id&limit=1`, { headers: { apikey: e.key, Authorization: `Bearer ${e.key}`, Prefer: 'count=exact' } }), 15000);
    const total = parseInt((r.headers.get('content-range') || '').split('/')[1], 10) || 0;
    return {
      ...base, live: r.ok && total > 0, latency_ms: Date.now() - t,
      sample: r.ok ? `${total} events stored` : null,
      blocker: r.ok && total === 0 ? 'Table reachable but empty — set WEBENGAGE_EXPORT_URL + WEBENGAGE_API_KEY (or the webengage-dumps bucket) and run the 12h sync (/api/cron/webengage).' : null,
      error: r.ok ? null : `HTTP ${r.status}`,
    };
  } catch (e2) { return { ...base, live: false, latency_ms: Date.now() - t, error: e2.message }; }
}

// ── Supabase (storage backbone) ──────────────────────────────────────────────
async function probeSupabase() {
  const base = { id: 'supabase', name: 'Supabase', kind: 'database' };
  const e = webengage.env();
  if (!e.url || !e.key) return { ...base, live: false, blocker: 'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.' };
  const t = Date.now();
  try {
    const r = await withTimeout(fetch(`${e.url}/rest/v1/?apikey=${encodeURIComponent(e.key)}`, { headers: { apikey: e.key, Authorization: `Bearer ${e.key}` } }), 12000);
    return { ...base, live: r.ok, latency_ms: Date.now() - t, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e2) { return { ...base, live: false, latency_ms: Date.now() - t, error: e2.message }; }
}

async function health() {
  const platforms = await Promise.all([probeKlaviyo(), probeShopify(), probeWebengage(), probeSupabase()]);
  const live = platforms.filter((p) => p.live).length;
  return {
    ok: true,
    checked_at: new Date().toISOString(),
    summary: { live, blocked: platforms.length - live, total: platforms.length },
    platforms,
  };
}

module.exports = { health, probeKlaviyo, probeShopify, probeWebengage, probeSupabase };
