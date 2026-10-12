'use strict';
/**
 * catalog-reader-client.js - the importer's side of the readers in each
 * country (readers/, 2026-10-12).
 * ---------------------------------------------------------------------------
 * The operator's decision: a market whose store sends this server to another
 * country's store (Lenskart IN / AE / SA / TH) is read by a small server that
 * RUNS in that country. That is not pretending a location - the request
 * really originates there - and nothing else about it changes: the reader
 * sends the importer's own user agent, no cookie, no Accept-Language, no
 * X-Forwarded-For; robots.txt, pacing, geo-redirect detection, the currency
 * check and "file it under the store it came from" all stay in the importer
 * and apply to what the reader returns.
 *
 * Configuration (Vercel env of the MAIN project):
 *   CATALOG_READERS        JSON object, market code -> reader base URL,
 *                          e.g. {"IN":"https://lifecycle-reader-in.vercel.app"}
 *   CATALOG_READER_SECRET  the same value as each reader's READER_SECRET
 *                          (>= 32 characters). It is used ONLY as the HMAC key
 *                          of X-Reader-Signature; it is never sent, returned or
 *                          logged.
 *
 * The reader URL is the operator's own configuration, so it is not run
 * through the store SSRF guard; the reader runs that guard on every hop of
 * the STORE's URL.
 */

const crypto = require('crypto');

const MIN_SECRET = 32;
const CALL_MS = 30000;   // the reader has 25 s for the store; 5 s for the trip
// What a reader answers about the TARGET (a refusal of the store URL), as
// opposed to the reader itself failing (unconfigured, bad signature, down).
const TARGET_REFUSALS = new Set(['private_address', 'bad_url', 'unresolvable', 'address_refused']);

function canon(code) {
  try {
    const LOC = require('./brand-locale.js');
    const f = LOC.family(code);
    if (f) return String(f).toUpperCase();
  } catch (_) { /* below */ }
  return String(code || '').trim().toUpperCase();
}

/** The readers the deployment names, keyed by canonical market (IN, UK, AE ...). */
function config(env) {
  const E = env || process.env;
  const raw = String(E.CATALOG_READERS || '').trim();
  const out = { readers: {}, problem: '' };
  if (!raw) return out;
  let j;
  try { j = JSON.parse(raw); } catch (_) { out.problem = 'CATALOG_READERS is not JSON'; return out; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) { out.problem = 'CATALOG_READERS is not a JSON object of market code to reader URL'; return out; }
  for (const [k, v] of Object.entries(j)) {
    let u;
    try { u = new URL(String(v || '')); } catch (_) { continue; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    const code = canon(k);
    if (code) out.readers[code] = u.toString().replace(/\/+$/, '');
  }
  const secret = String(E.CATALOG_READER_SECRET || '');
  out.secretOk = secret.length >= MIN_SECRET;
  return out;
}

/**
 * The reader for one market, or null when none is configured.
 * { code, base, host, usable, problem } - `usable` false when the secret is
 * missing or short (said in the coverage; the market is read directly).
 */
function readerFor(market, env) {
  const c = config(env);
  const code = canon(market);
  const base = c.readers[code];
  if (!base) return null;
  let host = base;
  try { host = new URL(base).host; } catch (_) { /* as configured */ }
  return { code, base, host, usable: !!c.secretOk, problem: c.secretOk ? '' : 'CATALOG_READER_SECRET is not set or is shorter than 32 characters' };
}

function sign(secret, ts, url) {
  return crypto.createHmac('sha256', String(secret)).update(`${ts}\n${url}`).digest('hex');
}

/**
 * Ask a reader for ONE URL. Resolves to one of:
 *   { ok: true, status, final_url, hops, content_type, retry_after, body (Buffer), truncated, reader }
 *   { refused: '<code>', message, hops }   the reader refused the STORE URL (an address rule)
 *   { failed: '<why>' }                    the READER did not do its job (down, refused us, bad answer)
 *   { ok: false, error, status, final_url, hops }  the store did not answer usefully
 */
async function read(reader, url, { accept, timeoutMs, env, fetchImpl } = {}) {
  const E = env || process.env;
  const secret = String(E.CATALOG_READER_SECRET || '');
  if (!reader || !reader.base) return { failed: 'no reader is configured for this market' };
  if (secret.length < MIN_SECRET) return { failed: 'CATALOG_READER_SECRET is not set or is shorter than 32 characters' };
  const ts = String(Date.now());
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, Math.min(timeoutMs || CALL_MS, CALL_MS)));
  let r, j;
  try {
    r = await (fetchImpl || fetch)(`${reader.base}/api/read`, {
      method: 'POST', signal: ctrl.signal, cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Reader-Signature': sign(secret, ts, url) },
      body: JSON.stringify({ url, accept: accept || '*/*', ts }),
    });
  } catch (e) {
    clearTimeout(timer);
    return { failed: ctrl.signal.aborted ? 'it did not answer in time' : 'it could not be reached' };
  }
  try { j = await r.json(); } catch (_) { j = null; }
  clearTimeout(timer);
  if (!j || typeof j !== 'object') return { failed: `it answered ${r.status} without a reader response` };
  if (r.status === 400 && TARGET_REFUSALS.has(j.error)) return { refused: j.error, message: j.message || '', hops: Array.isArray(j.hops) ? j.hops : [] };
  if (r.status !== 200) return { failed: `it refused the request (${r.status}${j.error ? ` ${String(j.error).slice(0, 40)}` : ''})` };
  const hops = Array.isArray(j.hops) ? j.hops.filter((h) => h && typeof h.url === 'string').map((h) => ({ url: h.url, status: Number(h.status) || 0 })) : [];
  const info = j.reader && typeof j.reader === 'object' ? { country: j.reader.country || null, region: j.reader.region || null } : { country: null, region: null };
  if (j.ok !== true) return { ok: false, error: String(j.error || 'upstream_unreachable'), status: Number(j.status) || 0, final_url: typeof j.final_url === 'string' ? j.final_url : url, hops, reader: info };
  let body;
  try { body = Buffer.from(String(j.body_base64 || ''), 'base64'); } catch (_) { return { failed: 'its answer carried no readable body' }; }
  return {
    ok: true, status: Number(j.status) || 0, final_url: typeof j.final_url === 'string' && j.final_url ? j.final_url : url, hops,
    content_type: String(j.content_type || ''), retry_after: j.retry_after == null ? null : String(j.retry_after),
    body, truncated: !!j.truncated, reader: info,
  };
}

module.exports = { config, readerFor, read, sign, MIN_SECRET };
