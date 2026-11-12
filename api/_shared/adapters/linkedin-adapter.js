'use strict';
/**
 * adapters/linkedin-adapter.js - LinkedIn: a post on the brand's company page.
 * ---------------------------------------------------------------------------
 * Every endpoint below was read on 2026-11-12 on LinkedIn's own documentation
 * at learn.microsoft.com/en-us/linkedin, and each entry names its page.
 *
 * WHAT IS VERIFIED AND WHAT IS NOT:
 *
 *   A TEXT post by an organization is verified field by field (posts-api):
 *   POST https://api.linkedin.com/rest/posts with Authorization: Bearer,
 *   X-Restli-Protocol-Version: 2.0.0, Linkedin-Version: YYYYMM and a JSON body
 *   {author: "urn:li:organization:{id}", commentary, visibility: "PUBLIC",
 *   distribution: {feedDistribution: "MAIN_FEED", targetEntities: [],
 *   thirdPartyDistributionChannels: []}, lifecycleState: "PUBLISHED",
 *   isReshareDisabledByAuthor: false}; a 201 whose `x-restli-id` header is the
 *   post's URN. So that is what this adapter sends: the post's words, with its
 *   link in the text.
 *
 *   An ARTICLE (link card) post is documented, but its sample carries an image
 *   URN as `thumbnail`, the page says LinkedIn does not scrape the URL, and
 *   whether a card without a thumbnail is accepted was not stated. An IMAGE
 *   post needs the Images API upload, whose byte-upload step is described only
 *   on the older Assets page. Neither is sent: `image_init` is declared
 *   unverified so nothing can call it by accident.
 *
 *   The commentary length limit is not stated on the page read (the error
 *   table names FIELD_LENGTH_TOO_LONG with no number), so none is enforced
 *   here: the post is written to social-core's own limit and LinkedIn is the
 *   judge.
 *
 *   Tokens last 60 days. The page says programmatic refresh tokens are
 *   "available for a limited set of partners" and gives no refresh call, so
 *   none is made: when the token ends the operator signs in again.
 *
 * Every write is behind LIVE_CONNECTORS, the workspace's publishing toggle and
 * LINKEDIN_ALLOW_WRITES.
 * ---------------------------------------------------------------------------
 */

const { SocialPlatformAdapter } = require('./base-adapter.js');

const API = 'https://api.linkedin.com/rest';
const DOCS = 'https://learn.microsoft.com/en-us/linkedin';
// The latest version the versioning page named when it was read; a version is
// supported for at least a year. LINKEDIN_API_VERSION overrides it.
const DEFAULT_VERSION = '202610';

const ENDPOINTS = {
  org_acls: {
    method: 'GET', url: `${API}/organizationAcls`, verified: true,
    doc: `${DOCS}/marketing/community-management/organizations/organization-access-control-by-role (GET /rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED; each element names the organization URN)`,
    scopes: ['r_organization_admin'],
  },
  posts_by_author: {
    method: 'GET', url: `${API}/posts`, verified: true,
    doc: `${DOCS}/marketing/community-management/shares/posts-api (GET /rest/posts?author={encoded URN}&q=author&count; header X-RestLi-Method: FINDER)`,
    scopes: ['r_organization_social'],
  },
  post_create: {
    method: 'POST', url: `${API}/posts`, verified: true,
    doc: `${DOCS}/marketing/community-management/shares/posts-api (POST /rest/posts; author, commentary, visibility, distribution, lifecycleState, isReshareDisabledByAuthor; 201 with the post URN in x-restli-id)`,
    scopes: ['w_organization_social'],
  },
  image_init: {
    method: 'POST', url: `${API}/images?action=initializeUpload`, verified: false,
    doc: `${DOCS}/marketing/community-management/shares/images-api (initializeUpload: owner; value.uploadUrl, value.image)`,
    note: 'The byte upload to the returned uploadUrl is described only on the older Assets page, so an image post is not sent.',
  },
};

class LinkedInAdapter extends SocialPlatformAdapter {
  static get id() { return 'linkedin'; }
  static get label() { return 'LinkedIn'; }
  static get writeSwitch() { return 'LINKEDIN_ALLOW_WRITES'; }
  static get endpointTable() { return ENDPOINTS; }

  static get channels() {
    return [
      { id: 'linkedin_post', label: 'LinkedIn post on the company page', asset_kinds: ['social_post'], constraints: { organization_id: 'required', text: 'required' } },
    ];
  }

  static get auth() {
    return {
      kind: 'oauth',
      scope_separator: ' ',
      pkce: null,
      platform_prereq: {
        what: 'Create an app on the LinkedIn developer portal for the brand\'s company page, add the callback below as an authorized redirect URL, and request the Community Management API product: posting as a page needs w_organization_social, which LinkedIn grants only to an approved app, and only for a page the signed-in person administers.',
        where: 'linkedin.com/developers/apps, Auth and Products tabs.',
        env: {
          LINKEDIN_CLIENT_ID: 'The app\'s Client ID.',
          LINKEDIN_CLIENT_SECRET: 'The app\'s Client Secret. Sent in the form body of the token call.',
        },
      },
      endpoints: Object.assign({
        authorize: 'https://www.linkedin.com/oauth/v2/authorization',
        token: 'https://www.linkedin.com/oauth/v2/accessToken',
      }, ENDPOINTS),
      scopes: [
        { value: 'r_organization_admin', why: 'Find the company pages the signed-in person administers.' },
        { value: 'r_organization_social', why: 'Read the page\'s own posts.' },
        { value: 'w_organization_social', why: 'Post on the company page.' },
      ],
      default_scopes: ['r_organization_admin', 'r_organization_social'],
      token_lifetime: {
        note: 'An access token lasts 60 days (expires_in 5184000). LinkedIn gives programmatic refresh tokens to a limited set of partners only, and the page read gives no refresh call, so the operator signs in again when it ends.',
      },
      sources: [
        `${DOCS}/shared/authentication/authorization-code-flow - GET https://www.linkedin.com/oauth/v2/authorization (response_type=code, client_id, redirect_uri, state, space-delimited scope); POST https://www.linkedin.com/oauth/v2/accessToken as a form with grant_type=authorization_code, code, client_id, client_secret, redirect_uri.`,
        `${DOCS}/marketing/versioning - the Linkedin-Version header is YYYYMM and is required on every call; ${DEFAULT_VERSION} was the latest named.`,
        'Every endpoint-table entry names its own page. All read 2026-11-12.',
      ],
    };
  }

  static requiredScopes(channelId, action) {
    if (action === 'read') return ['r_organization_social'];
    if (channelId === 'linkedin_post') return ['w_organization_social'];
    return [];
  }

  cfg() { return (this.ctx.connection && this.ctx.connection.config && typeof this.ctx.connection.config === 'object') ? this.ctx.connection.config : {}; }
  version() { const v = String(process.env.LINKEDIN_API_VERSION || '').trim(); return /^\d{6}$/.test(v) ? v : DEFAULT_VERSION; }
  headers(extra) {
    return Object.assign({
      Authorization: `Bearer ${this.credentials.access_token || ''}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'Linkedin-Version': this.version(),
      'Content-Type': 'application/json',
    }, extra || {});
  }
  /** The page's numeric id, from the connection (typed, or found at sign-in). */
  organizationId(p) {
    const raw = String((p && p.organization_id) || this.cfg().organization_id || (this.ctx.connection && this.ctx.connection.external_account_id) || '');
    const m = /(\d+)\s*$/.exec(raw);
    return m ? m[1] : '';
  }

  /** The company pages this sign-in administers. */
  async listOrganizations() {
    const r = await this.callEndpoint('org_acls', { query: { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED' }, headers: this.headers() });
    if (!r.ok) return r;
    const els = (r.data && Array.isArray(r.data.elements)) ? r.data.elements : [];
    // The page's samples name the field `organization` in one place and
    // `organizationTarget` in another; either is read.
    const ids = els.map((e) => String((e && (e.organization || e.organizationTarget)) || '')).map((u) => (/urn:li:organization:(\d+)/.exec(u) || [])[1]).filter(Boolean);
    return { ok: true, organizations: [...new Set(ids)].map((id) => ({ id, urn: `urn:li:organization:${id}` })) };
  }

  async validateCredentials() {
    if (!this.credentials.access_token) return { ok: false, note: 'No LinkedIn access token on this workspace.' };
    const r = await this.read(`${API}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, { headers: this.headers() });
    if (!r.ok) return { ok: false, note: r.error || 'LinkedIn rejected the token.' };
    const els = (r.data && Array.isArray(r.data.elements)) ? r.data.elements : [];
    const ids = els.map((e) => (/urn:li:organization:(\d+)/.exec(String((e && (e.organization || e.organizationTarget)) || '')) || [])[1]).filter(Boolean);
    if (!ids.length) return { ok: false, note: 'LinkedIn accepted the token, but this person administers no company page, so there is nothing to post on.' };
    // The page is the one the connection names, or the ONLY one this person
    // administers. With several and none named, no page is chosen: the first
    // in LinkedIn's list could be another brand's page.
    const named = String(this.cfg().organization_id || '').replace(/\D+/g, '');
    const id = named || (ids.length === 1 ? ids[0] : '');
    if (named && ids.indexOf(named) < 0) return { ok: false, note: `LinkedIn accepted the token, but this person does not administer page ${named}. Pages they administer: ${ids.join(', ')}.` };
    if (!id) return { ok: true, account: { id: '' }, note: `LinkedIn answered: this person administers ${ids.length} company pages (${ids.join(', ')}). Type this brand's page id on the LinkedIn card on Connections; nothing is posted until it is set.` };
    return { ok: true, account: { id, label: `LinkedIn page ${id}` }, note: `LinkedIn answered: page ${id}.` };
  }

  async refreshCredentials() {
    return { ok: false, supported: false, note: 'LinkedIn gives refresh tokens to a limited set of partners only. Sign in to LinkedIn again when the 60-day token ends.' };
  }

  map(asset, mapping) {
    const a = asset || {};
    const d = (mapping && mapping.defaults) || {};
    const missing = [];
    const warnings = [];
    const words = String(a.text || a.message || a.caption || a.commentary || (a.copy && a.copy.caption) || '').trim();
    const tags = Array.isArray(a.hashtags) && a.hashtags.length && words.indexOf(a.hashtags[0]) < 0 ? `\n\n${a.hashtags.join(' ')}` : '';
    const link = /^https:\/\//i.test(String(a.link || '')) && words.indexOf(String(a.link)) < 0 ? `\n\n${a.link}` : '';
    const text = (words + link + tags).trim();
    const org = this.organizationId(d);
    if (!text) missing.push(this.gap('the post\'s words', 'LinkedIn post'));
    if (!org) missing.push(this.gap('company page id', 'LinkedIn post'));
    return { ok: missing.length === 0, payload: { organization_id: org, text }, warnings, missing };
  }

  validatePayload(channelId, p) {
    const errors = [];
    const q = p || {};
    if (!LinkedInAdapter.channel(channelId)) errors.push(`Unknown LinkedIn channel "${channelId}".`);
    if (!/^\d+$/.test(String(q.organization_id || ''))) errors.push('The company page id is not set on this connection. Add it on Connections, or sign in to LinkedIn again as an administrator of the page.');
    if (!String(q.text || '').trim()) errors.push('A post needs its words.');
    if (/\[DATA REQUIRED/i.test(String(q.text || ''))) errors.push('The post still carries a DATA REQUIRED marker.');
    return { ok: errors.length === 0, errors, warnings: [] };
  }

  async dispatch(channelId, payload) {
    const v = this.validatePayload(channelId, payload);
    if (!v.ok) return { ok: false, sent: false, error: v.errors.join(' '), error_class: 'validation' };
    const body = {
      author: `urn:li:organization:${payload.organization_id}`,
      commentary: String(payload.text),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    const r = await this.callEndpoint('post_create', { headers: this.headers(), body, captureHeaders: ['x-restli-id'] });
    if (!r.ok) return r;
    const urn = String((r.headers && r.headers['x-restli-id']) || (r.raw && r.raw.id) || '');
    return { ok: true, sent: true, external_id: urn, status: 'published', raw: r.raw };
  }

  /** The page's own recent posts (id, words, when), for the sync view. */
  async listPosts(opts) {
    const o = opts || {};
    const org = this.organizationId(o);
    if (!org) return { ok: false, note: 'The company page id is not set on this connection.' };
    const r = await this.callEndpoint('posts_by_author', {
      query: { author: `urn:li:organization:${org}`, q: 'author', count: Math.min(Math.max(Number(o.count) || 10, 1), 100) },
      headers: this.headers({ 'X-RestLi-Method': 'FINDER' }),
    });
    if (!r.ok) return r;
    const els = (r.data && Array.isArray(r.data.elements)) ? r.data.elements : [];
    return { ok: true, posts: els.map((e) => ({ id: String(e.id || ''), text: String(e.commentary || ''), state: e.lifecycleState || null, created_at: e.createdAt ? new Date(Number(e.createdAt)).toISOString() : null })) };
  }
}

module.exports = LinkedInAdapter;
