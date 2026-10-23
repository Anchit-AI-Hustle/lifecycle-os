/**
 * Every question the app asks is answered in the page (2026-10-23).
 *
 * window.confirm / window.prompt come back at once, with no dialog, in a
 * browser under remote debugging, an embedded view or with dialogs blocked.
 * On production that made Delete brand do nothing. auth.js now offers
 * LifecycleDialog.confirm / .prompt, and the pages that asked natively use it.
 * Executed in Chromium; any native dialog fails a test.
 *
 * Run: npx playwright test tests/in-page-dialogs.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'http://app.example.test';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function serve(page, dialogs) {
  page.on('dialog', async (d) => { dialogs.push(d.type()); await d.dismiss(); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== HOST) {
      if (route.request().resourceType() === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
      return route.abort('failed');
    }
    if (url.pathname.startsWith('/api/')) {
      const action = url.searchParams.get('action'); const op = url.searchParams.get('op');
      if (action === 'auth' && op === 'status') return route.fulfill({ json: { ok: true, mode: 'device', reason: 'no_database_url' } });
      if (url.pathname === '/api/public-config' && !action) return route.fulfill({ json: { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } } });
      return route.fulfill({ json: { ok: true, entries: [], items: [], features: [], unmetered: true } });
    }
    const file = path.join(ROOT, url.pathname.replace(/^\//, '') || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
}

test('LifecycleDialog asks in the page: OK, Cancel, Escape and typed text resolve as a person answered', async ({ page }) => {
  const dialogs = [];
  await serve(page, dialogs);
  await page.goto(HOST + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.LifecycleDialog, null, { timeout: 15000 });

  let p = page.evaluate(() => window.LifecycleDialog.confirm('Delete this entry?', { ok: 'Delete', danger: true }));
  await expect(page.locator('[data-lc-dialog="confirm"]')).toContainText('Delete this entry?');
  await page.locator('[data-lc-dialog-ok]').click();
  expect(await p).toBe(true);
  await expect(page.locator('[data-lc-dialog]')).toHaveCount(0);

  p = page.evaluate(() => window.LifecycleDialog.confirm('Again?'));
  await page.locator('[data-lc-dialog-cancel]').click();
  expect(await p).toBe(false);

  p = page.evaluate(() => window.LifecycleDialog.confirm('Escape?'));
  await page.keyboard.press('Escape');
  expect(await p).toBe(false);

  p = page.evaluate(() => window.LifecycleDialog.prompt('Why?', ''));
  await page.locator('[data-lc-dialog-input]').fill('the segment is stale');
  await page.keyboard.press('Enter');
  expect(await p).toBe('the segment is stale');

  p = page.evaluate(() => window.LifecycleDialog.prompt('Why?', 'x'));
  await page.keyboard.press('Escape');
  expect(await p).toBeNull();
  expect(dialogs).toEqual([]);
});

test('the dashboard\'s Clear all data asks in the page, and Cancel keeps the data', async ({ page }) => {
  const dialogs = [];
  await serve(page, dialogs);
  await page.goto(HOST + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.LifecycleDialog && !!document.getElementById('btnResetSeed'), null, { timeout: 15000 });
  await page.evaluate(() => document.getElementById('btnResetSeed').click());
  await expect(page.locator('[data-lc-dialog="confirm"]')).toContainText('Clear all data?');
  await page.locator('[data-lc-dialog-cancel]').click();
  await expect(page.locator('[data-lc-dialog]')).toHaveCount(0);
  expect(dialogs).toEqual([]);
});
