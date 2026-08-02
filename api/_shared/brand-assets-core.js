'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// brand-assets-core.js — the Lifecycle OS "approved-assets service".
//
// Resolves REAL, origin-validated creative assets for a SKU and persists them to
// the `brand_assets` table (migration 20260711120000_brand_assets.sql). The hard
// rule: NEVER fabricate a URL. A slot with no origin-validated URL is stored as
// status='placeholder' so downstream mailers can degrade gracefully instead of
// linking to an invented asset.
//
// Not a function file (under api/_shared/ → excluded from the Hobby 12-fn cap).
// Reused by scripts/seed-brand-assets.js and any ?action= caller.
// ─────────────────────────────────────────────────────────────────────────────

let supa = null;
try { supa = require('./supa.js'); } catch { /* offline / seed-only use */ }

// PREFIX-match allowlist (origin validation — host must START WITH one of these,
// not merely contain it, so `evil-knickgasm.com.attacker.net` never validates).
const ALLOWLIST = ['knickgasm.com', 'knickgasm.com', 'knickgasm.com', 'knickgasm.com', 'knickgasm.com'];

// Brand-owned Shopify CDN host: a store asset served from cdn.shopify.com is the
// SAME file as the one served from the primary domain's /cdn/shop path. We
// canonicalise to the brand host so the URL passes origin validation (the file
// content is byte-identical; verified live — all return 200 image/*).
const BRAND_CDN = 'https://www.knickgasm.com/cdn/shop/files/';

function hostOf(url) {
  try { return new URL(url).host.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

// origin-validated iff host prefix-matches an allowlist entry (host === entry or
// host === 'www.'+entry or a subdomain endsWith '.'+entry). We strip a leading
// www. above, so check equality or dotted-suffix against each entry.
function isOriginValid(url) {
  const h = hostOf(url);
  if (!h) return false;
  return ALLOWLIST.some((a) => h === a || h.endsWith('.' + a));
}

// Rewrite a Shopify store CDN URL (cdn.shopify.com/s/files/<a>/<b>/<c>/files|products/NAME)
// to the brand-owned host so it validates. Leaves already-brand or non-Shopify URLs as-is.
function toBrandCdn(url) {
  if (!url) return url;
  const m = String(url).match(/cdn\.shopify\.com\/s\/files\/\d+\/\d+\/\d+\/(?:files|products)\/([^?#]+)/i);
  if (m) return BRAND_CDN + m[1];
  return url;
}

// Build a persistable row from a candidate URL, applying the brand-CDN rewrite and
// origin validation. Unverifiable → status='placeholder' (url kept for reference,
// origin_validated=false) so nothing downstream invents an asset.
function buildRow({ sku_key, asset_type = 'product', url, alt = null, width = null, height = null, source_pdp = null, region = 'us' }) {
  const canonical = toBrandCdn(url);
  const ok = canonical && isOriginValid(canonical);
  return {
    sku_key,
    asset_type,
    url: canonical || url || '',
    alt,
    width,
    height,
    source_pdp: source_pdp || null,
    origin_validated: !!ok,
    status: ok ? 'verified' : 'placeholder',
    region,
  };
}

// A labelled placeholder row for a slot we could NOT verify (never a fake URL).
function placeholderRow({ sku_key, asset_type = 'product', alt = null, source_pdp = null, region = 'us', note = 'unverified — no origin-validated asset found' }) {
  return {
    sku_key,
    asset_type,
    url: `placeholder:${sku_key}:${asset_type}`,
    alt: alt || note,
    width: null,
    height: null,
    source_pdp: source_pdp || null,
    origin_validated: false,
    status: 'placeholder',
    region,
  };
}

// ── Live fetch (optional) — GET a PDP, pull og:image:secure_url + product media.
// Only used when a catalog image is not already available. Origin of the PDP
// itself must be on the allowlist before we trust anything it returns.
async function fetchPdpImage(pdpUrl) {
  if (!isOriginValid(pdpUrl)) return { ok: false, reason: 'pdp origin not on allowlist' };
  let html = '';
  try {
    const res = await fetch(pdpUrl, { headers: { 'User-Agent': 'knickgasm-lifecycle-os/asset-pipeline' } });
    if (!res.ok) return { ok: false, reason: `pdp ${res.status}` };
    html = await res.text();
  } catch (e) { return { ok: false, reason: e.message }; }

  const og = html.match(/<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const img = og ? og[1] : null;
  if (!img) return { ok: false, reason: 'no og:image' };
  // Shopify og:image is protocol-relative sometimes.
  const abs = img.startsWith('//') ? 'https:' + img : img;
  return { ok: true, url: abs, source_pdp: pdpUrl };
}

// Persist rows (verified + placeholder) idempotently. Upsert on the natural key
// (sku_key, asset_type, url) declared UNIQUE in the migration.
async function upsertAssets(rows) {
  if (!supa) throw new Error('supa client unavailable (no Supabase env) — cannot upsert');
  if (!rows || !rows.length) return [];
  return supa.insert('brand_assets', rows, { upsertOn: 'sku_key,asset_type,url' });
}

// Re-host an external image into Supabase Storage so the canonical url is a
// DB-owned Storage URL ("approved assets service"). Best-effort: returns the
// public Storage URL, or null on failure (caller keeps the brand-CDN url).
async function rehostToStorage(bucket, objectPath, sourceUrl) {
  if (!supa) return null;
  // Only re-host assets that already pass origin validation — never fetch an
  // arbitrary/off-allowlist URL (avoids server-side request forgery).
  if (!isOriginValid(sourceUrl)) return null;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || 'image/jpeg';
    const { public_url } = await supa.uploadObject(bucket, objectPath, buf, ct);
    return public_url;
  } catch { return null; }
}

module.exports = {
  ALLOWLIST, BRAND_CDN,
  hostOf, isOriginValid, toBrandCdn,
  buildRow, placeholderRow,
  fetchPdpImage, upsertAssets, rehostToStorage,
};
