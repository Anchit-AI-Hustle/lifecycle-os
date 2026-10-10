// api/calendar.js, EXECUTED: the shipped router (credits.metered + request-
// scope wrappers included) on a real http.Server, one test per ?action=.
//
// Until 2026-09-28 no test loaded this file (coverage/UNTESTED.md: 0 of 458
// lines). Executing it found two branches that could never have worked:
//
//   - ?action=lifecycle-build-mailer answered 500 "q is not defined" on every
//     request that did not carry force:true. `q` was declared inside the
//     lifecycle-list branch; the build-mailer branch read it through
//     `(q && q.force)`, and the catch turned the ReferenceError into a 500.
//   - the /lp/:id FALLBACK page never resolved the workspace's brand: the
//     handler read `body.config.workspace_id` and `body` is declared only
//     inside smartBrain() and lifecycle(). The catch swallowed it, so the
//     fallback always rendered with brand:null.
//
// Both are pinned here as executed tests. Neither could be seen by a test
// that read the source, which is the whole point of the executed-tests rule.
//
// What is stubbed. calendar.js DESTRUCTURES lib/smart-brain/services.js at
// load and binds calendar-generate.js / calendar-trigger.js (modules that
// export the function itself), so those three are swapped on their cache
// entries and calendar.js alone is re-required against them; every other core
// is an object and takes a recording stub on its exported function. The
// credit meter is not stubbed: it runs for real against the fake project, so
// the metered actions prove that an anonymous caller is refused BEFORE the
// generator runs and without a hold, a session takes a hold and settles it,
// and the scheduler's bearer is free.
//
// Run: npx playwright test tests/router-calendar.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const H = require('./router-harness');

const CAL = 'api/calendar.js';
const SERVICES = 'lib/smart-brain/services.js';
const CALGEN = 'api/_shared/calendar-generate.js';
const TRIGGER = 'api/_shared/calendar-trigger.js';
const PLAN = 'api/_shared/smart-brain-plan.js';
const LIFE_GEN = 'api/_shared/lifecycle-calendar-generate.js';
const LIFE_BUILD = 'api/_shared/lifecycle-mailer-build.js';
const EXPORT = 'api/_shared/calendar-export.js';
const CONN = 'api/_shared/connector-check.js';
const FALLBACK = 'api/_shared/landing-fallback.js';
const WS_SCOPE = 'api/_shared/workspace-scope.js';

/* ── file-level: the three load-time bindings ───────────────────────────── */

let restoreEnv, srv, S, guard;
const FILE = new H.Stubs();
/** Calls into the swapped modules (recorded here, since they outlive a test's Stubs). */
const F = { calgen: [], trigger: [], runDaily: [], schema: [], generated: [], adapters: [] };
const resetF = () => { for (const k of Object.keys(F)) F[k].length = 0; };

test.beforeAll(async () => {
  restoreEnv = H.routerEnv();
  require(H.ROOT + '/' + CAL);
  const realServices = require(H.ROOT + '/' + SERVICES);
  class FakeAdapter {
    constructor(config, workspaceId) { this.config = config; this.workspaceId = workspaceId || (config && config.workspace_id) || null; F.adapters.push(this); }
    get connected() { return true; }
    async insert(table, rows) { this.inserted = [table, rows]; return { ok: true, rows }; }
  }
  class FakeGeneration {
    constructor(config) { this.config = config; }
    generate(entry) { F.generated.push([this.config, entry]); return { id: 'camp_harness', entry }; }
  }
  FILE.swap(SERVICES, Object.assign({}, realServices, {
    SmartBrainDbAdapter: FakeAdapter,
    GenerationService: FakeGeneration,
    runDailySmartBrain: async (o) => { F.runDaily.push(o); return { ok: true, mode: 'stubbed', calendar: { entries: [] }, campaigns: [] }; },
    schemaAssumptions: (cfg) => { F.schema.push(cfg); return { tables: cfg.tableNames }; },
  }));
  FILE.swap(CALGEN, async function calendarGenerateStub(req, res) { F.calgen.push({ method: req.method, body: req.body, query: req.query }); return res.status(200).json({ ok: true, generator: 'calendar-generate', plan: [] }); });
  const trigger = async function triggerMailerStub(req, res) { F.trigger.push({ method: req.method, body: req.body }); return res.status(200).json({ ok: true, generator: 'calendar-trigger' }); };
  trigger.helpers = require(H.ROOT + '/' + TRIGGER).helpers;
  FILE.swap(TRIGGER, trigger);
  FILE.reload(CAL);
  srv = await H.serve(CAL);
});
test.afterAll(async () => { await srv.close(); FILE.restore(); restoreEnv(); });
test.beforeEach(() => {
  resetF();
  require(H.ROOT + '/' + WS_SCOPE).invalidate();
  guard = H.netGuard();
  guard.route((u) => u.startsWith(H.SELF_BASE_URL), () => H.reply(200, { ok: true, chained: true }));
  S = new H.Stubs();
});
test.afterEach(() => { S.restore(); guard.restore(); });

const noHarnessError = (r) => expect((r.out && r.out.harness_error) || undefined, `harness error: ${r.text}`).toBeUndefined();
function call(action, o) {
  const r = o || {};
  const query = Object.assign({ action }, r.query || {});
  return H.request(srv.port, {
    method: r.method || (r.json !== undefined ? 'POST' : 'GET'), path: '/api/calendar' + H.qs(query),
    json: r.json, headers: r.headers, auth: r.auth || 'session', origin: r.origin !== undefined ? r.origin : true,
  });
}
const last = (mod, fn) => { const h = S.hit(mod, fn); expect(h, `${mod} ${fn} was not reached`).toBeTruthy(); return h.args; };
const prebuildKicks = () => guard.calls.filter((c) => c.url === H.SELF_BASE_URL + '/api/calendar?action=smart-brain-prebuild');

/* ── the metered generators ─────────────────────────────────────────────── */

test.describe('the metered actions', () => {
  const METERED = [
    ['generate', () => F.calgen, 'calendar.generate', 25],
    ['trigger-mailer', () => F.trigger, 'mailer.generate', 20],
    ['triggermailer', () => F.trigger, 'mailer.generate', 20],
  ];
  for (const [action, reached, feature, cost] of METERED) {
    test(`?action=${action}: a session takes a hold, the generator runs, the hold settles and the receipt rides the payload`, async () => {
      const r = await call(action, { json: { days: 14, markets: ['UK'] } });
      noHarnessError(r);
      expect(r.status).toBe(200);
      expect(r.out.generator).toBe(action === 'generate' ? 'calendar-generate' : 'calendar-trigger');
      expect(reached().length).toBe(1);
      expect(reached()[0].method).toBe('POST');
      expect(reached()[0].body).toEqual({ days: 14, markets: ['UK'] });
      expect(r.out.credits).toMatchObject({ feature, cost, charged: cost });
      expect(guard.balanceMoves.map((c) => c.url.split('/rpc/')[1])).toEqual(['credit_hold', 'credit_settle']);
      expect(guard.escaped).toEqual([]);
    });
    test(`?action=${action}: an anonymous POST is refused before the generator runs, and nothing is held`, async () => {
      const r = await call(action, { json: { days: 14 }, auth: 'none', origin: false });
      expect(r.status).toBe(401);
      expect(r.out).toMatchObject({ ok: false, error: 'sign_in_required' });
      expect(reached()).toEqual([]);
      expect(guard.balanceMoves).toEqual([]);
      expect(guard.authChecks).toEqual([]);
    });
    test(`?action=${action}: a forged bearer is checked against the auth backend and refused, generator untouched`, async () => {
      const r = await call(action, { json: { days: 14 }, auth: 'forged' });
      expect(r.status).toBe(401);
      expect(r.out.error).toBe('invalid_session');
      expect(guard.authChecks.length).toBe(1);
      expect(reached()).toEqual([]);
      expect(guard.balanceMoves).toEqual([]);
    });
    test(`?action=${action}: the scheduler's bearer runs it free`, async () => {
      const r = await call(action, { json: { days: 14 }, auth: 'cron', origin: false });
      expect(r.status).toBe(200);
      expect(reached().length).toBe(1);
      expect(r.out.credits).toBeUndefined();
      expect(guard.balanceMoves).toEqual([]);
      expect(guard.authChecks).toEqual([]);
    });
  }

  test('a generator that answers an error releases the hold instead of settling it', async () => {
    // A generator that fails: the wrapper must give the reservation back.
    const failing = async function calendarGenerateFails(req, res) { F.calgen.push({ method: req.method }); return res.status(502).json({ ok: false, error: 'provider down' }); };
    S.swap(CALGEN, failing); S.reload(CAL);
    const f = await call('generate', { json: { days: 7 } });
    expect(f.status).toBe(502);
    expect(f.out.error).toBe('provider down');
    expect(F.calgen.length).toBe(1);
    expect(guard.balanceMoves.map((c) => c.url.split('/rpc/')[1])).toEqual(['credit_hold', 'credit_release']);
  });
});

/* ── connectors-check, lifecycle-*, lp, the default ─────────────────────── */

test.describe('connectors-check', () => {
  test('runs the text-provider diagnostics with the caller\'s own Gemini key, and answers OPTIONS with 204', async () => {
    S.on(CONN, 'checkTextProviders', () => ({ anyConfigured: false, anyUsable: false, providers: [] }));
    const r = await call('connectors-check', { method: 'GET', headers: { 'x-gemini-key': 'user-gem' } });
    noHarnessError(r);
    expect(r.out).toEqual({ ok: true, anyConfigured: false, anyUsable: false, providers: [] });
    expect(last(CONN, 'checkTextProviders')).toEqual([{ userGeminiKey: 'user-gem' }]);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    const o = await H.request(srv.port, { method: 'OPTIONS', path: '/api/calendar?action=connectors-check' });
    expect(o.status).toBe(204);
  });
  test('a diagnostics failure is a 200 that says it could not run, not a 500', async () => {
    S.on(CONN, 'checkTextProviders', () => { throw new Error('boom'); });
    const r = await call('connectors-check', { method: 'GET' });
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({ ok: false, anyConfigured: false, providers: [] });
  });
});

test.describe('lifecycle-*', () => {
  test('lifecycle-generate builds the cohort calendar from the posted brief (metered)', async () => {
    S.on(LIFE_GEN, 'generateLifecycleCalendar', async () => ({ entries: [{ id: 'e1' }], persisted: false }));
    const r = await call('lifecycle-generate', { json: { start_date: '2026-10-01', days: 7, cohorts: ['champions'], cadence_per_week: 2, market: 'US' } });
    noHarnessError(r);
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({ ok: true, entries: [{ id: 'e1' }], credits: { feature: 'calendar.generate' } });
    // The caller's own ACTIVE workspace (2026-10-04), so the planner judges
    // each row against that brand's contact ledger and nobody else's.
    expect(last(LIFE_GEN, 'generateLifecycleCalendar')).toEqual([{ start_date: '2026-10-01', days: 7, cohorts: ['champions'], cadence_per_week: 2, market: 'US', workspace_id: H.WS }]);
    expect(guard.balanceMoves.length).toBe(2);
  });
  test('lifecycle-generate never takes a workspace from the request, and passes the history and rules a request carried', async () => {
    S.on(LIFE_GEN, 'generateLifecycleCalendar', async () => ({ entries: [], persisted: false }));
    const r = await call('lifecycle-generate', { query: { workspace_id: 'ws_someone_else' }, json: { workspace_id: 'ws_someone_else', start_date: '2026-10-01', contact_ledger: { touches: [] }, contact_policy: { promotional_per_7d: 1 } } });
    noHarnessError(r);
    expect(r.status).toBe(200);
    const a = last(LIFE_GEN, 'generateLifecycleCalendar')[0];
    expect(a.workspace_id).toBe(H.WS);
    expect(a.contact).toEqual({ ledger: { touches: [] }, policy: { promotional_per_7d: 1 } });
  });
  test('lifecycle-generate refuses a GET with 405 after metering, and the hold is released', async () => {
    S.on(LIFE_GEN, 'generateLifecycleCalendar', async () => ({ entries: [] }));
    const r = await call('lifecycle-generate', { method: 'GET' });
    expect(r.status).toBe(405);
    expect(S.hits(LIFE_GEN)).toEqual([]);
    expect(guard.balanceMoves.map((c) => c.url.split('/rpc/')[1])).toEqual(['credit_hold', 'credit_release']);
  });
  test('lifecycle-list reads persisted entries for the market and window, free', async () => {
    S.on(LIFE_GEN, 'listEntries', async () => ({ ok: true, entries: [], persisted: true }));
    const r = await call('lifecycle-list', { method: 'GET', query: { market: 'US', from: '2026-10-01', to: '2026-10-31' } });
    noHarnessError(r);
    expect(r.out).toEqual({ ok: true, entries: [], persisted: true });
    expect(last(LIFE_GEN, 'listEntries')).toEqual([{ market: 'US', from: '2026-10-01', to: '2026-10-31' }]);
    expect(guard.balanceMoves).toEqual([]);
  });
  test('lifecycle-build-mailer builds the mailer for the posted id (the branch that used to 500 on "q is not defined")', async () => {
    S.on(LIFE_BUILD, 'buildLifecycleMailer', async () => ({ ok: true, mailer: { variants: [] } }));
    const r = await call('lifecycle-build-mailer', { json: { id: 'entry_1' } });
    noHarnessError(r);
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({ ok: true, mailer: { variants: [] }, credits: { feature: 'mailer.generate' } });
    expect(last(LIFE_BUILD, 'buildLifecycleMailer')).toEqual([{ id: 'entry_1', entry: null, force: false }]);
  });
  test('lifecycle-build-mailer honours ?force=1 from the query and force from the body', async () => {
    S.on(LIFE_BUILD, 'buildLifecycleMailer', async () => ({ ok: true }));
    await call('lifecycle-build-mailer', { json: { entry: { id: 'x' } }, query: { force: '1' } });
    expect(last(LIFE_BUILD, 'buildLifecycleMailer')).toEqual([{ id: null, entry: { id: 'x' }, force: true }]);
    await call('lifecycle-build-mailer', { json: { id: 'entry_2', force: true } });
    expect(last(LIFE_BUILD, 'buildLifecycleMailer')).toEqual([{ id: 'entry_2', entry: null, force: true }]);
  });
  // `force` is a BOOLEAN, and a query string carries STRINGS. `!!(body.force ||
  // q.force)` read `?force=false` and `?force=0` as true, which skipped the
  // retrieve-first path in buildLifecycleMailer: two LLM calls and the persisted
  // mailer overwritten, on a request whose author had said NOT to regenerate.
  // Only 1 / true / yes (any case) enable regeneration; everything else is a
  // read of what was saved.
  for (const [where, value] of [['query', 'false'], ['query', '0'], ['query', 'no'], ['query', ''], ['body', false], ['body', 'false'], ['body', 0], ['body', '0']]) {
    test(`lifecycle-build-mailer takes the RETRIEVE path for ${where} force=${JSON.stringify(value)}`, async () => {
      S.on(LIFE_BUILD, 'buildLifecycleMailer', async () => ({ ok: true }));
      const o = where === 'query' ? { json: { id: 'entry_3' }, query: { force: value } } : { json: { id: 'entry_3', force: value } };
      await call('lifecycle-build-mailer', o);
      expect(last(LIFE_BUILD, 'buildLifecycleMailer')).toEqual([{ id: 'entry_3', entry: null, force: false }]);
    });
  }
  for (const [where, value] of [['query', '1'], ['query', 'true'], ['query', 'TRUE'], ['query', 'yes'], ['body', true], ['body', 1], ['body', 'Yes']]) {
    test(`lifecycle-build-mailer REGENERATES for ${where} force=${JSON.stringify(value)}`, async () => {
      S.on(LIFE_BUILD, 'buildLifecycleMailer', async () => ({ ok: true }));
      const o = where === 'query' ? { json: { id: 'entry_3' }, query: { force: value } } : { json: { id: 'entry_3', force: value } };
      await call('lifecycle-build-mailer', o);
      expect(last(LIFE_BUILD, 'buildLifecycleMailer')).toEqual([{ id: 'entry_3', entry: null, force: true }]);
    });
  }
  test('lifecycle-build-mailer without id or entry is a 400 before the builder', async () => {
    S.on(LIFE_BUILD, 'buildLifecycleMailer', async () => ({ ok: true }));
    const r = await call('lifecycle-build-mailer', { json: {} });
    expect(r.status).toBe(400);
    expect(S.hits(LIFE_BUILD)).toEqual([]);
  });
  test('an unknown lifecycle action is the router\'s own 400', async () => {
    const r = await call('lifecycle-nope', { method: 'GET' });
    expect(r.status).toBe(400);
    expect(r.out.error).toMatch(/Unknown lifecycle action/);
  });
  test('OPTIONS on a lifecycle action is a 204 carrying the CORS headers', async () => {
    const o = await H.request(srv.port, { method: 'OPTIONS', path: '/api/calendar?action=lifecycle-list' });
    expect(o.status).toBe(204);
    expect(o.headers['access-control-allow-origin']).toBe('*');
    expect(o.headers['access-control-allow-methods']).toContain('POST');
  });
});

test.describe('lp (the /lp/:id page server)', () => {
  test('serves a persisted campaign\'s landing page as html with a public cache header', async () => {
    S.on(PLAN, 'landingPageResolve', async () => ({ html: '<!doctype html><title>lp</title>', diag: { campaignFound: true } }));
    const r = await call('lp', { method: 'GET', query: { id: 'camp_1', v: '2' }, auth: 'none', origin: false });
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toMatch(/^text\/html/);
    expect(r.headers['cache-control']).toMatch(/public/);
    expect(r.text).toBe('<!doctype html><title>lp</title>');
    expect(last(PLAN, 'landingPageResolve')).toEqual(['camp_1', {}, '2']);
  });
  test('?download=1 exports the same html as an attachment, uncached', async () => {
    S.on(PLAN, 'landingPageResolve', async () => ({ html: '<p>x</p>', diag: {} }));
    const r = await call('lp', { method: 'GET', query: { id: 'camp_1', download: '1' }, auth: 'none', origin: false });
    expect(r.headers['content-disposition']).toBe('attachment; filename="knickgasm-lp-camp_1.html"');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.text).toBe('<p>x</p>');
  });
  test('?debug=1 returns the diagnostics as JSON', async () => {
    S.on(PLAN, 'landingPageResolve', async () => ({ html: null, diag: { campaignFound: false, reason: 'no row' } }));
    const r = await call('lp', { method: 'GET', query: { id: 'camp_x', debug: '1' }, auth: 'none', origin: false });
    expect(r.out).toEqual({ ok: true, diag: { campaignFound: false, reason: 'no row' } });
  });
  test('a campaign with no page gets the fallback, built for the brand the RECORD names (the branch that used to read an undeclared `body`)', async () => {
    S.on(PLAN, 'landingPageResolve', async () => ({ html: null, diag: { campaignFound: true, workspace_id: H.WS } }));
    S.on(WS_SCOPE, 'brandForWorkspace', async () => H.BRAND_ROW);
    S.on(FALLBACK, 'buildFallbackLanding', (o) => `<html><body>${o.brand ? o.brand.name : 'NO BRAND'} ${o.region} ${o.id}</body></html>`);
    const r = await call('lp', { method: 'GET', query: { id: 'camp_1', region: 'uk', hint: 'drop' }, auth: 'none', origin: false });
    expect(r.status).toBe(200);
    expect(r.headers['x-knickgasm-lp']).toBe('campaign-no-lp-fallback');
    expect(r.text).toBe('<html><body>Harness Brand uk camp_1</body></html>');
    expect(last(WS_SCOPE, 'brandForWorkspace')[1]).toBe(H.WS);
    expect(last(FALLBACK, 'buildFallbackLanding')[0]).toMatchObject({ id: 'camp_1', region: 'uk', hint: 'drop' });
  });
  test('the fallback for a campaign that was never persisted says so in its header, and with no record to name a brand carries none', async () => {
    S.on(PLAN, 'landingPageResolve', async () => ({ html: null, diag: { campaignFound: false } }));
    S.on(WS_SCOPE, 'brandForWorkspace', async () => H.BRAND_ROW);
    S.on(FALLBACK, 'buildFallbackLanding', (o) => `<html>${o.brand ? 'brand' : 'no-brand'}</html>`);
    const r = await call('lp', { method: 'GET', query: { id: 'camp_9', download: '1' }, auth: 'none', origin: false });
    expect(r.headers['x-knickgasm-lp']).toBe('campaign-not-persisted-fallback');
    expect(r.headers['content-disposition']).toContain('camp_9');
    expect(r.text).toBe('<html>no-brand</html>');
    expect(S.hits(WS_SCOPE, 'brandForWorkspace')).toEqual([]);
  });
  test('a resolver that throws is a 500, not a dead page served as html', async () => {
    S.on(PLAN, 'landingPageResolve', async () => { throw new Error('store down'); });
    const r = await call('lp', { method: 'GET', query: { id: 'camp_1' }, auth: 'none', origin: false });
    expect(r.status).toBe(500);
    expect(r.out).toEqual({ ok: false, error: 'store down' });
  });
});

/* ── lp: WHOSE brand does the fallback page wear ────────────────────────────
 *
 * Post-merge review of PR #103 (P1): an ordinary /lp/<campaign_id> link carries
 * no workspace_id - smart-brain-plan.js and smart-brain.html mint them that way
 * - and the router never set req.__workspaceId on the lp path, so `wsId` was
 * empty, brandForWorkspace was skipped and buildFallbackLanding fell through to
 * its defaultBrand() door: TENANT ZERO's name, palette, tagline and store on
 * another tenant's campaign URL.
 *
 * Executing it found the defect is one layer deeper too. SmartBrainDbAdapter
 * scopes every read of smart_generated_campaigns to a workspace, and with none
 * in the config it resolves the OLDEST one - tenant zero - so another tenant's
 * PERSISTED campaign was never even found: the bare link fell to the fallback
 * every time, and the fallback wore tenant zero's brand.
 *
 * These tests do not stub the resolver, the adapter, the brand lookup or the
 * renderer. The fake project answers the three tables the way PostgREST would
 * - every `eq.` filter on the URL is applied to the rows - so a lookup that
 * still carries the wrong workspace filter finds nothing, exactly as the real
 * database would. Tenant zero's signature is read off its own record, never
 * typed here.
 */
const ZERO = require(H.ROOT + '/data/brands/_default.json');
const hostOf = (u) => { try { return new URL(String(u)).host.replace(/^www\./, ''); } catch (_) { return ''; } };
const ZERO_SIGNATURE = [...new Set([
  ZERO.name, ZERO.slug, ZERO.tagline, ZERO.legal_entity,
  ZERO.palette && ZERO.palette.primary, ZERO.palette && ZERO.palette.accent,
  hostOf(ZERO.website), ...(ZERO.regions || []).map((r) => hostOf(r.store_url)),
].filter((s) => s && String(s).length >= 4).map((s) => String(s).toLowerCase()))];
const signatureHits = (page) => { const low = String(page).toLowerCase(); return ZERO_SIGNATURE.filter((s) => low.includes(s)); };

/** A PostgREST table on the fake project: `eq.` filters (incl. `payload->>key`) and `limit` applied like the database does. */
function fakeTable(table, rows) {
  const base = `${H.SUPABASE_URL}/rest/v1/${table}`;
  guard.route((u) => u === base || u.startsWith(base + '?'), (u) => {
    const sp = new URL(u).searchParams;
    let out = rows.slice();
    for (const [k, v] of sp) {
      if (k === 'select' || k === 'limit' || k === 'order') continue;
      const m = /^eq\.(.*)$/.exec(v);
      if (!m) continue;
      const j = /^([a-z_]+)->>([a-z_]+)$/.exec(k);
      out = out.filter((r) => String(((j ? (r[j[1]] || {})[j[2]] : r[k]) ?? '')) === m[1]);
    }
    const lim = Number(sp.get('limit'));
    return H.reply(200, lim ? out.slice(0, lim) : out);
  });
}
const CAMPAIGN = (id, workspace_id, extra) => Object.assign({ id, workspace_id, status: 'prebuilt', payload: { campaign_id: id, assets: { landing_pages: [] } } }, extra || {});
const realBrandForWorkspace = () => { const real = require(H.ROOT + '/' + WS_SCOPE).brandForWorkspace; return (...a) => real(...a); };

test.describe('lp: the fallback page wears the brand of the RECORD, never tenant zero by default', () => {
  test('the signature this file checks against is non-trivial and comes from the record', () => {
    expect(ZERO_SIGNATURE.length).toBeGreaterThanOrEqual(5);
    expect(ZERO_SIGNATURE).toContain(String(ZERO.name).toLowerCase());
    expect(ZERO_SIGNATURE).toContain(String(ZERO.palette.primary).toLowerCase());
  });

  test('a bare /lp/<id> for ANOTHER tenant\'s persisted campaign (no workspace_id in the link) renders the fallback in THAT brand', async () => {
    fakeTable('smart_generated_campaigns', [CAMPAIGN('camp_other', H.WS)]);
    fakeTable('smart_calendar_entries', []);
    fakeTable('landing_pages_generated', []);
    S.on(WS_SCOPE, 'brandForWorkspace', realBrandForWorkspace());
    const r = await call('lp', { method: 'GET', query: { id: 'camp_other', region: 'uk' }, auth: 'none', origin: false });
    noHarnessError(r);
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toMatch(/^text\/html/);
    // The row was FOUND by its id (the header says the campaign exists and has no page yet)...
    expect(r.headers['x-knickgasm-lp']).toBe('campaign-no-lp-fallback');
    // ...its workspace was read off the row, not off the link...
    expect(last(WS_SCOPE, 'brandForWorkspace')[1]).toBe(H.WS);
    // ...and the page is that brand's, with nothing of tenant zero's on it.
    expect(r.text).toContain(H.BRAND_ROW.name);
    expect(r.text.toLowerCase()).toContain(H.BRAND_ROW.palette.primary.toLowerCase());
    expect(signatureHits(r.text), 'tenant zero on another tenant\'s page').toEqual([]);
    expect(r.text).not.toContain('[DATA REQUIRED BEFORE LAUNCH');
    expect(guard.escaped).toEqual([]);
  });

  test('another tenant\'s PERSISTED page is served from the bare link (the adapter\'s default-workspace filter used to hide it)', async () => {
    fakeTable('smart_generated_campaigns', [CAMPAIGN('camp_lp', H.WS, { payload: { campaign_id: 'camp_lp', assets: { landing_pages: [{ variant: 'A', html: '<!doctype html><title>their page</title>' }] } } })]);
    fakeTable('smart_calendar_entries', []);
    fakeTable('landing_pages_generated', []);
    const r = await call('lp', { method: 'GET', query: { id: 'camp_lp' }, auth: 'none', origin: false });
    noHarnessError(r);
    expect(r.status).toBe(200);
    expect(r.text).toBe('<!doctype html><title>their page</title>');
    expect(r.headers['x-knickgasm-lp']).toBeUndefined();
  });

  test('a campaign nobody persisted renders a NEUTRAL page with the DATA REQUIRED marker, not another tenant\'s brand', async () => {
    fakeTable('smart_generated_campaigns', []);
    fakeTable('smart_calendar_entries', []);
    fakeTable('landing_pages_generated', []);
    S.on(WS_SCOPE, 'brandForWorkspace', realBrandForWorkspace());
    const r = await call('lp', { method: 'GET', query: { id: 'camp_ghost' }, auth: 'none', origin: false });
    noHarnessError(r);
    expect(r.status).toBe(200);
    expect(r.headers['x-knickgasm-lp']).toBe('campaign-not-persisted-fallback');
    expect(r.text).toMatch(/\[DATA REQUIRED BEFORE LAUNCH: [^\]]*camp_ghost[^\]]*\]/);
    expect(signatureHits(r.text), 'tenant zero on a page for a campaign that does not exist').toEqual([]);
    expect(r.text).not.toContain(H.BRAND_ROW.name);
    expect(S.hits(WS_SCOPE, 'brandForWorkspace')).toEqual([]);
  });

  test('a ?workspace_id= on the link does not choose the brand: the record does, and without a record nobody does', async () => {
    fakeTable('smart_generated_campaigns', [CAMPAIGN('camp_other', H.WS)]);
    fakeTable('smart_calendar_entries', []);
    fakeTable('landing_pages_generated', []);
    S.on(WS_SCOPE, 'brandForWorkspace', realBrandForWorkspace());
    const r = await call('lp', { method: 'GET', query: { id: 'camp_other', workspace_id: 'ws_someone_else' }, auth: 'none', origin: false });
    expect(r.text).toContain(H.BRAND_ROW.name);
    expect(S.hits(WS_SCOPE, 'brandForWorkspace').map((h) => h.args[1])).toEqual([H.WS]);
    const g = await call('lp', { method: 'GET', query: { id: 'camp_ghost', workspace_id: H.WS }, auth: 'none', origin: false });
    expect(g.text).toContain('[DATA REQUIRED BEFORE LAUNCH');
    expect(g.text).not.toContain(H.BRAND_ROW.name);
    expect(S.hits(WS_SCOPE, 'brandForWorkspace').length).toBe(1);
  });

  test('a campaign that IS tenant zero\'s falls back to the shipped default brand', async () => {
    // WS_OLDEST is the oldest workspace: tenant zero by the repo's standing
    // definition (workspace-scope.defaultWorkspaceId, market-analytics
    // .ownsBundledExport). The fake project has no readable brand row for it,
    // so this is the one case in which the shipped record is the right answer.
    fakeTable('smart_generated_campaigns', [CAMPAIGN('camp_zero', H.WS_OLDEST)]);
    fakeTable('smart_calendar_entries', []);
    fakeTable('landing_pages_generated', []);
    S.on(WS_SCOPE, 'brandForWorkspace', realBrandForWorkspace());
    const r = await call('lp', { method: 'GET', query: { id: 'camp_zero' }, auth: 'none', origin: false });
    noHarnessError(r);
    expect(r.headers['x-knickgasm-lp']).toBe('campaign-no-lp-fallback');
    expect(last(WS_SCOPE, 'brandForWorkspace')[1]).toBe(H.WS_OLDEST);
    expect(r.text).toContain(ZERO.name);
    expect(r.text).not.toContain('[DATA REQUIRED BEFORE LAUNCH: brand');
  });

  test('a record whose brand cannot be read, and which is NOT tenant zero\'s, gets the neutral page rather than the default brand', async () => {
    fakeTable('smart_generated_campaigns', [CAMPAIGN('camp_unread', 'ws_harness_unreadable')]);
    fakeTable('smart_calendar_entries', []);
    fakeTable('landing_pages_generated', []);
    S.on(WS_SCOPE, 'brandForWorkspace', realBrandForWorkspace());
    const r = await call('lp', { method: 'GET', query: { id: 'camp_unread' }, auth: 'none', origin: false });
    noHarnessError(r);
    expect(last(WS_SCOPE, 'brandForWorkspace')[1]).toBe('ws_harness_unreadable');
    expect(r.text).toContain('[DATA REQUIRED BEFORE LAUNCH');
    expect(signatureHits(r.text)).toEqual([]);
    expect(r.text).not.toContain(H.BRAND_ROW.name);
  });

  test('a calendar slot that ADVERTISES the id names the brand when the campaign row is not there yet', async () => {
    fakeTable('smart_generated_campaigns', []);
    fakeTable('smart_calendar_entries', [{ id: 'slot_1', workspace_id: H.WS, generated_campaign_id: 'camp_slot', status: 'approved', payload: {} }]);
    fakeTable('landing_pages_generated', []);
    S.on(WS_SCOPE, 'brandForWorkspace', realBrandForWorkspace());
    const r = await call('lp', { method: 'GET', query: { id: 'camp_slot' }, auth: 'none', origin: false });
    noHarnessError(r);
    expect(r.headers['x-knickgasm-lp']).toBe('campaign-not-persisted-fallback');
    expect(last(WS_SCOPE, 'brandForWorkspace')[1]).toBe(H.WS);
    expect(r.text).toContain(H.BRAND_ROW.name);
    expect(signatureHits(r.text)).toEqual([]);
  });

  test('the neutral page is a real page: html, cacheable, downloadable, and it names the campaign', async () => {
    fakeTable('smart_generated_campaigns', []);
    fakeTable('smart_calendar_entries', []);
    fakeTable('landing_pages_generated', []);
    const r = await call('lp', { method: 'GET', query: { id: 'camp_ghost', download: '1' }, auth: 'none', origin: false });
    expect(String(r.headers['content-type'])).toMatch(/^text\/html/);
    expect(r.headers['content-disposition']).toContain('camp_ghost');
    expect(r.text).toMatch(/^<!doctype html>/i);
    expect(r.text).toContain('camp_ghost');
  });
});

test('an unknown top-level action is the router\'s own 400 with the CORS header', async () => {
  const r = await call('no-such-action', { method: 'GET' });
  expect(r.status).toBe(400);
  expect(r.out.error).toMatch(/Use \?action=generate/);
  expect(r.headers['access-control-allow-origin']).toBe('*');
});

/* ── smart-brain-* ──────────────────────────────────────────────────────── */

const cfgOf = (args) => args[0].config;
const SB = [];
const sb = (name, def) => SB.push(Object.assign({ name }, def));

sb('health', { run: { method: 'GET' },
  expect: (r) => { expect(r.out).toMatchObject({ ok: true, service: 'knickgasm-smart-brain', db_linked: true, live_platform_push: false }); expect(F.adapters.length).toBe(1); expect(F.adapters[0].config.workspace_id).toBe(H.WS); } });
sb('schema', { run: { method: 'GET' },
  expect: (r) => { expect(r.out.ok).toBe(true); expect(r.out.tables).toBeTruthy(); expect(F.schema.length).toBe(1); expect(F.schema[0].workspace_id).toBe(H.WS); } });
sb('plan', { run: { method: 'GET' }, stubs: () => S.on(PLAN, 'getPlan', async () => ({ ok: true, entries: [{ id: 'e' }] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, entries: [{ id: 'e' }] }); expect(cfgOf(last(PLAN, 'getPlan'))).toEqual({ workspace_id: H.WS }); } });
sb('dbcheck', { run: { method: 'GET' }, stubs: () => S.on(PLAN, 'dbCheck', async () => ({ ok: true, project: 'harness' })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, project: 'harness' }); expect(cfgOf(last(PLAN, 'dbCheck'))).toEqual({ workspace_id: H.WS }); } });
sb('sync-status', { run: { json: { limit: 5 } }, stubs: () => S.on(PLAN, 'syncStatus', async () => ({ ok: true, campaigns: [] })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, campaigns: [] }); expect(last(PLAN, 'syncStatus')[0]).toEqual({ config: { workspace_id: H.WS }, limit: 5 }); } });
sb('export', { run: { json: { entries: [{ date: '2026-10-01', id: 'a' }] } }, stubs: () => { S.on(EXPORT, 'buildExportCsv', () => 'date,id\n2026-10-01,a\n'); S.on(PLAN, 'getPlan', async () => ({ entries: [] })); },
  expect: (r) => {
    expect(r.status).toBe(200); expect(String(r.headers['content-type'])).toMatch(/^text\/csv/);
    // Named for, and written for, the brand THIS request resolved to (the
    // signed-in workspace), never tenant zero: entries posted from the browser
    // carry no brand, and the prompts fell back to tenant zero's record.
    expect(r.headers['content-disposition']).toBe('attachment; filename="harness-brand-automated-calendar-2026-10-01.csv"');
    expect(r.text).toBe('date,id\n2026-10-01,a\n');
    const posted = last(EXPORT, 'buildExportCsv')[0];
    expect(posted.map((e) => ({ date: e.date, id: e.id }))).toEqual([{ date: '2026-10-01', id: 'a' }]);
    expect(posted[0].brand && posted[0].brand.slug).toBe(H.BRAND_ROW.slug);
    expect(S.hits(PLAN, 'getPlan')).toEqual([]);            // the reviewer's own entries were used, not a re-pull
  },
  cases: [{ name: 'with no entries posted it exports the stored plan', run: { method: 'GET' }, expect: (r) => { expect(r.status).toBe(200); expect(last(PLAN, 'getPlan')[0]).toEqual({ config: { workspace_id: H.WS } }); expect(r.headers['content-disposition']).toContain('calendar-plan.csv'); } }],
});
sb('sync-daily', { run: { json: { days: 30 } }, stubs: () => S.on(PLAN, 'syncDaily', async () => ({ ok: true, mode: 'db-linked', changes: [1] })),
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, mode: 'db-linked', changes: [1], prebuild_kicked: true });
    expect(last(PLAN, 'syncDaily')[0]).toEqual({ config: { workspace_id: H.WS }, days: 30, persist: true });
    // The prebuild chain is kicked at the deployment's own URL with the scheduler secret.
    const k = prebuildKicks(); expect(k.length).toBe(1); expect(k[0].method).toBe('POST'); expect(k[0].headers.authorization).toBe(`Bearer ${H.CRON}`); expect(JSON.parse(k[0].body)).toEqual({ _depth: 1 });
  },
  cases: [
    { name: 'prebuild:false opts out of the kick', run: { json: { prebuild: false } }, expect: (r) => { expect(r.out.prebuild_kicked).toBeUndefined(); expect(prebuildKicks()).toEqual([]); } },
    { name: 'GET is a 405', run: { method: 'GET' }, expect: (r) => { expect(r.status).toBe(405); expect(S.hits(PLAN)).toEqual([]); } },
  ],
});
sb('prebuild', { run: { json: { batchSize: 2 }, auth: 'cron', origin: false }, stubs: () => S.on(PLAN, 'prebuildAssets', async () => ({ remaining: 3, built: ['s1', 's2'], failed: [] })),
  expect: (r) => {
    expect(r.out).toMatchObject({ ok: true, prebuild: true, depth: 0, chained: true, remaining: 3, built: ['s1', 's2'] });
    expect(last(PLAN, 'prebuildAssets')[0]).toEqual({ config: { workspace_id: H.WS_OLDEST }, batchSize: 2 });
    expect(JSON.parse(prebuildKicks()[0].body)).toEqual({ _depth: 1 });
  },
  cases: [
    { name: 'the anonymous console cannot start the chain', run: { json: {}, auth: 'none', origin: false }, expect: (r) => { expect(r.status).toBe(401); expect(r.out.error).toBe('Unauthorized prebuild call'); expect(S.hits(PLAN)).toEqual([]); } },
    { name: 'a session is not the scheduler either', run: { json: {}, auth: 'session', origin: true }, expect: (r) => { expect(r.status).toBe(401); expect(S.hits(PLAN)).toEqual([]); } },
    { name: 'a batch that built nothing stops the chain instead of hot-looping', run: { json: { _depth: 4 }, auth: 'cron', origin: false }, stubs: () => S.on(PLAN, 'prebuildAssets', async () => ({ remaining: 3, built: [], failed: ['s1'] })), expect: (r) => { expect(r.out).toMatchObject({ depth: 4, chained: false }); expect(prebuildKicks()).toEqual([]); } },
    { name: 'a finished window does not re-fire', run: { json: {}, auth: 'cron', origin: false }, stubs: () => S.on(PLAN, 'prebuildAssets', async () => ({ remaining: 0, built: ['s1'] })), expect: (r) => { expect(r.out.chained).toBe(false); expect(prebuildKicks()).toEqual([]); } },
    { name: 'the depth backstop (400) stops a runaway chain', run: { json: { _depth: 400 }, auth: 'cron', origin: false }, expect: (r) => { expect(r.out).toMatchObject({ depth: 400, chained: false }); expect(prebuildKicks()).toEqual([]); } },
    { name: 'batchSize is clamped to 1..3', run: { json: { batchSize: 99 }, auth: 'cron', origin: false }, expect: () => { expect(last(PLAN, 'prebuildAssets')[0].batchSize).toBe(3); } },
  ],
});
sb('heal', { run: { json: { batchSize: 5 } }, stubs: () => S.on(PLAN, 'healOrphans', async () => ({ republished: 1, remaining: 0 })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, heal: true, republished: 1, remaining: 0 }); expect(last(PLAN, 'healOrphans')[0]).toEqual({ config: { workspace_id: H.WS }, batchSize: 5 }); },
  cases: [{ name: 'batchSize defaults to 20 and is clamped to 40', run: { json: { batchSize: 500 } }, expect: () => { expect(last(PLAN, 'healOrphans')[0].batchSize).toBe(40); } }],
});
sb('cron', { run: { method: 'GET', auth: 'cron', origin: false }, stubs: () => S.on(PLAN, 'syncDaily', async () => ({ ok: true, synced_at: 't', mode: 'db-linked', changes: [1, 2], persistence: { ok: true } })),
  expect: (r) => {
    expect(r.out).toEqual({ ok: true, cron: true, synced_at: 't', mode: 'db-linked', changes: 2, persistence: { ok: true }, prebuild_kicked: true });
    expect(last(PLAN, 'syncDaily')[0]).toEqual({ persist: true });
    expect(prebuildKicks().length).toBe(1);
  },
  cases: [
    { name: 'without the secret it is refused before the sync', run: { method: 'GET', auth: 'none', origin: false }, expect: (r) => { expect(r.status).toBe(401); expect(r.out.error).toBe('Unauthorized cron call'); expect(S.hits(PLAN)).toEqual([]); } },
    { name: 'a forged bearer is not the secret', run: { method: 'GET', auth: 'forged', origin: false }, expect: (r) => { expect(r.status).toBe(401); expect(S.hits(PLAN)).toEqual([]); } },
    { name: '?secret= is accepted as the scheduler too', run: { method: 'GET', auth: 'none', origin: false, query: { secret: H.CRON } }, expect: (r) => { expect(r.out.cron).toBe(true); } },
  ],
});
sb('preview', { run: { json: { id: 'entry_1', reviewer: 'op' } }, stubs: () => S.on(PLAN, 'previewEntry', async () => ({ ok: true, campaign: {} })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, campaign: {} }); expect(last(PLAN, 'previewEntry')[0]).toEqual({ id: 'entry_1', entry: null, reviewer: 'op', config: { workspace_id: H.WS } }); },
  cases: [{ name: 'neither id nor entry is a 400', run: { json: {} }, expect: (r) => { expect(r.status).toBe(400); expect(S.hits(PLAN)).toEqual([]); } }],
});
sb('approve', { run: { json: { entry: { id: 'x' }, reviewer: 'op' } }, stubs: () => S.on(PLAN, 'approveEntry', async () => ({ ok: true, approved: true })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, approved: true }); expect(last(PLAN, 'approveEntry')[0]).toEqual({ id: undefined, entry: { id: 'x' }, reviewer: 'op', config: { workspace_id: H.WS } }); },
  cases: [{ name: 'GET is a 405', run: { method: 'GET' }, expect: (r) => { expect(r.status).toBe(405); } }],
});
sb('reject', { run: { json: { id: 'entry_1', notes: 'off-brand' } }, stubs: () => S.on(PLAN, 'rejectEntry', async () => ({ ok: true })),
  expect: (r) => { expect(last(PLAN, 'rejectEntry')[0]).toEqual({ id: 'entry_1', reviewer: null, notes: 'off-brand', config: { workspace_id: H.WS } }); },
  cases: [{ name: 'no id is a 400', run: { json: {} }, expect: (r) => { expect(r.status).toBe(400); expect(S.hits(PLAN)).toEqual([]); } }],
});
sb('unreject', { run: { json: { id: 'entry_1', reviewer: 'op' } }, stubs: () => S.on(PLAN, 'unrejectEntry', async () => ({ ok: true })),
  expect: (r) => { expect(last(PLAN, 'unrejectEntry')[0]).toEqual({ id: 'entry_1', reviewer: 'op', config: { workspace_id: H.WS } }); } });
sb('activate-scenario', { run: { json: { scenario: 'best', scope: 'US' } }, stubs: () => S.on(PLAN, 'activateScenario', async () => ({ ok: true, active: 'best' })),
  expect: (r) => { expect(r.out).toEqual({ ok: true, active: 'best' }); expect(last(PLAN, 'activateScenario')[0]).toEqual({ scenario: 'best', reviewer: null, scope: 'US', config: { workspace_id: H.WS } }); },
  cases: [{ name: 'no scenario is a 400', run: { json: {} }, expect: (r) => { expect(r.status).toBe(400); expect(S.hits(PLAN)).toEqual([]); } }],
});
for (const alias of ['run-daily', 'daily']) {
  sb(alias, { run: { json: { start_date: '2026-10-01', days: 5, persist: true } },
    expect: (r) => { expect(r.out).toMatchObject({ ok: true, mode: 'stubbed' }); expect(F.runDaily).toEqual([{ config: { workspace_id: H.WS }, startDate: '2026-10-01', days: 5, persist: true }]); } });
}
sb('generate-slot', { run: { json: { entry: { id: 'slot_1', theme: 't' } } },
  expect: (r) => { expect(r.out).toEqual({ ok: true, campaign: { id: 'camp_harness', entry: { id: 'slot_1', theme: 't' } } }); expect(F.generated.length).toBe(1); expect(F.generated[0][0].workspace_id).toBe(H.WS); },
  cases: [{ name: 'no entry is a 400', run: { json: {} }, expect: (r) => { expect(r.status).toBe(400); expect(F.generated).toEqual([]); } }],
});
sb('feedback', { run: { json: { target_id: 'entry_1', verdict: 'approve', notes: 'n', reviewer: 'op' } },
  expect: (r) => {
    expect(r.out).toMatchObject({ ok: true, feedback: { target_type: 'calendar_entry', target_id: 'entry_1', verdict: 'approve', notes: 'n', reviewer: 'op' }, persistence: { ok: true }, applied_to_future_generation: true });
    expect(F.adapters.length).toBe(1); expect(F.adapters[0].workspaceId).toBe(H.WS);
    expect(F.adapters[0].inserted[0]).toBe(F.adapters[0].config.tableNames.feedback); expect(F.adapters[0].inserted[1][0].target_id).toBe('entry_1');
  } });
for (const alias of ['weekly-recalibration', 'recalibrate']) {
  sb(alias, { run: { json: { reviewer: 'op', decisions: ['d1'] } },
    expect: (r) => {
      expect(r.out.weekly_recalibration).toMatchObject({ human_reviewer: 'op', decisions: ['d1'], next_required_by_days: 7 });
      expect(F.runDaily).toEqual([{ config: { workspace_id: H.WS }, startDate: undefined, days: 15, persist: false }]);
    } });
}

for (const e of SB) {
  const action = `smart-brain-${e.name}`;
  test.describe(`?action=${action}`, () => {
    test('dispatches with the workspace threaded through config', async () => {
      if (e.stubs) e.stubs();
      const r = await call(action, e.run);
      noHarnessError(r);
      e.expect(r);
      expect(guard.escaped).toEqual([]);
    });
    for (const c of e.cases || []) {
      test(c.name, async () => {
        if (c.stubs) c.stubs(); else if (e.stubs) e.stubs();
        const run = Object.assign({}, e.run, c.run || {});
        if (c.run && c.run.json !== undefined && !c.run.method) run.method = 'POST';
        if (c.run && c.run.method === 'GET') run.json = undefined;
        const r = await call(action, run);
        noHarnessError(r);
        c.expect(r);
        expect(guard.escaped).toEqual([]);
      });
    }
    if (!/^(cron|prebuild)$/.test(e.name)) {
      test('an unattributed browser request gets the unscoped envelope and reaches nothing', async () => {
        if (e.stubs) e.stubs();
        const r = await call(action, Object.assign({}, e.run, { auth: 'none', origin: true, query: Object.assign({}, e.run.query || {}, { workspace_id: undefined }) }));
        expect(r.status).toBe(200);
        expect(r.out).toMatchObject({ ok: true, mode: 'unscoped', stored: false, entries: [], plan: [], changes: [], insights: [], error: 'workspace_unresolved' });
        expect(S.reached).toEqual([]);
        expect(F.runDaily).toEqual([]); expect(F.generated).toEqual([]); expect(F.adapters).toEqual([]); expect(F.schema).toEqual([]);
        expect(guard.restBeyondScoping()).toEqual([]);
      });
    }
  });
}

test('an unknown smart-brain action is the router\'s own 400', async () => {
  const r = await call('smart-brain-nope', { method: 'GET' });
  expect(r.status).toBe(400);
  expect(r.out.error).toMatch(/Unknown Smart Brain action/);
});
test('OPTIONS on a smart-brain action is a 204 with the CORS headers', async () => {
  const o = await H.request(srv.port, { method: 'OPTIONS', path: '/api/calendar?action=smart-brain-plan' });
  expect(o.status).toBe(204);
  expect(o.headers['access-control-allow-origin']).toBe('*');
  expect(o.headers['cache-control']).toBe('no-store');
});
test('a core that throws inside smart-brain is a 500 with the message', async () => {
  S.on(PLAN, 'getPlan', async () => { throw new Error('plan store down'); });
  const r = await call('smart-brain-plan', { method: 'GET' });
  expect(r.status).toBe(500);
  expect(r.out).toEqual({ ok: false, error: 'plan store down' });
});

/* ── the workspace-scoping contract (same as api/brain.js) ──────────────── */

test.describe('workspace scoping', () => {
  test('a session resolves the caller\'s ACTIVE workspace into config; an explicit workspace_id wins over it', async () => {
    S.on(PLAN, 'getPlan', async () => ({ ok: true }));
    await call('smart-brain-plan', { method: 'GET' });
    expect(cfgOf(last(PLAN, 'getPlan'))).toEqual({ workspace_id: H.WS });
    await call('smart-brain-plan', { method: 'GET', query: { workspace_id: 'ws_explicit' } });
    expect(cfgOf(last(PLAN, 'getPlan'))).toEqual({ workspace_id: 'ws_explicit' });
    await call('smart-brain-plan', { json: { workspace_id: 'ws_in_body' } });
    expect(cfgOf(last(PLAN, 'getPlan'))).toEqual({ workspace_id: 'ws_in_body' });
  });
  test('a signed-in user with NO active workspace gets null, never the oldest workspace', async () => {
    guard.restore(); guard = H.netGuard({ activeWorkspace: null });
    S.on(PLAN, 'getPlan', async () => ({ ok: true }));
    await call('smart-brain-plan', { method: 'GET' });
    expect(cfgOf(last(PLAN, 'getPlan'))).toEqual({ workspace_id: null });
    expect(guard.rest(/order=created_at\.asc/)).toEqual([]);
  });
  test('a userless server-to-server call falls to the default workspace (the documented cron behaviour)', async () => {
    S.on(PLAN, 'getPlan', async () => ({ ok: true }));
    await call('smart-brain-plan', { method: 'GET', auth: 'none', origin: false });
    expect(cfgOf(last(PLAN, 'getPlan'))).toEqual({ workspace_id: H.WS_OLDEST });
  });
  test('scoping never hard-fails the router: a dead backend still answers with an empty config', async () => {
    guard.restore(); guard = H.netGuard({ supabase: false });
    S.on(PLAN, 'getPlan', async () => ({ ok: true }));
    const r = await call('smart-brain-plan', { method: 'GET' });
    expect(r.status).toBe(200);
    expect(cfgOf(last(PLAN, 'getPlan'))).toEqual({ workspace_id: null });
  });
});

/* ── the enumeration ────────────────────────────────────────────────────── */

test('every action the router dispatches has a test here, and the enumeration is not trivial', () => {
  const code = H.routerCode(CAL);
  const top = [...code.matchAll(/\baction === '([a-z-]+)'/g)].map((m) => m[1]);
  const smart = [...code.matchAll(/\bsmartAction === '([a-z-]+)'/g)].map((m) => `smart-brain-${m[1]}`);
  const enumerated = H.uniqSorted([...top, ...smart]);
  expect(enumerated.length).toBeGreaterThanOrEqual(25);
  const tested = H.uniqSorted([
    'generate', 'trigger-mailer', 'triggermailer', 'connectors-check', 'lp',
    'lifecycle-generate', 'lifecycle-list', 'lifecycle-build-mailer',
    ...SB.map((e) => `smart-brain-${e.name}`),
  ]);
  expect(enumerated.filter((a) => !tested.includes(a)), 'actions the router dispatches with no test').toEqual([]);
  expect(tested.filter((a) => !enumerated.includes(a)), 'tests for actions the router no longer has').toEqual([]);
});
