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
 * Not here, and why (said on the page too):
 *   - OpenAI and Anthropic publish no sign-in for a third-party app to use a
 *     person's account; their API keys are the only route.
 *   - Google (Gemini) documents OAuth for desktop/testing clients; a public web
 *     app needs Google's app verification of its scopes first.
 *
 * The exchange runs HERE, not in the browser: the key goes straight into the
 * same encrypted store a typed key goes to (workspace-connections-core
 * saveConnection), as the signed-in person, under the workspace's write rule,
 * and is never returned to the page. The PKCE verifier and the state check stay
 * in the browser that started the sign-in (the public-client pattern).
 */

const SIGNIN = {
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

const NOT_OFFERED = {
  openai: 'OpenAI publishes no sign-in a third-party app can use to reach your account; paste an API key from platform.openai.com instead.',
  anthropic: 'Anthropic publishes no sign-in a third-party app can use to reach your account; paste an API key from console.anthropic.com instead.',
  gemini: 'Google documents Gemini sign-in for desktop and testing apps only; a public web app needs Google to verify it first. Paste an API key from aistudio.google.com instead.',
};

/**
 * The same model family THROUGH the person's own OpenRouter account
 * (2026-10-24, the operator: "sign in with AI model not added yet here?").
 * Claude, ChatGPT, Gemini and Grok have no sign-in of their own for an app, but
 * OpenRouter serves each of them on the person's OpenRouter account, so the card
 * of each offers that sign-in and the key is then used with that model. Slugs
 * read from https://openrouter.ai/api/v1/models on 2026-10-24.
 */
const VIA = {
  anthropic: { model: 'anthropic/claude-sonnet-5.5', family: 'Claude' },
  openai: { model: 'openai/gpt-5.5', family: 'ChatGPT' },
  gemini: { model: 'google/gemini-3.8-flash', family: 'Gemini' },
  grok: { model: 'x-ai/grok-4.3', family: 'Grok' },
};
const VIA_MODELS = Object.keys(VIA).map((k) => VIA[k].model);

/** What the page shows per provider: a sign-in it can start, or why there is none. */
function viewFor(providerId) {
  const s = SIGNIN[providerId];
  if (s) return { available: true, kind: s.kind, authorize_url: s.authorize_url, note: s.note, source: s.source };
  const v = VIA[providerId];
  const via = v ? {
    provider: 'openrouter', model: v.model, family: v.family, authorize_url: SIGNIN.openrouter.authorize_url,
    note: `Sign in with your OpenRouter account to use ${v.family} (${v.model}) on it: OpenRouter makes a key on your account and bills its use to your OpenRouter credits, not this app's.`,
  } : null;
  if (NOT_OFFERED[providerId]) return { available: false, note: NOT_OFFERED[providerId], via };
  if (via) return { available: false, note: '', via };
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
  if (!s) throw fail(400, 'signin_not_offered', (NOT_OFFERED[providerId]) || `There is no sign-in for "${providerId}" here.`);
  const code = String((input && input.code) || '').trim();
  // A model asked for by a provider card's "use <family> through OpenRouter":
  // only one of the listed slugs, never a string the request makes up.
  const model = String((input && input.model) || '').trim();
  if (model && VIA_MODELS.indexOf(model) < 0) throw fail(400, 'model_not_offered', `"${model}" is not a model this sign-in sets up. Start the sign-in again from a provider card.`);
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
    fields: model ? { api_key: key, model } : { api_key: key },
  });
  const fam = model ? Object.keys(VIA).map((k) => VIA[k]).filter((v) => v.model === model)[0].family : '';
  return {
    ok: true, provider: s.provider, signed_in: true, model: model || null, connection,
    message: model
      ? `Signed in with ${s.label}. This workspace now uses ${fam} (${model}) on your ${s.label} account; the key is kept encrypted and never shown.`
      : `Signed in with ${s.label}. This workspace now uses your ${s.label} account; the key is kept encrypted and never shown.`,
  };
}

module.exports = { SIGNIN, NOT_OFFERED, VIA, viewFor, exchange };
