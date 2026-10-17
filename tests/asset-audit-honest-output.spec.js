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
    const out = await require(SC).runDaily({ brand: { ...NEWS, brand_data: { hashtags: ['#PuneDesk', 'ward watch'] } }, dry_run: true, date: '2026-10-20' });
    expect(out.posts.length).toBeGreaterThan(5);
    for (const p of out.posts) {
      const words = JSON.stringify(p.copy);
      expect(words, p.key).not.toMatch(/pair|footwear|Lacing|studio taught|3pm|ritual|DATA REQUIRED|Shop |origin-fresh|one-of-one|chalk linen/i);
      expect(p.cta, p.key).toBe('Start reading');
    }
    // Only tags the brand owns: its listed ones, its name; never an invented topic.
    const owned = new Set(['#PuneDesk', '#WardWatch', '#LedgerlineGazette', '#Shorts']);
    for (const p of out.posts.filter((x) => x.key !== 'blog')) {
      const tags = p.hashtags || [];
      expect(tags.length, `${p.key} carries no hashtag at all`).toBeGreaterThan(p.key === 'instagram_stories' ? -1 : 0);
      for (const t of tags) expect(owned.has(t), `${p.key}: ${t} is not the brand's`).toBe(true);
    }
    expect(out.posts.find((p) => p.key === 'instagram_feed').hashtags).toEqual(['#PuneDesk', '#WardWatch', '#LedgerlineGazette']);
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
  // The hosted path alone: the free host is "not answering" here (its own test
  // is below), or CI, which can reach it, would get the free scene back.
  const offline = async () => false;
  expect(await bi.generatedScene(APP, { generate: async () => ({ image: 'data:image/svg+xml,<svg/>', provider: 'placeholder' }), upload: async () => 'https://x/y.png', probe: offline })).toBe(null);
  expect(await bi.generatedScene(APP, { generate: async () => ({ image: png, provider: 'openai' }), upload: async () => null, probe: offline }), 'an image that cannot be hosted, and no free host').toBe(null);
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

// No key and no storage (2026-10-17). The operator: "use free code based
// generation and rendering if that can replace the requirement of api keys".
// Copy already has its code path (the template assets); the brand scene needed
// a provider key and a bucket. Now the keyless Pollinations address, the same
// picture every time for a brand, carried as a URL, never base64.
test('no model key and no storage: the template assets still carry one free, keyless brand scene', async () => {
  const savedFree = process.env.FREE_GENERATION;
  process.env.FREE_GENERATION = 'on';
  try {
  const bi = require(path.join(ROOT, 'api', '_shared', 'brand-imagery.js'));
  const url = bi.freeSceneUrl(APP);
  expect(url).toMatch(/^https:\/\/image\.pollinations\.ai\/prompt\//);
  expect(decodeURIComponent(url)).toMatch(/No product, no packaging/);
  expect(bi.freeSceneUrl(APP), 'one address per brand').toBe(url);
  expect(bi.freeSceneUrl(NEWS)).not.toBe(url);
  // Generation unavailable: the probe decides.
  expect(await bi.generatedScene(APP, { generate: async () => null, upload: async () => null, probe: async () => true })).toMatchObject({ url, keyless: true, generated: true });
  expect(await bi.generatedScene(APP, { generate: async () => null, upload: async () => null, probe: async () => false }), 'a host that does not answer gives no scene').toBe(null);
  // Generated but nowhere to keep it: the keyless address, never the data URL.
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  expect(await bi.generatedScene(APP, { generate: async () => ({ image: png, provider: 'openai' }), upload: async () => null, probe: async () => true })).toMatchObject({ url });

  // The whole build: every text model down, the image cascade finds nothing,
  // and only the free host answers (with a real image).
  const LLM_ = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
  const CI = require.resolve(path.join(ROOT, 'api', '_shared', 'creative-image.js'));
  const realL = require.cache[LLM_]; const realC = require.cache[CI]; const realP = require.cache[PLAN];
  const realFetch = global.fetch;
  const asked = [];
  const down = async () => { throw new Error('every provider is down'); };
  Object.assign(down, require(LLM_));
  require.cache[LLM_] = { id: LLM_, filename: LLM_, loaded: true, exports: down };
  require.cache[CI] = { id: CI, filename: CI, loaded: true, exports: { generateCreativeImage: async () => null, uploadCreative: async () => null } };
  delete require.cache[PLAN];
  global.fetch = async (u, init) => {
    const s = String(u);
    if (s.startsWith('https://image.pollinations.ai/')) { asked.push(s); return new Response(new Uint8Array(8000), { status: 200, headers: { 'content-type': 'image/jpeg' } }); }
    throw new Error('unexpected network call: ' + s);
  };
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const c = await require(PLAN).buildCampaign(slot(APP), smartConfig({}), { noLLM: false, withCreatives: true });
    expect(c.copywriter.provider).toBe('template-fallback');
    expect(asked, 'the free host is asked once').toHaveLength(1);
    expect(c.image_source).toBe('generated');
    expect(c.generated_imagery).toMatchObject({ url, keyless: true });
    expect(c.assets.email.html.replace(/&amp;/g, '&'), 'the template mail carries the scene').toContain(url);
    const statics = c.assets.ads.filter((a) => a.creative_type === 'static');
    expect(statics.length).toBeGreaterThan(0);
    expect(statics.every((a) => a.creative.image === url)).toBe(true);
    expect(JSON.stringify(c.assets)).not.toMatch(/data:image\/(png|jpeg)/);
  } finally {
    global.fetch = realFetch;
    if (realL) require.cache[LLM_] = realL; else delete require.cache[LLM_];
    if (realC) require.cache[CI] = realC; else delete require.cache[CI];
    if (realP) require.cache[PLAN] = realP; else delete require.cache[PLAN];
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
  // Switched off, nothing leaves for the free host.
  process.env.FREE_GENERATION = 'off';
  expect(await bi.generatedScene(APP, { generate: async () => null, upload: async () => null, probe: async () => true })).toBe(null);
  } finally { if (savedFree === undefined) delete process.env.FREE_GENERATION; else process.env.FREE_GENERATION = savedFree; }
});

// Every generated image, not only the brand scene (2026-10-17): with nowhere
// to host the bytes, the free generator's own address is used, and a mail
// never carries base64. Exercised through the shipped image route's answer.
test('a generated image is carried as a URL: hosted, else the free generator\'s address, never base64', async () => {
  const CI = require(path.join(ROOT, 'api', '_shared', 'creative-image.js'));
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const free = 'https://image.pollinations.ai/prompt/x?seed=1';
  const SUPA = require.resolve(path.join(ROOT, 'api', '_shared', 'supa.js'));
  const real = require.cache[SUPA];
  require.cache[SUPA] = { id: SUPA, filename: SUPA, loaded: true, exports: { uploadObject: async () => { throw new Error('storage unreachable'); } } };
  try {
    expect(await CI.hostedUrl({ image: png, url: free })).toBe(free);
    expect(await CI.hostedUrl({ image: png, url: null }), 'no address and no storage: no image').toBe(null);
    expect(await CI.hostedUrl({ image: 'https://cdn.example/a.png' })).toBe('https://cdn.example/a.png');
    require.cache[SUPA].exports.uploadObject = async () => ({ public_url: 'https://store.example/a.png' });
    expect(await CI.hostedUrl({ image: png, url: free }), 'the hosted copy wins').toBe('https://store.example/a.png');
  } finally { if (real) require.cache[SUPA] = real; else delete require.cache[SUPA]; }
  // Through the shipped image route, as the server calls it. It used to send no
  // credentials, so the route answered 401 and every server-side image was null.
  const realFetch = global.fetch;
  const ENVK = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CRON_SECRET', 'FREE_GENERATION', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
  const saved = {}; for (const k of ENVK) { saved[k] = process.env[k]; delete process.env[k]; }
  const hosts = [];
  global.fetch = async (u) => {
    const s2 = String(u); hosts.push(new URL(s2).host);
    if (s2.startsWith('https://image.pollinations.ai/')) return new Response(new Uint8Array(9000), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    throw new Error('unexpected ' + s2);
  };
  try {
    // The deployment's scheduler: the route itself answers, and says where its free picture lives.
    process.env.CRON_SECRET = 'scheduler-secret-for-the-test';
    process.env.FREE_GENERATION = 'off';
    const viaRoute = await CI.generateCreativeImage('a calm room, no text', { size: '1024x1024' });
    expect(viaRoute, 'the route admitted the server\'s own call').toBeTruthy();
    expect(viaRoute.provider).toBe('pollinations');
    expect(viaRoute.url).toMatch(/^https:\/\/image\.pollinations\.ai\/prompt\//);
    expect(await CI.hostedUrl(viaRoute)).toBe(viaRoute.url);
    // No scheduler, no session: the free floor, unless it is switched off.
    delete process.env.CRON_SECRET;
    expect(await CI.generateCreativeImage('a calm room, no text'), 'switched off: nothing').toBe(null);
    process.env.FREE_GENERATION = 'on';
    const floor = await CI.generateCreativeImage('a calm room, no text');
    expect(floor).toMatchObject({ provider: 'pollinations', keyless: true });
    expect(floor.image).toMatch(/^https:\/\//);
  } finally {
    global.fetch = realFetch;
    for (const k of ENVK) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

// Phones (2026-10-17): every mail was a FIXED 600/560px table, so at 375px it
// scrolled sideways (measured: 592-632px). Fluid up to its width now, with an
// Outlook-only fixed table (Word ignores max-width).
test('every mail fits a 375px phone, keeps its 600px column on a desktop, and Outlook keeps a fixed width', async ({ page }) => {
  const trigger = require(path.join(ROOT, 'api', '_shared', 'calendar-trigger.js'));
  const c = await build(slot(APP));
  const mails = { template: c.assets.email.html };
  for (const style of ['pure', 'visual', 'editorial']) {
    mails[`shared ${style}`] = trigger.helpers.renderTextVariant({ brand: APP, style, subject: 'S', hero_headline: 'A headline long enough to wrap on a phone screen', hero_subline: 'Sub', body_blocks: [{ heading: 'H', body: 'Body.' }], cta_text: 'Learn more', cta_url: 'https://famapp.example', market: 'IN', hero_image_url: 'https://famapp.example/hero.jpg' });
  }
  await page.route('**/*', (r) => r.abort());
  for (const [name, mail] of Object.entries(mails)) {
    expect(mail, `${name}: no Outlook fixed table`).toMatch(/<!--\[if mso\]><table role="presentation" width="(600|560)"/);
    expect((mail.match(/<!--\[if mso\]>/g) || []).length, `${name}: Outlook table opened and closed`).toBe(2);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.setContent(mail);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name} at 375px`).toBeLessThanOrEqual(375);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(mail);
    const widest = await page.evaluate(() => Math.max(...[...document.querySelectorAll('table')].map((t) => t.getBoundingClientRect().width).filter((w) => w < 1280)));
    expect(widest, `${name}: the desktop column`).toBeGreaterThanOrEqual(560);
    expect(widest).toBeLessThanOrEqual(600);
  }
});

// The visual audit of a tea store's no-key assets (2026-10-17). The operator:
// "Still the content and visuals need to be improved a lot". Rendered at 1280
// and 390: the mail named its product three times ("A special pick for you: X
// by <brand>", a heading, "X from <brand>. <tagline>") with no price though the
// catalogue states one; the footer read "as a <Brand> IN customer"; the landing
// page printed the same claims three times, its photo was a 220px strip, its
// price "₹1450", its card repeated the hero, and B never named the product; the
// ads said "<product> from <brand>" and used "Shop now" as a Google headline.
const TEA = {
  id: 'device:arya', slug: 'arya-teas', name: 'Arya Tea Estate', website: 'https://aryateas.example', industry: 'Darjeeling tea estate and store',
  tagline: 'Single-estate Darjeeling, picked and packed at the garden',
  palette: { primary: '#0E4D35', accent: '#C99A2E', ink: '#1E2A24', surface: '#FBF8F1' },
  regions: [{ code: 'IN', currency: 'INR', store_url: 'https://aryateas.example', home: true }],
  claims: ['Grown at 1,800 metres in Darjeeling', 'Packed at the garden within 48 hours of plucking'],
  imagery: [{ url: 'https://aryateas.example/cdn/garden.jpg', page: 'https://aryateas.example/', role: 'hero' }],
  legal_entity: 'Arya Tea Estate Pvt Ltd, Darjeeling 734101, India',
};
const teaSlot = () => slot(TEA, {
  heroProduct: { sku: 'A1', title: 'Arya Diamond First Flush', handle: 'arya-diamond', category: 'Black Tea', image: 'https://aryateas.example/cdn/diamond.jpg', price: 1450 },
  supportingProducts: [{ sku: 'A2', title: 'Arya Ruby Second Flush', handle: 'arya-ruby', category: 'Black Tea' }, { sku: 'G1', title: 'Glass Teapot', handle: 'glass-teapot', category: 'Accessories' }],
});
const count = (hay, needle) => String(hay).split(needle).length - 1;

test('the no-key mail and landing pages say each fact once, show the price, and fit a phone', async ({ page }) => {
  const c = await build(teaSlot());
  const mail = c.assets.email.html;
  const mailText = textOf(mail.replace(/<title>[\s\S]*?<\/title>/i, ""));
  expect(count(mailText, 'Arya Diamond First Flush'), 'the product name, once in the headline').toBeLessThanOrEqual(1);
  expect(mailText).toContain('₹1,450');
  expect(mailText).toContain('Also from Arya Tea Estate');
  expect(mailText).toContain('Arya Ruby Second Flush');
  expect(mailText).toMatch(/because you are a Arya Tea Estate customer|because you are an? Arya Tea Estate customer/);
  expect(mailText).not.toMatch(/ IN customer|A special pick for you|from Arya Tea Estate\./);
  for (const lp of c.assets.landing_pages) {
    const t = textOf(lp.html.replace(/<title>[\s\S]*?<\/title>/i, ""));
    for (const claim of TEA.claims) expect(count(t, claim), `${lp.variant}: "${claim}" printed more than once`).toBeLessThanOrEqual(1);
    expect(t).toContain('₹1,450');
    expect(t).not.toContain('₹1450');
    expect(t, `${lp.variant} names the product`).toContain('Arya Diamond First Flush');
    expect(t).toContain('Also from Arya Tea Estate');
    expect(lp.html).toMatch(/class="hero-grid has-media"/);
    for (const [w, h] of [[390, 844], [1280, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.route('**/*', (r) => (r.request().url().startsWith('https://aryateas.example/cdn/') ? r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#6b8"/></svg>' }) : r.abort()));
      await page.setContent(lp.html, { waitUntil: 'load' });
      const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, img: (document.querySelector('.hero-media img') || {}).getBoundingClientRect ? document.querySelector('.hero-media img').getBoundingClientRect().height : 0, btnLines: (() => { const b = document.querySelector('.sticky .btn'); return b ? Math.round(b.getBoundingClientRect().height / parseFloat(getComputedStyle(b).lineHeight || '20')) : 0; })() }));
      expect(m.over, `${lp.variant} at ${w}px scrolls sideways`).toBeLessThanOrEqual(0);
      expect(m.img, `${lp.variant} at ${w}px: the photo is a strip`).toBeGreaterThanOrEqual(w < 600 ? 200 : 380);
      await page.unrouteAll();
    }
  }
  const google = c.assets.ads.find((a) => a.platform === 'google' && a.creative_type === 'static');
  expect(google.headlines).not.toContain('Shop now');
  expect(google.headlines.join(' ')).toContain('₹1,450');
  const meta = c.assets.ads.find((a) => a.platform === 'meta' && a.creative_type === 'static');
  expect(meta.primary_text).not.toMatch(/from Arya Tea Estate/);
  expect(meta.primary_text).toContain('₹1,450');
});
