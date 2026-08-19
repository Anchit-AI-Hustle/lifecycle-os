// A prompt that returns a picture, offered where a mailer was expected.
//
// THE REPORTED DEFECT. An operator copied the prompt this console offers,
// pasted it into Gemini, and got back a product photograph instead of an email.
// Nothing was broken in the model: the only prompt the console ever surfaced
// was the ad's `creative_brief`, which is an IMAGE brief and did exactly what
// it says. The prompt that produces the finished asset — `master_prompt`, built
// for every asset since the beginning — was never rendered anywhere on the
// page, and neither prompt said which kind it was.
//
// So there are two distinct claims to hold, and this file executes both rather
// than reading the source for them:
//
//   1. An ASSET prompt, run as the model would read it, opens and closes by
//      naming the finished artefact.
//   2. An ELEMENT prompt says, in its first line, that it is one part.
//
// and then drives the real page with a real campaign built by the real
// buildCampaign(), because a prompt that exists in a payload and never reaches
// a button is the bug that was reported.
//
// Run: npx playwright test tests/asset-vs-element-prompts.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const mp = require(path.join(ROOT, 'api', '_shared', 'master-prompt.js'));
const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const sbPlan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));

/* ═══ 1. The asset prompt names the finished artefact, first and last ══════ */

// What a model actually weights. Both ends are asserted because a long prompt
// is read most reliably at its head and its tail, and the failure being fixed
// was a model choosing the wrong artefact from the middle of one.
const head = (s) => s.split('\n').slice(0, 3).join('\n');
const tail = (s) => s.split('\n').slice(-8).join('\n');

test('a mailer prompt asks for the email, not a picture of one', () => {
  const p = mp.buildMasterPrompt({ assetType: 'mailer', variant: 'V2', market: 'US' });
  expect(head(p)).toMatch(/DELIVERABLE: ONE COMPLETE EMAIL MAILER/);
  // The three things Gemini returned instead, each ruled out by name.
  expect(head(p)).toMatch(/Not a plan, not a section-by-section outline, not only a hero image/);
  expect(tail(p)).toMatch(/OUTPUT FORMAT: ONE email HTML document/);
  expect(tail(p)).toMatch(/Table-based layout/);
});

test('a landing-page prompt asks for one saveable document', () => {
  const p = mp.buildMasterPrompt({ assetType: 'landing_page', market: 'UK' });
  expect(head(p)).toMatch(/DELIVERABLE: ONE COMPLETE, SELF-CONTAINED LANDING PAGE/);
  expect(tail(p)).toMatch(/start with <!doctype html> and end with <\/html>/);
});

test('an ad prompt asks for the whole unit, every field plus the creative', () => {
  const p = mp.buildMasterPrompt({ assetType: 'ad', platform: 'meta', market: 'US' });
  expect(head(p)).toMatch(/DELIVERABLE: ONE COMPLETE META AD UNIT/);
  expect(tail(p)).toMatch(/1\. COPY/);
  expect(tail(p)).toMatch(/2\. CREATIVE/);
});

test('every asset prompt forbids the base64 payload that breaks a real send', () => {
  // Not a style rule. Gmail clips a message past roughly 102KB, so a base64
  // hero cuts the mailer off mid-layout in the client with the largest share.
  for (const o of [
    { assetType: 'mailer', variant: 'V2' },
    { assetType: 'mailer', variant: 'V1' },
    { assetType: 'landing_page' },
    { assetType: 'ad', platform: 'meta' },
    { assetType: 'ad', platform: 'google' },
    { assetType: 'ad', platform: 'tiktok' },
  ]) {
    const p = mp.buildMasterPrompt(o);
    expect(p, `${o.assetType}/${o.variant || o.platform} does not rule out base64`).toMatch(/[Nn]ever base64/);
  }
});

test('no asset prompt asks for the thing its own deliverable line forbids', () => {
  // The residual half of the same defect. V2's contract opened with
  // "Section-by-section layout: for each section give the COPY and the VISUAL"
  // — an instruction to produce a PLAN — in the same prompt as a deliverable
  // line reading "not a section-by-section outline". Faced with a
  // contradiction a model resolves it, and a breakdown is easier to produce
  // than a finished email, so the breakdown is what came back.
  //
  // Each pair is (what the deliverable rules out, what would ask for it).
  const CONTRADICTIONS = [
    [/not a plan\b/i, /\bproduce a plan\b|\bwrite a plan\b/i],
    [/not a section-by-section outline/i, /section-by-section (layout|breakdown|outline)/i],
    [/not only a hero image/i, /^\s*(produce|generate) (only )?(a|the) (hero )?image\b/im],
    [/not a wireframe/i, /\bwireframe\b/i],
    [/not a concept, not a moodboard/i, /\bmoodboard\b/i],
  ];
  for (const o of [
    { assetType: 'mailer', variant: 'V1' },
    { assetType: 'mailer', variant: 'V2' },
    { assetType: 'landing_page' },
    { assetType: 'ad', platform: 'meta' },
    { assetType: 'ad', platform: 'google' },
    { assetType: 'ad', platform: 'tiktok' },
  ]) {
    const p = mp.buildMasterPrompt(o);
    const who = `${o.assetType}/${o.variant || o.platform}`;
    // The deliverable line NAMES what it rules out, so it matches the "asks"
    // pattern itself. Search everything except that line, or the test reports
    // the prohibition as the violation.
    const deliverableLine = p.split('\n').find((l) => l.startsWith('DELIVERABLE:')) || '';
    expect(deliverableLine, `${who} has no deliverable line`).toBeTruthy();
    const rest = p.split('\n').filter((l) => !l.startsWith('DELIVERABLE:')).join('\n');
    for (const [forbids, asks] of CONTRADICTIONS) {
      if (!forbids.test(deliverableLine)) continue;
      expect(asks.test(rest), `${who} rules out ${forbids} in its deliverable and asks for it in its contract`).toBe(false);
    }
  }
});

test('the prompt is one self-contained block, with no unresolved placeholder', () => {
  // It is pasted into a BLANK session, so anything the builder failed to fill
  // arrives at the model as literal text.
  const p = mp.buildMasterPrompt({ assetType: 'mailer', market: 'US', brief: 'Winback' });
  expect(p).not.toMatch(/\$\{/);
  expect(p).not.toMatch(/\bundefined\b/);
  expect(p).not.toMatch(/\[object Object\]/);
  expect(p.length).toBeGreaterThan(1500);
});

/* ═══ 2. The element prompt says it is one part ═══════════════════════════ */

test('an element prompt names the part and refuses the asset', () => {
  const out = mp.buildElementPrompt('Close-up on concrete, morning light.', {
    produces: 'hero', partOf: 'a complete email mailer',
  });
  expect(out.split('\n')[0]).toMatch(/^DELIVERABLE: ONE HERO PHOTOGRAPH — ONE ELEMENT of a complete email mailer/);
  expect(out).toMatch(/Do not return an email, an ad unit or a page/);
  // The brief itself survives intact; wrapping must not paraphrase it.
  expect(out).toContain('Close-up on concrete, morning light.');
  expect(out).toMatch(/No text baked into the image/);
});

test('an empty brief produces no prompt at all', () => {
  // A button that copies a bare header is worse than an absent button.
  for (const v of ['', '   ', null, undefined]) expect(mp.buildElementPrompt(v, {})).toBe('');
});

test('an element prompt is not wrapped in the brand block', () => {
  // It goes to an image model. Six paragraphs of typography and banned-phrase
  // rules ahead of a shot description is how a hero comes back with text baked
  // into it.
  const out = mp.buildElementPrompt('A pair on concrete.', { produces: 'hero' });
  expect(out).not.toContain('BANNED');
  expect(out.length).toBeLessThan(600);
});

/* ═══ 3. The index the UI renders ═════════════════════════════════════════ */

test('the whole-asset prompt is listed before any of its parts', () => {
  // Ordering is the fix, not decoration: the operator copies the first thing
  // that looks like the job.
  const ad = {
    platform: 'meta',
    creative_brief: 'Hero shot.',
    master_prompt: mp.buildMasterPrompt({ assetType: 'ad', platform: 'meta' }),
  };
  const rows = mp.promptsFor(ad, 'ad');
  expect(rows[0].kind).toBe('asset');
  expect(rows.some((r) => r.kind === 'element')).toBe(true);
  const firstElement = rows.findIndex((r) => r.kind === 'element');
  const lastAsset = rows.map((r) => r.kind).lastIndexOf('asset');
  expect(lastAsset).toBeLessThan(firstElement);
});

test('an asset row points at the text instead of copying it', () => {
  const email = {
    master_prompt_v1: mp.buildMasterPrompt({ assetType: 'mailer', variant: 'V1' }),
    master_prompt_v2: mp.buildMasterPrompt({ assetType: 'mailer', variant: 'V2' }),
    creative_brief: 'Hero shot.',
  };
  const rows = mp.promptsFor(email, 'mailer');
  const asset = rows.filter((r) => r.kind === 'asset');
  expect(asset.length).toBe(2);
  for (const r of asset) {
    expect(r.text, 'an asset row duplicated a ~5KB prompt onto the payload').toBeUndefined();
    expect(email[r.from], `${r.id} points at a field that is empty`).toBeTruthy();
  }
  // The saving is the reason: ~180 slots are prebuilt per brand.
  const index = Buffer.byteLength(JSON.stringify(rows));
  const inline = Buffer.byteLength(JSON.stringify(mp.promptsFor(email, 'mailer', { inline: true })));
  expect(index).toBeLessThan(inline / 5);
});

test('a v1-only mailer still gets both rows resolved to real text', () => {
  const email = { master_prompt: mp.buildMasterPrompt({ assetType: 'mailer', variant: 'V2' }) };
  const rows = mp.promptsFor(email, 'mailer');
  // No master_prompt_v2 field, so the row must fall back to master_prompt
  // rather than pointing at nothing.
  expect(rows.length).toBe(1);
  expect(email[rows[0].from]).toBeTruthy();
});

test('an asset with no prompts at all yields an empty list, not a broken row', () => {
  expect(mp.promptsFor({}, 'mailer')).toEqual([]);
  expect(mp.promptsFor(null, 'ad')).toEqual([]);
});

/* ═══ 4. The real build attaches them ═════════════════════════════════════ */

/** One slot, run through the real buildCampaign with the LLM off. */
async function build(over) {
  const entry = Object.assign({
    id: 'slot-prompt-1',
    date: '2026-09-02',
    market: 'US',
    objective: 'winback',
    rationale: 'Lapsed buyers, 90-120 days since last order.',
    cohort: { name: 'Lapsed 90-120d', size: 4200, rules: ['last_order_days 90..120'] },
    channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
    confidence: 0.8,
    heroProduct: { sku: 'SKU-1', title: 'Test Hero 01', handle: 'test-hero-01', category: 'kicks' },
    offer: { code: null, depth: 'none', pct: 0, why: 'no offer' },
  }, over || {});
  return sbPlan.buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
}

test('a real build attaches a prompt index to the mailer, the ads and the page', async () => {
  test.setTimeout(120_000);
  const c = await build();
  const email = c.assets.email;
  expect(email.prompts, 'the mailer carries no prompt index').toBeTruthy();
  expect(email.prompts.some((r) => r.kind === 'asset')).toBe(true);

  expect(c.assets.ads.length).toBeGreaterThan(0);
  for (const ad of c.assets.ads) {
    expect(ad.prompts, `${ad.platform} ad carries no prompt index`).toBeTruthy();
    expect(ad.prompts[0].kind, `${ad.platform} leads with an element prompt`).toBe('asset');
    // The asset row must RESOLVE, not just exist.
    expect(ad[ad.prompts[0].from]).toMatch(/DELIVERABLE: ONE COMPLETE/);
  }
  for (const lp of c.assets.landing_pages || []) {
    expect(lp.prompts[0].kind).toBe('asset');
    expect(lp[lp.prompts[0].from]).toMatch(/SELF-CONTAINED LANDING PAGE/);
  }
});

test('the cohort and the market reach the prompt the operator copies', async () => {
  test.setTimeout(120_000);
  const c = await build({ market: 'UK', cohort: { name: 'Never Purchased', size: 900, rules: ['orders = 0'] } });
  const text = c.assets.email.master_prompt_v2;
  expect(text).toContain('Never Purchased');
  expect(text).toMatch(/MARKET: UK/);
});

test('a slot with no hero product produces a marked asset instead of throwing', async () => {
  test.setTimeout(120_000);
  // A brand whose catalogue was never wired plans slots with no hero. This used
  // to throw a bare TypeError out of GenerationService and kill the whole
  // generation, so the operator saw a failed run rather than a stated gap.
  const c = await build({ heroProduct: undefined });
  expect(c.assets.email.subject).toMatch(/DATA REQUIRED BEFORE LAUNCH: hero product/);
  expect(c.assets.email.prompts.length).toBeGreaterThan(0);
});

/* ═══ 5. And it reaches a button ══════════════════════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let server; let base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, brand: null, needs_onboarding: false, workspaces: [] }));
    }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

/** Open /brain with one slot, and answer its preview call with a REAL campaign
 *  built by buildCampaign — not a hand-written fixture, which would be a test
 *  of the fixture. */
async function openWithCampaign(page, campaign) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({
    status: 200, contentType: 'text/javascript',
    body: 'window.tailwind = window.tailwind || {}; window.Papa = window.Papa || { unparse: () => "" };',
  }));
  await page.addInitScript(() => {
    try { sessionStorage.setItem('sb.autogen', '1'); } catch (_) {}
    // Record what the clipboard was actually handed. The assertion that
    // matters is the TEXT that lands there, not that a button exists.
    window.__COPIED = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { window.__COPIED.push(String(t)); return Promise.resolve(); } },
    });
  });

  const entry = {
    id: 'slot-prompt-1', date: iso(1), market: 'US',
    cohort: { name: 'Lapsed 90-120d', size: 4200 }, objective: 'winback',
    heroProduct: { title: 'Test Hero 01' }, channels: ['email', 'meta', 'landing_page'],
    confidence: 0.8, status: 'tentative', rationale: 'Lapsed buyers.',
  };

  await page.route('**/api/calendar**', async (route) => {
    const url = route.request().url();
    let body = { ok: true };
    if (url.includes('smart-brain-plan')) body = { ok: true, plan: [entry] };
    else if (url.includes('smart-brain-preview')) {
      body = {
        ok: true, campaign,
        email_html: campaign.assets.email.html,
        landing_html: (campaign.assets.landing_pages[0] || {}).html || '',
        ads: campaign.assets.ads, copywriter: campaign.copywriter,
      };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto(base + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.PLAN) && window.PLAN.length > 0, null, { timeout: 20_000 })
    .catch(() => {});
  return { errors };
}

/** Expand the slot and open one asset tab.
 *
 * Panes are display:none unless `.on`, and the first tab is the analysis pane —
 * so every assertion below is scoped to `.pvpane.on`. Asserting on a bare
 * `.pkbar` passes on markup the operator cannot see, which is the same class of
 * mistake as the bug under test. */
async function openAssetTab(page, label) {
  const view = page.locator('button:has-text("View")').first();
  await expect(view).toBeVisible({ timeout: 20_000 });
  await view.click();
  const tab = page.locator('.pvtab', { hasText: label }).first();
  await expect(tab, `no "${label}" tab in the preview`).toBeVisible({ timeout: 30_000 });
  await tab.click();
  return page.locator('.pvpane.on').first();
}

test('the console offers the whole-asset prompt, and copies the whole asset', async ({ page }) => {
  test.setTimeout(180_000);
  const campaign = await build();
  const { errors } = await openWithCampaign(page, campaign);
  const pane = await openAssetTab(page, /Mailer/i);

  await expect(pane.locator('.pkbar'), 'no prompt bar on the mailer pane').toBeVisible({ timeout: 15_000 });
  const assetBtn = pane.locator('.pkbar button[data-prompt-kind="asset"]').first();
  await expect(assetBtn).toBeVisible();
  await expect(assetBtn).toContainText('whole asset');

  await assetBtn.click();
  await expect.poll(() => page.evaluate(() => (window.__COPIED || []).length)).toBeGreaterThan(0);
  const copied = await page.evaluate(() => window.__COPIED[0]);

  // The actual regression: what lands on the clipboard must be the prompt for
  // the finished artefact, not a shot description.
  expect(copied).toMatch(/DELIVERABLE: ONE COMPLETE EMAIL MAILER/);
  expect(copied).toMatch(/OUTPUT FORMAT: ONE email HTML document/);
  expect(copied.length).toBeGreaterThan(1500);
  expect(errors, 'the page threw while rendering the prompt bar').toEqual([]);
});

test('an element button is present, labelled as one part, and copies only that', async ({ page }) => {
  test.setTimeout(180_000);
  const campaign = await build();
  await openWithCampaign(page, campaign);
  // Ads carry the image brief — the exact prompt that was pasted into Gemini.
  const pane = await openAssetTab(page, /ad/i);

  const el = pane.locator('.pkbar button[data-prompt-kind="element"]').first();
  await expect(el, 'the ad pane offers no element prompt').toBeVisible({ timeout: 15_000 });
  await expect(el).toContainText('one part');
  // And the whole-ad prompt sits beside it, which is what was missing.
  await expect(pane.locator('.pkbar button[data-prompt-kind="asset"]').first()).toBeVisible();

  await el.click();
  await expect.poll(() => page.evaluate(() => (window.__COPIED || []).length)).toBeGreaterThan(0);
  const copied = await page.evaluate(() => window.__COPIED[window.__COPIED.length - 1]);
  expect(copied).toMatch(/ONE ELEMENT of/);
  expect(copied).not.toMatch(/OUTPUT FORMAT/);
});

test('the pane says in words which button returns what', async ({ page }) => {
  test.setTimeout(180_000);
  const campaign = await build();
  await openWithCampaign(page, campaign);
  const pane = await openAssetTab(page, /Mailer/i);
  await expect(pane.locator('.pknote').first()).toContainText(/finished asset/, { timeout: 15_000 });
});

/* ═══ 6. Nowhere else silently offers an element prompt as the asset ══════ */

test('no surface labels an image brief as the campaign prompt', () => {
  // The original wording. "Creative brief" beside a mailer reads as the brief
  // for the mailer.
  for (const f of ['smart-brain.html']) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    expect(html, `${f} still offers a bare "Creative brief"`).not.toMatch(/add\('Creative brief'/);
  }
});
