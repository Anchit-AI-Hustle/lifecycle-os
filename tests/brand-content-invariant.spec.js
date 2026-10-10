/**
 * Brand X's output carries brand X's context, and nobody else's (2026-10-10).
 * ---------------------------------------------------------------------------
 * The operator's words, non-negotiable: "Ensure respective brand and content
 * context match always". Everything the platform generates or shows for a
 * brand must carry only THAT brand's name, palette, fonts, logo, voice and
 * banned words, claims, offers, legal entity, store URLs, home market,
 * catalogue, reviews, competitors and cohorts - never tenant zero's
 * (KNICKGASM, data/brands/_default.json) and never another brand's - and where
 * the brand has no data the output says [DATA REQUIRED BEFORE LAUNCH: ...]
 * instead of a substitute.
 *
 * THE BRANDS (tests/lib/brand-invariant-fixtures.js). Three synthetic records
 * with deliberately unusual, recognisable values: Quillforth Gazette (an
 * Indian news brand, home IN, INR, its own catalogue), Brambleweld Larder (a
 * British food brand, home UK, GBP, its own catalogue) and Ozzlewick (a name
 * and nothing else). Tenant zero's tokens are DERIVED from its record and its
 * built catalogue, so they cannot drift from what they describe.
 *
 * HOW THE SERVER HALF WORKS. Every generator is driven through its SHIPPED
 * router (api/brain.js, api/calendar.js, api/ai/generate.js, the five
 * api/ai/pipeline stages, api/public-config.js, api/competitor.js, api/kb.js)
 * over a real socket (tests/agents-harness.js), in two worlds:
 *   device    production's state: no DATABASE_URL, a mobile+PIN session, and
 *             the brand CARRIED on the request (brand-runtime.carriedBrand);
 *   account   a signed-in account whose ACTIVE workspace is the brand, read
 *             through tests/lib/fake-supabase.js, with its own catalogue rows
 *             in brand_catalog_products;
 * and, for the asset generators, with every model provider DOWN (the template
 * paths). The scripted llm.js records every PROMPT, so what a generation told
 * a model is asserted exactly like what it returned.
 *
 * WHAT IS ASSERTED, per brand, per generator, per world:
 *   foreign   no token of tenant zero's or of either other brand in the
 *             response or in any prompt the request built;
 *   own       the brand's own name (and, for an asset, its palette, type,
 *             claims, legal sender or catalogue) present where its record has
 *             them;
 *   marker    for the brand with no data, a DATA REQUIRED marker, never a
 *             substitute;
 *   market    region, currency and market follow the brand's HOME market,
 *             never a default 'US'.
 * Every generator the routers DECLARE (brain.js MODEL_FEATURE, calendar.js's
 * metered actions and its generating smart-brain actions, generate.js
 * MODE_FEATURE, every file in api/ai/pipeline) must be in the table or in
 * EXEMPT with its reason, so a new generator without coverage fails here.
 *
 * THE BROWSER HALF renders every app page in Chromium with each brand ACTIVE
 * in the device store (tests/lib/brand-theme-harness.js, the harness the
 * theme gate uses) and reads what a person sees: text, every attribute, every
 * link and image source, and the shell's brand tokens. Platform chrome - the
 * Lifecycle OS mark - is the platform's, never a tenant's
 * (docs/platform-identity.md), and is not a brand token.
 *
 * Run: npx playwright test tests/brand-content-invariant.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const A = require('./agents-harness');
const H = require('./router-harness');
const F = require('./lib/brand-invariant-fixtures');

const ROOT = A.ROOT;
const PIPELINE = fs.readdirSync(path.join(ROOT, 'api', 'ai', 'pipeline')).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).sort();
const EXTRA_ROUTERS = Object.assign({ '/api/competitor': 'api/competitor.js', '/api/kb': 'api/kb.js' },
  Object.fromEntries(PIPELINE.map((s) => ['/api/ai/pipeline/' + s, `api/ai/pipeline/${s}.js`])));

/** The harness's own fixture brand (the OLDEST workspace in the account world): a stranger here too. */
const HARNESS_ZERO = [['harness oldest workspace name', 'Oldest Brand'], ['harness oldest workspace host', 'oldest.example']];

function homeOf(b) { return ((b.regions || []).find((r) => r.home) || (b.regions || [])[0] || {}).code || ''; }
function productsOf(b) { return (b.catalogue || []).map((p) => ({ title: p.title, handle: p.handle, price: p.price, image: p.image, product_type: p.product_type })); }

/** Foreign tokens in a haystack, the harness's oldest workspace included. */
function foreign(hay, b) {
  const found = F.leaksIn(hay, b);
  const low = String(hay || '').toLowerCase();
  for (const [label, needle] of HARNESS_ZERO) {
    const i = low.indexOf(needle.toLowerCase());
    if (i >= 0) found.push({ label, needle, at: String(hay).slice(Math.max(0, i - 60), i + needle.length + 60).replace(/\s+/g, ' ') });
  }
  return found;
}

/* ── the generators ──────────────────────────────────────────────────────── */
/*
 * id        the label the router uses (enumeration matches on it)
 * path/q    the router and query; body(b) the request body for brand b
 * modes     the worlds it runs in
 * own       token LABELS (tests/lib/brand-invariant-fixtures.tokensOf) the
 *           output + prompts must carry when the brand has them
 * marker    the bare brand's output must carry a DATA REQUIRED marker
 * templates also run with every model provider down (device world)
 * statuses  non-2xx answers that are correct for the world, with the reason
 * market(b, res, prompts) -> problems for the home-market rule
 */
const PROMPT_MARKET = (label) => (b, out, prompts) => {
  const home = homeOf(b);
  const p = [];
  if (home && !new RegExp(`${label}\\s*:?\\s*${home}\\b`).test(prompts)) p.push(`the prompt does not brief the home market ${home} (${label})`);
  if (!home && new RegExp(`${label}\\s*:?\\s*US\\b`).test(prompts)) p.push(`a brand with no regions was briefed as US (${label})`);
  return p;
};
const ENTRY_MARKET = (pick) => (b, out) => {
  let j = null; try { j = JSON.parse(out); } catch (_) { return ['the response is not JSON']; }
  const markets = pick(j).filter((m) => m !== undefined && m !== null);
  const home = homeOf(b);
  const bad = markets.filter((m) => (home ? String(m).toUpperCase() !== home : String(m).toUpperCase() === 'US'));
  if (bad.length) return [`market(s) ${[...new Set(bad)].join(',')} where the home market is ${home || '(none declared)'}`];
  // A brand that declares no market may carry none; one that declares a home must carry it.
  return (markets.length || !home) ? [] : ['no market on the output to check'];
};

// An inline slot is a REQUEST body, so it can carry whatever brand a stale tab
// or a hostile caller puts on it. It carries tenant zero's own record here: the
// router must replace it with the brand THIS request resolved, never build it.
const FORGED_BRAND = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', '_default.json'), 'utf8')); } catch (_) { return null; } })();
const ENTRY = (b) => ({ id: 'inv-slot', date: '2026-10-20', cohort: { name: 'At Risk', size: 400, rules: ['last order 90-180 days'] }, objective: 'reactivation', channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], brand: FORGED_BRAND });

const GENERATORS = [
  // ── api/brain.js: the assistants ──
  { id: 'brand-chat', path: '/api/brain', q: { action: 'brand-chat' }, body: () => ({ message: 'What should we send this week?' }), modes: ['device', 'account'], own: ['name', 'domain'], market: PROMPT_MARKET('CURRENT MARKET') },
  { id: 'console-chat', path: '/api/brain', q: { action: 'console-chat' }, body: () => ({ message: 'What should ship next?' }), modes: ['device', 'account'], own: ['name'] },
  { id: 'team-chat', path: '/api/brain', q: { action: 'team-chat' }, body: () => ({ message: 'What should we plan?' }), modes: ['device', 'account'], own: ['name', 'palette.primary', 'font.heading'] },
  { id: 'agent-chat', path: '/api/brain', q: { action: 'agent-chat' }, body: () => ({ message: 'Which one should I pick?', agent_id: 'agent_brand' }), modes: ['device'], own: ['name', 'claim'] },
  { id: 'agent-analyze', path: '/api/brain', q: { action: 'agent-analyze' }, body: () => ({ message: 'What should I tell customers?' }), modes: ['device', 'account'], own: ['name'] },
  { id: 'access-narrative', path: '/api/brain', q: { action: 'access-narrative' }, body: () => ({}), modes: ['device'] },
  { id: 'analysis-narrative', path: '/api/brain', q: { action: 'analysis-narrative' }, body: () => ({}), modes: ['device'] },
  { id: 'agentic-run', path: '/api/brain', q: { action: 'agentic-run' }, body: () => ({ days: 1, withCreatives: false, tier: 'budget' }), modes: ['device', 'account'], own: ['name', 'palette.primary', 'font.heading', 'claim'], marker: true,
    statuses: { 409: (b) => (homeOf(b) ? null : 'a brand that declares no market is refused with the home-market marker (market_required), never planned as US') },
    market: ENTRY_MARKET((j) => [j.market].concat((j.campaigns || []).map((c) => c.market))) },
  { id: 'generate', path: '/api/brain', q: { action: 'generate' }, body: () => ({ slot_id: 'slot-inv-1' }), modes: ['device'], marker: true,
    statuses: { 409: 'the legacy slot engine is tenant zero\'s content library: any other brand is refused with a marker, never built as tenant zero' } },
  { id: 'social-run-daily', path: '/api/brain', q: { action: 'social-run-daily' }, body: () => ({ dry_run: true, platforms: ['instagram', 'linkedin'], date: '2026-10-20' }), modes: ['device', 'account'], own: ['name'], marker: true, templates: true },
  { id: 'mailer-assets', path: '/api/brain', q: { action: 'mailer-assets' }, body: () => ({ html: '<!doctype html><html><body><!-- IMAGE GENERATION PROMPT (hero, 1200x628): the hero product, natural light --><img src="IMAGE_HERO_URL" alt="hero"></body></html>', video: false, gif: false, persist: false }), modes: ['device'] },
  { id: 'mailer-assets (lifecycle entry)', path: '/api/brain', q: { action: 'mailer-assets' }, body: () => ({ entry_id: 'lc_2026-10-20_tb_buyers_non_engagers_UK' }), modes: ['device'], marker: true,
    statuses: { 409: 'an entry_id names a row of tenant zero\'s lifecycle programme: refused for any other brand with a marker' } },
  { id: 'platform-agents', path: '/api/brain', q: { action: 'platform-agents' }, body: () => ({}), modes: ['device'] },
  { id: 'revenue-os', path: '/api/brain', q: { action: 'revenue-os' }, body: null, modes: ['device'] },
  { id: 'telesuite', path: '/api/brain', q: { action: 'telesuite' }, body: (b) => ({ op: 'pitch', input: { product: (b.catalogue[0] || {}).title || 'the product' } }), modes: ['device', 'account'] },
  { id: 'logo', path: '/api/brain', q: { action: 'logo' }, body: () => ({}), modes: ['device', 'account'], own: ['name'] },
  { id: 'growth-os', path: '/api/brain', q: { action: 'growth-os' }, body: () => ({}), modes: ['device', 'account'] },
  { id: 'journey', path: '/api/brain', q: { action: 'journey' }, body: () => ({}), modes: ['device'] },
  { id: 'calendar-scenarios', path: '/api/brain', q: { action: 'calendar-scenarios' }, body: () => ({}), modes: ['device'] },
  { id: 'brand-tools', path: '/api/brain', q: { action: 'brand-tools' }, body: null, modes: ['device'] },
  { id: 'calendar-generate', path: '/api/brain', q: { action: 'calendar-generate' }, body: () => ({ days: 7 }), modes: ['account'] },
  { id: 'kb', path: '/api/brain', q: { action: 'kb' }, body: null, modes: ['account'] },
  // ── api/calendar.js ──
  { id: 'plan', path: '/api/calendar', q: { action: 'smart-brain-plan' }, body: () => ({ days: 14 }), modes: ['device', 'account'], own: ['name'],
    market: ENTRY_MARKET((j) => (j.entries || j.plan || []).map((e) => e.market)) },
  { id: 'sync-daily', path: '/api/calendar', q: { action: 'smart-brain-sync-daily' }, body: () => ({ days: 7 }), modes: ['device', 'account'], own: ['name'] },
  { id: 'preview', path: '/api/calendar', q: { action: 'smart-brain-preview' }, body: (b) => ({ entry: ENTRY(b) }), modes: ['device', 'account'], own: ['name', 'palette.primary', 'font.heading', 'font.body', 'claim', 'legal entity'], marker: true, templates: true,
    market: ENTRY_MARKET((j) => [j.campaign && j.campaign.market]) },
  { id: 'generate-slot', path: '/api/calendar', q: { action: 'smart-brain-generate-slot' }, body: (b) => ({ entry: Object.assign(ENTRY(b), { market: homeOf(b) || undefined }) }), modes: ['device', 'account'], own: ['name', 'palette.primary', 'font.heading', 'legal entity'], marker: true },
  { id: 'lifecycle-generate', path: '/api/calendar', q: { action: 'lifecycle-generate' }, body: () => ({ days: 7 }), modes: ['device', 'account'], marker: true },
  { id: 'lifecycle-build-mailer', path: '/api/calendar', q: { action: 'lifecycle-build-mailer' }, body: () => ({ entry: { cohort_key: 'tb_buyers_non_engagers', product_type: 'tb', date: '2026-10-20' }, force: true }), modes: ['device'], marker: true,
    statuses: { 409: 'the lifecycle programme is tenant zero\'s product lanes: refused for any other brand with a marker' } },
  { id: 'trigger-mailer', path: '/api/calendar', q: { action: 'trigger-mailer' }, body: (b) => ({ entry: { date: '2026-10-20', market: homeOf(b) || 'GLOBAL', segment: 'At-Risk', archetype: 'hero-led-editorial', content_type: 'winback', hero_product: (b.catalogue[0] || {}).title || 'the product' } }), modes: ['device', 'account'], own: ['name', 'palette.primary', 'font.heading', 'legal entity'], marker: true, templates: true },
  { id: 'generate', path: '/api/calendar', q: { action: 'generate' }, body: (b) => ({ days: 7, markets: homeOf(b) ? [homeOf(b)] : undefined, analytics: { segments: [{ name: 'At Risk', count: 400, revenue: 1000 }] } }), modes: ['device', 'account'],
    statuses: { 400: (b) => (homeOf(b) ? null : 'a brand that declares no market is told so (markets_required), never planned as US') } },
  // ── api/ai/generate.js: every mode ──
  ...['create_brief', 'concepts', 'mailer_full', 'suggested_prompts', 'chat', 'landing_page', 'autofill', 'audience_segment'].map((mode) => ({
    id: mode, path: '/api/ai/generate', q: {}, modes: ['device', 'account'], templates: mode === 'create_brief',
    body: (b) => ({ mode, brief: 'A campaign for customers who bought once and stopped.', prompt: 'A campaign for customers who bought once and stopped.', message: 'Sharpen this subject line.', surface: 'meta', chat_context: {}, selected_products: productsOf(b).map((p) => ({ name: p.title, price: p.price, image_url: p.image })) }),
    own: ['name', 'palette.primary', 'claim'].filter((l) => mode !== 'chat' || l !== 'palette.primary'),
    market: ['create_brief', 'concepts', 'mailer_full'].includes(mode) ? PROMPT_MARKET(mode === 'mailer_full' ? 'market' : 'MARKET') : null,
  })),
  { id: 'landing-page', path: '/api/ai/landing-page', q: {}, body: () => ({ brief: 'A landing page for customers who bought once and stopped.' }), modes: ['device', 'account'], own: ['name', 'palette.primary', 'claim'],
    statuses: { 502: 'the scripted model returns prose, not HTML; the PROMPT is what is judged here' } },
  // ── the five pipeline stages ──
  ...PIPELINE.map((stage) => ({
    id: stage, path: '/api/ai/pipeline/' + stage, q: {}, modes: ['device', 'account'], templates: stage === 'strategy',
    body: (b) => ({ brief: 'Bring lapsed customers back', products: productsOf(b), variant: 'A', strategy_output: { strategy: { name: 'reactivation' } }, strategy: {},
      plan: { sections: [{ id: 'hero', type: 'centered', copy: { headline: 'Back again', subcopy: 'For you', cta: 'See it' } }], subject_lines: ['Back again'], preheader: 'For you' },
      requirements: [{ slot: 'hero', prompt: 'the hero product', size: '1024x1024' }], image_style_lock: 'natural light',
      html_a: '<html><body>a</body></html>', html_b: '<html><body>b</body></html>', variant_a_plan: {}, variant_b_plan: {} }),
    // The copywriting stage is briefed with the brand block, which names the
    // sender a commercial email must carry: the brand's own, never anyone's.
    own: stage === 'score' || stage === 'images' ? [] : stage === 'variant' ? ['name', 'legal entity'] : ['name'],
    statuses: { 502: 'the scripted model returns prose, not a mailer; the stage refuses it and the PROMPT is what is judged' },
  })),
  // ── the brand layer and its neighbours ──
  { id: 'activate', path: '/api/public-config', q: { action: 'brand', op: 'activate' }, body: (b, w) => ({ id: w.wsOf(b) }), modes: ['account'], own: ['name'],
    // The SHELL tokens of a record with NO palette are tokens()'s own
    // fallbacks (#6A33D8, which is also tenant zero's accent, and a Montserrat
    // heading stack). design/lifecycle-os/CONTRACT.md records that fallback as
    // the brand layer's decision, shared by the server and the browser port
    // and measured by the theme gate's baselines; it is a known item in the
    // PR, not a generated asset. Everything else in the payload is judged.
    redact: (b, out) => (b.palette ? out : out.replace(/"tokens":\{[^}]*\}/, '"tokens":"(shell fallback, see CONTRACT.md)"')) },
  { id: 'competitor-brands', path: '/api/competitor', q: { action: 'brands' }, body: null, modes: ['account'], own: ['competitor'] },
  { id: 'kb-list', path: '/api/kb', q: { action: 'list' }, body: null, modes: ['account'] },
  { id: 'kb-brand-kit', path: '/api/kb', q: { action: 'brand-kit' }, body: null, modes: ['account'] },
];

/*
 * A generator the routers declare that this gate does not drive, and why.
 * Adding to this list is a decision with a reason, never a way to pass.
 */
const EXEMPT = {
  tts: 'speaks the text it is handed through the voice provider; it composes no brand content of its own',
  'video-generate': 'sends the caller\'s own prompt to a video provider verbatim; it composes no brand content of its own',
  'daily-calendar': 'not a generator, and answers 500 on main (daily-calendar-core calls smart-brain-plan.horizonCoverage, which this repo never had); recorded in the PR, not changed here',
};

/** Paths in a generator's request that only one world can answer, with the reason. */
function worldSkip(g, mode) {
  return g.modes.includes(mode) ? null : `runs in ${g.modes.join(' + ')} only`;
}

/* ── the worlds ──────────────────────────────────────────────────────────── */
async function makeWorld(mode) {
  const w = await A.world(Object.assign({ routers: EXTRA_ROUTERS }, mode === 'device' ? { serverMode: false } : {}));
  const toks = {};
  for (const b of F.BRANDS) {
    const uid = 'user-' + b.slug;
    const tok = H.jwtShaped(uid);
    const ws = 'ws-' + b.slug;
    w.db.addUser(tok, uid, b.slug + '@example.test').addWorkspace(ws, uid, F.workspaceRow(b, ws)).setActive(uid, ws);
    toks[b.slug] = tok;
    for (const reg of (b.regions || [])) {
      for (const p of b.catalogue) {
        w.db.insert('brand_catalog_products', { workspace_id: ws, region: String(reg.code).toLowerCase(), sku: p.handle, handle: p.handle, title: p.title, product_type: p.product_type, collections: [], price: p.price, currency: reg.currency || '', image_url: p.image, product_url: (b.website || '') + '/products/' + p.handle });
      }
    }
    // The brand's OWN site is the one host a generation may read (its
    // testimonials, its pages); it answers 404 so nothing is invented.
    if (b.website) { const o = new URL(b.website).origin; w.db.route((u) => u.startsWith(o), () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => 'not found', json: async () => ({}) })); }
  }
  // The harness's own fixture workspace stays the OLDEST (the scheduler's default).
  w.db.workspaces['ws-oldest'].created_at = '2026-01-01T00:00:00.000Z';
  w.db.syncIdentityTables();
  w.wsOf = (b) => 'ws-' + b.slug;
  w.authFor = (b) => (mode === 'device' ? { state: 'phone' } : { state: 'anonymous', headers: { authorization: 'Bearer ' + toks[b.slug] } });
  return w;
}

/** Drive one generator for one brand; returns the problems found (empty = clean). */
async function drive(w, mode, g, b, opts) {
  const o = opts || {};
  w.reset();
  w.llm.down = !!o.down;
  let json = g.body ? g.body(b, w) : undefined;
  if (json && mode === 'device') json = Object.assign({}, json, { brand: F.recordOf(b) });
  const res = await w.request(g.path, Object.assign({ query: g.q, json, method: json ? 'POST' : 'GET' }, w.authFor(b)));
  w.llm.down = false;
  const out = g.redact ? g.redact(b, res.text || '') : (res.text || '');
  const prompts = w.llm.calls.map((c) => c.prompt || '').join('\n=====\n');
  const tag = `${mode}${o.down ? ' (models down)' : ''} ${g.path}?${new URLSearchParams(g.q)} [${g.id}] for ${b.name}`;
  const problems = [];
  const ok2xx = res.status >= 200 && res.status < 300;
  // A reason may depend on the brand: a refusal that is right for a brand that
  // declares no market is a defect for one that does.
  const why = g.statuses && g.statuses[res.status];
  const allowed = typeof why === 'function' ? why(b) : why;
  if (!ok2xx && !allowed) problems.push(`${tag}: answered ${res.status}: ${out.slice(0, 200)}`);
  for (const l of foreign(out, b)) problems.push(`${tag}: OUTPUT carries ${l.label} "${l.needle}" … ${l.at}`);
  for (const l of foreign(prompts, b)) problems.push(`${tag}: PROMPT carries ${l.label} "${l.needle}" … ${l.at}`);
  if (ok2xx || allowed) {
    const hay = (out + '\n' + prompts).toLowerCase();
    const own = F.tokensOf(b).filter(([label]) => (g.own || []).includes(label));
    for (const [label, needle] of own) if (!hay.includes(needle.toLowerCase())) problems.push(`${tag}: its own ${label} "${needle}" is missing`);
    if (g.marker && !(b.palette || b.regions) && !F.MARKER.test(out + prompts)) problems.push(`${tag}: a brand with no data got no DATA REQUIRED marker`);
    if (g.market && ok2xx) for (const m of g.market(b, out, prompts)) problems.push(`${tag}: ${m}`);
  }
  return { problems, status: res.status, calls: w.llm.calls.length };
}

/* ═══ 1. every generator the routers declare is in the gate ═══════════════ */

test('every generator the routers declare is driven here, or exempt with its reason', () => {
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const keysOf = (code, name) => {
    const m = new RegExp(`const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};?`).exec(code);
    if (!m) return [];
    return [...m[1].matchAll(/^\s*'?([a-z][a-z0-9_-]*)'?\s*:/gim)].map((x) => x[1]);
  };
  const declared = new Set([
    ...keysOf(src('api/brain.js'), 'MODEL_FEATURE'),
    ...keysOf(src('api/calendar.js'), '_CAL_FEATURE').filter((k) => k !== 'triggermailer'),
    ...keysOf(src('api/ai/generate.js'), 'MODE_FEATURE'),
    ...PIPELINE,
    // calendar.js's generating smart-brain actions (its GENERATES set, plus the
    // two that build assets without the caller gate's metering).
    ...(/const GENERATES = new Set\(\[([^\]]*)\]\)/.exec(src('api/calendar.js')) || ['', ''])[1].match(/[a-z-]+/g).filter((k) => k !== 'approve'),
    'generate-slot', 'plan', 'sync-daily',
  ]);
  // A floor, so an enumeration gutted by a refactor cannot pass by finding nothing.
  expect(declared.size, 'the router enumeration found too few generators to mean anything').toBeGreaterThan(25);
  const driven = new Set(GENERATORS.map((g) => g.id));
  const uncovered = [...declared].filter((k) => !driven.has(k) && !EXEMPT[k]).sort();
  expect(uncovered, 'a generator the routers declare has no entry in this gate and no stated exemption').toEqual([]);
  const stale = Object.keys(EXEMPT).filter((k) => driven.has(k));
  expect(stale, 'an exemption names a generator the gate now drives').toEqual([]);
});

test('the fixture brands are distinct from tenant zero and from each other', () => {
  const zero = F.zeroTokens();
  expect(zero.length, 'tenant zero\'s tokens could not be derived').toBeGreaterThan(15);
  expect(zero.some(([l]) => l === 'catalogue cdn'), 'tenant zero\'s catalogue CDN signature was not derived: run npm run build first').toBe(true);
  for (const b of F.BRANDS) {
    // A brand's own record must not trip its own foreign list (the gate would
    // then be measuring the fixtures, not the code).
    expect(F.leaksIn(JSON.stringify(F.recordOf(b)) + JSON.stringify(b.catalogue), b), `${b.name}'s own record contains a foreign token`).toEqual([]);
  }
});

/* ═══ 2. the server generators, in both worlds ═════════════════════════════ */

for (const mode of ['device', 'account']) {
  test.describe(`server generators, ${mode} world`, () => {
    let w;
    test.beforeAll(async () => { w = await makeWorld(mode); });
    test.afterAll(async () => { if (w) await w.close(); });

    for (const b of F.BRANDS) {
      test(`${b.name}: every generator carries ${b.name}'s context and nobody else's`, async () => {
        test.setTimeout(600_000);
        const problems = [];
        let driven = 0;
        let reachedModel = 0;
        for (const g of GENERATORS) {
          if (worldSkip(g, mode)) continue;
          const r = await drive(w, mode, g, b);
          driven += 1;
          if (r.calls) reachedModel += 1;
          problems.push(...r.problems);
          if (g.templates && mode === 'device') {
            const t = await drive(w, mode, g, b, { down: true });
            problems.push(...t.problems);
          }
        }
        expect(driven, 'too few generators ran in this world to mean anything').toBeGreaterThan(mode === 'device' ? 35 : 25);
        expect(reachedModel, 'too few generators reached the (scripted) model, so too few prompts were judged').toBeGreaterThan(10);
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  });
}

/* ═══ 2b. a signed-in account with NO workspace is nobody, never tenant zero ═ */

test.describe('a signed-in account with no brand workspace', () => {
  let w;
  test.beforeAll(async () => { w = await makeWorld('account'); });
  test.afterAll(async () => { if (w) await w.close(); });

  test('every generator answers it with the gap, never with tenant zero\'s or the oldest workspace\'s brand', async () => {
    test.setTimeout(600_000);
    // A verified person whose account has no workspace at all. brand-runtime
    // .resolve() used to hand this caller tenant zero's record (and a lookup
    // that failed, or a row it could not read, the same), so every generator
    // that took resolve() at its word wrote the person's asset as tenant zero.
    const uid = 'user-no-workspace';
    const tok = H.jwtShaped(uid);
    w.db.addUser(tok, uid, 'nobody@example.test').syncIdentityTables();
    const nobody = { name: 'nobody', slug: 'nobody', catalogue: [] };
    const problems = [];
    let driven = 0;
    for (const g of GENERATORS) {
      if (!['create_brief', 'chat', 'landing_page', 'landing-page', 'trigger-mailer', 'preview', 'brand-chat', 'team-chat', 'logo'].includes(g.id)) continue;
      w.reset();
      const res = await w.request(g.path, { query: g.q, json: g.body ? g.body(nobody, w) : undefined, method: g.body ? 'POST' : 'GET', state: 'anonymous', headers: { authorization: 'Bearer ' + tok } });
      driven += 1;
      const all = (res.text || '') + '\n' + w.llm.calls.map((c) => c.prompt || '').join('\n');
      const tag = `no-workspace ${g.path}?${new URLSearchParams(g.q)} [${g.id}]`;
      for (const l of foreign(all, nobody)) problems.push(`${tag}: carries ${l.label} "${l.needle}" … ${l.at}`);
      if (res.status < 500 && !F.MARKER.test(all) && !/no brand|not resolved|could not be read/i.test(all)) problems.push(`${tag}: neither a marker nor a sentence names the missing brand`);
    }
    expect(driven).toBeGreaterThan(6);
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

/* ═══ 3. the /lp/:id page an approved campaign is served at ════════════════ */

test.describe('the landing page a campaign is served at', () => {
  let w;
  test.beforeAll(async () => { w = await makeWorld('account'); });
  test.afterAll(async () => { if (w) await w.close(); });

  for (const b of F.BRANDS) {
    test(`${b.name}: an approved campaign's /lp page wears ${b.name}, and an unknown id wears nobody`, async () => {
      test.setTimeout(240_000);
      w.reset();
      const ap = await w.request('/api/calendar', Object.assign({ query: { action: 'smart-brain-approve' }, json: { entry: ENTRY(b), reviewer: 'invariant' } }, w.authFor(b)));
      expect(ap.status, ap.text.slice(0, 300)).toBe(200);
      const cid = (ap.out && ap.out.campaign && ap.out.campaign.campaign_id) || (JSON.parse(ap.text).campaign || {}).campaign_id;
      expect(cid, 'the approval returned no campaign id').toBeTruthy();
      w.reset();
      const lp = await w.request('/api/calendar', { query: { action: 'lp', id: cid }, state: 'anonymous' });
      expect(lp.status).toBe(200);
      expect(foreign(lp.text, b).map((l) => `${l.label}: ${l.at}`), 'the served page carries another brand').toEqual([]);
      expect(lp.text.toLowerCase(), 'the served page does not name its own brand').toContain(b.name.toLowerCase());
      for (const [label, needle] of F.tokensOf(b).filter(([l]) => ['palette.primary', 'font.heading', 'claim'].includes(l))) {
        expect(lp.text.toLowerCase(), `the served page lacks its own ${label}`).toContain(needle.toLowerCase());
      }
      w.reset();
      const nf = await w.request('/api/calendar', { query: { action: 'lp', id: 'campaign_nobody_000' }, state: 'anonymous' });
      expect(nf.status).toBe(200);
      expect(foreign(nf.text, b).map((l) => l.label), 'an id no record carries was served as somebody\'s page').toEqual([]);
      expect(nf.text).toMatch(F.MARKER);
    });
  }
});

/* ═══ 4. the browser: every app page, each brand active ════════════════════ */

const BT = require('./lib/brand-theme-harness');
/** The tokens a person can SEE on a page: identity, legal, store, catalogue, offer codes. */
const VISIBLE_LABELS = /^(tenant zero (name|domain|legal entity|legal address|offer code|catalogue cdn|catalogue product))|(Quillforth Gazette|Brambleweld Larder|Ozzlewick) (name|domain|legal entity|product|cdn|logo host)$/;

function visibleForeign(hay, b) {
  return F.leaksIn(hay, b).filter((l) => VISIBLE_LABELS.test(l.label));
}

for (const b of [F.QUILL, F.BARE]) {
  BT.define('invariant-' + b.slug, { name: b.name, slug: b.slug, palette: b.palette || {}, typography: b.typography || {}, regions: b.regions || [], record: F.recordOf(b) });
}

test.describe('app pages, each brand active on the device', () => {
  const { kept } = BT.appPages();
  for (const b of [F.QUILL, F.BARE]) {
    test(`every app page with ${b.name} active shows ${b.name}'s identity and nobody else's`, async ({ browser }) => {
      test.setTimeout(900_000);
      const problems = [];
      let measured = 0;
      for (const file of kept) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        try {
          await BT.install(page, 'invariant-' + b.slug);
          const painted = await BT.open(page, file, 'invariant-' + b.slug);
          const seen = await page.evaluate(() => {
            const chrome = (el) => !!(el.closest && el.closest('.lnav-brand, .lnav-mark, [data-platform-chrome]'));
            const parts = [document.title];
            const walk = (root) => {
              const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
              let n; while ((n = tw.nextNode())) { const p = n.parentElement; if (!p || chrome(p)) continue; const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden') continue; parts.push(n.nodeValue); }
            };
            walk(document.body);
            for (const el of document.querySelectorAll('[alt],[title],[placeholder],[aria-label],a[href],img[src],source[src],iframe[src],link[rel~="icon"]')) {
              if (chrome(el)) continue;
              for (const a of ['alt', 'title', 'placeholder', 'aria-label', 'href', 'src']) { const v = el.getAttribute(a); if (v) parts.push(v); }
            }
            for (const f of document.querySelectorAll('iframe[srcdoc]')) parts.push(f.getAttribute('srcdoc') || '');
            const rs = getComputedStyle(document.documentElement);
            return { text: parts.join('\n'), primary: rs.getPropertyValue('--brand-primary').trim(), head: rs.getPropertyValue('--brand-font-head').trim() };
          });
          measured += 1;
          for (const l of visibleForeign(seen.text, b)) problems.push(`${file}: shows ${l.label} "${l.needle}" … ${l.at}`);
          if (b.palette) {
            if (!painted) problems.push(`${file}: the shell never painted ${b.name}'s brand tokens`);
            else if (seen.primary.toLowerCase() !== String(b.palette.primary).toLowerCase()) problems.push(`${file}: --brand-primary is ${seen.primary}, not ${b.name}'s ${b.palette.primary}`);
            if (b.typography && !seen.head.includes(b.typography.heading.family)) problems.push(`${file}: --brand-font-head is ${seen.head}, not ${b.name}'s ${b.typography.heading.family}`);
          }
        } finally { await ctx.close(); }
      }
      expect(measured, 'too few pages were measured to mean anything').toBeGreaterThan(30);
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});
