// One-tap star rating from a review mail, the brand's feedback page and its
// thank-you page (2026-10-24). Built from VAHDAM's "star rating widget with
// redirection logic" sample, WITHOUT its gating: a public review link is
// offered to every rater, at every star, on both pages (FTC 16 CFR 465,
// Trustpilot and Google forbid sending only happy raters to a public review).
//
// Executed: the shipped review-recovery mailer with this deployment's address
// set; the shipped public-config router driven over a modelled PostgREST
// (brand_workspaces read, brand_review_feedback insert); the pages rendered in
// Chromium at 1280 and 390.
//
// Run: npx playwright test tests/review-feedback.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WS = '11111111-2222-4333-8444-555555555555';
const BRAND = {
  id: WS, name: 'Leafline Tea', website: 'https://www.leafline.example', review_url: 'https://www.trustpilot.com/review/leafline.example',
  palette: { primary: '#1F4A33', accent: '#C9A227', ink: '#1A1A1A', surface: '#FFFFFF' },
  regions: [{ code: 'IN', currency: 'INR', store_url: 'https://www.leafline.example', home: true }],
};

function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  return Promise.resolve().then(fn).finally(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

// The fake project: one brand row, and the feedback table's insert.
function fakeProject(store) {
  return async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith('https://proj.example/rest/v1/')) throw new Error('unrouted ' + u);
    if (opts.headers && opts.headers.Authorization !== 'Bearer service-key') return new Response('{}', { status: 401 });
    if (u.includes('/brand_workspaces?')) return new Response(JSON.stringify(u.includes(WS) ? [BRAND] : []), { status: 200 });
    if (u.endsWith('/brand_review_feedback') && opts.method === 'POST') { store.push(JSON.parse(opts.body)); return new Response('', { status: 201 }); }
    throw new Error('unrouted ' + u);
  };
}

function call(req) {
  const handler = require(path.join(ROOT, 'api', 'public-config.js'));
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, body: '',
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; },
      status(c) { this.statusCode = c; return this; }, json(o) { this.body = JSON.stringify(o); resolve(this); return this; },
      end(b) { if (b) this.body += b; resolve(this); return this; }, send(b) { this.body += b; resolve(this); return this; } };
    Promise.resolve(handler(Object.assign({ method: 'GET', headers: { 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) }, query: {} }, req), res)).catch((e) => { res.statusCode = 599; res.body = String(e && e.stack); resolve(res); });
  });
}

const ENV = { SUPABASE_URL: 'https://proj.example', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SELF_BASE_URL: 'https://app.example' };

test('the review mail carries five tappable stars to the brand page, and the public review link for everyone', async () => {
  const RR = require(path.join(ROOT, 'api', '_shared', 'review-recovery.js'));
  const html = await withEnv(ENV, () => RR.reviewMailerHtml({ title: 'Darjeeling First Flush', handle: 'darjeeling', sku: 'S1' }, 'IN', BRAND));
  const stars = [...html.matchAll(/href="(https:\/\/app\.example\/review\?[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  expect(stars.length).toBe(5);
  stars.forEach((s, i) => { const q = new URL(s).searchParams; expect(q.get('rating')).toBe(String(i + 1)); expect(q.get('b')).toBe(WS); });
  expect(html).toContain('post a public review');
  // With no address for this deployment, the mail keeps its one button.
  const plain = await withEnv({ SELF_BASE_URL: '' }, () => { delete process.env.SELF_BASE_URL; return RR.reviewMailerHtml({ title: 'X', handle: 'x' }, 'IN', BRAND); });
  expect(plain).not.toContain('/review?');
  expect(plain).toContain('Leave a rating');
});

test('every rating, 1 to 5, is offered the public review link; feedback is stored without contact details', async ({ page }) => {
  const store = [];
  const realFetch = global.fetch;
  global.fetch = fakeProject(store);
  try {
    await withEnv(ENV, async () => {
      for (const r of [1, 3, 5]) {
        const res = await call({ query: { action: 'review-page', b: WS, rating: String(r), name: 'Asha', order: '1042', product: 'S1' } });
        expect(res.statusCode).toBe(200);
        expect(res.body, `rating ${r}: no public review link`).toContain('https://www.trustpilot.com/review/leafline.example');
        expect(res.body).toContain(`value="${r}" checked`);
      }
      // An unknown brand is a 404 page, never another brand's.
      expect((await call({ query: { action: 'review-page', b: '99999999-2222-4333-8444-555555555555', rating: '4' } })).statusCode).toBe(404);
      // A missing rating is refused with a sentence, nothing stored.
      const bad = await call({ method: 'POST', query: { action: 'review-feedback' }, body: { b: WS, comment: 'hi' } });
      expect(bad.statusCode).toBe(400);
      expect(bad.body).toContain('choose a rating');
      expect(store.length).toBe(0);
      // A 2-star submission is stored and the page then thanks AND offers the public link.
      const ok = await call({ method: 'POST', query: { action: 'review-feedback' }, body: { b: WS, rating: '2', comment: 'Arrived late', issue: 'Delivery or shipping', again: 'Maybe', followup: 'email', order: '1042', product: 'S1', name: 'Asha', email: 'a@x.example' } });
      expect(ok.statusCode).toBe(303);
      expect(store).toHaveLength(1);
      expect(store[0]).toMatchObject({ workspace_id: WS, rating: 2, issue: 'Delivery or shipping', order_again: 'Maybe', followup: 'email', order_ref: '1042' });
      expect(JSON.stringify(store[0])).not.toContain('a@x.example');
      const to = new URL(ok.headers.location, 'https://app.example');
      const thanks = await call({ query: Object.fromEntries([...to.searchParams, ['action', 'review-page']]) });
      expect(thanks.body).toContain('by email within one to two working days');
      expect(thanks.body).toContain('Post a public review');
      // The page in a browser: fits a phone, the stars change the reading.
      const page1 = (await call({ query: { action: 'review-page', b: WS, rating: '1' } })).body;
      for (const [w, h] of [[1280, 900], [390, 844]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.setContent(page1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        await page.click('label[for="r4"]');
        await expect(page.locator('[data-read]')).toHaveText('4 of 5');
        expect(await page.locator('.stars label.on').count()).toBe(4);
      }
    });
  } finally { global.fetch = realFetch; }
});
