// Smart Brain: what it generates, whose it is, and whether you can actually see it.
//
// WHY THESE EXIST. This repo was forked from a sibling lifecycle-OS built for a
// different company, and the fork rewrote the brand NAME without rewriting the
// business underneath it. Four things survived into the generation path and all
// four reached a customer:
//
//   1. The ad art-direction prompt directed EVERY brand's imagery at that other
//      company's customer ("P01 … women 45+/busy mums: calmer mornings, steady
//      energy … NOT ingredients"). A news publisher's ads were composed for a
//      supplement buyer.
//   2. The same prompt SEEDED the proof shape with values — rating 4.9, count
//      "250,000+", an author templated as "first name, initial", a "Climate
//      Neutral" badge. A model handed a filled shape completes it, so campaigns
//      shipped an invented rating and an invented reviewer onto /lp/:id.
//   3. A video ad's "preview" was a play triangle on a gradient. Nothing was
//      generated behind it, so the reviewer approved something they had never
//      seen and nothing they saw was what shipped.
//   4. The ad preview painted every brand in tenant zero's four hardcoded
//      hexes, on a dark-neutral panel the design spec forbids.
//
// Every test below fails against that code and passes against the fix. They are
// about PROVENANCE and VISIBILITY, not about rendering being pretty: the bug was
// never that a panel looked wrong, it was that it looked right while showing the
// wrong company's audience, someone's invented review, and a video that did not
// exist.
//
// Run: npx playwright test tests/smart-brain-assets.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sbp = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const reviews = require(path.join(ROOT, 'api', '_shared', 'brand-reviews.js'));
const motion = require(path.join(ROOT, 'scripts', 'lib', 'motion-ad.js'));
const svc = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));

// A brand that is emphatically NOT tenant zero: different sector, different
// palette, different everything. If any assertion below passes only because the
// value happened to match KNICKGASM's, this brand breaks it.
const OTHER_BRAND = {
  id: 'ws_other', slug: 'meridian', name: 'Meridian Review',
  industry: 'daily news publishing',
  website: 'https://meridian.example',
  palette: { primary: '#0B4F8A', accent: '#E8A33D', ink: '#141414', surface: '#FFFFFF', surface_alt: '#F4F6F8', line: '#DDE3E8' },
  typography: { heading: "'Spectral',Georgia,serif", body: "'Public Sans',Arial,sans-serif" },
  voice: { tone: 'measured, factual' },
  claims: ['Independent since 1994'],
  regions: [{ code: 'US', currency: 'USD', symbol: '$', store_url: 'https://meridian.example' }],
};
// The REAL token computation, not a restatement of it, so the page paints the
// same --brand-* set production would give this brand.
OTHER_BRAND.tokens = core.tokens({ palette: OTHER_BRAND.palette, typography: OTHER_BRAND.typography });

function entryFor(brand) {
  return {
    id: 'cal_test_us', date: '2026-09-01', market: 'US',
    cohort: { name: 'Lapsed subscribers', size: 900, rules: ['last_order_at > 120 days'] },
    objective: 'winback', rationale: 'test slot', confidence: 0.7,
    heroProduct: { title: 'Weekend Edition', handle: 'weekend-edition', price: 9, sku: 'WE-1' },
    supportingProducts: [], channels: ['email', 'landing_page', 'meta', 'google', 'tiktok', 'youtube'],
    cta: 'Resubscribe', brand,
  };
}

// The other company's persona, assembled from fragments for the same reason
// scripts/check-foreign-brands.js assembles its tokens: tests/ sits inside the
// deployed output root (vercel.json sets outputDirectory "."), so a literal here
// would itself be a served occurrence of the string this test exists to keep out.
const FOREIGN_PERSONA = ['women 45', 'busy m', 'ums'];
const FOREIGN_FEELING = ['calmer mor', 'nings'].join('');
const FOREIGN_PLAY = 'P' + '01';

/* ── 1. The art-direction brief carries the ACTIVE brand's audience ───────── */

test('the creative brief art-directs from the active brand cohort, not another company persona', () => {
  const prompt = sbp.__test_copyPrompt(entryFor(OTHER_BRAND));
  // The cohort IS the audience definition this system holds, and it is the
  // brand's own behavioural segment.
  expect(prompt).toContain('Lapsed subscribers');
  expect(prompt).toContain('last_order_at > 120 days');
  expect(prompt).toContain('daily news publishing');
  // None of the sibling company's customer may appear.
  expect(prompt.toLowerCase()).not.toContain(FOREIGN_PERSONA[0]);
  expect(prompt.toLowerCase()).not.toContain(FOREIGN_PERSONA[1] + FOREIGN_PERSONA[2]);
  expect(prompt.toLowerCase()).not.toContain(FOREIGN_FEELING);
  expect(prompt).not.toContain(FOREIGN_PLAY);
  expect(prompt.toLowerCase()).not.toContain('steady energy');
});

test('a brand that states no persona gets a marker, not a substituted demographic', () => {
  const brief = sbp.__test_audienceBrief(entryFor(OTHER_BRAND));
  // Asserted on the PROMPT too, not just the helper: a helper that computes the
  // right answer is worth nothing if the text sent to the model never uses it.
  expect(sbp.__test_copyPrompt(entryFor(OTHER_BRAND))).toContain('[DATA REQUIRED BEFORE LAUNCH: audience / persona definition, Meridian Review]');
  expect(brief).toContain('[DATA REQUIRED BEFORE LAUNCH: audience / persona definition, Meridian Review]');
  // And the model is told not to fill the gap itself.
  expect(brief).toMatch(/do NOT assume an age, gender, life stage/i);
});

test('a stated audience on the brand record is used instead of the marker', () => {
  const e = entryFor(Object.assign({}, OTHER_BRAND, { audience: 'newsroom professionals who read on commute' }));
  const brief = sbp.__test_audienceBrief(e);
  expect(brief).toContain('newsroom professionals who read on commute');
  expect(brief).not.toContain('[DATA REQUIRED BEFORE LAUNCH: audience');
  expect(sbp.__test_copyPrompt(e)).toContain('newsroom professionals who read on commute');
});

/* ── 2. No fabricated proof is seeded into the shape the model fills ──────── */

test('the copy prompt seeds no rating, no review count, no reviewer and no badge', () => {
  const prompt = sbp.__test_copyPrompt(entryFor(OTHER_BRAND));
  expect(prompt).not.toContain('4.9');
  expect(prompt).not.toContain('250,000+');
  expect(prompt).not.toContain('first name, initial');
  expect(prompt).not.toContain('Climate Neutral');
  expect(prompt).not.toContain('Original-pair verified');
  // The empty shape is stated, and stated to be the answer when nothing is approved.
  expect(prompt).toContain('"rating": null');
  expect(prompt).toContain('"reviews": []');
  expect(prompt).toContain('"badges": []');
});

test('an empty approved library is declared to the model with the spec marker', () => {
  const brief = sbp.__test_approvedProofBrief(entryFor(OTHER_BRAND));
  expect(brief).toContain('[DATA REQUIRED BEFORE LAUNCH: approved review library, Meridian Review, US]');
  expect(brief).toMatch(/NEVER invent or infer a star rating/i);
  // And it reaches the model, not just the helper's return value.
  expect(sbp.__test_copyPrompt(entryFor(OTHER_BRAND))).toContain('[DATA REQUIRED BEFORE LAUNCH: approved review library, Meridian Review, US]');
});

test('proof the model invented anyway is stripped before it can be rendered', () => {
  const e = entryFor(OTHER_BRAND);
  const copy = sbp.__test_gateProof({
    email: {
      rating: { value: 4.9, count: '250,000+' },
      reviews: [{ quote: 'Absolutely life changing, ten stars', author: 'Sarah M., Portland', stars: 5 }],
      badges: ['Climate Neutral', 'B Corp'],
      guarantee: '100 day no questions refund',
    },
    landing: { proof_quote: 'Best decision I made this year', proof_author: 'Dan R.' },
  }, e);
  expect(copy.email.rating).toBeNull();
  expect(copy.email.reviews).toEqual([]);
  expect(copy.email.badges).toEqual([]);
  expect(copy.email.guarantee).toBe('');
  expect(copy.landing.proof_quote).toBe('');
  expect(copy.landing.proof_author).toBe('');
  expect(copy.__proof_gap.marker).toContain('[DATA REQUIRED BEFORE LAUNCH: approved review library');
});

test('a brand with no approved reviews gets the marker, never a rating', () => {
  const e = entryFor(OTHER_BRAND);
  const block = sbp.__test_proofBlockHtml(e);
  expect(block).toContain('[DATA REQUIRED BEFORE LAUNCH: approved review library, Meridian Review, US]');
  expect(block).not.toMatch(/★|Rated|\/5/);

  // …and the same holds on the landing page that real traffic reaches, which is
  // where the invented testimonial used to render.
  const lp = sbp.__test_lpHtml(e, { landing: { hero_headline: 'h', proof_quote: 'A quote the model wrote', proof_author: 'Someone' } }, 'camp_1', null);
  expect(lp).toContain('[DATA REQUIRED BEFORE LAUNCH: approved review library');
  expect(lp).not.toContain('A quote the model wrote');
  expect(lp).not.toContain('Someone');
});

/* ── 2b. Real testimonials, read off the brand's own site ─────────────────── */

const SITE_HTML = `<html><head>
<script type="application/ld+json">{"@type":"Product","name":"Weekend Edition","review":[
 {"@type":"Review","reviewBody":"I read it cover to cover on the train every Saturday.","author":{"@type":"Person","name":"Priya N"},"reviewRating":{"@type":"Rating","ratingValue":4.9,"bestRating":5},"image":"https://meridian.example/media/r1.jpg"},
 {"@type":"Review","reviewBody":"The long reads are the only ones I finish these days, honestly."}]}</script>
</head><body>
<div class="testimonial"><span itemprop="reviewBody">Worth it for the Sunday essay alone.</span></div>
<div class="review"><span itemprop="reviewBody">Short</span></div>
</body></html>`;

test('reviews are read verbatim off the brand site with their source page', () => {
  const out = reviews.reviewsFromHtml(SITE_HTML, 'https://meridian.example/products/weekend-edition');
  expect(out.length).toBe(3);
  expect(out[0].quote).toBe('I read it cover to cover on the train every Saturday.');
  expect(out[0].source_url).toBe('https://meridian.example/products/weekend-edition');
  expect(out[0].verbatim).toBe(true);
  // A rating the page stated is carried EXACTLY, never rounded up to 5.
  expect(out[0].rating).toEqual({ value: '4.9', scale: '5' });
});

test('a review whose page named no reviewer carries no author, invented or otherwise', () => {
  const out = reviews.reviewsFromHtml(SITE_HTML, 'https://meridian.example/x');
  const anon = out.find((r) => /long reads/.test(r.quote));
  expect(anon).toBeTruthy();
  expect(anon.author).toBe('');
  // Nothing anywhere in the extraction manufactures a name.
  expect(out.every((r) => r.author === '' || SITE_HTML.includes(r.author))).toBe(true);
});

test('the review block renders the real quote and the storage-hosted image, and omits an absent author', async () => {
  const e = entryFor(OTHER_BRAND);
  e.__reviews = [{
    quote: 'I read it cover to cover on the train every Saturday.',
    author: 'Priya N',
    rating: { value: '4.9', scale: '5' },
    media: [{ hosted_url: 'https://sb.example/storage/v1/object/public/brand-review-media/ws_other/abc.jpg', source_url: 'https://meridian.example/media/r1.jpg' }],
    source_url: 'https://meridian.example/products/weekend-edition',
  }, {
    quote: 'The long reads are the only ones I finish these days, honestly.',
    author: '', rating: null, media: [],
    source_url: 'https://meridian.example/products/weekend-edition',
  }];
  e.__review_marker = '';
  const block = sbp.__test_proofBlockHtml(e);
  expect(block).toContain('I read it cover to cover on the train every Saturday.');
  // The mailer carries OUR storage copy, not a hotlink to the brand's CDN.
  expect(block).toContain('brand-review-media/ws_other/abc.jpg');
  expect(block).not.toContain('https://meridian.example/media/r1.jpg');
  expect(block).toContain('Priya N');
  expect(block).toContain('4.9/5');
  // The second review named nobody, so nothing is attributed to it.
  expect(block).not.toContain('Verified reviewer');
  expect(block).not.toContain('Customer note');
  expect(block).not.toContain('[DATA REQUIRED BEFORE LAUNCH: approved review library');
});

test('a Text mailer keeps its testimonials typographic, and proof sits above the legal footer', () => {
  // The mailer taxonomy has exactly two types and "Text" means PURE typographic.
  // A proof block with a photo and a colour fill would quietly promote every
  // Text variant into Text + Graphics.
  const e = entryFor(OTHER_BRAND);
  e.__reviews = [{ quote: 'I read it cover to cover on the train every Saturday.', author: 'Priya N', rating: { value: '4.9', scale: '5' }, media: [{ hosted_url: 'https://sb.example/x.jpg', source_url: 'https://meridian.example/m.jpg' }] }];
  const pure = sbp.__test_proofBlockHtml(e, 'pure');
  expect(pure).toContain('cover to cover');       // the real review still ships
  expect(pure).not.toContain('<img');             // but as type, not graphics
  expect(pure).not.toContain('background:#F4F6F8');
  const visual = sbp.__test_proofBlockHtml(e, 'visual');
  expect(visual).toContain('<img');

  // And it lands ABOVE the CAN-SPAM sender block. The shared renderer emits that
  // as an ordinary paragraph, not a <footer>, so a naive append at </body> put a
  // customer testimonial underneath the unsubscribe line.
  const ct = require(path.join(ROOT, 'api', '_shared', 'calendar-trigger.js'));
  const base = ct.helpers.renderTextVariant({ style: 'pure', subject: 's', hero_headline: 'H', body_blocks: [{ heading: '', body: 'b' }], cta_text: 'go', cta_url: 'https://x', market: 'US' });
  const out = sbp.__test_injectProofBlock(base, e, 'pure');
  const iProof = out.indexOf('In their words');
  const iLegal = out.search(/receiving this as/i);
  expect(iProof).toBeGreaterThan(0);
  expect(iLegal).toBeGreaterThan(0);
  expect(iProof).toBeLessThan(iLegal);
});

test('an image that could not be re-hosted yields a marker, never a broken img or a hotlink', async () => {
  // No egress and no Supabase in this environment, which is exactly the path
  // that must stay honest.
  const off = await reviews.hostImage({ brand: OTHER_BRAND, workspaceId: 'ws_other', sourceUrl: 'https://cdn.someone-else.example/x.jpg' });
  expect(off.ok).toBe(false);
  expect(off.hosted_url).toBe('');
  expect(off.marker).toContain('[DATA REQUIRED BEFORE LAUNCH: hosted review image');

  const unreachable = await reviews.hostImage({
    brand: OTHER_BRAND, workspaceId: 'ws_other',
    sourceUrl: 'https://meridian.example/media/r1.jpg',
    fetchImpl: async () => { throw new Error('no egress'); },
  });
  expect(unreachable.ok).toBe(false);
  expect(unreachable.hosted_url).toBe('');
  expect(unreachable.marker).toContain('[DATA REQUIRED BEFORE LAUNCH: hosted review image');

  // And a review whose image failed still renders its TEXT, with no <img>.
  const e = entryFor(OTHER_BRAND);
  e.__reviews = [{ quote: 'I read it cover to cover on the train every Saturday.', author: 'Priya N', rating: null, media: [{ hosted_url: '', source_url: 'https://meridian.example/media/r1.jpg', marker: unreachable.marker }] }];
  const block = sbp.__test_proofBlockHtml(e);
  expect(block).toContain('cover to cover');
  expect(block).not.toContain('<img');
  expect(block).not.toContain('meridian.example/media/r1.jpg');
});

test('the re-hosted object key is workspace-scoped and stable for the same source', () => {
  // Idempotence and tenancy are both properties of the key, so assert the key.
  const a = reviews.sha256('https://meridian.example/media/r1.jpg');
  const b = reviews.sha256('https://meridian.example/media/r1.jpg');
  expect(a).toBe(b);
  expect(reviews.sha256('https://meridian.example/media/r2.jpg')).not.toBe(a);
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260814120000_brand_review_library.sql'), 'utf8');
  expect(sql).toContain('brand-review-media');
  // Write access is gated on the workspace named by the first path segment.
  expect(sql).toMatch(/storage\.foldername\(name\)\)\[1\]::uuid, auth\.uid\(\)/);
  // Reads are filtered on region as well as workspace, so a review cannot transfer.
  expect(sql).toContain('region');
});

/* ── 3. Every ad has a creative, and a video ad has a real artefact ───────── */

async function builtCampaign(brand) {
  const cfg = svc.smartConfig({});
  const e = entryFor(brand);
  const campaign = new svc.GenerationService(cfg).generate(e);
  const copy = {
    email: { subject: 's', preheader: 'p', hero_headline: 'h', intro_paragraph: 'i', body_paragraph: 'b', cta: 'c', image_brief: 'eb' },
    landing: { hero_headline: 'lh', why_bullets: ['a'], cta: 'c', image_brief: 'lb' },
    ads: {
      meta: { primary_text: 'm', headline: 'mh', image_brief: 'mb' },
      google: { headlines: ['g'], descriptions: ['d'], image_brief: 'gb' },
      tiktok: { script: 'ts', caption: 'tc', image_brief: 'tb' },
    },
  };
  const adPlatforms = campaign.assets.ads.map((a) => ({ platform: a.platform, creative_type: a.creative_type }));
  const creatives = await sbp.__test_generateCreatives(copy, e, { adPlatforms });
  sbp.__test_applyCopy(campaign, e, copy, copy, { key: 'a', name: 'A' }, { key: 'b', name: 'B' }, creatives, 'run');
  return { campaign, entry: e };
}

test('every ad in the bundle is keyed for a creative, including youtube', async () => {
  const { campaign } = await builtCampaign(null);
  const ads = campaign.assets.ads;
  expect(ads.length).toBeGreaterThan(4);
  // Both creative types on every platform the campaign ships.
  expect(ads.some((a) => a.platform === 'youtube')).toBe(true);
  for (const ad of ads) {
    // Every ad resolves a creative object rather than falling through to nothing.
    expect(ad.creative, `${ad.platform}/${ad.creative_type} has no creative`).toBeTruthy();
  }
  // The static and the video of one platform are two different ads and no longer
  // share a single key (which is what gave them the same photograph).
  const cfg = svc.smartConfig({});
  const e = entryFor(null);
  const c2 = new svc.GenerationService(cfg).generate(e);
  const keys = Object.keys(await sbp.__test_generateCreatives({ email: {}, landing: {}, ads: {} }, e,
    { adPlatforms: c2.assets.ads.map((a) => ({ platform: a.platform, creative_type: a.creative_type })) }));
  expect(keys).toContain('youtube:video');
  expect(keys).toContain('youtube:static');
  expect(keys).toContain('meta:static');
  expect(keys).toContain('meta:video');
});

test('a video ad carries a real animated artefact and a shot brief, not a promise of one', async () => {
  const { campaign } = await builtCampaign(OTHER_BRAND);
  const videos = campaign.assets.ads.filter((a) => a.creative_type === 'video');
  expect(videos.length).toBeGreaterThan(0);
  for (const ad of videos) {
    const cr = ad.creative || {};
    expect(cr.motion_html, `${ad.platform} video has no artefact`).toBeTruthy();
    // It is a real, self-contained document — not a fragment or a placeholder.
    expect(cr.motion_html).toContain('<!doctype html>');
    expect(cr.motion_html).toContain('@keyframes');
    expect(cr.motion_brief).toBeTruthy();
    expect(Array.isArray(cr.motion_brief.shots)).toBe(true);
    // And the MP4 question is answered honestly rather than implied by a player.
    expect(cr.video).toBeTruthy();
    expect(cr.video.rendered).toBe(false);
    expect(String(cr.video.note)).toMatch(/no MP4|not|generated on demand/i);
  }
});

test('a video artefact is painted in the active brand palette, never tenant zero', async () => {
  const { campaign } = await builtCampaign(OTHER_BRAND);
  const cr = campaign.assets.ads.find((a) => a.creative_type === 'video').creative;
  expect(cr.motion_html).toContain('#0B4F8A');
  expect(cr.motion_html).toContain('#E8A33D');
  expect(cr.motion_html).not.toMatch(/D0473E/i);
  expect(cr.motion_html).not.toMatch(/6A33D8/i);
  // Nor does it borrow tenant zero's audio, which is licensed to tenant zero.
  expect(cr.motion_html).not.toContain('/assets/media/');
  expect(String(cr.motion_brief.audio.note)).toContain('[DATA REQUIRED BEFORE LAUNCH: licensed audio bed');
});

test('the motion renderer still produces tenant zero output unchanged when no brand is named', () => {
  const html = motion.renderMotionAd({ product: 'X', scenes: [{ image: 'https://a/b.jpg', headline: 'Hi' }], cta: 'Shop' });
  expect(html).toContain('#D0473E');
  expect(html).toContain('/assets/media/');
});

/* ── 4. The console: a pane per ad, the real artefact, brand colours ──────── */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, brand: OTHER_BRAND, workspaces: [] })); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

async function openConsole(page) {
  await page.route('**/api/public-config**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: OTHER_BRAND, workspaces: [] }),
  }));
  await page.goto(base + '/smart-brain.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof renderAd === 'function' && typeof renderPreview === 'function', null, { timeout: 20000 });
  // Wait for the brand tokens to be PAINTED. Measuring before that grades
  // theme.css's tenant-zero fallbacks, which is not what this brand's operator
  // sees — and would let a hardcoded hex pass by matching the fallback.
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--brand-accent').trim() !== '',
    null, { timeout: 20000 },
  );
}

test('every ad in a previewed campaign gets its own pane', async ({ page }) => {
  const { campaign, entry } = await builtCampaign(OTHER_BRAND);
  await openConsole(page);
  const result = await page.evaluate(({ campaign, entry }) => {
    const host = document.createElement('div');
    host.id = 'test-host';
    document.body.appendChild(host);
    renderPreview({ campaign, ads: campaign.assets.ads }, entry, 0, { target: host });
    const panes = [...host.querySelectorAll('.pvpane')].map((p) => p.id);
    const tabs = [...host.querySelectorAll('.pvtab')].map((b) => b.textContent.trim());
    return { panes, tabs, adCards: host.querySelectorAll('.adcard').length };
  }, { campaign, entry });
  // One pane per ad, none colliding onto a shared id (which used to hide the
  // second ad of a platform behind the first).
  const adPanes = result.panes.filter((id) => id.startsWith('pv-ad-'));
  expect(adPanes.length).toBe(campaign.assets.ads.length);
  expect(new Set(adPanes).size).toBe(campaign.assets.ads.length);
  expect(result.adCards).toBe(campaign.assets.ads.length);
});

test('a video ad pane renders the real artefact, not a play-button placeholder', async ({ page }) => {
  const { campaign, entry } = await builtCampaign(OTHER_BRAND);
  await openConsole(page);
  const out = await page.evaluate(({ campaign, entry }) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderPreview({ campaign, ads: campaign.assets.ads }, entry, 0, { target: host });
    const card = host.querySelector('.adcard[data-ad-type="video"]');
    const frame = card && card.querySelector('.advframe');
    return {
      hasCard: !!card,
      hasFrame: !!frame,
      src: frame ? frame.getAttribute('src') : '',
      hydrated: frame ? frame.dataset.hydrated : '',
      registry: (window.__SB_MOTION || []).length,
      hasDownload: !!(card && card.querySelector('button[onclick^="sbDownloadMotion"]')),
      html: card ? card.outerHTML : '',
    };
  }, { campaign, entry });
  expect(out.hasCard).toBe(true);
  expect(out.hasFrame).toBe(true);
  // The preview is the artefact's own bytes, served from a Blob URL — the same
  // guarantee /july-studio makes, rather than a re-render that could differ.
  expect(out.hydrated).toBe('1');
  expect(out.src.startsWith('blob:')).toBe(true);
  expect(out.registry).toBeGreaterThan(0);
  // And the exact same bytes are downloadable.
  expect(out.hasDownload).toBe(true);
  // The placeholder is gone: no CSS play triangle, no fake player chrome.
  expect(out.html).not.toContain('border-left:22px solid');
});

test('ad previews are painted in the active brand tokens, not tenant zero hexes', async ({ page }) => {
  const { campaign, entry } = await builtCampaign(OTHER_BRAND);
  await openConsole(page);
  const out = await page.evaluate(({ campaign, entry }) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderPreview({ campaign, ads: campaign.assets.ads }, entry, 0, { target: host });
    const cards = [...host.querySelectorAll('.adcard')];
    const cta = host.querySelector('.adcta, .advcta');
    return {
      markup: cards.map((c) => c.outerHTML).join('\n'),
      ctaBg: cta ? getComputedStyle(cta).backgroundColor : '',
    };
  }, { campaign, entry });
  // No tenant-zero literal anywhere in the generated ad markup.
  expect(out.markup).not.toMatch(/#D0473E/i);
  expect(out.markup).not.toMatch(/#6A33D8/i);
  expect(out.markup).not.toContain('Hand-painted one-of-one');
  expect(out.markup).not.toContain("'Lora'");
  // The CTA actually resolves to this brand's accent (#E8A33D = rgb(232,163,61)).
  expect(out.ctaBg.replace(/\s/g, '')).toBe('rgb(232,163,61)');
});

test('a static ad pane shows the real photograph, and says so when there is none', async ({ page }) => {
  const { campaign, entry } = await builtCampaign(OTHER_BRAND);
  await openConsole(page);
  const out = await page.evaluate(({ campaign, entry }) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderPreview({ campaign, ads: campaign.assets.ads }, entry, 0, { target: host });
    const statics = [...host.querySelectorAll('.adcard[data-ad-type="static"]')];
    return statics.map((c) => ({
      hasImage: c.dataset.hasImage,
      img: !!c.querySelector('img.adshot'),
      empty: !!c.querySelector('.adshot-empty'),
    }));
  }, { campaign, entry });
  expect(out.length).toBeGreaterThan(0);
  for (const s of out) {
    // Either a real photograph, or an explicit statement that there is not one.
    // Never a decorative gradient standing in for a product shot.
    if (s.hasImage === '1') expect(s.img).toBe(true);
    else expect(s.empty).toBe(true);
  }
});

/* ── every record and asset, inside the expanded row ────────────────────────
 * The preview was a TAB STRIP: one pane visible, the rest display:none. A
 * reviewer approving a slot could see one asset at a time out of a mailer, two
 * landing pages, eight ads, the analysis and the JSON — and had to hold the
 * rest in their head. It is stacked now, all open, inside the row.
 * ─────────────────────────────────────────────────────────────────────────── */

test('every asset pane is open at once, not one behind a tab', async ({ page }) => {
  const { campaign, entry } = await builtCampaign(OTHER_BRAND);
  await openConsole(page);
  const result = await page.evaluate(({ campaign, entry }) => {
    const host = document.createElement('div');
    host.id = 'stack-host';
    document.body.appendChild(host);
    renderPreview({ campaign, ads: campaign.assets.ads }, entry, 0, { target: host });
    const panes = [...host.querySelectorAll('.pvpane')];
    return {
      panes: panes.length,
      open: panes.filter((p) => p.classList.contains('on')).length,
      sections: host.querySelectorAll('.pvsec').length,
      headings: [...host.querySelectorAll('.pvsech')].map((h) => h.textContent.trim()),
    };
  }, { campaign, entry });

  // A check that found no panes would pass every assertion below it.
  expect(result.panes, 'no panes were rendered to check').toBeGreaterThan(2);
  expect(result.open, 'a pane is hidden behind a tab').toBe(result.panes);
  expect(result.sections, 'every pane needs its own titled section').toBe(result.panes);
  expect(result.headings.length).toBe(result.panes);
  for (const h of result.headings) expect(h.length, 'a section has no heading').toBeGreaterThan(0);
});

test('both landing pages are shown, not just the first', async ({ page }) => {
  const { campaign, entry } = await builtCampaign(OTHER_BRAND);
  const lps = (campaign.assets.landing_pages || []).filter((l) => l && l.html);
  test.skip(lps.length < 2, 'this campaign built fewer than two landing pages');
  await openConsole(page);
  const ids = await page.evaluate(({ campaign, entry }) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderPreview({ campaign, ads: campaign.assets.ads }, entry, 0, { target: host });
    return [...host.querySelectorAll('.pvpane')].map((p) => p.id).filter((id) => id.startsWith('pv-lp'));
  }, { campaign, entry });
  // The builder ships an A/B pair and only landing_pages[0] was ever rendered,
  // so the B variant was downloadable and not viewable.
  expect(ids.length, `only ${ids.length} landing page pane(s) for ${lps.length} pages`).toBe(lps.length);
  expect(new Set(ids).size, 'two landing pages collided on one pane id').toBe(ids.length);
});
