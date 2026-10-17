// Mailer body copy is justified, and a saved mailer from other renderer code
// is never replayed (2026-10-17).
//
// The operator, with a screenshot of /brain (Parwah): "alignment must be
// justified in mailers". The same screenshot showed a mailer saved before the
// fixes of that morning (invented benefits, a #0000EE divider): the saved
// bundle carried a hand-kept build version nobody bumped, so it was replayed.
// The version is now the content of the rendering code.
//
// Executed: the shipped buildCampaign on the template path and with a scripted
// model; every mailer (main + the four variants) rendered in Chromium and the
// COMPUTED alignment of each body paragraph read.
//
// Run: npx playwright test tests/mailer-justified.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];

const BRAND = {
  id: 'device:palmgrove', slug: 'palmgrove', name: 'Palmgrove Coffee', website: 'https://palmgrove.example', industry: 'Single-origin coffee roaster and store',
  tagline: 'Roasted on Tuesdays, at your door by Friday',
  palette: { primary: '#5A2E1B', accent: '#E0A43B', ink: '#2A1D16', surface: '#FFF9F1' },
  regions: [{ code: 'IN', currency: 'INR', store_url: 'https://palmgrove.example', home: true }],
  claims: ['Roasted in small batches every Tuesday at our estate in Coorg', 'Shipped within three days of roasting so every bag arrives fresh'],
  legal_entity: 'Palmgrove Coffee Pvt Ltd, Coorg 571201, India',
};
const ENTRY = {
  id: 'justify-1', date: '2026-10-20', market: 'IN', objective: 'reactivation', brand: BRAND,
  cohort: { name: 'At Risk', size: 1200, rules: ['r'] }, channels: ['email', 'landing_page'],
  confidence: 0.6, offer: { depth: 'none', pct: 0 },
  heroProduct: { sku: 'P1', title: 'Palmgrove Estate Medium Roast', handle: 'estate-medium', category: 'Coffee', image: 'https://palmgrove.example/cdn/e.jpg', price: 650 },
  supportingProducts: [{ sku: 'P2', title: 'Palmgrove Dark Roast', handle: 'dark', category: 'Coffee', image: 'https://palmgrove.example/cdn/d.jpg', price: 700 }],
};
const LONG = 'We noticed you have not visited Palmgrove Coffee in a while, so here is what has changed since your last order with us. Roasted in small batches every Tuesday at our estate in Coorg.';
const COPY = {
  email: { subject: 'Palmgrove Coffee: it has been a while', preheader: 'Here is what is new', hook: 'h', hero_headline: 'Back to the Estate Medium Roast',
    intro_paragraph: LONG, body_paragraph: 'Shipped within three days of roasting so every bag arrives fresh, and the medium roast is back on the shelf this week for everyone who asked about it.',
    benefits: BRAND.claims.slice(), rating: null, reviews: [], badges: [], guarantee: '', ps: 'The dark roast is back too, and it ships the same Friday as everything else in your order.', faq: [], cta: 'Come back', image_brief: 'x' },
  landing: { hero_headline: 'Back', hero_sub: 's', why_title: 'w', why_bullets: [], proof_quote: '', proof_author: '', faq: [], cta: 'Come back', image_brief: 'y' },
  ads: {},
};

async function build(noLLM) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const realLlm = require.cache[LLM]; const realPlan = require.cache[PLAN];
  try {
    const real = require(LLM);
    const stub = async (o) => ({ text: JSON.stringify(/strategy/.test(String(o.stage || '')) ? { angle: 'a', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] } : COPY), provider: 'scripted', model: 'scripted' });
    Object.assign(stub, real);
    require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
    delete require.cache[PLAN];
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return await require(PLAN).buildCampaign(JSON.parse(JSON.stringify(ENTRY)), smartConfig({}), { noLLM, withCreatives: false });
  } finally {
    require.cache[LLM] = realLlm; if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN];
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#caa"/></svg>';

test('every mailer sets its body copy justified, on the template path and the model path', async ({ page }) => {
  await page.route(/^https?:\/\//, (r) => r.fulfill({ contentType: 'image/svg+xml', body: PHOTO }));
  for (const noLLM of [true, false]) {
    const c = await build(noLLM);
    if (!noLLM) expect(c.copywriter && c.copywriter.provider).toBe('scripted');
    const mails = [{ name: 'main', html: c.assets.email.html }].concat(c.assets.email.variants.map((v) => ({ name: v.name || v.label, html: v.html })));
    expect(mails.length).toBeGreaterThanOrEqual(5);
    for (const vp of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
      await page.setViewportSize(vp);
      let wraps = 0;
      for (const m of mails) {
        await page.setContent(m.html, { waitUntil: 'load' });
        const paras = await page.evaluate(() => [...document.querySelectorAll('[data-mail-body], [data-ds="body"]')]
          .filter((el) => el.textContent.trim().length > 0)
          .map((el) => ({ t: el.textContent.trim().slice(0, 50), a: getComputedStyle(el).textAlign, lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '20')) })));
        const where = `${noLLM ? 'template' : 'model'} ${m.name} @${vp.width}`;
        expect(paras.length, `${where}: body paragraphs found`).toBeGreaterThan(0);
        for (const b of paras) expect(b.a, `${where}: "${b.t}"`).toBe('justify');
        wraps += paras.filter((b) => b.lines > 1).length;
      }
      // A check that measures only one-line paragraphs sees nothing: the
      // mailers carry wrapping paragraphs, where justification is visible.
      expect(wraps, `${noLLM ? 'template' : 'model'} @${vp.width}: wrapping paragraphs`).toBeGreaterThanOrEqual(3);
    }
  }
});

test('the fallback mailer (variants off) justifies its paragraphs and heads its benefits "What you get"', async ({ page }) => {
  await page.route(/^https?:\/\//, (r) => r.fulfill({ contentType: 'image/svg+xml', body: PHOTO }));
  const html = require(PLAN).__test_emailHtml(JSON.parse(JSON.stringify(ENTRY)), COPY, null);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.setContent(html, { waitUntil: 'load' });
  const paras = await page.evaluate(() => [...document.querySelectorAll('[data-mail-body]')].map((el) => getComputedStyle(el).textAlign));
  expect(paras.length).toBe(3);
  for (const a of paras) expect(a).toBe('justify');
  const heads = await page.evaluate(() => [...document.querySelectorAll('p')].map((p) => p.innerText.trim()).filter((t) => /^(what you get|why this changes everything)$/i.test(t)));
  expect(heads.map((t) => t.toLowerCase())).toEqual(['what you get']);
});

test('a mailer saved by other renderer code is rebuilt, never replayed', () => {
  const plan = require(PLAN);
  expect(plan.ASSET_BUILD_VERSION).toMatch(/^src\.[0-9a-f]{16}$/);
  expect(plan.__test_currentBuild({ build_version: plan.ASSET_BUILD_VERSION })).toBe(true);
  // The bundle on production's /brain (Parwah) was saved under this version.
  expect(plan.__test_currentBuild({ build_version: '2026-10-17.mailer-layout' })).toBe(false);
  expect(plan.__test_currentBuild({})).toBe(false);

  // Change one byte of a renderer the version covers: the version moves.
  const target = require.resolve(path.join(ROOT, 'api', '_shared', 'calendar-trigger.js'));
  const real = fs.readFileSync;
  const saved = require.cache[PLAN];
  fs.readFileSync = function (f, ...rest) { const out = real.call(fs, f, ...rest); return String(f) === target ? Buffer.concat([Buffer.from(out), Buffer.from(' ')]) : out; };
  try {
    delete require.cache[PLAN];
    const changed = require(PLAN).ASSET_BUILD_VERSION;
    expect(changed).not.toBe(plan.ASSET_BUILD_VERSION);
  } finally {
    fs.readFileSync = real; require.cache[PLAN] = saved;
  }
});
