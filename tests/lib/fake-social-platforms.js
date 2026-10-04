'use strict';
/**
 * tests/lib/fake-social-platforms.js — Meta, TikTok, Pinterest and YouTube, as
 * far as the social gateway calls them, and not one endpoint further.
 * ---------------------------------------------------------------------------
 * Routed onto the FakeSupabase network seam (db.route). Each platform answers
 * EXACTLY the documented endpoints the adapters use - method and path - and
 * each host ends in a catch-all that THROWS, so a call to an endpoint nobody
 * documented (or one an adapter marks unverified and still sent) fails the
 * test loudly instead of being answered by a default.
 *
 * Every handler checks the request the way the platform would before it
 * answers: the token call's form fields and its client authentication, the
 * bearer on an API call, the required body fields (TikTok's brand_content_toggle,
 * YouTube's X-Upload-Content-Length). A request that would have been refused is
 * refused here too, so a test cannot pass on a malformed call.
 *
 * `seen` records every routed call per platform, in order, for assertions on
 * what was actually sent.
 * ---------------------------------------------------------------------------
 */

const { response } = require('./fake-supabase.js');

const GRAPH = 'https://graph.facebook.com/v25.0';
const TT = 'https://open.tiktokapis.com';
const PIN = 'https://api.pinterest.com/v5';
const YT = 'https://www.googleapis.com/youtube/v3';
const YT_UP = 'https://www.googleapis.com/upload/youtube/v3';
const MEDIA = 'https://cdn.brand.example';
const GADS = 'https://googleads.googleapis.com';
const SESSION = `${YT_UP}/videos?uploadType=resumable&upload_id=sess-1&part=snippet,status`;

/** A fake fetch Response that can also hand over bytes. */
function bytesResponse(status, bytes, headers) {
  const h = Object.assign({}, headers || {});
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (h[String(k).toLowerCase()] == null ? null : String(h[String(k).toLowerCase()])) },
    text: async () => bytes.toString('utf8'),
    json: async () => JSON.parse(bytes.toString('utf8')),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function form(body) { return new URLSearchParams(typeof body === 'string' ? body : ''); }
function bearer(call) { return String(call.headers.authorization || '').replace(/^Bearer\s+/i, ''); }
function refuse(status, body) { return response(status, body); }

/**
 * Install the platforms on `db`. `opts` steers the answers a case needs:
 *   tiktokRefresh: 'ok' | 'revoked' | 'down'
 *   pinterestRefresh: 'ok' | 'revoked'
 *   googleRefresh: 'ok' | 'revoked'
 *   sessionHost: override the YouTube upload session URI (a foreign host)
 *   videoStatus: the status object YouTube reports for an uploaded video
 */
function installPlatforms(db, opts) {
  const o = Object.assign({ tiktokRefresh: 'ok', pinterestRefresh: 'ok', googleRefresh: 'ok' }, opts || {});
  const seen = { meta: [], tiktok: [], tiktok_ads: [], pinterest: [], youtube: [], google: [], google_ads: [], media: [] };
  const rec = (k, call, url) => { const u = new URL(url); seen[k].push({ method: call.method, url, path: u.pathname, query: Object.fromEntries(u.searchParams.entries()), headers: call.headers, sent: call.body }); };

  /* ── Meta Graph API ─────────────────────────────────────────────────── */
  db.route((u) => u.startsWith(GRAPH + '/'), (url, init, call) => {
    rec('meta', call, url);
    const u = new URL(url);
    const p = u.pathname.replace('/v25.0/', '').split('/');
    const token = u.searchParams.get('access_token');
    if (p[0] === 'oauth' && p[1] === 'access_token') {
      if (u.searchParams.get('grant_type') !== 'fb_exchange_token') throw new Error('meta fake: unexpected oauth/access_token call');
      return { access_token: 'meta-extended-2', expires_in: 5184000 };
    }
    if (!token) return refuse(400, { error: { message: 'An access token is required', code: 190 } });
    if (call.method === 'GET' && p[1] === 'insights' && /^act_/.test(p[0])) {
      return { data: [
        { ad_id: 'ad-1', ad_name: 'Grail drop A', spend: '120.50', impressions: '10000', clicks: '150', ctr: '1.5', purchase_roas: [{ action_type: 'omni_purchase', value: '2.4' }] },
        { ad_id: 'ad-2', ad_name: 'Grail drop B', spend: '80.00', impressions: '9000', clicks: '45', ctr: '0.5' },
      ] };
    }
    if (call.method === 'GET' && p[1] === 'insights') {
      if (u.searchParams.get('metric') !== 'reach,likes,comments,views') throw new Error(`meta fake: unexpected media metrics ${u.searchParams.get('metric')}`);
      return { data: [{ name: 'reach', period: 'lifetime', values: [{ value: 120 }] }, { name: 'likes', period: 'lifetime', values: [{ value: 9 }] }, { name: 'views', period: 'lifetime', values: [{ value: 300 }] }] };
    }
    if (call.method === 'GET' && p[1] === 'comments') {
      return { data: [{ id: 'c-1', text: 'Need these in a 9', timestamp: '2026-10-01T10:00:00+0000' }] };
    }
    if (call.method === 'GET' && p[1] === 'tags') return { data: [{ id: 'm-tag-1' }] };
    if (call.method === 'POST' && p[1] === 'feed') {
      if (!call.body || (!call.body.message && !call.body.link)) return refuse(400, { error: { message: 'message or link required' } });
      return { id: `${p[0]}_post_1` };
    }
    if (call.method === 'POST' && p[1] === 'replies') return { id: 'reply-1' };
    if (call.method === 'POST' && p[1] === 'comments') return { id: 'page-reply-1' };
    if (call.method === 'POST' && p[1] === 'adcreatives') return { id: 'creative-1' };
    if (call.method === 'POST' && p[1] === 'ads') return { id: 'ad-new-1' };
    if (call.method === 'POST' && p.length === 1) return { success: true };   // node update: hide a comment, activate an ad
    throw new Error(`meta fake: undocumented call ${call.method} ${url}`);
  });

  /* ── TikTok for Developers ──────────────────────────────────────────── */
  db.route((u) => u === `${TT}/v2/oauth/token/`, (url, init, call) => {
    rec('tiktok', call, url);
    const f = form(call.body);
    if (call.headers['content-type'] !== 'application/x-www-form-urlencoded') return refuse(400, { error: 'invalid_request' });
    if (f.get('client_key') !== 'tt-client-key' || f.get('client_secret') !== 'tt-client-secret') return refuse(401, { error: 'invalid_client' });
    if (f.get('grant_type') === 'authorization_code') {
      if (!f.get('code') || !f.get('redirect_uri')) return refuse(400, { error: 'invalid_request' });
      return { access_token: 'act.tt-1', expires_in: 86400, open_id: 'open-tt-1', refresh_token: 'rft.tt-1', refresh_expires_in: 31536000, scope: 'user.info.basic,video.list,video.publish,video.upload', token_type: 'Bearer' };
    }
    if (f.get('grant_type') === 'refresh_token') {
      if (o.tiktokRefresh === 'down') return refuse(503, { error: 'internal_error' });
      if (o.tiktokRefresh === 'revoked' || f.get('refresh_token') === 'rft.revoked') return refuse(400, { error: 'invalid_grant', error_description: 'refresh token revoked' });
      return { access_token: 'act.tt-2', expires_in: 86400, open_id: 'open-tt-1', refresh_token: 'rft.tt-2', refresh_expires_in: 31536000, scope: 'user.info.basic,video.list' };
    }
    return refuse(400, { error: 'unsupported_grant_type' });
  });
  db.route((u) => u === `${TT}/v2/oauth/revoke/`, (url, init, call) => { rec('tiktok', call, url); return {}; });
  db.route((u) => u.startsWith(`${TT}/v2/user/info/`), (url, init, call) => {
    rec('tiktok', call, url);
    if (call.method !== 'GET' || !bearer(call)) return refuse(401, { error: { code: 'access_token_invalid' } });
    return { data: { user: { open_id: 'open-tt-1', display_name: 'Brand on TikTok' } }, error: { code: 'ok', message: '' } };
  });
  db.route((u) => u === `${TT}/v2/post/publish/creator_info/query/`, (url, init, call) => {
    rec('tiktok', call, url);
    if (call.method !== 'POST' || !bearer(call)) return refuse(401, { error: { code: 'access_token_invalid' } });
    return { data: { creator_username: 'brand', privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'], max_video_post_duration_sec: 300 }, error: { code: 'ok' } };
  });
  db.route((u) => u === `${TT}/v2/post/publish/video/init/`, (url, init, call) => {
    rec('tiktok', call, url);
    const b = call.body || {};
    if (!b.post_info || typeof b.post_info.brand_content_toggle !== 'boolean' || !b.post_info.privacy_level) return refuse(400, { error: { code: 'invalid_params' } });
    if (!b.source_info || b.source_info.source !== 'PULL_FROM_URL' || !b.source_info.video_url) return refuse(400, { error: { code: 'invalid_params' } });
    return { data: { publish_id: 'v_pub_url~v2.1' }, error: { code: 'ok' } };
  });
  db.route((u) => u === `${TT}/v2/post/publish/inbox/video/init/`, (url, init, call) => {
    rec('tiktok', call, url);
    const b = call.body || {};
    if (b.post_info) return refuse(400, { error: { code: 'invalid_params', message: 'inbox upload takes no post_info' } });
    if (!b.source_info || b.source_info.source !== 'PULL_FROM_URL') return refuse(400, { error: { code: 'invalid_params' } });
    return { data: { publish_id: 'v_inbox_url~v2.1' }, error: { code: 'ok' } };
  });
  db.route((u) => u === `${TT}/v2/post/publish/status/fetch/`, (url, init, call) => {
    rec('tiktok', call, url);
    return { data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [] }, error: { code: 'ok' } };
  });
  db.route((u) => u.startsWith(`${TT}/v2/video/query/`), (url, init, call) => {
    rec('tiktok', call, url);
    const ids = (call.body && call.body.filters && call.body.filters.video_ids) || [];
    return { data: { videos: ids.map((id, i) => ({ id, view_count: 1000 * (i + 1), like_count: 50 * (i + 1), comment_count: 5, share_count: i === 0 ? null : 2 })) }, error: { code: 'ok' } };
  });
  db.route((u) => /^https:\/\/(open\.tiktokapis\.com|www\.tiktok\.com)\//.test(u), (url, init, call) => { rec('tiktok', call, url); throw new Error(`tiktok fake: undocumented call ${call.method} ${url}`); });
  db.route((u) => u.startsWith('https://business-api.tiktok.com/'), (url, init, call) => { rec('tiktok_ads', call, url); throw new Error(`tiktok ads fake: an UNVERIFIED endpoint was called: ${call.method} ${url}`); });

  /* ── Pinterest API v5 ───────────────────────────────────────────────── */
  db.route((u) => u === `${PIN}/oauth/token`, (url, init, call) => {
    rec('pinterest', call, url);
    if (call.headers.authorization !== 'Basic ' + Buffer.from('pin-app:pin-secret').toString('base64')) return refuse(401, { code: 'invalid_client' });
    const f = form(call.body);
    if (f.get('client_secret') || f.get('client_id')) return refuse(400, { message: 'client credentials go in Basic auth' });
    if (f.get('grant_type') === 'authorization_code') return { access_token: 'pina_1', refresh_token: 'pinr_1', expires_in: 2592000, refresh_token_expires_in: 5184000, scope: 'boards:read,pins:read,pins:write,boards:write,ads:read,ads:write', token_type: 'bearer' };
    if (f.get('grant_type') === 'refresh_token') {
      if (o.pinterestRefresh === 'revoked') return refuse(400, { code: 'invalid_grant', message: 'refresh token revoked' });
      return { access_token: 'pina_2', refresh_token: 'pinr_2', expires_in: 2592000, refresh_token_expires_in: 5184000, scope: 'boards:read,pins:read' };
    }
    return refuse(400, { message: 'unsupported grant' });
  });
  db.route((u) => u.startsWith(`${PIN}/`), (url, init, call) => {
    rec('pinterest', call, url);
    const u = new URL(url);
    if (!/^Bearer pina_/.test(call.headers.authorization || '')) return refuse(401, { code: 2, message: 'Authentication failed.' });
    const p = u.pathname.replace('/v5/', '').split('/');
    if (call.method === 'GET' && u.pathname === '/v5/pins') return { items: [], bookmark: null };
    if (call.method === 'POST' && u.pathname === '/v5/pins') {
      const b = call.body || {};
      if (!b.board_id || !b.media_source || b.media_source.source_type !== 'image_url' || !b.media_source.url) return refuse(400, { message: 'invalid pin' });
      return { id: 'pin-new-1', board_id: b.board_id, title: b.title };
    }
    if (call.method === 'GET' && p[0] === 'pins' && p[2] === 'analytics') {
      if (u.searchParams.get('metric_types') !== 'ALL' || !u.searchParams.get('start_date') || !u.searchParams.get('end_date')) return refuse(400, { message: 'bad analytics query' });
      return { all: { summary_metrics: { IMPRESSION: 400, SAVE: 12, OUTBOUND_CLICK: 7 } } };
    }
    if (call.method === 'POST' && p[0] === 'ad_accounts' && p[2] === 'campaigns' && p.length === 3) {
      const rows = Array.isArray(call.body) ? call.body : [];
      if (!rows.length || !rows[0].name || !rows[0].objective_type) return refuse(400, { message: 'campaign needs name and objective_type' });
      // A campaign sent without a status is created ACTIVE, which is the case the adapter must never hit.
      return { items: rows.map((r, i) => ({ data: { id: `pcamp-${i + 1}`, ad_account_id: p[1], name: r.name, objective_type: r.objective_type, status: r.status || 'ACTIVE' }, exceptions: [] })) };
    }
    if (call.method === 'GET' && p[0] === 'ad_accounts' && p[2] === 'ads' && p[3] === 'analytics') {
      return (u.searchParams.get('ad_ids') || '').split(',').filter(Boolean).map((id) => ({ AD_ID: id, SPEND_IN_MICRO_DOLLAR: 2500000 }));
    }
    throw new Error(`pinterest fake: undocumented or UNVERIFIED call ${call.method} ${url}`);
  });

  /* ── Google OAuth + YouTube Data API v3 ─────────────────────────────── */
  db.route((u) => u === 'https://oauth2.googleapis.com/token', (url, init, call) => {
    rec('google', call, url);
    const f = form(call.body);
    if (f.get('client_id') !== 'yt-client' || f.get('client_secret') !== 'yt-secret') return refuse(401, { error: 'invalid_client' });
    if (f.get('grant_type') === 'authorization_code') {
      if (!f.get('code') || !f.get('code_verifier')) return refuse(400, { error: 'invalid_grant' });
      return { access_token: 'ya29.yt-1', refresh_token: '1//yt-refresh-1', expires_in: 3599, scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl', token_type: 'Bearer' };
    }
    if (f.get('grant_type') === 'refresh_token') {
      if (o.googleRefresh === 'revoked') return refuse(400, { error: 'invalid_grant' });
      return { access_token: 'ya29.yt-2', expires_in: 3599, token_type: 'Bearer' };
    }
    return refuse(400, { error: 'unsupported_grant_type' });
  });
  db.route((u) => u.startsWith(`${YT_UP}/videos`) || u.startsWith(`${YT}/`) || (o.sessionHost && u.startsWith(o.sessionHost)), (url, init, call) => {
    rec('youtube', call, url);
    const u = new URL(url);
    if (!/^Bearer ya29\./.test(call.headers.authorization || '')) return refuse(401, { error: { code: 401, message: 'Invalid Credentials' } });
    if (o.sessionHost && url.startsWith(o.sessionHost)) throw new Error('youtube fake: bytes were PUT to a host YouTube does not own');
    if (u.origin + u.pathname === `${YT_UP}/videos` && call.method === 'POST') {
      if (u.searchParams.get('uploadType') !== 'resumable' || !call.headers['x-upload-content-length'] || !call.headers['x-upload-content-type']) return refuse(400, { error: { message: 'resumable upload headers missing' } });
      return response(200, null, { location: o.sessionHost ? `${o.sessionHost}/upload?id=x` : SESSION });
    }
    if (url === SESSION && call.method === 'PUT') return { id: 'yt-vid-1', status: { privacyStatus: 'private', uploadStatus: 'uploaded' } };
    if (u.pathname === '/youtube/v3/channels' && call.method === 'GET') return { items: [{ id: 'UC-brand', snippet: { title: 'Brand Channel' } }] };
    if (u.pathname === '/youtube/v3/videos' && call.method === 'GET') {
      const part = u.searchParams.get('part');
      const ids = String(u.searchParams.get('id') || '').split(',').filter(Boolean);
      if (part === 'status') return { items: ids.map((id) => ({ id, status: Object.assign({ uploadStatus: 'processed', privacyStatus: 'private', license: 'youtube', embeddable: true, publicStatsViewable: true, selfDeclaredMadeForKids: false }, o.videoStatus || {}) })) };
      if (part === 'statistics') return { items: ids.map((id, i) => ({ id, statistics: { viewCount: String(500 * (i + 1)), likeCount: String(20 * (i + 1)), commentCount: '3' } })) };
      return refuse(400, { error: { message: `part ${part} not routed` } });
    }
    if (u.pathname === '/youtube/v3/videos' && call.method === 'PUT') {
      if (u.searchParams.get('part') !== 'status' || !call.body || !call.body.id || !call.body.status) return refuse(400, { error: { message: 'videos.update needs part=status and a video resource' } });
      return { id: call.body.id, status: call.body.status };
    }
    if (u.pathname === '/youtube/v3/commentThreads' && call.method === 'GET') {
      return { items: [{ id: 'thr-1', snippet: { topLevelComment: { snippet: { textDisplay: 'Is this a one-of-one?', publishedAt: '2026-10-02T09:00:00Z' } } } }] };
    }
    if (u.pathname === '/youtube/v3/comments' && call.method === 'POST') {
      if (!call.body || !call.body.snippet || !call.body.snippet.parentId || !call.body.snippet.textOriginal) return refuse(400, { error: { message: 'parentId and textOriginal required' } });
      return { id: 'yt-reply-1', snippet: call.body.snippet };
    }
    if (u.pathname === '/youtube/v3/comments/setModerationStatus' && call.method === 'POST') {
      if (['heldForReview', 'published', 'rejected'].indexOf(u.searchParams.get('moderationStatus')) < 0) return refuse(400, { error: { message: 'bad moderationStatus' } });
      return response(204, null);
    }
    throw new Error(`youtube fake: undocumented call ${call.method} ${url}`);
  });

  /* ── Google Ads API: the REST searchStream the cookbook gives, nothing else ── */
  db.route((u) => u.startsWith(GADS + '/'), (url, init, call) => {
    rec('google_ads', call, url);
    const u = new URL(url);
    if (call.method === 'POST' && /^\/v\d+\/customers\/\d+\/googleAds:searchStream$/.test(u.pathname)) {
      if (!bearer(call)) return refuse(401, { error: { status: 'UNAUTHENTICATED', message: 'Request is missing required authentication credential.' } });
      if (!call.headers['developer-token']) return refuse(401, { error: { status: 'UNAUTHENTICATED', message: 'developer-token header is required' } });
      if (!call.body || typeof call.body.query !== 'string' || !/^SELECT\s/.test(call.body.query)) return refuse(400, { error: { status: 'INVALID_ARGUMENT', message: 'query is required' } });
      // A list of batches; int64 metrics arrive as strings, doubles as numbers.
      return [{ results: [
        { adGroupAd: { resourceName: 'customers/111/adGroupAds/7~901', ad: { id: '901' }, status: 'ENABLED' }, metrics: { impressions: '5145', clicks: '91', ctr: 0.0177, costMicros: '12500000' } },
        // Google returned no cost for this ad: there is no spend, not a spend of 0.
        { adGroupAd: { resourceName: 'customers/111/adGroupAds/7~902', ad: { id: '902' }, status: 'PAUSED' }, metrics: { impressions: '2000', clicks: '10', ctr: 0.005 } },
      ], fieldMask: 'adGroupAd.ad.id,adGroupAd.status,metrics.impressions,metrics.clicks,metrics.ctr,metrics.costMicros', requestId: 'req-1' }];
    }
    // The responsive search ad create the adapter has always made. Answered
    // whatever status it carries, as Google would: the TEST decides PAUSED.
    if (call.method === 'POST' && /^\/v\d+\/customers\/\d+\/adGroupAds:mutate$/.test(u.pathname)) {
      if (!bearer(call) || !call.headers['developer-token']) return refuse(401, { error: { status: 'UNAUTHENTICATED' } });
      const ops = (call.body && call.body.operations) || [];
      if (!ops.length || !ops[0].create) return refuse(400, { error: { status: 'INVALID_ARGUMENT', message: 'operations[].create is required' } });
      return { results: [{ resourceName: 'customers/1112223333/adGroupAds/7~903' }] };
    }
    throw new Error(`google ads fake: undocumented call ${call.method} ${url}`);
  });

  /* ── the brand's own media host (the asset's hosted video) ──────────── */
  db.route((u) => u.startsWith(MEDIA + '/'), (url, init, call) => {
    rec('media', call, url);
    if (url.endsWith('/redirect.mp4')) return response(302, null, { location: 'http://169.254.169.254/latest/meta-data' });
    const bytes = Buffer.from('fake-mp4-bytes-0123456789');
    return bytesResponse(200, bytes, { 'content-type': 'video/mp4', 'content-length': String(bytes.length) });
  });

  return seen;
}

module.exports = { installPlatforms, GRAPH, TT, PIN, YT, YT_UP, MEDIA, SESSION, GADS };
