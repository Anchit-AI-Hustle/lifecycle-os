/**
 * Every prompt says what to RETURN and in what FORMAT (2026-10-11).
 * ---------------------------------------------------------------------------
 * The operator: "ENSURE PROMPT QUALITY FOR AI CLEARLY DEFINES THE OUTPUT
 * REQUIREMENT AND FORMAT TOO".
 *
 * Every prompt the app builds for a model - sent by a router, sent by a
 * module, or copied by a page for the operator to paste - ends with ONE
 * OUTPUT REQUIREMENT block rendered by api/_shared/output-contract.js (the
 * browser loads the byte-identical /output-contract.js): the deliverable, the
 * format (JSON keys with types and limits, the HTML container, the labelled
 * sections), what not to return, and how to mark a missing fact. The caller
 * parses the answer with the SAME spec, so the prompt and the parser cannot
 * disagree about which keys exist.
 *
 * HOW THIS IS EXECUTED, not read:
 *   1. The shipped routers (brain.js, calendar.js, generate.js, the pipeline
 *      stages, public-config.js) are driven over a socket by
 *      tests/agents-harness.js as a signed-in account whose active workspace
 *      is a fixture brand, with the scripted llm.js recording every prompt.
 *      Every recorded prompt is judged: one block, at the very end, a
 *      deliverable, a format, keys for JSON, and JSON response mode exactly
 *      when the block says JSON (the caller's parser) - and vice versa.
 *   2. The same generators are driven again with the scripted model ANSWERING
 *      each prompt with exactly the shape its block asked for
 *      (OutputContract.sample of the spec it rendered). A caller that then
 *      fails to read it (a parse failure, a 5xx, a fallback flag) asked for
 *      one shape and parses another.
 *   3. Modules no router reaches with a model call in this world are called
 *      directly inside the same world (the critic and reviser, the quality and
 *      design loops, the KB analysers, the guardrail, the voice observer,
 *      the brand suggester, competitor discovery, the vision instruction).
 *   4. Every generator the routers DECLARE (MODEL_FEATURE, _CAL_FEATURE,
 *      GENERATES, MODE_FEATURE, the pipeline directory) is in the table or in
 *      EXEMPT with its reason, and every source file that calls a model is
 *      either driven here or listed by name with its reason, so a new
 *      generator without a contract fails.
 *   5. The browser: the Studio, the asset library, Ad Campaigns and Landing
 *      Pages are loaded in Chromium with the clipboard stubbed, and every
 *      prompt they copy or send ends with the block.
 *
 * Run: npx playwright test tests/prompt-output-contracts.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const A = require('./agents-harness');
const H = require('./router-harness');
const F = require('./lib/brand-invariant-fixtures');

const ROOT = A.ROOT;
const OC_PATH = path.join(ROOT, 'api', '_shared', 'output-contract.js');
const PIPELINE = fs.readdirSync(path.join(ROOT, 'api', 'ai', 'pipeline')).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).sort();
const EXTRA_ROUTERS = Object.assign({ '/api/competitor': 'api/competitor.js', '/api/kb': 'api/kb.js' },
  Object.fromEntries(PIPELINE.map((s) => ['/api/ai/pipeline/' + s, `api/ai/pipeline/${s}.js`])));
const B = F.QUILL;
const homeOf = (b) => ((b.regions || []).find((r) => r.home) || (b.regions || [])[0] || {}).code || '';
const productsOf = (b) => (b.catalogue || []).map((p) => ({ title: p.title, handle: p.handle, price: p.price, image: p.image, product_type: p.product_type }));
/** The OutputContract instance the ROUTERS loaded (the world reloads the tree). */
const OC = () => require(OC_PATH);

/* ── the generators the routers declare ──────────────────────────────────── */
const ENTRY = () => ({ id: 'oc-slot', date: '2026-10-20', cohort: { name: 'At Risk', size: 400, rules: ['last order 90-180 days'] }, objective: 'reactivation', channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], market: homeOf(B) });
/** What the response must carry when the model answered in its own contract's shape. */
const READS = {
  concepts: (t) => /"concepts":\[\{/.test(t), mailer_full: (t) => /"variant_a":\{/.test(t), suggested_prompts: (t) => /"data":\[\{"icon"/.test(t),
  create_brief: (t) => /"text":"sample"/.test(t), chat: (t) => /"text":"sample"/.test(t), audience_segment: (t) => /"text":"sample"/.test(t),
  landing_page: (t) => /"text":"<!doctype html>/i.test(t),
};
const AD_FORMATS_READ = ['google', 'meta', 'tiktok'];
const GENERATORS = [
  { id: 'brand-chat', path: '/api/brain', q: { action: 'brand-chat' }, body: () => ({ message: 'What should we send this week?' }), reads: (t) => /"reply":"sample/.test(t) },
  { id: 'console-chat', path: '/api/brain', q: { action: 'console-chat' }, body: () => ({ message: 'What should ship next?' }) },
  { id: 'team-chat', path: '/api/brain', q: { action: 'team-chat' }, body: () => ({ message: 'What should we plan?' }) },
  { id: 'agent-chat', path: '/api/brain', q: { action: 'agent-chat' }, body: () => ({ message: 'Which one should I pick?', agent_id: 'agent_brand' }), statuses: [404, 409] },
  { id: 'agent-analyze', path: '/api/brain', q: { action: 'agent-analyze' }, body: () => ({ message: 'What should I tell customers?' }) },
  { id: 'access-narrative', path: '/api/brain', q: { action: 'access-narrative' }, body: () => ({}), statuses: [400, 404, 409, 501, 503] },
  { id: 'analysis-narrative', path: '/api/brain', q: { action: 'analysis-narrative' }, body: () => ({}) },
  { id: 'agentic-run', path: '/api/brain', q: { action: 'agentic-run' }, body: () => ({ days: 1, withCreatives: false, tier: 'budget' }), minCalls: 2 },
  { id: 'generate', path: '/api/brain', q: { action: 'generate' }, body: () => ({ slot_id: 'slot-oc-1' }), statuses: [404, 409] },
  { id: 'social-run-daily', path: '/api/brain', q: { action: 'social-run-daily' }, body: () => ({ dry_run: true, platforms: ['instagram', 'linkedin'], date: '2026-10-20' }), minCalls: 3 },
  { id: 'mailer-assets', path: '/api/brain', q: { action: 'mailer-assets' }, body: () => ({ html: '<!doctype html><html><body><img src="IMAGE_HERO_URL" alt="hero"></body></html>', video: false, gif: false, persist: false }), statuses: [400, 409] },
  { id: 'platform-agents', path: '/api/brain', q: { action: 'platform-agents' }, body: () => ({}) },
  { id: 'ad-angle-lab', path: '/api/brain', q: { action: 'ad-angle-lab' }, body: () => ({ competitors: ['Rival One'] }), statuses: [409] },
  { id: 'launch-concepts', path: '/api/brain', q: { action: 'launch-concepts' }, body: () => ({ product: { title: (B.catalogue[0] || {}).title }, customer: 'readers who commute' }), statuses: [409] },
  { id: 'ad-fix', path: '/api/brain', q: { action: 'ad-fix' }, body: () => ({ worst: { ad: 'Old headline' }, why: ['It spent 400 and brought no conversion.'] }), statuses: [409] },
  { id: 'review-mine', path: '/api/brain', q: { action: 'review-mine' }, body: () => ({ reviews: [{ text: 'Great reporting, slow app.', rating: 4 }, { text: 'The app crashes every morning.', rating: 2 }] }), statuses: [409] },
  { id: 'revenue-os', path: '/api/brain', q: { action: 'revenue-os' }, body: null },
  { id: 'telesuite', path: '/api/brain', q: { action: 'telesuite' }, body: () => ({ op: 'pitch', input: { product: (B.catalogue[0] || {}).title } }), minCalls: 1 },
  { id: 'telesuite rebuttal', path: '/api/brain', q: { action: 'telesuite' }, body: () => ({ op: 'rebuttal', input: { objection: 'It costs too much.' } }), minCalls: 1 },
  { id: 'telesuite product', path: '/api/brain', q: { action: 'telesuite' }, body: () => ({ op: 'product_description', input: { name: 'Front Page Bundle' } }), minCalls: 1 },
  { id: 'telesuite kb', path: '/api/brain', q: { action: 'telesuite' }, body: () => ({ op: 'kb_ingest', input: { content: 'The plan renews monthly and can be cancelled online.', name: 'Plans' } }), minCalls: 1 },
  { id: 'telesuite scoring', path: '/api/brain', q: { action: 'telesuite' }, body: () => ({ op: 'call_scoring', input: { transcript: 'Agent: Hello.\nCustomer: Hi, what is the price?\nAgent: Let me check that for you.' } }), minCalls: 1 },
  { id: 'telesuite deck', path: '/api/brain', q: { action: 'telesuite' }, body: () => ({ op: 'training_deck', input: { topic: 'Handling price objections' } }), minCalls: 1 },
  { id: 'telesuite data', path: '/api/brain', q: { action: 'telesuite' }, body: () => ({ op: 'data_analysis', input: { description: 'Weekly call outcomes by agent.' } }), minCalls: 1 },
  { id: 'calendar-generate', path: '/api/brain', q: { action: 'calendar-generate' }, body: () => ({ days: 7, tier: 'maxpower' }) },
  // ── api/calendar.js ──
  { id: 'plan', path: '/api/calendar', q: { action: 'smart-brain-plan' }, body: () => ({ days: 14 }) },
  { id: 'sync-daily', path: '/api/calendar', q: { action: 'smart-brain-sync-daily' }, body: () => ({ days: 7 }) },
  { id: 'preview', path: '/api/calendar', q: { action: 'smart-brain-preview' }, body: () => ({ entry: ENTRY() }), minCalls: 1, reads: (t) => /"subject":"sample/.test(t) },
  // generate-slot reuses the campaign preview just built for the same slot (no second model call).
  { id: 'generate-slot', path: '/api/calendar', q: { action: 'smart-brain-generate-slot' }, body: () => ({ entry: ENTRY() }) },
  { id: 'lifecycle-generate', path: '/api/calendar', q: { action: 'lifecycle-generate' }, body: () => ({ days: 7 }), statuses: [409] },
  { id: 'lifecycle-build-mailer', path: '/api/calendar', q: { action: 'lifecycle-build-mailer' }, body: () => ({ entry: { cohort_key: 'tb_buyers_non_engagers', product_type: 'tb', date: '2026-10-20' }, force: true }), statuses: [409] },
  { id: 'trigger-mailer', path: '/api/calendar', q: { action: 'trigger-mailer' }, body: () => ({ entry: { date: '2026-10-20', market: homeOf(B), segment: 'At-Risk', archetype: 'hero-led-editorial', content_type: 'winback', hero_product: (B.catalogue[0] || {}).title } }), minCalls: 1, reads: (t) => /sample/.test(t) },
  { id: 'generate', path: '/api/calendar', q: { action: 'generate' }, body: () => ({ days: 7, markets: [homeOf(B)], analytics: { segments: [{ name: 'At Risk', count: 400, revenue: 1000 }] } }) },
  // ── api/ai/generate.js: every mode, every autofill surface ──
  ...['create_brief', 'concepts', 'mailer_full', 'suggested_prompts', 'chat', 'landing_page', 'audience_segment'].map((mode) => ({
    id: mode, path: '/api/ai/generate', q: {}, minCalls: 1, reads: READS[mode],
    body: () => ({ mode, brief: 'A campaign for customers who bought once and stopped.', prompt: 'A campaign for customers who bought once and stopped.', message: 'Sharpen this subject line.', chat_context: {}, selected_products: productsOf(B).map((p) => ({ name: p.title, price: p.price, image_url: p.image })) }),
  })),
  ...['google', 'meta', 'tiktok', 'lp-mailer', 'lp-meta', 'lp-google', 'lp-tiktok'].map((surface) => ({
    id: surface === 'meta' ? 'autofill' : 'autofill ' + surface, path: '/api/ai/generate', q: {}, minCalls: 1, reads: AD_FORMATS_READ.includes(surface) ? (t) => /"overlay":\{"headline":"sample/.test(t) : (t) => /sample/.test(t),
    body: () => ({ mode: 'autofill', surface, prompt: 'A campaign for customers who bought once and stopped.' }),
  })),
  { id: 'landing-page', path: '/api/ai/landing-page', q: {}, body: () => ({ brief: 'A landing page for customers who bought once and stopped, for our subscription.' }), minCalls: 1, statuses: [502] },
  // ── the five pipeline stages ──
  ...PIPELINE.map((stage) => ({
    id: stage, path: '/api/ai/pipeline/' + stage, q: {}, minCalls: stage === 'images' ? 0 : 1,
    body: () => ({ brief: 'Bring lapsed customers back', products: productsOf(B), variant: 'A', strategy_output: { strategy: { name: 'reactivation' } }, strategy: {},
      plan: { sections: [{ id: 'hero', type: 'centered', copy: { headline: 'Back again', subcopy: 'For you', cta: 'See it' } }], subject_lines: ['Back again'], preheader: 'For you' },
      requirements: [{ slot: 'hero', prompt: 'the hero product', size: '1024x1024' }], image_style_lock: 'natural light',
      html_a: '<html><body>a</body></html>', html_b: '<html><body>b</body></html>', variant_a_plan: {}, variant_b_plan: {} }),
    statuses: [502],
  })),
  // ── api/kb.js: the daily digest and a page ingest ──
  { id: 'kb daily-digest', path: '/api/kb', q: { action: 'daily-digest' }, body: () => ({}), minCalls: 1, reads: (t) => /"digest_md":"sample/.test(t),
    setup: (w) => w.db.insert('kb_knowledge', { workspace_id: 'ws-' + B.slug, status: 'summarized', added_at: new Date().toISOString(), title: 'Rival adds a loyalty tier', summary: 'Rival launched a loyalty tier.', key_points: [], market: homeOf(B), vertical: 'news', url: 'https://rival.example/news' }) },
  { id: 'kb ingest', path: '/api/kb', q: { action: 'ingest' }, body: () => ({ url: 'https://rival.example/story', added_by: 'op' }), minCalls: 1,
    setup: (w) => w.db.route((u) => u.startsWith('https://rival.example/'), () => ({ ok: true, status: 200, headers: { get: (k) => (/content-type/i.test(k) ? 'text/html' : null) }, text: async () => '<html><head><title>Rival adds a loyalty tier</title></head><body><p>' + 'A rival news publisher launched a loyalty tier: 10% off for subscribers, a bundle price on bestsellers and free shipping over a threshold, from today. '.repeat(6) + '</p></body></html>', json: async () => ({}) })) },
  // ── the provider probe (an operator call: one word back) ──
  { id: 'probe', path: '/api/public-config', q: { probe: '1' }, body: null, cron: true, minCalls: 1 },
];

/** A generator the routers declare that is not driven here, and why. Adding to this list is a decision with a reason. */
const EXEMPT = {
  'music-compose': 'sends the operator-edited brief to a music model; no language-model prompt is built',
  tts: 'speaks the text it is handed through a voice provider; no language-model prompt is built',
  'video-generate': 'sends the caller\'s own prompt to a video provider; no language-model prompt is built',
  'daily-calendar': 'not a generator (and 500s on main: smart-brain-plan.horizonCoverage never existed)',
  approve: 'builds exactly what preview builds (the same copy and strategy prompts, driven above)',
  'generate-asset': 'rebuilds one asset of a slot through the same buildCampaign preview runs (the same copy and strategy prompts, driven above)',
  'regenerate-asset': 'the same rebuild as generate-asset, through buildCampaign (driven above as preview)',
  'launch-visuals': 'builds image prompts from the brand record and image-prompt.js; it calls no language model',

};

/**
 * Every source file that calls a model, and where it is driven. A new file
 * that calls a model and is in neither list fails here.
 */
const DRIVEN_FILES = {
  'api/ai/generate.js': 'generate.js modes', 'api/brain.js': 'console-chat, access-narrative', 'api/kb.js': 'kb ingest + daily digest',
  'api/public-config.js': 'probe', 'api/ai/pipeline/strategy.js': 'strategy', 'api/ai/pipeline/variant.js': 'variant', 'api/ai/pipeline/html.js': 'html', 'api/ai/pipeline/score.js': 'score',
  'api/_shared/pipeline-core.js': 'every pipeline stage', 'api/_shared/smart-brain-plan.js': 'preview / generate-slot', 'api/_shared/brain-agent.js': 'team-chat, agent-analyze, agent-chat',
  'api/_shared/feature-agent.js': 'modules: analyst + critic + reviser', 'api/_shared/quality-loop.js': 'mailer_full (contract pass) + modules', 'api/_shared/lp-design-loop.js': 'modules',
  'api/_shared/agentic-orchestrator.js': 'agentic-run', 'api/_shared/agentic-ideation.js': 'agentic-run', 'api/_shared/brand-llm.js': 'brand-chat', 'api/_shared/social-core.js': 'social-run-daily',
  'api/_shared/platform-agents-core.js': 'modules: one platform agent', 'api/_shared/telesuite-core.js': 'telesuite ops', 'api/_shared/calendar-generate.js': 'calendar-generate (maxpower)',
  'api/_shared/calendar-trigger.js': 'trigger-mailer', 'api/_shared/landing-page-core.js': 'landing-page', 'api/_shared/competitor-universe.js': 'modules: discoveryPrompt',
  'api/_shared/ci-enrich.js': 'modules: buildPrompt', 'api/_shared/kb-files.js': 'modules: analyse', 'api/_shared/brand-extract.js': 'modules: observeVoice',
  'api/_shared/brand-suggest.js': 'modules: suggest', 'api/_shared/data-validation-core.js': 'analysis-narrative / modules', 'api/_shared/ingest-guardrail.js': 'modules: phase2',
  'api/_shared/reference-intel.js': 'modules: VISION_INSTRUCTION', 'api/_shared/ad-angle-lab.js': 'ad-angle-lab', 'api/_shared/owner-desk-server.js': 'launch-concepts, ad-fix, review-mine',
};
const EXEMPT_FILES = {
  'api/_shared/llm.js': 'the provider cascade itself; it builds no prompt',
  'api/_shared/lifecycle-mailer-build.js': 'tenant zero\'s lifecycle programme, refused for every other workspace (lifecycle-build-mailer answers 409 here); its copy request ends with calendar-trigger\'s mailerCopySpec, the contract trigger-mailer is driven with',
  'api/_shared/brain-generate.js': 'the legacy slot engine is tenant zero\'s content library and refuses every other workspace (generate answers 409 here); its request ends with slotCopySpec, asserted by the static check below',
  'api/_shared/competitor-core.js': 'the sheet-era discovery reads the Google Sheet first, which this deployment does not configure; its request ends with the competitor.discover contract (static check below)',
  'api/_shared/workspace-connections-core.js': 'the connection key check sends the same OutputContract.PROBE request the provider probe (driven) sends',
};

/* ── the judge ───────────────────────────────────────────────────────────── */

/** Problems with one recorded call (empty = it states its output). */
function judge(call, tag) {
  const oc = OC();
  const p = String(call.prompt || '');
  const b = oc.read(p);
  const out = [];
  if (!b) return [`${tag} [${call.stage}]: no OUTPUT REQUIREMENT block … ${p.slice(-200).replace(/\s+/g, ' ')}`];
  if (b.trailing) out.push(`${tag} [${call.stage}]: the block is not the end of the prompt (followed by "${b.trailing.slice(0, 80)}")`);
  if ((p.match(/=== OUTPUT REQUIREMENT ===/g) || []).length !== 1) out.push(`${tag} [${call.stage}]: more than one OUTPUT REQUIREMENT block`);
  if (!b.id) out.push(`${tag} [${call.stage}]: the block names no contract`);
  if (!b.returns) out.push(`${tag} [${call.stage}]: the block names no deliverable`);
  if (!b.format) out.push(`${tag} [${call.stage}]: the block names no format`);
  if (!b.kind) out.push(`${tag} [${call.stage}]: the block names no kind`);
  if (!b.forbid) out.push(`${tag} [${call.stage}]: the block says nothing about what not to return`);
  if (call.json && b.format !== 'json') out.push(`${tag} [${call.stage}] ${b.id}: the caller parses JSON (JSON response mode) but the contract asks for ${b.format}`);
  if (!call.json && b.format === 'json') out.push(`${tag} [${call.stage}] ${b.id}: the contract asks for JSON but the request is not in JSON response mode`);
  if (b.format === 'json' && !b.keys.length) out.push(`${tag} [${call.stage}] ${b.id}: a JSON contract that names no key`);
  const spec = oc.lastSpec(b.id);
  if (!spec) out.push(`${tag} [${call.stage}] ${b.id}: the block was not rendered by output-contract.js`);
  else if (spec.missing !== false && !b.missing) out.push(`${tag} [${call.stage}] ${b.id}: no rule for missing data`);
  return out;
}

/* ── the world ───────────────────────────────────────────────────────────── */
async function makeWorld() {
  const w = await A.world({ routers: EXTRA_ROUTERS });
  const uid = 'user-' + B.slug;
  const tok = H.jwtShaped(uid);
  const ws = 'ws-' + B.slug;
  w.db.addUser(tok, uid, B.slug + '@example.test').addWorkspace(ws, uid, F.workspaceRow(B, ws)).setActive(uid, ws);
  w.db.insert('smart_agents', { id: 'agent_brand', workspace_id: ws, level: 'brand', name: B.name + ' Assistant', market: homeOf(B), persona: {}, catalog_scope: {}, active: true });
  for (const reg of (B.regions || [])) {
    for (const p of B.catalogue) {
      w.db.insert('brand_catalog_products', { workspace_id: ws, region: String(reg.code).toLowerCase(), sku: p.handle, handle: p.handle, title: p.title, product_type: p.product_type, collections: [], price: p.price, currency: reg.currency || '', image_url: p.image, product_url: (B.website || '') + '/products/' + p.handle });
    }
  }
  if (B.website) { const o = new URL(B.website).origin; w.db.route((u) => u.startsWith(o), () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => 'not found', json: async () => ({}) })); }
  w.db.workspaces['ws-oldest'].created_at = '2026-01-01T00:00:00.000Z';
  w.db.syncIdentityTables();
  w.auth = { state: 'anonymous', headers: { authorization: 'Bearer ' + tok } };
  return w;
}

/** The scripted model answers each prompt with exactly the shape its block asked for. */
function byContract(opts) {
  const oc = OC();
  const b = oc.read(String(opts.systemPrompt || '') + '\n---\n' + String(opts.userMessage || ''));
  const spec = b && oc.lastSpec(b.id);
  if (!spec) return null;
  if (spec.id === 'kicksgpt.turn') return JSON.stringify({ action: 'final', reply: 'sample' });
  return oc.sample(spec);
}

async function drive(w, g, opts) {
  w.reset();
  if (g.setup) g.setup(w);
  w.llm.respond = opts && opts.contract ? byContract : null;
  const json = g.body ? g.body() : undefined;
  const auth = g.cron ? { state: 'server', headers: { authorization: 'Bearer ' + H.CRON } } : w.auth;
  const res = await w.request(g.path, Object.assign({ query: g.q, json, method: json ? 'POST' : 'GET' }, auth));
  w.llm.respond = null;
  return { res, calls: w.llm.calls.slice() };
}

/* ═══ 0. the module: one spec, both directions ═════════════════════════════ */

test('the browser copy of output-contract.js is byte-identical to the server\'s', () => {
  const server = fs.readFileSync(OC_PATH, 'utf8');
  const browser = fs.readFileSync(path.join(ROOT, 'output-contract.js'), 'utf8');
  expect(browser === server, 'output-contract.js (served to pages) drifted from api/_shared/output-contract.js: cp api/_shared/output-contract.js output-contract.js').toBe(true);
});

test('a block reads back as the spec it was rendered from, and the spec parses and validates the answer', () => {
  const oc = require(OC_PATH);
  const spec = { id: 'unit.json', kind: 'data', format: 'json', brand: 'Acme', region: 'UK', returns: 'ONE JSON object: a unit.',
    schema: { title: { type: 'string', max: 10 }, items: { type: 'array', count: [1, 2], items: { type: 'object', of: { n: 'integer' } } }, note: { type: 'string', required: false } } };
  const p = oc.append('TASK', spec);
  const b = oc.read(p);
  expect(b).toMatchObject({ id: 'unit.json', kind: 'data', format: 'json', keys: ['title', 'items', 'note'], trailing: '' });
  expect(b.missing).toContain('[DATA REQUIRED BEFORE LAUNCH: <field>, Acme, UK]');
  expect(oc.parse('```json\n{"title":"ok","items":[{"n":1}]}\n```', spec)).toEqual({ title: 'ok', items: [{ n: 1 }] });
  expect(oc.validate({ title: 'far too long a title', items: [] }, spec)).toEqual(['title is 20 characters, over 10', 'items has 0 items, outside 1-2']);
  expect(oc.validate(JSON.parse(oc.sample(spec)), spec)).toEqual([]);
  const html = { id: 'unit.html', kind: 'asset', format: 'html', returns: 'ONE page.' };
  expect(oc.parse('Here you go:\n```html\n<!doctype html><html><body>x</body></html>\n```', html)).toBe('<!doctype html><html><body>x</body></html>');
  expect(() => oc.block({ id: 'x', format: 'json', returns: 'y' })).toThrow(/names its keys/);
});

/* ═══ 1. every generator the routers declare is driven, or exempt ══════════ */

test('every generator the routers declare is driven here, or exempt with its reason', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const keysOf = (c, name) => {
    const m = new RegExp(`const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};?`).exec(c);
    return m ? [...m[1].matchAll(/^\s*'?([a-z][a-z0-9_-]*)'?\s*:/gim)].map((x) => x[1]) : [];
  };
  const declared = new Set([
    ...keysOf(read('api/brain.js'), 'MODEL_FEATURE'),
    ...keysOf(read('api/calendar.js'), '_CAL_FEATURE').filter((k) => k !== 'triggermailer'),
    ...keysOf(read('api/ai/generate.js'), 'MODE_FEATURE'),
    ...PIPELINE,
    ...(/const GENERATES = new Set\(\[([^\]]*)\]\)/.exec(read('api/calendar.js')) || ['', ''])[1].match(/[a-z-]+/g),
    'generate-slot', 'plan', 'sync-daily',
  ]);
  expect(declared.size, 'the router enumeration found too few generators to mean anything').toBeGreaterThan(25);
  const driven = new Set(GENERATORS.map((g) => g.id));
  expect([...declared].filter((k) => !driven.has(k) && !EXEMPT[k]).sort(), 'a generator with no entry here and no stated exemption').toEqual([]);
  expect(Object.keys(EXEMPT).filter((k) => driven.has(k)), 'an exemption names a generator the gate now drives').toEqual([]);
});

test('every source file that calls a model is driven here or named with its reason, and renders its contract', () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const rel = d + '/' + e.name; if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel); } else if (e.name.endsWith('.js')) files.push(rel); } };
  walk('api'); walk('lib');
  const callers = files.filter((rel) => {
    const c = fs.readFileSync(path.join(ROOT, rel), 'latin1');
    return /\bcallLLM\s*\(\s*\{|\bcallLLM\(opts\)|await\s+llm\s*\(\s*\{|P\.llm\s*\(\s*\{|callLLMTiered\s*\(\s*\{|api\.anthropic\.com\/v1\/messages|:generateContent/.test(c)
      && !/\/adapters\//.test(rel) && !/image\.js$|video-core\.js$|creative-image\.js$|pipeline\/images\.js$|gif-core\.js$/.test(rel);
  });
  expect(callers.length, 'too few model callers found to mean anything').toBeGreaterThan(25);
  const unlisted = callers.filter((rel) => !DRIVEN_FILES[rel] && !EXEMPT_FILES[rel]).sort();
  expect(unlisted, 'a file calls a model and is neither driven by this gate nor exempt by name').toEqual([]);
  // Every caller but the cascade itself renders an OUTPUT REQUIREMENT from the shared module.
  const noContract = callers.filter((rel) => rel !== 'api/_shared/llm.js' && !/output-contract\.js|\bP\.OC\b|\bOC\.(append|block)\b/.test(fs.readFileSync(path.join(ROOT, rel), 'latin1')));
  expect(noContract, 'a model caller that never renders an output contract').toEqual([]);
});

/* ═══ 2. every recorded prompt, through the shipped routers ════════════════ */

test.describe('server prompts, through the shipped routers', () => {
  let w;
  // A fresh world per test: each pass spends the fixture wallet, and a pass
  // that ran out of credits would be judging refusals, not prompts.
  test.beforeEach(async () => { w = await makeWorld(); });
  test.afterEach(async () => { if (w) await w.close(); w = null; });

  test('every prompt a generator sends ends with an OUTPUT REQUIREMENT the caller\'s parser agrees with', async () => {
    test.setTimeout(600_000);
    const problems = [];
    let judged = 0;
    const seen = new Set();
    for (const g of GENERATORS) {
      const { res, calls } = await drive(w, g);
      const tag = `${g.path}?${new URLSearchParams(g.q)} [${g.id}]`;
      if (res.status >= 500 && !(g.statuses || []).includes(res.status)) problems.push(`${tag}: answered ${res.status}: ${String(res.text).slice(0, 160)}`);
      if ((g.minCalls || 0) > calls.length) problems.push(`${tag}: reached the model ${calls.length} times, expected at least ${g.minCalls} (status ${res.status}: ${String(res.text).slice(0, 120)})`);
      for (const c of calls) { judged++; seen.add(c.stage); problems.push(...judge(c, tag)); }
    }
    expect(judged, 'too few prompts were judged to mean anything').toBeGreaterThan(40);
    expect(seen.size, 'too few distinct stages were judged').toBeGreaterThan(25);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('answered with exactly the shape its block asked for, every caller reads it', async () => {
    test.setTimeout(600_000);
    const problems = [];
    let answered = 0;
    for (const g of GENERATORS) {
      const { res, calls } = await drive(w, g, { contract: true });
      const tag = `${g.path}?${new URLSearchParams(g.q)} [${g.id}]`;
      answered += calls.length;
      if (res.status >= 400 && !(g.statuses || []).includes(res.status)) problems.push(`${tag}: answered ${res.status} to a reply in its own contract's shape: ${String(res.text).slice(0, 200)}`);
      if (/json_parse_failed|unparseable|copy JSON incomplete|template-fallback/.test(String(res.text))) problems.push(`${tag}: could not read a reply in its own contract's shape: ${String(res.text).slice(0, 200)}`);
      if (g.reads && !g.reads(String(res.text))) problems.push(`${tag}: answered in its own contract's shape, the reply never reached the response: ${String(res.text).slice(0, 200)}`);
      for (const c of calls) problems.push(...judge(c, tag + ' (contract pass)'));
    }
    expect(answered, 'too few prompts were answered by contract').toBeGreaterThan(40);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('the prompts no router reaches here end with their contract too, and read their own sample', async () => {
    test.setTimeout(240_000);
    const req = (rel) => require(path.join(ROOT, rel));
    const problems = [];
    const runs = {
      'feature-agent analyst': () => req('api/_shared/feature-agent.js').runAnalyst({ feature: 'analytics', inputs: { orders: 12 } }),
      'feature-agent critic+revise': () => req('api/_shared/feature-agent.js').runCritic({ feature: 'ad', content: { headline: 'Back again', primary_text: 'For you' }, rubric: req('api/_shared/feature-agent.js').RUBRICS.ad }),
      'quality-loop': () => req('api/_shared/quality-loop.js').runQualityLoop({ spec: { variant_a: { sections: [] }, variant_b: { sections: [] }, strategy: { name: 'x' } }, brief: 'b', brand: F.recordOf(B) }),
      'lp-design-loop': () => req('api/_shared/lp-design-loop.js').runDesignLoop({ html: '<!doctype html><html><head><title>x</title></head><body><h1>x</h1></body></html>', brand: F.recordOf(B), timeBoxMs: 60000 }),
      'kb-files analyse': () => req('api/_shared/kb-files.js').analyse({ name: 'plans.txt', text: 'The plan renews monthly and can be cancelled online at any time.', brand: F.recordOf(B) }),
      'ingest-guardrail': () => req('api/_shared/ingest-guardrail.js').phase2({ title: 'Rival adds a loyalty tier', url: 'https://rival.example/news', text: 'Rival launched a loyalty tier with 10% off.' }),
      'brand-extract voice': () => req('api/_shared/brand-extract.js').observeVoice([{ text: 'We print the news that matters, every morning, for every reader.', source_url: B.website + '/', where: 'p' }], {}),
      'brand-suggest': () => req('api/_shared/brand-suggest.js').suggest('tagline', F.recordOf(B)),
      'data-validation narrative': () => req('api/_shared/data-validation-core.js').narrate({ summary: { total: 2, mismatch: 1 }, checks: [{ metric: 'revenue', verdict: 'MISMATCH', delta: 0.1, note: 'n' }] }),
      'platform agent': () => req('api/_shared/platform-agents-core.js').runAgent('meta', { brand: F.recordOf(B) }),
    };
    // What a caller must have READ from a reply in its own contract's shape.
    const reads = {
      'kb-files analyse': (r) => r && r.summary === 'sample value',
      'ingest-guardrail': (r) => r && r.relevant === true && !r.skipped,
      'feature-agent analyst': (r) => r && r.grounded === true,
      'brand-suggest': (r) => r && r.ok !== false,
    };
    for (const [name, run] of Object.entries(runs)) {
      for (const contract of [false, true]) {
        w.reset();
        w.llm.respond = contract ? byContract : null;
        let threw = null;
        let got;
        try { got = await run(); } catch (e) { threw = e; }
        if (contract && reads[name] && !threw && !reads[name](got)) problems.push(`${name}: answered in its own contract's shape, the caller did not read it: ${JSON.stringify(got).slice(0, 200)}`);
        w.llm.respond = null;
        const calls = w.llm.calls.slice();
        if (threw) problems.push(`${name}${contract ? ' (contract)' : ''}: threw ${threw.message}`);
        if (!calls.length && !/platform agent/.test(name)) problems.push(`${name}: reached no model`);
        for (const c of calls) problems.push(...judge(c, name + (contract ? ' (contract pass)' : '')));
      }
    }
    // Built prompts a test can read without a call: discovery, enrichment and the vision instruction.
    const oc = OC();
    const built = {
      'competitor-universe discovery': (() => { const d = req('api/_shared/competitor-universe.js').discoveryPrompt(F.recordOf(B), { existingDomains: [] }); return d.ok ? d.system + '\n---\n' + d.user : null; })(),
      'ci-enrich email': (() => { const b = req('api/_shared/ci-enrich.js').buildPrompt('email', { sender: 'r', subject: 's', plain_text: 'body' }); return b.systemPrompt + '\n---\n' + b.userMessage; })(),
      'reference-intel vision': req('api/_shared/reference-intel.js').VISION_INSTRUCTION,
    };
    for (const [name, p] of Object.entries(built)) {
      if (!p) { problems.push(`${name}: built no prompt`); continue; }
      problems.push(...judge({ prompt: p, stage: name, json: /^ci-enrich|^competitor/.test(name) }, name));
      expect(oc.read(p), name).toBeTruthy();
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

/* ═══ 3. asset prompts handed to the operator ══════════════════════════════ */

test('every master prompt (copied to another model) closes with its contract, and its limits are the asset contracts\'', () => {
  const mp = require(path.join(ROOT, 'api/_shared/master-prompt.js'));
  const oc = require(OC_PATH);
  const ac = require(path.join(ROOT, 'api/_shared/asset-contracts.js'));
  for (const o of [{ assetType: 'mailer', variant: 'V1' }, { assetType: 'mailer', variant: 'V2' }, { assetType: 'landing_page' }, { assetType: 'ad', platform: 'meta' }, { assetType: 'ad', platform: 'google' }, { assetType: 'ad', platform: 'tiktok' }]) {
    const p = mp.buildMasterPrompt(Object.assign({ brand: F.recordOf(B) }, o));
    const b = oc.read(p);
    expect(b, `${o.assetType}/${o.variant || o.platform}`).toBeTruthy();
    expect(b.trailing).toBe('');
    expect(b.kind).toBe('asset');
    expect(p.split('\n')[0], 'an asset prompt still opens by naming the deliverable').toMatch(/DELIVERABLE: ONE COMPLETE|^You are/);
    expect(p).not.toMatch(/If you must assume a detail/);
  }
  const meta = mp.buildMasterPrompt({ brand: F.recordOf(B), assetType: 'ad', platform: 'meta' });
  expect(meta).toContain(`primary text at most ${ac.slotLimit('ad.meta.static', 'primary_text')} characters`);
  const google = mp.buildMasterPrompt({ brand: F.recordOf(B), assetType: 'ad', platform: 'google' });
  expect(google).toContain(`each at most ${ac.slotLimit('ad.google.rsa', 'headlines')} characters`);
  // An element prompt says it returns ONE part, and closes with what that part is.
  const el = mp.buildElementPrompt('A close shot of the product.', { produces: 'hero', partOf: 'a complete email mailer' });
  expect(el.split('\n')[0]).toMatch(/^DELIVERABLE: ONE HERO PHOTOGRAPH — ONE ELEMENT/);
  expect(el.trim().split('\n').slice(-1)[0]).toMatch(/^OUTPUT: the image only\./);
});

/* ═══ 4. the browser: what a page copies or sends ══════════════════════════ */

const BT = require('./lib/brand-theme-harness');
BT.define('oc-quill', { name: B.name, slug: B.slug, palette: B.palette || {}, typography: B.typography || {}, regions: B.regions || [], record: F.recordOf(B) });

async function openWith(page, file) {
  await BT.install(page, 'oc-quill');
  await page.addInitScript(() => {
    window.__clips = [];
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__clips.push(String(t)); return Promise.resolve(); }, readText: () => Promise.resolve('') } }); } catch (_) {}
    window.open = () => null;
  });
  await BT.open(page, file, 'oc-quill');
}
const pageJudge = (p, what) => {
  const oc = require(OC_PATH);
  const b = oc.read(p);
  const out = [];
  if (!b) return [`${what}: no OUTPUT REQUIREMENT block … ${String(p).slice(-200).replace(/\s+/g, ' ')}`];
  if (b.trailing) out.push(`${what}: the block is not the end`);
  if (!b.returns || !b.format || !b.kind || !b.forbid) out.push(`${what}: an incomplete block`);
  return out;
};

test('the Studio\'s email prompt and the design-to-HTML request end with the block; the hero prompt says it is one element', async ({ page }) => {
  test.setTimeout(120_000);
  await openWith(page, 'studio');
  await page.waitForFunction(() => typeof window.buildEmailAssetPrompt === 'function' && window.OutputContract, null, { timeout: 20_000 });
  const got = await page.evaluate((hero) => {
    window.S = window.S || {};
    window.S.strategy = window.S.strategy || {};
    window.S.strategy.products = [{ n: hero.title, price: hero.price, i: hero.image }];
    window.S.finalProds = window.S.strategy.products;
    window.S.prompt = window.S.activePrompt = 'Bring lapsed readers back with the weekend edition';
    const r = {};
    for (const v of ['A', 'B']) {
      try { r['email ' + v] = window.buildEmailAssetPrompt(window.RegionContext && window.RegionContext.home, v); } catch (e) { r['email ' + v] = 'THREW ' + e.message; }
      try { r['hero ' + v] = window.buildHeroPhotoPrompt(window.RegionContext && window.RegionContext.home, v); } catch (e) { r['hero ' + v] = 'THREW ' + e.message; }
    }
    return r;
  }, B.catalogue[0]);
  const problems = [];
  for (const v of ['A', 'B']) {
    problems.push(...pageJudge(got['email ' + v], 'studio email ' + v));
    expect(got['email ' + v]).not.toMatch(/write 3 subject lines and 1 preheader from the copy below/);
    const hero = String(got['hero ' + v]);
    expect(hero.split('\n')[0], 'the hero prompt names itself one element').toMatch(/^DELIVERABLE: HERO PHOTOGRAPH \(image\) - ONE ELEMENT/);
    expect(hero.trim().split('\n').slice(-1)[0]).toMatch(/^OUTPUT: the image only\./);
  }
  // The design-to-HTML request (2026-10-17) no longer goes straight to a
  // provider with a prompt the page wrote: it asks the app's own
  // /api/ai/generate in mode mailer_full, whose prompt the server builds and
  // closes with that mode's block (judged by the router pass above).
  const sent = await page.evaluate(async () => {
    const seen = [];
    const real = window.fetch;
    window.fetch = (u, init) => {
      if (/api\.anthropic\.com/.test(String(u))) seen.push({ provider: true });
      if (/\/api\/ai\/generate/.test(String(u))) { seen.push(JSON.parse(init.body)); return Promise.resolve(new Response('{}', { status: 500 })); }
      return real(u, init);
    };
    try { if (typeof window.analyzeImageAndBuildEmail === 'function') await window.analyzeImageAndBuildEmail('data:image/png;base64,AAAA', [], 'Bring readers back', window.RegionContext && window.RegionContext.home); } catch (_) {}
    window.fetch = real;
    return seen;
  });
  expect(sent.length, 'the design-to-HTML request never left (nothing judged)').toBeGreaterThan(0);
  expect(sent.filter((b) => b.provider), 'the page called a model provider directly').toEqual([]);
  for (const b of sent) expect(b.mode).toBe('mailer_full');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the asset library, Ad Campaigns and Landing Pages copy prompts that end with the block', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = [];
  // Ad Campaigns: the client-side master prompt for each channel.
  await openWith(page, 'ad-campaigns.html');
  await page.waitForFunction(() => window.OutputContract, null, { timeout: 20_000 });
  for (const ch of ['g', 'm', 't']) {
    // The button sits in a channel tab that may be closed: dispatch its own click.
    const found = await page.evaluate((c) => { window.__clips = []; const b = document.querySelector(`[data-mp="${c}"]`); if (b) b.click(); return !!b; }, ch);
    if (!found) { problems.push(`ad-campaigns ${ch}: no copy-master-prompt control`); continue; }
    await page.waitForFunction(() => window.__clips.length > 0, null, { timeout: 5000 }).catch(() => {});
    const clips = await page.evaluate(() => window.__clips.slice());
    if (!clips.length) { problems.push(`ad-campaigns ${ch}: the copy-master-prompt control copied nothing`); continue; }
    problems.push(...pageJudge(clips[clips.length - 1], 'ad-campaigns ' + ch));
  }
  // Landing Pages: the AI prompt for a page brief.
  await openWith(page, 'landing-pages.html');
  await page.waitForFunction(() => window.OutputContract, null, { timeout: 20_000 });
  const lp = await page.evaluate(() => {
    const el = document.querySelector('[data-lp-prompt]');
    window.__clips = [];
    if (el) el.click();
    return { found: !!el };
  });
  if (lp.found) {
    await page.waitForFunction(() => window.__clips.length > 0, null, { timeout: 5000 }).catch(() => {});
    const clips = await page.evaluate(() => window.__clips.slice());
    if (!clips.length) problems.push('landing-pages: the AI prompt control copied nothing');
    else problems.push(...pageJudge(clips[0], 'landing-pages prompt'));
  }
  // The asset library: the "AI prompt" button copies buildPrompt(item) for a
  // mailer, an ad or a landing page; each kind is built as the button builds it.
  await openWith(page, 'assets.html');
  await page.waitForFunction(() => window.OutputContract && window.AssetLibrary, null, { timeout: 20_000 });
  const built = await page.evaluate(() => ({
    mailer: window.AssetLibrary.buildPrompt({ kind: 'mailer', name: 'Weekend edition', raw: { campaign_title: 'Weekend edition', brief: 'Bring readers back' } }),
    ad: window.AssetLibrary.buildPrompt({ kind: 'ad', name: 'Weekend edition', raw: { channel: 'meta', headline: 'Back again' } }),
    landing: window.AssetLibrary.buildPrompt({ kind: 'landing', name: 'Weekend edition', raw: { hero: 'Back again', channel: 'meta' } }),
  }));
  for (const [k, p] of Object.entries(built)) problems.push(...pageJudge(p, 'assets ' + k));
  expect(problems, problems.join('\n')).toEqual([]);
});
