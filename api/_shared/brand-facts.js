'use strict';
/**
 * brand-facts.js — the approved-facts library + master real-only gate (B1).
 * ---------------------------------------------------------------------------
 * The zero-fabrication contract: reviews, ratings, reviewer names, testimonials,
 * comparative/quant claims and prices must come ONLY from an approved source,
 * never invented. This module is the single gate every renderer routes those
 * values through.
 *
 * SHIPS DARK BY DEFAULT. The behavior is controlled by one env flag:
 *   REAL_FACTS_ONLY = '1'   → real-only mode: renderers show ONLY approved facts
 *                             (from data/brand-facts/<region>.json) and OMIT
 *                             anything unverified.
 *   (unset / anything else) → OFF: gate() returns the caller's current value
 *                             unchanged, so there is NO visible change until the
 *                             flag is flipped in Vercel env once the approved
 *                             library is populated.
 *
 * Approved data file shape (data/brand-facts/<region>.json), all keyed by a
 * lower-cased SKU or product handle:
 *   { "reviews": { "<sku>": [ { "quote": "", "author": "", "stars": 5 } ] },
 *     "ratings": { "<sku>": 4.7 },
 *     "claims":  { "<sku>": [ "approved claim string" ] },
 *     "prices":  { "<sku>": "29.99" } }
 * A missing key = no approved data for that product (renderers omit the block).
 * The 4.9 / 250,000+ / Rohit Sharma brand proof bar is an APPROVED brand constant and
 * is NOT gated here — it lives in the renderers as a verified constant.
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

function enabled() { return String(process.env.REAL_FACTS_ONLY || '') === '1'; }

const CACHE = {};
function regionKey(m) { m = String(m || 'US').toLowerCase(); if (m.startsWith('uk')) return 'uk'; if (/global|eu|au|me|row|rest/.test(m)) return 'global'; return 'us'; }
function load(region) {
  const r = regionKey(region);
  if (CACHE[r]) return CACHE[r];
  let d = { reviews: {}, ratings: {}, claims: {}, prices: {} };
  try { const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'brand-facts', `${r}.json`), 'utf8')); if (raw && typeof raw === 'object') d = Object.assign(d, raw); } catch (_) { /* no approved file yet */ }
  CACHE[r] = d;
  return d;
}
function keyFor(sku) { return String(sku == null ? '' : sku).trim().toLowerCase(); }

function approvedReviews(sku, region) { const a = load(region).reviews[keyFor(sku)]; return Array.isArray(a) ? a : []; }
function approvedRating(sku, region) { const v = load(region).ratings[keyFor(sku)]; const n = typeof v === 'string' ? parseFloat(v) : v; return (typeof n === 'number' && isFinite(n) && n > 0) ? n : null; }
function approvedClaims(sku, region) { const a = load(region).claims[keyFor(sku)]; return Array.isArray(a) ? a : []; }
function approvedPrice(sku, region) { const v = load(region).prices[keyFor(sku)]; return (v != null && v !== '') ? v : null; }

// The single gate. OFF → return the caller's current fallback (no change). ON →
// return ONLY approved data (else null/[]), so the caller omits the block.
// `fallback` is what renders today; keep passing it so OFF is a perfect no-op.
function gate(kind, sku, region, fallback) {
  if (!enabled()) return fallback;
  switch (kind) {
    case 'reviews': return approvedReviews(sku, region);
    case 'rating': return approvedRating(sku, region);
    case 'claims': return approvedClaims(sku, region);
    case 'price': return approvedPrice(sku, region);
    default: return null;
  }
}

module.exports = { enabled, approvedReviews, approvedRating, approvedClaims, approvedPrice, gate };
