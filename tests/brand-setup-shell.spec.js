// Switch Brand / /onboarding?new=1 must open a blank record on the APP setup
// palette, not the previously active brand's colours.
//
// Found live: Switch Brand kept Nykaa pink on a blank "Onboard a brand" form
// because BrandContext.paint() of the active brand outranked the blank draft.
//
// Run: npx playwright test tests/brand-setup-shell.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const core = require('../api/_shared/brand-workspace-core');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'http://setup.example.test';
const NYKAA = {
  id: 'ws-nykaa', slug: 'nykaa', name: 'Nykaa',
  palette: { primary: '#FC2779', accent: '#EB4D70', surface: '#FFFFFF', ink: '#3F414D', muted: '#8C8C8C' },
  typography: { heading: { family: 'Montserrat', stack: "'Montserrat',sans-serif" }, body: { family: 'Inter', stack: "'Inter',sans-serif" } },
};
function payload(b) {
  return { ...core.shellPayload({ ...b, regions: [{ code: 'IN', currency: 'INR', home: true }] }), owns_shipped: false };
}

test('Switch Brand nav opens /onboarding?new=1', () => {
  const auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  expect(auth).toMatch(/id:\s*'brand-switch'[\s\S]{0,120}href:\s*'\/onboarding\?new=1'/);
});

test('/onboarding?new=1 paints the setup palette, not the active brand', async ({ page }) => {
  await page.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: { access_token: 'fixture-google-token', expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: 'fixture-user', email: 'fixture@example.com', app_metadata: { provider: 'google' } } } } }),
      onAuthStateChange: () => ({}), signOut: async () => ({}), signInWithOAuth: async () => ({}),
    } }) };
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== HOST) return route.fulfill({ contentType: 'text/javascript', body: '' });
    const action = url.searchParams.get('action');
    if (url.pathname.startsWith('/api/')) {
      if (action === 'brand') {
        const op = url.searchParams.get('op');
        if (op === 'presets') return route.fulfill({ json: { ok: true, presets: [] } });
        if (op === 'get') return route.fulfill({ json: { ok: true, brand: payload(NYKAA) } });
        return route.fulfill({
          json: {
            ok: true, brand: payload(NYKAA),
            workspaces: [payload(NYKAA)],
            active_id: NYKAA.id,
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

  await page.goto(HOST + '/onboarding.html?new=1');
  await expect(page.locator('#title')).toContainText('Onboard a brand', { timeout: 15000 });
  await expect(page.locator('[data-path="name"]')).toHaveValue('');

  await expect.poll(async () => page.evaluate(() => {
    const root = document.documentElement;
    return {
      setup: root.getAttribute('data-brand-setup'),
      primary: getComputedStyle(root).getPropertyValue('--brand-primary').trim().toLowerCase(),
      slot: (document.querySelector('.lnav-brandname') || {}).textContent || '',
      inShell: !!(window.BrandContext && window.BrandContext.inSetupShell && window.BrandContext.inSetupShell()),
    };
  }), { timeout: 15000 }).toMatchObject({
    setup: '1',
    primary: '#1f5fd0',
    inShell: true,
  });

  const state = await page.evaluate(() => ({
    primary: getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim().toLowerCase(),
    slot: (document.querySelector('.lnav-brandname') || {}).textContent || '',
  }));
  expect(state.primary).not.toBe('#fc2779');
  expect(state.slot).not.toMatch(/Nykaa/i);
  expect(state.slot).toMatch(/New brand/i);
});
