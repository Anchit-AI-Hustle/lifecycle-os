'use strict';

/**
 * Resolve a REAL, already-hosted product image URL from THE CALLING BRAND'S OWN
 * catalogue, by handle or title, per market. Used as the guaranteed online
 * fallback for generated creatives so an asset never has to ship an
 * unrenderable `data:` URI (email clients strip those) — if generation/upload
 * fails, we use the product's own catalogue photo, which is always online.
 *
 * ── WHOSE CATALOGUE ────────────────────────────────────────────────────────
 * This module used to read `data/catalog/products_{us,uk,global}.json` straight
 * off disk into a module-level `CACHE[region]`, with no idea which workspace it
 * was answering for. Those files are TENANT ZERO'S 436 hand-painted sneakers,
 * so every brand on the platform resolved its hero imagery from them: a news
 * publisher's correctly-written city-desk mailer shipped with a custom Nike Air
 * Force 1 in the hero slot, because "Times of India City" keyword-matched
 * "Indian Cricket Custom x Adidas Sambas".
 *
 * Every lookup now goes through `brand-catalog-server.js`, which returns the
 * WORKSPACE'S OWN rows, or the shipped files when (and only when) the caller is
 * tenant zero, or nothing at all. Nothing is fabricated and nothing is
 * borrowed: a brand with no catalogue gets `null` from every resolver here plus
 * a `[DATA REQUIRED BEFORE LAUNCH: product image, …]` marker from `marker()`,
 * and the renderers go image-free — the same thing
 * scripts/build-july-mailers.js already does rather than invent a URL.
 *
 * ── HOW A RENDERER SAYS WHO IT IS ──────────────────────────────────────────
 * These functions are called from ~21 SYNCHRONOUS render sites, so they cannot
 * await a per-workspace read. The brand is taken from, in order:
 *   1. `opts.brand` / `opts.workspaceId` — an explicit statement by the caller;
 *   2. `entryOrHandle.brand` — most sites already pass the calendar ENTRY, and
 *      buildCampaign stamps the resolved brand onto it, so those sites needed no
 *      change at all;
 *   3. the catalogue pinned by `brandCatalogServer.withCatalog()` around the
 *      generation (AsyncLocalStorage, so concurrent brands cannot mix);
 *   4. failing all of that, the documented fallback in productsFor() — the
 *      shipped files only where there is no multi-tenant deployment at all.
 */
const catalogServer = require('./brand-catalog-server.js');

/**
 * The brand this lookup is for. `entryOrHandle` is a handle string at some call
 * sites and a calendar entry at others; an entry carries `.brand`, and
 * `.heroProduct` never does, so only the entry shape is consulted.
 */
function brandCtx(entryOrHandle, opts) {
  const o = opts || {};
  const fromEntry = (entryOrHandle && typeof entryOrHandle === 'object' && entryOrHandle.brand) || null;
  return {
    brand: o.brand || fromEntry || null,
    workspaceId: o.workspaceId || o.workspace_id
      || (entryOrHandle && typeof entryOrHandle === 'object' ? entryOrHandle.workspace_id : null)
      || null,
  };
}

function load(market, entryOrHandle, opts) {
  return catalogServer.productsFor(market, brandCtx(entryOrHandle, opts));
}

// Find the REAL catalog row for a handle string or entry/heroProduct-ish object.
// Never fabricates — returns a catalog row or null.
function match(entryOrHandle, market, opts) {
  const arr = load(market, entryOrHandle, opts).products;
  if (!arr.length) return null;
  let handle = null, title = null;
  if (typeof entryOrHandle === 'string') { handle = entryOrHandle; title = entryOrHandle.replace(/[-_]+/g, ' '); }
  else if (entryOrHandle && typeof entryOrHandle === 'object') {
    const hp = entryOrHandle.heroProduct || entryOrHandle;
    handle = hp.handle || hp.h || entryOrHandle.hero_handle || null;
    title = hp.title || hp.n || entryOrHandle.hero_product || null;
  }
  let p = handle && arr.find((x) => x.h === handle);
  if (!p && title) {
    const t = String(title).toLowerCase();
    p = arr.find((x) => (x.n || '').toLowerCase() === t)
      || arr.find((x) => (x.n || '').toLowerCase().includes(t.slice(0, 18)));
    // Keyword fallback: a requested name may not exist verbatim in the catalogue
    // ("cherry-blossom-af1" against a row titled "Cherry Blossom x Nike Air Force
    // 1"), but a distinctive token in it does. Try the longest tokens first so the
    // rare, specific word wins over a common one ("blossom" before "force"),
    // keeping a real match instead of a miss.
    //
    // This is a LOOSE match by design, which is exactly why the catalogue it
    // searches has to be the right brand's: run against tenant zero's rows it
    // will happily return a sneaker for the word "City".
    if (!p) {
      const toks = t.split(/\s+/).filter((w) => w.length >= 5).sort((a, b) => b.length - a.length);
      for (const w of toks) { p = arr.find((x) => (x.n || '').toLowerCase().includes(w)); if (p) break; }
    }
  }
  return p || null;
}

// Return an HD variant of a Shopify CDN image by requesting a specific rendered
// width — Shopify serves a right-sized asset, so the photo stays crisp and never
// pixelates (upscaling artifacts avoided). Non-Shopify or empty URLs pass through
// unchanged; a width is only added when one is not already present.
function hd(url, width = 1200) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
  if (!/cdn\.shopify\.com|\/cdn\/shop\//.test(url)) return url;
  if (/[?&]width=/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'width=' + width;
}

// Accepts a handle string, or an entry/heroProduct-ish object. Returns an https
// image URL or null (never a data: URI). Pass a width to get an HD-boosted URL.
function imageFor(entryOrHandle, market, opts = {}) {
  const p = match(entryOrHandle, market, opts);
  const url = p && p.i;
  if (!(typeof url === 'string' && /^https?:\/\//.test(url))) return null;
  const width = opts.width || 0;
  return width ? hd(url, width) : url;
}

// All REAL catalog image URLs for the matched product, primary first, in catalog
// (PDP gallery) order, de-duplicated and HD-boosted. Lets a caller pull DISTINCT
// real photos of the same product across mailer / ad / landing sections instead
// of repeating one shot. Never fabricates — returns [] when nothing matches.
function imagesFor(entryOrHandle, market, opts = {}) {
  const p = match(entryOrHandle, market, opts);
  if (!p) return [];
  const width = opts.width === undefined ? 1200 : opts.width;
  const list = Array.isArray(p.imgs) && p.imgs.length ? p.imgs : (p.i ? [p.i] : []);
  const seen = new Set();
  const out = [];
  for (const u of list) {
    if (typeof u === 'string' && /^https?:\/\//.test(u) && !seen.has(u)) {
      seen.add(u);
      out.push(hd(u, width));
    }
  }
  return out;
}

// Resolve a REAL product handle from the catalog (for building a PDP URL).
// Returns the catalog handle string or null — NEVER a fabricated handle.
function handleFor(entryOrHandle, market, opts) {
  const p = match(entryOrHandle, market, opts);
  return (p && (p.h || p.handle)) || null;
}

/**
 * The full answer, for callers that must record WHY there is no image.
 *
 * Returns `{ url, source, reason, marker }`. `marker` is non-empty exactly when
 * no approved image could be resolved, and carries the spec's
 * `[DATA REQUIRED BEFORE LAUNCH: product image, <product>, <region>]` form so a
 * reviewer sees the gap instead of a silently image-free asset.
 */
function resolveImage(entryOrHandle, market, opts = {}) {
  const cat = load(market, entryOrHandle, opts);
  const url = cat.products.length ? imageFor(entryOrHandle, market, opts) : null;
  if (url) return { url, source: cat.source, reason: '', marker: '' };
  const hp = (entryOrHandle && typeof entryOrHandle === 'object')
    ? (entryOrHandle.heroProduct || entryOrHandle) : { title: entryOrHandle };
  return {
    url: null,
    source: cat.source,
    reason: cat.reason || 'no catalogue row matched this product',
    marker: catalogServer.imageMarker(hp, market),
  };
}

/** The DATA REQUIRED marker for a product slot, with no lookup. */
function marker(product, market) { return catalogServer.imageMarker(product, market); }

/** The catalogue source backing this call: 'brand' | 'shipped' | 'none'. */
function sourceFor(market, opts = {}) { return load(market, null, opts).source; }

module.exports = {
  imageFor, imagesFor, handleFor, match, hd,
  resolveImage, marker, sourceFor,
  // Re-exported so a caller already holding catalog-image does not need a second
  // require to pin a generation's catalogue.
  withCatalog: catalogServer.withCatalog,
};
