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

// ── Brand isolation ─────────────────────────────────────────────────────────
// This client holds the SERVICE-ROLE key, which bypasses RLS completely. So the
// `is_brand_member` policies on the content tables protect the browser and
// protect nothing here: an unfiltered select through this module returns EVERY
// brand's rows, and an unstamped insert lands with workspace_id NULL, invisible
// to every policy that would later show it to its owner.
//
// Both failures are silent, both were present at ~40 call sites (the CI
// collectors, the Klaviyo mirror, PageDeck, the dashboards), and none of those
// call sites takes a request object to scope itself with. So the scoping is
// applied HERE, once, for every caller including the ones not written yet.
// `workspace-scope.currentWorkspaceId()` finds the request through
// AsyncLocalStorage; outside a wrapped handler it resolves the oldest
// workspace, which is the documented behaviour for cron and scripts.
const wsScope = require('./workspace-scope.js');

async function scopeFor(table) {
  if (!wsScope.isScoped(table)) return null;
  const ws = await wsScope.currentWorkspaceId(env());
  return ws ? String(ws) : '';   // '' means scoped-but-unresolved
}

// SELECT with PostgREST filters. opts: { select, order, limit, ...eqFilters }
async function select(table, opts = {}) {
  const query = {};
  if (opts.select) query.select = opts.select;
  if (opts.order)  query.order  = opts.order;
  if (opts.limit)  query.limit  = String(opts.limit);
  for (const [k, v] of Object.entries(opts.filters || {})) query[k] = v; // e.g. {brand_id:'eq.3'}
  const ws = await scopeFor(table);
  if (ws !== null) {
    // Unresolvable workspace returns NOTHING rather than everything. Empty is
    // the honest answer for a brand with no data; another brand's rows are not.
    if (!ws) return [];
    if (!query.workspace_id) query.workspace_id = `eq.${ws}`;
  }
  return rest(table, { query });
}

async function insert(table, rows, { upsertOn } = {}) {
  const prefer = upsertOn
    ? `return=representation,resolution=merge-duplicates`
    : 'return=representation';
  const query = upsertOn ? { on_conflict: upsertOn } : undefined;
  const ws = await scopeFor(table);
  let body = rows;
  if (ws !== null) {
    // Refuse rather than write an orphan. A row with workspace_id NULL is not
    // an error anyone sees: it is accepted, and then no brand can ever read it.
    if (!ws) throw new Error(`supabase insert ${table} refused: no workspace resolved, and an unstamped row would be invisible to every brand`);
    const list = Array.isArray(rows) ? rows : [rows];
    const stamped = list.map((r) => (r && typeof r === 'object' && r.workspace_id ? r : Object.assign({}, r, { workspace_id: ws })));
    body = Array.isArray(rows) ? stamped : stamped[0];
  }
  return rest(table, { method: 'POST', body, prefer, query });
}

async function update(table, patch, filters) {
  const query = Object.assign({}, filters || {});
  const ws = await scopeFor(table);
  if (ws !== null) {
    // An UPDATE filtered only by primary key crosses brands as readily as a
    // SELECT does - the id of another brand's row is all it takes.
    if (!ws) throw new Error(`supabase update ${table} refused: no workspace resolved, so the patch could land on another brand's row`);
    query.workspace_id = `eq.${ws}`;
  }
  return rest(table, { method: 'PATCH', body: patch, prefer: 'return=representation', query });
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

module.exports = { env, headers, rest, select, insert, update, uploadObject, sha1, hashObj, scopeFor };
