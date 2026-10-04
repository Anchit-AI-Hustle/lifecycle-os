'use strict';
/**
 * adapters/tiktok-adapter.js — TikTok: organic posting and metrics, and TikTok Ads.
 * ---------------------------------------------------------------------------
 * TWO PRODUCTS, TWO APPS, TWO ADAPTERS. TikTok serves organic posting and ads
 * from different developer programmes with different sign-ins:
 *
 *   TikTokAdapter     (id `tiktok`)      TikTok for Developers: Login Kit
 *                     (OAuth v2), the Content Posting API (draft upload to the
 *                     creator's inbox, or a direct post) and the Display API
 *                     (the creator's own videos and their counts). Every
 *                     endpoint below was read on 2026-10-04 in TikTok's own
 *                     documentation (developers.tiktok.com, through the Context7
 *                     documentation index, because the docs host itself is
 *                     blocked from this build environment) and names its page.
 *
 *   TikTokAdsAdapter  (id `tiktok_ads`)  TikTok API for Business (the
 *                     Marketing API). Its reference pages
 *                     (business-api.tiktok.com/portal/docs) could NOT be read.
 *                     The paths were seen only in TikTok's own published SDK
 *                     (github.com/tiktok/tiktok-business-api-sdk), and the
 *                     value that keeps a new object from spending -
 *                     operation_status "DISABLE" - does not appear in it (the
 *                     SDK's DEFAULT is "ENABLE"). So every TikTok Ads endpoint
 *                     is `verified: false` and REFUSES with the exact request it
 *                     would have made. That is the honest state: an ad API
 *                     whose "do not spend" value is unconfirmed is the last
 *                     place to send a plausible guess.
 *
 * DRAFT FIRST. The organic draft path is the inbox upload: the video lands in
 * the creator's TikTok inbox and a person finishes the post in TikTok's own
 * editor. A direct post defaults to SELF_ONLY privacy, and only to a privacy
 * level the creator_info query says this creator allows. TikTok's own rule
 * sits on top: content from an unaudited client is restricted to private
 * viewing until the app passes TikTok's audit.
 *
 * Every write is behind LIVE_CONNECTORS, the workspace's publishing toggle and
 * TIKTOK_ALLOW_WRITES (base-adapter publishAllowance).
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const { SocialPlatformAdapter, AdPlatformAdapter } = require('./base-adapter.js');

const OPEN = 'https://open.tiktokapis.com';
const DOCS = 'https://developers.tiktok.com/doc';

/** Organic: every entry read in TikTok's documentation, page named. */
const ENDPOINTS = {
  user_info: {
    method: 'GET', url: `${OPEN}/v2/user/info/`, verified: true,
    doc: `${DOCS}/display-api-get-started (GET /v2/user/info/?fields=open_id,union_id,avatar_url,display_name)`,
    scopes: ['user.info.basic'],
  },
  creator_info: {
    method: 'POST', read: true, url: `${OPEN}/v2/post/publish/creator_info/query/`, verified: true,
    doc: `${DOCS}/content-posting-api-get-started (POST /v2/post/publish/creator_info/query/: privacy_level_options, max_video_post_duration_sec)`,
  },
  video_post_init: {
    method: 'POST', url: `${OPEN}/v2/post/publish/video/init/`, verified: true,
    doc: `${DOCS}/content-posting-api-reference-direct-post (post_info.privacy_level must be one of creator_info's privacy_level_options; brand_content_toggle required; source_info.source PULL_FROM_URL with video_url)`,
    scopes: ['video.publish'],
  },
  video_inbox_init: {
    method: 'POST', url: `${OPEN}/v2/post/publish/inbox/video/init/`, verified: true,
    doc: `${DOCS}/content-posting-api-reference-upload-video (upload to the creator's inbox; the creator completes the post in TikTok; PULL_FROM_URL needs a verified domain or URL prefix)`,
    scopes: ['video.upload'],
  },
  publish_status: {
    method: 'POST', read: true, url: `${OPEN}/v2/post/publish/status/fetch/`, verified: true,
    doc: `${DOCS}/content-posting-api-reference-get-video-status (publish_id; PROCESSING_UPLOAD, PROCESSING_DOWNLOAD, SEND_TO_USER_INBOX, PUBLISH_COMPLETE, FAILED)`,
  },
  video_query: {
    method: 'POST', read: true, url: `${OPEN}/v2/video/query/`, verified: true,
    doc: `${DOCS}/tiktok-api-v2-video-query (filters.video_ids, up to 20; fields id, like_count, comment_count, share_count, view_count)`,
    scopes: ['video.list'],
  },
};

/** The Display API Video Object fields this adapter asks for. */
const VIDEO_FIELDS = 'id,like_count,comment_count,share_count,view_count';
/** The documented privacy levels. One of them must also be in creator_info's options. */
const PRIVACY = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
/**
 * How old a signed webhook may be. TikTok's verification page says to reject a
 * stale timestamp and does not give a number, so this is THIS platform's policy,
 * stated as such and overridable, never presented as TikTok's.
 */
const DEFAULT_WEBHOOK_TOLERANCE_S = 300;

/** TikTok answers some failures with HTTP 200 and error.code other than "ok". */
function tiktokError(raw) {
  const e = raw && raw.error;
  if (e && e.code && e.code !== 'ok') return `${e.code}${e.message ? ': ' + e.message : ''}`;
  return '';
}

class TikTokAdapter extends SocialPlatformAdapter {
  static get id() { return 'tiktok'; }
  static get label() { return 'TikTok'; }
  static get writeSwitch() { return 'TIKTOK_ALLOW_WRITES'; }
  static get endpointTable() { return ENDPOINTS; }

  static get channels() {
    return [
      {
        id: 'tiktok_video_draft',
        label: 'TikTok video, uploaded to the creator\'s inbox as a draft',
        asset_kinds: ['video', 'social_post'],
        constraints: { video_url: 'required, on a domain or URL prefix verified in the TikTok developer portal' },
      },
      {
        id: 'tiktok_video_post',
        label: 'TikTok video, direct post (SELF_ONLY unless the asset names an allowed privacy level)',
        asset_kinds: ['video', 'social_post'],
        constraints: { caption_max: 2200, video_url: 'required', brand_content_toggle: 'required (a disclosure, never assumed)' },
      },
    ];
  }

  static get auth() {
    return {
      kind: 'oauth',
      // TikTok calls the client id `client_key`, in the dialog and the token call.
      client_id_param: 'client_key',
      scope_separator: ',',
      pkce: null,
      platform_prereq: {
        what: 'Register an app on TikTok for Developers, add Login Kit, the Content Posting API and the Display API, add the callback below as a redirect URI, and verify the domain or URL prefix your videos are served from (PULL_FROM_URL requires it). Content from an unaudited client is restricted to private viewing until the app passes TikTok\'s audit.',
        where: 'developers.tiktok.com, Manage apps.',
        env: {
          TIKTOK_CLIENT_KEY: 'The app\'s client key (TikTok\'s name for the client id).',
          TIKTOK_CLIENT_SECRET: 'The app\'s client secret. Also the key TikTok signs webhooks with.',
        },
      },
      endpoints: Object.assign({
        authorize: 'https://www.tiktok.com/v2/auth/authorize/',
        token: `${OPEN}/v2/oauth/token/`,
        revoke: `${OPEN}/v2/oauth/revoke/`,
      }, ENDPOINTS),
      scopes: [
        { value: 'user.info.basic', why: 'Identify the connected account (open_id, display name).' },
        { value: 'video.list', why: 'Read the account\'s own videos and their like, comment, share and view counts.' },
        { value: 'video.upload', why: 'Upload a video to the creator\'s inbox as a draft they finish in TikTok.' },
        { value: 'video.publish', why: 'Post a video directly to the account.' },
      ],
      default_scopes: ['user.info.basic', 'video.list'],
      token_lifetime: {
        note: 'The token response states both lifetimes (expires_in for the access token, refresh_expires_in for the refresh token) and this platform stores what it is told. A refresh uses grant_type=refresh_token on the same token endpoint.',
      },
      webhooks: {
        callback: '/api/brain?action=dispatch-webhook&provider=tiktok',
        verification: 'TikTok-Signature: t=<timestamp>,s=<signature>. The signature is HMAC-SHA256 of "<t>.<raw body>" under the client secret, compared in constant time over the bytes that arrived; a stale timestamp is refused (TIKTOK_WEBHOOK_TOLERANCE_SECONDS, this platform\'s policy, default 300).',
      },
      sources: [
        `${DOCS}/login-kit-web — authorize URL https://www.tiktok.com/v2/auth/authorize/ with client_key, scope, response_type=code, redirect_uri, state.`,
        `${DOCS}/oauth-user-access-token-management — POST https://open.tiktokapis.com/v2/oauth/token/ (form: client_key, client_secret, code, grant_type, redirect_uri; refresh with grant_type=refresh_token), comma-separated scope in the response, POST /v2/oauth/revoke/ (client_key, client_secret, token).`,
        `${DOCS}/webhooks-verification — TikTok-Signature header, signed payload "<t>.<body>", HMAC-SHA256 under the client secret.`,
        'Every endpoint-table entry names its own page. All read 2026-10-04 through the Context7 index of developers.tiktok.com; the docs host is blocked from this build environment.',
      ],
    };
  }

  static requiredScopes(channelId, action) {
    if (action === 'read') return ['video.list'];
    if (channelId === 'tiktok_video_draft') return ['video.upload'];
    if (channelId === 'tiktok_video_post') return ['video.publish'];
    return [];
  }

  token() { return this.credentials.access_token || ''; }
  headers() { return { Authorization: `Bearer ${this.token()}`, 'Content-Type': 'application/json; charset=UTF-8' }; }

  async validateCredentials() {
    if (!this.token()) return { ok: false, note: 'No TikTok access token on this workspace.' };
    // validateCredentials runs right after the sign-in, not as a gateway read,
    // so it reads directly like every other adapter's identity check.
    const r = await this.read(`${OPEN}/v2/user/info/?fields=open_id,display_name`, { headers: this.headers() });
    if (!r.ok) return { ok: false, note: r.error || 'TikTok rejected the token.' };
    const err = tiktokError(r.data);
    if (err) return { ok: false, note: `TikTok answered ${err}.` };
    const u = (r.data && r.data.data && r.data.data.user) || {};
    return { ok: true, account: { id: u.open_id || '', name: u.display_name || '' } };
  }

  /** grant_type=refresh_token. TikTok returns a refresh token each time; the new one is kept. */
  async refreshCredentials() {
    const key = String(process.env.TIKTOK_CLIENT_KEY || '').trim();
    const secret = String(process.env.TIKTOK_CLIENT_SECRET || '').trim();
    const refresh = this.credentials.refresh_token;
    if (!refresh) return { ok: false, supported: true, terminal: true, note: 'No TikTok refresh token is stored. Reconnect TikTok.' };
    if (!key || !secret) return { ok: false, supported: true, note: 'TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are needed to refresh a TikTok token.' };
    const res = await fetch(`${OPEN}/v2/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({ client_key: key, client_secret: secret, grant_type: 'refresh_token', refresh_token: refresh }).toString(),
      cache: 'no-store',
    }).catch(() => null);
    const status = (res && res.status) || 0;
    const j = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok || !j || !j.access_token) {
      const transient = status === 0 || status === 429 || status >= 500;
      return {
        ok: false, supported: true, transient, terminal: !transient,
        note: transient
          ? `TikTok did not complete the refresh (${status || 'no answer'}). It will be retried.`
          : `TikTok refused the refresh token (${status}${j && j.error ? ', ' + j.error : ''}). The operator has to reconnect TikTok.`,
      };
    }
    const now = Date.now();
    return {
      ok: true, supported: true,
      credentials: { access_token: j.access_token, refresh_token: j.refresh_token || refresh },
      expires_at: Number(j.expires_in) > 0 ? new Date(now + Number(j.expires_in) * 1000).toISOString() : null,
      refresh_expires_at: Number(j.refresh_expires_in) > 0 ? new Date(now + Number(j.refresh_expires_in) * 1000).toISOString() : null,
      granted_scopes: typeof j.scope === 'string' ? j.scope.split(/[\s,]+/).filter(Boolean) : null,
    };
  }

  map(asset, mapping) {
    const a = asset || {};
    const d = (mapping && mapping.defaults) || {};
    const channel = String((mapping && mapping.channel) || '');
    const missing = [];
    const warnings = [];
    const videoUrl = String(a.video_url || (a.media && a.media.video_url) || (a.creative && a.creative.video && a.creative.video.url) || '');
    const title = String(a.caption || a.title || (a.copy && a.copy.caption) || '');
    if (!videoUrl) missing.push(this.gap('hosted video URL (an MP4 TikTok can pull)', 'TikTok post'));
    const out = { video_url: videoUrl };
    if (channel !== 'tiktok_video_draft') {
      out.title = title;
      out.privacy_level = String(a.privacy_level || d.privacy_level || 'SELF_ONLY');
      // A disclosure is the brand's statement about the post. It is never
      // defaulted: an asset that does not say is a gap, not a "false".
      if (typeof a.brand_content_toggle === 'boolean') out.brand_content_toggle = a.brand_content_toggle;
      else missing.push(this.gap('brand_content_toggle (is this a paid partnership for a third party?)', 'TikTok direct post'));
      if (typeof a.brand_organic_toggle === 'boolean') out.brand_organic_toggle = a.brand_organic_toggle;
      if (title.length > 2200) warnings.push(`Caption is ${title.length} characters; TikTok's limit is 2200 UTF-16 runes.`);
    }
    return { ok: missing.length === 0, payload: out, warnings, missing };
  }

  validatePayload(channelId, payload) {
    const p = payload || {};
    const errors = [];
    if (!TikTokAdapter.channel(channelId)) errors.push(`Unknown TikTok channel "${channelId}".`);
    if (!/^https:\/\//i.test(String(p.video_url || ''))) errors.push('A public https video URL is required; TikTok pulls it from a verified domain or URL prefix.');
    if (channelId === 'tiktok_video_post') {
      if (PRIVACY.indexOf(String(p.privacy_level)) < 0) errors.push(`privacy_level must be one of ${PRIVACY.join(', ')}.`);
      if (typeof p.brand_content_toggle !== 'boolean') errors.push('brand_content_toggle is required by TikTok and must come from the asset; it is a disclosure and is never assumed.');
      if (String(p.title || '').length > 2200) errors.push('The caption is over TikTok\'s 2200 limit.');
    }
    return { ok: errors.length === 0, errors, warnings: [] };
  }

  async dispatch(channelId, payload) {
    const v = this.validatePayload(channelId, payload);
    if (!v.ok) return { ok: false, sent: false, error: v.errors.join(' '), error_class: 'validation' };
    const p = payload || {};

    if (channelId === 'tiktok_video_draft') {
      const r = await this.callEndpoint('video_inbox_init', {
        headers: this.headers(),
        body: { source_info: { source: 'PULL_FROM_URL', video_url: p.video_url } },
      });
      return this.publishResult(r, 'sent_to_inbox');
    }

    const postInfo = { title: p.title || '', privacy_level: p.privacy_level, brand_content_toggle: p.brand_content_toggle };
    if (typeof p.brand_organic_toggle === 'boolean') postInfo.brand_organic_toggle = p.brand_organic_toggle;
    const postBody = { post_info: postInfo, source_info: { source: 'PULL_FROM_URL', video_url: p.video_url } };

    // The write's own gate first: with a switch off the operator sees the POST
    // that was withheld, and not even the creator_info read leaves.
    const refused = this.writeRefusal('video_post_init', { body: postBody });
    if (refused) return refused;

    // Direct post: ask TikTok which privacy levels THIS creator allows first.
    const info = await this.callEndpoint('creator_info', { headers: this.headers() });
    if (!info.ok) return info;
    const infoErr = tiktokError(info.data);
    if (infoErr) return { ok: false, sent: true, error: `TikTok creator_info answered ${infoErr}.`, error_class: 'permanent' };
    const options = (info.data && info.data.data && info.data.data.privacy_level_options) || [];
    if (options.indexOf(p.privacy_level) < 0) {
      return {
        ok: false, sent: false, error_class: 'validation',
        error: `This creator's account allows ${options.length ? options.join(', ') : 'no privacy level this platform could read'}; the asset asked for ${p.privacy_level}. Nothing was posted.`,
      };
    }
    const r = await this.callEndpoint('video_post_init', { headers: this.headers(), body: postBody });
    return this.publishResult(r, 'processing');
  }

  publishResult(r, status) {
    if (!r.ok) return r;
    const err = tiktokError(r.raw);
    if (err) return { ok: false, sent: true, error: `TikTok answered ${err}.`, error_class: 'permanent', raw: { error: r.raw.error } };
    const id = r.raw && r.raw.data && r.raw.data.publish_id;
    if (!id) return { ok: false, sent: true, error: 'TikTok accepted the call but returned no publish_id.', error_class: 'transient' };
    return { ok: true, sent: true, external_id: String(id), status, raw: r.raw };
  }

  async fetchStatus(publishId) {
    if (!publishId) return { ok: false, detail: { note: 'no publish id' } };
    const r = await this.callEndpoint('publish_status', { headers: this.headers(), body: { publish_id: String(publishId) } });
    if (!r.ok) return { ok: false, detail: { error: r.error, would_request: r.would_request } };
    const err = tiktokError(r.data);
    if (err) return { ok: false, detail: { error: err } };
    const d = (r.data && r.data.data) || {};
    return { ok: true, status: d.status || 'unknown', detail: { fail_reason: d.fail_reason || null, post_ids: d.publicaly_available_post_id || [] } };
  }

  /** Counts for the account's own videos. An absent count stays absent. */
  async readPostMetrics(refs) {
    const ids = ((refs && (Array.isArray(refs.ids) ? refs.ids : [refs.id])) || []).filter(Boolean).slice(0, 20);
    if (!ids.length) return { ok: false, note: 'No TikTok video ids were given.' };
    const r = await this.callEndpoint('video_query', { query: { fields: VIDEO_FIELDS }, headers: this.headers(), body: { filters: { video_ids: ids.map(String) } } });
    if (!r.ok) return Object.assign({ ok: false }, r);
    const err = tiktokError(r.data);
    if (err) return { ok: false, note: `TikTok answered ${err}.` };
    const rename = { view_count: 'views', like_count: 'likes', comment_count: 'comments', share_count: 'shares' };
    return {
      ok: true,
      metrics: ((r.data && r.data.data && r.data.data.videos) || []).map((v) => {
        const values = {};
        for (const k of Object.keys(rename)) if (v[k] != null && Number.isFinite(Number(v[k]))) values[rename[k]] = Number(v[k]);
        return { external_id: String(v.id), kind: 'organic', surface: 'tiktok', values };
      }),
    };
  }

  async listComments() {
    return { ok: false, supported: false, note: 'TikTok\'s Display and Content Posting APIs, as documented, offer no read of the comments on a creator\'s own videos, so there is nothing this platform can read or reply to there.' };
  }

  /**
   * TikTok-Signature: t=<timestamp>,s=<hex>. Signed payload "<t>.<raw body>",
   * HMAC-SHA256 under the client secret. Fails closed: no secret, no header, a
   * malformed header, a mismatch or a stale timestamp are each a refusal.
   */
  verifyWebhook(headers, rawBody) {
    const refuse = (reason, note) => ({ verified: false, reason, note });
    const secret = String(process.env.TIKTOK_CLIENT_SECRET || '').trim();
    if (!secret) return refuse('secret_missing', 'TIKTOK_CLIENT_SECRET is not set, so no TikTok webhook can be verified. Nothing is accepted unverified.');
    if (rawBody == null || !(Buffer.isBuffer(rawBody) || typeof rawBody === 'string')) {
      return refuse('raw_body_unavailable', 'The request body was not available as the bytes that arrived, so the signature could not be checked.');
    }
    const get = (k) => (headers && (typeof headers.get === 'function' ? headers.get(k) : headers[k])) || '';
    const header = String(get('tiktok-signature') || get('TikTok-Signature') || get('Tiktok-Signature') || '');
    const parts = {};
    for (const kv of header.split(',')) { const i = kv.indexOf('='); if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
    if (!parts.t || !parts.s) return refuse('signature_header_missing', 'No TikTok-Signature header carrying t= and s= on the request.');
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    const expected = crypto.createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${parts.t}.`, 'utf8'), body])).digest('hex');
    const a = Buffer.from(parts.s, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) return refuse('signature_mismatch', 'TikTok-Signature did not match HMAC-SHA256 of "<t>.<raw body>" under TIKTOK_CLIENT_SECRET.');
    const tolerance = Number(process.env.TIKTOK_WEBHOOK_TOLERANCE_SECONDS) > 0 ? Number(process.env.TIKTOK_WEBHOOK_TOLERANCE_SECONDS) : DEFAULT_WEBHOOK_TOLERANCE_S;
    const age = Math.abs(Date.now() / 1000 - Number(parts.t));
    if (!Number.isFinite(age) || age > tolerance) return refuse('timestamp_out_of_tolerance', `The signed timestamp is ${Number.isFinite(age) ? Math.round(age) + 's' : 'not a number'} away from now; this platform refuses anything older than ${tolerance}s as a possible replay.`);
    let event = null;
    try { event = JSON.parse(body.toString('utf8')); } catch (_) { /* keep null */ }
    return { verified: true, note: 'TikTok-Signature verified: HMAC-SHA256 over "<t>.<raw body>" matched, timestamp within tolerance.', event };
  }

  webhookAccountId(event) { return event && event.user_openid ? String(event.user_openid) : null; }

  webhookItems(event) {
    const e = event || {};
    let content = {};
    try { content = typeof e.content === 'string' ? JSON.parse(e.content) : (e.content || {}); } catch (_) { content = {}; }
    const type = String(e.event || '');
    return [{
      kind: /^post\.publish\./.test(type) ? 'publish_status' : type === 'authorization.removed' ? 'authorization' : 'other',
      field: type,
      surface: 'tiktok',
      account_id: e.user_openid ? String(e.user_openid) : null,
      object_id: content.publish_id ? String(content.publish_id) : null,
      status: type || null,
      text: null,
    }];
  }
}

/* ── TikTok Ads (API for Business) ────────────────────────────────────────── */

const BIZ = 'https://business-api.tiktok.com/open_api/v1.3';
const SDK = 'github.com/tiktok/tiktok-business-api-sdk';
const UNCONFIRMED = 'TikTok API for Business reference pages could not be read; this path was seen only in TikTok\'s own SDK, and the field values below (notably operation_status "DISABLE") were not confirmed there.';

const ADS_ENDPOINTS = {
  ad_create: { method: 'POST', url: `${BIZ}/ad/create/`, verified: false, doc: `${SDK} (AdCreateBody: adgroup_id, advertiser_id, creatives[] with operation_status)`, note: UNCONFIRMED },
  ad_status_update: { method: 'POST', url: `${BIZ}/ad/status/update/`, verified: false, doc: `${SDK} (status update endpoints exist per object)`, note: UNCONFIRMED },
  report_integrated_get: { method: 'GET', url: `${BIZ}/report/integrated/get/`, verified: false, doc: `${SDK} (ReportingApi: GET /open_api/v1.3/report/integrated/get/)`, note: 'The path is in TikTok\'s SDK; the metric names this platform would request were not confirmed in TikTok\'s reference.' },
};

class TikTokAdsAdapter extends AdPlatformAdapter {
  static get id() { return 'tiktok_ads'; }
  static get label() { return 'TikTok Ads'; }
  static get writeSwitch() { return 'TIKTOK_ALLOW_WRITES'; }
  static get endpointTable() { return ADS_ENDPOINTS; }

  static get channels() {
    return [
      { id: 'tiktok_ads_ad', label: 'TikTok ad in an existing ad group (created DISABLED)', asset_kinds: ['ad'], constraints: { adgroup_id: 'required', operation_status: 'DISABLE' } },
      { id: 'tiktok_ads_live_approval', label: 'Live approval: enable a disabled TikTok ad', asset_kinds: ['live_approval'], constraints: { approved_by: 'required' } },
    ];
  }

  static get auth() {
    return {
      kind: 'account_token',
      platform_prereq: {
        what: 'Create a developer app on TikTok API for Business, have the advertiser authorise it, and paste the advertiser access token and advertiser id on the Connections page. The advertiser sign-in URL is issued per app in the TikTok portal and was not confirmed here, so there is no Connect button for it.',
        where: 'business-api.tiktok.com, My Apps.',
        env: {},
      },
      endpoints: Object.assign({
        token: { method: 'POST', url: `${BIZ}/oauth2/access_token/`, verified: false, doc: `${SDK} (Oauth2AccessTokenBody: app_id, secret, auth_code)`, note: UNCONFIRMED },
      }, ADS_ENDPOINTS),
      endpoints_verified: false,
      scopes: [],
      default_scopes: [],
      sources: [
        `${SDK} — TikTok's own SDK: the paths /open_api/v1.3/ad/create/, /report/integrated/get/, /oauth2/access_token/ and the Access-Token header. Read 2026-10-04 through Context7.`,
        '[DATA REQUIRED BEFORE LAUNCH: TikTok API for Business reference (business-api.tiktok.com/portal/docs) — confirm operation_status "DISABLE" on ad creation, the status-update body and the report metric names before any TikTok Ads endpoint is marked verified.]',
      ],
    };
  }

  static requiredScopes() { return []; }

  advertiserId() { return String(this.credentials.advertiser_id || (this.ctx.connection && this.ctx.connection.config && this.ctx.connection.config.advertiser_id) || ''); }
  headers() { return { 'Access-Token': String(this.credentials.access_token || ''), 'Content-Type': 'application/json' }; }

  async validateCredentials() {
    if (!this.credentials.access_token) return { ok: false, note: 'No TikTok Ads access token on this workspace.' };
    return { ok: true, account: { id: this.advertiserId() }, note: 'Stored. Not verified live: no TikTok Ads endpoint is confirmed, so nothing was called.' };
  }

  map(asset, mapping) {
    const a = asset || {};
    const d = (mapping && mapping.defaults) || {};
    const channel = String((mapping && mapping.channel) || '');
    const missing = [];
    if (channel === 'tiktok_ads_live_approval') {
      if (!a.external_id) missing.push(this.gap('TikTok ad id to enable', 'live approval'));
      return { ok: missing.length === 0, payload: { external_id: String(a.external_id || ''), approved_by: String(a.approved_by || ''), advertiser_id: this.advertiserId() }, warnings: [], missing };
    }
    const adgroup = String(a.adgroup_id || d.adgroup_id || '');
    if (!adgroup) missing.push(this.gap('ad group id (budget and targeting are a spend decision this platform does not make)', 'TikTok ad'));
    const text = String(a.ad_text || a.primary_text || a.caption || '');
    if (!text) missing.push(this.gap('ad text', 'TikTok ad'));
    return {
      ok: missing.length === 0,
      payload: {
        advertiser_id: this.advertiserId(), adgroup_id: adgroup,
        ad_name: String(a.ad_name || a.headline || 'Lifecycle OS ad').slice(0, 100),
        ad_text: text, landing_page_url: String(a.landing_page_url || a.link || ''),
        video_id: String(a.video_id || ''), identity_id: String(a.identity_id || d.identity_id || ''), identity_type: String(a.identity_type || d.identity_type || ''),
        call_to_action: String(a.call_to_action || d.call_to_action || ''),
      },
      warnings: [],
      missing,
    };
  }

  validatePayload(channelId, p) {
    const errors = [];
    if (!TikTokAdsAdapter.channel(channelId)) errors.push(`Unknown TikTok Ads channel "${channelId}".`);
    if (!p || !p.advertiser_id) errors.push('The advertiser id is not set on this connection.');
    if (channelId === 'tiktok_ads_ad' && p && !p.adgroup_id) errors.push('An ad group id is required.');
    if (channelId === 'tiktok_ads_live_approval' && p && (!p.external_id || !p.approved_by)) errors.push('A live approval needs the ad id and the operator who approved it.');
    return { ok: errors.length === 0, errors, warnings: [] };
  }

  async dispatch(channelId, payload) {
    const v = this.validatePayload(channelId, payload);
    if (!v.ok) return { ok: false, sent: false, error: v.errors.join(' '), error_class: 'validation' };
    if (channelId === 'tiktok_ads_live_approval') return this.activate(payload);
    return this.createAd(payload);
  }

  /** Created DISABLED: a human enables it through the live-approval step. */
  async createAd(p) {
    const creative = { ad_name: p.ad_name, ad_text: p.ad_text, operation_status: 'DISABLE' };
    for (const k of ['landing_page_url', 'video_id', 'identity_id', 'identity_type', 'call_to_action']) if (p[k]) creative[k] = p[k];
    return this.callEndpoint('ad_create', {
      headers: this.headers(),
      body: { advertiser_id: p.advertiser_id, adgroup_id: p.adgroup_id, creatives: [creative] },
    });
  }

  async activate(spec) {
    const s = spec || {};
    if (!s.approved_by) return { ok: false, sent: false, error_class: 'validation', error: 'A live approval must carry the operator who approved it.' };
    return this.callEndpoint('ad_status_update', {
      headers: this.headers(),
      body: { advertiser_id: s.advertiser_id || this.advertiserId(), ad_ids: [String(s.external_id)], operation_status: 'ENABLE' },
    });
  }

  async readAdMetrics(range) {
    const r0 = range || {};
    return Object.assign({ ok: false }, await this.callEndpoint('report_integrated_get', {
      headers: this.headers(),
      query: { advertiser_id: this.advertiserId(), report_type: 'BASIC', data_level: 'AUCTION_AD', dimensions: JSON.stringify(['ad_id']), metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'ctr']), start_date: r0.since || '', end_date: r0.until || '' },
    }));
  }
}

module.exports = TikTokAdapter;
module.exports.TikTokAdapter = TikTokAdapter;
module.exports.TikTokAdsAdapter = TikTokAdsAdapter;
module.exports.ENDPOINTS = ENDPOINTS;
module.exports.ADS_ENDPOINTS = ADS_ENDPOINTS;
module.exports.DEFAULT_WEBHOOK_TOLERANCE_S = DEFAULT_WEBHOOK_TOLERANCE_S;
