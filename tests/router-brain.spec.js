// api/brain.js, EXECUTED: the shipped router (request-scope wrapper included)
// on a real http.Server, one test per ?action= it dispatches.
//
// Until 2026-09-28 no test loaded this file at all (coverage/UNTESTED.md:
// 0 of 1205 lines), and it fronts dispatch, deliverability, the cron, the
// brand LLM and the review queue. Everything here sends a request over a
// socket and reads what came back; nothing asserts on the router's text
// except the ENUMERATION of its dispatch table, which is a property of the
// file (which `case` labels exist) and is used only to prove the table below
// is complete - a new action with no entry fails the enumeration test.
//
// How each action is proven to dispatch: the core it calls is replaced on
// its require.cache entry with a recording stub (tests/router-harness.js
// Stubs.on), global.fetch throws for every host except the fake Supabase
// project, and the test asserts the stub was REACHED with the arguments the
// router built - or, for a refusal, that it was NOT reached and that no
// network call other than the router's own scoping lookups happened. llm.js
// exports the function itself and brain.js binds it at load, so that one is
// swapped in the cache and brain.js alone is re-required against it.
//
// Gates, as the router actually applies them (the table's `gate` field):
//   user          requireUser: session or refuse (401), before the core runs
//   cron          CRON_SECRET bearer, or 401
//   cron-or-user  dispatch-drain: the scheduler drains everything, a signed-in
//                 editor drains their own workspace
//   cron-get      social-run-daily: a GET is the cron's, a POST is the console's
//   cron-flag     os-run-daily-job: only the ?cron=1 path is guarded
//   agent-key     agent-builder: op=spec is open, every other op needs the key
//   model         reaches an AI model or a paid provider (MODEL_FEATURE in
//                 brain.js, 2026-09-29): metered at its catalog key, so an
//                 anonymous caller (401) and an unlisted phone number (403)
//                 are refused BEFORE the core; with the meter unconfigured
//                 the router's own gate refuses the anonymous caller anyway;
//                 the scheduler's bearer runs free. `model:` on any entry
//                 names the key, whatever its other gate.
//   none          only the browser-attribution rule applies: a request that
//                 looks like a browser (Origin) and carries neither a session
//                 nor a workspace_id is refused (409) or served demo data,
//                 BEFORE the switch; any other caller reaches the core.
//
// The `none` set is PINNED by name at the end of this file. Each of those
// actions is also proven admitted for an anonymous server-to-server request
// (no Origin, no bearer), so the label is a measured fact: adding a gate to
// one of them fails its admitted test, and the pin shrinks; adding a NEW
// ungated action fails the pin, and has to be argued for. Until 2026-09-29
// twelve of them reached a model or a paid provider for an anonymous caller
// (console-chat, access-narrative, brand-chat, agent-chat, team-chat,
// agentic-run, generate, video-generate, mailer-assets, tts,
// analysis-narrative, agent-analyze); they are the `model` gate now, and the
// pin shrank by exactly those. calendar-scenarios was listed with them and,
// executed, reaches neither: it stays ungated.
//
// Run: npx playwright test tests/router-brain.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const H = require('./router-harness');

const BRAIN = 'api/brain.js';
const LLM = 'api/_shared/llm.js';
const CORE = 'api/_shared/brain-core.js';
const BRAND_RT = 'api/_shared/brand-runtime.js';
const WS_SCOPE = 'api/_shared/workspace-scope.js';
const BWC = 'api/_shared/brand-workspace-core.js';
const M = {
  kb: 'api/_shared/brain-kb.js', analysis: 'api/_shared/brain-analysis.js', competitor: 'api/_shared/brain-competitor.js',
  calendar: 'api/_shared/brain-calendar.js', generate: 'api/_shared/brain-generate.js', review: 'api/_shared/brain-review.js',
  agents: 'api/_shared/brain-agent.js', jarvis: 'api/_shared/jarvis.js', agentic: 'api/_shared/agentic-orchestrator.js',
  scenarios: 'api/_shared/calendar-scenarios.js', services: 'lib/smart-brain/services.js', brandLlm: 'api/_shared/brand-llm.js',
  klaviyo: 'api/_shared/klaviyo-core.js', adInsights: 'api/_shared/ad-insights-core.js', adsSnowflake: 'api/_shared/ads-snowflake-core.js',
  adsLive: 'api/_shared/ads-live-core.js', adsSop: 'api/_shared/ads-sop-core.js', adMetrics: 'api/_shared/ad-metrics-catalog.js',
  webengage: 'api/_shared/webengage-core.js', video: 'api/_shared/video-core.js', social: 'api/_shared/social-core.js',
  osb: 'api/_shared/os-backbone.js', alerts: 'api/_shared/alerts-core.js', snowflake: 'api/_shared/snowflake-sync-core.js',
  telesuite: 'api/_shared/telesuite-core.js', growth: 'api/_shared/growth-os-core.js', featureAgent: 'api/_shared/feature-agent.js',
  market: 'api/_shared/market-analytics.js', validation: 'api/_shared/data-validation-core.js', dispatch: 'api/_shared/dispatch-core.js',
  deliver: 'api/_shared/deliverability-core.js', preflight: 'api/_shared/preflight-core.js', cohort: 'api/_shared/cohort-engine.js',
  health: 'api/_shared/connectors-health.js', assetAgent: 'api/_shared/asset-agent.js', mailerBuild: 'api/_shared/lifecycle-mailer-build.js',
  gif: 'api/_shared/gif-core.js', engine: 'api/_shared/ads-insight-engine.js', catalogServer: 'api/_shared/brand-catalog-server.js',
  sbplan: 'api/_shared/smart-brain-plan.js', universe: 'api/_shared/competitor-universe.js', domainIntel: 'api/_shared/domain-intel.js',
  logo: 'api/_shared/logo-brief.js', dailyCal: 'api/_shared/daily-calendar-core.js', revenue: 'api/_shared/revenue-analysis-core.js',
  agentBuilder: 'api/_shared/agent-builder-core.js', platformAgents: 'api/_shared/platform-agents-core.js', journey: 'api/_shared/journey-core.js',
  shopify: 'api/_shared/shopify-core.js', connections: 'api/_shared/workspace-connections-core.js', webhooks: 'api/_shared/platform-webhooks.js',
  ledger: 'api/_shared/contact-ledger.js',
};

/** The active brand as brain.js resolves it onto req.__brand (home market UK). */
const BRAND = Object.assign({}, H.BRAND_ROW, { regions: H.BRAND_ROW.regions.map((r) => Object.assign({}, r)) });

/* ── file-level fixtures ────────────────────────────────────────────────── */

let restoreEnv, srv;
const FILE = new H.Stubs();          // the llm swap + brain reload, for the whole file
const llmCalls = [];
let S, guard, db;

test.beforeAll(async () => {
  restoreEnv = H.routerEnv();
  // Load the router against the REAL modules first so every dependency binds
  // the real llm.js; only then swap llm.js and re-execute brain.js alone.
  require(H.ROOT + '/' + BRAIN);
  const realLlm = require(H.ROOT + '/' + LLM);
  const stubLlm = async function callLLMStub(opts) { llmCalls.push(opts); return { ok: true, text: 'stubbed reply', provider: 'stub', model: 'stub' }; };
  for (const k of Object.keys(realLlm)) stubLlm[k] = realLlm[k];
  FILE.swap(LLM, stubLlm);
  FILE.reload(BRAIN);
  srv = await H.serve(BRAIN);
});
test.afterAll(async () => {
  await srv.close();
  FILE.restore();
  restoreEnv();
});
test.beforeEach(() => {
  llmCalls.length = 0;
  require(H.ROOT + '/' + WS_SCOPE).invalidate();
  guard = H.netGuard();
  guard.route((u) => u.startsWith(H.SELF_BASE_URL), () => H.reply(200, { ok: true, chained: true }));
  S = new H.Stubs();
  db = H.fakeDb(S);
  S.on(CORE, 'db', () => db);
  S.on(BRAND_RT, 'resolve', async (req, o) => Object.assign({}, BRAND, { __resolved_for: (o && o.workspace_id) || null }));
});
test.afterEach(() => {
  S.restore();
  guard.restore();
});

/** Hits that belong to the ACTION, not to the scoping the router runs first. */
function actionHits() {
  return S.reached.filter((r) => !(r.module === BRAND_RT && r.fn === 'resolve') && !(r.module === CORE && r.fn === 'db'));
}
function call(action, run, over) {
  const r = Object.assign({}, run || {}, over || {});
  const query = Object.assign({ action }, r.query || {});
  return H.request(srv.port, {
    method: r.method || (r.json !== undefined || r.raw != null ? 'POST' : 'GET'),
    path: '/api/brain' + H.qs(query), json: r.json, raw: r.raw, contentType: r.contentType,
    headers: r.headers, auth: r.auth, origin: r.origin,
  });
}
const last = (mod, fn) => { const h = S.hit(mod, fn); expect(h, `${mod} ${fn} was not reached`).toBeTruthy(); return h.args; };
const hostOrigin = () => `https://127.0.0.1:${srv.port}`;

/* ── the dispatch table ─────────────────────────────────────────────────── */
/*
 * run:     the admitted request (method/query/json/auth/origin). Defaults:
 *          gate user -> session, gate cron -> cron bearer, gate none -> session
 *          from a browser page (Origin), which is the app's own shape.
 * browser: what an unattributed browser request gets from the scoping rule:
 *          'refuse' (409 no_active_brand, the WRITES pattern) or 'demo'.
 * stubs:   installs the recording stubs the action dispatches to.
 * expect:  asserts on the response and on what was reached.
 * cases:   extra named requests for actions with more than one branch.
 */
const T = [];
const add = (action, def) => T.push(Object.assign({ action }, def));

add('telesuite', { gate: 'none', browser: 'demo',
  run: { json: { op: 'pitch', product: 'x' } },
  stubs: () => S.on(M.telesuite, 'handle', async (req, res) => res.json({ ok: true, suite: 'telesuite', body_type: typeof req.body, ws: req.__workspaceId })),
  expect: (r) => { expect(r.status).toBe(200); expect(r.out).toMatchObject({ suite: 'telesuite', body_type: 'object', ws: H.WS }); expect(last(M.telesuite, 'handle')[0].query.action).toBe('telesuite'); },
});
add('growth-os', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => S.on(M.growth, 'handle', async (req, res) => res.json({ ok: true, growth: true, ws: req.__workspaceId })),
  expect: (r) => { expect(r.status).toBe(200); expect(r.out).toMatchObject({ growth: true, ws: H.WS }); },
});
add('status', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => { S.on(M.review, 'recalibrationStatus', async () => ({ overdue: false })); db.rows.smart_calendar = [{ id: 1, status: 'final' }, { id: 2, status: 'tentative' }]; },
  expect: (r) => {
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({ ok: true, db_linked: true, live_platform_push: false, counts: { calendar_slots: 2, slots_final: 1 }, weekly_recalibration: { overdue: false } });
    expect(S.hits('db', 'select').map((h) => h.args[0])).toEqual(['smart_campaigns', 'smart_calendar', 'smart_generated_campaigns', 'smart_review_queue']);
    expect(S.hit('db', 'select').args[1].filters).toEqual({ state: 'eq.pending' });
  },
});
add('config', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => { S.on(CORE, 'getConfig', async () => ({ thresholds: { email: {} } })); S.on(CORE, 'setConfig', async () => [{}]); },
  expect: (r) => { expect(r.status).toBe(200); expect(r.out.config).toEqual({ thresholds: { email: {} } }); expect(S.hits(CORE, 'setConfig')).toEqual([]); },
  cases: [{ name: 'POST writes every key through setConfig', run: { json: { config: { alpha: 1, beta: { x: 2 } } } },
    expect: (r) => { expect(r.out).toEqual({ ok: true, updated: ['alpha', 'beta'] }); expect(S.hits(CORE, 'setConfig').map((h) => h.args)).toEqual([['alpha', 1], ['beta', { x: 2 }]]); } }],
});
add('kb', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { limit: '1' } },
  stubs: () => S.on(M.kb, 'libraryIndex', async () => [{ id: 'c1' }, { id: 'c2' }]),
  expect: (r) => { expect(r.status).toBe(200); expect(r.out).toEqual({ ok: true, campaigns: 2, library: [{ id: 'c1' }] }); },
});
add('kb-patterns', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => { S.on(M.kb, 'libraryIndex', async () => [{ id: 'c1' }]); S.on(M.kb, 'patterns', () => ({ angle: ['a'] })); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, patterns: { angle: ['a'] } }); expect(last(M.kb, 'patterns')[0]).toEqual([{ id: 'c1' }]); },
});
add('analyze', { gate: 'none', browser: 'demo', run: { json: {} },
  stubs: () => { S.on(M.analysis, 'runDaily', async () => ({ summary: { campaigns: 3 }, patterns: {} })); S.on(CORE, 'logRun', async () => 'run_1'); },
  expect: (r) => { expect(r.out).toMatchObject({ ok: true, summary: { campaigns: 3 } }); expect(last(M.analysis, 'runDaily')[0]).toEqual({ persist: true }); expect(last(CORE, 'logRun').slice(0, 3)).toEqual(['manual', { campaigns: 3 }, true]); },
  cases: [{ name: 'GET analyses without persisting', run: { method: 'GET', json: undefined }, expect: () => { expect(last(M.analysis, 'runDaily')[0]).toEqual({ persist: false }); } }],
});
add('cohorts', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  expect: (r) => { expect(r.out).toEqual({ ok: true, cohorts: [] }); expect(last('db', 'select')).toEqual(['smart_cohorts', { limit: 200, order: 'value_score.desc', filters: { active: 'eq.true' } }]); },
});
add('library', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { channel: 'email', market: 'UK', cohort: 'c1' } },
  stubs: () => S.on(M.analysis, 'filteredLibrary', async () => ({ items: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, items: [] }); expect(last(M.analysis, 'filteredLibrary')[0]).toEqual({ channel: 'email', market: 'UK', cohortId: 'c1' }); },
});
add('scores', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  expect: (r) => { expect(r.out).toEqual({ ok: true, scores: [] }); expect(last('db', 'select')).toEqual(['smart_library_scores', { limit: 1000, order: 'score.desc' }]); },
});
add('analysis-narrative', { gate: 'model', model: 'analytics.narrative', browser: 'demo', run: { json: { question: 'what moved?' } },
  stubs: () => {
    S.on(M.market, 'ownsBundledExport', async () => false);
    S.on(M.featureAgent, 'runAnalyst', async () => ({ ok: true, insights: [{ t: 'x' }] }));
  },
  expect: (r) => {
    // The bundled export is tenant zero's: another workspace gets the note, never the numbers.
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({ ok: true, insights: [], data_scope: { level: 'other_workspace' } });
    expect(S.hits(M.featureAgent, 'runAnalyst')).toEqual([]);
  },
  cases: [{ name: 'the owner of the bundled export reaches the analyst with its caveats', run: { json: { question: 'what moved?' } },
    stubs: () => {
      S.on(M.market, 'ownsBundledExport', async () => true);
      S.on(M.validation, 'runValidation', () => ({ checks: [{ metric: 'aov', verdict: 'MISMATCH', note: 'n' }, { metric: 'rev', verdict: 'OK' }], summary: { ok: 1 } }));
      S.on(M.validation, 'loadMarketData', () => ({ markets: { US: { summary: { s: 1 }, monthly: [1, 2] } } }));
      S.on(M.featureAgent, 'runAnalyst', async () => ({ ok: true, insights: [{ t: 'x' }] }));
    },
    expect: (r) => {
      expect(r.out).toMatchObject({ ok: true, insights: [{ t: 'x' }], caveats_considered: 1 });
      const a = last(M.featureAgent, 'runAnalyst')[0];
      expect(a.feature).toBe('analytics'); expect(a.question).toBe('what moved?');
      expect(a.caveats).toEqual([{ metric: 'aov', verdict: 'MISMATCH', note: 'n' }]);
      expect(a.inputs.summary).toEqual({ s: 1 });
    } }],
});
add('benchmarks', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => S.on(M.competitor, 'benchmarks', async () => ({ UK: {} })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, benchmarks: { UK: {} } }); expect(last(M.competitor, 'benchmarks')[0]).toEqual({ persist: false }); },
});
add('calendar', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { from: '2026-10-01', market: 'UK' } },
  expect: (r) => { expect(r.out).toEqual({ ok: true, slots: [] }); expect(last('db', 'select')).toEqual(['smart_calendar', { limit: 1500, order: 'slot_date.asc', filters: { slot_date: 'gte.2026-10-01', market: 'eq.UK' } }]); },
});
add('calendar-generate', { gate: 'none', browser: 'refuse', run: { json: { start_date: '2026-10-01', days: 14, regenerate: true } },
  stubs: () => { S.on(M.calendar, 'generate', async () => ({ ok: true, created: 3 })); S.on(CORE, 'logRun', async () => null); },
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, created: 3 });
    expect(last(M.calendar, 'generate')[0]).toEqual({ startDate: '2026-10-01', days: 14, persist: true, regenerate: true });
    expect(last(CORE, 'logRun').slice(0, 2)).toEqual(['manual', { calendar_generate: { created: 3 } }]);
  },
  cases: [{ name: 'GET is refused with 405 before the generator runs', run: { method: 'GET', json: undefined }, expect: (r) => { expect(r.status).toBe(405); expect(S.hits(M.calendar, 'generate')).toEqual([]); } }],
});
add('calendar-review', { gate: 'none', browser: 'demo', run: { json: {} },
  stubs: () => S.on(M.calendar, 'dailyReview', async () => ({ ok: true, review: {} })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, review: {} }); expect(last(M.calendar, 'dailyReview')[0]).toEqual({ persist: true }); },
});
add('festivals', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  expect: (r) => { expect(r.out).toEqual({ ok: true, festivals: [] }); expect(last('db', 'select')).toEqual(['smart_festivals', { limit: 500, order: 'mmdd.asc' }]); },
});
add('festivals-extract', { gate: 'none', browser: 'demo', run: { json: {} },
  stubs: () => S.on(M.calendar, 'extractFestivals', async () => [{ name: 'a' }, { name: 'b' }]),
  expect: (r) => { expect(r.out).toEqual({ ok: true, detected: 2, festivals: [{ name: 'a' }, { name: 'b' }] }); expect(last(M.calendar, 'extractFestivals')[0]).toEqual({ persist: true }); },
});
add('feedback', { gate: 'none', browser: 'refuse', run: { json: { target_id: 'slot_1', verdict: 'approve', notes: 'good', reviewer: 'op' } },
  expect: (r) => {
    expect(r.out).toMatchObject({ ok: true, feedback: { target_type: 'calendar_slot', target_id: 'slot_1', verdict: 'approve', notes: 'good', reviewer: 'op' } });
    expect(last('db', 'insert')).toEqual(['smart_feedback', [r.out.feedback]]);
  },
});
add('mvt', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => S.on(M.calendar, 'applyMvt', async () => ({ angle_boost: {} })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, results: [] }); expect(last('db', 'select')).toEqual(['smart_mvt_results', { limit: 200, order: 'created_at.desc' }]); },
  cases: [{ name: 'POST records the result and re-weights', run: { json: { slot_id: 's1', variant: 'B', metrics: { ctr: 1 }, winner: true } },
    expect: (r) => {
      expect(r.out).toEqual({ ok: true, recorded: true, weights: { angle_boost: {} } });
      expect(last('db', 'insert')).toEqual(['smart_mvt_results', [{ slot_id: 's1', campaign_id: null, variant: 'B', dimension: 'hook', metrics: { ctr: 1 }, winner: true, learned: {} }]]);
      expect(last(M.calendar, 'applyMvt')[0]).toEqual({ persist: true });
    } }],
});
add('generate', { gate: 'model', model: 'brain.slot_prebuild', browser: 'refuse', run: { json: { slot_id: 'slot_9' } },
  stubs: () => S.on(M.generate, 'generateForSlot', async () => ({ ok: true, campaign_id: 'c9' })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, campaign_id: 'c9' }); expect(last(M.generate, 'generateForSlot')).toEqual(['slot_9', { persist: true }]); },
  cases: [{ name: 'a POST without slot_id is a 400, not a generation', run: { json: {} }, expect: (r) => { expect(r.status).toBe(400); expect(S.hits(M.generate, 'generateForSlot')).toEqual([]); } }],
});
add('assets', { gate: 'none', browser: 'refuse', run: { method: 'GET', query: { slot: 's1' } },
  expect: (r) => { expect(r.out).toEqual({ ok: true, assets: [] }); expect(last('db', 'select')[0]).toBe('smart_generated_assets'); expect(last('db', 'select')[1].filters).toEqual({ slot_id: 'eq.s1' }); },
});
add('asset', { gate: 'none', browser: 'refuse', run: { method: 'GET', query: { id: 'a1' } },
  stubs: () => { db.rows.smart_generated_assets = [{ id: 'a1', type: 'mailer_html', content: '<p>hi</p>' }]; },
  expect: (r) => { expect(r.status).toBe(200); expect(r.out.asset.id).toBe('a1'); expect(last('db', 'select')).toEqual(['smart_generated_assets', { filters: { id: 'eq.a1' }, limit: 1 }]); },
  cases: [
    { name: 'raw=1 serves the html itself', run: { method: 'GET', query: { id: 'a1', raw: '1' } }, expect: (r) => { expect(r.status).toBe(200); expect(String(r.headers['content-type'])).toMatch(/^text\/html/); expect(r.text).toBe('<p>hi</p>'); } },
    { name: 'an unknown id is a 404', run: { method: 'GET', query: { id: 'nope' } }, stubs: () => { db.rows.smart_generated_assets = []; }, expect: (r) => { expect(r.status).toBe(404); } },
  ],
});
add('campaigns', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { status: 'approved' } },
  expect: (r) => { expect(r.out).toEqual({ ok: true, campaigns: [] }); expect(last('db', 'select')).toEqual(['smart_generated_campaigns', { limit: 500, order: 'created_at.desc', filters: { status: 'eq.approved' } }]); },
});
add('review', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { state: 'done' } },
  stubs: () => S.on(M.review, 'queue', async () => ({ items: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, items: [] }); expect(last(M.review, 'queue')[0]).toEqual({ state: 'done' }); },
});
add('decide', { gate: 'none', browser: 'refuse', run: { json: { queue_id: 'q1', item_id: 'i1', decision: 'approve', reviewer: 'op', notes: 'n' } },
  stubs: () => S.on(M.review, 'decide', async () => ({ ok: true, decided: true })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, decided: true }); expect(last(M.review, 'decide')[0]).toEqual({ queueId: 'q1', itemId: 'i1', decision: 'approve', reviewer: 'op', notes: 'n' }); },
});
add('recalibrate', { gate: 'none', browser: 'refuse', run: { json: { reviewer: 'op', decisions: ['d1'], config: { k: 1 } } },
  stubs: () => { S.on(M.review, 'recalibrate', async () => ({ ok: true })); S.on(CORE, 'logRun', async () => null); },
  expect: (r) => { expect(r.out).toEqual({ ok: true }); expect(last(M.review, 'recalibrate')[0]).toEqual({ reviewer: 'op', decisions: ['d1'], configPatches: { k: 1 } }); expect(last(CORE, 'logRun')[0]).toBe('weekly'); },
});
add('confidence', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => S.on(M.review, 'recalibrationStatus', async () => ({ overdue: true })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, confidence: [], recalibration: { overdue: true } }); expect(last('db', 'select')).toEqual(['smart_confidence', { limit: 20 }]); },
});
add('agents', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => S.on(M.agents, 'listAgents', async () => [{ id: 'a' }]),
  expect: (r) => { expect(r.out).toEqual({ ok: true, agents: [{ id: 'a' }] }); },
});
add('agent-upsert', { gate: 'none', browser: 'refuse', run: { json: { id: 'agent_x', name: 'X' } },
  stubs: () => S.on(M.agents, 'upsertAgent', async (a) => a),
  expect: (r) => { expect(r.out).toEqual({ ok: true, agent: { id: 'agent_x', name: 'X' } }); expect(last(M.agents, 'upsertAgent')[0]).toEqual({ id: 'agent_x', name: 'X' }); },
});
add('agent-sync', { gate: 'none', browser: 'refuse', run: { json: { agent_id: 'agent_x' } },
  stubs: () => S.on(M.agents, 'syncKnowledge', async () => ({ synced: 1 })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, synced: 1 }); expect(last(M.agents, 'syncKnowledge')).toEqual(['agent_x']); },
});
add('agent-chat', { gate: 'model', model: 'assistant.chat', browser: 'refuse', run: { json: { message: 'hi', agent_id: 'agent_x', session_id: 's1' } },
  stubs: () => S.on(M.agents, 'chat', async () => ({ ok: true, reply: 'r' })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, reply: 'r' }); expect(last(M.agents, 'chat')[0]).toEqual({ agentId: 'agent_x', sessionId: 's1', message: 'hi', context: {}, history: [] }); },
  cases: [{ name: 'no message is a 400 before the agent runs', run: { json: {} }, expect: (r) => { expect(r.status).toBe(400); expect(S.hits(M.agents, 'chat')).toEqual([]); } }],
});
add('agent-analyze', { gate: 'model', model: 'assistant.chat', browser: 'refuse', run: { json: { message: 'how many orders' } },
  stubs: () => S.on(M.agents, 'analyze', async () => ({ ok: true, figures: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, figures: [] }); expect(last(M.agents, 'analyze')[0]).toEqual({ message: 'how many orders' }); },
});
add('team-chat', { gate: 'model', model: 'assistant.chat', browser: 'refuse', run: { json: { message: 'plan?', session_id: 't1', history: [{ role: 'user' }] } },
  stubs: () => S.on(M.agents, 'teamChat', async () => ({ ok: true, reply: 'r' })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, reply: 'r' }); expect(last(M.agents, 'teamChat')[0]).toEqual({ sessionId: 't1', message: 'plan?', context: {}, history: [{ role: 'user' }] }); },
});
add('agent-sessions', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { agent: 'agent_x' } },
  expect: (r) => { expect(r.out).toEqual({ ok: true, sessions: [] }); expect(last('db', 'select')).toEqual(['smart_agent_sessions', { limit: 200, order: 'started_at.desc', filters: { agent_id: 'eq.agent_x' } }]); },
});
add('jarvis', { gate: 'none', browser: 'public', run: { json: { userText: 'open the shoes', assistantText: 'sure' } },
  stubs: () => { S.on(WS_SCOPE, 'brandForWorkspace', async () => BRAND); S.on(M.jarvis, 'detectNavActions', () => [{ type: 'route', href: '/x' }]); },
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, actions: [{ type: 'route', href: '/x' }] });
    expect(last(WS_SCOPE, 'brandForWorkspace')[1]).toBe(H.WS);
    const a = last(M.jarvis, 'detectNavActions');
    expect(a[0]).toBe('open the shoes'); expect(a[1]).toBe('sure');
    expect(a[2].market).toBe('UK'); expect(a[2].brand).toBe(BRAND);   // the active brand's HOME market, not a literal
  },
});
add('agentic-run', { gate: 'model', model: 'campaign.plan', browser: 'refuse', run: { json: { brief: 'launch', tier: 'budget', days: '7' } },
  stubs: () => S.on(M.agentic, 'runAgentic', async () => ({ ok: true, stages: 8 })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, stages: 8 }); expect(last(M.agentic, 'runAgentic')[0]).toEqual({ market: 'UK', brief: 'launch', tier: 'budget', days: 7, withCreatives: true, maxRetries: 1 }); },
});
add('calendar-scenarios', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { tier: 'budget', days: '10' } },
  stubs: () => {
    const seen = [];
    S.set(M.services, 'SmartBrainDbAdapter', class { constructor(cfg) { seen.push(['db', cfg]); } async ownData() { return { feedback: ['f'] }; } async competitorData() { return ['c']; } });
    S.set(M.services, 'CompetitorBenchmarkingService', class { benchmark(d) { return { benched: d }; } });
    S.set(M.services, 'KnowledgeBaseService', class { build(o) { return { kb: o }; } });
    S.set(M.services, 'AnalysisService', class { analyze(kb, o) { return { analysed: [kb, o] }; } });
    S.set(M.services, 'CalendarIntelligenceService', class { generate(a) { return { days: a.days, entries: [1, 2], got: a }; } });
    S.on(M.scenarios, 'buildScenarios', async () => ({ default: 'medium', scenarios: { medium: {} } }));
  },
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, calendar: { days: 10, entries: 2 }, default: 'medium', scenarios: { medium: {} } });
    const a = last(M.scenarios, 'buildScenarios')[0];
    expect(a.market).toBe('UK'); expect(a.tier).toBe('budget');
    expect(a.baseCalendar.got.feedback).toEqual(['f']); expect(a.analysis).toEqual({ analysed: [{ kb: { feedback: ['f'] } }, { feedback: ['f'] }] });
  },
});
add('brand-chat', { gate: 'model', model: 'assistant.chat', browser: 'refuse', run: { json: { message: 'what sells?', history: [{ role: 'user', content: 'x' }] } },
  stubs: () => S.on(M.brandLlm, 'chat', async () => ({ ok: true, reply: 'r', trace: [] })),
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, reply: 'r', trace: [] });
    const a = last(M.brandLlm, 'chat')[0];
    expect(a).toMatchObject({ message: 'what sells?', history: [{ role: 'user', content: 'x' }], market: 'UK', workspaceId: H.WS });
    // The brand the router resolved rides along (2026-09-29), so a caller
    // with no workspace row is answered as ITS brand, never as tenant zero's.
    expect(a.brand).toMatchObject({ name: 'Harness Brand' });
  },
  cases: [{ name: 'no message is a 400 before the model runs', run: { json: {} }, expect: (r) => { expect(r.status).toBe(400); expect(S.hits(M.brandLlm, 'chat')).toEqual([]); } }],
});
add('brand-tools', { gate: 'none', browser: 'public', run: { method: 'GET' },
  stubs: () => S.on(M.brandLlm, 'toolManifest', () => [{ name: 'ask_analytics' }]),
  expect: (r) => { expect(r.out).toMatchObject({ ok: true, tools: [{ name: 'ask_analytics' }], klaviyo_connected: false }); expect(typeof r.out.brand.name).toBe('string'); },
});
add('klaviyo', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { op: 'lists' } },
  stubs: () => { S.on(M.connections, 'credentialsFor', async () => null); S.on(M.klaviyo, 'dispatch', async () => ({ connected: false, would_request: {} })); },
  expect: (r) => {
    expect(r.out).toEqual({ connected: false, would_request: {} });
    expect(last(M.connections, 'credentialsFor')[1]).toBe('klaviyo');
    const a = last(M.klaviyo, 'dispatch');
    expect(a[0]).toBe('lists'); expect(a[1].op).toBe('lists'); expect(a[1].workspace_id).toBe(H.WS); expect(a[2]).toBeNull();
  },
});
add('ad-insights', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { op: 'status', market: 'UK' } },
  stubs: () => { S.on(M.adInsights, 'status', () => ({ ok: true, status: 's' })); S.on(M.adInsights, 'insights', async () => ({ ok: true, rows: [] })); S.on(M.adInsights, 'summary', async () => ({ ok: true, platforms: [] })); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, status: 's' }); expect(last(M.adInsights, 'status')).toEqual(['UK']); },
  cases: [
    { name: 'op=platform reads one platform', run: { method: 'GET', query: { op: 'platform', platform: 'meta', market: 'UK', level: 'ad', since: '2026-01-01', until: '2026-01-31' } },
      expect: (r) => { expect(r.out).toEqual({ ok: true, rows: [] }); expect(last(M.adInsights, 'insights')[0]).toEqual({ platform: 'meta', market: 'UK', level: 'ad', since: '2026-01-01', until: '2026-01-31' }); } },
    { name: 'the default op is the summary', run: { method: 'GET', query: { market: 'UK' } }, expect: (r) => { expect(r.out).toEqual({ ok: true, platforms: [] }); expect(last(M.adInsights, 'summary')[0].market).toBe('UK'); } },
  ],
});
add('ads-analysis', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { view: 'insights', market: 'UK' } },
  stubs: () => {
    S.on(M.adInsights, 'summary', async () => ({ platforms: [{ platform: 'meta', rows: [{ id: 1 }, { id: 2 }] }, { platform: 'google', connected: false, hint: 'no token', need_env: ['GOOGLE_ADS_TOKEN'] }], window: 'w' }));
    S.on(M.engine, 'deriveInsights', () => ({ insights: ['i'] }));
    S.on(M.engine, 'deriveActionables', () => ({ actionables: ['a'] }));
    S.on(M.engine, 'deriveCreativeAnalysis', () => ({ creative: ['c'] }));
  },
  expect: (r) => {
    expect(r.out).toMatchObject({ ok: true, market: 'UK', level: 'ad', window: 'w', rows_analysed: 2, connected: true, insights: ['i'], blockers: [{ platform: 'google', blocker: 'no token', need_env: ['GOOGLE_ADS_TOKEN'] }] });
    expect(r.out.actionables).toBeUndefined();   // view=insights only
    expect(last(M.engine, 'deriveInsights')[0]).toEqual([{ id: 1 }, { id: 2 }]);
    expect(S.hits(M.engine, 'deriveActionables')).toEqual([]);
  },
  cases: [{ name: 'view=all runs all three engines', run: { method: 'GET', query: { view: 'all', market: 'UK' } }, expect: (r) => { expect(r.out).toMatchObject({ insights: ['i'], actionables: ['a'], creative: ['c'] }); } }],
});
add('ads-snowflake', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { op: 'status' } },
  stubs: () => { S.on(M.adsSnowflake, 'status', () => ({ ok: true, configured: false })); S.on(M.adsSnowflake, 'cohort', async () => ({ ok: true, rows: [] })); S.on(M.adsSnowflake, 'metrics', async () => ({ ok: true, metrics: [] })); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, configured: false }); },
  cases: [
    { name: 'op=cohort', run: { method: 'GET', query: { op: 'cohort', platform: 'meta', dimension: 'age', measure: 'roas', account: 'a', since: '2026-01-01', until: '2026-01-31', level: 'ad' } },
      expect: (r) => { expect(r.out).toEqual({ ok: true, rows: [] }); expect(last(M.adsSnowflake, 'cohort')[0]).toEqual({ platform: 'meta', dimension: 'age', measure: 'roas', account: 'a', since: '2026-01-01', until: '2026-01-31', level: 'ad' }); } },
    { name: 'any other op falls through to metrics', run: { method: 'GET', query: { op: 'metrics', platform: 'google', limit: '5' } }, expect: (r) => { expect(r.out).toEqual({ ok: true, metrics: [] }); expect(last(M.adsSnowflake, 'metrics')[0]).toMatchObject({ platform: 'google', limit: '5' }); } },
  ],
});
add('ads-live', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { op: 'daily', since: '2026-01-01', until: '2026-01-02', account: 'acc' } },
  stubs: () => { S.on(M.adsLive, 'daily', async () => ({ ok: true, days: [] })); S.on(M.adsLive, 'today', async () => ({ ok: true, today: {} })); S.on(M.adsLive, 'status', () => ({ ok: true })); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, days: [] }); expect(last(M.adsLive, 'daily')[0]).toEqual({ since: '2026-01-01', until: '2026-01-02', account: 'acc' }); },
  cases: [{ name: 'the default op is today', run: { method: 'GET', query: { account: 'acc' } }, expect: (r) => { expect(r.out).toEqual({ ok: true, today: {} }); expect(last(M.adsLive, 'today')[0]).toEqual({ account: 'acc' }); } }],
});
add('ads-sop', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { op: 'parse', campaign: 'C', adset: 'S', ad: 'A' } },
  stubs: () => { S.on(M.adsSop, 'parseCampaignName', (s) => ({ raw: s })); S.on(M.adsSop, 'parseAdSetName', (s) => ({ raw: s })); S.on(M.adsSop, 'parseAdName', (s) => ({ raw: s })); S.on(M.adsSop, 'compliance', async () => ({ ok: true, score: 1 })); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, campaign: { raw: 'C' }, adset: { raw: 'S' }, ad: { raw: 'A' } }); },
  cases: [{ name: 'any other op falls through to compliance', run: { method: 'GET', query: { op: 'compliance', platform: 'meta', limit: '3' } }, expect: (r) => { expect(r.out).toEqual({ ok: true, score: 1 }); expect(last(M.adsSop, 'compliance')[0]).toMatchObject({ platform: 'meta', limit: '3' }); } }],
});
add('ad-metrics', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => { S.on(M.adMetrics, 'catalog', () => ({ ok: true, metrics: ['ctr'] })); S.on(M.adMetrics, 'computeAll', (row) => ({ ctr: row.clicks / row.impressions })); S.on(M.adMetrics, 'accuracy', (rows) => ({ rows: rows.length })); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, metrics: ['ctr'] }); },
  cases: [
    { name: 'op=compute runs the formulas on every posted row', run: { json: { op: 'compute', rows: [{ clicks: 1, impressions: 4 }] } },
      expect: (r) => { expect(r.out).toEqual({ ok: true, count: 1, computed: [{ row: { clicks: 1, impressions: 4 }, metrics: { ctr: 0.25 } }], accuracy: { rows: 1 } }); } },
    { name: 'an unknown op is refused in the payload', run: { method: 'GET', query: { op: 'bogus' } }, expect: (r) => { expect(r.out.ok).toBe(false); expect(S.hits(M.adMetrics).length).toBe(0); } },
  ],
});
add('webengage-sync', { gate: 'cron', browser: 'demo', run: { method: 'GET', query: { bucket: 'dumps' } },
  stubs: () => S.on(M.webengage, 'syncFromStorage', async () => ({ ok: true, drained: 2 })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, drained: 2 }); expect(last(M.webengage, 'syncFromStorage')[0]).toEqual({ bucket: 'dumps' }); },
});
add('dispatch-enqueue', { gate: 'user', browser: 'refuse', run: { json: { asset_id: 'asset_1', channel: 'email' } },
  stubs: () => S.on(M.dispatch, 'enqueue', async () => ({ ok: true, job: { id: 'j1' } })),
  expect: (r) => {
    expect(r.status).toBe(200); expect(r.out).toEqual({ ok: true, job: { id: 'j1' } });
    const a = last(M.dispatch, 'enqueue');
    expect(a[0]).toMatchObject({ ok: true, user_id: H.USER_ID }); expect(a[0].token).toBe(H.SESSION);
    expect(a[1]).toBe(H.WS); expect(a[2]).toEqual({ asset_id: 'asset_1', channel: 'email' });
  },
  cases: [{ name: 'a refused enqueue is a 409', run: { json: { asset_id: 'asset_1' } }, stubs: () => S.on(M.dispatch, 'enqueue', async () => ({ ok: false, error: 'mapping_missing' })), expect: (r) => { expect(r.status).toBe(409); expect(r.out.error).toBe('mapping_missing'); } }],
});
add('dispatch-drain', { gate: 'cron-or-user', browser: 'refuse', run: { method: 'GET', auth: 'cron', origin: false, query: { workspace_id: 'ws_any' } },
  stubs: () => { S.on(M.dispatch, 'drain', async () => ({ ok: true, ran: 0 })); S.on(BWC, 'assertCanWrite', async () => ({ id: H.WS })); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, ran: 0 }); expect(last(M.dispatch, 'drain')[0]).toEqual({ workspaceId: 'ws_any' }); expect(S.hits(BWC, 'assertCanWrite')).toEqual([]); },
  cases: [{ name: 'a signed-in editor drains their OWN workspace, after the write check', run: { method: 'GET', auth: 'session', origin: true, query: {} },
    expect: (r) => {
      expect(r.out).toEqual({ ok: true, ran: 0 });
      const w = last(BWC, 'assertCanWrite'); expect(w[0].user_id).toBe(H.USER_ID); expect(w[1]).toBe(H.WS); expect(w[2]).toBe('run the dispatch queue');
      expect(last(M.dispatch, 'drain')[0]).toEqual({ workspaceId: H.WS });
    } }],
});
add('dispatch-list', { gate: 'user', browser: 'refuse', run: { method: 'GET', query: { status: 'queued', limit: '5' } },
  stubs: () => S.on(M.dispatch, 'listJobs', async () => [{ id: 'j1' }]),
  expect: (r) => { expect(r.out).toEqual({ ok: true, jobs: [{ id: 'j1' }] }); const a = last(M.dispatch, 'listJobs'); expect(a[0].user_id).toBe(H.USER_ID); expect(a[1]).toBe(H.WS); expect(a[2]).toEqual({ status: 'queued', limit: '5' }); },
});
add('dispatch-detail', { gate: 'user', browser: 'refuse', run: { method: 'GET', query: { id: 'j1' } },
  stubs: () => S.on(M.dispatch, 'jobDetail', async () => ({ id: 'j1', attempts: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, detail: { id: 'j1', attempts: [] } }); expect(last(M.dispatch, 'jobDetail').slice(1)).toEqual([H.WS, 'j1']); },
});
add('dispatch-cancel', { gate: 'user', browser: 'refuse', run: { json: { id: 'j2' } },
  stubs: () => S.on(M.dispatch, 'cancel', async () => ({ ok: true, cancelled: 'j2' })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, cancelled: 'j2' }); expect(last(M.dispatch, 'cancel').slice(1)).toEqual([H.WS, 'j2']); },
});
add('deliverability-domain', { gate: 'user', browser: 'refuse', run: { json: { domain: 'harness.example', selectors: ['s1'] } },
  stubs: () => {
    S.on(M.deliver, 'auditDomain', async (d) => ({ ok: true, domain: d, records: [{ spf: 1 }, { dkim: 1 }, { dmarc: 1 }, { mx: 1 }, { bimi: 1 }], blacklists: [], reputation: {}, score: 90, score_breakdown: {}, grade: 'A', checked_at: '2026-09-28T00:00:00.000Z' }));
    S.on(BWC, 'restAs', async () => []);
  },
  expect: (r) => {
    expect(r.out).toMatchObject({ ok: true, domain: 'harness.example', grade: 'A' });
    expect(last(M.deliver, 'auditDomain')).toEqual(['harness.example', { selectors: ['s1'] }]);
    // Persisted AS THE CALLER, into the active workspace, so the gate and the dashboard read one audit.
    const p = last(BWC, 'restAs');
    expect(p[0]).toBe(H.SESSION); expect(p[1]).toBe('domain_health_profiles?on_conflict=workspace_id,domain,role');
    expect(p[2].method).toBe('POST'); expect(p[2].body[0]).toMatchObject({ workspace_id: H.WS, domain: 'harness.example', role: 'sending', spf: { spf: 1 }, bimi: { bimi: 1 }, grade: 'A' });
  },
});
add('deliverability-preflight', { gate: 'user', browser: 'refuse', run: { json: { asset_id: 'a1', channel: 'email', message_priority: 'transactional', contact_fatigue: { status: 'exempt', forged: true } } },
  stubs: () => {
    S.on(M.preflight, 'run', async () => ({ ok: true, verdict: 'pass' }));
    S.on(M.ledger, 'evaluateForCaller', async () => ({ status: 'unknown', reason: 'no_history', from: 'ledger' }));
  },
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, verdict: 'pass' });
    // The contact-ledger verdict is the SERVER's (2026-10-04): computed for
    // this caller's workspace by evaluateForCaller, which checks membership
    // before any ledger read; the body's own `contact_fatigue` is dropped.
    const ev = last(M.ledger, 'evaluateForCaller');
    expect(ev[0]).toMatchObject({ ok: true });
    expect(ev[1]).toBe(H.WS);
    expect(ev[2]).toMatchObject({ channel: 'email', message_class: 'transactional' });
    expect(last(M.preflight, 'run')[0]).toEqual({ workspaceId: H.WS, asset_id: 'a1', channel: 'email', message_priority: 'transactional', contact_fatigue: { status: 'unknown', reason: 'no_history', from: 'ledger' } });
  },
  cases: [{ name: 'a channel that is not a message to a subscriber reads no ledger, and a posted verdict is still dropped', run: { json: { channel: 'facebook_page', contact_fatigue: { status: 'exempt', forged: true } } },
    expect: (r) => { expect(S.hits(M.ledger)).toEqual([]); expect(last(M.preflight, 'run')[0]).toEqual({ workspaceId: H.WS, channel: 'facebook_page' }); } }],
});
add('contact-fatigue', { gate: 'user', browser: 'refuse', run: { json: { op: 'evaluate', channel: 'sms', recipients: [{ external_profile_id: 'P1' }] } },
  stubs: () => S.on(M.ledger, 'handle', async (op) => (op === 'rules-save' ? { status: 403, body: { ok: false, error: 'forbidden' } } : { status: 200, body: { ok: true, status: 'computed', op } })),
  expect: (r) => {
    expect(r.status).toBe(200);
    expect(r.out).toEqual({ ok: true, status: 'computed', op: 'evaluate' });
    const a = last(M.ledger, 'handle');
    expect(a[0]).toBe('evaluate');
    expect(a[1].workspaceId).toBe(H.WS);
    expect(a[1].auth).toMatchObject({ ok: true });
    expect(a[1].body).toMatchObject({ op: 'evaluate', channel: 'sms', recipients: [{ external_profile_id: 'P1' }] });
  },
  cases: [
    { name: 'GET reads the rules by default', run: { method: 'GET', json: undefined }, expect: (r) => { expect(r.status).toBe(200); expect(last(M.ledger, 'handle')[0]).toBe('rules'); } },
    { name: 'an op that takes a body is refused on GET before the core', run: { method: 'GET', json: undefined, query: { op: 'ingest' } }, expect: (r) => { expect(r.status).toBe(405); expect(r.out.message).toMatch(/op=ingest takes a POST body/); expect(S.hits(M.ledger)).toEqual([]); } },
    { name: 'the core\'s own status passes through', run: { json: { op: 'rules-save', rules: {} } }, expect: (r) => { expect(r.status).toBe(403); expect(r.out).toEqual({ ok: false, error: 'forbidden' }); } },
  ],
});
add('deliverability-warmup', { gate: 'user', browser: 'refuse', run: { json: { start_on: '2026-10-01', target_daily: 100, days: 3 } },
  stubs: () => { S.on(M.deliver, 'buildWarmupPlan', () => [{ d: 1 }, { d: 2 }, { d: 3 }]); S.on(M.deliver, 'evaluateWarmupSafety', () => ({ safe: true })); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, plan: [{ d: 1 }, { d: 2 }, { d: 3 }], target_daily: 100, days: 3 }); expect(last(M.deliver, 'buildWarmupPlan')[0]).toEqual({ startOn: '2026-10-01', targetDaily: 100, days: 3 }); },
  cases: [{ name: 'op=safety evaluates the posted stats against the limits', run: { json: { op: 'safety', stats: { bounces: 1 }, limits: { max: 2 } } }, expect: (r) => { expect(r.out).toEqual({ safe: true }); expect(last(M.deliver, 'evaluateWarmupSafety')).toEqual([{ bounces: 1 }, { max: 2 }]); } }],
});
add('cohort-optimize', { gate: 'user', browser: 'refuse', run: { json: { contacts: [{ id: 'c1' }], message_priority: 'transactional', inactive_days: 90 } },
  stubs: () => S.on(M.cohort, 'analyseAudience', () => ({ summary: { n: 1 }, scored: [{ id: 'c1', score: 1 }] })),
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, summary: { n: 1 } });    // per-contact rows only on request
    expect(last(M.cohort, 'analyseAudience')).toEqual([[{ id: 'c1' }], { messagePriority: 'transactional', inactiveDays: 90 }]);
  },
  cases: [{ name: 'include_contacts returns the scored rows', run: { json: { contacts: [], include_contacts: true } }, expect: (r) => { expect(r.out.scored).toEqual([{ id: 'c1', score: 1 }]); } }],
});
add('connectors-health', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => S.on(M.health, 'health', async () => ({ ok: true, live: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, live: [] }); },
});
add('webengage-report', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { op: 'summary', hours: '12', market: 'UK' } },
  stubs: () => { S.on(M.webengage, 'eventSummary', async () => ({ ok: true, events: [] })); S.on(M.webengage, 'campaignPerformance', async () => ({ ok: true, campaigns: [] })); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, events: [] }); expect(last(M.webengage, 'eventSummary')[0]).toEqual({ hours: 12, market: 'UK' }); },
  cases: [{ name: 'the default op is campaign performance over 24h', run: { method: 'GET', query: {} }, expect: (r) => { expect(r.out).toEqual({ ok: true, campaigns: [] }); expect(last(M.webengage, 'campaignPerformance')[0]).toEqual({ event: 'Notification Clicked', hours: 24, market: null }); } }],
});
add('video-generate', { gate: 'model', model: 'video.generate', browser: 'refuse', run: { json: { prompt: 'a shoe', duration: 5 } },
  stubs: () => S.on(M.video, 'generateVideo', async () => ({ ok: true, provider: 'stub', job_id: 'v1' })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, provider: 'stub', job_id: 'v1' }); expect(last(M.video, 'generateVideo')[0]).toEqual({ prompt: 'a shoe', duration_s: 5, aspect: '16:9', tier: 'premium' }); },
  cases: [{ name: 'no prompt is a 400 before any provider', run: { json: {} }, expect: (r) => { expect(r.status).toBe(400); expect(S.hits(M.video)).toEqual([]); } }],
});
add('video-status', { gate: 'none', browser: 'refuse', run: { method: 'GET', query: { provider: 'veo', job_id: 'v1' } },
  stubs: () => S.on(M.video, 'getVideoStatus', async () => ({ ok: true, status: 'pending' })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, status: 'pending' }); expect(last(M.video, 'getVideoStatus')[0]).toEqual({ provider: 'veo', job_id: 'v1' }); },
  cases: [{ name: 'provider and job_id are both required', run: { method: 'GET', query: { provider: 'veo' } }, expect: (r) => { expect(r.status).toBe(400); expect(S.hits(M.video)).toEqual([]); } }],
});
add('mailer-assets', { gate: 'model', model: 'image.generate', browser: 'demo', run: { json: { entry_id: 'e1', market: 'UK' } },
  stubs: () => {
    S.on(M.mailerBuild, 'buildLifecycleMailer', async () => ({ mailer: { variants: [{ key: 'text_a', html: '<p>t</p>' }, { key: 'visual_a', html: '<p>v</p>' }] } }));
    S.on(M.assetAgent, 'fillMailerAssets', async () => ({ ok: true, filled: 2 }));
  },
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, filled: 2, entry_id: 'e1' });
    expect(last(M.mailerBuild, 'buildLifecycleMailer')[0]).toEqual({ id: 'e1' });
    expect(last(M.assetAgent, 'fillMailerAssets')).toEqual(['<p>v</p>', { tier: 'premium', market: 'UK', persist: true, video: true, gif: true }]);
  },
  cases: [{ name: 'neither html nor an entry_id is a 400', run: { json: {} }, expect: (r) => { expect(r.status).toBe(400); expect(S.hits(M.assetAgent)).toEqual([]); } }],
});
add('mailer-assets-status', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { provider: 'veo', job_id: 'v1', as: 'gif' } },
  stubs: () => { S.on(M.video, 'getVideoStatus', async () => ({ ok: true, status: 'completed', video_url: 'https://cdn.harness.test/v1.mp4' })); S.on(M.gif, 'convertFromVideo', async () => ({ ok: true, gif_url: 'g' })); },
  expect: (r) => { expect(r.out).toMatchObject({ status: 'completed', gif: { ok: true, gif_url: 'g' } }); expect(last(M.gif, 'convertFromVideo')[0]).toEqual({ video_url: 'https://cdn.harness.test/v1.mp4' }); },
});
add('social-run-daily', { gate: 'cron-get', model: 'social.daily_run', browser: 'refuse', run: { json: { date: '2026-10-01', platforms: ['instagram'], dry_run: true } },
  stubs: () => { S.on(M.catalogServer, 'withCatalog', async (ctx, fn) => fn()); S.on(M.social, 'runDaily', async () => ({ ok: true, posts: [] })); },
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, posts: [] });
    // The catalogue is pinned for the whole pipeline, to THIS brand and workspace.
    const c = last(M.catalogServer, 'withCatalog')[0]; expect(c.workspaceId).toBe(H.WS); expect(c.brand.name).toBe(BRAND.name);
    expect(last(M.social, 'runDaily')[0]).toMatchObject({ workspaceId: H.WS, date: '2026-10-01', platforms: ['instagram'], dry_run: true });
    expect(last(M.social, 'runDaily')[0].brand.name).toBe(BRAND.name);
  },
  cases: [
    { name: 'a GET without the cron secret is refused before the pipeline', run: { method: 'GET', json: undefined, auth: 'none', origin: false, query: { workspace_id: H.WS } }, expect: (r) => { expect(r.status).toBe(401); expect(S.hits(M.social)).toEqual([]); } },
    { name: 'a GET with the cron secret runs the pipeline', run: { method: 'GET', json: undefined, auth: 'cron', origin: false, query: { date: '2026-10-02', dry_run: '1' } }, expect: (r) => { expect(r.out).toEqual({ ok: true, posts: [] }); expect(last(M.social, 'runDaily')[0]).toMatchObject({ date: '2026-10-02', dry_run: true }); } },
  ],
});
add('social-list', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { date: '2026-10-01' } },
  stubs: () => S.on(M.social, 'listPosts', async () => ({ ok: true, posts: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, posts: [] }); expect(last(M.social, 'listPosts')[0]).toEqual({ date: '2026-10-01', from: undefined, to: undefined }); },
});
add('social-approve', { gate: 'none', browser: 'refuse', run: { json: { id: 'p1' } },
  stubs: () => S.on(M.social, 'setStatus', async () => ({ ok: true })),
  expect: (r) => { expect(r.status).toBe(200); expect(last(M.social, 'setStatus')).toEqual(['p1', 'approved']); },
});
add('social-skip', { gate: 'none', browser: 'refuse', run: { json: { id: 'p2' } },
  stubs: () => S.on(M.social, 'setStatus', async () => ({ ok: false, error: 'not found' })),
  expect: (r) => { expect(r.status).toBe(400); expect(last(M.social, 'setStatus')).toEqual(['p2', 'skipped']); },
});
add('tts', { gate: 'model', model: 'audio.tts', browser: 'refuse', run: { json: { text: 'hello there', voice_id: 'voice_h' } },
  env: { ELEVENLABS_API_KEY: 'eleven-harness' },
  // The provider IS the core here: the recorded call is the dispatch.
  stubs: () => guard.route((u) => u.startsWith('https://api.elevenlabs.io/'), () => H.reply(200, Buffer.from('ID3fakeaudio'), { 'content-type': 'audio/mpeg' })),
  expect: (r) => {
    expect(r.status).toBe(200); expect(String(r.headers['content-type'])).toBe('audio/mpeg'); expect(r.bytes.toString()).toBe('ID3fakeaudio');
    const c = guard.calls.find((x) => /elevenlabs/.test(x.url));
    expect(c.url).toContain('/v1/text-to-speech/voice_h'); expect(c.headers['xi-api-key']).toBe('eleven-harness'); expect(JSON.parse(c.body).text).toBe('hello there');
  },
  cases: [{ name: 'with no key the client is told to fall back, and nothing leaves the process', run: {}, env: { ELEVENLABS_API_KEY: undefined },
    expect: (r) => { expect(r.status).toBe(501); expect(guard.calls.filter((c) => /elevenlabs/.test(c.url))).toEqual([]); } }],
});
add('console-chat', { gate: 'model', model: 'assistant.chat', browser: 'refuse', run: { json: { message: 'what should ship next?' } },
  stubs: () => { S.on(M.analysis, 'runDaily', async () => ({ summary: { s: 1 }, patterns: { angle: ['a1'] } })); S.on(M.review, 'recalibrationStatus', async () => ({ overdue: false })); db.rows.smart_calendar = [{ slot_date: '2026-10-01', theme: 't' }]; },
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, reply: 'stubbed reply' });
    expect(llmCalls.length).toBe(1);
    expect(llmCalls[0]).toMatchObject({ userMessage: 'what should ship next?', stage: 'console' });
    expect(llmCalls[0].systemPrompt).toContain('"theme":"t"');   // the live context reached the model
    expect(last(M.analysis, 'runDaily')[0]).toEqual({ persist: false });
  },
});
for (const kind of ['anomaly', 'pulse', 'eod']) {
  add(`alerts-${kind}`, { gate: 'cron', browser: 'demo', run: { method: 'GET' },
    stubs: () => S.on(M.alerts, 'run', async () => ({ ok: true, kind })),
    expect: (r) => { expect(r.out).toEqual({ ok: true, kind }); expect(last(M.alerts, 'run')).toEqual([kind]); },
  });
}
add('alerts-preview', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => { S.on(M.market, 'ownsBundledExport', async () => false); S.on(M.alerts, 'detectAnomalies', () => [{ a: 1 }]); },
  expect: (r) => { expect(r.out).toMatchObject({ ok: true, kind: 'anomaly-preview', anomalies: [], data_scope: { level: 'other_workspace' } }); expect(S.hits(M.alerts)).toEqual([]); },
  cases: [{ name: 'the owner of the bundled export sees its anomalies', run: { method: 'GET' }, stubs: () => { S.on(M.market, 'ownsBundledExport', async () => true); S.on(M.alerts, 'detectAnomalies', () => [{ a: 1 }]); }, expect: (r) => { expect(r.out).toMatchObject({ anomalies: [{ a: 1 }] }); } }],
});
add('access-narrative', { gate: 'model', model: 'analytics.narrative', browser: 'demo', run: { json: { report: { staff: 3, apps: ['x'] } } },
  expect: (r) => { expect(r.out).toEqual({ ok: true, narrative: 'stubbed reply' }); expect(llmCalls.length).toBe(1); expect(llmCalls[0].stage).toBe('access-audit'); expect(llmCalls[0].userMessage).toContain('"staff":3'); expect(llmCalls[0].systemPrompt).toMatch(/READ-ONLY/); },
});
add('snowflake-sync', { gate: 'cron', browser: 'refuse', run: { method: 'GET', query: { region: 'uk' } },
  stubs: () => S.on(M.snowflake, 'runSync', async () => ({ ok: true, connected: false })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, connected: false }); expect(last(M.snowflake, 'runSync')[0]).toEqual({ region: 'uk', source: 'manual' }); },
});
add('snowflake-metrics', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { region: 'UK', metric: 'revenue', window: '30d' } },
  stubs: () => S.on(M.snowflake, 'readMirror', async () => ({ ok: true, connected: true, rows: [{ v: 1 }] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, rows: [{ v: 1 }] }); expect(last(M.snowflake, 'readMirror')[0]).toEqual({ region: 'uk', metric: 'revenue', window: '30d' }); },
  cases: [{ name: 'an unconnected mirror is a 501 that SAYS ok:false, never an empty success', run: { method: 'GET' }, stubs: () => S.on(M.snowflake, 'readMirror', async () => ({ ok: true, connected: false, note: 'unset' })),
    // The core answers ok:true (it ran fine) with connected:false; the router
    // used to merge that over its own ok:false, so the 501 body read ok:true.
    expect: (r) => { expect(r.status).toBe(501); expect(r.out).toMatchObject({ ok: false, connected: false, note: 'unset' }); } }],
});
add('cron', { gate: 'cron', browser: 'demo', run: { method: 'GET' },
  stubs: () => {
    S.on(M.osb, 'runDailyJob', async () => ({ pulled: 1 }));
    S.on(M.calendar, 'extractFestivals', async () => [1]);
    S.on(M.calendar, 'dailyReview', async () => ({ review: { changes: [1, 2] }, daily_summary: { pass_rate: 0.9 } }));
    S.on(M.competitor, 'benchmarks', async () => ({ UK: {}, _advisory: {} }));
    S.on(M.review, 'autoApproveSweep', async () => ({ approved: 0 }));
    S.on(M.review, 'recalibrationStatus', async () => ({ overdue: false }));
    S.on(M.generate, 'generateForSlot', async () => ({ ok: true }));
    S.on(M.sbplan, 'syncDaily', async () => ({ mode: 'db-linked', changes: [1] }));
    S.on(M.universe, 'refreshDueWorkspaces', async () => ({ due: 1, refreshed: 1, added: 0, note: 'n' }));
    S.on(M.snowflake, 'runSync', async () => ({ ok: true, connected: false }));
    S.on(CORE, 'logRun', async () => 'run_cron');
    db.rows.smart_calendar = [{ id: 'slot_due' }];
  },
  expect: (r) => {
    expect(r.status).toBe(200);
    expect(r.out.steps).toMatchObject({ os_daily: { pulled: 1 }, festivals: { detected: 1 }, daily_review: { changes: 2, pass_rate: 0.9 }, benchmarks: { ok: true, markets: ['UK'] }, auto_approve: { approved: 0 }, generation: { approved_due: 1, generated: 1 }, smart_brain_plan: { synced: true, mode: 'db-linked', changes: 1, prebuild_kicked: true }, competitor_universe: { due: 1, refreshed: 1, added: 0 }, snowflake_sync: { connected: false } });
    // STEP 0 is the read-only data pull, before anything downstream reads the day's data.
    expect(actionHits()[0]).toMatchObject({ module: M.osb, fn: 'runDailyJob', args: ['cron'] });
    expect(last(M.generate, 'generateForSlot')).toEqual(['slot_due', { persist: true }]);
    expect(last(M.sbplan, 'syncDaily')[0]).toEqual({ persist: true });
    expect(last(M.universe, 'refreshDueWorkspaces')[0]).toEqual({ maxWorkspaces: 3 });
    expect(last(CORE, 'logRun')[0]).toBe('cron');
    // The prebuild chain is kicked at the deployment's own URL, with the scheduler secret.
    const kick = guard.calls.find((c) => c.url.startsWith(H.SELF_BASE_URL));
    expect(kick.url).toBe(H.SELF_BASE_URL + '/api/calendar?action=smart-brain-prebuild'); expect(kick.method).toBe('POST'); expect(kick.headers.authorization).toBe(`Bearer ${H.CRON}`);
  },
});
add('domain', { gate: 'user', browser: 'demo', run: { method: 'GET', query: { op: 'check', domains: 'a.example,b.example' } },
  stubs: () => { S.on(M.domainIntel, 'checkMany', async () => ({ ok: true, results: [] })); S.on(M.domainIntel, 'sendingReadiness', async () => ({ ok: true, ready: false })); S.on(M.domainIntel, 'suggest', () => ({ ok: true, suggestions: [] })); S.on(WS_SCOPE, 'brandForWorkspace', async () => BRAND); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, results: [] }); expect(last(M.domainIntel, 'checkMany')).toEqual([['a.example', 'b.example'], { limit: 12 }]); },
  cases: [
    { name: 'op=readiness', run: { method: 'GET', query: { op: 'readiness', domain: 'c.example' } }, expect: (r) => { expect(r.out).toEqual({ ok: true, ready: false }); expect(last(M.domainIntel, 'sendingReadiness')).toEqual(['c.example']); } },
    { name: 'the default op suggests from the active brand record', run: { method: 'GET', query: { tlds: 'com,co', count: '3' } }, expect: (r) => { expect(r.out).toEqual({ ok: true, suggestions: [] }); expect(last(WS_SCOPE, 'brandForWorkspace')[1]).toBe(H.WS); expect(last(M.domainIntel, 'suggest')).toEqual([BRAND, { tlds: ['com', 'co'], count: 3 }]); } },
  ],
});
add('logo', { gate: 'user', browser: 'demo', run: { method: 'GET', query: { style: 'wordmark', notes: 'clean' } },
  stubs: () => { S.on(WS_SCOPE, 'brandForWorkspace', async () => BRAND); S.on(M.logo, 'logoBrief', () => ({ ok: true, brief: 'b' })); },
  expect: (r) => { expect(r.status).toBe(200); expect(r.out).toEqual({ ok: true, brief: 'b' }); expect(last(M.logo, 'logoBrief')).toEqual([BRAND, { style: 'wordmark', notes: 'clean' }]); },
  cases: [{ name: 'a brief that cannot be built is a 409', run: { method: 'GET' }, stubs: () => { S.on(WS_SCOPE, 'brandForWorkspace', async () => null); S.on(M.logo, 'logoBrief', () => ({ ok: false, error: 'no_brand' })); }, expect: (r) => { expect(r.status).toBe(409); } }],
});
add('daily-calendar', { gate: 'user', browser: 'demo', run: { method: 'GET', query: { back: '3', forward: '5' } },
  stubs: () => S.on(M.dailyCal, 'dayCalendar', async () => ({ ok: true, days: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, days: [] }); expect(last(M.dailyCal, 'dayCalendar')[0]).toEqual({ market: 'UK', back: 3, forward: 5, workspaceId: H.WS }); },
});
add('revenue-analysis', { gate: 'user', browser: 'demo', run: { method: 'GET', query: { days: '7' } },
  stubs: () => S.on(M.revenue, 'revenue', async () => ({ ok: true, cuts: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, cuts: [] }); expect(last(M.revenue, 'revenue')[0]).toEqual({ market: 'UK', days: 7, since: undefined, until: undefined }); },
});
add('agent-builder', { gate: 'agent-key', browser: 'public', run: { method: 'GET', query: { op: 'spec' } },
  stubs: () => { S.on(WS_SCOPE, 'brandForWorkspace', async () => BRAND); S.on(M.agentBuilder, 'openApiSpec', () => ({ ok: true, openapi: '3.0.0' })); S.on(M.agentBuilder, 'status', () => ({ ok: true, tools: 3 })); S.on(M.agentBuilder, 'runTool', async () => ({ ok: true, ran: true })); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, openapi: '3.0.0' }); const a = last(M.agentBuilder, 'openApiSpec')[0]; expect(a.brand).toBe(BRAND); expect(a.origin).toBe(hostOrigin()); },
  cases: [
    { name: 'a tool op with no key configured is 503, and runs nothing', run: { method: 'GET', query: { op: 'status' }, auth: 'none', origin: false, headers: { 'x-agent-key': 'whatever' } }, expect: (r) => { expect(r.status).toBe(503); expect(r.out.error).toBe('agent_builder_not_configured'); expect(S.hits(M.agentBuilder)).toEqual([]); } },
    { name: 'a tool op with the wrong key is 401, and runs nothing', env: { AGENT_BUILDER_API_KEY: 'agent-key-harness' }, run: { method: 'GET', query: { op: 'status' }, auth: 'none', origin: false, headers: { 'x-agent-key': 'wrong' } }, expect: (r) => { expect(r.status).toBe(401); expect(r.out.error).toBe('invalid_agent_key'); expect(S.hits(M.agentBuilder)).toEqual([]); } },
    { name: 'the right key reaches the tool runtime', env: { AGENT_BUILDER_API_KEY: 'agent-key-harness' }, run: { json: { op: 'run', tool: 'list_cohorts', days: 7 }, query: {}, auth: 'none', origin: false, headers: { 'x-agent-key': 'agent-key-harness' } }, expect: (r) => { expect(r.out).toEqual({ ok: true, ran: true }); expect(last(M.agentBuilder, 'runTool')).toEqual(['list_cohorts', { op: 'run', tool: 'list_cohorts', days: 7 }]); } },
  ],
});
add('platform-agents', { gate: 'user', model: 'analytics.report', browser: 'refuse', run: { method: 'GET', query: { days: '14', question: 'why?' } },
  stubs: () => { S.on(WS_SCOPE, 'brandForWorkspace', async () => BRAND); S.on(M.platformAgents, 'runAll', async () => ({ ok: true, agents: [] })); S.on(M.platformAgents, 'runAgent', async () => ({ ok: true, agent: 'meta' })); },
  expect: (r) => { expect(r.out).toEqual({ ok: true, agents: [] }); expect(last(M.platformAgents, 'runAll')[0]).toEqual({ platforms: undefined, market: 'UK', days: 14, question: 'why?', tier: 'standard', brand: BRAND }); },
  cases: [{ name: '?platform= runs one analyst', run: { method: 'GET', query: { platform: 'meta' } }, expect: (r) => { expect(r.out).toEqual({ ok: true, agent: 'meta' }); const a = last(M.platformAgents, 'runAgent'); expect(a[0]).toBe('meta'); expect(a[1].brand).toBe(BRAND); } }],
});
add('journey', { gate: 'user', browser: 'demo', run: { method: 'GET', query: { days: '30', since: '2026-01-01' } },
  stubs: () => S.on(M.journey, 'linkLedger', async () => ({ ok: true, links: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, links: [] }); expect(last(M.journey, 'linkLedger')[0]).toEqual({ market: 'UK', days: 30, since: '2026-01-01', until: undefined }); },
});
add('shopify', { gate: 'user', browser: 'demo', run: { method: 'GET', query: { op: 'orders', days: '7', limit: '20' } },
  stubs: () => S.on(M.shopify, 'dispatch', async () => ({ ok: true, orders: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, orders: [] }); expect(last(M.shopify, 'dispatch')).toEqual(['orders', { market: 'UK', days: 7, limit: 20 }]); },
});
add('os-connectors', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => S.on(M.osb, 'listConnectors', async () => ({ connectors: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, connectors: [] }); },
});
add('os-connector-sync', { gate: 'none', browser: 'demo', run: { method: 'GET', query: { id: 'klaviyo' } },
  stubs: () => S.on(M.osb, 'syncConnector', async () => ({ synced: 'klaviyo' })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, synced: 'klaviyo' }); expect(last(M.osb, 'syncConnector')).toEqual(['klaviyo', 'manual']); },
  cases: [{ name: 'no id is a 400', run: { method: 'GET', query: {} }, expect: (r) => { expect(r.status).toBe(400); expect(S.hits(M.osb)).toEqual([]); } }],
});
add('os-run-daily-job', { gate: 'cron-flag', browser: 'refuse', run: { method: 'GET' },
  stubs: () => S.on(M.osb, 'runDailyJob', async (src) => ({ source: src })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, source: 'manual' }); },
  cases: [
    { name: 'the scheduled path (?cron=1) without the secret is refused', run: { method: 'GET', query: { cron: '1', workspace_id: H.WS }, auth: 'none', origin: false }, expect: (r) => { expect(r.status).toBe(401); expect(S.hits(M.osb)).toEqual([]); } },
    { name: 'the scheduled path with the secret runs as cron', run: { method: 'GET', query: { cron: '1' }, auth: 'cron', origin: false }, expect: (r) => { expect(r.out).toEqual({ ok: true, source: 'cron' }); } },
  ],
});
add('os-dashboard', { gate: 'none', browser: 'demo', run: { method: 'GET' },
  stubs: () => S.on(M.osb, 'dashboard', async () => ({ kpis: {} })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, kpis: {} }); },
});
add('dispatch-webhook', { gate: 'signature', browser: 'n/a',
  run: { raw: 'not json at all', contentType: 'application/json', auth: 'none', origin: false, query: { provider: 'meta' } },
  stubs: () => S.on(M.webhooks, 'receive', async (req, res) => res.status(200).json({ ok: true, received: req.query.provider })),
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, received: 'meta' });
    // Routed BEFORE the body is read as data: behind the Vercel helper req.body
    // throws 400 on this body, so a router that read it first could never
    // have handed the receiver these bytes to verify.
    expect(srv.stats[srv.stats.length - 1].bodyReads).toBe(0);
    expect(S.hits(BRAND_RT, 'resolve')).toEqual([]);          // no scoping either: a callback carries a signature, not a session
    expect(guard.calls).toEqual([]);
  },
});

/* ── generate the tests ─────────────────────────────────────────────────── */

const defaultsFor = (gate) => {
  if (gate === 'cron') return { auth: 'cron', origin: false };
  if (gate === 'user' || gate === 'model') return { auth: 'session', origin: true };
  return { auth: 'session', origin: true };
};

function withEnv(env, fn) {
  return async () => {
    const undo = env ? H.pinEnv(env) : null;
    try { await fn(); } finally { if (undo) undo(); }
  };
}

const noHarnessError = (r) => expect((r.out && r.out.harness_error) || undefined, `harness error: ${r.text}`).toBeUndefined();
const catalog = require(H.ROOT + '/api/_shared/credit-catalog.js');
/** A metered answer carries the meter's receipt; the entry's own assertions are about the core's payload. */
function receiptOff(e, r) {
  if (!e.model || !r.out || typeof r.out !== 'object' || Array.isArray(r.out)) return;
  if (r.out.credits) expect(r.out.credits.feature).toBe(e.model);
  delete r.out.credits;
}
/** A case's request: its own fields over the base; a case that posts a body is a POST. */
const caseRun = (base, c) => {
  const m = Object.assign({}, base, c.run || {});
  if (c.run && c.run.json !== undefined && !c.run.method) m.method = 'POST';
  return m;
};

for (const e of T) {
  test.describe(`?action=${e.action} [${e.gate}]`, () => {
    const base = Object.assign(defaultsFor(e.gate), e.run || {});

    test('dispatches to its core with the arguments the router built', withEnv(e.env, async () => {
      if (e.stubs) e.stubs();
      const r = await call(e.action, base);
      noHarnessError(r);
      receiptOff(e, r);
      e.expect(r);
      expect(guard.escaped, 'a network call escaped').toEqual([]);
    }));

    for (const c of e.cases || []) {
      test(c.name, withEnv(c.env, async () => {
        if (c.stubs) c.stubs(); else if (e.stubs) e.stubs();
        const r = await call(e.action, caseRun(base, c));
        noHarnessError(r);
        receiptOff(e, r);
        c.expect(r);
        expect(guard.escaped, 'a network call escaped').toEqual([]);
      }));
    }

    if (e.model) {
      // The admitted request above was a SESSION's, so it was metered: held at
      // the catalog price and settled (or refunded) - asserted here once, and
      // the receipt is taken off the payload before the entry's own assertions.
      const metered = (r0) => String(r0.method || (r0.json !== undefined ? 'POST' : 'GET')).toUpperCase() === 'POST' || e.gate === 'user' || e.action === 'analysis-narrative';
      if (metered(base)) {
        test(`a session is held at the catalog price of ${e.model} before the core runs`, withEnv(e.env, async () => {
          if (e.stubs) e.stubs();
          const r = await call(e.action, base);
          noHarnessError(r);
          const hold = guard.calls.find((c) => /\/rpc\/credit_hold/.test(c.url));
          expect(hold, 'no credit hold was taken').toBeTruthy();
          const args = JSON.parse(String(hold.body || '{}'));
          expect(args.p_feature).toBe(e.model);
          const q = catalog.quote(e.model, undefined, {});
          expect(Number(args.p_amount)).toBe(q.cost * (args.p_units || q.units));
          expect(guard.calls.some((c) => /\/rpc\/credit_(settle|release)/.test(c.url)), 'the hold was neither settled nor released').toBe(true);
        }));
      }
      test('an anonymous server-to-server request is refused (401) before the core: no model call, no hold, no provider', withEnv(e.env, async () => {
        if (e.stubs) e.stubs();
        const r = await call(e.action, Object.assign({}, base, { auth: 'none', origin: false, query: Object.assign({ workspace_id: H.WS }, base.query || {}) }));
        expect(r.status).toBe(401);
        expect(r.out).toMatchObject({ ok: false, error: 'sign_in_required' });
        expect(typeof r.out.message).toBe('string');
        expect(actionHits()).toEqual([]);
        expect(llmCalls).toEqual([]);
        expect(guard.balanceMoves).toEqual([]);
        expect(guard.calls.filter((c) => !c.url.startsWith(H.SUPABASE_URL))).toEqual([]);
      }));
      test('a forged bearer is refused before the core: no model call, no hold', withEnv(e.env, async () => {
        if (e.stubs) e.stubs();
        const r = await call(e.action, Object.assign({}, base, { auth: 'forged', origin: true }));
        expect(r.status).toBe(401);
        expect(r.out).toMatchObject({ ok: false, error: 'invalid_session' });
        expect(guard.authChecks.length).toBe(1);             // checked ONCE, not once per gate
        expect(actionHits()).toEqual([]);
        expect(llmCalls).toEqual([]);
        expect(guard.balanceMoves).toEqual([]);
      }));
      test('with the meter NOT configured, the router\'s own gate still refuses the anonymous caller', withEnv(Object.assign({}, e.env, { SUPABASE_SERVICE_ROLE_KEY: undefined }), async () => {
        if (e.stubs) e.stubs();
        const r = await call(e.action, Object.assign({}, base, { auth: 'none', origin: false, query: Object.assign({ workspace_id: H.WS }, base.query || {}) }));
        expect(r.status).toBe(401);
        expect(actionHits()).toEqual([]);
        expect(llmCalls).toEqual([]);
        expect(guard.calls.filter((c) => !c.url.startsWith(H.SUPABASE_URL))).toEqual([]);
      }));
      if (e.gate === 'model') {
        test('the scheduler\'s bearer is admitted, and is never metered', withEnv(e.env, async () => {
          if (e.stubs) e.stubs();
          const r = await call(e.action, Object.assign({}, base, { auth: 'cron', origin: false }));
          expect(r.status).not.toBe(401);
          expect(r.status).not.toBe(403);
          expect(guard.balanceMoves).toEqual([]);
        }));
      }
    }

    if (e.gate === 'user' || e.gate === 'cron-or-user') {
      test('an anonymous request is refused before the core runs', async () => {
        if (e.stubs) e.stubs();
        const r = await call(e.action, Object.assign({}, base, { auth: 'none', origin: false, query: Object.assign({ workspace_id: H.WS }, base.query || {}) }));
        expect(r.status).toBe(401);
        expect(r.out).toMatchObject({ ok: false, error: 'sign_in_required' });
        expect(typeof r.out.message).toBe('string');
        expect(actionHits()).toEqual([]);
        expect(guard.restBeyondScoping()).toEqual([]);
        expect(guard.escaped).toEqual([]);
      });
      test('a forged bearer is refused by the auth backend before the core runs', async () => {
        if (e.stubs) e.stubs();
        const r = await call(e.action, Object.assign({}, base, { auth: 'forged', origin: true }));
        expect(r.status).toBe(401);
        expect(r.out).toMatchObject({ ok: false, error: 'invalid_session' });
        expect(guard.authChecks.length).toBe(1);             // the token was CHECKED, not trusted for being present
        expect(actionHits()).toEqual([]);
        expect(guard.restBeyondScoping()).toEqual([]);
        expect(guard.escaped).toEqual([]);
      });
    }
    if (e.gate === 'cron') {
      test('without the scheduler secret it is refused before the core runs', async () => {
        if (e.stubs) e.stubs();
        for (const auth of ['none', 'forged', 'session']) {
          const r = await call(e.action, Object.assign({}, base, { auth, origin: false, query: Object.assign({ workspace_id: H.WS }, base.query || {}) }));
          expect(r.status, auth).toBe(401);
          expect(actionHits(), auth).toEqual([]);
        }
        expect(guard.restBeyondScoping()).toEqual([]);
        expect(guard.escaped).toEqual([]);
      });
    }
    if (e.browser === 'public') {
      // A description of the product, not anybody's data (2026-09-29): the
      // attribution rule steps aside, the core is reached, and the answer is
      // neither the demo envelope nor a refusal. The TeleSuite registry, the
      // tool manifest, the Agent Builder document and the navigation detector
      // used to get the demo overview here, and the TeleSuite hub could not
      // start for a signed-out visitor.
      test('an unattributed browser request gets the public answer, not demo data and not a refusal', async () => {
        if (e.stubs) e.stubs();
        const r = await call(e.action, Object.assign({}, base, { auth: 'none', origin: true, query: Object.assign({}, base.query || {}, { workspace_id: undefined }) }));
        expect(r.status).toBeLessThan(400);
        expect(r.out.mode).not.toBe('demo');
        expect(r.out.error).not.toBe('workspace_unresolved');
        expect(actionHits().length).toBeGreaterThan(0);
        expect(guard.escaped).toEqual([]);
      });
    }
    if (e.browser === 'refuse' || e.browser === 'demo') {
      test(`an unattributed browser request is ${e.browser === 'refuse' ? 'refused (409)' : 'served demo data'} before the switch`, async () => {
        if (e.stubs) e.stubs();
        const r = await call(e.action, Object.assign({}, base, { auth: 'none', origin: true, query: Object.assign({}, base.query || {}, { workspace_id: undefined }) }));
        if (e.browser === 'refuse') {
          expect(r.status).toBe(409);
          expect(r.out).toMatchObject({ ok: false, error: 'no_active_brand', mode: 'demo', setup_url: '/onboarding' });
        } else {
          expect(r.status).toBe(200);
          expect(r.out).toMatchObject({ error: 'workspace_unresolved', setup_url: '/onboarding' });
          expect(Array.isArray(r.out.demo_brands)).toBe(true);
        }
        expect(S.reached).toEqual([]);                        // not even the brand resolve: the refusal precedes it
        expect(guard.restBeyondScoping()).toEqual([]);
        expect(guard.escaped).toEqual([]);
      });
    }
    if (e.gate === 'none') {
      test('an anonymous server-to-server request (no Origin, no bearer) is admitted: this action has no caller gate', withEnv(e.env, async () => {
        if (e.stubs) e.stubs();
        const r = await call(e.action, Object.assign({}, base, { auth: 'none', origin: false, query: Object.assign({ workspace_id: H.WS }, base.query || {}) }));
        expect(r.status).toBeLessThan(500);
        // Reached its core: a stubbed module, the model, or (tts) the provider itself.
        const providerCalls = guard.calls.filter((c) => !c.url.startsWith(H.SUPABASE_URL) && !c.url.startsWith(H.SELF_BASE_URL));
        expect(actionHits().length + llmCalls.length + providerCalls.length).toBeGreaterThan(0);
        expect(guard.authChecks).toEqual([]);
      }));
    }
  });
}

/* ── the router itself ──────────────────────────────────────────────────── */

test.describe('the router', () => {
  test('OPTIONS is a 204 with the CORS headers, and a GET carries them too', async () => {
    const o = await H.request(srv.port, { method: 'OPTIONS', path: '/api/brain?action=status' });
    expect(o.status).toBe(204);
    expect(o.headers['access-control-allow-origin']).toBe('*');
    expect(o.headers['access-control-allow-methods']).toContain('POST');
    expect(o.headers['access-control-allow-headers']).toMatch(/Authorization/);
    expect(o.headers['cache-control']).toBe('no-store');
    expect(S.reached).toEqual([]);
    S.on(M.osb, 'dashboard', async () => ({}));
    const g = await call('os-dashboard', { method: 'GET', auth: 'session', origin: true });
    expect(g.headers['access-control-allow-origin']).toBe('*');
  });

  test('an unknown action is the router\'s own 400, and every action it advertises is in the table', async () => {
    const r = await call('no-such-action', { method: 'GET', auth: 'session', origin: true });
    expect(r.status).toBe(400);
    expect(r.out.error).toBe('Unknown action');
    const known = new Set(T.map((e) => e.action));
    expect(r.out.actions.filter((a) => !known.has(a))).toEqual([]);
    expect(actionHits()).toEqual([]);
  });

  test('a core that throws is a 500 naming the action, not a hung request', async () => {
    S.on(M.osb, 'dashboard', async () => { throw new Error('backbone exploded'); });
    const r = await call('os-dashboard', { method: 'GET', auth: 'session', origin: true });
    expect(r.status).toBe(500);
    // `error` is still the raw message an existing reader depends on; the
    // sentence for a person rides beside it (2026-09-29).
    expect(r.out).toMatchObject({ ok: false, action: 'os-dashboard', error: 'backbone exploded' });
    expect(r.out.message).toMatch(/failed on the server before it could answer, and nothing was saved/);
  });

  test('every case label in the switch has an entry here, and the enumeration is not trivial', () => {
    const code = H.routerCode(BRAIN);
    const cases = [...code.matchAll(/^\s*case '([a-z0-9-]+)':/gm)].map((m) => m[1]);
    const literal = [...code.matchAll(/\baction === '([a-z0-9-]+)'/g)].map((m) => m[1]);
    const enumerated = H.uniqSorted([...cases, ...literal]);
    expect(enumerated.length).toBeGreaterThanOrEqual(80);
    const tabled = H.uniqSorted(T.map((e) => e.action));
    expect(enumerated.filter((a) => !tabled.includes(a)), 'actions the router dispatches with no test').toEqual([]);
    expect(tabled.filter((a) => !enumerated.includes(a)), 'tests for actions the router no longer has').toEqual([]);
  });

  test('the actions that carry no caller gate are exactly these, by name', () => {
    // Pinned so a NEW ungated action has to be argued for. Each one's admitted
    // anonymous test above is what makes this a measured list rather than a label.
    const ungated = H.uniqSorted(T.filter((e) => e.gate === 'none').map((e) => e.action));
    expect(ungated).toEqual([
      'ad-insights', 'ad-metrics', 'ads-analysis', 'ads-live', 'ads-snowflake', 'ads-sop',
      'agent-sessions', 'agent-sync', 'agent-upsert', 'agents',
      'alerts-preview', 'analyze', 'asset', 'assets', 'benchmarks', 'brand-tools',
      'calendar', 'calendar-generate', 'calendar-review', 'calendar-scenarios', 'campaigns', 'cohorts', 'confidence',
      'config', 'connectors-health', 'decide', 'feedback', 'festivals', 'festivals-extract',
      'growth-os', 'jarvis', 'kb', 'kb-patterns', 'klaviyo', 'library', 'mailer-assets-status', 'mvt',
      'os-connector-sync', 'os-connectors', 'os-dashboard', 'recalibrate', 'review', 'scores', 'snowflake-metrics',
      'social-approve', 'social-list', 'social-skip', 'status', 'telesuite',
      'video-status', 'webengage-report',
    ]);
  });

  test('every action that reaches a model is metered, by name, at an existing catalog key', () => {
    // The model set, pinned the same way: adding a model action without a
    // meter fails here, and a key the catalog does not declare fails too.
    const modelled = H.uniqSorted(T.filter((e) => e.model).map((e) => e.action));
    expect(modelled).toEqual([
      'access-narrative', 'agent-analyze', 'agent-chat', 'agentic-run', 'analysis-narrative', 'brand-chat',
      'console-chat', 'generate', 'mailer-assets', 'platform-agents', 'social-run-daily', 'team-chat', 'tts', 'video-generate',
    ]);
    for (const e of T.filter((x) => x.model)) expect(catalog.get(e.model), `${e.action} -> ${e.model} is not in the catalog`).toBeTruthy();
  });
});

/* ── the workspace-scoping contract (shared with api/calendar.js) ───────── */

test.describe('workspace scoping', () => {
  test('a signed-in request resolves the caller\'s ACTIVE workspace and stamps it onto the request for every core', async () => {
    S.on(M.telesuite, 'handle', async (req, res) => res.json({ ws: req.__workspaceId, q: req.query.workspace_id, brand: req.__brand && req.__brand.__resolved_for }));
    const r = await call('telesuite', { json: {}, auth: 'session', origin: true });
    expect(r.out).toEqual({ ws: H.WS, q: H.WS, brand: H.WS });
    expect(guard.rest(/brand_user_prefs/).length).toBe(1);
  });
  test('an explicit workspace_id wins over the session, and is what the brand record is resolved for', async () => {
    S.on(M.telesuite, 'handle', async (req, res) => res.json({ ws: req.__workspaceId, brand: req.__brand && req.__brand.__resolved_for }));
    const r = await call('telesuite', { json: {}, auth: 'session', origin: true, query: { workspace_id: 'ws_explicit' } });
    expect(r.out).toEqual({ ws: 'ws_explicit', brand: 'ws_explicit' });
    expect(guard.rest(/brand_user_prefs/)).toEqual([]);
  });
  test('a signed-in user with NO active workspace gets null, never the oldest workspace', async () => {
    guard.restore();
    guard = H.netGuard({ activeWorkspace: null });
    S.on(M.telesuite, 'handle', async (req, res) => res.json({ ws: req.__workspaceId }));
    const r = await call('telesuite', { json: {}, auth: 'session', origin: true });
    expect(r.out).toEqual({ ws: null });
    expect(guard.rest(/order=created_at\.asc/)).toEqual([]);
  });
  test('a userless server-to-server call falls to the default workspace, which is the documented cron behaviour', async () => {
    S.on(M.telesuite, 'handle', async (req, res) => res.json({ ws: req.__workspaceId }));
    const r = await call('telesuite', { json: {}, auth: 'none', origin: false });
    expect(r.out).toEqual({ ws: H.WS_OLDEST });
  });
  test('scoping never hard-fails the router: a dead auth backend still answers the action', async () => {
    guard.restore();
    guard = H.netGuard({ supabase: false });
    S.on(M.osb, 'dashboard', async () => ({ kpis: {} }));
    const r = await call('os-dashboard', { method: 'GET', auth: 'session', origin: true });
    expect(r.status).toBe(200);
    expect(r.out).toEqual({ ok: true, kpis: {} });
    expect(guard.escaped.length).toBeGreaterThan(0);        // the lookups were attempted and refused; the router carried on
  });
});
