'use strict';
/**
 * mail-templates.js - the mail as a THEME x TEMPLATE (2026-10-26).
 *
 * The operator: "why does every brand mailer, video and ad have only one
 * common structure and layout", then "no complete different templates, themes
 * everything". calendar-trigger.js drew ONE document for every brand and every
 * send (logo, headline, picture, button, body, grid, strip, footer), varied
 * only by a few switches. This module draws the mail from the theme and the
 * template asset-themes.js chose for the brand and the send:
 *
 *   visual templates  stack | poster | split | magazine | catalogue | spotlight
 *   text templates    letter | memo | numbered
 *   themes            editorial | bold | soft | minimal | luxe | poster |
 *                     playful | magazine (asset-themes.THEMES)
 *
 * A theme brings shapes, never colours: every ground is the brand's own
 * (sectionGround / surface / surface_alt) and every text colour is derived for
 * AA against the ground it sits on. A measured design system (the brand's own
 * site) keeps its own headline and button tokens; the theme still decides the
 * structure, corners, frames, dividers, header and footer.
 *
 * Email rules held by every template: tables and inline CSS only, the logo
 * header linked home, the picture before the first button when there is a
 * picture, the legal sender and opt-out line in the footer, every fact once.
 * calendar-trigger.js computes the copy, palette and pieces; this file only
 * arranges them.
 */
const AT = require('./asset-themes.js');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * ctx: everything calendar-trigger computed. See its call for the keys.
 * Returns the full HTML document.
 */
function render(ctx) {
  const c = ctx;
  const T = c.design.theme;
  const visual = c.style === 'visual';
  const tpl = visual ? visualTemplate(c) : AT.fallback('text', c.design.template, () => true);
  const k = kit(c, T);
  const body = visual ? VISUAL[tpl](c, k) : textBody(c, k, tpl);
  return k.document(body, tpl);
}

/* The template this send can actually fill. */
function visualTemplate(c) {
  const pics = c.others.filter((p) => c.productImg(p)).length;
  const can = (t) => {
    // A mail with no picture of its own leads on the brand's ground (stack,
    // poster, catalogue); the others are built around the picture.
    const pic = !!(c.hero_image_url || c.hero_prompt);
    if (t === 'split' || t === 'spotlight') return !!c.hero_image_url;
    if (t === 'magazine') return pic;
    if (t === 'catalogue') return !(c.hero_prompt && !c.hero_image_url) && c.allProducts.filter((p) => c.productImg(p)).length >= 3;
    if (t === 'poster') return pic || pics >= 2;
    return true;
  };
  return AT.fallback('mail', c.design.template, can);
}

/* The themed building blocks. */
function kit(c, T) {
  const P = c.palette;
  const core = c.core;
  const rd = (bg, tgt) => (core ? core.readableAsText(P.green, bg, tgt || 4.5) : P.ink);
  const inkOn = (bg) => (core ? core.readableAsText(P.ink, bg, 4.5) : P.ink);
  const tile = P.tile;
  const X = {
    greenOnChalk: rd(P.chalk), greenOnTile: rd(tile), inkOnTile: inkOn(tile),
    mutedOnTile: core ? core.readableAsText(P.mutedOnSurface, tile, 4.5) : P.ink,
  };
  const PADX = AT.pad(T);
  const V = T.density === 'airy' ? 34 : (T.density === 'compact' ? 18 : 26);
  const ALIGN = T.align;
  const R = T.radius;
  const HEAD = c.HEAD, BODY = c.BODY;
  const E = c.E;
  const upper = T.heading.case === 'upper';

  const h = (base, color, margin, align) => (E && E.h1
    ? c.h1With('', margin, color) + `text-align:${align || ALIGN};`
    : AT.headingCss(T, base, HEAD, color) + `margin:${margin};text-align:${align || ALIGN};`);

  const eyebrow = (text, onBand, align) => {
    if (!text || T.eyebrow === 'none') return '';
    const col = onBand ? P.onGreen : P.greenText;
    const a = align || ALIGN;
    const base = `font-family:${BODY};font-size:12px;font-weight:700;text-transform:uppercase;`;
    let inner;
    if (T.eyebrow === 'chip') inner = `<span style="display:inline-block;${base}letter-spacing:0.08em;background:${onBand ? P.chalk : tile};color:${onBand ? X.greenOnChalk : X.greenOnTile};padding:6px 12px;border-radius:${Math.min(R.button, 999)}px;">${text}</span>`;
    else if (T.eyebrow === 'rule') inner = `<span style="display:inline-block;width:28px;height:2px;line-height:2px;font-size:1px;background:${col};vertical-align:middle;margin-right:10px;">&nbsp;</span><span style="${base}letter-spacing:0.14em;color:${col};vertical-align:middle;">${text}</span>`;
    else if (T.eyebrow === 'spaced') inner = `<span style="${base}font-weight:500;letter-spacing:0.32em;color:${col};">${text}</span>`;
    else inner = `<span style="${base}letter-spacing:0.14em;color:${col};">${text}</span>`;
    return `<div data-mail-eyebrow style="margin:0 0 12px;text-align:${a};">${inner}</div>`;
  };

  // The primary button, in the theme's shape. On a brand band it inverts to
  // the surface with the band colour as its label.
  const button = (label, href, onBand, align) => {
    const a = align || ALIGN;
    if (E && E.button && !onBand) return `<a href="${href}" data-ds="button-primary" style="${c.ctaStyle}${E.button.radius != null ? '' : `border-radius:${R.button}px;`}">${esc(label)}</a>`;
    const bg = onBand ? P.chalk : P.green;
    const fg = onBand ? X.greenOnChalk : P.onGreen;
    const ls = upper ? 'letter-spacing:0.16em;text-transform:uppercase;' : 'letter-spacing:0.02em;';
    const font = `font-family:${BODY};font-weight:700;text-decoration:none;`;
    switch (T.button) {
      case 'block':
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:${bg};padding:17px 16px;"><a href="${href}" data-ds="button-primary" style="display:block;${font}font-size:14px;letter-spacing:0.16em;text-transform:uppercase;color:${fg};">${esc(label)}</a></td></tr></table>`;
      case 'pill':
        return `<a href="${href}" data-ds="button-primary" style="display:inline-block;background:${bg};color:${fg};${font}font-size:16px;${ls}padding:15px 36px;border-radius:999px;">${esc(label)}</a>`;
      case 'outline': {
        const col = onBand ? P.onGreen : P.greenText;
        return `<a href="${href}" data-ds="button-primary" style="display:inline-block;background:transparent;color:${col};border:2px solid ${col};${font}font-size:14px;${ls}padding:13px 30px;border-radius:${R.button}px;">${esc(label)}</a>`;
      }
      case 'link':
        return `<a href="${href}" data-ds="button-primary" style="display:inline-block;background:${bg};color:${fg};${font}font-size:15px;padding:12px 22px;border-radius:${R.button}px;">${esc(label)}&nbsp;&rarr;</a>`;
      default:
        return `<a href="${href}" data-ds="button-primary" style="display:inline-block;background:${bg};color:${fg};${font}font-size:15px;${ls}padding:14px 30px;border-radius:${R.button}px;">${esc(label)}</a>`;
    }
  };
  const secondary = (onBand) => {
    if (!c.collection_url) return '';
    const col = onBand ? P.onGreen : P.greenText;
    return `<div style="margin-top:12px;"><a href="${esc(c.collection_url)}" target="_blank" style="font-family:${BODY};font-size:14px;font-weight:700;color:${col};text-decoration:underline;">Explore the collection</a></div>`;
  };
  const ctaRow = (pad, onBand, align) => `<tr><td align="${align || ALIGN}" style="padding:${pad};${onBand ? `background:${P.green};` : ''}">${button(c.cta_text, c.baseUrl, onBand, align)}${secondary(onBand)}</td></tr>`;

  const divider = () => {
    switch (T.divider) {
      case 'hairline': return `<tr><td style="padding:${V}px ${PADX}px 0;"><div style="height:1px;line-height:1px;font-size:1px;background:${c.border};">&nbsp;</div></td></tr>`;
      case 'thick': return `<tr><td align="${ALIGN}" style="padding:${V}px ${PADX}px 0;"><div style="width:56px;height:4px;line-height:4px;font-size:1px;background:${P.lava};${ALIGN === 'center' ? 'margin:0 auto;' : ''}">&nbsp;</div></td></tr>`;
      case 'double': return `<tr><td style="padding:${V}px ${PADX + 40}px 0;"><div style="height:1px;line-height:1px;font-size:1px;background:${P.greenText};">&nbsp;</div><div style="height:3px;line-height:3px;font-size:1px;">&nbsp;</div><div style="height:1px;line-height:1px;font-size:1px;background:${P.greenText};">&nbsp;</div></td></tr>`;
      case 'dots': return `<tr><td align="center" style="padding:${V}px ${PADX}px 0;font-family:${BODY};font-size:20px;line-height:1;letter-spacing:0.6em;color:${P.greenText};">&bull;&bull;&bull;</td></tr>`;
      default: return '';
    }
  };

  // How a picture is framed.
  const picture = (src, alt, opts) => {
    const o = opts || {};
    const w = o.width || 600;
    const mode = o.mode || T.image;
    const hero = o.hero ? ' data-mail-hero' : '';
    const imgCss = (r, extra) => `display:block;width:100%;height:auto;max-height:${o.maxH || 440}px;object-fit:${o.fit || 'contain'};border:0;margin:0 auto;border-radius:${r}px;${extra || ''}`;
    const link = (inner) => `<a href="${c.baseUrl}" target="_blank" style="display:block;text-decoration:none;">${inner}</a>`;
    if (mode === 'bleed') return link(`<img${hero} src="${esc(src)}" width="${w}" alt="${alt}" style="${imgCss(0)}" />`);
    if (mode === 'framed') return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${P.greenText};"><tr><td style="padding:10px;">${link(`<img${hero} src="${esc(src)}" width="${w - 20}" alt="${alt}" style="${imgCss(0)}" />`)}</td></tr></table>`;
    if (mode === 'inset') return link(`<img${hero} src="${esc(src)}" width="${w}" alt="${alt}" style="${imgCss(R.image, `border:1px solid ${c.border};`)}" />`);
    return link(`<img${hero} src="${esc(src)}" width="${w}" alt="${alt}" style="${imgCss(mode === 'square' ? Math.min(R.image, 4) : R.image)}" />`);
  };
  const picPad = (mode) => ((mode || T.image) === 'bleed' ? '0' : `${Math.round(V * 0.7)}px ${PADX}px 0`);

  // A product card in the theme's treatment.
  const cardBox = () => {
    switch (T.card) {
      case 'tint': return { box: `background:${tile};border-radius:${R.card}px;overflow:hidden;`, ink: X.inkOnTile, muted: X.mutedOnTile, accent: X.greenOnTile, rule: '' };
      case 'band': return { box: `background:#ffffff;border:1px solid ${c.border};border-top:4px solid ${P.green};border-radius:${Math.min(R.card, 6)}px;overflow:hidden;`, ink: P.ink, muted: P.mutedOnSurface, accent: P.greenText, rule: `border-top:1px solid ${c.border};` };
      case 'frame': return { box: `background:#ffffff;border:2px solid ${P.greenText};overflow:hidden;`, ink: P.ink, muted: P.mutedOnSurface, accent: P.greenText, rule: `border-top:1px solid ${P.greenText};` };
      default: return { box: `background:#ffffff;border:1px solid ${c.border};border-radius:${R.card}px;overflow:hidden;`, ink: P.ink, muted: P.mutedOnSurface, accent: P.greenText, rule: `border-top:1px solid ${c.border};` };
    }
  };
  const priceTag = (price, on) => {
    if (!price) return '&nbsp;';
    const o = on || {};
    switch (T.price) {
      case 'pill': return `<span style="display:inline-block;background:${P.green};color:${P.onGreen};font-weight:700;padding:3px 10px;border-radius:999px;">${price}</span>`;
      case 'block': return `<span style="display:inline-block;background:${P.green};color:${P.onGreen};font-weight:800;padding:3px 8px;">${price}</span>`;
      case 'sticker': return `<span style="display:inline-block;background:${P.chalk};color:${X.greenOnChalk};border:2px solid ${X.greenOnChalk};font-weight:800;padding:3px 10px;border-radius:999px;">${price}</span>`;
      default: return `<span style="font-weight:700;color:${o.accent || P.greenText};">${price}</span>`;
    }
  };

  // Products side by side.
  const grid = (items, cols, title) => {
    if (items.length < 2) return '';
    const pic = cols === 3 ? 160 : 230;
    const cb = cardBox();
    const anyNote = items.some((p) => c.productNote(p));
    const card = (p) => {
      const img = c.productImg(p);
      const note = c.productNote(p);
      const price = c.money(p);
      return `<td data-mail-col${cols === 3 ? " data-mail-three" : ""} valign="top" width="${Math.floor(100 / cols)}%" style="width:${Math.floor(100 / cols)}%;padding:8px;">
          <a href="${esc(c.pdp(p))}" target="_blank" style="display:block;text-decoration:none;">
            <div data-mail-card style="${cb.box}">
              <div data-mail-pic style="height:${pic}px;text-align:center;">${img
    ? `<img data-mail-pic src="${esc(img)}" alt="${esc(p.title || p.n || '')}" width="${pic}" height="${pic}" style="display:block;width:100%;height:${pic}px;object-fit:cover;margin:0 auto;border:0;" />`
    : `<div role="presentation" style="height:${pic}px;line-height:${pic}px;background:${tile};color:${X.greenOnTile};font-family:${HEAD};font-size:44px;text-align:center;">${esc(String(p.title || p.n || '').trim().charAt(0).toUpperCase())}</div>`}</div>
              <div style="padding:12px 14px 16px;${cb.rule}text-align:${ALIGN};">
                <div style="font-family:${HEAD};font-size:15px;font-weight:700;color:${cb.ink};line-height:20px;height:40px;overflow:hidden;${upper ? 'text-transform:uppercase;letter-spacing:0.06em;font-size:13px;' : ''}">${esc(p.title || p.n || '')}</div>
                ${anyNote ? `<div style="font-family:${BODY};font-size:12px;color:${cb.muted};line-height:17px;height:34px;overflow:hidden;margin-top:4px;">${esc(note || '')}</div>` : ''}
                <div style="font-family:${BODY};font-size:14px;line-height:22px;margin-top:10px;">${priceTag(price, cb)}<span style="float:right;color:${cb.accent};text-decoration:underline;font-weight:600;">View</span></div>
              </div>
            </div>
          </a></td>`;
    };
    const rows = [];
    for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
    return `${title ? `<tr><td align="${ALIGN}" style="padding:${V + 4}px ${PADX}px 4px;">${eyebrow(esc(title), false) || `<div style="${h(19, P.greenText, '0').replace(/font-size:\d+px/, 'font-size:20px')}">${esc(title)}</div>`}</td></tr>` : ''}
      <tr><td style="padding:6px ${Math.max(8, PADX - 16)}px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${rows.map((r) => `<tr>${r.map(card).join('')}${r.length < cols ? `<td width="${Math.floor(100 / cols) * (cols - r.length)}%" colspan="${cols - r.length}"></td>` : ''}</tr>`).join('')}
        </table>
      </td></tr>`;
  };

  // Products as rows: picture beside the words, alternating when asked.
  const featureRows = (items, alternate) => items.map((p, i) => {
    const img = c.productImg(p);
    const price = c.money(p);
    const note = c.productNote(p);
    const left = !alternate || i % 2 === 0;
    const picTd = `<td data-mail-stack width="44%" valign="middle" style="width:44%;padding:0;">${img ? `<a href="${esc(c.pdp(p))}" target="_blank" style="display:block;"><img data-mail-pic src="${esc(img)}" alt="${esc(p.title || p.n || '')}" width="230" style="display:block;width:100%;height:auto;max-height:230px;object-fit:cover;border:0;border-radius:${R.image}px;" /></a>` : `<div role="presentation" style="height:160px;line-height:160px;background:${tile};color:${X.greenOnTile};font-family:${HEAD};font-size:44px;text-align:center;border-radius:${R.image}px;">${esc(String(p.title || p.n || '').trim().charAt(0).toUpperCase())}</div>`}</td>`;
    const txtTd = `<td data-mail-stack valign="middle" style="padding:${left ? '0 0 0 22px' : '0 22px 0 0'};text-align:left;">
        ${T.numbering ? `<div style="font-family:${HEAD};font-size:13px;font-weight:700;letter-spacing:0.12em;color:${P.greenText};margin:0 0 6px;">${String(i + 1).padStart(2, '0')}</div>` : ''}
        <div data-mail-item style="font-family:${HEAD};font-size:18px;line-height:1.3;font-weight:700;color:${P.ink};${upper ? 'text-transform:uppercase;letter-spacing:0.06em;font-size:15px;' : ''}">${esc(p.title || p.n || '')}</div>
        ${note ? `<div style="font-family:${BODY};font-size:13px;line-height:1.5;color:${P.mutedOnSurface};margin-top:6px;">${esc(note)}</div>` : ''}
        <div style="font-family:${BODY};font-size:15px;margin-top:10px;">${priceTag(price)}&nbsp;&nbsp;<a href="${esc(c.pdp(p))}" target="_blank" style="color:${P.greenText};font-weight:700;text-decoration:underline;">View</a></div>
      </td>`;
    return `<tr><td style="padding:${i ? 18 : V}px ${PADX}px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${left ? picTd + txtTd : txtTd + picTd}</tr></table></td></tr>`;
  }).join('');

  // The body copy, in the theme's alignment; numbered when the theme numbers.
  const blocks = (numbered, align) => (c.body_blocks || []).map((b, i) => {
    const para = (first) => `<p data-mail-body style="font-family:${BODY};font-size:15px;line-height:1.65;color:${P.ink};margin:${first ? 0 : '8px 0 0'};${c.JUSTIFY}">`;
    const text = esc(b.body || '').replace(/\n\n+/g, `</p>${para(false)}`).replace(/\n/g, '<br>');
    const num = numbered ? `<div style="font-family:${HEAD};font-size:30px;line-height:1;font-weight:${Math.max(600, T.heading.weight)};color:${P.greenText};margin:0 0 8px;">${String(i + 1).padStart(2, '0')}</div>` : '';
    return `<tr><td style="padding:${Math.round(V * 0.7)}px ${PADX}px 0;text-align:${align || ALIGN};">
      ${num}${b.heading ? `<p style="font-family:${HEAD};font-size:19px;line-height:1.3;font-weight:${Math.max(600, Math.min(800, T.heading.weight))};color:${P.greenText};margin:0 0 6px;${upper ? 'text-transform:uppercase;letter-spacing:0.08em;font-size:15px;' : ''}">${esc(b.heading)}</p>` : ''}
      ${para(true)}${text}</p>
    </td></tr>`;
  }).join('');

  // The brand's own promises.
  const promises = () => c.promises;
  const stripRow = () => {
    const ps = promises();
    if (ps.length < 2) return '';
    return `<tr><td style="padding:${V}px ${Math.max(16, PADX - 8)}px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${tile};border-radius:${R.card}px;"><tr>
          ${ps.map((x, i) => `<td align="center" valign="top" width="${Math.floor(100 / ps.length)}%" style="padding:18px 12px;${i ? `border-left:1px solid ${c.border};` : ''}">
            <div style="width:24px;height:3px;background:${P.lava};margin:0 auto 10px;line-height:3px;font-size:1px;">&nbsp;</div>
            <div style="font-family:${BODY};font-size:13px;line-height:1.45;color:${X.inkOnTile};font-weight:600;">${esc(x)}</div></td>`).join('')}
        </tr></table>
      </td></tr>`;
  };
  const promiseList = () => {
    const ps = promises();
    if (ps.length < 2) return '';
    return `<tr><td style="padding:${V}px ${PADX}px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${ps.map((x) => `<tr><td style="padding:12px 0;border-bottom:1px solid ${c.border};font-family:${BODY};font-size:14px;line-height:1.45;color:${P.ink};font-weight:600;text-align:${ALIGN};"><span style="color:${P.greenText};font-weight:800;">&#10003;</span>&nbsp;&nbsp;${esc(x)}</td></tr>`).join('')}</table>
      </td></tr>`;
  };
  const promiseLine = () => {
    const ps = promises();
    if (ps.length < 2) return '';
    return `<tr><td align="center" style="padding:${V}px ${PADX}px 0;font-family:${BODY};font-size:13px;line-height:1.6;color:${P.greenText};font-weight:700;">${ps.map(esc).join(' &nbsp;&bull;&nbsp; ')}</td></tr>`;
  };
  const shopBy = () => {
    if (c.offers.length < 2) return '';
    const col = P.greenText;
    return `<tr><td align="${ALIGN}" style="padding:${V}px ${PADX}px 0;">
        <div style="font-family:${BODY};font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${P.mutedOnSurface};margin:0 0 12px;">Shop by</div>
        ${c.offers.map((x) => `<a href="${esc(x.url)}" target="_blank" style="display:inline-block;margin:0 6px 8px 0;font-family:${BODY};font-size:13px;font-weight:700;color:${col};border:1.5px solid ${col};border-radius:${R.button}px;padding:9px 18px;text-decoration:none;">${esc(x.name)}</a>`).join('')}
      </td></tr>`;
  };

  // Header: the logo linked home, in the theme's place.
  const header = () => {
    const pad = `${T.density === 'airy' ? 26 : 18}px ${PADX}px ${T.density === 'airy' ? 10 : 6}px`;
    if (T.header === 'band' && !c.logoIsImage) {
      return `<tr><td style="background:${P.green};padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${c.logoHeader({ color: P.onGreen, align: 'center', pad: '20px 24px', taglineColor: P.onGreen })}</table></td></tr>`;
    }
    if (T.header === 'band') {
      return `<tr><td style="border-bottom:4px solid ${P.green};padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${c.logoHeader({ color: P.greenText, align: 'center', pad: '18px 24px 14px', taglineColor: P.mutedOnSurface })}</table></td></tr>`;
    }
    return c.logoHeader({ color: P.greenText, align: T.header === 'left' ? 'left' : 'center', pad, taglineColor: P.mutedOnSurface });
  };

  // Footer: the legal sender and the opt-out, in the theme's treatment.
  const footer = () => {
    const f = c.footer;
    const name = esc(f.name.toUpperCase());
    const mode = T.footer;
    if (mode === 'band') {
      return `<tr><td align="center" data-mail-footer style="background:${P.green};padding:22px 20px 28px;">
        <div style="font-family:${HEAD};font-size:14px;letter-spacing:0.24em;color:${P.onGreen};">${name}</div>
        ${f.claims.length ? `<div style="font-family:${BODY};font-size:11px;letter-spacing:0.05em;color:${P.onGreen};margin:8px 0;">${f.claims.join(' &middot; ')}</div>` : ''}
        <div style="font-family:${BODY};font-size:11px;color:${P.onGreen};line-height:1.7;">${f.legal}</div>
      </td></tr>`;
    }
    const bg = mode === 'tint' ? tile : '#ffffff';
    const ink = mode === 'tint' ? X.inkOnTile : P.mutedOnSurface;
    const head = mode === 'tint' ? X.greenOnTile : P.greenText;
    const a = mode === 'plain' ? 'left' : 'center';
    return `<tr><td align="${a}" data-mail-footer style="background:${bg};padding:${mode === 'tint' ? '24px' : '20px'} ${PADX}px 28px;${mode === 'rule' ? `border-top:1px solid ${c.border};` : ''}text-align:${a};">
        <div style="font-family:${HEAD};font-size:13px;letter-spacing:${mode === 'plain' ? '0.04em' : '0.2em'};color:${head};font-weight:700;">${name}</div>
        ${f.claims.length ? `<div style="font-family:${BODY};font-size:11px;letter-spacing:0.04em;color:${ink};margin:8px 0;">${f.claims.join(' &middot; ')}</div>` : ''}
        <div style="font-family:${BODY};font-size:11px;color:${ink};line-height:1.7;">${f.legal}</div>
      </td></tr>`;
  };

  // The document around the rows: the theme's ground.
  const document = (rows, tpl) => {
    const g = T.ground;
    const outerBg = g === 'brand' ? P.green : (g === 'open' ? '#ffffff' : P.chalk);
    const cardCss = g === 'open'
      ? 'background:#ffffff;'
      : (g === 'framed' ? `background:#ffffff;border:3px double ${P.greenText};`
        : (g === 'bands' ? `background:#ffffff;border:1px solid ${c.border};`
          : `background:#ffffff;border:1px solid ${c.border};border-radius:${R.card}px;overflow:hidden;`));
    const w = c.style === 'pure' ? 560 : 600;
    return `<!doctype html>
<html>${c.emailHead}<body style="margin:0;padding:0;background:${outerBg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${outerBg};">
  <tr><td align="center" style="padding:${g === 'open' ? '24px 8px' : '28px 12px'};">
    <table role="presentation" width="${w}" cellpadding="0" cellspacing="0" data-theme="${T.id}" data-template="${tpl}" style="${cardCss}">
      ${rows}
    </table>
  </td></tr>
</table>
</body></html>`;
  };

  return { T, P, X, PADX, V, ALIGN, R, h, eyebrow, button, secondary, ctaRow, divider, picture, picPad, grid, featureRows, blocks, stripRow, promiseList, promiseLine, shopBy, header, footer, document, upper };
}

/* ── The visual templates ──────────────────────────────────────────────── */
function heroParts(c, k, opts) {
  const o = opts || {};
  const P = k.P;
  const a = o.align || k.ALIGN;
  const eb = c.heroLabel ? k.eyebrow(c.heroLabel, o.onBand, a) : '';
  const color = o.onBand ? P.onGreen : P.greenText;
  const head = `${eb}<h1 data-ds="h1" style="${k.h(o.size || 30, color, '0', a)}">${esc(c.hero_headline)}</h1>`;
  const sub = c.hero_subline ? `<p data-ds="body" style="${c.subWith(`font-family:${c.BODY};font-size:16px;line-height:1.6;color:${o.onBand ? P.onGreen : P.ink};margin:0;`, '0')}${o.onBand ? `color:${P.onGreen};` : ''}text-align-last:${a === 'center' ? 'center' : 'left'};margin-top:14px;">${esc(c.hero_subline)}</p>` : '';
  return { head, sub };
}
function heroImageRow(c, k, mode, maxH) {
  if (c.hero_image_url) return `<tr><td align="center" style="padding:${k.picPad(mode)};">${k.picture(c.hero_image_url, c.heroAlt, { hero: true, mode, maxH, width: (mode || k.T.image) === 'bleed' ? 600 : 600 - 2 * k.PADX })}</td></tr>`;
  if (c.hero_prompt) return `<tr><td style="padding:20px ${k.PADX}px 0;">${c.assetSlot}</td></tr>`;
  return '';
}
function nameCaption(c, k) {
  const P = k.P;
  return (c.heroName && (c.hero_image_url || c.hero_prompt) ? `<tr><td align="${k.ALIGN}" style="padding:16px ${k.PADX}px 0;"><p data-mail-product style="font-family:${c.HEAD};font-size:17px;line-height:1.4;font-weight:700;color:${P.ink};margin:0;text-align:${k.ALIGN};">${esc(c.heroName)}</p></td></tr>` : '')
    + (c.caption ? `<tr><td align="${k.ALIGN}" style="padding:12px ${k.PADX}px 0;"><p data-mail-caption style="font-family:${c.BODY};font-size:14px;line-height:1.5;color:${P.mutedOnSurface};margin:0;text-align:${k.ALIGN};">${esc(c.caption)}</p></td></tr>` : '');
}
function closing(c, k, show) {
  return show ? k.ctaRow(`${k.V + 4}px ${k.PADX}px ${k.V}px`) : `<tr><td style="padding:0 0 ${k.V}px;font-size:1px;line-height:1px;">&nbsp;</td></tr>`;
}

const VISUAL = {
  // Headline, picture, button, the words, then what else there is.
  stack(c, k) {
    const hp = heroParts(c, k, { size: 30 });
    const noPic = !c.hero_image_url && !c.hero_prompt;
    const head = noPic
      ? `<tr><td style="padding:12px ${k.PADX}px 0;"><!-- Brand-palette hero block (no external image needed) --><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${k.P.green};border-radius:${k.R.card}px;"><tr><td style="padding:34px 26px;text-align:${k.ALIGN};">${heroParts(c, k, { onBand: true, size: 28 }).head}</td></tr></table></td></tr>`
      : `<tr><td style="padding:${k.V}px ${k.PADX}px 6px;">${hp.head}</td></tr>`;
    const grid = k.grid(c.gridItems(k.T.density === 'compact' ? 3 : 2), k.T.density === 'compact' ? 3 : 2, 'More to see');
    const strip = k.stripRow();
    return [c.offerBar, k.header(), head, heroImageRow(c, k), nameCaption(c, k),
      hp.sub ? `<tr><td style="padding:18px ${k.PADX}px 0;">${hp.sub}</td></tr>` : '',
      k.ctaRow(`${k.V - 4}px ${k.PADX}px 6px`), k.blocks(false), k.divider(), grid, strip, k.shopBy(),
      closing(c, k, !!(grid || strip)), k.footer()].join('');
  },
  // A poster: the brand's own ground with a big headline and the button, then
  // the picture standing on it, then the products as rows. The button is in
  // the band: under a 38px headline and the picture it fell below the first
  // screen of a small phone.
  poster(c, k) {
    const hp = heroParts(c, k, { onBand: true, size: 38, align: 'center' });
    const band = `<tr><td align="center" style="background:${k.P.green};padding:${k.V + 14}px ${k.PADX}px ${c.hero_image_url ? k.V + 40 : k.V + 14}px;"><!-- Brand-palette hero block -->${hp.head}${hp.sub}<div style="margin-top:22px;">${k.button(c.cta_text, c.baseUrl, true, 'center')}${k.secondary(true)}</div></td></tr>`;
    const pic = c.hero_image_url
      ? `<tr><td align="center" style="padding:0 ${k.PADX + 10}px;background:#ffffff;"><div style="margin-top:-28px;">${k.picture(c.hero_image_url, c.heroAlt, { hero: true, mode: k.T.image === 'bleed' ? 'rounded' : k.T.image, width: 600 - 2 * (k.PADX + 10) })}</div></td></tr>`
      : (c.hero_prompt ? `<tr><td style="padding:${k.V}px ${k.PADX}px 0;">${c.assetSlot}</td></tr>` : "");
    const rows = c.others.slice(0, 3);
    return [c.offerBar, k.header(), band, pic, nameCaption(c, k), k.promiseLine(),
      rows.length ? k.divider() + k.featureRows(rows, false) : '', k.blocks(false),
      closing(c, k, rows.length > 0), k.footer()].join('');
  },
  // Picture and words side by side, then a three-across row.
  split(c, k) {
    const hp = heroParts(c, k, { size: 26, align: 'left' });
    const hero = `<tr><td style="padding:${k.V}px ${k.PADX}px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td data-mail-stack width="50%" valign="middle" style="width:50%;padding:0 12px 0 0;">${k.picture(c.hero_image_url, c.heroAlt, { hero: true, mode: k.T.image === 'bleed' ? 'square' : k.T.image, width: 260, maxH: 340, fit: 'cover' })}</td>
        <td data-mail-stack valign="middle" style="padding:0 0 0 14px;text-align:left;">${hp.head}${hp.sub}<div style="margin-top:20px;">${k.button(c.cta_text, c.baseUrl, false, 'left')}</div></td>
      </tr></table></td></tr>`;
    return [c.offerBar, k.header(), hero, nameCaption(c, k), k.divider(), k.blocks(false),
      k.grid(c.gridItems(3), 3, 'More to see'), k.stripRow(), k.shopBy(), closing(c, k, true), k.footer()].join('');
  },
  // An article: headline and lead, the picture framed, numbered paragraphs,
  // products as alternating rows.
  magazine(c, k) {
    const hp = heroParts(c, k, { size: 32, align: 'left' });
    const head = `<tr><td style="padding:${k.V}px ${k.PADX}px 0;">${hp.head}${hp.sub}</td></tr>`;
    const rows = c.others.slice(0, 3);
    return [c.offerBar, k.header(), k.divider(), head, heroImageRow(c, k, k.T.image === 'bleed' ? 'inset' : k.T.image), nameCaption(c, k),
      k.ctaRow(`${k.V - 4}px ${k.PADX}px 0`, false, 'left'), k.blocks(true, "left"),
      rows.length ? k.divider() + k.featureRows(rows, true) : '', k.promiseList(), k.shopBy(),
      closing(c, k, rows.length > 0), k.footer()].join('');
  },
  // A catalogue: a short headline band, then every product pictured.
  catalogue(c, k) {
    // The headline on the brand's own ground, then every product pictured.
    const band = heroParts(c, k, { onBand: true, size: 28 });
    const head = `<tr><td style="background:${k.P.green};padding:${k.V + 6}px ${k.PADX}px;text-align:${k.ALIGN};"><!-- Brand-palette hero block -->${band.head}${band.sub}</td></tr>`;
    const items = c.allProducts.filter((p) => c.productImg(p)).slice(0, 4);
    const even = items.length >= 4 ? items.slice(0, 4) : items.slice(0, Math.min(3, items.length));
    return [c.offerBar, k.header(), head, k.grid(even, even.length === 3 ? 3 : 2, ''),
      k.ctaRow(`${k.V}px ${k.PADX}px 4px`), k.blocks(false), k.stripRow(), k.shopBy(),
      `<tr><td style="padding:0 0 ${k.V}px;font-size:1px;line-height:1px;">&nbsp;</td></tr>`, k.footer()].join('');
  },
  // One product in the spotlight: a framed card on the brand's tint.
  spotlight(c, k) {
    const P = k.P;
    const hero = c.heroRow;
    const price = hero ? c.money(hero) : '';
    const hp = heroParts(c, k, { size: 28, align: 'center' });
    const card = `<tr><td style="background:${P.tile};padding:${k.V}px ${Math.max(20, k.PADX - 6)}px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${c.border};border-radius:${k.R.card}px;"><tr><td align="center" style="padding:${k.V}px ${k.PADX - 8}px;">
        ${hp.head}
        <div style="margin:${k.V - 6}px 0 0;">${k.picture(c.hero_image_url, c.heroAlt, { hero: true, mode: k.T.image === 'bleed' ? 'rounded' : k.T.image, width: 600 - 2 * k.PADX - 20, maxH: 380 })}</div>
        ${c.heroName ? `<p data-mail-product style="font-family:${c.HEAD};font-size:18px;line-height:1.4;font-weight:700;color:${P.ink};margin:18px 0 0;text-align:center;">${esc(c.heroName)}</p>` : ''}
        ${price ? `<div style="font-family:${c.HEAD};font-size:30px;font-weight:800;color:${P.greenText};margin:10px 0 0;">${price}</div>` : ''}
        <div style="margin-top:20px;">${k.button(c.cta_text, c.baseUrl, false, 'center')}</div>
      </td></tr></table>
    </td></tr>`;
    return [c.offerBar, k.header(), card,
      c.caption ? `<tr><td align="center" style="padding:${k.V - 6}px ${k.PADX}px 0;"><p data-mail-caption style="font-family:${c.BODY};font-size:14px;line-height:1.5;color:${P.mutedOnSurface};margin:0;text-align:center;">${esc(c.caption)}</p></td></tr>` : '',
      hp.sub ? `<tr><td style="padding:${k.V - 6}px ${k.PADX}px 0;">${hp.sub}</td></tr>` : '',
      k.blocks(false), k.promiseList(), k.grid(c.gridItems(3), 3, 'More to see'), k.shopBy(),
      closing(c, k, c.gridItems(3).length >= 2), k.footer()].join('');
  },
};

/* ── The text templates ────────────────────────────────────────────────── */
function textBody(c, k, tpl) {
  const P = k.P;
  const pure = c.style === 'pure';
  const founder = c.style === 'founder';
  const head = `<h1 data-ds="h1" style="${k.h(pure ? 26 : 30, pure ? P.greenText : P.greenText, '0 0 10px')}">${esc(c.hero_headline)}</h1>`;
  const sub = c.hero_subline ? `<p data-ds="body" style="${c.subWith(`font-family:${c.BODY};font-size:15px;line-height:1.65;color:${P.ink};margin:0 0 18px;`, '0 0 18px')}">${esc(c.hero_subline)}</p>` : '';
  const signNote = founder ? `<p style="font-family:${c.BODY};font-size:13px;color:${P.mutedOnSurface};margin:0 0 6px;">A note from the ${esc(c.team)} team</p>` : '';
  // The Text type is typographic: its call to action is a link in words.
  const cta = pure
    ? `<p style="font-family:${c.BODY};font-size:15px;line-height:1.6;color:${P.ink};margin:8px 0 18px;text-align:${k.ALIGN};"><a href="${c.baseUrl}" data-ds="cta-link" style="color:${P.greenText};text-decoration:underline;font-weight:600;${c.E ? `font-family:${c.E.body};` : ''}">${esc(c.cta_text)} &rarr;</a></p>`
    : `<div style="margin:6px 0 18px;text-align:${k.ALIGN};">${k.button(c.cta_text, c.baseUrl, false)}</div>`;
  const bodyTxt = (b) => esc(b.body || '').replace(/\n\n+/g, '<br><br>').replace(/\n/g, '<br>');
  const para = `font-family:${c.BODY};font-size:15px;line-height:1.7;color:${P.ink};margin:0 0 14px;${c.JUSTIFY}`;
  let bodyHtml;
  if (tpl === 'memo') {
    // A memo: each heading in its own column beside its words.
    bodyHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${(c.body_blocks || []).map((b) => `<tr>
        <td data-mail-stack valign="top" width="30%" style="width:30%;padding:14px 14px 14px 0;border-top:1px solid ${c.border};font-family:${c.HEAD};font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${P.greenText};">${esc(b.heading || '')}</td>
        <td data-mail-stack valign="top" style="padding:14px 0;border-top:1px solid ${c.border};"><p data-mail-body style="${para}margin:0;">${bodyTxt(b)}</p></td></tr>`).join('')}</table>`;
  } else if (tpl === 'numbered') {
    bodyHtml = (c.body_blocks || []).map((b, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr>
        <td valign="top" width="44" style="width:44px;font-family:${c.HEAD};font-size:24px;line-height:1.2;font-weight:800;color:${P.greenText};">${i + 1}.</td>
        <td valign="top"><p data-mail-body style="${para}margin:0;">${b.heading ? `<strong style="color:${P.greenText};">${esc(b.heading)}</strong><br>` : ''}${bodyTxt(b)}</p></td></tr></table>`).join('');
  } else {
    bodyHtml = (c.body_blocks || []).map((b) => `<p data-mail-body style="${para}">${b.heading ? `<strong style="color:${P.greenText};">${esc(b.heading)}${/\n/.test(b.body || '') ? '' : ': '}</strong>${/\n/.test(b.body || '') ? '<br>' : ''}` : ''}${bodyTxt(b)}</p>`).join('');
  }
  const list = c.productList ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 4px;">${c.productList}</table>` : '';
  const grid = !pure && c.productGrid ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${c.productGrid}</table>` : '';
  const second = !pure && (list || grid || (c.body_blocks || []).length > 1)
    ? `<div style="margin:22px 0 4px;text-align:${k.ALIGN === 'center' ? 'center' : 'left'};">${k.button(c.cta_text, c.baseUrl, false)}</div>` : '';
  const coll = !pure && c.collection_url ? `<p style="font-family:${c.BODY};font-size:14px;margin:12px 0 0;text-align:${k.ALIGN === 'center' ? 'center' : 'left'};"><a href="${esc(c.collection_url)}" target="_blank" style="color:${P.greenText};font-weight:700;text-decoration:underline;">Explore the collection</a></p>` : '';
  const sign = pure || founder ? `<p style="font-family:${c.BODY};font-size:12px;color:${P.mutedOnSurface};margin:18px 0 0;">The ${esc(c.team)} team</p>` : '';
  const content = `<tr><td style="padding:${k.V - 6}px ${k.PADX}px 0;text-align:${k.ALIGN};">
      ${tpl === 'memo' ? `<div style="height:4px;line-height:4px;font-size:1px;background:${P.green};margin:0 0 18px;">&nbsp;</div>` : ''}
      ${head}${signNote}${sub}${cta}${bodyHtml}${list}${grid}${second}${coll}${sign}
    </td></tr>`;
  return [pure ? '' : c.offerBar, k.header(), k.divider(), content, k.footer()].join('');
}

module.exports = { render, visualTemplate };
