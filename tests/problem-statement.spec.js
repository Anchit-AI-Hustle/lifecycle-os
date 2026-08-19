// What problem does this solve? Answered on screen, before anything else.
//
// The homepage led with "Run your whole lifecycle programme as one brand" and a
// lede describing capabilities. Both answer "what is this". A first visitor read
// two paragraphs of features before reaching a single line of purpose, and the
// full problem statement — which is good — sat below a fold nobody scrolled to.
//
// These tests RENDER the page and measure. A grep for the words would pass on
// text that is present, positioned below three screens of content, or invisible
// against its own background.
//
// Run: npx playwright test tests/problem-statement.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

let server; let base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
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
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

async function open(page, file) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({
    status: 200, contentType: 'text/javascript',
    body: 'window.tailwind = window.tailwind || {}; window.Papa = window.Papa || { unparse: () => "" };',
  }));
  await page.goto(base + '/' + file, { waitUntil: 'domcontentloaded' });
}

/* ═══ the homepage ════════════════════════════════════════════════════════ */

test('the homepage states the problem above the fold', async ({ page }) => {
  await open(page, 'index.html');
  const el = page.locator('#solving');
  await expect(el, 'the homepage has no problem statement').toBeVisible();

  // Above the fold at the desktop width the app is designed around. A statement
  // that requires a scroll is one most visitors never read.
  const box = await el.boundingBox();
  const vh = page.viewportSize().height;
  expect(box, 'the problem statement has no box').toBeTruthy();
  expect(box.y, `the problem statement starts ${Math.round(box.y)}px down, below the fold (${vh}px)`)
    .toBeLessThan(vh);
});

test('the problem is read before the feature list', async ({ page }) => {
  await open(page, 'index.html');
  // DOM order, which is also reading order and screen-reader order.
  const order = await page.evaluate(() => {
    const solving = document.querySelector('#solving');
    const features = document.querySelector('.grid .card');
    if (!solving || !features) return null;
    // Node.compareDocumentPosition: 4 = features FOLLOWS solving.
    return (solving.compareDocumentPosition(features) & 4) ? 'problem-first' : 'features-first';
  });
  expect(order, 'the feature grid is read before the problem').toBe('problem-first');
});

test('the statement names the problem and the answer, not just a slogan', async ({ page }) => {
  await open(page, 'index.html');
  const text = (await page.locator('#solving').innerText()).toLowerCase();
  // The two failures this product exists to prevent. Both must be named, in
  // words, on the first screen — not alluded to.
  expect(text, 'the fabrication problem is not named').toMatch(/invent|fabricat|made up/);
  expect(text, 'the cross-brand problem is not named').toMatch(/brand/);
  // And it must say what the platform does about it, or it is a complaint.
  expect(text).toMatch(/stays missing|says so|cannot reach/);
  // Long enough to be a statement, short enough to be read standing up.
  const words = text.split(/\s+/).filter(Boolean).length;
  expect(words).toBeGreaterThan(25);
  expect(words).toBeLessThan(120);
});

test('the full statement is still there, below', async ({ page }) => {
  await open(page, 'index.html');
  // The hero line is a summary, not a replacement. The detailed version has to
  // survive, or the page loses the part that explains the consequence.
  await expect(page.locator('.problem')).toBeVisible();
  const full = await page.locator('.problem').innerText();
  expect(full.split(/\s+/).length).toBeGreaterThan(120);
});

test('every part of the problem statement is legible against its background', async ({ page }) => {
  await open(page, 'index.html');
  // This repo's standing rule: no dark-on-dark, no light-on-light. A statement
  // nobody can read is the same as one that is not there.
  //
  // EVERY element in the block, not just the container. Measuring only #solving
  // read the paragraph's own colour and never the eyebrow's — which is how a
  // raw `var(--primary)` sat there as a text colour, caught by
  // contrast-rendered.spec.js instead of by this file.
  const results = await page.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const bgOf = (el) => {
      let n = el;
      while (n) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return parse(c);
        n = n.parentElement;
      }
      return [255, 255, 255];
    };
    const root = document.querySelector('#solving');
    const nodes = [root, ...root.querySelectorAll('*')];
    return nodes
      // Only elements that actually render text of their own.
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((el) => {
        const [a, b] = [lum(parse(getComputedStyle(el).color)), lum(bgOf(el))].sort((x, y) => y - x);
        return {
          tag: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
          ratio: (a + 0.05) / (b + 0.05),
        };
      });
  });
  expect(results.length, 'no text elements found in the statement').toBeGreaterThan(1);
  for (const r of results) {
    // 4.5:1 is the AA body-text floor; the eyebrow is small and bold, so it
    // gets no large-text exemption.
    expect(r.ratio, `${r.tag} is ${r.ratio.toFixed(2)}:1, below the AA body-text floor`).toBeGreaterThanOrEqual(4.5);
  }
});

test('the statement uses the contrast-adjusted brand tokens, not a raw brand colour', async ({ page }) => {
  await open(page, 'index.html');
  // The rule the raw `var(--primary)` broke. A brand primary is chosen to fill
  // a shape, not to be read at 11px — `--brand-primary-text` is the same hue
  // darkened until it clears AA against the surface it sits on.
  //
  // NOT redundant with the measured test above, and the margin shows why:
  // tenant zero's #D0473E on white is 4.51:1, a hundredth over the floor. So
  // measurement passes for the brand that happens to be loaded and says
  // nothing about the other 82 in the preset library. This rule is what covers
  // them, which is why it is asserted on the CSS rather than on a rendering.
  const raw = await page.evaluate(() => {
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const block = css.slice(css.indexOf('.solving'), css.indexOf('.problem{'));
    return (block.match(/color\s*:\s*var\(--(primary|accent)\)/g) || []);
  });
  expect(raw, 'a raw brand colour is used as a text colour').toEqual([]);
});

/* ═══ the dashboard ═══════════════════════════════════════════════════════ */

test('the dashboard says what it is for before it shows a number', async ({ page }) => {
  // A dashboard's whole job is to be trusted, so the reader is told what a
  // blank cell means BEFORE they interpret one as a zero.
  await open(page, 'all-in-one.html');
  const note = page.locator('.problem-note');
  await expect(note).toBeVisible();
  const text = (await note.innerText()).toLowerCase();
  expect(text).toMatch(/blank|dash/);
  expect(text, 'the dashboard does not say a blank is not a zero').toMatch(/never means none|not.*zero/);
});
