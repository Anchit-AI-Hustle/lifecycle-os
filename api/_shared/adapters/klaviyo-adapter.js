'use strict';
/**
 * adapters/klaviyo-adapter.js — Klaviyo: templates, campaigns, flows, suppression.
 * ---------------------------------------------------------------------------
 * klaviyo-core.js already READS Klaviyo and is deliberately incapable of
 * writing: its comment says there is no code path to send POST/PUT/PATCH/DELETE,
 * and read-only-egress.js enforces that at the socket. This adapter is the write
 * half, and it does NOT bypass that rule - every write goes through
 * BasePlatformAdapter.send(), which refuses unless KLAVIYO_ALLOW_WRITES=1 is set
 * on the deployment AND the workspace has turned publishing on. With either
 * missing the operator gets the exact request that was withheld.
 *
 * ⚠️ THE TEN MINUTE TOKEN. A Klaviyo OAuth access token is valid for about ten
 * minutes. That is short enough that refresh is not a background chore but part
 * of the send: `ensureFreshToken()` is called before every write, and the queue
 * persists the rotated token immediately, because a token refreshed and then
 * dropped on a crash costs a refresh call out of a budget of ten per minute.
 * A refresh token that goes 90 days unused is revoked entirely.
 *
 * PROVENANCE.
 *   Verified 2026-08-18 via Klaviyo documentation search summaries:
 *     authorize  https://www.klaviyo.com/oauth/authorize   (PKCE S256 REQUIRED)
 *     token      https://a.klaviyo.com/oauth/token         (HTTP Basic, form body)
 *     scopes     space separated, e.g. "lists:write campaigns:write metrics:read"
 *     lifetimes  access ~10 minutes; refresh revoked after 90 days unused;
 *                refresh capped at 10 calls per minute.
 *   Already called by this repo: https://a.klaviyo.com/api with a pinned
 *   `revision` header (klaviyo-core.js).
 *
 *   NOT re-read from documentation in this session, and marked `unverified` in
 *   the WRITE_ENDPOINTS table below: the exact resource paths and attribute
 *   names for creating a template, creating and scheduling a campaign, and bulk
 *   suppressing profiles. They follow Klaviyo's JSON:API convention and are
 *   implemented here, but the first live call should be made against the docs
 *   open. developers.klaviyo.com is blocked by this environment's egress proxy,
 *   so they could not be confirmed from here - and a plausible wrong attribute
 *   name is exactly the failure this project refuses to ship silently.
 * ---------------------------------------------------------------------------
 */

const { CrmPlatformAdapter } = require('./base-adapter.js');

const API = 'https://a.klaviyo.com/api';
const DEFAULT_REVISION = '2024-10-15';        // same pin klaviyo-core.js uses

/**
 * Write surface. `verified` records whether the path was confirmed against
 * documentation during the session that wrote this file. The dispatcher surfaces
 * an unverified path in the job's result so a first live send is read as a test
 * rather than as proof.
 */
const WRITE_ENDPOINTS = {
  create_template: { method: 'POST', path: '/templates/', verified: false },
  create_campaign: { method: 'POST', path: '/campaigns/', verified: false },
  send_campaign: { method: 'POST', path: '/campaign-send-jobs/', verified: false },
  assign_template: { method: 'POST', path: '/campaign-message-assign-template/', verified: false },
  suppress: { method: 'POST', path: '/profile-suppression-bulk-create-jobs/', verified: false },
  // The one write this repo can reason about with confidence, because the READ
  // side of /events/ is already implemented and exercised in klaviyo-core.js.
  track_event: { method: 'POST', path: '/events/', verified: true },
};

class KlaviyoAdapter extends CrmPlatformAdapter {
  static get id() { return 'klaviyo'; }
  static get label() { return 'Klaviyo'; }

  static get channels() {
    return [
      { id: 'klaviyo_email', label: 'Klaviyo email campaign', asset_kinds: ['mailer', 'email'], constraints: { subject_max: 150, preview_max: 150, html: 'required' } },
      { id: 'klaviyo_sms', label: 'Klaviyo SMS campaign', asset_kinds: ['sms'], constraints: { body_max: ceilSms(), unicode_penalty: true } },
      { id: 'klaviyo_event', label: 'Klaviyo event (triggers a flow)', asset_kinds: ['event'], constraints: {} },
      { id: 'klaviyo_suppression', label: 'Suppress profiles (sunset policy)', asset_kinds: ['profile_list'], constraints: {} },
    ];
  }

  static get auth() {
    return {
      kind: 'oauth',
      also_accepts: 'api_key',
      platform_prereq: {
        what: 'Create a public OAuth app in Klaviyo, add the callback below as a redirect URI, and request the scopes the workspace needs. Klaviyo reviews public apps before they can be installed by accounts other than your own.',
        where: 'Klaviyo account, Settings, Apps, Create app.',
        env: { KLAVIYO_OAUTH_CLIENT_ID: 'Public app client id.', KLAVIYO_OAUTH_CLIENT_SECRET: 'Public app client secret. Sent as HTTP Basic on the token call.' },
      },
      // The write paths are merged in rather than kept in a private table, so
      // the Integration Hub's "verified" badge is computed from the SAME facts
      // the dispatcher acts on. A separate table would have let the hub call
      // this platform verified while every write in it was unconfirmed.
      endpoints: Object.assign({
        authorize: 'https://www.klaviyo.com/oauth/authorize',
        token: 'https://a.klaviyo.com/oauth/token',
        api_base: API,
      }, WRITE_ENDPOINTS),
      pkce: { required: true, method: 'S256', verifier_length: '43 to 128 characters' },
      authorize_params: ['response_type=code', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge_method=S256', 'code_challenge'],
      scope_separator: ' ',
      scopes: [
        { value: 'accounts:read', why: 'Identify which Klaviyo account was connected.' },
        { value: 'campaigns:read', why: 'List campaigns.' },
        { value: 'campaigns:write', why: 'Create and schedule a campaign. Required to publish a mailer.' },
        { value: 'lists:read', why: 'Read audiences.' },
        { value: 'lists:write', why: 'Change list membership.' },
        { value: 'segments:read', why: 'Read segments, and their profile counts for segment health.' },
        { value: 'templates:read', why: 'List templates.' },
        { value: 'templates:write', why: 'Create the template a campaign renders.' },
        { value: 'metrics:read', why: 'Read opens, clicks, bounces and complaints for engagement scoring.' },
        { value: 'events:write', why: 'Send an event that triggers a flow.' },
        { value: 'profiles:write', why: 'Suppress a profile under the sunset policy.' },
        { value: 'flows:read', why: 'List flows.' },
      ],
      default_scopes: ['accounts:read', 'campaigns:read', 'lists:read', 'segments:read', 'metrics:read'],
      token_lifetime: {
        access_seconds: 600,
        note: 'About ten minutes, and Klaviyo says it is subject to change. Refresh before every write rather than on a timer. A refresh token unused for 90 days is revoked and the operator has to reconnect. Refresh is capped at ten calls per minute.',
      },
      sources: [
        'developers.klaviyo.com set_up_oauth and academy.klaviyo.com "Set up your OAuth flow" — authorize URL, PKCE requirement, scope format, read 2026-08-18 via search summaries.',
        'developers.klaviyo.com migrate_to_oauth_from_private_key_authentication — token endpoint, Basic auth, form body, token lifetimes, read 2026-08-18 via search summaries.',
        'This repo already calls https://a.klaviyo.com/api with a pinned revision (klaviyo-core.js).',
      ],
    };
  }

  static requiredScopes(channelId, action) {
    if (action === 'read') return ['accounts:read'];
    switch (channelId) {
      case 'klaviyo_email': return ['templates:write', 'campaigns:write'];
      case 'klaviyo_sms': return ['campaigns:write'];
      case 'klaviyo_event': return ['events:write'];
      case 'klaviyo_suppression': return ['profiles:write'];
      default: return [];
    }
  }

  /* ── credentials ────────────────────────────────────────────────────────── */

  revision() {
    return String((this.ctx.connection && this.ctx.connection.config && this.ctx.connection.config.revision)
      || this.credentials.revision || process.env.KLAVIYO_REVISION || DEFAULT_REVISION).trim();
  }

  /**
   * OAuth uses a bearer token; a pasted private key uses Klaviyo's own scheme.
   * Both are supported because a workspace that pasted a key before OAuth
   * existed must keep working.
   */
  headers() {
    const oauth = this.credentials.access_token;
    return {
      Authorization: oauth ? `Bearer ${oauth}` : `Klaviyo-API-Key ${this.credentials.api_key || ''}`,
      revision: this.revision(),
      accept: 'application/vnd.api+json',
      'content-type': 'application/vnd.api+json',
    };
  }

  hasToken() { return !!(this.credentials.access_token || this.credentials.api_key); }

  async validateCredentials() {
    if (!this.hasToken()) return { ok: false, note: 'No Klaviyo credential on this workspace.' };
    const r = await this.read(`${API}/accounts/`, { headers: this.headers() });
    if (!r.ok) {
      return {
        ok: false,
        note: r.status === 401 || r.status === 403
          ? 'Klaviyo rejected the credential. An OAuth access token older than ten minutes is expired, not invalid; try a refresh first.'
          : r.error,
      };
    }
    const row = r.data && r.data.data && r.data.data[0];
    return { ok: true, account: row ? { id: row.id, name: (row.attributes || {}).contact_information && (row.attributes.contact_information.organization_name || '') } : null };
  }

  /**
   * Standard refresh_token grant. Basic auth carries the client credentials, the
   * body is form encoded.
   *
   * Klaviyo rotates the refresh token on some responses. When it does, the NEW
   * one must be persisted or the connection is dead at the next refresh - so the
   * returned credentials always include whichever refresh token is now current,
   * never only the access token.
   */
  async refreshCredentials() {
    const id = String(process.env.KLAVIYO_OAUTH_CLIENT_ID || '').trim();
    const secret = String(process.env.KLAVIYO_OAUTH_CLIENT_SECRET || '').trim();
    const refresh = this.credentials.refresh_token;
    if (!refresh) return { ok: false, supported: true, note: 'This connection is a pasted private key, which does not expire and cannot be refreshed.' };
    if (!id || !secret) return { ok: false, supported: true, note: 'KLAVIYO_OAUTH_CLIENT_ID and KLAVIYO_OAUTH_CLIENT_SECRET are needed to refresh a Klaviyo token.' };

    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const res = await fetch('https://a.klaviyo.com/oauth/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }).toString(),
      cache: 'no-store',
    }).catch((e) => ({ ok: false, status: 0, _err: e }));

    if (!res || !res.ok) {
      const status = (res && res.status) || 0;
      let detail = '';
      try { detail = res && res.text ? (await res.text()).slice(0, 200) : ''; } catch (_) { /* ignore */ }
      return {
        ok: false,
        supported: true,
        // 400 on a refresh grant means the token is gone, not that the call was
        // malformed. Retrying it forever is how an integration burns its ten
        // refreshes a minute, so this is reported as terminal.
        terminal: status === 400 || status === 401,
        note: status === 400 || status === 401
          ? 'Klaviyo rejected the refresh token. It has been revoked or already rotated; the operator has to reconnect. A refresh token unused for 90 days is revoked automatically.'
          : `Klaviyo refresh failed (${status}). ${detail}`,
      };
    }
    const j = await res.json().catch(() => null);
    if (!j || !j.access_token) return { ok: false, supported: true, note: 'Klaviyo returned no access token.' };
    return {
      ok: true,
      supported: true,
      credentials: { access_token: j.access_token, refresh_token: j.refresh_token || refresh },
      expires_at: new Date(Date.now() + (Number(j.expires_in) || 600) * 1000).toISOString(),
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
    const pick = (k, fb) => {
      const v = f[k] ? valueAt(a, f[k]) : fb;
      return v == null || v === '' ? (d[k] != null ? d[k] : '') : v;
    };

    const subject = String(pick('subject', a.subject || (a.copy && a.copy.subject) || '') || '');
    const preview = String(pick('preview_text', a.preview_text || a.preheader || '') || '');
    const html = String(pick('html', a.html || a.body_html || '') || '');
    const smsBody = String(pick('sms_body', a.sms_body || '') || '');
    const listId = String(pick('list_id', d.list_id || '') || '');
    const segmentId = String(pick('segment_id', d.segment_id || '') || '');

    if (!subject) missing.push(this.gap('subject line', 'Klaviyo campaign'));
    if (!html && !smsBody) missing.push(this.gap('email HTML or SMS body', 'Klaviyo campaign'));
    if (!listId && !segmentId) missing.push(this.gap('list id or segment id', 'Klaviyo campaign'));

    if (subject.length > 150) warnings.push(`Subject is ${subject.length} characters; most inboxes truncate well before that.`);
    if (html && !/unsubscribe/i.test(html)) {
      // Not a warning about taste. A bulk commercial email without an
      // unsubscribe path is unlawful under CAN-SPAM and the GDPR, and Klaviyo
      // injects one only if the template asks for it.
      warnings.push('No unsubscribe link found in the HTML. Klaviyo will only inject one where the template places the tag.');
    }

    return {
      ok: missing.length === 0,
      payload: {
        name: String(pick('name', a.name || subject) || '').slice(0, 200),
        subject,
        preview_text: preview,
        html,
        sms_body: smsBody,
        from_email: String(pick('from_email', d.from_email || '') || ''),
        from_label: String(pick('from_label', d.from_label || '') || ''),
        list_id: listId,
        segment_id: segmentId,
        send_at: pick('send_at', a.send_at || ''),
      },
      warnings,
      missing,
    };
  }

  validatePayload(channelId, payload) {
    const p = payload || {};
    const errors = [];
    const warnings = [];
    if (channelId === 'klaviyo_email') {
      if (!p.subject) errors.push('A subject line is required.');
      if (!p.html) errors.push('Email HTML is required.');
      if (!p.from_email) errors.push('A from address is required, and it must be on a domain Klaviyo has verified for this account.');
    }
    if (channelId === 'klaviyo_sms') {
      if (!p.sms_body) errors.push('An SMS body is required.');
      if (p.sms_body && p.sms_body.length > 1600) warnings.push('Over 1600 characters will be split into many segments and billed as such.');
    }
    if (channelId !== 'klaviyo_event' && channelId !== 'klaviyo_suppression' && !p.list_id && !p.segment_id) {
      errors.push('A list id or a segment id is required; a campaign with no audience cannot be created.');
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  /* ── dispatch ───────────────────────────────────────────────────────────── */

  async dispatch(channelId, payload) {
    const v = this.validatePayload(channelId, payload);
    if (!v.ok) return { ok: false, sent: false, error: v.errors.join(' '), error_class: 'validation' };

    switch (channelId) {
      case 'klaviyo_email':
      case 'klaviyo_sms': return this.createCampaign(Object.assign({ channel: channelId === 'klaviyo_sms' ? 'sms' : 'email' }, payload));
      case 'klaviyo_event': return this.triggerFlow(payload);
      case 'klaviyo_suppression': return this.suppressProfiles(payload.profile_ids || [], payload.reason);
      default: return { ok: false, error: `Unknown Klaviyo channel "${channelId}".`, error_class: 'validation' };
    }
  }

  jsonApi(type, attributes, relationships) {
    const data = { type, attributes };
    if (relationships) data.relationships = relationships;
    return { data };
  }

  async createTemplate(spec) {
    const s = spec || {};
    const ep = WRITE_ENDPOINTS.create_template;
    const r = await this.send(`${API}${ep.path}`, {
      method: ep.method,
      headers: this.headers(),
      body: this.jsonApi('template', { name: (s.name || s.subject || 'Lifecycle OS template').slice(0, 200), editor_type: 'CODE', html: s.html }),
    });
    return annotate(r, ep);
  }

  /**
   * A Klaviyo campaign is created with its audience and its send strategy, then
   * a separate send job actually releases it. This method creates and, when a
   * send time is given, schedules; it never releases immediately unless the
   * caller says so, because "created" is recoverable and "sent" is not.
   */
  async createCampaign(spec) {
    const s = spec || {};
    const template = s.html ? await this.createTemplate(s) : { ok: true };
    if (!template.ok) return template;

    const audience = s.segment_id
      ? { included: [{ type: 'segment', id: s.segment_id }] }
      : { included: [{ type: 'list', id: s.list_id }] };

    const sendStrategy = s.send_at
      ? { method: 'static', options_static: { datetime: new Date(s.send_at).toISOString() } }
      : { method: 'immediate' };

    const ep = WRITE_ENDPOINTS.create_campaign;
    const r = await this.send(`${API}${ep.path}`, {
      method: ep.method,
      headers: this.headers(),
      body: this.jsonApi('campaign', {
        name: s.name || s.subject,
        audiences: audience,
        send_strategy: sendStrategy,
        'campaign-messages': {
          data: [{
            type: 'campaign-message',
            attributes: {
              channel: s.channel === 'sms' ? 'sms' : 'email',
              label: s.name || s.subject,
              content: s.channel === 'sms'
                ? { body: s.sms_body }
                : { subject: s.subject, preview_text: s.preview_text || '', from_email: s.from_email, from_label: s.from_label || '' },
            },
          }],
        },
      }),
    });

    if (!r.ok) return annotate(r, ep);
    const id = r.raw && r.raw.data && r.raw.data.id;
    return annotate({
      ok: true,
      sent: true,
      external_id: id,
      status: s.send_at ? 'scheduled' : 'created',
      raw: r.raw,
      template_id: template.external_id,
    }, ep);
  }

  async scheduleCampaign(campaignId, whenIso) {
    const ep = WRITE_ENDPOINTS.send_campaign;
    const r = await this.send(`${API}${ep.path}`, {
      method: ep.method,
      headers: this.headers(),
      body: this.jsonApi('campaign-send-job', { }, { campaign: { data: { type: 'campaign', id: campaignId } } }),
      describeBody: { campaign_id: campaignId, when: whenIso || 'immediate' },
    });
    return annotate(r, ep);
  }

  /** An event with a metric name is what starts a metric-triggered flow. */
  async triggerFlow(spec) {
    const s = spec || {};
    const ep = WRITE_ENDPOINTS.track_event;
    const r = await this.send(`${API}${ep.path}`, {
      method: ep.method,
      headers: this.headers(),
      body: this.jsonApi('event', {
        properties: s.properties || {},
        metric: { data: { type: 'metric', attributes: { name: s.metric || s.event_name } } },
        profile: { data: { type: 'profile', attributes: s.profile || {} } },
      }),
    });
    return annotate(r, ep);
  }

  /**
   * The sunset policy's hands. Suppression is the single highest-leverage move
   * a sender has for its own reputation, and it is destructive from the brand's
   * point of view (a suppressed profile stops receiving everything), so the
   * reason is always recorded alongside.
   */
  async suppressProfiles(profileIds, reason) {
    const ids = (Array.isArray(profileIds) ? profileIds : []).filter(Boolean);
    if (!ids.length) return { ok: false, error: 'No profile ids to suppress.', error_class: 'validation' };
    if (ids.length > 1000) return { ok: false, error: `Klaviyo bulk suppression takes up to 1000 profiles per job; ${ids.length} were passed. Chunk them.`, error_class: 'validation' };

    const ep = WRITE_ENDPOINTS.suppress;
    const r = await this.send(`${API}${ep.path}`, {
      method: ep.method,
      headers: this.headers(),
      body: this.jsonApi('profile-suppression-bulk-create-job', {
        profiles: { data: ids.map((id) => ({ type: 'profile', id })) },
      }),
      describeBody: { count: ids.length, reason: reason || 'sunset policy', sample: ids.slice(0, 3) },
    });
    return annotate(r, ep);
  }

  /* ── reads the cohort engine needs ──────────────────────────────────────── */

  async listAudiences() {
    const r = await this.read(`${API}/lists/?page[size]=10`, { headers: this.headers() });
    return r.ok
      ? { ok: true, audiences: ((r.data && r.data.data) || []).map((x) => ({ id: x.id, name: (x.attributes || {}).name })) }
      : { ok: false, note: r.error };
  }

  async listSegments() {
    const r = await this.read(`${API}/segments/?page[size]=10&additional-fields[segment]=profile_count`, { headers: this.headers() });
    return r.ok
      ? {
        ok: true,
        segments: ((r.data && r.data.data) || []).map((x) => ({
          id: x.id,
          name: (x.attributes || {}).name,
          profile_count: (x.attributes || {}).profile_count,
        })),
      }
      : { ok: false, note: r.error };
  }

  async fetchStatus(externalId) {
    if (!externalId) return { ok: false, detail: { note: 'no id' } };
    const r = await this.read(`${API}/campaigns/${encodeURIComponent(externalId)}/`, { headers: this.headers() });
    return r.ok
      ? { ok: true, status: (r.data && r.data.data && r.data.data.attributes && r.data.data.attributes.status) || 'unknown', detail: r.data }
      : { ok: false, detail: { error: r.error } };
  }

  verifyWebhook(_headers, _rawBody) {
    return {
      verified: false,
      note: '[DATA REQUIRED BEFORE LAUNCH: Klaviyo webhook signature scheme. It was not confirmed in the session that wrote this adapter, and an unverified webhook is stored for diagnosis and never acted on.]',
    };
  }
}

/**
 * Attach the provenance of the endpoint used. An unverified path that returns a
 * 404 or a validation error is far more likely to be this table being wrong
 * than the operator's payload, and whoever reads the failed job should be told
 * that before they go looking at their own data.
 */
function annotate(result, ep) {
  if (!ep || ep.verified) return result;
  const note = `Endpoint ${ep.method} ${ep.path} was implemented from Klaviyo's JSON:API conventions and NOT re-read from documentation when this adapter was written. If this failed with a 404 or a validation error, check the path and attribute names against developers.klaviyo.com before changing the payload.`;
  return Object.assign({}, result, { endpoint_unverified: true, note: result.note ? `${result.note} ${note}` : note });
}

function valueAt(obj, path) {
  return String(path || '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** GSM-7 single segment is 160; a concatenated one is 153 per part. */
function ceilSms() { return 1600; }

module.exports = KlaviyoAdapter;
module.exports.WRITE_ENDPOINTS = WRITE_ENDPOINTS;
