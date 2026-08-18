'use strict';
/**
 * adapters/extensible-crm.js — the standardized hooks: Braze, ActiveCampaign, Customer.io.
 * ---------------------------------------------------------------------------
 * The brief asked for "standardized hooks" for these three rather than full
 * integrations, and that distinction is worth keeping honest rather than
 * blurring: what follows is a real, working adapter shape for each - identity,
 * channels, auth fields, region handling, payload mapping, validation and the
 * exact request each would make - with the endpoint table marked `verified:
 * false` throughout.
 *
 * WHY NOT JUST WRITE THE CALLS AND CALL IT DONE. None of these three platforms'
 * documentation is reachable from this environment (the egress proxy blocks
 * them, as it does Klaviyo's), so every endpoint below is from general knowledge
 * rather than from a page read while writing it. This project's standing rule is
 * that a plausible-looking wrong endpoint costs more to debug than an admitted
 * gap, so each one carries its status and `dispatch()` refuses to make a first
 * live call until an operator has confirmed the table against the platform's own
 * docs and flipped `confirmed_by` on the connection.
 *
 * That refusal is one field, not a rewrite: confirm the paths, set
 * `endpoints_confirmed: true` in the connection config, and the adapter sends.
 * The plumbing - vault, queue, backoff, idempotency, preflight - is already done
 * for them by the shared machinery, which is the actual point of a hook.
 *
 * ADDING A FOURTH. Add an entry to SPECS and export it from registry.js. No
 * other file changes: the dispatcher, the preflight gate and the UI all read
 * from the adapter contract.
 * ---------------------------------------------------------------------------
 */

const { CrmPlatformAdapter } = require('./base-adapter.js');

/**
 * @typedef {Object} CrmSpec
 * @property {string} id
 * @property {string} label
 * @property {(creds:Object)=>string} base       Resolve the account's base URL.
 * @property {(creds:Object)=>Object} headers
 * @property {Array<Object>} fields              Connection fields.
 * @property {Object} endpoints                  Each { method, path, verified }.
 * @property {Array<Object>} channels
 * @property {string[]} sources
 */

/** @type {Record<string, CrmSpec>} */
const SPECS = {
  braze: {
    id: 'braze',
    label: 'Braze',
    // Braze is strictly region-partitioned and the instance is part of the
    // credential: the dashboard URL an operator logs into names it. Guessing it
    // produces an auth failure that reads like a bad key.
    regions: {
      'us-01': 'https://rest.iad-01.braze.com',
      'us-02': 'https://rest.iad-02.braze.com',
      'us-03': 'https://rest.iad-03.braze.com',
      'us-04': 'https://rest.iad-04.braze.com',
      'us-05': 'https://rest.iad-05.braze.com',
      'us-06': 'https://rest.iad-06.braze.com',
      'us-08': 'https://rest.iad-08.braze.com',
      'eu-01': 'https://rest.fra-01.braze.eu',
      'eu-02': 'https://rest.fra-02.braze.eu',
      'au-01': 'https://rest.au-01.braze.com',
    },
    base: (c) => (SPECS.braze.regions[String(c.region || '').toLowerCase()] || ''),
    headers: (c) => ({ Authorization: `Bearer ${c.api_key || ''}`, 'Content-Type': 'application/json' }),
    fields: [
      { key: 'api_key', label: 'REST API key', secret: true, required: true },
      { key: 'region', label: 'Instance', secret: false, required: true, options: null /* filled from regions */ },
      { key: 'app_id', label: 'App identifier (for push)', secret: false, required: false },
    ],
    endpoints: {
      track_user: { method: 'POST', path: '/users/track', verified: false },
      send_message: { method: 'POST', path: '/messages/send', verified: false },
      trigger_campaign: { method: 'POST', path: '/campaigns/trigger/send', verified: false },
      trigger_canvas: { method: 'POST', path: '/canvas/trigger/send', verified: false },
      unsubscribe: { method: 'POST', path: '/email/status', verified: false },
    },
    channels: [
      { id: 'braze_campaign_trigger', label: 'Trigger a Braze campaign', asset_kinds: ['event'], op: 'trigger_campaign' },
      { id: 'braze_canvas_trigger', label: 'Trigger a Braze canvas', asset_kinds: ['event'], op: 'trigger_canvas' },
      { id: 'braze_user', label: 'User attribute update', asset_kinds: ['profile'], op: 'track_user' },
      { id: 'braze_suppression', label: 'Suppress (email status)', asset_kinds: ['profile_list'], op: 'unsubscribe' },
    ],
    sources: ['[DATA REQUIRED BEFORE LAUNCH: braze.com REST documentation was not reachable from this environment. Confirm the instance host table and every path before the first live send.]'],
  },

  activecampaign: {
    id: 'activecampaign',
    label: 'ActiveCampaign',
    // The account subdomain IS the host, so there is no shared base URL.
    base: (c) => (c.account_url ? String(c.account_url).replace(/\/+$/, '') + '/api/3' : ''),
    headers: (c) => ({ 'Api-Token': c.api_key || '', 'Content-Type': 'application/json' }),
    fields: [
      { key: 'account_url', label: 'Account URL', secret: false, required: true, fetched: true, placeholder: 'https://your-account.api-us1.com' },
      { key: 'api_key', label: 'API key', secret: true, required: true },
    ],
    endpoints: {
      upsert_contact: { method: 'POST', path: '/contact/sync', verified: false },
      add_tag: { method: 'POST', path: '/contactTags', verified: false },
      list_status: { method: 'POST', path: '/contactLists', verified: false },
      create_campaign: { method: 'POST', path: '/campaigns', verified: false },
    },
    channels: [
      { id: 'ac_contact', label: 'Contact upsert', asset_kinds: ['profile'], op: 'upsert_contact' },
      { id: 'ac_tag', label: 'Apply a tag (starts an automation)', asset_kinds: ['event'], op: 'add_tag' },
      { id: 'ac_campaign', label: 'Campaign', asset_kinds: ['mailer', 'email'], op: 'create_campaign' },
      { id: 'ac_suppression', label: 'Unsubscribe from a list', asset_kinds: ['profile_list'], op: 'list_status' },
    ],
    sources: ['[DATA REQUIRED BEFORE LAUNCH: developers.activecampaign.com was not reachable from this environment. Confirm every path before the first live send.]'],
  },

  customerio: {
    id: 'customerio',
    label: 'Customer.io',
    // Two different APIs with two different auth schemes and two different
    // hosts, which is the most common way this integration is got wrong.
    base: (c) => (String(c.region || 'us').toLowerCase() === 'eu' ? 'https://track-eu.customer.io/api/v1' : 'https://track.customer.io/api/v1'),
    app_base: (c) => (String(c.region || 'us').toLowerCase() === 'eu' ? 'https://api-eu.customer.io/v1' : 'https://api.customer.io/v1'),
    headers: (c) => ({
      Authorization: `Basic ${Buffer.from(`${c.site_id || ''}:${c.api_key || ''}`).toString('base64')}`,
      'Content-Type': 'application/json',
    }),
    app_headers: (c) => ({ Authorization: `Bearer ${c.app_api_key || ''}`, 'Content-Type': 'application/json' }),
    fields: [
      { key: 'site_id', label: 'Site ID', secret: false, required: true },
      { key: 'api_key', label: 'Track API key', secret: true, required: true },
      { key: 'app_api_key', label: 'App API key (for transactional and broadcasts)', secret: true, required: false },
      { key: 'region', label: 'Region', secret: false, required: true, options: ['us', 'eu'] },
    ],
    endpoints: {
      identify: { method: 'PUT', path: '/customers/{id}', verified: false, api: 'track' },
      track_event: { method: 'POST', path: '/customers/{id}/events', verified: false, api: 'track' },
      suppress: { method: 'POST', path: '/customers/{id}/suppress', verified: false, api: 'track' },
      send_transactional: { method: 'POST', path: '/send/email', verified: false, api: 'app' },
      trigger_broadcast: { method: 'POST', path: '/campaigns/{id}/triggers', verified: false, api: 'app' },
    },
    channels: [
      { id: 'cio_event', label: 'Event (starts a campaign)', asset_kinds: ['event'], op: 'track_event' },
      { id: 'cio_identify', label: 'Identify / attribute update', asset_kinds: ['profile'], op: 'identify' },
      { id: 'cio_transactional', label: 'Transactional email', asset_kinds: ['mailer', 'email'], op: 'send_transactional' },
      { id: 'cio_broadcast', label: 'Trigger a broadcast', asset_kinds: ['event'], op: 'trigger_broadcast' },
      { id: 'cio_suppression', label: 'Suppress a customer', asset_kinds: ['profile_list'], op: 'suppress' },
    ],
    sources: ['[DATA REQUIRED BEFORE LAUNCH: customer.io/docs was not reachable from this environment. Confirm both API hosts and every path before the first live send.]'],
  },
};

/** Build a concrete adapter class from a spec. */
function makeCrmAdapter(spec) {
  return class ExtensibleCrmAdapter extends CrmPlatformAdapter {
    static get id() { return spec.id; }
    static get label() { return spec.label; }
    static get spec() { return spec; }
    static get channels() {
      return spec.channels.map((c) => Object.assign({ constraints: {}, supported: true }, c));
    }
    static get auth() {
      const fields = spec.fields.map((f) => (f.key === 'region' && spec.regions ? Object.assign({}, f, { options: Object.keys(spec.regions) }) : f));
      return {
        kind: 'api_key',
        fields,
        endpoints: spec.endpoints,
        regions: spec.regions || null,
        endpoints_verified: false,
        confirmation_required: `Every endpoint for ${spec.label} is marked unverified. Confirm them against the platform's own documentation, then set endpoints_confirmed on the connection to allow a live send.`,
        sources: spec.sources,
      };
    }
    static requiredScopes() { return []; }

    confirmed() {
      const cfg = (this.ctx.connection && this.ctx.connection.config) || {};
      return cfg.endpoints_confirmed === true || cfg.endpoints_confirmed === 'true';
    }

    async validateCredentials() {
      const missing = spec.fields.filter((f) => f.required && !this.credentials[f.key]).map((f) => f.label);
      if (missing.length) return { ok: false, note: `${spec.label} is missing: ${missing.join(', ')}.` };
      if (!spec.base(this.credentials)) return { ok: false, note: `${spec.label} region or account URL is not one this adapter knows. It is part of the credential, not a default.` };
      return {
        ok: true,
        account: { id: this.credentials.site_id || this.credentials.account_url || this.credentials.region },
        note: 'Configuration is complete. This is not a live verification: the endpoint table for this platform is unconfirmed, so nothing was called.',
      };
    }

    map(asset, mapping) {
      const a = asset || {};
      const d = (mapping && mapping.defaults) || {};
      const missing = [];
      const userId = String(a.user_id || a.external_profile_id || a.email_hash || '');
      const event = String(a.event_name || a.metric || d.event_name || '');
      if (!userId) missing.push(this.gap('user or contact id', spec.label));
      return {
        ok: missing.length === 0,
        payload: {
          id: userId,
          email: a.email || undefined,
          name: event || a.name || '',
          data: a.properties || a.event_data || {},
          attributes: a.attributes || {},
          subject: a.subject || '',
          html: a.html || a.body_html || '',
        },
        warnings: [],
        missing,
      };
    }

    validatePayload(channelId, payload) {
      const ch = ExtensibleCrmAdapter.channels.find((c) => c.id === channelId);
      if (!ch) return { ok: false, errors: [`Unknown ${spec.label} channel "${channelId}".`], warnings: [] };
      const errors = [];
      if (!payload || !payload.id) errors.push('A contact or user id is required.');
      const warnings = [];
      if (!this.confirmed()) {
        warnings.push(`${spec.label} endpoints are unconfirmed. This will build the request and refuse to send it until an operator confirms the table.`);
      }
      return { ok: errors.length === 0, errors, warnings };
    }

    async dispatch(channelId, payload) {
      const v = this.validatePayload(channelId, payload);
      if (!v.ok) return { ok: false, sent: false, error: v.errors.join(' '), error_class: 'validation' };

      const ch = ExtensibleCrmAdapter.channels.find((c) => c.id === channelId);
      const ep = spec.endpoints[ch.op];
      if (!ep) return { ok: false, sent: false, error: `No endpoint defined for ${ch.op}.`, error_class: 'permanent' };

      const useApp = ep.api === 'app';
      const base = useApp && spec.app_base ? spec.app_base(this.credentials) : spec.base(this.credentials);
      const headers = useApp && spec.app_headers ? spec.app_headers(this.credentials) : spec.headers(this.credentials);
      const url = base + String(ep.path).replace('{id}', encodeURIComponent(payload.id || ''));

      const body = ch.op === 'track_event' || ch.op === 'trigger_campaign' || ch.op === 'trigger_canvas' || ch.op === 'add_tag'
        ? { name: payload.name, data: payload.data }
        : ch.op === 'send_transactional'
          ? { to: payload.email, subject: payload.subject, body: payload.html, identifiers: { id: payload.id } }
          : Object.assign({ email: payload.email }, payload.attributes);

      // The gate. Everything above ran, so the operator sees the exact request.
      if (!this.confirmed()) {
        return {
          ok: false,
          sent: false,
          error_class: 'blocked',
          error: `${spec.label} endpoints are unconfirmed, so nothing was sent. ${ExtensibleCrmAdapter.auth.confirmation_required}`,
          would_request: { method: ep.method, url, body: require('./base-adapter.js').redact(body) },
          sources: spec.sources,
        };
      }

      const r = await this.send(url, { method: ep.method, headers, body });
      return r.ok
        ? { ok: true, sent: true, external_id: String(payload.id), status: 'accepted', raw: r.raw, endpoint_unverified: true }
        : Object.assign(r, { endpoint_unverified: true });
    }

    async suppressProfiles(ids, reason) {
      const list = (Array.isArray(ids) ? ids : []).filter(Boolean);
      if (!list.length) return { ok: false, error: 'No ids to suppress.', error_class: 'validation' };
      const channel = ExtensibleCrmAdapter.channels.find((c) => /suppress|unsubscribe/i.test(c.id));
      if (!channel) return { ok: false, error: `${spec.label} has no suppression channel defined.`, error_class: 'permanent' };
      const out = [];
      for (const id of list.slice(0, 200)) {
        out.push(await this.dispatch(channel.id, { id, attributes: { suppressed_reason: String(reason || 'sunset policy') } }));
      }
      const failed = out.filter((r) => !r.ok);
      return { ok: failed.length === 0, sent: true, status: `${out.length - failed.length}/${out.length}`, error: failed[0] && failed[0].error, error_class: failed[0] && failed[0].error_class };
    }
  };
}

const BrazeAdapter = makeCrmAdapter(SPECS.braze);
const ActiveCampaignAdapter = makeCrmAdapter(SPECS.activecampaign);
const CustomerIoAdapter = makeCrmAdapter(SPECS.customerio);

module.exports = { SPECS, makeCrmAdapter, BrazeAdapter, ActiveCampaignAdapter, CustomerIoAdapter };
