// Shared on-brand image placeholder.
//
// Whenever the image-generation cascade has nothing valid to return, callers
// emit THIS instead of a 502 / null / broken <img>. It is a self-contained SVG
// data-URI (no network, renders everywhere an <img src> works, including email
// clients that allow data URIs) painted strictly in the KNICKGASM palette:
//   #6A33D8 deep purple · #D0473E lava · #F7F5F2 chalk
// so a failed asset degrades to an intentional brand panel, never a broken tile.
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

// Returns a `data:image/svg+xml,...` URI sized to `size` ("1200x628" | {width,height}).
function brandPlaceholderDataUri(size, label) {
  var d = _dims(size);
  var w = d.w, h = d.h, base = Math.min(w, h);
  var fMain = Math.round(base * 0.13);
  var fSub = Math.round(base * 0.035);
  var ruleW = Math.round(base * 0.34);
  var sub = (label ? String(label) : 'SINGLE-ESTATE INDIAN SNEAKER').replace(/[<>&]/g, ' ').slice(0, 40);
  // STRICT palette — only the four brand colours. ONE green (#6A33D8), never a
  // second shade. Depth comes from a translucent LAVA glow (#D0473E), which is
  // on-palette, not from tinting the green.
  var svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs><radialGradient id="vg" cx="50%" cy="34%" r="85%">`
    + `<stop offset="0%" stop-color="#D0473E" stop-opacity="0.22"/><stop offset="60%" stop-color="#D0473E" stop-opacity="0"/>`
    + `</radialGradient></defs>`
    + `<rect width="${w}" height="${h}" fill="#6A33D8"/>`
    + `<rect width="${w}" height="${h}" fill="url(#vg)"/>`
    + `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" `
    + `font-family="Georgia, 'Times New Roman', serif" font-size="${fMain}" font-weight="bold" `
    + `letter-spacing="${Math.round(fMain * 0.12)}" fill="#F7F5F2">KNICKGASM</text>`
    + `<rect x="${Math.round(w / 2 - ruleW / 2)}" y="${Math.round(h / 2 + fMain * 0.62)}" width="${ruleW}" height="3" fill="#D0473E"/>`
    + `<text x="50%" y="${Math.round(h / 2 + fMain * 1.05)}" text-anchor="middle" `
    + `font-family="Arial, Helvetica, sans-serif" font-size="${fSub}" `
    + `letter-spacing="${Math.round(fSub * 0.28)}" fill="#D0473E">${sub}</text>`
    + `</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

module.exports = { brandPlaceholderDataUri };
