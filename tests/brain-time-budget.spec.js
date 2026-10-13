// @ts-check
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// /api/brain and /api/calendar answer before the platform kills them (2026-10-13).
//
// Production: /api/brain hit Vercel's 120 s limit 11 times. A killed function
// sends the browser a bare 504, keeps whatever it did unsaid, and (before the
// credits change) leaves its hold `held`. Now:
//   - the request carries a DEADLINE (api/_shared/time-budget.js), well inside
//     maxDuration; llm.js never budgets a model call past it, so a slow
//     provider cannot carry the run beyond it;
//   - a watchdog answers at the deadline with what finished (the steps the run
//     recorded) and a sentence, as ok:false + partial:true, so the credit meter
//     RELEASES the hold; whatever the handler writes later is dropped.
//
// EXECUTED: the module and the real llm.js over a hanging network; then the
// SHIPPED api/brain.js router (tests/agents-harness.js) with a slow scripted
// model, the credit meter running over the fake ledger.
// ─────────────────────────────────────────────────────────────────────────────

const { test, expect } = require('@playwright/test');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const tb = require(path.join(ROOT, 'api/_shared/time-budget.js'));
const scope = require(path.join(ROOT, 'api/_shared/request-scope.js'));

function recRes() {
  const out = { code: 200, payload: null, writes: 0, headersSent: false };
  out.status = (c) => { out.code = c; return out; };
  out.json = (p) => { out.payload = p; out.writes += 1; out.headersSent = true; return out; };
  out.end = () => { out.writes += 1; out.headersSent = true; return out; };
  out.setHeader = () => {};
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a handler slower than its budget is answered AT the budget with the steps that finished, and its late write is dropped', async () => {
  const h = scope.wrap(tb.guard(async (_req, res) => {
    tb.step('read the brand record');
    tb.step('planned 30 slots');
    await sleep(1500);
    tb.step('never reached');
    res.status(200).json({ ok: true, late: true });
  }, { budgetMs: 300, label: 'brain' }));
  const res = recRes();
  const t0 = Date.now();
  await h({ query: { action: 'agentic-run' }, headers: {} }, res);
  expect(Date.now() - t0).toBeLessThan(1000);
  expect(res.code).toBe(200);
  expect(res.payload).toMatchObject({ ok: false, partial: true, state: 'time_budget_exhausted', action: 'agentic-run', completed: ['read the brand record', 'planned 30 slots'] });
  expect(res.payload.message).toMatch(/stopped after \d+ s/);
  expect(res.payload.message).toMatch(/read the brand record; planned 30 slots/);
  await sleep(1400);
  expect(res.writes).toBe(1);                       // the late answer never reached the client
});

test('a handler inside its budget answers as before, untouched', async () => {
  const h = scope.wrap(tb.guard(async (_req, res) => { res.status(201).json({ ok: true }); }, { budgetMs: 500 }));
  const res = recRes();
  await h({ query: {}, headers: {} }, res);
  expect(res.code).toBe(201);
  expect(res.payload).toEqual({ ok: true });
});

test('a handler that already answered and keeps working (fire-and-forget) is not answered twice', async () => {
  const h = scope.wrap(tb.guard(async (_req, res) => { res.json({ ok: true }); await sleep(600); }, { budgetMs: 200 }));
  const res = recRes();
  await h({ query: {}, headers: {} }, res);
  expect(res.payload).toEqual({ ok: true });
  expect(res.writes).toBe(1);
});

test('a handler that throws still throws (the router\'s own error path answers)', async () => {
  const h = scope.wrap(tb.guard(async () => { throw new Error('boom'); }, { budgetMs: 500 }));
  await expect(h({ query: {}, headers: {} }, recRes())).rejects.toThrow('boom');
});

test('llm.js never budgets a model call past the request deadline: a hanging provider ends at the deadline, not after 50 s', async () => {
  const llmPath = path.join(ROOT, 'api/_shared/llm.js');
  const llm = require(llmPath);
  llm.resetProviderCooldowns();
  const saved = { GROQ_API_KEY: process.env.GROQ_API_KEY, CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY };
  process.env.GROQ_API_KEY = 'gq'; process.env.CEREBRAS_API_KEY = 'cb';
  const realFetch = global.fetch;
  global.fetch = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  try {
    const t0 = Date.now();
    const err = await scope.run({ headers: {} }, async () => {
      tb.setDeadline(Date.now() + 1200);
      return llm({ systemPrompt: 's', userMessage: 'u', overrides: null, timeoutMs: 30000, budgetMs: 50000 }).catch((e) => e);
    });
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(err._budgetExhausted || /budget|timeout/.test(err.message)).toBeTruthy();
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    llm.resetProviderCooldowns();
  }
});

test('the budgets sit inside maxDuration, with room to settle credits and answer', () => {
  const vercel = require(path.join(ROOT, 'vercel.json'));
  for (const fn of ['api/brain.js', 'api/calendar.js']) {
    const max = vercel.functions[fn].maxDuration * 1000;
    const budget = tb.budgetFor(fn);
    expect(budget, fn).toBeLessThanOrEqual(max - 15000);
    expect(budget, fn).toBeGreaterThanOrEqual(max - 30000);
  }
});

/* ── the shipped router, a slow model, the real credit meter ─────────────── */

test.describe('through api/brain.js', () => {
  const A = require('./agents-harness');
  const H = require('./router-harness');
  let w; let tok;
  test.beforeAll(async () => {
    w = await A.world();
    tok = H.jwtShaped('user-tb');
    w.db.addUser(tok, 'user-tb', 'owner@timebudget.example')
      .addWorkspace('ws-tb', 'user-tb', { name: 'Tidewater Mills', slug: 'tidewater-mills', website: 'https://tidewater.example', industry: 'food',
        regions: [{ code: 'IN', name: 'India', currency: 'INR', home: true }] })
      .setActive('user-tb', 'ws-tb').syncIdentityTables();
  });
  test.afterAll(async () => { delete process.env.BRAIN_TIME_BUDGET_MS; if (w) await w.close(); });

  test('a slow model on a metered action: the answer arrives at the budget with a sentence, and the hold is released', async () => {
    w.reset();
    process.env.BRAIN_TIME_BUDGET_MS = '700';
    w.llm.delayMs = 3000;
    const t0 = Date.now();
    const r = await w.request('/api/brain', { query: { action: 'console-chat' }, json: { message: 'What should I send this week?' }, headers: { authorization: 'Bearer ' + tok } });
    const took = Date.now() - t0;
    delete process.env.BRAIN_TIME_BUDGET_MS;
    expect(took).toBeLessThan(2500);
    expect(r.status, r.text).toBe(200);
    expect(r.out).toMatchObject({ ok: false, partial: true, state: 'time_budget_exhausted', action: 'console-chat' });
    expect(r.out.message).toMatch(/Nothing was charged/);
    const holds = w.db.table('credit_ledger').filter((l) => l.user_id === 'user-tb' && l.kind === 'hold');
    expect(holds.length, 'the action is metered').toBe(1);
    const closing = w.db.table('credit_ledger').filter((l) => l.hold_id === holds[0].hold_id && l.kind !== 'hold').map((l) => l.kind);
    expect(closing).toEqual(['release']);
    await sleep(2600);                                    // let the slow call finish; nothing more is written
  });
});
