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
    const css = String(style || '').replace(/(^|;)\s*(max-)?width\s*:[^;]*/gi, '').replace(/^;+/, '');
    return `<!--[if mso]><table role="presentation" width="${w}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`
      + `<table role="presentation"${pre} width="100%"${mid} style="width:100%;max-width:${w}px;${css}"${post}>`;
  });
  const shift = opened.length - s.length;
  const at = innerClose + shift + '</table>'.length;
  return opened.slice(0, at) + '<!--[if mso]></td></tr></table><![endif]-->' + opened.slice(at);
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
