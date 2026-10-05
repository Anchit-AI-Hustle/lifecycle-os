'use strict';
/**
 * adapters/pinterest-adapter.js — Pinterest API v5: Pins, Pin analytics, ads.
 * ---------------------------------------------------------------------------
 * Every endpoint below was read on 2026-10-04 in Pinterest's own developer
 * documentation (developers.pinterest.com, through the Context7 documentation
 * index; the docs host itself is blocked from this build environment), and
 * each entry names its page.
 *
 * WHAT IS VERIFIED AND WHAT IS NOT, said here because it shapes the channels:
 *
 *   Pin create, Pin analytics, Pin list, campaign create and ads analytics are
 *   verified. A campaign's PAUSED status is in Pinterest's status table ("not
 *   accruing costs"), and the campaign response shows that a campaign created
 *   WITHOUT a status comes back ACTIVE - so the paid draft here is a campaign
 *   created with status PAUSED, explicitly.
 *
 *   Ad create is unverified: the endpoint is documented, but the documentation
 *   read shows only ACTIVE in an ad's status field, so "PAUSED on an ad" was
 *   not confirmed. Updating a campaign (the LIVE APPROVAL step) is unverified
 *   because the pages read disagree with each other about its method and path
 *   (PATCH /campaigns/update in one, POST /v5/campaigns/update in another).
 *   Both refuse with the exact request they would have made.
 *
 *   Pinterest offers no comment API and no webhook for organic activity in the
 *   documentation read, so those readers say so instead of answering empty.
 *
 * Every write is behind LIVE_CONNECTORS, the workspace's publishing toggle and
 * PINTEREST_ALLOW_WRITES.
 * ---------------------------------------------------------------------------
 */

const { SocialPlatformAdapter } = require('./base-adapter.js');

const API = 'https://api.pinterest.com/v5';
const DOCS = 'https://developers.pinterest.com/docs';

const ENDPOINTS = {
  pins_list: {
    method: 'GET', url: `${API}/pins`, verified: true,
    doc: `${DOCS}/api/v5/pins-list (GET /v5/pins; page_size; scopes boards:read, pins:read)`,
    scopes: ['boards:read', 'pins:read'],
  },
  pin_create: {
    method: 'POST', url: `${API}/pins`, verified: true,
    doc: `${DOCS}/api/v5/pins-create (board_id, title, description, link, alt_text, media_source; is_removable makes an ad-only Pin)`,
    scopes: ['boards:read', 'boards:write', 'pins:read', 'pins:write'],
  },
  pin_analytics: {
    method: 'GET', url: `${API}/pins/{pin_id}/analytics`, verified: true,
    doc: `${DOCS}/api/v5/pins-analytics (start_date, end_date at most 90 days back, metric_types; ALL allowed without split_field)`,
    scopes: ['boards:read', 'pins:read'],
  },
  campaign_create: {
    method: 'POST', url: `${API}/ad_accounts/{ad_account_id}/campaigns`, verified: true,
    doc: `${DOCS}/work-with-ads/create-campaigns-and-ad-groups (status PAUSED: "not accruing costs") and ${DOCS}/work-with-ads/try-out-campaign-objective-type-simplification (array body: name, objective_type)`,
    scopes: ['ads:write'],
  },
  ads_analytics: {
    method: 'GET', url: `${API}/ad_accounts/{ad_account_id}/ads/analytics`, verified: true,
    doc: `${DOCS}/api/v5/ads-analytics (ad_ids, start_date, end_date, columns, granularity; MICRO_DOLLARS columns in the advertiser's currency)`,
    scopes: ['ads:read'],
  },
  ad_create: {
    method: 'POST', url: `${API}/ad_accounts/{ad_account_id}/ads`, verified: false,
    doc: `${DOCS}/api/v5/ads-create (ad_group_id, creative_type, pin_id)`,
    note: 'The documentation read shows only ACTIVE in an ad\'s status field; PAUSED on an ad was not confirmed, and an ad created ACTIVE spends.',
  },
  campaign_update: {
    method: 'PATCH', url: `${API}/ad_accounts/{ad_account_id}/campaigns`, verified: false,
    doc: `${DOCS}/work-with-ads/create-campaigns-and-ad-groups (campaigns/update)`,
    note: 'The pages read give two different methods and paths for updating a campaign, so neither is used.',
  },
};

/** The one ads-analytics column the documentation names in an example. */
const DEFAULT_AD_COLUMNS = ['SPEND_IN_MICRO_DOLLAR'];
const OBJECTIVES = ['AWARENESS', 'CONSIDERATION', 'WEB_CONVERSION', 'SALES', 'LEADS', 'CATALOG_SALES', 'VIDEO_COMPLETION', 'APP_INSTALL'];

class PinterestAdapter extends SocialPlatformAdapter {
  static get id() { return 'pinterest'; }
  static get label() { return 'Pinterest'; }
  static get writeSwitch() { return 'PINTEREST_ALLOW_WRITES'; }
  static get endpointTable() { return ENDPOINTS; }

  static get channels() {
    return [
      { id: 'pinterest_pin', label: 'Pinterest Pin on a board', asset_kinds: ['social_post', 'image'], constraints: { board_id: 'required', image_url: 'required', title_max: 100, description_max: 500 } },
      { id: 'pinterest_campaign_draft', label: 'Pinterest ad campaign, created PAUSED', asset_kinds: ['ad', 'ad_set'], constraints: { objective_type: OBJECTIVES.join(' | '), status: 'PAUSED' } },
      { id: 'pinterest_ad', label: 'Pinterest ad on a Pin (unverified: refuses)', asset_kinds: ['ad'], constraints: { ad_group_id: 'required' } },
      { id: 'pinterest_live_approval', label: 'Live approval: set a paused Pinterest campaign ACTIVE (unverified: refuses)', asset_kinds: ['live_approval'], constraints: { approved_by: 'required' } },
    ];
  }

  static get auth() {
    return {
      kind: 'oauth',
      scope_separator: ',',
      pkce: null,
      token_auth: 'basic',
      platform_prereq: {
        what: 'Create an app on the Pinterest developer platform, add the callback below as a redirect URI, and request Standard access: a trial-access app is limited to sandbox ads. Ad writes need the ads:write scope on an ad account the person can manage.',
        where: 'developers.pinterest.com, My apps.',
        env: {
          PINTEREST_APP_ID: 'The app id (client_id).',
          PINTEREST_APP_SECRET: 'The app secret. Sent as HTTP Basic on the token call.',
        },
      },
      endpoints: Object.assign({
        authorize: 'https://www.pinterest.com/oauth/',
        token: `${API}/oauth/token`,
      }, ENDPOINTS),
      scopes: [
        { value: 'boards:read', why: 'Read the boards a Pin is saved to.' },
        { value: 'boards:write', why: 'Pinterest requires it to create a Pin.' },
        { value: 'pins:read', why: 'Read the brand\'s Pins and their analytics.' },
        { value: 'pins:write', why: 'Create a Pin.' },
        { value: 'ads:read', why: 'Read ad performance.' },
        { value: 'ads:write', why: 'Create a paused campaign.' },
      ],
      default_scopes: ['boards:read', 'pins:read', 'ads:read'],
      token_lifetime: {
        note: 'The token response states expires_in and refresh_token_expires_in. An app created on or after 25 September 2025 gets a continuous refresh token (60 days, refreshable indefinitely); a refresh is grant_type=refresh_token with HTTP Basic client credentials.',
      },
      sources: [
        `${DOCS}/getting-started/set-up-authentication-and-authorization — https://www.pinterest.com/oauth/ (client_id, redirect_uri, response_type=code, comma-separated scope, state); POST https://api.pinterest.com/v5/oauth/token with HTTP Basic, grant_type=authorization_code or refresh_token.`,
        'Every endpoint-table entry names its own page. All read 2026-10-04 through the Context7 index of developers.pinterest.com; the docs host is blocked from this build environment.',
      ],
    };
  }

  static requiredScopes(channelId, action) {
    if (action === 'read') return ['pins:read'];
    switch (channelId) {
      case 'pinterest_pin': return ['boards:read', 'boards:write', 'pins:read', 'pins:write'];
      case 'pinterest_campaign_draft':
      case 'pinterest_ad':
      case 'pinterest_live_approval': return ['ads:write'];
      default: return [];
    }
  }

  cfg() { return (this.ctx.connection && this.ctx.connection.config && typeof this.ctx.connection.config === 'object') ? this.ctx.connection.config : {}; }
  headers() { return { Authorization: `Bearer ${this.credentials.access_token || ''}`, 'Content-Type': 'application/json' }; }
  adAccount(p) { return String((p && p.ad_account_id) || this.cfg().ad_account_id || this.credentials.ad_account_id || ''); }

  async validateCredentials() {
    if (!this.credentials.access_token) return { ok: false, note: 'No Pinterest access token on this workspace.' };
    const r = await this.read(`${API}/pins?page_size=1`, { headers: this.headers() });
    if (!r.ok) return { ok: false, note: r.error || 'Pinterest rejected the token.' };
    return { ok: true, account: { id: this.adAccount() || '' }, note: 'Pinterest answered a Pin list with this token.' };
  }

  async refreshCredentials() {
    const id = String(process.env.PINTEREST_APP_ID || '').trim();
    const secret = String(process.env.PINTEREST_APP_SECRET || '').trim();
    const refresh = this.credentials.refresh_token;
    if (!refresh) return { ok: false, supported: true, terminal: true, note: 'No Pinterest refresh token is stored. Reconnect Pinterest.' };
    if (!id || !secret) return { ok: false, supported: true, note: 'PINTEREST_APP_ID and PINTEREST_APP_SECRET are needed to refresh a Pinterest token.' };
    const res = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }).toString(),
      cache: 'no-store',
    }).catch(() => null);
    const status = (res && res.status) || 0;
    const j = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok || !j || !j.access_token) {
      const transient = status === 0 || status === 429 || status >= 500;
      return {
        ok: false, supported: true, transient, terminal: !transient,
        note: transient ? `Pinterest did not complete the refresh (${status || 'no answer'}). It will be retried.` : `Pinterest refused the refresh token (${status}). The operator has to reconnect Pinterest.`,
      };
    }
    const now = Date.now();
    return {
      ok: true, supported: true,
      credentials: { access_token: j.access_token, refresh_token: j.refresh_token || refresh },
      expires_at: Number(j.expires_in) > 0 ? new Date(now + Number(j.expires_in) * 1000).toISOString() : null,
      refresh_expires_at: Number(j.refresh_token_expires_at) > 0 ? new Date(Number(j.refresh_token_expires_at) * 1000).toISOString()
        : Number(j.refresh_token_expires_in) > 0 ? new Date(now + Number(j.refresh_token_expires_in) * 1000).toISOString() : null,
      granted_scopes: typeof j.scope === 'string' ? j.scope.split(/[\s,]+/).filter(Boolean) : null,
    };
  }

  map(asset, mapping) {
    const a = asset || {};
    const d = (mapping && mapping.defaults) || {};
    const channel = String((mapping && mapping.channel) || 'pinterest_pin');
    const missing = [];
    const warnings = [];
    if (channel === 'pinterest_campaign_draft') {
      const objective = String(a.objective_type || d.objective_type || '').toUpperCase();
      if (!objective) missing.push(this.gap('campaign objective (AWARENESS, CONSIDERATION, SALES, ...)', 'Pinterest campaign'));
      const name = String(a.name || a.campaign_name || '');
      if (!name) missing.push(this.gap('campaign name', 'Pinterest campaign'));
      return { ok: missing.length === 0, payload: { ad_account_id: this.adAccount(d), name, objective_type: objective }, warnings, missing };
    }
    if (channel === 'pinterest_live_approval') {
      if (!a.external_id) missing.push(this.gap('campaign id to activate', 'live approval'));
      return { ok: missing.length === 0, payload: { ad_account_id: this.adAccount(d), external_id: String(a.external_id || ''), approved_by: String(a.approved_by || '') }, warnings, missing };
    }
    if (channel === 'pinterest_ad') {
      const adGroup = String(a.ad_group_id || d.ad_group_id || '');
      const pin = String(a.pin_id || '');
      if (!adGroup) missing.push(this.gap('ad group id (budget and targeting are a spend decision this platform does not make)', 'Pinterest ad'));
      if (!pin) missing.push(this.gap('Pin id', 'Pinterest ad'));
      return { ok: missing.length === 0, payload: { ad_account_id: this.adAccount(d), ad_group_id: adGroup, pin_id: pin, name: String(a.name || a.headline || '').slice(0, 255) }, warnings, missing };
    }
    const image = String(a.image_url || (a.media && a.media.image_url) || '');
    const title = String(a.title || a.headline || (a.copy && a.copy.title) || '');
    const description = String(a.description || a.caption || '');
    const board = String(a.board_id || d.board_id || this.cfg().board_id || '');
    if (!image) missing.push(this.gap('image URL', 'Pinterest Pin'));
    if (!board) missing.push(this.gap('board id', 'Pinterest Pin'));
    if (title.length > 100) warnings.push(`Title is ${title.length} characters; Pinterest shows up to 100.`);
    if (description.length > 500) warnings.push(`Description is ${description.length} characters; Pinterest shows up to 500.`);
    return {
      ok: missing.length === 0,
      payload: { board_id: board, image_url: image, title, description, link: String(a.link || a.url || ''), alt_text: String(a.alt_text || a.alt || '') },
      warnings,
      missing,
    };
  }

  validatePayload(channelId, p) {
    const errors = [];
    const q = p || {};
    if (!PinterestAdapter.channel(channelId)) errors.push(`Unknown Pinterest channel "${channelId}".`);
    if (channelId === 'pinterest_pin') {
      if (!q.board_id) errors.push('A board id is required.');
      if (!/^https:\/\//i.test(String(q.image_url || ''))) errors.push('A public https image URL is required; Pinterest fetches it.');
    } else if (channelId === 'pinterest_campaign_draft') {
      if (!q.ad_account_id) errors.push('The ad account id is not set on this connection.');
      if (!q.name) errors.push('A campaign name is required.');
      if (OBJECTIVES.indexOf(String(q.objective_type)) < 0) errors.push(`objective_type must be one of ${OBJECTIVES.join(', ')}.`);
    } else if (channelId === 'pinterest_ad') {
      if (!q.ad_account_id || !q.ad_group_id || !q.pin_id) errors.push('An ad needs the ad account, an ad group and a Pin.');
    } else if (channelId === 'pinterest_live_approval') {
      if (!q.external_id || !q.approved_by) errors.push('A live approval needs the campaign id and the operator who approved it.');
    }
    return { ok: errors.length === 0, errors, warnings: [] };
  }

  async dispatch(channelId, payload) {
    const v = this.validatePayload(channelId, payload);
    if (!v.ok) return { ok: false, sent: false, error: v.errors.join(' '), error_class: 'validation' };
    const p = payload;
    if (channelId === 'pinterest_pin') {
      const body = { board_id: p.board_id, media_source: { source_type: 'image_url', url: p.image_url } };
      for (const k of ['title', 'description', 'link', 'alt_text']) if (p[k]) body[k] = p[k];
      const r = await this.callEndpoint('pin_create', { headers: this.headers(), body });
      return r.ok ? { ok: true, sent: true, external_id: String((r.raw && r.raw.id) || ''), status: 'published', raw: r.raw } : r;
    }
    if (channelId === 'pinterest_campaign_draft') {
      // PAUSED on purpose: Pinterest creates a campaign ACTIVE when no status
      // is sent. This platform builds the structure; a person turns spend on.
      const r = await this.callEndpoint('campaign_create', {
        params: { ad_account_id: p.ad_account_id },
        headers: this.headers(),
        body: [{ name: p.name, objective_type: p.objective_type, status: 'PAUSED' }],
      });
      if (!r.ok) return r;
      const item = r.raw && Array.isArray(r.raw.items) && r.raw.items[0];
      const exceptions = item && Array.isArray(item.exceptions) ? item.exceptions : [];
      if (exceptions.length) return { ok: false, sent: true, error: `Pinterest refused the campaign: ${JSON.stringify(exceptions).slice(0, 300)}`, error_class: 'permanent' };
      const data = (item && item.data) || {};
      return { ok: true, sent: true, external_id: String(data.id || ''), status: String(data.status || 'PAUSED').toLowerCase(), raw: r.raw };
    }
    if (channelId === 'pinterest_ad') {
      return this.callEndpoint('ad_create', {
        params: { ad_account_id: p.ad_account_id },
        headers: this.headers(),
        body: [{ ad_group_id: p.ad_group_id, creative_type: 'REGULAR', pin_id: p.pin_id, name: p.name || undefined, status: 'PAUSED' }],
      });
    }
    return this.activate(p);
  }

  async activate(spec) {
    const s = spec || {};
    if (!s.approved_by) return { ok: false, sent: false, error_class: 'validation', error: 'A live approval must carry the operator who approved it.' };
    return this.callEndpoint('campaign_update', {
      params: { ad_account_id: s.ad_account_id || this.adAccount() },
      headers: this.headers(),
      body: [{ id: String(s.external_id), status: 'ACTIVE' }],
    });
  }

  /** Pin analytics over the last `days` (at most 90, Pinterest's window). */
  async readPostMetrics(refs) {
    const r0 = refs || {};
    const ids = (Array.isArray(r0.ids) ? r0.ids : [r0.id]).filter(Boolean).slice(0, 25);
    if (!ids.length) return { ok: false, note: 'No Pin ids were given.' };
    const days = Math.min(Math.max(Number(r0.days) || 30, 1), 90);
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const metrics = [];
    for (const id of ids) {
      const r = await this.callEndpoint('pin_analytics', {
        params: { pin_id: id },
        headers: this.headers(),
        query: { start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), metric_types: 'ALL' },
      });
      if (!r.ok) return Object.assign({ ok: false }, r, { partial: metrics });
      metrics.push({ external_id: String(id), kind: 'organic', surface: 'pinterest', values: pinTotals(r.data) });
    }
    return { ok: true, metrics };
  }

  /** Spend per ad. A column the platform did not return stays absent. */
  async readAdMetrics(range) {
    const r0 = range || {};
    const acct = this.adAccount(r0);
    const adIds = (Array.isArray(r0.ad_ids) ? r0.ad_ids : []).filter(Boolean).slice(0, 100);
    if (!acct) return { ok: false, note: this.gap('ad account id', 'Pinterest ad metrics') };
    if (!adIds.length) return { ok: false, note: 'Pinterest\'s ads analytics needs the ad ids to report on.' };
    const end = r0.until || new Date().toISOString().slice(0, 10);
    const start = r0.since || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const columns = Array.isArray(r0.columns) && r0.columns.length ? r0.columns.map(String) : DEFAULT_AD_COLUMNS;
    const r = await this.callEndpoint('ads_analytics', {
      params: { ad_account_id: acct },
      headers: this.headers(),
      query: { ad_ids: adIds, start_date: start, end_date: end, columns, granularity: 'TOTAL' },
    });
    if (!r.ok) return Object.assign({ ok: false }, r);
    const rows = Array.isArray(r.data) ? r.data : [];
    return {
      ok: true,
      currency_note: 'MICRO_DOLLARS columns are in the advertiser\'s own currency, per Pinterest.',
      rows: rows.map((row) => {
        const values = {};
        if (row.SPEND_IN_MICRO_DOLLAR != null && Number.isFinite(Number(row.SPEND_IN_MICRO_DOLLAR))) values.spend = Number(row.SPEND_IN_MICRO_DOLLAR) / 1e6;
        for (const c of columns) if (c !== 'SPEND_IN_MICRO_DOLLAR' && row[c] != null && Number.isFinite(Number(row[c]))) values[c.toLowerCase()] = Number(row[c]);
        return { external_id: String(row.AD_ID || row.ad_id || ''), kind: 'paid', values };
      }),
    };
  }

  async listComments() { return { ok: false, supported: false, note: 'Pinterest API v5, as documented, offers no comment read or reply, so there is nothing to read here.' }; }
  async listMentions() { return { ok: false, supported: false, note: 'Pinterest API v5, as documented, offers no mentions read.' }; }
}

/**
 * Pin analytics come back keyed by app type with summary and daily metrics.
 * Only the summary totals are taken, and only the ones that are numbers.
 */
function pinTotals(data) {
  const out = {};
  const src = data && (data.all || data.ALL || data);
  const summary = src && (src.summary_metrics || src.lifetime_metrics);
  const rename = { IMPRESSION: 'impressions', SAVE: 'saves', PIN_CLICK: 'pin_clicks', OUTBOUND_CLICK: 'outbound_clicks', VIDEO_MRC_VIEW: 'views' };
  for (const [k, v] of Object.entries(summary || {})) {
    if (v != null && Number.isFinite(Number(v))) out[rename[k] || k.toLowerCase()] = Number(v);
  }
  return out;
}

module.exports = PinterestAdapter;
module.exports.ENDPOINTS = ENDPOINTS;
