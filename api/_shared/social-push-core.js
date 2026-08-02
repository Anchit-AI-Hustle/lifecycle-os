'use strict';

/**
 * api/_shared/social-push-core.js — Phase-2 platform push (STUBBED, Klaviyo pattern).
 *
 * Mirrors each network's real publish endpoint so the Social Media OS can show
 * exactly the HTTP call it WOULD make per approved post — without any key
 * hardcoded here. Until the env token for a platform is set, pushPost() returns
 * { connected:false, not_connected:true, would_request:{ method,url,body }, hint }
 * (the same convention as klaviyo-core.js / video-core.js). Actually executing
 * the push stays Phase 2: nothing in the pipeline calls out, every generated
 * post carries push_status:'not_integrated_phase_2'.
 *
 * Env (all optional — see .env.example "SOCIAL MEDIA OS" section):
 *   META_ACCESS_TOKEN + META_IG_USER_ID / META_PAGE_ID   — Meta Graph API (IG + FB)
 *   TIKTOK_ACCESS_TOKEN                                  — TikTok Content Posting API
 *   LINKEDIN_ACCESS_TOKEN + LINKEDIN_ORG_URN             — LinkedIn UGC Posts API
 *   X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET — X API v2
 *   PINTEREST_ACCESS_TOKEN + PINTEREST_BOARD_ID          — Pinterest API v5
 *   YOUTUBE_ACCESS_TOKEN                                 — YouTube Data API v3 (Shorts)
 *   THREADS_ACCESS_TOKEN + THREADS_USER_ID               — Threads API
 */

const clean = (s) => (s || '').trim();

function env() {
  return {
    meta: clean(process.env.META_ACCESS_TOKEN),
    metaIgUser: clean(process.env.META_IG_USER_ID),
    metaPage: clean(process.env.META_PAGE_ID),
    tiktok: clean(process.env.TIKTOK_ACCESS_TOKEN),
    linkedin: clean(process.env.LINKEDIN_ACCESS_TOKEN),
    linkedinOrg: clean(process.env.LINKEDIN_ORG_URN),
    xKey: clean(process.env.X_API_KEY),
    xAccess: clean(process.env.X_ACCESS_TOKEN),
    pinterest: clean(process.env.PINTEREST_ACCESS_TOKEN),
    pinterestBoard: clean(process.env.PINTEREST_BOARD_ID),
    youtube: clean(process.env.YOUTUBE_ACCESS_TOKEN),
    threads: clean(process.env.THREADS_ACCESS_TOKEN),
    threadsUser: clean(process.env.THREADS_USER_ID),
  };
}

// Per-platform request builders — the exact publish call each network expects.
// `post` is a social-core post object ({ platform, format, copy, media, link... }).
function buildRequest(post) {
  const e = env();
  const caption = ((post.copy && (post.copy.caption || post.copy.title)) || '') + (post.hashtags && post.hashtags.length ? '\n\n' + post.hashtags.join(' ') : '');
  const imageUrl = (post.media && post.media.image_url) || null;
  const videoNote = post.media && post.media.type === 'video' ? '<rendered video url from video job ' + JSON.stringify((post.media.video && post.media.video.job && post.media.video.job.job_id) || null) + '>' : null;

  switch (post.platform) {
    case 'instagram':
      return {
        platform: 'instagram', token_env: 'META_ACCESS_TOKEN', connected: !!(e.meta && e.metaIgUser),
        method: 'POST',
        url: 'https://graph.facebook.com/v21.0/' + (e.metaIgUser || '{META_IG_USER_ID}') + '/media',
        body: post.media && post.media.type === 'video'
          ? { media_type: 'REELS', video_url: videoNote, caption }
          : { image_url: imageUrl || '<hosted hero image url>', caption },
        then: 'POST /{ig-user-id}/media_publish with the returned creation_id',
      };
    case 'facebook':
      return {
        platform: 'facebook', token_env: 'META_ACCESS_TOKEN', connected: !!(e.meta && e.metaPage),
        method: 'POST',
        url: 'https://graph.facebook.com/v21.0/' + (e.metaPage || '{META_PAGE_ID}') + '/photos',
        body: { url: imageUrl || '<hosted hero image url>', message: caption },
      };
    case 'tiktok':
      return {
        platform: 'tiktok', token_env: 'TIKTOK_ACCESS_TOKEN', connected: !!e.tiktok,
        method: 'POST',
        url: 'https://open.tiktokapis.com/v2/post/publish/video/init/',
        body: { post_info: { title: caption.slice(0, 2200), privacy_level: 'SELF_ONLY' }, source_info: { source: 'PULL_FROM_URL', video_url: videoNote || '<rendered video url>' } },
      };
    case 'linkedin':
      return {
        platform: 'linkedin', token_env: 'LINKEDIN_ACCESS_TOKEN', connected: !!e.linkedin,
        method: 'POST',
        url: 'https://api.linkedin.com/v2/ugcPosts',
        body: {
          author: e.linkedinOrg || 'urn:li:organization:{LINKEDIN_ORG_URN}',
          lifecycleState: 'PUBLISHED',
          specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: caption }, shareMediaCategory: imageUrl ? 'IMAGE' : 'NONE' } },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        },
      };
    case 'x':
      return {
        platform: 'x', token_env: 'X_API_KEY', connected: !!(e.xKey && e.xAccess),
        method: 'POST',
        url: 'https://api.twitter.com/2/tweets',
        body: { text: caption.slice(0, 280) },
        then: 'media via POST https://upload.twitter.com/1.1/media/upload.json first, then attach media_ids',
      };
    case 'pinterest':
      return {
        platform: 'pinterest', token_env: 'PINTEREST_ACCESS_TOKEN', connected: !!e.pinterest,
        method: 'POST',
        url: 'https://api.pinterest.com/v5/pins',
        body: {
          board_id: e.pinterestBoard || '{PINTEREST_BOARD_ID}',
          title: (post.copy && post.copy.title) || '',
          description: caption.slice(0, 500),
          link: post.link,
          media_source: { source_type: 'image_url', url: imageUrl || '<hosted hero image url>' },
        },
      };
    case 'youtube':
      return {
        platform: 'youtube', token_env: 'YOUTUBE_ACCESS_TOKEN', connected: !!e.youtube,
        method: 'POST',
        url: 'https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable',
        body: { snippet: { title: (post.copy && post.copy.title) || '', description: caption, tags: (post.hashtags || []).map((h) => h.replace(/^#/, '')) }, status: { privacyStatus: 'private' } },
        then: 'upload the rendered 9:16 video bytes to the resumable session URL',
      };
    case 'threads':
      return {
        platform: 'threads', token_env: 'THREADS_ACCESS_TOKEN', connected: !!(e.threads && e.threadsUser),
        method: 'POST',
        url: 'https://graph.threads.net/v1.0/' + (e.threadsUser || '{THREADS_USER_ID}') + '/threads',
        body: { media_type: imageUrl ? 'IMAGE' : 'TEXT', image_url: imageUrl || undefined, text: caption.slice(0, 500) },
        then: 'POST /{user}/threads_publish with the returned creation id',
      };
    case 'blog':
      return {
        platform: 'blog', token_env: '(site CMS — no token defined yet)', connected: false,
        method: 'POST', url: '<site CMS endpoint — publish body_markdown as an SEO post>',
        body: { title: (post.copy && post.copy.title) || '', slug: (post.copy && post.copy.slug) || '', body_markdown: '<body_markdown from the post payload>' },
      };
    default:
      return { platform: post.platform, connected: false, method: 'POST', url: '<unknown platform>', body: null };
  }
}

/**
 * pushPost(post) — Phase 2 stub. NEVER calls out; returns the would_request
 * envelope (with connected reflecting whether the env token exists).
 */
function pushPost(post) {
  const r = buildRequest(post || {});
  return {
    ok: false,
    connected: false,
    not_connected: true,
    push_status: 'not_integrated_phase_2',
    token_present: !!r.connected,
    would_request: { platform: r.platform, method: r.method, url: r.url, body: r.body, then: r.then || undefined },
    hint: r.connected
      ? 'Token for ' + r.platform + ' is set (' + r.token_env + ') but live push is Phase 2 — this endpoint intentionally does not execute yet.'
      : 'Set ' + r.token_env + ' in Vercel env; live push ships in Phase 2. The request shape above is what will be sent.',
  };
}

/** connections() — which platform tokens are present (nothing is ever called). */
function connections() {
  const e = env();
  return {
    instagram: !!(e.meta && e.metaIgUser),
    facebook: !!(e.meta && e.metaPage),
    tiktok: !!e.tiktok,
    linkedin: !!e.linkedin,
    x: !!(e.xKey && e.xAccess),
    pinterest: !!e.pinterest,
    youtube: !!e.youtube,
    threads: !!(e.threads && e.threadsUser),
    blog: false,
    live_push: 'not_integrated_phase_2',
  };
}

module.exports = { pushPost, connections, buildRequest };
