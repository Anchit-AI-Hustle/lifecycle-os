/**
 * A brand's product photos, prices, store links and handles come from ITS OWN
 * catalogue, or there are none - in every page, for every brand.
 * ---------------------------------------------------------------------------
 * WHY. 2026-10-05, production /ad-campaigns.html#google, active brand "Deli
 * Chic" (a momos restaurant, kept on the device by a phone sign-in). "Generate
 * ad creatives" composed Deli Chic's name and copy ("juiciest momos") over
 * photographs of hand-painted SNEAKERS - tenant zero's products - and captioned
 * them "composed from real Shopify catalog photos - real packaging, no
 * AI-invented product". The page did not load brand-catalog.js, so it fetched
 * `/data/catalog/products_us.json` (tenant zero's shipped catalogue) for every
 * brand. And had it loaded it, a device brand's own imported catalogue still
 * never reached a page: the resolver asked the server, which keeps no rows for
 * a device brand.
 *
 * THE RULE (CLAUDE.md, "Asset provenance"): an asset for brand X uses brand
 * X's own catalogue, or NO asset at all. In the browser that is structural now:
 * brand-catalog.js is the only code that fetches `/data/catalog/`, and only for
 * tenant zero - who is tenant zero being the SERVER's determination
 * (`owns_shipped`, the oldest workspace), never a client-written slug.
 *
 * HOW THIS GATE WORKS. ad-campaigns.html is OPENED in Chromium under a
 * non-tenant-zero brand session - (a) a device brand with no catalogue, (b) a
 * device brand with its own imported catalogue whose photos live on a fixture
 * host - and every request the page makes is recorded while "Generate ad
 * creatives" is pressed on each platform tab. A request for tenant zero's
 * catalogue, store host or catalogue photo fails it. (a) must show the DATA
 * REQUIRED marker on every creative; (b) exactly its own photos. Tenant zero
 * (server-stamped) still gets its catalogue: the positive control, without
 * which a resolver that refused everybody would pass.
 *
 * Run: npx playwright test tests/catalog-provenance.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const ZERO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', '_default.json'), 'utf8'));

/* ── tenant zero's signature, DERIVED from its own record and catalogue ───── */

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } };
const ZERO_HOSTS = Array.from(new Set([ZERO.website].concat((ZERO.regions || []).map((r) => r.store_url)).map(hostOf).filter(Boolean)));
function shippedRows(region) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog', 'products_' + region + '.json'), 'utf8')); } catch (_) { return []; }
}
/** Shopify serves every store from cdn.shopify.com, so the HOST is not tenant
 *  zero's; its shop's file path is (/s/files/1/<a>/<b>/<c>/). */
const ZERO_CDN = (() => {
  const set = new Set();
  for (const r of ['us', 'uk', 'global']) {
    for (const p of shippedRows(r)) {
      for (const u of [p.i].concat(p.imgs || [])) {
        const m = /^https?:\/\/cdn\.shopify\.com(\/s\/files\/1\/\d+\/\d+\/\d+\/)/.exec(String(u || ''));
        if (m) set.add(m[1]);
      }
    }
  }
  return Array.from(set);
})();
const BUILT = shippedRows('us').length > 0;

/** Does this URL belong to tenant zero's catalogue, store or photos? */
function zeroUrl(u) {
  const s = String(u || '');
  if (/\/data\/catalog\/products_/.test(s)) return 'shipped catalogue file';
  const h = hostOf(s);
  if (h && ZERO_HOSTS.some((z) => h === z || h.endsWith('.' + z))) return 'tenant zero store host ' + h;
  if (/cdn\.shopify\.com/.test(s) && ZERO_CDN.some((p) => s.includes(p))) return 'tenant zero catalogue photo';
  return '';
}

/* ── the brands ────────────────────────────────────────────────────────────── */

const DELI = {
  name: 'Deli Chic', slug: 'deli-chic', tagline: 'Momos, steamed to order', industry: 'Restaurant / momos',
  website: 'https://delichic.example',
  palette: { primary: '#B4472C', accent: '#F2B134', ink: '#1F1A17', surface: '#FFFFFF', surface_alt: '#FFF6EC' },
  typography: { heading: { family: 'Poppins' }, body: { family: 'Inter' } },
  voice: { tone: 'warm, hungry, local', preferred: [], banned: [] },
  regions: [{ code: 'IN', currency: 'INR', symbol: '₹', store_url: 'https://delichic.example', home: true }],
  claims: [], offerings: [], competitors: [],
};
const FIXTURE_HOST = 'cdn.delichic.test';
const DELI_ROWS = [
  { region: 'in', handle: 'steamed-chicken-momos', title: 'Steamed Chicken Momos', price: '249', currency: 'INR', image_url: `https://${FIXTURE_HOST}/momo-chicken.png`, product_url: 'https://delichic.example/menu/steamed-chicken-momos', source: 'site_crawl' },
  { region: 'in', handle: 'veg-tandoori-momos', title: 'Veg Tandoori Momos', price: '219', currency: 'INR', image_url: `https://${FIXTURE_HOST}/momo-tandoori.png`, product_url: 'https://delichic.example/menu/veg-tandoori-momos', source: 'site_crawl' },
  { region: 'in', handle: 'paneer-kurkure-momos', title: 'Paneer Kurkure Momos', price: '239', currency: 'INR', image_url: `https://${FIXTURE_HOST}/momo-paneer.png`, product_url: 'https://delichic.example/menu/paneer-kurkure-momos', source: 'site_crawl' },
];
const DELI_SOURCE = { kind: 'site_crawl', url: 'https://delichic.example', imported_at: '2026-10-04T10:00:00.000Z', row_count: 3, region: 'in' };

// A 2x2 PNG, so a canvas can draw it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDEgARQ+AABSOgID2v9zZQAAAABJRU5ErkJggg==', 'base64');

const DEVICE_USER = 'dev-cat0001';
const DEVICE_ID = 'local-catprov0001';

/* ── the harness ───────────────────────────────────────────────────────────── */

/**
 * state.kind:
 *   'device' - a phone sign-in on a deployment with no database (production's
 *              shape): the brand is kept on this device, with `catalog` rows
 *              beside it when given.
 *   'server' - an account brand answered by the server (the localhost preview
 *              is the one browser state that takes the server path): `brand`
 *              carries what op=active answers, `catalog` what op=catalog does.
 */
async function install(page, state) {
  const seen = [];
  page.on('request', (r) => seen.push(r.url()));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  if (state.kind === 'device') {
    await page.addInitScript((seed) => {
      // The anonymous stand-in for supabase-js; it never holds a session.
      window.supabase = {
        createClient: () => ({
          auth: {
            getSession: async () => ({ data: { session: null } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
            signInWithOAuth: async () => ({ error: null }),
            signOut: async () => ({}),
          },
        }),
      };
      try {
        const expires = new Date(Date.now() + 80 * 86400000).toISOString();
        localStorage.setItem('lifecycle.auth.device.users', JSON.stringify({ '+919876543211': {
          id: seed.user, phone: '+919876543211', cc: '+91', local: '9876543211', name: 'Catalog',
          salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null, createdAt: expires, pinSetAt: expires,
        } }));
        localStorage.setItem('lifecycle.auth.session', JSON.stringify({
          token: 'DEVICEtokenCATALOG0123456789abcdefghijklmnopq', mode: 'device', provider: 'mobile-pin',
          user: { id: seed.user, name: 'Catalog', phone: '+919876543211' }, expires,
          storage: { mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' },
        }));
        const ns = 'lifecycle.brand.device.workspaces.' + seed.user;
        localStorage.setItem(ns, JSON.stringify(seed.brand ? { version: 1, active_id: seed.brand.id, workspaces: [seed.brand] } : { version: 1, active_id: '', workspaces: [] }));
        if (seed.catalog && seed.brand) localStorage.setItem(ns + '.catalog.' + seed.brand.id, JSON.stringify(seed.catalog));
      } catch (_) {}
    }, {
      user: DEVICE_USER,
      brand: state.brand ? Object.assign({}, state.brand, { id: DEVICE_ID, status: 'active', storage: 'device', owner_id: null }) : null,
      catalog: state.catalog ? { products: state.catalog, source: DELI_SOURCE, owned: true, region: 'in', imported_at: DELI_SOURCE.imported_at } : null,
    });
  }

  const api = {
    ok: true,
    brand: !state.brand ? null : state.kind === 'server' ? state.brand : Object.assign({}, state.brand, { id: DEVICE_ID }),
    workspaces: !state.brand ? [] : [state.kind === 'server' ? state.brand : Object.assign({}, state.brand, { id: DEVICE_ID })],
    active_id: !state.brand ? '' : state.kind === 'server' ? state.brand.id : DEVICE_ID,
    needs_onboarding: !state.brand,
    user: { id: 'u-catalog', email: 'catalog@example.test' },
    presets: [], products: state.kind === 'server' ? (state.catalog || []) : [], count: 0,
    entries: [], items: [], rows: [], campaigns: [], connections: [], providers: [], runs: [],
  };
  if (state.kind === 'device') {
    api.supabase = { url: 'https://live.supabase.co', anonKey: 'anon' };
    api.mode = 'device'; api.reason = 'no_database_url';
  }

  await page.route(/^https?:\/\//, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    // The brand's own photos (and, for tenant zero's positive control, its own
    // catalogue photos) answer as images; everything else off-site is refused.
    if (hostOf(u) === FIXTURE_HOST || (state.servePhotos && /cdn\.shopify\.com/.test(u))) {
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: PNG });
    }
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: esm
        ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};',
    });
  });
  await page.route(state.origin + '/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => {
    const u = new URL(route.request().url());
    // A case answers the ops it is about (the preset gallery, an import).
    const own = state.apiHook ? state.apiHook(u, route.request()) : null;
    if (own) return route.fulfill({ status: own.status || 200, contentType: 'application/json', body: JSON.stringify(own.body) });
    if (/action=auth/.test(u.search) && state.kind === 'device') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'device', reason: 'no_database_url', host: '' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(api) });
  });
  return seen;
}

/** Wait until the page's brand layer has settled on THIS brand. */
async function settle(page, slug) {
  await page.waitForFunction(() => !!window.BrandContext, null, { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => Promise.race([
    (window.BrandContext && window.BrandContext.ready) ? window.BrandContext.ready() : null,
    new Promise((r) => setTimeout(r, 15_000)),
  ])).catch(() => {});
  await page.waitForFunction((s) => {
    const b = window.BrandContext && window.BrandContext.brand;
    return !!b && String(b.slug || '').toLowerCase() === s;
  }, slug, { timeout: 8_000 }).catch(() => {});
  return page.evaluate(() => {
    const B = window.BrandContext;
    return B ? { slug: String((B.brand && B.brand.slug) || '').toLowerCase(), id: (B.brand && B.brand.id) || '' } : null;
  });
}

/** Every URL the rendered page points at: links, images, sources, inline backgrounds, iframes. */
const RENDERED_URLS = () => {
  const out = [];
  const read = (doc, where) => {
    if (!doc) return;
    doc.querySelectorAll('[href],[src],[srcset],[poster],[data-src],[action]').forEach((el) => {
      ['href', 'src', 'srcset', 'poster', 'data-src', 'action'].forEach((a) => {
        const v = el.getAttribute(a);
        if (v && !/^(data|blob|javascript):/i.test(v)) out.push({ where: where + ' ' + el.tagName.toLowerCase() + '[' + a + ']', url: v });
      });
    });
    doc.querySelectorAll('[style*="url("]').forEach((el) => {
      const m = String(el.getAttribute('style')).match(/url\(([^)]+)\)/g) || [];
      m.forEach((x) => out.push({ where: where + ' style', url: x.replace(/^url\(["']?|["']?\)$/g, '') }));
    });
  };
  read(document, 'page');
  document.querySelectorAll('iframe').forEach((f) => { try { read(f.contentDocument, 'iframe'); } catch (_) {} });
  return out;
};

/* ── 1. ad-campaigns.html: the page the operator reported ────────────────── */

const AD_TABS = [['google', 'g'], ['meta', 'm'], ['tiktok', 't']];

/** Press "Generate ad creatives" on every platform tab and read what came back. */
async function driveAds(page, origin, market) {
  await page.goto(origin + '/ad-campaigns.html#google', { waitUntil: 'domcontentloaded' });
  const out = {};
  for (const [tab, ch] of AD_TABS) {
    await page.click('.tab[data-tab="' + tab + '"]');
    if (market) await page.selectOption('#' + ch + '-market', market);
    await page.fill('#' + ch + '-name', 'Lunch special');
    await page.click('#' + ch + '-cre');
    await page.waitForFunction((c) => {
      const prev = document.getElementById(c + '-cre-prev');
      const btn = document.getElementById(c + '-cre');
      return prev && prev.querySelector('.cre-asset') && btn && !btn.disabled;
    }, ch, { timeout: 20_000 });
    out[tab] = await page.evaluate((c) => ({
      note: (document.getElementById(c + '-cre-note') || {}).textContent || '',
      sources: Array.from(document.querySelectorAll('#' + c + '-cre-prev .cre-asset')).map((a) => a.getAttribute('data-visual-source')),
      gaps: Array.from(document.querySelectorAll('#' + c + '-cre-prev .cre-asset-gap')).map((g) => g.textContent),
      images: Array.from(document.querySelectorAll('#' + c + '-cre-prev img')).map((i) => i.getAttribute('src').slice(0, 22)),
    }), ch);
  }
  return out;
}

test.describe('ad creatives use the active brand\'s own catalogue', () => {
  test('(a) a device brand with NO catalogue: no tenant-zero request, the marker on every creative', async ({ page }) => {
    const seen = await install(page, { kind: 'device', origin: 'http://app.example.test', brand: DELI });
    await page.goto('http://app.example.test/ad-campaigns.html#google', { waitUntil: 'domcontentloaded' });
    expect((await settle(page, 'deli-chic')).slug).toBe('deli-chic');
    const r = await driveAds(page, 'http://app.example.test');
    for (const [tab] of AD_TABS) {
      const said = r[tab];
      expect(said.images.length, tab + ': creatives were composed').toBeGreaterThan(0);
      expect(said.images.every((s) => s.startsWith('data:image/png')), tab + ': composed on a canvas').toBe(true);
      expect(said.sources.every((s) => s === 'none'), tab + ': no photo was used, got ' + said.sources).toBe(true);
      expect(said.note, tab).toContain('[DATA REQUIRED BEFORE LAUNCH: product image, Deli Chic, US]');
      expect(said.note, tab).not.toMatch(/Shopify catalog photos|real packaging/i);
      expect(said.gaps.length, tab + ': the marker rides each asset').toBe(said.images.length);
      expect(said.gaps.every((g) => /DATA REQUIRED BEFORE LAUNCH: product image, Deli Chic/.test(g))).toBe(true);
    }
    const bad = seen.map((u) => ({ u, why: zeroUrl(u) })).filter((x) => x.why);
    expect(bad, 'requests for tenant zero\'s catalogue, store or photos').toEqual([]);
    // Nothing reached the image model either: an invented picture of a product
    // nobody has photographed is a fabricated product image.
    expect(seen.filter((u) => /\/api\/ai\/image/.test(u))).toEqual([]);
  });

  test('(b) a device brand WITH its own imported catalogue: exactly its own photos, captioned as its own', async ({ page }) => {
    const seen = await install(page, { kind: 'device', origin: 'http://app.example.test', brand: DELI, catalog: DELI_ROWS });
    await page.goto('http://app.example.test/ad-campaigns.html#google', { waitUntil: 'domcontentloaded' });
    expect((await settle(page, 'deli-chic')).slug).toBe('deli-chic');
    const r = await driveAds(page, 'http://app.example.test', 'IN');
    for (const [tab] of AD_TABS) {
      const said = r[tab];
      expect(said.sources.every((s) => s === 'catalog'), tab + ': ' + said.sources + ' / ' + said.note).toBe(true);
      expect(said.note, tab).toContain('Deli Chic\'s own catalogue kept on this device');
      expect(said.note, tab).toContain('imported from its own website at delichic.example');
      expect(said.gaps, tab).toEqual([]);
    }
    const photos = seen.filter((u) => hostOf(u) === FIXTURE_HOST);
    expect(photos.length, 'the brand\'s own photos were loaded').toBeGreaterThan(0);
    expect(photos.every((u) => DELI_ROWS.some((row) => row.image_url === u)), 'only rows of its own catalogue').toBe(true);
    const bad = seen.map((u) => ({ u, why: zeroUrl(u) })).filter((x) => x.why);
    expect(bad).toEqual([]);
  });

  test('(b) an IN catalogue answers the US market too, said as filed under IN - never another brand\'s rows', async ({ page }) => {
    const seen = await install(page, { kind: 'device', origin: 'http://app.example.test', brand: DELI, catalog: DELI_ROWS });
    await page.goto('http://app.example.test/ad-campaigns.html#google', { waitUntil: 'domcontentloaded' });
    await settle(page, 'deli-chic');
    const r = await driveAds(page, 'http://app.example.test', 'US');
    expect(r.google.sources.every((s) => s === 'catalog')).toBe(true);
    expect(r.google.note).toContain('filed under IN');
    expect(seen.map(zeroUrl).filter(Boolean)).toEqual([]);
  });
});

/* ── 2. who is tenant zero is the SERVER's answer ─────────────────────────── */

const LOCAL = 'http://localhost:4599';

async function resolveIn(page, region) {
  return page.evaluate((r) => window.BrandCatalog.load(r).then((x) => ({
    source: x.source, n: x.products.length, reason: x.reason, described: window.BrandCatalog.describe(x),
    first: x.products[0] ? { img: x.products[0].img, url: window.BrandCatalog.productUrl(x.products[0], r) } : null,
  })), region);
}

test.describe('tenant zero is decided by the server, never by a slug', () => {
  test('positive control: the workspace the server stamps owns_shipped gets the shipped catalogue', async ({ page }) => {
    test.skip(!BUILT, 'no built catalogue on disk - run npm run build');
    const zero = Object.assign({}, ZERO, { id: '00000000-0000-4000-8000-000000000001', status: 'active', owns_shipped: true });
    const seen = await install(page, { kind: 'server', origin: LOCAL, brand: zero, servePhotos: true });
    await page.goto(LOCAL + '/ad-campaigns.html#google', { waitUntil: 'domcontentloaded' });
    expect((await settle(page, ZERO.slug)).slug).toBe(ZERO.slug);
    const got = await resolveIn(page, 'us');
    expect(got.source).toBe('shipped');
    expect(got.n).toBe(shippedRows('us').length);
    expect(got.first.url, 'a PDP link is the brand\'s own store').toMatch(new RegExp('^https://' + ZERO_HOSTS[0].replace(/\./g, '\\.')));
    expect(seen.some((u) => /\/data\/catalog\/products_us\.json/.test(u))).toBe(true);
    // And the ad composer uses it, captioned as tenant zero's own.
    await page.click('#g-cre');
    await page.waitForFunction(() => document.querySelector('#g-cre-prev .cre-asset') && !document.getElementById('g-cre').disabled, null, { timeout: 20_000 });
    const note = await page.textContent('#g-cre-note');
    expect(note).toContain(ZERO.name + '\'s own shipped catalogue');
  });

  test('a server workspace that merely CALLS itself tenant zero (slug, no server stamp) gets no shipped file', async ({ page }) => {
    const impostor = Object.assign({}, ZERO, { id: '00000000-0000-4000-8000-0000000000aa', status: 'active', owns_shipped: false });
    const seen = await install(page, { kind: 'server', origin: LOCAL, brand: impostor });
    await page.goto(LOCAL + '/ad-campaigns.html#google', { waitUntil: 'domcontentloaded' });
    expect((await settle(page, ZERO.slug)).slug).toBe(ZERO.slug);
    const got = await resolveIn(page, 'us');
    expect(got.source).not.toBe('shipped');
    expect(seen.filter((u) => /\/data\/catalog\//.test(u))).toEqual([]);
    expect(await page.evaluate(() => window.BrandContext.isTenantZero(window.BrandContext.brand))).toBe(false);
  });

  test('the KNICKGASM preset activated as a DEVICE brand is a template, not tenant zero: it owns what it imports', async ({ page }) => {
    // Deliberate: a brand on this device owns no shipped material, whatever its
    // slug (the server refuses a carried slug the same way, brand-runtime
    // carriedBrand). Its store feed is one import away on the setup page, and
    // that copy is its own, with its own provenance.
    const seen = await install(page, { kind: 'device', origin: 'http://app.example.test', brand: Object.assign({}, ZERO) });
    await page.goto('http://app.example.test/ad-campaigns.html#google', { waitUntil: 'domcontentloaded' });
    expect((await settle(page, ZERO.slug)).slug).toBe(ZERO.slug);
    const got = await resolveIn(page, 'us');
    expect(got.source).not.toBe('shipped');
    expect(seen.filter((u) => /\/data\/catalog\//.test(u))).toEqual([]);
    // ...and a brand renamed from that template keeps the slug, so the slug
    // could never have been the test.
    await page.evaluate(() => { const b = window.BrandContext.brand; b.name = 'Deli Chic'; });
    expect(await page.evaluate(() => window.BrandContext.isTenantZero(window.BrandContext.brand))).toBe(false);
  });
});

/* ── 3. the server stamps the answer the browser reads ───────────────────── */

test.describe('the server decides owns_shipped from the workspace, not the slug', () => {
  const core = () => require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
  const catalogServer = () => require(path.join(ROOT, 'api', '_shared', 'brand-catalog-server.js'));

  test('a workspace record carrying tenant zero\'s slug is undecided until the workspace rule answers', async () => {
    const cs = catalogServer();
    const ws = { id: '00000000-0000-4000-8000-0000000000aa', slug: ZERO.slug, name: ZERO.name };
    expect(cs.isTenantZeroBrand(ws)).toBeNull();
    expect(cs.isTenantZeroBrand(Object.assign({}, ws, { owns_shipped: false }))).toBe(false);
    expect(cs.isTenantZeroBrand(Object.assign({}, ws, { owns_shipped: true }))).toBe(true);
    // The shipped record itself (no id) is still tenant zero.
    expect(cs.isTenantZeroBrand(require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js')).defaultBrand())).toBe(true);
    // A tenant-zero data file is refused to the impostor record with no pinned scope.
    expect(cs.tenantZeroData('data/product-types.json', { brand: ws }).source).toBe('none');
  });

  test('resolve() hands the shipped catalogue only to the OLDEST workspace', async () => {
    const cs = catalogServer();
    const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
    const realFetch = global.fetch;
    process.env.SUPABASE_URL = 'https://proj.supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    const OLDEST = '00000000-0000-4000-8000-000000000001';
    // The oldest workspace's own record: tenant zero only when it IS tenant
    // zero's brand (2026-10-10, the live project's oldest was "Mamaearth").
    let oldestRecord = { id: OLDEST, name: ZERO.name, slug: ZERO.slug };
    global.fetch = async (url) => {
      const u = String(url);
      if (/brand_workspaces\?select=id&order=created_at\.asc/.test(u)) return new Response(JSON.stringify([{ id: OLDEST }]), { status: 200 });
      if (/brand_workspaces\?id=eq\./.test(u)) return new Response(JSON.stringify(u.includes(OLDEST) ? [oldestRecord] : []), { status: 200 });
      if (/brand_catalog_products/.test(u)) return new Response('[]', { status: 200 });
      throw new Error('unrouted ' + u);
    };
    try {
      const scope = require(path.join(ROOT, 'api', '_shared', 'workspace-scope.js'));
      scope.invalidate && scope.invalidate();
      const impostor = await cs.resolve({ brand: { id: '00000000-0000-4000-8000-0000000000aa', slug: ZERO.slug, name: ZERO.name } });
      expect(impostor.source).not.toBe('shipped');
      const zero = await cs.resolve({ brand: { id: OLDEST, slug: ZERO.slug, name: ZERO.name } });
      expect(zero.source).toBe('shipped');
      expect(await core().ownsShipped(OLDEST)).toBe(true);
      expect(await core().ownsShipped('00000000-0000-4000-8000-0000000000aa')).toBe(false);
      // The oldest workspace holding ANOTHER brand owns nothing of tenant zero's.
      oldestRecord = { id: OLDEST, name: 'Mamaearth', slug: 'food-for-thought', website: 'https://www.nike.in' };
      scope.invalidate && scope.invalidate();
      expect(await core().ownsShipped(OLDEST)).toBe(false);
      const other = await cs.resolve({ brand: { id: OLDEST, name: 'Mamaearth', slug: 'food-for-thought' } });
      expect(other.source).not.toBe('shipped');
    } finally {
      global.fetch = realFetch;
      for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  test('every background path reads the stamp: brandForWorkspace answers owns_shipped from the oldest workspace', async () => {
    const ws = require(path.join(ROOT, 'api', '_shared', 'workspace-scope.js'));
    const OLDEST = '00000000-0000-4000-8000-000000000001';
    const OTHER = '00000000-0000-4000-8000-0000000000bb';
    const realFetch = global.fetch;
    global.fetch = async (url) => {
      const u = String(url);
      if (/brand_workspaces\?select=id&order=created_at\.asc/.test(u)) return new Response(JSON.stringify([{ id: OLDEST }]), { status: 200 });
      const m = u.match(/brand_workspaces\?id=eq\.([^&]+)/);
      if (m) return new Response(JSON.stringify([{ id: decodeURIComponent(m[1]), slug: ZERO.slug, name: m[1] === OLDEST ? ZERO.name : 'Deli Chic' }]), { status: 200 });
      throw new Error('unrouted ' + u);
    };
    try {
      if (ws.invalidate) ws.invalidate();
      const env = { url: 'https://proj-b.supabase.test', key: 'service-key' };
      const other = await ws.brandForWorkspace(env, OTHER);
      const zero = await ws.brandForWorkspace(env, OLDEST);
      // The impostor carries tenant zero's slug, and is still not tenant zero.
      expect(other.slug).toBe(ZERO.slug);
      expect(other.owns_shipped).toBe(false);
      expect(zero.owns_shipped).toBe(true);
    } finally { global.fetch = realFetch; }
  });

  test('a generated slot links to ITS brand\'s store, or names the gap - never tenant zero\'s store', async () => {
    const sbp = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
    const deli = { id: 'ws-deli', slug: ZERO.slug, name: 'Deli Chic', owns_shipped: false,
      regions: [{ code: 'IN', home: true, store_url: 'https://delichic.example' }] };
    const links = sbp.__test_slotLinks({ market: 'IN', brand: deli, heroProduct: { title: 'Thali' } });
    for (const v of Object.values(links)) expect(String(v)).not.toMatch(/knickgasm/i);
    expect(links.store).toBe('https://delichic.example');
    // The row's own product page wins over a constructed one.
    expect(sbp.__test_productUrl({ title: 'Thali', product_url: 'https://delichic.example/p/thali' }, 'IN', deli)).toBe('https://delichic.example/p/thali');
    expect(sbp.__test_productUrl({ title: 'Thali', handle: 'thali' }, 'IN', deli)).toBe('https://delichic.example/products/thali');
    // No store on the record: the gap, in words, never another brand's store.
    const bare = { id: 'ws-bare', name: 'Bare Brand', owns_shipped: false };
    const gap = sbp.__test_slotLinks({ market: 'IN', brand: bare });
    expect(gap.pdp).toBe('[DATA REQUIRED BEFORE LAUNCH: region store URL, Bare Brand, IN]');
    expect(sbp.__test_productUrl({ title: 'X', handle: 'x' }, 'IN', bare)).toMatch(/^\[DATA REQUIRED BEFORE LAUNCH: region store URL, Bare Brand/);
    // A slot that names no brand and runs in no generation scope is nobody's.
    expect(JSON.stringify(sbp.__test_slotLinks({ market: 'US' }))).not.toMatch(/knickgasm/i);
    // Tenant zero (the server's stamp) keeps its own store.
    expect(sbp.__test_slotLinks({ market: 'US', brand: Object.assign({}, ZERO, { owns_shipped: true }) }).store).toMatch(/knickgasm/i);
  });

  test('the other generators decide by the stamp too: audio bed, /lp fallback, the assistant\'s links', async () => {
    const impostor = { id: 'ws-imp', slug: ZERO.slug, name: 'Deli Chic' };   // undecided: carries the slug only
    const bed = require(path.join(ROOT, 'api', '_shared', 'video-core.js')).audioBedFor(15, { brand: impostor });
    expect(bed.bed).toBeNull();
    expect(bed.origin).toMatch(/DATA REQUIRED BEFORE LAUNCH: brand audio bed/);
    const cs = require(path.join(ROOT, 'api', '_shared', 'brand-catalog-server.js'));
    // An undecided workspace record with no pinned catalogue gets none, never the shipped rows.
    expect(cs.productsFor('US', { brand: impostor }).source).toBe('none');
    // A pinned own catalogue whose rows state their product page is linked there.
    const row = { region: 'IN', sku: 's1', handle: 'thali', title: 'Thali', price: '120', image_url: 'https://cdn.delichic.test/thali.png', product_url: 'https://delichic.example/p/thali', workspace_id: 'ws-imp' };
    const deli = { id: 'ws-imp', name: 'Deli Chic', owns_shipped: false, regions: [{ code: 'IN', home: true, store_url: 'https://delichic.example' }] };
    const realFetch = global.fetch;
    const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
    process.env.SUPABASE_URL = 'https://proj-c.supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    global.fetch = async (url) => {
      const u = String(url);
      if (/brand_catalog_products/.test(u)) return new Response(JSON.stringify([row]), { status: 200 });
      if (/brand_workspaces\?select=id&order=created_at\.asc/.test(u)) return new Response(JSON.stringify([{ id: 'ws-oldest' }]), { status: 200 });
      throw new Error('unrouted ' + u);
    };
    try {
      await cs.withCatalog({ brand: deli, workspaceId: 'ws-imp' }, async () => {
        const lpOut = require(path.join(ROOT, 'api', '_shared', 'landing-fallback.js')).buildFallbackLanding({ id: 'x', region: 'in', hint: 'thali', brand: deli });
        expect(lpOut).toContain('https://delichic.example/p/thali');
        expect(lpOut).not.toMatch(/knickgasm/i);
        const out = require(path.join(ROOT, 'api', '_shared', 'brand-llm.js')).catalogProducts({ market: 'IN', brand: deli });
        expect(out.products.map((p) => p.url)).toEqual(['https://delichic.example/p/thali']);
      });
    } finally {
      global.fetch = realFetch;
      for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});

/* ── 4. EVERY page, both non-tenant-zero states ──────────────────────────── */

/** Every page: vercel.json's rewrite destinations plus every root *.html. */
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const ALL_PAGES = Array.from(new Set(
  (VERCEL.rewrites || []).map((r) => String(r.destination || '').split('?')[0].replace(/^\//, '')).filter((d) => /\.html$/.test(d))
    .concat(fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')))
)).filter((f) => fs.existsSync(path.join(ROOT, f))).sort();

const BRAND_LAYER = /<script[^>]+src=["']\/?(?:auth|brand-context)\.js/;
const hasBrandLayer = (f) => BRAND_LAYER.test(fs.readFileSync(path.join(ROOT, f), 'utf8'));

/** Pages that carry NO brand layer (neither auth.js nor brand-context.js): they
 *  cannot know which brand is active, so they are not a surface any brand is
 *  shown through, and none is offered in the rail. Each is named with the
 *  reason. A page here that gains a brand layer fails the first test below and
 *  joins the sweep. */
const NO_BRAND_LAYER = {
  '_sbtest.html': 'a developer probe of the Supabase client, no rail row',
  'ad-campaigns-master.html': 'a meta-refresh stub onto /data-analysis?tab=live-ads (vercel.json redirect)',
  'ads-masterclass.html': 'a static course page, no rail row',
  'coffee-collection-landing-no-agent.html': 'a generated tenant-zero landing artefact, no rail row',
  'coffee-collection-landing-with-agent.html': 'a generated tenant-zero landing artefact, no rail row',
  'data-analysis-contrast.html': 'a contrast fixture page, no rail row',
  'docs/deck.html': 'the platform deck (/deck), about the product, not a brand',
  'docs/prd-deck.html': 'the platform PRD deck (/prd-deck), about the product, not a brand',
  'knickgasm-grail-drop-presell-v5-variantA.html': 'a generated tenant-zero mailer artefact',
  'knickgasm-grail-drop-presell-v5-variantB.html': 'a generated tenant-zero mailer artefact',
  'knickgasm-lifecycle-campaign-from-the-30-d-us-variantB.html': 'a generated tenant-zero mailer artefact',
  'landing-pages/final/knickgasm-grail-drop-3d.html': 'tenant zero\'s final landing page (/lp/best-3d); the template gallery shows it only to tenant zero',
  'landing-pages/final/knickgasm-uk-grail-drop-agent-best.html': 'tenant zero\'s final landing page; the template gallery shows it only to tenant zero',
  'landing-pages/final/knickgasm-uk-presell-grail-drop-v1.html': 'tenant zero\'s final landing page; the template gallery shows it only to tenant zero',
  'landing-pages/final/knickgasm-uk-presell-grail-drop-v2.html': 'tenant zero\'s final landing page; the template gallery shows it only to tenant zero',
  'landing-pages/final/lp_all_in_one_agent_v2.html': 'tenant zero\'s final landing page; the template gallery shows it only to tenant zero',
  'lifecycle-usa-d2c-dashboard.html': 'a generated tenant-zero dashboard artefact (scripts/gen-demo-d2c-dashboard.js), no rail row',
  'mailer-discovery.html': 'a static research page, no rail row',
  'styleguide.html': 'the platform style guide, no rail row',
};
const SWEPT = ALL_PAGES.filter((f) => !NO_BRAND_LAYER[f]);

/** The product-rendering controls, pressed the way an operator presses them. */
const DRIVE = {
  'ad-campaigns.html': async (page, st) => { st.ads = await driveAds(page, st.origin, 'IN'); },
  'lifecycle_mailer_architect_v34.html': async (page, st) => {
    await page.evaluate(() => (window.studioCatalogReady ? window.studioCatalogReady() : null)).catch(() => {});
    await page.waitForTimeout(400);
    st.studio = await page.evaluate(() => ({
      rows: (window.CAT || []).length,
      imgs: Array.from(document.querySelectorAll('#catGrid img')).map((i) => i.getAttribute('src')),
      grid: ((document.getElementById('catGrid') || {}).textContent || '').slice(0, 400),
      // Where a mailer's links go: the store and a product page.
      base: typeof window.getBase === 'function' ? window.getBase('IN') : null,
      pdp: (typeof window.pdpUrl === 'function' && (window.CAT || [])[0]) ? window.pdpUrl(window.CAT[0], 'IN') : null,
    }));
  },
  'landing-page-agent.html': async (page, st) => {
    await page.fill('#prompt', 'A lunch special landing page: the product, the audience, the offer and the call to action for this brand.');
    await page.click('#generate');
    await page.waitForFunction(() => { const f = document.getElementById('frame'); return f && !f.hidden && f.srcdoc && f.srcdoc.length > 200; }, null, { timeout: 25_000 }).catch(() => {});
    st.lpa = await page.evaluate(() => { const f = document.getElementById('frame'); return f ? (f.srcdoc || '') : ''; });
  },
  'landing-pages.html': async (page) => {
    const tab = page.locator('#tabs .tab[data-tab="threed"]');
    if (await tab.count()) { await tab.first().click().catch(() => {}); await page.waitForTimeout(800); }
  },
  // The 3D storefront: either the brand's own store (its rows, its photos, its
  // links) or the DATA REQUIRED page - read once it has decided.
  'storefront-3d.html': async (page, st) => {
    // innerText, not textContent: textContent includes the page's own inline
    // <script> source, which spells the marker sentence out, so a store that
    // rendered its products still "had" the marker (2026-10-10).
    await page.waitForFunction(() => document.querySelector('#pGrid .pcard') || /No 3D storefront on the record/.test(document.body.innerText || ''), null, { timeout: 15_000 }).catch(() => {});
    st.store = await page.evaluate(() => ({
      marker: /No 3D storefront on the record/.test(document.body.innerText || ''),
      cards: Array.from(document.querySelectorAll('#pGrid .pcard')).map((a) => ({ href: a.getAttribute('href'), bg: ((a.querySelector('.im') || {}).getAttribute ? a.querySelector('.im').getAttribute('style') : '') || '' })),
      foot: Array.from(document.querySelectorAll('#footLinks a')).map((a) => a.getAttribute('href')),
    }));
  },
};

async function sweepState(page, state) {
  const seen = await install(page, state);
  const report = { pages: 0, findings: [], driven: {} };
  for (const f of SWEPT) {
    const before = seen.length;
    await page.goto(state.origin + '/' + f, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await settle(page, state.brand.slug);
    await page.waitForTimeout(700);
    const st = { origin: state.origin };
    if (DRIVE[f]) {
      try { await DRIVE[f](page, st); } catch (e) { report.findings.push(`${f}: the driver failed: ${e.message.split('\n')[0]}`); }
      report.driven[f] = st;
    }
    await page.waitForTimeout(300);
    const reqs = seen.slice(before);
    for (const u of reqs) { const why = zeroUrl(u); if (why) report.findings.push(`${f}: requested ${why}: ${u.slice(0, 140)}`); }
    const rendered = await page.evaluate(RENDERED_URLS).catch(() => []);
    for (const r of rendered) { const why = zeroUrl(r.url); if (why) report.findings.push(`${f}: rendered ${r.where} -> ${why}: ${r.url.slice(0, 140)}`); }
    if (st.lpa) {
      for (const m of st.lpa.match(/(?:href|src)="([^"]+)"/g) || []) {
        const u = m.replace(/^(?:href|src)="|"$/g, '');
        const why = zeroUrl(u); if (why) report.findings.push(`${f}: the generated landing page points at ${why}: ${u.slice(0, 140)}`);
      }
    }
    report.pages++;
  }
  return report;
}

test.describe('every page, under a brand that is not tenant zero', () => {
  test('the page set is the real one, and every page left out carries no brand layer', () => {
    expect(ALL_PAGES.length, 'pages enumerated from vercel.json + root').toBeGreaterThan(60);
    for (const f of Object.keys(NO_BRAND_LAYER)) {
      expect(ALL_PAGES, f + ' is listed but no longer exists').toContain(f);
      expect(hasBrandLayer(f), f + ' now carries a brand layer, so it is a brand surface: sweep it').toBe(false);
    }
    for (const f of ['ad-campaigns.html', 'lifecycle_mailer_architect_v34.html', 'storefront-3d.html', 'landing-pages.html', 'landing-page-agent.html', 'website-designs.html', 'premium-experience.html']) {
      expect(SWEPT, f + ' must be swept').toContain(f);
    }
  });

  test('(a) a device brand with NO catalogue: no page fetches or renders tenant zero\'s catalogue, store or photos', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const r = await sweepState(page, { kind: 'device', origin: 'http://app.example.test', brand: DELI });
    console.log(`swept ${r.pages} pages; drove ${Object.keys(r.driven).join(', ')}; ${r.findings.length} findings`);
    expect(r.pages).toBe(SWEPT.length);
    expect(r.findings).toEqual([]);
    // The product-rendering controls said what is missing, rather than nothing.
    const ads = r.driven['ad-campaigns.html'].ads;
    for (const [tab] of AD_TABS) expect(ads[tab].note, tab).toContain('[DATA REQUIRED BEFORE LAUNCH: product image, Deli Chic, IN]');
    expect(r.driven['lifecycle_mailer_architect_v34.html'].studio.rows).toBe(0);
    expect(r.driven['lifecycle_mailer_architect_v34.html'].studio.imgs).toEqual([]);
    expect(r.driven['lifecycle_mailer_architect_v34.html'].studio.base).toBe('https://delichic.example');
    expect(r.driven['landing-page-agent.html'].lpa).toContain('[DATA REQUIRED BEFORE LAUNCH: product image, Deli Chic');
    // No catalogue: the storefront is the marker page, not another brand's shelves.
    expect(r.driven['storefront-3d.html'].store.marker).toBe(true);
    expect(r.driven['storefront-3d.html'].store.cards).toEqual([]);
  });

  test('(b) a device brand WITH its own catalogue: no page reaches tenant zero, and the product controls show exactly its own photos', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const r = await sweepState(page, { kind: 'device', origin: 'http://app.example.test', brand: DELI, catalog: DELI_ROWS });
    console.log(`swept ${r.pages} pages; ${r.findings.length} findings`);
    expect(r.pages).toBe(SWEPT.length);
    expect(r.findings).toEqual([]);
    const ads = r.driven['ad-campaigns.html'].ads;
    for (const [tab] of AD_TABS) expect(ads[tab].sources.every((s) => s === 'catalog'), tab).toBe(true);
    const studio = r.driven['lifecycle_mailer_architect_v34.html'].studio;
    expect(studio.rows).toBe(DELI_ROWS.length);
    expect(studio.imgs.length).toBeGreaterThan(0);
    expect(studio.imgs.every((u) => DELI_ROWS.some((row) => row.image_url === u)), 'the Studio shows only its own photos: ' + studio.imgs).toBe(true);
    expect(DELI_ROWS.map((row) => row.product_url), 'a mailer links the row\'s own product page').toContain(studio.pdp);
    const lpa = r.driven['landing-page-agent.html'].lpa;
    expect(DELI_ROWS.some((row) => lpa.includes(row.image_url)), 'the landing page carries its own product photo').toBe(true);
    expect(lpa).toContain('https://delichic.example');
    // The storefront is the brand's own: its rows, its photos, its links.
    const store = r.driven['storefront-3d.html'].store;
    expect(store.marker).toBe(false);
    expect(store.cards.length).toBe(DELI_ROWS.length);
    expect(store.cards.map((c) => c.href).sort()).toEqual(DELI_ROWS.map((row) => row.product_url).sort());
    expect(store.cards.every((c) => DELI_ROWS.some((row) => c.bg.includes(row.image_url)))).toBe(true);
    expect(store.foot.filter((h) => /^https?:/.test(h)).every((h) => h.startsWith('https://delichic.example'))).toBe(true);
  });

  test('a brand whose record names no store links nowhere, never to tenant zero\'s store', async ({ page }) => {
    const bare = Object.assign({}, DELI, { website: '', regions: [{ code: 'IN', currency: 'INR', symbol: '₹', home: true }] });
    const seen = await install(page, { kind: 'device', origin: 'http://app.example.test', brand: bare, catalog: DELI_ROWS.map((row) => Object.assign({}, row, { product_url: '' })) });
    await page.goto('http://app.example.test/lifecycle_mailer_architect_v34.html', { waitUntil: 'domcontentloaded' });
    expect((await settle(page, 'deli-chic')).slug).toBe('deli-chic');
    await page.evaluate(() => (window.studioCatalogReady ? window.studioCatalogReady() : null));
    const got = await page.evaluate(() => ({ base: window.getBase('IN'), pdp: window.pdpUrl(window.CAT[0], 'IN'), store: window.BrandCatalog.storeBase('in') }));
    expect(got.store).toBe('');
    expect(zeroUrl(got.base), 'store base ' + got.base).toBe('');
    expect(zeroUrl(got.pdp), 'product link ' + got.pdp).toBe('');
    expect(got.base).toBe('#');
    expect(seen.map(zeroUrl).filter(Boolean)).toEqual([]);
  });
});

/* ── 5. the setup page says "import your store feed" ─────────────────────── */

test('a device brand made from a template is shown how to import ITS store feed, and the import reaches its pages', async ({ page }) => {
  const PRESET = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'knickgasm.json'), 'utf8'));
  const imports = [];
  const seen = await install(page, {
    kind: 'device', origin: 'http://app.example.test', brand: null,
    apiHook: (u, req) => {
      const op = u.searchParams.get('op');
      if (/action=brand/.test(u.search) && op === 'presets') {
        if (u.searchParams.get('slug')) return { body: { ok: true, preset: PRESET } };
        return { body: { ok: true, presets: [{ slug: PRESET.slug, name: PRESET.name, website: PRESET.website, palette: PRESET.palette, typography: PRESET.typography, industry: PRESET.industry }] } };
      }
      if (/action=brand/.test(u.search) && op === 'catalog-import') {
        imports.push(JSON.parse(req.postData() || '{}'));
        return { body: { ok: true, imported: DELI_ROWS.length, skipped: 0, region: 'in', storage: 'device', products: DELI_ROWS, source: { kind: 'shopify_public', url: 'https://knickgasm.com', region: 'in', row_count: DELI_ROWS.length } } };
      }
      return null;
    },
  });
  await page.goto('http://app.example.test/onboarding.html', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-preset="knickgasm"]').first().click({ timeout: 15_000 });
  await page.waitForFunction(() => /KNICKGASM/.test((document.querySelector('input[data-path="name"]') || {}).value || ''), null, { timeout: 10_000 }).catch(() => {});
  await page.click('.step-pip[data-step="5"]');
  const callout = page.locator('#storeFeed');
  await expect(callout).toBeVisible();
  await expect(callout).toContainText('started from a template');
  await expect(callout).toContainText('[DATA REQUIRED BEFORE LAUNCH: product image, KNICKGASM]');
  const btn = callout.locator('[data-import-store]');
  await expect(btn).toHaveAttribute('data-import-store', 'https://knickgasm.com');
  // Review says it too.
  await page.click('.step-pip[data-step="6"]');
  await expect(page.locator('#storeFeed')).toContainText('Import its own store feed (knickgasm.com)');
  // One button imports it, from review.
  await page.locator('#storeFeed [data-import-store]').click();
  await expect.poll(() => imports.length, { message: 'the import request left' }).toBe(1);
  expect(imports[0]).toMatchObject({ kind: 'storefront', url: 'https://knickgasm.com', region: 'in' });
  await expect(page.locator('#storeFeed')).toBeHidden();
  // The rows are kept beside the brand on this device and are what its pages read.
  const after = await page.evaluate(async () => {
    // The import saved the brand as a draft on this device; activating it is
    // what makes the app run as it (and what every page reads).
    const B = window.BrandContext;
    const id = (B.device.list().find((w) => /knickgasm/i.test(w.name || '')) || {}).id;
    await B.setActive(id);
    const r = await window.BrandCatalog.load('in');
    return { id, kept: (B.deviceCatalog(id) || { products: [] }).products.length, source: r.source, n: r.products.length, zero: B.isTenantZero(B.brand) };
  });
  expect(after.kept).toBe(DELI_ROWS.length);
  expect(after.zero).toBe(false);
  expect(after.source).toBe('device');
  expect(after.n).toBe(DELI_ROWS.length);
  // At no point did the template reach the shipped catalogue.
  expect(seen.filter((u) => /\/data\/catalog\//.test(u))).toEqual([]);
});

