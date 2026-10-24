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
    note: 'A Google sign-in from another app would bill that app\'s Google project, not your account. Sign in at Google AI Studio, create a key on your account, and paste it above.' },
  grok: { label: 'xAI', url: 'https://console.x.ai',
    note: 'xAI does not offer other apps a sign-in. Sign in at the xAI console, create a key on your account, and paste it above.' },
};
const NOT_OFFERED = Object.fromEntries(Object.keys(PROVIDER_SIGNIN).map((k) => [k, PROVIDER_SIGNIN[k].note]));

/** What the page shows per provider: a sign-in it can start here, or the provider's own sign-in page. */
function viewFor(providerId) {
  const s = SIGNIN[providerId];
  if (s) return { available: true, kind: s.kind, authorize_url: s.authorize_url, note: s.note, source: s.source };
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
  if (!s) throw fail(400, 'signin_not_offered', (NOT_OFFERED[providerId]) || `There is no sign-in for "${providerId}" here.`);
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

module.exports = { SIGNIN, NOT_OFFERED, PROVIDER_SIGNIN, viewFor, exchange };
