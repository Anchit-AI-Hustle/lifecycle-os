'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Tiny Supabase PostgREST client (no SDK — keeps the serverless bundle small).
// Shared by the Competitive-Intelligence collectors and the Smart-Brain engines.
// Service-role key preferred (writes); falls back to anon. NOT a function file
// (under api/_shared/ → excluded from the Hobby 12-function cap).
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

function env() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
           || process.env.SUPABASE_SERVICE_KEY
           || process.env.SUPABASE_ANON_KEY
           || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_*_KEY missing');
  return { url: url.replace(/\/$/, ''), key };
}

function headers(extra) {
  const { key } = env();
  return Object.assign({
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  }, extra || {});
}

function sha1(s) { return crypto.createHash('sha1').update(String(s == null ? '' : s)).digest('hex'); }

// Deterministic stringify with keys sorted at EVERY level. A plain
// JSON.stringify(obj, sortedTopLevelKeys) uses the array as an allowlist applied
// at all depths, which silently drops nested keys (serializing them as {} / [{}])
// — so nested pricing/bundles/offer changes would hash identically. Recurse.
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// Stable hash over an object (deeply key-sorted) — used for content-hash dedup.
function hashObj(obj) {
  return sha1(stableStringify(obj == null ? {} : obj));
}

async function rest(path, { method = 'GET', body, prefer, query } = {}) {
  const { url } = env();
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const res = await fetch(`${url}/rest/v1/${path}${qs}`, {
    method,
    headers: headers(prefer ? { Prefer: prefer } : null),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const msg = (json && json.message) || text || res.statusText;
    const err = new Error(`supabase ${method} ${path} → ${res.status}: ${msg}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return json;
}

// SELECT with PostgREST filters. opts: { select, order, limit, ...eqFilters }
async function select(table, opts = {}) {
  const query = {};
  if (opts.select) query.select = opts.select;
  if (opts.order)  query.order  = opts.order;
  if (opts.limit)  query.limit  = String(opts.limit);
  for (const [k, v] of Object.entries(opts.filters || {})) query[k] = v; // e.g. {brand_id:'eq.3'}
  return rest(table, { query });
}

async function insert(table, rows, { upsertOn } = {}) {
  const prefer = upsertOn
    ? `return=representation,resolution=merge-duplicates`
    : 'return=representation';
  const query = upsertOn ? { on_conflict: upsertOn } : undefined;
  return rest(table, { method: 'POST', body: rows, prefer, query });
}

async function update(table, patch, filters) {
  return rest(table, { method: 'PATCH', body: patch, prefer: 'return=representation', query: filters });
}

// ── Storage: upload bytes to a bucket and return the public URL ──────────────
// Used by the off-Vercel collectors to park screenshots / raw HTML in the
// "ci-captures" bucket (create it public in Supabase once). `body` is a Buffer
// or Uint8Array. Idempotent via upsert.
async function uploadObject(bucket, objectPath, body, contentType = 'application/octet-stream') {
  const { url, key } = env();
  const clean = objectPath.replace(/^\/+/, '');
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${clean}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body
  });
  if (!res.ok && res.status !== 409) {
    const t = await res.text();
    throw new Error(`storage upload ${bucket}/${clean} → ${res.status}: ${t.slice(0, 200)}`);
  }
  return { path: clean, public_url: `${url}/storage/v1/object/public/${bucket}/${clean}` };
}

module.exports = { env, headers, rest, select, insert, update, uploadObject, sha1, hashObj };
