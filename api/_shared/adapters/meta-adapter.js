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
 * ---------------------------------------------------------------------------
 */

const { AdPlatformAdapter } = require('./base-adapter.js');

// ad-insights-core.js already reads this env var with this default; reusing it
// keeps one version number across the Meta surface rather than two that drift.
const VER = String(process.env.META_GRAPH_VERSION || 'v25.0').trim();
const GRAPH = `https://graph.facebook.com/${VER}`;

class MetaAdapter extends AdPlatformAdapter {
  static get id() { return 'meta'; }
  static get label() { return 'Meta (Facebook, Instagram, Ads)'; }

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
      endpoints: {
        authorize: `https://www.facebook.com/${VER}/dialog/oauth`,
        token: `${GRAPH}/oauth/access_token`,
        inspect: `${GRAPH}/debug_token`,
        api_base: GRAPH,
        ad_library: `${GRAPH}/ads_archive`,
      },
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
      ],
      default_scopes: ['ads_read', 'pages_read_engagement', 'instagram_basic'],
      token_lifetime: {
        note: 'A short-lived user token comes back from the dialog. It is exchanged for a long-lived token (roughly 60 days) with grant_type=fb_exchange_token; there is no refresh_token grant. A System User token from Business Manager does not expire and is the right choice for unattended publishing.',
      },
      webhooks: {
        verification: 'X-Hub-Signature-256, an HMAC-SHA256 of the raw body keyed with the app secret, compared in constant time.',
        note: 'The subscription itself is configured on the app, not per workspace.',
      },
      sources: [
        'developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow — dialog and token endpoints, read 2026-08-18 via search summaries.',
        'This repo already calls graph.facebook.com/<ver>/act_<id>/insights (ads-live-core.js) and the IG /media + /media_publish and Page /photos shapes (social-push-core.js).',
        'developers.facebook.com/docs/marketing-api — campaign/adset/adcreative/ad object names.',
      ],
    };
  }

  static requiredScopes(channelId, action) {
    if (action === 'read') return ['ads_read'];
    switch (channelId) {
      case 'instagram_feed':
      case 'instagram_reel': return ['instagram_basic', 'instagram_content_publish'];
      case 'facebook_page': return ['pages_manage_posts'];
      case 'meta_ad': return ['ads_management'];
      default: return [];
    }
  }

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
        ig_user_id: String(d.ig_user_id || this.credentials.ig_user_id || ''),
        page_id: String(d.page_id || this.credentials.page_id || ''),
        ad_account_id: String(d.ad_account_id || this.credentials.account_id || ''),
        headline: String(pick('headline', a.headline || '') || ''),
        description: String(pick('description', a.description || '') || ''),
      },
      warnings,
      missing,
    };
  }

  validatePayload(channelId, payload) {
    const p = payload || {};
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
      default: return { ok: false, error: `Unknown Meta channel "${channelId}".`, error_class: 'validation' };
    }
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

  /** X-Hub-Signature-256: HMAC-SHA256 of the RAW body, keyed with the app secret. */
  verifyWebhook(headers, rawBody) {
    const secret = String(process.env.META_APP_SECRET || '').trim();
    if (!secret) return { verified: false, note: 'META_APP_SECRET is not set, so no Meta webhook can be verified.' };
    const get = (k) => (headers && (typeof headers.get === 'function' ? headers.get(k) : headers[k])) || '';
    const sig = String(get('x-hub-signature-256') || get('X-Hub-Signature-256') || '');
    if (!sig.startsWith('sha256=')) return { verified: false, note: 'No X-Hub-Signature-256 header on the request.' };

    const crypto = require('crypto');
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody || '').digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    // Length check first: timingSafeEqual throws on a length mismatch, and the
    // throw would itself be a timing signal.
    const verified = a.length === b.length && crypto.timingSafeEqual(a, b);
    let event = null;
    try { event = JSON.parse(rawBody || 'null'); } catch (_) { /* keep null */ }
    return { verified, note: verified ? 'Signature verified.' : 'Signature did not match.', event: verified ? event : null };
  }
}

/** Read `a.b.c` out of an object without throwing on a missing branch. */
function valueAt(obj, path) {
  return String(path || '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

module.exports = MetaAdapter;
module.exports.valueAt = valueAt;
