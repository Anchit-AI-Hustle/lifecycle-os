// The /credits page must say what will actually happen when a pack is clicked.
//
// Two different things happen behind that button: on a complimentary account
// the credits land immediately, and on every other account the order is only
// recorded because no payment processor is connected. The page said the second
// unconditionally, so a comp account was told an operator had to confirm a
// recharge that had in fact already completed.
//
// Driven in a real browser because the first attempt at this fix read
// `Credits.comp`, which was not on the exported object — it would have
// evaluated undefined and shown the non-comp copy forever while looking right
// in the diff.
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

let server; let base; let comp = false;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url.includes('action=credits')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true, balance: 500, held: 0, comp,
        packs: [{ key: 'starter', label: 'Starter', blurb: 'x', credits: 500, bonus: 0 }],
        features: {}, configured: true,
      }));
    }
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, brand: null, needs_onboarding: false, workspaces: [] }));
    }
    const file = path.join(ROOT, url.split('?')[0] === '/' ? 'index.html' : url.split('?')[0].replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

async function open(page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.goto(base + '/credits.html', { waitUntil: 'domcontentloaded' });
}

test('the shared client exposes the comp flag it is asked for', async ({ page }) => {
  comp = true;
  await open(page);
  await expect.poll(() => page.evaluate(() => window.Credits && typeof window.Credits.comp))
    .toBe('boolean');
});

test('a complimentary account is told the credits land immediately', async ({ page }) => {
  comp = true;
  await open(page);
  await expect.poll(() => page.evaluate(() => (document.getElementById('packnote') || {}).textContent || ''),
    { timeout: 15000 }).toMatch(/recharges free/i);
  const t = await page.evaluate(() => document.getElementById('packnote').textContent);
  expect(t).toMatch(/at no charge/i);
  expect(t, 'a comp account is told an operator must confirm').not.toMatch(/record a recharge order/i);
});

test('every other account is still told an operator confirms it', async ({ page }) => {
  comp = false;
  await open(page);
  await expect.poll(() => page.evaluate(() => (document.getElementById('packnote') || {}).textContent || ''),
    { timeout: 15000 }).toMatch(/record a recharge order/i);
  const t = await page.evaluate(() => document.getElementById('packnote').textContent);
  expect(t, 'a paying account is told it recharges free').not.toMatch(/recharges free/i);
});

test('the browser never receives the list of comp accounts', async ({ page }) => {
  comp = true;
  await open(page);
  // credits.js is deferred. Reading window.Credits straight after
  // domcontentloaded passed when this file ran alone and returned undefined
  // when it ran beside others — the assertion then failed on its own timing
  // rather than on the claim. Wait for the condition instead of assuming it.
  await page.waitForFunction(() => !!window.Credits, null, { timeout: 15000 });
  const keys = await page.evaluate(() => Object.keys(window.Credits).join(','));
  expect(keys).not.toMatch(/anchit|hashes|COMP_ACCOUNT/i);
  // The shipped file itself, read from disk rather than over the test server:
  // this is a claim about what is deployed, not about what a request returned.
  const js = fs.readFileSync(path.join(ROOT, 'credits.js'), 'utf8');
  expect(js, 'a comp address is written into a file the browser downloads').not.toMatch(/anchit\.tandon/i);
});
