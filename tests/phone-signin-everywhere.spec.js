/**
 * Signing in with a phone never turns a feature off - beyond the first screen
 * (2026-10-03).
 * ---------------------------------------------------------------------------
 * The operator's words: "All features must work even with signin by number and
 * pin". tests/phone-signin-features.spec.js covers the onboarding wizard; this
 * covers the review flow of the Smart Brain console, the one place a phone
 * sign-in could look at a feature and was refused the moment it ACTED on it:
 * approve / reject / clear-rejection answered 409 "approving needs a brand
 * workspace", and a plan computed by Daily Sync vanished on the next load.
 *
 * Executed, not read: the real smart-brain.html in Chromium, every /api/ call
 * forwarded to the SHIPPED routers running in this process (tests/
 * agents-harness.js: the scripted model, the in-memory session store, the fake
 * workspace database, and any other host THROWS). The state is production's:
 * no DATABASE_URL, the session kept on the device, the brand on the device.
 *
 * Run: npx playwright test tests/phone-signin-everywhere.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const A = require('./agents-harness');

const HOST = 'http://app.agents.test';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const REFUSED = /approving needs a brand workspace|no_workspace|this sign-in has none|not available on a mobile-number/i;

function seed(args) {
  try {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    const users = {};
    users[args.user.phone] = Object.assign({}, args.user, { salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null, createdAt: args.session.expires, pinSetAt: args.session.expires });
    localStorage.setItem('lifecycle.auth.device.users', JSON.stringify(users));
    localStorage.setItem('lifecycle.auth.session', JSON.stringify(args.session));
    localStorage.setItem('lifecycle.brand.device.workspaces.' + args.user.id, JSON.stringify({ version: 1, active_id: args.brand.id, workspaces: [args.brand] }));
  } catch (_) {}
  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: async function () { return { data: { session: null } }; },
          onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          signOut: async function () { return {}; },
        },
        from: function () { var b = {}; ['select', 'eq', 'order', 'limit', 'insert', 'update', 'upsert', 'delete', 'in'].forEach(function (k) { b[k] = function () { return b; }; }); b.maybeSingle = async function () { return { data: null, error: null }; }; b.then = function (res) { return Promise.resolve({ data: [], error: null }).then(res); }; return b; },
        channel: function () { var c = { on: function () { return c; }, subscribe: function () { return c; }, unsubscribe: function () {} }; return c; },
        removeChannel: function () {},
      };
    },
  };
}

async function open(page, w, file) {
  const log = { dialogs: [], errors: [], api: [] };
  // smart-brain.html asks for a rejection reason with a native prompt; this
  // spec answers it, and records every dialog so nothing else slips through.
  page.on('dialog', async (d) => { log.dialogs.push(d.type()); await (d.type() === 'prompt' ? d.accept('Not this week') : d.dismiss()).catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  page.on('response', async (r) => {
    const u = r.url();
    if (!u.includes('/api/')) return;
    let body = null;
    try { body = await r.json(); } catch (_) {}
    log.api.push({ url: u.replace(HOST, ''), status: r.status(), body });
  });
  const user = { id: w.tokens.phoneUserId, phone: A.PHONE.e164, cc: A.PHONE.cc, local: A.PHONE.phone, name: A.PHONE.name };
  await page.addInitScript(seed, { user, session: w.session('device'), brand: A.deviceBrand() });
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
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending', null, { timeout: 20000 });
  return log;
}

const statuses = (page) => page.evaluate(() => PLAN.map((e) => e.status));   // eslint-disable-line no-undef

test.describe('Smart Brain review flow, phone sign-in kept on this device, no DATABASE_URL', () => {
  let w;
  test.beforeAll(async () => { w = await A.world({ serverMode: false }); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  test('Daily Sync builds a plan, approve / reject / clear work, and all three survive a reload on this device', async ({ page }) => {
    test.setTimeout(240_000);
    const log = await open(page, w, 'smart-brain.html');
    await page.waitForSelector('#sync');
    await page.click('#sync');
    await expect.poll(() => page.evaluate(() => PLAN.length), { timeout: 120_000 }).toBeGreaterThan(1);   // eslint-disable-line no-undef
    const sync = log.api.filter((r) => /smart-brain-sync-daily/.test(r.url));
    expect(sync.map((r) => r.status)).toEqual([200]);

    // Approve the first slot: built exactly as a preview, decision kept here.
    await page.evaluate(() => approveRow(0));   // eslint-disable-line no-undef
    await expect.poll(() => statuses(page).then((s) => s[0]), { timeout: 120_000 }).toBe('final');
    const approve = log.api.filter((r) => /smart-brain-approve/.test(r.url));
    expect(approve.map((r) => r.status), JSON.stringify(approve.map((r) => r.body)).slice(0, 400)).toEqual([200]);
    expect(approve[0].body.storage).toBe('device');
    expect(approve[0].body.persisted).toBe(false);
    expect(approve[0].body.campaign).toBeTruthy();
    // Nothing was published for it, so no hosted /lp/ page is offered.
    expect(await page.evaluate(() => PLAN[0].generated_campaign_id)).toBeNull();   // eslint-disable-line no-undef

    // Reject the second, then clear the rejection on it.
    await page.evaluate(() => rejectRow(1));   // eslint-disable-line no-undef
    await expect.poll(() => statuses(page).then((s) => s[1]), { timeout: 20_000 }).toBe('rejected');
    const reject = log.api.filter((r) => /smart-brain-reject/.test(r.url));
    expect(reject.map((r) => r.status)).toEqual([200]);
    expect(reject[0].body.decision).toMatchObject({ status: 'rejected', notes: 'Not this week' });

    // A reload: the plan and the decisions are read back from this device.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => PLAN.length), { timeout: 60_000 }).toBeGreaterThan(1);   // eslint-disable-line no-undef
    const after = await statuses(page);
    expect(after[0]).toBe('final');
    expect(after[1]).toBe('rejected');
    await expect(page.locator('#changes')).toContainText(/kept on this device/i);

    await page.evaluate(() => resetRow(1));   // eslint-disable-line no-undef
    await expect.poll(() => statuses(page).then((s) => s[1]), { timeout: 20_000 }).toBe('tentative');
    expect(log.api.filter((r) => /smart-brain-unreject/.test(r.url)).map((r) => r.status)).toEqual([200]);

    // Never a refusal for this person, and nothing written to a workspace table.
    const shown = await page.evaluate(() => document.body.innerText);
    expect(shown).not.toMatch(REFUSED);
    expect(log.api.filter((r) => r.status === 409 || r.status === 403 || r.status === 401).map((r) => r.status + ' ' + r.url)).toEqual([]);
    expect(w.db.calls.filter((c) => /smart_calendar_entries|smart_generated_campaigns|smart_feedback/.test(c.url) && c.method !== 'GET')).toEqual([]);
    expect(log.errors).toEqual([]);
    expect(log.dialogs).toEqual(['prompt']);
    expect(w.escaped()).toEqual([]);
  });
});

/* The router itself, for the requests the page sends. */
test.describe('calendar.js decisions for a phone sign-in, over the socket', () => {
  let w;
  test.beforeAll(async () => { w = await A.world({ serverMode: false }); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  const deviceHeaders = (w) => ({ 'x-lifecycle-token': w.tokens.phone, authorization: 'Bearer ' + w.tokens.phone });

  test('reject / unreject / feedback answer 200 with the decision to keep, and write nothing', async () => {
    for (const [action, body, status] of [
      ['smart-brain-reject', { id: 'cal_x', notes: 'no' }, 'rejected'],
      ['smart-brain-unreject', { id: 'cal_x' }, 'tentative'],
    ]) {
      const r = await w.request('/api/calendar', { json: body, query: { action }, state: 'device', headers: deviceHeaders(w) });
      expect(r.status, r.text.slice(0, 300)).toBe(200);
      expect(r.out).toMatchObject({ ok: true, storage: 'device', decision: { id: 'cal_x', status } });
    }
    const fb = await w.request('/api/calendar', { json: { target_id: 'cal_x', verdict: 'comment', notes: 'tighter subject' }, query: { action: 'smart-brain-feedback' }, state: 'device', headers: deviceHeaders(w) });
    expect(fb.status).toBe(200);
    expect(fb.out).toMatchObject({ ok: true, storage: 'device', feedback: { target_id: 'cal_x', notes: 'tighter subject' } });
    expect(w.db.calls.filter((c) => c.method !== 'GET' && /smart_/.test(c.url))).toEqual([]);
    expect(w.llm.calls).toEqual([]);
  });

  test('an anonymous browser still cannot approve: no model call, no build', async () => {
    const r = await w.request('/api/calendar', { json: { id: 'cal_x', entry: { id: 'cal_x', date: '2026-10-05', market: 'US' } }, query: { action: 'smart-brain-approve' }, state: 'anonymous' });
    // The attribution rule answers it (a 200 envelope that names the missing
    // workspace, or a refusal): never a build, never a model call.
    expect([200, 401, 409]).toContain(r.status);
    if (r.status === 200) expect(r.out.error).toBe('workspace_unresolved');
    expect(r.out.campaign).toBeUndefined();
    expect(r.out.storage).toBeUndefined();
    expect(w.llm.calls).toEqual([]);
  });
});
