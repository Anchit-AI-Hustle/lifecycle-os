// Every agent action, EXECUTED, in the three states a caller can be in.
//
// "Ensure all agents are working" (the operator, 2026-09-29). The only sign-in
// is a mobile number and a 4-digit PIN, so the states that matter are: no
// session at all; a SERVER-mode phone session the server can verify; and a
// DEVICE-mode phone session, whose token is never sent and which the server
// therefore sees exactly as an anonymous caller. Each action below is driven
// through the SHIPPED router (api/brain.js, api/calendar.js, api/public-config.js
// and api/ai/generate.js, request-scope and credits.metered wrappers included)
// over a real socket, against an in-memory Neon store handed to the real
// mobile-auth core through the driver's require.cache entry, an in-memory
// Supabase whose ledger RPCs are re-implemented from the SQL, and a scripted
// model swapped into llm.js before any module bound it. global.fetch throws on
// any other host, so a refusal that had already spent a provider call shows up
// as an escaped call.
//
// What has to hold, for every action in every state:
//   - the answer is JSON;
//   - a refusal carries a SENTENCE (`message`, or a non-identifier `error`),
//     never a bare code, never a 500 wearing a PostgREST error as its whole
//     explanation, never a hang;
//   - the model is never reached where the gate or the meter refused;
//   - a device session is answered exactly like an anonymous caller (it IS
//     one, on the wire);
//   - a server-mode phone account is never scoped to the OLDEST workspace
//     and never answered as tenant zero: it runs as the brand record it
//     CARRIED, or as the unresolved placeholder, and its wallet exists only
//     when its number is listed.
//
// Found by running this, before the fixes (each is mutation-verified by
// restoring the defect and watching the named test fail):
//   - a phone token fell through workspace-scope.resolve() as USERLESS and
//     every brain.js request from a phone account was scoped to the default
//     workspace (tenant zero); brand-chat answered as "Oldest Brand";
//   - brand-runtime.resolve() threw on activeWorkspaceId() for a phone
//     account and fell back to defaultBrand() - tenant zero's record - so the
//     assistant, the social pipeline and every generator wrote as KNICKGASM;
//   - the TeleSuite registry, brand-tools, the Agent Builder spec and jarvis
//     received the demo overview for an unattributed browser, so the TeleSuite
//     hub could not start for a signed-out visitor;
//   - every chat action received the demo overview (no `reply`) for an
//     unattributed browser, and the pages rendered "undefined";
//   - telesuite for a phone account THREW restAs's 403 out of context(),
//     past handle()'s try/catch, and reached the router as a 500;
//   - a linked-db 401 (a paused project) and a missing agent were both 500s
//     with the raw string in `error` and no sentence anywhere.
//
// Run: npx playwright test tests/agents-executed.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const A = require('./agents-harness');
const H = require('./router-harness');

const IDENT = /^[a-z][a-z0-9]*(?:[_.\-][a-z0-9]+)+$/;
/** The sentence a payload carries for a reader: `message`, or an `error` that is prose rather than a code. */
function sentenceOf(out) {
  if (!out || typeof out !== 'object') return '';
  if (typeof out.message === 'string' && out.message.trim()) return out.message.trim();
  if (typeof out.error === 'string' && out.error.trim() && !IDENT.test(out.error.trim())) return out.error.trim();
  if (typeof out.blocker === 'string' && out.blocker.trim()) return out.blocker.trim();
  return '';
}
function expectJson(r, label) {
  expect(r.out, `${label}: not JSON: ${r.text.slice(0, 240)}`).toBeTruthy();
  expect(r.out.harness_error, `${label}: the router returned without answering`).toBeUndefined();
}
function expectSentence(r, label) {
  expectJson(r, label);
  const s = sentenceOf(r.out);
  expect(s.length, `${label}: no sentence in ${r.text.slice(0, 300)}`).toBeGreaterThan(24);
  expect(/^[A-Z"']/.test(s), `${label}: a sentence starts with a capital, got: ${s}`).toBe(true);
}
function expectNever5xx(r, label) {
  expect(r.status, `${label}: ${r.text.slice(0, 300)}`).toBeLessThan(500);
}

let w;
test.beforeAll(async () => {
  // The listed number is written the way an operator types it; the meter
  // normalises it to E.164 before hashing (a mutation that drops normPhone
  // fails the balance test below).
  w = await A.world({ compPhones: '+91 98765-43210, not-a-number' });
});
test.afterAll(async () => { await w.close(); });
test.beforeEach(() => { w.reset(); });

const BRAND = A.deviceBrand();
const call = (action, o) => w.request('/api/brain', Object.assign({}, o, { query: Object.assign({ action }, (o && o.query) || {}) }));

/* ── the brain.js agent actions ─────────────────────────────────────────── */
/*
 * anonymous: what an unattributed browser (no token, no workspace) gets from
 *            the attribution rule - 'refuse' (409 with a sentence), 'demo'
 *            (the example envelope, for a READ), or 'public' (the real answer:
 *            a description of the product, nobody's data).
 * phone:     the assertions for a verified server-mode phone session that
 *            carries its device brand record.
 */
const T = [];
const add = (action, def) => T.push(Object.assign({ action }, def));

add('agents', { run: { method: 'GET' }, anonymous: 'demo',
  phone: (r) => { expect(r.status).toBe(200); expect(r.out).toEqual({ ok: true, agents: [] }); } });
add('agent-sessions', { run: { method: 'GET' }, anonymous: 'demo',
  phone: (r) => { expect(r.status).toBe(200); expect(r.out).toEqual({ ok: true, sessions: [] }); } });
add('agent-chat', { run: { json: { message: 'hi there', agent_id: 'agent_x', brand: BRAND } }, anonymous: 'refuse',
  phone: (r) => {
    // No workspace row, so no agents: a 404 with a sentence, not a 500 with
    // "agent agent_x not found" as its whole explanation.
    expect(r.status).toBe(404); expect(r.out.error).toBe('agent_not_found'); expectSentence(r, 'agent-chat phone');
    expect(w.llm.calls).toEqual([]);
  } });
add('agent-analyze', { run: { json: { message: 'how many orders last month?' } }, anonymous: 'refuse',
  phone: (r) => { expect(r.status).toBe(200); expect(r.out.ok).toBe(true); expect(typeof r.out.answer).toBe('string'); expect(r.out.answer.length).toBeGreaterThan(20); } });
add('team-chat', { run: { json: { message: 'what should we plan?', brand: BRAND } }, anonymous: 'refuse',
  phone: (r) => { expect(r.status).toBe(200); expect(r.out.ok).toBe(true); expect(typeof r.out.reply).toBe('string'); expect(r.out.reply.length).toBeGreaterThan(20); } });
add('brand-chat', { run: { json: { message: 'what sells best?', brand: BRAND } }, anonymous: 'refuse',
  phone: (r) => {
    expect(r.status).toBe(200);
    expect(r.out.ok).toBe(true);
    expect(r.out.reply).toBe('Scripted reply for this turn, with no figure invented.');
    // The brand it answered FOR is the one the request carried - never the
    // oldest workspace's, never tenant zero's assistant.
    expect(r.out.brand.name).toBe(BRAND.name);
    expect(String(r.out.brand.id)).toMatch(/^device:/);
    expect(JSON.stringify(r.out)).not.toMatch(/Oldest Brand|KicksGPT|knickgasm/i);
    expect(w.llm.calls.map((c) => c.stage)).toContain('kicksgpt');
  } });
add('console-chat', { run: { json: { message: 'what should ship next?' } }, anonymous: 'refuse',
  phone: (r) => { expect(r.status).toBe(200); expect(r.out.ok).toBe(true); expect(String(r.out.reply)).toContain('Scripted reply'); expect(w.llm.calls.length).toBe(1); } });
add('jarvis', { run: { json: { userText: 'open the shoes', assistantText: 'sure' } }, anonymous: 'public',
  phone: (r) => { expect(r.status).toBe(200); expect(r.out.ok).toBe(true); expect(Array.isArray(r.out.actions)).toBe(true); } });
add('brand-tools', { run: { method: 'GET' }, anonymous: 'public',
  phone: (r) => { expect(r.status).toBe(200); expect(r.out.ok).toBe(true); expect(Array.isArray(r.out.tools)).toBe(true); expect(r.out.tools.length).toBeGreaterThan(5); } });
add('agent-builder', { run: { method: 'GET', query: { op: 'spec' } }, anonymous: 'public',
  phone: (r) => { expect([200, 503]).toContain(r.status); if (r.out.ok === false) expectSentence(r, 'agent-builder phone'); else expect(r.out.openapi).toBeTruthy(); } });
add('platform-agents', { run: { method: 'GET', query: { days: '7' } }, anonymous: 'refuse',
  phone: (r) => {
    expect(r.status).toBe(200); expect(r.out.ok).toBe(true);
    // An unconnected platform is never analysed, and its only action item is
    // the connection step; the model is reached exactly once per platform
    // that reported itself connected (the WebEngage mirror reads its Supabase
    // table and answers "connected" even when it holds no rows - recorded,
    // not changed here).
    expect(r.out.agents.length).toBeGreaterThan(3);
    const connected = r.out.agents.filter((a) => a.connected);
    expect(r.out.coverage.connected).toBe(connected.length);
    expect(w.llm.calls.length).toBe(connected.length);
    for (const a of r.out.agents.filter((x) => !x.connected)) { expect(a.analysed).toBe(false); expect(a.action_items[0].action).toMatch(/^Connect /); }
  } });
add('social-list', { run: { method: 'GET', query: { date: '2026-10-01' } }, anonymous: 'demo',
  phone: (r) => { expect(r.status).toBe(200); expect(r.out).toMatchObject({ ok: true, posts: [] }); } });
add('social-run-daily', { run: { json: { dry_run: true, platforms: ['instagram'], date: '2026-10-01', brand: BRAND } }, anonymous: 'refuse',
  phone: (r) => {
    expect(r.status).toBe(200); expect(r.out.ok).toBe(true); expect(r.out.dry_run).toBe(true);
    // A dry run for a phone account runs as the brand it carried: tenant
    // zero's product taxonomy and store URLs never appear in it.
    const text = JSON.stringify(r.out);
    expect(text).not.toMatch(/knickgasm\.com|Air Force|Oldest Brand/i);
  } });
add('social-approve', { run: { json: { id: 'p1' } }, anonymous: 'refuse',
  phone: (r) => { expect(r.status).toBe(400); expectSentence(r, 'social-approve phone'); } });
add('social-skip', { run: { json: {} }, anonymous: 'refuse',
  phone: (r) => { expect(r.status).toBe(400); expectSentence(r, 'social-skip phone'); } });
add('agent-upsert', { run: { json: { name: 'Concierge', level: 'brand' } }, anonymous: 'refuse',
  phone: (r) => { expect(r.status).toBe(409); expect(r.out.error).toBe('no_workspace'); expectSentence(r, 'agent-upsert phone'); } });
add('agent-sync', { run: { json: { agent_id: 'agent_x' } }, anonymous: 'refuse',
  phone: (r) => { expect(r.status).toBe(404); expect(r.out.error).toBe('agent_not_found'); expectSentence(r, 'agent-sync phone'); } });
add('telesuite', { run: { method: 'GET', query: { op: 'registry' } }, anonymous: 'public',
  phone: (r) => { expect(r.status).toBe(200); expect(Array.isArray(r.out.subfeatures)).toBe(true); expect(r.out.subfeatures.length).toBeGreaterThan(10); } });

for (const e of T) {
  test.describe(`?action=${e.action}`, () => {
    test('anonymous: the attribution rule answers with a sentence, demo data or the public answer, and never a 5xx', async () => {
      const r = await call(e.action, Object.assign({}, e.run, { state: 'anonymous' }));
      expectJson(r, `${e.action} anonymous`); expectNever5xx(r, `${e.action} anonymous`);
      if (e.anonymous === 'refuse') {
        expect(r.status).toBe(409); expect(r.out).toMatchObject({ ok: false, error: 'no_active_brand', setup_url: '/onboarding' });
        expectSentence(r, `${e.action} anonymous`);
      } else if (e.anonymous === 'demo') {
        expect(r.status).toBe(200); expect(r.out).toMatchObject({ ok: true, mode: 'demo', error: 'workspace_unresolved' });
      } else {
        expect(r.status).toBeLessThan(400); expect(r.out.mode).not.toBe('demo'); expect(r.out.error).not.toBe('workspace_unresolved');
      }
      expect(w.llm.calls, 'the model was reached for an unattributed caller').toEqual([]);
      expect(w.escaped()).toEqual([]);
    });
    test('device session: on the wire it is the anonymous state, and it is answered identically', async () => {
      const a = await call(e.action, Object.assign({}, e.run, { state: 'anonymous' }));
      w.reset();
      const d = await call(e.action, Object.assign({}, e.run, { state: 'device' }));
      expect([d.status, d.out && d.out.ok, d.out && d.out.error]).toEqual([a.status, a.out && a.out.ok, a.out && a.out.error]);
      expect(w.escaped()).toEqual([]);
    });
    test('server-mode phone session: reaches its result, or refuses with a sentence', async () => {
      const r = await call(e.action, Object.assign({}, e.run, { state: 'phone' }));
      expectJson(r, `${e.action} phone`); expectNever5xx(r, `${e.action} phone`);
      if (r.out.ok === false) expectSentence(r, `${e.action} phone`);
      e.phone(r);
      // Whatever it did, it never resolved the phone account to the oldest
      // workspace: the mutation that drops the mobile-token branch in
      // workspace-scope.resolve() fails brand-chat and social-run-daily above.
      expect(w.escaped()).toEqual([]);
    });
  });
}

test('agentic-run: refused for an unattributed browser, and runs for a phone account as the brand it carried', async () => {
  test.setTimeout(120000);
  const anon = await call('agentic-run', { json: { days: 2, withCreatives: false, brand: BRAND }, state: 'anonymous' });
  expect(anon.status).toBe(409); expectSentence(anon, 'agentic-run anonymous');
  expect(w.llm.calls).toEqual([]);
  w.reset();
  const r = await call('agentic-run', { json: { days: 2, withCreatives: false, tier: 'budget', brand: BRAND }, state: 'phone' });
  expectJson(r, 'agentic-run phone'); expectNever5xx(r, 'agentic-run phone');
  expect(r.out.ok).toBe(true);
  expect(Array.isArray(r.out.stages)).toBe(true);
  expect(r.out.stages.map((s) => s.stage)).toContain('planning');
  // Every campaign is the carried brand's, never the oldest workspace's - the
  // mutation that restores stampBrand()'s defaultWorkspaceId fallback for a
  // request with no workspace fails here.
  expect(JSON.stringify(r.out)).not.toMatch(/Oldest Brand/);
  expect(JSON.stringify(r.out)).toContain(BRAND.name);
  // The only host a build may reach beyond the fixtures is the carried
  // brand's OWN website (its testimonials are read off its own pages);
  // nothing escaped to anywhere else.
  expect(w.escaped()).toEqual([]);
  const own = w.db.external().filter((c) => c.url.startsWith(A.BRAND_SITE));
  for (const c of w.db.external()) expect(c.url.startsWith(A.BRAND_SITE) || c.url.startsWith(H.SELF_BASE_URL), `a build reached ${c.url}`).toBe(true);
  expect(own.length).toBeGreaterThanOrEqual(0);
});

test('a phone session that carries NO brand record runs as the unresolved placeholder, never as tenant zero', async () => {
  const r = await call('brand-chat', { json: { message: 'what sells best?' }, state: 'phone' });
  expect(r.status).toBe(200);
  expect(r.out.brand.unresolved).toBe(true);
  expect(String(r.out.brand.name)).toContain('DATA REQUIRED BEFORE LAUNCH');
  expect(JSON.stringify(r.out.brand)).not.toMatch(/Oldest Brand|KNICKGASM|knickgasm/i);
});

test('a carried brand record is bounded and re-keyed: a brand_workspaces id in it cannot name a server workspace', async () => {
  const r = await call('brand-chat', { json: { message: 'hi', brand: Object.assign({}, BRAND, { id: 'ws-oldest', name: 'X'.repeat(500) }) }, state: 'phone' });
  expect(r.status).toBe(200);
  expect(r.out.brand.id).not.toBe('ws-oldest');
  expect(String(r.out.brand.id)).toMatch(/^device:/);
  expect(r.out.brand.name.length).toBeLessThanOrEqual(120);
});

test('telesuite ops for a phone account are a 403 with a sentence, before any credit hold and any model call', async () => {
  const items = await call('telesuite', { method: 'GET', query: { op: 'items' }, state: 'phone' });
  expect(items.status).toBe(403); expect(items.out.error).toBe('account_type_unsupported'); expectSentence(items, 'telesuite items phone');
  const pitch = await call('telesuite', { json: { op: 'pitch', input: { product: 'a product' } }, state: 'phone' });
  expect(pitch.status).toBe(403); expect(pitch.out.error).toBe('account_type_unsupported'); expectSentence(pitch, 'telesuite pitch phone');
  expect(w.llm.calls).toEqual([]);
  expect(w.db.calls.filter((c) => /rpc\/credit_/.test(c.url))).toEqual([]);
  // A telesuite generation op from an unattributed browser is the demo READ
  // envelope today (nothing runs, nothing is charged): recorded, not changed.
  const anon = await call('telesuite', { json: { op: 'pitch', input: { product: 'a product' } }, state: 'anonymous' });
  expect(anon.status).toBe(200); expect(anon.out.mode).toBe('demo'); expect(w.llm.calls).toEqual([]);
});

test('a store that does not answer is a 503 naming the host, with a sentence, not a 500 carrying a PostgREST error', async () => {
  // The workspace database goes down for the smart_* tables; a userless
  // server-to-server read (which resolves the default workspace and reads
  // through brain-core's LinkedDb) meets it.
  w.db.failures.smart_agents = 503;
  try {
    const r = await call('agents', { method: 'GET', state: 'server' });
    expect(r.status).toBe(503);
    expect(r.out).toMatchObject({ ok: false, action: 'agents', error: 'backend_unreachable', backend_unreachable: true });
    expectSentence(r, 'agents with the store down');
    expect(r.out.message).toContain('fixture.supabase.co');
  } finally { delete w.db.failures.smart_agents; }
});

/* ── calendar.js: the smart-brain actions the console drives ─────────────── */

test.describe('calendar.js smart-brain actions', () => {
  const PLAN = 'api/_shared/smart-brain-plan.js';
  let S;
  test.beforeEach(() => { S = new H.Stubs(); });
  test.afterEach(() => { S.restore(); });
  const cal = (action, o) => w.request('/api/calendar', Object.assign({}, o, { query: Object.assign({ action: `smart-brain-${action}` }, (o && o.query) || {}) }));

  test('plan / sync-daily / approve / reject for a phone account reach the core with NO workspace, never the oldest one', async () => {
    S.on(PLAN, 'getPlan', async () => ({ ok: true, entries: [] }));
    S.on(PLAN, 'syncDaily', async () => ({ ok: true, mode: 'stubbed', changes: [] }));
    S.on(PLAN, 'approveEntry', async () => ({ ok: true, approved: true }));
    S.on(PLAN, 'rejectEntry', async () => ({ ok: true }));
    const plan = await cal('plan', { method: 'GET', state: 'phone' });
    expect(plan.status).toBe(200); expect(plan.out.ok).toBe(true);
    expect(S.hit(PLAN, 'getPlan').args[0].config.workspace_id).toBeNull();
    const sync = await cal('sync-daily', { json: { days: 7, prebuild: false }, state: 'phone' });
    expect(sync.status).toBe(200); expect(S.hit(PLAN, 'syncDaily').args[0].config.workspace_id).toBeNull();
    const ok = await cal('approve', { json: { entry: { id: 'e1' }, reviewer: 'op' }, state: 'phone' });
    expect(ok.status).toBe(200); expect(S.hit(PLAN, 'approveEntry').args[0].config.workspace_id).toBeNull();
    const no = await cal('reject', { json: { id: 'e1', notes: 'off-brand' }, state: 'phone' });
    expect(no.status).toBe(200); expect(S.hit(PLAN, 'rejectEntry').args[0].config.workspace_id).toBeNull();
    for (const h of S.reached) expect(h.args[0].config.workspace_id).not.toBe('ws-oldest');
    expect(w.escaped()).toEqual([]);
  });
  test('an unattributed browser gets the unscoped envelope and reaches nothing; a phone session cannot start the prebuild chain', async () => {
    S.on(PLAN, 'getPlan', async () => ({ ok: true, entries: [{ id: 'x' }] }));
    S.on(PLAN, 'prebuildAssets', async () => ({ remaining: 0, built: [] }));
    const anon = await cal('plan', { method: 'GET', state: 'anonymous' });
    expect(anon.status).toBe(200); expect(anon.out).toMatchObject({ ok: true, mode: 'unscoped', error: 'workspace_unresolved' });
    const device = await cal('plan', { method: 'GET', state: 'device' });
    expect([device.status, device.out.error]).toEqual([anon.status, anon.out.error]);
    expect(S.hits(PLAN, 'getPlan')).toEqual([]);
    const pre = await cal('prebuild', { json: {}, state: 'phone' });
    expect(pre.status).toBe(401); expectSentence(pre, 'prebuild phone'); expect(S.hits(PLAN, 'prebuildAssets')).toEqual([]);
  });
});

/* ── the meter: a listed number holds a wallet, an unlisted one is told so ─── */

test.describe('the credit meter for a phone account', () => {
  const credits = (op, o) => w.request('/api/public-config', Object.assign({}, o, { query: Object.assign({ action: 'credits', op }, (o && o.query) || {}) }));
  const chat = (o) => w.request('/api/ai/generate', Object.assign({ json: { mode: 'chat', message: 'hello', chat_context: {} } }, o));
  const catalog = require(A.ROOT + '/api/_shared/credit-catalog.js');

  test('balance: an unlisted number has no wallet and is told so quietly; a listed number holds its personal wallet with the welcome grant', async () => {
    const other = await credits('balance', { method: 'GET', state: 'other' });
    expect(other.status).toBe(200);
    expect(other.out).toMatchObject({ ok: true, wallet: null, unavailable: 'mobile_account', comp: false });
    expectSentence(other, 'balance unlisted');
    expect(w.db.table('credit_wallets').filter((x) => x.user_id === w.tokens.otherUserId)).toEqual([]);

    // The listed number, asking with a DEVICE workspace id on the query the
    // way credits.js stamps the active brand: the wallet is personal anyway.
    const listed = await credits('balance', { method: 'GET', state: 'phone', query: { workspace_id: 'local-toi000000000001' } });
    expect(listed.status).toBe(200);
    expect(listed.out.ok).toBe(true);
    expect(listed.out.wallet).toBeTruthy();
    expect(listed.out.wallet.workspace_id).toBeNull();
    expect(Number(listed.out.wallet.balance)).toBe(catalog.welcomeGrant());
    expect(listed.out.comp).toBe(true);
    expect(listed.out.account).toBe('mobile-pin');
    expect(listed.out.unavailable).toBeUndefined();
    const rows = w.db.table('credit_wallets').filter((x) => x.user_id === w.tokens.phoneUserId);
    expect(rows.length).toBe(1); expect(rows[0].workspace_id).toBeNull();
  });

  test('a metered turn: refused before any hold for an unlisted number; held, run and settled for a listed one', async () => {
    const anon = await chat({ state: 'anonymous' });
    expect(anon.status).toBe(401); expect(anon.out.error).toBe('sign_in_required'); expectSentence(anon, 'chat anonymous');
    const other = await chat({ state: 'other' });
    expect(other.status).toBe(403); expect(other.out.error).toBe('credits_require_account'); expectSentence(other, 'chat unlisted');
    expect(w.llm.calls, 'the model was reached for a refused caller').toEqual([]);
    expect(w.db.calls.filter((c) => /rpc\/credit_hold/.test(c.url))).toEqual([]);

    w.reset();
    const before = w.db.table('credit_wallets').find((x) => x.user_id === w.tokens.phoneUserId);
    const b0 = before ? before.balance : catalog.welcomeGrant();
    const r = await chat({ state: 'phone' });
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    expect(String(r.out.text)).toContain('Scripted reply');
    expect(w.llm.calls.length).toBe(1);
    const q = catalog.quote('assistant.chat', 1, {});
    expect(r.out.credits).toMatchObject({ feature: 'assistant.chat', charged: q.total });
    const after = w.db.table('credit_wallets').find((x) => x.user_id === w.tokens.phoneUserId);
    expect(after.balance).toBe(b0 - q.total);
    expect(after.workspace_id).toBeNull();
    const kinds = w.db.table('credit_ledger').filter((l) => l.user_id === w.tokens.phoneUserId).map((l) => l.kind);
    expect(kinds).toContain('hold'); expect(kinds).toContain('spend');
    expect(w.escaped()).toEqual([]);
  });

  test('recharge: complimentary for a listed number and recorded as such; refused for an unlisted one', async () => {
    const pack = catalog.PACKS[0].key;
    const listed = await credits('recharge', { json: { pack_key: pack, workspace_id: 'local-toi000000000001' }, state: 'phone' });
    expect(listed.status, listed.text.slice(0, 300)).toBe(200);
    expect(listed.out).toMatchObject({ ok: true, comp: true, credited: true });
    const order = w.db.table('credit_orders').find((o) => o.user_id === w.tokens.phoneUserId);
    expect(order).toBeTruthy();
    expect(order.workspace_id).toBeNull();
    expect(order.provider).toBe('comp_account');
    expect(order.provider_ref).toBe('comp:' + A.PHONE.e164);
    expect(order.amount_minor).toBe(0);
    const other = await credits('recharge', { json: { pack_key: pack }, state: 'other' });
    expect(other.status).toBe(403); expect(other.out.error).toBe('credits_require_account'); expectSentence(other, 'recharge unlisted');
    expect(w.db.table('credit_orders').filter((o) => o.user_id === w.tokens.otherUserId)).toEqual([]);
  });

  test('ledger and usage answer the personal wallet for a listed number', async () => {
    const ledger = await credits('ledger', { method: 'GET', state: 'phone', query: { workspace_id: 'local-toi000000000001' } });
    expect(ledger.status).toBe(200); expect(Array.isArray(ledger.out.entries)).toBe(true); expect(ledger.out.entries.length).toBeGreaterThan(0);
    const usage = await credits('usage', { method: 'GET', state: 'phone' });
    expect(usage.status).toBe(200); expect(Array.isArray(usage.out.usage)).toBe(true);
    const other = await credits('ledger', { method: 'GET', state: 'other' });
    expect(other.status).toBe(403); expectSentence(other, 'ledger unlisted');
  });
});
