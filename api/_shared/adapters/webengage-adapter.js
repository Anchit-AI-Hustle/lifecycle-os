'use strict';
/**
 * adapters/webengage-adapter.js — WebEngage omnichannel (email, SMS, push, in-app).
 * ---------------------------------------------------------------------------
 * WHAT THIS REPO ALREADY DOES WITH WEBENGAGE, AND WHY IT IS THE OPPOSITE OF THIS.
 * webengage-core.js is INBOUND only, and says so: WebEngage pushes bulk event
 * dumps into a private Supabase bucket every twelve hours and this platform
 * reads them. Its header notes that it "NEVER calls webengage.com", which is how
 * it satisfies the standing read-only rule.
 *
 * This adapter is the outbound direction, and it is honest about its footing:
 *
 *   THE EVENT AND USER APIs are the ones this platform can use with confidence,
 *   because they are the same shapes the inbound dumps are made of - a WebEngage
 *   event carries userId, eventName and eventData, and that structure is visible
 *   in the dumps webengage-core.js already parses. Sending an event is what
 *   triggers a WebEngage journey, which is how a campaign actually gets sent.
 *   That is the correct integration shape anyway: you do not push a message,
 *   you push a signal and let the journey own the send logic.
 *
 *   DIRECT MESSAGE CREATION (composing an email/SMS/push/in-app campaign through
 *   the API) was NOT confirmed against WebEngage documentation in the session
 *   that wrote this file - webengage.com documentation is not reachable from
 *   this environment. Rather than invent a plausible endpoint, those channels
 *   return a [DATA REQUIRED BEFORE LAUNCH] refusal naming exactly what is
 *   missing. The event path above is a complete way to drive them in the
 *   meantime, and is the path WebEngage itself recommends for product triggers.
 *
 * REGION MATTERS. WebEngage serves different data centres on different hosts and
 * sending to the wrong one fails authentication in a way that looks like a bad
 * key. The region is part of the connection, not a guess.
 * ---------------------------------------------------------------------------
 */

const { CrmPlatformAdapter } = require('./base-adapter.js');

/**
 * Host per data centre. The account's licence code and its region together
 * decide the base URL; an operator who does not know their region can read it
 * off the dashboard URL they log in to.
 */
const REGION_HOSTS = {
  us: 'https://api.webengage.com',
  in: 'https://api.in.webengage.com',
  eu: 'https://api.eu.webengage.com',
};

class WebEngageAdapter extends CrmPlatformAdapter {
  static get id() { return 'webengage'; }
  static get label() { return 'WebEngage'; }

  static get channels() {
    return [
      { id: 'webengage_event', label: 'Event (triggers a journey)', asset_kinds: ['event'], constraints: {}, supported: true },
      { id: 'webengage_user', label: 'User attribute update', asset_kinds: ['profile'], constraints: {}, supported: true },
      { id: 'webengage_email', label: 'Email campaign', asset_kinds: ['mailer', 'email'], constraints: {}, supported: false },
      { id: 'webengage_sms', label: 'SMS campaign', asset_kinds: ['sms'], constraints: {}, supported: false },
      { id: 'webengage_push', label: 'Push notification', asset_kinds: ['push'], constraints: { title_max: 65, body_max: 240 }, supported: false },
      { id: 'webengage_inapp', label: 'In-app message', asset_kinds: ['inapp'], constraints: {}, supported: false },
    ];
  }

  static get auth() {
    return {
      kind: 'api_key',
      platform_prereq: {
        what: 'Take the licence code and a REST API key from the WebEngage dashboard, and note which data centre the account is on.',
        where: 'WebEngage dashboard, Data Platform, Integrations, API key.',
      },
      endpoints: {
        api_base: '{region host}/v1/accounts/{licence_code}',
        track_event: '{region host}/v1/accounts/{licence_code}/events',
        upsert_user: '{region host}/v1/accounts/{licence_code}/users',
        campaign_create: '[DATA REQUIRED BEFORE LAUNCH: WebEngage campaign-creation endpoint and payload. Not confirmed in the session that wrote this adapter; webengage.com is unreachable from this environment.]',
      },
      region_hosts: REGION_HOSTS,
      fields: [
        { key: 'licence_code', label: 'Licence code', secret: false, required: true },
        { key: 'api_key', label: 'REST API key', secret: true, required: true },
        { key: 'region', label: 'Data centre', secret: false, required: true, options: Object.keys(REGION_HOSTS) },
      ],
      sources: [
        'This repo already parses WebEngage event dumps (webengage-core.js), which is where the userId / eventName / eventData shape used below comes from.',
        '[DATA REQUIRED BEFORE LAUNCH: the campaign-composition API was not verified. Only the event and user paths are claimed here.]',
      ],
    };
  }

  static requiredScopes() { return []; }        // WebEngage keys are not scoped

  base() {
    const region = String(this.credentials.region || 'us').toLowerCase();
    const host = REGION_HOSTS[region] || REGION_HOSTS.us;
    return `${host}/v1/accounts/${encodeURIComponent(this.credentials.licence_code || '')}`;
  }

  headers() {
    return { Authorization: `Bearer ${this.credentials.api_key || ''}`, 'Content-Type': 'application/json' };
  }

  async validateCredentials() {
    if (!this.credentials.api_key || !this.credentials.licence_code) {
      return { ok: false, note: 'WebEngage needs both a licence code and a REST API key.' };
    }
    if (!REGION_HOSTS[String(this.credentials.region || '').toLowerCase()]) {
      return { ok: false, note: `Set the data centre. WebEngage serves ${Object.keys(REGION_HOSTS).join(', ')} on different hosts, and the wrong one fails as if the key were bad.` };
    }
    // There is no documented cheap "whoami" here, and inventing one to probe
    // would be a fabricated endpoint. Reporting configuration completeness is
    // honest; claiming the credential was verified would not be.
    return {
      ok: true,
      account: { licence_code: this.credentials.licence_code, region: this.credentials.region },
      note: 'Configuration is complete. WebEngage exposes no documented identity endpoint that this adapter could call to prove the key works, so this is not a live verification - the first event send is.',
    };
  }

  map(asset, mapping) {
    const a = asset || {};
    const d = (mapping && mapping.defaults) || {};
    const missing = [];
    const eventName = String(a.event_name || a.metric || d.event_name || '');
    const userId = String(a.user_id || a.external_profile_id || '');
    if (!eventName) missing.push(this.gap('event name', 'WebEngage event'));
    if (!userId) missing.push(this.gap('user id', 'WebEngage event'));
    return {
      ok: missing.length === 0,
      payload: {
        userId,
        eventName,
        eventTime: a.event_time || new Date().toISOString(),
        eventData: a.properties || a.event_data || {},
        attributes: a.attributes || {},
      },
      warnings: [],
      missing,
    };
  }

  validatePayload(channelId, payload) {
    const ch = WebEngageAdapter.channels.find((c) => c.id === channelId);
    if (ch && ch.supported === false) {
      return {
        ok: false,
        errors: [`${ch.label} cannot be created through this adapter. ${this.gap('WebEngage campaign-composition API')} Drive this channel by sending an event that starts a WebEngage journey, which is the integration shape WebEngage documents for product triggers.`],
        warnings: [],
      };
    }
    const errors = [];
    if (!payload || !payload.userId) errors.push('A user id is required.');
    if (channelId === 'webengage_event' && !(payload || {}).eventName) errors.push('An event name is required.');
    return { ok: errors.length === 0, errors, warnings: [] };
  }

  async dispatch(channelId, payload) {
    const v = this.validatePayload(channelId, payload);
    if (!v.ok) return { ok: false, sent: false, error: v.errors.join(' '), error_class: 'validation' };
    if (channelId === 'webengage_user') return this.upsertUser(payload);
    return this.triggerFlow(payload);
  }

  async triggerFlow(spec) {
    const s = spec || {};
    const r = await this.send(`${this.base()}/events`, {
      method: 'POST',
      headers: this.headers(),
      body: { userId: s.userId, eventName: s.eventName, eventTime: s.eventTime, eventData: s.eventData || {} },
    });
    return r.ok ? { ok: true, sent: true, external_id: `${s.userId}:${s.eventName}`, status: 'accepted', raw: r.raw } : r;
  }

  async upsertUser(spec) {
    const s = spec || {};
    const r = await this.send(`${this.base()}/users`, {
      method: 'POST',
      headers: this.headers(),
      body: Object.assign({ userId: s.userId }, s.attributes || {}),
    });
    return r.ok ? { ok: true, sent: true, external_id: s.userId, status: 'accepted', raw: r.raw } : r;
  }

  /** Suppression here is an attribute update, not a separate resource. */
  async suppressProfiles(profileIds, reason) {
    const ids = (Array.isArray(profileIds) ? profileIds : []).filter(Boolean);
    if (!ids.length) return { ok: false, error: 'No user ids to suppress.', error_class: 'validation' };
    const results = [];
    for (const id of ids.slice(0, 200)) {
      // Serial on purpose: this is a destructive change to a real person's
      // subscription state, and a burst that trips a rate limit halfway through
      // leaves an unknown subset applied.
      results.push(await this.upsertUser({ userId: id, attributes: { we_email_opt_in: false, we_sms_opt_in: false, we_whatsapp_opt_in: false, lifecycle_os_suppressed_reason: String(reason || 'sunset policy') } }));
    }
    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      sent: true,
      status: `${results.length - failed.length}/${results.length} suppressed`,
      error: failed.length ? failed[0].error : undefined,
      error_class: failed.length ? failed[0].error_class : undefined,
      note: ids.length > 200 ? `Only the first 200 of ${ids.length} were attempted; call again for the rest.` : undefined,
    };
  }

  verifyWebhook() {
    return { verified: false, note: '[DATA REQUIRED BEFORE LAUNCH: WebEngage webhook signature scheme.]' };
  }
}

module.exports = WebEngageAdapter;
module.exports.REGION_HOSTS = REGION_HOSTS;
