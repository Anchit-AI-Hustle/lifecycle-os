// Brand-scoped working state — switching brands must not inherit the previous
// brand's numbers.
//
// Every page in this suite hands state to the next one through localStorage:
// the analytics the dashboard passes to the calendar and on to the studio, the
// approved slots, the ad set, the currency. Under a flat key, switching brands
// showed the PREVIOUS brand's data under the new brand's name, which is the
// most convincing kind of wrong because every label is correct.
//
// Run: npx playwright test tests/brand-scoped-state.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

function brandPayload(id, name) {
  return {
    ok: true,
    brand: {
      id, slug: name.toLowerCase(), name,
      palette: { primary: '#1F4E79', accent: '#C8102E', ink: '#1A1A1A', surface: '#FFFFFF' },
      typography: { heading: { family: 'Inter' }, body: { family: 'Inter' } },
      voice: {}, regions: [{ code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://x.example' }],
    },
    workspaces: [],
  };
}

let server;
let base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});

test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

/** Load any page that pulls in brand-context.js, with a brand already painted. */
async function open(page, brandId, brandName) {
  await page.route('**/api/public-config**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(brandPayload(brandId, brandName)),
  }));
  await page.goto(base + '/about.html', { waitUntil: 'load' });
  // LCStore exists as soon as the IIFE ends, but the brand arrives from an
  // async fetch. Asserting before it lands measures the signed-out case, where
  // keys are deliberately unscoped, and the test would prove nothing.
  await page.waitForFunction(() => !!window.LCStore);
  await page.waitForFunction(
    (id) => !!(window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.id === id),
    brandId,
    { timeout: 5000 },
  );
}

test('LCStore is exposed to every page that loads brand-context', async ({ page }) => {
  await open(page, 'ws_a', 'Alpha');
  const api = await page.evaluate(() => ({
    store: typeof window.LCStore,
    get: typeof window.LCStore.get,
    set: typeof window.LCStore.set,
    remove: typeof window.LCStore.remove,
    onContext: typeof (window.BrandContext && window.BrandContext.store),
  }));
  expect(api).toEqual({ store: 'object', get: 'function', set: 'function', remove: 'function', onContext: 'object' });
});

test('two brands do not see each other\'s stored state', async ({ page }) => {
  // A real brand switch, not a simulated one. Reassigning the exported getter
  // would not work: activeId() closes over the module's own `state`, so the
  // page has to be reloaded with a different brand the way switching actually
  // does it. localStorage survives the reload, which is the whole point.
  const KEY = 'knickgasm-retention-data';

  await open(page, 'ws_a', 'Alpha');
  await page.evaluate((k) => window.LCStore.set(k, 'ALPHA-NUMBERS'), KEY);
  const asA = await page.evaluate((k) => ({
    value: window.LCStore.get(k),
    keys: Object.keys(localStorage).filter((x) => x.indexOf(k) === 0),
  }), KEY);

  expect(asA.value).toBe('ALPHA-NUMBERS');
  // The stored key carries the workspace id, so it cannot collide across brands.
  expect(asA.keys.length).toBeGreaterThan(0);
  expect(asA.keys.every((k) => k.includes('::ws_a'))).toBeTruthy();

  // Switch to brand B.
  await open(page, 'ws_b', 'Beta');
  const asB = await page.evaluate((k) => {
    const before = window.LCStore.get(k);
    window.LCStore.set(k, 'BETA-NUMBERS');
    return { before, after: window.LCStore.get(k) };
  }, KEY);

  expect(asB.before, 'brand B inherited brand A\'s figures').not.toBe('ALPHA-NUMBERS');
  expect(asB.after).toBe('BETA-NUMBERS');

  // Back to A: its own value must be intact, not overwritten by B.
  await open(page, 'ws_a', 'Alpha');
  const backToA = await page.evaluate((k) => window.LCStore.get(k), KEY);
  expect(backToA).toBe('ALPHA-NUMBERS');
});

test('state saved before scoping existed is inherited once, then left alone', async ({ page }) => {
  await open(page, 'ws_a', 'Alpha');

  const result = await page.evaluate(() => {
    // A value written by the old, unscoped code path.
    localStorage.setItem('knickgasm-cal-approved', 'LEGACY');
    const inherited = window.LCStore.get('knickgasm-cal-approved');

    // Writing goes to the scoped key; the legacy value is never written back.
    window.LCStore.set('knickgasm-cal-approved', 'NEW');
    return {
      inherited,
      scoped: window.LCStore.get('knickgasm-cal-approved'),
      legacyUntouched: localStorage.getItem('knickgasm-cal-approved'),
    };
  });

  expect(result.inherited).toBe('LEGACY');   // upgrade does not throw the user's work away
  expect(result.scoped).toBe('NEW');         // the scoped key wins once written
  expect(result.legacyUntouched).toBe('LEGACY');
});
