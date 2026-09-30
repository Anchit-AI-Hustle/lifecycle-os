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

  test('requireUser admits a well-shaped device token from a page, never a phone from the body', async () => {
    const core = require(path.join(A.ROOT, 'api/_shared/brand-workspace-core.js'));
    const r = await core.requireUser({
      headers: pageHeaders({ 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN }),
      body: { phone: '+919876543210', user_id: 'ws-oldest', brand: BRAND },
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.mode).toBe('device');
    expect(r.provider).toBe('mobile-pin');
    expect(r.user_id).toMatch(/^device:[0-9a-f]{32}$/);
    expect(r.phone).toBe('');
    expect(r.user_id).not.toBe('ws-oldest');
  });

  test('the same token with no Origin is still anonymous', async () => {
    const core = require(path.join(A.ROOT, 'api/_shared/brand-workspace-core.js'));
    const r = await core.requireUser({
      headers: { 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.error).toBe('sign_in_required');
    expect(String(r.message)).toMatch(/did not come from a page/i);
  });

  test('no anonymous shape reaches a model: no token, forged JWT, Origin-only, token without Origin', async () => {
    const shapes = [
      { name: 'server', headers: {} },
      { name: 'browser', headers: pageHeaders() },
      { name: 'forged', headers: pageHeaders({ authorization: 'Bearer ' + FORGED_JWT }) },
      { name: 'serverDevice', headers: { 'x-lifecycle-token': DEVICE_TOKEN } },
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

  test('KicksGPT answers as the carried brand, unmetered, from a device session on a page', async () => {
    const r = await H.request(w.port, {
      method: 'POST', path: '/api/brain' + H.qs({ action: 'brand-chat' }),
      json: { message: 'what sells best?', brand: BRAND },
      headers: pageHeaders({ 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN }),
    });
    expect(r.status, r.text.slice(0, 400)).toBe(200);
    expect(r.out.ok).toBe(true);
    expect(r.out.reply).toBe('Scripted reply for this turn, with no figure invented.');
    expect(r.out.brand.name).toBe(BRAND.name);
    expect(String(r.out.brand.id)).toMatch(/^device:/);
    expect(JSON.stringify(r.out)).not.toMatch(/Oldest Brand|knickgasm/i);
    expect(w.llm.calls.map((c) => c.stage)).toContain('kicksgpt');
    expect(r.out.credits && r.out.credits.charged, 'a standalone turn was metered').toBe(0);
  });

  test('generate.js admits the same device session and does not 503 credits_unavailable', async () => {
    const r = await H.request(w.port, {
      method: 'POST', path: '/api/ai/generate',
      json: { mode: 'chat', prompt: 'hello there', brand: BRAND },
      headers: pageHeaders({ 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN }),
    });
    expect(r.status, r.text.slice(0, 400)).toBeLessThan(500);
    expect(r.out && r.out.error, r.text.slice(0, 400)).not.toBe('credits_unavailable');
    expect(r.out && r.out.error, r.text.slice(0, 400)).not.toBe('sign_in_required');
  });

  test('the credit pill balance is standalone, not a 503 and not a wallet', async () => {
    const r = await H.request(w.port, {
      method: 'GET', path: '/api/public-config' + H.qs({ action: 'credits', op: 'balance' }),
      headers: pageHeaders({ 'x-lifecycle-token': DEVICE_TOKEN, authorization: 'Bearer ' + DEVICE_TOKEN }),
    });
    expect(r.status, r.text.slice(0, 400)).toBe(200);
    expect(r.out.ok).toBe(true);
    expect(r.out.wallet).toBe(null);
    expect(r.out.unavailable).toBe('standalone');
    expect(r.out.unmetered).toBe(true);
    expect(String(r.out.message)).toMatch(/Local \/ Demo Mode/i);
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
