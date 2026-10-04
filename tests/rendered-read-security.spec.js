/**
 * An open endpoint that launches a browser: the whole risk, executed.
 * ---------------------------------------------------------------------------
 * "Read my site" is open to a visitor while the database is paused, and it now
 * opens the visitor's URL in a real Chromium. A browser follows redirects, runs
 * the page's own script, opens WebSockets, registers service workers, sends
 * beacons and talks to 169.254.169.254 as happily as to a CDN. render-net.js
 * is the browser's only network; this spec proves it.
 *
 * THE CANARY. A TCP server on 127.0.0.1 counts every connection, whatever
 * protocol. A fixture page on an allowed test origin tries to reach it every
 * way a page can - <img>, <link>, prefetch, <iframe>, fetch, XHR, a PUT to the
 * metadata address, WebSocket, sendBeacon, EventSource, a service worker,
 * WebRTC STUN, a JS navigation, and a 302 from its own origin - and the canary
 * must count ZERO. (Measured while building this: a fulfilled 302 is followed
 * by Chromium WITHOUT calling the route handler again, and the canary counted
 * three connections; redirects are now followed in Node, hop by hop.)
 *
 * Also here: the policy over every private-address spelling, the pinned
 * lookup, the render probe (fixed page, no fetch, cached), the open-path rate
 * limit, the traced function bundle under Vercel's 250 MB limit, and the
 * PRODUCTION binary (@sparticuz/chromium) actually launching on Linux x64.
 *
 * Run: npx playwright test tests/rendered-read-security.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
delete process.env.BRAND_RENDER;

const sites = require('./lib/rendered-sites.js');
const ROOT = path.resolve(__dirname, '..');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);
test.beforeAll(() => { delete process.env.BRAND_RENDER; });

test('a page that tries every route to a private address reaches NONE of them', async () => {
  const can = await sites.canary();
  const srv = await sites.serve(sites.ssrfRoutes(can.port));
  const dns = require('dns').promises;
  const realLookup = dns.lookup;
  // rebind.example answers with a private address: refused at resolution.
  dns.lookup = async (h, o) => (String(h) === 'rebind.example' ? [{ address: '10.0.0.7', family: 4 }] : realLookup(h, o));
  let out;
  try {
    out = await require('../api/_shared/brand-render.js').readSite(srv.origin + '/', {
      policy: { allowOrigins: new Set([srv.origin]) }, deadlineMs: 110000, regression: false,
    });
  } finally {
    dns.lookup = realLookup;
    await srv.close();
  }
  // Give anything that slipped out a moment to land.
  await new Promise((r) => setTimeout(r, 800));
  await can.close();
  expect(can.conns.length).toBe(0);
  expect(out.ok).toBe(true);
  const blocked = out.manifest.network.blocked;
  const says = (rx, reason) => blocked.some((b) => rx.test(b.url) && reason.test(b.reason));
  expect(says(/169\.254\.169\.254/, /private or internal/)).toBe(true);
  expect(says(new RegExp(`127\\.0\\.0\\.1:${can.port}`), /private or internal|standard http/)).toBe(true);
  expect(says(/\[::1\]/, /private or internal|standard http/)).toBe(true);
  expect(says(/rebind\.example/, /resolves to a private/)).toBe(true);
  expect(says(/bounce-private|after-redirect/, /private or internal|standard http/)).toBe(true);
  expect(blocked.some((b) => b.type === 'websocket')).toBe(true);
  expect(blocked.some((b) => /PUT requests are never sent/.test(b.reason))).toBe(true);
  // The fixture server itself saw only GETs for its own pages and robots.
  expect(srv.hits.every((h) => /^\/(robots\.txt|bounce-private|shop|sw\.js|favicon\.ico)?$/.test(h))).toBe(true);
});

test('ONE byte budget across concurrent downloads: ten large chunked responses at once never exceed it, and the read is labelled partial', async () => {
  // Review finding (2026-10-04): the cap was checked per route BEFORE a fetch
  // and charged AFTER a full buffer, so concurrent routes all saw a low counter.
  const http = require('http');
  const CHUNK = 64 * 1024;
  const PER_STREAM = 8 * 1024 * 1024;
  const CAP = 4 * 1024 * 1024;
  const streams = { started: 0, closedEarly: 0 };
  const home = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Big</title></head><body>
    <h1>A page that asks for far too much</h1><p>Ten downloads at once, each larger than the whole budget for the read.</p>
    <a style="display:inline-block;background:#245;color:#fff;padding:10px 20px" href="/x">Go</a>
    <img src="/big/img"><script>for (var i = 0; i < 10; i++) fetch('/big/' + i).then(function (r) { return r.arrayBuffer(); }).catch(function () {});</script></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\nAllow: /\n'); return; }
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(home); return; }
    if (req.url.startsWith('/big/')) {
      streams.started += 1;
      // Chunked, NO Content-Length: nothing to refuse up front.
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      let sent = 0, done = false;
      res.on('close', () => { if (!done) streams.closedEarly += 1; });
      const pump = () => {
        while (sent < PER_STREAM) {
          sent += CHUNK;
          if (!res.write(Buffer.alloc(CHUNK, 7))) { res.once('drain', pump); return; }
        }
        done = true; res.end();
      };
      pump();
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let out;
  try {
    out = await require('../api/_shared/brand-render.js').readSite(origin + '/', {
      policy: { allowOrigins: new Set([origin]) }, deadlineMs: 110000, regression: false, limits: { maxBytesTotal: CAP },
    });
  } finally { await new Promise((r) => server.close(() => r())); }
  expect(out.ok).toBe(true);
  const n = out.manifest.network;
  expect(streams.started).toBeGreaterThanOrEqual(5);
  expect(n.bytes).toBeLessThanOrEqual(CAP);
  expect(n.budget_hit).toBe('bytes');
  expect(out.manifest.partial).toBe(true);
  expect(out.manifest.notes.join(' ')).toMatch(/byte budget for one read \(4 MB\) was spent; \d+ download\(s\) in flight were stopped/);
  expect(streams.closedEarly).toBeGreaterThanOrEqual(3);
});

test('robots.txt is read for EVERY document origin first: a start URL that redirects to another allowed host obeys THAT host\'s rules', async () => {
  // Review finding (2026-10-04): an in-scope origin with no cached rules was allow-all.
  const b = await sites.serve({
    '/robots.txt': { status: 200, type: 'text/plain', body: 'User-agent: *\nDisallow: /\n' },
    '/': { status: 200, type: 'text/html', body: '<!doctype html><title>B</title><h1>Never read</h1>' },
  });
  const a = await sites.serve({
    '/robots.txt': { status: 200, type: 'text/plain', body: 'User-agent: *\nAllow: /\n' },
    '/': { status: 302, type: 'text/plain', body: '', headers: { location: b.origin + '/' } },
  });
  let out;
  try {
    out = await require('../api/_shared/brand-render.js').readSite(a.origin + '/', { policy: { allowOrigins: new Set([a.origin, b.origin]) }, deadlineMs: 60000, regression: false });
  } finally { await a.close(); await b.close(); }
  expect(out).toMatchObject({ ok: false, renderer: 'blocked' });
  expect(out.reason).toContain(`${new URL(b.origin).host} disallows this page in its robots.txt`);
  expect(b.hits).toContain('/robots.txt');
  expect(b.hits).not.toContain('/');
});

test('the dead proxy is the floor: a request that escapes interception reaches nothing', async () => {
  // A context with NO route installed - exactly what "escaping interception"
  // would mean - on the launcher's own browser. Loopback is NOT bypassed, so
  // even 127.0.0.1 goes to the dead proxy.
  const can = await sites.canary();
  try {
    await require('../api/_shared/render-browser.js').withBrowser(async (browser) => {
      const c = await browser.newContext();
      const p = await c.newPage();
      const r = await p.goto(`http://127.0.0.1:${can.port}/direct`, { timeout: 8000 }).then(() => 'loaded', (e) => String(e.message).slice(0, 80));
      expect(r).not.toBe('loaded');
      await p.close();
    });
  } finally {
    await new Promise((r) => setTimeout(r, 300));
    await can.close();
  }
  expect(can.conns.length).toBe(0);
});

test('the policy refuses every private spelling, odd ports, credentials and non-http schemes', async () => {
  const net = require('../api/_shared/render-net.js');
  const refused = [
    'http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/', 'http://127.0.0.1:8080/', 'http://localhost/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://0x7f000001/', 'http://2130706433/', 'http://10.1.2.3/',
    'http://192.168.0.1/', 'http://100.64.0.1/', 'http://metadata.google.internal/', 'http://printer.local/',
    'https://user:pass@example.com/', 'https://example.com:8443/', 'file:///etc/passwd', 'ftp://example.com/',
    'gopher://example.com/', 'data:text/html,hi',
  ];
  for (const u of refused) {
    const v = await net.checkUrl(u, {});
    expect(v.ok, u).toBe(false);
    expect(v.reason, u).toMatch(/private|internal|standard|credentials|scheme|not a valid/);
  }
  // A test origin is matched EXACTLY: the same host on another port is refused.
  const allow = new Set(['http://127.0.0.1:43123']);
  expect((await net.checkUrl('http://127.0.0.1:43123/x', { allowOrigins: allow })).ok).toBe(true);
  expect((await net.checkUrl('http://127.0.0.1:43124/x', { allowOrigins: allow })).ok).toBe(false);
});

test('the transport connects only to an address the policy approved (DNS rebinding has nowhere to go)', async () => {
  const net = require('../api/_shared/render-net.js');
  const can = await sites.canary();
  try {
    // A hostname with NO approved address: the lookup fails the connect.
    const r = await net.transport(`http://rebinder.example:${can.port}/`, { addresses: [] });
    expect(r.error).toContain('no validated address');
    // And redirects are followed HERE, every hop re-checked: a 302 to the
    // canary from an allowed origin stops at the policy.
    const srv = await sites.serve({ '/go': { status: 302, type: 'text/plain', body: '', headers: { location: `http://127.0.0.1:${can.port}/x` } } });
    const ctx = { policy: { allowOrigins: new Set([srv.origin]) }, inScope: () => true, robots: () => [] };
    const f = await net.fetchFollow(srv.origin + '/go', ctx, { kind: 'resource' });
    await srv.close();
    expect(f.ok).toBe(false);
    expect(f.reason).toMatch(/private or internal|standard http/);
    expect(f.hops).toHaveLength(1);
  } finally { await can.close(); }
  expect(can.conns.length).toBe(0);
});

test('a document outside the brand\'s own site, or disallowed by robots.txt, is never navigated to', async () => {
  const net = require('../api/_shared/render-net.js');
  const srv = await sites.serve({ '/robots.txt': { status: 200, type: 'text/plain', body: 'User-agent: *\nDisallow: /private\n' }, '/private/page': { status: 200, type: 'text/html', body: '<p>x</p>' } });
  try {
    const ctx = { policy: { allowOrigins: new Set([srv.origin]) }, inScope: (u) => u.startsWith(srv.origin), robots: () => ['/private'] };
    const f = await net.fetchFollow(srv.origin + '/private/page', ctx, { kind: 'document' });
    expect(f).toMatchObject({ ok: false, reason: 'robots.txt disallows this page' });
    const g = await net.fetchFollow('https://elsewhere.example/', Object.assign({}, ctx, { policy: { allowOrigins: new Set([srv.origin, 'https://elsewhere.example']) } }), { kind: 'document' });
    expect(g.reason).toContain('only read from the brand');
  } finally { await srv.close(); }
  expect(srv.hits).not.toContain('/private/page');
});

test('the render probe renders a FIXED page with no network, and is cached', async () => {
  const handler = require('../api/public-config.js');
  const call = async () => {
    const out = { code: 0, body: null };
    const res = { setHeader() {}, getHeader() {}, removeHeader() {}, status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; }, end() { return res; } };
    await handler({ method: 'GET', url: '/api/public-config?action=brand&op=render-probe', headers: {}, query: { action: 'brand', op: 'render-probe' }, body: {} }, res);
    return out;
  };
  const first = await call();
  expect(first.code).toBe(200);
  expect(first.body).toMatchObject({ ok: true, renderer: 'chromium', network_requests: 0, cached: false });
  expect(first.body.chromium).toMatch(/^\d+\./);
  expect(first.body.screenshot_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(first.body.computed_probe).toBe('rgb(31, 95, 74)');
  const second = await call();
  expect(second.body.cached).toBe(true);
  expect(second.body.screenshot_sha256).toBe(first.body.screenshot_sha256);
});

test('the open path rate-limits the browser read per address and says so in a sentence; the parser still answers', async () => {
  const br = require('../api/_shared/brand-render.js');
  br.resetRateLimits();
  const bx = require('../api/_shared/brand-extract.js');
  const realRun = bx.runExtract;
  const dns = require('dns').promises;
  const realLookup = dns.lookup;
  dns.lookup = async (h, o) => (String(h).endsWith('.example') ? [{ address: '93.184.216.34', family: 4 }] : realLookup(h, o));
  bx.runExtract = async () => ({ ok: true, start: 'https://shop.example/', pages: ['https://shop.example/'], pages_visited: 1, stylesheets: [], limits: [], notes: [], markers: [], fields: { palette: { proposed: {} } } });
  let renders = 0;
  const fakeRead = async () => { renders += 1; return { ok: false, renderer: 'timeout', reason: 'stand-in' }; };
  const req = { headers: { 'x-forwarded-for': '203.0.113.9' } };
  try {
    for (let i = 0; i < br.RATE.perIp; i++) {
      const o = await br.extractWithRender({ ok: false }, { url: 'https://shop.example/' }, { open: true, req, readSite: fakeRead });
      expect(o.read.renderer).toBe('timeout');
    }
    const refused = await br.extractWithRender({ ok: false }, { url: 'https://shop.example/' }, { open: true, req, readSite: fakeRead });
    expect(renders).toBe(br.RATE.perIp);
    expect(refused.read).toMatchObject({ method: 'parsed', renderer: 'unavailable' });
    expect(refused.read.reason).toMatch(/asked for \d+ rendered reads in the last 10 minutes/);
    expect(refused.ok).toBe(true);
    // Another address is not this one's limit.
    const other = await br.extractWithRender({ ok: false }, { url: 'https://shop.example/' }, { open: true, req: { headers: { 'x-forwarded-for': '198.51.100.4' } }, readSite: fakeRead });
    expect(other.read.renderer).toBe('timeout');
    // A signed-in read is not on the open path's limit.
    const signedIn = await br.extractWithRender({ ok: true }, { url: 'https://shop.example/' }, { open: false, req, readSite: fakeRead });
    expect(signedIn.read.renderer).toBe('timeout');
  } finally {
    bx.runExtract = realRun; dns.lookup = realLookup; br.resetRateLimits();
  }
});

test('the browser read reaches no language model, on any path', async () => {
  const LLM = require.resolve('../api/_shared/llm.js');
  const saved = require.cache[LLM];
  let calls = 0;
  const stub = async () => { calls += 1; return { text: '{}', provider: 'x' }; };
  stub.parseJSON = (t) => JSON.parse(t);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
  const srv = await sites.serve(sites.siteRoutes('b'));
  try {
    const out = await require('../api/_shared/brand-render.js').readSite(srv.origin + '/', { policy: { allowOrigins: new Set([srv.origin]) }, deadlineMs: 110000 });
    expect(out.ok).toBe(true);
  } finally {
    await srv.close();
    if (saved) require.cache[LLM] = saved; else delete require.cache[LLM];
  }
  expect(calls).toBe(0);
});

test('the function that serves Read my site stays under Vercel\'s 250 MB limit, with the browser in it', async () => {
  test.setTimeout(240000);
  const { nodeFileTrace } = require('@vercel/nft');
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const fn = vercel.functions['api/public-config.js'];
  const { fileList } = await nodeFileTrace([path.join(ROOT, 'api/public-config.js')], { base: ROOT, processCwd: ROOT });
  const files = new Set(fileList);
  // includeFiles, as Vercel applies it.
  const { minimatch } = require('minimatch');
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  expect(fn.includeFiles).toBe('node_modules/@sparticuz/chromium/bin/**');
  for (const f of walk('node_modules/@sparticuz/chromium/bin')) if (minimatch(f, fn.includeFiles)) files.add(f);
  let bytes = 0;
  for (const f of files) { try { const st = fs.statSync(path.join(ROOT, f)); if (st.isFile()) bytes += st.size; } catch (_) { /* a traced symlink target */ } }
  const mb = bytes / 1048576;
  console.log(`api/public-config.js traced bundle: ${mb.toFixed(1)} MB in ${files.size} files`);
  expect([...files].some((f) => /@sparticuz\/chromium\/bin\/chromium\.br$/.test(f))).toBe(true);
  expect([...files].some((f) => /playwright-core\/lib\//.test(f))).toBe(true);
  // 250 MB is Vercel's hard limit (unzipped, per function); 220 keeps headroom.
  expect(mb).toBeLessThan(220);
});

test('the PRODUCTION binary (@sparticuz/chromium) launches and renders on Linux x64', async () => {
  test.skip(process.platform !== 'linux' || process.arch !== 'x64', 'the serverless binary is built for Linux x64');
  test.setTimeout(240000);
  const out = await require('../api/_shared/brand-render.js').renderProbe({ prefer: 'sparticuz', fresh: true });
  console.log(`@sparticuz/chromium: ${JSON.stringify({ chromium: out.chromium, unpack_ms: out.unpack_ms, launch_ms: out.launch_ms, render_ms: out.render_ms, single_process: out.single_process })}`);
  expect(out).toMatchObject({ ok: true, binary: 'sparticuz', single_process: true, network_requests: 0 });
  expect(out.chromium).toMatch(/^153\./);
  expect(out.computed_probe).toBe('rgb(31, 95, 74)');
});
