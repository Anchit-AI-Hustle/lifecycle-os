/**
 * Every CTA shows it is working, the moment it starts (2026-10-13).
 * ---------------------------------------------------------------------------
 * The operator: "ensure all cta's start running the processes instantly -
 * ensure proper buffering or live simulation showcase to the user for every
 * function and feature". auth.js (on every page) marks the pressed control as
 * working when its request to our own /api/ leaves, shows a live elapsed line
 * beside it and a bar along the top, ignores a second press while it works,
 * and clears all of it when the answer arrives. Executed in Chromium with the
 * server's answer HELD, so the in-between state is observed, not assumed.
 * ---------------------------------------------------------------------------
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'http://app.example.test';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// A complete parsed read, the shape the wizard renders.
const READ = {
  ok: true, start: 'https://site.example', pages_visited: 1, stylesheets: [], limits: [], read: { method: 'parsed' },
  fields: {
    name: { value: 'Site Example', source_url: 'https://site.example/', signal: 'og:site_name', candidates: [{ value: 'Site Example', source_url: 'https://site.example/', signal: 'og:site_name' }] },
    tagline: { value: '', candidates: [] }, logo: { value: '', candidates: [] },
    palette: { proposed: {}, sources: {}, conflicts: [] }, typography: { heading: [], body: [], scale: [] },
    claims: { candidates: [] }, social: { candidates: [] }, legal: { candidates: [] },
  },
};

async function wire(page, held) {
  const log = { errors: [], sent: [] };
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  await page.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
  });
  await page.route((u) => !String(u).startsWith(HOST), (route) => {
    if (/\/auth\/v1\/health/.test(route.request().url())) return route.abort('addressunreachable');
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
  });
  await page.route(HOST + '/**', async (route) => {
    const u = new URL(route.request().url());
    const json = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname.startsWith('/api/')) {
      const key = (u.searchParams.get('action') || '') + ':' + (u.searchParams.get('op') || '');
      if (held.match(key)) {
        log.sent.push(key);
        await held.gate;
        return json(READ);
      }
      if (u.searchParams.get('action') === 'auth') return json({ ok: true, mode: 'google' });
      return json({ ok: true, presets: [], workspaces: [] });
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  return log;
}

function holder(re) {
  let release;
  const gate = new Promise((r) => { release = r; });
  return { match: (k) => re.test(k), gate, release };
}

const state = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const line = document.querySelector('[data-lc-busy-line]');
  return { busy: el ? el.getAttribute('aria-busy') : null, line: line ? line.textContent : '', bar: !!document.getElementById('lc-activity-bar') };
}, sel);

test('a plain button that calls the API: working at once, a live elapsed line, one run only, cleared when it answers', async ({ page }) => {
  const held = holder(/^demo:/);
  const log = await wire(page, held);
  await page.goto(HOST + '/about.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__lcActivity, null, { timeout: 15000 });
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'demoCta'; b.textContent = 'Run it';
    b.addEventListener('click', () => { fetch('/api/brain?action=demo'); });
    const row = document.createElement('div');
    row.id = 'demoRow';
    row.appendChild(b);
    document.body.prepend(row);
  });
  const t0 = Date.now();
  await page.click('#demoCta');
  await expect.poll(() => state(page, '#demoCta'), { timeout: 1000 }).toMatchObject({ busy: 'true', bar: true });
  expect(Date.now() - t0, 'the working state was not shown at once').toBeLessThan(1000);
  expect((await state(page, '#demoCta')).line).toMatch(/^Working/);
  // The line is never put into the page's own markup (a container's children
  // are the page's: the onboarding step row rebuilt itself when one appeared).
  expect(await page.evaluate(() => { const l = document.querySelector('[data-lc-busy-line]'); return l && l.parentElement === document.body && document.getElementById('demoRow').childElementCount === 1; }), 'the working line was inserted into the page\'s own markup').toBe(true);
  // It sits just under the pressed control while that is on screen.
  const geo = await page.evaluate(() => ({ b: document.getElementById('demoCta').getBoundingClientRect().bottom, t: document.querySelector('[data-lc-busy-line]').getBoundingClientRect().top }));
  expect(geo.t - geo.b).toBeGreaterThanOrEqual(0);
  expect(geo.t - geo.b).toBeLessThan(20);
  // The line counts up while it works.
  await expect.poll(async () => (await state(page, '#demoCta')).line, { timeout: 4000 }).toMatch(/Working · [1-9] s/);
  // A second press while it works does not send a second request.
  await page.click('#demoCta', { force: true });
  await page.waitForTimeout(300);
  expect(log.sent).toEqual(['demo:']);
  held.release();
  await expect.poll(() => state(page, '#demoCta'), { timeout: 3000 }).toMatchObject({ busy: null, line: '', bar: false });
  expect(log.errors).toEqual([]);
});

test('a request no press started (a poll, a boot read) shows nothing', async ({ page }) => {
  const held = holder(/^poll:/);
  await wire(page, held);
  await page.goto(HOST + '/about.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__lcActivity, null, { timeout: 15000 });
  await page.evaluate(() => { fetch('/api/brain?action=poll'); });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => ({ bar: !!document.getElementById('lc-activity-bar'), busy: document.querySelectorAll('[data-lc-busy]').length }))).toEqual({ bar: false, busy: 0 });
  held.release();
});

test('the real "Read my site" button on /onboarding shows it is working the moment it is pressed', async ({ page }) => {
  const held = holder(/^brand:extract$/);
  const log = await wire(page, held);
  await page.goto(HOST + '/onboarding.html?step=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#xRun', { timeout: 20000 });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded && !!window.__lcActivity, null, { timeout: 20000 });
  await page.fill('#xUrl', 'https://site.example');
  await expect(async () => {
    if (!log.sent.length) await page.click('#xRun', { timeout: 2000 });
    expect(log.sent.length).toBeGreaterThan(0);
  }).toPass({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => ({ bar: !!document.getElementById('lc-activity-bar'), busy: document.querySelectorAll('[data-lc-busy]').length > 0 })), { timeout: 2000 }).toEqual({ bar: true, busy: true });
  held.release();
  await expect.poll(() => page.evaluate(() => !!document.getElementById('lc-activity-bar')), { timeout: 5000 }).toBe(false);
  expect(log.errors).toEqual([]);
});
