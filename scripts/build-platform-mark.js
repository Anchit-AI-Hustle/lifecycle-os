#!/usr/bin/env node
'use strict';
/**
 * build-platform-mark.js - every raster of the Lifecycle OS mark, from ONE SVG.
 * ---------------------------------------------------------------------------
 *   node scripts/build-platform-mark.js          render every target
 *   node scripts/build-platform-mark.js --list   print the target table
 *
 * WHY. This is a universal brand platform: any brand onboards and the whole app
 * runs as that brand. The app CHROME - the browser-tab icon, the touch icon,
 * the PWA manifest icons, the share card, the Android launcher - is the
 * PLATFORM's identity and must never be a tenant's mark. Until 2026-09-29 the
 * tab icon on every page was tenant zero's logo (favicon.png), and the shell
 * then swapped it for whichever brand was active - so the product never had a
 * mark of its own in the one place a person sees before they read anything.
 *
 * The mark lives once, as assets/lifecycle-os-mark.svg. Everything else is a
 * RENDER of it: no hand-drawn PNG, so the tab icon, the home-screen tile and
 * the launcher cannot drift from each other. There is no pure-Node rasteriser
 * in this repo's dependencies (no sharp, no resvg, no canvas), so the renderer
 * is Playwright's Chromium, which the test suite already needs. That is why
 * the rasters are COMMITTED rather than built at deploy: Vercel's build has no
 * browser. Re-run this script after editing the SVG; the gate
 * (tests/platform-identity.spec.js) checks the committed files' dimensions,
 * that they are not blank, and the corner rule of each kind.
 *
 * THREE SHAPES, because three consumers crop differently:
 *   any        the tile with rounded corners, transparent outside them
 *              (favicon, manifest "any", legacy Android launcher).
 *   fullbleed  the tile filling the whole square, no transparency. iOS paints
 *              transparent touch-icon pixels BLACK and applies its own corner
 *              mask; a maskable PWA icon is cropped by the launcher to a circle,
 *              squircle or rounded square and must have art in every corner.
 *   glyph      the loop alone on transparency, scaled into the centre 66/108 of
 *              the canvas: the Android adaptive-icon foreground, whose
 *              background is a colour resource (values/ic_launcher_background).
 *
 * The three colours are read from the SVG's own <style> block so this script
 * holds no second copy of them.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG_PATH = path.join(ROOT, 'assets', 'lifecycle-os-mark.svg');
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

/** Every file rendered from the mark, with the shape and size the gate checks. */
const TARGETS = [
  { file: 'assets/lifecycle-os-32.png', w: 32, h: 32, kind: 'any', use: 'favicon (PNG fallback for engines without SVG favicons)' },
  { file: 'assets/lifecycle-os-180.png', w: 180, h: 180, kind: 'fullbleed', use: 'apple-touch-icon' },
  { file: 'assets/lifecycle-os-192.png', w: 192, h: 192, kind: 'any', use: 'manifest icon, purpose any' },
  { file: 'assets/lifecycle-os-512.png', w: 512, h: 512, kind: 'any', use: 'manifest icon, purpose any' },
  { file: 'assets/lifecycle-os-512-maskable.png', w: 512, h: 512, kind: 'fullbleed', use: 'manifest icon, purpose maskable' },
  { file: 'assets/lifecycle-os-og.png', w: 1200, h: 630, kind: 'card', use: 'og:image / twitter:image share card' },
];
// Android launcher set (Capacitor shell). dp buckets: mdpi 1x .. xxxhdpi 4x.
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [bucket, scale] of Object.entries(DENSITY)) {
  const px = Math.round(48 * scale), fg = Math.round(108 * scale);
  TARGETS.push({ file: `android/app/src/main/res/mipmap-${bucket}/ic_launcher.png`, w: px, h: px, kind: 'any', use: 'Android legacy launcher' });
  TARGETS.push({ file: `android/app/src/main/res/mipmap-${bucket}/ic_launcher_round.png`, w: px, h: px, kind: 'round', use: 'Android legacy round launcher' });
  TARGETS.push({ file: `android/app/src/main/res/mipmap-${bucket}/ic_launcher_foreground.png`, w: fg, h: fg, kind: 'glyph', use: 'Android adaptive-icon foreground' });
}

/** The mark's own colours, read from its <style> block. */
function tokens(svg) {
  const src = svg || fs.readFileSync(SVG_PATH, 'utf8');
  const out = {};
  for (const m of src.matchAll(/--los-([a-z]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)) out[m[1]] = m[2].toUpperCase();
  for (const k of ['ink', 'tile', 'line']) if (!out[k]) throw new Error(`lifecycle-os-mark.svg declares no --los-${k}`);
  return out;
}

/** The SVG in each of its shapes, by string transform of the one source. */
function variant(svg, kind) {
  const TILE = /<rect id="tile"[^>]*\/>/;
  if (!TILE.test(svg)) throw new Error('lifecycle-os-mark.svg has no <rect id="tile">');
  const t = tokens(svg);
  if (kind === 'any' || kind === 'card') return svg;
  if (kind === 'fullbleed' || kind === 'round') {
    return svg.replace(TILE, `<rect id="tile" x="0" y="0" width="64" height="64" rx="0" fill="${t.tile}"/>`);
  }
  if (kind === 'glyph') return svg.replace(TILE, '');
  throw new Error('unknown kind ' + kind);
}

/** The HTML document Chromium screenshots for one target. */
function documentFor(target, svg) {
  const t = tokens(svg);
  const { w, h, kind } = target;
  const base = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;width:${w}px;height:${h}px;overflow:hidden}svg{display:block}</style>`;
  if (kind === 'card') {
    // The share card: the mark beside the product name on a plain neutral field.
    // No web font (a share card rendered in CI must not depend on a network
    // fetch), so the system sans of the rendering machine is what it uses.
    const mark = 168;
    return base + `<body style="display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box;background:#FFFFFF;font-family:system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:${t.ink}">`
      + `<div style="width:${mark}px;height:${mark}px;flex:none">${variant(svg, 'any').replace('width="64" height="64"', `width="${mark}" height="${mark}"`)}</div>`
      + `<div><div style="font-size:88px;font-weight:700;letter-spacing:-0.02em;line-height:1">Lifecycle OS</div>`
      + `<div style="font-size:30px;line-height:1.35;margin-top:22px;max-width:760px;color:#5B6470">A lifecycle-marketing operating system. Onboard a brand and the whole suite runs as that brand.</div></div></body>`;
  }
  if (kind === 'glyph') {
    // Adaptive-icon foreground: the safe zone is the centre 66dp of 108dp. The
    // loop spans 63% of the SVG's half-width, so the SVG is drawn at 90% of the
    // canvas and the loop lands inside 57% of the half-width: within the zone.
    const s = Math.round(w * 0.9);
    return base + `<body style="display:flex;align-items:center;justify-content:center">${variant(svg, 'glyph').replace('width="64" height="64"', `width="${s}" height="${s}"`)}</body>`;
  }
  const inner = variant(svg, kind).replace('width="64" height="64"', `width="${w}" height="${h}"`);
  if (kind === 'round') return base + `<body><div style="width:${w}px;height:${h}px;border-radius:50%;overflow:hidden">${inner}</div></body>`;
  return base + `<body>${inner}</body>`;
}

async function render() {
  const { chromium } = require('@playwright/test');
  const svg = fs.readFileSync(SVG_PATH, 'utf8');
  // Same guard as tests/playwright.config.js: a sandbox may ship Chromium at a
  // fixed path whose build the pinned download cannot replace.
  const PREINSTALLED = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(fs.existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {});
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const target of TARGETS) {
      await page.setViewportSize({ width: target.w, height: target.h });
      await page.setContent(documentFor(target, svg), { waitUntil: 'load' });
      const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: target.w, height: target.h }, type: 'png' });
      const out = path.join(ROOT, target.file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, png);
      console.log(`${target.file.padEnd(62)} ${String(target.w).padStart(4)}x${String(target.h).padEnd(4)} ${target.kind.padEnd(9)} ${png.length} bytes`);
    }
    // The adaptive icon's background is a colour RESOURCE, and it is the tile
    // colour so the launcher reads as the same object as the tab icon.
    const colour = path.join(ANDROID_RES, 'values', 'ic_launcher_background.xml');
    if (fs.existsSync(path.dirname(colour))) {
      fs.writeFileSync(colour, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${tokens(svg).tile}</color>\n</resources>\n`);
      console.log(`${path.relative(ROOT, colour).padEnd(62)} background ${tokens(svg).tile}`);
    }
  } finally {
    await browser.close();
  }
}

module.exports = { TARGETS, SVG_PATH, tokens, variant, documentFor };

if (require.main === module) {
  if (process.argv.includes('--list')) {
    for (const t of TARGETS) console.log(`${t.file.padEnd(62)} ${t.w}x${t.h} ${t.kind} - ${t.use}`);
  } else {
    render().catch((e) => { console.error(e); process.exit(1); });
  }
}
