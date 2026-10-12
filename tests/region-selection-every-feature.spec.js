// Every feature runs for the markets the operator chose (2026-10-12).
//
// The operator: "ensure user has option to select which all regions he is
// running which feature for as it must be based on the respective selected
// region or regions."
//
// A device brand with THREE markets (IN home in INR, US in USD, UK in GBP) is
// active, the way production serves today (tests/lib/brand-theme-harness.js).
// On every wired page the shared market control (region-context.js
// mountMulti, `[data-region-multi]`) is present; the operator ticks US beside
// the home IN (2 of 3), and:
//   VIEW pages      show exactly IN and US: every market the page renders as
//                   a row / tab / card is one of the two, both are there, UK
//                   is not;
//   GENERATOR pages send exactly ONE request per ticked market, each carrying
//                   that single market (never a list, never UK), and label
//                   each market's output; the per-market progress rows say
//                   done for IN and US.
// The requests are recorded with page.route over the harness. Generators are
// metered, so the signed-out device state refuses them before anything is
// sent (LifecycleStatus.decide, by design); the spec answers decide() as a
// verified session would, which is the state in which the request leaves.
//
// Run: npx playwright test tests/region-selection-every-feature.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const H = require('./lib/brand-theme-harness.js');

test.describe.configure({ mode: 'parallel' });

const NAME = H.define('region-selection-three', {
  name: 'Brambleweld Larder', slug: 'brambleweld-larder',
  palette: { primary: '#2f5d50', accent: '#c9822b', ink: '#1d1d1b', surface: '#ffffff' },
  typography: {
    heading: { family: 'Fraunces', stack: "'Fraunces',Georgia,serif" },
    body: { family: 'Inter', stack: "'Inter',system-ui,sans-serif" },
  },
  regions: [
    { code: 'IN', currency: 'INR', home: true, store_url: 'https://in.brambleweld.example' },
    { code: 'US', currency: 'USD', store_url: 'https://us.brambleweld.example' },
    { code: 'UK', currency: 'GBP', store_url: 'https://uk.brambleweld.example' },
  ],
});
const PICKED = ['IN', 'US'];
const NOT = 'UK';

/** Open `file` with the brand active, wait for the shared control, tick US. */
async function openAndPick(page, file, opts) {
  const o = opts || {};
  await H.install(page, NAME);
  if (o.route) await o.route(page);
  const painted = await H.open(page, file, NAME);
  expect(painted, file + ': the brand painted').toBe(true);
  await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded && document.querySelector('[data-region-multi] input[value="US"]'), null, { timeout: 15000 });
  // A generator's request leaves only for a verified session; answer as one.
  await page.evaluate(() => { if (window.LifecycleStatus) window.LifecycleStatus.decide = async () => null; window.LifecycleStatus && (window.LifecycleStatus.refusal = () => null); });
  if (o.before) await o.before(page);
  const control = page.locator(o.control || '[data-region-multi]').first();
  await expect(control).toBeVisible();
  // Home on by default (or every market for an aggregating view), then
  // exactly IN + US: set by clicking the options, the way a person does.
  const want = new Set(PICKED);
  for (const code of ['IN', 'US', 'UK']) {
    const box = control.locator('input[value="' + code + '"]');
    if ((await box.isChecked()) !== want.has(code)) {
      // Never clear the last one first: tick before untick.
      if (want.has(code)) await box.check(); else continue;
    }
  }
  for (const code of ['IN', 'US', 'UK']) {
    const box = control.locator('input[value="' + code + '"]');
    if (!want.has(code) && (await box.isChecked())) await box.uncheck();
  }
  await expect.poll(() => page.evaluate(() => window.RegionContext.selection)).toEqual(PICKED);
  // A multi-selection never changes the ONE market the rail holds.
  expect(await page.evaluate(() => window.RegionContext.region)).toBe('IN');
}

/** Record every request to `pattern`, answering with `answer(body, url)`. */
function recorder(pattern, answer) {
  const seen = [];
  const route = async (page) => {
    await page.route(pattern, async (r) => {
      let body = null;
      try { body = JSON.parse(r.request().postData() || 'null'); } catch (_) { body = r.request().postData(); }
      const url = r.request().url();
      if (r.request().method() === 'POST') seen.push({ url, body });
      const out = answer ? answer(body, url) : { ok: true };
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    });
  };
  return { seen, route };
}
const progressStates = (page, host) => page.locator(host + ' [data-market-progress]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-market-progress'), e.getAttribute('data-state')]));

/* ═════════════════════════════ GENERATORS ═════════════════════════════ */

test('/calendar: one plan request per ticked market, each carrying that market alone', async ({ page }) => {
  const rec = recorder('**/api/calendar?action=generate', (b) => {
    const m = (b && b.markets && b.markets[0]) || '';
    return { ok: true, markets: [m], total_sends_planned: 1, meta: { archetype_distribution: { 'founder-note': 1 } },
      plan: [{ id: 'p-' + m, date: new Date().toISOString().slice(0, 10), market: m, segment: 'Loyal', archetype: 'founder-note', content_type: 'email' }] };
  });
  await openAndPick(page, 'calendar.html', { route: rec.route });
  rec.seen.length = 0;   // the page plans its home market once on load
  await page.locator('#btnGenerate').click();
  await expect.poll(() => progressStates(page, '#planProgress')).toEqual([['IN', 'done'], ['US', 'done']]);
  expect(rec.seen.map((r) => r.body.markets)).toEqual([['IN'], ['US']]);
  await expect(page.locator('#planMeta')).toContainText('India and US');
  expect(await page.evaluate(() => STATE.plan.map((p) => p.market))).toEqual(['IN', 'US']);
});

test('/brain Agentic Generation: one run per ticked market, each report under its market', async ({ page }) => {
  const rec = recorder('**/api/brain?action=agentic-run', (b) => ({ ok: true, mode: 'device', tier: 'maxpower', market: b.market,
    stages: [{ stage: 'data', ok: true, summary: 'planned for ' + b.market }], ideation: { ideas: [] }, campaigns: [{ date: '2026-10-13', market: b.market, cohort: 'Loyal', subject: 'For ' + b.market }] }));
  await openAndPick(page, 'smart-brain.html', { route: rec.route });
  await expect(page.locator('#agenticMarkets[data-region-multi]')).toBeVisible();
  await expect(page.locator('#agenticMarket')).toContainText('Runs once for each selected market');
  await page.locator('#runAgentic').click();
  await expect.poll(() => progressStates(page, '#agenticProgress')).toEqual([['IN', 'done'], ['US', 'done']]);
  expect(rec.seen.map((r) => r.body.market)).toEqual(['IN', 'US']);
  for (const m of PICKED) await expect(page.locator(`[data-agentic-market="${m}"]`)).toContainText('planned for ' + m);
  await expect(page.locator(`[data-agentic-market="${NOT}"]`)).toHaveCount(0);
});

test('/studio: its market chips ARE the shared selection, both ways; the brief call carries one market', async ({ page }) => {
  const rec = recorder('**/api/ai/generate', (b) => ({ ok: true, text: 'A brief for ' + b.market + ' written to the contract, long enough to keep.', model: 'm', provider: 'p' }));
  await H.install(page, NAME);
  await rec.route(page);
  expect(await H.open(page, 'lifecycle_mailer_architect_v34.html', NAME)).toBe(true);
  await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded && document.querySelector('#mktChips .mkt-chip[data-mkt="US"]'));
  await expect(page.locator('#mktChips .mkt-chip.on')).toHaveCount(1);   // home, IN
  await page.locator('#mktChips .mkt-chip[data-mkt="US"]').click();
  await expect.poll(() => page.evaluate(() => [window.RegionContext.selection, S.markets])).toEqual([PICKED, PICKED]);
  // A selection made elsewhere (another page's control) is what the Studio builds for.
  await page.evaluate(() => window.RegionContext.setSelection(['UK']));
  await expect.poll(() => page.locator('#mktChips .mkt-chip.on').evaluateAll((els) => els.map((e) => e.getAttribute('data-mkt')))).toEqual(['UK']);
  expect(await page.evaluate(() => S.markets)).toEqual(['UK']);
  await page.evaluate(() => window.RegionContext.setSelection(['IN', 'US']));
  await expect.poll(() => page.evaluate(() => S.markets)).toEqual(PICKED);
  // The brief is ONE call for the primary market, never a list.
  await page.fill('#promptIn', 'Autumn larder restock for our loyal buyers, jam and tea bundle.');
  await page.locator('#smartAIBtn').click();
  await expect.poll(() => rec.seen.filter((r) => r.body && r.body.mode === 'create_brief').length).toBe(1);
  const brief = rec.seen.find((r) => r.body.mode === 'create_brief').body;
  expect([brief.market, brief.markets]).toEqual(['IN', ['IN']]);
});

test('/landing-pages: one page per ticked market, each request one market, each page labelled', async ({ page }) => {
  const rec = recorder('**/api/ai/generate', (b) => ({ ok: true, text: '<!doctype html><html><body><h1>Page for ' + b.region + '</h1></body></html>' }));
  await openAndPick(page, 'landing-pages.html', { route: rec.route });
  await expect(page.locator('[data-regions="mailers"][data-region-multi]')).toBeVisible();
  await page.fill('[data-form="mailers"][name="hero"]', 'The autumn larder, restocked');
  await page.locator('[data-create="mailers"]').click();
  await expect.poll(() => progressStates(page, '[data-progress="mailers"]')).toEqual([['IN', 'done'], ['US', 'done']]);
  const sent = rec.seen.filter((r) => r.body && r.body.mode === 'landing_page');
  expect(sent.map((r) => r.body.region)).toEqual(PICKED);
  for (const m of PICKED) await expect(page.locator(`[data-status="mailers"] [data-lp-market="${m}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-status="mailers"] [data-lp-market="${NOT}"]`)).toHaveCount(0);
});

test('/ad-campaigns: the plan shows the ticked markets; copy and Save run once per market', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  const entries = ['IN', 'US', 'UK'].map((m, i) => ({ id: 'e' + i, date: today, market: m, cohort: { name: 'Loyal ' + m }, objective: 'retention', channels: ['meta'], status: 'proposed' }));
  const rec = recorder(/\/api\/(calendar|ai\/generate)/, (b, url) => (/smart-brain-plan/.test(url) ? { ok: true, entries } : { ok: true, text: 'HERO HEADLINE: For ' + (b && b.market) + '\nSUB-COPY: Written for ' + (b && b.market) }));
  await openAndPick(page, 'ad-campaigns.html', { route: rec.route, control: '#ad-mkt', before: (p) => p.locator('.tab[data-tab="calendar"]').click() });
  // VIEW: exactly the two ticked markets, each row labelled with its market.
  await expect.poll(() => page.locator('[data-ad-row-market]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ad-row-market')))).toEqual(PICKED);
  // GENERATOR: Google copy, one request per market; Save, one campaign per market.
  await page.locator('.tab[data-tab="google"]').click();
  await expect(page.locator('#g-market[data-region-multi] input[value="US"]')).toBeChecked();
  await page.fill('#g-name', 'Autumn larder search');
  rec.seen.length = 0;
  await page.locator('#g-ai').click();
  await expect.poll(() => page.locator('#g-ai-note [data-ai-market]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ai-market')))).toEqual(PICKED);
  expect(rec.seen.filter((r) => r.body && r.body.mode === 'create_brief').map((r) => r.body.market)).toEqual(PICKED);
  await page.locator('#g-save').click();
  const saved = await page.evaluate(() => JSON.parse(Object.keys(localStorage).filter((k) => /ad/i.test(k)).map((k) => localStorage.getItem(k)).find((v) => /Autumn larder search/.test(v || '')) || '{}'));
  const google = (saved.google || []).filter((c) => c.name === 'Autumn larder search');
  expect(google.map((c) => c.market).sort()).toEqual(['IN', 'US']);
  expect(google.find((c) => c.market === 'US').headlines).toEqual(['For US']);
});
