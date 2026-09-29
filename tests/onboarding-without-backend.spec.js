/**
 * The first screen of the product works with no database, and says where
 * the brand went.
 * ---------------------------------------------------------------------------
 * Found on the LIVE deployment (/onboarding?step=6, Supabase project paused).
 * The operator typed a brand, reached "Review and activate", and:
 *
 *   - "Your brands" rendered a red YOUR BRANDS COULD NOT BE LOADED block,
 *   - "Save as draft" and "Activate" both toasted "The database is unreachable,
 *     so this could not be loaded and nothing has been saved",
 *   - "Brand context pack" said "Save this brand first" - on a brand that
 *     could not be saved. A dead end.
 *
 * Every command on the wizard ended in an error. That is the 2026-08-30 "login
 * wall that defends nothing" finding one layer up: the app opened, correctly,
 * and then threw the operator's own typing away. Nothing was being protected -
 * with no backend there is no account to write to, and with a reachable one
 * and no session the visitor can still build a brand on THIS device and sync
 * it once signed in.
 *
 * ── WHAT IS ASSERTED, AND HOW ──────────────────────────────────────────────
 * The REAL page, in Chromium, served as a real host (auth.js treats localhost
 * as a dev preview and takes a different path, so 127.0.0.1 would not exercise
 * production's branch). Three states, each stated per case the way
 * signed-out-usable.spec.js learned to after its fixture lied:
 *
 *   unreachable   the config names a host that does not answer, no session
 *   signed-out    a live host, the probe answers, no session
 *   signed-in     a live host, the probe answers, a SERVER-MODE MOBILE+PIN
 *                 session (2026-09-28: the one sign-in; auth.js validates it
 *                 with op=me, which the harness answers)
 *
 * The first two must use the DEVICE store: the wizard walks steps 1-6, saves,
 * reloads, activates, switches - and NOT ONE brand write reaches the server
 * (the request log is asserted, because a save that "worked" by falling
 * through to a 503 would still have rendered the failure it exists to
 * prevent). The third uses the device store TOO, and says so in one sentence
 * beside the account's: a mobile-number account has no Supabase identity and
 * so no workspace record, and the wizard must send nothing to the server for
 * a brand it cannot keep there (section 2 explains; the Supabase-session
 * "server path" this case used to assert is commented out in auth.js).
 *
 * `page.on('dialog')` is registered before anything else: any dialog fails.
 * Every list assertion counts a non-trivial number of things first - a check
 * that inspects nothing passes everything.
 *
 * The device path paints the same --brand-* tokens the server path paints.
 * That is a claim about two implementations agreeing, so the parity test
 * drives BOTH - the real brand-context.js in the page and the real server
 * module in Node - over the same palettes and diffs the output.
 *
 * Run: npx playwright test tests/onboarding-without-backend.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const HOST = 'http://app.example.test';
const DEVICE_KEY = 'lifecycle.brand.device.workspaces';
/** A brand op reaching the server. `presets`/`defaults` are public and allowed. */
const BRAND_WRITE_RX = /action=brand&op=(save|activate|list|active|get|delete)\b/;

// Two configs, both "configured": the defect lived in the case that LOOKED
// configured. The unreachable host keeps a blunt name because what is tested
// is the unreachability, not the reason (paused and deleted are identical from
// here - CLAUDE.md's 2026-09-12 correction).
const DEAD = { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } };
const LIVE = { supabase: { url: 'https://live.supabase.co', anonKey: 'anon' } };
// A server-mode mobile+PIN session (2026-09-28): the token is 43 base64url
// characters as the server mints them, the account in the Neon database.
const SESSION_TOKEN = 'MPINtokenFIXTURE0123456789abcdefghijklmnopqrs';
const SESSION = {
  token: SESSION_TOKEN, mode: 'server', provider: 'mobile-pin',
  user: { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Operator', phone: '+919876543210' },
  expires: new Date(Date.now() + 80 * 86400000).toISOString(),
  storage: { mode: 'server', reason: '', host: 'ep-fixture.neon.tech', message: 'Account saved in the database.' },
};

/** A fictional brand, typed the way the operator typed theirs. */
const BRAND = { name: 'Harbourlight Goods', primary: '#1a6b3c', accent: '#b8531f', heading: 'Fraunces', body: 'Inter' };
const SECOND = { name: 'Second Harbour', primary: '#2b4c9b' };

/**
 * Serve the repo as a real host in one of the three states.
 * Returns the logs the assertions read: dialogs, page errors, every /api/
 * request URL, and every brand the (stubbed) server was asked to save.
 */
async function harness(page, state) {
  const log = { dialogs: [], errors: [], requests: [], saves: [], serverRows: [] };
  // FIRST. A prompt or confirm anywhere in this flow is a failure, and an
  // unhandled one would hang the page instead of failing the test.
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/')) log.requests.push(u); });

  await page.addInitScript((seed) => {
    // The anonymous supabase-js stand-in. It never holds a session (2026-09-28):
    // the mobile+PIN session below is the one sign-in.
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async () => ({ error: null }),
          signOut: async () => ({}),
        },
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { profile_prompted: true }, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }),
      }),
    };
    // Signed in = a SERVER-mode mobile+PIN session in localStorage, which
    // auth.js validates with op=me on every boot (answered by the harness).
    if (seed) { try { localStorage.setItem('lifecycle.auth.session', JSON.stringify(seed)); } catch (_) {} }
  }, state === 'signed-in' ? SESSION : null);

  // Broadest first, most specific last: Playwright's last matching route wins.
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    // The one reachability probe in the app. Answered per state, deliberately.
    if (/\/auth\/v1\/health/.test(u)) {
      return state === 'unreachable'
        ? route.abort('addressunreachable')
        : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: esm
        ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};',
    });
  });
  await page.route(HOST + '/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action');
    const op = u.searchParams.get('op');
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (!action && !u.searchParams.has('health')) return json(state === 'unreachable' ? DEAD : LIVE);
    // The mobile+PIN endpoint: a database for the signed-in state, none otherwise.
    if (action === 'auth') {
      const aop = u.searchParams.get('op');
      if (aop === 'status') {
        return json(state === 'signed-in'
          ? { ok: true, mode: 'server', host: 'ep-fixture.neon.tech', message: 'Account saved in the database.' }
          : { ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' });
      }
      if (aop === 'me') {
        const tok = route.request().headers()['x-lifecycle-token'] || '';
        return state === 'signed-in' && tok === SESSION_TOKEN
          ? json({ ok: true, mode: 'server', user: SESSION.user, message: 'Account saved in the database.' })
          : json({ ok: false, error: 'invalid_session', message: 'Your sign-in has expired or was signed out.' }, 401);
      }
      return json({ ok: true });
    }
    if (action !== 'brand') return json({ ok: true });
    if (op === 'presets') return json({ ok: true, presets: [] });
    if (op === 'defaults') return json({ ok: true, brand: {} });
    if (state !== 'signed-in') {
      // Exactly what brand-workspace-core.js answers when it cannot verify a
      // session. If the page ever sends a brand write here, THIS is what it
      // gets back - and the request log is what catches it.
      return state === 'unreachable'
        ? json({ ok: false, error: 'session_verification_unavailable', backend_unreachable: true, message: 'The database this deployment points at (paused-project.supabase.co) is not answering, so sign-in cannot be checked.' }, 503)
        : json({ ok: false, error: 'sign_in_required', message: 'You are not signed in, so this could not be saved to your account.' }, 401);
    }
    // A signed-in account, answered in the server's own shapes, with the
    // server's own token maths for anything the page will paint.
    const full = (row) => Object.assign({}, row, { tokens: core.tokens(row), fonts_href: core.fontsHref(row), readiness: core.readiness(row, { products: 0 }), products: 0 });
    if (op === 'active') return json({ ok: true, brand: null, needs_onboarding: log.serverRows.length === 0, workspaces: log.serverRows });
    if (op === 'list') return json({ ok: true, workspaces: log.serverRows.map((r) => core.shellPayload(r)), active_id: null });
    if (op === 'save') {
      const body = route.request().postDataJSON() || {};
      log.saves.push(body);
      const input = body.brand || body;
      const existing = input.id && log.serverRows.find((r) => r.id === input.id);
      const row = Object.assign({}, existing || { id: 'ws-srv-' + log.saves.length }, input, { id: (existing && existing.id) || 'ws-srv-' + log.saves.length });
      row.slug = row.slug || core.slugify(row.name);
      if (!existing) log.serverRows.push(row); else Object.assign(existing, row);
      return json({ ok: true, brand: full(row) });
    }
    if (op === 'activate') {
      const id = (route.request().postDataJSON() || {}).id;
      const row = log.serverRows.find((r) => r.id === id);
      return row ? json({ ok: true, brand: core.shellPayload(row, { products: 0 }) }) : json({ ok: false, error: 'Workspace not found (or not yours).' }, 404);
    }
    if (op === 'get') {
      const row = log.serverRows.find((r) => r.id === u.searchParams.get('id'));
      return row ? json({ ok: true, brand: full(row) }) : json({ ok: false, error: 'workspace_not_found' }, 404);
    }
    if (op === 'context-pack') return json({ ok: true, pack: null });
    return json({ ok: true });
  });
  return log;
}

async function openWizard(page, query) {
  await page.goto(HOST + '/onboarding.html' + (query || ''), { waitUntil: 'domcontentloaded' });
  // The mode is auth.js's decision; nothing below is meaningful until it has
  // been made and the wizard has re-rendered on it.
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.storage && window.BrandContext.storage().known && window.BrandContext.loaded, null, { timeout: 20000 });
  await page.waitForTimeout(250);
}

async function listSettled(page) {
  await page.waitForSelector('#wsList', { timeout: 15000 });
  await page.waitForFunction(() => { const el = document.getElementById('wsList'); return el && !/Loading/i.test(el.textContent || ''); }, null, { timeout: 15000 });
}

/** Steps 1 -> 6, typing a brand the way an operator does. */
async function walkToReview(page, brand) {
  await page.waitForSelector('[data-path="name"]');
  await page.fill('[data-path="name"]', brand.name);
  await page.click('[data-go="next"]');
  await page.waitForSelector('input[type="text"][data-path="palette.primary"]');
  await page.fill('input[type="text"][data-path="palette.primary"]', brand.primary);
  await page.fill('input[type="text"][data-path="palette.accent"]', brand.accent);
  await page.click('[data-go="next"]');
  await page.waitForSelector('select[data-font-slot="heading"]');
  await page.selectOption('select[data-font-slot="heading"]', brand.heading);
  await page.selectOption('select[data-font-slot="body"]', brand.body);
  await page.click('[data-go="next"]');
  await page.waitForSelector('[data-path="voice.tone"]');
  await page.click('[data-go="next"]');
  await page.waitForSelector('#doImport');
  await page.click('[data-go="next"]');
  await listSettled(page);
}

/** The reader's view of a slot: text, failure frames, the accent note, chips. */
function readPanel(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const note = el.querySelector('[data-storage-note]');
    // The page's own tokens, as COMPUTED on the note: `--accent` is
    // var(--brand-accent, <fallback>), so this is the accent whether or not a
    // brand has been painted onto <html> yet, and it is the value the rule is
    // actually drawn in.
    const toRgb = (v) => {
      const s = String(v || '').trim();
      if (s.charAt(0) !== '#') return s;
      const h = s.slice(1);
      const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      return 'rgb(' + [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)).join(', ') + ')';
    };
    const cs = note ? getComputedStyle(note) : null;
    return {
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      failures: el.querySelectorAll('[data-failure], .vh-failure').length,
      rows: el.querySelectorAll('.ws').length,
      chips: el.querySelectorAll('[data-storage-chip="device"]').length,
      note: note ? (note.textContent || '').replace(/\s+/g, ' ').trim() : '',
      noteRule: cs ? cs.borderLeftColor : '',
      noteIsFailure: !!(note && (note.matches('.vh-failure') || note.closest('.vh-failure'))),
      accentRgb: cs ? toRgb(cs.getPropertyValue('--accent')) : '',
      warnRgb: cs ? toRgb(cs.getPropertyValue('--warn')) : '',
      errRgb: cs ? toRgb(cs.getPropertyValue('--err')) : '',
      syncOffers: el.querySelectorAll('[data-sync-offer]').length,
      activeName: (el.querySelector('.ws.active b') || {}).textContent || '',
    };
  }, selector);
}

// The device store is namespaced per signed-in account (2026-09-29): `device`
// is the UNSCOPED key (nobody signed in), `deviceAccount` the fixture account's.
const html = (page) => page.evaluate((keys) => ({
  primary: document.documentElement.style.getPropertyValue('--brand-primary').trim(),
  rail: (document.querySelector('.lnav-brandname') || {}).textContent || '',
  device: localStorage.getItem(keys.anon),
  deviceAccount: localStorage.getItem(keys.account),
  internal: (window.LifecycleAuth || {}).internal,
  mode: window.BrandContext && window.BrandContext.mode,
}), { anon: DEVICE_KEY, account: DEVICE_KEY + '.' + SESSION.user.id });

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE DEFECT: no database, every command works, nothing is an error
   ═══════════════════════════════════════════════════════════════════════════ */

test('with the database unreachable, a brand is built, saved, reloaded, activated and switched - without an error and without a server write', async ({ page }) => {
  test.setTimeout(180_000);
  const log = await harness(page, 'unreachable');
  await openWizard(page);
  expect(await page.evaluate(() => (window.LifecycleAuth.backend || {}).kind), 'the fixture never reached the unreachable state').toBe('unreachable');
  await expect(page.locator('#lc-authnotice')).toHaveAttribute('data-kind', 'unreachable');

  await walkToReview(page, BRAND);

  // The review step: the panel is not a failure, it is a list on this device.
  let seen = await readPanel(page, '#wsList');
  expect(seen, '#wsList never rendered').not.toBeNull();
  expect(seen.text.length, 'the panel is empty - nothing was measured').toBeGreaterThan(40);
  expect(seen.failures, 'the brand list rendered a FAILURE for an ordinary state').toBe(0);
  expect(seen.rows, 'the draft saved on the way through the steps is not listed').toBeGreaterThanOrEqual(1);
  expect(seen.chips, 'a device row carries no "on this device" chip').toBe(seen.rows);
  // ONE sentence, the accent rule. Not the warn rule, not the failure frame.
  expect(seen.note).toMatch(/saved on this device only/i);
  expect(seen.note).toMatch(/synced to your account/i);
  expect(seen.noteIsFailure, 'the device sentence is inside a failure frame').toBe(false);
  expect(seen.accentRgb, 'no accent token to measure against').toMatch(/^rgb\(/);
  expect(seen.noteRule, 'the device sentence does not take the ACCENT rule').toBe(seen.accentRgb);
  expect(seen.noteRule, 'the device sentence wears the WARN colour').not.toBe(seen.warnRgb);
  expect(seen.noteRule, 'the device sentence wears the ERROR colour').not.toBe(seen.errRgb);
  // The standing bar has already said the database is unreachable; the panel
  // does not say it again as an error.
  expect(seen.text.toLowerCase()).not.toContain('could not be loaded');
  expect(seen.text.toLowerCase()).not.toContain('database is unreachable');

  // Server-only controls are DISABLED with a reason, not dead ends.
  await expect(page.locator('#packBuild')).toBeDisabled();
  await expect(page.locator('p[data-needs-account="context-pack"]')).toContainText(/needs your account/i);
  expect(await page.locator('#stepCard .vh-failure').count(), 'a disabled control was rendered as a failure').toBe(0);
  // The catalogue import on step 5 is the same shape. Read it without leaving
  // the model behind: the pip is a real navigation.
  await page.click('.step-pip[data-step="5"]');
  await expect(page.locator('#doImport')).toBeDisabled();
  await expect(page.locator('p[data-needs-account="catalog-import"]')).toContainText(/needs your account/i);
  await page.click('.step-pip[data-step="4"]');
  expect(await page.locator('[data-needs-account="suggest"][disabled]').count(), 'suggest buttons are not off').toBeGreaterThanOrEqual(4);
  await expect(page.locator('p[data-needs-account="suggest"]')).toHaveCount(1);
  // Reading a site stays ON here: the server opens that one op when the
  // backend is unreachable (extract-without-backend.spec.js).
  await page.click('.step-pip[data-step="1"]');
  await expect(page.locator('#xRun')).toBeEnabled();
  await page.click('.step-pip[data-step="6"]');
  await listSettled(page);

  // Save as draft: no failure, a toast that says WHERE.
  await page.click('#saveDraft');
  await expect(page.locator('#toast')).toContainText(/saved as a draft on this device/i, { timeout: 8000 });
  expect(await page.locator('#stepCard .vh-failure').count()).toBe(0);

  // Reload: the row is still there, still labelled.
  await openWizard(page, '?step=6');
  await expect(page.locator('#title')).toHaveText('Edit ' + BRAND.name);
  await listSettled(page);
  seen = await readPanel(page, '#wsList');
  expect(seen.rows).toBe(1);
  expect(seen.chips).toBe(1);
  expect(seen.text).toContain(BRAND.name);
  expect(seen.failures).toBe(0);

  // Activate: the whole app re-skins after a reload, and the rail names it.
  await page.click('#activate');
  await expect(page.locator('#toast')).toContainText(/now live across the app on this device/i, { timeout: 8000 });
  await page.waitForURL(HOST + '/', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--brand-primary').trim() !== '', null, { timeout: 15000 });
  await page.waitForFunction((n) => (document.querySelector('.lnav-brandname') || {}).textContent === n, BRAND.name, { timeout: 15000 });
  // The paint above comes from the device store at load; the MODE is decided
  // ~200 ms later, once auth.js has published its state and brand-context has
  // revalidated. Reading it before then measured a race, not the app (this
  // failed identically against main's own tree on a busy machine).
  await page.waitForFunction(() => !!(window.BrandContext && window.BrandContext.mode), null, { timeout: 15000 });
  let h = await html(page);
  expect(h.primary).toBe(BRAND.primary);
  expect(h.rail).toBe(BRAND.name);
  expect(h.mode).toBe('device');

  // A second brand on this device, then Switch Brand on /onboarding.
  await page.evaluate((b) => window.BrandContext.api('save', { body: { brand: {
    name: b.name, palette: { primary: b.primary, accent: '#c8102e', ink: '#111111', surface: '#ffffff' },
    typography: { heading: { family: 'Lora' }, body: { family: 'Inter' } }, status: 'draft',
  } } }), SECOND);
  await openWizard(page, '?step=6');
  await listSettled(page);
  seen = await readPanel(page, '#wsList');
  expect(seen.rows, 'Switch Brand does not list both device brands').toBe(2);
  expect(seen.chips).toBe(2);
  expect(seen.activeName).toBe(BRAND.name);
  expect(await page.locator('#wsList .ws:not(.active) [data-act="switch"]').count()).toBe(1);
  await page.click('#wsList .ws:not(.active) [data-act="switch"]');
  await expect(page.locator('#toast')).toContainText(/switched brand/i, { timeout: 8000 });
  await page.waitForFunction((p) => document.documentElement.style.getPropertyValue('--brand-primary').trim() === p, SECOND.primary, { timeout: 8000 });
  await listSettled(page);
  seen = await readPanel(page, '#wsList');
  expect(seen.activeName).toBe(SECOND.name);
  await openWizard(page, '?step=6');
  h = await html(page);
  expect(h.primary, 'the switch did not survive a reload').toBe(SECOND.primary);

  // The whole flow: no dialog, no page error, no brand write to the dead host,
  // and never a fabricated sign-in.
  expect(log.dialogs, `a dialog opened: ${log.dialogs.join(' | ')}`).toEqual([]);
  expect(log.errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e)), `page errors: ${log.errors.join(' | ')}`).toEqual([]);
  const writes = log.requests.filter((u) => BRAND_WRITE_RX.test(u));
  expect(writes, `brand ops were sent to a server that is not there:\n  ${writes.join('\n  ')}`).toEqual([]);
  expect(log.requests.length, 'no API traffic at all - the harness measured nothing').toBeGreaterThan(3);
  expect(h.internal, 'a signed-out visitor was granted internal access').toBe(false);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. SIGNED IN AND REACHABLE: a mobile-number account, its brands on the device
   ─────────────────────────────────────────────────────────────────────────────
   SINCE 2026-09-28 sign-in is a mobile number and a PIN (auth.js, tests/
   mobile-pin-signin.spec.js), and a phone account has NO Supabase identity:
   brand_workspaces is gated by auth.uid(), which it does not have. So its
   brands live on the device whichever mode the ACCOUNT is in - here the server
   (the Neon database, reachable). What this case used to assert - "the brand
   goes to the SERVER and nothing is written to the device" - describes a path
   no browser session can take any more; the Supabase session flow is commented
   out in auth.js. What it asserts now is the one sentence for the new state,
   in the accent rule, and that the wizard sends NOTHING to the server for a
   brand it cannot keep there.
   ═══════════════════════════════════════════════════════════════════════════ */

test('signed in with a mobile-number account and a reachable database, the brand goes to the DEVICE, nothing reaches the server, and the sentence says both', async ({ page }) => {
  test.setTimeout(120_000);
  const log = await harness(page, 'signed-in');
  await openWizard(page);
  const auth = await page.evaluate(() => ({
    kind: (window.LifecycleAuth.backend || {}).kind,
    session: (window.LifecycleAuth.backend || {}).session,
    name: (document.querySelector('#lifecycle-nav .lnav-uname') || {}).textContent || '',
    mode: (document.querySelector('#lnav-umode') || {}).textContent || '',
    internal: window.LifecycleAuth.internal,
  }));
  expect(auth.kind, 'the fixture never reached the signed-in state').toBe('signed-in');
  expect(auth.session).toMatchObject({ provider: 'mobile-pin', mode: 'server', name: 'Operator', verified: true });
  expect(auth.name).toBe('Operator');
  expect(auth.mode).toBe('Account saved in the database.');
  expect(auth.internal, 'a phone account was granted internal access').toBe(false);
  expect(log.requests.filter((u) => /action=auth&op=me/.test(u)).length, 'the stored session was not validated with the server').toBe(1);

  // Reading a site is ON: the server can check a server-mode session.
  await expect(page.locator('#xRun')).toBeEnabled();
  await expect(page.locator('p[data-needs-account="extract"]')).toHaveCount(0);

  await walkToReview(page, BRAND);
  await page.click('#saveDraft');
  await expect(page.locator('#toast')).toContainText(/saved as a draft on this device/i, { timeout: 8000 });
  await listSettled(page);

  // NOTHING reached the server for the brand: no save body, no brand op at all.
  expect(log.saves).toEqual([]);
  const writes = log.requests.filter((u) => BRAND_WRITE_RX.test(u));
  expect(writes, `brand ops were sent for an account that has no workspace record:\n  ${writes.join('\n  ')}`).toEqual([]);

  const h = await html(page);
  // Under the ACCOUNT's namespace, and nowhere an anonymous visitor or the
  // next person to sign in on this browser would read it.
  expect(h.deviceAccount, 'nothing was stored on the device for this account').not.toBeNull();
  expect(JSON.parse(h.deviceAccount).workspaces.map((w) => w.name)).toContain(BRAND.name);
  expect(h.device, 'a signed-in account\'s brand was written to the unscoped (anonymous) key').toBeNull();
  expect(h.mode).toBe('device');
  expect(h.internal).toBe(false);
  const seen = await readPanel(page, '#wsList');
  expect(seen.failures).toBe(0);
  expect(seen.rows).toBeGreaterThanOrEqual(1);
  expect(seen.chips).toBe(seen.rows);
  // THE sentence: signed in AND on this device AND the account in the database,
  // in one line, in the accent rule - never "sign in" to a person who just did.
  expect(seen.note).toBe('Signed in as Operator · workspaces are saved on this device · account in the database.');
  expect(seen.note).not.toMatch(/sign in and/i);
  expect(seen.noteRule).toBe(seen.accentRgb);
  expect(seen.noteIsFailure).toBe(false);
  expect(seen.syncOffers, 'a sync offer for an account with no workspace record to sync to').toBe(0);
  // Controls that need a brand IN THE DATABASE are off with THAT reason.
  await expect(page.locator('#packBuild')).toBeDisabled();
  await expect(page.locator('p[data-needs-account="context-pack"]')).toContainText(/not available on a mobile-number account/i);
  await expect(page.locator('p[data-needs-account="context-pack"]')).not.toContainText(/needs your account|sign in/i);
  expect(await page.locator('#stepCard .vh-failure').count(), 'a disabled control was rendered as a failure').toBe(0);
  await page.click('.step-pip[data-step="5"]');
  await expect(page.locator('#doImport')).toBeDisabled();
  await expect(page.locator('p[data-needs-account="catalog-import"]')).toContainText(/not available on a mobile-number account/i);
  expect(log.dialogs).toEqual([]);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. REACHABLE BUT SIGNED OUT: the device, and it says so in those words
   ═══════════════════════════════════════════════════════════════════════════ */

test('signed out of a reachable database, the brand is saved on this device and the sentence says to sign in', async ({ page }) => {
  test.setTimeout(120_000);
  const log = await harness(page, 'signed-out');
  await openWizard(page);
  expect(await page.evaluate(() => (window.LifecycleAuth.backend || {}).kind)).toBe('signed-out');
  await expect(page.locator('#lc-authnotice')).toHaveAttribute('data-kind', 'signed-out');

  // The server REFUSES extract for a signed-out caller while the database is
  // reachable (the gate is real there), so the control is off with its reason
  // rather than a button that fails.
  await expect(page.locator('#xRun')).toBeDisabled();
  await expect(page.locator('p[data-needs-account="extract"]')).toContainText(/sign in/i);
  expect(await page.locator('#stepCard .vh-failure').count(), 'the disabled control was rendered as a failure').toBe(0);

  await walkToReview(page, BRAND);
  await page.click('#saveDraft');
  await expect(page.locator('#toast')).toContainText(/saved as a draft on this device/i, { timeout: 8000 });
  await listSettled(page);

  const seen = await readPanel(page, '#wsList');
  expect(seen.failures).toBe(0);
  expect(seen.rows).toBeGreaterThanOrEqual(1);
  expect(seen.chips).toBe(seen.rows);
  expect(seen.note).toMatch(/saved on this device only/i);
  // The different half of the sentence: here signing in IS the remedy, and a
  // sentence about reaching a database would send the reader to fix the
  // thing that is not broken.
  expect(seen.note).toMatch(/sign in and they can be synced/i);
  expect(seen.note).not.toMatch(/database is reachable/i);
  expect(seen.noteRule).toBe(seen.accentRgb);
  expect(seen.syncOffers).toBe(0);

  const h = await html(page);
  expect(h.device, 'nothing was stored on the device').not.toBeNull();
  expect(JSON.parse(h.device).workspaces.map((w) => w.name)).toContain(BRAND.name);
  expect(h.internal).toBe(false);
  const writes = log.requests.filter((u) => BRAND_WRITE_RX.test(u));
  expect(writes, `brand ops were sent unauthenticated:\n  ${writes.join('\n  ')}`).toEqual([]);
  expect(log.dialogs).toEqual([]);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. THE SYNC OFFER: never for a mobile-number account, and never silent
   ─────────────────────────────────────────────────────────────────────────────
   The offer uploaded device rows to the ACCOUNT's workspace records. A phone
   account has none (see section 2), so it is never offered one and
   syncDeviceToAccount() refuses with a sentence naming why. The sync path
   itself stays in brand-context.js, for a session with a workspace record.
   ═══════════════════════════════════════════════════════════════════════════ */

test('a mobile-number account holding device brands is never offered a sync, and nothing is uploaded', async ({ page }) => {
  test.setTimeout(120_000);
  const log = await harness(page, 'signed-in');
  // Seed a device brand the way a signed-in phone account leaves one behind:
  // under ITS namespace (2026-09-29), which is the only place its list reads.
  await page.goto(HOST + '/privacy.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ b, key }) => {
    localStorage.setItem(key, JSON.stringify({
      version: 1, active_id: 'local-seeded01',
      workspaces: [{
        id: 'local-seeded01', slug: 'harbourlight-goods', name: b.name, status: 'draft', onboarding_step: 6,
        palette: { primary: b.primary, accent: b.accent, ink: '#111111', surface: '#ffffff' },
        typography: { heading: { family: b.heading, stack: "'Fraunces',Georgia,serif", google: true, weights: '500;600;700' }, body: { family: b.body, stack: "'Inter',system-ui,sans-serif", google: true, weights: '400;500;600;700' } },
        voice: { tone: '', preferred: [], banned: [], no_em_dashes: true, notes: '' }, regions: [{ code: 'US', currency: 'USD', symbol: '$', store_url: '' }],
        asset_hosts: [], catalog_source: {}, brand_data: {}, owner_id: null,
        created_at: '2026-09-15T00:00:00.000Z', updated_at: '2026-09-15T00:00:00.000Z', storage: 'device',
      }],
    }));
  }, { b: BRAND, key: DEVICE_KEY + '.' + SESSION.user.id });

  // No brand is active on the account, so boot() has nothing to resume at a
  // saved step: the review step is reached the way a person reaches it.
  await openWizard(page);
  await page.click('.step-pip[data-step="6"]');
  await listSettled(page);
  const seen = await readPanel(page, '#wsList');
  expect(seen.rows, 'the device brand is not listed').toBe(1);
  expect(seen.chips, 'the device brand does not wear its chip').toBe(1);
  expect(seen.syncOffers, 'a sync offer was rendered for an account with no workspace record').toBe(0);
  expect(await page.locator('#syncDevice').count()).toBe(0);
  expect(seen.note).toMatch(/^Signed in as Operator/);
  expect(seen.note).toMatch(/account in the database/);
  // Nothing was uploaded by opening the page, and asking directly is refused
  // with the reason - not attempted and failed.
  expect(log.saves.length, 'a device brand was uploaded WITHOUT being asked').toBe(0);
  const refused = await page.evaluate(() => window.BrandContext.syncDeviceToAccount().then(() => null, (e) => ({ code: e.code, message: e.message })));
  expect(refused).toMatchObject({ code: 'account_type_unsupported' });
  expect(refused.message).toMatch(/no record of it in the workspace database/);
  expect(log.saves.length).toBe(0);
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).workspaces.length, DEVICE_KEY + '.' + SESSION.user.id), 'the device copy was removed').toBe(1);
  expect(log.dialogs).toEqual([]);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. THE DEVICE PATH PAINTS WHAT THE SERVER WOULD HAVE PAINTED
   ═══════════════════════════════════════════════════════════════════════════ */

const PALETTES = [
  // tenant zero
  { name: 'Zero', palette: { primary: '#D0473E', accent: '#6A33D8', ink: '#111111', surface: '#FFFFFF' }, typography: { heading: { family: 'Montserrat' }, body: { family: 'Instrument Sans' } } },
  // a light primary, which is where the text tokens have to move
  { name: 'Pale', palette: { primary: '#f2e6c8', accent: '#9bd3ff', ink: '#1d2430', surface: '#fbfaf6', surface_alt: '#ffffff', muted: '#8a8f99' }, typography: { heading: { family: 'Fraunces', weights: '500;700' }, body: { family: 'Inter', google: false, stack: "'Inter',sans-serif" } } },
  // the fixture brand, with a mono face and an incomplete palette
  { name: 'Harbourlight Goods', palette: { primary: '#1a6b3c', accent: '#b8531f' }, typography: { heading: { family: 'Fraunces' }, body: { family: 'Inter' }, mono: { family: 'JetBrains Mono' } } },
  // no palette at all
  { name: 'Blank', palette: {}, typography: {} },
];

test('the device token maths agrees with the server, palette for palette', async ({ page }) => {
  await harness(page, 'unreachable');
  await openWizard(page);
  for (const b of PALETTES) {
    const got = await page.evaluate((brand) => ({
      tokens: window.BrandContext.tokensFor(brand),
      fonts: window.BrandContext.fontsHrefFor(brand),
      valid: window.BrandContext.validatePalette(brand.palette),
      ready: window.BrandContext.readinessFor(brand, { products: 0 }),
    }), b);
    expect(got.tokens, `tokens differ for ${b.name}`).toEqual(core.tokens(b));
    expect(Object.keys(got.tokens).length, 'a token set with almost nothing in it').toBeGreaterThan(15);
    expect(got.fonts, `fonts_href differs for ${b.name}`).toBe(core.fontsHref(b));
    const want = core.validatePalette(b.palette);
    expect(got.valid.ok, `validatePalette verdict differs for ${b.name}`).toBe(want.ok);
    expect(got.valid.errors.map((e) => e.field)).toEqual(want.errors.map((e) => e.field));
    expect(got.valid.warnings.map((e) => e.field)).toEqual(want.warnings.map((e) => e.field));
    expect(got.valid.contrast).toEqual(want.contrast);
    const rw = core.readiness(b, { products: 0 });
    expect(got.ready.markers, `readiness markers differ for ${b.name}`).toEqual(rw.markers);
    expect(got.ready.ready).toBe(rw.ready);
    expect(got.ready.status_line).toBe(rw.status_line);
  }
});

test('activation on the device is gated by the same design rules as the server', async ({ page }) => {
  await harness(page, 'unreachable');
  await openWizard(page);
  // A near-black page surface is the HARD rule validatePalette() exists for.
  const refused = await page.evaluate(async () => {
    try {
      await window.BrandContext.api('save', { body: { brand: { name: 'Dark Ground', status: 'active', palette: { primary: '#ff0000', ink: '#ffffff', surface: '#111111' } } } });
      return null;
    } catch (e) { return { message: e.message, code: e.code, details: (e.payload || {}).details }; }
  });
  expect(refused, 'an active brand with a dark-neutral surface was saved on the device').not.toBeNull();
  expect(refused.message).toMatch(/design rules/i);
  expect(refused.details.map((d) => d.field)).toContain('surface');
  expect(core.validatePalette({ primary: '#ff0000', ink: '#ffffff', surface: '#111111' }).ok).toBe(false);
  // A DRAFT with the same palette saves, exactly as on the server.
  const draft = await page.evaluate(async () => (await window.BrandContext.api('save', { body: { brand: { name: 'Dark Ground', status: 'draft', palette: { primary: '#ff0000', ink: '#ffffff', surface: '#111111' } } } })).brand);
  expect(draft.id).toMatch(/^local-/);
  expect(draft.status).toBe('draft');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. THE MARKER NAMES THE BRAND, NEVER "all, all"
   ═══════════════════════════════════════════════════════════════════════════ */

test('a brand-level gap is reported against the brand, not padded with "all, all"', async ({ page }) => {
  // The server's builder, executed.
  const r = core.readiness({ name: 'Harbourlight Goods', regions: [{ code: 'US', currency: 'USD' }] }, { products: 0 });
  expect(r.markers.length).toBeGreaterThan(4);
  expect(r.markers).toContain('[DATA REQUIRED BEFORE LAUNCH: logo URL, Harbourlight Goods]');
  expect(r.markers).toContain('[DATA REQUIRED BEFORE LAUNCH: region store URL, Harbourlight Goods, US]');
  expect(r.markers.filter((m) => /, all, all\]/.test(m))).toEqual([]);
  // A product-level gap still names the product, in the product's slot.
  expect(core.launchMarker('product image', { brand: 'Harbourlight Goods', product: 'Harbour Lamp', region: 'UK' })).toBe('[DATA REQUIRED BEFORE LAUNCH: product image, Harbour Lamp, UK]');
  // With no name yet, the slot says so rather than inventing one.
  expect(core.launchMarker('brand name', {})).toBe('[DATA REQUIRED BEFORE LAUNCH: brand name, this brand]');

  // And the review step renders through it.
  await harness(page, 'unreachable');
  await openWizard(page);
  await walkToReview(page, BRAND);
  const markers = await page.evaluate(() => Array.from(document.querySelectorAll('#stepCard .marker')).map((m) => m.textContent.trim()));
  expect(markers.length, 'the review step reported no gaps for a brand with no logo, voice or catalogue').toBeGreaterThan(3);
  expect(markers).toContain('[DATA REQUIRED BEFORE LAUNCH: logo URL, ' + BRAND.name + ']');
  expect(markers.filter((m) => /, all, all\]|, all\]/.test(m)), 'the review list still pads a marker with "all"').toEqual([]);
});
