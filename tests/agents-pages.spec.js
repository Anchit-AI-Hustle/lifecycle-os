// Every agent PAGE, driven in Chromium against the real routers.
//
// The agent surfaces the operator can press a button on - KicksGPT, the
// concierge agent, the social pipeline console, the TeleSuite hub, the Smart
// Brain console's agentic run, the landing-page agent, the app-wide copilot
// popup and the buyer widget on a landing page - are opened as real pages
// served from this repo, with every /api/ call FORWARDED to the shipped
// routers running in this process (tests/agents-harness.js): nothing here
// models a server. Two sessions, both seeded the way auth.js stores them:
//
//   device   a mobile+PIN session kept only in this browser, on a deployment
//            with no DATABASE_URL - the state production is in today. The
//            token is sent from the page; the server admits it as a device
//            principal and features run unmetered (2026-09-30). TeleSuite
//            still refuses a phone account (no email identity there).
//   server   a server-mode phone session whose number the operator listed.
//            The assistant answers as the brand kept on the device, the
//            metered copilot turn takes a hold on the wallet and settles it,
//            and TeleSuite refuses with the sentence for a phone account.
//
// A native dialog, a page error, "undefined" or "[object Object]" in the
// transcript, a raw code where a sentence should be, or a blank answer is a
// defect. page.on('dialog') and page.on('pageerror') are registered before
// navigation. Found by running this before the fixes: KicksGPT printed
// "Something went wrong: no_active_brand.", the concierge "Hmm, something went
// wrong: no_active_brand. Try again?", the buyer widget the word "undefined",
// the social console "Pipeline call failed: no_active_brand — is the API
// deployed/reachable?", and the copilot "Sorry — I couldn't reach the model
// just now" for a 401 the server had explained in full.
//
// Run: npx playwright test tests/agents-pages.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const A = require('./agents-harness');
const TELESUITE = require(path.join(A.ROOT, 'api', '_shared', 'telesuite-core.js'));

const HOST = 'http://app.agents.test';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const RAW = /\b(sign_in_required|not_authenticated|session_verification_unavailable|invalid_session|credits_require_account|no_active_brand|account_type_unsupported|workspace_unresolved|unauthori[sz]ed|http 401|http 403|http 409)\b/i;
const DEVICE_SENTENCE = /saved on this device only|exists only in this browser/i;
const PHONE_TELESUITE = /mobile-number sign-in has no record there/i;

/** Seed the session and the device brand the way auth.js and brand-context.js store them. */
function seed(args) {
  try {
    const users = {};
    users[args.user.phone] = Object.assign({}, args.user, { salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null, createdAt: args.session.expires, pinSetAt: args.session.expires });
    localStorage.setItem('lifecycle.auth.device.users', JSON.stringify(users));
    localStorage.setItem('lifecycle.auth.session', JSON.stringify(args.session));
    localStorage.setItem('lifecycle.brand.device.workspaces.' + args.user.id, JSON.stringify({ version: 1, active_id: args.brand.id, workspaces: [args.brand] }));
  } catch (_) {}
  // CDN libraries the harness blocks: a no-op stand-in each, so a page is
  // measured on its own code.
  function Noop() {}
  Noop.prototype.update = Noop.prototype.destroy = Noop.prototype.resize = function () {};
  Noop.register = function () {};
  function auto() { return new Proxy({}, { get: function (t, k) { if (typeof k === 'symbol') return undefined; if (!(k in t)) t[k] = auto(); return t[k]; } }); }
  Noop.defaults = auto();
  window.Chart = window.Chart || Noop;
  window.marked = window.marked || { parse: function (s) { return String(s || ''); }, setOptions: function () {} };
  window.lucide = window.lucide || { createIcons: function () {} };
  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: async function () { return { data: { session: null } }; },
          getUser: async function () { return { data: { user: null } }; },
          onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          signInWithOAuth: async function () { return { error: null }; },
          signOut: async function () { return {}; },
        },
        from: function () { var b = {}; ['select', 'eq', 'order', 'limit', 'insert', 'update', 'upsert', 'delete', 'in', 'neq', 'gte', 'lte', 'range'].forEach(function (k) { b[k] = function () { return b; }; }); b.maybeSingle = async function () { return { data: null, error: null }; }; b.single = async function () { return { data: null, error: { message: 'no session' } }; }; b.then = function (res) { return Promise.resolve({ data: [], error: null }).then(res); }; return b; },
        channel: function () { var c = { on: function () { return c; }, subscribe: function () { return c; }, unsubscribe: function () {} }; return c; },
        removeChannel: function () {},
      };
    },
  };
}

function watch(page) {
  const log = { dialogs: [], errors: [], api: [] };
  page.on('dialog', async (d) => { log.dialogs.push(d.type() + ': ' + d.message()); await d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) log.api.push({ url: u.replace(HOST, ''), status: r.status() }); });
  return log;
}

async function open(page, w, file, mode, anonymous) {
  const log = watch(page);
  if (!anonymous) {
    const user = { id: w.tokens.phoneUserId, phone: A.PHONE.e164, cc: A.PHONE.cc, local: A.PHONE.phone, name: A.PHONE.name };
    await page.addInitScript(seed, { user, session: w.session(mode), brand: A.deviceBrand() });
  } else {
    await page.addInitScript(seed, { user: { id: 'nobody', phone: '+910000000000' }, session: null, brand: A.deviceBrand() });
    await page.addInitScript(() => { try { localStorage.removeItem('lifecycle.auth.session'); } catch (_) {} });
  }
  await page.route(/^https?:\/\/(?!app\.agents\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (route.request().resourceType() === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
    return route.abort('failed');
  });
  const fwd = A.forward(w.port);
  await page.route(HOST + '/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api/')) return fwd(route);
    const f = path.join(A.ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(A.ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto(HOST + '/' + file, { waitUntil: 'domcontentloaded' });
  if (!anonymous) {
    await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending', null, { timeout: 20000 });
  }
  return log;
}

async function bodyText(page) { return page.evaluate(() => (document.body && document.body.innerText) || ''); }

function clean(log, shown, label) {
  // `shown` is what the PAGE rendered (document.body.innerText), read after
  // the press: a runtime result, not a file.
  expect(log.dialogs, `${label}: a native dialog`).toEqual([]);
  expect(log.errors, `${label}: a page error`).toEqual([]);
  expect(shown, `${label}: "undefined" rendered`).not.toMatch(/\bundefined\b/);
  expect(shown, `${label}: an object rendered`).not.toContain('[object Object]');
  expect(shown, `${label}: a raw code rendered`).not.toMatch(RAW);
}

/* ═══ the device session: production's state today ═══════════════════════ */

test.describe('device-mode mobile+PIN session, no DATABASE_URL', () => {
  let w;
  test.beforeAll(async () => { w = await A.world({ serverMode: false }); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  test('KicksGPT: the turn runs, and the transcript shows the scripted reply', async ({ page }) => {
    const log = await open(page, w, 'kicksgpt.html', 'device');
    await page.fill('#q', 'What is our best cohort?');
    await page.click('#send');
    const bot = page.locator('#chat .msg.bot:not(.status)').last();
    await expect(bot).toHaveText(/Scripted reply for this turn/, { timeout: 15000 });
    const turn = log.api.filter((r) => /action=brand-chat/.test(r.url));
    expect(turn.map((r) => r.status)).toEqual([200]);
    expect(await bodyText(page)).not.toMatch(DEVICE_SENTENCE);
    clean(log, await bodyText(page), 'kicksgpt');
  });

  test('the concierge agent: the empty box is told what to do, then a turn leaves', async ({ page }) => {
    const log = await open(page, w, 'agent.html', 'device');
    await page.waitForSelector('#send');
    await page.click('#send');
    await expect(page.locator('#askNote')).toHaveText(/Type a question first/);
    await page.fill('#q', 'Which pair should I start with?');
    await page.click('#send');
    await expect.poll(() => log.api.filter((r) => /action=agent-chat/.test(r.url)).length, { timeout: 15000 }).toBeGreaterThan(0);
    const shown = await bodyText(page);
    expect(shown).not.toMatch(DEVICE_SENTENCE);
    clean(log, shown, 'agent');
  });

  test('the social pipeline console: Run and Load reach the server, never a red banner with a code', async ({ page }) => {
    const log = await open(page, w, 'social-media.html', 'device');
    await page.click('#runBtn');
    await expect.poll(() => log.api.filter((r) => /action=social-run-daily/.test(r.url)).length, { timeout: 15000 }).toBeGreaterThan(0);
    await page.click('#loadBtn');
    await expect.poll(() => log.api.filter((r) => /action=social-list/.test(r.url)).length, { timeout: 10000 }).toBeGreaterThan(0);
    const shown = await bodyText(page);
    expect(shown).not.toMatch(DEVICE_SENTENCE);
    clean(log, shown, 'social');
  });

  test('the TeleSuite hub starts (its registry is public), and the tool form says a phone account has no library there', async ({ page }) => {
    const tool = TELESUITE.SUBFEATURES.find((s) => s.kind === 'tool' && s.key === 'pitch-generator');
    const log = await open(page, w, 'telesuite.html#' + tool.key, 'device');
    await page.waitForSelector('#run', { timeout: 20000 });
    expect(log.api.filter((r) => /op=registry/.test(r.url)).map((r) => r.status)).toEqual([200]);
    const why = page.locator('#form .vh-status').first();
    await expect(why).toBeVisible({ timeout: 15000 });
    await expect(why).toHaveText(PHONE_TELESUITE);
    const items = log.api.filter((r) => /action=telesuite&op=items/.test(r.url));
    expect(items.length).toBeGreaterThan(0);
    for (const r of items) expect(r.status).toBe(403);
    clean(log, await bodyText(page), 'telesuite');
  });

  test('the Smart Brain console: the agentic run reaches the server', async ({ page }) => {
    const log = await open(page, w, 'smart-brain.html', 'device');
    await page.waitForSelector('#runAgentic');
    await page.click('#runAgentic');
    await expect.poll(() => log.api.filter((r) => /action=agentic-run/.test(r.url)).length, { timeout: 15000 }).toBeGreaterThan(0);
    const shown = await bodyText(page);
    expect(shown).not.toMatch(DEVICE_SENTENCE);
    clean(log, shown, 'smart-brain');
  });

  test('the landing-page agent: Generate reaches /api/ai/', async ({ page }) => {
    const log = await open(page, w, 'landing-page-agent.html', 'device');
    await page.fill('#prompt', 'A complete brief for a launch page: product, audience, offer, proof, visuals, CTA.');
    await page.click('#generate');
    await expect.poll(() => log.api.filter((r) => /\/api\/ai\//.test(r.url)).length, { timeout: 15000 }).toBeGreaterThan(0);
    const shown = await bodyText(page);
    expect(shown).not.toMatch(DEVICE_SENTENCE);
    clean(log, shown, 'landing-page-agent');
  });

});

/* ═══ the buyer widget: an anonymous visitor on a landing page ═══════════ */

test('the buyer widget on a landing page shows the server\'s sentence, never the word "undefined"', async ({ page }) => {
  const w = await A.world({ serverMode: false });
  try {
    const log = await open(page, w, 'coffee-collection-landing-with-agent.html', 'device', true);
    await page.waitForSelector('#vah-agent-fab', { timeout: 20000 });
    await page.click('#vah-agent-fab');
    await page.waitForSelector('#vah-q', { timeout: 10000 });
    await page.fill('#vah-q', 'Which pair suits a first custom?');
    await page.click('#vah-send');
    const reply = page.locator('.vah-m.a').last();
    await expect(reply).toHaveText(/Set up a brand first/, { timeout: 10000 });
    expect(log.api.filter((r) => /action=agent-chat/.test(r.url)).map((r) => r.status)).toEqual([409]);
    const shown = await page.locator('#vah-agent-panel, .vah-panel, body').first().innerText();
    expect(shown).not.toMatch(/\bundefined\b/);
    expect(log.dialogs).toEqual([]);
    expect(log.errors).toEqual([]);
  } finally { await w.close(); }
});

/* ═══ the server-mode session of a LISTED number: the happy path ═════════ */

test.describe('server-mode mobile+PIN session, number listed', () => {
  let w;
  test.beforeAll(async () => { w = await A.world({ compPhones: A.PHONE.e164 }); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  test('KicksGPT answers as the brand kept on the device, with the scripted reply, and the pill shows a wallet', async ({ page }) => {
    const log = await open(page, w, 'kicksgpt.html', 'server');
    await page.fill('#q', 'What is our best cohort?');
    await page.click('#send');
    const bot = page.locator('#chat .msg.bot:not(.status)').last();
    await expect(bot).toHaveText(/Scripted reply for this turn/, { timeout: 15000 });
    const turn = log.api.find((r) => /action=brand-chat/.test(r.url));
    expect(turn && turn.status).toBe(200);
    expect(w.llm.calls.map((c) => c.stage)).toContain('kicksgpt');
    // The credit pill loaded the LISTED number's wallet - a balance, not the
    // "no wallet" sentence.
    await expect(page.locator('.lc-credit-pill')).toHaveAttribute('data-credits-state', 'wallet', { timeout: 15000 });
    await expect(page.locator('.lc-credit-pill')).toHaveText(/credits/i);
    clean(log, await bodyText(page), 'kicksgpt server');
  });

  test('TeleSuite: the tool form tells a phone account the library does not exist for it, and nothing is charged', async ({ page }) => {
    const tool = TELESUITE.SUBFEATURES.find((s) => s.kind === 'tool' && s.key === 'pitch-generator');
    const log = await open(page, w, 'telesuite.html#' + tool.key, 'server');
    await page.waitForSelector('#run', { timeout: 20000 });
    const why = page.locator('#form .vh-status').first();
    await expect(why).toBeVisible({ timeout: 15000 });
    await expect(why).toHaveText(/mobile-number sign-in has no record there/i);
    const items = log.api.filter((r) => /action=telesuite&op=items/.test(r.url));
    expect(items.length).toBeGreaterThan(0);
    for (const r of items) expect(r.status).toBe(403);
    expect(w.db.calls.filter((c) => /rpc\/credit_hold/.test(c.url))).toEqual([]);
    clean(log, await bodyText(page), 'telesuite server');
  });
});
