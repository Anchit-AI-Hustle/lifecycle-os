// @ts-check
/**
 * The marketing team builds every send (2026-10-26).
 *
 * The operator, with "The Claude B2B Marketing Department" picture (a shared
 * marketing context and ten departments of maker/reviewer pairs): "the best
 * and most accurate output can only be achieved when a team of such agents
 * works together - check if the implementation is like that", then "yes, so
 * then rectify and correct what you should build". A send was one strategy
 * call and one copy call; no reviewer's finding was ever sent back.
 *
 * Executed: the shipped previewEntry with llm.js swapped for a scripted model
 * that answers each team role by its stage and records every prompt; the
 * /marketing-team page in Chromium. Nothing reaches a network.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const H = require('./lib/brand-theme-harness.js');

const ROOT = path.resolve(__dirname, '..');
const LLM_PATH = path.join(ROOT, 'api', '_shared', 'llm.js');
const MT = require(path.join(ROOT, 'api', '_shared', 'marketing-team.js'));

require(LLM_PATH);
const realLlm = require.cache[LLM_PATH].exports;
let calls = [];
let script = null;
let keyless = false;
require.cache[LLM_PATH].exports = Object.assign(async (o) => { calls.push(o); return script(o); }, realLlm, { keylessOnly: async () => keyless });
// smart-brain-plan binds llm.js when it is loaded, and another spec in the same worker may have
// loaded it already: load a fresh copy bound to the scripted model, and put the shared one back after.
const PLAN_PATH = path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js');
const realPlan = require.cache[PLAN_PATH];
delete require.cache[PLAN_PATH];
const P = require(PLAN_PATH);
test.afterAll(() => {
  require.cache[LLM_PATH].exports = realLlm;
  if (realPlan) require.cache[PLAN_PATH] = realPlan; else delete require.cache[PLAN_PATH];
});

const BRAND = { id: 'w-oak-team', name: 'Oak Bakers', industry: 'bakery', website: 'https://oak.example', claims: ['Baked fresh every morning', 'Stone-milled flour'], voice: { tone: 'warm, plain' }, palette: { primary: '#C2410C', accent: '#1F5C99', surface: '#FFFFFF', ink: '#222222' }, regions: [{ code: 'IN', currency: 'INR', home: true }] };
let n = 0;
const entry = () => ({ id: `oak-team-${++n}`, date: '2026-11-05', market: 'IN', brand: BRAND, channels: ['email', 'landing_page', 'meta'], cohort: { name: 'Champions' }, objective: 'premium bundle expansion', heroProduct: { title: 'Seeded Rye Loaf' } });

const COPY = (subject) => ({ email: { subject, subject_alt1: 'a', subject_alt2: 'b', preheader: 'Out of the oven this morning', hook: 'h', hero_headline: 'Rye baked today', intro_paragraph: 'Seeded rye, baked fresh every morning.', body_paragraph: 'Stone-milled flour.', benefits: [], rating: null, reviews: [], badges: [], guarantee: '', ps: 'Baked fresh every morning.', faq: [{ q: 'q', a: 'a' }, { q: 'q2', a: 'a2' }], cta: 'Order now', image_brief: 'a loaf on a board' }, landing: { hero_headline: 'Rye baked today', hero_sub: 'Seeded rye', why_title: 'Why', why_bullets: [], proof_quote: '', proof_author: '', faq: [{ q: 'q', a: 'a' }, { q: 'q2', a: 'a2' }], cta: 'Order now', image_brief: 'b' }, ads: { meta: { primary_text: 'Seeded rye, baked today.', headline: 'Rye baked today', description: 'Order now', image_brief: 'b' }, google: { headlines: ['Seeded rye loaf', 'Baked this morning', 'Oak Bakers rye'], descriptions: ['Seeded rye baked fresh every morning.', 'Order your loaf today.'], image_brief: 'b' }, tiktok: { script: 's', caption: 'Rye today', image_brief: 'b' } } });
const ok = (j) => ({ text: JSON.stringify(j), provider: 'scripted', model: 'm' });
function teamScript({ copyVerdict = 'revise', strategy = true } = {}) {
  let copies = 0;
  return (o) => {
    const st = String(o.stage);
    if (st === 'team-strategy') return ok(strategy ? { angle: 'Fresh rye for the weekend table', framework: 'PAS', hook_thesis: 'They buy rye every week', target_emotion: 'comfort', why_now: 'Weekend baking', primary_kpi: 'click rate', proof_points: ['Baked fresh every morning'], differentiator: 'seeded', dos: ['name the loaf'], donts: ['no discount'] } : { nonsense: true });
    if (st === 'team-messaging') return ok({ value_proposition: 'Bread baked this morning', key_message: 'KEY-MESSAGE-RYE-TODAY', supporting_messages: ['Stone-milled flour'], claim_refs: [1, 2], objections: [{ objection: 'Is it fresh?', answer: 'Baked fresh every morning' }] });
    if (st === 'team-brief') return ok({ channel_roles: 'CHANNEL-ROLES-MAIL-INVITES', email: { hook: 'h', must_say: 'm', structure: 's', visual: 'v' }, landing: { hook: 'h', must_say: 'm', structure: 's', visual: 'v' }, ads: { hook: 'h', must_say: 'm', visual: 'v', placements: 'p' } });
    if (st === 'team-review-copy') return ok(copyVerdict === 'revise' ? { verdict: 'revise', score: 5, issues: [{ field: 'email.subject', problem: 'GENERIC-SUBJECT-PROBLEM', fix: 'name the loaf' }] } : { verdict: 'pass', score: 9, issues: [] });
    if (st.startsWith('team-review')) return ok({ verdict: 'pass', score: 8, issues: [] });
    if (st === 'smart-brain-strategy') return ok({ angle: 'Old single strategist', framework: 'PAS', hook_thesis: 'h', target_emotion: 'e', proof_points: [], differentiator: 'd', dos: ['x'], donts: ['y'] });
    if (st === 'smart-brain-copy') {
      copies++;
      const rewrite = /GENERIC-SUBJECT-PROBLEM/.test(o.userMessage);
      return ok(COPY(rewrite ? 'Seeded Rye Loaf, rewritten' : `First draft ${copies}`));
    }
    throw new Error('the scripted model has no answer for ' + st);
  };
}
const byStage = (st) => calls.filter((c) => c.stage === st);
async function build(env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error('offline in this test: ' + u); };
  try { const r = await P.previewEntry({ entry: entry() }); return r.campaign; } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
test.beforeEach(() => { calls = []; keyless = false; });

test('a send is made by the team: a shared context, maker/reviewer pairs, and copy sent back once', async () => {
  test.setTimeout(120000);
  script = teamScript({ copyVerdict: 'revise' });
  const c = await build();
  // Every role ran, in its order: strategy and messaging side by side, then the brief, then copy.
  const order = calls.map((x) => x.stage);
  for (const st of ['team-strategy', 'team-messaging', 'team-review-strategy', 'team-review-messaging', 'team-brief', 'team-review-brief', 'team-review-copy']) expect(order, st).toContain(st);
  expect(order.indexOf('team-brief')).toBeGreaterThan(Math.max(order.indexOf('team-review-strategy'), order.indexOf('team-review-messaging')));
  expect(order.indexOf('team-review-copy')).toBeGreaterThan(order.indexOf('smart-brain-copy'));
  expect(byStage('smart-brain-strategy').length, 'the single strategist is replaced by the pair').toBe(0);
  // One shared context, the same text, read by every agent.
  const teamCalls = calls.filter((x) => /^team-/.test(String(x.stage)));
  const ctxOf = (m) => m.slice(m.indexOf('SHARED MARKETING CONTEXT'), m.indexOf('EVIDENCE'));
  expect(new Set(teamCalls.map((x) => ctxOf(x.userMessage))).size, 'every agent reads the same context').toBe(1);
  for (const x of teamCalls) {
    for (const part of ['COMPANY', 'CUSTOMERS', 'OFFER', 'BRAND', 'GOALS', 'EVIDENCE']) expect(x.userMessage, `${x.stage}: ${part}`).toContain(part);
    expect(x.userMessage).toContain('Oak Bakers');
    expect(x.userMessage, 'the claims are numbered for the messaging architect').toContain('1. Baked fresh every morning');
    expect(x.userMessage, 'every prompt ends with its output requirement').toMatch(/OUTPUT REQUIREMENT/);
  }
  // The brief reads strategy and messaging; the copywriters read all three.
  expect(byStage('team-brief')[0].userMessage).toContain('KEY-MESSAGE-RYE-TODAY');
  const firstDrafts = byStage('smart-brain-copy').filter((x) => !/GENERIC-SUBJECT-PROBLEM/.test(x.userMessage));
  expect(firstDrafts.length).toBe(2);
  for (const x of firstDrafts) {
    expect(x.userMessage).toContain('KEY-MESSAGE-RYE-TODAY');
    expect(x.userMessage).toContain('CHANNEL-ROLES-MAIL-INVITES');
    expect(x.userMessage).toContain('Fresh rye for the weekend table');
  }
  // The reviewer sent the copy back: each direction rewritten ONCE, with the reason, and the rewrite shipped.
  const rewrites = byStage('smart-brain-copy').filter((x) => /GENERIC-SUBJECT-PROBLEM/.test(x.userMessage));
  expect(rewrites.length).toBe(2);
  for (const x of rewrites) expect(x.budgetMs, 'a rewrite is bounded by the time left in the review window (Codex #370)').toBeGreaterThan(5000);
  for (const x of rewrites) expect(x.budgetMs).toBeLessThanOrEqual(100000);
  expect(byStage('team-review-copy').length, 'no second round').toBe(2);
  expect(c.assets.email.subject).toBe('Seeded Rye Loaf, rewritten');
  // Recorded for /brain: who made what, and every verdict.
  expect(c.team.messaging.key_message).toBe('KEY-MESSAGE-RYE-TODAY');
  expect(c.team.strategy.angle).toBe('Fresh rye for the weekend table');
  const roles = c.team.members.map((m) => `${m.role}/${m.kind}`);
  for (const r of ['Marketing Strategist/maker', 'Marketing Priorities Reviewer/reviewer', 'Messaging Architect/maker', 'Objection & Message Consistency Reviewer/reviewer', 'Creative Brief Writer/maker', 'Brief Reviewer/reviewer', 'Content Quality Reviewer/reviewer', 'Campaign Copywriter/maker']) expect(roles).toContain(r);
  expect(c.team.verdicts.copy.every((v) => v.verdict === 'revise')).toBe(true);
  expect(Object.keys(c.team.context)).toEqual(['company', 'customers', 'offer', 'brand', 'goals', 'evidence']);
});

test('every team call is routed on the workspace that pays for it (Codex #370)', async () => {
  test.setTimeout(120000);
  script = teamScript({ copyVerdict: 'revise' });
  const MR_PATH = path.join(ROOT, 'api', '_shared', 'model-router.js');
  require(MR_PATH);
  const realRoute = require.cache[MR_PATH].exports.route;
  const routed = [];
  require.cache[MR_PATH].exports.route = async (o) => { routed.push(o); return { allowed: true, tier: o.requested, reason: 'test' }; };
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error('offline in this test: ' + u); };
  try {
    // The workspace is on the build's config only, not on the slot.
    await P.buildCampaign(entry(), require(path.join(ROOT, 'lib', 'smart-brain', 'services.js')).smartConfig({ workspace_id: 'ws-oak-pays' }), { withCreatives: false });
  } finally { global.fetch = realFetch; require.cache[MR_PATH].exports.route = realRoute; }
  const team = routed.filter((o) => /^team-/.test(String(o.stage)));
  expect(team.length, 'the team ran through the router').toBeGreaterThan(3);
  for (const o of team) expect(o.workspaceId, o.stage).toBe('ws-oak-pays');
  // ...and priced, so a low balance downgrades a team call's tier (an unpriced key costs nothing to the router).
  const MR = require(MR_PATH);
  for (const o of team) expect(MR.costFor(o.featureKey), `${o.stage} is priced`).toBeGreaterThan(0);
  const copy = routed.filter((o) => o.stage === 'smart-brain-copy');
  expect(copy.length, 'two drafts and two rewrites').toBe(4);
  for (const o of copy) expect(o.workspaceId, 'the copywriters and their rewrites too').toBe('ws-oak-pays');
});

test('the brief reviewer reads the strategy and message the brief was made from; a one-channel brief is not accepted (Codex #370)', async () => {
  test.setTimeout(120000);
  const base = teamScript({ copyVerdict: 'pass' });
  script = base;
  await build();
  const rb = byStage('team-review-brief');
  expect(rb.length).toBe(1);
  expect(rb[0].userMessage, 'the reviewer can compare the brief with the key message').toContain('KEY-MESSAGE-RYE-TODAY');
  expect(rb[0].userMessage).toContain('Fresh rye for the weekend table');
  // A brief that covers one channel (or carries a string for one) is the wrong shape.
  calls = [];
  script = (o) => o.stage === 'team-brief' ? ok({ channel_roles: 'x', email: { hook: 'h' }, landing: 'see email', ads: null }) : base(o);
  const c = await build();
  const briefMaker = c.team.members.filter((m) => m.role === 'Creative Brief Writer');
  expect(briefMaker.length).toBeGreaterThan(0);
  expect(briefMaker.every((m) => !m.ok), 'the partial brief is recorded as failed').toBe(true);
  expect(byStage('team-review-brief').length, 'a rejected brief is not reviewed').toBe(0);
  for (const x of byStage('smart-brain-copy')) expect(x.userMessage).not.toContain('see email');
});

test('the shared context states the offer as the planner meant it: a fraction or a whole percentage (Codex #370)', async () => {
  test.setTimeout(120000);
  script = teamScript({ copyVerdict: 'pass' });
  for (const [pct, said] of [[0.15, '15% off'], [15, '15% off'], [0, null]]) {
    calls = [];
    const realFetch = global.fetch;
    global.fetch = async (u) => { throw new Error('offline in this test: ' + u); };
    try { await P.previewEntry({ entry: Object.assign(entry(), { offer: { label: 'Weekend rye', pct } }) }); } finally { global.fetch = realFetch; }
    const m = byStage('team-strategy')[0].userMessage;
    if (said) expect(m, `pct ${pct}`).toContain(said);
    expect(m, `pct ${pct}`).not.toMatch(/1500%|0% off/);
  }
});

test('a team answer with a field of the wrong type is not accepted; two rewrites are staggered (Codex #370)', async () => {
  test.setTimeout(120000);
  const base = teamScript({ copyVerdict: 'revise' });
  const at = [];
  script = (o) => {
    if (o.stage === 'team-strategy') return ok({ angle: 'A string where a list belongs', framework: 'PAS', hook_thesis: 'h', target_emotion: 'e', why_now: 'w', primary_kpi: 'k', proof_points: [], differentiator: 'd', dos: 'name the loaf', donts: ['x'] });
    if (o.stage === 'smart-brain-copy' && /GENERIC-SUBJECT-PROBLEM/.test(o.userMessage)) at.push(Date.now());
    return base(o);
  };
  const c = await build();
  const strat = c.team.members.filter((m) => m.role === 'Marketing Strategist');
  expect(strat.every((m) => !m.ok), 'dos as a string is the wrong shape').toBe(true);
  expect(c.team.strategy).toBeFalsy();
  expect(byStage('smart-brain-strategy').length, 'the single strategist fills in').toBe(1);
  expect(c.assets.email.subject).toBe('Seeded Rye Loaf, rewritten');
  expect(at.length).toBe(2);
  expect(Math.abs(at[1] - at[0]), 'the second rewrite waits its turn').toBeGreaterThanOrEqual(500);
});

test('a malformed review is not a pass; an incomplete brief is not accepted; the copy reviewer reads the whole draft; the offer is said once, as a percentage (Codex #370)', async () => {
  test.setTimeout(120000);
  const base = teamScript({ copyVerdict: 'pass' });
  // A reviewer that says "revise" with no reasons is recorded failed and nothing is rewritten.
  script = (o) => o.stage === 'team-review-strategy' ? ok({ verdict: 'revise', score: 4 }) : base(o);
  let c = await build();
  const pr = c.team.members.find((m) => m.role === 'Marketing Priorities Reviewer');
  expect(pr.ok).toBe(false);
  expect(byStage('team-strategy').length, 'no rewrite on a malformed review').toBe(1);
  // A brief whose channels carry only a hook is not accepted.
  calls = [];
  script = (o) => o.stage === 'team-brief' ? ok({ channel_roles: 'x', email: { hook: 'h' }, landing: { hook: 'h' }, ads: { hook: 'h' } }) : base(o);
  c = await build();
  expect(c.team.members.filter((m) => m.role === 'Creative Brief Writer').every((m) => !m.ok)).toBe(true);
  // A long draft reaches the copy reviewer whole, ads included; the offer is 15% off, never 0.15%.
  calls = [];
  script = (o) => {
    if (o.stage === 'smart-brain-copy') { const j = COPY('Long draft'); j.email.body_paragraph = 'Stone-milled flour. '.repeat(600); j.ads.tiktok.caption = 'ADS-TAIL-MARK'; return ok(j); }
    return base(o);
  };
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error('offline in this test: ' + u); };
  try { await P.previewEntry({ entry: Object.assign(entry(), { offer: { label: 'Weekend rye', pct: 0.15 } }) }); } finally { global.fetch = realFetch; }
  const rc = byStage('team-review-copy');
  expect(rc.length).toBeGreaterThan(0);
  for (const x of rc) expect(x.userMessage, 'the reviewer sees the ads at the end of a long draft').toContain('ADS-TAIL-MARK');
  for (const x of calls.filter((y) => /^team-|smart-brain-copy/.test(String(y.stage)))) {
    expect(x.userMessage, x.stage).not.toMatch(/0\.15%/);
  }
  expect(byStage('smart-brain-copy')[0].userMessage).toContain('15% off');
});

test('a slow model does not carry the team past its deadline: the tier ladder stops with the budget (Codex #370)', async () => {
  test.setTimeout(120000);
  const base = teamScript({ copyVerdict: 'pass' });
  // Every tier of the strategist hangs 1.5 s then fails; with 2.5 s for the plan, the ladder of three tiers must stop.
  script = async (o) => {
    if (o.stage === 'team-strategy' || o.stage === 'team-messaging') { await new Promise((r) => setTimeout(r, 1500)); throw new Error('provider too slow'); }
    return base(o);
  };
  const t0 = Date.now();
  await build({ TEAM_PLAN_MS: '2500' });
  for (const st of ['team-strategy', 'team-messaging']) {
    const xs = byStage(st);
    expect(xs.length, `${st}: the ladder stopped at the deadline`).toBeLessThanOrEqual(2);
    for (const x of xs) expect(x.budgetMs, `${st} carries the time it has left`).toBeLessThanOrEqual(2500);
  }
  expect(byStage('smart-brain-strategy').length, 'the single strategist fills in').toBe(1);
  expect(Date.now() - t0).toBeLessThan(60000);
});

test('a balance lookup that never answers does not hold the team past its deadline; an offer on the decision is the one every reader sees (Codex #370)', async () => {
  test.setTimeout(120000);
  script = teamScript({ copyVerdict: 'pass' });
  const MR_PATH = path.join(ROOT, 'api', '_shared', 'model-router.js');
  require(MR_PATH);
  const realRoute = require.cache[MR_PATH].exports.route;
  // The team's routing hangs (a stalled credit_wallets read); every other call routes at once.
  require.cache[MR_PATH].exports.route = (o) => (/^team-/.test(String(o.stage)) ? new Promise(() => {}) : Promise.resolve({ allowed: true, tier: o.requested, reason: 'test' }));
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error('offline in this test: ' + u); };
  const t0 = Date.now();
  try {
    await P.previewEntry({ entry: Object.assign(entry(), { decision: { offer: { label: 'Weekend rye', pct: 0.2 } } }) });
  } finally { global.fetch = realFetch; require.cache[MR_PATH].exports.route = realRoute; }
  expect(byStage('team-strategy').length, 'the team called its model once routing gave up').toBeGreaterThan(0);
  expect(Date.now() - t0, 'the plan did not wait on the stalled lookup').toBeLessThan(60000);
  const copy = byStage('smart-brain-copy')[0].userMessage;
  expect(copy, 'the offer on the decision reaches the product facts').toContain('20% off');
  expect(copy).not.toMatch(/OFFER: none on record/);
});

test('a reviewer that passes the copy sends nothing back', async () => {
  test.setTimeout(120000);
  script = teamScript({ copyVerdict: 'pass' });
  const c = await build();
  expect(byStage('smart-brain-copy').length).toBe(2);
  expect(c.assets.email.subject).toMatch(/^First draft/);
  expect(c.team.members.filter((m) => m.kind === 'maker' && m.revision).length).toBe(0);
});

test('a reviewer that sends a strategy back gets one rewrite with its reasons, never a loop', async () => {
  test.setTimeout(120000);
  const base = teamScript({ copyVerdict: 'pass' });
  script = (o) => (o.stage === 'team-review-strategy'
    ? ok({ verdict: 'revise', score: 4, issues: [{ field: 'primary_kpi', problem: 'KPI-NOT-MEASURABLE', fix: 'name a rate' }] })
    : base(o));
  const c = await build();
  const strat = byStage('team-strategy');
  expect(strat.length).toBe(2);
  expect(strat[1].userMessage).toContain('KPI-NOT-MEASURABLE');
  expect(byStage('team-review-strategy').length).toBe(1);
  expect(c.team.members.find((m) => m.role === 'Marketing Strategist' && m.revision)).toBeTruthy();
});

test('a maker that answers nonsense is recorded, and the send still gets a strategy', async () => {
  test.setTimeout(120000);
  script = teamScript({ copyVerdict: 'pass', strategy: false });
  const c = await build();
  const s = c.team.members.find((m) => m.role === 'Marketing Strategist');
  expect(s.ok).toBe(false);
  expect(byStage('smart-brain-strategy').length, 'the single strategist fills in').toBe(1);
  expect(byStage('smart-brain-copy')[0].userMessage).toContain('Old single strategist');
  expect(c.assets.email.subject).toMatch(/^First draft/);
});

test('no team on the keyless floor or when switched off: the build is as before', async () => {
  test.setTimeout(120000);
  script = teamScript();
  keyless = true;
  await build();
  expect(calls.filter((x) => /^team-/.test(String(x.stage))).length).toBe(0);
  keyless = false; calls = [];
  const c = await build({ MARKETING_TEAM: 'off' });
  expect(calls.filter((x) => /^team-/.test(String(x.stage))).length).toBe(0);
  expect(byStage('smart-brain-strategy').length).toBe(1);
  expect(c.team).toBeUndefined();
});

test('the team keeps inside the build\'s time: with no time left the brief and the copy review are skipped, not waited for', async () => {
  test.setTimeout(120000);
  script = teamScript();
  const c = await build({ TEAM_PLAN_MS: '1', TEAM_REVIEW_BY_MS: '1' });
  expect(byStage('team-brief').length).toBe(0);
  expect(byStage('team-review-copy').length).toBe(0);
  expect(c.assets.email.subject).toMatch(/^First draft/);
});

/* ── the roster: every role of the picture, and what does it here ─────── */
const PICTURE = {
  'Strategy & Planning': ['Marketing Strategist', 'Quarterly Planning Lead', 'Budget Allocation Planner', 'Go-to-Market Planner', 'Marketing Priorities Reviewer'],
  'Customer & Market Intelligence': ['Customer Interview Analyst', 'Market Research Analyst', 'Competitor Intelligence Analyst', 'Customer Proof Auditor', 'Win-Loss Researcher'],
  'Segments & Buying Journeys': ['Segmentation Strategist', 'ICP Definition Lead', 'Buying Group Mapper', 'Buyer Journey Designer', 'Buying Situation Analyst'],
  'Positioning & Messaging': ['Positioning Strategist', 'Value Proposition Designer', 'Messaging Architect', 'Objection Narrative Lead', 'Message Consistency Reviewer'],
  'Content & Creative': ['Content Strategist', 'Editorial Planning Lead', 'Creative Brief Writer', 'Campaign Copywriter', 'Content Quality Reviewer'],
  'Campaigns & Distribution': ['Campaign Planner', 'Channel Mix Strategist', 'Distribution Coordinator', 'Paid Media Brief Writer', 'Partner Campaign Planner'],
  'Search & Demand Capture': ['Search Demand Analyst', 'Keyword Intent Mapper', 'SEO Content Planner', 'Technical SEO Reviewer', 'Demand Capture Strategist'],
  'Website & Lifecycle Conversion': ['Landing Page Reviewer', 'Conversion Copywriter', 'Form Friction Analyst', 'Lifecycle Journey Planner', 'Email Nurture Designer'],
  'Marketing Ops & Sales Alignment': ['Marketing Operations Planner', 'Lead Routing Designer', 'CRM Data Quality Reviewer', 'Sales Handoff Coordinator', 'Sales Enablement Brief Writer'],
  'Measurement & Experimentation': ['Funnel Performance Analyst', 'Campaign Measurement Lead', 'Attribution Evidence Reviewer', 'Experiment Designer', 'Learning Review Facilitator'],
};
test('every role of the picture is on the roster, and each says truly what does it', () => {
  expect(MT.ROSTER.map((d) => d.department)).toEqual(Object.keys(PICTURE));
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const routed = new Set([...(v.rewrites || []), ...(v.redirects || [])].map((r) => r.source));
  const pairs = new Set(['strategy', 'messaging', 'brief', 'copy']);
  for (const d of MT.ROSTER) {
    expect(d.roles.map((r) => r[0]), d.department).toEqual(PICTURE[d.department]);
    for (const [role, x] of d.roles) {
      expect(['agent', 'code', 'feature', 'skill', 'none'], role).toContain(x.by);
      if (x.by === 'agent') expect(pairs.has(x.pair), `${role}: a pair the team runs`).toBe(true);
      if (x.by === 'code' || x.by === 'skill') expect(fs.existsSync(path.join(ROOT, x.where)), `${role}: ${x.where}`).toBe(true);
      if (x.by === 'feature') { const p = x.where.replace(/[?#].*$/, ''); expect(routed.has(p) || fs.existsSync(path.join(ROOT, p.slice(1))), `${role}: ${p}`).toBe(true); }
      if (x.by !== 'agent') expect(String(x.note || '').length, `${role}: says why`).toBeGreaterThan(10);
    }
  }
  // Every reviewer and maker the team records is a role on the roster.
  const agents = MT.ROSTER.flatMap((d) => d.roles.filter((r) => r[1].by === 'agent').map((r) => r[0]));
  for (const r of ['Marketing Strategist', 'Marketing Priorities Reviewer', 'Messaging Architect', 'Creative Brief Writer', 'Campaign Copywriter', 'Content Quality Reviewer']) expect(agents).toContain(r);
});

const NAME = H.define('marketing-agents-roster', {
  name: 'Brambleweld Larder', slug: 'brambleweld-larder', website: 'https://brambleweld.example',
  palette: { primary: '#2f5d50', accent: '#c9822b', ink: '#1d1d1b', surface: '#ffffff' },
  regions: [{ code: 'UK', currency: 'GBP', home: true }],
});
for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`/marketing-team#roster at ${vp.width}: every role, what does it, nothing wider than the screen`, async ({ page }) => {
    await page.setViewportSize(vp);
    const errors = []; page.on('pageerror', (e) => errors.push(String(e.message)));
    await H.install(page, NAME);
    await H.open(page, 'marketing-team.html#roster', NAME);
    await expect(page.locator('[data-panel="team"]')).toBeVisible();
    await expect(page.locator('[data-role]')).toHaveCount(50);
    await expect(page.locator('[data-roster-dept]')).toHaveCount(10);
    await expect(page.locator('[data-role="Messaging Architect"] .chip.agent')).toHaveText('Agent, every send');
    await expect(page.locator('[data-role="Lead Routing Designer"] .gap')).toContainText('B2B');
    await expect(page.locator('#rosterSummary')).toContainText('50');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

test('/brain shows the team that made the send: each agent, each verdict, what was sent back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await H.install(page, NAME);
  await H.open(page, 'smart-brain.html', NAME);
  await page.waitForFunction(() => typeof window.teamHTML === 'function');
  const team = {
    strategy: { angle: 'Fresh rye for the weekend table', why_now: 'Weekend baking', primary_kpi: 'click rate' },
    messaging: { key_message: 'Rye baked today', value_proposition: 'Bread baked this morning', objections: [{ objection: 'Is it fresh?', answer: 'Baked fresh every morning' }] },
    briefs: { channel_roles: 'mail invites, page sells' },
    members: [
      { department: 'Strategy & Planning', role: 'Marketing Strategist', kind: 'maker', ok: true },
      { department: 'Strategy & Planning', role: 'Marketing Priorities Reviewer', kind: 'reviewer', ok: true, verdict: 'pass', score: 8, issues: [] },
      { department: 'Content & Creative', role: 'Content Quality Reviewer', kind: 'reviewer', ok: true, verdict: 'revise', score: 5, direction: 'A', issues: [{ field: 'email.subject', problem: 'generic', fix: 'name the loaf' }] },
      { department: 'Content & Creative', role: 'Campaign Copywriter', kind: 'maker', ok: true, revision: true, direction: 'A' },
    ],
  };
  await page.evaluate((t) => { const d = document.createElement('div'); d.id = 'teamProbe'; d.innerHTML = window.teamHTML({ team: t }); document.body.appendChild(d); d.querySelector('details').open = true; }, team);
  const probe = page.locator('#teamProbe');
  await expect(probe.locator('summary')).toContainText('4 agent steps, 1 sent back by a reviewer');
  await expect(probe.locator('[data-team-member]')).toHaveCount(4);
  await expect(probe.locator('[data-team-member][data-state="revise"]')).toContainText('email.subject: generic');
  await expect(probe.locator('[data-team-member][data-state="revise"]')).toContainText('name the loaf');
  await expect(probe).toContainText('Key message: Rye baked today');
  await expect(probe).toContainText('Is it fresh? → Baked fresh every morning');
  expect(await page.evaluate(() => window.teamHTML({}) === '' && window.teamHTML({ team: { members: [] } }) === '')).toBe(true);
});
