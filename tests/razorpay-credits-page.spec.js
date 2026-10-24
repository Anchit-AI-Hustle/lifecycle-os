// /credits with Razorpay, driven in Chromium.
//
// The server side is executed in razorpay-credits-executed.spec.js. This drives
// the page: what Razorpay's checkout is opened WITH (the server's order, the
// redirect mode and its callback), what the page posts back, what it says when
// the buyer closes the checkout or the card is declined, and what it says when
// the bank sends the page back to /credits#paid or #unpaid. checkout.js is
// replaced by a stub that records its options and lets the test play the
// buyer; the stub server stands in for the credits router.
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PRICED = { configured: true, currency: 'INR', amount_minor: 49900, display: '₹499.00', source: 'operator', marker: '' };
const PACKS = [{ key: 'starter', label: 'Starter', blurb: 'x', credits: 500, bonus: 0, total_credits: 500, price: PRICED }];

let server; let base;
let balance = 100;
let sent = [];          // every credits request: { op, body }

const CHECKOUT_STUB = `
  window.Razorpay = function (opts) {
    window.__rzp = { opts: opts, failed: null };
    this.on = function (ev, fn) { if (ev === 'payment.failed') window.__rzp.failed = fn; };
    this.open = function () { window.__rzp.opened = true; };
  };`;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (url.searchParams.get('action') === 'credits') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const op = url.searchParams.get('op') || 'balance';
        const body = raw ? JSON.parse(raw) : null;
        sent.push({ op, body });
        let out = { ok: true };
        if (op === 'catalog' || op === 'balance') {
          out = { ok: true, wallet: { id: 'w1', balance, held: 0, low_balance_threshold: 50 }, comp: false, packs: PACKS, features: [], configured: true, razorpay: true };
        } else if (op === 'rzp-order') {
          out = { ok: true, provider: 'razorpay', keyId: 'rzp_test_Stub', orderId: 'order_StubOrder001', amount: 49900, currency: 'INR', pack: { key: 'starter', label: 'Starter', credits: 500 }, prefill: { email: 'a@example.test' } };
        } else if (op === 'rzp-verify') {
          balance += 500;
          out = { ok: true, credited: true, credits: 500, balance };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, brand: null, needs_onboarding: false, workspaces: [] }));
    }
    const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });
test.beforeEach(() => { balance = 100; sent = []; });

async function open(page, hash) {
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: CHECKOUT_STUB }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|checkout\.razorpay\.com)/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.goto(base + '/credits.html' + (hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.Credits && window.Credits.loaded && window.Credits.razorpay), null, { timeout: 15000 });
}

async function startCheckout(page) {
  await page.waitForFunction(() => !!document.querySelector('#packs [data-pack="starter"]'), null, { timeout: 15000 });
  await page.click('#packs [data-pack="starter"]');
  await page.waitForFunction(() => !!(window.__rzp && window.__rzp.opened), null, { timeout: 15000 });
  return page.evaluate(() => window.__rzp.opts && JSON.parse(JSON.stringify(window.__rzp.opts)));
}

test('the pack note says the pack is paid through Razorpay', async ({ page }) => {
  await open(page);
  await expect.poll(() => page.evaluate(() => document.getElementById('packnote').textContent)).toMatch(/Razorpay/);
});

test('a pack opens Razorpay with the server\'s order, in redirect mode, and sends no amount of its own', async ({ page }) => {
  await open(page);
  const opts = await startCheckout(page);
  expect(opts).toMatchObject({
    key: 'rzp_test_Stub', order_id: 'order_StubOrder001', amount: 49900, currency: 'INR', redirect: true,
    callback_url: base + '/api/public-config?action=credits&op=rzp-callback',
  });
  const order = sent.find((s) => s.op === 'rzp-order');
  expect(Object.keys(order.body).sort()).toEqual(['pack_key']);
  const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('lc.rzp.pending')));
  expect(pending).toMatchObject({ pack: 'starter', order: 'order_StubOrder001' });
});

test('the checkout handler posts the three proof fields, and the balance shown is the server\'s', async ({ page }) => {
  await open(page);
  await startCheckout(page);
  await page.evaluate(() => window.__rzp.opts.handler({ razorpay_order_id: 'order_StubOrder001', razorpay_payment_id: 'pay_StubPay0001', razorpay_signature: 'f'.repeat(64) }));
  await expect.poll(() => sent.filter((s) => s.op === 'rzp-verify').length).toBe(1);
  expect(sent.find((s) => s.op === 'rzp-verify').body).toEqual({ razorpay_order_id: 'order_StubOrder001', razorpay_payment_id: 'pay_StubPay0001', razorpay_signature: 'f'.repeat(64) });
  await expect(page.locator('#toast')).toContainText('Added 500 credits');
  await expect(page.locator('#balance')).toContainText('600');
  expect(await page.evaluate(() => sessionStorage.getItem('lc.rzp.pending'))).toBeNull();
});

test('closing the checkout and a declined payment both say nothing was charged', async ({ page }) => {
  await open(page);
  await startCheckout(page);
  await page.evaluate(() => window.__rzp.opts.modal.ondismiss());
  await expect(page.locator('#toast')).toContainText('Checkout was closed before paying. Nothing was charged.');

  await page.evaluate(() => { window.__rzp = null; });
  await startCheckout(page);
  await page.evaluate(() => window.__rzp.failed({ error: { code: 'BAD_REQUEST_ERROR' } }));
  await expect(page.locator('#toast')).toContainText('That payment did not go through. Nothing was charged.');
  expect(sent.filter((s) => s.op === 'rzp-verify')).toHaveLength(0);
});

test('back from the bank: #paid names the pack and the server balance, #unpaid says no credits were added', async ({ page }) => {
  await open(page);
  await page.evaluate(() => sessionStorage.setItem('lc.rzp.pending', JSON.stringify({ wallet: '', pack: 'starter', label: 'Starter', order: 'order_StubOrder001' })));
  balance = 600;  // the callback already credited it, server-side
  // A full page load, as the bank's return always is: going from /credits.html to
  // /credits.html#paid without leaving the page is only a hash change, and the page
  // reads the return once, when it loads.
  await page.goto('about:blank');
  await page.goto(base + '/credits.html#paid', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#toast')).toContainText('Payment received for the Starter pack. Your balance is 600 credits.');
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(await page.evaluate(() => sessionStorage.getItem('lc.rzp.pending'))).toBeNull();

  // The bank's return is always a full page load (a form POST answered 303), never a hash change.
  await page.goto('about:blank');
  await page.goto(base + '/credits.html#unpaid', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#toast')).toContainText('That payment did not go through, so no credits were added.');
});
