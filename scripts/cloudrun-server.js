#!/usr/bin/env node
'use strict';
/**
 * cloudrun-server.js - the app as ONE Node process, for Google Cloud Run.
 * ---------------------------------------------------------------------------
 * Production is Vercel. A Cloud Build trigger (Cloud Run "continuous
 * deployment from a repository", asia-south2) also builds every push to main
 * as a container, and it failed in under a second on every commit because the
 * repo had no Dockerfile (2026-10-24). This is what that container runs.
 *
 * It reads the SAME configuration the Vercel deployment does, so the two
 * cannot describe different apps:
 *   - vercel.json `redirects`, `rewrites` and `headers` (path-to-regexp style
 *     sources: `:name`, `:name*`, and regex groups such as `/(.*)\.html`);
 *   - `/api/<path>` runs the handler file `api/<path>.js` with the request
 *     helpers @vercel/node gives every function (req.query, a lazy req.body
 *     parsed from JSON or text, res.status/json/send/redirect);
 *   - everything else is a static file from the repo root, except what
 *     .vercelignore keeps out of a deployment, dotfiles, and api/ sources.
 * It listens on $PORT (Cloud Run sets it; 8080 otherwise).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
};

/** A vercel.json source as a RegExp with named groups for its `:params`. */
function sourceRegex(source) {
  let rx = '';
  for (let i = 0; i < source.length;) {
    const m = /^:([A-Za-z_][A-Za-z0-9_]*)(\*)?/.exec(source.slice(i));
    if (m) { rx += m[2] ? `(?<${m[1]}>.*)` : `(?<${m[1]}>[^/]+)`; i += m[0].length; continue; }
    const c = source[i];
    rx += c === '.' && source[i - 1] !== '\\' && !/[\\(]/.test(source[i - 1] || '') ? '\\.' : c;
    i += 1;
  }
  return new RegExp(`^${rx}$`);
}

const compile = (list) => (list || []).map((r) => Object.assign({ rx: sourceRegex(r.source) }, r));
const REDIRECTS = compile(CONFIG.redirects);
const REWRITES = compile(CONFIG.rewrites);
const HEADERS = compile(CONFIG.headers);

function hostMatches(rule, req) {
  const has = rule.has || [];
  return has.every((h) => h.type !== 'host' || String(req.headers.host || '').split(':')[0] === h.value);
}

/** Fill `:name` in a destination from the match's groups. */
function fill(dest, groups) {
  return String(dest).replace(/:([A-Za-z_][A-Za-z0-9_]*)\*?/g, (all, k) => (groups && groups[k] !== undefined ? groups[k] : all));
}

/* What .vercelignore keeps out of a deployment is not served here either. */
const IGNORED = (() => {
  let lines = [];
  try { lines = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split('\n'); } catch (_) { /* none */ }
  return lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((p) => {
    const body = p.replace(/\/$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    return new RegExp(`(^|/)${body}(/|$)`);
  });
})();

function servable(rel) {
  if (!rel || rel.split('/').some((s) => s.startsWith('.'))) return false;
  if (/^api(\/|$)/.test(rel)) return false;
  return !IGNORED.some((rx) => rx.test(rel));
}

function applyHeaders(res, pathname) {
  for (const h of HEADERS) if (h.rx.test(pathname)) for (const kv of h.headers || []) res.setHeader(kv.key, kv.value);
}

/* ── /api: the handler, with @vercel/node's request helpers ────────────── */

function apiFile(pathname) {
  const rel = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!/^api\/[A-Za-z0-9_\-/]+$/.test(rel) || /(^|\/)_/.test(rel.slice(4))) return null;
  for (const cand of [`${rel}.js`, `${rel}/index.js`]) {
    const abs = path.join(ROOT, cand);
    if (abs.startsWith(path.join(ROOT, 'api') + path.sep) && fs.existsSync(abs)) return abs;
  }
  return null;
}

async function runApi(file, req, res, query) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bytes = Buffer.concat(chunks);
  req.query = query;
  // @vercel/node parses the body lazily on first read and memoises it.
  Object.defineProperty(req, 'body', {
    configurable: true, enumerable: true,
    get() {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim();
      let v;
      if (type === 'application/json') { const s = bytes.toString(); v = s ? JSON.parse(s) : {}; }
      else if (type === 'text/plain') v = bytes.toString();
      else if (type === 'application/x-www-form-urlencoded') v = Object.fromEntries(new URLSearchParams(bytes.toString()));
      else v = bytes.length ? bytes : undefined;
      Object.defineProperty(req, 'body', { configurable: true, enumerable: true, writable: true, value: v });
      return v;
    },
    set(v) { Object.defineProperty(req, 'body', { configurable: true, enumerable: true, writable: true, value: v }); },
  });
  // A handler that reads the raw stream (webhook signatures) gets the bytes again.
  const { PassThrough } = require('stream');
  const replay = new PassThrough();
  replay.end(bytes);
  req.read = replay.read.bind(replay);
  const on = req.on.bind(req);
  req.on = req.addListener = (name, cb) => (name === 'data' || name === 'end' || name === 'readable' ? replay.on(name, cb) : on(name, cb));
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (j) => { if (!res.headersSent && !res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(j)); return res; };
  res.send = (x) => {
    if (x === undefined || x === null) { res.end(); return res; }
    if (typeof x === 'object' && !Buffer.isBuffer(x)) return res.json(x);
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', Buffer.isBuffer(x) ? 'application/octet-stream' : 'text/html; charset=utf-8');
    res.end(x); return res;
  };
  res.redirect = (a, b) => { const [code, url] = typeof a === 'number' ? [a, b] : [307, a]; res.statusCode = code; res.setHeader('Location', url); res.end(); return res; };
  const mod = require(file);
  const handler = typeof mod === 'function' ? mod : (mod && typeof mod.default === 'function' ? mod.default : null);
  if (!handler) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: 'handler_missing' })); return; }
  await handler(req, res);
}

/* ── static files ─────────────────────────────────────────────────────── */

function sendFile(res, abs, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(abs).on('error', () => { if (!res.headersSent) res.statusCode = 500; res.end(); }).pipe(res);
}

function staticFile(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch (_) { return null; }
  if (rel.includes('\0')) return null;
  const abs = path.resolve(ROOT, rel || 'index.html');
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  let target = abs;
  try { if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html'); } catch (_) { return null; }
  const relT = path.relative(ROOT, target).split(path.sep).join('/');
  if (!servable(relT)) return null;
  try { return fs.statSync(target).isFile() ? target : null; } catch (_) { return null; }
}

/* ── one request ──────────────────────────────────────────────────────── */

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams);
  applyHeaders(res, pathname);

  for (const r of REDIRECTS) {
    const m = r.rx.exec(pathname);
    if (!m || !hostMatches(r, req)) continue;
    res.statusCode = r.statusCode || (r.permanent ? 308 : 307);
    res.setHeader('Location', fill(r.destination, m.groups));
    return res.end();
  }
  for (const r of REWRITES) {
    const m = r.rx.exec(pathname);
    if (!m || !hostMatches(r, req)) continue;
    const dest = new URL(fill(r.destination, m.groups), 'http://localhost');
    pathname = dest.pathname;
    dest.searchParams.forEach((v, k) => { if (!(k in query)) query[k] = v; });
    break;
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const file = apiFile(pathname);
    if (!file) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: false, error: 'not_found' })); }
    return runApi(file, req, res, query);
  }
  const file = staticFile(pathname);
  if (file) return sendFile(res, file);
  const notFound = path.join(ROOT, '404.html');
  if (fs.existsSync(notFound)) return sendFile(res, notFound, 404);
  res.statusCode = 404;
  return res.end('Not found');
}

function createServer() {
  return http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch((e) => {
      if (!res.headersSent) { res.statusCode = (e && (e.statusCode || e.status)) || 500; res.setHeader('Content-Type', 'application/json'); }
      if (!res.writableEnded) res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    });
  });
}

module.exports = { createServer, sourceRegex, servable, apiFile };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  createServer().listen(port, () => console.log(`lifecycle-os listening on :${port}`));
}
