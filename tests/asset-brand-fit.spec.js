// @ts-check
/**
 * Every asset fits the brand it is for: its kind of offering, its kind of
 * business and its own words (2026-11-08).
 *
 * The operator: "review each asset creation logic once and check them with
 * competitive benchmarking research for all types of brands - ensure
 * appropriate, apt and relevant knowledge for all brands as per their
 * respective brands, their products, their industry and every personalised
 * detail possible".
 *
 * Built through the shipped planner (offeringPlanEntries, the way a brand with
 * offerings is planned in production) and the shipped buildCampaign (noLLM),
 * for each brand kind in tests/lib/sweep-brands.js. What the review found:
 *   - an offering kind a record states that is not one of ours ("subscription",
 *     the news brand's newsletter) became a PRODUCT: its button read "Shop now"
 *     on a news brand, against asset-playbooks' own news benchmark (subscribe,
 *     start reading), and a plan / service lost the page the record gave it, so
 *     a studio's "Start your brief" went to its homepage;
 *   - the offering KIND was stored as the product's category: "Take another
 *     look at plan", "Take another look at service", and "Type service" on
 *     the landing page;
 *   - an events or services brand's buttons went to its homepage while its
 *     record named the event's or service's own page (news, market data and
 *     subscription brands already went to theirs);
 *   - the planner's objective said "Win back customers" for a news brand's
 *     readers, and the storyboard spliced it as "the Win back ..., with X. moment";
 *   - a storyboard asked for an "extreme close-up" of a newsletter;
 *   - the landing page's tagline reveal spelled each word's unit alone:
 *     "The 100 watts charger" (the rest of the build says "100-watt charger");
 *   - a festival subject carried two colons ("Govardhan Puja: Back for you: X").
 *
 * Run: npx playwright test tests/asset-brand-fit.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { BRANDS, MODEL_BRANDS } = require('./lib/sweep-brands.js');
const { readerText } = require('./lib/reader-text.js');
const ENV = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
const ALL = [...BRANDS, ...MODEL_BRANDS];
const brandOf = (slug) => JSON.parse(JSON.stringify(ALL.find((b) => b.slug === slug)));
const CHANNELS = ['email', 'meta', 'google', 'tiktok', 'landing_page', 'sms', 'whatsapp', 'push'];

async function quiet(fn) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error(`network blocked in asset-brand-fit: ${u}`); };
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally {
    console.log = log;
    global.fetch = realFetch;
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const plan = () => require(path.join(ROOT, 'api/_shared/smart-brain-plan.js'));
const cfg = () => require(path.join(ROOT, 'lib/smart-brain/services.js')).smartConfig({});

// The slots production plans for a brand with offerings.
function planned(b, n) {
  const P = plan();
  const offs = P.__test_resolveBrandOfferings(b);
  return P.__test_offeringPlanEntries(b, offs, '2026-11-02', 30, 'fit').slice(0, n);
}
async function buildPlanned(slug, n) {
  return quiet(async () => {
    const b = brandOf(slug);
    const out = [];
    for (const e of planned(b, n)) {
      e.brand = b; e.channels = CHANNELS;
      out.push({ entry: e, c: await plan().buildCampaign(e, cfg(), { noLLM: true, withCreatives: false }) });
    }
    return out;
  });
}

test('an offering kind the record states is read as ours, and keeps its own page', () => {
  const K = require(path.join(ROOT, 'api/_shared/offering-kinds.js'));
  const sub = K.normalizeOffering({ kind: 'subscription', name: 'Morning Ledger', url: 'https://ledgerline.example/ledger' });
  expect(sub.kind).toBe('plan');
  expect(sub.url).toBe('https://ledgerline.example/ledger');
  expect(K.normalizeOffering({ kind: 'newsletter', name: 'Daily', url: 'https://x.example/d' }).kind).toBe('section');
  expect(K.normalizeOffering({ kind: 'newsletter', name: 'Daily', cadence: 'daily' }).kind).toBe('programme');
  expect(K.normalizeOffering({ kind: 'service', name: 'Home design', url: 'https://plumbline.example/homes' }).url).toBe('https://plumbline.example/homes');
  expect(K.normalizeOffering({ kind: 'plan', name: 'Studio', url: 'https://loomclub.example/join' }).url).toBe('https://loomclub.example/join');
  // A word that names no kind is still a product, as before.
  expect(K.normalizeOffering({ kind: 'widget', name: 'Thing' }).kind).toBe('product');
  expect(K.normalizeOffering({ name: 'Thing' }).kind).toBe('product');
  expect(K.pageOf({ registration_url: 'https://ridgefest.example/r' })).toBe('https://ridgefest.example/r');
});

test('a news brand\'s planned newsletter is not sold with "Shop now", and its slot names no kind label', async () => {
  test.setTimeout(120000);
  const runs = await buildPlanned('gazette', 4);
  expect(runs.length).toBeGreaterThan(0);
  for (const { entry, c } of runs) {
    expect(entry.cta, entry.objective).not.toMatch(/shop|cart|buy|order/i);
    expect(entry.objective).not.toMatch(/customers/i);
    // The kind is ours, the category is the store's: a slot planned now never
    // stores one as the other (the renderers also ignore it on an older slot).
    expect(entry.heroProduct.category || '').not.toBe(entry.heroProduct.kind);
    for (const a of c.assets.ads) expect(`${a.platform}:${a.creative_type} ${a.cta}`).not.toMatch(/Shop now|Buy|Order/);
    const words = readerText(c).map((r) => `${r.where}: ${r.text}`);
    expect(words.filter((t) => /Shop now|Shop by|\bat (plan|service|section|product)\b|^landing_pages\[\d\]: Type (plan|service|section|product)$/.test(t))).toEqual([]);
  }
});

test('a services brand: the planned slot links its service page and never says "at service"', async () => {
  test.setTimeout(120000);
  const runs = await buildPlanned('plumbline', 3);
  expect(runs.length).toBeGreaterThan(0);
  for (const { c } of runs) {
    for (const a of c.assets.ads) expect(String(a.destination_url || '').split('?')[0], `${a.platform}:${a.creative_type}`).toBe('https://plumbline.example/homes');
    const words = readerText(c).map((r) => `${r.where}: ${r.text}`);
    expect(words.filter((t) => /another look at service|Type service\b/.test(t))).toEqual([]);
    expect(c.assets.email.html).toContain('https://plumbline.example/homes');
  }
});

test('an events or services brand\'s button goes to the page its record names, not the homepage', () => {
  const P = plan();
  for (const [slug, url] of [['ridgefest', 'https://ridgefest.example/sahyadri-50'], ['plumbline', 'https://plumbline.example/homes'], ['gazette', 'https://ledgerline.example/ledger']]) {
    const b = brandOf(slug);
    const links = P.__test_slotLinks({ brand: b, market: 'IN', heroProduct: { title: '[DATA REQUIRED BEFORE LAUNCH: product catalogue]', placeholder: true } });
    expect(links.pdp, slug).toBe(url);
  }
  // A shop with no offering on the slot keeps its store.
  const shop = brandOf('brewfold');
  expect(P.__test_slotLinks({ brand: shop, market: 'IN', heroProduct: {} }).pdp).toBe('https://brewfold.example');
});

test('the storyboard films what the offering is and says the job as a direction', async () => {
  test.setTimeout(120000);
  for (const slug of ['gazette', 'plumbline', 'loomclub']) {
    for (const { c } of await buildPlanned(slug, 2)) {
      for (const a of c.assets.ads.filter((x) => x.creative_type === 'video')) {
        const board = (a.storyboard || []).map((s) => s.scene).join(' | ');
        expect(board, slug).not.toMatch(/extreme close-up/);
        expect(board, slug).not.toMatch(/\bthe [^|]*\. moment\b/);
      }
    }
  }
  // A product is still filmed close.
  const b = brandOf('voltnest');
  const c = await quiet(() => plan().buildCampaign({ id: 'fit-volt', date: '2026-11-02', market: 'IN', objective: 'premium bundle expansion', brand: b, heroProduct: b.__hero, cohort: { name: 'Champions' }, channels: CHANNELS, offer: { depth: 'none', pct: 0 } }, cfg(), { noLLM: true, withCreatives: false }));
  const v = c.assets.ads.find((x) => x.creative_type === 'video');
  expect(v.storyboard[0].scene).toMatch(/extreme close-up/);
});

test('the landing page tagline reveal says a unit as the rest of the page does', async () => {
  const b = brandOf('voltnest');
  const c = await quiet(() => plan().buildCampaign({ id: 'fit-volt-lp', date: '2026-11-02', market: 'IN', objective: 'premium bundle expansion', brand: b, heroProduct: b.__hero, cohort: { name: 'Champions' }, channels: CHANNELS, offer: { depth: 'none', pct: 0 } }, cfg(), { noLLM: true, withCreatives: false }));
  const html = c.assets.landing_pages[0].html;
  const reveal = (html.match(/<section[^>]*data-tagline-reveal[\s\S]*?<\/section>/) || [''])[0];
  expect(reveal, 'the reveal is on the page').not.toBe('');
  const said = reveal.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  expect(said).toBe('The 100-watt charger that fits a pocket');
  expect(reveal).toContain('aria-label="The 100-watt charger that fits a pocket"');
});

test('a festival subject carries one colon', async () => {
  for (const { entry, c } of await buildPlanned('gazette', 4)) {
    if (!entry.festival) continue;
    expect(c.assets.email.subject.startsWith(`${entry.festival.name}: `)).toBe(true);
    expect((c.assets.email.subject.match(/:/g) || []).length, c.assets.email.subject).toBe(1);
  }
  const fest = (await buildPlanned('gazette', 4)).filter((r) => r.entry.festival);
  expect(fest.length, 'a planned slot fell on a market moment').toBeGreaterThan(0);
});

/* ── The prompts a person pastes into Claude, ChatGPT or Gemini ───────────────
   Judged as a brief for an outside model, per brand kind. What the review
   found: every mailer and landing page prompt told a news, market-data, club,
   events or services brand to picture "product image/GIF/MP4, e.g. a Shopify
   product video" from "product photography" and to "describe an
   auto-generated animated GIF the team can produce" (the output requirement
   forbids any image this brief does not list); the planner's segment name went
   over as "Audience cohort: At Risk" with nothing saying not to print it; a
   brand with no product on the slot was told to "refer to it only by the
   offerings named in this brief" and none were named; the prompt banned
   dashes while its own lines said "Name — tagline", "Email mailer — VARIANT",
   "0–2s" and "Safe zones —"; and the Studio's email prompt told the outside
   model to PUT "[DATA REQUIRED BEFORE LAUNCH: ...]" into the email. */
async function promptsOf(slug) {
  return quiet(async () => {
    const b = brandOf(slug);
    const offs = plan().__test_resolveBrandOfferings(b);
    let e = offs.length ? plan().__test_offeringPlanEntries(b, offs, '2026-11-02', 30, 'fitp')[0] : null;
    if (!e) {
      e = { id: `fitp-${slug}`, date: '2026-11-02', market: (b.regions && b.regions[0] && b.regions[0].code) || 'IN', objective: 'reactivation', cohort: { name: 'At Risk' }, offer: { depth: 'none', pct: 0 } };
      if (b.__hero) e.heroProduct = b.__hero;
    }
    e.brand = b; e.channels = CHANNELS;
    const c = await plan().buildCampaign(e, cfg(), { noLLM: true, withCreatives: false });
    const out = { email: c.assets.email.master_prompt, email_v1: c.assets.email.master_prompt_v1, lp: c.assets.landing_pages[0].master_prompt };
    for (const a of c.assets.ads) { out[`${a.platform}:${a.creative_type}`] = a.master_prompt; if (a.story_prompt) out[`${a.platform}:story`] = a.story_prompt; }
    for (const m of c.assets.messages || []) out[`msg:${m.channel}`] = m.master_prompt;
    return { b, e, out };
  });
}
const KINDS_TO_JUDGE = ['brewfold', 'famapp', 'gazette', 'bareco', 'vitalwick', 'voltnest', 'chai', 'tickerwise', 'loomclub', 'ridgefest', 'plumbline'];

test('every pasted prompt opens with its deliverable, closes with its container, and carries no commerce visuals for a brand that does not sell products', async () => {
  test.setTimeout(240000);
  const P = require(path.join(ROOT, 'api/_shared/asset-playbooks.js'));
  const bad = [];
  for (const slug of KINDS_TO_JUDGE) {
    const { b, out } = await promptsOf(slug);
    const model = P.businessModel(b);
    for (const [k, p] of Object.entries(out)) {
      if (!p) continue;
      const lines = p.split('\n');
      if (!/^DELIVERABLE:/m.test(lines.slice(0, 3).join('\n'))) bad.push(`${slug} ${k}: the deliverable is not first`);
      if (!/=== END OUTPUT REQUIREMENT ===$/.test(p.trim())) bad.push(`${slug} ${k}: the container is not last`);
      if (/\[DATA REQUIRED/.test(p)) bad.push(`${slug} ${k}: hands over the app's marker`);
      if (/Shopify|the team can produce|auto-generated animated GIF/.test(p)) bad.push(`${slug} ${k}: app or platform jargon an outside model cannot act on`);
      if (model !== 'commerce' && /^VISUALS:.*(product's own photograph|product photography|product image)/im.test(p)) bad.push(`${slug} ${k}: product visuals for a ${model} brand`);
      if (/Audience cohort:/.test(p)) bad.push(`${slug} ${k}: the segment label handed over to print`);
      // Dashes: the brand's own words keep theirs; the prompt's own do not.
      const own = [b.name, b.tagline, b.legal_entity, ...(b.claims || [])].filter(Boolean);
      let rest = p; for (const w of own) rest = rest.split(w).join(' ');
      const d = rest.match(/.{0,30}[–—].{0,30}/);
      if (d) bad.push(`${slug} ${k}: a dash in the prompt that bans them: ${d[0]}`);
    }
    const vis = (out.email.match(/^VISUALS:.*$/m) || [''])[0];
    if (model === 'commerce') expect(vis, slug).toMatch(/product's own photograph first/);
    else {
      const pol = P.imagePolicyFor(b);
      expect(vis, `${slug}: the ${model} image policy`).toContain(String(pol.sourceOrder[0]).replace(/^\d+\.\s*/, '').replace(/[.\s]+$/, '').replace(/\s*[–—]\s*/g, ', '));
    }
    const seg = out.email.match(/^MARKET:.*$/m)[0];
    expect(seg, slug).toMatch(/an internal label: write to them as "you" and never print it/);
  }
  expect(bad).toEqual([]);
});

test('a brand with no product on the send has its own offerings named in the prompt, and only its own', async () => {
  test.setTimeout(120000);
  const { out } = await promptsOf('ridgefest');
  expect(out.email).toMatch(/WHAT RIDGEFEST OFFERS[^\n]*\n- Sahyadri 50 \(page: https:\/\/ridgefest\.example\/sahyadri-50\)/);
  // An offering on another site is not this brand's to name.
  const mp = require(path.join(ROOT, 'api/_shared/master-prompt.js'));
  const b = brandOf('ridgefest');
  b.offerings.push({ kind: 'event', name: 'Borrowed Ultra', url: 'https://otherbrand.example/ultra' });
  const p = await quiet(() => mp.buildMasterPrompt({ brand: b, market: 'IN', assetType: 'mailer', products: [] }));
  expect(p).toContain('- Sahyadri 50');
  expect(p).not.toContain('Borrowed Ultra');
  // A product on the send: the product list is the scope, no offerings block.
  const { out: shop } = await promptsOf('voltnest');
  expect(shop.email).not.toMatch(/^WHAT VOLTNEST OFFERS/m);
});

test('the Studio\'s pasted email prompt tells the outside model to leave a gap, never to print the app\'s marker', async ({ page }) => {
  test.setTimeout(120000);
  const F = require('./lib/brand-invariant-fixtures');
  const BT = require('./lib/brand-theme-harness');
  const Q = F.QUILL;
  BT.define('fit-quill', { name: Q.name, slug: Q.slug, palette: Q.palette || {}, typography: Q.typography || {}, regions: Q.regions || [], record: F.recordOf(Q) });
  await BT.install(page, 'fit-quill');
  await BT.open(page, 'studio', 'fit-quill');
  await page.waitForFunction(() => typeof window.buildEmailAssetPrompt === 'function' && window.OutputContract, null, { timeout: 20000 });
  const got = await page.evaluate(() => {
    window.S = window.S || {};
    window.S.strategy = window.S.strategy || {};
    // A product with no price and no photo on record: the gaps the prompt must not hand over.
    window.S.strategy.products = [{ n: 'Weekend Edition' }];
    window.S.finalProds = window.S.strategy.products;
    window.S.prompt = window.S.activePrompt = 'Bring lapsed readers back with the weekend edition';
    return ['A', 'B'].map((v) => window.buildEmailAssetPrompt(window.RegionContext && window.RegionContext.home, v));
  });
  for (const p of got) {
    expect(p).not.toMatch(/\[DATA REQUIRED/);
    expect(p).toContain('not on record (leave it out; do not invent it)');
    expect(p).toMatch(/Missing data: omit any fact this brief does not state/);
    expect(p.trim()).toMatch(/=== END OUTPUT REQUIREMENT ===$/);
  }
});
