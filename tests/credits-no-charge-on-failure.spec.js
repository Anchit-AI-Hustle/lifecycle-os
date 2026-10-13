// @ts-check
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// A generation that got no model answer is never charged (2026-10-13).
//
// Production logged "ALL PROVIDERS FAILED" 92 times on /api/brain and
// /api/calendar, and 11 function timeouts at 120 s. The meter released a hold
// only when the handler answered 4xx/5xx (or a 200 an endpoint flagged with
// successIf). Most generators CATCH the cascade's error and answer 200 with a
// template or a marker, so the run was charged for a model answer nobody got.
// And a function the platform killed at 120 s never settled at all: its hold
// stayed `held` for good.
//
// What has to hold:
//   - inside a metered request, a run whose every model call failed (all
//     providers failed, the call budget ran out, no provider configured) is
//     RELEASED whatever status the handler answers, and the receipt says so;
//   - a run where any model call answered is charged as before;
//   - a 200 whose JSON says ok:false is released;
//   - a hold older than the longest function lifetime with no spend or release
//     is released by the daily sweep; a settled hold and a recent hold are not.
//
// EXECUTED: credits-core.js and llm.js unmodified, inside request-scope.wrap,
// over tests/lib/fake-supabase.js (the ledger RPCs re-implemented from the SQL)
// with the provider hosts routed. Prices are read from the catalogue, never
// re-typed here.
// ─────────────────────────────────────────────────────────────────────────────

const { test, expect } = require('@playwright/test');
const path = require('path');
const { FakeSupabase, installCreditsRpc, makeReq, makeRes, envScope, response, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const credits = require(path.resolve(__dirname, '..', 'api', '_shared', 'credits-core.js'));
const scope = require(path.resolve(__dirname, '..', 'api', '_shared', 'request-scope.js'));
const llm = require(path.resolve(__dirname, '..', 'api', '_shared', 'llm.js'));
const catalog = require(path.resolve(__dirname, '..', 'api', '_shared', 'credit-catalog.js'));

const FEATURE = 'mailer.generate';
const PRICE = catalog.quote(FEATURE).total;

const ENV = envScope([
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'CREDIT_WELCOME_GRANT', 'CREDITS_COMP_ACCOUNTS',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'GEMINI_API_KEY', 'XAI_API_KEY',
  'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'OpenRouter_API_KEY', 'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL', 'SAKANA_BASE_URL', 'SAKANA_API_KEY', 'APP_AI_PROVIDER', 'LLM_TOTAL_BUDGET_MS',
]);

let db = null;
let REAL_FETCH;
test.beforeAll(() => { ENV.save(); REAL_FETCH = global.fetch; });
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; });
test.beforeEach(() => {
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'CREDIT_WELCOME_GRANT', 'CREDITS_COMP_ACCOUNTS',
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY',
    'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'OpenRouter_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL',
    'SAKANA_BASE_URL', 'SAKANA_API_KEY', 'APP_AI_PROVIDER', 'LLM_TOTAL_BUDGET_MS']) delete process.env[k];
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.GROQ_API_KEY = 'gq';
  process.env.CEREBRAS_API_KEY = 'cb';
  llm.resetProviderCooldowns();
  db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addWorkspace('ws-a', 'user-a').setActive('user-a', 'ws-a').syncIdentityTables();
  installCreditsRpc(db);
  db.install();
});
test.afterEach(() => { if (db) db.restore(); llm.resetProviderCooldowns(); });

/** Route the two provider hosts: `mode` 'down' (503), 'hang', or 'up'. */
function providers(mode) {
  const answer = { choices: [{ message: { content: 'a real model answer' }, finish_reason: 'stop' }] };
  db.route((url) => /api\.groq\.com|api\.cerebras\.ai/.test(url), (url, init) => {
    if (mode === 'up') return response(200, answer);
    if (mode === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    return response(503, { error: { message: 'upstream down' } });
  });
}

/** A generator in the shape most of the app has: it catches the cascade and answers 200 with a template. */
function generator(calls) {
  return scope.wrap(credits.metered(async (_req, res) => {
    const outs = [];
    for (let i = 0; i < (calls || 1); i++) {
      try {
        const r = await llm({ systemPrompt: 's', userMessage: 'u' + i, stage: 'meter-test', overrides: null, timeoutMs: 300, budgetMs: 1500 });
        outs.push(r.text);
      } catch (_) { outs.push(null); }
    }
    res.status(200).json({ ok: true, copy: outs.map((t) => t || '[template copy]') });
  }, () => FEATURE));
}

const wallet = () => db.find('credit_wallets', (w) => w.user_id === 'user-a');
const kinds = () => db.table('credit_ledger').map((l) => l.kind);
const run = async (handler) => { const res = makeRes(); await handler(makeReq({ token: 'tok-a', body: { mode: 'x' } }), res); return res; };

test('every provider failing, then a 200 template answer: the hold is RELEASED and nothing is charged', async () => {
  providers('down');
  const res = await run(generator(1));
  expect(res.code).toBe(200);
  expect(res.payload.copy).toEqual(['[template copy]']);
  expect(kinds()).toEqual(['grant', 'hold', 'release']);
  expect(wallet()).toMatchObject({ held: 0, lifetime_spent: 0 });
  expect(wallet().balance).toBe(wallet().lifetime_granted);
  const rel = db.table('credit_ledger').find((l) => l.kind === 'release');
  expect(rel.note).toMatch(/no model answered/i);
  expect(res.payload.credits).toMatchObject({ charged: 0 });
});

test('a call budget that runs out (hanging providers) is released too', async () => {
  providers('hang');
  const res = await run(generator(1));
  expect(res.code).toBe(200);
  expect(kinds()).toEqual(['grant', 'hold', 'release']);
  expect(wallet().lifetime_spent).toBe(0);
});

test('no provider configured at all is released', async () => {
  delete process.env.GROQ_API_KEY; delete process.env.CEREBRAS_API_KEY;
  providers('down');
  await run(generator(1));
  expect(kinds()).toEqual(['grant', 'hold', 'release']);
});

test('a run where a model answered is charged the catalogue price, as before', async () => {
  providers('up');
  const res = await run(generator(2));
  expect(res.payload.copy).toEqual(['a real model answer', 'a real model answer']);
  expect(kinds()).toEqual(['grant', 'hold', 'spend']);
  expect(wallet().lifetime_spent).toBe(PRICE);
});

test('one failed call and one answered call in the same run is a real answer: charged', async () => {
  let n = 0;
  db.route((url) => /api\.groq\.com|api\.cerebras\.ai/.test(url), () => (n++ < 2
    ? response(503, { error: { message: 'down' } })
    : response(200, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })));
  await run(generator(2));
  expect(kinds()).toEqual(['grant', 'hold', 'spend']);
});

test('a 200 whose JSON says ok:false is released', async () => {
  const h = scope.wrap(credits.metered(async (_r, res) => { res.status(200).json({ ok: false, error: 'nothing generated' }); }, () => FEATURE));
  await run(h);
  expect(kinds()).toEqual(['grant', 'hold', 'release']);
});

test('the outcome of one request never leaks into another running at the same time', async () => {
  providers('down');
  const failing = generator(1);
  const answering = scope.wrap(credits.metered(async (_r, res) => { res.status(200).json({ ok: true }); }, () => FEATURE));
  await Promise.all([run(failing), run(answering)]);
  const holds = db.table('credit_ledger').filter((l) => l.kind === 'hold').map((l) => l.hold_id);
  const outcome = (h) => db.table('credit_ledger').find((l) => l.hold_id === h && (l.kind === 'spend' || l.kind === 'release')).kind;
  expect(holds.map(outcome).sort()).toEqual(['release', 'spend']);
});

/* ── the hold a killed function left behind ──────────────────────────────── */

test('the daily sweep releases a hold older than any function can live, and leaves settled and recent holds alone', async () => {
  const stale = await credits.meter(makeReq({ token: 'tok-a' }), FEATURE);      // never settled: the platform killed it
  const done = await credits.meter(makeReq({ token: 'tok-a' }), FEATURE);
  await done.settle();
  // Age both: an hour ago.
  for (const l of db.table('credit_ledger')) if (l.hold_id === stale.hold_id || l.hold_id === done.hold_id) l.created_at = new Date(Date.now() - 3600e3).toISOString();
  const recent = await credits.meter(makeReq({ token: 'tok-a' }), FEATURE);   // a run in flight right now

  const out = await credits.releaseStaleHolds();
  expect(out).toMatchObject({ ok: true, released: 1 });
  const fin = (h) => db.table('credit_ledger').filter((l) => l.hold_id === h).map((l) => l.kind);
  expect(fin(stale.hold_id)).toEqual(['hold', 'release']);
  expect(fin(done.hold_id)).toEqual(['hold', 'spend']);
  expect(fin(recent.hold_id)).toEqual(['hold']);
  expect(db.table('credit_ledger').find((l) => l.hold_id === stale.hold_id && l.kind === 'release').note).toMatch(/never finished/i);
  expect(wallet().held).toBe(PRICE);                                            // only the in-flight one
  // Running it again changes nothing.
  expect(await credits.releaseStaleHolds()).toMatchObject({ ok: true, released: 0 });
});

test('the sweep says it did not run when the ledger is not configured, and never throws', async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const out = await credits.releaseStaleHolds();
  expect(out.ok).toBe(false);
  expect(out.reason).toMatch(/not configured/);
});
