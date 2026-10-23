// SMS, WhatsApp and push are built as real assets, and the standalone
// generator finishes what it returns (2026-10-23).
//
// Before this, nothing in the app wrote an SMS, a WhatsApp message or a push
// notification (Smart Brain built email, ads and landing pages only), and
// /api/ai/generate handed the model's answer back with only a dash scrub: a
// landing page could carry a base64 photo, an unfilled {{merge_tag}}, a link
// to "#", a DATA REQUIRED marker or a claim the brand never made, and no
// response said whether the asset met its own contract.
//
// Executed, never read:
//   1-5. campaigns built by the shipped Smart Brain builder (template path and
//        a scripted-model path) and the shipped planners, for a brand that
//        states SMS / WhatsApp / push, one that states nothing, and one with
//        no page on record;
//   6-8. /api/ai/generate driven through the router harness (the request
//        scope, the credit meter and the brand resolution as shipped) with a
//        scripted model answering with the defects above;
//   9.   smart-brain.html's preview rendered in Chromium with the three panes.
//
// Run: npx playwright test tests/channel-generators.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');
const A = require('./agents-harness');
const H = require('./router-harness');
const F = require('./lib/brand-invariant-fixtures');

const ROOT = path.resolve(__dirname, '..');
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));

const ROAST = {
  id: 'device:roastwell', slug: 'roastwell', name: 'Roastwell', website: 'https://roastwell.example', industry: 'coffee roaster',
  tagline: 'Coffee in 250g bags, roasted every Tuesday in Pune', palette: { primary: '#6B2E1F', accent: '#E0A458', ink: '#2A1B14', surface: '#FFF8F0' },
  regions: [{ code: 'IN', currency: 'INR', home: true, store_url: 'https://roastwell.example' }], claims: ['Roasted every Tuesday in Pune'],
  legal_entity: 'Roastwell Coffee LLP, Pune, India', channels: ['email', 'sms', 'whatsapp', 'push'],
};
const QUIET = Object.assign({}, ROAST, { id: 'device:quietco', slug: 'quietco', name: 'Quietco' });
delete QUIET.channels;
// No website, no store, no legal sender: a message for it carries no link, no marker.
const NOSTORE = { id: 'device:hollowmere', slug: 'hollowmere', name: 'Hollowmere', regions: [{ code: 'IN', home: true }], brand_data: { channels: ['SMS', 'WhatsApp', 'push notifications'] } };

const BASE = ['email', 'meta', 'google', 'tiktok', 'landing_page'];
const slot = (brand, channels) => ({
  id: 'chan-' + brand.slug, date: '2026-10-20', market: 'IN', objective: 'reactivation', brand,
  cohort: { name: 'At Risk', size: 1200, rules: ['r'] }, channels: channels || BASE.slice(),
  confidence: 0.6, offer: { depth: 'none', pct: 0 },
  heroProduct: { title: 'Monsoon Malabar', sku: 'mm1', handle: 'monsoon-malabar', category: 'coffee', product_url: 'https://roastwell.example/products/monsoon-malabar' },
});
const services = () => require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));

const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
async function build(entry, { scripted } = {}) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const realLlm = require.cache[LLM]; const realPlan = require.cache[PLAN];
  const prompts = [];
  try {
    if (scripted) {
      const real = require(LLM);
      const stub = async (o) => {
        prompts.push(String(o.userMessage || ''));
        return { text: JSON.stringify(/strategy/.test(String(o.stage || '')) ? { angle: 'a', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] } : scripted), provider: 'scripted', model: 'scripted' };
      };
      Object.assign(stub, real, { keylessOnly: async () => false });
      require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
      delete require.cache[PLAN];
    }
    const plan = require(PLAN);
    const c = await plan.buildCampaign(entry, services().smartConfig({}), { noLLM: !scripted, withCreatives: false });
    return Object.assign(c, { __prompts: prompts });
  } finally {
    if (scripted) { require.cache[LLM] = realLlm; if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN]; }
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const msg = (c, ch) => ((c.assets && c.assets.messages) || []).find((m) => m.channel === ch);
const PLACEHOLDER = /\[DATA REQUIRED|\{\{|\{%/;

/* ═══ 1. the planner ═══════════════════════════════════════════════════════ */

test('a brand that states SMS / WhatsApp / push is planned on them; a brand that states nothing keeps exactly its channels', () => {
  const S = services();
  expect(S.plannedChannels(BASE, ROAST)).toEqual(BASE.concat(['sms', 'whatsapp', 'push']));
  expect(S.plannedChannels(BASE, NOSTORE), 'a channel stated in brand_data, in words').toEqual(BASE.concat(['sms', 'whatsapp', 'push']));
  expect(S.plannedChannels(BASE, QUIET), 'a brand that states nothing gained a channel').toEqual(BASE);
  expect(S.plannedChannels(BASE, null)).toEqual(BASE);
  expect(S.BUILT_CHANNELS).toEqual(expect.arrayContaining(['email', 'meta', 'google', 'youtube', 'tiktok', 'landing_page', 'sms', 'whatsapp', 'push']));

  // The shipped planners, both paths that have no catalogue or analytics.
  const plan = require(PLAN);
  for (const [brand, extra] of [[ROAST, ['sms', 'whatsapp', 'push']], [QUIET, []]]) {
    const strat = plan.__test_strategyPlanEntries(brand, '2026-10-20', 3, '');
    expect(strat.length).toBeGreaterThan(0);
    for (const e of strat) expect(e.channels, `${brand.name} strategy slot`).toEqual(S.BASE_CHANNELS.concat(extra));
    const offs = plan.__test_resolveBrandOfferings(Object.assign({}, brand, { offerings: [{ kind: 'product', name: 'Monsoon Malabar 250g', url: 'https://roastwell.example/products/monsoon-malabar' }] }));
    const byOff = plan.__test_offeringPlanEntries(brand, offs, '2026-10-20', 3, '');
    expect(byOff.length).toBeGreaterThan(0);
    for (const e of byOff) expect(e.channels, `${brand.name} offering slot`).toEqual(S.BASE_CHANNELS.concat(extra));
    // Every scenario keeps the owned messaging channels the brand sends on.
    const v = plan.buildStandbyVariant(Object.assign({}, byOff[0]), 'emergency', { analysis: { productScores: [] } }, {});
    expect(v.channels).toEqual(['email', 'landing_page'].concat(extra));
  }
});

/* ═══ 2. SMS ═══════════════════════════════════════════════════════════════ */

test('an SMS for a brand that sends them: its sender first, its own page, an opt-out, one GSM-7 part, judged by its contract', async () => {
  const c = await build(slot(ROAST, services().plannedChannels(BASE, ROAST)));
  const sms = msg(c, 'sms');
  expect(sms, 'no SMS was built').toBeTruthy();
  expect(sms.text.startsWith('Roastwell: ')).toBe(true);
  expect(sms.text).toMatch(/Reply STOP to opt out\.$/);
  expect(sms.text).toContain('https://roastwell.example/products/monsoon-malabar');
  expect(sms.text).not.toMatch(PLACEHOLDER);
  expect(sms.text).not.toMatch(/[—–]/);
  expect(sms.text).toContain('Monsoon Malabar');
  expect(sms.encoding).toMatchObject({ encoding: 'GSM-7', segments: 1 });
  expect(sms.text.length).toBeLessThanOrEqual(160);
  expect(sms.legal_sender).toBe(ROAST.legal_entity);
  expect(sms.contract_check).toMatchObject({ contract: 'sms.message', ok: true, blocking: 0 });
  expect(sms.compliance_check && Array.isArray(sms.compliance_check.findings), 'the compliance gate never read the SMS').toBe(true);
  expect(c.contract_check.by_contract['sms.message']).toBe(1);
  // An SMS link is never UTM-tagged: every character is part of its length.
  expect(sms.link).not.toMatch(/utm_/);

  // The contract itself: no opt-out and no sender BLOCK; a long text warns with its parts.
  const ac = require(path.join(ROOT, 'api', '_shared', 'asset-contracts.js'));
  const noStop = ac.check({ channel: 'sms', sender: 'Roastwell', text: 'Roastwell: Fresh coffee is roasted.' });
  expect(noStop.violations.find((v) => v.slot === 'opt_out')).toMatchObject({ level: 'block' });
  const noSender = ac.check({ channel: 'sms', sender: 'Roastwell', text: 'Fresh coffee. Reply STOP to opt out.' });
  expect(noSender.violations.find((v) => v.slot === 'sender')).toMatchObject({ level: 'block' });
  const long = ac.check({ channel: 'sms', sender: 'Roastwell', text: 'Roastwell: ' + 'roasted '.repeat(25) + 'Reply STOP to opt out.' });
  expect(long.ok).toBe(true);
  expect(long.violations.find((v) => v.slot === 'text').message).toMatch(/sent as 2 parts of 153/);
  const emoji = ac.check({ channel: 'sms', sender: 'Roastwell', text: 'Roastwell: Fresh ☕. Reply STOP to opt out.' });
  expect(emoji.violations.find((v) => v.slot === 'text').message).toMatch(/UCS-2/);
});

/* ═══ 3. nothing new for a brand that states nothing ═══════════════════════ */

test('a brand that states no messaging channel: no message, no messaging prompt, the rest of the build unchanged', async () => {
  const entry = slot(QUIET, services().plannedChannels(BASE, QUIET));
  expect(entry.channels).toEqual(BASE);
  const plan = require(PLAN);
  const prompt = plan.__test_copyPrompt(entry);
  expect(prompt).not.toMatch(/Messaging \(|"messaging"|messaging:/);
  const c = await build(entry);
  expect(c.assets.messages, 'a message was built for a brand that states no such channel').toBeUndefined();
  expect(c.contract_check.by_contract['sms.message']).toBeUndefined();
  expect(c.assets.email && c.assets.email.html).toBeTruthy();
  expect(c.assets.ads.length).toBeGreaterThan(0);
  expect(c.assets.landing_pages.length).toBeGreaterThan(0);
  // A brand that does state them is briefed for them in the SAME copy call.
  const p2 = plan.__test_copyPrompt(slot(ROAST, services().plannedChannels(BASE, ROAST)));
  expect(p2).toMatch(/Messaging \(sms, whatsapp, push\)/);
  expect(p2).toMatch(/messaging/);
});

/* ═══ 4. WhatsApp, model path ══════════════════════════════════════════════ */

test('WhatsApp is an approved-template shape; the model\'s line is grounded, an unbacked claim and a merge tag never ship', async () => {
  const COPY = {
    email: { subject: 'Back where you left it', preheader: 'A short note', hook: 'h', hero_headline: 'Pick up where you left off', intro_paragraph: 'Intro.', body_paragraph: 'Body.', benefits: [], rating: null, reviews: [], badges: [], guarantee: '', ps: 'Still here.', faq: [], cta: 'Shop now', image_brief: 'x' },
    landing: { hero_headline: 'Ready when you are', hero_sub: 'Sub', why_title: 'Why', why_bullets: [], proof_quote: '', proof_author: '', faq: [], cta: 'Shop now', image_brief: 'y' },
    ads: { meta: { primary_text: 'p', headline: 'h', description: 'd', image_brief: 'z' }, google: { headlines: ['One', 'Two', 'Three'], descriptions: ['First description here.', 'Second description here.'], image_brief: 'w' }, tiktok: { script: 's', caption: 'c', image_brief: 'v' } },
    messaging: {
      sms: { text: 'Our award-winning beans are back. Your Monsoon Malabar is ready, {{first_name}}.' },
      whatsapp: { header: 'Your Tuesday roast', body: 'Monsoon Malabar is back on the shelf. It is the best coffee in India.', button: 'See the roast' },
      push: { title: 'Back on the shelf', body: 'Monsoon Malabar is roasted every Tuesday in Pune.' },
    },
  };
  const c = await build(slot(ROAST, services().plannedChannels(BASE, ROAST)), { scripted: COPY });
  // The same copy call carried the messaging contract.
  expect(c.__prompts.some((p) => /"messaging"|messaging:/.test(p) && /OUTPUT REQUIREMENT/.test(p)), 'the copy prompt never asked for the messaging lines').toBe(true);
  const wa = msg(c, 'whatsapp');
  expect(wa).toBeTruthy();
  expect(wa.source).toBe('model');
  expect(wa.headline).toBe('Your Tuesday roast');
  expect(wa.body).toContain('Monsoon Malabar is back on the shelf.');
  expect(wa.body, 'an unbacked superlative reached the WhatsApp body').not.toMatch(/best coffee/i);
  expect(wa.footer).toMatch(/Reply STOP/);
  expect(wa.template).toMatchObject({ category: 'MARKETING', language: 'en_IN' });
  const comps = wa.template.components.map((x) => x.type);
  expect(comps).toEqual(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']);
  expect(wa.template.components[1].text).toBe(wa.body);
  expect(wa.buttons).toHaveLength(1);
  expect(wa.buttons[0]).toMatchObject({ type: 'URL', text: 'See the roast' });
  expect(wa.buttons[0].url).toMatch(/^https:\/\/roastwell\.example\/products\/monsoon-malabar\?utm_source=whatsapp/);
  expect(JSON.stringify(wa.template)).not.toMatch(/\{\{\s*\d+\s*\}\}|DATA REQUIRED/);
  expect(wa.contract_check).toMatchObject({ contract: 'whatsapp.message', ok: true });
  // A measurement is said as a person says it (unit-words), in the template too.
  const tplWa = msg(await build(slot(ROAST, services().plannedChannels(BASE, ROAST))), 'whatsapp');
  expect(tplWa.body).toMatch(/250.gram/);
  expect(tplWa.body).not.toMatch(/250g\b/);

  const sms = msg(c, 'sms');
  expect(sms.text, 'a claim the brand never made reached the SMS').not.toMatch(/award/i);
  expect(sms.text, 'an unfilled merge tag reached the SMS').not.toMatch(/\{\{/);
  const dropped = (c.copy_grounding && c.copy_grounding.dropped) || [];
  expect(dropped.some((d) => /messaging\.whatsapp\.body/.test(d.field))).toBe(true);
  expect(dropped.some((d) => /messaging\.sms\.text/.test(d.field))).toBe(true);
  const push = msg(c, 'push');
  expect(push).toMatchObject({ title: 'Back on the shelf', body: 'Monsoon Malabar is roasted every Tuesday in Pune.' });
});

/* ═══ 5. push, and a brand with no page on record ══════════════════════════ */

test('push carries a title, a body and the brand\'s own deep link; a brand with no page gets no link and no marker, the gap in data_gaps', async () => {
  const c = await build(slot(ROAST, services().plannedChannels(BASE, ROAST)));
  const push = msg(c, 'push');
  expect(push.title).toBeTruthy();
  expect(push.body).toBeTruthy();
  expect(push.title.toLowerCase()).not.toBe(push.body.toLowerCase());
  expect(push.deep_link).toMatch(/^https:\/\/roastwell\.example\/.*utm_source=push/);
  expect(push.contract_check).toMatchObject({ contract: 'push.notification', ok: true });

  const e = slot(NOSTORE, services().plannedChannels(BASE, NOSTORE));
  e.heroProduct = { title: '[DATA REQUIRED BEFORE LAUNCH: product catalogue, Hollowmere, IN]', placeholder: true };
  const c2 = await build(e);
  const all = (c2.assets.messages || []);
  expect(all.map((m) => m.channel).sort()).toEqual(['push', 'sms', 'whatsapp']);
  for (const m of all) {
    const visible = [m.text, m.headline, m.body, m.title, m.footer, m.cta].filter(Boolean).join(' ');
    expect(visible, `${m.channel} prints a placeholder`).not.toMatch(PLACEHOLDER);
    expect(m.link).toBeNull();
  }
  const sms = all.find((m) => m.channel === 'sms');
  expect(sms.text).toMatch(/^Hollowmere: .+ Reply STOP to opt out\.$/);
  expect(sms.text).not.toMatch(/https?:/);
  expect(all.find((m) => m.channel === 'whatsapp').buttons).toEqual([]);
  expect(c2.data_gaps.some((g) => /region store URL, Hollowmere/.test(g))).toBe(true);
  expect(c2.data_gaps.some((g) => /legal sender, Hollowmere/.test(g))).toBe(true);
});

/* ═══ 6-8. /api/ai/generate, through the shipped router ════════════════════ */

const B = F.QUILL;
async function makeWorld() {
  const w = await A.world({});
  const uid = 'user-' + B.slug;
  const tok = H.jwtShaped(uid);
  const ws = 'ws-' + B.slug;
  w.db.addUser(tok, uid, B.slug + '@example.test').addWorkspace(ws, uid, F.workspaceRow(B, ws)).setActive(uid, ws);
  w.db.workspaces['ws-oldest'].created_at = '2026-01-01T00:00:00.000Z';
  w.db.syncIdentityTables();
  w.auth = { state: 'anonymous', headers: { authorization: 'Bearer ' + tok } };
  return w;
}
async function gen(w, body, answer) {
  w.reset();
  w.llm.respond = answer == null ? null : () => (typeof answer === 'string' ? answer : JSON.stringify(answer));
  const res = await w.request('/api/ai/generate', Object.assign({ query: {}, json: body, method: 'POST' }, w.auth));
  w.llm.respond = null;
  return { res, out: res.json || JSON.parse(res.text || '{}'), calls: w.llm.calls.slice() };
}

test.describe('the standalone generator', () => {
  let w;
  test.beforeEach(async () => { w = await makeWorld(); });
  test.afterEach(async () => { if (w) await w.close(); w = null; });

  test('modes sms, whatsapp and push return a finished message: sender, the brand\'s own link, opt-out, verdicts, no placeholder', async () => {
    const r = await gen(w, { mode: 'sms', brief: 'A note for readers who stopped opening the ledger.' },
      { text: 'Our award-winning desk is back with the Morning Ledger, {{first_name}}. Quillforth reporters file from all 14 Pune wards.' });
    expect(r.res.status, r.res.text).toBe(200);
    expect(r.calls.length, 'the sms mode never reached the model').toBe(1);
    expect(r.calls[0].prompt).toMatch(/OUTPUT REQUIREMENT/);
    const sms = r.out.data;
    expect(sms.contract).toBe('sms.message');
    expect(sms.text.startsWith('Quillforth Gazette: ')).toBe(true);
    expect(sms.text).toContain('Quillforth reporters file from all 14 Pune wards.');
    expect(sms.text).not.toMatch(/award|\{\{/i);
    expect(sms.text).toMatch(/https:\/\/quillforth-gazette\.example/);
    expect(sms.text).toMatch(/Reply STOP to opt out\.$/);
    expect(r.out.text).toBe(sms.text);
    expect(r.out.contract_check).toMatchObject({ contract: 'sms.message', ok: true });
    expect(r.out.compliance_check && r.out.compliance_check.findings).toBeTruthy();
    expect(r.out.copy_grounding.dropped.length).toBeGreaterThan(0);

    // A link the request names on another site is never used.
    const r2 = await gen(w, { mode: 'whatsapp', brief: 'x', link: 'https://deccan-lanternpost.example/offer' }, { header: 'The ward ledger', body: 'Quillforth reporters file from all 14 Pune wards.', button: 'Read the ledger' });
    const wa = r2.out.data;
    expect(wa.contract).toBe('whatsapp.message');
    expect(wa.buttons[0].url).toMatch(/^https:\/\/quillforth-gazette\.example/);
    expect(JSON.stringify(wa)).not.toMatch(/deccan-lanternpost/);
    expect(wa.template.category).toBe('MARKETING');
    expect(r2.out.contract_check.ok).toBe(true);

    const r3 = await gen(w, { mode: 'push', brief: 'x' }, { title: 'The ward ledger', body: 'Quillforth reporters file from all 14 Pune wards.' });
    expect(r3.out.data).toMatchObject({ contract: 'push.notification', title: 'The ward ledger' });
    expect(r3.out.contract_check.ok).toBe(true);

    // No model answering: the message is built from the brand's own lines.
    w.reset();
    w.llm.down = true;
    const r4 = await w.request('/api/ai/generate', Object.assign({ query: {}, json: { mode: 'sms', brief: 'x' }, method: 'POST' }, w.auth));
    w.llm.down = false;
    const o4 = r4.json || JSON.parse(r4.text);
    expect(r4.status, r4.text).toBe(200);
    expect(o4.provider).toBe('template');
    expect(o4.data.text).toMatch(/^Quillforth Gazette: .+Reply STOP to opt out\.$/);
    expect(o4.data.text).not.toMatch(PLACEHOLDER);
  });

  test('landing_page: no base64 image, no merge tag, no link to "#", no marker, no unbacked claim; the page is judged and the response says what went', async () => {
    const PIXEL = 'data:image/png;base64,' + Buffer.from('not really a png, but a payload all the same').toString('base64');
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>Ledger</title><style>.h{background:url(${PIXEL})}</style></head><body>
<header><a href="#">Quillforth Gazette</a></header>
<h1>The ward ledger, every morning</h1>
<p>Quillforth reporters file from all 14 Pune wards. We are the most trusted newsroom in India.</p>
<p>Hello {{first_name}}, your ledger is waiting.</p>
<p>Price: [DATA REQUIRED BEFORE LAUNCH: price, Quillforth Gazette, IN]. Subscribe today.</p>
<img src="${PIXEL}" alt="hero">
<a class="btn" href="{{landing_page_url}}">Read the ledger</a>
</body></html>`;
    const r = await gen(w, { mode: 'landing_page', brief: 'A page for the ledger.' }, page);
    expect(r.res.status, r.res.text).toBe(200);
    const served = r.out.text;
    expect(served).toMatch(/^<!doctype html>/i);
    expect(served, 'a base64 image survived').not.toMatch(/;base64,/);
    expect(served, 'a merge tag survived').not.toMatch(/\{\{/);
    expect(served, 'a marker survived').not.toMatch(/DATA REQUIRED/);
    expect(served, 'a link to # survived').not.toMatch(/href="#"/);
    expect(served).toContain('href="https://quillforth-gazette.example"');
    expect(served, 'an unbacked superlative survived').not.toMatch(/most trusted/i);
    expect(served).toContain('Quillforth reporters file from all 14 Pune wards.');
    expect(served).toContain('Subscribe today.');
    expect(r.out.contract_check).toMatchObject({ contract: 'landing.page' });
    expect(r.out.compliance_check).toBeTruthy();
    expect(r.out.finish.removed_images).toBe(2);
    expect(r.out.finish.links_to_website).toBe(2);
    expect(r.out.data_gaps.some((g) => /price, Quillforth Gazette/.test(g))).toBe(true);
    expect(r.out.copy_grounding.dropped.some((d) => /most trusted/i.test(d.text))).toBe(true);
    // The response keeps every field it always had.
    for (const k of ['ok', 'mode', 'provider', 'model', 'text', 'portable_prompt', 'output_check', 'brand_check']) expect(r.out, k).toHaveProperty(k);
  });

  test('mailer_full and an ad autofill: copy held to the brand, placeholders dropped, each judged by its contract, the shape kept', async () => {
    const variant = (h) => ({ layout_plan: { hero_type: 'centered', flow: 'f', spacing: 's', color_scheme: {} },
      sections: [{ id: 'hero', type: 'centered', purpose: 'p', copy: { eyebrow: 'Ledger', headline: h, subcopy: 'Quillforth reporters file from all 14 Pune wards. Clinically proven to calm your mornings. Use code [DATA REQUIRED BEFORE LAUNCH: discount code, Quillforth Gazette, IN] today.', cta: 'Read it' }, layout: 'l', image_slot: 'none', ux_intent: 'u' }],
      image_requirements: [], copy_framework: { tone: 't', voice: 'v', headline_style: 'h', cta_verb: 'Read' }, subject_lines: ['The ward ledger', 'Every ward, every morning', 'Your ledger'], preheader: 'Filed from all 14 wards {{first_name}}' });
    const spec = { synthesis: {}, strategy: { name: 'Desire Creation', why: 'w' }, vibe: {}, product_logic: { hero_product: 'x', supporting_products: [], aov_logic: 'a' }, theme: {}, image_style_lock: 'natural', variant_a: variant('The ward ledger'), variant_b: variant('Every ward, every morning') };
    const r = await gen(w, { mode: 'mailer_full', brief: 'The ledger.' }, spec);
    expect(r.res.status, r.res.text).toBe(200);
    const sub = r.out.data.variant_a.sections[0].copy.subcopy;
    expect(sub).toContain('Quillforth reporters file from all 14 Pune wards.');
    expect(sub).not.toMatch(/clinically|proven/i);
    expect(sub).not.toMatch(/DATA REQUIRED/);
    expect(r.out.data.variant_a.preheader).not.toMatch(/\{\{/);
    expect(r.out.data.variant_a.sections[0].type, 'a layout enum was touched').toBe('centered');
    expect(r.out.contract_check).toMatchObject({ contract: 'email.mailer' });
    expect(r.out.variant_checks.variant_b.compliance_check).toBeTruthy();
    expect(r.out.data_gaps.some((g) => /discount code/.test(g))).toBe(true);

    const fields = { name: 'Ledger push', obj: 'Traffic', budget: 40, market: 'IN', place: 'Feed', aud: 'Readers in India',
      primary: 'Quillforth reporters file from all 14 Pune wards. The most accurate reporting anywhere.', headline: 'The ward ledger', overlay_headline: 'Every ward', overlay_sub: 'Every morning', offer: '' };
    const a = await gen(w, { mode: 'autofill', surface: 'meta', prompt: 'Readers who stopped opening the ledger.' }, fields);
    expect(a.res.status, a.res.text).toBe(200);
    const got = JSON.parse(a.out.text);
    expect(got.primary).toBe('Quillforth reporters file from all 14 Pune wards.');
    expect(got.headline).toBe('The ward ledger');
    expect(got.budget).toBe(40);
    expect(a.out.contract_check).toMatchObject({ contract: 'ad.meta.static' });
    expect(Array.isArray(a.out.creative_spec)).toBe(true);
    expect(a.out.master_prompt).toBeTruthy();
  });
});

/* ═══ 9. the /brain preview ════════════════════════════════════════════════ */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
test('the /brain preview shows each message as its own pane, copies the plain text and downloads it', async ({ page }) => {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, p === '/' ? 'index.html' : p.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const c = await build(slot(ROAST, services().plannedChannels(BASE, ROAST)));
    await page.route(/\/api\//, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"offline"}' }));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/smart-brain.html`);
    await page.waitForFunction(() => typeof window.renderPreview === 'function' || typeof renderPreview === 'function');
    const ids = await page.evaluate((campaign) => {
      const host = document.createElement('div');
      host.id = 'chan-host';
      document.body.appendChild(host);
      // eslint-disable-next-line no-undef
      renderPreview({ campaign }, { id: 'chan-slot', channels: ['email', 'sms', 'whatsapp', 'push'], __device: true }, 0, { target: host });
      return [...host.querySelectorAll('[id^="pv-msg-"]')].map((x) => x.id);
    }, JSON.parse(JSON.stringify(c)));
    expect(ids).toEqual(['pv-msg-sms', 'pv-msg-whatsapp', 'pv-msg-push']);
    const sms = c.assets.messages.find((m) => m.channel === 'sms');
    await expect(page.locator('#pv-msg-sms [data-msg-body]')).toHaveText(sms.text);
    await expect(page.locator('#pv-msg-whatsapp .msgbtn')).toHaveAttribute('href', c.assets.messages.find((m) => m.channel === 'whatsapp').buttons[0].url);
    await expect(page.locator('#pv-msg-sms')).toContainText('1 part');
    // The phone bubble paints with the page's tokens: its ground is the panel token.
    const ground = await page.evaluate(() => {
      const b = document.querySelector('#pv-msg-sms .msgbubble');
      const probe = document.createElement('div'); probe.style.background = 'var(--vh-panel)'; document.body.appendChild(probe);
      return [getComputedStyle(b).backgroundColor, getComputedStyle(probe).backgroundColor];
    });
    expect(ground[0]).toBe(ground[1]);
    await page.locator('#pv-msg-sms button', { hasText: 'Copy' }).click();
    await expect.poll(() => page.evaluate(() => window.__copied.slice(-1)[0])).toBe(sms.text);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#pv-msg-sms button', { hasText: /^⬇ Download$/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/message-sms\.txt$/);
    const saved = fs.readFileSync(await dl.path(), 'utf8');
    expect(saved).toBe(sms.text);
  } finally {
    server.closeAllConnections && server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
