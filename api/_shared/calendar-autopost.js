'use strict';
/**
 * calendar-autopost.js — an approved calendar post goes out on its day, on the
 * brand's OWN linked accounts (2026-11-08).
 * ---------------------------------------------------------------------------
 * The operator: "ensure that the complete flow for auto posting as per the
 * calendar based on the platform also is integrated based on the user account
 * linked to the respective social media platform."
 *
 * Before this, Social Media OS wrote a day's posts (social-core.runDaily ->
 * social_posts_generated), Approve only flipped `status`, and nothing ever
 * turned an approved post into a send: `push_status` stayed
 * 'not_integrated_phase_2', and the only "push" module (social-push-core.js)
 * read the PLATFORM's env tokens, never the workspace's own sign-in. The queue
 * that does send (dispatch-core), the workspace's OAuth connections and the
 * verified organic channels already existed, unjoined.
 *
 * This module is the join, and nothing else:
 *   approve -> for every platform the post targets, the workspace's OWN
 *   connection for it (workspace_connections, never an env token) -> one
 *   dispatch job per platform, scheduled for the post's own day at the
 *   platform's posting hour in the brand's home time zone, under an
 *   idempotency key per (post, channel) -> drained by the scheduler
 *   (.github/workflows/dispatch-drain.yml, every 15 minutes) -> the adapter's
 *   organic channel -> the outcome written back onto the post (reconcile()).
 *
 * What it does NOT do, on purpose:
 *   - widen anything: every job still passes the preflight gate, and a send
 *     still needs LIVE_CONNECTORS, the workspace's publishing toggle and the
 *     platform's <PLATFORM>_ALLOW_WRITES. With one off the job is `blocked`
 *     with the exact request it would have made (dispatch-core / base-adapter);
 *   - add an endpoint: every channel below is one an adapter already declares
 *     with its sources. A platform no adapter publishes to (LinkedIn, X,
 *     Threads, the blog, Instagram Stories) is said, never faked;
 *   - invent a fact: a missing video file, image, board or TikTok disclosure is
 *     the adapter's own DATA REQUIRED marker, which the preflight blocks on.
 *
 * NOT a function file (api/_shared/ is outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

/** Social Media OS post key -> the adapter and the organic channel that posts it. */
const ROUTES = {
  facebook: { adapter: 'meta', channel: 'facebook_page_feed', label: 'Facebook' },
  instagram_feed: { adapter: 'meta', channel: 'instagram_feed', label: 'Instagram' },
  instagram_reels: { adapter: 'meta', channel: 'instagram_reel', label: 'Instagram' },
  tiktok: { adapter: 'tiktok', channel: 'tiktok_video_post', label: 'TikTok' },
  pinterest: { adapter: 'pinterest', channel: 'pinterest_pin', label: 'Pinterest' },
  youtube_shorts: { adapter: 'youtube', channel: 'youtube_video_upload', label: 'YouTube' },
  // A text post on the company page, its link in the words (2026-11-12).
  linkedin: { adapter: 'linkedin', channel: 'linkedin_post', label: 'LinkedIn' },
};

/** Post keys with no publishing channel in this platform, and why, in words. */
const NO_ROUTE = {
  instagram_stories: 'Instagram Stories are not a publishing channel here: the Meta adapter publishes feed posts and Reels only.',
  x: 'X has no publishing adapter in this platform, so it is not posted automatically.',
  threads: 'Threads has no publishing adapter in this platform, so it is not posted automatically.',
  blog: 'A blog article is published on the brand\'s own site, not through a social account.',
};

/* ── storage (service role, every query names the workspace) ─────────────── */

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url: String(url).replace(/\/$/, ''), key };
}

async function rest(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = serviceEnv();
  if (!e) { const err = new Error('SUPABASE_SERVICE_ROLE_KEY is required to schedule posts.'); err.status = 503; throw err; }
  const headers = { apikey: e.key, authorization: `Bearer ${e.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) { const err = new Error(`autopost store ${method} -> ${res.status}: ${String(text).slice(0, 200)}`); err.status = 502; throw err; }
  return json;
}

const TABLE = 'social_posts_generated';

async function readPost(workspaceId, id) {
  const rows = await rest(`${TABLE}?select=*&id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function writePost(workspaceId, id, patch) {
  const rows = await rest(`${TABLE}?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`, {
    method: 'PATCH', body: patch, prefer: 'return=representation',
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/* ── the send time ────────────────────────────────────────────────────────── */

/**
 * The UTC instant of a LOCAL clock time on a date in a zone, from Intl's own
 * offset on that date (British summer time moves with the clocks; no offset
 * is typed). Null when the zone is unknown or the inputs are not a time.
 */
function localToUtc(dateIso, hhmm, timeZone) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dateIso || '').slice(0, 10)) ? String(dateIso).slice(0, 10) : '';
  if (!m || !d) return null;
  const guess = Date.parse(`${d}T${m[1].padStart(2, '0')}:${m[2]}:00Z`);
  if (!timeZone) return null;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const offsetAt = (t) => {
      const p = fmt.formatToParts(new Date(t));
      const get = (k) => Number((p.find((x) => x.type === k) || {}).value);
      return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute')) - t;
    };
    // Two passes: the offset at the guess, then at the corrected instant (a
    // zone whose offset changes between the two, on a clock-change day).
    let t = guess - offsetAt(guess);
    t = guess - offsetAt(t);
    return new Date(t).toISOString();
  } catch (_) { return null; }
}

/**
 * When a post goes out: the post's own date at its platform's posting hour
 * (social-core PLATFORM_SPECS.best_time_utc), read as the brand's LOCAL clock
 * in its home market's zone - the audience's evening, not London's. With no
 * zone on the record the hour is used as UTC and the note says so. A time
 * already past posts at the next drain.
 */
function sendTimeFor(post, brand, now) {
  const p = (post && post.payload) || post || {};
  const date = String(post.date || p.date || '').slice(0, 10);
  const hour = String(p.best_time_utc || '');
  let zone = '';
  try { zone = require('./brand-locale.js').localeFor(brand || {}).timeZone || ''; } catch (_) { zone = ''; }
  let at = zone ? localToUtc(date, hour, zone) : null;
  let note = zone ? `${date} ${hour} ${zone}` : '';
  if (!at) {
    const t = Date.parse(`${date}T${/^\d{1,2}:\d{2}$/.test(hour) ? hour.padStart(5, '0') : '09:00'}:00Z`);
    at = Number.isFinite(t) ? new Date(t).toISOString() : new Date(now).toISOString();
    note = `${date} ${hour || '09:00'} UTC (no time zone on the brand's record for its home market, so the hour is read as UTC)`;
  }
  if (Date.parse(at) <= now) { note += '; that time had passed when it was approved, so it posts at the next run of the queue'; }
  return { at, note, zone };
}

/* ── the asset each channel's adapter maps ───────────────────────────────── */

const httpsOr = (v) => (/^https:\/\//i.test(String(v || '')) ? String(v) : '');

function videoUrlOf(media) {
  const m = media || {};
  const v = m.video || {};
  const job = v.job || {};
  return httpsOr(m.video_url) || httpsOr(v.url) || httpsOr(v.video_url) || httpsOr(job.video_url) || httpsOr(job.url) || '';
}

/**
 * The post's own words and media in the shape the channel's map() reads. A
 * declaration a platform requires of the brand (TikTok's branded-content
 * disclosure, YouTube's made-for-kids and synthetic-media answers) is taken
 * only from what the brand stated on its connection, never defaulted.
 */
function assetFor(key, post, conn) {
  const p = (post && post.payload) || post || {};
  const c = p.copy || {};
  const cfg = (conn && conn.config) || {};
  const caption = String(c.caption || '');
  const tags = Array.isArray(p.hashtags) ? p.hashtags : (Array.isArray(c.hashtags) ? c.hashtags : []);
  const withTags = caption + (tags.length ? `\n\n${tags.join(' ')}` : '');
  const media = p.media || post.media || {};
  const image = httpsOr(media.image_url);
  const video = videoUrlOf(media);
  const link = httpsOr(p.link);
  switch (key) {
    case 'facebook': return { message: withTags, link };
    case 'linkedin': return { text: caption, hashtags: tags, link };
    case 'instagram_feed': return { caption, hashtags: tags, image_url: image, link };
    case 'instagram_reels': return { caption, hashtags: tags, video_url: video };
    case 'tiktok': {
      const a = { video_url: video, caption: withTags };
      if (cfg.privacy_level) a.privacy_level = String(cfg.privacy_level);
      if (typeof cfg.brand_content_toggle === 'boolean') a.brand_content_toggle = cfg.brand_content_toggle;
      if (typeof cfg.brand_organic_toggle === 'boolean') a.brand_organic_toggle = cfg.brand_organic_toggle;
      return a;
    }
    case 'pinterest': return { image_url: image, title: String(c.title || ''), description: caption, link, alt_text: String(p.alt_text || '') };
    case 'youtube_shorts': {
      const a = { video_url: video, title: String(c.title || ''), description: caption, hashtags: tags };
      if (typeof cfg.self_declared_made_for_kids === 'boolean') a.self_declared_made_for_kids = cfg.self_declared_made_for_kids;
      if (typeof cfg.contains_synthetic_media === 'boolean') a.contains_synthetic_media = cfg.contains_synthetic_media;
      return a;
    }
    default: return {};
  }
}

/** A connection that can post: present, signed in, not revoked, not waiting on a reconnect. */
function connectedState(conn) {
  if (!conn) return { ok: false, why: 'not_connected' };
  if (conn.revoked_at || conn.status === 'revoked' || conn.status === 'disconnected') return { ok: false, why: 'not_connected' };
  if (conn.status === 'needs_reauth') return { ok: false, why: 'needs_reauth' };
  return { ok: true };
}

/** One key per (post, channel): approving twice, or a retry, never posts twice. */
function idempotencyKeyFor(postId, channel) { return `autopost:social:${postId}:${channel}`; }

/* ── schedule ─────────────────────────────────────────────────────────────── */

/**
 * Schedule an APPROVED post on every platform it targets that this workspace
 * has connected. Returns one row per platform: queued (with the job and its
 * time), skipped (not connected / no channel, with the step to take) or
 * blocked (the preflight's own sentence). The rows are written onto the post
 * (`payload.autopost`) and summarised in `push_status`.
 */
async function scheduleSocialPost(auth, workspaceId, postOrId, { brand = null, now = Date.now() } = {}) {
  if (!auth || !auth.ok || !workspaceId) return { ok: false, scheduled: [], message: 'Sign in and activate a brand to schedule posts on its linked accounts.' };
  if (!serviceEnv()) return { ok: false, scheduled: [], message: 'This deployment has no workspace database, so a post cannot be scheduled on a linked account.' };
  const id = postOrId && typeof postOrId === 'object' ? postOrId.id : postOrId;
  const post = await readPost(workspaceId, id);
  if (!post) return { ok: false, scheduled: [], message: 'No saved post carries that id in this brand workspace, so nothing was scheduled.' };
  if (post.status !== 'approved' && post.status !== 'posted') return { ok: false, scheduled: [], message: 'Only an approved post is scheduled.' };
  const p = post.payload || {};
  const key = String(p.key || '');
  const registry = require('./adapters/registry.js');
  const connections = require('./workspace-connections-core.js');
  const dispatch = require('./dispatch-core.js');

  const rows = [];
  const route = ROUTES[key];
  if (!route) {
    rows.push({ key, platform: p.platform || post.platform, state: 'skipped', reason: 'no_channel', message: NO_ROUTE[key] || `No publishing channel posts "${key}" in this platform.` });
  } else {
    const A = registry.adapterFor(route.adapter);
    const provider = registry.connectionProviderFor(route.adapter);
    const conn = await connections.getConnectionAsService(workspaceId, provider);
    const st = connectedState(conn);
    if (!st.ok) {
      rows.push({
        key, platform: p.platform, channel: route.channel, provider, state: 'skipped', reason: st.why,
        message: st.why === 'needs_reauth'
          ? `${route.label} needs signing in again on this brand: open Connections, press Reconnect on ${A.label}, then approve the post again.`
          : `${route.label} is not connected on this brand, so this post was not scheduled there: open Connections and press Connect on ${A.label} with the brand's own account, then approve the post again.`,
      });
    } else {
      const when = sendTimeFor(post, brand, now);
      const out = await dispatch.enqueue(auth, workspaceId, {
        channel: route.channel,
        asset: assetFor(key, post, conn),
        mode: 'schedule',
        scheduled_for: when.at,
        asset_kind: 'social_post',
        asset_ref: `social:${post.id}`,
        idempotency_key: idempotencyKeyFor(post.id, route.channel),
        market: p.market || '',
      }, { brand });
      if (out.ok) {
        const job = out.job || {};
        rows.push({ key, platform: p.platform, channel: route.channel, provider, account: conn.external_account_label || conn.external_account_id || null,
          state: 'queued', job_id: job.id || null, scheduled_for: job.scheduled_for || when.at, when: when.note, deduped: !!out.deduped,
          message: `${out.deduped ? 'Already scheduled' : 'Scheduled'} on ${route.label} (${conn.external_account_label || 'the brand\'s linked account'}) for ${when.note}.` });
      } else {
        rows.push({ key, platform: p.platform, channel: route.channel, provider, state: 'blocked', reason: out.error || 'preflight_blocked',
          message: `Not scheduled on ${route.label}: ${out.message || 'the preflight gate blocked it.'}` });
      }
    }
  }

  const queued = rows.filter((r) => r.state === 'queued').length;
  const pushStatus = queued ? 'scheduled' : (rows.some((r) => r.state === 'blocked') ? 'blocked' : (rows[0] && rows[0].reason === 'no_channel' ? 'no_channel' : 'not_connected'));
  const autopost = { at: new Date(now).toISOString(), by: auth.user_id || null, channels: rows };
  await writePost(workspaceId, post.id, { push_status: pushStatus, payload: Object.assign({}, p, { autopost, push_status: pushStatus }) }).catch(() => null);
  return { ok: true, push_status: pushStatus, scheduled: rows };
}

/* ── reconcile: what the queue did, back onto the post ────────────────────── */

/**
 * Called by dispatch-core once a job reaches an end state (or is put back to
 * wait). The post's channel row takes the job's outcome; the post is `posted`
 * once every scheduled channel has gone out. Never fails the job.
 */
async function reconcile(job, outcome) {
  const ref = String((job && job.asset_ref) || '');
  const m = /^social:(.+)$/.exec(ref);
  if (!m || !job.workspace_id || !serviceEnv()) return { reconciled: false };
  const post = await readPost(job.workspace_id, m[1]);
  if (!post) return { reconciled: false };
  const p = post.payload || {};
  const ap = p.autopost && Array.isArray(p.autopost.channels) ? p.autopost : { channels: [] };
  const o = outcome || {};
  let row = ap.channels.find((r) => r.channel === job.channel);
  if (!row) { row = { key: p.key, platform: p.platform, channel: job.channel, job_id: job.id }; ap.channels.push(row); }
  row.state = o.status;                    // succeeded | blocked | failed | queued (retry)
  row.job_id = job.id;
  row.external_id = o.external_id || null;
  row.updated_at = new Date().toISOString();
  row.message = o.message ? String(o.message).slice(0, 600) : row.message;
  const sched = ap.channels.filter((r) => r.job_id);
  const done = sched.filter((r) => r.state === 'succeeded').length;
  let pushStatus;
  if (sched.length && done === sched.length) pushStatus = 'posted';
  else if (done) pushStatus = 'partly_posted';
  else if (sched.some((r) => r.state === 'blocked')) pushStatus = 'withheld';
  else if (sched.some((r) => r.state === 'failed')) pushStatus = 'failed';
  else pushStatus = 'scheduled';
  const patch = { push_status: pushStatus, payload: Object.assign({}, p, { autopost: ap, push_status: pushStatus }) };
  if (pushStatus === 'posted') patch.status = 'posted';
  await writePost(job.workspace_id, post.id, patch);
  return { reconciled: true, push_status: pushStatus };
}

module.exports = { scheduleSocialPost, reconcile, sendTimeFor, localToUtc, assetFor, idempotencyKeyFor, ROUTES, NO_ROUTE };
