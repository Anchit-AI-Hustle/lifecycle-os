const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://localhost:3099';
const session = (id = 'google-user', token = 'google-session-token') => ({
  access_token: token, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id, email: id + '@example.com', app_metadata: { provider: 'google' }, user_metadata: { name: 'Google User' } },
});

async function boot(page, options = {}) {
  const requests = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8') });
    if (url.pathname === '/api/public-config') return route.fulfill({ json: { supabase: { url: 'https://auth.example.com', anonKey: 'public-test-key' } } });
    if (url.pathname.startsWith('/api/')) {
      requests.push({ url: url.href, authorization: route.request().headers().authorization || '', legacy: route.request().headers()['x-lifecycle-token'] || '' });
      return route.fulfill({ json: { ok: true, entries: [] } });
    }
    if (url.hostname === 'external.example.com') {
      requests.push({ external: true, authorization: route.request().headers().authorization || '' });
      return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { ok: true } });
    }
    if (url.pathname === '/auth/v1/health') return options.unreachable ? route.abort() : route.fulfill({ json: {} });
    if (url.pathname === '/brain') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><h1>Brain</h1><script src="/auth.js"></script></body></html>' });
    return route.fulfill({ contentType: 'text/javascript', body: '' });
  });
  await page.addInitScript(({ initial, delay, legacy, oauthError }) => {
    if (legacy) localStorage.setItem('lifecycle.auth.session', JSON.stringify({ provider: 'mobile-pin', mode: 'device', token: 'p'.repeat(43), user: { id: 'old-pin-user', name: 'Old PIN User' } }));
    window.oauthCalls = [];
    window.supabase = { createClient: (_url, _key, options) => {
      window.sdkOptions = options;
      return { auth: {
        getSession: async () => { if (delay) await new Promise(resolve => setTimeout(resolve, delay)); return { data: { session: initial }, error: null }; },
        onAuthStateChange: callback => { window.changeSession = callback; return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOAuth: async args => { window.oauthCalls.push(args); return { error: oauthError ? { message: oauthError } : null }; },
        signOut: async () => { window.changeSession('SIGNED_OUT', null); return { error: null }; },
      } };
    } };
  }, { initial: options.session || null, delay: options.delay || 0, legacy: !!options.legacy, oauthError: options.oauthError || '' });
  await page.goto(ORIGIN + '/brain');
  await page.waitForFunction(() => window.LifecycleAuth);
  if (!options.delay) await page.evaluate(() => window.LifecycleAuth.ready());
  return requests;
}

test('Google is the only offered login', async ({ page }) => {
  const calls = await boot(page);
  await expect(page.getByRole('link', { name: /Gmail|Google/i })).toBeVisible();
  await expect(page.locator('#lnav-mauth')).toHaveCount(0);
  expect(await page.evaluate(() => window.LifecycleAuth.user)).toBeNull();
  await page.locator('#lnav-signin').click();
  await expect.poll(() => page.evaluate(() => window.oauthCalls.length)).toBe(1);
  expect(await page.evaluate(() => window.oauthCalls[0])).toEqual({ provider: 'google', options: { redirectTo: 'https://lifecycle-os.anchit-tandon.com/', queryParams: { prompt: 'select_account' } } });
  expect(calls.some(call => call.url.includes('action=auth'))).toBe(false);
});

test('a generated Lifecycle OS Vercel URL moves the full route to the canonical host', async ({ page }) => {
  const requested = 'https://lifecycle-os-preview-123-anchit-ai-hustle.vercel.app/smart-brain.html?tab=calendar#week';
  const canonical = 'https://lifecycle-os.anchit-tandon.com/smart-brain.html?tab=calendar#week';
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'lifecycle-os-preview-123-anchit-ai-hustle.vercel.app' && url.pathname === '/auth.js') {
      return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8') });
    }
    if (url.hostname === 'lifecycle-os-preview-123-anchit-ai-hustle.vercel.app') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/auth.js"></script>' });
    }
    if (url.hostname === 'lifecycle-os.anchit-tandon.com') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Canonical</title>' });
    }
    return route.abort();
  });
  await page.goto(requested);
  await expect.poll(() => page.url()).toBe(canonical);
});

test('session restoration holds the first Brain request until a bearer is available', async ({ page }) => {
  const calls = await boot(page, { session: session(), delay: 600 });
  await page.evaluate(() => fetch('/api/calendar?action=smart-brain-plan'));
  expect(calls.filter(call => call.url.includes('smart-brain-plan'))).toEqual([
    { url: ORIGIN + '/api/calendar?action=smart-brain-plan', authorization: 'Bearer google-session-token', legacy: '' },
  ]);
  expect(await page.evaluate(() => window.sdkOptions.auth)).toEqual({ persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' });
  await expect(page.locator('.lnav-uname')).toHaveText('Google User');
});

test('refreshed tokens reach the API, explicit credentials are preserved, and external requests receive none', async ({ page }) => {
  const calls = await boot(page, { session: session() });
  await page.evaluate(s => window.changeSession('TOKEN_REFRESHED', s), session('google-user', 'refreshed-token'));
  await page.evaluate(async () => {
    await fetch('/api/calendar?action=smart-brain-plan');
    await fetch(new Request(location.origin + '/api/brain?action=custom', { headers: { Authorization: 'Bearer explicit' } }));
    await fetch('http://external.example.com/data');
  });
  expect(calls.find(call => call.url && call.url.includes('smart-brain-plan')).authorization).toBe('Bearer refreshed-token');
  expect(calls.find(call => call.url && call.url.includes('custom')).authorization).toBe('Bearer explicit');
  expect(calls.find(call => call.external).authorization).toBe('');
});

test('sign out removes the identity, token and account caches', async ({ page }) => {
  const calls = await boot(page, { session: session() });
  await page.evaluate(async () => {
    localStorage.setItem('lc-brand-context', 'private brand');
    localStorage.setItem('lc-credits', 'private wallet');
    window.changeSession('SIGNED_OUT', null);
    await fetch('/api/calendar?action=smart-brain-plan');
  });
  expect(calls.at(-1).authorization).toBe('');
  expect(await page.evaluate(() => [window.LifecycleAuth.session, localStorage.getItem('lc-brand-context'), localStorage.getItem('lc-credits')])).toEqual([null, null, null]);
  await expect(page.locator('#lnav-signin')).toHaveText(/Gmail|Google/);
});

test('OAuth provider errors are visible and do not offer PIN fallback', async ({ page }) => {
  await boot(page, { oauthError: 'Google provider is unavailable' });
  await page.locator('#lnav-signin').click();
  await expect(page.locator('#lnav-signin-note')).toContainText('Google provider is unavailable');
  await expect(page.locator('#lnav-mauth')).toHaveCount(0);
});

test('a dead auth host prevents the redirect and explains the failure', async ({ page }) => {
  await boot(page, { unreachable: true });
  await page.locator('#lnav-signin').click();
  await expect(page.locator('#lnav-signin-note')).toContainText(/cannot be reached|could not be reached/);
  expect(await page.evaluate(() => window.oauthCalls.length)).toBe(0);
});
