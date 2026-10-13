// The Smart Brain rolling calendar is READABLE (2026-10-13).
//
// The operator, with a screenshot of production /brain at ~1600px: "see the
// table - text is getting cut and unreadable completely". Three defects in it:
// the cohort's eligibility chip ("Eligibility unknown - no send history") was a
// nowrap pill wider than its column and painted over the Objective column; the
// objective and the reason were cut at two lines ("Drive the reader t...",
// "Chosen to drive Driv..."); and the three action buttons ran past the card's
// edge ("? Why" cut in half).
//
// MEASURED in Chromium on the shipped page with plan rows of the same shape as
// production's, at 1280, 1440 and 1600 wide: no element of a cell reaches into
// the next cell, no objective or reason text is clipped, and every action
// button sits inside the area the reader can see. Each check first asserts it
// measured something.
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
function row(i, cohort) {
  return {
    id: `slot-${i}`, date: iso(i + 1), market: 'US', status: 'tentative',
    cohort: { name: cohort, size: 0 },
    reach: { eligibility: { label: 'Eligibility unknown — no send history', status: 'unknown', note: 'No send history.' }, planned_recipients: null },
    feasibility: { status: 'DATA REQUIRED', note: 'Order history is required.' },
    objective: 'Drive the reader to the new collection with a clear reason to come back this week',
    heroProduct: { title: 'Hooper HP E10003M' },
    rationale: 'Chosen to drive Drive the reader to the new collection, because this cohort has not opened in 60 days and the collection is new.',
    channels: ['email', 'meta', 'google', 'landing_page'],
    confidence: 0.56,
  };
}
const PLAN = [row(0, 'Winback'), row(1, 'Nurture'), row(2, 'Engaged'), row(3, 'At Risk')];

let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      if (/\/api\/calendar/.test(url) && /smart-brain-plan/.test(req.url)) return res.end(JSON.stringify({ ok: true, plan: PLAN }));
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

function measure() {
  const scr = document.querySelector('#plantable').closest('.tblscroll');
  const sr = scr.getBoundingClientRect();
  const view = { left: Math.max(0, sr.left), right: Math.min(innerWidth, sr.left + scr.clientWidth) };
  const out = { rows: 0, cells: 0, spill: [], clipped: [], buttons: 0, buttonsOut: [], tableW: document.querySelector('#plantable').getBoundingClientRect().width, scrollerW: scr.clientWidth };
  for (const tr of document.querySelectorAll('#plantable tr.planrow')) {
    out.rows += 1;
    for (const td of tr.children) {
      out.cells += 1;
      const tr2 = td.getBoundingClientRect();
      for (const el of td.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.left < tr2.left - 1 || r.right > tr2.right + 1) out.spill.push(`${td.className || td.cellIndex}: ${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 40)}" [${Math.round(r.left)},${Math.round(r.right)}] in [${Math.round(tr2.left)},${Math.round(tr2.right)}]`);
      }
    }
    for (const t of tr.querySelectorAll('td.obj div, td.why div')) {
      if (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1) out.clipped.push(`"${t.textContent.trim().slice(0, 40)}" sh=${t.scrollHeight} ch=${t.clientHeight}`);
    }
    for (const b of tr.querySelectorAll('td.acts button')) {
      out.buttons += 1;
      const r = b.getBoundingClientRect();
      if (r.left < view.left - 1 || r.right > view.right + 1) out.buttonsOut.push(`${b.textContent.trim()} [${Math.round(r.left)},${Math.round(r.right)}] view [${Math.round(view.left)},${Math.round(view.right)}]`);
    }
  }
  return out;
}

for (const width of [1280, 1440, 1600]) {
  test(`the rolling calendar is readable at ${width}px: nothing spills into the next column, nothing is clipped, every action is on screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.Papa = window.Papa || { unparse: () => "" };' }));
    await page.goto(base + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#planrow-0').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    const m = await page.evaluate(measure);
    expect(m.rows, 'no plan row was measured').toBe(PLAN.length);
    expect(m.cells).toBeGreaterThan(PLAN.length * 8);
    expect(m.buttons).toBe(PLAN.length * 3);
    expect(m.spill, 'an element of a cell reaches into the next column').toEqual([]);
    expect(m.clipped, 'objective or reason text is cut off').toEqual([]);
    // A desktop reader sees the whole row: the table fits its card.
    if (width >= 1440) expect(m.tableW, `the table is wider than its card (${m.tableW} > ${m.scrollerW})`).toBeLessThanOrEqual(m.scrollerW + 1);
    if (width >= 1440) expect(m.buttonsOut, 'an action button is off the visible card').toEqual([]);
  });
}
