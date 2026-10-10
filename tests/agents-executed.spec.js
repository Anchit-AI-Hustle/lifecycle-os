// Every agent action, EXECUTED, in the states a caller can be in.
//
// ── 2026-10-10: GOOGLE IS THE ONLY SIGN-IN ──────────────────────────────────
// The owner's words: "No signin with mobile number - only Google signin pls".
// The mobile number + PIN sign-in is switched OFF, so this file's claim about
// it is INVERTED: a server-mode phone session - one that is LIVE in the Neon
// app_sessions table this world holds - and a device-mode token are both
// answered EXACTLY like an anonymous caller, for every action, and reach no
// model and no store. What a phone session used to reach (its carried brand,
// its device-kept agents, TeleSuite's device store, a listed number's wallet,
// the signed voice-session rows) is unreachable now, so those tests are
// retired here, each named below with its reason:
//   - "a phone session that carries NO brand record runs as the unresolved
//     placeholder" and "a carried brand record is bounded and re-keyed":
//     brand-runtime only takes a carried record for a phone principal, and
//     none exists; a carried record from anyone else is ignored.
//   - "telesuite for a phone account runs over what the request carries" and
//     the three "telesuite voice" tests: the device store and its signed
//     voice-session rows exist only for a phone principal.
//   - "the credit meter for a phone account": replaced by the test that a
//     LISTED number (CREDITS_COMP_PHONES) is refused like anonymous and no
//     wallet, grant or order is created for it - the list is moot.
// The Google path (a Supabase session) is executed per action in
// tests/router-brain.spec.js and tests/router-calendar.spec.js.
//
// The history of this file, unchanged:
//
// "Ensure all agents are working" (the operator, 2026-09-29). The only sign-in
// is a mobile number and a 4-digit PIN, so the states that matter are: no
// session at all; a SERVER-mode phone session the server can verify; and a
// DEVICE-mode phone session. With a database the device token is not in
// app_sessions and is anonymous on the wire; without DATABASE_URL the page
// sends the token and the server admits it as a device principal (2026-09-30).
// Each action below is driven
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

add('agents', { run: { method: 'GET' }, anonymous: 'demo' });

add('agent-sessions', { run: { method: 'GET' }, anonymous: 'demo' });

add('agent-chat', { run: { json: { message: 'hi there', agent_id: 'agent_x', brand: BRAND } }, anonymous: 'refuse' });

add('agent-analyze', { run: { json: { message: 'how many orders last month?' } }, anonymous: 'refuse' });

add('team-chat', { run: { json: { message: 'what should we plan?', brand: BRAND } }, anonymous: 'refuse' });

add('brand-chat', { run: { json: { message: 'what sells best?', brand: BRAND } }, anonymous: 'refuse' });

add('console-chat', { run: { json: { message: 'what should ship next?' } }, anonymous: 'refuse' });

add('jarvis', { run: { json: { userText: 'open the shoes', assistantText: 'sure' } }, anonymous: 'public' });

add('brand-tools', { run: { method: 'GET' }, anonymous: 'public' });

add('agent-builder', { run: { method: 'GET', query: { op: 'spec' } }, anonymous: 'public' });

add('platform-agents', { run: { method: 'GET', query: { days: '7' } }, anonymous: 'refuse' });

add('revenue-os', { run: { method: 'GET', query: { days: '7' } }, anonymous: 'refuse' });

add('social-list', { run: { method: 'GET', query: { date: '2026-10-01' } }, anonymous: 'demo' });

add('social-run-daily', { run: { json: { dry_run: true, platforms: ['instagram'], date: '2026-10-01', brand: BRAND } }, anonymous: 'refuse' });

add('social-approve', { run: { json: { id: 'p1' } }, anonymous: 'refuse' });

add('social-skip', { run: { json: {} }, anonymous: 'refuse' });

add('agent-upsert', { run: { json: { name: 'Concierge', level: 'brand' } }, anonymous: 'refuse' });

add('agent-sync', { run: { json: { agent_id: 'agent_x' } }, anonymous: 'refuse' });

add('telesuite', { run: { method: 'GET', query: { op: 'registry' } }, anonymous: 'public' });
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
    test('a mobile-number session is no credential: a LIVE server-mode one is answered exactly as a forged bearer, a device-mode one (never sent) as anonymous', async () => {
      // A credential the backend REJECTS is answered with that rejection
      // (brain.js's attribution rule, 2026-09-29): the same 401 a forged or
      // expired JWT gets, or the public answer for nobody. Since 2026-10-10 a
      // phone token - even one that is live in app_sessions - is exactly that.
      const pairs = [['phone', { state: 'phone' }, { state: 'anonymous', headers: { authorization: 'Bearer ' + H.FORGED } }], ['device', { state: 'device' }, { state: 'anonymous' }]];
      for (const [label, mine, like] of pairs) {
        w.reset();
        const ref = await call(e.action, Object.assign({}, e.run, like));
        w.reset();
        const r = await call(e.action, Object.assign({}, e.run, mine));
        expectJson(r, `${e.action} ${label}`); expectNever5xx(r, `${e.action} ${label}`);
        // The status and the verdict are the same; the code differs only in
        // naming WHICH credential was rejected (an expired JWT is
        // invalid_session, a phone token sign_in_required with the Google sentence).
        expect([r.status, r.out && r.out.ok], `${e.action} ${label} was not answered as ${like.headers ? 'a forged bearer' : 'anonymous'}`)
          .toEqual([ref.status, ref.out && ref.out.ok]);
        if (like.headers && r.status === 401) { expect(r.out.error).toBe('sign_in_required'); expect(r.out.message).toMatch(/Google/); }
        else expect(r.out && r.out.error).toBe(ref.out && ref.out.error);
        if (r.out && r.out.ok === false) expectSentence(r, `${e.action} ${label}`);
        expect(w.llm.calls, `${e.action} ${label} reached the model`).toEqual([]);
        expect(w.db.calls.filter((c) => /rpc\/credit_/.test(c.url)), `${e.action} ${label} touched the ledger`).toEqual([]);
        expect(w.escaped()).toEqual([]);
      }
    });
  });
}

test('agentic-run: refused for an unattributed browser, and for a mobile-number session as a rejected credential', async () => {
  test.setTimeout(120000);
  const anon = await call('agentic-run', { json: { days: 2, withCreatives: false, brand: BRAND }, state: 'anonymous' });
  expect(anon.status).toBe(409); expectSentence(anon, 'agentic-run anonymous');
  expect(w.llm.calls).toEqual([]);
  w.reset();
  const r = await call('agentic-run', { json: { days: 2, withCreatives: false, tier: 'budget', brand: BRAND }, state: 'phone' });
  expectJson(r, 'agentic-run phone'); expectNever5xx(r, 'agentic-run phone');
  expect([r.status, r.out.ok, r.out.error]).toEqual([401, false, 'sign_in_required']);
  expectSentence(r, 'agentic-run phone');
  expect(r.out.message).toMatch(/Google/);
  expect(w.llm.calls).toEqual([]);
  expect(JSON.stringify(r.out)).not.toMatch(/Oldest Brand/);
  expect(w.escaped()).toEqual([]);
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

  test('plan / sync-daily / approve / reject for a mobile-number session are answered as a forged bearer and reach no core', async () => {
    S.on(PLAN, 'getPlan', async () => ({ ok: true, entries: [] }));
    S.on(PLAN, 'syncDaily', async () => ({ ok: true, mode: 'stubbed', changes: [] }));
    S.on(PLAN, 'approveEntry', async () => ({ ok: true, approved: true }));
    S.on(PLAN, 'previewEntry', async () => ({ ok: true, preview: true, campaign: { campaign_id: 'c1' } }));
    S.on(PLAN, 'rejectEntry', async () => ({ ok: true }));
    const runs = [['plan', { method: 'GET' }], ['sync-daily', { json: { days: 7 } }], ['approve', { json: { entry: { id: 'e1' }, reviewer: 'op' } }], ['reject', { json: { id: 'e1', notes: 'off-brand' } }]];
    for (const [action, o] of runs) {
      const forged = await cal(action, Object.assign({ state: 'anonymous', headers: { authorization: 'Bearer ' + H.FORGED } }, o));
      const phone = await cal(action, Object.assign({ state: 'phone' }, o));
      expect([phone.status, phone.out && phone.out.ok], action + ': a phone session was not answered as a forged bearer').toEqual([forged.status, forged.out && forged.out.ok]);
      expect(phone.status, action).toBeGreaterThanOrEqual(400);
    }
    for (const h of S.reached) expect(h.args[0].config.workspace_id, 'a phone session reached the planner as a workspace').toBeFalsy();
    expect(S.hits(PLAN, 'approveEntry')).toEqual([]);
    expect(S.hits(PLAN, 'rejectEntry')).toEqual([]);
    expect(w.llm.calls).toEqual([]);
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

/* ── the meter: a LISTED number is refused like anonymous (2026-10-10) ───── */

test.describe('the credit meter for a mobile-number session', () => {
  const credits = (op, o) => w.request('/api/public-config', Object.assign({}, o, { query: Object.assign({ action: 'credits', op }, (o && o.query) || {}) }));
  const chat = (o) => w.request('/api/ai/generate', Object.assign({ json: { mode: 'chat', message: 'hello', chat_context: {} } }, o));
  const catalog = require(A.ROOT + '/api/_shared/credit-catalog.js');

  test('a number on CREDITS_COMP_PHONES holds no wallet: balance, a metered turn, recharge and ledger are refused like anonymous', async () => {
    // This world lists the phone account's number. Since 2026-10-10 the list
    // is moot: no phone session is a principal, so nothing it sends can open
    // a wallet, take a welcome grant, hold credits or record an order.
    for (const [label, req] of [
      ['balance', () => credits('balance', { method: 'GET', state: 'phone' })],
      ['chat', () => chat({ state: 'phone' })],
      ['recharge', () => credits('recharge', { json: { pack_key: catalog.PACKS[0].key }, state: 'phone' })],
      ['ledger', () => credits('ledger', { method: 'GET', state: 'phone' })],
    ]) {
      w.reset();
      const r = await req();
      expect(r.status, label + ': ' + r.text.slice(0, 300)).toBe(401);
      expect(r.out.error, label).toBe('sign_in_required');
      expectSentence(r, label + ' phone');
    }
    expect(w.llm.calls, 'the model was reached for a phone session').toEqual([]);
    expect(w.db.table('credit_wallets').filter((x) => x.user_id === w.tokens.phoneUserId), 'a wallet was opened for a listed number').toEqual([]);
    expect(w.db.table('credit_ledger').filter((l) => l.user_id === w.tokens.phoneUserId)).toEqual([]);
    expect(w.db.table('credit_orders').filter((o) => o.user_id === w.tokens.phoneUserId)).toEqual([]);
    expect(w.escaped()).toEqual([]);
  });
});
