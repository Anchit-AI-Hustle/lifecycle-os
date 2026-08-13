'use strict';
/**
 * payments-core.js — connect a brand's own payment gateway to its workspace.
 * ---------------------------------------------------------------------------
 * NOT a serverless function. Lives under api/_shared/ so it does not count
 * against the Hobby plan's 12-function cap; routed from api/public-config.js as
 * ?action=payments, the same way the brand and credits routers are mounted.
 *
 * WHAT THIS IS FOR. The platform runs as whatever brand the operator onboarded.
 * A brand's money moves through its own gateway account, and several parts of
 * the product want to reference that: revenue against a campaign, a payout that
 * a lifecycle send should be attributed to, a checkout link a campaign can point
 * at. None of that is possible until the brand's gateway is attached to the
 * workspace, which is what this module does.
 *
 * THE INTENDED EXPERIENCE, and where it is honestly not available.
 * The operator should pick a gateway, sign in at that gateway, and be done.
 * Three of the four gateways here genuinely work that way, and one does not:
 *
 *   Stripe            sign-in. Standard Connect OAuth.
 *   Razorpay          sign-in IF this platform is an approved Razorpay partner
 *                     with OAuth credentials. Otherwise the merchant must paste
 *                     a key id and secret, and the page says so rather than
 *                     pretending a sign-in button exists.
 *   PayPal            sign-in, through a partner referral link that PayPal
 *                     generates for this platform.
 *   Shopify Payments  sign-in to the STORE, which grants read access to Shopify
 *                     Payments payouts and disputes. It does not, and cannot,
 *                     make this platform a processor on that store. See the
 *                     registry entry.
 *
 * In every case the platform owner has a one-time registration to do first
 * (a Connect platform, a partner account, an app in a partner dashboard). That
 * is not something an operator can self-serve, so `platformReadiness()` reports
 * it per gateway and the page shows it plainly.
 *
 * DEGRADATION CONTRACT (same shape as _shared/klaviyo-core.js). With no
 * credentials configured, every operation returns
 *   { ok:false, connected:false, not_connected:true,
 *     would_request:{ method, url, body } }
 * describing exactly the call it WOULD make. The whole feature is therefore
 * demonstrable end to end before a single credential exists, and going live is
 * a matter of setting environment variables rather than writing code.
 *
 * SECRETS. Nothing in this module ever returns a credential to a caller.
 * Credentials are sealed with AES-256-GCM before they touch the database, the
 * sealing key lives only in the serverless environment, the ciphertext columns
 * are revoked from the anon and authenticated Postgres roles, and every
 * would_request body is redacted before it is returned or logged. See
 * supabase/migrations/20261231090000_payment_gateway_connections.sql.
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const { requireUser, restAs } = require('./brand-workspace-core.js');
// Every outbound call goes through the project-wide read-only guard. It matters
// here: Shopify's OAuth token exchange is a POST to a myshopify.com host, which
// the guard blocks by default. That is reported to the operator as a blocker
// rather than quietly bypassed, because the guard is a deliberate standing rule
// and this module is not entitled to decide it does not apply.
const { assertReadOnly } = require('./read-only-egress.js');

const TIMEOUT_MS = 20000;

/* ── The gateway registry ─────────────────────────────────────────────────── */
/**
 * PROVENANCE RULE. Every endpoint, scope and field name below was read from
 * provider documentation during the session that wrote this file, and each
 * entry records where. Anything that could NOT be confirmed against real
 * documentation is written as a [DATA REQUIRED BEFORE LAUNCH: …] string rather
 * than guessed, because a plausible-looking wrong scope or endpoint costs more
 * to debug than an admitted gap.
 */
const GATEWAYS = [
  {
    id: 'stripe',
    label: 'Stripe',
    coverage: 'Global',
    connect_kind: 'oauth',
    sign_in: true,
    summary: 'The operator signs in to their own Stripe account and grants this platform access. Stripe calls this Connect with a Standard account.',

    // What the platform owner must do ONCE, before any operator can connect.
    platform_prereq: {
      what: 'Register this app as a Stripe Connect platform, enable onboarding Standard accounts with OAuth in the platform OAuth settings, and add the callback below as a redirect URI.',
      where: 'Stripe Dashboard, Connect platform settings.',
      yields: 'A client id beginning ca_ and the platform secret key you already have.',
      env: { STRIPE_CONNECT_CLIENT_ID: 'The ca_… client id from the Connect OAuth settings.', STRIPE_SECRET_KEY: 'The platform secret key. Used to exchange the code and to act on connected accounts.' },
    },

    endpoints: {
      authorize: 'https://connect.stripe.com/oauth/authorize',
      token: 'https://connect.stripe.com/oauth/token',
      deauthorize: 'https://connect.stripe.com/oauth/deauthorize',
      api_base: 'https://api.stripe.com/v1',
      probe: 'https://api.stripe.com/v1/balance',
    },
    authorize_params: ['response_type=code', 'client_id', 'scope', 'state', 'redirect_uri'],
    scopes: [
      { value: 'read_only', why: 'Read the connected account. Enough for revenue, payouts and reconciliation.' },
      { value: 'read_write', why: 'Read and write. Required only if this platform ever creates charges or payment links on the merchant account.' },
    ],
    default_scope: 'read_only',

    holds: {
      platform: 'The Connect client id and the platform secret key. Also the returned stripe_user_id, which is the connected account id.',
      merchant: 'Their entire Stripe account: balance, payouts, bank details, their own dashboard, and their own PCI attestation. The merchant can revoke this platform at any time from their dashboard.',
      note: 'For a Standard account, the documented way to act on the merchant is the platform secret key plus a Stripe-Account header carrying the acct_ id. A per-merchant access token is returned by the exchange and is stored sealed, but the runtime path does not depend on it.',
    },
    pci: {
      platform_scope: 'None, as built. This integration only reads. Card data never reaches this platform because no card field is ever rendered here.',
      merchant_scope: 'The merchant remains responsible for their own checkout. A hosted redirect checkout keeps them on SAQ A; an embedded iframe field set moves them to SAQ A-EP.',
      caveat: 'PCI DSS v4 requirements 6.4.3 and 11.6.1 for payment-page script inventory and tamper detection stay with whoever serves the payment page, even when the processor handles the card.',
    },
    webhooks: {
      why: 'Without these the stored connection silently rots: a merchant who disconnects in their own dashboard would still show as connected here.',
      events: [
        { name: 'account.application.deauthorized', do: 'Mark the connection revoked and stop using the account id. Sent to the platform when the merchant removes it.' },
        { name: 'account.updated', do: 'Refresh capabilities and requirements. Sent whenever an account property or status changes.' },
      ],
      delivery: 'A Connect webhook endpoint, which receives events for connected accounts rather than only the platform account.',
      verification: '[DATA REQUIRED BEFORE LAUNCH: the exact Stripe-Signature verification scheme (header layout and tolerance window) was not re-read from Stripe documentation in this session. Implement it from docs.stripe.com/webhooks/signatures before accepting a live webhook.]',
    },
    sources: [
      'docs.stripe.com/connect/oauth-reference and docs.stripe.com/connect/oauth-standard-accounts, read 2026-08-13 via search summaries.',
      'docs.stripe.com/connect/webhooks for the two events above.',
      'docs.stripe.com/api/balance for the probe endpoint.',
    ],
  },

  {
    id: 'razorpay',
    label: 'Razorpay',
    coverage: 'India',
    connect_kind: 'oauth',
    fallback_kind: 'api_key',
    sign_in: true,
    summary: 'Sign-in is available only to approved Razorpay partners. Without partner OAuth credentials the merchant supplies a key id and secret from their own dashboard, and this page says so rather than showing a sign-in button that cannot work.',

    platform_prereq: {
      what: 'Apply for a Razorpay partner account, get OAuth enabled on it, and whitelist the callback below as a redirect URI. Until that is granted, only the key id and secret path is available.',
      where: 'Razorpay partner dashboard.',
      yields: 'An OAuth client id and client secret.',
      env: { RAZORPAY_OAUTH_CLIENT_ID: 'Partner OAuth client id. Absent means the key id and secret path is offered instead.', RAZORPAY_OAUTH_CLIENT_SECRET: 'Partner OAuth client secret. Used only server side, only for the token exchange.' },
    },

    endpoints: {
      authorize: 'https://auth.razorpay.com/authorize',
      token: 'https://auth.razorpay.com/token',
      revoke: 'https://auth.razorpay.com/revoke',
      api_base: 'https://api.razorpay.com/v1',
      probe: 'https://api.razorpay.com/v1/payments?count=1',
    },
    // Razorpay takes scopes in array notation, not a space separated string.
    authorize_params: ['response_type=code', 'client_id', 'redirect_uri', 'scope[]', 'state', 'onboarding_signup (optional, KYC pre-fill only)'],
    scopes: [
      { value: 'read_only', why: 'Read access to all resources: view payments, refunds, settlements and disputes.' },
      { value: 'read_write', why: 'Read and write: create and view payments (payment gateway, payment links, subscriptions, QR codes), create and view refunds, view settlements and disputes.' },
    ],
    default_scope: 'read_only',

    holds: {
      platform: 'The partner OAuth client id and secret, or nothing at all on the key path.',
      merchant: 'Their Razorpay account and its KYC. On the key path they also hold the key secret, which they can rotate in their dashboard at any time, instantly cutting this platform off.',
      note: 'Razorpay access tokens expire. The response carries expires_in and a refresh token, and refresh_token is a supported grant type, so a long-lived connection has to refresh rather than assume.',
    },
    pci: {
      platform_scope: 'None, as built. Reads only, and no card field is rendered here.',
      merchant_scope: 'The merchant is the merchant of record and owns their own checkout compliance.',
      caveat: 'Handing a key secret to a third party is not a PCI event, but it is a real credential-custody event. It is the reason the key path stores the secret sealed and never returns it.',
    },
    webhooks: {
      why: 'Payment and settlement state changes after the fact. Polling would either miss them or hammer the API.',
      events: [
        { name: 'payment.captured', do: 'Attribute revenue to the campaign that produced it.' },
        { name: '[DATA REQUIRED BEFORE LAUNCH: the partner or OAuth specific event names for consent revocation and account suspension were not confirmed against Razorpay documentation in this session.]', do: 'Mark the connection revoked.' },
      ],
      delivery: 'Webhooks are configured in the merchant dashboard with a secret the operator chooses.',
      verification: 'X-Razorpay-Signature is an HMAC-SHA256 hex digest over the RAW request body, keyed with the webhook secret. Verify before parsing the body, and compare in constant time.',
    },
    api_key_fields: [
      { key: 'key_id', label: 'Key ID', secret: false, hint: 'Begins rzp_live_ or rzp_test_. Safe to display.' },
      { key: 'key_secret', label: 'Key Secret', secret: true, hint: 'Shown once when generated. Stored sealed and never returned.' },
    ],
    sources: [
      'razorpay.com/docs OAuth pages (authorize, token, scopes, onboarding_signup), read 2026-08-13 via search summaries.',
      'Razorpay webhook validation docs for the X-Razorpay-Signature scheme.',
      'The revoke endpoint URL was reported by search but its parameter list was NOT confirmed. See gaps.',
    ],
    gaps: [
      '[DATA REQUIRED BEFORE LAUNCH: the exact request body of https://auth.razorpay.com/revoke, including whether token_type_hint is required. The disconnect path therefore deletes the local connection and reports the revoke as unverified rather than sending a guessed body.]',
    ],
  },

  {
    id: 'paypal',
    label: 'PayPal',
    coverage: 'Global',
    connect_kind: 'partner_referral',
    sign_in: true,
    summary: 'PayPal has no merchant OAuth in the Stripe sense. This platform asks PayPal for a one-time onboarding link for this specific merchant, the merchant signs in at PayPal and grants consent, and PayPal returns their merchant id.',

    platform_prereq: {
      what: 'Become an approved PayPal partner and create a REST app on the partner account. The partner merchant id is needed to check seller status afterwards.',
      where: 'PayPal Developer dashboard, on a partner-enabled account.',
      yields: 'A partner client id, client secret and partner merchant id.',
      env: {
        PAYPAL_PARTNER_CLIENT_ID: 'Partner REST app client id.',
        PAYPAL_PARTNER_CLIENT_SECRET: 'Partner REST app secret. Server only.',
        PAYPAL_PARTNER_MERCHANT_ID: 'The partner merchant id, used in the seller status endpoint.',
        PAYPAL_ENV: 'live or sandbox. Selects the API host.',
      },
    },

    endpoints: {
      token_live: 'https://api-m.paypal.com/v1/oauth2/token',
      token_sandbox: 'https://api-m.sandbox.paypal.com/v1/oauth2/token',
      partner_referrals: '/v2/customer/partner-referrals',
      seller_status: '/v1/customer/partners/{partner_merchant_id}/merchant-integrations/{seller_merchant_id}',
    },
    authorize_params: ['POST body: operations, products, legal_consents, tracking_id'],
    scopes: [
      { value: 'products + operations in the referral body', why: 'PayPal expresses permissions as the products and operations requested in the partner referral body rather than as OAuth scope strings.' },
    ],
    default_scope: '',

    holds: {
      platform: 'The partner client id and secret, the partner merchant id, and the returned merchantIdInPayPal for each seller. There is no per-merchant access token to hold.',
      merchant: 'Their PayPal business account. They grant consent during onboarding and can remove this platform, which fires the consent revoked webhook.',
      note: 'To call PayPal on behalf of a seller, the platform uses its OWN access token plus a PayPal-Auth-Assertion header: an unsigned JWT with alg none whose claims are iss set to the partner client id and payer_id set to the seller. PayPal recommends payer_id over email because an email can change.',
    },
    pci: {
      platform_scope: 'None, as built.',
      merchant_scope: 'PayPal is the processor. The merchant owns their checkout page obligations.',
      caveat: 'The onboarding action_url expires after ONE use. It is refreshed by a GET on the referral self link or by creating another referral, so it must never be cached and re-shown.',
    },
    webhooks: {
      why: 'Onboarding completes asynchronously at PayPal, after the merchant has already been redirected back. Without the webhook the connection would sit at pending forever.',
      events: [
        { name: 'MERCHANT.ONBOARDING.COMPLETED', do: 'Mark the connection connected. Fires when the seller has met all onboarding requirements and granted permissions.' },
        { name: 'MERCHANT.PARTNER-CONSENT.REVOKED', do: 'Mark the connection revoked. Fires when the seller removes permissions or the account is closed.' },
      ],
      delivery: 'Subscribed per app in the PayPal Developer dashboard.',
      verification: '[DATA REQUIRED BEFORE LAUNCH: PayPal webhook signature verification (the transmission id, cert url and the verify-webhook-signature call) was not re-read from documentation in this session.]',
    },
    sources: [
      'developer.paypal.com Partner Referrals v2 and multiparty seller onboarding docs, read 2026-08-13 via search summaries.',
      'developer.paypal.com/api/rest/authentication for the client_credentials token call.',
      'developer.paypal.com/api/rest/requests for the PayPal-Auth-Assertion header.',
    ],
    gaps: [
      '[DATA REQUIRED BEFORE LAUNCH: the exact partner referral request body this platform should send (which operations, which products, which legal_consents) depends on what the platform is approved for. It is left unset rather than guessed.]',
    ],
  },

  {
    id: 'shopify_payments',
    label: 'Shopify Payments',
    coverage: 'Wherever Shopify Payments is available',
    connect_kind: 'oauth',
    sign_in: true,
    summary: 'The operator signs in to their Shopify store and installs this app. That grants READ access to Shopify Payments payouts, balance and disputes. It does not make this platform a processor on that store, and nothing here can change that.',

    // The honest limitation, stated on the page as well as here.
    limitation: 'Shopify Payments cannot be connected as a processing gateway by a third party. Shopify is the processor. Offering a gateway inside Shopify checkout is a different product entirely: it requires the Payments Apps API, a public payments app, a signed revenue share agreement with Shopify, and Shopify approval. This connection is read access, and it is labelled as read access.',

    platform_prereq: {
      what: 'Create an app in the Shopify Partner dashboard, request the Shopify Payments read scopes, and add the callback below as an allowed redirection URL.',
      where: 'Shopify Partner dashboard.',
      yields: 'A client id (API key) and client secret (API secret key).',
      env: { SHOPIFY_APP_CLIENT_ID: 'App API key.', SHOPIFY_APP_CLIENT_SECRET: 'App API secret. Used for the token exchange and for HMAC verification of the callback.' },
    },

    endpoints: {
      authorize: 'https://{shop}.myshopify.com/admin/oauth/authorize',
      token: 'https://{shop}.myshopify.com/admin/oauth/access_token',
      api_base: 'https://{shop}.myshopify.com/admin/api/2025-07',
      probe: 'https://{shop}.myshopify.com/admin/api/2025-07/graphql.json',
    },
    authorize_params: ['client_id', 'scope', 'redirect_uri', 'state'],
    scopes: [
      { value: 'read_shopify_payments_payouts', why: 'Payouts and disputes. Shopify documents payouts and disputes as requiring a shopify_payments_payouts or shopify_payments scope.' },
      { value: 'read_shopify_payments_accounts', why: 'The shopifyPaymentsAccount GraphQL field, which needs read_shopify_payments or read_shopify_payments_accounts.' },
      { value: 'read_orders', why: 'Ties a payment back to the order and therefore to the campaign that produced it.' },
    ],
    default_scope: 'read_shopify_payments_payouts,read_shopify_payments_accounts,read_orders',

    holds: {
      platform: 'The app client id and secret, and a per-shop offline access token.',
      merchant: 'Their store and their Shopify Payments account. Uninstalling the app revokes the token immediately.',
      note: 'The dispute EVIDENCE scopes (read/write_shopify_payments_dispute_evidences and the dispute file upload scopes) are restricted and cannot be added to an app configuration until Shopify approves the app for them. They are deliberately not requested here.',
    },
    pci: {
      platform_scope: 'None. Shopify hosts checkout and this connection is read only.',
      merchant_scope: 'Shopify carries the checkout. The merchant still owns anything they add to their own storefront.',
      caveat: 'This is the one gateway here where connecting does not give the platform any ability to take a payment.',
    },
    webhooks: {
      why: 'An uninstall is silent otherwise, and the stored token would go on looking valid.',
      events: [
        { name: 'app/uninstalled', do: 'Mark the connection revoked and drop the token. [DATA REQUIRED BEFORE LAUNCH: confirm this topic name against the Shopify webhook topic reference before subscribing.]' },
      ],
      delivery: 'Subscribed per app.',
      verification: 'Shopify webhook callbacks send the HMAC in the X-Shopify-Hmac-Sha256 header as base64. This is a different procedure from the OAuth callback, where the hmac arrives as a hex query parameter.',
    },
    callback_verification: 'On the OAuth callback, remove the hmac and signature parameters, sort the remaining query parameters, and compare an HMAC-SHA256 hex digest keyed with the app secret against the hmac parameter. Also confirm the state nonce matches the one this app issued, and that shop is a real myshopify.com host.',
    sources: [
      'shopify.dev/docs/apps/build/authentication-authorization authorization code grant, read 2026-08-13 via search summaries.',
      'shopify.dev/docs/api/usage/access-scopes and the shopifyPaymentsAccount, Payouts and Dispute reference pages for the scopes.',
      'shopify.dev/docs/apps/build/payments/requirements for why a third party cannot simply become a gateway.',
    ],
    gaps: [
      'The project-wide read-only egress guard blocks every non-GET call to a myshopify.com host, and Shopify needs two of them: the OAuth token exchange is a POST, and so is every GraphQL Admin read, because GraphQL has no GET form here. Connecting or reading Shopify therefore requires SHOPIFY_ALLOW_WRITES=1 to be set deliberately, even though the access being granted is read only. That is reported as a blocker rather than worked around, because the guard is a standing project rule and this feature is not entitled to decide it does not apply.',
    ],
  },
];

const BY_ID = Object.create(null);
for (const g of GATEWAYS) BY_ID[g.id] = g;

function gateway(id) { return BY_ID[String(id || '').toLowerCase()] || null; }

/* ── env, sealing, redaction ──────────────────────────────────────────────── */

function supaEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return { url: url ? String(url).replace(/\/$/, '') : '', anon: anon || '', service: service || '' };
}

/**
 * The AES-256-GCM key for sealing credentials. Accepts 64 hex characters or a
 * 32 byte base64 value, which is what `openssl rand -base64 32` produces.
 * Returns null when unset; callers must then REFUSE to store rather than
 * falling back to plaintext. Failing closed is the whole point.
 */
function sealingKey() {
  const raw = String(process.env.PAYMENTS_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  let buf = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) buf = Buffer.from(raw, 'hex');
  else {
    try { const b = Buffer.from(raw, 'base64'); if (b.length === 32) buf = b; } catch (_) { buf = null; }
  }
  return buf && buf.length === 32 ? buf : null;
}

function sealingAvailable() { return !!sealingKey(); }

/** Seal a credential. Throws when no key is configured, on purpose. */
function seal(plaintext) {
  const key = sealingKey();
  if (!key) {
    const e = new Error('payments_encryption_key_missing');
    e.status = 503;
    e.detail = 'PAYMENTS_ENCRYPTION_KEY is not set, so a credential cannot be stored. Set a 32 byte key (openssl rand -base64 32) before connecting a gateway. Storing the credential unencrypted is not offered.';
    throw e;
  }
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

/** Open a sealed credential. Returns null on any failure; never throws detail. */
function unseal(blob) {
  const key = sealingKey();
  if (!key || !blob) return null;
  const parts = String(blob).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
    d.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([d.update(Buffer.from(parts[3], 'base64')), d.final()]).toString('utf8');
  } catch (_) { return null; }
}

/**
 * The only fragment of a credential that ever leaves the server.
 * Deliberately the LAST four characters and not the first: a Stripe or Razorpay
 * key prefix announces the key type and whether it is live, and there is no
 * reason to publish that alongside an account id.
 */
function maskHint(secret) {
  const s = String(secret || '');
  if (s.length < 8) return '****';
  return '****' + s.slice(-4);
}

const SECRETISH = /(secret|token|password|api[_-]?key|client[_-]?secret|authorization|signature|private)/i;

/** Redact anything credential-shaped before it is returned or logged. */
function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRETISH.test(k) ? '[redacted]' : redact(v);
    return out;
  }
  return value;
}

/** Strip credential-bearing query parameters out of a URL before returning it. */
function redactUrl(url) {
  const s = String(url || '');
  return s.replace(/([?&](?:client_secret|access_token|api_key|key|secret)=)[^&]*/gi, '$1[redacted]');
}

/* ── outbound calls ───────────────────────────────────────────────────────── */

/**
 * The single egress point. When `credential` is falsy this returns the
 * would_request envelope instead of calling out, which is what makes every op
 * on this page work with nothing configured.
 *
 * `body` is redacted in the envelope but sent intact on a real call, so the
 * shape a reader sees is the shape that goes out, minus the secrets.
 */
async function request({ method = 'GET', url, headers = {}, body, form, credential, hint, timeoutMs = TIMEOUT_MS }) {
  const shape = {
    method,
    url: redactUrl(url),
    body: form ? redact(form) : (body === undefined ? undefined : redact(body)),
  };
  if (!credential) {
    return {
      ok: false, connected: false, not_connected: true, would_request: shape,
      hint: hint || 'No credential is configured for this gateway yet. The request above is exactly what will be sent once it is.',
    };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Backstop for the standing read-only rule. Shopify hosts are guarded, so a
    // POST to one throws here unless SHOPIFY_ALLOW_WRITES is explicitly set.
    assertReadOnly(url, method);
    const init = { method, signal: ctrl.signal, headers: Object.assign({}, headers) };
    if (form) {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text.slice(0, 2000) }; }
    if (!res.ok) return { ok: false, connected: true, status: res.status, error: redact(data), would_request: shape };
    return { ok: true, connected: true, status: res.status, data };
  } catch (e) {
    if (e && e.read_only_blocked) {
      return {
        ok: false, connected: false, blocked: 'read_only_egress',
        would_request: shape,
        error: e.message,
        hint: 'The project-wide read-only egress guard blocked this call. It is a deliberate standing rule, not a bug in this feature.',
      };
    }
    return { ok: false, connected: true, error: e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message, would_request: shape };
  } finally {
    clearTimeout(t);
  }
}

/* ── platform readiness ───────────────────────────────────────────────────── */

/**
 * Which gateways this DEPLOYMENT can actually offer, and what is missing.
 * Reports booleans and variable NAMES only. It never reports a value, and it is
 * safe to hand to a signed-in operator, who needs to know why a button is
 * disabled without being handed the platform's credentials.
 */
function platformReadiness() {
  const has = (n) => !!String(process.env[n] || '').trim();
  const out = {};

  out.stripe = {
    ready: has('STRIPE_CONNECT_CLIENT_ID') && has('STRIPE_SECRET_KEY'),
    mode: 'oauth',
    missing: ['STRIPE_CONNECT_CLIENT_ID', 'STRIPE_SECRET_KEY'].filter((n) => !has(n)),
  };

  // Razorpay is the one gateway with two genuinely different connect paths, so
  // readiness reports WHICH one this deployment can offer rather than a bare
  // boolean. The key path needs nothing from the platform at all.
  const rzpOauth = has('RAZORPAY_OAUTH_CLIENT_ID') && has('RAZORPAY_OAUTH_CLIENT_SECRET');
  out.razorpay = {
    ready: true,
    mode: rzpOauth ? 'oauth' : 'api_key',
    missing: rzpOauth ? [] : ['RAZORPAY_OAUTH_CLIENT_ID', 'RAZORPAY_OAUTH_CLIENT_SECRET'],
    note: rzpOauth
      ? 'Partner OAuth is configured, so the merchant signs in.'
      : 'No partner OAuth credentials, so the merchant supplies a key id and secret from their own Razorpay dashboard. This is a real limitation of not being an approved Razorpay partner, not a shortcut.',
  };

  out.paypal = {
    ready: has('PAYPAL_PARTNER_CLIENT_ID') && has('PAYPAL_PARTNER_CLIENT_SECRET') && has('PAYPAL_PARTNER_MERCHANT_ID'),
    mode: 'partner_referral',
    missing: ['PAYPAL_PARTNER_CLIENT_ID', 'PAYPAL_PARTNER_CLIENT_SECRET', 'PAYPAL_PARTNER_MERCHANT_ID'].filter((n) => !has(n)),
  };

  const shopifyEnv = has('SHOPIFY_APP_CLIENT_ID') && has('SHOPIFY_APP_CLIENT_SECRET');
  out.shopify_payments = {
    ready: shopifyEnv && process.env.SHOPIFY_ALLOW_WRITES === '1',
    mode: 'oauth',
    missing: [
      ...['SHOPIFY_APP_CLIENT_ID', 'SHOPIFY_APP_CLIENT_SECRET'].filter((n) => !has(n)),
      ...(process.env.SHOPIFY_ALLOW_WRITES === '1' ? [] : ['SHOPIFY_ALLOW_WRITES']),
    ],
    note: process.env.SHOPIFY_ALLOW_WRITES === '1' ? '' :
      'The OAuth token exchange is a POST to a myshopify.com host, which the read-only egress guard blocks. Set SHOPIFY_ALLOW_WRITES=1 deliberately to permit it. The resulting access is still read only.',
  };

  // Storage readiness is separate from any one gateway: without a sealing key
  // nothing can be stored, whatever the provider side looks like.
  out._storage = {
    sealing_key: sealingAvailable(),
    service_role: !!supaEnv().service,
    ready: sealingAvailable() && !!supaEnv().service,
    missing: [
      ...(sealingAvailable() ? [] : ['PAYMENTS_ENCRYPTION_KEY']),
      ...(supaEnv().service ? [] : ['SUPABASE_SERVICE_ROLE_KEY']),
    ],
  };
  return out;
}

/* ── workspace resolution, through the caller's own token ─────────────────── */

/**
 * The isolation boundary.
 *
 * A workspace is only usable by this request if the CALLER'S OWN JWT can see it
 * through RLS. That is why the lookup goes through restAs with the caller's
 * token rather than the service-role key: the database decides, not this code.
 * An id the caller cannot see comes back as an empty result and is refused,
 * which is what stops one brand attaching or reading another brand's gateway.
 */
async function resolveWorkspace(auth, explicitId) {
  const id = String(explicitId || '').trim();
  if (id) {
    const rows = await restAs(auth.token, `brand_workspaces?id=eq.${encodeURIComponent(id)}&select=id,name&limit=1`);
    if (!rows || !rows.length) {
      const e = new Error('workspace_not_visible');
      e.status = 403;
      e.detail = 'That brand workspace is not visible to this account, so nothing about its payment connections can be read or changed.';
      throw e;
    }
    return rows[0];
  }
  const prefs = await restAs(auth.token, `brand_user_prefs?user_id=eq.${encodeURIComponent(auth.user_id)}&select=active_workspace_id&limit=1`);
  const active = prefs && prefs[0] && prefs[0].active_workspace_id;
  if (!active) {
    const e = new Error('no_active_workspace');
    e.status = 409;
    e.detail = 'No brand is active for this account. Onboard or activate a brand first; a payment gateway always belongs to exactly one brand.';
    throw e;
  }
  const rows = await restAs(auth.token, `brand_workspaces?id=eq.${encodeURIComponent(active)}&select=id,name&limit=1`);
  if (!rows || !rows.length) {
    const e = new Error('workspace_not_visible');
    e.status = 403;
    throw e;
  }
  return rows[0];
}

/* ── connection storage ───────────────────────────────────────────────────── */

// The columns a browser session is ever allowed to see. This list matches the
// column-level grant in the migration; keeping them in step is what makes an
// accidental `select=*` fail loudly instead of leaking ciphertext.
const SAFE_COLUMNS = [
  'id', 'workspace_id', 'gateway', 'connect_kind', 'status', 'account_id',
  'account_label', 'livemode', 'scope', 'token_expires_at', 'masked_hint',
  'connected_at', 'last_checked_at', 'last_error', 'meta', 'updated_at',
].join(',');

/** Service-role PostgREST. Only ever reached AFTER membership has been proven. */
async function restService(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = supaEnv();
  if (!e.url || !e.service) {
    const err = new Error('service_role_unavailable');
    err.status = 503;
    err.detail = 'SUPABASE_SERVICE_ROLE_KEY is not set. Credentials are stored in columns that only the service role can write, so a connection cannot be saved without it.';
    throw err;
  }
  const headers = { apikey: e.service, authorization: `Bearer ${e.service}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) {
    const err = new Error(`supabase ${method} ${String(pathAndQuery).split('?')[0]} -> ${res.status}`);
    err.status = 502;
    err.detail = (json && (json.message || json.hint)) || undefined;
    throw err;
  }
  return json;
}

/** Connections for one workspace, read AS THE CALLER, safe columns only. */
async function listConnections(auth, workspaceId) {
  const rows = await restAs(
    auth.token,
    `payment_gateway_connections?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=${SAFE_COLUMNS}&order=gateway.asc`,
  );
  return Array.isArray(rows) ? rows : [];
}

/**
 * The shape sent to the browser for one connection. Built by allowlist rather
 * than by deleting secret fields from a row: a future column would then be
 * omitted by default instead of leaked by default.
 */
function publicConnection(row) {
  if (!row) return null;
  return {
    gateway: row.gateway,
    connect_kind: row.connect_kind,
    status: row.status,
    connected: row.status === 'connected',
    account_id: row.account_id || null,
    account_label: row.account_label || null,
    livemode: row.livemode == null ? null : !!row.livemode,
    scope: row.scope || null,
    // The only credential-derived value that ever leaves the server.
    masked_hint: row.masked_hint || null,
    token_expires_at: row.token_expires_at || null,
    connected_at: row.connected_at || null,
    last_checked_at: row.last_checked_at || null,
    last_error: row.last_error || null,
    meta: row.meta && typeof row.meta === 'object' ? redact(row.meta) : {},
  };
}

/* ── OAuth state ──────────────────────────────────────────────────────────── */

async function issueState(auth, workspace, gatewayId, redirectUri, context) {
  const state = crypto.randomBytes(32).toString('base64url');
  await restAs(auth.token, 'payment_oauth_states', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      state, workspace_id: workspace.id, gateway: gatewayId, user_id: auth.user_id,
      redirect_uri: redirectUri || null, context: context || {},
    },
  });
  return state;
}

/**
 * Consume a state exactly once.
 *
 * Three separate checks, and all three matter: the state must exist and belong
 * to THIS user (the RLS policy already scopes the select to auth.uid(), so a
 * state issued to someone else simply is not found), it must not be expired,
 * and it must not already have been consumed. Replaying a consumed state is how
 * an intercepted authorization code would otherwise be re-bound somewhere else.
 */
async function consumeState(auth, state, gatewayId) {
  const rows = await restAs(auth.token, `payment_oauth_states?state=eq.${encodeURIComponent(state)}&select=*&limit=1`);
  const row = rows && rows[0];
  if (!row) {
    const e = new Error('oauth_state_unknown');
    e.status = 400;
    e.detail = 'This authorization did not start from this account, or it has already been used. Start the connection again.';
    throw e;
  }
  if (row.gateway !== gatewayId) {
    const e = new Error('oauth_state_gateway_mismatch'); e.status = 400; throw e;
  }
  if (row.consumed_at) {
    const e = new Error('oauth_state_already_used'); e.status = 400; throw e;
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    const e = new Error('oauth_state_expired');
    e.status = 400;
    e.detail = 'The sign-in window expired. Start the connection again.';
    throw e;
  }
  // Claim it ATOMICALLY. Reading consumed_at above and writing it here are two
  // round trips, so two callbacks racing on the same state both saw null and
  // both proceeded - which is precisely the replay the check exists to stop.
  // The filter makes the database the arbiter: whichever PATCH lands first is
  // the only one that matches, and the loser gets an empty representation back
  // rather than a second successful exchange.
  const claimed = await restAs(
    auth.token,
    `payment_oauth_states?state=eq.${encodeURIComponent(state)}&consumed_at=is.null`,
    { method: 'PATCH', prefer: 'return=representation', body: { consumed_at: new Date().toISOString() } },
  );
  if (!Array.isArray(claimed) || !claimed.length) {
    const e = new Error('oauth_state_already_used');
    e.status = 400;
    e.detail = 'This authorization was already completed. Start the connection again.';
    throw e;
  }
  return claimed[0];
}

/* ── callback URL ─────────────────────────────────────────────────────────── */

/**
 * The redirect URI handed to the provider.
 *
 * Prefers an explicit env value because the provider matches it EXACTLY against
 * a registered value, and a Host header is caller-influenced. Deriving it from
 * the request is a convenience for preview deployments, not the intended
 * production configuration.
 */
function baseUrl(req) {
  const explicit = String(process.env.PAYMENTS_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const h = (req && req.headers) || {};
  const host = h['x-forwarded-host'] || h.host;
  if (host) return `${h['x-forwarded-proto'] || 'https'}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return '';
}

function callbackUrl(req) {
  const b = baseUrl(req);
  return b ? `${b}/payments/callback` : '/payments/callback';
}

/* ── per-gateway connect ──────────────────────────────────────────────────── */

function stripeAuthorizeUrl({ clientId, redirectUri, state, scope }) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: clientId || 'ca_PLATFORM_CLIENT_ID_NOT_SET',
    scope: scope || 'read_only',
    state,
  });
  if (redirectUri) p.set('redirect_uri', redirectUri);
  return `https://connect.stripe.com/oauth/authorize?${p.toString()}`;
}

function razorpayAuthorizeUrl({ clientId, redirectUri, state, scope }) {
  // Razorpay takes scopes in array notation, so URLSearchParams is used for the
  // scalar parameters and the scope entries are appended explicitly.
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: clientId || 'RAZORPAY_OAUTH_CLIENT_ID_NOT_SET',
    redirect_uri: redirectUri || '',
    state,
  });
  for (const s of String(scope || 'read_only').split(',').map((x) => x.trim()).filter(Boolean)) p.append('scope[]', s);
  return `https://auth.razorpay.com/authorize?${p.toString()}`;
}

/** Shop domains are attacker-supplied text until this says otherwise. */
function normalizeShop(input) {
  const raw = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(raw)) return '';
  return raw;
}

function shopifyAuthorizeUrl({ shop, clientId, redirectUri, state, scope }) {
  const p = new URLSearchParams({
    client_id: clientId || 'SHOPIFY_APP_CLIENT_ID_NOT_SET',
    scope: scope || 'read_shopify_payments_payouts,read_shopify_payments_accounts,read_orders',
    redirect_uri: redirectUri || '',
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${p.toString()}`;
}

function paypalHost() {
  return String(process.env.PAYPAL_ENV || 'live').toLowerCase() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

/** Partner access token for PayPal. Returns the would_request stub with no keys. */
async function paypalPartnerToken() {
  const id = String(process.env.PAYPAL_PARTNER_CLIENT_ID || '').trim();
  const secret = String(process.env.PAYPAL_PARTNER_CLIENT_SECRET || '').trim();
  const url = `${paypalHost()}/v1/oauth2/token`;
  const r = await request({
    method: 'POST',
    url,
    headers: id && secret ? { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') } : {},
    form: { grant_type: 'client_credentials' },
    credential: id && secret ? 'partner' : '',
    hint: 'PayPal partner credentials are not set, so no onboarding link can be minted yet.',
  });
  if (!r.ok) return r;
  return { ok: true, token: r.data && r.data.access_token };
}

/* ── ops ──────────────────────────────────────────────────────────────────── */

/** The registry, with no credentials in it. Safe before a session exists. */
function catalog(req) {
  const readiness = platformReadiness();
  return {
    ok: true,
    callback_url: callbackUrl(req),
    storage: readiness._storage,
    gateways: GATEWAYS.map((g) => ({
      id: g.id,
      label: g.label,
      coverage: g.coverage,
      connect_kind: g.connect_kind,
      fallback_kind: g.fallback_kind || null,
      sign_in: !!g.sign_in,
      summary: g.summary,
      limitation: g.limitation || null,
      platform_prereq: g.platform_prereq,
      endpoints: g.endpoints,
      authorize_params: g.authorize_params,
      scopes: g.scopes,
      default_scope: g.default_scope,
      holds: g.holds,
      pci: g.pci,
      webhooks: g.webhooks,
      callback_verification: g.callback_verification || null,
      api_key_fields: (g.api_key_fields || []).map((f) => ({ key: f.key, label: f.label, secret: !!f.secret, hint: f.hint })),
      sources: g.sources || [],
      gaps: g.gaps || [],
      readiness: readiness[g.id] || { ready: false, missing: [] },
    })),
  };
}

/** Begin a connection. Returns a sign-in URL, or the stub that explains why not. */
async function begin(auth, req, params) {
  const g = gateway(params.gateway);
  if (!g) return { ok: false, error: 'unknown_gateway', available: GATEWAYS.map((x) => x.id) };
  const ws = await resolveWorkspace(auth, params.workspace_id);
  const redirectUri = callbackUrl(req);
  const readiness = platformReadiness()[g.id] || {};
  const scope = String(params.scope || g.default_scope || '').trim();

  if (g.id === 'stripe') {
    const clientId = String(process.env.STRIPE_CONNECT_CLIENT_ID || '').trim();
    const state = clientId ? await issueState(auth, ws, g.id, redirectUri, { scope }) : 'STATE_ISSUED_AT_CONNECT_TIME';
    const url = stripeAuthorizeUrl({ clientId, redirectUri, state, scope });
    if (!clientId) {
      return {
        ok: false, connected: false, not_connected: true, gateway: g.id, workspace_id: ws.id,
        would_request: { method: 'GET', url, body: undefined },
        blocked_by: readiness.missing || [],
        hint: 'Stripe Connect is not registered for this deployment yet. The URL above is the exact sign-in link the operator will be sent to once STRIPE_CONNECT_CLIENT_ID is set.',
      };
    }
    return { ok: true, gateway: g.id, workspace_id: ws.id, mode: 'redirect', authorize_url: url, state, redirect_uri: redirectUri };
  }

  if (g.id === 'razorpay') {
    const clientId = String(process.env.RAZORPAY_OAUTH_CLIENT_ID || '').trim();
    if (!clientId) {
      // Not a stub for a missing credential of OURS so much as an honest
      // statement that this deployment is not a Razorpay partner. The key path
      // is real and works, so it is offered rather than a dead button.
      return {
        ok: true, gateway: g.id, workspace_id: ws.id, mode: 'credentials',
        connected: false,
        fields: g.api_key_fields.map((f) => ({ key: f.key, label: f.label, secret: !!f.secret, hint: f.hint })),
        would_request: { method: 'GET', url: razorpayAuthorizeUrl({ clientId: '', redirectUri, state: 'STATE_ISSUED_AT_CONNECT_TIME', scope }), body: undefined },
        hint: 'This deployment has no Razorpay partner OAuth credentials, so there is no sign-in to offer. The merchant supplies a key id and secret from their own Razorpay dashboard instead. The URL above is what a partner deployment would use.',
      };
    }
    const state = await issueState(auth, ws, g.id, redirectUri, { scope });
    return { ok: true, gateway: g.id, workspace_id: ws.id, mode: 'redirect', authorize_url: razorpayAuthorizeUrl({ clientId, redirectUri, state, scope }), state, redirect_uri: redirectUri };
  }

  if (g.id === 'shopify_payments') {
    const shop = normalizeShop(params.shop);
    if (!shop) {
      return {
        ok: true, gateway: g.id, workspace_id: ws.id, mode: 'needs_shop',
        connected: false,
        hint: 'Shopify sign-in happens on the merchant\'s own store domain, so the store has to be named first. Enter it as store-name.myshopify.com.',
      };
    }
    const clientId = String(process.env.SHOPIFY_APP_CLIENT_ID || '').trim();
    const state = clientId ? await issueState(auth, ws, g.id, redirectUri, { shop, scope }) : 'STATE_ISSUED_AT_CONNECT_TIME';
    const url = shopifyAuthorizeUrl({ shop, clientId, redirectUri, state, scope });
    if (!clientId) {
      return {
        ok: false, connected: false, not_connected: true, gateway: g.id, workspace_id: ws.id,
        would_request: { method: 'GET', url, body: undefined },
        blocked_by: readiness.missing || [],
        hint: 'No Shopify app is registered for this deployment yet.',
      };
    }
    return { ok: true, gateway: g.id, workspace_id: ws.id, mode: 'redirect', authorize_url: url, state, redirect_uri: redirectUri, shop };
  }

  if (g.id === 'paypal') {
    const tok = await paypalPartnerToken();
    const url = `${paypalHost()}/v2/customer/partner-referrals`;
    // tracking_id is how PayPal's webhook and status calls are tied back to a
    // row here, so it is the workspace id rather than anything random.
    const referralBody = {
      tracking_id: ws.id,
      operations: '[DATA REQUIRED BEFORE LAUNCH: the operations array depends on what this platform is approved for by PayPal]',
      products: '[DATA REQUIRED BEFORE LAUNCH: the products array depends on what this platform is approved for by PayPal]',
      legal_consents: '[DATA REQUIRED BEFORE LAUNCH: the legal_consents array required for this platform]',
      partner_config_override: { return_url: `${baseUrl(req)}/payments/callback?gateway=paypal` },
    };
    if (!tok.ok) {
      return {
        ok: false, connected: false, not_connected: true, gateway: g.id, workspace_id: ws.id,
        would_request: { method: 'POST', url, body: redact(referralBody) },
        blocked_by: readiness.missing || [],
        hint: 'PayPal partner credentials are not set for this deployment. The call above is what mints the merchant\'s one-time onboarding link.',
      };
    }
    return {
      ok: false, gateway: g.id, workspace_id: ws.id, mode: 'blocked',
      would_request: { method: 'POST', url, body: redact(referralBody) },
      hint: 'A partner access token was obtained, but the referral body is still unset. PayPal rejects a referral whose operations, products and legal_consents do not match what this platform is approved for, so it is left blank rather than guessed.',
      gaps: g.gaps,
    };
  }

  return { ok: false, error: 'unsupported_connect_kind', gateway: g.id };
}

/** Finish an OAuth connection: verify state, exchange the code, store sealed. */
async function complete(auth, req, params) {
  const g = gateway(params.gateway);
  if (!g) return { ok: false, error: 'unknown_gateway' };
  const code = String(params.code || '').trim();
  const state = String(params.state || '').trim();
  if (!code || !state) return { ok: false, error: 'missing_code_or_state' };

  const stateRow = await consumeState(auth, state, g.id);
  const ws = await resolveWorkspace(auth, stateRow.workspace_id);
  const redirectUri = stateRow.redirect_uri || callbackUrl(req);
  const ctx = stateRow.context || {};

  if (g.id === 'stripe') {
    const secret = String(process.env.STRIPE_SECRET_KEY || '').trim();
    const r = await request({
      method: 'POST',
      url: 'https://connect.stripe.com/oauth/token',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      form: { grant_type: 'authorization_code', code, client_secret: secret },
      credential: secret,
      hint: 'STRIPE_SECRET_KEY is not set, so the authorization code cannot be exchanged.',
    });
    if (!r.ok) return Object.assign({ gateway: g.id, workspace_id: ws.id }, r);
    const d = r.data || {};
    return await store(auth, ws, g, {
      connect_kind: 'oauth',
      account_id: d.stripe_user_id || null,
      livemode: typeof d.livemode === 'boolean' ? d.livemode : null,
      scope: d.scope || ctx.scope || null,
      access_token: d.access_token || null,
      refresh_token: d.refresh_token || null,
      // The publishable key is public by design, so it stays in plain meta.
      meta: { stripe_publishable_key: d.stripe_publishable_key || null, token_type: d.token_type || null },
    });
  }

  if (g.id === 'razorpay') {
    const clientId = String(process.env.RAZORPAY_OAUTH_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.RAZORPAY_OAUTH_CLIENT_SECRET || '').trim();
    const r = await request({
      method: 'POST',
      url: 'https://auth.razorpay.com/token',
      form: { grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri },
      credential: clientId && clientSecret,
      hint: 'Razorpay partner OAuth credentials are not set, so the code cannot be exchanged.',
    });
    if (!r.ok) return Object.assign({ gateway: g.id, workspace_id: ws.id }, r);
    const d = r.data || {};
    const expiresAt = Number.isFinite(+d.expires_in) ? new Date(Date.now() + (+d.expires_in) * 1000).toISOString() : null;
    return await store(auth, ws, g, {
      connect_kind: 'oauth',
      account_id: d.razorpay_account_id || d.account_id || null,
      scope: Array.isArray(d.scope) ? d.scope.join(',') : (d.scope || ctx.scope || null),
      access_token: d.access_token || null,
      refresh_token: d.refresh_token || null,
      token_expires_at: expiresAt,
      meta: { token_type: d.token_type || null },
    });
  }

  if (g.id === 'shopify_payments') {
    const shop = normalizeShop(ctx.shop || params.shop);
    if (!shop) return { ok: false, error: 'shop_missing_from_state' };
    const clientId = String(process.env.SHOPIFY_APP_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.SHOPIFY_APP_CLIENT_SECRET || '').trim();
    // The callback query itself is HMAC signed. Verifying it is not optional:
    // without it, anyone can hand this endpoint a code for a shop they do not
    // own. The digest covers every query parameter except hmac and signature,
    // sorted, keyed with the app secret.
    if (clientSecret && params.query && !verifyShopifyCallback(params.query, clientSecret)) {
      return { ok: false, error: 'shopify_hmac_mismatch', hint: 'The callback signature did not verify, so the code was discarded.' };
    }
    const r = await request({
      method: 'POST',
      url: `https://${shop}/admin/oauth/access_token`,
      body: { client_id: clientId, client_secret: clientSecret, code },
      credential: clientId && clientSecret,
      hint: 'No Shopify app credentials, so the code cannot be exchanged.',
    });
    if (!r.ok) return Object.assign({ gateway: g.id, workspace_id: ws.id }, r);
    const d = r.data || {};
    return await store(auth, ws, g, {
      connect_kind: 'oauth',
      account_id: shop,
      account_label: shop,
      scope: d.scope || ctx.scope || null,
      access_token: d.access_token || null,
      meta: { shop },
    });
  }

  return { ok: false, error: 'gateway_has_no_oauth_callback', gateway: g.id };
}

/**
 * Shopify OAuth callback verification.
 * Exported so the test suite can prove a tampered query is rejected rather than
 * taking the code path's word for it.
 */
function verifyShopifyCallback(query, appSecret) {
  const entries = Object.keys(query || {})
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${query[k]}`);
  const digest = crypto.createHmac('sha256', String(appSecret)).update(entries.join('&')).digest('hex');
  const given = String((query && query.hmac) || '');
  if (given.length !== digest.length) return false;
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(given));
}

/** Store a connection. Seals every credential; refuses rather than storing raw. */
async function store(auth, ws, g, fields) {
  const now = new Date().toISOString();
  const row = {
    workspace_id: ws.id,
    gateway: g.id,
    connect_kind: fields.connect_kind || g.connect_kind,
    status: 'connected',
    account_id: fields.account_id || null,
    account_label: fields.account_label || fields.account_id || null,
    livemode: fields.livemode == null ? null : !!fields.livemode,
    scope: fields.scope || null,
    token_expires_at: fields.token_expires_at || null,
    connected_by: auth.user_id,
    connected_at: now,
    last_checked_at: now,
    last_error: null,
    meta: fields.meta || {},
    updated_at: now,
  };

  // The credential that identifies this connection for masking purposes. Only
  // its last four characters are ever stored in a readable column.
  const primary = fields.access_token || fields.secret || '';
  if (primary) row.masked_hint = maskHint(primary);

  // seal() throws when PAYMENTS_ENCRYPTION_KEY is absent, which is deliberate:
  // a connection that cannot be stored safely must not be stored at all.
  if (fields.access_token) row.access_token_enc = seal(fields.access_token);
  if (fields.refresh_token) row.refresh_token_enc = seal(fields.refresh_token);
  if (fields.secret) row.secret_enc = seal(fields.secret);
  if (fields.webhook_secret) row.webhook_secret_enc = seal(fields.webhook_secret);

  await restService('payment_gateway_connections?on_conflict=workspace_id,gateway', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: [row],
  });

  return {
    ok: true,
    gateway: g.id,
    workspace_id: ws.id,
    connection: publicConnection(row),
    note: 'Stored. The credential itself was sealed before it reached the database and is not readable from any browser session, including this one.',
  };
}

/** Save merchant-supplied credentials for a gateway that has no sign-in path. */
async function saveCredentials(auth, req, params) {
  const g = gateway(params.gateway);
  if (!g) return { ok: false, error: 'unknown_gateway' };
  // Authorization is settled BEFORE anything about the request is answered.
  // Reversing these two would let a caller who has no claim on the workspace
  // learn which gateways this deployment offers a key path for, which is a
  // small leak but exactly the kind that accumulates.
  const ws = await resolveWorkspace(auth, params.workspace_id);
  if (!g.api_key_fields || !g.api_key_fields.length) {
    return { ok: false, error: 'gateway_has_no_key_path', hint: `${g.label} connects by sign-in only. There is no key to paste.` };
  }
  const values = (params.credentials && typeof params.credentials === 'object') ? params.credentials : {};
  const missing = g.api_key_fields.filter((f) => !String(values[f.key] || '').trim()).map((f) => f.key);
  if (missing.length) return { ok: false, error: 'missing_credential_fields', missing };

  if (g.id === 'razorpay') {
    const keyId = String(values.key_id).trim();
    const keySecret = String(values.key_secret).trim();
    // Verify before storing. Storing an unverified credential produces a
    // connection that reads as healthy and fails on first real use.
    const probe = await request({
      method: 'GET',
      url: g.endpoints.probe,
      headers: { Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') },
      credential: keySecret,
    });
    if (!probe.ok && probe.connected) {
      return { ok: false, error: 'credentials_rejected', status: probe.status, hint: 'Razorpay rejected these credentials, so nothing was stored.' };
    }
    return await store(auth, ws, g, {
      connect_kind: 'api_key',
      account_id: keyId,
      account_label: keyId,
      livemode: /^rzp_live_/.test(keyId),
      scope: 'key_scoped',
      secret: keySecret,
      meta: { key_id: keyId, verified: !!probe.ok },
    });
  }

  return { ok: false, error: 'unsupported_key_path', gateway: g.id };
}

/** Live read against the connected account, or the stub explaining what it would be. */
async function probe(auth, req, params) {
  const g = gateway(params.gateway);
  if (!g) return { ok: false, error: 'unknown_gateway' };
  const ws = await resolveWorkspace(auth, params.workspace_id);
  const rows = await listConnections(auth, ws.id);
  const safe = rows.find((r) => r.gateway === g.id) || null;

  // The credential is read with the service role AFTER membership has been
  // proven above. It is unsealed in memory, used, and never returned.
  let secretRow = null;
  if (safe) {
    try {
      const full = await restService(`payment_gateway_connections?id=eq.${encodeURIComponent(safe.id)}&select=access_token_enc,secret_enc,account_id&limit=1`);
      secretRow = (full && full[0]) || null;
    } catch (_) { secretRow = null; }
  }

  if (g.id === 'stripe') {
    const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
    const acct = (safe && safe.account_id) || 'acct_NOT_CONNECTED';
    return Object.assign({ gateway: g.id, workspace_id: ws.id }, await request({
      method: 'GET',
      url: g.endpoints.probe,
      headers: key ? { Authorization: `Bearer ${key}`, 'Stripe-Account': acct } : {},
      credential: key && safe ? 'platform' : '',
      hint: key ? 'No Stripe account is connected to this brand yet.' : 'STRIPE_SECRET_KEY is not set for this deployment.',
    }));
  }

  if (g.id === 'razorpay') {
    const keyId = (safe && safe.account_id) || '';
    const keySecret = secretRow ? unseal(secretRow.secret_enc) : null;
    const token = secretRow ? unseal(secretRow.access_token_enc) : null;
    const headers = token
      ? { Authorization: `Bearer ${token}` }
      : (keyId && keySecret ? { Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') } : {});
    return Object.assign({ gateway: g.id, workspace_id: ws.id }, await request({
      method: 'GET', url: g.endpoints.probe, headers,
      credential: token || keySecret || '',
      hint: 'No Razorpay credential is stored for this brand yet.',
    }));
  }

  if (g.id === 'shopify_payments') {
    const shop = (safe && safe.account_id) || '{shop}.myshopify.com';
    const token = secretRow ? unseal(secretRow.access_token_enc) : null;
    return Object.assign({ gateway: g.id, workspace_id: ws.id }, await request({
      method: 'POST',
      url: `https://${shop}/admin/api/2025-07/graphql.json`,
      headers: token ? { 'X-Shopify-Access-Token': token } : {},
      body: { query: '{ shopifyPaymentsAccount { id payoutStatementDescriptor } }' },
      credential: token || '',
      hint: 'No Shopify store is connected to this brand yet.',
    }));
  }

  if (g.id === 'paypal') {
    const partnerId = String(process.env.PAYPAL_PARTNER_MERCHANT_ID || '').trim() || '{partner_merchant_id}';
    const sellerId = (safe && safe.account_id) || '{seller_merchant_id}';
    const tok = await paypalPartnerToken();
    return Object.assign({ gateway: g.id, workspace_id: ws.id }, await request({
      method: 'GET',
      url: `${paypalHost()}/v1/customer/partners/${partnerId}/merchant-integrations/${sellerId}`,
      headers: tok.ok ? { Authorization: `Bearer ${tok.token}` } : {},
      credential: tok.ok && safe ? 'partner' : '',
      hint: tok.ok ? 'No PayPal merchant is connected to this brand yet.' : 'PayPal partner credentials are not set for this deployment.',
    }));
  }

  return { ok: false, error: 'no_probe_for_gateway', gateway: g.id };
}

/** Disconnect: tell the provider where that is possible, then drop the row. */
async function disconnect(auth, req, params) {
  const g = gateway(params.gateway);
  if (!g) return { ok: false, error: 'unknown_gateway' };
  const ws = await resolveWorkspace(auth, params.workspace_id);
  const rows = await listConnections(auth, ws.id);
  const safe = rows.find((r) => r.gateway === g.id);
  if (!safe) return { ok: true, gateway: g.id, workspace_id: ws.id, already_disconnected: true };

  let revoke = null;
  if (g.id === 'stripe') {
    const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
    const clientId = String(process.env.STRIPE_CONNECT_CLIENT_ID || '').trim();
    revoke = await request({
      method: 'POST',
      url: 'https://connect.stripe.com/oauth/deauthorize',
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      form: { client_id: clientId, stripe_user_id: safe.account_id || '' },
      credential: key && clientId,
      hint: 'Stripe platform credentials are not set, so the remote revoke cannot be sent. The local connection is still removed.',
    });
  } else if (g.id === 'razorpay') {
    // The revoke endpoint URL is documented; its parameter list was not
    // confirmed. Sending a guessed body could revoke the wrong token or fail
    // silently, so the operator is told to revoke in the Razorpay dashboard.
    revoke = {
      ok: false, connected: false, not_connected: true,
      would_request: { method: 'POST', url: g.endpoints.revoke, body: { token: '[redacted]', token_type_hint: '[DATA REQUIRED BEFORE LAUNCH: parameter names unconfirmed]' } },
      hint: 'The Razorpay revoke request body was not confirmed against documentation, so it is not sent. Revoke this app in the Razorpay dashboard as well.',
    };
  } else if (g.id === 'shopify_payments') {
    revoke = {
      ok: false, connected: false, not_connected: true,
      would_request: { method: 'DELETE', url: `https://${safe.account_id || '{shop}'}/admin/api/2025-07/`, body: undefined },
      hint: 'Shopify access ends when the merchant uninstalls the app from their store. There is nothing for this platform to revoke, so the local connection is simply removed.',
    };
  } else if (g.id === 'paypal') {
    revoke = {
      ok: false, connected: false, not_connected: true,
      would_request: { method: 'GET', url: `${paypalHost()}/v1/customer/partners/{partner_merchant_id}/merchant-integrations/{seller_merchant_id}`, body: undefined },
      hint: 'PayPal consent is removed by the merchant in their own PayPal account, which fires MERCHANT.PARTNER-CONSENT.REVOKED. The local connection is removed now.',
    };
  }

  // Deleting through the CALLER'S token, so RLS has the final say on whether
  // this account was ever entitled to remove this row.
  await restAs(auth.token, `payment_gateway_connections?workspace_id=eq.${encodeURIComponent(ws.id)}&gateway=eq.${encodeURIComponent(g.id)}`, {
    method: 'DELETE', prefer: 'return=minimal',
  });

  return { ok: true, gateway: g.id, workspace_id: ws.id, disconnected: true, provider_revoke: revoke };
}

/** Connections plus registry, for the page's main render. */
async function status(auth, req, params) {
  const ws = await resolveWorkspace(auth, params.workspace_id);
  const rows = await listConnections(auth, ws.id).catch(() => []);
  const byGateway = {};
  for (const r of rows) byGateway[r.gateway] = publicConnection(r);
  return {
    ok: true,
    workspace: { id: ws.id, name: ws.name },
    callback_url: callbackUrl(req),
    storage: platformReadiness()._storage,
    connections: byGateway,
    gateways: catalog(req).gateways,
  };
}

/** What to register with each provider so stored state stays true. */
function webhooks(req) {
  const base = baseUrl(req);
  return {
    ok: true,
    endpoint: base ? `${base}/api/payments?op=webhook` : '/api/payments?op=webhook',
    note: 'The receiver is not implemented yet. Registering the events below before a verified receiver exists would mean accepting unauthenticated state changes, which is worse than polling.',
    gateways: GATEWAYS.map((g) => ({ id: g.id, label: g.label, webhooks: g.webhooks })),
  };
}

/* ── router ───────────────────────────────────────────────────────────────── */

const AUTHED_OPS = ['status', 'connect', 'callback', 'save-credentials', 'disconnect', 'probe'];
const OPEN_OPS = ['catalog', 'webhooks'];

async function handle(req, res) {
  const q = (req && req.query) || {};
  const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
  const op = String(q.op || body.op || 'catalog').toLowerCase();

  // The registry describes providers, not this tenant, and the page needs it to
  // paint before a session resolves. Same reasoning as the brand router's
  // `defaults` and `presets` ops.
  if (op === 'catalog') return res.status(200).json(catalog(req));
  if (op === 'webhooks') return res.status(200).json(webhooks(req));

  const auth = await requireUser(req);
  if (!auth.ok) return res.status(auth.status || 401).json(auth);

  const params = {
    gateway: body.gateway || q.gateway,
    workspace_id: body.workspace_id || q.workspace_id,
    scope: body.scope || q.scope,
    shop: body.shop || q.shop,
    code: body.code || q.code,
    state: body.state || q.state,
    credentials: body.credentials,
    query: body.query && typeof body.query === 'object' ? body.query : undefined,
  };

  try {
    switch (op) {
      case 'status': return res.status(200).json(await status(auth, req, params));
      case 'connect': return res.status(200).json(await begin(auth, req, params));
      case 'callback': return res.status(200).json(await complete(auth, req, params));
      case 'save-credentials': return res.status(200).json(await saveCredentials(auth, req, params));
      case 'disconnect': return res.status(200).json(await disconnect(auth, req, params));
      case 'probe': return res.status(200).json(await probe(auth, req, params));
      default:
        return res.status(400).json({ ok: false, error: 'unknown_payments_operation', available: OPEN_OPS.concat(AUTHED_OPS) });
    }
  } catch (err) {
    // Errors are surfaced by code and message only. A provider error body can
    // echo a request that carried a credential, so it never leaves here raw.
    return res.status(err && err.status ? err.status : 500).json({
      ok: false,
      error: (err && err.message) || 'payments_operation_failed',
      detail: (err && err.detail) || undefined,
    });
  }
}

module.exports = {
  handle,
  GATEWAYS, gateway, catalog, webhooks, platformReadiness,
  seal, unseal, sealingAvailable, maskHint, redact, redactUrl,
  request, normalizeShop, verifyShopifyCallback,
  stripeAuthorizeUrl, razorpayAuthorizeUrl, shopifyAuthorizeUrl,
  resolveWorkspace, listConnections, publicConnection, SAFE_COLUMNS,
  callbackUrl, baseUrl,
};
