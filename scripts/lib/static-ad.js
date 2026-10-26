'use strict';
/**
 * static-ad.js - the STATIC ad creative as its own document (2026-10-26).
 * ---------------------------------------------------------------------------
 * The operator: "why does every brand mailer, video and ad have only one
 * common structure and layout", then "no complete different templates, themes
 * everything". Every static ad, for every brand, was the same thing: the photo
 * with a dark gradient at the bottom carrying the headline, a proof chip and a
 * button, drawn by the console. This builds the creative itself, at its
 * placement ratio, in one of six TEMPLATES (asset-themes.js TEMPLATES.ad) and
 * one of the brand's THEMES:
 *   overlay  the photo full bleed, the type on a scrim of the brand's ground
 *   split    a panel of the brand's ground beside (or under) the photo
 *   framed   the photo framed on the brand's ground, the headline above it
 *   type     a typographic poster: the headline large, the photo small
 *   sticker  the photo with a round price sticker and a bold label strip
 *   band     the photo with a solid band of the brand's ground across it
 * A theme changes the type (case, weight, tracking, scale, italic), corners,
 * the button's shape, how the photo is framed, the eyebrow and divider, and
 * where the logo sits. It brings no colour: every ground is the brand's
 * palette through sectionGround (never a dark neutral), every text colour is
 * derived for AA (textOn / readableAsText), and type over a photograph sits on
 * a scrim whose opacity is COMPUTED so the text clears 4.5:1 over a white and
 * over a black photograph alike.
 *
 * Nothing here writes copy: headline, line, price, proof and button are the
 * ad's own. No photograph: the typographic template with no picture, and the
 * gap is returned in data_gaps, never printed on the ad. Pure, no I/O.
 * ---------------------------------------------------------------------------
 */

const core = require('../../api/_shared/brand-workspace-core.js');
const THEMES = require('../../api/_shared/asset-themes.js').THEMES;

const RATIOS = { '1:1': [1, 1], '4:5': [4, 5], '9:16': [9, 16], '1.91:1': [1.91, 1], '16:9': [16, 9] };
// Type size per ratio, as a share of the ad's width (a wide ad is short).
const K = { '1:1': 1, '4:5': 1, '9:16': 1.05, '1.91:1': 0.5, '16:9': 0.5 };
const TEMPLATE_IDS = ['overlay', 'split', 'framed', 'type', 'sticker', 'band'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const words = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
const httpsUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '');
const cssFont = (f, d) => String(f || d).replace(/"/g, "'").replace(/[;{}<>]/g, '');

function rgb(hex) {
  const h = String(hex || '').replace('#', '');
  const f = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h.slice(0, 6);
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; }
function mix(hex, toHex, a) {
  const x = rgb(hex), y = rgb(toHex);
  return '#' + x.map((v, i) => Math.round(v * a + y[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}
/**
 * The least opacity of `scrim` under which `text` clears `want` whatever the
 * photograph behind it is: checked against a white and a black photo, the two
 * extremes (contrast with a blend moves monotonically between them).
 */
function scrimAlpha(scrim, text, want) {
  for (let a = 0.5; a <= 1.0001; a += 0.02) {
    if (core.contrast(text, mix(scrim, '#ffffff', a)) >= want && core.contrast(text, mix(scrim, '#000000', a)) >= want) return Math.min(1, +a.toFixed(2));
  }
  return 1;
}

/** The colours of one ad, every one derived from the brand's own palette. */
function colours(p) {
  const pal = p || {};
  const surface = pal.surface || '#ffffff';
  const ink = pal.ink || '#222222';
  const ground = core.sectionGround(pal.primary, pal.accent, surface);
  const onGround = core.textOn(ground, surface, ink);
  // The page under a photograph, and type set on it.
  const onSurface = core.readableAsText(ink, surface, 4.5);
  const brandOnSurface = core.readableAsText(ground, surface, 4.5);
  // A button stands off what it sits on (1.5:1, the floor this repo uses for a
  // fill against its ground); else it takes the surface.
  const accent = pal.accent || ground;
  const btnOnGround = core.contrast(accent, ground) >= 1.5 ? accent : surface;
  const btnOnSurface = core.contrast(accent, surface) >= 1.5 ? accent : ground;
  return {
    surface, ink, ground, onGround, onSurface, brandOnSurface,
    btnOnGround, btnOnGroundText: core.textOn(btnOnGround, surface, ink),
    btnOnSurface, btnOnSurfaceText: core.textOn(btnOnSurface, surface, ink),
    accentOnGround: core.readableAsText(accent, ground, 3) || onGround,
    scrimA: scrimAlpha(ground, onGround, 4.5),
  };
}

/** The button in this theme's shape, for a ground of `on`: 'ground' | 'surface'. */
function button(theme, C, on, text, size) {
  if (!text) return '';
  const fill = on === 'ground' ? C.btnOnGround : C.btnOnSurface;
  const fg = on === 'ground' ? C.btnOnGroundText : C.btnOnSurfaceText;
  const line = on === 'ground' ? C.onGround : C.brandOnSurface;
  const base = `font-family:var(--body);font-weight:700;font-size:${size}cqw;line-height:1.1;text-decoration:none;display:inline-block;letter-spacing:${theme.heading.case === 'upper' ? '0.08em' : '0.01em'};text-transform:${theme.heading.case === 'upper' ? 'uppercase' : 'none'};`;
  if (theme.button === 'link') return `<span data-ad-text data-ad-cta style="${base}color:${line};border-bottom:0.4cqw solid ${line};padding:0 0 0.6cqw">${esc(text)} &rarr;</span>`;
  if (theme.button === 'outline') return `<span data-ad-text data-ad-cta style="${base}color:${line};border:0.4cqw solid ${line};padding:2.2cqw 4.6cqw;border-radius:${theme.radius.button}px">${esc(text)}</span>`;
  if (theme.button === 'block') return `<span data-ad-text data-ad-cta style="${base}display:block;text-align:center;background:${fill};color:${fg};padding:3cqw 4cqw;border-radius:0">${esc(text)}</span>`;
  const r = theme.button === 'pill' ? '999px' : `${theme.radius.button}px`;
  return `<span data-ad-text data-ad-cta style="${base}background:${fill};color:${fg};padding:2.4cqw 5cqw;border-radius:${r}">${esc(text)}</span>`;
}

function eyebrow(theme, text, color, ground, size) {
  if (!text || theme.eyebrow === 'none') return '';
  const base = `font-family:var(--body);font-size:${size}cqw;font-weight:700;line-height:1.3;margin:0 0 2cqw;color:${color};`;
  if (theme.eyebrow === 'chip') return `<div style="margin:0 0 2cqw"><span data-ad-text style="${base}display:inline-block;margin:0;padding:1cqw 2.6cqw;border-radius:999px;border:0.3cqw solid ${color}">${esc(text)}</span></div>`;
  if (theme.eyebrow === 'rule') return `<div data-ad-text style="${base}"><span style="display:inline-block;width:6cqw;height:0.4cqw;background:${color};vertical-align:middle;margin-right:2cqw"></span>${esc(text)}</div>`;
  if (theme.eyebrow === 'spaced') return `<div data-ad-text style="${base}letter-spacing:0.28em;text-transform:uppercase;font-weight:500">${esc(text)}</div>`;
  return `<div data-ad-text style="${base}letter-spacing:0.12em;text-transform:uppercase">${esc(text)}</div>`;
}

function divider(theme, color) {
  switch (theme.divider) {
    case 'hairline': return `<div aria-hidden="true" style="height:0.25cqw;width:14cqw;background:${color};margin:2.4cqw 0"></div>`;
    case 'thick': return `<div aria-hidden="true" style="height:1.2cqw;width:12cqw;background:${color};margin:2.4cqw 0"></div>`;
    case 'double': return `<div aria-hidden="true" style="height:1.1cqw;width:16cqw;border-top:0.25cqw solid ${color};border-bottom:0.25cqw solid ${color};margin:2.4cqw auto"></div>`;
    case 'dots': return `<div aria-hidden="true" style="font-size:3cqw;line-height:1;letter-spacing:1.4cqw;color:${color};margin:1.6cqw 0">&bull;&bull;&bull;</div>`;
    default: return '';
  }
}

function headline(theme, text, color, size, extra) {
  const h = theme.heading;
  return `<div data-ad-text data-ad-headline style="font-family:var(--head);font-size:${(size * h.scale).toFixed(2)}cqw;line-height:${h.case === 'upper' ? 1.04 : 1.1};font-weight:${h.weight};letter-spacing:${h.tracking};text-transform:${h.case === 'upper' ? 'uppercase' : 'none'};${h.italic ? 'font-style:italic;' : ''}color:${color};margin:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden;${extra || ''}">${esc(text)}</div>`;
}
const lineEl = (text, color, size) => (text ? `<div data-ad-text style="font-family:var(--body);font-size:${size}cqw;line-height:1.35;color:${color};margin:2cqw 0 0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden">${esc(text)}</div>` : '');
const priceEl = (text, color, size) => (text ? `<div data-ad-text data-ad-price style="font-family:var(--head);font-size:${size}cqw;font-weight:700;line-height:1.1;color:${color};margin:2.4cqw 0 0">${esc(text)}</div>` : '');

function logoEl(spec, color, size, onDark) {
  const name = words(spec.brandName);
  const src = /^https:\/\//i.test(String(spec.logo || '')) ? spec.logo : '';
  // A logo drawn for a light page may not read on the brand's ground: the name
  // stands in there, in the ground's own text colour.
  if (src && !onDark) return `<img data-ad-logo src="${esc(src)}" alt="${esc(name)}" style="height:${size * 1.4}cqw;width:auto;max-width:40cqw;display:block">`;
  return name ? `<div data-ad-text data-ad-logo style="font-family:var(--head);font-weight:700;font-size:${size}cqw;line-height:1;color:${color};letter-spacing:0.04em">${esc(name)}</div>` : '';
}

function photo(theme, src, alt, style) {
  const r = { bleed: 0, inset: theme.radius.image, rounded: theme.radius.image, square: 0, framed: 0 }[theme.image] || 0;
  return `<img data-ad-photo src="${esc(src)}" alt="${esc(alt)}" style="display:block;width:100%;height:100%;object-fit:cover;border-radius:${r}px;${style || ''}">`;
}

/** The template this ad can fill: no photograph means the typographic poster. */
function fit(template, hasImage) {
  if (!hasImage) return 'type';
  return TEMPLATE_IDS.includes(template) ? template : 'overlay';
}

/**
 * spec: { brandName, logo, ratio, headline, line, price, proof, cta, image,
 *   palette:{primary,accent,surface,ink}, fonts:{head,body}, fontsHref,
 *   theme (asset-themes theme or id), template, id }
 * Returns { html, template, theme, data_gaps }.
 */
function renderStaticAd(spec) {
  const s = spec || {};
  const theme = typeof s.theme === 'string' ? (THEMES[s.theme] || THEMES.minimal) : (s.theme && s.theme.heading ? s.theme : THEMES.minimal);
  const ratio = RATIOS[s.ratio] ? s.ratio : '1:1';
  const [rw, rh] = RATIOS[ratio];
  const k = K[ratio];
  const img = httpsUrl(s.image);
  const template = fit(s.template, !!img);
  const C = colours(s.palette);
  const head = cssFont(s.fonts && s.fonts.head, 'system-ui,sans-serif');
  const body = cssFont(s.fonts && s.fonts.body, head);
  const H = words(s.headline);
  const L = words(s.line) && words(s.line).toLowerCase() !== H.toLowerCase() ? words(s.line) : '';
  const P = words(s.price);
  const proof = words(s.proof);
  const cta = words(s.cta);
  const alt = H || words(s.brandName);
  const gaps = [];
  if (!img) gaps.push(`[DATA REQUIRED BEFORE LAUNCH: product image, ${words(s.brandName) || 'this brand'}${s.market ? ', ' + s.market : ''}]`);
  const pd = theme.density === 'airy' ? 8 : (theme.density === 'compact' ? 5 : 6.5);
  const align = theme.align === 'center' ? 'center' : 'left';
  const logoAt = theme.header === 'center' ? 'center' : (theme.header === 'band' ? 'band' : 'left');
  const wide = rw / rh > 1.2;
  const tall = rh / rw > 1.4;
  const sk = wide ? 0.6 : Math.max(0.8, k);
  const hs = 7.2 * k; // headline base size, in cqw
  const ls = 3.4 * sk; // line / button size
  const block = (on, extra, f) => {
    const fg = on === 'ground' ? C.onGround : C.onSurface;
    const brandFg = on === 'ground' ? C.onGround : C.brandOnSurface;
    return `<div data-ad-copy style="text-align:${align};${extra || ''}">${eyebrow(theme, proof, brandFg, on, 2.6 * sk)}${headline(theme, H, on === 'ground' ? C.onGround : C.brandOnSurface, hs * (f || 1))}${divider(theme, brandFg)}${wide || f ? '' : lineEl(L, fg, ls)}${priceEl(P, brandFg, 4.6 * k)}<div style="margin-top:3.6cqw">${button(theme, C, on, cta, ls)}</div></div>`;
  };
  const logoRow = (color, onDark) => {
    const el = logoEl(s, color, 3.6 * sk, onDark);
    if (!el) return '';
    return `<div data-ad-logo-row style="display:flex;justify-content:${logoAt === 'center' ? 'center' : 'flex-start'}">${el}</div>`;
  };
  const frameR = theme.radius.card;
  let inner = '';
  if (template === 'overlay') {
    // The photo full bleed; the type on the brand's ground as a scrim, solid
    // enough under every word for AA over any photograph.
    inner = `<div style="position:absolute;inset:0">${photo(Object.assign({}, theme, { image: 'bleed' }), img, alt)}</div>
<div style="position:absolute;top:${pd / 2}cqw;${logoAt === 'center' ? 'left:50%;transform:translateX(-50%);' : `left:${pd / 2}cqw;`}padding:2cqw 3cqw;background:${rgba(C.ground, C.scrimA)};border-radius:${frameR}px">${logoEl(s, C.onGround, 3.2 * sk, true)}</div>
<div data-ad-scrim style="position:absolute;left:0;right:0;bottom:0;padding:${pd}cqw;background:${rgba(C.ground, C.scrimA)};${frameR ? `margin:${pd / 2}cqw;border-radius:${frameR}px;` : ''}">${block('ground')}</div>`;
  } else if (template === 'split') {
    const dir = tall ? 'column' : 'row';
    const photoFirst = (s.seed || 0) % 2 === 0;
    const ph = `<div style="flex:${tall ? '0 0 56%' : '1 1 50%'};min-width:0;min-height:0;position:relative">${photo(Object.assign({}, theme, { image: 'bleed' }), img, alt)}</div>`;
    const panel = `<div data-ad-panel style="flex:1 1 50%;min-width:0;min-height:0;background:${C.ground};padding:${pd}cqw;display:flex;flex-direction:column;justify-content:center;gap:2cqw;overflow:hidden">${logoRow(C.onGround, true)}${block('ground', '', tall ? 0 : 0.7)}</div>`;
    inner = `<div style="position:absolute;inset:0;display:flex;flex-direction:${dir}">${photoFirst ? ph + panel : panel + ph}</div>`;
  } else if (template === 'framed') {
    const fr = theme.image === 'framed' ? `padding:1.6cqw;background:${C.surface};box-shadow:0 0 0 0.3cqw ${C.onGround};` : '';
    inner = `<div data-ad-panel style="position:absolute;inset:0;background:${C.ground};padding:${pd}cqw;display:flex;flex-direction:${wide ? 'row' : 'column'};gap:${pd / 1.5}cqw;align-items:stretch">
<div style="flex:${wide ? '1 1 46%' : '0 0 auto'};display:flex;flex-direction:column;justify-content:center;gap:2cqw;min-width:0">${logoRow(C.onGround, true)}<div data-ad-copy style="text-align:${align}">${eyebrow(theme, proof, C.onGround, 'ground', 2.6 * sk)}${headline(theme, H, C.onGround, hs * 0.9)}</div></div>
<div style="flex:1 1 auto;min-height:0;min-width:0;border-radius:${theme.radius.image}px;overflow:hidden;${fr}">${photo(theme, img, alt)}</div>
<div style="flex:0 0 auto;display:flex;align-items:center;justify-content:${align === 'center' ? 'center' : 'space-between'};gap:3cqw;flex-wrap:wrap">${P ? `<div data-ad-text data-ad-price style="font-family:var(--head);font-weight:700;font-size:${4.4 * k}cqw;color:${C.onGround}">${esc(P)}</div>` : ''}${button(theme, C, 'ground', cta, ls)}</div></div>`;
  } else if (template === 'type') {
    const corner = img ? `<div style="position:absolute;right:${pd}cqw;bottom:${pd}cqw;width:${wide ? 26 : 34}cqw;height:${wide ? 26 : 34}cqw;border-radius:${theme.image === 'rounded' ? '50%' : theme.radius.image + 'px'};overflow:hidden;border:0.8cqw solid ${C.surface}">${photo(Object.assign({}, theme, { image: 'square' }), img, alt)}</div>` : '';
    inner = `<div data-ad-panel style="position:absolute;inset:0;background:${C.ground};padding:${pd}cqw;display:flex;flex-direction:column;justify-content:space-between;gap:3cqw">
${logoRow(C.onGround, true)}
<div data-ad-copy style="text-align:${align};${img ? `max-width:${100 - 2 * pd - (wide ? 26 : 34) - 4}cqw;` : ''}">${eyebrow(theme, proof, C.onGround, 'ground', 2.8 * sk)}${headline(theme, H, C.onGround, hs * (img ? 1.05 : 1.35))}${divider(theme, C.onGround)}${wide ? '' : lineEl(L, C.onGround, ls)}</div>
<div style="text-align:${align};${img ? `padding-right:${wide ? 30 : 38}cqw;` : ''}">${priceEl(P, C.onGround, 5 * k)}<div style="margin-top:3cqw">${button(theme, C, 'ground', cta, ls)}</div></div></div>${corner}`;
  } else if (template === 'sticker') {
    const st = P || cta;
    inner = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:${C.surface}">
<div style="flex:1 1 auto;min-height:0;position:relative">${photo(Object.assign({}, theme, { image: 'bleed' }), img, alt)}
<div data-ad-sticker style="position:absolute;top:${pd}cqw;right:${pd}cqw;width:${24 * sk}cqw;height:${24 * sk}cqw;border-radius:50%;background:${C.btnOnSurface};display:flex;align-items:center;justify-content:center;text-align:center;transform:rotate(-8deg);padding:2cqw"><span data-ad-text ${P ? 'data-ad-price' : 'data-ad-cta'} style="font-family:var(--head);font-weight:800;font-size:${(P ? 5 : 3.6) * sk}cqw;line-height:1.05;color:${C.btnOnSurfaceText}">${esc(st)}</span></div>
<div style="position:absolute;top:${pd / 1.4}cqw;left:${pd / 1.4}cqw;padding:2cqw 3cqw;background:${C.surface};border-radius:${frameR}px">${logoEl(s, C.brandOnSurface, 3.2 * sk, false)}</div></div>
<div data-ad-panel style="flex:0 0 auto;background:${C.surface};padding:${pd * 0.8}cqw ${pd}cqw;border-top:${theme.divider === 'thick' ? '1.4cqw' : '0.5cqw'} solid ${C.ground};display:flex;align-items:center;justify-content:space-between;gap:4cqw">
<div style="min-width:0;text-align:left">${eyebrow(theme, proof, C.brandOnSurface, 'surface', 2.6 * sk)}${headline(theme, H, C.brandOnSurface, hs * 0.8)}</div>${P ? `<div style="flex:0 0 auto">${button(theme, C, 'surface', cta, ls)}</div>` : ''}</div></div>`;
  } else {
    // band: the photo, and a solid band of the brand's ground across it, at
    // the top or the bottom (the seed decides; the logo takes the other end).
    const top = (s.seed || 0) % 2 === 1;
    const bandEl = `<div data-ad-panel style="flex:0 0 auto;background:${C.ground};padding:${pd * 0.8}cqw ${pd}cqw;${theme.divider === 'thick' ? `border-${top ? 'bottom' : 'top'}:1.4cqw solid ${C.accentOnGround};` : ''}">${block('ground', `display:block`)}</div>`;
    const ph = `<div style="flex:1 1 auto;min-height:0;position:relative">${photo(Object.assign({}, theme, { image: 'bleed' }), img, alt)}<div style="position:absolute;${top ? 'bottom' : 'top'}:${pd / 1.4}cqw;${logoAt === 'center' ? 'left:50%;transform:translateX(-50%);' : `left:${pd / 1.4}cqw;`}padding:2cqw 3cqw;background:${C.ground};border-radius:${frameR}px">${logoEl(s, C.onGround, 3.2 * sk, true)}</div></div>`;
    inner = `<div style="position:absolute;inset:0;display:flex;flex-direction:column">${top ? bandEl + ph : ph + bandEl}</div>`;
  }
  const outer = theme.ground === 'framed' ? `box-shadow:inset 0 0 0 1.2cqw ${C.surface},inset 0 0 0 1.5cqw ${C.ground};` : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(words(s.brandName) || 'Ad')} static ad</title>
${/^https:\/\/fonts\.googleapis\.com\//.test(String(s.fontsHref || '')) ? `<link rel="stylesheet" href="${esc(s.fontsHref)}">` : ''}
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:${C.surface}}
:root{--head:${head};--body:${body}}
.ad{position:relative;width:100%;aspect-ratio:${rw}/${rh};container-type:inline-size;overflow:hidden;background:${C.surface};${outer}}
</style></head>
<body><div class="ad" data-template="${esc(template)}" data-theme="${esc(theme.id)}" data-ratio="${esc(ratio)}" data-ad-id="${esc(s.id || '')}" role="img" aria-label="${esc([H, P, cta].filter(Boolean).join(' · '))}">
${inner}
</div></body></html>`;
  return { html, template, theme: theme.id, data_gaps: gaps };
}

module.exports = { renderStaticAd, colours, scrimAlpha, TEMPLATE_IDS, RATIOS };
