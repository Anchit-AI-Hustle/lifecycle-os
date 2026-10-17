// The benchmark for each kind of business reaches the copy, safely (2026-10-17).
//
// asset-playbooks.js holds how a news digest, a market brief and a store's mail
// are built (benchmarked against Axios, Bloomberg, Glossier and others). Only
// the Studio's prompt read it: Smart Brain's copywriter and the pipeline never
// saw it, so a news publisher's mail was briefed like a shop's. And what the
// Studio did read carried invented figures written as instructions ("Join
// 120,000+ portfolio managers", "Save 25% with annual billing", "Free shipping
// over $50", a "30-day money-back" guarantee marked REQUIRED), a design rule
// asking for "dark or slate-tinted containers", and a hook example naming
// tenant zero for every brand. A market-data brand's assets also went out with
// no regulatory disclaimer: the playbook required one, and no renderer printed it.
//
// Executed: campaigns built by the shipped builder with a scripted model that
// records every prompt; the trigger mailer and the pipeline html stage called
// as they ship.
//
// Run: npx playwright test tests/business-model-benchmark.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const AP = require(path.join(ROOT, 'api', '_shared', 'asset-playbooks.js'));

const base = { regions: [{ code: 'IN', currency: 'INR', home: true }] };
const NEWS = Object.assign({ id: 'device:gazette', slug: 'gazette', name: 'Ledgerline Gazette', website: 'https://ledgerline.example', industry: 'news publishing',
  tagline: 'Pune news, checked twice by the desk', palette: { primary: '#7B2D5E', accent: '#C8A13B', ink: '#2A1F33', surface: '#FBF7EF' },
  legal_entity: 'Ledgerline Media LLP, Pune, India' }, base);
const MARKET = Object.assign({ id: 'device:tickerly', slug: 'tickerly', name: 'Tickerly Research', website: 'https://tickerly.example', industry: 'stock market research',
  tagline: 'Indian equities, explained before the open', palette: { primary: '#1F4E79', accent: '#E0A100', ink: '#14202B', surface: '#F7F9FC' },
  legal_entity: 'Tickerly Research Pvt Ltd, Mumbai, India' }, base);
const SHOP = Object.assign({ id: 'device:clayhouse', slug: 'clayhouse', name: 'Clayhouse Pottery', website: 'https://clayhouse.example', industry: 'handmade ceramics store',
  tagline: 'Stoneware thrown by hand in Jaipur', palette: { primary: '#9C4A2F', accent: '#2F6F62', ink: '#2A1A14', surface: '#FFF8F1' },
  legal_entity: 'Clayhouse Crafts LLP, Jaipur, India' }, base);

const slot = (brand) => ({
  id: 'bm-' + brand.slug, date: '2026-10-20', market: 'IN', objective: 'reactivation', brand,
  cohort: { name: 'At Risk', size: 1200, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
  confidence: 0.6, offer: { depth: 'none', pct: 0 },
});
const COPY = {
  email: { subject: 'Back where you left it', preheader: 'A short note', hook: 'h', hero_headline: 'Pick up where you left off', intro_paragraph: 'Intro.', body_paragraph: 'Body.', benefits: ['One', 'Two', 'Three'], rating: null, reviews: [], badges: [], guarantee: '', ps: 'Still there.', faq: [], cta: 'Continue', image_brief: 'x' },
  landing: { hero_headline: 'Ready when you are', hero_sub: 'Sub', why_title: 'Why', why_bullets: ['A', 'B', 'C'], proof_quote: '', proof_author: '', faq: [], cta: 'Continue', image_brief: 'y' },
  ads: { meta: { primary_text: 'p', headline: 'h', description: 'd', image_brief: 'z' }, google: { headlines: ['One', 'Two', 'Three'], descriptions: ['First description here.', 'Second description here.'], image_brief: 'w' }, tiktok: { script: 's', caption: 'c', image_brief: 'v' } },
};

const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
async function build(entry, { scripted = true } = {}) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const realLlm = require.cache[LLM]; const realPlan = require.cache[PLAN];
  const prompts = [];
  try {
    if (scripted) {
      const real = require(LLM);
      const stub = async (o) => {
        prompts.push(JSON.stringify(o));
        return { text: JSON.stringify(/strategy/.test(String(o.stage || '')) ? { angle: 'a', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] } : COPY), provider: 'scripted', model: 'scripted' };
      };
      Object.assign(stub, real);
      require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
      delete require.cache[PLAN];
    }
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const campaign = await require(PLAN).buildCampaign(entry, smartConfig({}), { noLLM: !scripted });
    return { campaign, prompts };
  } finally {
    if (scripted) { require.cache[LLM] = realLlm; if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN]; }
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const copyPromptOf = (prompts) => prompts.find((p) => /Write campaign copy for this planned slot/.test(p)) || '';
const count = (s, needle) => String(s).split(needle).length - 1;

// Figures and rules the benchmark data used to carry as instructions.
const INVENTED = /120,000|85k|\$50|Save 25%|30-day money-back|50,000 People|4 Million|\$4\.2B|14 hours|22% subscriber|34% lift|Knickgasm|dark or slate|dark mode friendly|weather\/city/i;

test('the copywriter is briefed with the benchmark for its own business, and nothing invented rides along', async () => {
  const seen = {};
  for (const [brand, label] of [[NEWS, 'news media'], [MARKET, 'market data'], [SHOP, 'commerce']]) {
    const { prompts } = await build(slot(brand));
    const p = copyPromptOf(prompts);
    expect(p, `${brand.name}: the copy prompt was not sent`).toBeTruthy();
    expect(p, `${brand.name}: no benchmark in the copy prompt`).toContain(`COMPETITIVE BENCHMARK (${label}`);
    expect(p).toContain('borrow the STRUCTURE and the order of sections only');
    expect(p.match(INVENTED), `${brand.name}: the prompt carries an invented figure or rule`).toBeNull();
    for (const other of ['news media', 'market data', 'commerce'].filter((l) => l !== label)) {
      expect(p, `${brand.name}: briefed with another business's benchmark`).not.toContain(`COMPETITIVE BENCHMARK (${other}`);
    }
    seen[label] = true;
  }
  expect(Object.keys(seen)).toHaveLength(3);
});

test('no playbook, block or hook catalogue carries an invented figure, a dark ground or another brand', () => {
  for (const brand of [NEWS, MARKET, SHOP, { name: 'Gather', offerings: [{ kind: 'event', name: 'Summit' }] }, { name: 'Atelier', offerings: [{ kind: 'service', name: 'Commission' }] }, { name: 'Club', offerings: [{ kind: 'plan', name: 'Annual' }] }]) {
    for (const t of ['mailer_v2', 'mailer_v1', 'ad_meta', 'landing_page']) {
      expect(AP.playbookBlock(brand, t, { market: 'IN' }).match(INVENTED), `${brand.name} ${t}`).toBeNull();
    }
    const hooks = JSON.stringify(AP.competitorHooksFor(brand));
    expect(hooks.match(INVENTED), `${brand.name} hooks`).toBeNull();
  }
});

test('a market-data brand\'s mail, every variant and its page close with the disclaimer; other businesses carry none', async () => {
  const want = AP.financialDisclaimer('IN', MARKET);
  for (const scripted of [true, false]) {
    const { campaign } = await build(slot(MARKET), { scripted });
    const e = campaign.assets.email;
    expect(count(e.html, 'data-disclaimer'), `email (${scripted ? 'model' : 'template'})`).toBe(1);
    expect(e.html).toContain('SEBI (Research Analysts) Regulations, 2014');
    for (const v of e.variants || []) expect(count(v.html, 'data-disclaimer'), `variant ${v.key}`).toBe(1);
    expect((campaign.assets.landing_pages || []).length).toBeGreaterThan(0);
    for (const lp of campaign.assets.landing_pages) expect(count(lp.html, 'data-disclaimer'), `landing ${lp.variant || ''}`).toBe(1);
    expect(campaign.disclaimer).toBe(want);
    // Above the sender line, not under the unsubscribe.
    const i = e.html.indexOf('data-disclaimer'); const j = e.html.search(/receiving this as/i);
    if (j > -1) expect(i).toBeLessThan(j);
  }
  for (const brand of [NEWS, SHOP]) {
    const { campaign } = await build(slot(brand), { scripted: false });
    const all = [campaign.assets.email.html, ...(campaign.assets.landing_pages || []).map((l) => l.html)].join('\n');
    expect(all, `${brand.name} should carry no financial disclaimer`).not.toContain('data-disclaimer');
  }
});

test('the trigger mailer and the pipeline html stage print it too, once', async () => {
  const CT = require(path.join(ROOT, 'api', '_shared', 'calendar-trigger.js'));
  for (const style of ['pure', 'visual', 'editorial']) {
    const html = CT.helpers.renderTextVariant({ style, brand: MARKET, market: 'IN', subject: 's', hero_headline: 'h', body_blocks: [{ heading: "H", body: "Body." }], cta_text: 'See the research', cta_url: 'https://tickerly.example/' });
    expect(count(html, 'data-disclaimer'), style).toBe(1);
    const shop = CT.helpers.renderTextVariant({ style, brand: SHOP, market: 'IN', subject: 's', hero_headline: 'h', body_blocks: [{ heading: "H", body: "Body." }], cta_text: 'Shop now', cta_url: 'https://clayhouse.example/' });
    expect(shop).not.toContain('data-disclaimer');
  }
  // Idempotent: a second pass adds nothing.
  const once = AP.withDisclaimer('<html><body><p style="color:#123">You are receiving this as a customer.</p></body></html>', MARKET, 'US');
  expect(AP.withDisclaimer(once, MARKET, 'US')).toBe(once);
  expect(once).toContain('<p data-disclaimer style="color:#123">');
});
