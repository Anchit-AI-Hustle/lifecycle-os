// The mailer pipeline, EXECUTED for the first time.
//
// coverage/UNTESTED.md listed api/ai/pipeline/{strategy,variant,images,html,
// score}.js at 0% - five of this deployment's twelve serverless functions, never
// loaded by any test. Loading them and sending each a request found, in order:
//
//   1. NO CALLER GATE on any of the five. The unauthenticated LLM proxy closed
//      on generate.js and image.js on 2026-08-23 was still open on five sibling
//      routes, each starting with a wildcard CORS header and a straight call
//      into the six-provider cascade.
//   2. NO METER: no stage was wrapped in credits.metered, so the same mailer
//      that costs credits through generate.js was free through the pipeline.
//   3. NO REQUEST SCOPE, so a workspace's own provider keys and model order were
//      ignored and the platform's keys were spent instead.
//   4. ONE TENANT'S PROMPT FOR EVERY TENANT: the system prompts carried tenant
//      zero's name, hexes, fonts, logo, store domains and legal footer - and
//      under them a tea brand's ("first-flush", "7,000 feet", "farm direct").
//   5. INSTRUCTIONS TO FABRICATE: a star row, a review count and a units-sold
//      line were MANDATORY per product card, with the number range to use.
//   6. A BLACK SECTION in the html stage's own fallback (#0a1f13 on two Variant
//      B bands) that asset-no-black-background.spec.js could not see, because
//      this renderer was not on its list.
//
// Every test here sends a request through the SHIPPED entry point (the
// credits.metered and request-scope wrappers included), with llm.js replaced in
// require.cache by a scripted model that records every prompt, and global.fetch
// replaced by one that answers Supabase and refuses everything else. What is
// asserted is what came back, never what the source says.
//
// Run: npx playwright test tests/pipeline-executed.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const STAGES = ['strategy', 'variant', 'images', 'html', 'score'];
const stagePath = (s) => path.join(ROOT, 'api', 'ai', 'pipeline', `${s}.js`);
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const REAL_LLM = require(LLM);
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const brandRuntime = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
const sbPlan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));

/* ── harness ─────────────────────────────────────────────────────────────── */

const ENV_KEYS = [
  'CRON_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY',
  'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'GITHUB_MODELS_TOKEN', 'GITHUB_TOKEN',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL', 'SAKANA_BASE_URL', 'OPENAI_IMAGE_MODEL',
];

/** Pin the environment for one test and hand back the way to undo it. */
function pinEnv(set) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(set || {})) process.env[k] = v;
  return () => {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  };
}

const SUPA = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: 'anon-test-key' };
const METERED = Object.assign({}, SUPA, { SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key' });

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {}, ended: false,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    removeHeader(k) { delete this.headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.ended = true; return this; },
    send(o) { this.body = o; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
}

const PROVIDER_HOSTS = /(openai|anthropic|googleapis|generativelanguage|x\.ai|groq|cerebras|pollinations|higgsfield|elevenlabs)\./i;

/**
 * The network, as the stages see it. Supabase answers from the fixture; a
 * provider host throws unless the test hands in an `image` handler; anything
 * else throws, so no call can escape unnoticed.
 */
function fakeNetwork(fx) {
  const f = Object.assign({ user: null, activeWorkspace: null, workspace: null, image: null }, fx || {});
  const real = global.fetch;
  const log = [];
  const ledger = [];
  let holds = 0;
  const json = (o, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(o), json: async () => o, headers: { get: () => 'application/json' } });
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    let parsed = null;
    try { parsed = init.body ? JSON.parse(init.body) : null; } catch (_) { parsed = null; }
    log.push({ url: u, method, body: parsed });

    if (/\/auth\/v1\/user/.test(u)) return f.user ? json(f.user) : json({ msg: 'invalid token' }, 401);
    if (/\/rest\/v1\/brand_user_prefs/.test(u)) return json(f.activeWorkspace ? [{ active_workspace_id: f.activeWorkspace }] : []);
    if (/\/rest\/v1\/brand_workspaces/.test(u)) return json(f.workspace ? [f.workspace] : []);
    if (/\/rest\/v1\/credit_prices/.test(u) || /\/rest\/v1\/credit_pack_prices/.test(u) || /\/rest\/v1\/credit_ledger/.test(u)) return json([]);
    if (/\/rest\/v1\/credit_wallets/.test(u)) return json([{ id: 'wallet-1', user_id: f.user && f.user.id, balance: 1000, held: 0 }]);
    if (/\/rpc\/credit_wallet_id/.test(u)) return json('wallet-1');
    if (/\/rpc\/credit_grant/.test(u)) return json({ ok: true });
    if (/\/rpc\/credit_hold/.test(u)) { holds += 1; ledger.push({ op: 'hold', feature: parsed && parsed.p_feature, amount: parsed && parsed.p_amount, hold: `hold-${holds}` }); return json({ ok: true, hold_id: `hold-${holds}`, balance: 1000 - (parsed ? parsed.p_amount : 0) }); }
    if (/\/rpc\/credit_settle/.test(u)) { ledger.push({ op: 'settle', hold: parsed && parsed.p_hold, actual: parsed && parsed.p_actual }); return json({ ok: true, charged: parsed && parsed.p_actual, refunded: 0, balance: 900 }); }
    if (/\/rpc\/credit_release/.test(u)) { ledger.push({ op: 'release', hold: parsed && parsed.p_hold, note: parsed && parsed.p_note }); return json({ ok: true }); }

    if (PROVIDER_HOSTS.test(u)) {
      if (f.image && /api\.openai\.com\/v1\/images\/generations/.test(u)) return f.image(u, init, parsed);
      if (f.pollinations && /image\.pollinations\.ai/.test(u)) return f.pollinations(u, init);
      throw new Error(`a provider call escaped the gate: ${u}`);
    }
    throw new Error(`an unexpected network call: ${method} ${u}`);
  };
  return {
    log, ledger,
    get providers() { return log.filter((r) => PROVIDER_HOSTS.test(r.url)).map((r) => r.url); },
    get balanceMoves() { return log.filter((r) => /\/rpc\/credit_(grant|hold|spend|release|fulfil|settle)/.test(r.url)).map((r) => r.url); },
    restore() { global.fetch = real; },
  };
}

/**
 * The model, scripted. llm.js IS the function it exports, so the module entry
 * in require.cache is replaced; the stages resolve it at call time, which is
 * what makes a stub installed after they were loaded still reach them.
 */
function stubLLM(script) {
  const calls = [];
  const stub = async function callLLM(opts) {
    calls.push(opts);
    const out = await script(opts, calls.length);
    if (out instanceof Error) throw out;
    return { text: typeof out === 'string' ? out : JSON.stringify(out), provider: 'scripted', model: 'scripted-1' };
  };
  for (const k of ['parseJSON', 'corsHeaders', 'normalizeTier', 'modelsFor', 'providerOrder']) stub[k] = REAL_LLM[k];
  const real = require.cache[LLM];
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
  return {
    calls,
    /** Everything the model was shown on call n (1-based), system and user together. */
    prompt(n) { const c = calls[(n || 1) - 1]; return c ? `${c.systemPrompt || ''}\n${c.userMessage || ''}` : ''; },
    restore() { if (real) require.cache[LLM] = real; else delete require.cache[LLM]; },
  };
}

function reqFor(stage, body, bearer) {
  return {
    method: 'POST', url: `/api/ai/pipeline/${stage}`, query: {},
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    body,
  };
}

async function call(stage, body, bearer) {
  const handler = require(stagePath(stage));
  const res = fakeRes();
  brandRuntime.invalidate();
  await handler(reqFor(stage, body, bearer), res);
  return res;
}

/* ── the brands ──────────────────────────────────────────────────────────── */

const USER_ZERO = { id: 'user-zero', email: 'zero@example.com' };
const USER_OTHER = { id: 'user-other', email: 'other@example.com' };
const USER_INK = { id: 'user-ink', email: 'ink@example.com' };

/** A brand that is not tenant zero, shaped as a persisted brand_workspaces row. */
const OTHER = {
  id: '33333333-3333-4333-8333-333333333333', slug: 'northwind', name: 'Northwind Trail Co',
  tagline: 'Built for the long way round', industry: 'Outdoor apparel', website: 'https://northwind.example',
  logo_url: 'https://northwind.example/logo.svg',
  palette: { primary: '#1F4E3D', accent: '#E8A33D', ink: '#1B1B1B', surface: '#FFFFFF', surface_alt: '#F3F1EC', muted: '#5A6B62' },
  typography: {
    heading: { family: 'Fraunces', stack: "'Fraunces',Georgia,serif", google: true, weights: '600;700' },
    body: { family: 'Inter', stack: "'Inter',Arial,sans-serif", google: true, weights: '400;600' },
  },
  voice: { tone: 'plain, warm, practical', preferred: ['trail', 'layer'], banned: ['game-changer', 'hurry'], no_em_dashes: true },
  regions: [{ code: 'US', currency: 'USD', symbol: '$', store_url: 'https://northwind.example', home: true }],
  brand_data: { claims: ['Sewn in Oregon', 'Repaired for life'], legal_entity: 'Northwind Trail Co LLC, 12 Alder St, Portland OR 97201, USA' },
  status: 'active',
};

/** A record whose own primary AND accent are near black: the case sectionGround exists for. */
const INKCO = {
  id: '44444444-4444-4444-8444-444444444444', slug: 'inkco', name: 'Inkco',
  palette: { primary: '#111111', accent: '#0d0d0d', ink: '#111111', surface: '#FFFFFF', surface_alt: '#f4f4f4' },
  typography: {}, voice: {},
  regions: [{ code: 'US', currency: 'USD', symbol: '$', store_url: 'https://inkco.example', home: true }],
  brand_data: {}, status: 'active',
};

const AS = {
  zero: { user: USER_ZERO, activeWorkspace: null, workspace: null },
  other: { user: USER_OTHER, activeWorkspace: OTHER.id, workspace: OTHER },
  inkco: { user: USER_INK, activeWorkspace: INKCO.id, workspace: INKCO },
};

const PRODUCTS = [
  { name: 'Ridge Shell Jacket', handle: 'ridge-shell', price: '189.00', compare_at: '240.00', image_url: 'https://northwind.example/img/ridge.jpg', category: 'Shells' },
  { name: 'Alder Fleece', handle: 'alder-fleece', price: '98.00', image_url: 'https://northwind.example/img/alder.jpg', category: 'Mid layers' },
];

/* ── scripted model answers ─────────────────────────────────────────────── */

const STRATEGY_JSON = {
  strategic_lock: { audience_truth: 'Lapsed buyers', business_goal: 'Second orders', purchase_barrier: 'No reason today', conversion_trigger: 'The new shell' },
  product_selection: { hero: { name: 'Ridge Shell Jacket', handle: 'ridge-shell', why: 'The one they looked at' }, supporting: [], product_system: 'One hero', aov_logic: 'None' },
  strategy_type: 'Conversion Push', strategy: 'Shell first', reasoning: 'Because',
  vibe: { emotional_tone: 'calm', pace: 'measured', visual_energy: 'quiet', positioning: 'practical', avoid: 'hype' },
  theme: { name: 'Long way round', core_idea: 'x', emotional_driver: 'y', conversion_logic: 'z', visual_world: 'a jacket on a rock' },
  structure: { sections: ['brand_header', 'hero', 'benefit_strip', 'product_reveal', 'cta', 'footer'], layout_rules: 'single column', visual_system: {} },
  image_style_lock: 'natural light',
  variant_a_concept: { emotional_angle: 'direct', headline_register: 'declarative', template_key: 'sale', color_approach: 'light: whatever', opening_section: 'hero (product visible in section 1)', hero_scene: 'jacket' },
  variant_b_concept: { emotional_angle: 'atmosphere', headline_register: 'sensory', template_key: 'story', color_approach: 'inverted: whatever', opening_section: 'narrative', hero_scene: 'a trail at dusk' },
  variant_divergence_contract: {},
};

const VARIANT_JSON = (v) => ({
  variant: v,
  layout_plan: { hero: v === 'B' ? 'full-bleed' : 'split', flow: v === 'B' ? 'editorial-narrative' : 'structured-conversion', color_scheme: {} },
  sections: [
    { id: v === 'B' ? 'narrative' : 'hero', type: v === 'B' ? 'full-bleed' : 'split-hero', purpose: 'open', copy: { eyebrow: 'New', headline: 'Back on the trail', subcopy: 'The shell you looked at, ready for the season.', cta: 'See the shell' }, layout: 'x', image_slot: 'hero', ux_intent: 'open' },
    { id: 'product_reveal', type: 'centered', purpose: 'product', copy: { headline: 'Ridge Shell Jacket', subcopy: 'Three layers, sealed seams.', cta: 'Add to cart' }, layout: 'x', image_slot: 'product', ux_intent: 'buy' },
    { id: 'cta', type: 'button-row', purpose: 'close', copy: { headline: 'Shop the range', subcopy: '', cta: 'Shop now' }, layout: 'x', image_slot: 'none', ux_intent: 'close' },
  ],
  image_requirements: [{ slot: 'hero', prompt: 'jacket on a rock', size: '1536x1024', negative_prompt: 'no text' }],
  copy_framework: { tone: 'plain', voice: 'warm', headline_style: 'direct', cta_verb: 'Shop' },
  subject_lines: ['Back on the trail', 'The shell you looked at', 'Ready for the season'],
  preheader: 'Sealed seams, sewn in Oregon',
});

/** A model-built mailer the way the html stage expects one: placeholders, the store placeholder, tables. */
const MODEL_HTML = () => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Back on the trail</title><style>table{border-collapse:collapse}</style></head>
<body style="margin:0"><div style="display:none;font-size:1px;max-height:0;mso-hide:all">Sealed seams</div>
<table width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:24px">
<img src="IMAGE_HERO_URL" width="600" alt="Ridge Shell Jacket"><h1>Back on the trail</h1><p>The shell you looked at, ready for the season.</p>
<table cellpadding="0" cellspacing="0" border="0"><tr><td class="btn" bgcolor="#E8A33D" style="background:#E8A33D"><a href="{{STORE_BASE}}/products/ridge-shell" style="color:#1B1B1B">See the shell</a></td></tr></table>
<img src="IMAGE_PRODUCT_URL" width="300" alt="Ridge Shell Jacket"><p>Three layers, sealed seams.</p>
<img src="IMAGE_LIFESTYLE_URL" width="600" alt="On the trail">
<p><a href="{{STORE_BASE}}/collections/all">Shop the range</a> · <a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a></p>
</td></tr></table></body></html>`;

const SCORE_JSON = (over) => Object.assign({
  scores_a: { strategy_alignment: 8, content_density: 8, copy_quality: 8, overall: 8 },
  scores_b: { strategy_alignment: 8, content_density: 8, copy_quality: 8, variant_divergence: 9, overall: 8 },
  pass: true, weak_variant: null, failure_reasons: [], retry_reason: null,
}, over || {});

/** Something every stage accepts, so a refusal is measured on a real request shape. */
const BODIES = {
  strategy: { brief: 'Bring lapsed buyers back with the new shell', market: 'US', products: PRODUCTS },
  variant: { variant: 'A', strategy_output: STRATEGY_JSON, brief: 'Bring lapsed buyers back', market: 'US', products: PRODUCTS },
  images: { variant: 'A', requirements: [{ slot: 'hero', prompt: 'jacket on a rock', size: '1024x1024' }], image_style_lock: 'natural light' },
  html: { variant: 'A', plan: VARIANT_JSON('A'), strategy: STRATEGY_JSON, brief: 'Bring lapsed buyers back', market: 'US', products: PRODUCTS },
  score: { html_a: MODEL_HTML(), html_b: MODEL_HTML(), variant_a_plan: VARIANT_JSON('A'), variant_b_plan: VARIANT_JSON('B'), strategy_output: STRATEGY_JSON },
};

/* ═══ 1. the gate, executed ═══════════════════════════════════════════════ */

for (const meter of ['metered', 'unmetered']) {
  test(`every stage refuses an anonymous POST before any model or provider is reached (${meter})`, async () => {
    // Both configurations, deliberately. With the meter configured, the
    // credits wrapper's own session check refuses first; without it, the
    // stage's caller gate is the only thing standing - and a bypass of THAT
    // gate is invisible to a test that only ever runs the metered shape.
    const restoreEnv = pinEnv(meter === 'metered' ? METERED : SUPA);
    const llm = stubLLM(() => new Error('the model must not be reached'));
    const net = fakeNetwork({ user: null });
    try {
      for (const stage of STAGES) {
        const handler = require(stagePath(stage));
        expect(typeof handler, `${stage} must export a handler`).toBe('function');
        const res = await call(stage, BODIES[stage], null);
        expect(res.ended, `${stage} never answered the anonymous caller`).toBe(true);
        expect([401, 402, 503], `${stage}: anonymous POST got ${res.statusCode}`).toContain(res.statusCode);
        expect(res.body && res.body.ok, `${stage} answered ok to nobody`).toBe(false);
        expect(res.headers['access-control-allow-origin'], `${stage} handed out a wildcard origin`).not.toBe('*');
      }
      expect(llm.calls.length, 'a model was called for an anonymous caller').toBe(0);
      expect(net.providers, 'a provider was called for an anonymous caller').toEqual([]);
      expect(net.balanceMoves, 'a balance moved for an anonymous caller').toEqual([]);
    } finally {
      net.restore(); llm.restore(); restoreEnv();
    }
  });
}

test('every stage refuses a forged bearer, and the only network call is the session check', async () => {
  const restoreEnv = pinEnv(METERED);
  const llm = stubLLM(() => new Error('the model must not be reached'));
  const net = fakeNetwork({ user: null });
  try {
    for (const stage of STAGES) {
      const res = await call(stage, BODIES[stage], 'not-a-real-token');
      expect(res.ended).toBe(true);
      expect([401, 503], `${stage}: forged token got ${res.statusCode}`).toContain(res.statusCode);
    }
    const other = net.log.filter((r) => !/\/auth\/v1\/user/.test(r.url)).map((r) => r.url);
    expect(other, 'something other than the session check was called for a forged token').toEqual([]);
    expect(llm.calls.length).toBe(0);
  } finally {
    net.restore(); llm.restore(); restoreEnv();
  }
});

/* ═══ 2. what the admitted call shows the model ═══════════════════════════ */

const BLOCKS = {
  brand: (name) => new RegExp(`BRAND: ${name}`),
  contract: /ASSET: Lifecycle mailer \(email\)\.\nSTRUCTURE:/,
  contractDesign: /Images are REFERENCED by hosted URL, never embedded as base64/,
  evidenceHeader: /EVIDENCE — what this brand's own audience has already responded to\./,
  noEvidence: /WORKED: nothing yet\. No campaign performance is connected for this brand/,
  doNotInvent: /Do NOT invent a past campaign, a previous result, a benchmark or a figure/,
  fatigueUnknown: /TIRING: not measurable yet/,
  competitorsUnread: /COMPETITORS: .*This is NOT evidence that rivals are inactive/,
};

test('the strategy stage briefs the model with the brand block, the contract and the no-evidence state, then settles the hold', async () => {
  const restoreEnv = pinEnv(METERED);
  const llm = stubLLM(() => STRATEGY_JSON);
  const net = fakeNetwork(AS.zero);
  try {
    const res = await call('strategy', BODIES.strategy, 'session-zero');
    expect(res.statusCode, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.stage).toBe('strategy');
    expect(llm.calls.length, 'exactly one model call').toBe(1);

    const shown = llm.prompt(1);
    expect(shown).toMatch(BLOCKS.brand(brandRuntime.defaultBrand().name));
    expect(shown).toMatch(BLOCKS.contract);
    expect(shown).toMatch(BLOCKS.contractDesign);
    expect(shown).toMatch(BLOCKS.evidenceHeader);
    expect(shown).toMatch(BLOCKS.noEvidence);
    expect(shown).toMatch(BLOCKS.doNotInvent);
    expect(shown).toMatch(BLOCKS.fatigueUnknown);
    expect(shown).toMatch(BLOCKS.competitorsUnread);
    // The supplied products reach the model as the ONLY products.
    expect(shown).toMatch(/Ridge Shell Jacket/);
    expect(shown).toMatch(/Do NOT invent a product|the only ones that exist/);

    // Divergence is enforced on the output, from derived strings.
    expect(res.body.variant_a_concept.color_approach).toMatch(/^light:/);
    expect(res.body.variant_b_concept.color_approach).toMatch(/^inverted:/);

    // The meter: a hold on mailer.brief, settled after the 200.
    expect(net.ledger.map((l) => l.op)).toEqual(['hold', 'settle']);
    expect(net.ledger[0].feature).toBe('mailer.brief');
    expect(res.body.credits && res.body.credits.feature).toBe('mailer.brief');
  } finally {
    net.restore(); llm.restore(); restoreEnv();
  }
});

test('with campaign evidence attached, WORKED and TIRING carry the figures that qualified them', async () => {
  const restoreEnv = pinEnv(METERED);
  const llm = stubLLM(() => STRATEGY_JSON);
  const net = fakeNetwork(AS.other);
  const campaign = (name, clickRate) => ({ name, hooks: [`${name} hook`], performance: { sends: 12000, openRate: 0.31, clickRate, revenuePerRecipient: 1.2, roas: null } });
  try {
    const res = await call('strategy', Object.assign({}, BODIES.strategy, {
      evidence: { ownEvidence: { campaigns: [campaign('Spring shells', 0.061), campaign('Fleece week', 0.042), campaign('Clearance', 0.011)] } },
    }), 'session-other');
    expect(res.statusCode).toBe(200);
    const shown = llm.prompt(1);
    expect(shown).toMatch(/WORKED \(this brand's own campaigns, with the figures that qualified them\)/);
    expect(shown).toMatch(/"Spring shells" — 12,000 sent, 31\.0% open, 6\.1% click/);
    expect(shown).toMatch(/TIRING \(below this brand's own median click rate/);
    expect(shown).toMatch(/"Clearance"/);
    // ROAS is null for owned email: never printed as a zero.
    expect(shown).not.toMatch(/0\.00x/);
    expect(shown).toMatch(BLOCKS.brand('Northwind Trail Co'));
  } finally {
    net.restore(); llm.restore(); restoreEnv();
  }
});

for (const v of ['A', 'B']) {
  test(`the variant stage (${v}) is briefed with the three blocks and its own execution rules`, async () => {
    const restoreEnv = pinEnv(METERED);
    const llm = stubLLM(() => VARIANT_JSON(v));
    const net = fakeNetwork(AS.other);
    try {
      const res = await call('variant', Object.assign({}, BODIES.variant, { variant: v }), 'session-other');
      expect(res.statusCode, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(res.body.stage).toBe('variant');
      expect(res.body.variant).toBe(v);
      const shown = llm.prompt(1);
      expect(shown).toMatch(BLOCKS.brand('Northwind Trail Co'));
      expect(shown).toMatch(BLOCKS.contract);
      expect(shown).toMatch(BLOCKS.noEvidence);
      expect(shown).toMatch(v === 'B' ? /VARIANT B EXECUTION RULES/ : /VARIANT A EXECUTION RULES/);
      // The brand's OWN colours are what the rules name.
      expect(shown).toMatch(/#1F4E3D/);
      expect(shown).toMatch(/#E8A33D/);
      // Nothing was supplied, so nothing is to be written.
      expect(shown).toMatch(/OFFER: none supplied/);
      expect(shown).toMatch(/PROOF: none supplied/);
      expect(net.ledger.map((l) => l.op)).toEqual(['hold', 'settle']);
      expect(net.ledger[0].feature).toBe('mailer.variant');
    } finally {
      net.restore(); llm.restore(); restoreEnv();
    }
  });
}

test('a TEXT mailer leaves the variant stage with no image slots, whatever the model answered', async () => {
  const restoreEnv = pinEnv(METERED);
  const llm = stubLLM(() => VARIANT_JSON('A'));   // the model still answered with a hero slot
  const net = fakeNetwork(AS.other);
  try {
    const res = await call('variant', Object.assign({}, BODIES.variant, { mailer_type: 'text' }), 'session-other');
    expect(res.statusCode).toBe(200);
    expect(res.body.mailer_type).toBe('text');
    expect(res.body.image_requirements).toEqual([]);
    expect(res.body.sections.every((s) => s.image_slot === 'none')).toBe(true);
    expect(llm.prompt(1)).toMatch(/MAILER TYPE: TEXT\./);
  } finally {
    net.restore(); llm.restore(); restoreEnv();
  }
});

/* ═══ 3. the html stage: the model's output, made this brand's ════════════ */

test('the html stage substitutes THIS brand\'s store, injects its fonts and passes its contract', async () => {
  const restoreEnv = pinEnv(METERED);
  const llm = stubLLM(() => MODEL_HTML());
  const net = fakeNetwork(AS.other);
  try {
    const res = await call('html', BODIES.html, 'session-other');
    expect(res.statusCode, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.stage).toBe('html');
    expect(res.body.provider).toBe('scripted');
    const doc = res.body.html;
    expect(doc).not.toMatch(/\{\{STORE_BASE\}\}/);
    expect(doc).toMatch(/href="https:\/\/northwind\.example\/products\/ridge-shell"/);
    expect(doc).toMatch(/fonts\.googleapis\.com\/css2\?family=Fraunces/);
    expect(doc).toMatch(/^<!--\nSUBJECT_PRIMARY: Back on the trail/);
    expect(doc).toMatch(/PREHEADER: Sealed seams, sewn in Oregon/);
    for (const s of ['IMAGE_HERO_URL', 'IMAGE_PRODUCT_URL', 'IMAGE_LIFESTYLE_URL']) expect(doc).toContain(s);

    const shown = llm.prompt(1);
    expect(shown).toMatch(BLOCKS.brand('Northwind Trail Co'));
    expect(shown).toMatch(BLOCKS.contract);
    expect(shown).toMatch(BLOCKS.noEvidence);
    expect(shown).toMatch(/Store base url: https:\/\/northwind\.example/);
    expect(shown).toMatch(/Northwind Trail Co LLC, 12 Alder St/);
    // The prompt no longer mandates a fabricated proof line.
    expect(shown).not.toMatch(/units sold in the last 24 hours/);
    expect(shown).not.toMatch(/\[N\] reviews/);

    const summary = sbPlan.checkAssetContracts({ assets: { email: { subject: res.body.subject_lines[0], preheader: res.body.preheader, html: doc, intro_paragraph: 'x', cta: 'See the shell' } } });
    expect(summary.checked).toBe(1);
    expect(summary.blocking, JSON.stringify(summary.violations)).toBe(0);
    expect(net.ledger.map((l) => l.op)).toEqual(['hold', 'settle']);
    expect(net.ledger[0].feature).toBe('mailer.generate');
  } finally {
    net.restore(); llm.restore(); restoreEnv();
  }
});

/* ── the rendered gates, as asset-no-black-background.spec.js measures them ── */

const parse = (c) => {
  const s = String(c || '').trim();
  const hex = s.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  const rgb = s.match(/rgba?\(([^)]+)\)/i);
  if (rgb) return rgb[1].split(',').slice(0, 3).map((n) => Number(n.trim()));
  return null;
};
const toHex = (rgb) => '#' + rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
function isDarkNeutral(colour) {
  const rgb = parse(colour);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return core.luminance(toHex(rgb)) < 0.06 && (Math.max(r, g, b) - Math.min(r, g, b)) < 40;
}
const MEASURE = () => {
  const out = { grounds: [], text: [] };
  const opaque = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return false; const p = m[1].split(',').map((n) => Number(n.trim())); return p.length < 4 || p[3] >= 0.95; };
  const groundOf = (el) => { for (let n = el; n; n = n.parentElement) { const bg = getComputedStyle(n).backgroundColor; if (opaque(bg)) return bg; } return 'rgb(255, 255, 255)'; };
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || box.width < 2 || box.height < 2) continue;
    const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    const control = /^(a|button|input|select)$/.test(el.tagName.toLowerCase()) || /\bbtn\b/.test(String(el.className || ''));
    if (!control && opaque(cs.backgroundColor) && box.width * box.height > 4000) out.grounds.push({ tag, bg: cs.backgroundColor });
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const size = parseFloat(cs.fontSize) || 16;
    const weight = Number(cs.fontWeight) || 400;
    let fade = 1;
    for (let n = el; n; n = n.parentElement) fade *= Number(getComputedStyle(n).opacity || 1);
    out.text.push({ tag, fg: cs.color, bg: groundOf(el), size, weight, fade, sample: el.textContent.trim().slice(0, 40), large: size >= 24 || (size >= 18.66 && weight >= 700) });
  }
  return out;
};
function flatten(c, bg, fade = 1) {
  const p = parse(c);
  if (!p) return '#000000';
  const m = String(c).match(/rgba\(([^)]+)\)/);
  const own = m ? Number(String(m[1]).split(',')[3]) : 1;
  const alpha = (own >= 0 ? own : 1) * (fade >= 0 ? fade : 1);
  if (alpha >= 0.999) return toHex(p);
  const b = parse(bg) || [255, 255, 255];
  return toHex([0, 1, 2].map((i) => alpha * p[i] + (1 - alpha) * b[i]));
}
async function audit(page, doc, label) {
  await page.setContent(doc, { waitUntil: 'domcontentloaded' });
  const got = await page.evaluate(MEASURE);
  const dark = got.grounds.filter((g) => isDarkNeutral(g.bg)).map((g) => `${label} ${g.tag} is ${g.bg}`);
  const unreadable = got.text
    .map((t) => ({ ...t, ratio: core.contrast(flatten(t.fg, t.bg, t.fade), toHex(parse(t.bg) || [255, 255, 255])) }))
    .filter((t) => t.ratio < (t.large ? 3 : 4.5))
    .map((t) => `${label} ${t.tag}: "${t.sample}" ${t.fg} on ${t.bg} = ${t.ratio.toFixed(2)}:1`);
  return { dark, unreadable, counted: got };
}

test('the mailer the html stage builds itself passes the rendered gates and its contract, for every brand, variant and type', async ({ page }) => {
  test.setTimeout(120_000);
  const restoreEnv = pinEnv(METERED);
  const llm = stubLLM(() => new Error('every provider is down'));
  const bad = { dark: [], unreadable: [], blocking: [], warnings: [] };
  let grounds = 0, runs = 0, rendered = 0;
  try {
    for (const [who, fx] of Object.entries(AS)) {
      for (const variant of ['A', 'B']) {
        for (const type of ['text', 'text_graphics']) {
          const net = fakeNetwork(fx);
          let res;
          try {
            res = await call('html', Object.assign({}, BODIES.html, {
              variant, mailer_type: type, plan: VARIANT_JSON(variant),
              offer: { headline: '20% off shells this week', detail: 'Code SHELL20 at checkout, ends Sunday' },
              proof: [{ text: 'Best shell I have owned, and it was repaired for free.', author: 'R. Ortiz, Bend' }],
            }), `session-${who}`);
            // A stage that answered with its fallback is refunded, not charged.
            expect(net.ledger.map((l) => l.op), `${who}/${variant}/${type}: ledger`).toEqual(['hold', 'release']);
          } finally { net.restore(); }
          const label = `${who} ${variant} ${type}`;
          expect(res.statusCode, `${label}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
          expect(res.body._heuristic, `${label}: not the fallback`).toBe(true);
          expect(res.body.provider).toBe('heuristic');
          const doc = res.body.html;
          expect(doc.length, `${label}: too little HTML`).toBeGreaterThan(3000);
          if (type === 'text') expect(doc, `${label}: a TEXT mailer carries an image`).not.toMatch(/<img/i);
          else for (const s of ['IMAGE_HERO_URL', 'IMAGE_PRODUCT_URL', 'IMAGE_LIFESTYLE_URL']) expect(doc, `${label}: missing ${s}`).toContain(s);
          expect(doc, `${label}: no legal sender line`).toMatch(type === 'text' || who !== 'zero' ? /\[DATA REQUIRED BEFORE LAUNCH: sender postal address|12 Alder St|Ghatkopar West/ : /Ghatkopar West/);
          expect(doc).toContain('{{UNSUBSCRIBE_URL}}');
          expect(doc).toMatch(/display:none;font-size:1px/);
          expect(doc).toMatch(/width="600"/);
          expect(doc).toMatch(/<td class="btn vh-m-btn" bgcolor="[^"]+"[^>]*>\s*<a href=/);
          expect(doc, `${label}: the supplied offer is missing`).toContain('20% off shells this week');
          expect(doc, `${label}: the supplied proof is missing`).toContain('Best shell I have owned');

          const r = await audit(page, doc, label);
          rendered += 1;
          grounds += r.counted.grounds.length;
          runs += r.counted.text.length;
          expect(r.counted.grounds.length, `${label}: only ${r.counted.grounds.length} grounds measured`).toBeGreaterThanOrEqual(4);
          expect(r.counted.text.length, `${label}: only ${r.counted.text.length} text runs measured`).toBeGreaterThanOrEqual(8);
          bad.dark.push(...r.dark);
          bad.unreadable.push(...r.unreadable);

          const summary = sbPlan.checkAssetContracts({ assets: { email: { subject: res.body.subject_lines[0], preheader: res.body.preheader, html: doc, intro_paragraph: 'x', cta: 'x' } } });
          expect(summary.checked, `${label}: the contract governed nothing`).toBe(1);
          for (const v of summary.violations) (v.level === 'block' ? bad.blocking : bad.warnings).push(`${label} ${v.slot}: ${v.message}`);
        }
      }
    }
    expect(rendered).toBe(12);
    // A check that inspects nothing passes everything.
    expect(grounds).toBeGreaterThan(60);
    expect(runs).toBeGreaterThan(150);
    expect(bad.dark, 'the html stage paints these sections a dark neutral').toEqual([]);
    expect(bad.unreadable, 'the html stage renders this text under the AA floor').toEqual([]);
    expect(bad.blocking, 'blocking contract violations on the stage\'s own output').toEqual([]);
    expect(bad.warnings, 'contract warnings on the stage\'s own output').toEqual([]);
  } finally {
    llm.restore(); restoreEnv();
  }
});

/* ═══ 4. a stage that fails gives the credits back ════════════════════════ */

test('a stage that fails, or falls back, releases its hold instead of settling it', async () => {
  const restoreEnv = pinEnv(METERED);
  const cases = [
    ['html', 'a refusal shorter than a mailer', () => 'no.', (res) => { expect(res.statusCode).toBe(502); expect(res.body.error).toBe('html_too_short'); }],
    ['strategy', 'an answer that is not JSON', () => 'not { json', (res) => { expect(res.statusCode).toBe(502); expect(res.body.error).toBe('json_parse_failed'); }],
    ['score', 'a scorer that threw', () => new Error('scorer down'), (res) => { expect(res.statusCode).toBe(200); expect(res.body._scoring_skipped).toBe(true); expect(res.body.scores_a).toBeNull(); }],
    ['variant', 'a planner that fell back', () => new Error('planner down'), (res) => { expect(res.statusCode).toBe(200); expect(res.body._heuristic).toBe(true); }],
  ];
  try {
    for (const [stage, why, script, check] of cases) {
      const llm = stubLLM(script);
      const net = fakeNetwork(AS.other);
      try {
        const res = await call(stage, BODIES[stage], 'session-other');
        check(res);
        expect(net.ledger.map((l) => l.op), `${stage} (${why}): the hold was not given back`).toEqual(['hold', 'release']);
        expect(net.ledger.filter((l) => l.op === 'settle'), `${stage} (${why}): settled a failed run`).toEqual([]);
      } finally { net.restore(); llm.restore(); }
    }
  } finally { restoreEnv(); }
});

/* ═══ 5. the images stage, through a controllable provider ════════════════ */

function pngB64() { return 'iVBORw0KGgo' + 'A'.repeat(2400); }

test('the images stage generates through the provider it was given, and refunds a call that produced nothing', async () => {
  const restoreEnv = pinEnv(Object.assign({ OPENAI_API_KEY: 'sk-test' }, METERED));
  const llm = stubLLM(() => new Error('no text model is needed here'));
  const seen = [];
  const good = fakeNetwork(Object.assign({}, AS.other, {
    image: (u, init, parsed) => { seen.push(parsed); return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: pngB64() }] }), text: async () => '' }; },
  }));
  try {
    const res = await call('images', Object.assign({}, BODIES.images, {
      requirements: [{ slot: 'hero', prompt: 'jacket on a rock', size: '1536x1024' }, { slot: 'product', prompt: 'the jacket', size: '1024x1024' }, { slot: 'lifestyle', prompt: 'on the trail', size: '1024x1024' }],
    }), 'session-other');
    expect(res.statusCode, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.stage).toBe('images');
    expect(res.body.success_count).toBe(3);
    expect(res.body.all_success).toBe(true);
    expect(res.body.images.map((i) => i.slot)).toEqual(['hero', 'product', 'lifestyle']);
    expect(res.body.images.every((i) => i.data_url.startsWith('data:image/png;base64,'))).toBe(true);
    expect(res.body.hosting_note).toMatch(/blocked by its contract/);
    // The preamble names THIS brand, and the scene prompt reached the provider.
    expect(seen.length).toBe(3);
    expect(seen[0].prompt).toMatch(/for Northwind Trail Co\./);
    expect(seen[0].prompt).toMatch(/natural light jacket on a rock/);
    expect(seen[0].prompt).not.toMatch(/KNICKGASM/i);
    expect(good.ledger.map((l) => l.op)).toEqual(['hold', 'settle']);
    expect(good.ledger[0].feature).toBe('image.generate');
  } finally { good.restore(); }

  // Quota exhausted on the keyed provider. The stage's documented cascade then
  // tries the free provider (the same free-tier rungs llm.js has), which is
  // also down here, so the call produces nothing.
  const dead = fakeNetwork(Object.assign({}, AS.other, {
    image: () => ({ ok: false, status: 429, text: async () => 'rate limited', json: async () => ({}) }),
    pollinations: () => ({ ok: false, status: 503, text: async () => 'down', json: async () => ({}), headers: { get: () => 'text/plain' } }),
  }));
  try {
    const res = await call('images', BODIES.images, 'session-other');
    expect(res.statusCode).toBe(200);
    expect(res.body.success_count).toBe(0);
    expect(res.body.placeholder).toBe(true);
    const slot = res.body.images[0];
    expect(slot.success).toBe(false);
    expect(slot.placeholder).toBe(true);
    expect(slot.attempts).toBe(3);
    expect(slot.error).toMatch(/Pollinations 503/);
    // Both rungs were actually tried before the slot was given up.
    expect(dead.providers.filter((u) => /api\.openai\.com/.test(u)).length).toBe(3);
    expect(dead.providers.filter((u) => /pollinations/.test(u)).length).toBe(3);
    // The panel a failed slot degrades to is THIS brand's, not tenant zero's.
    const svg = decodeURIComponent(slot.data_url.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    expect(svg).toContain('Northwind Trail Co');
    expect(svg).toMatch(/#1F4E3D/i);
    expect(svg).not.toMatch(/KNICKGASM|#D0473E|#6A33D8/i);
    expect(dead.ledger.map((l) => l.op)).toEqual(['hold', 'release']);
  } finally { dead.restore(); llm.restore(); restoreEnv(); }
});

/* ═══ 6. the score stage enforces the pass rules itself ═══════════════════ */

test('the score stage briefs the model on this brand and enforces the pass rules on what comes back', async () => {
  const restoreEnv = pinEnv(METERED);
  const llm = stubLLM(() => SCORE_JSON({ scores_a: { strategy_alignment: 8, content_density: 5, copy_quality: 8, overall: 7 }, pass: true }));
  const net = fakeNetwork(AS.other);
  try {
    const res = await call('score', BODIES.score, 'session-other');
    expect(res.statusCode, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.stage).toBe('score');
    // The model said pass; the rules say a 5 on content density is not one.
    expect(res.body.pass).toBe(false);
    expect(res.body.weak_variant).toBe('A');
    // The fingerprint reads THIS brand's accent as the CTA colour.
    expect(res.body.fingerprint.a.accent_cta_buttons).toBeGreaterThan(0);
    expect(res.body.fingerprint.a.has_price).toBe(0);
    const shown = llm.prompt(1);
    expect(shown).toMatch(/quality auditor for Northwind Trail Co/);
    expect(shown).toMatch(/rating, review count, units-sold line or testimonial that was not supplied/);
    expect(shown).not.toMatch(/farm direct|b-corp/i);
    expect(net.ledger.map((l) => l.op)).toEqual(['hold', 'settle']);
    expect(net.ledger[0].feature).toBe('mailer.score');
  } finally { net.restore(); llm.restore(); restoreEnv(); }
});

/* ═══ 7. isolation: another brand gets none of tenant zero ════════════════ */

/** Tenant zero's tokens, the same set scripts/test-brand-isolation.js refuses. */
function foreignTokens() {
  const list = [/\bknickgasm\b/i, /knickgasm\.com/i, /#D0473E/i, /#6A33D8/i, /\bhand-painted\b/i, /\bone-of-one\b/i, /\bsneakers?\b/i, /\bcolorways?\b/i, /Ghatkopar/i, /Montserrat|Instrument Sans/];
  for (const region of ['us', 'uk', 'global']) {
    let rows = [];
    try { rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog', `products_${region}.json`), 'utf8')); } catch (_) { continue; }
    for (const p of rows.slice(0, 50)) {
      const url = p && p.i;
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
      try { const u = new URL(url); list.push(new RegExp((u.host + u.pathname.split('/').slice(0, 5).join('/')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')); } catch (_) { /* skip */ }
    }
  }
  return [...new Map(list.map((r) => [r.source, r])).values()];
}

test('a brand that is not tenant zero receives none of tenant zero\'s copy, palette, fonts or photos from any stage', async () => {
  const restoreEnv = pinEnv(Object.assign({ OPENAI_API_KEY: 'sk-test' }, METERED));
  const FOREIGN = foreignTokens();
  expect(FOREIGN.length).toBeGreaterThan(10);
  const leaks = [];
  const scan = (label, s) => { for (const rx of FOREIGN) if (rx.test(s)) leaks.push(`${label}: ${rx.source}`); };
  const products = [{ name: 'Ridge Shell Jacket', handle: 'ridge-shell', price: '189.00' }];
  try {
    // Both paths of every stage: the model answering, and every provider down.
    for (const mode of ['model', 'fallback']) {
      const llm = stubLLM((opts) => {
        if (mode === 'fallback') return new Error('down');
        if (/strategy/.test(opts.stage)) return STRATEGY_JSON;
        if (/variant/.test(opts.stage)) return VARIANT_JSON(/-B/.test(opts.stage) ? 'B' : 'A');
        if (/html/.test(opts.stage)) return MODEL_HTML();
        return SCORE_JSON();
      });
      const net = fakeNetwork(Object.assign({}, AS.other, {
        image: () => ({ ok: false, status: 500, text: async () => 'down', json: async () => ({}) }),
        pollinations: () => ({ ok: false, status: 503, text: async () => 'down', json: async () => ({}), headers: { get: () => 'text/plain' } }),
      }));
      try {
        const outs = {};
        outs.strategy = await call('strategy', { brief: 'Bring lapsed buyers back', market: 'US', products }, 'session-other');
        for (const v of ['A', 'B']) {
          outs['variant' + v] = await call('variant', { variant: v, strategy_output: outs.strategy.body, brief: 'Bring lapsed buyers back', market: 'US', products }, 'session-other');
          outs['html' + v] = await call('html', { variant: v, plan: outs['variant' + v].body, strategy: outs.strategy.body, market: 'US', products }, 'session-other');
        }
        outs.images = await call('images', { variant: 'A', requirements: [{ slot: 'hero', prompt: 'a jacket', size: '1024x1024' }] }, 'session-other');
        outs.score = await call('score', { html_a: outs.htmlA.body.html, html_b: outs.htmlB.body.html, variant_a_plan: outs.variantA.body, variant_b_plan: outs.variantB.body, strategy_output: outs.strategy.body }, 'session-other');
        for (const [k, res] of Object.entries(outs)) {
          expect(res.statusCode, `${mode}/${k}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
          scan(`${mode}/${k} output`, JSON.stringify(res.body));
        }
        llm.calls.forEach((c, i) => scan(`${mode}/prompt#${i + 1} (${c.stage})`, `${c.systemPrompt}\n${c.userMessage}`));
        // The brand's own record DID reach the model and the output: its name
        // in every prompt, its store in the mailer, and (when the stage built
        // the mailer itself) its name in the mailer too.
        expect(llm.calls.length).toBeGreaterThanOrEqual(6);
        // The writing stages carry the whole brand block; the scorer writes no
        // copy and is briefed by name only. Every prompt names THIS brand.
        llm.calls.forEach((c, i) => expect(`${c.systemPrompt}`, `${mode}/prompt#${i + 1}`).toMatch(/Northwind Trail Co/));
        llm.calls.filter((c) => !/score/.test(c.stage)).forEach((c, i) => expect(`${c.systemPrompt}`, `${mode}/writing prompt#${i + 1}`).toMatch(/BRAND: Northwind Trail Co/));
        expect(outs.htmlA.body.html).toMatch(/northwind\.example/);
        if (mode === 'fallback') expect(outs.htmlA.body.html).toMatch(/Northwind Trail Co/);
      } finally { net.restore(); llm.restore(); }
    }
    expect(leaks, 'tenant zero leaked into another brand\'s pipeline').toEqual([]);
  } finally { restoreEnv(); }
});

/* ═══ 8. health: unconfigured is a state, not a fabricated ready ═════════ */

test('pipeline health with every provider unset reports unconfigured, and names no model it would not run', async () => {
  const restoreEnv = pinEnv({ CRON_SECRET: 'cron-test-secret' });
  const real = global.fetch;
  global.fetch = async (u) => { throw new Error(`health must not touch the network: ${u}`); };
  try {
    const handler = require(path.join(ROOT, 'api', 'public-config.js'));
    const res = fakeRes();
    await handler({ method: 'GET', url: '/api/public-config?pipeline=1', query: { pipeline: '1' }, headers: { authorization: 'Bearer cron-test-secret' }, body: null }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.status).toBe('unconfigured');
    expect(res.body.checks.at_least_one_provider).toBe(false);
    expect(res.body.checks.provider_tiers_active).toBe(0);
    expect(res.body.checks.text_model).toBe('unconfigured');
    expect(String(res.body.verdict)).not.toMatch(/ready/i);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');

    // And with one key present the same route says ready, so the unconfigured
    // answer above is a measurement rather than a constant.
    process.env.GEMINI_API_KEY = 'gm-test';
    const res2 = fakeRes();
    await handler({ method: 'GET', url: '/api/public-config?pipeline=1', query: { pipeline: '1' }, headers: { authorization: 'Bearer cron-test-secret' }, body: null }, res2);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.status).toBe('ready');
    expect(res2.body.checks.text_model).not.toBe('unconfigured');
  } finally { global.fetch = real; restoreEnv(); }
});
