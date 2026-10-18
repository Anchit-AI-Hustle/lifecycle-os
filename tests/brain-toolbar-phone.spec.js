// The /brain rolling-calendar toolbar on a phone: nothing touches or overlaps
// (2026-10-18).
//
// The operator, with a phone screenshot of production /brain: "Fix overlap
// issue". The "Plans" and "Sections" catalogue chips ran into each other and
// the filter rows sat flush under Generate / Approve / Download all. Cause: the
// region and catalogue rows were shown with `style.display = ''`, which also
// removed their inline `display:flex`, so the chips fell into plain text flow
// with no gap; and the header block had no space below it.
//
// Executed: the shipped page in Chromium with a plan of two markets and two
// catalogue kinds, measured at phone, small-phone and desktop sizes. Each check
// first asserts it measured the controls.
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
// Two markets (the region row shows) and one market (it is hidden, as on the
// operator's screenshot: the duration row is then the first under the buttons).
const planFor = (markets) => Array.from({ length: 8 }, (_, i) => ({
  id: `slot-${i}`, date: iso(i + 1), market: markets[i % markets.length], status: 'tentative',
  cohort: { name: i % 2 ? 'Engaged' : 'Nurture', size: 0 },
  offering: { kind: i % 2 ? 'plan' : 'section', name: 'Offer ' + i },
  objective: 'Bring the reader back this week', heroProduct: { title: 'Offer ' + i },
  channels: ['email', 'landing_page'], confidence: 0.5,
}));

let PLAN = planFor(['IN', 'US']);
let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      if (/smart-brain-plan/.test(req.url)) return res.end(JSON.stringify({ ok: true, plan: PLAN }));
      return res.end(JSON.stringify({ ok: true, brand: null, needs_onboarding: false, workspaces: [] }));
    }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

const SIZES = [
  { name: 'phone 390', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'small phone 375', viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true },
  { name: 'desktop 1280', viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false },
];

for (const markets of [['IN', 'US'], ['IN']]) for (const size of SIZES) {
  test(`the calendar toolbar has no touching or overlapping controls: ${markets.join('+')}, ${size.name}`, async ({ browser }) => {
    PLAN = planFor(markets);
    const ctx = await browser.newContext({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto(base + '/smart-brain.html');
    await expect(page.locator('#catfilter .mkchip')).toHaveCount(2, { timeout: 15000 });
    if (markets.length > 1) await expect(page.locator('#mktfilter .mkchip').first()).toBeVisible();
    const m = await page.evaluate(() => {
      const box = (e) => e.getBoundingClientRect();
      const rows = ['mktfilter', 'durfilter', 'catfilter'].map((id) => document.getElementById(id));
      const display = rows.filter((r) => r.style.display !== 'none').map((r) => r.id + ':' + getComputedStyle(r).display);
      const head = document.getElementById('downloadAll').parentElement.parentElement;
      const controls = [...document.querySelectorAll('#generateAll, #approveAll, #downloadAll'), ...rows.flatMap((r) => [...r.children])]
        .filter((e) => box(e).width && box(e).height && getComputedStyle(e).display !== 'none');
      const overlaps = []; const touching = [];
      for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
        const a = box(controls[i]); const b = box(controls[j]);
        const name = `"${controls[i].textContent.trim().slice(0, 20)}" / "${controls[j].textContent.trim().slice(0, 20)}"`;
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push(name);
        // Two chips on one line must stand apart.
        const sameLine = Math.abs(a.top - b.top) < 4;
        const bothChips = controls[i].matches('.mkchip') && controls[j].matches('.mkchip');
        if (sameLine && bothChips) { const g = Math.max(b.left - a.right, a.left - b.right); if (g < 4) touching.push(name + ' gap ' + g.toFixed(1)); }
      }
      const headBottom = box(head).bottom;
      const firstRow = rows.find((r) => getComputedStyle(r).display !== 'none');
      const card = head.closest('.card'); const cb = box(card);
      const outside = controls.filter((e) => { const r = box(e); return r.left < cb.left - 0.5 || r.right > cb.right + 0.5; }).map((e) => e.textContent.trim().slice(0, 20));
      return { display, count: controls.length, chips: controls.filter((e) => e.matches('.mkchip')).length, overlaps, touching, spaceBelowHead: box(firstRow).top - headBottom, outside };
    });
    expect(m.count, 'measured the toolbar').toBeGreaterThanOrEqual(markets.length > 1 ? 12 : 10);
    expect(m.chips, 'measured the chips').toBeGreaterThanOrEqual(7);
    expect(m.display.length, 'filter rows measured').toBe(markets.length > 1 ? 3 : 2);
    for (const d of m.display) expect(d, 'a filter row stays a flex row').toMatch(/:flex$/);
    expect(m.overlaps, 'controls that overlap').toEqual([]);
    expect(m.touching, 'chips that touch').toEqual([]);
    expect(m.spaceBelowHead, 'space between the action buttons and the filters').toBeGreaterThanOrEqual(8);
    expect(m.outside, 'controls outside the card').toEqual([]);
    await ctx.close();
  });
}
