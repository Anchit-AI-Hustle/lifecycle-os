// Every agent PAGE, driven in Chromium against the real routers.
//
// The agent surfaces the operator can press a button on - KicksGPT, the
// concierge agent, the social pipeline console, the TeleSuite hub, the Smart
// Brain console's agentic run, the landing-page agent, the app-wide copilot
// popup and the buyer widget on a landing page - are opened as real pages
// served from this repo, with every /api/ call FORWARDED to the shipped
// routers running in this process (tests/agents-harness.js): nothing here
// models a server.
//
// ── 2026-10-10: GOOGLE IS THE ONLY SIGN-IN ──────────────────────────────────
// The two phone sessions below (device, and a listed server-mode number) are
// switched off. The pages are now driven with a GOOGLE session - supabase-js
// restoring an access token the fake project verifies, for an account whose
// active brand is its own workspace - and a LEFTOVER phone session is shown
// to be ended on boot and to reach no model. Retired with that change: the
// TeleSuite device-library runs and the listed number's wallet pill (both
// existed only for a phone principal). The history of this file:
//
//   device   a mobile+PIN session kept only in this browser, on a deployment
//            with no DATABASE_URL - the state production is in today. The
//            token is sent from the page; the server admits it as a device
//            principal and features run unmetered (2026-09-30). TeleSuite
//            runs too (2026-10-03): its library and history are kept on the
//            device and a tool request carries what it reads.
//   server   a server-mode phone session whose number the operator listed.
//            The assistant answers as the brand kept on the device, the
//            metered copilot turn takes a hold on the wallet and settles it,
//            and a TeleSuite run is metered on that wallet like any other.
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
const DEVICE_SENTENCE = /saved on this device only|exists only in this browser|mobile number|\bPIN\b/i;

/**
 * Seed the page: a Google session supabase-js restores (args.google), or a
 * LEFTOVER phone session the way auth.js stored one before 2026-10-10
 * (args.phone), or nothing.
 */
function seed(args) {
  try {
    if (args.phone) {
      localStorage.setItem('lifecycle.auth.session', JSON.stringify(args.phone.session));
      localStorage.setItem('lifecycle.brand.device.workspaces.' + args.phone.user.id, JSON.stringify({ version: 1, active_id: args.phone.brand.id, workspaces: [args.phone.brand] }));
    }
  } catch (_) {}
  var googleSession = args.google || null;
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
          getSession: async function () { return { data: { session: googleSession } }; },
          getUser: async function () { return { data: { user: googleSession && googleSession.user } }; },
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

/** The Google account the fake project holds: `tok-owner` -> user-owner, whose active brand is its own workspace. */
const GOOGLE = {
  access_token: 'tok-owner', refresh_token: 'r-owner', expires_at: Math.floor(Date.now() / 1000) + 86400,
  user: { id: 'user-owner', email: 'owner@example.test', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { name: 'Owner Person' } },
};

async function open(page, w, file, mode, anonymous) {
  const log = watch(page);
  if (anonymous) {
    await page.addInitScript(seed, {});
  } else if (mode === 'phone') {
    const user = { id: w.tokens.phoneUserId, phone: A.PHONE.e164, name: A.PHONE.name };
    await page.addInitScript(seed, { phone: { user, session: w.session('server'), brand: A.deviceBrand() } });
  } else {
    await page.addInitScript(seed, { google: GOOGLE });
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

/* ═══ a Google session: the one sign-in ═══════════════════════════════════ */

test.describe('a Google session', () => {
  let w;
  test.beforeAll(async () => {
    w = await A.world();
    // The account's own wallet on its own brand, funded, so a metered turn
    // is held and settled rather than refused for an empty balance.
    w.db.insert('credit_wallets', { user_id: 'user-owner', workspace_id: 'ws-oldest', balance: 100000, held: 0, lifetime_granted: 100000, lifetime_spent: 0, low_balance_threshold: 50 });
  });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  test('KicksGPT: the turn runs as the account, and the transcript shows the scripted reply', async ({ page }) => {
    const log = await open(page, w, 'kicksgpt.html', 'google');
    expect(await page.evaluate(() => window.LifecycleAuth.backend.kind)).toBe('signed-in');
    await page.fill('#q', 'What is our best cohort?');
    await page.click('#send');
    const bot = page.locator('#chat .msg.bot:not(.status)').last();
    await expect(bot).toHaveText(/Scripted reply for this turn/, { timeout: 15000 });
    const turn = log.api.filter((r) => /action=brand-chat/.test(r.url));
    expect(turn.map((r) => r.status)).toEqual([200]);
    expect(w.llm.calls.map((c) => c.stage)).toContain('kicksgpt');
    const shown = await bodyText(page);
    expect(shown).not.toMatch(DEVICE_SENTENCE);
    clean(log, shown, 'kicksgpt');
  });

  test('the concierge agent: the empty box is told what to do, then a turn leaves', async ({ page }) => {
    const log = await open(page, w, 'agent.html', 'google');
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
    const log = await open(page, w, 'social-media.html', 'google');
    await page.click('#runBtn');
    await expect.poll(() => log.api.filter((r) => /action=social-run-daily/.test(r.url)).length, { timeout: 15000 }).toBeGreaterThan(0);
    await page.click('#loadBtn');
    await expect.poll(() => log.api.filter((r) => /action=social-list/.test(r.url)).length, { timeout: 10000 }).toBeGreaterThan(0);
    const shown = await bodyText(page);
    expect(shown).not.toMatch(DEVICE_SENTENCE);
    clean(log, shown, 'social');
  });

  test('the TeleSuite hub starts and its tool form carries no refusal', async ({ page }) => {
    const tool = TELESUITE.SUBFEATURES.find((s) => s.kind === 'tool' && s.key === 'pitch-generator');
    const log = await open(page, w, 'telesuite.html#' + tool.key, 'google');
    await page.waitForSelector('#run', { timeout: 20000 });
    expect(log.api.filter((r) => /op=registry/.test(r.url)).map((r) => r.status)).toEqual([200]);
    expect(await page.locator('#form .vh-status').count(), 'the tool form carries a refusal').toBe(0);
    clean(log, await bodyText(page), 'telesuite');
  });

  test('the Smart Brain console: the agentic run reaches the server', async ({ page }) => {
    const log = await open(page, w, 'smart-brain.html', 'google');
    await page.waitForSelector('#runAgentic');
    test.setTimeout(150000);
    const sent = page.waitForRequest((r) => /action=agentic-run/.test(r.url()), { timeout: 15000 });
    const answered = page.waitForResponse((r) => /action=agentic-run/.test(r.url()), { timeout: 90000 });
    await page.click('#runAgentic');
    await sent;
    await answered;
    await expect(page.locator('#agenticOut')).not.toContainText('please wait', { timeout: 10000 });
    expect(log.api.filter((r) => /action=agentic-run/.test(r.url)).map((r) => r.status)).toEqual([200]);
    const shown = await bodyText(page);
    expect(shown).not.toMatch(DEVICE_SENTENCE);
    clean(log, shown, 'smart-brain');
  });

  test('the landing-page agent: Generate reaches /api/ai/', async ({ page }) => {
    const log = await open(page, w, 'landing-page-agent.html', 'google');
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
    const log = await open(page, w, 'coffee-collection-landing-with-agent.html', 'google', true);
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

/* ═══ a LEFTOVER phone session: ended on boot, and reaches no model ═══════ */

test.describe('a mobile-number session left in the browser (switched off 2026-10-10)', () => {
  let w;
  test.beforeAll(async () => { w = await A.world({ compPhones: A.PHONE.e164 }); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  test('KicksGPT: the session is ended, the turn is refused with a sentence, and no model or wallet is reached - even for a listed number', async ({ page }) => {
    const log = await open(page, w, 'kicksgpt.html', 'phone');
    expect(await page.evaluate(() => [window.LifecycleAuth.session, localStorage.getItem('lifecycle.auth.session'), window.LifecycleAuth.backend.kind]))
      .toEqual([null, null, 'signed-out']);
    await page.fill('#q', 'What is our best cohort?');
    await page.click('#send');
    await page.waitForTimeout(1500);
    expect(w.llm.calls, 'a leftover phone session reached the model').toEqual([]);
    expect(w.db.calls.filter((c) => /rpc\/credit_|credit_wallets/.test(c.url)), 'a leftover phone session touched the ledger').toEqual([]);
    const shown = await bodyText(page);
    expect(shown).not.toMatch(/Scripted reply/);
    clean(log, shown.replace(/Mobile-number sign-in has ended\.[^\n]*/g, ''), 'kicksgpt leftover phone');
  });
});
