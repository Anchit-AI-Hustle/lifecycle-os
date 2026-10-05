'use strict';
/**
 * adapters/youtube-adapter.js — YouTube Data API v3: uploads, metrics, comments.
 * ---------------------------------------------------------------------------
 * Every endpoint below was read on 2026-10-04 in Google's YouTube Data API
 * documentation (developers.google.com/youtube/v3, through the Context7
 * documentation index) and each entry names its page. The OAuth endpoints are
 * Google's, which this repo already calls for Google Ads (google-ads-adapter.js).
 *
 * DRAFT FIRST. A video is uploaded PRIVATE, always: privacyStatus "private" is
 * the only value this adapter sends on upload. Making it public is the LIVE
 * APPROVAL step, a separate dispatch job recorded with the operator who gave
 * it, and it is careful about one documented trap: videos.update DELETES every
 * mutable status property the request leaves out. So the approval first reads
 * the video's current status, carries every writable status property across
 * (embeddable, license, publicStatsViewable, publishAt, selfDeclaredMadeForKids,
 * containsSyntheticMedia - the list on the videos.update page) and changes only
 * privacyStatus. A naive {privacyStatus:"public"} would silently clear the
 * made-for-kids declaration.
 *
 * THE UPLOAD IS TWO REQUESTS (the resumable protocol): a POST that sets the
 * metadata and returns a session URI in Location, then a PUT of the bytes to
 * that URI. The bytes come from the asset's hosted video URL. Before a single
 * byte is fetched, the same three switches send() checks are checked, so a
 * deployment with publishing off never downloads a video it may not upload;
 * the fetch itself goes through the SSRF guard (assertPublicUrl), follows no
 * redirect, and is capped. The session URI is used only if it is on Google's
 * own upload host - bytes are never PUT to a host a response named.
 *
 * WEBHOOKS. YouTube's push notifications are PubSubHubbub Atom feeds about new
 * uploads and title or description changes. The YouTube page that documents
 * them describes no signature scheme, so deliveries are refused, like every
 * platform here without one.
 * ---------------------------------------------------------------------------
 */

const { SocialPlatformAdapter, redactUrl } = require('./base-adapter.js');

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';
const DOCS = 'https://developers.google.com/youtube/v3';
const SCOPE = (s) => `https://www.googleapis.com/auth/${s}`;

const ENDPOINTS = {
  channels_mine: {
    method: 'GET', url: `${API}/channels`, verified: true,
    doc: `${DOCS}/docs/channels/list and ${DOCS}/guides/auth/client-side-web-apps (GET /youtube/v3/channels?part=snippet&mine=true)`,
    scopes: [SCOPE('youtube.readonly')],
  },
  video_upload_init: {
    method: 'POST', url: `${UPLOAD}/videos`, verified: true,
    doc: `${DOCS}/guides/using_resumable_upload_protocol (POST /upload/youtube/v3/videos?uploadType=resumable&part=...; X-Upload-Content-Length, X-Upload-Content-Type; session URI in Location; then PUT the bytes)`,
    scopes: [SCOPE('youtube.upload')],
  },
  videos_list: {
    method: 'GET', url: `${API}/videos`, verified: true,
    doc: `${DOCS}/docs/videos/list (part, id) and ${DOCS}/getting-started (statistics.viewCount, likeCount, commentCount)`,
    scopes: [SCOPE('youtube.readonly')],
  },
  videos_update: {
    method: 'PUT', url: `${API}/videos`, verified: true,
    doc: `${DOCS}/docs/videos/update (part=status; a property left out of the body is DELETED; writable status: embeddable, license, privacyStatus, publicStatsViewable, publishAt, selfDeclaredMadeForKids, containsSyntheticMedia)`,
    scopes: [SCOPE('youtube.force-ssl')],
  },
  comment_threads_list: {
    method: 'GET', url: `${API}/commentThreads`, verified: true,
    doc: `${DOCS}/docs/commentThreads/list (part, videoId, maxResults 1-100, moderationStatus, textFormat)`,
    scopes: [SCOPE('youtube.force-ssl')],
  },
  comment_reply: {
    method: 'POST', url: `${API}/comments`, verified: true,
    doc: `${DOCS}/docs/comments/insert and ${DOCS}/guides/implementation/comments (part=snippet; snippet.parentId, snippet.textOriginal)`,
    scopes: [SCOPE('youtube.force-ssl')],
  },
  comment_moderate: {
    method: 'POST', url: `${API}/comments/setModerationStatus`, verified: true,
    doc: `${DOCS}/docs/comments/setModerationStatus (id, moderationStatus heldForReview | published | rejected)`,
    scopes: [SCOPE('youtube.force-ssl')],
  },
};

/** The writable status properties named on the videos.update page. */
const WRITABLE_STATUS = ['embeddable', 'license', 'privacyStatus', 'publicStatsViewable', 'publishAt', 'selfDeclaredMadeForKids', 'containsSyntheticMedia'];
const MODERATION = { publish: 'published', hold: 'heldForReview', reject: 'rejected' };
/** This platform's own cap on a fetched upload, not YouTube's limit. */
const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

class YouTubeAdapter extends SocialPlatformAdapter {
  static get id() { return 'youtube'; }
  static get label() { return 'YouTube'; }
  static get writeSwitch() { return 'YOUTUBE_ALLOW_WRITES'; }
  static get endpointTable() { return ENDPOINTS; }

  static get channels() {
    return [
      { id: 'youtube_video_upload', label: 'YouTube video upload (always private)', asset_kinds: ['video'], constraints: { video_url: 'required, a hosted video file', title_max: 100, privacy: 'private' } },
      { id: 'youtube_comment_reply', label: 'Reply to a YouTube comment', asset_kinds: ['comment_reply'], constraints: { message: 'required' } },
      { id: 'youtube_comment_moderation', label: 'Moderate a YouTube comment (publish, hold, reject)', asset_kinds: ['comment_moderation'], constraints: { action: 'publish | hold | reject' } },
      { id: 'youtube_live_approval', label: 'Live approval: make a private YouTube video public', asset_kinds: ['live_approval'], constraints: { approved_by: 'required' } },
    ];
  }

  static get auth() {
    return {
      kind: 'oauth',
      scope_separator: ' ',
      pkce: { required: false, method: 'S256', note: 'Supported by Google for a confidential web client; sent anyway.' },
      // Google returns a refresh token only with BOTH of these (see oauth-core).
      extra_authorize_params: { access_type: 'offline', prompt: 'consent' },
      platform_prereq: {
        what: 'Create an OAuth client in a Google Cloud project with the YouTube Data API v3 enabled, add the callback below as an authorised redirect URI, and complete Google\'s OAuth verification for the YouTube scopes before connecting accounts outside your own test users. An unverified project\'s uploads may be locked private by YouTube.',
        where: 'Google Cloud Console: APIs & Services.',
        env: {
          YOUTUBE_OAUTH_CLIENT_ID: 'OAuth client id.',
          YOUTUBE_OAUTH_CLIENT_SECRET: 'OAuth client secret.',
        },
      },
      endpoints: Object.assign({
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        revoke: 'https://oauth2.googleapis.com/revoke',
      }, ENDPOINTS),
      scopes: [
        { value: SCOPE('youtube.readonly'), why: 'Read the channel and its videos\' statistics.' },
        { value: SCOPE('youtube.upload'), why: 'Upload a video (always private).' },
        { value: SCOPE('youtube.force-ssl'), why: 'Read, reply to and moderate comments, and change a video\'s privacy at live approval.' },
      ],
      default_scopes: [SCOPE('youtube.readonly')],
      token_lifetime: {
        note: 'Google access tokens last about an hour and the refresh token is returned only with access_type=offline and prompt=consent. A refresh does not return a new refresh token, so the stored one is carried forward.',
      },
      sources: [
        'Google OAuth endpoints already called by this repo (google-ads-adapter.js): accounts.google.com/o/oauth2/v2/auth, oauth2.googleapis.com/token and /revoke.',
        `${DOCS}/docs/commentThreads/insert names the youtube.force-ssl scope; ${DOCS}/docs/videos/update lists youtubepartner, youtube and youtube.force-ssl; ${DOCS}/quickstart/js names youtube.readonly for channels.list mine=true.`,
        'Every endpoint-table entry names its own page. All read 2026-10-04 through the Context7 index of developers.google.com/youtube/v3.',
      ],
    };
  }

  static requiredScopes(channelId, action) {
    if (action === 'read') return [SCOPE('youtube.readonly')];
    if (channelId === 'youtube_video_upload') return [SCOPE('youtube.upload')];
    if (channelId === 'youtube_comment_reply' || channelId === 'youtube_comment_moderation' || channelId === 'youtube_live_approval') return [SCOPE('youtube.force-ssl')];
    return [];
  }

  bearer() { return { Authorization: `Bearer ${this.credentials.access_token || ''}` }; }

  async validateCredentials() {
    if (!this.credentials.access_token) return { ok: false, note: 'No YouTube access token on this workspace.' };
    const r = await this.read(`${API}/channels?part=snippet&mine=true`, { headers: this.bearer() });
    if (!r.ok) return { ok: false, note: r.error || 'Google rejected the token.' };
    const ch = r.data && Array.isArray(r.data.items) && r.data.items[0];
    return { ok: true, account: ch ? { id: ch.id, name: (ch.snippet && ch.snippet.title) || '' } : null, note: ch ? '' : 'The token works but has no YouTube channel.' };
  }

  async refreshCredentials() {
    const id = String(process.env.YOUTUBE_OAUTH_CLIENT_ID || '').trim();
    const secret = String(process.env.YOUTUBE_OAUTH_CLIENT_SECRET || '').trim();
    const refresh = this.credentials.refresh_token;
    if (!refresh) return { ok: false, supported: true, terminal: true, note: 'No YouTube refresh token is stored. Reconnect with access_type=offline and prompt=consent.' };
    if (!id || !secret) return { ok: false, supported: true, note: 'YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET are needed to refresh.' };
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: id, client_secret: secret }).toString(),
      cache: 'no-store',
    }).catch(() => null);
    const status = (res && res.status) || 0;
    if (!res || !res.ok) {
      const transient = status === 0 || status === 429 || status >= 500;
      return {
        ok: false, supported: true, transient, terminal: !transient,
        note: transient ? `Google did not complete the refresh (${status || 'no answer'}). It will be retried.` : 'Google rejected the refresh token: it is revoked or expired. The operator has to reconnect YouTube.',
      };
    }
    const j = await res.json().catch(() => null);
    if (!j || !j.access_token) return { ok: false, supported: true, transient: true, note: 'Google returned no access token.' };
    return {
      ok: true, supported: true,
      credentials: { access_token: j.access_token, refresh_token: refresh },
      expires_at: new Date(Date.now() + (Number(j.expires_in) || 3599) * 1000).toISOString(),
    };
  }

  map(asset, mapping) {
    const a = asset || {};
    const channel = String((mapping && mapping.channel) || 'youtube_video_upload');
    const missing = [];
    const warnings = [];
    if (channel === 'youtube_comment_reply') {
      if (!a.comment_id) missing.push(this.gap('comment id', 'YouTube reply'));
      if (!a.message) missing.push(this.gap('reply text', 'YouTube reply'));
      return { ok: missing.length === 0, payload: { comment_id: String(a.comment_id || ''), message: String(a.message || '') }, warnings, missing };
    }
    if (channel === 'youtube_comment_moderation') {
      const action = String(a.action || '').toLowerCase();
      if (!a.comment_id) missing.push(this.gap('comment id', 'YouTube moderation'));
      if (!MODERATION[action]) missing.push(this.gap('moderation action (publish, hold or reject)', 'YouTube moderation'));
      return { ok: missing.length === 0, payload: { comment_id: String(a.comment_id || ''), action }, warnings, missing };
    }
    if (channel === 'youtube_live_approval') {
      if (!a.external_id) missing.push(this.gap('video id', 'live approval'));
      return { ok: missing.length === 0, payload: { external_id: String(a.external_id || ''), approved_by: String(a.approved_by || '') }, warnings, missing };
    }
    const videoUrl = String(a.video_url || (a.media && a.media.video_url) || (a.creative && a.creative.video && a.creative.video.url) || '');
    const title = String(a.title || a.headline || (a.copy && a.copy.title) || '');
    if (!videoUrl) missing.push(this.gap('hosted video file URL', 'YouTube upload'));
    if (!title) missing.push(this.gap('video title', 'YouTube upload'));
    const payload = {
      video_url: videoUrl,
      title,
      description: String(a.description || a.caption || ''),
      tags: (Array.isArray(a.tags) ? a.tags : Array.isArray(a.hashtags) ? a.hashtags : []).map((t) => String(t).replace(/^#/, '')).filter(Boolean).slice(0, 30),
    };
    // Declarations are the brand's to make. Carried when the asset makes them,
    // never defaulted; a missing one is said, so the operator can make it.
    if (typeof a.self_declared_made_for_kids === 'boolean') payload.selfDeclaredMadeForKids = a.self_declared_made_for_kids;
    else warnings.push('The asset does not declare whether the video is made for kids; YouTube asks every uploader to.');
    if (typeof a.contains_synthetic_media === 'boolean') payload.containsSyntheticMedia = a.contains_synthetic_media;
    else warnings.push('The asset does not say whether it contains realistic altered or synthetic media; YouTube asks creators to disclose it.');
    if (a.category_id) payload.categoryId = String(a.category_id);
    return { ok: missing.length === 0, payload, warnings, missing };
  }

  validatePayload(channelId, p) {
    const q = p || {};
    const errors = [];
    if (!YouTubeAdapter.channel(channelId)) errors.push(`Unknown YouTube channel "${channelId}".`);
    if (channelId === 'youtube_video_upload') {
      if (!/^https:\/\//i.test(String(q.video_url || ''))) errors.push('A public https video file URL is required.');
      if (!q.title) errors.push('A title is required.');
      if (String(q.title || '').length > 100) errors.push('YouTube titles are at most 100 characters.');
    } else if (channelId === 'youtube_comment_reply') {
      if (!q.comment_id || !q.message) errors.push('A reply needs the comment thread id and the reply text.');
    } else if (channelId === 'youtube_comment_moderation') {
      if (!q.comment_id || !MODERATION[q.action]) errors.push('Moderation needs the comment id and one of publish, hold or reject.');
    } else if (channelId === 'youtube_live_approval') {
      if (!q.external_id || !q.approved_by) errors.push('A live approval needs the video id and the operator who approved it.');
    }
    return { ok: errors.length === 0, errors, warnings: [] };
  }

  async dispatch(channelId, payload) {
    const v = this.validatePayload(channelId, payload);
    if (!v.ok) return { ok: false, sent: false, error: v.errors.join(' '), error_class: 'validation' };
    switch (channelId) {
      case 'youtube_video_upload': return this.uploadVideo(payload);
      case 'youtube_comment_reply': return this.replyToComment(payload);
      case 'youtube_comment_moderation': return this.moderateComment(payload);
      default: return this.activate(payload);
    }
  }

  /** The video resource this adapter uploads. privacyStatus is always private. */
  resource(p) {
    const snippet = { title: p.title };
    if (p.description) snippet.description = p.description;
    if (Array.isArray(p.tags) && p.tags.length) snippet.tags = p.tags;
    if (p.categoryId) snippet.categoryId = p.categoryId;
    const status = { privacyStatus: 'private' };
    if (typeof p.selfDeclaredMadeForKids === 'boolean') status.selfDeclaredMadeForKids = p.selfDeclaredMadeForKids;
    if (typeof p.containsSyntheticMedia === 'boolean') status.containsSyntheticMedia = p.containsSyntheticMedia;
    return { snippet, status };
  }

  async uploadVideo(p) {
    const meta = this.resource(p);
    const query = { uploadType: 'resumable', part: 'snippet,status' };
    const would = { method: 'POST', url: `${UPLOAD}/videos?uploadType=resumable&part=snippet,status`, body: meta, then: 'PUT the video bytes to the session URI returned in Location' };

    // The same gate send() applies, asked BEFORE a single byte is fetched.
    const refused = this.writeRefusal('video_upload_init', { query, body: meta });
    if (refused) return Object.assign(refused, { would_request: Object.assign({}, refused.would_request, { then: would.then }) });

    const media = await this.fetchMedia(p.video_url);
    if (!media.ok) return { ok: false, sent: false, error: media.error, error_class: 'validation', would_request: would };

    const init = await this.callEndpoint('video_upload_init', {
      query: { uploadType: 'resumable', part: 'snippet,status' },
      headers: Object.assign({ 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(media.bytes.length), 'X-Upload-Content-Type': media.type }, this.bearer()),
      body: meta,
      captureHeaders: ['location'],
    });
    if (!init.ok) return init;
    const session = init.headers && init.headers.location;
    if (!session || !String(session).startsWith(`${UPLOAD}/videos?`)) {
      return { ok: false, sent: true, error_class: 'permanent', error: 'YouTube opened no upload session on its own upload host, so no bytes were sent.' };
    }
    const put = await this.send(session, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': media.type }, this.bearer()),
      rawBody: media.bytes,
      describeBody: { bytes: media.bytes.length, type: media.type },
    });
    if (!put.ok) return Object.assign({}, put, { resume: { session_uri: redactUrl(session) } });
    const id = put.raw && put.raw.id;
    return { ok: true, sent: true, external_id: String(id || ''), status: 'private', raw: { id, status: put.raw && put.raw.status } };
  }

  /**
   * The bytes of the asset's video, fetched through the SSRF guard, with no
   * redirect followed and a size cap (this platform's, not YouTube's).
   */
  async fetchMedia(url) {
    try { await require('../brand-workspace-core.js').assertPublicUrl(url); } catch (e) { return { ok: false, error: `The video URL was refused: ${e.message}` }; }
    const cap = Number(process.env.YOUTUBE_MAX_UPLOAD_BYTES) > 0 ? Number(process.env.YOUTUBE_MAX_UPLOAD_BYTES) : DEFAULT_MAX_UPLOAD_BYTES;
    let res;
    try { res = await fetch(url, { redirect: 'manual', cache: 'no-store' }); } catch (e) { return { ok: false, error: `The video could not be fetched: ${(e && e.message) || e}` }; }
    if (res.status >= 300 && res.status < 400) return { ok: false, error: 'The video URL redirects; redirects are not followed, so point the asset at the file itself.' };
    if (!res.ok) return { ok: false, error: `The video URL answered ${res.status}.` };
    const type = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').split(';')[0].trim();
    if (!/^video\//i.test(type) && type !== 'application/octet-stream') return { ok: false, error: `The video URL serves ${type || 'no content type'}, not a video file.` };
    const declared = Number(res.headers && res.headers.get && res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > cap) return { ok: false, error: `The video is ${declared} bytes, over this platform's ${cap}-byte upload cap.` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > cap) return { ok: false, error: `The video is ${bytes.length} bytes, over this platform's ${cap}-byte upload cap.` };
    if (!bytes.length) return { ok: false, error: 'The video URL returned no bytes.' };
    return { ok: true, bytes, type: type || 'application/octet-stream' };
  }

  async replyToComment(spec) {
    const s = spec || {};
    const r = await this.callEndpoint('comment_reply', {
      query: { part: 'snippet' },
      headers: this.bearer(),
      body: { snippet: { parentId: String(s.comment_id), textOriginal: String(s.message) } },
    });
    return r.ok ? { ok: true, sent: true, external_id: String((r.raw && r.raw.id) || ''), status: 'replied', raw: r.raw } : r;
  }

  async moderateComment(spec) {
    const s = spec || {};
    const status = MODERATION[s.action];
    const r = await this.callEndpoint('comment_moderate', { query: { id: String(s.comment_id), moderationStatus: status }, headers: this.bearer() });
    return r.ok ? { ok: true, sent: true, external_id: String(s.comment_id), status, raw: r.raw } : r;
  }

  /** LIVE APPROVAL: private -> public, keeping every other status property. */
  async activate(spec) {
    const s = spec || {};
    if (!s.approved_by) return { ok: false, sent: false, error_class: 'validation', error: 'A live approval must carry the operator who approved it.' };
    // Gate the update before the read that prepares it.
    const refused = this.writeRefusal('videos_update', { query: { part: 'status' }, body: { id: String(s.external_id), status: { privacyStatus: 'public' } } });
    if (refused) return refused;
    const cur = await this.callEndpoint('videos_list', { query: { part: 'status', id: String(s.external_id) }, headers: this.bearer() });
    if (!cur.ok) return cur;
    const item = cur.data && Array.isArray(cur.data.items) && cur.data.items[0];
    if (!item) return { ok: false, sent: false, error_class: 'permanent', error: `YouTube has no video ${s.external_id} on this channel.` };
    const status = {};
    for (const k of WRITABLE_STATUS) if (item.status && item.status[k] !== undefined) status[k] = item.status[k];
    status.privacyStatus = 'public';
    // publishAt applies only to a private, never-published video; once the
    // video is made public now, a pending schedule would contradict it.
    delete status.publishAt;
    const r = await this.callEndpoint('videos_update', { query: { part: 'status' }, headers: Object.assign({ 'Content-Type': 'application/json' }, this.bearer()), body: { id: String(s.external_id), status } });
    return r.ok ? { ok: true, sent: true, external_id: String(s.external_id), status: 'public', raw: { id: r.raw && r.raw.id } } : r;
  }

  async readPostMetrics(refs) {
    const ids = ((refs && (Array.isArray(refs.ids) ? refs.ids : [refs.id])) || []).filter(Boolean).slice(0, 50);
    if (!ids.length) return { ok: false, note: 'No YouTube video ids were given.' };
    const r = await this.callEndpoint('videos_list', { query: { part: 'statistics', id: ids.join(',') }, headers: this.bearer() });
    if (!r.ok) return Object.assign({ ok: false }, r);
    const rename = { viewCount: 'views', likeCount: 'likes', commentCount: 'comments' };
    return {
      ok: true,
      metrics: ((r.data && r.data.items) || []).map((v) => {
        const values = {};
        for (const k of Object.keys(rename)) if (v.statistics && v.statistics[k] != null && Number.isFinite(Number(v.statistics[k]))) values[rename[k]] = Number(v.statistics[k]);
        return { external_id: String(v.id), kind: 'organic', surface: 'youtube', values };
      }),
    };
  }

  async listComments(ref) {
    const r0 = ref || {};
    if (!r0.object_id) return { ok: false, note: 'No YouTube video id was given.' };
    const r = await this.callEndpoint('comment_threads_list', {
      query: { part: 'snippet', videoId: String(r0.object_id), maxResults: Math.min(Math.max(Number(r0.limit) || 20, 1), 100), textFormat: 'plainText' },
      headers: this.bearer(),
    });
    if (!r.ok) return Object.assign({ ok: false }, r);
    return {
      ok: true,
      comments: ((r.data && r.data.items) || []).map((t) => {
        const top = t.snippet && t.snippet.topLevelComment && t.snippet.topLevelComment.snippet;
        return { id: t.id, text: top && top.textDisplay != null ? top.textDisplay : (top && top.textOriginal != null ? top.textOriginal : null), at: (top && top.publishedAt) || null, object_id: r0.object_id, surface: 'youtube' };
      }),
    };
  }
}

module.exports = YouTubeAdapter;
module.exports.ENDPOINTS = ENDPOINTS;
module.exports.WRITABLE_STATUS = WRITABLE_STATUS;
