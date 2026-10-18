// The operator, 2026-10-18: "atrocious mailer quality - do competitive research
// properly using the competitive benchmarking feature that I have created and
// then create the best quality assets for the selected brand", then "this is a
// general and important update required for any and every brand".
//
// Measured first on the selected brand (Lenskart, read from its own site and
// catalogue through the shipped readers): the Text + Visual mail headed itself
// with a model code ("Back for you: Vincent Chase VC 5158/P"), said one line,
// printed the hero product again in a grid of 140px thumbnails, and was set in
// Arial because the site's font is served under a hashed Next.js name. Then 56
// real emails from category leaders (Warby Parker, Oakley, Ray-Ban, Sunglass
// Hut, ASICS, CULTURE ...) were measured as rendered: 95% put a picture before
// the first button, headlines run about five words, a third show products side
// by side, a quarter carry a shop-by row.
//
// Executed here: the study's own measurement on a mail rendered in Chromium;
// the shipped reference set; the study reading the competitive benchmarking
// feature's own captured mail (brand_competitors + ci_emails) over a recorded
// fetch; Smart Brain's shipped buildCampaign for a brand whose product names
// are model codes, with the copy prompt recorded; the showcase rendered and
// measured in Chromium at 640 and 375; the hashed font name resolved.
//
// Run: npx playwright test tests/competitor-mail-study.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STUDY = require(path.join(ROOT, 'api', '_shared', 'competitor-mail-study.js'));
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="#d9c9b0"/></svg>';
const textOf = (html) => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// A competitor email shaped like the ones studied: full-width picture first,
// a headline, a solid and an outline button, three products with prices, a
// strip of three service promises, and a shop-by row.
const COMPETITOR_MAIL = `<!doctype html><html><body style="margin:0">
<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0">
<tr><td><img src="https://cdn.example/hero.jpg" width="600" height="400" style="display:block;width:600px;height:400px" alt="hero"></td></tr>
<tr><td align="center" style="padding:24px"><h1 style="font-size:32px;margin:0">Shades for every day</h1></td></tr>
<tr><td align="center" style="padding:10px">
  <table role="presentation" align="center"><tr>
    <td style="background:#0b3d5c;padding:12px 24px"><a href="https://shop.example/a" style="color:#fff;text-decoration:none">Shop sunglasses</a></td>
    <td style="width:12px"></td>
    <td style="border:2px solid #0b3d5c;padding:10px 22px"><a href="https://shop.example/s" style="color:#0b3d5c;text-decoration:none">Find a store</a></td>
  </tr></table></td></tr>
<tr><td><table role="presentation" width="100%"><tr>
  <td width="200" align="center"><img src="https://cdn.example/1.jpg" width="180" height="180" style="width:180px;height:180px"><div>Round</div><div>$95</div></td>
  <td width="200" align="center"><img src="https://cdn.example/2.jpg" width="180" height="180" style="width:180px;height:180px"><div>Square</div><div>$95</div></td>
  <td width="200" align="center"><img src="https://cdn.example/3.jpg" width="180" height="180" style="width:180px;height:180px"><div>Aviator</div><div>$120</div></td>
</tr></table></td></tr>
<tr><td><table role="presentation" width="100%"><tr>
  <td width="200" align="center" style="padding:16px">Free shipping</td>
  <td width="200" align="center" style="padding:16px">Free returns</td>
  <td width="200" align="center" style="padding:16px">Free eye exam in store</td>
</tr></table></td></tr>
<tr><td align="center" style="padding:20px"><a href="https://shop.example/w">Women</a> &nbsp; <a href="https://shop.example/m">Men</a> &nbsp; <a href="https://shop.example/k">Kids</a></td></tr>
<tr><td align="center" style="padding:20px;font-size:11px">1 Example St, New York. <a href="https://shop.example/u">Unsubscribe</a></td></tr>
</table></body></html>`;

test('the study measures a competitor email as rendered: picture first, buttons, products, promises, shop-by', async ({ page }) => {
  await page.route(/^https?:\/\//, (r) => r.fulfill({ contentType: 'image/svg+xml', body: PHOTO }));
  await page.setViewportSize({ width: 640, height: 900 });
  await page.setContent(COMPETITOR_MAIL, { waitUntil: 'load' });
  const m = await page.evaluate(STUDY.measureInPage, { subject: 'Shades for every day, picked for you' });
  expect(m.hero_full_width, JSON.stringify(m)).toBe(true);
  expect(m.image_before_first_button).toBe(true);
  expect(m.headline).toBe('Shades for every day');
  expect(m.headline_words).toBe(4);
  expect(m.buttons).toBe(2);
  expect(m.button_kinds).toEqual({ solid: 1, outline: 1 });
  expect(m.button_labels).toEqual(['Shop sunglasses', 'Find a store']);
  expect(m.product_grid, 'three pictures side by side with prices').toBe(true);
  expect(m.grid_columns).toBe(3);
  expect(m.service_strip, 'three short promises on one line').toBe(true);
  expect(m.shop_by_links, 'Women / Men / Kids').toBe(true);
  expect(m.footer_unsubscribe).toBe(true);
  expect(m.subject_chars).toBe(36);
  // The patterns of one measured email.
  const p = STUDY.patterns([m]);
  expect(p.share.image_before_first_button).toBe(1);
  expect(p.button_verbs.map((v) => v.verb)).toEqual(['Shop', 'Find']);
});

test('the shipped reference set: real emails, each with the page it was read from, matched to a brand by its own category words', () => {
  const ref = require(path.join(ROOT, 'data', 'benchmarks', 'mail-reference.json'));
  expect(ref.emails.length).toBeGreaterThanOrEqual(50);
  for (const e of ref.emails) {
    expect(e.url, e.slug).toMatch(/^https:\/\/reallygoodemails\.com\/emails\//);
    expect(e.brand && e.subject, e.slug).toBeTruthy();
    expect(e.measured && e.measured.method, e.slug).toBe('rendered');
    expect(JSON.stringify(e), 'measurements only, never a competitor\'s HTML').not.toMatch(/<table|<td|<img/i);
  }
  // An eyewear brand is matched to eyewear emails - not to apparel because
  // "eyewear" contains "wear".
  const eye = STUDY.referenceStudy({ industry: 'Eyewear: prescription eyeglasses, sunglasses and contact lenses' });
  expect(eye.matched_category).toBe(true);
  expect(eye.sources).toEqual(expect.arrayContaining(['Warby Parker', 'Oakley', 'Ray-ban']));
  expect(eye.sources).not.toContain('CULTURE');
  const coffee = STUDY.referenceStudy({ industry: 'Single-origin coffee roaster' });
  expect(coffee.sources).toEqual(expect.arrayContaining(['Stumptown Coffee Roasters']));
  expect(coffee.sources).not.toContain('Warby Parker');
  // Whole words: "team" is not "tea", so a software company is not given
  // the food set (it gets every reference email, unmatched).
  const team = STUDY.referenceStudy({ industry: 'Team collaboration software' });
  expect(team.matched_category).toBe(false);
  // The brief names its basis and keeps facts the brand's own.
  const lines = STUDY.briefLines(eye).join('\n');
  expect(lines).toMatch(/reference set, not this brand's own competitor list/);
  expect(lines).toMatch(/never a product code/);
  expect(lines).toMatch(/Never copy a competitor's words, offer, claim or picture/);
});

test('the study reads the benchmarking feature\'s own captured mail for THIS brand\'s competitors when there are three or more', async () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: global.fetch };
  process.env.SUPABASE_URL = 'https://proj.supabase.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  const asked = [];
  const mail = (brand_name, sender, subject) => ({ brand_name, sender, subject, html: COMPETITOR_MAIL });
  global.fetch = async (url) => {
    asked.push(String(url));
    if (/brand_competitors\?workspace_id=eq\.ws-1/.test(url)) return new Response(JSON.stringify([{ name: 'Rival Optics', domain: 'rivaloptics.example' }, { name: 'Clearview', domain: 'https://www.clearview.example' }]), { status: 200 });
    if (/ci_emails\?/.test(url)) return new Response(JSON.stringify([
      mail('Rival Optics', 'news@rivaloptics.example', 'New frames are in'), mail('Someone Else', 'hi@other.example', 'Not a competitor'),
      mail('', 'offers@mail.clearview.example', 'Your exam is due'), mail('Rival Optics', 'news@rivaloptics.example', 'Weekend edit'),
    ]), { status: 200 });
    throw new Error('unexpected ' + url);
  };
  try {
    STUDY._cache.clear();
    const own = await STUDY.ownEmails('ws-1');
    expect(own.rows.map((r) => r.brand)).toEqual(['Rival Optics', 'Clearview', 'Rival Optics']);
    expect(asked[0], 'the competitor set is the workspace\'s own').toMatch(/workspace_id=eq\.ws-1/);
    // Static read of the captured HTML (no browser on the request path).
    const st = await STUDY.studyFor({ name: 'Opticraft' }, { workspaceId: 'ws-1' });
    expect(st.basis).toBe('own');
    expect(st.sources).toEqual(['Rival Optics', 'Clearview']);
    expect(st.patterns.emails).toBe(3);
    expect(STUDY.briefLines(st)[0]).toMatch(/3 emails from this brand's own competitors \(Rival Optics, Clearview\)/);
    // Fewer than three: the reference set, and why.
    STUDY._cache.clear();
    global.fetch = async (url) => (/brand_competitors/.test(url) ? new Response('[]', { status: 200 }) : new Response('[]', { status: 200 }));
    const none = await STUDY.studyFor({ name: 'Opticraft', industry: 'eyewear' }, { workspaceId: 'ws-2' });
    expect(none.basis).toBe('reference');
    expect(none.why).toMatch(/no competitor set yet/);
  } finally {
    STUDY._cache.clear();
    global.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
});

test('a hashed Next.js font name is the real family: the mail loads it and sets it', () => {
  const rt = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
  const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
  expect(rt.realFamily('__Plus_Jakarta_Sans_7aabe8')).toBe('Plus Jakarta Sans');
  expect(rt.realFamily('__Plus_Jakarta_Sans_Fallback_7aabe8')).toBe('');
  expect(rt.realFamily('Inter')).toBe('Inter');
  const brand = { typography: { heading: { family: '__Plus_Jakarta_Sans_7aabe8', stack: "'__Plus_Jakarta_Sans_7aabe8','__Plus_Jakarta_Sans_Fallback_7aabe8'", google: false, weights: '500;700' } } };
  expect(rt.fontStacks(brand).head).toBe("'Plus Jakarta Sans',Georgia,serif");
  expect(core.fontsHref(brand)).toBe('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700&display=swap');
  // A real brand font that Google does not serve is still never linked.
  expect(core.fontsHref({ typography: { heading: { family: '__Acme_Grotesk_1a2b3c', google: false } } })).toBe('');
});

// ── a brand whose product names are model codes, through Smart Brain ─────────
const OPTI = {
  id: 'device:opticraft', slug: 'opticraft', name: 'Opticraft', website: 'https://opticraft.example', industry: 'Eyewear: prescription eyeglasses and sunglasses',
  palette: { primary: '#0B1F4D', accent: '#1BB3C2', ink: '#0B1F4D', surface: '#FFFFFF' },
  typography: { heading: { family: '__Plus_Jakarta_Sans_7aabe8', google: false, weights: '500;700' }, body: { family: '__Plus_Jakarta_Sans_7aabe8', google: false } },
  regions: [{ code: 'US', currency: 'USD', store_url: 'https://opticraft.example/us', home: true }],
  claims: ['Free returns within 14 days', 'Prescription lenses included'],
  offerings: [{ kind: 'product', name: 'Eyeglasses', url: 'https://opticraft.example/us/eyeglasses' }, { kind: 'product', name: 'Sunglasses', url: 'https://opticraft.example/us/sunglasses' }],
  legal_entity: 'Opticraft Inc, 1 Lens Way, Austin TX 73301, USA',
};
const P = (title, n, price, description) => ({ sku: title, title, handle: `p${n}`, image: `https://opticraft.example/img/${n}.jpg`, price, url: `https://opticraft.example/us/p${n}-sunglasses.html`, description });
const SLOT = {
  id: 'opti-1', date: '2026-10-20', market: 'US', objective: 'reactivation', brand: OPTI,
  cohort: { name: 'At Risk', size: 1200, rules: ['r'] }, channels: ['email'], confidence: 0.6, offer: { depth: 'none', pct: 0 },
  heroProduct: P('Vista VC 5158/P', 1, 59, 'Grey Gold Full Rim Aviator Vista VC 5158/P Sunglasses'),
  supportingProducts: [
    P('Jacob JJ S16880', 2, 149, 'Trendy Maroon Gradient Full Rim Round Jacob JJ S16880-C2 Sunglasses at Opticraft.'),
    P('Jacob JJ S16896', 3, 149, 'Silver Tortoise Green Full Rim Clubmaster Jacob JJ S16896-C3 Sunglasses at Opticraft.'),
    P('Hooper HP E16256', 4, 59, 'Black Full Rim Rectangle Hooper HP E16256 Sunglasses'),
  ],
};

async function build(entry, script) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const realLlm = require.cache[LLM]; const realPlan = require.cache[PLAN];
  const prompts = [];
  try {
    if (script) {
      const real = require(LLM);
      const stub = async (o) => { prompts.push([o.userMessage, o.prompt, o.systemPrompt, o.system].filter(Boolean).join('\n')); return { text: JSON.stringify(/strategy/.test(String(o.stage || '')) ? { angle: 'a', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] } : script), provider: 'scripted', model: 'scripted' }; };
      Object.assign(stub, real);
      require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
    }
    delete require.cache[PLAN];
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const c = await require(PLAN).buildCampaign(JSON.parse(JSON.stringify(entry)), smartConfig({}), { noLLM: !script, withCreatives: false });
    return { c, prompts };
  } finally {
    require.cache[LLM] = realLlm; if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN];
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const CODE = /VC 5158|JJ S168|HP E162/;

let T = null;
test.beforeAll(async () => { T = (await build(SLOT)).c; });

test('no product code in the subject or any headline; the campaign records which emails shaped it', () => {
  expect(T.assets.email.subject, 'subject').not.toMatch(CODE);
  expect(T.assets.email.subject).toMatch(/Opticraft sunglasses/);
  for (const v of T.assets.email.variants) {
    const h1 = (/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(v.html) || [])[1] || '';
    expect(textOf(h1).trim(), `${v.label} headline`).not.toMatch(CODE);
    expect(textOf(h1).trim().split(/\s+/).length, `${v.label} headline "${textOf(h1)}"`).toBeLessThanOrEqual(7);
    expect(v.html, `${v.label} links the brand's font`).toContain('fonts.googleapis.com/css2?family=Plus+Jakarta+Sans');
  }
  expect(T.mail_study.basis).toBe('reference');
  expect(T.mail_study.sources).toEqual(expect.arrayContaining(['Warby Parker']));
  expect(T.mail_study.layout.product_grid).toBe(true);
});

test('the copywriter is briefed with the competitor study, and the model\'s copy still renders', async () => {
  const copy = {
    // The live model was briefed against codes and still wrote them: they are
    // left out of the subject and headline after it answers.
    email: { subject: 'Vista VC 5158/P: sun season, sorted', preheader: 'New frames to see', hook: 'h', hero_headline: 'Meet the Vista VC 5158/P', intro_paragraph: 'It has been a while. Free returns within 14 days.', body_paragraph: '', benefits: [], rating: null, reviews: [], badges: [], guarantee: '', ps: '', faq: [], cta: 'Shop Vista VC 5158/P', image_brief: 'x' },
    landing: { hero_headline: 'Sun season, sorted', hero_sub: 's', why_title: 'Why', why_bullets: [], proof_quote: '', proof_author: '', faq: [], cta: 'Shop sunglasses', image_brief: 'y' },
    ads: { meta: { primary_text: 'p', headline: 'h', description: 'd', image_brief: 'z' }, google: { headlines: ['Opticraft'], descriptions: ['Free returns within 14 days.'], image_brief: 'w' }, tiktok: { script: 's', caption: 'c', image_brief: 'v' } },
  };
  const { c, prompts } = await build(SLOT, copy);
  const writer = prompts.find((p) => /Write campaign copy/.test(p)) || '';
  expect(writer, 'the copy prompt').toMatch(/COMPETITOR EMAILS STUDIED: \d+ emails from category leaders \(/);
  expect(writer).toMatch(/Headlines run about \d+ words/);
  expect(writer).toMatch(/never put a product's model or SKU code/);
  expect(c.assets.email.subject).toBe('Vista: sun season, sorted');
  const visual = c.assets.email.variants.find((v) => /Visual/.test(v.label));
  const h1 = textOf((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(visual.html) || [])[1]).trim();
  expect(h1, 'the code left out, the name kept').toBe('Meet the Vista');
  expect(textOf(visual.html), 'the button too').toContain('Shop Vista');
  expect(textOf(visual.html)).not.toMatch(/Shop Vista VC/);
  const { stripModelCode } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
  expect(stripModelCode('Meet the VC 5158/P', 'Opticraft sunglasses'), 'a line left ending on "the" names the product').toBe('Meet the Opticraft sunglasses');
});

test('the showcase, rendered: headline then picture then button; products beside it in the store\'s own words; promises and shop-by from the record', async ({ page }) => {
  await page.route(/^https?:\/\//, (r) => (/fonts\.googleapis/.test(r.request().url()) ? r.fulfill({ contentType: 'text/css', body: '' }) : r.fulfill({ contentType: 'image/svg+xml', body: PHOTO })));
  const visual = T.assets.email.variants.find((v) => /Visual/.test(v.label));
  expect(visual.html, 'the brand font is linked from Google').toContain('fonts.googleapis.com/css2?family=Plus+Jakarta+Sans');
  await page.setViewportSize({ width: 640, height: 1000 });
  await page.setContent(visual.html, { waitUntil: 'load' });
  const m = await page.evaluate(() => {
    const top = (el) => el.getBoundingClientRect().top + scrollY;
    const h1 = document.querySelector('h1');
    const hero = document.querySelector('img[data-mail-hero]');
    const btn = document.querySelector('[data-ds="button-primary"]');
    const cards = [...document.querySelectorAll('[data-mail-card]')].map((c) => ({ h: Math.round(c.getBoundingClientRect().height), t: c.innerText.replace(/\s+/g, ' ').trim() }));
    return { h1: top(h1), hero: top(hero), heroW: Math.round(hero.getBoundingClientRect().width), btn: top(btn), cards, font: getComputedStyle(h1).fontFamily, body: document.body.innerText };
  });
  expect(m.h1 < m.hero && m.hero < m.btn, `headline ${m.h1}, picture ${m.hero}, button ${m.btn}`).toBe(true);
  expect(m.heroW, 'the picture runs the width of the mail').toBeGreaterThanOrEqual(560);
  expect(m.font).toMatch(/Plus Jakarta Sans/);
  expect(m.cards.length, 'the three other products, two to a row').toBeGreaterThanOrEqual(2);
  expect(new Set(m.cards.map((c) => c.h)).size, `card heights ${m.cards.map((c) => c.h)}`).toBe(1);
  expect(m.cards.map((c) => c.t).join(' | '), 'the hero product is not printed again').not.toMatch(/Vista VC 5158/);
  expect(m.cards[0].t, 'the store\'s own description, without the name or code').toMatch(/Trendy Maroon Gradient Full Rim Round Sunglasses/);
  expect(m.cards[0].t).not.toMatch(/S16880-C2|at Opticraft/);
  expect(m.body, 'shop-by row from the record\'s own offerings').toMatch(/Shop by\s*Eyeglasses\s*Sunglasses/i);
  // A brand with no claims and no offering pages gets neither section.
  const bare = await build(Object.assign({}, SLOT, { brand: Object.assign({}, OPTI, { claims: [], offerings: [] }) }));
  const bv = bare.c.assets.email.variants.find((v) => /Visual/.test(v.label));
  expect(textOf(bv.html)).not.toMatch(/Shop by/);
  expect(bv.html).not.toMatch(/Free returns within 14 days/);
});

test('on a phone the showcase fits, and every card picture is square', async ({ page }) => {
  await page.route(/^https?:\/\//, (r) => r.fulfill({ contentType: 'image/svg+xml', body: PHOTO }));
  const visual = T.assets.email.variants.find((v) => /Visual/.test(v.label));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.setContent(visual.html, { waitUntil: 'load' });
  const m = await page.evaluate(() => ({
    over: document.documentElement.scrollWidth - innerWidth,
    pics: [...document.querySelectorAll('img[data-mail-pic]')].map((i) => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
  }));
  expect(m.over, 'no sideways scroll').toBeLessThanOrEqual(0);
  expect(m.pics.length).toBeGreaterThanOrEqual(2);
  for (const [w, h] of m.pics) expect(Math.abs(w - h), `card picture ${w}x${h}`).toBeLessThanOrEqual(2);
});
