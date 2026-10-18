// Ad angle lab (2026-10-18): competitor ads that keep running -> ranked angles
// + a hook bank -> briefs + a test plan, for the active brand.
//
// The operator, with a workflow seen elsewhere ("pull competitor patterns from
// the Meta Ads Library ... map angles ... build the hook bank ... generate the
// brief stack + test plan"): "take your learnings from this to see how our
// creations can be improved but keep it free to the max extent possible in
// execution but dont show that to the users".
//
// Executed: api/_shared/ad-angle-lab.js over fixture competitor ads with a
// scripted model (and with every model down), then the /ad-campaigns "Winning
// angles" tab in Chromium, served that module's real output.
//
// Run: npx playwright test tests/ad-angle-lab.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const H = require('./lib/brand-theme-harness.js');

const ROOT = path.resolve(__dirname, '..');
const lab = require(path.join(ROOT, 'api', '_shared', 'ad-angle-lab.js'));

const NOW = Date.parse('2026-10-18T00:00:00Z');
const ago = (n) => new Date(NOW - n * 86400000).toISOString();
const BRAND = {
  name: 'Deli Chic', tagline: 'Chicken cold cuts, made fresh in Delhi', industry: 'food',
  claims: ['Smoked in small batches every week', '100% chicken, no pork', 'Ready-to-serve platters for parties'],
  offerings: [{ kind: 'product', name: 'Party Platter' }], regions: [{ code: 'IN', currency: 'INR', home: true }],
};
const RAW = [
  { brand_name: 'Rival A', primary_copy: 'Tired of bland cold cuts? Ours are smoked for hours.', startDate: ago(60), image: 'x', enrichment: { pain_point: 'bland deli meat', target_persona: 'busy parents' } },
  { brand_name: 'Rival A', primary_copy: 'Still eating bland salami? Try real smoked meat.', startDate: ago(45), image: 'x', enrichment: { pain_point: 'bland deli meat taste', target_persona: 'busy parents' } },
  { brand_name: 'Rival B', primary_copy: 'Loved by 20,000 families across Delhi.', startDate: ago(90), video_urls: ['v'], enrichment: { pain_point: 'not sure which brand to trust', target_persona: 'home cooks' } },
  { brand_name: 'Rival B', primary_copy: '20% off your first box today', startDate: ago(5), image: 'x', enrichment: { pain_point: 'price' } },
  { brand_name: 'Rival C', primary_copy: 'How to build a party platter in 5 minutes', startDate: ago(35), image_urls: ['a', 'b', 'c'], enrichment: { pain_point: 'no time to prepare food for guests', target_persona: 'hosts' } },
];
// The Meta Ad Library fetch, as competitor-core.fetchMetaAds answers: ads in
// Apify's shape per competitor, plus the library link.
const fetchMetaAds = async ({ brand }) => ({ ok: true, source: 'apify', deepLink: `https://www.facebook.com/ads/library/?q=${encodeURIComponent(brand)}`,
  ads: RAW.filter((a) => a.brand_name === brand).map((a) => ({ page: a.brand_name, body: a.primary_copy, startDate: a.startDate, image: a.image || '', video_urls: a.video_urls, image_urls: a.image_urls, enrichment: a.enrichment })) });

// A model that answers the hooks contract: picks a claim per angle and writes
// hooks, one of them a claim the brand never made.
function scriptedModel(record) {
  return async (o) => {
    record.push(o);
    return { text: JSON.stringify({ angles: [
      { id: 'angle-1', answer: 0, hooks: ['Bland deli meat? Ours is smoked in small batches every week.', 'Award-winning flavour in every slice.', 'Smoked every week, sliced for you.'] },
      { id: 'angle-2', answer: 1, hooks: ['100% chicken, no pork, ever.', 'Know exactly what is in it: 100% chicken.'] },
      { id: 'angle-3', answer: 2, hooks: ['Guests in an hour? Ready-to-serve platters for parties.'] },
    ] }), provider: 'scripted', model: 'scripted' };
  };
}

async function runLab(extra) {
  return lab.run(Object.assign({ brand: BRAND, market: 'IN', competitors: ['Rival A', 'Rival B', 'Rival C'], now: NOW, deps: { ciAds: null, fetchMetaAds, callLLM: async () => { throw new Error('every provider is down'); } } }, extra || {}));
}

test('competitor ads become a pattern report weighted by how long each ad has run', async () => {
  const out = await runLab();
  const rep = out.report;
  expect(rep.read).toBe(5);
  expect(rep.long_running, 'four ads have run 30+ days').toBe(4);
  expect(rep.basis).toBe('long-running');
  expect(rep.note).toMatch(/4 of 5 competitor ads have run 30\+ days/);
  // The 5-day discount ad is not part of the signal; the 90-day video is.
  expect(rep.hooks.map((h) => h.key)).toEqual(['question', 'social proof', 'how-to']);
  expect(rep.hooks.find((h) => h.key === 'question').signal).toBe(105);   // 60 + 45 days
  expect(rep.hooks.find((h) => h.key === 'social proof').signal).toBe(90);
  expect(rep.hooks.some((h) => h.key === 'offer'), 'a 5-day ad is not long-running').toBe(false);
  expect(rep.formats.map((f) => f.key)).toEqual(['image', 'video', 'carousel']);
  expect(rep.hooks.reduce((s, h) => s + h.share, 0)).toBe(100);
  expect(out.library_links.map((l) => l.competitor)).toEqual(['Rival A', 'Rival B', 'Rival C']);
});

test('angles are ranked by competitor signal and each is answered by a different claim of the brand', async () => {
  const calls = [];
  const out = await runLab({ deps: { ciAds: null, fetchMetaAds, callLLM: scriptedModel(calls) } });
  expect(out.angles.map((a) => a.pain)).toEqual(['bland deli meat', 'not sure which brand to trust', 'no time to prepare food for guests']);
  expect(out.angles.map((a) => a.rank)).toEqual([1, 2, 3]);
  expect(out.angles.map((a) => a.answer)).toEqual(BRAND.claims);
  expect(out.angles.every((a) => a.answer_basis === 'model')).toBe(true);
  expect(out.angles[0].audience).toBe('busy parents');
  // ONE model call writes the whole bank; the prompt carries the brand's claims
  // by number (so an answer cannot be invented) and closes with its contract.
  expect(calls).toHaveLength(1);
  expect(calls[0].userMessage).toMatch(/CLAIMS BY NUMBER:\n0: Smoked in small batches every week/);
  expect(calls[0].responseFormat).toEqual({ type: 'json_object' });
  const hooks = out.hooks.bank.flatMap((b) => b.hooks);
  expect(hooks.join(' '), 'a hook using a claim the brand never made is dropped').not.toMatch(/award/i);
  expect(out.hooks.dropped).toBeGreaterThanOrEqual(1);
  expect(new Set(hooks.map((h) => h.toLowerCase())).size, 'no hook twice in the bank').toBe(hooks.length);
  for (const b of out.hooks.bank) expect(b.hooks.length).toBeLessThanOrEqual(4);
  for (const h of hooks) { expect(h.length).toBeLessThanOrEqual(125); expect(h).not.toMatch(/[–—]/); }
  expect(out.hooks.count, 'never padded to 20').toBeLessThan(20);
  expect(out.gaps.join(' ')).toMatch(/hooks, not 20/);
  expect(out._by).toBe('model');
});

test('with every model down the bank is built from the brand\'s own lines, one distinct claim per angle', async () => {
  const out = await runLab();
  expect(out._by).toBe('template');
  expect(new Set(out.angles.map((a) => a.answer)).size, 'each angle its own claim').toBe(out.angles.length);
  for (const b of out.hooks.bank) expect(b.hooks.length).toBeGreaterThan(0);
  const all = out.hooks.bank.flatMap((b) => b.hooks).join(' ');
  for (const w of all.toLowerCase().match(/[a-z]{5,}/g)) {
    // Every content word is the brand's, its competitor's pain or a joining word.
    expect(`${BRAND.name} ${BRAND.tagline} ${BRAND.claims.join(' ')} bland deli meat not sure which brand to trust no time to prepare food for guests`.toLowerCase(), w).toContain(w.slice(0, 5));
  }
});

test('briefs fit the ad limits, a control is kept, and the test plan is a stated split', async () => {
  const out = await runLab({ budget: 5000, currency: 'INR', deps: { ciAds: null, fetchMetaAds, callLLM: scriptedModel([]) } });
  expect(out.briefs.map((b) => b.id)).toEqual(['brief-1', 'brief-2', 'brief-3', 'brief-control']);
  for (const b of out.briefs) {
    expect(b.primary_text.length).toBeLessThanOrEqual(125);
    expect(b.headline.length).toBeLessThanOrEqual(40);
    expect(b.primary_text).not.toMatch(/^(.{12,}?)\.\s+\1/i);
    expect(b.cta).toBeTruthy();
    expect(b.visual_direction).toBeTruthy();
  }
  expect(out.briefs[1].format, 'the angle\'s format follows what its competitor ads run').toBe('video');
  const tp = out.test_plan;
  expect(tp.rows.reduce((s, r) => s + r.share, 0)).toBe(100);
  expect(tp.rows.find((r) => r.brief === 'brief-control').share).toBe(20);
  for (const r of tp.rows) expect(r.share).toBeGreaterThanOrEqual(10);
  expect(tp.rows[0].share).toBeGreaterThan(tp.rows[2].share);
  expect(tp.rows.reduce((s, r) => s + r.daily, 0)).toBeCloseTo(5000, 0);
  expect(tp.method).toMatch(/not by a predicted lift/);
  const none = await runLab();
  expect(none.test_plan.rows.every((r) => r.daily === null)).toBe(true);
  expect(none.test_plan.budget_note).toMatch(/DATA REQUIRED BEFORE LAUNCH: daily ad budget, Deli Chic/);
});

test('no competitor ads: angles come from the brand\'s own claims and say so; undated ads count once', async () => {
  const own = await runLab({ deps: { ciAds: null, fetchMetaAds: async ({ brand }) => ({ ok: true, source: 'deep_link', deepLink: 'https://www.facebook.com/ads/library/?q=' + brand, ads: [] }), callLLM: async () => { throw new Error('down'); } } });
  expect(own.report.read).toBe(0);
  expect(own.angles.every((a) => a.basis === 'own' && a.signal_share === null)).toBe(true);
  expect(own.angles.map((a) => a.answer)).toEqual(BRAND.claims);
  expect(own.gaps.join(' ')).toMatch(/No competitor ads were read for Rival A, Rival B, Rival C; the angles come from Deli Chic's own claims/);
  const rep = lab.patternReport(RAW.map((a) => lab.normalizeAd(Object.assign({}, a, { startDate: undefined }), a.brand_name)), { now: NOW });
  expect(rep.basis).toBe('undated');
  expect(rep.hooks.reduce((s, h) => s + h.signal, 0)).toBe(5);
  const nobody = await lab.run({ brand: { name: 'Bare Brand' }, now: NOW, deps: { ciAds: null, fetchMetaAds, callLLM: async () => { throw new Error('down'); } } });
  expect(nobody.gaps.join(' ')).toMatch(/DATA REQUIRED BEFORE LAUNCH: competitor set, Bare Brand/);
  expect((await lab.run({ brand: {} })).error).toBe('brand_required');
});

/* ── the tab, in Chromium ─────────────────────────────────────────────── */

const NAME = H.define('angle-lab-deli', {
  name: 'Deli Chic', slug: 'deli-chic', palette: { primary: '#ffa517', accent: '#1d1d1b', ink: '#1d1d1b', surface: '#ffffff' },
  regions: [{ code: 'IN', currency: 'INR', home: true, store_url: 'https://delichic.example' }], claims: BRAND.claims,
});

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`the Winning angles tab shows the report, angles, briefs and plan, and a brief fills the Meta ad (${vp.width})`, async ({ page }) => {
    const answer = await runLab({ budget: 5000, currency: 'INR', deps: { ciAds: null, fetchMetaAds, callLLM: scriptedModel([]) } });
    delete answer._by;   // what the route sends: the router removes it
    const sent = [];
    await page.setViewportSize(vp);
    await H.install(page, NAME);
    await page.route('**/api/brain?action=ad-angle-lab', async (r) => { sent.push(JSON.parse(r.request().postData() || '{}')); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }); });
    expect(await H.open(page, 'ad-campaigns.html#angles', NAME), 'the brand painted').toBe(true);
    await page.evaluate(() => { if (window.LifecycleStatus) { window.LifecycleStatus.decide = async () => null; window.LifecycleStatus.refusal = () => null; } });
    await page.locator('.tab[data-tab="angles"]').click();
    await page.locator('#al-budget').fill('5000');
    await page.locator('#al-run').click();
    await expect(page.locator('#al-out [data-angle]')).toHaveCount(3);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ market: 'IN', budget: 5000, currency: 'INR' });
    await expect(page.locator('#al-out')).toContainText('4 of 5 competitor ads have run 30+ days');
    await expect(page.locator('#al-out [data-angle="angle-1"]')).toContainText('bland deli meat');
    await expect(page.locator('#al-out [data-brief]')).toHaveCount(4);
    await expect(page.locator('#al-out .al-table').last()).toContainText('Control');
    // Which model or service did the work never reaches the page.
    const shown = await page.locator('#al-out').innerText();
    expect(shown).not.toMatch(/scripted|pollinations|apify|free|keyless|provider|gpt|gemini/i);
    // Nothing runs off the side of a phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(1);
    // A brief goes straight into the Meta ad form.
    await page.locator('[data-use-brief="brief-2"]').click();
    await expect(page.locator('#panel-meta')).toBeVisible();
    await expect(page.locator('#m-primary')).toHaveValue(answer.briefs[1].primary_text);
    await expect(page.locator('#m-headline')).toHaveValue(answer.briefs[1].headline);
  });
}
