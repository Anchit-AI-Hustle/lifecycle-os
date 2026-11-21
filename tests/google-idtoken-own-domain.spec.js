// @ts-check
/**
 * Google sign-in returns to THIS domain (2026-11-21).
 *
 * The Supabase redirect sends Google's reply to <ref>.supabase.co, which the
 * Google consent screen names and the OAuth branding check flags as an
 * unauthorised domain. A custom Supabase auth domain fixes that and is paid.
 * The free route: Google's OpenID Connect implicit flow answers
 * <origin>/#id_token=..&state=.., and supabase-js signInWithIdToken hands the
 * token + the RAW nonce to Supabase, which verifies both.
 *
 * Executed in Chromium against the shipped auth.js and the shipped
 * public-config handler. supabase-js is a recorder; accounts.google.com is
 * intercepted, so the request auth.js built is what is asserted.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
// https: crypto.subtle (the nonce hash) exists only in a secure context.
const ORIGIN = 'https://app.example.test';
const CLIENT = '608774819914-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function config(google) {
  return { supabase: { url: 'https://live-project.supabase.co', anonKey: 'anon', google: google === undefined ? { client_id: CLIENT, origins: [ORIGIN] } : google } };
}

async function open(page, url, o) {
  const opts = o || {};
  const seen = { google: [], errors: [] };
  page.on('pageerror', (e) => seen.errors.push(String(e.message || e)));
  await page.addInitScript((init) => {
    if (init.clear && !sessionStorage.getItem('__t_once')) { try { localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('__t_once', '1'); } catch (_) {} }
    Object.keys(init.local || {}).forEach((k) => { if (!sessionStorage.getItem('__t_local')) localStorage.setItem(k, init.local[k]); });
    sessionStorage.setItem('__t_local', '1');
    if (!sessionStorage.getItem('__t_sess')) { Object.keys(init.session || {}).forEach((k) => sessionStorage.setItem(k, init.session[k])); sessionStorage.setItem('__t_sess', '1'); }
    window.__oauth = [];
    window.__idtoken = [];
    let listener = null;
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: window.__sess || null } }),
          onAuthStateChange: (fn) => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
          signInWithOAuth: async (args) => { window.__oauth.push(JSON.parse(JSON.stringify(args))); return { error: null }; },
          signInWithIdToken: async (args) => {
            window.__idtoken.push(JSON.parse(JSON.stringify(args)));
            if (init.idTokenError) return { data: {}, error: { message: init.idTokenError } };
            window.__sess = { access_token: 'jwt', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-1', email: 'a@b.test', app_metadata: { provider: 'google' } } };
            if (listener) listener('SIGNED_IN', window.__sess);
            return { data: { session: window.__sess }, error: null };
          },
          signOut: async () => ({}),
        },
      }),
    };
  }, { clear: opts.clear !== false, local: opts.local || {}, session: opts.session || {}, idTokenError: opts.idTokenError || '' });

  await page.route(/^https:\/\/accounts\.google\.com\//, (route) => {
    seen.google.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>google</p>' });
  });
  await page.route(/^https?:\/\/(?!app\.example\.test|accounts\.google\.com)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/\/auth\/v1\/settings/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ external: { google: true } }) });
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
  });
  await page.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api/')) {
      if (u.pathname === '/api/public-config' && !u.searchParams.get('action')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.config || config()) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }) });
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending', null, { timeout: 15000 });
  return seen;
}

test('the press goes straight to Google with an ID-token request that returns to this domain, never via Supabase', async ({ page }) => {
  const seen = await open(page, `${ORIGIN}/onboarding.html`);
  await page.evaluate(() => window.__startGoogleSignIn__());
  await expect.poll(() => seen.google.length, { message: 'auth.js never sent the browser to Google' }).toBe(1);
  const u = new URL(seen.google[0]);
  expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  const q = Object.fromEntries(u.searchParams);
  expect(q).toMatchObject({ client_id: CLIENT, redirect_uri: ORIGIN + '/', response_type: 'id_token', scope: 'openid email profile', prompt: 'select_account' });
  expect(q.state).toMatch(/^[0-9a-f]{64}$/);
  // Back on the app's origin: what this tab kept, and that Google got only the hash.
  await page.goto(`${ORIGIN}/404.html`, { waitUntil: 'domcontentloaded' });
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('lc-google-idtoken') || 'null'));
  expect(saved.state).toBe(q.state);
  expect(q.nonce).toBe(crypto.createHash('sha256').update(saved.nonce).digest('hex'));
  expect(q.nonce).not.toBe(saved.nonce);
  expect(seen.google[0]).not.toContain('supabase');
});

test('the reply is exchanged with the raw nonce, the token leaves the address, and the person is sent back to their page', async ({ page }) => {
  const state = 'a'.repeat(64);
  const session = { 'lc-google-idtoken': JSON.stringify({ state, nonce: 'raw-nonce-1', at: Date.now() }) };
  await open(page, `${ORIGIN}/#id_token=HEADER.PAYLOAD.SIG&state=${state}&authuser=0`, { session, local: { 'lc-return-to': '/onboarding.html?step=2' } });
  await page.waitForURL(/\/onboarding\.html\?step=2$/, { timeout: 15000 });
  expect(page.url()).not.toContain('id_token');
  expect(await page.evaluate(() => sessionStorage.getItem('lc-google-idtoken'))).toBeNull();
});

test('the exchange itself: provider google, the token, the RAW nonce; state consumed; address cleaned', async ({ page }) => {
  const state = 'b'.repeat(64);
  const session = { 'lc-google-idtoken': JSON.stringify({ state, nonce: 'raw-nonce-2', at: Date.now() }) };
  await open(page, `${ORIGIN}/#id_token=TOK.EN.X&state=${state}`, { session });
  await expect.poll(() => page.evaluate(() => window.__idtoken.length)).toBe(1);
  expect(await page.evaluate(() => window.__idtoken[0])).toEqual({ provider: 'google', token: 'TOK.EN.X', nonce: 'raw-nonce-2' });
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(await page.evaluate(() => sessionStorage.getItem('lc-google-idtoken'))).toBeNull();
  await expect.poll(() => page.evaluate(() => window.LifecycleAuth.backend.kind)).toBe('signed-in');
  expect(await page.evaluate(() => window.__oauth.length)).toBe(0);
});

for (const c of [
  { name: 'a state this tab never started (a link carrying someone else\'s token)', saved: { state: 'c'.repeat(64), nonce: 'n', at: Date.now() }, hash: `#id_token=X.Y.Z&state=${'d'.repeat(64)}`, says: /did not match a sign-in started in this tab/ },
  { name: 'no state saved at all', saved: null, hash: `#id_token=X.Y.Z&state=${'e'.repeat(64)}`, says: /did not match/ },
  { name: 'a press older than 15 minutes', saved: { state: 'f'.repeat(64), nonce: 'n', at: Date.now() - 16 * 60 * 1000 }, hash: `#id_token=X.Y.Z&state=${'f'.repeat(64)}`, says: /more than 15 minutes/ },
  { name: 'the person cancelled at Google', saved: { state: '1'.repeat(64), nonce: 'n', at: Date.now() }, hash: `#error=access_denied&state=${'1'.repeat(64)}`, says: /cancelled at Google/ },
]) {
  test(`refused, said, and nothing exchanged: ${c.name}`, async ({ page }) => {
    const session = c.saved ? { 'lc-google-idtoken': JSON.stringify(c.saved) } : {};
    await open(page, `${ORIGIN}/${c.hash}`, { session });
    await expect(page.locator('#lnav-signin-note')).toContainText(c.says, { timeout: 10000 });
    expect(await page.evaluate(() => window.__idtoken.length)).toBe(0);
    expect(await page.evaluate(() => location.hash)).toBe('');
    expect(await page.evaluate(() => window.LifecycleAuth.backend.kind)).not.toBe('signed-in');
  });
}

test('Supabase refusing the token is said in its own words', async ({ page }) => {
  const state = '2'.repeat(64);
  const session = { 'lc-google-idtoken': JSON.stringify({ state, nonce: 'n', at: Date.now() }) };
  await open(page, `${ORIGIN}/#id_token=X.Y.Z&state=${state}`, { session, idTokenError: 'Nonces mismatch' });
  await expect(page.locator('#lnav-signin-note')).toContainText('Sign-in failed: Nonces mismatch', { timeout: 10000 });
  expect(await page.evaluate(() => location.hash)).toBe('');
});

for (const c of [
  { name: 'no Google config published', google: null },
  { name: 'this origin is not one Google may answer', google: { client_id: CLIENT, origins: ['https://other.example.test'] } },
]) {
  test(`falls back to the Supabase redirect, unchanged: ${c.name}`, async ({ page }) => {
    const seen = await open(page, `${ORIGIN}/onboarding.html`, { config: config(c.google) });
    await page.evaluate(() => window.__startGoogleSignIn__());
    await expect.poll(() => page.evaluate(() => window.__oauth.length)).toBe(1);
    expect(await page.evaluate(() => window.__oauth[0].options.redirectTo)).toBe(ORIGIN + '/');
    expect(seen.google.length).toBe(0);
  });
}

test('public-config publishes the client id and only well-formed origins, else nothing', async () => {
  const MOD = require.resolve('../api/public-config.js');
  const run = async (env) => {
    const keep = { ...process.env };
    Object.assign(process.env, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' }, env);
    for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
    delete require.cache[MOD];
    const handler = require(MOD);
    let body = null;
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, status(c) { this.statusCode = c; return this; }, json(b) { body = b; return this; }, send(b) { body = b; return this; }, end() { return this; } };
    await handler({ method: 'GET', url: '/api/public-config', query: {}, headers: {} }, res);
    process.env = keep;
    delete require.cache[MOD];
    return body && body.supabase && 'google' in body.supabase ? body.supabase.google : null;
  };
  expect(await run({ GOOGLE_SIGNIN_CLIENT_ID: CLIENT, GOOGLE_SIGNIN_ORIGINS: 'https://lifecycle-os.anchit-tandon.com/, javascript:alert(1), http://evil.test, https://lifecycle-os.anchit-tandon.com' }))
    .toEqual({ client_id: CLIENT, origins: ['https://lifecycle-os.anchit-tandon.com'] });
  expect(await run({ GOOGLE_SIGNIN_CLIENT_ID: 'not-a-client', GOOGLE_SIGNIN_ORIGINS: 'https://a.test' })).toBeNull();
  expect(await run({ GOOGLE_SIGNIN_CLIENT_ID: CLIENT, GOOGLE_SIGNIN_ORIGINS: undefined })).toBeNull();
});
