// The Social gateway tab on /publishing, EXECUTED (2026-10-04).
//
// The page is served from 127.0.0.1 (the localhost preview, where auth.js
// lets a request go and the server judges it) and every /api/brain call it
// makes is answered by the SHIPPED social-gateway-core.handle and
// dispatch-core.listJobs over the in-memory Supabase - not by a stub that
// returns what the page expects. So what is asserted is the round trip a
// person makes: what the hub shows for each platform (which switch stands
// between it and a write, which calls are unverified and where each was
// read), and what pressing a control actually stores (a live approval stamped
// with the session's operator, a flag decided, a threshold saved).
//
// Run: npx playwright test tests/social-gateway-console.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { FakeSupabase, makeReq, makeRes, envScope, nowIso, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const dispatch = require(path.join(ROOT, 'api', '_shared', 'dispatch-core.js'));
const gateway = require(path.join(ROOT, 'api', '_shared', 'social-gateway-core.js'));
const registry = require(path.join(ROOT, 'api', '_shared', 'adapters', 'registry.js'));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const AUTH_A = { ok: true, token: 'tok-a', user_id: 'user-a', email: 'a@example.test' };
const DEVICE = { ok: true, token: 'device-token', user_id: 'device:abc', provider: 'mobile-pin', mode: 'device' };
const SWITCHES = ['META_ALLOW_WRITES', 'TIKTOK_ALLOW_WRITES', 'PINTEREST_ALLOW_WRITES', 'YOUTUBE_ALLOW_WRITES', 'GOOGLE_ADS_ALLOW_WRITES'];
const ENV = envScope(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CONNECTION_SECRET_KEY', 'LIVE_CONNECTORS', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', ...SWITCHES]);

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
test.afterAll(async () => { ENV.restore(); global.fetch = realFetch; if (server) await new Promise((r) => server.close(r)); });
test.afterEach(() => { global.fetch = realFetch; });

function world() {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'e'.repeat(64);
  process.env.TIKTOK_CLIENT_KEY = 'tt-client-key';
  process.env.TIKTOK_CLIENT_SECRET = 'tt-client-secret';
  for (const k of ['LIVE_CONNECTORS', ...SWITCHES]) delete process.env[k];
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addWorkspace('ws-a', 'user-a').setActive('user-a', 'ws-a').syncIdentityTables();
  db.install();
  connections._resolvedCache.clear();
  return db;
}

function connectMeta(db) {
  const secrets = { access_token: 'meta-secret-token' };
  const row = db.insert('workspace_connections', {
    workspace_id: 'ws-a', provider: 'meta_ads', category: 'ads', auth_kind: 'oauth', label: 'meta', config: { publishing_enabled: false, ad_account_id: '123' },
    secret_fields: Object.keys(secrets), secret_hint: 'oken', status: 'active', connect_kind: 'oauth', oauth_scopes: ['ads_management'],
    token_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), refresh_failure_count: 0, revoked_at: null,
    external_account_id: 'page-1', external_account_label: 'Brand Page', last_check_note: '',
  });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: row.id, workspace_id: 'ws-a' }, connections.encryptSecrets(secrets)));
}

/**
 * Open /publishing with the brain router's gateway and dispatch-list answered
 * by the shipped cores for `auth` on `ws`. Every brain request is recorded.
 */
async function open(page, { auth = AUTH_A, ws = 'ws-a' } = {}) {
  const asked = [];
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(String(e.message || e)));
  page.on('dialog', (d) => d.accept());
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => (route.request().resourceType() === 'script'
    ? route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
    : route.abort('failed')));
  await page.route(/\/api\//, async (route) => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action') || '';
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (action === 'social-gateway' || action === 'dispatch-list') {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
      asked.push({ action, op: u.searchParams.get('op'), method: route.request().method(), body });
      if (action === 'dispatch-list') return json(200, { ok: true, jobs: await dispatch.listJobs(auth, ws) });
      const res = makeRes();
      await gateway.handle(makeReq({ token: auth.token, query: Object.fromEntries(u.searchParams.entries()), body, method: route.request().method() }), res, { auth, workspaceId: ws, body: body || {} });
      return json(res.code, res.payload);
    }
    if (action === 'connections' && u.searchParams.get('op') === 'publish-registry') return json(200, { ok: true, platforms: registry.registryView(), channels: registry.allChannels() });
    if (action === 'connections') return json(200, { ok: true, connections: [] });
    return json(200, { ok: true });
  });
  await page.goto(base + '/publishing.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind === 'local', null, { timeout: 15000 });
  await page.getByRole('tab', { name: 'Social gateway' }).click();
  return { asked, thrown };
}

test('the hub shows, per platform, which switch withholds a write, which calls are unverified and where each was read - and never a secret', async ({ page }) => {
  const db = world();
  connectMeta(db);
  const { thrown } = await open(page);
  const cards = page.locator('#gw-platforms .conn');
  await expect(cards).toHaveCount(6);

  const meta = cards.filter({ hasText: 'Meta' }).first();
  await expect(meta).toContainText('connected');
  await expect(meta).toContainText('writes withheld');
  await expect(meta).toContainText('LIVE_CONNECTORS off');
  await expect(meta).toContainText('brand publishing off');
  await expect(meta).toContainText('META_ALLOW_WRITES off');
  await expect(meta).toContainText('Account: Brand Page');
  await expect(meta).toContainText('LIVE_CONNECTORS is off on this deployment');

  // TikTok Ads admits its unverified calls, and every call names its source.
  const ttAds = cards.filter({ hasText: 'TikTok Ads' });
  await expect(ttAds).toContainText('unverified');
  await ttAds.locator('summary').click();
  await expect(ttAds.locator('table')).toContainText('ad_create');
  const tiktok = cards.nth(1);
  await tiktok.locator('summary').click();
  const docHrefs = await tiktok.locator('table a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(docHrefs.length).toBeGreaterThan(3);
  for (const h of docHrefs) expect(h).toMatch(/^https:\/\/developers\.tiktok\.com\//);
  await expect(cards.filter({ hasText: 'Pinterest' })).toContainText('no signature scheme was confirmed');

  const rendered = await page.content();   // the live DOM after the round trip, not the file
  expect(rendered).not.toContain('meta-secret-token');
  expect(thrown).toEqual([]);
});

test('approving a paused Meta ad from the console queues its own live-approval job, stamped with the session\'s operator', async ({ page }) => {
  const db = world();
  connectMeta(db);
  const draft = db.insert('dispatch_jobs', { workspace_id: 'ws-a', idempotency_key: 'k-ad', provider: 'meta', channel: 'meta_ad', payload: {}, status: 'succeeded', external_id: 'ad-new-1', external_status: 'paused', asset_ref: 'slot-ad', attempt_count: 1, max_attempts: 5, next_attempt_at: nowIso() });
  // A published organic post has no live step, and is not offered one.
  db.insert('dispatch_jobs', { workspace_id: 'ws-a', idempotency_key: 'k-post', provider: 'tiktok', channel: 'tiktok_video_post', payload: {}, status: 'succeeded', external_id: 'v_pub', attempt_count: 1, max_attempts: 5, next_attempt_at: nowIso() });
  const { asked } = await open(page);

  const approve = page.locator('#gw-drafts button[data-gw-live]');
  await expect(approve).toHaveCount(1);
  await expect(page.locator('#gw-drafts')).toContainText('ad-new-1');
  await approve.click();
  await expect(page.locator('#msg')).toContainText('Live approval queued as its own job');

  const sent = asked.find((a) => a.op === 'live-approve');
  expect(sent.method).toBe('POST');
  expect(sent.body).toMatchObject({ job_id: draft.id });
  const approval = db.table('dispatch_jobs').find((j) => j.channel === 'meta_live_approval');
  expect(approval).toMatchObject({ created_by: 'user-a', idempotency_key: `live:${draft.id}`, status: 'queued' });
  expect(approval.payload).toMatchObject({ external_id: 'ad-new-1', approved_by: 'user-a' });
  // The approval is listed with its own state; nothing reached Meta.
  await expect(page.locator('#gw-drafts')).toContainText('meta_live_approval');
  expect(db.external()).toEqual([]);
});

test('thresholds saved from the console are the brand\'s own; recompute flags the creative below the brand\'s median, and approving its regeneration records who and spends nothing', async ({ page }) => {
  const db = world();
  for (const [id, ctr] of [['ad-1', 2.0], ['ad-2', 1.5], ['ad-3', 0.4]]) {
    db.insert('social_metric_snapshots', { workspace_id: 'ws-a', provider: 'meta', kind: 'paid', external_id: id, metrics: { ctr }, captured_on: '2026-10-03', asset_ref: `slot-${id}`, slot_date: '2026-10-05' });
  }
  await open(page);
  await expect(page.locator('#gw-flags')).toContainText('No creative is flagged');

  await page.fill('#gw-t-paid-ctr_min', '0.3');
  await page.click('#gw-save-thresholds');
  await expect(page.locator('#msg')).toContainText('Thresholds saved');
  expect(db.table('social_gateway_settings')[0]).toMatchObject({ workspace_id: 'ws-a', updated_by: 'user-a', thresholds: { paid: { ctr_min: 0.3 }, organic: {} } });

  await page.click('#gw-compute');
  const rows = page.locator('#gw-flags tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('ad-3');
  await expect(rows.first()).toContainText("below this brand's own median");
  await expect(page.locator('#gw-flags .gw-day')).toContainText('2026-10-05');
  // A ROAS no platform reported is not a flag; the ctr threshold of 0.3 flags nothing.
  expect(db.table('social_creative_flags').map((f) => `${f.external_id}:${f.metric}:${f.basis}`)).toEqual(['ad-3:ctr:own_median']);

  db.clearCalls();
  await rows.first().locator('button[data-gw-flag="regen-approve"]').click();
  await expect(page.locator('#msg')).toContainText('Regeneration approved');
  expect(db.table('social_creative_flags')[0]).toMatchObject({ status: 'regen_approved', decided_by: 'user-a' });
  expect(db.calls.filter((c) => /rpc\/credit_/.test(c.url)), 'approving spends nothing by itself').toEqual([]);
  expect(db.table('dispatch_jobs')).toHaveLength(0);
  await expect(rows.first()).toContainText('regen_approved');
});

test('a brand kept on this device sees the honest status, and every control that would read or write a platform is disabled with its reason - nothing else is asked', async ({ page }) => {
  const db = world();
  const { asked, thrown } = await open(page, { auth: DEVICE, ws: null });
  await expect(page.locator('#gw-platforms .conn')).toHaveCount(6);
  await expect(page.locator('#gw-state .vh-status')).toContainText('kept on this device');
  for (const id of ['gw-read', 'gw-compute', 'gw-save-thresholds', 'gw-refresh']) {
    await expect(page.locator('#' + id)).toBeDisabled();
    await expect(page.locator('#' + id)).toHaveAttribute('title', /kept on this device/);
  }
  await expect(page.locator('#gw-flags .vh-failure')).toHaveCount(0);
  expect(asked.map((a) => a.op || a.action)).toEqual(['status']);
  expect(db.calls, 'a device brand reaches neither the store nor a platform').toEqual([]);
  expect(thrown).toEqual([]);
});
