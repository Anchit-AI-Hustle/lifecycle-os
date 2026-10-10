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
 * ── SINCE 2026-09-28 ────────────────────────────────────────────────────────
 * Sign-in is a mobile number and a 4-digit PIN in the rail's own panel
 * (tests/mobile-pin-signin.spec.js); the Google redirect is commented out.
 * The guard this file drove (`__startGoogleSignIn__`) is gone WITH the
 * redirect, so the claim moves one level up: pressing Sign in opens the panel
 * on the current page and hands the browser to NO host - reachable, dead or
 * unconfigured alike. The stub still records any signInWithOAuth call, and
 * every navigation is still captured, so a redirect sneaking back shows up as
 * evidence. The "no baked-in project ref" file check stays as it was.
 *
 * ── 2026-10-09: PIN ONLY ───────────────────────────────────────────────────
 * Google sign-in ran again from 2026-10-05 to 2026-10-09 and is removed (not
 * commented out). The owner's words: "only keep PIN option, that too only
 * 4-digit". These tests hold the same claim as before - Sign in opens the
 * mobile number + PIN panel and starts no OAuth on any host - plus: the
 * signed-out brain calendar asks for that sign-in, and the checked-in Auth
 * config declares no OAuth provider and no email sign-up.
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
async function boot(page, { authHost, reachable, file = 'index.html' }) {
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

/** Press the rail's Sign in and read what happened: the panel, the OAuth stub, where the page is. */
async function pressAndRead(page) {
  const btn = page.locator('#lnav-signin');
  await btn.waitFor({ state: 'attached', timeout: 15000 });
  try { await btn.click({ timeout: 4000 }); } catch (e) {
    if (!/intercepts pointer events|Timeout/.test(String(e.message))) throw e;
    await btn.evaluate((el) => el.click());
  }
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    panel: !!document.getElementById('lnav-mauth'),
    panelOnPage: !!(document.getElementById('lnav-mauth') && document.getElementById('lifecycle-nav').contains(document.getElementById('lnav-mauth'))),
    oauth: (window.__OAUTH_CALLS__ || []).length,
    path: location.pathname,
    startGoogle: typeof window.__startGoogleSignIn__,
    google: /Sign in with (Google|Gmail)/i.test(document.body.innerText || ''),
  }));
}

test('an unreachable auth host: Sign in opens the mobile panel here and the browser is sent nowhere', async ({ page }) => {
  const navs = await boot(page, { authHost: 'https://deleted-project.supabase.co', reachable: false });
  const got = await pressAndRead(page);
  expect(got.oauth, 'signInWithOAuth was called for a host that does not resolve').toBe(0);
  expect(got.panel, 'no inline sign-in panel opened').toBe(true);
  expect(got.panelOnPage).toBe(true);
  expect(got.path).toBe('/index.html');
  expect(got.startGoogle, 'the Google guard is still exposed').toBe('undefined');
  expect(got.google).toBe(false);
  expect(navs.filter((u) => /authorize/.test(u)), 'the browser was navigated to the dead host anyway').toEqual([]);
});

test('a reachable auth host: the same panel, and still no redirect', async ({ page }) => {
  // A working Supabase project changes nothing about sign-in any more: the
  // account lives in the Neon database (or on this device), never with Google.
  await boot(page, { authHost: 'https://live-project.supabase.co', reachable: true });
  const got = await pressAndRead(page);
  expect(got.oauth, 'signInWithOAuth was called on a reachable host').toBe(0);
  expect(got.panel).toBe(true);
  expect(got.path).toBe('/index.html');
});

test('a deployment with no Supabase configuration: the same panel, and no redirect', async ({ page }) => {
  const navs = await boot(page, { authHost: '', reachable: false });
  // This harness serves from 127.0.0.1, and with no config auth.js seats its
  // "Local preview" stub in place of the Sign in chip - so the panel is
  // opened through the same entry point the chip and the brand gate call.
  await page.evaluate(() => window.LifecycleAuth.openSignIn());
  await page.waitForTimeout(400);
  const got = await page.evaluate(() => ({
    panel: !!document.getElementById('lnav-mauth'),
    oauth: (window.__OAUTH_CALLS__ || []).length,
    path: location.pathname,
  }));
  expect(got.oauth).toBe(0);
  expect(got.panel).toBe(true);
  expect(got.path).toBe('/index.html');
  expect(navs.filter((u) => /authorize/.test(u))).toEqual([]);
});

test('the brain calendar, signed out, asks for a mobile number and PIN and never starts OAuth', async ({ page }) => {
  await boot(page, { authHost: 'https://live-project.supabase.co', reachable: true, file: 'smart-brain.html' });
  await page.waitForFunction(() => {
    const t = (document.getElementById('plan') || {}).textContent || '';
    return /mobile number and 4-digit PIN/i.test(t) || /sign_in_required|Could not load the plan/i.test(t);
  }, null, { timeout: 15000 });
  const plan = await page.locator('#plan').innerText();
  expect(plan).toMatch(/mobile number and 4-digit PIN/i);
  expect(plan).not.toMatch(/gmail|google/i);
  expect(plan).not.toMatch(/sign_in_required/);
  expect(plan).not.toMatch(/Could not load the plan/i);
  const got = await pressAndRead(page);
  expect(got.oauth, 'signInWithOAuth was called').toBe(0);
  expect(got.panel).toBe(true);
  expect(got.startGoogle).toBe('undefined');
  expect(got.google).toBe(false);
  expect(got.path).toBe('/smart-brain.html');
});

test('a Google session left in storage by the removed sign-in is dropped on boot, and is not a session', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('sb-liveproject-auth-token', JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r', user: { id: 'g1', email: 'someone@gmail.com', app_metadata: { provider: 'google' } } }));
    localStorage.setItem('sb-liveproject-auth-token-code-verifier', 'v');
    localStorage.setItem('lc-return-to', '/smart-brain.html');
  });
  await boot(page, { authHost: 'https://live-project.supabase.co', reachable: true });
  const got = await page.evaluate(() => ({
    keys: Object.keys(localStorage).filter((k) => /^sb-|lc-return-to/.test(k)),
    user: window.LifecycleAuth && window.LifecycleAuth.user,
    token: window.LifecycleAuth && window.LifecycleAuth.apiToken(),
    path: location.pathname,
  }));
  expect(got.keys).toEqual([]);
  expect(got.user).toBeNull();
  expect(got.token).toBe('');
  expect(got.path, 'a stored return path still bounced the page').toBe('/index.html');
});

/* ═══ 3. configuration outranks a checked-in constant ═════════════════════ */

test('the checked-in Auth config declares no OAuth provider and no public or email sign-up', () => {
  // A claim about the FILE: `supabase config push` applies what is here.
  const src = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
  expect(src, 'an OAuth provider is declared').not.toMatch(/\[auth\.external\.[a-z_]+\]/);
  expect(src, 'an OAuth redirect allowlist is configured').toMatch(/additional_redirect_urls\s*=\s*\[\s*\]/);
  expect(src).toMatch(/\[auth\]\s*\n[\s\S]*?enable_signup\s*=\s*false/);
  expect(src, 'email sign-up is on').toMatch(/\[auth\.email\]\s*\n(?:#.*\n)*enable_signup\s*=\s*false/);
  expect(src, 'the phone provider the PIN broker needs is off').toMatch(/\[auth\.sms\]\s*\nenable_signup\s*=\s*true/);
  const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  expect(env).not.toMatch(/SUPABASE_AUTH_EXTERNAL_GOOGLE/);
  const selfhost = fs.readFileSync(path.join(ROOT, 'selfhost', 'docker-compose.yml'), 'utf8');
  expect(selfhost).not.toMatch(/GOTRUE_EXTERNAL_GOOGLE/);
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
