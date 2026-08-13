// Generation, then display: the rows a generate/sync/approve action produces
// must appear WITHOUT a manual reload.
//
// The bug this guards against was specific and silent. `Run Daily Sync` read
// `data.plan` from the response, but three real server answers on that exact
// route come back HTTP 200 with ok:true and no `plan` key: the router's refusal
// of a request it cannot attribute to a workspace, the planner's answer for a
// brand with no catalogue, and any thrown failure whose message went into a
// <pre> at the very bottom of the page. In all three the table kept its previous
// content and the page said nothing, so a click that did something and a click
// that did nothing looked identical.
//
// So every assertion here is of the same shape: after the action, the screen is
// in exactly ONE of three states, and never the state it was in before.
//
// Run: npx playwright test tests/generation-display.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

let server;
let base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');

    // Anything under /api/ that a test has not routed itself answers with an
    // inert 200. A 404 would make brand-context hold every later /api/ call
    // until its 8s deadline, which would turn these tests into a timing test.
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

/** A calendar slot with every field the table reads. Dates land inside the
 *  page's default 7-day view, which otherwise filters them all out. */
function slot(n, over) {
  return Object.assign({
    id: 'slot-' + n,
    date: iso(n),
    market: n % 2 ? 'UK' : 'US',
    cohort: { name: 'Cohort ' + n, size: 1000 + n },
    objective: 'Objective ' + n,
    heroProduct: { title: 'Hero ' + n },
    channels: ['email'],
    confidence: 0.7,
    status: 'tentative',
    rationale: 'Reason ' + n,
  }, over || {});
}

/** Serve third-party CDNs locally so a page never waits on a network this box
 *  does not have. Tailwind is stubbed rather than blocked because these pages
 *  set `tailwind.config` inline, and a blocked script would fail the page-error
 *  assertion for a reason that has nothing to do with what is under test. */
async function isolate(page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: 'window.tailwind = window.tailwind || {}; window.Papa = window.Papa || { unparse: () => "" };',
  }));
}

// ── /brain: the reported failure ────────────────────────────────────────────

/** Opens smart-brain.html with the plan read stubbed, and the auto-sync that
 *  normally fires on first open suppressed so each test drives its own click. */
async function openBrain(page, { planResponse, syncResponse, approveResponse } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await isolate(page);
  await page.addInitScript(() => { try { sessionStorage.setItem('sb.autogen', '1'); } catch (_) {} });

  await page.route('**/api/calendar**', async (route) => {
    const url = route.request().url();
    const body = url.includes('smart-brain-sync-daily') ? syncResponse
      : url.includes('smart-brain-approve') ? approveResponse
        : url.includes('smart-brain-plan') ? planResponse
          : { ok: true };
    if (typeof body === 'function') return body(route);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body || { ok: true }) });
  });

  await page.goto(base + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
  return errors;
}

test('a sync that returns rows renders them with no reload', async ({ page }) => {
  const errors = await openBrain(page, {
    planResponse: { ok: true, mode: 'db-linked', stored: false, entries: [] },
    syncResponse: {
      ok: true, mode: 'db-linked', synced_at: new Date().toISOString(),
      insights: ['Insight one'], changes: [{ kind: 'created', detail: 'new slot' }],
      plan: [slot(0), slot(1)],
    },
  });

  // Starting point: nothing in the table.
  await expect(page.locator('#plan tr.planrow')).toHaveCount(0);

  await page.locator('#sync').click();

  // The rows appear from the sync response itself. No reload anywhere in this
  // test, which is the whole point.
  await expect(page.locator('#plan tr.planrow')).toHaveCount(2);
  await expect(page.locator('#plan')).toContainText('Objective 0');
  await expect(page.locator('#plan')).toContainText('Objective 1');

  // The counters move with the rows. They used to be written after an early
  // return, so an empty result left them showing the page-load placeholder.
  await expect(page.locator('#entries')).toHaveText('2');
  await expect(page.locator('#mode')).toHaveText('DB-linked');

  await expect(page.locator('#syncstate')).toHaveClass(/\bok\b/);
  await expect(page.locator('#syncstate')).toContainText('Sync complete');

  expect(errors).toEqual([]);
});

test('a sync that generates nothing says so, and says why', async ({ page }) => {
  const note = '[DATA REQUIRED BEFORE LAUNCH: catalogue and analytics, this workspace, all] '
    + 'Connect the brand catalogue in brand setup, then run Daily Sync.';
  const errors = await openBrain(page, {
    planResponse: { ok: true, mode: 'db-linked', stored: false, entries: [] },
    // The planner's real empty-brand shape: ok, no changes, and a note.
    syncResponse: {
      ok: true, mode: 'db-linked', synced_at: new Date().toISOString(),
      changes: [], insights: [], entries: [], plan: [], note,
    },
  });

  await page.locator('#sync').click();

  // Explicit empty, carrying the server's own reason. Not the pre-sync prompt
  // to click the button the user has just clicked.
  await expect(page.locator('#plan .planempty')).toBeVisible();
  await expect(page.locator('#plan .planempty')).toContainText('Nothing was generated');
  await expect(page.locator('#plan .planempty')).toContainText('DATA REQUIRED BEFORE LAUNCH');
  await expect(page.locator('#plan')).not.toContainText('No plan yet');

  await expect(page.locator('#syncstate')).toHaveClass(/\bempty\b/);
  await expect(page.locator('#syncstate')).toContainText('DATA REQUIRED BEFORE LAUNCH');
  await expect(page.locator('#entries')).toHaveText('0');

  // Zero fabrication: an empty result renders no rows at all.
  await expect(page.locator('#plan tr.planrow')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('a failed sync shows the failure instead of the rows it did not replace', async ({ page }) => {
  const errors = await openBrain(page, {
    // Loaded with real rows first, so there is genuine stale content to leave.
    planResponse: { ok: true, mode: 'local-fallback', stored: true, entries: [slot(0), slot(1)] },
    syncResponse: (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'A server error has occurred' }),
  });

  await page.locator('#refresh').click();
  await expect(page.locator('#plan tr.planrow')).toHaveCount(2);

  await page.locator('#sync').click();

  await expect(page.locator('#syncstate')).toHaveClass(/\berr\b/);
  await expect(page.locator('#syncstate')).toContainText('Daily Sync failed');
  await expect(page.locator('#plan .planerr')).toBeVisible();
  await expect(page.locator('#plan .planerr')).toContainText('could not be built');
  // The rows the sync failed to refresh must NOT still be sitting there looking
  // like the result of the click.
  await expect(page.locator('#plan tr.planrow')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('a 200 that refuses the request is reported, not rendered as a successful sync', async ({ page }) => {
  const note = 'This request arrived without an active workspace, so no data is returned.';
  const errors = await openBrain(page, {
    planResponse: { ok: true, mode: 'db-linked', stored: false, entries: [] },
    // The router's real refusal shape: HTTP 200, ok:true, an error code.
    syncResponse: {
      ok: true, mode: 'unscoped', stored: false, entries: [], plan: [],
      changes: [], insights: [], error: 'workspace_unresolved', note,
    },
  });

  await page.locator('#sync').click();

  await expect(page.locator('#syncstate')).toHaveClass(/\bempty\b/);
  await expect(page.locator('#syncstate')).toContainText('without an active workspace');
  await expect(page.locator('#plan .planempty')).toContainText('without an active workspace');
  // The old code printed this instead, which is affirmatively false.
  await expect(page.locator('#changes')).not.toContainText('already in sync with the data');

  expect(errors).toEqual([]);
});

test('approving a row updates that row in place', async ({ page }) => {
  const errors = await openBrain(page, {
    planResponse: { ok: true, mode: 'local-fallback', stored: true, entries: [slot(0)] },
    approveResponse: { ok: true, persisted: true, campaign: { campaign_id: 'camp-42' } },
  });

  await page.locator('#refresh').click();
  await expect(page.locator('#plan tr.planrow')).toHaveCount(1);
  await expect(page.locator('#plan .st.tentative')).toBeVisible();

  await page.locator('#rev-0 button.ok').click();

  await expect(page.locator('#plan .st.approved')).toBeVisible();
  await expect(page.locator('#plan a[href^="/lp/camp-42"]')).toBeVisible();
  await expect(page.locator('#syncstate')).toHaveClass(/\bok\b/);
  await expect(page.locator('#syncstate')).toContainText('Approved');

  expect(errors).toEqual([]);
});

test('a failed approve names the failure and leaves the row unapproved', async ({ page }) => {
  const errors = await openBrain(page, {
    planResponse: { ok: true, mode: 'local-fallback', stored: true, entries: [slot(0)] },
    approveResponse: { ok: false, error: 'no text provider is connected' },
  });

  await page.locator('#refresh').click();
  await page.locator('#rev-0 button.ok').click();

  await expect(page.locator('#syncstate')).toHaveClass(/\berr\b/);
  await expect(page.locator('#syncstate')).toContainText('no text provider is connected');
  // Not silently promoted to approved.
  await expect(page.locator('#plan .st.approved')).toHaveCount(0);

  expect(errors).toEqual([]);
});

// ── /plan (calendar.html) ───────────────────────────────────────────────────

async function openCalendar(page, generateResponse) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await isolate(page);
  await page.route('**/api/calendar**', (route) => {
    if (typeof generateResponse === 'function') return generateResponse(route);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(generateResponse) });
  });
  await page.goto(base + '/calendar.html', { waitUntil: 'domcontentloaded' });
  return errors;
}

test('the 30-day planner renders its generated rows with no reload', async ({ page }) => {
  const plan = [0, 1, 2].map((n) => ({
    id: 'cal-' + n, date: iso(n), send_hour_utc: 9, market: 'US', segment: 'Loyal',
    segment_size: 1200, content_type: 'promo', archetype: 'hero-led-editorial',
    hero_product: 'Hero ' + n, subject_hint: 'Subject ' + n, rationale: 'Because ' + n,
  }));
  const errors = await openCalendar(page, { ok: true, plan, meta: { markets: ['US'] } });

  await page.locator('#btnGenerate').click();

  await expect(page.locator('#planTable tr[data-id]')).toHaveCount(3);
  await expect(page.locator('#planTable')).toContainText('Subject 1');

  expect(errors).toEqual([]);
});

test('the 30-day planner states an empty generation rather than showing the old plan', async ({ page }) => {
  const errors = await openCalendar(page, (route) => {
    const body = route.request().postData() || '';
    // First click returns rows, second returns none, so the test proves the
    // rows are actually CLEARED rather than merely absent from the start.
    const empty = body.includes('"capacity_per_market_per_week"') && page.__second;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(empty ? { ok: true, plan: [] } : {
        ok: true,
        plan: [{ id: 'c0', date: iso(0), send_hour_utc: 9, market: 'US', segment: 'Loyal', segment_size: 10, content_type: 'promo', archetype: 'a', hero_product: 'H', subject_hint: 'S', rationale: 'r' }],
      }),
    });
  });

  await page.locator('#btnGenerate').click();
  await expect(page.locator('#planTable tr[data-id]')).toHaveCount(1);

  page.__second = true;
  await page.locator('#btnGenerate').click();

  await expect(page.locator('#planTable tr[data-id]')).toHaveCount(0);
  await expect(page.locator('#planMeta')).toContainText('returned no entries');
  await expect(page.locator('#planTable')).toContainText('No plan entries');

  expect(errors).toEqual([]);
});

test('the 30-day planner names a failed generation and drops the stale rows', async ({ page }) => {
  const errors = await openCalendar(page, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    // The router's refusal: 200, ok:true, an error code.
    body: JSON.stringify({ ok: true, error: 'workspace_unresolved', note: 'No active workspace for this request.' }),
  }));

  await page.locator('#btnGenerate').click();

  await expect(page.locator('#planMeta')).toContainText('Failed');
  await expect(page.locator('#planMeta')).toContainText('No active workspace');
  await expect(page.locator('#planTable tr[data-id]')).toHaveCount(0);

  expect(errors).toEqual([]);
});

// ── /lifecycle-calendar ─────────────────────────────────────────────────────

test('the cohort calendar renders generated sends, then states an empty regeneration', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await isolate(page);

  let empty = false;
  await page.route('**/api/calendar**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(empty
      ? { ok: true, plan: [], start_date: iso(0), days: 30, cadence_per_week: 2, total_sends_planned: 0 }
      : {
        ok: true, start_date: iso(0), days: 30, cadence_per_week: 2, total_sends_planned: 1, persisted: false,
        plan: [{ id: 'lc0', date: iso(1), cohort_key: 'non_buyers_non_engagers', cohort_label: 'A', play_key: 'p', product_type: 't', hero_product: 'H', subject_hint: 'Subject A', rationale: 'r' }],
      }),
  }));
  await page.goto(base + '/lifecycle-calendar.html', { waitUntil: 'domcontentloaded' });

  await page.locator('#btnGenerate').click();
  await expect(page.locator('#planTable tr[data-id]')).toHaveCount(1);

  empty = true;
  await page.locator('#btnGenerate').click();

  await expect(page.locator('#planTable tr[data-id]')).toHaveCount(0);
  await expect(page.locator('#planMeta')).toContainText('planned 0 sends');
  await expect(page.locator('#planTable')).toContainText('No sends were planned');

  expect(errors).toEqual([]);
});

// ── /social ─────────────────────────────────────────────────────────────────

test('a social run that produces no drafts explains itself', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await isolate(page);
  await page.route('**/api/brain**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, posts: [], trace: [], ms: 120, persistence: { persisted: false, reason: 'Supabase not configured' } }),
  }));
  await page.goto(base + '/social-media.html', { waitUntil: 'domcontentloaded' });

  await page.locator('#runBtn').click();

  await expect(page.locator('#cards .empty')).toContainText('produced no drafts');
  await expect(page.locator('#cards .empty')).toContainText('Supabase not configured');

  expect(errors).toEqual([]);
});

// ── /ads ────────────────────────────────────────────────────────────────────

test('an unreadable plan on the ads page reads as an error, not as an empty plan', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await isolate(page);
  await page.route('**/api/brain**', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'brain unavailable' }),
  }));
  await page.goto(base + '/ad-campaigns.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#ad-plan-empty')).toContainText('could not be read');
  await expect(page.locator('#ad-plan-empty')).toContainText('brain unavailable');
  // The misleading line this replaces.
  await expect(page.locator('#ad-plan-empty')).not.toContainText('No plan yet');

  expect(errors).toEqual([]);
});

// ── Caching: the layers that could serve a stale read ───────────────────────

test('the service worker never caches an API response', async () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const guard = sw.indexOf("url.pathname.startsWith('/api/')");
  expect(guard, 'sw.js has no /api/ guard at all').toBeGreaterThan(-1);
  // The guard must return before ANY branch that can respond from the cache.
  // Ordering is the whole property: a guard placed after respondWith is inert.
  expect(sw.slice(guard, guard + 120)).toContain('return');
  const firstRespond = sw.indexOf('e.respondWith');
  expect(firstRespond, 'the /api/ guard must precede every cached response path').toBeGreaterThan(guard);
});

test('a brand write clears every cache that could serve the previous brand', async () => {
  const runtime = require('../api/_shared/brand-runtime.js');
  const scope = require('../api/_shared/workspace-scope.js');
  const core = require('../api/_shared/brand-workspace-core.js');

  // The invalidation hooks exist and are callable in every shape the writes use.
  expect(typeof runtime.invalidate).toBe('function');
  expect(typeof scope.invalidate).toBe('function');
  expect(() => runtime.invalidate('ws-1')).not.toThrow();
  expect(() => runtime.invalidate()).not.toThrow();
  expect(() => scope.invalidate({ userId: 'u1', workspaceId: 'ws-1' })).not.toThrow();
  expect(() => scope.invalidate()).not.toThrow();

  // And every write path actually calls them. A cache nobody clears is the same
  // bug as a list nobody refreshes: the screen reports a state the system left.
  const src = fs.readFileSync(path.join(ROOT, 'api/_shared/brand-workspace-core.js'), 'utf8');
  for (const fn of ['saveWorkspace', 'setActive', 'deleteWorkspace', 'importCatalog']) {
    const start = src.indexOf('async function ' + fn);
    expect(start, fn + ' not found').toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body, fn + ' writes without clearing the brand caches').toContain('invalidateBrandCaches');
  }
  // brand-runtime requires brand-workspace-core, so the reverse require has to
  // stay lazy or the cycle breaks the module at load time.
  expect(core).toBeTruthy();
});

test('every empty smart-brain answer carries the same keys as a full one', async () => {
  // The client reads `plan`. An answer that omits it leaves the table untouched,
  // which is exactly how a refused sync came to look like a successful one.
  const router = fs.readFileSync(path.join(ROOT, 'api/calendar.js'), 'utf8');
  const refusal = router.slice(router.indexOf('workspace_unresolved') - 400, router.indexOf('workspace_unresolved') + 200);
  expect(refusal).toContain('plan: []');

  const planner = fs.readFileSync(path.join(ROOT, 'api/_shared/smart-brain-plan.js'), 'utf8');
  const emptyReturn = planner.slice(planner.indexOf('EMPTY_PLAN_NOTE,'), planner.indexOf('EMPTY_PLAN_NOTE,') + 40);
  expect(emptyReturn.length).toBeGreaterThan(0);
  const around = planner.slice(Math.max(0, planner.indexOf('EMPTY_PLAN_NOTE,') - 400), planner.indexOf('EMPTY_PLAN_NOTE,'));
  expect(around).toContain('plan: []');
});
