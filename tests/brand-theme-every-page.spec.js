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
 *
 * Measured in Chromium with getComputedStyle (inheritance, every inherited
 * opacity, translucent and gradient grounds resolved), over the whole document:
 *   (a) every visible text run reaches 4.5:1 on its effective ground (3:1 at
 *       24px+ or 18.66px bold); a gradient is judged at its worst stop
 *   (b) no panel ground is a dark neutral (the validatePalette rule), nor dark
 *       in a hue no brand token carries
 *   (c) the page follows the active brand's tokens: the brand is painted, the
 *       shell resolves it, every primary button's ground is the brand's
 *       primary (or its hover shade, or its accent), every chromatic colour
 *       carries the hue of a brand token, every family is the brand's
 *   (d) no colour literal of tenant zero's palette or the sibling's while
 *       another brand is active
 * Each case first asserts that it measured a non-trivial number of text runs
 * and grounds: a check that inspects nothing passes everything.
 *
 * Inventory: BRAND_THEME_INVENTORY=<dir> writes one JSON file per page with
 * every failing pair and the stylesheet / inline style and LINE that set it.
 *
 * Run: npx playwright test tests/brand-theme-every-page.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const H = require('./lib/brand-theme-harness');

const { kept: PAGES, excluded: EXCLUDED } = H.appPages();
const NAMES = Object.keys(H.PALETTES);
const INVENTORY = process.env.BRAND_THEME_INVENTORY || '';
const ONLY = process.env.BRAND_THEME_PAGES ? new Set(process.env.BRAND_THEME_PAGES.split(',')) : null;

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

function summarise(list, fmt, n) { return list.slice(0, n || 10).map(fmt).join('\n'); }

/** Every finding of one probe run, as sentences; [] when the page is clean. */
function findingsOf(tag, r, cfg, painted, themed) {
  const out = [];
  const want = cfg.tokens['--brand-primary'].toLowerCase();
  const badButtons = r.buttons.filter((b) => !b.ok);
  if (!painted) out.push(tag + 'the active brand was never painted on this page (--brand-primary is not ' + want + ')');
  if (r.text < MIN_TEXT) out.push(tag + `measured only ${r.text} text runs (floor ${MIN_TEXT}): the probe saw nothing to judge`);
  if (r.ground < MIN_GROUND) out.push(tag + `measured only ${r.ground} grounds (floor ${MIN_GROUND})`);
  if (themed && r.chrome.vhGreen !== want) out.push(tag + `theme.css resolves --vh-green to ${r.chrome.vhGreen}, not the brand's ${want}`);
  if (r.textFails.length) out.push(tag + `${r.textFails.length} unreadable text runs:\n` + summarise(r.textFails, (f) => `    "${f.text}" ${f.ratio}:1 (needs ${f.need}) ${f.fg} on ${f.bg}, ${f.size}px · ${f.sel}`));
  if (r.groundFails.length) out.push(tag + `${r.groundFails.length} dark panel grounds:\n` + summarise(r.groundFails, (f) => `    ${f.bg} ${f.w}x${f.h} · ${f.sel}`));
  if (r.forbidden.length) out.push(tag + `${r.forbidden.length} colours of another brand:\n` + summarise(r.forbidden, (f) => `    ${f.prop} ${f.color} (${f.label}) · ${f.sel}`));
  if (r.foreign.length) out.push(tag + `${r.foreign.length} colours no brand token carries:\n` + summarise(r.foreign, (f) => `    ${f.prop} ${f.color} · ${f.sel}`));
  if (badButtons.length) out.push(tag + `${badButtons.length} primary buttons not on a brand token:\n` + summarise(badButtons, (f) => `    ${f.grounds.join(' → ')} · ${f.sel}`));
  if (r.fonts.length) out.push(tag + `${r.fonts.length} text runs in a family that is not the brand's:\n` + summarise(r.fonts, (f) => `    ${f.family} · ${f.sel}`));
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
      chrome: r.chrome, errors: (log && log.errors || []).slice(0, 5),
      items: items.map((i) => Object.assign({ kind: i.kind, source: i.source || null }, i.f)),
    };
  }
  return { r, cfg, themed, entry };
}
function writeInventory(key, record) {
  if (!INVENTORY) return;
  fs.mkdirSync(INVENTORY, { recursive: true });
  fs.writeFileSync(path.join(INVENTORY, key.replace(/[\/]/g, '__') + '.json'), JSON.stringify(record, null, 1));
}

for (const file of PAGES) {
  if (ONLY && !ONLY.has(file)) continue;
  test(`${file} wears the active brand and is readable under every palette`, async ({ browser }) => {
    test.setTimeout(240000);
    const failures = [];
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
        failures.push(...findingsOf(`[${name}] `, m.r, m.cfg, painted, m.themed));
      } finally {
        await context.close();
      }
    }
    writeInventory(file, record);
    expect(failures, failures.join('\n')).toEqual([]);
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

if (!ONLY || ONLY.has(STUDIO)) {
  for (const seq of STUDIO_SEQUENCES) {
    test(`the Mailer Studio wears the active brand through: ${seq.join(' → ')}`, async ({ browser }) => {
      test.setTimeout(300000);
      const failures = [];
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
            failures.push(...findingsOf(`[${name} · ${state}] `, m.r, m.cfg, painted, m.themed));
          }
          if (log.errors.length) failures.push(`[${name}] the Studio threw while being driven: ${log.errors[0]}`);
        } finally {
          await context.close();
        }
      }
      expect(measured).toBe(seq.length * NAMES.length);
      writeInventory('studio--' + seq[0].replace(/[^a-z0-9]+/gi, '-'), record);
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
}
