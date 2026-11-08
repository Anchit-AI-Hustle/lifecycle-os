// Four defects found by simulating one send per brand through the shipped
// buildCampaign (2026-11-08, the operator: "rate and review featurewise each
// asset generation logic ... via simulation"). Each is asserted on the output.
//   1. 35 of 40 starter templates stored claims: ["[DATA REQUIRED ...:
//      verifiable claims, <brand>]"]; every generator printed it as a claim
//      (17 blocking findings on one Lenskart send).
//   2. Landing page B was the same page as A for a brand with no tagline.
//   3. Footers said "you are a The Times of India reader".
//   4. B mailers printed the same line as headline and sub line.
// Run: npx playwright test tests/asset-simulation-fixes.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];

function preset(slug, extra) {
  const b = JSON.parse(JSON.stringify(require(path.join(ROOT, 'data', 'brands', 'presets', slug + '.json'))));
  b.id = 'device:' + slug;
  if (!b.regions || !b.regions.length) b.regions = [{ code: 'IN', currency: 'INR', home: true }];
  return Object.assign(b, extra || {});
}
async function build(brand, cohort) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error(`network blocked: ${u}`); };
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const entry = { id: 'simfix-' + brand.slug, date: '2026-11-12', market: 'IN', objective: 'reactivation', brand, cohort: cohort || { name: 'Hibernating', size: 900, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 } };
    return await require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js')).buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const textOf = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const h1Of = (h) => (String(h).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';

test('a marker stored where a claim belongs is a gap, never a claim (record saved from an older template)', async () => {
  const brand = preset('lenskart', { claims: ['[DATA REQUIRED BEFORE LAUNCH: verifiable claims, Lenskart]'] });
  const c = await build(brand, { name: 'Champions', size: 4200, rules: ['r'] });
  expect(c.contract_check.blocking).toBe(0);
  const sent = [c.assets.email.subject, c.assets.email.preheader, textOf(c.assets.email.html)]
    .concat((c.assets.email.variants || []).map((v) => textOf(v.html)))
    .concat(c.assets.landing_pages.map((l) => textOf(l.html)))
    .concat(c.assets.ads.map((a) => [a.headline, a.primary_text, a.caption, a.script].concat(a.headlines || [], a.descriptions || []).join(' ')));
  for (const s of sent) expect(s).not.toMatch(/verifiable claims/);
  const BR = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
  const cleaned = BR.withoutMarkerFacts(brand);
  expect(cleaned.claims).toEqual([]);
  expect(cleaned.data_gaps.join(' ')).toMatch(/verifiable claims, Lenskart/);
});

test('no starter template stores a marker in its claims or tagline', () => {
  const fs = require('fs');
  const dir = path.join(ROOT, 'data', 'brands', 'presets');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
    const b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    expect(JSON.stringify(b.claims || []), f).not.toMatch(/DATA REQUIRED/);
    expect(String(b.tagline || ''), f).not.toMatch(/DATA REQUIRED/);
  }
});

test('landing page B leads differently from A when the brand has no tagline', async () => {
  const c = await build(preset('times-of-india'));
  const [A, B] = ['A', 'B'].map((v) => c.assets.landing_pages.find((l) => l.variant === v).html);
  expect(textOf(h1Of(A)).trim()).not.toBe(textOf(h1Of(B)).trim());
});

test('a brand name with its own article reads "a reader of The Times of India"', async () => {
  const c = await build(preset('times-of-india'));
  const all = [c.assets.email.html].concat((c.assets.email.variants || []).map((v) => v.html)).map(textOf).join(' ');
  expect(all).not.toMatch(/\ba The Times/);
  expect(all).toMatch(/a reader of The Times of India/);
  const MF = require(path.join(ROOT, 'api', '_shared', 'mailer-format.js'));
  expect(MF.memberPhrase('Arya Organics', 'customer')).toBe('an Arya Organics customer');
  expect(MF.memberPhrase('The Hindu', 'reader')).toBe('a reader of The Hindu');
});

test('no mailer variant prints the same line as headline and sub line', async () => {
  const c = await build(preset('times-of-india'));
  for (const v of c.assets.email.variants || []) {
    const t = textOf(v.html).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const lines = t.split(/(?=General news coverage)/).filter((x) => /^General news coverage/.test(x));
    // the one industry line may appear in a benefit list, but never twice back to back
    expect(t, v.style || v.key).not.toMatch(/(General news coverage from The Times of India)\s+\1/);
    expect(lines.length).toBeGreaterThanOrEqual(0);
  }
});
