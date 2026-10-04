'use strict';
/**
 * Fixture brand SITES for the identity signals the rendered reader takes from a
 * brand's own MARK and DECLARATIONS (2026-10-05): the logo's SVG paint, its
 * pixels (a raster logo, a CSS sprite), the mask-icon colour, the tile colour
 * in browserconfig.xml, a guidelines page's labelled swatches, and the shapes
 * the preset harvest met on real sites - a theme-color that disagrees with
 * the mark, a pale tab taken for a call to action, a brand colour shown only
 * on a consent banner, a multicolour mark, a black mark.
 *
 * One HTTP server per site on 127.0.0.1 (the reader scopes a read to the
 * start URL's host). `startSites(kinds, { host: '127.0.0.2' })` serves on
 * another loopback address - a DIFFERENT registrable domain, for the
 * ownership rule (the reader's network layer connects only to addresses it
 * has validated, so a fixture host is an IP literal, never a name). Every
 * expected value below is what the fixture paints.
 */
const http = require('http');
const { PNG } = require('pngjs');

/** A PNG `w`x`h`, transparent, with the given filled rectangles. */
function png(w, h, rects) {
  const p = new PNG({ width: w, height: h });
  for (const [x0, y0, x1, y1, hex] of rects) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      p.data[i] = c[0]; p.data[i + 1] = c[1]; p.data[i + 2] = c[2]; p.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(p);
}

const EXPECT = {
  'logo-svg': { primary: '#2874f0', theme: '#56adff', action: '#2a55e5', minor: '#ffe11b' },
  'logo-raster': { primary: '#e50010' },
  'logo-css': { primary: '#ff9900', header: '#131921' },
  multicolour: { action: '#0078d4', squares: ['#f25022', '#7fba00', '#00a4ef', '#ffb900'] },
  'neutral-logo': { logo: '#000000', action: '#111111' },
  consent: { primary: '#1428a0', banner: '#1429a0' },
  tint: { primary: '#e4002b', tab: '#ecf0f4' },
  declared: { mask: '#cf0a2c', tile: '#cf0a2c', manifestBg: '#fafafa' },
  guidelines: { first: '#eb0a1e', second: '#58595b' },
  'logo-file': { primary: '#eb0a1e' },
};

const HEAD = (title, extra) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">${extra || ''}`;
const BODY_COPY = '<p>We make a small number of things and publish what each is made of, where it is made and how long it should last. Everything is checked by the people who made it before it ships.</p><p>Repairs are free for as long as we are open, and every order ships within three working days.</p>';
const BASE_CSS = 'body{margin:0;background:#ffffff;color:#1d1d1f;font-family:Georgia,serif;font-size:17px;line-height:1.6}header{display:flex;justify-content:space-between;align-items:center;padding:14px 40px;border-bottom:1px solid #e5e5e5}header nav a{color:#1d1d1f;margin-left:22px;text-decoration:none}main{padding:56px 40px;max-width:980px}h1{font-size:48px;line-height:1.1;margin:0 0 16px}p{max-width:640px;margin:0 0 16px}.cta{display:inline-block;padding:15px 30px;border-radius:6px;color:#ffffff;text-decoration:none;font-weight:700}';
const NAV = '<nav><a href="/shop">Shop</a><a href="/about">About</a></nav>';

const PAGES = {
  'logo-svg': () => `${HEAD('Blue Cart', '<meta name="theme-color" content="#56adff">')}<style>${BASE_CSS}.cta{background:#2a55e5}</style></head><body>
<header><a href="/" aria-label="Blue Cart home"><svg width="160" height="40" viewBox="0 0 160 40" role="img"><rect x="0" y="0" width="150" height="40" fill="#2874f0"/><circle cx="155" cy="5" r="4" fill="#ffe11b"/></svg></a>${NAV}</header>
<main><h1>Everything, delivered</h1>${BODY_COPY}<p><a class="cta" href="/shop">Shop now</a></p></main></body></html>`,
  'logo-raster': () => `${HEAD('Red Thread')}<style>${BASE_CSS}.cta{background:#111111}</style></head><body>
<header><a href="/"><img src="/logo.png" alt="Red Thread" width="160" height="48"></a>${NAV}</header>
<main><h1>Clothes for every day</h1>${BODY_COPY}<p><a class="cta" href="/shop">Shop the range</a></p></main></body></html>`,
  'logo-css': () => `${HEAD('Smile Market')}<style>${BASE_CSS}header{background:#131921;border:0}header nav a{color:#ffffff}#nav-logo-sprites{display:block;width:120px;height:36px;background:url(/sprite.png) no-repeat 0 0}.cta{background:#111111}</style></head><body>
<header><a id="nav-logo-sprites" href="/ref=nav_logo" aria-label="Smile Market"></a>${NAV}</header>
<main><h1>Low prices, every day</h1>${BODY_COPY}<p><a class="cta" href="/shop">Start shopping</a></p></main></body></html>`,
  multicolour: () => `${HEAD('Four Squares')}<style>${BASE_CSS}.cta{background:#0078d4}</style></head><body>
<header><a href="/"><svg width="44" height="44" viewBox="0 0 44 44"><rect x="0" y="0" width="21" height="21" fill="#f25022"/><rect x="23" y="0" width="21" height="21" fill="#7fba00"/><rect x="0" y="23" width="21" height="21" fill="#00a4ef"/><rect x="23" y="23" width="21" height="21" fill="#ffb900"/></svg></a>${NAV}</header>
<main><h1>Do more with less</h1>${BODY_COPY}<p><a class="cta" href="/shop">Buy now</a></p></main></body></html>`,
  'neutral-logo': () => `${HEAD('Plain Mark')}<style>${BASE_CSS}.cta{background:#111111}</style></head><body>
<header><a href="/"><svg width="120" height="40" viewBox="0 0 120 40"><path d="M0 0h120v40H0z" fill="#000000"/></svg></a>${NAV}</header>
<main><h1>Made plainly</h1>${BODY_COPY}<p><a class="cta" href="/shop">See the range</a></p></main></body></html>`,
  consent: () => `${HEAD('Blue Oval')}<style>${BASE_CSS}.cta{background:#000000}#onetrust-banner-sdk{position:fixed;left:0;right:0;bottom:0;background:#ffffff;padding:20px;border-top:1px solid #ccc}#onetrust-accept-btn-handler{background:#1429a0;color:#fff;padding:12px 28px;border:0;font-size:16px}</style></head><body>
<header><a href="/"><svg width="140" height="32" viewBox="0 0 140 32"><path d="M0 0h140v32H0z" fill="#1428a0"/></svg></a>${NAV}</header>
<main><h1>Galaxy of things</h1>${BODY_COPY}<p><a class="cta" href="/shop">Buy</a></p></main>
<div id="onetrust-banner-sdk" role="dialog" aria-label="Cookie consent"><p>We use cookies to improve your experience. Accept cookies?</p><button id="onetrust-accept-btn-handler">Accept all cookies</button></div></body></html>`,
  tint: () => `${HEAD('Loud Audio')}<style>${BASE_CSS}.tab{display:inline-block;background:#ecf0f4;color:#1d1d1f;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:18px}</style></head><body>
<header><a href="/"><svg width="110" height="36" viewBox="0 0 110 36"><path d="M0 0h110v36H0z" fill="#e4002b"/></svg></a>${NAV}</header>
<main><h1>Sound you can feel</h1>${BODY_COPY}<p><a class="tab" href="/shop">Explore the range now</a></p></main></body></html>`,
  declared: () => `${HEAD('Arch Runner', '<link rel="mask-icon" href="/mask.svg" color="#cf0a2c"><meta name="msapplication-config" content="/browserconfig.xml"><link rel="manifest" href="/site.webmanifest">')}<style>${BASE_CSS}.cta{background:#111111}</style></head><body>
<header><a href="/"><svg width="80" height="40" viewBox="0 0 80 40"><path d="M0 0h80v40H0z" fill="#000000"/></svg></a>${NAV}</header>
<main><h1>Run your way</h1>${BODY_COPY}<p><a class="cta" href="/shop">Shop running</a></p></main></body></html>`,
  guidelines: () => `${HEAD('Brand guidelines: colour')}<style>${BASE_CSS}.sw{display:inline-block;width:220px;margin:0 16px 16px 0;vertical-align:top;font-size:14px}.chip{height:120px;border-radius:4px}</style></head><body>
<header><a href="/"><svg width="80" height="40" viewBox="0 0 80 40"><path d="M0 0h80v40H0z" fill="#000000"/></svg></a>${NAV}</header>
<main><h1>Colour</h1><p>Our palette is red, white, black and grey. Red sits at the heart of the brand and is used to bring focus to key elements.</p>
<div class="sw"><div class="chip" style="background:#eb0a1e"></div><p><b>Brand Red</b><br>PMS 186C<br>RGB 235 10 30<br>HEX EB0A1E</p></div>
<div class="sw"><div class="chip" style="background:#58595b"></div><p><b>Grey</b><br>RGB 88 89 91<br>HEX #58595B</p></div>
<div class="sw"><div class="chip" style="background:#00a3e0"></div><p><b>A colour written but painted differently</b><br>HEX #123456</p></div>
</main></body></html>`,
};

const ASSETS = {
  'logo-raster': { '/logo.png': () => ({ type: 'image/png', body: png(160, 48, [[0, 0, 150, 48, '#e50010']]) }) },
  'logo-css': { '/sprite.png': () => ({ type: 'image/png', body: png(120, 36, [[0, 0, 70, 14, '#ffffff'], [0, 20, 120, 36, '#ff9900']]) }) },
  // A brand's own logo FILE, on a host its guidelines page links to.
  'logo-file': { '/logo.png': () => ({ type: 'image/png', body: png(200, 60, [[0, 0, 200, 60, '#eb0a1e']]) }) },
  declared: {
    '/browserconfig.xml': () => ({ type: 'application/xml', body: '<?xml version="1.0" encoding="utf-8"?><browserconfig><msapplication><tile><TileColor>#cf0a2c</TileColor></tile></msapplication></browserconfig>' }),
    '/site.webmanifest': () => ({ type: 'application/manifest+json', body: JSON.stringify({ name: 'Arch Runner', background_color: '#fafafa', icons: [] }) }),
    '/mask.svg': () => ({ type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>' }),
  },
};

function handler(kind, opts) {
  const o = opts || {};
  let hits = 0;
  return (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (u.pathname === '/robots.txt') return send(200, 'text/plain', 'User-agent: *\nAllow: /\n');
    if (kind === 'walled') return send(403, 'text/html; charset=utf-8', '<!doctype html><title>Access Denied</title><h1>Access Denied</h1><p>You don\'t have permission to access this server.</p>');
    const asset = ASSETS[kind] && ASSETS[kind][u.pathname];
    if (asset) { const a = asset(); return send(200, a.type, a.body); }
    if (u.pathname === '/' || u.pathname === '' || u.pathname === '/brand/colour') {
      let page = PAGES[kind] ? PAGES[kind]() : '<!doctype html><title>x</title><p>x</p>';
      // `links`: hrefs this page carries (how another host is shown to be the
      // brand's own: its own page links to it).
      if (o.links && o.links.length) page = page.replace('</main>', `<p>${o.links.map((h) => `<a href="${h}">${h}</a>`).join(' ')}</p></main>`);
      // `slow`: the first document request is held past the reader's budget.
      if (o.slowFirstMs && u.pathname === '/' && (hits += 1) === 1) return setTimeout(() => send(200, 'text/html; charset=utf-8', page), o.slowFirstMs);
      return send(200, 'text/html; charset=utf-8', page);
    }
    return send(404, 'text/html; charset=utf-8', '<!doctype html><title>Not found</title><p>Not found</p>');
  };
}

/** Start one server per site. `kinds`: names, or [name, { slowFirstMs }]. */
async function startSites(kinds, opts) {
  const host = (opts && opts.host) || '127.0.0.1';
  const servers = [];
  const origins = {};
  for (const k of kinds) {
    const [kind, ko] = Array.isArray(k) ? k : [k, {}];
    const srv = http.createServer(handler(kind, ko));
    await new Promise((r) => srv.listen(0, host, r));
    servers.push(srv);
    origins[ko.name || kind] = `http://${host}:${srv.address().port}`;
  }
  return { origins, close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))) };
}

module.exports = { startSites, EXPECT, png, PAGES };
