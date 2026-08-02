'use strict';
/**
 * webengage-core.js — WebEngage → Supabase ingestion + campaign/cohort reads.
 *
 * WebEngage pushes bulk .gz event batches to a PRIVATE Supabase Storage bucket
 * (webengage-dumps) every 12h (Data Platform → Integrations → S3, pointed at the
 * Supabase S3-compatible endpoint). This module:
 *   syncFromStorage()  — list the bucket, decompress each dump, upsert rows into
 *                        webengage_events (dedupe on event_id), delete the file.
 *   campaignPerformance() / eventSummary() / userEngagement() — fast reads the
 *                        campaigns, cohorts, dashboards and KicksGPT query.
 *
 * EGRESS NOTE: this NEVER calls webengage.com — it only reads our own Supabase
 * Storage and writes our own table, so the read-only-egress rule is satisfied
 * (WebEngage pushes to us; we never mutate WebEngage).
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role bypasses RLS for
 * the bulk upsert). Returns a structured not-configured stub when unset.
 */

const zlib = require('zlib');

function env() {
  const url = (process.env.SUPABASE_URL || process.env.SMART_BRAIN_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  return { url, key };
}
function connected() { const e = env(); return !!(e.url && e.key); }
function hdrs(key) { return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }; }
const BUCKET = () => (process.env.WEBENGAGE_BUCKET || 'webengage-dumps');

// ── Storage helpers (Supabase Storage REST) ─────────────────────────────────
async function listFiles(url, key, bucket) {
  const r = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
    method: 'POST', headers: hdrs(key),
    body: JSON.stringify({ limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!r.ok) throw new Error(`list ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const rows = await r.json();
  return (rows || []).map((f) => f.name).filter((n) => n && (n.endsWith('.gz') || n.endsWith('.json') || n.endsWith('.jsonl') || n.endsWith('.ndjson')));
}
async function downloadFile(url, key, bucket, name) {
  const r = await fetch(`${url}/storage/v1/object/${bucket}/${encodeURIComponent(name)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`download ${name} ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function deleteFile(url, key, bucket, name) {
  await fetch(`${url}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: hdrs(key), body: JSON.stringify({ prefixes: [name] }) }).catch(() => {});
}

// WebEngage row → our schema. Field names vary by export version, so accept the
// common aliases rather than assuming one shape.
function formatRow(e) {
  const id = e.id || e.event_id || e.messageId || e.eventId;
  if (!id) return null;
  return {
    webengage_event_id: String(id),
    event_name: String(e.event_name || e.eventName || e.name || 'unknown'),
    user_id: e.userId || e.user_id || e.uid || null,
    event_time: e.eventTime || e.event_time || e.timestamp || e.time || null,
    raw_payload: e,   // full source object; hot fields extracted above
  };
}
function parseDump(buf, name) {
  let text;
  try { text = /\.gz$/.test(name) ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8'); }
  catch (_) { text = buf.toString('utf8'); }   // not actually gzipped
  const rows = [];
  const t = text.trim();
  if (t.startsWith('[')) { // a JSON array
    try { for (const e of JSON.parse(t)) { const r = formatRow(e); if (r) rows.push(r); } } catch (_) {}
  } else { // NDJSON (one event per line)
    for (const line of t.split('\n')) { const s = line.trim(); if (!s) continue; try { const r = formatRow(JSON.parse(s)); if (r) rows.push(r); } catch (_) {} }
  }
  return rows;
}
async function upsert(url, key, rows) {
  if (!rows.length) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const r = await fetch(`${url}/rest/v1/webengage_events?on_conflict=webengage_event_id`, {
      method: 'POST', headers: { ...hdrs(key), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });
    // THROW on a failed batch so syncFromStorage does NOT delete the source dump
    // (deleting after a partial/failed write would permanently drop events while
    // reporting success). The caller's per-file try/catch records the error and
    // leaves the file in the bucket for the next run to retry.
    if (!r.ok) throw new Error(`webengage upsert ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
    n += batch.length;
  }
  return n;
}

/** Twice-daily sync: drain the bucket into webengage_events. Idempotent (event_id dedupe). */
async function syncFromStorage({ bucket } = {}) {
  const { url, key } = env();
  if (!url || !key) return { ok: false, connected: false, note: 'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. WebEngage pushes .gz dumps to the Supabase Storage bucket; this drains them into webengage_events.' };
  const b = bucket || BUCKET();
  const out = { ok: true, connected: true, bucket: b, files: 0, rows: 0, errors: [] };
  let files = [];
  try { files = await listFiles(url, key, b); }
  catch (e) { return { ok: false, connected: true, bucket: b, error: `bucket list failed (create a private bucket named "${b}" + point WebEngage S3 export at it): ${e.message}` }; }
  for (const name of files) {
    try {
      const buf = await downloadFile(url, key, b, name);
      const rows = parseDump(buf, name);
      const n = await upsert(url, key, rows);
      out.rows += n; out.files += 1;
      await deleteFile(url, key, b, name);   // keep the bucket light after a successful write
    } catch (e) { out.errors.push({ file: name, error: e.message }); }
  }
  return out;
}

// ── Reads (campaigns / cohorts / dashboards / KicksGPT) ──────────────────────
function sinceIso(hours) { return new Date(Date.now() - (hours || 24) * 3600 * 1000).toISOString(); }
// Look a field up in the raw event payload (top-level or nested .attributes).
function attr(row, key) {
  const p = (row && row.raw_payload) || {};
  const a = p.attributes || p.eventData || p.data || {};
  return p[key] != null ? p[key] : (a[key] != null ? a[key] : undefined);
}
async function fetchRows({ event, hours = 24, market, limit = 10000 }) {
  const { url, key } = env();
  if (!url || !key) return { connected: false, rows: [] };
  const parts = ['select=event_name,user_id,event_time,raw_payload', `event_time=gte.${encodeURIComponent(sinceIso(hours))}`, `limit=${limit}`, 'order=event_time.desc'];
  if (event) parts.push(`event_name=eq.${encodeURIComponent(event)}`);
  const r = await fetch(`${url}/rest/v1/webengage_events?${parts.join('&')}`, { headers: hdrs(key) }).catch(() => null);
  if (!r || !r.ok) return { connected: true, rows: [] };
  let rows = await r.json();
  if (market) { const m = String(market).toLowerCase(); rows = rows.filter((x) => String(attr(x, 'target_region') || attr(x, 'region') || attr(x, 'market') || '').toLowerCase().includes(m)); }
  return { connected: true, rows };
}

/** Top campaigns by an event (default Notification Clicked) in a window. */
async function campaignPerformance({ event = 'Notification Clicked', hours = 24, market, top = 15 } = {}) {
  const { connected: c, rows } = await fetchRows({ event, hours, market });
  if (!c) return { ok: false, connected: false, note: 'WebEngage store not configured (SUPABASE_SERVICE_ROLE_KEY).' };
  const by = new Map();
  for (const r of rows) {
    const name = attr(r, 'campaign_name') || attr(r, 'campaignName') || attr(r, 'campaign') || '(unnamed)';
    const e = by.get(name) || { campaign: name, events: 0, users: new Set() };
    e.events += 1; if (r.user_id) e.users.add(r.user_id); by.set(name, e);
  }
  const campaigns = [...by.values()].map((e) => ({ campaign: e.campaign, events: e.events, unique_users: e.users.size })).sort((a, b) => b.events - a.events).slice(0, top);
  return { ok: true, connected: true, event, window_hours: hours, market: market || 'all', total_events: rows.length, campaigns };
}

/** Event-type mix in a window (Notification Clicked / Cart Abandoned / ...). */
async function eventSummary({ hours = 24, market } = {}) {
  const { connected: c, rows } = await fetchRows({ hours, market });
  if (!c) return { ok: false, connected: false };
  const by = new Map();
  for (const r of rows) { by.set(r.event_name, (by.get(r.event_name) || 0) + 1); }
  return { ok: true, connected: true, window_hours: hours, market: market || 'all', total_events: rows.length, by_event: [...by.entries()].map(([event, n]) => ({ event, n })).sort((a, b) => b.n - a.n) };
}

/** Engagement (event counts) for a set of user ids — join key for RFM cohorts. */
async function userEngagement(userIds = [], { hours = 720 } = {}) {
  const ids = (userIds || []).filter(Boolean).map(String);
  if (!ids.length) return { ok: true, connected: connected(), engagement: {} };
  const { connected: c, rows } = await fetchRows({ hours, limit: 20000 });
  if (!c) return { ok: false, connected: false };
  const set = new Set(ids); const eng = {};
  for (const r of rows) { if (r.user_id && set.has(String(r.user_id))) { const u = (eng[r.user_id] = eng[r.user_id] || { events: 0, clicks: 0 }); u.events += 1; if (/click/i.test(r.event_name)) u.clicks += 1; } }
  return { ok: true, connected: true, engagement: eng };
}

module.exports = { connected, syncFromStorage, campaignPerformance, eventSummary, userEngagement, env };
