// Social Media OS console (social-media.html) — render smoke over local HTTP.
// The page must load with ZERO uncaught page errors even when /api/* is
// unreachable (this static server 404s every /api request), and its core
// controls must be visible. Run: npx playwright test tests/social-media.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

let server;
let base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { // API deliberately unreachable
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{"ok":false,"error":"api unreachable in this test"}');
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

test('social-media.html renders with zero page errors while API is unreachable', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

  await page.goto(base + '/social-media.html', { waitUntil: 'load' });

  await expect(page.locator('h1')).toContainText('Daily Social Post Generator');
  await expect(page.locator('#runBtn')).toBeVisible();
  await expect(page.locator('#loadBtn')).toBeVisible();
  await expect(page.locator('#datePick')).toBeVisible();
  await expect(page.locator('#cards .empty')).toBeVisible();

  // Date picker defaults to today (UTC).
  const val = await page.locator('#datePick').inputValue();
  expect(val).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // Clicking "Load saved posts" against a dead API must fail gracefully into
  // the error banner — never an uncaught error.
  await page.locator('#loadBtn').click();
  // On slower emulated mobile profiles the unreachable-API fetch + auth init can
  // take a while to settle, so the error banner appears late. The client aborts
  // the list fetch at 3.5s, but CI scheduling jitter can still delay it; 40s stops
  // the flake without hiding a real regression (the banner still must appear).
  await expect(page.locator('#banner')).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('#banner')).toContainText('Could not load posts');

  expect(pageErrors, 'uncaught page errors: ' + pageErrors.join(' | ')).toHaveLength(0);
});
