/**
 * Brand deletion from the step-1 list (compact / multi-brand setup).
 *
 * After Switch Brand opened /onboarding?new=1 and step 1 gained the brand
 * list, Delete lived only on Review (step 6). Operators who never reach
 * Review could not remove a brand. confirmDeleteBrand() now serves both
 * lists; this drives the device path end-to-end.
 *
 * 2026-10-23: the name is confirmed in a panel under the row, never a native
 * prompt. On production (Chrome under remote debugging) window.prompt came
 * back null at once and Delete did nothing: no request, no sentence. Any
 * dialog now fails these tests.
 *
 * Run: npx playwright test tests/brand-delete-step1.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'http://app.example.test';
const DEVICE_KEY = 'lifecycle.brand.device.workspaces';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const KEEP = {
  id: 'local-keepbrand01', slug: 'keep-brand', name: 'Keep Brand', status: 'active',
  tagline: 'stays', industry: '', website: '', logo_url: '', favicon_url: '',
  palette: { primary: '#1a6b3c', accent: '#b8531f', ink: '#15201c', surface: '#fbfaf6', surface_alt: '#f3f0ea', muted: '#5a6270' },
  typography: {}, voice: {}, regions: [{ code: 'IN', currency: 'INR', home: true }],
  brand_data: {}, storage: 'device',
};
const DROP = {
  id: 'local-dropbrand02', slug: 'drop-brand', name: 'Drop Brand', status: 'draft',
  tagline: 'goes', industry: '', website: '', logo_url: '', favicon_url: '',
  palette: { primary: '#8B1E1E', accent: '#B45309', ink: '#1A1A1A', surface: '#FFFDF8', surface_alt: '#f7f3ef', muted: '#5a6270' },
  typography: {}, voice: {}, regions: [{ code: 'IN', currency: 'INR', home: true }],
  brand_data: {}, storage: 'device',
};

async function open(page) {
  const log = { prompts: [] };
  page.on('dialog', async (d) => {
    log.prompts.push({ type: d.type(), message: d.message() });
    await d.dismiss();
  });
  await page.addInitScript(({ key, keep, drop }) => {
    try {
      localStorage.setItem(key, JSON.stringify({
        version: 1, active_id: keep.id, workspaces: [keep, drop],
      }));
    } catch (_) {}
  }, { key: DEVICE_KEY, keep: KEEP, drop: DROP });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== HOST) {
      if (/\/auth\/v1\/health/.test(url.href)) return route.abort('addressunreachable');
      if (route.request().resourceType() === 'script') {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
      }
      return route.abort('failed');
    }
    if (url.pathname.startsWith('/api/')) {
      const action = url.searchParams.get('action');
      const op = url.searchParams.get('op');
      if (action === 'auth' && op === 'status') {
        return route.fulfill({
          json: { ok: true, mode: 'device', reason: 'no_database_url', message: 'No database is configured.' },
        });
      }
      if (url.pathname === '/api/public-config' && !action) {
        return route.fulfill({ json: { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } } });
      }
      if (action === 'brand' && (op === 'presets' || op === 'defaults')) {
        return route.fulfill({ json: { ok: true, presets: [], brand: null } });
      }
      return route.fulfill({ json: { ok: true, entries: [], features: [], items: [], unmetered: true } });
    }
    const file = path.join(ROOT, url.pathname.replace(/^\//, '') || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return route.fulfill({ status: 404, body: 'nf' });
    }
    return route.fulfill({
      status: 200,
      contentType: MIME[path.extname(file)] || 'application/octet-stream',
      body: fs.readFileSync(file),
    });
  });

  await page.goto(HOST + '/onboarding.html?new=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded && window.BrandContext.storage && window.BrandContext.storage().known, null, { timeout: 20000 });
  await page.waitForSelector('#step1Brands [data-ws]', { timeout: 15000 });
  return log;
}

test('step 1 lists Delete; confirming the name removes the brand from the device store', async ({ page }) => {
  const log = await open(page);
  await expect(page.locator('#step1Brands .ws')).toHaveCount(2);
  await expect(page.locator('#step1Brands [data-act="delete"]')).toHaveCount(2);

  await page.locator(`#step1Brands [data-ws="${DROP.id}"] [data-act="delete"]`).click();
  const panel = page.locator(`[data-delete-confirm="${DROP.id}"]`);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Drop Brand');
  await expect(panel).toContainText(/catalogue/i);
  const go = panel.locator('[data-del-go]');
  await expect(go).toBeDisabled();
  await panel.locator('[data-del-name]').fill('drop brand');   // case does not matter
  await expect(go).toBeEnabled();
  await go.click();

  await expect(page.locator('#step1Brands .ws')).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator(`#step1Brands [data-ws="${DROP.id}"]`)).toHaveCount(0);
  await expect(page.locator(`#step1Brands [data-ws="${KEEP.id}"]`)).toHaveCount(1);

  const stored = await page.evaluate((key) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }, DEVICE_KEY);
  expect(stored.workspaces.map((w) => w.id)).toEqual([KEEP.id]);
  expect(stored.active_id).toBe(KEEP.id);
  expect(log.prompts, 'a native dialog was opened').toEqual([]);
});

test('a mistyped confirm name deletes nothing', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.type()); await d.dismiss(); });
  await page.addInitScript(({ key, keep, drop }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, active_id: keep.id, workspaces: [keep, drop] }));
  }, { key: DEVICE_KEY, keep: KEEP, drop: DROP });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== HOST) {
      if (/\/auth\/v1\/health/.test(url.href)) return route.abort('addressunreachable');
      if (route.request().resourceType() === 'script') {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
      }
      return route.abort('failed');
    }
    if (url.pathname.startsWith('/api/')) {
      const action = url.searchParams.get('action');
      const op = url.searchParams.get('op');
      if (action === 'auth' && op === 'status') {
        return route.fulfill({ json: { ok: true, mode: 'device', reason: 'no_database_url' } });
      }
      if (url.pathname === '/api/public-config' && !action) {
        return route.fulfill({ json: { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } } });
      }
      if (action === 'brand' && (op === 'presets' || op === 'defaults')) {
        return route.fulfill({ json: { ok: true, presets: [], brand: null } });
      }
      return route.fulfill({ json: { ok: true, entries: [], features: [], items: [], unmetered: true } });
    }
    const file = path.join(ROOT, url.pathname.replace(/^\//, '') || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return route.fulfill({ status: 404, body: 'nf' });
    }
    return route.fulfill({
      status: 200,
      contentType: MIME[path.extname(file)] || 'application/octet-stream',
      body: fs.readFileSync(file),
    });
  });

  await page.goto(HOST + '/onboarding.html?new=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#step1Brands [data-ws]', { timeout: 15000 });
  await page.locator(`#step1Brands [data-ws="${DROP.id}"] [data-act="delete"]`).click();
  const panel = page.locator(`[data-delete-confirm="${DROP.id}"]`);
  await panel.locator('[data-del-name]').fill('Wrong Name');
  await expect(panel.locator('[data-del-go]')).toBeDisabled();
  await panel.locator('[data-del-name]').press('Enter');
  await panel.locator('[data-del-cancel]').click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('#step1Brands .ws')).toHaveCount(2);
  expect(dialogs).toEqual([]);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), DEVICE_KEY);
  expect(stored.workspaces).toHaveLength(2);
});
