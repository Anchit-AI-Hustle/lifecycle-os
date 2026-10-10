/**
 * /audit reads where brands are saved from the TRUTH, not from the retired
 * PIN-era sign-in mode (2026-10-10).
 *
 * Production, a Google sign-in whose brand "Deli Chic" is a row in the
 * Supabase project: the "Database mode" card said "Device mode - Accounts and
 * brands are saved in this browser" and the next steps sent the reader to
 * docs/mobile-pin-signin.md. The page decided from `?action=auth&op=status`,
 * which since Google became the only sign-in answers `{mode:'google'}` for
 * every deployment - and anything but `supabase`/`server` read as "device".
 *
 * The card now reads auth.js's own decision (LifecycleAuth.backend: the kind
 * and the Supabase host it probed) and where the ACTIVE brand lives (its
 * `storage` and id). Every check states its reason, the overall line names
 * each check that does not pass, and every next step comes from one that
 * failed. Executed in Chromium over the shipped page, auth.js and
 * brand-context.js, with supabase-js replaced by a session stub the way
 * tests/google-only-signin.spec.js does it; the status router answers what
 * production answers, so a page that still read it would fail here.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const LIVE = { supabase: { url: 'https://live-project.supabase.co', anonKey: 'anon' } };
const DEAD = { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } };

const UID = 'cccccccc-0000-4000-8000-0000000000cc';
const SESSION = {
  access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjY2NjIn0.Zml4', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 86400,
  user: { id: UID, email: 'owner@delichic.example', app_metadata: { provider: 'google' }, user_metadata: { name: 'Dee' } },
};
const PALETTE = { primary: '#b8322a', accent: '#2a6fb8', surface: '#ffffff', ink: '#1f2937' };
const ACCOUNT_BRAND = {
  id: '5f1c2e9a-1111-4222-8333-444455556666', name: 'Deli Chic', slug: 'deli-chic', status: 'active', website: 'https://delichic.example',
  palette: PALETTE, typography: { heading: 'Arial', body: 'Arial' }, regions: [{ code: 'IN', name: 'India', currency: 'INR', home: true }],
  coherence: { ok: true, blocking: false, count: 0, summary: 'Every value was read from delichic.example.' },
};
const DEVICE_BRAND = {
  id: 'local-delichic01', name: 'Deli Chic', slug: 'deli-chic', status: 'active', storage: 'device', website: 'https://delichic.example',
  palette: PALETTE, typography: { heading: 'Arial', body: 'Arial' }, regions: [{ code: 'IN', name: 'India', currency: 'INR', home: true }],
  created_at: '2026-10-10T00:00:00.000Z', updated_at: '2026-10-10T00:00:00.000Z',
};
const PRODUCTS = [
  { title: 'Chicken Salami', handle: 'chicken-salami', region: 'in', price: 349, currency: 'INR', image_url: 'https://delichic.example/salami.jpg', product_url: 'https://delichic.example/products/chicken-salami' },
  { title: 'Smoked Ham', handle: 'smoked-ham', region: 'in', price: 449, currency: 'INR', image_url: 'https://delichic.example/ham.jpg', product_url: 'https://delichic.example/products/smoked-ham' },
];

async function open(page, o) {
  const opts = o || {};
  const seen = { api: [], errors: [] };
  page.on('pageerror', (e) => seen.errors.push(String(e.message || e)));
  page.on('request', (r) => { if (/app\.example\.test\/api\//.test(r.url())) seen.api.push(r.url()); });
  await page.addInitScript((init) => {
    try { localStorage.clear(); } catch (_) {}
    Object.keys(init.storage || {}).forEach((k) => localStorage.setItem(k, init.storage[k]));
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: init.session || null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async () => ({ error: null }),
          signOut: async () => ({}),
        },
      }),
    };
  }, { storage: opts.storage || {}, session: opts.session || null });

  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/(health|settings)/.test(u)) {
      if (opts.reachable === false) return route.abort('addressunreachable');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ external: { google: true } }) });
    }
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({ status: 200, contentType: 'text/javascript',
      body: esm ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});' : 'window.tailwind=window.tailwind||{};' });
  });
  await page.route('http://app.example.test/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  await page.route(/\/api\/public-config(\?|$)/, (route) => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action');
    const op = u.searchParams.get('op');
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    // What production answers since Google is the only sign-in.
    if (action === 'auth' && op === 'status') return json({ ok: true, mode: 'google', pin_signin: false });
    if (action === 'brand') {
      const signedIn = /^Bearer /.test(route.request().headers().authorization || '');
      if (!signedIn) return json({ ok: false, error: 'sign_in_required', message: 'Sign in first.' }, 401);
      if (op === 'active') return json({ ok: true, brand: ACCOUNT_BRAND, needs_onboarding: false, workspaces: [ACCOUNT_BRAND] });
      if (op === 'list') return json({ ok: true, workspaces: [ACCOUNT_BRAND], active_id: ACCOUNT_BRAND.id });
      if (op === 'catalog') return json({ ok: true, products: PRODUCTS, count: PRODUCTS.length });
      return json({ ok: true });
    }
    if (action) return json({ ok: true });
    return json(opts.config || LIVE);
  });
  await page.goto('http://app.example.test/app-audit.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending', null, { timeout: 15000 });
  await expect.poll(() => page.evaluate(() => document.getElementById('overallText').getAttribute('data-done')), { message: 'the live checks never finished', timeout: 20000 }).toBe('1');
  await page.waitForTimeout(400);
  await expect.poll(() => page.evaluate(() => document.getElementById('overallText').getAttribute('data-done')), { timeout: 20000 }).toBe('1');
  return seen;
}

async function read(page) {
  return page.evaluate(() => {
    const t = (id) => (document.getElementById(id) || {}).textContent || '';
    const tone = (id) => (document.getElementById(id) || { getAttribute: () => '' }).getAttribute('data-tone') || '';
    return {
      kind: window.LifecycleAuth.backend.kind,
      brand: t('diagBrand'), db: t('diagDb'), dbTone: tone('diagDb'), dbDesc: t('diagDbDesc'),
      catalog: t('diagCatalog'), record: t('diagRecord'), recordTone: tone('diagRecord'),
      ring: t('ringScore'), overall: t('overallText'), failing: document.getElementById('overallText').getAttribute('data-failing'),
      road: [...document.querySelectorAll('#road li')].map((li) => li.textContent),
      body: document.body.innerText,
    };
  });
}

test('signed in with Google, the brand an account row: Account (Supabase <host>), every live check passes', async ({ page }) => {
  const seen = await open(page, { session: SESSION });
  const r = await read(page);
  expect(r.kind).toBe('signed-in');
  expect(r.brand).toBe('Deli Chic');
  expect(r.db).toBe('Account (Supabase live-project.supabase.co)');
  expect(r.dbTone).toBe('good');
  expect(r.dbDesc).toMatch(/Signed in with Google as owner@delichic\.example; brands are saved to your account\./);
  expect(r.catalog).toBe('2 products');
  expect(r.record).toBe('One brand');
  expect(r.ring).toBe('4/4');
  expect(r.failing).toBe('');
  expect(r.overall).toBe('4 of 4 live checks pass for Deli Chic.');
  expect(r.road).toEqual(['Every live check passes for this brand.']);
  expect(r.body, 'the page still names the retired device mode or the PIN document').not.toMatch(/Device mode|mobile-pin-signin|Supabase mode/);
  expect(seen.api.filter((u) => /action=auth/.test(u)), 'the page asked the retired PIN status router').toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('signed out, the brand on this device: This device, the failing check named with its reason, the next step is Google sign-in', async ({ page }) => {
  const storage = { 'lifecycle.brand.device.workspaces': JSON.stringify({ version: 1, active_id: DEVICE_BRAND.id, workspaces: [DEVICE_BRAND] }) };
  const seen = await open(page, { storage });
  const r = await read(page);
  expect(r.kind).toBe('signed-out');
  expect(r.brand).toBe('Deli Chic');
  expect(r.db).toBe('This device');
  expect(r.dbTone).toBe('warn');
  expect(r.dbDesc).toMatch(/Not signed in: brands are saved in this browser only\. The account service \(Supabase live-project\.supabase\.co\) answers/);
  // No catalogue on the device, and not signed in: both named, each with its reason.
  expect(r.failing.split(',').sort()).toEqual(['catalog', 'db']);
  expect(r.ring).toBe('2/4');
  expect(r.overall).toContain('Not passing: Catalogue (no products imported); Where brands are saved (not signed in).');
  expect(r.road.some((s) => /^Where brands are saved: Sign in with Google/.test(s)), 'no sign-in step: ' + JSON.stringify(r.road)).toBe(true);
  expect(r.road.some((s) => /^Catalogue: Import this brand's own catalogue/.test(s))).toBe(true);
  expect(r.body).not.toMatch(/mobile-pin-signin|Supabase mode|Every live check passes/);
  expect(seen.api.filter((u) => /action=auth/.test(u))).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('the Supabase project not answering: This device, the host named, the step is to restore it', async ({ page }) => {
  const storage = { 'lifecycle.brand.device.workspaces': JSON.stringify({ version: 1, active_id: DEVICE_BRAND.id, workspaces: [DEVICE_BRAND] }) };
  await open(page, { storage, config: DEAD, reachable: false });
  const r = await read(page);
  expect(r.kind).toBe('unreachable');
  expect(r.db).toBe('This device');
  expect(r.dbTone).toBe('bad');
  expect(r.dbDesc).toContain('paused-project.supabase.co');
  expect(r.overall).toContain('Where brands are saved (the Supabase project paused-project.supabase.co is not answering)');
  expect(r.road.some((s) => /Supabase project paused-project\.supabase\.co is not answering/.test(s))).toBe(true);
});
