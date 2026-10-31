// A connection Test always reaches the provider, and says what to do (2026-10-31).
//
// Production, AI Models: a person saved a NEW AWS key pair at 21:19:52 and the
// Test a second later read "The call failed (no status).": llm.js had paused
// Bedrock for ten minutes after the previous key failed, and the Test obeyed
// the pause, so the new key was never sent. Gemini's Test showed the same
// sentence. Executed here against the shipped llm.js with fetch scripted.
const { test, expect } = require('@playwright/test');
const path = require('path');

const LLM = path.join(__dirname, '..', 'api', '_shared', 'llm.js');
const CORE = path.join(__dirname, '..', 'api', '_shared', 'workspace-connections-core.js');

function scripted(statuses) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const st = statuses.shift();
    if (st === 200) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: st, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

test.describe('connection Test', () => {
  let saved;
  test.beforeEach(() => { saved = global.fetch; require(LLM).resetProviderCooldowns(); });
  test.afterEach(() => { global.fetch = saved; });

  const ask = (callLLM, keys, extra) => callLLM({
    systemPrompt: 'x', userMessage: 'ping', maxTokens: 16, timeoutMs: 8000, stage: 'connection-check',
    overrides: Object.assign({ order: ['groq'], keys, models: { groq: ['m1'] }, fallback: false }, extra || {}),
  });

  test('a Test of a paused key still makes the call; a generation does not', async () => {
    const callLLM = require(LLM);
    const s = scripted([401, 401, 200]);
    global.fetch = s.fetchImpl;
    await expect(ask(callLLM, { groq: 'gsk_same' })).rejects.toThrow();          // fails: key paused
    expect(s.calls.length).toBe(1);
    await expect(ask(callLLM, { groq: 'gsk_same' })).rejects.toThrow();          // a generation: skipped
    expect(s.calls.length).toBe(1);
    await expect(ask(callLLM, { groq: 'gsk_same' }, { fresh: true })).rejects.toThrow(); // a Test: sent
    expect(s.calls.length).toBe(2);
    const ok = await ask(callLLM, { groq: 'gsk_same' }, { fresh: true });        // account fixed: answers
    expect(ok.text).toBe('ok');
    s.calls.length = 0;
    global.fetch = scripted([200]).fetchImpl;
    const after = await ask(callLLM, { groq: 'gsk_same' });                       // and generations use it at once
    expect(after.text).toBe('ok');
  });

  test('a failed Test says what happened, what to do, and links the page that fixes it', () => {
    const core = require(CORE);
    const reg = (id) => core.BY_ID.get(id);
    const err = (det) => Object.assign(new Error('x'), { _providerErrors: [det], _skipped: [] });

    const auth = core.checkFailure(reg('anthropic'), err({ provider: 'anthropic', status: 401, kind: 'auth', err: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}' }));
    expect(auth.note).toContain('refused this key');
    expect(auth.note).toContain('invalid x-api-key');
    expect(auth.fix_url).toBe(core.FIX_PAGES.anthropic.keys);

    const quota = core.checkFailure(reg('gemini'), err({ provider: 'gemini', status: 429, kind: 'billing', err: '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details."}}' }));
    expect(quota.note).toMatch(/no credit or quota left/);
    expect(quota.note).toContain('You exceeded your current quota');
    expect(quota.fix_url).toBe(core.FIX_PAGES.gemini.billing);

    const aws = core.checkFailure(reg('bedrock'), err({ provider: 'bedrock', status: 403, kind: 'auth', err: '{"message":"The security token included in the request is invalid."}' }));
    expect(aws.note).toContain('AWS refused this key pair');
    expect(aws.fix).toMatch(/AmazonBedrockFullAccess/);

    const none = core.checkFailure(reg('groq'), Object.assign(new Error('x'), { _providerErrors: [], _skipped: [{ provider: 'groq', reason: 'cooling down' }] }));
    expect(none.note).not.toMatch(/no status/);
    expect(none.fix).toMatch(/Test again/);
  });

  test('a shortened key copied from the provider\'s keys list is refused at Save, with why', async () => {
    const { maskedKeyProblem } = require(CORE);
    const groq = { category: 'ai', label: 'Groq' };
    for (const v of ['gsk_****mhHY', 'gsk_...mhHY', 'gsk_\u2022\u2022\u2022mhHY', 'gsk_\u2026mhHY', 'gsk_abc mhHY']) {
      expect(maskedKeyProblem(v, groq), v).toContain('shortened copy Groq shows');
    }
    expect(maskedKeyProblem('gsk_' + 'a1B2'.repeat(12), groq)).toBe('');
    expect(maskedKeyProblem('sk-ant-api03-' + 'x'.repeat(80), { category: 'ai', label: 'Claude' })).toBe('');
    expect(maskedKeyProblem('a b', { category: 'commerce', label: 'Shopify' })).toBe('');
  });
});
