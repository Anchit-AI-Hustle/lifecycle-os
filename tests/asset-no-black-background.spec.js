// No generated asset ships a black section background.
//
// The rule has been in the design HARD rules all along — "never black /
// #111111 / dark-neutral section backgrounds (use the brand colour or the
// surface)" — and for generated assets it was enforced nowhere. It existed as
// prose in a spec that reaches the model as a prompt, and prose is not a gate.
//
// So a mailer shipped with a near-black hero band: flagship-mailer's "midnight"
// colorway set `heroBg: PAL.ink`, and PAL.ink is #111111. The landing page's
// footer did the same with `background: var(--ink)`, and the video creative's
// letterbox with `background: var(--ink)`.
//
// A second defect fell out of the same sweep, and it is the more dangerous one
// because it is invisible in source review: THE ACCENT WITH INK TEXT. A lava
// button with ink text is 2.77:1 against the 4.5 floor. It appeared on the
// mailer CTA, the landing-page CTA, the video CTA and the ad price pill — four
// renderers, same pairing, all failing AA.
//
// This file RENDERS each asset and measures what came out. A grep for '#111111'
// would miss a token that resolves to it, and would flag the many legitimate
// uses of ink as TEXT.
//
// Run: npx playwright test tests/asset-no-black-background.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));

/* ── what counts as "too dark to be a section ground" ─────────────────────── */

const parse = (c) => {
  const s = String(c || '').trim();
  const hex = s.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  const rgb = s.match(/rgba?\(([^)]+)\)/i);
  if (rgb) return rgb[1].split(',').slice(0, 3).map((n) => Number(n.trim()));
  return null;
};

/** A neutral is a colour with almost no hue; dark means low luminance. The rule
 *  bans the combination — a deep BRAND colour is fine, a near-black is not. */
const toHex = (rgb) => '#' + rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');

function isDarkNeutral(colour) {
  const rgb = parse(colour);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  // core.luminance reads hex, so an rgb() string from getComputedStyle has to
  // be converted first. Passing it through raw returned 0 for WHITE and this
  // test reported every white section as black.
  const lum = core.luminance(toHex(rgb));
  return lum < 0.06 && spread < 40;
}

test('the darkness test recognises the colours it is about', () => {
  // Pin the classifier itself, so a later loosening is visible.
  for (const black of ['#000000', '#111111', '#0a0a0a', '#121212', 'rgb(17, 17, 17)']) {
    expect(isDarkNeutral(black), `${black} should count as a dark neutral`).toBe(true);
  }
  for (const ok of ['#FFFFFF', '#D0473E', '#6A33D8', '#F6F6F6']) {
    expect(isDarkNeutral(ok), `${ok} should NOT count as a dark neutral`).toBe(false);
  }
});

/* ── the mailer ───────────────────────────────────────────────────────────── */

const mailer = require(path.join(ROOT, 'scripts', 'lib', 'flagship-mailer.js'));

test('no mailer colorway paints a section black', () => {
  // Every colorway, not just the default: "midnight" was the one that shipped a
  // #111111 hero band, and it is only reachable on some sends.
  const names = ['violet', 'midnight', 'daylight'];
  for (const name of names) {
    const cw = mailer.colorway ? mailer.colorway(name) : null;
    if (!cw) continue;
    for (const [slot, colour] of Object.entries(cw)) {
      if (!/Bg|bg|pill/.test(slot)) continue;
      expect(isDarkNeutral(colour), `colorway "${name}" paints ${slot} ${colour}, a dark neutral`).toBe(false);
    }
  }
});

test('every mailer colorway clears AA on its band and its button', () => {
  const AA = 4.5;
  for (const name of ['violet', 'midnight', 'daylight']) {
    const cw = mailer.colorway ? mailer.colorway(name) : null;
    if (!cw) continue;
    const band = core.contrast(cw.heroText, cw.heroBg);
    expect(band, `colorway "${name}": hero text on the band is ${band.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    const cta = core.contrast(cw.ctaText, cw.ctaBg);
    expect(cta, `colorway "${name}": CTA label on the button is ${cta.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    // The eyebrow sits on the band too, and was chosen for a different ground.
    if (cw.eyebrow) {
      const eb = core.contrast(cw.eyebrow, cw.heroBg);
      expect(eb, `colorway "${name}": eyebrow on the band is ${eb.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  }
});

/* ── the accent-with-ink-text pairing, wherever it appears ────────────────── */

test('no renderer puts ink text on an accent background', () => {
  // 2.77:1. It was on the mailer CTA, the landing CTA, the video CTA and the ad
  // price pill — four files, one habit. Asserted on source because these are
  // template literals whose colours are fixed at author time.
  const fs = require('fs');
  const files = [
    'scripts/lib/flagship-mailer.js',
    'scripts/lib/landing-page.js',
    'scripts/lib/motion-ad.js',
    'scripts/lib/ad-creative.js',
  ];
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    // Both spellings: the ${PAL.x} template form and the var(--x) CSS form.
    if (/background:\s*\$\{PAL\.lava\}\s*;\s*color:\s*\$\{PAL\.ink\}/.test(src)) offenders.push(`${f} (PAL form)`);
    if (/background:\s*var\(--lava\)\s*;\s*color:\s*var\(--ink\)/.test(src)) offenders.push(`${f} (var form)`);
    if (/ctaBg:\s*PAL\.lava,\s*ctaText:\s*PAL\.ink/.test(src)) offenders.push(`${f} (colorway form)`);
  }
  expect(offenders, 'these render ink text on the accent, which is 2.77:1').toEqual([]);
});

/* ── the landing page and the video creative ──────────────────────────────── */

test('no generated stylesheet sets a section background to the ink token', () => {
  const fs = require('fs');
  // The ink token is the brand's TEXT colour. Used as a ground it is the
  // near-black the rule bans, for whichever brand is active — so this is
  // checked as a token, not as a hex.
  const files = [
    'api/_shared/smart-brain-plan.js',
    'scripts/lib/motion-ad.js',
    'scripts/lib/landing-page.js',
    'scripts/lib/flagship-mailer.js',
  ];
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    for (const m of src.matchAll(/background(?:-color)?\s*:\s*var\(--ink\)/g)) {
      offenders.push(`${f}: ${m[0]}`);
    }
    for (const m of src.matchAll(/background(?:-color)?\s*:\s*\$\{(?:PAL\.ink|pal\.INK)\}/g)) {
      offenders.push(`${f}: ${m[0]}`);
    }
  }
  // A scrim over footage (color-mix with transparency) is not a section ground
  // and is deliberately not matched by the patterns above.
  expect(offenders, 'these paint a section with the ink token').toEqual([]);
});

/* ── the landing page and mailer the app actually BUILDS, in a browser ────── */

// Source patterns catch the spellings someone thought to look for. These two
// tests build a real campaign, open its assets in Chromium and read
// getComputedStyle — which resolves the tokens, the cascade and the inherited
// colour, and so finds the pairing nobody wrote down.
//
// It is how the /lp/:id page was caught still carrying three of these after the
// source sweep had "finished": an accent button with ink text (2.77:1), an
// accent eyebrow on the primary band (1.51:1) and a hardcoded 82%-opacity cream
// paragraph on that same band (3.29:1).

const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const sbPlan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));

const SLOT = {
  id: 'contrast-1', date: '2026-09-02', market: 'US',
  objective: 'reactivation and replenishment',
  cohort: { name: 'At Risk', size: 2000, rules: ['r'] },
  channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
  confidence: 0.8,
  heroProduct: { sku: 'A', title: 'Alpha 01', handle: 'alpha-01' },
  offer: { code: null, depth: 'none', pct: 0, why: 'n/a' },
  rationale: 'Lapsed buyers.',
};

let built;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  // noLLM: the offline path is the one that always runs, so it is the one to
  // measure. It is also the path a rate-limited production run falls back to.
  built = await sbPlan.buildCampaign(SLOT, smartConfig({}), { noLLM: true, withCreatives: false });
});

/** Every painted element, with the colour it draws text in and the ground that
 *  ends up behind it. Runs in the page so the cascade does the work. */
const MEASURE = () => {
  const out = { grounds: [], text: [] };
  const opaque = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const p = m[1].split(',').map((n) => Number(n.trim()));
    return p.length < 4 || p[3] >= 0.95;
  };
  const groundOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (opaque(bg)) return bg;
    }
    return 'rgb(255, 255, 255)';
  };
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || box.width < 2 || box.height < 2) continue;
    const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    // A SECTION ground: opaque, its own (not inherited), and big enough to read
    // as a band rather than a rule or a dot. A control is deliberately not one
    // - the rule is about section backgrounds, and a brand whose accent is
    // near-black is entitled to a black button the same as on its own site.
    // What matters on a control is its LABEL, which the text walk below judges.
    // Only the control itself — not the card it sits in. `.cta` on the video
    // creative is a full-bleed section and must stay measurable; `.btn` inside
    // it is a <span>, so the tag check alone would miss it.
    const control = /^(a|button|input|select)$/.test(el.tagName.toLowerCase()) || /\bbtn\b/.test(String(el.className || ''));
    if (!control && opaque(cs.backgroundColor) && box.width * box.height > 4000) {
      out.grounds.push({ tag, bg: cs.backgroundColor, area: Math.round(box.width * box.height) });
    }
    // Text this element draws itself.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const size = parseFloat(cs.fontSize) || 16;
    const weight = Number(cs.fontWeight) || 400;
    // CSS `opacity` is not part of the colour, so a colour-only check reads a
    // faded eyebrow as fully opaque white and passes it. Fold the cumulative
    // opacity of the element and its ancestors into the alpha instead.
    let fade = 1;
    for (let n = el; n; n = n.parentElement) fade *= Number(getComputedStyle(n).opacity || 1);
    out.text.push({
      tag, fg: cs.color, bg: groundOf(el), size, weight, fade,
      sample: el.textContent.trim().slice(0, 40),
      large: size >= 24 || (size >= 18.66 && weight >= 700),
    });
  }
  return out;
};

/** Flatten a colour over its ground and hand back a hex, which is what
 *  core.contrast reads. A translucent colour judged un-flattened is judged
 *  against a colour that is not on screen. `fade` is the cumulative CSS
 *  opacity, which multiplies whatever alpha the colour itself carries. */
function flatten(c, bg, fade = 1) {
  const p = parse(c);
  if (!p) return '#000000';
  const m = String(c).match(/rgba\(([^)]+)\)/);
  const own = m ? Number(String(m[1]).split(',')[3]) : 1;
  const alpha = (own >= 0 ? own : 1) * (fade >= 0 ? fade : 1);
  if (alpha >= 0.999) return toHex(p);
  const b = parse(bg) || [255, 255, 255];
  return toHex([0, 1, 2].map((i) => alpha * p[i] + (1 - alpha) * b[i]));
}

async function audit(page, html, label) {
  // Reduced motion so animated-in layers (the video CTA card) are actually on
  // screen when measured, via the renderer's own reduced-motion rules.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const got = await page.evaluate(MEASURE);
  const dark = got.grounds.filter((g) => isDarkNeutral(g.bg));
  const unreadable = got.text
    .map((t) => ({ ...t, ratio: core.contrast(flatten(t.fg, t.bg, t.fade), toHex(parse(t.bg) || [255, 255, 255])) }))
    .filter((t) => t.ratio < (t.large ? 3 : 4.5))
    .map((t) => `${label} ${t.tag}: "${t.sample}" ${t.fg}${t.fade < 1 ? ` @${t.fade}` : ''} on ${t.bg} = ${t.ratio.toFixed(2)}:1`);
  return { dark: dark.map((g) => `${label} ${g.tag} is ${g.bg}`), unreadable, counted: got };
}

// The two branches render DIFFERENT documents, and only measuring the one a
// test happens to reach is how three defects survived a source sweep. A noLLM
// build produces a compact inline-styled page; the flagship /lp/:id page and
// the LLM-branch mailer come from lpHtml/emailHtml and are the ones served to
// real traffic. All four are measured.
const COPY = {
  email: {
    subject: 'Back in your rotation', preheader: 'The pair you were looking at',
    hero_headline: 'Back in your rotation', intro_paragraph: 'It has been a while.',
    body_paragraph: 'Here is what is new since you last looked.', cta: 'See the edit',
  },
  landing: {
    hero_headline: 'Back in your rotation', hero_sub: 'The pair you were looking at, hand painted.',
    why_title: 'Why this edit', why_bullets: ['Hand painted', 'Water resistant', 'Ships worldwide'],
    faq: [{ q: 'How long does it take?', a: 'Express shipping worldwide.' }],
    cta: 'See the edit',
  },
};

// The video creative's CTA card starts at opacity 0 and animates in, so at
// t=0 there is nothing to measure. Its own prefers-reduced-motion block already
// forces `.cta { opacity: 1 }`, so the audit emulates reduced motion and reads
// the card through the path the renderer itself provides.
const motion = require(path.join(ROOT, 'scripts', 'lib', 'motion-ad.js'));
const MOTION_SPEC = {
  loop: false,
  headline: 'Back in your rotation', cta: 'Shop the edit',
  offer: '20% off this week', footnote: 'Terms apply. Free shipping worldwide.',
  scenes: [{ seconds: 2, headline: 'Hand painted', sub: 'On original pairs.' }],
};

function surfaces() {
  const lp = (built.assets.landing_pages || [])[0];
  const lpB = (built.assets.landing_pages || [])[1];
  return [
    ['landing (built, A)', lp && lp.html, 2, 6],
    ['landing (built, B)', lpB && lpB.html, 2, 6],
    ['landing (/lp/:id)', sbPlan.__test_lpHtml(built.calendar_entry || SLOT, COPY, 'cid-1', null), 6, 18],
    ['email (LLM branch)', sbPlan.__test_emailHtml(built.calendar_entry || SLOT, COPY, null), 3, 6],
    ['email (built)', built.assets.email && built.assets.email.html, 2, 6],
    ['video creative', motion.renderMotionAd(MOTION_SPEC), 2, 3],
  ];
}

test('no page the app builds paints a section a dark neutral', async ({ page }) => {
  const bad = [];
  for (const [label, html, minGrounds, minText] of surfaces()) {
    expect(html, `${label}: nothing rendered`).toBeTruthy();
    const r = await audit(page, html, label);
    // Proof the walk inspected a real document rather than an empty one - a
    // check that measures nothing passes everything.
    expect(r.counted.grounds.length, `${label}: only ${r.counted.grounds.length} grounds measured`).toBeGreaterThanOrEqual(minGrounds);
    expect(r.counted.text.length, `${label}: only ${r.counted.text.length} text runs measured`).toBeGreaterThanOrEqual(minText);
    bad.push(...r.dark);
  }
  expect(bad, 'these sections are painted a dark neutral').toEqual([]);
});

test('no page the app builds renders text under the AA floor', async ({ page }) => {
  const bad = [];
  for (const [label, html] of surfaces()) {
    const r = await audit(page, html, label);
    bad.push(...r.unreadable);
  }
  expect(bad, 'this text is under the contrast floor for its size').toEqual([]);
});

test('a brand whose own record carries a near-black primary still gets no black section', async ({ page }) => {
  // Tenant zero's primary is a strong red, so nothing above exercises the guard
  // end to end. This is the case it exists for: a record that predates
  // validatePalette, or one an automatic extractor filled from a site whose
  // theme-color is #111111. The brand's colours are its own; a NEUTRAL used as
  // a section ground is what the rule forbids, and the page has to stay
  // readable either way.
  const brand = {
    id: 'ws-black', slug: 'inkco', name: 'Inkco',
    palette: { primary: '#111111', accent: '#0d0d0d', ink: '#111111', surface: '#FFFFFF', surface_alt: '#f4f4f4' },
  };
  const entry = { ...SLOT, brand, workspace_id: 'ws-black' };
  const pages = [
    ['inkco /lp/:id', sbPlan.__test_lpHtml(entry, COPY, 'cid-black', null)],
    ['inkco email', sbPlan.__test_emailHtml(entry, COPY, null)],
  ];
  for (const [label, html] of pages) {
    const r = await audit(page, html, label);
    expect(r.counted.grounds.length, `${label}: nothing measured`).toBeGreaterThan(1);
    expect(r.dark, `${label} paints a section a dark neutral`).toEqual([]);
    expect(r.unreadable, `${label} renders text under the AA floor`).toEqual([]);
  }
});

/* ── and the rendered mailer, end to end ──────────────────────────────────── */

test('a rendered mailer contains no near-black background declaration', () => {
  if (typeof mailer.renderFlagship !== 'function') {
    test.skip(true, 'renderer not exported under the expected name');
    return;
  }
  for (const colorway of ['violet', 'midnight', 'daylight']) {
    const html = mailer.renderFlagship({
      subject: 'Test', preheader: 'Test preheader', colorway,
      market: 'US', headline: 'A headline', body: 'Some body copy.',
      ctaLabel: 'Shop now', ctaUrl: 'https://example.com',
    });
    expect(typeof html, `${colorway} produced no HTML`).toBe('string');
    // Every background declaration in the rendered document.
    const grounds = [...html.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6}|rgba?\([^)]+\))/g)].map((m) => m[1]);
    const dark = grounds.filter(isDarkNeutral);
    expect(dark, `${colorway} renders these dark-neutral backgrounds`).toEqual([]);
  }
});
