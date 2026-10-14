// Easy multi-brand setup: the rail picker switches and adds brands; /onboarding?new=1
// starts a blank record instead of resuming the active brand.
//
// Before 2026-10-14 the only "+ Onboard another brand" control lived on
// onboarding step 6, so a person with one brand had to finish Review before
// they could start a second. The rail brand row was a label with no switcher.
//
// Run: npx playwright test tests/multi-brand-setup.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const core = require('../api/_shared/brand-workspace-core');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'http://brand.example.test';
const brands = {
  shoes: { id: 'ws-shoes', slug: 'shoe-fixture', name: 'Food For Thought', palette: { primary: '#C5A059', accent: '#75632f', surface: '#FFFDF8', ink: '#1A1A1A' } },
  deli: { id: 'ws-deli', slug: 'deli-chic', name: 'Deli Chic', industry: 'Food', logo_url: 'https://brand.example.test/chicken.svg', palette: { primary: '#8B1E1E', accent: '#B45309', surface: '#FFFDF8', ink: '#FFFFFF', muted: '#b4b0aa' } },
};
function payload(b) {
  return { ...core.shellPayload({ ...b, regions: [{ code: 'IN', currency: 'INR', home: true }] }), owns_shipped: false };
}

async function boot(page, pathName) {
  let active = 'shoes';
  await page.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: { access_token: 'fixture-google-token', expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: 'fixture-user', email: 'fixture@example.com', app_metadata: { provider: 'google' } } } } }),
      onAuthStateChange: () => ({}), signOut: async () => ({}), signInWithOAuth: async () => ({}),
    } }) };
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/chicken.svg') {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="red"/></svg>' });
    }
    if (url.origin !== HOST) return route.fulfill({ contentType: 'text/javascript', body: '' });
    const action = url.searchParams.get('action');
    if (url.pathname.startsWith('/api/')) {
      if (action === 'brand') {
        const op = url.searchParams.get('op');
        if (op === 'presets') return route.fulfill({ json: { ok: true, presets: [] } });
        if (op === 'activate') {
          const id = route.request().postDataJSON().id;
          active = id === 'ws-deli' ? 'deli' : 'shoes';
        }
        if (op === 'get') {
          const id = url.searchParams.get('id');
          const key = id === 'ws-deli' ? 'deli' : id === 'ws-shoes' ? 'shoes' : active;
          return route.fulfill({ json: { ok: true, brand: payload(brands[key]) } });
        }
        const brand = payload(brands[active]);
        return route.fulfill({
          json: {
            ok: true, brand,
            workspaces: Object.values(brands).map(payload),
            active_id: brands[active].id,
            needs_onboarding: false,
          },
        });
      }
      if (url.pathname === '/api/public-config' && !action) {
        return route.fulfill({ json: { supabase: { url: 'https://auth.example.com', anonKey: 'public' } } });
      }
      return route.fulfill({ json: { ok: true, entries: [], features: [], items: [], unmetered: true } });
    }
    const file = path.join(ROOT, url.pathname.replace(/^\//, '') || 'index.html');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return route.fulfill({
        contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html',
        body: fs.readFileSync(file),
      });
    }
    return route.fulfill({ body: '' });
  });
  await page.goto(HOST + pathName);
  await expect(page.locator('[data-brand-picker]').first()).toBeVisible({ timeout: 15000 });
  return { getActive: () => active };
}

test('the rail brand picker lists every brand, switches, and offers Add another brand', async ({ page }) => {
  await boot(page, '/smart-brain.html');
  await expect(page.locator('.lnav-brandname').first()).toHaveText('Food For Thought');
  await page.locator('[data-brand-picker]').first().click();
  const menu = page.locator('[data-brand-menu]').first();
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-brand-id]')).toHaveCount(2);
  await expect(menu.locator('.lnav-brandmenu-add')).toHaveAttribute('href', '/onboarding?new=1');
  await menu.locator('[data-brand-id="ws-deli"]').click();
  await expect(page.locator('.lnav-brandname').first()).toHaveText('Deli Chic');
  await expect(menu).toBeHidden();
});

test('/onboarding?new=1 starts a blank brand instead of reopening the active one', async ({ page }) => {
  await boot(page, '/onboarding.html?new=1');
  await expect(page.locator('#title')).toContainText('Onboard a brand', { timeout: 15000 });
  await expect(page.locator('[data-path="name"]')).toHaveValue('');
  await expect(page.locator('#step1Brands .ws')).toHaveCount(2);
  await expect(page.locator('#newBrandStep1')).toBeVisible();
  // Compact setup put brand management on step 1; Delete must be here too
  // (it used to live only on Review).
  await expect(page.locator('#step1Brands [data-act="delete"]')).toHaveCount(2);
});
