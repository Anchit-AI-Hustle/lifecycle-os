// Effects that quietly do not exist on a phone.
//
// "Effects missing when opened on mobile" turned out to have several causes,
// and they share a shape: a CSS feature the desktop browser in front of the
// author supports and the phone in front of the reader does not. Nothing errors
// — the declaration is simply dropped, and the effect is absent. It never shows
// up in review because review happens on the desktop.
//
// This file fails on the two forms of that already found in this repo:
//
//   backdrop-filter — Safari has only shipped it unprefixed very recently, so
//   without -webkit-backdrop-filter the blur is absent on almost every iPhone.
//   Two files here already carried the prefix and eighteen declarations across
//   eleven others did not, so this was inconsistency rather than a decision.
//
//   color-mix() — an engine without it drops the whole declaration as invalid
//   at parse time; it does not fall back. iOS Safari shipped it in 16.2. In the
//   video creative that removed the scrim, both text shadows and the CTA's
//   ground at once. Where the inputs are known colours and fixed percentages,
//   the mix belongs in the renderer, not in the viewer's engine.
//
// Run: npx playwright test tests/mobile-effects.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Every HTML page and every generated-asset renderer, minus vendor trees. */
function sources() {
  const out = [];
  const skip = /(^|\/)(node_modules|\.git|test-results|vendor|coverage)(\/|$)/;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(ROOT, p);
      if (skip.test(rel)) continue;
      if (e.isDirectory()) { walk(p); continue; }
      if (/\.(html|css)$/.test(e.name)) out.push(rel);
      // Renderers that emit CSS into a generated asset.
      else if (/\.js$/.test(e.name) && /^(scripts\/lib|api\/_shared|lib)\//.test(rel)) out.push(rel);
    }
  };
  walk(ROOT);
  return out;
}

const FILES = sources();

test('the file sweep actually found the pages it is about', () => {
  // A check that inspects nothing passes everything.
  expect(FILES.length, 'no source files were collected').toBeGreaterThan(30);
  expect(FILES.some((f) => f === 'lifecycle_mailer_architect_v34.html')).toBe(true);
  expect(FILES.some((f) => f === 'scripts/lib/motion-ad.js')).toBe(true);
});

test('every backdrop-filter carries the -webkit- form Safari reads', () => {
  const unpaired = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const re = /(?<!-webkit-)\bbackdrop-filter\s*:/g;
    for (const m of src.matchAll(re)) {
      // The prefixed twin sits immediately before it in the same declaration
      // block; a short lookback is enough and keeps the check cheap.
      if (!src.slice(Math.max(0, m.index - 90), m.index).includes('-webkit-backdrop-filter')) {
        const line = src.slice(0, m.index).split('\n').length;
        unpaired.push(`${f}:${line}`);
      }
    }
  }
  expect(unpaired, 'these blurs are absent on Safari').toEqual([]);
});

test('no generated asset asks the viewer engine to compute a color-mix', () => {
  // Scoped to what a CUSTOMER opens — an asset the app emits, rendered in
  // whatever browser or email client the reader happens to have. The operator
  // console is a different audience with a different floor, and brand-extract's
  // mention is a parser pattern rather than a style.
  const RENDERERS = FILES.filter((f) => /^(scripts\/lib|lib\/smart-brain)\//.test(f)
    || /^api\/_shared\/(calendar-trigger|smart-brain-plan|landing-fallback|brand-workspace-core)\.js$/.test(f));
  expect(RENDERERS.length, 'no renderers were collected').toBeGreaterThan(3);
  const uses = [];
  for (const f of RENDERERS) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    for (const m of src.matchAll(/color-mix\s*\(/g)) {
      uses.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  expect(uses, 'an engine without color-mix drops these declarations whole').toEqual([]);
});
