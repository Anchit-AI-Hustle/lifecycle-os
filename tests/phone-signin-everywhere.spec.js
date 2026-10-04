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
// op=extract RENDERS the site in a browser first (2026-10-04, brand-render.js).
// This spec is about the gate and the parser path, so the browser read is
// switched off with the operator's own switch; the rendered path has its own
// specs (rendered-brand-read*.spec.js), which switch it back on.
process.env.BRAND_RENDER = 'off';
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

async function open(page, w, file, opts) {
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
    let headers = {};
    try { headers = await r.request().allHeaders(); } catch (_) {}
    log.api.push({ url: u.replace(HOST, ''), status: r.status(), body, headers });
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
    if (opts && opts.delayAuthMs && u.pathname === '/auth.js') await new Promise((r) => setTimeout(r, opts.delayAuthMs));
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
    // The console builds the calendar on first open (autoGenerateOnLoad runs
    // Daily Sync once per session when nothing is stored); press it only if
    // that has not happened, so the two never race.
    await page.waitForTimeout(1500);
    if (!log.api.some((r) => /smart-brain-sync-daily/.test(r.url))) await page.click('#sync');
    await expect.poll(() => page.evaluate(() => PLAN.length), { timeout: 120_000 }).toBeGreaterThan(1);   // eslint-disable-line no-undef
    const sync = log.api.filter((r) => /smart-brain-sync-daily/.test(r.url));
    expect(sync.length).toBeGreaterThanOrEqual(1);
    expect(sync.filter((r) => r.status !== 200)).toEqual([]);
    expect(sync[0].body.plan.length, 'Daily Sync planned nothing for the carried brand').toBeGreaterThan(1);

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

/* ═══ The concierge (agent.html): its agents kept on this device ═══════════ */
test.describe('the concierge agent, phone sign-in kept on this device, no DATABASE_URL', () => {
  let w;
  test.beforeAll(async () => { w = await A.world({ serverMode: false }); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  test('the built-in agent answers as the brand, a created agent is kept on this device and answers too', async ({ page }) => {
    test.setTimeout(120_000);
    const log = await open(page, w, 'agent.html');
    await page.waitForSelector('#send');
    // The built-in Brand Agent: it used to be 404 "agent not found".
    await page.fill('#q', 'What should I start with?');
    await page.click('#send');
    await expect.poll(() => log.api.filter((r) => /action=agent-chat/.test(r.url)).map((r) => r.status), { timeout: 20_000 }).toEqual([200]);
    await expect(page.locator('#chat .msg.agent:not(.status)').last()).toHaveText(/Scripted reply for this turn/, { timeout: 10_000 });
    const first = log.api.filter((r) => /action=agent-chat/.test(r.url))[0].body;
    expect(first.storage).toBe('device');

    // Create an agent: built by the server, kept here.
    await page.click('#agentAdminToggle');
    await page.fill('#afName', 'Front Page Editor');
    await page.click('#afSave');
    await expect.poll(() => log.api.filter((r) => /action=agent-upsert/.test(r.url)).map((r) => r.status), { timeout: 10_000 }).toEqual([200]);
    const kept = await page.evaluate((uid) => {
      const k = Object.keys(localStorage).find((x) => x.indexOf('lifecycle.agents.device.' + uid + '.') === 0);
      return k ? JSON.parse(localStorage.getItem(k)) : null;
    }, w.tokens.phoneUserId);
    expect(kept && kept.map((a) => a.name)).toEqual(['Front Page Editor']);
    // No server-side agent knowledge sync for a device agent.
    expect(log.api.filter((r) => /action=agent-sync/.test(r.url))).toEqual([]);

    // It is now the selected agent and a turn carries its definition.
    await page.fill('#q', 'Which section is best this week?');
    await page.click('#send');
    await expect.poll(() => log.api.filter((r) => /action=agent-chat/.test(r.url)).length, { timeout: 20_000 }).toBe(2);
    const second = log.api.filter((r) => /action=agent-chat/.test(r.url))[1];
    expect(second.status).toBe(200);
    expect(second.body.agent.name).toBe('Front Page Editor');

    // A reload lists it again, from this device.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => document.body.innerText.includes('Front Page Editor')), { timeout: 15_000 }).toBe(true);

    expect(w.llm.calls.map((c) => c.stage)).toEqual(['agent-chat', 'agent-chat']);
    expect(w.db.calls.filter((c) => /smart_agent/.test(c.url) && c.method !== 'GET')).toEqual([]);
    const shown = await page.evaluate(() => document.body.innerText);
    expect(shown).not.toMatch(/agent_not_found|does not exist in this brand's workspace|KNICKGASM/);
    expect(log.errors).toEqual([]);
    expect(log.dialogs).toEqual([]);
    expect(w.escaped()).toEqual([]);
  });
});

/* ═══ Bugbot #2 (2026-10-03): a phone sign-in lists ONLY its own agents ═══ */
test.describe('the concierge lists only this device\'s agents for a phone sign-in', () => {
  let w;
  test.beforeAll(async () => { w = await A.world({ serverMode: false }); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  test('the server answers an empty, device-scoped list, whatever the agent table holds', async () => {
    w.db.insert('smart_agents', { id: 'agent_tenant_zero', name: 'Tenant Zero Concierge', level: 'brand', active: true, workspace_id: 'ws-oldest' });
    const r = await w.request('/api/brain', { query: { action: 'agents' }, state: 'device', headers: { 'x-lifecycle-token': w.tokens.phone, authorization: 'Bearer ' + w.tokens.phone } });
    expect(r.status).toBe(200);
    expect(r.out).toEqual({ ok: true, agents: [], storage: 'device' });
  });

  test('the page never mixes server agents into a phone sign-in\'s list', async ({ page }) => {
    const log = await open(page, w, 'agent.html');
    // Even if a server ever answered with another brand's agent, the page does
    // not list it (registered after open()'s routes, so it is the one that answers).
    await page.route(/\/api\/brain\?action=agents(&|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, agents: [{ id: 'agent_tenant_zero', name: 'Tenant Zero Concierge', level: 'brand', greeting: 'Hi from tenant zero', voice: {} }] }) }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#send');
    await page.waitForTimeout(800);
    const shown = await page.evaluate(() => document.body.innerText);
    expect(shown).not.toContain('Tenant Zero Concierge');
    expect(shown).not.toContain('Hi from tenant zero');
    expect(log.errors).toEqual([]);
  });
});

/* ═══ Pages the real-router sweep found refusing a phone sign-in ════════════ */
test.describe('the rest of the app, phone sign-in kept on this device, no DATABASE_URL', () => {
  let w;
  test.beforeAll(async () => { w = await A.world({ serverMode: false }); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  const failures = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.vh-failure')).filter((n) => n.offsetParent).map((n) => n.textContent.replace(/\s+/g, ' ').trim()));

  test('credits: usage and the ledger load (the op name was URL-encoded into "usage&days=30")', async ({ page }) => {
    const log = await open(page, w, 'credits.html');
    await page.click('[data-days="30"]');
    await expect.poll(() => log.api.filter((r) => /action=credits&op=usage/.test(r.url)).map((r) => r.status).slice(-1)[0], { timeout: 15_000 }).toBe(200);
    expect(log.api.filter((r) => /op=usage%26|op=ledger%26/.test(r.url)), 'an op name still carries its own query, encoded').toEqual([]);
    expect(log.api.filter((r) => /action=credits&op=ledger/.test(r.url)).map((r) => r.status)).toContain(200);
    expect(await failures(page)).toEqual([]);
    expect(log.errors).toEqual([]);
  });

  test('data analysis: every tab answers this person with its honest empty state, never a refusal', async ({ page }) => {
    const log = await open(page, w, 'data-analysis.html');
    for (const tab of ['Paid Media', 'Owned Channels', 'Landing & Experiments', 'Actions & Outcomes', 'Alert Settings']) {
      await page.getByRole('button', { name: tab, exact: true }).first().click();
      await page.waitForTimeout(400);
    }
    await expect.poll(() => log.api.filter((r) => /action=data-analysis/.test(r.url)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
    const da = log.api.filter((r) => /action=data-analysis/.test(r.url));
    expect(da.filter((r) => r.status !== 200).map((r) => r.status + ' ' + r.url)).toEqual([]);
    const ads = da.find((r) => /view=ads/.test(r.url));
    expect(ads && ads.body.note).toMatch(/kept on this device/);
    expect(JSON.stringify(da.map((r) => r.body))).not.toMatch(/Oldest Brand|invalid_operator_session/);
    expect(await failures(page)).toEqual([]);
  });

  test('publishing: the dispatch log is empty for this brand, not "could not be loaded"', async ({ page }) => {
    const log = await open(page, w, 'publishing.html');
    await page.click('[data-panel="jobs"]');
    await expect.poll(() => log.api.filter((r) => /action=dispatch-list/.test(r.url)).map((r) => r.status)[0], { timeout: 15_000 }).toBe(200);
    expect(log.api.find((r) => /action=dispatch-list/.test(r.url)).body).toMatchObject({ ok: true, jobs: [], storage: 'device' });
    expect(await failures(page)).toEqual([]);
  });

  test('ad campaigns: its first request reads the plan from the right router, signed in', async ({ page }) => {
    const log = await open(page, w, 'ad-campaigns.html');
    await expect.poll(() => log.api.filter((r) => /smart-brain-plan/.test(r.url)).length, { timeout: 20_000 }).toBeGreaterThan(0);
    const plan = log.api.find((r) => /smart-brain-plan/.test(r.url));
    expect(plan.url).toMatch(/^\/api\/calendar\?/);
    expect(plan.status).toBe(200);
    // Sent before auth.js wraps fetch (it loads deferred): the token travels anyway.
    expect(plan.headers['x-lifecycle-token'], 'the page\'s first request left without the sign-in').toBe(w.tokens.phone);
    expect(plan.body.error).toBeUndefined();
    expect(await failures(page)).toEqual([]);
  });
});

/* ═══ Bugbot #1 (2026-10-03): a phone sign-in sees none of the operator's identity or wiring ═══ */
test.describe('data analysis for a phone sign-in carries nothing of the operator', () => {
  let w;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const NO_BRAND_JWT = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: 'user-no-brand', email: 'nobrand@example.test' }) + '.sig';
  const SET = {
    ALERT_EMAIL: 'alerts@operator-mark.example', SENDER_EMAIL: 'sender@operator-mark.example',
    GMAIL_CLIENT_ID: 'gmail-id', GMAIL_CLIENT_SECRET: 'gmail-secret', GMAIL_REFRESH_TOKEN: 'gmail-refresh',
    GOOGLE_CHAT_WEBHOOK_URL: 'https://chat.operator-mark.example/hook',
    TWILIO_ACCOUNT_SID: 'ACoperator', TWILIO_AUTH_TOKEN: 'twilio-token', TWILIO_FROM_NUMBER: '+15550000000',
    PAGEDECK_API_KEY: 'pagedeck-key', META_ACCESS_TOKEN: 'meta-token', META_AD_ACCOUNT_ID: 'act_operator',
  };
  let saved;
  test.beforeAll(async () => {
    saved = Object.fromEntries(Object.keys(SET).map((k) => [k, process.env[k]]));
    w = await A.world({ serverMode: false });
    Object.assign(process.env, SET);
    // The operator's own rows: alert recipients, the latest hourly run, deployment telemetry.
    w.db.insert('analytics_alert_settings', { id: 'ws-oldest', workspace_id: 'ws-oldest', recipients: { email: ['owner@operator-mark.example'], sms: ['+15551112222'] }, sender_email: 'alerts@operator-mark.example', updated_at: '2026-10-02T00:00:00Z' });
    w.db.insert('analytics_hourly_runs', { id: 'run-operator-mark', workspace_id: 'ws-oldest', started_at: '2026-10-03T00:00:00Z', status: 'complete', anomalies: [{ id: 'operator-mark' }] });
    for (const t of ['activity_logs', 'agent_runs', 'connector_runs', 'connector_sync_runs', 'analytics_action_outcomes']) w.db.insert(t, { workspace_id: 'ws-oldest', status: 'failed', note: 'operator-mark ' + t, started_at: '2026-10-03T00:00:00Z' });
    // An account that signed in and has no brand workspace yet (Codex #5).
    // JWT-shaped, so workspace-scope reads its `sub` as a real user would be read.
    w.db.addUser(NO_BRAND_JWT, 'user-no-brand', 'nobrand@example.test').syncIdentityTables();
  });
  test.afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await w.close();
  });
  test.beforeEach(() => { w.reset(); });
  const H = (w) => ({ 'x-lifecycle-token': w.tokens.phone, authorization: 'Bearer ' + w.tokens.phone });

  test('saving alert settings echoes only what this person sent, never the operator sender', async () => {
    const r = await w.request('/api/public-config', { query: { action: 'data-analysis' }, json: { op: 'save-alert-settings', settings: { recipients: { email: ['me@mine.example'] }, cadence_hours: 4 } }, state: 'device', headers: H(w) });
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    expect(r.out).toMatchObject({ ok: true, storage: 'device', settings: { sender_email: '', cadence_hours: 4, recipients: { email: ['me@mine.example'], sms: [] } } });
    expect(r.text).not.toMatch(/operator-mark/);
  });

  for (const view of ['status', 'alerts', 'actions']) {
    test(`view=${view}: an account with NO brand workspace gets the same built answer, not the deployment's`, async () => {
      const r = await w.request('/api/public-config', { query: { action: 'data-analysis', view }, state: 'anonymous', headers: { authorization: 'Bearer ' + NO_BRAND_JWT } });
      expect(r.status, r.text.slice(0, 300)).toBe(200);
      expect(r.out.ok).toBe(true);
      expect(r.text, 'operator identity or telemetry reached an account with no brand').not.toMatch(/operator-mark|\+1555|act_operator/i);
      expect(r.text).not.toMatch(/"connected":\s*true/);
    });
  }

  for (const view of ['status', 'alerts', 'ads', 'mailer', 'landing', 'actions']) {
    test(`view=${view}: an answer for this person, with no operator sender, recipient, connector flag, run or telemetry`, async () => {
      const r = await w.request('/api/public-config', { query: { action: 'data-analysis', view }, state: 'device', headers: H(w) });
      expect(r.status, r.text.slice(0, 300)).toBe(200);
      expect(r.out.ok).toBe(true);
      expect(r.text, 'an operator identity or row reached a phone sign-in').not.toMatch(/operator-mark|\+1555|act_operator/i);
      expect(r.text, 'a deployment connector was reported connected to a phone sign-in').not.toMatch(/"connected":\s*true/);
      expect(r.text).not.toMatch(/Oldest Brand|ws-oldest/);
      if (view === 'status' || view === 'alerts') {
        const st = view === 'alerts' ? r.out.status : r.out;
        expect(st.last_run).toBeNull();
        const s = view === 'alerts' ? r.out.settings : r.out.settings;
        expect(s.sender_email).toBe('');
        expect(s.recipients).toEqual({ email: [], sms: [] });
      }
    });
  }
});

/* ═══ Codex #9 (2026-10-03): an unlisted number never spends provider quota ═══
   A SERVER-mode phone account whose number the operator has not listed
   (CREDITS_COMP_PHONES) has no wallet. Every device path this branch opened
   must either refuse its model step or run without it - and say which. */
test.describe('a server-mode phone account that is NOT listed reaches no model through any device path', () => {
  let w, restoreDns;
  const SITE = 'https://voice-site.example';
  const PAGE = '<!doctype html><html><head><title>Voice Site</title><meta name="description" content="Lamps made by hand on the quay."></head><body>'
    + '<h1>Voice Site</h1><p>We make every lamp by hand on the quay, slowly, and we wrap each one in paper we recycle ourselves.</p>'
    + '<p>Our workshop opens at dawn and the first kettle goes on before the first lamp is lit, because nothing good is rushed.</p>'
    + '<p>Each piece is signed underneath by the person who finished it, so you always know whose hands it came from.</p></body></html>';
  test.beforeAll(async () => {
    w = await A.world();          // DATABASE_URL set, no number listed: the 'phone' state is unlisted
    w.db.route((u) => u.startsWith(SITE), (u) => {
      const p = new URL(u).pathname;
      if (p === '/robots.txt') return require('./lib/fake-supabase.js').response(200, 'User-agent: *\nAllow: /\n', { 'content-type': 'text/plain' });
      if (p === '/' || p === '') return require('./lib/fake-supabase.js').response(200, PAGE, { 'content-type': 'text/html' });
      return require('./lib/fake-supabase.js').response(404, '', { 'content-type': 'text/plain' });
    });
    const dns = require('dns').promises;
    const real = dns.lookup;
    dns.lookup = async (h, o) => (String(h).endsWith('.example') ? [{ address: '93.184.216.34', family: 4 }] : real(h, o));
    restoreDns = () => { dns.lookup = real; };
  });
  test.afterAll(async () => { restoreDns(); await w.close(); });
  test.beforeEach(() => { w.reset(); });
  const brand = () => Object.assign({}, A.deviceBrand(), { website: SITE, name: 'Voice Site', industry: 'hand-made lamps' });
  const brandOp = (op, json) => w.request('/api/public-config', { query: { action: 'brand', op }, json, state: 'phone' });

  test('Read my site runs, with the voice step skipped and said so', async () => {
    const r = await brandOp('extract', { url: SITE + '/' });
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    expect(r.out.ok).toBe(true);
    expect(r.out.voice_skipped).toBe(true);
    expect(String(r.out.voice_note || '')).toMatch(/wallet|listed/i);
    expect(w.llm.calls, 'an unlisted number reached a model').toEqual([]);
  });

  test('Suggest options is refused with a sentence before any model call', async () => {
    const r = await brandOp('suggest', { field: 'voice.tone', brand: brand() });
    expect([402, 403]).toContain(r.status);
    expect(r.out.ok).toBe(false);
    expect(String(r.out.message || '')).toMatch(/wallet|listed/i);
    expect(w.llm.calls).toEqual([]);
  });

  test('the device context pack builds to the end with the voice step skipped', async () => {
    let row = null, out = null;
    for (let i = 0; i < 8; i++) {
      out = await brandOp('context-build', { workspace_id: 'local-voice0000000001', refresh: i === 0, brand: brand(), device_pack: row });
      expect(out.status, out.text.slice(0, 300)).toBe(200);
      row = out.out.device_pack;
      if (out.out.done) break;
    }
    expect(out.out.done).toBe(true);
    expect(row.design_md).toBeTruthy();
    expect(out.out.voice_skipped).toBe(true);
    expect(w.llm.calls, 'the pack\'s extract stage reached a model for an unlisted number').toEqual([]);
  });

  test('the concierge, TeleSuite and Smart Brain approve refuse before any model call', async () => {
    const chat = await w.request('/api/brain', { query: { action: 'agent-chat' }, json: { message: 'hi', agent_id: 'agent_brand', brand: brand() }, state: 'phone' });
    expect([402, 403]).toContain(chat.status);
    const ts = await w.request('/api/brain', { query: { action: 'telesuite', op: 'pitch' }, json: { op: 'pitch', brand: brand(), device: { items: [] }, input: { product: 'Lamp' } }, state: 'phone' });
    expect([402, 403]).toContain(ts.status);
    const ap = await w.request('/api/calendar', { query: { action: 'smart-brain-approve' }, json: { id: 'cal_x', entry: { id: 'cal_x', date: '2026-10-05', market: 'US' }, brand: brand() }, state: 'phone' });
    expect([402, 403]).toContain(ap.status);
    expect(w.llm.calls).toEqual([]);
  });
});

/* ═══ Review round 2 (Bugbot #3/#4, Codex #6/#7/#11), executed ═══════════════ */
test.describe('review round 2: device state read, kept and said correctly', () => {
  let w;
  test.beforeAll(async () => { w = await A.world({ serverMode: false }); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });
  const planKey = (w, kind) => 'lifecycle.smartbrain.' + kind + '.' + w.tokens.phoneUserId + '.' + A.deviceBrand().id;

  test('ads calendar: the FIRST read after a phone sign-in shows the plan kept on the device (Bugbot #3)', async ({ page }) => {
    const entries = [{ id: 'cal_kept_1', date: '2026-10-05', market: 'US', cohort: 'nurture', status: 'tentative', subject: 'Kept slot one' },
      { id: 'cal_kept_2', date: '2026-10-06', market: 'US', cohort: 'engaged', status: 'tentative', subject: 'Kept slot two' }];
    await page.addInitScript(({ k, entries }) => { try { localStorage.setItem(k, JSON.stringify({ at: '2026-10-03T00:00:00Z', entries })); } catch (_) {} }, { k: planKey(w, 'plan'), entries });
    // auth.js arrives LATE (a slow phone network): the page's first plan read
    // answers before auth.js has seated the session.
    const log = await open(page, w, 'ad-campaigns.html', { delayAuthMs: 4000 });
    await expect(page.locator('#ad-plan')).toContainText('2026-10-05', { timeout: 15_000 });
    await expect(page.locator('#ad-plan')).toContainText('2026-10-06');
    expect(log.errors).toEqual([]);
  });

  test('Daily Sync that plans nothing clears the kept plan, so a reload does not resurrect it (Codex #7)', async ({ page }) => {
    await page.addInitScript(({ k }) => { try { if (!sessionStorage.getItem('__kept')) { sessionStorage.setItem('__kept', '1'); localStorage.setItem(k, JSON.stringify({ at: '2026-10-01T00:00:00Z', entries: [{ id: 'cal_stale', date: '2026-10-05', market: 'IN', status: 'tentative' }] })); } } catch (_) {} }, { k: planKey(w, 'plan') });
    const log = await open(page, w, 'smart-brain.html');
    await page.route(/\/api\/calendar\?action=smart-brain-sync-daily/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'db-linked', plan: [], entries: [], changes: [], insights: [] }) }));
    await page.waitForSelector('#sync');
    await page.click('#sync');
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), planKey(w, 'plan')), { timeout: 15_000 }).toBeNull();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => PLAN.map((e) => e.id))).not.toContain('cal_stale');   // eslint-disable-line no-undef
    expect(log.errors).toEqual([]);
  });

  test('a device approval renders no hosted /lp/ link, before or after a reload (Codex #6)', async ({ page }) => {
    const log = await open(page, w, 'smart-brain.html');
    await expect.poll(() => page.evaluate(() => PLAN.length), { timeout: 120_000 }).toBeGreaterThan(1);   // eslint-disable-line no-undef
    await page.evaluate(() => approveRow(0));   // eslint-disable-line no-undef
    await expect.poll(() => page.evaluate(() => PLAN[0].status), { timeout: 120_000 }).toBe('final');   // eslint-disable-line no-undef
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => (PLAN[0] || {}).status), { timeout: 60_000 }).toBe('final');   // eslint-disable-line no-undef
    await page.evaluate(() => viewEntry(0));   // eslint-disable-line no-undef
    await expect.poll(() => page.evaluate(() => !!document.querySelector('#expbody-0 iframe, #expbody-0 .pvframe')), { timeout: 120_000 }).toBe(true);
    // The rail's own /lp/best etc. are site pages, not a campaign's hosted page.
    const lp = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="/lp/"]')).filter((a) => !a.closest('#lifecycle-nav')).map((a) => a.getAttribute('href')));
    expect(lp, 'a hosted link was offered for a decision nothing published').toEqual([]);
    expect(log.errors).toEqual([]);
  });

  test('Send test on data analysis says why nothing was sent, as an ordinary state (Bugbot #4)', async ({ page }) => {
    const log = await open(page, w, 'data-analysis.html');
    await page.getByRole('button', { name: 'Alert Settings', exact: true }).first().click();
    await page.waitForSelector('#xAlertTest');
    await expect.poll(() => page.evaluate(() => !!document.getElementById('xAlertStatus')), { timeout: 15_000 }).toBe(true);
    await page.click('#xAlertTest');
    await expect(page.locator('#xAlertStatus')).toContainText(/operator/i, { timeout: 10_000 });
    expect(await page.locator('#xAlertStatus').getAttribute('class')).not.toMatch(/\bbad\b/);
    expect(log.errors).toEqual([]);
  });

  test('TeleSuite: a full browser still shows the result and says the history was not saved (Codex #11)', async ({ page }) => {
    const key = 'lifecycle.telesuite.device.' + w.tokens.phoneUserId + '.' + A.deviceBrand().id;
    await page.addInitScript((k) => {
      try {
        localStorage.setItem(k, JSON.stringify({ runs: [], items: [{ id: 'dev-item-1', kind: 'product', name: 'Harbour Lamp', category: 'Lamp', content: 'Table lamp.', attributes: {}, source: 'typed', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }] }));
        const real = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) { if (name === k) throw new DOMException('quota', 'QuotaExceededError'); return real.call(this, name, value); };
      } catch (_) {}
    }, key);
    const log = await open(page, w, 'telesuite.html#pitch-generator');
    await page.waitForSelector('#run', { timeout: 20_000 });
    await page.selectOption('#form select[data-f="product"]', 'Harbour Lamp');
    await page.click('#run');
    await expect(page.locator('#out')).toContainText(/scripted/i, { timeout: 20_000 });
    await expect(page.locator('#toast')).toContainText(/refused to save it to your TeleSuite history/i, { timeout: 5_000 });
    expect(await page.locator('#out .vh-failure').count()).toBe(0);
    expect(log.errors).toEqual([]);
  });
});
