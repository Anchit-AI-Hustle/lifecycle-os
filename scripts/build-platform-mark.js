#!/usr/bin/env node
'use strict';
/**
 * build-platform-mark.js - every raster of the Lifecycle OS mark, from ONE SVG.
 * ---------------------------------------------------------------------------
 *   node scripts/build-platform-mark.js          render every target
 *   node scripts/build-platform-mark.js --list   print the target table
 *   node scripts/build-platform-mark.js --logos  render the logo set only (lockups, wordmark, mono)
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

/* ── The logo set (2026-10-05, design/lifecycle-os/DESIGN.md "Logo") ─────────
   Every lockup is a string transform of the ONE mark file plus the wordmark,
   so a lockup cannot drift from the tab icon. The wordmark is set in the
   system sans (--los-font-wordmark), never a tenant's face, and carries a
   fixed textLength so its width is the same on every machine that renders it;
   the glyph shapes are that machine's system sans, which is why the PNGs are
   rendered once here and committed. Colours are the mark's three neutrals and
   nothing else (the audit's lowSat rule, tests/design-system.spec.js). */
const WORDMARK = 'Lifecycle OS';
const WORDMARK_FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const LOGO_SET = [
  { file: 'assets/lifecycle-os/logos/lockup-horizontal.svg', kind: 'horizontal', use: 'Mark + wordmark on one line: page headers, documents, the share card.' },
  { file: 'assets/lifecycle-os/logos/lockup-stacked.svg', kind: 'stacked', use: 'Mark above the wordmark: square placements, splash, about page.' },
  { file: 'assets/lifecycle-os/logos/wordmark.svg', kind: 'wordmark', use: 'The name alone, where the mark already appears nearby.' },
  { file: 'assets/lifecycle-os/logos/mark-mono.svg', kind: 'mono', use: 'One ink, no tile fill: single-colour print, embossing, a fax-grade copy.' },
  { file: 'assets/lifecycle-os/logos/mark-glyph.svg', kind: 'glyph', use: 'The loop alone in currentColor: inline on a brand band in --vh-on-band, or as a CSS mask (.los-mark-on-band).' },
];
const LOGO_RASTERS = [
  { file: 'assets/lifecycle-os/logos/lockup-horizontal.png', from: 'horizontal', w: 1296, h: 256 },
  { file: 'assets/lifecycle-os/logos/lockup-stacked.png', from: 'stacked', w: 480, h: 336 },
  { file: 'assets/lifecycle-os/logos/wordmark.png', from: 'wordmark', w: 992, h: 192 },
  { file: 'assets/lifecycle-os/logos/mark-mono-512.png', from: 'mono', w: 512, h: 512 },
];

/** The mark's inner content (tile + glyph), with the SVG wrapper and comment stripped. */
function markParts(svg) {
  const src = svg || fs.readFileSync(SVG_PATH, 'utf8');
  const tile = (src.match(/<rect id="tile"[^>]*\/>/) || [])[0];
  const glyph = (src.match(/<g id="glyph">[\s\S]*?<\/g>/) || [])[0];
  if (!tile || !glyph) throw new Error('lifecycle-os-mark.svg lost its tile or glyph');
  return { tile, glyph };
}

/** One logo-set SVG, by kind. Literal neutrals only: an <img> cannot read the page. */
function logoSvg(kind, svg) {
  const t = tokens(svg);
  const { tile, glyph } = markParts(svg);
  const lit = (s) => s.replace(/var\(--los-ink, (#[0-9A-Fa-f]{6})\)/g, '$1').replace(/var\(--los-tile, (#[0-9A-Fa-f]{6})\)/g, '$1').replace(/var\(--los-line, (#[0-9A-Fa-f]{6})\)/g, '$1');
  const mark = (x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 64})">${lit(tile)}${lit(glyph)}</g>`;
  const word = (x, y, size, len, anchor) => `<text x="${x}" y="${y}" font-family="${WORDMARK_FONT}" font-size="${size}" font-weight="700" fill="${t.ink}" textLength="${len}" lengthAdjust="spacingAndGlyphs"${anchor ? ` text-anchor="${anchor}"` : ''}>${WORDMARK}</text>`;
  const open = (w, h, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}"><title>${label}</title>`;
  if (kind === 'horizontal') return open(324, 64, WORDMARK) + mark(0, 0, 64) + word(80, 44, 34, 240) + '</svg>\n';
  if (kind === 'stacked') return open(240, 168, WORDMARK) + mark(72, 4, 96) + word(120, 150, 30, 204, 'middle') + '</svg>\n';
  if (kind === 'wordmark') return open(248, 48, WORDMARK) + word(4, 36, 34, 240) + '</svg>\n';
  if (kind === 'mono') {
    const monoTile = `<rect x="2" y="2" width="60" height="60" rx="14" fill="none" stroke="${t.ink}" stroke-width="3"/>`;
    return open(64, 64, WORDMARK + ' mark, one ink') + monoTile + lit(glyph) + '</svg>\n';
  }
  if (kind === 'glyph') {
    const g = glyph.replace(/var\(--los-ink, #[0-9A-Fa-f]{6}\)/g, 'currentColor');
    return open(64, 64, WORDMARK + ' mark') + g + '</svg>\n';
  }
  throw new Error('unknown logo kind ' + kind);
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
    // --logos renders the logo set only, so adding a lockup does not
    // re-encode every committed icon raster.
    const ONLY_LOGOS = process.argv.includes('--logos');
    for (const target of (ONLY_LOGOS ? [] : TARGETS)) {
      await page.setViewportSize({ width: target.w, height: target.h });
      await page.setContent(documentFor(target, svg), { waitUntil: 'load' });
      const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: target.w, height: target.h }, type: 'png' });
      const out = path.join(ROOT, target.file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, png);
      console.log(`${target.file.padEnd(62)} ${String(target.w).padStart(4)}x${String(target.h).padEnd(4)} ${target.kind.padEnd(9)} ${png.length} bytes`);
    }
    // The logo set: SVGs written from the mark, then their rasters.
    for (const l of LOGO_SET) {
      const out = path.join(ROOT, l.file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, logoSvg(l.kind, svg));
      console.log(`${l.file.padEnd(62)} ${l.kind}`);
    }
    for (const r of LOGO_RASTERS) {
      await page.setViewportSize({ width: r.w, height: r.h });
      const inner = logoSvg(r.from, svg).replace(/ width="\d+" height="\d+"/, ` width="${r.w}" height="${r.h}"`);
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;width:${r.w}px;height:${r.h}px;overflow:hidden}svg{display:block}</style><body>${inner}</body>`, { waitUntil: 'load' });
      const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: r.w, height: r.h }, type: 'png' });
      fs.writeFileSync(path.join(ROOT, r.file), png);
      console.log(`${r.file.padEnd(62)} ${String(r.w).padStart(4)}x${String(r.h).padEnd(4)} ${png.length} bytes`);
    }
    // The adaptive icon's background is a colour RESOURCE, and it is the tile
    // colour so the launcher reads as the same object as the tab icon.
    const colour = path.join(ANDROID_RES, 'values', 'ic_launcher_background.xml');
    if (!ONLY_LOGOS && fs.existsSync(path.dirname(colour))) {
      fs.writeFileSync(colour, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${tokens(svg).tile}</color>\n</resources>\n`);
      console.log(`${path.relative(ROOT, colour).padEnd(62)} background ${tokens(svg).tile}`);
    }
  } finally {
    await browser.close();
  }
}

module.exports = { TARGETS, SVG_PATH, tokens, variant, documentFor, LOGO_SET, LOGO_RASTERS, logoSvg, markParts, WORDMARK, WORDMARK_FONT };

if (require.main === module) {
  if (process.argv.includes('--list')) {
    for (const t of TARGETS) console.log(`${t.file.padEnd(62)} ${t.w}x${t.h} ${t.kind} - ${t.use}`);
    for (const l of LOGO_SET) console.log(`${l.file.padEnd(62)} ${l.kind} - ${l.use}`);
    for (const r of LOGO_RASTERS) console.log(`${r.file.padEnd(62)} ${r.w}x${r.h} from ${r.from}`);
  } else {
    render().catch((e) => { console.error(e); process.exit(1); });
  }
}
