/**
 * A phone sign-in kept on this device, at the connections router (2026-10-04).
 * ---------------------------------------------------------------------------
 * Production is device mode (no DATABASE_URL). The connections router admitted
 * the device principal and then read its active workspace through RLS, which
 * refuses a phone account by THROWING; api/public-config.js caught it and
 * answered a bare 500 `connections_router_failed`. So every Connect press on
 * /publishing and every load of /connections, for a person who had just
 * signed in, showed a raw code.
 *
 * Executed over the SHIPPED api/public-config.js on a real socket (the agents
 * harness: a device world with no DATABASE_URL, every unclaimed host throws).
 * What must hold:
 *   - `list` answers 200: nothing connected, the registry to show, and the
 *     sentence saying why nothing can be connected from here;
 *   - every other op answers 409 `device_account` with that sentence - never
 *     a 500, never a raw code - and starts no sign-in, writes no state row;
 *   - a caller with no token is still refused exactly as before.
 *
 * Run: npx playwright test tests/connections-device-account.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const A = require('./agents-harness');

let w;
test.beforeAll(async () => { w = await A.world({ serverMode: false }); });
test.afterAll(async () => { if (w) await w.close(); });
test.beforeEach(() => { w.reset(); });

const connections = (op, o) => w.request('/api/public-config', Object.assign({}, o, { query: Object.assign({ action: 'connections', op }, (o && o.query) || {}) }));

test('list: nothing connected, the registry to show, and why - not a 500', async () => {
  const r = await connections('list', { state: 'phone' });
  expect(r.status, r.text).toBe(200);
  expect(r.out).toMatchObject({ ok: true, storage: 'device', workspace_id: null, connections: [], routing: { entries: [], use_platform_fallback: true } });
  expect(r.out.note).toMatch(/kept on this device/);
  expect(r.out.providers.length, 'the platforms are still shown').toBeGreaterThan(5);
  expect(r.text).not.toMatch(/connections_router_failed/);
  expect(w.escaped()).toEqual([]);
});

test('Connect, save, publishing and disconnect answer the same sentence with 409 - and start nothing', async () => {
  for (const [op, json] of [
    ['oauth-start', { provider: 'youtube', capabilities: ['post'], return_to: '/publishing' }],
    ['save', { provider: 'openai', fields: { api_key: 'sk-test-0000000000000000' } }],
    ['publishing', { provider: 'meta_ads', enabled: true }],
    ['oauth-disconnect', { provider: 'meta' }],
  ]) {
    const r = await connections(op, { state: 'phone', json });
    expect(r.status, `${op}: ${r.text}`).toBe(409);
    expect(r.out, op).toMatchObject({ ok: false, error: 'device_account', storage: 'device' });
    expect(r.out.message, op).toMatch(/kept on this device/);
    expect(r.out.message, op).not.toMatch(/sign in/i);
  }
  expect(w.db.table('oauth_authorization_states'), 'no sign-in was started').toEqual([]);
  expect(w.escaped()).toEqual([]);
});

test('no token is still refused before anything else', async () => {
  const r = await connections('list', { state: 'anonymous' });
  expect(r.status).toBe(401);
  expect(r.out.storage).toBeUndefined();
});
