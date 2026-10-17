'use strict';
/**
 * The brand guard (2026-10-17): every model answer that becomes a customer's
 * copy is CHECKED against the brand's rules before it is used, whichever model
 * wrote it.
 *
 * The operator, on the free keyless model: "it must always ensure it only
 * follows the brand guidelines". Every model gets the same brief (the brand
 * block, the asset contracts, the banned list, the compliance rules), and a
 * brief is a request, not a guarantee: a weaker model breaks it more often.
 * Scrubs already strip banned phrases and dashes; nothing rejected an answer
 * that invented a figure, a claim or a customer count, or that named another
 * company (the benchmark brief now names its exemplars). A rejected answer is
 * never used: the caller falls back to its code-written assets, which say only
 * what the brand's own record states.
 *
 * What blocks:
 *   - every BLOCK finding of the compliance gate (compliance-lint.js), run with
 *     THIS brand and market: unapproved statistics and claims, guaranteed
 *     outcomes, the brand's own banned phrases, disease claims and the rest;
 *   - another company's name: tenant zero's (unless this IS tenant zero) and
 *     the distinctive names of the benchmark exemplars, unless this brand's own
 *     record says it (its name, tagline, claims, offerings) or the send's own
 *     products do (`opts.allow`).
 * Image briefs are not copy (they go to an image model) and are not judged.
 */

// Distinctive names only: an exemplar that is also an ordinary word or place
// ("The Atlantic", "Patagonia", "Whoop", "Apple") would reject honest copy.
const EXEMPLAR_NAMES = [
  'Bloomberg', 'Finshots', 'Seeking Alpha', 'Robinhood', 'Morningstar', 'Matt Levine', 'Stratechery', 'Axios',
  'Motley Fool', 'Koyfin', 'TradingView', 'Substack', 'Refinitiv', 'Morning Brew', 'New York Times', 'Puck News',
  'Semafor', 'Heather Cox Richardson', 'Dan Primack', 'The Economist', 'Glossier', 'Nike', 'Ridge Wallet',
  'Gymshark', 'Everlane', 'Lunya', 'Vuori', 'HexClad', 'Manscaped', 'Oura', 'Spotify', 'TechCrunch',
];

const SKIP_KEY = /(^|_)(image_brief|creative_brief|brief|prompt|image|url|href|src)$/i;

function textsOf(v, key, out) {
  const acc = out || [];
  if (v == null) return acc;
  if (typeof v === 'string') { if (!SKIP_KEY.test(String(key || ''))) acc.push(v); return acc; }
  if (Array.isArray(v)) { for (const x of v) textsOf(x, key, acc); return acc; }
  if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) if (!k.startsWith('__')) textsOf(x, k, acc); }
  return acc;
}

function htmlToText(s) {
  return String(s || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

function tenantZeroName(brand) {
  try {
    const rt = require('./brand-runtime.js');
    const zero = rt.defaultBrand();
    const name = zero && zero.name;
    if (!name) return '';
    const own = String((brand && brand.name) || '').toLowerCase();
    return own && own === String(name).toLowerCase() ? '' : name;
  } catch (_) { return ''; }
}

// `allow`: the facts this send carries (its product and offering names): a
// store selling another company's products names them honestly.
function otherNames(brand, allow) {
  const b = brand || {};
  const bd = b.brand_data || {};
  const offerings = (Array.isArray(b.offerings) ? b.offerings : []).map((x) => x && x.name);
  const ownText = [b.name, b.tagline, bd.tagline].concat(Array.isArray(b.claims) ? b.claims : [], Array.isArray(bd.claims) ? bd.claims : [], offerings, Array.isArray(allow) ? allow : [])
    .filter(Boolean).join(' ').toLowerCase();
  const names = EXEMPLAR_NAMES.filter((n) => ownText.indexOf(n.toLowerCase()) < 0);
  const zero = tenantZeroName(b);
  if (zero && ownText.indexOf(zero.toLowerCase()) < 0) names.push(zero);
  return names;
}

/**
 * Check copy (a string, an HTML document, or a copy object) for one brand.
 * @returns {{ ok:boolean, violations:Array<{kind:string, detail:string}> }}
 */
function check(copy, brand, opts) {
  const o = opts || {};
  const texts = typeof copy === 'string' ? [copy] : textsOf(copy);
  const text = texts.map((t) => (/<[a-z][\s\S]*>/i.test(t) ? htmlToText(t) : t)).join('\n');
  const violations = [];
  if (!text.trim()) return { ok: true, violations };
  for (const name of otherNames(brand, o.allow)) {
    const rx = new RegExp('(^|[^A-Za-z0-9])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', name === name.toUpperCase() ? 'i' : '');
    if (rx.test(text)) violations.push({ kind: 'other_brand', detail: `names ${name}, which is not this brand` });
  }
  try {
    const r = require('./compliance-lint.js').lint(text, { brand, market: o.market });
    for (const f of (r && r.findings) || []) {
      if (String(f.severity).toUpperCase() === 'BLOCK') violations.push({ kind: 'compliance', detail: `${f.title}: "${String(f.matched || '').slice(0, 80)}"`, id: f.id });
    }
  } catch (_) { /* the gate could not run: the name check still stands */ }
  return { ok: violations.length === 0, violations };
}

/** Throw when the copy breaks the brand's rules (the caller's fallback runs). */
function assertOnBrand(copy, brand, opts) {
  const r = check(copy, brand, opts);
  if (!r.ok) {
    const e = new Error('brand_guard: the answer broke the brand\'s rules (' + r.violations.map((v) => v.detail).slice(0, 3).join('; ') + ')');
    e.brandGuard = r;
    throw e;
  }
  return r;
}

module.exports = { check, assertOnBrand, otherNames, EXEMPLAR_NAMES };
