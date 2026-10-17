// @ts-check
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// The model fallback cascade, EXECUTED (2026-10-11).
//
// The operator: "ensure that the ai model logic to use one after the other as
// backup model if higher priority model not available is correctly
// implemented". Every test here runs the SHIPPED module (api/_shared/llm.js,
// api/ai/image.js with its credit + request-scope wrappers, video-core.js)
// against a fake of each provider's HTTP API: `global.fetch` is replaced by a
// router that answers each provider host the way that provider answers, and
// THROWS on any other host, so nothing reaches a real network. Nothing reads
// source text.
//
// What running it found (each restored, each fails a test below):
//   1. A plain HTTP 400 ABORTED the whole cascade. Gemini answers an invalid
//      key with 400 API_KEY_INVALID, so one bad key failed every generation
//      while the other providers were up; so did any provider that rejected
//      one parameter of the body THIS module built for it.
//   2. The per-attempt timer was cleared when the status line arrived, so a
//      provider that sent 200 and then stalled held the call forever.
//   3. `preferProvider` SKIPPED every other provider: a pinned provider that
//      stumbled once left the call with no fallback at all.
//   4. A workspace that switched the platform fallback OFF but named no order
//      had its prompts run through the platform's whole cascade on the
//      platform's keys.
//   5. OpenAI keys were neither cleaned nor de-duplicated (the same key set
//      twice was sent twice after being refused), and a key that had answered
//      401/quota was sent again for the next model.
//   6. A billing failure (key-level) was retried on the sibling model with the
//      same dead key; a workspace model list / order with a repeat ran twice.
//   7. Anthropic's answer was read from content[0] only, so a response that
//      opens with a thinking block read as "empty" and was thrown away.
//   8. No total budget: N providers × M models × timeoutMs could run past the
//      serverless limit.
//   9. "All providers failed" named statuses only, not WHY, and never the
//      providers that were not tried.
//  10. The image route answered total failure with ok:true and the brand
//      PLACEHOLDER as `image_data_url` - the Mailer Studio put it in the email
//      as the "generated hero photo", and the in-process creative generators
//      shipped it instead of falling back to the brand's real catalogue photo.
//  11. The image route sent a rejected Gemini key again to every Gemini model
//      and to Imagen; it returned an HTML error page answered 200 as an image.
//  12. A video job "completed" with no video URL was returned as the success.
// ─────────────────────────────────────────────────────────────────────────────

const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LLM_PATH = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));

/* ── the fake providers ──────────────────────────────────────────────────── */

const HOSTS = {
  'api.anthropic.com': 'anthropic', 'api.openai.com': 'openai', 'generativelanguage.googleapis.com': 'gemini',
  'api.x.ai': 'grok', 'api.groq.com': 'groq', 'api.cerebras.ai': 'cerebras', 'openrouter.ai': 'openrouter',
  'models.inference.ai.azure.com': 'github', 'image.pollinations.ai': 'pollinations', 'api.cloudflare.com': 'cloudflare',
  'cloud.higgsfield.ai': 'higgsfield', 'api.dev.runwayml.com': 'runway',
};

/** A provider's success body, in its own shape. */
function okBody(provider, said) {
  if (provider === 'anthropic') return { content: [{ type: 'text', text: said }], stop_reason: 'end_turn' };
  if (provider === 'gemini') return { candidates: [{ content: { parts: [{ text: said }] } }] };
  return { choices: [{ message: { content: said }, finish_reason: 'stop' }] };
}

/** A fetch Response stand-in that honours the request's AbortSignal for the body too. */
function respond(spec, signal) {
  const status = spec.status || 200;
  const hdrs = new Map(Object.entries(spec.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const payload = spec.raw !== undefined ? spec.raw : JSON.stringify(spec.json || {});
  const waitAbort = () => new Promise((_, rej) => {
    if (signal && signal.aborted) return rej(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
    if (signal) signal.addEventListener('abort', () => rej(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
  });
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => (hdrs.has(String(k).toLowerCase()) ? hdrs.get(String(k).toLowerCase()) : null) },
    text: async () => (spec.bodyHang ? waitAbort() : (typeof payload === 'string' ? payload : String(payload))),
    json: async () => (spec.bodyHang ? waitAbort() : JSON.parse(payload)),
    arrayBuffer: async () => (spec.bodyHang ? waitAbort() : (spec.bytes || Buffer.from(String(payload))).buffer),
  };
}

/**
 * Install a fake network. `script(call)` answers each provider call with a
 * spec ({status, json, raw, headers, hang, bodyHang, throws}) or undefined for
 * the provider's own success. Every call is recorded with provider/model/key.
 */
function installNet(script) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const provider = HOSTS[u.host];
    if (!provider) throw new Error('unrouted host in a fallback test: ' + u.host);
    let parsed = {};
    try { parsed = init.body ? JSON.parse(init.body) : {}; } catch (_) { parsed = {}; }
    const h = init.headers || {};
    const key = (h.Authorization || h.authorization || '').replace(/^Bearer\s+/, '') || h['x-api-key'] || h['x-goog-api-key'] || u.searchParams.get('key') || '';
    let model = parsed.model || '';
    if (provider === 'gemini') { const m = u.pathname.match(/models\/([^:/]+):/); model = m ? decodeURIComponent(m[1]) : ''; }
    if (provider === 'pollinations') model = u.searchParams.get('model') || '';
    const call = { provider, model, key, url: String(url), n: calls.filter((c) => c.provider === provider).length };
    calls.push(call);
    const spec = script(call) || { status: 200, json: okBody(provider, 'answer from ' + provider + '/' + model) };
    if (spec.throws) throw Object.assign(new TypeError('fetch failed'), { cause: { code: spec.throws } });
    if (spec.hang) {
      return new Promise((_, rej) => {
        const s = init.signal;
        if (s) s.addEventListener('abort', () => rej(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
      });
    }
    return respond(spec, init.signal);
  };
  return { calls, restore() { global.fetch = real; } };
}

const PROVIDER_ENV = ['OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY',
  'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'OpenRouter_API_KEY', 'GITHUB_MODELS_TOKEN', 'GITHUB_TOKEN',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL', 'SAKANA_BASE_URL', 'SAKANA_API_KEY', 'APP_AI_PROVIDER', 'APP_AI_TIER',
  'OPENAI_TEXT_MODEL', 'OPENAI_TEXT_MODEL_MAX', 'OPENAI_TEXT_MODEL_FAST', 'ANTHROPIC_TEXT_MODEL', 'GEMINI_TEXT_MODEL', 'GROQ_TEXT_MODEL',
  'LLM_TOTAL_BUDGET_MS', 'IMAGE_TOTAL_BUDGET_MS', 'VIDEO_TOTAL_BUDGET_MS', 'OPENAI_IMAGE_MODEL', 'HIGGSFIELD_API_KEY', 'RUNWAY_API_KEY',
  'OPENMONTAGE_API_KEY', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY',
  'DATABASE_URL', 'CRON_SECRET'];

let savedEnv = null;
let net = null;
test.beforeEach(() => {
  savedEnv = {};
  for (const k of PROVIDER_ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  // A billing / auth answer cools that key down for later requests in this
  // process; each case here starts from a cascade that has seen nothing.
  require(LLM_PATH).resetProviderCooldowns();
});
test.afterEach(() => {
  if (net) { net.restore(); net = null; }
  for (const k of PROVIDER_ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  require(LLM_PATH).resetProviderCooldowns();
});

function keys(map) { for (const [k, v] of Object.entries(map)) process.env[k] = v; }
const callLLM = () => require(LLM_PATH);
const ask = (o) => callLLM()(Object.assign({ systemPrompt: 'sys', userMessage: 'hi', stage: 'fallback-test', overrides: null, tier: 'standard' }, o || {}));

/* ── 1. every failure class, at every position ───────────────────────────── */

// Each class: the spec a provider answers with, the class llm.js must name,
// and how many calls the failing provider may receive (1 = key/host-level:
// its sibling models must NOT be tried with the same dead key / host).
const CLASSES = {
  'HTTP 401 bad key': { spec: () => ({ status: 401, raw: '{"error":{"message":"Incorrect API key provided"}}' }), kind: 'auth', calls: 1 },
  'HTTP 403 forbidden': { spec: () => ({ status: 403, raw: '{"error":{"message":"permission denied for this project"}}' }), kind: 'auth', calls: 1 },
  'HTTP 400 API_KEY_INVALID (Gemini style)': { spec: () => ({ status: 400, raw: '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}' }), kind: 'auth', calls: 1 },
  'HTTP 429 rate limit with Retry-After': { spec: () => ({ status: 429, headers: { 'retry-after': '7' }, raw: '{"error":{"message":"Rate limit reached for requests per min"}}' }), kind: 'rate_limit' },
  'HTTP 429 insufficient_quota': { spec: () => ({ status: 429, raw: '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}' }), kind: 'billing', calls: 1 },
  'HTTP 400 billing_hard_limit_reached': { spec: () => ({ status: 400, raw: '{"error":{"code":"billing_hard_limit_reached","message":"Billing hard limit has been reached"}}' }), kind: 'billing', calls: 1 },
  'HTTP 400 credit balance too low': { spec: () => ({ status: 400, raw: '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the API."}}' }), kind: 'billing', calls: 1 },
  'HTTP 404 model not found': { spec: () => ({ status: 404, raw: '{"error":{"code":"model_not_found","message":"The model does not exist"}}' }), kind: 'model', calls: 2 },
  'HTTP 400 model deprecated': { spec: () => ({ status: 400, raw: '{"error":{"message":"The model has been deprecated and is no longer available"}}' }), kind: 'model', calls: 2 },
  'HTTP 500': { spec: () => ({ status: 500, raw: 'internal error' }), kind: 'transient', calls: 2 },
  'HTTP 503 overloaded': { spec: () => ({ status: 503, raw: '{"error":{"message":"overloaded"}}' }), kind: 'transient', calls: 2 },
  'HTTP 400 plain bad request': { spec: () => ({ status: 400, raw: '{"error":{"message":"Unsupported parameter: temperature"}}' }), kind: 'bad_request', calls: 1 },
  'network / DNS failure': { spec: () => ({ throws: 'ENOTFOUND' }), kind: 'timeout', calls: 1 },
  'timeout (no answer)': { spec: () => ({ hang: true }), kind: 'timeout', calls: 1 },
  'timeout (200 then the body stalls)': { spec: () => ({ status: 200, bodyHang: true }), kind: 'timeout', calls: 1 },
  '200 with an unparseable body': { spec: () => ({ status: 200, raw: '<html>gateway</html>' }), kind: 'empty', calls: 2 },
  '200 with no text': { spec: (c) => ({ status: 200, json: okBody(c.provider, '') }), kind: 'empty', calls: 2 },
  '200 refusal only': {
    spec: (c) => ({
      status: 200,
      json: c.provider === 'anthropic' ? { content: [], stop_reason: 'refusal' }
        : c.provider === 'gemini' ? { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }
          : { choices: [{ message: { content: null, refusal: 'I cannot help with that.' }, finish_reason: 'stop' }] },
    }),
    kind: 'empty', calls: 2,
  },
};

const ORDER = ['anthropic', 'openai', 'gemini', 'groq'];
const KEYS = { ANTHROPIC_API_KEY: 'ak-1', OPENAI_API_KEY: 'sk-1', GEMINI_API_KEY: 'g-1', GROQ_API_KEY: 'gq-1' };

for (const [name, cls] of Object.entries(CLASSES)) {
  for (const failing of ['anthropic', 'openai', 'gemini']) {
    test(`${name} at ${failing} (position ${ORDER.indexOf(failing)}) moves on to the next provider`, async () => {
      keys(KEYS);
      const pos = ORDER.indexOf(failing);
      net = installNet((c) => {
        const at = ORDER.indexOf(c.provider);
        if (at < pos) return { status: 503, raw: 'earlier provider down' };
        if (at === pos) return cls.spec(c);
        return undefined;
      });
      const t0 = Date.now();
      const out = await ask({ timeoutMs: 400 });
      const expected = ORDER[pos + 1];
      expect(out.provider, `answered by ${out.provider}, attempts ${JSON.stringify(out.attempts)}`).toBe(expected);
      expect(out.text).toContain('answer from ' + expected);
      expect(out.fell_back).toBe(true);
      // The failing provider was tried, named with the right class, and never
      // looped on: key- and host-level failures exactly once.
      const mine = out.attempts.filter((a) => a.provider === failing);
      expect(mine.length).toBeGreaterThan(0);
      expect(new Set(mine.map((a) => a.kind))).toEqual(new Set([cls.kind]));
      const sent = net.calls.filter((c) => c.provider === failing).length;
      if (cls.calls) expect(sent, `${failing} called ${sent} times`).toBe(failing === 'openai' && cls.kind === 'rate_limit' ? 1 : cls.calls);
      else expect(sent).toBeLessThanOrEqual(2);
      if (cls.kind === 'rate_limit') expect(mine[0].retry_after_s).toBe(7);
      // Nothing after the answering provider was called.
      expect(net.calls.some((c) => ORDER.indexOf(c.provider) > pos + 1)).toBe(false);
      expect(Date.now() - t0).toBeLessThan(5000);
    });
  }
}

test('a provider with no key configured is never called and the next one answers', async () => {
  keys({ OPENAI_API_KEY: 'sk-1', GEMINI_API_KEY: 'g-1' });
  net = installNet(() => undefined);
  const out = await ask();
  expect(out.provider).toBe('openai');
  expect(net.calls.some((c) => c.provider === 'anthropic')).toBe(false);
  expect(out.attempts).toEqual([]);
});

test('an Anthropic answer that opens with a thinking block is the answer, not "empty"', async () => {
  keys({ ANTHROPIC_API_KEY: 'ak-1', OPENAI_API_KEY: 'sk-1' });
  net = installNet((c) => (c.provider === 'anthropic'
    ? { status: 200, json: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'the real answer' }], stop_reason: 'end_turn' } }
    : undefined));
  const out = await ask();
  expect(out.provider).toBe('anthropic');
  expect(out.text).toBe('the real answer');
  expect(net.calls.some((c) => c.provider === 'openai')).toBe(false);
});

/* ── 2. key rotation ─────────────────────────────────────────────────────── */

test('OpenAI keys rotate on key-specific failures, and the answer names the key that worked', async () => {
  keys({ OPENAI_API_KEY: 'sk-a', OPENAI_API_KEY_2: 'sk-b', OPENAI_API_KEY_3: 'sk-c' });
  net = installNet((c) => (c.key === 'sk-a' ? CLASSES['HTTP 401 bad key'].spec()
    : c.key === 'sk-b' ? CLASSES['HTTP 429 insufficient_quota'].spec() : undefined));
  const out = await ask();
  expect(out.provider).toBe('openai');
  expect(net.calls.map((c) => c.key)).toEqual(['sk-a', 'sk-b', 'sk-c']);
  expect(out.attempts.map((a) => [a.key_index, a.kind])).toEqual([[1, 'auth'], [2, 'billing']]);
  expect(out.exhausted_keys).toBe(1);
});

test('a dead OpenAI key is never sent again for the next model; a model error does not rotate keys', async () => {
  keys({ OPENAI_API_KEY: 'sk-a', OPENAI_API_KEY_2: 'sk-b', OPENAI_API_KEY_3: 'sk-c' });
  // Model 1: key a rejected, key b out of quota, key c says the model is gone.
  // Model 2: only key c may be tried.
  net = installNet((c) => {
    if (c.key === 'sk-a') return CLASSES['HTTP 401 bad key'].spec();
    if (c.key === 'sk-b') return CLASSES['HTTP 400 billing_hard_limit_reached'].spec();
    if (c.model === 'gpt-5-mini') return CLASSES['HTTP 404 model not found'].spec();
    return undefined;
  });
  const out = await ask();
  expect(out.provider).toBe('openai');
  expect(out.model).toBe('gpt-5-nano');
  expect(net.calls.map((c) => c.model + '/' + c.key)).toEqual(['gpt-5-mini/sk-a', 'gpt-5-mini/sk-b', 'gpt-5-mini/sk-c', 'gpt-5-nano/sk-c']);
});

test('a model-specific failure moves to the next model with the SAME key, never trying another key first', async () => {
  keys({ OPENAI_API_KEY: 'sk-a', OPENAI_API_KEY_2: 'sk-b' });
  net = installNet((c) => (c.model === 'gpt-5-mini' ? CLASSES['HTTP 404 model not found'].spec() : undefined));
  const out = await ask();
  expect(out.model).toBe('gpt-5-nano');
  expect(net.calls.map((c) => c.model + '/' + c.key)).toEqual(['gpt-5-mini/sk-a', 'gpt-5-nano/sk-a']);
});

test('every OpenAI key dead: the cascade goes on to the next provider without retrying them', async () => {
  keys({ OPENAI_API_KEY: 'sk-a', OPENAI_API_KEY_2: 'sk-b', GEMINI_API_KEY: 'g-1' });
  net = installNet((c) => (c.provider === 'openai' ? CLASSES['HTTP 401 bad key'].spec() : undefined));
  const out = await ask();
  expect(out.provider).toBe('gemini');
  expect(net.calls.filter((c) => c.provider === 'openai').map((c) => c.key)).toEqual(['sk-a', 'sk-b']);
});

/* ── 3. de-duplication ───────────────────────────────────────────────────── */

test('the same OpenAI key set twice (one copy with a BOM) is sent once', async () => {
  keys({ OPENAI_API_KEY: 'sk-same', OPENAI_API_KEY_2: '﻿sk-same ', GEMINI_API_KEY: 'g-1' });
  net = installNet((c) => (c.provider === 'openai' ? CLASSES['HTTP 401 bad key'].spec() : undefined));
  const out = await ask();
  expect(out.provider).toBe('gemini');
  expect(net.calls.filter((c) => c.provider === 'openai').length).toBe(1);
});

test('an env model that duplicates the shipped fallback (with stray whitespace) is tried once', async () => {
  keys({ OPENAI_API_KEY: 'sk-1', GEMINI_API_KEY: 'g-1', OPENAI_TEXT_MODEL: 'gpt-5-nano ' });
  net = installNet((c) => (c.provider === 'openai' ? CLASSES['HTTP 500'].spec() : undefined));
  const out = await ask();
  expect(out.provider).toBe('gemini');
  expect(net.calls.filter((c) => c.provider === 'openai').map((c) => c.model)).toEqual(['gpt-5-nano']);
});

test('a workspace order or model list with repeats runs each once', async () => {
  keys({ GROQ_API_KEY: 'gq-1', OPENAI_API_KEY: 'sk-1' });
  net = installNet((c) => (c.provider === 'groq' ? CLASSES['HTTP 500'].spec() : undefined));
  const out = await ask({ overrides: { order: ['groq', 'groq', 'openai'], models: { groq: ['m-1', 'm-1 ', 'm-2'] }, keys: {}, bases: {}, fallback: false } });
  expect(out.provider).toBe('openai');
  expect(net.calls.filter((c) => c.provider === 'groq').map((c) => c.model)).toEqual(['m-1', 'm-2']);
});

/* ── 4. the workspace's own order ────────────────────────────────────────── */

test('a workspace\'s own keys replace the default, in the operator\'s quality order, and a failing one falls to the NEXT', async () => {
  // Since 2026-10-17 a workspace that connected keys of its own is answered
  // only by them, in the order Claude, OpenAI, Gemini, Grok, then the rest:
  // Gemini before Groq, whatever order the workspace listed them in.
  keys(KEYS);
  net = installNet((c) => (c.provider === 'gemini' ? CLASSES['HTTP 429 insufficient_quota'].spec() : undefined));
  const out = await ask({ overrides: { order: ['groq', 'gemini'], models: {}, keys: { groq: 'ws-groq', gemini: 'ws-gemini' }, bases: {}, fallback: true } });
  expect(out.provider).toBe('groq');
  expect(net.calls[0].provider).toBe('gemini');
  expect(net.calls[0].key).toBe('ws-gemini');
  expect(net.calls.filter((c) => c.provider === 'groq').every((c) => c.key === 'ws-groq')).toBe(true);
  expect(net.calls.some((c) => c.provider === 'anthropic')).toBe(false);
  expect(out.routing).toBe('workspace');
});

test('with fallback on, the platform cascade finishes the job after the workspace order is exhausted', async () => {
  keys(KEYS);
  net = installNet((c) => (c.provider === 'groq' || c.provider === 'gemini' ? CLASSES['HTTP 500'].spec() : undefined));
  const out = await ask({ overrides: { order: ['groq', 'gemini'], models: {}, keys: {}, bases: {}, fallback: true } });
  expect(out.provider).toBe('anthropic');
  expect(net.calls.map((c) => c.provider)).toEqual(['groq', 'groq', 'gemini', 'gemini', 'anthropic']);
});

test('with fallback off, the cascade ends at the workspace providers and says which platform ones it did not use', async () => {
  keys(KEYS);
  net = installNet((c) => (c.provider === 'groq' || c.provider === 'gemini' ? CLASSES['HTTP 500'].spec() : undefined));
  const err = await ask({ overrides: { order: ['groq', 'gemini'], models: {}, keys: {}, bases: {}, fallback: false } }).catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  expect(new Set(net.calls.map((c) => c.provider))).toEqual(new Set(['groq', 'gemini']));
  expect(err._skipped.map((s) => s.provider)).toEqual(expect.arrayContaining(['anthropic', 'openai']));
  expect(err.message).toMatch(/not tried: .*anthropic: outside this call's routing/);
});

test('fallback off with NO explicit order uses only the providers the workspace connected', async () => {
  keys(KEYS);
  net = installNet((c) => (c.provider === 'groq' ? CLASSES['HTTP 500'].spec() : undefined));
  const err = await ask({ overrides: { order: [], models: {}, keys: { groq: 'ws-groq' }, bases: {}, fallback: false, configured: ['groq'] } }).catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  expect(net.calls.every((c) => c.provider === 'groq' && c.key === 'ws-groq')).toBe(true);
  expect(net.calls.length).toBe(2);
});

/* ── 5. a preferred provider is FIRST, not ALONE ─────────────────────────── */

test('preferProvider puts that provider first and the cascade still follows it', async () => {
  keys(KEYS);
  net = installNet((c) => (c.provider === 'groq' ? CLASSES['HTTP 429 insufficient_quota'].spec() : undefined));
  const out = await ask({ preferProvider: 'groq' });
  expect(net.calls[0].provider).toBe('groq');
  expect(out.provider).toBe('anthropic');
});

test('APP_AI_PROVIDER behaves the same way; exclusive:true (the live probe) tries that provider alone', async () => {
  keys(Object.assign({ APP_AI_PROVIDER: 'gemini' }, KEYS));
  net = installNet((c) => (c.provider === 'gemini' ? CLASSES['HTTP 500'].spec() : undefined));
  const out = await ask();
  expect(net.calls[0].provider).toBe('gemini');
  expect(out.provider).toBe('anthropic');

  net.calls.length = 0;
  const err = await ask({ preferProvider: 'gemini', exclusive: true }).catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  expect(new Set(net.calls.map((c) => c.provider))).toEqual(new Set(['gemini']));
  expect(err._providerErrors[0].provider).toBe('gemini');
});

/* ── 6. when everything fails ────────────────────────────────────────────── */

test('every provider failing gives ONE error naming each provider tried and why, and those never tried', async () => {
  keys({ ANTHROPIC_API_KEY: 'ak-1', OPENAI_API_KEY: 'sk-1', GEMINI_API_KEY: 'g-1', GROQ_API_KEY: 'gq-1' });
  net = installNet((c) => ({
    anthropic: CLASSES['HTTP 400 credit balance too low'].spec(),
    openai: CLASSES['HTTP 401 bad key'].spec(),
    gemini: CLASSES['HTTP 429 rate limit with Retry-After'].spec(),
    groq: CLASSES['HTTP 503 overloaded'].spec(),
  })[c.provider]);
  const err = await ask().catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toMatch(/^All providers failed \[fallback-test\]/);
  expect(err.message).toMatch(/anthropic \([^)]+\): quota \/ billing exhausted HTTP 400/);
  expect(err.message).toMatch(/openai \([^)]+key #1\): key rejected HTTP 401/);
  expect(err.message).toMatch(/gemini \([^)]+\): rate limited HTTP 429, retry after 7s/);
  expect(err.message).toMatch(/groq \([^)]+\): provider error HTTP 503/);
  expect(err.message).toMatch(/not tried: .*grok: no key configured/);
  // The per-attempt rows keep the legacy fields every caller reads.
  for (const row of err._providerErrors) {
    expect(typeof row.provider).toBe('string');
    expect(typeof row.status).toBe('number');
    expect(typeof row.err).toBe('string');
  }
  expect(err._providerErrors.map((r) => r.provider)).toEqual(['anthropic', 'openai', 'gemini', 'gemini', 'groq', 'groq']);
});

test('no provider configured at all is its own error, with nothing called', async () => {
  net = installNet(() => undefined);
  const err = await ask().catch((e) => e);
  expect(err.message).toMatch(/No AI provider configured/);
  expect(net.calls).toEqual([]);
});

/* ── 7. timeouts and the total budget ────────────────────────────────────── */

test('one hanging provider costs one timeout, not the call', async () => {
  keys(KEYS);
  net = installNet((c) => (c.provider === 'anthropic' ? { hang: true } : undefined));
  const t0 = Date.now();
  const out = await ask({ timeoutMs: 300 });
  expect(out.provider).toBe('openai');
  expect(Date.now() - t0).toBeLessThan(1500);
  expect(net.calls.filter((c) => c.provider === 'anthropic').length).toBe(1);
});

test('the total budget stops the cascade and names the providers it never reached', async () => {
  keys(KEYS);
  net = installNet(() => ({ hang: true }));
  const t0 = Date.now();
  const err = await ask({ timeoutMs: 400, budgetMs: 1000 }).catch((e) => e);
  const took = Date.now() - t0;
  expect(err).toBeInstanceOf(Error);
  expect(took).toBeLessThan(1800);
  expect(err._budgetExhausted).toBe(true);
  expect(err._skipped.some((s) => /call budget exhausted/.test(s.reason))).toBe(true);
  expect(net.calls.some((c) => c.provider === 'groq')).toBe(false);
});

/* ── 8. the image cascade ────────────────────────────────────────────────── */

const CRON = 'cron-secret-for-the-fallback-spec-0123456789';
const PNG = Buffer.alloc(6000, 7);

async function image(bodyIn) {
  process.env.CRON_SECRET = CRON;
  const handler = require(path.join(ROOT, 'api', 'ai', 'image.js'));
  const res = { code: 0, payload: null, setHeader() {}, status(c) { this.code = c; return this; }, json(p) { this.payload = p; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { authorization: 'Bearer ' + CRON }, query: {}, body: Object.assign({ prompt: 'a product on a table', size: '1024x1024' }, bodyIn || {}) }, res);
  return res;
}

test('image: each rung falls through to the next and the answer names who drew it', async () => {
  keys({ GEMINI_API_KEY: 'g-1', OPENAI_API_KEY: 'sk-1' });
  net = installNet((c) => (c.provider === 'gemini' ? { status: 503, raw: 'busy' }
    : c.provider === 'pollinations' ? { status: 500, raw: 'down' }
      : { status: 200, json: { data: [{ b64_json: 'aW1hZ2U=' }] } }));
  const res = await image();
  expect(res.payload.ok).toBe(true);
  expect(res.payload.provider).toBe('openai');
  expect(res.payload.image_data_url).toMatch(/^data:image\/png;base64,/);
  expect(res.payload.attempts.map((a) => a.provider)).toEqual(['gemini', 'pollinations', 'pollinations', 'pollinations']);
});

test('image: a rejected Gemini key is not sent again to the next Gemini model or to Imagen', async () => {
  keys({ GEMINI_API_KEY: 'g-dead' });
  net = installNet((c) => (c.provider === 'gemini' ? CLASSES['HTTP 400 API_KEY_INVALID (Gemini style)'].spec()
    : { status: 200, headers: { 'content-type': 'image/jpeg' }, bytes: PNG }));
  const res = await image({ tier: 'premium' });
  expect(res.payload.ok).toBe(true);
  expect(res.payload.provider).toBe('pollinations');
  expect(net.calls.filter((c) => c.provider === 'gemini').length).toBe(1);
});

test('image: an HTML page answered 200 is not an image', async () => {
  net = installNet((c) => (c.model === 'flux-pro'
    ? { status: 200, headers: { 'content-type': 'text/html' }, bytes: Buffer.alloc(9000, 60) }
    : { status: 200, headers: { 'content-type': 'image/jpeg' }, bytes: PNG }));
  const res = await image();
  expect(res.payload.ok).toBe(true);
  expect(res.payload.model).toBe('flux-realism');
  expect(res.payload.image_data_url).toMatch(/^data:image\/jpeg;base64,/);
  expect(res.payload.attempts[0]).toMatchObject({ provider: 'pollinations', model: 'flux-pro', reason: 'empty' });
});

test('image: when every provider fails the placeholder is labelled, is NOT the image, and is not reported as a success', async () => {
  keys({ GEMINI_API_KEY: 'g-1', OPENAI_API_KEY: 'sk-1' });
  net = installNet((c) => (c.provider === 'openai' ? CLASSES['HTTP 400 billing_hard_limit_reached'].spec() : { status: 500, raw: 'down' }));
  const res = await image();
  expect(res.code).toBe(200);
  expect(res.payload.ok).toBe(false);
  expect(res.payload.placeholder).toBe(true);
  expect(res.payload.image_data_url).toBeNull();
  expect(res.payload.placeholder_data_url).toMatch(/^data:image\/svg\+xml/);
  expect(res.payload.quota_warning).toBe(true);
  expect(res.payload.detail).toMatch(/No image was generated and nothing was charged/);
  expect(res.payload.detail).toMatch(/openai gpt-image-2: billing \(HTTP 400\)/);
  expect(res.payload.attempts.length).toBeGreaterThanOrEqual(5);
});

test('image: the total budget bounds the cascade even when every provider hangs', async () => {
  keys({ GEMINI_API_KEY: 'g-1', OPENAI_API_KEY: 'sk-1' });
  net = installNet(() => ({ hang: true }));
  const t0 = Date.now();
  const res = await image({ budget_ms: 5000 });
  expect(Date.now() - t0).toBeLessThan(7000);
  expect(res.payload.placeholder).toBe(true);
  expect(res.payload.budget_exhausted).toBe(true);
});

/* ── 9. the placeholder is refunded (the real meter, the fake ledger) ───── */

test('image: a placeholder answer releases the credit hold', async () => {
  test.setTimeout(120_000);
  const A = require('./agents-harness');
  const H = require('./router-harness');
  const w = await A.world({ routers: { '/api/ai/image': 'api/ai/image.js' } });
  try {
    const uid = 'user-fallback', tok = H.jwtShaped(uid);
    w.db.addUser(tok, uid, 'fallback@example.test').addWorkspace('ws-fallback', uid, {
      name: 'Fallback Fixture', slug: 'fallback-fixture', industry: 'test fixtures', website: 'https://fallback.example.test',
      palette: { primary: '#1d4ed8', accent: '#f59e0b', surface: '#ffffff', ink: '#111827' }, typography: { heading: 'Arial', body: 'Arial' },
      voice: { tone: 'plain', banned: [] }, regions: [{ code: 'UK', name: 'United Kingdom', currency: 'GBP', store_url: 'https://fallback.example.test', home: true }],
      status: 'active', created_at: '2026-09-20T00:00:00.000Z',
    }).setActive(uid, 'ws-fallback');
    w.db.syncIdentityTables();
    w.db.route((u) => /api\.openai\.com|generativelanguage\.googleapis\.com|image\.pollinations\.ai|api\.cloudflare\.com/.test(u),
      () => ({ ok: false, status: 500, headers: { get: () => null }, text: async () => 'down', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }));
    w.reset();
    const r = await w.request('/api/ai/image', { json: { prompt: 'a product photo', size: '1024x1024' }, headers: { authorization: 'Bearer ' + tok } });
    expect(r.status, r.text).toBe(200);
    const payload = JSON.parse(r.text);
    expect(payload.ok).toBe(false);
    expect(payload.placeholder).toBe(true);
    expect(payload.image_data_url).toBeNull();
    const releases = w.db.table('credit_ledger').filter((l) => l.kind === 'release');
    expect(releases.length, JSON.stringify(w.db.table('credit_ledger'))).toBeGreaterThan(0);
    const wallet = w.db.table('credit_wallets').find((x) => x.user_id === uid);
    expect(wallet && wallet.held).toBe(0);
  } finally {
    await w.close();
  }
});

/* ── 10. the video cascade ───────────────────────────────────────────────── */

test('video: a job that completes with no video is not the answer; the next provider is tried', async () => {
  test.setTimeout(30_000);
  keys({ GEMINI_API_KEY: 'g-1', RUNWAY_API_KEY: 'rw-1' });
  net = installNet((c) => {
    if (c.provider === 'gemini' && /predictLongRunning/.test(c.url)) return { status: 200, json: { name: 'operations/op-1' } };
    if (c.provider === 'gemini') return { status: 200, json: { done: true, response: { generateVideoResponse: { generatedSamples: [] } } } };
    if (c.provider === 'runway') return { status: 200, json: { id: 'task-9' } };
    return undefined;
  });
  const video = require(path.join(ROOT, 'api', '_shared', 'video-core.js'));
  const out = await video.generateVideo({ prompt: 'a product turning on a plinth', duration_s: 5 });
  expect(out.ok).toBe(true);
  expect(out.provider).toBe('runway');
  expect(out.attempts).toEqual(expect.arrayContaining([{ provider: 'veo', error: 'completed without a video url' }]));
});

test('video: every provider failing says which and why', async () => {
  keys({ GEMINI_API_KEY: 'g-1', RUNWAY_API_KEY: 'rw-1' });
  net = installNet(() => ({ status: 401, raw: 'bad key' }));
  const video = require(path.join(ROOT, 'api', '_shared', 'video-core.js'));
  const out = await video.generateVideo({ prompt: 'a product turning on a plinth' });
  // Changed on purpose (2026-10-17): the code-rendered motion creative still
  // ships when every provider fails, and the failure is said beside it.
  expect(out.ok).toBe(true);
  expect(out.provider).toBe('code-motion');
  expect(out.mp4).toBeNull();
  expect(out.provider_error).toMatch(/veo: HTTP 401/);
  expect(out.provider_error).toMatch(/runway: HTTP 401/);
  expect(out.provider_error).toMatch(/sora: no key/);
  expect(out.note).toMatch(/every configured video provider failed/);
});
