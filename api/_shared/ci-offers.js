'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Competitive Intelligence — OFFERS layer.
//
// The most actionable object in the system. Every asset (ad/email/landing) is
// scanned for offers; each detected offer becomes a ci_offers row so the team
// can answer questions like:
//   "every competitor running a free-gift offer in one of our categories, US, last 30d"
//
// Detection is a deterministic regex/keyword pass (fast, free, runs on every
// collect). The AI enrichment pass (ci-enrich.js) can later upgrade offer_type
// confidence, but offers are never blocked on an LLM call.
// ─────────────────────────────────────────────────────────────────────────────

const supa = require('./supa');

const OFFER_TYPES = ['percent_off', 'amount_off', 'bundle', 'free_gift', 'subscription', 'bogo', 'free_shipping', 'other'];

/**
 * Category buckets an offer can be attributed to.
 *
 * THERE IS NO FIXED LEXICON HERE, DELIBERATELY. This module used to carry a
 * hardcoded four-bucket taxonomy inherited from a sibling repo built for a
 * beverage and supplement business: keys named `coffee` and `supplements`, with
 * a sneaker-care word list bolted onto the `supplements` key so it would still
 * match something. Every competitor offer this platform ever detected was
 * therefore filed under another industry's category names, for every tenant.
 *
 * A category only means anything relative to the brand doing the watching, so
 * it is derived from that brand's OWN record at call time (see
 * `categoryVocabulary`). A workspace whose record names no offerings gets
 * `null` - an uncategorised offer is honest, an offer filed under a category
 * this brand does not trade in is not.
 */

/** Words too generic to identify a category on their own. */
const VOCAB_STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'your', 'our', 'new', 'set', 'pack',
  'kit', 'box', 'size', 'pair', 'sale', 'off', 'free', 'gift', 'best', 'top',
  'shop', 'buy', 'all', 'one', 'two', 'plus', 'pro', 'max', 'mini', 'edition',
  'collection', 'product', 'products', 'item', 'items', 'range', 'series',
]);

function vocabToken(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return w.length >= 4 && !VOCAB_STOP.has(w) ? w : '';
}

/**
 * The category vocabulary of ONE brand, built from its own record: the kinds
 * and titles of the things it actually sells. Returns [{ key, terms }] where
 * `key` is the value persisted on the row, so it is always a word this brand
 * uses about itself.
 */
function categoryVocabulary(brand) {
  const out = [];
  const seen = new Set();
  const push = (key, terms) => {
    const k = String(key || '').toLowerCase().trim();
    if (!k || seen.has(k) || !terms.length) return;
    seen.add(k);
    out.push({ key: k, terms: [...new Set(terms)] });
  };

  const offerings = (brand && (brand.offerings || (brand.brand_data && brand.brand_data.offerings))) || [];
  // Group by the brand's own `kind` / `category` field first: that IS its taxonomy.
  const byKind = new Map();
  for (const o of Array.isArray(offerings) ? offerings : []) {
    if (!o || typeof o !== 'object') continue;
    const kind = String(o.category || o.kind || '').toLowerCase().trim();
    if (!kind) continue;
    const terms = byKind.get(kind) || [];
    for (const w of String(o.title || o.name || '').split(/\s+/)) {
      const t = vocabToken(w);
      if (t) terms.push(t);
    }
    const kindTok = vocabToken(kind);
    if (kindTok) terms.push(kindTok);
    byKind.set(kind, terms);
  }
  for (const [kind, terms] of byKind) push(kind, terms);

  // A brand with no offerings on record still has an industry line it wrote itself.
  if (!out.length) {
    const industry = String((brand && (brand.industry || brand.category)) || '').toLowerCase();
    const terms = industry.split(/[^a-z0-9]+/).map(vocabToken).filter(Boolean);
    if (terms.length) push(industry.split(/[^a-z0-9]+/).filter(Boolean)[0], terms);
  }
  return out;
}

const CURRENCY = /(?:[$£€₹]|usd|gbp|eur|inr)/i;

// Detect every offer phrase in a blob of text. Returns [{offer_type, value, unit, raw_text, promo_code}]
function detectOffers(text) {
  if (!text) return [];
  const found = [];
  const seen = new Set();
  const push = (o) => { const k = `${o.offer_type}|${o.offer_value}|${o.promo_code || ''}`; if (!seen.has(k)) { seen.add(k); found.push(o); } };

  // percent off:  "20% off", "save 25%", "30% off sitewide"
  for (const m of text.matchAll(/(\d{1,2})\s*%\s*(?:off|discount|savings?)|save\s*(\d{1,2})\s*%/gi)) {
    push({ offer_type: 'percent_off', offer_value: Number(m[1] || m[2]), offer_unit: 'percent', raw_text: m[0].trim() });
  }
  // amount off:  "$10 off", "£5 off", "save $25"
  for (const m of text.matchAll(/(?:[$£€₹])\s?(\d{1,4})\s*off|save\s*(?:[$£€₹])\s?(\d{1,4})/gi)) {
    push({ offer_type: 'amount_off', offer_value: Number(m[1] || m[2]), offer_unit: 'currency', raw_text: m[0].trim() });
  }
  // free shipping
  if (/\bfree\s+(?:shipping|delivery)\b/i.test(text)) push({ offer_type: 'free_shipping', raw_text: 'free shipping' });
  // free gift / GWP
  if (/\b(free\s+gift|gift\s+with\s+purchase|gwp|complimentary\s+\w+|free\s+(?:sample|box|tote|trial))\b/i.test(text))
    push({ offer_type: 'free_gift', raw_text: (text.match(/\b(free\s+gift|gift\s+with\s+purchase|free\s+(?:sample|box|tote|trial))\b/i) || [''])[0] });
  // BOGO
  if (/\b(bogo|buy\s+one\s+get\s+one|buy\s*\d\s*get\s*\d|b\dg\d)\b/i.test(text))
    push({ offer_type: 'bogo', raw_text: (text.match(/\b(bogo|buy\s+one\s+get\s+one|buy\s*\d\s*get\s*\d)\b/i) || [''])[0] });
  // subscription
  if (/\b(subscribe\s*&?\s*save|subscription|auto[-\s]?ship|recurring delivery)\b/i.test(text))
    push({ offer_type: 'subscription', raw_text: (text.match(/\b(subscribe\s*&?\s*save|subscription|auto[-\s]?ship)\b/i) || [''])[0] });
  // bundle
  if (/\b(bundle|kit|set|combo|sampler|trio|duo|collection)\b/i.test(text) && !found.some(f => f.offer_type === 'bundle'))
    push({ offer_type: 'bundle', raw_text: (text.match(/\b(bundle|kit|sampler|combo)\b/i) || [''])[0] });

  // promo code:  "code WELCOME15", "use DROP20"
  const code = text.match(/\b(?:code|coupon|promo)[:\s]+([A-Z0-9]{3,15})\b/);
  if (code) found.forEach(f => { if (!f.promo_code) f.promo_code = code[1]; });

  return found;
}

/**
 * The category to file an offer under.
 *
 * 1. The competitor row's OWN recorded category, when the universe carries one.
 * 2. Otherwise the watching brand's own vocabulary (`ownerBrand`), if a term of
 *    one of its categories appears in the asset text.
 * 3. Otherwise null. Uncategorised is a true statement; a bucket borrowed from
 *    an industry this deployment does not trade in is not.
 */
function guessCategory(text, brand, ownerBrand) {
  if (brand?.category) return brand.category;
  const haystack = String(text || '').toLowerCase();
  if (!haystack) return null;
  let best = null;
  for (const { key, terms } of categoryVocabulary(ownerBrand)) {
    let hits = 0;
    for (const t of terms) if (haystack.includes(t)) hits++;
    if (hits && (!best || hits > best.hits)) best = { key, hits };
  }
  return best ? best.key : null;
}

// Detect + persist offers for a freshly-collected asset.
// `ownerBrand` is the WATCHING workspace's brand record: it supplies the
// category vocabulary, and nothing else about it is stored on the row.
async function extractAndStore({ assetType, assetId, brand, source, text, region, ownerBrand }) {
  const detected = detectOffers(text);
  if (!detected.length) return [];
  const cat = guessCategory(text, brand, ownerBrand);
  const reg = region || brand?.region || null;
  const now = new Date().toISOString();
  const rows = detected.map(o => {
    const content_hash = supa.sha1(`${brand?.id || ''}|${o.offer_type}|${o.offer_value || ''}|${assetType}|${assetId}`);
    return {
      brand_id: brand?.id || null, brand_name: brand?.name || null,
      offer_type: o.offer_type, offer_value: o.offer_value ?? null, offer_unit: o.offer_unit || null,
      product_category: cat, region: reg, promo_code: o.promo_code || null, raw_text: o.raw_text || null,
      asset_type: assetType, asset_id: assetId, source: source || null,
      first_seen: now, last_seen: now, content_hash
    };
  });
  try {
    return await supa.insert('ci_offers', rows, { upsertOn: 'content_hash' });
  } catch (e) {
    // merge-duplicates may bump last_seen via separate update if upsert unsupported
    return [];
  }
}

// The marketing-team query.
// opts: { offer_type, product_category, region, brand_id, days=30, limit=200 }
async function query(opts = {}) {
  const filters = {};
  if (opts.offer_type)       filters.offer_type = `eq.${opts.offer_type}`;
  if (opts.product_category) filters.product_category = `eq.${opts.product_category}`;
  if (opts.region)           filters.region = `eq.${opts.region}`;
  if (opts.brand_id)         filters.brand_id = `eq.${opts.brand_id}`;
  const days = Number(opts.days || 30);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  filters.last_seen = `gte.${since}`;
  return supa.select('v_ci_offers_enriched', {
    filters, order: 'last_seen.desc', limit: opts.limit || 200
  });
}

module.exports = { OFFER_TYPES, detectOffers, categoryVocabulary, guessCategory, extractAndStore, query };
