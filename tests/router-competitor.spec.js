// api/competitor.js, EXECUTED: the shipped router (request-scope wrapper
// included) on a real http.Server, one test per ?action= it dispatches.
//
// Until 2026-09-28 no test loaded this file (coverage/UNTESTED.md: 0 of 560
// lines). Executing it found that it had no OPTIONS branch: a cross-origin
// preflight — which the browser sends for any request carrying Authorization
// or x-ingest-token — was routed like the action itself, so a preflight for
// ?action=poll RAN the IMAP poll and one for ?action=sync reached the cron
// gate. Every other router answers a preflight with 204; this one does now,
// and the test below asserts nothing was reached.
//
// This router reads the request STREAM itself for the collector POSTs
// (readBody falls back to req.on('data') when req.body is empty), so those
// are driven in `x-mode: bare` (a plain Node stream, as under vercel dev) as
// well as behind the Vercel body helper. Every core it dispatches to exports
// an object, so each is a recording stub on its cache entry; the two stores
// the universe is read through (as the caller, or as the service) are stubbed
// to record WHICH store the router chose, because that choice is the whole
// point of universeContext(): a session reads under RLS as itself, the
// scheduler reads with the service key and must NAME its workspace.
//
// Run: npx playwright test tests/router-competitor.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const H = require('./router-harness');

const COMP = 'api/competitor.js';
const CORE = 'api/_shared/competitor-core.js';
const UNI = 'api/_shared/competitor-universe.js';
const SUPA = 'api/_shared/supa.js';
const CI_COLLECT = 'api/_shared/ci-collect.js';
const CI_OFFERS = 'api/_shared/ci-offers.js';
const CI_FUNNEL = 'api/_shared/ci-funnel.js';
const CI_ENRICH = 'api/_shared/ci-enrich.js';
const CI_BRIDGE = 'api/_shared/ci-email-bridge.js';
const CI_SUBS = 'api/_shared/ci-subscriptions-core.js';
const BENCH = 'api/_shared/competitive-benchmark-core.js';
const WS_SCOPE = 'api/_shared/workspace-scope.js';

let restoreEnv, srv, S, guard;
test.beforeAll(async () => { restoreEnv = H.routerEnv(); srv = await H.serve(COMP); });
test.afterAll(async () => { await srv.close(); restoreEnv(); });
test.beforeEach(() => {
  require(H.ROOT + '/' + WS_SCOPE).invalidate();
  guard = H.netGuard();
  S = new H.Stubs();
  // The two stores, recording which one the router picked and for what.
  S.on(UNI, 'userStore', (token) => ({ kind: 'user', token, list: async (ws) => [{ id: 'row_user', workspace_id: ws }] }));
  S.on(UNI, 'serviceStore', () => ({ kind: 'service', list: async (ws) => [{ id: 'row_service', workspace_id: ws }] }));
});
test.afterEach(() => { S.restore(); guard.restore(); });

const noHarnessError = (r) => expect((r.out && r.out.harness_error) || undefined, `harness error: ${r.text}`).toBeUndefined();
function call(action, o) {
  const r = o || {};
  const query = Object.assign({ action }, r.query || {});
  return H.request(srv.port, {
    method: r.method || (r.json !== undefined || r.raw != null ? 'POST' : 'GET'), path: '/api/competitor' + H.qs(query),
    json: r.json, raw: r.raw, contentType: r.contentType, headers: r.headers,
    auth: r.auth || 'session', origin: r.origin !== undefined ? r.origin : true,
  });
}
const last = (mod, fn) => { const h = S.hit(mod, fn); expect(h, `${mod} ${fn} was not reached`).toBeTruthy(); return h.args; };
/** Hits that belong to the action, not to the store construction the router does first. */
const actionHits = () => S.reached.filter((r) => !(r.module === UNI && /Store$/.test(r.fn)));
const withEnv = (env, fn) => async () => { const undo = H.pinEnv(env); try { await fn(); } finally { undo(); } };

/* ── the mail archive (Google Sheet) ────────────────────────────────────── */

test.describe('the captured-mail archive', () => {
  test('list: with no capture inbox configured it says so and never opens the sheet', async () => {
    S.on(CORE, 'getAllEmails', async () => [{ id: 2 }]);
    const r = await call('list', { method: 'GET' });
    noHarnessError(r);
    expect(r.out).toMatchObject({ ok: true, emails: [], capture_configured: false });
    expect(S.hits(CORE, 'getAllEmails')).toEqual([]);
  });
  test('list: with an inbox configured the archive is served as a DEPLOYMENT-level corpus, never as this brand\'s own mail', async () => {
    S.on(CORE, 'sheetsConfigured', () => true);
    S.on(CORE, 'getAllEmails', async () => [{ id: 2, subject: 'x' }]);
    const r = await call('list', { method: 'GET' });
    expect(r.out).toMatchObject({ ok: true, emails: [{ id: 2, subject: 'x' }], capture_configured: true, data_scope: { level: 'deployment' } });
    expect(S.hits(CORE, 'getAllEmails').length).toBe(1);
  });
  test('the default action is list', async () => {
    const r = await H.request(srv.port, { path: '/api/competitor', auth: 'session', origin: true });
    expect(r.out).toMatchObject({ ok: true, capture_configured: false });
  });
  test('html: a row id below 2 (the header) is a 400; a real id reads that mail', async () => {
    S.on(CORE, 'getEmailHtml', async () => '<p>mail</p>');
    const bad = await call('html', { method: 'GET', query: { id: '1' } });
    expect(bad.status).toBe(400); expect(S.hits(CORE)).toEqual([]);
    const r = await call('html', { method: 'GET', query: { id: '7' } });
    expect(r.out).toEqual({ ok: true, html: '<p>mail</p>' }); expect(last(CORE, 'getEmailHtml')).toEqual([7]);
  });
  test('raw: serves one mail as a standalone html page, or a 404 page', async () => {
    S.on(CORE, 'getRawHtml', async (o) => (o.id === '3' ? '<!doctype html><p>raw</p>' : null));
    const r = await call('raw', { method: 'GET', query: { key: 'k', id: '3' } });
    expect(r.status).toBe(200); expect(String(r.headers['content-type'])).toMatch(/^text\/html/); expect(r.text).toBe('<!doctype html><p>raw</p>');
    expect(last(CORE, 'getRawHtml')).toEqual([{ key: 'k', id: '3' }]);
    const nf = await call('raw', { method: 'GET', query: { id: '9' } });
    expect(nf.status).toBe(404); expect(nf.text).toContain('Email not found');
  });
  test('poll: runs one sync, then throttles the next call for 30s without touching IMAP again', async () => {
    S.on(CORE, 'runSync', async () => ({ ok: true, fetched: 2 }));
    const first = await call('poll', { method: 'GET' });
    noHarnessError(first);
    expect(first.out).toMatchObject({ ok: true, throttled: false, fetched: 2 });
    expect(last(CORE, 'runSync')).toEqual([25]);
    const second = await call('poll', { method: 'GET' });
    expect(second.out).toMatchObject({ ok: true, throttled: true, last: { ok: true, fetched: 2 } });
    expect(second.out.nextSyncInMs).toBeGreaterThan(0);
    expect(S.hits(CORE, 'runSync').length).toBe(1);
  });
  test('sync: the scheduler forces a sync; anyone else is refused before IMAP', async () => {
    S.on(CORE, 'runSync', async () => ({ ok: true, fetched: 0 }));
    for (const auth of ['none', 'forged', 'session']) {
      const r = await call('sync', { method: 'GET', auth, origin: false, query: { workspace_id: H.WS } });
      expect(r.status, auth).toBe(401); expect(S.hits(CORE), auth).toEqual([]);
    }
    const ok = await call('sync', { method: 'GET', auth: 'cron', origin: false });
    expect(ok.out).toEqual({ ok: true, fetched: 0 }); expect(last(CORE, 'runSync')).toEqual([25]);
    const viaQuery = await call('sync', { method: 'GET', auth: 'none', origin: false, query: { secret: H.CRON } });
    expect(viaQuery.status).toBe(200);
  });
  test('sort: re-sorts the sheet', async () => {
    S.on(CORE, 'sortEmailsByReceivedDesc', async () => undefined);
    const r = await call('sort', { method: 'GET' });
    expect(r.out).toEqual({ ok: true, sorted: 'received_at desc' }); expect(S.hits(CORE, 'sortEmailsByReceivedDesc').length).toBe(1);
  });
  test('adlibrary / ads: the free ad-library lookup', async () => {
    S.on(CORE, 'fetchMetaAds', async () => ({ ok: true, ads: [] }));
    const r = await call('adlibrary', { method: 'GET', query: { brand: 'Acme', country: 'GB', limit: '5' } });
    expect(r.out).toEqual({ ok: true, ads: [] }); expect(last(CORE, 'fetchMetaAds')).toEqual([{ brand: 'Acme', country: 'GB', limit: '5' }]);
    const alias = await call('ads', { method: 'GET', query: { brand: 'Acme' } });
    expect(alias.status).toBe(200); expect(last(CORE, 'fetchMetaAds')).toEqual([{ brand: 'Acme', country: 'ALL', limit: null }]);
    S.on(CORE, 'fetchMetaAds', async () => ({ ok: false, error: 'no provider' }));
    expect((await call('ads', { method: 'GET' })).status).toBe(400);
  });
  test('ingest: the capture webhook is POST-only and honours INGEST_TOKEN', withEnv({ INGEST_TOKEN: 'ingest-harness' }, async () => {
    S.on(CORE, 'ingestEmail', async (b) => ({ ok: true, stored: b.subject }));
    expect((await call('ingest', { method: 'GET', auth: 'none', origin: false })).status).toBe(405);
    const wrong = await call('ingest', { json: { subject: 's' }, auth: 'none', origin: false, headers: { 'x-ingest-token': 'nope' } });
    expect(wrong.status).toBe(401); expect(S.hits(CORE)).toEqual([]);
    const ok = await call('ingest', { json: { from: 'a@b.test', subject: 's', html: '<p/>' }, auth: 'none', origin: false, headers: { 'x-ingest-token': 'ingest-harness' } });
    expect(ok.out).toEqual({ ok: true, stored: 's' }); expect(last(CORE, 'ingestEmail')).toEqual([{ from: 'a@b.test', subject: 's', html: '<p/>' }]);
    const viaQuery = await call('ingest', { json: { subject: 'q' }, auth: 'none', origin: false, query: { token: 'ingest-harness' } });
    expect(viaQuery.status).toBe(200);
  }));
  test('ingest: a refused mail is a 400 carrying the core\'s reason', async () => {
    S.on(CORE, 'ingestEmail', async () => ({ ok: false, error: 'no sender' }));
    const r = await call('ingest', { json: {}, auth: 'none', origin: false });
    expect(r.status).toBe(400); expect(r.out.error).toBe('no sender');
  });
});

/* ── the per-brand universe ─────────────────────────────────────────────── */

test.describe('the competitor universe', () => {
  test('brands: a session reads AS THE CALLER (the user store) for its active workspace', async () => {
    S.on(UNI, 'listUniverse', async () => ({ brands: [{ name: 'Rival' }], total: 1, gaps: [] }));
    const r = await call('brands', { method: 'GET' });
    noHarnessError(r);
    expect(r.out).toEqual({ ok: true, brands: [{ name: 'Rival' }], total: 1, gaps: [] });
    const a = last(UNI, 'listUniverse');
    expect(a[0].kind).toBe('user'); expect(a[0].token).toBe(H.SESSION); expect(a[1]).toBe(H.WS);
    expect(S.hits(UNI, 'serviceStore')).toEqual([]);
  });
  test('brands: the scheduler reads with the SERVICE store and must name its workspace', async () => {
    S.on(UNI, 'listUniverse', async () => ({ brands: [], total: 0, gaps: [] }));
    const named = await call('brands', { method: 'GET', auth: 'cron', origin: false, query: { workspace_id: 'ws_named' } });
    expect(named.out).toEqual({ ok: true, brands: [], total: 0, gaps: [] });
    expect(last(UNI, 'listUniverse')[0].kind).toBe('service'); expect(last(UNI, 'listUniverse')[1]).toBe('ws_named');
    expect(S.hits(UNI, 'userStore')).toEqual([]);
  });
  test('brands: an anonymous caller with a workspace is told to sign in, and nothing is read', async () => {
    S.on(UNI, 'listUniverse', async () => ({ brands: [{ name: 'leak' }], total: 1 }));
    const r = await call('brands', { method: 'GET', auth: 'none', origin: false, query: { workspace_id: H.WS } });
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({ ok: true, brands: [], total: 0, error: 'sign_in_required' });
    expect(S.hits(UNI, 'listUniverse')).toEqual([]);
  });
  test('brands: a forged bearer is used as the caller\'s own token, so RLS - not this router - decides what it sees', async () => {
    // The router never verifies the bearer itself: it hands it to PostgREST as
    // the caller's JWT. A forged token therefore reaches the user store, where
    // the database rejects it. What the router guarantees is that it is never
    // upgraded to the service key.
    S.on(UNI, 'listUniverse', async () => ({ brands: [], total: 0, gaps: [] }));
    const r = await call('brands', { method: 'GET', auth: 'forged', origin: true, query: { workspace_id: H.WS } });
    expect(r.status).toBe(200);
    expect(last(UNI, 'listUniverse')[0]).toMatchObject({ kind: 'user', token: H.FORGED });
    expect(S.hits(UNI, 'serviceStore')).toEqual([]);
  });
  test('brands: a session with no active workspace reads nothing, and says which brand it would not substitute', async () => {
    guard.restore(); guard = H.netGuard({ activeWorkspace: null });
    S.on(UNI, 'listUniverse', async () => ({ brands: [{ name: 'leak' }], total: 1 }));
    const r = await call('brands', { method: 'GET' });
    expect(r.out).toMatchObject({ ok: true, brands: [], total: 0, error: 'workspace_unresolved' });
    expect(r.out.note).toMatch(/never substituted/);
    expect(S.hits(UNI, 'listUniverse')).toEqual([]);
  });
  test('seed: seeds from the brand\'s own record for the caller\'s workspace; unattributed callers get 401', async () => {
    S.on(UNI, 'seedForWorkspace', async () => ({ ok: true, added: 4 }));
    const r = await call('seed', { json: {} });
    expect(r.out).toEqual({ ok: true, added: 4 }); expect(last(UNI, 'seedForWorkspace')[0].kind).toBe('user'); expect(last(UNI, 'seedForWorkspace')[1]).toBe(H.WS);
    const anon = await call('seed', { json: {}, auth: 'none', origin: false, query: { workspace_id: H.WS } });
    expect(anon.status).toBe(401); expect(anon.out.error).toBe('sign_in_required');
    expect(S.hits(UNI, 'seedForWorkspace').length).toBe(1);
  });
  test('discover: a discovery pass for the caller\'s workspace, with the limit', async () => {
    S.on(UNI, 'refreshWorkspace', async () => ({ ok: true, added: 1, dropped: [] }));
    const r = await call('discover', { json: {}, query: { limit: '5' } });
    expect(r.out).toEqual({ ok: true, added: 1, dropped: [] });
    expect(last(UNI, 'refreshWorkspace')[1]).toBe(H.WS); expect(last(UNI, 'refreshWorkspace')[2]).toEqual({ limit: '5' });
    expect((await call('discover', { json: {}, auth: 'none', origin: false, query: { workspace_id: H.WS } })).status).toBe(401);
  });
  test('universe-refresh: the scheduled sweep runs only for the scheduler', async () => {
    S.on(UNI, 'refreshDueWorkspaces', async () => ({ due: 2, refreshed: 2, added: 3 }));
    for (const auth of ['none', 'session', 'forged']) {
      const r = await call('universe-refresh', { method: 'GET', auth, origin: false });
      expect(r.status, auth).toBe(401); expect(S.hits(UNI, 'refreshDueWorkspaces'), auth).toEqual([]);
    }
    const r = await call('universe-refresh', { method: 'GET', auth: 'cron', origin: false, query: { max: '2', min_interval_hours: '6' } });
    expect(r.out).toEqual({ due: 2, refreshed: 2, added: 3 });
    expect(last(UNI, 'refreshDueWorkspaces')).toEqual([{ maxWorkspaces: '2', minIntervalHours: '6' }]);
  });
  test('universe-export: reads the caller\'s universe through their store and hands the rows to the sheet exporter', async () => {
    S.on(UNI, 'exportToSheet', async (rows) => ({ ok: true, exported: rows.length, configured: false }));
    const r = await call('universe-export', { json: {} });
    expect(r.out).toEqual({ ok: true, exported: 1, configured: false });
    expect(last(UNI, 'exportToSheet')).toEqual([[{ id: 'row_user', workspace_id: H.WS }]]);
  });
  test('mark-subscribed / subscribe-status: the worker writes the outcome into the universe, and the sheet only when it exists', withEnv({ INGEST_TOKEN: 'ingest-harness' }, async () => {
    S.on(UNI, 'markSubscribed', async () => ({ ok: true, updated: 1 }));
    S.on(CORE, 'markBrandSubscribed', async () => undefined);
    const body = { domain: 'rival.example', status: 'subscribed' };
    const hdr = { 'x-ingest-token': 'ingest-harness' };
    expect((await call('mark-subscribed', { method: 'GET', headers: hdr })).status).toBe(405);
    expect((await call('mark-subscribed', { json: body, headers: { 'x-ingest-token': 'bad' } })).status).toBe(401);
    expect(S.hits(UNI, 'markSubscribed')).toEqual([]);
    const r = await call('subscribe-status', { json: body, headers: hdr });
    expect(r.out).toEqual({ ok: true, updated: 1 });
    expect(last(UNI, 'markSubscribed')[1]).toBe(H.WS); expect(last(UNI, 'markSubscribed')[2]).toEqual(body);
    expect(S.hits(CORE, 'markBrandSubscribed')).toEqual([]);          // no sheet configured: the universe is the record
    S.on(CORE, 'sheetsConfigured', () => true);
    await call('mark-subscribed', { json: body, headers: hdr });
    expect(last(CORE, 'markBrandSubscribed')).toEqual([body]);
    const noWs = await call('mark-subscribed', { json: body, headers: hdr, auth: 'none', origin: false, query: { workspace_id: undefined } });
    expect(noWs.status).toBe(400);
  }));
  test('benchmark / benchmark-set: the own side is the ACTIVE brand\'s store, resolved here', async () => {
    S.on(UNI, 'brandForWorkspace', async () => ({ name: 'Harness Brand', store_url: 'https://harness.example' }));
    S.on(BENCH, 'benchmark', async () => ({ ok: true, comparable: [], own_only: [] }));
    S.on(BENCH, 'benchmarkSet', async () => ({ ok: true, set: [] }));
    const one = await call('benchmark', { method: 'GET', query: { brand: 'Rival', domain: 'rival.example', market: 'UK', country: 'GB', days: '14', limit: '5' } });
    noHarnessError(one);
    expect(one.out).toEqual({ ok: true, comparable: [], own_only: [] });
    expect(last(UNI, 'brandForWorkspace')[1]).toBe(H.WS);
    expect(last(BENCH, 'benchmark')[0]).toEqual({ brand: 'Rival', domain: 'rival.example', market: 'UK', country: 'GB', days: 14, limit: 5, ownBrand: { name: 'Harness Brand', store_url: 'https://harness.example' } });
    const set = await call('benchmark-set', { method: 'GET', query: { market: 'UK', category: 'shoes', days: '7', max: '3' } });
    expect(set.out).toEqual({ ok: true, set: [] });
    const a = last(BENCH, 'benchmarkSet')[0];
    expect(a).toMatchObject({ market: 'UK', category: 'shoes', days: 7, max: '3', workspaceId: H.WS }); expect(a.store.kind).toBe('user');
    S.on(BENCH, 'benchmark', async () => ({ ok: false, error: 'no own store' }));
    expect((await call('benchmark', { method: 'GET', query: { market: 'UK' } })).status).toBe(400);
    expect((await call('benchmark', { method: 'GET', auth: 'none', origin: false, query: { workspace_id: H.WS } })).status).toBe(401);
  });
});

/* ── competitive intelligence (Supabase) ───────────────────────────────── */

test.describe('competitive intelligence', () => {
  for (const mode of ['bare', 'vercel']) {
    test(`[${mode}] ci-collect-*: collectors post already-fetched payloads, guarded by INGEST_TOKEN, one result per item`, withEnv({ INGEST_TOKEN: 'ingest-harness' }, async () => {
      S.on(CI_COLLECT, 'collectAd', async (it) => ({ stored: 'ad', id: it.id }));
      S.on(CI_COLLECT, 'collectEmail', async (it) => ({ stored: 'email', id: it.id }));
      S.on(CI_COLLECT, 'collectLanding', async () => { throw new Error('bad landing'); });
      const hdr = { 'x-ingest-token': 'ingest-harness', 'x-mode': mode };
      // The body is read from the STREAM in bare mode: req.body is empty there.
      const ads = await call('ci-collect-ad', { raw: JSON.stringify({ items: [{ id: 'a1' }, { id: 'a2' }] }), auth: 'none', origin: false, headers: hdr });
      noHarnessError(ads);
      expect(ads.out).toEqual({ ok: true, count: 2, results: [{ stored: 'ad', id: 'a1' }, { stored: 'ad', id: 'a2' }] });
      expect(S.hits(CI_COLLECT, 'collectAd').map((h) => h.args[0].id)).toEqual(['a1', 'a2']);
      const one = await call('ci-collect-email', { raw: JSON.stringify({ id: 'e1', subject: 's' }), auth: 'none', origin: false, headers: hdr });
      expect(one.out).toEqual({ ok: true, count: 1, results: [{ stored: 'email', id: 'e1' }] });
      const failing = await call('ci-collect-landing', { raw: JSON.stringify({ items: [{ id: 'l1' }] }), auth: 'none', origin: false, headers: hdr });
      expect(failing.out).toEqual({ ok: true, count: 1, results: [{ error: 'bad landing' }] });   // one bad item does not lose the batch
      expect((await call('ci-collect-ad', { method: 'GET', auth: 'none', origin: false, headers: hdr })).status).toBe(405);
      const wrong = await call('ci-collect-ad', { raw: '{"items":[{"id":"x"}]}', auth: 'none', origin: false, headers: { 'x-ingest-token': 'bad', 'x-mode': mode } });
      expect(wrong.status).toBe(401);
      expect(S.hits(CI_COLLECT, 'collectAd').length).toBe(2);
    }));
  }
  test('ci-brands: the CI brand register, active by default', async () => {
    S.on(SUPA, 'select', async () => [{ id: 1, name: 'Rival' }]);
    const r = await call('ci-brands', { method: 'GET' });
    expect(r.out).toEqual({ ok: true, count: 1, brands: [{ id: 1, name: 'Rival' }] });
    expect(last(SUPA, 'select')).toEqual(['brands', { filters: { is_own: 'eq.false', active: 'eq.true' }, order: 'name.asc', limit: 1000 }]);
    await call('ci-brands', { method: 'GET', query: { active: '0' } });
    expect(last(SUPA, 'select')[1].filters).toEqual({ is_own: 'eq.false' });
  });
  for (const [action, table, order] of [['ci-ads', 'ci_ads', 'last_seen.desc'], ['ci-emails', 'ci_emails', 'send_date.desc'], ['ci-landing', 'ci_landing_pages', 'captured_at.desc']]) {
    test(`${action}: reads ${table} with the brand and source filters`, async () => {
      S.on(SUPA, 'select', async () => [{ id: 'row' }]);
      const r = await call(action, { method: 'GET', query: { brand_id: 'b1', source: 'meta', limit: '3' } });
      expect(r.out).toEqual({ ok: true, count: 1, rows: [{ id: 'row' }] });
      expect(last(SUPA, 'select')).toEqual([table, { filters: { brand_id: 'eq.b1', source: 'eq.meta' }, order, limit: 3 }]);
    });
  }
  test('ci-offers: the offer query', async () => {
    S.on(CI_OFFERS, 'query', async () => [{ offer: 'x' }]);
    const r = await call('ci-offers', { method: 'GET', query: { offer_type: 'percent', category: 'shoes', region: 'UK', brand_id: 'b1', days: '10', limit: '4' } });
    expect(r.out).toEqual({ ok: true, count: 1, offers: [{ offer: 'x' }] });
    expect(last(CI_OFFERS, 'query')).toEqual([{ offer_type: 'percent', product_category: 'shoes', region: 'UK', brand_id: 'b1', days: '10', limit: 4 }]);
  });
  test('ci-enrich: runs the enrichment batch for the asset type, token-guarded', withEnv({ INGEST_TOKEN: 'ingest-harness' }, async () => {
    S.on(CI_ENRICH, 'enrichBatch', async () => ({ processed: 2 }));
    expect((await call('ci-enrich', { method: 'GET', auth: 'none', origin: false, query: { workspace_id: H.WS } })).status).toBe(401);
    expect(S.hits(CI_ENRICH)).toEqual([]);
    const r = await call('ci-enrich', { method: 'GET', query: { type: 'email', limit: '3', force: '1', token: 'ingest-harness' } });
    expect(r.out).toEqual({ ok: true, processed: 2 }); expect(last(CI_ENRICH, 'enrichBatch')).toEqual(['email', { limit: 3, force: true }]);
  }));
  test('ci-funnel: needs a brand_id, then reads that brand\'s funnels', async () => {
    S.on(CI_FUNNEL, 'getForBrand', async () => [{ step: 1 }]);
    expect((await call('ci-funnel', { method: 'GET' })).status).toBe(400);
    const r = await call('ci-funnel', { method: 'GET', query: { brand_id: 'b1' } });
    expect(r.out).toEqual({ ok: true, count: 1, funnels: [{ step: 1 }] }); expect(last(CI_FUNNEL, 'getForBrand')).toEqual(['b1']);
  });
  test('ci-funnel-rebuild: one brand or all, token-guarded', withEnv({ INGEST_TOKEN: 'ingest-harness' }, async () => {
    S.on(CI_FUNNEL, 'rebuildForBrand', async () => ({ rebuilt: 1 }));
    S.on(CI_FUNNEL, 'rebuildAll', async () => ({ rebuilt: 9 }));
    expect((await call('ci-funnel-rebuild', { method: 'GET', headers: { 'x-ingest-token': 'bad' } })).status).toBe(401);
    expect((await call('ci-funnel-rebuild', { method: 'GET', query: { brand_id: 'b1', token: 'ingest-harness' } })).out).toEqual({ ok: true, result: { rebuilt: 1 } });
    expect((await call('ci-funnel-rebuild', { method: 'GET', query: { token: 'ingest-harness' } })).out).toEqual({ ok: true, result: { rebuilt: 9 } });
    expect(S.hits(CI_FUNNEL, 'rebuildAll').length).toBe(1);
  }));
  test('ci-email-sync: the scheduler OR the ingest token mirrors the sheet into ci_emails', withEnv({ INGEST_TOKEN: 'ingest-harness' }, async () => {
    S.on(CI_BRIDGE, 'sync', async () => ({ ok: true, mirrored: 3 }));
    expect((await call('ci-email-sync', { method: 'GET', auth: 'session' })).status).toBe(401);
    expect(S.hits(CI_BRIDGE)).toEqual([]);
    const cron = await call('ci-email-sync', { method: 'GET', auth: 'cron', origin: false, query: { limit: '5', html: '0' } });
    expect(cron.out).toEqual({ ok: true, mirrored: 3 }); expect(last(CI_BRIDGE, 'sync')).toEqual([{ limit: 5, html: false }]);
    const token = await call('ci-email-sync', { method: 'GET', auth: 'none', origin: false, headers: { 'x-ingest-token': 'ingest-harness' } });
    expect(token.status).toBe(200); expect(last(CI_BRIDGE, 'sync')).toEqual([{ limit: 0, html: true }]);
  }));
  test('ci-daily: the combined pass mirrors, then enriches 15 emails and 15 ads', withEnv({ INGEST_TOKEN: 'ingest-harness' }, async () => {
    S.on(CI_BRIDGE, 'sync', async () => ({ ok: true }));
    S.on(CI_ENRICH, 'enrichBatch', async (type) => ({ processed: type === 'email' ? 4 : 2 }));
    expect((await call('ci-daily', { method: 'GET', auth: 'none', origin: false })).status).toBe(401);
    const r = await call('ci-daily', { method: 'GET', auth: 'cron', origin: false });
    expect(r.out).toEqual({ ok: true, emailSync: { ok: true }, enrichEmails: { processed: 4 }, enrichAds: { processed: 2 } });
    expect(S.hits(CI_ENRICH, 'enrichBatch').map((h) => h.args)).toEqual([['email', { limit: 15 }], ['ad', { limit: 15 }]]);
    expect(last(CI_BRIDGE, 'sync')).toEqual([{ limit: 0 }]);
  }));
  test('sub-list / sub-set: a user\'s followed brands', async () => {
    S.on(CI_SUBS, 'listForUser', async () => [{ brand_name: 'Rival' }]);
    S.on(CI_SUBS, 'setSub', async () => ({ ok: true, id: 's1' }));
    const l = await call('sub-list', { method: 'GET', query: { user: 'op@harness.test' } });
    expect(l.out).toEqual({ ok: true, subscriptions: [{ brand_name: 'Rival' }] }); expect(last(CI_SUBS, 'listForUser')).toEqual(['op@harness.test']);
    const s = await call('sub-set', { raw: JSON.stringify({ user: 'op@harness.test', brand_name: 'Rival', domain: 'rival.example', ads: false }), headers: { 'x-mode': 'bare' } });
    expect(s.out).toEqual({ ok: true, id: 's1' });
    expect(last(CI_SUBS, 'setSub')).toEqual([{ userEmail: 'op@harness.test', brand_id: null, brand_name: 'Rival', domain: 'rival.example', mailers: true, ads: false, active: true }]);
    S.on(CI_SUBS, 'setSub', async () => ({ ok: false, error: 'brand required' }));
    expect((await call('sub-set', { json: {} })).status).toBe(400);
  });
  test('landing-real: real landing pages per platform, each with its driving asset; an unreadable table is an empty group, not a 500', async () => {
    S.on(SUPA, 'select', async (table) => {
      if (table === 'ci_ads') return [{ source: 'Meta', brand_name: 'Rival', landing_url: 'https://rival.example/lp', creative_type: 'video', video_urls: ['v.mp4'], last_seen: 't1' }, { source: 'tiktok', landing_url: '' }];
      if (table === 'ci_emails') return [{ brand_name: 'Rival', subject: 'S', ctas: [{ href: 'https://rival.example/lp' }], images: ['i.png'], send_date: 't2' }];
      throw new Error('ci_landing_pages unreadable');
    });
    const r = await call('landing-real', { method: 'GET', query: { brand_id: 'b1', limit: '10' } });
    noHarnessError(r);
    expect(r.status).toBe(200);
    expect(r.out.captured_landing_count).toBe(0);
    const g = Object.fromEntries(r.out.groups.map((x) => [x.key, x.items]));
    expect(g.meta).toEqual([{ brand: 'Rival', landing_url: 'https://rival.example/lp', asset_type: 'video', asset_url: 'v.mp4', headline: null, source_link: null, captured_lp: false, captured_at: 't1' }]);
    expect(g.mailers).toEqual([{ brand: 'Rival', landing_url: 'https://rival.example/lp', asset_type: 'mailer', asset_url: 'i.png', headline: 'S', source_link: null, captured_lp: false, captured_at: 't2' }]);
    expect(g.tiktok).toEqual([]); expect(g.google).toEqual([]);
    expect(S.hits(SUPA, 'select').map((h) => [h.args[0], h.args[1].filters, h.args[1].limit])).toEqual([['ci_ads', { brand_id: 'eq.b1' }, 10], ['ci_emails', { brand_id: 'eq.b1' }, 10], ['ci_landing_pages', { brand_id: 'eq.b1' }, 10]]);
  });
  test('brand-detail: every asset of one brand, ads bucketed by platform', async () => {
    S.on(SUPA, 'select', async (table) => {
      if (table === 'brands') return [{ id: 'b1', name: 'Rival', domain: 'rival.example' }];
      if (table === 'ci_ads') return [{ source: 'google' }, { source: 'unknownnet' }];
      if (table === 'ci_emails') return [{ id: 'e' }];
      return [];
    });
    const r = await call('brand-detail', { method: 'GET', query: { brand_id: 'b1' } });
    expect(r.out).toMatchObject({ ok: true, brand: { id: 'b1' }, brand_name: 'Rival', website: 'https://rival.example', counts: { mailers: 1, ads: 2, landing: 0 }, ads: { google: [{ source: 'google' }], other: [{ source: 'unknownnet' }], meta: [], tiktok: [] } });
    expect(S.hits(SUPA, 'select')[0].args).toEqual(['brands', { filters: { id: 'eq.b1' }, limit: 1 }]);
    const byName = await call('brand-detail', { method: 'GET', query: { brand: 'Rival' } });
    expect(byName.out).toMatchObject({ brand: null, brand_name: 'Rival', website: null });
    expect(S.hits(SUPA, 'select').filter((h) => h.args[0] === 'ci_emails').map((h) => h.args[1].filters)).toEqual([{ brand_id: 'eq.b1' }, { brand_name: 'eq.Rival' }]);
  });
});

/* ── the router itself ──────────────────────────────────────────────────── */

test.describe('the router', () => {
  test('OPTIONS is a 204 with the CORS headers, and reaches no action (a preflight for ?action=poll used to run the poll)', async () => {
    S.on(CORE, 'runSync', async () => ({ ok: true }));
    const o = await H.request(srv.port, { method: 'OPTIONS', path: '/api/competitor?action=poll', headers: { origin: H.ORIGIN, 'access-control-request-headers': 'authorization' } });
    expect(o.status).toBe(204);
    expect(o.headers['access-control-allow-origin']).toBe('*');
    expect(o.headers['access-control-allow-headers']).toMatch(/Authorization/);
    expect(o.headers['access-control-allow-methods']).toContain('POST');
    expect(S.reached).toEqual([]);
    expect(guard.calls).toEqual([]);
    const g = await call('sort', { method: 'GET' });   // the same headers ride every answer
    expect(g.headers['access-control-allow-origin']).toBe('*');
    expect(g.headers['cache-control']).toBe('no-store');
  });
  test('an unknown action is the router\'s own 400 naming it', async () => {
    const r = await call('no-such-action', { method: 'GET' });
    expect(r.status).toBe(400);
    expect(r.out).toEqual({ ok: false, error: 'Unknown action: no-such-action' });
  });
  test('a core that throws is a 500 with the message', async () => {
    S.on(CORE, 'sortEmailsByReceivedDesc', async () => { throw new Error('sheet gone'); });
    const r = await call('sort', { method: 'GET' });
    expect(r.status).toBe(500);
    expect(r.out).toEqual({ ok: false, error: 'sheet gone' });
  });
  test('an unattributed browser request is answered with nothing, before any action, whatever it asked for', async () => {
    S.on(UNI, 'listUniverse', async () => ({ brands: [{ name: 'leak' }], total: 1 }));
    S.on(CORE, 'runSync', async () => ({ ok: true }));
    for (const action of ['brands', 'poll', 'list', 'sync']) {
      const r = await call(action, { method: 'GET', auth: 'none', origin: true });
      expect(r.status, action).toBe(200);
      expect(r.out, action).toMatchObject({ ok: true, error: 'workspace_unresolved', emails: [], brands: [], total: 0 });
    }
    expect(actionHits()).toEqual([]);
    expect(guard.restBeyondScoping()).toEqual([]);
  });
  test('every action the router dispatches has a test here, and the enumeration is not trivial', () => {
    const code = H.routerCode(COMP);
    const enumerated = H.uniqSorted([...code.matchAll(/\baction === '([a-z-]+)'/g)].map((m) => m[1]));
    expect(enumerated.length).toBeGreaterThanOrEqual(30);
    const tested = H.uniqSorted([
      'list', 'html', 'raw', 'poll', 'sync', 'sort', 'brands', 'seed', 'ingest', 'mark-subscribed', 'subscribe-status', 'adlibrary', 'ads',
      'discover', 'universe-refresh', 'universe-export', 'benchmark', 'benchmark-set', 'ci-collect-ad', 'ci-collect-email', 'ci-collect-landing',
      'ci-brands', 'ci-ads', 'ci-emails', 'ci-landing', 'ci-offers', 'ci-enrich', 'ci-funnel', 'ci-funnel-rebuild', 'ci-email-sync', 'ci-daily',
      'sub-list', 'sub-set', 'landing-real', 'brand-detail',
    ]);
    expect(enumerated.filter((a) => !tested.includes(a)), 'actions the router dispatches with no test').toEqual([]);
    expect(tested.filter((a) => !enumerated.includes(a)), 'tests for actions the router no longer has').toEqual([]);
  });
});
