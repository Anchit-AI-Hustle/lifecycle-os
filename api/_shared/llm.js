'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Shared LLM caller — 8-provider waterfall with TIER ROUTING (July 2026 models)
//
// Providers are tried in strict DESCENDING accuracy order. The first six rungs
// require an API key; the last two are optional tail rungs that are SKIPPED
// cleanly (never attempted, never throw) unless their env config is present:
//   Ollama  → needs OLLAMA_BASE_URL   (auth header optional, OLLAMA_API_KEY)
//   Sakana  → needs SAKANA_BASE_URL + SAKANA_API_KEY
//
// TIERS (per-call `tier`, defaults via APP_AI_TIER; legacy values mapped):
//   premium  (legacy 'maxpower')          — hero copy, mailer_full, KicksGPT
//   standard (legacy 'budget' / default)  — variants, briefs, calendars
//   fast     (new)                        — classification, tagging, scoring
//
// PROVIDER ORDER per tier (first available/configured rung wins):
//   premium  : anthropic(opus 5.5)   -> openai(gpt-5.5) -> gemini(3.8-flash) -> grok(4.3) -> groq -> cerebras -> cloudflare -> openrouter -> ollama -> sakana
//   standard : anthropic(sonnet 5.5) -> openai(5-mini)  -> gemini(3.8-flash) -> grok(4.3) -> groq -> cerebras -> cloudflare -> openrouter -> ollama -> sakana
//   fast     : anthropic(haiku 5.5)  -> openai(5-nano)  -> gemini(3.8-flash) -> groq -> cerebras -> cloudflare -> openrouter -> ollama -> sakana
//
// COOL-DOWNS (2026-10-13): a key that answered "no money" (billing) or "bad key"
// (auth) is not sent again for COOL_KEY_MS; a model that hit a DAILY cap (Groq
// TPD/RPD, a per-day quota) is not asked again until the time the provider gave,
// else COOL_DAILY_MS. Per-minute rate limits are never cooled. State is per
// process, keyed by provider + a one-way fingerprint of the key, so a workspace
// key and the platform key never share one, and no key is ever held.
//
// DEMOTION RULES (see classifyFailure below for the full table):
//   • A key that is rejected or out of quota is dead for the rest of the call:
//     the next key of that provider, then the next provider.
//   • 429 rate limit, 5xx, an empty/refused/unparseable answer → next model.
//   • Model-not-found (404, or 400 naming a model error) → demote WITHIN the
//     provider to its next model first, then across providers.
//   • Any other 400, a timeout or a network/DNS failure → next provider.
//   • The cascade never stops early: when every provider has failed it throws
//     one error naming each provider tried and why, and those never tried.
//   • timeoutMs bounds one attempt (body included); budgetMs bounds the call.
//
// Within OpenAI, quota exhaustion rotates keys (OPENAI_API_KEY/_2/_3) before
// falling to the next provider. All model IDs are env-overridable:
//   *_TEXT_MODEL_MAX (premium) · *_TEXT_MODEL (standard) · *_TEXT_MODEL_FAST (fast)
//
// Anti-repetition: GEN_SEED appended to every user message so identical
// prompts cannot be served from any response cache layer.
//
// PER-WORKSPACE OVERRIDE (workspace-connections-core.js): a brand workspace can
// bring its own provider keys and its own priority order. Those arrive either
// as an explicit `overrides` option, or from the request currently being served
// (request-scope.js), and they REPLACE rather than supplement:
//   keys[p]   this workspace's key for provider p is used INSTEAD of the
//             platform's, so a workspace never silently spends platform quota
//             on a provider it configured itself.
//   order     the workspace's provider priority replaces the tier's default
//             order. `fallback` decides whether the platform's remaining
//             providers finish the cascade after the workspace's are exhausted.
//   models[p] the workspace's model chain for p replaces modelsFor(p, tier).
//   bases[p]  for the two providers reached at an account-specific address.
// A workspace with none of these resolves to null and behaves exactly as this
// module did before the feature existed.
// ─────────────────────────────────────────────────────────────────────────────

const OPENAI_BASE    = 'https://api.openai.com/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta';
const GROK_BASE      = 'https://api.x.ai/v1';
const GROQ_BASE      = 'https://api.groq.com/openai/v1';
const CEREBRAS_BASE  = 'https://api.cerebras.ai/v1';
// OpenRouter — one OpenAI-compatible gateway that routes to Claude / GPT / Gemini /
// Llama etc. via a single key. Placed as a PAID BACKSTOP rung (after the free
// tiers) so a funded OpenRouter key catches burst-overflow instead of dropping to
// the template. Unfunded (free-tier) it simply 402/404s and the cascade continues.
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
// GitHub Models was retired 2026-07-30 (docs.github.com/en/github-models) and
// timed out on every call in production: it is no longer a rung.
// Cloudflare Workers AI — FREE daily neuron allowance, OpenAI-compatible endpoint at
// /accounts/{id}/ai/v1. Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN; skipped
// cleanly when either is absent. Same account also serves free Flux images.
// Read per call, so an account id set after this module loaded is honoured.
function cloudflareBase() {
  const id = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  return id ? 'https://api.cloudflare.com/client/v4/accounts/' + id + '/ai/v1' : '';
}
// Optional tail rungs — only active when their env config is present.
// Ollama exposes an OpenAI-compatible API at ${OLLAMA_BASE_URL}/v1.
const OLLAMA_BASE    = (process.env.OLLAMA_BASE_URL || '').replace(/\/+$/, '') + (process.env.OLLAMA_BASE_URL ? '/v1' : '');
const SAKANA_BASE    = (process.env.SAKANA_BASE_URL || '').replace(/\/+$/, '') + (process.env.SAKANA_BASE_URL ? '/v1' : '');

// ── Cool-downs ───────────────────────────────────────────────────────────────
const crypto = require('crypto');
const COOL_KEY_MS = 10 * 60 * 1000;
const COOL_DAILY_MS = 30 * 60 * 1000;
const COOL = new Map();
const DAILY_RE = /per day|\bTPD\b|\bRPD\b|\bdaily\b|PerDay/i;
function keyPrint(provider, key) {
  return crypto.createHash('sha256').update(provider + '\u0000' + String(key || '')).digest('hex').slice(0, 16);
}
function coolKey(provider, key, model) { return provider + '|' + keyPrint(provider, key) + '|' + (model || '*'); }
function coolingFor(provider, key, model) {
  const now = Date.now();
  for (const k of [coolKey(provider, key, null), model ? coolKey(provider, key, model) : null]) {
    if (!k) continue;
    const e = COOL.get(k);
    if (e && e.until > now) return e;
    if (e) COOL.delete(k);
  }
  return null;
}
function setCool(provider, key, model, kind, ms) {
  const e = { provider, fingerprint: keyPrint(provider, key), model: model || null, kind, until: Date.now() + ms };
  COOL.set(coolKey(provider, key, model), e);
  return e;
}
// A provider that just TIMED OUT, or asked us to wait a few seconds, is still
// tried, but LAST for a short while (2026-10-17). Production, one Smart Brain
// preview: the keyless provider timed out after 12 s and again after 20 s, a
// key with no quota timed out after 16 s, and only then the provider that
// answered was reached: 72 s for one slot. Skipping them would lose a fallback;
// moving them behind the providers that are answering loses nothing.
const SLOW_MS = 2 * 60 * 1000;
const SLOW = new Map();
function markSlow(provider, ms) { SLOW.set(provider, Date.now() + Math.max(ms || 0, 1000)); }
function isSlow(provider) {
  const until = SLOW.get(provider);
  if (!until) return false;
  if (until > Date.now()) return true;
  SLOW.delete(provider);
  return false;
}
// The keyless provider answers one request per 30 s per address (its own
// 402 says so). With no key at all a Smart Brain build used to send three calls
// within a second, and every one after the first was refused: the copy always
// fell to the template on a keyless deployment (measured 2026-10-17). Calls to
// it from this process now wait their turn, one at a time, for as long as the
// call's own budget allows; nothing is sent that the provider would refuse.
const KEYLESS_GAP = () => (Number(process.env.LLM_KEYLESS_GAP_MS) > 0 ? Number(process.env.LLM_KEYLESS_GAP_MS) : 30000);
const KEYLESS = { next: 0, chain: Promise.resolve() };
function keylessTurn(remainingMs) {
  const turn = KEYLESS.chain.then(async () => {
    const wait = KEYLESS.next - Date.now();
    if (wait > 0) {
      if (wait > remainingMs() - 5000) return false;
      await new Promise((r) => setTimeout(r, wait));
    }
    return true;
  });
  // The next caller waits for this one's answer, not just its start.
  let release;
  const done = new Promise((r) => { release = r; });
  KEYLESS.chain = turn.then(() => done, () => done);
  return { turn, release: (afterMs) => { KEYLESS.next = Date.now() + (afterMs == null ? KEYLESS_GAP() : afterMs); release(); } };
}
// "Please try again in 6m28.8s" (Groq) when no Retry-After header came.
function waitInBody(body) {
  const m = String(body || '').match(/try again in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Math.round((Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)));
}
function openrouterCap() {
  const n = Number(process.env.OPENROUTER_MAX_TOKENS);
  return n > 0 ? Math.floor(n) : 2048;
}

// Tell the request scope (when there is one) whether this call got an answer.
function noteOutcome(kind, info) {
  try { require('./request-scope.js').noteLlm(kind, info); } catch (_) { /* no scope */ }
}

function genSeed() {
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 0xffff).toString(16);
}

/**
 * The workspace routing for the request being served, if there is one.
 *
 * Resolved lazily and defensively: this module is called from cron jobs, build
 * scripts and tests that have no request at all, and a routing lookup must
 * never be the reason a generation fails. Anything unexpected returns null and
 * the platform default cascade runs.
 */
async function scopedOverrides() {
  try {
    const connections = require('./workspace-connections-core.js');
    return await connections.llmOverridesForCurrentRequest();
  } catch (_) { return null; }
}

// ── Tier normalization (back-compat: 'maxpower'→premium, 'budget'/unset→standard)
function normalizeTier(t) {
  const s = String(t || '').toLowerCase().trim();
  if (s === 'premium' || s === 'maxpower' || s === 'max-power' || s === 'max' || s === 'output' || s === 'quality') return 'premium';
  if (s === 'fast') return 'fast';
  return 'standard'; // '', 'budget', 'standard', anything unknown
}

function _dedupe(arr) {
  const seen = new Set();
  return arr.filter(m => { if (!m || seen.has(m)) return false; seen.add(m); return true; });
}

// The free keyless text floor (see CALL.pollinations). On unless the deployment
// says FREE_GENERATION=off.
const POLLINATIONS_TEXT_URL = 'https://text.pollinations.ai/openai';
function freeGenerationOn() { return String(process.env.FREE_GENERATION || '').toLowerCase() !== 'off'; }

// ── Model tables (July 2026 — all env-overridable) ───────────────────────────
function modelsFor(provider, tier) {
  const env = process.env;
  switch (provider) {
    case 'openai':
      if (tier === 'premium') return _dedupe([env.OPENAI_TEXT_MODEL_MAX || 'gpt-5.5', 'gpt-5-mini']);
      if (tier === 'fast')    return _dedupe([env.OPENAI_TEXT_MODEL_FAST || 'gpt-5-nano']);
      return _dedupe([env.OPENAI_TEXT_MODEL || 'gpt-5-mini', 'gpt-5-nano']);
    case 'anthropic':
      if (tier === 'premium') return _dedupe([env.ANTHROPIC_TEXT_MODEL_MAX || 'claude-opus-5-5', 'claude-sonnet-5-5']);
      if (tier === 'fast')    return _dedupe([env.ANTHROPIC_TEXT_MODEL_FAST || 'claude-haiku-5-5']);
      return _dedupe([env.ANTHROPIC_TEXT_MODEL || 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    case 'gemini':
      // gemini-3.5-flash is deprecated (ai.google.dev, 2026); 3.8-flash is the stable one.
      if (tier === 'premium') return _dedupe([env.GEMINI_TEXT_MODEL_MAX || 'gemini-3.8-flash', 'gemini-2.5-flash']);
      if (tier === 'fast')    return _dedupe([env.GEMINI_TEXT_MODEL_FAST || 'gemini-3.8-flash', 'gemini-2.5-flash']);
      return _dedupe([env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash', 'gemini-2.5-flash']);
    case 'grok':
      // 'grok-4.1-fast' is not an xAI slug; grok-4.3 is (docs.x.ai).
      if (tier === 'premium') return _dedupe([env.GROK_TEXT_MODEL_MAX || 'grok-4.3']);
      return _dedupe([env.GROK_TEXT_MODEL || 'grok-4.3']);
    case 'groq':
      // llama-3.3-70b-versatile was shut down 2026-08-16 (console.groq.com/docs/deprecations).
      return _dedupe([env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
    case 'cerebras':
      // llama-3.3-70b is deprecated on Cerebras (inference-docs.cerebras.ai/support/deprecation).
      return _dedupe([env.CEREBRAS_TEXT_MODEL || 'gpt-oss-120b']);
    case 'openrouter':
      // Defaults are slugs verified to answer on the currently-provisioned key
      // (GPT-4o / GPT-4o-mini / Gemini-2.5-flash / Llama-3.3-70b). All env-overridable
      // — to route premium through Claude once OpenRouter credits are added, set
      // OPENROUTER_TEXT_MODEL_MAX=anthropic/claude-sonnet-4.5 (etc).
      if (tier === 'premium') return _dedupe([env.OPENROUTER_TEXT_MODEL_MAX || 'openai/gpt-4o', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct']);
      if (tier === 'fast')    return _dedupe([env.OPENROUTER_TEXT_MODEL_FAST || 'openai/gpt-4o-mini', 'google/gemini-2.5-flash']);
      return _dedupe([env.OPENROUTER_TEXT_MODEL || 'openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct']);
    case 'cloudflare':
      // Cloudflare Workers AI model ids (the @cf/... slugs). Env-overridable.
      // @cf/meta/llama-3.1-8b-instruct was deprecated 2026-05-30 (it answered 410);
      // the -fast variants stay active (developers.cloudflare.com changelog).
      if (tier === 'premium') return _dedupe([env.CLOUDFLARE_TEXT_MODEL_MAX || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast']);
      if (tier === 'fast')    return _dedupe([env.CLOUDFLARE_TEXT_MODEL_FAST || '@cf/meta/llama-3.1-8b-instruct-fast']);
      return _dedupe([env.CLOUDFLARE_TEXT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast']);
    case 'ollama':
      if (tier === 'premium') return _dedupe([env.OLLAMA_TEXT_MODEL_MAX || env.OLLAMA_TEXT_MODEL || 'llama3.3']);
      if (tier === 'fast')    return _dedupe([env.OLLAMA_TEXT_MODEL_FAST || env.OLLAMA_TEXT_MODEL || 'llama3.2']);
      return _dedupe([env.OLLAMA_TEXT_MODEL || 'llama3.3']);
    case 'sakana':
      return _dedupe([env.SAKANA_TEXT_MODEL || 'sakana-default']);
    case 'pollinations':
      // A label for the trace only: the request names no model, because the
      // service's documentation names none to send (text.pollinations.ai/models
      // lists the one it serves).
      return ['pollinations-default'];
    default:
      return [];
  }
}

// Provider ORDER per tier (blueprint). Fast skips Grok (no cheap rung there).
// The providers that cost nothing to call: the keyless one and the free tiers.
// FREE FIRST (2026-10-17, the operator: "everything will cost the user credits
// - but it should be done for free in the backend"): with free generation on,
// they are tried before any paid provider, and a paid key (Anthropic, OpenAI,
// xAI) is reached only when every free one failed. The user's credit charge is
// unchanged. FREE_GENERATION=off keeps the paid-first order (and no keyless).
const PAID_PROVIDERS = new Set(['anthropic', 'openai', 'grok']);
// The order a workspace's OWN models are used in: the operator's four first,
// then the rest by output quality.
const OWN_KEY_PRIORITY = ['anthropic', 'openai', 'gemini', 'grok', 'openrouter', 'groq', 'cerebras', 'cloudflare', 'sakana', 'ollama'];
function providerOrder(tier) {
  const base = providerOrderBase(tier);
  if (!freeGenerationOn()) return base;
  const keyless = base.filter((p) => p === 'pollinations');
  const freeTier = base.filter((p) => !PAID_PROVIDERS.has(p) && p !== 'pollinations');
  const paid = base.filter((p) => PAID_PROVIDERS.has(p));
  return keyless.concat(freeTier, paid);
}
function providerOrderBase(tier) {
  return tier === 'fast'
    ? ['anthropic', 'openai', 'gemini', 'groq', 'cerebras', 'cloudflare', 'openrouter', 'ollama', 'sakana', 'pollinations']
    : ['anthropic', 'openai', 'gemini', 'grok', 'groq', 'cerebras', 'cloudflare', 'openrouter', 'ollama', 'sakana', 'pollinations'];
}

// ── Failure classification (drives demotion) ─────────────────────────────────
// Every failure a provider can return is one of these, and each has exactly one
// consequence. The cascade NEVER stops early on any of them (2026-10-11): the
// worst outcome of trying the next provider is one more fast failure, while the
// worst outcome of stopping is a whole generation lost to one provider's quirk.
//
//   'auth'        401/403, or a 400 that says the KEY is bad (Gemini answers an
//                 invalid key with HTTP 400 API_KEY_INVALID). KEY-specific: the
//                 next key of the same provider is tried, then the next provider.
//                 That key is never sent again in this call.
//   'billing'     402, or a 400/403/429 whose body names quota/billing/credit
//                 (OpenAI `insufficient_quota` / `billing_hard_limit_reached`,
//                 Anthropic "credit balance is too low"). KEY-specific, as above.
//   'rate_limit'  429 with no billing words: per-model on several providers, so
//                 the next model is tried; Retry-After is recorded, never slept on.
//   'model'       404, or a 400 naming a model problem → next model of the same
//                 provider (within-provider demotion), then the next provider.
//   'bad_request' any other 400/422. Each provider gets a request body THIS file
//                 built for it, so a 400 from one is that provider's objection,
//                 not proof the prompt is bad: the next PROVIDER is tried (its
//                 sibling models would receive the same body and are skipped).
//                 Until 2026-10-11 this ABORTED the whole cascade, so an invalid
//                 Gemini key (HTTP 400) or a provider that rejected one parameter
//                 failed every generation while five other providers were up.
//   'timeout'     the per-attempt timer fired, or the network/DNS failed, or the
//                 body never arrived → next provider (siblings share the host).
//   'empty'       200 with no usable text: empty content, a refusal, a safety
//                 block, an unparseable body → next model.
//   'transient'   5xx / anything else → next model.
const BILLING_RE = /insufficient_quota|billing|credit balance|credit_balance|exceeded your current quota|quota[ _]exceeded|resource_exhausted|payment required|out of credits|insufficient (?:credits|funds|balance)|\bquota\b|\bcredits?\b|\bbalance\b/i;
const HARD_BILLING_RE = /insufficient_quota|billing|credit balance|payment required|out of credits/i;
const RATE_RE = /rate[ _-]?limit|requests per|tokens per|per minute|too many requests/i;
const BAD_KEY_RE =/api[ _-]?key[ _-]?(?:not[ _-]?valid|invalid|expired)|invalid[ _-]api[ _-]?key|incorrect api key|invalid x-api-key|invalid_api_key|API_KEY_INVALID|authentication_error|unauthori[sz]ed|permission_denied/i;
const MODEL_ERR_RE = /model_not_found|model not found|does not exist|unknown model|invalid model|decommissioned|deprecated|no longer (?:available|supported)|is not supported|not supported for|not found for api version|unsupported model/i;

function classifyFailure(status, errBody) {
  const body = String(errBody || '');
  if (status === 0) return 'timeout';
  if (status === 200) return 'empty';
  if (status === 401 || (status === 403 && !BILLING_RE.test(body))) return 'auth';
  if (status === 400 && BAD_KEY_RE.test(body)) return 'auth';
  if (status === 402) return 'billing';
  if (status === 429) {
    // A 429 is a quota only when it says so and is not a per-minute rate limit
    // ("Quota exceeded for requests per minute" is a rate limit by another name).
    if (HARD_BILLING_RE.test(body)) return 'billing';
    return (BILLING_RE.test(body) && !RATE_RE.test(body)) ? 'billing' : 'rate_limit';
  }
  if ((status === 400 || status === 403) && BILLING_RE.test(body)) return 'billing';
  if (status === 404 || ((status === 400 || status === 422) && MODEL_ERR_RE.test(body))) return 'model';
  if (status === 400 || status === 422 || status === 413) return 'bad_request';
  return 'transient';
}

// What each class means, in the words the final error uses.
const KIND_WORDS = {
  auth: 'key rejected', billing: 'quota / billing exhausted', rate_limit: 'rate limited',
  model: 'model unavailable', bad_request: 'request refused', timeout: 'timeout / network',
  empty: 'no usable text', transient: 'provider error', budget: 'call budget exhausted',
};

/** Seconds a Retry-After header asks for (delta-seconds or HTTP-date), or null. */
function retryAfterSeconds(h) {
  if (!h) return null;
  const s = String(h).trim();
  if (/^\d+(?:\.\d+)?$/.test(s)) return Math.round(Number(s));
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, Math.round((t - Date.now()) / 1000)) : null;
}

// Strip BOM (U+FEFF), zero-width spaces, and whitespace — Vercel env can inject invisible chars
function _clean(s) { return String(s || '').replace(/[﻿​ ]/g, '').trim(); }

/**
 * callLLM({ systemPrompt, userMessage, responseFormat, maxTokens, temperature, timeoutMs, budgetMs, stage, tier, preferProvider, exclusive, userGeminiKey, overrides })
 *   tier: 'premium' | 'standard' (default) | 'fast'
 *         (legacy: 'maxpower'→premium, 'budget'→standard — existing callers unchanged)
 *   timeoutMs: the cap on ONE attempt (one provider, one model, one key).
 *   budgetMs:  the cap on the WHOLE cascade (default LLM_TOTAL_BUDGET_MS, else
 *         max(2 × timeoutMs, 50s)). No attempt is given more than what is left,
 *         and once it is spent the cascade stops and says which providers it
 *         never reached, rather than running past the serverless limit.
 *   preferProvider: try this provider FIRST; the rest of the cascade still
 *         follows it. `exclusive: true` makes it the only one (the live probe,
 *         which asks whether ONE provider answers, is the only caller).
 *   overrides: { order, models, keys, bases, fallback } — a workspace's own
 *         routing. Omitted by every existing caller; when omitted, the routing
 *         of the request being served is used, and failing that the default.
 * Returns { text, provider, model, seed, quota_warning?, exhausted_keys?, routing, attempts }
 * Throws when every provider fails: the message names each provider tried and
 * why, err._providerErrors carries per-attempt detail and err._skipped the
 * providers that were never tried (no key / outside the routing / no budget).
 */
module.exports = async function callLLM(opts) {
  const {
    systemPrompt  = '',
    userMessage   = '',
    responseFormat = null,   // { type: 'json_object' } or null
    maxTokens     = 2000,
    temperature   = 0.7,
    timeoutMs     = 30000,
    stage         = 'llm',
    userGeminiKey = '',
    preferProvider = '',     // per-call provider preference — same values as APP_AI_PROVIDER
    exclusive     = false,
    tier          = (process.env.APP_AI_TIER || 'standard')
  } = opts;

  const tierNorm = normalizeTier(tier);
  const startedAt = Date.now();
  const askedBudget = Number(opts.budgetMs) > 0 ? Number(opts.budgetMs)
    : (Number(process.env.LLM_TOTAL_BUDGET_MS) > 0 ? Number(process.env.LLM_TOTAL_BUDGET_MS) : Math.max(2 * timeoutMs, 50000));
  // Never past the request's own deadline (time-budget.js): the router answers
  // there, so a model call that ran beyond it would be work nobody receives.
  let deadlineLeft = Infinity;
  try { deadlineLeft = require('./time-budget.js').timeLeft() - 1000; } catch (_) { /* no scope */ }
  let budgetMs = Math.max(0, Math.min(askedBudget, deadlineLeft));
  const remaining = () => budgetMs - (Date.now() - startedAt);
  // An attempt shorter than this cannot complete a generation; it is not started.
  const MIN_ATTEMPT_MS = 750;

  // An explicit override beats the ambient one (the connection check pins a
  // single provider that way); `overrides: null` explicitly asks for the
  // platform default and is honoured as written.
  const ov = (opts.overrides !== undefined) ? opts.overrides : await scopedOverrides();
  const ovKeys  = (ov && ov.keys) || {};
  const ovModels = (ov && ov.models) || {};
  const ovOrder = _dedupe((ov && Array.isArray(ov.order)) ? ov.order.map((p) => String(p || '').toLowerCase().trim()) : []);

  // A workspace order is an explicit human decision about which providers see
  // this brand's data; preferProvider is an internal latency optimisation that
  // pins whichever provider answered first this turn. The decision outranks the
  // optimisation, so the pin is dropped when a workspace order exists rather
  // than being allowed to run a provider the workspace left out.
  const preferredProvider = ovOrder.length ? '' : String(preferProvider || process.env.APP_AI_PROVIDER || '').toLowerCase().trim();

  // A workspace key REPLACES the platform's for that provider — including the
  // rotation set, so a workspace never falls back onto platform OpenAI quota.
  // The platform's three keys are cleaned and de-duplicated: the same key set
  // twice would be sent twice after it had already been refused.
  const openaiKeys = _dedupe(ovKeys.openai ? [_clean(ovKeys.openai)] : [
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_API_KEY_2,
    process.env.OPENAI_API_KEY_3
  ].map(_clean));

  const anthropicKey = _clean(ovKeys.anthropic) || _clean(process.env.ANTHROPIC_API_KEY);
  const geminiKey    = _clean(ovKeys.gemini) || _clean(userGeminiKey) || _clean(process.env.GEMINI_API_KEY);
  const grokKey      = _clean(ovKeys.grok) || _clean(process.env.XAI_API_KEY);
  const groqKey      = _clean(ovKeys.groq) || _clean(process.env.GROQ_API_KEY);
  const cerebrasKey  = _clean(ovKeys.cerebras) || _clean(process.env.CEREBRAS_API_KEY);
  // OpenRouter — accept the canonical name OR the existing mixed-case env var name
  // (`OpenRouter_API_KEY`) already provisioned in this project.
  const openrouterKey = _clean(ovKeys.openrouter) || _clean(process.env.OPENROUTER_API_KEY) || _clean(process.env.OpenRouter_API_KEY);

  // Base URLs. Cloudflare and Ollama are reached at an address that belongs to
  // the account rather than to the vendor, so for those the base is part of the
  // credential and a workspace can supply its own.
  const bases = {
    openai: OPENAI_BASE, anthropic: ANTHROPIC_BASE, gemini: GEMINI_BASE,
    grok: GROK_BASE, groq: GROQ_BASE, cerebras: CEREBRAS_BASE,
    openrouter: OPENROUTER_BASE,
    cloudflare: cloudflareBase(), ollama: OLLAMA_BASE, sakana: SAKANA_BASE,
  };
  if (ov && ov.bases) for (const k of Object.keys(ov.bases)) if (ov.bases[k]) bases[k] = ov.bases[k];

  const cloudflareKey = _clean(ovKeys.cloudflare) || _clean(process.env.CLOUDFLARE_API_TOKEN);
  const cloudflareOn  = !!bases.cloudflare && !!cloudflareKey;
  const ollamaKey    = _clean(ovKeys.ollama) || _clean(process.env.OLLAMA_API_KEY) || 'ollama';
  const ollamaOn     = !!bases.ollama;
  const sakanaKey    = _clean(process.env.SAKANA_API_KEY);
  const sakanaOn     = !!bases.sakana && !!sakanaKey;
  console.log('[llm] Keys present: groq=' + !!groqKey + ' cerebras=' + !!cerebrasKey + ' gemini=' + !!geminiKey + ' tier=' + tierNorm + ' workspace_routing=' + !!ov);

  const hasKey = {
    openai:    openaiKeys.length > 0,
    anthropic: !!anthropicKey,
    gemini:    !!geminiKey,
    grok:      !!grokKey,
    groq:      !!groqKey,
    cerebras:  !!cerebrasKey,
    openrouter: !!openrouterKey,
    cloudflare: cloudflareOn,  // gated on CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
    ollama:    ollamaOn,       // gated on OLLAMA_BASE_URL (auth optional)
    sakana:    sakanaOn,       // gated on SAKANA_BASE_URL + SAKANA_API_KEY
    // The free, keyless floor (2026-10-17): the operator asked that every model
    // feature work with no key at all. Last in every order; FREE_GENERATION=off
    // turns it off (prompts then never leave for a service nobody configured).
    pollinations: freeGenerationOn(),
  };

  // Nothing but the keyless floor: its answers take 15-40 s for a full copy
  // prompt (measured), and its turn may be up to 30 s away, so the call gets the
  // time that needs (still never past the request's deadline). A per-attempt
  // cap written for a keyed provider (12-20 s) cut every answer off.
  const keylessOnly = !!hasKey.pollinations && !Object.keys(hasKey).some((p) => p !== 'pollinations' && hasKey[p]);
  if (keylessOnly) budgetMs = Math.max(0, Math.min(Math.max(askedBudget, 90000), deadlineLeft));
  const keylessAttemptMs = Math.max(timeoutMs, 55000);

  if (!Object.keys(hasKey).some((p) => p !== 'sakana' && hasKey[p])) {
    const e = new Error('No AI provider configured. Set at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, XAI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, CLOUDFLARE_API_TOKEN(+CLOUDFLARE_ACCOUNT_ID)');
    e._providerErrors = [];
    e._skipped = Object.keys(hasKey).map((p) => ({ provider: p, reason: 'no key configured' }));
    e._noProvider = true;
    noteOutcome('failed');
    throw e;
  }

  const seed             = genSeed();
  const seededUserMessage = userMessage + '\n\n<!-- gen_seed:' + seed + ' -->';

  // ── One HTTP attempt, bounded end to end ───────────────────────────────────
  // The timer covers the BODY as well as the headers. It used to be cleared as
  // soon as the status line arrived, so a provider that answered 200 and then
  // stalled mid-body held the call until the platform killed the function.
  async function attempt(provider, model, url, init, perAttemptMs, readText) {
    const ms = Math.max(1, Math.min(perAttemptMs, remaining()));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, Object.assign({ method: 'POST', cache: 'no-store', signal: ctrl.signal }, init));
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        const ra = retryAfterSeconds(r.headers && typeof r.headers.get === 'function' ? r.headers.get('retry-after') : null);
        console.error('[llm][' + stage + '] ' + provider + ' ' + r.status + ' model=' + model, String(err).substring(0, 200));
        return { ok: false, status: r.status, err, retry_after_s: ra };
      }
      let data;
      try { data = JSON.parse(await r.text()); }
      catch (e) {
        if (ctrl.signal.aborted) return { ok: false, status: 0, err: 'timeout after ' + ms + 'ms (body)' };
        return { ok: false, status: 200, err: 'invalid_json_body' };
      }
      const got = readText(data || {});
      if (got.refusal) { console.warn('[llm][' + stage + '] ' + provider + ' refused on ' + model + ' — demoting'); return { ok: false, status: 200, err: 'refusal: ' + got.refusal }; }
      if (!String(got.text || '').trim()) { console.warn('[llm][' + stage + '] ' + provider + ' EMPTY content on ' + model + ' — demoting'); return { ok: false, status: 200, err: 'empty_response' }; }
      console.log('[llm][' + stage + '] ' + provider + ' ok model=' + model + ' len=' + got.text.length);
      return { ok: true, text: got.text, provider, model };
    } catch (e) {
      const aborted = ctrl.signal.aborted;
      return { ok: false, status: 0, err: aborted ? ('timeout after ' + ms + 'ms') : (e && e.message) || String(e) };
    } finally {
      clearTimeout(t);
    }
  }

  // OpenAI-shaped answer: content, or a refusal / content filter.
  function readChat(data) {
    const c = data.choices && data.choices[0];
    const msg = (c && c.message) || {};
    const content = typeof msg.content === 'string' ? msg.content
      : Array.isArray(msg.content) ? msg.content.map((p) => (p && (p.text || '')) || '').join('') : '';
    if (!String(content).trim() && msg.refusal) return { refusal: String(msg.refusal).slice(0, 160) };
    if (c && c.finish_reason === 'content_filter') return { refusal: 'content_filter' };
    return { text: content };
  }

  function _openai(model, key) {
    return attempt('openai', model, bases.openai + '/chat/completions', {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: seededUserMessage }],
        max_tokens: maxTokens, temperature,
        ...(responseFormat ? { response_format: responseFormat } : {})
      }),
    }, timeoutMs, readChat);
  }

  function _anthropic(model) {
    // Claude has no native JSON mode — inject instruction into system prompt
    const claudeSystem = responseFormat
      ? systemPrompt + '\n\nCRITICAL: Return ONLY valid JSON. First character must be { and last must be }. No markdown fences, no commentary, no text before or after.'
      : systemPrompt;
    return attempt('anthropic', model, bases.anthropic + '/messages', {
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      // 4.6+ Claude models reject temperature+top_p together (and some reject
      // temperature outright) — we NEVER send top_p, and only send temperature
      // on legacy claude-3* models (none in the default chains; env override only).
      body: JSON.stringify(Object.assign({
        model, max_tokens: maxTokens, system: claudeSystem,
        messages: [{ role: 'user', content: seededUserMessage }]
      }, /^claude-3/.test(model) ? { temperature } : {})),
    }, timeoutMs, (data) => {
      // Every TEXT block, in order. A response can open with a thinking block,
      // and reading only content[0] read that as "no text" on a good answer.
      const blocks = Array.isArray(data.content) ? data.content : [];
      const out = blocks.filter((b) => b && b.type !== 'thinking' && b.type !== 'redacted_thinking' && typeof b.text === 'string').map((b) => b.text).join('');
      if (data.stop_reason === 'refusal') return { refusal: 'stop_reason refusal' };
      return { text: out };
    });
  }

  function _gemini(model) {
    const combined = systemPrompt + '\n\n---\nUSER REQUEST:\n' + seededUserMessage;
    // Gemini free tier can be slower — give 30% more time than other providers
    return attempt('gemini', model,
      bases.gemini + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(geminiKey), {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: combined }] }],
          generationConfig: {
            temperature, maxOutputTokens: maxTokens,
            ...(responseFormat ? { responseMimeType: 'application/json' } : {}),
            // thinkingConfig only for 2.5 thinking models — causes 400 on other families
            ...(responseFormat && model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
          }
        }),
      }, Math.round(timeoutMs * 1.3), (data) => {
        const cand = data.candidates && data.candidates[0];
        const parts = (cand && cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
        const out = parts.filter((p) => p && !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
        if (!out.trim() && data.promptFeedback && data.promptFeedback.blockReason) return { refusal: 'blocked: ' + data.promptFeedback.blockReason };
        if (!out.trim() && cand && /SAFETY|RECITATION|BLOCKLIST|PROHIBITED/i.test(String(cand.finishReason || ''))) return { refusal: 'finishReason ' + cand.finishReason };
        return { text: out };
      });
  }

  // Grok / Groq / Cerebras / OpenRouter / GitHub / Cloudflare / Ollama / Sakana
  // are OpenAI-compatible chat endpoints.
  function _openaiCompatible(providerName, base, key, extra) {
    return function (model) {
      return attempt(providerName, model, base + '/chat/completions', {
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(Object.assign({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: seededUserMessage }],
          temperature
        }, extra(model))),
      }, timeoutMs, readChat);
    };
  }
  const _std = () => ({ max_tokens: maxTokens, ...(responseFormat ? { response_format: responseFormat } : {}) });
  const CALL = {
    anthropic: _anthropic,
    gemini: _gemini,
    grok: _openaiCompatible('grok', bases.grok, grokKey, _std),
    groq: _openaiCompatible('groq', bases.groq, groqKey, _std),
    // Cerebras: free tier caps output at 8K; no response_format support yet.
    cerebras: _openaiCompatible('cerebras', bases.cerebras, cerebrasKey, () => ({ max_tokens: Math.min(maxTokens, 8192) })),
    // OpenRouter reserves credit for max_tokens up front and answers 402 when the
    // balance cannot cover it, so it is asked for less (OPENROUTER_MAX_TOKENS,
    // default 2048): a low balance then answers instead of failing.
    openrouter: _openaiCompatible('openrouter', bases.openrouter, openrouterKey, () => Object.assign(_std(), { max_tokens: Math.min(maxTokens, openrouterCap()) })),
    cloudflare: _openaiCompatible('cloudflare', bases.cloudflare, cloudflareKey, _std),
    ollama: _openaiCompatible('ollama', bases.ollama, ollamaKey, _std),
    sakana: _openaiCompatible('sakana', bases.sakana, sakanaKey, _std),
    // Pollinations' documented OpenAI-compatible endpoint, no key, no model and
    // no response_format (neither is documented); one request per 30 s per
    // address, answered 402 + Retry-After when exceeded (counted as a rate limit).
    pollinations: async function (model) {
      const send = () => attempt('pollinations', model, POLLINATIONS_TEXT_URL, {
        headers: { 'Content-Type': 'application/json' },
        // Its model is a REASONING model (gpt-oss-20b, measured 2026-10-17)
        // with a default of 1,500 completion tokens: on Smart Brain's copy
        // prompt the reasoning took all of them and the answer was 53
        // characters (finish "length"). It accepts the OpenAI fields
        // max_tokens and reasoning_effort (measured: complete JSON, finish
        // "stop", 15 s), so the answer gets its room and reasoning stays short.
        body: JSON.stringify({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: seededUserMessage }], max_tokens: Math.min(8000, Math.max(4000, maxTokens + 2000)), reasoning_effort: 'low' }),
      }, keylessOnly ? keylessAttemptMs : timeoutMs, readChat);
      if (!keylessOnly) return send();
      // The only provider: wait for its turn rather than be refused, and when
      // it still asks to wait (another process used the turn) wait once more
      // if the call's budget allows.
      for (let tries = 0; tries < 2; tries++) {
        const t = keylessTurn(remaining);
        const mine = await t.turn;
        if (!mine) { t.release(KEYLESS.next - Date.now()); return { ok: false, status: 402, err: 'keyless provider busy: its next free turn is after this call\'s budget', retry_after_s: Math.ceil((KEYLESS.next - Date.now()) / 1000) }; }
        const r = await send();
        const waitS = r.ok ? null : (r.retry_after_s != null ? r.retry_after_s : waitInBody(r.err) || (((String(r.err || '').match(/retry after\s+(\d+)\s*s/i)) || [])[1] | 0) || null);
        t.release(r.ok ? KEYLESS_GAP() : Math.max(KEYLESS_GAP(), (waitS || 0) * 1000));
        if (r.ok || r.status !== 402 || tries === 1) return r;
      }
      return { ok: false, status: 402, err: 'keyless provider busy' };
    },
  };

  // ── Tier-ordered cascade ────────────────────────────────────────────────────
  let openaiKeysExhausted = 0;
  const _providerErrors = []; // one row per failed ATTEMPT, in the order made
  const _skipped = [];        // providers never tried, and why
  const keyFor = {
    anthropic: anthropicKey, gemini: geminiKey, grok: grokKey, groq: groqKey, cerebras: cerebrasKey,
    openrouter: openrouterKey, cloudflare: cloudflareKey + '@' + bases.cloudflare, ollama: ollamaKey + '@' + bases.ollama,
    sakana: sakanaKey + '@' + bases.sakana, pollinations: 'keyless',
  };
  const coolWords = (e) => 'cooling down after ' + (KIND_WORDS[e.kind] || e.kind) + (e.model ? ' on ' + e.model : '') + ' until ' + new Date(e.until).toISOString();
  let budgetOut = false;

  function record(provider, model, result, keyIndex) {
    // Pollinations answers its per-address limit with 402: a wait, not a bill.
    const kind = provider === 'pollinations' && result.status === 402 ? 'rate_limit' : classifyFailure(result.status, result.err);
    const row = {
      provider, model, status: result.status, kind, reason: KIND_WORDS[kind] || kind,
      err: String(result.err || '').substring(0, 120),
    };
    if (keyIndex) row.key_index = keyIndex;
    if (result.retry_after_s != null) row.retry_after_s = result.retry_after_s;
    _providerErrors.push(row);
    // A key with no money or a rejected key, and a model out of its DAILY cap,
    // are not asked again on the next request (each cost one wasted call per
    // request in production). A per-minute rate limit is left alone.
    const key = provider === 'openai' ? openaiKeys[(keyIndex || 1) - 1] : keyFor[provider];
    const waitS = result.retry_after_s != null ? result.retry_after_s : waitInBody(result.err);
    if (kind === 'auth' || kind === 'billing') {
      row.cooled_until = new Date(setCool(provider, key, null, kind, Math.max(COOL_KEY_MS, (waitS || 0) * 1000)).until).toISOString();
    } else if (kind === 'rate_limit' && DAILY_RE.test(String(result.err || ''))) {
      row.cooled_until = new Date(setCool(provider, key, model, kind, waitS ? waitS * 1000 : COOL_DAILY_MS).until).toISOString();
    } else if (kind === 'timeout') {
      markSlow(provider, SLOW_MS);
    } else if (kind === 'rate_limit') {
      const m = String(result.err || '').match(/retry after\s+(\d+)\s*s/i);
      markSlow(provider, (waitS || (m && Number(m[1])) || 30) * 1000);
    }
    return kind;
  }

  function _success(result) {
    noteOutcome('ok', { own: !!ovKeys[result.provider] });
    return { text: result.text, provider: result.provider, model: result.model, seed,
             quota_warning: openaiKeysExhausted > 0, exhausted_keys: openaiKeysExhausted,
             // Which routing decided this call, and whether the key that paid
             // for it was the workspace's. Never the key, only the fact.
             routing: ov ? 'workspace' : 'platform',
             workspace_key: !!ovKeys[result.provider],
             // What failed before this answer, so a caller can see it was a fallback.
             attempts: _providerErrors.slice(), fell_back: _providerErrors.length > 0 };
  }

  const budgetLeft = () => {
    if (remaining() >= MIN_ATTEMPT_MS) return true;
    budgetOut = true;
    return false;
  };

  // Runs one provider's model chain with within-provider demotion.
  // Returns the success result, or null when the chain is exhausted.
  async function runChain(providerName, callFn, models) {
    for (const model of models) {
      if (coolingFor(providerName, keyFor[providerName], model)) continue;
      if (!budgetLeft()) return null;
      const result = await callFn(model);
      if (result.ok) return result;
      const kind = record(providerName, model, result);
      // The key is dead (auth/billing), the host is not answering, or this
      // provider refused the body every sibling would receive: the rest of
      // this chain would fail the same way, so go to the next provider.
      if (kind === 'auth' || kind === 'billing' || kind === 'timeout' || kind === 'bad_request') {
        console.warn('[llm][' + stage + '] ' + providerName + ' ' + result.status + ' (' + kind + ') — falling to next provider');
        return null;
      }
      // NOTE: no wait-and-retry on a 429. The free-tier 429 is usually a DAILY
      // quota, so sleeping never recovered and stacked into function timeouts.
      console.warn('[llm][' + stage + '] ' + providerName + ' ' + result.status + ' (' + kind + ') on ' + model + ' — trying next model');
    }
    return null;
  }

  // OpenAI rotates keys inside the model loop. A key that answered auth or
  // billing is dead for the rest of THIS call and is never sent again, even to
  // a sibling model; a model error moves on to the next model with the keys
  // that are still alive.
  async function runOpenai(models) {
    const dead = new Set();
    for (const model of models) {
      let nextModel = false;
      for (let ki = 0; ki < openaiKeys.length; ki++) {
        if (dead.has(ki)) continue;
        if (coolingFor('openai', openaiKeys[ki], model)) { if (coolingFor('openai', openaiKeys[ki], null)) dead.add(ki); continue; }
        if (!budgetLeft()) return null;
        const result = await _openai(model, openaiKeys[ki]);
        if (result.ok) return result;
        const kind = record('openai', model, result, ki + 1);
        if (kind === 'billing' || kind === 'auth') {
          dead.add(ki);
          if (kind === 'billing') openaiKeysExhausted++;
          console.warn('[llm][' + stage + '] OpenAI key #' + (ki + 1) + ' ' + kind + ' — rotating');
          continue; // next key, same model
        }
        if (kind === 'rate_limit') { console.warn('[llm][' + stage + '] OpenAI key #' + (ki + 1) + ' rate limited — rotating'); continue; }
        if (kind === 'model' || kind === 'empty' || kind === 'transient') { nextModel = true; break; }
        // timeout / bad_request → next provider
        console.warn('[llm][' + stage + '] OpenAI ' + result.status + ' (' + kind + ') — falling to next provider');
        return null;
      }
      if (dead.size >= openaiKeys.length) return null; // every key is dead
      if (!nextModel && openaiKeys.some((k, i) => !dead.has(i) && !coolingFor('openai', k, model))) return null; // every live key rate limited on this model
    }
    return null;
  }

  // The cascade order. A workspace order comes FIRST and in full; the tier's
  // default providers are appended after it only when the workspace allowed the
  // platform to finish the job (`fallback`). A workspace that turned fallback
  // off has said its brand's prompts go to the providers it named and nowhere
  // else, so the cascade ends there even if that means failing.
  const known = (p) => hasKey[p] !== undefined;
  let order;
  let outsideRouting = [];
  // THE WORKSPACE'S OWN KEYS (2026-10-17, the operator: "users should still
  // have the option to integrate the ai models they want to use themselves ...
  // if entered, then only those ai models shall be used with the priority
  // order ... claude, openai, gemini, grok and then so on based on the accuracy
  // and quality"). A workspace that connected any model of its own gets ONLY
  // its own models, in that fixed order; the platform's keys and the free
  // model are not used for it. With none connected, the platform's free-first
  // order (providerOrder) applies.
  const ownKeyed = new Set((Array.isArray(ov && ov.configured) && ov.configured.length ? ov.configured : Object.keys(ovKeys))
    .map((p) => String(p).toLowerCase()).filter((p) => known(p)));
  if (ownKeyed.size) {
    order = OWN_KEY_PRIORITY.filter((p) => ownKeyed.has(p));
    for (const p of ownKeyed) if (order.indexOf(p) < 0) order.push(p);
    if (exclusive && preferredProvider && ownKeyed.has(preferredProvider)) order = [preferredProvider];
    outsideRouting = providerOrder(tierNorm).filter((p) => order.indexOf(p) < 0);
  } else if (ov && ov.fallback === false && !ovOrder.length) {
    // "Only my providers" with no explicit order: the providers the workspace
    // CONNECTED, in the tier's order. This used to run the platform's whole
    // default cascade on the platform's keys, which is the one thing switching
    // the fallback off says not to do.
    const mine = new Set((Array.isArray(ov.configured) && ov.configured.length ? ov.configured : Object.keys(ovKeys)).map((p) => String(p).toLowerCase()));
    order = providerOrder(tierNorm).filter((p) => mine.has(p));
    for (const p of mine) if (known(p) && order.indexOf(p) < 0) order.push(p);
    outsideRouting = providerOrder(tierNorm).filter((p) => !mine.has(p));
  } else if (ovOrder.length) {
    order = ovOrder.filter(known);
    if (ov.fallback !== false) {
      for (const p of providerOrder(tierNorm)) if (order.indexOf(p) < 0) order.push(p);
    } else {
      outsideRouting = providerOrder(tierNorm).filter((p) => order.indexOf(p) < 0);
    }
  } else if (preferredProvider === 'gemini+') {
    // 'gemini+' is a deliberate FREE-ONLY route: Gemini, then the free rungs.
    order = providerOrder(tierNorm).filter((p) => p === 'gemini' || p === 'groq' || p === 'cerebras');
    outsideRouting = providerOrder(tierNorm).filter((p) => order.indexOf(p) < 0);
  } else {
    order = providerOrder(tierNorm).slice();
    // With free generation on, a PAID provider named as a preference does not
    // jump the free ones (an exclusive pin, which a capability needs, still does).
    const paidPreference = freeGenerationOn() && PAID_PROVIDERS.has(preferredProvider) && !exclusive;
    if (preferredProvider && known(preferredProvider) && !paidPreference) {
      // A preferred provider goes FIRST, and the rest of the cascade still
      // follows it. It used to SKIP every other provider, so a pinned provider
      // that stumbled once left the call with no fallback at all (the sticky
      // provider in brand-llm.js and the analyst->copy pin both hit this).
      order = [preferredProvider].concat(order.filter((p) => p !== preferredProvider));
      if (exclusive) { outsideRouting = order.slice(1); order = [preferredProvider]; }
    }
  }
  order = _dedupe(order);
  // Providers that timed out or asked to wait moments ago go last, in order.
  if (order.length > 1) order = order.filter((p) => !isSlow(p)).concat(order.filter(isSlow));
  for (const p of outsideRouting) if (hasKey[p]) _skipped.push({ provider: p, reason: 'outside this call\'s routing' });

  for (let i = 0; i < order.length; i++) {
    const providerName = order[i];
    if (!hasKey[providerName]) { _skipped.push({ provider: providerName, reason: 'no key configured' }); continue; }
    if (!budgetLeft()) {
      for (const p of order.slice(i)) if (hasKey[p]) _skipped.push({ provider: p, reason: 'call budget exhausted (' + budgetMs + 'ms)' });
      break;
    }
    // A workspace's model chain replaces the tier chain for that provider. It
    // may name a model this platform does not ship, which is deliberate: the
    // account paying for the call knows what it can reach, and a model-not-found
    // demotes within the provider.
    const chosen = ovModels[providerName];
    const models = _dedupe((Array.isArray(chosen) && chosen.length ? chosen : modelsFor(providerName, tierNorm)).map((m) => String(m || '').trim()));
    const keys = providerName === 'openai' ? openaiKeys : [keyFor[providerName]];
    const cooling = keys.map((k) => models.map((m) => coolingFor(providerName, k, m)));
    if (cooling.every((row) => row.every(Boolean))) {
      const e = cooling[0][0];
      _skipped.push({ provider: providerName, reason: coolWords(e), until: new Date(e.until).toISOString(), kind: e.kind });
      continue;
    }
    console.warn('[llm][' + stage + '] Trying ' + providerName + ' (tier=' + tierNorm + ')');
    const result = providerName === 'openai'
      ? await runOpenai(models)
      : await runChain(providerName, CALL[providerName], models);
    if (result && result.ok) return _success(result);
    if (budgetOut) {
      for (const p of order.slice(i + 1)) if (hasKey[p]) _skipped.push({ provider: p, reason: 'call budget exhausted (' + budgetMs + 'ms)' });
      break;
    }
  }

  // === All providers exhausted — one error that names each and why ===
  const _failLog = _providerErrors.map(function (e) { return e.provider + ':' + e.status; }).join(' → ');
  const tried = _providerErrors.map(function (e) {
    return e.provider + (e.model ? ' (' + e.model + (e.key_index ? ', key #' + e.key_index : '') + ')' : '') + ': ' + e.reason +
      (e.status ? ' HTTP ' + e.status : '') + (e.retry_after_s != null ? ', retry after ' + e.retry_after_s + 's' : '');
  }).join('; ');
  const notTried = _skipped.map(function (s) { return s.provider + ': ' + s.reason; }).join('; ');
  console.error('[llm][' + stage + '] ALL PROVIDERS FAILED: ' + tried + (notTried ? ' | not tried: ' + notTried : ''));
  const last = _providerErrors[_providerErrors.length - 1];
  const errMsg = last ? String(last.err || '').substring(0, 250) : 'All providers exhausted';
  const err = new Error(
    'All providers failed [' + stage + '] cascade=' + (_failLog || 'none-attempted') +
    ' | tried: ' + (tried || 'none') + (notTried ? ' | not tried: ' + notTried : '') + ' | last=' + errMsg
  );
  err._providerErrors = _providerErrors;
  err._skipped = _skipped;
  if (budgetOut) err._budgetExhausted = true;
  noteOutcome('failed');
  throw err;
};

/**
 * parseJSON(text) — multi-strategy JSON extractor.
 * Handles: clean JSON, markdown fences, prose prefix/suffix, nested fences.
 */
/** Forget every cool-down (tests; and an operator who has just topped up a key). */
module.exports.resetProviderCooldowns = function resetProviderCooldowns() { COOL.clear(); SLOW.clear(); };
/** The active cool-downs: provider, key fingerprint, model, kind, until. Never a key. */
module.exports.providerCooldowns = function providerCooldowns() {
  const now = Date.now();
  return [...COOL.values()].filter((e) => e.until > now).map((e) => Object.assign({}, e, { until: new Date(e.until).toISOString() }));
};

module.exports.parseJSON = function parseJSON(text) {
  if (!text || typeof text !== 'string') throw new SyntaxError('Empty or non-string LLM response');
  try { return JSON.parse(text); } catch (_) {}
  const stripped = text.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/m, '').trim();
  try { return JSON.parse(stripped); } catch (_) {}
  const bs = text.indexOf('{'), be = text.lastIndexOf('}');
  if (bs !== -1 && be > bs) { try { return JSON.parse(text.slice(bs, be + 1)); } catch (_) {} }
  const ss = stripped.indexOf('{'), se = stripped.lastIndexOf('}');
  if (ss !== -1 && se > ss) { try { return JSON.parse(stripped.slice(ss, se + 1)); } catch (_) {} }
  // Common LLM failure: raw control characters (literal newlines/tabs) inside
  // string values, which JSON.parse rejects. Escape them, then retry the same
  // extraction strategies before falling through to truncation repair.
  const escaped = escapeControlCharsInStrings(text);
  if (escaped !== text) {
    try { return JSON.parse(escaped); } catch (_) {}
    const es = escaped.indexOf('{'), ee = escaped.lastIndexOf('}');
    if (es !== -1 && ee > es) { try { return JSON.parse(escaped.slice(es, ee + 1)); } catch (_) {} }
  }
  // Last resort: repair a TRUNCATED object (model hit the token limit mid-JSON).
  // Drop any trailing incomplete token, then close open strings and brackets so
  // the fields already generated survive instead of failing the whole build.
  const repairSource = escaped.indexOf('{') !== -1 ? escaped : (stripped.indexOf('{') !== -1 ? stripped : text);
  const repaired = repairTruncatedJSON(repairSource);
  if (repaired) {
    try { return JSON.parse(repaired); } catch (_) {}
    try { return JSON.parse(escapeControlCharsInStrings(repaired)); } catch (_) {}
  }
  throw new SyntaxError('Could not parse JSON from LLM response. First 200 chars: ' + text.substring(0, 200));
};

/**
 * escapeControlCharsInStrings(text) — escape raw newlines/tabs/carriage-returns
 * that appear INSIDE JSON string values (a frequent LLM output defect that makes
 * JSON.parse throw). Control chars outside strings (formatting whitespace) are
 * left untouched so object structure is preserved.
 */
function escapeControlCharsInStrings(text) {
  let out = '';
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === '\\') { out += c; esc = true; continue; }
      if (c === '"') { out += c; inStr = false; continue; }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      if (c.charCodeAt(0) < 0x20) { continue; } // drop other control chars
      out += c;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    out += c;
  }
  return out;
}

function repairTruncatedJSON(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let s = text.slice(start);
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') stack.pop();
  }
  // Close a string left open by truncation, dropping a dangling escape first.
  if (inStr) {
    const m = s.match(/\\+$/);
    if (m && m[0].length % 2 === 1) s = s.slice(0, -1);
    s += '"';
  }
  s = s.replace(/\s+$/, '');
  // Drop dangling separators / half-written keys at the tail.
  s = s.replace(/,\s*$/, '');
  s = s.replace(/,?\s*"[^"]*"\s*:\s*$/, '');          // "key":  with no value
  s = s.replace(/([{,])\s*"[^"]*"\s*$/, '$1');        // bare "key" awaiting colon
  s = s.replace(/,\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i--) s += stack[i];
  return s.length > 1 ? s : null;
}

/**
 * corsHeaders(res) — apply standard CORS to a Vercel response.
 */
module.exports.corsHeaders = function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-gemini-key');
};

// Exposed for tier-aware callers/tests (not part of the legacy surface).
module.exports.normalizeTier = normalizeTier;
module.exports.freeGenerationOn = freeGenerationOn;
module.exports.modelsFor = modelsFor;
module.exports.providerOrder = providerOrder;
module.exports.classifyFailure = classifyFailure;
module.exports.retryAfterSeconds = retryAfterSeconds;
/**
 * True when the only model this call could reach is the keyless floor (no
 * platform key and no workspace key of any provider). Smart Brain then makes one
 * copy call instead of three: that provider answers one request per 30 s.
 */
module.exports.keylessOnly = async function keylessOnly() {
  if (!freeGenerationOn()) return false;
  const ov = await scopedOverrides();
  const k = (ov && ov.keys) || {};
  const any = (...v) => v.some((x) => !!_clean(x));
  return !(any(k.openai, process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3)
    || any(k.anthropic, process.env.ANTHROPIC_API_KEY) || any(k.gemini, process.env.GEMINI_API_KEY)
    || any(k.grok, process.env.XAI_API_KEY) || any(k.groq, process.env.GROQ_API_KEY)
    || any(k.cerebras, process.env.CEREBRAS_API_KEY) || any(k.openrouter, process.env.OPENROUTER_API_KEY, process.env.OpenRouter_API_KEY)
    || (any(k.cloudflare, process.env.CLOUDFLARE_API_TOKEN) && !!cloudflareBase())
    || !!process.env.OLLAMA_BASE_URL || (ov && ov.bases && ov.bases.ollama)
    || (!!process.env.SAKANA_BASE_URL && any(process.env.SAKANA_API_KEY)));
};
module.exports._resetKeyless = function () { KEYLESS.next = 0; KEYLESS.chain = Promise.resolve(); };
