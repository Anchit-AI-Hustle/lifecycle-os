// What a LIVE pass with no model key found (2026-10-17), rebuilt and checked.
//
// The operator: "complete all listed" - item 11 was to judge the copy a real
// model writes. With no key at all the only model is the keyless floor, and
// running Smart Brain against it found:
//   1. It answers ONE request per 30 s per address (its own 402 says so). A
//      build sent three calls within a second (strategy brief, two copy
//      directions 600 ms apart, each up to three tiers and two rounds), so the
//      copy ALWAYS fell to the template on a keyless deployment. Calls now wait
//      their turn in this process, a short Retry-After is honoured once, and a
//      keyless-only build makes ONE copy call.
//   2. Its model is a reasoning model with a 1,500-token default: the reasoning
//      used every token and the answer was 53 characters ("finish: length").
//      It is sent max_tokens and reasoning_effort: low.
//   3. The ads it wrote said "Trusted News Source", "Fast, Reliable Reporting":
//      Google headlines and the Meta headline were never held to the brand's
//      words; they are now (and reliable/rigorous/freshness... are claim words).
//   4. The brief said "PRODUCT FACTS: none on record" for a slot whose hero
//      carried its title and price, so the copy never named the product.
// And from the listed items (8, 10): a Meta ad had one primary text whatever
// it ran in (Stories / Reels show neither); a news brand's buttons went to its
// homepage, and the landing page's to "#", while its record names its
// subscription page.
//
// Executed: llm.js against a fetch that answers as the keyless service does,
// the shipped buildCampaign, copy-grounding.
//
// Run: npx playwright test tests/live-keyless-and-placements.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const KEY_VARS = ['OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY',
  'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'OpenRouter_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL', 'SAKANA_BASE_URL',
  'SAKANA_API_KEY', 'APP_AI_PROVIDER', 'FREE_GENERATION', 'LLM_KEYLESS_GAP_MS', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
const POLL = 'https://text.pollinations.ai/openai';

const COFFEE = {
  id: 'device:palmgrove', slug: 'palmgrove', name: 'Palmgrove Coffee', website: 'https://palmgrove.example', industry: 'Single-origin coffee roaster and store',
  tagline: 'Roasted on Tuesdays, at your door by Friday', regions: [{ code: 'IN', currency: 'INR', home: true }],
  claims: ['Roasted in small batches every Tuesday', 'Shipped within three days of roasting'], legal_entity: 'Palmgrove Coffee Pvt Ltd, Coorg, India',
};
const NEWS = {
  id: 'device:gazette', slug: 'gazette', name: 'Ledgerline Gazette', website: 'https://ledgerline.example', industry: 'news publishing',
  tagline: 'Pune news, checked twice by the desk', regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ['Reporters in all 14 Pune wards'],
  offerings: [{ kind: 'subscription', name: 'Morning Ledger', url: 'https://ledgerline.example/ledger' }], legal_entity: 'Ledgerline Media LLP, Pune, India',
};
const IMG = (n) => `https://palmgrove.example/cdn/${n}.jpg`;
const PRODUCTS = {
  heroProduct: { sku: 'P1', title: 'Palmgrove Estate Medium Roast', category: 'Coffee', image: IMG('estate'), price: 650 },
  supportingProducts: [{ sku: 'P2', title: 'Palmgrove Dark Roast', category: 'Coffee', image: IMG('dark'), price: 700 }],
};
const slot = (b, x) => Object.assign({
  id: 'live-' + b.slug, date: '2026-10-20', market: 'IN', objective: 'reactivation', brand: b,
  cohort: { name: 'At Risk', size: 1200, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
  confidence: 0.6, offer: { depth: 'none', pct: 0 },
}, x || {});
const COPY = (b, hero) => ({
  email: { subject: `${hero || b.name}: back for you`, preheader: b.tagline, hook: 'h', hero_headline: `Back to ${hero || b.name}`, intro_paragraph: `${b.claims[0]}.`, body_paragraph: '', benefits: [], rating: null, reviews: [], badges: [], guarantee: '', ps: '', faq: [], cta: 'Come back', image_brief: 'x' },
  landing: { hero_headline: `Back to ${hero || b.name}`, hero_sub: `${b.tagline}.`, why_title: 'Why', why_bullets: [], proof_quote: '', proof_author: '', faq: [], cta: 'Come back', image_brief: 'y' },
  ads: {
    meta: { primary_text: `${b.tagline}.`, headline: b === NEWS ? 'Trusted by readers' : `Back to ${hero || b.name}`.slice(0, 40), description: b.name, image_brief: 'z' },
    google: { headlines: ['Trusted News Source', 'Fast, Reliable Reporting', b.name.slice(0, 30)], descriptions: [`${b.tagline}.`, `${b.claims[0]}.`], image_brief: 'w' },
    tiktok: { script: 's', caption: b.tagline, image_brief: 'v' },
  },
});

/** A clean environment with no key at all, the keyless floor on, and a fetch that answers as the keyless service does. */
function keylessWorld(answer) {
  const saved = Object.fromEntries(KEY_VARS.map((k) => [k, process.env[k]]));
  for (const k of KEY_VARS) delete process.env[k];
  process.env.FREE_GENERATION = 'on';
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    if (String(url) !== POLL) throw new Error('unexpected network call: ' + url);
    const body = JSON.parse(init.body);
    const call = { at: Date.now(), body };
    calls.push(call);
    const r = await answer(call, calls.length);
    call.done = Date.now();
    return r;
  };
  const llm = require(LLM);
  llm._resetKeyless(); llm.resetProviderCooldowns();
  return { calls, restore() { global.fetch = realFetch; for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } llm._resetKeyless(); llm.resetProviderCooldowns(); } };
}
const ok = (text) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) });
const busy = (s) => ({ ok: false, status: 402, headers: { get: (h) => (/retry-after/i.test(h) ? String(s) : null) }, text: async () => JSON.stringify({ error: { code: 'FREE_LIMIT', message: `Free limit reached: 1 reply every 30 seconds per IP. Retry after ${s}s` } }) });

test('keyless only: calls wait their turn instead of being refused, a short Retry-After is honoured, and the answer gets room', async () => {
  const w = keylessWorld(async (c, n) => (n === 1 ? busy(1) : ok('{"a":' + n + '}')));
  process.env.LLM_KEYLESS_GAP_MS = '400';
  try {
    const llm = require(LLM);
    expect(await llm.keylessOnly()).toBe(true);
    const [a, b] = await Promise.all([
      llm({ systemPrompt: 's', userMessage: 'one', stage: 't1', timeoutMs: 5000, maxTokens: 3600 }),
      llm({ systemPrompt: 's', userMessage: 'two', stage: 't2', timeoutMs: 5000, maxTokens: 1000 }),
    ]);
    expect([a.provider, b.provider]).toEqual(['pollinations', 'pollinations']);
    expect(w.calls.length, 'one refusal, then one answer each').toBe(3);
    // Never two requests in flight, and each waited at least the gap after the previous answer.
    for (let i = 1; i < w.calls.length; i++) expect(w.calls[i].at - w.calls[i - 1].done, `call ${i + 1} waited its turn`).toBeGreaterThanOrEqual(390);
    // The refusal asked for 1 s: the retry waited for it.
    expect(w.calls[1].at - w.calls[0].done).toBeGreaterThanOrEqual(990);
    for (const c of w.calls) {
      expect(c.body.reasoning_effort).toBe('low');
      expect(c.body.max_tokens).toBeGreaterThanOrEqual(4000);
    }
    expect(w.calls[0].body.max_tokens).toBe(5600);
  } finally { w.restore(); }
});

test('a keyed provider present: the keyless floor is not the only route, and no wait is imposed', async () => {
  const saved = process.env.GROQ_API_KEY;
  const w = keylessWorld(async () => ok('x'));
  process.env.GROQ_API_KEY = 'test-key';
  try {
    expect(await require(LLM).keylessOnly()).toBe(false);
    // A Sakana endpoint with its key is a keyed provider too (Codex on #278).
    delete process.env.GROQ_API_KEY;
    process.env.SAKANA_BASE_URL = 'https://sakana.example'; process.env.SAKANA_API_KEY = 'test-key';
    expect(await require(LLM).keylessOnly()).toBe(false);
  } finally { w.restore(); if (saved === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = saved; }
});

async function buildKeyless(entry) {
  const w = keylessWorld(async () => ok(JSON.stringify(COPY(entry.brand, entry.heroProduct && entry.heroProduct.title))));
  process.env.LLM_KEYLESS_GAP_MS = '50';
  const realPlan = require.cache[PLAN];
  try {
    delete require.cache[PLAN];
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const c = await require(PLAN).buildCampaign(JSON.parse(JSON.stringify(entry)), smartConfig({}), { noLLM: false, withCreatives: false });
    return { c, calls: w.calls };
  } finally { w.restore(); if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN]; }
}

test('a keyless-only Smart Brain build makes ONE copy call and uses its answer, with the product named and priced in the brief', async () => {
  const { c, calls } = await buildKeyless(slot(COFFEE, PRODUCTS));
  expect(calls.length, 'no strategy brief, one copy direction, no tier ladder').toBe(1);
  expect(c.copywriter && c.copywriter.provider).toBe('pollinations');
  expect(c.assets.email.subject).toContain('Palmgrove Estate Medium Roast');
  const brief = calls[0].body.messages.map((m) => m.content).join('\n');
  expect(brief).toContain('- Name: Palmgrove Estate Medium Roast');
  expect(brief).toMatch(/- Price: ₹650/);
  expect(brief).not.toContain('PRODUCT FACTS: none on record');
  // The model's Meta headline is what the preview draws (overlay), not the template's (Codex on #278).
  const meta = c.assets.ads.filter((x) => x.platform === 'meta' && x.overlay);
  expect(meta.length).toBeGreaterThan(0);
  for (const ad of meta) { expect(ad.headline).toBe('Back to Palmgrove Estate Medium Roast'); expect(ad.overlay.headline).toBe(ad.headline); }
});

test('ad headlines are held to the brand\'s words: "Trusted", "Reliable" are dropped, the brand\'s own lines fill the RSA', async () => {
  const { c } = await buildKeyless(slot(NEWS));
  const rsa = c.assets.ads.find((a) => a.platform === 'google');
  expect(rsa.headlines.join(' | ')).not.toMatch(/Trusted|Reliable/);
  expect(rsa.headlines.length).toBeGreaterThanOrEqual(3);
  const meta = c.assets.ads.find((a) => a.platform === 'meta');
  expect(meta.headline).not.toMatch(/Trusted/);
  const dropped = c.copy_grounding.dropped.map((d) => d.field);
  expect(dropped).toEqual(expect.arrayContaining(['ads.google.headlines', 'ads.meta.headline']));
  // The preview draws overlay.headline: it shows the headline the ad carries (Codex on #278).
  for (const ad of c.assets.ads.filter((x) => x.platform === 'meta' && x.overlay)) expect(ad.overlay.headline).toBe(ad.headline);
});

test('an information brand\'s buttons go to the subscription its record names, on the mail and the landing page alike', async () => {
  const { c } = await buildKeyless(slot(NEWS));
  for (const lp of c.assets.landing_pages) {
    const hrefs = [...lp.html.matchAll(/<a href="([^"]*)" class="btn/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h, `landing ${lp.variant}`).toBe('https://ledgerline.example/ledger');
  }
  const mail = c.assets.email.variants.map((v) => v.html).join('\n');
  expect(mail).toContain('href="https://ledgerline.example/ledger"');
});

test('every Meta and TikTok ad carries what each placement shows: feeds the copy, Stories / Reels a short chosen line and its safe zone, a carousel only with two photographed products', async () => {
  const saved = process.env.FREE_GENERATION;
  process.env.FREE_GENERATION = 'off';
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error('offline ' + u); };
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const c = await require(PLAN).buildCampaign(slot(COFFEE, PRODUCTS), smartConfig({}), { noLLM: true, withCreatives: false });
    const metaStatic = c.assets.ads.find((a) => a.platform === 'meta' && a.creative_type === 'static');
    const keys = metaStatic.placements.map((p) => p.key);
    expect(keys).toEqual(['feed_square', 'feed_portrait', 'story_reel', 'carousel']);
    const story = metaStatic.placements.find((p) => p.key === 'story_reel');
    expect(story.on_screen.length).toBeGreaterThan(0);
    expect(story.on_screen.length).toBeLessThanOrEqual(40);
    expect(story.safe_zone).toMatch(/top 250px/);
    expect(metaStatic.placements.find((p) => p.key === 'carousel').cards.map((x) => x.product)).toEqual(['Palmgrove Estate Medium Roast', 'Palmgrove Dark Roast']);
    expect(metaStatic.placements.find((p) => p.key === 'feed_square').primary_text).toBe(metaStatic.primary_text);
    const metaVideo = c.assets.ads.find((a) => a.platform === 'meta' && a.creative_type === 'video');
    expect(metaVideo.placements.map((p) => p.key)).not.toContain('carousel');
    for (const t of c.assets.ads.filter((a) => a.platform === 'tiktok')) {
      expect(t.placements.map((p) => p.key)).toEqual(['in_feed']);
      expect(t.placements[0].safe_zone).toMatch(/bottom 480px/);
    }
    // One product with a photo: no carousel is offered.
    const one = await require(PLAN).buildCampaign(slot(COFFEE, { heroProduct: PRODUCTS.heroProduct }), smartConfig({}), { noLLM: true, withCreatives: false });
    const s1 = one.assets.ads.find((a) => a.platform === 'meta' && a.creative_type === 'static');
    expect(s1.placements.map((p) => p.key)).not.toContain('carousel');
  } finally {
    global.fetch = realFetch;
    if (saved === undefined) delete process.env.FREE_GENERATION; else process.env.FREE_GENERATION = saved;
  }
});
