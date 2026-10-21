// A measurement is written as a person says it, for any brand (2026-10-21).
//
// The operator: "there must be basic understanding, like the letter W ... it means
// watts, so basically 100 watts, it shouldn't say 100 W ... It could be based on any
// brand ... for another brand it could be any other spectrum." A power-bank brand's
// claim "100W fast charging" reached the mail (header comment, body, every variant),
// the landing pages, every ad, the video's on-screen words and the prompts an
// operator copies into ChatGPT or Gemini, all as "100W".
//
// Executed: unit-words.js over real copy shapes; the shipped buildCampaign on the
// template path and with a scripted model that writes symbols; brandBlock and the
// output contract every prompt ends with; brand-runtime's scrubbers (generate.js,
// the pipeline and the landing page builder); the compliance gate's claim match.
//
// Run: npx playwright test tests/unit-words.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const U = require(path.join(ROOT, 'api', '_shared', 'unit-words.js'));
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];

const BRAND = {
  id: 'device:voltwell', slug: 'voltwell', name: 'Voltwell', website: 'https://voltwell.example', industry: 'power banks and chargers',
  tagline: 'Power that keeps up', palette: { primary: '#1F4E79', accent: '#F2B134', ink: '#14212E', surface: '#FFFFFF' },
  regions: [{ code: 'IN', currency: 'INR', home: true }],
  claims: ['100W fast charging', '20000mAh battery in a 300g body'],
  legal_entity: 'Voltwell Devices Pvt Ltd, Pune, India',
};
const SLOT = {
  id: 'units-1', date: '2026-10-22', market: 'IN', objective: 'reactivation', brand: BRAND,
  cohort: { name: 'At Risk', size: 1200, rules: ['no order in 90 days'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
  confidence: 0.6, offer: { depth: 'none', pct: 0 },
};
// What a model writes when it copies the store's spec line.
const MODEL = {
  email: {
    subject: 'Your 100W charger is waiting', preheader: 'Charge at 100 W, carry 20000mAh', hook: 'h', hero_headline: '100W for every device',
    intro_paragraph: 'Plug in and get 100W fast charging. The 20000mAh battery weighs just 300g.', body_paragraph: 'Charges a laptop at 65 W.',
    benefits: ['100W fast charging'], rating: null, reviews: [], badges: [], guarantee: '', ps: 'P.S. 100W is a lot.', faq: [], cta: 'Get 100W', image_brief: 'x',
  },
  landing: { hero_headline: '100W fast charging', hero_sub: '20000mAh in your pocket.', why_title: 'Why Voltwell', why_bullets: ['100W fast charging'], proof_quote: '', proof_author: '', faq: [], cta: 'Shop 100W', image_brief: 'y' },
  ads: {
    meta: { primary_text: 'Get 100W fast charging and a 20000mAh battery.', headline: '100W fast charging', description: 'Voltwell', image_brief: 'z' },
    google: { headlines: ['Voltwell', '100W fast charging', 'Charge at 100W today'], descriptions: ['A 20000mAh battery in a 300g body.', 'Charge at 100 W.'], image_brief: 'w' },
    tiktok: { script: '100W. That is the hook.', caption: '100W fast charging', image_brief: 'v' },
  },
};

async function build(model) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const realLlm = require.cache[LLM]; const realPlan = require.cache[PLAN];
  try {
    if (model) {
      const real = require(LLM);
      const stub = async (o) => ({ text: JSON.stringify(/strategy/.test(String(o.stage || '')) ? { angle: 'a', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] } : MODEL), provider: 'scripted', model: 'scripted' });
      Object.assign(stub, real);
      require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
    }
    delete require.cache[PLAN];
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return await require(PLAN).buildCampaign(JSON.parse(JSON.stringify(SLOT)), smartConfig({}), { noLLM: !model, withCreatives: false });
  } finally {
    require.cache[LLM] = realLlm; if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN];
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// Every string a reader sees in the finished campaign, with where it is. Prompts,
// URLs, ids and the checks are not copy.
function readerStrings(c) {
  const out = [];
  const skip = /prompt|url|^id$|_id$|image|src|href|key|platform|type|aspect|format|path|slug|handle|sku|code|check|__|says/i;
  const walk = (o, where, key) => {
    if (typeof o === 'string') {
      if (skip.test(key || '')) return;
      const text = /html$/i.test(key || '') ? o.replace(/<!--\s*\[[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]*>/g, ' ') : o;
      out.push({ where, text });
    } else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${where}[${i}]`, key));
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], `${where}.${k}`, k);
  };
  walk(c.assets, 'assets'); walk(c.platform_ready, 'platform_ready');
  return out;
}
const SYMBOL = /(?<![\p{L}\p{N}])\d[\d,.]*\s?(?:W|mAh|g)(?![\p{L}\p{N}])/u;

test('the expander: what it spells, how, and what it leaves alone', () => {
  const cases = [
    ['Charges at 100 W.', 'Charges at 100 watts.'],
    ['Get 100W fast charging.', 'Get 100-watt fast charging.'],
    ['A 20000mAh power bank with 65W output', 'A 20000-milliamp-hour power bank with 65-watt output'],
    ['Pour 500ml of milk', 'Pour 500 millilitres of milk'],
    ['1 kg pack', '1-kilogram pack'],
    ['Store below 25°C.', 'Store below 25 degrees Celsius.'],
    ['Up to 60 mph', 'Up to 60 miles per hour'],
    ['A 1 W lamp', 'A 1-watt lamp'],
    ['Runs on 1.5 V', 'Runs on 1.5 volts'],
  ];
  for (const [i, o] of cases) expect(U.spellUnits(i), i).toBe(o);
  // Never touched: a model code, a URL, a network generation, a phrase, a screen size.
  for (const keep of ['Frame VC5158W', 'https://voltwell.example/p/100W-charger', 'Works on 5G and 5g', 'A 2 in 1 cable', '4K at 1080p', 'SKU #100W']) {
    expect(U.spellUnits(keep), keep).toBe(keep);
  }
  expect(U.spellUnits('Pour 500ml', { locale: 'US' })).toBe('Pour 500 milliliters');
  // HTML: text only, never an attribute, a style, a script or an Outlook block; a header comment is text.
  const html = '<!--\nPREHEADER: 100W fast\n--><!--[if mso]><v:rect style="width:100px"/><![endif]--><a href="/p/100W" title="100W">Get 100W</a><style>a{x:5ml}</style><script>var w="100W"</script>';
  expect(U.spellUnitsHtml(html)).toBe('<!--\nPREHEADER: 100-watt fast\n--><!--[if mso]><v:rect style="width:100px"/><![endif]--><a href="/p/100W" title="100W">Get 100 watts</a><style>a{x:5ml}</style><script>var w="100W"</script>');
});

for (const [label, model] of [['template copy', false], ['a model that copies the spec line', true]]) {
  test(`every reader-facing line of a built campaign says the unit in words (${label})`, async () => {
    const c = await build(model);
    if (model) expect(c.copywriter && c.copywriter.provider).toBe('scripted');
    const strings = readerStrings(c);
    expect(strings.length, 'the walk read the campaign').toBeGreaterThan(40);
    const left = strings.filter((s) => SYMBOL.test(s.text) && !/\[DATA REQUIRED/.test(s.text));
    expect(left.map((s) => `${s.where}: ${s.text.match(SYMBOL)[0]}`), 'a unit left as its symbol').toEqual([]);
    const all = strings.map((s) => s.text).join(' ');
    expect(all).toMatch(/100-watt fast charging/);
    if (model) expect(all).toMatch(/100 watts/);
    expect(c.unit_words && c.unit_words.spelled).toBeGreaterThan(0);
    // The words still sit inside every platform limit, and nothing blocks.
    expect(c.contract_check.blocking).toBe(0);
    // The brand's own claim, stated with a symbol, is still recognised as approved.
    const f = JSON.stringify(c.contract_check.compliance || {});
    expect(f).not.toMatch(/100-watt[^"]*unapproved|unapproved[^"]*100-watt/i);
  });
}

test('an ad line whose words would break the platform limit keeps its symbol, and the build says so', () => {
  const plan = require(PLAN);
  const long = 'Voltwell 100W, 65W, 20W, 5W';
  const campaign = { assets: { ads: [{ platform: 'google', creative_type: 'static', headlines: [long, 'Voltwell 100W'] }] } };
  plan.attachUnitWords(campaign, { brand: BRAND });
  expect(campaign.assets.ads[0].headlines[0]).toBe(long);
  expect(campaign.assets.ads[0].headlines[1]).toBe('Voltwell 100 watts');
  expect(campaign.unit_words.kept_for_limit.map((k) => k.text)).toEqual([long]);
});

test('every prompt carries the rule, the brand block states the claims in words, element prompts stay one line', () => {
  const rt = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
  const OC = require(path.join(ROOT, 'api', '_shared', 'output-contract.js'));
  const block = rt.brandBlock(BRAND);
  expect(block).toContain(U.RULE);
  expect(block).toContain('"100-watt fast charging"');
  expect(block).not.toMatch(/"100W fast charging"/);
  for (const kind of ['asset', 'reply', 'data']) {
    const b = OC.block({ id: 'u-' + kind, kind, returns: 'x', format: kind === 'data' ? 'json' : 'text', schema: { a: 'string' } });
    expect(b, kind).toMatch(/Units: write every unit of measure/);
  }
  expect(OC.block({ id: 'u-el', kind: 'element', returns: 'x', format: 'text' })).not.toMatch(/Units:/);
  // The browser loads the same file.
  const fs = require('fs');
  expect(fs.readFileSync(path.join(ROOT, 'output-contract.js'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'api', '_shared', 'output-contract.js'), 'utf8'));
});

test('the scrubbers every other generator runs through spell units too', () => {
  const rt = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
  expect(rt.scrubForBrand('Get 100W fast charging', BRAND)).toBe('Get 100-watt fast charging');
  expect(rt.scrubHtmlForBrand('<p data-w="100W">Get 100W fast charging</p>', BRAND)).toBe('<p data-w="100W">Get 100-watt fast charging</p>');
});

test('the compliance gate approves a claim stated with a symbol when the copy says it in words', () => {
  const lint = require(path.join(ROOT, 'api', '_shared', 'compliance-lint.js'));
  const html = '<p>The fastest 100-watt charger in India.</p>';
  const absolutes = (claims) => (lint.lint({ subject: 'x', html }, { brand: Object.assign({}, BRAND, { claims }), market: 'IN' }).findings || [])
    .filter((f) => /absolute|superlative/.test(String(f.rule || f.id || '')) && f.level !== 'ok');
  // Unapproved, the line is held (the gate is looking); approved as "100W", the words are the same claim.
  expect(absolutes([]).length).toBeGreaterThan(0);
  expect(absolutes(['The fastest 100W charger in India'])).toEqual([]);
});
