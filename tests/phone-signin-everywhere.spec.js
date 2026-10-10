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
 * ── 2026-10-10: RETIRED IN PART - GOOGLE IS THE ONLY SIGN-IN ───────────────
 * The owner's words: "No signin with mobile number - only Google signin pls".
 * Everything this file showed WORKING for a phone sign-in kept on the device
 * (the Smart Brain review flow, calendar.js decisions kept on the device, the
 * concierge's device agents, credits / data analysis / publishing / ad
 * campaigns for a phone sign-in, and the review-round-2 device-state fixes)
 * is RETIRED with that sign-in: no phone principal exists to drive it, and a
 * phone token is refused like no token (tests/google-only-signin.spec.js).
 * What stays is the other side of each door, executed: a LIVE server-mode
 * phone session reaches no model and no store through any path this file
 * opened, and an anonymous browser cannot approve.
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

/* The router itself, for the requests the page sends. */
/* ═══ The concierge (agent.html): its agents kept on this device ═══════════ */
/* ═══ Bugbot #2 (2026-10-03): a phone sign-in lists ONLY its own agents ═══ */
/* ═══ Pages the real-router sweep found refusing a phone sign-in ════════════ */
/* ═══ Bugbot #1 (2026-10-03): a phone sign-in sees none of the operator's identity or wiring ═══ */
/* ═══ Codex #9 (2026-10-03): an unlisted number never spends provider quota ═══
   A SERVER-mode phone account whose number the operator has not listed
   (CREDITS_COMP_PHONES) has no wallet. Every device path this branch opened
   must either refuse its model step or run without it - and say which. */
test.describe('a LIVE server-mode phone session is no credential: it reaches no model and no store through any path', () => {
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

  test('Read my site, Suggest options and the context pack: refused like no token, before any model or store', async () => {
    for (const [op, json] of [['extract', { url: SITE + '/' }], ['suggest', { field: 'voice.tone', brand: brand() }], ['context-build', { workspace_id: 'local-voice0000000001', refresh: true, brand: brand() }]]) {
      w.reset();
      const r = await brandOp(op, json);
      expect(r.status, `${op}: ${r.text.slice(0, 300)}`).toBe(401);
      expect(r.out.ok).toBe(false);
      expect(String(r.out.message || ''), op).toMatch(/Google/);
      expect(w.llm.calls, op + ' reached a model').toEqual([]);
      expect(w.db.calls.filter((c) => c.method !== 'GET'), op + ' wrote to the store').toEqual([]);
    }
  });

  test('the concierge, TeleSuite and Smart Brain approve refuse before any model call', async () => {
    const chat = await w.request('/api/brain', { query: { action: 'agent-chat' }, json: { message: 'hi', agent_id: 'agent_brand', brand: brand() }, state: 'phone' });
    expect(chat.status).toBe(401);
    const ts = await w.request('/api/brain', { query: { action: 'telesuite', op: 'pitch' }, json: { op: 'pitch', brand: brand(), device: { items: [] }, input: { product: 'Lamp' } }, state: 'phone' });
    expect(ts.status).toBe(401);
    const ap = await w.request('/api/calendar', { query: { action: 'smart-brain-approve' }, json: { id: 'cal_x', entry: { id: 'cal_x', date: '2026-10-05', market: 'US' }, brand: brand() }, state: 'phone' });
    expect(ap.status).toBe(401);
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

/* ═══ Review round 2 (Bugbot #3/#4, Codex #6/#7/#11), executed ═══════════════ */