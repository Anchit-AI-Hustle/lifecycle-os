/**
 * Google is the only sign-in (2026-10-10).
 * ---------------------------------------------------------------------------
 * The owner's words: "No signin with mobile number - only Google signin pls".
 * The mobile number + 4-digit PIN sign-in that ran from 2026-09-28 is switched
 * OFF, not hidden, and this file is the gate that holds it off:
 *
 *   SERVER (the shipped modules, global.fetch throwing on anything unrouted):
 *     - public-config.js?action=auth&op=enter is refused (410) for every
 *       method, before any database, rate limit or GoTrue call, and no answer
 *       carries a token; op=status says sign-in is Google; op=me refuses.
 *     - requireUser() refuses a token of the PIN shape EXACTLY like no token:
 *       a Neon session that IS in app_sessions, and the device principal of
 *       2026-09-30 (no DATABASE_URL, sent from a page) - both used to be
 *       admitted. A Supabase PHONE account's JWT is refused too; a Google
 *       account's JWT is admitted; a forged JWT is refused.
 *     - the model routes: a PIN-shaped token from a page reaches no model.
 *
 *   BROWSER (Chromium, every page that loads auth.js):
 *     - signed out, unreachable and unconfigured: no phone or PIN input and no
 *       mobile sign-in control is rendered, and the rail's sign-in reads
 *       "Sign in with Google";
 *     - the sign-in control (the rail's chip, the brand gate's button) starts
 *       Google OAuth - signInWithOAuth({provider:'google'}), intercepted - and
 *       opens no panel;
 *     - a stored legacy phone session is ended on boot with the note, its
 *       token is never sent, and the brands that account kept on the device
 *       stay where they were AND appear in the signed-out device store;
 *     - an auth host that is down (and an unconfigured deployment, and a
 *       project with Google off) never navigates the browser anywhere: the
 *       press is answered with the sentence that names the host.
 *
 * Run: npx playwright test tests/google-only-signin.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORE = require.resolve('../api/_shared/mobile-auth-core.js');
const BRAND_CORE = require.resolve('../api/_shared/brand-workspace-core.js');
const PUBLIC_CONFIG = require.resolve('../api/public-config.js');
const NEON = (() => { try { return require.resolve('@neondatabase/serverless'); } catch (_) { return null; } })();

const ENV_KEYS = ['DATABASE_URL', 'NEON_DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY',
  'CRON_SECRET', 'MOBILE_PIN_PEPPER', 'ANALYTICS_ADMIN_DOMAINS', 'CREDITS_COMP_PHONES'];
const saved = {};
let savedFetch;
test.beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  savedFetch = global.fetch;
});
test.afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  global.fetch = savedFetch;
  for (const p of [CORE, BRAND_CORE, PUBLIC_CONFIG]) delete require.cache[p];
});

const fresh = (p) => { delete require.cache[p]; return require(p); };
const PIN_TOKEN = 'P'.repeat(20) + 'q'.repeat(23);           // the PIN sign-in's token shape: 43 base64url, no dots
const ORIGIN_HEADERS = { origin: 'https://app.example.test', referer: 'https://app.example.test/kicksgpt.html' };
const jwt = (sub) => [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ sub })).toString('base64url'), 'sig'].join('.');

/** global.fetch that answers only what a case routes, and records every attempt. */
function guard(routes) {
  const calls = [];
  global.fetch = async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    calls.push(u);
    for (const [test, answer] of routes || []) if (test(u)) return answer(u, init || {});
    throw new Error('google-only-signin: unrouted network call ' + u);
  };
  return calls;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mockRes() {
  const out = { code: 0, body: null, headers: {} };
  const res = {
    status(c) { out.code = c; return res; },
    json(b) { out.body = b; return res; },
    send(b) { out.body = b; return res; },
    setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; },
    removeHeader(k) { delete out.headers[String(k).toLowerCase()]; },
    end() { return res; },
  };
  return { res, out };
}

/**
 * An in-memory Neon over the neon driver's require.cache entry, holding ONE
 * live session for PIN_TOKEN - so a gate that still looked the token up would
 * find it valid. Every statement is logged.
 */
function neonWithLiveSession() {
  const log = [];
  const sql = async (strings, ...vals) => {
    const text = strings.join(' $ ').replace(/\s+/g, ' ').trim().toLowerCase();
    log.push(text);
    if (text.startsWith('select s.user_id, s.expires_at, u.name, u.phone from app_sessions s')) {
      return [{ user_id: 'aaaaaaaa-0000-4000-8000-000000000001', expires_at: new Date(Date.now() + 86400000).toISOString(), name: 'Asha', phone: '+919876543210' }];
    }
    return [];
  };
  if (NEON) require.cache[NEON] = { id: NEON, filename: NEON, loaded: true, exports: { neon: () => sql } };
  return { sql, log, restore() { if (NEON) delete require.cache[NEON]; } };
}

/* ═══ SERVER ════════════════════════════════════════════════════════════════ */

test('op=enter is refused by the shipped handler for every method, before anything is read, and op=status says Google', async () => {
  process.env.DATABASE_URL = 'postgres://u:p@ep-google-only.neon.tech/db';
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.MOBILE_PIN_PEPPER = 'x'.repeat(48);
  const neon = neonWithLiveSession();
  const calls = guard([]);   // nothing may be fetched
  try {
    const handler = fresh(PUBLIC_CONFIG);
    for (const method of ['POST', 'GET', 'PUT']) {
      const r = mockRes();
      await handler({ method, query: { action: 'auth', op: 'enter' }, headers: { 'x-forwarded-for': '203.0.113.7' }, body: { phone: '9876543210', cc: '+91', name: 'Asha', pin: '7391' } }, r.res);
      expect(r.out.code, method + ' op=enter was not refused').toBe(410);
      expect(r.out.body).toMatchObject({ ok: false, error: 'pin_signin_removed' });
      expect(String(r.out.body.message)).toMatch(/Sign-in is with Google/);
      expect(r.out.body.token, 'a refusal carried a session token').toBeUndefined();
      expect(r.out.body.refresh_token).toBeUndefined();
    }
    expect(neon.log, 'op=enter touched the account database').toEqual([]);
    expect(calls, 'op=enter reached the network (GoTrue, a ledger)').toEqual([]);

    const st = mockRes();
    await handler({ method: 'GET', query: { action: 'auth', op: 'status' }, headers: {} }, st.res);
    expect(st.out.code).toBe(200);
    expect(st.out.body).toMatchObject({ ok: true, mode: 'google', signin: 'google', pin_signin: false });

    const me = mockRes();
    await handler({ method: 'GET', query: { action: 'auth', op: 'me' }, headers: { 'x-lifecycle-token': PIN_TOKEN } }, me.res);
    expect(me.out.code).toBe(401);
    expect(me.out.body.user).toBeUndefined();
  } finally { neon.restore(); }
});

test('a PIN-shaped token is refused exactly like no token: a live Neon session, and the old device principal', async () => {
  // 1. A deployment WITH a database, and the token IS a live session there.
  process.env.DATABASE_URL = 'postgres://u:p@ep-google-only.neon.tech/db';
  const neon = neonWithLiveSession();
  let calls = guard([]);
  try {
    const core = fresh(BRAND_CORE);
    const anon = await core.requireUser({ headers: Object.assign({}, ORIGIN_HEADERS) });
    const live = await core.requireUser({ headers: Object.assign({ 'x-lifecycle-token': PIN_TOKEN, authorization: 'Bearer ' + PIN_TOKEN }, ORIGIN_HEADERS) });
    expect(anon).toMatchObject({ ok: false, status: 401, error: 'sign_in_required' });
    expect(live, 'a live PIN session was admitted').toMatchObject({ ok: false, status: 401, error: 'sign_in_required' });
    expect(live.provider).toBeUndefined();
    expect(String(live.message)).toMatch(/Google/);
    expect(neon.log, 'the gate still looked a PIN session up').toEqual([]);
    expect(calls).toEqual([]);
  } finally { neon.restore(); }

  // 2. No DATABASE_URL and no Supabase: the state in which a well-shaped token
  //    from a page used to be a `mode:'device'` principal running unmetered.
  delete process.env.DATABASE_URL;
  calls = guard([]);
  const core = fresh(BRAND_CORE);
  const device = await core.requireUser({ headers: Object.assign({ 'x-lifecycle-token': PIN_TOKEN, authorization: 'Bearer ' + PIN_TOKEN }, ORIGIN_HEADERS), body: { phone: '+919876543210' } });
  expect(device.ok, 'the device principal was admitted: ' + JSON.stringify(device)).toBe(false);
  expect(device).toMatchObject({ status: 401, error: 'sign_in_required' });
  expect(device.mode).toBeUndefined();
  const verdict = await fresh(CORE).verifyToken(PIN_TOKEN);
  expect(verdict).toEqual({ ok: false, reason: 'pin_signin_removed' });
  expect(calls).toEqual([]);
});

test('a Google account is a principal; a Supabase phone account, another provider and a forged JWT are not', async () => {
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const USERS = {
    [jwt('google-1')]: { id: 'google-1', email: 'Person@Example.com', app_metadata: { provider: 'google', providers: ['google'] }, identities: [{ provider: 'google' }] },
    [jwt('phone-1')]: { id: 'phone-1', email: '', phone: '919876543210', app_metadata: { provider: 'phone', lifecycle_account: 'mobile-pin', phone_e164: '+919876543210' }, user_metadata: { name: 'Asha' } },
    [jwt('github-1')]: { id: 'github-1', email: 'gh@example.com', app_metadata: { provider: 'github' }, identities: [{ provider: 'github' }] },
  };
  guard([[(u) => u === 'https://proj.supabase.co/auth/v1/user', (_u, init) => {
    const t = String((init.headers || {}).authorization || '').replace(/^Bearer /, '');
    return USERS[t] ? json(200, USERS[t]) : json(401, { msg: 'invalid JWT' });
  }]]);
  const core = fresh(BRAND_CORE);
  const ask = (t) => core.requireUser({ headers: Object.assign({ authorization: 'Bearer ' + t }, ORIGIN_HEADERS) });
  const google = await ask(jwt('google-1'));
  expect(google, JSON.stringify(google)).toMatchObject({ ok: true, user_id: 'google-1', email: 'person@example.com', mode: 'supabase' });
  expect(google.provider).toBeUndefined();
  const phone = await ask(jwt('phone-1'));
  expect(phone, 'a Supabase phone account was admitted').toMatchObject({ ok: false, status: 401, error: 'sign_in_required' });
  const gh = await ask(jwt('github-1'));
  expect(gh).toMatchObject({ ok: false, status: 401, error: 'sign_in_required' });
  const forged = await ask(jwt('attacker'));
  expect(forged.ok).toBe(false);
  expect(forged.status).toBe(401);
});

test('a PIN-shaped token from a page reaches no model on the generate route', async () => {
  // The route the device principal of 2026-09-30 opened. No DATABASE_URL, no
  // Supabase: exactly that state. Any provider call would throw out of the
  // guard and be recorded.
  const calls = guard([]);
  const GEN = require.resolve('../api/ai/generate.js');
  delete require.cache[GEN];
  const handler = require(GEN);
  const r = mockRes();
  await handler({ method: 'POST', query: {}, url: '/api/ai/generate', headers: Object.assign({ 'content-type': 'application/json', 'x-lifecycle-token': PIN_TOKEN, authorization: 'Bearer ' + PIN_TOKEN }, ORIGIN_HEADERS), body: { mode: 'chat', prompt: 'hello' } }, r.res);
  expect(r.out.code, JSON.stringify(r.out.body)).toBeGreaterThanOrEqual(400);
  expect(r.out.code).toBeLessThan(500);
  expect(calls, 'a provider was called for a PIN-shaped token').toEqual([]);
  delete require.cache[GEN];
});

/* ═══ BROWSER ═══════════════════════════════════════════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const PAGES = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  // A page that LOADS auth.js (campaign.html only names it in a comment).
  .filter((f) => /<script[^>]+src=["'][^"']*\/?auth\.js/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  .sort();

const LIVE = { supabase: { url: 'https://live-project.supabase.co', anonKey: 'anon' } };
const DEAD = { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } };
const NONE = { ok: true };

/**
 * Serve the repo as app.example.test (a real host: localhost is the dev
 * preview and takes another path) with supabase-js replaced by a recorder.
 * signInWithOAuth NAVIGATES, as the real one does: if auth.js ever called it
 * for a host that is down, the browser would request <host>/auth/v1/authorize,
 * and that request is recorded.
 */
async function open(page, file, o) {
  const opts = o || {};
  const seen = { api: [], authorize: [], errors: [] };
  page.on('pageerror', (e) => seen.errors.push(String(e.message || e)));
  page.on('request', (r) => {
    const u = r.url();
    if (/\/auth\/v1\/authorize/.test(u)) seen.authorize.push(u);
    if (/app\.example\.test\/api\//.test(u)) seen.api.push({ url: u, authorization: r.headers().authorization || '', legacy: r.headers()['x-lifecycle-token'] || '' });
  });
  await page.addInitScript((init) => {
    // The brand gate stays out of automation's way (navigator.webdriver); a
    // case that drives the gate's own button says so.
    if (init.gate) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
    try { localStorage.clear(); } catch (_) {}
    Object.keys(init.storage || {}).forEach((k) => localStorage.setItem(k, init.storage[k]));
    window.__oauth = [];
    window.supabase = {
      createClient: (url) => ({
        auth: {
          getSession: async () => ({ data: { session: init.session || null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async (args) => {
            window.__oauth.push(JSON.parse(JSON.stringify(args)));
            if (init.navigate) location.assign(url + '/auth/v1/authorize?provider=google');
            return { error: null };
          },
          signOut: async () => ({}),
        },
      }),
    };
  }, { storage: opts.storage || {}, navigate: !!opts.navigate, gate: !!opts.gate, session: opts.session || null });

  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return opts.reachable === false ? route.abort('addressunreachable') : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/\/auth\/v1\/settings/.test(u)) {
      if (opts.reachable === false) return route.abort('addressunreachable');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ external: { google: !opts.googleOff, phone: false } }) });
    }
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: esm ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};',
    });
  });
  await page.route('http://app.example.test/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }) }));
  await page.route(/\/api\/public-config(\?|$)/, (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get('action')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.config || NONE) });
  });
  await page.goto('http://app.example.test/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending', null, { timeout: 15000 });
  await page.waitForTimeout(250);
  return seen;
}

/** Everything on the page that would let a person sign in with a phone. */
async function phoneControls(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const found = [];
    document.querySelectorAll('#lnav-mauth, [id^="lnav-mauth"], input[type="tel"], input[autocomplete="one-time-code"], input[autocomplete="tel"], input[autocomplete="tel-national"]').forEach((el) => found.push(el.id || el.outerHTML.slice(0, 80)));
    document.querySelectorAll('input[inputmode="numeric"]').forEach((el) => { if (Number(el.getAttribute('maxlength')) === 4) found.push('4-digit numeric input ' + (el.id || '')); });
    document.querySelectorAll('button, a, [role="button"]').forEach((el) => {
      if (vis(el) && /mobile number|mobile-number|your PIN|4-digit PIN|with (your )?(phone|mobile)/i.test(el.textContent || '')) found.push('control: ' + (el.textContent || '').trim().slice(0, 60));
    });
    // A section marked historical (privacy.html's record of the retired
    // sign-in) describes what WAS; it offers nothing.
    let words = (document.body && document.body.innerText) || '';
    document.querySelectorAll('[data-historical]').forEach((h) => { words = words.split(h.innerText).join(''); });
    const m = words.match(/sign in with (your )?(mobile|phone)[^.\n]*|4-digit PIN|mobile number and (a )?(4-digit )?PIN/i);
    if (m) found.push('text: ' + m[0]);
    return found;
  });
}

test('the page list is real', () => {
  expect(PAGES.length, 'no pages carrying auth.js were found').toBeGreaterThan(20);
  expect(PAGES).toContain('onboarding.html');
  expect(PAGES).toContain('smart-brain.html');
});

test('EVERY page, signed out / unreachable / unconfigured: no phone or PIN control, and the sign-in is Google', async ({ page }) => {
  test.setTimeout(1_200_000);
  const states = [['signed out', { config: LIVE }], ['unreachable', { config: DEAD, reachable: false }], ['unconfigured', { config: NONE }]];
  const bad = [];
  let measured = 0;
  for (const [label, opts] of states) {
    for (const f of PAGES) {
      try { await open(page, f, opts); }
      catch (e) { bad.push(`${f} (${label}): auth.js never decided (${String(e.message || e).split('\n')[0]})`); await page.unrouteAll({ behavior: 'ignoreErrors' }); continue; }
      const found = await phoneControls(page);
      if (found.length) bad.push(`${f} (${label}): ${found.join(' | ')}`);
      const chip = page.locator('#lnav-signin');
      if (await chip.count()) {
        measured++;
        const txt = (await chip.textContent()) || '';
        if (!/Sign in with Google/.test(txt) && !/Sign-in unavailable|Checking sign-in/.test(txt)) bad.push(`${f} (${label}): the rail's sign-in reads "${txt.trim()}"`);
      }
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  }
  expect(measured, 'no rail sign-in chip was measured anywhere').toBeGreaterThan(PAGES.length);
  expect(bad, 'a phone or PIN sign-in is still offered:\n  ' + bad.join('\n  ')).toEqual([]);
});

test('the only sign-in control starts Google OAuth (intercepted) and opens no panel - the rail and the brand gate', async ({ page }) => {
  const seen = await open(page, 'smart-brain.html', { config: LIVE });
  await page.locator('#lnav-signin').click();
  await expect.poll(() => page.evaluate(() => window.__oauth.length)).toBe(1);
  expect(await page.evaluate(() => window.__oauth[0])).toEqual({
    provider: 'google',
    options: { redirectTo: 'http://app.example.test/', queryParams: { prompt: 'select_account' } },
  });
  expect(await page.evaluate(() => localStorage.getItem('lc-return-to'))).toBe('/smart-brain.html');
  expect(await phoneControls(page), 'pressing Sign in opened a phone or PIN control').toEqual([]);
  expect(seen.api.filter((c) => /action=auth/.test(c.url)), 'the press asked the PIN router').toEqual([]);

  // The brand gate's own button (no brand on this device): Google too.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await open(page, 'smart-brain.html', { config: LIVE, gate: true });
  const gateBtn = page.locator('[data-gate-signin]');
  await expect(gateBtn).toHaveText('Sign in with Google');
  await gateBtn.click();
  await expect.poll(() => page.evaluate(() => window.__oauth.length)).toBe(1);
  expect(await page.evaluate(() => window.__oauth[0].provider)).toBe('google');
  expect(await phoneControls(page)).toEqual([]);
});

test('a Google session keys the device store by its Supabase user id; signed out uses the unscoped key', async ({ page }) => {
  const UID = 'bbbbbbbb-0000-4000-8000-0000000000bb';
  const session = { access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJiYmJiIn0.Zml4', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 86400,
    user: { id: UID, email: 'b@example.test', app_metadata: { provider: 'google' }, user_metadata: { name: 'Bea' } } };
  const seen = await open(page, 'onboarding.html', { config: LIVE, session });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded, null, { timeout: 15000 });
  const signedIn = await page.evaluate(() => ({
    kind: window.LifecycleAuth.backend.kind,
    key: window.BrandContext.device.key(),
    files: window.BrandContext.files ? window.BrandContext.files.namespace() : null,
    name: (document.querySelector('#lifecycle-nav .lnav-uname') || {}).textContent || '',
  }));
  expect(signedIn.kind).toBe('signed-in');
  expect(signedIn.key).toBe('lifecycle.brand.device.workspaces.' + UID);
  if (signedIn.files !== null) expect(signedIn.files).toBe(signedIn.key);
  expect(signedIn.name).toBe('Bea');
  // The Google access token, and nothing PIN-shaped, rides the app's requests.
  const sent = seen.api.filter((c) => c.authorization);
  expect(sent.length, 'no request carried the Google token').toBeGreaterThan(0);
  for (const c of sent) expect(c.authorization).toBe('Bearer ' + session.access_token);
  expect(seen.api.filter((c) => c.legacy), 'a PIN-era header was sent').toEqual([]);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await open(page, 'onboarding.html', { config: LIVE });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded, null, { timeout: 15000 });
  expect(await page.evaluate(() => window.BrandContext.device.key())).toBe('lifecycle.brand.device.workspaces');
});

test('a stored phone session is ended on boot with the note, its token never sent, and its device brands kept', async ({ page }) => {
  const UID = 'aaaaaaaa-0000-4000-8000-0000000000aa';
  const BRAND = { id: 'local-0123456789abcdef', name: 'Asha Teas', slug: 'asha-teas', status: 'draft', storage: 'device', palette: { primary: '#1a6b3c', surface: '#ffffff', ink: '#111111', accent: '#c8a24a' } };
  const accountKey = 'lifecycle.brand.device.workspaces.' + UID;
  const accountRows = JSON.stringify({ version: 1, active_id: BRAND.id, workspaces: [BRAND] });
  const storage = {
    'lifecycle.auth.session': JSON.stringify({ provider: 'mobile-pin', mode: 'server', token: PIN_TOKEN, user: { id: UID, name: 'Asha', phone: '+919876543210' }, expires: new Date(Date.now() + 86400000).toISOString() }),
    'lifecycle.auth.device.users': JSON.stringify({ '+919876543210': { id: UID, name: 'Asha', salt: 'ab', hash: 'cd', iterations: 120000 } }),
    [accountKey]: accountRows,
    [accountKey + '.catalog.' + BRAND.id]: JSON.stringify({ rows: [{ title: 'First Flush' }] }),
  };
  const seen = await open(page, 'onboarding.html', { config: LIVE, storage });
  const after = await page.evaluate((k) => ({
    session: localStorage.getItem('lifecycle.auth.session'),
    users: localStorage.getItem('lifecycle.auth.device.users'),
    account: localStorage.getItem(k),
    unscoped: JSON.parse(localStorage.getItem('lifecycle.brand.device.workspaces') || 'null'),
    side: localStorage.getItem('lifecycle.brand.device.workspaces.catalog.local-0123456789abcdef'),
    who: window.LifecycleAuth.session,
    kind: window.LifecycleAuth.backend.kind,
  }), accountKey);
  expect(after.session, 'the phone session survived the boot').toBeNull();
  expect(after.users).toBeNull();
  expect(after.who).toBeNull();
  expect(after.kind).toBe('signed-out');
  expect(after.account, 'the brands the phone account kept were touched').toBe(accountRows);
  expect(after.unscoped && after.unscoped.workspaces.map((w) => w.id)).toEqual([BRAND.id]);
  expect(after.unscoped.active_id).toBe(BRAND.id);
  expect(after.side, 'the catalogue kept beside the brand was not carried').toBe(JSON.stringify({ rows: [{ title: 'First Flush' }] }));

  await expect(page.locator('#lc-authnotice')).toContainText('Mobile-number sign-in has ended');
  await expect(page.locator('#lc-authnotice')).toContainText(/1 brand it kept on this device is still here/);
  const note = page.locator('#lnav-signin-note');
  await expect(note).toHaveAttribute('data-kind', 'phone-ended');
  await expect(note).toContainText('Sign-in is with Google now');
  const edge = await note.evaluate((el) => getComputedStyle(el).boxShadow);
  const accent = await page.evaluate(() => getComputedStyle(document.getElementById('lifecycle-nav')).getPropertyValue('--vh-accent').trim());
  expect(edge, 'the note is not in the accent rule').toContain('inset');
  expect(accent).not.toBe('');

  // The old token went out once - to revoke it - and on nothing else.
  const carrying = seen.api.filter((c) => c.authorization.includes(PIN_TOKEN) || c.legacy === PIN_TOKEN);
  expect(carrying.map((c) => new URL(c.url).search)).toEqual(['?action=auth&op=signout']);

  // The kept brand is this browser's active brand now: the wizard lists it.
  await expect.poll(() => page.evaluate(() => (window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.name) || '')).toBe('Asha Teas');
});

test('an auth host that is down, no configuration, or Google off: the press never navigates and names why', async ({ page }) => {
  // Down: the press is refused BEFORE signInWithOAuth, whose stub here would
  // navigate the browser to <host>/auth/v1/authorize as the real one does.
  let seen = await open(page, 'smart-brain.html', { config: DEAD, reachable: false, navigate: true });
  const before = page.url();
  await page.locator('#lnav-signin').click();
  await expect(page.locator('#lnav-signin-note')).toContainText('paused-project.supabase.co');
  await expect(page.locator('#lnav-signin-note')).toContainText(/deleted, renamed or paused/);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__oauth.length), 'signInWithOAuth was called for a host that is down').toBe(0);
  expect(seen.authorize, 'the browser was sent to a dead host').toEqual([]);
  expect(page.url()).toBe(before);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Unconfigured.
  seen = await open(page, 'smart-brain.html', { config: NONE, navigate: true });
  await page.locator('#lnav-signin').click();
  await expect(page.locator('#lnav-signin-note')).toContainText('SUPABASE_URL');
  expect(seen.authorize).toEqual([]);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Reachable, Google provider off.
  seen = await open(page, 'smart-brain.html', { config: LIVE, googleOff: true, navigate: true });
  await page.locator('#lnav-signin').click();
  await expect(page.locator('#lnav-signin-note')).toContainText('Google is not enabled');
  expect(await page.evaluate(() => window.__oauth.length)).toBe(0);
  expect(seen.authorize).toEqual([]);
});
