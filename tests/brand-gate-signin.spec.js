/**
 * The "Choose a brand to continue" gate always offers Sign in to a visitor
 * nobody has signed in as, and says HERE why sign-in cannot open.
 * ---------------------------------------------------------------------------
 * Found on production from a phone (2026-10-10): with no active brand the gate
 * covered the page and offered "Set up or choose a brand" and "About this
 * platform" only. It offered Sign in solely when the account service ANSWERED
 * (backend kind `signed-out`); production's project was paused, so its kind
 * was `unreachable` and a phone had no way to sign in from the first screen
 * (the rail's chip sits behind the gate, in a closed drawer).
 *
 * Since #173 the sign-in is a mobile number and a 4-digit PIN, which works on
 * the device with no account service at all, so the gate's Sign in opens that
 * panel in every no-session state.
 *
 * The gate stays out of automation's way (`navigator.webdriver`), so this spec
 * reports the browser as an ordinary one before any page script runs.
 *
 * Run: npx playwright test tests/brand-gate-signin.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const NO_BACKEND = { ok: true };
const LIVE = { supabase: { url: 'https://live.supabase.co', anonKey: 'anon' } };
const PAUSED = { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } };

async function open(page, { config, reachable, session }) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.addInitScript(({ session }) => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
    window.__OAUTH__ = [];
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async (o) => { window.__OAUTH__.push(o); return { error: null }; },
          signOut: async () => ({}),
        },
      }),
    };
    if (session) { try { localStorage.setItem('lifecycle.auth.session', JSON.stringify(session)); } catch (_) {} }
  }, { session: session || null });
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    if (/\/auth\/v1\/health/.test(route.request().url())) {
      return reachable ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) : route.abort('addressunreachable');
    }
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
  });
  await page.route('http://app.example.test/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }) }));
  await page.route(/\/api\/public-config/, (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get('action') === 'auth') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'device', reason: 'no_database_url' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) });
  });
  await page.goto('http://app.example.test/', { waitUntil: 'domcontentloaded' });
  return errors;
}

const gateButton = (page) => page.locator('#lc-brand-gate [data-gate-signin]');

for (const [label, config, reachable] of [
  ['the account service is paused (production, 2026-10-10)', PAUSED, false],
  ['no account service is configured', NO_BACKEND, false],
  ['the account service answers', LIVE, true],
]) {
  test(`phone: the gate offers Sign in when ${label}, and pressing it opens the mobile + PIN panel`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = await open(page, { config, reachable });
    await expect(page.locator('#lc-brand-gate')).toBeVisible({ timeout: 15_000 });
    await expect(gateButton(page)).toBeVisible({ timeout: 15_000 });
    await expect(gateButton(page)).toHaveText(/Sign in with your mobile number/);
    const box = await gateButton(page).boundingBox();
    expect(box.y + box.height, 'Sign in is below the first screen').toBeLessThanOrEqual(844);
    await gateButton(page).click();
    await expect(page.locator('#lc-brand-gate'), 'the gate stayed over the sign-in panel').toHaveCount(0, { timeout: 15_000 });
    const phone = page.locator('#lnav-mauth-phone');
    await expect(phone, 'the mobile + PIN panel did not open').toBeVisible({ timeout: 15_000 });
    const pb = await phone.boundingBox();
    expect(pb.y >= 0 && pb.y + pb.height <= 844, 'the phone field is off the first screen').toBe(true);
    expect(await page.evaluate(() => window.__OAUTH__.length), 'Google was asked for').toBe(0);
    expect(errors).toEqual([]);
  });
}
