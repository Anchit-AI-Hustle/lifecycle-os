'use strict';
/**
 * brand-runtime.js — the ACTIVE BRAND, resolved server-side.
 * ---------------------------------------------------------------------------
 * brand-context.js re-skins the browser, but that is only paint: the prompts
 * that actually generate mailers, ads, landing pages and calendars run on the
 * server, and they must be built from the caller's brand too — otherwise a
 * custom brand sees its own colours in the shell and tenant-zero content in the
 * output.
 *
 * This module is the server-side counterpart. Any generator can call
 *
 *     const brand = await brandRuntime.resolve(req);
 *     const block = brandRuntime.brandBlock(brand);
 *
 * and get a prompt block describing THAT brand: identity, voice, palette,
 * typography, logo, regions, preferred and banned vocabulary.
 *
 * Resolution order:
 *   1. an explicit `workspace_id` on the request (query or body), checked
 *      against the caller's own access, then
 *   2. the caller's active workspace (brand_user_prefs), then
 *   3. data/brands/_default.json — tenant zero, so every existing caller that
 *      has no session or no brand behaves exactly as it did before.
 *
 * Zero fabrication: a field the brand has not supplied is NOT invented and NOT
 * inherited from tenant zero. It is written into the prompt as
 *   [DATA REQUIRED BEFORE LAUNCH: <field>, all, <region>]
 * so the model is told to leave a gap rather than guess.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const brandCore = require('./brand-workspace-core.js');

const CACHE = new Map();          // token+workspace -> { brand, at }
const TTL = 30_000;

function isDefault(brand) { return !brand || !brand.id; }

/* ── the brand a GENERATOR should use ──────────────────────────────────────
 *
 * `defaultBrand()` means one specific thing: TENANT ZERO, the shipped record.
 * It is the right answer to "who owns the bundled catalogue" - brand-catalog-
 * server's tenantZeroSlug() reads its identity from exactly there - and it is
 * the WRONG answer to "which brand am I generating for", which is what ~26
 * call sites across the generators were using it for:
 *
 *     if (!b) { try { b = require('./brand-runtime.js').defaultBrand(); } ... }
 *
 * Every one of those turns a brand that failed to resolve into tenant zero, so
 * a workspace with no brand on the context generated tenant zero's products
 * under its own name. That is how /social produced posts about one company's
 * sneakers, with that company's real product URLs, inside another company's
 * workspace.
 *
 * `scopedBrand()` answers the generator's question honestly:
 *   1. the brand it was handed, if it is a real one;
 *   2. otherwise the brand PINNED for this generation (AsyncLocalStorage, so
 *      concurrent brands in one warm runtime cannot see each other);
 *   3. otherwise an UNRESOLVED brand - never tenant zero.
 *
 * An unresolved brand is deliberately usable: it is brand-shaped, so callers do
 * not crash, and every field a generator would print carries a DATA REQUIRED
 * marker. The output is visibly incomplete instead of quietly belonging to
 * somebody else. Silence about a missing brand is what shipped the bug.
 */

const UNRESOLVED_NOTE = 'brand could not be resolved for this request';

function unresolvedBrand(reason) {
  const why = String(reason || UNRESOLVED_NOTE);
  const mark = (field) => `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${why}]`;
  return {
    id: '', slug: '', unresolved: true, unresolved_reason: why,
    name: mark('brand name'),
    tagline: '', industry: '', website: '',
    // Empty, not tenant zero's. A renderer with no palette falls back to the
    // --brand-* tokens the page already carries; a renderer handed tenant
    // zero's palette paints another brand's colours and looks correct.
    palette: {}, typography: {}, voice: {}, regions: [],
    claims: [], offerings: [], competitors: [],
  };
}

/** True when this record is the unresolved placeholder rather than a brand. */
function isUnresolved(brand) { return !!(brand && brand.unresolved === true); }

/**
 * The brand this generation is for. NEVER tenant zero unless tenant zero is
 * genuinely what is in scope.
 */
function scopedBrand(candidate, opts) {
  const o = opts || {};
  if (candidate && (candidate.id || candidate.slug)) return candidate;

  // The catalogue scope pins {brand, workspaceId} for a generation subtree.
  try {
    const scope = require('./brand-catalog-server.js').currentScope();
    if (scope && scope.brand && (scope.brand.id || scope.brand.slug)) return scope.brand;
  } catch (_) { /* outside a pinned generation */ }

  // The request scope carries the HTTP request the handler is serving.
  try {
    const rs = require('./request-scope.js');
    const req = rs.currentRequest && rs.currentRequest();
    if (req && req.__brand && (req.__brand.id || req.__brand.slug)) return req.__brand;
  } catch (_) { /* outside a wrapped handler */ }

  // A caller that explicitly wants tenant zero asks for it by name.
  if (o.allowTenantZero === true) return defaultBrand();

  return unresolvedBrand(o.reason);
}

/**
 * Facts a brand carries that are NOT columns on `brand_workspaces`.
 *
 * The schema has a fixed set of columns (name, palette, typography, voice,
 * regions, catalog_source …) and one JSON column, `brand_data`, for everything
 * extensible. So a brand arrives here in one of two shapes that do not agree:
 *
 *   tenant zero and the presets are JSON files with these at the TOP LEVEL;
 *   a persisted workspace has them inside `brand_data`.
 *
 * Every generator in the OS reads the top level - `b.claims` in master-prompt,
 * lifecycle-mailer-build, social-core, calendar-trigger, landing-fallback. That
 * works perfectly for tenant zero and returns NOTHING for every brand a user
 * actually onboarded, so their verifiable claims never reached a single
 * generated asset and every one of them printed
 * "[DATA REQUIRED BEFORE LAUNCH: verifiable claims]" instead.
 *
 * The fix belongs at the boundary rather than at each of those call sites: this
 * is the one place a persisted row enters the system, so hoisting here fixes
 * every consumer at once, including the ones nobody has written yet.
 */
const HOISTED = ['offerings', 'claims', 'market_study', 'legal_entity', 'contact', 'social', 'asset_hosts'];

/**
 * Lift brand_data fields onto the brand, without ever shadowing a real column.
 * A genuine column always wins: brand_data is the overflow, not an override.
 */
function normalizeBrand(brand) {
  if (!brand || typeof brand !== 'object') return brand;
  const data = brand.brand_data;
  if (!data || typeof data !== 'object') return brand;

  let out = brand;
  for (const key of HOISTED) {
    const already = brand[key];
    const present = Array.isArray(already) ? already.length > 0 : (already !== undefined && already !== null);
    if (present) continue;
    if (data[key] === undefined || data[key] === null) continue;
    if (out === brand) out = { ...brand };      // copy only once, and only if needed
    out[key] = data[key];
  }
  return out;
}

/** The shipped brand. Never null — generators must always have something. */
function defaultBrand() {
  return brandCore.DEFAULT_BRAND || {
    name: 'this brand', palette: {}, typography: {}, voice: {}, regions: [],
  };
}

/**
 * Resolve the brand for this request. Never throws and never blocks a
 * generation: any failure falls back to tenant zero, because a brand lookup
 * problem must not take the whole app down.
 */
async function resolve(req, opts) {
  const o = opts || {};
  try {
    const q = (req && req.query) || {};
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const explicit = String(o.workspace_id || body.workspace_id || q.workspace_id || '');

    const auth = o.auth || await brandCore.requireUser(req);
    if (!auth || !auth.ok) return defaultBrand();

    // Resolve WHICH workspace first, then cache the workspace row against that
    // id. Caching against `<user>|<explicit>` instead would key every implicit
    // request as `<user>|`, so for the whole TTL after someone switched their
    // active brand they would keep generating with the previous brand's rules.
    // Existing generator clients send no workspace_id, so that is the common
    // path, not an edge case. The preference lookup is one cheap indexed read.
    const id = explicit || await brandCore.activeWorkspaceId(auth);
    if (!id) return defaultBrand();

    const key = `${auth.user_id}|${id}`;
    const hit = CACHE.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.brand;

    // Read with the CALLER'S token, so RLS decides whether they may use it.
    const ws = await brandCore.getWorkspace(auth, id);
    // Normalise BEFORE caching, so every consumer of the cached row sees the
    // same shape and the hoist cost is paid once per TTL rather than per read.
    const brand = ws ? normalizeBrand(ws) : defaultBrand();
    CACHE.set(key, { brand, at: Date.now() });
    return brand;
  } catch (_) {
    return defaultBrand();
  }
}

/**
 * Drop cached brand records after a write.
 *
 * The cache is keyed `<user>|<workspace>`, so a save or an activate has to
 * invalidate by workspace across every user who shares it. Without this, a
 * brand that was just saved kept generating from the PREVIOUS palette, voice
 * and claims for the rest of the TTL, and a brand switch kept using the old
 * brand for the same window. Both are stale reads that look like correct
 * output, which is the hardest kind to notice.
 *
 * Called with no id it clears everything, which is what a delete needs.
 */
function invalidate(workspaceId) {
  const id = workspaceId ? String(workspaceId) : '';
  if (!id) { CACHE.clear(); return; }
  for (const key of Array.from(CACHE.keys())) {
    if (key.slice(key.indexOf('|') + 1) === id) CACHE.delete(key);
  }
}

function missing(field, region) {
  return `[DATA REQUIRED BEFORE LAUNCH: ${field}, all, ${region || 'all'}]`;
}

function paletteLine(p) {
  const named = [
    ['primary', 'primary'], ['accent', 'accent'], ['ink', 'text'],
    ['surface', 'page surface'], ['surface_alt', 'card surface'],
  ].filter(([k]) => p && p[k]).map(([k, label]) => `${p[k]} ${label}`);
  if (!named.length) return missing('brand palette');
  const extra = Array.isArray(p.extra) ? p.extra.map((e) => `${e.hex} ${e.name}`) : [];
  return named.concat(extra).join(' · ');
}

function typographyLine(t) {
  const h = t && t.heading, b = t && t.body;
  if (!h && !b) return missing('brand typography');
  const parts = [];
  if (h && h.family) parts.push(`Headings = ${h.stack || `'${h.family}'`}`);
  else parts.push(`Headings = ${missing('typography.heading')}`);
  if (b && b.family) parts.push(`Body = ${b.stack || `'${b.family}'`}`);
  else parts.push(`Body = ${missing('typography.body')}`);
  return parts.join('. ');
}

function fontImport(t) {
  const fams = [];
  for (const slot of ['heading', 'body']) {
    const f = t && t[slot];
    if (f && f.family && f.google !== false) {
      fams.push(`family=${String(f.family).trim().replace(/\s+/g, '+')}:wght@${String(f.weights || '400;600;700').replace(/[^0-9;]/g, '')}`);
    }
  }
  if (!fams.length) return '';
  return `@import url('https://fonts.googleapis.com/css2?${fams.join('&')}&display=swap');`;
}

function regionLines(regions) {
  const list = Array.isArray(regions) ? regions.filter((r) => r && r.code) : [];
  if (!list.length) return missing('regions and store URLs');
  return list.map((r) =>
    `${r.code}: store ${r.store_url || missing('region store URL', r.code)}` +
    `${r.currency ? ` · ${r.currency}` : ''}${r.symbol ? ` (${r.symbol})` : ''}`
  ).join(' | ');
}

/**
 * The brand constraint block, built from THIS brand. Same shape as the block in
 * master-prompt.js so every prompt site can swap one for the other.
 */
function brandBlock(brand) {
  const b = brand || defaultBrand();
  const v = b.voice || {};
  const p = b.palette || {};
  const t = b.typography || {};

  const lines = [];
  lines.push(`BRAND: ${b.name || missing('brand name')}${b.tagline ? ` — ${b.tagline}` : ''}${b.industry ? ` (${b.industry})` : ''}.`);
  if (b.website) lines.push(`WEBSITE: ${b.website}`);
  lines.push(`VOICE: ${v.tone || missing('voice.tone')}.${v.notes ? ` ${v.notes}` : ''}`);
  lines.push(`PALETTE (use ONLY these): ${paletteLine(p)}.`);
  lines.push('CONTRAST (strict): every text/background pairing must reach WCAG AA (4.5:1). Never place dark text on a dark ground or light text on a light ground. Never use a black or dark-neutral section background; use the brand primary where a dark ground is wanted.');
  lines.push(`TYPOGRAPHY (strict): ${typographyLine(t)}. Never introduce another family.`);
  const imp = fontImport(t);
  if (imp) lines.push(`For any HTML asset, inject this EXACT import into the <head> <style> before app rules:\n  ${imp}`);
  lines.push(`LOGO (header, exact — never substitute): ${b.logo_url ? `<img src="${b.logo_url}" alt="${b.name || 'brand'}" /> at a restrained header height (~30px).` : missing('logo URL')}`);
  lines.push('FOOTER: "Privacy Policy" and "Terms of Service" must be plain labels with href="#" and no target/onclick routing.');
  // The block forbids fabricating a claim but never said what this brand may
  // actually assert, so a generator had nothing approved to reach for and every
  // proof line came out as a DATA REQUIRED marker even when the brand had
  // supplied claims. These are the only ones any asset may state as fact.
  const claims = Array.isArray(b.claims) ? b.claims.filter(Boolean) : [];
  lines.push(claims.length
    ? `VERIFIABLE CLAIMS (the ONLY statements that may be presented as fact; never assert anything else): ${claims.map((c) => `"${c}"`).join(' · ')}.`
    : `VERIFIABLE CLAIMS: ${missing('verifiable claims')}. Until they are supplied, write no proof, guarantee or credential line at all.`);
  if (Array.isArray(v.preferred) && v.preferred.length) lines.push(`PREFERRED words: ${v.preferred.join(', ')}.`);
  if (Array.isArray(v.banned) && v.banned.length) lines.push(`BANNED phrases (never use): ${v.banned.map((s) => `"${s}"`).join(', ')}.`);
  if (v.no_em_dashes !== false) lines.push('Never use em dashes or en dashes anywhere in output copy. Use commas, colons or plain hyphens.');
  lines.push(`REGIONS: ${regionLines(b.regions)}`);
  lines.push('NEVER: off-palette tints, fabricated product facts, prices, URLs, reviews, ratings, reviewer names, statistics or filenames. If a fact you need was not supplied, write [DATA REQUIRED BEFORE LAUNCH: field, product, region] in its place instead of inventing one.');

  return lines.join('\n');
}

/** Region facts for this brand, falling back to the shipped map. */
function regionFacts(brand, market) {
  const code = String(market || '').toUpperCase();
  const list = (brand && Array.isArray(brand.regions)) ? brand.regions : [];
  const hit = list.find((r) => String(r.code).toUpperCase() === code) || list[0];
  if (hit) {
    return {
      store: (hit.store_url || '').replace(/^https?:\/\//, ''),
      presell: (hit.store_url || '').replace(/^https?:\/\//, ''),
      currency: hit.symbol || (hit.currency === 'GBP' ? '£' : hit.currency === 'EUR' ? '€' : hit.currency === 'INR' ? '₹' : '$'),
      locale: 'en',
      code: hit.code,
    };
  }
  return null;
}

/**
 * Brand-aware banned-phrase scrubber. scenario-model.sanitizeBrand enforces
 * tenant zero's list; this additionally strips whatever THIS brand banned.
 * Returns the string unchanged when the brand declared no banned phrases.
 */
function scrubForBrand(str, brand) {
  const v = (brand && brand.voice) || {};
  let s = String(str == null ? '' : str);
  if (v.no_em_dashes !== false) s = s.replace(/[—–]/g, ', ');
  const banned = Array.isArray(v.banned) ? v.banned.filter(Boolean) : [];
  if (!banned.length) return s;
  // Drop the offending phrase and tidy the seam, rather than leaving it in.
  // The prompt already forbids these; this is the last-resort net, so it aims
  // for "readable without the phrase", not for a clever substitution it might
  // get wrong. Leading conjunctions and doubled punctuation are cleaned up.
  for (const phrase of banned) {
    try {
      const rx = new RegExp(String(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      s = s.replace(rx, '');
    } catch (_) { /* a phrase that will not compile is skipped, not fatal */ }
  }
  return s
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([.,;:!?])\1+/g, '$1')
    .replace(/(^|[.!?]\s+)(is|a|an|the|and|but)\b[,\s]+/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The same banned-phrase net, for a whole HTML DOCUMENT.
 *
 * scrubForBrand is a PROSE normaliser: it finishes by collapsing every
 * whitespace run to a single space so a sentence reads cleanly once a phrase is
 * cut out. Run that over a document and it collapses newlines too, which turns
 *
 *     // set up the pointer parallax
 *     startInteractions();
 *
 * into one line where the call sits inside the comment. The page still renders,
 * still validates, and quietly does nothing when the user moves the pointer.
 * Whitespace also carries meaning inside <pre> and <textarea>.
 *
 * So this variant removes the phrases and stops. It tidies only the horizontal
 * run left behind by the excision, and never touches a line terminator.
 */
function scrubHtmlForBrand(html, brand) {
  const v = (brand && brand.voice) || {};
  let s = String(html == null ? '' : html);
  if (v.no_em_dashes !== false) s = s.replace(/[—–]/g, ', ');
  const banned = Array.isArray(v.banned) ? v.banned.filter(Boolean) : [];
  if (!banned.length) return s;
  for (const phrase of banned) {
    try {
      const rx = new RegExp(String(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      s = s.replace(rx, '');
    } catch (_) { /* a phrase that will not compile is skipped, not fatal */ }
  }
  // Horizontal whitespace only: [^\S\r\n] is "space-like but not a newline".
  return s.replace(/[^\S\r\n]{2,}/g, ' ');
}

module.exports = {
  scopedBrand, unresolvedBrand, isUnresolved,
  resolve, brandBlock, regionFacts, scrubForBrand, scrubHtmlForBrand,
  defaultBrand, isDefault, normalizeBrand, invalidate, HOISTED,
};
