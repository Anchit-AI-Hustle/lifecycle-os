'use strict';
/**
 * render-capture.js — what the browser measures, BY ROLE, on a rendered page.
 * ---------------------------------------------------------------------------
 * Every function here is passed to `page.evaluate()` and runs INSIDE the
 * rendered page, so each one is self-contained (Playwright serialises the
 * function source; a closure over this module would be undefined there).
 *
 * The parser (brand-extract.js) reads what a stylesheet DECLARES and has to
 * guess which declaration wins. This reads what the browser COMPUTED after the
 * cascade, after the site's own JavaScript ran (a theme set at runtime by an
 * inline script is just a computed value here), with the fonts that actually
 * loaded. Elements are found by the ROLE they play on the rendered page - the
 * filled control with the largest presence in the first screen is the primary
 * call to action whatever its class is called; the paragraph style carrying the
 * most text is body copy; the heading is the largest text near the top - never
 * by a selector name, which is exactly what made a utility-first site
 * (`class="text-4xl font-bold"`) unreadable to the parser.
 *
 * Every measurement carries the element's selector path, so a value can be
 * traced to the node it came from, and the chosen elements are tagged with
 * `data-lcos-role` so the Node side can screenshot them, hover them and focus
 * them without re-finding them.
 */

/* eslint-disable no-undef */

/**
 * The page, measured. `opts`: { cssNames: [custom-property names seen in the
 * stylesheets the network layer captured], maxImages }.
 */
function capturePage(opts) {
  const o = opts || {};
  const VW = window.innerWidth, VH = window.innerHeight;
  const out = {
    url: location.href, title: document.title, viewport: { w: VW, h: VH },
    roles: {}, custom_properties: {}, fonts: { faces: [] }, assets: {}, meta: {}, layout: {}, links: [], notes: [],
  };

  /* ── colour: every syntax the engine knows, to sRGB ─────────────────── */
  const cv = document.createElement('canvas');
  cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  function rgba(css) {
    const s = String(css || '').trim();
    if (!s || s === 'transparent') return [0, 0, 0, 0];
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
    if (m) {
      let a = m[4] == null ? 1 : (String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return [+m[1], +m[2], +m[3], a];
    }
    // oklch(), color(srgb ...), lab() and the rest: the canvas converts.
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#010203';
    cx.fillStyle = s;
    if (cx.fillStyle === '#010203' && !/^#010203$/i.test(s)) return null;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  function hex(c) { return c ? '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]) : ''; }
  function over(top, under) {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a <= 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat([a]);
  }
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
  function lumRgb(c) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
  function contrastRgb(a, b) { const x = lumRgb(a), y = lumRgb(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  /*
   * A CALL TO ACTION IS A SHAPE THAT STANDS OFF THE PAGE. WCAG 1.4.11 asks a
   * UI component's boundary for 3:1 against what is next to it when nothing
   * else identifies it; brand buttons in pastels lean on their label, so 3:1
   * would reject real CTAs. 1.5:1 is the floor kept here: below it a fill is a
   * TINT of the page (a tab, a chip, a pale pill - one brand's "primary CTA"
   * was a #ecf0f4 tab at 1.15:1), not a control that asks to be pressed. A
   * border counts the same way for an outlined control.
   */
  const CONTROL_MIN_CONTRAST = Number(o.controlContrast) > 1 ? Number(o.controlContrast) : 1.5;

  /* ── consent containers: never measured, whatever hid them or not ────── */
  // Review finding from the 40-brand harvest (2026-10-04): one brand's primary
  // was measured on its cookie banner and another's accent came off a TrustArc
  // consent button. Every element inside a consent/cookie/CMP container is
  // excluded from EVERY role here, in the reader itself, whether or not the
  // freeze managed to hide it (render-stabilise CONSENT is the shared shape).
  const cc = o.consent || {};
  const C_NAMES = new RegExp(cc.names || '(consent|onetrust|cookiebot|didomi|truste|trustarc)', 'i');
  const C_WORDS = new RegExp(cc.words || '\\b(cookies?|consent)\\b', 'i');
  const structuralEl = (el) => el === document.body || el === document.documentElement || /^(MAIN|NAV|HEADER)$/.test(el.tagName) || !!el.querySelector('main,h1,nav,[role=navigation]');
  const consentRoots = [];
  try { if (cc.vendor) document.querySelectorAll(cc.vendor).forEach((el) => { if (!structuralEl(el)) consentRoots.push(el); }); } catch (_) { /* bad selector */ }
  try { document.querySelectorAll('[data-lcos-hidden]').forEach((el) => consentRoots.push(el)); } catch (_) { /* none */ }
  for (const el of (document.body ? document.body.querySelectorAll('*') : [])) {
    if (consentRoots.some((r) => r.contains(el))) continue;
    const dialog = /^(dialog|alertdialog)$/i.test(el.getAttribute('role') || '') || el.getAttribute('aria-modal') === 'true' || el.tagName === 'DIALOG';
    const named = C_NAMES.test((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.getAttribute('aria-label') || ''));
    if (!dialog && !named) continue;
    if (structuralEl(el)) continue;
    if (!C_WORDS.test(String(el.textContent || '').slice(0, 1500)) && !named) continue;
    if (dialog && !named && !C_WORDS.test(String(el.textContent || '').slice(0, 1500))) continue;
    consentRoots.push(el);
    if (consentRoots.length > 30) break;
  }
  function inConsent(el) { for (const r of consentRoots) if (r === el || r.contains(el)) return true; return false; }
  out.consent_excluded = consentRoots.slice(0, 12).map((el) => ({ tag: el.tagName.toLowerCase(), id: el.id || '', cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60) }));

  /* ── element helpers ─────────────────────────────────────────────────── */
  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (inConsent(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.05) return false;
    let n = el;
    for (let i = 0; n && i < 30; i++, n = n.parentElement) {
      const t = getComputedStyle(n);
      if (t.display === 'none' || parseFloat(t.opacity) < 0.05) return false;
    }
    return true;
  }
  function cssId(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c); }
  function path(el) {
    const parts = [];
    let n = el;
    for (let i = 0; n && n.nodeType === 1 && i < 5; i++, n = n.parentElement) {
      let p = n.tagName.toLowerCase();
      if (n.id && !/\d{4,}/.test(n.id)) { parts.unshift(p + '#' + cssId(n.id)); break; }
      const cls = Array.from(n.classList || []).filter((c) => c.length < 40 && !/^lcos-/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.map(cssId).join('.');
      const sib = n.parentElement ? Array.from(n.parentElement.children).filter((x) => x.tagName === n.tagName) : [];
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(n) + 1) + ')';
      parts.unshift(p);
      if (n === document.body) break;
    }
    return parts.join(' > ');
  }
  function box(el) {
    const r = el.getBoundingClientRect();
    const r2 = (v) => Math.round(v * 100) / 100;
    return { x: r2(r.left + window.scrollX), y: r2(r.top + window.scrollY), w: r2(r.width), h: r2(r.height) };
  }
  /** The colour a viewer sees BEHIND `el` (itself included), and any image. */
  function ground(el) {
    const layers = [];
    let image = null;
    let n = el;
    while (n && n.nodeType === 1) {
      const s = getComputedStyle(n);
      if (!image && s.backgroundImage && s.backgroundImage !== 'none') {
        image = { value: s.backgroundImage.slice(0, 300), gradient: /gradient\(/.test(s.backgroundImage) && !/url\(/.test(s.backgroundImage), from: path(n) };
      }
      const c = rgba(s.backgroundColor);
      if (c && c[3] > 0) { layers.push({ c, from: n }); if (c[3] >= 0.999) break; }
      n = n.parentElement;
    }
    let col = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) col = over(layers[i].c, col);
    const from = layers.length ? layers[layers.length - 1].from : null;
    return { color: hex(col), image, from: from ? path(from) : 'canvas (no background declared)' };
  }
  /** A photograph or video drawn UNDER `el` (a hero heading on an image). */
  function underMedia(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.top > VH || r.bottom < 0) return null;
    const x = Math.min(VW - 1, Math.max(0, r.left + Math.min(r.width / 2, 20)));
    const y = Math.min(VH - 1, Math.max(0, r.top + Math.min(r.height / 2, 10)));
    for (const p of document.elementsFromPoint(x, y)) {
      if (p === el || el.contains(p)) continue;
      if (/^(IMG|VIDEO|CANVAS|PICTURE)$/.test(p.tagName)) return path(p);
    }
    return null;
  }
  function inChrome(el) { return !!el.closest('header,nav,footer,[role=banner],[role=navigation],[role=contentinfo]'); }
  function ownText(el) {
    let t = '';
    for (const c of el.childNodes) if (c.nodeType === 3) t += c.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }
  function textOf(el) { return String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); }
  /** The deepest element that carries the visible text of `el`. */
  function textCarrier(el) {
    let best = el, bestLen = ownText(el).length;
    for (const d of el.querySelectorAll('*')) {
      if (!visible(d)) continue;
      const l = ownText(d).length;
      if (l > bestLen) { best = d; bestLen = l; }
    }
    return best;
  }

  /* ── fonts: which family RENDERS, not which is declared or loaded ────── */
  const faces = [];
  try {
    document.fonts.forEach((f) => faces.push({ family: String(f.family).replace(/^["']|["']$/g, ''), weight: String(f.weight), style: f.style, status: f.status }));
  } catch (_) { /* no FontFaceSet */ }
  out.fonts.faces = faces.slice(0, 80);
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|math|emoji|fangsong|-apple-system|blinkmacsystemfont)$/i;
  const fams = (stack) => String(stack || '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const localSeen = {};
  function localAvailable(fam) {
    if (fam in localSeen) return localSeen[fam];
    const probe = 'mmmmmmmmmmlli1WQ@#&';
    const w = (font) => { cx.font = font; return cx.measureText(probe).width; };
    const ok = ['monospace', 'serif', 'sans-serif'].some((g) => w(`72px "${fam}", ${g}`) !== w(`72px ${g}`));
    localSeen[fam] = ok;
    return ok;
  }
  /** The first family in the stack the engine could actually draw with. */
  function usedFamily(stack) {
    for (const fam of fams(stack)) {
      if (GENERIC.test(fam)) return { family: fam, kind: 'generic' };
      const fs = faces.filter((f) => f.family.toLowerCase() === fam.toLowerCase());
      if (fs.length) {
        if (fs.some((f) => f.status === 'loaded')) return { family: fam, kind: 'webfont' };
        continue;   // declared as a web font and not loaded: the engine fell through
      }
      if (localAvailable(fam)) return { family: fam, kind: 'local' };
    }
    return { family: '', kind: 'none' };
  }

  /* ── one element's style, by what a design system needs ──────────────── */
  function typeOf(el) {
    const s = getComputedStyle(el);
    const used = usedFamily(s.fontFamily);
    const g = ground(el);
    const c = rgba(s.color) || [0, 0, 0, 1];
    const seen = c[3] < 1 ? over(c, rgba(g.color)) : c;
    return {
      stack: s.fontFamily, family: used.family, family_kind: used.kind,
      size: px(s.fontSize), weight: parseInt(s.fontWeight, 10) || s.fontWeight,
      line_height: s.lineHeight === 'normal' ? 'normal' : px(s.lineHeight),
      letter_spacing: s.letterSpacing === 'normal' ? 0 : px(s.letterSpacing),
      transform: s.textTransform, style: s.fontStyle, decoration: (s.textDecorationLine || s.textDecoration || '').split(' ')[0],
      align: s.textAlign, color: hex(seen), color_alpha: Math.round(c[3] * 100) / 100,
      text_shadow: s.textShadow === 'none' ? '' : s.textShadow,
    };
  }
  function boxStyle(el) {
    const s = getComputedStyle(el);
    const bg = rgba(s.backgroundColor) || [0, 0, 0, 0];
    const g = ground(el.parentElement || el);
    const seen = bg[3] > 0 ? over(bg, rgba(g.color)) : null;
    const bw = px(s.borderTopWidth) || 0;
    const bc = rgba(s.borderTopColor) || [0, 0, 0, 0];
    return {
      background: seen ? hex(seen) : '', background_alpha: Math.round(bg[3] * 100) / 100,
      background_image: s.backgroundImage && s.backgroundImage !== 'none' && !/url\(/.test(s.backgroundImage) ? s.backgroundImage.slice(0, 300) : '',
      ground: g.color,
      radius: px(s.borderTopLeftRadius), radius_all: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].map(px),
      border_width: s.borderTopStyle === 'none' ? 0 : bw, border_style: s.borderTopStyle,
      border_color: bw && bc[3] > 0 ? hex(over(bc, rgba(g.color))) : '',
      shadow: s.boxShadow === 'none' ? '' : s.boxShadow.slice(0, 200),
      padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(px),
      height: Math.round(el.getBoundingClientRect().height * 100) / 100,
      width: Math.round(el.getBoundingClientRect().width * 100) / 100,
      display: s.display, position: s.position,
      outline: s.outlineStyle === 'none' ? '' : `${s.outlineWidth} ${s.outlineStyle} ${hex(rgba(s.outlineColor))}`,
    };
  }
  function record(el, role, extra) {
    if (!el) return null;
    try { el.setAttribute('data-lcos-role', role); } catch (_) { /* read-only node */ }
    return Object.assign({ selector: path(el), box: box(el), text: textOf(el).slice(0, 160) }, extra || {});
  }

  /* ── surface (page ground) ──────────────────────────────────────────── */
  const bodyGround = ground(document.body);
  out.roles.surface = { color: bodyGround.color, from: bodyGround.from, image: bodyGround.image, selector: 'body' };

  /* ── text elements, once ────────────────────────────────────────────── */
  const all = Array.from(document.body.querySelectorAll('*'));
  const textEls = [];
  for (const el of all) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|PATH|OPTION|IFRAME)$/i.test(el.tagName)) continue;
    const t = ownText(el);
    if (t.length < 2) continue;
    if (!visible(el)) continue;
    textEls.push(el);
    if (textEls.length > 4000) break;
  }

  /* ── body copy: the paragraph style that carries the most text ───────── */
  const groups = new Map();
  for (const el of textEls) {
    const t = ownText(el);
    if (t.length < 30 || inChrome(el) || el.closest('a,button,[role=button],h1,h2,h3,h4,h5,h6,label')) continue;
    const s = getComputedStyle(el);
    const k = [s.fontFamily, s.fontSize, s.fontWeight, s.color, s.lineHeight].join('|');
    const g = groups.get(k) || { len: 0, el, n: 0 };
    g.len += t.length; g.n += 1;
    groups.set(k, g);
  }
  const bodyGroup = [...groups.values()].sort((a, b) => b.len - a.len)[0];
  if (bodyGroup) out.roles.body = record(bodyGroup.el, 'body', { type: typeOf(bodyGroup.el), ground: ground(bodyGroup.el).color, chars: bodyGroup.len, occurrences: bodyGroup.n });

  /* ── muted text: readable copy in a colour distinct from body copy ─── */
  if (bodyGroup) {
    const bodyColour = typeOf(bodyGroup.el).color;
    // Muted means QUIETER than body copy: less contrast against its ground.
    // A darker colour (a heading ink reused on a caption) is not secondary text.
    const lumOf = (h) => { const c = rgba(h) || [0, 0, 0, 1]; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const bodyRatio = ratio(bodyColour, ground(bodyGroup.el).color);
    const mg = new Map();
    for (const el of textEls) {
      const t = ownText(el);
      if (t.length < 12 || el.closest('a,button,[role=button],h1,h2,h3')) continue;
      const tp = typeOf(el);
      if (tp.color === bodyColour) continue;
      if (ratio(tp.color, ground(el).color) >= bodyRatio) continue;
      const g = mg.get(tp.color) || { len: 0, el };
      g.len += t.length; mg.set(tp.color, g);
    }
    const best = [...mg.values()].sort((a, b) => b.len - a.len)[0];
    if (best && best.len >= 40) out.roles.muted = record(best.el, 'muted', { type: typeOf(best.el), chars: best.len });
  }

  /* ── headings ───────────────────────────────────────────────────────── */
  const headings = {};
  for (const lvl of [1, 2, 3, 4, 5, 6]) {
    const el = Array.from(document.querySelectorAll('h' + lvl)).find((h) => visible(h) && textOf(h).length > 0 && !h.closest('footer,[role=contentinfo]'));
    if (el) headings['h' + lvl] = record(el, 'h' + lvl, { type: typeOf(textCarrier(el)), ground: ground(el).color, over_media: underMedia(el) });
  }
  // The DISPLAY text: the largest type near the top, whatever tag carries it.
  let display = null, dSize = 0;
  for (const el of textEls) {
    const r = el.getBoundingClientRect();
    if (r.top + window.scrollY > VH * 1.6 || inChrome(el) || el.closest('button,[role=button]')) continue;
    const t = ownText(el);
    if (t.length > 160) continue;
    const sz = parseFloat(getComputedStyle(el).fontSize) || 0;
    if (sz > dSize) { dSize = sz; display = el; }
  }
  if (display) out.roles.display = record(display, 'display', { type: typeOf(display), ground: ground(display).color, over_media: underMedia(display), tag: display.tagName.toLowerCase() });
  out.roles.headings = headings;

  /* ── header, logo, nav ───────────────────────────────────────────────── */
  let header = Array.from(document.querySelectorAll('header,[role=banner]')).find((h) => visible(h) && h.getBoundingClientRect().top < 200 && h.getBoundingClientRect().width >= VW * 0.8);
  if (!header) {
    header = all.find((el) => {
      if (!visible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.top < 20 && r.width >= VW * 0.9 && r.height >= 30 && r.height <= 260 && el.querySelector('a');
    }) || null;
  }
  if (header) {
    const hs = boxStyle(header);
    out.roles.header = record(header, 'header', { style: hs, ground: ground(header).color, sticky: /sticky|fixed/.test(getComputedStyle(header).position) });
  }
  const scope = header || document.body;
  const homeLinks = Array.from(scope.querySelectorAll('a')).filter((a) => {
    try { const u = new URL(a.href, location.href); return u.origin === location.origin && (u.pathname === '/' || u.pathname === '') && visible(a); } catch (_) { return false; }
  });
  let logoEl = null, logoKind = '';
  for (const a of homeLinks) {
    const m = a.querySelector('img,svg,picture img');
    if (m && visible(m)) { logoEl = m; logoKind = m.tagName.toLowerCase() === 'svg' ? 'svg' : 'img'; break; }
  }
  if (!logoEl) {
    const m = scope.querySelector('[class*=logo i] img,[class*=logo i] svg,img[alt*=logo i],[id*=logo i] img,[id*=logo i] svg');
    if (m && visible(m)) { logoEl = m; logoKind = m.tagName.toLowerCase() === 'svg' ? 'svg' : 'img'; }
  }
  if (!logoEl && homeLinks[0] && textOf(homeLinks[0]).length > 1) { logoEl = homeLinks[0]; logoKind = 'text'; }
  if (logoEl) {
    const r = logoEl.getBoundingClientRect();
    const hb = header ? header.getBoundingClientRect() : null;
    const centre = hb ? Math.abs((r.left + r.width / 2) - (hb.left + hb.width / 2)) < hb.width * 0.12 : false;
    out.roles.logo = record(logoEl, 'logo', {
      kind: logoKind,
      src: logoKind === 'img' ? (logoEl.currentSrc || logoEl.src || '') : '',
      natural: logoKind === 'img' ? { w: logoEl.naturalWidth || 0, h: logoEl.naturalHeight || 0 } : null,
      rendered: { w: Math.round(r.width), h: Math.round(r.height) },
      placement: centre ? 'center' : (hb && r.left - hb.left < hb.width * 0.4 ? 'left' : 'right'),
      inline_svg: logoKind === 'svg' ? String(logoEl.outerHTML || '').slice(0, 60000) : '',
      svg_fill: logoKind === 'svg' ? (() => { const f = logoEl.querySelector('[fill]:not([fill=none])'); const c = f ? rgba(getComputedStyle(f).fill) : null; return c && c[3] > 0 ? hex(c) : ''; })() : '',
      type: logoKind === 'text' ? typeOf(textCarrier(logoEl)) : null,
    });
  }
  // Nav links: the commonest link style in the header that is not the logo or a filled button.
  if (header) {
    const ng = new Map();
    for (const a of header.querySelectorAll('a')) {
      if (!visible(a) || (logoEl && (a.contains(logoEl) || a === logoEl)) || textOf(a).length < 2 || textOf(a).length > 40) continue;
      const bg = rgba(getComputedStyle(a).backgroundColor) || [0, 0, 0, 0];
      if (bg[3] > 0.5) continue;
      const tp = typeOf(textCarrier(a));
      const k = [tp.family, tp.size, tp.weight, tp.color, tp.transform].join('|');
      const g = ng.get(k) || { n: 0, el: a };
      g.n += 1; ng.set(k, g);
    }
    const nav = [...ng.values()].sort((a, b) => b.n - a.n)[0];
    if (nav) out.roles.nav_link = record(nav.el, 'nav-link', { type: typeOf(textCarrier(nav.el)), count: nav.n });
  }

  /* ── footer ─────────────────────────────────────────────────────────── */
  const footers = Array.from(document.querySelectorAll('footer,[role=contentinfo]')).filter(visible);
  const footer = footers[footers.length - 1] || null;
  if (footer) {
    const fg = new Map();
    for (const el of footer.querySelectorAll('*')) {
      if (!visible(el) || ownText(el).length < 2) continue;
      const tp = typeOf(el);
      const g = fg.get(tp.color) || { n: 0, el };
      g.n += ownText(el).length; fg.set(tp.color, g);
    }
    const t = [...fg.values()].sort((a, b) => b.n - a.n)[0];
    out.roles.footer = record(footer, 'footer', { style: boxStyle(footer), ground: ground(footer).color, text: t ? typeOf(t.el) : null });
  }

  /* ── controls: the primary and secondary call to action ──────────────── */
  const ctl = [];
  for (const el of document.querySelectorAll('a,button,input[type=submit],input[type=button],[role=button]')) {
    if (!visible(el)) continue;
    const label = el.tagName === 'INPUT' ? String(el.value || '') : textOf(el);
    if (label.length < 1 || label.length > 40) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 24 || r.height > 96 || r.width > VW * 0.9) continue;
    const s = getComputedStyle(el);
    const bg = rgba(s.backgroundColor) || [0, 0, 0, 0];
    const grad = s.backgroundImage && s.backgroundImage !== 'none' && /gradient\(/.test(s.backgroundImage);
    const g = rgba(ground(el.parentElement || el).color);
    const fillSeen = bg[3] > 0.5 ? over(bg, g) : null;
    const fillContrast = fillSeen ? contrastRgb(fillSeen, g) : 1;
    const filled = (bg[3] > 0.5 && fillContrast >= CONTROL_MIN_CONTRAST) || grad;
    const bw = s.borderTopStyle !== 'none' ? parseFloat(s.borderTopWidth) || 0 : 0;
    const bcol = rgba(s.borderTopColor) || [0, 0, 0, 0];
    const outlined = !filled && bw >= 1 && bcol[3] > 0.3 && contrastRgb(over(bcol, g), g) >= CONTROL_MIN_CONTRAST;
    if (!filled && !outlined) { if (bg[3] > 0.5) out.notes.push(`A control filled ${hex(fillSeen)} at ${Math.round(fillContrast * 100) / 100}:1 against the page was not taken as a call to action (under ${CONTROL_MIN_CONTRAST}:1).`); continue; }
    const top = r.top + window.scrollY;
    const fold = top < VH ? 1.6 : (top < VH * 2 ? 1 : 0.6);
    const rgb = bg[3] > 0 ? bg : g;
    const mx = Math.max(rgb[0], rgb[1], rgb[2]), mn = Math.min(rgb[0], rgb[1], rgb[2]);
    const chroma = (mx - mn) / 255;
    const score = (filled ? 2 : 1) * Math.sqrt(r.width * r.height) * fold * (1 + chroma) * (inChrome(el) ? 0.7 : 1);
    ctl.push({ el, score, filled, outlined, contrast: Math.round(fillContrast * 100) / 100, sig: [s.backgroundColor, s.color, s.borderTopColor, s.borderTopLeftRadius].join('|') });
  }
  ctl.sort((a, b) => b.score - a.score);
  const btnRecord = (c, role) => {
    const carrier = c.el.tagName === 'INPUT' ? c.el : textCarrier(c.el);
    return record(c.el, role, { style: boxStyle(c.el), type: typeOf(carrier), label: (c.el.tagName === 'INPUT' ? c.el.value : textOf(c.el)).slice(0, 40), filled: c.filled, outlined: c.outlined, ground_contrast: c.contrast, contrast_floor: CONTROL_MIN_CONTRAST, over_media: underMedia(c.el) });
  };
  const primary = ctl.find((c) => c.filled) || ctl[0];
  if (primary) out.roles.button_primary = btnRecord(primary, 'button-primary');
  const secondary = ctl.find((c) => c !== primary && c.sig !== (primary && primary.sig));
  if (secondary) out.roles.button_secondary = btnRecord(secondary, 'button-secondary');
  out.roles.button_candidates = ctl.slice(0, 6).map((c) => ({ selector: path(c.el), score: Math.round(c.score), filled: c.filled, ground_contrast: c.contrast }));

  /* ── body links ─────────────────────────────────────────────────────── */
  const lg = new Map();
  for (const a of document.querySelectorAll('main a, p a, li a, article a')) {
    if (!visible(a) || inChrome(a) || a === (primary && primary.el) || a === (secondary && secondary.el)) continue;
    const bg = rgba(getComputedStyle(a).backgroundColor) || [0, 0, 0, 0];
    if (bg[3] > 0.5 || textOf(a).length < 2) continue;
    const tp = typeOf(textCarrier(a));
    const k = tp.color + '|' + tp.decoration;
    const g = lg.get(k) || { n: 0, el: a };
    g.n += 1; lg.set(k, g);
  }
  const link = [...lg.values()].sort((a, b) => b.n - a.n)[0];
  if (link) out.roles.link = record(link.el, 'link', { type: typeOf(textCarrier(link.el)) });

  /* ── inputs ─────────────────────────────────────────────────────────── */
  const input = Array.from(document.querySelectorAll('input[type=text],input[type=email],input[type=search],input[type=tel],input:not([type]),textarea,select')).find(visible);
  if (input) {
    let ph = '';
    try { const c = rgba(getComputedStyle(input, '::placeholder').color); ph = c ? hex(c) : ''; } catch (_) { ph = ''; }
    out.roles.input = record(input, 'input', { style: boxStyle(input), type: typeOf(input), placeholder_color: ph });
  }

  /* ── product cards: repeated units holding an image, a title and a price ─ */
  const PRICE = /(?:[$€£¥₹]|Rs\.?|INR|USD|EUR|GBP|AUD|CAD)\s?\d[\d,.]*|\d[\d,.]*\s?(?:[$€£₹]|USD|EUR|GBP|INR)\b/;
  const cardSeen = new Map();
  for (const el of textEls) {
    const t = ownText(el);
    if (t.length > 30 || !PRICE.test(t) || inChrome(el)) continue;
    let n = el.parentElement, card = null;
    for (let i = 0; n && i < 8; i++, n = n.parentElement) {
      const r = n.getBoundingClientRect();
      if (r.width > VW * 0.62) break;
      if (n.querySelector('img') && n.querySelector('a')) { card = n; break; }
    }
    if (!card) continue;
    const sig = card.tagName + '.' + Array.from(card.classList).slice(0, 3).join('.');
    const g = cardSeen.get(sig) || { n: 0, card, price: el };
    g.n += 1; cardSeen.set(sig, g);
  }
  const cardG = [...cardSeen.values()].sort((a, b) => b.n - a.n)[0];
  if (cardG) {
    const card = cardG.card;
    const img = Array.from(card.querySelectorAll('img')).filter(visible).sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height))[0] || null;
    const priceEl = cardG.price;
    let title = null, ts = 0;
    for (const el of card.querySelectorAll('*')) {
      if (!visible(el) || el === priceEl || priceEl.contains(el) || el.contains(priceEl)) continue;
      const t = ownText(el);
      if (t.length < 3 || PRICE.test(t) || t.length > 120) continue;
      const sz = parseFloat(getComputedStyle(el).fontSize) || 0;
      const w = sz + (parseInt(getComputedStyle(el).fontWeight, 10) || 400) / 1000;
      if (w > ts) { ts = w; title = el; }
    }
    let badge = null;
    const cardBg = rgba(ground(card).color);
    for (const el of card.querySelectorAll('*')) {
      if (!visible(el) || el === priceEl) continue;
      const r = el.getBoundingClientRect();
      const t = textOf(el);
      if (r.height > 34 || t.length < 2 || t.length > 22) continue;
      const bg = rgba(getComputedStyle(el).backgroundColor) || [0, 0, 0, 0];
      if (bg[3] < 0.5) continue;
      if (Math.abs(bg[0] - cardBg[0]) + Math.abs(bg[1] - cardBg[1]) + Math.abs(bg[2] - cardBg[2]) < 24) continue;
      badge = el; break;
    }
    const ir = img ? img.getBoundingClientRect() : null;
    const ist = img ? getComputedStyle(img) : null;
    // The card's own grid gap, from its parent when that parent lays it out.
    const parent = card.parentElement;
    const ps = parent ? getComputedStyle(parent) : null;
    out.roles.card = record(card, 'card', {
      style: boxStyle(card), siblings: cardG.n,
      image: img ? {
        src: img.currentSrc || img.src || '', aspect: ir && ir.height ? Math.round((ir.width / ir.height) * 1000) / 1000 : null,
        rendered: ir ? { w: Math.round(ir.width), h: Math.round(ir.height) } : null,
        natural: { w: img.naturalWidth || 0, h: img.naturalHeight || 0 },
        fit: ist.objectFit, radius: px(ist.borderTopLeftRadius), selector: path(img),
      } : null,
      title: title ? Object.assign({ selector: path(title), text: textOf(title).slice(0, 80) }, { type: typeOf(title) }) : null,
      price: Object.assign({ selector: path(priceEl), text: textOf(priceEl).slice(0, 40) }, { type: typeOf(priceEl) }),
      badge: badge ? { selector: path(badge), text: textOf(badge).slice(0, 22), style: boxStyle(badge), type: typeOf(textCarrier(badge)) } : null,
      grid_gap: ps && /grid|flex/.test(ps.display) ? { column: px(ps.columnGap), row: px(ps.rowGap) } : null,
    });
    if (title) title.setAttribute('data-lcos-role', 'card-title');
    priceEl.setAttribute('data-lcos-role', 'card-price');
    if (img) img.setAttribute('data-lcos-role', 'card-image');
  }

  /* ── section rhythm: container width, vertical padding ───────────────── */
  const widths = new Map();
  for (const el of all) {
    if (el.children.length < 1) continue;
    const s = getComputedStyle(el);
    if (s.position === 'fixed' || s.position === 'absolute') continue;
    const r = el.getBoundingClientRect();
    if (r.width < Math.min(600, VW * 0.6) || r.width > VW - 8) continue;
    const ml = parseFloat(s.marginLeft), mr = parseFloat(s.marginRight);
    if (!(ml > 4 && Math.abs(ml - mr) < 2)) continue;
    const k = Math.round(r.width);
    widths.set(k, (widths.get(k) || 0) + 1);
  }
  const container = [...widths.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  const sections = [];
  const root = document.querySelector('main') || document.body;
  for (const el of root.children) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < VW * 0.95 || r.height < 80) continue;
    const s = getComputedStyle(el);
    sections.push({ selector: path(el), pad_top: px(s.paddingTop), pad_bottom: px(s.paddingBottom), height: Math.round(r.height), ground: ground(el).color, image: !!(ground(el).image && !ground(el).image.gradient) });
    if (sections.length >= 14) break;
  }
  out.layout = { container: container ? { width: container[0], occurrences: container[1] } : null, sections };

  /* ── hero / imagery ─────────────────────────────────────────────────── */
  const imgs = Array.from(document.querySelectorAll('img')).filter(visible);
  const assetImgs = [];
  let hero = null, heroArea = 0;
  for (const im of imgs) {
    const r = im.getBoundingClientRect();
    const area = r.width * r.height;
    const top = r.top + window.scrollY;
    const role = (header && header.contains(im)) ? 'header' : (im.closest('[data-lcos-role=card]') ? 'product' : (top < VH ? 'hero' : 'content'));
    if (top < VH && area > heroArea && !(header && header.contains(im))) { heroArea = area; hero = im; }
    if (assetImgs.length < (o.maxImages || 40)) {
      assetImgs.push({ url: im.currentSrc || im.src || '', alt: (im.alt || '').slice(0, 120), role, rendered: { w: Math.round(r.width), h: Math.round(r.height) }, natural: { w: im.naturalWidth || 0, h: im.naturalHeight || 0 }, fit: getComputedStyle(im).objectFit, radius: px(getComputedStyle(im).borderTopLeftRadius) });
    }
  }
  if (hero) {
    const r = hero.getBoundingClientRect();
    out.roles.hero_image = record(hero, 'hero-image', { src: hero.currentSrc || hero.src || '', aspect: r.height ? Math.round((r.width / r.height) * 1000) / 1000 : null, rendered: { w: Math.round(r.width), h: Math.round(r.height) }, fit: getComputedStyle(hero).objectFit, full_bleed: r.width >= VW * 0.95 });
  }
  out.assets.images = assetImgs;

  /* ── icons, theme colour, manifest ───────────────────────────────────── */
  out.assets.icons = Array.from(document.querySelectorAll('link[rel~=icon],link[rel=apple-touch-icon],link[rel=apple-touch-icon-precomposed],link[rel=mask-icon]')).map((l) => ({
    rel: l.getAttribute('rel'), url: l.href, sizes: l.getAttribute('sizes') || '', type: l.getAttribute('type') || '', color: l.getAttribute('color') || '',
  })).slice(0, 16);
  const mf = document.querySelector('link[rel=manifest]');
  out.meta.manifest_url = mf ? mf.href : '';
  const tc = document.querySelector('meta[name=theme-color]');
  out.meta.theme_color = tc ? (() => { const c = rgba(tc.getAttribute('content')); return c && c[3] > 0 ? hex(c) : ''; })() : '';
  out.meta.lang = document.documentElement.lang || '';
  // Without a viewport meta a phone lays the DESKTOP page out at 980px and
  // scales it (and boosts text); phone values read from such a page describe
  // that, not a phone design, and the manifest says so.
  const vpm = document.querySelector('meta[name=viewport]');
  out.meta.viewport = vpm ? vpm.getAttribute('content') || '' : '';

  /* ── custom properties, AS COMPUTED on :root ─────────────────────────── */
  const names = new Set(Array.isArray(o.cssNames) ? o.cssNames : []);
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try { rules = sheet.cssRules; } catch (_) { rules = null; }   // cross-origin: names came from the network layer
    if (!rules) continue;
    for (const r of Array.from(rules).slice(0, 3000)) {
      if (!r.style || !r.selectorText || !/(^|,|\s):root|^html\b|^body\b/.test(r.selectorText)) continue;
      for (let i = 0; i < r.style.length; i++) if (r.style[i].startsWith('--')) names.add(r.style[i]);
    }
  }
  const inline = document.documentElement.style;
  for (let i = 0; i < inline.length; i++) if (inline[i].startsWith('--')) names.add(inline[i]);
  const rootCs = getComputedStyle(document.documentElement);
  let kept = 0;
  for (const n of names) {
    if (kept >= 240) break;
    const v = rootCs.getPropertyValue(n).trim();
    if (!v) continue;
    const c = /^(#|rgb|hsl|oklch|oklab|color\(|lab|lch)/i.test(v) ? rgba(v) : null;
    out.custom_properties[n] = { value: v.slice(0, 160), hex: c && c[3] > 0 ? hex(c) : '', inline: inline.getPropertyValue(n).trim() !== '' };
    kept += 1;
  }

  /* ── links for the next pages ───────────────────────────────────────── */
  const seenLinks = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    try {
      const u = new URL(a.getAttribute('href'), location.href);
      if (!/^https?:$/.test(u.protocol)) continue;
      u.hash = '';
      const k = u.toString();
      if (seenLinks.has(k)) continue;
      seenLinks.add(k);
      out.links.push(k);
      if (out.links.length >= 300) break;
    } catch (_) { /* not a URL */ }
  }
  /* ── colours the page RENDERS, counted (fills, text, borders, svg) ───── */
  const rc = new Map();
  const bump = (c) => { if (!c || c[3] < 0.5) return; const h = hex(c); rc.set(h, (rc.get(h) || 0) + 1); };
  let seenEls = 0;
  for (const el of all) {
    if (seenEls > 3000) break;
    if (!visible(el)) continue;
    seenEls += 1;
    const s = getComputedStyle(el);
    bump(rgba(s.backgroundColor));
    if (ownText(el).length) bump(rgba(s.color));
    if (s.borderTopStyle !== 'none' && parseFloat(s.borderTopWidth) >= 1) bump(rgba(s.borderTopColor));
    if (el instanceof SVGElement && s.fill && s.fill !== 'none') bump(rgba(s.fill));
  }
  out.rendered_colors = [...rc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([h, n]) => ({ hex: h, n }));
  out.page_height = Math.round(document.documentElement.scrollHeight);
  return out;
}

/**
 * Re-measure ONE role with a named strategy - the repair loop's only way of
 * changing a value. Returns { value, strategy, selector } or { value:null }.
 *   computed      the tagged element's computed property, read again
 *   text-carrier  the deepest descendant carrying the visible text
 *   ground        the colour composited from the element and its ancestors
 *   parent-filled the nearest ancestor that paints a fill (a label inside a pill)
 */
function remeasure(args) {
  const { role, prop, strategy } = args || {};
  const el = document.querySelector('[data-lcos-role="' + role + '"]');
  if (!el) return { value: null, reason: 'the element is no longer on the page' };
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const toHex = (css) => {
    const s = String(css || '').trim();
    if (!s || s === 'transparent') return '';
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#010203'; cx.fillStyle = s;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    if (d[3] === 0) return '';
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  const own = (n) => { let t = ''; for (const c of n.childNodes) if (c.nodeType === 3) t += c.nodeValue; return t.trim(); };
  let target = el;
  if (strategy === 'text-carrier') {
    let best = el, bl = own(el).length;
    for (const d of el.querySelectorAll('*')) { const l = own(d).length; if (l > bl) { best = d; bl = l; } }
    target = best;
  }
  if (strategy === 'parent-filled') {
    let n = el;
    while (n && n.nodeType === 1) { const c = toHex(getComputedStyle(n).backgroundColor); if (c) break; n = n.parentElement; }
    target = n || el;
  }
  const cs = getComputedStyle(target);
  if (strategy === 'ground' || (prop === 'background' && strategy === 'parent-filled')) {
    let n = target;
    while (n && n.nodeType === 1) {
      const c = toHex(getComputedStyle(n).backgroundColor);
      if (c) return { value: c, strategy, selector: n.tagName.toLowerCase() };
      n = n.parentElement;
    }
    return { value: '#ffffff', strategy, selector: 'canvas' };
  }
  const map = {
    background: () => toHex(cs.backgroundColor),
    color: () => toHex(cs.color),
    border_color: () => toHex(cs.borderTopColor),
    size: () => parseFloat(cs.fontSize),
    weight: () => parseInt(cs.fontWeight, 10),
    line_height: () => (cs.lineHeight === 'normal' ? 'normal' : parseFloat(cs.lineHeight)),
    letter_spacing: () => (cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing)),
    transform: () => cs.textTransform,
    radius: () => parseFloat(cs.borderTopLeftRadius),
    stack: () => cs.fontFamily,
  };
  const f = map[prop];
  return { value: f ? f() : null, strategy, selector: target.tagName.toLowerCase() + (target.className && typeof target.className === 'string' ? '.' + target.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '') };
}

/** One tagged element's styles in an interaction STATE, read after the state was applied. */
function stateStyle(role) {
  const el = document.querySelector('[data-lcos-role="' + role + '"]');
  if (!el) return null;
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const toHex = (css) => {
    const s = String(css || '').trim();
    if (!s || s === 'transparent') return '';
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#010203'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    if (d[3] === 0) return '';
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  const s = getComputedStyle(el);
  let carrier = el, bl = 0;
  for (const d of [el].concat(Array.from(el.querySelectorAll('*')))) {
    let t = ''; for (const c of d.childNodes) if (c.nodeType === 3) t += c.nodeValue;
    if (t.trim().length > bl) { bl = t.trim().length; carrier = d; }
  }
  return {
    background: toHex(s.backgroundColor), color: toHex(getComputedStyle(carrier).color),
    border_color: s.borderTopStyle === 'none' || !(parseFloat(s.borderTopWidth) > 0) ? '' : toHex(s.borderTopColor),
    shadow: s.boxShadow === 'none' ? '' : s.boxShadow.slice(0, 200),
    outline: s.outlineStyle === 'none' ? '' : `${s.outlineWidth} ${s.outlineStyle} ${toHex(s.outlineColor)}`,
    decoration: (getComputedStyle(carrier).textDecorationLine || '').split(' ')[0],
    transform: s.transform === 'none' ? '' : s.transform,
    opacity: parseFloat(s.opacity),
  };
}

/**
 * OUR rendered asset, measured by its `data-ds` hooks with the same shape the
 * site's roles were measured in (type + box), so the two can be compared token
 * for token. Self-contained for page.evaluate().
 */
function measureHooks() {
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  function rgba(css) {
    const s = String(css || '').trim();
    if (!s || s === 'transparent') return [0, 0, 0, 0];
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
    if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : (String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]))];
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#010203'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  const h2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  const hex = (c) => (c ? '#' + h2(c[0]) + h2(c[1]) + h2(c[2]) : '');
  const over = (t, u) => { const a = t[3] + u[3] * (1 - t[3]); if (a <= 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (t[i] * t[3] + u[i] * u[3] * (1 - t[3])) / a).concat([a]); };
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
  function ground(el) {
    const layers = []; let n = el;
    while (n && n.nodeType === 1) { const c = rgba(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; } n = n.parentElement; }
    let col = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) col = over(layers[i], col);
    return hex(col);
  }
  function carrier(el) {
    const own = (n) => { let t = ''; for (const c of n.childNodes) if (c.nodeType === 3) t += c.nodeValue; return t.trim(); };
    let best = el, bl = own(el).length;
    for (const d of el.querySelectorAll('*')) { const l = own(d).length; if (l > bl) { best = d; bl = l; } }
    return best;
  }
  const out = {};
  for (const el of document.querySelectorAll('[data-ds]')) {
    const role = el.getAttribute('data-ds');
    if (out[role]) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const t = getComputedStyle(carrier(el));
    const bg = rgba(s.backgroundColor) || [0, 0, 0, 0];
    const g = ground(el.parentElement || el);
    const tc = rgba(t.color) || [0, 0, 0, 1];
    const bc = rgba(s.borderTopColor) || [0, 0, 0, 0];
    const bw = s.borderTopStyle === 'none' ? 0 : (px(s.borderTopWidth) || 0);
    out[role] = {
      box: { x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      type: {
        stack: t.fontFamily, family: String(t.fontFamily).split(',')[0].trim().replace(/^["']|["']$/g, ''),
        size: px(t.fontSize), weight: parseInt(t.fontWeight, 10) || t.fontWeight,
        line_height: t.lineHeight === 'normal' ? 'normal' : px(t.lineHeight),
        letter_spacing: t.letterSpacing === 'normal' ? 0 : px(t.letterSpacing),
        transform: t.textTransform, color: hex(tc[3] < 1 ? over(tc, rgba(ground(el))) : tc), align: t.textAlign,
      },
      style: {
        background: bg[3] > 0 ? hex(over(bg, rgba(g))) : '', ground: g,
        background_image: s.backgroundImage && s.backgroundImage !== 'none' && !/url\(/.test(s.backgroundImage) ? s.backgroundImage.slice(0, 300) : '',
        radius: px(s.borderTopLeftRadius), border_width: bw, border_color: bw && bc[3] > 0 ? hex(over(bc, rgba(g))) : '',
        shadow: s.boxShadow === 'none' ? '' : s.boxShadow.slice(0, 200),
        padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(px),
        height: Math.round(r.height * 100) / 100, width: Math.round(r.width * 100) / 100,
        max_width: s.maxWidth === 'none' ? null : px(s.maxWidth),
      },
      aspect: el.tagName === 'IMG' && r.height ? Math.round((r.width / r.height) * 1000) / 1000 : null,
      text: String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    };
  }
  return out;
}

/**
 * A SPECIMEN of one of our elements for the pixel comparison: a clone carrying
 * our element's own COMPUTED styles inline, set at the source element's width
 * and alignment, with the source's text, on the source's ground. The styles
 * are ours (what our renderer computed); only the frame is the source's,
 * because a heading that wraps at a different container width is a layout
 * difference, not a typography one. Returns a selector for the specimen.
 */
function makeSpecimen(args) {
  const { hook, width, align, ground, text, id } = args;
  const el = document.querySelector('[data-ds="' + hook + '"]');
  if (!el) return null;
  const own = (n) => { let t = ''; for (const c of n.childNodes) if (c.nodeType === 3) t += c.nodeValue; return t.trim(); };
  let car = el, bl = own(el).length;
  for (const d of el.querySelectorAll('*')) { const l = own(d).length; if (l > bl) { car = d; bl = l; } }
  const s = getComputedStyle(el), t = getComputedStyle(car);
  const wrap = document.createElement('div');
  wrap.id = id;
  // The specimen sits at the SAME sub-pixel phase as the source element, so a
  // glyph edge falls on the same fraction of a pixel in both screenshots. A
  // control sizes itself (its width IS one of the things compared); a heading
  // is set at the source's exact width so it wraps where the source wraps.
  const fx = ((args.x || 0) % 1 + 1) % 1, fy = ((args.y || 0) % 1 + 1) % 1;
  const top = Math.ceil(document.documentElement.scrollHeight + 40) + fy;
  wrap.style.cssText = `position:absolute;left:${fx}px;top:${top}px;background:${ground};padding:0;margin:0;`
    + (args.box ? 'display:inline-block;width:auto;white-space:nowrap;' : `width:${width}px;`)
    + `text-align:${align || 'left'};z-index:2147483647`;
  const c = document.createElement(args.box ? 'span' : 'div');
  const keep = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'color', 'text-shadow', 'font-feature-settings', 'font-variation-settings'];
  const box = ['background-color', 'background-image', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'box-shadow'];
  let css = keep.map((p) => `${p}:${t.getPropertyValue(p)}`).join(';');
  if (args.box) css += ';display:inline-block;' + box.map((p) => `${p}:${s.getPropertyValue(p)}`).join(';');
  else css += ';display:block;margin:0;padding:0';
  c.style.cssText = css;
  c.textContent = text;
  wrap.appendChild(c);
  document.body.appendChild(wrap);
  return '#' + id + ' > *';
}

/**
 * The boxes of an element's TEXT, relative to the element's own box (the
 * coordinates of its element screenshot). The perceptual comparison masks
 * them: glyph anti-aliasing differs between two renders of the same words,
 * and the type itself is judged by the structural tokens.
 */
function textRects(sel) {
  const el = document.querySelector(sel);
  if (!el) return [];
  const b = el.getBoundingClientRect();
  const out = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    if (!String(n.nodeValue || '').trim()) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    for (const q of r.getClientRects()) {
      if (q.width < 1 || q.height < 1) continue;
      out.push({ x: q.left - b.left, y: q.top - b.top, w: q.width, h: q.height });
      if (out.length > 80) return out;
    }
  }
  return out;
}

module.exports = {
  textRects, capturePage, remeasure, stateStyle, measureHooks, makeSpecimen };
