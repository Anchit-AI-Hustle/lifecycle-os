'use strict';
/**
 * generate-finish.js - the finishing passes the standalone generator was
 * missing (2026-10-23, audit item D9).
 * ---------------------------------------------------------------------------
 * Smart Brain holds every finished asset to the brand before it is shown:
 * the brand's banned words and dashes are scrubbed, units are spelled out,
 * a sentence claiming what the brand does not state is dropped
 * (copy-grounding), the asset is judged against its own contract
 * (asset-contracts) and the compliance gate (compliance-lint). The standalone
 * generator (api/ai/generate.js: mailer_full, landing_page, autofill, sms,
 * whatsapp, push ...) returned the model's answer with only the dash and
 * banned-phrase scrub. This module is the same set of passes for that route.
 *
 * Rules, the same as Smart Brain's:
 *   - Never rewrite a sentence: a line is kept, or it is dropped and the drop
 *     is recorded (`copy_grounding`).
 *   - No visible placeholder in a finished asset: a sentence carrying a
 *     DATA REQUIRED marker or an unfilled merge tag ({{...}}) is dropped and
 *     the gap goes to `data_gaps`; a raster image embedded as base64 is
 *     removed (assets reference hosted URLs); a link to "#" goes to the
 *     brand's own website when the record has one, else the link is removed
 *     (its words kept) and the gap recorded.
 *   - The contract and compliance verdicts are ATTACHED, never applied.
 *
 * NOT a function file (api/_shared/ is outside the Hobby 12-function cap).
 */

const MARKER = /\[DATA REQUIRED BEFORE LAUNCH:[^\]]*\]/i;
const MARKER_G = /\[DATA REQUIRED BEFORE LAUNCH:[^\]]*\]/gi;
const MERGE = /\{\{[^}]*\}\}|\{%[^%]*%\}/;
const RASTER_B64 = /data:image\/(?:png|jpe?g|webp|gif|avif|bmp|tiff?)\s*;\s*base64,/i;

function rt() { return require('./brand-runtime.js'); }
function grounding() { return require('./copy-grounding.js'); }
function sanitize(s) { try { const SM = require('./scenario-model.js'); return SM.sanitizeBrand ? SM.sanitizeBrand(String(s)) : String(s); } catch (_) { return String(s); } }

/** A new finishing report. */
function report() { return { scrubbed: 0, dropped: [], data_gaps: [], removed_images: 0, links_to_website: 0, links_removed: 0, merge_tags_removed: 0 }; }

/** The brand's own website, https, or ''. */
function websiteOf(brand) {
  const w = String((brand && brand.website) || '').trim();
  if (/^https:\/\//i.test(w)) return w.replace(/\/$/, '');
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(w)) return 'https://' + w.replace(/\/$/, '');
  return '';
}
function gapOf(brand, field) {
  const name = (brand && brand.name) || 'this brand';
  return `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${name}]`;
}

/** Prose: banned words, dashes and units for this brand, line breaks kept. */
function scrubProse(text, brand) {
  const s = String(text == null ? '' : text);
  const one = (line) => { try { return rt().scrubForBrand(sanitize(line), brand || null); } catch (_) { return sanitize(line); } };
  return s.split('\n').map((l) => (l.trim() ? one(l) : l)).join('\n');
}

/** Sentences of `text` without a marker or a merge tag; each dropped one is recorded. */
function dropPlaceholders(text, rep, field) {
  const s = String(text == null ? '' : text);
  if (!MARKER.test(s) && !MERGE.test(s)) return s;
  const parts = s.match(/[^.!?\n]+[.!?]*[ \t]*\n?|\n/g) || [s];
  const kept = [];
  for (const p of parts) {
    const m = p.match(MARKER);
    if (m) { rep.data_gaps.push(m[0]); rep.dropped.push({ field, text: p.trim(), why: 'names a fact the record does not hold' }); continue; }
    if (MERGE.test(p)) { rep.merge_tags_removed += 1; rep.dropped.push({ field, text: p.trim(), why: 'carries a merge tag nobody filled' }); continue; }
    kept.push(p);
  }
  return kept.join('').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * One copy string: scrubbed, placeholders dropped, then held to the brand's
 * facts (a sentence with a claim word the record does not back is dropped).
 */
function finishLine(text, ctx, field, ground) {
  if (typeof text !== 'string') return text;
  if (/^(https?:\/\/|\/)\S*$/i.test(text.trim())) return text;
  let out = dropPlaceholders(text, ctx.report, field);
  const before = out;
  out = scrubProse(out, ctx.brand);
  if (out !== before) ctx.report.scrubbed += 1;
  if (ground && out) {
    const dropped = [];
    out = grounding().groundText(out, ctx.facts, dropped, field);
    for (const d of dropped) ctx.report.dropped.push({ field: d.field, text: d.text, why: `claim words the record does not state: ${d.words.join(', ')}` });
  }
  return out;
}

/** Keys of a model answer that a customer reads, so they are held to the facts. */
const GROUND_KEYS = /^(subcopy|sub_copy|preheader|primary|primary_text|description|desc|sub|caption|body|text|hook|hero_sub|intro_paragraph|body_paragraph|notes|header|title|headline|overlay_headline|overlay_sub|line)$/i;
/** Keys that are not copy (ids, enums, prompts, urls, layout). */
const SKIP_KEYS = /(^id$|_id$|url|href|src|image|prompt|size|slot|type|layout|hero_type|format|enum|framework|archetype|market|budget|keywords|handle|color|palette|scores|risk_profile|hashtags|creator|place|obj$|^name$)/i;

/** Every customer-facing string of a parsed answer, finished in place. */
function finishDeep(node, ctx, key, path) {
  if (node == null) return node;
  if (typeof node === 'string') {
    if (SKIP_KEYS.test(key || '')) return node;
    return finishLine(node, ctx, path || key || 'text', GROUND_KEYS.test(key || ''));
  }
  if (Array.isArray(node)) {
    // A list of headlines / descriptions: a line the facts do not back is left out.
    const out = [];
    node.forEach((x, i) => {
      const v = finishDeep(x, ctx, key, `${path || key}[${i}]`);
      if (typeof x === 'string' && typeof v === 'string' && !v.trim() && x.trim()) return;
      out.push(v);
    });
    return out;
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) node[k] = finishDeep(node[k], ctx, k, path ? `${path}.${k}` : k);
  }
  return node;
}

/* ── HTML ────────────────────────────────────────────────────────────────── */

/** A finished HTML document: no base64 raster, no unfilled tag, no dead link, text held to the facts. */
function finishHtml(html, ctx) {
  const rep = ctx.report;
  let h = String(html == null ? '' : html);
  // 1. Base64 rasters: an <img> is removed, a CSS url() becomes none.
  h = h.replace(/<img\b[^>]*>/gi, (tag) => (RASTER_B64.test(tag) ? (rep.removed_images += 1, '') : tag));
  h = h.replace(/url\(\s*['"]?data:image\/(?:png|jpe?g|webp|gif|avif|bmp|tiff?)\s*;\s*base64,[^)]*\)/gi, () => { rep.removed_images += 1; return 'none'; });
  if (rep.removed_images) rep.data_gaps.push(gapOf(ctx.brand, 'hosted image URL (an embedded image was removed)'));
  // 2. Links to "#", to nothing or to an unfilled tag.
  const site = websiteOf(ctx.brand);
  h = h.replace(/<a\b([^>]*?)\bhref\s*=\s*("(?:#|\s*|\{\{[^"]*\}\}|\[DATA REQUIRED[^"]*)"|'(?:#|\s*|\{\{[^']*\}\})')([^>]*)>([\s\S]*?)<\/a>/gi, (all, pre, _href, post, inner) => {
    if (site) { rep.links_to_website += 1; return `<a${pre}href="${site}"${post}>${inner}</a>`; }
    rep.links_removed += 1;
    return `<span${pre.replace(/\s+$/, '')}${post}>${inner}</span>`;
  });
  if (rep.links_removed) rep.data_gaps.push(gapOf(ctx.brand, 'website'));
  // 3. Unfilled tags in attributes (src/href of anything else) are emptied.
  h = h.replace(/(\s(?:src|href|content|alt)\s*=\s*")\{\{[^"]*\}\}(")/gi, (all, a, b) => { rep.merge_tags_removed += 1; return `${a}${b}`; });
  // 4. Text: brand scrub (banned words, dashes, units) on the whole document,
  //    then each text run outside script/style held to the facts.
  try { h = rt().scrubHtmlForBrand(h, ctx.brand || null); } catch (_) { /* keep */ }
  h = h.replace(/(<(script|style|title|head)\b[\s\S]*?<\/\2>)|>([^<]+)</gi, (all, block, _tag, text) => {
    if (block) return block;
    if (!text || !/[A-Za-z]/.test(text)) return all;
    let out = dropPlaceholders(text, rep, 'html');
    if (/[.!?]/.test(out) || out.split(/\s+/).length >= 4) {
      const dropped = [];
      const g = grounding().groundText(out, ctx.facts, dropped, 'html');
      for (const d of dropped) rep.dropped.push({ field: 'html', text: d.text, why: `claim words the record does not state: ${d.words.join(', ')}` });
      if (dropped.length) out = g;
    }
    // Keep the run's own leading and trailing whitespace.
    const lead = (text.match(/^\s*/) || [''])[0];
    const trail = (text.match(/\s*$/) || [''])[0];
    return `>${out ? lead + out.trim() + trail : lead}<`;
  });
  // A marker left anywhere else (an attribute) is removed; the gap is recorded.
  h = h.replace(MARKER_G, (m) => { rep.data_gaps.push(m); return ''; });
  return h;
}

/* ── the checks, attached ────────────────────────────────────────────────── */

function complianceCtx(brand, market) {
  try { return require('./compliance-lint.js').contextFor({ brand: brand || null, market: market || '' }); } catch (_) { return null; }
}
/** contract_check and compliance_check for one asset, never applied to it. */
function judge(asset, ctx) {
  const out = {};
  try { out.contract_check = require('./asset-contracts.js').check(asset); } catch (e) { out.contract_check = { ok: true, contract: null, violations: [], blocking: 0, note: 'The contract check could not run: ' + String(e && e.message || e).slice(0, 120) }; }
  try {
    const cctx = ctx.compliance || (ctx.compliance = complianceCtx(ctx.brand, ctx.market));
    if (cctx) out.compliance_check = require('./compliance-lint.js').lint(asset, cctx);
  } catch (e) { out.compliance_check = { ok: true, verdict: 'warn', findings: [], note: 'The compliance gate could not run: ' + String(e && e.message || e).slice(0, 120) }; }
  return out;
}

/**
 * The finishing context for one request.
 * @param brand     the brand this request resolved
 * @param opts      { market, products: [{name|title, category, description}] }
 */
function context(brand, opts) {
  const o = opts || {};
  const ps = (Array.isArray(o.products) ? o.products : []).filter(Boolean);
  const product = ps.length ? {
    title: ps.map((p) => p.name || p.n || p.title || '').join(' '),
    category: ps.map((p) => p.category || p.type || '').join(' '),
    description: ps.map((p) => p.description || '').join(' '),
  } : {};
  let facts = null;
  try { facts = grounding().factsFor(brand || {}, product); } catch (_) { facts = { bag: new Set(), claims: [] }; }
  return { brand: brand || null, market: o.market || '', facts, report: report() };
}

/** The report as the response carries it. */
function summary(ctx) {
  const r = ctx.report;
  const out = {
    scrubbed: r.scrubbed, removed_images: r.removed_images, links_to_website: r.links_to_website, links_removed: r.links_removed, merge_tags_removed: r.merge_tags_removed,
    note: 'Finished as Smart Brain finishes an asset: brand scrub (banned words, dashes, units), unbacked claims and placeholders dropped, contract and compliance verdicts attached.',
  };
  return out;
}
function groundingOf(ctx) {
  const d = ctx.report.dropped;
  return d.length ? { dropped: d, note: `${d.length} line(s) were left out: they state something the brand's own record does not, or need a fact it does not hold.` } : { dropped: [] };
}
function gapsOf(ctx) { return [...new Set(ctx.report.data_gaps)]; }

module.exports = {
  context, finishLine, finishDeep, finishHtml, scrubProse, dropPlaceholders, judge, summary, groundingOf, gapsOf, websiteOf,
};
