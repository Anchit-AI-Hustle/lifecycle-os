// Data Analysis consolidation — one workbench, one owner per analysis.
//
// WHAT THIS PROTECTS. The analysis surfaces drifted apart once already: the
// business review was a standalone page AND ten tabs of the workbench, the
// market study grew its own revenue pacer, and the connector tabs existed only
// when the page was opened through one iframe wrapper. Every one of those was
// found by opening two pages side by side, which is not a check.
//
// The invariants below are the arrangement stated as tests: every analysis is
// reachable from Data Analysis, every route that ever shipped still resolves,
// and no two surfaces claim the same analysis. They are asserted against the
// SAME registry the pages build themselves from, so a tab added without an
// owner, or a second surface quietly re-rendering an existing analysis, fails
// here rather than in front of a reader.
//
// Run: npx playwright test tests/data-analysis.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REG = require('../analysis-registry.js');
const growthCore = require('../api/_shared/growth-os-core.js');
const DEFAULT_BRAND = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands/_default.json'), 'utf8'));
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

// Connector payloads shaped like the real ones but empty. The point is to prove
// each tab RENDERS its analysis and states its own emptiness honestly, not to
// re-test the connectors, so nothing here carries a number the page could
// present as a measurement.
const CONNECTOR_FIXTURES = {
  ads: {
    ok: true, generated_at: new Date().toISOString(), market: 'US', level: 'ad',
    window: { since: '2020-01-01', until: '2026-08-13' },
    freshness: 'Fetched on request with cache disabled.',
    kpis: { spend: 0, revenue: 0, roas: null, impressions: 0, clicks: 0, ctr: 0, conversions: 0, cpa: null, conversion_rate: 0 },
    platforms: [{ platform: 'meta', connected: false, ok: false, rows: [], need_env: ['META_ACCESS_TOKEN'], fetched_at: null, error: null }],
    rows: [], connected_platforms: [], pending_platforms: ['meta'],
    note: 'No platform is connected, so nothing is estimated.',
  },
  mailer: {
    ok: true, generated_at: new Date().toISOString(), market: 'US', window_hours: 720,
    sources: { klaviyo: { connected: false, live_events: 0, mirrored_campaigns: 0 }, webengage: { connected: false, events: 0 } },
    kpis: { delivered: 0, open_rate: 0, click_rate: 0, ctor: 0, conversions: 0, revenue: 0, revenue_per_recipient: 0, unsubscribe_rate: 0, bounce_rate: 0, known_campaigns: 0, known_segments: 0, segment_profiles: 0 },
    event_mix: [], campaigns: [], segments: [],
    note: 'No delivery denominator is available; rates remain zero rather than being estimated.',
  },
  landing: {
    ok: true, market: 'US',
    kpis: { pages: 0, visitors: 0, page_views: 0, ctr: 0, conversions: 0, conversion_rate: 0, revenue: 0, revenue_per_visitor: 0, aov: 0, live_experiments: 0, significant_winners: 0, srm_flags: 0, competitor_pages: 0, competitor_brands: 0 },
    connector: { connected: false, sources: [], note: 'PageDeck is not configured on this deployment.' },
    availability: { pages: { rows: 0 }, experiments: { rows: 0 }, competitors: { rows: 0 } },
    pages: [], experiments: [], competitors: [],
  },
  actions: {
    ok: true,
    kpis: { actions_tracked: 0, completed_actions: 0, completion_rate: 0, failed_or_rolled_back: 0, error_rate: 0, median_time_to_launch_hours: 0, measured_actions: 0, realized_incremental_revenue: 0, realized_roi: 0, guardrail_breaches: 0, rollback_rate: 0, experiment_win_rate: 0, pending_reviews: 0 },
    actions: [], recent_activity: [], connector_runs: [],
    note: 'No measured outcome rows exist yet; activity is shown without invented impact.',
  },
  alerts: {
    ok: true,
    settings: {
      enabled: true, cadence_hours: 1, cooldown_minutes: 180, sender_email: '',
      channels: { gmail: true, google_chat: false, sms: false },
      recipients: { email: [], sms: [] },
      quiet_hours: { enabled: true, timezone: 'Asia/Kolkata', start_hour: 22, end_hour: 7, critical_bypass: true },
      thresholds: {
        ad_roas_min: 1.5, ad_ctr_drop_pct: 0.25, ad_spend_spike_pct: 0.5, ad_spend_no_conversion: 200,
        mailer_open_rate_min: 0.2, mailer_click_rate_min: 0.015, mailer_unsubscribe_rate_max: 0.005,
        landing_conversion_rate_min: 0.02, action_error_rate_max: 0.1, connector_stale_hours: 3,
      },
    },
    status: { connectors: {}, last_run: null },
  },
};

let server;
let base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url, qs] = (req.url || '/').split('?');
    const params = new URLSearchParams(qs || '');
    const json = (body) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url === '/api/brain' && params.get('action') === 'growth-os') {
      // The REAL engine, so the KPI band fails here if growth-os-core stops
      // producing the vocabulary the band is built from.
      return json(growthCore.build(DEFAULT_BRAND, {}));
    }
    if (url === '/api/public-config' && params.get('action') === 'data-analysis') {
      const view = params.get('view') || 'status';
      return json(CONNECTOR_FIXTURES[view] || { ok: true });
    }
    if (url.startsWith('/api/')) return json({ ok: true });

    const file = path.join(ROOT, url === '/' ? 'index.html' : decodeURIComponent(url).replace(/^\//, ''));
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

/**
 * The embedded review loads its chart library from a CDN, which no sandboxed
 * test run can reach. That failure belongs to the network, not to this page, so
 * it is filtered out by name rather than being allowed to mask a real error.
 */
const OFFLINE_CDN = /\bChart(DataLabels)? is not defined\b/;
const appErrors = (errors) => errors.filter((e) => !OFFLINE_CDN.test(e));

async function openWorkbench(page, query) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.goto(base + '/data-analysis.html' + (query || ''), { waitUntil: 'load' });
  // The drill-down links are the last thing the sections script mounts, so
  // their presence means the whole bar is built.
  await expect(page.locator('#anTabs [data-drilldown]').first()).toBeVisible();
  return errors;
}

function tabButton(page, id) {
  return page.locator(`#anTabs button[data-tab="${id}"], #anTabs button[data-ext-tab="${id}"]`);
}

// ── Reachability ────────────────────────────────────────────────────────────

test('every analysis in the registry is reachable from Data Analysis', async ({ page }) => {
  const errors = await openWorkbench(page);

  for (const tab of REG.TABS) {
    await expect(tabButton(page, tab.id), `tab "${tab.id}" has no button`).toHaveCount(1);
  }
  for (const d of REG.DRILLDOWNS) {
    const link = page.locator(`#anTabs a[data-drilldown="${d.id}"]`);
    await expect(link, `drill-down "${d.id}" has no link`).toHaveCount(1);
    expect(await link.getAttribute('href')).toContain(d.href);
  }

  // Nothing may own an analysis without being on this page.
  const owners = REG.analysisOwners();
  const reachable = new Set(
    REG.TABS.filter((t) => t.analysis).map((t) => t.analysis)
      .concat(REG.DRILLDOWNS.map((d) => d.analysis)),
  );
  for (const key of Object.keys(owners)) expect(reachable.has(key)).toBe(true);

  expect(appErrors(errors)).toEqual([]);
});

test('the shared rail names the same tabs the workbench does', () => {
  const auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  const linked = [...auth.matchAll(/href: '\/data-analysis\?tab=([a-z-]+)'/g)].map((m) => m[1]);
  expect(linked.length, 'the rail no longer links into the workbench at all').toBeGreaterThan(4);

  for (const id of linked) {
    expect(REG.tab(id) || REG.TAB_ALIASES[id], `the rail links to tab "${id}", which the registry does not serve`).toBeTruthy();
    // The rail should carry the CURRENT id, not one kept alive only for old
    // bookmarks, or the product ships its own retired vocabulary.
    expect(REG.tab(id), `the rail links to the retired tab id "${id}"`).toBeTruthy();
  }

  // And the label beside each link matches the tab it opens. A rail that calls
  // a tab something else is the cheapest way to convince a reader there are two
  // of them.
  const labelled = [...auth.matchAll(/label: '([^']+)',\s+href: '\/data-analysis\?tab=([a-z-]+)'/g)];
  expect(labelled.length).toBe(linked.length);
  for (const [, label, id] of labelled) {
    expect(REG.tab(id).label, `the rail calls tab "${id}" something else`).toBe(label.trim());
  }
});

test('every drill-down href resolves to a route or a file', async () => {
  const routes = new Set();
  for (const r of (VERCEL.rewrites || []).concat(VERCEL.redirects || [])) {
    if (r.source) routes.add(r.source.split('?')[0]);
  }
  for (const d of REG.DRILLDOWNS) {
    const clean = d.href.split('?')[0];
    const onDisk = fs.existsSync(path.join(ROOT, clean.replace(/^\//, '')))
      || fs.existsSync(path.join(ROOT, clean.replace(/^\//, '') + '.html'));
    expect(routes.has(clean) || onDisk, `drill-down href ${d.href} goes nowhere`).toBe(true);
  }
});

test('each drill-down page says which Data Analysis tab owns it', async ({ page }) => {
  for (const d of REG.DRILLDOWNS) {
    const file = d.href === '/rfm' ? '/dashboard.html'
      : d.href === '/audit' ? '/app-audit.html'
        : d.href === '/research' ? '/research.html'
          : d.href === '/ads-master' ? '/ad-campaigns-master.html'
            : '/ads-dashboard.html';
    await page.goto(base + file, { waitUntil: 'load' });
    const crumb = page.locator('#lc-analysis-crumb');
    await expect(crumb, `${file} has no Data Analysis breadcrumb`).toHaveCount(1);
    const parent = REG.tab(d.parent);
    await expect(crumb).toContainText('Data Analysis');
    await expect(crumb).toContainText(parent.label);
    await expect(crumb.locator(`a[href="/data-analysis?tab=${parent.id}"]`)).toHaveCount(1);
  }
});

// ── Retired routes ──────────────────────────────────────────────────────────

test('every retired tab id still opens the tab that now owns it', async ({ page }) => {
  const errors = await openWorkbench(page);

  // Resolution is checked for EVERY retired id, against the copy of the
  // registry the page itself loaded, so an alias cannot be dropped from the
  // shipped file while the Node-side one still has it.
  const resolved = await page.evaluate((aliases) => {
    const reg = window.LifecycleAnalysisRegistry;
    return aliases.map((a) => [a, reg.resolveTab(a), reg.reviewSection(a)]);
  }, Object.keys(REG.TAB_ALIASES));
  for (const [alias, canonical] of resolved) {
    expect(canonical, `alias "${alias}" no longer resolves`).toBe(REG.TAB_ALIASES[alias]);
  }
  // A retired review link named a SECTION, and still lands on it.
  expect(resolved.find((r) => r[0] === 'review-support')[2]).toBe(REG.reviewSection('review-support'));

  // And the resolution is actually wired to the tab strip, on both a connector
  // tab and the collapsed review.
  for (const alias of ['ads', 'review-website']) {
    await openWorkbench(page, '?tab=' + alias);
    await expect(tabButton(page, REG.TAB_ALIASES[alias]), `alias "${alias}" did not open its tab`)
      .toHaveClass(/\bon\b/);
  }

  expect(appErrors(errors)).toEqual([]);
});

test('the retired standalone routes redirect instead of disappearing', () => {
  const redirects = Object.fromEntries((VERCEL.redirects || []).map((r) => [r.source, r.destination]));
  for (const source of ['/usa-d2c-report', '/usa-d2c-dashboard', '/d2c-review', '/business-review', '/data-analysis-contrast.html']) {
    expect(redirects[source], `${source} lost its redirect`).toBeTruthy();
    expect(redirects[source]).toMatch(/^\/data-analysis/);
  }

  // The wrapper file itself still answers, for anything that bypasses the
  // redirect table.
  const wrapper = fs.readFileSync(path.join(ROOT, 'data-analysis-contrast.html'), 'utf8');
  expect(wrapper).toContain('/data-analysis');
  expect(wrapper).toMatch(/location\.replace|http-equiv="refresh"/);
});

test('the workbench routes serve the workbench itself, not a wrapper', () => {
  const rewrites = Object.fromEntries((VERCEL.rewrites || []).map((r) => [r.source, r.destination]));
  for (const source of ['/analytics', '/data-analysis']) {
    expect(rewrites[source]).toBe('/data-analysis.html');
  }
});

// ── No duplicate analysis ───────────────────────────────────────────────────

test('no analysis is claimed by two surfaces', () => {
  const owners = REG.analysisOwners();
  const duplicated = Object.entries(owners).filter(([, list]) => list.length > 1);
  expect(duplicated, `these analyses have more than one owner: ${JSON.stringify(duplicated)}`).toEqual([]);

  const tabIds = new Set(REG.TABS.map((t) => t.id));
  for (const d of REG.DRILLDOWNS) expect(tabIds.has(d.id)).toBe(false);
});

test('the business review is one tab, not one per section', async ({ page }) => {
  await openWorkbench(page);
  // Ten buttons used to open the same report at different scroll positions.
  await expect(page.locator('#anTabs button[data-ext-tab^="review"]')).toHaveCount(1);

  await tabButton(page, 'review').click();
  await expect(page.locator('#xReviewFrame')).toHaveCount(1);
  // And exactly one embedded copy of it, however the tab was reached.
  await expect(page.locator('iframe[src*="usa-d2c-dashboard"]')).toHaveCount(1);
});

test('the market study no longer reports the brand own trading', () => {
  const research = fs.readFileSync(path.join(ROOT, 'research.html'), 'utf8');
  // The pacer and the projector duplicated the Control Room and ran on invented
  // numbers. Their absence is the assertion; the pointer to the one surface
  // that does measure trading is the replacement.
  expect(research).not.toContain('id="rtRev"');
  expect(research).not.toContain('id="pOutRev"');
  expect(research).not.toMatch(/simulate a live intraday pace/i);
  expect(research).toContain('/data-analysis?tab=control');
});

// ── Rendering ───────────────────────────────────────────────────────────────

test('every tab reveals its own content and nothing else', async ({ page }) => {
  const errors = await openWorkbench(page);

  for (const tab of REG.TABS.filter((t) => t.kind !== 'native')) {
    await tabButton(page, tab.id).click();
    const panel = page.locator('#extendedAnalysisPanel');
    await expect(panel).toBeVisible();
    const text = (await panel.innerText()).trim();
    expect(text.length, `tab ${tab.id} rendered empty`).toBeGreaterThan(80);
    // Exactly one tab is active at a time.
    await expect(page.locator('#anTabs button.on')).toHaveCount(1);
    // The native workbench is put away while a connector tab is open, so the
    // reader never sees two answers stacked on one screen.
    await expect(page.locator('#grid')).toBeHidden();
  }

  for (const tab of REG.TABS.filter((t) => t.kind === 'native')) {
    await tabButton(page, tab.id).click();
    await expect(page.locator('#grid')).toBeVisible();
    await expect(page.locator('#extendedAnalysisPanel')).toBeHidden();
  }

  expect(appErrors(errors)).toEqual([]);
});

test('nav bars are a single row that slides', async ({ page }) => {
  await openWorkbench(page);
  for (const sel of ['#anTabs', '#mktToggle']) {
    const wrap = await page.locator(sel).evaluate((el) => getComputedStyle(el).flexWrap);
    expect(wrap, `${sel} wraps instead of sliding`).toBe('nowrap');
  }

  await page.goto(base + '/research.html', { waitUntil: 'load' });
  for (const sel of ['#regionTabs', '#msRegionTabs']) {
    const wrap = await page.locator(sel).evaluate((el) => getComputedStyle(el).flexWrap);
    expect(wrap, `${sel} wraps instead of sliding`).toBe('nowrap');
  }

  // The review's own section nav is now the sectioning control of a Data
  // Analysis tab, so it is held to the same rule.
  await page.goto(base + '/lifecycle-usa-d2c-dashboard.html', { waitUntil: 'domcontentloaded' });
  const reviewNav = await page.locator('nav#nav').evaluate((el) => getComputedStyle(el).flexWrap);
  expect(reviewNav, 'the review section nav wraps instead of sliding').toBe('nowrap');
});

// ── Region-wise metrics, honestly based ─────────────────────────────────────

test('the KPI band speaks the growth model vocabulary, per market', async ({ page }) => {
  const errors = await openWorkbench(page);
  const model = growthCore.build(DEFAULT_BRAND, {});

  const band = page.locator('#growthBand');
  await expect(band.locator('.xkpi-cell').first()).toBeVisible();

  // The north star and its inputs come from growth-os-core, not from a second
  // list kept on this page.
  await expect(band).toContainText(model.kpis.north_star.name);
  for (const input of model.kpis.inputs) await expect(band).toContainText(input.name);
  await expect(band.locator('.xkpi-cell')).toHaveCount(model.kpis.inputs.length + 1);

  // A sector range is labelled modelled wherever it appears, and is never the
  // value of a measured row.
  const modelled = await band.locator('.xbasis.modelled').count();
  expect(modelled).toBeGreaterThan(0);
  for (const cell of await band.locator('.xkpi-cell').all()) {
    const text = await cell.innerText();
    if (/not measured/.test(text)) {
      expect(await cell.locator('.xbasis.measured').count(), `an unmeasured row claims to be measured: ${text}`).toBe(0);
      expect(text).toMatch(/Connect/);
    }
  }

  expect(appErrors(errors)).toEqual([]);
});

test('each market is measured on its own data, never a blended number', async ({ page }) => {
  await openWorkbench(page);
  const band = page.locator('#growthBand');

  async function measuredValues() {
    const out = {};
    for (const cell of await band.locator('.xkpi-cell').all()) {
      if (!(await cell.locator('.xbasis.measured').count())) continue;
      out[(await cell.locator('.xkl').innerText()).trim()] = (await cell.locator('.xkv').innerText()).trim();
    }
    return out;
  }

  // The dataset is swapped in after the active brand resolves, so the band
  // renders twice. Reading it before the second pass is reading an empty
  // export, not an unmeasured market.
  await expect(band.locator('.xbasis.measured').first()).toBeVisible();
  const us = await measuredValues();

  await page.locator('#mktToggle button[data-mkt="UK"]').click();
  await expect(band).toContainText('UK');
  await expect(band.locator('.xbasis.measured').first()).toBeVisible();
  const uk = await measuredValues();

  // Both markets export an average order value, and they are different numbers.
  // One blended figure reused across the toggle is the failure this catches.
  const shared = Object.keys(us).filter((k) => k in uk);
  expect(shared.length, 'no metric is measured in both markets, so the toggle proves nothing').toBeGreaterThan(0);
  for (const key of shared) expect(uk[key], `${key} did not change with the market`).not.toBe(us[key]);

  // A market the brand has no export for is not offered at all, rather than
  // being offered and then filled with the previous market's figures.
  for (const code of ['GLOBAL', 'IN']) {
    await expect(
      page.locator(`#mktToggle button[data-mkt="${code}"]`),
      `${code} is selectable but has no export behind it`,
    ).toBeHidden();
  }
});

test('the band degrades honestly when the growth model cannot be read', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.route('**/api/brain**', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.goto(base + '/data-analysis.html', { waitUntil: 'load' });

  const band = page.locator('#growthBand');
  await expect(band).toContainText('growth model could not be loaded');
  // No invented substitute vocabulary appears in its place.
  await expect(band.locator('.xkpi-cell')).toHaveCount(0);
  expect(appErrors(errors)).toEqual([]);
});
