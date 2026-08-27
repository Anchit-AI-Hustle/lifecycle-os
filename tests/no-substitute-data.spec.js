/**
 * A page with no data for this workspace renders an empty state that names the
 * gap. It never renders a substitute.
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS. The rule above was already guarded — by reading source:
 *
 *     expect(src).toMatch(/function renderEmpty\(/);
 *     expect(src).toMatch(/function codeGuardrails\(/);
 *     expect(src).toContain('DATA REQUIRED BEFORE LAUNCH: approved review library');
 *     expect(src).toContain('/brand-catalog.js');
 *
 * Every one of those passes on code that does not work. `renderEmpty` can be
 * emptied to `function renderEmpty(){}` and the page then shows a blank grid
 * with no reason. `codeGuardrails` can be changed to return a stored list and
 * the name still matches. The marker string passes while sitting in a COMMENT,
 * which is the exact defect this repo already found once in calendar-trigger —
 * a comment asserting a rule is not the rule being kept. And a `<script src>`
 * tag proves the file is requested, not that its resolver is what the products
 * came from.
 *
 * These drive the pages and read the DOM. The negative source checks that live
 * beside them in brand-asset-content.spec.js are deliberately left alone: "one
 * company's address must not appear in a file the browser downloads" is a claim
 * about the FILE, and a file check is the right tool for it.
 *
 * Run: npx playwright test tests/no-substitute-data.spec.js
 */
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

let server; let base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
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

/**
 * Serve the page with every third-party script neutralised and the plan
 * endpoint under this test's control.
 *
 * `plan` may be an object (returned as JSON) or the string 'fail', which aborts
 * the request the way a dead network does.
 */
async function openCalendar(page, plan) {
  // Counted, and asserted by every caller. See the note below on why.
  const served = { plan: 0 };
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({
    status: 200, contentType: 'text/javascript', body: 'window.tailwind = window.tailwind || {};',
  }));
  // ORDER MATTERS, and getting it wrong is silent. Playwright gives precedence
  // to the LAST matching route, so the broad /api/ catch-all must be registered
  // FIRST or it answers the plan request itself — which looks exactly like a
  // workspace with no sends, and made this file's first run "pass" the empty
  // state for entirely the wrong reason.
  await page.route(/\/api\//, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }),
  }));
  await page.route(/\/api\/calendar\?action=smart-brain-plan/, (route) => {
    served.plan += 1;
    return plan === 'fail' ? route.abort('failed')
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plan) });
  });
  await page.goto(base + '/daily-email-calendar.html', { waitUntil: 'domcontentloaded' });
  return served;
}

/**
 * Prove the fixture actually reached the page.
 *
 * This is not defensive padding. On this file's first run the catch-all above
 * answered the plan request, so the page saw `{ok:true}` — no entries — and
 * rendered the empty state. The empty-state test PASSED, on a page that had
 * never seen its fixture. It would have gone on passing if `renderEmpty` were
 * the only thing left working. A test whose setup silently did not happen is
 * the same defect class as a gate that inspects nothing.
 */
async function expectPlanWasServed(served) {
  // Polled, not read once: the page fetches the plan after DOMContentLoaded, so
  // a bare read here is a race that fails on a fast machine and passes on a slow
  // one — the least useful kind of test.
  await expect.poll(() => served.plan, {
    message: 'the plan fixture never reached the page',
    timeout: 10_000,
  }).toBeGreaterThan(0);
}

/* ═══ the daily email calendar ════════════════════════════════════════════ */

test('an empty plan renders a stated empty state, not a substitute calendar', async ({ page }) => {
  const served = await openCalendar(page, { entries: [] });
  await expectPlanWasServed(served);

  const grid = page.locator('#cal-grid');
  await expect(grid).toContainText('Nothing planned yet');
  // The REASON has to be on screen. An empty grid with no explanation reads as
  // a page that is still loading.
  await expect(grid).toContainText(/holds no email sends/i);
  await expect(page.locator('#kpis')).toContainText('No calendar for this workspace yet');
  await expect(page.locator('#count')).toHaveText('Showing 0 of 0 sends');

  // And nothing was substituted in its place.
  expect(await page.locator('#cal-grid .card').count()).toBe(0);
  expect(await page.locator('#rail').innerHTML()).toBe('');
});

test('a plan that could not be read says so instead of showing a calendar', async ({ page }) => {
  const served = await openCalendar(page, 'fail');
  await expectPlanWasServed(served);
  const grid = page.locator('#cal-grid');
  await expect(grid).toContainText('Nothing planned yet');
  await expect(grid).toContainText(/Could not read the plan/i);
  expect(await page.locator('#cal-grid .card').count()).toBe(0);
});

/*
 * The guardrails are the sharpest case. A stored promo-code list and a computed
 * one are indistinguishable by name; they differ only in whether the output
 * follows the input. So this feeds two different plans and asserts the chips
 * CHANGE.
 */
const planWithCodes = (codes) => ({
  entries: codes.map(([code, pct], i) => ({
    date: `2026-09-0${i + 1}`, market: 'US', channels: ['email'],
    cohort: { name: 'Segment ' + i, size: 1000 },
    heroProduct: { title: 'Item ' + i },
    offer: { code, pct },
  })),
});

test('discount guardrails are computed from this plan, not a stored list', async ({ page }) => {
  // DISCOUNT_CAP is 15: the 25% code is over it, the 10% one is not.
  await expectPlanWasServed(await openCalendar(page, planWithCodes([['SAVE10', 10], ['BIGDROP', 25]])));

  const banned = page.locator('#banned-chips');
  const safe = page.locator('#safe-chips');
  await expect(banned).toContainText('BIGDROP');
  await expect(banned).toContainText('25%');
  await expect(safe).toContainText('SAVE10');
  // Each code lands on exactly one side.
  await expect(safe).not.toContainText('BIGDROP');
  await expect(banned).not.toContainText('SAVE10');
});

test('a different plan produces different guardrails', async ({ page }) => {
  await expectPlanWasServed(await openCalendar(page, planWithCodes([['SPRING5', 5]])));
  await expect(page.locator('#safe-chips')).toContainText('SPRING5');
  // The codes from the other plan are absent — which a hardcoded list could
  // not manage, and which is the whole claim.
  await expect(page.locator('#banned-chips')).not.toContainText('BIGDROP');
  await expect(page.locator('#safe-chips')).not.toContainText('SAVE10');
});

/* ═══ the premium experience page ═════════════════════════════════════════ */

/**
 * Replace the catalogue resolver with one this test controls, and record that
 * it was asked. Routing the FILE (rather than setting window.BrandCatalog in an
 * init script) is deliberate: the real /brand-catalog.js would otherwise load
 * afterwards and overwrite the stub, and the test would silently be measuring
 * the real resolver against a dead API.
 */
async function openPremium(page, result) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({
    status: 200, contentType: 'text/javascript', body: 'window.tailwind = window.tailwind || {};',
  }));
  await page.route(/\/brand-catalog\.js/, (route) => route.fulfill({
    status: 200, contentType: 'text/javascript',
    body: `window.__CATALOG_ASKED = [];
           window.BrandCatalog = { load: function (m) {
             window.__CATALOG_ASKED.push(m);
             return Promise.resolve(${JSON.stringify(result)});
           } };`,
  }));
  await page.route(/\/api\//, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }),
  }));
  await page.goto(base + '/premium-experience.html', { waitUntil: 'domcontentloaded' });
}

test('with no approved reviews the marker is on the screen, not in a comment', async ({ page }) => {
  await openPremium(page, { products: [], source: 'none', reason: 'no catalogue for this workspace' });

  const quote = page.locator('#testiQuote');
  await expect(quote).toBeVisible();
  await expect(quote).toContainText('DATA REQUIRED BEFORE LAUNCH: approved review library');

  // Silence would read as a design choice, so the marker must be readable
  // rather than merely present in the DOM.
  const shown = await quote.evaluate((el) => getComputedStyle(el).visibility);
  expect(shown).toBe('visible');
});

test('products come from the catalogue resolver, for the page\'s own region', async ({ page }) => {
  await openPremium(page, {
    products: [
      { n: 'Resolver Hero', i: 'https://example.invalid/a.jpg', h: 'resolver-hero', price: '10' },
      { n: 'Resolver Second', i: 'https://example.invalid/b.jpg', h: 'resolver-second', price: '20' },
    ],
    source: 'brand',
  });

  // It was actually asked, and asked for a region.
  const asked = await page.evaluate(() => window.__CATALOG_ASKED || []);
  expect(asked.length, 'the catalogue resolver was never called').toBeGreaterThan(0);
  expect(asked[0]).toBeTruthy();

  // And what it returned is what rendered. A page that requested the file and
  // then drew something else would pass a <script src> check and fail this.
  await expect(page.locator('#mailer-sec')).toContainText('Resolver Hero');
});

test('an empty catalogue renders the reason rather than a stand-in product', async ({ page }) => {
  await openPremium(page, { products: [], source: 'none', reason: 'this brand has no catalogue rows' });
  await expect(page.locator('#mailer-sec')).toContainText(/no catalogue rows/i);
});
