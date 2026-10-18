// A brand with no catalogue still gets a picture in every visual asset, on the
// /brain View build too (2026-10-18).
//
// The operator: "brands without catalog are not being able to generate
// appropriate visuals in the marketing assets". Measured on the shipped
// builder: a brand with no catalogue and no imagery of its own shipped 0
// pictures across 4 mail variants, 2 landing pages and 8 ads. The generated
// brand scene (brand-imagery.js: the brand's world in its palette, no product,
// no text, labelled) was made only when a build asked for creatives, and the
// View build (previewEntry) does not.
//
// Executed: the shipped buildCampaign with a scripted model; global.fetch plays
// the free image host, so the real probe and cache run. The visual mailer is
// rendered in Chromium and its picture measured.
//
// Run: npx playwright test tests/brand-scene-every-build.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const IMAGERY = require.resolve(path.join(ROOT, 'api', '_shared', 'brand-imagery.js'));
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];
const HOST = 'https://image.pollinations.ai/prompt/';

const brand = (slug, extra) => Object.assign({
  id: 'device:' + slug, slug, name: 'Ledgerline Gazette ' + slug, website: `https://${slug}.example`, industry: 'news publishing',
  tagline: 'Pune news, checked twice by the desk',
  palette: { primary: '#7B2D5E', accent: '#C8A13B', ink: '#2A1F33', surface: '#FBF7EF' },
  regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ['Reporters in all 14 Pune wards'], legal_entity: 'Ledgerline Media LLP, Pune, India',
}, extra || {});
const slot = (b, id) => ({ id, date: '2026-10-20', market: 'IN', objective: 'reactivation', brand: b, cohort: { name: 'At Risk', size: 1200, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 } });
const COPY = (b) => ({
  email: { subject: `${b.name}: it has been a while`, preheader: 'What is new', hook: 'h', hero_headline: 'Back to the desk', intro_paragraph: `${b.claims[0]}.`, body_paragraph: '', benefits: b.claims.slice(), rating: null, reviews: [], badges: [], guarantee: '', ps: '', faq: [], cta: 'Start reading', image_brief: 'x' },
  landing: { hero_headline: 'Back to the desk', hero_sub: `${b.tagline}.`, why_title: 'Why', why_bullets: b.claims.slice(), proof_quote: '', proof_author: '', faq: [], cta: 'Start reading', image_brief: 'y' },
  ads: { meta: { primary_text: `${b.tagline}.`, headline: 'Back to the desk', description: 'd', image_brief: 'z' }, google: { headlines: ['Back to the desk'], descriptions: [`${b.tagline}.`], image_brief: 'w' }, tiktok: { script: 's', caption: b.tagline, image_brief: 'v' } },
});

// A JPEG-sized body (> 5,000 bytes) the probe accepts as a real picture.
const JPEG = Buffer.alloc(6000, 7);
let hostCalls = 0; let hostUp = true;
async function withWorld(fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const realFetch = global.fetch; const realLlm = require.cache[LLM]; const realPlan = require.cache[PLAN];
  global.fetch = async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    if (u.startsWith(HOST)) {
      hostCalls += 1;
      if (!hostUp) throw new Error('host down');
      return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    throw new Error('unexpected fetch ' + u);
  };
  try {
    const real = require(LLM);
    const stub = async (o) => ({ text: JSON.stringify(/strategy/.test(String(o.stage || '')) ? { angle: 'a', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] } : COPY(o.__brand || CUR)), provider: 'scripted', model: 'scripted' });
    Object.assign(stub, real, { keylessOnly: async () => false });
    require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
    delete require.cache[PLAN];
    return await fn(require(PLAN), require(path.join(ROOT, 'lib', 'smart-brain', 'services.js')).smartConfig({}));
  } finally {
    global.fetch = realFetch; require.cache[LLM] = realLlm; if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN];
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
let CUR = null;
const build = (plan, config, b, id, opts) => { CUR = b; return plan.buildCampaign(slot(b, id), config, opts); };
// Content pictures only: the logo in the mail's header (the brand's site icon
// when it has no logo) is not a picture of anything.
const srcs = (h) => [...String(h || '').matchAll(/<img\s[^>]*src="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')).filter((u) => !/\/s2\/favicons\?/.test(u));
function visuals(c) {
  const e = c.assets.email; const ads = c.assets.ads || [];
  return {
    main: srcs(e.html), visual: (e.variants || []).filter((v) => /visual/.test(v.key)).map((v) => srcs(v.html)),
    text: (e.variants || []).filter((v) => /text/.test(v.key)).map((v) => srcs(v.html)),
    lp: (c.assets.landing_pages || []).map((l) => srcs(l.html)),
    statics: ads.filter((a) => a.creative_type === 'static').map((a) => (a.creative && a.creative.image) || null),
    video: ads.filter((a) => a.creative_type === 'video').map((a) => String((a.creative && a.creative.motion_html) || '')),
  };
}

test.beforeEach(() => { hostCalls = 0; hostUp = true; require(IMAGERY)._resetScenes(); });

test('the View build of a brand with no catalogue and no imagery puts its brand scene in every visual asset', async ({ page }) => {
  const b = brand('scene-a');
  const c = await withWorld((plan, config) => build(plan, config, b, 'a1', { withCreatives: false }));
  const scene = require(IMAGERY).freeSceneUrl(b);
  const v = visuals(c);
  expect(c.image_source).toBe('generated');
  expect(c.generated_imagery && c.generated_imagery.url).toBe(scene);
  expect(c.generated_imagery.note, 'labelled as a generated scene that shows no product').toMatch(/generated brand scene.*no product/i);
  expect(v.main).toContain(scene);
  expect(v.visual.length).toBe(2); for (const s of v.visual) expect(s).toContain(scene);
  for (const s of v.text) expect(s, 'a Text mailer stays text').toEqual([]);
  expect(v.lp.length).toBeGreaterThan(0); for (const s of v.lp) expect(s).toContain(scene);
  expect(v.statics.length).toBeGreaterThan(0); for (const s of v.statics) expect(s).toBe(scene);
  expect(v.video.length).toBeGreaterThan(0); for (const h of v.video) expect(h.includes(scene.replace(/&/g, '&amp;')) || h.includes(scene), 'a video ad frames the scene').toBe(true);
  expect((c.data_gaps || []).join(' '), 'the product-photo gap is still said').toMatch(/DATA REQUIRED BEFORE LAUNCH: product image/);

  // The mail shows it: rendered in Chromium, the picture loads and has size.
  const html = c.assets.email.variants.find((x) => x.key === 'visual_a').html;
  await page.route(/^https?:\/\//, (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="#8a7"/></svg>' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(html, { waitUntil: 'load' });
  const shown = await page.evaluate((u) => { const img = [...document.images].find((i) => i.getAttribute('src') === u); if (!img) return null; const r = img.getBoundingClientRect(); return { w: r.width, h: r.height, natural: img.naturalWidth }; }, scene);
  expect(shown, 'the scene is in the rendered mail').not.toBeNull();
  expect(shown.natural).toBeGreaterThan(0);
  expect(shown.w).toBeGreaterThan(200); expect(shown.h).toBeGreaterThan(80);
});

test('one scene per brand: made once, reused by the next send and by the offline rebuild', async () => {
  const b = brand('scene-b');
  const [c1, c2, c3] = await withWorld(async (plan, config) => [
    await build(plan, config, b, 'b1', { withCreatives: false }),
    await build(plan, config, b, 'b2', { withCreatives: false }),
    await build(plan, config, b, 'b3', { noLLM: true, withCreatives: false }),
  ]);
  expect(hostCalls, 'the free host is asked once for the brand').toBe(1);
  for (const c of [c1, c2, c3]) expect(c.image_source).toBe('generated');
  expect(visuals(c3).main).toContain(require(IMAGERY).freeSceneUrl(b));
});

test('the offline rebuild never waits on the image host, and a host that is down gives no picture rather than a broken one', async () => {
  const fresh = brand('scene-c');
  const off = await withWorld((plan, config) => build(plan, config, fresh, 'c1', { noLLM: true, withCreatives: false }));
  expect(hostCalls, 'noLLM asks nothing of the host').toBe(0);
  expect(off.image_source).toBe(null);
  hostUp = false;
  const down = await withWorld((plan, config) => build(plan, config, brand('scene-d'), 'd1', { withCreatives: false }));
  expect(hostCalls).toBe(1);
  expect(down.image_source).toBe(null);
  expect(visuals(down).main).toEqual([]);
});

test('a brand with its own imagery uses it and asks the image host nothing; FREE_GENERATION=off makes no scene', async () => {
  const own = brand('scene-e', { imagery: [{ url: 'https://scene-e.example/img/newsroom.jpg', page: 'https://scene-e.example/', role: 'hero' }] });
  const c = await withWorld((plan, config) => build(plan, config, own, 'e1', { withCreatives: false }));
  expect(hostCalls).toBe(0);
  expect(c.image_source).toBe('brand-site');
  expect(visuals(c).main).toContain('https://scene-e.example/img/newsroom.jpg');
  const none = await withWorld((plan, config) => { process.env.FREE_GENERATION = 'off'; return build(plan, config, brand('scene-f'), 'f1', { withCreatives: false }); });
  expect(hostCalls).toBe(0);
  expect(none.image_source).toBe(null);
});
