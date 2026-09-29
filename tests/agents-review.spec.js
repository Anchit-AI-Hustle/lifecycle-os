// The adversarial review of "every agent answers a phone account" (PR #112),
// EXECUTED. That PR merged before it was reviewed; each test below failed
// against it, on the defect it names, before the fix beside it landed.
//
// Everything runs the SHIPPED routers (api/brain.js, api/calendar.js,
// api/ai/generate.js - request-scope and credits.metered wrappers included)
// over a real socket, in the world tests/agents-harness.js builds: an
// in-memory Neon behind the real mobile-auth core, an in-memory Supabase with
// the ledger RPCs re-implemented from the SQL, a scripted llm.js swapped into
// require.cache before anything bound it, and a fetch that throws on any host
// the fixtures do not claim. The oldest workspace in that world is `ws-oldest`
// ("Oldest Brand"): tenant zero, by the rule every scheduler default uses.
//
// What was found, one describe per finding:
//   1. No anonymous shape may reach a model. An anonymous POST with no Origin,
//      any token at all (the attribution rule counted a header's PRESENCE, so
//      a forged bearer or a device-mode token passed), or a caller-named
//      workspace ran KicksGPT, the console, the team copilot, the analyst, the
//      8-stage agentic run (26 model calls and a crawl of tenant zero's site),
//      the social pipeline and a video provider on this deployment's keys.
//   2. An unattributed page and a device token write nothing.
//   3. A phone account never touches another workspace's rows: a
//      caller-named workspace_id was honoured for it, and SmartBrainDbAdapter
//      turned its `null` workspace back into the OLDEST one one layer down.
//   4. A carried record cannot claim to be tenant zero: its slug was the
//      client's, and tenant zero is recognised by slug.
//   5. A carried record is bounded all the way down.
//   6. A public answer for a signed-out page is nobody's: jarvis linked tenant
//      zero's storefront.
//   7. The scheduler's bearer is not a phone token whatever its shape.
//   8. Only a listed number spends: an unlisted phone account ran every brain
//      agent unmetered, and on a deployment with no meter configured it ran
//      generate.js too.
//   9. calendar.js preview/approve built a campaign from a caller-supplied
//      entry for anyone, and a phone account's sync, feedback and approval
//      were written with no workspace_id (or as tenant zero's brand).
//
// Run: npx playwright test tests/agents-review.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const A = require('./agents-harness');
const H = require('./router-harness');

let w;
test.beforeAll(async () => { w = await A.world({ compPhones: '+91 98765-43210' }); });
test.afterAll(async () => { await w.close(); });
test.beforeEach(() => { w.reset(); });

const BRAND = A.deviceBrand();
const FORGED_JWT = H.jwtShaped('attacker_0001');
const DEVICE_TOKEN = 'D'.repeat(20) + 'e'.repeat(23);   // our shape, in no database
const SHAPES = {
  server: {},
  browser: { origin: A.ORIGIN, referer: A.ORIGIN + '/page' },
  device: { origin: A.ORIGIN, referer: A.ORIGIN + '/page', 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN },
  forged: { origin: A.ORIGIN, referer: A.ORIGIN + '/page', authorization: 'Bearer ' + FORGED_JWT },
  serverDevice: { 'x-lifecycle-token': DEVICE_TOKEN },
  namedBrowser: { origin: A.ORIGIN, referer: A.ORIGIN + '/page', ws: true },
  namedServer: { ws: true },
};
const PAYLOAD = {
  message: 'what should we do next?', prompt: 'a shoe on a table', text: 'hello there', slot_id: 's1', entry_id: 'e1',
  report: { staff: 3 }, question: 'what moved?', brief: 'launch', id: 'p1', agent_id: 'agent_x', dry_run: true,
  platforms: ['instagram'], date: '2026-10-01', days: 2, withCreatives: false, tier: 'budget', userText: 'open the shop',
  assistantText: 'sure', config: { k: 1 }, name: 'N', target_id: 't', verdict: 'approve', queue_id: 'q', item_id: 'i',
  decision: 'approve', brand: BRAND,
};

/** Every action api/brain.js dispatches, from its own case labels (the router-brain enumeration). */
function brainActions() {
  const src0 = H.routerCode('api/brain.js');
  const cases = [...src0.matchAll(/^\s*case '([a-z0-9-]+)':/gm)].map((m) => m[1]);
  const literal = [...src0.matchAll(/\baction === '([a-z0-9-]+)'/g)].map((m) => m[1]);
  const all = H.uniqSorted([...cases, ...literal]);
  expect(all.length, 'the enumeration found almost nothing').toBeGreaterThanOrEqual(80);
  return all;
}

function send(pathname, action, method, headers, extraQuery) {
  const h = Object.assign({}, headers);
  const named = h.ws; delete h.ws;
  const query = Object.assign({ action }, named ? { workspace_id: 'ws-oldest' } : {}, extraQuery || {});
  return Promise.race([
    H.request(w.port, { method, path: pathname + H.qs(query), json: method === 'POST' ? PAYLOAD : undefined, headers: h }),
    new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout', text: '', out: null }), 20000)),
  ]);
}

const restWrites = () => w.db.calls.filter((c) => c.url.startsWith(A.BASE) && c.method !== 'GET' && !/\/auth\/v1\//.test(c.url) && !/\/rpc\/credit_/.test(c.url))
  .map((c) => `${c.method} ${c.url.replace(A.BASE, '').split('?')[0]}`);
const neonWrites = (from) => w.store.db.log.slice(from).filter((t) => /^(insert|update|delete)\b/.test(t));
const touchesOldest = () => w.db.calls.filter((c) => c.url.startsWith(A.BASE) && /ws-oldest/.test(decodeURIComponent(c.url) + ' ' + String(c.body || '')))
  .map((c) => `${c.method} ${decodeURIComponent(c.url.replace(A.BASE, '')).slice(0, 120)}`);

/* ── 1 + 2. the anonymous shapes ──────────────────────────────────────────── */

test.describe('1-2. what an anonymous caller can reach', () => {
  test('no anonymous shape reaches a model or a paid provider: every brain.js action, GET and POST', async () => {
    test.setTimeout(240000);
    const reached = [];
    for (const a of brainActions()) {
      for (const [shape, headers] of Object.entries(SHAPES)) {
        for (const method of ['GET', 'POST']) {
          w.reset();
          const r = await send('/api/brain', a, method, headers);
          if (w.llm.calls.length || w.escaped().length || r.status === 'timeout') {
            reached.push(`${a} ${shape} ${method} -> ${r.status} model[${w.llm.calls.map((c) => c.stage).join(',')}] escaped[${w.escaped().join(',')}]`);
          }
        }
      }
    }
    expect(reached, 'an anonymous caller reached a model or a provider').toEqual([]);
  });

  test('an unattributed page, a device token and a forged bearer write nothing, to either database', async () => {
    test.setTimeout(240000);
    const wrote = [];
    for (const a of brainActions()) {
      for (const shape of ['browser', 'device', 'forged']) {
        for (const method of ['GET', 'POST']) {
          w.reset();
          const from = w.store.db.log.length;
          await send('/api/brain', a, method, SHAPES[shape]);
          const rw = restWrites(); const nw = neonWrites(from);
          if (rw.length || nw.length) wrote.push(`${a} ${shape} ${method}: ${[...rw, ...nw].join(', ')}`);
        }
      }
    }
    expect(wrote).toEqual([]);
  });

  test('a device token is answered with the sentence that says the server cannot check it, never demo data and never a model turn', async () => {
    for (const a of ['brand-chat', 'agents', 'console-chat', 'social-run-daily']) {
      w.reset();
      const r = await send('/api/brain', a, 'POST', SHAPES.device);
      expect(r.status, a).toBe(401);
      expect(r.out.error, a).toBe('sign_in_required');
      expect(String(r.out.message), a).toMatch(/cannot be checked by the server|not signed in/);
      expect(r.out.mode, a).not.toBe('demo');
      expect(w.llm.calls, a).toEqual([]);
    }
  });

  test('RECORDED, not changed: an anonymous server-to-server caller can still write through these actions', async () => {
    // The ungated posture of api/brain.js that tests/router-brain.spec.js pins
    // (2026-09-28), measured here as WRITES. None of them reaches a model any
    // more (the test above), and none is reachable from a page; closing them
    // is a decision about the router's contract, filed separately. A NEW
    // action that writes for an anonymous caller fails this pin.
    test.setTimeout(240000);
    const writers = new Set();
    for (const a of brainActions()) {
      for (const shape of ['server', 'namedServer', 'namedBrowser']) {
        for (const method of ['GET', 'POST']) {
          w.reset();
          await send('/api/brain', a, method, SHAPES[shape]);
          if (restWrites().length) writers.add(a);
        }
      }
    }
    expect([...writers].sort()).toEqual([
      'agent-upsert', 'analyze', 'calendar-generate', 'calendar-review', 'config', 'feedback', 'mvt',
      'os-run-daily-job', 'social-approve', 'social-skip',
    ]);
  });
});

/* ── 3. whose rows a phone account touches ────────────────────────────────── */

test.describe('3. a phone account and the oldest workspace', () => {
  test('no brain.js action reads or writes another workspace\'s rows for a phone account, even when it names that workspace', async () => {
    test.setTimeout(240000);
    const crossed = [];
    const phone = w.headersFor('phone');
    for (const a of brainActions()) {
      for (const named of [false, true]) {
        for (const method of ['GET', 'POST']) {
          w.reset();
          await send('/api/brain', a, method, Object.assign({}, phone, named ? { ws: true } : {}));
          const t = touchesOldest();
          if (t.length) crossed.push(`${a}${named ? ' +workspace_id' : ''} ${method}: ${t.slice(0, 3).join(' | ')}`);
        }
      }
    }
    expect(crossed).toEqual([]);
  });

  test('and nothing a phone account does is written to a brand-scoped table without a workspace', async () => {
    // A row with no workspace_id belongs to no brand: invisible to every one,
    // still in the table, one backfill away from being attributed to tenant
    // zero. SmartBrainDbAdapter.insert/upsert wrote exactly that for a caller
    // with no workspace (update/delete already refused).
    test.setTimeout(240000);
    const scoped = require(path.join(A.ROOT, 'api/_shared/workspace-scope.js')).SCOPED_TABLES;
    const phone = w.headersFor('phone');
    const unstamped = [];
    const probe = async (label, pathname, action, method) => {
      w.reset();
      await send(pathname, action, method, phone);
      for (const c of w.db.calls) {
        if (!c.url.startsWith(A.BASE + '/rest/v1/') || c.method === 'GET') continue;
        const table = c.url.replace(A.BASE + '/rest/v1/', '').split('?')[0];
        if (scoped.has(table)) unstamped.push(`${label} ${method}: ${c.method} ${table}`);
      }
    };
    for (const a of brainActions()) for (const m of ['GET', 'POST']) await probe(a, '/api/brain', a, m);
    for (const s0 of ['sync-daily', 'run-daily', 'daily', 'feedback', 'approve', 'reject', 'heal', 'recalibrate', 'weekly-recalibration', 'activate-scenario']) {
      await probe('smart-brain-' + s0, '/api/calendar', 'smart-brain-' + s0, 'POST');
    }
    expect(unstamped).toEqual([]);
  });

  test('the planner never falls back to tenant zero\'s built catalogue for a person with no workspace', async () => {
    // Executed on the adapter itself, inside a request scope carrying a phone
    // token: an empty smart_products table used to be filled from tenant
    // zero's data/catalog file for ANY caller. The file is not built in this
    // checkout, so the fallback is observed where it is taken.
    const svc = require(path.join(A.ROOT, 'lib/smart-brain/services.js'));
    const rs = require(path.join(A.ROOT, 'api/_shared/request-scope.js'));
    const adapter = new svc.SmartBrainDbAdapter(svc.smartConfig({}), null);
    let took = 0;
    adapter.builtCatalogProducts = () => { took += 1; return [{ id: 'tenant-zero-sku', title: 'Tenant zero product' }]; };
    const req = { headers: { 'x-lifecycle-token': w.tokens.phone }, query: {}, body: {} };
    const data = await rs.run(req, () => adapter.ownData());
    expect(took, 'the built catalogue was read for a person with no workspace').toBe(0);
    expect(data.products).toEqual([]);
    // The scheduler - no request in scope - still resolves tenant zero and may use it.
    const cron = new svc.SmartBrainDbAdapter(svc.smartConfig({}), null);
    let cronTook = 0;
    cron.builtCatalogProducts = () => { cronTook += 1; return [{ id: 'tenant-zero-sku', title: 'Tenant zero product' }]; };
    const cronData = await cron.ownData();
    expect(await cron.workspace()).toBe('ws-oldest');
    expect(cronTook).toBe(1);
    expect(cronData.products.map((p) => p.id)).toEqual(['tenant-zero-sku']);
  });

  test('one layer down, the adapter and the planner hold the same line on their own', async () => {
    // Defence in depth, executed on the modules inside a request scope that
    // carries a phone token and NO brand: the router is not there to stamp
    // anything, and none of these may fall back to the oldest workspace.
    const svc = require(path.join(A.ROOT, 'lib/smart-brain/services.js'));
    const rs = require(path.join(A.ROOT, 'api/_shared/request-scope.js'));
    const plan = require(path.join(A.ROOT, 'api/_shared/smart-brain-plan.js'));
    const zero = require(path.join(A.ROOT, 'api/_shared/brand-runtime.js')).defaultBrand();
    const req = { headers: { 'x-lifecycle-token': w.tokens.phone }, query: {}, body: {} };
    await rs.run(req, async () => {
      const adapter = new svc.SmartBrainDbAdapter(svc.smartConfig({}), null);
      const ins = await adapter.insert('smart_feedback', [{ target_id: 'x', verdict: 'approve' }]);
      expect(ins.ok).toBe(false);
      const up = await adapter.upsert('smart_calendar_entries', [{ id: 'e1' }], 'id');
      expect(up.ok).toBe(false);
      const entry = { id: 'e1' };
      await plan.__test_stampBrand(entry, { workspace_id: null });
      expect(entry.brand).toBeUndefined();
      expect((await plan.__test_planningBrand({ workspace_id: null }, null)).isZero).toBe(false);
      // A carried record that names tenant zero's slug is still a device brand.
      req.__brand = { id: 'device:0000', slug: zero.slug, name: zero.name, carried: true, storage: 'device' };
      expect((await plan.__test_planningBrand({ workspace_id: null }, null)).isZero).toBe(false);
    });
    expect(restWrites()).toEqual([]);
    expect(touchesOldest()).toEqual([]);
  });

  test('nor does any calendar.js smart-brain action', async () => {
    test.setTimeout(120000);
    const crossed = [];
    const phone = w.headersFor('phone');
    const acts = ['activate-scenario', 'approve', 'daily', 'dbcheck', 'export', 'feedback', 'generate-slot', 'heal', 'health', 'plan',
      'preview', 'recalibrate', 'reject', 'run-daily', 'schema', 'sync-daily', 'sync-status', 'unreject', 'weekly-recalibration'];
    for (const s of acts) {
      for (const named of [false, true]) {
        for (const method of ['GET', 'POST']) {
          w.reset();
          await send('/api/calendar', 'smart-brain-' + s, method, Object.assign({}, phone, named ? { ws: true } : {}));
          const t = touchesOldest();
          if (t.length) crossed.push(`${s}${named ? ' +workspace_id' : ''} ${method}: ${t.slice(0, 3).join(' | ')}`);
        }
      }
    }
    expect(crossed).toEqual([]);
  });
});

/* ── 4 + 5. the carried record ────────────────────────────────────────────── */

test.describe('4-5. the record a phone account carries', () => {
  test('a carried slug cannot make a device brand tenant zero: the catalogue pinned for the turn is never the shipped one', async () => {
    const zero = require(path.join(A.ROOT, 'api/_shared/brand-runtime.js')).defaultBrand();
    expect(String(zero.slug || '').length, 'tenant zero has no slug to impersonate').toBeGreaterThan(0);
    const r = await w.request('/api/brain', { query: { action: 'brand-chat' }, json: { message: 'what sells best?', brand: Object.assign({}, BRAND, { slug: zero.slug }) }, state: 'phone' });
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    expect(String(r.out.brand.slug)).toMatch(/^device:/);
    expect(r.out.brand.name).toBe(BRAND.name);
    const turn = w.llm.calls.find((c) => c.stage === 'kicksgpt');
    expect(turn, 'the model was not reached').toBeTruthy();
    expect(turn.catalog, 'the turn was pinned to tenant zero\'s shipped catalogue').not.toBe('shipped');
  });

  test('a carried record is bounded all the way down, and keeps the offerings it describes itself with', async () => {
    const huge = 'y'.repeat(100000);
    const brand = Object.assign({}, BRAND, {
      typography: { heading: { family: 'Heading Face', deep: { a: { b: huge } }, huge }, junk: [1, 2, 3], body: 'Body Face' },
      catalog_source: { kind: 'manual', offering_kinds: ['section'], blob: { x: huge } },
      palette: Object.assign({}, BRAND.palette, { nested: { evil: huge } }),
      offerings: [{ kind: 'section', name: 'India', nested: { a: huge } }, 'A plain offering'],
    });
    const r = await w.request('/api/brain', { query: { action: 'brand-chat' }, json: { message: 'hi', brand }, state: 'phone' });
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    const b = r.out.brand;
    expect(b.typography.heading.family).toBe('Heading Face');
    expect(b.typography.heading.deep).toBeUndefined();
    expect(b.typography.heading.huge.length).toBeLessThanOrEqual(200);
    expect(b.typography.junk).toBeUndefined();
    expect(b.typography.body).toBe('Body Face');
    expect(b.catalog_source).toEqual({ kind: 'manual', offering_kinds: ['section'] });
    expect(b.palette.nested).toBeUndefined();
    expect(b.offerings[0]).toMatchObject({ kind: 'section', name: 'India' });
    expect(b.offerings[0].nested).toBeUndefined();
    expect(b.offerings[1]).toBe('A plain offering');
    expect(JSON.stringify(b).length).toBeLessThan(20000);
  });
});

/* ── 6. a public answer for nobody ───────────────────────────────────────── */

test.describe('6. the public actions answer for nobody', () => {
  test('jarvis for a signed-out page links no storefront at all; for a phone account, the store its own record names', async () => {
    const anon = await w.request('/api/brain', { query: { action: 'jarvis' }, json: { userText: 'open the shop and my cart', assistantText: 'sure' }, state: 'anonymous' });
    expect(anon.status).toBe(200);
    expect(Array.isArray(anon.out.actions)).toBe(true);
    for (const act of anon.out.actions) expect(String(act.href), `a signed-out page was linked to ${act.href}`).toMatch(/^\//);
    const phone = await w.request('/api/brain', { query: { action: 'jarvis' }, json: { userText: 'open the shop', assistantText: 'sure', brand: BRAND }, state: 'phone' });
    expect(phone.status).toBe(200);
    const shop = phone.out.actions.find((x) => x.key === 'tab:shop');
    expect(shop, JSON.stringify(phone.out.actions)).toBeTruthy();
    expect(new URL(shop.href).host).toBe(new URL(A.BRAND_SITE).host);
  });

  test('the Agent Builder spec for a signed-out page names no brand', async () => {
    const r = await w.request('/api/brain', { query: { action: 'agent-builder', op: 'spec' }, method: 'GET', state: 'anonymous' });
    expect(r.status).toBeLessThan(500);
    expect(JSON.stringify(r.out)).not.toMatch(/Oldest Brand/);
    expect(w.llm.calls).toEqual([]);
    expect(restWrites()).toEqual([]);
  });
});

/* ── 7. the scheduler ─────────────────────────────────────────────────────── */

test.describe('7. the scheduler\'s bearer', () => {
  test('a CRON_SECRET minted as 64 hex characters is the scheduler, not a phone token: it keeps the default workspace', async () => {
    const hex = require('crypto').randomBytes(32).toString('hex');
    const undo = H.pinEnv({ CRON_SECRET: hex });
    try {
      const r = await H.request(w.port, { method: 'GET', path: '/api/brain?action=agents', headers: { authorization: 'Bearer ' + hex } });
      expect(r.status, r.text.slice(0, 200)).toBe(200);
      const read = w.db.calls.find((c) => /\/rest\/v1\/smart_agents\?/.test(c.url));
      expect(read, 'the scheduler read no agents at all: its workspace resolved to nothing').toBeTruthy();
      expect(decodeURIComponent(read.url)).toContain('workspace_id=eq.ws-oldest');
    } finally { undo(); }
  });
});

/* ── 8. only a listed number spends ───────────────────────────────────────── */

test.describe('8. only a listed number spends', () => {
  const AGENTS = ['brand-chat', 'console-chat', 'team-chat', 'agent-analyze', 'access-narrative', 'social-run-daily'];

  test('an unlisted number reaches no agent: a 403 with a sentence, before any wallet, hold or model call', async () => {
    for (const a of AGENTS) {
      w.reset();
      const r = await w.request('/api/brain', { query: { action: a }, json: PAYLOAD, state: 'other' });
      expect(r.status, `${a}: ${r.text.slice(0, 200)}`).toBe(403);
      expect(r.out.error, a).toBe('credits_require_account');
      expect(String(r.out.message), a).toMatch(/not listed/);
      expect(w.llm.calls, a).toEqual([]);
      expect(w.db.calls.filter((c) => /rpc\/credit_hold/.test(c.url)), a).toEqual([]);
    }
    expect(w.db.table('credit_wallets').filter((x) => x.user_id === w.tokens.otherUserId)).toEqual([]);
  });

  test('a listed number is metered on its personal wallet at the catalog price, and gets its answer', async () => {
    const catalog = require(path.join(A.ROOT, 'api/_shared/credit-catalog.js'));
    const q = catalog.quote('assistant.chat', undefined, {});
    const before = w.db.table('credit_wallets').find((x) => x.user_id === w.tokens.phoneUserId);
    const b0 = before ? before.balance : catalog.welcomeGrant();
    const r = await w.request('/api/brain', { query: { action: 'brand-chat' }, json: { message: 'what sells best?', brand: BRAND }, state: 'phone' });
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    expect(r.out.reply).toBe('Scripted reply for this turn, with no figure invented.');
    expect(r.out.credits).toMatchObject({ feature: 'assistant.chat', charged: q.total });
    const after = w.db.table('credit_wallets').find((x) => x.user_id === w.tokens.phoneUserId);
    expect(after.balance).toBe(b0 - q.total);
    expect(after.workspace_id).toBeNull();
  });

  test('a listed number whose wallet store is down is told the database is not answering, naming its host - not shown a PostgREST URL - and nothing runs', async () => {
    // The production shape until the paused Supabase project answers again:
    // the credit ledger is a table in it, so every metered agent refuses.
    w.db.failures.credit_wallets = 503;
    try {
      const r = await w.request('/api/brain', { query: { action: 'brand-chat' }, json: { message: 'hi', brand: BRAND }, state: 'phone' });
      expect(r.status, r.text.slice(0, 300)).toBe(503);
      expect(r.out).toMatchObject({ ok: false, error: 'backend_unreachable', backend_unreachable: true });
      expect(String(r.out.message)).toContain(new URL(A.BASE).host);
      expect(String(r.out.message)).not.toMatch(/rest\/v1|select=\*|->/);
      expect(w.llm.calls).toEqual([]);
    } finally { delete w.db.failures.credit_wallets; }
  });

  test('with NO meter configured, an unlisted number still reaches no model - on brain.js or on generate.js - and a listed one does', async () => {
    const undo = H.pinEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    try {
      const chat = (state) => w.request('/api/ai/generate', { json: { mode: 'chat', message: 'hello', chat_context: {} }, state });
      w.reset();
      const b1 = await w.request('/api/brain', { query: { action: 'brand-chat' }, json: { message: 'hi', brand: BRAND }, state: 'other' });
      expect(b1.status, b1.text.slice(0, 200)).toBe(403);
      const g1 = await chat('other');
      expect(g1.status, g1.text.slice(0, 200)).toBe(403);
      expect(w.llm.calls).toEqual([]);
      const anon = await w.request('/api/brain', { query: { action: 'brand-chat' }, json: { message: 'hi' }, state: 'server' });
      expect(anon.status).toBe(401);
      expect(w.llm.calls).toEqual([]);
      const b2 = await w.request('/api/brain', { query: { action: 'brand-chat' }, json: { message: 'hi', brand: BRAND }, state: 'phone' });
      expect(b2.status, b2.text.slice(0, 200)).toBe(200);
      const g2 = await chat('phone');
      expect(g2.status, g2.text.slice(0, 200)).toBe(200);
      expect(w.llm.calls.length).toBe(2);
    } finally { undo(); }
  });
});

/* ── 9. calendar.js: building a campaign, and what is saved ──────────────── */

test.describe('9. calendar.js generation and persistence', () => {
  const ENTRY = {
    id: 'cal_review_in', date: '2026-10-05', market: 'IN',
    cohort: { name: 'At Risk', size: 900, rules: ['last_order_at > 120 days'] },
    objective: 'winback', rationale: 'review slot', confidence: 0.7,
    heroProduct: { title: 'Weekend Edition', handle: 'weekend-edition', price: 9, sku: 'WE-1' },
    supportingProducts: [], channels: ['email', 'landing_page', 'meta'], cta: 'Come back',
  };
  const cal = (s, state, json, headers) => H.request(w.port, {
    method: 'POST', path: '/api/calendar?action=smart-brain-' + s, json,
    headers: Object.assign({}, headers || w.headersFor(state)),
  });

  test('preview builds nothing for an anonymous caller, a device token or an unlisted number; a listed number gets ITS brand\'s campaign', async () => {
    test.setTimeout(120000);
    const cases = [
      ['server', {}, 401], ['device', SHAPES.device, 401], ['forged', SHAPES.forged, 401], ['other', null, 403],
    ];
    for (const [label, headers, status] of cases) {
      w.reset();
      const r = await cal('preview', label === 'other' ? 'other' : null, { entry: ENTRY, brand: BRAND }, headers || undefined);
      expect(r.status, `${label}: ${r.text.slice(0, 200)}`).toBe(status);
      expect(w.llm.calls, label).toEqual([]);
      expect(restWrites(), label).toEqual([]);
    }
    w.reset();
    const r = await cal('preview', 'phone', { entry: ENTRY, brand: BRAND });
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    expect(w.llm.calls.length).toBeGreaterThan(0);
    expect(r.text).not.toMatch(/Oldest Brand/);
    expect(touchesOldest()).toEqual([]);
    expect(restWrites()).toEqual([]);
  });

  test('a phone account\'s approval, feedback and sync write nothing: approve and feedback are refused with a sentence, sync computes without storing', async () => {
    test.setTimeout(120000);
    const ok = await cal('approve', 'phone', { entry: ENTRY, brand: BRAND });
    expect(ok.status, ok.text.slice(0, 200)).toBe(409);
    expect(ok.out.error).toBe('no_workspace');
    expect(w.llm.calls).toEqual([]);
    w.reset();
    const fb = await cal('feedback', 'phone', { target_id: 'x', verdict: 'approve' });
    expect(fb.status).toBe(409);
    w.reset();
    const sync = await cal('sync-daily', 'phone', { days: 3, brand: BRAND });
    expect(sync.status, sync.text.slice(0, 200)).toBe(200);
    expect(restWrites()).toEqual([]);
    expect(touchesOldest()).toEqual([]);
  });
});
