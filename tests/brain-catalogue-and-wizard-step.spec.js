/**
 * Two operator reports from production (2026-10-10), Google sign-in, account
 * brand "DelhiChic" (website delichic.co.in), each EXECUTED here in Chromium.
 * ---------------------------------------------------------------------------
 * A) "must be able to see brand catalog too here" - /brain (smart-brain.html)
 *    planned and wrote every slot from the active brand's catalogue and never
 *    showed it. The "Brand catalogue" panel reads it through the paths
 *    generation uses (BrandContext.catalogForGeneration for a device brand;
 *    op=catalog + the coherence rule for an account brand; BrandCatalog for
 *    tenant zero only). Driven here with a DEVICE brand whose kept catalogue
 *    holds its own rows AND one row read from another brand's site: the panel
 *    lists its own rows, says exactly one is excluded and never shows it, and
 *    tenant zero's shipped catalogue is never requested. A brand with no rows
 *    gets the DATA REQUIRED marker and the step that fixes it.
 *
 * B) "why does it autoload from screen 2 to screen 1" - /onboarding, editing
 *    an existing brand on Review, and seconds later the wizard was on "Who is
 *    the brand?" at /onboarding with no ?step. Nothing in the page moves the
 *    step by itself; the page was RELOADED (auth.js reloaded on the service
 *    worker's first claim of an uncontrolled page), and a bare /onboarding
 *    resumes at the step SAVED on the record, which a pip never saves. The
 *    step (and the brand) are in the URL now. The test goes to step 6 by the
 *    pip with the saved step at 1, fires every event that lands after boot
 *    (backend decided, storage decided, a brand change, a BrandContext
 *    refresh, an auth state change), asserts step 6 throughout, then RELOADS
 *    and asserts step 6 again - removing syncStepUrl() fails that last part.
 *    (Playwright sets navigator.webdriver, so auth.js registers no service
 *    worker here: the reload is driven directly.)
 *
 * Run: npx playwright test tests/brain-catalogue-and-wizard-step.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const HOST = 'http://app.example.test';
const DEVICE_KEY = 'lifecycle.brand.device.workspaces';
const DEAD = { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } };
const PHOTO_HOST = 'cdn.delichic.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDEgARQ+AABSOgID2v9zZQAAAABJRU5ErkJggg==', 'base64');

const BRAND_ID = 'local-delichic01';
const BRAND = {
  id: BRAND_ID, slug: 'delhichic', name: 'DelhiChic', status: 'active', onboarding_step: 1,
  tagline: 'Momos, steamed to order', industry: 'Restaurant', website: 'https://delichic.example',
  palette: { primary: '#B4472C', accent: '#F2B134', ink: '#1F1A17', surface: '#FFFFFF', surface_alt: '#FFF6EC' },
  typography: { heading: { family: 'Poppins', stack: "'Poppins',system-ui,sans-serif", google: true, weights: '500;600;700' }, body: { family: 'Inter', stack: "'Inter',system-ui,sans-serif", google: true, weights: '400;500;600;700' } },
  voice: { tone: 'warm', preferred: [], banned: [], no_em_dashes: true, notes: '' },
  regions: [{ code: 'IN', currency: 'INR', symbol: '₹', store_url: 'https://delichic.example', home: true }],
  asset_hosts: [], catalog_source: { kind: 'site_crawl', url: 'https://delichic.example', imported_at: '2026-10-09T10:00:00.000Z', region: 'in' },
  brand_data: {}, owner_id: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', storage: 'device',
};
const OWN = [
  { region: 'in', handle: 'steamed-chicken-momos', title: 'Steamed Chicken Momos', price: '249', currency: 'INR', image_url: `https://${PHOTO_HOST}/chicken.png`, product_url: 'https://delichic.example/menu/steamed-chicken-momos', source: 'site_crawl' },
  { region: 'in', handle: 'veg-tandoori-momos', title: 'Veg Tandoori Momos', price: '219', currency: 'INR', image_url: '', product_url: 'https://delichic.example/menu/veg-tandoori-momos', source: 'site_crawl' },
];
// Read from another brand's site: the coherence rule judges it foreign.
const FOREIGN = { region: 'in', handle: 'onion-hair-oil', title: 'Onion Hair Oil', price: '399', currency: 'INR', image_url: `https://${PHOTO_HOST}/oil.png`, product_url: 'https://www.othersite-cosmetics.example/products/onion-hair-oil', source: 'site_crawl' };
const COVERAGE = { complete: true, sentences: ['Found 2 of the 2 products the site declares in its product sitemap.'] };

async function harness(page, seed) {
  const log = { requests: [], dialogs: [], errors: [] };
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  page.on('request', (r) => log.requests.push(r.url()));
  await page.addInitScript((s) => {
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async () => ({ error: null }), signOut: async () => ({}),
    } }) };
    // Seed once per test, not on every navigation: a reload must see what the page wrote.
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem(s.key, JSON.stringify({ version: 1, active_id: s.brand.id, workspaces: [s.brand] }));
      if (s.catalog) localStorage.setItem(s.key + '.catalog.' + s.brand.id, JSON.stringify(s.catalog));
    }
  }, { key: DEVICE_KEY, brand: seed.brand, catalog: seed.catalog || null });

  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.abort('addressunreachable');
    if (new URL(u).hostname === PHOTO_HOST) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm
      ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
      : 'window.tailwind=window.tailwind||{};' });
  });
  await page.route(HOST + '/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action');
    const op = u.searchParams.get('op');
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (!action && !u.searchParams.has('health')) return json(DEAD);
    if (action === 'auth') return json({ ok: true, mode: 'google', pin_signin: false });
    if (action === 'brand' && op === 'presets') return json({ ok: true, presets: [] });
    if (action === 'brand' && op === 'defaults') return json({ ok: true, brand: {} });
    if (action === 'brand') return json({ ok: false, error: 'session_verification_unavailable', backend_unreachable: true, message: 'The database this deployment points at (paused-project.supabase.co) is not answering.' }, 503);
    return json({ ok: true, entries: [], plan: [], items: [], rows: [] });
  });
  return log;
}

async function brandSettled(page) {
  await page.waitForFunction((id) => window.BrandContext && window.BrandContext.loaded && window.BrandContext.brand && window.BrandContext.brand.id === id, BRAND_ID, { timeout: 20000 });
}

/* ═══ A) the /brain catalogue panel ═══════════════════════════════════════ */

test('/brain shows the active brand\'s own catalogue as generation reads it, and counts the row from another site as excluded', async ({ page }) => {
  test.setTimeout(90_000);
  const log = await harness(page, { brand: BRAND, catalog: { products: OWN.concat([FOREIGN]), source: BRAND.catalog_source, owned: true, region: 'in', imported_at: BRAND.catalog_source.imported_at, coverage: COVERAGE } });
  await page.goto(HOST + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
  await brandSettled(page);
  await page.waitForSelector('#catBody [data-cat-count]', { timeout: 20000 });

  const seen = await page.evaluate(() => {
    const body = document.getElementById('catBody');
    return {
      title: document.getElementById('catTitle').textContent,
      count: body.querySelector('[data-cat-count]').getAttribute('data-cat-count'),
      summary: body.querySelector('[data-cat-count]').textContent,
      names: Array.from(body.querySelectorAll('[data-cat-row] .catname')).map((n) => n.textContent),
      prices: Array.from(body.querySelectorAll('[data-cat-row] .catprice')).map((n) => n.textContent),
      imgs: Array.from(body.querySelectorAll('[data-cat-row] img')).map((i) => i.getAttribute('src')),
      gaps: Array.from(body.querySelectorAll('[data-cat-row] .catgap')).map((n) => n.textContent),
      excluded: (body.querySelector('[data-cat-excluded]') || {}).textContent || '',
      excludedN: body.querySelector('[data-cat-excluded]') ? body.querySelector('[data-cat-excluded]').getAttribute('data-cat-excluded') : null,
      coverage: (body.querySelector('.catcov') || {}).textContent || '',
      text: body.textContent,
      failures: body.querySelectorAll('.vh-failure').length,
    };
  });
  expect(seen.title).toBe('DelhiChic catalogue');
  expect(seen.count, 'the panel did not count the brand\'s own rows').toBe('2');
  expect(seen.names.sort()).toEqual(['Steamed Chicken Momos', 'Veg Tandoori Momos']);
  expect(seen.text, 'a product read from another brand\'s site was LISTED').not.toContain('Onion Hair Oil');
  expect(seen.excludedN, 'the excluded row was not counted').toBe('1');
  expect(seen.excluded).toMatch(/1 excluded/);
  expect(seen.excluded).toMatch(/another brand's site/);
  // The market's own currency, formatted by RegionContext (en-IN).
  expect(seen.prices.join(' ')).toContain('₹249');
  expect(seen.prices.join(' ')).toContain('₹219');
  expect(seen.imgs).toEqual([`https://${PHOTO_HOST}/chicken.png`]);
  expect(seen.gaps).toEqual(['[DATA REQUIRED BEFORE LAUNCH: product image, DelhiChic, Veg Tandoori Momos, IN]']);
  expect(seen.summary).toContain('delichic.example');
  expect(seen.coverage).toContain('Found 2 of the 2 products');
  expect(seen.failures).toBe(0);

  // Tenant zero's shipped catalogue is never asked for, for this brand.
  expect(log.requests.filter((u) => /\/data\/catalog\//.test(u)), 'the shipped catalogue was requested for another brand').toEqual([]);
  expect(log.dialogs).toEqual([]);
});

test('/brain with no catalogue of the brand\'s own says so with the marker and the step that fixes it', async ({ page }) => {
  test.setTimeout(90_000);
  const log = await harness(page, { brand: BRAND, catalog: { products: [FOREIGN], source: BRAND.catalog_source, owned: true, region: 'in' } });
  await page.goto(HOST + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
  await brandSettled(page);
  await page.waitForSelector('#catBody [data-cat-empty]', { timeout: 20000 });
  const empty = page.locator('#catBody [data-cat-empty]');
  await expect(empty).toContainText('[DATA REQUIRED BEFORE LAUNCH: product catalogue, DelhiChic]');
  await expect(empty.locator('a')).toHaveAttribute('href', '/onboarding?step=5');
  await expect(page.locator('#catBody [data-cat-excluded]')).toHaveAttribute('data-cat-excluded', '1');
  expect(await page.locator('#catBody [data-cat-row]').count()).toBe(0);
  // The accent rule, never the failure frame: an empty catalogue is a state.
  expect(await page.locator('#catBody .vh-failure').count()).toBe(0);
  expect(log.requests.filter((u) => /\/data\/catalog\//.test(u))).toEqual([]);
});

/* ═══ B) the wizard never changes the step by itself ═════════════════════ */

test('/onboarding stays on the step the person chose through every event after boot, and a reload resumes there', async ({ page }) => {
  test.setTimeout(120_000);
  const log = await harness(page, { brand: BRAND });
  await page.goto(HOST + '/onboarding.html', { waitUntil: 'domcontentloaded' });
  await brandSettled(page);
  // Boot loaded the brand: the title says so and the saved step (1) is on.
  await expect(page.locator('#title')).toHaveText('Edit DelhiChic', { timeout: 15000 });
  await expect(page.locator('.step-pip.on')).toHaveAttribute('data-step', '1');

  await page.click('.step-pip[data-step="6"]');
  const onSix = async (why) => {
    await expect(page.locator('.step-pip.on'), why).toHaveAttribute('data-step', '6');
    expect(await page.evaluate(() => new URLSearchParams(location.search).get('step')), why + ' (URL)').toBe('6');
  };
  await onSix('after pressing the Review pip');
  expect(await page.evaluate(() => new URLSearchParams(location.search).get('id'))).toBe(BRAND_ID);

  // Everything that lands after boot on production.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('lifecycleauth:backend', { detail: window.LifecycleAuth && window.LifecycleAuth.backend })));
  await onSix('after the backend decision was re-published');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('brandcontext:storage')));
  await onSix('after brand-context decided where accounts are kept');
  await page.evaluate(() => window.BrandContext.refresh && window.BrandContext.refresh());
  await page.waitForTimeout(400);
  await onSix('after a second BrandContext refresh (a brand re-list)');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('brandcontext:change', { detail: { brand: window.BrandContext.brand } })));
  await onSix('after a brand change event');
  // An auth state change: the session ending and the backend re-deciding.
  await page.evaluate(() => {
    const A = window.LifecycleAuth;
    A.backend = Object.assign({}, A.backend, { kind: 'signed-out', reachable: true });
    window.dispatchEvent(new CustomEvent('lifecycleauth:backend', { detail: A.backend }));
  });
  await page.waitForTimeout(400);
  await onSix('after an auth state change');

  // A reload from any cause (the service worker's claim, a new worker, F5)
  // resumes on the same step of the same brand.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await brandSettled(page);
  await expect(page.locator('#title')).toHaveText('Edit DelhiChic', { timeout: 15000 });
  await page.waitForTimeout(500);
  await onSix('after a reload');
  expect(log.dialogs).toEqual([]);
  expect(log.errors).toEqual([]);
});

/* ═══ C) the region fields fill themselves from the brand's own record ═══
   The operator, on the live record (region IN, Store URL https://www.nike.in
   under the website https://delichic.co.in, home unticked, a DATA REQUIRED
   home-market marker): "ensure such fields are autochecked and autofilled
   itself by the context of the brand". Every value below is DERIVED from the
   record (website, region code) and marked origin 'default'; a typed value
   is the person's and is never replaced. */

const LIVE = Object.assign({}, BRAND, {
  website: 'https://delichic.co.in',
  regions: [{ code: 'IN', currency: '', symbol: '', store_url: 'https://www.nike.in', home: false }],
  catalog_source: {}, onboarding_step: 5,
});

async function openStep(page, brand, step) {
  const log = await harness(page, { brand });
  await page.goto(HOST + '/onboarding.html?step=' + step, { waitUntil: 'domcontentloaded' });
  await brandSettled(page);
  await expect(page.locator('#title')).toHaveText('Edit DelhiChic', { timeout: 15000 });
  await expect(page.locator('.step-pip.on')).toHaveAttribute('data-step', String(step));
  return log;
}
const regionVal = (page, f, i) => page.locator('[data-r="' + f + '"][data-i="' + (i || 0) + '"]');

test('the live record: currency from the region code, the one region ticked home, the other-brand store URL flagged with one click to the website', async ({ page }) => {
  test.setTimeout(90_000);
  const log = await openStep(page, LIVE, 5);
  await expect(regionVal(page, 'currency')).toHaveValue('INR');
  await expect(page.locator('[data-home-i="0"]')).toBeChecked();
  await expect(page.locator('#regions .marker')).toHaveCount(0);
  const note = page.locator('[data-store-foreign="0"]');
  await expect(note).toContainText('nike.in');
  await expect(note).toContainText('delichic.co.in');
  // The accent rule, never the failure frame.
  expect(await note.evaluate((n) => !!n.closest('.vh-failure'))).toBe(false);
  await note.locator('[data-use-website]').click();
  await expect(regionVal(page, 'store_url')).toHaveValue('https://delichic.co.in');
  await expect(page.locator('[data-store-foreign]')).toHaveCount(0);
  // The import box follows the home store.
  await expect(page.locator('#impUrl')).toHaveValue('https://delichic.co.in');
  // Each derived value is recorded as such, never as the person's.
  // The wizard's model is private; Next saves it, so read what was saved.
  await page.click('[data-go="next"]');
  await expect(page.locator('.step-pip.on')).toHaveAttribute('data-step', '6');
  const o = await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key) || 'null');
    const w = d && d.workspaces && d.workspaces[0];
    return w ? { fo: (w.brand_data || {}).field_origins || {}, regions: w.regions } : null;
  }, DEVICE_KEY);
  expect(o, 'nothing was saved').toBeTruthy();
  expect(o.fo['regions.IN.currency'] && o.fo['regions.IN.currency'].origin).toBe('default');
  expect(o.fo['regions.home'] && o.fo['regions.home'].origin).toBe('default');
  expect(o.fo['regions.IN.store_url'] && o.fo['regions.IN.store_url'].origin, 'the person\'s one-click choice is theirs').toBe('user');
  expect(o.regions[0]).toMatchObject({ code: 'IN', currency: 'INR', store_url: 'https://delichic.co.in', home: true });
  expect(log.dialogs).toEqual([]);
});

test('an empty store URL is the website; the import box follows the home store until the person types in it', async ({ page }) => {
  test.setTimeout(90_000);
  await openStep(page, Object.assign({}, LIVE, { regions: [{ code: 'IN', currency: '', symbol: '', store_url: '', home: false }] }), 5);
  await expect(regionVal(page, 'store_url')).toHaveValue('https://delichic.co.in');
  await expect(page.locator('#impUrl')).toHaveValue('https://delichic.co.in');
  await regionVal(page, 'store_url').fill('https://shop.delichic.co.in');
  await expect(page.locator('#impUrl')).toHaveValue('https://shop.delichic.co.in');
  await page.locator('#impUrl').fill('https://feed.delichic.co.in');
  await regionVal(page, 'store_url').fill('https://menu.delichic.co.in');
  await expect(page.locator('#impUrl'), 'the box followed the store after the person typed in it').toHaveValue('https://feed.delichic.co.in');
  // A typed store URL is the person's: it survives a round trip through the steps.
  await page.click('.step-pip[data-step="6"]');
  await page.click('.step-pip[data-step="5"]');
  await expect(regionVal(page, 'store_url')).toHaveValue('https://menu.delichic.co.in');
  await expect(page.locator('#impUrl')).toHaveValue('https://feed.delichic.co.in');
});

test('a typed currency wins over the derived one, and an untick of the only home stays unticked', async ({ page }) => {
  test.setTimeout(90_000);
  await openStep(page, LIVE, 5);
  await expect(regionVal(page, 'currency')).toHaveValue('INR');
  await regionVal(page, 'currency').fill('USD');
  await regionVal(page, 'code').fill('IN');
  await page.click('.step-pip[data-step="6"]');
  await page.click('.step-pip[data-step="5"]');
  await expect(regionVal(page, 'currency'), 'a derived currency replaced the typed one').toHaveValue('USD');
  await page.locator('[data-home-i="0"]').click();
  await expect(page.locator('[data-home-i="0"]')).not.toBeChecked();
  await expect(page.locator('#regions .marker')).toContainText('home market');
  await page.click('.step-pip[data-step="6"]');
  await page.click('.step-pip[data-step="5"]');
  await expect(page.locator('[data-home-i="0"]'), 'the one-region default re-ticked a home the person unticked').not.toBeChecked();
});

test('with several regions and none ticked, nothing is chosen and the marker stays', async ({ page }) => {
  test.setTimeout(90_000);
  await openStep(page, Object.assign({}, LIVE, { regions: [
    { code: 'IN', currency: 'INR', symbol: '₹', store_url: 'https://delichic.co.in', home: false },
    { code: 'UK', currency: '', symbol: '', store_url: '', home: false },
  ] }), 5);
  await expect(page.locator('[data-home-i]:checked')).toHaveCount(0);
  await expect(page.locator('#regions .marker')).toContainText('[DATA REQUIRED BEFORE LAUNCH: home market');
  await expect(regionVal(page, 'currency', 1)).toHaveValue('GBP');
});

test('the review step lists what was filled from the record', async ({ page }) => {
  test.setTimeout(90_000);
  await openStep(page, Object.assign({}, LIVE, { regions: [{ code: 'IN', currency: '', symbol: '', store_url: '', home: false }] }), 6);
  const box = page.locator('#autoFilled');
  await expect(box).toContainText('IN store URL: https://delichic.co.in (from the website)');
  await expect(box).toContainText('IN currency: INR (from the region code)');
  await expect(box).toContainText('IN is the home market (the only region)');
});
