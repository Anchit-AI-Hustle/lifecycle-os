'use strict';
/**
 * readers/lib/handler.js - a reader in one country (2026-10-12).
 * ---------------------------------------------------------------------------
 * Some brands' regional stores send a server outside that country to another
 * country's store (the live Lenskart India / UAE / Saudi Arabia / Thailand
 * shape: an Indian product page answers a US server with a redirect to
 * /en-us/). The operator chose READERS IN EACH COUNTRY: a small server that
 * actually runs in that country fetches the pages of that market's store for
 * the catalogue importer. The request really comes from there; nothing about
 * it pretends anything:
 *   - the user agent is the importer's own (USER_AGENT below, asserted equal
 *     to api/_shared/catalog-import.js USER_AGENT by the spec);
 *   - no cookie, no Accept-Language, no X-Forwarded-For, no Accept-Encoding,
 *     no proxy: the only request headers are Host, User-Agent and Accept;
 *   - GET only; robots.txt and pacing stay the importer's job (it decides what
 *     to ask for and when; the reader fetches exactly one URL per call).
 *
 * PROTOCOL
 *   POST /api/read  (or /read)   JSON { url, accept, ts }
 *     header X-Reader-Signature: hex(HMAC-SHA256(READER_SECRET, ts + "\n" + url))
 *     ts = milliseconds since the epoch; refused when more than 120 s away
 *   401  READER_SECRET unset or under 32 characters, a missing / wrong
 *        signature (compared in constant time), or a stale ts
 *   400  a URL that is not http(s), not on 80/443, or on a private, loopback,
 *        link-local (cloud metadata) or internal address - checked on EVERY
 *        redirect hop, with the socket pinned to the checked address
 *   200  { ok, status, final_url, hops:[{url,status}], content_type,
 *          retry_after, body_base64, truncated, reader:{country, region} }
 *        ok:false with error upstream_unreachable / upstream_timeout /
 *        too_many_redirects when the store itself did not answer usefully.
 *   GET /api/health (or /health)  { ok:true, country, region } - fetches nothing.
 *
 * Redirects are followed by hand, at most 5, each hop re-checked; the body is
 * streamed and cut at READER_MAX_BYTES (8 MB; 3 MB when running on Vercel,
 * whose function responses are capped at 4.5 MB and base64 adds a third);
 * one call has 25 s.
 *
 * createReader({ env, hooks }) builds a handler. `hooks` exists for the spec
 * only (a resolver and a dialler so fixture stores on 127.0.0.1 can stand in
 * for public hosts); it is a CODE argument - nothing in a request can set it,
 * and the exported `handler` is built without it.
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const ssrf = require('./ssrf.js');

const USER_AGENT = 'LifecycleOS-BrandCrawler/1.0 (+brand catalogue discovery; respects robots.txt)';
const LIMITS = {
  maxRedirects: 5,
  deadlineMs: 25000,
  maxBytes: 8 * 1024 * 1024,
  maxBytesOnVercel: 3 * 1024 * 1024,
  skewMs: 120000,
  minSecret: 32,
  maxRequestBytes: 16384,
  maxUrl: 4096,
};

function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(raw);
}

function readerInfo(env) {
  const c = String(env.READER_COUNTRY || '').trim().toUpperCase();
  return { country: /^[A-Z]{2}$/.test(c) ? c : null, region: String(env.VERCEL_REGION || env.READER_REGION || '').trim() || null };
}

async function readBody(req) {
  if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > LIMITS.maxRequestBytes) { const e = new Error('request too large'); e.status = 413; throw e; }
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** hex(HMAC-SHA256(secret, ts + "\n" + url)) - the importer signs with the same function. */
function sign(secret, ts, url) {
  return crypto.createHmac('sha256', String(secret)).update(`${ts}\n${url}`).digest('hex');
}
function signatureMatches(secret, ts, url, given) {
  const want = Buffer.from(sign(secret, ts, url), 'hex');
  const got = /^[0-9a-f]{64}$/i.test(String(given || '')) ? Buffer.from(String(given), 'hex') : Buffer.alloc(want.length);
  // Constant time whatever was sent: a malformed signature is compared against
  // zeros of the right length, and then refused.
  const same = crypto.timingSafeEqual(want, got);
  return same && /^[0-9a-f]{64}$/i.test(String(given || ''));
}

/** One GET of one checked URL, the socket pinned to the checked address. */
function getOnce(u, addr, { accept, signal, dial }) {
  return new Promise((resolve, reject) => {
    const to = dial ? dial(u) : null;
    const secure = (to ? to.protocol : u.protocol) === 'https:';
    const lib = secure ? https : http;
    const opts = {
      method: 'GET',
      protocol: secure ? 'https:' : 'http:',
      hostname: to ? to.hostname : u.hostname.replace(/^\[|\]$/g, ''),
      port: to ? to.port : (u.port || (secure ? 443 : 80)),
      path: `${u.pathname || '/'}${u.search || ''}`,
      headers: { Host: u.host, 'User-Agent': USER_AGENT, Accept: accept },
      agent: false,
      signal,
    };
    if (!to) {
      opts.lookup = (_h, o, cb) => {
        if (o && o.all) cb(null, [{ address: addr.address, family: addr.family }]);
        else cb(null, addr.address, addr.family);
      };
      if (secure && !ssrf.v6Groups(u.hostname) && !/^(\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)) opts.servername = u.hostname;
    }
    const req = lib.request(opts, (res) => resolve(res));
    req.on('error', reject);
    req.end();
  });
}

async function readBodyCapped(res, max) {
  const chunks = [];
  let n = 0, truncated = false;
  for await (const c of res) {
    if (n + c.length > max) {
      chunks.push(c.subarray(0, max - n));
      n = max;
      truncated = true;
      res.destroy();
      break;
    }
    chunks.push(c);
    n += c.length;
  }
  return { buf: Buffer.concat(chunks), truncated };
}

function createReader({ env, hooks } = {}) {
  const H = hooks || {};
  const E = () => env || process.env;
  const resolveHost = H.resolve || null;
  const dial = H.dial || null;
  const now = H.now || Date.now;

  async function read(req, res) {
    const ENV = E();
    const info = readerInfo(ENV);
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, error: 'method_not_allowed', message: 'A read is a POST.' }); }
    const secret = String(ENV.READER_SECRET || '');
    if (secret.length < LIMITS.minSecret) return send(res, 401, { ok: false, error: 'reader_unconfigured', message: 'This reader has no READER_SECRET of at least 32 characters, so it reads nothing.' });
    let body;
    try { body = await readBody(req); } catch (e) { return send(res, e.status === 413 ? 413 : 400, { ok: false, error: 'bad_request', message: 'The request body is not JSON.' }); }
    const url = typeof body.url === 'string' ? body.url : '';
    const ts = Number(body.ts);
    const given = req.headers['x-reader-signature'];
    if (!url || url.length > LIMITS.maxUrl || !Number.isFinite(ts) || !signatureMatches(secret, String(body.ts), url, given)) {
      return send(res, 401, { ok: false, error: 'bad_signature', message: 'The request is not signed with this reader\'s secret.' });
    }
    if (Math.abs(now() - ts) > LIMITS.skewMs) return send(res, 401, { ok: false, error: 'stale_request', message: 'The request was signed more than 120 seconds from now.' });
    const accept = typeof body.accept === 'string' && body.accept.length <= 200 && /^[\x20-\x7e]*$/.test(body.accept) && body.accept ? body.accept : '*/*';
    const max = Math.max(1, Number(ENV.READER_MAX_BYTES) || (ENV.VERCEL ? LIMITS.maxBytesOnVercel : LIMITS.maxBytes));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LIMITS.deadlineMs);
    const hops = [];
    let at = url;
    try {
      for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
        let checked;
        try { checked = await ssrf.check(at, resolveHost); } catch (e) {
          return send(res, 400, { ok: false, error: e.code || 'address_refused', message: e.message, at, hops, reader: info });
        }
        let r;
        try { r = await getOnce(checked.url, checked.addresses[0], { accept, signal: ctrl.signal, dial }); } catch (e) {
          return send(res, 200, { ok: false, error: ctrl.signal.aborted ? 'upstream_timeout' : 'upstream_unreachable', status: 0, final_url: at, hops, reader: info });
        }
        hops.push({ url: at, status: r.statusCode });
        const loc = r.headers.location;
        if (r.statusCode >= 300 && r.statusCode < 400 && loc) {
          r.destroy();
          let next;
          try { next = new URL(String(loc), at).toString(); } catch (_) { return send(res, 200, { ok: false, error: 'bad_redirect', status: r.statusCode, final_url: at, hops, reader: info }); }
          at = next;
          continue;
        }
        let got;
        try { got = await readBodyCapped(r, max); } catch (e) {
          return send(res, 200, { ok: false, error: ctrl.signal.aborted ? 'upstream_timeout' : 'upstream_unreachable', status: r.statusCode, final_url: at, hops, reader: info });
        }
        return send(res, 200, {
          ok: true, status: r.statusCode, final_url: at, hops,
          content_type: String(r.headers['content-type'] || ''),
          retry_after: r.headers['retry-after'] != null ? String(r.headers['retry-after']) : null,
          body_base64: got.buf.toString('base64'), truncated: got.truncated, bytes: got.buf.length, max_bytes: max,
          reader: info,
        });
      }
      return send(res, 200, { ok: false, error: 'too_many_redirects', status: 0, final_url: at, hops, reader: info });
    } finally { clearTimeout(timer); }
  }

  function health(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'method_not_allowed' }); }
    const info = readerInfo(E());
    return send(res, 200, { ok: true, country: info.country, region: info.region });
  }

  return async function handler(req, res) {
    let path = '/';
    try { path = new URL(req.url || '/', 'http://reader.invalid').pathname.replace(/\/+$/, '') || '/'; } catch (_) { path = '/'; }
    try {
      if (path === '/api/read' || path === '/read') return await read(req, res);
      if (path === '/api/health' || path === '/health') return health(req, res);
      return send(res, 404, { ok: false, error: 'not_found' });
    } catch (e) {
      if (!res.headersSent) return send(res, 500, { ok: false, error: 'reader_failed', message: 'The reader failed on this request.' });
    }
  };
}

const handler = createReader();
module.exports = { createReader, handler, sign, USER_AGENT, LIMITS };
