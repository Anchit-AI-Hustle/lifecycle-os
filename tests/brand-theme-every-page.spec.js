/**
 * Every app page wears the ACTIVE brand, and every word on it is readable.
 * ---------------------------------------------------------------------------
 * Found on production (2026-10-05): the Mailer Studio with the operator's own
 * red-primary brand active had red bands either side of the content, dark
 * brown and black panels, the brief's progress steps in pale pink on light
 * grey, near-black "Suggested Campaign Prompts" cards with dark grey text and
 * a dark assistant bar. The operator: "unreadable & keep theme of each page
 * also when brand setup done as the brand theme".
 *
 * contrast-rendered.spec.js measured 23 hand-picked pages under ONE palette and
 * never loaded the Studio at all. This enumerates EVERY app page (root *.html
 * plus every vercel.json destination that loads the shell - see
 * tests/lib/brand-theme-harness.js appPages()) and renders each under five
 * device brands, the way production serves a phone sign-in: tenant zero, a red
 * primary on white, a pale primary, a near-black primary, and a bare record.
 * The Mailer Studio is also DRIVEN through every wizard state it reaches
 * without a backend, because one load only measures its first screen.
 *
 * Measured in Chromium with getComputedStyle (inheritance, every inherited
 * opacity, translucent and gradient grounds resolved), over the whole document:
 *   (a) text      every visible text run reaches 4.5:1 on its effective ground
 *                 (3:1 at 24px+ or 18.66px bold); a gradient at its worst stop
 *   (b) ground    no panel ground is a dark neutral (validatePalette's rule),
 *                 nor dark in a hue no brand token carries
 *   (c) foreign   every chromatic colour carries the hue of a brand token
 *       button    every primary button's ground is a brand token
 *       font      every family is the brand's heading / body / mono family
 *       unpainted the active brand is painted at all
 *   (d) forbidden no exact hex of tenant zero's or the sibling's palette while
 *                 another brand is active
 * Each measurement first asserts it judged a non-trivial number of text runs
 * and grounds (kind `floor`): a check that inspects nothing passes everything.
 *
 * THE RATCHET. tests/brand-theme-baseline.json holds, per page (and per Studio
 * sequence), the count of findings of each kind summed over the five palettes,
 * for the pages not fixed yet. A count that RISES fails; a page that reaches
 * zero must leave the file (the test says so); a page not in the file must be
 * clean. The file only shrinks - the same ratchet as check-executed-tests.js.
 *
 * ── HOW TO FIX A PAGE ──────────────────────────────────────────────────────
 * 1. See every finding on one page, under one palette, with no ratchet (scoped
 *    runs are strict and print file:line for each finding):
 *      BRAND_THEME_PAGES=credits.html BRAND_THEME_PALETTES=red-primary \
 *      BRAND_THEME_INVENTORY=/tmp/bt npx playwright test \
 *        tests/brand-theme-every-page.spec.js --project=desktop-1280
 *    (/tmp/bt/<page>.json then holds each finding with the rule and LINE that
 *    set it.) Palettes: tenant-zero, red-primary, pale, near-black, bare.
 * 2. The common fixes, all through design/lifecycle-os/CONTRACT.md:
 *    - font      the page's body/heading font rule names a family:
 *                font-family: var(--vh-font-body) / var(--vh-font-head)
 *                (they resolve --brand-font-body / --brand-font-head).
 *    - forbidden, foreign   a hex / rgb() literal -> the token for its role:
 *                ground var(--vh-bg|--vh-panel|--vh-panel-2), text
 *                var(--vh-ink|--vh-ink-dim|--vh-*-text), fill var(--vh-primary)
 *                with var(--vh-on-primary), edge var(--vh-line|--vh-accent).
 *    - ground    a dark panel/section -> var(--vh-panel) with --vh-ink text,
 *                or a brand section via .vh-band (var(--vh-band)/--vh-on-band).
 *                A page-level DARK THEME block (html[data-theme=...] repainting
 *                grounds dark) is deleted: the app is light-only.
 *    - text      color:var(--brand-primary|--brand-accent) -> the *-text
 *                token; faded text (opacity, a light grey) -> --vh-ink-dim.
 * 3. Re-run the page with all palettes, then lower (or delete) its entry in
 *    tests/brand-theme-baseline.json. `node tests/lib/brand-theme-baseline.js
 *    <inventory dir>` prints the counts an inventory run measured.
 *
 * Run: npx playwright test tests/brand-theme-every-page.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const H = require('./lib/brand-theme-harness');

const { kept: PAGES, excluded: EXCLUDED } = H.appPages();
const ALL_PALETTES = Object.keys(H.PALETTES);
const NAMES = process.env.BRAND_THEME_PALETTES ? process.env.BRAND_THEME_PALETTES.split(',') : ALL_PALETTES;
const SCOPED = NAMES.length !== ALL_PALETTES.length;
const INVENTORY = process.env.BRAND_THEME_INVENTORY || '';
const ONLY = process.env.BRAND_THEME_PAGES ? new Set(process.env.BRAND_THEME_PAGES.split(',')) : null;
const BASELINE_FILE = path.join(__dirname, 'brand-theme-baseline.json');
const BASELINE = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
const KINDS = ['unpainted', 'floor', 'text', 'ground', 'forbidden', 'foreign', 'button', 'font', 'pageerror'];

// Every case opens its own browser contexts and shares nothing, so the pages
// can be measured side by side (a file's tests run serially by default).
test.describe.configure({ mode: 'parallel' });

// Floors, per page and palette, below which the measurement is not believed.
const MIN_TEXT = 8;
const MIN_GROUND = 1;

test('the page list is enumerated from the repo, and every exclusion has a reason', () => {
  // Floors: a gutted enumeration cannot pass.
  expect(PAGES.length).toBeGreaterThan(45);
  for (const must of ['lifecycle_mailer_architect_v34.html', 'onboarding.html', 'index.html', 'smart-brain.html', 'privacy.html']) {
    expect(PAGES, must + ' is an app page').toContain(must);
  }
  // An excluded page is one that cannot wear a brand: it loads neither the
  // shell nor the brand layer, or it only redirects. Re-derived here from the
  // file itself, so a reason cannot be wrong.
  for (const ex of EXCLUDED) {
    const page = fs.readFileSync(path.join(H.ROOT, ex.file), 'utf8');
    const loadsBrand = /<script[^>]+src=["'][^"']*\b(auth|brand-context)\.js/.test(page);
    const redirects = /<meta[^>]+http-equiv=["']refresh/i.test(page);
    expect(ex.file.startsWith('_') || !loadsBrand || redirects, ex.file + ': ' + ex.why).toBe(true);
  }
});

test('the baseline only names pages and kinds that exist', () => {
  const keys = new Set(PAGES.concat(STUDIO_SEQUENCES.map(studioKey)));
  for (const [k, counts] of Object.entries(BASELINE)) {
    if (k.startsWith('_')) continue;
    expect(keys.has(k), `${k} is in tests/brand-theme-baseline.json but is not a page or Studio sequence`).toBe(true);
    for (const [kind, n] of Object.entries(counts)) {
      expect(KINDS, `${k}: unknown kind ${kind}`).toContain(kind);
      expect(Number.isInteger(n) && n > 0, `${k}.${kind} must be a positive count (delete a zero)`).toBe(true);
    }
  }
});

function summarise(list, fmt, n) { return list.slice(0, n || 10).map(fmt).join('\n'); }

/** Every finding of one probe run: [{ kind, n, message }], [] when clean. */
function findingsOf(tag, r, cfg, painted, themed) {
  const out = [];
  const add = (kind, n, message) => { if (n) out.push({ kind, n, message: tag + message }); };
  const want = cfg.tokens['--brand-primary'].toLowerCase();
  const badButtons = r.buttons.filter((b) => !b.ok);
  add('unpainted', painted ? 0 : 1, 'the active brand was never painted on this page (--brand-primary is not ' + want + ')');
  add('floor', r.text < MIN_TEXT ? 1 : 0, `measured only ${r.text} text runs (floor ${MIN_TEXT}): the probe saw nothing to judge`);
  add('floor', r.ground < MIN_GROUND ? 1 : 0, `measured only ${r.ground} grounds (floor ${MIN_GROUND})`);
  add('unpainted', themed && r.chrome.vhGreen !== want ? 1 : 0, `theme.css resolves --vh-green to ${r.chrome.vhGreen}, not the brand's ${want}`);
  add('text', r.textFails.length, `${r.textFails.length} unreadable text runs:\n` + summarise(r.textFails, (f) => `    "${f.text}" ${f.ratio}:1 (needs ${f.need}) ${f.fg} on ${f.bg}, ${f.size}px · ${f.sel}`));
  add('ground', r.groundFails.length, `${r.groundFails.length} dark panel grounds:\n` + summarise(r.groundFails, (f) => `    ${f.bg} ${f.w}x${f.h} · ${f.sel}`));
  add('forbidden', r.forbidden.length, `${r.forbidden.length} colours of another brand:\n` + summarise(r.forbidden, (f) => `    ${f.prop} ${f.color} (${f.label}) · ${f.sel}`));
  add('foreign', r.foreign.length, `${r.foreign.length} colours no brand token carries:\n` + summarise(r.foreign, (f) => `    ${f.prop} ${f.color} · ${f.sel}`));
  add('button', badButtons.length, `${badButtons.length} primary buttons not on a brand token:\n` + summarise(badButtons, (f) => `    ${f.grounds.join(' → ')} · ${f.sel}`));
  add('font', r.fonts.length, `${r.fonts.length} text runs in a family that is not the brand's:\n` + summarise(r.fonts, (f) => `    ${f.family} · ${f.sel}`));
  return out;
}

/** Measure the page as it stands; with INVENTORY set, also attribute every finding. */
async function measure(page, file, name, painted, log) {
  const cfg = H.probeConfig(name, 'p');
  const r = await page.evaluate(H.PROBE + '(' + JSON.stringify(cfg) + ')');
  const themed = await page.evaluate(() => !!document.querySelector('link[data-vh-theme]'));
  let entry = null;
  if (INVENTORY) {
    const cap = (list, n) => list.slice(0, n);
    const badButtons = r.buttons.filter((b) => !b.ok);
    const items = []
      .concat(cap(r.textFails, 80).map((f) => ({ kind: 'text', bt: f.bt, prop: 'color', key: f.sel + f.fg, f })))
      .concat(cap(r.textFails, 80).map((f) => ({ kind: 'text-ground', bt: f.gbt, prop: 'background-color', key: f.gsel, f })))
      .concat(cap(r.groundFails, 40).map((f) => ({ kind: 'ground', bt: f.bt, prop: 'background-color', key: f.sel, f })))
      .concat(cap(r.forbidden, 80).map((f) => ({ kind: 'forbidden', bt: f.bt, prop: f.prop, key: f.sel + f.color, f })))
      .concat(cap(r.foreign, 80).map((f) => ({ kind: 'foreign', bt: f.bt, prop: f.prop, key: f.sel + f.color, f })))
      .concat(cap(badButtons, 20).map((f) => ({ kind: 'button', bt: f.bt, prop: 'background-color', key: f.sel, f })))
      .concat(cap(r.fonts, 40).map((f) => ({ kind: 'font', bt: f.bt, prop: 'font-family', key: f.sel + f.family, f })));
    await H.attribute(page, file, items);
    entry = {
      painted, counts: { text: r.text, textChrome: r.textChrome, ground: r.ground, unmeasured: r.unmeasured },
      totals: { text: r.textFails.length, ground: r.groundFails.length, forbidden: r.forbidden.length, foreign: r.foreign.length, button: badButtons.length, font: r.fonts.length },
      chrome: r.chrome, errors: ((log && log.errors) || []).slice(0, 5),
      items: items.map((i) => Object.assign({ kind: i.kind, source: i.source || null }, i.f)),
    };
  }
  return { r, cfg, themed, entry };
}
function writeInventory(key, record) {
  if (!INVENTORY) return;
  fs.mkdirSync(INVENTORY, { recursive: true });
  fs.writeFileSync(path.join(INVENTORY, key.replace(/[^a-z0-9._-]+/gi, '_') + '.json'), JSON.stringify(record, null, 1));
}

/**
 * The verdict for one page or sequence. A scoped run (fewer palettes) is
 * strict: it is how a page is fixed. A full run holds the page to its
 * baseline: no kind may rise, and a page at zero must leave the file.
 */
function countsOf(findings) {
  const counts = {};
  for (const f of findings) counts[f.kind] = (counts[f.kind] || 0) + f.n;
  return counts;
}
function verdict(key, findings) {
  const counts = countsOf(findings);
  const all = findings.map((f) => f.message).join('\n');
  const base = BASELINE[key];
  if (SCOPED || !base) {
    expect(findings, (base ? '' : `${key} is not in tests/brand-theme-baseline.json, so it must be clean.\n`) + all).toEqual([]);
    return;
  }
  const rose = KINDS.filter((k) => (counts[k] || 0) > (base[k] || 0));
  const detail = rose.map((k) => `${k}: ${counts[k]} now, ${base[k] || 0} in the baseline`).join('; ');
  expect(rose, `${key} got worse (${detail}):\n` + findings.filter((f) => rose.includes(f.kind)).map((f) => f.message).join('\n')).toEqual([]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  expect(total, `${key} is clean now: delete its entry from tests/brand-theme-baseline.json`).toBeGreaterThan(0);
  const fell = KINDS.filter((k) => (counts[k] || 0) < (base[k] || 0));
  if (fell.length) {
    test.info().annotations.push({ type: 'ratchet', description: `${key}: lower the baseline to ${JSON.stringify(counts)}` });
  }
}

for (const file of PAGES) {
  if (ONLY && !ONLY.has(file)) continue;
  test(`${file} wears the active brand and is readable under every palette`, async ({ browser }) => {
    test.setTimeout(240000);
    const findings = [];
    const record = { file, palettes: {} };
    for (const name of NAMES) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const log = { errors: [], dialogs: [] };
      try {
        await H.install(page, name, log);
        const painted = await H.open(page, file, name);
        const m = await measure(page, file, name, painted, log);
        if (m.entry) record.palettes[name] = m.entry;
        findings.push(...findingsOf(`[${name}] `, m.r, m.cfg, painted, m.themed));
      } finally {
        await context.close();
      }
    }
    record.key = file; record.kinds = countsOf(findings); record.palettesMeasured = NAMES;
    writeInventory(file, record);
    verdict(file, findings);
  });
}

/* ── the Mailer Studio, driven through every state it reaches without a
   backend ─────────────────────────────────────────────────────────────────
   The operator's screenshot was the Studio's brief step. One load measures
   only what is on screen at first paint, so each state is driven the way a
   person reaches it: the suggested prompts opened, "Create Brief with AI"
   pressed (its progress panel held open by holding the request), the
   assistant expanded with a reply in it, step 2 products, step 3 generating
   (frozen mid-run), step 4 review on each of its tabs, step 5's gate, and the
   dashboard view. */
const STUDIO = 'lifecycle_mailer_architect_v34.html';
const BRIEF = 'A spring launch for our signature range, warm and confident, with a gift for first orders.';
const STUDIO_STATES = {
  'brief: suggested prompts open': async (page) => {
    await page.evaluate(() => toggleSuggestedPrompts());
    await page.waitForSelector('#suggGrid .sugg-card', { timeout: 8000 });
  },
  'brief: creating a brief with AI': async (page) => {
    // The request is held, so the progress panel stays on its first step
    // with the later steps pending - the state the operator photographed.
    await page.route('**/api/ai/generate**', () => { /* never answered */ });
    await page.click('#smartAIBtn');
    await page.waitForSelector('#briefProgressPanel', { state: 'visible', timeout: 8000 });
    await page.waitForTimeout(700);
  },
  'assistant: expanded with a reply': async (page) => {
    await page.evaluate(() => Copilot.expand());
    await page.fill('#copilotInput', 'Three subject lines for the spring launch');
    await page.evaluate(() => Copilot.send());
    await page.waitForSelector('#copilotMsgs .cmsg.bot:not(.typing)', { timeout: 10000 });
    await page.waitForTimeout(500);
  },
  'step 2: products': async (page) => {
    await page.fill('#promptIn', BRIEF);
    await page.evaluate(() => go2());
    await page.waitForSelector('#p2', { state: 'visible', timeout: 8000 });
  },
  // Continues from step 2.
  'step 3: generating': async (page) => {
    // Freeze the run between its stages: the stage list is drawn, nothing advances.
    await page.evaluate(() => { window.delay = () => new Promise(() => {}); go3(); });
    await page.waitForSelector('#p3', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => { if (typeof setStages === 'function') setStages(2); });
    await page.waitForTimeout(500);
  },
  'step 4: review': async (page) => {
    await page.fill('#promptIn', BRIEF);
    await page.evaluate(() => go2());
    await page.evaluate(() => go3());
    await page.waitForSelector('#p4', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(600);
  },
  'step 4: content preview': async (page) => { await page.click('#tab-content'); await page.waitForTimeout(500); },
  'step 4: prompts': async (page) => { await page.click('#tab-chatgpt'); await page.waitForTimeout(500); },
  'step 4: upload a design': async (page) => { await page.click('#tab-upload'); await page.waitForTimeout(500); },
  // Continues from step 4: the gate either opens step 5 or says what to fix.
  'step 5: final output gate': async (page) => {
    await page.evaluate(() => gateFinalOutput());
    await page.waitForFunction(() => !!document.getElementById('sanityModal') || getComputedStyle(document.getElementById('p5')).display !== 'none', null, { timeout: 8000 });
    await page.waitForTimeout(600);
  },
  dashboard: async (page) => {
    await page.evaluate(() => switchMainTab('dashboard'));
    await page.waitForSelector('#dashboardView', { state: 'visible', timeout: 8000 });
    await page.waitForTimeout(400);
  },
};

/* One load per sequence, a measurement after every step of it. */
const STUDIO_SEQUENCES = [
  ['brief: suggested prompts open', 'assistant: expanded with a reply', 'dashboard'],
  ['brief: creating a brief with AI'],
  ['step 2: products', 'step 3: generating'],
  ['step 4: review', 'step 4: content preview', 'step 4: prompts', 'step 4: upload a design', 'step 5: final output gate'],
];
function studioKey(seq) { return 'studio: ' + seq.join(' → '); }

if (!ONLY || ONLY.has(STUDIO)) {
  for (const seq of STUDIO_SEQUENCES) {
    test(`the Mailer Studio wears the active brand through: ${seq.join(' → ')}`, async ({ browser }) => {
      test.setTimeout(300000);
      const findings = [];
      const record = { file: STUDIO + ' :: ' + seq.join(' → '), palettes: {} };
      let measured = 0;
      for (const name of NAMES) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        const log = { errors: [], dialogs: [] };
        try {
          await H.install(page, name, log);
          const painted = await H.open(page, STUDIO, name);
          for (const state of seq) {
            await STUDIO_STATES[state](page);
            const m = await measure(page, STUDIO, name, painted, log);
            measured++;
            if (m.entry) record.palettes[name + ' · ' + state] = m.entry;
            findings.push(...findingsOf(`[${name} · ${state}] `, m.r, m.cfg, painted, m.themed));
          }
          if (log.errors.length) findings.push({ kind: 'pageerror', n: 1, message: `[${name}] the Studio threw while being driven: ${log.errors[0]}` });
        } finally {
          await context.close();
        }
      }
      expect(measured).toBe(seq.length * NAMES.length);
      record.key = studioKey(seq); record.kinds = countsOf(findings); record.palettesMeasured = NAMES;
      writeInventory('studio--' + seq[0], record);
      verdict(studioKey(seq), findings);
    });
  }
}
