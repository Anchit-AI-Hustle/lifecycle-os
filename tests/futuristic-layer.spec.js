/**
 * The futuristic layer, measured in a browser rather than read off the file.
 * ---------------------------------------------------------------------------
 * This layer restyles ~50 self-contained pages from one stylesheet, so its
 * failure modes are app-wide. Three of them already happened while it was being
 * written, and each has a test here because none would have been caught by
 * reading the CSS:
 *
 *   1. `backdrop-filter` on #lifecycle-nav MOVED THE ENTIRE NAV RAIL. That id is
 *      a static, zero-height container; the visible rail is a position:fixed
 *      CHILD. backdrop-filter (like filter and transform) makes its element a
 *      containing block for fixed descendants, so the rail stopped being
 *      anchored to the viewport and floated into the middle of the page over
 *      the content. The CSS is completely valid. Only rendering shows it.
 *
 *   2. Porting the block to the sibling repo carried tenant zero's palette
 *      hexes — written inline as fallbacks — into a repo whose brand is green
 *      and gold. Every card in that app drew another company's colours.
 *
 *   3. The sheen's opacity sat on the :hover rule instead of in the keyframes,
 *      so when the animation finished the bar snapped back to the card's left
 *      edge and STAYED there at full strength for as long as the cursor
 *      lingered — a white slab over the content.
 *
 * Run: npx playwright test tests/futuristic-layer.spec.js
 */
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

/** The layer under test, sliced out of theme.css by its own banner. */
function futuristicBlock() {
  const css = fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8');
  const i = css.indexOf('FUTURISTIC LAYER (2026-08-25)');
  expect(i, 'the futuristic layer is gone from theme.css').toBeGreaterThan(-1);
  return css.slice(i);
}

let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

async function open(page, file, brand) {
  // Nothing here may leave the machine. A goto that waits on Google Fonts or a
  // CDN spends ~13s per navigation failing slowly, and this file navigates
  // seven times. Scripts get an inert stub because a couple of pages read a
  // global from one; everything else is ABORTED outright rather than answered.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => (
    route.request().resourceType() === 'script'
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind = window.tailwind || {};' })
      : route.abort('failed')));
  await page.route(/\/api\//, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [], entries: [] }),
  }));
  if (brand) {
    // Exactly what brand-context.js does: write the active workspace's tokens
    // onto <html> as inline style.
    await page.addInitScript((b) => {
      document.addEventListener('DOMContentLoaded', () => {
        for (const [k, v] of Object.entries(b)) document.documentElement.style.setProperty(k, v);
      });
    }, brand);
  }
  await page.goto(base + '/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
}

/* ═══ 1. the rail is still anchored to the viewport ═══════════════════════ */

test('the nav rail stays pinned to the viewport edge', async ({ page }) => {
  await open(page, 'smart-brain.html');
  const rail = await page.evaluate(() => {
    const el = document.querySelector('#lifecycle-nav .lnav-side');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { position: getComputedStyle(el).position, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
  });
  expect(rail, 'the rail is missing entirely').not.toBeNull();
  expect(rail.position, 'the rail is no longer fixed').toBe('fixed');
  expect(rail.y).toBe(0);
  expect(rail.w, 'the rail is no longer rail-width').toBeLessThan(400);

  // x <= 0 is the invariant that holds on EVERY viewport, and asserting x === 0
  // everywhere was wrong: below the breakpoint the rail is a drawer, docked
  // off-canvas at translateX(-100%), so its measured x is -248 on a phone and a
  // tablet. The defect this guards produced x = +276 — pushed INTO the content,
  // because a backdrop-filter on the static #lifecycle-nav container made it the
  // containing block for its position:fixed child. Off-canvas is a layout
  // decision; positive is always the bug.
  expect(rail.x, 'the rail has been pushed into the content — check for a filter, backdrop-filter or transform on an ancestor')
    .toBeLessThanOrEqual(0);

  // Where the rail is DOCKED, it must sit exactly on the edge.
  const docked = await page.evaluate(() => {
    const el = document.querySelector('#lifecycle-nav .lnav-side');
    return getComputedStyle(el).transform === 'none';
  });
  if (docked) expect(rail.x, 'a docked rail must sit on the viewport edge').toBe(0);
});

test('no ancestor of the rail creates a containing block for fixed children', async ({ page }) => {
  await open(page, 'smart-brain.html');
  const culprits = await page.evaluate(() => {
    const el = document.querySelector('#lifecycle-nav .lnav-side');
    const out = [];
    let p = el && el.parentElement;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (s.transform !== 'none' || s.filter !== 'none' || s.backdropFilter !== 'none' || s.perspective !== 'none') {
        out.push(`${p.tagName}#${p.id || ''}.${String(p.className || '').slice(0, 30)} transform=${s.transform} filter=${s.filter} backdrop=${s.backdropFilter}`);
      }
      p = p.parentElement;
    }
    return out;
  });
  expect(culprits, `these ancestors would re-anchor the fixed rail:\n${culprits.join('\n')}`).toEqual([]);
});

/* ═══ 2. the layer is brand-driven, with no tenant's colour written in ════ */

test('the layer contains no colour literal at all', () => {
  // Deliberately stricter than "no tenant-zero hex". ANY hex here would be a
  // colour this layer decided for itself, and the point of the layer is that it
  // decides none: it reads --brand-* and falls back to the repo's own token.
  // Neutral white/black translucency is written as rgba() and is not a brand
  // decision.
  //
  // MASKS ARE EXCLUDED, and the distinction is real rather than a convenience.
  // A mask-image uses only the ALPHA channel of its gradient — `#000` there means
  // "opaque here", and swapping it for the brand colour would change nothing on
  // screen. It is a shape, not a colour, so counting it would train whoever
  // trips this test to add exceptions until the check means nothing.
  const block = futuristicBlock().replace(/(-webkit-)?mask-image\s*:[^;]+;/g, ' ');
  const hexes = block.match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
  expect(hexes, `colour literals in the futuristic layer: ${hexes.join(', ')}`).toEqual([]);
});

test('every card draws the ACTIVE brand colour, not a shipped default', async ({ page }) => {
  // Two colours no palette in either repo uses, so a match cannot be luck.
  await open(page, 'smart-brain.html', { '--brand-primary': 'rgb(0, 128, 255)', '--brand-accent': 'rgb(255, 0, 128)' });

  const found = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.vh-card, .card, .panel, .kpi, .tile')];
    return els.map((e) => getComputedStyle(e).backgroundImage).filter((b) => b && b !== 'none');
  });
  expect(found.length, 'no card surface was found to measure — this test would pass on any stylesheet').toBeGreaterThan(0);

  const withBrand = found.filter((b) => b.includes('rgb(0, 128, 255)') && b.includes('rgb(255, 0, 128)'));
  expect(withBrand.length, 'no card drew the active brand colours; the energy line is not brand-driven').toBeGreaterThan(0);
});

/* ═══ 3. the iOS trap: an unprefixed backdrop-filter is silently dropped ═══ */

test('every backdrop-filter carries its -webkit- pair', () => {
  // A claim about the FILE, and a file check is the right tool: the question is
  // whether the declaration is written, not what it computes to. On almost every
  // iPhone the unprefixed form is simply discarded and the blur is absent — no
  // error, no fallback, just a flat panel nobody notices on a desktop.
  //
  // Checked PER OCCURRENCE, not by comparing totals. The totals version is what
  // this test did first, and it passed while theme.css was genuinely wrong: the
  // @supports condition listed the unprefixed form first, so the counts balanced
  // (one of each) and the real app-wide gate in mobile-effects.spec.js failed
  // instead. Two equal numbers are not evidence that each one is paired with the
  // other. Same lookback as that gate, so a weaker duplicate cannot go green
  // while the stronger one goes red.
  const block = futuristicBlock();
  const unpaired = [];
  for (const m of block.matchAll(/(?<!-webkit-)\bbackdrop-filter\s*:/g)) {
    if (!block.slice(Math.max(0, m.index - 90), m.index).includes('-webkit-backdrop-filter')) {
      unpaired.push(`offset ${m.index}`);
    }
  }
  const total = [...block.matchAll(/(?<!-webkit-)\bbackdrop-filter\s*:/g)].length;
  expect(total, 'no backdrop-filter found — the extraction is broken').toBeGreaterThan(0);
  expect(unpaired, `these blurs would be absent on Safari: ${unpaired.join(', ')}`).toEqual([]);
});

test('the blur is behind an @supports gate', () => {
  const block = futuristicBlock();
  expect(block).toMatch(/@supports\s*\(\((?:-webkit-)?backdrop-filter/);
});

/* ═══ 4. reduced motion loses motion, never content ═══════════════════════ */

test('with reduced motion the surfaces are still fully visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'smart-brain.html');

  const hidden = await page.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll('.vh-card, .card, .panel, .kpi')) {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      if (r.width > 40 && r.height > 20 && (s.opacity === '0' || s.visibility === 'hidden')) {
        out.push(String(e.className).slice(0, 40));
      }
    }
    return out;
  });
  expect(hidden, `reduced motion hid these surfaces: ${hidden.join(', ')}`).toEqual([]);
});

test('the ambient field never intercepts a click', async ({ page }) => {
  await open(page, 'smart-brain.html');
  const bad = await page.evaluate(() => {
    const out = [];
    for (const which of ['::before', '::after']) {
      const s = getComputedStyle(document.body, which);
      if (s.content !== 'none' && s.pointerEvents !== 'none') out.push(`body${which} pointer-events=${s.pointerEvents}`);
    }
    return out;
  });
  expect(bad, `the ambient field would swallow input: ${bad.join(', ')}`).toEqual([]);
});

/* ═══ 5. the sheen cleans up after itself ════════════════════════════════ */

test('the sheen fades out inside its own keyframes', () => {
  // If opacity lives on :hover instead, the bar returns to the card's left edge
  // when the animation ends and sits there. Asserted on the file because the
  // defect is structural — which rule owns the property — and reproducing it in
  // a browser needs a real hover held past the animation's end.
  const block = futuristicBlock();
  const kf = block.slice(block.indexOf('@keyframes vh-sheen'));
  const body = kf.slice(0, kf.indexOf('}\n  .vh-card::before') + 1);
  expect(body, 'the sheen keyframes do not animate opacity').toMatch(/opacity:\s*0\s*;/);
  const hoverRule = (block.match(/\.vh-card:hover::before\s*\{[^}]*\}/) || [''])[0];
  expect(hoverRule, 'the sheen hover rule sets a resting opacity — it will stick after the animation')
    .not.toMatch(/opacity\s*:/);
});
