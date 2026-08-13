'use strict';

/**
 * api/_shared/klaviyo-core.js — Klaviyo integration for KNICKGASM (KicksGPT brain).
 *
 * Mirrors Klaviyo's public REST API (JSON:API, revision-pinned) so the brand
 * LLM can read/segment audiences, inspect campaigns/flows, pull reporting, and
 * push profiles/events — WITHOUT us hardcoding any keys here.
 *
 * Auth (set later in Vercel env — never hardcode):
 *   KLAVIYO_API_KEY        private key (server-side, "pk_..." / "Klaviyo-API-Key")
 *   KLAVIYO_PUBLIC_KEY     public company_id (client-side track/subscribe)
 *   KLAVIYO_REVISION       optional API revision pin (default below)
 *
 * Until a key is present, every op returns a structured { connected:false,
 * would_request } stub describing exactly the HTTP call it WOULD make — so the
 * chat UX and tool-calling work end-to-end and only need a key to go live.
 *
 * Docs: https://developers.klaviyo.com/en/reference/api_overview
 */

const API_BASE = 'https://a.klaviyo.com/api';
const DEFAULT_REVISION = '2024-10-15';
// Central read-only guard (project-wide rule for Shopify/Klaviyo/WebEngage).
const { assertReadOnly } = require('./read-only-egress.js');
// Global live-connector kill-switch (default OFF).
const { liveConnectorsEnabled } = require('./live-connectors.js');

/**
 * The credential this call runs on. A brand workspace that connected its own
 * Klaviyo account (workspace-connections-core.js) passes `creds` here and its
 * key REPLACES the deployment's, so two brands on one deployment read two
 * different Klaviyo accounts. With no creds the behaviour is what it always
 * was: the deployment env, or the not-connected stub when that is empty.
 */
function cfg(creds) {
  const c = creds && typeof creds === 'object' ? creds : {};
  return {
    key: String(c.api_key || c.key || process.env.KLAVIYO_API_KEY || '').trim(),
    publicKey: String(c.public_key || process.env.KLAVIYO_PUBLIC_KEY || '').trim(),
    revision: String(c.revision || process.env.KLAVIYO_REVISION || DEFAULT_REVISION).trim(),
  };
}

// While the kill-switch is off (default), Klaviyo reports not-connected so no
// live Klaviyo API call is made — every op returns its would_request stub.
function isConnected(creds) { return liveConnectorsEnabled() && !!cfg(creds).key; }

function qs(query) {
  const entries = Object.entries(query || {}).filter(([, v]) => v != null && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/**
 * Low-level request. When no key is configured, returns a "would_request"
 * envelope instead of calling out — so callers behave identically online/offline.
 */
// READ-ONLY POSTURE (standing hard rule for Shopify / Klaviyo / WebEngage): the
// app only ever FETCHES; it never writes/updates/deletes. This function is
// STRUCTURALLY GET-only — it takes no `method` and no `body`, always issues GET,
// and there is no code path to send POST/PUT/PATCH/DELETE to Klaviyo. The
// central read-only-egress guard (assertReadOnly) is an additional backstop.
async function request({ path, query = {}, timeoutMs = 20000, creds = null }) {
  const c = cfg(creds);
  const url = `${API_BASE}${path}${qs(query)}`;
  if (!c.key) {
    return {
      ok: false, connected: false, not_connected: true,
      would_request: { method: 'GET', url },
      hint: 'Set KLAVIYO_API_KEY in Vercel env to execute this for real. The request shape above is what will be sent.',
    };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Backstop: confirm GET to a guarded host is allowed before it leaves.
    assertReadOnly(url, 'GET');
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        Authorization: `Klaviyo-API-Key ${c.key}`,
        revision: c.revision,
        accept: 'application/vnd.api+json',
      },
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!res.ok) {
      return { ok: false, connected: true, status: res.status, error: data && data.errors ? data.errors : data, url };
    }
    return { ok: true, connected: true, status: res.status, data };
  } catch (e) {
    return { ok: false, connected: true, error: e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message, url };
  } finally {
    clearTimeout(t);
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────
// Per-resource page-size rules in revision 2024-10-15 differ (a real Klaviyo
// quirk, learned against the live account): lists cap page[size] at 10; metrics
// and campaigns reject page[size] entirely ("not a valid field for the
// resource"); and additional-fields[segment]=profile_count is ONLY valid on the
// single-segment GET, not the segments collection. clampPage keeps a caller's
// limit within a resource's accepted ceiling; ops that reject the param omit it.
function clampPage(limit, max) {
  const n = parseInt(limit, 10);
  if (!Number.isFinite(n) || n < 1) return max;
  return Math.min(n, max);
}
// Cursor passthrough: Klaviyo collections page 10-at-a-time and return a `next`
// link carrying a page[cursor] token. Callers walk pages by passing that token
// back as `cursor` (or `page[cursor]`), so we can enumerate ALL segments/lists,
// not just the first page. undefined when absent (qs() drops empty values).
function cursorOf(p) { return (p && (p.cursor || p['page[cursor]'])) || undefined; }
const getProfiles = (p = {}) => request({ creds: p.creds, path: '/profiles/', query: { 'page[size]': clampPage(p.limit, 100) || 20, 'page[cursor]': cursorOf(p), filter: p.filter, sort: p.sort } });
const getProfile  = (p = {}) => request({ creds: p.creds, path: `/profiles/${encodeURIComponent(p.id)}/` });
// Lists cap page[size] at 10 in this revision — a larger value 400s.
const getLists    = (p = {}) => request({ creds: p.creds, path: '/lists/', query: { 'page[size]': clampPage(p.limit, 10), 'page[cursor]': cursorOf(p) } });
// Single-list read asks for profile_count so a list's live size comes back in
// one call (valid on the item endpoint; not on the collection).
const getList     = (p = {}) => request({ creds: p.creds, path: `/lists/${encodeURIComponent(p.id)}/`, query: { 'additional-fields[list]': 'profile_count' } });
// Segments COLLECTION: no additional-fields (the API rejects profile_count here);
// use get_segment (singular) for the live size. page[size] caps at 10 — a larger
// value silently returns an EMPTY page, so clamp to 10 and paginate via cursor.
const getSegments = (p = {}) => request({ creds: p.creds, path: '/segments/', query: { 'page[size]': clampPage(p.limit, 10), 'page[cursor]': cursorOf(p), filter: p.filter } });
// Single segment WITH profile_count — this is the real, live cohort size.
const getSegment  = (p = {}) => request({ creds: p.creds, path: `/segments/${encodeURIComponent(p.id)}/`, query: { 'additional-fields[segment]': 'profile_count' } });
// Metrics reject page[size] ("not a valid field for the resource 'metric'").
const getMetrics  = (p = {}) => request({ creds: p.creds, path: '/metrics/' });
const getEvents   = (p = {}) => request({ creds: p.creds, path: '/events/', query: { 'page[size]': clampPage(p.limit, 100) || 20, 'page[cursor]': cursorOf(p), filter: p.filter, sort: p.sort || '-datetime' } });
const getFlows    = (p = {}) => request({ creds: p.creds, path: '/flows/', query: { 'page[size]': clampPage(p.limit, 50) } });
const getTemplates = (p = {}) => request({ creds: p.creds, path: '/templates/', query: { 'page[size]': clampPage(p.limit, 100) } });
// Campaigns require a channel filter and reject page[size] in this revision.
const getCampaigns = (p = {}) => request({
  creds: p.creds,
  path: '/campaigns/',
  query: { filter: p.filter || `equals(messages.channel,'${p.channel || 'email'}')`, sort: p.sort || '-created_at' },
});

// ── Reporting ────────────────────────────────────────────────────────────────
// Klaviyo's values-report endpoints are POST-only. Since READ IS GET ALWAYS in
// this project (no POST, even for reports), campaign reporting is intentionally
// NOT implemented here. Campaign performance is derived from GET reads + the
// data mirrored into Supabase, never a POST to Klaviyo.

// ── Writes ─────────────────────────────────────────────────────────────────
// INTENTIONALLY NONE. Standing hard rule: this project has READ-ONLY access to
// Klaviyo — no create / update / subscribe / track / delete. The former write
// functions (createProfile, subscribeProfiles, trackEvent) were removed so the
// code has no write capability at all. The central read-only-egress guard is
// the backstop; the read-only-scoped API key is the ultimate lock.

/** Op catalog — used by the tool manifest + the chat status report. */
const OPS = {
  status:             { fn: async (p = {}) => ({ ok: true, connected: isConnected(p.creds), revision: cfg(p.creds).revision, ready: isConnected(p.creds) ? 'live' : 'scaffolded — connect a Klaviyo key on this brand, or set KLAVIYO_API_KEY, to go live' }), desc: 'Connection status of the Klaviyo integration.' },
  get_profiles:       { fn: getProfiles, desc: 'List profiles (audience members). params: {limit, filter, sort}.' },
  get_profile:        { fn: getProfile, desc: 'Get one profile by id. params: {id}.' },
  get_lists:          { fn: getLists, desc: 'List all lists. params: {limit}.' },
  get_list:           { fn: getList, desc: 'Get one list by id. params: {id}.' },
  get_segments:       { fn: getSegments, desc: 'List dynamic segments (names + ids; no sizes; 10/page). params: {limit, filter, cursor}. Walk pages with the next-link page[cursor].' },
  get_segment:        { fn: getSegment, desc: 'Get one segment by id WITH its live profile_count (the real cohort size). params: {id}.' },
  get_metrics:        { fn: getMetrics, desc: 'List tracked metrics (Placed Order, Opened Email, …). params: {limit}.' },
  get_events:         { fn: getEvents, desc: 'List recent events. params: {limit, filter, sort}.' },
  get_campaigns:      { fn: getCampaigns, desc: 'List campaigns. params: {channel:email|sms, limit, filter}.' },
  get_flows:          { fn: getFlows, desc: 'List automation flows. params: {limit}.' },
  get_templates:      { fn: getTemplates, desc: 'List email templates. params: {limit}.' },
};

/** Dispatch an op by name with params. */
async function dispatch(op, params = {}, creds = null) {
  const entry = OPS[String(op || '').toLowerCase()];
  if (!entry) return { ok: false, error: `Unknown Klaviyo op '${op}'`, available: Object.keys(OPS) };
  // creds is passed as a THIRD argument rather than inside params so a caller
  // relaying a request body can never inject a credential from the wire.
  return entry.fn(Object.assign({}, params || {}, { creds: creds || null }));
}

module.exports = {
  isConnected, dispatch, OPS, request,
  getProfiles, getProfile, getLists, getList, getSegments, getSegment, getMetrics, getEvents,
  getCampaigns, getFlows, getTemplates,
};
