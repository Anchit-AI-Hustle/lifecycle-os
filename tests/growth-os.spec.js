// Growth OS (growth-os.html) — every tab, every filter, every checkbox.
//
// The API is served here by calling the REAL engine (api/_shared/growth-os-core.js)
// rather than a fixture, so this test fails if the engine stops producing a
// shape the page can render. That is the coupling worth protecting: the page is
// entirely data-driven, so a renamed field would leave a silently empty panel
// that a screenshot test would happily pass.
//
// Run: npx playwright test tests/growth-os.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const core = require('../api/_shared/growth-os-core.js');
const DEFAULT_BRAND = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands/_default.json'), 'utf8'));

// The tabs the page ships, and the id of the panel each one must reveal.
const TABS = [
  'experiments', 'funnel', 'surfaces', 'kpis',
  'cohorts', 'plan', 'week1', 'competitive', 'gaps',
];

let server;
let base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url, qs] = (req.url || '/').split('?');

    if (url === '/api/brain') {
      const params = new URLSearchParams(qs || '');
      if (params.get('action') === 'growth-os') {
        const payload = core.build(DEFAULT_BRAND, { kind: params.get('kind') || undefined });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(payload));
      }
    }
    if (url.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{"ok":false}');
    }

    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

async function open(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.goto(base + '/growth-os.html', { waitUntil: 'load' });
  await expect(page.locator('#go-exp-body tr').first()).toBeVisible();
  return errors;
}

test('renders the full picture with no page errors', async ({ page }) => {
  const errors = await open(page);

  await expect(page.locator('#go-title')).toContainText('Growth OS');
  // The strip is built from brand facts, so it must never come back empty.
  await expect(page.locator('#go-strip .metric')).toHaveCount(6);
  await expect(page.locator('#go-policy')).toBeVisible();

  // Every figure on the page carries a basis chip. That is the whole honesty
  // contract, so its absence is a failure rather than a cosmetic problem.
  expect(await page.locator('#go-strip .basis').count()).toBe(6);

  expect(errors).toEqual([]);
});

test('every tab reveals exactly its own panel', async ({ page }) => {
  const errors = await open(page);

  for (const name of TABS) {
    await page.locator(`#go-tabs [data-tab="${name}"]`).click();

    await expect(page.locator(`#panel-${name}`)).toBeVisible();
    await expect(page.locator(`#go-tabs [data-tab="${name}"]`)).toHaveAttribute('aria-selected', 'true');

    // Exactly one panel open, and it is this one.
    await expect(page.locator('.panel.on')).toHaveCount(1);
    await expect(page.locator('.panel.on')).toHaveAttribute('id', `panel-${name}`);

    // A revealed panel must have content. An empty panel is the exact failure
    // this test exists to catch: the tab "works" and shows nothing.
    const text = (await page.locator(`#panel-${name}`).innerText()).trim();
    expect(text.length, `panel ${name} rendered empty`).toBeGreaterThan(80);
  }

  expect(errors).toEqual([]);
});

test('every experiment filter shows exactly the matching set', async ({ page }) => {
  const errors = await open(page);

  // Expected counts come from the same engine the page renders, so the test
  // asserts CORRECTNESS rather than "the number went down". A filter that
  // legitimately matches everything - every experiment ready on a complete
  // brand record - is a pass, not a failure.
  const payload = core.build(DEFAULT_BRAND, {});
  const expected = (key) => payload.experiments.filter((e) => {
    if (key === 'all') return true;
    if (key === 'ready' || key === 'blocked') return e.status === key;
    return e.levers.indexOf(key) !== -1;
  }).length;

  const filters = await page.locator('#go-exp-filters .chip').all();
  expect(filters.length).toBeGreaterThan(3);

  for (const chip of filters) {
    const key = await chip.getAttribute('data-filter');
    await chip.click();

    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    // Exactly one filter active at a time.
    await expect(page.locator('#go-exp-filters .chip[aria-pressed="true"]')).toHaveCount(1);

    const want = expected(key);
    if (want === 0) {
      await expect(page.locator('#go-exp-body .empty')).toHaveCount(1);
    } else {
      await expect(page.locator('#go-exp-body tr'), `filter "${key}"`).toHaveCount(want);
    }
  }

  expect(errors).toEqual([]);
});

test('lever filters show only experiments carrying that lever', async ({ page }) => {
  await open(page);

  const payload = core.build(DEFAULT_BRAND, {});
  for (const lever of payload.lever_filters) {
    const chip = page.locator(`#go-exp-filters [data-filter="${lever.key}"]`);
    if (!(await chip.count())) continue;
    await chip.click();

    const names = await page.locator('#go-exp-body tr td:nth-child(2) b').allInnerTexts();
    for (const name of names) {
      const exp = payload.experiments.find((e) => e.name === name);
      expect(exp, `unknown experiment "${name}" rendered`).toBeTruthy();
      expect(exp.levers, `"${name}" shown under ${lever.key}`).toContain(lever.key);
    }
  }
});

test('status filters agree with the status column', async ({ page }) => {
  await open(page);

  for (const status of ['ready', 'blocked']) {
    await page.locator(`#go-exp-filters [data-filter="${status}"]`).click();
    const pills = await page.locator('#go-exp-body .pill').allInnerTexts();
    for (const p of pills) expect(p.trim()).toBe(status);
  }
});

test('checkboxes toggle and survive a reload', async ({ page }) => {
  const errors = await open(page);

  await page.locator('#go-tabs [data-tab="week1"]').click();
  const first = page.locator('#panel-week1 [data-check]').first();
  const key = await first.getAttribute('data-check');

  await expect(first).toHaveAttribute('aria-checked', 'false');
  await first.click();
  await expect(first).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator(`#panel-week1 .item[data-key="${key}"]`)).toHaveClass(/done/);

  await page.reload({ waitUntil: 'load' });
  await page.locator('#go-tabs [data-tab="week1"]').click();
  await expect(page.locator(`#panel-week1 [data-check="${key}"]`)).toHaveAttribute('aria-checked', 'true');

  // And back off again, so the control is a toggle rather than a one-way latch.
  await page.locator(`#panel-week1 [data-check="${key}"]`).click();
  await expect(page.locator(`#panel-week1 [data-check="${key}"]`)).toHaveAttribute('aria-checked', 'false');

  expect(errors).toEqual([]);
});

test('degrades honestly when the engine is unreachable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));

  await page.route('**/api/brain**', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.goto(base + '/growth-os.html', { waitUntil: 'load' });

  // It must say so, rather than render an empty dashboard that looks like a
  // brand with no growth opportunities.
  await expect(page.locator('#go-policy-text')).toContainText('could not be loaded');
  expect(errors).toEqual([]);
});

test('no measured figure is claimed before anything is connected', async ({ page }) => {
  await open(page);

  // With no analytics connected the engine must not report a single measured
  // PERFORMANCE number. Brand facts are legitimately measured; funnel and KPI
  // values are not, and they are the ones that mislead.
  await page.locator('#go-tabs [data-tab="kpis"]').click();
  const values = await page.locator('#panel-kpis .kpival').allInnerTexts();
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) expect(v.trim()).toBe('—');

  await page.locator('#go-tabs [data-tab="funnel"]').click();
  const measured = await page.locator('#panel-funnel .basis-measured').count();
  expect(measured, 'a funnel stage claimed to be measured with nothing connected').toBe(0);
});
