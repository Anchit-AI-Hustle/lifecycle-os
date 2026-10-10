// Shared on-brand image placeholder.
//
// Whenever the image-generation cascade has nothing valid to return, callers
// emit THIS instead of a 502 / null / broken <img>. It is a self-contained SVG
// data-URI (no network, renders everywhere an <img src> works, including email
// clients that allow data URIs) painted in the BRAND'S palette with the brand's
// own name, so a failed asset degrades to an intentional brand panel, never a
// broken tile.
//
// WHOSE panel (2026-09-28). This used to be four tenant-zero literals and the
// word "KNICKGASM" set in Georgia, handed to every caller - so a failed slot in
// another brand's mailer showed another company's name on another company's
// colours. The subtitle default was tea-brand residue from the sibling repo.
// The panel is now derived: pass `brand` ({ name, palette }) and it paints that
// brand; pass nothing and it paints tenant zero from tenant zero's own record
// (brand-workspace-core.DEFAULT_BRAND), which is the same colours as before for
// the one brand that used to be hardcoded.
//
// The fill goes through sectionGround() and the type through textOn(), so a
// record whose primary is near black still yields a readable panel rather than
// a black tile with grey type.
//
// Underscore-prefixed (_shared) → NOT counted against the Hobby 12-function cap.

function _dims(size) {
  var w = 600, h = 600;
  if (typeof size === 'string') {
    var m = size.split('x');
    if (m.length === 2) { w = parseInt(m[0], 10) || 600; h = parseInt(m[1], 10) || 600; }
  } else if (size && typeof size === 'object' && size.width) {
    w = size.width; h = size.height || size.width;
  }
  return { w: w, h: h };
}

function _core() { return require('./brand-workspace-core.js'); }

function _brandOf(brand) {
  if (brand && (brand.name || brand.palette)) return brand;
  // No brand passed: the brand the request being served resolved, and tenant
  // zero only when nothing is in scope (2026-10-10). A caller that forgot the
  // argument painted tenant zero's name inside another workspace's asset.
  try { return require('./brand-runtime.js').scopedBrand(null, { allowTenantZero: true }); } catch (_) { /* below */ }
  var core = _core();
  return core.DEFAULT_BRAND || { name: 'this brand', palette: {} };
}

// Returns a `data:image/svg+xml,...` URI sized to `size` ("1200x628" | {width,height}).
// `label` is the subtitle line (defaults to the brand's tagline, or nothing).
// `brand` is { name, palette, tagline? }; omitted means tenant zero.
function brandPlaceholderDataUri(size, label, brand) {
  var core = _core();
  var b = _brandOf(brand);
  var p = b.palette || {};
  var d = _dims(size);
  var w = d.w, h = d.h, base = Math.min(w, h);
  var fMain = Math.round(base * 0.13);
  var fSub = Math.round(base * 0.035);
  var ruleW = Math.round(base * 0.34);
  var clean = function (s) { return String(s == null ? '' : s).replace(/[<>&]/g, ' ').slice(0, 40); };
  var name = clean(b.name || 'this brand');
  var sub = clean(label || b.tagline || '');

  var surface = core.sectionGround(p.surface, '#ffffff');
  var fill = core.sectionGround(p.primary, p.accent, surface);
  var glow = (core.normHex(p.accent) && p.accent) || (core.normHex(p.primary) && p.primary) || fill;
  var ink = (core.normHex(p.ink) && p.ink) || '#111111';
  var type = core.textOn(fill, surface, ink);
  var t = b.typography || {};
  var head = (t.heading && t.heading.family) ? "'" + String(t.heading.family).replace(/'/g, '') + "', Georgia, serif" : "Georgia, 'Times New Roman', serif";
  var body = (t.body && t.body.family) ? "'" + String(t.body.family).replace(/'/g, '') + "', Arial, sans-serif" : 'Arial, Helvetica, sans-serif';

  var svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs><radialGradient id="vg" cx="50%" cy="34%" r="85%">`
    + `<stop offset="0%" stop-color="${glow}" stop-opacity="0.22"/><stop offset="60%" stop-color="${glow}" stop-opacity="0"/>`
    + `</radialGradient></defs>`
    + `<rect width="${w}" height="${h}" fill="${fill}"/>`
    + `<rect width="${w}" height="${h}" fill="url(#vg)"/>`
    + `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" `
    + `font-family="${head}" font-size="${fMain}" font-weight="bold" `
    + `letter-spacing="${Math.round(fMain * 0.12)}" fill="${type}">${name}</text>`
    + `<rect x="${Math.round(w / 2 - ruleW / 2)}" y="${Math.round(h / 2 + fMain * 0.62)}" width="${ruleW}" height="3" fill="${type}"/>`
    + (sub
      ? `<text x="50%" y="${Math.round(h / 2 + fMain * 1.05)}" text-anchor="middle" `
        + `font-family="${body}" font-size="${fSub}" `
        + `letter-spacing="${Math.round(fSub * 0.28)}" fill="${type}">${sub}</text>`
      : '')
    + `</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

module.exports = { brandPlaceholderDataUri };
