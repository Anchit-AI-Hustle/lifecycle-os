// Remix a competitor's LAYOUT (2026-11-02, a gap against usefastlane.ai).
//
// Executed: api/_shared/layout-remix.js measures an ad image in the shipped
// Chromium launcher (render-browser.js) and maps it to the nearest
// static-ad.js template. The "competitor ads" here are drawn BY static-ad.js
// itself in a palette that is not the remixing brand's, so the right answer
// is known: each template must be measured back as itself (split and band
// also on the right side). Then the shipped router
// (/api/public-config?action=video-render&op=remix-layout) over the fake
// project: the brand's own photo, palette and words in the measured structure,
// none of the competitor's; refusals in sentences. Then the "Remix this
// layout" control on /ad-campaigns' Winning angles tab, in Chromium at 1280
// and 390.
const { test, expect } = require('@playwright/test');
const dns = require('dns');
const F = require('./lib/remix-fixtures');
const SA = require('../scripts/lib/static-ad.js');
const LR = require('../api/_shared/layout-remix.js');

const RIVAL_PHOTO = 'https://photos.rival.example.test/p.png';
const RIVAL_PAL = { primary: '#7A1F5C', accent: '#F2C14E', surface: '#FFF8EE', ink: '#2B1B24' };
const RIVAL_WORDS = 'RIVALCO ZESTY HEADLINE';
const photo = F.photoPng(600, 600, 3);

const fetchOf = (png) => async () => ({ ok: true, status: 200, headers: { get: (h) => (/content-type/i.test(h) ? 'image/png' : null) }, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length) });
async function rivalAd(page, spec) {
  const r = SA.renderStaticAd(Object.assign({ brandName: 'RivalCo', headline: RIVAL_WORDS, line: 'Rival line', price: '$20', compare: '$30', benefits: ['Rival claim one', 'Rival claim two'], cta: 'Rival button', image: RIVAL_PHOTO, palette: RIVAL_PAL }, spec));
  return F.drawAd(page, r.html, RIVAL_PHOTO, photo, 540);
}

test('each template, drawn as a competitor ad, is measured back as itself', async ({ page }) => {
  test.setTimeout(400_000);
  const cases = [];
  for (const theme of ['minimal', 'luxe', 'playful']) {
    for (const ratio of ['1:1', '9:16']) {
      for (const [template, seed] of [['split', 0], ['split', 1], ['band', 0], ['band', 1], ['type', 0], ['framed', 0], ['offer', 0], ['sticker', 0]]) cases.push({ theme, ratio, template, seed });
    }
  }
  cases.push({ theme: 'minimal', ratio: '1:1', template: 'overlay', seed: 0 }, { theme: 'minimal', ratio: '4:5', template: 'overlay', seed: 0 });
  const wrong = [];
  for (const c of cases) {
    const png = await rivalAd(page, c);
    const grid = await LR.measureImage('https://rival.example.test/ad.png', { assertUrl: async () => {}, fetchImpl: fetchOf(png) });
    const m = LR.measureLayout(grid);
    const sided = c.template === 'split' || c.template === 'band';
    if (!m.measurable || m.template !== c.template || (sided && m.seed !== c.seed) || m.ratio !== c.ratio) wrong.push(`${c.theme} ${c.ratio} ${c.template}/${c.seed} -> ${m.template}/${m.seed} ${m.ratio}: ${m.why}`);
  }
  expect(wrong, 'measured as another layout').toEqual([]);

  // A flat image has no structure to take: said, not guessed.
  const flat = await LR.measureImage('https://rival.example.test/flat.png', { assertUrl: async () => {}, fetchImpl: fetchOf(F.flatPng(400, 400, [200, 40, 90])) });
  const fm = LR.measureLayout(flat);
  expect(fm.measurable).toBe(false);
  expect(fm.why).toMatch(/one flat colour/);
  // A photograph with no type on it: the overlay layout, and the absence of type is said.
  const bare = LR.measureLayout(await LR.measureImage('https://rival.example.test/photo.png', { assertUrl: async () => {}, fetchImpl: fetchOf(F.photoPng(500, 500, 9)) }));
  expect(bare.template).toBe('overlay');
  expect(bare.why).toMatch(/no type area was measured/);
  // Same image, same answer.
  expect(LR.measureLayout(flat)).toEqual(fm);
});

test('the router remixes the measured structure with the brand\'s own photo, words and palette', async ({ page }) => {
  test.setTimeout(180_000);
  const A = require('./agents-harness');
  const H = require('./router-harness');
  const rivalPng = await rivalAd(page, { theme: 'minimal', ratio: '1:1', template: 'split', seed: 1 });
  const realLookup = dns.promises.lookup;
  dns.promises.lookup = async (host, o) => (/\.example\.test$/.test(host) ? [{ address: '93.184.216.34', family: 4 }] : realLookup.call(dns.promises, host, o));
  const w = await A.world({ routers: { '/api/public-config': 'api/public-config.js' } });
  try {
    const uid = 'user-remix', tok = H.jwtShaped(uid), other = H.jwtShaped('user-out');
    const BRAND_HERO = 'https://cdn.calmbrand.example.test/pack.png';
    w.db.addUser(tok, uid, 'remix@example.test').addUser(other, 'user-out', 'out@example.test').addWorkspace('ws-calm', uid, {
      name: 'Calm Coffee', slug: 'calm-coffee', website: 'https://calmbrand.example.test', status: 'active', tagline: 'Slow roasted in small batches',
      claims: ['Roasted every Monday', 'Single origin beans'],
      palette: { primary: '#0F5C3A', accent: '#E8B931', surface: '#FFFFFF', ink: '#1A1A1A' }, regions: [{ code: 'IN', currency: 'INR', home: true, store_url: 'https://calmbrand.example.test' }],
    }).setActive(uid, 'ws-calm');
    w.db.syncIdentityTables();
    w.db.insert('brand_catalog_products', { workspace_id: 'ws-calm', region: 'in', sku: 'calm-1', handle: 'calm-1', title: 'Calm Morning Blend', product_type: 'Coffee', collections: [], price: 450, currency: 'INR', image_url: BRAND_HERO, product_url: 'https://calmbrand.example.test/products/calm-1', source_url: 'https://calmbrand.example.test/products/calm-1' });
    const imgRes = (png) => ({ ok: true, status: 200, headers: { get: (h) => (/content-type/i.test(h) ? 'image/png' : null) }, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length), text: async () => '' });
    w.db.route((u) => u === 'https://ads.rival.example.test/split.png', () => imgRes(rivalPng));
    w.db.route((u) => u === 'https://ads.rival.example.test/missing.png', () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' }));
    const url = '/api/public-config?action=video-render&op=remix-layout';
    const body = { workspace_id: 'ws-calm', market: 'IN', ad: { competitor: 'RivalCo', ad_id: 'rv-77', image: 'https://ads.rival.example.test/split.png' }, headline: 'Roasted every Monday, at your door', cta: 'Shop now' };

    // Signed out: refused before anything is fetched.
    let r = await w.request(url, { json: body });
    expect(r.status, r.text).toBe(401);
    // Not a member of that brand.
    r = await w.request(url, { json: body, headers: { authorization: 'Bearer ' + other } });
    expect(r.status, r.text).toBe(403);
    // A member: the remix.
    r = await w.request(url, { json: body, headers: { authorization: 'Bearer ' + tok } });
    expect(r.status, r.text).toBe(200);
    const j = JSON.parse(r.text);
    expect(j.ok).toBe(true);
    expect(j.remix_of).toMatchObject({ competitor: 'RivalCo', ad_id: 'rv-77', image: body.ad.image, not_taken: 'their words, claims, offer, prices, photographs and colours' });
    expect(j.remix_of.structure_taken).toMatchObject({ template: 'split', ratio: '1:1' });
    expect(j.design.template).toBe('split');
    const drawnAd = j.static_html;
    expect(drawnAd).toContain('data-template="split"');
    expect(drawnAd).toContain(BRAND_HERO);
    expect(drawnAd).toContain('Roasted every Monday, at your door');
    // None of the competitor's: words, photo, colours.
    expect(drawnAd).not.toContain(RIVAL_WORDS);
    expect(drawnAd).not.toContain('Rival');
    expect(drawnAd).not.toContain('ads.rival.example.test');
    for (const hex of Object.values(RIVAL_PAL)) expect(drawnAd.toLowerCase()).not.toContain(hex.toLowerCase());
    // The measured side is kept: the competitor's photo was on the right, so is ours.
    expect(drawnAd.indexOf('data-ad-panel')).toBeLessThan(drawnAd.indexOf('data-ad-photo'));

    // No image on the ad: said, nothing fetched.
    r = await w.request(url, { json: Object.assign({}, body, { ad: { competitor: 'RivalCo', image: '' } }), headers: { authorization: 'Bearer ' + tok } });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.text).message).toMatch(/has no image to measure a layout from/);
    // An image that cannot be read: said.
    r = await w.request(url, { json: Object.assign({}, body, { ad: { competitor: 'RivalCo', image: 'https://ads.rival.example.test/missing.png' } }), headers: { authorization: 'Bearer ' + tok } });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.text).message).toMatch(/could not be read .*HTTP 404/);
    // A private address is refused by the guard on every hop.
    r = await w.request(url, { json: Object.assign({}, body, { ad: { competitor: 'RivalCo', image: 'https://127.0.0.1/a.png' } }), headers: { authorization: 'Bearer ' + tok } });
    expect(r.status).toBe(422);
  } finally {
    dns.promises.lookup = realLookup;
    await w.close();
  }

  // No product with its own photo: the measured layout is said, with the marker; no ad.
  const out = await LR.remix({ brand: { name: 'Bare Brand' }, market: 'IN', ad: { competitor: 'RivalCo', image: 'https://ads.rival.example.test/split.png' },
    deps: { hero: null, measureImage: async () => (await LR.measureImage('https://x.example.test/a.png', { assertUrl: async () => {}, fetchImpl: fetchOf(rivalPng) })) } });
  expect(out.ok).toBe(false);
  expect(out.message).toMatch(/DATA REQUIRED BEFORE LAUNCH: product image, Bare Brand, IN/);
});

/* ── the control on the Winning angles tab ─────────────────────────────── */
const TH = require('./lib/brand-theme-harness.js');
const NAME = TH.define('remix-calm', {
  name: 'Calm Coffee', slug: 'calm-coffee', palette: { primary: '#0F5C3A', accent: '#E8B931', ink: '#1A1A1A', surface: '#FFFFFF' },
  regions: [{ code: 'IN', currency: 'INR', home: true, store_url: 'https://calmbrand.example.test' }], claims: ['Roasted every Monday'],
});

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`"Remix this layout" sends the ad's image and shows the brand's own static with what was taken (${vp.width})`, async ({ page }) => {
    const rivalPng = await rivalAd(page, { theme: 'minimal', ratio: '1:1', template: 'band', seed: 0 });
    const remixed = await LR.remix({ brand: { name: 'Calm Coffee', palette: { primary: '#0F5C3A', accent: '#E8B931', ink: '#1A1A1A', surface: '#FFFFFF' } }, market: 'IN', headline: 'Roasted every Monday', cta: 'Shop now',
      ad: { competitor: 'RivalCo', ad_id: 'rv-1', image: 'https://ads.rival.example.test/band.png' },
      deps: { hero: { title: 'Calm Morning Blend', image: 'https://cdn.calmbrand.example.test/pack.png' }, measureImage: () => LR.measureImage('https://x.example.test/a.png', { assertUrl: async () => {}, fetchImpl: fetchOf(rivalPng) }) } });
    expect(remixed.ok).toBe(true);
    const answer = { ok: true, brand: 'Calm Coffee', market: 'IN', competitors: ['RivalCo'], report: { read: 2, note: '2 competitor ads read.', hooks: [], formats: [], personas: [],
      ads: [{ competitor: 'RivalCo', ad_id: 'rv-1', image: 'https://ads.rival.example.test/band.png', format: 'image', days: 64 }, { competitor: 'OtherCo', ad_id: 'oc-2', image: 'https://ads.rival.example.test/none.png', format: 'image', days: 12 }] },
      angles: [], hooks: { bank: [], count: 0 }, briefs: [{ id: 'brief-1', basis: 'angle', rank: 1, angle_name: 'Freshness', hook: 'Roasted every Monday', cta: 'Shop now', primary_text: 'x', headline: 'y' }], statics: [], statics_note: '', test_plan: { rows: [] }, gaps: [] };
    const sent = [];
    await page.setViewportSize(vp);
    await TH.install(page, NAME);
    await page.route('**/api/brain?action=ad-angle-lab', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }));
    await page.route('https://ads.rival.example.test/**', (rt) => rt.fulfill({ status: 200, contentType: 'image/png', body: rivalPng }));
    await page.route('**/api/public-config?action=video-render&op=remix-layout*', (rt) => {
      const b = JSON.parse(rt.request().postData() || '{}'); sent.push(b);
      if (b.ad.ad_id === 'oc-2') return rt.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'no_structure', message: 'The image is one flat colour: no photograph and no type were found to take a structure from. Nothing was remixed.' }) });
      return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remixed) });
    });
    expect(await TH.open(page, 'ad-campaigns.html#angles', NAME), 'the brand painted').toBe(true);
    await page.evaluate(() => { if (window.LifecycleStatus) { window.LifecycleStatus.decide = async () => null; window.LifecycleStatus.refusal = () => null; } });
    await page.locator('.tab[data-tab="angles"]').click();
    await page.locator('#al-run').click();
    await expect(page.locator('#al-remix [data-remix-card]')).toHaveCount(2);
    await page.locator('[data-remix="0"]').click();
    await expect(page.locator('[data-remix-card="0"] iframe[data-remix-static]')).toHaveCount(1);
    expect(sent[0]).toMatchObject({ market: 'IN', ad: { competitor: 'RivalCo', ad_id: 'rv-1', image: 'https://ads.rival.example.test/band.png' }, headline: 'Roasted every Monday', cta: 'Shop now' });
    await expect(page.locator('[data-remix-card="0"] [data-remix-why]')).toContainText('Structure taken: band');
    await expect(page.locator('[data-remix-card="0"] [data-remix-why]')).toContainText('Not taken: their words');
    const srcdoc = await page.locator('[data-remix-card="0"] iframe').getAttribute('srcdoc');
    expect(srcdoc).toContain('cdn.calmbrand.example.test/pack.png');
    // A refusal is shown on its own card; the first remix stays.
    await page.locator('[data-remix="1"]').click();
    await expect(page.locator('[data-remix-card="1"] [data-remix-refused]')).toContainText('one flat colour');
    await expect(page.locator('[data-remix-card="0"] iframe[data-remix-static]')).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(1);
  });
}
