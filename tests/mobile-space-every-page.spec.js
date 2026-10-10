/**
 * Every app page uses a phone's and a tablet's screen well, in both
 * orientations.
 * ---------------------------------------------------------------------------
 * The operator's words (2026-10-10): "Fix device space usage issues per all
 * dimensions for mobiles". Measured first, in Chromium with device emulation
 * (isMobile, touch, DPR 2), over every app page that loads auth.js
 * (tests/lib/mobile-space-harness.js pages(): the brand-theme enumeration,
 * root *.html + every vercel.json destination, kept when it loads the shell),
 * at eleven sizes - 320x568 360x740 375x667 390x844 412x915 430x932, landscape
 * 667x375 844x390, tablets 768x1024 820x1180 1024x768 - in two states: a
 * mobile+PIN device sign-in with The Times of India preset active (every
 * size), and signed out with the Supabase host not answering (the smallest
 * phone upright and a phone on its side: what differs is the notice bar).
 *
 * WHAT IS MEASURED (all from layout, getComputedStyle and the loaded CSSOM):
 *   page-overflow   document scrollWidth > the viewport
 *   too-wide        an element past the viewport edge that no ancestor scrolls
 *                   or clips (outermost offender only)
 *   text-spill      a box that fits whose unbreakable text runs past the edge
 *                   (its rect looks fine; only scrollWidth shows it)
 *   text-clipped    nowrap text cut by its own box with no ellipsis
 *   chrome          fixed bars + STUCK sticky headers + toasts (>= half the
 *                   width), as a share of the viewport height, at rest and
 *                   scrolled: phone <= 30%, landscape phone <= 40% (content
 *                   keeps 60%), tablet <= 20%
 *   vh-height       a rule that applies here and sets height/min-height >= 60vh
 *                   with no svh/dvh partner for the same selector (100vh is the
 *                   LARGE viewport on mobile browsers: it counts the URL bar)
 *   input-zoom      a text input/select/textarea under 16px (iOS zooms the page)
 *   under-bar       a sticky/fixed element stuck beneath the rail's phone bar
 *   safe-area       on a viewport-fit=cover page, fixed-bar content inside an
 *                   emulated notch / home-indicator inset
 *   overlay-*       the rail drawer and the ? info panel, opened: inside the
 *                   viewport and scrolling inside themselves
 *   small-target    a control under 44x44 (inline links in a sentence exempt)
 *   tiny-text       readable text under 12px
 *   wide-gutter     the first text further than 24px (phone) / 40 (landscape) /
 *                   48 (tablet) from the left edge
 * Every kind must be ZERO except the three RATCHETED ones, which may not RISE
 * above tests/mobile-space-baseline/<page>.json and must be lowered (or the
 * file deleted) when a page improves - the same ratchet as the brand-theme gate.
 * And each page asserts it measured a non-trivial number of elements, text runs,
 * targets and CSS rules at every size: a check that inspects nothing passes
 * everything.
 *
 * Also driven, because one load only measures a first screen: the onboarding
 * wizard's six steps, the Smart Brain plan with a row expanded, and the Mailer
 * Studio's brief and products steps.
 *
 * Mutations verified (each restores one defect and fails this file):
 *   - theme.css: the `:has(table){min-width:0}` line removed (a fixed overflow back)
 *       -> smart-brain.html: page-overflow 12, too-wide 132 (allowed 0)
 *   - auth.js: the rail's `height: 100dvh` removed (100vh alone)
 *       -> smart-brain.html: vh-height 1 (allowed 0), at the tablet that shows the rail
 *   - theme.css: the touch `min-height: 44px` floor for controls removed (tiny targets back)
 *       -> smart-brain.html: small-target 10 (allowed 0)
 *
 * Inventory (write measured counts, no ratchet):
 *   MOBILE_SPACE_INVENTORY=/tmp/ms MOBILE_SPACE_PAGES=credits.html \
 *     npx playwright test tests/mobile-space-every-page.spec.js --project=desktop-1280
 *   node tests/lib/mobile-space-harness.js /tmp/ms   (prints baseline files)
 *
 * Run: npx playwright test tests/mobile-space-every-page.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const M = require('./lib/mobile-space-harness');

test.describe.configure({ mode: 'parallel' });

const ONLY = process.env.MOBILE_SPACE_PAGES ? new Set(process.env.MOBILE_SPACE_PAGES.split(',')) : null;
const INVENTORY = process.env.MOBILE_SPACE_INVENTORY || '';
const PAGES = M.pages();
const BASELINE = M.readBaseline();
const SIGNED_OUT_VPS = ['320x568', '667x375'];
const VPS_FOR = {
  'device-brand': M.VIEWPORTS,
  'signed-out': M.VIEWPORTS.filter((v) => SIGNED_OUT_VPS.includes(v.name)),
};
const SCENARIO_VPS = M.VIEWPORTS.filter((v) => ['320x568', '390x844', '667x375', '768x1024'].includes(v.name));

function cfgFor(v, insets) {
  return { cls: v.cls, tapMin: M.TAP_MIN, textMin: M.TEXT_MIN, inputMin: M.INPUT_MIN, gutterMax: M.GUTTER_MAX[v.cls], chromeMax: M.CHROME_MAX[v.cls], insets: insets || null };
}

/* A page that asks for viewport-fit=cover is drawn under the notch and the
   home indicator, so it is measured with those insets emulated (Chromium
   reports env(safe-area-inset-*) as 0 otherwise). Only those pages: Chromium
   applies the override with or without cover, and iOS does not. */
async function newPhone(browser, file) {
  // Reduced motion: scroll-reveal sections (`.vh-reveal`) are opacity 0 until
  // an IntersectionObserver fires, and whether one had fired depended on which
  // earlier size's scroll reached it - storefront-3d's ratchet moved 7 <-> 11
  // between runs. With reduced motion they are simply shown; layout is the same.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await context.newPage();
  let insets = null;
  if (file && M.coversSafeArea(file)) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: M.INSETS.top, bottom: M.INSETS.bottom, left: 0, right: 0 } });
    insets = M.INSETS;
  }
  return { context, page, insets };
}

/** Measure the page as it stands at every viewport in `vps`; returns rows. */
async function sweep(page, vps, tag, insets) {
  const rows = [];
  for (const v of vps) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await M.settle(page);
    const r = await page.evaluate(`${M.PROBE}(${JSON.stringify(cfgFor(v, insets))})`);
    rows.push(Object.assign({ tag, vp: v.name, cls: v.cls }, r));
  }
  return rows;
}

/* A ratcheted count measured on another machine (CI's Chromium build, its
   fallback fonts) can wrap a label differently and move a control a few px, so
   the ratchet carries a small slack each way: max(2, 5%). A page that slips by
   more fails; a page that improves by more must have its file lowered. */
const slack = (n) => Math.max(2, Math.ceil(n * 0.05));

function verdict(key, rows, { floor = true } = {}) {
  const findings = [];
  for (const r of rows) for (const f of r.findings) findings.push(Object.assign({ at: r.tag + ' @' + r.vp }, f));
  // A hard kind counts every finding. A RATCHETED kind counts each distinct
  // offending element (its selector) once per page, whatever the size or the
  // number of rows that share it: a table drawn with 40 rows on one run and 52
  // on the next (data that arrives while the page is measured) is the same one
  // `tr > td` defect, and a ratchet that counted rows would move on its own.
  const counts = {};
  const seenKey = new Set();
  for (const f of findings) {
    if (M.RATCHETED.includes(f.kind)) {
      const k = f.kind + '|' + f.el;
      if (seenKey.has(k)) continue;
      seenKey.add(k);
    }
    counts[f.kind] = (counts[f.kind] || 0) + 1;
  }
  if (INVENTORY) {
    fs.mkdirSync(INVENTORY, { recursive: true });
    fs.writeFileSync(path.join(INVENTORY, M.baselineName(key)), JSON.stringify({ key, counts, findings }, null, 1));
  }
  // The floor: every measurement inspected something real.
  // Per size a small floor (a page whose demo content is gated for another
  // brand draws little: the shell, a marker, a heading); per page a larger one.
  if (floor) {
    let elements = 0, runs = 0;
    for (const r of rows) {
      expect(r.measured.elements, `${key} ${r.tag} @${r.vp}: too few visible elements measured`).toBeGreaterThan(5);
      expect(r.measured.text, `${key} ${r.tag} @${r.vp}: too few text runs measured`).toBeGreaterThan(2);
      expect(r.measured.targets, `${key} ${r.tag} @${r.vp}: no tap targets measured`).toBeGreaterThan(0);
      expect(r.measured.rules, `${key} ${r.tag} @${r.vp}: the CSSOM walk saw almost nothing`).toBeGreaterThan(100);
      elements += r.measured.elements; runs += r.measured.text;
    }
    expect(elements, `${key}: too few elements measured over every size`).toBeGreaterThan(rows.length * 10);
    expect(runs, `${key}: too few text runs measured over every size`).toBeGreaterThan(rows.length * 4);
  }
  const base = BASELINE[key] || {};
  const over = [];
  for (const [kind, n] of Object.entries(counts)) {
    const allowed = M.RATCHETED.includes(kind) && base[kind] ? base[kind] + slack(base[kind]) : 0;
    if (n > allowed) over.push(`${kind}: ${n} (allowed ${allowed})\n` + findings.filter((f) => f.kind === kind).slice(0, 12).map((f) => `    ${f.at}  ${f.el}  ${f.detail}`).join('\n'));
  }
  const stale = Object.entries(base).filter(([kind, n]) => (counts[kind] || 0) < n - slack(n)).map(([kind, n]) => `${kind}: baseline ${n}, measured ${counts[kind] || 0}`);
  return { over, stale, counts };
}

function assertVerdict(key, v) {
  if (INVENTORY) return;
  expect(v.over, `${key} - mobile space defects:\n` + v.over.join('\n')).toEqual([]);
  expect(v.stale, `${key} improved: lower tests/mobile-space-baseline/${M.baselineName(key)} to the measured counts (delete it at zero)`).toEqual([]);
}

/* ═══ 0. the page list and the baseline are real ═══════════════════════════ */

test('the sweep covers every app page, and the baseline names only pages that exist', () => {
  expect(PAGES.length, 'too few app pages to sweep').toBeGreaterThan(45);
  for (const f of ['index.html', 'onboarding.html', 'smart-brain.html', 'lifecycle_mailer_architect_v34.html', 'credits.html']) {
    expect(PAGES, `${f} is not swept`).toContain(f);
  }
  for (const [f, why] of Object.entries(M.EXCLUDED)) expect(why.length, `${f} has no reason`).toBeGreaterThan(30);
  const keys = new Set(PAGES.concat(Object.keys(SCENARIOS)));
  const orphan = Object.keys(BASELINE).filter((k) => !keys.has(k));
  expect(orphan, 'baseline files for pages that are no longer swept').toEqual([]);
  for (const [k, counts] of Object.entries(BASELINE)) {
    for (const kind of Object.keys(counts)) expect(M.RATCHETED, `${k}: ${kind} is not a ratcheted kind; it must be zero`).toContain(kind);
  }
});

/* ═══ 1. every page, every size, both states ═══════════════════════════════ */

for (const file of PAGES) {
  if (ONLY && !ONLY.has(file)) continue;
  test(`${file} uses the screen at every phone and tablet size`, async ({ browser }) => {
    test.setTimeout(600_000);
    const rows = [];
    for (const state of Object.keys(M.STATES)) {
      const { context, page, insets } = await newPhone(browser, file);
      try {
        await M.STATES[state].install(page, { errors: [], dialogs: [] });
        await M.STATES[state].open(page, file);
        rows.push(...await sweep(page, VPS_FOR[state], state, insets));
      } finally {
        await context.close();
      }
    }
    expect(rows.length).toBe(VPS_FOR['device-brand'].length + VPS_FOR['signed-out'].length);
    assertVerdict(file, verdict(file, rows));
  });
}

/* ═══ 2. the shared overlays, opened ════════════════════════════════════════ */

test('the rail drawer and the ? info panel fit a phone and scroll inside themselves', async ({ browser }) => {
  test.setTimeout(120_000);
  const findings = [];
  let checked = 0;
  for (const v of M.VIEWPORTS.filter((x) => x.cls !== 'tablet')) {
    const { context, page } = await newPhone(browser);
    try {
      await page.setViewportSize({ width: v.width, height: v.height });
      await M.STATES['device-brand'].install(page, { errors: [], dialogs: [] });
      await M.STATES['device-brand'].open(page, 'smart-brain.html');
      // Every group open: the longest the drawer ever gets.
      await page.click('#lnav-burger');
      await page.evaluate(() => document.querySelectorAll('#lifecycle-nav .lnav-group').forEach((g) => g.classList.add('open')));
      await M.settle(page);
      findings.push(...(await page.evaluate(`${M.OVERLAY_PROBE}(${JSON.stringify({ selector: '#lifecycle-nav .lnav-side', label: 'rail drawer @' + v.name })})`)));
      // The drawer's foot (who is signed in) is on screen without scrolling the page.
      const foot = await page.evaluate(() => { const u = document.querySelector('#lifecycle-nav .lnav-user, #lifecycle-nav .lnav-foot'); if (!u) return null; const r = u.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; });
      if (foot && foot.bottom > foot.vh + 1) findings.push({ kind: 'overlay-size', el: 'rail foot @' + v.name, detail: 'ends at ' + Math.round(foot.bottom) + ' of ' + foot.vh });
      checked++;
      // The ? panel of the first group.
      await page.evaluate(() => { const b = document.querySelector('#lifecycle-nav .lnav-i'); if (b) b.click(); });
      await M.settle(page);
      const open = await page.evaluate(() => { const p = document.getElementById('lnav-ipanel'); return !!p && getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0; });
      expect(open, `the ? panel did not open @${v.name}`).toBe(true);
      findings.push(...(await page.evaluate(`${M.OVERLAY_PROBE}(${JSON.stringify({ selector: '#lnav-ipanel', label: '? panel @' + v.name })})`)));
      checked++;
    } finally {
      await context.close();
    }
  }
  expect(checked).toBe(16);
  expect(findings, findings.map((f) => `${f.el}: ${f.kind} ${f.detail}`).join('\n')).toEqual([]);
});

/* ═══ 3. states one load never reaches ══════════════════════════════════════ */

const PLAN = [0, 1, 2].map((n) => ({
  id: 'slot-' + n, date: '2026-10-1' + n, market: 'IN', cohort: { name: 'Lapsed readers ' + n, size: 1200 + n },
  objective: 'Reactivation with the weekend edition', heroProduct: { title: 'Weekend edition' }, channels: ['email', 'push'],
  confidence: 0.72, status: 'tentative', rationale: 'Reason ' + n,
}));

const SCENARIOS = {
  'onboarding: every wizard step': {
    file: 'onboarding.html',
    steps: [1, 2, 3, 4, 5, 6].map((n) => ['step ' + n, async (page) => {
      await page.evaluate((k) => { const b = document.querySelector('.step-pip[data-step="' + k + '"]'); if (b) b.click(); }, n);
      await page.waitForFunction((k) => { const b = document.querySelector('.step-pip.on'); return b && b.getAttribute('data-step') === String(k); }, n, { timeout: 8000 });
    }]),
  },
  'smart brain: the plan with a row expanded': {
    file: 'smart-brain.html',
    before: async (page) => {
      await page.route(/action=smart-brain-plan/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'local-fallback', stored: true, entries: PLAN }) }));
    },
    steps: [
      ['plan rows', async (page) => {
        await page.click('#refresh');
        await page.waitForSelector('#plan tr.planrow', { timeout: 10000 });
      }],
      ['row expanded', async (page) => {
        await page.evaluate(() => window.viewDecision(0));
        await page.waitForFunction(() => { const r = document.getElementById('exprow-0'); return r && r.style.display !== 'none' && document.getElementById('expbody-0').textContent.trim().length > 20; }, null, { timeout: 8000 });
      }],
    ],
  },
  'mailer studio: brief and products': {
    file: 'lifecycle_mailer_architect_v34.html',
    steps: [
      ['brief: suggested prompts', async (page) => {
        await page.evaluate(() => toggleSuggestedPrompts());
        await page.waitForSelector('#suggGrid .sugg-card', { timeout: 8000 });
      }],
      ['step 2: products', async (page) => {
        await page.fill('#promptIn', 'A spring launch for our signature range, warm and confident, with a gift for first orders.');
        await page.evaluate(() => go2());
        await page.waitForSelector('#p2', { state: 'visible', timeout: 8000 });
      }],
    ],
  },
};

for (const [key, sc] of Object.entries(SCENARIOS)) {
  if (ONLY && !ONLY.has(sc.file) && !ONLY.has(key)) continue;
  test(`${key} fits every phone`, async ({ browser }) => {
    test.setTimeout(300_000);
    const { context, page } = await newPhone(browser);
    const rows = [];
    try {
      await M.STATES['device-brand'].install(page, { errors: [], dialogs: [] });
      if (sc.before) await sc.before(page);
      await M.STATES['device-brand'].open(page, sc.file);
      for (const [label, act] of sc.steps) {
        await page.setViewportSize({ width: 390, height: 844 });
        await act(page);
        await M.settle(page);
        rows.push(...await sweep(page, SCENARIO_VPS, label));
      }
    } finally {
      await context.close();
    }
    expect(rows.length).toBe(sc.steps.length * SCENARIO_VPS.length);
    assertVerdict(key, verdict(key, rows));
  });
}
