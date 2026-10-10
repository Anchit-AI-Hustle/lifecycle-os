'use strict';
/**
 * market-moments.js - the festivals and public moments of ONE market, for ONE
 * brand (2026-10-05).
 * ---------------------------------------------------------------------------
 * data/festivals.json is keyed by market, so an Indian slot already meets
 * Diwali, Holi, Republic Day and the Indian sale days, and a US slot meets
 * Thanksgiving. Two things went wrong around it:
 *
 *   1. A slot whose market fell to a literal 'US' or 'UK' (the agentic run,
 *      the Social OS, the V1 plan) planned an Indian brand around American or
 *      British holidays. brand-locale.js fixes the market; this reads the
 *      list for the market the brand actually has.
 *   2. The file is tenant zero's marketing calendar, not only a holiday list.
 *      Beside Diwali it carries Air Max Day, Pokemon Day, Goku Day, One Piece
 *      Day, Taylor Swift's birthday and an order-cutoff note "given custom
 *      lead times" - moments chosen for one sneaker brand's audience. A
 *      festival is a fact about a MARKET; Air Max Day is a decision about a
 *      brand. So tenant zero reads the whole list (its own), and every other
 *      brand reads only the public moments: an entry tagged with one of
 *      tenant zero's audience interests, or worded for its own lead times, is
 *      not offered to anybody else.
 *
 * Global moments ride beside a market's own, as the planners already did.
 * A brand with no market gets no moments (and its planner has a marker for
 * the market). Not a function file.
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

/* Tags that mark a moment as one brand's audience interest, not a public one. */
const BRAND_INTEREST = new Set([
  'anime', 'fandom', 'sneaker-culture', 'nike', 'kicks', 'streetwear', 'dragon-ball', 'one-piece',
  'taylor-swift', 'gaming', 'pop-culture', 'cars', 'motorsport', 'coffee', 'sneaker-season', 'drop', 'pets',
]);
/* Wording that belongs to tenant zero's own operation (its custom lead times). */
const BRAND_WORDING = /custom lead times|sneaker|kicks|\bdrop\b/i;

let FILE = null;
function file() {
  if (FILE) return FILE;
  for (const base of [path.join(__dirname, '..', '..'), process.cwd()]) {
    try {
      const f = path.join(base, 'data', 'festivals.json');
      if (fs.existsSync(f)) { FILE = JSON.parse(fs.readFileSync(f, 'utf8')); return FILE; }
    } catch (_) { /* next root */ }
  }
  FILE = {};
  return FILE;
}

/** The file's key for a market code (IN, UK, US, GLOBAL -> Global). */
function keyOf(market) {
  const m = String(market || '').toUpperCase();
  if (!m) return '';
  if (m === 'GLOBAL' || m === 'WORLDWIDE' || m === 'ROW') return 'Global';
  if (m === 'GB') return 'UK';
  return m;
}

function isTenantZero(brand) {
  try { return require('./brand-catalog-server.js').isTenantZeroBrand(brand) === true; } catch (_) { return false; }
}

function isPublic(entry) {
  const tags = Array.isArray(entry && entry.tags) ? entry.tags : [];
  if (tags.some((t) => BRAND_INTEREST.has(String(t).toLowerCase()))) return false;
  return !BRAND_WORDING.test(String((entry && entry.name) || ''));
}

/**
 * Every moment for `market` as THIS brand may use it: tenant zero's whole
 * list for its own brand, the public moments for anyone else, Global's
 * public moments beside the market's own (Global's own list for a GLOBAL
 * market). [] for a brand with no market.
 */
function momentsFor(market, brand) {
  const k = keyOf(market);
  if (!k) return [];
  const all = file();
  const own = Array.isArray(all[k]) ? all[k] : [];
  const global = k === 'Global' ? [] : (Array.isArray(all.Global) ? all.Global : []);
  const zero = isTenantZero(brand);
  const keep = (e) => e && e.date && e.name && (zero || isPublic(e));
  return own.filter(keep).concat(global.filter(keep).map((e) => Object.assign({}, e, { scope: 'global' })));
}

/** The highest-weighted moment ON this date (MM-DD) in this market, or null. */
function momentOn(market, dateIso, brand) {
  const mmdd = String(dateIso || '').slice(5, 10);
  if (!mmdd) return null;
  const hits = momentsFor(market, brand).filter((e) => e.date === mmdd);
  if (!hits.length) return null;
  const best = hits.sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
  return { name: best.name, weight: best.weight || 0, tags: best.tags || [], date: best.date, archetype_hint: best.archetype_hint || null, market: String(market || '').toUpperCase() };
}

module.exports = { momentsFor, momentOn, isPublic, BRAND_INTEREST };
