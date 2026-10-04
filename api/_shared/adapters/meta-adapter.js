'use strict';
/**
 * adapters/meta-adapter.js — Meta: Graph API, Marketing API and the Ad Library.
 * ---------------------------------------------------------------------------
 * Covers three different things Meta happens to serve from one host, and they
 * have very different permission stories, so they are kept apart here:
 *
 *   ORGANIC PUBLISHING   Instagram and Facebook Page posts, via the two-step
 *                        container/publish flow. Endpoints already declared in
 *                        this repo by social-push-core.js.
 *   PAID                 Campaign -> ad set -> creative -> ad on the Marketing
 *                        API, plus the insights read ads-live-core.js already
 *                        performs.
 *   AD LIBRARY           A PUBLIC archive read. No ad account, no publish
 *                        permission - and a real limitation, stated below
 *                        rather than discovered later.
 *
 * ⚠️ AD LIBRARY SCOPE. The ads_archive endpoint does not return "every ad ever
 * run" outside the EU. For most countries it is limited to ads about social
 * issues, elections or politics, and access requires a confirmed identity on
 * the app. Under the EU DSA the archive is broader. This adapter therefore
 * reports what the API returned and, when a search comes back empty, says which
 * of the two situations it is in - it never presents "no political ads in this
 * country" as "this competitor runs no ads".
 *
 * PROVENANCE. graph.facebook.com/<ver>/ and act_<id>/insights are already
 * called by ads-live-core.js and ad-insights-core.js. The IG /media +
 * /media_publish and Page /photos shapes are already declared by
 * social-push-core.js. The OAuth dialog and token endpoints were read from
 * Meta's "Manually Build a Login Flow" documentation on 2026-08-18; see
 * `sources` on the auth block.
 *
 * THE SOCIAL GATEWAY (2026-10-04). Comments, replies, moderation, mentions,
 * media insights, Page feed posts, ad insights and the LIVE APPROVAL of a
 * paused ad go through ENDPOINTS below, each read on 2026-10-04 in Meta's own
 * documentation (developers.facebook.com, via the Context7 documentation index,
 * because the docs host itself is blocked from this build environment) and
 * named per entry. Every write among them is behind all three switches:
 * LIVE_CONNECTORS, the workspace's publishing toggle and META_ALLOW_WRITES.
 * ---------------------------------------------------------------------------
 */

const { AdPlatformAdapter } = require('./base-adapter.js');

// ad-insights-core.js already reads this env var with this default; reusing it
// keeps one version number across the Meta surface rather than two that drift.
const VER = String(process.env.META_GRAPH_VERSION || 'v25.0').trim();
const GRAPH = `https://graph.facebook.com/${VER}`;

const IG_DOCS = 'https://developers.facebook.com/documentation/instagram-platform';
const GRAPH_DOCS = 'https://developers.facebook.com/docs/graph-api/reference';

/**
 * The gateway's Meta calls. `verified: true` means the method, path and the
 * fields this adapter sends were read on the named page. Instagram via Facebook
 * Login is served from graph.facebook.com (the comments reference states the
 * host per login type), which is the host this repo already uses.
 */
const ENDPOINTS = {
  ig_comments_list: {
    method: 'GET', url: `${GRAPH}/{ig_media_id}/comments`, verified: true,
    doc: `${IG_DOCS}/comment-moderation (GET /<IG_MEDIA_ID>/comments; response fields id, text, timestamp)`,
    scopes: ['instagram_basic', 'instagram_manage_comments', 'pages_read_engagement'],
  },
  ig_comment_reply: {
    method: 'POST', url: `${GRAPH}/{ig_comment_id}/replies`, verified: true,
    doc: `${IG_DOCS}/comment-moderation (POST /<IG_COMMENT_ID>/replies, body: message)`,
    scopes: ['instagram_basic', 'instagram_manage_comments', 'pages_read_engagement'],
  },
  ig_comment_hide: {
    method: 'POST', url: `${GRAPH}/{ig_comment_id}`, verified: true,
    doc: `${IG_DOCS}/instagram-graph-api/reference/ig-comment (POST /<IG_COMMENT_ID>?hide=<BOOLEAN>)`,
    scopes: ['instagram_basic', 'instagram_manage_comments', 'pages_read_engagement'],
  },
  ig_tags: {
    method: 'GET', url: `${GRAPH}/{ig_user_id}/tags`, verified: true,
    doc: `${IG_DOCS}/instagram-api-with-facebook-login/mentions (GET /{ig-user-id}/tags: media the account is tagged in)`,
    scopes: ['instagram_basic', 'instagram_manage_comments', 'pages_read_engagement'],
  },
  ig_mentioned_comment: {
    method: 'GET', url: `${GRAPH}/{ig_user_id}`, verified: true,
    doc: `${IG_DOCS}/instagram-graph-api/reference/ig-user/mentioned_comment (fields=mentioned_comment.comment_id(<id>){timestamp,like_count,text,id})`,
    scopes: ['instagram_basic', 'instagram_manage_comments', 'pages_read_engagement'],
  },
  ig_media_insights: {
    method: 'GET', url: `${GRAPH}/{ig_media_id}/insights`, verified: true,
    doc: `${IG_DOCS}/insights (GET /<INSTAGRAM_MEDIA_ID>/insights?metric=...; reach, likes, comments and views are named there)`,
    scopes: ['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement'],
  },
  page_feed_post: {
    method: 'POST', url: `${GRAPH}/{page_id}/feed`, verified: true,
    doc: `${GRAPH_DOCS}/page/feed (POST /{page-id}/feed: message, link, published, scheduled_publish_time 10 minutes to 75 days ahead)`,
    scopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'],
  },
  page_object_comments: {
    method: 'GET', url: `${GRAPH}/{object_id}/comments`, verified: true,
    doc: `${GRAPH_DOCS}/object/comments and ${GRAPH_DOCS}/page-post/comments (GET /{page-post-id}/comments)`,
    scopes: ['pages_read_engagement', 'pages_read_user_content'],
  },
  page_comment_reply: {
    method: 'POST', url: `${GRAPH}/{comment_id}/comments`, verified: true,
    doc: `${GRAPH_DOCS}/object/comments (POST /{object-id}/comments, body: message; Page token, MODERATE task)`,
    scopes: ['pages_manage_engagement'],
  },
  page_comment_hide: {
    method: 'POST', url: `${GRAPH}/{comment_id}`, verified: true,
    doc: `${GRAPH_DOCS}/comment (Updating: POST /{comment_id}, is_hidden, Page comments only)`,
    scopes: ['pages_manage_engagement'],
  },
  ad_insights: {
    method: 'GET', url: `${GRAPH}/{act_id}/insights`, verified: true,
    doc: `${GRAPH_DOCS}/adaccount/insights (GET /act_{ad-account-id}/insights: fields, level, date_preset, time_range). Field names are the ones ad-insights-core.js already reads.`,
    scopes: ['ads_read'],
  },
  ad_activate: {
    method: 'POST', url: `${GRAPH}/{ad_id}`, verified: true,
    doc: `${GRAPH_DOCS}/adgroup (status enum ACTIVE, PAUSED, DELETED, ARCHIVED; "Other statuses can be used for update")`,
    scopes: ['ads_management'],
  },
};

/** Insight fields for the gateway's paid read: the ones this repo already requests. */
const AD_FIELDS = 'ad_id,ad_name,spend,impressions,clicks,ctr,purchase_roas,date_start,date_stop';
/** The media metrics named on the insights page. */
const IG_MEDIA_METRICS = 'reach,likes,comments,views';

class MetaAdapter extends AdPlatformAdapter {
  static get id() { return 'meta'; }
  static get label() { return 'Meta (Facebook, Instagram, Ads)'; }
  static get writeSwitch() { return 'META_ALLOW_WRITES'; }
  static get endpointTable() { return ENDPOINTS; }

  static get channels() {
    return [
      {
        id: 'instagram_feed',
        label: 'Instagram feed post',
        asset_kinds: ['social_post', 'image'],
        constraints: { caption_max: 2200, hashtags_max: 30, media: 'required', ratios: ['1:1', '4:5', '1.91:1'] },
      },
      {
        id: 'instagram_reel',
        label: 'Instagram Reel',
        asset_kinds: ['social_post', 'video'],
        constraints: { caption_max: 2200, media: 'video_required', ratio: '9:16', duration_max_s: 90 },
      },
      {
        id: 'facebook_page',
        label: 'Facebook Page post',
        asset_kinds: ['social_post', 'image'],
        constraints: { caption_max: 63206, media: 'optional' },
      },
      {
        id: 'meta_ad',
        label: 'Meta ad (campaign, ad set, creative, ad)',
        asset_kinds: ['ad', 'ad_set'],
        constraints: { primary_text_max: 125, headline_max: 40, description_max: 30, media: 'required' },
      },
      // The social gateway's channels (2026-10-04). Each is a write through the
      // queue and the three switches; a reply is a message to a real customer.
      {
        id: 'facebook_page_feed',
        label: 'Facebook Page feed post (text or link; draft or scheduled)',
        asset_kinds: ['social_post'],
        constraints: { message_or_link: 'required', scheduled_window: '10 minutes to 75 days ahead' },
      },
      { id: 'instagram_comment_reply', label: 'Reply to an Instagram comment', asset_kinds: ['comment_reply'], constraints: { message: 'required' } },
      { id: 'facebook_comment_reply', label: 'Reply to a Facebook Page comment', asset_kinds: ['comment_reply'], constraints: { message: 'required' } },
      { id: 'instagram_comment_moderation', label: 'Hide or unhide an Instagram comment', asset_kinds: ['comment_moderation'], constraints: { action: 'hide | unhide' } },
      { id: 'facebook_comment_moderation', label: 'Hide or unhide a Facebook Page comment', asset_kinds: ['comment_moderation'], constraints: { action: 'hide | unhide' } },
      { id: 'meta_live_approval', label: 'Live approval: set a paused Meta ad ACTIVE', asset_kinds: ['live_approval'], constraints: { approved_by: 'required' } },
    ];
  }

  static get auth() {
    return {
      kind: 'oauth',
      // The platform owner registers the app once; an operator cannot self-serve
      // this, which is why it is stated rather than assumed.
      platform_prereq: {
        what: 'Create a Meta app, add the Marketing API product, add the callback below as a valid OAuth redirect URI, and take ads_management through App Review to act on ad accounts the app does not own.',
        where: 'developers.facebook.com, App Dashboard.',
        env: {
          META_APP_ID: 'The app id. Used as client_id in the dialog.',
          META_APP_SECRET: 'The app secret. Used in the token exchange and to sign appsecret_proof.',
        },
      },
      endpoints: Object.assign({
        authorize: `https://www.facebook.com/${VER}/dialog/oauth`,
        token: `${GRAPH}/oauth/access_token`,
        inspect: `${GRAPH}/debug_token`,
        api_base: GRAPH,
        ad_library: `${GRAPH}/ads_archive`,
      }, ENDPOINTS),
      authorize_params: ['client_id', 'redirect_uri', 'state', 'scope', 'response_type=code'],
      // Comma or space separated in the dialog. Meta returns the GRANTED set,
      // which is what gets stored - a user can untick a permission on the
      // consent screen and the app is told about it only if it asks.
      scopes: [
        { value: 'ads_read', why: 'Read ad performance and campaign structure. Enough for reporting.' },
        { value: 'ads_management', why: 'Create and manage campaigns, ad sets, creatives and ads. Required to publish a paid asset.' },
        { value: 'pages_manage_posts', why: 'Publish to a Facebook Page.' },
        { value: 'pages_read_engagement', why: 'Read the Page a post will be published to.' },
        { value: 'instagram_basic', why: 'Resolve the Instagram business account behind the Page.' },
        { value: 'instagram_content_publish', why: 'Publish a container to Instagram.' },
        { value: 'business_management', why: 'Resolve which ad accounts and Pages the person actually administers.' },
        { value: 'instagram_manage_comments', why: 'Read, reply to and hide comments on the brand\'s Instagram media, and read @mentions.' },
        { value: 'instagram_manage_insights', why: 'Read reach, likes, comments and views on the brand\'s Instagram media.' },
        { value: 'pages_manage_engagement', why: 'Reply to and hide comments on the brand\'s Facebook Page.' },
        { value: 'pages_read_user_content', why: 'Read the comments people leave on the brand\'s Page posts.' },
        { value: 'pages_show_list', why: 'List the Pages the person manages; Meta requires it to publish to a Page feed.' },
      ],
      default_scopes: ['ads_read', 'pages_read_engagement', 'instagram_basic'],
      token_lifetime: {
        note: 'A short-lived user token comes back from the dialog. It is exchanged for a long-lived token (roughly 60 days) with grant_type=fb_exchange_token; there is no refresh_token grant. A System User token from Business Manager does not expire and is the right choice for unattended publishing.',
      },
      webhooks: {
        callback: '/api/brain?action=dispatch-webhook&provider=meta',
        verification: 'X-Hub-Signature-256, sha256= plus an HMAC-SHA256 of the RAW request bytes keyed with the app secret (META_APP_SECRET), compared in constant time. The receiver (platform-webhooks.js) reads the bytes that arrived through raw-body.js; it never verifies a re-serialisation of req.body, and refuses when the bytes are not available.',
        challenge: 'Meta verifies the callback URL once with a GET carrying hub.mode=subscribe, hub.verify_token and hub.challenge. The endpoint answers with the challenge as text only when the token equals META_WEBHOOK_VERIFY_TOKEN; unset or mismatched is a 403.',
        env: {
          META_WEBHOOK_VERIFY_TOKEN: 'The Verify Token entered on the app dashboard when the callback URL is registered. Unset means every verification request is refused.',
        },
        note: 'The subscription itself is configured on the app, not per workspace. A refused delivery is answered 200 with processed:false and a structured log line, because Meta retries non-200s and disables the subscription on persistent failure.',
      },
      sources: [
        'developers.facebook.com/docs/graph-api/webhooks/getting-started — the verification request (hub.mode / hub.verify_token / hub.challenge, answered with the challenge) and X-Hub-Signature-256 (sha256= + HMAC-SHA256 of the payload under the app secret). Written from the documented flow as this repo already implemented the signature half; the docs host could NOT be re-read on 2026-09-15, it is blocked from the build environment.',
        'developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow — dialog and token endpoints, read 2026-08-18 via search summaries.',
        'This repo already calls graph.facebook.com/<ver>/act_<id>/insights (ads-live-core.js) and the IG /media + /media_publish and Page /photos shapes (social-push-core.js).',
        'developers.facebook.com/docs/marketing-api — campaign/adset/adcreative/ad object names.',
        'Social gateway (2026-10-04): every entry of the endpoint table names the Meta documentation page it was read on, through the Context7 index of developers.facebook.com.',
      ],
    };
  }

  static requiredScopes(channelId, action) {
    if (action === 'read') return ['ads_read'];
    switch (channelId) {
      case 'instagram_feed':
      case 'instagram_reel': return ['instagram_basic', 'instagram_content_publish'];
      case 'facebook_page': return ['pages_manage_posts'];
      case 'facebook_page_feed': return ['pages_manage_posts', 'pages_read_engagement'];
      case 'instagram_comment_reply':
      case 'instagram_comment_moderation': return ['instagram_manage_comments'];
      case 'facebook_comment_reply':
      case 'facebook_comment_moderation': return ['pages_manage_engagement'];
      case 'meta_ad':
      case 'meta_live_approval': return ['ads_management'];
      default: return [];
    }
  }

  /** The connection's non-secret settings (Page id, IG account id, ad account). */
  cfg() { return (this.ctx.connection && this.ctx.connection.config && typeof this.ctx.connection.config === 'object') ? this.ctx.connection.config : {}; }

  /* ── credentials ────────────────────────────────────────────────────────── */

  token() { return this.credentials.access_token || this.credentials.api_key || ''; }

  /**
   * Meta accepts appsecret_proof (an HMAC of the token under the app secret) and
   * REQUIRES it when the app has "Require App Secret" on. Sending it always is
   * strictly safer and costs nothing.
   */
  proof() {
    const secret = String(process.env.META_APP_SECRET || '').trim();
    const tok = this.token();
    if (!secret || !tok) return '';
    return require('crypto').createHmac('sha256', secret).update(tok).digest('hex');
  }

  authQuery(extra) {
    const p = new URLSearchParams(extra || {});
    p.set('access_token', this.token());
    const pr = this.proof();
    if (pr) p.set('appsecret_proof', pr);
    return p;
  }

  async validateCredentials() {
    if (!this.token()) return { ok: false, note: 'No Meta access token on this workspace.' };
    const r = await this.read(`${GRAPH}/me?${this.authQuery({ fields: 'id,name' }).toString()}`);
    if (!r.ok) return { ok: false, note: r.error || 'Meta rejected the token.' };

    // debug_token is what actually reports the GRANTED scopes and the expiry.
    // Asking for them is the difference between "we have a token" and "we may
    // do the thing we are about to try".
    let scopes = [];
    let expiresAt = null;
    const dbg = await this.read(`${GRAPH}/debug_token?${new URLSearchParams({
      input_token: this.token(),
      access_token: `${process.env.META_APP_ID || ''}|${process.env.META_APP_SECRET || ''}`,
    }).toString()}`);
    if (dbg.ok && dbg.data && dbg.data.data) {
      scopes = Array.isArray(dbg.data.data.scopes) ? dbg.data.data.scopes : [];
      const exp = Number(dbg.data.data.expires_at || 0);
      if (exp > 0) expiresAt = new Date(exp * 1000).toISOString();
    }
    return { ok: true, account: r.data, scopes, expires_at: expiresAt };
  }

  /**
   * Meta has no refresh_token grant. The long-lived exchange is the nearest
   * equivalent and it needs the CURRENT token, so it works only while the token
   * is still valid - it extends, it does not resurrect. Said plainly so nobody
   * builds a recovery path on top of it that cannot work.
   */
  async refreshCredentials() {
    const appId = String(process.env.META_APP_ID || '').trim();
    const appSecret = String(process.env.META_APP_SECRET || '').trim();
    if (!appId || !appSecret) return { ok: false, supported: true, note: 'META_APP_ID and META_APP_SECRET are needed to extend a Meta token.' };
    if (!this.token()) return { ok: false, supported: true, note: 'There is no current token to extend.' };

    const r = await this.read(`${GRAPH}/oauth/access_token?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: this.token(),
    }).toString()}`);
    if (!r.ok || !r.data || !r.data.access_token) {
      return { ok: false, supported: true, note: r.error || 'Meta did not return an extended token. Once a token has expired it cannot be extended; the operator has to sign in again.' };
    }
    const secs = Number(r.data.expires_in || 0);
    return {
      ok: true,
      supported: true,
      credentials: { access_token: r.data.access_token },
      expires_at: secs > 0 ? new Date(Date.now() + secs * 1000).toISOString() : null,
    };
  }

  /* ── mapping ────────────────────────────────────────────────────────────── */

  map(asset, mapping) {
    const a = asset || {};
    const m = mapping || {};
    const f = m.field_map || {};
    const d = m.defaults || {};
    const warnings = [];
    const missing = [];
    if (GATEWAY_CHANNELS.has(String(m.channel || ''))) return this.mapGateway(String(m.channel), a, d);

    const pick = (target, fallback) => {
      const src = f[target];
      const v = src ? valueAt(a, src) : fallback;
      return v == null || v === '' ? (d[target] != null ? d[target] : '') : v;
    };

    const caption = String(pick('caption', a.caption || (a.copy && a.copy.caption) || '') || '');
    const image = String(pick('image_url', a.image_url || (a.media && a.media.image_url) || '') || '');
    const video = String(pick('video_url', a.video_url || (a.media && a.media.video_url) || '') || '');
    const link = String(pick('link', a.link || a.url || '') || '');

    if (!caption) missing.push(this.gap('caption', 'Meta post'));
    if (!image && !video) missing.push(this.gap('image or video', 'Meta post'));

    const tags = Array.isArray(a.hashtags) ? a.hashtags : [];
    if (tags.length > 30) warnings.push('Instagram counts more than 30 hashtags as spam; the extras are dropped.');

    const body = caption + (tags.length ? '\n\n' + tags.slice(0, 30).join(' ') : '');
    if (body.length > 2200) warnings.push(`Caption is ${body.length} characters; Instagram truncates at 2200.`);

    return {
      ok: missing.length === 0,
      payload: {
        caption: body,
        image_url: image,
        video_url: video,
        link,
        ig_user_id: String(d.ig_user_id || this.cfg().ig_user_id || this.credentials.ig_user_id || ''),
        page_id: String(d.page_id || this.cfg().page_id || this.credentials.page_id || ''),
        ad_account_id: String(d.ad_account_id || this.cfg().ad_account_id || this.credentials.account_id || ''),
        headline: String(pick('headline', a.headline || '') || ''),
        description: String(pick('description', a.description || '') || ''),
      },
      warnings,
      missing,
    };
  }

  /**
   * The gateway channels' payloads. Pure, like map(): the same asset always
   * yields the same payload, so the idempotency key derived from it is stable.
   * A missing fact is a marker, never a placeholder.
   */
  mapGateway(channel, a, d) {
    const missing = [];
    const warnings = [];
    if (channel === 'facebook_page_feed') {
      const message = String(a.message || a.caption || (a.copy && a.copy.caption) || '');
      const link = String(a.link || a.url || '');
      const when = a.scheduled_publish_time || a.scheduled_for || '';
      const at = when ? (Number.isFinite(Number(when)) ? Number(when) : Math.floor(Date.parse(when) / 1000)) : null;
      if (!message && !link) missing.push(this.gap('post message or link', 'Facebook Page post'));
      return {
        ok: missing.length === 0,
        payload: {
          page_id: String(d.page_id || this.cfg().page_id || this.credentials.page_id || ''),
          message,
          link,
          // A scheduled post is created unpublished with its time; an asset may
          // also ask for an unpublished (draft) post outright. Never inferred.
          scheduled_publish_time: Number.isFinite(at) && at > 0 ? at : null,
          published: Number.isFinite(at) && at > 0 ? false : a.published !== false,
        },
        warnings,
        missing,
      };
    }
    if (/_comment_reply$/.test(channel)) {
      const commentId = String(a.comment_id || '');
      const message = String(a.message || a.reply || '');
      if (!commentId) missing.push(this.gap('comment id', 'comment reply'));
      if (!message) missing.push(this.gap('reply text', 'comment reply'));
      return { ok: missing.length === 0, payload: { comment_id: commentId, message }, warnings, missing };
    }
    if (/_comment_moderation$/.test(channel)) {
      const commentId = String(a.comment_id || '');
      const action = String(a.action || '').toLowerCase();
      if (!commentId) missing.push(this.gap('comment id', 'comment moderation'));
      if (action !== 'hide' && action !== 'unhide') missing.push(this.gap('moderation action (hide or unhide)', 'comment moderation'));
      return { ok: missing.length === 0, payload: { comment_id: commentId, action }, warnings, missing };
    }
    // meta_live_approval
    const externalId = String(a.external_id || '');
    if (!externalId) missing.push(this.gap('ad id to activate', 'live approval'));
    return {
      ok: missing.length === 0,
      payload: { external_id: externalId, object: 'ad', approved_by: String(a.approved_by || ''), source_job_id: String(a.source_job_id || ''), note: String(a.note || '').slice(0, 300) },
      warnings,
      missing,
    };
  }

  validateGateway(channelId, p) {
    const errors = [];
    if (channelId === 'facebook_page_feed') {
      if (!p.page_id) errors.push('The Facebook Page id is not set on this connection.');
      if (!p.message && !p.link) errors.push('A Page post needs a message or a link (Meta requires one of them).');
      if (p.scheduled_publish_time != null) {
        const ahead = Number(p.scheduled_publish_time) * 1000 - Date.now();
        // Meta's own window for scheduled_publish_time, from the feed reference.
        if (!(ahead >= 10 * 60 * 1000 && ahead <= 75 * 24 * 3600 * 1000)) errors.push('scheduled_publish_time must be between 10 minutes and 75 days from now (Meta\'s documented window).');
      }
    } else if (/_comment_reply$/.test(channelId)) {
      if (!p.comment_id) errors.push('A comment id is required.');
      if (!p.message) errors.push('Reply text is required.');
    } else if (/_comment_moderation$/.test(channelId)) {
      if (!p.comment_id) errors.push('A comment id is required.');
      if (p.action !== 'hide' && p.action !== 'unhide') errors.push('The moderation action must be hide or unhide.');
    } else if (channelId === 'meta_live_approval') {
      if (!p.external_id) errors.push('The id of the paused ad to activate is required.');
      // Live approval is recorded with the operator who gave it. A job without
      // one did not come through the approval step and is refused.
      if (!p.approved_by) errors.push('A live approval must carry the operator who approved it.');
    }
    return { ok: errors.length === 0, errors, warnings: [] };
  }

  validatePayload(channelId, payload) {
    const p = payload || {};
    if (GATEWAY_CHANNELS.has(channelId)) return this.validateGateway(channelId, p);
    const errors = [];
    const warnings = [];
    const ch = MetaAdapter.channel(channelId);
    if (!ch) errors.push(`Unknown Meta channel "${channelId}".`);

    if (!p.caption) errors.push('A caption is required.');
    if (channelId === 'instagram_feed' && !p.image_url) errors.push('An image URL is required for an Instagram feed post.');
    if (channelId === 'instagram_reel' && !p.video_url) errors.push('A video URL is required for a Reel.');
    if (channelId && channelId.startsWith('instagram') && !p.ig_user_id) errors.push('The Instagram business account id is not set on this connection.');
    if (channelId === 'facebook_page' && !p.page_id) errors.push('The Facebook Page id is not set on this connection.');
    if (channelId === 'meta_ad') {
      if (!p.ad_account_id) errors.push('The ad account id is not set on this connection.');
      if (p.headline && p.headline.length > 40) warnings.push(`Headline is ${p.headline.length} characters; Meta truncates around 40.`);
      if (p.caption.length > 125) warnings.push(`Primary text is ${p.caption.length} characters; Meta truncates around 125 in most placements.`);
    }
    // Meta fetches media by URL, so a URL only this deployment can see fails on
    // their side with a generic error. Catch it here where the message is useful.
    for (const [k, v] of [['image_url', p.image_url], ['video_url', p.video_url]]) {
      if (v && !/^https:\/\//i.test(v)) errors.push(`${k} must be a public https URL that Meta can fetch; got "${String(v).slice(0, 60)}".`);
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  /* ── dispatch ───────────────────────────────────────────────────────────── */

  async dispatch(channelId, payload) {
    const v = this.validatePayload(channelId, payload);
    if (!v.ok) return { ok: false, sent: false, error: v.errors.join(' '), error_class: 'validation' };

    switch (channelId) {
      case 'instagram_feed':
      case 'instagram_reel': return this.publishInstagram(channelId, payload);
      case 'facebook_page': return this.publishPage(payload);
      case 'meta_ad': return this.createAd(payload);
      case 'facebook_page_feed': return this.publishPageFeed(payload);
      case 'instagram_comment_reply': return this.replyToComment(Object.assign({ surface: 'instagram' }, payload));
      case 'facebook_comment_reply': return this.replyToComment(Object.assign({ surface: 'facebook' }, payload));
      case 'instagram_comment_moderation': return this.moderateComment(Object.assign({ surface: 'instagram' }, payload));
      case 'facebook_comment_moderation': return this.moderateComment(Object.assign({ surface: 'facebook' }, payload));
      case 'meta_live_approval': return this.activate(payload);
      default: return { ok: false, error: `Unknown Meta channel "${channelId}".`, error_class: 'validation' };
    }
  }

  /* ── the social gateway ─────────────────────────────────────────────────── */

  /** A Page feed post: published now, scheduled, or created unpublished. */
  async publishPageFeed(p) {
    const body = { published: p.published !== false };
    if (p.message) body.message = p.message;
    if (p.link) body.link = p.link;
    if (p.scheduled_publish_time) { body.scheduled_publish_time = p.scheduled_publish_time; body.published = false; }
    const r = await this.callEndpoint('page_feed_post', { params: { page_id: p.page_id }, query: this.authParams(), body });
    if (!r.ok) return r;
    return {
      ok: true, sent: true, external_id: (r.raw && r.raw.id) || '',
      status: body.scheduled_publish_time ? 'scheduled' : (body.published ? 'published' : 'unpublished'),
      raw: r.raw,
    };
  }

  async replyToComment(spec) {
    const s = spec || {};
    const ig = s.surface !== 'facebook';
    const r = ig
      ? await this.callEndpoint('ig_comment_reply', { params: { ig_comment_id: s.comment_id }, query: this.authParams(), body: { message: s.message } })
      : await this.callEndpoint('page_comment_reply', { params: { comment_id: s.comment_id }, query: this.authParams(), body: { message: s.message } });
    return r.ok ? { ok: true, sent: true, external_id: (r.raw && r.raw.id) || '', status: 'replied', raw: r.raw } : r;
  }

  async moderateComment(spec) {
    const s = spec || {};
    const hide = s.action === 'hide';
    const r = s.surface !== 'facebook'
      ? await this.callEndpoint('ig_comment_hide', { params: { ig_comment_id: s.comment_id }, query: Object.assign({ hide: String(hide) }, this.authParams()) })
      : await this.callEndpoint('page_comment_hide', { params: { comment_id: s.comment_id }, query: this.authParams(), body: { is_hidden: hide } });
    return r.ok ? { ok: true, sent: true, external_id: String(s.comment_id), status: hide ? 'hidden' : 'unhidden', raw: r.raw } : r;
  }

  /** LIVE APPROVAL: a PAUSED ad becomes ACTIVE. Reached only through the queue. */
  async activate(spec) {
    const s = spec || {};
    if (!s.approved_by) return { ok: false, sent: false, error_class: 'validation', error: 'A live approval must carry the operator who approved it.' };
    const r = await this.callEndpoint('ad_activate', { params: { ad_id: s.external_id }, query: this.authParams(), body: { status: 'ACTIVE' } });
    return r.ok ? { ok: true, sent: true, external_id: String(s.external_id), status: 'active', raw: r.raw } : r;
  }

  async listComments(ref) {
    const r0 = ref || {};
    const ig = r0.surface !== 'facebook';
    const r = ig
      ? await this.callEndpoint('ig_comments_list', { params: { ig_media_id: r0.object_id }, query: Object.assign({ fields: 'id,text,timestamp' }, this.authParams()) })
      : await this.callEndpoint('page_object_comments', { params: { object_id: r0.object_id }, query: this.authParams() });
    if (!r.ok) return Object.assign({ ok: false }, r);
    const rows = (r.data && r.data.data) || [];
    return {
      ok: true,
      comments: rows.map((c) => ({ id: c.id, text: c.text != null ? c.text : (c.message != null ? c.message : null), at: c.timestamp || c.created_time || null, object_id: r0.object_id, surface: ig ? 'instagram' : 'facebook' })),
    };
  }

  /**
   * @mentions. Two documented reads: the media the account is TAGGED in, and -
   * for a comment id a mentions webhook delivered - that comment's text.
   */
  async listMentions(ref) {
    const r0 = ref || {};
    const igUser = String(r0.ig_user_id || this.cfg().ig_user_id || this.credentials.ig_user_id || '');
    if (r0.comment_id) {
      const r = await this.callEndpoint('ig_mentioned_comment', {
        params: { ig_user_id: igUser },
        query: Object.assign({ fields: `mentioned_comment.comment_id(${String(r0.comment_id).replace(/[^0-9A-Za-z_]/g, '')}){timestamp,like_count,text,id}` }, this.authParams()),
      });
      if (!r.ok) return Object.assign({ ok: false }, r);
      const mc = r.data && r.data.mentioned_comment;
      return { ok: true, mentions: mc ? [{ kind: 'comment', id: mc.id, text: mc.text != null ? mc.text : null, at: mc.timestamp || null }] : [] };
    }
    const r = await this.callEndpoint('ig_tags', { params: { ig_user_id: igUser }, query: this.authParams() });
    if (!r.ok) return Object.assign({ ok: false }, r);
    return { ok: true, mentions: ((r.data && r.data.data) || []).map((m) => ({ kind: 'tagged_media', id: m.id })) };
  }

  /**
   * Organic metrics for Instagram media. A metric the platform did not return
   * is ABSENT, never zero: Meta answers an empty set when insights are not yet
   * available, and that is "not known", not "nobody saw it".
   */
  async readPostMetrics(refs) {
    const r0 = refs || {};
    if (r0.surface === 'facebook') return { ok: false, supported: false, note: 'Facebook Page post insights were not wired in this platform: only Instagram media insights were read in Meta\'s documentation for it.' };
    const ids = (Array.isArray(r0.ids) ? r0.ids : [r0.id]).filter(Boolean).slice(0, 25);
    if (!ids.length) return { ok: false, note: 'No Instagram media ids were given.' };
    const metrics = [];
    for (const id of ids) {
      const r = await this.callEndpoint('ig_media_insights', { params: { ig_media_id: id }, query: Object.assign({ metric: IG_MEDIA_METRICS }, this.authParams()) });
      if (!r.ok) return Object.assign({ ok: false }, r, { partial: metrics });
      const values = {};
      for (const row of (r.data && r.data.data) || []) {
        const v = row.total_value && row.total_value.value != null ? row.total_value.value
          : (Array.isArray(row.values) && row.values[0] && row.values[0].value != null ? row.values[0].value : null);
        if (v != null && Number.isFinite(Number(v))) values[row.name] = Number(v);
      }
      metrics.push({ external_id: String(id), kind: 'organic', surface: 'instagram', values });
    }
    return { ok: true, metrics };
  }

  /**
   * Paid performance per ad. ROAS is Meta's own purchase_roas when Meta
   * returned one, and null otherwise - never computed from a guess at revenue.
   */
  async readAdMetrics(range) {
    const r0 = range || {};
    const acct = this.actPath(r0.ad_account_id || this.cfg().ad_account_id || this.credentials.account_id || '');
    if (acct === 'act_') return { ok: false, note: this.gap('ad account id', 'Meta ad metrics') };
    const query = Object.assign({ level: 'ad', fields: AD_FIELDS }, this.authParams());
    if (r0.since && r0.until) query.time_range = JSON.stringify({ since: r0.since, until: r0.until });
    else query.date_preset = r0.date_preset || 'last_30d';
    const r = await this.callEndpoint('ad_insights', { params: { act_id: acct }, query });
    if (!r.ok) return Object.assign({ ok: false }, r);
    return {
      ok: true,
      rows: ((r.data && r.data.data) || []).map((x) => {
        const roas = Array.isArray(x.purchase_roas) && x.purchase_roas.length === 1 && Number.isFinite(Number(x.purchase_roas[0].value))
          ? Number(x.purchase_roas[0].value) : null;
        return {
          external_id: String(x.ad_id || ''),
          name: x.ad_name || '',
          kind: 'paid',
          values: dropNulls({
            spend: num(x.spend), impressions: num(x.impressions), clicks: num(x.clicks),
            ctr: num(x.ctr),                        // Meta reports ctr as a percentage
            roas,
          }),
          period: { start: x.date_start || null, stop: x.date_stop || null },
        };
      }),
    };
  }

  /** access_token (+ appsecret_proof) as a plain object for callEndpoint's query. */
  authParams() {
    const out = { access_token: this.token() };
    const pr = this.proof();
    if (pr) out.appsecret_proof = pr;
    return out;
  }

  /* ── webhooks: who, and what ────────────────────────────────────────────── */

  webhookAccountId(event) {
    const e = event || {};
    return (Array.isArray(e.entry) && e.entry[0] && e.entry[0].id) ? String(e.entry[0].id) : null;
  }

  webhookItems(event) {
    const e = event || {};
    const out = [];
    for (const entry of Array.isArray(e.entry) ? e.entry : []) {
      for (const c of Array.isArray(entry.changes) ? entry.changes : []) {
        const v = c.value || {};
        const field = String(c.field || '');
        const kind = field === 'mentions' ? 'mention'
          : field === 'comments' ? 'comment'
            : field === 'feed' && v.item === 'comment' ? 'comment'
              : 'other';
        out.push({
          kind,
          field,
          surface: e.object === 'instagram' ? 'instagram' : e.object === 'page' ? 'facebook' : String(e.object || ''),
          account_id: entry.id != null ? String(entry.id) : null,
          object_id: String(v.comment_id || v.id || v.media_id || v.post_id || '') || null,
          parent_id: String((v.media && v.media.id) || v.media_id || v.post_id || '') || null,
          text: v.text != null ? String(v.text).slice(0, 2000) : (v.message != null ? String(v.message).slice(0, 2000) : null),
        });
      }
    }
    return out;
  }

  /**
   * Instagram is two calls: build a container, then publish it. They are NOT
   * equivalent to one call that might half-succeed - a container that is never
   * published is invisible and harmless, so the container id is returned on a
   * partial failure and a retry can resume from it instead of creating a second
   * container (which would be a duplicate post).
   */
  async publishInstagram(channelId, p) {
    const isReel = channelId === 'instagram_reel';
    const body = isReel
      ? { media_type: 'REELS', video_url: p.video_url, caption: p.caption }
      : { image_url: p.image_url, caption: p.caption };

    const created = p.container_id
      ? { ok: true, raw: { id: p.container_id }, sent: false }
      : await this.send(`${GRAPH}/${encodeURIComponent(p.ig_user_id)}/media?${this.authQuery().toString()}`, { body });

    if (!created.ok) return created;
    const containerId = created.raw && created.raw.id;
    if (!containerId) return { ok: false, sent: true, error: 'Meta accepted the container call but returned no id.', error_class: 'transient' };

    const published = await this.send(
      `${GRAPH}/${encodeURIComponent(p.ig_user_id)}/media_publish?${this.authQuery().toString()}`,
      { body: { creation_id: containerId } },
    );
    if (!published.ok) {
      return Object.assign({}, published, {
        // Hand the container id back so the retry resumes rather than duplicates.
        resume: { container_id: containerId },
        error: `${published.error} (container ${containerId} was created and not published; a retry will resume from it)`,
      });
    }
    return { ok: true, sent: true, external_id: (published.raw && published.raw.id) || containerId, status: 'published', raw: published.raw };
  }

  async publishPage(p) {
    const r = await this.send(`${GRAPH}/${encodeURIComponent(p.page_id)}/photos?${this.authQuery().toString()}`, {
      body: p.image_url ? { url: p.image_url, message: p.caption } : { message: p.caption },
    });
    return r.ok ? { ok: true, sent: true, external_id: (r.raw && (r.raw.post_id || r.raw.id)) || '', status: 'published', raw: r.raw } : r;
  }

  /* ── paid ───────────────────────────────────────────────────────────────── */

  actPath(id) { const s = String(id || ''); return s.startsWith('act_') ? s : `act_${s}`; }

  async listAdAccounts() {
    if (!this.token()) return { ok: false, note: 'No Meta access token on this workspace.' };
    const r = await this.read(`${GRAPH}/me/adaccounts?${this.authQuery({ fields: 'id,name,account_status,currency' }).toString()}`);
    if (!r.ok) return { ok: false, note: r.error };
    return { ok: true, accounts: ((r.data && r.data.data) || []).map((x) => ({ id: x.id, name: x.name, status: x.account_status, currency: x.currency })) };
  }

  async createCampaign(spec) {
    const s = spec || {};
    return this.send(`${GRAPH}/${this.actPath(s.ad_account_id)}/campaigns?${this.authQuery().toString()}`, {
      body: {
        name: s.name,
        objective: s.objective || 'OUTCOME_TRAFFIC',
        // PAUSED on purpose: this platform creates the structure, a human turns
        // on the spend. Nothing here should be able to start charging a card.
        status: 'PAUSED',
        special_ad_categories: Array.isArray(s.special_ad_categories) ? s.special_ad_categories : [],
      },
    });
  }

  async createAdSet(spec) {
    const s = spec || {};
    return this.send(`${GRAPH}/${this.actPath(s.ad_account_id)}/adsets?${this.authQuery().toString()}`, {
      body: {
        name: s.name,
        campaign_id: s.campaign_id,
        daily_budget: s.daily_budget,
        billing_event: s.billing_event || 'IMPRESSIONS',
        optimization_goal: s.optimization_goal || 'LINK_CLICKS',
        targeting: s.targeting,
        status: 'PAUSED',
      },
    });
  }

  /**
   * A creative and then an ad. Split so the creative id can be reused across
   * ads, which is what Meta expects and what stops a retry re-uploading media.
   */
  async createAd(p) {
    const acct = this.actPath(p.ad_account_id);
    const creative = await this.send(`${GRAPH}/${acct}/adcreatives?${this.authQuery().toString()}`, {
      body: {
        name: (p.headline || p.caption || 'creative').slice(0, 80),
        object_story_spec: {
          page_id: p.page_id || undefined,
          link_data: {
            message: p.caption,
            link: p.link || undefined,
            name: p.headline || undefined,
            description: p.description || undefined,
            picture: p.image_url || undefined,
          },
        },
      },
    });
    if (!creative.ok) return creative;
    const creativeId = creative.raw && creative.raw.id;
    if (!creativeId) return { ok: false, sent: true, error: 'Meta returned no creative id.', error_class: 'transient' };

    if (!p.ad_set_id) {
      // An ad needs an ad set. Rather than inventing a budget and a targeting
      // spec (both are money decisions), return the creative and say what is
      // missing.
      return {
        ok: true,
        sent: true,
        external_id: creativeId,
        status: 'creative_only',
        raw: creative.raw,
        note: this.gap('ad set id, daily budget and targeting', 'Meta ad') + ' The creative was created and is not serving. Attach it to an ad set to complete the ad.',
      };
    }

    const ad = await this.send(`${GRAPH}/${acct}/ads?${this.authQuery().toString()}`, {
      body: { name: (p.headline || 'ad').slice(0, 80), adset_id: p.ad_set_id, creative: { creative_id: creativeId }, status: 'PAUSED' },
    });
    return ad.ok
      ? { ok: true, sent: true, external_id: (ad.raw && ad.raw.id) || creativeId, status: 'paused', raw: ad.raw }
      : ad;
  }

  /* ── ad library ─────────────────────────────────────────────────────────── */

  /**
   * A read of the PUBLIC archive. See the limitation at the top of this file:
   * outside the EU this is political and issue advertising only, so an empty
   * result is reported as "the archive returned nothing for this query", never
   * as "this advertiser runs no ads".
   */
  async searchAdLibrary(query) {
    const q = query || {};
    if (!this.token()) {
      return { ok: false, note: 'The Ad Library API needs an app access token and an identity-confirmed app. Without one this returns nothing rather than guessing.' };
    }
    const params = this.authQuery({
      search_terms: q.terms || '',
      ad_reached_countries: JSON.stringify(q.countries && q.countries.length ? q.countries : ['US']),
      ad_active_status: q.status || 'ALL',
      limit: String(Math.min(Number(q.limit) || 25, 100)),
      fields: 'id,ad_creation_time,ad_delivery_start_time,ad_snapshot_url,page_name,publisher_platforms',
    });
    if (q.page_ids && q.page_ids.length) params.set('search_page_ids', JSON.stringify(q.page_ids));

    const r = await this.read(`${GRAPH}/ads_archive?${params.toString()}`);
    if (!r.ok) {
      return {
        ok: false,
        note: /(#10|permission|identity)/i.test(String(r.error || ''))
          ? 'Meta refused the Ad Library read. This endpoint needs a confirmed identity on the app; that is an account step, not a code change.'
          : r.error,
      };
    }
    const ads = (r.data && r.data.data) || [];
    return {
      ok: true,
      ads,
      source: 'Meta Ad Library API (ads_archive)',
      coverage_note: ads.length === 0
        ? 'The archive returned no rows for this query. Outside the EU the archive is limited to ads about social issues, elections and politics, so this is not evidence that the advertiser runs no ads.'
        : 'Outside the EU the archive covers social issue, electoral and political ads only.',
    };
  }

  async fetchStatus(externalId) {
    if (!externalId) return { ok: false, detail: { note: 'no id' } };
    const r = await this.read(`${GRAPH}/${encodeURIComponent(externalId)}?${this.authQuery({ fields: 'id,status,effective_status' }).toString()}`);
    return r.ok
      ? { ok: true, status: (r.data && (r.data.effective_status || r.data.status)) || 'unknown', detail: r.data }
      : { ok: false, detail: { error: r.error } };
  }

  /**
   * X-Hub-Signature-256: `sha256=` + HMAC-SHA256 of the RAW body, keyed with
   * the app secret. `rawBody` must be the bytes that arrived (a Buffer, or the
   * string decoded from them, as raw-body.js returns). An object here is
   * req.body, and there is no signature to check against a re-serialisation of
   * it, so it is refused rather than stringified. Fails closed with no secret.
   */
  verifyWebhook(headers, rawBody) {
    const refuse = (reason, note) => ({ verified: false, reason, note });
    const secret = String(process.env.META_APP_SECRET || '').trim();
    if (!secret) return refuse('secret_missing', 'META_APP_SECRET is not set, so no Meta webhook can be verified. Accepting a delivery unverified is not offered: set the app secret first.');
    if (rawBody == null || !(Buffer.isBuffer(rawBody) || typeof rawBody === 'string')) {
      return refuse('raw_body_unavailable', 'The request body was not available as the bytes that arrived, and a signature over re-serialised JSON is not the signature Meta computed. Nothing was verified.');
    }
    const get = (k) => (headers && (typeof headers.get === 'function' ? headers.get(k) : headers[k])) || '';
    const sig = String(get('x-hub-signature-256') || get('X-Hub-Signature-256') || '');
    if (!sig.startsWith('sha256=')) return refuse('signature_header_missing', 'No X-Hub-Signature-256 header carrying a sha256= signature on the request.');

    const crypto = require('crypto');
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    // Length check first: timingSafeEqual throws on a length mismatch, and the
    // throw would itself be a timing signal.
    const verified = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!verified) return refuse('signature_mismatch', 'X-Hub-Signature-256 did not match the HMAC-SHA256 of the raw body under META_APP_SECRET.');
    let event = null;
    try { event = JSON.parse(body.toString('utf8')); } catch (_) { /* keep null */ }
    return { verified: true, note: 'X-Hub-Signature-256 verified: HMAC-SHA256 over the raw body matched.', event };
  }

  /**
   * Meta's verification request, sent once when the callback URL is
   * registered: GET ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<n>.
   * The endpoint must answer with the challenge, and only when the token is
   * the one the operator entered on the app dashboard (META_WEBHOOK_VERIFY_TOKEN).
   * Unset means every verification request is refused: a token nobody chose
   * is not a token anybody can be checked against.
   */
  verifyChallenge(query) {
    const q = query || {};
    const refuse = (reason, note) => ({ ok: false, reason, note });
    const token = String(process.env.META_WEBHOOK_VERIFY_TOKEN || '').trim();
    if (!token) return refuse('verify_token_missing', 'META_WEBHOOK_VERIFY_TOKEN is not set, so no verification request can be answered. Set it to the Verify Token entered on the Meta app dashboard.');
    if (String(q['hub.mode'] || '') !== 'subscribe') return refuse('hub_mode_not_subscribe', 'hub.mode is not "subscribe", so this is not a verification request.');
    const crypto = require('crypto');
    const sent = Buffer.from(String(q['hub.verify_token'] || ''), 'utf8');
    const want = Buffer.from(token, 'utf8');
    if (!(sent.length === want.length && crypto.timingSafeEqual(sent, want))) return refuse('verify_token_mismatch', 'hub.verify_token does not match META_WEBHOOK_VERIFY_TOKEN.');
    const challenge = q['hub.challenge'];
    if (challenge == null || String(challenge) === '') return refuse('challenge_missing', 'No hub.challenge to answer with.');
    return { ok: true, challenge: String(challenge) };
  }
}

/** Read `a.b.c` out of an object without throwing on a missing branch. */
function valueAt(obj, path) {
  return String(path || '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** The channels the social gateway added; their payloads are not post-shaped. */
const GATEWAY_CHANNELS = new Set([
  'facebook_page_feed', 'instagram_comment_reply', 'facebook_comment_reply',
  'instagram_comment_moderation', 'facebook_comment_moderation', 'meta_live_approval',
]);

/** A platform number, or null when it did not send one. Never a 0 for "absent". */
function num(v) { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function dropNulls(o) { const out = {}; for (const k of Object.keys(o)) if (o[k] != null) out[k] = o[k]; return out; }

module.exports = MetaAdapter;
module.exports.valueAt = valueAt;
module.exports.ENDPOINTS = ENDPOINTS;
module.exports.GATEWAY_CHANNELS = GATEWAY_CHANNELS;
