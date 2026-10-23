// Credits at the REAL price of the model that made the run (2026-10-23).
//
// The operator: one balance; a run on any model is charged what that model
// really cost, converted to credits; their own keys cost nothing; with no
// credits and no key of their own, they are asked to buy (no free fallback).
// Executed through the shipped meter (credits-core.metered) over the fake
// ledger (tests/lib/fake-supabase.js), whose credit_settle never charges more
// than the hold, exactly as the SQL does.
//
// Run: npx playwright test tests/credits-real-price.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const { FakeSupabase, installCreditsRpc, makeReq, makeRes, envScope, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const credits = require(path.join(ROOT, 'api', '_shared', 'credits-core.js'));
const scope = require(path.join(ROOT, 'api', '_shared', 'request-scope.js'));
const MP = require(path.join(ROOT, 'api', '_shared', 'model-prices.js'));
const llm = require(path.join(ROOT, 'api', '_shared', 'llm.js'));

const ENV = envScope(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CREDIT_WELCOME_GRANT', 'CREDIT_VALUE_USD', 'CREDIT_PACK_PRICES', 'FREE_GENERATION', 'ZERO_CREDITS_FALLBACK']);
test.beforeEach(() => {
  ENV.save();
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CREDIT_WELCOME_GRANT = '500';
  process.env.CREDIT_VALUE_USD = '0.01';
  delete process.env.CREDIT_PACK_PRICES;
  delete process.env.ZERO_CREDITS_FALLBACK;
});
test.afterEach(() => ENV.restore());

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
function run(handler, feature = 'ads.generate') {
  const res = makeRes();
  const rq = makeReq({ token: 'tok-a', query: { workspace_id: 'ws-a' } });
  return scope.run(rq, () => credits.metered(handler, () => feature)(rq, res)).then(() => res);
}
const text = (provider, model, input_tokens, output_tokens, own = false) => ({ own, kind: 'text', provider, model, input_tokens, output_tokens });

test('the price table is the providers\' own, applied as they state it', () => {
  expect(MP.costUsd('claude-sonnet-5-5', 1e6, 1e6)).toBeCloseTo(12, 10);            // $2 in + $10 out
  expect(MP.costUsd('claude-haiku-5-5', 200000, 0)).toBeCloseTo(0.10, 10);          // past 100k: $0.50 / M
  expect(MP.costUsd('gpt-5.5', 300000, 0)).toBeCloseTo(3, 10);                       // past 272k: $10 / M
  expect(MP.costUsd('gemini-3.8-flash', 1e6, 0, '2026-12-31T12:00:00Z')).toBeCloseTo(0.75, 10);
  expect(MP.costUsd('gemini-3.8-flash', 1e6, 0, '2027-01-02T12:00:00Z')).toBeCloseTo(1.50, 10);
  expect(MP.costUsd('deepseek-flash', 1e6, 0, '2026-10-26T07:00:00Z')).toBeCloseTo(0.30, 10);  // Monday 07:00 UTC: peak
  expect(MP.costUsd('deepseek-flash', 1e6, 0, '2026-10-25T07:00:00Z')).toBeCloseTo(0.15, 10);  // Sunday: off-peak
  expect(MP.costUsd('openai/gpt-oss-120b', 1000, 1000)).toBeNull();                  // no price on record: none guessed
  expect(MP.costUsd('gpt-5', 1000, null)).toBeNull();                                // a count missing: no cost
});

test('a run is charged its real cost in credits, rounded up, and the rest of the hold comes back', async () => {
  const db = world();
  // gpt-5-mini: 1,000 in x $0.25/M + 500 out x $2/M = $0.00125 -> 0.125 credit -> 1.
  const res = await run(answered([text('openai', 'gpt-5-mini', 1000, 500)]));
  expect(res.payload.credits).toMatchObject({ charged: 1, refunded: 17 });
  expect(wallet(db)).toMatchObject({ balance: 499, held: 0 });
  expect(spends(db)[0].meta.usage.pricing).toMatchObject({ basis: 'real', usd: 0.00125, credit_value_usd: 0.01, credit_value_basis: 'CREDIT_VALUE_USD' });
});

test('a run that really cost more than its hold is charged the rest as a second, settled hold', async () => {
  const db = world();
  // Sonnet 5.5: 1M in ($2) + 100k out ($1) = $3 = 300 credits; the hold was 18.
  const res = await run(answered([text('anthropic', 'claude-sonnet-5-5', 1e6, 1e5)]));
  expect(res.payload.credits.charged).toBe(300);
  expect(wallet(db)).toMatchObject({ balance: 200, held: 0, lifetime_spent: 300 });
  expect(spends(db).length).toBe(2);
});

test('a wallet that cannot cover the real price is charged what it held, and the shortfall is written down', async () => {
  const db = world();
  // Opus 5.5: 1M in ($4) + 300k out ($6) = $10 = 1,000 credits; the wallet holds 500.
  const res = await run(answered([text('anthropic', 'claude-opus-5-5', 1e6, 3e5)]));
  expect(res.payload.credits).toMatchObject({ charged: 18, unbilled_credits: 982 });
  expect(res.payload.credits.note).toMatch(/really cost 1000 credits; 982 could not be charged/);
  expect(wallet(db)).toMatchObject({ balance: 482, held: 0 });
});

test('the catalogue price stands, and says why, when a model has no price or a credit has no value', async () => {
  let db = world();
  let res = await run(answered([text('groq', 'openai/gpt-oss-120b', 900, 300)]));
  expect(res.payload.credits.charged).toBe(18);
  expect(spends(db)[0].meta.usage.pricing).toMatchObject({ basis: 'catalogue', missing: 'no published price is on record for openai/gpt-oss-120b' });

  delete process.env.CREDIT_VALUE_USD;
  db = world();
  res = await run(answered([text('openai', 'gpt-5-mini', 1000, 500)]));
  expect(res.payload.credits.charged).toBe(18);
  expect(spends(db)[0].meta.usage.pricing.missing).toMatch(/value of one credit is not set/);
});

test('a credit pack priced in USD sets the value of a credit when no explicit value is given', () => {
  delete process.env.CREDIT_VALUE_USD;
  const packs = [{ key: 'starter', label: 'Starter', credits: 500, total_credits: 500, price: { configured: true, currency: 'USD', amount_minor: 1000, display: '$10.00' } },
    { key: 'growth', label: 'Growth', credits: 2500, total_credits: 2750, price: { configured: true, currency: 'USD', amount_minor: 2750, display: '$27.50' } },
    { key: 'inr', label: 'INR', credits: 500, total_credits: 500, price: { configured: true, currency: 'INR', amount_minor: 49900, display: '₹499.00' } }];
  const v = MP.creditValueUsd(packs);
  expect(v.usd).toBeCloseTo(0.01, 10);   // the cheapest USD per credit: $27.50 / 2,750
  expect(v.basis).toMatch(/Growth pack/);
  expect(MP.creditValueUsd([packs[2]])).toBeNull();   // INR only: no exchange rate is assumed
});

test('a credit-paid run tries the flagship models first; a run nobody pays for keeps the free-first order', () => {
  process.env.FREE_GENERATION = 'on';
  const free = llm.providerOrder('standard');
  expect(free[0]).not.toBe('anthropic');
  const paid = scope.run({ headers: {} }, () => { scope.current().creditPaid = true; return llm.providerOrder('standard'); });
  expect(paid.slice(0, 2)).toEqual(['anthropic', 'bedrock']);
  expect(paid[paid.length - 1]).toBe('pollinations');
});

test('with no credits and no key of its own, a run is refused and asked to buy', async () => {
  process.env.CREDIT_WELCOME_GRANT = '0';
  world();
  let reached = false;
  const res = await run(async (_req, r) => { reached = true; r.status(200).json({ ok: true }); });
  expect(res.code).toBe(402);
  expect(res.payload).toMatchObject({ ok: false, error: 'insufficient_credits' });
  expect(reached).toBe(false);
});
