// The output first (2026-10-17).
//
// The operator, on /brain with a Parwah slot open: "dont need so much
// information to be shown before - first the user priorities need to be
// addressed always which is the required output they are looking for". The
// row opened on "Copy by ...", a fourteen-item compliance list, a regex score
// that called itself "Benchmark verified", and the prompt buttons; the mailer
// started a screen and a half down. In the mailer itself the tagline was set
// in spaced capitals under the logo, and a real hero photo was followed by a
// second, full-colour hero block saying the same thing.
//
// Executed: a campaign the app builds, rendered by the console's own
// renderPreview in Chromium, and the shared mailer renderer called directly.
//
// Run: npx playwright test tests/output-first-preview.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const sbPlan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const trigger = require(path.join(ROOT, 'api', '_shared', 'calendar-trigger.js'));
const reasoning = require(path.join(ROOT, 'api', '_shared', 'output-reasoning.js'));

const SLOT = {
  id: 'first-1', date: '2026-09-02', market: 'US',
  objective: 'reactivation and replenishment',
  cohort: { name: 'At Risk', size: 2000, rules: ['r'] },
  channels: ['email', 'meta', 'google', 'landing_page'],
  confidence: 0.8,
  heroProduct: { sku: 'A', title: 'Alpha 01', handle: 'alpha-01' },
  offer: { code: null, depth: 'none', pct: 0, why: 'n/a' },
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server; let base; let campaign;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  campaign = await sbPlan.buildCampaign(SLOT, smartConfig({}), { noLLM: true, withCreatives: false });
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, workspaces: [] })); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

async function render(page, c) {
  await page.goto(base + '/smart-brain.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof renderPreview === 'function', null, { timeout: 20000 });
  return page.evaluate((c) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderPreview({ campaign: c, ads: c.assets.ads, email_variants: c.assets.email && c.assets.email.variants }, SLOT_E, 0, { target: host });
    const root = host.querySelector('.pvroot');
    const kids = [...root.children];
    const idx = (sel) => kids.findIndex((k) => k.matches(sel) || k.querySelector(sel));
    const firstSec = kids.findIndex((k) => k.matches('section.pvsec'));
    const checks = root.querySelector('details.pvchecks');
    // In the mailer pane: the document comes before the prompt buttons.
    const mf = root.querySelector('iframe.pvframe.is-mail'); const pane = mf && mf.closest('.pvpane');
    const order = pane ? [...pane.querySelectorAll('iframe.pvframe, .pkbar')].map((n) => n.matches('iframe') ? 'frame' : 'prompts') : [];
    return {
      firstSec, checksAt: kids.indexOf(checks), cmpInChecks: !!(checks && checks.querySelector('.cmp-panel')),
      copyByInChecks: !!(checks && /Copy by/.test(checks.textContent)),
      checksOpen: !!(checks && checks.open), lead: (root.querySelector('.pvlead') || {}).textContent || '',
      beforeFirst: kids.slice(0, firstSec).map((k) => k.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
      score: /Revenue\s*&\s*Quality|Benchmark verified/.test(root.textContent),
      order, idx: idx('.cmp-panel'),
    };
  }, c);
}

test('the assets come straight after the action bar; checks and how it was made sit in one collapsed block after them', async ({ page }) => {
  await page.addInitScript((e) => { window.SLOT_E = e; }, SLOT);
  const out = await render(page, campaign);
  expect(out.firstSec, 'no asset section rendered').toBeGreaterThan(0);
  expect(out.checksAt, 'the checks block is not after the assets').toBeGreaterThan(out.firstSec);
  expect(out.cmpInChecks, 'the compliance panel is not inside the checks block').toBe(true);
  expect(out.copyByInChecks).toBe(true);
  expect(out.beforeFirst, 'provenance or compliance text is shown before the assets').not.toMatch(/Copy by|Brand safety and compliance|Agent pipeline|Rule packs/);
  expect(out.score, 'a regex score calling itself benchmark-verified is shown').toBe(false);
  expect(out.order[0], 'the mailer\'s prompt buttons come before the mailer').toBe('frame');
  expect(out.order).toContain('prompts');
});

test('a blocking finding is said above the assets in one line, and the checks open', async ({ page }) => {
  await page.addInitScript((e) => { window.SLOT_E = e; }, SLOT);
  const blocked = JSON.parse(JSON.stringify(campaign));
  blocked.contract_check = Object.assign({}, blocked.contract_check, {
    compliance: { verdict: 'block', blocking: 2, warnings: 1, checked: 4, packs: [{ id: 'generic', label: 'Brand safety' }],
      findings: [{ id: 'generic.guaranteed_outcome', severity: 'BLOCK', title: 'Guaranteed outcome', asset: 'email', field: 'subject', matched: 'guaranteed', fix: 'Remove it.' }] },
  });
  const out = await render(page, blocked);
  expect(out.lead).toMatch(/Blocked: 2 issue\(s\) must be fixed/);
  expect(out.checksOpen).toBe(true);
  expect(out.checksAt).toBeGreaterThan(out.firstSec);
});

test('the shared mailer: a real hero photo is not followed by a second hero block, and a long tagline is not set under the logo', () => {
  const long = 'Parwah is the family superapp for what matters: papers, health details, things to do, the family tree and an emergency card that works offline.';
  const base = { brand: { id: 'ws-parwah', slug: 'parwah', name: 'Parwah', tagline: long, palette: { primary: '#3a1450', accent: '#f5a623', ink: '#1d1320', surface: '#fffaf0' } },
    market: 'IN', hero_product: 'Everyday nutrition', hero_headline: 'Everyday nutrition for your parents', hero_subline: 'Sub.', cta_text: 'Join the launch list', body_blocks: [] };
  const withPhoto = trigger.helpers.renderTextVariant(Object.assign({}, base, { style: 'visual', hero_image_url: 'https://example.com/hero.jpg' }));
  expect(withPhoto).toContain('https://example.com/hero.jpg');
  expect(withPhoto, 'the colour hero block repeats the photo\'s job').not.toContain('Brand-palette hero block');
  expect(withPhoto).toContain('Everyday nutrition for your parents');
  expect(withPhoto, 'a 140-character tagline under the logo').not.toContain('family superapp');
  // A slot the asset agent fills with a generated photo later is a photo too.
  const slot = trigger.helpers.renderTextVariant(Object.assign({}, base, { style: 'visual', hero_prompt: 'A parent and child reading together, natural light' }));
  expect(slot, 'a fillable photo slot is followed by a second hero block').not.toContain('Brand-palette hero block');
  expect(slot).toContain('Everyday nutrition for your parents');
  const noPhoto = trigger.helpers.renderTextVariant(Object.assign({}, base, { style: 'visual' }));
  expect(noPhoto, 'with no photo the colour block is the hero').toContain('Brand-palette hero block');
  const short = trigger.helpers.renderTextVariant(Object.assign({}, base, { style: 'visual', brand: Object.assign({}, base.brand, { tagline: 'Care for the people who cared for you' }) }));
  expect(short).toContain('Care for the people who cared for you');
});

test('a plan row never reads "Chosen to drive Drive ..."', () => {
  const a = reasoning.buildEntryAnalysis({ objective: 'Drive the reader to buy this product.', cohort: { name: 'At Risk', size: 0 }, product: { title: 'Everyday nutrition' }, channels: ['email'], market: 'IN' });
  expect(a.summary).toMatch(/^Chosen to drive the reader to buy this product for At Risk/);
  expect(a.summary).not.toMatch(/drive Drive/i);
  const b = reasoning.buildEntryAnalysis({ objective: 'reactivation', cohort: { name: 'At Risk', size: 10 }, product: { title: 'X' }, channels: ['email'], market: 'IN' });
  expect(b.summary).toMatch(/^Chosen to drive reactivation for At Risk/);
});

test('the copy brief forbids product attributes the brand does not state', () => {
  const prompt = sbPlan.__test_copyPrompt ? sbPlan.__test_copyPrompt(SLOT) : null;
  test.skip(!prompt, 'copyPrompt is not exported');
  expect(prompt).toMatch(/DESCRIBE the product only with words the brand itself uses/);
});
