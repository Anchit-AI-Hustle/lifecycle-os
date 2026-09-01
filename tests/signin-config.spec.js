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
async function boot(page, { authHost, reachable }) {
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
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.LifecycleAuth && window.LifecycleAuth.client), null, { timeout: 15000 })
    .catch(() => {});
  return navigations;
}

test('an unreachable auth host is refused before the browser is sent there', async ({ page }) => {
  const navs = await boot(page, { authHost: 'https://deleted-project.supabase.co', reachable: false });

  const result = await page.evaluate(async () => {
    // Drive the real guard the sign-in buttons call.
    const msg = await window.__startGoogleSignIn__();
    return { msg, oauth: (window.__OAUTH_CALLS__ || []).length };
  });

  expect(result.oauth, 'signInWithOAuth was called for a host that does not resolve').toBe(0);
  expect(result.msg, 'the refusal was silent').toBeTruthy();
  expect(result.msg).toMatch(/cannot be reached|does not resolve/i);
  // It has to say what to DO. "Sign-in failed" is what the browser already said.
  expect(result.msg).toMatch(/SUPABASE_URL/);
  expect(result.msg).toMatch(/deleted-project\.supabase\.co/);
  expect(navs.filter((u) => /authorize/.test(u)), 'the browser was navigated to the dead host anyway').toEqual([]);
});

test('a reachable auth host signs in normally', async ({ page }) => {
  // The guard must not become the new outage: a working project still works.
  await boot(page, { authHost: 'https://live-project.supabase.co', reachable: true });
  const result = await page.evaluate(async () => {
    const msg = await window.__startGoogleSignIn__();
    return { msg, oauth: (window.__OAUTH_CALLS__ || []).length };
  });
  expect(result.msg, `sign-in was blocked on a reachable host: ${result.msg}`).toBe('');
  expect(result.oauth).toBe(1);
});

test('a deployment with no Supabase configuration says so, and does not redirect', async ({ page }) => {
  const navs = await boot(page, { authHost: '', reachable: false });
  const result = await page.evaluate(async () => {
    const msg = await window.__startGoogleSignIn__();
    return { msg, oauth: (window.__OAUTH_CALLS__ || []).length };
  });
  expect(result.oauth).toBe(0);
  expect(result.msg).toMatch(/no Supabase configuration|SUPABASE_URL/i);
  expect(navs.filter((u) => /authorize/.test(u))).toEqual([]);
});

/* ═══ 3. configuration outranks a checked-in constant ═════════════════════ */

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
  // With nothing configured the pinned file is still the last resort, so a
  // fresh clone behaves as before.
  expect(resolve({})).toMatch(/supabase\.co$/);
});
