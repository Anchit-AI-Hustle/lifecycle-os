'use strict';

/**
 * offering-intelligence.js - what a brand sells, and how each offering is doing,
 * from what the brand's own store STATES (2026-10-23).
 *
 * The operator: "it must identify what the brand sells - articles or stories for
 * media brands, catalogued items for D2C brands or anything - ... analyse what are
 * their most engaged, most viewed and all metrics ... ensure the complete
 * information is showcased as best as possible as per the type of asset".
 *
 * The rule that shapes every line here: a metric is shown only when the store
 * itself states it, and every ranking says what it was ranked by.
 *   - what it sells: counted from the rows the import read (a Product, a story
 *     (Article / NewsArticle / BlogPosting), a plan, a service), never guessed
 *     from the brand's name or industry words;
 *   - most popular: the store's OWN popularity order (WooCommerce "Sort by
 *     popularity", Shopify "Best selling"), read by the importer, else none;
 *   - rating / reviews: the page's aggregateRating, else none;
 *   - views / shares / comments: the page's interactionStatistic, else none;
 *   - savings: the page's own price and compare-at price;
 *   - weight, pieces, servings, claim phrases: the page's own words.
 * No rating, review count, view count, bestseller flag or badge is ever
 * defaulted. A ranking with nothing to rank by is empty and carries the marker
 * naming the data it needs.
 *
 * Units are spelled out (unit-words.js): "500 grams", not "500g".
 */

const UW = require('./unit-words.js');

const MARKER = (field, brand) => `[DATA REQUIRED BEFORE LAUNCH: ${field}${brand ? `, ${brand}` : ''}]`;

// What one offering is, read from the row the import made.
function kindOf(row) {
  const k = String((row && row.offering_kind) || '').toLowerCase();
  if (k) return k === 'article' ? 'story' : k;
  const t = String((row && (row.product_type || row.type || row.category)) || '').toLowerCase();
  if (/^service$/.test(t)) return 'service';
  if (row && row.read_time) return 'story';
  return 'product';
}

const NOUNS = {
  product: ['product', 'products'], story: ['story', 'stories'], plan: ['plan', 'plans'],
  service: ['service', 'services'], app: ['app', 'apps'],
};

/**
 * What the brand sells, from its own rows (else the offerings on its record).
 * Returns {kind, counts, noun, nouns, basis}; kind is 'mixed' when no single
 * kind is at least 80% of the rows, null when nothing says.
 */
function whatItSells(brand, rows) {
  const counts = {};
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  for (const r of list) { const k = kindOf(r); counts[k] = (counts[k] || 0) + 1; }
  const total = list.length;
  const name = (brand && brand.name) || '';
  if (!total) {
    const offs = Array.isArray(brand && brand.offerings) ? brand.offerings.filter((o) => o && o.kind) : [];
    if (!offs.length) return { kind: null, counts: {}, noun: null, nouns: null, basis: MARKER('catalogue or offerings', name) };
    const k = {};
    for (const o of offs) k[o.kind] = (k[o.kind] || 0) + 1;
    const top = Object.entries(k).sort((a, b) => b[1] - a[1])[0][0];
    const n = NOUNS[top] || [top, `${top}s`];
    return { kind: top, counts: k, noun: n[0], nouns: n[1], basis: `the ${offs.length} offering${offs.length === 1 ? '' : 's'} named on ${name || 'the brand'}'s record` };
  }
  const [top, c] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const kind = c / total >= 0.8 ? top : 'mixed';
  const n = NOUNS[kind] || (kind === 'mixed' ? ['offering', 'offerings'] : [kind, `${kind}s`]);
  const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${v === 1 ? (NOUNS[k] || [k])[0] : (NOUNS[k] || [k, `${k}s`])[1]}`);
  return { kind, counts, noun: n[0], nouns: n[1], basis: `${parts.join(', ')} read from ${name || 'the brand'}'s own site` };
}

function symbolOf(cur) {
  try { return require('./brand-locale.js').symbolOf(cur); } catch (_) { return String(cur || ''); }
}

/** "₹160 for 500 grams (was ₹180, save ₹20)": the page's own prices, units in words. */
function formatPriceWithUnit(price, compareAt, currency, unitSpec) {
  const p = Number(price);
  if (price == null || !Number.isFinite(p) || p <= 0) return '';
  const cur = symbolOf(currency);
  const fmt = (n) => `${cur}${Number(n).toLocaleString(String(currency).toUpperCase() === 'INR' ? 'en-IN' : 'en-US')}`;
  let line = fmt(p);
  if (unitSpec) line += ` for ${UW.spellUnits(String(unitSpec).replace(/^(\d+(?:\.\d+)?)([a-z])/i, '$1 $2'))}`;
  const cp = Number(compareAt);
  if (compareAt != null && Number.isFinite(cp) && cp > p) line += ` (was ${fmt(cp)}, save ${fmt(Math.round(cp - p))})`;
  return line;
}

const num = (v) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };

/** One offering with only what its page states, plus the lines each asset can show. */
function enrich(p, brand) {
  const m = (p && p.metrics) || {};
  const title = String(p.title || p.name || p.n || '').trim();
  const price = num(p.price);
  const compareAt = num(p.compare_at != null ? p.compare_at : p.compare_at_price);
  const currency = p.currency || '';
  const unit = p.unit_spec || null;
  const o = {
    title,
    kind: kindOf(p),
    handle: String(p.handle || p.h || ''),
    url: p.product_url || p.url || '',
    image: p.image_url || p.image || p.i || (Array.isArray(p.image_urls) ? p.image_urls[0] : null) || (Array.isArray(p.imgs) ? p.imgs[0] : null) || null,
    category: String(p.product_type || p.type || p.category || '').trim() || null,
    price, compare_at: compareAt, currency: currency || null,
    unit_spec: unit, piece_count: p.piece_count || null, servings: p.servings || null,
    claims: Array.isArray(p.claims) ? p.claims.slice(0, 8) : [],
    rating: num(m.rating), reviews_count: num(m.reviews_count),
    views: num(m.views), shares: num(m.shares), comments: num(m.comments),
    popularity_rank: num(m.popularity_rank), popularity_of: num(m.popularity_of),
    popularity_basis: m.popularity_basis || null, popularity_source: m.popularity_source || null,
    read_time: p.read_time || m.read_time || null, author: p.author || null, published_at: p.published_at || null,
    savings_pct: (price != null && compareAt != null && compareAt > price) ? Math.round(((compareAt - price) / compareAt) * 100) : null,
  };
  o.price_display = formatPriceWithUnit(price, compareAt, currency, unit);
  const spec = [];
  if (unit) spec.push(UW.spellUnits(String(unit).replace(/^(\d+(?:\.\d+)?)([a-z])/i, '$1 $2')));
  if (o.piece_count) spec.push(o.piece_count);
  if (o.servings) spec.push(o.servings);
  if (o.read_time) spec.push(o.read_time);
  if (o.author) spec.push(`by ${o.author}`);
  o.spec_line = spec.join(' · ');
  // Proof, each line naming what it rests on. Order: the store's own rank,
  // rating, readership. Nothing here is a default.
  const proof = [];
  const host = (() => { try { return new URL(o.popularity_source || o.url).host.replace(/^www\./, ''); } catch (_) { return ''; } })();
  if (o.popularity_rank === 1) proof.push({ text: `Most popular on ${host || 'the store'}`, basis: o.popularity_basis, source: o.popularity_source });
  // "Top N" only means something when N is a small part of what was ranked.
  else if (o.popularity_rank != null && o.popularity_rank <= 3 && (o.popularity_of || 0) >= 10) proof.push({ text: `In the top 3 on ${host || 'the store'}`, basis: o.popularity_basis, source: o.popularity_source });
  else if (o.popularity_rank != null && o.popularity_rank <= 10 && (o.popularity_of || 0) >= 30) proof.push({ text: `In the top 10 on ${host || 'the store'}`, basis: o.popularity_basis, source: o.popularity_source });
  if (o.rating != null && o.reviews_count) proof.push({ text: `Rated ${o.rating} by ${o.reviews_count.toLocaleString('en-US')} reviewer${o.reviews_count === 1 ? '' : 's'}`, basis: 'the page\'s own aggregateRating', source: o.url });
  if (o.views != null) proof.push({ text: `${o.views.toLocaleString('en-US')} reads`, basis: 'the page\'s own interactionStatistic', source: o.url });
  o.proof = proof;
  o.badge = proof.length ? proof[0].text : null;
  return o;
}

function ranked(list, key, dir, need) {
  return list.filter((x) => x[key] != null && (!need || need(x))).sort((a, b) => (dir === 'asc' ? a[key] - b[key] : b[key] - a[key]));
}

/**
 * Every offering with its stated facts, and every ranking the store's data
 * supports, each with its basis; a ranking it does not support is empty with
 * the marker naming what it needs.
 */
function analyzeCatalogOfferings(products, brand) {
  const b = brand || {};
  const name = b.name || '';
  const list = (Array.isArray(products) ? products : []).filter((p) => p && String(p.title || p.name || p.n || '').trim() && !/^\[DATA REQUIRED/.test(String(p.title || p.name || p.n)));
  const offerings = list.map((p) => enrich(p, b));
  const sells = whatItSells(b, list);
  const rank = (key, dir, basis, field, need) => {
    const items = ranked(offerings, key, dir, need);
    return items.length ? { items: items.slice(0, 10), basis } : { items: [], missing: MARKER(field, name) };
  };
  const popBasis = (offerings.find((o) => o.popularity_basis) || {}).popularity_basis || null;
  const rankings = {
    most_popular: rank('popularity_rank', 'asc', popBasis ? `ranked by ${popBasis}` : '', 'store popularity order (sales ranking)'),
    top_rated: rank('rating', 'desc', 'the rating each page states (aggregateRating), with its review count', 'product ratings', (x) => x.reviews_count > 0),
    most_viewed: rank('views', 'desc', 'the read or view count each page states (interactionStatistic)', 'view or read counts'),
    most_shared: rank('shares', 'desc', 'the share count each page states', 'share counts'),
    most_discussed: rank('comments', 'desc', 'the comment count each page states', 'comment counts'),
    biggest_savings: rank('savings_pct', 'desc', 'the page\'s own price against its compare-at price', 'compare-at prices'),
  };
  // Most engaged: the store's own popularity first, then readership, then
  // reviews - the first signal the store states, never a blended score.
  const engaged = rankings.most_popular.items[0] ? { item: rankings.most_popular.items[0], basis: rankings.most_popular.basis }
    : rankings.most_viewed.items[0] ? { item: rankings.most_viewed.items[0], basis: rankings.most_viewed.basis }
      : rankings.top_rated.items[0] ? { item: rankings.top_rated.items[0], basis: rankings.top_rated.basis }
        : { item: null, missing: MARKER('engagement data (store popularity order, ratings or view counts)', name) };
  const coverage = {};
  for (const k of ['price', 'image', 'unit_spec', 'rating', 'views', 'popularity_rank']) {
    coverage[k] = offerings.filter((o) => o[k] != null && o[k] !== '').length;
  }
  const categories = {};
  for (const o of offerings) { const c = o.category || 'Uncategorised'; (categories[c] = categories[c] || []).push(o); }
  return {
    sells, total_offerings: offerings.length, offerings, rankings,
    most_engaged: engaged, categories, coverage,
    coverage_note: offerings.length
      ? `Of ${offerings.length} ${sells.nouns || 'offerings'}: price stated on ${coverage.price}, a photo on ${coverage.image}, a weight or size on ${coverage.unit_spec}, a rating on ${coverage.rating}, a view count on ${coverage.views}, a store popularity rank on ${coverage.popularity_rank}.`
      : MARKER('catalogue', name),
  };
}

/**
 * What one offering shows on one kind of asset, from its stated facts only.
 * email/landing carry everything stated; an ad carries the headline facts
 * that fit its space; a story carries byline and reading time.
 */
function showcaseFor(offering, asset) {
  const o = offering || {};
  const a = String(asset || 'email');
  const out = { title: o.title, image: o.image, url: o.url };
  if (o.kind === 'story') {
    out.byline = [o.author ? `By ${o.author}` : '', o.read_time || ''].filter(Boolean).join(' · ');
    out.proof = o.proof && o.proof[0] ? o.proof[0].text : '';
    return out;
  }
  out.price = o.price_display || '';
  if (a === 'ad') {
    out.proof = o.proof && o.proof[0] ? o.proof[0].text : '';
    out.claim = o.claims && o.claims[0] ? o.claims[0] : '';
    return out;
  }
  out.spec = o.spec_line || '';
  out.claims = (o.claims || []).slice(0, a === 'landing' ? 6 : 3);
  out.proof = (o.proof || []).map((p) => p.text);
  return out;
}

module.exports = { whatItSells, kindOf, formatPriceWithUnit, analyzeCatalogOfferings, showcaseFor, enrich };
