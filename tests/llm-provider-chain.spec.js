// @ts-check
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// The provider chain against what production's runtime logs showed (2026-10-13).
//
// /api/brain and /api/calendar answered "ALL PROVIDERS FAILED" 92 times. The
// causes, each from the logs, each with the provider's own page that states
// the fact the fix rests on:
//   - Groq `llama-3.3-70b-versatile` 404: shut down 2026-08-16
//     (console.groq.com/docs/deprecations); `openai/gpt-oss-120b` and
//     `openai/gpt-oss-20b` are production models (console.groq.com/docs/models).
//   - Groq's daily token cap (429 "tokens per day (TPD)") was sent again on
//     every request, all day.
//   - Cloudflare `@cf/meta/llama-3.1-8b-instruct` 410: deprecated 2026-05-30;
//     the `-fast` variants stay active (developers.cloudflare.com changelog,
//     2026-05-08 "Planned model deprecations").
//   - GitHub Models timed out on every call: retired 2026-07-30
//     (docs.github.com/en/github-models).
//   - Gemini free-tier 429 (245) and OpenRouter 402 out of credits (215) were
//     sent again on every request: a key that has said "no money" or "no daily
//     quota left" is asked again only after a cool-down.
//   - Other stale defaults found while reading the chain: Cerebras
//     `llama-3.3-70b` (deprecated, inference-docs.cerebras.ai/support/deprecation),
//     Gemini `gemini-3.5-flash` (deprecated, ai.google.dev model page),
//     `grok-4.1-fast` (not an xAI slug; `grok-4.3` is, docs.x.ai), Claude
//     `claude-opus-4-8` / `claude-sonnet-5` / `claude-haiku-4-5` (the current
//     models are `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`).
//
// EXECUTED: the shipped api/_shared/llm.js over a fake network that answers each
// provider host in its own shape and throws on any other host. Nothing reads
// source text.
// ─────────────────────────────────────────────────────────────────────────────

const { test, expect } = require('@playwright/test');
const path = require('path');

const LLM_PATH = require.resolve(path.join(__dirname, '..', 'api', '_shared', 'llm.js'));
const llm = () => require(LLM_PATH);

const HOSTS = {
  'api.anthropic.com': 'anthropic', 'api.openai.com': 'openai', 'generativelanguage.googleapis.com': 'gemini',
  'api.x.ai': 'grok', 'api.groq.com': 'groq', 'api.cerebras.ai': 'cerebras', 'openrouter.ai': 'openrouter',
  'models.inference.ai.azure.com': 'github', 'models.github.ai': 'github', 'api.cloudflare.com': 'cloudflare',
};

function okBody(provider, said) {
  if (provider === 'anthropic') return { content: [{ type: 'text', text: said }], stop_reason: 'end_turn' };
  if (provider === 'gemini') return { candidates: [{ content: { parts: [{ text: said }] } }] };
  return { choices: [{ message: { content: said }, finish_reason: 'stop' }] };
}

function installNet(script) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const provider = HOSTS[u.host];
    if (!provider) throw new Error('unrouted host in a provider-chain test: ' + u.host);
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch (_) { body = {}; }
    const h = init.headers || {};
    const key = (h.Authorization || '').replace(/^Bearer\s+/, '') || h['x-api-key'] || u.searchParams.get('key') || '';
    let model = body.model || '';
    if (provider === 'gemini') { const m = u.pathname.match(/models\/([^:/]+):/); model = m ? decodeURIComponent(m[1]) : ''; }
    const call = { provider, model, key, body };
    calls.push(call);
    const spec = script(call) || { status: 200, json: okBody(provider, 'answer from ' + provider + '/' + model) };
    if (spec.hang) {
      return new Promise((_, rej) => { if (init.signal) init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
    }
    const status = spec.status || 200;
    const payload = spec.raw !== undefined ? spec.raw : JSON.stringify(spec.json || {});
    const hdrs = new Map(Object.entries(spec.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return { ok: status >= 200 && status < 300, status, headers: { get: (k) => hdrs.get(String(k).toLowerCase()) || null }, text: async () => payload };
  };
  return { calls, restore() { global.fetch = real; } };
}

const ENV = ['OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY',
  'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'OpenRouter_API_KEY', 'GITHUB_MODELS_TOKEN', 'GITHUB_TOKEN', 'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL', 'SAKANA_BASE_URL', 'SAKANA_API_KEY', 'APP_AI_PROVIDER', 'APP_AI_TIER', 'LLM_TOTAL_BUDGET_MS',
  'OPENROUTER_MAX_TOKENS', 'GROQ_TEXT_MODEL', 'GEMINI_TEXT_MODEL', 'ANTHROPIC_TEXT_MODEL', 'OPENAI_TEXT_MODEL', 'CEREBRAS_TEXT_MODEL',
  'CLOUDFLARE_TEXT_MODEL', 'CLOUDFLARE_TEXT_MODEL_FAST', 'CLOUDFLARE_TEXT_MODEL_MAX', 'GROK_TEXT_MODEL', 'GROK_TEXT_MODEL_MAX',
  'GEMINI_TEXT_MODEL_MAX', 'GEMINI_TEXT_MODEL_FAST', 'ANTHROPIC_TEXT_MODEL_MAX', 'ANTHROPIC_TEXT_MODEL_FAST', 'OPENAI_TEXT_MODEL_MAX', 'OPENAI_TEXT_MODEL_FAST'];
let saved = {};
let net = null;
let realNow = Date.now;
test.beforeEach(() => {
  saved = {};
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  llm().resetProviderCooldowns();
});
test.afterEach(() => {
  if (net) { net.restore(); net = null; }
  Date.now = realNow;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  llm().resetProviderCooldowns();
});
const setEnv = (m) => { for (const [k, v] of Object.entries(m)) process.env[k] = v; };
const ask = (o) => llm()(Object.assign({ systemPrompt: 'sys', userMessage: 'hi', stage: 'chain-test', overrides: null, tier: 'standard', timeoutMs: 400 }, o || {}));

/* ── 1. no retired or invented model id in any default chain ──────────────── */

const RETIRED = [
  'llama-3.3-70b-versatile', 'llama-3.1-8b-instant',              // Groq, shut down 2026-08-16
  '@cf/meta/llama-3.1-8b-instruct',                              // Cloudflare, deprecated 2026-05-30
  'llama-3.3-70b',                                               // Cerebras, deprecated
  'gemini-3.5-flash',                                            // Gemini, deprecated (routed to 3.6)
  'grok-4.1-fast', 'grok-4-1-fast-non-reasoning',                // not a slug / retired 2026-05-15
  'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5',      // superseded by the 5.5 family
];

test('no default chain names a retired, deprecated or invented model id', () => {
  const { modelsFor, providerOrder } = llm();
  for (const tier of ['premium', 'standard', 'fast']) {
    for (const p of providerOrder(tier)) {
      const chain = modelsFor(p, tier);
      for (const m of chain) expect(RETIRED, `${p}/${tier} default chain names ${m}`).not.toContain(m);
    }
  }
  expect(llm().modelsFor('groq', 'standard')).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  expect(llm().modelsFor('cloudflare', 'fast')).toEqual(['@cf/meta/llama-3.1-8b-instruct-fast']);
  expect(llm().modelsFor('anthropic', 'standard')).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
});

test('GitHub Models (retired 2026-07-30) is never in the order and never called, even with a token set', async () => {
  for (const tier of ['premium', 'standard', 'fast']) expect(llm().providerOrder(tier)).not.toContain('github');
  setEnv({ GITHUB_TOKEN: 'ghp-x', GITHUB_MODELS_TOKEN: 'ghm-x', GROQ_API_KEY: 'gq' });
  net = installNet(() => undefined);
  const out = await ask();
  expect(out.provider).toBe('groq');
  expect(net.calls.some((c) => c.provider === 'github')).toBe(false);
  // A GitHub token alone is not a configured AI provider.
  delete process.env.GROQ_API_KEY;
  const err = await ask().catch((e) => e);
  expect(err.message).toMatch(/No AI provider configured/);
  expect(err.message).not.toMatch(/GITHUB/);
});

/* ── 2. the paid, reliable provider is first ──────────────────────────────── */

test('with every key set the order is the paid providers first, then the free ones, OpenRouter as the paid backstop', async () => {
  setEnv({ ANTHROPIC_API_KEY: 'ak', OPENAI_API_KEY: 'sk', GEMINI_API_KEY: 'g', XAI_API_KEY: 'x', GROQ_API_KEY: 'gq',
    CEREBRAS_API_KEY: 'cb', CLOUDFLARE_API_TOKEN: 'cf', CLOUDFLARE_ACCOUNT_ID: 'acc', OPENROUTER_API_KEY: 'or' });
  net = installNet(() => ({ status: 503, raw: 'down' }));
  const err = await ask().catch((e) => e);
  const seen = [...new Set(net.calls.map((c) => c.provider))];
  expect(seen).toEqual(['anthropic', 'openai', 'gemini', 'grok', 'groq', 'cerebras', 'cloudflare', 'openrouter']);
  expect(err.message).toMatch(/All providers failed/);
});

/* ── 3. a key that said "no money" or "no quota today" is not asked again ─── */

test('OpenRouter 402 (out of credits) falls through cleanly and is not sent again until the cool-down ends', async () => {
  setEnv({ OPENROUTER_API_KEY: 'or-1', GROQ_API_KEY: 'gq' });
  process.env.APP_AI_PROVIDER = 'openrouter';
  net = installNet((c) => (c.provider === 'openrouter'
    ? { status: 402, raw: '{"error":{"code":402,"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits"}}' }
    : undefined));
  const first = await ask();
  expect(first.provider).toBe('groq');
  expect(net.calls.filter((c) => c.provider === 'openrouter').length).toBe(1);   // one call, not one per model
  expect(first.attempts[0].kind).toBe('billing');

  const second = await ask();
  expect(second.provider).toBe('groq');
  expect(net.calls.filter((c) => c.provider === 'openrouter').length).toBe(1);   // cooling down: not called
  // After the cool-down it is asked again.
  const t = realNow();
  Date.now = () => t + 11 * 60 * 1000;
  await ask();
  expect(net.calls.filter((c) => c.provider === 'openrouter').length).toBe(2);
});

test('a cooling-down provider is named in the final error, with when it is asked again', async () => {
  setEnv({ OPENROUTER_API_KEY: 'or-1' });
  net = installNet(() => ({ status: 402, raw: '{"error":{"message":"Insufficient credits"}}' }));
  await ask().catch(() => null);
  const err = await ask().catch((e) => e);
  expect(err.message).toMatch(/openrouter: cooling down after quota \/ billing exhausted/);
  expect(err._skipped.find((s) => s.provider === 'openrouter').until).toBeTruthy();
});

test('Groq daily token cap (429 TPD) cools down THAT model; the next model is tried now and first next time', async () => {
  setEnv({ GROQ_API_KEY: 'gq' });
  const tpd = '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199990, Requested 900. Please try again in 6m28.8s.","type":"tokens","code":"rate_limit_exceeded"}}';
  net = installNet((c) => (c.model === 'openai/gpt-oss-120b' ? { status: 429, raw: tpd } : undefined));
  const first = await ask();
  expect(first.model).toBe('openai/gpt-oss-20b');
  const second = await ask();
  expect(second.model).toBe('openai/gpt-oss-20b');
  expect(net.calls.filter((c) => c.model === 'openai/gpt-oss-120b').length).toBe(1);
});

test('a per-minute rate limit is NOT cooled down: the next request tries that model again', async () => {
  setEnv({ GROQ_API_KEY: 'gq' });
  let n = 0;
  net = installNet((c) => (c.model === 'openai/gpt-oss-120b' && n++ === 0
    ? { status: 429, raw: '{"error":{"message":"Rate limit reached on requests per minute (RPM)"}}' } : undefined));
  await ask();
  const second = await ask();
  expect(second.model).toBe('openai/gpt-oss-120b');
});

test('Gemini free-tier quota (429 RESOURCE_EXHAUSTED, a daily request cap) cools the key down', async () => {
  setEnv({ GEMINI_API_KEY: 'g-1', GROQ_API_KEY: 'gq' });
  const body = '{"error":{"code":429,"message":"You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash","status":"RESOURCE_EXHAUSTED"}}';
  net = installNet((c) => (c.provider === 'gemini' ? { status: 429, raw: body } : undefined));
  const first = await ask();
  expect(first.provider).toBe('groq');
  await ask();
  expect(net.calls.filter((c) => c.provider === 'gemini').length).toBe(1);
});

test('a rejected key (401) is cooled down too, so a bad key is not re-sent on every request', async () => {
  setEnv({ ANTHROPIC_API_KEY: 'bad', GROQ_API_KEY: 'gq' });
  net = installNet((c) => (c.provider === 'anthropic' ? { status: 401, raw: '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}' } : undefined));
  await ask();
  await ask();
  expect(net.calls.filter((c) => c.provider === 'anthropic').length).toBe(1);
});

test('a cool-down belongs to ONE key: a workspace key out of credits never stops the platform key, and the reverse', async () => {
  setEnv({ OPENROUTER_API_KEY: 'platform-or', GROQ_API_KEY: 'gq' });
  net = installNet((c) => (c.provider === 'openrouter' && c.key === 'workspace-or'
    ? { status: 402, raw: '{"error":{"message":"Insufficient credits"}}' } : undefined));
  const ws = { order: ['openrouter'], keys: { openrouter: 'workspace-or' }, fallback: true };
  const a = await ask({ overrides: ws });
  expect(a.provider).not.toBe('openrouter');
  const b = await ask({ preferProvider: 'openrouter' });
  expect(b.provider).toBe('openrouter');
  expect(net.calls.filter((c) => c.key === 'platform-or').length).toBe(1);
  // The cool-down state holds no key, only a one-way fingerprint.
  const state = JSON.stringify(llm().providerCooldowns());
  expect(state).not.toContain('workspace-or');
  expect(state).not.toContain('platform-or');
});

/* ── 4. a low-credit provider is asked for less ──────────────────────────── */

test('OpenRouter is asked for at most OPENROUTER_MAX_TOKENS (default 2048), other providers for what the caller asked', async () => {
  setEnv({ OPENROUTER_API_KEY: 'or', GROQ_API_KEY: 'gq' });
  process.env.APP_AI_PROVIDER = 'openrouter';
  net = installNet(() => undefined);
  await ask({ maxTokens: 8000 });
  expect(net.calls[0].body.max_tokens).toBe(2048);
  process.env.OPENROUTER_MAX_TOKENS = '700';
  await ask({ maxTokens: 8000 });
  expect(net.calls[1].body.max_tokens).toBe(700);
  await ask({ maxTokens: 500 });
  expect(net.calls[2].body.max_tokens).toBe(500);
  delete process.env.APP_AI_PROVIDER;
  process.env.OPENROUTER_API_KEY = '';
  await ask({ maxTokens: 8000 });
  expect(net.calls[3].provider).toBe('groq');
  expect(net.calls[3].body.max_tokens).toBe(8000);
});

/* ── 5. a provider that hangs costs one timeout per request ──────────────── */

test('a hanging provider costs one attempt and the next provider answers inside the budget', async () => {
  setEnv({ ANTHROPIC_API_KEY: 'ak', GROQ_API_KEY: 'gq' });
  net = installNet((c) => (c.provider === 'anthropic' ? { hang: true } : undefined));
  const t0 = realNow();
  const out = await ask({ timeoutMs: 300 });
  expect(out.provider).toBe('groq');
  expect(realNow() - t0).toBeLessThan(1500);
  expect(net.calls.filter((c) => c.provider === 'anthropic').length).toBe(1);
});
