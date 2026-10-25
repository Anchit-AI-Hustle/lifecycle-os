// An image prompt is ABOUT the active brand's selected product, or there is no
// image.
//
// Production, 2026-10-10: with "Deli Chic" active (a chicken and cold-cuts food
// brand; products like "Chicken Drumsticks Antibiotic Residue Free"), the
// Studio's Final Output hero was an AI-generated photograph of white SNEAKERS
// with green leaves. The Studio's own image prompts never named the product
// ("the product exactly as it appears in its catalogue photograph"), described
// another brand's scenes ("a steaming pair on a chalk marble surface", "the
// sneaker box is the star", "deep deep purple, warm antique lava accents"), and
// the server asked for mode:'design' - a raster picture of a whole email.
//
// This file EXECUTES both ends:
//   1. the shipped Studio page under a Deli-shaped device brand, pressing its
//      "Generate hero photo" button and capturing the exact request body it
//      sends to /api/ai/image;
//   2. the shipped api/ai/image.js (credits + request-scope wrappers, the real
//      brand resolution) for a signed-in account whose workspace is that
//      brand, with every image provider answered by a recorder - so the prompt
//      judged is the one each provider would really have been sent.
//
// Run: npx playwright test tests/image-prompt-subject.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const A = require('./agents-harness');
const H = require('./router-harness');
const BT = require('./lib/brand-theme-harness');

const PALETTE = { primary: '#ffa517', accent: '#0e0101', ink: '#1d1b1b', surface: '#ffffff' };
const TYPO = { heading: { family: 'Poppins', stack: "'Poppins',Helvetica,Arial,sans-serif" }, body: { family: 'Poppins', stack: "'Poppins',Helvetica,Arial,sans-serif" } };
const REGIONS = [{ code: 'IN', currency: 'INR', symbol: '₹', store_url: 'https://delichic.example.test', home: true }];
const DELI = BT.define('image-deli-shaped', {
  name: 'Deli Chic Fixture', slug: 'deli-chic-fixture', palette: PALETTE, typography: TYPO, regions: REGIONS,
  record: { industry: 'Food: chicken and cold cuts', website: 'https://delichic.example.test', claims: ['Antibiotic residue free chicken'] },
});
const HERO = { region: 'in', handle: 'chicken-drumsticks', title: 'Chicken Drumsticks Antibiotic Residue Free', product_type: 'Chicken', price: '349', currency: 'INR', image_url: 'https://cdn.delichic.example.test/drumsticks.jpg', product_url: 'https://delichic.example.test/products/chicken-drumsticks', source: 'csv' };

// Another brand's subject or palette in an image prompt.
const FOREIGN = /sneaker|\bshoes?\b|footwear|\bkicks?\b|colorway|knickgasm|#d0473e|#6a33d8|chalk|steaming|aesop|kinfolk|glossier|deep greens?|\btea\b/i;

/** Run the shipped Studio and press its hero-photo button; return the request body it sends. */
async function studioRequest(page, { withProduct }) {
  const row = await BT.install(page, DELI);
  await page.addInitScript(({ id, rows }) => {
    try {
      localStorage.setItem('lifecycle.brand.device.workspaces.catalog.' + id, JSON.stringify({ products: rows, source: { kind: 'csv', row_count: rows.length, region: 'in' }, owned: true, region: 'in' }));
    } catch (_) {}
  }, { id: row.id, rows: [HERO] });
  const sent = [];
  await page.route('**/api/ai/image', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, provider: 'recorder', image_data_url: 'data:image/png;base64,iVBORw0KGgo=' }) });
  });
  expect(await BT.open(page, 'studio', DELI)).toBe(true);
  await page.evaluate(() => window.studioCatalogReady && window.studioCatalogReady());
  await page.waitForFunction(() => (window.CAT || []).length >= 1, null, { timeout: 15_000 });
  await page.evaluate(() => { window.S.manualProds = [window.CAT[0]]; });
  await page.fill('#promptIn', 'Weekend barbecue: our chicken drumsticks for the family grill');
  await page.evaluate(() => window.go2 && window.go2());
  await page.evaluate(() => window.go3 && window.go3()).catch(() => null);
  await page.waitForFunction(() => { const p = document.getElementById('p4'); return p && getComputedStyle(p).display !== 'none'; }, null, { timeout: 30_000 });
  if (!withProduct) await page.evaluate(() => { window.S.strategy.products = []; window.S.finalProds = []; });
  await page.evaluate(() => window.switchP4Tab('upload', document.getElementById('tab-upload')));
  await page.locator('#serverGenBtn').click();
  await page.waitForTimeout(600);
  return sent;
}

test.describe.configure({ mode: 'serial' });

test('the Studio asks for a hero PHOTO of the selected product, by name, in the brand\'s palette - and asks for nothing without one', async ({ page }) => {
  test.setTimeout(120_000);
  const sent = await studioRequest(page, { withProduct: true });
  expect(sent.length, 'the hero-photo button sent no request').toBe(1);
  const b = sent[0];
  expect(b.mode, 'a photograph, never a picture of an email').toBe('photo');
  expect(b.require_product).toBe(true);
  expect(b.product.title).toBe(HERO.title);
  expect(b.product.image_url).toBe(HERO.image_url);
  expect(b.prompt).toContain(HERO.title);
  expect(b.prompt).toContain('Deli Chic Fixture');
  expect(b.prompt).toContain('#ffa517');
  expect(b.prompt.split('\n')[0]).toMatch(/^DELIVERABLE: HERO PHOTOGRAPH \(image\) - ONE ELEMENT/);
  expect(b.prompt).not.toMatch(FOREIGN);
  test.info().annotations.push({ type: 'studio-body', description: JSON.stringify(b).slice(0, 400) });
  globalThis.__studioImageBody = b;
});

test('with no product selected the Studio sends no image request at all', async ({ page }) => {
  test.setTimeout(120_000);
  const sent = await studioRequest(page, { withProduct: false });
  expect(sent, 'an image was requested with nothing to photograph').toEqual([]);
});

test('api/ai/image.js sends every provider a prompt about THIS product, and refuses a product-less request before any provider', async () => {
  test.setTimeout(120_000);
  const w = await A.world({ routers: { '/api/ai/image': 'api/ai/image.js' } });
  const recorded = [];
  const fail = () => ({ ok: false, status: 500, headers: { get: () => null }, text: async () => 'recorder', json: async () => ({ error: { message: 'recorder' } }), arrayBuffer: async () => new ArrayBuffer(0) });
  try {
    const uid = 'user-deli', tok = H.jwtShaped(uid);
    w.db.addUser(tok, uid, 'deli@example.test').addWorkspace('ws-deli', uid, {
      name: 'Deli Chic Fixture', slug: 'deli-chic-fixture', industry: 'Food: chicken and cold cuts', website: 'https://delichic.example.test',
      palette: PALETTE, typography: TYPO, voice: { tone: 'warm', banned: [] }, regions: REGIONS,
      brand_data: { claims: ['Antibiotic residue free chicken'] }, status: 'active', created_at: '2026-09-20T00:00:00.000Z',
    }).setActive(uid, 'ws-deli');
    w.db.workspaces['ws-oldest'].created_at = '2026-01-01T00:00:00.000Z';
    w.db.syncIdentityTables();
    // Every image provider this route can call, answered by a recorder.
    w.db.route((u) => /api\.openai\.com|generativelanguage\.googleapis\.com|image\.pollinations\.ai|api\.cloudflare\.com/.test(u), (u, init) => {
      let prompt = '';
      if (/pollinations/.test(u)) prompt = decodeURIComponent(u.split('/prompt/')[1].split('?')[0]);
      else { try { const j = JSON.parse(init.body); prompt = j.prompt || JSON.stringify(j.contents || j.instances || j); } catch (_) { prompt = String(init && init.body); } }
      recorded.push({ host: new URL(u).host, prompt });
      return fail();
    });
    const auth = { authorization: 'Bearer ' + tok };
    const body = globalThis.__studioImageBody || {
      prompt: 'DELIVERABLE: HERO PHOTOGRAPH (image) - ONE ELEMENT of the Deli Chic Fixture email.\nSubject: "' + HERO.title + '" (Chicken).',
      mode: 'photo', size: '1024x1024', quality: 'high', require_product: true,
      product: { title: HERO.title, category: 'Chicken', image_url: HERO.image_url },
    };
    w.reset();
    const r = await w.request('/api/ai/image', { json: body, headers: auth });
    expect(r.status, r.text).toBe(200);
    expect(recorded.length, 'no provider was asked: the route never reached the cascade').toBeGreaterThan(0);
    for (const c of recorded) {
      expect(c.prompt, `${c.host}: the product is not named`).toContain(HERO.title);
      expect(c.prompt, `${c.host}: the brand's own palette`).toContain('#ffa517');
      expect(c.prompt, `${c.host}: another brand's subject or palette`).not.toMatch(FOREIGN);
    }
    // "Kill the AI Tell" (render-rules.js): a photo is asked for phone-camera
    // light, never the studio bar the rules ban.
    // Pollinations keeps 1,500 characters: the packaging ban and the render
    // rules are both inside what it receives.
    for (const c of recorded.filter((x) => /pollinations/.test(x.host))) {
      expect(c.prompt.length).toBeLessThanOrEqual(1500);
      expect(c.prompt, 'the packaging ban was cut off').toMatch(/actual retail packaging or labels \(those are photographed, never generated\)/);
      expect(c.prompt, 'the render rules were cut off').toMatch(/window spill/);
      expect(c.prompt).toMatch(/Show only the product: add no other object/);
      // The ban leads, ahead of the subject line, however long it is.
      expect(c.prompt.indexOf('actual retail packaging')).toBeLessThan(c.prompt.indexOf('SUBJECT:'));
    }
    for (const c of recorded.filter((x) => !/pollinations/.test(x.host))) {
      expect(c.prompt, `${c.host}: the render rules`).toMatch(/window spill/);
      expect(c.prompt, `${c.host}: the studio quality bar`).not.toMatch(/professional colour grading|natural soft lighting/);
    }
    // No product, and the caller asked for one: refused before ANY provider.
    recorded.length = 0;
    w.reset();
    const r2 = await w.request('/api/ai/image', { json: { prompt: 'a hero photograph', mode: 'photo', size: '1024x1024', require_product: true }, headers: auth });
    expect(r2.status).toBe(422);
    expect(JSON.parse(r2.text).message).toMatch(/DATA REQUIRED BEFORE LAUNCH: hero product, Deli Chic Fixture/);
    expect(recorded, 'a provider was called for a request with nothing to photograph').toEqual([]);
  } finally {
    await w.close();
  }
});
