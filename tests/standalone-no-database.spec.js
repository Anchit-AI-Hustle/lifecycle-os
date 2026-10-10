// Features run without DATABASE_URL, and anonymous callers still cannot spend.
// ---------------------------------------------------------------------------
// Production's measured state (docs/agents-status.md): no DATABASE_URL, device
// mode, model keys present. Until 2026-09-30 a device-mode sign-in blocked
// every agent before anything was sent ("this sign-in is saved on this device
// only"), and the server treated the token as anonymous, so nothing ran.
//
// The contract this spec executes against the SHIPPED routers:
//   1. A well-shaped device token FROM A PAGE (Origin) is a device principal
//      when there is no database: requireUser ok, mode 'device', id device:<hash>,
//      no phone invented from the body.
//   2. The same token with no Origin is still anonymous (401). A well-shaped
//      token is not a secret.
//   3. No token, a forged JWT, and an unattributed browser still do not reach
//      a model.
//   4. brand-chat with the carried brand answers the scripted reply, unmetered.
//   5. With DATABASE_URL set, a token that is not in app_sessions is still 401.
//   6. A phone stub with no mode:'device' is still refused (the list), even
//      though Neon is unset. Only a device principal is unmetered.
//
// ── 2026-10-10: THE DEVICE PRINCIPAL IS GONE ────────────────────────────────
// Google is the only sign-in (the owner's words: "No signin with mobile number
// - only Google signin pls"), so the contract above is INVERTED where it named
// a device token: with no DATABASE_URL, a well-shaped device token from a page
// is refused exactly like no token (401 sign_in_required, naming Google), and
// reaches no model, no wallet and no store - on brain.js, generate.js and the
// credit pill. Points 2, 3 and 5 hold unchanged; the meter's own rule (only a
// `mode:'device'` principal is unmetered, a phone stub is still refused) is
// kept as a unit check of credits-core, because a principal of that shape can
// no longer be produced by requireUser().
//
// Run: npx playwright test tests/standalone-no-database.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const A = require('./agents-harness');
const H = require('./router-harness');

const DEVICE_TOKEN = 'D'.repeat(20) + 'e'.repeat(23);
const FORGED_JWT = H.jwtShaped('attacker_standalone');
const BRAND = A.deviceBrand();

function pageHeaders(extra) {
  return Object.assign({ origin: A.ORIGIN, referer: A.ORIGIN + '/kicksgpt.html' }, extra || {});
}

test.describe('standalone: no DATABASE_URL', () => {
  let w;
  test.beforeAll(async () => { w = await A.world({ serverMode: false }); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  test('requireUser refuses a well-shaped device token from a page exactly like no token, and invents nothing from the body', async () => {
    const core = require(path.join(A.ROOT, 'api/_shared/brand-workspace-core.js'));
    const r = await core.requireUser({
      headers: pageHeaders({ 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN }),
      body: { phone: '+919876543210', user_id: 'ws-oldest', brand: BRAND },
    });
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.status).toBe(401);
    expect(r.error).toBe('sign_in_required');
    expect(String(r.message)).toMatch(/Google/);
    expect(r.mode).toBeUndefined();
    expect(r.user_id).toBeUndefined();
    const anon = await core.requireUser({ headers: pageHeaders() });
    expect([anon.status, anon.error]).toEqual([r.status, r.error]);
  });

  test('the same token with no Origin is still anonymous', async () => {
    const core = require(path.join(A.ROOT, 'api/_shared/brand-workspace-core.js'));
    const r = await core.requireUser({
      headers: { 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.error).toBe('sign_in_required');
    expect(String(r.message)).toMatch(/Google/);
  });

  test('no anonymous shape reaches a model: no token, forged JWT, Origin-only, token without Origin', async () => {
    const shapes = [
      { name: 'server', headers: {} },
      { name: 'browser', headers: pageHeaders() },
      { name: 'forged', headers: pageHeaders({ authorization: 'Bearer ' + FORGED_JWT }) },
      { name: 'serverDevice', headers: { 'x-lifecycle-token': DEVICE_TOKEN } },
      { name: 'pageDevice', headers: pageHeaders({ 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN }) },
    ];
    const reached = [];
    for (const s of shapes) {
      w.reset();
      const r = await H.request(w.port, {
        method: 'POST', path: '/api/brain' + H.qs({ action: 'brand-chat' }),
        json: { message: 'what sells best?', brand: BRAND }, headers: s.headers,
      });
      if (w.llm.calls.length) reached.push(s.name + ':' + r.status);
      expect(r.status, s.name + ' ' + JSON.stringify(r.out)).toBeGreaterThanOrEqual(400);
      expect(r.status, s.name).toBeLessThan(500);
      expect(w.llm.calls, s.name + ' reached the model').toEqual([]);
    }
    expect(reached).toEqual([]);
  });

  test('KicksGPT, generate.js and the credit pill refuse a device session on a page: no model, no wallet, no hold', async () => {
    const H2 = pageHeaders({ 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN });
    const chat = await H.request(w.port, { method: 'POST', path: '/api/brain' + H.qs({ action: 'brand-chat' }), json: { message: 'what sells best?', brand: BRAND }, headers: H2 });
    expect(chat.status, chat.text.slice(0, 300)).toBe(401);
    expect(chat.out.error).toBe('sign_in_required');
    const gen = await H.request(w.port, { method: 'POST', path: '/api/ai/generate', json: { mode: 'chat', prompt: 'hello there', brand: BRAND }, headers: H2 });
    expect(gen.status, gen.text.slice(0, 300)).toBe(401);
    const pill = await H.request(w.port, { method: 'GET', path: '/api/public-config' + H.qs({ action: 'credits', op: 'balance' }), headers: H2 });
    expect(pill.status, pill.text.slice(0, 300)).toBe(401);
    expect(pill.out.unmetered).toBeUndefined();
    expect(w.llm.calls, 'a device session reached the model').toEqual([]);
    expect(w.db.calls.filter((c) => /rpc\/credit_|credit_wallets/.test(c.url)), 'a device session touched the ledger').toEqual([]);
  });

  test('a phone stub with no mode:device is still refused, even with no DATABASE_URL', async () => {
    // The faucet the list exists to shut. An unlisted mobile-pin caller — or
    // a stub that only says provider:'mobile-pin' — must not run free just
    // because this process has no Neon URL. Only auth.mode === 'device' is
    // unmetered. Restoring `isDeviceAuth || standaloneMode()` in meter()
    // fails this (and the sibling in mobile-pin-signin.spec.js).
    const credits = require(path.join(A.ROOT, 'api/_shared/credits-core.js'));
    const m = await credits.meter(
      { query: {}, body: {}, headers: pageHeaders() },
      'analytics.run',
      { auth: { ok: true, provider: 'mobile-pin', user_id: 'aaaaaaaa-0000-4000-8000-000000000001', email: '' } },
    );
    expect(m).toMatchObject({ ok: false, status: 403, error: 'credits_require_account' });
    expect(m.unmetered, 'an unlisted phone was treated as a device principal').toBeUndefined();
    expect(w.db.calls.filter((c) => /rpc\/credit_hold|credit_wallets/.test(c.url)), 'a wallet was touched for a phone stub').toEqual([]);

    // requireUser() can no longer produce a device principal (above), so the
    // meter's own rule is checked with one made by hand: the shape it keys on.
    const device = { ok: true, mode: 'device', user_id: 'device:' + 'a'.repeat(32), email: '' };
    const free = await credits.meter({ query: {}, body: {} }, 'analytics.run', { auth: device });
    expect(free).toMatchObject({ ok: true, unmetered: true, charged: 0, mode: 'device' });
  });
});

test.describe('a database IS configured: a device-shaped token still proves nothing', () => {
  let w;
  test.beforeAll(async () => { w = await A.world(); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  test('a token that is not in app_sessions is 401 even with Origin', async () => {
    const r = await H.request(w.port, {
      method: 'POST', path: '/api/brain' + H.qs({ action: 'brand-chat' }),
      json: { message: 'what sells best?', brand: BRAND },
      headers: pageHeaders({ 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN }),
    });
    expect(r.status).toBe(401);
    expect(w.llm.calls).toEqual([]);
  });
});
