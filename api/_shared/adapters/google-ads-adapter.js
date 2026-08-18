'use strict';
/**
 * adapters/google-ads-adapter.js — Google Ads, and the Transparency Center.
 * ---------------------------------------------------------------------------
 * ⚠️ READ THIS BEFORE WIRING THE "AD TRANSPARENCY" HALF.
 * Google's Ads Transparency Center is a WEB UI at adstransparency.google.com.
 * There is no documented public API for it, and this repo's site-crawl module
 * obeys robots.txt, so scraping it is not an option this platform will take
 * either. `searchAdLibrary()` below therefore returns a refusal that names the
 * limitation instead of an empty array that would read as "this advertiser runs
 * no ads". Meta's ads_archive IS a real API and is implemented in meta-adapter.js;
 * the asymmetry is Google's, not this codebase's.
 *
 * The Google ADS API half is real and complete.
 *
 * FIVE CREDENTIALS, NOT ONE. Google Ads is the most demanding connection here:
 *   developer token   issued to the platform, and it starts in a test-account-only
 *                     tier. Basic access requires an application to Google.
 *   client id/secret  the OAuth app.
 *   refresh token     per operator, obtained with access_type=offline.
 *   customer id       the account being operated on, digits only.
 *   login customer id the manager (MCC) account, when the operator reaches the
 *                     customer through one. Sent as a header; omitting it when
 *                     it is needed produces a permission error that says nothing
 *                     useful, which is why it is validated here.
 *
 * PROVENANCE. googleads.googleapis.com and oauth2.googleapis.com/token are
 * already called by this repo (os-backbone.js connector manifest, and the
 * workspace connections registry names the token endpoint explicitly). The
 * authorize endpoint and the adwords scope are Google's standard installed-app
 * OAuth pair; the googleapis.com/auth/ scope shape is already used by this repo
 * for spreadsheets and cloud-platform.
 * ---------------------------------------------------------------------------
 */

const { AdPlatformAdapter } = require('./base-adapter.js');

const API_VERSION = String(process.env.GOOGLE_ADS_API_VERSION || 'v18').trim();
const API = `https://googleads.googleapis.com/${API_VERSION}`;

class GoogleAdsAdapter extends AdPlatformAdapter {
  static get id() { return 'google_ads'; }
  static get label() { return 'Google Ads'; }

  static get channels() {
    return [
      {
        id: 'google_search_ad',
        label: 'Responsive search ad',
        asset_kinds: ['ad'],
        // These limits are the ones Google enforces on RSA assets and are worth
        // checking locally: a rejected asset fails the whole mutate.
        constraints: { headlines: { min: 3, max: 15, chars: 30 }, descriptions: { min: 2, max: 4, chars: 90 }, final_url: 'required' },
      },
      {
        id: 'google_pmax_asset',
        label: 'Performance Max asset group',
        asset_kinds: ['ad', 'asset_group'],
        constraints: { headlines: { min: 3, max: 15, chars: 30 }, long_headline: { chars: 90 }, descriptions: { min: 2, max: 5, chars: 90 }, images: 'required' },
      },
      {
        id: 'google_customer_match',
        label: 'Customer match audience upload',
        asset_kinds: ['profile_list'],
        constraints: { hashing: 'SHA-256 of the normalised address, lowercased and trimmed', min_size: 1000 },
      },
    ];
  }

  static get auth() {
    return {
      kind: 'oauth',
      platform_prereq: {
        what: 'Apply for a Google Ads developer token (it starts with test-account-only access), create an OAuth client in a Google Cloud project with the Google Ads API enabled, and add the callback below as an authorised redirect URI.',
        where: 'Google Ads API Center for the token; Google Cloud Console for the OAuth client.',
        env: {
          GOOGLE_ADS_DEVELOPER_TOKEN: 'Platform developer token, sent on every request.',
          GOOGLE_ADS_CLIENT_ID: 'OAuth client id.',
          GOOGLE_ADS_CLIENT_SECRET: 'OAuth client secret.',
        },
      },
      endpoints: {
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        revoke: 'https://oauth2.googleapis.com/revoke',
        api_base: API,
        transparency_center: '[DATA REQUIRED BEFORE LAUNCH: Google Ads Transparency Center has no documented public API. There is nothing to call here.]',
      },
      authorize_params: ['client_id', 'redirect_uri', 'response_type=code', 'scope', 'state', 'access_type=offline', 'prompt=consent'],
      pkce: { required: false, method: 'S256', note: 'Not required for a confidential web client, and supported. This platform sends it anyway.' },
      scope_separator: ' ',
      scopes: [{ value: 'https://www.googleapis.com/auth/adwords', why: 'The whole Google Ads API. Google does not split it finer, so read-only is not available as a scope - it has to be enforced by this platform, which is what the publish gate does.' }],
      default_scopes: ['https://www.googleapis.com/auth/adwords'],
      token_lifetime: {
        access_seconds: 3599,
        note: 'access_type=offline plus prompt=consent is what returns a refresh_token. Without BOTH, the first authorisation returns one and later ones silently do not, which is the classic way this integration breaks a week after it is built.',
      },
      sources: [
        'This repo already calls googleads.googleapis.com (os-backbone.js) and names https://oauth2.googleapis.com/token in the connections registry.',
        'developers.google.com/google-ads/api — developer token, login-customer-id header, and the adwords scope.',
        'The googleapis.com/auth/ scope shape is already used by this repo for spreadsheets and cloud-platform.',
      ],
    };
  }

  static requiredScopes() { return ['https://www.googleapis.com/auth/adwords']; }

  /* ── credentials ────────────────────────────────────────────────────────── */

  customerId() { return String(this.credentials.customer_id || '').replace(/[^0-9]/g, ''); }
  loginCustomerId() { return String(this.credentials.login_customer_id || '').replace(/[^0-9]/g, ''); }

  headers() {
    const h = {
      Authorization: `Bearer ${this.credentials.access_token || ''}`,
      'developer-token': String(this.credentials.developer_token || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''),
      'Content-Type': 'application/json',
    };
    const mcc = this.loginCustomerId();
    if (mcc) h['login-customer-id'] = mcc;
    return h;
  }

  async validateCredentials() {
    if (!this.credentials.access_token) return { ok: false, note: 'No Google access token. A refresh has to run first: Google access tokens last an hour.' };
    if (!this.customerId()) return { ok: false, note: 'No customer id on this connection. It is the ten digit account number without dashes.' };
    if (!this.headers()['developer-token']) return { ok: false, note: 'No developer token. Google Ads refuses every request without one.' };

    // listAccessibleCustomers is the cheapest call that proves token + developer
    // token together, and it needs no customer id, so it isolates the failure.
    const r = await this.read(`${API}/customers:listAccessibleCustomers`, { headers: this.headers() });
    if (!r.ok) {
      return {
        ok: false,
        note: /DEVELOPER_TOKEN_NOT_APPROVED|test account/i.test(String(r.error || ''))
          ? 'The developer token is in the test-account-only tier, so it cannot touch a production account. That is an application to Google, not a code change.'
          : r.error,
      };
    }
    const names = (r.data && r.data.resourceNames) || [];
    return {
      ok: true,
      account: { accessible: names.length, customer_id: this.customerId() },
      note: names.length && !names.some((n) => n.endsWith(`/${this.customerId()}`))
        ? 'The configured customer id is not in the accessible list. If it is reached through a manager account, the login customer id has to be set.'
        : '',
    };
  }

  async refreshCredentials() {
    const id = String(this.credentials.client_id || process.env.GOOGLE_ADS_CLIENT_ID || '').trim();
    const secret = String(this.credentials.client_secret || process.env.GOOGLE_ADS_CLIENT_SECRET || '').trim();
    const refresh = this.credentials.refresh_token;
    if (!refresh) return { ok: false, supported: true, note: 'No refresh token stored. Re-authorise with access_type=offline and prompt=consent.' };
    if (!id || !secret) return { ok: false, supported: true, note: 'The OAuth client id and secret are needed to refresh.' };

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: id, client_secret: secret }).toString(),
      cache: 'no-store',
    }).catch(() => null);

    if (!res || !res.ok) {
      const status = (res && res.status) || 0;
      return {
        ok: false,
        supported: true,
        terminal: status === 400 || status === 401,
        note: status === 400 || status === 401
          ? 'Google rejected the refresh token. It is revoked or expired (an unused refresh token on a testing-mode OAuth consent screen expires after seven days). The operator has to reconnect.'
          : `Google refresh failed (${status}).`,
      };
    }
    const j = await res.json().catch(() => null);
    if (!j || !j.access_token) return { ok: false, supported: true, note: 'Google returned no access token.' };
    return {
      ok: true,
      supported: true,
      // Google does NOT return a new refresh token here, so the stored one is
      // carried forward rather than blanked.
      credentials: { access_token: j.access_token, refresh_token: refresh },
      expires_at: new Date(Date.now() + (Number(j.expires_in) || 3599) * 1000).toISOString(),
    };
  }

  /* ── mapping ────────────────────────────────────────────────────────────── */

  map(asset, mapping) {
    const a = asset || {};
    const d = (mapping && mapping.defaults) || {};
    const warnings = [];
    const missing = [];

    const headlines = arrayOf(a.headlines || (a.copy && a.copy.headlines) || []).map((s) => String(s).trim()).filter(Boolean);
    const descriptions = arrayOf(a.descriptions || (a.copy && a.copy.descriptions) || []).map((s) => String(s).trim()).filter(Boolean);
    const finalUrl = String(a.final_url || a.link || a.url || d.final_url || '');

    if (headlines.length < 3) missing.push(this.gap(`${3 - headlines.length} more headline(s)`, 'Google responsive search ad'));
    if (descriptions.length < 2) missing.push(this.gap(`${2 - descriptions.length} more description(s)`, 'Google responsive search ad'));
    if (!finalUrl) missing.push(this.gap('final URL', 'Google ad'));

    // Truncating an over-long headline changes the claim it makes, so it is
    // reported and dropped rather than silently cut.
    const longH = headlines.filter((h) => h.length > 30);
    const longD = descriptions.filter((h) => h.length > 90);
    if (longH.length) warnings.push(`${longH.length} headline(s) exceed 30 characters and were dropped rather than truncated: ${longH.map((h) => `"${h.slice(0, 34)}…"`).join(', ')}`);
    if (longD.length) warnings.push(`${longD.length} description(s) exceed 90 characters and were dropped rather than truncated.`);

    return {
      ok: missing.length === 0,
      payload: {
        customer_id: this.customerId() || String(d.customer_id || ''),
        campaign_id: String(a.campaign_id || d.campaign_id || ''),
        ad_group_id: String(a.ad_group_id || d.ad_group_id || ''),
        headlines: headlines.filter((h) => h.length <= 30).slice(0, 15),
        descriptions: descriptions.filter((h) => h.length <= 90).slice(0, 4),
        final_url: finalUrl,
        path1: String(a.path1 || d.path1 || '').slice(0, 15),
        path2: String(a.path2 || d.path2 || '').slice(0, 15),
      },
      warnings,
      missing,
    };
  }

  validatePayload(channelId, payload) {
    const p = payload || {};
    const errors = [];
    const warnings = [];
    if (!p.customer_id) errors.push('A Google Ads customer id is required.');
    if (channelId === 'google_search_ad') {
      if (!p.ad_group_id) errors.push('An ad group id is required; this platform does not create ad groups, because that is a bidding and budget decision.');
      if ((p.headlines || []).length < 3) errors.push('A responsive search ad needs at least 3 headlines.');
      if ((p.descriptions || []).length < 2) errors.push('A responsive search ad needs at least 2 descriptions.');
      if (!/^https:\/\//i.test(p.final_url || '')) errors.push('The final URL must be an https URL.');
    }
    if ((p.headlines || []).length < 5) warnings.push('Google rates ad strength on asset variety; fewer than 5 headlines usually scores "poor".');
    return { ok: errors.length === 0, errors, warnings };
  }

  /* ── dispatch ───────────────────────────────────────────────────────────── */

  async dispatch(channelId, payload) {
    const v = this.validatePayload(channelId, payload);
    if (!v.ok) return { ok: false, sent: false, error: v.errors.join(' '), error_class: 'validation' };
    if (channelId === 'google_search_ad') return this.createAd(payload);
    if (channelId === 'google_pmax_asset') {
      return {
        ok: false,
        sent: false,
        error_class: 'validation',
        error: this.gap('Performance Max asset group mutate shape')
          + ' A PMax asset group requires an existing PMax campaign, a listing group and image assets uploaded first. This platform will not create those implicitly, because each is a spend decision.',
      };
    }
    return { ok: false, error: `Unknown Google Ads channel "${channelId}".`, error_class: 'validation' };
  }

  /**
   * Google Ads is a mutate API: one POST carrying a list of operations. Ads are
   * created PAUSED for the same reason as Meta - this platform builds the
   * structure, a human authorises the spend.
   */
  async createAd(p) {
    const body = {
      operations: [{
        create: {
          adGroup: `customers/${p.customer_id}/adGroups/${p.ad_group_id}`,
          status: 'PAUSED',
          ad: {
            finalUrls: [p.final_url],
            responsiveSearchAd: {
              headlines: p.headlines.map((t) => ({ text: t })),
              descriptions: p.descriptions.map((t) => ({ text: t })),
              path1: p.path1 || undefined,
              path2: p.path2 || undefined,
            },
          },
        },
      }],
      // A partial failure would otherwise create some ads and reject others,
      // leaving the operator to work out which. All or nothing is recoverable.
      partialFailure: false,
      validateOnly: !!this.ctx.validateOnly,
    };

    const r = await this.send(`${API}/customers/${p.customer_id}/adGroupAds:mutate`, {
      method: 'POST',
      headers: this.headers(),
      body,
    });
    if (!r.ok) return r;
    const name = r.raw && r.raw.results && r.raw.results[0] && r.raw.results[0].resourceName;
    return { ok: true, sent: true, external_id: name || '', status: 'paused', raw: r.raw };
  }

  async listAdAccounts() {
    const r = await this.read(`${API}/customers:listAccessibleCustomers`, { headers: this.headers() });
    return r.ok
      ? { ok: true, accounts: ((r.data && r.data.resourceNames) || []).map((n) => ({ id: String(n).split('/').pop(), name: n })) }
      : { ok: false, note: r.error };
  }

  /**
   * Deliberately a refusal, not an empty result. See the header: there is no
   * public Transparency Center API, and returning [] would be read as evidence.
   */
  async searchAdLibrary(_query) {
    return {
      ok: false,
      searched: false,
      note: 'Google Ads Transparency Center has no documented public API, and this platform will not scrape a UI that its robots rules disallow. This is a gap in what Google publishes, not an empty result: nothing was searched, so nothing can be concluded about what this advertiser runs. Meta ad intelligence is available via meta-adapter.searchAdLibrary().',
    };
  }

  async fetchStatus(resourceName) {
    if (!resourceName) return { ok: false, detail: { note: 'no resource name' } };
    const customer = String(resourceName).split('/')[1] || this.customerId();
    const r = await this.send(`${API}/customers/${customer}/googleAds:search`, {
      method: 'POST',
      headers: this.headers(),
      body: { query: `SELECT ad_group_ad.status, ad_group_ad.ad.id FROM ad_group_ad WHERE ad_group_ad.resource_name = '${String(resourceName).replace(/'/g, '')}'` },
    });
    return r.ok ? { ok: true, status: 'read', detail: r.raw } : { ok: false, detail: { error: r.error } };
  }
}

function arrayOf(v) { return Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]); }

module.exports = GoogleAdsAdapter;
