/**
 * The Owner's Desk (2026-10-23): the seven "run your business like an agency"
 * prompts, matched. Executed:
 *   - the arithmetic (owner-desk.js) over a Shopify-shaped sales export, an
 *     expense sheet and an ad report, every figure against a hand-worked value;
 *   - the model-written parts (owner-desk-server.js) with a scripted model that
 *     breaks the rules (an over-limit headline, an unbacked claim, a reply that
 *     promises a refund, a quote of a negative review, a fix for a theme
 *     nobody counted), each caught;
 *   - the brand style lock reaching every prompt (brandBlock, image preamble);
 *   - the page in Chromium: files in, figures out, the sliders live, the
 *     monthly report in its fixed layout, and no native dialog anywhere.
 *
 * Run: npx playwright test tests/owner-desk.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OD = require('../api/_shared/owner-desk.js');
const server = require('../api/_shared/owner-desk-server.js');

const SALES = [
  'Name,Created at,Total,Lineitem name,Lineitem quantity,Lineitem price,Currency',
  '#1001,2026-08-03 10:00:00 +0530,1200,Tea A,2,500,INR',
  '#1001,2026-08-03 10:00:00 +0530,,Tea B,1,200,INR',
  '#1002,2026-08-20,800,Tea A,1,800,INR',
  '#1003,2026-09-05,1500,Tea C,3,500,INR',
  '#1004,2026-09-25,500,Tea B,1,500,INR',
].join('\n');
const EXPENSES = [
  'Date,Category,Amount',
  '2026-08-10,Packaging,300',
  '2026-08-15,Meta ads,400',
  '2026-09-10,Packaging,500',
  '2026-09-12,Meta ads,300',
  '2026-09-20,Rent,"600.00"',
].join('\n');
const ADS = [
  'Ad,Cost,Clicks,Impressions,Conversions',
  'Headline A,1000,200,10000,10',
  'Headline B,600,100,10000,6',
  'Headline C,900,40,10000,0',
  'Headline D,400,80,8000,2',
  'Total,2900,420,38000,18',
].join('\n');

test('the money X-ray: revenue by month, top products, biggest costs, margin and three sentences, from the files only', () => {
  const s = OD.readSales(SALES); const e = OD.readExpenses(EXPENSES);
  expect(s.orders.map((o) => o.revenue)).toEqual([1200, 800, 1500, 500]);   // an order's stated Total, once
  const x = OD.xray(s, e);
  expect(x.by_month).toEqual([
    { month: '2026-08', revenue: 2000, orders: 2, aov: 1000, expenses: 700, profit: 1300, margin: 0.65 },
    { month: '2026-09', revenue: 2000, orders: 2, aov: 1000, expenses: 1400, profit: 600, margin: 0.3 },
  ]);
  expect(x.top_products.map((p) => [p.product, p.revenue])).toEqual([['Tea A', 1800], ['Tea C', 1500], ['Tea B', 700]]);
  expect(x.biggest_expenses.map((c) => [c.category, c.amount])).toEqual([['Packaging', 800], ['Meta ads', 700], ['Rent', 600]]);
  expect(x.overall).toMatchObject({ revenue: 4000, expenses: 2100, profit: 1900, margin: 0.475 });
  expect(x.currency).toBe('INR');
  expect(x.questions).toEqual([]);
  expect(x.summary[0]).toMatch(/kept INR 1,900 of INR 4,000 in sales, a margin of 48%/);
  expect(x.summary[1]).toMatch(/biggest cost is Packaging at INR 800, 20% of sales/);
  expect(x.summary[2]).toMatch(/Packaging rose from INR 300 in 2026-08 to INR 500 in 2026-09/);

  // A month with sales and no expenses: its margin is not worked out, and it is asked.
  const more = OD.readSales(SALES + '\n#1005,2026-10-02,900,Tea A,1,900,INR');
  const y = OD.xray(more, e);
  const oct = y.by_month.find((r) => r.month === '2026-10');
  expect(oct).toMatchObject({ revenue: 900, expenses: null, margin: null, profit: null });
  expect(y.questions.join(' ')).toMatch(/no expenses for 2026-10/);
  expect(y.summary[y.summary.length - 1]).toMatch(/Answer the 1 question below/);
});

test('the what-if model: profit and break-even live, three scenarios ranked by profit with what each rests on', () => {
  const x = OD.xray(OD.readSales(SALES), OD.readExpenses(EXPENSES));
  const b = OD.baseline(x);
  expect([b.price.value, b.orders.value, b.ad_spend.value, b.cost_per_order.value, b.fixed_costs.value]).toEqual([1000, 2, 350, 200, 300]);
  expect(b.ad_spend.source).toMatch(/Meta ads/);
  const v = { price: 1000, orders: 2, ad_spend: 350, cost_per_order: 200, fixed_costs: 300 };
  expect(OD.evaluate(v)).toMatchObject({ profit: 950, break_even_orders: 1, margin_per_order: 800 });
  // No cost per order: no profit, and it says what is missing.
  expect(OD.evaluate(Object.assign({}, v, { cost_per_order: null }))).toMatchObject({ profit: null, missing: ['cost_per_order'] });

  const sc = OD.scenarios(v, {});
  expect(sc.ranked.map((r) => [r.key, r.profit])).toEqual([['price_up_10', 1150], ['ads_down_20', 1020]]);
  expect(sc.ranked[0].holds_if).toMatch(/more than 11% of orders are lost/);
  expect(sc.unranked.map((r) => r.key)).toEqual(['upsell']);          // no take rate given: not ranked
  expect(sc.recommend.key).toBe('price_up_10');
  // A stated loss changes the ranking; an upsell with its take rate joins it.
  const sc2 = OD.scenarios(v, { price_order_loss: 0.2, upsell_price: 200, upsell_take: 0.25 });
  expect(sc2.ranked.map((r) => r.key)).toEqual(['upsell', 'ads_down_20', 'price_up_10']);   // 1030, 1020, 790
  expect(sc2.ranked.find((r) => r.key === 'upsell').profit).toBe(1030);   // 2 x 0.25 x 200 x (1 - 0.2) = 80 more
});

test('fix your worst ad: cost per conversion for every ad, the one burning the most flagged, why in plain words', () => {
  const r = OD.readAds(ADS);
  expect(r.ads.map((a) => a.ad)).toEqual(['Headline A', 'Headline B', 'Headline C', 'Headline D']);   // the total row is not an ad
  const w = OD.worstAd(r);
  expect(w.ok).toBe(true);
  expect(w.medians.cpa).toBe(100);
  expect(w.ads.map((a) => [a.ad, a.cpa, a.excess])).toEqual([['Headline C', null, 900], ['Headline D', 200, 200], ['Headline A', 100, 0], ['Headline B', 100, 0]]);
  expect(w.why[0]).toMatch(/spent 900 and brought no conversion/);
  expect(w.why[1]).toMatch(/0\.40% click, against 1\.00%/);
  // Without conversions it names no worst ad.
  const noConv = OD.worstAd(OD.readAds('Ad,Cost,Clicks\nA,10,2\nB,20,3'));
  expect(noConv.ok).toBe(false);
  expect(noConv.worst).toBeNull();
});

test('review themes are counted in code, once per review', () => {
  const reviews = OD.readReviews('Review,Rating\n"Lovely tea, fast delivery",5\nSlow delivery,2\n"Slow delivery, slow, slow",1').reviews;
  const t = OD.reviewThemes(reviews, [
    { i: 0, themes: [{ theme: 'Taste', kind: 'praise' }, { theme: 'fast delivery', kind: 'praise' }] },
    { i: 1, themes: [{ theme: 'Slow delivery', kind: 'complaint' }] },
    { i: 2, themes: [{ theme: 'slow delivery', kind: 'complaint' }, { theme: 'slow  delivery', kind: 'complaint' }] },
    { i: 9, themes: [{ theme: 'invented', kind: 'complaint' }] },
  ]);
  expect(t.complaints).toEqual([expect.objectContaining({ theme: 'slow delivery', count: 2, share: 0.667 })]);
  expect(t.praise.map((p) => p.theme).sort()).toEqual(['fast delivery', 'taste']);
  expect(t.average).toBe(2.67);
});

const BRAND = {
  id: 'w-leaf', name: 'Leafline Teas', tagline: 'Single-estate tea, packed the week it is picked.',
  claims: ['Packed the week it is picked', 'Shipped across India in 3 days'],
  palette: { primary: '#2E7D4F', accent: '#C2410C', ink: '#222222', surface: '#FFFBF5' },
  typography: { heading: { family: 'Fraunces' }, body: { family: 'Inter' } },
  voice: { tone: 'warm and plain' }, regions: [{ code: 'IN', currency: 'INR', home: true }],
  brand_data: { style_lock: { photo_style: 'Soft window light, eye level, calm and warm', personality: 'warm, honest, unhurried, curious, plain', rules: ['No black backgrounds.', 'No text in photos.', 'Only our green and rust.'] } },
};
const scripted = (answer) => ({ callLLM: async () => ({ text: JSON.stringify(answer), provider: 'scripted' }) });

test('replacement ads are held to Google\'s limits and the brand\'s own claims, never cut, and carry an image prompt in its style', async () => {
  const out = await server.adFix({
    brand: BRAND, worst: { ad: 'Headline C' }, why: ['It spent 900 and brought no conversion.'],
    deps: scripted({ ads: [
      { angle: 'freshness', headline: 'Packed the week it is picked', description: 'Single-estate tea, packed the week it is picked.', image_brief: 'A tin on a window sill.' },
      { angle: 'too long', headline: 'Single estate tea packed fresh every single week', description: 'x', image_brief: '' },
      { angle: 'invented', headline: 'Clinically proven calm', description: 'Clinically proven to calm you in minutes.', image_brief: '' },
      { angle: 'speed', headline: 'At your door in 3 days', description: 'Shipped across India in 3 days.', image_brief: 'A parcel on a doorstep.' },
    ] }),
  });
  expect(out.ok).toBe(true);
  expect(out.by).toBe('model');
  expect(out.limits).toEqual({ headline: 30, description: 90 });
  expect(out.ads.length).toBe(3);
  for (const a of out.ads) { expect(a.headline.length).toBeLessThanOrEqual(30); expect(a.description.length).toBeLessThanOrEqual(90); }
  expect(JSON.stringify(out.ads)).not.toMatch(/proven/i);
  expect(out.dropped.map((d) => d.why).join(' ')).toMatch(/over Google's limit/);
  expect(out.dropped.map((d) => d.why).join(' ')).toMatch(/claims the brand does not state/);
  expect(out.ads[0].image_prompt).toMatch(/Soft window light, eye level/);
});

test('mined reviews quote only the customers\' own words, reply only to negative reviews and promise nothing, fix only counted themes', async () => {
  const list = [
    { text: 'The first flush is the best tea I have had all year.', rating: 5 },
    { text: 'Arrived in 3 days, still smelled fresh.', rating: 5 },
    { text: 'The tin was dented and the lid would not close.', rating: 2 },
    { text: 'Dented tin again. Disappointed.', rating: 1 },
  ];
  const out = await server.reviews({ brand: BRAND, list, deps: scripted({
    labels: [
      { i: 0, themes: [{ theme: 'taste', kind: 'praise' }] }, { i: 1, themes: [{ theme: 'fast delivery', kind: 'praise' }] },
      { i: 2, themes: [{ theme: 'damaged tin', kind: 'complaint' }] }, { i: 3, themes: [{ theme: 'damaged tin', kind: 'complaint' }] },
    ],
    quotes: [0, 3, 1],
    replies: [
      { i: 2, reply: 'Thank you for telling us about the dented tin. That should not happen, and we are looking at how tins are packed.' },
      { i: 3, reply: 'We are sorry. We will send you a full refund today.' },
      { i: 0, reply: 'Thank you!' },
    ],
    fixes: [{ theme: 'damaged tin', fix: 'Pack tins in a fitted sleeve.' }, { theme: 'price', fix: 'Lower prices.' }],
  }) });
  expect(out.ok).toBe(true);
  expect(out.themes.complaints).toEqual([expect.objectContaining({ theme: 'damaged tin', count: 2 })]);
  expect(out.quotes.map((q) => q.text)).toEqual([list[0].text, list[1].text]);   // the negative one is not quoted
  expect(out.replies.map((r) => r.i)).toEqual([2]);                              // the refund and the positive are dropped
  expect(out.dropped).toEqual([{ i: 3, why: 'it promised something the brand did not offer' }]);
  expect(out.unreplied).toEqual([3]);
  expect(out.fixes).toEqual([{ theme: 'damaged tin', fix: 'Pack tins in a fitted sleeve.', count: 2, of: 4 }]);

  const none = await server.reviews({ brand: BRAND, list, deps: { callLLM: async () => { throw new Error('down'); } } });
  expect(none).toMatchObject({ ok: false, error: 'no_model' });
});

test('a launch: three grounded concepts, then six visuals in the saved style, sized for where they run', async () => {
  const c = await server.launchConcepts({ brand: BRAND, product: { title: 'First Flush Darjeeling' }, customer: 'tea drinkers who care where it comes from', deps: scripted({ concepts: [
    { line: 'Tea packed the week it is picked', feeling: 'freshness you can taste', angle: 'freshness' },
    { line: 'The healthiest tea in India', feeling: 'pride', angle: 'health' },
    { line: 'From one estate to your cup in 3 days', feeling: 'closeness', angle: 'speed' },
  ] }) });
  expect(c.concepts.map((x) => x.line)).toEqual(['Tea packed the week it is picked', 'From one estate to your cup in 3 days', 'Single-estate tea, packed the week it is picked']);
  expect(c.dropped.map((d) => d.line)).toEqual(['The healthiest tea in India']);

  const v = server.launchVisuals({ brand: BRAND, concept: c.concepts[0], product: { title: 'First Flush Darjeeling', image_url: 'https://cdn.example/tin.jpg' } });
  expect(v.visuals.map((x) => x.size)).toEqual(['1920x1080', '1080x1080', '1080x1080', '1080x1080', '1080x1920', '1080x1920']);
  expect(v.style_locked).toBe(true);
  for (const x of v.visuals) {
    expect(x.prompt).toMatch(/same product, the same light/);
    expect(x.prompt).toMatch(/Soft window light/);
    expect(x.prompt).toMatch(/First Flush Darjeeling/);
  }
  expect(v.visuals[1].real_photo).toBe('https://cdn.example/tin.jpg');
  expect(server.launchVisuals({ brand: Object.assign({}, BRAND, { brand_data: {} }), concept: c.concepts[0] }).style_locked).toBe(false);
});

test('the saved brand style rides every prompt and every image preamble', () => {
  const rt = require('../api/_shared/brand-runtime.js');
  const block = rt.brandBlock(BRAND);
  expect(block).toMatch(/PERSONALITY \(five words, the brand's own\): warm, honest, unhurried, curious, plain/);
  expect(block).toMatch(/PHOTO STYLE \(every picture\): Soft window light/);
  expect(block).toMatch(/VISUAL RULES \(never break\): No black backgrounds\. No text in photos\./);
  const pre = require('../api/_shared/image-prompt.js').buildPreamble(BRAND, 'photo');
  expect(pre).toMatch(/Photo style, the brand's own: Soft window light/);
  expect(rt.brandBlock(Object.assign({}, BRAND, { brand_data: {} }))).not.toMatch(/PHOTO STYLE/);
});

test('the page shipped to browsers runs the same arithmetic module', () => {
  expect(fs.readFileSync(path.join(ROOT, 'owner-desk.js'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'api/_shared/owner-desk.js'), 'utf8'));
});

/* ── the page, in Chromium ─────────────────────────────────────────────── */

const HOST = 'http://app.example.test';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const DEVICE = Object.assign({}, BRAND, { id: 'local-leafline01', slug: 'leafline', status: 'active', storage: 'device', website: '', logo_url: '', favicon_url: '' });

test('the desk in a browser: files in, the X-ray, the live what-if, and the monthly report in its fixed layout', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.type()); await d.dismiss(); });
  await page.addInitScript((w) => { localStorage.setItem('lifecycle.brand.device.workspaces', JSON.stringify({ version: 1, active_id: w.id, workspaces: [w] })); }, DEVICE);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== HOST) {
      if (route.request().resourceType() === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
      return route.abort('failed');
    }
    if (url.pathname.startsWith('/api/')) {
      const action = url.searchParams.get('action'); const op = url.searchParams.get('op');
      if (action === 'auth' && op === 'status') return route.fulfill({ json: { ok: true, mode: 'device', reason: 'no_database_url' } });
      if (url.pathname === '/api/public-config' && !action) return route.fulfill({ json: { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } } });
      return route.fulfill({ json: { ok: true, entries: [], items: [], features: [], unmetered: true } });
    }
    const file = path.join(ROOT, url.pathname.replace(/^\//, '') || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HOST + '/owner-desk.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bsColors')).toContainText('#2E7D4F', { timeout: 15000 });
  await expect(page.locator('#bsPhoto')).toHaveValue('Soft window light, eye level, calm and warm');

  await page.locator('[data-tab="money"]').click();
  await page.setInputFiles('#mxSales', { name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from(SALES) });
  await page.setInputFiles('#mxExp', { name: 'expenses.csv', mimeType: 'text/csv', buffer: Buffer.from(EXPENSES) });
  await expect(page.locator('#mxResult')).toContainText('a margin of 48%');
  await expect(page.locator('#mxResult')).toContainText('Packaging rose from INR 300');
  await expect(page.locator('#mxResult svg rect')).toHaveCount(2);

  await page.locator('[data-tab="whatif"]').click();
  await expect(page.locator('[data-wf-profit]')).toHaveText('950');
  await page.locator('#wf-price').evaluate((el) => { el.value = '1100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('[data-wf-profit]')).toHaveText('1,150');
  await expect(page.locator('[data-recommend]')).toContainText('Test "Raise prices by 10%" first');

  await page.locator('[data-tab="ad"]').click();
  await page.setInputFiles('#adFile', { name: 'ads.csv', mimeType: 'text/csv', buffer: Buffer.from(ADS) });
  await expect(page.locator('#adResult tr.flag')).toContainText('Headline C');

  await page.locator('[data-tab="report"]').click();
  await page.selectOption('#rpMonth', '2026-09');
  await page.click('#rpBuild');
  const report = page.locator('#rpOut');
  for (const h of ['Numbers', 'What grew', 'What dropped', 'Why', 'Three moves for next week']) await expect(report).toContainText(h);
  await expect(report).toContainText('Pause or replace the ad "Headline C"');
  await page.click('#rpSave');
  await expect(page.locator('#rpKept [data-kept="2026-09"]')).toHaveCount(1);
  // Everything stays in this browser, under this brand.
  const kept = await page.evaluate(() => Object.keys(localStorage).filter((k) => /owner-desk\./.test(k)).length);
  expect(kept).toBeGreaterThanOrEqual(4);
  expect(dialogs).toEqual([]);
});

test('the desk fits a phone', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== HOST) return route.abort('failed');
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true, mode: 'device', reason: 'no_database_url' } });
    const file = path.join(ROOT, url.pathname.replace(/^\//, ''));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HOST + '/owner-desk.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
});
