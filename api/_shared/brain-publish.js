'use strict';
/**
 * brain-publish.js - a Smart Brain day's sending and publishing, per platform
 * (2026-11-12).
 * ---------------------------------------------------------------------------
 * The operator: "cant see scheduled sending and publishing of assets on the
 * respective platforms in the smart brain feature for each day".
 *
 * A send's assets were built and approved, and nothing on /brain said where
 * each one goes, when, on which account, or whether it went. The queue that
 * sends (dispatch-core), the brand's own connections and the organic channels
 * (calendar-autopost ROUTES) already exist; this is the view of them for one
 * slot, and the press that queues what can be queued.
 *
 *   plan()      pure: one row per asset of the send -> where it goes, when (the
 *               slot's date at the platform's hour in the brand's own zone),
 *               on which connection, and its state.
 *   status()    the rows for a stored slot: its saved campaign, the brand's
 *               connections and the jobs already queued for it.
 *   schedule()  an APPROVED slot only: one dispatch job per row that has a
 *               channel and a connected account, under one idempotency key per
 *               (slot, asset), so pressing twice queues once.
 *
 * What it does not do: widen anything. Every job passes the preflight gate and
 * the three switches as any other (a switch off = `blocked` with the request it
 * would have made). Paid ads are never queued here: a budget is a decision, so
 * the row points at Paid launch. A platform no adapter publishes to is said.
 *
 * NOT a function file (api/_shared/ is outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const AP = require('./calendar-autopost.js');

const EMAIL_HOUR = '09:30';   // the planner's own send hour, the brand's local clock
const str = (v) => String(v == null ? '' : v).trim();
const https = (v) => (/^https:\/\//i.test(str(v)) ? str(v) : '');

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url: String(url).replace(/\/$/, ''), key };
}
async function rest(pathAndQuery) {
  const e = serviceEnv();
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, { headers: { apikey: e.key, authorization: `Bearer ${e.key}` }, cache: 'no-store' });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
  if (!res.ok) { const err = new Error(`publish store read -> ${res.status}`); err.status = 502; throw err; }
  return json;
}

/** When a row goes out: the slot's date at `hhmm` on the brand's local clock. */
function whenFor(date, hhmm, brand, now) {
  const t = AP.sendTimeFor({ date, payload: { best_time_utc: hhmm } }, brand, now);
  return { at: t.at, note: t.note.replace(/; that time had passed when it was approved.*/, ''), past: Date.parse(t.at) <= now };
}

function connState(conn) {
  if (!conn || conn.revoked_at || conn.status === 'revoked' || conn.status === 'disconnected') return 'not_connected';
  if (conn.status === 'needs_reauth') return 'needs_reauth';
  return 'connected';
}

const keyFor = (slotId, id) => `autopost:brain:${slotId}:${id}`;

/**
 * The rows of one send. `connections` is { provider: connection row }, `jobs`
 * the dispatch jobs already queued for this slot. Pure: no I/O.
 */
function plan(entry, campaign, brand, { connections = {}, jobs = [], now = Date.now(), status = '' } = {}) {
  const e = entry || {}; const c = campaign || {}; const A = c.assets || {};
  const date = str(e.date).slice(0, 10);
  const approved = status === 'approved' || status === 'final';
  const registry = require('./adapters/registry.js');
  const rows = [];
  const jobOf = (id) => jobs.find((j) => j.idempotency_key === keyFor(e.id, id)) || null;
  const routed = (row, adapterId, label) => {
    let provider = adapterId;
    try { provider = registry.connectionProviderFor(adapterId) || adapterId; } catch (_) { provider = adapterId; }
    const conn = connections[provider] || null;
    const cs = connState(conn);
    row.provider = provider;
    row.account = conn ? (conn.external_account_label || conn.external_account_id || null) : null;
    const job = jobOf(row.id);
    if (job) {
      row.job_id = job.id; row.scheduled_for = job.scheduled_for || row.scheduled_for;
      row.state = job.status === 'succeeded' ? 'sent' : job.status === 'blocked' ? 'withheld' : job.status === 'failed' ? 'failed' : job.status === 'cancelled' ? 'cancelled' : 'scheduled';
      row.message = job.status === 'succeeded' ? `Went out on ${label}${row.account ? ' (' + row.account + ')' : ''}.`
        : job.status === 'blocked' ? `Queued, and held back before sending: ${str(job.last_error) || 'a publishing switch is off or the preflight gate blocked it'}. Open Publishing to see the request it would have made.`
          : job.status === 'failed' ? `${label} refused it: ${str(job.last_error) || 'no reason was returned'}.`
            : job.status === 'cancelled' ? 'Cancelled on Publishing.'
              : `Scheduled on ${label}${row.account ? ' (' + row.account + ')' : ''} for ${row.when}.`;
    } else if (cs === 'not_connected') {
      row.state = 'not_connected';
      row.message = `${label} is not connected on this brand. Open Connections and connect the brand's own account, then press Schedule.`;
      row.fix = '/connections';
    } else if (cs === 'needs_reauth') {
      row.state = 'needs_reauth';
      row.message = `${label} needs signing in again. Open Connections, press Reconnect, then press Schedule.`;
      row.fix = '/connections';
    } else {
      row.state = approved ? 'ready' : 'awaiting_approval';
      row.message = approved ? `Ready to schedule on ${label}${row.account ? ' (' + row.account + ')' : ''} for ${row.when}.` : `Goes on ${label} at ${row.when} once this send is approved and scheduled.`;
    }
    return row;
  };

  // The mail.
  const mail = A.email || null;
  if (mail && (mail.html || (mail.variants && mail.variants.length))) {
    const w = whenFor(date, EMAIL_HOUR, brand, now);
    rows.push(routed({ id: 'email', kind: 'email', label: 'Email', what: str(mail.subject) || 'Mailer', channel: 'klaviyo_email', when: w.note, scheduled_for: w.at }, 'klaviyo', 'Klaviyo'));
  }
  // SMS, WhatsApp, push.
  for (const m of (A.messages || [])) {
    if (!m) continue;
    const ch = str(m.channel || m.type).toLowerCase();
    const w = whenFor(date, EMAIL_HOUR, brand, now);
    const base = { id: `msg_${ch}`, kind: 'message', label: ch === 'sms' ? 'SMS' : ch === 'whatsapp' ? 'WhatsApp' : 'Push', what: str(m.text || m.body || m.title).slice(0, 90), when: w.note, scheduled_for: w.at };
    if (ch === 'sms') rows.push(routed(Object.assign(base, { channel: 'klaviyo_sms' }), 'klaviyo', 'Klaviyo SMS'));
    else rows.push(Object.assign(base, { state: 'no_channel', message: `${base.label} has no sending provider in this platform yet, so it is not sent from here: copy the message into your ${base.label} tool.` }));
  }
  // Organic social posts, one per platform.
  for (const p of (A.social_posts || [])) {
    if (!p || !p.key) continue;
    const w = whenFor(date, str(p.best_time_local) || EMAIL_HOUR, brand, now);
    const base = { id: `social_${p.key}`, kind: 'social', key: p.key, label: str(p.label) || p.key, what: str(p.hook || p.caption).slice(0, 90), when: w.note, scheduled_for: w.at };
    const route = AP.ROUTES[p.key];
    if (!route) { rows.push(Object.assign(base, { state: 'no_channel', message: AP.NO_ROUTE[p.key] || `No publishing channel posts "${p.key}" in this platform.` })); continue; }
    const row = routed(Object.assign(base, { channel: route.channel }), route.adapter, route.label);
    // What the platform needs and this post does not have yet, said before it is queued.
    const needsVideo = /reel|tiktok|youtube/.test(route.channel);
    const media = p.media || {};
    if ((row.state === 'ready' || row.state === 'awaiting_approval') && needsVideo && !https(media.video_url)) {
      row.state = 'needs_media';
      row.message = `${route.label} posts a video file, and this send's video is not hosted yet: render the Story video to MP4 on the Ads tab, or post it by hand.`;
    } else if ((row.state === 'ready' || row.state === 'awaiting_approval') && !needsVideo && route.channel !== 'facebook_page_feed' && !https(media.designed_static || media.image_url)) {
      row.state = 'needs_media';
      row.message = `${route.label} posts a picture, and this product has no photo on record.`;
    }
    rows.push(row);
  }
  // Paid ads: a budget is a decision, so they go through Paid launch.
  const seen = new Set();
  for (const ad of (A.ads || [])) {
    const pf = str(ad && ad.platform).toLowerCase();
    if (!pf || seen.has(pf)) continue; seen.add(pf);
    const n = (A.ads || []).filter((x) => str(x && x.platform).toLowerCase() === pf).length;
    rows.push({ id: `ads_${pf}`, kind: 'ads', label: `${pf.charAt(0).toUpperCase() + pf.slice(1)} ads`, what: `${n} ad${n === 1 ? '' : 's'}`, when: date, state: 'manual',
      message: 'Paid ads are not sent automatically: a budget is your decision. Paid launch builds them paused on your ad account, step by step.', fix: '/publishing?tab=launch', fix_label: 'Open Paid launch' });
  }
  // The landing page is hosted here once the send is approved.
  if ((A.landing_pages || []).length) {
    const id = str(c.campaign_id);
    rows.push({ id: 'landing', kind: 'landing', label: 'Landing page', what: `${A.landing_pages.length} page${A.landing_pages.length === 1 ? '' : 's'}`, when: approved ? 'live now' : 'on approval',
      state: approved && id ? 'live' : 'awaiting_approval', message: approved && id ? 'Live at its own address: every mail and ad of this send links to it.' : 'Goes live at its own address when this send is approved.', ...(approved && id ? { fix: `/lp/${encodeURIComponent(id)}`, fix_label: 'Open the page' } : {}) });
  }
  if (A.onsite && Object.keys(A.onsite).length) rows.push({ id: 'onsite', kind: 'onsite', label: 'On-site (bar, banner, pop-up)', what: `${Object.keys(A.onsite).length} placements`, when: date, state: 'manual', message: 'Placed on your own site: download each .html from the On-site tab and add it in your store theme. No store connection writes to a theme from here.' });
  if ((A.display_banners || []).length || A.google_display) rows.push({ id: 'display', kind: 'display', label: 'Display ads', what: `${(A.display_banners || []).length} banner sizes`, when: date, state: 'manual', message: 'Uploaded in Google Ads by hand: download the banners from the Display ads tab. A display campaign needs a budget, so it is not created from here.' });

  const count = (s) => rows.filter((r) => r.state === s).length;
  return {
    date, slot_id: e.id || null, approved, rows,
    summary: { scheduled: count('scheduled'), sent: count('sent'), ready: count('ready'), withheld: count('withheld') + count('failed'), not_connected: count('not_connected') + count('needs_reauth'), manual: count('manual') + count('no_channel') + count('needs_media') },
  };
}

/* ── the stored slot ──────────────────────────────────────────────────────── */

async function load(workspaceId, slotId) {
  const ws = encodeURIComponent(workspaceId); const id = encodeURIComponent(slotId);
  const slots = await rest(`smart_calendar_entries?select=id,status,payload,generated_campaign_id&id=eq.${id}&workspace_id=eq.${ws}&limit=1`);
  const row = Array.isArray(slots) && slots[0] ? slots[0] : null;
  if (!row) return { row: null };
  let campaign = null;
  const cid = row.generated_campaign_id || (row.payload && row.payload.__prebuilt && row.payload.__prebuilt.campaign_id) || '';
  if (cid) {
    const cs = await rest(`smart_generated_campaigns?select=id,payload&id=eq.${encodeURIComponent(cid)}&workspace_id=eq.${ws}&limit=1`).catch(() => []);
    campaign = Array.isArray(cs) && cs[0] ? cs[0].payload : null;
  }
  if (campaign) { try { require('./smart-brain-plan.js').__test_topUpSavedCampaign(campaign, row.payload || {}); } catch (_) { /* the saved assets stand */ } }
  const jobs = await rest(`dispatch_jobs?select=id,channel,status,scheduled_for,idempotency_key,last_error,external_id,completed_at&workspace_id=eq.${ws}&asset_ref=eq.${encodeURIComponent('brain:' + slotId)}&order=created_at.desc&limit=100`).catch(() => []);
  return { row, campaign, jobs: Array.isArray(jobs) ? jobs : [] };
}

async function connectionsFor(workspaceId) {
  const connections = require('./workspace-connections-core.js');
  const registry = require('./adapters/registry.js');
  const out = {};
  const adapters = ['klaviyo'].concat(Object.values(AP.ROUTES).map((r) => r.adapter));
  for (const a of Array.from(new Set(adapters))) {
    let provider = a;
    try { provider = registry.connectionProviderFor(a) || a; } catch (_) { provider = a; }
    if (out[provider] !== undefined) continue;
    out[provider] = await connections.getConnectionAsService(workspaceId, provider).catch(() => null);
  }
  return out;
}

const NO_STORE = 'This deployment has no workspace database, so nothing can be scheduled on a linked account from here.';

async function status(auth, workspaceId, slotId, { brand = null, now = Date.now() } = {}) {
  if (!auth || !auth.ok || !workspaceId) return { ok: false, error: 'no_active_brand', message: 'Sign in and activate a brand to see where its sends go.' };
  if (!serviceEnv()) return { ok: true, stored: false, rows: [], message: NO_STORE };
  const got = await load(workspaceId, str(slotId));
  if (!got.row) return { ok: true, stored: false, rows: [], message: 'This send is not saved in the brand\'s calendar yet, so nothing is scheduled for it. Run Daily Sync, then open it again.' };
  if (!got.campaign) return { ok: true, stored: true, built: false, rows: [], message: 'This send has no built assets yet, so there is nothing to schedule. Press View to build them.' };
  const p = plan(got.row.payload || {}, got.campaign, brand, { connections: await connectionsFor(workspaceId), jobs: got.jobs, now, status: got.row.status });
  return Object.assign({ ok: true, stored: true, built: true, status: got.row.status }, p);
}

/** The asset each row hands its channel's adapter. */
function assetOf(row, campaign, conn) {
  const A = (campaign && campaign.assets) || {};
  if (row.kind === 'email') {
    const m = A.email || {};
    const v = (m.variants || []).find((x) => x && x.html) || {};
    return { asset: { name: `${str(campaign.campaign_id)} ${str(m.subject)}`.trim().slice(0, 200), subject: str(m.subject), preheader: str(m.preheader || m.preview_text), html: str(m.html || v.html), send_at: row.scheduled_for },
      mapping: { defaults: Object.assign({}, (conn && conn.config) || {}) }, kind: 'mailer' };
  }
  if (row.kind === 'message') {
    const m = (A.messages || []).find((x) => str(x && (x.channel || x.type)).toLowerCase() === 'sms') || {};
    return { asset: { name: `${str(campaign.campaign_id)} SMS`, sms_body: str(m.text || m.body), send_at: row.scheduled_for }, mapping: { defaults: Object.assign({}, (conn && conn.config) || {}) }, kind: 'sms' };
  }
  const p = (A.social_posts || []).find((x) => x && x.key === row.key) || {};
  const media = p.media || {};
  const post = { id: p.id, date: '', payload: { key: p.key, platform: p.platform, copy: { caption: p.caption, title: p.title || '' }, hashtags: p.hashtags || [], link: p.link || '', alt_text: p.alt_text || '',
    media: { image_url: https(media.designed_static) || https(media.image_url), video_url: https(media.video_url) } } };
  return { asset: AP.assetFor(p.key, post, conn), mapping: {}, kind: 'social_post' };
}

async function schedule(auth, workspaceId, slotId, { brand = null, now = Date.now() } = {}) {
  if (!auth || !auth.ok || !workspaceId) return { ok: false, error: 'no_active_brand', message: 'Sign in and activate a brand to schedule its sends.' };
  if (!serviceEnv()) return { ok: false, error: 'no_store', message: NO_STORE };
  await require('./brand-workspace-core.js').assertCanWrite(auth, workspaceId, 'schedule a send on a connected platform');
  const id = str(slotId);
  const got = await load(workspaceId, id);
  if (!got.row || !got.campaign) return { ok: false, error: 'not_built', message: 'This send has no saved assets, so nothing was scheduled.' };
  if (got.row.status !== 'approved' && got.row.status !== 'final') return { ok: false, error: 'not_approved', message: 'Only an approved send is scheduled. Approve it first: what you approve is what goes out.' };
  const conns = await connectionsFor(workspaceId);
  const before = plan(got.row.payload || {}, got.campaign, brand, { connections: conns, jobs: got.jobs, now, status: got.row.status });
  const dispatch = require('./dispatch-core.js');
  const results = [];
  for (const row of before.rows) {
    if (row.state !== 'ready' || !row.channel) continue;
    const built = assetOf(row, got.campaign, conns[row.provider] || null);
    try {
      const out = await dispatch.enqueue(auth, workspaceId, {
        channel: row.channel, asset: built.asset, mapping: built.mapping, mode: 'schedule', scheduled_for: row.scheduled_for,
        asset_kind: built.kind, asset_ref: `brain:${id}`, idempotency_key: keyFor(id, row.id),
        campaign_id: str(got.campaign.campaign_id), market: str((got.row.payload || {}).market),
      }, { brand });
      results.push({ id: row.id, label: row.label, ok: !!out.ok, deduped: !!out.deduped, message: out.ok ? `Scheduled for ${row.when}.` : `Not scheduled: ${out.message || 'the preflight gate blocked it.'}` });
    } catch (err) {
      if (Number(err && err.status) === 403) throw err;
      results.push({ id: row.id, label: row.label, ok: false, message: `Not scheduled: ${str(err && err.message) || 'the queue refused it.'}` });
    }
  }
  const after = await status(auth, workspaceId, id, { brand, now });
  // A row the gate refused keeps the gate's own sentence.
  for (const r of results) { if (!r.ok) { const row = (after.rows || []).find((x) => x.id === r.id); if (row && row.state === 'ready') { row.state = 'blocked'; row.message = r.message; } } }
  const queued = results.filter((r) => r.ok).length;
  return Object.assign(after, { results, queued, message: results.length
    ? `${queued} of ${results.length} scheduled.${queued < results.length ? ' The others say why below.' : ''}`
    : 'Nothing could be scheduled: each row says what it needs.' });
}

module.exports = { plan, status, schedule, keyFor, whenFor, EMAIL_HOUR };
