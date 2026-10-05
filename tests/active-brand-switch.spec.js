const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const core = require('../api/_shared/brand-workspace-core');
const ROOT = path.resolve(__dirname, '..');
const HOST = 'http://brand.example.test';
const brands = {
  shoes: { id: 'ws-shoes', slug: 'shoe-fixture', name: 'Food For Thought', palette: { primary: '#C5A059', accent: '#75632f', surface: '#FFFDF8', ink: '#1A1A1A' } },
  deli: { id: 'ws-deli', slug: 'deli-chic', name: 'Deli Chic', industry: 'Food', logo_url: 'https://brand.example.test/chicken.svg', palette: { primary: '#8B1E1E', accent: '#B45309', surface: '#FFFDF8', ink: '#1A1A1A', muted: '#b4b0aa' } },
};
function payload(b) { return { ...core.shellPayload({ ...b, regions: [{ code: 'IN', currency: 'INR', home: true }] }), owns_shipped: false }; }

async function boot(page) {
  let active = 'shoes';
  let hold = false, release;
  let started;
  const held = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { started = resolve; });
  await page.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: { access_token: 'fixture-google-token', user: { id: 'fixture-user', email: 'fixture@example.com' } } } }),
      onAuthStateChange: () => ({}), signOut: async () => ({}), signInWithOAuth: async () => ({}),
    } }) };
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/chicken.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="red"/></svg>' });
    if (url.origin !== HOST) return route.fulfill({ contentType: 'text/javascript', body: '' });
    const action = url.searchParams.get('action');
    if (url.pathname.startsWith('/api/')) {
      if (action === 'brand') {
        if (url.searchParams.get('op') === 'activate') active = route.request().postDataJSON().id === 'ws-deli' ? 'deli' : 'shoes';
        const brand = payload(brands[active]);
        // Old persisted on-primary must be corrected from the current palette.
        brand.tokens['--brand-on-primary'] = '#000000';
        return route.fulfill({ json: { ok: true, brand, workspaces: Object.values(brands), needs_onboarding: false } });
      }
      if (url.pathname === '/api/public-config' && !action) return route.fulfill({ json: { supabase: { url: 'https://auth.example.com', anonKey: 'public' } } });
      if (action === 'smart-brain-plan') {
        const shoeScope = url.searchParams.get('workspace_id') === 'ws-shoes';
        if (shoeScope && hold) { started(); await held; }
        return route.fulfill({ json: { ok: true, stored: true, mode: 'local-fallback', entries: shoeScope ? [{ id: 'old-shoe', date: new Date().toISOString().slice(0, 10), market: 'IN', heroProduct: { title: 'Nike Air Force 1', category: 'Af1' }, status: 'tentative', cohort: { name: 'Fixture' }, objective: 'Old sneaker campaign' }] : [] } });
      }
      return route.fulfill({ json: { ok: true, entries: [], features: [], items: [], unmetered: true } });
    }
    if (url.pathname === '/chicken.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="red"/></svg>' });
    const file = path.join(ROOT, url.pathname.replace(/^\//, ''));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(file) });
    return route.fulfill({ body: '' });
  });
  await page.goto(HOST + '/smart-brain.html');
  await expect(page.locator('.lnav-brandname').first()).toHaveText('Food For Thought');
  await expect(page.locator('#plantable')).toContainText('Nike Air Force 1');
  return { holdOld: () => { hold = true; }, seen, release };
}

test('switching to Deli Chic updates name, logo, title, palette and catalog without stale sneaker rows', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.BrandContext.setActive('ws-deli'));
  await expect(page.locator('.top h1')).toHaveText('Deli Chic Brain');
  await expect(page.locator('.lnav-brandname').first()).toHaveText('Deli Chic');
  await expect(page.locator('.lnav-brandlogo img').first()).toHaveAttribute('src', brands.deli.logo_url);
  await expect(page).toHaveTitle(/Deli Chic/);
  await expect(page.locator('#plantable')).not.toContainText('Nike');
  await expect(page.locator('#catfilter')).not.toContainText('Af1');
  expect(await page.evaluate(() => window.BrandContext.activeBrand().name)).toBe('Deli Chic');
  // Repeated switches derive headings from the original label, not the last brand.
  await page.evaluate(() => window.BrandContext.setActive('ws-shoes'));
  await expect(page.locator('.top h1')).toHaveText('Food For Thought Brain');
});

test('Deli Chic buttons and sidebar meet text contrast even with stale foreground tokens', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.BrandContext.setActive('ws-deli'));
  const colors = await page.evaluate(() => {
    const button = document.createElement('button'); button.className = 'btn ok'; button.textContent = 'Order Fresh Cuts'; document.body.appendChild(button);
    const cs = getComputedStyle(button), root = getComputedStyle(document.documentElement);
    return { fg: cs.color, bg: cs.backgroundColor, on: root.getPropertyValue('--brand-on-primary').trim(), muted: root.getPropertyValue('--brand-ink-muted').trim(), surface: root.getPropertyValue('--brand-surface').trim() };
  });
  const hex = rgb => '#' + rgb.match(/\d+/g).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
  expect(core.contrast(hex(colors.fg), hex(colors.bg))).toBeGreaterThanOrEqual(4.5);
  expect(core.contrast(colors.muted, colors.surface)).toBeGreaterThanOrEqual(4.5);
});

test('a sneaker plan response arriving after the brand switch cannot repopulate the food calendar', async ({ page }) => {
  const pending = await boot(page);
  pending.holdOld();
  await page.evaluate(() => { window.oldLoad = loadPlan(); });
  await pending.seen;
  await page.evaluate(() => window.BrandContext.setActive('ws-deli'));
  pending.release();
  await page.evaluate(() => window.oldLoad);
  await expect(page.locator('.top h1')).toHaveText('Deli Chic Brain');
  await expect(page.locator('#plantable')).not.toContainText('Nike');
  await expect(page.locator('#catfilter')).not.toContainText('Af1');
});
