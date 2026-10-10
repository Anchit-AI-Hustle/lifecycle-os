'use strict';
/**
 * scripts/lib/design-system-artifact.js - the Lifecycle OS Design System
 * artifact's project/ files, written FROM the repo's own design-system outputs.
 * ---------------------------------------------------------------------------
 * Called by `node scripts/build-design-system.js --artifact <dir>`. Nothing here
 * holds a value of its own:
 *   tokens.json        the contract (tokens() per palette, theme.css scales),
 *                      reshaped into the artifact type's LIST families; the six
 *                      gate palettes become its themes, the platform neutral first
 *   README.md          design/lifecycle-os/DESIGN.md's prose
 *   contract.md        design/lifecycle-os/CONTRACT.md, verbatim
 *   brand-schema.md    design/lifecycle-os/BRAND-SCHEMA.md, verbatim
 *   components/        bundle.css = theme.css (minus its no-brand fallbacks) +
 *                      the rail's own style block from auth.js; one card per
 *                      component, its markup lifted from /design-system
 *   assets/            the logo set, the icon set and the illustrations, as
 *                      files to upload, with a README per group
 * So the published system and the repo cannot disagree: re-run this and
 * republish when either changes.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const assets = require(path.join(ROOT, 'scripts', 'build-design-assets.js'));
const mark = require(path.join(ROOT, 'scripts', 'build-platform-mark.js'));

const SYS = 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/* ── tokens.json, list-shaped ──────────────────────────────────────────────── */

function tokensJson(c, meta) {
  const themes = c.examples.map((e) => ({ id: e.id, name: e.name }));
  const colour = [];
  const by = (name) => Object.fromEntries(c.examples.map((e) => [e.id, String(e.tokens['--' + name] || '').toLowerCase()]));
  colour.push({ name: 'los-ink', value: c.platform.mark.ink.toLowerCase(), usage: 'The mark\'s ink (assets/lifecycle-os-mark.svg). Platform identity: the same in every theme, never a brand colour.' });
  colour.push({ name: 'los-tile', value: c.platform.mark.tile.toLowerCase(), usage: 'The mark\'s tile. Platform identity.' });
  colour.push({ name: 'los-line', value: c.platform.mark.line.toLowerCase(), usage: 'The mark\'s hairline. Platform identity.' });
  for (const t of c.brand_tokens) {
    const name = t.name.replace(/^--/, '');
    colour.push({ name, value: by(name), usage: `${t.usage} Derived: ${t.derivation}.` });
  }
  for (const t of c.app_tokens) {
    const name = t.name.replace(/^--/, '');
    colour.push({ name, value: `{${t.resolves.replace(/^--/, '')}}`, usage: `${t.usage} Pages use this role; it resolves through ${t.resolves}.` });
  }
  const px = (v) => { const m = String(v).match(/(\d+(?:\.\d+)?)px\s*\)?\s*$/); return m ? `${m[1]}px` : String(v); };
  const fsz = Object.fromEntries(c.type.scale.map((x) => [x.name.replace('vh-fs-', ''), x.value]));
  return {
    name: 'Lifecycle OS',
    version: 1,
    meta,
    color: { themes, tokens: colour },
    type: {
      fonts: [],
      families: { heading: SYS, body: SYS, mono: MONO, wordmark: SYS },
      groups: [
        {
          name: 'Text',
          family: 'body',
          note: 'Headings render in the ACTIVE brand\'s heading face and text in its body face (--vh-font-head, --vh-font-body); the system sans stands in here. Fluid steps are recorded at their desktop maximum.',
          styles: [
            { name: 'heading-1', family: 'heading', fontSize: px(fsz['2xl']), lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em', sample: 'Retention this week', usage: `.vh-h1, --vh-fs-2xl ${fsz['2xl']}. Once per page.` },
            { name: 'heading-2', family: 'heading', fontSize: px(fsz.xl), lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.01em', sample: 'Cohorts to reach first', usage: `.vh-h2, --vh-fs-xl ${fsz.xl}. Section titles.` },
            { name: 'heading-3', family: 'heading', fontSize: px(fsz.lg), lineHeight: 1.3, fontWeight: 600, sample: 'Second-order activation', usage: `.vh-h3, --vh-fs-lg ${fsz.lg}. Card and panel titles.` },
            { name: 'body', fontSize: fsz.md, lineHeight: 1.55, fontWeight: 400, sample: 'Connect a store and this view fills from the brand\'s own data.', usage: '.vh-body. Everything people read.' },
            { name: 'small', fontSize: fsz.sm, lineHeight: 1.5, fontWeight: 400, sample: 'Saved on this device.', usage: '.vh-small, in --vh-ink-dim.' },
            { name: 'label', family: 'mono', fontSize: fsz.xs, lineHeight: 1.5, fontWeight: 600, letterSpacing: '0.12em', sample: 'COLUMN HEAD', usage: '.vh-eyebrow, .vh-section-label, table heads: uppercase metadata, never body copy.' },
          ],
        },
        {
          name: 'Wordmark',
          family: 'wordmark',
          note: 'The platform\'s only face: the system sans. Never a tenant\'s typeface.',
          styles: [{ name: 'wordmark', fontSize: '34px', lineHeight: 1, fontWeight: 700, sample: 'Lifecycle OS', usage: 'The lockups and the rail wordmark (--los-font-wordmark).' }],
        },
      ],
    },
    spacing: { note: 'theme.css --vh-s1 to --vh-s7.', tokens: c.spacing.map((s, i) => ({ name: s.name, value: s.value, usage: ['Icon to label.', 'Inside controls.', 'Between related rows.', 'Card padding, grid gaps.', 'Panel padding.', 'Between sections.', 'Between page regions.'][i] || '' })) },
    radius: { note: 'A brand\'s own measured control and card radius override sm and lg (--brand-radius-control, --brand-radius-card).', tokens: c.radius.filter((r) => /^vh-r-/.test(r.name)).map((r) => ({ name: r.name, value: r.value, usage: { 'vh-r-sm': 'Controls, inputs.', 'vh-r-md': 'Toasts, swatches.', 'vh-r-lg': 'Cards, panels, modals.', 'vh-r-pill': 'Chips, badges, the credit pill.' }[r.name] })) },
    shadow: { note: 'Two neutral lifts. Lift 1 for anything in the flow; lift 2 only for what floats over the page.', tokens: c.elevation.map((e) => ({ name: e.name, value: e.value.replace(/\s+/g, ' '), usage: e.name === 'vh-lift-1' ? 'Cards, inline toasts, the credit pill.' : 'Modals and popovers only: its shadow falls on the text below.' })) },
  };
}

/* ── components ────────────────────────────────────────────────────────────── */

const GROUP = {
  Button: 'Actions', Chip: 'Actions',
  StatusChip: 'Status', StatusLine: 'Status', Failure: 'Status', Notice: 'Status', Marker: 'Status', CreditPill: 'Status', Mode: 'Status', Toast: 'Status',
  Card: 'Surfaces', Band: 'Surfaces', Modal: 'Surfaces', InfoPanel: 'Surfaces', EmptyState: 'Surfaces', Loading: 'Surfaces',
  Input: 'Forms', Table: 'Data', Swatch: 'Data', Steps: 'Navigation', Rail: 'Navigation',
};

/** Inline the sprite references: a preview frame cannot reach the app's /assets. */
function inlineSprites(html) {
  const icon = Object.fromEntries(assets.ICONS.icons.map((i) => [i.name, i.body]));
  const ill = Object.fromEntries(assets.ILLS.illustrations.map((i) => [i.name, i.body]));
  return html
    .replace(/<svg class="([^"]*vh-icon[^"]*)" aria-hidden="true"><use href="\/assets\/lifecycle-os\/icons\.svg#i-([a-z-]+)"\/><\/svg>/g,
      (m, cls, n) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${icon[n]}</svg>`)
    .replace(/<svg class="vh-empty-art" viewBox="0 0 128 96" aria-hidden="true"><use href="\/assets\/lifecycle-os\/illustrations\.svg#ill-([a-z-]+)"\/><\/svg>/g,
      (m, n) => `<svg class="vh-empty-art" viewBox="0 0 128 96" aria-hidden="true">${ill[n]}</svg>`);
}

/** Each component section of /design-system: name, title, guidance, tokens line, demo markup. */
function pageComponents() {
  const html = read('design-system.html');
  const out = [];
  const re = /<div class="ds-comp[^"]*" data-ds-component="([A-Za-z]+)">([\s\S]*?)\n      <\/div>\n/g;
  for (const m of html.matchAll(re)) {
    const body = m[2];
    const title = (body.match(/<div class="vh-h3">([^<]+)<\/div>/) || [])[1] || m[1];
    const guide = ((body.match(/<p>([\s\S]*?)<\/p>/) || [])[1] || '').replace(/\s+/g, ' ').trim();
    const tok = ((body.match(/<div class="ds-tokens">([^<]+)<\/div>/) || [])[1] || '').trim();
    const demo = body.replace(/<div class="vh-h3">[^<]+<\/div>/, '').replace(/<p>[\s\S]*?<\/p>/, '').replace(/<div class="ds-tokens">[^<]+<\/div>/, '').trim();
    out.push({ name: m[1], title, guide, tokens: tok, demo });
  }
  return out;
}

const RAIL_STATIC = () => `<div id="lifecycle-nav" class="ds-rail-static">
  <aside class="lnav-side" style="position:relative;height:auto;width:248px;transform:none;box-shadow:none">
    <div class="lnav-head"><a class="lnav-brand" href="#rail">
      <svg class="lnav-mark" viewBox="0 0 64 64" role="img" aria-label="Lifecycle OS"><rect x="1" y="1" width="62" height="62" rx="15" fill="var(--vh-panel-2)" stroke="var(--vh-line)" stroke-width="2"/>${mark.markParts().glyph.replace(/var\(--los-ink, #[0-9A-Fa-f]{6}\)/g, 'currentColor')}</svg>
      <span class="lnav-bt"><b>Lifecycle OS</b><span class="lnav-brandrow"><span class="lnav-brandlogo">B</span><small class="lnav-brandname">Active brand</small></span></span>
    </a></div>
    <div class="lnav-section">Plan</div>
    <a class="lnav-link" href="#rail"><span class="lnav-txt">Growth OS</span><span class="lnav-ver v2">V2</span></a>
    <a class="lnav-link active" href="#rail"><span class="lnav-txt">Smart Brain</span><span class="lnav-ver v2">V2</span></a>
    <div class="lnav-group open active-group"><button type="button" class="lnav-ghead"><span class="lnav-txt">Data Analysis</span></button>
      <div class="lnav-gbody"><a class="lnav-link" href="#rail"><span class="lnav-txt">Control Room</span></a><a class="lnav-link" href="#rail"><span class="lnav-txt">Retention</span></a></div>
    </div>
  </aside>
</div>`;

function preview(comp) {
  const group = GROUP[comp.name] || 'Components';
  const markup = comp.name === 'Rail' ? RAIL_STATIC() : inlineSprites(comp.demo);
  const height = { Table: 200, Band: 300, Modal: 280, EmptyState: 300, Rail: 330, InfoPanel: 260, Loading: 170, Failure: 150, StatusLine: 110, Notice: 170, Input: 220, Card: 170, Swatch: 130, Toast: 150, Marker: 140 }[comp.name] || 110;
  return `<!-- @dsCard group="${group}" height=${height} -->
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${comp.title}</title></head>
<body>
<div class="ds-card">
${markup}
</div>
</body>
</html>
`;
}

function componentReadme(comp) {
  return `# ${comp.title}

${comp.guide}

- **Tokens:** ${comp.tokens || 'see contract.md'}
- **Classes:** the markup in this card is lifted verbatim from the live page \`/design-system\` in the repository; the stylesheet is the app's own \`theme.css\` (shipped here as \`components/bundle.css\`).
- **What the consumer provides:** the words, and nothing else. Every colour, ground and edge comes from the active brand through the contract (see the Contract section): never write a colour into this component.
`;
}

function bundleCss() {
  const theme = read('theme.css');
  const b = theme.indexOf('/* >>> BRAND-SYNC:palette'), e = theme.indexOf('/* <<< BRAND-SYNC:palette */');
  const themeNoFallback = theme.slice(0, b) + '/* (BRAND-SYNC fallbacks removed: the theme tokens above supply every --brand-* value) */' + theme.slice(e + '/* <<< BRAND-SYNC:palette */'.length);
  const auth = read('auth.js');
  const rs = auth.indexOf("wrap.id = 'lifecycle-nav';");
  const s0 = auth.indexOf('<style>', rs) + '<style>'.length, s1 = auth.indexOf('</style>', s0);
  const rail = auth.slice(s0, s1)
    .replace(/:root \{ --lsb-w: 248px; \}\s*/, '')
    .replace(/@media \(min-width: 961px\) \{ body \{ margin-left: var\(--lsb-w\) !important; \} \}\s*/, '');
  return `/* Lifecycle OS: the app's own stylesheet, for the Design System previews.
   Generated by scripts/build-design-system.js --artifact from theme.css and
   the rail's style block in auth.js. The theme tokens (tokens.css) supply the
   brand values per theme; the fonts map to the system's families. */
:root { --vh-font-head: var(--font-heading); --vh-font-body: var(--font-body); --los-font-wordmark: var(--font-wordmark); --lsb-w: 248px; }
body { margin: 0; background: var(--vh-bg); color: var(--vh-ink); font-family: var(--vh-font-body); }
.ds-card { padding: 16px; display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
.ds-card > * { min-width: 0; }
.ds-card > .vh-band, .ds-card > .vh-card, .ds-card > .vh-table-wrap, .ds-card > .vh-empty, .ds-card > .vh-modal-stage, .ds-card > .vh-info, .ds-card > .vh-notice, .ds-card > .vh-marker-block, .ds-card > .vh-steps, .ds-card > .vh-skeleton, .ds-card > .ds-demo-col, .ds-card > .vh-input, .ds-card > .vh-select { flex: 1 1 100%; }
.ds-demo { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.ds-demo-col { display: grid; gap: 12px; }
.ds-sw[data-token="brand-primary"] .vh-swatch-chip { background: var(--brand-primary); }
.ds-sw[data-token="brand-accent"] .vh-swatch-chip { background: var(--brand-accent); }
.ds-sw[data-token="brand-surface"] .vh-swatch-chip { background: var(--brand-surface); }
.ds-railnote { display: flex; gap: 12px; align-items: flex-start; }

${themeNoFallback}

/* ── the rail (auth.js #lifecycle-nav) ── */
${rail}
`;
}

/* ── the cover ─────────────────────────────────────────────────────────────── */

function cover() {
  return `<!-- @dsCard height=288 -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lifecycle OS</title>
<style>
  html, body { margin:0; height:100%; }
  body { background:var(--brand-surface); color:var(--los-ink); font-family:var(--font-wordmark); overflow:hidden; }
  body::before, body::after { display:none; }
  .cover { position:relative; height:288px; overflow:hidden; }
  .art { position:absolute; top:0; left:480px; width:480px; height:288px; overflow:hidden; }
  .art svg { display:block; width:480px; height:288px; }
  .ink { fill:var(--los-ink); }
  .tile { fill:var(--los-tile); }
  .line { fill:var(--los-line); }
  .brand { fill:var(--brand-primary); }
  .accent { fill:var(--brand-accent); }
  .arc { fill:none; stroke:var(--los-tile); stroke-width:16; stroke-linecap:round; }
  .arc.thin { stroke:var(--los-line); stroke-width:8; }
  .core { fill:var(--los-tile); }
  .words { position:absolute; left:32px; right:32px; bottom:32px; max-width:440px; }
  .name { margin:0; font-size:80px; line-height:.95; font-weight:700; letter-spacing:-.02em; color:var(--los-ink); }
  .tag { margin:8px 0 0 3px; font-size:14px; line-height:20px; color:var(--vh-ink-dim); }
</style>
</head>
<body>
<div class="cover">
<div class="art" aria-hidden="true">
<svg viewBox="0 0 480 288" width="480" height="288">
<!--
  blocks      los-ink slab 352x272 bled off the top and right (the mark's ink, the platform's only identity colour) · los-tile 112x80 · brand-primary 112x96 (the ACTIVE theme's primary: the one block that changes with the brand) · brand-accent 48x32 once · los-line 48x16 strip
  arrangement one tall ink slab with satellites on its left, bottoms on one line 32 (vh-s6) above the edge, gutters 16 (vh-s4)
  pattern     the mark's own loop: two concentric open arcs with the arrowhead's gap, cut into the slab in los-tile, a thinner los-line arc beside it - the literal motif row, because the loop IS the mark
  scales      sides in vh-s4 (16) multiples; gutters vh-s4; inset vh-s6 (32); corners vh-r-lg (16) on blocks, vh-r-sm (8) on the small block
-->
<rect class="line" x="0" y="24" width="48" height="16" rx="8"/>
<rect class="accent" x="64" y="16" width="48" height="32" rx="8"/>
<rect class="tile" x="0" y="64" width="112" height="80" rx="16"/>
<rect class="brand" x="0" y="160" width="112" height="96" rx="16"/>
<rect class="ink" x="128" y="-16" width="352" height="272" rx="16"/>
<path class="arc" d="M 325.7 50.9 A 84 84 0 1 1 235.2 83.8"/>
<path class="arc thin" d="M 315.4 89.5 A 44 44 0 1 1 268 106.8"/>
<circle class="core" cx="304" cy="132" r="18"/>
</svg>
</div>
<div class="words">
<h1 class="name">Lifecycle<br>OS</h1>
<p class="tag">The platform's mark stays neutral; every screen wears the active brand.</p>
</div>
</div>
</body>
</html>
`;
}

/* ── README and group READMEs ──────────────────────────────────────────────── */

function readme(c, meta) {
  const design = read('design/lifecycle-os/DESIGN.md');
  // The DESIGN.md prose, minus its note about its own front matter (the
  // brand book has no front matter; tokens.json carries those values).
  const body = design.slice(design.indexOf('\n---\n', 4) + 5).trim()
    .replace(/\n_The front matter above[\s\S]*?_\n/, '\n');
  return `The design system of Lifecycle OS, a universal lifecycle-marketing platform. Any brand onboards and
the whole app runs as that brand, so this system has two layers: the **platform's own identity**
(the neutral loop mark, the logo set, the icon set, the illustrations), which is never a tenant's,
and **one surface contract** that every screen takes its colours from, derived from the ACTIVE
brand's record so it stays readable for any palette.

## Using this system

- **Themes are worked brands, not light and dark.** The app is light-only by design. Each theme is
  one palette run through the repository's own \`tokens()\`: the first, *Lifecycle OS neutral*, is the
  mark's colours; then the example brand (tenant zero), a red primary with a deep brown accent, a pale
  primary, a near-black primary, and a bare record with no palette. Switch themes to watch every
  token re-derive: a band never goes dark, text never drops under 4.5:1.
- **Three token prefixes.** \`los-*\` is the platform's own (the same in every theme). \`brand-*\` is
  what \`tokens()\` derives from a brand's record (the usage note says how). \`vh-*\` is the ROLE a page
  uses, an alias of a brand token: pages write \`var(--vh-panel-2)\`, \`var(--vh-primary-text)\`,
  never a hex and never \`var(--brand-primary)\` as a text colour.
- **Components are CSS classes.** The app's components are the \`.vh-*\` kit in its \`theme.css\`
  (shipped here as \`components/bundle.css\`, with the rail's own styles); there is no JavaScript
  component library, so each card is a static rendition of the shipped markup.
- **Icons and illustrations** are drawn in \`currentColor\` and \`--vh-ill-*\` tokens. As standalone
  files they render in their fallback neutrals (the icons in black, the illustrations in greys); in
  the app they take the brand's colours.
- **Every text pair holds in every theme.** A text token's note names the grounds it was derived
  for; set brand-coloured words only on \`vh-bg\`, \`vh-panel\` or \`vh-panel-2\`, words on a fill only in
  that fill's \`on-*\` token, and nothing but \`vh-ink\` on a tint.

${body}

## Intentional additions

The shipped app already had the rail, the notice bar, the status line, the failure frame, the credit
pill, the wizard steps, the feature info panel, cards, chips, badges, inputs and tables. This system
adds kit classes for patterns the pages drew by hand, each built only from contract tokens: the
status chip (\`.vh-state\`), the DATA REQUIRED marker (\`.vh-marker\`), the brand band (\`.vh-band\`),
the skeleton, the empty state with its illustrations, the toast and modal classes (the app's toasts
and dialogs were page-local), the swatch, the mode line, and the stroke icon set that replaces the
emoji used as UI icons.

## Not synced

- **No component bundle:** the app has no JavaScript component library; previews are static
  renditions styled by the shipped stylesheet.
- **No font files:** the platform's only face is the system sans; a brand's fonts belong to that
  brand.
- **Fluid type** (\`clamp()\` between a phone and a desktop) is recorded at its desktop maximum.
- **Motion** (\`--vh-t-fast\` .14s, \`--vh-t-mid\` .22s, \`--vh-t-hud\` .28s, the spring and soft easings,
  the scroll reveal) lives in \`theme.css\` and the Elevation and Depth section above: this format
  has no motion family.
- **The six themes are the gate's palettes**, not every brand: any palette the brand layer accepts
  derives the same way.
`;
}

const LOGOS = () => [
  ['lifecycle-os-mark.svg', 'assets/lifecycle-os-mark.svg', 'The mark. Favicon, app icon, the rail mark. Minimum 16px; clear space a quarter of its height.'],
  ['lockup-horizontal.svg', 'assets/lifecycle-os/logos/lockup-horizontal.svg', 'Mark and wordmark on one line. Minimum 120px wide.'],
  ['lockup-horizontal.png', 'assets/lifecycle-os/logos/lockup-horizontal.png', 'The horizontal lockup, 1296x256 raster.'],
  ['lockup-stacked.svg', 'assets/lifecycle-os/logos/lockup-stacked.svg', 'Mark above the wordmark. Minimum 72px wide.'],
  ['lockup-stacked.png', 'assets/lifecycle-os/logos/lockup-stacked.png', 'The stacked lockup, 480x336 raster.'],
  ['wordmark.svg', 'assets/lifecycle-os/logos/wordmark.svg', 'The name alone, system sans 700. Minimum 96px wide.'],
  ['wordmark.png', 'assets/lifecycle-os/logos/wordmark.png', 'The wordmark, 992x192 raster.'],
  ['mark-mono.svg', 'assets/lifecycle-os/logos/mark-mono.svg', 'One ink (#24292e), no tile fill: single-colour reproduction.'],
  ['mark-mono-512.png', 'assets/lifecycle-os/logos/mark-mono-512.png', 'The mono mark, 512x512 raster.'],
  ['mark-glyph.svg', 'assets/lifecycle-os/logos/mark-glyph.svg', 'The loop alone in currentColor: the inverse mark on a brand band (as a mask, filled with --vh-on-band). Renders black on its own.'],
  ['lifecycle-os-32.png', 'assets/lifecycle-os-32.png', 'Favicon fallback, 32x32.'],
  ['lifecycle-os-180.png', 'assets/lifecycle-os-180.png', 'Apple touch icon, 180x180, full bleed.'],
  ['lifecycle-os-192.png', 'assets/lifecycle-os-192.png', 'Manifest icon, 192x192.'],
  ['lifecycle-os-512.png', 'assets/lifecycle-os-512.png', 'Manifest icon, 512x512.'],
  ['lifecycle-os-512-maskable.png', 'assets/lifecycle-os-512-maskable.png', 'Maskable manifest icon, 512x512, full bleed.'],
  ['lifecycle-os-og.png', 'assets/lifecycle-os-og.png', 'Share card, 1200x630.'],
];

/** The files to upload, by group: [{group, name, src (absolute), type}]. */
function uploads() {
  const out = [];
  const type = (f) => (f.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
  for (const [name, rel] of LOGOS()) out.push({ group: 'Logos', name, src: path.join(ROOT, rel), type: type(rel) });
  for (const i of assets.ICONS.icons) out.push({ group: 'Icons', name: `${i.name}.svg`, src: path.join(ROOT, 'assets', 'lifecycle-os', 'icons', `${i.name}.svg`), type: 'image/svg+xml' });
  for (const i of assets.ILLS.illustrations) out.push({ group: 'Illustrations', name: `${i.name}.svg`, src: path.join(ROOT, 'assets', 'lifecycle-os', 'illustrations', `${i.name}.svg`), type: 'image/svg+xml' });
  return out;
}

function groupReadmes() {
  const logos = ['# Logos', '', 'The Lifecycle OS mark and its logo set, every file a render of `assets/lifecycle-os-mark.svg` (`scripts/build-platform-mark.js`). Three neutral inks only: ink `#24292e`, tile `#f5f6f8`, line `#d4d8de`. Never recoloured in a brand\'s colours, never replaced by a tenant\'s logo, never on a photograph or a dark neutral.', ''];
  for (const [name, , use] of LOGOS()) logos.push(`- \`${name}\`: ${use}`);
  const icons = ['# Icons', '', 'One stroke set on a 24px grid, 1.75 stroke, round caps and joins, drawn in `currentColor` (single ink: black when viewed on its own; the colour of the adjacent text in the app). Use from the sprite: `<svg class="vh-icon" aria-hidden="true"><use href="/assets/lifecycle-os/icons.svg#i-NAME"/></svg>`. Each replaces the emoji the app used as a UI icon for that meaning.', ''];
  for (const i of assets.ICONS.icons) icons.push(`- \`${i.name}.svg\`: ${i.use}${i.replaces.length ? ` Replaces ${i.replaces.join(' ')}.` : ''}${i.from ? ' (From the rail\'s own set.)' : ''}`);
  const ills = ['# Illustrations', '', 'Empty and placeholder states on a 128x96 grid, drawn only in `--vh-ill-*` tokens so they take the active brand\'s colours in the app; viewed on their own they show their neutral grey fallbacks. Decorative: always beside words that say the state.', ''];
  for (const i of assets.ILLS.illustrations) ills.push(`- \`${i.name}.svg\` (${i.title}): ${i.use}`);
  return { 'assets/Logos/README.md': logos.join('\n') + '\n', 'assets/Icons/README.md': icons.join('\n') + '\n', 'assets/Illustrations/README.md': ills.join('\n') + '\n' };
}

/* ── write ─────────────────────────────────────────────────────────────────── */

function write(dir, c) {
  const ref = process.env.DS_REF || 'working tree';
  const meta = {
    source: 'github', repo: 'Anchit-AI-Hustle/lifecycle-os', ref, package: '.',
    paths: {
      tokens: ['api/_shared/brand-workspace-core.js', 'theme.css', 'design/lifecycle-os/tokens.json', 'design/lifecycle-os/palettes.json'],
      assets: ['assets/lifecycle-os-mark.svg', 'assets/lifecycle-os/'],
      docs: ['design/lifecycle-os/DESIGN.md', 'design/lifecycle-os/CONTRACT.md', 'design/lifecycle-os/BRAND-SCHEMA.md'],
    },
    components: { kit: 'theme.css', page: 'design-system.html', rail: 'auth.js' },
    synced: new Date().toISOString().slice(0, 10),
  };
  const P = path.join(dir, 'project');
  const files = {};
  files['tokens.json'] = JSON.stringify(tokensJson(c, meta), null, 2) + '\n';
  files['README.md'] = readme(c, meta);
  files['contract.md'] = read('design/lifecycle-os/CONTRACT.md');
  files['brand-schema.md'] = read('design/lifecycle-os/BRAND-SCHEMA.md');
  files['components/bundle.css'] = bundleCss();
  for (const comp of pageComponents()) {
    files[`components/${comp.name}/README.md`] = componentReadme(comp);
    files[`components/${comp.name}/preview.html`] = preview(comp);
  }
  files['components/Cover/preview.html'] = cover();
  Object.assign(files, groupReadmes());
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(P, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  fs.writeFileSync(path.join(dir, 'uploads.json'), JSON.stringify(uploads(), null, 2));
  console.log(`artifact: ${Object.keys(files).length} project files under ${P}, ${uploads().length} assets to upload (uploads.json)`);
  return { files: Object.keys(files), uploads: uploads() };
}

module.exports = { write, tokensJson, pageComponents, uploads, bundleCss, cover, readme };
