/**
 * The agent goes on the brand's own website (2026-10-14), in Chromium.
 *
 * 1. /agent: "Put this agent on your website" writes the one line for the
 *    ACTIVE brand (its workspace id, the chosen agent, its name and colours) and
 *    copies it; a brand kept only on this device is told why it cannot yet.
 * 2. The line on a page of the brand's site: the widget wears the brand's
 *    colours (not tenant zero's red), and a visitor's question goes to
 *    ?action=agent-public with the brand and agent the line names; the reply
 *    is shown.
 *
 * Run: npx playwright test tests/agent-embed-page.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const APP = 'http://localhost:4978';
const WS = '7b1f8c2a-1111-4222-8333-944455556666';
const BRAND = {
  id: WS, slug: 'lensbrand', name: 'Lensbrand', status: 'active', onboarding_step: 6, website: 'https://www.lensbrand.example',
  palette: { primary: '#1D3A8A', accent: '#16A3A3', ink: '#14161C', surface: '#FFFFFF' },
  typography: { heading: { family: 'Inter', stack: "'Inter',system-ui,sans-serif" }, body: { family: 'Inter', stack: "'Inter',system-ui,sans-serif" } },
  voice: { tone: 'clear' }, regions: [{ code: 'IN', currency: 'INR', home: true }], brand_data: {},
};

function serve(route, u) {
  const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\//, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
  return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
}

test('/agent writes the website line for the active brand and its agent, and copies it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.addInitScript(() => {
    window.__copied = [];
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(String(t)); } } }); } catch (_) {}
  });
  const settings = [];
  await page.route(/^https?:\/\//, (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin !== APP) return req.resourceType() === 'script' ? route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' }) : route.abort('failed');
    if (!u.pathname.startsWith('/api/')) return serve(route, u);
    const action = u.searchParams.get('action');
    const json = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (!action) return json({});
    if (action === 'auth') return json({ ok: true, mode: 'google' });
    if (action === 'brand') {
      const op = u.searchParams.get('op');
      if (op === 'presets') return json({ ok: true, presets: [] });
      return json({ ok: true, brand: BRAND, workspaces: [BRAND], active_id: WS });
    }
    if (action === 'agents') return json({ ok: true, agents: [{ id: 'agent_frames', name: 'Frames Expert', level: 'collection', greeting: 'Ask me about frames.' }] });
    if (action === 'agent-embed') { settings.push(req.method() + ' ' + (req.postData() || u.searchParams.get('workspace_id'))); return json({ ok: true, daily_cap: req.method() === 'POST' ? JSON.parse(req.postData()).daily_cap : 300, used_today: 4 }); }
    return json({ ok: true });
  });
  await page.goto(APP + '/agent.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.name === 'Lensbrand', null, { timeout: 20000 });
  await page.locator('#embedBox summary').click();
  const code = page.locator('#embedCode');
  await expect(code).toHaveValue(/agent-widget\.js/, { timeout: 10000 });
  const v = await code.inputValue();
  expect(v).toContain(`data-brand="${WS}"`);
  expect(v).toContain('data-agent="agent_frames"');
  expect(v).toContain('data-name="Lensbrand"');
  expect(v).toContain('data-primary="#1D3A8A"');
  expect(v).toContain('data-accent="#16A3A3"');
  expect(v).toContain(APP + '/agent-widget.js');
  expect(v).not.toMatch(/knickgasm|#D0473E/i);
  await expect(page.locator('#embedWhy')).toContainText('lensbrand.example');
  await expect(page.locator('#embedCap')).toHaveValue('300');
  await expect(page.locator('#embedCapNote')).toContainText('4 answered today');
  await page.click('#embedCopy');
  expect(await page.evaluate(() => window.__copied)).toEqual([v]);
  await page.fill('#embedCap', '120');
  await page.click('#embedCapSave');
  await expect(page.locator('#embedCapNote')).toContainText('at most 120 answers a day');
  expect(settings.some((x) => x.startsWith('POST') && x.includes('"daily_cap":120'))).toBe(true);
  expect(errors).toEqual([]);
});

test('the line on the brand\'s own page: the widget wears the brand\'s colours and asks agent-public for that brand and agent', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  const sent = [];
  const SITE = 'https://www.lensbrand.example';
  await page.route(/^https?:\/\//, (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin === SITE) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><title>Lensbrand</title></head><body style="font-family:Georgia"><h1>Frames</h1>
<script src="${APP}/agent-widget.js" defer data-brand="${WS}" data-agent="agent_frames" data-name="Lensbrand" data-primary="#1D3A8A" data-on-primary="#FFFFFF" data-accent="#16A3A3" data-greeting="Ask me about frames."></script></body></html>` });
    }
    if (u.origin === APP && u.pathname === '/agent-widget.js') return serve(route, u);
    if (u.origin === APP && u.pathname === '/api/brain') {
      sent.push({ action: u.searchParams.get('action'), body: JSON.parse(req.postData() || '{}'), origin: req.headers().origin || '' });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, reply: 'Rectangular frames balance a round face.', session_id: 's1' }) });
    }
    return route.abort('failed');
  });
  await page.goto(SITE + '/frames', { waitUntil: 'load' });
  const fab = page.locator('#vah-agent-fab');
  await expect(fab).toBeVisible();
  expect(await fab.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(29, 58, 138)');
  expect(await fab.getAttribute('title')).toBe('Talk to Lensbrand');
  await fab.click();
  await expect(page.locator('#vah-agent-name')).toHaveText('Lensbrand');
  await expect(page.locator('#vah-agent-msgs')).toContainText('Ask me about frames.');
  // Text replies only: the browser voice is not under test here.
  await page.locator('.vah-reply button[data-reply="text"]').click();
  await page.locator('#vah-agent-input input').fill('Which frame suits a round face?');
  await page.locator('#vah-send').click();
  await expect(page.locator('#vah-agent-msgs')).toContainText('Rectangular frames balance a round face.');
  expect(sent).toHaveLength(1);
  expect(sent[0].action).toBe('agent-public');
  expect(sent[0].body).toMatchObject({ workspace_id: WS, agent_id: 'agent_frames', message: 'Which frame suits a round face?', page_url: SITE + '/frames' });
  expect(sent[0].origin).toBe(SITE);
  const head = await page.locator('#vah-agent-head').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(head).toBe('rgb(29, 58, 138)');
  expect(errors).toEqual([]);
});
