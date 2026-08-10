'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Competitive Intelligence — OFFERS layer.
//
// The most actionable object in the system. Every asset (ad/email/landing) is
// scanned for offers; each detected offer becomes a ci_offers row so the team
// can answer questions like:
//   "every competitor running a free-gift offer on custom sneakers in the US in last 30d"
//
// Detection is a deterministic regex/keyword pass (fast, free, runs on every
// collect). The AI enrichment pass (ci-enrich.js) can later upgrade offer_type
// confidence, but offers are never blocked on an LLM call.
// ─────────────────────────────────────────────────────────────────────────────

const supa = require('./supa');

const OFFER_TYPES = ['percent_off', 'amount_off', 'bundle', 'free_gift', 'subscription', 'bogo', 'free_shipping', 'other'];

// Category buckets an offer can be attributed to. The KEYS are persisted on
// ci_offers rows, so they are kept stable; only the matching lexicon is
// Knickgasm's (custom sneakers, not the legacy beverage taxonomy).
const CATEGORY_KEYWORDS = {
  coffee:      /\b(coffee-?art|coffee art|latte art|barista print|cafe print)\b/i,
  sneaker:         /\b(sneaker|kicks|dunks?|high\s?top|jordan|air\s?force|court vision|converse|samba|custom(ised|ized)? (shoe|pair|sneaker))\b/i,
  supplements: /\b(care kit|cleaner|protect(ant|or)|restoration|rope laces?|lace tags?|shoe tree|crease guard)\b/i,
  streetwear:    /\b(streetwear|denim jacket|jacket|hoodie|tee|apparel|embroidery|bling|crystal)\b/i
};

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
  if (/\b(free\s+gift|gift\s+with\s+purchase|gwp|complimentary\s+\w+|free\s+(?:sample|box|tote|infuser))\b/i.test(text))
    push({ offer_type: 'free_gift', raw_text: (text.match(/\b(free\s+gift|gift\s+with\s+purchase|free\s+(?:sample|box|tote|infuser))\b/i) || [''])[0] });
  // BOGO
  if (/\b(bogo|buy\s+one\s+get\s+one|buy\s*\d\s*get\s*\d|b\dg\d)\b/i.test(text))
    push({ offer_type: 'bogo', raw_text: (text.match(/\b(bogo|buy\s+one\s+get\s+one|buy\s*\d\s*get\s*\d)\b/i) || [''])[0] });
  // subscription
  if (/\b(subscribe\s*&?\s*save|subscription|auto[-\s]?ship|recurring delivery)\b/i.test(text))
    push({ offer_type: 'subscription', raw_text: (text.match(/\b(subscribe\s*&?\s*save|subscription|auto[-\s]?ship)\b/i) || [''])[0] });
  // bundle
  if (/\b(bundle|kit|set|combo|sampler|trio|duo|collection)\b/i.test(text) && !found.some(f => f.offer_type === 'bundle'))
    push({ offer_type: 'bundle', raw_text: (text.match(/\b(bundle|kit|sampler|combo)\b/i) || [''])[0] });

  // promo code:  "code WELCOME15", "use TEA20"
  const code = text.match(/\b(?:code|coupon|promo)[:\s]+([A-Z0-9]{3,15})\b/);
  if (code) found.forEach(f => { if (!f.promo_code) f.promo_code = code[1]; });

  return found;
}

function guessCategory(text, brand) {
  if (brand?.category) return brand.category;
  for (const [cat, re] of Object.entries(CATEGORY_KEYWORDS)) if (re.test(text || '')) return cat;
  return 'dtc';
}

// Detect + persist offers for a freshly-collected asset.
async function extractAndStore({ assetType, assetId, brand, source, text, region }) {
  const detected = detectOffers(text);
  if (!detected.length) return [];
  const cat = guessCategory(text, brand);
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

module.exports = { OFFER_TYPES, detectOffers, guessCategory, extractAndStore, query };
