// The prompt a person copies out of /brain and pastes into Claude, ChatGPT,
// or Gemini (2026-11-03). It has to be the same job the app just built, with
// the brand's own facts, and it must not hand the model the app's gap marker
// to print as copy, another brand's name, or a licence to invent proof.
//
// Run: npx playwright test tests/external-asset-prompts.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const mp = require(path.join(ROOT, 'api/_shared/master-prompt.js'));
const { smartConfig } = require(path.join(ROOT, 'lib/smart-brain/services.js'));

const FERN = {
  id: 'ws-fernwick',
  name: 'Fernwick Roasters',
  tagline: 'Small-lot coffee roasted on Tuesdays',
  industry: 'Coffee',
  business_model: 'commerce',
  website: 'https://fernwick.example',
  claims: ['Roasted in Bristol every Tuesday', 'Ships the next morning'],
  voice: { tone: 'plain and warm', banned: ['synergy'], no_em_dashes: true },
  palette: { primary: '#6B3A2A', accent: '#C4A574', surface: '#FBF7F2', ink: '#1C1410' },
  typography: { heading: { family: 'Source Serif 4', stack: 'Source Serif 4, Georgia, serif' }, body: { family: 'Source Sans 3', stack: 'Source Sans 3, sans-serif' } },
  legal_entity: 'Fernwick Roasters Ltd, 1 Queen Square, Bristol',
  logo_url: 'https://fernwick.example/logo.png',
  regions: [{ code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://fernwick.example', home: true }],
  offerings: [{ name: 'House espresso', url: 'https://fernwick.example/espresso' }],
  messaging_channels: ['sms', 'whatsapp', 'push'],
};

const DESK = {
  id: 'ws-harbour',
  name: 'Harbour Desk',
  tagline: 'The city, checked twice',
  industry: 'News',
  business_model: 'news_media',
  website: 'https://harbourdesk.example',
  claims: ['Every story is read by two editors'],
  voice: { tone: 'plain', no_em_dashes: true },
  palette: { primary: '#12344D', accent: '#E8F0F6', surface: '#F7F5F2', ink: '#14202B' },
  typography: { heading: { family: 'Source Serif 4' }, body: { family: 'Source Sans 3' } },
  legal_entity: 'Harbour Desk Ltd, 2 Quay Street, Bristol',
  regions: [{ code: 'GB', currency: 'GBP', symbol: '£', store_url: 'https://harbourdesk.example', home: true }],
  offerings: [{ name: 'Morning briefing', kind: 'programme', url: 'https://harbourdesk.example/briefing' }],
};

function brief(over) {
  return mp.buildMasterPrompt(Object.assign({
    brand: FERN,
    market: 'UK',
    cohort: 'Lapsed readers',
    brief: 'Reactivation',
    products: [{ title: 'Tuesday lot', price: 12, product_url: 'https://fernwick.example/tuesday' }],
    offer: { depth: 'light', pct: 0.1, code: 'TUE' },
    links: { store: 'https://fernwick.example', pdp: 'https://fernwick.example/tuesday' },
    written: { subject: 'Tuesday lot is roasted', headline: 'Tuesday lot' },
  }, over || {}));
}

test('a pasted mailer brief names the brand, the offer, and the bans, and does not print the app marker', () => {
  const p = brief({ assetType: 'mailer', variant: 'V2' });
  expect(p).toContain('Fernwick Roasters');
  expect(p).toContain('Roasted in Bristol every Tuesday');
  expect(p).toContain('Small-lot coffee roasted on Tuesdays');
  expect(p).toContain('Lapsed readers');
  expect(p).toContain('10% off');
  expect(p).toContain('code TUE');
  expect(p).toContain('https://fernwick.example/tuesday');
  expect(p).toContain('Tuesday lot is roasted');
  expect(p).toMatch(/DELIVERABLE: ONE COMPLETE EMAIL MAILER/);
  expect(p).toMatch(/OUTPUT FORMAT: ONE email HTML document/);
  expect(p).toMatch(/at most \d+ characters/);
  expect(p).toContain('No invented claim');
  expect(p).toContain('another brand');
  expect(p).toContain('unfilled tag');
  expect(p).toContain('500 millilitres');
  expect(p).toContain('No em dashes');
  expect(p).not.toMatch(/\[DATA REQUIRED BEFORE LAUNCH/);
  expect(p).not.toMatch(/knickgasm|Glossier|Nike|Morning Brew/i);
  expect(p).not.toMatch(/7-STEP|OpenMontage|Sell the emotional/i);
  expect(p).not.toMatch(/\/products\/\{handle\}/);
  expect(p.length).toBeGreaterThan(1500);
});

test('a news brief does not ask for a shop, a reader count, or another publication', () => {
  const p = mp.buildMasterPrompt({
    brand: DESK, assetType: 'mailer', variant: 'V2', market: 'GB', cohort: 'Regular readers',
    brief: 'Education',
  });
  expect(p).toContain('Harbour Desk');
  expect(p).toContain('Every story is read by two editors');
  expect(p).toContain('Lead Story');
  expect(p).toContain('Why it matters');
  expect(p).toContain('This brand is not a shop');
  expect(p).not.toMatch(/\[DATA REQUIRED BEFORE LAUNCH/);
  expect(p).not.toMatch(/Shop the edit|Axios AM|Morning Brew|The Hustle/i);
  expect(p).not.toMatch(/social proof bar \(reader count/i);
});

test('an ad brief states the platform limit and a message brief states the opt-out', () => {
  const ad = brief({ assetType: 'ad', platform: 'meta', written: { headline: 'Tuesday lot', primary_text: 'Roasted in Bristol every Tuesday.' } });
  expect(ad).toContain('primary text at most');
  expect(ad).toContain('Tuesday lot');
  expect(ad).toContain('Roasted in Bristol every Tuesday.');
  expect(ad).not.toMatch(/\[DATA REQUIRED BEFORE LAUNCH/);
  const sms = brief({ assetType: 'message', channel: 'sms', written: { text: 'Fernwick Roasters: Tuesday lot is roasted. Reply STOP to opt out.' } });
  expect(sms).toContain('ONE COMPLETE SMS');
  expect(sms).toContain('Reply STOP to opt out.');
  expect(sms).toContain('160');
  expect(sms).toContain('Fernwick Roasters: Tuesday lot is roasted.');
  expect(sms).not.toMatch(/\[DATA REQUIRED BEFORE LAUNCH/);
  const story = brief({ assetType: 'story', written: { headline: 'Tuesday lot', shots: ['hook · Tuesday lot'] } });
  expect(story).toContain('ONE COMPLETE STORY VIDEO');
  expect(story).toContain('at most 30 seconds');
  expect(story).toContain('hook · Tuesday lot');
  expect(story).not.toMatch(/\[DATA REQUIRED BEFORE LAUNCH/);
});

test('the rule is in the builder: dropping the rewrite would leave the marker in the brief', () => {
  // Mutation check. brandBlock still tells an internal caller to print the
  // marker. The pasted brief runs that block through forExternalModel. If the
  // rewrite is removed, the assertion above fails because the marker returns.
  const src = require('fs').readFileSync(path.join(ROOT, 'api/_shared/master-prompt.js'), 'utf8');
  expect(src).toMatch(/return forExternalModel\(/);
  expect(src).toMatch(/Never print a bracket marker/);
  const bare = mp.buildMasterPrompt({
    brand: { id: 'ws-bare', name: 'Bare Goods', voice: {}, regions: [{ code: 'US', home: true }] },
    assetType: 'mailer', market: 'US',
  });
  expect(bare).toContain('Bare Goods');
  expect(bare).not.toMatch(/\[DATA REQUIRED BEFORE LAUNCH/);
  expect(bare).toContain('leave it out');
});

async function build(brand, over) {
  const plan = require(path.join(ROOT, 'api/_shared/smart-brain-plan.js'));
  const entry = Object.assign({
    id: 'slot-external-1',
    date: '2026-11-05',
    market: 'UK',
    objective: 'Reactivation',
    cohort: { name: 'Quiet regulars', size: 80 },
    channels: ['email', 'meta', 'google', 'landing_page', 'sms', 'whatsapp', 'push'],
    heroProduct: { title: 'Tuesday lot', price: 12, product_url: 'https://fernwick.example/tuesday', category: 'coffee' },
    offer: { depth: 'light', pct: 0.1, code: 'TUE' },
    brand: JSON.parse(JSON.stringify(brand)),
  }, over || {});
  return plan.buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
}

test('the brief attached to a real build matches the asset and stays free of the marker', async () => {
  test.setTimeout(180000);
  const c = await build(FERN);
  const mail = c.assets.email.master_prompt_v2;
  expect(mail).toContain('Fernwick Roasters');
  expect(mail).toContain('Quiet regulars');
  expect(mail).toContain('10% off');
  expect(c.assets.email.subject).toBeTruthy();
  expect(mail).toContain(c.assets.email.subject);
  expect(mail).not.toMatch(/\[DATA REQUIRED BEFORE LAUNCH/);
  const ad = c.assets.ads.find((a) => a.platform === 'meta' && a.master_prompt);
  expect(ad.headline).toBeTruthy();
  expect(ad.master_prompt).toContain(ad.headline);
  expect(ad.master_prompt).toContain('primary text at most');
  const sms = (c.assets.messages || []).find((m) => m.channel === 'sms');
  expect(sms, 'the slot planned an SMS').toBeTruthy();
  expect(sms.master_prompt).toContain('Fernwick Roasters');
  expect(sms.master_prompt).toContain('Reply STOP to opt out.');
  expect(sms.text).toBeTruthy();
  expect(sms.master_prompt).toContain(sms.text.slice(0, 40));
  expect(sms.prompts[0].kind).toBe('asset');
  const storyAd = c.assets.ads.find((a) => a.story_prompt);
  if (storyAd) {
    expect(storyAd.prompts.some((r) => r.from === 'story_prompt' && r.kind === 'asset')).toBe(true);
    expect(storyAd.story_prompt).toContain('STORY VIDEO');
    expect(storyAd.story_prompt).not.toMatch(/\[DATA REQUIRED BEFORE LAUNCH/);
  }
  for (const lp of c.assets.landing_pages || []) {
    expect(lp.master_prompt).toContain('Fernwick Roasters');
    expect(lp.master_prompt).not.toMatch(/\/products\/\{handle\}/);
    expect(lp.master_prompt).not.toMatch(/\[DATA REQUIRED BEFORE LAUNCH/);
  }
});

test('a news build\'s pasted brief does not tell the model to write a shop', async () => {
  test.setTimeout(180000);
  const c = await build(DESK, { market: 'GB', heroProduct: { title: 'Morning briefing', product_url: 'https://harbourdesk.example/briefing' } });
  const mail = c.assets.email.master_prompt_v2;
  expect(mail).toContain('Harbour Desk');
  expect(mail).toContain('This brand is not a shop');
  expect(mail).not.toMatch(/\[DATA REQUIRED BEFORE LAUNCH/);
  expect(mail).not.toMatch(/knickgasm/i);
  if (c.assets.email.subject) expect(mail).toContain(c.assets.email.subject);
});
