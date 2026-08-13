// Every word on every page has to be readable, for ANY brand.
//
// The previous contrast guard was a CSS pattern match: it caught text hardcoded
// light on a brand-token background. It could not catch the failure that was
// actually shipping - a rule writing `color: var(--brand-primary)` for a badge,
// a link, an active step or a stat. That is legible only while the brand's
// primary happens to be dark. Onboard a brand with a LIGHT primary and those
// elements render perfectly and invisibly: the "ACTIVE" badge on the brand list
// and the completed steps in the onboarding wizard were white on white.
//
// Pattern matching cannot see that, because nothing in the CSS is wrong - the
// value depends on a brand that does not exist until a customer creates it. So
// this measures instead: it paints every page with a deliberately awkward
// palette and computes the REAL rendered contrast of every visible text node,
// walking up for the effective background and folding in inherited opacity.
//
// Run: npx playwright test tests/contrast-rendered.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

/* A palette chosen to break things, not to flatter them: a pale coral primary
   and a pale sky accent that are invisible as text on white, and a light grey
   "muted" that fails on its own. Every one of these is a palette a real brand
   could reasonably pick - the validator accepts them, because there is nothing
   wrong with a light brand colour. It just cannot be used as text unchanged. */
const HOSTILE = {
  primary: '#F3B6B1',
  accent: '#BFDCF5',
  ink: '#1A1A1A',
  surface: '#FFFFFF',
  surface_alt: '#FFFFFF',
  muted: '#C8CCD0',
};

const BRAND = {
  id: 'ws_hostile', slug: 'hostile', name: 'Hostile Palette Co',
  palette: HOSTILE,
  typography: { heading: { family: 'Inter', stack: "'Inter',sans-serif" }, body: { family: 'Inter', stack: "'Inter',sans-serif" } },
  voice: {},
  regions: [{ code: 'US', currency: 'USD', symbol: '$', store_url: 'https://us.example' }],
  // The REAL token computation, not a restatement of it. If tokens() stops
  // deriving a readable text colour, these tests fail rather than passing
  // against a fixture that quietly disagrees with production.
  tokens: core.tokens({ palette: HOSTILE, typography: {} }),
};

let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, brand: BRAND, workspaces: [] })); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

/* The measurement, run in the page. Deliberately conservative about what it
   reports, because a guard that cries wolf gets switched off:
     - only elements with their own visible, non-whitespace text
     - skips anything not actually painted (hidden, zero-size, off-screen)
     - composites the element's own alpha AND every inherited opacity, which is
       how a `.5` on a wrapper silently halves a child's contrast
     - walks ancestors for the first opaque background, compositing translucent
       ones on the way, rather than assuming white
     - applies the WCAG large-text allowance (3:1 at >=24px, or >=18.66px bold) */
const PROBE = `(() => {
  const AA = 4.5, AA_LARGE = 3.0;
  function parse(c) {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });

  /* Returns null when an ancestor paints an IMAGE (a gradient, a photo). Its
     computed backgroundColor is transparent, so walking past it composites the
     text against whatever is behind - which reported the user avatar, white on
     a purple-to-red gradient, as white on white. A guard that cries wolf gets
     switched off, so an element whose backdrop cannot be measured is reported
     as unmeasurable and skipped rather than failed. */
  function backdrop(el) {
    let node = el, acc = null;
    while (node && node !== document.documentElement.parentNode) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (c.a >= 1) return acc; }
      node = node.parentElement;
    }
    return acc && acc.a >= 1 ? acc : over(acc || { r: 255, g: 255, b: 255, a: 0 }, { r: 255, g: 255, b: 255, a: 1 });
  }

  function effectiveOpacity(el) {
    let o = 1, node = el;
    while (node && node.nodeType === 1) { o *= parseFloat(getComputedStyle(node).opacity || '1'); node = node.parentElement; }
    return o;
  }

  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const op = effectiveOpacity(el);
    if (op < 0.06) continue;                       // deliberately hidden, not a contrast bug
    // WCAG 1.4.3 exempts INACTIVE controls: a disabled button is dimmed on
    // purpose and has no contrast requirement. Flagging it would push us toward
    // "fixing" the one visual cue that says it cannot be pressed.
    if (el.closest('[disabled],[aria-disabled="true"],fieldset:disabled')) continue;
    // Mid-flight reveal animations are not a contrast failure - the element is
    // on its way to opacity 1 and this is a snapshot of the journey. Only skip
    // when the page SAYS it is animating opacity; a permanently dimmed element
    // has no such transition and is still measured.
    if (op < 1 && /opacity|all/.test(s.transitionProperty || '') && parseFloat(s.transitionDuration) > 0) continue;
    if (op < 1 && s.animationName && s.animationName !== 'none') continue;
    // ...and the Web Animations API, which is how Motion One's animate() runs a
    // reveal. It sets NEITHER transitionProperty NOR animationName, so the two
    // checks above miss it entirely: the probe caught a stats tile at opacity
    // 0.49 on its way from 0 to 1 and called it an unreadable label. Only a
    // RUNNING animation counts - a finished one has left the element at its
    // real opacity, which is still measured.
    if (op < 1 && typeof el.getAnimations === 'function') {
      try {
        if (el.getAnimations().some((a) => a.playState === 'running')) continue;
      } catch (e) { /* not animatable in this engine */ }
    }
    const fg = parse(s.color); if (!fg) continue;
    const bg = backdrop(el);
    if (!bg) continue;                             // painted over an image/gradient - not measurable here
    // Fold BOTH the colour's own alpha and every inherited opacity into the
    // painted colour - that is what the eye actually receives.
    const painted = over({ ...fg, a: fg.a * op }, bg);
    const size = parseFloat(s.fontSize) || 16;
    const weight = parseInt(s.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? AA_LARGE : AA;
    const got = ratio(painted, bg);
    if (got + 0.005 < need) {
      out.push({
        tag: el.tagName.toLowerCase(), cls: (el.className && el.className.toString().slice(0, 40)) || '',
        text: own.slice(0, 45), got: Math.round(got * 100) / 100, need, size, opacity: Math.round(op * 100) / 100,
        color: s.color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
      });
    }
  }
  return out;
})()`;

/* The signed-in app surfaces. Generated marketing artefacts and the frozen diff
   viewer are excluded: they are not the app, and they carry their own
   deliberate palettes. */
const PAGES = [
  'onboarding.html', 'index.html', 'brand.html', 'credits.html', 'telesuite.html',
  'data-analysis.html', 'dashboard.html', 'calendar.html', 'smart-brain.html',
  'research.html', 'knowledge-base.html', 'competitor-benchmarking.html',
  'ad-campaigns.html', 'landing-pages.html', 'assets.html', 'social-media.html',
  'growth-os.html', 'kicksgpt.html', 'cohort-definitions.html', 'payments.html',
  'brand-connections.html', 'team.html', 'app-audit.html',
];

for (const p of PAGES) {
  test(`${p} is readable under a light brand palette`, async ({ page }) => {
    await page.route('**/api/public-config**', (r) => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: BRAND, workspaces: [] }),
    }));
    await page.goto(base + '/' + p, { waitUntil: 'load' });
    // Wait for the tokens to be PAINTED, not merely for the layer to report
    // loaded. Measuring before that grades theme.css's built-in defaults, which
    // is not what a customer sees - and it produced a batch of failures naming
    // tenant zero's red on the rail's fallback tan, on pages that were fine
    // once the brand arrived. This asserts rather than swallowing a timeout: a
    // page where the brand never paints is itself worth failing on.
    await page.waitForFunction(
      () => document.documentElement.style.getPropertyValue('--brand-primary').trim() !== '',
      // 30s, not 20s: this competes with three other workers, and the heaviest
      // page here is ~78KB of inline script plus its extensions. It timed out
      // once in three full-suite runs and passed alone every time - a flake
      // that reddens CI at random is worth the extra ten seconds, and the test
      // budget is 60s so there is room.
      null, { timeout: 30000 },
    );
    await page.waitForTimeout(400);

    const bad = await page.evaluate(PROBE);
    const summary = bad.slice(0, 12).map((b) => `  ${b.tag}.${b.cls} "${b.text}" ${b.got}:1 (needs ${b.need}, ${b.size}px, opacity ${b.opacity}) ${b.color} on ${b.bg}`).join('\n');
    expect(bad, `${bad.length} unreadable text nodes on ${p}:\n${summary}`).toEqual([]);
  });
}

test('the brand colour has a readable text form, and it is what pages use', async () => {
  // The root cause in one assertion. readableOn answers what to write ON a
  // primary fill; nothing answered what to write IN the primary colour, so
  // pages used the raw brand colour and inherited its lightness.
  const t = core.tokens({ palette: HOSTILE, typography: {} });
  expect(core.contrast(HOSTILE.primary, '#FFFFFF')).toBeLessThan(2);      // unusable as text
  expect(core.contrast(t['--brand-primary-text'], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  expect(core.contrast(t['--brand-accent-text'], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  // Muted is the colour of most small print on every page, so it gets the same
  // floor rather than a fixed lift toward white with no floor at all.
  expect(core.contrast(t['--brand-ink-muted'], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
});

/* Hue of a hex, 0..360 - used to prove the adjustment stays on the brand's own
   colour instead of sliding toward a generic dark grey. */
function hueOf(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

test('a brand colour that already reads well is left alone', async () => {
  // The adjustment must be a floor, not a filter.
  const dark = { primary: '#6A33D8', accent: '#D0473E', ink: '#111111', surface: '#FFFFFF', surface_alt: '#FFFFFF' };
  const t = core.tokens({ palette: dark, typography: {} });

  // Clear of the floor by a wide margin (6.8:1) - returned byte-identical.
  expect(core.contrast(dark.primary, '#FFFFFF')).toBeGreaterThan(core.TEXT_AA);
  expect(t['--brand-primary-text'].toLowerCase()).toBe('#6a33d8');

  // Tenant zero's own red is the interesting case: 4.51:1 on white, i.e. it
  // passes bare WCAG AA by a hundredth and has nothing left for the tinted
  // states the shell paints over the surface. It IS below the floor, so it does
  // move - and the floor is read from core.TEXT_AA rather than restated here,
  // because a test that restates it is how this file came to assert 4.5 while
  // tokens() had been built on 4.9 since the token was introduced. What must
  // not happen is the colour being REPLACED rather than deepened.
  expect(core.contrast(dark.accent, '#FFFFFF')).toBeLessThan(core.TEXT_AA);
  const accentText = t['--brand-accent-text'];
  expect(core.contrast(accentText, '#FFFFFF')).toBeGreaterThanOrEqual(core.TEXT_AA);
  expect(hueOf(accentText)).toBeCloseTo(hueOf(dark.accent), 0);   // still the brand's red
  expect(core.saturation(accentText)).toBeGreaterThan(0.4);       // not a grey
  // and it stops at the floor rather than darkening past it
  expect(core.contrast(accentText, '#FFFFFF')).toBeLessThan(core.TEXT_AA + 0.5);
});

test('no page writes the raw brand colour as a text colour', async () => {
  // The measurement above only covers pages it loads. This covers every one of
  // them, and is what stops the pattern coming back in a page added later.
  const RAW = /(?<![-\w])color\s*:\s*var\(\s*--(brand-primary|primary|green|knickgasm-green|brand-accent|accent|lava|knickgasm-lava)\s*[,)]/;
  const offenders = [];
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.html'))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = src.match(RAW);
    if (m) offenders.push(`${f}: ${m[0]}`);
  }
  expect(offenders, `use var(--brand-primary-text) / var(--brand-accent-text), which are contrast-adjusted per brand:\n${offenders.join('\n')}`).toEqual([]);
});
