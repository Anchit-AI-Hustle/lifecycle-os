'use strict';
/**
 * identity-signals.js — which colour on a brand's own material says "this is
 * the brand", and how strongly.
 * ---------------------------------------------------------------------------
 * The rendered reader (brand-render.js) measures colours by the ROLE they play.
 * This module holds the parts of that judgement both of its callers share -
 * the reader, and the starter-brand mapping (scripts/lib/preset-observation.js)
 * - so the two cannot drift:
 *
 *   KINDS        every identity signal the reader can produce, with a STRENGTH.
 *                The mark itself (its SVG paint, its pixels) is the strongest
 *                thing a site publishes about its colour; a declaration the
 *                site makes for browser chrome (theme-color, a pinned-tab
 *                colour) is next; a token NAME, a header fill and an icon tile
 *                are weaker. Strength orders the candidates; it never turns a
 *                weak signal into a strong one.
 *   chromatic()  a colour with hue, by CHROMA (max - min channel), not by the
 *                parser's lightness rule: a navy #000042 is a colour, and the
 *                lightness rule filed it as black.
 *   pixelColours()  the colours a screenshot of a mark paints, by pixel share,
 *                its ground and its anti-aliased fringe left out.
 *   markIdentity()  what a mark's colours say: ONE colour that dominates its
 *                chromatic area, or that the mark is NEUTRAL (black, white,
 *                grey - recorded as such and never promoted to primary), or
 *                that it is MULTICOLOUR (several colours, none dominant - it
 *                proposes nothing).
 *
 * Pure: no browser, no network.
 */

/** Strength per signal kind. Higher is stronger. */
const KINDS = {
  'logo-svg': { score: 100, label: 'logo mark paint (SVG fill/stroke as rendered)' },
  'logo-image': { score: 96, label: 'logo mark pixels (the rendered logo image)' },
  'guideline-swatch': { score: 94, label: 'colour swatch the brand publishes, painted and labelled with its own value' },
  'mask-icon': { score: 92, label: 'pinned-tab mask-icon colour the site declares' },
  'theme-color': { score: 74, label: 'meta theme-color' },
  'manifest-theme': { score: 72, label: 'web app manifest theme_color' },
  'tile-color': { score: 70, label: 'msapplication-TileColor (meta or browserconfig.xml)' },
  'token': { score: 66, label: 'brand colour token as computed on :root' },
  // A wordmark set as TEXT is found by shape (a large or logo-named home
  // link), which is a guess an image or an SVG is not: below a declared token.
  'logo-text': { score: 62, label: 'logo set as text, its colour as rendered' },
  'header': { score: 58, label: 'header background as rendered' },
  'icon': { score: 56, label: 'site icon (favicon / touch icon) pixels' },
  'action': { score: 55, label: 'primary call to action, as rendered' },
  'manifest-background': { score: 40, label: 'web app manifest background_color' },
};

function rgbOf(hex) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function hexOf(c) { return '#' + c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function lum(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** Chroma 0..1 (max - min channel). */
function chromaOf(hex) {
  const c = rgbOf(hex);
  if (!c) return 0;
  return (Math.max(...c) - Math.min(...c)) / 255;
}

/**
 * A colour with hue. Chroma at least 0.14 and not a near-white tint: black,
 * white and greys (and the off-white #ecf0f4 of a page tab) are neutral.
 */
function chromatic(hex) {
  const c = rgbOf(hex);
  if (!c) return false;
  return chromaOf(hex) >= 0.14 && lum(c) < 0.9;
}

/**
 * The colours a PNG screenshot paints, by pixel share. `ground` (a hex) is the
 * colour behind the mark: pixels within a small distance of it are the
 * ground, not the mark. Transparent pixels are nothing. Each colour is the
 * EXACT value that occurs most often in its bin, so a flat fill reads as the
 * fill and not as an average of it and its anti-aliased edge.
 * Returns [{ hex, share, chromatic }] (share of the mark's pixels), largest first.
 */
function pixelColours(png, ground) {
  if (!png) return [];
  let img;
  try { img = require('pngjs').PNG.sync.read(Buffer.isBuffer(png) ? png : Buffer.from(png)); } catch (_) { return []; }
  const g = rgbOf(ground);
  const bins = new Map();
  let total = 0;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    if (g && Math.abs(r - g[0]) + Math.abs(gg - g[1]) + Math.abs(b - g[2]) < 30) continue;
    total += 1;
    const key = ((r >> 4) << 8) | ((gg >> 4) << 4) | (b >> 4);
    let bin = bins.get(key);
    if (!bin) { bin = { n: 0, exact: new Map() }; bins.set(key, bin); }
    bin.n += 1;
    const ek = (r << 16) | (gg << 8) | b;
    bin.exact.set(ek, (bin.exact.get(ek) || 0) + 1);
  }
  if (!total) return [];
  const out = [];
  for (const bin of bins.values()) {
    let best = 0, bestN = -1;
    for (const [k, n] of bin.exact) if (n > bestN) { best = k; bestN = n; }
    const hex = hexOf([(best >> 16) & 255, (best >> 8) & 255, best & 255]);
    out.push({ hex, n: bin.n });
  }
  out.sort((a, b) => b.n - a.n);
  // Neighbouring bins can split one colour; merge a bin into a larger one
  // whose exact colour is within a small distance.
  const merged = [];
  for (const o of out) {
    const c = rgbOf(o.hex);
    const into = merged.find((m) => { const mc = rgbOf(m.hex); return Math.abs(mc[0] - c[0]) + Math.abs(mc[1] - c[1]) + Math.abs(mc[2] - c[2]) <= 12; });
    if (into) into.n += o.n; else merged.push({ hex: o.hex, n: o.n });
  }
  return merged.sort((a, b) => b.n - a.n).slice(0, 12)
    .map((m) => ({ hex: m.hex, share: Math.round((m.n / total) * 1000) / 1000, chromatic: chromatic(m.hex) }));
}

/**
 * What a mark's colours say. `colours`: [{ hex, share }] (paint by area, or
 * pixels by share). Returns one of
 *   { verdict: 'colour', hex, share_of_chromatic, chromatic_share }
 *   { verdict: 'neutral', hex, chromatic_share }   - black/white/grey mark
 *   { verdict: 'multicolour', colours, chromatic_share }
 *   { verdict: 'none' }
 * A colour is the mark's when it holds at least 55% of the mark's chromatic
 * area, or 1.6x the next chromatic colour, and the chromatic part is at least
 * 6% of the mark (a 1-pixel coloured dot on a black wordmark is not it).
 */
function markIdentity(colours) {
  const list = (colours || []).filter((c) => c && rgbOf(c.hex) && c.share > 0);
  if (!list.length) return { verdict: 'none' };
  const chroma = list.filter((c) => chromatic(c.hex));
  const chromaticShare = chroma.reduce((n, c) => n + c.share, 0);
  const total = list.reduce((n, c) => n + c.share, 0) || 1;
  if (!chroma.length || chromaticShare / total < 0.06) {
    return { verdict: 'neutral', hex: list[0].hex, chromatic_share: Math.round((chromaticShare / total) * 1000) / 1000 };
  }
  // Fold near-identical chromatic colours (a gradient's two close stops, an
  // anti-aliased variant) into the largest.
  const groups = [];
  for (const c of chroma.slice().sort((a, b) => b.share - a.share)) {
    const rc = rgbOf(c.hex);
    const g = groups.find((x) => { const gc = rgbOf(x.hex); return Math.abs(gc[0] - rc[0]) + Math.abs(gc[1] - rc[1]) + Math.abs(gc[2] - rc[2]) <= 24; });
    if (g) g.share += c.share; else groups.push({ hex: c.hex, share: c.share });
  }
  groups.sort((a, b) => b.share - a.share);
  const top = groups[0];
  const second = groups[1];
  const ofChroma = top.share / chromaticShare;
  if (ofChroma >= 0.55 || !second || top.share >= 1.6 * second.share) {
    return { verdict: 'colour', hex: top.hex, share_of_chromatic: Math.round(ofChroma * 1000) / 1000, chromatic_share: Math.round((chromaticShare / total) * 1000) / 1000 };
  }
  return { verdict: 'multicolour', colours: groups.slice(0, 5).map((x) => x.hex), chromatic_share: Math.round((chromaticShare / total) * 1000) / 1000 };
}

module.exports = { KINDS, chromatic, chromaOf, pixelColours, markIdentity, rgbOf, hexOf };
