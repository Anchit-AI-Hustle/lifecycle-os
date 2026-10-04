'use strict';
/**
 * Fixture SITES for the rendered brand read, each built to reproduce one thing
 * the stylesheet parser (brand-extract.js) gets wrong, served by a real HTTP
 * server on 127.0.0.1 so the real network layer (render-net.js: route
 * interception -> policy -> pinned transport) carries every byte.
 *
 *   a  utility-first (Tailwind-style compiled classes, no h1{} rule, no .btn)
 *   b  Shopify-theme-style: brand colours are custom properties SET AT RUNTIME
 *      by an inline <script>; the stylesheet only references var(--...)
 *   c  two @font-face families, both LOADED, only one USED
 *   d  the call to action styled only through a compound :not() selector,
 *      with a :hover state
 *   e  the logo is an inline SVG in the header
 *   f  a dark-neutral hero band over a light body
 *   g  a bot wall (403) and a soft challenge page (200)
 *   ssrf  a page that tries to reach private addresses every way a page can
 *
 * Every expected value below is what the BROWSER computes for the fixture, and
 * the specs assert those exact values.
 */
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'fixtures', 'fonts');
const DISPLAY_TTF = fs.readFileSync(path.join(FONT_DIR, 'EricaOne-Regular.ttf'));
const UNUSED_TTF = fs.readFileSync(path.join(FONT_DIR, 'Italiana-Regular.ttf'));

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const productSvg = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500"><rect width="400" height="500" fill="${c}"/></svg>`;
const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="32" viewBox="0 0 120 32"><rect width="120" height="32" rx="4" fill="#0f5132"/></svg>';

const ROBOTS = 'User-agent: *\nAllow: /\n';

/* ── a: utility-first ─────────────────────────────────────────────────── */
const A_CSS = `*,::before,::after{box-sizing:border-box;border:0 solid #e5e7eb}
html{line-height:1.5;font-family:ui-sans-serif,system-ui,sans-serif}body{margin:0;line-height:inherit}
h1,h2,h3,p{margin:0}a{color:inherit;text-decoration:inherit}img{display:block;max-width:100%;height:auto}
.mx-auto{margin-left:auto;margin-right:auto}.max-w-6xl{max-width:72rem}.flex{display:flex}.grid{display:grid}
.grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.gap-6{gap:1.5rem}.items-center{align-items:center}
.justify-between{justify-content:space-between}.px-6{padding-left:1.5rem;padding-right:1.5rem}.py-3{padding-top:.75rem;padding-bottom:.75rem}
.py-4{padding-top:1rem;padding-bottom:1rem}.py-20{padding-top:5rem;padding-bottom:5rem}.p-4{padding:1rem}
.bg-white{background-color:#fff}.bg-\\[\\#f6faf7\\]{background-color:#f6faf7}.bg-\\[\\#0f5132\\]{background-color:#0f5132}.bg-\\[\\#e9f1ec\\]{background-color:#e9f1ec}
.text-white{color:#fff}.text-\\[\\#14281d\\]{color:#14281d}.text-\\[\\#3a4a40\\]{color:#3a4a40}.text-\\[\\#0f5132\\]{color:#0f5132}
.text-4xl{font-size:2.25rem;line-height:2.5rem}.text-base{font-size:1rem}.leading-7{line-height:1.75rem}.text-sm{font-size:.875rem;line-height:1.25rem}.text-lg{font-size:1.125rem;line-height:1.75rem}
.font-bold{font-weight:700}.font-semibold{font-weight:600}.tracking-tight{letter-spacing:-.025em}.uppercase{text-transform:uppercase}.tracking-wide{letter-spacing:.025em}
.rounded-lg{border-radius:.5rem}.rounded-xl{border-radius:.75rem}.shadow{box-shadow:0 1px 3px 0 rgb(0 0 0 / .1),0 1px 2px -1px rgb(0 0 0 / .1)}
.mt-4{margin-top:1rem}.mt-8{margin-top:2rem}.h-8{height:2rem}.w-auto{width:auto}.aspect-\\[4\\/5\\]{aspect-ratio:4/5}.w-full{width:100%}.object-cover{object-fit:cover}
.inline-block{display:inline-block}.border-b{border-bottom-width:1px}`;
const A_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verdant Supply</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/app.css"></head>
<body class="bg-[#f6faf7] text-[#3a4a40]">
<header class="bg-white border-b"><div class="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
  <a href="/"><img class="h-8 w-auto" src="/logo.svg" alt="Verdant Supply logo"></a>
  <nav class="flex gap-6 text-sm font-semibold text-[#14281d]"><a href="/collections/all">Shop</a><a href="/about">About</a><a href="/journal">Journal</a></nav>
</div></header>
<main>
  <section class="py-20"><div class="mx-auto max-w-6xl px-6">
    <div class="text-4xl font-bold tracking-tight text-[#14281d]">Plants that outlive the trend</div>
    <p class="mt-4 text-base leading-7 text-[#3a4a40]">We grow every plant in our own glasshouse and ship it in a pot that is already the right size, so it arrives ready for the window you bought it for.</p>
    <a class="mt-8 inline-block bg-[#0f5132] text-white px-6 py-3 rounded-lg font-semibold text-base" href="/collections/all">Shop the range</a>
  </div></section>
  <section class="py-20 bg-white"><div class="mx-auto max-w-6xl px-6 grid grid-cols-3 gap-6">
    ${['Fern', 'Monstera', 'Calathea'].map((n, i) => `<div class="bg-white rounded-xl shadow p-4"><a href="/products/${n.toLowerCase()}"><img class="w-full aspect-[4/5] object-cover rounded-lg" src="/p${i}.svg" alt="${n}"></a><h3 class="mt-4 text-lg font-semibold text-[#14281d]"><a href="/products/${n.toLowerCase()}">${n} in a stoneware pot</a></h3><p class="text-sm text-[#0f5132] font-semibold">$${48 + i * 6}.00</p></div>`).join('')}
  </div></section>
  <section class="py-20"><div class="mx-auto max-w-6xl px-6"><p class="text-base leading-7">Every plant ships with a care card written by the person who grew it, and a thirty-day promise that if it does not settle in, we replace it.</p></div></section>
</main>
<footer class="bg-[#e9f1ec] py-20"><div class="mx-auto max-w-6xl px-6 text-sm text-[#14281d]">Verdant Supply Ltd, 12 Glasshouse Lane. <a href="/about">About us</a></div></footer>
</body></html>`;

/* ── b: theme colours set at runtime by script ───────────────────────────── */
const B_CSS = `:root{--color-base-text:#1d1d1f;--color-base-background:#ffffff}
body{margin:0;font-family:Arial,Helvetica,sans-serif;color:var(--color-base-text);background:var(--color-base-background)}
.announcement{background:var(--color-brand);color:#fff;text-align:center;padding:8px;font-size:13px}
.site-header{display:flex;justify-content:space-between;align-items:center;padding:18px 40px;background:#fff;border-bottom:1px solid #eee}
.site-header .wordmark{font-size:22px;font-weight:700;color:var(--color-brand)}
.hero{padding:96px 40px}.hero h1{font-size:52px;line-height:1.1;font-weight:800;margin:0 0 18px;color:#1d1d1f}
.hero p{font-size:18px;line-height:1.6;max-width:640px;margin:0 0 28px}
.button{display:inline-block;background:var(--color-button);color:var(--color-button-text);padding:14px 28px;border-radius:999px;font-weight:700;text-decoration:none;font-size:16px}
.copy{padding:24px 40px;font-size:16px;line-height:1.6}
footer{background:#f4f4f5;padding:40px;font-size:14px;color:#3f3f46}`;
const B_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harbourlight</title>
<script>(function(){var r=document.documentElement.style;r.setProperty('--color-brand','#1a4d8f');r.setProperty('--color-button','#b8531f');r.setProperty('--color-button-text','#ffffff');})();</script>
<link rel="stylesheet" href="/theme.css"></head><body>
<div class="announcement">Free delivery over $60</div>
<header class="site-header"><a class="wordmark" href="/">Harbourlight</a><nav><a href="/collections/lamps">Lamps</a> <a href="/about">About</a></nav></header>
<section class="hero"><h1>Light made by hand on the harbour</h1><p>We turn, solder and wire every lamp ourselves, in a workshop you can visit, and we repair any we have ever sold.</p><a class="button" href="/collections/lamps">Shop lamps</a></section>
<div class="copy"><p>Each lamp is finished to order in brass or copper, and ships wrapped in recycled paper with a hand-written card from the maker.</p></div>
<footer>Harbourlight Goods Ltd, 4 Quay Street. All lamps repaired for life.</footer>
</body></html>`;

/* ── c: two families loaded, one used ───────────────────────────────────── */
const C_CSS = `@font-face{font-family:"Fixture Display";src:url("/fonts/display.ttf") format("truetype");font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:"Fixture Unused";src:url("/fonts/unused.ttf") format("truetype");font-weight:400;font-style:normal;font-display:block}
body{margin:0;font-family:Georgia,serif;font-size:17px;line-height:1.7;color:#2b2b2b;background:#fffdf8}
header{padding:20px 48px;background:#fffdf8}header a{color:#2b2b2b;text-decoration:none}
h1{font-family:"Fixture Display",Georgia,serif;font-size:60px;line-height:1.05;font-weight:400;color:#7a1f2b;margin:40px 48px 16px}
p{margin:0 48px 16px;max-width:680px}
.cta{display:inline-block;margin:8px 48px;background:#7a1f2b;color:#fffdf8;padding:12px 26px;border-radius:2px;text-decoration:none;font-family:Georgia,serif}
footer{padding:32px 48px;background:#f3ece0;color:#2b2b2b}`;
const C_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rosehip Press</title>
<link rel="preload" as="font" type="font/ttf" href="/fonts/unused.ttf" crossorigin>
<link rel="stylesheet" href="/c.css">
<script>document.fonts && document.fonts.load('16px "Fixture Unused"');</script></head><body>
<header><a href="/">Rosehip Press</a></header>
<h1>Books set by hand</h1>
<p>Every edition we publish is set in metal type and printed on a press older than the building it stands in, in runs small enough that we know who bought each copy.</p>
<p>We keep every plate, so a book that sells out can be printed again exactly as it was.</p>
<a class="cta" href="/books">See the books</a>
<footer>Rosehip Press, 9 Mill Yard.</footer></body></html>`;

/* ── d: CTA only through a compound :not() selector, with :hover ─────────── */
const D_CSS = `body{margin:0;font-family:Verdana,sans-serif;background:#ffffff;color:#222;font-size:16px;line-height:1.6}
header{display:flex;justify-content:space-between;padding:16px 32px;background:#ffffff}
.hero{padding:72px 32px}.hero .title{font-size:44px;font-weight:700;line-height:1.15;color:#222;margin:0 0 16px}
.hero .actions > a:not(.ghost){display:inline-block;background:#6a1b9a;color:#ffffff;padding:13px 30px;border-radius:6px;text-transform:uppercase;letter-spacing:1.5px;font-size:14px;font-weight:700;text-decoration:none}
.hero .actions > a:not(.ghost):hover{background:#4a148c}
.hero .actions > a.ghost{display:inline-block;color:#6a1b9a;padding:12px 28px;border:1px solid #6a1b9a;border-radius:6px;text-decoration:none;margin-left:12px}
.body-copy{padding:0 32px;max-width:720px}
footer{padding:28px 32px;background:#f3e5f5;color:#311b42}`;
const D_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Violet &amp; Vine</title><link rel="stylesheet" href="/d.css"></head><body>
<header><a href="/">Violet &amp; Vine</a><a href="/about">About</a></header>
<section class="hero"><div class="title">Wine from one hillside</div><div class="actions"><a href="/shop">Order a case</a><a class="ghost" href="/visit">Visit us</a></div></section>
<div class="body-copy"><p>Our vines grow on a single south-facing slope, and every bottle we sell was picked, pressed and aged within sight of where it grew.</p></div>
<footer>Violet &amp; Vine Estate.</footer></body></html>`;

/* ── e: inline SVG logo ─────────────────────────────────────────────────── */
const E_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Magenta Cycle</title>
<style>body{margin:0;font-family:Arial,sans-serif;color:#1a1a1a;background:#fff;font-size:16px;line-height:1.5}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 36px;background:#fff;border-bottom:1px solid #eee}
h1{font-size:40px;margin:48px 36px 12px;color:#1a1a1a}p{margin:0 36px 14px;max-width:640px}
.btn{display:inline-block;margin:10px 36px;background:#c2185b;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none}
footer{padding:24px 36px;background:#fce4ec;color:#1a1a1a}</style></head><body>
<header><a href="/" aria-label="Magenta Cycle home"><svg width="140" height="36" viewBox="0 0 140 36" role="img"><circle cx="18" cy="18" r="16" fill="#c2185b"/><rect x="40" y="10" width="96" height="16" fill="#c2185b"/></svg></a><a href="/about">About</a></header>
<h1>Bikes built for one rider</h1><p>We measure you, then we build the frame, so the bike you ride is the only one of its size and shape that exists anywhere at all.</p>
<a class="btn" href="/fit">Book a fitting</a><footer>Magenta Cycle Works.</footer></body></html>`;

/* ── f: dark hero band over a light body ─────────────────────────────────── */
const F_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Night Owl Coffee</title>
<style>body{margin:0;font-family:Arial,sans-serif;background:#fafafa;color:#1f1f1f;font-size:16px;line-height:1.6}
header{padding:16px 40px;background:#fafafa}
.hero{background:#121212;color:#f5f5f5;padding:88px 40px}.hero h1{font-size:48px;margin:0 0 12px}
.hero a{display:inline-block;background:#e0a526;color:#121212;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700}
.copy{padding:40px}footer{padding:24px 40px;background:#efefef}</style></head><body>
<header><a href="/">Night Owl Coffee</a></header>
<section class="hero"><h1>Roasted after midnight</h1><a href="/shop">Shop coffee</a></section>
<div class="copy"><p>We roast through the night so the coffee that reaches you in the morning left our roaster less than a day before, and we print that hour on every bag.</p></div>
<footer>Night Owl Coffee Roasters.</footer></body></html>`;

/* ── g: walls ───────────────────────────────────────────────────────────── */
const G_CHALLENGE = `<!doctype html><html><head><title>Just a moment...</title></head><body><h1>Checking your browser before accessing the site.</h1><div id="cf-challenge-running">cf-browser-verification</div><p>Ray ID: 8a1b2c3d4e5f</p></body></html>`;

function siteRoutes(name) {
  const page = (body) => ({ status: 200, type: 'text/html; charset=utf-8', body });
  const css = (body) => ({ status: 200, type: 'text/css', body });
  const svg = (body) => ({ status: 200, type: 'image/svg+xml', body });
  const base = { '/robots.txt': { status: 200, type: 'text/plain', body: ROBOTS } };
  if (name === 'a') {
    return Object.assign(base, {
      '/': page(A_HOME), '/app.css': css(A_CSS), '/logo.svg': svg(logoSvg), '/icon.svg': svg(logoSvg),
      '/p0.svg': svg(productSvg('#cfe3d6')), '/p1.svg': svg(productSvg('#b7d3c1')), '/p2.svg': svg(productSvg('#9fc2ab')),
      '/collections/all': page(A_HOME.replace('Plants that outlive the trend', 'All plants')), '/about': page('<!doctype html><title>About</title><body><h1>About</h1><p>We grow plants.</p></body>'),
    });
  }
  if (name === 'b') return Object.assign(base, { '/': page(B_HOME), '/theme.css': css(B_CSS) });
  if (name === 'c') {
    return Object.assign(base, {
      '/': page(C_HOME), '/c.css': css(C_CSS),
      '/fonts/display.ttf': { status: 200, type: 'font/ttf', body: DISPLAY_TTF },
      '/fonts/unused.ttf': { status: 200, type: 'font/ttf', body: UNUSED_TTF },
    });
  }
  if (name === 'd') return Object.assign(base, { '/': page(D_HOME), '/d.css': css(D_CSS) });
  if (name === 'e') return Object.assign(base, { '/': page(E_HOME) });
  if (name === 'f') return Object.assign(base, { '/': page(F_HOME) });
  if (name === 'g403') return Object.assign(base, { '/': { status: 403, type: 'text/html', body: '<h1>Forbidden</h1>' } });
  if (name === 'gsoft') return Object.assign(base, { '/': page(G_CHALLENGE) });
  return base;
}

/** The SSRF page: every way a page can try to reach the canary. */
function ssrfRoutes(canaryPort) {
  const C = `http://127.0.0.1:${canaryPort}`;
  return {
    '/robots.txt': { status: 200, type: 'text/plain', body: ROBOTS },
    '/': { status: 200, type: 'text/html', body: `<!doctype html><html><head><title>Probe</title>
<link rel="stylesheet" href="${C}/style.css"><link rel="prefetch" href="${C}/prefetch"><link rel="icon" href="http://169.254.169.254/latest/meta-data/">
</head><body><h1>Probe page</h1><p>This page tries every route a page has to a private address, and none of them may connect.</p>
<img src="${C}/img.png"><img src="http://169.254.169.254/latest/meta-data/iam"><img src="http://[::1]:${canaryPort}/v6"><img src="http://0x7f000001:${canaryPort}/hex">
<img src="/bounce-private"><img src="http://rebind.example/x.png">
<iframe src="${C}/frame"></iframe><iframe src="/bounce-private"></iframe>
<a class="cta" style="display:inline-block;background:#335;color:#fff;padding:10px 20px" href="/shop">Shop</a>
<script>
  fetch('${C}/fetch').catch(function(){});
  fetch('/bounce-private').catch(function(){});
  fetch('http://169.254.169.254/latest/api/token', { method: 'PUT' }).catch(function(){});
  try { var x = new XMLHttpRequest(); x.open('GET', '${C}/xhr'); x.send(); } catch (e) {}
  try { new WebSocket('ws://127.0.0.1:${canaryPort}/ws'); } catch (e) {}
  try { navigator.sendBeacon('${C}/beacon', 'x'); } catch (e) {}
  try { new EventSource('${C}/es'); } catch (e) {}
  try { navigator.serviceWorker && navigator.serviceWorker.register('/sw.js').catch(function(){}); } catch (e) {}
  try { var pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${canaryPort}' }] }); pc.createDataChannel('x'); pc.createOffer().then(function(o){ return pc.setLocalDescription(o); }).catch(function(){}); } catch (e) {}
  setTimeout(function(){ try { location.href = '${C}/navigate'; } catch (e) {} }, 400);
</script></body></html>` },
    '/bounce-private': { status: 302, type: 'text/plain', body: '', headers: { location: `${C}/after-redirect` } },
    '/sw.js': { status: 200, type: 'text/javascript', body: 'self.addEventListener("fetch",function(){});' },
    '/shop': { status: 200, type: 'text/html', body: '<!doctype html><title>Shop</title><h1>Shop</h1>' },
  };
}

/** Serve a route map on 127.0.0.1; resolves { origin, port, hits, close }. */
function serve(routes) {
  return new Promise((resolve) => {
    const hits = [];
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      hits.push(u.pathname);
      const r = routes[u.pathname];
      if (!r) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(r.status || 200, Object.assign({ 'content-type': r.type || 'text/html', 'access-control-allow-origin': '*' }, r.headers || {}));
      res.end(r.body);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ origin: `http://127.0.0.1:${port}`, port, hits, server, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

/** A TCP canary: counts every connection, whatever protocol it speaks. */
function canary() {
  return new Promise((resolve) => {
    const conns = [];
    const server = net.createServer((sock) => {
      conns.push(Date.now());
      sock.on('error', () => {});
      sock.end('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok');
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, conns, close: () => new Promise((r) => server.close(() => r())) }));
  });
}

module.exports = { siteRoutes, ssrfRoutes, serve, canary, A_HOME, B_HOME, C_HOME, D_HOME, E_HOME, F_HOME, A_CSS, B_CSS, C_CSS, D_CSS, PNG_1x1 };
