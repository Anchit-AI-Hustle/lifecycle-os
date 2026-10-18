'use strict';

/**
 * api/_shared/mailer-format.js — the ONE source of truth for the KNICKGASM
 * "lava standard" mailer format, reverse-engineered from the hand-authored
 * reference at
 *   lifecycle-campaigns/2026-07-03_week1/emails/2026-07-09_cohortB_anime-drop-launch.html
 *
 * Every mailer generator (lifecycle-mailer-build, smart-brain, the AI pipeline,
 * generate.js) routes its final HTML through here so the output is uniform:
 *
 *   1. A top-of-file subject-metadata comment block:
 *        <!--
 *        SUBJECT_PRIMARY: ...
 *        SUBJECT_ALT1: ...
 *        SUBJECT_ALT2: ...
 *        PREHEADER: ...
 *        -->
 *   2. Inline asset-generation prompt comments paired with a paste-placeholder,
 *      one per fillable slot, e.g.
 *        <!-- IMAGE GENERATION PROMPT (hero, displayed 600x400 - generate at 1200x800 for retina):
 *             ...prompt... -->
 *        <img src="PASTE_IMAGE_URL_HERE" ...>
 *      (kind ∈ IMAGE | VIDEO | GIF — placeholders below).
 *
 * These two markers are what the asset agent (asset-agent.js) parses to fill
 * real generated assets, and what makes a mailer "lava standard".
 */

const PLACEHOLDER = {
  image: 'PASTE_IMAGE_URL_HERE',
  video: 'PASTE_VIDEO_URL_HERE',
  gif: 'PASTE_GIF_URL_HERE',
};

// Single canonical parser regex, shared with asset-agent.js.
// Groups: 1=kind 2=slot 3=dispW 4=dispH 5=genW 6=genH 7=prompt
const ASSET_PROMPT_RE =
  /<!--\s*(IMAGE|VIDEO|GIF)\s+GENERATION\s+PROMPT\s*\(\s*([^,]+?)\s*,\s*displayed\s+(\d+)x(\d+)\s*-\s*generate at\s+(\d+)x(\d+)[^:]*:\s*([\s\S]*?)\s*--!?>/gi;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// The subject-metadata comment block. `alts` is an array (0-2 used).
function subjectMetaBlock({ subject, alts = [], preheader = '' } = {}) {
  // Neutralize BOTH HTML comment terminators (`-->` and `--!>`) so injected
  // content cannot break out of the comment.
  const clean = (s) => String(s ?? '').replace(/--!?>/g, '- ->').replace(/[\r\n]+/g, ' ').trim();
  const lines = ['<!--', `SUBJECT_PRIMARY: ${clean(subject)}`];
  if (alts[0]) lines.push(`SUBJECT_ALT1: ${clean(alts[0])}`);
  if (alts[1]) lines.push(`SUBJECT_ALT2: ${clean(alts[1])}`);
  lines.push(`PREHEADER: ${clean(preheader)}`, '-->');
  return lines.join('\n');
}

// Prepend the subject-metadata block to a mailer's HTML, idempotently.
function withSubjectMeta(html, meta) {
  const h = String(html || '');
  if (/<!--\s*\n?\s*SUBJECT_PRIMARY:/i.test(h)) return h; // already present
  return subjectMetaBlock(meta) + '\n' + h;
}

// The inline generation-prompt comment for one slot.
function assetPromptComment({ kind = 'image', slot = 'hero', displayW, displayH, prompt, negative_prompt } = {}) {
  const k = String(kind).toLowerCase();
  const genW = displayW * 2;
  const genH = displayH * 2;
  const label = k === 'video' ? 'VIDEO' : k === 'gif' ? 'GIF' : 'IMAGE';
  const body = String(prompt || '').replace(/--!?>/g, '- ->').trim() +
    (negative_prompt ? ` Avoid: ${String(negative_prompt).replace(/--!?>/g, '- ->').trim()}.` : '');
  return `<!-- ${label} GENERATION PROMPT (${slot}, displayed ${displayW}x${displayH} - generate at ${genW}x${genH} for retina):\n     ${body} -->`;
}

// A full fillable asset slot: prompt comment + <img> carrying the paste
// placeholder (or a real URL when one is already known). Works for image,
// video (poster frame) and gif — all render as <img> in email clients.
// `ground` is the BRAND's section ground the slot sits on (the caller's
// sectionGround()); with none the slot carries no background. It used to be
// tenant zero's red for every brand's mailer (2026-10-11).
function slotGround(ground) {
  const h = String(ground || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(h) && !/^#[0-9a-f]{3}$/i.test(h)) return '';
  try {
    const core = require('./brand-workspace-core.js');
    if (core.sectionGround && core.sectionGround(h) !== h) return '';
  } catch (_) { /* no rule available: a stated hex is the caller's */ }
  return `background:${h};`;
}
function assetSlot({ kind = 'image', slot = 'hero', displayW, displayH, prompt, negative_prompt, alt = '', existingUrl = '', ground = '' } = {}) {
  const k = String(kind).toLowerCase();
  const src = existingUrl || PLACEHOLDER[k] || PLACEHOLDER.image;
  const comment = assetPromptComment({ kind: k, slot, displayW, displayH, prompt, negative_prompt });
  const img = `<img src="${esc(src)}" width="${displayW}" height="${displayH}" alt="${esc(alt || slot)}" ` +
    `style="display:block;width:100%;max-width:${displayW}px;height:auto;border:0;${slotGround(ground)}" />`;
  return `${comment}\n${img}`;
}

// Which asset kinds a mailer HTML still needs filled (unresolved placeholders).
function pendingPlaceholders(html) {
  const h = String(html || '');
  return {
    image: (h.match(new RegExp(PLACEHOLDER.image, 'g')) || []).length,
    video: (h.match(new RegExp(PLACEHOLDER.video, 'g')) || []).length,
    gif: (h.match(new RegExp(PLACEHOLDER.gif, 'g')) || []).length,
  };
}

// Lava-standard conformance check (used by tests / QA).
function assertGoldStandard(html) {
  const h = String(html || '');
  const missing = [];
  if (!/SUBJECT_PRIMARY:/i.test(h)) missing.push('subject_metadata_header');
  if (!/PREHEADER:/i.test(h)) missing.push('preheader');
  return { ok: missing.length === 0, missing };
}

/**
 * Fluid-hybrid width for a finished mail (2026-10-17). Every mail the builders
 * produced was a FIXED 600px (or 560px) table, so on a 375px phone it scrolled
 * sideways. The container becomes width:100% up to its old width, and Outlook
 * on Windows (the Word engine ignores max-width) gets the old fixed width from
 * a table only it reads (<!--[if mso]>). Exactly one container, the shape every
 * builder here emits: <outer 100% table> <container> ... </container> </outer>.
 * Anything else is returned unchanged.
 */
function fluid(html) {
  const s = String(html || '');
  const re = /<table role="presentation"((?:\s+(?:border|cellpadding|cellspacing)="0")*)\s+width="(600|560)"([^>]*?)(?:\s+style="([^"]*)")?([^>]*)>/g;
  const hits = s.match(re);
  if (!hits || hits.length !== 1) return s;
  const closes = [];
  let i = -1;
  while ((i = s.indexOf('</table>', i + 1)) !== -1) closes.push(i);
  if (closes.length < 2) return s;
  const innerClose = closes[closes.length - 2];
  let w = 600;
  const opened = s.replace(re, (m, pre, width, mid, style, post) => {
    w = Number(width);
    // Every style attribute on the tag, merged: a builder that wrote two (one
    // for the width, one for the card's ground and border) lost the second, as
    // a browser keeps only the first attribute of a name (2026-10-17).
    const extra = [];
    const strip = (t) => String(t || '').replace(/\s+style="([^"]*)"/g, (_m, c) => { extra.push(c); return ''; });
    const midC = strip(mid), postC = strip(post);
    const css = [style || ''].concat(extra).join(';').replace(/(^|;)\s*(max-)?width\s*:[^;]*/gi, '').replace(/;{2,}/g, ';').replace(/^;+/, '');
    return `<!--[if mso]><table role="presentation" width="${w}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`
      + `<table role="presentation"${pre} width="100%"${midC} style="width:100%;max-width:${w}px;${css}"${postC}>`;
  });
  const shift = opened.length - s.length;
  const at = innerClose + shift + '</table>'.length;
  return mobile(opened.slice(0, at) + '<!--[if mso]></td></tr></table><![endif]-->' + opened.slice(at));
}

/**
 * A mail that reads on a phone (2026-10-17, measured on iPhone SE / 12 and
 * iPad sizes). Without a viewport meta a phone lays the mail out 980px wide and
 * shrinks it, so the copy read at about 40% of its size; and a square hero
 * photo the width of a phone pushed the button below the first screen. Adds
 * the viewport meta when the mail has none, and on a narrow screen caps the
 * hero photo (`data-mail-hero`) to a band (46% of a phone's width, 320px on a
 * tablet), cropped, so the logo, headline and
 * button sit in the first screen. Mail clients that ignore <style> keep the
 * full photo; nothing else changes.
 */
/** "a" or "an" before a name, by its first sound as far as its first letter tells. */
function article(name) {
  return /^[aeiou]/i.test(String(name || '').replace(/^[^A-Za-z]+/, '')) ? 'an' : 'a';
}

// Body copy in every mailer is set justified (the operator, 2026-10-17:
// "alignment must be justified in mailers"). A line before a <br> and the
// last line of a paragraph stay at the start edge (CSS text-align-last), so a
// list of short lines is not stretched. Headings, buttons and the footer keep
// their own alignment.
const JUSTIFY = 'text-align:justify;text-justify:inter-word;';

/**
 * A product's one line under its name on a card, in the STORE'S OWN words
 * (2026-10-18). A catalogue whose names are model codes ("John Jacobs JJ
 * S16880") describes each product on its own page ("Trendy Maroon Brown
 * Gradient Full Rim Round John Jacobs JJ Tints JJ S16880-C2 Sunglasses at
 * Lenskart."). That description, without the words the name already says,
 * the model code and the "at <store>" tail, is what a card can say: the
 * store's text, shortened by leaving words out, never by inventing any.
 * '' when it would say nothing new or runs past two short lines.
 */
function productLine(description, title, brandName) {
  let d = String(description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!d) return '';
  d = d.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, '');
  if (brandName) d = d.replace(new RegExp(`\\s+(at|from|by|on)\\s+${String(brandName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*$`, 'i'), '');
  // A short sentence is prose the store wrote: kept whole.
  if (d.length <= 64 && !/\d/.test(d) && d.split(' ').length >= 3) return d;
  const fold = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '');
  const said = new Set(String(title || '').split(/\s+/).map(fold).filter(Boolean));
  const keep = d.split(/\s+/).filter((w) => {
    const f = fold(w);
    if (!f || said.has(f)) return false;
    if (/\d/.test(w) && /[a-z]/i.test(w)) return false; // a model / colour code
    if (/^[A-Z]{1,3}$/.test(w)) return false;            // a range initialism
    return true;
  });
  const out = keep.join(' ').replace(/\s+/g, ' ').trim();
  if (!out || out.split(' ').length < 2 || out.length > 80) return '';
  return out;
}
const MOBILE_CSS = '<style data-mail-mobile>@media only screen and (max-width:1100px){img[data-mail-hero]{width:100%!important;height:auto!important;max-height:320px!important;object-fit:cover!important}}@media only screen and (max-width:480px){img[data-mail-hero]{max-height:46vw!important}div[data-mail-pic]{height:auto!important}img[data-mail-pic]{height:auto!important;aspect-ratio:1/1;object-fit:contain!important}}</style>';
function mobile(html) {
  let s = String(html || '');
  if (!s || !/<body\b/i.test(s)) return s;
  const add = (/name="viewport"/i.test(s) ? '' : '<meta name="viewport" content="width=device-width,initial-scale=1.0">')
    + (/data-mail-mobile/.test(s) ? '' : MOBILE_CSS);
  if (!add) return s;
  if (/<head\b[^>]*>/i.test(s)) return s.replace(/<head\b[^>]*>/i, (h) => h + (/charset/i.test(s) ? '' : '<meta charset="utf-8">') + add);
  return s.replace(/<html\b[^>]*>/i, (h) => h + '<head><meta charset="utf-8">' + add + '</head>');
}

/**
 * The brand's homepage, as a link a mailer header can carry: its website, else
 * the store a caller passes. https only; '' when the record names neither.
 */
function homepageOf(brand, fallback) {
  const raw = String((brand && brand.website) || '').trim() || String(fallback || '').trim();
  if (!raw || /^\[DATA REQUIRED/.test(raw)) return '';
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url.replace(/\/+$/, '/') : '';
}

const FREE_OFF = () => /^(0|false|off|no)$/i.test(String(process.env.FREE_GENERATION || '').trim());
const HTTPS = /^https:\/\/[^\s"'<>]+$/i;

/**
 * THE BRAND'S OWN LOGO, wherever its record holds it (2026-10-17, the
 * operator: "use the brand logos itself"). Only `logo_url` reached the mail
 * header, so 16 of the 40 starter brands - and every brand whose "Read my
 * site" logo was not pressed into that one field - got their name in type.
 * In order: the logo field; the logo the rendered read measured in the site's
 * header; an image of the brand's own site labelled as its logo; an uploaded
 * logo that is hosted; the site's own icon (favicon / app icon); and, with
 * nothing on the record but a website, the icon that website publishes,
 * fetched by a free keyless icon service. Nothing read off ANOTHER company's
 * site is ever used (the coherence rule's sameBrand). '' url when none.
 * @returns {{url:string, kind:'logo'|'icon'|'', source:string}}
 */
function logoSourceOf(brand) {
  const b = brand || {};
  const bd = b.brand_data || {};
  let coh = null;
  try { coh = require('./brand-coherence.js'); } catch (_) { coh = null; }
  const home = String(b.website || '').trim();
  const homeDom = coh && home ? coh.registrableDomain(coh.hostOf(/^https?:/i.test(home) ? home : `https://${home}`)) : '';
  const own = (page) => {
    if (!page || !coh || !homeDom) return true;            // no page recorded: the record's own value
    const d = coh.registrableDomain(coh.hostOf(String(page)));
    return !d || coh.sameBrand(d, homeDom);
  };
  const ok = (u) => HTTPS.test(String(u || '').trim());
  if (ok(b.logo_url)) return { url: String(b.logo_url).trim(), kind: 'logo', source: 'logo_url' };
  const ds = bd.design_system && bd.design_system.logo;
  if (ds && ok(ds.url) && own(ds.url)) return { url: ds.url, kind: 'logo', source: 'design_system.logo' };
  const assets = [].concat(Array.isArray(b.brand_assets) ? b.brand_assets : [], Array.isArray(bd.brand_assets) ? bd.brand_assets : []);
  const tagged = (re) => assets.find((a) => a && ok(a.url) && re.test(`${a.role || ''} ${a.type || ''} ${a.kind || ''}`) && own(a.found_on || a.page || a.url));
  const asLogo = tagged(/\b(logo|wordmark|brandmark)\b/i);
  if (asLogo) return { url: asLogo.url, kind: 'logo', source: 'brand_assets' };
  const files = bd.brand_files || {};
  const up = files.logo && (files.logo.hosted_url || files.logo.url);
  if (ok(up)) return { url: up, kind: 'logo', source: 'uploaded' };
  if (ok(b.favicon_url) && own(b.favicon_url)) return { url: b.favicon_url, kind: 'icon', source: 'favicon_url' };
  const icon = tagged(/\b(icon|favicon|apple-touch|app-icon)\b/i);
  if (icon) return { url: icon.url, kind: 'icon', source: 'brand_assets.icon' };
  if (homeDom && !FREE_OFF()) {
    const host = coh.hostOf(/^https?:/i.test(home) ? home : `https://${home}`);
    if (host) return { url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`, kind: 'icon', source: 'site-icon (free icon service)' };
  }
  return { url: '', kind: '', source: '' };
}

/**
 * The logo a mail client can SHOW. Gmail and Outlook do not render SVG in an
 * <img>, and most brand logos read off a website are SVG: an SVG logo goes
 * through a free, keyless image service that serves it as PNG (the same
 * free-generation switch as every other keyless rung). A data: URI is never a
 * mailer image (Gmail clips the message). '' when there is nothing to show.
 */
function emailLogo(brand) {
  const src = logoSourceOf(brand);
  const s = src.url;
  if (!s) return src;
  if (!/\.svg(?:$|[?#])/i.test(s)) return Object.assign({}, src, { url: s.slice(0, 500) });
  if (FREE_OFF()) return { url: '', kind: '', source: '' };
  return Object.assign({}, src, { url: `https://images.weserv.nl/?url=${encodeURIComponent(s)}&output=png&w=320` });
}
function emailLogoSrc(brand) { return emailLogo(brand).url; }

/**
 * The header every mailer opens with: the brand's logo (alt = its name, so a
 * reader with images off still sees who wrote), linked to the brand's
 * homepage. A brand with no showable logo gets its name as a wordmark, still
 * linked. `data-mail-logo` marks the row for the contract check.
 */
function logoMark({ brand, store = '', color = '', font = 'Arial,sans-serif', align = 'center', height = 56 } = {}) {
  const b = brand || {};
  const name = String(b.name || '').trim() || 'Brand';
  const href = homepageOf(b, store);
  const lg = emailLogo(b);
  const src = lg.url;
  // A logo is set at a header width; an icon (square) at an icon's size.
  const w = lg.kind === 'icon' ? 48 : 140;
  const mark = src
    ? `<img src="${esc(src)}" alt="${esc(name)}" width="${w}" style="display:${align === 'center' ? 'block;margin:0 auto' : 'block'};width:${w}px;max-width:${w}px;height:auto;max-height:${height}px;border:0;font-family:${font};font-size:18px;font-weight:700;color:${color};" />`
    : `<span style="font-family:${font};font-size:22px;letter-spacing:0.2em;font-weight:700;color:${color};">${esc(name.toUpperCase())}</span>`;
  const html = href ? `<a href="${esc(href)}" target="_blank" data-mail-logo-link style="text-decoration:none;display:inline-block;">${mark}</a>` : mark;
  return { html, kind: src ? 'image' : 'wordmark', href };
}

function logoHeader({ brand, store = '', color = '', font = 'Arial,sans-serif', align = 'center', pad = '20px 24px 12px', tagline = '', taglineColor = '' } = {}) {
  const m = logoMark({ brand, store, color, font, align });
  const tag = tagline ? `<div style="font-family:${font};font-size:12px;line-height:1.45;color:${taglineColor || color};margin-top:6px;">${esc(tagline)}</div>` : '';
  return `<tr><td align="${align}" data-mail-logo="${m.kind}" style="padding:${pad};">${m.html}${tag}</td></tr>`;
}

module.exports = {
  productLine,
  JUSTIFY,
  article,
  mobile,
  MOBILE_CSS,
  fluid,
  homepageOf,
  emailLogoSrc,
  emailLogo,
  logoSourceOf,
  logoHeader,
  logoMark,
  PLACEHOLDER,
  ASSET_PROMPT_RE,
  subjectMetaBlock,
  withSubjectMeta,
  assetPromptComment,
  assetSlot,
  pendingPlaceholders,
  assertGoldStandard,
};
