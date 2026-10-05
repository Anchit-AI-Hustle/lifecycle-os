/**
 * Nothing in this app is said through a native dialog.
 * ---------------------------------------------------------------------------
 * SEEN ON THE LIVE DEPLOYMENT (/retention-playbook). The Supabase project is
 * paused, the app correctly opens signed-out and the standing bar says so -
 * and then pressing the rail's Sign-in button popped a browser dialog titled
 *
 *     lifecycle-os.anchit-tandon.com says
 *
 * reading "...(fswdwmkgggzyxrdzabnh.supabase.co does not resolve). Its Supabase
 * project has been deleted or renamed. Set SUPABASE_URL and ...". Two
 * independent defects in one screenshot:
 *
 *   1. A native alert() is not this app's failure surface. It blocks the page,
 *      it carries the HOSTNAME as its title so it reads as an error in the
 *      site, it cannot take the brand's tokens, and it is invisible to every
 *      rendered-failure gate in tests/ - none of them registers a dialog
 *      listener, so a dialog is a failure that no test can see.
 *   2. Two sentences for one state. The bar said the project "has most likely
 *      been deleted, renamed or paused" (correct: a paused project and a
 *      deleted one are indistinguishable from the network - CLAUDE.md records
 *      the correction) while the alert said "has been deleted or renamed", a
 *      definite claim the code cannot make. One state must have ONE sentence
 *      source; auth.js now renders both surfaces from signedOutSentence(kind).
 *
 * The same audit covered every alert()/confirm() in the app pages and shared
 * scripts. A confirm() guarding a destructive action stays (Start New, Clear
 * all data, Delete, Disconnect, turn on live publishing). Every alert() went:
 * a FAILURE renders through window.LifecycleFailure into a slot beside the
 * control, a precondition or receipt renders as an inline .vh-status line, a
 * blocked pop-up (a browser state) is said beside the link that asked for it.
 *
 * WHY THESE TESTS LOAD PAGES AND CLICK. A grep for `alert(` would pass a page
 * whose alert moved behind a helper, and would not know whether the inline
 * note actually rendered or whether the bar and the button agree. So every
 * check here registers page.on('dialog') BEFORE navigation (a dialog fired
 * during load is the worst case), presses the real control, and asserts on
 * what is RENDERED. Each asserts it measured something first: a check that
 * inspects nothing passes everything.
 *
 * THE FIXTURE STATES REACHABILITY PER CASE - the lesson of
 * signed-out-usable.spec.js: a catch-all route that aborts the /auth/v1/health
 * probe manufactures "unreachable" and would make a live backend look dead.
 *
 * Run: npx playwright test tests/no-native-dialogs.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown' };

/**
 * Every page that LOADS auth.js, from the repo itself - a <script src>, not a
 * mention. campaign.html says "auth.js" in a comment explaining why it
 * deliberately does not load it (it document.write()s an artefact over itself),
 * so it has no rail and no Sign-in button to press.
 */
const PAGES = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  .filter((f) => /<script[^>]+src=["'][^"']*\bauth\.js/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  .sort();

const NO_BACKEND = { ok: true };
const WITH_BACKEND = { supabase: { url: 'https://live.supabase.co', anonKey: 'anon' } };
// The state production was actually left in: the env var still set, naming a
// host that does not resolve. Paused, renamed and deleted look the same here.
const DEAD_BACKEND = { supabase: { url: 'https://deleted-project.supabase.co', anonKey: 'anon' } };

/** What a paused Supabase project actually makes an authenticated call answer. */
const PAUSED = {
  status: 503, contentType: 'application/json',
  body: JSON.stringify({ ok: false, error: 'session_verification_unavailable',
    message: 'Your sign-in could not be verified because the database did not answer.', backend_unreachable: true }),
};

/** A machine identifier: snake_case / dotted, no spaces - never an explanation. */
const IDENT = /^[a-z][a-z0-9]*(?:[_.-][a-z0-9]+)+$/;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * Serve a page as a REAL host with the given public-config. `reachable`
 * decides how the auth-host probe answers; `routes` are extra handlers
 * registered LAST so they outrank the defaults (Playwright's last matching
 * route wins); `sdk:false` lets supabase-js genuinely fail to load;
 * `oauthError` makes the stubbed signInWithOAuth refuse.
 *
 * The dialog listener is registered BEFORE navigation, and every dialog is
 * recorded and dismissed - so a page that alerts during load, or on a click,
 * shows up as evidence instead of hanging the run.
 */
async function open(page, file, opts) {
  const { config, reachable = true, routes = [], sdk = true, oauthError = null } = opts;
  const dialogs = [];
  page.on('dialog', async (d) => {
    dialogs.push(d.type() + ': ' + d.message());
    await d.dismiss().catch(() => {});
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));

  if (sdk) {
    await page.addInitScript((oauthErr) => {
      window.__OAUTH_CALLS__ = [];
      window.supabase = {
        createClient: () => ({
          auth: {
            getSession: async () => ({ data: { session: null } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
            signInWithOAuth: async (o) => { window.__OAUTH_CALLS__.push(o); return { error: oauthErr ? { message: oauthErr } : null }; },
            signOut: async () => ({}),
          },
        }),
      };
    }, oauthError);
  }

  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const url = route.request().url();
    if (/\/auth\/v1\/health/.test(url)) {
      return reachable
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        : route.abort('addressunreachable');
    }
    if (!sdk && /jsdelivr|supabase/.test(url)) return route.abort('failed');
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(url);
    return route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: esm
        ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});'
          + 'export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};',
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
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }),
  }));
  await page.route(/\/api\/public-config(\?|$)/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(config),
  }));
  // The mobile+PIN endpoint (2026-09-28): this deployment has no DATABASE_URL,
  // so accounts are saved on the device and the server says so; an `enter`
  // reaching it anyway is refused with a sentence.
  await page.route(/\/api\/public-config\?action=auth/, (route) => {
    const op = new URL(route.request().url()).searchParams.get('op');
    const body = op === 'status'
      ? { ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' }
      : { ok: false, error: 'no_database', mode: 'device', message: 'No database is configured on this deployment, so "' + op + '" cannot run on the server. Accounts are saved on this device instead.' };
    return route.fulfill({ status: op === 'status' ? 200 : 503, contentType: 'application/json', body: JSON.stringify(body) });
  });
  for (const [matcher, handler] of routes) await page.route(matcher, handler);

  await page.goto('http://app.example.test/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  return { dialogs, errors };
}

/** The rail note, the sign-in panel and the standing bar, as rendered. */
function readSurfaces(page) {
  return page.evaluate(() => {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const note = document.getElementById('lnav-signin-note');
    const bar = document.getElementById('lc-authnotice-text');
    const btn = document.getElementById('lnav-signin');
    const panel = document.getElementById('lnav-mauth');
    const mode = document.getElementById('lnav-mauth-mode');
    const err = document.getElementById('lnav-mauth-err');
    return {
      note: note ? n(note.textContent) : null,
      kind: note ? note.getAttribute('data-kind') : null,
      bar: bar ? n(bar.textContent) : null,
      barKind: (document.getElementById('lc-authnotice') || { getAttribute: () => null }).getAttribute('data-kind'),
      button: btn ? n(btn.textContent) : null,
      panel: !!panel,
      panelInRail: !!(panel && document.getElementById('lifecycle-nav') && document.getElementById('lifecycle-nav').contains(panel)),
      mode: mode ? n(mode.textContent) : null,
      err: err ? n(err.textContent) : null,
      errFrames: err ? err.querySelectorAll('.vh-failure[data-failure="1"]').length : 0,
      google: /Sign in with Google/i.test(document.body.innerText || ''),
      oauth: (window.__OAUTH_CALLS__ || []).length,
      url: location.href,
    };
  });
}

/**
 * Press the rail's Sign-in. A pointer click first; where another fixed
 * element sits over the rail's footer (the Studio's copilot dock does, at
 * 1280x800) the click is dispatched on the element instead - the handler
 * under test runs either way, and what that overlap costs is a layout matter
 * for another change. Returns how it was pressed.
 */
async function pressSignIn(page) {
  const btn = page.locator('#lnav-signin');
  await btn.waitFor({ state: 'attached', timeout: 15000 });
  let how = 'pointer';
  try {
    await btn.click({ timeout: 5000 });
  } catch (e) {
    if (!/intercepts pointer events|Timeout/.test(String(e.message))) throw e;
    how = 'dispatched';
    await btn.evaluate((el) => el.click());
  }
  await page.waitForTimeout(600);
  return how;
}

/* ═══ the sweep is real ═══════════════════════════════════════════════════ */

test('the page list is real', () => {
  expect(PAGES.length, 'no pages carrying auth.js were found').toBeGreaterThan(20);
  expect(PAGES).toContain('retention-playbook.html');   // where the dialog was seen
  expect(PAGES).toContain('index.html');
});

/* ═══ Sign-in against a dead host: every page, no dialog, no redirect ══════
   SINCE 2026-10-05 sign-in is Google. A dead Supabase host is refused before
   signInWithOAuth, on the same page, with the standing bar naming the host
   and no cause the network cannot know. The mobile PIN panel stays closed. */

test('pressing Sign-in against a DEAD host stays on the page, names the host, calls no OAuth, and opens no dialog, on every page', async ({ page }) => {
  test.setTimeout(900_000);
  const failures = [];
  const overlapped = [];
  let pressed = 0;
  for (const f of PAGES) {
    const { dialogs } = await open(page, f, { config: DEAD_BACKEND, reachable: false });
    try {
      if (await pressSignIn(page) === 'dispatched') overlapped.push(f);
    } catch (e) {
      failures.push(`${f}: the Sign-in button could not be pressed: ${String(e.message).split('\n')[0]}`);
      continue;
    }
    pressed++;
    await page.waitForFunction(() => {
      const n = document.getElementById('lnav-signin-note');
      return !!(n && n.getAttribute('data-kind')) || (window.__OAUTH_CALLS__ || []).length > 0;
    }, null, { timeout: 8000 }).catch(() => {});
    const got = await readSurfaces(page);
    if (dialogs.length) failures.push(`${f}: a native dialog opened: ${dialogs.join(' | ')}`);
    if (got.panel) failures.push(`${f}: the mobile PIN panel opened`);
    if (!got.bar) failures.push(`${f}: the standing bar is missing`);
    else {
      if (!/deleted-project\.supabase\.co/.test(got.bar)) failures.push(`${f}: the bar does not name the host`);
      if (!/deleted, renamed or paused/i.test(got.bar)) failures.push(`${f}: the bar picks a cause the network cannot know: ${got.bar}`);
      if (!/Sign in with Google/i.test(got.bar)) failures.push(`${f}: the bar does not name Google as the sign-in`);
    }
    if (got.kind !== 'unreachable') failures.push(`${f}: the note kind is ${got.kind}, not unreachable`);
    if (!/deleted-project\.supabase\.co/.test(got.note || '')) failures.push(`${f}: the note does not name the host`);
    if (got.button !== 'Sign-in unavailable') failures.push(`${f}: the chip reads "${got.button}"`);
    if (got.oauth) failures.push(`${f}: signInWithOAuth was called for a host that does not resolve`);
    if (/deleted-project\.supabase\.co\/auth/.test(got.url)) failures.push(`${f}: the browser was navigated to the dead host`);
    if (!new RegExp('/' + f.replace(/[.]/g, '\\.') + '(\\?|#|$)').test(got.url)) failures.push(`${f}: pressing Sign in navigated away, to ${got.url}`);
  }
  if (overlapped.length) console.log(`Sign-in was under another fixed element and had to be dispatched on: ${overlapped.join(', ')}`);
  expect(failures, `\n  ${failures.join('\n  ')}`).toEqual([]);
  expect(pressed, 'the sweep pressed Sign-in on too few pages to mean anything').toBe(PAGES.length);
});

/* ═══ the other states, on one page ════════════════════════════════════════ */

test('an UNCONFIGURED deployment: the bar and the note say what is missing, and Google is not started', async ({ page }) => {
  const { dialogs } = await open(page, 'retention-playbook.html', { config: NO_BACKEND });
  await pressSignIn(page);
  await page.waitForFunction(() => {
    const n = document.getElementById('lnav-signin-note');
    return !!(n && n.getAttribute('data-kind'));
  }, null, { timeout: 8000 });
  const got = await readSurfaces(page);
  expect(dialogs).toEqual([]);
  expect(got.barKind).toBe('unconfigured');
  expect(got.bar).toMatch(/SUPABASE_URL/);
  expect(got.bar).toMatch(/Sign in with Google/i);
  expect(got.panel).toBe(false);
  expect(got.kind).toBe('unconfigured');
  expect(got.note).toMatch(/SUPABASE_URL/);
  expect(got.oauth).toBe(0);
  expect(got.button).toBe('Sign-in unavailable');
  // The anchor's href="/" used to be the fallback for this case: the visitor
  // was sent to the homepage instead of being told why.
  expect(got.url).toContain('retention-playbook.html');
});

test('a blocked supabase-js CDN is named as the cause, and Google is not started', async ({ page }) => {
  const { dialogs } = await open(page, 'retention-playbook.html', { config: WITH_BACKEND, reachable: true, sdk: false });
  await page.waitForTimeout(4500);   // boot()'s catch renders the rail after the SDK load gives up
  await pressSignIn(page);
  await page.waitForFunction(() => {
    const n = document.getElementById('lnav-signin-note');
    return n && n.getAttribute('data-kind') === 'sdk';
  }, null, { timeout: 8000 });
  const got = await readSurfaces(page);
  expect(dialogs).toEqual([]);
  expect(got.barKind, 'a URL with no client is the SDK failing to load, not a missing env var').toBe('sdk');
  expect(got.bar).toMatch(/Supabase library did not load/i);
  expect(got.bar).toMatch(/cdn\.jsdelivr\.net/);
  expect(got.bar).toMatch(/Sign in with Google needs that library/i);
  expect(got.panel).toBe(false);
  expect(got.kind).toBe('sdk');
  expect(got.oauth).toBe(0);
});

test('a dismissed bar comes back when Sign-in is pressed, because that press asks for the same explanation', async ({ page }) => {
  const { dialogs } = await open(page, 'retention-playbook.html', { config: DEAD_BACKEND, reachable: false });
  // Dispatched, not pointer-clicked: the fixed credits pill sits over the
  // bar's Dismiss button at this width, which is a layout matter for another
  // change - what is under test here is the dismissal, not the hit target.
  await page.evaluate(() => document.querySelector('#lc-authnotice button').click());
  await expect(page.locator('#lc-authnotice')).toHaveCount(0);
  await pressSignIn(page);
  await page.waitForFunction(() => !!document.getElementById('lc-authnotice') && !!document.getElementById('lnav-signin-note'), null, { timeout: 8000 });
  const got = await readSurfaces(page);
  expect(dialogs).toEqual([]);
  expect(got.barKind).toBe('unreachable');
  expect(got.bar).toMatch(/deleted-project\.supabase\.co/);
  expect(got.panel).toBe(false);
  expect(got.kind).toBe('unreachable');
  expect(got.oauth).toBe(0);
});

test('a LIVE backend starts Google on this page: one OAuth call, no PIN panel, no dialog', async ({ page }) => {
  const { dialogs } = await open(page, 'retention-playbook.html', { config: WITH_BACKEND, reachable: true });
  await pressSignIn(page);
  await page.waitForFunction(() => (window.__OAUTH_CALLS__ || []).length > 0, null, { timeout: 8000 });
  const got = await readSurfaces(page);
  const call = await page.evaluate(() => (window.__OAUTH_CALLS__ || [])[0] || null);
  expect(dialogs).toEqual([]);
  expect(got.oauth).toBe(1);
  expect(call.provider).toBe('google');
  expect(call.options.redirectTo).toMatch(/\/$/);
  expect(call.options.queryParams.prompt).toBe('select_account');
  expect(got.note, 'a refusal note rendered for a state that is not a refusal').toBeNull();
  expect(got.panel).toBe(false);
  expect(got.button).toBe('Sign in with Google');
  expect(got.bar).toMatch(/sign in with google/i);
});

test('a refusal from the auth endpoint renders as a failure block inside the panel, never a dialog', async ({ page }) => {
  // The stored-phone panel still exists for a session that is already a phone
  // account. The Sign in chip does not open it; this test opens it the way
  // that session does, then drives the refusal.
  const { dialogs } = await open(page, 'retention-playbook.html', {
    config: WITH_BACKEND, reachable: true,
    routes: [[/\/api\/public-config\?action=auth/, (route) => {
      const op = new URL(route.request().url()).searchParams.get('op');
      if (op === 'status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'server', host: 'ep-fixture.neon.tech', message: 'Account saved in the database.' }) });
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'database_unreachable', mode: 'device', host: 'ep-fixture.neon.tech', message: 'The database (ep-fixture.neon.tech) is not answering, so "enter" cannot run on the server right now.' }) });
    }]],
  });
  await page.waitForFunction(() => !!(window.LifecycleAuth && window.LifecycleAuth.mobile && window.LifecycleAuth.mobile.openPanel), null, { timeout: 15000 });
  await page.evaluate(() => window.LifecycleAuth.mobile.openPanel());
  await page.waitForFunction(() => /database/i.test((document.getElementById('lnav-mauth-mode') || {}).textContent || ''), null, { timeout: 8000 });
  await page.fill('#lnav-mauth-phone', '9876543210');
  await page.click('#lnav-mauth-go');
  await page.waitForFunction(() => ((document.getElementById('lnav-mauth-err') || {}).textContent || '').length > 0, null, { timeout: 8000 });
  const got = await readSurfaces(page);
  expect(dialogs).toEqual([]);
  expect(got.errFrames, 'the refusal is not rendered through LifecycleFailure').toBe(1);
  expect(got.err).toMatch(/ep-fixture\.neon\.tech.*not answering/);
  expect(got.panel, 'the panel closed on a refusal').toBe(true);
  expect(got.url).toContain('retention-playbook.html');
});

/* ═══ every converted alert(), driven ══════════════════════════════════════ */

/**
 * One entry per call site that used to alert(). `act` presses the real control
 * (or calls the function the control calls, where the control only exists
 * after data the harness does not have); `slot` is where the words must land;
 * `kind` is 'status' (an inline .vh-status line) or 'failure' (a
 * LifecycleFailure block); `says` is what the words must contain.
 */
const DRIVES = [
  // calendar.html:792 - alert('Generate a plan first.')
  { page: 'calendar.html', name: 'calendar: export with no plan',
    act: async (page) => { await page.evaluate(() => { STATE.plan = []; }); await page.locator('#btnExport').click(); },
    slot: '#planNote', kind: 'status', says: /generate a plan first/i },

  // dashboard.html:2323 - alert('Drop at least one file first.')
  { page: 'dashboard.html', name: 'dashboard: apply an upload with nothing staged',
    act: async (page) => {
      await page.evaluate(() => document.getElementById('uploadModal').classList.add('open'));
      await page.locator('#uploadApply').click();
    },
    slot: '#uploadNote', kind: 'status', says: /drop at least one file/i },

  // dashboard.html:2703 - alert('Nothing to export for this view.')
  { page: 'dashboard.html', name: 'dashboard: export a view with no tables',
    act: async (page) => {
      await page.evaluate(() => { openExportModal(); document.getElementById('exportView').value = 'no-such-view'; });
      await expect(page.locator('#exportRun')).toBeVisible();
      // Dispatched: at 1280x800 the rail's fixed <aside> reports itself over the
      // modal's button for a pointer click. The click handler is what is under
      // test; the overlap is a layout matter for another change.
      await page.evaluate(() => document.getElementById('exportRun').click());
    },
    slot: '#exportNote', kind: 'status', says: /nothing to export/i,
    also: async (page) => {
      // The modal used to close over a download that never happened.
      expect(await page.evaluate(() => document.getElementById('exportModal').classList.contains('open')),
        'the export modal closed over the reason').toBe(true);
    } },

  // smart-brain.html:1627 - alert('No plan to export yet ...')
  { page: 'smart-brain.html', name: 'smart-brain: export with no plan',
    act: async (page) => {
      // The plan read on open reports into the same slot; let it finish first
      // so what is read back is the export's own sentence.
      await page.waitForFunction(() => typeof PLAN_STATE !== 'undefined' && PLAN_STATE.kind !== 'loading', null, { timeout: 15000 });
      await page.evaluate(() => { PLAN.length = 0; });
      await page.locator('#export').click();
    },
    slot: '#syncstate', kind: 'status', says: /run a sync first/i },

  // smart-brain.html:1637 - alert('Nothing was exported. ' + sentence)
  { page: 'smart-brain.html', name: 'smart-brain: export refused by a paused backend',
    routes: [[/smart-brain-export/, (route) => route.fulfill(PAUSED)]],
    act: async (page) => {
      await page.waitForFunction(() => typeof PLAN_STATE !== 'undefined' && PLAN_STATE.kind !== 'loading', null, { timeout: 15000 });
      await page.evaluate(() => { PLAN.length = 0; PLAN.push({ id: 'slot-1', date: '2026-10-01', market: 'US', cohort: { name: 'Champions' } }); });
      await page.locator('#export').click();
      await page.waitForTimeout(800);
    },
    slot: '#syncstate', kind: 'failure', says: /Nothing was exported/i },

  // smart-brain.html:1174 - alert('No generated assets in view yet ...')
  { page: 'smart-brain.html', name: 'smart-brain: zip with nothing generated',
    act: (page) => page.locator('#downloadAll').click(),
    slot: '#calstate', kind: 'status', says: /no generated assets in view/i },

  // smart-brain.html:1089 - alert('Open View first so the assets are generated.')
  { page: 'smart-brain.html', name: 'smart-brain: Download all before View',
    act: async (page) => {
      await page.evaluate(() => { window.__SB_EXPORTS = []; document.getElementById('preview').innerHTML = '<div class="pvbar"><button type="button" id="t-dl" onclick="sbDownloadAll(this)">dl</button></div>'; });
      await page.locator('#t-dl').click();
    },
    slot: '#preview .pvbar + .sbnote', kind: 'status', says: /open view first/i },

  // smart-brain.html:1064 - alert('Open View first to generate the assets, then Open detailed page.')
  { page: 'smart-brain.html', name: 'smart-brain: Open detailed page before View',
    act: async (page) => {
      await page.evaluate(() => { document.getElementById('preview').innerHTML = '<div class="pvbar"><button type="button" id="t-od" onclick="openDetailPage(0, this)">od</button></div>'; });
      await page.locator('#t-od').click();
    },
    slot: '#preview .pvbar + .sbnote', kind: 'status', says: /open view first/i },

  // lifecycle_mailer_architect_v34.html:5177 - alert('Please describe what to change ...')
  // The three Studio controls live on step 4 (Review), so the wizard is put on
  // that step first, exactly as a user who reaches them would be.
  { page: 'lifecycle_mailer_architect_v34.html', name: 'studio: regenerate with an empty feedback box',
    act: async (page) => {
      await page.evaluate(() => { showOnly(4); document.getElementById('fbIn').value = ''; });
      await page.locator('#p4 .fb-area ~ .btn-row button', { hasText: 'Regenerate' }).click();
    },
    slot: '#fbNote', kind: 'status', says: /describe what to change/i },

  // lifecycle_mailer_architect_v34.html:5574 - alert('Please upload a design image first.')
  { page: 'lifecycle_mailer_architect_v34.html', name: 'studio: approve with no upload',
    act: async (page) => {
      await page.evaluate(() => { showOnly(4); switchP4Tab('upload', document.getElementById('tab-upload')); });
      await page.locator('#approveUploadBtn').click();
    },
    slot: '#uploadNote', kind: 'status', says: /upload a design image first/i },

  // lifecycle_mailer_architect_v34.html:5559 - alert('File too large. Max 20MB.')
  { page: 'lifecycle_mailer_architect_v34.html', name: 'studio: a file over the 20 MB limit',
    act: (page) => page.evaluate(() => {
      showOnly(4); switchP4Tab('upload', document.getElementById('tab-upload'));
      handleImgUpload({ target: { files: [new File([new Uint8Array(21 * 1024 * 1024)], 'big.png', { type: 'image/png' })] } });
    }),
    slot: '#uploadNote', kind: 'status', says: /21\.0 MB.*20 MB/ },

  // credits.js:380 - alert('Nothing was charged. ' + sentence)
  { page: 'index.html', name: 'credits: a recharge refused by a paused backend',
    routes: [[/action=credits/, (route) => {
      const u = route.request().url();
      if (/op=recharge/.test(u)) return route.fulfill(PAUSED);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, configured: true, features: [],
        packs: [{ key: 'starter', label: 'Starter', blurb: 'test pack', credits: 100, price: { configured: true, display: '$10' } }] }) });
    }]],
    act: async (page) => {
      await page.waitForFunction(() => window.Credits && window.Credits.packs && window.Credits.packs.length > 0, null, { timeout: 15000 });
      await page.evaluate(() => window.Credits.openRecharge());
      await page.locator('.lc-pack[data-pack]').first().click();
      await page.waitForTimeout(800);
    },
    slot: '.lc-credit-note', kind: 'failure', says: /Nothing was charged/i },

  // credits.js:377-378 - alert('Added N credits ...') / alert(r.message || 'Recharge order recorded.')
  { page: 'index.html', name: 'credits: a recharge that lands',
    routes: [[/action=credits/, (route) => {
      const u = route.request().url();
      if (/op=recharge/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, credited: true, credits: 100, balance: 250 }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, configured: true, features: [],
        packs: [{ key: 'starter', label: 'Starter', blurb: 'test pack', credits: 100, price: { configured: true, display: '$10' } }] }) });
    }]],
    act: async (page) => {
      await page.waitForFunction(() => window.Credits && window.Credits.packs && window.Credits.packs.length > 0, null, { timeout: 15000 });
      await page.evaluate(() => window.Credits.openRecharge());
      await page.locator('.lc-pack[data-pack]').first().click();
      await page.waitForTimeout(800);
    },
    slot: '.lc-credit-note', kind: 'status', says: /Added 100 credits\. New balance: 250\./ },

  // competitor-benchmarking.html:1052 - alert('Sign in to receive real-time updates.')
  { page: 'competitor-benchmarking.html', name: 'competitor: follow a brand while signed out',
    act: async (page) => {
      await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<span class="follow-wrap"><button type="button" class="follow-chip" id="t-chip" data-follow="mailers" data-name="Acme" data-domain="acme.example">+ Mailers</button></span>'); });
      await page.locator('#t-chip').click();
      await page.waitForTimeout(300);
    },
    slot: '.follow-wrap + .follow-note', kind: 'failure', says: /sign in/i },

  // competitor-benchmarking.html:1064 - alert('Nothing was changed. ' + sentence)
  { page: 'competitor-benchmarking.html', name: 'competitor: follow refused by a paused backend',
    routes: [[/action=sub-set/, (route) => route.fulfill(PAUSED)]],
    act: async (page) => {
      await page.evaluate(() => {
        window.LifecycleAuth.session = { user: { email: 'operator@example.test' } };
        document.body.insertAdjacentHTML('beforeend', '<span class="follow-wrap"><button type="button" class="follow-chip" id="t-chip" data-follow="ads" data-name="Acme" data-domain="acme.example">+ Ads</button></span>');
      });
      await page.locator('#t-chip').click();
      await page.waitForTimeout(600);
    },
    slot: '.follow-wrap + .follow-note', kind: 'failure', says: /Nothing was changed/i },

  // competitor-benchmarking.html:745-746 - alert('Raw HTML not stored.')
  { page: 'competitor-benchmarking.html?id=e1', name: 'competitor: open an email whose HTML was never stored',
    routes: [[/\/api\/competitor/, (route) => {
      const u = route.request().url();
      let body = { ok: true };
      if (/action=list/.test(u)) body = { ok: true, emails: [{ id: 'e1', brand: 'Acme', subject: 'Drop day', receivedAt: '2026-09-01T10:00:00Z', promoCodes: 'None', bodyText: '', preview: '' }] };
      if (/action=html/.test(u)) body = { ok: true, html: '' };
      if (/action=sub-list/.test(u)) body = { ok: true, subscriptions: [] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }]],
    act: async (page) => {
      await page.waitForFunction(() => !!document.getElementById('dv-html-open').onclick, null, { timeout: 15000 });
      await page.evaluate(() => document.getElementById('dv-html-open').click());
    },
    slot: '#dv-html-note', kind: 'status', says: /not stored/i },

  // competitor-benchmarking.html:520 - alert('Finding competitors...')
  { page: 'competitor-benchmarking.html', name: 'competitor: the Find Competitors form',
    act: async (page) => {
      await page.evaluate(() => document.getElementById('fcm').classList.add('open'));
      await page.locator('#fcm .mb button.pm-detail').click();
    },
    slot: '#fcm-note', kind: 'status', says: /not connected yet/i,
    also: async (page) => {
      // It used to close the modal over an alert that read as a search having
      // started. The honest state stays on screen.
      expect(await page.evaluate(() => document.getElementById('fcm').classList.contains('open'))).toBe(true);
    } },

  // competitor-benchmarking.html:539 - alert('Subscribing...')
  { page: 'competitor-benchmarking.html', name: 'competitor: Explore more Competitors',
    act: async (page) => {
      await page.evaluate(() => document.getElementById('jm').classList.add('open'));
      await page.locator('#jm .mb button', { hasText: 'Explore more Competitors' }).click();
    },
    slot: '#jm-note-sub', kind: 'status', says: /not connected yet/i },

  // competitor-benchmarking.html:544 - alert('Starting journey simulation...')
  { page: 'competitor-benchmarking.html', name: 'competitor: Become a part of their journey',
    act: async (page) => {
      await page.evaluate(() => document.getElementById('jm').classList.add('open'));
      await page.locator('#jm .mb button', { hasText: 'Become a part of their journey' }).click();
    },
    slot: '#jm-note-sim', kind: 'status', says: /not connected yet/i },

  // auth.js:2597 - alert('Allow pop-ups to download the PDF.') - from a button with no anchor passed
  { page: 'social-media.html', name: 'auth: a blocked pop-up, from a script caller',
    act: (page) => page.evaluate(() => { window.open = () => null; window.__mdToPdf('# Title\n\nbody', 'T'); }),
    slot: '#lc-popup-blocked', kind: 'failure', says: /blocked the pop-up/i },

  // auth.js:2597 - the same, from a .md link: the note lands right after the link
  { page: 'index.html', name: 'auth: a blocked pop-up, beside the link that asked for it',
    routes: [[/\/x\.md$/, (route) => route.fulfill({ status: 200, contentType: 'text/markdown', body: '# hi' })]],
    act: async (page) => {
      await page.evaluate(() => { window.open = () => null; document.body.insertAdjacentHTML('beforeend', '<p><a id="t-md" href="/x.md">Doc</a></p>'); });
      await page.locator('#t-md').click();
      await page.waitForTimeout(600);
    },
    slot: '#t-md + #lc-popup-blocked', kind: 'failure', says: /Allow pop-ups/i },
];

test('the drive list is real', () => {
  // A sweep over nothing passes everything.
  expect(DRIVES.length, 'too few converted call sites are driven').toBeGreaterThanOrEqual(18);
  const pagesDriven = new Set(DRIVES.map((d) => d.page.split('?')[0]));
  expect(pagesDriven.size).toBeGreaterThanOrEqual(6);
});

for (const d of DRIVES) {
  test(`no dialog: ${d.name}`, async ({ page }) => {
    const { dialogs } = await open(page, d.page, { config: DEAD_BACKEND, reachable: false, routes: d.routes || [] });
    await d.act(page);
    expect(dialogs, 'a native dialog opened').toEqual([]);
    const slot = page.locator(d.slot);
    await expect(slot, `nothing rendered into ${d.slot}`).toHaveCount(1);
    await expect(slot).toBeVisible();
    const seen = await slot.evaluate((el) => ({
      words: String(el.textContent || '').replace(/\s+/g, ' ').trim(),
      failure: !!el.querySelector('.vh-failure[data-failure="1"]') || (el.classList.contains('vh-failure') && el.getAttribute('data-failure') === '1'),
      // An inline status line: the shared .vh-status, or a page's own
      // role="status" region (smart-brain's #syncstate reports every action's
      // outcome and keeps its own classes).
      status: el.classList.contains('vh-status') || !!el.querySelector('.vh-status') || el.getAttribute('role') === 'status',
    }));
    expect(seen.words, 'the slot rendered empty').not.toBe('');
    expect(seen.words).toMatch(d.says);
    expect(IDENT.test(seen.words), `a bare identifier was rendered: ${seen.words}`).toBe(false);
    if (d.kind === 'failure') expect(seen.failure, 'a failure was not rendered through LifecycleFailure').toBe(true);
    else expect(seen.status, 'a status line was not rendered as .vh-status').toBe(true);
    if (d.also) await d.also(page);
  });
}
