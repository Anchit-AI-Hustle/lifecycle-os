/**
 * "Nothing was imported: this brand could not be saved" (production, 2026-10-13).
 * ---------------------------------------------------------------------------
 * A signed-in account with no brand yet pressed "Set up from my website" and
 * then Import catalog for delichic.co.in. Production's database shows no row was
 * ever written and no save reached it: the brand router refused the save before
 * writing ("Brand name is required" - a parsed read only PROPOSES the name), and
 * the wizard swallowed that sentence (`save(true)` returns nothing on failure)
 * and said only "could not be saved". Its last row still said "Saved as a
 * draft". Asserted, over the SHIPPED brand router and the fake project, with the
 * wizard in Chromium:
 *   1. a new brand set up from its website with no name typed is named as its
 *      own site names itself, and SAVED (a row exists), and Review does not
 *      claim a save that did not happen;
 *   2. a save the server refuses shows the server's own sentence where the
 *      import is, never the bare "could not be saved".
 * ---------------------------------------------------------------------------
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const req = (rel) => require(path.join(ROOT, rel));
const F = require('./lib/brand-invariant-fixtures.js');
const { makeReq, makeRes, envScope, BASE, ANON_KEY, SERVICE_KEY } = require('./lib/fake-supabase.js');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.owner.sig';
const OWNER = 'aaaaaaaa-0000-4000-8000-0000000000c7';
const ENV = envScope(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'BRAND_RENDER']);
const SITE = 'https://brambleweld-larder.example';
// The localhost preview: the one browser state in which the wizard takes the
// server path, so every brand op below is the shipped router.
const HOST = 'http://127.0.0.1:9';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const core = req('api/_shared/brand-workspace-core.js');

function world() {
  const db = req('tests/lib/brand-save-fake.js').makeDb(TOKEN, OWNER);
  db.install();
  process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.BRAND_RENDER = 'off';
  return db;
}

const EXTRACT = {
  ok: true, start: SITE, pages_visited: 3, stylesheets: [], limits: [], read: { method: 'parsed' },
  fields: {
    name: { value: 'Brambleweld Larder', source_url: SITE + '/', signal: 'og:site_name', candidates: [{ value: 'Brambleweld Larder', source_url: SITE + '/', signal: 'og:site_name' }] },
    tagline: { value: '', marker: '[DATA REQUIRED BEFORE LAUNCH: tagline, Brambleweld Larder]', candidates: [] },
    logo: { value: '', marker: '[DATA REQUIRED BEFORE LAUNCH: logo URL, Brambleweld Larder]', candidates: [] },
    palette: { proposed: {}, sources: {}, conflicts: [] }, typography: { heading: [], body: [], scale: [] },
    claims: { candidates: [] }, social: { candidates: [] }, legal: { candidates: [] },
  },
};

/** The page on HOST; brand ops through the shipped router; `before(op, body)` may answer first. */
async function wire(context, log, before) {
  await context.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
  });
  await context.route((u) => !String(u).startsWith(HOST), (route) => {
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});' : 'window.tailwind=window.tailwind||{};' });
  });
  await context.route(HOST + '/**', async (route) => {
    const u = new URL(route.request().url());
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.startsWith('/api/')) {
      const action = u.searchParams.get('action'), op = u.searchParams.get('op');
      if (!action) return json({ ok: true });
      if (action === 'auth') return op === 'status' ? json({ ok: true, mode: 'device', reason: 'no_database_url', host: '' }) : json({ ok: false, error: 'invalid_session' }, 401);
      if (action !== 'brand') return json({ ok: false, error: 'not_in_this_test' }, 404);
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (_) { body = {}; }
      log.push(op);
      if (before) { const r = await before(op, body); if (r) return json(r.body, r.status); }
      if (op === 'presets' || op === 'defaults') return json({ ok: true, presets: [] });
      if (op === 'extract') return json(EXTRACT);
      if (op === 'catalog-status') return json({ ok: true });
      if (op === 'context-build') return json({ ok: true, done: true, pack: { site_url: SITE, stage: 'done' } });
      if (op === 'context-pack') return json({ ok: true, pack: null });
      const r = makeReq({ token: TOKEN, query: Object.fromEntries(u.searchParams), body: route.request().method() === 'POST' ? body : undefined, method: route.request().method() });
      const res = makeRes();
      await core.handle(r, res);
      return json(res.payload, res.code);
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
}

test.beforeEach(() => ENV.save());
test.afterEach(() => ENV.restore());

test('a NEW brand set up from its website with no name typed is named as its site names itself, and saved', async ({ browser }) => {
  const db = world();
  const context = await browser.newContext();
  const log = [];
  try {
    await wire(context, log);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.goto(HOST + '/onboarding.html?step=1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#xSetup', { timeout: 20000 });
    await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded, null, { timeout: 20000 });
    expect(await page.inputValue('[data-path="name"]')).toBe('');
    await page.fill('#xUrl', SITE);
    await page.click('#xSetup');
    await page.waitForFunction(() => {
      const run = document.querySelector('[data-setup-run]');
      const review = document.querySelector('[data-setup-log] li[data-setup-step="review"]');
      return run && !run.hasAttribute('aria-busy') && review && review.getAttribute('data-state') !== 'running';
    }, null, { timeout: 30000 });
    const steps = await page.$$eval('[data-setup-log] li', (els) => els.map((e) => [e.getAttribute('data-setup-step'), e.getAttribute('data-state'), e.querySelector('.srun-text').textContent]));
    const row = (k) => steps.find((s) => s[0] === k) || [];
    // Saved: a row exists, named as the site names itself, with the source recorded.
    const rows = db.table('brand_workspaces').filter((w) => w.owner_id === OWNER);
    expect(rows.map((w) => w.name), JSON.stringify(steps)).toEqual(['Brambleweld Larder']);
    expect(rows[0].brand_data.brand_extraction.applied.name.source_url).toBe(SITE + '/');
    expect(row('brand')[2]).toMatch(/We named the brand Brambleweld Larder, as your site does/);
    expect(row('review')[1]).not.toBe('failed');
    expect(row('catalog')[2]).not.toMatch(/could not be saved/);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    db.restore();
  }
});

test('a save the server refuses: the import says the server\'s own sentence, not "could not be saved"', async ({ browser }) => {
  const db = world();
  db.table('brand_workspaces').push(Object.assign(F.workspaceRow(F.BRAMBLE, 'ws-bwl'), { owner_id: OWNER, onboarding_step: 5, created_at: db.tick(), updated_at: db.tick() }));
  db.table('brand_user_prefs').push({ user_id: OWNER, active_workspace_id: 'ws-bwl' });
  const SENTENCE = 'The store URL https://other-shop.example is on another site than this brand\'s website, brambleweld-larder.example.';
  const context = await browser.newContext();
  const log = [];
  try {
    await wire(context, log, async (op) => (op === 'save' ? { status: 409, body: { ok: false, error: 'url_off_site', message: SENTENCE } } : null));
    const page = await context.newPage();
    await page.goto(HOST + '/onboarding.html?step=5&id=ws-bwl', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded && window.BrandContext.brand && window.BrandContext.brand.id === 'ws-bwl', null, { timeout: 20000 });
    await page.waitForSelector('#doImport', { timeout: 20000 });
    await page.fill('#impUrl', SITE);
    await page.click('#doImport');
    await page.waitForFunction(() => /Nothing was imported/i.test((document.getElementById('impStatus') || {}).textContent || ''), null, { timeout: 15000 });
    const status = await page.textContent('#impStatus');
    expect(status).toContain(SENTENCE);
    expect(status).not.toMatch(/its store settings on screen were not sent/);
    expect(log, 'an import was sent after a refused save').not.toContain('catalog-import');
  } finally {
    await context.close();
    db.restore();
  }
});
