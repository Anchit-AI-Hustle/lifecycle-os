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
    const brand = ws || defaultBrand();
    CACHE.set(key, { brand, at: Date.now() });
    return brand;
  } catch (_) {
    return defaultBrand();
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

module.exports = { resolve, brandBlock, regionFacts, scrubForBrand, scrubHtmlForBrand, defaultBrand, isDefault };
