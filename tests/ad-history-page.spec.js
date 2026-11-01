// The Ad history panel on /connections, EXECUTED in Chromium (2026-11-01).
//
// The page is served from localhost (the preview, where auth.js lets a request
// go and the server judges it) and every /api/brain?action=ad-history call it
// makes is answered by the SHIPPED ad-history.handle over the in-memory
// Supabase and the fake Meta API - never by a stub returning what the page
// expects. What is asserted is the round trip: the platforms are listed with
// why TikTok and Pinterest are not read, Import now reads the account, the
// table shows each ad with the platform's own figures and says "not returned"
// where a figure is absent (never 0), the page never scrolls sideways at 1280
// or 390, and no ground behind the panel is dark.
//
// Run: npx playwright test tests/ad-history-page.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { FakeSupabase, makeReq, makeRes, envScope, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');
const { installPlatforms } = require('./lib/fake-social-platforms.js');

const ROOT = path.resolve(__dirname, '..');
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const history = require(path.join(ROOT, 'api', '_shared', 'ad-history.js'));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const APP = 'http://localhost:4981';
const WS = '7b1f8c2a-1111-4222-8333-944455556677';
const AUTH = { ok: true, token: 'tok-a', user_id: 'user-a', email: 'a@example.test' };
const BRAND = {
  id: WS, slug: 'frameworks', name: 'Frameworks', status: 'active', onboarding_step: 6, website: 'https://brand.example',
  palette: { primary: '#1D3A8A', accent: '#16A3A3', ink: '#14161C', surface: '#FFFFFF' },
  typography: { heading: { family: 'Inter', stack: "'Inter',system-ui,sans-serif" }, body: { family: 'Inter', stack: "'Inter',system-ui,sans-serif" } },
  voice: { tone: 'clear' }, regions: [{ code: 'IN', currency: 'INR', home: true }], brand_data: {},
};
const ENV = envScope(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CONNECTION_SECRET_KEY', 'LIVE_CONNECTORS', 'META_APP_ID', 'META_APP_SECRET']);
let realFetch;
test.beforeAll(() => { ENV.save(); realFetch = global.fetch; });
test.afterAll(() => { ENV.restore(); global.fetch = realFetch; });
test.afterEach(() => { global.fetch = realFetch; history.resetCache(); });

function world() {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'e'.repeat(64);
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-app-secret';
  process.env.LIVE_CONNECTORS = 'on';
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addWorkspace(WS, 'user-a').setActive('user-a', WS).syncIdentityTables();
  const now = Date.now();
  db.seen = installPlatforms(db, { metaAdHistory: {
    account: 'act_77', currency: 'INR', pageSize: 2,
    ads: [
      { id: 'ad-1', name: 'Fit in a minute', effective_status: 'ACTIVE', created_time: new Date(now - 10 * 86400000).toISOString(), creative: { body: 'Find the frame that fits your face in a minute.', title: 'Frames that fit' } },
      { id: 'ad-2', name: 'Two pairs', effective_status: 'PAUSED', created_time: new Date(now - 30 * 86400000).toISOString(), creative: { body: 'Two pairs for the price of one.' } },
      { id: 'ad-3', name: 'A very long ad name that has to wrap on a phone without pushing the page sideways at all', effective_status: 'ACTIVE', created_time: new Date(now - 50 * 86400000).toISOString(), creative: { body: 'https://brand.example/a-very-long-landing-address-that-must-wrap-on-a-phone-screen' } },
    ],
    insights: [
      { ad_id: 'ad-1', spend: '120.50', impressions: '10000', clicks: '300', ctr: '3.0', purchase_roas: [{ action_type: 'omni_purchase', value: '2.4' }] },
      { ad_id: 'ad-2', spend: '80', impressions: '9000' },
    ],
  } });
  db.install();
  connections._resolvedCache.clear();
  const row = db.insert('workspace_connections', {
    workspace_id: WS, provider: 'meta_ads', category: 'ads', auth_kind: 'oauth', label: 'meta', config: { ad_account_id: '77' },
    secret_fields: ['access_token'], secret_hint: 'oken', status: 'active', connect_kind: 'oauth', oauth_scopes: ['ads_read'],
    token_expires_at: new Date(now + 30 * 86400000).toISOString(), refresh_failure_count: 0, revoked_at: null,
  });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: row.id, workspace_id: WS }, connections.encryptSecrets({ access_token: 'meta-secret-token' })));
  return db;
}

function serve(route, u) {
  const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\//, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
  return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
}

async function open(page) {
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(String(e.message || e)));
  page.on('dialog', (d) => { thrown.push('a native dialog opened: ' + d.message()); d.dismiss(); });
  await page.route(/^https?:\/\//, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin !== APP) return req.resourceType() === 'script' ? route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }) : route.abort('failed');
    if (!u.pathname.startsWith('/api/')) return serve(route, u);
    const action = u.searchParams.get('action');
    const json = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (action === 'ad-history') {
      const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
      const res = makeRes();
      await history.handle(makeReq({ token: AUTH.token, query: Object.fromEntries(u.searchParams.entries()), body, method: req.method() }), res, { auth: AUTH, workspaceId: WS, body: body || {} });
      return json(res.payload, res.code);
    }
    if (action === 'auth') return json({ ok: true, mode: 'google' });
    if (action === 'brand') {
      const op = u.searchParams.get('op');
      if (op === 'presets') return json({ ok: true, presets: [] });
      if (op === 'catalog-status') return json({ ok: true });
      return json({ ok: true, brand: BRAND, workspaces: [BRAND], active_id: WS });
    }
    if (action === 'connections') return json({ ok: true, providers: [], connections: [], routing: { entries: [] }, storage: {} });
    return json({ ok: true });
  });
  await page.goto(APP + '/brand-connections.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.name === 'Frameworks', null, { timeout: 20000 });
  await expect(page.locator('#adHistoryCard')).toBeVisible({ timeout: 15000 });
  return thrown;
}

for (const width of [1280, 390]) {
  test(`at ${width}px: the platforms are listed, Import now reads the account, the table shows the platform's figures and "not returned" for an absent one`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
    const db = world();
    const thrown = await open(page);
    const card = page.locator('#adHistoryCard');
    await expect(card.locator('[data-ah-platform="meta"]')).toContainText('Not imported yet');
    await expect(card.locator('[data-ah-platform="tiktok_ads"]')).toContainText('not confirmed');
    await expect(card.locator('[data-ah-platform="pinterest"]')).toContainText('no Pinterest ads-list read');
    await expect(card.locator('[data-ah-empty]')).toBeVisible();

    await page.locator('#adHistoryImport').click();
    await expect(card.locator('tr[data-ah-ad]')).toHaveCount(3, { timeout: 15000 });
    await expect(card.locator('[data-ah-platform="meta"] [data-ah-count]')).toHaveText('3');
    await expect(page.locator('#adHistoryStatus')).toContainText('Meta ads: 3 ads (2 with figures)');
    const ad1 = card.locator('tr[data-ah-ad="ad-1"]');
    await expect(ad1).toContainText('120.5 INR');
    await expect(ad1).toContainText('10,000');
    await expect(ad1).toContainText('3.00%');
    await expect(ad1).toContainText('2.4x');
    await expect(ad1).toContainText('Frames that fit');
    // Meta returned no clicks for ad-2: said, never 0.
    const ad2Clicks = card.locator('tr[data-ah-ad="ad-2"] td[data-label="Clicks"]');
    await expect(ad2Clicks).toHaveAttribute('data-not-returned', '');
    await expect(ad2Clicks).toContainText('not returned');
    await expect(card.locator('tr[data-ah-ad="ad-2"] td[data-label="CTR"]')).not.toContainText('0');

    expect(db.table('brand_ad_history').length).toBe(3);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
    // The card sits on a light ground (no dark section behind it).
    const lum = await card.evaluate((el) => {
      let n = el; let bg = '';
      while (n && n.nodeType === 1) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; } n = n.parentElement; }
      const m = (bg || 'rgb(255,255,255)').match(/\d+(\.\d+)?/g).map(Number);
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
    });
    expect(lum).toBeGreaterThan(0.6);
    expect(thrown).toEqual([]);
  });
}
