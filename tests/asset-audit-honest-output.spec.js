// What the generators actually put in front of a customer (2026-10-17 audit).
//
// The operator: "rate each functionality and feature and output asset created
// by all features ... test everything thoroughly ... then fix all the issues".
// Building a campaign for four kinds of brand - one with its own catalogue,
// an app with no catalogue (Parwah-like), a news publisher, and a brand that
// is a name and nothing else - and rendering every asset found:
//   - the landing page carried three blocks of agency copy about no brand at
//     all ("Why ordinary solutions fall short", "Scattered handoffs & stalled
//     momentum", a "Performance benchmarked across channels" table marked
//     SELECTED / ACTIVE / UPDATED) on every brand's page;
//   - the template landing page's B variant printed one brand's claims ("works
//     seamlessly offline", "privacy and consent at the core") for EVERY brand,
//     and both variants and the template mailer fell back to invented claims
//     and FAQ answers ("100% authentic from <brand>'s verified collection");
//   - with no product, every ad's headline and primary text was the
//     "[DATA REQUIRED ...]" marker, Google headlines read "IN Edit" and a raw
//     tag list ("af1,gaming,aesthetic"), the CTA was "Shop Now" for a news
//     publisher, and Meta / TikTok copy ran past the platforms' limits;
//   - the mailer's eyebrow was "<Brand> Studio Spotlight", its benefits were
//     headed "The Transformation", the P.S. was printed twice, and a second
//     "Explore the collection" button went to the same page as the first;
//   - the landing hero's button had no visible fill when the accent equals the
//     band, and a store's tag list was printed as the product's category;
//   - a video scene with no photo set its line at the top of an empty frame.
//
// Executed: campaigns built by the shipped builders (template path and a
// scripted-model path), the shared renderers called directly.
//
// Run: npx playwright test tests/asset-audit-honest-output.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));

const APP = {
  id: 'device:famapp', slug: 'famapp', name: 'Famapp', website: 'https://famapp.example', industry: 'family app',
  tagline: 'The family superapp for papers, health details and an emergency card that works offline',
  palette: { primary: '#3A1450', accent: '#F5A623', ink: '#1D1320', surface: '#FFFAF0' },
  regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ['Works offline', 'Consent at the core'],
  legal_entity: 'Famapp Technologies Pvt Ltd, Bengaluru, India',
};
const NEWS = {
  id: 'device:gazette', slug: 'gazette', name: 'Ledgerline Gazette', website: 'https://ledgerline.example', industry: 'news publishing',
  tagline: 'Pune news, checked twice by the desk', palette: { primary: '#7B2D5E', accent: '#C8A13B', ink: '#2A1F33', surface: '#FBF7EF' },
  regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ['Reporters in all 14 Pune wards'],
  offerings: [{ kind: 'subscription', name: 'Morning Ledger', url: 'https://ledgerline.example/ledger' }],
  legal_entity: 'Ledgerline Media LLP, Pune, India',
};
const BARE = { id: 'device:bare', slug: 'bareco', name: 'Bareco', regions: [{ code: 'IN', home: true }] };

const slot = (brand, extra) => Object.assign({
  id: 'audit-' + brand.slug, date: '2026-10-20', market: 'IN', objective: 'reactivation', brand,
  cohort: { name: 'At Risk', size: 1200, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
  confidence: 0.6, offer: { depth: 'none', pct: 0 },
}, extra || {});

const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
async function build(entry, { scripted, withCreatives = false } = {}) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const realLlm = require.cache[LLM]; const realPlan = require.cache[PLAN];
  try {
    if (scripted) {
      const real = require(LLM);
      const stub = async (o) => ({ text: JSON.stringify(/strategy/.test(String(o.stage || '')) ? { angle: 'a', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] } : scripted), provider: 'scripted', model: 'scripted' });
      Object.assign(stub, real);
      require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
      delete require.cache[PLAN];
    }
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const plan = require(PLAN);
    return await plan.buildCampaign(entry, smartConfig({}), { noLLM: !scripted, withCreatives });
  } finally {
    if (scripted) { require.cache[LLM] = realLlm; if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN]; }
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const COPY = {
  email: { subject: 'Back where you left it', preheader: 'A short note', hook: 'h', hero_headline: 'Pick up where you left off', intro_paragraph: 'Intro.', body_paragraph: 'Body.', benefits: ['One', 'Two', 'Three'], rating: null, reviews: [], badges: [], guarantee: '', ps: 'Everything you saved is still there.', faq: [], cta: 'Continue', image_brief: 'x' },
  landing: { hero_headline: 'Ready when you are', hero_sub: 'Sub', why_title: 'Why', why_bullets: ['A', 'B', 'C'], proof_quote: '', proof_author: '', faq: [], cta: 'Continue', image_brief: 'y' },
  ads: { meta: { primary_text: 'p', headline: 'h', description: 'd', image_brief: 'z' }, google: { headlines: ['One', 'Two', 'Three'], descriptions: ['First description here.', 'Second description here.'], image_brief: 'w' }, tiktok: { script: 's', caption: 'c', image_brief: 'v' } },
};

const AGENCY_FILLER = /Why ordinary solutions fall short|Scattered handoffs|Disconnected touchpoints|Connected in three seamless steps|Direct-Response Activation|Performance benchmarked across channels|Campaign Architecture/;
const INVENTED = /100% authentic from|verified collection|Thoughtfully engineered|crafted with care and authentic quality|Engineered for reliability, simplicity|direct customer support|thoughtfully developed by|authentic support and dedicated care|privacy and consent at the core|Works seamlessly offline|everyday protection/i;
const textOf = (html) => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');

test('no landing page carries agency copy about no brand, and the top bar names no market code', async () => {
  for (const b of [APP, NEWS, BARE]) {
    for (const scripted of [null, COPY]) {
      const c = await build(slot(b), { scripted });
      for (const lp of c.assets.landing_pages) {
        expect(textOf(lp.html), `${b.name} landing ${lp.variant} (${scripted ? 'model' : 'template'})`).not.toMatch(AGENCY_FILLER);
        expect(lp.html).not.toMatch(/<div class="bar">[^<]*· IN\b/);
      }
    }
  }
});

test('the template assets say only what the brand states: no invented claims, FAQ answers or another brand\'s claims', async () => {
  for (const b of [{ ...NEWS, claims: [] }, BARE, NEWS]) {
    const c = await build(slot(b));
    const all = [c.assets.email.html, ...c.assets.landing_pages.map((l) => l.html)].map(textOf).join('\n');
    expect(all, `${b.name}`).not.toMatch(INVENTED);
    if (!b.claims || !b.claims.length) expect(all).not.toMatch(/offline|consent/i);
  }
});

test('with no product named, ads speak for the brand: no marker in the copy, within platform limits, a CTA that fits the business', async () => {
  for (const [b, cta] of [[APP, 'Learn more'], [NEWS, 'Start reading']]) {
    const c = await build(slot(b));
    for (const ad of c.assets.ads) {
      for (const f of ['headline', 'primary_text', 'caption', 'hook']) {
        expect(String(ad[f] || ''), `${b.name} ${ad.platform} ${ad.creative_type} ${f}`).not.toMatch(/DATA REQUIRED/);
      }
      if (ad.platform === 'meta') { expect(ad.headline.length).toBeLessThanOrEqual(40); expect(ad.primary_text.length).toBeLessThanOrEqual(125); }
      if (ad.platform === 'tiktok') expect(String(ad.caption).length).toBeLessThanOrEqual(100);
      if (ad.platform === 'google') {
        expect(ad.headlines.join('|')).not.toMatch(/\bEdit$|,|\bIN\b/);
        expect(ad.descriptions.length, `${b.name} google descriptions`).toBeGreaterThanOrEqual(2);
      }
      expect(ad.cta).toBe(cta);
    }
    expect(c.assets.email.subject).not.toMatch(/DATA REQUIRED/);
    expect(c.data_gaps.join(' ')).toMatch(/DATA REQUIRED/);
  }
  const news = await build(slot(NEWS));
  const g = news.assets.ads.find((a) => a.platform === 'google');
  expect(g.headlines, 'the brand\'s own named offering is a headline').toContain('Morning Ledger');
  expect(news.contract_check.blocking).toBe(0);
});

test('the model-path mailer: no studio eyebrow, no "The Transformation", one P.S., no second button to the same page', async () => {
  const c = await build(slot(APP), { scripted: COPY });
  for (const v of c.assets.email.variants) {
    const t = textOf(v.html);
    expect(t, v.key).not.toMatch(/Studio Spotlight|The Transformation/);
    expect((t.match(/P\.S\./g) || []).length, v.key).toBeLessThanOrEqual(1);
    expect(v.html, v.key).not.toContain('Explore the collection');
  }
});

test('a landing hero button stands off its band, and a raw tag list is never shown as the category', async () => {
  const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
  const plan = require(PLAN);
  const flat = { ...APP, palette: { primary: '#2B4A80', accent: '#2B4A80', ink: '#111827', surface: '#FFFFFF' } };
  const page = plan.lpHtml(slot(flat, { heroProduct: { title: 'Blue Kit', category: 'af1,gaming,aesthetic' } }), COPY, 'cid-1', null);
  const m = page.match(/\.hero \.btn\{background:(#[0-9a-fA-F]{6});color:(#[0-9a-fA-F]{6})\}/);
  expect(m, 'no hero button rule').toBeTruthy();
  const band = core.sectionGround('#2B4A80', '#2B4A80', '#FFFFFF');
  expect(core.contrast(m[1], band)).toBeGreaterThanOrEqual(1.5);
  expect(core.contrast(m[2], m[1])).toBeGreaterThanOrEqual(4.5);
  expect(textOf(page)).not.toMatch(/af1,gaming/i);
});

test('a video scene with no photo is centred under the brand\'s name', () => {
  const motion = require(path.join(ROOT, 'scripts', 'lib', 'motion-ad.js'));
  const ad = motion.renderMotionAd({ brand: APP, product: 'Famapp', scenes: [{ headline: 'Ready when you are' }, { headline: 'Famapp' }], cta: 'Learn more' });
  expect(ad).toMatch(/class="scene noimg"/);
  expect((ad.match(/class="mark"/g) || []).length, 'the mark is shown on the scene that does not already say the name').toBe(1);
  expect(ad).toMatch(/\.scene\.noimg \.type \{ top:50%/);
});

// The trigger mailer (`?action=trigger-mailer`) when no model answers: its
// fallback printed its own brief ("this: the facts the catalogue actually
// states, never invented ones", "Chosen for the At Risk segment.") with "this"
// as the subject, "Shop now" for a newspaper, a "/collections/bestsellers" link
// nobody gave it, and the market code beside the name.
async function trigger(brand, extra) {
  const CT = require.resolve(path.join(ROOT, 'api', '_shared', 'calendar-trigger.js'));
  const CI = require.resolve(path.join(ROOT, 'api', '_shared', 'creative-image.js'));
  const rt = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
  const saved = { llm: require.cache[LLM], ci: require.cache[CI], ct: require.cache[CT], resolve: rt.resolve };
  const real = require(LLM);
  const down = async () => { throw new Error('ALL PROVIDERS FAILED'); };
  Object.assign(down, real);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: down };
  require.cache[CI] = { id: CI, filename: CI, loaded: true, exports: { generateCreativeImage: async () => null, uploadCreative: async () => null } };
  delete require.cache[CT];
  rt.resolve = async () => brand;
  try {
    const handler = require(CT);
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: {}, body: { entry: Object.assign({ date: '2026-10-20', market: 'IN', segment: 'At Risk', content_type: 'promo', archetype: 'hero-led-editorial' }, extra || {}) } }, res);
    return res;
  } finally {
    rt.resolve = saved.resolve;
    require.cache[LLM] = saved.llm;
    if (saved.ci) require.cache[CI] = saved.ci; else delete require.cache[CI];
    if (saved.ct) require.cache[CT] = saved.ct; else delete require.cache[CT];
  }
}

test('the trigger mailer with no model: the brand\'s own words, its business\'s button, no brief text, no invented link', async () => {
  for (const [b, cta] of [[NEWS, 'Start reading'], [BARE, 'Learn more']]) {
    const res = await trigger(b);
    expect(res.statusCode).toBe(200);
    expect(res.body.strategy_heuristic).toBe(true);
    const S = res.body.strategy;
    expect(S.subject_line, b.name).not.toMatch(/^this$|DATA REQUIRED/);
    expect(S.cta_text).toBe(cta);
    for (const key of ['V1', 'V2']) {
      const mail = res.body.variants[key].html;
      const words = textOf(mail);
      expect(words, `${b.name} ${key}`).not.toMatch(/never invented|Why this one|segment|What makes it right|Shop now|Explore the collection/);
      expect(mail, `${b.name} ${key}`).not.toContain('/collections/');
      expect(words, `${b.name} ${key} names the market beside the brand`).not.toMatch(new RegExp(b.name.toUpperCase() + '\\s*·\\s*IN'));
    }
  }
  const news = await trigger(NEWS);
  expect(textOf(news.body.variants.V1.html)).toContain('Reporters in all 14 Pune wards');
  const visual = textOf(news.body.variants.V2.html);
  expect((visual.match(/checked twice by the desk/g) || []).length, 'the tagline under the logo repeats the headline').toBe(1);
});

test('an event send through the trigger mailer never prints the phase\'s brief as the subline', async () => {
  const ev = { kind: 'event', name: 'Ward Hall Live', starts_at: '2026-10-23T18:00:00+05:30', registration_url: 'https://ledgerline.example/hall', venue: 'Ward Hall' };
  const res = await trigger(NEWS, { heroOffering: ev });
  expect(res.body.strategy_heuristic).toBe(true);
  const words = textOf(res.body.variants.V1.html);
  expect(words).not.toMatch(/Close the undecided|Drive (the )?(reader|turnout)|Convert intent|segment/);
  expect(words, 'the subline is the brand\'s own tagline').toContain('Pune news, checked twice by the desk');
  expect(res.body.variants.V1.html).toContain('https://ledgerline.example/hall');
});

// Social Media OS with no model: every brand's posts carried one sneaker
// brand's lines, a sibling project's ("Your 3pm deserved better", "the
// ritual") and "Shop [DATA REQUIRED ...]" as the call to action.
test('the social fallback posts say only what the brand states, with its business\'s button', async () => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const SC = require.resolve(path.join(ROOT, 'api', '_shared', 'social-core.js'));
  const realLlm = require.cache[LLM]; const realSc = require.cache[SC];
  const real = require(LLM);
  const down = async () => { throw new Error('ALL PROVIDERS FAILED'); };
  Object.assign(down, real);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: down };
  delete require.cache[SC];
  try {
    const out = await require(SC).runDaily({ brand: NEWS, dry_run: true, date: '2026-10-20' });
    expect(out.posts.length).toBeGreaterThan(5);
    for (const p of out.posts) {
      const words = JSON.stringify(p.copy);
      expect(words, p.key).not.toMatch(/pair|footwear|Lacing|studio taught|3pm|ritual|DATA REQUIRED|Shop |origin-fresh|one-of-one|chalk linen/i);
      expect(p.cta, p.key).toBe('Start reading');
    }
    const feed = out.posts.find((p) => p.key === 'instagram_feed');
    expect(feed.copy.caption).toContain('Pune news, checked twice by the desk');
    expect(feed.copy.caption).toContain('Reporters in all 14 Pune wards');
  } finally {
    require.cache[LLM] = realLlm; if (realSc) require.cache[SC] = realSc; else delete require.cache[SC];
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

// The real product photo (2026-10-17): the static ads carried the catalogue
// photo, while the template mail had no image at all and the template landing
// page read entry.heroProduct.image, which nothing ever sets.
test('the template mail and both landing pages carry the product\'s own catalogue photo; a brand with none borrows nobody\'s', async () => {
  const fs = require('fs');
  const file = path.join(ROOT, 'data', 'catalog', 'products_us.json');
  test.skip(!fs.existsSync(file), 'the built catalogue (npm run build) is not here');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const p = (Array.isArray(raw) ? raw : raw.products).find((r) => r.h && r.n);
  const entry = { id: 'photo-zero', date: '2026-10-20', market: 'US', objective: 'reactivation', cohort: { name: 'At Risk', size: 500, rules: ['r'] },
    channels: ['email', 'meta', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 }, heroProduct: { sku: p.s, title: p.n, handle: p.h } };
  const c = await build(entry);
  const adPhoto = c.assets.ads.find((a) => a.creative_type === 'static').creative.image;
  expect(adPhoto, 'the static ad has the catalogue photo').toMatch(/^https:\/\//);
  const base = adPhoto.split('?')[0];
  const mailImg = c.assets.email.html.match(/<img[^>]+>/);
  expect(mailImg, 'the template mail has no image').toBeTruthy();
  expect(mailImg[0]).toContain(base);
  expect(mailImg[0]).toMatch(/alt="[^"]+"/);
  for (const lp of c.assets.landing_pages) expect(lp.html, `landing ${lp.variant}`).toContain(base);
  expect(c.contract_check.blocking).toBe(0);

  const other = await build(slot(APP, { heroProduct: { title: p.n, handle: p.h } }));
  const all = [other.assets.email.html, ...other.assets.landing_pages.map((l) => l.html)].join('\n');
  expect(all, 'another brand\'s catalogue photo on this brand\'s assets').not.toContain(base);
});

// A brand with no catalogue (the operator, 2026-10-17): "either a suitable image
// must be created or a brand image must be used which is appropriate and
// relevant". Its own site imagery first; else one generated brand scene that
// shows no product; never a logo, never imagery read from another site.
const OWN = 'https://famapp.example/media/family-hero.jpg';
const imageryBrand = (rows) => ({ ...APP, website: 'https://famapp.example', brand_data: { imagery: rows } });

test('no catalogue: every asset uses the brand\'s own site imagery, never its logo', async () => {
  const b = imageryBrand([
    { url: 'https://famapp.example/media/logo-mark.png', page: 'https://famapp.example/', role: 'logo' },
    { url: OWN, page: 'https://famapp.example/', role: 'hero' },
  ]);
  for (const scripted of [null, COPY]) {
    const c = await build(slot(b), { scripted });
    const label = scripted ? 'model' : 'template';
    expect(c.image_source, label).toBe('brand-site');
    expect(c.assets.email.html, `${label} mail`).toContain(OWN);
    for (const lp of c.assets.landing_pages) expect(lp.html, `${label} landing ${lp.variant}`).toContain(OWN);
    for (const ad of c.assets.ads.filter((a) => a.creative_type === 'static')) {
      expect(ad.creative.image, `${label} ${ad.platform} static`).toBe(OWN);
      expect(ad.creative.provider).toBe('brand-site');
    }
    const all = JSON.stringify(c.assets);
    expect(all, 'a logo used as a picture').not.toContain('logo-mark.png');
  }  // A brand picture is not a photo of the product: a named product with no
  // photo is still a stated gap on the campaign.
  const named = await build(slot(b, { heroProduct: { title: 'Family Card', handle: 'family-card' } }));
  expect(named.assets.email.html).toContain(OWN);
  expect(named.data_gaps.join(' ')).toMatch(/DATA REQUIRED BEFORE LAUNCH: product image/);
});

test('imagery read from another site is never used, and a missing picture stays a stated gap', async () => {
  const b = imageryBrand([{ url: 'https://othersite.example/hero.jpg', page: 'https://othersite.example/', role: 'hero' }]);
  const c = await build(slot(b));
  expect(JSON.stringify(c.assets)).not.toContain('othersite.example');
  expect(c.image_source).toBe(null);
});

test('nothing of its own: one generated brand scene, hosted, labelled, with no product in the brief', async () => {
  const bi = require(path.join(ROOT, 'api', '_shared', 'brand-imagery.js'));
  const prompt = bi.scenePrompt(APP);
  expect(prompt).toContain('Famapp');
  expect(prompt).toMatch(/No product, no packaging/);
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  expect(await bi.generatedScene(APP, { generate: async () => ({ image: 'data:image/svg+xml,<svg/>', provider: 'placeholder' }), upload: async () => 'https://x/y.png' })).toBe(null);
  expect(await bi.generatedScene(APP, { generate: async () => ({ image: png, provider: 'openai' }), upload: async () => null }), 'an image that cannot be hosted').toBe(null);
  const ok = await bi.generatedScene(APP, { generate: async () => ({ image: png, provider: 'openai' }), upload: async () => 'https://cdn.example/scene.png' });
  expect(ok).toMatchObject({ url: 'https://cdn.example/scene.png', generated: true });

  // Through the builder, with creatives asked for and the generator scripted.
  const CI = require.resolve(path.join(ROOT, 'api', '_shared', 'creative-image.js'));
  const real = require.cache[CI];
  const prompts = [];
  require.cache[CI] = { id: CI, filename: CI, loaded: true, exports: {
    generateCreativeImage: async (p) => { prompts.push(p); return { image: png, provider: 'openai' }; },
    uploadCreative: async () => 'https://cdn.example/famapp-scene.png' } };
  try {
    const c = await build(slot(APP), { scripted: COPY, withCreatives: true });
    expect(c.image_source).toBe('generated');
    expect(c.generated_imagery && c.generated_imagery.url).toBe('https://cdn.example/famapp-scene.png');
    expect(c.assets.ads.filter((a) => a.creative_type === 'static').every((a) => a.creative.image === 'https://cdn.example/famapp-scene.png' && a.creative.provider === 'generated')).toBe(true);
    expect(prompts.length, 'one scene for the whole campaign').toBe(1);
    expect(prompts[0]).toMatch(/No product/);
    expect(JSON.stringify(c.assets)).not.toContain('data:image/png');
  } finally { if (real) require.cache[CI] = real; else delete require.cache[CI]; }
});
