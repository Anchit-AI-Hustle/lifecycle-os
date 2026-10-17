// The brand guard: a model's copy is used only when it follows the brand's
// rules, whichever model wrote it (2026-10-17).
//
// The operator, after the free keyless model was added to every chain: "it must
// always ensure it only follows the brand guidelines". Every model was briefed
// with the brand's rules, but nothing rejected an answer that broke them: an
// invented customer count, an unapproved claim, another company's name (the
// benchmark brief names its exemplars now). Each customer-facing writer checks
// the answer and falls back to its code-written assets, which say only what the
// brand's own record states; the operator-facing generator reports the breach.
//
// Executed: the guard itself, then Smart Brain, the pipeline stages, the
// trigger mailer and the social posts through their shipped code, with a
// scripted model answering off-brand copy.
//
// Run: npx playwright test tests/brand-guard.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const guard = require(path.join(ROOT, 'api', '_shared', 'brand-guard.js'));

const NEWS = {
  id: 'device:gazette', slug: 'gazette', name: 'Ledgerline Gazette', website: 'https://ledgerline.example', industry: 'news publishing',
  tagline: 'Pune news, checked twice by the desk', palette: { primary: '#7B2D5E', accent: '#C8A13B', ink: '#2A1F33', surface: '#FBF7EF' },
  regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ['Reporters in all 14 Pune wards'],
  voice: { banned: ['game-changer'] }, legal_entity: 'Ledgerline Media LLP, Pune, India',
};
const OFF = 'Join 2 million readers who start the day like Morning Brew readers do.';
const ON = 'Pune news, checked twice by the desk. Reporters in all 14 Pune wards.';

test('the guard: an invented figure, another company or a banned phrase breaks the rules; the brand\'s own words do not', () => {
  const bad = guard.check({ email: { subject: 'Your morning', body_paragraph: OFF } }, NEWS, { market: 'IN' });
  expect(bad.ok).toBe(false);
  const kinds = bad.violations.map((v) => v.kind);
  expect(kinds).toContain('other_brand');
  expect(kinds).toContain('compliance');
  expect(guard.check('A game-changer for Pune.', NEWS, { market: 'IN' }).ok).toBe(false);
  expect(guard.check('Built like KNICKGASM sneakers.', NEWS, { market: 'IN' }).violations.map((v) => v.detail).join(' ')).toMatch(/KNICKGASM/);
  expect(guard.check({ email: { subject: 'Pune, before breakfast', body_paragraph: ON, cta: 'Start reading' } }, NEWS, { market: 'IN' }).ok).toBe(true);
  // An image brief is not copy; the send's own products may be named.
  expect(guard.check({ email: { body_paragraph: ON, image_brief: 'like a Morning Brew flat lay' } }, NEWS, { market: 'IN' }).ok).toBe(true);
  expect(guard.check('Custom Nike AF1, painted by hand.', { name: 'Shoeco' }, { allow: ['Custom Nike AF1'] }).ok).toBe(true);
  expect(guard.check('Like Nike, but hand painted.', { name: 'Shoeco' }).ok).toBe(false);
});

// ── Smart Brain, with a scripted model ───────────────────────────────────────
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
const slot = () => ({
  id: 'guard-1', date: '2026-10-20', market: 'IN', objective: 'reactivation', brand: NEWS,
  cohort: { name: 'At Risk', size: 1200, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
  confidence: 0.6, offer: { depth: 'none', pct: 0 },
});
const copyWith = (body) => ({
  email: { subject: 'Pune, before breakfast', preheader: 'Today in your ward', hook: 'h', hero_headline: 'Your ward, today', intro_paragraph: 'Intro.', body_paragraph: body, benefits: ['One', 'Two', 'Three'], rating: null, reviews: [], badges: [], guarantee: '', ps: 'Start with your ward.', faq: [], cta: 'Start reading', image_brief: 'x' },
  landing: { hero_headline: 'Your ward, today', hero_sub: 'Sub', why_title: 'Why', why_bullets: ['A', 'B', 'C'], proof_quote: '', proof_author: '', faq: [], cta: 'Start reading', image_brief: 'y' },
  ads: { meta: { primary_text: 'Pune, before breakfast', headline: 'Your ward', description: 'd', image_brief: 'z' }, google: { headlines: ['One', 'Two', 'Three'], descriptions: ['First description here.', 'Second description here.'], image_brief: 'w' }, tiktok: { script: 's', caption: 'c', image_brief: 'v' } },
});
async function build(answers) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const realLlm = require.cache[LLM]; const realPlan = require.cache[PLAN];
  let n = 0;
  try {
    const real = require(LLM);
    const stub = async (o) => {
      if (/strategy/.test(String(o.stage || ''))) return { text: JSON.stringify({ angle: 'a', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] }), provider: 'scripted', model: 'm' };
      const body = answers[Math.min(n, answers.length - 1)]; n += 1;
      return { text: JSON.stringify(copyWith(body)), provider: 'scripted', model: 'm' };
    };
    Object.assign(stub, real);
    require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
    delete require.cache[PLAN];
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return await require(PLAN).buildCampaign(slot(), smartConfig({}), { noLLM: false, withCreatives: false });
  } finally {
    require.cache[LLM] = realLlm; if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN];
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
// What a customer sees: every asset with its PROMPTS left out (a saved prompt
// for another tool names the benchmark's exemplars as context, by design).
const copyOf = (v) => JSON.stringify(v, (k, x) => (/prompt|brand_guard/i.test(k) ? undefined : x));
const assetText = (c) => copyOf(c.assets);

test('Smart Brain: off-brand copy from the model is never used; both directions off means the template assets', async () => {
  const c = await build([OFF, OFF]);
  expect(c.copywriter.provider).toBe('template-fallback');
  expect(c.brand_guard && c.brand_guard.rejected.map((r) => r.direction).sort()).toEqual(['A', 'B']);
  expect(assetText(c)).not.toMatch(/2 million|Morning Brew/);
  expect(c.agent_trace.some((t) => t.agent === 'Brand Guard')).toBe(true);
});

test('Smart Brain: one direction off-brand takes the other\'s copy; the model\'s good answer is kept', async () => {
  // Either direction may be the one that breaks the rules (A is written first).
  for (const [answers, bad] of [[[ON, OFF], 'B'], [[OFF, ON], 'A']]) {
    const c = await build(answers);
    expect(c.copywriter.provider).toBe('scripted');
    expect(c.brand_guard.rejected.map((r) => r.direction)).toEqual([bad]);
    expect(assetText(c), `direction ${bad} off-brand`).not.toMatch(/2 million|Morning Brew/);
    expect(assetText(c)).toContain('Reporters in all 14 Pune wards');
  }
  const clean = await build([ON, ON]);
  expect(clean.brand_guard).toBeUndefined();
});

// ── The trigger mailer ──────────────────────────────────────────────────────
test('the trigger mailer uses the brand\'s own words when the model\'s copy is off-brand', async () => {
  const CT = require.resolve(path.join(ROOT, 'api', '_shared', 'calendar-trigger.js'));
  const CI = require.resolve(path.join(ROOT, 'api', '_shared', 'creative-image.js'));
  const rt = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
  const saved = { llm: require.cache[LLM], ci: require.cache[CI], ct: require.cache[CT], resolve: rt.resolve };
  const run = async (body) => {
    const real = require(LLM);
    const stub = async () => ({ text: JSON.stringify({ subject_line: 'Your ward today', preview_text: 'p', hero_headline: 'Pune, before breakfast', hero_subline: 's', body_blocks: [{ heading: 'H', body }], cta_text: 'Start reading', subject_alternatives: ['a', 'b'] }), provider: 'scripted', model: 'm' });
    Object.assign(stub, real);
    require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
    require.cache[CI] = { id: CI, filename: CI, loaded: true, exports: { generateCreativeImage: async () => null, uploadCreative: async () => null, hostedUrl: async () => null } };
    delete require.cache[CT];
    rt.resolve = async () => NEWS;
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
    await require(CT)({ method: 'POST', headers: {}, body: { entry: { date: '2026-10-20', market: 'IN', segment: 'At Risk', content_type: 'promo', archetype: 'hero-led-editorial' } } }, res);
    return res;
  };
  try {
    const off = await run(OFF);
    expect(off.body.strategy_heuristic).toBe(true);
    expect(copyOf(off.body.variants)).not.toMatch(/2 million|Morning Brew/);
    const on = await run(ON);
    expect(on.body.strategy_heuristic, 'the model\'s clean copy is used').toBeFalsy();
    expect(copyOf(on.body.variants)).toContain('Reporters in all 14 Pune wards');
  } finally {
    rt.resolve = saved.resolve;
    require.cache[LLM] = saved.llm;
    if (saved.ci) require.cache[CI] = saved.ci; else delete require.cache[CI];
    if (saved.ct) require.cache[CT] = saved.ct; else delete require.cache[CT];
  }
});

// ── Social posts ────────────────────────────────────────────────────────────
test('a social post that breaks the brand\'s rules is replaced by that platform\'s own post; a clean one is kept', async () => {
  const SC = require.resolve(path.join(ROOT, 'api', '_shared', 'social-core.js'));
  const realLlm = require.cache[LLM]; const realSc = require.cache[SC];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const real = require(LLM);
  const stub = async (o) => {
    if (o.stage === 'social-content') {
      return { text: JSON.stringify({ posts: {
        instagram_feed: { caption: OFF, hook: 'h', hashtags: ['#Pune'], alt_text: 'a' },
        x: { caption: ON, hook: 'h', hashtags: ['#Pune'], alt_text: 'a' },
      } }), provider: 'scripted', model: 'm' };
    }
    throw new Error('not scripted for ' + o.stage);
  };
  Object.assign(stub, real);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
  delete require.cache[SC];
  try {
    const out = await require(SC).runDaily({ brand: NEWS, dry_run: true, date: '2026-10-20', platforms: ['instagram_feed', 'x'] });
    const feed = out.posts.find((p) => p.key === 'instagram_feed');
    const x = out.posts.find((p) => p.key === 'x');
    expect(feed, 'the feed post was built').toBeTruthy();
    expect(copyOf(feed)).not.toMatch(/2 million|Morning Brew/);
    // Replaced by the platform's own post, with what it broke recorded beside it.
    expect(feed.copy.brand_guard.join(' ')).toMatch(/Morning Brew/);
    expect(feed.copy.caption).toContain('Pune news, checked twice by the desk');
    // The clean post is the model's own.
    expect(x.copy.caption).toContain('Reporters in all 14 Pune wards');
    expect(x.copy.brand_guard).toBeUndefined();
  } finally {
    require.cache[LLM] = realLlm; if (realSc) require.cache[SC] = realSc; else delete require.cache[SC];
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

// ── generate.js (the Studio, ad and landing-page builders) ──────────────────
// Its answers go to the operator to edit, and it has no code-written version
// to fall back to, so the guard's verdict travels WITH the answer. With no key
// at all, the free keyless model answers: the route's own "no provider" refusal
// used to stop it before the model chain was ever asked.
test('generate.js answers with no key when the free model is on, and an off-brand answer carries what it broke', async () => {
  const GEN = require.resolve(path.join(ROOT, 'api', 'ai', 'generate.js'));
  const ENVK = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'CRON_SECRET', 'FREE_GENERATION', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];
  const saved = {}; for (const k of ENVK) { saved[k] = process.env[k]; delete process.env[k]; }
  const realLlm = require.cache[LLM]; const realGen = require.cache[GEN];
  const call = async (headline) => {
    const real = require(LLM);
    const stub = async () => ({ text: JSON.stringify({ concepts: [{ name: 'A', headline, angle: 'x' }] }), provider: 'scripted', model: 'm' });
    Object.assign(stub, real);
    require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
    delete require.cache[GEN];
    const res = { statusCode: 0, setHeader() {}, removeHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; }, send(o) { this.body = o; return this; } };
    await require(GEN)({ method: 'POST', url: '/api/ai/generate', query: {}, headers: { authorization: 'Bearer scheduler-secret-for-the-test' }, body: { mode: 'concepts', brief: 'x' } }, res);
    return res;
  };
  try {
    process.env.CRON_SECRET = 'scheduler-secret-for-the-test';
    process.env.FREE_GENERATION = 'off';
    expect((await call('x')).statusCode, 'switched off and no key: the honest refusal').toBe(500);
    process.env.FREE_GENERATION = 'on';
    const off = await call('Trusted by 2 million readers, like Morning Brew');
    expect(off.statusCode, JSON.stringify(off.body).slice(0, 300)).toBe(200);
    expect(off.body.brand_check.ok).toBe(false);
    expect(off.body.brand_check.violations.map((v) => v.detail).join(' ')).toMatch(/Morning Brew/);
    const on = await call('Made for the people who read it');
    expect(on.statusCode).toBe(200);
    expect(on.body.brand_check.ok).toBe(true);
  } finally {
    require.cache[LLM] = realLlm; if (realGen) require.cache[GEN] = realGen; else delete require.cache[GEN];
    for (const k of ENVK) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

// Found while testing the guard: a record carrying its NAME and no id was read
// as "no brand" by social runDaily, which then gave it tenant zero's product
// taxonomy (posts themed on another company's sneakers).
test('social posts for a record with a name and no id never carry tenant zero\'s products', async () => {
  const SC = require.resolve(path.join(ROOT, 'api', '_shared', 'social-core.js'));
  const realLlm = require.cache[LLM]; const realSc = require.cache[SC];
  const real = require(LLM);
  const down = async () => { throw new Error('down'); };
  Object.assign(down, real);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: down };
  delete require.cache[SC];
  try {
    const out = await require(SC).runDaily({ brand: { name: 'Ledgerline Gazette', industry: 'news publishing' }, dry_run: true, date: '2026-10-20', platforms: ['instagram_feed'] });
    const zero = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js')).defaultBrand();
    const words = JSON.stringify(out);
    expect(words).not.toMatch(/Air Force|BMW Custom/);
    expect(words.toLowerCase()).not.toContain(String(zero.name).toLowerCase());
  } finally {
    require.cache[LLM] = realLlm; if (realSc) require.cache[SC] = realSc; else delete require.cache[SC];
  }
});
