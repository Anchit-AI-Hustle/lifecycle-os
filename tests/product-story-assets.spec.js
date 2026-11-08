// WHY TO BUY IT, in every asset, in the store's own words (2026-11-08).
// The operator: "ads are still awful - landing pages also very basic - no
// information on why to buy those products or details like that which
// increase sales", then "even update for mailers". A product's store
// description now reaches every ad, the landing page and the mailers, sorted by
// api/_shared/product-story.js. Nothing is written by us: every reason, answer
// and usage line asserted here is a sentence of the description below.
// Run: npx playwright test tests/product-story-assets.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PS = require(path.join(ROOT, 'api', '_shared', 'product-story.js'));
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];

const DESC = '<p>A lightweight face oil for dull, dry skin.</p><p>Cold-pressed from wild rosehip seeds grown in the Himalayas.</p><p>Absorbs in under a minute and leaves no greasy film.</p><p>Skin feels softer and looks brighter after two weeks of nightly use.</p><p>Use 3 to 4 drops at night on clean skin.</p><p>Free shipping on orders above Rs 499.</p>';
const WHY = 'Absorbs in under a minute and leaves no greasy film.';
const WHY2 = 'Skin feels softer and looks brighter after two weeks of nightly use.';
const INSIDE = 'Cold-pressed from wild rosehip seeds grown in the Himalayas.';
const HOW = 'Use 3 to 4 drops at night on clean skin.';
const BRAND = { id: 'device:arya', slug: 'arya', name: 'Arya Organics', website: 'https://aryaorganics.example', industry: 'skincare', tagline: 'Cold-pressed skincare made in small batches in Jaipur', claims: ['Cold-pressed oils', 'Made in small batches in Jaipur', 'No added fragrance'], palette: { primary: '#B4547A', accent: '#F0C987', ink: '#2E1A24', surface: '#FFF9FB' }, regions: [{ code: 'IN', currency: 'INR', home: true }], legal_entity: 'Arya Organics Pvt Ltd, Jaipur, India' };
const P = (t, n, price, x) => Object.assign({ sku: 'A' + n, title: t, handle: 'p' + n, image: `https://aryaorganics.example/img/${n}.jpg`, price, url: `https://aryaorganics.example/products/p${n}`, category: 'Face oil' }, x || {});

async function build(desc) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error(`network blocked: ${u}`); };
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const entry = { id: 'ps-arya', date: '2026-11-12', market: 'IN', objective: 'reactivation', brand: JSON.parse(JSON.stringify(BRAND)), cohort: { name: 'At Risk', size: 1500, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 },
      heroProduct: P('Rosehip Face Oil 30ml', 1, 899, { compare_at: 1199, description: desc }), supportingProducts: [P('Kumkumadi Night Serum 15ml', 2, 1299), P('Saffron Glow Cream 50g', 3, 749)] };
    return await require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js')).buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const textOf = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

test('the store description is sorted into what it is, reasons, what is in it and how to use it, verbatim', () => {
  const st = PS.story({ title: 'Rosehip Face Oil 30ml', description: DESC, size: '30ml' });
  expect(st.what).toBe('A lightweight face oil for dull, dry skin.');
  expect(st.benefits).toEqual([WHY, WHY2]);
  expect(st.inside).toEqual([INSIDE]);
  expect(st.how).toEqual([HOW]);
  // store boilerplate is never a reason
  expect(JSON.stringify(st)).not.toMatch(/shipping/i);
  // an attribute list is not a sentence
  expect(PS.story({ title: 'X', description: 'Trendy Maroon Brown Gradient Full Rim Round Tints Sunglasses' }).any).toBe(false);
  // questions say "it" and never ask a size the name already states
  expect(PS.faq(st, 'Rosehip Face Oil 30ml').map((q) => q.q)).toEqual(['How do I use it?', 'What is it made of?']);
});

test('ads lead with the product\'s own reasons, the video script uses reason, price and how to use it', async () => {
  const c = await build(DESC);
  const meta = c.assets.ads.find((a) => a.platform === 'meta' && a.creative_type === 'static');
  expect(meta.primary_text.startsWith(WHY)).toBe(true);
  expect(meta.primary_text).not.toMatch(/It has been a while/);
  const vid = c.assets.ads.find((a) => a.platform === 'meta' && a.creative_type === 'video');
  expect(vid.primary_text.startsWith(WHY2)).toBe(true);
  expect(vid.script).toContain(WHY);
  expect(vid.script).toContain(HOW);
  const g = c.assets.ads.find((a) => a.platform === 'google' && a.descriptions);
  expect(g.descriptions).toEqual(expect.arrayContaining([WHY, WHY2, INSIDE, HOW]));
  for (const a of c.assets.ads) expect(String(a.primary_text).length).toBeLessThanOrEqual(125);
  expect(c.contract_check.blocking).toBe(0);
});

test('the landing page gives the reasons and answers how to use it and what is in it; the mailers list the reasons', async () => {
  const c = await build(DESC);
  const A = textOf(c.assets.landing_pages.find((l) => l.variant === 'A').html);
  for (const s of [WHY, WHY2, INSIDE]) expect(A).toContain(s);
  expect(A).toContain('How do I use it?');
  expect(A).toContain(HOW);
  expect(A).not.toMatch(/<p>|&lt;p&gt;/);
  const B = textOf(c.assets.landing_pages.find((l) => l.variant === 'B').html);
  expect(B).toContain(WHY2);
  const mail = textOf(c.assets.email.html);
  expect(mail).toContain(WHY);
  expect(mail).not.toMatch(/&lt;p&gt;|\.\./);
  for (const v of c.assets.email.variants) {
    const t = textOf(v.html);
    expect(t, v.style || v.key).toMatch(new RegExp(`${WHY2.slice(0, 30)}|${WHY.slice(0, 30)}`));
    expect(t, v.style || v.key).toContain(HOW);
  }
});

test('a product with no description builds as before: the brand\'s own lines, nothing new invented', async () => {
  const c = await build('');
  const meta = c.assets.ads.find((a) => a.platform === 'meta' && a.creative_type === 'static');
  expect(meta.primary_text).not.toMatch(/absorbs|rosehip seeds/i);
  expect(textOf(c.assets.landing_pages[0].html)).not.toMatch(/Questions, answered/);
  expect(c.contract_check.blocking).toBe(0);
});
