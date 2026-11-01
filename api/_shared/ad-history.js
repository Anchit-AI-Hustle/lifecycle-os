'use strict';
/**
 * ad-history.js — the brand's OWN paid-ad history, read from its connected ad
 * accounts and kept as evidence.
 * ---------------------------------------------------------------------------
 * Creative evidence (creative-evidence.js) briefed the writer with the brand's
 * own EMAIL campaigns and with competitor ads. The brand's own past ADS - the
 * most direct evidence of what its paid audience answered - were never read.
 * This module reads them, keeps them, and hands them to the brief.
 *
 *   op=import   (owner or editor) for each connected ad platform whose read is
 *               built here: every ad in the account over the window (default
 *               the last 180 days) with its creative copy and the per-ad
 *               metrics the platform returned. Upserts brand_ad_history on
 *               (workspace, provider, ad id); one brand_ad_history_runs row per
 *               platform says what was read and what was not.
 *   op=list     (member) the brand's ads with their metrics.
 *   op=status   (member) per platform: built or not (with why), connected,
 *               the last import and how many ads are kept.
 *
 * WHICH PLATFORMS, and why only these. Every call goes through an adapter's
 * `callEndpoint`, which refuses an endpoint its table marks unverified.
 *   - Meta: GET /act_{id}/ads (the creative as returned) + /act_{id}/insights
 *     at level=ad over the window, both paged by Meta's own cursor.
 *   - Google Ads: the searchStream reader the adapter already has. Its doc
 *     read here showed LAST_7_DAYS and LAST_30_DAYS only, so the window is the
 *     last 30 days whatever was asked, and said so; the ad's copy is not read
 *     (those GAQL fields were not confirmed), so it is null, never guessed.
 *   - TikTok Ads: its report endpoint is unverified in the adapter: not read.
 *   - Pinterest: ads analytics is verified but needs the ad ids, and no
 *     ads-list read is verified: not read.
 *
 * THE RULES.
 *   - A metric the platform did not return is null, never 0 (a 0 reads as an
 *     ad that ran and nobody clicked).
 *   - ROAS only when the platform returned it; nothing is computed from a guess
 *     at revenue.
 *   - Another workspace is never read: every query names the workspace the
 *     caller was checked against (getWorkspace, through RLS) before the
 *     service role touches the table.
 *   - The daily cron re-imports through the same code (refreshDue), on the
 *     existing daily run (no new cron).
 *
 * Mounted on api/brain.js ?action=ad-history&op=... (no new function).
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const brandCore = require('./brand-workspace-core.js');
const registry = require('./adapters/registry.js');
const { liveConnectorsEnabled } = require('./live-connectors.js');

const OPS = ['status', 'import', 'list'];
const DEFAULT_DAYS = 180;
const MAX_DAYS = 1095;          // Meta's insights reach 37 months; kept inside it
const DAY = 86400000;

const PLATFORMS = [
  { id: 'meta', label: 'Meta ads', built: true, window_note: '' },
  { id: 'google_ads', label: 'Google Ads', built: true, window_note: 'Google Ads is read for the last 30 days only: the date ranges confirmed in its documentation for this platform are LAST_7_DAYS and LAST_30_DAYS. Its ad copy is not read (those fields were not confirmed), so copy is blank for Google ads.' },
  { id: 'tiktok_ads', label: 'TikTok Ads', built: false, reason: 'TikTok\'s report endpoint is not confirmed against its reference for this platform (the adapter marks it unverified), so no TikTok ad is read.' },
  { id: 'pinterest', label: 'Pinterest ads', built: false, reason: 'Pinterest\'s ads analytics needs the ad ids, and no Pinterest ads-list read is confirmed for this platform, so no Pinterest ad is read.' },
];

function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
const enc = encodeURIComponent;

/* ── storage: service role, only after the caller's rights were checked ──── */

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: String(url).replace(/\/$/, ''), key } : null;
}

async function svc(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = serviceEnv();
  if (!e) throw err(503, 'ad_history_store_unavailable', 'This deployment has no store for ad history (SUPABASE_SERVICE_ROLE_KEY is not set), so nothing can be imported or listed here.');
  const headers = { apikey: e.key, authorization: `Bearer ${e.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) throw err(502, 'ad_history_store_failed', `The ad history store answered ${res.status} to ${method}.`);
  return json;
}

/* ── pure ─────────────────────────────────────────────────────────────────── */

const isNum = (v) => v != null && v !== '' && Number.isFinite(Number(v));
const numOrNull = (v) => (isNum(v) ? Number(v) : null);

/** The metrics a row keeps: each the platform's own number, or null. */
function cleanMetrics(m) {
  const x = m && typeof m === 'object' ? m : {};
  return {
    spend: numOrNull(x.spend),
    impressions: numOrNull(x.impressions),
    clicks: numOrNull(x.clicks),
    ctr: numOrNull(x.ctr),
    conversions: numOrNull(x.conversions),
    cost_per_result: numOrNull(x.cost_per_result),
    roas: numOrNull(x.roas),
  };
}

function windowFor(days, now) {
  const d = Math.max(1, Math.min(MAX_DAYS, Math.round(Number(days) || DEFAULT_DAYS)));
  const t = now instanceof Date ? now.getTime() : (Number(now) || Date.now());
  return { days: d, since: new Date(t - (d - 1) * DAY).toISOString().slice(0, 10), until: new Date(t).toISOString().slice(0, 10) };
}

/** Did this ad run inside the window? Created in it, or measured in it. */
function inWindow(ad, w) {
  if (ad.metrics) return true;
  if (!ad.created_at) return false;
  return String(ad.created_at).slice(0, 10) >= w.since;
}

/* ── the platform behind one brand ────────────────────────────────────────── */

async function adapterFor(workspaceId, provider) {
  const c = await require('./social-gateway-core.js').credentialsFor(workspaceId, provider);
  if (!c.ok) return { ok: false, connected: !!c.connected, note: c.note, reconnect_required: !!c.reconnect_required };
  const A = registry.adapterFor(provider);
  return { ok: true, adapter: new A({ workspaceId, credentials: c.credentials, connection: c.conn || {} }), conn: c.conn || {} };
}

/** Read one platform's ads, normalised to the stored shape. No storage. */
async function readPlatform(a, provider, w) {
  if (provider === 'meta') {
    const act = String((a.conn.config && a.conn.config.ad_account_id) || a.adapter.credentials.account_id || '');
    const r = await a.adapter.readAdHistory({ ad_account_id: act, since: w.since, until: w.until });
    if (!r.ok) return Object.assign({ ok: false }, r);
    let currency = null;
    try {
      const acc = await a.adapter.listAdAccounts();
      const row = acc && acc.ok ? (acc.accounts || []).find((x) => a.adapter.actPath(x.id) === r.account_id) : null;
      currency = (row && row.currency) || null;
    } catch (_) { currency = null; }
    const ads = r.ads.filter((x) => inWindow(x, w));
    const notes = [];
    if (!r.complete) notes.push('The account has more ads than one import reads (2,000), so the newest are kept.');
    if (r.insights_read !== true) notes.push(`Metrics were not read: ${r.insights_read}`);
    return { ok: true, account_id: r.account_id, currency, complete: !!r.complete, window: w, ads, note: notes.join(' ') };
  }
  if (provider === 'google_ads') {
    const r = await a.adapter.readAdMetrics({ date_preset: 'LAST_30_DAYS' });
    if (!r.ok) return Object.assign({ ok: false }, r);
    const customer = String((a.adapter.customerId && a.adapter.customerId()) || '');
    const w30 = windowFor(30, new Date(w.until));
    const ads = (r.rows || []).map((x) => ({
      ad_id: String(x.external_id), name: null, status: x.status || null, created_at: null,
      primary_text: null, headline: null, description: null, image_url: null, video_id: null, video_url: null, landing_url: null, cta: null,
      metrics: Object.assign({}, x.values || {}),
    }));
    return { ok: true, account_id: customer || 'google_ads', currency: null, complete: true, window: w30, ads, note: PLATFORMS.find((p) => p.id === 'google_ads').window_note };
  }
  const p = PLATFORMS.find((x) => x.id === provider);
  return { ok: false, supported: false, note: (p && p.reason) || `"${provider}" is not a platform ad history reads.` };
}

/** Upsert the ads read; first_seen is kept for an ad already stored. */
async function store(workspaceId, provider, read, by) {
  const ids = read.ads.map((a) => a.ad_id);
  const existing = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    if (!chunk.length) continue;
    const rows = await svc(`brand_ad_history?select=ad_id&workspace_id=eq.${enc(workspaceId)}&provider=eq.${enc(provider)}&ad_id=in.(${chunk.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')})`);
    for (const r of Array.isArray(rows) ? rows : []) existing.add(String(r.ad_id));
  }
  const now = new Date().toISOString();
  const shape = (a) => ({
    workspace_id: workspaceId, provider, account_id: read.account_id, ad_id: a.ad_id,
    name: a.name, status: a.status, started_at: a.created_at, primary_text: a.primary_text, headline: a.headline,
    description: a.description, image_url: a.image_url, video_url: a.video_url, video_id: a.video_id,
    landing_url: a.landing_url, cta: a.cta, currency: read.currency,
    metrics: a.metrics ? cleanMetrics(a.metrics) : cleanMetrics(null),
    window_start: read.window.since, window_end: read.window.until,
    last_seen: now, imported_at: now, imported_by: by || null,
  });
  const fresh = read.ads.filter((a) => !existing.has(a.ad_id)).map((a) => Object.assign(shape(a), { first_seen: now }));
  const again = read.ads.filter((a) => existing.has(a.ad_id)).map(shape);
  const path = 'brand_ad_history?on_conflict=workspace_id,provider,ad_id';
  for (const batch of [fresh, again]) {
    for (let i = 0; i < batch.length; i += 200) {
      await svc(path, { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: batch.slice(i, i + 200) });
    }
  }
  return { inserted: fresh.length, updated: again.length };
}

async function logRun(workspaceId, provider, row) {
  try {
    await svc('brand_ad_history_runs', { method: 'POST', prefer: 'return=minimal', body: [Object.assign({ workspace_id: workspaceId, provider, ran_at: new Date().toISOString() }, row)] });
  } catch (_) { /* the import still answers */ }
}

/** Import every built, connected platform for one workspace. The caller's rights are checked first. */
async function importFor(workspaceId, { days, providers, by, source = 'manual', now } = {}) {
  const w = windowFor(days, now);
  const want = Array.isArray(providers) && providers.length ? providers.map(String) : PLATFORMS.map((p) => p.id);
  const out = [];
  for (const p of PLATFORMS) {
    if (want.indexOf(p.id) < 0) continue;
    if (!p.built) { out.push({ provider: p.id, label: p.label, ok: false, built: false, note: p.reason }); continue; }
    let a;
    try { a = await adapterFor(workspaceId, p.id); } catch (e) { a = { ok: false, note: e.message }; }
    if (!a.ok) {
      out.push({ provider: p.id, label: p.label, ok: false, built: true, connected: !!a.connected, note: a.note });
      if (a.connected) await logRun(workspaceId, p.id, { ok: false, ads: 0, with_metrics: 0, complete: false, note: a.note || '', source, ran_by: by || null });
      continue;
    }
    if (!liveConnectorsEnabled()) {
      const note = 'LIVE_CONNECTORS is off on this deployment, which is the default, so nothing was read from the platform.';
      out.push({ provider: p.id, label: p.label, ok: false, built: true, connected: true, live: false, note });
      continue;
    }
    const read = await readPlatform(a, p.id, w);
    if (!read.ok) {
      const note = read.error || read.note || 'The platform did not answer.';
      out.push({ provider: p.id, label: p.label, ok: false, built: true, connected: true, note, would_request: read.would_request || undefined });
      await logRun(workspaceId, p.id, { ok: false, ads: 0, with_metrics: 0, complete: false, note, source, ran_by: by || null, window_start: w.since, window_end: w.until });
      continue;
    }
    const saved = await store(workspaceId, p.id, read, by);
    const withMetrics = read.ads.filter((x) => x.metrics).length;
    await logRun(workspaceId, p.id, { ok: true, account_id: read.account_id, window_start: read.window.since, window_end: read.window.until, ads: read.ads.length, with_metrics: withMetrics, complete: read.complete, note: read.note || '', source, ran_by: by || null });
    out.push({ provider: p.id, label: p.label, ok: true, built: true, connected: true, account_id: read.account_id, window: read.window, ads: read.ads.length, with_metrics: withMetrics, inserted: saved.inserted, updated: saved.updated, complete: read.complete, note: read.note || '' });
  }
  return { ok: out.some((x) => x.ok), window: w, platforms: out };
}

/* ── reads for the page and for the brief ─────────────────────────────────── */

async function listFor(workspaceId, { provider, limit } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 200));
  const rows = await svc(`brand_ad_history?select=*&workspace_id=eq.${enc(workspaceId)}${provider ? `&provider=eq.${enc(provider)}` : ''}&order=last_seen.desc&limit=${lim}`);
  return Array.isArray(rows) ? rows : [];
}

async function statusFor(workspaceId) {
  const runs = await svc(`brand_ad_history_runs?select=*&workspace_id=eq.${enc(workspaceId)}&order=ran_at.desc&limit=40`);
  const rows = await svc(`brand_ad_history?select=provider,ad_id&workspace_id=eq.${enc(workspaceId)}&limit=1000`);
  const counts = {};
  for (const r of Array.isArray(rows) ? rows : []) counts[r.provider] = (counts[r.provider] || 0) + 1;
  const out = [];
  for (const p of PLATFORMS) {
    const last = (Array.isArray(runs) ? runs : []).find((r) => r.provider === p.id) || null;
    let connected = false;
    if (p.built) {
      try { const c = await require('./social-gateway-core.js').credentialsFor(workspaceId, p.id); connected = !!c.connected; } catch (_) { connected = false; }
    }
    out.push({ provider: p.id, label: p.label, built: p.built, reason: p.reason || '', window_note: p.window_note || '', connected, ads: counts[p.id] || 0, last_import: last });
  }
  return { ok: true, live_connectors: liveConnectorsEnabled(), default_days: DEFAULT_DAYS, platforms: out };
}

/**
 * The brand's own ads as evidence for creative-evidence.js. Null when nothing
 * was ever imported (the brief then says nothing about ads); a store that does
 * not answer is null too, so a build never fails on it. Cached per instance.
 */
const _cache = new Map();
async function evidenceAds(workspaceId, { ttlMs = 10 * 60 * 1000 } = {}) {
  if (!workspaceId || !serviceEnv()) return null;
  const hit = _cache.get(workspaceId);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  let value = null;
  try {
    const runs = await svc(`brand_ad_history_runs?select=provider,ok,ran_at&workspace_id=eq.${enc(workspaceId)}&ok=eq.true&order=ran_at.desc&limit=1`);
    if (Array.isArray(runs) && runs.length) {
      const rows = await listFor(workspaceId, { limit: 300 });
      value = {
        imported: true,
        ads: rows.map((r) => ({
          provider: r.provider, ad_id: r.ad_id, name: r.name, status: r.status,
          primary_text: r.primary_text, headline: r.headline, metrics: cleanMetrics(r.metrics),
          window: { start: r.window_start, end: r.window_end }, currency: r.currency || null,
        })),
      };
    }
  } catch (_) { value = null; }
  _cache.set(workspaceId, { at: Date.now(), value });
  return value;
}
function resetCache() { _cache.clear(); }

/* ── the daily refresh, off the existing cron ─────────────────────────────── */

async function refreshDue({ maxWorkspaces = 2, olderThanMs = 20 * 3600 * 1000 } = {}) {
  if (!serviceEnv()) return { due: 0, refreshed: 0, note: 'No store on this deployment.' };
  if (!liveConnectorsEnabled()) return { due: 0, refreshed: 0, note: 'LIVE_CONNECTORS is off, so no ad account is read.' };
  const providers = PLATFORMS.filter((p) => p.built).map((p) => registry.connectionProviderFor(p.id));
  const conns = await svc(`workspace_connections?select=workspace_id,provider&status=eq.active&provider=in.(${providers.map(enc).join(',')})&limit=200`);
  const wss = [...new Set((Array.isArray(conns) ? conns : []).map((c) => c.workspace_id))];
  const due = [];
  for (const ws of wss) {
    const last = await svc(`brand_ad_history_runs?select=ran_at&workspace_id=eq.${enc(ws)}&order=ran_at.desc&limit=1`);
    const at = Array.isArray(last) && last[0] ? Date.parse(last[0].ran_at) : 0;
    if (!at || Date.now() - at > olderThanMs) due.push({ ws, at });
  }
  due.sort((a, b) => a.at - b.at);
  let refreshed = 0;
  for (const d of due.slice(0, maxWorkspaces)) {
    try { const r = await importFor(d.ws, { source: 'cron' }); if (r.ok) refreshed += 1; } catch (_) { /* next */ }
  }
  return { due: due.length, refreshed };
}

/* ── router ───────────────────────────────────────────────────────────────── */

async function handle(req, res, { auth, workspaceId, body } = {}) {
  const q = (req && req.query) || {};
  const b = body && typeof body === 'object' ? body : {};
  const op = String(q.op || b.op || 'status').toLowerCase();
  if (OPS.indexOf(op) < 0) return res.status(400).json({ ok: false, error: 'unknown_ad_history_operation', available: OPS });
  if (!workspaceId) {
    return res.status(op === 'status' ? 200 : 409).json({
      ok: op === 'status', storage: 'device', error: op === 'status' ? undefined : 'no_active_brand',
      message: 'This brand is kept on this device, and ad accounts are connected to a brand workspace on the server, so there is no ad history to import here.',
      platforms: PLATFORMS.map((p) => ({ provider: p.id, label: p.label, built: p.built, reason: p.reason || '', connected: false, ads: 0, last_import: null })),
    });
  }
  try {
    if (op === 'import') {
      if (String(req.method || 'POST').toUpperCase() !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed', message: 'An import is a POST.' });
      await brandCore.assertCanWrite(auth, workspaceId, 'import its ad history');
      const out = await importFor(workspaceId, { days: b.days || q.days, providers: b.providers, by: auth.user_id });
      resetCache();
      return res.status(200).json(out);
    }
    const ws = await brandCore.getWorkspace(auth, workspaceId);
    if (!ws) throw err(404, 'workspace_not_found', 'That brand is not one you can see.');
    if (op === 'list') return res.status(200).json({ ok: true, ads: await listFor(workspaceId, { provider: q.provider || b.provider, limit: q.limit || b.limit }) });
    return res.status(200).json(await statusFor(workspaceId));
  } catch (e) {
    return res.status(e && e.status ? e.status : 500).json({ ok: false, error: (e && e.code) || 'ad_history_failed', message: (e && e.message) || 'The ad history operation failed.' });
  }
}

module.exports = {
  handle, importFor, listFor, statusFor, evidenceAds, refreshDue, resetCache,
  readPlatform, cleanMetrics, windowFor, inWindow,
  OPS, PLATFORMS, DEFAULT_DAYS,
};
