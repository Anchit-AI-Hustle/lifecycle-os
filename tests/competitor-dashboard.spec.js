// Competitor Benchmarking (competitor-benchmarking.html) — the Discover tab.
//
// The bug this guards is a real one that shipped: the page asked the API for
// its brand universe, the API tried to open a Google Sheet it had no credential
// for, and the operator was shown "0 brands, target ~250" over a raw
// "Google auth not configured" error. Two things must hold now:
//
//   * an empty universe reads as an empty universe, with the brand's own next
//     step, and never as a credentials failure;
//   * a run that adds nothing because the brand's record names nobody shows the
//     DATA REQUIRED gap, because the alternative is a list of invented names.
//
// The API is stubbed here rather than called: this test is about what the page
// does with each answer. tests/competitor-universe.spec.js covers the answers.
//
// Run: npx playwright test tests/competitor-dashboard.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

// A brand that is NOT tenant zero, so anything sneaker-shaped on the page would
// be a leak rather than a coincidence.
const BRAND = {
  id: 'ws-test-1', slug: 'northwind-press', name: 'Northwind Press',
  industry: 'Regional news publishing', website: 'https://zzq-northwind-press.com',
  status: 'active', palette: { primary: '#2F5D50', ink: '#111111', surface: '#FFFFFF' },
  typography: {}, voice: {}, regions: [{ code: 'UK', currency: 'GBP' }], tokens: {}, fonts_href: '',
};

let server, base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

/**
 * Open the Discover tab with the competitor API answering `handlers`, keyed by
 * ?action=. Anything not listed answers with an empty ok payload, so a new
 * background call cannot fail a test about this one panel.
 */
async function openDiscover(page, handlers) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));

  // Registered broadest-first on purpose: Playwright matches the route
  // registered LAST, so the specific handlers have to come after the catch-all.
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**/api/public-config**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, brand: BRAND, needs_onboarding: false, workspaces: [BRAND], user: { id: 'u1', email: 't@example.com' } }),
  }));
  await page.route('**/api/competitor**', (route) => {
    const action = new URL(route.request().url()).searchParams.get('action') || 'list';
    const body = (handlers && handlers[action]) || { ok: true, emails: [], brands: [], rows: [], groups: [], subscriptions: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto(base + '/competitor-benchmarking.html#discover', { waitUntil: 'load' });
  await expect(page.locator('#brands-view')).toBeVisible({ timeout: 20000 });
  return errors;
}

test('an empty universe reads as empty, never as a credentials error', async ({ page }) => {
  const errors = await openDiscover(page, { brands: { ok: true, brands: [], total: 0, gaps: [] } });

  await expect(page.locator('#bd-count')).toHaveText('No competitors tracked yet');
  await expect(page.locator('#bd-empty')).toBeVisible();

  // The old failure mode, in the operator's own words.
  const text = await page.locator('#brands-view').innerText();
  expect(text).not.toMatch(/Google auth|GOOGLE_SERVICE_ACCOUNT|WORKLOAD_IDENTITY/i);
  // And no invented target to measure an honest empty state against.
  expect(text).not.toContain('target ~');
  expect(errors).toEqual([]);
});

test('a seed run that finds nothing in the record reports the gap, not a list', async ({ page }) => {
  const gap = '[DATA REQUIRED BEFORE LAUNCH: competitor set, Northwind Press, UK]';
  const errors = await openDiscover(page, {
    brands: { ok: true, brands: [], total: 0, gaps: [] },
    seed: {
      ok: true, added: 0, total: 0, gaps: [gap],
      notes: ['Northwind Press has no competitors in its own record.'],
      status_line: 'NOT LAUNCH READY - DATA DEPENDENCY',
    },
  });

  await page.locator('#bd-seed').click();
  await expect(page.locator('#bd-status')).toContainText('DATA REQUIRED BEFORE LAUNCH', { timeout: 15000 });
  await expect(page.locator('#bd-status')).toContainText('Northwind Press');
  // Still empty: a gap is reported, nothing is conjured to fill the table.
  await expect(page.locator('#bd-rows tr')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the table shows this brand\'s competitors and counts what is verified', async ({ page }) => {
  const errors = await openDiscover(page, {
    brands: {
      ok: true, total: 2, brands: [
        { id: '1', brandName: 'Harbour Media', domain: 'zzq-harbour-media.com', websiteUrl: 'https://zzq-harbour-media.com', category: 'Regional news publishing', country: 'UK', positioning: '', verification: 'verified', subscriptionStatus: 'Not subscribed' },
        { id: '2', brandName: 'Fenwick Post', domain: '', websiteUrl: '', category: 'Regional news publishing', country: 'UK', positioning: '', verification: 'unverified', subscriptionStatus: 'Not subscribed' },
      ],
    },
  });

  await expect(page.locator('#bd-rows tr')).toHaveCount(2);
  await expect(page.locator('#bd-count')).toContainText('2 competitors tracked');
  // The count is what is known, split by what has been checked.
  await expect(page.locator('#bd-count')).toContainText('1 with a verified site');
  await expect(page.locator('#bd-empty')).toBeHidden();

  // Nothing from any other tenant reached this brand's screen.
  const text = await page.locator('#bd-rows').innerText();
  expect(text.toLowerCase()).not.toMatch(/knickgasm|sneaker|moreiarty|vegnonveg/);
  expect(errors).toEqual([]);
});

test('an unresolved workspace shows nothing rather than somebody else\'s universe', async ({ page }) => {
  const errors = await openDiscover(page, {
    brands: { ok: true, brands: [], total: 0, error: 'workspace_unresolved', note: 'No active brand on this request.' },
  });

  await expect(page.locator('#bd-empty')).toBeVisible();
  await expect(page.locator('#bd-rows tr')).toHaveCount(0);
  expect(errors).toEqual([]);
});
