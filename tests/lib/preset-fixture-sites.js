'use strict';
/**
 * Fixture brand SITES for the preset harvest, served by a real HTTP server on
 * 127.0.0.1 so the rendered reader's own network layer carries every byte.
 *
 *   /brand-a/   a light storefront: theme-color, a filled call to action in a
 *               second colour, a web font served from the site's own host
 *               (a "brand font" the app cannot load), body copy, a logo
 *   /brand-mono a monochrome site: no chromatic colour anywhere, a black call
 *               to action, a system font stack
 *   /walled/    a bot wall: 403 with an "Access Denied" page, the shape
 *               Akamai and Cloudflare answer an automated reader with
 *
 * Each site is its own ORIGIN (one server per site), because the reader
 * scopes a read to the start URL's host.
 *
 * Every expected value is what the browser computes for the fixture.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FONT = (() => {
  // Any real TrueType file will do: the reader only has to see a web font
  // LOAD and render the heading. The repo ships none of its own, so the test
  // looks for one in the fixture directory the rendered reader's tests use and
  // falls back to a system font file.
  const candidates = [
    path.join(__dirname, '..', 'fixtures', 'fonts', 'EricaOne-Regular.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  ];
  for (const c of candidates) { try { return fs.readFileSync(c); } catch (_) { /* next */ } }
  return null;
})();

const EXPECT = {
  'brand-a': { primary: '#0b6e4f', accent: '#d9480f', surface: '#fbfaf7', ink: '#1f2a24', heading: 'Harbour Display', body: 'Georgia' },
  'brand-mono': { primary: '#111111', surface: '#ffffff', ink: '#222222' },
};

const BRAND_A = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Harbour Goods</title>
<meta name="theme-color" content="#0b6e4f">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/icon.png" type="image/png">
<style>
${FONT ? "@font-face{font-family:'Harbour Display';src:url(/fonts/harbour.ttf) format('truetype');font-weight:700;font-display:block}" : ''}
:root{--brand-primary:#0b6e4f}
body{margin:0;background:#fbfaf7;color:#1f2a24;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.6}
header{display:flex;justify-content:space-between;align-items:center;padding:16px 40px;background:#fbfaf7;border-bottom:1px solid #e3e0d8}
header nav a{color:#1f2a24;margin-left:24px;text-decoration:none;font-weight:600}
h1{font-family:'Harbour Display',Georgia,serif;font-size:56px;line-height:1.1;margin:0 0 16px;color:#0b6e4f;font-weight:700}
main{padding:64px 40px;max-width:1000px}
p{max-width:640px;margin:0 0 18px}
.cta{display:inline-block;background:#d9480f;color:#ffffff;padding:16px 32px;border-radius:6px;font-weight:700;text-decoration:none;font-family:Georgia,serif}
.muted{color:#5b6660;font-size:14px}
footer{padding:40px;background:#efece4;color:#1f2a24}
</style></head><body>
<header><a href="/" aria-label="Harbour Goods home"><img src="/logo.png" alt="Harbour Goods logo" width="140" height="36"></a>
<nav><a href="/collections/all">Shop</a><a href="/about">About</a></nav></header>
<main>
<h1>Goods for the long weekend</h1>
<p>Harbour Goods makes canvas bags, enamel mugs and wool blankets in a small workshop by the water. Every piece is cut, sewn and checked by the same four people, and every one is made to be used for years rather than replaced next season.</p>
<p>We publish what each piece is made of and where, and we repair anything we make for as long as we are open.</p>
<p><a class="cta" href="/collections/all">Shop the workshop</a></p>
<p class="muted">Free repairs for the life of the piece. Shipping within the country in three to five days.</p>
</main>
<footer><p>Harbour Goods, a fixture brand for the preset harvest tests.</p></footer>
</body></html>`;

const BRAND_MONO = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Plain Form</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#ffffff;color:#222222;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1.6}
header{padding:18px 40px;border-bottom:1px solid #e5e5e5;display:flex;justify-content:space-between}
header a{color:#222222;text-decoration:none;font-weight:600}
main{padding:64px 40px;max-width:960px}
h1{font-size:48px;line-height:1.1;margin:0 0 16px;color:#111111}
p{max-width:640px;margin:0 0 18px}
.cta{display:inline-block;background:#111111;color:#ffffff;padding:15px 30px;border-radius:999px;text-decoration:none;font-weight:600}
footer{padding:40px;border-top:1px solid #e5e5e5}
</style></head><body>
<header><a href="/">Plain Form</a><nav><a href="/shop">Shop</a></nav></header>
<main><h1>Made plainly</h1>
<p>Plain Form makes shirts in three colours and four sizes, and nothing else. The cut has not changed in nine years, and the cloth is woven at the same mill every season.</p>
<p>Each shirt is finished by hand and sold at one price everywhere.</p>
<p><a class="cta" href="/shop">See the shirts</a></p></main>
<footer><p>Plain Form, a fixture brand for the preset harvest tests.</p></footer>
</body></html>`;

const WALLED = `<!doctype html><html><head><title>Access Denied</title></head><body>
<h1>Access Denied</h1><p>You don't have permission to access "http://www.walled.example/" on this server.</p>
<p>Reference #18.4f2c1302.1696000000.1a2b3c4d</p></body></html>`;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
/* The logo is a mark in the brand's own green, as a real storefront's is: the
   reader takes a logo's colours as its strongest identity signal (2026-10-05),
   and a placeholder pixel there would be read as the brand's colour. */
const LOGO_PNG = (() => {
  const { PNG: P } = require('pngjs');
  const p = new P({ width: 140, height: 36 });
  for (let i = 0; i < p.data.length; i += 4) { p.data[i] = 0x0b; p.data[i + 1] = 0x6e; p.data[i + 2] = 0x4f; p.data[i + 3] = 255; }
  return P.sync.write(p);
})();

function siteHandler(kind) {
  return (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (u.pathname === '/robots.txt') return send(200, 'text/plain', 'User-agent: *\nAllow: /\n');
    if (kind === 'walled') return send(403, 'text/html; charset=utf-8', WALLED);
    if (u.pathname === '/fonts/harbour.ttf' && FONT) return send(200, 'font/ttf', FONT);
    if (u.pathname === '/logo.png') return send(200, 'image/png', LOGO_PNG);
    if (/\.(png|ico)$/.test(u.pathname)) return send(200, 'image/png', PNG);
    if (u.pathname === '/' || u.pathname === '') return send(200, 'text/html; charset=utf-8', kind === 'brand-a' ? BRAND_A : BRAND_MONO);
    return send(404, 'text/html; charset=utf-8', '<!doctype html><title>Not found</title><p>Not found</p>');
  };
}

/** Start one server per site. Returns { origins: {kind: origin}, close() }. */
async function startSites(kinds) {
  const servers = [];
  const origins = {};
  for (const kind of kinds || ['brand-a', 'brand-mono', 'walled']) {
    const srv = http.createServer(siteHandler(kind));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    servers.push(srv);
    origins[kind] = `http://127.0.0.1:${srv.address().port}`;
  }
  return {
    origins,
    close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))),
  };
}

module.exports = { startSites, EXPECT, HAS_FONT: !!FONT };
