'use strict';
/**
 * Sign in with an AI provider's own account (2026-10-24).
 *
 * The operator: "while user is using his keys for the AI models also allow him
 * to sign in directly with that AI model to be able to use his own account."
 *
 * Only a provider that DOCUMENTS a sign-in a third-party web app may use is
 * here, with the page it was read on. Read on 2026-10-24:
 *   - OpenRouter: OAuth PKCE. The person approves at openrouter.ai/auth, comes
 *     back with a one-time `code` (10 minutes), and the code is exchanged at
 *     POST https://openrouter.ai/api/v1/auth/keys for an API key on THEIR
 *     account (https://openrouter.ai/docs/use-cases/oauth-pkce). No app
 *     registration and no client secret: nothing for this deployment to set.
 * Not here, and why (said on the page too): see PROVIDER_SIGNIN below.
 *
 * The exchange runs HERE, not in the browser: the key goes straight into the
 * same encrypted store a typed key goes to (workspace-connections-core
 * saveConnection), as the signed-in person, under the workspace's write rule,
 * and is never returned to the page. The PKCE verifier and the state check stay
 * in the browser that started the sign-in (the public-client pattern).
 */

const SIGNIN = {
  // Gemini: "Sign in with Google" (2026-10-24, the operator: "google sign in or
  // whatever signin mode that model accepts"). OAuth 2.0 for web server apps
  // with PKCE (developers.google.com/identity/protocols/oauth2/web-server); the
  // Gemini API accepts a user's OAuth token (ai.google.dev/gemini-api/docs/oauth,
  // scope cloud-platform), and the call carries x-goog-user-project so it is
  // billed to the person's OWN Google Cloud project. Needs the platform's Google
  // OAuth client (GOOGLE_AI_OAUTH_CLIENT_ID / _SECRET): that is the app's
  // identity, not anyone's key. Until it is set the card says so.
  gemini: {
    provider: 'gemini',
    label: 'Google',
    kind: 'google',
    authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth',
    exchange_url: 'https://oauth2.googleapis.com/token',
    // Both scopes the Gemini OAuth guide's own example requests (2026-10-26):
    // with cloud-platform alone, Lyria answered 403 "Request had insufficient
    // authentication scopes".
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever',
    source: 'https://ai.google.dev/gemini-api/docs/oauth',
    note: 'Sign in with your Google account and pick your Google Cloud project: Gemini then runs as you, billed to that project. Nothing to copy or paste.',
  },
  // Hugging Face: "Sign in with HF" (2026-11-01). Read that day:
  //   https://huggingface.co/docs/hub/oauth (OAuth app at
  //     huggingface.co/settings/applications/new; redirect URIs match EXACTLY;
  //     scope `inference-api` = "Make inference requests to Inference Providers
  //     on behalf of the user"; a public app with no secret uses PKCE; an app
  //     with a secret may send it as `Authorization: Basic` on token requests)
  //   https://huggingface.co/.well-known/openid-configuration (authorization
  //     endpoint /oauth/authorize, token endpoint /oauth/token, PKCE S256 only,
  //     grant types authorization_code and refresh_token, client_secret_basic
  //     or client_secret_post)
  // NOT confirmed by those pages: that an authorization-code grant returns a
  // refresh_token, or how long its access token lasts. So a refresh token is
  // kept when one comes back, `expires_in` is honoured when one comes back,
  // and with neither the access token is used until Hugging Face refuses it,
  // when the card says to sign in again. Needs the platform's OAuth app:
  // HF_OAUTH_CLIENT_ID (+ HF_OAUTH_CLIENT_SECRET unless it is a public app).
  huggingface: {
    provider: 'huggingface',
    label: 'Hugging Face',
    kind: 'huggingface',
    authorize_url: 'https://huggingface.co/oauth/authorize',
    exchange_url: 'https://huggingface.co/oauth/token',
    scope: 'openid profile inference-api',
    source: 'https://huggingface.co/docs/hub/oauth',
    note: 'Sign in with your Hugging Face account: models then run on Inference Providers as you, billed to your Hugging Face account. Nothing to copy or paste.',
  },
  openrouter: {
    provider: 'openrouter',
    label: 'OpenRouter',
    kind: 'pkce',
    authorize_url: 'https://openrouter.ai/auth',
    exchange_url: 'https://openrouter.ai/api/v1/auth/keys',
    source: 'https://openrouter.ai/docs/use-cases/oauth-pkce',
    note: 'Sign in with your OpenRouter account: OpenRouter makes a key on your account for this workspace, and its use is billed to your OpenRouter credits.',
  },
};

/**
 * Each model's OWN sign-in (2026-10-24, the operator: "use each respective
 * model signup not openrouter as common for all"). Read on 2026-10-24:
 *   - OpenAI ships "Sign in with ChatGPT" (developers.openai.com/siwc), but a
 *     HOSTED app gets a client ID only through OpenAI's limited trial, and the
 *     plan-usage flow it documents is for open-source tools that sign in back
 *     to 127.0.0.1. Until OpenAI issues this app a client ID, the person signs
 *     in at platform.openai.com and makes a key there.
 *   - Anthropic's terms do not let a third-party app sign people in to Claude;
 *     an API key from the Console is the supported route.
 *   - Google's Gemini API OAuth bills the app's own Google project, not the
 *     person's account, so the person's own route is a key from AI Studio.
 *   - xAI documents no sign-in for third-party apps; keys come from its console.
 * So each card sends the person to THAT provider's own sign-in page, where the
 * key is made on their own account, and the key is pasted back here.
 */
const PROVIDER_SIGNIN = {
  openai: { label: 'OpenAI', url: 'https://platform.openai.com/api-keys',
    note: 'OpenAI offers "Sign in with ChatGPT" to hosted apps only through a limited trial that OpenAI has not opened to this app yet. Sign in at OpenAI, create a key on your account, and paste it above.' },
  anthropic: { label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys',
    note: 'Anthropic does not let other apps sign you in to Claude. Sign in at the Anthropic Console, create a key on your account, and paste it above.' },
  gemini: { label: 'Google AI Studio', url: 'https://aistudio.google.com/apikey',
    note: 'Sign in with Google is not switched on for this platform yet (its Google sign-in client is not added). Until it is, sign in at Google AI Studio, create a key on your account, and paste it above.' },
  // A fine-grained token with "Make calls to Inference Providers" (the link and
  // permission are the ones docs/inference-providers/index gives, 2026-11-01).
  huggingface: { label: 'Hugging Face', url: 'https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained',
    note: 'Sign in with Hugging Face is not switched on for this platform yet (its Hugging Face OAuth app is not added). Until it is, sign in at Hugging Face, create a fine-grained token with "Make calls to Inference Providers", and paste it above.' },
  grok: { label: 'xAI', url: 'https://console.x.ai',
    note: 'xAI does not offer other apps a sign-in. Sign in at the xAI console, create a key on your account, and paste it above.' },
};
const NOT_OFFERED = Object.fromEntries(Object.keys(PROVIDER_SIGNIN).map((k) => [k, PROVIDER_SIGNIN[k].note]));

/** What the page shows per provider: a sign-in it can start here, or the provider's own sign-in page. */
function googleClient() {
  const id = String(process.env.GOOGLE_AI_OAUTH_CLIENT_ID || '').trim();
  const secret = String(process.env.GOOGLE_AI_OAUTH_CLIENT_SECRET || '').trim();
  return id && secret ? { id, secret } : null;
}

// The platform's Hugging Face OAuth app. A public app (no secret) is
// documented, so only the id is required.
function hfClient() {
  const id = String(process.env.HF_OAUTH_CLIENT_ID || '').trim();
  const secret = String(process.env.HF_OAUTH_CLIENT_SECRET || '').trim();
  return id ? { id, secret } : null;
}

function viewFor(providerId) {
  const s = SIGNIN[providerId];
  if (s && s.kind === 'huggingface') {
    const h = hfClient();
    if (h) return { available: true, kind: 'huggingface', authorize_url: s.authorize_url, client_id: h.id, scope: s.scope, note: s.note, source: s.source };
  } else if (s && s.kind === 'google') {
    const g = googleClient();
    if (g) return { available: true, kind: 'google', authorize_url: s.authorize_url, client_id: g.id, scope: s.scope, note: s.note, source: s.source };
  } else if (s) return { available: true, kind: s.kind, authorize_url: s.authorize_url, note: s.note, source: s.source };
  const own = PROVIDER_SIGNIN[providerId];
  if (own) return { available: false, note: own.note, provider_signin: { label: own.label, url: own.url } };
  return null;
}

function fail(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }

/**
 * Exchange the one-time code for the person's key and keep it as this
 * workspace's credential for that provider.
 * @param {object} auth          the verified caller (brand-workspace-core.requireUser)
 * @param {string} workspaceId
 * @param {object} input         { provider, code, code_verifier }
 * @param {object} deps          { fetch, saveConnection } (injectable for tests)
 */
async function exchange(auth, workspaceId, input, deps) {
  const d = deps || {};
  const providerId = String((input && input.provider) || '').toLowerCase();
  const s = SIGNIN[providerId];
  if (!s || (s.kind === 'google' && !googleClient()) || (s.kind === 'huggingface' && !hfClient())) throw fail(400, 'signin_not_offered', (NOT_OFFERED[providerId]) || `There is no sign-in for "${providerId}" here.`);
  if (s.kind === 'google') return exchangeGoogle(auth, workspaceId, input, d, s);
  if (s.kind === 'huggingface') return exchangeHuggingFace(auth, workspaceId, input, d, s);
  const code = String((input && input.code) || '').trim();
  const verifier = String((input && input.code_verifier) || '').trim();
  if (!code) throw fail(400, 'code_required', `${s.label} did not send back a sign-in code. Start the sign-in again.`);
  // RFC 7636: a verifier is 43-128 characters of [A-Za-z0-9-._~].
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw fail(400, 'verifier_invalid', 'This sign-in was started in another tab or browser, so it cannot be finished here. Start it again from this page.');
  // The write rule first: nothing is exchanged for a caller who could not keep the key.
  const core = require('./brand-workspace-core.js');
  await core.assertCanWrite(auth, workspaceId, `connect ${s.label}`);

  const f = d.fetch || globalThis.fetch;
  let res;
  try {
    res = await f(s.exchange_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });
  } catch (_) {
    throw fail(502, 'provider_unreachable', `${s.label} did not answer, so the sign-in could not be finished. Try again in a moment.`);
  }
  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }
  const key = json && typeof json.key === 'string' ? json.key.trim() : '';
  if (!res.ok || !key) {
    // A used, expired (10 minutes) or mismatched code. Nothing from the answer
    // is echoed: it is another service's error text.
    throw fail(res.status >= 500 ? 502 : 400, 'signin_refused', `${s.label} refused the sign-in code (it is single-use and expires after 10 minutes). Start the sign-in again.`);
  }
  const save = d.saveConnection || require('./workspace-connections-core.js').saveConnection;
  const connection = await save(auth, {
    workspace_id: workspaceId, provider: s.provider,
    label: `${s.label} (signed in)`,
    fields: { api_key: key },
  });
  return { ok: true, provider: s.provider, signed_in: true, connection, message: `Signed in with ${s.label}. This workspace now uses your ${s.label} account; the key is kept encrypted and never shown.` };
}

/* ── Google (Gemini) ───────────────────────────────────────────────────── */

async function readJson(res) { try { return await res.json(); } catch (_) { return null; } }

async function exchangeGoogle(auth, workspaceId, input, d, s) {
  const g = googleClient();
  const code = String((input && input.code) || '').trim();
  const verifier = String((input && input.code_verifier) || '').trim();
  const redirect = String((input && input.redirect_uri) || '').trim();
  if (!code) throw fail(400, 'code_required', 'Google did not send back a sign-in code. Start the sign-in again.');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw fail(400, 'verifier_invalid', 'This sign-in was started in another tab or browser, so it cannot be finished here. Start it again from this page.');
  if (!/^https:\/\/[^\s?#]+$/.test(redirect) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s?#]*$/.test(redirect)) throw fail(400, 'redirect_invalid', 'This sign-in came back to an address it cannot be finished on. Start it again from this page.');
  const core = require('./brand-workspace-core.js');
  await core.assertCanWrite(auth, workspaceId, 'connect Google');

  const f = d.fetch || globalThis.fetch;
  const timeout = () => (AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined);
  let res;
  try {
    res = await f(s.exchange_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: g.id, client_secret: g.secret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }).toString(),
      signal: timeout(),
    });
  } catch (_) {
    throw fail(502, 'provider_unreachable', 'Google did not answer, so the sign-in could not be finished. Try again in a moment.');
  }
  const tok = await readJson(res);
  const refresh = tok && typeof tok.refresh_token === 'string' ? tok.refresh_token.trim() : '';
  const access = tok && typeof tok.access_token === 'string' ? tok.access_token.trim() : '';
  if (!res.ok || !access) throw fail(res.status >= 500 ? 502 : 400, 'signin_refused', 'Google refused the sign-in code (it is single-use and expires quickly). Start the sign-in again.');
  if (!refresh) throw fail(400, 'no_refresh_token', 'Google signed you in but did not grant lasting access. Start the sign-in again and allow access on Google\'s screen.');

  // The project the calls are billed to: the one the card names, else the
  // person's own active project (one: used; several: the first, said; none: said).
  let project = String((input && input.project) || '').trim();
  let projectNote = '';
  if (!project) {
    try {
      const pr = await f('https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE', { headers: { Authorization: 'Bearer ' + access }, signal: timeout() });
      const pj = await readJson(pr);
      const list = (pj && Array.isArray(pj.projects)) ? pj.projects.map((x) => String(x.projectId || '')).filter(Boolean) : [];
      if (list.length) {
        project = list[0];
        if (list.length > 1) projectNote = ` You have ${list.length} Google Cloud projects; "${project}" is used. Type another project ID in the card to change it.`;
      }
    } catch (_) { /* said below */ }
  }
  if (!project) projectNote = ' No Google Cloud project was found on your account, so Gemini cannot be billed to you yet: create one at console.cloud.google.com, then type its ID in the card and save.';
  else {
    // Turn on the Gemini API in that project (needs the person to own it); a
    // refusal is said, never hidden.
    try {
      const en = await f(`https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(project)}/services/generativelanguage.googleapis.com:enable`, { method: 'POST', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' }, body: '{}', signal: timeout() });
      if (!en.ok) projectNote += ` The Gemini API could not be switched on in "${project}" from here; switch on "Generative Language API" in that project's Google Cloud console.`;
    } catch (_) { projectNote += ` The Gemini API could not be switched on in "${project}" from here; switch on "Generative Language API" in that project's Google Cloud console.`; }
  }

  const save = d.saveConnection || require('./workspace-connections-core.js').saveConnection;
  const connection = await save(auth, {
    workspace_id: workspaceId, provider: 'gemini',
    label: 'Google Gemini (signed in with Google)',
    fields: Object.assign({ google_refresh_token: refresh }, project ? { project } : {}),
  });
  cacheAccess(refresh, access, tok.expires_in);
  return { ok: true, provider: 'gemini', signed_in: true, project: project || null, connection,
    message: 'Signed in with Google. Gemini now runs as you' + (project ? `, billed to your Google Cloud project "${project}"` : '') + '; nothing is shown or stored in the clear.' + projectNote };
}

// Access tokens last about an hour; one per refresh token, kept until a minute before it ends.
const ACCESS = new Map();
function rkey(refresh) { return require('crypto').createHash('sha256').update(refresh).digest('hex'); }
function cacheAccess(refresh, access, expiresIn) {
  const s = Number(expiresIn) > 0 ? Number(expiresIn) : 3600;
  ACCESS.set(rkey(refresh), { access, until: Date.now() + (s - 60) * 1000 });
}

/** A current access token for a stored Google refresh token, or null (said by the caller as "not connected"). */
async function googleAccessToken(refresh, deps) {
  const g = googleClient();
  if (!g || !refresh) return null;
  const hit = ACCESS.get(rkey(refresh));
  if (hit && hit.until > Date.now()) return hit.access;
  const f = (deps && deps.fetch) || globalThis.fetch;
  try {
    const res = await f(SIGNIN.gemini.exchange_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: g.id, client_secret: g.secret, refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
    });
    const j = await readJson(res);
    if (!res.ok || !j || typeof j.access_token !== 'string') return null;
    cacheAccess(refresh, j.access_token, j.expires_in);
    return j.access_token;
  } catch (_) { return null; }
}

/* ── Hugging Face ──────────────────────────────────────────────────────── */

function validReturn(redirect) {
  return /^https:\/\/[^\s?#]+$/.test(redirect) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s?#]*$/.test(redirect);
}

// A token request to Hugging Face: the secret as Basic auth when the app has
// one, else the client id in the body (a public app).
function hfTokenRequest(params) {
  const h = hfClient();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const body = new URLSearchParams(params);
  if (h.secret) headers.Authorization = 'Basic ' + Buffer.from(h.id + ':' + h.secret).toString('base64');
  else body.set('client_id', h.id);
  return { method: 'POST', headers, body: body.toString() };
}

function hfFields(tok) {
  const access = tok && typeof tok.access_token === 'string' ? tok.access_token.trim() : '';
  const refresh = tok && typeof tok.refresh_token === 'string' ? tok.refresh_token.trim() : '';
  const s = Number(tok && tok.expires_in);
  const out = { hf_oauth_access: access };
  if (refresh) out.hf_oauth_refresh = refresh;
  if (s > 0) out.hf_oauth_expires_at = String(Date.now() + s * 1000);
  return out;
}

async function exchangeHuggingFace(auth, workspaceId, input, d, s) {
  const code = String((input && input.code) || '').trim();
  const verifier = String((input && input.code_verifier) || '').trim();
  const redirect = String((input && input.redirect_uri) || '').trim();
  if (!code) throw fail(400, 'code_required', 'Hugging Face did not send back a sign-in code. Start the sign-in again.');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw fail(400, 'verifier_invalid', 'This sign-in was started in another tab or browser, so it cannot be finished here. Start it again from this page.');
  if (!validReturn(redirect)) throw fail(400, 'redirect_invalid', 'This sign-in came back to an address it cannot be finished on. Start it again from this page.');
  const core = require('./brand-workspace-core.js');
  await core.assertCanWrite(auth, workspaceId, 'connect Hugging Face');

  const f = d.fetch || globalThis.fetch;
  let res;
  try {
    res = await f(s.exchange_url, Object.assign(hfTokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier }),
      { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined }));
  } catch (_) {
    throw fail(502, 'provider_unreachable', 'Hugging Face did not answer, so the sign-in could not be finished. Try again in a moment.');
  }
  const tok = await readJson(res);
  const fields = hfFields(tok);
  if (!res.ok || !fields.hf_oauth_access) throw fail(res.status >= 500 ? 502 : 400, 'signin_refused', 'Hugging Face refused the sign-in code (it is single-use and expires quickly). Start the sign-in again.');
  // When Hugging Face says which scopes it granted and inference-api is not one
  // of them, the token cannot run a model: said now, not at the first build.
  const granted = String((tok && tok.scope) || '');
  if (granted && !/(^|\s)inference-api(\s|$)/.test(granted)) throw fail(400, 'scope_missing', 'Hugging Face signed you in but did not allow "Make inference requests" for this app. Start the sign-in again and allow it on Hugging Face\'s screen.');

  const save = d.saveConnection || require('./workspace-connections-core.js').saveConnection;
  const connection = await save(auth, {
    workspace_id: workspaceId, provider: 'huggingface',
    label: 'Hugging Face (signed in)',
    fields,
  });
  if (fields.hf_oauth_refresh) cacheHf(fields.hf_oauth_refresh, fields.hf_oauth_access, tok.expires_in);
  return { ok: true, provider: 'huggingface', signed_in: true, connection,
    message: 'Signed in with Hugging Face. Models on Inference Providers now run as you, billed to your Hugging Face account; nothing is shown or stored in the clear.'
      + (fields.hf_oauth_refresh || !fields.hf_oauth_expires_at ? '' : ' Hugging Face gave no lasting access, so when this sign-in ends the card will ask you to sign in again.') };
}

// One current access token per refresh token, kept until a minute before it ends.
const HF_ACCESS = new Map();
function cacheHf(refresh, access, expiresIn) {
  const s = Number(expiresIn) > 0 ? Number(expiresIn) : 3600;
  HF_ACCESS.set(rkey(refresh), { access, until: Date.now() + (s - 60) * 1000 });
}

/**
 * A current Hugging Face access token for a stored sign-in, or null (the
 * connection is then not used for this request). `secret` is the decrypted
 * secret row. `deps.persist(fields)` is handed a renewed token so it is kept:
 * Hugging Face may answer a refresh with a new refresh token, and then the old
 * one is not relied on again.
 */
async function hfAccessToken(secret, deps) {
  const sec = secret || {};
  const access = String(sec.hf_oauth_access || '');
  const refresh = String(sec.hf_oauth_refresh || '');
  const exp = Number(sec.hf_oauth_expires_at) || 0;
  // Not known to expire (no expires_in came back), or still current.
  if (access && (!exp || exp - 60000 > Date.now())) return access;
  if (!refresh || !hfClient()) return null;
  const hit = HF_ACCESS.get(rkey(refresh));
  if (hit && hit.until > Date.now()) return hit.access;
  const f = (deps && deps.fetch) || globalThis.fetch;
  try {
    const res = await f(SIGNIN.huggingface.exchange_url, Object.assign(hfTokenRequest({ grant_type: 'refresh_token', refresh_token: refresh }),
      { signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined }));
    const j = await readJson(res);
    const fields = hfFields(j);
    if (!res.ok || !fields.hf_oauth_access) return null;
    if (!fields.hf_oauth_refresh) fields.hf_oauth_refresh = refresh;
    cacheHf(fields.hf_oauth_refresh, fields.hf_oauth_access, j.expires_in);
    if (deps && typeof deps.persist === 'function') { try { await deps.persist(fields); } catch (_) { /* used for this request */ } }
    return fields.hf_oauth_access;
  } catch (_) { return null; }
}

module.exports = { SIGNIN, NOT_OFFERED, PROVIDER_SIGNIN, viewFor, exchange, googleAccessToken, googleClient, hfClient, hfAccessToken, _hfCache: HF_ACCESS };
