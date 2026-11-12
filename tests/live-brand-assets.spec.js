/**
 * Live Brand Assets: an ads channel shows the brand's OWN ads first.
 * ---------------------------------------------------------------------------
 * WHY (audit 2026-11-12). The rail's "Live Brand Assets" entries open
 * /knowledge-base#meta|google|tiktok. Those tabs showed only search links into
 * the public ad libraries under the word "Live". A search link is a way to
 * look; it is not a record of an ad. The brand's own ads are read from its
 * linked ad account into brand_ad_history, and no page but Connections drew them.
 *
 * EXECUTED in Chromium over the deployment's own rewrites, the page's real
 * requests answered by a fake /api/brain?action=ad-history:
 *   - the rail entry's address opens its channel, and a change of the
 *     address alone (another rail entry, back / forward) changes the channel;
 *   - a brand kept on this device is told why none of its ads can be read;
 *   - an account brand's ads are drawn as cards (text, status, last seen,
 *     destination), counted as "not a full inventory", and a read older than
 *     a week is labelled out of date;
 *   - an account with nothing linked says so; TikTok says it is not read;
 *   - the library links are labelled search links, and the workspace asked
 *     for is the active brand's.
 *
 * Run: npx playwright test tests/live-brand-assets.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'http://app.example.test';
const ACCOUNT = 'dev-live0001';
const WS = '11111111-2222-4333-8444-555555555555';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function rewrite(p) {
  for (const r of VERCEL.rewrites || []) {
    if (!r.source || !r.destination || r.destination.startsWith('/api/')) continue;
    const rx = new RegExp('^' + r.source.split(/(:[a-zA-Z]+\*?)/).map((s) => (s.startsWith(':') ? (s.endsWith('*') ? '.+' : '[^/]+') : esc(s))).join('') + '$');
    if (rx.test(p)) return r.destination.split('?')[0];
  }
  return p;
}
const BRAND = {
  slug: 'fernline', name: 'Fernline Optics', website: 'https://fernline.example',
  palette: { primary: '#1F6F5C', accent: '#C2552D', ink: '#1A1A1A', surface: '#FFFFFF' },
  typography: {}, voice: {}, regions: [{ code: 'IN', currency: 'INR', home: true, store_url: 'https://fernline.example' }],
};

async function install(page, id, answer) {
  const ctx = page.context();
  const seed = Object.assign({}, BRAND, { id, status: 'active', storage: 'device', owner_id: null });
  const asked = [];
  await ctx.addInitScript((a) => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [] }) }), order: async () => ({ data: [] }) }) }), storage: { from: () => ({}) } }) };
    try {
      if (sessionStorage.getItem('__live_seeded')) return;
      sessionStorage.setItem('__live_seeded', '1');
      localStorage.setItem('lifecycle.brand.device.workspaces', JSON.stringify({ version: 1, active_id: a.seed.id, workspaces: [a.seed] }));
      localStorage.setItem('lifecycle.brand.device.workspaces.' + a.account, JSON.stringify({ version: 1, active_id: a.seed.id, workspaces: [a.seed] }));
    } catch (_) {}
  }, { seed, account: ACCOUNT });
  await ctx.route(new RegExp('^https?:\\/\\/(?!' + esc(new URL(HOST).host) + ')'), (route) => {
    if (route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
  });
  await ctx.route(HOST + '/**', (route) => {
    const u = new URL(route.request().url());
    const p = rewrite(u.pathname === '/' ? '/index.html' : u.pathname);
    const f = path.join(ROOT, decodeURIComponent(p).replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await ctx.route(/\/api\//, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/brain' && u.searchParams.get('action') === 'ad-history') {
      asked.push({ op: u.searchParams.get('op'), provider: u.searchParams.get('provider'), workspace_id: u.searchParams.get('workspace_id') });
      const out = answer(u.searchParams.get('op'), u.searchParams.get('provider'));
      return route.fulfill({ status: out.status || 200, contentType: 'application/json', body: JSON.stringify(out.body) });
    }
    if (u.searchParams.get('action') === 'auth') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'google', pin_signin: false }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, supabase: { url: '', anonKey: '' }, brand: null, workspaces: [], items: [], rows: [], brands: [], presets: [] }) });
  });
  return asked;
}
/**
 * `ws` makes the active brand an ACCOUNT brand (its id a workspace uuid), as a
 * signed-in session's would be: the device store only ever holds local-* ids.
 */
async function open(page, hash, ws) {
  await page.goto(HOST + '/knowledge-base.html#' + hash);
  await page.waitForFunction((n) => !!(window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.name === n), BRAND.name, { timeout: 20_000 });
  await page.evaluate(({ h, id }) => {
    if (id) { const was = window.BrandContext.activeBrand; window.BrandContext.activeBrand = function () { return Object.assign({}, was.call(window.BrandContext), { id }); }; }
    // the page follows the address: leave the channel and come back to it
    location.hash = '#' + (h === 'mailers' ? 'meta' : 'mailers'); setTimeout(() => { location.hash = '#' + h; }, 50);
  }, { h: hash, id: ws || null });
}
const DAY = 86400000;
const ADS = [
  { ad_id: '9001', provider: 'meta', name: 'Monsoon frames', headline: 'Frames that sit light', primary_text: 'Titanium frames, in store now.', status: 'ACTIVE', image_url: 'https://cdn.fernline.example/a.jpg', landing_url: 'https://fernline.example/frames', last_seen: new Date(Date.now() - 9 * DAY).toISOString(), imported_at: new Date(Date.now() - 9 * DAY).toISOString() },
  { ad_id: '9002', provider: 'meta', name: 'Readers', headline: '', primary_text: '', status: null, image_url: null, landing_url: null, last_seen: new Date(Date.now() - 9 * DAY).toISOString() },
];

test('the rail\'s Meta entry shows the account brand\'s own ads as cards, counted honestly, and a read from nine days ago is labelled out of date', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const asked = await install(page, 'local-live000000001', (op) => (op === 'list'
    ? { body: { ok: true, ads: ADS } }
    : { body: { ok: true, platforms: [{ provider: 'meta', connected: true, ads: 2, window_note: '', last_import: { ran_at: new Date(Date.now() - 9 * DAY).toISOString() } }] } }));
  await open(page, 'meta', WS);
  const box = page.locator('#kbOwnAds');
  await expect(box).toHaveAttribute('data-state', 'stale');
  await expect(box.locator('[data-own-ad]')).toHaveCount(2);
  await expect(box).toContainText('2 ads as the platform returned them');
  await expect(box).toContainText('not a full inventory');
  await expect(box).toContainText('9 days ago, may be out of date');
  await expect(box.locator('[data-own-ad="9001"]')).toContainText('Frames that sit light');
  // the rail lights the channel on screen (the address carries the market too: #meta/IN)
  expect(await page.evaluate(() => location.hash)).toMatch(/^#meta/);
  await expect(page.locator('#lifecycle-nav .lnav-link.active')).toHaveAttribute('data-id', 'kbv-meta');
  if (process.env.AUDIT_SHOTS) await page.screenshot({ path: path.join(process.env.AUDIT_SHOTS, 'live-brand-assets-meta.png'), fullPage: true });
  await expect(box.locator('[data-own-ad="9001"] a')).toHaveAttribute('href', 'https://fernline.example/frames');
  // What the platform did not return is said, never filled.
  await expect(box.locator('[data-own-ad="9002"]')).toContainText('status not returned');
  await expect(box.locator('[data-own-ad="9002"]')).toContainText('destination not returned');
  await expect(box.locator('[data-own-ad="9002"] img')).toHaveCount(0);
  // The library tiles are search links and say so.
  await expect(page.locator('[data-kb-links-note]')).toContainText('search links, not records');
  expect(asked.every((a) => a.workspace_id === WS)).toBe(true);
  expect(asked.find((a) => a.op === 'list').provider).toBe('meta');
  expect(errors).toEqual([]);
});

test('every other state is a sentence: a device brand, nothing linked, never imported, unreadable, and TikTok', async ({ page }) => {
  let mode = 'unlinked';
  await install(page, 'local-live000000001', (op) => {
    if (mode === 'down') return { status: 503, body: { ok: false } };
    if (op === 'list') return { body: { ok: true, ads: [] } };
    return { body: { ok: true, platforms: [{ provider: 'google_ads', connected: mode !== 'unlinked', ads: 0, last_import: null }] } };
  });
  await open(page, 'google', WS);
  await expect(page.locator('#kbOwnAds')).toHaveAttribute('data-state', 'not_connected');
  await expect(page.locator('#kbOwnAds')).toContainText('No Google Ads account is linked');
  mode = 'linked';
  // the address alone moves the channel, as another rail entry does
  await page.evaluate(() => { location.hash = '#meta'; });
  await expect(page.locator('#kbOwnAds')).toHaveAttribute('data-own-ads', 'meta');
  await page.evaluate(() => { location.hash = '#google'; });
  await expect(page.locator('#kbOwnAds')).toHaveAttribute('data-own-ads', 'google');
  await expect(page.locator('#kbOwnAds')).toHaveAttribute('data-state', 'never_imported');
  mode = 'down';
  await page.locator('#chanTabs .subtab[data-chan="meta"]').click();
  await expect(page.locator('#kbOwnAds')).toHaveAttribute('data-state', 'unavailable');
  await expect(page.locator('#kbOwnAds')).toContainText('Nothing is shown in their place');
  await expect(page.locator('#kbOwnAds [data-own-ad]')).toHaveCount(0);
  await page.locator('#chanTabs .subtab[data-chan="tiktok"]').click();
  await expect(page.locator('#kbOwnAds')).toHaveAttribute('data-state', 'not_read');
});

test('a brand kept on this device is told why none of its ads can be read, and nothing is asked of the server', async ({ page }) => {
  const asked = await install(page, 'local-live000000001', () => ({ body: { ok: true, ads: ADS } }));
  await open(page, 'meta');
  await expect(page.locator('#kbOwnAds')).toHaveAttribute('data-state', 'no_account');
  await expect(page.locator('#kbOwnAds [data-own-ad]')).toHaveCount(0);
  expect(asked).toEqual([]);
  // the short address lights its own channel row too
  await page.goto(HOST + '/kb#landing');
  await page.waitForFunction((n) => !!(window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.name === n), BRAND.name, { timeout: 20_000 });
  await expect(page.locator('#lifecycle-nav .lnav-link.active')).toHaveAttribute('data-id', 'kbv-landing');
});
