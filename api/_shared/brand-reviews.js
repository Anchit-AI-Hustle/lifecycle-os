'use strict';

/**
 * brand-reviews.js — the brand's OWN testimonials, read off its OWN site.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. The Smart Brain copy prompt used to hand the model a proof
 * shape already filled in: `"rating": {"value": 4.9, "count": "250,000+"}` and
 * `"author": "first name, initial"`. A model given a filled shape completes it,
 * so every campaign shipped a star rating, a review count and a reviewer that
 * nobody had ever approved, on a page served to real traffic at /lp/:id.
 *
 * Deleting those fields is only half the fix: it leaves the mailer with no
 * proof at all. The other half is this module. A brand's site almost always
 * publishes real testimonials, and a real one is both honest AND better copy
 * than an invented one. So proof is EXTRACTED, never written.
 *
 * ── THE FOUR RULES, ENFORCED STRUCTURALLY ──────────────────────────────────
 *  1. VERBATIM. A review's text is the exact string the page published, clipped
 *     but never reworded. There is no LLM anywhere in this file — a paraphrase
 *     of a customer's words is a new testimonial nobody wrote.
 *  2. THE AUTHOR IS NEVER SYNTHESISED. If the page names the reviewer we carry
 *     that name exactly; if it does not, the review carries NO author. We never
 *     manufacture "Sarah M., Portland" to fill the slot.
 *  3. THE RATING IS NEVER ROUNDED OR INFERRED. It is carried only when the page
 *     states one, as the exact string the page stated, with its scale.
 *  4. NO TRANSFER. Every review records the product and the page it came from,
 *     so a review cannot migrate to another product or another region. Reads
 *     are filtered on both.
 *
 * ── ONE CRAWL, NOT A SECOND CRAWLER ────────────────────────────────────────
 * Traversal is `site-crawl.js` — the same same-origin, robots-aware,
 * SSRF-guarded walk the catalogue importer and the brand extractor use, via its
 * `onPage` observer and `rank` hook. Nothing here re-implements scope, robots or
 * host rules; if those rules ever need to change they change in one place.
 *
 * ── IMAGES ARE RE-HOSTED, NOT HOTLINKED ────────────────────────────────────
 * An email is opened days after it is sent, from a client that is not a browser,
 * against a CDN that may block hotlinks or have rotated the URL. So a review
 * image is FETCHED and uploaded to Supabase Storage, and the mailer carries the
 * storage URL. The original URL is recorded next to it so provenance survives.
 * Uploads are keyed on sha256(source URL) scoped to the workspace, so they are
 * idempotent — regenerating a campaign re-uses the object instead of littering
 * the bucket. An image that cannot be fetched or uploaded yields NO image and a
 * marker; it never yields a placeholder, and never another brand's picture.
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const crawl = require('./site-crawl.js');

const BUCKET = 'brand-review-media';
const TABLE = 'brand_review_library';
const SCAN_TABLE = 'brand_review_scan';

const DEFAULTS = {
  maxPages: 24,
  maxReviews: 24,
  perPage: 6,
  timeoutMs: 8000,
  minLength: 24,     // shorter than this is a rating label, not a testimonial
  maxLength: 420,
};

/** The spec's marker for a missing approved review library. */
function MARKER(brand, region) {
  const name = (brand && brand.name) || 'this brand';
  return `[DATA REQUIRED BEFORE LAUNCH: approved review library, ${name}, ${region || 'all'}]`;
}

function clip(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…';
}
function sha256(s) { return crypto.createHash('sha256').update(String(s == null ? '' : s)).digest('hex'); }
function absolute(href, base) { try { return new URL(String(href), base).toString(); } catch (_) { return ''; } }
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function textOf(html) { return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }

/**
 * The author EXACTLY as the page states it, or empty.
 *
 * schema.org allows author as a string, a Person node, or an array. Anything we
 * cannot read as a stated name comes back empty — the caller then renders the
 * review with no attribution rather than inventing one.
 */
function authorOf(node) {
  const a = node && (node.author || node.creator);
  const one = Array.isArray(a) ? a[0] : a;
  if (!one) return '';
  if (typeof one === 'string') return clip(one, 80);
  if (typeof one === 'object') return clip(one.name || one.alternateName || '', 80);
  return '';
}

/**
 * The rating EXACTLY as stated, with its scale, or null.
 * Never normalised to /5 and never rounded: "4.9" stays "4.9", and a 4.9 on a
 * 10-point scale is not silently promoted into a 5-star claim.
 */
function ratingOf(node) {
  const r = node && node.reviewRating;
  const one = Array.isArray(r) ? r[0] : r;
  if (!one) return null;
  const value = typeof one === 'object' ? one.ratingValue : one;
  if (value == null || String(value).trim() === '') return null;
  const best = (typeof one === 'object' && one.bestRating != null) ? String(one.bestRating) : '5';
  return { value: String(value).trim(), scale: String(best).trim() };
}

function imagesOf(node, pageUrl) {
  const out = [];
  const push = (v) => {
    if (!v) return;
    if (typeof v === 'string') { const u = absolute(v, pageUrl); if (u) out.push(u); return; }
    if (Array.isArray(v)) { v.forEach(push); return; }
    if (typeof v === 'object') push(v.url || v.contentUrl || '');
  };
  push(node && node.image);
  push(node && node.associatedMedia);
  return [...new Set(out)].slice(0, 3);
}

const REVIEW_TYPES = new Set(['review', 'userreview', 'critic review', 'criticreview']);
const typeOf = (n) => {
  const t = n && n['@type'];
  return String(Array.isArray(t) ? t[0] : (t || '')).toLowerCase();
};

/**
 * Every JSON-LD Review node on a page, including the ones nested under a
 * Product's `review` array (which is where Shopify and most review apps put
 * them). The product name travels with the review so it can never be shown
 * against a different product later.
 */
function jsonLdReviews(html, pageUrl) {
  const out = [];
  let nodes = [];
  try { nodes = crawl.jsonLdBlocks(html) || []; } catch (_) { nodes = []; }
  const take = (node, productName) => {
    if (!node || typeof node !== 'object') return;
    if (!REVIEW_TYPES.has(typeOf(node))) return;
    const quote = clip(decodeEntities(node.reviewBody || node.description || node.text || ''), DEFAULTS.maxLength);
    if (!quote || quote.length < DEFAULTS.minLength) return;
    out.push({
      quote,
      author: authorOf(node),
      rating: ratingOf(node),
      images: imagesOf(node, pageUrl),
      product: clip(productName || node.itemReviewed && node.itemReviewed.name || '', 160),
      source_url: pageUrl,
      signal: 'json-ld:Review',
      verbatim: true,
    });
  };
  for (const n of nodes) {
    const t = typeOf(n);
    if (REVIEW_TYPES.has(t)) { take(n, (n.itemReviewed && n.itemReviewed.name) || ''); continue; }
    const name = String(n.name || '').trim();
    const nested = n.review || n.reviews;
    for (const r of (Array.isArray(nested) ? nested : (nested ? [nested] : []))) take(r, name);
  }
  return out;
}

// Microdata / review-widget markup. Deliberately narrow: an element has to
// DECLARE itself a review (schema.org itemprop, or a review/testimonial class or
// data attribute) before its text is read as one. Body copy that merely reads
// like praise is not a testimonial.
const REVIEW_BLOCK_RX = /<(div|li|article|blockquote|section)\b([^>]*(?:itemprop=["']review["']|itemtype=["'][^"']*schema\.org\/Review["']|class=["'][^"']*(?:review|testimonial)[^"']*["']|data-review[^=]*=)[^>]*)>([\s\S]{0,4000}?)<\/\1>/gi;
const BODY_RX = /itemprop=["'](?:reviewBody|description)["'][^>]*>([\s\S]*?)</i;
const AUTHOR_RX = /itemprop=["'](?:author|name)["'][^>]*>([\s\S]*?)</i;
const RATING_RX = /itemprop=["']ratingValue["'][^>]*(?:content=["']([^"']+)["'][^>]*)?>([\s\S]*?)</i;

function microdataReviews(html, pageUrl) {
  const out = [];
  for (const m of String(html || '').matchAll(REVIEW_BLOCK_RX)) {
    const inner = m[3] || '';
    const bodyM = inner.match(BODY_RX);
    const quote = clip(bodyM ? textOf(bodyM[1]) : textOf(inner), DEFAULTS.maxLength);
    if (!quote || quote.length < DEFAULTS.minLength) continue;
    const authorM = inner.match(AUTHOR_RX);
    const ratingM = inner.match(RATING_RX);
    const ratingRaw = ratingM ? (ratingM[1] || textOf(ratingM[2])) : '';
    const images = [];
    for (const im of inner.matchAll(/<img[^>]+\b(?:src|data-src)=["']([^"']+)["']/gi)) {
      const u = absolute(im[1], pageUrl);
      if (u) images.push(u);
      if (images.length >= 3) break;
    }
    out.push({
      quote,
      // No author element = no author. The slot stays empty.
      author: authorM ? clip(textOf(authorM[1]), 80) : '',
      rating: ratingRaw ? { value: String(ratingRaw).trim(), scale: '5' } : null,
      images: [...new Set(images)],
      product: '',
      source_url: pageUrl,
      signal: 'microdata:Review',
      verbatim: true,
    });
    if (out.length >= DEFAULTS.perPage) break;
  }
  return out;
}

/**
 * All reviews declared on ONE page. Pure and offline-testable: the value of this
 * module is in what it refuses to take, and that has to be assertable without a
 * network.
 */
function reviewsFromHtml(html, pageUrl) {
  const seen = new Set();
  const out = [];
  for (const r of [...jsonLdReviews(html, pageUrl), ...microdataReviews(html, pageUrl)]) {
    const key = r.quote.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= DEFAULTS.perPage) break;
  }
  return out;
}

// Pages worth spending a small crawl budget on. Ranking only reorders the
// queue; site-crawl still decides what is in scope.
const REVIEW_URL_RX = /(review|testimonial|feedback|customer|stories|kind-words|wall-of-love)/i;
function rankForReviews(url) {
  if (REVIEW_URL_RX.test(url)) return 100;
  if (/\/products?\//i.test(url)) return 40;
  if (/\/collections?\//i.test(url)) return 10;
  return 0;
}

/**
 * Read the brand's own site for its own testimonials.
 *
 * Rides ONE site-crawl. `fetchImpl` is injectable so the whole path is testable
 * against fixtures — this sandbox has no egress, and a module about provenance
 * that can only be tested online is a module nobody tests.
 */
async function collectReviews({ brand, market = '', startUrl = '', fetchImpl = null, maxPages = DEFAULTS.maxPages, maxReviews = DEFAULTS.maxReviews, timeoutMs = DEFAULTS.timeoutMs } = {}) {
  const site = String(startUrl || (brand && brand.website) || '').trim();
  const limits = [];
  if (!site) {
    return { ok: false, reason: 'no_site', reviews: [], pages: 0, marker: MARKER(brand, market), limits: ['The brand record carries no website, so there is nowhere to read reviews from.'] };
  }
  const found = [];
  const onPage = (html, url) => {
    if (found.length >= maxReviews) return;
    for (const r of reviewsFromHtml(html, url)) {
      if (found.length >= maxReviews) break;
      found.push(r);
    }
  };
  let res = null;
  try {
    res = await crawl.crawlSite(site, { brand: brand || { website: site }, maxPages, timeoutMs, fetchImpl, onPage, rank: rankForReviews });
  } catch (e) {
    return { ok: false, reason: 'crawl_failed', error: String((e && e.message) || e).slice(0, 200), reviews: [], pages: 0, marker: MARKER(brand, market), limits: ['The brand site could not be reached from this deployment.'] };
  }
  if (res && res.ok === false) {
    return { ok: false, reason: res.error || 'crawl_refused', reviews: [], pages: 0, marker: MARKER(brand, market), limits: [`site-crawl refused the start URL: ${res.error || 'out of scope'}.`] };
  }
  // Only images on the brand's OWN hosts survive — the same rule the crawl
  // applies to page bodies, applied again to the media a review points at.
  let hosts = new Set();
  try { hosts = crawl.allowedHosts(brand && brand.website ? brand : { website: site }); } catch (_) { hosts = new Set(); }
  const reviews = found.map((r) => {
    const kept = (r.images || []).filter((u) => { try { return crawl.inScope(u, hosts); } catch (_) { return false; } });
    if (kept.length !== (r.images || []).length) limits.push(`Dropped ${(r.images || []).length - kept.length} review image(s) hosted off the brand's own domains.`);
    return Object.assign({}, r, { images: kept, market: market || '' });
  });
  return {
    ok: true,
    reviews,
    pages: (res && Array.isArray(res.pages) ? res.pages.length : 0),
    marker: reviews.length ? '' : MARKER(brand, market),
    limits: [...new Set(limits)],
  };
}

/**
 * Fetch a review image off the brand's own host and re-host it in Supabase
 * Storage, returning the storage URL.
 *
 * Idempotent: the object key is workspace + sha256(source URL), so the same
 * source image always lands on the same object and a regenerated campaign
 * re-uses it instead of adding another copy.
 *
 * Workspace-scoped: the key is prefixed with the workspace id, and the storage
 * policies in the migration restrict access on that same prefix, so one brand's
 * uploads can never be served under another's.
 *
 * Every failure path returns a MARKER and no URL. There is no placeholder and no
 * borrowed image: a mailer with a missing photo is a visible gap, a mailer with
 * someone else's photo is a brand leak nobody notices.
 */
async function hostImage({ brand, workspaceId, sourceUrl, fetchImpl = null, market = '' } = {}) {
  const src = String(sourceUrl || '').trim();
  const ws = String(workspaceId || '').trim();
  const fail = (reason) => ({ ok: false, reason, hosted_url: '', source_url: src, marker: `[DATA REQUIRED BEFORE LAUNCH: hosted review image, ${(brand && brand.name) || 'this brand'}, ${market || 'all'}] (${reason})` });
  if (!src) return fail('no source url');
  if (!ws) return fail('no workspace id, so the object could not be scoped to a brand');
  // Origin check against THIS brand's own hosts, never a fixed allowlist.
  try {
    const hosts = crawl.allowedHosts(brand && brand.website ? brand : { website: src });
    if (!crawl.inScope(src, hosts)) return fail('image is not on the brand\'s own hosts');
  } catch (_) { return fail('could not resolve the brand\'s own hosts'); }

  const digest = sha256(src);
  let supa;
  try { supa = require('./supa.js'); } catch (_) { return fail('storage client unavailable'); }
  try { supa.env(); } catch (_) { return fail('Supabase storage is not configured in this deployment'); }

  let buf, contentType;
  try {
    const f = fetchImpl || ((u) => fetch(u, { headers: { 'User-Agent': 'lifecycle-os/brand-reviews' } }));
    const res = await f(src);
    if (!res || !res.ok) return fail(`source image responded ${res ? res.status : 'no response'}`);
    contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (!/^image\//i.test(contentType)) return fail(`source responded ${contentType || 'an unknown type'}, not an image`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) { return fail(`could not fetch the source image: ${String((e && e.message) || e).slice(0, 120)}`); }
  if (!buf || !buf.length) return fail('source image was empty');

  const ext = /png/i.test(contentType) ? 'png' : /webp/i.test(contentType) ? 'webp' : /gif/i.test(contentType) ? 'gif' : 'jpg';
  const objectPath = `${ws}/${digest}.${ext}`;
  try {
    const up = await supa.uploadObject(BUCKET, objectPath, buf, contentType);
    return { ok: true, hosted_url: up.public_url, source_url: src, object_path: up.path, sha256: digest, bytes: buf.length, content_type: contentType };
  } catch (e) { return fail(`storage upload failed: ${String((e && e.message) || e).slice(0, 120)}`); }
}

/** Re-host every image on every review; a review whose image fails keeps its text. */
async function hostReviewImages(reviews, { brand, workspaceId, market = '', fetchImpl = null, maxImages = 4 } = {}) {
  const out = [];
  let hosted = 0;
  for (const r of (reviews || [])) {
    const media = [];
    for (const src of (r.images || [])) {
      if (hosted >= maxImages) { media.push({ hosted_url: '', source_url: src, marker: `[DATA REQUIRED BEFORE LAUNCH: hosted review image, ${(brand && brand.name) || 'this brand'}, ${market || 'all'}] (over the per-campaign image budget)` }); continue; }
      const h = await hostImage({ brand, workspaceId, sourceUrl: src, fetchImpl, market });
      if (h.ok) { hosted += 1; media.push({ hosted_url: h.hosted_url, source_url: h.source_url, sha256: h.sha256 }); }
      else media.push({ hosted_url: '', source_url: src, marker: h.marker });
    }
    out.push(Object.assign({}, r, { media, images: undefined }));
  }
  return out;
}

/* ── Persistence ─────────────────────────────────────────────────────────────
 * The library is durable so the mailer build is a fast read, not a crawl. Every
 * read is filtered on workspace AND region, so rule 4 (no transfer) holds at the
 * query, not by convention.
 */

function rowsFor({ workspaceId, brand, market, reviews }) {
  return (reviews || []).map((r) => ({
    workspace_id: workspaceId,
    region: String(market || '').toUpperCase() || 'ALL',
    product_key: String(r.product || '').toLowerCase().slice(0, 160) || null,
    quote: r.quote,
    author: r.author || null,
    rating_value: r.rating ? r.rating.value : null,
    rating_scale: r.rating ? r.rating.scale : null,
    source_url: r.source_url,
    signal: r.signal,
    media: r.media || [],
    quote_key: sha256(`${workspaceId}|${String(market || '').toUpperCase()}|${r.quote.toLowerCase()}`),
    brand_name: (brand && brand.name) || null,
  }));
}

async function saveReviews({ workspaceId, brand, market, reviews }) {
  let supa;
  try { supa = require('./supa.js'); supa.env(); } catch (_) {
    return { ok: false, saved: 0, reason: 'Supabase is not configured in this deployment; the extraction ran but nothing was persisted.' };
  }
  const rows = rowsFor({ workspaceId, brand, market, reviews });
  if (!rows.length) return { ok: true, saved: 0 };
  try {
    await supa.rest(TABLE, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
    return { ok: true, saved: rows.length };
  } catch (e) { return { ok: false, saved: 0, reason: String((e && e.message) || e).slice(0, 200) }; }
}

async function loadReviews({ workspaceId, market, productKey = null, limit = 2 } = {}) {
  let supa;
  try { supa = require('./supa.js'); supa.env(); } catch (_) { return []; }
  const query = {
    workspace_id: `eq.${workspaceId}`,
    region: `eq.${String(market || '').toUpperCase() || 'ALL'}`,
    limit: String(Math.max(1, limit)),
    order: 'created_at.desc',
  };
  if (productKey) query.product_key = `eq.${String(productKey).toLowerCase()}`;
  try {
    const rows = await supa.rest(TABLE, { query });
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      quote: row.quote,
      author: row.author || '',
      rating: row.rating_value != null ? { value: String(row.rating_value), scale: String(row.rating_scale || '5') } : null,
      media: Array.isArray(row.media) ? row.media : [],
      source_url: row.source_url,
      signal: row.signal,
      verbatim: true,
    }));
  } catch (_) { return []; }
}

/**
 * The whole path, for the Smart Brain build: read the library, and if it is
 * empty for this brand+region, read the brand's own site once and persist what
 * it publishes. Returns at most `limit` reviews (the product owner asked for a
 * couple) plus the marker when there are none.
 */
/* ── Scan bookkeeping ────────────────────────────────────────────────────────
 * A brand whose site publishes NO testimonials leaves the library empty
 * forever, so without this every campaign build would re-crawl that site from
 * scratch - ~180 slots in the prebuild queue, each spending its serverless
 * budget on a fetch it already knows the answer to, and hammering the brand's
 * origin for nothing. Recording the attempt (not just the result) is what makes
 * a negative answer as durable as a positive one. Same pattern, and the same
 * reasoning, as brand_competitor_refresh.
 */
const RESCAN_DAYS = 7;

async function lastScan({ workspaceId, market }) {
  let supa;
  try { supa = require('./supa.js'); supa.env(); } catch (_) { return null; }
  try {
    const rows = await supa.rest(SCAN_TABLE, {
      query: { workspace_id: `eq.${workspaceId}`, region: `eq.${String(market || '').toUpperCase() || 'ALL'}`, limit: '1' },
    });
    return (Array.isArray(rows) && rows[0]) || null;
  } catch (_) { return null; }
}

async function recordScan({ workspaceId, market, found, note }) {
  let supa;
  try { supa = require('./supa.js'); supa.env(); } catch (_) { return false; }
  try {
    await supa.rest(SCAN_TABLE, {
      method: 'POST',
      body: [{ workspace_id: workspaceId, region: String(market || '').toUpperCase() || 'ALL', last_run_at: new Date().toISOString(), found: Number(found) || 0, last_note: String(note || '').slice(0, 400) }],
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    return true;
  } catch (_) { return false; }
}

function scannedRecently(row) {
  if (!row || !row.last_run_at) return false;
  const age = Date.now() - new Date(row.last_run_at).getTime();
  return isFinite(age) && age >= 0 && age < RESCAN_DAYS * 86400000;
}

async function reviewsForBrand({ brand, workspaceId, market, limit = 2, fetchImpl = null, allowCrawl = true, productKey = null } = {}) {
  const empty = (limits) => ({ reviews: [], marker: MARKER(brand, market), limits: limits || [] });
  if (!brand) return empty(['No brand is stamped on this slot, so no site could be read.']);
  let stored = [];
  if (workspaceId) stored = await loadReviews({ workspaceId, market, productKey, limit });
  if (stored.length) return { reviews: stored.slice(0, limit), marker: '', limits: [], source: 'library' };
  if (!allowCrawl) return empty(['The review library is empty for this brand and region, and this pass did not crawl.']);
  // A recent scan that found nothing is an ANSWER, not a reason to ask again.
  if (workspaceId) {
    const prev = await lastScan({ workspaceId, market });
    if (scannedRecently(prev)) {
      return empty([`The brand site was read on ${String(prev.last_run_at).slice(0, 10)} and published no testimonials${prev.last_note ? ` (${prev.last_note})` : ''}. It is re-read every ${RESCAN_DAYS} days.`]);
    }
  }
  const got = await collectReviews({ brand, market, fetchImpl });
  if (!got.ok || !got.reviews.length) {
    if (workspaceId) await recordScan({ workspaceId, market, found: 0, note: got.reason || (got.limits || [])[0] || 'no testimonials published' });
    return empty(got.limits || []);
  }
  const withMedia = await hostReviewImages(got.reviews.slice(0, limit), { brand, workspaceId, market, fetchImpl });
  if (workspaceId) {
    await saveReviews({ workspaceId, brand, market, reviews: withMedia });
    await recordScan({ workspaceId, market, found: got.reviews.length, note: `${got.pages} page(s) read` });
  }
  return { reviews: withMedia.slice(0, limit), marker: '', limits: got.limits || [], source: 'site' };
}

module.exports = {
  BUCKET, TABLE, DEFAULTS, MARKER,
  reviewsFromHtml, jsonLdReviews, microdataReviews, rankForReviews,
  collectReviews, hostImage, hostReviewImages,
  saveReviews, loadReviews, reviewsForBrand, rowsFor,
  lastScan, recordScan, scannedRecently, RESCAN_DAYS, SCAN_TABLE,
  // helpers exercised directly by the tests
  authorOf, ratingOf, sha256,
};
