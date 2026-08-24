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
// The packs the stub server returns. Shaped like packList()'s output, so a
// test drives exactly what the real endpoint sends.
let packs = [{ key: 'starter', label: 'Starter', blurb: 'x', credits: 500, bonus: 0, total_credits: 500,
               price: { configured: false, currency: null, amount_minor: null, display: '',
                        source: 'none', marker: '[DATA REQUIRED BEFORE LAUNCH: price, Starter credit pack, currency and amount]' } }];

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url.includes('action=credits')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true, balance: 500, held: 0, comp,
        packs,
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

/* ── the price on the card ───────────────────────────────────────────────────
 * The audit's finding was that a pack shows credits and bonus and no money
 * anywhere. These drive the real page: the module tests above prove packPrice()
 * resolves correctly, and these prove the card actually renders it and that an
 * unpriced pack cannot be clicked. A disabled-looking card that still fires the
 * handler would pass a source review and take an order at no price.
 * ────────────────────────────────────────────────────────────────────────── */

const UNPRICED = { configured: false, currency: null, amount_minor: null, display: '', source: 'none',
  marker: '[DATA REQUIRED BEFORE LAUNCH: price, Starter credit pack, currency and amount]' };
const PRICED = { configured: true, currency: 'INR', amount_minor: 49900, display: '₹499.00', source: 'operator', marker: '' };

async function packCard(page) {
  await page.waitForFunction(() => document.querySelectorAll('#packs .pack').length > 0, null, { timeout: 15000 });
  return page.locator('#packs .pack').first();
}

test('an unpriced pack says what is missing and is not clickable', async ({ page }) => {
  comp = false;
  packs = [{ key: 'starter', label: 'Starter', blurb: 'x', credits: 500, bonus: 0, total_credits: 500, price: UNPRICED }];
  await open(page);
  const card = await packCard(page);
  await expect(card).toContainText('DATA REQUIRED BEFORE LAUNCH');
  // data-pack is what binds the click handler. Its absence is the guarantee;
  // the dashed border is only the visible reflection of it.
  expect(await card.getAttribute('data-pack')).toBeNull();
  expect(await card.getAttribute('aria-disabled')).toBe('true');
  expect(await page.evaluate(() => document.querySelectorAll('#packs [data-pack]').length)).toBe(0);
});

test('a priced pack shows the money and stays clickable', async ({ page }) => {
  comp = false;
  packs = [{ key: 'starter', label: 'Starter', blurb: 'x', credits: 500, bonus: 0, total_credits: 500, price: PRICED }];
  await open(page);
  const card = await packCard(page);
  await expect(card).toContainText('₹499.00');
  await expect(card).not.toContainText('DATA REQUIRED');
  expect(await card.getAttribute('data-pack')).toBe('starter');
});

test('a complimentary account is not blocked by an unset price', async ({ page }) => {
  comp = true;
  packs = [{ key: 'starter', label: 'Starter', blurb: 'x', credits: 500, bonus: 0, total_credits: 500, price: UNPRICED }];
  await open(page);
  const card = await packCard(page);
  // The price is not this account's concern, so the marker would be noise and
  // the card must still work. Blocking a comp account on a missing price would
  // be the fix breaking the one account it was never about.
  await expect(card).toContainText(/free on this account/i);
  await expect(card).not.toContainText('DATA REQUIRED');
  expect(await card.getAttribute('data-pack')).toBe('starter');
});

test('the price text clears the AA contrast floor against the card it sits on', async ({ page }) => {
  comp = false;
  packs = [{ key: 'starter', label: 'Starter', blurb: 'x', credits: 500, bonus: 0, total_credits: 500, price: PRICED }];
  await open(page);
  await packCard(page);
  // Measured, not reasoned about: the token could resolve to anything at all.
  const ratio = await page.evaluate(() => {
    const el = document.querySelector('#packs .pack .price');
    if (!el) return null;
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
        .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let node = el, bg = 'rgba(0, 0, 0, 0)';
    while (node && node !== document.documentElement) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
      node = node.parentElement;
    }
    if (bg === 'rgba(0, 0, 0, 0)') bg = 'rgb(255, 255, 255)';
    const a = lum(getComputedStyle(el).color), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(ratio, 'the price must be readable').not.toBeNull();
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

/* ── the copy must describe the state the page is actually in ────────────────
 * Introduced by the pricing change and caught by asking what the page SAYS on
 * a deployment with no prices set — which is the state every deployment starts
 * in. Both surfaces told a paying user to "pick a pack to record a recharge
 * order" while no pack was pickable at all: an instruction nobody could follow.
 * Three states, not two.
 * ────────────────────────────────────────────────────────────────────────── */

test('with no pack priced, the page does not tell the user to pick one', async ({ page }) => {
  comp = false;
  packs = [{ key: 'starter', label: 'Starter', blurb: 'x', credits: 500, bonus: 0, total_credits: 500, price: UNPRICED }];
  await open(page);
  await expect.poll(() => page.evaluate(() => (document.getElementById('packnote') || {}).textContent || ''),
    { timeout: 15000 }).toMatch(/no pack has a price/i);
  const t = await page.evaluate(() => document.getElementById('packnote').textContent);
  expect(t, 'told to pick a pack when none is pickable').not.toMatch(/pick a pack/i);
  // It must also not read as an outage. Nothing the user already has is affected.
  expect(t).toMatch(/balance/i);
});

test('with a pack priced, the ordering copy comes back', async ({ page }) => {
  comp = false;
  packs = [{ key: 'starter', label: 'Starter', blurb: 'x', credits: 500, bonus: 0, total_credits: 500, price: PRICED }];
  await open(page);
  await expect.poll(() => page.evaluate(() => (document.getElementById('packnote') || {}).textContent || ''),
    { timeout: 15000 }).toMatch(/record a recharge order/i);
  const t = await page.evaluate(() => document.getElementById('packnote').textContent);
  expect(t).not.toMatch(/no pack has a price/i);
});

test('a comp account is never shown the unpriced copy', async ({ page }) => {
  comp = true;
  packs = [{ key: 'starter', label: 'Starter', blurb: 'x', credits: 500, bonus: 0, total_credits: 500, price: UNPRICED }];
  await open(page);
  await expect.poll(() => page.evaluate(() => (document.getElementById('packnote') || {}).textContent || ''),
    { timeout: 15000 }).toMatch(/recharges free/i);
  const t = await page.evaluate(() => document.getElementById('packnote').textContent);
  expect(t, 'a comp account was told nothing can be bought').not.toMatch(/no pack has a price/i);
});
