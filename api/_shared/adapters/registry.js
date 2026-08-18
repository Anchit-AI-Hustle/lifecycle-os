'use strict';
/**
 * adapters/registry.js — every publishing target, in one place.
 * ---------------------------------------------------------------------------
 * The dispatcher, the preflight gate, the OAuth vault and the UI all resolve
 * adapters through here, so adding a platform is one entry plus one adapter
 * file. Nothing else in the system needs to learn its name.
 *
 * A NOTE ON THE TWO REGISTRIES. workspace-connections-core.js has its own
 * PROVIDERS list, which answers "what can this workspace store a credential
 * for". This one answers "what can this platform SEND to". They overlap and
 * they are not the same question: a workspace can hold an OpenAI key (a
 * provider, never a publish target) and this platform can publish to Instagram
 * (a channel of the meta connection, not a connection of its own).
 * `connectionProviderFor()` maps between them so a caller never has to guess.
 * ---------------------------------------------------------------------------
 */

const MetaAdapter = require('./meta-adapter.js');
const GoogleAdsAdapter = require('./google-ads-adapter.js');
const KlaviyoAdapter = require('./klaviyo-adapter.js');
const WebEngageAdapter = require('./webengage-adapter.js');
const { BrazeAdapter, ActiveCampaignAdapter, CustomerIoAdapter } = require('./extensible-crm.js');

/** Adapter id -> class. */
const ADAPTERS = {
  meta: MetaAdapter,
  google_ads: GoogleAdsAdapter,
  klaviyo: KlaviyoAdapter,
  webengage: WebEngageAdapter,
  braze: BrazeAdapter,
  activecampaign: ActiveCampaignAdapter,
  customerio: CustomerIoAdapter,
};

/**
 * Adapter id -> the workspace_connections provider row it reads credentials
 * from. Meta is the interesting one: organic Instagram/Facebook publishing and
 * paid Meta ads are the same OAuth grant with different scopes, so they share
 * one connection rather than making the operator sign in twice.
 */
const CONNECTION_PROVIDER = {
  meta: 'meta_ads',
  google_ads: 'google_ads',
  klaviyo: 'klaviyo',
  webengage: 'webengage',
  braze: 'braze',
  activecampaign: 'activecampaign',
  customerio: 'customerio',
};

function adapterFor(id) {
  return ADAPTERS[String(id || '').toLowerCase()] || null;
}

function connectionProviderFor(adapterId) {
  return CONNECTION_PROVIDER[String(adapterId || '').toLowerCase()] || String(adapterId || '');
}

/** Which adapter owns a channel id, or null. */
function adapterForChannel(channelId) {
  const want = String(channelId || '');
  for (const id of Object.keys(ADAPTERS)) {
    if (ADAPTERS[id].channels.some((c) => c.id === want)) return ADAPTERS[id];
  }
  return null;
}

/** Every channel across every adapter, for a channel picker. */
function allChannels() {
  const out = [];
  for (const id of Object.keys(ADAPTERS)) {
    const A = ADAPTERS[id];
    for (const c of A.channels) {
      out.push({
        adapter: id,
        provider: connectionProviderFor(id),
        category: A.category,
        channel: c.id,
        label: c.label,
        platform_label: A.label,
        asset_kinds: c.asset_kinds || [],
        constraints: c.constraints || {},
        supported: c.supported !== false,
        required_scopes: A.requiredScopes(c.id, 'write'),
      });
    }
  }
  return out;
}

/**
 * The registry as the Integration Hub renders it: what each platform is, what
 * it needs, what it can send, and - stated rather than implied - how much of it
 * has actually been verified.
 */
function registryView() {
  return Object.keys(ADAPTERS).map((id) => {
    const A = ADAPTERS[id];
    const auth = A.auth || {};
    const endpoints = auth.endpoints || {};
    const unverified = Object.keys(endpoints).filter((k) => {
      const v = endpoints[k];
      return v && typeof v === 'object' && v.verified === false;
    });
    return {
      id,
      label: A.label,
      category: A.category,
      connection_provider: connectionProviderFor(id),
      auth_kind: auth.kind || 'api_key',
      pkce: auth.pkce || null,
      scopes: auth.scopes || [],
      default_scopes: auth.default_scopes || [],
      platform_prereq: auth.platform_prereq || null,
      token_lifetime: auth.token_lifetime || null,
      channels: A.channels.map((c) => ({ id: c.id, label: c.label, asset_kinds: c.asset_kinds || [], supported: c.supported !== false, constraints: c.constraints || {} })),
      // The honesty surface. The hub shows this so an operator knows which
      // integrations are proven and which are scaffolding they are testing.
      endpoints_verified: unverified.length === 0 && auth.endpoints_verified !== false,
      unverified_operations: unverified,
      sources: auth.sources || [],
    };
  });
}

module.exports = {
  ADAPTERS,
  CONNECTION_PROVIDER,
  adapterFor,
  adapterForChannel,
  connectionProviderFor,
  allChannels,
  registryView,
};
