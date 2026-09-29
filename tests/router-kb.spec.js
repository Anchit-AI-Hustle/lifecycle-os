// api/kb.js, EXECUTED: the shipped router (request-scope wrapper included) on
// a real http.Server, one test per ?action= it dispatches.
//
// Until 2026-09-28 only half of this file was ever executed (coverage/
// UNTESTED.md: 431 of 862 lines; ingestFiles, ingestSite, dailyDigest,
// topEmails, classifyEmails and the brands write paths had never run).
//
// This router has no core module in front of its store: it speaks PostgREST
// itself through global.fetch. So here the persistence layer IS the fake
// network: every table the action touches gets an explicit route that
// records the call and answers canned rows, and any URL nothing claimed
// throws. That makes the assertions about the REQUESTS the router builds -
// which table, which filter, which Prefer header, which body - rather than
// about what a stub returned. The two model calls (ingest's summariser and
// the daily digest) go through llm.js, which this router requires at CALL
// time, so its cache entry is swapped for a recording stub for the file.
//
// The invariant every read here carries: the workspace filter. A browser
// request that cannot be attributed gets NOTHING (200, items:[], a note),
// never the default workspace's knowledge; a signed-in user's rows are
// filtered to their active workspace; and a write is stamped with it or
// refused.
//
// Run: npx playwright test tests/router-kb.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const H = require('./router-harness');

const KB = 'api/kb.js';
const LLM = 'api/_shared/llm.js';
const WS_SCOPE = 'api/_shared/workspace-scope.js';
const KB_FILES = 'api/_shared/kb-files.js';
const PACK = 'api/_shared/brand-context-pack.js';
const GUARD = 'api/_shared/ingest-guardrail.js';
const REST = H.SUPABASE_URL + '/rest/v1/';

let restoreEnv, srv, S, guard;
const FILE = new H.Stubs();
const llmCalls = [];

test.beforeAll(async () => {
  restoreEnv = H.routerEnv();
  require(H.ROOT + '/' + KB);
  const realLlm = require(H.ROOT + '/' + LLM);
  const stub = async function callLLMStub(opts) { llmCalls.push(opts); return { ok: true, text: stub.next || '{}', provider: 'stub', model: 'stub' }; };
  for (const k of Object.keys(realLlm)) stub[k] = realLlm[k];
  FILE.swap(LLM, stub);
  FILE.llm = stub;
  srv = await H.serve(KB);
});
test.afterAll(async () => { await srv.close(); FILE.restore(); restoreEnv(); });
test.beforeEach(() => {
  llmCalls.length = 0; FILE.llm.next = '{}';
  require(H.ROOT + '/' + WS_SCOPE).invalidate();
  guard = H.netGuard();
  S = new H.Stubs();
});
test.afterEach(() => { S.restore(); guard.restore(); });

const noHarnessError = (r) => expect((r.out && r.out.harness_error) || undefined, `harness error: ${r.text}`).toBeUndefined();
function call(action, o) {
  const r = o || {};
  const query = Object.assign({ action }, r.query || {});
  return H.request(srv.port, {
    method: r.method || (r.json !== undefined ? 'POST' : 'GET'), path: '/api/kb' + H.qs(query),
    json: r.json, headers: r.headers, auth: r.auth || 'session', origin: r.origin !== undefined ? r.origin : true,
  });
}
/** A route on one table; returns the recorded calls to it. */
function table(name, answer) {
  const hits = [];
  guard.route((u) => u.startsWith(REST + name + '?') || u === REST + name, (u, init, call) => {
    hits.push(call);
    const a = typeof answer === 'function' ? answer(u, init, call) : answer;
    return a && a.__reply ? a.__reply : H.reply(200, a === undefined ? [] : a);
  });
  return hits;
}
const bodyOf = (c) => JSON.parse(String(c.body));
const wsFilter = (u) => decodeURIComponent((/workspace_id=eq\.([^&]+)/.exec(u) || [])[1] || '');
const NOTHING = { ok: true, items: [], count: 0, workspace_id: null };

/* ── list ───────────────────────────────────────────────────────────────── */

test.describe('list', () => {
  test('reads kb_knowledge for the caller\'s ACTIVE workspace, newest first, with the status filter', async () => {
    const hits = table('kb_knowledge', [{ id: 1, title: 'a' }]);
    const r = await call('list', { method: 'GET', query: { limit: '5', status: 'summarized' } });
    noHarnessError(r);
    expect(r.out).toEqual({ ok: true, items: [{ id: 1, title: 'a' }], count: 1 });
    expect(hits.length).toBe(1);
    expect(hits[0].url).toContain('order=added_at.desc&limit=5&status=eq.summarized');
    expect(wsFilter(hits[0].url)).toBe(H.WS);
    expect(hits[0].headers.apikey).toBe('service-harness-key');
  });
  test('a limit above 500 is clamped', async () => {
    const hits = table('kb_knowledge', []);
    await call('list', { method: 'GET', query: { limit: '9999' } });
    expect(hits[0].url).toContain('limit=500');
  });
  test('POST is a 405', async () => {
    const hits = table('kb_knowledge', []);
    expect((await call('list', { json: {} })).status).toBe(405);
    expect(hits).toEqual([]);
  });
  test('an unattributed browser request gets NOTHING and reads no table', async () => {
    const hits = table('kb_knowledge', [{ id: 'leak' }]);
    const r = await call('list', { method: 'GET', auth: 'none', origin: true });
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject(Object.assign({ error: 'workspace_unresolved', brands: [], brand_kit: null }, NOTHING));
    expect(r.out.note).toMatch(/never substituted/);
    expect(hits).toEqual([]);
  });
  test('a signed-in user with no active workspace gets NOTHING too, and never the oldest workspace', async () => {
    guard.restore(); guard = H.netGuard({ activeWorkspace: null });
    const hits = table('kb_knowledge', [{ id: 'leak' }]);
    const r = await call('list', { method: 'GET' });
    expect(r.out).toMatchObject(NOTHING);
    expect(hits).toEqual([]);
    expect(guard.rest(/order=created_at\.asc/)).toEqual([]);
  });
  test('a forged bearer decodes to a user the prefs table does not know, so it reads nothing', async () => {
    const hits = table('kb_knowledge', [{ id: 'leak' }]);
    const r = await call('list', { method: 'GET', auth: 'forged' });
    expect(r.out).toMatchObject(NOTHING);
    expect(hits).toEqual([]);
    expect(guard.rest(/brand_user_prefs/).length).toBe(1);
  });
  test('an explicit workspace_id wins over the session', async () => {
    const hits = table('kb_knowledge', []);
    await call('list', { method: 'GET', query: { workspace_id: 'ws_explicit' } });
    expect(wsFilter(hits[0].url)).toBe('ws_explicit');
    expect(guard.rest(/brand_user_prefs/)).toEqual([]);
  });
  test('a store error is passed through with its status, never as items', async () => {
    table('kb_knowledge', { __reply: H.reply(503, 'db paused') });
    const r = await call('list', { method: 'GET' });
    expect(r.status).toBe(503);
    expect(r.out).toEqual({ ok: false, items: [], error: 'db paused' });
  });
});

/* ── ingest ─────────────────────────────────────────────────────────────── */

test.describe('ingest', () => {
  const PAGE = '<html><head><title>Rival launches loyalty tier</title><meta name="author" content="Ann"></head><body><main>' + 'Rival announced a new loyalty tier with free shipping for members. '.repeat(8) + '</main></body></html>';
  function stubs() {
    const know = table('kb_knowledge', (u, init, c) => (c.method === 'POST' ? [{ id: 'row_9', url: bodyOf(c).url }] : []));
    guard.route((u) => u.startsWith('https://page.harness.test/'), () => H.reply(200, PAGE, { 'content-type': 'text/html' }));
    S.on(GUARD, 'gatekeep', async () => ({ keep: true, phase: 2, reason: 'on-context', meta: { market: 'UK', vertical: 'loyalty' } }));
    return know;
  }
  test('POST fetches the page, files it under the caller\'s workspace, summarises it with the model, and stores the summary', async () => {
    const know = stubs();
    FILE.llm.next = JSON.stringify({ summary: 'Rival added a loyalty tier.', key_points: ['free shipping'], tags: ['Loyalty'] });
    const r = await call('ingest', { json: { url: 'https://page.harness.test/news?utm_source=x', tags: ['Competitor'], added_by: 'op' } });
    noHarnessError(r);
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({ ok: true, id: 'row_9', title: 'Rival launches loyalty tier', author: 'Ann', summary: 'Rival added a loyalty tier.', key_points: ['free shipping'], tags: ['competitor', 'loyalty'], market: 'UK', vertical: 'loyalty', status: 'summarized' });
    expect(r.out.url).toBe('https://page.harness.test/news');      // canonical: the tracking param is gone
    // 1. the queued row, stamped with the workspace, upserted on (workspace_id, url_hash)
    expect(know[0].method).toBe('POST'); expect(know[0].url).toContain('on_conflict=workspace_id,url_hash');
    expect(bodyOf(know[0])).toMatchObject({ workspace_id: H.WS, url: 'https://page.harness.test/news', status: 'queued', added_by: 'op', tags: ['competitor'] });
    expect(know[0].headers.prefer).toMatch(/merge-duplicates/);
    // 2..3. every follow-up PATCH names the row AND the workspace
    const patches = know.filter((c) => c.method === 'PATCH');
    expect(patches.length).toBe(2);
    for (const p of patches) { expect(p.url).toContain('id=eq.row_9'); expect(wsFilter(p.url)).toBe(H.WS); }
    expect(bodyOf(patches[0])).toMatchObject({ title: 'Rival launches loyalty tier', status: 'fetched' });
    expect(bodyOf(patches[1])).toMatchObject({ status: 'summarized', market: 'UK', vertical: 'loyalty', tags: ['competitor', 'loyalty'] });
    // the model saw the page text and was briefed for THIS brand, not a shipped one
    expect(llmCalls.length).toBe(1);
    expect(llmCalls[0].userMessage).toContain('loyalty tier');
    expect(llmCalls[0].systemPrompt).toContain('Harness Brand');
    expect(llmCalls[0].stage).toBe('kb-ingest');
    expect(guard.escaped).toEqual([]);
  });
  test('a page the guardrail refuses is recorded as filtered and never reaches the model', async () => {
    const know = stubs();
    S.on(GUARD, 'gatekeep', async () => ({ keep: false, phase: 1, reason: 'off-topic' }));
    const r = await call('ingest', { json: { url: 'https://page.harness.test/junk' } });
    expect(r.out).toMatchObject({ ok: true, filtered: true, phase: 1, reason: 'off-topic', id: 'row_9' });
    expect(llmCalls).toEqual([]);
    const patch = know.find((c) => c.method === 'PATCH');
    expect(bodyOf(patch)).toMatchObject({ status: 'filtered' });
  });
  test('a page that does not answer is a 502 and the row is marked failed', async () => {
    const know = table('kb_knowledge', (u, init, c) => (c.method === 'POST' ? [{ id: 'row_9' }] : []));
    guard.route((u) => u.startsWith('https://page.harness.test/'), () => H.reply(404, 'gone', { 'content-type': 'text/html' }));
    const r = await call('ingest', { json: { url: 'https://page.harness.test/missing' } });
    expect(r.status).toBe(502);
    expect(r.out).toMatchObject({ ok: false, stage: 'fetch', id: 'row_9' });
    expect(bodyOf(know.find((c) => c.method === 'PATCH'))).toMatchObject({ status: 'failed' });
    expect(llmCalls).toEqual([]);
  });
  test('a bad url is a 400 before anything is written; GET is a 405', async () => {
    const know = stubs();
    expect((await call('ingest', { json: { url: 'ftp://nope' } })).status).toBe(400);
    expect((await call('ingest', { method: 'GET' })).status).toBe(405);
    expect(know).toEqual([]);
  });
  test('an unattributed request files nothing: the queued row would land with no workspace', async () => {
    guard.restore(); guard = H.netGuard({ activeWorkspace: null });
    const know = stubs();
    const r = await call('ingest', { json: { url: 'https://page.harness.test/news' } });
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({ ok: true, items: [], stage: 'workspace', error: 'workspace_unresolved' });
    expect(know).toEqual([]);
    expect(llmCalls).toEqual([]);
  });
});

/* ── ingest-files, ingest-site ──────────────────────────────────────────── */

test.describe('ingest-files', () => {
  test('files each uploaded document under the caller\'s workspace, analysed for THAT brand', async () => {
    const know = table('kb_knowledge', [{ id: 'k1' }]);
    S.on(KB_FILES, 'buildRecord', async ({ name, size, brand }) => ({ row: { title: name, url_hash: 'h_' + name, size }, extracted: { text_chars: size, extracted: true, brand: brand && brand.name } }));
    const data = Buffer.from('hello harness').toString('base64');
    const r = await call('ingest-files', { json: { files: [{ name: 'notes.txt', data_base64: data, market: 'UK' }, { name: 'empty.bin', data_base64: '' }] } });
    noHarnessError(r);
    expect(r.out).toMatchObject({ ok: true, stored: 1, total: 2, workspace_id: H.WS, brand: 'Harness Brand' });
    expect(r.out.results).toEqual([{ name: 'notes.txt', ok: true, title: 'notes.txt', text_chars: 13, extracted: true, brand: 'Harness Brand' }, { name: 'empty.bin', ok: false, error: 'empty file' }]);
    expect(know.length).toBe(1);
    expect(know[0].url).toContain('on_conflict=workspace_id,url_hash');
    expect(bodyOf(know[0])).toEqual([{ title: 'notes.txt', url_hash: 'h_notes.txt', size: 13, workspace_id: H.WS, market: 'UK' }]);
    expect(guard.escaped).toEqual([]);
  });
  test('no files is a 400; GET is a 405', async () => {
    const know = table('kb_knowledge', []);
    expect((await call('ingest-files', { json: {} })).status).toBe(400);
    expect((await call('ingest-files', { method: 'GET' })).status).toBe(405);
    expect(know).toEqual([]);
  });
  test('a store refusal is reported per file, not as a thrown 500', async () => {
    table('kb_knowledge', { __reply: H.reply(409, 'duplicate') });
    S.on(KB_FILES, 'buildRecord', async ({ name }) => ({ row: { title: name }, extracted: {} }));
    const r = await call('ingest-files', { json: { files: [{ name: 'a.txt', data_base64: Buffer.from('x').toString('base64') }] } });
    expect(r.out).toMatchObject({ ok: true, stored: 0, total: 1 });
    expect(r.out.results[0]).toMatchObject({ name: 'a.txt', ok: false, error: expect.stringMatching(/store failed: 409/) });
  });
  test('with no workspace nothing is filed', async () => {
    guard.restore(); guard = H.netGuard({ activeWorkspace: null });
    const know = table('kb_knowledge', []);
    S.on(KB_FILES, 'buildRecord', async () => ({ row: {}, extracted: {} }));
    const r = await call('ingest-files', { json: { files: [{ name: 'a.txt', data_base64: 'eA==' }] } });
    expect(r.out).toMatchObject({ ok: false, error: 'workspace_unresolved' });
    expect(know).toEqual([]);
    expect(S.hits(KB_FILES)).toEqual([]);
  });
});

test.describe('ingest-site', () => {
  test('advances the brand\'s context pack by one batch, through the CALLER\'s store, only at the knowledge stage', async () => {
    S.on(PACK, 'userStore', (token) => ({ kind: 'user', token }));
    S.on(PACK, 'serviceStore', () => ({ kind: 'service' }));
    S.on(PACK, 'getPackRow', async () => ({ id: 'pack_1', stage: 'knowledge' }));
    S.on(PACK, 'advancePack', async () => ({ stage: 'knowledge', done: false, pack: { knowledge: { pages: 12 } } }));
    const r = await call('ingest-site', { json: {} });
    noHarnessError(r);
    expect(r.out).toEqual({ ok: true, workspace_id: H.WS, stage: 'knowledge', done: false, knowledge: { pages: 12 } });
    expect(S.hit(PACK, 'getPackRow').args[0]).toMatchObject({ kind: 'user', token: H.SESSION }); expect(S.hit(PACK, 'getPackRow').args[1]).toBe(H.WS);
    expect(S.hit(PACK, 'advancePack').args[1]).toEqual({ id: 'pack_1', stage: 'knowledge' });
    expect(S.hits(PACK, 'serviceStore')).toEqual([]);
  });
  test('a pack at another stage is skipped, not advanced; no pack is a 404', async () => {
    S.on(PACK, 'userStore', () => ({ kind: 'user' }));
    S.on(PACK, 'advancePack', async () => ({}));
    S.on(PACK, 'getPackRow', async () => ({ stage: 'repos' }));
    expect((await call('ingest-site', { json: {} })).out).toMatchObject({ ok: true, skipped: true, stage: 'repos' });
    S.on(PACK, 'getPackRow', async () => null);
    const nf = await call('ingest-site', { json: {} });
    expect(nf.status).toBe(404); expect(nf.out.error).toBe('no_context_pack');
    expect(S.hits(PACK, 'advancePack')).toEqual([]);
  });
  test('a userless call takes the service store; no workspace at all is NOTHING; GET is a 405', async () => {
    S.on(PACK, 'userStore', () => ({ kind: 'user' }));
    S.on(PACK, 'serviceStore', () => ({ kind: 'service' }));
    S.on(PACK, 'getPackRow', async () => null);
    await call('ingest-site', { json: {}, auth: 'none', origin: false });
    expect(S.hit(PACK, 'getPackRow').args[0].kind).toBe('service');
    guard.restore(); guard = H.netGuard({ activeWorkspace: null });
    const none = await call('ingest-site', { json: {} });
    expect(none.out).toMatchObject(Object.assign({ error: 'workspace_unresolved' }, NOTHING));
    expect((await call('ingest-site', { method: 'GET' })).status).toBe(405);
  });
});

/* ── top-emails ─────────────────────────────────────────────────────────── */

test.describe('top-emails', () => {
  test('GET reads the caller\'s library with the market filter and the requested order', async () => {
    const hits = table('kb_top_emails', [{ id: 't1' }]);
    const r = await call('top-emails', { method: 'GET', query: { market: 'UK', order: 'open', limit: '10' } });
    noHarnessError(r);
    expect(r.out).toEqual({ ok: true, items: [{ id: 't1' }], count: 1 });
    expect(hits[0].url).toContain('order=open_rate.desc&limit=10&market=eq.UK');
    expect(wsFilter(hits[0].url)).toBe(H.WS);
    await call('topemails', { method: 'GET', query: { order: 'rev' } });
    expect(hits[1].url).toContain('order=revenue.desc');
  });
  test('POST normalises one row, stamps the workspace and inserts it', async () => {
    const hits = table('kb_top_emails', (u, init, c) => bodyOf(c));
    const r = await call('top-emails', { json: { subject: 'S', body_text: 'B', open_rate: 42, click_rate: '0.5', revenue: '12.5', send_count: '7', tags: 'A, b', secret_col: 'x' } });
    noHarnessError(r);
    expect(r.out).toEqual({ ok: true, inserted: 1, rejected: 0 });
    expect(hits[0].method).toBe('POST'); expect(hits[0].headers.prefer).toBe('return=representation');
    expect(bodyOf(hits[0])).toEqual([{ subject: 'S', body_text: 'B', open_rate: 0.42, click_rate: 0.5, revenue: 12.5, send_count: 7, tags: ['a', 'b'], workspace_id: H.WS }]);
  });
  test('bulk: rows without subject+body_text are rejected, more than 200 is refused, nothing valid is a 400', async () => {
    const hits = table('kb_top_emails', (u, init, c) => bodyOf(c));
    const r = await call('top-emails', { json: { items: [{ subject: 'ok', body_text: 'b' }, { subject: 'no body' }] } });
    expect(r.out).toEqual({ ok: true, inserted: 1, rejected: 1 });
    expect((await call('top-emails', { json: { items: Array.from({ length: 201 }, () => ({ subject: 's', body_text: 'b' })) } })).status).toBe(400);
    expect((await call('top-emails', { json: { items: [{ subject: 'x' }] } })).status).toBe(400);
    expect((await call('top-emails', { json: { items: [] } })).status).toBe(400);
    expect(hits.length).toBe(1);
  });
  test('a write with no workspace is refused rather than filed into the void', async () => {
    guard.restore(); guard = H.netGuard({ activeWorkspace: null });
    const hits = table('kb_top_emails', []);
    const r = await call('top-emails', { json: { subject: 'S', body_text: 'B' } });
    expect(r.out).toMatchObject(Object.assign({ inserted: 0, error: 'workspace_unresolved' }, NOTHING));
    expect(hits).toEqual([]);
  });
  test('PATCH is a 405', async () => { expect((await call('top-emails', { method: 'PATCH', json: {} })).status).toBe(405); });
});

/* ── brands ─────────────────────────────────────────────────────────────── */

test.describe('brands (the competitor register)', () => {
  test('GET reads competitor_brands scoped to the workspace with the category/region/active filters', async () => {
    const hits = table('competitor_brands', [{ id: 'b1' }]);
    const r = await call('brands', { method: 'GET', query: { category: 'shoes', region: 'UK', active: 'false' } });
    noHarnessError(r);
    expect(r.out).toEqual({ ok: true, items: [{ id: 'b1' }], count: 1 });
    expect(hits[0].url).toContain('category=eq.shoes&region=eq.UK&is_active=eq.false');
    expect(wsFilter(hits[0].url)).toBe(H.WS);
    await call('brands', { method: 'GET', query: { active: 'all' } });
    expect(hits[1].url).not.toContain('is_active');
  });
  test('POST upserts on (workspace_id, name, region) with the workspace stamped and only the allowed columns', async () => {
    const hits = table('competitor_brands', (u, init, c) => bodyOf(c));
    const r = await call('brands', { json: { name: 'Rival', category: 'shoes', region: 'UK', website: 'https://rival.example', owner_id: 'nope' } });
    expect(r.out).toEqual({ ok: true, brand: { name: 'Rival', category: 'shoes', region: 'UK', website: 'https://rival.example', workspace_id: H.WS } });
    expect(hits[0].url).toContain('on_conflict=workspace_id,name,region');
    expect(hits[0].headers.prefer).toMatch(/merge-duplicates/);
    expect((await call('brands', { json: { name: 'x' } })).status).toBe(400);
    expect(hits.length).toBe(1);
  });
  test('PATCH and DELETE name the id AND the workspace, so another brand\'s row id is not enough', async () => {
    const hits = table('competitor_brands', (u, init, c) => (c.method === 'PATCH' ? [{ id: 'b1', notes: 'n' }] : []));
    const p = await call('brands', { method: 'PATCH', json: { notes: 'n', owner_id: 'nope' }, query: { id: 'b1' } });
    expect(p.out).toEqual({ ok: true, brand: { id: 'b1', notes: 'n' } });
    expect(hits[0].url).toContain('id=eq.b1'); expect(wsFilter(hits[0].url)).toBe(H.WS); expect(bodyOf(hits[0])).toEqual({ notes: 'n' });
    const soft = await call('brands', { method: 'DELETE', query: { id: 'b1' } });
    expect(soft.out).toEqual({ ok: true, deleted: 'soft' }); expect(hits[1].method).toBe('PATCH'); expect(bodyOf(hits[1])).toEqual({ is_active: false }); expect(wsFilter(hits[1].url)).toBe(H.WS);
    const hard = await call('brands', { method: 'DELETE', query: { id: 'b1', hard: '1' } });
    expect(hard.out).toEqual({ ok: true, deleted: 'hard' }); expect(hits[2].method).toBe('DELETE'); expect(wsFilter(hits[2].url)).toBe(H.WS);
    expect((await call('brands', { method: 'PATCH', json: {}, query: { id: 'b1' } })).status).toBe(400);
    expect((await call('brands', { method: 'PATCH', json: { notes: 'n' } })).status).toBe(400);
    expect((await call('brands', { method: 'DELETE' })).status).toBe(400);
  });
  test('a PATCH that matches no row in THIS workspace is a 404, not a silent success', async () => {
    table('competitor_brands', []);
    const r = await call('brands', { method: 'PATCH', json: { notes: 'n' }, query: { id: 'someone_elses' } });
    expect(r.status).toBe(404); expect(r.out.error).toBe('not_found_in_this_workspace');
  });
  test('an unattributed request gets NOTHING; PUT is a 405', async () => {
    const hits = table('competitor_brands', [{ id: 'leak' }]);
    const r = await call('brands', { method: 'GET', auth: 'none', origin: true });
    expect(r.out).toMatchObject(Object.assign({ brands: [] }, NOTHING));
    expect(hits).toEqual([]);
    expect((await call('brands', { method: 'PUT', json: {} })).status).toBe(405);
  });
});

/* ── classify-emails ────────────────────────────────────────────────────── */

test.describe('classify-emails', () => {
  test('GET ?summary=1 rolls up THIS workspace\'s classified captures by format and brand', async () => {
    const hits = table('competitor_emails_classified', [{ format: 'text', brand: 'A' }, { format: 'text', brand: 'A' }, { format: 'html', brand: 'B' }, { format: 'mixed' }]);
    const r = await call('classify-emails', { method: 'GET', query: { summary: '1' } });
    noHarnessError(r);
    expect(r.out).toEqual({ ok: true, total: 4, counts: { text: 2, html: 1, mixed: 1 }, byBrand: { A: { text: 2, html: 0, image_heavy: 0, mixed: 0 }, B: { text: 0, html: 1, image_heavy: 0, mixed: 0 } } });
    expect(wsFilter(hits[0].url)).toBe(H.WS);
    await call('classify', { method: 'GET', query: { format: 'html', limit: '3' } });
    expect(hits[1].url).toContain('order=classified_at.desc&limit=3&format=eq.html');
  });
  test('POST pulls the archive through the deployment\'s own /api/competitor, classifies each mail, and upserts the new ones', async () => {
    const classified = table('competitor_emails_classified', (u, init, c) => (c.method === 'GET' ? [{ email_key: 'a@x.test|Old|2026-01-01' }] : []));
    const own = [];
    guard.route((u) => u.startsWith('https://app.harness.test/api/competitor'), (u) => {
      own.push(u);
      if (/action=list/.test(u)) return H.reply(200, { emails: [{ id: 2, senderEmail: 'a@x.test', subject: 'Old', receivedAt: '2026-01-01', bodyText: 'x' }, { id: 3, senderEmail: 'b@x.test', subject: 'New', receivedAt: '2026-02-01', bodyText: 'word '.repeat(150), brand: 'B', promoCodes: 'SAVE10' }] });
      return H.reply(200, { html: '<img src=a><img src=b>' });
    });
    const r = await call('classify-emails', { json: {}, headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'app.harness.test' } });
    noHarnessError(r);
    expect(r.out).toEqual({ ok: true, scanned: 2, skipped: 1, inserted: 1, counts: { text: 1, html: 0, image_heavy: 0, mixed: 0 } });
    expect(own).toEqual(['https://app.harness.test/api/competitor?action=list', 'https://app.harness.test/api/competitor?action=html&id=3']);
    const up = classified.find((c) => c.method === 'POST');
    expect(up.url).toContain('on_conflict=workspace_id,email_key');
    expect(bodyOf(up)).toEqual([{ email_key: 'b@x.test|New|2026-02-01', brand: 'B', format: 'text', word_count: 150, image_count: 2, has_promo: true, promo_codes: 'SAVE10', classifier: 'heuristic', workspace_id: H.WS }]);
  });
  test('an archive that cannot be read is a 502, and nothing is written', async () => {
    const classified = table('competitor_emails_classified', []);
    guard.route((u) => u.startsWith('https://app.harness.test/api/competitor'), () => H.reply(500, 'nope'));
    const r = await call('classify-emails', { json: {}, headers: { 'x-forwarded-host': 'app.harness.test' } });
    expect(r.status).toBe(502);
    expect(classified.filter((c) => c.method === 'POST')).toEqual([]);
  });
  test('PUT is a 405; an unattributed request gets NOTHING; a session with no workspace gets NOTHING with empty counts', async () => {
    const hits = table('competitor_emails_classified', [{ format: 'leak' }]);
    expect((await call('classify-emails', { method: 'PUT', json: {} })).status).toBe(405);
    const r = await call('classify-emails', { method: 'GET', auth: 'none', origin: true, query: { summary: '1' } });
    expect(r.out).toMatchObject(Object.assign({ error: 'workspace_unresolved' }, NOTHING));   // the router's own envelope, before the action
    expect(hits).toEqual([]);
    guard.restore(); guard = H.netGuard({ activeWorkspace: null });
    require(H.ROOT + '/' + WS_SCOPE).invalidate();   // the PUT above primed the per-user workspace cache
    // The workspace check precedes the method check inside the action, so even
    // a PUT with no workspace is answered with nothing rather than a 405.
    for (const method of ['GET', 'PUT']) {
      const none = await call('classify-emails', { method, json: method === 'PUT' ? {} : undefined, query: { summary: '1' } });
      expect(none.status, method).toBe(200);
      expect(none.out, method).toMatchObject(Object.assign({ counts: {}, byBrand: {}, total: 0 }, NOTHING));   // the action's own, shaped for its consumer
    }
    expect(hits).toEqual([]);
  });
});

/* ── digest ─────────────────────────────────────────────────────────────── */

test.describe('digest / daily-digest', () => {
  test('GET returns the latest stored digest for the workspace', async () => {
    const hits = table('kb_daily_digest', [{ digest_date: '2026-09-27', digest_md: 'd' }]);
    const r = await call('digest', { method: 'GET', query: { limit: '2' } });
    noHarnessError(r);
    expect(r.out).toEqual({ ok: true, items: [{ digest_date: '2026-09-27', digest_md: 'd' }], latest: { digest_date: '2026-09-27', digest_md: 'd' } });
    expect(hits[0].url).toContain('order=digest_date.desc&limit=2');
    expect(wsFilter(hits[0].url)).toBe(H.WS);
  });
  test('POST synthesises the last 24h of CLEAN rows for THIS brand and upserts on (workspace_id, digest_date)', async () => {
    const digests = table('kb_daily_digest', (u, init, c) => (c.method === 'POST' ? bodyOf(c) : []));
    const know = table('kb_knowledge', [{ title: 'Rival adds tier', summary: 's', market: 'UK', vertical: 'loyalty', url: 'u' }]);
    FILE.llm.next = JSON.stringify({ digest_md: 'One lesson.', signals: [{ pattern: 'loyalty tiers', brands: ['Rival'], vertical: 'loyalty', market: 'UK', evidence: 'e' }] });
    const r = await call('daily-digest', { json: {} });
    noHarnessError(r);
    expect(r.out).toMatchObject({ ok: true, sources_n: 1, markets: ['UK'], verticals: ['loyalty'], digest_md: 'One lesson.', signals: [{ pattern: 'loyalty tiers' }] });
    expect(know[0].url).toContain('status=eq.summarized'); expect(wsFilter(know[0].url)).toBe(H.WS);
    expect(llmCalls.length).toBe(1);
    expect(llmCalls[0].systemPrompt).toContain('Harness Brand'); expect(llmCalls[0].systemPrompt).toContain('markets UK'); expect(llmCalls[0].stage).toBe('kb-daily-digest');
    const up = digests.find((c) => c.method === 'POST');
    expect(up.url).toContain('on_conflict=workspace_id,digest_date');
    expect(bodyOf(up)).toMatchObject({ workspace_id: H.WS, digest_date: r.out.digest_date, markets: ['UK'], sources_n: 1, digest_md: 'One lesson.' });
  });
  test('with no model answer the digest is a deterministic roll-up that names only what the rows carry', async () => {
    table('kb_daily_digest', []);
    table('kb_knowledge', [{ title: 'Row one', url: 'u1' }, { title: 'Row two', url: 'u2' }]);
    FILE.llm.next = 'not json';
    const r = await call('digest', { json: {} });
    expect(r.out.ok).toBe(true);
    expect(r.out.digest_md).toContain('2 clean signals across no recorded vertical (no recorded market)');
    expect(r.out.digest_md).toContain('- Row one');
    expect(r.out.signals).toEqual([]);
  });
  test('an empty 24h window synthesises nothing and calls no model', async () => {
    table('kb_daily_digest', []);
    table('kb_knowledge', []);
    const r = await call('digest', { json: {} });
    expect(r.out).toMatchObject({ ok: true, empty: true });
    expect(llmCalls).toEqual([]);
  });
  test('an unattributed request gets NOTHING (and used to hang here: a bare `return []` inside the handler)', async () => {
    const hits = table('kb_daily_digest', [{ digest_md: 'leak' }]);
    expect((await call('digest', { method: 'PUT', json: {} })).status).toBe(405);
    const r = await call('digest', { method: 'GET', auth: 'none', origin: true });
    expect(r.out).toMatchObject(Object.assign({ error: 'workspace_unresolved' }, NOTHING));   // the router's own envelope
    expect(hits).toEqual([]);
    guard.restore(); guard = H.netGuard({ activeWorkspace: null });
    require(H.ROOT + '/' + WS_SCOPE).invalidate();   // the PUT above primed the per-user workspace cache
    const get = await call('digest', { method: 'GET' });
    expect(get.out).toMatchObject(Object.assign({ latest: null }, NOTHING));                  // the action's own
    const post = await call('digest', { json: {} });
    expect(post.status).toBe(200); expect(post.out).toMatchObject(Object.assign({ latest: null }, NOTHING));
    expect(hits).toEqual([]);
  });
});

/* ── brand-kit ──────────────────────────────────────────────────────────── */

test.describe('brand-kit / brandkit', () => {
  test('GET reads THIS workspace\'s kit row and the market config; a brand with none gets null and a note, never tenant zero\'s', async () => {
    const kit = table('lifecycle_brand_kit', []);
    table('lifecycle_market_config', [{ market: 'UK' }]);
    const r = await call('brand-kit', { method: 'GET' });
    noHarnessError(r);
    expect(r.out).toMatchObject({ ok: true, workspace_id: H.WS, brand_kit: null, markets: [{ market: 'UK' }] });
    expect(r.out.note).toMatch(/has not saved a brand kit yet/);
    expect(kit[0].url).toContain(`lifecycle_brand_kit?workspace_id=eq.${encodeURIComponent(H.WS)}&select=*&limit=1`);
  });
  test('POST upserts the kit on workspace_id, keyed by the workspace, and refuses a palette that is not four #RRGGBB colours', async () => {
    const kit = table('lifecycle_brand_kit', (u, init, c) => bodyOf(c));
    const good = { palette: { primary: '#1D4ED8', accent: '#F59E0B', bg: '#FFFFFF', text: '#111827' }, typography: { heading: 'Arial' }, voice: { tone: 'plain' }, footer_blocks: { legal: 'x' } };
    const r = await call('brandkit', { json: good });
    expect(r.out.ok).toBe(true);
    expect(r.out.brand_kit).toMatchObject({ id: H.WS, workspace_id: H.WS, palette: good.palette, footer_blocks: { legal: 'x' }, guide_pdf_url: null });
    expect(kit[0].url).toContain('on_conflict=workspace_id'); expect(kit[0].headers.prefer).toMatch(/merge-duplicates/);
    expect((await call('brand-kit', { json: { palette: { primary: 'red', accent: '#F59E0B', bg: '#FFFFFF', text: '#111827' }, typography: {}, voice: {} } })).status).toBe(400);
    expect((await call('brand-kit', { json: { palette: good.palette } })).status).toBe(400);
    expect(kit.length).toBe(1);
  });
  test('an unattributed request gets NOTHING with no kit; DELETE is a 405', async () => {
    const kit = table('lifecycle_brand_kit', [{ id: 'leak' }]);
    const r = await call('brand-kit', { method: 'GET', auth: 'none', origin: true });
    expect(r.out).toMatchObject(Object.assign({ brand_kit: null, brands: [] }, NOTHING));
    expect(kit).toEqual([]);
    expect((await call('brand-kit', { method: 'DELETE' })).status).toBe(405);
  });
});

/* ── the router itself ──────────────────────────────────────────────────── */

test.describe('the router', () => {
  test('OPTIONS is a 204 with the CORS headers including Authorization (or the session never arrives)', async () => {
    const o = await H.request(srv.port, { method: 'OPTIONS', path: '/api/kb?action=list' });
    expect(o.status).toBe(204);
    expect(o.headers['access-control-allow-origin']).toBe('*');
    expect(o.headers['access-control-allow-headers']).toMatch(/Authorization/);
    expect(o.headers['access-control-allow-methods']).toContain('DELETE');
    expect(guard.calls).toEqual([]);
  });
  test('an unknown action is the router\'s own 400', async () => {
    const r = await call('no-such-action', { method: 'GET' });
    expect(r.status).toBe(400);
    expect(r.out.error).toMatch(/Unknown action/);
  });
  test('with no store configured every action is a 500 that says which variable is missing', async () => {
    const undo = H.pinEnv({ SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_URL: undefined });
    try {
      const r = await call('list', { method: 'GET' });
      expect(r.status).toBe(500);
      expect(r.out.error).toMatch(/SUPABASE_URL/);
      expect(guard.calls).toEqual([]);
    } finally { undo(); }
  });
  test('every action the router dispatches has a test here, and the enumeration is not trivial', () => {
    const code = H.routerCode(KB);
    const enumerated = H.uniqSorted([...code.matchAll(/\baction === '([a-z-]+)'/g)].map((m) => m[1]));
    expect(enumerated.length).toBeGreaterThanOrEqual(12);
    const tested = H.uniqSorted(['ingest', 'ingest-files', 'ingest-site', 'list', 'top-emails', 'topemails', 'brands', 'classify-emails', 'classify', 'digest', 'daily-digest', 'brand-kit', 'brandkit']);
    expect(enumerated.filter((a) => !tested.includes(a)), 'actions the router dispatches with no test').toEqual([]);
    expect(tested.filter((a) => !enumerated.includes(a)), 'tests for actions the router no longer has').toEqual([]);
  });
});
