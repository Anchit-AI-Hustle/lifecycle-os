/**
 * The operator (2026-10-11): "when I said catalog must be visible I meant as an
 * LHS item menu in the brand setup part", then "and option to view catalog or
 * brand context anything must be allowed".
 * ---------------------------------------------------------------------------
 * Two rail rows under Brand & Credits, right after Brand Setup, each its own
 * destination:
 *   /catalog        brand-catalogue.html - the active brand's catalogue as
 *                   generation reads it (brand-catalogue-panel.js, the SAME
 *                   module /brain's panel mounts), full grid, search, import.
 *   /brand-context  brand-context-view.html - every field of the full record
 *                   with its value and where it came from, the marker for a
 *                   missing fact, and an Edit link to the Brand Setup step.
 * EXECUTED in Chromium over the shipped pages, a DEVICE brand with its own
 * catalogue plus one row read from another brand's site. The fixture (brand,
 * rows, harness) is the one tests/brain-catalogue-and-wizard-step.spec.js
 * drives /brain with, plus vercel.json's own rewrites so /catalog and
 * /brand-context are requested by the addresses the rail links.
 *
 * Run: npx playwright test tests/brand-catalogue-page.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const REWRITES = {};
for (const r of (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8')).rewrites || [])) {
  if (r && typeof r.source === 'string' && !/[:(*]/.test(r.source) && !/[?#]/.test(r.destination)) REWRITES[r.source] = r.destination;
}
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
    const p = REWRITES[u.pathname] || u.pathname;
    const f = path.join(ROOT, p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\//, ''));
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

const CTX_BRAND = Object.assign({}, BRAND, {
  logo_url: 'https://delichic.example/logo.png',
  brand_data: {
    legal_entity: { name: 'DelhiChic Foods Pvt Ltd', address: 'New Delhi, India' },
    claims: ['Steamed fresh every morning'],
    social: [{ platform: 'instagram', url: 'https://instagram.com/delhichic', source_url: 'https://delichic.example/' }],
    field_origins: { tagline: { origin: 'site-parse', url: 'https://delichic.example/about' }, 'palette.primary': { origin: 'document', source: 'DelhiChic brand book.pdf' } },
    field_origin: { tagline: 'site-parse', 'palette.primary': 'document', 'palette.accent': 'preset', industry: 'user' },
  },
});

async function railRow(page, id) {
  await page.waitForSelector('#lifecycle-nav a[data-id="' + id + '"]', { timeout: 20000, state: 'attached' });
  return page.evaluate((rid) => {
    const a = document.querySelector('#lifecycle-nav a[data-id="' + rid + '"]');
    const rows = Array.from(document.querySelectorAll('#lifecycle-nav a[data-id]')).map((x) => x.getAttribute('data-id'));
    return { href: a.getAttribute('href'), active: a.classList.contains('active'), label: a.textContent.trim(), order: rows };
  }, id);
}

test('/catalog lists the active brand\'s own products, counts the foreign row as excluded, filters by search, and is a Brand & Credits rail row', async ({ page }) => {
  test.setTimeout(90_000);
  const log = await harness(page, { brand: BRAND, catalog: { products: OWN.concat([FOREIGN]), source: BRAND.catalog_source, owned: true, region: 'in', imported_at: BRAND.catalog_source.imported_at, coverage: COVERAGE } });
  await page.goto(HOST + '/catalog', { waitUntil: 'domcontentloaded' });
  await brandSettled(page);
  await page.waitForSelector('#catBody [data-cat-count]', { timeout: 20000 });

  await expect(page.locator('#catTitle')).toHaveText('DelhiChic catalogue');
  await expect(page.locator('#catBody [data-cat-count]')).toHaveAttribute('data-cat-count', '2');
  const names = await page.locator('#catBody [data-cat-row] .catname').allTextContents();
  expect(names.sort()).toEqual(['Steamed Chicken Momos', 'Veg Tandoori Momos']);
  expect(await page.locator('#catBody').textContent(), 'a product read from another brand\'s site was LISTED').not.toContain('Onion Hair Oil');
  await expect(page.locator('#catBody [data-cat-excluded]')).toHaveAttribute('data-cat-excluded', '1');
  await expect(page.locator('#catBody [data-cat-excluded]')).toContainText('1 excluded');
  // The full page: no 440px cap on the grid.
  expect(await page.locator('#catBody .catgrid').evaluate((g) => getComputedStyle(g).maxHeight)).toBe('none');
  // The import action names the brand's catalogue step.
  await expect(page.locator('#catImport')).toHaveAttribute('href', '/onboarding?step=5&id=' + BRAND_ID);
  await expect(page.locator('#catContinue')).toBeHidden();

  // Search filters by title.
  await page.fill('#catSearch', 'tandoori');
  await expect(page.locator('#catBody [data-cat-row]')).toHaveCount(1);
  await expect(page.locator('#catBody [data-cat-row] .catname')).toHaveText('Veg Tandoori Momos');
  await expect(page.locator('#catBody [data-cat-matches]')).toHaveAttribute('data-cat-matches', '1');
  await page.fill('#catSearch', 'nothing like this');
  await expect(page.locator('#catBody [data-cat-row]')).toHaveCount(0);
  await page.fill('#catSearch', '');
  await expect(page.locator('#catBody [data-cat-row]')).toHaveCount(2);

  // The rail: present, active here, right after Brand Setup, then Brand Context.
  const row = await railRow(page, 'brand-catalogue');
  expect(row.href).toBe('/catalog');
  expect(row.active, 'the Brand Catalogue row is not active on /catalog').toBe(true);
  const at = row.order.indexOf('brand-setup');
  expect(row.order.slice(at, at + 3)).toEqual(['brand-setup', 'brand-catalogue', 'brand-context']);

  expect(log.requests.filter((u) => /\/data\/catalog\//.test(u)), 'the shipped catalogue was requested for another brand').toEqual([]);
  expect(log.dialogs).toEqual([]);
  expect(log.errors).toEqual([]);
});

test('/catalog with a partial import offers Continue import', async ({ page }) => {
  test.setTimeout(90_000);
  await harness(page, { brand: BRAND, catalog: { products: OWN, source: BRAND.catalog_source, owned: true, region: 'in', cursor: { stage: 'feed', page: 3 }, coverage: { complete: false, sentences: ['PARTIAL: read 2 of 40 at feed page 3.'] } } });
  await page.goto(HOST + '/catalog', { waitUntil: 'domcontentloaded' });
  await brandSettled(page);
  await page.waitForSelector('#catBody [data-cat-count]', { timeout: 20000 });
  await expect(page.locator('#catContinue')).toBeVisible();
  await expect(page.locator('#catContinue')).toHaveAttribute('href', '/onboarding?step=5&id=' + BRAND_ID);
  await expect(page.locator('#catBody .catcov')).toContainText('Catalogue read in part');
});

test('/brain\'s catalogue panel is the shared module and still reads the same', async ({ page }) => {
  test.setTimeout(90_000);
  const log = await harness(page, { brand: BRAND, catalog: { products: OWN.concat([FOREIGN]), source: BRAND.catalog_source, owned: true, region: 'in' } });
  await page.goto(HOST + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
  await brandSettled(page);
  await page.waitForSelector('#catBody [data-cat-count]', { timeout: 20000 });
  expect(await page.locator('#catBody').getAttribute('data-bcp')).toBe('');
  await expect(page.locator('#catBody [data-cat-count]')).toHaveAttribute('data-cat-count', '2');
  await expect(page.locator('#catBody [data-cat-excluded]')).toHaveAttribute('data-cat-excluded', '1');
  // The panel keeps its 440px cap on /brain.
  expect(await page.locator('#catBody .catgrid').evaluate((g) => getComputedStyle(g).maxHeight)).toBe('440px');
  expect(log.requests.filter((u) => /\/data\/catalog\//.test(u))).toEqual([]);
});

test('/brand-context shows every section with values, origins, markers for what is missing, and edit links to the right step', async ({ page }) => {
  test.setTimeout(90_000);
  const log = await harness(page, { brand: CTX_BRAND, catalog: { products: OWN.concat([FOREIGN]), source: BRAND.catalog_source, owned: true, region: 'in', coverage: COVERAGE } });
  await page.goto(HOST + '/brand-context', { waitUntil: 'domcontentloaded' });
  await brandSettled(page);
  await page.waitForSelector('#ctxBody [data-section="pack"]', { timeout: 20000 });
  await expect(page.locator('#ctxTitle')).toHaveText('DelhiChic context');

  const seen = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#ctxBody [data-section]').forEach((s) => {
      out[s.getAttribute('data-section')] = { edit: s.querySelector('[data-edit]').getAttribute('href'), text: s.textContent };
    });
    const field = (f) => {
      const el = document.querySelector('#ctxBody [data-field="' + f + '"]');
      if (!el) return null;
      const o = el.querySelector('[data-origin]');
      return { text: el.textContent, origin: o ? o.getAttribute('data-origin') : null, missing: el.hasAttribute('data-missing') };
    };
    return {
      sections: out,
      name: field('name'), tagline: field('tagline'), industry: field('industry'), legal: field('brand_data.legal_entity'),
      logo: field('logo_url'), icon: field('favicon_url'), primary: field('palette.primary'), accent: field('palette.accent'),
      heading: field('typography.heading'), scale: field('typography.scale'), tone: field('voice.tone'), banned: field('voice.banned'),
      home: field('regions.home'), inRegion: field('regions.IN'), claims: field('brand_data.claims'), social: field('brand_data.social'),
      count: field('catalog.count'), excluded: document.querySelector('#ctxBody [data-cat-excluded]').getAttribute('data-cat-excluded'),
      swatchBg: getComputedStyle(document.querySelector('#ctxBody [data-field="palette.primary"] .sw-chip')).backgroundColor,
      catLink: document.querySelector('#ctxBody [data-cat-link]').getAttribute('href'),
      coherence: document.querySelector('#ctxBody [data-coherence]') ? document.querySelector('#ctxBody [data-coherence]').getAttribute('data-coherence') : null,
      failures: document.querySelectorAll('#ctxBody .vh-failure').length,
    };
  });

  // Every section, each with its Brand Setup step for THIS brand.
  const STEP = { identity: 1, palette: 2, typography: 3, voice: 4, regions: 5, claims: 4, presence: 1, design: 1, catalogue: 5, coherence: 1, pack: 6 };
  expect(Object.keys(seen.sections).sort()).toEqual(Object.keys(STEP).sort());
  for (const [id, n] of Object.entries(STEP)) expect(seen.sections[id].edit, id).toBe('/onboarding?step=' + n + '&id=' + BRAND_ID);

  // Values and where each came from.
  expect(seen.name.text).toContain('DelhiChic');
  expect(seen.name.origin, 'a filled value with no recorded origin is the person\'s').toBe('user');
  expect(seen.tagline.text).toContain('Momos, steamed to order');
  expect(seen.tagline.origin).toBe('site-parse');
  expect(seen.tagline.text).toContain('https://delichic.example/about');
  expect(seen.industry.origin).toBe('user');
  expect(seen.legal.text).toContain('DelhiChic Foods Pvt Ltd');
  expect(seen.logo.text).toContain('https://delichic.example/logo.png');
  expect(seen.primary.text).toContain('#B4472C');
  expect(seen.primary.origin).toBe('document');
  expect(seen.primary.text).toContain('DelhiChic brand book.pdf');
  expect(seen.accent.origin).toBe('preset');
  expect(seen.swatchBg).toBe('rgb(180, 71, 44)');
  expect(seen.heading.text).toContain('Poppins');
  expect(seen.tone.text).toContain('warm');
  expect(seen.home.text).toContain('IN');
  expect(seen.inRegion.text).toContain('INR');
  expect(seen.inRegion.text).toContain('https://delichic.example');
  expect(seen.claims.text).toContain('Steamed fresh every morning');
  expect(seen.social.text).toContain('instagram.com/delhichic');

  // A missing fact is the marker, never a blank or an invention.
  expect(seen.icon.missing).toBe(true);
  expect(seen.icon.text).toContain('[DATA REQUIRED BEFORE LAUNCH: app icon, DelhiChic]');
  expect(seen.banned.missing).toBe(true);
  expect(seen.banned.text).toContain('[DATA REQUIRED BEFORE LAUNCH: banned phrases, DelhiChic]');
  expect(seen.scale.text).toContain('[DATA REQUIRED BEFORE LAUNCH: typography scale, DelhiChic]');
  expect(seen.sections.pack.text).toContain('[DATA REQUIRED BEFORE LAUNCH: brand context pack, DelhiChic]');

  // The catalogue as generation reads it, and the way to it.
  expect(seen.count.text).toContain('2');
  expect(seen.excluded).toBe('1');
  expect(seen.catLink).toBe('/catalog');
  expect(seen.coherence).not.toBeNull();
  expect(seen.failures).toBe(0);

  const row = await railRow(page, 'brand-context');
  expect(row.href).toBe('/brand-context');
  expect(row.active).toBe(true);

  expect(log.requests.filter((u) => /\/data\/catalog\//.test(u))).toEqual([]);
  expect(log.requests.filter((u) => /[?&]action=brand/.test(u) && !/op=(presets|defaults)/.test(u)), 'a device brand\'s record was asked of the server').toEqual([]);
  expect(log.dialogs).toEqual([]);
  expect(log.errors).toEqual([]);
});

/* Every regional store is imported (2026-10-11, tests/catalog-import-always-complete.spec.js):
   the page shows each market's count and filters by market, on the rows' own markets. */
test('/catalog shows each market a multi-market import filed, with its count, and filters by market', async ({ page }) => {
  test.setTimeout(90_000);
  const rows = [
    OWN[0], OWN[1],
    { region: 'us', handle: 'chicken-momos-us', title: 'Chicken Momos (US)', price: '9', currency: 'USD', image_url: `https://${PHOTO_HOST}/us.png`, product_url: 'https://delichic.example/en-us/menu/chicken-momos', source: 'site_crawl' },
    { region: 'ae', handle: 'chicken-momos-ae', title: 'Chicken Momos (AE)', price: '29', currency: 'AED', image_url: `https://${PHOTO_HOST}/ae.png`, product_url: 'https://delichic.example/en-ae/menu/chicken-momos', source: 'site_crawl' },
  ];
  await harness(page, { brand: BRAND, catalog: { products: rows, source: BRAND.catalog_source, owned: true, region: 'in', coverage: { complete: true, sentences: ['Every regional store the brand publishes: 3 markets. IN: 2 of 2 · US: 1 of 1 · AE: 1 of 1.'] } } });
  await page.goto(HOST + '/catalog', { waitUntil: 'domcontentloaded' });
  await brandSettled(page);
  await page.waitForSelector('#catBody [data-cat-count]', { timeout: 20000 });
  await expect(page.locator('#catBody')).toContainText('IN: 2 of 2 · US: 1 of 1 · AE: 1 of 1');
  const chips = await page.locator('#catBody [data-catmkt]').allTextContents();
  expect(chips.map((c) => c.trim())).toEqual(expect.arrayContaining(['IN (2)', 'US (1)', 'AE (1)']));
  await page.locator('#catBody [data-catmkt="US"]').click();
  await expect(page.locator('#catBody [data-cat-row]')).toHaveCount(1);
  await expect(page.locator('#catBody [data-cat-row] .catname')).toHaveText('Chicken Momos (US)');
  await page.locator('#catBody [data-catmkt="AE"]').click();
  await expect(page.locator('#catBody [data-cat-row] .catname')).toHaveText('Chicken Momos (AE)');
});
