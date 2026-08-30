/**
 * A signed-out visitor is never blocked, anywhere.
 * ---------------------------------------------------------------------------
 * WHY. auth.js walled every page that was not the homepage, a legal page or the
 * Studio. When the Supabase project was deleted that wall became unpassable —
 * getting past it needed the very project that no longer existed — and the
 * whole product was unreachable rather than gated. The wall is now gone
 * outright: signed out is a usable state, not a locked one.
 *
 * WHY THAT IS NOT AN AUTH BYPASS. The wall was never the security boundary and
 * could not have been. The anon key it gated is PUBLIC by design: it ships in
 * the browser and /api/public-config hands it to anyone who asks, so whatever
 * the wall "protected" was always one curl away. ROW LEVEL SECURITY is the
 * boundary — 74 `is_brand_member` policies and 135 `auth.uid()` checks across
 * the migrations. With no session `auth.uid()` is null, every one of those
 * fails, and a signed-out caller reads nothing. The last test in this file pins
 * that, because the whole decision rests on it: if those policies ever stop
 * gating, removing the wall stops being safe.
 *
 * FOUR SIGNED-OUT STATES, each told apart because they need different words —
 * and only three of them are anyone's to fix:
 *   - unconfigured: no SUPABASE_URL at all.
 *   - CONFIGURED BUT GONE: the env var still set, still naming the deleted
 *     project. `config` is therefore truthy, so every "is it configured" check
 *     passed and the wall used to go up reading "Sign in to continue" with no
 *     cause named, over a button that navigated to a host that does not
 *     resolve. This is the state production was actually left in.
 *   - sdk: the supabase-js CDN was blocked. This one used to render NOTHING at
 *     all — see the CDN test below.
 *   - signed-out: everything works, this visitor simply has no session.
 *
 * WHAT MUST NOT REGRESS: opening the UI must never fabricate a signed-in state.
 * `LifecycleAuth.user` stays null and `internal` stays false, because `internal`
 * is what grants full live access in applyAccessMode.
 *
 * Run: npx playwright test tests/signed-out-usable.spec.js
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

/** Every page a visitor can actually reach, from the repo itself. */
const PAGES = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  .filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('auth.js'))
  .sort();

/**
 * Serve a page as a REAL host with the given public-config.
 *
 * The hostname matters: auth.js treats localhost as a dev preview and never
 * walls it, so serving this from 127.0.0.1 would pass no matter what the
 * production branch does. Hence app.example.test, whose requests are answered
 * from the repo by an interception route rather than by a local server.
 */
async function open(page, file, { config, reachable = true }) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));

  // A stand-in for supabase-js, so the WITH_BACKEND case exercises the real
  // gating path instead of dying on a CDN script this harness has blocked.
  await page.addInitScript(() => {
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async () => ({ error: null }),
          signOut: async () => ({}),
        },
      }),
    };
  });

  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    // The auth-host health probe decides whether the app believes the backend
    // is THERE, so the harness has to answer it deliberately. Letting the
    // catch-all abort it made a "live backend" fixture read as unreachable, so
    // the app opened and the auth-bypass guard below failed — the fixture
    // lying, not the app misbehaving. `reachable` is now stated per case.
    if (/\/auth\/v1\/health/.test(route.request().url())) {
      return reachable
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        : route.abort('addressunreachable');   // what a deleted project looks like
    }
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    // An ESM import needs a MODULE back. Returning a classic script made
    // `import { animate } from '…/+esm'` throw "does not provide an export
    // named 'animate'" — a failure this harness caused, which would then be
    // reported as the page being broken. Named exports are provided via a
    // Proxy so any name a page imports resolves to a no-op.
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: esm
        ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});'
          + 'export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};',
    });
  });

  // ORDER: broadest first, most specific LAST — Playwright's last matching
  // route wins. Registering the file server last made it answer
  // /api/public-config from disk, which 404s, which looks exactly like a
  // deployment with no Supabase configured. Both backend cases then silently
  // tested the SAME no-config path, and the test guarding against an auth
  // bypass could not have failed.
  await page.route('http://app.example.test/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      return route.fulfill({ status: 404, body: 'nf' });
    }
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }),
  }));
  await page.route(/\/api\/public-config/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(config),
  }));

  await page.goto('http://app.example.test/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  return errors;
}

const NO_BACKEND = { ok: true };                                     // no supabase key at all
const WITH_BACKEND = { supabase: { url: 'https://live.supabase.co', anonKey: 'anon' } };
// The state production was actually left in: the env var is still set, it just
// names a project that no longer exists.
const DEAD_BACKEND = { supabase: { url: 'https://deleted-project.supabase.co', anonKey: 'anon' } };

async function wallShown(page) {
  return page.evaluate(() => {
    const wall = document.getElementById('lifecycle-loginwall');
    if (!wall) return false;
    // NOT offsetParent. The wall is `position: fixed`, and a fixed element's
    // offsetParent is null by definition — so the obvious visibility check
    // reported "no wall" for a wall that was covering the entire viewport, and
    // the test that guards against an auth bypass could never have failed.
    const s = getComputedStyle(wall);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  });
}

/* ═══ the sweep found real pages ══════════════════════════════════════════ */

test('the page list is real', () => {
  // A sweep over nothing passes everything.
  expect(PAGES.length, 'no pages carrying auth.js were found').toBeGreaterThan(20);
  expect(PAGES).toContain('index.html');
  expect(PAGES).toContain('smart-brain.html');
});

/* ═══ with no backend: open, navigable, and honest about it ═══════════════ */

test('a page is not blocked when there is no backend to sign in to', async ({ page }) => {
  const errors = await open(page, 'smart-brain.html', { config: NO_BACKEND });
  expect(await wallShown(page), 'a login wall was shown').toBe(false);
  await expect(page.locator('#lifecycle-nav'), 'the nav did not render, so nothing is reachable').toHaveCount(1);
  expect(errors.filter((e) => !/ResizeObserver/.test(e)), `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the state is explained rather than left as an empty page', async ({ page }) => {
  await open(page, 'smart-brain.html', { config: NO_BACKEND });
  const bar = page.locator('#lc-authnotice');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/SUPABASE_URL/);
  // It must say the two things a user needs: why it is empty, and that nothing
  // they do here is being saved.
  await expect(bar).toContainText(/nothing is loaded from or saved to a server/i);
});

test('the notice is readable, on the brand surface and never on a dark ground', async ({ page }) => {
  await open(page, 'smart-brain.html', { config: NO_BACKEND });
  const seen = await page.locator('#lc-authnotice').evaluate((el) => {
    const s = getComputedStyle(el);
    const rgb = (v) => (v.match(/\d+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const a = c.map((x) => { const y = x / 255; return y <= 0.03928 ? y / 12.92 : Math.pow((y + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
    const bg = rgb(s.backgroundColor), fg = rgb(s.color);
    const L1 = lum(bg), L2 = lum(fg);
    return { bgLum: L1, ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) };
  });
  expect(seen.bgLum, 'the notice sits on a dark ground, which this repo forbids').toBeGreaterThan(0.4);
  expect(seen.ratio, 'the notice text is under WCAG AA').toBeGreaterThanOrEqual(4.5);
});

test('EVERY page carrying auth.js opens without a block and without throwing', async ({ page }) => {
  test.setTimeout(900_000);
  // BOTH configurations, because they used to take different paths and only
  // one of them was ever swept. With a LIVE backend is the case that matters
  // most: it is the state the deployment returns to once Supabase is set, and
  // it is where the wall used to appear on every page in this list.
  const cases = [
    ['no backend', { config: NO_BACKEND }],
    ['live backend, signed out', { config: WITH_BACKEND, reachable: true }],
  ];
  const blocked = [], broken = [];
  for (const [label, opts] of cases) {
    for (const f of PAGES) {
      const errors = await open(page, f, opts);
      if (await wallShown(page)) blocked.push(`${f} (${label})`);
      const real = errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e));
      if (real.length) broken.push(`${f} (${label}): ${real[0]}`);
    }
  }
  expect(blocked, `these pages blocked a signed-out visitor:\n  ${blocked.join('\n  ')}`).toEqual([]);
  expect(broken, `these pages threw:\n  ${broken.join('\n  ')}`).toEqual([]);
});

/* ═══ configured, but the project is gone ═════════════════════════════════ */

test('a deployment pointing at a DELETED project opens, and names the host', async ({ page }) => {
  // THE CASE THE OUTAGE ACTUALLY LEFT PRODUCTION IN, and the one the no-config
  // branch does not cover: SUPABASE_URL was still set, so `config` is truthy
  // and every "is it configured" check passed. The wall went up saying
  // "Sign in to continue" — no cause named — over a button that navigated the
  // browser to a host that does not resolve.
  await open(page, 'smart-brain.html', { config: DEAD_BACKEND, reachable: false });
  expect(await page.evaluate(() => (window.__SUPABASE__ || {}).url || ''),
    'the dead-backend fixture never reached the page').toBe('https://deleted-project.supabase.co');
  expect(await wallShown(page), 'an unpassable wall was shown for a project that does not exist').toBe(false);
  const bar = page.locator('#lc-authnotice');
  await expect(bar).toBeVisible();
  // Naming the host is the difference between a status and a remedy: it is the
  // value the operator has to change.
  await expect(bar).toContainText('deleted-project.supabase.co');
  await expect(bar).toContainText(/deleted, renamed or paused/i);
});

/* ═══ a LIVE backend does not gate either ════════════════════════════════ */

test('with a live backend, a signed-out visitor is still not blocked', async ({ page }) => {
  // SUPERSEDED, deliberately, and this is the assertion that used to say the
  // opposite. It was the right guard while the wall was believed to be
  // protecting something. It is not: see the header. What replaces it is not
  // "no check at all" but a check of the thing that actually protects data,
  // in the test below.
  await open(page, 'smart-brain.html', { config: WITH_BACKEND, reachable: true });
  // The config actually reached the page. Without this the test can pass while
  // measuring the no-config path, which is exactly what it must not do.
  expect(await page.evaluate(() => (window.__SUPABASE__ || {}).url || ''),
    'the backend fixture never reached the page').toBe('https://live.supabase.co');
  expect(await wallShown(page), 'a signed-out visitor was blocked').toBe(false);
  await expect(page.locator('#lifecycle-nav'), 'the nav did not render').toHaveCount(1);
  // Told, not blocked: an empty panel must read as "not signed in", never as
  // "no data".
  const bar = page.locator('#lc-authnotice');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/you are signed out/i);
  await expect(bar).toContainText(/load once you sign in/i);
  // ...and it must NOT claim the deployment is broken. That is a different
  // state with a different remedy, and crying outage on a healthy deployment
  // is how a notice teaches people to ignore it.
  await expect(bar).not.toContainText(/cannot be reached|Running without a database/i);
});

test('opening the UI does not fabricate a signed-in state', async ({ page }) => {
  // The real risk in removing a wall is not the wall: it is that some flag
  // downstream starts reading "signed in" because the page is now visible.
  // `internal` is what grants full live access in applyAccessMode.
  await open(page, 'smart-brain.html', { config: WITH_BACKEND, reachable: true });
  const auth = await page.evaluate(() => ({
    user: (window.LifecycleAuth || {}).user || null,
    session: (window.LifecycleAuth || {}).session || null,
    internal: (window.LifecycleAuth || {}).internal,
  }));
  expect(auth.user, 'a user appeared without signing in').toBeNull();
  expect(auth.session, 'a session appeared without signing in').toBeNull();
  expect(auth.internal, 'a signed-out visitor was granted internal access').toBe(false);
});

/* ═══ the failure that renders nothing at all ════════════════════════════ */

test('a blocked supabase-js CDN still leaves a usable page', async ({ page }) => {
  // init() is async and used to be invoked with NO catch, so a rejection - most
  // realistically the SDK CDN blocked by an ad blocker or a network policy -
  // became an unhandled promise rejection and the page rendered NOTHING: no
  // nav, no notice, no reason. Measured before the fix: nav=false, no notice.
  // A blank page is the least actionable failure there is, and it is the one
  // state that makes "every page is usable signed out" untrue.
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  // Deliberately NO window.supabase stub: the SDK genuinely fails to load.
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    if (/jsdelivr|supabase/.test(route.request().url())) return route.abort('failed');
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    return route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: 'const noop=()=>{};export default new Proxy({},{get:()=>noop});'
        + 'export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});',
    });
  });
  await page.route('http://app.example.test/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      return route.fulfill({ status: 404, body: 'nf' });
    }
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
  }));
  await page.route(/\/api\/public-config/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(WITH_BACKEND),
  }));
  await page.goto('http://app.example.test/smart-brain.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  // The NAV is the assertion that matters: without it nothing is reachable,
  // whatever else the page painted.
  await expect(page.locator('#lifecycle-nav'),
    'the nav never rendered, so no feature is reachable').toHaveCount(1);
  expect(await wallShown(page), 'a block was shown').toBe(false);
  const bar = page.locator('#lc-authnotice');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/Supabase library did not load/i);
  // And it says what to DO. "Sign-in unavailable" alone is not actionable.
  await expect(bar).toContainText(/cdn\.jsdelivr\.net/);
  expect(errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e)),
    `page errors: ${errors.join(' | ')}`).toEqual([]);
});

/* ═══ the boundary the whole decision rests on ═══════════════════════════ */

test('brand data is gated by RLS, not by the wall that was removed', () => {
  // A claim about the FILES, and a file check is the right tool for it: the
  // question is which policies the migrations DECLARE, not what any code does
  // at runtime, and no Supabase instance is reachable from this suite.
  //
  // This is load-bearing. Removing the login wall is only safe because these
  // policies exist; if a permissive `anon` policy is ever added to a brand
  // table, the decision recorded in this file's header quietly stops holding.
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const sql = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

  // The gates are still there, in force.
  expect((sql.match(/auth\.uid\(\)/g) || []).length,
    'the auth.uid() policies that protect brand data have thinned out').toBeGreaterThan(100);
  expect((sql.match(/is_brand_member/g) || []).length,
    'the is_brand_member policies that scope rows to a workspace have thinned out').toBeGreaterThan(50);

  // And the anon-reachable surface has not GROWN.
  //
  // Be honest about what this pins, because it is NOT "nothing is anon-open".
  // Some objects deliberately are, and every one of them predates this change:
  //   - four aggregate VIEWS, all `security_invoker=on`, so RLS still applies
  //     through them;
  //   - smart_generated_campaigns + smart_brain_runs, opened on purpose in
  //     20260719120000 (with `using (true)` policies) so /lp/:id can serve a
  //     generated landing page on the anon key when SUPABASE_SERVICE_ROLE_KEY
  //     is not set.
  //
  // NONE of that is affected by removing the login wall, in either direction.
  // /api/public-config hands the anon key to every visitor, so anything
  // reachable with it was always one curl away — wall or no wall. The wall was
  // never what kept anyone out of these, which is the same reason removing it
  // is not an auth bypass.
  //
  // What this test does is hold the line: a NEW anon grant fails here and has
  // to be argued for, instead of quietly widening what "signed out" can reach.
  const KNOWN_ANON_OPEN = [
    /knickgasm_campaigns_by_(type|user|market|regen)/,   // security_invoker views
    /^public\.smart_generated_campaigns$/,               // /lp/:id on the anon key
    /^public\.smart_brain_runs$/,
    /^public\.%I$/,                                      // a format() string, not an object
    /^views$/,                                           // prose in a comment, not an object
  ];
  const leaks = [...sql.matchAll(/GRANT\s+[^;]*?\bON\s+([^\s;]+)[^;]*?\bTO\s+[^;]*\banon\b/gi)]
    .map((m) => m[1])
    .filter((t) => !KNOWN_ANON_OPEN.some((re) => re.test(t)));
  expect(leaks, `NEW objects granted to anonymous callers: ${leaks.join(', ')}`).toEqual([]);
});
