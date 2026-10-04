'use strict';
/**
 * render-regression.js — how close is what WE generate to the brand's own site.
 * ---------------------------------------------------------------------------
 * The operator's pipeline ends: site generator -> rendered clone -> visual
 * regression -> mismatch > limit ? repair : DONE. The "site generator" here is
 * NOT a throwaway clone page. It is this platform's real renderers, fed by the
 * manifest exactly as the wizard applies it (design-system.applyFields):
 *
 *   landing page   smart-brain-plan.lpHtml - the page served at /lp/:id
 *   mailer         calendar-trigger.renderTextVariant - the Mailer Calendar and
 *                  Smart Brain email renderer
 *   ad creative    scripts/lib/motion-ad.js renderMotionAd - the Smart Brain's
 *                  per-brand video creative
 *
 * Each is rendered in the same browser at the same viewports and compared,
 * component by component, with the matching part of the brand's own pages:
 * our header vs theirs, our hero heading vs their display heading, our call to
 * action vs their primary button, our product card vs their product card, our
 * footer vs theirs.
 *
 * ── THE SCORE, DEFINED ─────────────────────────────────────────────────────
 * TOKENS. Every compared property is within its TOLERANCE or it is not:
 *   colour            CIEDE2000 dE <= 2.3. 2.3 is the commonly used "just
 *                     noticeable difference": below it two colours read as one.
 *   font family       the family that renders, exact (case-insensitive).
 *   size, line-height +-0.5px: below the rounding a browser applies to rem/em.
 *   letter-spacing    +-0.1px.
 *   weight, transform exact.
 *   radius            +-0.5px. padding +-1px. heights +-4px (a bar's height
 *                     includes its content, which is not ours to copy).
 *   image aspect      +-0.03 (a 4:5 card is 0.8; 0.77 already reads square-er).
 * An item our renderer deliberately does differently is EXEMPT, listed with its
 * reason, and not counted: a text colour derived for WCAG AA (both ratios
 * shown), a dark-neutral section ground swapped by the hard rule, an email
 * constraint (below).
 *
 * PIXELS. For the components whose pixels are comparable - the primary button
 * and the display heading, at desktop and phone width - a specimen of OUR
 * element (its computed styles, the source's text, width and ground) is
 * screenshotted and diffed against the source element's own screenshot with
 * pixelmatch (YIQ threshold 0.1, anti-aliasing excluded). The region ratio is
 * differing pixels / pixels of the larger of the two images. A component whose
 * source sits on a photograph is not pixel-comparable and says so.
 *
 *   mismatch = 0.7 x (tokens out of tolerance / tokens compared)
 *            + 0.3 x (regions over PIXEL_LIMIT / regions compared)
 *   score    = 1 - mismatch, per surface (landing page, mailer, ad)
 *   DONE     when mismatch <= MISMATCH_LIMIT and no repairable item remains.
 *
 * Tokens weigh more than pixels because a token is an exact measurement of a
 * design decision, and a pixel diff mostly CORROBORATES them (it also catches
 * what no token names: a gradient, a text shadow, an icon). PIXEL_LIMIT 0.03:
 * the same browser drawing the same font file at the same size differs only by
 * sub-pixel glyph positioning, measured at under 1% on the fixtures; 3% leaves
 * room for that and fails on any real difference in size, weight, spacing or
 * colour. MISMATCH_LIMIT 0.05: at most one token in twenty, and nothing the
 * repair loop can still fix.
 *
 * ── REPAIR RE-MEASURES THE SOURCE. IT NEVER CHASES PIXELS. ─────────────────
 * For an item over its limit the loop re-reads THAT role off the brand's page
 * with the next strategy (the element again, its text-carrying descendant, the
 * composited ground behind it, the filled ancestor) and, when the source says
 * something different from the manifest, corrects the manifest and regenerates.
 * When every strategy confirms the manifest value, the difference is in how OUR
 * renderer consumes it, and the item is reported unmatched with that reason
 * and its best measured value. No value is ever nudged toward a target to
 * shrink a diff, and nothing is invented to fill one.
 *
 * ── EMAIL IS SCORED DIFFERENTLY, ON PURPOSE ─────────────────────────────────
 * A mailer is a table layout read by the Word engine in Outlook, web fonts load
 * in a minority of clients, there is no JavaScript and no hover a client is
 * guaranteed to honour. It is scored on COMPONENT TOKENS only - button,
 * heading, body copy, colours, spacing - against the site's PHONE values (a
 * 600px column is a phone, not a desktop), never by pixels against a web page.
 * A family counts as matched only when a generic fallback is declared after it.
 */

const TOLERANCE = {
  color: 2.3, size: 0.5, line_height: 0.5, letter_spacing: 0.1, radius: 0.5, padding: 1, height: 4, aspect: 0.03, width: 6,
};
const PIXEL_LIMIT = 0.03;
const MISMATCH_LIMIT = 0.05;
const MAX_ITER = 3;
/*
 * TWO SCORES, reported separately, and approval needs BOTH (2026-10-04):
 *  STRUCTURAL - deterministic: role geometry, colours as CIEDE2000, family,
 *    size, weight, line-height, radius, spacing, each within its tolerance.
 *    Limit 0.95: at most one token in twenty out of tolerance. A token is an
 *    exact measurement of a design decision, and more than one in twenty off
 *    is a difference a reader sees on the page.
 *  PERCEPTUAL - pixelmatch of OUR element against the site's, with the TEXT
 *    boxes and the VOLATILE pixels (what changed between two shots ~500 ms
 *    apart, on either side) masked, so glyph anti-aliasing and live content
 *    cannot fail it. Score = 1 - the worst region's share of unmasked pixels
 *    that differ. Limit 0.97 (= PIXEL_LIMIT): what is left after the masks is
 *    grounds, borders and shapes, which the same engine draws identically; 3%
 *    of them differing is a real difference in size, radius or colour.
 */
const STRUCTURAL_LIMIT = 0.95;
const PERCEPTUAL_LIMIT = 1 - PIXEL_LIMIT;
const VOLATILE_WAIT_MS = 500;

/* ── colour science: sRGB hex -> CIELAB (D65) -> CIEDE2000 ──────────────── */
function hexRgb(h) {
  const s = String(h || '').replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-f]{6}$/i.test(f)) return null;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
}
function lab(hex) {
  const c = hexRgb(hex);
  if (!c) return null;
  const lin = c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  const X = (lin[0] * 0.4124564 + lin[1] * 0.3575761 + lin[2] * 0.1804375) / 0.95047;
  const Y = (lin[0] * 0.2126729 + lin[1] * 0.7151522 + lin[2] * 0.0721750);
  const Z = (lin[0] * 0.0193339 + lin[1] * 0.1191920 + lin[2] * 0.9503041) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
/** CIEDE2000 (Sharma, Wu & Dalal 2005). */
function deltaE2000(a, b) {
  const A = lab(a), B = lab(b);
  if (!A || !B) return Infinity;
  const [L1, a1, b1] = A, [L2, a2, b2] = B;
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (x, y) => { if (x === 0 && y === 0) return 0; const v = Math.atan2(y, x) * deg; return v < 0 ? v + 360 : v; };
  const h1p = h(a1p, b1), h2p = h(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hbp += (hbp < 360 ? 360 : -360); hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}

/* ── one token, compared ─────────────────────────────────────────────────── */
const famOf = (v) => String(v || '').split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
function compareToken(kind, site, ours) {
  if (site == null || site === '' || ours == null || ours === '') return { comparable: false };
  if (kind === 'color') { const d = deltaE2000(site, ours); return { comparable: true, pass: d <= TOLERANCE.color, distance: Math.round(d * 100) / 100, unit: 'dE2000' }; }
  if (kind === 'family') return { comparable: true, pass: famOf(site) === famOf(ours), distance: famOf(site) === famOf(ours) ? 0 : 1, unit: 'family' };
  if (kind === 'face') { const a = String(site).toLowerCase(), b = String(ours).toLowerCase(); return { comparable: true, pass: a === b, distance: a === b ? 0 : 1, unit: 'drawn face' }; }
  if (kind === 'exact') return { comparable: true, pass: String(site) === String(ours), distance: String(site) === String(ours) ? 0 : 1, unit: '' };
  if (kind === 'shadow') { const a = !!site, b = !!ours; return { comparable: true, pass: a === b, distance: a === b ? 0 : 1, unit: 'present' }; }
  if (site === 'normal' || ours === 'normal') return { comparable: true, pass: site === ours, distance: site === ours ? 0 : 1, unit: '' };
  const d = Math.abs(Number(site) - Number(ours));
  if (!Number.isFinite(d)) return { comparable: false };
  return { comparable: true, pass: d <= (TOLERANCE[kind] != null ? TOLERANCE[kind] : 0.5), distance: Math.round(d * 1000) / 1000, unit: kind === 'aspect' ? 'ratio' : 'px' };
}

/* ── pixels ─────────────────────────────────────────────────────────────── */
function pixelRatio(aBuf, bBuf, groundHex, opts) {
  const o = opts || {};
  const { PNG } = require('pngjs');
  const pixelmatch = require('pixelmatch');
  const A = PNG.sync.read(aBuf), B = PNG.sync.read(bBuf);
  const w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
  const g = hexRgb(groundHex) || [255, 255, 255];
  const pad = (P) => {
    const out = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) { out.data[i * 4] = g[0]; out.data[i * 4 + 1] = g[1]; out.data[i * 4 + 2] = g[2]; out.data[i * 4 + 3] = 255; }
    PNG.bitblt(P, out, 0, 0, Math.min(P.width, w), Math.min(P.height, h), 0, 0);
    return out;
  };
  const pa = pad(A), pb = pad(B);
  // The raw comparison, kept for the record.
  const raw = pixelmatch(pa.data, pb.data, null, w, h, { threshold: 0.1, includeAA: false });
  // MASKS: 1 = text (both sides' text boxes, dilated 2px), 2 = volatile (a
  // pixel that changed between two shots of the SAME side).
  const mask = new Uint8Array(w * h);
  const rects = [].concat(o.textA || [], o.textB || []);
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x) - 2), y0 = Math.max(0, Math.floor(r.y) - 2);
    const x1 = Math.min(w, Math.ceil(r.x + r.w) + 2), y1 = Math.min(h, Math.ceil(r.y + r.h) + 2);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1;
  }
  const volatileFrom = (first, secondBuf) => {
    if (!secondBuf) return;
    let S;
    try { S = pad(PNG.sync.read(secondBuf)); } catch (_) { return; }
    for (let i = 0; i < w * h; i++) {
      const k = i * 4;
      if (Math.abs(first.data[k] - S.data[k]) > 8 || Math.abs(first.data[k + 1] - S.data[k + 1]) > 8 || Math.abs(first.data[k + 2] - S.data[k + 2]) > 8) mask[i] = 2;
    }
  };
  volatileFrom(pa, o.a2);
  volatileFrom(pb, o.b2);
  let text = 0, vol = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    if (mask[i] === 1) text += 1; else vol += 1;
    const k = i * 4;
    pb.data[k] = pa.data[k]; pb.data[k + 1] = pa.data[k + 1]; pb.data[k + 2] = pa.data[k + 2]; pb.data[k + 3] = pa.data[k + 3];
  }
  const unmasked = w * h - text - vol;
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(pa.data, pb.data, diff.data, w, h, { threshold: 0.1, includeAA: false });
  return {
    ratio: unmasked > 0 ? Math.round((n / unmasked) * 10000) / 10000 : 0, pixels: n,
    raw_ratio: Math.round((raw / (w * h)) * 10000) / 10000,
    masked: { text, volatile: vol, of: w * h },
    size: [w, h], site_size: [A.width, A.height], ours_size: [B.width, B.height], diff_png: PNG.sync.write(diff),
  };
}

/* ── sample content: the site's own words in our templates ───────────────── */
function sampleFrom(manifest) {
  const r = (manifest.read && manifest.read.desktop && manifest.read.desktop.roles) || {};
  const card = r.card || (manifest.card_source && manifest.card_source.desktop && manifest.card_source.desktop.card) || null;
  const head = r.display || (r.headings && r.headings.h1) || null;
  return {
    headline: (head && head.text) || 'Heading',
    body: ((r.body && r.body.text) || 'Body copy').slice(0, 220),
    cta: (r.button_primary && (r.button_primary.label || r.button_primary.text)) || 'Shop now',
    product: card && card.title ? card.title.text : '',
    price: card && card.price ? card.price.text : '',
    product_image: card && card.image ? card.image.src : '',
    hero_image: r.hero_image ? r.hero_image.src : '',
  };
}

/** The brand the renderers see: the patch applied over the caller's brand. */
function brandFor(manifest, base) { return brandAsApplied(manifest, base).brand; }
/**
 * The brand AS THE READ WILL BE APPLIED TO IT: the caller's record (or none)
 * with the read applied under the same ownership rule the wizard uses, and
 * the decision returned so the report can say which fields were kept.
 */
function brandAsApplied(manifest, base) {
  const ds = require('./design-system.js');
  const host = (() => { try { return new URL(manifest.url).hostname; } catch (_) { return ''; } })();
  const src = base && typeof base === 'object' ? JSON.parse(JSON.stringify(base)) : {};
  // An empty name or website in the record is not a value: the preview's own stands in.
  for (const k of ['name', 'website']) if (!src[k]) delete src[k];
  const b = Object.assign({ id: 'site-read-preview', name: host || 'Brand', website: manifest.url, palette: {}, typography: {}, voice: {}, regions: [], brand_data: {} }, src);
  b.id = 'site-read-preview';
  const { brand, applied, kept } = ds.applyToBrand(b, ds.applyFields(manifest), {});
  if (!(brand.regions || []).length) brand.regions = [{ code: 'HOME', currency: '', symbol: '', store_url: manifest.url, home: true }];
  return { brand, applied, kept };
}
/** The kept field a mismatched row is explained by, if any. */
function keptFieldFor(row, keptSet) {
  let f = '';
  if (/logo|wordmark/.test(row.token) || row.component === 'header' && /logo/.test(row.token)) f = 'logo_url';
  else if (row.kind === 'family' || row.kind === 'face') f = /heading|headline|hero|display/.test(row.component) ? 'typography.heading' : 'typography.body';
  return f && keptSet.has(f) ? f : '';
}

/** Render our three surfaces for the brand. */
function renderOurs(brand, sample) {
  const sb = require('./smart-brain-plan.js');
  const ct = require('./calendar-trigger.js').helpers;
  const motion = require('../../scripts/lib/motion-ad.js');
  const entry = {
    brand, market: (brand.regions[0] && brand.regions[0].code) || '', workspace_id: brand.id,
    heroProduct: { title: sample.product || sample.headline, price: null, category: '', handle: '', image: sample.product_image },
    cta: sample.cta, __reviews: [],
  };
  const copy = { landing: { hero_headline: sample.headline, hero_sub: sample.body, cta: sample.cta, why_title: '', why_bullets: [sample.body], faq: [] } };
  const lp = sb.lpHtml(entry, copy, 'site-read-preview', '', { priceText: sample.price, productImage: sample.product_image });
  // EVERY mailer style, not the default one: a gate driven by one style has
  // holes in the shape of the others (CLAUDE.md: drive every archetype).
  const mailers = {};
  for (const style of MAILER_STYLES) {
    mailers[style] = ct.renderTextVariant({
      style, brand, subject: sample.headline, hero_headline: sample.headline, hero_subline: sample.body,
      body_blocks: [], cta_text: sample.cta, cta_url: brand.website || '#', market: entry.market, products: [],
    });
  }
  const mailer = mailers.editorial;
  const ad = motion.renderMotionAd({ brand, product: sample.product || sample.headline, scenes: [{ image: sample.hero_image || sample.product_image || '', headline: sample.headline, seconds: 2.6 }], cta: sample.cta, ctaHeadline: sample.headline, audio: false, loop: false });
  return { lp, mailer, mailers, ad };
}
const MAILER_STYLES = ['editorial', 'visual', 'pure', 'founder'];

/* ── what is compared, component by component ───────────────────────────── */
const T = (type) => type || {};
function lpPairs(site, ours, viewport) {
  const r = site.roles || {};
  const head = r.display || (r.headings && r.headings.h1) || null;
  const pairs = [];
  const add = (component, token, kind, s, o, extra) => pairs.push(Object.assign({ surface: 'landing page', viewport, component, token, kind, site: s, ours: o }, extra || {}));
  const o = ours || {};
  if (r.header && o.header) {
    add('header', 'background', 'color', (r.header.style && r.header.style.background) || r.header.ground, o.header.style.background || o.header.style.ground, { role: 'header', prop: 'background' });
    add('header', 'height', 'height', r.header.style && r.header.style.height, o.header.style.height);
  }
  if (r.logo && r.logo.kind === 'text' && r.logo.type && o.logo) {
    // A wordmark set in type: its type is the logo.
    add('header', 'wordmark font size', 'size', r.logo.type.size, T(o.logo.type).size);
    add('header', 'wordmark weight', 'exact', r.logo.type.weight, T(o.logo.type).weight);
    add('header', 'wordmark colour', 'color', r.logo.type.color, T(o.logo.type).color, { aa_ground: o.logo.style.ground });
    add('header', 'wordmark family', 'family', r.logo.type.family_kind === 'webfont' ? r.logo.type.family : r.logo.type.stack, T(o.logo.type).stack);
  } else if (r.logo && r.logo.rendered && o.logo) add('header', 'logo height', 'height', r.logo.rendered.h, o.logo.box.h);
  if (head && o.h1) {
    const st = T(head.type), ot = T(o.h1.type);
    add('hero heading', 'font family', 'family', st.family_kind === 'webfont' ? st.family : st.stack, ot.stack, { role: head === r.display ? 'display' : 'h1', prop: 'stack' });
    add('hero heading', 'font size', 'size', st.size, ot.size, { role: head === r.display ? 'display' : 'h1', prop: 'size' });
    add('hero heading', 'font weight', 'exact', st.weight, ot.weight, { role: head === r.display ? 'display' : 'h1', prop: 'weight' });
    add('hero heading', 'line height', 'line_height', st.line_height, ot.line_height, { role: head === r.display ? 'display' : 'h1', prop: 'line_height' });
    add('hero heading', 'letter spacing', 'letter_spacing', st.letter_spacing, ot.letter_spacing, { role: head === r.display ? 'display' : 'h1', prop: 'letter_spacing' });
    add('hero heading', 'text transform', 'exact', st.transform, ot.transform, { role: head === r.display ? 'display' : 'h1', prop: 'transform' });
    add('hero heading', 'colour', 'color', st.color, ot.color, { role: head === r.display ? 'display' : 'h1', prop: 'color', aa_ground: o.h1.style.ground });
  }
  if (r.body && o.body) {
    const st = T(r.body.type), ot = T(o.body.type);
    add('body copy', 'font family', 'family', st.family_kind === 'webfont' ? st.family : st.stack, ot.stack, { role: 'body', prop: 'stack' });
    add('body copy', 'font size', 'size', st.size, ot.size, { role: 'body', prop: 'size' });
    add('body copy', 'line height', 'line_height', st.line_height, ot.line_height, { role: 'body', prop: 'line_height' });
    add('body copy', 'colour', 'color', st.color, ot.color, { role: 'body', prop: 'color', aa_ground: o.body.style.ground });
  }
  const b = r.button_primary, ob = o['button-primary'];
  if (b && ob) {
    const ss = b.style || {}, st = T(b.type), os = ob.style || {}, ot = T(ob.type);
    add('primary button', 'background', 'color', ss.background, os.background, { role: 'button-primary', prop: 'background' });
    add('primary button', 'label colour', 'color', st.color, ot.color, { role: 'button-primary', prop: 'color', aa_ground: os.background });
    add('primary button', 'corner radius', 'radius', ss.radius, os.radius, { role: 'button-primary', prop: 'radius' });
    ['top', 'right', 'bottom', 'left'].forEach((side, i) => add('primary button', `padding ${side}`, 'padding', ss.padding && ss.padding[i], os.padding && os.padding[i]));
    add('primary button', 'font size', 'size', st.size, ot.size, { role: 'button-primary', prop: 'size' });
    add('primary button', 'font weight', 'exact', st.weight, ot.weight, { role: 'button-primary', prop: 'weight' });
    add('primary button', 'text transform', 'exact', st.transform, ot.transform, { role: 'button-primary', prop: 'transform' });
    add('primary button', 'letter spacing', 'letter_spacing', st.letter_spacing, ot.letter_spacing, { role: 'button-primary', prop: 'letter_spacing' });
    add('primary button', 'border width', 'padding', ss.border_width || 0, os.border_width || 0);
    add('primary button', 'font family', 'family', st.family_kind === 'webfont' ? st.family : st.stack, ot.stack, { role: 'button-primary', prop: 'stack' });
  }
  const c = r.card, oc = o.card;
  if (c && oc) {
    const cs = c.style || {}, os = oc.style || {};
    add('product card', 'corner radius', 'radius', cs.radius, os.radius);
    add('product card', 'shadow', 'shadow', cs.shadow, os.shadow);
    add('product card', 'border width', 'padding', cs.border_width || 0, os.border_width || 0);
    if (c.image && o['card-image']) add('product card', 'image aspect ratio', 'aspect', c.image.aspect, o['card-image'].aspect);
    if (c.title && o['card-title']) {
      add('product card', 'title size', 'size', T(c.title.type).size, T(o['card-title'].type).size);
      add('product card', 'title weight', 'exact', T(c.title.type).weight, T(o['card-title'].type).weight);
      add('product card', 'title family', 'family', T(c.title.type).family_kind === 'webfont' ? T(c.title.type).family : T(c.title.type).stack, T(o['card-title'].type).stack);
    }
    if (c.price && o['card-price']) {
      add('product card', 'price size', 'size', T(c.price.type).size, T(o['card-price'].type).size);
      add('product card', 'price colour', 'color', T(c.price.type).color, T(o['card-price'].type).color, { aa_ground: o['card-price'].style.ground });
    }
  }
  if (r.footer && o.footer) {
    add('footer', 'background', 'color', (r.footer.style && r.footer.style.background) || r.footer.ground, o.footer.style.background || o.footer.style.ground);
    if (r.footer.text) add('footer', 'text colour', 'color', r.footer.text.color, T(o.footer.type).color, { aa_ground: o.footer.style.background || o.footer.style.ground });
  }
  const L = (site.layout && site.layout.container) || null;
  if (L && o.wrap && viewport === 'desktop') add('section rhythm', 'container width', 'width', L.width, o.wrap.style.max_width || o.wrap.style.width);
  facePairs(site, o, add, [['hero heading', head === r.display ? 'display' : 'h1', 'h1'], ['body copy', 'body', 'body'], ['primary button', 'button-primary', 'button-primary'], ['product card', 'card-title', 'card-title']]);
  return pairs;
}

/** The face that DREW each role, site vs ours (CDP platform fonts). */
function facePairs(site, ours, add, map) {
  const sd = (site && site.drawn) || {}, od = (ours && ours.__drawn) || {};
  for (const [component, siteKey, ourKey] of map) {
    const a = sd[siteKey] || (siteKey === 'display' ? sd.h1 : null);
    const b = od[ourKey];
    if (a && b) add(component, 'drawn face', 'face', a.family, b.family);
  }
}

function emailPairs(siteMobile, siteDesktop, ours) {
  const r = (siteMobile && siteMobile.roles) || (siteDesktop && siteDesktop.roles) || {};
  const head = r.display || (r.headings && r.headings.h1) || null;
  const pairs = [];
  const add = (component, token, kind, s, o, extra) => pairs.push(Object.assign({ surface: 'mailer', viewport: 'email (phone values)', component, token, kind, site: s, ours: o }, extra || {}));
  const o = ours || {};
  if (head && o.h1) {
    const st = T(head.type), ot = T(o.h1.type);
    add('heading', 'font family', 'family', st.family_kind === 'webfont' ? st.family : st.stack, ot.stack, { email_fallback: /(?:serif|sans-serif|monospace|system-ui)\s*$/i.test(String(ot.stack || '').trim()) });
    add('heading', 'font size', 'size', st.size, ot.size);
    add('heading', 'font weight', 'exact', st.weight, ot.weight);
    add('heading', 'letter spacing', 'letter_spacing', st.letter_spacing, ot.letter_spacing);
    add('heading', 'text transform', 'exact', st.transform, ot.transform);
    add('heading', 'colour', 'color', st.color, ot.color, { aa_ground: o.h1.style.ground });
  }
  if (r.body && o.body) {
    add('body copy', 'font size', 'size', T(r.body.type).size, T(o.body.type).size);
    add('body copy', 'line height', 'line_height', T(r.body.type).line_height, T(o.body.type).line_height);
    add('body copy', 'colour', 'color', T(r.body.type).color, T(o.body.type).color, { aa_ground: o.body.style.ground });
  }
  const b = r.button_primary, ob = o['button-primary'];
  if (b && ob) {
    const ss = b.style || {}, st = T(b.type), os = ob.style || {}, ot = T(ob.type);
    add('button', 'background', 'color', ss.background, os.background);
    add('button', 'label colour', 'color', st.color, ot.color, { aa_ground: os.background });
    add('button', 'corner radius', 'radius', ss.radius, os.radius, { email_note: 'Outlook\'s Word engine drops border-radius; the button squares off there and this value holds everywhere else.' });
    add('button', 'padding top', 'padding', ss.padding && ss.padding[0], os.padding && os.padding[0]);
    add('button', 'padding left', 'padding', ss.padding && ss.padding[3], os.padding && os.padding[3]);
    add('button', 'font size', 'size', st.size, ot.size);
    add('button', 'font weight', 'exact', st.weight, ot.weight);
    add('button', 'text transform', 'exact', st.transform, ot.transform);
    add('button', 'letter spacing', 'letter_spacing', st.letter_spacing, ot.letter_spacing);
  }
  facePairs((siteMobile && siteMobile.drawn) ? siteMobile : siteDesktop, o, add, [['heading', head === r.display ? 'display' : 'h1', 'h1'], ['body copy', 'body', 'body'], ['button', 'button-primary', 'button-primary']]);
  return pairs;
}

function adPairs(siteMobile, ours) {
  const r = (siteMobile && siteMobile.roles) || {};
  const head = r.display || (r.headings && r.headings.h1) || null;
  const pairs = [];
  const add = (component, token, kind, s, o, extra) => pairs.push(Object.assign({ surface: 'ad creative', viewport: '9:16 (phone values)', component, token, kind, site: s, ours: o }, extra || {}));
  const o = ours || {};
  if (head && o.headline) {
    add('headline', 'font family', 'family', T(head.type).family_kind === 'webfont' ? T(head.type).family : T(head.type).stack, T(o.headline.type).stack);
    add('headline', 'font weight', 'exact', T(head.type).weight, T(o.headline.type).weight);
    add('headline', 'text transform', 'exact', T(head.type).transform, T(o.headline.type).transform);
  }
  const b = r.button_primary, ob = o['button-primary'];
  if (b && ob) {
    add('call to action', 'background', 'color', b.style.background, ob.style.background);
    add('call to action', 'label colour', 'color', T(b.type).color, T(ob.type).color, { aa_ground: ob.style.background });
    add('call to action', 'corner radius', 'radius', b.style.radius, ob.style.radius);
    add('call to action', 'font weight', 'exact', T(b.type).weight, T(ob.type).weight);
    add('call to action', 'text transform', 'exact', T(b.type).transform, T(ob.type).transform);
  }
  facePairs(siteMobile, o, add, [['headline', head === r.display ? 'display' : 'h1', 'headline'], ['call to action', 'button-primary', 'button-primary']]);
  return pairs;
}

/** Judge every pair; exempt what a hard rule or a medium constraint decided. */
function judge(pairs, ctx) {
  const k = require('./brand-workspace-core.js');
  const swapped = (ctx && ctx.swapped) || [];
  return pairs.map((p) => {
    const c = compareToken(p.kind, p.site, p.ours);
    const row = Object.assign({}, p, c);
    if (!c.comparable) { row.status = 'not-comparable'; return row; }
    if (c.pass) { row.status = 'match'; return row; }
    // WCAG: the site's own pair fails AA where we paint it, so ours is derived.
    if (p.kind === 'color' && p.aa_ground && p.site && p.ours) {
      const need = 4.5;
      const rs = k.contrast(p.site, p.aa_ground), ro = k.contrast(p.ours, p.aa_ground);
      if (rs < need && ro >= rs) { row.status = 'exempt'; row.reason = `hard rule: WCAG AA. Your ${p.site} is ${rs}:1 on ${p.aa_ground}; ours is DERIVED from it at ${ro}:1.`; return row; }
    }
    if (p.kind === 'color' && /background/.test(p.token) && swapped.some((s) => s.component === p.component.split(' ')[0] || (s.component === 'hero' && p.component === 'hero heading'))) {
      const s = swapped.find((x) => x.component === p.component.split(' ')[0]) || {};
      row.status = 'exempt'; row.reason = `hard rule: no dark-neutral section ground. Your site paints ${s.site || p.site}; ours uses ${s.ours || p.ours}.`; return row;
    }
    if (p.surface === 'mailer' && p.kind === 'family' && p.email_fallback === false) { row.status = 'mismatch'; row.reason = 'email: no generic fallback after the family'; return row; }
    if (p.licence_exempt) { row.status = 'exempt'; row.reason = `font licence: ${p.licence_family || p.site} is the brand's own font, and a generated email never carries a site's font files; it draws in the declared fallback (${p.ours}). Upload your licensed files to use it there.`; return row; }
    row.status = 'mismatch';
    return row;
  });
}

function scoreOf(rows, regions) {
  const counted = rows.filter((r) => r.status === 'match' || r.status === 'mismatch');
  const bad = counted.filter((r) => r.status === 'mismatch').length;
  const reg = (regions || []).filter((g) => g.comparable);
  const regBad = reg.filter((g) => g.ratio > PIXEL_LIMIT).length;
  const tokenTerm = counted.length ? bad / counted.length : 0;
  const pixelTerm = reg.length ? regBad / reg.length : 0;
  // The COMPOSITE: what a repair must strictly improve to be kept.
  const mismatch = reg.length ? 0.7 * tokenTerm + 0.3 * pixelTerm : tokenTerm;
  const structural = 1 - tokenTerm;
  const worst = reg.reduce((a, g) => (g.ratio > a.ratio ? g : a), { ratio: 0, component: '' });
  const perceptual = 1 - worst.ratio;
  const pct = (v) => Math.round(v * 1000) / 10;
  const approved = structural >= STRUCTURAL_LIMIT && perceptual >= PERCEPTUAL_LIMIT;
  return {
    mismatch: Math.round(mismatch * 10000) / 10000, score: pct(1 - mismatch),
    structural: { score: pct(structural), limit: pct(STRUCTURAL_LIMIT), pass: structural >= STRUCTURAL_LIMIT, tokens_compared: counted.length, tokens_off: bad },
    perceptual: { score: pct(perceptual), limit: pct(PERCEPTUAL_LIMIT), pass: perceptual >= PERCEPTUAL_LIMIT, regions_compared: reg.length, worst_region: worst.component || '', worst_ratio: worst.ratio },
    approved,
    tokens_compared: counted.length, tokens_off: bad, exempt: rows.filter((r) => r.status === 'exempt').length,
    regions_compared: reg.length, regions_off: regBad, done: approved,
  };
}

/* ── repair: where a manifest value lives, and how to re-measure it ─────── */
const STRATEGIES = {
  color: ['computed', 'text-carrier', 'parent-filled', 'ground'],
  background: ['computed', 'parent-filled', 'ground'],
  default: ['computed', 'text-carrier'],
};
/** The manifest location (in read.<viewport>.roles) a pair's site value came from. */
function manifestSlot(row) {
  const role = row.role;
  if (!role) return null;
  const key = { 'button-primary': 'button_primary', display: 'display', h1: 'headings.h1', body: 'body', header: 'header' }[role];
  if (!key) return null;
  const isBox = row.prop === 'background' || row.prop === 'radius' || row.prop === 'border_color';
  const section = isBox ? 'style' : 'type';
  const prop = row.prop === 'stack' ? 'stack' : row.prop;
  return { path: `${key}.${section}.${prop}`, role, prop };
}
function getAt(o, p) { return p.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o); }
function setAt(o, p, v) { const ks = p.split('.'); let n = o; for (let i = 0; i < ks.length - 1; i++) { if (!n[ks[i]]) return false; n = n[ks[i]]; } n[ks[ks.length - 1]] = v; return true; }

/**
 * Re-measure the failing items off the SOURCE and correct the manifest where
 * the source disagrees with it. Returns the repairs made and the items that
 * could not be repaired (with their reason).
 */
async function repair(rows, manifest, live, tried) {
  const capture = require('./render-capture.js');
  const repairs = [], unmatched = [];
  for (const row of rows.filter((r) => r.status === 'mismatch')) {
    // A difference a person's own kept value explains is not re-measured:
    // the source is not wrong, the brand is applied as its owner set it.
    if (row.kept_field) { unmatched.push({ row, reason: row.reason }); continue; }
    const slot = manifestSlot(row);
    const vpName = row.viewport === 'mobile' || /phone/.test(row.viewport) ? 'mobile' : 'desktop';
    const page = vpName === 'mobile' ? live.mobilePage : live.desktopPage;
    const roles = manifest.read && manifest.read[vpName] && manifest.read[vpName].roles;
    if (!slot || !page || !roles) { unmatched.push({ row, reason: 'renderer: this token has no source measurement to re-read, so the difference is in how our renderer consumes the manifest' }); continue; }
    const current = getAt(roles, slot.path);
    const list = STRATEGIES[slot.prop === 'background' ? 'background' : (row.kind === 'color' ? 'color' : 'default')];
    const key = `${vpName}:${slot.path}`;
    tried[key] = tried[key] || 0;
    let fixed = false;
    while (tried[key] < list.length) {
      const strategy = list[tried[key]];
      tried[key] += 1;
      const got = await page.evaluate(capture.remeasure, { role: slot.role, prop: slot.prop, strategy }).catch(() => ({ value: null }));
      if (got == null || got.value == null || got.value === '') continue;
      // "Different" means beyond the token's own tolerance: a re-read that
      // differs only in the third decimal is the same measurement.
      const same = row.kind === 'color' ? deltaE2000(got.value, current) <= TOLERANCE.color
        : (Number.isFinite(+got.value) && Number.isFinite(+current)
          ? Math.abs(+got.value - +current) <= Math.min(0.05, TOLERANCE[row.kind] != null ? TOLERANCE[row.kind] : 0.05)
          : String(got.value).toLowerCase() === String(current).toLowerCase());
      if (same) continue;
      setAt(roles, slot.path, got.value);
      repairs.push({ surface: row.surface, viewport: vpName, path: slot.path, component: row.component, token: row.token, from: current, to: got.value, strategy, selector: got.selector || '', source_page: manifest.read[vpName].url });
      fixed = true;
      break;
    }
    if (!fixed && row.via !== 'pixels') unmatched.push({ row, reason: `every re-measurement of the source (${list.join(', ')}) confirms ${current}; the difference is in how our ${row.surface} consumes it` });
  }
  return { repairs, unmatched };
}

/* ── measurement of our surfaces in the browser ─────────────────────────── */
async function measureSurface(context, html, viewport, ctx, name) {
  const capture = require('./render-capture.js');
  const url = `https://lcos-preview.invalid/${name}-${viewport.width}`;
  ctx.local.set(url, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(html, 'utf8') });
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
  // The SAME frozen state the site was measured in (render-stabilise.js).
  const stabilised = await require('./render-stabilise.js').stabilise(page, { idleMs: 2500, fontsMs: 3000 });
  // A motion creative is measured in its reduced-motion composition: the one
  // state in which nothing is mid-fade.
  const hooks = await page.evaluate(capture.measureHooks).catch(() => ({}));
  // What the engine DREW, not what was declared: a family our asset names but
  // never loads draws as its fallback, and is caught here.
  hooks.__drawn = await require('./brand-render.js').drawnFaces(page, {
    h1: '[data-ds="h1"]', body: '[data-ds="body"]', 'button-primary': '[data-ds="button-primary"]',
    'card-title': '[data-ds="card-title"]', logo: '[data-ds="logo"]', headline: '[data-ds="headline"]',
  }).catch(() => ({}));
  hooks.__stabilised = stabilised;
  return { page, hooks };
}

async function specimen(page, hook, siteRole, ground, buf, label) {
  const capture = require('./render-capture.js');
  const id = `lcos-spec-${hook}-${String(label).replace(/[^a-z0-9]+/gi, '-')}`;
  let why = '';
  const sel = await page.evaluate(capture.makeSpecimen, {
    hook, id, width: Math.max(10, siteRole.box ? siteRole.box.w : 300), align: (siteRole.type && siteRole.type.align) || 'left',
    x: siteRole.box ? siteRole.box.x : 0, y: siteRole.box ? siteRole.box.y : 0,
    ground, text: hook === 'button-primary' ? (siteRole.label || siteRole.text || '') : (siteRole.text || ''), box: hook === 'button-primary',
  }).catch((e) => { why = e.message; return null; });
  if (!sel) return { component: label, comparable: false, reason: `our page rendered no ${hook} to compare${why ? ` (${why.slice(0, 120)})` : ''}` };
  const shot = await page.locator(sel).first().screenshot({ animations: 'disabled', timeout: 4000 }).catch((e) => { why = e.message; return null; });
  if (!shot) return { component: label, comparable: false, reason: `the specimen could not be captured (${why.slice(0, 160)})` };
  const text = await page.evaluate(capture.textRects, sel).catch(() => []);
  // Compared later, once the second shots of every specimen are in (one wait).
  return { component: label, comparable: true, ours_png: shot, pending: { page, sel, site: buf, ground, text } };
}

/** The second shots, ~500 ms later, then the masked comparison per region. */
async function settleRegions(regions, siteSecond, siteText) {
  const pend = regions.filter((g) => g.pending);
  if (!pend.length) return;
  await new Promise((r) => setTimeout(r, VOLATILE_WAIT_MS));
  for (const g of pend) {
    const p = g.pending;
    const b2 = await p.page.locator(p.sel).first().screenshot({ animations: 'disabled', timeout: 4000 }).catch(() => null);
    const key = g.component;
    Object.assign(g, pixelRatio(p.site, g.ours_png, p.ground, { a2: siteSecond[key] || null, b2, textA: siteText[key] || [], textB: p.text }));
    delete g.pending;
  }
}

/**
 * The loop. `live` holds the source pages still open from readRendered
 * (keepPages), so a repair re-measures the real rendered site.
 */
async function run({ browser, manifest, live, brand, seed, deadline }) {
  const net = require('./render-net.js');
  const ds = require('./design-system.js');
  const t0 = Date.now();
  const m = manifest;
  // A seed overrides manifest values BEFORE the first comparison. It exists to
  // prove the loop catches a wrong value (the tests seed the parser's
  // frequency-ranked colour); production passes none.
  // THE TRUTH is the site as measured at read time, kept immutable. The
  // manifest is what FEEDS our renderers; it starts equal to the truth, and a
  // seed or a wrong read makes them differ. Comparing our output against the
  // manifest could never see a wrong manifest value (both sides would carry
  // it) - so the site side of every comparison is the truth, and repair
  // re-measures the live page to correct the manifest.
  const truth = JSON.parse(JSON.stringify(m.read || {}));
  const seeded = [];
  if (seed) {
    for (const [p, v] of Object.entries(seed)) {
      const [vp, ...rest] = p.split('.');
      const roles = m.read && m.read[vp] && m.read[vp].roles;
      if (roles && setAt(roles, rest.join('.'), v)) seeded.push({ path: p, value: v });
    }
  }
  // OUR side: one context, its own network ledger, the preview pages served locally.
  const ctx = Object.assign({}, live.ctx, { local: new Map(), ledger: null, budget: null });
  const vD = (m.viewports && m.viewports.desktop) || { w: 1440, h: 900 };
  const vM = (m.viewports && m.viewports.mobile) || { w: 390, h: 844 };
  const oursCtx = await browser.newContext({ viewport: { width: vD.w, height: vD.h }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: false, reducedMotion: 'reduce' });
  await require('./render-stabilise.js').install(oursCtx);
  await net.attach(oursCtx, ctx);
  const sample = sampleFrom(m);
  const brandFontNames = new Set(['heading', 'body'].map((s) => (m.fonts || {})[s]).filter((f) => f && f.licence === 'brand font').map((f) => String(f.family).toLowerCase()));
  const er = ((truth.mobile && truth.mobile.roles) || (truth.desktop && truth.desktop.roles) || {});
  const famOfRole = (x) => (x && x.type && x.type.family) || '';
  const roleFamily = { heading: famOfRole(er.display || (er.headings && er.headings.h1)), 'body copy': famOfRole(er.body), button: famOfRole(er.button_primary) };
  const iterations = [];
  const allRepairs = [];
  const tried = {};
  // MONOTONIC: a set of repairs is KEPT only if the composite strictly
  // improves on the best state so far; otherwise each value is put back and
  // the attempt is logged. Candidates still come only from re-measuring the
  // source - never a value chosen to chase pixels.
  const reverted = [];
  let pendingRepairs = [];
  let best = null;
  let last = null;
  const closePages = async (st) => { if (st) for (const p of Object.values(st.pages)) await p.page.close().catch(() => {}); };
  for (let iter = 1; iter <= MAX_ITER; iter++) {
    if (Date.now() > deadline - 3000) break;
    const asApplied = brandAsApplied(m, brand);
    const b = asApplied.brand;
    const keptSet = new Map(asApplied.kept.map((k) => [k.field, k.origin]));
    const r = ds.resolve(b);
    const lpDecisions = ds.lpCss(r, { surface: b.palette.surface, ink: b.palette.ink, primary: b.palette.primary });
    const ours = renderOurs(b, sample);
    const lpD = await measureSurface(oursCtx, ours.lp, { width: vD.w, height: vD.h }, ctx, `lp${iter}`);
    const lpM = await measureSurface(oursCtx, ours.lp, { width: vM.w, height: vM.h }, ctx, `lpm${iter}`);
    const ml = await measureSurface(oursCtx, ours.mailer, { width: 640, height: 900 }, ctx, `mail${iter}`);
    const mailRows = [];
    for (const style of MAILER_STYLES) {
      const m2 = style === 'editorial' ? ml : await measureSurface(oursCtx, ours.mailers[style], { width: 640, height: 900 }, ctx, `mail-${style}${iter}`);
      for (const row of emailPairs(truth.mobile, truth.desktop, m2.hooks)) {
        // A brand font drawn as its fallback in an email is the legal gate
        // working, not a miss (it is listed as exempt with the reason).
        // The engine reports the face by the FILE's own name, not the CSS
        // alias, so the brand font is recognised by the role's declared family.
        const lic = row.kind === 'face' && brandFontNames.has(String(roleFamily[row.component] || '').toLowerCase());
        mailRows.push(Object.assign(row, { component: `${style}: ${row.component}` }, lic ? { licence_exempt: true, licence_family: roleFamily[row.component] } : {}));
      }
      if (m2 !== ml) await m2.page.close().catch(() => {});
    }
    const ad = await measureSurface(oursCtx, ours.ad, { width: 405, height: 720 }, ctx, `ad${iter}`);
    const rows = judge([]
      .concat(lpPairs(truth.desktop, lpD.hooks, 'desktop'))
      .concat(truth.mobile ? lpPairs(truth.mobile, lpM.hooks, 'mobile') : [])
      .concat(mailRows)
      .concat(adPairs(truth.mobile || truth.desktop, ad.hooks)), { swapped: lpDecisions.swapped })
      .map((x) => {
        if (x.status !== 'mismatch') return x;
        const f = keptFieldFor(x, keptSet);
        return f ? Object.assign(x, { kept_field: f, reason: `you kept ${f} (${keptSet.get(f) === 'unrecorded' ? 'saved before this read' : keptSet.get(f)}); this is your brand as the read will be applied to it` }) : x;
      });
    // Pixels: the primary button and the display heading, both viewports.
    const regions = [];
    const shots = (live && live.shots) || {};
    for (const [vp, src, page] of [['desktop', shots.desktop, lpD.page], ['mobile', shots.mobile, lpM.page]]) {
      const roles = m.read[vp] && m.read[vp].roles;
      if (!roles || !src || !src.parts) continue;
      const bp = roles.button_primary;
      if (bp && src.parts['button-primary']) {
        if (bp.over_media) regions.push({ component: `primary button (${vp})`, comparable: false, reason: 'your button sits on a photograph, so its pixels are not comparable' });
        else regions.push(Object.assign({ viewport: vp }, await specimen(page, 'button-primary', bp, bp.style.ground || '#ffffff', src.parts['button-primary'], `primary button (${vp})`) || { component: `primary button (${vp})`, comparable: false, reason: 'our page rendered no button to compare' }));
      }
      const head = roles.display || (roles.headings && roles.headings.h1);
      const part = src.parts.display || src.parts.h1;
      if (head && part) {
        if (head.over_media) regions.push({ component: `hero heading (${vp})`, comparable: false, reason: 'your heading sits on a photograph, so its pixels are not comparable' });
        else regions.push(Object.assign({ viewport: vp }, await specimen(page, 'h1', head, head.ground || '#ffffff', part, `hero heading (${vp})`) || { component: `hero heading (${vp})`, comparable: false, reason: 'our page rendered no heading to compare' }));
      }
    }
    const siteSecond = {}, siteText = {};
    for (const [vp, src] of [['desktop', shots.desktop], ['mobile', shots.mobile]]) {
      if (!src) continue;
      siteSecond[`primary button (${vp})`] = src.parts2 && src.parts2['button-primary'];
      siteText[`primary button (${vp})`] = src.text && src.text['button-primary'];
      const hk = src.parts && src.parts.display ? 'display' : 'h1';
      siteSecond[`hero heading (${vp})`] = src.parts2 && src.parts2[hk];
      siteText[`hero heading (${vp})`] = src.text && src.text[hk];
    }
    await settleRegions(regions, siteSecond, siteText);
    const surfaces = {};
    for (const s of ['landing page', 'mailer', 'ad creative']) surfaces[s] = scoreOf(rows.filter((x) => x.surface === s), s === 'landing page' ? regions : []);
    const overall = scoreOf(rows, regions);
    const cur = { rows, regions, surfaces, overall, lpDecisions, ours, pages: { lpD, lpM, ml, ad }, asApplied, iteration: iter };
    iterations.push({ iteration: iter, mismatch: overall.mismatch, score: overall.score, structural: overall.structural.score, perceptual: overall.perceptual.score, tokens_off: overall.tokens_off, regions_off: overall.regions_off });
    if (best && !(overall.mismatch < best.overall.mismatch)) {
      // Not strictly better: every value this attempt changed goes back.
      for (const x of pendingRepairs.slice().reverse()) {
        const roles = m.read[x.viewport] && m.read[x.viewport].roles;
        if (roles) setAt(roles, x.path, x.from);
        reverted.push(Object.assign({}, x, { reason: `the composite did not strictly improve (${best.overall.mismatch} -> ${overall.mismatch}), so the re-measured value was put back` }));
        const at = allRepairs.indexOf(x);
        if (at >= 0) allRepairs.splice(at, 1);
      }
      iterations[iterations.length - 1].reverted = pendingRepairs.length;
      pendingRepairs = [];
      await closePages(cur);
      last = best;
    } else {
      if (best) await closePages(best);
      best = cur;
      last = cur;
      pendingRepairs = [];
    }
    const repairable = last.rows.filter((x) => x.status === 'mismatch');
    if (last.overall.done && !repairable.length) break;
    // A pixel region over its limit sends EVERY token of that component to be
    // re-measured, even ones that compared clean: the pixels are the evidence
    // no token names (a gradient, a shadow, a value the role read got wrong).
    const failedRegions = last.regions.filter((g) => g.comparable && g.ratio > PIXEL_LIMIT);
    const suspect = last.rows.map((x) => (x.status === 'match' && x.surface === 'landing page'
      && failedRegions.some((g) => g.component.startsWith(x.component) && g.viewport === x.viewport)) ? Object.assign({}, x, { status: 'mismatch', via: 'pixels' }) : x);
    const { repairs, unmatched } = await repair(suspect, m, live, tried);
    last.unmatched = unmatched;
    pendingRepairs = repairs.map((x) => Object.assign({ iteration: iter }, x));
    allRepairs.push(...pendingRepairs);
    if (!repairs.length) break;
  }
  // Repairs made on the last iteration were never scored: put them back.
  if (pendingRepairs.length) {
    for (const x of pendingRepairs.slice().reverse()) {
      const roles = m.read[x.viewport] && m.read[x.viewport].roles;
      if (roles) setAt(roles, x.path, x.from);
      reverted.push(Object.assign({}, x, { reason: 'the iteration limit was reached before this re-measured value could be scored, so it was put back' }));
      const at = allRepairs.indexOf(x);
      if (at >= 0) allRepairs.splice(at, 1);
    }
  }
  // Report.
  const shotOf = async (page) => { try { return (await page.screenshot({ type: 'jpeg', quality: 60, animations: 'disabled' })).toString('base64'); } catch (_) { return null; } };
  const report = last ? {
    ok: true,
    limits: { tolerance: TOLERANCE, pixel_limit: PIXEL_LIMIT, mismatch_limit: MISMATCH_LIMIT, max_iterations: MAX_ITER, structural_limit: STRUCTURAL_LIMIT, perceptual_limit: PERCEPTUAL_LIMIT, volatile_wait_ms: VOLATILE_WAIT_MS },
    done: last.overall.done,
    approved: last.overall.approved,
    structural: last.overall.structural,
    perceptual: last.overall.perceptual,
    score: last.overall.score,
    mismatch: last.overall.mismatch,
    surfaces: last.surfaces,
    components: summariseComponents(last.rows, last.regions),
    tokens: last.rows.map((r) => ({ surface: r.surface, viewport: r.viewport, component: r.component, token: r.token, site: r.site, ours: r.ours, status: r.status, distance: r.distance, unit: r.unit, reason: r.reason || '', kept_field: r.kept_field || '' })),
    regions: last.regions.map((g) => ({ component: g.component, comparable: g.comparable, ratio: g.ratio, raw_ratio: g.raw_ratio, masked: g.masked, pixels: g.pixels, size: g.size, site_size: g.site_size, ours_size: g.ours_size, reason: g.reason || '' })),
    unmatched: (last.unmatched || []).map((u) => ({ surface: u.row.surface, viewport: u.row.viewport, component: u.row.component, token: u.row.token, best_site_value: u.row.site, ours: u.row.ours, reason: u.reason })),
    repairs: allRepairs,
    reverted,
    stabilised: {
      source: { clock: ((m.read.desktop || {}).stabilised || {}).clock || '', consent_hidden: ((m.read.desktop || {}).stabilised || {}).consent_hidden || [] },
      ours: { clock: ((last.pages.lpD.hooks || {}).__stabilised || {}).clock || '' },
    },
    seeded,
    iterations,
    hard_rules: { derived: last.lpDecisions.derived, swapped: last.lpDecisions.swapped },
    // WHAT was scored: the brand as the read will be applied to it.
    applied_as: {
      kept: last.asApplied.kept.map((k) => ({ field: k.field, origin: k.origin })),
      applied: last.asApplied.applied,
      scored_with_caller_brand: !!brand,
    },
    screenshots: {
      landing_desktop: await shotOf(last.pages.lpD.page),
      landing_mobile: await shotOf(last.pages.lpM.page),
      mailer: await shotOf(last.pages.ml.page),
      ad: await shotOf(last.pages.ad.page),
    },
    ours_html: { landing_page: last.ours.lp.length, mailer: last.ours.mailer.length, ad: last.ours.ad.length },
    manifest: m,
    wall_ms: Date.now() - t0,
  } : { ok: false, reason: 'The deadline was reached before our renderers could be compared.', manifest: m, seeded, iterations, repairs: allRepairs };
  if (last) for (const p of Object.values(last.pages)) await p.page.close().catch(() => {});
  return report;
}

function summariseComponents(rows, regions) {
  const by = new Map();
  for (const r of rows) {
    const key = `${r.surface} / ${r.component}`;
    const g = by.get(key) || { surface: r.surface, component: r.component, match: 0, mismatch: 0, exempt: 0, not_comparable: 0 };
    if (r.status === 'match') g.match += 1; else if (r.status === 'mismatch') g.mismatch += 1; else if (r.status === 'exempt') g.exempt += 1; else g.not_comparable += 1;
    by.set(key, g);
  }
  return [...by.values()].map((g) => Object.assign(g, {
    score: g.match + g.mismatch ? Math.round((g.match / (g.match + g.mismatch)) * 1000) / 10 : null,
    pixels: (regions || []).filter((x) => x.comparable && x.component.startsWith(g.component)).map((x) => ({ component: x.component, ratio: x.ratio })),
  }));
}

module.exports = {
  TOLERANCE, PIXEL_LIMIT, MISMATCH_LIMIT, MAX_ITER, STRUCTURAL_LIMIT, PERCEPTUAL_LIMIT,
  deltaE2000, lab, compareToken, pixelRatio, judge, scoreOf, lpPairs, emailPairs, adPairs,
  sampleFrom, brandFor, brandAsApplied, renderOurs, repair, run, MAILER_STYLES, facePairs,
};
