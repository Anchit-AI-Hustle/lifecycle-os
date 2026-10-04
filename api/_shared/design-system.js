'use strict';
/**
 * design-system.js — the brand's DESIGN SYSTEM, as the renderers consume it.
 * ---------------------------------------------------------------------------
 * "Read my site" renders the brand's own site in a browser (brand-render.js)
 * and measures it: colour roles, the type scale per viewport, and the
 * COMPONENTS as the site renders them - primary/secondary button (default,
 * hover, focus), header bar and logo, footer, product card (image aspect,
 * title/price type, badge), inputs, section rhythm, imagery. That measurement is
 * the MANIFEST. This module is the other half:
 *
 *   fromManifest(m)        manifest -> the compact design system kept on the
 *                          brand record (brand_data.design_system), every value
 *                          still carrying where it was read
 *   applyFields(m)         manifest -> the field patch the wizard and the
 *                          regression loop both apply (ONE definition, so what
 *                          the operator applies is what was scored)
 *   applyToBrand(b, f, o)  apply that patch, skipping fields a person owns
 *   resolve(brand)         what a RENDERER reads: fonts, type, components,
 *                          with the hard rules (sectionGround, textOn) applied
 *   lpCss / emailTokens / adTokens   the per-medium consumption
 *
 * Until this existed the generators consumed a palette and two family names,
 * and the landing page served at /lp/:id did not even read those two: its
 * fonts were tenant zero's literals for every brand. A design system that our
 * renderers never read would prove nothing about what a customer sees, so the
 * regression engine (render-regression.js) scores OUR renderers' output - not a
 * throwaway clone page.
 *
 * ── ABSENT MEANS UNCHANGED ─────────────────────────────────────────────────
 * A brand with no `brand_data.design_system` renders exactly as before: every
 * accessor returns the renderer's own existing value. That keeps every
 * existing asset gate (no-black-background, rendered contrast, generation
 * quality) measuring what it always measured.
 *
 * ── THE HARD RULES STAY HARD ───────────────────────────────────────────────
 * A site may paint a near-black header or footer; a generated asset may not
 * paint a dark-neutral SECTION. sectionGround() decides, and the swap is
 * reported in `hard_rules` with the exact site value - never silently. Text on a
 * ground is the site's own colour when it clears AA there, and otherwise the
 * readableAsText() derivation, recorded as DERIVED with both ratios. A site's
 * own sub-AA pairing is a fact about the site; repeating it in our asset would
 * be a defect of ours.
 *
 * Provenance origins follow the platform's precedence: user > document >
 * site-render > site-parse > preset. This module only ever writes
 * `site-render`; a field whose origin is `user` (or `document`) is never
 * overwritten here.
 */

const DS_VERSION = 1;
const ORIGIN = 'site-render';
/** Higher wins. A machine value may replace only a LOWER origin. */
const ORIGIN_RANK = { user: 5, document: 4, 'site-render': 3, 'site-parse': 2, preset: 1, default: 0 };

function core() { return require('./brand-workspace-core.js'); }

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pxs = (v) => (num(v) == null ? '' : `${Math.round(v * 100) / 100}px`);
const clip = (s, n) => String(s == null ? '' : s).slice(0, n || 200);

/* ═══ manifest -> the compact design system ════════════════════════════════ */

function pickType(t) {
  if (!t) return null;
  return {
    family: t.family || '', stack: clip(t.stack, 200), size: num(t.size), weight: t.weight,
    line_height: t.line_height === 'normal' ? 'normal' : num(t.line_height),
    letter_spacing: num(t.letter_spacing), transform: t.transform || 'none', style: t.style || 'normal',
    color: t.color || '', decoration: t.decoration || '', align: t.align || '',
  };
}
function pickBox(s) {
  if (!s) return null;
  return {
    background: s.background || '', background_image: clip(s.background_image, 300), ground: s.ground || '',
    radius: num(s.radius), radius_all: s.radius_all || null,
    border_width: num(s.border_width) || 0, border_style: s.border_style || 'none', border_color: s.border_color || '',
    shadow: clip(s.shadow, 200), padding: Array.isArray(s.padding) ? s.padding.map(num) : null,
    height: num(s.height), width: num(s.width), outline: s.outline || '',
  };
}
function buttonOf(role) {
  if (!role) return null;
  const b = pickBox(role.style) || {};
  const t = pickType(role.type) || {};
  return Object.assign(b, {
    color: t.color, family: t.family, stack: t.stack, size: t.size, weight: t.weight,
    transform: t.transform, letter_spacing: t.letter_spacing, line_height: t.line_height,
    label: clip(role.label, 40), filled: !!role.filled, outlined: !!role.outlined,
  });
}

/**
 * The compact design system. Everything a renderer needs, nothing it does not
 * (no screenshots, no candidate lists), with `provenance` naming the page, the
 * role, the selector path and the viewport each value was read from.
 */
function fromManifest(m) {
  if (!m || !m.read) return null;
  const d = m.read.desktop || {};
  const mo = m.read.mobile || {};
  const rd = d.roles || {};
  const rm = mo.roles || {};
  const typeSet = (r) => {
    const h = r.headings || {};
    const out = {};
    for (const k of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) if (h[k]) out[k] = pickType(h[k].type);
    if (!out.h1 && r.display) out.h1 = pickType(r.display.type);
    if (r.display) out.display = pickType(r.display.type);
    if (r.body) out.body = pickType(r.body.type);
    if (r.muted) out.small = pickType(r.muted.type);
    if (r.link) out.link = pickType(r.link.type);
    if (r.nav_link) out.nav = pickType(r.nav_link.type);
    if (r.button_primary) out.button = pickType(r.button_primary.type);
    if (r.card && r.card.title) out.card_title = pickType(r.card.title.type);
    if (r.card && r.card.price) out.price = pickType(r.card.price.type);
    return out;
  };
  const header = (r) => (r.header ? {
    background: (r.header.style && r.header.style.background) || r.header.ground || '',
    ground: r.header.ground || '', height: r.header.style ? num(r.header.style.height) : null,
    sticky: !!r.header.sticky, shadow: r.header.style ? r.header.style.shadow : '',
    border_bottom: r.header.style && r.header.style.border_width ? r.header.style.border_color : '',
    logo: r.logo ? { kind: r.logo.kind, height: r.logo.rendered ? r.logo.rendered.h : null, width: r.logo.rendered ? r.logo.rendered.w : null, placement: r.logo.placement } : null,
    link: r.nav_link ? pickType(r.nav_link.type) : null,
  } : null);
  const footer = (r) => (r.footer ? {
    background: (r.footer.style && r.footer.style.background) || r.footer.ground || '',
    ground: r.footer.ground || '', color: r.footer.text ? r.footer.text.color : '',
    text: r.footer.text ? pickType(r.footer.text) : null,
    padding: r.footer.style ? r.footer.style.padding : null,
  } : null);
  const card = (r) => (r.card ? {
    box: pickBox(r.card.style),
    image: r.card.image ? { aspect: num(r.card.image.aspect), radius: num(r.card.image.radius), fit: r.card.image.fit || '' } : null,
    title: r.card.title ? pickType(r.card.title.type) : null,
    price: r.card.price ? pickType(r.card.price.type) : null,
    badge: r.card.badge ? Object.assign(pickBox(r.card.badge.style) || {}, { type: pickType(r.card.badge.type), text: clip(r.card.badge.text, 22) }) : null,
    grid_gap: r.card.grid_gap || null,
    from_page: r.__page || '',
  } : null);
  const hero = (r) => {
    const h = r.display || (r.headings && r.headings.h1) || null;
    if (!h) return null;
    return {
      ground: h.ground || '', over_media: h.over_media || null, align: (h.type && h.type.align) || '',
      heading: pickType(h.type), body: r.body ? pickType(r.body.type) : null,
    };
  };
  const layout = (c) => {
    const L = (c && c.layout) || {};
    const pads = (L.sections || []).map((s) => [s.pad_top, s.pad_bottom]).filter((p) => p[0] != null);
    const mode = (arr) => { const m2 = new Map(); for (const v of arr) m2.set(v, (m2.get(v) || 0) + 1); return [...m2.entries()].sort((a, b) => b[1] - a[1])[0]; };
    const tops = mode(pads.map((p) => p[0]).filter((v) => v > 0));
    const bots = mode(pads.map((p) => p[1]).filter((v) => v > 0));
    return {
      container: L.container ? L.container.width : null,
      pad_top: tops ? tops[0] : null, pad_bottom: bots ? bots[0] : null,
      sections: (L.sections || []).length,
    };
  };
  const bp = (fn) => ({ desktop: fn(rd), mobile: fn(rm) });
  const ds = {
    version: DS_VERSION,
    origin: ORIGIN,
    source: {
      url: m.url, read_at: m.read_at, method: 'rendered in Chromium',
      renderer: m.renderer ? `${m.renderer.source} ${m.renderer.version}` : '',
      pages: (m.pages || []).map((p) => ({ url: p.url, role: p.role })),
    },
    viewports: { desktop: (d.viewport || {}).w || 1440, mobile: (mo.viewport || {}).w || 390 },
    colors: Object.fromEntries(Object.entries(m.colors || {}).map(([k, v]) => [k, v && v.value ? v.value : ''])),
    fonts: m.fonts || {},
    type: { desktop: typeSet(rd), mobile: typeSet(rm) },
    components: {
      button: {
        primary: { desktop: buttonOf(rd.button_primary), mobile: buttonOf(rm.button_primary), hover: (m.states && m.states.button_primary && m.states.button_primary.hover) || null, focus: (m.states && m.states.button_primary && m.states.button_primary.focus) || null },
        secondary: { desktop: buttonOf(rd.button_secondary), mobile: buttonOf(rm.button_secondary), hover: (m.states && m.states.button_secondary && m.states.button_secondary.hover) || null, focus: (m.states && m.states.button_secondary && m.states.button_secondary.focus) || null },
      },
      header: bp(header),
      footer: bp(footer),
      card: { desktop: card(m.card_source && m.card_source.desktop ? m.card_source.desktop : rd), mobile: card(rm) },
      input: { desktop: rd.input ? Object.assign(pickBox(rd.input.style) || {}, { type: pickType(rd.input.type), placeholder: rd.input.placeholder_color || '' }) : null },
      hero: bp(hero),
      section: { desktop: layout(m.read.desktop), mobile: layout(m.read.mobile) },
      imagery: {
        hero: rd.hero_image ? { aspect: num(rd.hero_image.aspect), full_bleed: !!rd.hero_image.full_bleed, fit: rd.hero_image.fit || '' } : null,
        product: rd.card && rd.card.image ? { aspect: num(rd.card.image.aspect), fit: rd.card.image.fit || '', radius: num(rd.card.image.radius) } : null,
      },
    },
    logo: m.assets && m.assets.logo ? {
      kind: m.assets.logo.kind, url: m.assets.logo.url || '', svg: clip(m.assets.logo.inline_svg, 24000),
      natural: m.assets.logo.natural || null, rendered: m.assets.logo.rendered || null,
      // A WORDMARK set in type is a logo too: its type is what reproduces it.
      type: m.assets.logo.kind === 'text' && rd.logo ? pickType(rd.logo.type) : null,
      text: m.assets.logo.kind === 'text' && rd.logo ? clip(rd.logo.text, 60) : '',
    } : null,
    hard_rules: (m.hard_rules || []).slice(0, 40),
    provenance: m.provenance || {},
  };
  return ds;
}

/* ═══ the field patch - applied by the wizard AND by the regression loop ═══ */

/**
 * Every brand field a rendered read sets, with its source. The wizard applies
 * exactly these (minus the fields a person owns); the regression loop applies
 * exactly these to score our renderers. One definition, so the score is the
 * score of what was applied.
 */
function applyFields(m) {
  const fields = {};
  if (!m) return fields;
  const put = (k, value, source) => { if (value !== undefined && value !== null && value !== '') fields[k] = { value, source: source || null, origin: ORIGIN }; };
  for (const role of ['primary', 'accent', 'ink', 'surface', 'surface_alt', 'muted']) {
    const c = (m.colors || {})[role];
    if (c && c.value) put(`palette.${role}`, c.value, c.source);
  }
  const font = (slot, generic) => {
    const f = (m.fonts || {})[slot];
    if (!f || !f.family) return;
    const stack = f.stack || `'${f.family}',${generic}`;
    put(`typography.${slot}`, Object.assign({
      family: f.family, stack, google: !!f.google,
      weights: (f.weights && f.weights.length ? f.weights.join(';') : '400;600;700'),
    }, f.licence === 'brand font' ? { licence: 'brand font', display_name: f.display_name || `${f.family} (brand font)`, fallback_stack: f.fallback_stack || '' } : {}), f.source);
  };
  font('heading', 'Georgia,serif');
  font('body', 'system-ui,-apple-system,Segoe UI,sans-serif');
  const logo = m.assets && m.assets.logo;
  if (logo && logo.url && /^https?:\/\//i.test(logo.url)) put('logo_url', logo.url, logo.source);
  const icon = m.assets && m.assets.favicon;
  if (icon && icon.url && /^https?:\/\//i.test(icon.url)) put('favicon_url', icon.url, icon.source);
  const ds = fromManifest(m);
  if (ds) put('brand_data.design_system', ds, { page: m.url, role: 'design system', signal: 'computed', viewport: 'desktop+mobile' });
  const images = ((m.assets && m.assets.images) || []).filter((i) => i && /^https?:\/\//.test(i.url)).slice(0, 24);
  if (images.length) put('brand_data.imagery', images.map((i) => ({ url: i.url, role: i.role, rendered: i.rendered, page: i.page || m.url, signal: 'computed' })), { page: m.url, role: 'imagery', signal: 'computed' });
  return fields;
}

function hasValue(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return v.family ? true : Object.keys(v).length > 0;
  return true;
}
function getPath(o, p) { return p.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o); }
function setPath(o, p, v) {
  const ks = p.split('.');
  let n = o;
  for (let i = 0; i < ks.length - 1; i++) {
    if (!n[ks[i]] || typeof n[ks[i]] !== 'object') n[ks[i]] = {};
    n = n[ks[i]];
  }
  n[ks[ks.length - 1]] = v;
}

/**
 * The origin a field carries on this brand record: the wizard's / save path's
 * `brand_data.field_origin`, else `brand_data.brand_extraction.applied` (older
 * records). Unknown is unknown, never assumed to be the operator's or ours.
 */
function originOf(brand, field) {
  const bd = (brand && brand.brand_data) || {};
  const fo = bd.field_origin || {};
  // The onboarding wizard keeps its per-field record in `field_origins`
  // ({origin, source, page, line, quote}); a field a brand guideline document
  // set is `document` there. Both maps are read, and the higher origin wins,
  // so a render can never step over a document or a person through the map it
  // did not write.
  const fos = bd.field_origins && typeof bd.field_origins === 'object' ? bd.field_origins : {};
  const rec = fos[field] && typeof fos[field] === 'object' ? String(fos[field].origin || '') : '';
  if (fo[field] || rec) {
    return (ORIGIN_RANK[rec] || 0) > (ORIGIN_RANK[fo[field]] || 0) ? rec : (fo[field] || rec);
  }
  const ap = (bd.brand_extraction && bd.brand_extraction.applied) || {};
  if (ap[field] && ap[field].origin) return ap[field].origin;
  return '';
}

/**
 * Apply the patch. A field whose origin outranks `site-render` (a person typed
 * it, or a brand guideline document set it) is KEPT and listed. Returns
 * { brand, applied:[field], kept:[{field, origin}] } and never mutates input.
 */
function applyToBrand(brand, fields, opts) {
  const o = opts || {};
  const out = JSON.parse(JSON.stringify(brand || {}));
  out.brand_data = out.brand_data && typeof out.brand_data === 'object' ? out.brand_data : {};
  out.brand_data.field_origin = Object.assign({}, out.brand_data.field_origin || {});
  const owned = new Set(o.userOwned || []);
  const applied = [], kept = [];
  for (const [field, f] of Object.entries(fields || {})) {
    const origin = owned.has(field) ? 'user' : originOf(out, field);
    // A non-empty value with NO recorded origin was saved before origins
    // existed: it is the person's (review, 2026-10-04 - the wizard applies the
    // same rule, so what is scored is what will be applied).
    const legacy = !origin && hasValue(getPath(out, field));
    if (legacy || (ORIGIN_RANK[origin] || 0) > ORIGIN_RANK[ORIGIN]) { kept.push({ field, origin: legacy ? 'unrecorded' : origin, kept_value: getPath(out, field) }); continue; }
    setPath(out, field, JSON.parse(JSON.stringify(f.value)));
    out.brand_data.field_origin[field] = ORIGIN;
    applied.push(field);
  }
  return { brand: out, applied, kept };
}

/* ═══ consumption: what a renderer reads ═══════════════════════════════════ */

const LEGACY = {
  head: "'Montserrat','Raleway',Georgia,serif",
  body: "'Instrument Sans','Helvetica Neue',Arial,sans-serif",
};

/** A stack that always ENDS in a generic family, so a missing web font degrades. */
function withFallback(stack, generic) {
  const s = String(stack || '').trim();
  if (!s) return '';
  return /(?:^|,)\s*(?:serif|sans-serif|monospace|system-ui|cursive)\s*$/i.test(s) ? s : `${s},${generic}`;
}
const cssStr = (s) => String(s || '').replace(/[<>"\\]/g, '');
/** A font stack safe inside a double-quoted HTML attribute or a <style> rule. */
const attrStack = (s) => String(s || '').replace(/"/g, "'").replace(/[<>;{}\\]/g, '').trim();
const fontName = (s) => String(s || '').replace(/['"\\<>;{}]/g, '').trim();

/**
 * The brand's own font files as @font-face rules, plus a Google Fonts import
 * where the family came from there. Only http(s) URLs that the browser itself
 * loaded on the site are ever emitted.
 */
function fontCss(ds) {
  const out = [];
  const google = [];
  for (const slot of ['heading', 'body']) {
    const f = ds && ds.fonts && ds.fonts[slot];
    if (!f || !f.family) continue;
    if (f.google) { google.push(f.family); continue; }
    for (const file of (f.files || []).slice(0, 6)) {
      if (!/^https?:\/\//.test(file.url || '')) continue;
      out.push(`@font-face{font-family:"${fontName(f.family)}";src:url("${cssStr(file.url)}")${file.format ? ` format("${cssStr(file.format)}")` : ''};font-weight:${cssStr(file.weight || '400')};font-style:${cssStr(file.style || 'normal')};font-display:swap}`);
    }
  }
  const href = google.length
    ? `https://fonts.googleapis.com/css2?${[...new Set(google)].map((g) => `family=${encodeURIComponent(g).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&')}&display=swap`
    : '';
  return { faces: out.join(''), googleHref: href };
}

/**
 * What a renderer reads. `present:false` means: render exactly as before.
 */
function resolve(brand) {
  const b = brand || {};
  const ds = b.brand_data && b.brand_data.design_system && b.brand_data.design_system.version ? b.brand_data.design_system : null;
  const t = b.typography || {};
  const headStack = (t.heading && t.heading.stack) || '';
  const bodyStack = (t.body && t.body.stack) || '';
  return {
    present: !!ds,
    ds,
    // The brand's OWN families wherever the record has them. The /lp/:id page
    // painted tenant zero's two families for every brand until this existed.
    head: withFallback(headStack, 'Georgia,serif') || LEGACY.head,
    body: withFallback(bodyStack, 'system-ui,-apple-system,Segoe UI,sans-serif') || LEGACY.body,
    fonts: withOwnFaces(ds ? fontCss(ds) : { faces: '', googleHref: '' }, t),
  };
}

/**
 * Font loading meets in brand-runtime.fontImport()/fontFaces(): a font the
 * brand supplied as a FILE (uploaded and hosted, or an https URL the operator
 * gave, typography[slot].src) is declared beside the faces the rendered read
 * found, whether or not a design system was measured.
 */
function withOwnFaces(fonts, t) {
  let own = '';
  try { own = require('./brand-runtime.js').fontFaces(t) || ''; } catch (_) { own = ''; }
  if (!own) return fonts;
  return { faces: (fonts.faces || '') + own, googleHref: fonts.googleHref || '' };
}

/** Text that sits on `ground`: the site's own colour when it clears AA there, else derived. */
function textOnGround(site, ground, surface, ink, sizePx, weight) {
  const k = core();
  const large = (sizePx || 0) >= 24 || ((sizePx || 0) >= 18.66 && Number(weight) >= 700);
  const need = large ? 3 : 4.5;
  const s = k.normHex(site);
  const g = k.normHex(ground) || '#ffffff';
  if (s && k.contrast(s, g) >= need) return { value: s, derived: false };
  const start = s || k.readableOn(g, ink || '#111111', surface || '#ffffff');
  // The site's own hue first, moved only as far as AA needs. On a mid-tone
  // ground the move away from it can run out (readableAsText walks one way),
  // and then the brand's own better text colour is used instead - never a
  // value that still fails.
  let v = k.readableAsText(start, g, need);
  if (k.contrast(v, g) < need) v = k.textOn(g, surface || '#ffffff', ink || '#111111', need);
  return {
    value: v, derived: true, from: s || '',
    ratio_site: s ? k.contrast(s, g) : null, ratio_ours: k.contrast(v, g), target: need,
  };
}

/**
 * The landing page's component CSS, from the design system. Returned as ONE
 * string the landing page emits after its own base rules, plus what it decided
 * (`derived`, `swapped`) so the regression report can say why a value differs.
 *
 * `ctx`: { surface, ink, primary } - the brand palette the page already uses.
 */
function lpCss(r, ctx) {
  if (!r || !r.present) return { css: '', derived: [], swapped: [], header: null };
  const k = core();
  const ds = r.ds;
  const c = ctx || {};
  const surface = c.surface || '#ffffff', ink = c.ink || '#111111';
  const derived = [], swapped = [];
  const rules = [];
  const tD = (ds.type && ds.type.desktop) || {}, tM = (ds.type && ds.type.mobile) || {};
  const typeRule = (sel, ty, extra) => {
    if (!ty) return;
    const parts = [];
    if (ty.size) parts.push(`font-size:${pxs(ty.size)}`);
    if (ty.weight) parts.push(`font-weight:${ty.weight}`);
    if (ty.line_height != null) parts.push(`line-height:${ty.line_height === 'normal' ? 'normal' : pxs(ty.line_height)}`);
    if (ty.letter_spacing != null) parts.push(`letter-spacing:${pxs(ty.letter_spacing)}`);
    if (ty.transform) parts.push(`text-transform:${ty.transform}`);
    if (ty.style && ty.style !== 'normal') parts.push(`font-style:${ty.style}`);
    if (extra) parts.push(extra);
    if (parts.length) rules.push(`${sel}{${parts.join(';')}}`);
  };
  // Families: the record's stacks (applied from the same read).
  rules.push(`body{font-family:${r.body}}`, `h1,h2,h3,.ds-head{font-family:${r.head}}`);
  // Section rhythm.
  const sec = (ds.components.section || {}).desktop || {};
  if (sec.container) rules.push(`.wrap{max-width:${Math.round(sec.container)}px}`);
  if (sec.pad_top || sec.pad_bottom) rules.push(`.sec{padding:${pxs(sec.pad_top || sec.pad_bottom)} 0 ${pxs(sec.pad_bottom || sec.pad_top)}}`);

  // Hero: the site's own hero ground and heading, under the hard rules.
  const heroD = (ds.components.hero || {}).desktop || null;
  let heroGround = null;
  if (heroD && heroD.ground && !heroD.over_media) {
    const g = k.sectionGround(heroD.ground, c.primary, surface);
    if (k.normHex(g) !== k.normHex(heroD.ground)) swapped.push({ component: 'hero', site: heroD.ground, ours: g, rule: 'no dark-neutral section ground in a generated asset' });
    heroGround = g;
  }
  if (heroGround) rules.push(`.hero{background:${heroGround}}`);
  const hg = heroGround || c.heroGround || c.primary || surface;
  const h1D = tD.h1 || tD.display || null;
  if (h1D) {
    const tx = textOnGround(h1D.color, hg, surface, ink, h1D.size, h1D.weight);
    if (tx.derived) derived.push({ token: 'hero.heading.color', site: tx.from, ours: tx.value, ratio_site: tx.ratio_site, ratio_ours: tx.ratio_ours, against: hg });
    typeRule('.hero h1', h1D, `color:${tx.value};max-width:none`);
    if (heroD && heroD.align) rules.push(`.hero{text-align:${heroD.align === 'start' ? 'left' : heroD.align}}`, `.hero h1,.hero p{margin-left:${heroD.align === 'center' ? 'auto' : '0'}}`);
  }
  const bodyD = tD.body || null;
  if (bodyD) {
    typeRule('body,.ds-body', bodyD);
    const tx = textOnGround(bodyD.color, surface, surface, ink, bodyD.size, bodyD.weight);
    rules.push(`body,.ds-body{color:${tx.value}}`);
    if (tx.derived) derived.push({ token: 'body.color', site: tx.from, ours: tx.value, ratio_site: tx.ratio_site, ratio_ours: tx.ratio_ours, against: surface });
    const heroBody = textOnGround(bodyD.color, hg, surface, ink, bodyD.size, bodyD.weight);
    typeRule('.hero p', bodyD, `color:${heroBody.value}`);
  }
  if (tD.h2) typeRule('.sec h2', tD.h2);

  // Buttons, default + hover + focus.
  const bp = ((ds.components.button || {}).primary) || {};
  const btn = (sel, b, hover, focus) => {
    if (!b) return;
    const parts = [];
    const ground = b.background || '';
    if (ground) parts.push(`background:${ground}`);
    if (b.background_image) parts.push(`background-image:${b.background_image}`);
    if (!ground && b.outlined) parts.push('background:transparent');
    const tx = textOnGround(b.color, ground || hg, surface, ink, b.size, b.weight);
    if (tx.derived) derived.push({ token: `${sel}.color`, site: tx.from, ours: tx.value, ratio_site: tx.ratio_site, ratio_ours: tx.ratio_ours, against: ground || hg });
    parts.push(`color:${tx.value}`);
    if (b.radius != null) parts.push(`border-radius:${pxs(b.radius)}`);
    if (Array.isArray(b.padding) && b.padding.every((v) => v != null)) parts.push(`padding:${b.padding.map(pxs).join(' ')}`);
    if (b.border_width) parts.push(`border:${pxs(b.border_width)} ${b.border_style || 'solid'} ${b.border_color || 'currentColor'}`);
    else parts.push('border:0');
    if (b.shadow) parts.push(`box-shadow:${b.shadow}`);
    if (b.size) parts.push(`font-size:${pxs(b.size)}`);
    if (b.weight) parts.push(`font-weight:${b.weight}`);
    if (b.transform) parts.push(`text-transform:${b.transform}`);
    if (b.letter_spacing != null) parts.push(`letter-spacing:${pxs(b.letter_spacing)}`);
    if (b.line_height != null) parts.push(`line-height:${b.line_height === 'normal' ? 'normal' : pxs(b.line_height)}`);
    if (b.stack) parts.push(`font-family:${withFallback(b.stack, 'sans-serif')}`);
    rules.push(`${sel}{${parts.join(';')}}`);
    if (hover) {
      const hp = [];
      if (hover.background) hp.push(`background:${hover.background}`);
      if (hover.color) hp.push(`color:${textOnGround(hover.color, hover.background || ground || hg, surface, ink, b.size, b.weight).value}`);
      if (hover.border_color) hp.push(`border-color:${hover.border_color}`);
      if (hover.shadow) hp.push(`box-shadow:${hover.shadow}`);
      if (hover.decoration && hover.decoration !== 'none') hp.push(`text-decoration:${hover.decoration}`);
      if (hp.length) rules.push(`${sel}:hover{${hp.join(';')}}`);
    }
    if (focus && (focus.outline || focus.shadow)) {
      const fp = [];
      if (focus.outline) fp.push(`outline:${focus.outline}`);
      if (focus.shadow) fp.push(`box-shadow:${focus.shadow}`);
      rules.push(`${sel}:focus-visible{${fp.join(';')}}`);
    }
  };
  btn('.btn', bp.desktop, bp.hover, bp.focus);
  const bs = ((ds.components.button || {}).secondary) || {};
  if (bs.desktop) btn('.btn-dark', bs.desktop, bs.hover, bs.focus);

  // Product card.
  const cd = (ds.components.card || {}).desktop || null;
  if (cd && cd.box) {
    const parts = [];
    const bg = cd.box.background || cd.box.ground || '';
    if (bg) parts.push(`background:${k.sectionGround(bg, surface)}`);
    if (cd.box.radius != null) parts.push(`border-radius:${pxs(cd.box.radius)}`);
    parts.push(cd.box.border_width ? `border:${pxs(cd.box.border_width)} ${cd.box.border_style || 'solid'} ${cd.box.border_color || 'transparent'}` : 'border:0');
    parts.push(`box-shadow:${cd.box.shadow || 'none'}`);
    if (Array.isArray(cd.box.padding) && cd.box.padding.every((v) => v != null)) parts.push(`padding:${cd.box.padding.map(pxs).join(' ')}`);
    rules.push(`.reveal{${parts.join(';')}}`);
    if (cd.image) {
      const ip = [];
      if (cd.image.aspect) ip.push(`aspect-ratio:${cd.image.aspect}`);
      if (cd.image.fit) ip.push(`object-fit:${cd.image.fit}`);
      if (cd.image.radius != null) ip.push(`border-radius:${pxs(cd.image.radius)}`);
      rules.push(`.ds-card-img{width:100%;height:auto;${ip.join(';')}}`);
    }
    if (cd.title) typeRule('.reveal .ds-card-title', cd.title, cd.title.color ? `color:${textOnGround(cd.title.color, bg || surface, surface, ink, cd.title.size, cd.title.weight).value}` : '');
    if (cd.price) typeRule('.reveal .price', cd.price, cd.price.color ? `color:${textOnGround(cd.price.color, bg || surface, surface, ink, cd.price.size, cd.price.weight).value}` : '');
    if (cd.badge && cd.badge.background) {
      const tx = textOnGround(cd.badge.color || (cd.badge.type && cd.badge.type.color), cd.badge.background, surface, ink, cd.badge.type && cd.badge.type.size, cd.badge.type && cd.badge.type.weight);
      rules.push(`.ds-badge{display:inline-block;background:${cd.badge.background};color:${tx.value};border-radius:${pxs(cd.badge.radius || 0)};padding:${(cd.badge.padding || [2, 8, 2, 8]).map((v) => pxs(v || 0)).join(' ')};font-size:${pxs((cd.badge.type && cd.badge.type.size) || 12)};font-weight:${(cd.badge.type && cd.badge.type.weight) || 600};text-transform:${(cd.badge.type && cd.badge.type.transform) || 'none'}}`);
    }
  }

  // Header bar + footer, under the section rule.
  const hd = (ds.components.header || {}).desktop || null;
  let header = null;
  if (hd) {
    const want = hd.background || hd.ground || surface;
    const g = k.sectionGround(want, surface);
    if (k.normHex(g) !== k.normHex(want)) swapped.push({ component: 'header', site: want, ours: g, rule: 'no dark-neutral section ground in a generated asset' });
    const link = hd.link || null;
    const linkTx = link ? textOnGround(link.color, g, surface, ink, link.size, link.weight) : { value: ink };
    rules.push(`.ds-header{background:${g};${hd.height ? `min-height:${pxs(hd.height)};` : ''}display:flex;align-items:center;justify-content:${hd.logo && hd.logo.placement === 'center' ? 'center' : 'space-between'};padding:0 22px;${hd.border_bottom ? `border-bottom:1px solid ${hd.border_bottom};` : ''}${hd.shadow ? `box-shadow:${hd.shadow};` : ''}}`);
    if (hd.logo && hd.logo.height) rules.push(`.ds-logo{height:${pxs(hd.logo.height)};width:auto;display:block}`);
    const lt = ds.logo && ds.logo.type;
    if (lt) {
      const tx = textOnGround(lt.color, g, surface, ink, lt.size, lt.weight);
      typeRule('.ds-logo-text', lt, `font-family:${withFallback(lt.stack, 'sans-serif') || r.head};color:${tx.value};text-decoration:none;display:inline-block`);
    }
    if (link) typeRule('.ds-header a.ds-nav', link, `color:${linkTx.value};text-decoration:${link.decoration || 'none'}`);
    header = { ground: g, logoHeight: hd.logo && hd.logo.height, placement: hd.logo && hd.logo.placement };
  }
  const fd = (ds.components.footer || {}).desktop || null;
  if (fd) {
    const want = fd.background || fd.ground || '';
    if (want) {
      const g = k.sectionGround(want, c.primary, surface);
      if (k.normHex(g) !== k.normHex(want)) swapped.push({ component: 'footer', site: want, ours: g, rule: 'no dark-neutral section ground in a generated asset' });
      const tx = textOnGround(fd.color, g, surface, ink, (fd.text && fd.text.size) || 12, (fd.text && fd.text.weight) || 400);
      if (tx.derived) derived.push({ token: 'footer.color', site: tx.from, ours: tx.value, ratio_site: tx.ratio_site, ratio_ours: tx.ratio_ours, against: g });
      rules.push(`footer{background:${g};color:${tx.value}}`);
      if (fd.text) typeRule('footer', fd.text);
    }
  }

  // Mobile: the same components at the site's own phone values.
  const mob = [];
  const mt = (sel, ty) => {
    if (!ty) return;
    const p = [];
    if (ty.size) p.push(`font-size:${pxs(ty.size)}`);
    if (ty.line_height != null) p.push(`line-height:${ty.line_height === 'normal' ? 'normal' : pxs(ty.line_height)}`);
    if (ty.letter_spacing != null) p.push(`letter-spacing:${pxs(ty.letter_spacing)}`);
    if (ty.weight) p.push(`font-weight:${ty.weight}`);
    if (p.length) mob.push(`${sel}{${p.join(';')}}`);
  };
  mt('.hero h1', tM.h1 || tM.display);
  mt('.hero p', tM.body);
  mt('body,.ds-body', tM.body);
  mt('.sec h2', tM.h2);
  const bpm = bp.mobile;
  if (bpm) {
    const p = [];
    if (Array.isArray(bpm.padding) && bpm.padding.every((v) => v != null)) p.push(`padding:${bpm.padding.map(pxs).join(' ')}`);
    if (bpm.size) p.push(`font-size:${pxs(bpm.size)}`);
    if (bpm.radius != null) p.push(`border-radius:${pxs(bpm.radius)}`);
    if (bpm.letter_spacing != null) p.push(`letter-spacing:${pxs(bpm.letter_spacing)}`);
    if (p.length) mob.push(`.btn{${p.join(';')}}`);
  }
  const hm = (ds.components.header || {}).mobile;
  if (hm && hm.height) mob.push(`.ds-header{min-height:${pxs(hm.height)}}`);
  if (hm && hm.logo && hm.logo.height) mob.push(`.ds-logo{height:${pxs(hm.logo.height)}}`);
  const sm = (ds.components.section || {}).mobile || {};
  if (sm.pad_top || sm.pad_bottom) mob.push(`.sec{padding:${pxs(sm.pad_top || sm.pad_bottom)} 0 ${pxs(sm.pad_bottom || sm.pad_top)}}`);
  const css = rules.join('\n') + (mob.length ? `\n@media(max-width:640px){${mob.join('')}}` : '');
  return { css, derived, swapped, header };
}

/**
 * EMAIL is a different medium and is held to different rules - stated here
 * because the regression engine depends on it:
 *   * table layout, inline styles, the Word engine in Outlook: no flex, no
 *     grid, no hover/focus states a client is guaranteed to honour, and
 *     border-radius is dropped by Outlook (the button squares off);
 *   * web fonts load in a minority of clients, so a family is always followed
 *     by a declared fallback stack ending in a generic family;
 *   * no JavaScript, ever.
 * So a mailer is scored at COMPONENT level (button, heading, body, colour,
 * spacing tokens), never by pixels against a web page, and its type is compared
 * with the site's PHONE values - a 600px email column is far closer to a phone
 * than to a 1440px desktop.
 */
function emailTokens(r, pal) {
  const k = core();
  const p = pal || {};
  const surface = p.surface || '#ffffff', ink = p.ink || '#111111';
  if (!r || !r.present) return null;
  const ds = r.ds;
  const tm = (ds.type && ds.type.mobile) || {};
  const td = (ds.type && ds.type.desktop) || {};
  const bt = (((ds.components || {}).button || {}).primary || {});
  const b = bt.mobile || bt.desktop || null;
  const h1 = tm.h1 || tm.display || td.h1 || null;
  const body = tm.body || td.body || null;
  const derived = [];
  // THE FONT LEGAL GATE: a generated email never carries a site's font
  // binaries - no @font-face pointing at the brand's files, nothing copied.
  // An openly licensed (Google) family is linked by reference; a brand font
  // is named first in the stack, so a client that has it installed uses it,
  // and every other client draws the declared fallback.
  const brandFonts = ['heading', 'body'].map((s) => ds.fonts && ds.fonts[s]).filter((f) => f && f.family && !f.google && f.licence === 'brand font').map((f) => f.family);
  const out = { head: r.head, body: r.body, faces: '', googleHref: r.fonts.googleHref, brand_fonts: brandFonts };
  if (h1) out.h1 = { size: h1.size, weight: h1.weight, line_height: h1.line_height, letter_spacing: h1.letter_spacing, transform: h1.transform, color: h1.color };
  if (body) out.text = { size: body.size, line_height: body.line_height, color: body.color };
  if (b) {
    const ground = b.background || p.primary || surface;
    const tx = textOnGround(b.color, ground, surface, ink, b.size, b.weight);
    if (tx.derived) derived.push({ token: 'button.color', site: tx.from, ours: tx.value, ratio_site: tx.ratio_site, ratio_ours: tx.ratio_ours, against: ground });
    out.button = {
      background: ground, color: tx.value, radius: b.radius, padding: b.padding,
      size: b.size, weight: b.weight, transform: b.transform, letter_spacing: b.letter_spacing,
      border: b.border_width ? `${pxs(b.border_width)} ${b.border_style || 'solid'} ${b.border_color || ground}` : '',
      // SINGLE quotes: this stack is written into a double-quoted style=""
      // attribute, and the computed value quotes family names with double
      // quotes - which closed the attribute at `font-family:` and dropped the
      // button's family, size, weight and radius in every mailer (found by the
      // drawn-face comparison, 2026-10-04).
      stack: attrStack(withFallback(b.stack, 'Arial,sans-serif') || r.body),
    };
  }
  out.derived = derived;
  // Every text colour an email paints on its white card goes through AA too.
  if (out.h1 && out.h1.color) out.h1.color = textOnGround(out.h1.color, '#ffffff', surface, ink, out.h1.size, out.h1.weight).value;
  if (out.text && out.text.color) out.text.color = textOnGround(out.text.color, '#ffffff', surface, ink, out.text.size, 400).value;
  return out;
}

/** The ad creative's CTA and headline, from the same system. */
function adTokens(r) {
  if (!r || !r.present) return null;
  const ds = r.ds;
  const bt = (((ds.components || {}).button || {}).primary || {});
  const b = bt.mobile || bt.desktop || null;
  const tm = (ds.type && ds.type.mobile) || {};
  const h = tm.h1 || tm.display || null;
  return {
    head: r.head, body: r.body, faces: r.fonts.faces, googleHref: r.fonts.googleHref,
    // The CTA's own family too: the ad set its label in the body face while
    // the site's button draws its own (found by the drawn-face comparison).
    cta: b ? { background: b.background, color: b.color, radius: b.radius, weight: b.weight, transform: b.transform, letter_spacing: b.letter_spacing, padding: b.padding, size: b.size, border_width: b.border_width, border_color: b.border_color, stack: attrStack(withFallback(b.stack, 'Arial,sans-serif')) } : null,
    headline: h ? { weight: h.weight, transform: h.transform, letter_spacing: h.letter_spacing } : null,
  };
}

module.exports = {
  DS_VERSION, ORIGIN, ORIGIN_RANK, LEGACY,
  fromManifest, applyFields, applyToBrand, originOf, getPath, setPath,
  resolve, fontCss, withFallback, textOnGround, lpCss, emailTokens, adTokens,
};
