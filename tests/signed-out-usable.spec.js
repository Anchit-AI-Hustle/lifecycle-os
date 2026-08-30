/**
 * With no backend to sign in to, every page is still usable.
 * ---------------------------------------------------------------------------
 * WHY. The Supabase project this app pointed at was deleted. auth.js then fell
 * through to `injectLoginWall()` on every page that is not the homepage, a
 * legal page or the Studio — a wall nobody could get past, because getting past
 * it needs the very project that no longer exists. The whole product became
 * unreachable, not gated.
 *
 * A login wall exists to keep unauthorised people away from DATA. With no
 * reachable backend there is no session to obtain and no query that can
 * succeed, so there is nothing on the other side to protect. The wall cost
 * every feature and defended nothing.
 *
 * TWO CASES, and the second is the one production was actually left in:
 *   - unconfigured: no SUPABASE_URL at all.
 *   - CONFIGURED BUT GONE: the env var is still set and still points at the
 *     deleted project. `config` is therefore truthy, so every "is it
 *     configured" check passed and the wall went up reading "Sign in to
 *     continue" — no cause named — over a button that navigated the browser to
 *     a host that does not resolve. Fixing only the first case would have left
 *     the live deployment exactly as broken as it was found.
 *
 * THE LINE THIS MUST NOT CROSS, and the last test is the one that matters: a
 * REACHABLE backend still gates. Opening the app when there is no data behind
 * it is not the same as opening the data. The probe fails closed on doubt — a
 * timeout counts as reachable — so a slow network keeps the wall.
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

test('a gated page is not walled when there is no backend to sign in to', async ({ page }) => {
  const errors = await open(page, 'smart-brain.html', { config: NO_BACKEND });
  expect(await wallShown(page), 'an unpassable login wall was shown').toBe(false);
  await expect(page.locator('#lifecycle-nav'), 'the nav did not render, so nothing is reachable').toHaveCount(1);
  expect(errors.filter((e) => !/ResizeObserver/.test(e)), `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the state is explained rather than left as an empty page', async ({ page }) => {
  await open(page, 'smart-brain.html', { config: NO_BACKEND });
  const bar = page.locator('#lc-nobackend');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/SUPABASE_URL/);
  // It must say the two things a user needs: why it is empty, and that nothing
  // they do here is being saved.
  await expect(bar).toContainText(/nothing is loaded from or saved to a server/i);
});

test('the notice is readable, on the brand surface and never on a dark ground', async ({ page }) => {
  await open(page, 'smart-brain.html', { config: NO_BACKEND });
  const seen = await page.locator('#lc-nobackend').evaluate((el) => {
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

test('every page carrying auth.js opens without a wall and without throwing', async ({ page }) => {
  test.setTimeout(600_000);
  const walled = [], broken = [];
  for (const f of PAGES) {
    const errors = await open(page, f, { config: NO_BACKEND });
    if (await wallShown(page)) walled.push(f);
    const real = errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e));
    if (real.length) broken.push(`${f}: ${real[0]}`);
  }
  expect(walled, `these pages are unreachable with no backend:\n  ${walled.join('\n  ')}`).toEqual([]);
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
  const bar = page.locator('#lc-nobackend');
  await expect(bar).toBeVisible();
  // Naming the host is the difference between a status and a remedy: it is the
  // value the operator has to change.
  await expect(bar).toContainText('deleted-project.supabase.co');
  await expect(bar).toContainText(/deleted, renamed or paused/i);
});

/* ═══ the line: a real backend still gates ════════════════════════════════ */

test('with a backend configured, a signed-out visitor still meets the wall', async ({ page }) => {
  // The whole change is conditional on there being NO configuration. If this
  // ever passes for a configured deployment, the fix has become an auth bypass.
  await open(page, 'smart-brain.html', { config: WITH_BACKEND, reachable: true });
  // The config actually reached the page. Without this the test can pass while
  // measuring the no-config path, which is what it is meant to rule out.
  expect(await page.evaluate(() => (window.__SUPABASE__ || {}).url || ''),
    'the backend fixture never reached the page').toBe('https://live.supabase.co');
  expect(await wallShown(page), 'a configured deployment stopped gating signed-out users').toBe(true);
  await expect(page.locator('#lc-nobackend'), 'the no-backend notice showed on a configured deployment').toHaveCount(0);
});
