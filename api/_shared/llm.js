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
//   premium  : anthropic(opus)   → openai(gpt-5.5)  → gemini(3.1-pro)   → grok(4.3)      → groq → cerebras → ollama → sakana
//   standard : anthropic(sonnet) → openai(5-mini)   → gemini(3.5-flash) → grok(4.1-fast) → groq → cerebras → ollama → sakana
//   fast     : anthropic(haiku)  → openai(5-nano)   → gemini(2.5-flash, free) → groq → cerebras → ollama → sakana
//
// DEMOTION RULES (blueprint docs/quality-upgrade-blueprint.md):
//   • 429/402, 5xx, timeout, or 400 whose body matches
//     insufficient_quota|quota|billing|credit|balance → demote (next model/provider).
//   • Model-not-found (404, or 400 naming a model error) → demote WITHIN the
//     provider to its next model first, then across providers.
//   • Plain 400 without billing/model keywords = request bug → do NOT demote;
//     the cascade aborts immediately so the bad request surfaces to the caller.
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
// GitHub Models — FREE OpenAI-compatible access to GPT-4o / o-series / Llama /
// Mistral via a GitHub PAT (GITHUB_MODELS_TOKEN, or a plain GITHUB_TOKEN). Generous
// per-model daily limits, an independent rate-limit bucket. Added as a free rung.
const GITHUB_MODELS_BASE = 'https://models.inference.ai.azure.com';
// Cloudflare Workers AI — FREE daily neuron allowance, OpenAI-compatible endpoint at
// /accounts/{id}/ai/v1. Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN; skipped
// cleanly when either is absent. Same account also serves free Flux images.
const CF_ACCOUNT_ID  = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const CLOUDFLARE_BASE = CF_ACCOUNT_ID
  ? 'https://api.cloudflare.com/client/v4/accounts/' + CF_ACCOUNT_ID + '/ai/v1'
  : '';
// Optional tail rungs — only active when their env config is present.
// Ollama exposes an OpenAI-compatible API at ${OLLAMA_BASE_URL}/v1.
const OLLAMA_BASE    = (process.env.OLLAMA_BASE_URL || '').replace(/\/+$/, '') + (process.env.OLLAMA_BASE_URL ? '/v1' : '');
const SAKANA_BASE    = (process.env.SAKANA_BASE_URL || '').replace(/\/+$/, '') + (process.env.SAKANA_BASE_URL ? '/v1' : '');

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

// ── Model tables (July 2026 — all env-overridable) ───────────────────────────
function modelsFor(provider, tier) {
  const env = process.env;
  switch (provider) {
    case 'openai':
      if (tier === 'premium') return _dedupe([env.OPENAI_TEXT_MODEL_MAX || 'gpt-5.5', 'gpt-5-mini']);
      if (tier === 'fast')    return _dedupe([env.OPENAI_TEXT_MODEL_FAST || 'gpt-5-nano']);
      return _dedupe([env.OPENAI_TEXT_MODEL || 'gpt-5-mini', 'gpt-5-nano']);
    case 'anthropic':
      if (tier === 'premium') return _dedupe([env.ANTHROPIC_TEXT_MODEL_MAX || 'claude-opus-4-8', 'claude-sonnet-5']);
      if (tier === 'fast')    return _dedupe([env.ANTHROPIC_TEXT_MODEL_FAST || 'claude-haiku-4-5']);
      return _dedupe([env.ANTHROPIC_TEXT_MODEL || 'claude-sonnet-5', 'claude-haiku-4-5']);
    case 'gemini':
      if (tier === 'premium') return _dedupe([env.GEMINI_TEXT_MODEL_MAX || 'gemini-2.5-flash', 'gemini-3.5-flash']);
      if (tier === 'fast')    return _dedupe([env.GEMINI_TEXT_MODEL_FAST || 'gemini-2.5-flash']);
      return _dedupe([env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash', 'gemini-2.5-flash']);
    case 'grok':
      if (tier === 'premium') return _dedupe([env.GROK_TEXT_MODEL_MAX || 'grok-4.3', 'grok-4.1-fast']);
      return _dedupe([env.GROK_TEXT_MODEL || 'grok-4.1-fast']);
    case 'groq':
      return _dedupe([env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile']);
    case 'cerebras':
      return _dedupe([env.CEREBRAS_TEXT_MODEL || 'gpt-oss-120b', 'llama-3.3-70b']);
    case 'openrouter':
      // Defaults are slugs verified to answer on the currently-provisioned key
      // (GPT-4o / GPT-4o-mini / Gemini-2.5-flash / Llama-3.3-70b). All env-overridable
      // — to route premium through Claude once OpenRouter credits are added, set
      // OPENROUTER_TEXT_MODEL_MAX=anthropic/claude-sonnet-4.5 (etc).
      if (tier === 'premium') return _dedupe([env.OPENROUTER_TEXT_MODEL_MAX || 'openai/gpt-4o', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct']);
      if (tier === 'fast')    return _dedupe([env.OPENROUTER_TEXT_MODEL_FAST || 'openai/gpt-4o-mini', 'google/gemini-2.5-flash']);
      return _dedupe([env.OPENROUTER_TEXT_MODEL || 'openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct']);
    case 'github':
      // GitHub Models slugs. Env-overridable. Free GPT-4o family + open models.
      if (tier === 'premium') return _dedupe([env.GITHUB_TEXT_MODEL_MAX || 'gpt-4o', 'gpt-4o-mini']);
      if (tier === 'fast')    return _dedupe([env.GITHUB_TEXT_MODEL_FAST || 'gpt-4o-mini']);
      return _dedupe([env.GITHUB_TEXT_MODEL || 'gpt-4o-mini']);
    case 'cloudflare':
      // Cloudflare Workers AI model ids (the @cf/... slugs). Env-overridable.
      if (tier === 'premium') return _dedupe([env.CLOUDFLARE_TEXT_MODEL_MAX || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct']);
      if (tier === 'fast')    return _dedupe([env.CLOUDFLARE_TEXT_MODEL_FAST || '@cf/meta/llama-3.1-8b-instruct']);
      return _dedupe([env.CLOUDFLARE_TEXT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct']);
    case 'ollama':
      if (tier === 'premium') return _dedupe([env.OLLAMA_TEXT_MODEL_MAX || env.OLLAMA_TEXT_MODEL || 'llama3.3']);
      if (tier === 'fast')    return _dedupe([env.OLLAMA_TEXT_MODEL_FAST || env.OLLAMA_TEXT_MODEL || 'llama3.2']);
      return _dedupe([env.OLLAMA_TEXT_MODEL || 'llama3.3']);
    case 'sakana':
      return _dedupe([env.SAKANA_TEXT_MODEL || 'sakana-default']);
    default:
      return [];
  }
}

// Provider ORDER per tier (blueprint). Fast skips Grok (no cheap rung there).
function providerOrder(tier) {
  return tier === 'fast'
    ? ['anthropic', 'openai', 'gemini', 'groq', 'cerebras', 'github', 'cloudflare', 'openrouter', 'ollama', 'sakana']
    : ['anthropic', 'openai', 'gemini', 'grok', 'groq', 'cerebras', 'github', 'cloudflare', 'openrouter', 'ollama', 'sakana'];
}

// ── Failure classification (drives demotion) ─────────────────────────────────
//   'quota'       429/402, or 400 with billing keywords → demote
//   'model'       404, or 400 naming a model problem → within-provider demote
//   'bad_request' plain 400 → request bug — ABORT the cascade (no demotion)
//   'auth'        401/403 → this key/provider is dead, demote
//   'timeout'     network abort → next provider (don't burn time on sibling models)
//   'transient'   5xx/529/anything else → demote
function classifyFailure(status, errBody) {
  const body = String(errBody || '');
  if (status === 0) return 'timeout';
  const isBilling = /insufficient_quota|quota|billing|credit|balance/i.test(body);
  if (status === 429 || status === 402 || (status === 400 && isBilling)) return 'quota';
  const isModelErr = /model_not_found|model not found|does not exist|unknown model|invalid model|decommissioned|deprecated|no longer (?:available|supported)|not supported/i.test(body);
  if (status === 404 || (status === 400 && isModelErr)) return 'model';
  if (status === 400) return 'bad_request';
  if (status === 401 || status === 403) return 'auth';
  return 'transient';
}

/**
 * callLLM({ systemPrompt, userMessage, responseFormat, maxTokens, temperature, timeoutMs, stage, tier, preferProvider, userGeminiKey, overrides })
 *   tier: 'premium' | 'standard' (default) | 'fast'
 *         (legacy: 'maxpower'→premium, 'budget'→standard — existing callers unchanged)
 *   overrides: { order, models, keys, bases, fallback } — a workspace's own
 *         routing. Omitted by every existing caller; when omitted, the routing
 *         of the request being served is used, and failing that the default.
 * Returns { text, provider, model, seed, quota_warning?, exhausted_keys?, routing }
 * Throws on all providers failing (err._providerErrors carries per-provider detail).
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
    preferProvider = '',     // per-call provider preference — same values as APP_AI_PROVIDER; lets callers pin the provider that already worked this turn
    tier          = (process.env.APP_AI_TIER || 'standard')
  } = opts;

  const tierNorm = normalizeTier(tier);

  // An explicit override beats the ambient one (the connection check pins a
  // single provider that way); `overrides: null` explicitly asks for the
  // platform default and is honoured as written.
  const ov = (opts.overrides !== undefined) ? opts.overrides : await scopedOverrides();
  const ovKeys  = (ov && ov.keys) || {};
  const ovModels = (ov && ov.models) || {};
  const ovOrder = (ov && Array.isArray(ov.order)) ? ov.order.filter(Boolean) : [];

  // Provider preference: per-call preferProvider wins over the APP_AI_PROVIDER env.
  // Values: 'gemini', 'openai', 'anthropic', 'grok', 'groq', 'cerebras', 'gemini+', or empty (default cascade)
  //
  // A workspace order is an explicit human decision about which providers see
  // this brand's data; preferProvider is an internal latency optimisation that
  // pins whichever provider answered first this turn. The decision outranks the
  // optimisation, so the pin is dropped when a workspace order exists rather
  // than being allowed to run a provider the workspace left out.
  const preferredProvider = ovOrder.length ? '' : (preferProvider || process.env.APP_AI_PROVIDER || '').toLowerCase().trim();

  // A workspace key REPLACES the platform's for that provider — including the
  // rotation set, so a workspace never falls back onto platform OpenAI quota.
  const openaiKeys = ovKeys.openai ? [ovKeys.openai] : [
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_API_KEY_2,
    process.env.OPENAI_API_KEY_3
  ].filter(Boolean);

  // Strip BOM (U+FEFF), zero-width spaces, and whitespace — Vercel env can inject invisible chars
  const _clean = s => (s || '').replace(/[﻿​ ]/g, '').trim();
  const anthropicKey = _clean(ovKeys.anthropic) || _clean(process.env.ANTHROPIC_API_KEY);
  const geminiKey    = _clean(ovKeys.gemini) || _clean(userGeminiKey) || _clean(process.env.GEMINI_API_KEY);
  const grokKey      = _clean(ovKeys.grok) || _clean(process.env.XAI_API_KEY);
  const groqKey      = _clean(ovKeys.groq) || _clean(process.env.GROQ_API_KEY);
  const cerebrasKey  = _clean(ovKeys.cerebras) || _clean(process.env.CEREBRAS_API_KEY);
  // OpenRouter — accept the canonical name OR the existing mixed-case env var name
  // (`OpenRouter_API_KEY`) already provisioned in this project. Node env names are
  // case-sensitive, so both spellings are read explicitly.
  const openrouterKey = _clean(ovKeys.openrouter) || _clean(process.env.OPENROUTER_API_KEY) || _clean(process.env.OpenRouter_API_KEY);
  // GitHub Models — dedicated token or a plain GitHub PAT.
  const githubKey    = _clean(ovKeys.github) || _clean(process.env.GITHUB_MODELS_TOKEN) || _clean(process.env.GITHUB_TOKEN);

  // Base URLs. Cloudflare and Ollama are reached at an address that belongs to
  // the account rather than to the vendor, so for those the base is part of the
  // credential and a workspace can supply its own.
  const bases = {
    openai: OPENAI_BASE, anthropic: ANTHROPIC_BASE, gemini: GEMINI_BASE,
    grok: GROK_BASE, groq: GROQ_BASE, cerebras: CEREBRAS_BASE,
    openrouter: OPENROUTER_BASE, github: GITHUB_MODELS_BASE,
    cloudflare: CLOUDFLARE_BASE, ollama: OLLAMA_BASE, sakana: SAKANA_BASE,
  };
  if (ov && ov.bases) for (const k of Object.keys(ov.bases)) if (ov.bases[k]) bases[k] = ov.bases[k];

  // Cloudflare Workers AI — needs BOTH account id (folded into the base) and token.
  const cloudflareKey = _clean(ovKeys.cloudflare) || _clean(process.env.CLOUDFLARE_API_TOKEN);
  const cloudflareOn  = !!bases.cloudflare && !!cloudflareKey;
  // Optional tail rungs (skipped cleanly unless configured):
  //   Ollama gate = OLLAMA_BASE_URL present (auth optional).
  //   Sakana gate = both SAKANA_BASE_URL and SAKANA_API_KEY present. Forward-looking:
  //   Sakana AI has no broadly-documented public chat API today, so this rung stays
  //   inert until a base URL + key are supplied.
  const ollamaKey    = _clean(ovKeys.ollama) || _clean(process.env.OLLAMA_API_KEY) || 'ollama';
  const ollamaOn     = !!bases.ollama;
  const sakanaKey    = _clean(process.env.SAKANA_API_KEY);
  const sakanaOn     = !!bases.sakana && !!sakanaKey;
  // Debug: key PRESENCE only, never a key. The workspace flag says whose keys
  // are in play without naming the workspace or the value.
  console.log('[llm] Keys present: groq=' + !!groqKey + ' cerebras=' + !!cerebrasKey + ' gemini=' + !!geminiKey + ' tier=' + tierNorm + ' workspace_routing=' + !!ov);

  if (!openaiKeys.length && !anthropicKey && !geminiKey && !grokKey && !groqKey && !cerebrasKey && !openrouterKey && !githubKey && !cloudflareOn && !ollamaOn) {
    throw new Error('No AI provider configured. Set at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, XAI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, GITHUB_MODELS_TOKEN, CLOUDFLARE_API_TOKEN(+CLOUDFLARE_ACCOUNT_ID)');
  }

  // When a preferred provider is set, skip others to avoid wasting time on failed providers
  // Special: 'gemini+' means Gemini first, then Groq+Cerebras as backup (skip OpenAI/Anthropic/Grok)
  const isGeminiPlus = preferredProvider === 'gemini+';
  const skip = {
    openai:    isGeminiPlus ? true  : !!(preferredProvider && preferredProvider !== 'openai'),
    anthropic: isGeminiPlus ? true  : !!(preferredProvider && preferredProvider !== 'anthropic'),
    gemini:    isGeminiPlus ? false : !!(preferredProvider && preferredProvider !== 'gemini'),
    grok:      isGeminiPlus ? true  : !!(preferredProvider && preferredProvider !== 'grok'),
    groq:      isGeminiPlus ? false : !!(preferredProvider && preferredProvider !== 'groq'),
    cerebras:  isGeminiPlus ? false : !!(preferredProvider && preferredProvider !== 'cerebras'),
    openrouter: isGeminiPlus ? true : !!(preferredProvider && preferredProvider !== 'openrouter'),
    github:    isGeminiPlus ? true  : !!(preferredProvider && preferredProvider !== 'github'),
    cloudflare: isGeminiPlus ? true : !!(preferredProvider && preferredProvider !== 'cloudflare'),
    ollama:    isGeminiPlus ? true  : !!(preferredProvider && preferredProvider !== 'ollama'),
    sakana:    isGeminiPlus ? true  : !!(preferredProvider && preferredProvider !== 'sakana')
  };

  const hasKey = {
    openai:    openaiKeys.length > 0,
    anthropic: !!anthropicKey,
    gemini:    !!geminiKey,
    grok:      !!grokKey,
    groq:      !!groqKey,
    cerebras:  !!cerebrasKey,
    openrouter: !!openrouterKey,
    github:    !!githubKey,
    cloudflare: cloudflareOn,  // gated on CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
    ollama:    ollamaOn,   // gated on OLLAMA_BASE_URL (auth optional)
    sakana:    sakanaOn    // gated on SAKANA_BASE_URL + SAKANA_API_KEY
  };

  const seed             = genSeed();
  const seededUserMessage = userMessage + '\n\n<!-- gen_seed:' + seed + ' -->';

  // ── Provider helpers ────────────────────────────────────────────────────────

  async function _openai(model, key) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    console.log('[llm][' + stage + '] openai model=' + model + ' key=...' + key.slice(-4) + ' seed=' + seed);
    try {
      const r = await fetch(bases.openai + '/chat/completions', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: seededUserMessage }],
          max_tokens: maxTokens, temperature,
          ...(responseFormat ? { response_format: responseFormat } : {})
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        console.error('[llm][' + stage + '] OpenAI ' + r.status, err.substring(0, 200));
        return { ok: false, status: r.status, err };
      }
      const data = await r.json();
      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      if (!String(text).trim()) { console.warn('[llm][' + stage + '] openai EMPTY content on ' + model + ' — demoting'); return { ok: false, status: 502, err: 'empty_response' }; }
      console.log('[llm][' + stage + '] openai ok len=' + text.length);
      return { ok: true, text, provider: 'openai', model };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, err: e.message || String(e) };
    }
  }

  async function _anthropic(model) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    console.log('[llm][' + stage + '] anthropic model=' + model + ' seed=' + seed);
    // Claude has no native JSON mode — inject instruction into system prompt
    const claudeSystem = responseFormat
      ? systemPrompt + '\n\nCRITICAL: Return ONLY valid JSON. First character must be { and last must be }. No markdown fences, no commentary, no text before or after.'
      : systemPrompt;
    try {
      const r = await fetch(bases.anthropic + '/messages', {
        method: 'POST', cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        // 4.6+ Claude models reject temperature+top_p together (and some reject
        // temperature outright) — we NEVER send top_p, and only send temperature
        // on legacy claude-3* models (none in the default chains; env override only).
        body: JSON.stringify(Object.assign({
          model,
          max_tokens: maxTokens,
          system: claudeSystem,
          messages: [{ role: 'user', content: seededUserMessage }]
        }, /^claude-3/.test(model) ? { temperature } : {})),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        console.error('[llm][' + stage + '] Anthropic ' + r.status, err.substring(0, 200));
        return { ok: false, status: r.status, err };
      }
      const data = await r.json();
      const text = (data.content && data.content[0] && data.content[0].text) || '';
      if (!String(text).trim()) { console.warn('[llm][' + stage + '] anthropic EMPTY content on ' + model + ' — demoting'); return { ok: false, status: 502, err: 'empty_response' }; }
      console.log('[llm][' + stage + '] anthropic ok model=' + model + ' len=' + text.length);
      return { ok: true, text, provider: 'anthropic', model };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, err: e.message || String(e) };
    }
  }

  async function _gemini(model) {
    const ctrl = new AbortController();
    // Gemini free tier can be slower — give 30% more time than other providers
    const t = setTimeout(() => ctrl.abort(), Math.round(timeoutMs * 1.3));
    const combined = systemPrompt + '\n\n---\nUSER REQUEST:\n' + seededUserMessage;
    console.log('[llm][' + stage + '] gemini model=' + model + ' seed=' + seed);
    try {
      const r = await fetch(
        bases.gemini + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(geminiKey),
        {
          method: 'POST', cache: 'no-store',
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
          signal: ctrl.signal
        }
      );
      clearTimeout(t);
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        console.error('[llm][' + stage + '] Gemini ' + r.status + ' model=' + model, err.substring(0, 200));
        return { ok: false, status: r.status, err };
      }
      const data = await r.json();
      const text = (
        data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text
      ) || '';
      if (!String(text).trim()) { console.warn('[llm][' + stage + '] gemini EMPTY content on ' + model + ' — demoting'); return { ok: false, status: 502, err: 'empty_response' }; }
      console.log('[llm][' + stage + '] gemini ok model=' + model + ' len=' + text.length);
      return { ok: true, text, provider: 'gemini', model };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, err: e.message || String(e) };
    }
  }

  // Grok / Groq / Cerebras are OpenAI-compatible chat endpoints.
  function _openaiCompatible(providerName, base, key, extra) {
    return async function (model) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      console.log('[llm][' + stage + '] ' + providerName + ' model=' + model + ' seed=' + seed);
      try {
        const r = await fetch(base + '/chat/completions', {
          method: 'POST', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify(Object.assign({
            model,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: seededUserMessage }],
            temperature
          }, extra(model))),
          signal: ctrl.signal
        });
        clearTimeout(t);
        if (!r.ok) {
          const err = await r.text().catch(() => '');
          console.error('[llm][' + stage + '] ' + providerName + ' ' + r.status, err.substring(0, 200));
          return { ok: false, status: r.status, err };
        }
        const data = await r.json();
        const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        // Empty content (e.g. a reasoning model that spent the whole token budget on
        // its hidden reasoning field, or a JSON-mode truncation) is NOT a usable
        // answer — demote so the cascade tries the next model/provider instead of
        // returning a blank "success" that surfaces downstream as an LLM error.
        if (!String(text).trim()) { console.warn('[llm][' + stage + '] ' + providerName + ' EMPTY content on ' + model + ' — demoting'); return { ok: false, status: 502, err: 'empty_response' }; }
        console.log('[llm][' + stage + '] ' + providerName + ' ok model=' + model + ' len=' + text.length);
        return { ok: true, text, provider: providerName, model };
      } catch (e) {
        clearTimeout(t);
        return { ok: false, status: 0, err: e.message || String(e) };
      }
    };
  }

  const _grok = _openaiCompatible('grok', bases.grok, grokKey, () => ({
    max_tokens: maxTokens,
    ...(responseFormat ? { response_format: responseFormat } : {})
  }));
  const _groq = _openaiCompatible('groq', bases.groq, groqKey, () => ({
    max_tokens: maxTokens,
    ...(responseFormat ? { response_format: responseFormat } : {})
  }));
  // Cerebras: free tier caps output at 8K; no response_format support yet.
  const _cerebras = _openaiCompatible('cerebras', bases.cerebras, cerebrasKey, () => ({
    max_tokens: Math.min(maxTokens, 8192)
  }));
  // OpenRouter (OpenAI-compatible). Optional ranking headers omitted (not required).
  const _openrouter = _openaiCompatible('openrouter', bases.openrouter, openrouterKey, () => ({
    max_tokens: maxTokens,
    ...(responseFormat ? { response_format: responseFormat } : {})
  }));
  // GitHub Models (OpenAI-compatible). Free GPT-4o family via a GitHub PAT.
  const _github = _openaiCompatible('github', bases.github, githubKey, () => ({
    max_tokens: maxTokens,
    ...(responseFormat ? { response_format: responseFormat } : {})
  }));
  // Cloudflare Workers AI (OpenAI-compatible at /ai/v1). Free daily allowance.
  const _cloudflare = _openaiCompatible('cloudflare', bases.cloudflare, cloudflareKey, () => ({
    max_tokens: maxTokens,
    ...(responseFormat ? { response_format: responseFormat } : {})
  }));
  // Optional tail rungs (OpenAI-compatible). Only ever reached if configured
  // (hasKey.ollama / hasKey.sakana gate them in the cascade loop).
  const _ollama = _openaiCompatible('ollama', bases.ollama, ollamaKey, () => ({
    max_tokens: maxTokens,
    ...(responseFormat ? { response_format: responseFormat } : {})
  }));
  const _sakana = _openaiCompatible('sakana', bases.sakana, sakanaKey, () => ({
    max_tokens: maxTokens,
    ...(responseFormat ? { response_format: responseFormat } : {})
  }));

  // ── Tier-ordered cascade ────────────────────────────────────────────────────
  let openaiKeysExhausted = 0;
  const _providerErrors = []; // Track each provider's failure for diagnostics

  function _success(result) {
    return { text: result.text, provider: result.provider, model: result.model, seed,
             quota_warning: openaiKeysExhausted > 0, exhausted_keys: openaiKeysExhausted,
             // Which routing decided this call, and whether the key that paid
             // for it was the workspace's. Never the key, only the fact.
             routing: ov ? 'workspace' : 'platform',
             workspace_key: !!ovKeys[result.provider] };
  }

  function _abortBadRequest(providerName, result) {
    // Plain 400 = request bug (blueprint: do NOT demote across providers).
    _providerErrors.push({ provider: providerName, status: result.status, err: String(result.err || '').substring(0, 120) });
    const err = new Error('Bad request (HTTP 400, non-billing) from ' + providerName + ' [' + stage + '] — not demoting. ' + String(result.err || '').substring(0, 250));
    err._providerErrors = _providerErrors;
    err._badRequest = true;
    throw err;
  }

  // Runs one provider's model chain with within-provider demotion.
  // Returns the last failure result, or the success result.
  async function runChain(providerName, callFn, models) {
    let result = null;
    for (const model of models) {
      result = await callFn(model);
      if (result.ok) return result;
      const kind = classifyFailure(result.status, result.err);
      if (kind === 'bad_request') _abortBadRequest(providerName, result);
      if (kind === 'model') {
        console.warn('[llm][' + stage + '] ' + providerName + ' model-not-found on ' + model + ' — demoting within provider');
        continue;
      }
      // NOTE: no wait-and-retry on Gemini 429. In practice the free-tier 429 is a
      // DAILY-quota exhaustion (not a per-minute blip), so a 4s wait+retry never
      // recovered and just burned ~8-10s per call across the two Gemini models —
      // stacking into function timeouts when several LLM calls run in one request.
      // Demote immediately to the next model/provider instead.
      if (kind === 'quota' || kind === 'transient') {
        console.warn('[llm][' + stage + '] ' + providerName + ' ' + result.status + ' (' + kind + ') on ' + model + ' — trying next model');
        continue;
      }
      // 'auth' or 'timeout' → don't waste time on sibling models, fall to next provider
      console.warn('[llm][' + stage + '] ' + providerName + ' ' + result.status + ' (' + kind + ') — falling to next provider');
      break;
    }
    return result;
  }

  // OpenAI needs key rotation inside the model loop.
  async function runOpenai(models) {
    let result = null;
    for (const model of models) {
      let modelNotFound = false;
      for (let ki = 0; ki < openaiKeys.length; ki++) {
        result = await _openai(model, openaiKeys[ki]);
        if (result.ok) return result;
        const kind = classifyFailure(result.status, result.err);
        if (kind === 'bad_request') _abortBadRequest('openai', result);
        if (kind === 'quota') {
          openaiKeysExhausted++;
          console.warn('[llm][' + stage + '] OpenAI key #' + (ki + 1) + ' quota exhausted — rotating');
          continue; // next key, same model
        }
        if (kind === 'auth') {
          console.warn('[llm][' + stage + '] OpenAI key #' + (ki + 1) + ' auth failure — rotating');
          continue; // next key, same model
        }
        if (kind === 'model') { modelNotFound = true; break; } // demote within-provider
        // timeout / transient → next provider
        console.warn('[llm][' + stage + '] OpenAI ' + result.status + ' (' + kind + ') — falling to next provider');
        return result;
      }
      if (modelNotFound) {
        console.warn('[llm][' + stage + '] OpenAI model-not-found on ' + model + ' — demoting within provider');
        continue;
      }
      break; // all keys quota/auth-exhausted for this model — no point trying siblings
    }
    return result;
  }

  // The cascade order. A workspace order comes FIRST and in full; the tier's
  // default providers are appended after it only when the workspace allowed the
  // platform to finish the job (`fallback`). A workspace that turned fallback
  // off has said its brand's prompts go to the providers it named and nowhere
  // else, so the cascade ends there even if that means failing.
  let order;
  if (ovOrder.length) {
    order = ovOrder.filter((p) => hasKey[p] !== undefined);
    if (ov.fallback !== false) {
      for (const p of providerOrder(tierNorm)) if (order.indexOf(p) < 0) order.push(p);
    }
  } else {
    order = providerOrder(tierNorm);
    // Honor an explicit preferProvider even if the tier's default order omits it (e.g. grok on 'fast').
    if (preferredProvider && !isGeminiPlus && hasKey[preferredProvider] !== undefined && order.indexOf(preferredProvider) < 0) {
      order.push(preferredProvider);
    }
  }

  for (const providerName of order) {
    if (skip[providerName] || !hasKey[providerName]) continue;
    console.warn('[llm][' + stage + '] Trying ' + providerName + ' (tier=' + tierNorm + ')');
    // A workspace's model chain replaces the tier chain for that provider. It
    // may name a model this platform does not ship, which is deliberate: the
    // account paying for the call knows what it can reach, and llm.js already
    // demotes within a provider on a model-not-found.
    const chosen = ovModels[providerName];
    const models = (Array.isArray(chosen) && chosen.length) ? chosen : modelsFor(providerName, tierNorm);
    let result;
    if (providerName === 'openai') {
      result = await runOpenai(models);
    } else {
      const fn = providerName === 'anthropic' ? _anthropic
        : providerName === 'gemini' ? _gemini
        : providerName === 'grok' ? _grok
        : providerName === 'groq' ? _groq
        : providerName === 'cerebras' ? _cerebras
        : providerName === 'openrouter' ? _openrouter
        : providerName === 'github' ? _github
        : providerName === 'cloudflare' ? _cloudflare
        : providerName === 'ollama' ? _ollama
        : _sakana;
      result = await runChain(providerName, fn, models);
    }
    if (result && result.ok) return _success(result);
    if (result) {
      _providerErrors.push({ provider: providerName, status: result.status, err: String(result.err || '').substring(0, 120) });
    }
  }

  // === All providers exhausted — build detailed diagnostic ===
  const _failLog = _providerErrors.map(function (e) { return e.provider + ':' + e.status; }).join(' → ');
  const _fullLog = _providerErrors.map(function (e) { return e.provider + '(' + e.status + '): ' + e.err; }).join(' | ');
  console.error('[llm][' + stage + '] ALL PROVIDERS FAILED: ' + _fullLog);
  const last = _providerErrors[_providerErrors.length - 1];
  const errMsg = last ? String(last.err || '').substring(0, 250) : 'All providers exhausted';
  const err = new Error(
    'All providers failed [' + stage + '] cascade=' + (_failLog || 'none-attempted') + ' | last=' + errMsg
  );
  err._providerErrors = _providerErrors;
  throw err;
};

/**
 * parseJSON(text) — multi-strategy JSON extractor.
 * Handles: clean JSON, markdown fences, prose prefix/suffix, nested fences.
 */
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
module.exports.modelsFor = modelsFor;
module.exports.providerOrder = providerOrder;
