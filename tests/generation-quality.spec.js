// What the platform BUILDS, not what it asks another model to build.
//
// The app briefs ChatGPT and Gemini with a careful contract — table-based
// email, real links, an artefact you can actually play — and then generated
// something weaker itself. Running one campaign through the real builders and
// reading its own contract report found five defects, every one of which had
// shipped:
//
//   1. The mailer was <main>/<section> with max-width and an inline-block <a>.
//      Outlook on Windows renders with the WORD engine: no max-width, so the
//      email spanned the window; no background on an inline-block anchor, so
//      the CTA arrived as underlined text with no button behind it.
//   2. The landing page's call to action was a <button> with no form and no
//      handler. The one thing the page exists to do did nothing when clicked.
//   3. Video ads carried a caption and a hook but no primary_text and no
//      headline — the fields Meta requires on a video ad exactly as on a
//      static one. Two blocking violations on every build.
//   4. Every TikTok STATIC ad was routed to the video contract and reported
//      three violations it could not satisfy. A gate that blocks what it
//      misread teaches the operator that overriding is routine.
//   5. The motion artefact was attached inside the LLM branch only, so every
//      noLLM build shipped video ads with nothing to play — despite the
//      artefact needing no model to build.
//
// Every test here BUILDS a campaign and reads the result.
//
// Run: npx playwright test tests/generation-quality.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const sbPlan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const contracts = require(path.join(ROOT, 'api', '_shared', 'asset-contracts.js'));

const SLOT = {
  id: 'quality-1', date: '2026-09-02', market: 'US',
  objective: 'reactivation and replenishment',
  cohort: { name: 'At Risk', size: 2000, rules: ['r'] },
  channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
  confidence: 0.8,
  heroProduct: { sku: 'A', title: 'Alpha 01', handle: 'alpha-01' },
  offer: { code: null, depth: 'none', pct: 0, why: 'n/a' },
  rationale: 'Lapsed buyers.',
};

let campaign;
test.beforeAll(async () => {
  test.setTimeout(180_000);
  // noLLM on purpose. This is the weakest path the app has — the offline
  // republish, and any run where the provider cascade is unkeyed or rate
  // limited. If the floor is right, the ceiling is too.
  campaign = await sbPlan.buildCampaign(SLOT, smartConfig({}), { noLLM: true, withCreatives: false });
});

/* ═══ the campaign satisfies its own contracts ════════════════════════════ */

test('a campaign the app builds itself passes its own contract check', () => {
  const cc = campaign.contract_check;
  expect(cc, 'no contract check ran').toBeTruthy();
  expect(cc.checked).toBeGreaterThan(0);
  const detail = (cc.violations || []).map((v) => `${v.level} ${v.asset}/${v.slot}: ${v.message}`).join('\n');
  expect(cc.blocking, `blocking violations on the app's own output:\n${detail}`).toBe(0);
  expect(cc.warnings, `warnings on the app's own output:\n${detail}`).toBe(0);
});

test('every asset type is actually reached by a contract', () => {
  // A check that silently governs nothing would report zero blocks too.
  const by = campaign.contract_check.by_contract;
  for (const id of ['email.mailer', 'ad.meta.static', 'ad.meta.video', 'ad.google.rsa', 'landing.page']) {
    expect(by[id], `${id} governed nothing in this campaign`).toBeGreaterThan(0);
  }
});

/* ═══ 1. the mailer survives Outlook ══════════════════════════════════════ */

test('the mailer is table-based, because Outlook renders with the Word engine', () => {
  const html = campaign.assets.email.html;
  expect(html).toMatch(/<table/);
  // The tags Word does not lay out. Their presence was the original defect.
  expect(html, 'a <main> or <section> is holding layout Word will not honour').not.toMatch(/<(main|section)\b/);
});

test('the mailer pins its width with an attribute, not only with CSS', () => {
  const html = campaign.assets.email.html;
  // Word ignores max-width, so a CSS-only column spans the whole window.
  expect(html).toMatch(/width="600"/);
});

test('every coloured cell carries bgcolor beside its CSS', () => {
  const html = campaign.assets.email.html;
  // Word reads the attribute and not the declaration, so a cell with only
  // `background:` renders white and the text on it can vanish.
  const styled = (html.match(/background-color:/g) || []).length;
  const attrs = (html.match(/bgcolor="/g) || []).length;
  expect(attrs, 'fewer bgcolor attributes than coloured cells').toBeGreaterThanOrEqual(styled - 1);
  expect(attrs).toBeGreaterThan(0);
});

test('the CTA is a cell with a colour, not a bare inline-block link', () => {
  const html = campaign.assets.email.html;
  // The button's colour must come from a <td>, which Word paints, rather than
  // from the anchor, which it does not.
  expect(html).toMatch(/<td bgcolor="[^"]+"[^>]*>\s*<a href=/);
});

test('the inbox preview is the line we wrote', () => {
  const html = campaign.assets.email.html;
  expect(html, 'no hidden preheader, so the preview is whatever text comes first')
    .toMatch(/display:none;font-size:1px/);
  expect(campaign.assets.email.preheader).toBeTruthy();
});

test('the mailer carries no base64 payload', () => {
  // Gmail clips past roughly 102KB and cuts the layout mid-way.
  expect(campaign.assets.email.html).not.toMatch(/data:image\/(png|jpe?g|webp|gif);base64/i);
});

/* ═══ 2. the landing page's CTA does something ════════════════════════════ */

test('the landing page CTA is a link, not a button with no handler', () => {
  for (const lp of campaign.assets.landing_pages) {
    expect(lp.html, 'a bare <button> is the CTA, so clicking it does nothing').not.toMatch(/<button/);
    expect(lp.html).toMatch(/<a href="[^"]+"/);
  }
});

test('the CTA points at this brand\'s own store for this market', () => {
  const href = (campaign.assets.landing_pages[0].html.match(/<a href="([^"]+)"/) || [])[1];
  expect(href).toBeTruthy();
  // Either a real store URL, or '#' — never a fabricated destination.
  expect(href === '#' || /^https:\/\//.test(href)).toBe(true);
});

/* ═══ 3. a video ad carries the ad unit's text ════════════════════════════ */

test('a video ad has the copy fields the platform requires', () => {
  const videos = campaign.assets.ads.filter((a) => a.creative_type === 'video');
  expect(videos.length).toBeGreaterThan(0);
  for (const ad of videos) {
    expect(ad.headline, `${ad.platform} video ad has no headline`).toBeTruthy();
    expect(ad.primary_text, `${ad.platform} video ad has no primary text`).toBeTruthy();
  }
});

test('the static and the video of one platform are a real A/B, not one line twice', () => {
  const meta = campaign.assets.ads.filter((a) => a.platform === 'meta');
  const s = meta.find((a) => a.creative_type === 'static');
  const v = meta.find((a) => a.creative_type === 'video');
  expect(s && v).toBeTruthy();
  expect(v.primary_text, 'both variants carry identical primary text').not.toBe(s.primary_text);
});

/* ═══ 4. a still is judged as a still ═════════════════════════════════════ */

test('a TikTok static ad is not judged against the video contract', () => {
  const still = { platform: 'tiktok', creative_type: 'static', caption: 'x', creative_brief: 'y' };
  expect(contracts.contractFor(still).id).toBe('ad.tiktok.static');
  // And a TikTok video still gets the video contract.
  expect(contracts.contractFor({ platform: 'tiktok', creative_type: 'video' }).id).toBe('ad.tiktok.video');
});

test('a still is not asked for a script or a motion artefact', () => {
  const out = contracts.check({ platform: 'tiktok', creative_type: 'static', caption: 'A line.', creative_brief: 'The frame.' });
  expect(out.ok, `a valid still was blocked: ${JSON.stringify(out.violations)}`).toBe(true);
  const slots = out.violations.map((v) => v.slot);
  expect(slots).not.toContain('script');
  expect(slots).not.toContain('motion_html');
});

test('the still contract still requires what a still does have', () => {
  // It must not become a contract that passes everything.
  const out = contracts.check({ platform: 'tiktok', creative_type: 'static' });
  expect(out.ok).toBe(false);
  expect(out.violations.map((v) => v.slot)).toEqual(expect.arrayContaining(['caption', 'creative_brief']));
});

test('the still contract reads its caption limit from asset-specs', () => {
  // Nothing about TikTok is asserted here that the spec does not already
  // record, which is this repo's standing rule for platform limits.
  const specs = require(path.join(ROOT, 'api', '_shared', 'asset-specs.js'));
  const c = contracts.contractFor({ platform: 'tiktok', creative_type: 'static' });
  const caption = c.structure.find((s) => s.slot === 'caption');
  expect(caption.max).toBe(specs.ADS.tiktok.copy.caption);
});

/* ═══ 5. the artefact exists on every path ════════════════════════════════ */

test('a video ad built with no LLM still carries something to play', () => {
  // The whole reason this matters: a reviewer approves what they were shown.
  for (const ad of campaign.assets.ads.filter((a) => a.creative_type === 'video')) {
    const html = (ad.creative && ad.creative.motion_html) || '';
    expect(html.length, `${ad.platform} video ad has no renderable artefact`).toBeGreaterThan(1000);
    expect(html).toMatch(/<html|<!doctype/i);
  }
});

test('whether a real MP4 exists is stated, never implied', () => {
  for (const ad of campaign.assets.ads.filter((a) => a.creative_type === 'video')) {
    const v = ad.creative && ad.creative.video;
    expect(v, `${ad.platform} says nothing about whether an MP4 exists`).toBeTruthy();
    expect(typeof v.provider_connected).toBe('boolean');
    expect(v.note).toBeTruthy();
  }
});

test('the artefact is built once, not rebuilt over one the LLM path made', () => {
  // The both-paths pass must skip an ad that already has an artefact, or a
  // deterministic rebuild would silently replace the reviewed creative.
  const src = require('fs').readFileSync(path.join(ROOT, 'api/_shared/smart-brain-plan.js'), 'utf8');
  expect(src).toMatch(/filter\(\(ad\) => ad\.creative_type === 'video' && !\(ad\.creative && ad\.creative\.motion_html\)\)/);
});

/* ═══ a Google ad is a responsive search ad, and one headline is not one ═══
 * Every Google ad the app built carried a single `headline` and no
 * `headlines`/`descriptions` arrays, while asset-contracts routes it to
 * `ad.google.rsa` — which declares both as required lists — and
 * google-ads-adapter.js refuses to build a request below 3 and 2. The
 * contract reported ok:true anyway, because its check was written
 * `if (heads.length && heads.length < 3)`: one or two warned, NONE passed.
 * The console was approving an ad the adapter would not send.
 * ══════════════════════════════════════════════════════════════════════ */

function googleAds() {
  return (campaign.assets.ads || []).filter((a) => a.platform === 'google');
}

test('every Google ad carries enough headlines and descriptions to be served', () => {
  const ads = googleAds();
  expect(ads.length, 'no Google ad was built to check').toBeGreaterThan(0);
  for (const a of ads) {
    const h = a.headlines || [];
    const d = a.descriptions || [];
    expect(h.length, `${a.id} has ${h.length} headline(s); the adapter needs 3`).toBeGreaterThanOrEqual(3);
    expect(d.length, `${a.id} has ${d.length} description(s); the adapter needs 2`).toBeGreaterThanOrEqual(2);
  }
});

test('no Google line is over the limit, because the platform deletes rather than shortens', () => {
  for (const a of googleAds()) {
    for (const h of a.headlines || []) {
      expect(h.length, `headline "${h}" is ${h.length} chars; Google drops it whole`).toBeLessThanOrEqual(30);
    }
    for (const d of a.descriptions || []) {
      expect(d.length, `a description is ${d.length} chars; dropped, not shortened`).toBeLessThanOrEqual(90);
    }
  }
});

test('the headlines are distinct, because a duplicate spends a slot on nothing', () => {
  for (const a of googleAds()) {
    const h = (a.headlines || []).map((x) => x.trim().toLowerCase());
    expect(new Set(h).size, `${a.id} repeats a headline: ${h.join(' | ')}`).toBe(h.length);
  }
});

test('an RSA with no headlines BLOCKS rather than passing silently', () => {
  // The regression guard for the zero-case. Driven through the real contract,
  // because the defect was that absent read as "nothing to check".
  const rsa = contracts.CONTRACTS['ad.google.rsa'];
  expect(rsa, 'the RSA contract is gone').toBeTruthy();

  const empty = rsa.validate({ platform: 'google' });
  const blocking = empty.filter((v) => v.level === 'block');
  expect(blocking.length, 'an RSA with nothing in it was reported clean').toBeGreaterThan(0);
  expect(JSON.stringify(empty)).toMatch(/headlines/);
  expect(JSON.stringify(empty)).toMatch(/descriptions/);

  // And the just-under case, which used to warn, is also not sendable.
  const thin = rsa.validate({ headlines: ['One', 'Two'], descriptions: ['Only one'] });
  expect(thin.filter((v) => v.level === 'block').length,
    'two headlines and one description is below what the adapter will send').toBeGreaterThan(0);

  // A well-formed one still passes, so this is not blocking everything.
  const ok = rsa.validate({
    headlines: ['Alpha 01', 'Brand', 'US Edit'],
    descriptions: ['A description that fits.', 'A second, different one.'],
  });
  expect(ok.filter((v) => v.level === 'block')).toEqual([]);
});
