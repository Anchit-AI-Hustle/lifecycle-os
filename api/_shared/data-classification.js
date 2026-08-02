'use strict';

/**
 * Data-classification layer — the single gate between Knickgasm's two agents.
 *
 *   • Internal Employee Agent (scope 'internal') → full data + catalog + ops.
 *   • User Persona Agents      (scope 'buyer')    → buyer-safe projection ONLY.
 *
 * Default-deny: anything not explicitly marked buyer-safe is internal-only.
 * Every data fetch that can reach a buyer-facing surface MUST pass through
 * scopeData()/buyerSafe() so revenue, PII, performance, and internal strategy
 * never leak to a buyer persona. See docs/UNIFIED-ARCHITECTURE.md §4.
 */

const SCOPE = Object.freeze({ INTERNAL: 'internal', BUYER: 'buyer' });

// Product fields a buyer is allowed to see (drives "why this product").
const BUYER_SAFE_PRODUCT_FIELDS = [
  'id', 'title', 'name', 'handle', 'category', 'type', 'price', 'compare_at',
  'description', 'origin', 'studio', 'region_origin', 'benefits', 'tags',
  'certifications', 'image', 'image_url', 'rating', 'reviews_count', 'design', 'paint',
];

// Top-level ownData keys that are NEVER exposed to a buyer agent.
const INTERNAL_ONLY_KEYS = [
  'orders', 'users', 'campaigns', 'campaignAssets', 'campaignMetrics',
  'events', 'mvtResults', 'feedback', 'competitors', 'assets',
];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj && obj[f] !== undefined && obj[f] !== null) out[f] = obj[f];
  return out;
}

/** Strip a product/catalog list down to buyer-safe fields only. */
function buyerSafeCatalog(catalog) {
  return (Array.isArray(catalog) ? catalog : []).map((p) => pick(p, BUYER_SAFE_PRODUCT_FIELDS));
}

/**
 * Project a full ownData/analysis bundle into what a buyer agent may use:
 * catalog (buyer-safe) + public proof aggregates only. No revenue, PII,
 * performance, competitor captures, or internal strategy.
 */
function buyerSafe(data = {}) {
  const catalog = buyerSafeCatalog(data.catalog || data.products || []);
  // Public proof aggregates are safe (counts), exact revenue/PII are not.
  const proof = {
    review_count: Number(data.orderCount || 0) > 0 ? 'thousands of orders fulfilled' : undefined,
    certifications: ['B-Corp', 'one-of-one', 'studio-fresh in 72h'],
  };
  return { scope: SCOPE.BUYER, catalog, proof, brand: 'KNICKGASM' };
}

/**
 * Gate any data bundle by scope.
 * @param {object} data  full ownData/analysis/kb bundle
 * @param {'internal'|'buyer'} scope
 */
function scopeData(data = {}, scope = SCOPE.BUYER) {
  if (scope === SCOPE.INTERNAL) return { scope: SCOPE.INTERNAL, ...data };
  return buyerSafe(data);
}

/** Normalise an arbitrary scope input; default to the safer BUYER scope. */
function resolveScope(s) {
  return String(s || '').toLowerCase() === SCOPE.INTERNAL ? SCOPE.INTERNAL : SCOPE.BUYER;
}

/** True if a top-level ownData key is allowed for the given scope. */
function keyAllowed(key, scope) {
  if (resolveScope(scope) === SCOPE.INTERNAL) return true;
  return !INTERNAL_ONLY_KEYS.includes(key);
}

module.exports = {
  SCOPE, BUYER_SAFE_PRODUCT_FIELDS, INTERNAL_ONLY_KEYS,
  buyerSafe, buyerSafeCatalog, scopeData, resolveScope, keyAllowed,
};
