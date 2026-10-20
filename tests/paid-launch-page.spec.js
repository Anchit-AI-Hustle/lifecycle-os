// The Paid launch tab on /publishing, EXECUTED in Chromium (2026-10-20).
//
// The page is served from 127.0.0.1 (the localhost preview, where auth.js lets
// a request go and the server judges it) and every /api/brain?action=paid-launch
// call it makes is answered by the SHIPPED paid-launch-core.handle over the
// in-memory Supabase and the stateful fake Meta ad account - never by a stub
// that returns what the page expects. What is asserted is the round trip a
// person makes: Winning angles briefs arrive, the account is synced, the plan
// shows each ad set's share and daily budget, Build with a switch off shows the
// exact request each step would send and sends nothing, Build with every switch
// on creates every object paused, and turning the spend on takes two presses.
// At 1280 and at 390 (a phone) the tab never scrolls the page sideways.
//
// Run: npx playwright test tests/paid-launch-page.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { FakeSupabase, makeReq, makeRes, envScope, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');
const { installPlatforms } = require('./lib/fake-social-platforms.js');

const ROOT = path.resolve(__dirname, '..');
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const launch = require(path.join(ROOT, 'api', '_shared', 'paid-launch-core.js'));
const registry = require(path.join(ROOT, 'api', '_shared', 'adapters', 'registry.js'));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const AUTH_A = { ok: true, token: 'tok-a', user_id: 'user-a', email: 'a@example.test' };
const ENV = envScope(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CONNECTION_SECRET_KEY', 'LIVE_CONNECTORS', 'META_ALLOW_WRITES', 'META_APP_ID', 'META_APP_SECRET']);
const IMG = 'https://cdn.brand.example/p/hero.jpg';
const LINK = 'https://brand.example/p/hero';

let server; let base; let realFetch;
test.beforeAll(async () => {
  ENV.save();
  realFetch = global.fetch;
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { ENV.restore(); global.fetch = realFetch; if (server) { if (server.closeAllConnections) server.closeAllConnections(); await new Promise((r) => server.close(r)); } });
test.afterEach(() => { global.fetch = realFetch; });

function world() {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'e'.repeat(64);
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-app-secret';
  process.env.LIVE_CONNECTORS = 'on';
  delete process.env.META_ALLOW_WRITES;
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addWorkspace('ws-a', 'user-a').setActive('user-a', 'ws-a').syncIdentityTables();
  const account = { id: 'act_77', currency: 'INR' };
  db.seen = installPlatforms(db, { metaAccount: account });
  db.account = account;
  db.install();
  connections._resolvedCache.clear();
  const row = db.insert('workspace_connections', {
    workspace_id: 'ws-a', provider: 'meta_ads', category: 'ads', auth_kind: 'oauth', label: 'meta', config: { publishing_enabled: true, ad_account_id: '77', page_id: 'page-1' },
    secret_fields: ['access_token'], secret_hint: 'oken', status: 'active', connect_kind: 'oauth', oauth_scopes: ['ads_management', 'ads_read'],
    token_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), refresh_failure_count: 0, revoked_at: null,
  });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: row.id, workspace_id: 'ws-a' }, connections.encryptSecrets({ access_token: 'meta-secret-token' })));
  return db;
}

async function open(page, briefs) {
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(String(e.message || e)));
  page.on('dialog', (d) => { thrown.push('a native dialog opened: ' + d.message()); d.dismiss(); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => (route.request().resourceType() === 'script'
    ? route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
    : route.abort('failed')));
  await page.route(/\/api\//, async (route) => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action') || '';
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (action === 'paid-launch') {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
      const res = makeRes();
      await launch.handle(makeReq({ token: AUTH_A.token, query: Object.fromEntries(u.searchParams.entries()), body, method: route.request().method() }), res, { auth: AUTH_A, workspaceId: 'ws-a', body: body || {} });
      return json(res.code, res.payload);
    }
    if (action === 'connections' && u.searchParams.get('op') === 'publish-registry') return json(200, { ok: true, platforms: registry.registryView(), channels: registry.allChannels() });
    if (action === 'connections') return json(200, { ok: true, connections: [] });
    return json(200, { ok: true });
  });
  await page.addInitScript((b) => { try { window.sessionStorage.setItem('lifecycle.launch.briefs', JSON.stringify(b)); } catch (_) {} }, briefs);
  await page.goto(base + '/publishing.html?tab=launch', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind === 'local', null, { timeout: 15000 });
  await expect(page.locator('#panel-launch')).toBeVisible();
  await expect(page.locator('#pl-platforms')).toContainText('Meta');
  return thrown;
}

const BRIEFS = {
  at: '2026-10-20T00:00:00Z', market: 'IN', budget: 1500,
  briefs: [
    { id: 'angle-1', angle_name: 'Fit worries', primary_text: 'Find the frame that fits your face in a minute.', headline: 'Frames that fit', share: 50 },
    { id: 'angle-2', angle_name: 'Price', primary_text: 'Two pairs for the price people expect for one.', headline: 'Two pairs, one price', share: 30 },
    { id: 'brief-control', basis: 'control', angle_name: 'Control', primary_text: 'Eyewear made for every day.', headline: 'Everyday eyewear', share: 20 },
  ],
};

for (const width of [1280, 390]) {
  test(`at ${width}px: briefs arrive, sync, plan with budgets, a withheld build shows its requests, a live build creates everything paused, two presses turn it on`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
    const db = world();
    const thrown = await open(page, BRIEFS);
    await expect(page.locator('#pl-briefs-note')).toContainText('3 brief(s) from Winning angles');

    await page.locator('#pl-sync').click();
    await expect(page.locator('#pl-sync-out')).toContainText('act_77');
    await expect(page.locator('#pl-sync-out')).toContainText('INR');

    await page.locator('#pl-markets').fill('IN');
    await page.locator('#pl-link').fill(LINK);
    await page.locator('#pl-image').fill(IMG);
    await page.locator('#pl-plan').click();
    const sets = page.locator('#pl-sets');
    await expect(sets).toContainText('750 INR');
    await expect(sets).toContainText('450 INR');
    await expect(sets).toContainText('300 INR');
    await expect(page.locator('#pl-steps li')).toHaveCount(10);

    // META_ALLOW_WRITES is off: the first step is withheld with its request; nothing is sent.
    await page.locator('#pl-run').click();
    await expect(page.locator('#pl-steps li').first()).toHaveAttribute('data-step-status', 'withheld');
    await expect(page.locator('#pl-steps li').first()).toContainText('META_ALLOW_WRITES');
    expect(db.seen.meta.filter((c) => c.method === 'POST').length).toBe(0);

    process.env.META_ALLOW_WRITES = '1';
    await page.locator('#pl-run').click();
    await expect(page.locator('#pl-steps li[data-step-status="done"]')).toHaveCount(10);
    expect(Object.values(db.account.objects).filter((o) => o.kind !== 'creative').every((o) => o.fields.status === 'PAUSED')).toBe(true);

    // Two presses: the first only arms, the second turns the spend on.
    await page.locator('#pl-live').click();
    await expect(page.locator('#pl-live')).toHaveText('Press again to start spending');
    expect(Object.values(db.account.objects).some((o) => o.fields.status === 'ACTIVE')).toBe(false);
    await page.locator('#pl-live').click();
    await expect(page.locator('#pl-launch-title')).toContainText('live');
    expect(Object.values(db.account.objects).filter((o) => o.kind !== 'creative').every((o) => o.fields.status === 'ACTIVE')).toBe(true);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(thrown).toEqual([]);
  });
}
