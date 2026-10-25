'use strict';
/**
 * workspace-connections-core.js — bring your own integrations, and your own AI.
 * ---------------------------------------------------------------------------
 * Every brand workspace can connect the platforms it actually uses (commerce,
 * ads, lifecycle) and supply its own AI provider keys, then choose which models
 * run its generations and in what priority order. A workspace that connects
 * nothing keeps running on the platform's own keys and the default cascade in
 * llm.js, unchanged.
 *
 * WHERE SECRETS LIVE, AND WHY THERE.
 *   A user's API key is the one thing here that is worth stealing, so it is
 *   kept out of every place it could leak from:
 *     * It is encrypted (AES-256-GCM) inside this runtime before it is sent to
 *       Postgres, under CONNECTION_SECRET_KEY, which lives only in the server
 *       environment. A database dump on its own is not enough to use a key.
 *     * The ciphertext sits in its own table, workspace_connection_secrets,
 *       which has RLS on and NO POLICY: anon and authenticated select nothing
 *       from it. Only the service role reads it, and only from this module.
 *     * Nothing in this module ever returns a secret to a caller. Reads answer
 *       with `configured: true` and the last four characters, which is enough
 *       to recognise a key and useless for using one.
 *     * No secret is ever logged. The provider helpers in llm.js log key
 *       presence and a four character tail, never the value.
 *
 * WHOSE KEY GETS USED.
 *   The connection rows a request may see are read with the CALLER'S OWN JWT,
 *   so the RLS policies in 20260813120000 decide which workspace they belong
 *   to. The service role is then asked only for those exact connection ids. It
 *   never enumerates, so there is no path by which one workspace's request can
 *   surface another workspace's key.
 *
 * ZERO FABRICATION.
 *   No endpoint, model id or auth flow is invented here. Every base URL and
 *   every model id below is one this repository already calls (llm.js,
 *   klaviyo-core.js, ad-insights-core.js). Where a real detail is genuinely not
 *   established — the OAuth authorize URL and scopes for the ad platforms — the
 *   registry carries a [DATA REQUIRED BEFORE LAUNCH: ...] marker and the page
 *   shows it, rather than a sign-in button that goes nowhere.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * Routed from api/public-config.js ?action=connections.
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const brandCore = require('./brand-workspace-core.js');
const scope = require('./request-scope.js');

const MAX_SECRET_CHARS = 8000;       // a Google service-account style blob still fits
const MAX_CONFIG_CHARS = 500;
const RESOLVE_TTL = 30_000;          // same window brand-runtime caches a brand for

/* ── the registry ─────────────────────────────────────────────────────────── */

/**
 * `llm_provider` is the id llm.js knows a provider by, and it is what makes a
 * workspace key actually replace the platform one. A platform with no
 * `llm_provider` is a data connector, not a model provider.
 *
 * `wired` states the truth about consumption: whether a stored credential is
 * used by anything today. Sakana is deliberately absent from this list — llm.js
 * carries a rung for it but notes it has no broadly documented public chat API,
 * so there is no auth flow to describe and inventing one is not an option.
 */
const PROVIDERS = [
  /* ── AI model providers ───────────────────────────────────────────────── */
  {
    id: 'anthropic', label: 'Anthropic (Claude)', category: 'ai', llm_provider: 'anthropic',
    auth_kind: 'api_key', env_default: 'ANTHROPIC_API_KEY',
    key_url: 'https://console.anthropic.com/settings/keys',
    blurb: 'Claude models. First rung of the default cascade.',
    fields: [{ key: 'api_key', label: 'API key', secret: true, required: true }],
  },
  {
    id: 'openai', label: 'OpenAI (ChatGPT)', category: 'ai', llm_provider: 'openai',
    auth_kind: 'api_key', env_default: 'OPENAI_API_KEY',
    key_url: 'https://platform.openai.com/api-keys',
    blurb: 'GPT models.',
    fields: [{ key: 'api_key', label: 'API key', secret: true, required: true }],
  },
  {
    id: 'gemini', label: 'Google Gemini', category: 'ai', llm_provider: 'gemini',
    auth_kind: 'api_key', env_default: 'GEMINI_API_KEY',
    key_url: 'https://aistudio.google.com/apikey',
    blurb: 'Gemini models, with a free tier.',
    // A key, or "Sign in with Google" (ai-account-signin.js): the sign-in keeps
    // a Google refresh token (never shown, no input for it) and the Google Cloud
    // project the calls are billed to, which the person can change.
    fields: [
      { key: 'api_key', label: 'API key', secret: true, required: true },
      { key: 'google_refresh_token', label: 'Google sign-in', secret: true, required: false, hidden: true },
      { key: 'project', label: 'Google Cloud project ID (for Sign in with Google)', secret: false, required: false, placeholder: 'my-project-id' },
    ],
  },
  {
    id: 'grok', label: 'xAI (Grok)', category: 'ai', llm_provider: 'grok',
    auth_kind: 'api_key', env_default: 'XAI_API_KEY',
    key_url: 'https://console.x.ai',
    blurb: 'Grok models.',
    fields: [{ key: 'api_key', label: 'API key', secret: true, required: true }],
  },
  {
    id: 'groq', label: 'Groq', category: 'ai', llm_provider: 'groq',
    auth_kind: 'api_key', env_default: 'GROQ_API_KEY',
    key_url: 'https://console.groq.com/keys',
    blurb: 'Open models served fast, with a free tier.',
    fields: [{ key: 'api_key', label: 'API key', secret: true, required: true }],
  },
  {
    id: 'cerebras', label: 'Cerebras', category: 'ai', llm_provider: 'cerebras',
    auth_kind: 'api_key', env_default: 'CEREBRAS_API_KEY',
    key_url: 'https://cloud.cerebras.ai',
    blurb: 'Open models, with a free tier.',
    fields: [{ key: 'api_key', label: 'API key', secret: true, required: true }],
  },
  {
    id: 'openrouter', label: 'OpenRouter', category: 'ai', llm_provider: 'openrouter',
    auth_kind: 'api_key', env_default: 'OPENROUTER_API_KEY',
    key_url: 'https://openrouter.ai/credits',
    blurb: 'One key that routes to Claude, GPT, Gemini and open models.',
    fields: [
      { key: 'api_key', label: 'API key', secret: true, required: true },
      // The model this key is used with (an OpenRouter slug such as
      // anthropic/claude-sonnet-5.5); empty = the default chain in llm.js.
      { key: 'model', label: 'Model', secret: false, required: false, placeholder: 'anthropic/claude-sonnet-5.5' },
    ],
  },
  {
    id: 'deepseek', label: 'DeepSeek', category: 'ai', llm_provider: 'deepseek',
    auth_kind: 'api_key', env_default: 'DEEPSEEK_API_KEY',
    key_url: 'https://platform.deepseek.com/api-keys',
    blurb: 'DeepSeek-V3 and DeepSeek-R1 reasoning models via api.deepseek.com.',
    fields: [{ key: 'api_key', label: 'API key', secret: true, required: true }],
  },
  {
    id: 'bedrock', label: 'AWS Bedrock (Claude)', category: 'ai', llm_provider: 'bedrock',
    auth_kind: 'api_key', env_default: 'AWS_ACCESS_KEY_ID',
    key_url: 'https://console.aws.amazon.com/bedrock',
    blurb: 'Anthropic Claude models via AWS Bedrock Runtime.',
    fields: [
      { key: 'aws_access_key_id', label: 'AWS Access Key ID', secret: true, required: true },
      { key: 'aws_secret_access_key', label: 'AWS Secret Access Key', secret: true, required: true },
      { key: 'aws_region', label: 'AWS Region', secret: false, required: false, placeholder: 'us-east-1' },
      { key: 'aws_session_token', label: 'Session Token (optional)', secret: true, required: false },
    ],
  },
  // GitHub Models was retired 2026-07-30 (docs.github.com/en/github-models): not offered.
  {
    id: 'cloudflare', label: 'Cloudflare Workers AI', category: 'ai', llm_provider: 'cloudflare',
    auth_kind: 'api_key', env_default: 'CLOUDFLARE_API_TOKEN',
    key_url: 'https://dash.cloudflare.com/profile/api-tokens',
    blurb: 'Open models on a free daily allowance. Needs your account id as well as a token.',
    fields: [
      { key: 'api_key', label: 'API token', secret: true, required: true },
      { key: 'account_id', label: 'Account id', secret: false, required: true },
    ],
  },
  {
    id: 'ollama', label: 'Ollama (self hosted)', category: 'ai', llm_provider: 'ollama',
    auth_kind: 'api_key', env_default: 'OLLAMA_BASE_URL',
    key_url: '',
    blurb: 'Your own Ollama server. The base URL is required; a token is optional.',
    fields: [
      // `fetched` marks a field the SERVER will make a request to. Those get the
      // SSRF guard at save time; see saveConnection.
      { key: 'base_url', label: 'Base URL', secret: false, required: true, fetched: true, placeholder: 'https://ollama.your-domain.example' },
      { key: 'api_key', label: 'Token (optional)', secret: true, required: false },
    ],
  },

  /* ── Video and image generation (2026-10-25) ──────────────────────────── */
  // Pollo AI's platform API (docs.pollo.ai, read 2026-10-25): one key, sent as
  // `x-api-key`, reaches Kling, Veo, Seedance and the rest. Only the Kling 2.5
  // Turbo request was confirmed field by field, so it is the model used. The
  // key is the person's own, saved in their workspace (never a platform env).
  {
    id: 'pollo', label: 'Pollo AI (video)', category: 'media',
    auth_kind: 'api_key', env_default: '',
    key_url: 'https://pollo.ai/api-platform/keys',
    blurb: 'Turns your product photos into short video ads (Kling 2.5 Turbo through Pollo). Billed to your Pollo credits, not this app\'s.',
    fields: [{ key: 'api_key', label: 'API key', secret: true, required: true }],
    wired: true,
    wired_note: 'Used first by every video this workspace makes: the product\'s own photo animated into a 5 or 10 second clip. Without it, videos are rendered in code from the same photos.',
  },

  // Music (2026-10-25): the services The Third Eye's Music Studio composes with
  // (its Hugging Face rung is left out: no Inference Provider hosts MusicGen).
  // Each key is the person's own, saved in their workspace and used before
  // the platform's, so its tracks cost no app credits.
  {
    id: 'elevenlabs', label: 'ElevenLabs (music)', category: 'media',
    auth_kind: 'api_key', env_default: 'ELEVENLABS_API_KEY',
    key_url: 'https://elevenlabs.io/app/settings/api-keys',
    blurb: 'Eleven Music: full songs, sung in your lyrics or instrumental, up to 4 minutes. Needs a paid ElevenLabs plan. Paste the secret key (it starts with sk_), not the key id.',
    fields: [{ key: 'api_key', label: 'API key', secret: true, required: true, placeholder: 'sk_...' }],
    wired: true,
    wired_note: 'Used by Music Studio and Smart Brain to compose tracks, after your Gemini connection (Lyria).',
  },
  {
    id: 'replicate', label: 'Replicate (music)', category: 'media',
    auth_kind: 'api_key', env_default: 'REPLICATE_API_TOKEN',
    key_url: 'https://replicate.com/account/api-tokens',
    blurb: 'ACE-Step sings your lyrics; Meta MusicGen and Stable Audio Open play instrumentals. Billed to your Replicate account.',
    fields: [{ key: 'api_key', label: 'API token', secret: true, required: true, placeholder: 'r8_...' }],
    wired: true,
    wired_note: 'Used by Music Studio and Smart Brain to compose tracks when Lyria and ElevenLabs do not answer.',
  },

  /* ── Commerce ─────────────────────────────────────────────────────────── */
  {
    id: 'shopify', label: 'Shopify', category: 'commerce',
    auth_kind: 'account_token', env_default: '',
    key_url: '',
    blurb: 'Your store. The catalog importer already reads a public storefront without any credential; an Admin token is stored here for the reads that need one.',
    fields: [
      { key: 'shop_domain', label: 'Shop domain', secret: false, required: true, placeholder: 'your-store.myshopify.com' },
      { key: 'admin_access_token', label: 'Admin API access token', secret: true, required: true },
      { key: 'api_version', label: 'Admin API version', secret: false, required: false, placeholder: '2024-10' },
    ],
    oauth_note: '[DATA REQUIRED BEFORE LAUNCH: Shopify OAuth authorize URL, scopes and app registration for this platform]',
    wired: true,
    wired_note: 'Used by this workspace for live Admin reads: orders, products, customers, inventory and UTM attribution (shopify-core.js). Read-only — the project-wide read-only rule blocks every write verb aimed at a Shopify host, so a read-scoped token is the correct one to paste. The public storefront importer still runs for catalogue discovery and needs no credential.',
  },

  /* ── Ads ──────────────────────────────────────────────────────────────── */
  {
    id: 'meta_ads', label: 'Meta Ads', category: 'ads',
    auth_kind: 'account_token', env_default: 'META_ACCESS_TOKEN',
    key_url: '',
    blurb: 'Paid social reporting from the Meta Marketing API.',
    fields: [
      { key: 'access_token', label: 'Access token', secret: true, required: true },
      { key: 'ad_account_id', label: 'Ad account id', secret: false, required: true },
      // The social gateway (2026-10-04) posts to a Page and an Instagram
      // professional account, and routes Meta's webhooks by these ids.
      { key: 'page_id', label: 'Facebook Page id', secret: false, required: false },
      { key: 'ig_user_id', label: 'Instagram professional account id', secret: false, required: false },
    ],
    oauth_note: '[DATA REQUIRED BEFORE LAUNCH: Meta OAuth authorize URL, scopes and app review status for this platform]',
    wired: false,
    wired_note: 'Stored for this workspace. The paid-media reader still runs on the deployment credentials.',
  },
  {
    id: 'google_ads', label: 'Google Ads', category: 'ads',
    auth_kind: 'account_token', env_default: 'GOOGLE_ADS_DEVELOPER_TOKEN',
    key_url: '',
    blurb: 'Search and shopping reporting from the Google Ads API.',
    fields: [
      { key: 'developer_token', label: 'Developer token', secret: true, required: true },
      { key: 'client_id', label: 'OAuth client id', secret: false, required: true },
      { key: 'client_secret', label: 'OAuth client secret', secret: true, required: true },
      { key: 'refresh_token', label: 'Refresh token', secret: true, required: true },
      { key: 'customer_id', label: 'Customer id', secret: false, required: true },
      { key: 'login_customer_id', label: 'Login customer id (manager account)', secret: false, required: false },
    ],
    oauth_note: '[DATA REQUIRED BEFORE LAUNCH: Google Ads OAuth authorize URL and scopes for this platform. The token exchange endpoint this repo already calls is https://oauth2.googleapis.com/token, which is not enough on its own to start a sign-in flow]',
    wired: false,
    wired_note: 'Stored for this workspace. The paid-media reader still runs on the deployment credentials.',
  },
  {
    id: 'tiktok_ads', label: 'TikTok Ads', category: 'ads',
    auth_kind: 'account_token', env_default: 'TIKTOK_ACCESS_TOKEN',
    key_url: '',
    blurb: 'Paid reporting from the TikTok Business API.',
    fields: [
      { key: 'access_token', label: 'Access token', secret: true, required: true },
      { key: 'advertiser_id', label: 'Advertiser id', secret: false, required: true },
    ],
    oauth_note: '[DATA REQUIRED BEFORE LAUNCH: TikTok Business OAuth authorize URL and scopes for this platform]',
    wired: false,
    wired_note: 'Stored for this workspace. The social gateway reads it, and every TikTok Ads call it would make is unverified (TikTok\'s API for Business reference could not be read), so each one refuses with the exact request instead of sending it.',
  },

  /* ── Social (the social integration gateway, 2026-10-04) ───────────────
     Signed in with OAuth from the Publishing page; a pasted token is the
     fallback. Read by api/_shared/social-gateway-core.js and the adapters in
     api/_shared/adapters/ (tiktok, pinterest, youtube). */
  {
    id: 'tiktok', label: 'TikTok', category: 'social',
    auth_kind: 'oauth', env_default: '',
    key_url: 'https://developers.tiktok.com',
    blurb: 'Organic TikTok: upload a video to the creator\'s inbox as a draft, or post it directly; read the account\'s own video counts. Webhooks report when a post completes.',
    fields: [
      { key: 'access_token', label: 'Access token', secret: true, required: true },
    ],
    wired: true,
    wired_note: 'Read and written by the social gateway. Every write also needs LIVE_CONNECTORS, this brand\'s publishing toggle and TIKTOK_ALLOW_WRITES on the deployment.',
  },
  {
    id: 'pinterest', label: 'Pinterest', category: 'social',
    auth_kind: 'oauth', env_default: '',
    key_url: 'https://developers.pinterest.com',
    blurb: 'Pins on a board, Pin analytics, paused ad campaigns and ad spend.',
    fields: [
      { key: 'access_token', label: 'Access token', secret: true, required: true },
      { key: 'board_id', label: 'Default board id', secret: false, required: false },
      { key: 'ad_account_id', label: 'Ad account id', secret: false, required: false },
    ],
    wired: true,
    wired_note: 'Read and written by the social gateway. Every write also needs LIVE_CONNECTORS, this brand\'s publishing toggle and PINTEREST_ALLOW_WRITES on the deployment.',
  },
  {
    id: 'youtube', label: 'YouTube', category: 'social',
    auth_kind: 'oauth', env_default: '',
    key_url: 'https://console.cloud.google.com/apis/credentials',
    blurb: 'Upload videos (always private until a live approval), read their statistics, and read, reply to and moderate comments.',
    fields: [
      { key: 'access_token', label: 'Access token', secret: true, required: true },
      { key: 'refresh_token', label: 'Refresh token', secret: true, required: false },
    ],
    wired: true,
    wired_note: 'Read and written by the social gateway. Every write also needs LIVE_CONNECTORS, this brand\'s publishing toggle and YOUTUBE_ALLOW_WRITES on the deployment.',
  },

  /* ── Lifecycle ────────────────────────────────────────────────────────── */
  {
    id: 'klaviyo', label: 'Klaviyo', category: 'lifecycle',
    auth_kind: 'api_key', env_default: 'KLAVIYO_API_KEY',
    key_url: 'https://developers.klaviyo.com/en/reference/api_overview',
    blurb: 'Audiences, segments, campaigns and flows. This platform reads Klaviyo and never writes to it, so a read-only scoped key is the right one to paste.',
    fields: [
      { key: 'api_key', label: 'Private API key', secret: true, required: true },
      { key: 'revision', label: 'API revision', secret: false, required: false, placeholder: '2024-10-15' },
    ],
    wired: true,
    wired_note: 'Used by this workspace for every Klaviyo read.',
  },
  {
    id: 'webengage', label: 'WebEngage', category: 'lifecycle',
    auth_kind: 'push', env_default: 'WEBENGAGE_BUCKET',
    key_url: '',
    blurb: 'WebEngage pushes event dumps into a private storage bucket and this platform reads them, so there is no WebEngage key to paste. Name the bucket your dumps land in.',
    fields: [
      { key: 'bucket', label: 'Storage bucket', secret: false, required: true, placeholder: 'webengage-dumps' },
    ],
    wired: false,
    wired_note: 'Stored for this workspace. The dump reader still uses the deployment bucket setting.',
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

/** llm.js provider id -> registry entry, for the routing resolver. */
const BY_LLM = new Map(PROVIDERS.filter((p) => p.llm_provider).map((p) => [p.llm_provider, p]));

/* ── crypto ───────────────────────────────────────────────────────────────── */

// Keyed on the raw env value rather than a bare boolean, so a deployment that
// rotates CONNECTION_SECRET_KEY picks the new one up instead of serving a
// derivation of the old string for the life of the process. scrypt is
// deliberately slow, which is why the result is cached at all.
let KEY_CACHE = { raw: null, out: null };

/**
 * The encryption key, from CONNECTION_SECRET_KEY. Accepts 32 raw bytes as hex
 * or base64, and otherwise treats the value as a passphrase and stretches it
 * with scrypt. A short passphrase is REFUSED rather than stretched: scrypt
 * raises the cost of guessing, it does not create entropy that was never there.
 */
function encryptionKey() {
  const own = String(process.env.CONNECTION_SECRET_KEY || '').trim();
  // No key of its own: derive one from the project's Supabase JWT secret, which
  // every Supabase deployment already holds and never sends to a browser. A
  // separate HKDF label means the derived key is not the JWT secret, and the
  // keys people save stay in THEIR workspace's rows, encrypted, as before.
  // Rotating the JWT secret then makes saved keys unreadable (they are entered
  // again), exactly as rotating CONNECTION_SECRET_KEY does.
  const jwt = own ? '' : String(process.env.SUPABASE_JWT_SECRET || '').trim();
  const raw = own || (jwt ? 'jwt:' + jwt : '');
  if (KEY_CACHE.raw === raw && KEY_CACHE.out) return KEY_CACHE.out;
  const remember = (out) => { KEY_CACHE = { raw, out }; return out; };
  if (!raw) return remember({ ok: false, error: 'CONNECTION_SECRET_KEY is not set on this deployment.' });
  if (!own) {
    if (jwt.length < 24) return remember({ ok: false, error: 'CONNECTION_SECRET_KEY is not set on this deployment.' });
    const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(jwt, 'utf8'), Buffer.from('lifecycle-os'), Buffer.from('workspace-connections/v1'), 32));
    return remember({ ok: true, key, derived_from: 'SUPABASE_JWT_SECRET', key_id: crypto.createHash('sha256').update(key).digest('hex').slice(0, 12) });
  }

  let key = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32 && b64.toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '')) key = b64;
  }
  if (!key) {
    if (own.length < 24) {
      return remember({ ok: false, error: 'CONNECTION_SECRET_KEY is too short. Use 32 random bytes as hex (openssl rand -hex 32), or a passphrase of at least 24 characters.' });
    }
    key = crypto.scryptSync(own, 'lifecycle-os/workspace-connections', 32);
  }
  return remember({ ok: true, key, key_id: crypto.createHash('sha256').update(key).digest('hex').slice(0, 12) });
}

function cryptoConfigured() { return encryptionKey().ok === true; }

/** Why a secret cannot be stored right now, as a sentence, or '' when it can. */
function secretsStorageError() { const k = encryptionKey(); return k.ok ? '' : String(k.error || ''); }

function encryptSecrets(obj) {
  const k = encryptionKey();
  if (!k.ok) { const e = new Error(k.error); e.status = 503; e.code = 'connection_secrets_unavailable'; throw e; }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k.key, iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ct.toString('base64'),
    key_id: k.key_id,
  };
}

/**
 * Decrypt a stored row. Returns null rather than throwing when the row cannot
 * be read (a rotated key, a truncated value), because a generation must degrade
 * to the platform default rather than fail with a decrypt error.
 */
function decryptSecrets(row) {
  const k = encryptionKey();
  if (!k.ok || !row || !row.ciphertext) return null;
  if (row.key_id && row.key_id !== k.key_id) return null;      // encrypted under a previous key
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', k.key, Buffer.from(row.iv, 'base64'));
    d.setAuthTag(Buffer.from(row.tag, 'base64'));
    const pt = Buffer.concat([d.update(Buffer.from(row.ciphertext, 'base64')), d.final()]);
    const obj = JSON.parse(pt.toString('utf8'));
    return obj && typeof obj === 'object' ? obj : null;
  } catch (_) { return null; }
}

/* ── service-role access (secrets only) ───────────────────────────────────── */

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !service) {
    const e = new Error('SUPABASE_SERVICE_ROLE_KEY is required to store or read a connection secret.');
    e.status = 503; e.code = 'connection_secrets_unavailable';
    throw e;
  }
  return { url: String(url).replace(/\/$/, ''), service };
}

function serviceConfigured() { try { serviceEnv(); return true; } catch (_) { return false; } }

async function serviceRest(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = serviceEnv();
  const headers = { apikey: e.service, authorization: `Bearer ${e.service}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) {
    // The body of a failed secrets call can echo the row back, so only the
    // status is reported. Never the payload.
    const err = new Error(`connection secret store ${method} -> ${res.status}`);
    err.status = 502;
    throw err;
  }
  return json;
}

/* ── small helpers ────────────────────────────────────────────────────────── */

function str(v, max) {
  const s = String(v == null ? '' : v).trim();
  return max ? s.slice(0, max) : s;
}

function hint(value) {
  const s = String(value || '');
  return s.length >= 4 ? s.slice(-4) : '';
}

/** The public view of a connection. Constructed field by field so a secret can
 *  never ride along in a column somebody adds later. */
function sanitize(row) {
  const reg = BY_ID.get(row.provider) || {};
  return {
    provider: row.provider,
    label: row.label || reg.label || row.provider,
    category: row.category || reg.category || 'other',
    auth_kind: row.auth_kind || reg.auth_kind || 'api_key',
    config: row.config && typeof row.config === 'object' ? row.config : {},
    configured: Array.isArray(row.secret_fields) ? row.secret_fields.length > 0 : false,
    secret_fields: Array.isArray(row.secret_fields) ? row.secret_fields : [],
    secret_hint: row.secret_hint || '',
    status: row.status || 'active',
    last_checked_at: row.last_checked_at || null,
    last_check_ok: row.last_check_ok == null ? null : !!row.last_check_ok,
    last_check_note: row.last_check_note || '',
    updated_at: row.updated_at || null,
    // Saved on another brand this person owns, and used here too (personalRows).
    shared_from: row.__from ? { workspace_id: row.__from.workspace_id, name: row.__from.name || '' } : null,
  };
}

const SELECT_COLS = 'id,workspace_id,provider,category,auth_kind,label,config,secret_fields,secret_hint,status,last_checked_at,last_check_ok,last_check_note,updated_at';

/* ── reads and writes ─────────────────────────────────────────────────────── */

async function listConnections(auth, workspaceId) {
  const rows = await brandCore.restAs(
    auth.token,
    `workspace_connections?select=${SELECT_COLS}&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=category.asc,provider.asc`,
  );
  return Array.isArray(rows) ? rows : [];
}

/*
 * A model key is the PERSON'S, not one brand's (the operator, 2026-10-25: "once a
 * user syncs a model it stays synced and signed in until user removes or
 * unlinks"). AI and media connections saved on any brand the caller OWNS are
 * offered on every other brand they own, so adding or switching brands never
 * drops a model they connected. A key saved on THIS brand wins over one from
 * another; the person removes it (here or where it was saved) to unlink it.
 * Read as the caller (RLS), so nobody ever sees another person's rows.
 */
const PERSONAL_CATEGORIES = new Set(['ai', 'media']);
function isPersonal(provider) { const reg = BY_ID.get(provider); return !!(reg && PERSONAL_CATEGORIES.has(reg.category)); }

/** The person's other brands, or null when this brand is not theirs. */
async function ownedOtherThan(auth, workspaceId) {
  if (!auth || !auth.user_id || !workspaceId) return null;
  const rows = await brandCore.restAs(auth.token, `brand_workspaces?select=id,name,owner_id&owner_id=eq.${encodeURIComponent(auth.user_id)}`);
  const list = (Array.isArray(rows) ? rows : []).filter((w) => w && w.id && w.owner_id === auth.user_id);
  if (!list.some((w) => w.id === workspaceId)) return null;
  return list.filter((w) => w.id !== workspaceId);
}

async function personalRows(auth, workspaceId) {
  if (!auth || !auth.user_id) return [];
  // Only on a brand the person OWNS: on another owner's brand (where they are
  // a member or editor) their own keys never pay for that brand's work.
  const owned = await ownedOtherThan(auth, workspaceId);
  if (!owned) return [];
  const ids = owned.map((w) => w.id);
  if (!ids.length) return [];
  const names = new Map((owned || []).map((w) => [w.id, w.name || '']));
  const providers = PROVIDERS.filter((p) => PERSONAL_CATEGORIES.has(p.category)).map((p) => p.id);
  const rows = await brandCore.restAs(
    auth.token,
    `workspace_connections?select=${SELECT_COLS}&workspace_id=in.(${ids.map(encodeURIComponent).join(',')})`
    + `&provider=in.(${providers.map(encodeURIComponent).join(',')})&order=updated_at.desc`,
  );
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !isPersonal(r.provider) || r.status === 'disabled' || out.has(r.provider)) continue;
    if (!(Array.isArray(r.secret_fields) && r.secret_fields.length) && !(r.config && Object.keys(r.config).length)) continue;
    out.set(r.provider, Object.assign({}, r, { __from: { workspace_id: r.workspace_id, name: names.get(r.workspace_id) || '' } }));
  }
  return [...out.values()];
}

/** This brand's connections, plus the person's own model keys saved on their other brands. */
async function effectiveConnections(auth, workspaceId) {
  const own = await listConnections(auth, workspaceId);
  let mine = [];
  try { mine = await personalRows(auth, workspaceId); } catch (_) { mine = []; }
  const have = new Set(own.map((r) => r.provider));
  return own.concat(mine.filter((r) => !have.has(r.provider)));
}

/** The row a provider resolves to on this brand: its own, else the person's from another brand. */
async function effectiveRow(auth, workspaceId, provider) {
  const own = await getConnectionRow(auth, workspaceId, provider);
  if (own || !isPersonal(provider)) return own;
  try { return (await personalRows(auth, workspaceId)).find((r) => r.provider === provider) || null; } catch (_) { return null; }
}

async function getConnectionRow(auth, workspaceId, provider) {
  const rows = await brandCore.restAs(
    auth.token,
    `workspace_connections?select=${SELECT_COLS}&workspace_id=eq.${encodeURIComponent(workspaceId)}&provider=eq.${encodeURIComponent(provider)}&limit=1`,
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/** Secrets for connection ids the caller's own RLS-checked read already returned. */
async function secretsByConnectionId(ids) {
  if (!ids.length) return new Map();
  const list = ids.map((id) => `"${id}"`).join(',');
  const rows = await serviceRest(
    `workspace_connection_secrets?select=connection_id,alg,iv,tag,ciphertext,key_id&connection_id=in.(${encodeURIComponent(list)})`,
  );
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const plain = decryptSecrets(r);
    if (plain) out.set(r.connection_id, plain);
  }
  return out;
}

/**
 * Save a connection. Secret fields are separated from settings by the REGISTRY,
 * not by the caller, so a client cannot smuggle a key into the readable config
 * column by renaming it.
 */
async function saveConnection(auth, input) {
  const workspaceId = str(input && input.workspace_id);
  const providerId = str(input && input.provider).toLowerCase();
  const reg = BY_ID.get(providerId);
  if (!reg) { const e = new Error(`Unknown platform "${providerId}".`); e.status = 400; throw e; }
  await brandCore.assertCanWrite(auth, workspaceId, 'change its connections');

  // A model key this brand shows from the person's account is edited where it
  // is saved, so a Save here never leaves this brand a row without the key
  // that would hide the one they already connected.
  if (isPersonal(providerId) && !(input && input.__redirected)) {
    const own = await getConnectionRow(auth, workspaceId, providerId);
    if (!own) {
      const shared = await effectiveRow(auth, workspaceId, providerId);
      if (shared && shared.workspace_id && shared.workspace_id !== workspaceId) {
        const saved = await saveConnection(auth, Object.assign({}, input, { workspace_id: shared.workspace_id, __redirected: true }));
        return Object.assign({}, saved, { shared_from: { workspace_id: shared.workspace_id, name: (shared.__from && shared.__from.name) || '' } });
      }
    }
  }

  const supplied = (input && input.fields && typeof input.fields === 'object') ? input.fields : {};
  const config = {};
  const secrets = {};
  for (const f of reg.fields) {
    const raw = supplied[f.key];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (f.secret) {
      // An empty string means "leave whatever is stored alone", which is what a
      // form does when the user edits a neighbouring field and does not retype
      // the key. Clearing a secret is `delete`, not an empty save.
      if (!value) continue;
      if (value.length > MAX_SECRET_CHARS) { const e = new Error(`${f.label} is longer than ${MAX_SECRET_CHARS} characters.`); e.status = 400; throw e; }
      secrets[f.key] = value;
    } else if (f.fetched) {
      // A base URL supplied here is a destination the SERVERLESS RUNTIME will
      // POST prompts to, which makes it a server-side request forgery primitive
      // in the hands of any workspace editor: without this it could be pointed
      // at a cloud metadata endpoint or an internal service and the response
      // would come back as a model answer. Same guard the catalog importer uses.
      config[f.key] = value ? await brandCore.assertPublicUrl(value) : '';
    } else {
      config[f.key] = value.slice(0, MAX_CONFIG_CHARS);
    }
  }

  const existing = await getConnectionRow(auth, workspaceId, providerId);
  const haveSecrets = Object.keys(secrets).length > 0;
  if (haveSecrets && !cryptoConfigured()) {
    const k = encryptionKey();
    const e = new Error(`${k.error} A key cannot be stored until it is, because this platform will not write an unencrypted secret to the database.`);
    e.status = 503; e.code = 'connection_secrets_unavailable';
    throw e;
  }
  if (haveSecrets && !serviceConfigured()) {
    const e = new Error('SUPABASE_SERVICE_ROLE_KEY is required to store a connection secret.');
    e.status = 503; e.code = 'connection_secrets_unavailable';
    throw e;
  }

  // Required non-secret settings are checked here rather than at use time, so
  // a half-configured connector never reaches a generation.
  for (const f of reg.fields) {
    if (f.secret || !f.required) continue;
    const merged = config[f.key] != null ? config[f.key] : ((existing && existing.config && existing.config[f.key]) || '');
    if (!merged) { const e = new Error(`${f.label} is required for ${reg.label}.`); e.status = 400; throw e; }
  }

  const mergedConfig = Object.assign({}, (existing && existing.config) || {}, config);
  let mergedSecretFields = (existing && Array.isArray(existing.secret_fields)) ? existing.secret_fields.slice() : [];
  let secretHint = (existing && existing.secret_hint) || '';
  let mergedSecrets = null;

  if (haveSecrets) {
    const prior = existing ? (await secretsByConnectionId([existing.id])).get(existing.id) : null;
    mergedSecrets = Object.assign({}, prior || {}, secrets);
    mergedSecretFields = Object.keys(mergedSecrets);
    // The hint is taken from the FIRST secret field the registry declares, so
    // it always describes the same value across saves.
    const primary = reg.fields.find((f) => f.secret && mergedSecrets[f.key]);
    secretHint = primary ? hint(mergedSecrets[primary.key]) : '';
  }

  const row = {
    workspace_id: workspaceId,
    provider: providerId,
    category: reg.category,
    auth_kind: reg.auth_kind,
    label: str(input && input.label, 120) || reg.label,
    config: mergedConfig,
    secret_fields: mergedSecretFields,
    secret_hint: secretHint,
    status: str(input && input.status) === 'disabled' ? 'disabled' : 'active',
  };

  // Metadata is written with the CALLER's token, so RLS is the authority on
  // whether they may touch this workspace at all.
  const saved = await brandCore.restAs(
    auth.token,
    `workspace_connections?on_conflict=workspace_id,provider&select=${SELECT_COLS}`,
    { method: 'POST', body: [row], prefer: 'resolution=merge-duplicates,return=representation' },
  );
  const savedRow = Array.isArray(saved) ? saved[0] : saved;

  if (mergedSecrets) {
    const enc = encryptSecrets(mergedSecrets);
    await serviceRest('workspace_connection_secrets?on_conflict=connection_id', {
      method: 'POST',
      body: [Object.assign({ connection_id: savedRow.id, workspace_id: workspaceId, updated_at: new Date().toISOString() }, enc)],
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  RESOLVED.clear();
  return sanitize(savedRow);
}

/** Remove a connection. The secret row goes with it through the foreign key. */
async function deleteConnection(auth, workspaceId, providerId) {
  await brandCore.assertCanWrite(auth, workspaceId, 'remove its connections');
  // Removing a model key shown here from another brand unlinks it where it
  // is saved, so it stops being used on every brand.
  const own = await getConnectionRow(auth, workspaceId, providerId);
  if (!own && isPersonal(providerId)) {
    const shared = await effectiveRow(auth, workspaceId, providerId);
    if (shared && shared.workspace_id && shared.workspace_id !== workspaceId) {
      await brandCore.assertCanWrite(auth, shared.workspace_id, 'remove its connections');
      await brandCore.restAs(
        auth.token,
        `workspace_connections?workspace_id=eq.${encodeURIComponent(shared.workspace_id)}&provider=eq.${encodeURIComponent(providerId)}`,
        { method: 'DELETE', prefer: 'return=minimal' },
      );
      RESOLVED.clear();
      return { ok: true, removed: providerId, unlinked_from: shared.workspace_id };
    }
  }
  await brandCore.restAs(
    auth.token,
    `workspace_connections?workspace_id=eq.${encodeURIComponent(workspaceId)}&provider=eq.${encodeURIComponent(providerId)}`,
    { method: 'DELETE', prefer: 'return=minimal' },
  );
  RESOLVED.clear();
  return { ok: true, removed: providerId };
}

/* ── service-role writes, for the paths that have no user JWT ─────────────── */
/**
 * ⚠️ THESE BYPASS RLS. They exist for exactly two callers, both of which have
 * already established which workspace they are acting for by other means:
 *
 *   oauth-core.handleCallback()  the OAuth callback is a top-level browser
 *                                redirect from Meta or Google and carries no
 *                                Authorization header. Its authority is the
 *                                single-use `state` row, which was written
 *                                only after assertCanWrite() passed at step 1
 *                                and which names the workspace and the user.
 *
 *   dispatch-core                the queue runs under the scheduler, not a
 *                                person, and persists a rotated token for a
 *                                workspace it read off the job row.
 *
 * The rule for adding a third caller: it must already hold a workspace id it
 * did not take from user input. A caller that passes through a workspace id
 * from a request body MUST use the JWT paths above instead - that is the whole
 * reason those exist.
 */
async function getConnectionAsService(workspaceId, provider) {
  if (!workspaceId || !provider) return null;
  const rows = await serviceRest(
    `workspace_connections?select=${SELECT_COLS},connect_kind,oauth_scopes,token_expires_at,refresh_expires_at,last_refresh_at,refresh_failure_count,external_account_id,external_account_label,revoked_at`
    + `&workspace_id=eq.${encodeURIComponent(workspaceId)}&provider=eq.${encodeURIComponent(provider)}&limit=1`,
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/** Decrypted secrets for one connection id. Never returned to a browser. */
async function secretsAsService(connectionId) {
  if (!connectionId) return null;
  const map = await secretsByConnectionId([connectionId]);
  return map.get(connectionId) || null;
}

/** Patch the non-secret columns of a connection row. */
async function patchConnectionAsService(workspaceId, provider, patch) {
  if (!workspaceId || !provider) return null;
  const body = {};
  const allowed = [
    'connect_kind', 'oauth_scopes', 'token_expires_at', 'refresh_expires_at', 'last_refresh_at',
    'refresh_failure_count', 'external_account_id', 'external_account_label', 'revoked_at',
    'status', 'last_checked_at', 'last_check_ok', 'last_check_note',
  ];
  // Allow-list rather than pass-through: this runs as the service role, so a
  // caller must not be able to set a column nobody vetted (config, secret_hint).
  for (const k of allowed) if (patch && patch[k] !== undefined) body[k] = patch[k];
  if (!Object.keys(body).length) return null;
  return serviceRest(
    `workspace_connections?workspace_id=eq.${encodeURIComponent(workspaceId)}&provider=eq.${encodeURIComponent(provider)}`,
    { method: 'PATCH', body, prefer: 'return=minimal' },
  );
}

/**
 * Upsert a connection and its secrets as the service role. Mirrors
 * saveConnection() but takes the workspace as established fact rather than
 * checking a caller's rights, because there is no caller to check.
 */
async function saveConnectionAsService(input) {
  const workspaceId = str(input && input.workspace_id);
  const providerId = str(input && input.provider).toLowerCase();
  if (!workspaceId || !providerId) { const e = new Error('workspace and provider are required'); e.status = 400; throw e; }
  const reg = BY_ID.get(providerId);

  const supplied = (input && input.fields && typeof input.fields === 'object') ? input.fields : {};
  const secrets = {};
  for (const [k, v] of Object.entries(supplied)) {
    const value = String(v == null ? '' : v).trim();
    if (value) secrets[k] = value.slice(0, MAX_SECRET_CHARS);
  }
  if (Object.keys(secrets).length && !cryptoConfigured()) {
    const k = encryptionKey();
    const e = new Error(k.error); e.status = 503; e.code = 'connection_secrets_unavailable'; throw e;
  }

  const existing = await getConnectionAsService(workspaceId, providerId);
  const prior = existing ? await secretsAsService(existing.id) : null;
  const merged = Object.assign({}, prior || {}, secrets);

  const meta = (input && input.meta) || {};
  const row = Object.assign({
    workspace_id: workspaceId,
    provider: providerId,
    category: (reg && reg.category) || 'other',
    auth_kind: (reg && reg.auth_kind) || 'oauth',
    label: (existing && existing.label) || (reg && reg.label) || providerId,
    config: (existing && existing.config) || {},
    secret_fields: Object.keys(merged),
    secret_hint: hint(merged.access_token || merged.api_key || Object.values(merged)[0] || ''),
    status: 'active',
  }, pickMeta(meta));

  const saved = await serviceRest(`workspace_connections?on_conflict=workspace_id,provider&select=id`, {
    method: 'POST',
    body: [row],
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  const savedRow = Array.isArray(saved) ? saved[0] : saved;

  if (Object.keys(merged).length && savedRow && savedRow.id) {
    const enc = encryptSecrets(merged);
    await serviceRest('workspace_connection_secrets?on_conflict=connection_id', {
      method: 'POST',
      body: [Object.assign({ connection_id: savedRow.id, workspace_id: workspaceId, updated_at: new Date().toISOString() }, enc)],
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }
  RESOLVED.clear();
  return { ok: true, id: savedRow && savedRow.id };
}

function pickMeta(meta) {
  const out = {};
  for (const k of ['connect_kind', 'oauth_scopes', 'token_expires_at', 'refresh_expires_at', 'last_refresh_at', 'refresh_failure_count', 'external_account_id', 'external_account_label', 'revoked_at']) {
    if (meta[k] !== undefined) out[k] = meta[k];
  }
  return out;
}

/* ── AI routing ───────────────────────────────────────────────────────────── */

/**
 * Model ids this platform already knows how to call, per provider, gathered
 * from llm.js across all three tiers. Nothing is invented: if a model is not in
 * a chain llm.js ships, it is not offered as a suggestion. A workspace may
 * still type any model id its own account has, and it is stored as given and
 * marked as unverified by this platform.
 */
function knownModels(llmProvider) {
  const llm = require('./llm.js');
  const out = [];
  for (const tier of ['premium', 'standard', 'fast']) {
    for (const m of llm.modelsFor(llmProvider, tier)) if (out.indexOf(m) < 0) out.push(m);
  }
  return out;
}

function normalizeRouting(input) {
  const src = input && typeof input === 'object' ? input : {};
  const seen = new Set();
  const entries = [];
  for (const raw of Array.isArray(src.entries) ? src.entries.slice(0, 24) : []) {
    const provider = str(raw && raw.provider).toLowerCase();
    const reg = BY_LLM.get(provider);
    if (!reg || seen.has(provider)) continue;         // unknown or repeated provider is dropped, not guessed at
    seen.add(provider);
    const models = [];
    for (const m of Array.isArray(raw.models) ? raw.models.slice(0, 8) : []) {
      const id = str(m, 120);
      if (id && models.indexOf(id) < 0) models.push(id);
    }
    entries.push({ provider, models, enabled: raw.enabled !== false });
  }
  return { entries, use_platform_fallback: src.use_platform_fallback !== false };
}

async function getRouting(auth, workspaceId) {
  const rows = await brandCore.restAs(
    auth.token,
    `workspace_ai_routing?select=entries,use_platform_fallback,updated_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
  );
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (row) return { entries: Array.isArray(row.entries) ? row.entries : [], use_platform_fallback: row.use_platform_fallback !== false, updated_at: row.updated_at };
  // No order chosen on this brand: the person's own order from the brand they
  // set it on most recently, so a model order they picked follows them too.
  try {
    const owned = (await ownedOtherThan(auth, workspaceId)) || [];
    const ids = owned.map((w) => w.id);
    if (ids.length) {
      const other = await brandCore.restAs(
        auth.token,
        `workspace_ai_routing?select=workspace_id,entries,use_platform_fallback,updated_at&workspace_id=in.(${ids.map(encodeURIComponent).join(',')})&order=updated_at.desc&limit=1`,
      );
      const o = Array.isArray(other) && other[0] ? other[0] : null;
      if (o) {
        const nm = (owned.find((w) => w.id === o.workspace_id) || {}).name || '';
        return { entries: Array.isArray(o.entries) ? o.entries : [], use_platform_fallback: o.use_platform_fallback !== false, updated_at: o.updated_at, shared_from: { workspace_id: o.workspace_id, name: nm } };
      }
    }
  } catch (_) { /* this brand's default order */ }
  return { entries: [], use_platform_fallback: true, updated_at: null };
}

async function saveRouting(auth, workspaceId, input) {
  await brandCore.assertCanWrite(auth, workspaceId, 'change which AI models it uses');
  const clean = normalizeRouting(input);
  await brandCore.restAs(auth.token, 'workspace_ai_routing?on_conflict=workspace_id', {
    method: 'POST',
    body: [{
      workspace_id: workspaceId,
      entries: clean.entries,
      use_platform_fallback: clean.use_platform_fallback,
      updated_by: auth.user_id,
      updated_at: new Date().toISOString(),
    }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  RESOLVED.clear();                                   // the next generation must see this immediately
  return clean;
}

/* ── the resolver llm.js consults ─────────────────────────────────────────── */

const RESOLVED = new Map();       // `${user}|${workspace}` -> { at, overrides }

/**
 * Turn a workspace's stored routing and keys into the shape llm.js applies.
 * Returns null whenever nothing should change, which is the common case and
 * must stay indistinguishable from the behaviour before this feature existed.
 */
function buildOverrides(routing, connections, secrets) {
  const keys = {};
  const connModels = {};
  const bases = {};
  const configured = new Set();

  for (const row of connections) {
    const reg = BY_ID.get(row.provider);
    if (!reg || !reg.llm_provider || row.status === 'disabled') continue;
    const secret = secrets.get(row.id) || {};
    const cfg = (row.config && typeof row.config === 'object') ? row.config : {};

    if (secret.api_key) keys[reg.llm_provider] = secret.api_key;
    // Signed in with Google: the access token minted for this request (see
    // llmOverridesFor), billed to the person's own project.
    if (reg.llm_provider === 'gemini' && !secret.api_key && secret.__google_access) {
      keys.gemini_oauth = { access_token: secret.__google_access, project: cfg.project || '' };
      configured.add('gemini');
    }
    // A model chosen on the connection (OpenRouter: the family a provider
    // card's sign-in asked for), used unless the routing names its own.
    if (cfg.model && typeof cfg.model === 'string' && /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(cfg.model)) connModels[reg.llm_provider] = [cfg.model];

    // Two providers are reached at an address that depends on the workspace's
    // own account, so the base URL is part of the credential.
    if (reg.llm_provider === 'cloudflare' && cfg.account_id) {
      bases.cloudflare = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.account_id)}/ai/v1`;
    }
    if (reg.llm_provider === 'ollama' && cfg.base_url) {
      bases.ollama = String(cfg.base_url).replace(/\/+$/, '') + '/v1';
      // Ollama's OpenAI-compatible endpoint accepts any bearer value, so a
      // workspace that gave only a base URL is still usable.
      if (!keys.ollama) keys.ollama = 'ollama';
    }
    if (reg.llm_provider === 'bedrock') {
      if (secret.aws_access_key_id) keys.aws_access_key_id = secret.aws_access_key_id;
      if (secret.aws_secret_access_key) keys.aws_secret_access_key = secret.aws_secret_access_key;
      if (cfg.aws_region || secret.aws_region) keys.aws_region = cfg.aws_region || secret.aws_region;
      if (secret.aws_session_token) keys.aws_session_token = secret.aws_session_token;
      if (secret.api_key) keys.bedrock = secret.api_key;
      if (keys.aws_access_key_id || keys.bedrock) configured.add('bedrock');
    }
    if (keys[reg.llm_provider] || bases[reg.llm_provider]) configured.add(reg.llm_provider);
  }

  const order = [];
  const models = {};
  for (const e of (routing && routing.entries) || []) {
    if (!e || e.enabled === false) continue;
    const p = String(e.provider || '');
    if (!BY_LLM.has(p) || order.indexOf(p) >= 0) continue;
    order.push(p);
    if (Array.isArray(e.models) && e.models.length) models[p] = e.models.slice();
  }
  for (const p of Object.keys(connModels)) if (!models[p]) models[p] = connModels[p];

  if (!order.length && !Object.keys(keys).length && !Object.keys(bases).length) return null;

  return {
    order,
    models,
    keys,
    bases,
    fallback: !(routing && routing.use_platform_fallback === false),
    configured: [...configured],
    source: 'workspace',
  };
}

/**
 * Resolve overrides for a request. Never throws: any failure here means the
 * generation runs on the platform default, which is the pre-existing behaviour
 * and always safe.
 */
async function llmOverridesFor(req) {
  try {
    // No bearer token means a server-to-server or cron call. There is no user
    // to attribute a key to, so nothing is looked up and nothing is spent.
    const hasAuth = !!(req && req.headers && (req.headers.authorization || req.headers.Authorization));
    if (!hasAuth) return null;
    if (!serviceConfigured()) return null;

    const auth = await brandCore.requireUser(req);
    if (!auth || !auth.ok) return null;

    const q = (req && req.query) || {};
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const wsId = str(body.workspace_id || q.workspace_id) || await brandCore.activeWorkspaceId(auth);
    if (!wsId) return null;

    const cacheKey = `${auth.user_id}|${wsId}`;
    const hit = RESOLVED.get(cacheKey);
    if (hit && Date.now() - hit.at < RESOLVE_TTL) return hit.overrides;

    // Both reads use the CALLER'S token. RLS decides which rows exist for them,
    // so the service role below is only ever asked for ids they can already see.
    const [routing, connections] = await Promise.all([
      getRouting(auth, wsId),
      effectiveConnections(auth, wsId),
    ]);
    const aiRows = connections.filter((r) => {
      const reg = BY_ID.get(r.provider);
      return reg && reg.llm_provider && Array.isArray(r.secret_fields) && r.secret_fields.length;
    });
    const secrets = aiRows.length ? await secretsByConnectionId(aiRows.map((r) => r.id)) : new Map();
    // A Google sign-in is a refresh token: turn it into an access token now.
    // Google refusing it (revoked, expired) leaves Gemini unconnected for this
    // request rather than failing the generation.
    for (const r of aiRows) {
      const sec = secrets.get(r.id);
      if (r.provider === 'gemini' && sec && !sec.api_key && sec.google_refresh_token) {
        const access = await require('./ai-account-signin.js').googleAccessToken(sec.google_refresh_token);
        if (access) secrets.set(r.id, Object.assign({}, sec, { __google_access: access }));
      }
    }

    const overrides = buildOverrides(routing, connections, secrets);
    RESOLVED.set(cacheKey, { at: Date.now(), overrides });
    return overrides;
  } catch (_) {
    return null;
  }
}

/**
 * The workspace's own media-generation keys (category 'media'), for the
 * request in flight: { pollo: { api_key } } or null. Same rules as
 * llmOverridesFor: a signed-in member, the workspace they act in, rows read as
 * the caller, secrets decrypted by the service role only for those rows.
 * Never throws; null means the platform's own (keyless) path.
 */
async function mediaKeysFor(req) {
  try {
    const hasAuth = !!(req && req.headers && (req.headers.authorization || req.headers.Authorization));
    if (!hasAuth || !serviceConfigured()) return null;
    const auth = await brandCore.requireUser(req);
    if (!auth || !auth.ok) return null;
    const q = (req && req.query) || {};
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const wsId = str(body.workspace_id || q.workspace_id) || await brandCore.activeWorkspaceId(auth);
    if (!wsId) return null;
    const rows = (await effectiveConnections(auth, wsId)).filter((r) => {
      const reg = BY_ID.get(r.provider);
      return reg && reg.category === 'media' && r.status !== 'disabled' && Array.isArray(r.secret_fields) && r.secret_fields.length;
    });
    if (!rows.length) return null;
    const secrets = await secretsByConnectionId(rows.map((r) => r.id));
    const out = {};
    for (const r of rows) {
      const sec = secrets.get(r.id) || {};
      if (sec.api_key) out[r.provider] = { api_key: String(sec.api_key) };
    }
    return Object.keys(out).length ? out : null;
  } catch (_) {
    return null;
  }
}
function mediaKeysForCurrentRequest() {
  const req = scope.currentRequest();
  if (!req) return Promise.resolve(null);
  return scope.once('workspace-media-keys', () => mediaKeysFor(req));
}

/** The same resolution, memoised for the request llm.js is serving. */
function llmOverridesForCurrentRequest() {
  const req = scope.currentRequest();
  if (!req) return Promise.resolve(null);
  return scope.once('workspace-llm-overrides', () => llmOverridesFor(req));
}

/**
 * Decrypted credentials for a non-AI platform, for the modules that read it.
 * Returns null when this workspace has not connected the platform, so the
 * caller falls back to the deployment environment exactly as before.
 */
async function credentialsFor(req, providerId) {
  try {
    const reg = BY_ID.get(String(providerId || '').toLowerCase());
    if (!reg) return null;
    const hasAuth = !!(req && req.headers && (req.headers.authorization || req.headers.Authorization));
    if (!hasAuth || !serviceConfigured()) return null;

    const auth = await brandCore.requireUser(req);
    if (!auth || !auth.ok) return null;
    const q = (req && req.query) || {};
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const wsId = str(body.workspace_id || q.workspace_id) || await brandCore.activeWorkspaceId(auth);
    if (!wsId) return null;

    const row = await effectiveRow(auth, wsId, reg.id);
    if (!row || row.status === 'disabled') return null;
    const secrets = (Array.isArray(row.secret_fields) && row.secret_fields.length)
      ? (await secretsByConnectionId([row.id])).get(row.id) || {}
      : {};
    const cfg = (row.config && typeof row.config === 'object') ? row.config : {};
    if (!Object.keys(secrets).length && !Object.keys(cfg).length) return null;
    return Object.assign({}, cfg, secrets);
  } catch (_) { return null; }
}

/** The same, for the request currently being served. */
function credentialsForCurrentRequest(providerId) {
  const req = scope.currentRequest();
  if (!req) return Promise.resolve(null);
  return scope.once(`workspace-credentials:${providerId}`, () => credentialsFor(req, providerId));
}

/* ── the registry as the page renders it ──────────────────────────────────── */

/**
 * Whether the PLATFORM itself has a default key for an AI provider. Signed-in
 * members see this one boolean and nothing else, because without it the page
 * cannot answer the first question anyone asks: do I have to supply a key at
 * all. No model, region, environment or key material is disclosed.
 */
function platformDefault(reg) {
  if (reg.category !== 'ai') return false;
  switch (reg.llm_provider) {
    case 'openai': return !!(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_2 || process.env.OPENAI_API_KEY_3);
    case 'openrouter': return !!(process.env.OPENROUTER_API_KEY || process.env.OpenRouter_API_KEY);
    case 'deepseek': return !!process.env.DEEPSEEK_API_KEY;
    case 'bedrock': return !!((process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) || process.env.BEDROCK_API_KEY || process.env.AWS_BEDROCK_API_KEY);
    case 'cloudflare': return !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
    case 'ollama': return !!process.env.OLLAMA_BASE_URL;
    default: return !!(reg.env_default && process.env[reg.env_default]);
  }
}

/**
 * The free keyless models (2026-10-17). With no key at all, text ends on the
 * free model llm.js keeps last in every cascade and images on Pollinations, so
 * "Not connected" on every AI card was true and still misleading: generation
 * works. This says so, for a signed-in member only (the same line as
 * platform_default), and never marks any provider connected.
 * FREE_GENERATION=off switches the free models off, and then nothing is said.
 */
function freeGenerationView(signedIn) {
  if (!signedIn) return null;
  let on = false;
  try { on = require('./llm.js').freeGenerationOn(); } catch (_) { on = false; }
  return on
    ? { on: true, note: 'With no key of your own, the platform\'s models make your content and each creation uses your app credits. Connect your own key above to use only your models instead (Claude, then OpenAI, Gemini and Grok, in that order), and what your own models make uses no credits.' }
    : { on: false, note: '' };
}

/**
 * `signedIn` gates one field. Whether the PLATFORM holds a key is answered for
 * a member of a workspace, because without it the page cannot say whether a key
 * is needed at all; it is withheld from an anonymous caller, which is the same
 * line public-config draws around its pipeline and probe payloads.
 */
function registryView(signedIn) {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    category: p.category,
    auth_kind: p.auth_kind,
    llm_provider: p.llm_provider || null,
    blurb: p.blurb,
    key_url: p.key_url || '',
    fields: p.fields.filter((f) => !f.hidden).map((f) => ({ key: f.key, label: f.label, secret: !!f.secret, required: !!f.required, fetched: !!f.fetched, placeholder: f.placeholder || '' })),
    known_models: p.llm_provider ? knownModels(p.llm_provider) : [],
    platform_default: signedIn ? platformDefault(p) : null,
    // Stated plainly so nobody reads a stored credential as a wired one.
    wired: p.category === 'ai' ? true : !!p.wired,
    wired_note: p.category === 'ai'
      ? 'Used by every generation in this workspace, in the priority order you set.'
      : (p.wired_note || ''),
    oauth_note: p.oauth_note || '',
    // Sign in with the provider's own account, where the provider documents
    // one (ai-account-signin.js); else why there is none.
    signin: p.category === 'ai' ? require('./ai-account-signin.js').viewFor(p.id) : null,
  }));
}

/* ── connection check ─────────────────────────────────────────────────────── */

/**
 * Check a connection. For an AI provider with a workspace key this makes ONE
 * very small live call using THAT key, so the result is real rather than a
 * guess about whether the string looks like a key. For everything else, and
 * for an AI provider with no workspace key, it returns the klaviyo-core shaped
 * { connected, would_request } envelope: the check never spends the platform's
 * own quota on a user's behalf, and never claims a platform works when nothing
 * was called.
 */
async function checkConnection(auth, workspaceId, providerId) {
  const reg = BY_ID.get(String(providerId || '').toLowerCase());
  if (!reg) { const e = new Error(`Unknown platform "${providerId}".`); e.status = 400; throw e; }
  await brandCore.assertCanWrite(auth, workspaceId, 'test its connections');

  const row = await effectiveRow(auth, workspaceId, reg.id);
  if (!row) { const e = new Error(`${reg.label} is not connected on this brand.`); e.status = 404; throw e; }
  const checkWs = row.workspace_id || workspaceId;
  const secrets = (Array.isArray(row.secret_fields) && row.secret_fields.length)
    ? (await secretsByConnectionId([row.id])).get(row.id) || {}
    : {};

  let result;
  if (Array.isArray(row.secret_fields) && row.secret_fields.length && !Object.keys(secrets).length) {
    result = {
      ok: false, connected: false,
      note: 'The stored secret could not be read. It was encrypted under a different CONNECTION_SECRET_KEY than this deployment now holds, so it has to be entered again.',
    };
  } else if (reg.category === 'ai' && (secrets.api_key || (reg.llm_provider === 'ollama' && (row.config || {}).base_url))) {
    const callLLM = require('./llm.js');
    const bases = {};
    const cfg = row.config || {};
    if (reg.llm_provider === 'cloudflare' && cfg.account_id) bases.cloudflare = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.account_id)}/ai/v1`;
    if (reg.llm_provider === 'ollama' && cfg.base_url) bases.ollama = String(cfg.base_url).replace(/\/+$/, '') + '/v1';
    const key = secrets.api_key || (reg.llm_provider === 'ollama' ? 'ollama' : '');
    try {
      const r = await callLLM({
        systemPrompt: 'Reply with the single word: ok', userMessage: require('./output-contract.js').append('ping', require('./output-contract.js').PROBE),
        maxTokens: 16, temperature: 0, timeoutMs: 8000, stage: 'connection-check',
        overrides: { order: [reg.llm_provider], models: {}, keys: { [reg.llm_provider]: key }, bases, fallback: false },
      });
      result = { ok: true, connected: true, note: `Answered on ${r.model}.` };
    } catch (err) {
      const det = (err && err._providerErrors && err._providerErrors[0]) || {};
      const status = det.status;
      result = {
        ok: false, connected: true,
        note: status === 429 || status === 402 ? 'The key works but the account is rate limited or out of quota.'
          : status === 401 || status === 403 ? 'That key was rejected as unauthorized.'
            : status === 404 ? 'The key works but this account cannot reach the model that was tried.'
              : status === 0 ? 'The provider did not answer in time.'
                : `The call failed (${status || 'no status'}).`,
      };
    }
  } else if (reg.category === 'ai') {
    result = {
      ok: false, connected: false,
      would_request: { note: reg.llm_provider === 'ollama'
        ? 'A live Ollama check needs a saved public base URL. A token is optional.'
        : `A live check needs a ${reg.label} key on this brand. Without one, generations use the platform default and there is nothing of yours to test.` },
    };
  } else if (reg.id === 'pollo' && secrets.api_key) {
    // One read that spends nothing: the account's credit balance.
    try {
      const out = await require('./video-core.js').polloBalance(secrets.api_key);
      result = out.ok
        ? { ok: true, connected: true, note: `Pollo answered: ${out.available} credits available.` }
        : { ok: false, connected: true, note: out.status === 401 || out.status === 403 ? 'That key was rejected as unauthorized.' : `Pollo did not accept the check (${out.status || 'no answer'}).` };
    } catch (_) {
      result = { ok: false, connected: true, note: 'Pollo did not answer in time.' };
    }
  } else if (['elevenlabs', 'replicate'].includes(reg.id) && secrets.api_key) {
    // One read per service that spends nothing: who the key belongs to.
    const k = String(secrets.api_key);
    const ask = reg.id === 'elevenlabs' ? ['https://api.elevenlabs.io/v1/user/subscription', { 'xi-api-key': k }]
      : ['https://api.replicate.com/v1/account', { Authorization: 'Bearer ' + k }];
    try {
      const r = await fetch(ask[0], { headers: ask[1], signal: AbortSignal.timeout(8000) });
      result = r.ok ? { ok: true, connected: true, note: `${reg.label.replace(/ \(music\)$/, '')} accepted the key.` }
        : { ok: false, connected: true, note: r.status === 401 || r.status === 403 ? 'That key was rejected as unauthorized.' : `The check was refused (${r.status}).` };
    } catch (_) {
      result = { ok: false, connected: true, note: 'The service did not answer in time.' };
    }
  } else if (reg.id === 'klaviyo') {
    // The one non-AI platform this repo has a real client for. Ask it for its
    // own status so the answer comes from the client that will do the reads.
    const klaviyo = require('./klaviyo-core.js');
    const out = await klaviyo.dispatch('status', {}, { key: secrets.api_key, revision: (row.config || {}).revision });
    result = {
      ok: !!out.connected, connected: !!out.connected,
      note: out.connected ? `Klaviyo client is live on revision ${out.revision}.` : String(out.ready || 'Klaviyo reads are held by the live-connector switch on this deployment.'),
    };
  } else {
    result = {
      ok: false, connected: false,
      would_request: { note: reg.wired_note || 'Stored for this workspace.' },
      note: reg.oauth_note || reg.wired_note || 'Stored, and not yet read by anything in this platform.',
    };
  }

  await brandCore.restAs(
    auth.token,
    `workspace_connections?workspace_id=eq.${encodeURIComponent(checkWs)}&provider=eq.${encodeURIComponent(reg.id)}`,
    {
      method: 'PATCH',
      body: { last_checked_at: new Date().toISOString(), last_check_ok: !!result.ok, last_check_note: String(result.note || '').slice(0, 300) },
      prefer: 'return=minimal',
    },
  );
  RESOLVED.clear();
  return Object.assign({ provider: reg.id }, result);
}

/* ── the router (mounted at /api/public-config?action=connections) ────────── */

async function handle(req, res) {
  const q = (req && req.query) || {};
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const op = str(q.op || body.op).toLowerCase() || 'list';

  // The registry is public in the same way the credit price list is: the page
  // has to be able to show what can be connected before anything is.
  if (op === 'registry') {
    return res.status(200).json({
      ok: true,
      providers: registryView(false),
      categories: ['ai', 'commerce', 'ads', 'social', 'lifecycle'],
      secrets_storage: {
        encrypted: cryptoConfigured(),
        store: serviceConfigured(),
        note: cryptoConfigured()
          ? 'Keys are encrypted with AES-256-GCM inside the server before they are stored, and are never returned to the browser.'
          : 'CONNECTION_SECRET_KEY is not set on this deployment, so no key can be stored. Nothing is written unencrypted.',
      },
    });
  }

  // The OAuth callback is a top-level browser redirect from Meta or Google and
  // carries no Authorization header, so it MUST be reachable unauthenticated.
  // Its authority is the single-use `state` row instead; see oauth-core.js.
  if (op === 'oauth-callback') {
    let out;
    try {
      out = await require('./oauth-core.js').handleCallback(req);
    } catch (err) {
      // A browser navigation, so the answer is a redirect with a reason, not
      // the JSON 500 the outer router would write. Nothing from the failure
      // is echoed: a throw from the state store can carry row detail.
      out = { ok: false, redirect: `/connections?oauth=error&reason=${encodeURIComponent(String((err && err.code) || 'callback_failed'))}` };
    }
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(302, { Location: out.redirect });
    return res.end();
  }

  // The publishable registry of what can be sent where. Public like the
  // provider registry above, because the page renders it before connecting.
  if (op === 'publish-registry') {
    const reg = require('./adapters/registry.js');
    return res.status(200).json({ ok: true, platforms: reg.registryView(), channels: reg.allChannels() });
  }

  const auth = await brandCore.requireUser(req);
  if (!auth.ok) return res.status(auth.status || 401).json(auth);

  // A phone sign-in with no Supabase identity (kept on the device, or in
  // Neon) has its brands on the device, and a platform credential is kept
  // encrypted with a brand workspace on the server. Reading its active
  // workspace through RLS THREW here (restAs refuses a phone account), and
  // public-config answered a bare 500 `connections_router_failed` for every
  // Connect press and every /connections load (2026-10-04). The honest
  // answer: nothing is connected, and why nothing can be from here.
  if (auth.provider === 'mobile-pin' && auth.mode !== 'supabase') {
    const message = 'Platform accounts are connected through credentials kept encrypted with a brand workspace on the server. This brand is kept on this device, so no platform account is connected to it, and none can be connected from here.';
    if (op === 'list') {
      return res.status(200).json({
        ok: true, workspace_id: null, storage: 'device', note: message,
        connections: [], routing: { entries: [], use_platform_fallback: true },
        providers: registryView(true), free_generation: freeGenerationView(true), secrets_storage: { encrypted: cryptoConfigured(), store: serviceConfigured() },
      });
    }
    return res.status(409).json({ ok: false, error: 'device_account', storage: 'device', message });
  }

  const workspaceId = str(q.workspace_id || body.workspace_id) || await brandCore.activeWorkspaceId(auth);
  if (!workspaceId) {
    return res.status(409).json({
      ok: false, error: 'no_active_brand',
      message: 'Onboard and activate a brand first. Connections and model routing belong to a brand workspace, never to the platform as a whole.',
    });
  }

  try {
    switch (op) {
      case 'list': {
        const [rows, routing] = await Promise.all([effectiveConnections(auth, workspaceId), getRouting(auth, workspaceId)]);
        return res.status(200).json({
          ok: true,
          workspace_id: workspaceId,
          connections: rows.map(sanitize),
          routing,
          providers: registryView(true),
          free_generation: freeGenerationView(true),
          secrets_storage: { encrypted: cryptoConfigured(), store: serviceConfigured() },
        });
      }
      case 'save':
        return res.status(200).json({ ok: true, connection: await saveConnection(auth, Object.assign({}, body, { workspace_id: workspaceId })) });
      case 'delete':
        return res.status(200).json(await deleteConnection(auth, workspaceId, str(body.provider || q.provider).toLowerCase()));
      case 'check':
        return res.status(200).json(await checkConnection(auth, workspaceId, str(body.provider || q.provider)));
      case 'routing':
        return res.status(200).json({ ok: true, routing: await getRouting(auth, workspaceId), providers: registryView(true).filter((p) => p.llm_provider), free_generation: freeGenerationView(true) });
      case 'routing-save':
        return res.status(200).json({ ok: true, routing: await saveRouting(auth, workspaceId, body.routing || body) });

      /* ── sign in with an AI provider's own account ─────────────────── */
      case 'ai-signin-exchange':
        return res.status(200).json(await require('./ai-account-signin.js').exchange(auth, workspaceId, body));

      /* ── OAuth ──────────────────────────────────────────────────────── */
      case 'oauth-start':
        return res.status(200).json(await require('./oauth-core.js').beginAuthorization(req, auth, workspaceId, body.provider ? body : q));
      case 'oauth-disconnect':
        return res.status(200).json(await require('./oauth-core.js').revoke(auth, workspaceId, str(body.provider || q.provider)));

      /* ── the live-publishing switch ─────────────────────────────────── */
      // Deliberately its OWN operation rather than a field on `save`. Turning on
      // the ability to send as somebody's brand should be a decision an operator
      // makes on purpose, not a key that rides along in a form post.
      case 'publishing': {
        const provider = str(body.provider || q.provider).toLowerCase();
        const enable = body.enabled === true || body.enabled === 'true';
        await brandCore.assertCanWrite(auth, workspaceId, 'change live publishing');
        const existing = await getConnectionRow(auth, workspaceId, provider);
        if (!existing) { const e = new Error(`${provider} is not connected on this brand.`); e.status = 404; throw e; }
        await brandCore.restAs(
          auth.token,
          `workspace_connections?workspace_id=eq.${encodeURIComponent(workspaceId)}&provider=eq.${encodeURIComponent(provider)}`,
          {
            method: 'PATCH',
            body: { config: Object.assign({}, existing.config || {}, { publishing_enabled: enable, publishing_enabled_at: enable ? new Date().toISOString() : null, publishing_enabled_by: enable ? auth.user_id : null }) },
            prefer: 'return=minimal',
          },
        );
        RESOLVED.clear();
        return res.status(200).json({
          ok: true,
          provider,
          publishing_enabled: enable,
          note: enable
            ? 'Live publishing is on for this platform. Sends will leave this deployment, subject to the preflight gate and the deployment-wide LIVE_CONNECTORS switch.'
            : 'Live publishing is off. Jobs will build the exact request and stop without sending.',
        });
      }

      default:
        return res.status(400).json({
          ok: false, error: 'unknown_connections_operation',
          available: ['registry', 'publish-registry', 'list', 'save', 'delete', 'check', 'routing', 'routing-save', 'oauth-start', 'oauth-callback', 'oauth-disconnect', 'publishing'],
        });
    }
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    return res.status(status).json({ ok: false, error: err.code || 'connection_operation_failed', message: err.message || 'Connection operation failed.' });
  }
}

module.exports = {
  handle,
  PROVIDERS, BY_ID, BY_LLM, registryView, knownModels, freeGenerationView,
  // storage
  listConnections, effectiveConnections, personalRows, saveConnection, deleteConnection, getRouting, saveRouting, normalizeRouting,
  // service-role storage (OAuth callback + the dispatch queue only — see the
  // warning above those functions before adding a caller)
  getConnectionAsService, secretsAsService, patchConnectionAsService, saveConnectionAsService,
  // resolution
  buildOverrides, llmOverridesFor, llmOverridesForCurrentRequest,
  mediaKeysFor, mediaKeysForCurrentRequest,
  credentialsFor, credentialsForCurrentRequest,
  // crypto
  encryptSecrets, decryptSecrets, cryptoConfigured, secretsStorageError, sanitize,
  // test seam
  _resolvedCache: RESOLVED,
};
