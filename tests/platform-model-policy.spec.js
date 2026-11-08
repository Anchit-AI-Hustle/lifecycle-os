// @ts-check
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// The platform's own model: Claude Opus 5.5 on Bedrock, on the operator's
// money, until it is gone; then each person's own model (2026-11-09).
//
// The operator: "ensure claude opus 5.5 from aws bedrock only with my personal
// credits is used till they are exhausted for all users initially and then
// gradually with usage nudge each user to use their own api keys - keep a
// notification alert for this".
//
// EXECUTED: the shipped llm.js and platform-model-policy.js over a fake network
// (Bedrock's Messages endpoint, the other providers, and the Supabase RPCs the
// spend is kept in) that throws on any other host; the notice is credits.js
// rendered in Chromium against the answers the server gives.
// ─────────────────────────────────────────────────────────────────────────────

const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const LLM_PATH = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const POLICY_PATH = require.resolve(path.join(ROOT, 'api', '_shared', 'platform-model-policy.js'));
const llm = () => require(LLM_PATH);
const policy = () => require(POLICY_PATH);

const HOSTS = {
  'bedrock-mantle.us-east-1.api.aws': 'bedrock', 'api.groq.com': 'groq', 'api.openai.com': 'openai',
  'text.pollinations.ai': 'pollinations', 'db.example.test': 'store',
};

function installNet({ spent = 0, failBedrock = false } = {}) {
  const real = global.fetch;
  const calls = []; const usage = [];
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const who = HOSTS[u.host];
    if (!who) throw new Error('unrouted host: ' + u.host);
    let body = {}; try { body = init.body ? JSON.parse(init.body) : {}; } catch (_) { body = {}; }
    const reply = (status, json) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(json) });
    if (who === 'store') {
      const fn = u.pathname.split('/').pop();
      if (fn === 'platform_usage_total') return reply(200, [{ usd: spent, answers: 0, unpriced: 0 }]);
      if (fn === 'platform_usage_add') { usage.push(body); return reply(204, null); }
      if (fn === 'platform_usage_for_user') return reply(200, [{ usd: 1.2, answers: 60 }]);
      throw new Error('unrouted rpc ' + fn);
    }
    calls.push({ who, model: body.model || '' });
    if (who === 'bedrock') {
      if (failBedrock) return reply(403, { type: 'error', error: { type: 'permission_error', message: 'not available for this account' } });
      return reply(200, { content: [{ type: 'text', text: 'bedrock says hi' }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500 } });
    }
    return reply(200, { choices: [{ message: { content: 'answer from ' + who }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  };
  return { calls, usage, restore() { global.fetch = real; } };
}

const ENV = ['PLATFORM_LLM_ONLY', 'PLATFORM_BEDROCK_BUDGET_USD', 'PLATFORM_BEDROCK_PRICE_IN', 'PLATFORM_BEDROCK_PRICE_OUT', 'BEDROCK_API_KEY',
  'BEDROCK_REGION', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY',
  'GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'FREE_GENERATION',
  'BEDROCK_TEXT_MODEL_MAX', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY'];
let saved = {}; let net = null;
test.beforeEach(() => {
  saved = {}; for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, { FREE_GENERATION: 'off', BEDROCK_API_KEY: 'ABSK-test', BEDROCK_REGION: 'us-east-1', GROQ_API_KEY: 'gq',
    SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
  llm().resetProviderCooldowns(); policy()._reset();
});
test.afterEach(() => {
  if (net) { net.restore(); net = null; }
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  llm().resetProviderCooldowns(); policy()._reset();
});
const ask = (o) => llm()(Object.assign({ systemPrompt: 'sys', userMessage: 'hi', stage: 'policy-test', overrides: null, tier: 'fast', timeoutMs: 800 }, o || {}));
const settle = () => new Promise((r) => setTimeout(r, 30));

test('policy on: every platform call goes to Opus 5.5 on Bedrock, at every tier, and nothing else', async () => {
  process.env.PLATFORM_LLM_ONLY = 'bedrock';
  for (const t of ['premium', 'standard', 'fast']) expect(llm().providerOrder(t)).toEqual(['bedrock']);
  net = installNet();
  const out = await ask({ tier: 'fast' });
  expect(out.provider).toBe('bedrock');
  expect(net.calls.map((c) => c.who + ':' + c.model)).toEqual(['bedrock:anthropic.claude-opus-5-5']);
  await settle();
  expect(net.usage).toHaveLength(1);
  expect(net.usage[0]).toMatchObject({ p_model: 'anthropic.claude-opus-5-5', p_in: 1000, p_out: 500 });
  expect(net.usage[0].p_usd).toBeCloseTo((1000 * 4 + 500 * 20) / 1e6, 9);
});

test('policy on and Bedrock refuses: no other platform model is asked (template copy follows)', async () => {
  process.env.PLATFORM_LLM_ONLY = 'bedrock';
  net = installNet({ failBedrock: true });
  await expect(ask()).rejects.toThrow(/All providers failed/);
  expect(net.calls.every((c) => c.who === 'bedrock')).toBe(true);
  expect(net.usage).toHaveLength(0);
});

test('budget used up: the platform model is off for everyone; a person with their own key still runs on it', async () => {
  Object.assign(process.env, { PLATFORM_LLM_ONLY: 'bedrock', PLATFORM_BEDROCK_BUDGET_USD: '50' });
  net = installNet({ spent: 50.01 });
  await expect(ask()).rejects.toThrow(/All providers failed/);
  expect(net.calls).toHaveLength(0);
  expect(policy().platformOpen()).toBe(false);
  const out = await ask({ overrides: { keys: { openai: 'sk-own' }, configured: ['openai'], fallback: true } });
  expect(out.provider).toBe('openai');
  expect(net.calls.map((c) => c.who)).toEqual(['openai']);
});

test('budget not yet used up: the platform model answers and its spend is added', async () => {
  Object.assign(process.env, { PLATFORM_LLM_ONLY: 'bedrock', PLATFORM_BEDROCK_BUDGET_USD: '50' });
  net = installNet({ spent: 10 });
  const out = await ask();
  expect(out.provider).toBe('bedrock');
  await settle();
  expect(policy().spentUsd()).toBeCloseTo(10 + 0.014, 6);
});

test('a person with their own key is asked first, and the platform Opus answers after it fails', async () => {
  process.env.PLATFORM_LLM_ONLY = 'bedrock';
  net = installNet();
  const real = global.fetch;
  global.fetch = async (url, init) => (new URL(String(url)).host === 'api.openai.com'
    ? { ok: false, status: 401, headers: { get: () => null }, text: async () => '{"error":{"message":"invalid_api_key"}}' }
    : real(url, init));
  const out = await ask({ overrides: { keys: { openai: 'sk-bad' }, configured: ['openai'], fallback: true } });
  expect(out.provider).toBe('bedrock');
  global.fetch = real;
});

test('policy off: the platform order is unchanged (no Bedrock-only)', async () => {
  expect(llm().providerOrder('standard')).toContain('groq');
  net = installNet();
  const out = await ask();
  expect(out.provider).not.toBe('pollinations');
  expect(net.usage).toHaveLength(0);
});

test('the nudge rises with use and with the budget, and is never shown to someone on their own model', () => {
  Object.assign(process.env, { PLATFORM_LLM_ONLY: 'bedrock', PLATFORM_BEDROCK_BUDGET_USD: '100' });
  const P = policy();
  expect(P.nudgeFor({ answers: 3 }, { ownConnected: false }).level).toBe('none');
  expect(P.nudgeFor({ answers: 12 }, { ownConnected: false }).level).toBe('tip');
  expect(P.nudgeFor({ answers: 60 }, { ownConnected: false }).level).toBe('suggest');
  expect(P.nudgeFor({ answers: 250 }, { ownConnected: false }).level).toBe('strong');
  expect(P.nudgeFor({ answers: 999 }, { ownConnected: true }).level).toBe('none');
  P._state.spent = 85; P._state.at = Date.now();
  const late = P.nudgeFor({ answers: 2 }, { ownConnected: false });
  expect(late.level).toBe('strong');
  expect(late.message).toMatch(/85%/);
  P._state.spent = 100;
  const gone = P.nudgeFor({ answers: 2 }, { ownConnected: false });
  expect(gone.level).toBe('required');
  expect(gone.options.map((o) => o.provider)).toEqual(expect.arrayContaining(['anthropic', 'openai', 'gemini', 'openrouter']));
});

/* ── the notice, in a page ─────────────────────────────────────────────────── */

let server; let base;
let nudgeAnswer = null;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const op = u.searchParams.get('op');
      if (op === 'balance') return res.end(JSON.stringify({ ok: true, wallet: { id: 'w', balance: 500, held: 0 }, features: [] }));
      if (op === 'model-nudge') return res.end(JSON.stringify(nudgeAnswer));
      return res.end(JSON.stringify({ ok: true, features: [] }));
    }
    if (u.pathname === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><html><body><nav id="lifecycle-nav"></nav><main><h1>Page</h1><button id="b">Do</button></main><script>window.LifecycleAuth={session:{access_token:"t"},apiToken:function(){return "t"}};</script><script src="/credits.js"></script></body></html>'); }
    const f = path.join(ROOT, u.pathname.slice(1));
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) { server.closeAllConnections && server.closeAllConnections(); await new Promise((r) => server.close(r)); } });

test('the notice: shown in the page flow, links to AI Models, lists the models a person may already pay for, and stays dismissed', async ({ page }) => {
  const P = policy();
  process.env.PLATFORM_LLM_ONLY = 'bedrock';
  nudgeAnswer = Object.assign({ ok: true }, P.nudgeFor({ answers: 60 }, { ownConnected: false }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(base + '/page', { waitUntil: 'domcontentloaded' });
  const box = page.locator('#lc-model-nudge');
  await expect(box).toBeVisible({ timeout: 10000 });
  await expect(box).toHaveAttribute('data-level', 'suggest');
  await expect(box).toContainText('60 runs');
  await expect(box.getByRole('link', { name: 'Connect my model' })).toHaveAttribute('href', '/ai-models');
  await box.locator('summary').click();
  await expect(box.getByRole('link', { name: 'Claude (Anthropic)' })).toBeVisible();
  // In the flow: it never sits over the page's own control.
  const nb = await box.boundingBox(); const bb = await page.locator('#b').boundingBox();
  expect(nb && bb && (nb.y + nb.height <= bb.y || bb.y + bb.height <= nb.y)).toBe(true);
  await box.getByRole('button', { name: 'Dismiss' }).click();
  await expect(box).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.locator('#lc-model-nudge')).toHaveCount(0);
});

test('the notice: nothing for someone on their own model', async ({ page }) => {
  nudgeAnswer = Object.assign({ ok: true }, policy().nudgeFor({ answers: 500 }, { ownConnected: true }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(base + '/page', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(page.locator('#lc-model-nudge')).toHaveCount(0);
});
