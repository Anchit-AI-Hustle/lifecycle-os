// Revenue by region, the PAGE, in Chromium (2026-10-11).
//
// /revenue-by-region driven the way a founder uses it: a device brand with
// three markets (IN in INR, US in USD, UK in GBP) is active, signed out, the
// way production serves today (tests/lib/brand-theme-harness.js). An order
// export is imported through the page's own file input; the shared
// multi-market control (region-context.js mountMulti) is used by clicking and
// by keyboard. Asserted on what the page RENDERS:
//   - two markets selected = exactly those two cards and table rows, each in
//     its own currency, figures exact; the third market never appears;
//   - the selection survives a reload (per brand, per viewer);
//   - no single total across currencies until rates are entered; then the
//     exact conversion, each rate with its date;
//   - a selected market with no orders shows its marker, never 0;
//   - every text run AA against its rendered ground; the page fits a phone,
//     every option a 44px target;
//   - a GENERATOR still takes one market: a multi-selection never changes
//     RegionContext.region, and Smart Brain's agentic run says it builds for one.
//
// Run: npx playwright test tests/region-revenue-page.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const H = require('./lib/brand-theme-harness.js');

const NAME = H.define('region-revenue-founder', {
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

const TODAY = new Date().toISOString().slice(0, 10);
const at = (back) => new Date(Date.parse(TODAY + 'T10:00:00Z') - back * 86400000).toISOString();
const CSV = [
  'Order ID,Created at,Total,Currency,Market,Customer ID,SKU,Product,Quantity,Refund',
  `A1,${at(3)},500,INR,IN,c1,JAM,Bramble Jam,1,0`,
  `A2,${at(2)},500,INR,India,c2,JAM,Bramble Jam,1,0`,
  `A3,${at(1)},500,INR,IN,c1,TEA,Smoked Tea,2,0`,
  `B1,${at(2)},40,USD,US,u1,JAM,Bramble Jam,1,0`,
  `B2,${at(1)},60,USD,USA,u2,TEA,Smoked Tea,1,0`,
  `C1,${at(1)},30,GBP,UK,k1,JAM,Bramble Jam,1,0`,
].join('\n');

async function openPage(page) {
  await H.install(page, NAME);
  // The harness's seed clears localStorage on every navigation; a reload in
  // this spec carries the page's own keys across through sessionStorage, the
  // way a browser keeps localStorage across a reload.
  await page.addInitScript(() => {
    try { const keep = JSON.parse(sessionStorage.getItem('__rr_keep') || '{}'); for (const k of Object.keys(keep)) localStorage.setItem(k, keep[k]); } catch (_) {}
  });
  const painted = await H.open(page, 'revenue-by-region.html', NAME);
  expect(painted, 'the brand painted').toBe(true);
  await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded && document.querySelector('[data-region-multi] input'));
}
async function importCsv(page) {
  await page.setInputFiles('#csvFile', { name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.locator('#deviceNote')).toContainText('6 orders imported');
}
const cards = (page) => page.locator('[data-region-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-region-card')));
const rows = (page) => page.locator('[data-region-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-region-row')));

test('two markets selected: exactly those, each in its own currency, exact; kept after reload', async ({ page }) => {
  await openPage(page);
  // Home market by default, and no orders yet: its marker, never a zero.
  expect(await cards(page)).toEqual(['IN']);
  await expect(page.locator('[data-region-card="IN"] [data-marker]')).toHaveText('[DATA REQUIRED BEFORE LAUNCH: order history, Brambleweld Larder, IN]');
  await importCsv(page);

  await page.locator('.rgn-opt', { hasText: 'US' }).click();
  await expect.poll(() => cards(page)).toEqual(['IN', 'US']);
  expect(await rows(page)).toEqual(['IN', 'US']);
  await expect(page.locator('[data-region-card="IN"] [data-fig="revenue"]')).toHaveText('₹1,500');
  await expect(page.locator('[data-region-card="US"] [data-fig="revenue"]')).toHaveText('$100');
  await expect(page.locator('[data-region-card="UK"]')).toHaveCount(0);
  const inRow = await page.locator('[data-region-row="IN"] td').allInnerTexts();
  expect(inRow.slice(0, 5)).toEqual(['₹1,500', 'INR', '3', '₹500', '4']);   // revenue, currency, orders, AOV, units
  // Two currencies, no rate entered: two subtotals and the sentence, no single total.
  await expect(page.locator('[data-subtotal]')).toHaveCount(2);
  await expect(page.locator('[data-combined]')).toHaveCount(0);
  await expect(page.locator('[data-no-combined]')).toContainText('No single total in INR: no rate has been entered for USD to INR');

  // The generator's market is untouched by a multi-selection.
  expect(await page.evaluate(() => [window.RegionContext.region, window.RegionContext.selection])).toEqual(['IN', ['IN', 'US']]);

  await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^lc-region-/.test(k)) o[k] = localStorage.getItem(k); } sessionStorage.setItem('__rr_keep', JSON.stringify(o)); });
  await page.reload();
  await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded && document.querySelector('[data-region-card="US"]'));
  expect(await cards(page)).toEqual(['IN', 'US']);
  expect(await page.locator('[data-region-multi] input[value="US"]').isChecked()).toBe(true);
  expect(await page.locator('[data-region-multi] input[value="UK"]').isChecked()).toBe(false);
});

test('keyboard operable, the last market cannot be cleared, All markets is every market', async ({ page }) => {
  await openPage(page);
  await importCsv(page);
  await page.locator('[data-region-multi] input[data-rgn-all]').focus();
  await page.keyboard.press('Tab');   // IN
  await page.keyboard.press('Tab');   // US
  await page.keyboard.press('Tab');   // UK
  await page.keyboard.press('Space');
  await expect.poll(() => cards(page)).toEqual(['IN', 'UK']);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.value)).toBe('UK');
  // Clear IN, then try to clear UK, the last one: refused, said.
  await page.locator('[data-region-multi] input[value="IN"]').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => cards(page)).toEqual(['UK']);
  await page.locator('[data-region-multi] input[value="UK"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.rgn-multi-msg')).toHaveText('Keep at least one market selected.');
  expect(await cards(page)).toEqual(['UK']);
  await page.locator('[data-region-multi] input[data-rgn-all]').check();
  await expect.poll(() => cards(page)).toEqual(['IN', 'US', 'UK']);
});

test('a combined total only through entered rates, each with its date', async ({ page }) => {
  await openPage(page);
  await importCsv(page);
  await page.locator('[data-region-multi] input[data-rgn-all]').check();
  await expect(page.locator('[data-subtotal]')).toHaveCount(3);
  const asOf = at(1).slice(0, 10);
  for (const [from, rate] of [['USD', '83'], ['GBP', '105']]) {
    await page.fill('#fxFrom', from);
    await page.fill('#fxTo', 'INR');
    await page.fill('#fxRate', rate);
    await page.fill('#fxDate', asOf);
    await page.locator('#fxForm button[type=submit]').click();
    await expect(page.locator('.fx-list li', { hasText: '1 ' + from + ' = ' + rate + ' INR' })).toHaveCount(1);
  }
  // 1,500 + 100 x 83 + 30 x 105 = 12,950
  await expect(page.locator('[data-combined] b')).toHaveText('₹12,950');
  await expect(page.locator('#totals')).toContainText('1 USD = 83 INR on ' + asOf);
  await expect(page.locator('#totals')).toContainText('1 GBP = 105 INR on ' + asOf);
  // A rate that is not a rate is refused in words, nothing kept.
  await page.fill('#fxFrom', 'INR'); await page.fill('#fxTo', 'INR'); await page.fill('#fxRate', '1'); await page.fill('#fxDate', asOf);
  await page.locator('#fxForm button[type=submit]').click();
  await expect(page.locator('#fxMsg')).toContainText('is not a rate');
  await expect(page.locator('.fx-list li')).toHaveCount(2);
});

test('every text run is AA on its ground, and the page fits a phone with 44px options', async ({ page }) => {
  await openPage(page);
  await importCsv(page);
  await page.locator('[data-region-multi] input[data-rgn-all]').check();
  await expect.poll(() => cards(page)).toEqual(['IN', 'US', 'UK']);
  const r = await page.evaluate(H.PROBE + '(' + JSON.stringify(H.probeConfig(NAME, 'rr')) + ')');
  expect(r.text, 'the probe measured the page').toBeGreaterThan(60);
  expect(r.textFails.map((f) => `"${f.text}" ${f.ratio}:1 ${f.sel}`)).toEqual([]);
  expect(r.groundFails).toEqual([]);

  await page.setViewportSize({ width: 360, height: 740 });
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => ({
    over: document.documentElement.scrollWidth - window.innerWidth,
    small: Array.from(document.querySelectorAll('.rgn-opt, #fxForm button, #period, #gran')).map((e) => e.getBoundingClientRect()).filter((b) => b.height < 44 || b.width < 44).length,
    inputs: Array.from(document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), select')).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length,
  }));
  expect(fit.over, 'no horizontal page scroll at 360px').toBeLessThanOrEqual(0);
  expect(fit.small, 'every option and button is a 44px target').toBe(0);
  expect(fit.inputs, 'no input under 16px (iOS zooms the page)').toBe(0);
});

test('a generator keeps ONE market: Smart Brain\'s agentic run says so and takes the first', async ({ page }) => {
  await H.install(page, NAME);
  await H.open(page, 'smart-brain.html', NAME);
  await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded);
  await page.evaluate(() => window.RegionContext.setSelection(['US', 'UK']));
  const pick = await page.evaluate(() => { gateAgentic(); return [agenticMarket().market, window.RegionContext.region, document.getElementById('agenticMarket').textContent]; });
  expect(typeof pick[0]).toBe('string');
  expect(pick[0], 'one market, the rail\'s, never the list').toBe('IN');
  expect(pick[1]).toBe('IN');
  expect(pick[2]).toContain('Builds for one market at a time: India (IN)');
});
