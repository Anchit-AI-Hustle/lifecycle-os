// The STORY video ad (2026-10-24). The operator: "ensure video ads are proper
// video ads upto 30 s; current video ads are basically transitional ads - keep
// this variant too". Every video ad Smart Brain builds carries BOTH: the
// transitional creative (motion_html) and a timed story up to 30 seconds
// (story_html) that the reviewer can save as a video file.
//
// Executed: Smart Brain's shipped buildCampaign (template path) for a brand
// with four pictured products; the story page played in Chromium with frames
// read at set times; "Save as video" recorded through MediaRecorder and the
// file's bytes checked; a photo host with no CORS is said, not recorded blank.
//
// Run: npx playwright test tests/story-video-ad.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SA = require(path.join(ROOT, 'scripts', 'lib', 'story-ad.js'));
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];

const BR = {
  id: 'device:lensline', slug: 'lensline', name: 'Lensline', website: 'https://www.lensline.example',
  palette: { primary: '#000042', accent: '#4d4d4d', ink: '#000042', surface: '#ffffff' },
  regions: [{ code: 'IN', currency: 'INR', store_url: 'https://www.lensline.example', home: true }],
};
const P = (t, n, price) => ({ sku: 'S' + n, title: t, handle: 'p' + n, image: `https://cdn.lensline.example/${n}.jpg`, price, url: `https://www.lensline.example/p${n}.html` });
const SLOT = {
  id: 'll-1', date: '2026-10-28', market: 'IN', objective: 'reactivation', brand: BR,
  cohort: { name: 'At Risk', size: null, estimated: true }, channels: ['email', 'meta', 'tiktok', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 },
  heroProduct: P('Lacelle Lens Lacelle Lens Topaz Blue Powered Quarterly', 1, 759),
  supportingProducts: [P('Lacelle Topaz Blue Zero Power Quarterly', 2, 1299), P('Lacelle Blue Powered Quarterly', 3, 759), P('Lacelle Dark Hazel Powered Quarterly', 4, 759)],
};

async function build() {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return await require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js')).buildCampaign(JSON.parse(JSON.stringify(SLOT)), smartConfig({}), { noLLM: true, withCreatives: false });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#7d93b8"/></svg>';

test('every video ad carries both variants: the transitional creative and a story of at most 30 seconds', async () => {
  const c = await build();
  const vids = (c.assets.ads || []).filter((a) => a.creative_type === 'video');
  expect(vids.length).toBeGreaterThan(0);
  for (const v of vids) {
    expect(v.creative.motion_html, `${v.platform}: the transitional variant was dropped`).toMatch(/<!doctype html>/i);
    expect(v.creative.story_html, `${v.platform}: no story video`).toMatch(/<canvas id="v" width="1080" height="1920"/);
    const b = v.creative.story_brief;
    expect(b.duration_s).toBeLessThanOrEqual(SA.MAX_SECONDS);
    expect(b.duration_s).toBeGreaterThanOrEqual(15);
    expect(b.scenes[0].kind).toBe('hook');
    expect(b.scenes[b.scenes.length - 1].kind).toBe('end');
    const prods = b.scenes.filter((s) => s.kind === 'product');
    // Each product of the send, once, its name as the store gives it (the
    // doubled leading phrase dropped) and its price in the market's format.
    expect(prods.map((s) => s.text)).toEqual(['Lacelle Lens Topaz Blue Powered Quarterly', 'Lacelle Topaz Blue Zero Power Quarterly', 'Lacelle Blue Powered Quarterly', 'Lacelle Dark Hazel Powered Quarterly']);
    expect(prods.map((s) => s.price)).toEqual(['₹759', '₹1,299', '₹759', '₹759']);
    // No line is said twice across the story.
    const said = b.scenes.map((s) => String(s.text || '').toLowerCase()).filter(Boolean).slice(0, -1);
    expect(new Set(said).size).toBe(said.length);
  }
});

test('a long story is cut in the middle, never past 30 seconds and never losing its hook or end card', () => {
  const spec = { brandName: 'X', hook: 'Hook line', lines: ['One more line here', 'Two more lines here', 'Three more lines here'],
    products: [1, 2, 3, 4, 5, 6].map((n) => ({ title: 'Product ' + n, price_text: '₹' + n })), cta: 'Shop' };
  const sc = SA.storyScenes(spec);
  const total = sc.reduce((a, s) => a + s.seconds, 0);
  expect(total).toBeLessThanOrEqual(30);
  expect(sc[0].kind).toBe('hook');
  expect(sc[sc.length - 1].kind).toBe('end');
  expect(sc.filter((s) => s.kind === 'product').length).toBe(4);
});

test('the story plays in a browser, frame by frame, and saves as a real video file', async ({ page }) => {
  test.setTimeout(90_000);
  const c = await build();
  const v = c.assets.ads.find((a) => a.creative_type === 'video');
  await page.route('**/*', (r) => (r.request().resourceType() === 'image'
    ? r.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: PHOTO })
    : r.continue()));
  await page.route('https://story.test/', (r) => r.fulfill({ contentType: 'text/html', body: v.creative.story_html }));
  await page.goto('https://story.test/');
  // The canvas changes over time: a frame at 0.5 s and one in the next scene differ.
  const px = () => page.evaluate(() => { const c = document.getElementById('v'); return c.toDataURL('image/png').length + ':' + Array.from(c.getContext('2d').getImageData(540, 1500, 1, 1).data).join(','); });
  await page.waitForTimeout(500);
  const a = await px();
  await page.waitForTimeout(4200);
  const b = await px();
  expect(a, 'the story did not move').not.toBe(b);
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.click('#save');
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/^lensline-story-\d+s\.(mp4|webm)$/);
  const file = await d.path();
  const size = require('fs').statSync(file).size;
  expect(size, 'the saved video is empty').toBeGreaterThan(50_000);
});

test('a photo host that refuses recording is said, and nothing blank is saved', async ({ page }) => {
  const html = SA.renderStoryAd({ brandName: 'X', hook: 'Hook line', products: [{ title: 'P', price_text: '₹1', image: 'https://nocors.test/p.jpg' }], cta: 'Shop',
    palette: { primary: '#000042', on_primary: '#ffffff', accent: '#ffffff', on_accent: '#000042', surface: '#ffffff', ink: '#000042' } });
  // Playwright answers a fulfilled cross-origin read permissively, so the
  // refusal is modelled as a browser sees it: the CORS request (it carries an
  // Origin header) fails; the plain display request is served.
  await page.route('https://nocors.test/**', (r) => (r.request().headers().origin ? r.abort('accessdenied') : r.fulfill({ contentType: 'image/svg+xml', body: PHOTO })));
  await page.route('https://story.test/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://story.test/');
  await page.waitForTimeout(800);
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.click('#save');
  await expect(page.locator('#note')).toContainText('cannot be saved here');
  await page.waitForTimeout(500);
  expect(downloaded).toBe(false);
});
