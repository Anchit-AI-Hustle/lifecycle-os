/**
 * Every brand-specific DEFAULT comes from the active brand (2026-10-05).
 * ---------------------------------------------------------------------------
 * The operator's report, production /brain, active brand "Deli Chic" (an
 * Indian momos brand; the rail said "Market: India (IN)"): pressing "Run
 * Agentic Flow" printed "Running agentic flow - Premium, US - 8 stages".
 * "also why us? indian brand - pls be correct with all brand specific
 * respective information". The page had no plan rows, so no region chips, and
 * agenticMarket() fell to a literal 'US' (it also knew only four typed
 * markets). The same screenshot: the MODE card read "DB (empty)" on a
 * deployment with no database at all, and the empty calendar printed the
 * PADDED marker "[DATA REQUIRED BEFORE LAUNCH: catalogue and analytics, this
 * workspace, all]".
 *
 * EXECUTED, not read:
 *   (a) the real smart-brain.html in Chromium for three DEVICE brands (an
 *       Indian brand with home IN, a UK brand whose record LEADS with US, and
 *       a bare brand with no regions), every /api/ call forwarded to the
 *       SHIPPED routers (tests/agents-harness.js: production's configuration,
 *       no DATABASE_URL, the session and the brand on the device);
 *   (b) the routers over a socket with a carried device brand, asserting the
 *       arguments the core RECEIVED;
 *   (c) the browser's locale table (region-context.js) against the server's
 *       (api/_shared/brand-locale.js), over every country code.
 *
 * Run: npx playwright test tests/brand-locale-defaults.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
process.env.BRAND_RENDER = 'off';
const fs = require('fs');
const path = require('path');
const A = require('./agents-harness');
const { response } = require('./lib/fake-supabase.js');

const ROOT = A.ROOT;
const HOST = 'http://app.agents.test';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const PADDED = /DATA REQUIRED BEFORE LAUNCH:[^\]]*,\s*all\s*(?:,|\])/;

/* ── three device brands ─────────────────────────────────────────────────── */
const PALETTE = { primary: '#B4232A', accent: '#1F6F5C', ink: '#1A1A1A', surface: '#FFFFFF', surface_alt: '#F6F6F6', muted: '#595959' };
const TYPE = { heading: { family: 'Inter', stack: "'Inter',Arial,sans-serif" }, body: { family: 'Inter', stack: "'Inter',Arial,sans-serif" } };
function deviceBrand(over) {
  return Object.assign({
    palette: PALETTE, typography: TYPE, voice: { tone: 'warm and direct', banned: [], preferred: [] },
    claims: [], competitors: [], catalog_source: {}, brand_data: {}, asset_hosts: [],
    status: 'active', onboarding_step: 6, owner_id: null, storage: 'device', logo_url: null, favicon_url: null,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  }, over);
}
const DELI = deviceBrand({
  id: 'local-delichic00000001', slug: 'deli-chic', name: 'Deli Chic', tagline: 'Momos, steamed fresh', industry: 'Food and beverage (momos)',
  website: 'https://delichic.example',
  regions: [{ code: 'IN', currency: 'INR', symbol: '₹', store_url: 'https://delichic.example', home: true }],
  offerings: [
    { kind: 'product', name: 'Steamed Veg Momos', url: 'https://delichic.example/products/veg-momos' },
    { kind: 'product', name: 'Tandoori Paneer Momos', url: 'https://delichic.example/products/paneer-momos' },
  ],
  brand_data: { legal_entity: 'Deli Chic Foods Private Limited, Andheri East, Mumbai 400069, India', social: [{ platform: 'instagram', url: 'https://www.instagram.com/delichic.example/' }] },
});
// A UK brand whose record LEADS with US: a "first row" default picks US, the
// home flag picks UK.
const BRIT = deviceBrand({
  id: 'local-britco000000001', slug: 'brit-co', name: 'Brit Co', tagline: 'Tea, properly', industry: 'Tea',
  website: 'https://britco.example',
  regions: [
    { code: 'US', currency: 'USD', symbol: '$', store_url: 'https://britco.example/us' },
    { code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://britco.example', home: true },
  ],
  offerings: [{ kind: 'product', name: 'Breakfast Blend', url: 'https://britco.example/products/breakfast-blend' }],
});
const BARE = deviceBrand({
  id: 'local-barebrand0000001', slug: 'bare-brand', name: 'Bare Brand', tagline: '', industry: '', website: '',
  regions: [], offerings: [],
});

/* ── the page, against the shipped routers ──────────────────────────────── */
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

/**
 * Open `file` for `brand` kept on the device, with a device sign-in, every
 * /api/ call answered by the shipped routers except the ones `hold` claims
 * (a route the test answers itself, so it can read the request first).
 */
async function open(page, w, file, brand, hold) {
  const log = { dialogs: [], errors: [], api: [] };
  page.on('dialog', async (d) => { log.dialogs.push(d.type()); await d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  page.on('response', async (r) => {
    const u = r.url();
    if (!u.includes('/api/')) return;
    let out = null;
    try { out = await r.json(); } catch (_) {}
    log.api.push({ url: u.replace(HOST, ''), status: r.status(), out });
  });
  const user = { id: w.tokens.phoneUserId, phone: A.PHONE.e164, cc: A.PHONE.cc, local: A.PHONE.phone, name: A.PHONE.name };
  await page.addInitScript(seed, { user, session: w.session('device'), brand });
  await page.route(/^https?:\/\/(?!app\.agents\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (route.request().resourceType() === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
    return route.abort('failed');
  });
  const fwd = A.forward(w.port);
  await page.route(HOST + '/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api/')) {
      if (hold && hold.test(u)) return hold.answer(route);
      return fwd(route);
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto(HOST + '/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending', null, { timeout: 20000 });
  await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded === true, null, { timeout: 20000 });
  return log;
}

/** Hold the agentic run: record what the page sent, release it when the test says. */
function holdAgentic() {
  const h = { sent: [], release: null };
  let open;
  const gate = new Promise((r) => { open = r; });
  h.release = () => open();
  h.test = (u) => u.searchParams.get('action') === 'agentic-run';
  h.answer = async (route) => {
    let sent = null;
    try { sent = JSON.parse(route.request().postData() || 'null'); } catch (_) { sent = null; }
    h.sent.push(sent);
    await gate;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'device', tier: 'maxpower', market: sent && sent.market, stages: [{ stage: 'data', ok: true, summary: 'held by the test' }], ideation: { ideas: [] }, campaigns: [] }) });
  };
  return h;
}

test.describe('/brain for a phone sign-in kept on this device, no DATABASE_URL', () => {
  let w;
  test.beforeAll(async () => {
    w = await A.world({ serverMode: false });
    // The device brands' own sites: a generation may read a brand's own
    // origin (its testimonials), answered 404 so nothing is found or invented.
    for (const site of ['https://delichic.example', 'https://britco.example']) w.db.route((u) => u.startsWith(site), () => response(404, 'not found'));
  });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  const CASES = [
    { brand: DELI, market: 'IN', label: 'an Indian brand: its home market IN' },
    { brand: BRIT, market: 'UK', label: 'a UK brand whose record leads with US: its HOME market UK' },
  ];
  for (const c of CASES) {
    test(`Run Agentic Flow, ${c.label}`, async ({ page }) => {
      test.setTimeout(180_000);
      const hold = holdAgentic();
      const log = await open(page, w, 'smart-brain.html', c.brand, hold);
      expect(await page.evaluate(() => window.RegionContext.home)).toBe(c.market);
      await expect(page.locator('#runAgentic')).toBeEnabled();
      await expect(page.locator('#agenticWhy')).toBeHidden();
      await page.click('#runAgentic');
      await expect.poll(() => hold.sent.length, { timeout: 20_000 }).toBe(1);
      // What LEFT the page, and what the page says while it runs.
      expect(hold.sent[0].market).toBe(c.market);
      await expect(page.locator('#agenticOut')).toContainText(`Running agentic flow — Premium, ${c.market} — 8 stages`);
      expect(await page.locator('#agenticOut').innerText()).not.toMatch(/\bUS\b/);
      hold.release();
      await expect(page.locator('#agenticOut')).not.toContainText('please wait', { timeout: 15_000 });

      // The MODE card states the real mode: no database, the brand on this device.
      await expect(page.locator('#mode')).toHaveText('Local / Demo Mode (on this device)');
      await expect(page.locator('#mode')).not.toHaveText(/DB/);
      // The cron line is in the brand's own time zone where its record decides one.
      if (c.market === 'IN') await expect(page.locator('#cronAt')).toContainText('09:00');
      expect(log.errors).toEqual([]);
      expect(log.dialogs).toEqual([]);
    });
  }

  test('a brand with no market: the button is off with the unpadded marker, and nothing is sent', async ({ page }) => {
    test.setTimeout(180_000);
    const hold = holdAgentic();
    const log = await open(page, w, 'smart-brain.html', BARE, hold);
    expect(await page.evaluate(() => window.RegionContext.home)).toBe('');
    const btn = page.locator('#runAgentic');
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute('aria-disabled', 'true');
    const why = page.locator('#agenticWhy');
    await expect(why).toBeVisible();
    await expect(why).toContainText('[DATA REQUIRED BEFORE LAUNCH: home market, Bare Brand]');
    expect(await why.innerText()).not.toMatch(PADDED);
    // Forced on and pressed: the handler itself refuses, in the accent rule.
    await page.evaluate(() => { const b = document.getElementById('runAgentic'); b.disabled = false; b.click(); });
    await expect(page.locator('#agenticOut .vh-status')).toContainText('[DATA REQUIRED BEFORE LAUNCH: home market, Bare Brand]');
    await page.waitForTimeout(500);
    expect(hold.sent).toEqual([]);
    expect(log.api.filter((r) => /action=agentic-run/.test(r.url))).toEqual([]);
    expect(await page.locator('#agenticOut').innerText()).not.toMatch(/\bUS\b|Running agentic flow/);
    await expect(page.locator('#agenticOut .vh-failure')).toHaveCount(0);

    // The rolling calendar's empty state: the brand's own name, never "this
    // workspace, all". Daily Sync runs on first open and carries the brand.
    await expect.poll(() => log.api.filter((r) => /smart-brain-sync-daily/.test(r.url)).length, { timeout: 60_000 }).toBeGreaterThan(0);
    await expect(page.locator('#plan .planempty')).toContainText('[DATA REQUIRED BEFORE LAUNCH: catalogue and analytics, Bare Brand]', { timeout: 30_000 });
    expect(await page.locator('#plan').innerText()).not.toMatch(PADDED);
    expect(await page.locator('#syncstate').innerText()).not.toMatch(PADDED);
    await expect(page.locator('#mode')).toHaveText('Local / Demo Mode (on this device)');
    expect(log.errors).toEqual([]);
  });
});

/* ── the routers, with a carried device brand ───────────────────────────── */
test.describe('the routers resolve the market from the carried brand', () => {
  let w;
  const deviceHeaders = () => ({ 'x-lifecycle-token': w.tokens.phone, authorization: 'Bearer ' + w.tokens.phone });
  const carry = (b) => { const o = Object.assign({}, b); delete o.id; return o; };
  /** Swap one exported function of a loaded module for a recorder; returns [calls, restore]. */
  function record(rel, fn, answer) {
    const mod = require(path.join(ROOT, rel));
    const real = mod[fn];
    const calls = [];
    mod[fn] = async (...args) => { calls.push(args); return typeof answer === 'function' ? answer(...args) : answer; };
    return [calls, () => { mod[fn] = real; }];
  }
  test.beforeAll(async () => { w = await A.world({ serverMode: false }); });
  test.afterAll(async () => { await w.close(); });
  test.beforeEach(() => { w.reset(); });

  test('agentic-run: no market asked runs the HOME market; none on the record and one not served are refused with the marker', async () => {
    const [calls, restore] = record('api/_shared/agentic-orchestrator.js', 'runAgentic', { ok: true, stages: [] });
    try {
      for (const [b, want] of [[DELI, 'IN'], [BRIT, 'UK']]) {
        const r = await w.request('/api/brain', { query: { action: 'agentic-run' }, json: { tier: 'budget', days: 2, withCreatives: false, brand: carry(b) }, state: 'device', headers: deviceHeaders() });
        expect(r.status, r.text.slice(0, 300)).toBe(200);
        expect(calls.pop()[0].market).toBe(want);
      }
      // "India" spelt as a page chip spells it reaches the core as the record's IN.
      const spelt = await w.request('/api/brain', { query: { action: 'agentic-run' }, json: { market: 'India', days: 2, withCreatives: false, brand: carry(DELI) }, state: 'device', headers: deviceHeaders() });
      expect(spelt.status).toBe(200);
      expect(calls.pop()[0].market).toBe('IN');

      const bare = await w.request('/api/brain', { query: { action: 'agentic-run' }, json: { days: 2, withCreatives: false, brand: carry(BARE) }, state: 'device', headers: deviceHeaders() });
      expect(bare.status).toBe(409);
      expect(bare.out.error).toBe('market_required');
      expect(bare.out.message).toContain('[DATA REQUIRED BEFORE LAUNCH: home market, Bare Brand]');
      expect(bare.out.message).not.toMatch(PADDED);

      const notServed = await w.request('/api/brain', { query: { action: 'agentic-run' }, json: { market: 'US', days: 2, withCreatives: false, brand: carry(DELI) }, state: 'device', headers: deviceHeaders() });
      expect(notServed.status).toBe(409);
      expect(notServed.out.error).toBe('market_not_served');
      expect(notServed.out.message).toMatch(/Deli Chic does not list US/);
      expect(calls).toEqual([]);   // the core was never reached for either refusal
    } finally { restore(); }
  });

  test('the orchestrator plans ONLY the market it was given, and has no default of its own', async () => {
    const agentic = require(path.join(ROOT, 'api/_shared/agentic-orchestrator.js'));
    const none = await agentic.runAgentic({ days: 3, withCreatives: false });
    expect(none.ok).toBe(false);
    expect(none.error).toBe('market_required');
    const out = await agentic.runAgentic({ market: 'IN', tier: 'budget', days: 5, withCreatives: false, assetBudgetMs: 1, maxRetries: 0 });
    expect(out.market).toBe('IN');
    const planned = (out.stages || []).find((s) => s.stage === 'calendar');
    expect(planned, JSON.stringify(out.stages)).toBeTruthy();
    // Every campaign the run built, and the plan it built them from, is IN.
    expect((out.campaigns || []).map((c) => c.market).filter((m) => m !== 'IN')).toEqual([]);
  });

  test('mailer-assets: no market asked fills the assets for the brand\'s home market, not UK', async () => {
    const [calls, restore] = record('api/_shared/asset-agent.js', 'fillMailerAssets', { ok: true, html: '<p>x</p>', assets: [] });
    try {
      const r = await w.request('/api/brain', { query: { action: 'mailer-assets' }, json: { html: '<!-- IMAGE: hero --><p>x</p>', brand: carry(DELI) }, state: 'device', headers: deviceHeaders() });
      expect(r.status, r.text.slice(0, 300)).toBe(200);
      expect(calls[0][1].market).toBe('IN');
    } finally { restore(); }
  });

  test('plan and Daily Sync say where the plan lives: on the device, with the brand\'s own unpadded marker', async () => {
    const plan = await w.request('/api/calendar', { query: { action: 'smart-brain-plan' }, state: 'device', headers: deviceHeaders() });
    expect(plan.status).toBe(200);
    expect(plan.out.mode).toBe('device');
    expect(plan.out.storage).toBe('device');
    const sync = await w.request('/api/calendar', { query: { action: 'smart-brain-sync-daily' }, json: { brand: carry(BARE) }, state: 'device', headers: deviceHeaders() });
    expect(sync.status, sync.text.slice(0, 300)).toBe(200);
    expect(sync.out.mode).toBe('device');
    // The empty answer has the keys a full one has (the page reads `plan`).
    expect(sync.out).toMatchObject({ ok: true, plan: [], entries: [], changes: [], insights: [] });
    expect(sync.out.note).toContain('[DATA REQUIRED BEFORE LAUNCH: catalogue and analytics, Bare Brand]');
    expect(sync.out.note).not.toMatch(PADDED);
    // The Indian brand's plan is IN, every slot.
    const deli = await w.request('/api/calendar', { query: { action: 'smart-brain-sync-daily' }, json: { brand: carry(DELI) }, state: 'device', headers: deviceHeaders() });
    expect(deli.status).toBe(200);
    expect((deli.out.plan || []).length).toBeGreaterThan(0);
    expect(Array.from(new Set(deli.out.plan.map((e) => e.market)))).toEqual(['IN']);
  });
});

/* ── the brand's own locale facts, server side ──────────────────────────── */
test('a carried brand keeps its legal line, social profiles and region locale; the brand block states the home locale', async () => {
  const rt = require(path.join(ROOT, 'api/_shared/brand-runtime.js'));
  const L = require(path.join(ROOT, 'api/_shared/brand-locale.js'));
  const carried = rt.carriedBrand({ brand: DELI }, { user_id: 'u1' });
  expect(carried.legal_entity).toBe('Deli Chic Foods Private Limited, Andheri East, Mumbai 400069, India');
  expect(carried.social).toEqual([{ platform: 'instagram', url: 'https://www.instagram.com/delichic.example/' }]);
  expect(carried.regions[0]).toMatchObject({ code: 'IN', currency: 'INR', symbol: '₹', home: true });
  const facts = rt.regionFacts(carried, '');
  expect(facts).toMatchObject({ code: 'IN', currency: '₹', currency_code: 'INR', locale: 'en-IN', time_zone: 'Asia/Kolkata' });
  // A region with no symbol on record still prints its own currency, never '$'.
  expect(rt.regionFacts({ name: 'X', regions: [{ code: 'IN', store_url: 'https://x.example', home: true }] }, 'IN').currency).toBe('₹');
  expect(rt.regionFacts({ name: 'X', regions: [{ code: 'UK', store_url: 'https://x.example', home: true }] }, 'UK').currency).toBe('£');
  expect(rt.regionFacts({ name: 'X', regions: [{ code: 'GLOBAL', store_url: 'https://x.example', home: true }] }, 'GLOBAL').currency).toBe('');
  const block = rt.brandBlock(carried);
  expect(block).toMatch(/LOCALE: home market IN · prices in INR \(₹\)/);
  expect(block).toContain('₹1,00,000');
  expect(block).toContain('Asia/Kolkata');
  expect(rt.brandBlock(BARE)).toContain('[DATA REQUIRED BEFORE LAUNCH: home market, Bare Brand]');
  expect(rt.brandBlock(BARE)).not.toMatch(PADDED);
  // Money, number grouping and the send hour come from the market, not a literal.
  expect(L.money(100000, DELI)).toBe('₹1,00,000');
  expect(L.money(1234, BRIT)).toBe('£1,234');
  expect(L.utcHourOf(9.5, 'Asia/Kolkata', '2026-10-05')).toBe(4);
  expect(L.utcHourOf(9, 'Europe/London', '2026-07-01')).toBe(8);
  expect(L.utcHourOf(9, 'Europe/London', '2026-12-01')).toBe(9);
  // A country with several zones is not given one: the record has to say.
  expect(L.localeFor({ name: 'Yank', regions: [{ code: 'US', store_url: 'https://y.example', home: true }] }).gaps).toContain('[DATA REQUIRED BEFORE LAUNCH: time zone, Yank, US]');
  expect(L.localeFor({ name: 'Yank', regions: [{ code: 'US', timezone: 'America/Chicago', store_url: 'https://y.example', home: true }] }).timeZone).toBe('America/Chicago');
});

/* ── the browser's table is the server's ────────────────────────────────── */
test('region-context.js and brand-locale.js agree on every country, and on a record that overrides the table', async ({ page }) => {
  const L = require(path.join(ROOT, 'api/_shared/brand-locale.js'));
  const codes = Object.keys(L.COUNTRY).map((c) => (c === 'GB' ? 'UK' : c)).concat(['GLOBAL', 'EU']);
  const parity = {
    name: 'Parity Co',
    regions: codes.map((c, i) => ({ code: c, store_url: 'https://parity.example/' + c.toLowerCase(), home: i === 0 })),
  };
  // A record that states its own values outranks the table, on both sides.
  const own = { name: 'Own Co', timezone: 'Asia/Dubai', regions: [{ code: 'IN', currency: 'USD', symbol: 'US$', locale: 'en-US', dial_code: '+1', store_url: 'https://own.example', home: true }] };
  let served = parity;
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/region-context.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'region-context.js')) });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body><script>window.BrandContext={brand:' + JSON.stringify(served) + ',onChange:function(f){f({brand:window.BrandContext.brand});},ready:function(){return Promise.resolve();}};</script><script src="/region-context.js"></script></body>' });
  });
  const shape = (x) => ({ market: x.market, currency: x.currency, symbol: x.symbol, locale: x.locale, timeZone: x.timeZone, dial: x.dial });
  await page.goto('http://parity.test/');
  await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded === true);
  // The tables themselves.
  expect(await page.evaluate(() => window.RegionContext._COUNTRY)).toEqual(L.COUNTRY);
  expect(await page.evaluate(() => window.RegionContext._SYMBOL)).toEqual(L.SYMBOL);
  // Every country's currency has a symbol in the table.
  expect(Object.values(L.COUNTRY).map((r) => r[0]).filter((c) => !L.SYMBOL[c])).toEqual([]);
  let compared = 0;
  for (const c of codes) {
    const browser = await page.evaluate((code) => window.RegionContext.localeOf(code), c);
    expect(shape(browser), c).toEqual(shape(L.localeFor(parity, c)));
    // The printed price, where both ICU builds carry the market's locale
    // (Chromium ships fewer en-XX locales than Node: en-NO falls back to en
    // there). The builds' CLDR versions also group a few markets differently
    // (CH ' vs ’, ZA space vs comma), so separators are dropped and the
    // symbol, its side and the digits are compared; the grouping that matters
    // most here is asserted on its own below (en-IN lakhs).
    const loc = L.localeFor(parity, c).locale;
    const both = !loc || (new Intl.NumberFormat(loc).resolvedOptions().locale === loc
      && await page.evaluate((l) => new Intl.NumberFormat(l).resolvedOptions().locale === l, loc));
    const norm = (v) => String(v).replace(/[\s\u00a0\u202f'’,.]/g, '');
    const inBrowser = await page.evaluate((code) => window.RegionContext.money(100000, code), c);
    if (both) { expect(norm(inBrowser), c).toBe(norm(L.money(100000, parity, c))); compared++; }
    else expect(inBrowser, c).toContain(L.localeFor(parity, c).symbol);
  }
  expect(compared).toBeGreaterThanOrEqual(15);
  expect(await page.evaluate(() => window.RegionContext.money(100000, 'IN'))).toBe('₹1,00,000');
  expect(L.money(100000, parity, 'IN')).toBe('₹1,00,000');
  expect(await page.evaluate(() => window.RegionContext.num(1234567, 'IN'))).toBe('12,34,567');

  served = own;
  await page.goto('http://parity.test/own');
  await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded === true);
  const ownBrowser = await page.evaluate(() => window.RegionContext.localeOf('IN'));
  expect(shape(L.localeFor(own, 'IN'))).toEqual({ market: 'IN', currency: 'USD', symbol: 'US$', locale: 'en-US', timeZone: 'Asia/Dubai', dial: '+1' });
  expect(shape(ownBrowser)).toEqual(shape(L.localeFor(own, 'IN')));
});

/* ── every page, for the Indian brand: market, currency and markers ─────── */
/*
 * Every page a rewrite in vercel.json serves that loads auth.js, opened for
 * Deli Chic kept on this device with a device sign-in, its /api/ calls
 * answered by the shipped routers. Read from the RENDERED page, outside the
 * shared rail:
 *   - the shared choice is the brand's home (IN);
 *   - every market control a page shows as SELECTED is IN (or an "All" row
 *     on an aggregating page), never US/UK/Global;
 *   - no visible text prints a dollar or pound amount, or "USD"/"GBP", for a
 *     brand whose currency is the rupee;
 *   - no visible marker is padded ("..., all]").
 * A page that shows a SHIPPED programme of tenant zero's (gated, or built for
 * one named market by design) is listed with the reason and checked for the
 * markers only. Every list assertion counts what it measured first.
 */
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const SWEEP_PAGES = Array.from(new Set((VERCEL.rewrites || []).map((r) => r.destination).filter((d) => /\.html$/.test(d)).map((d) => d.replace(/^\//, ''))))
  .filter((f) => fs.existsSync(path.join(ROOT, f)) && /<script[^>]+src=["'][^"']*\bauth\.js/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  .sort();
/* Tenant zero's shipped programmes: built for one named market by design. */
const SHIPPED_PROGRAMME = {
  'lifecycle-calendar.html': 'the UK engagement programme (gated data-shipped-for tenant zero, UK by definition)',
  'uk-non-engagers.html': 'the UK non-engagers campaign hub (tenant zero\'s UK programme)',
  'lifecycle-usa-july-calendar-mailer-studio.html': 'tenant zero\'s USA July calendar build (a generated artefact for the US market)',
  'data-engine.html': 'tenant zero\'s bundled US/UK export (the tabs are the DATASET\'s markets, owner-gated)',
  'diff-version.html': 'a frozen snapshot of tenant zero\'s app',
  'website-designs.html': 'tenant zero\'s storefront designs by store (US/UK/Global stores)',
  'access-issues.html': 'the platform\'s own SaaS subscription costs, billed in USD by their vendors',
};

test.describe('every page, for an Indian brand kept on this device', () => {
  let w;
  test.beforeAll(async () => {
    w = await A.world({ serverMode: false });
    w.db.route((u) => u.startsWith('https://delichic.example'), () => response(404, 'not found'));
  });
  test.afterAll(async () => { await w.close(); });

  test('the default market is the home market, money is in rupees, and no marker is padded', async ({ browser }) => {
    test.setTimeout(1_200_000);
    expect(SWEEP_PAGES.length).toBeGreaterThanOrEqual(40);
    const defects = [];
    let controls = 0;
    for (const file of SWEEP_PAGES) {
      w.reset();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const p = await ctx.newPage();
      try {
        await open(p, w, file, DELI);
        await p.waitForTimeout(1500);
        const got = await p.evaluate(() => {
          const RC = window.RegionContext;
          const out = { home: RC.home, region: RC.region, selected: [], text: '' };
          const nav = (el) => !!(el.closest && el.closest('#lifecycle-nav'));
          const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
          const on = (el) => /\b(on|active|selected|is-active)\b/.test(String(el.className || '')) || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true';
          for (const el of document.querySelectorAll('[data-mkt],[data-market],[data-region],[data-region-set]')) {
            if (nav(el) || !vis(el) || !on(el)) continue;
            out.selected.push(el.getAttribute('data-mkt') || el.getAttribute('data-market') || el.getAttribute('data-region') || el.getAttribute('data-region-set') || '');
          }
          for (const sel of document.querySelectorAll('select')) {
            if (nav(sel) || !vis(sel) || !sel.options.length) continue;
            const known = [...sel.options].filter((o) => ['US', 'UK', 'IN', 'GLOBAL', 'EU', 'AU', 'ME'].includes(RC.family(o.value || o.textContent))).length;
            if (known >= 2) out.selected.push(sel.value || ((sel.options[sel.selectedIndex] || {}).textContent) || '');
          }
          const main = document.body.cloneNode(true);
          const rail = main.querySelector('#lifecycle-nav'); if (rail) rail.remove();
          main.querySelectorAll('script,style,template,noscript').forEach((n) => n.remove());
          out.shown = (document.body.innerText || '').replace(/\s+/g, ' ');
          const railText = (document.querySelector('#lifecycle-nav') || {}).innerText || '';
          out.text = out.shown.replace(railText.replace(/\s+/g, ' '), ' ');
          out.families = out.selected.map((v) => RC.family(v));
          return out;
        });
        if (got.home !== 'IN') defects.push(`${file}: RegionContext.home is ${JSON.stringify(got.home)}`);
        if (got.region !== 'IN') defects.push(`${file}: RegionContext.region is ${JSON.stringify(got.region)}`);
        const padded = got.text.match(/\[DATA REQUIRED BEFORE LAUNCH:[^\]]*,\s*all\s*(?:,[^\]]*)?\]/g);
        if (padded) defects.push(`${file}: padded marker ${padded[0]}`);
        if (!SHIPPED_PROGRAMME[file]) {
          controls += got.families.length;
          const wrong = got.families.filter((f) => f && !['IN', 'ALL', 'ALLMARKETS'].includes(f));
          if (wrong.length) defects.push(`${file}: a market control opens on ${wrong.join(', ')}`);
          const money = got.text.match(/(?:US\$|\$\s?\d|£\s?\d|\bUSD\b|\bGBP\b)\S{0,12}/g);
          if (money) defects.push(`${file}: prints ${money.slice(0, 3).join(' | ')}`);
        }
      } catch (e) {
        defects.push(`${file}: did not open (${String(e.message || e).split('\n')[0]})`);
      } finally { await ctx.close(); }
    }
    expect(controls, 'the sweep saw no selected market control at all').toBeGreaterThan(3);
    expect(defects).toEqual([]);
  });
});
