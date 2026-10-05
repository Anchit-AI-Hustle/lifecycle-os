/**
 * Sign-in never hands the browser to a host that is not there.
 * ---------------------------------------------------------------------------
 * THE OUTAGE. auth.js carried a hardcoded Supabase project as its last-resort
 * config. That project was later deleted, so any visitor whose
 * /api/public-config did not answer was redirected to
 * `<dead-ref>.supabase.co/auth/v1/authorize` and got Chrome's
 * DNS_PROBE_FINISHED_NXDOMAIN — no app error, no explanation, no way to tell
 * from inside the product what had gone wrong.
 *
 * It produced no error because `signInWithOAuth` NAVIGATES. The SDK did its job
 * perfectly: it started a redirect. Nothing in the app ever learned that the
 * destination does not exist. That is why a try/catch around the call could
 * never have caught this, and why the fix has to happen BEFORE the redirect.
 *
 * It was also the second time a baked-in ref went stale — the Mailer Studio's
 * own comment records being repointed off "a stale third project". A constant
 * that has to track an external resource drifts; on a multi-tenant platform, one
 * project ref is the same defect class as one brand's colour.
 *
 * ── SINCE 2026-10-05 ────────────────────────────────────────────────────────
 * Sign-in is Google again, through Supabase Auth. A dead or missing project
 * is still refused BEFORE signInWithOAuth, because that call navigates and a
 * dead host becomes Chrome's NXDOMAIN with no in-app error. A reachable host
 * whose GET /auth/v1/settings says external.google === false is also refused
 * (production: GoTrue 400 validation_failed "Unsupported provider: provider
 * is not enabled") - the chip names the host and the dashboard steps, and
 * authorize is never called (that would spend PKCE). Settings that cannot
 * be read fail OPEN, so a harness that only answers /health still starts
 * Google. A reachable host with Google on (or unread) starts Google with a
 * stable Site-URL redirectTo (origin + '/') and the Gmail account picker
 * (prompt=select_account), remembers the page the person was on, and does
 * not open the mobile PIN panel. The stub records every signInWithOAuth
 * call, and every navigation is still captured. The "no baked-in project
 * ref" file check stays as it was.
 *
 * Run: npx playwright test tests/signin-config.spec.js
 */
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

/* ═══ 1. nothing dead is shipped ══════════════════════════════════════════ */

test('no Supabase project ref is hardcoded into anything the browser runs', () => {
  // A claim about the FILE, and the right tool for it: the question is whether
  // the constant is still shipped, not what any code does with it. This is the
  // exact thing that broke, and it broke twice.
  const files = ['auth.js', 'brand-context.js', 'lifecycle_mailer_architect_v34.html'];
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    for (const m of src.matchAll(/https:\/\/([a-z0-9]{15,25})\.supabase\.co/g)) {
      offenders.push(`${f}: ${m[1]}`);
    }
  }
  expect(offenders, `a Supabase project is baked into shipped code: ${offenders.join(', ')}`).toEqual([]);
});

/* ═══ 2. the redirect is guarded, in a real browser ═══════════════════════ */

/**
 * Boot a page with auth.js, a stubbed Supabase SDK, and a config pointing at
 * `authHost`. `reachable` decides whether the health probe succeeds.
 *
 * Every navigation the page attempts is recorded and blocked, so a redirect to
 * a dead host shows up as evidence instead of as a broken test.
 */
async function boot(page, { authHost, reachable, googleEnabled, file = 'index.html' }) {
  const navigations = [];
  await page.addInitScript(() => {
    // A minimal stand-in for supabase-js: records the OAuth call, never leaves.
    window.__OAUTH_CALLS__ = [];
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async (opts) => { window.__OAUTH_CALLS__.push(opts); return { error: null }; },
          signOut: async () => ({}),
        },
      }),
    };
  });

  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    if (/\/auth\/v1\/health/.test(url)) {
      return reachable
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        : route.abort('addressunreachable');   // what a dead DNS name looks like
    }
    if (/\/auth\/v1\/settings/.test(url)) {
      // Production's document (2026-10-05): external.google === false.
      // Unstated means the request is aborted, which the app must fail OPEN
      // on - otherwise every existing reachable-host case would refuse Google.
      if (googleEnabled === undefined) return route.abort('failed');
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ external: { google: googleEnabled }, disable_signup: false }),
      });
    }
    if (/\/auth\/v1\/authorize/.test(url)) { navigations.push(url); return route.abort('failed'); }
    if (route.request().resourceType() === 'script') {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    }
    return route.abort('failed');
  });

  // Broad route FIRST: Playwright gives precedence to the last matching handler,
  // so registering the catch-all last makes it answer /api/public-config itself
  // — which looks exactly like a deployment with no Supabase configured, and
  // quietly turns both tests below into a test of the empty-config path.
  await page.route(/\/api\//, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }),
  }));
  await page.route(/\/api\/public-config/, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ supabase: { url: authHost, anonKey: 'anon-test-key' } }),
  }));

  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });
  await page.goto(base + '/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending'), null, { timeout: 15000 })
    .catch(() => {});
  return navigations;
}

/** Press the rail's Sign in and read what happened: the note, the OAuth stub, where the page is. */
async function pressAndRead(page) {
  const btn = page.locator('#lnav-signin');
  await btn.waitFor({ state: 'attached', timeout: 15000 });
  try { await btn.click({ timeout: 4000 }); } catch (e) {
    if (!/intercepts pointer events|Timeout/.test(String(e.message))) throw e;
    await btn.evaluate((el) => el.click());
  }
  await page.waitForFunction(() => {
    const n = document.getElementById('lnav-signin-note');
    return (window.__OAUTH_CALLS__ || []).length > 0 || !!(n && n.getAttribute('data-kind'));
  }, null, { timeout: 8000 });
  return page.evaluate(() => {
    const note = document.getElementById('lnav-signin-note');
    const btn = document.getElementById('lnav-signin');
    const call = (window.__OAUTH_CALLS__ || [])[0] || null;
    return {
      panel: !!document.getElementById('lnav-mauth'),
      oauth: (window.__OAUTH_CALLS__ || []).length,
      provider: call && call.provider,
      redirectTo: call && call.options && call.options.redirectTo,
      prompt: call && call.options && call.options.queryParams && call.options.queryParams.prompt,
      path: location.pathname,
      origin: location.origin,
      startGoogle: typeof window.__startGoogleSignIn__,
      kind: note ? note.getAttribute('data-kind') : null,
      note: note ? note.textContent : '',
      button: btn ? (btn.textContent || '').trim() : null,
    };
  });
}

test('an unreachable auth host: Sign in stays on this page, names the host, and the browser is sent nowhere', async ({ page }) => {
  const navs = await boot(page, { authHost: 'https://deleted-project.supabase.co', reachable: false });
  const got = await pressAndRead(page);
  expect(got.oauth, 'signInWithOAuth was called for a host that does not resolve').toBe(0);
  expect(got.panel, 'the mobile PIN panel opened').toBe(false);
  expect(got.path).toBe('/index.html');
  expect(got.startGoogle, 'the Google guard is not exposed').toBe('function');
  expect(got.kind).toBe('unreachable');
  expect(got.note).toMatch(/deleted-project\.supabase\.co/);
  expect(got.note).toMatch(/Sign in with Google/i);
  expect(got.button).toBe('Sign-in unavailable');
  expect(navs.filter((u) => /authorize/.test(u)), 'the browser was navigated to the dead host anyway').toEqual([]);
});

test('Google off on the Auth project: Sign in stays here, names the host, and never starts OAuth', async ({ page }) => {
  // The live project on 2026-10-05: GET /auth/v1/settings → google:false,
  // GET /auth/v1/authorize → 400 validation_failed "Unsupported provider:
  // provider is not enabled". The chip must say that BEFORE the redirect,
  // because signInWithOAuth navigates and the person otherwise sees JSON.
  const navs = await boot(page, {
    authHost: 'https://live-project.supabase.co',
    reachable: true,
    googleEnabled: false,
  });
  const got = await pressAndRead(page);
  expect(got.oauth, 'signInWithOAuth was called for a project whose Google provider is off').toBe(0);
  expect(got.panel, 'the mobile PIN panel opened').toBe(false);
  expect(got.kind).toBe('provider-off');
  expect(got.note).toMatch(/live-project\.supabase\.co/);
  expect(got.note).toMatch(/provider is not enabled/i);
  expect(got.note).toMatch(/Authentication/);
  expect(got.note).toMatch(/https:\/\/live-project\.supabase\.co\/auth\/v1\/callback/);
  expect(got.button).toBe('Sign-in unavailable');
  expect(got.path).toBe('/index.html');
  expect(navs.filter((u) => /authorize/.test(u)), 'authorize was fetched (that spends the PKCE verifier)').toEqual([]);
  const bar = await page.locator('#lc-authnotice').getAttribute('data-kind');
  expect(bar, 'the standing bar kept saying signed-out after the chip named the real cause').toBe('provider-off');
});

test('a reachable auth host: Sign in starts Google on this page and does not open the PIN panel', async ({ page }) => {
  await boot(page, { authHost: 'https://live-project.supabase.co', reachable: true });
  const got = await pressAndRead(page);
  expect(got.oauth, 'signInWithOAuth was not called on a reachable host').toBe(1);
  expect(got.provider).toBe('google');
  expect(got.redirectTo).toBe(got.origin + '/');
  expect(got.prompt).toBe('select_account');
  expect(got.panel).toBe(false);
  expect(got.kind).toBeNull();
  expect(got.path).toBe('/index.html');
  expect(await page.evaluate(() => localStorage.getItem('lc-return-to'))).toBe('/index.html');
});

test('a deployment with no Supabase configuration: Sign in says what is missing, and no redirect', async ({ page }) => {
  const navs = await boot(page, { authHost: '', reachable: false });
  // This harness serves from 127.0.0.1, and with no config auth.js seats its
  // "Local preview" stub in place of the Sign in chip. The same entry point
  // the chip and the brand gate call still refuses Google before any redirect.
  const message = await page.evaluate(() => window.LifecycleAuth.openSignIn());
  const got = await page.evaluate(() => ({
    panel: !!document.getElementById('lnav-mauth'),
    oauth: (window.__OAUTH_CALLS__ || []).length,
    path: location.pathname,
  }));
  expect(got.oauth).toBe(0);
  expect(got.panel).toBe(false);
  expect(message).toMatch(/SUPABASE_URL/);
  expect(message).toMatch(/Sign in with Google/i);
  expect(got.path).toBe('/index.html');
  expect(navs.filter((u) => /authorize/.test(u))).toEqual([]);
});

test('the brain calendar, signed out, asks for Google and never shows the missing PIN schema', async ({ page }) => {
  await boot(page, { authHost: 'https://live-project.supabase.co', reachable: true, file: 'smart-brain.html' });
  await page.waitForFunction(() => {
    const t = (document.getElementById('plan') || {}).textContent || '';
    return /sign in with google/i.test(t) || /sign_in_required|mobile_pin|Could not load the plan/i.test(t);
  }, null, { timeout: 15000 });
  const plan = await page.locator('#plan').innerText();
  expect(plan).toMatch(/sign in with google/i);
  expect(plan).not.toMatch(/sign_in_required/);
  expect(plan).not.toMatch(/mobile_pin/);
  expect(plan).not.toMatch(/Could not load the plan/i);
  expect(await page.locator('#changes').innerText()).not.toMatch(/env not linked/i);
  expect(await page.locator('#lnav-mauth').count()).toBe(0);
  const got = await pressAndRead(page);
  expect(got.oauth).toBe(1);
  expect(got.provider).toBe('google');
  expect(got.redirectTo).toBe(got.origin + '/');
  expect(got.prompt).toBe('select_account');
  expect(got.panel).toBe(false);
  expect(got.path).toBe('/smart-brain.html');
  expect(await page.evaluate(() => localStorage.getItem('lc-return-to'))).toBe('/smart-brain.html');
});

test('a Site-URL bounce sends the person back to the page they signed in from', async ({ page }) => {
  await boot(page, { authHost: 'https://live-project.supabase.co', reachable: true, file: 'index.html' });
  await page.waitForFunction(() => !!(window.LifecycleAuth && typeof window.LifecycleAuth.restoreReturnTo === 'function'), null, { timeout: 15000 });
  await page.evaluate(() => {
    localStorage.setItem('lc-return-to', '/smart-brain.html');
    window.LifecycleAuth.restoreReturnTo();
  });
  await page.waitForURL(/\/smart-brain\.html$/, { timeout: 8000 });
  expect(await page.evaluate(() => localStorage.getItem('lc-return-to'))).toBeNull();
});

/* ═══ 3. configuration outranks a checked-in constant ═════════════════════ */

test('the checked-in Auth config enables Google and allowlists the production origin', () => {
  // A claim about the FILE: supabase config push is what turns the hosted
  // provider on, and this file is what it would push. An empty allowlist
  // plus no [auth.external.google] is how the live project stayed off.
  const src = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
  expect(src, 'Google is not declared').toMatch(/\[auth\.external\.google\]/);
  expect(src, 'Google is not enabled').toMatch(/\[auth\.external\.google\][\s\S]*?enabled\s*=\s*true/);
  expect(src, 'the client id is committed rather than taken from the environment')
    .toMatch(/client_id\s*=\s*"env\(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID\)"/);
  expect(src, 'the client secret is committed rather than taken from the environment')
    .toMatch(/secret\s*=\s*"env\(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET\)"/);
  expect(src).toMatch(/https:\/\/lifecycle-os\.anchit-tandon\.com\/\*\*/);
});

test('the environment beats the pinned linked-db file', () => {
  // The same defect on the server: data/linked-db.json used to outrank the env,
  // so a deployment that set SUPABASE_URL correctly still addressed whatever
  // project the file named — and that project was the deleted one.
  const CORE = path.join(ROOT, 'api', '_shared', 'brain-core.js');
  const resolve = (env) => {
    for (const k of Object.keys(process.env)) {
      if (/^(SUPABASE_|SMART_BRAIN_|NEXT_PUBLIC_)/.test(k)) delete process.env[k];
    }
    Object.assign(process.env, env);
    delete require.cache[require.resolve(CORE)];
    return require(CORE).db().url;
  };

  expect(resolve({ SUPABASE_URL: 'https://live.supabase.co', SUPABASE_ANON_KEY: 'k' }))
    .toBe('https://live.supabase.co');
  // An explicit Smart Brain override still wins over both.
  expect(resolve({
    SMART_BRAIN_SUPABASE_URL: 'https://smart.supabase.co', SMART_BRAIN_SUPABASE_KEY: 'k',
    SUPABASE_URL: 'https://live.supabase.co', SUPABASE_ANON_KEY: 'k',
  })).toBe('https://smart.supabase.co');
  // With nothing configured there is NOTHING: data/linked-db.json ships empty
  // since the self-hosting work (2026-09-15), because the hosted ref it
  // carried paused and every reader kept dialling it. A fresh clone with no
  // env now reports "unconfigured" instead of addressing a dead host.
  expect(resolve({})).toBe('');
});
