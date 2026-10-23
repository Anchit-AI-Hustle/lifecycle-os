// @ts-check
'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');
const { FakeSupabase, installCreditsRpc, makeReq, makeRes, envScope, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const credits = require(path.join(ROOT, 'api', '_shared', 'credits-core.js'));
const catalog = require(path.join(ROOT, 'api', '_shared', 'credit-catalog.js'));
const router = require(path.join(ROOT, 'api', '_shared', 'model-router.js'));
const scope = require(path.join(ROOT, 'api', '_shared', 'request-scope.js'));
const LLM = path.join(ROOT, 'api', '_shared', 'llm.js');
const llm = () => require(LLM);

const ENV = envScope([
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CREDIT_WELCOME_GRANT', 'FREE_GENERATION',
  'ZERO_CREDITS_FALLBACK', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'USE_BEDROCK_FOR_ANTHROPIC', 'APP_AI_PROVIDER', 'APP_AI_TIER',
]);

let REAL_FETCH;
test.beforeEach(() => {
  ENV.save();
  REAL_FETCH = global.fetch;
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CREDIT_WELCOME_GRANT = '500';
  process.env.FREE_GENERATION = 'off';
  process.env.ZERO_CREDITS_FALLBACK = 'off';
  for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'USE_BEDROCK_FOR_ANTHROPIC', 'APP_AI_PROVIDER', 'APP_AI_TIER']) delete process.env[k];
  llm().resetProviderCooldowns();
});
test.afterEach(() => {
  global.fetch = REAL_FETCH;
  ENV.restore();
  llm().resetProviderCooldowns();
});

function world() {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addWorkspace('ws-a', 'user-a').setActive('user-a', 'ws-a').syncIdentityTables();
  installCreditsRpc(db);
  db.install();
  return db;
}
const wallet = (db) => db.find('credit_wallets', (w) => w.user_id === 'user-a' && w.workspace_id === 'ws-a');
const spends = (db) => db.table('credit_ledger').filter((l) => l.kind === 'spend');

const answered = (rows) => async (_req, res) => {
  for (const r of rows) scope.noteLlm('ok', r);
  res.status(200).json({ ok: true });
};
function run(handler, feature = 'mailer.generate', reqOpts = {}) {
  const res = makeRes();
  const rq = makeReq(Object.assign({ token: 'tok-a', query: { workspace_id: 'ws-a' } }, reqOpts));
  return scope.run(rq, () => credits.metered(handler, () => feature)(rq, res)).then(() => res);
}

test('model price table: Claude Opus charges more credits than Claude Sonnet or GPT-4o', () => {
  expect(catalog.modelMultiplier('anthropic', 'claude-opus-5-5')).toBe(2.5);
  expect(catalog.modelMultiplier('anthropic', 'claude-sonnet-5-5')).toBe(1.0);
  expect(catalog.modelMultiplier('openai', 'gpt-4o')).toBe(1.0);
  expect(catalog.modelMultiplier('deepseek', 'deepseek-chat')).toBe(0.35);
  expect(catalog.modelMultiplier('gemini', 'gemini-3.8-flash')).toBe(0.3);
});

test('credit-paid run on Claude Opus deducts higher credits matching model price table', async () => {
  const db = world();
  // mailer.generate base catalogue price is 20 credits
  // Claude Opus multiplier is 2.5 -> charges 20 * 2.5 = 50 credits
  const res = await run(answered([{
    own: false, kind: 'text', provider: 'anthropic', model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 450
  }]), 'mailer.generate', { body: { model: 'claude-opus-5-5' } });
  expect(res.code).toBe(200);
  expect(res.payload.credits).toMatchObject({
    charged: 50,
    model: 'claude-opus-5-5',
    provider: 'anthropic',
    model_multiplier: 2.5,
  });
  expect(wallet(db)).toMatchObject({ balance: 450, lifetime_spent: 50 });
  const spendRow = spends(db)[0];
  expect(spendRow.meta.usage).toMatchObject({
    charged: 50,
    full_price: 50,
    model_multiplier: 2.5,
    primary_model: 'claude-opus-5-5',
    primary_provider: 'anthropic',
  });
});

test('credit-paid run on Claude Sonnet charges baseline catalogue credits', async () => {
  const db = world();
  const res = await run(answered([{
    own: false, kind: 'text', provider: 'anthropic', model: 'claude-sonnet-5-5', input_tokens: 800, output_tokens: 300
  }]));
  expect(res.code).toBe(200);
  expect(res.payload.credits).toMatchObject({ charged: 20, model: 'claude-sonnet-5-5', provider: 'anthropic', model_multiplier: 1.0 });
  expect(wallet(db)).toMatchObject({ balance: 480, lifetime_spent: 20 });
});

test('workspace BYOK run costs 0 credits regardless of model tier', async () => {
  const db = world();
  const res = await run(answered([{
    own: true, kind: 'text', provider: 'anthropic', model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 450
  }]));
  expect(res.code).toBe(200);
  expect(res.payload.credits).toMatchObject({ charged: 0, own_keys: true });
  expect(wallet(db)).toMatchObject({ balance: 500, lifetime_spent: 0 });
});

test('zero credits fallback: allows basic generation with 0 credits charged when ZERO_CREDITS_FALLBACK=on', async () => {
  const db = world();
  process.env.ZERO_CREDITS_FALLBACK = 'on';
  await credits.wallet('user-a', 'ws-a');
  // Drain the wallet to 0
  db.find('credit_wallets', (w) => w.user_id === 'user-a' && w.workspace_id === 'ws-a').balance = 0;

  const res = await run(answered([{
    own: false, kind: 'text', provider: 'deepseek', model: 'deepseek-chat', input_tokens: 500, output_tokens: 200
  }]));
  expect(res.code).toBe(200);
  expect(res.payload.credits).toMatchObject({
    charged: 0,
    fallback: true,
    provider: 'deepseek',
    model: 'deepseek-chat',
  });
  expect(res.payload.credits.note).toMatch(/basic fallback model/i);
});

test('model router budget cap routes to fast fallback when balance is 0 and ZERO_CREDITS_FALLBACK=on', () => {
  process.env.ZERO_CREDITS_FALLBACK = 'on';
  const decision = router.chooseTier({ stage: 'mailer_full', balance: 0, cost: 20 });
  expect(decision.allowed).toBe(true);
  expect(decision.tier).toBe('fast');
  expect(decision.reason).toMatch(/wallet balance is 0/i);
});

test('AWS Bedrock AI model signs SigV4 and invokes Claude endpoint correctly', async () => {
  process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7BEDROCK';
  process.env.AWS_SECRET_ACCESS_KEY = 'bedrockSecretKeySecretKey1234567890';
  process.env.AWS_REGION = 'us-east-1';

  let captured = null;
  global.fetch = async (url, init = {}) => {
    captured = { url: String(url), init };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({
        content: [{ type: 'text', text: 'response from Bedrock Claude' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 42, output_tokens: 18 },
      }),
    };
  };

  const res = await llm()({
    systemPrompt: 'sys',
    userMessage: 'hi',
    preferProvider: 'anthropic',
    exclusive: true,
    tier: 'standard',
  });

  expect(res.provider).toBe('bedrock');
  expect(res.text).toBe('response from Bedrock Claude');
  expect(captured.url).toBe('https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2%3A0/invoke');
  const auth = captured.init.headers.Authorization || captured.init.headers.authorization;
  expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7BEDROCK\/.*\/us-east-1\/bedrock\/aws4_request/);
  expect(captured.init.headers['x-amz-date']).toBeTruthy();
});

test('fallback waterfall order puts free strong models first and pollinations last', () => {
  process.env.FREE_GENERATION = 'on';
  const fastOrder = llm().providerOrder('fast');
  const stdOrder = llm().providerOrder('standard');

  // Gemini and Groq (free tiers) come before paid
  expect(fastOrder.indexOf('gemini')).toBeLessThan(fastOrder.indexOf('openai'));
  expect(fastOrder.indexOf('groq')).toBeLessThan(fastOrder.indexOf('pollinations'));
  // Weak keyless model drops to last
  expect(fastOrder[fastOrder.length - 1]).toBe('pollinations');
  expect(stdOrder[stdOrder.length - 1]).toBe('pollinations');
});
