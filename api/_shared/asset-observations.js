/**
 * One observation record over every asset this workspace has SEEN (audit 2026-11-12).
 * ---------------------------------------------------------------------------
 * WHY. What the platform knows about real assets lived in four stores with four
 * shapes and no common answer to "whose is it, where did it come from, when was
 * it last seen, is it still running": brand_ad_history (the brand's OWN ads,
 * read from its linked ad accounts), ci_ads / ci_emails / ci_landing_pages
 * (COMPETITORS', collected by the workers and the capture inbox), and the
 * shipped mail reference set. Pages read one store each, so "Live Brand Assets"
 * showed search links where the brand's own ads already sat in a table.
 *
 * WHAT THIS IS. A READ-side canonical record: each stored row is normalised to
 * one shape, with a stable id, its OWNERSHIP (owned | competitor | reference),
 * its source, the dates the source gave, a status that says only what is known,
 * and a content key that links the same asset seen through two sources. No new
 * table and no new collector: nothing here fetches from a platform.
 *
 * THE SOURCE REGISTRY says, per source, how it is reached, whether it is
 * automated here, what it covers and what it does NOT (date range, region,
 * completeness), so a partial library is never read as a full inventory:
 *   - a source this repository may not read automatically (Milled: its
 *     robots.txt disallows automated reading; Google Ads Transparency and
 *     TikTok's library offer no feed this repository calls) is `not_read`,
 *     with the supported route (a search link to open, or a manual import);
 *   - a discovery link is navigation. It never becomes an observation.
 *
 * STATES, per source, on every read: ok | no_results | unavailable | not_read.
 * A store that did not answer is `unavailable` and takes nothing away from the
 * sources that did. Status of an observation: `active_as_reported` (the
 * platform or library said so at last_seen), `not_confirmed`, `archive`.
 * Nothing is called "live" on the strength of having been seen once.
 *
 * Captured text is untrusted input: it is returned as text, never as markup,
 * and only https media pointers are passed on.
 *
 * NOT a function file. Mounted on api/brain.js ?action=observations&op=list|sources.
 */
'use strict';

const crypto = require('crypto');
const brandCore = require('./brand-workspace-core.js');

const str = (v) => (v == null ? '' : String(v));
const enc = encodeURIComponent;
const sha = (s) => crypto.createHash('sha256').update(str(s)).digest('hex');
const https = (u) => (/^https:\/\//i.test(str(u)) ? str(u) : null);
const iso = (v) => { if (!v) return null; const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : null; };
const STALE_DAYS = 7;

const SOURCES = [
  { id: 'meta_account', label: 'Meta ad account (the brand\'s own)', ownership: 'owned', types: ['ad'], access: 'connected_account', automated: true, table: 'brand_ad_history', provider: 'meta',
    coverage: 'The ads of the linked ad account, as Meta returned them, for the import window (180 days by default). Not the Page\'s organic posts.' },
  { id: 'google_ads_account', label: 'Google Ads account (the brand\'s own)', ownership: 'owned', types: ['ad'], access: 'connected_account', automated: true, table: 'brand_ad_history', provider: 'google_ads',
    coverage: 'The ads of the linked account for the last 30 days (the date ranges confirmed for this platform). Ad copy is not read.' },
  { id: 'tiktok_ads_account', label: 'TikTok Ads account (the brand\'s own)', ownership: 'owned', types: ['ad'], access: 'connected_account', automated: false,
    coverage: 'Not read: TikTok\'s report endpoint is not confirmed for this platform, so no TikTok ad is listed and none is assumed.' },
  { id: 'meta_ad_library', label: 'Meta Ad Library (competitors)', ownership: 'competitor', types: ['ad'], access: 'public_library', automated: true, table: 'ci_ads', source: 'meta',
    coverage: 'What the library listed for the competitor\'s name on the day the collector ran. A sample of what was visible, never a full inventory, and it says nothing about spend or results.' },
  { id: 'google_ads_transparency', label: 'Google Ads Transparency Center', ownership: 'competitor', types: ['ad'], access: 'search_link', automated: false,
    coverage: 'Not read: no feed is called from here. Open the search link on Competitor Benchmarking; add what you find as a file or URL.' },
  { id: 'tiktok_library', label: 'TikTok Commercial Content Library', ownership: 'competitor', types: ['ad'], access: 'search_link', automated: false,
    coverage: 'Not read: a search link only. The library itself covers the EEA and the UK.' },
  { id: 'capture_inbox', label: 'Capture inbox (competitor mail)', ownership: 'competitor', types: ['email'], access: 'capture_inbox', automated: true, table: 'ci_emails',
    coverage: 'Mail the competitor SENT to the monitored inbox since it was subscribed. Segmented or triggered mail the inbox never received is not here.' },
  { id: 'milled', label: 'Milled (email archive)', ownership: 'competitor', types: ['email'], access: 'manual_import', automated: false,
    coverage: 'Not read: its robots.txt disallows automated reading. Save a mail from it and add the file or its address by hand.' },
  { id: 'mail_reference', label: 'Shipped mail reference set', ownership: 'reference', types: ['email'], access: 'shipped', automated: false,
    coverage: 'Measurements of real emails from Really Good Emails, by category (shape only, no HTML). Reference material: not this brand\'s competitors and not dated sends to this market.' },
  { id: 'landing_capture', label: 'Landing page captures (competitors)', ownership: 'competitor', types: ['landing'], access: 'crawler', automated: true, table: 'ci_landing_pages',
    coverage: 'Pages captured directly on the day shown, and Wayback snapshots, which are ARCHIVE copies of a past date. A capture does not say the page is live today.' },
  { id: 'manual_import', label: 'Files and URLs added by hand', ownership: 'reference', types: ['email', 'ad', 'landing', 'document'], access: 'manual_import', automated: false,
    coverage: 'Whatever was uploaded or pasted into the Knowledge Base, filed under its channel. Listed there, not here.' },
];

/** A key that is the same for the same asset seen through two sources. */
function contentKey(kind, parts) {
  const norm = parts.map((p) => str(p).toLowerCase().replace(/[?#].*$/, '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('|');
  return norm ? kind + ':' + sha(norm).slice(0, 20) : null;
}
function freshness(lastSeen, now) {
  if (!lastSeen) return { stale: null, days: null };
  const days = Math.floor(((now || Date.now()) - new Date(lastSeen).getTime()) / 86400000);
  return { stale: days > STALE_DAYS, days };
}

function fromOwnAd(ws, r, now) {
  const src = r.provider === 'meta' ? 'meta_account' : 'google_ads_account';
  const last = iso(r.last_seen);
  return {
    observation_id: [ws, src, str(r.account_id), str(r.ad_id)].join(':'),
    ownership: 'owned', source: src, platform: r.provider === 'meta' ? 'meta' : 'google', type: 'ad',
    title: str(r.headline || r.name) || null, text: str(r.primary_text || r.description) || null, cta: str(r.cta) || null,
    source_url: null, destination_url: https(r.landing_url), media: [https(r.image_url), https(r.video_url)].filter(Boolean),
    published_at: iso(r.started_at), first_seen: iso(r.first_seen), last_seen: last, last_confirmed: iso(r.imported_at) || last,
    status: r.status ? 'active_as_reported' : 'not_confirmed', status_reported: str(r.status) || null,
    currency: str(r.currency) || null, market: null, market_note: 'the platform did not return a market for this ad',
    provenance: { table: 'brand_ad_history', id: r.id || null, account_id: str(r.account_id), window: [r.window_start || null, r.window_end || null] },
    content_key: contentKey('ad', [r.landing_url, r.primary_text || r.headline || r.name]),
    freshness: freshness(last, now),
  };
}
function fromCiAd(ws, r, now) {
  const last = iso(r.last_seen);
  const src = r.source === 'meta' ? 'meta_ad_library' : 'ci_' + str(r.source);
  return {
    observation_id: [ws, src, str(r.ad_id || r.content_hash)].join(':'),
    ownership: 'competitor', owner_name: str(r.brand_name) || null, source: src, platform: str(r.source) || null, type: 'ad',
    title: str(r.headline) || null, text: str(r.primary_copy || r.description) || null, cta: str(r.cta) || null,
    source_url: https(r.source_link), destination_url: https(r.landing_url),
    media: [].concat(Array.isArray(r.image_urls) ? r.image_urls : [], Array.isArray(r.video_urls) ? r.video_urls : []).map(https).filter(Boolean).slice(0, 6),
    published_at: null, first_seen: iso(r.first_seen), last_seen: last, last_confirmed: last,
    // "active" is what the library showed when it was last read, nothing more.
    status: r.active === true ? 'active_as_reported' : 'not_confirmed', status_reported: r.active === true ? 'listed in the library' : 'no longer listed, or not re-read',
    market: null, market_note: 'the collector reads one country per run and does not store it on the ad',
    provenance: { table: 'ci_ads', id: r.id || null, content_hash: str(r.content_hash) || null },
    content_key: contentKey('ad', [r.landing_url, r.primary_copy || r.headline]),
    freshness: freshness(last, now),
  };
}
function fromCiEmail(ws, r, now) {
  const sent = iso(r.send_date);
  return {
    observation_id: [ws, 'capture_inbox', str(r.content_hash || r.id)].join(':'),
    ownership: 'competitor', owner_name: str(r.brand_name) || null, source: str(r.source) === 'inbox' || !r.source ? 'capture_inbox' : 'ci_' + str(r.source), platform: 'email', type: 'email',
    title: str(r.subject) || null, text: str(r.preheader) || null, cta: Array.isArray(r.ctas) && r.ctas[0] ? str(r.ctas[0].text || r.ctas[0]) .slice(0, 80) : null,
    sender: str(r.sender) || null,
    source_url: https(r.source_link), destination_url: null, media: [],
    published_at: sent, first_seen: iso(r.created_at) || sent, last_seen: sent, last_confirmed: sent,
    // A mail was sent once: it is an archive of that send.
    status: 'archive', status_reported: sent ? 'sent ' + sent.slice(0, 10) : 'send date not recorded',
    market: null, market_note: 'the market a mail was sent to is not recorded',
    has_html: !!r.html,
    provenance: { table: 'ci_emails', id: r.id || null, content_hash: str(r.content_hash) || null },
    content_key: contentKey('email', [r.sender, r.subject, sent ? sent.slice(0, 10) : '']),
    freshness: freshness(sent, now),
  };
}
function fromCiLanding(ws, r, now) {
  const cap = iso(r.captured_at);
  const archive = str(r.source) === 'wayback';
  return {
    observation_id: [ws, 'landing_capture', str(r.url_hash), str(r.content_hash)].join(':'),
    ownership: 'competitor', owner_name: str(r.brand_name) || null, source: 'landing_capture', capture: str(r.source) || 'direct', platform: 'web', type: 'landing',
    title: (r.enrichment && str(r.enrichment.primary_promise)) || null, text: (r.enrichment && str(r.enrichment.core_offer)) || null, cta: null,
    source_url: https(r.source_link) || https(r.url), destination_url: https(r.url), media: [],
    published_at: null, first_seen: cap, last_seen: cap, last_confirmed: cap,
    status: archive ? 'archive' : 'not_confirmed', status_reported: archive ? 'a Wayback snapshot of a past date' : 'captured ' + (cap ? cap.slice(0, 10) : 'on an unknown date') + '; not re-checked since',
    market: null, market_note: 'the market a page serves is not recorded',
    provenance: { table: 'ci_landing_pages', id: r.id || null, url_hash: str(r.url_hash) || null, content_hash: str(r.content_hash) || null },
    // versions of one page share the url; the content hash tells them apart
    content_key: contentKey('landing', [r.url]),
    version_of: str(r.url_hash) || null,
    freshness: freshness(cap, now),
  };
}

/** The same asset seen through two sources carries each other's ids as aliases. */
function link(observations) {
  const by = new Map();
  for (const o of observations) { if (!o.content_key) continue; if (!by.has(o.content_key)) by.set(o.content_key, []); by.get(o.content_key).push(o); }
  for (const group of by.values()) {
    if (group.length < 2) continue;
    for (const o of group) {
      const others = group.filter((x) => x !== o && x.observation_id !== o.observation_id);
      // Versions of one landing page are history, not duplicates.
      if (o.type === 'landing') o.versions = group.length; else if (others.length) o.aliases = others.map((x) => x.observation_id);
    }
  }
  return observations;
}

function serviceEnv() {
  const url = str(process.env.SUPABASE_URL).replace(/\/$/, ''); const key = str(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return url && key ? { url, key } : null;
}
async function restRead(pathAndQuery) {
  const e = serviceEnv();
  if (!e) { const er = new Error('no store'); er.code = 'no_store'; throw er; }
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, { headers: { apikey: e.key, authorization: `Bearer ${e.key}` }, cache: 'no-store' });
  if (!res.ok) throw new Error('the store answered ' + res.status);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

const READS = [
  { key: 'own_ads', sources: ['meta_account', 'google_ads_account'], ownership: 'owned', type: 'ad', q: (ws, lim) => `brand_ad_history?select=id,provider,account_id,ad_id,name,status,started_at,primary_text,headline,description,image_url,video_url,landing_url,cta,currency,window_start,window_end,first_seen,last_seen,imported_at&workspace_id=eq.${enc(ws)}&order=last_seen.desc&limit=${lim}`, map: fromOwnAd, sourceOf: (o) => o.source },
  { key: 'ci_ads', sources: ['meta_ad_library'], ownership: 'competitor', type: 'ad', q: (ws, lim) => `ci_ads?select=id,brand_name,source,ad_id,content_hash,first_seen,last_seen,active,image_urls,video_urls,primary_copy,headline,description,cta,landing_url,source_link&workspace_id=eq.${enc(ws)}&order=last_seen.desc&limit=${lim}`, map: fromCiAd, sourceOf: () => 'meta_ad_library' },
  { key: 'ci_emails', sources: ['capture_inbox'], ownership: 'competitor', type: 'email', q: (ws, lim) => `ci_emails?select=id,created_at,brand_name,source,content_hash,subject,preheader,sender,send_date,ctas,source_link&workspace_id=eq.${enc(ws)}&order=send_date.desc&limit=${lim}`, map: fromCiEmail, sourceOf: () => 'capture_inbox' },
  { key: 'ci_landing', sources: ['landing_capture'], ownership: 'competitor', type: 'landing', q: (ws, lim) => `ci_landing_pages?select=id,brand_name,source,url,url_hash,content_hash,captured_at,source_link,enrichment&workspace_id=eq.${enc(ws)}&order=captured_at.desc&limit=${lim}`, map: fromCiLanding, sourceOf: () => 'landing_capture' },
];

/**
 * Every observation of one workspace, newest first, with each source's state.
 * `read` is injectable (tests); the default reads the workspace's own rows with
 * the workspace named on every query.
 */
async function listFor(workspaceId, { ownership, type, limit, now, read } = {}) {
  const ws = str(workspaceId);
  const lim = Math.max(1, Math.min(300, Number(limit) || 100));
  const reader = read || restRead;
  const t = now || Date.now();
  const states = {}; const observations = [];
  for (const s of SOURCES) states[s.id] = { id: s.id, label: s.label, ownership: s.ownership, types: s.types, access: s.access, automated: s.automated, coverage: s.coverage, state: s.automated ? 'no_results' : 'not_read', count: 0, newest: null };
  for (const R of READS) {
    if (ownership && R.ownership !== ownership) continue;
    if (type && R.type !== type) continue;
    let rows;
    try { rows = await reader(R.q(ws, lim), R.key); } catch (e) {
      for (const id of R.sources) { states[id].state = 'unavailable'; states[id].note = e && e.code === 'no_store' ? 'This deployment has no store for it.' : 'The store did not answer just now; nothing is shown in its place, and nothing already known was removed.'; }
      continue;
    }
    for (const r of rows || []) {
      // Never another workspace's row, whatever the store handed back.
      if (r.workspace_id != null && str(r.workspace_id) !== ws) continue;
      const o = R.map(ws, r, t); const sid = R.sourceOf(o);
      observations.push(o);
      const st = states[sid]; if (!st) continue;
      st.count += 1; st.state = 'ok';
      if (o.last_seen && (!st.newest || o.last_seen > st.newest)) st.newest = o.last_seen;
    }
    for (const id of R.sources) { const st = states[id]; if (st.state === 'ok') { const f = freshness(st.newest, t); st.stale = f.stale; st.days_since = f.days; if ((rows || []).length >= lim) { st.state = 'partial'; st.note = `Only the newest ${lim} are listed.`; } } }
  }
  link(observations);
  observations.sort((a, b) => str(b.last_seen).localeCompare(str(a.last_seen)));
  return {
    ok: true, workspace_id: ws, count: observations.length, observations,
    sources: Object.values(states).filter((s) => (!ownership || s.ownership === ownership) && (!type || s.types.indexOf(type) >= 0)),
    note: 'Each source lists what it could see, for the window and region it covers. A count here is never the size of anyone\'s inventory.',
  };
}

const OPS = ['list', 'sources'];
async function handle(req, res, { auth, workspaceId } = {}) {
  const q = (req && req.query) || {};
  const op = str(q.op || 'list').toLowerCase();
  if (OPS.indexOf(op) < 0) return res.status(400).json({ ok: false, error: 'unknown_observations_operation', available: OPS });
  if (String((req && req.method) || 'GET').toUpperCase() !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed', message: 'Observations are read with a GET.' });
  if (op === 'sources') return res.status(200).json({ ok: true, sources: SOURCES.map((s) => ({ id: s.id, label: s.label, ownership: s.ownership, types: s.types, access: s.access, automated: s.automated, coverage: s.coverage })) });
  if (!workspaceId) return res.status(200).json({ ok: true, storage: 'device', count: 0, observations: [], sources: [], message: 'This brand is kept on this device, so nothing has been collected for it on the server.' });
  try {
    const ws = await brandCore.getWorkspace(auth, workspaceId);
    if (!ws) return res.status(404).json({ ok: false, error: 'workspace_not_found', message: 'That brand is not one you can see.' });
    const own = str(q.ownership).toLowerCase(); const type = str(q.type).toLowerCase();
    return res.status(200).json(await listFor(workspaceId, { ownership: ['owned', 'competitor', 'reference'].indexOf(own) >= 0 ? own : '', type: ['ad', 'email', 'landing'].indexOf(type) >= 0 ? type : '', limit: q.limit }));
  } catch (e) {
    return res.status(e && e.status ? e.status : 500).json({ ok: false, error: (e && e.code) || 'observations_failed', message: (e && e.message) || 'The observations could not be read.' });
  }
}

module.exports = { handle, listFor, link, contentKey, freshness, SOURCES, OPS, STALE_DAYS, fromOwnAd, fromCiAd, fromCiEmail, fromCiLanding };
