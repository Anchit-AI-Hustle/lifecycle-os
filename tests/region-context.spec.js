// One active region, shared by every page.
//
// Region selection was on 17 of 66 pages in six different shapes, none of which
// shared the choice. Picking UK on the calendar and moving to the studio put
// you back on US without saying so, which is how a UK campaign ends up carrying
// US prices. Eight further pages consumed a market and never offered a picker.
//
// Run: npx playwright test tests/region-context.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

function brandPayload(regions, name) {
  return {
    ok: true,
    brand: {
      id: 'ws_' + String(name).toLowerCase(), slug: String(name).toLowerCase(), name,
      palette: { primary: '#1F4E79', accent: '#C8102E', ink: '#1A1A1A', surface: '#FFFFFF' },
      typography: { heading: { family: 'Inter' }, body: { family: 'Inter' } },
      voice: {}, regions,
    },
    workspaces: [],
  };
}

const UK_US = [
  { code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://uk.example' },
  { code: 'US', currency: 'USD', symbol: '$', store_url: 'https://us.example' },
];

let server; let base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

/** Load a page with a brand painted and the region layer booted. */
async function open(page, regions, name) {
  await page.route('**/api/public-config**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(brandPayload(regions, name || 'Acme')),
  }));
  await page.goto(base + '/about.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.RegionContext);
  await page.waitForFunction(() => window.RegionContext.loaded === true, null, { timeout: 5000 });
}

test('the market list is the BRAND\'s own, not a hardcoded map', async ({ page }) => {
  // A brand that sells only in the UK must not be offered a US market it does
  // not serve: a generator asked for that store URL has nothing to return.
  await open(page, [{ code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://uk.example' }], 'UKOnly');
  const codes = await page.evaluate(() => window.RegionContext.regions.map((r) => r.code));
  expect(codes).toEqual(['UK']);
  expect(await page.evaluate(() => window.RegionContext.region)).toBe('UK');
});

test('a market the brand does not serve is refused, not stored', async ({ page }) => {
  await open(page, UK_US, 'Acme');
  const out = await page.evaluate(() => ({
    accepted: window.RegionContext.setActive('US'),
    refused: window.RegionContext.setActive('ZZ'),
    current: window.RegionContext.region,
  }));
  expect(out.accepted).toBe(true);
  expect(out.refused).toBe(false);
  expect(out.current).toBe('US');    // the bad value did not displace the good one
});

test('the choice travels between pages', async ({ page }) => {
  // The whole point. Picking a market must survive navigation, or a campaign
  // silently reverts to a market it was not built for.
  await open(page, UK_US, 'Acme');
  await page.evaluate(() => window.RegionContext.setActive('US'));

  await page.goto(base + '/brand.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded === true, null, { timeout: 15000 });
  expect(await page.evaluate(() => window.RegionContext.region)).toBe('US');
});

test('a market choice does not leak across a brand switch', async ({ page }) => {
  // IN is not a market every brand has, so carrying it across would put the app
  // in a market the new brand has no store URL or currency for.
  await open(page, [
    { code: 'IN', currency: 'INR', symbol: '₹', store_url: 'https://in.example' },
    { code: 'US', currency: 'USD', symbol: '$', store_url: 'https://us.example' },
  ], 'BrandOne');
  await page.evaluate(() => window.RegionContext.setActive('IN'));

  // A different brand, which does not serve IN at all.
  await open(page, [{ code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://uk.example' }], 'BrandTwo');
  expect(await page.evaluate(() => window.RegionContext.region)).toBe('UK');
});

test('the picker renders as one sliding row and drives the choice', async ({ page }) => {
  await open(page, UK_US, 'Acme');
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'rgn-test';
    document.body.appendChild(host);
    window.RegionContext.mount(host);
  });

  await expect(page.locator('#rgn-test .rgn-chip')).toHaveCount(2);
  // Standing rule: a nav bar is one row that slides, never wrapped.
  const wrap = await page.evaluate(() => getComputedStyle(document.getElementById('rgn-test')).flexWrap);
  expect(wrap).toBe('nowrap');

  await page.locator('#rgn-test [data-region-set="US"]').click();
  await expect(page.locator('#rgn-test [data-region-set="US"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rgn-test [data-region-set="UK"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.RegionContext.region)).toBe('US');
});

test('a single-region brand gets a statement, not a dead control', async ({ page }) => {
  await open(page, [{ code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://uk.example' }], 'UKOnly');
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'rgn-solo';
    document.body.appendChild(host);
    window.RegionContext.mount(host);
  });
  await expect(page.locator('#rgn-solo .rgn-chip')).toHaveCount(0);
  await expect(page.locator('#rgn-solo .rgn-solo')).toContainText('United Kingdom');
});

test('a brand with no region configured says so rather than inventing one', async ({ page }) => {
  await open(page, [], 'NoRegions');
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'rgn-none';
    document.body.appendChild(host);
    window.RegionContext.mount(host);
  });
  await expect(page.locator('#rgn-none .rgn-none')).toContainText('No market is configured');
  expect(await page.evaluate(() => window.RegionContext.region)).toBe('');
});

test('a page that never asked for a picker still gets one, in the shared rail', async ({ page }) => {
  // The complaint this answers: region selection was on 17 of 66 pages, so the
  // other 49 rendered SOME market without ever saying which or letting you
  // change it. The slot lives in auth.js's rail, so presence is a property of
  // the shell rather than of whether a page author remembered.
  await open(page, UK_US, 'Acme');
  const slot = page.locator('#lifecycle-nav .lnav-region');
  await expect(slot).toHaveCount(1);
  await expect(slot.locator('.rgn-chip')).toHaveCount(2);

  await slot.locator('[data-region-set="US"]').click();
  expect(await page.evaluate(() => window.RegionContext.region)).toBe('US');
});

test('mounting the same slot twice does not stack repaint listeners', async ({ page }) => {
  // The rail re-renders when auth resolves, so mount() genuinely runs more than
  // once on the same node. Each call used to add another onChange listener.
  await open(page, UK_US, 'Acme');
  const chips = await page.evaluate(() => {
    const host = document.querySelector('#lifecycle-nav .lnav-region');
    window.RegionContext.mount(host);
    window.RegionContext.mount(host);
    window.RegionContext.setActive('US');
    return host.querySelectorAll('.rgn-chip').length;
  });
  expect(chips).toBe(2);
});

test('the active chip stays legible whatever the brand palette is', async ({ page }) => {
  // A light primary with hardcoded white text is invisible. The chip takes its
  // colour from --brand-on-primary, which is contrast-computed per brand.
  await open(page, UK_US, 'Acme');
  const css = fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8');
  const rule = css.slice(css.indexOf('.rgn-chip[aria-pressed="true"]'));
  expect(rule.slice(0, 200)).toContain('var(--brand-on-primary');
  expect(rule.slice(0, 200)).not.toMatch(/color\s*:\s*#fff\b/);
});
