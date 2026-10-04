/**
 * Reader defects found by review and by the 40-brand harvest, each EXECUTED.
 * ---------------------------------------------------------------------------
 * Every case here is a local fixture read through the SHIPPED reader
 * (brand-render.readSite: a fresh Chromium, render-net, render-stabilise,
 * render-capture), or render-capture.capturePage run on a page in Chromium.
 * The one test seam is `policy.allowOrigins` (exact fixture origins).
 *
 *  1. A page whose Content-Security-Policy forbids inline styles: the consent
 *     overlay is hidden through the CSSOM and VERIFIED hidden in the pixels.
 *  2. The font legal gate excuses only the face the fallback stack draws.
 *  3. Consent containers (TrustArc, a cookie dialog) are never measured.
 *  4. A pale control (under 1.5:1 against the page) is not a call to action.
 *  5. A token SCALE gives the step the site renders, not its palest step.
 *  6. perRequestMs / firstDocumentMs reach the network layer.
 *  7. A Google Fonts family the site hosts itself is a Google family.
 *  8. A face still loading is waited for before the page is measured.
 *
 * Run: npx playwright test tests/rendered-read-defects.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
delete process.env.BRAND_RENDER;

const RENDER = '../api/_shared/brand-render.js';
const FONT = fs.readFileSync(path.join(__dirname, 'fixtures', 'fonts', 'EricaOne-Regular.ttf'));
const ROBOTS = { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' };
const VIEW = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';

test.describe.configure({ mode: 'parallel' });
test.setTimeout(150000);

/** A fixture server: routes with an optional delay and headers. */
function serve(routes) {
  return new Promise((resolve) => {
    const hits = [];
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      hits.push(u.pathname);
      const r = routes[u.pathname];
      if (!r) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('nf'); return; }
      const send = () => { res.writeHead(r.status || 200, Object.assign({ 'content-type': r.type || 'text/html; charset=utf-8' }, r.headers || {})); res.end(r.body); };
      if (r.delay) setTimeout(send, r.delay); else send();
    });
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ origin, hits, close: () => new Promise((x) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => x()); }) });
    });
  });
}
async function readOn(routes, opts) {
  const srv = await serve(Object.assign({ '/robots.txt': ROBOTS }, routes));
  try {
    const out = await require(RENDER).readSite(srv.origin + '/', Object.assign({ policy: { allowOrigins: new Set([srv.origin]) }, deadlineMs: 110000, regression: false, maxPages: 0 }, opts || {}));
    return { out, srv };
  } finally { await srv.close(); }
}

/* ── 1. CSP style-src 'self' ─────────────────────────────────────────────── */
test('(1) a CSP that forbids inline styles: the consent overlay is hidden through the CSSOM and verified hidden in the screenshot', async ({ page }) => {
  // Review finding on #134: the injected <style> is refused under this CSP, so
  // the overlay was REPORTED hidden while it was still painted.
  const css = `body{margin:0;font-family:Verdana,sans-serif;color:#222;background:#ffffff}
h1{font:700 44px Georgia,serif;color:#1b2a44;margin:40px 48px 16px}p{margin:0 48px 16px;max-width:640px}
@keyframes pulse{0%{background-color:#ff0000}100%{background-color:#0000ff}}
.cta{display:inline-block;margin:8px 48px;background:#2f4f8f;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:700;animation:pulse 1s linear infinite}
#cookie-banner{position:fixed;left:0;right:0;bottom:0;height:120px;background:#000000;color:#ffffff;padding:20px 48px;z-index:99;font-size:18px}
#cookie-banner a{display:inline-block;margin-left:24px;background:#ff6a00;color:#000;padding:20px 64px;border-radius:30px;font-weight:800;text-decoration:none}`;
  const html = `<!doctype html><html lang="en"><head>${VIEW}<title>Bluewater</title><link rel="stylesheet" href="/site.css"></head><body>
<h1>Gear for open water</h1><p>We test every jacket on the crossing to the island and back, in the weather it was made for.</p>
<a class="cta" href="/shop">Shop jackets</a>
<div id="cookie-banner" role="dialog" aria-label="Cookie consent">We use cookies to measure how this site is used.<a href="/consent/accept">Accept all cookies</a></div></body></html>`;
  const csp = { 'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'" };
  const { out, srv } = await readOn({ '/': { body: html, headers: csp }, '/site.css': { type: 'text/css', body: css, headers: csp } });
  expect(out.ok, out.reason).toBe(true);
  const st = out.manifest.read.desktop.stabilised;
  expect(st.freeze_route).toMatch(/^cssom/);
  const banner = st.consent_hidden.find((x) => x.id === 'cookie-banner');
  expect(banner, JSON.stringify(st)).toMatchObject({ verified: true });
  expect(st.consent_unhidden).toEqual([]);
  expect(srv.hits.some((h) => /consent\/accept/.test(h))).toBe(false);
  // The infinite animation is frozen too: the CTA reads its declared fill.
  expect(out.manifest.read.desktop.roles.button_primary.style.background).toBe('#2f4f8f');
  // And it is not PAINTED: the fold screenshot where the banner sits is page white.
  const fold = out.screenshots.desktop.fold;
  const px = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    return Array.from(x.getImageData(Math.round(img.width / 2), img.height - 40, 1, 1).data);
  }, `data:${fold.mime};base64,${fold.data}`);
  expect(px[0] + px[1] + px[2], `the banner is still painted: rgb(${px.slice(0, 3)})`).toBeGreaterThan(700);
});

/* ── 2. the font legal gate's exemption ──────────────────────────────────── */
test('(2) the font legal gate excuses ONLY the face the recorded fallback stack draws; any other face is a miss', async () => {
  const rr = require('../api/_shared/render-regression.js');
  const brandFonts = new Set(['brand sans']);
  // Drawn as the fallback stack's own first available face: the gate working.
  expect(rr.licenceExempt('DejaVu Serif', 'Brand Sans', brandFonts, 'DejaVu Serif')).toBe(true);
  // Drawn as something else (Arial for a Georgia fallback): a miss.
  expect(rr.licenceExempt('Liberation Sans', 'Brand Sans', brandFonts, 'DejaVu Serif')).toBe(false);
  // Not a brand font, or no fallback measured: never exempt.
  expect(rr.licenceExempt('DejaVu Serif', 'Erica One', brandFonts, 'DejaVu Serif')).toBe(false);
  expect(rr.licenceExempt('DejaVu Serif', 'Brand Sans', brandFonts, '')).toBe(false);
  const rows = rr.judge([
    { surface: 'mailer', component: 'pure: heading', token: 'drawn face', kind: 'face', site: 'Brand Sans', ours: 'DejaVu Serif', licence_exempt: rr.licenceExempt('DejaVu Serif', 'Brand Sans', brandFonts, 'DejaVu Serif'), licence_family: 'Brand Sans' },
    { surface: 'mailer', component: 'pure: heading', token: 'drawn face', kind: 'face', site: 'Brand Sans', ours: 'Liberation Sans', licence_exempt: rr.licenceExempt('Liberation Sans', 'Brand Sans', brandFonts, 'DejaVu Serif'), licence_family: 'Brand Sans' },
  ]);
  expect(rows.map((r) => r.status)).toEqual(['exempt', 'mismatch']);
});

/* ── 3. consent containers are never measured ────────────────────────────── */
const CONSENT_PAGE = `<!doctype html><html lang="en"><head>${VIEW}<title>Northpoint</title><style>
body{margin:0;font-family:Verdana,sans-serif;color:#222;background:#fff}
.cmp{background:#f2f2f2;padding:16px 32px}
.cmp a,.cmp button{display:inline-block;border:0;padding:22px 90px;font:800 22px Verdana;border-radius:6px;text-decoration:none}
#truste-consent-content button{background:#00a0e0;color:#fff}
.cookie-dialog a{background:#ff6a00;color:#000}
h1{font:700 40px Georgia,serif;color:#111;margin:32px}
.cta{display:inline-block;margin:0 32px;background:#1428a0;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:700}
</style></head><body>
<div id="truste-consent-content" class="cmp">Your privacy matters. <button type="button">Agree and proceed</button></div>
<div class="cmp cookie-dialog" role="dialog" aria-label="Privacy">We use cookies to measure how this site is used. <a href="/consent/accept">Accept all</a></div>
<h1>Phones that last</h1><p style="margin:0 32px 16px">Every model is supported with updates for seven years from the day it ships.</p>
<a class="cta" href="/shop">Shop phones</a></body></html>`;

test('(3) consent containers are excluded from every role in the READER: a TrustArc box and a cookie dialog lend nothing', async ({ page }) => {
  // Harvest findings: one brand's primary was measured on its cookie banner,
  // another's accent on a TrustArc button. These banners are NOT fixed, so
  // nothing hid them; the capture itself must exclude them.
  const capture = require('../api/_shared/render-capture.js');
  const { CONSENT } = require('../api/_shared/render-stabilise.js');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(CONSENT_PAGE);
  const data = await page.evaluate(capture.capturePage, { cssNames: [], maxImages: 4, consent: CONSENT });
  expect(data.roles.button_primary.style.background).toBe('#1428a0');
  expect(data.roles.button_primary.label).toBe('Shop phones');
  const ids = data.consent_excluded.map((x) => x.id || x.cls);
  expect(ids).toContain('truste-consent-content');
  expect(ids.some((x) => /cookie-dialog/.test(x))).toBe(true);
  // And through the whole reader: neither consent colour reaches the manifest.
  const { out, srv } = await readOn({ '/': { body: CONSENT_PAGE } });
  expect(out.ok).toBe(true);
  expect(srv.hits.some((h) => /consent/.test(h))).toBe(false);
  const m = JSON.stringify({ colors: out.manifest.colors, roles: out.manifest.read.desktop.roles });
  expect(m).not.toContain('#00a0e0');
  expect(m).not.toContain('#ff6a00');
  expect(out.manifest.colors.primary.value).toBe('#1428a0');
});

/* ── 4. a pale control is not a call to action ───────────────────────────── */
test('(4) a pale control under 1.5:1 against the page is not the primary call to action, however large', async ({ page }) => {
  const capture = require('../api/_shared/render-capture.js');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(`<!doctype html><html><head>${VIEW}<style>
body{margin:0;font-family:Verdana,sans-serif;color:#222;background:#ffffff}
.tab{display:inline-block;margin:24px;padding:22px 120px;background:#ecf0f4;color:#222;border:0;border-radius:30px;font:600 20px Verdana}
.cta{display:inline-block;margin:24px;padding:12px 24px;background:#e4002b;color:#fff;border-radius:4px;text-decoration:none;font-weight:700}
</style></head><body><button class="tab" type="button">Earbuds</button><button class="tab" type="button">Speakers</button>
<h1 style="margin:24px">Sound you can wear</h1><a class="cta" href="/shop">Shop now</a></body></html>`);
  const data = await page.evaluate(capture.capturePage, { cssNames: [], maxImages: 4 });
  const b = data.roles.button_primary;
  expect(b.label).toBe('Shop now');
  expect(b.style.background).toBe('#e4002b');
  expect(b.ground_contrast).toBeGreaterThanOrEqual(1.5);
  expect(b.contrast_floor).toBe(1.5);
  expect(data.notes.join(' ')).toMatch(/filled #ecf0f4 at 1\.1\d:1 against the page was not taken as a call to action \(under 1\.5:1\)/);
});

/* ── 5. a token scale gives the step the site renders ────────────────────── */
test('(5) a brand token SCALE gives the step the site renders on its identity elements, never its palest step; an unrendered scale proposes nothing', async () => {
  const html = `<!doctype html><html lang="en"><head>${VIEW}<title>Ledgerline</title><style>
:root{--hds-color-core-brand-25:#f5f5ff;--hds-color-core-brand-50:#e8e9ff;--hds-color-core-brand-500:#635bff;--hds-color-core-brand-900:#1c1e54;--acme-brand-100:#ffe8d6;--acme-brand-200:#ffd0ad}
body{margin:0;font-family:Verdana,sans-serif;color:#30313d;background:#ffffff}
header{padding:16px 40px}h1{font:700 48px Georgia,serif;color:#1c1e54;margin:40px}
.cta{display:inline-block;margin:0 40px;background:var(--hds-color-core-brand-500);color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700}
</style></head><body><header><a href="/"><svg width="90" height="30" viewBox="0 0 90 30"><rect width="90" height="30" rx="6" fill="#635bff"/></svg></a></header>
<h1>Payments infrastructure</h1><p style="margin:0 40px 16px">Accept payments and move money with one integration, in every market you sell to.</p>
<a class="cta" href="/start">Start now</a></body></html>`;
  const { out } = await readOn({ '/': { body: html } });
  expect(out.ok).toBe(true);
  const p = out.manifest.colors.primary;
  expect(p.value).toBe('#635bff');
  expect(p.from_role).toBe('identity');
  // The mark itself paints #635bff (the strongest signal since 2026-10-05);
  // the scale still proposes exactly that step, never its palest.
  const step = out.manifest.identity.candidates.find((c) => c.kind === 'token');
  expect(step.value).toBe('#635bff');
  expect(step.signal).toMatch(/--hds-color-core-brand-500 as computed on :root: the step of --hds-color-core-brand-\* the site renders on its (logo mark|primary call to action)/);
  expect(out.manifest.identity.candidates.some((c) => c.value === '#f5f5ff')).toBe(false);
  expect(out.manifest.notes.join(' ')).toMatch(/--acme-brand-\* is a scale of 2 steps and none of them is rendered on the page, so it proposes no brand colour/);
});

/* ── 6. perRequestMs and firstDocumentMs reach the network layer ─────────── */
test('(6) perRequestMs and firstDocumentMs are threaded through readSite to every hop, bounded by the deadline', async () => {
  // Harvest finding: readSite dropped perRequestMs, so a slow first document
  // always died at the 9 s default.
  const html = `<!doctype html><html lang="en"><head>${VIEW}<title>Slowhome</title><link rel="stylesheet" href="/slow.css"></head><body><h1>Built to order</h1><p>Each piece is made after you order it, in the workshop behind the shop.</p><a href="/shop" style="display:inline-block;background:#245c3a;color:#fff;padding:10px 20px">Shop</a></body></html>`;
  const routes = { '/': { body: html, delay: 2500 }, '/slow.css': { type: 'text/css', body: 'h1{color:#123}', delay: 2500 } };
  const short = await readOn(routes, { perRequestMs: 1200 });
  expect(short.out.ok).toBe(false);
  expect(short.out.reason).toMatch(/timed out/);
  const long = await readOn(routes, { perRequestMs: 1200, firstDocumentMs: 6000 });
  expect(long.out.ok, long.out.reason).toBe(true);
  // The subresource still had the short timeout.
  expect(long.out.manifest.network.blocked.some((b) => /slow\.css/.test(b.url) && /timed out/.test(b.reason))).toBe(true);
});

/* ── 7. a self-hosted Google family is a Google family ───────────────────── */
test('(7) a Google Fonts family the site hosts ITSELF is recognised by name and loadable by reference', async () => {
  const html = `<!doctype html><html lang="en"><head>${VIEW}<title>Glowkind</title><style>
@font-face{font-family:"Inter";src:url("/fonts/inter.ttf") format("truetype");font-weight:400;font-display:block}
body{margin:0;font-family:"Inter",Arial,sans-serif;color:#222;background:#fff}h1{font:400 48px "Inter",Arial,sans-serif;color:#7a1f5c;margin:40px}
.cta{display:inline-block;margin:0 40px;background:#7a1f5c;color:#fff;padding:12px 22px;text-decoration:none}
</style></head><body><h1>Skin care, tested</h1><p style="margin:0 40px 16px">Every formula is tested on the skin types we sell it for before it reaches a shelf.</p><a class="cta" href="/shop">Shop</a></body></html>`;
  const { out } = await readOn({ '/': { body: html }, '/fonts/inter.ttf': { type: 'font/ttf', body: FONT } });
  expect(out.ok).toBe(true);
  expect(out.manifest.fonts.heading).toMatchObject({ family: 'Inter', google: true, google_self_hosted: true, licence: 'open (Google Fonts)' });
  const ds = require('../api/_shared/design-system.js');
  const rr = require('../api/_shared/render-regression.js');
  expect(ds.resolve(rr.brandFor(out.manifest)).fonts.googleHref).toContain('family=Inter');
  const obs = require('../scripts/lib/preset-observation.js').typographyFromManifest(out.manifest);
  expect(JSON.stringify(obs)).toContain('the app loads it from Google Fonts');
});

/* ── 8. a face still loading is waited for ───────────────────────────────── */
test('(8) a face the page asks for after load, still loading when the page settles, is waited for and measured as itself', async () => {
  // Harvest finding: a brand's own DIN read as system-ui because the face was
  // not loaded when the page was measured.
  const html = `<!doctype html><html lang="en"><head>${VIEW}<title>Fastline</title><style>
@font-face{font-family:"FFDINforPuma";src:url("/fonts/din.ttf") format("truetype");font-weight:400;font-display:swap}
body{margin:0;font-family:Verdana,sans-serif;color:#222;background:#fff}h1{font:400 52px Georgia,serif;color:#111;margin:40px}
.din h1{font-family:"FFDINforPuma",system-ui,sans-serif}
.cta{display:inline-block;margin:0 40px;background:#ba2026;color:#fff;padding:12px 22px;text-decoration:none}
</style><script>window.addEventListener('load', function () { setTimeout(function () { document.documentElement.classList.add('din'); }, 50); });</script></head>
<body><h1>Run further</h1><p style="margin:0 40px 16px">Every shoe in the range is tested over a thousand kilometres before it is sold.</p><a class="cta" href="/shop">Shop running</a></body></html>`;
  const { out } = await readOn({ '/': { body: html }, '/fonts/din.ttf': { type: 'font/ttf', body: FONT, delay: 11000 } }, { perRequestMs: 30000 });
  expect(out.ok, out.reason).toBe(true);
  const waited = out.manifest.read.desktop.faces_waited || [];
  expect(waited.some((w) => /FFDINforPuma/.test(w.font) && w.after === 'loaded'), JSON.stringify(waited)).toBe(true);
  expect(out.manifest.fonts.heading).toMatchObject({ family: 'FFDINforPuma', kind: 'webfont' });
});

/* ── 9. a network that cannot reach an address never takes the read down ── */
test('(9) an unreachable IPv6 address fails ONE request cleanly, IPv4 is tried first, and the read survives', async () => {
  // The harvest on a runner with no IPv6 route: every connect to a Google
  // IPv6 address failed at once, the pinned lookup had answered
  // SYNCHRONOUSLY, the error was emitted on the socket before http listened,
  // and the WHOLE reader process died. Run in a child process, so a crash is
  // a failed exit code rather than a dead test worker.
  const { spawnSync } = require('child_process');
  const NET_ABS = require.resolve('../api/_shared/render-net.js');
  const RENDER_ABS = require.resolve('../api/_shared/brand-render.js');
  const code = `
    const net = require(${JSON.stringify(NET_ABS)});
    const http = require('http');
    const dns = require('dns').promises;
    const realLookup = dns.lookup;
    dns.lookup = async (h, o) => (h === 'v6only.example' ? [{ address: '100::1', family: 6 }, { address: '100::2', family: 6 }] : realLookup(h, o));
    (async () => {
      const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
      const page = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dual</title></head><body><h1>Two families of address</h1><p>The picture below lives on a host that only has IPv6 addresses, which this machine cannot reach.</p><img src="http://v6only.example/x.png" width="20" height="20"><a href="/x" style="display:inline-block;background:#245c3a;color:#fff;padding:10px 20px">Go</a></body></html>';
      const srv = http.createServer((q, r) => {
        if (q.url === '/robots.txt') { r.writeHead(200, { 'content-type': 'text/plain' }); r.end('User-agent: *\\nAllow: /\\n'); return; }
        if (q.url === '/') { r.writeHead(200, { 'content-type': 'text/html' }); r.end(page); return; }
        r.writeHead(200, { 'content-type': 'image/png' }); r.end(PNG);
      });
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const port = srv.address().port;
      const out = {};
      const dual = await net.transport('http://dual.example:' + port + '/robots.txt', { addresses: [{ address: '100::1', family: 6 }, { address: '127.0.0.1', family: 4 }], timeoutMs: 5000 });
      out.dual = { status: dual.status, error: dual.error || '' };
      out.v6 = await net.transport('http://v6only.example:' + port + '/', { addresses: [{ address: '100::1', family: 6 }, { address: '100::2', family: 6 }], timeoutMs: 5000 });
      out.v6s = await net.transport('https://v6only.example/', { addresses: [{ address: '100::1', family: 6 }], timeoutMs: 5000 });
      out.first = await new Promise((r) => net.pinnedLookup([{ address: '100::1', family: 6 }, { address: '127.0.0.1', family: 4 }])('dual.example', {}, (e, a, f) => r({ a, f })));
      let sync = true;
      net.pinnedLookup([{ address: '127.0.0.1', family: 4 }])('x', {}, () => { out.sync_callback = sync; });
      sync = false;
      await new Promise((r) => setTimeout(r, 30));
      const origin = 'http://127.0.0.1:' + port;
      const read = await require(${JSON.stringify(RENDER_ABS)}).readSite(origin + '/', { policy: { allowOrigins: new Set([origin]) }, regression: false, maxPages: 0, deadlineMs: 60000 });
      out.read = { ok: read.ok, reason: read.reason || '', blocked: read.ok ? read.manifest.network.blocked.filter((b) => /v6only/.test(b.url)) : [] };
      srv.close();
      process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n');
      process.exit(0);
    })();`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { BRAND_RENDER: '' }) });
  expect(r.status, `the child died: ${String(r.stderr).slice(0, 600)}`).toBe(0);
  const line = String(r.stdout).split('\n').find((l) => l.startsWith('RESULT '));
  const out = JSON.parse(line.slice(7));
  expect(out.dual).toMatchObject({ status: 200, error: '' });
  expect(out.v6.error).toMatch(/could not connect to any approved address/);
  expect(out.v6s.error).toMatch(/could not connect to any approved address/);
  expect(out.first).toEqual({ a: '127.0.0.1', f: 4 });
  expect(out.sync_callback).toBe(false);
  expect(out.read.ok, out.read.reason).toBe(true);
  expect(out.read.blocked.length).toBeGreaterThan(0);
  expect(out.read.blocked[0].reason).toMatch(/could not connect to any approved address/);
});

/* ── 10. a vendor class on the page wrapper does not blank the page ──────── */
test('(10) a consent vendor class on an app wrapper that holds main/h1/nav is NOT hidden or excluded: the page is still read', async () => {
  const html = `<!doctype html><html lang="en"><head>${VIEW}<title>Wrapped</title><style>
body{margin:0;font-family:Verdana,sans-serif;color:#222;background:#fff}h1{font:700 44px Georgia,serif;color:#1d3b2a;margin:40px}
.cta{display:inline-block;margin:0 40px;background:#245c3a;color:#fff;padding:12px 22px;text-decoration:none;font-weight:700}
</style></head><body><div class="cookie-consent" id="app"><header><nav><a href="/">Wrapped</a> <a href="/shop">Shop</a></nav></header>
<main><h1>Tools that outlast you</h1><p style="margin:0 40px 16px">Every tool we sell is forged in the same workshop and guaranteed for as long as you own it.</p><a class="cta" href="/shop">Shop tools</a></main></div></body></html>`;
  const { out } = await readOn({ '/': { body: html } });
  expect(out.ok, out.reason).toBe(true);
  const d = out.manifest.read.desktop;
  expect(d.roles.button_primary && d.roles.button_primary.style.background).toBe('#245c3a');
  expect((d.roles.display || d.roles.headings.h1).text).toContain('Tools that outlast you');
  expect(d.stabilised.consent_hidden).toEqual([]);
  expect((d.stabilised.consent_skipped || []).map((x) => x.id)).toContain('app');
  expect(d.consent_excluded.map((x) => x.id)).not.toContain('app');
});

/* ── 11. a scale step by identity ROLE, not declaration order ────────────── */
test('(11) of the scale steps a site renders, the one on its LOGO wins over a link tint declared first', async () => {
  const html = `<!doctype html><html lang="en"><head>${VIEW}<title>Ardent</title><style>
:root{--acme-brand-300:#7b83ff;--acme-brand-500:#3a44d6;--acme-brand-900:#14185a}
body{margin:0;font-family:Verdana,sans-serif;color:#222;background:#fff}header{padding:16px 40px}h1{font:700 44px Georgia,serif;color:#111;margin:40px}
p a{color:var(--acme-brand-300)}.cta{display:inline-block;margin:0 40px;background:#222;color:#fff;padding:12px 22px;text-decoration:none}
</style></head><body><header><a href="/"><svg width="90" height="30" viewBox="0 0 90 30"><rect width="90" height="30" rx="6" fill="#3a44d6"/></svg></a></header>
<h1>Ledgers for the long haul</h1><p style="margin:0 40px 16px">Read <a href="/a">the guide</a>, <a href="/b">the pricing</a> and <a href="/c">the changelog</a> before you choose a plan.</p><a class="cta" href="/start">Start</a></body></html>`;
  const { out } = await readOn({ '/': { body: html } });
  expect(out.ok).toBe(true);
  expect(out.manifest.read.desktop.roles.link.type.color).toBe('#7b83ff');
  expect(out.manifest.colors.primary.value).toBe('#3a44d6');
  expect(out.manifest.colors.primary.signal).toMatch(/--acme-brand-500 .* renders on its logo mark/);
});

/* ── 12. the fallback face per SLOT ──────────────────────────────────────── */
test('(12) heading and body sharing one brand family with different fallbacks each keep their OWN fallback face', async ({ page }) => {
  const rr = require('../api/_shared/render-regression.js');
  await page.setContent('<!doctype html><html><body><p>probe page</p></body></html>');
  const fonts = {
    heading: { family: 'Brand Sans', licence: 'brand font', fallback_stack: "'Georgia',serif" },
    body: { family: 'Brand Sans', licence: 'brand font', fallback_stack: "'Arial',sans-serif" },
  };
  const bySlot = await rr.fallbackDrawn(page, fonts);
  expect(bySlot.heading, JSON.stringify(bySlot)).toBeTruthy();
  expect(bySlot.body).toBeTruthy();
  expect(bySlot.heading).not.toBe(bySlot.body);
  expect(rr.fallbackFaceFor('heading', 'Brand Sans', fonts, bySlot)).toBe(bySlot.heading);
  expect(rr.fallbackFaceFor('body copy', 'Brand Sans', fonts, bySlot)).toBe(bySlot.body);
  expect(rr.fallbackFaceFor('button', 'Brand Sans', fonts, bySlot)).toBe(bySlot.body);
});

/* ── 13. the face scan counts only text that renders ─────────────────────── */
test('(13) a hidden menu of 450 links does not use up the face scan before the visible heading is reached', async () => {
  const links = Array.from({ length: 450 }, (_, i) => `<a href="/c/${i}">Category ${i}</a>`).join('');
  const html = `<!doctype html><html lang="en"><head>${VIEW}<title>Fastline</title><style>
@font-face{font-family:"FFDINforPuma";src:url("/fonts/din.ttf") format("truetype");font-weight:400;font-display:swap}
body{margin:0;font-family:Verdana,sans-serif;color:#222;background:#fff}#mega{display:none}#mega a{display:block}
h1{font:400 52px Georgia,serif;color:#111;margin:40px}.din h1{font-family:"FFDINforPuma",system-ui,sans-serif}
.cta{display:inline-block;margin:0 40px;background:#ba2026;color:#fff;padding:12px 22px;text-decoration:none}
</style><script>window.addEventListener('load', function () { setTimeout(function () { document.documentElement.classList.add('din'); }, 50); });</script></head>
<body><div id="mega">${links}</div><h1>Run further</h1><p style="margin:0 40px 16px">Every shoe in the range is tested over a thousand kilometres before it is sold.</p><a class="cta" href="/shop">Shop running</a></body></html>`;
  const { out } = await readOn({ '/': { body: html }, '/fonts/din.ttf': { type: 'font/ttf', body: FONT, delay: 11000 } }, { perRequestMs: 30000 });
  expect(out.ok, out.reason).toBe(true);
  const waited = out.manifest.read.desktop.faces_waited || [];
  expect(waited.some((w) => /FFDINforPuma/.test(w.font) && w.after === 'loaded'), JSON.stringify(waited)).toBe(true);
  expect(out.manifest.fonts.heading).toMatchObject({ family: 'FFDINforPuma', kind: 'webfont' });
});
