// What /brain showed for Parwah on 2026-10-17, rebuilt and checked.
//
// The operator: "why so long - check if everything is okay. the mailers seem
// broken now ... ensure proper alignment everything and ensure top quality".
// Two screenshots of production (lifecycle-os.anchit-tandon.com/brain):
//   - the plan: every row's objective read "Drive the reader to buy this
//     product." for At Risk, Nurture, Engaged and Winback alike; the reason
//     read "Chosen to drive Drive the reader ..."; "landing_page" wrapped to
//     "landin g_pag e"; "0 profiles" for a size nobody measured;
//   - the mailer: a divider and star in #0000EE (the browser's unstyled-link
//     blue, read off the site as the brand "accent"), "What you get: Essential
//     nutrients / High-quality ingredients / Scientific research" and "Rich in
//     essential nutrients" (on no record of the brand's), and the product card
//     showing the brand's promo banner as the product's photo.
//
// Executed: Smart Brain's shipped buildCampaign with the model answering in
// the shape production's answered (scripted), the offering planner, and the
// mailers rendered in Chromium.
//
// Run: npx playwright test tests/brain-preview-parwah.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];
const BANNER = 'https://parwah.example/cdn/promo-banner.jpg';

const PARWAH = {
  id: 'device:parwah', slug: 'parwah', name: 'Parwah', website: 'https://parwah.example', industry: 'Care and daily-living products for parents',
  tagline: 'They took care of you. Take care back.',
  palette: { primary: '#2A1233', accent: '#0000EE', ink: '#1E1424', surface: '#FFF8EE' },
  regions: [{ code: 'IN', currency: 'INR', home: true }],
  claims: ['Daily-living essentials chosen for parents', 'Delivered across India'],
  imagery: [{ url: BANNER, page: 'https://parwah.example/' }],
  offerings: [{ kind: 'product', name: 'Everyday nutrition' }, { kind: 'product', name: 'Bathroom safety' }, { kind: 'product', name: 'Daily living aids' }],
  legal_entity: 'Parwah Care Pvt Ltd, Pune, India',
};
const SLOT = {
  id: 'parwah-1', date: '2026-10-17', market: 'IN', objective: 'Bring back customers who have gone quiet, with Everyday nutrition.', brand: PARWAH,
  cohort: { name: 'At Risk', size: 0, estimated: true, rules: ['r'] }, channels: ['email', 'meta', 'google', 'landing_page'],
  confidence: 0.52, offer: { depth: 'none', pct: 0 },
  heroProduct: { title: 'Everyday nutrition', category: 'product' },
  supportingProducts: [{ title: 'Bathroom safety', category: 'product' }],
};
// What production's model wrote (the screenshot), in the copy contract's shape.
const MODEL_COPY = {
  email: {
    subject: 'Everyday nutrition for the people who raised you', preheader: 'For a healthier India', hook: 'h',
    hero_headline: 'Everyday nutrition', intro_paragraph: 'Stay healthy with everyday nutrition. Rich in essential nutrients.',
    body_paragraph: 'Daily-living essentials chosen for parents.', benefits: ['Essential nutrients', 'High-quality ingredients', 'Scientific research'],
    rating: null, reviews: [], badges: [], guarantee: '', ps: 'Empower your health', faq: [], cta: 'Buy now', image_brief: 'x',
  },
  landing: { hero_headline: 'Everyday nutrition', hero_sub: 'Backed by scientific research.', why_title: 'Why', why_bullets: ['High-quality ingredients', 'Delivered across India'], proof_quote: '', proof_author: '', faq: [], cta: 'Buy now', image_brief: 'y' },
  ads: { meta: { primary_text: 'Rich in essential nutrients. Daily-living essentials chosen for parents.', headline: 'Everyday nutrition', description: 'd', image_brief: 'z' }, google: { headlines: ['Everyday nutrition', 'Parwah'], descriptions: ['Rich in essential nutrients for parents.', 'Daily-living essentials chosen for parents.'], image_brief: 'w' }, tiktok: { script: 's', caption: 'Delivered across India', image_brief: 'v' } },
};

async function build(entry) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const realLlm = require.cache[LLM]; const realPlan = require.cache[PLAN];
  try {
    const real = require(LLM);
    const stub = async (o) => ({ text: JSON.stringify(/strategy/.test(String(o.stage || '')) ? { angle: 'a', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] } : MODEL_COPY), provider: 'scripted', model: 'scripted' });
    Object.assign(stub, real);
    require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
    delete require.cache[PLAN];
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return await require(PLAN).buildCampaign(JSON.parse(JSON.stringify(entry)), smartConfig({}), { noLLM: false, withCreatives: false });
  } finally {
    require.cache[LLM] = realLlm; if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN];
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const textOf = (html) => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const INVENTED = /essential nutrients|high-quality ingredients|scientific research|clinically proven|rich in/i;

let C = null;
test.beforeAll(async () => { C = await build(SLOT); });

test('the model\'s invented qualities never reach the mailer, the landing page or the ads; the brand\'s own claims stand in', () => {
  expect(C.copywriter && C.copywriter.provider, 'the model path ran: ' + JSON.stringify(C.copywriter)).not.toBe('template-fallback');
  const mails = (C.assets.email.variants || []).map((v) => v.html).concat(C.assets.email.html);
  expect(mails.length).toBeGreaterThanOrEqual(4);
  for (const h of mails) {
    const t = textOf(h);
    expect(t).not.toMatch(INVENTED);
  }
  const visual = (C.assets.email.variants || []).find((v) => /Visual/.test(v.name || v.label || ''));
  expect(textOf(visual.html), 'the benefits are the brand\'s own claims').toContain('Daily-living essentials chosen for parents');
  for (const lp of C.assets.landing_pages) expect(textOf(lp.html), `landing ${lp.variant}`).not.toMatch(INVENTED);
  for (const ad of C.assets.ads) {
    const copy = [ad.primary_text, ad.headline, ad.description, ad.caption].concat(ad.headlines || [], ad.descriptions || []).join(' | ');
    expect(copy, `${ad.platform} ${ad.creative_type}`).not.toMatch(INVENTED);
  }
  expect(C.copy_grounding && C.copy_grounding.dropped.length, 'the campaign says what was left out').toBeGreaterThan(0);
});

test('the browser\'s unstyled-link blue is never painted as the brand\'s accent', () => {
  const all = [...(C.assets.email.variants || []).map((v) => v.html), C.assets.email.html, ...C.assets.landing_pages.map((l) => l.html),
    ...C.assets.ads.map((a) => (a.creative && a.creative.motion_html) || '')].join('\n');
  expect(all.toLowerCase()).not.toContain('#0000ee');
});

test('a product card shows the product\'s own photo or a plain tile, never the brand\'s promo banner; cards in a row are the same size', async ({ page }) => {
  const visual = (C.assets.email.variants || []).find((v) => /Visual/.test(v.name || v.label || ''));
  await page.route(/^https?:\/\//, (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#caa"/></svg>' }));
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.setContent(visual.html, { waitUntil: 'load' });
  const cards = await page.evaluate(() => [...document.querySelectorAll('a > div')].filter((d) => /border-radius:10px/.test(d.getAttribute('style') || '')).map((d) => {
    const img = d.querySelector('img');
    return { src: img ? img.getAttribute('src') : '', h: Math.round(d.getBoundingClientRect().height), text: d.textContent.trim() };
  }));
  expect(cards.length, 'two product cards').toBe(2);
  for (const c of cards) expect(c.src, c.text).not.toBe(BANNER);
  expect(Math.abs(cards[0].h - cards[1].h), 'cards are the same height').toBeLessThanOrEqual(2);
});

test('the plan gives each audience its own job, not "Drive the reader to buy this product."', () => {
  const plan = require(PLAN);
  const rows = plan.__test_offeringPlanEntries(PARWAH, PARWAH.offerings, '2026-10-17', 4, 'parwah');
  const byCohort = {};
  for (const e of rows) byCohort[e.cohort.name] = e.objective;
  expect(Object.keys(byCohort).length).toBe(4);
  expect(new Set(Object.values(byCohort)).size, JSON.stringify(byCohort)).toBe(4);
  for (const [k, o] of Object.entries(byCohort)) expect(o, k).not.toMatch(/^Drive the reader to buy/);
  for (const e of rows) expect(e.analysis.summary, 'reason').not.toMatch(/drive Drive/);
});

// The template path (no model, or every model down), from the asset judgement
// of the same day: a lapsed customer's mail said why it reached them only in
// the subject; Meta, TikTok and YouTube carried one sentence; Google got three
// headlines and a description that was the brand's name; a publisher's landing
// page was its name three times and one bullet.
async function buildTemplate(entry) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return await require(PLAN).buildCampaign(JSON.parse(JSON.stringify(entry)), smartConfig({}), { noLLM: true, withCreatives: false });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const GAZETTE = {
  id: 'device:gazette', slug: 'gazette', name: 'Ledgerline Gazette', website: 'https://ledgerline.example', industry: 'news publishing',
  tagline: 'Pune news, checked twice by the desk', palette: { primary: '#7B2D5E', accent: '#C8A13B', ink: '#2A1F33', surface: '#FBF7EF' },
  regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ['Reporters in all 14 Pune wards'],
  offerings: [{ kind: 'subscription', name: 'Morning Ledger', url: 'https://ledgerline.example/ledger' }, { kind: 'section', name: 'Ward Watch', url: 'https://ledgerline.example/wards' }],
  legal_entity: 'Ledgerline Media LLP, Pune, India',
};

test('template path: the lapsed reader is told why the mail reaches them, each platform reads its own way, Google gets real headlines, a publisher\'s page names what it offers', async () => {
  const entry = { id: 'gz-1', date: '2026-10-20', market: 'IN', objective: 'Bring back customers who have gone quiet, with Morning Ledger.', brand: GAZETTE,
    cohort: { name: 'At Risk', size: 0, estimated: true, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 },
    heroProduct: { title: 'Morning Ledger', category: 'subscription' } };
  const c = await buildTemplate(entry);
  const mails = (c.assets.email.variants || []).map((v) => textOf(v.html));
  expect(mails.length).toBe(4);
  for (const m of mails) expect(m).toMatch(/It has been a while\. We are here whenever you are ready/);
  const st = (p) => c.assets.ads.find((a) => a.platform === p && a.creative_type === 'static');
  expect(st('meta').primary_text, 'Meta and Google read differently').not.toBe(st('google').primary_text);
  expect(st('tiktok').caption, 'TikTok and Meta read differently').not.toBe(st('meta').primary_text);
  expect(st('meta').primary_text.length).toBeLessThanOrEqual(125);
  expect(st('tiktok').caption.length).toBeLessThanOrEqual(100);
  const g = st('google');
  expect(g.headlines.length).toBeGreaterThanOrEqual(5);
  for (const h of g.headlines) expect(h.length).toBeLessThanOrEqual(30);
  for (const d of g.descriptions) expect(d.split(/\s+/).length, d).toBeGreaterThanOrEqual(3);
  const lp = textOf(c.assets.landing_pages[0].html);
  expect(lp).toMatch(/What Ledgerline Gazette offers/);
  expect(lp).toContain('Ward Watch');
});
