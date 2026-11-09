// @ts-check
// The copy gets the time it needs (2026-11-09). Production /brain (Nykaa): the team's Opus calls
// answered, then the copy call was given a fixed 20 s, Opus could not write the mail + landing +
// ads JSON in that, and the build shipped template copy. Executed: the shipped previewEntry inside
// a request scope carrying a deadline (time-budget.js), with llm.js swapped for a scripted model
// that records what each call was given.
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LLM_PATH = path.join(ROOT, 'api', '_shared', 'llm.js');
require(LLM_PATH);
const realLlm = require.cache[LLM_PATH].exports;
let calls = [];
require.cache[LLM_PATH].exports = Object.assign(async (o) => { calls.push(Object.assign({ at: Date.now() }, o)); return answer(o); }, realLlm, { keylessOnly: async () => false, platformLean: async () => false });
const PLAN_PATH = path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js');
const realPlan = require.cache[PLAN_PATH];
delete require.cache[PLAN_PATH];
const P = require(PLAN_PATH);
const scope = require(path.join(ROOT, 'api', '_shared', 'request-scope.js'));
const TB = require(path.join(ROOT, 'api', '_shared', 'time-budget.js'));
test.afterAll(() => {
  require.cache[LLM_PATH].exports = realLlm;
  if (realPlan) require.cache[PLAN_PATH] = realPlan; else delete require.cache[PLAN_PATH];
});

const BRAND = { id: 'w-oak-time', name: 'Oak Bakers', industry: 'bakery', website: 'https://oak.example', claims: ['Baked fresh every morning'], palette: { primary: '#C2410C', accent: '#1F5C99', surface: '#FFFFFF', ink: '#222222' }, regions: [{ code: 'IN', currency: 'INR', home: true }] };
let n = 0;
const entry = () => ({ id: `oak-time-${++n}`, date: '2026-11-10', market: 'IN', brand: BRAND, channels: ['email', 'landing_page', 'meta'], cohort: { name: 'Champions' }, objective: 'premium bundle expansion', heroProduct: { title: 'Seeded Rye Loaf' } });
const COPY = { email: { subject: 'Rye baked today', preheader: 'p', hero_headline: 'Rye baked today', intro_paragraph: 'Seeded rye, baked fresh every morning.', body_paragraph: 'b', benefits: [], cta: 'Order now', faq: [] }, landing: { hero_headline: 'Rye baked today', hero_sub: 's', why_bullets: [], faq: [], cta: 'Order now' }, ads: { meta: { primary_text: 'Seeded rye, baked today.', headline: 'Rye baked today', description: 'Order now' }, google: { headlines: ['Seeded rye loaf'], descriptions: ['Seeded rye baked fresh every morning.'] }, tiktok: { script: 's', caption: 'Rye today' } } };
function answer(o) {
  const st = String(o.stage);
  if (st === 'smart-brain-copy') return { text: JSON.stringify(COPY), provider: 'scripted', model: 'm' };
  if (st.startsWith('team-review')) return { text: JSON.stringify({ verdict: 'pass', score: 9, issues: [] }), provider: 'scripted', model: 'm' };
  if (st === 'team-strategy') return { text: JSON.stringify({ angle: 'a', framework: 'PAS', hook_thesis: 'h', target_emotion: 'e', why_now: 'w', primary_kpi: 'k', proof_points: [], differentiator: 'd', dos: [], donts: [] }), provider: 'scripted', model: 'm' };
  if (st === 'team-messaging') return { text: JSON.stringify({ value_proposition: 'v', key_message: 'k', supporting_messages: [], claim_refs: [1], objections: [] }), provider: 'scripted', model: 'm' };
  if (st === 'team-brief') return { text: JSON.stringify({ channel_roles: 'c', email: {}, landing: {}, ads: {} }), provider: 'scripted', model: 'm' };
  return { text: JSON.stringify({ angle: 'a', framework: 'PAS', hook_thesis: 'h', target_emotion: 'e', proof_points: [], differentiator: 'd', dos: [], donts: [] }), provider: 'scripted', model: 'm' };
}
async function build(deadlineMs) {
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error('offline in this test: ' + u); };
  try {
    return await scope.run({ headers: {} }, async () => {
      if (deadlineMs) TB.setDeadline(Date.now() + deadlineMs);
      const r = await P.previewEntry({ entry: entry() });
      return r.campaign;
    });
  } finally { global.fetch = realFetch; }
}
const copyCalls = () => calls.filter((c) => c.stage === 'smart-brain-copy');
test.beforeEach(() => { calls = []; });

test('copyTiming: the copy attempt is sized from the time left, never the old fixed 20 s', () => {
  const full = P.copyTiming(95000);
  expect(full.tier).toBe('premium');
  expect(full.attemptMs).toBe(80000);
  const late = P.copyTiming(47000);
  expect(late.tier, 'too little time for Opus: the standard tier writes it').toBe('standard');
  expect(late.attemptMs).toBe(41000);
  expect(P.copyTiming(9000).skip, 'no time for a model: the template assets are built').toBe(true);
  expect(P.copyTiming(Infinity).attemptMs).toBeGreaterThan(20000);
});

test('with a full request budget the copy is written on the premium tier with the time it needs', async () => {
  test.setTimeout(60000);
  const c = await build(100000);
  const cc = copyCalls();
  expect(cc.length).toBeGreaterThan(0);
  for (const x of cc) {
    expect(x.tier, 'premium copy when the time is there').toBe('premium');
    expect(x.timeoutMs, 'not the old fixed 20 s').toBeGreaterThan(45000);
    expect(x.timeoutMs).toBeLessThanOrEqual(80000);
    expect(x.budgetMs, 'never past the deadline less the render reserve').toBeLessThanOrEqual(94000);
  }
  expect(c.assets.email.subject).toBe('Rye baked today');
});

test('the planning team stops early enough to leave the copy its time', async () => {
  test.setTimeout(60000);
  await build(100000);
  const team = calls.filter((c) => /^team-/.test(String(c.stage)) && c.budgetMs);
  expect(team.length).toBeGreaterThan(0);
  // Every planning call's budget ends before the copy's reserved window (55 s + 6 s before the deadline).
  for (const x of team.filter((c) => !/review-copy/.test(String(c.stage)))) expect(x.budgetMs, x.stage).toBeLessThanOrEqual(100000 - 61000 + 500);
});

test('with less time left the copy starts on the standard tier and still fits the deadline', async () => {
  test.setTimeout(60000);
  const c = await build(45000);
  const cc = copyCalls();
  expect(cc.length).toBeGreaterThan(0);
  for (const x of cc) {
    expect(x.tier).toBe('standard');
    expect(x.timeoutMs).toBeGreaterThan(20000);
    expect(x.timeoutMs).toBeLessThanOrEqual(39000);
  }
  expect(calls.filter((x) => /^team-(strategy|messaging|brief)$/.test(String(x.stage))).length, 'no time for the planning pairs').toBe(0);
  expect(c.assets.email.html).toBeTruthy();
});

test('with no time for a model the template assets are still built, and no model call is made', async () => {
  test.setTimeout(60000);
  const c = await build(9000);
  expect(copyCalls().length).toBe(0);
  expect(c.assets.email.html).toBeTruthy();
  expect(c.assets.landing_pages.length).toBeGreaterThan(0);
});
