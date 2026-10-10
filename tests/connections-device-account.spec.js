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
 * ── 2026-10-10: GOOGLE IS THE ONLY SIGN-IN ──────────────────────────────────
 * The mobile number + PIN sign-in is switched off, so a phone token (the
 * device-mode token this file drove) is now refused EXACTLY like no token: a
 * 401 with a sentence naming Google, never a 500, never a raw code, no state
 * row written, no sign-in started. The `device_account` answer it used to
 * get exists only for a phone principal, which no gate admits any more.
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

test('a phone token is refused like no token, at list and at every op - never a 500, and nothing is started', async () => {
  for (const [op, json] of [
    ['list', undefined],
    ['oauth-start', { provider: 'youtube', capabilities: ['post'], return_to: '/publishing' }],
    ['save', { provider: 'openai', fields: { api_key: 'sk-test-0000000000000000' } }],
    ['publishing', { provider: 'meta_ads', enabled: true }],
    ['oauth-disconnect', { provider: 'meta' }],
  ]) {
    const anon = await connections(op, Object.assign({ state: 'anonymous' }, json ? { json } : {}));
    const r = await connections(op, Object.assign({ state: 'phone' }, json ? { json } : {}));
    expect(r.status, `${op}: ${r.text}`).toBe(401);
    expect(r.status, op).toBe(anon.status);
    expect(r.out.ok, op).toBe(false);
    expect(r.out.storage, op).toBeUndefined();
    expect(String(r.out.message || ''), op).toMatch(/Google/);
    expect(r.text, op).not.toMatch(/connections_router_failed/);
  }
  expect(w.db.table('oauth_authorization_states'), 'a sign-in was started').toEqual([]);
  expect(w.escaped()).toEqual([]);
});

test('no token is still refused before anything else', async () => {
  const r = await connections('list', { state: 'anonymous' });
  expect(r.status).toBe(401);
  expect(r.out.storage).toBeUndefined();
});
