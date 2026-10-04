'use strict';
/**
 * render-net.js — the ONLY door between the headless browser and the network.
 * ---------------------------------------------------------------------------
 * "Read my site" now RENDERS the operator's site in a real browser
 * (brand-render.js). An endpoint that is open to a visitor while the database
 * is paused, and that launches a browser at an address the visitor typed, is
 * the whole risk of that feature: a browser follows redirects, runs the page's
 * own JavaScript, opens WebSockets, registers service workers, sends beacons,
 * prefetches, and talks to the cloud metadata address as happily as to a CDN.
 *
 * So the browser is given NO network of its own. Every request it makes is
 * paused by route interception and answered from HERE, by Node, after the same
 * checks the crawler applies (assertPublicUrl's rules: http(s) only, standard
 * ports only, no private / loopback / link-local / CGNAT / metadata / *.internal
 * host, and a hostname whose DNS answers include ANY internal address is
 * refused). The socket then connects to the address that was checked - the
 * lookup is PINNED - so a name that re-resolves to 127.0.0.1 between the check
 * and the connect (DNS rebinding) connects to nothing.
 *
 * ── FOUND BY RUNNING IT, NOT BY READING IT (2026-10-04) ────────────────────
 * The obvious implementation answers a redirect by fulfilling the 3xx to the
 * browser and letting it follow. Measured against a canary server on
 * 127.0.0.1: Chromium FOLLOWS A FULFILLED REDIRECT WITHOUT CALLING THE ROUTE
 * HANDLER AGAIN. The canary counted three connections from a page that only
 * ever asked for /bounce on a public host, and the browser also opened its own
 * background connections (www.google.com). Interception alone is therefore not
 * a boundary. Two things close it:
 *   1. Redirects are followed HERE, hop by hop, each hop re-checked (and, for a
 *      document, re-scoped to the brand's own site and to robots.txt). The
 *      browser only ever receives a final 2xx/4xx/5xx body - never a 3xx.
 *   2. The browser is launched with a proxy that does not exist
 *      (render-browser.js). Anything that escapes interception - a redirect
 *      hop, a background update check, a WebRTC candidate - goes to a closed
 *      port and fails. Interception decides; the dead proxy is the floor.
 * With both, the same page produced ZERO canary connections.
 *
 * ── WHAT IS NEVER FETCHED ──────────────────────────────────────────────────
 * Anything but GET/HEAD (no form posts, no analytics, no beacons), WebSockets,
 * EventSource streams, media (video/audio bodies), text tracks, and documents
 * (frames or navigations) outside the brand's own hosts or disallowed by its
 * robots.txt. Credentials in a URL are refused. Cookies are neither sent nor
 * kept: every read is a fresh browser (render-browser.js) and Set-Cookie is
 * dropped here.
 *
 * ── BUDGETS ────────────────────────────────────────────────────────────────
 * Per read: a request count, total bytes, bytes per response (checked against
 * Content-Length before reading AND counted while reading, decompressed size
 * included, so a gzip bomb stops at the cap), a per-request timeout, and a
 * redirect-hop limit. A budget that runs out is REPORTED, never silent.
 *
 * NOT a function file (api/_shared/ is outside the Hobby 12-function cap).
 */

const http = require('http');
const https = require('https');
const net = require('net');
const zlib = require('zlib');

const LIMITS = {
  maxRequests: 450,
  maxBytesTotal: 48 * 1024 * 1024,
  maxBytesPerResponse: 12 * 1024 * 1024,
  perRequestMs: 9000,
  maxRedirects: 5,
  keepCssChars: 1500000,      // stylesheet bodies kept for @font-face / custom-property names
  maxBlockedLogged: 80,
};

/** Resource types the reader never fetches, with the reason it says. */
const NEVER = {
  websocket: 'WebSockets are never opened by the reader.',
  eventsource: 'Event streams are never opened by the reader.',
  media: 'Video and audio bodies are not needed to read a design and are not fetched.',
  texttrack: 'Text tracks are not needed to read a design.',
  ping: 'Beacons and pings are never sent.',
  cspreport: 'Reports are never sent.',
};

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 '
  + 'LifecycleOS-BrandRenderer/1.0 (+brand design read; respects robots.txt)';

function core() { return require('./brand-workspace-core.js'); }

function refuse(reason) { return { ok: false, reason }; }

/**
 * The policy for ONE url. Never throws. Mirrors assertPublicUrl() rule for
 * rule (it is that function's checks, applied per request instead of per
 * import) and additionally returns the addresses that passed, so the socket
 * can be pinned to them.
 *
 * `policy.allowOrigins` is an IN-PROCESS test seam: a Set of exact origins
 * (e.g. 'http://127.0.0.1:43123') a test server listens on. No request field
 * reaches it - the HTTP handler builds its policy from constants only - and it
 * matches an exact origin, never a range, so an attack page on that same test
 * server still cannot reach any OTHER port on 127.0.0.1.
 */
async function checkUrl(raw, policy) {
  const p = policy || {};
  let u;
  try { u = new URL(raw); } catch (_) { return refuse('not a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return refuse(`the ${u.protocol.replace(':', '')} scheme is never fetched`);
  if (p.allowOrigins && p.allowOrigins.has(u.origin)) return { ok: true, addresses: null, test_allowance: true };
  if (u.username || u.password) return refuse('a URL carrying credentials is never fetched');
  if (u.port && u.port !== '80' && u.port !== '443') return refuse('only the standard http and https ports are fetched');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const k = core();
  if (k.BLOCKED_HOST_RX.test(host) || k.isPrivateIp(host)) return refuse('that address is on a private or internal network');
  const fam = net.isIP(host);
  if (fam) return { ok: true, addresses: [{ address: host, family: fam }] };
  const cache = p.dnsCache || null;
  let answers = cache && cache.get(host);
  if (!answers) {
    try {
      answers = await require('dns').promises.lookup(host, { all: true, verbatim: true });
    } catch (_) {
      return refuse(`${host} did not resolve`);
    }
    if (cache) cache.set(host, answers);
  }
  if (!Array.isArray(answers) || !answers.length) return refuse(`${host} did not resolve`);
  for (const a of answers) {
    if (k.isPrivateIp(a.address)) return refuse(`${host} resolves to a private or internal address`);
  }
  return { ok: true, addresses: answers.map((a) => ({ address: a.address, family: a.family || net.isIP(a.address) })) };
}

/**
 * A lookup that answers ONLY with addresses checkUrl() already approved. Node
 * calls it for a hostname; an IP literal never reaches it (and was approved as
 * a literal). With no approved address it fails the connect.
 */
function pinnedLookup(addresses) {
  // IPv4 FIRST, then IPv6: a runner with no IPv6 route (GitHub's) must not
  // spend the connect on addresses it cannot reach while an approved IPv4 one
  // exists. Both families are still offered when Node asks for all of them,
  // so Happy Eyeballs can fall back either way. Nothing here widens what
  // checkUrl() approved: these are exactly its addresses, reordered.
  const ordered = Array.isArray(addresses)
    ? addresses.filter((a) => a && a.family === 4).concat(addresses.filter((a) => a && a.family !== 4))
    : [];
  return function lookup(hostname, opts, cb) {
    const done = typeof opts === 'function' ? opts : cb;
    const o = typeof opts === 'object' && opts ? opts : {};
    // ALWAYS asynchronous. Answering synchronously let a connect that failed
    // at once (every address unreachable) emit its error on the socket before
    // http had attached a listener: an UNHANDLED 'error' that killed the whole
    // read process (found by the harvest on a runner with no IPv6 route).
    setImmediate(() => {
      if (!ordered.length) return done(new Error(`no validated address for ${hostname}`));
      if (o.all) return done(null, ordered.map((a) => ({ address: a.address, family: a.family })));
      return done(null, ordered[0].address, ordered[0].family);
    });
  };
}

/**
 * ONE byte budget for a whole read, charged CHUNK BY CHUNK as bytes arrive.
 *
 * Found in review (2026-10-04): the cap used to be checked per route BEFORE a
 * fetch and charged only AFTER a response had been buffered whole, and route
 * handlers run concurrently - so a hostile page firing ten large responses at
 * once started ten 12 MB downloads while the counter still read zero. Now
 * every chunk is TAKEN from the shared budget before it is kept (JavaScript
 * runs one callback at a time, so the take is atomic), a chunk that would
 * cross the cap is refused, and every download still in flight is aborted at
 * that moment. Total bytes kept can never exceed the cap.
 */
function makeBudget(maxBytes, maxRequests) {
  const live = new Set();
  const b = {
    max: maxBytes, used: 0, exhausted: false, aborted: 0,
    // REQUESTS are charged per TRANSPORT HOP, not per browser request
    // (review, 2026-10-04): one route follows up to 1 + maxRedirects hops, and
    // robots.txt, the start document and the web app manifest are fetched
    // outside any route. Every one of those is a connection, so every one is
    // taken from the same count, atomically, before it is opened.
    requests: 0, maxRequests: maxRequests || LIMITS.maxRequests, requestsSpent: false,
    takeRequest() {
      if (b.requests >= b.maxRequests) { b.requestsSpent = true; return false; }
      b.requests += 1;
      return true;
    },
    take(n) {
      if (b.exhausted) return false;
      if (b.used + n > b.max) {
        b.exhausted = true;
        for (const kill of [...live]) { b.aborted += 1; try { kill(); } catch (_) { /* gone */ } }
        live.clear();
        return false;
      }
      b.used += n;
      return true;
    },
    remaining() { return Math.max(0, b.max - b.used); },
    register(kill) { live.add(kill); return () => live.delete(kill); },
  };
  return b;
}

function decoder(encoding) {
  const e = String(encoding || '').toLowerCase().trim();
  if (e === 'gzip' || e === 'x-gzip') return zlib.createGunzip();
  if (e === 'br') return zlib.createBrotliDecompress();
  if (e === 'deflate') return zlib.createInflate();
  return null;
}

/**
 * One request, no redirects followed, the socket pinned. Resolves
 * { status, headers, body:Buffer, truncated } or { error }.
 */
function transport(url, { addresses, method = 'GET', timeoutMs = LIMITS.perRequestMs, maxBytes = LIMITS.maxBytesPerResponse, headers = {}, budget = null } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (_) { resolve({ error: 'not a valid URL' }); return; }
    if (budget && budget.exhausted) { resolve({ error: 'the byte budget for this read is spent', budget: true }); return; }
    const lib = u.protocol === 'https:' ? https : http;
    let settled = false;
    let unregister = () => {};
    const finish = (v) => { if (!settled) { settled = true; unregister(); resolve(v); } };
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname.replace(/^\[|\]$/g, ''),
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: (u.pathname || '/') + (u.search || ''),
      method,
      headers: Object.assign({
        'user-agent': USER_AGENT,
        accept: '*/*',
        'accept-language': 'en',
        'accept-encoding': 'gzip, deflate, br',
      }, headers),
      lookup: pinnedLookup(addresses),
      servername: net.isIP(u.hostname.replace(/^\[|\]$/g, '')) ? undefined : u.hostname,
      agent: false,
      timeout: timeoutMs,
    }, (res) => {
      const declared = Number(res.headers['content-length'] || 0);
      if (declared && declared > maxBytes) {
        res.destroy();
        finish({ error: `the response is ${declared} bytes, over the ${maxBytes}-byte cap` });
        return;
      }
      if (declared && budget && declared > budget.remaining()) {
        res.destroy();
        budget.take(declared);   // marks the read's budget spent and aborts the rest
        finish({ error: 'the byte budget for this read is spent', budget: true });
        return;
      }
      const chunks = [];
      let size = 0;
      let truncated = false;
      const dec = decoder(res.headers['content-encoding']);
      const src = dec ? res.pipe(dec) : res;
      const kill = () => { res.destroy(); if (dec) dec.destroy(); finish({ error: 'the byte budget for this read is spent', budget: true }); };
      if (budget) unregister = budget.register(kill);
      src.on('data', (c) => {
        if (settled) return;
        size += c.length;
        if (size > maxBytes) { truncated = true; res.destroy(); if (dec) dec.destroy(); finish({ error: `the response exceeded the ${maxBytes}-byte cap` }); return; }
        if (budget && !budget.take(c.length)) { kill(); return; }
        chunks.push(c);
      });
      src.on('end', () => finish({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks), truncated }));
      src.on('error', (e) => finish({ error: (e && e.message) || 'the response could not be read' }));
    });
    req.on('timeout', () => { req.destroy(new Error('timed out')); });
    req.on('error', (e) => finish({ error: networkError(e) }));
    // Belt and braces: whatever the socket emits, this request fails, the
    // read goes on (a socket with no 'error' listener takes the process down).
    req.on('socket', (sock) => { sock.on('error', (e) => finish({ error: networkError(e) })); });
    req.end();
  });
}

/** A network failure as a sentence (an AggregateError carries no message of its own). */
function networkError(e) {
  if (!e) return 'request failed';
  if (e.errors && e.errors.length) {
    const codes = [...new Set(e.errors.map((x) => x && (x.code || x.message)).filter(Boolean))];
    return `could not connect to any approved address (${codes.join(', ') || e.code || 'unreachable'})`;
  }
  if (e.syscall === 'connect' || /^(ENETUNREACH|EHOSTUNREACH|EAFNOSUPPORT|EADDRNOTAVAIL|ECONNREFUSED)$/.test(String(e.code || ''))) {
    return `could not connect to any approved address (${e.code || 'unreachable'})`;
  }
  return e.message || e.code || 'request failed';
}

/** Headers handed back to the browser. Cookies and transfer framing are not. */
const PASS_HEADERS = new Set(['content-type', 'content-language', 'cache-control', 'last-modified', 'etag',
  'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-expose-headers',
  'timing-allow-origin', 'content-security-policy', 'vary']);
function browserHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    if (!PASS_HEADERS.has(String(k).toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

/** robots.txt prefix rules (site-crawl's semantics): true when allowed. */
function robotsAllows(disallow, url) {
  let p = '/';
  try { const u = new URL(url); p = u.pathname + (u.search || ''); } catch (_) { return false; }
  return !(disallow || []).some((d) => d && p.startsWith(d));
}

/**
 * Fetch with redirects followed HERE, every hop re-checked. A document hop is
 * also re-scoped (brand's own hosts) and re-checked against robots.txt.
 * Returns { ok, finalUrl, status, headers, body, hops } or { ok:false, reason }.
 */
async function fetchFollow(url, ctx, { kind = 'resource', method = 'GET' } = {}) {
  const hops = [];
  let cur = url;
  for (let i = 0; i <= LIMITS.maxRedirects; i++) {
    const verdict = await checkUrl(cur, ctx.policy);
    if (!verdict.ok) return { ok: false, reason: verdict.reason, url: cur, hops };
    if (kind === 'document') {
      if (!ctx.inScope(cur)) return { ok: false, reason: 'documents are only read from the brand\'s own site', url: cur, hops };
      // The origin's rules are READ before its first document; an origin with no
      // way to read them supplies its own fetcher (robotsFor) or none at all.
      const rules = ctx.robotsFor ? await ctx.robotsFor(cur) : (ctx.robots ? ctx.robots(cur) : null);
      if (!Array.isArray(rules)) return { ok: false, reason: 'robots.txt for this origin was not read', url: cur, hops };
      if (!robotsAllows(rules, cur)) return { ok: false, reason: 'robots.txt disallows this page', url: cur, hops };
    }
    // Every hop is a connection: it is charged before it is opened.
    if (ctx.budget && !ctx.budget.takeRequest()) return { ok: false, reason: 'the request budget for this read is spent', url: cur, hops, requestBudget: true };
    const r = await (ctx.transport || module.exports.transport)(cur, {
      addresses: verdict.addresses, method,
      timeoutMs: Math.max(1000, Math.min(ctx.perRequestMs || LIMITS.perRequestMs, ctx.deadline ? ctx.deadline - Date.now() - 1000 : Infinity)),
      maxBytes: (ctx.limits && ctx.limits.maxBytesPerResponse) || LIMITS.maxBytesPerResponse,
      budget: ctx.budget || null,
    });
    if (r.error) return { ok: false, reason: r.error, url: cur, hops, budget: !!r.budget };
    if (r.status >= 300 && r.status < 400 && r.headers && r.headers.location) {
      let next;
      try { next = new URL(String(r.headers.location), cur).toString(); } catch (_) { return { ok: false, reason: 'a redirect pointed nowhere valid', url: cur, hops }; }
      hops.push({ from: cur, to: next, status: r.status });
      cur = next;
      continue;
    }
    return { ok: true, finalUrl: cur, status: r.status, headers: r.headers || {}, body: r.body || Buffer.alloc(0), hops };
  }
  return { ok: false, reason: `more than ${LIMITS.maxRedirects} redirects`, url: cur, hops };
}

/**
 * Wire one browser context to this module. Every request the context makes
 * is answered by `fetchFollow` or refused; WebSockets are closed unopened.
 * Returns the read's network ledger (requests, bytes, blocked, fonts, css).
 */
async function attach(context, ctx) {
  const ledger = ctx.ledger || {
    requests: 0, bytes: 0, blocked: [], blocked_count: 0, fonts: [], css: new Map(), documents: [], budget_hit: '',
    prefetched: new Map(),
  };
  ctx.ledger = ledger;
  if (!ctx.budget) ctx.budget = makeBudget((ctx.limits && ctx.limits.maxBytesTotal) || LIMITS.maxBytesTotal, ctx.limits && ctx.limits.maxRequests);
  const budget = ctx.budget;
  const block = (route, url, type, reason) => {
    ledger.blocked_count += 1;
    if (ledger.blocked.length < LIMITS.maxBlockedLogged) ledger.blocked.push({ url: String(url).slice(0, 300), type, reason });
    return route.abort('blockedbyclient').catch(() => {});
  };

  await context.routeWebSocket(/.*/, (ws) => {
    ledger.blocked_count += 1;
    if (ledger.blocked.length < LIMITS.maxBlockedLogged) ledger.blocked.push({ url: String(ws.url()).slice(0, 300), type: 'websocket', reason: NEVER.websocket });
    try { ws.close(); } catch (_) { /* already gone */ }
  });

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (/^(data|blob|about):/i.test(url)) return route.continue().catch(() => {});
    // Our OWN rendered assets (the regression loop's landing page, mailer and
    // ad) are served from memory under a reserved .invalid host; nothing
    // network-shaped happens for them.
    const local = ctx.local && ctx.local.get(url);
    if (local) return route.fulfill({ status: local.status || 200, headers: local.headers || {}, body: local.body }).catch(() => {});
    const type = req.resourceType();
    const method = req.method();
    if (ctx.closed) return block(route, url, type, 'the read has finished');
    if (method !== 'GET' && method !== 'HEAD') return block(route, url, type, `${method} requests are never sent: the reader only reads.`);
    if (NEVER[type]) return block(route, url, type, NEVER[type]);
    if (budget.requestsSpent || budget.requests >= budget.maxRequests) { ledger.budget_hit = ledger.budget_hit || 'request count'; return block(route, url, type, 'the request budget for this read is spent'); }
    if (budget.exhausted) { ledger.budget_hit = ledger.budget_hit || 'bytes'; return block(route, url, type, 'the byte budget for this read is spent'); }
    const kind = type === 'document' ? 'document' : 'resource';
    let out = ledger.prefetched.get(url);
    if (out) ledger.prefetched.delete(url);
    else out = await fetchFollow(url, ctx, { kind, method });
    ledger.bytes = budget.used;
    ledger.requests = budget.requests;
    if (!out.ok) {
      if (out.budget) ledger.budget_hit = ledger.budget_hit || 'bytes';
      if (out.requestBudget) ledger.budget_hit = ledger.budget_hit || 'request count';
      return block(route, out.url || url, type, out.reason);
    }
    if (type === 'document') ledger.documents.push({ url, final: out.finalUrl, status: out.status });
    if (type === 'stylesheet' && ledger.css.size < 40) ledger.css.set(out.finalUrl, out.body.toString('utf8').slice(0, LIMITS.keepCssChars));
    if (type === 'font') ledger.fonts.push({ url, final: out.finalUrl, status: out.status, bytes: out.body.length, type: String((out.headers || {})['content-type'] || '') });
    return route.fulfill({ status: out.status || 200, headers: browserHeaders(out.headers), body: out.body }).catch(() => {});
  });
  return ledger;
}

module.exports = {
  LIMITS, NEVER, USER_AGENT,
  checkUrl, pinnedLookup, transport, fetchFollow, attach, robotsAllows, browserHeaders, makeBudget,
};
