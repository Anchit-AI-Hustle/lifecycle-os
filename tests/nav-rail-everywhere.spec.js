/**
 * The LHS rail renders on EVERY app page, and it renders before anything can
 * hold it up.
 * ---------------------------------------------------------------------------
 * THE DEFECT, in the user's words: "lhs missing in most of the pages". Live
 * screenshots showed /research and /brain with no rail at all - the content
 * starting at the left edge - while /studio, /onboarding and /retention-playbook
 * showed it. All five include auth.js. Nothing in the two pages was wrong: a
 * sweep of every page in the repo with the stubbed SDK rendered the rail on all
 * of them in under 300 ms.
 *
 * WHAT WAS ACTUALLY WRONG was found by measuring, not by reading. The live
 * deployment points at a PAUSED Supabase project (see CLAUDE.md, 2026-09-12),
 * and a browser that was signed in before the pause still holds that session in
 * localStorage, expired. Measured on 2026-09-15 with the REAL supabase-js
 * (2.116.0) against a host that does not resolve:
 *
 *     no stored session       rail after   150-270 ms
 *     expired stored session  rail after 25616-25835 ms   (research, smart-brain,
 *                                                          retention-playbook alike)
 *
 * The SDK retries the token refresh with exponential backoff for its whole 30 s
 * auto-refresh window before giving up, and auth.js awaited getSession() BEFORE
 * calling injectTopbar(). So for ~25 s every page had no navigation, and which
 * pages "had" a rail was decided by when the screenshot was taken. A timing
 * defect looks exactly like a page defect in a screenshot and like nothing at
 * all in the source.
 *
 * THE FIX (auth.js): the guest rail mounts synchronously from the static NAV
 * model, before the config fetch, the SDK load, the session lookup and the
 * reachability probe; only the user block at its foot depends on the session,
 * and setRailUser() swaps that block IN PLACE when the session arrives.
 * Measured again over all 50 swept pages (ms from navigation start to the
 * rail's first non-zero rect, real SDK):
 *
 *                                   before              after
 *     live backend, signed out      143-725 (med 333)    58-581 (med 155)
 *     dead host, expired session    25593-28327          62-447 (med 144)
 *     ms after auth.js started      94-500 (med 237)     18-254 (med 42)
 *
 * The "before / live" row is the second user report ("lhs menu loads after too
 * long"): even with a healthy backend the rail sat behind the config fetch,
 * the 218 KB SDK parse and getSession(), a quarter second on every page.
 *
 * WHAT THIS FILE GATES
 *   1. The rail renders on every app page, in both configurations the
 *      signed-out sweep uses (no backend; live backend, signed out), and it is
 *      REALLY there: a non-zero rect at x=0, position:fixed, no ancestor that
 *      would turn it into a containing block (transform / filter /
 *      backdrop-filter / perspective / contain - the 2026-08-25 finding), and
 *      elementFromPoint at its centre resolves inside it, so nothing covers it.
 *      Every page must also finish with zero pageerror: a page whose JS died is
 *      a page whose features are silently gone.
 *   2. The rail does not wait for the session. A getSession() that NEVER
 *      resolves still yields a rail; a session that resolves late still lands
 *      its user chip in the rail that is already there.
 *   3. Every inline <script> in every HTML file parses as the kind it declares
 *      (classic or module). CI's syntax check walks `git ls-files '*.js'` and
 *      cannot see a script block inside an HTML page; an unescaped apostrophe
 *      in one of those kills that page's JS silently (2026-08-30).
 *   4. The exclusion list is explicit, every entry names its reason, and every
 *      .html a vercel.json rewrite lands on is either swept or excluded - so a
 *      new app page cannot ship without the shell unnoticed.
 *
 * Mutations verified (each restores a defect and fails this file):
 *   - auth.js: remove the early injectTopbar(null) in init(), i.e. put the
 *     await back in front of the render                            -> the stalled-config
 *                                                                     and pending-session tests fail
 *   - research.html: `body{transform:translateZ(0)}`               -> sweep fails (containing block)
 *   - research.html: `#lifecycle-nav .lnav-side{display:none!important}`
 *                                                                  -> sweep fails (no rect, display none)
 *     (!important on purpose: at equal specificity a page rule loses to the
 *     rail's own <style>, inserted later in source order, so a plain
 *     display:none never hid anything - the first mutation run proved that
 *     by passing.)
 *   - an unescaped apostrophe inside one inline script            -> parse test fails
 *
 * Run: npx playwright test tests/nav-rail-everywhere.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

/* ═══ which pages, and which are deliberately bare ════════════════════════ */

/**
 * Pages that deliberately do NOT carry the shell, each with the reason. A page
 * on this list is asserted to exist, so the list cannot quietly rot; a page
 * NOT on this list is swept and must show the rail.
 */
const EXCLUDED = {
  // Rendered artefacts: outputs the app produces or previews, never surfaces of
  // the app. Several are loaded inside <iframe> previews (template-gallery,
  // data/website-designs.json), where a rail inside every frame would be wrong.
  'knickgasm-grail-drop-presell-v5-variantA.html': 'rendered landing artefact, previewed in a frame',
  'knickgasm-grail-drop-presell-v5-variantB.html': 'rendered landing artefact, previewed in a frame',
  'knickgasm-lifecycle-campaign-from-the-30-d-us-variantB.html': 'rendered mailer artefact',
  'coffee-collection-landing-no-agent.html': 'rendered landing artefact (data/website-designs.json preview)',
  'coffee-collection-landing-with-agent.html': 'rendered landing artefact (data/website-designs.json preview)',
  'landing-pages/final/knickgasm-grail-drop-3d.html': 'rendered landing artefact behind /lp/best-3d, framed by /templates',
  'landing-pages/final/knickgasm-uk-grail-drop-agent-best.html': 'rendered landing artefact behind /lp/best, framed by /templates',
  'landing-pages/final/knickgasm-uk-presell-grail-drop-v1.html': 'rendered landing artefact behind /lp/grail-drop-v1, framed by /templates',
  'landing-pages/final/knickgasm-uk-presell-grail-drop-v2.html': 'rendered landing artefact behind /lp/grail-drop-v2, framed by /templates',
  'landing-pages/final/lp_all_in_one_agent_v2.html': 'rendered landing artefact, framed by /templates',
  'storefront-3d.html': 'full-bleed WebGL storefront WEBSITE (/3d), framed by /templates; its own header says why it carries no auth.js',
  'campaign.html': 'campaign-variant renderer (/c/:theme/:variant) that document.write()s the artefact over itself; its own header says why',
  'lifecycle-usa-d2c-dashboard.html': 'embedded inside /data-analysis?tab=review as an <iframe>; its standalone routes redirect there',
  // Retired routes: meta-refresh / location.replace stubs that vercel.json also
  // redirects, so no visitor ever sees them rendered.
  'ad-campaigns-master.html': 'redirect stub; vercel.json redirects it to /data-analysis?tab=live-ads',
  'data-analysis-contrast.html': 'redirect stub; vercel.json redirects it to /data-analysis',
  'mailer-discovery.html': 'redirect stub (location.replace) to /competitor-benchmarking.html#discover',
  // Documents, not app surfaces.
  'privacy.html': 'legal page, bare by rule (auth.js isOpenPage names it)',
  'terms.html': 'legal page, bare by rule (auth.js isOpenPage names it)',
  'styleguide.html': 'isolated 3D style-guide specimens; bare by instruction',
  'docs/deck.html': 'full-screen slide deck (/deck): body{overflow:hidden}, a rail would cover the slide',
  'docs/prd-deck.html': 'full-screen slide deck (/prd-deck): same',
  'playbook/index.html': 'static playbook sub-site (index + dossiers + features); its in-app counterpart playbook.html at /playbook-single carries the shell',
  'ads-masterclass.html': 'unrouted lesson document: no rewrite, no rail row, no link anywhere in the app',
};

/** Every page a visitor can reach: root HTML files plus every .html a rewrite lands on. */
function allPages() {
  const set = new Set();
  for (const f of execSync("git ls-files '*.html'", { cwd: ROOT }).toString().trim().split('\n')) {
    if (f && !f.includes('/') && !f.startsWith('_')) set.add(f);
  }
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  for (const r of vercel.rewrites || []) {
    const d = String(r.destination).split('?')[0];
    if (d.endsWith('.html') && fs.existsSync(path.join(ROOT, d.replace(/^\//, '')))) set.add(d.replace(/^\//, ''));
  }
  return [...set].sort();
}
const ALL = allPages();
const SWEPT = ALL.filter((f) => !EXCLUDED[f]);

/* ═══ harness: a real host, both backend configurations ═══════════════════ */

const NO_BACKEND = { ok: true };
const WITH_BACKEND = { supabase: { url: 'https://live.supabase.co', anonKey: 'anon' } };

/**
 * Same shape as tests/signed-out-usable.spec.js: app.example.test so auth.js
 * takes its production path (localhost is a dev preview and never gates), files
 * answered from the repo, /api answered with an empty workspace, the SDK
 * stubbed. `sdk` lets a test hand in its own auth stub.
 */
async function open(page, file, { config, reachable = true, sdk, configDelayMs = 0 } = {}) {
  const errors = [], consoleErrors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  // Timing capture, installed before any page script: WHEN auth.js began to
  // run (it assigns window.__LifecycleAuthBooted on its first line, so a
  // setter records the moment) and when `.lnav-side` first had a non-zero
  // rect (a MutationObserver, so the number is the DOM insertion, not a poll).
  await page.addInitScript(() => {
    window.__t = { authRun: null, railPaint: null };
    Object.defineProperty(window, '__LifecycleAuthBooted', {
      configurable: true,
      get() { return undefined; },
      set(v) {
        window.__t.authRun = performance.now();
        Object.defineProperty(window, '__LifecycleAuthBooted', { value: v, writable: true, configurable: true });
      },
    });
    const mo = new MutationObserver(() => {
      if (window.__t.railPaint != null) return;
      const s = document.querySelector('#lifecycle-nav .lnav-side');
      if (!s) return;
      const r = s.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { window.__t.railPaint = performance.now(); mo.disconnect(); }
    });
    // Observe `document`, NOT documentElement: an init script runs before
    // <html> exists, so documentElement is null here and observe() throws -
    // silently, after the setter above was already installed, which is how the
    // first version of this capture reported auth.js running and the rail
    // never painting on every page.
    mo.observe(document, { childList: true, subtree: true });
  });
  await page.addInitScript((custom) => {
    // eslint-disable-next-line no-new-func
    // `custom` is the SOURCE of a factory; evaluate it, then call it.
    const auth = custom ? (new Function('return (' + custom + ')')())() : {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async () => ({ error: null }),
      signOut: async () => ({}),
    };
    window.supabase = { createClient: () => ({ auth }) };
  }, sdk ? sdk.toString() : null);
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    if (/\/auth\/v1\/health/.test(route.request().url())) {
      return reachable
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        : route.abort('addressunreachable');
    }
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(route.request().url());
    return route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: esm
        ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});'
          + 'export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};',
    });
  });
  await page.route('http://app.example.test/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }),
  }));
  const configAnswered = { at: null };
  await page.route(/\/api\/public-config/, async (route) => {
    if (configDelayMs) await new Promise((r) => setTimeout(r, configDelayMs));
    configAnswered.at = Date.now();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config || NO_BACKEND) });
  });
  await page.goto('http://app.example.test/' + file, { waitUntil: 'domcontentloaded' });
  return { errors, consoleErrors, configAnswered };
}

/**
 * How long the rail may take to paint AFTER auth.js starts executing, on any
 * page, in any configuration. The mount is synchronous inside init() - the
 * same task as auth.js's own boot, before its first await - so the delta is
 * the cost of running auth.js's top level (the NAV model), building ~200 nodes
 * of rail markup, and the forced layout that gives it a rect. Measured over all
 * 50 swept pages x 2 configurations with the REAL supabase-js (2026-09-15):
 * median 42 ms, max 254 ms (a cold first page). Before the fix the same delta
 * was 94-500 ms (median 237) with a healthy backend - the config fetch, the SDK
 * parse and getSession() all sat in front of the render - and 25.5-27.9 s
 * with an expired session against a dead host. 500 ms is 2x the worst measured
 * synchronous mount, so a loaded 2-core CI runner does not turn this gate into
 * noise, and it is still fifty times under the defect. It is deliberately NOT
 * a network budget: the stalled-config test below proves the rail is up while
 * the first network request is still unanswered, which no budget could.
 */
const PAINT_BUDGET_MS = 500;

/** Measure the rail as RENDERED. Every field is read from layout, not from the source. */
async function measureRail(page, timeoutMs = 8000) {
  await page.waitForFunction(() => document.querySelector('#lifecycle-nav .lnav-side'), null, { timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const out = { nav: !!document.getElementById('lifecycle-nav'), side: false, problems: [] };
    const side = document.querySelector('#lifecycle-nav .lnav-side');
    if (!out.nav) { out.problems.push('no #lifecycle-nav mounted'); return out; }
    if (!side) { out.problems.push('no .lnav-side inside #lifecycle-nav'); return out; }
    out.side = true;
    const r = side.getBoundingClientRect();
    const s = getComputedStyle(side);
    out.rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    if (s.position !== 'fixed') out.problems.push('position is ' + s.position + ', not fixed');
    if (r.width < 100 || r.height < 100) out.problems.push('rail has no size: ' + JSON.stringify(out.rect));
    if (Math.abs(r.left) > 2 || Math.abs(r.top) > 2) out.problems.push('rail is not anchored at the viewport corner: ' + JSON.stringify(out.rect));
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) out.problems.push(`rail hidden (display=${s.display} visibility=${s.visibility} opacity=${s.opacity})`);
    // An ancestor with any of these becomes the containing block for a fixed
    // descendant, and the rail stops being anchored to the viewport. The CSS
    // is valid; only rendering shows it (the 2026-08-25 finding).
    for (let el = side.parentElement; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const bad = [];
      if (cs.transform !== 'none') bad.push('transform');
      if (cs.filter !== 'none') bad.push('filter');
      const bf = cs.backdropFilter || cs.webkitBackdropFilter;
      if (bf && bf !== 'none') bad.push('backdrop-filter');
      if (cs.perspective !== 'none') bad.push('perspective');
      if (/paint|layout|strict|content/.test(cs.contain || '')) bad.push('contain');
      if (/transform|filter|perspective/.test(cs.willChange || '')) bad.push('will-change');
      if (bad.length) out.problems.push('ancestor <' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '> creates a containing block: ' + bad.join('+'));
    }
    if (r.width > 0 && r.height > 0) {
      const cx = r.left + r.width / 2;
      const cy = Math.min(r.top + r.height / 2, innerHeight / 2);
      const at = document.elementFromPoint(cx, cy);
      if (!at || !side.contains(at)) {
        out.problems.push('rail is covered at its centre by ' + (at ? '<' + at.tagName.toLowerCase() + (at.id ? '#' + at.id : '') + (at.className ? '.' + String(at.className).split(' ')[0] : '') + '>' : 'nothing'));
      }
    }
    const t = window.__t || {};
    out.authRun = t.authRun == null ? null : Math.round(t.authRun);
    out.railPaint = t.railPaint == null ? null : Math.round(t.railPaint);
    return out;
  });
}

const HARNESS_NOISE = /ResizeObserver|Failed to fetch|NetworkError|net::ERR/i;

/* ═══ 0. the page list is real ════════════════════════════════════════════ */

test('the sweep covers a real page list, and every excluded page exists for the reason given', () => {
  // A sweep over nothing passes everything.
  expect(SWEPT.length, 'too few app pages to sweep').toBeGreaterThan(45);
  for (const f of ['index.html', 'research.html', 'smart-brain.html', 'template-gallery.html', 'premium-experience.html',
    'lifecycle-usa-july-calendar-mailer-studio.html', 'lifecycle_mailer_architect_v34.html', 'onboarding.html']) {
    expect(SWEPT, `${f} is not in the sweep`).toContain(f);
  }
  // An exclusion for a file that no longer exists is a stale exclusion, and a
  // stale list is how the next bare page slips in beside it.
  const gone = Object.keys(EXCLUDED).filter((f) => !fs.existsSync(path.join(ROOT, f)));
  expect(gone, 'EXCLUDED names pages that do not exist').toEqual([]);
  for (const [f, why] of Object.entries(EXCLUDED)) expect(why.length, `${f} has no reason`).toBeGreaterThan(20);
  // Every .html a rewrite lands on is accounted for, one way or the other.
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const landed = (vercel.rewrites || []).map((r) => String(r.destination).split('?')[0]).filter((d) => d.endsWith('.html')).map((d) => d.replace(/^\//, ''));
  const unaccounted = landed.filter((f) => fs.existsSync(path.join(ROOT, f)) && !SWEPT.includes(f) && !EXCLUDED[f]);
  expect(unaccounted, 'rewrite destinations neither swept nor excluded').toEqual([]);
});

/* ═══ 1. the rail is rendered, anchored, uncovered, on every app page ══════ */

test('EVERY app page renders the rail, anchored and uncovered, in both backend configurations, with no page errors', async ({ browser }) => {
  test.setTimeout(900_000);
  const cases = [
    ['no backend', { config: NO_BACKEND }],
    ['live backend, signed out', { config: WITH_BACKEND, reachable: true }],
  ];
  const failures = [];
  const rows = [];
  let measured = 0;
  for (const [label, opts] of cases) {
    for (const f of SWEPT) {
      // A fresh context per page: no route or storage state carried between
      // measurements, so a page cannot pass on the strength of the one before.
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const { errors, consoleErrors } = await open(page, f, opts);
      const m = await measureRail(page);
      await ctx.close();
      measured++;
      const real = errors.filter((e) => !HARNESS_NOISE.test(e));
      const problems = [...m.problems];
      if (real.length) problems.push('pageerror: ' + real[0].slice(0, 200));
      // The paint budget: from auth.js starting to the rail having a rect.
      // "lhs menu loads after too long" was this number at 25.7 s under a
      // stale session; it must be a synchronous mount, whatever the network does.
      if (m.authRun == null) problems.push('auth.js never ran');
      else if (m.railPaint == null) problems.push('rail never painted');
      else if (m.railPaint - m.authRun > PAINT_BUDGET_MS) problems.push(`rail painted ${m.railPaint - m.authRun} ms after auth.js ran (budget ${PAINT_BUDGET_MS} ms)`);
      const timing = `auth.js@${String(m.authRun).padStart(5)}ms rail@${String(m.railPaint).padStart(5)}ms (+${m.railPaint != null && m.authRun != null ? m.railPaint - m.authRun : '?'})`;
      rows.push(`${problems.length ? 'FAIL' : 'ok  '} ${label.padEnd(24)} ${f.padEnd(58)} ${timing}  ${problems.join(' | ')}${consoleErrors.length ? '  [console.error x' + consoleErrors.length + ': ' + consoleErrors[0].slice(0, 80) + ']' : ''}`);
      if (problems.length) failures.push(`${f} (${label}): ${problems.join(' | ')}`);
    }
  }
  console.log('\nrail sweep (page -> rail ok / cause):\n' + rows.join('\n') + '\n');
  expect(measured, 'the sweep measured nothing').toBe(SWEPT.length * cases.length);
  expect(failures, `pages without a usable rail:\n  ${failures.join('\n  ')}`).toEqual([]);
});

/* ═══ 2. the rail does not wait for the network ═══════════════════════════ */

test('the rail is up while /api/public-config is still stalled, on every kind of page', async ({ browser }) => {
  test.setTimeout(120_000);
  // The config fetch is the FIRST await in init(), before the SDK, the session
  // and the reachability probe. Stall it for 5 s: the rail must already be
  // there, with the fetch still unanswered when the rail is measured. Five
  // pages of deliberately different weight - the 734 KB Studio, a Tailwind
  // CDN page, the brain console, a template-driven page, the new gallery.
  for (const f of ['lifecycle_mailer_architect_v34.html', 'research.html', 'smart-brain.html', 'telesuite.html', 'template-gallery.html']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const { configAnswered } = await open(page, f, { config: WITH_BACKEND, reachable: true, configDelayMs: 5000 });
    const m = await measureRail(page, 3000);
    const answered = configAnswered.at != null;
    await ctx.close();
    expect(m.side, `${f}: no rail while the config fetch was stalled: ${m.problems.join(' | ')}`).toBe(true);
    expect(answered, `${f}: the config fetch had already answered, so this measured nothing`).toBe(false);
    expect(m.problems, `${f}`).toEqual([]);
    expect(m.railPaint - m.authRun, `${f}: rail painted ${m.railPaint - m.authRun} ms after auth.js ran`).toBeLessThanOrEqual(PAINT_BUDGET_MS);
  }
});

test('the rail is mounted while getSession() is still pending, even if it never resolves', async ({ page }) => {
  // A getSession() that NEVER resolves: the shape of a stale session against a
  // host that does not answer (measured at ~25.7 s with the real SDK, and open
  // ended under cross-tab lock contention). The rail must not depend on it.
  const sdk = () => ({
    getSession: () => new Promise(() => { window.__sessionStillPending = true; }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithOAuth: async () => ({ error: null }),
    signOut: async () => ({}),
  });
  const { errors } = await open(page, 'research.html', { config: WITH_BACKEND, reachable: false, sdk });
  const m = await measureRail(page, 3000);
  expect(m.side, 'no rail while the session lookup was pending: ' + m.problems.join(' | ')).toBe(true);
  expect(m.problems).toEqual([]);
  // ...and the lookup really was still pending when the rail was measured, so
  // this proves the rail did not simply arrive after a fast session.
  expect(await page.evaluate(() => window.__sessionStillPending === true), 'the stub session lookup was never reached').toBe(true);
  expect(await page.evaluate(() => !!document.querySelector('#lifecycle-nav .lnav-signin')), 'the guest rail should offer Sign in').toBe(true);
  expect(errors.filter((e) => !HARNESS_NOISE.test(e))).toEqual([]);
});

test('a session that resolves late lands its user chip in the rail that is already mounted', async ({ page }) => {
  const sdk = () => ({
    getSession: () => new Promise((resolve) => setTimeout(() => resolve({
      data: { session: { user: { id: 'u1', email: 'late@example.test', user_metadata: { name: 'Late Session' } } } },
    }), 1500)),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithOAuth: async () => ({ error: null }),
    signOut: async () => ({}),
  });
  await open(page, 'smart-brain.html', { config: WITH_BACKEND, reachable: true, sdk });
  const early = await measureRail(page, 1000);
  expect(early.side, 'no rail before the session resolved').toBe(true);
  // Remember the mounted rail so the swap can be shown to be in place.
  await page.evaluate(() => { window.__railBefore = document.querySelector('#lifecycle-nav .lnav-side'); });
  await expect(page.locator('#lifecycle-nav .lnav-uname')).toHaveText('Late Session', { timeout: 6000 });
  await expect(page.locator('#lifecycle-nav .lnav-signin')).toHaveCount(0);
  expect(await page.evaluate(() => window.__railBefore === document.querySelector('#lifecycle-nav .lnav-side')),
    'the rail was rebuilt rather than updated in place').toBe(true);
  expect(await page.evaluate(() => (window.LifecycleAuth || {}).internal)).toBe(true);
});

/* ═══ 3. every inline script parses ═══════════════════════════════════════ */

test('every inline <script> in every HTML file parses as the kind it declares', () => {
  // CI's syntax check walks `git ls-files '*.js'`; a script BLOCK inside an
  // HTML page is invisible to it, and a parse error there kills the whole
  // block silently - the page renders and none of its JS runs (2026-08-30,
  // when an unescaped apostrophe did exactly that to /design-intelligence).
  // This is a claim about the FILES, so it reads the files; the rendered
  // half of that class (a page whose JS died) is test 1's zero-pageerror rule.
  const files = execSync("git ls-files '*.html'", { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);
  const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module', 'text/ecmascript', 'application/ecmascript']);
  let blocks = 0;
  const bad = [];
  for (const f of files) {
    const doc = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let m;
    while ((m = re.exec(doc))) {
      const attrs = m[1] || '';
      if (/\bsrc\s*=/.test(attrs)) continue;
      const type = ((attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || '').toLowerCase();
      if (!JS_TYPES.has(type)) continue;     // JSON, templates, importmaps are not scripts
      const inline = m[2];
      if (!inline.trim()) continue;
      blocks++;
      const line = doc.slice(0, m.index).split('\n').length;
      if (type === 'module') {
        // A module may import/export, which no Function body may; node parses it as ESM.
        const tmp = path.join(os.tmpdir(), `inline-${process.pid}-${blocks}.mjs`);
        fs.writeFileSync(tmp, inline);
        const r = spawnSync(process.execPath, ['--check', tmp]);
        fs.unlinkSync(tmp);
        if (r.status !== 0) bad.push(`${f}:${line} [module] ${String(r.stderr).split('\n').filter(Boolean).slice(0, 3).join(' | ')}`);
      } else {
        // A classic script is sloppy-mode by default, as a Function body is.
        try { new Function(inline); } catch (e) { bad.push(`${f}:${line} [classic] ${e.name}: ${e.message}`); } // eslint-disable-line no-new-func
      }
    }
  }
  expect(blocks, 'found almost no inline scripts, so this proves nothing').toBeGreaterThan(100);
  expect(bad, `inline scripts that do not parse:\n  ${bad.join('\n  ')}`).toEqual([]);
});
