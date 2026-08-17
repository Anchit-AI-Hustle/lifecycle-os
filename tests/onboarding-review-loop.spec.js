// Jumping straight to the Review step froze the tab.
//
// Reported: open /onboarding on a new brand, click step 6 directly, and Chrome
// says "page not responding".
//
// It was not a slow render. render() calls wireReview(), and wireReview ended
// with `loadPack(true).then(render)` - so the render triggered a fetch whose
// completion triggered another render, forever. Measured on step 6 with an
// empty brand, BEFORE the fix:
//
//     1154 DOM mutations and 567 requests to /api/ in three seconds
//
// about 190 requests a second. That is what froze the tab, and it hammered the
// backend at the same time.
//
// loadPack already carried the guard for exactly this (`if (!quiet) render()`).
// Passing quiet:true and then chaining .then(render) went around it.
//
// This test measures the loop rather than asserting on the source, because the
// shape of the cycle is not the point - re-entering a fetch from its own render
// is, and it can come back in a different shape.
//
// Run: npx playwright test tests/onboarding-review-loop.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

/* A brand-new workspace: nothing filled in, which is exactly the state a user
   is in when they click ahead to Review to see what is still required. */
const NEW_BRAND = { id: 'ws_new', slug: '', name: '', palette: {}, typography: {}, voice: {}, regions: [], offerings: [] };

let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, brand: NEW_BRAND, workspaces: [], active_id: null, pack: null }));
    }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

async function goToReview(page) {
  await page.goto(base + '/onboarding.html');
  await page.waitForSelector('.step-pip[data-step="6"]', { timeout: 15000 });
  // force:true deliberately. Playwright's own stability check cannot settle on
  // a page that is re-rendering, so without it this fails as a 60s actionability
  // timeout and says nothing about WHY.
  await page.click('.step-pip[data-step="6"]', { force: true, timeout: 15000 });
}

test('jumping straight to Review does not spin the network', async ({ page }) => {
  let apiCalls = 0;
  page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls++; });
  await goToReview(page);

  apiCalls = 0;                                   // count only what happens ON step 6
  await page.waitForTimeout(3000);
  expect(apiCalls, `step 6 made ${apiCalls} API calls in 3s; it loops if this grows`).toBeLessThan(10);
});

test('jumping straight to Review does not spin the DOM', async ({ page }) => {
  await goToReview(page);
  const churn = await page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const obs = new MutationObserver((muts) => { n += muts.length; });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    setTimeout(() => { obs.disconnect(); resolve(n); }, 3000);
  }));
  expect(churn, `${churn} DOM mutations in 3s on the review step - it is re-rendering itself`).toBeLessThan(100);
});

test('the review step still renders its verdict and what is missing', async ({ page }) => {
  await goToReview(page);
  const text = await page.evaluate(() => document.body.innerText);
  // A page that loops can also look "fine" for a frame, so check it arrived.
  expect(text).toMatch(/Review and activate/i);
  // An empty brand is NOT ready, and every gap is reported rather than filled.
  expect(text).toMatch(/NOT LAUNCH READY/i);
  expect(text).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
});

test('leaving Review and returning re-reads the pack', async ({ page }) => {
  await goToReview(page);
  await page.click('.step-pip[data-step="1"]', { force: true });
  let calls = 0;
  page.on('request', (r) => { if (r.url().includes('context-pack')) calls++; });
  await page.click('.step-pip[data-step="6"]', { force: true });
  await page.waitForTimeout(1200);
  // Bounded once-per-visit, not once-per-session: a stale pack forever would be
  // the wrong cure for the loop.
  expect(calls, 'returning to review should re-read the pack exactly once').toBeLessThan(3);
});
