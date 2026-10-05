#!/usr/bin/env node
'use strict';
/**
 * build-design-system.js - the Lifecycle OS design system's machine-readable half.
 * ---------------------------------------------------------------------------
 *   node scripts/build-design-system.js                 write tokens.json + CONTRACT.md tables
 *   node scripts/build-design-system.js --check         exit 1 if either drifted
 *   node scripts/build-design-system.js --artifact DIR  also write the Design System
 *                                                       artifact's project/ files under DIR
 *
 * Nothing here is typed twice. Every number is READ from where the app keeps it:
 *   - token VALUES per palette   tokens() in api/_shared/brand-workspace-core.js,
 *                                the function brand-context.js paints with
 *   - TEXT_AA                    the same module
 *   - type scale, spacing,       theme.css :root declarations
 *     radius, elevation, motion
 *   - the mark's colours         scripts/build-platform-mark.js tokens(), which
 *                                reads them from the SVG
 *   - palettes                   design/lifecycle-os/palettes.json, with tenant
 *                                zero read from data/brands/_default.json
 * What this file DOES hold is the contract's shape: which app token resolves to
 * which brand token, and which token paints which surface (APP_TOKENS,
 * SURFACES). CONTRACT.md's tables are generated from those two lists, so the
 * document and the data cannot disagree, and the artifact is generated from
 * the same output, so the published system cannot disagree with the repo.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DS = path.join(ROOT, 'design', 'lifecycle-os');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const mark = require(path.join(ROOT, 'scripts', 'build-platform-mark.js'));
const THEME = fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8');

/* ── where values come from ───────────────────────────────────────────────── */

function cssVar(name) {
  const re = new RegExp(`(?:^|[\\s;{])--${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`, 'm');
  const m = THEME.match(re);
  if (!m) throw new Error(`theme.css declares no --${name}`);
  return m[1].trim();
}

function palettes() {
  const src = JSON.parse(fs.readFileSync(path.join(DS, 'palettes.json'), 'utf8'));
  return src.palettes.map((p) => {
    const palette = p.from ? (JSON.parse(fs.readFileSync(path.join(ROOT, p.from), 'utf8')).palette || {}) : (p.palette || {});
    const typography = p.from ? (JSON.parse(fs.readFileSync(path.join(ROOT, p.from), 'utf8')).typography || {}) : {};
    const t = core.tokens({ palette, typography: {} });
    return { id: p.id, name: p.name, why: p.why, from: p.from || null, palette, typography, valid: core.validatePalette(palette).ok, tokens: t };
  });
}

/* ── the brand layer: every --brand-* token tokens() emits, and how ────────── */

const BRAND_TOKENS = [
  ['brand-primary', 'palette.primary', 'The brand colour as a FILL: primary button, selected chip, active rail row. May be dark (a control).'],
  ['brand-primary-dark', 'shade(primary, -0.25)', 'Hover state of a primary fill. Never text.'],
  ['brand-primary-soft', 'shade(primary, 0.86)', 'Text selection, soft tints. Only ink text on it.'],
  ['brand-primary-tint', 'shade(primary, 0.94)', 'Illustration ground, decorative tint. Only ink text on it.'],
  ['brand-on-primary', 'readableOn(primary, ink, surface, surface_alt)', 'Text and icons ON a primary fill. validatePalette() blocks activation below 4.5:1.'],
  ['brand-primary-text', 'readableAsText(primary, worst surface, TEXT_AA)', 'The primary AS TEXT: links, active labels, a selected step. Never write var(--brand-primary) as a text colour.'],
  ['brand-accent', 'palette.accent, else primary', 'Edges and rules for ordinary states, the energy line, the ambient field. Never text.'],
  ['brand-accent-soft', 'shade(accent, 0.88)', 'Illustration soft fill.'],
  ['brand-on-accent', 'readableOn(accent, ink, surface, surface_alt)', 'Text on an accent fill (rare; prefer the band tokens).'],
  ['brand-accent-text', 'readableAsText(accent, worst surface, TEXT_AA)', 'The accent AS TEXT: eyebrows, badges, the info panel eyebrow.'],
  ['brand-ink', 'palette.ink', 'Body text, headings, icons.'],
  ['brand-ink-muted', 'readableAsText(palette.muted or shade(ink, .35), worst surface, TEXT_AA)', 'Secondary text. Never under AA: muted is still text.'],
  ['brand-surface', 'palette.surface', 'Page ground and the rail. validatePalette() refuses a dark neutral.'],
  ['brand-surface-alt', 'palette.surface_alt, else shade(surface, 0.6)', 'Panels and cards.'],
  ['brand-surface-sunken', 'sunkenSurface(): the darker surface, darkened while every text token keeps 4.5:1', 'Sunken panel: status line, failure frame, notice bar, hover rows, the mark tile.'],
  ['brand-line', 'shade(ink, 0.84)', 'Hairlines, card and input borders.'],
  ['brand-line-strong', 'shade(ink, 0.68)', 'Emphasised borders: hover, table header rule, the ? chip ring.'],
  ['brand-band', 'sectionGround(primary, accent, surface)', 'A brand-coloured SECTION ground. Never a dark neutral: a near-black primary falls through to the accent, then the surface.'],
  ['brand-on-band', 'textOn(band, surface, ink, TEXT_AA)', 'Text on --brand-band.'],
  ['brand-band-accent', 'sectionGround(accent, primary, surface)', 'The accent as a section ground (announcement strip).'],
  ['brand-on-band-accent', 'textOn(band-accent, surface, ink, TEXT_AA)', 'Text on --brand-band-accent.'],
  ['brand-ok', 'palette.ok, else the code default', 'Success fill, edge or dot. Never text.'],
  ['brand-warn', 'palette.warn, else the code default', 'Warning fill or edge (the fix-it notice rule). Never text.'],
  ['brand-err', 'palette.err, else the code default', 'Error edge (the failure frame). Never text.'],
  ['brand-ok-text', 'readableAsText(ok, worst surface, TEXT_AA)', 'A success word, a status dot.'],
  ['brand-warn-text', 'readableAsText(warn, worst surface, TEXT_AA)', 'A warning word, the marker edge.'],
  ['brand-err-text', 'readableAsText(err, worst surface, TEXT_AA)', 'The failure tag, an error word.'],
  ['brand-focus', 'readableAsText(accent, worst surface, 3)', 'The keyboard focus ring: the accent held to the 3:1 non-text minimum.'],
];

/* ── the app layer: every --vh-* role token, and what it resolves through ──── */

const APP_TOKENS = [
  // grounds
  ['vh-bg', 'brand-surface', 'Page ground; the rail.'],
  ['vh-panel', 'brand-surface-alt', 'Opaque panel, card, modal, input on a sunken ground.'],
  ['vh-panel-2', 'brand-surface-sunken', 'Sunken panel (also --vh-sunken).'],
  ['vh-band', 'brand-band', 'Brand-coloured section (.vh-band).'],
  ['vh-on-band', 'brand-on-band', 'Text on a brand band.'],
  ['vh-band-accent', 'brand-band-accent', 'Accent section (.vh-band-accent).'],
  ['vh-on-band-accent', 'brand-on-band-accent', 'Text on an accent band.'],
  ['vh-tint', 'brand-primary-tint', 'Decorative tint; ink text only.'],
  // text
  ['vh-ink', 'brand-ink', 'Body text, icons.'],
  ['vh-heading', 'brand-ink', 'Headings (via --vh-ink), in --vh-font-head.'],
  ['vh-ink-dim', 'brand-ink-muted', 'Secondary text. --vh-ink-faint is an alias of it now.'],
  ['vh-primary-text', 'brand-primary-text', 'Primary as text.'],
  ['vh-link', 'brand-primary-text', 'Links (via --vh-primary-text).'],
  ['vh-accent-text', 'brand-accent-text', 'Accent as text: eyebrows, badges.'],
  ['vh-ok-text', 'brand-ok-text', 'Success as text, status dots.'],
  ['vh-warn-text', 'brand-warn-text', 'Warning as text, the marker edge.'],
  ['vh-err-text', 'brand-err-text', 'Error as text: the failure tag.'],
  // fills and edges
  ['vh-primary', 'brand-primary', 'Primary control fill.'],
  ['vh-on-primary', 'brand-on-primary', 'Label on a primary fill.'],
  ['vh-accent', 'brand-accent', 'Ordinary-state edge, rules, energy line.'],
  ['vh-on-accent', 'brand-on-accent', 'Label on an accent fill.'],
  ['vh-ok', 'brand-ok', 'Success fill or edge.'],
  ['vh-warn', 'brand-warn', 'Warning fill or edge (fix-it notice rule).'],
  ['vh-err', 'brand-err', 'Error edge (failure frame).'],
  ['vh-line', 'brand-line', 'Hairlines and borders.'],
  ['vh-line-hot', 'brand-line-strong', 'Emphasised borders, hover.'],
  ['vh-focus', 'brand-focus', 'Focus ring.'],
  // data
  ['vh-chart-1', 'brand-primary', 'Chart series 1.'],
  ['vh-chart-2', 'brand-accent', 'Chart series 2.'],
  ['vh-chart-3', 'brand-ink-muted', 'Chart series 3.'],
  ['vh-chart-4', 'brand-primary-dark', 'Chart series 4. A fifth series labels directly instead.'],
  ['vh-marker-ground', 'brand-surface-sunken', 'The DATA REQUIRED marker ground.'],
  ['vh-marker-edge', 'brand-warn-text', 'The DATA REQUIRED marker edge.'],
];

/* ── the surface -> token contract ─────────────────────────────────────────── */

const SURFACES = [
  // [surface, ground, text, edge, shipped in]
  ['Page ground', 'vh-bg', 'vh-ink; secondary vh-ink-dim', 'none', 'every page body'],
  ['Panel / card (opaque)', 'vh-panel', 'vh-ink; vh-ink-dim', 'vh-line', '.panel, .vh-modal, .vh-empty'],
  ['Raised card', 'vh-glass over the ambient field', 'vh-ink; vh-ink-dim', 'vh-line (hover vh-line-hot); 2px energy line vh-primary to vh-accent', '.vh-card, .card, .tile, .kpi (futuristic layer)'],
  ['Sunken panel', 'vh-panel-2', 'vh-ink; any *-text token', 'vh-line', '.vh-status, .vh-failure, .vh-notice, hover rows, mark tile'],
  ['Brand band (section)', 'vh-band', 'vh-on-band', 'none', '.vh-band; never var(--brand-primary) on a section'],
  ['Accent band (section)', 'vh-band-accent', 'vh-on-band-accent', 'none', '.vh-band-accent'],
  ['Rail', 'vh-bg (never frosted)', 'rows vh-ink-dim, hover vh-ink, section labels vh-ink-dim', 'right edge vh-line', 'auth.js #lifecycle-nav'],
  ['Rail: active row', 'vh-primary', 'vh-on-primary', 'none', '.lnav-link.active'],
  ['Rail: active group', 'vh-panel-2', 'vh-primary-text', 'inset 3px vh-primary', '.lnav-group.active-group .lnav-ghead'],
  ['Chip', 'vh-panel', 'vh-ink-dim', 'vh-line', '.vh-chip'],
  ['Chip: selected', 'vh-primary', 'vh-on-primary', 'vh-primary', '.vh-chip[aria-pressed=true], .rgn-chip[aria-pressed=true]'],
  ['Badge', 'vh-panel', 'vh-accent-text', 'vh-line', '.vh-badge'],
  ['Status chip', 'vh-panel', 'vh-ink; dot vh-ok-text / vh-warn-text / vh-err-text / vh-focus', 'vh-line (error: vh-err-text)', '.vh-state[data-state]'],
  ['Button: primary', 'vh-primary (hover brand-primary-dark)', 'vh-on-primary', 'vh-primary', '.vh-btn-primary (= .vh-btn-solid, .vh-btn-green)'],
  ['Button: secondary', 'vh-panel', 'vh-primary-text', 'vh-line-hot', '.vh-btn-secondary'],
  ['Button: ghost', 'transparent (hover vh-panel-2)', 'vh-ink', 'vh-line (hover vh-line-hot)', '.vh-btn-ghost'],
  ['Input', 'vh-glass-strong over vh-panel-2', 'vh-ink; placeholder vh-ink-dim', 'vh-line; focus ring vh-focus', '.vh-input, .vh-select, .vh-textarea'],
  ['Table', 'header vh-glass-strong; rows transparent, hover vh-panel-2', 'th vh-ink-dim; td vh-ink', 'vh-line; header rule vh-line-hot', '.vh-table'],
  ['Modal', 'vh-panel over a scrim of vh-ink at .45 opacity', 'vh-ink', 'vh-line; elevation vh-lift-2', '.vh-modal, .vh-modal-backdrop, the ? info panel'],
  ['Toast', 'vh-panel', 'vh-ink', 'inset 3px vh-accent (error vh-err-text)', '.vh-toast'],
  ['Notice bar', 'vh-panel-2', 'vh-ink', 'top rule vh-accent (ordinary) or vh-warn (fix-it)', 'auth.js #lc-authnotice, .vh-notice'],
  ['Status line', 'vh-panel-2', 'vh-ink', 'left 4px vh-accent', 'LifecycleStatus, .vh-status'],
  ['Failure frame', 'vh-panel-2', 'message vh-ink; tag vh-err-text; code vh-ink-dim', 'left 4px vh-err', 'LifecycleFailure, .vh-failure'],
  ['DATA REQUIRED marker', 'vh-marker-ground', 'vh-ink (mono)', 'dashed vh-marker-edge', '.vh-marker, .vh-marker-block'],
  ['Credit pill', 'vh-panel', 'vh-ink; dot vh-primary / vh-warn-text / vh-err-text', 'vh-line', 'credits.js .lc-credit-pill, .vh-credit'],
  ['Local / Demo Mode', 'vh-panel-2', 'vh-ink', 'inset 3px vh-accent', 'auth.js #lnav-umode, .vh-mode'],
  ['Wizard step', 'vh-panel (current vh-primary)', 'vh-ink-dim (done vh-primary-text, current vh-on-primary)', 'vh-line (done vh-primary-text)', 'onboarding.html .step-pip, .vh-step'],
  ['Skeleton', 'vh-panel-2 with a vh-glass-edge shimmer', 'none', 'none', '.vh-skeleton'],
  ['Empty state', 'vh-panel', 'title vh-heading; text vh-ink-dim; art vh-ill-*', 'dashed vh-line-hot', '.vh-empty'],
  ['Focus ring', 'none', 'none', 'outline 2px vh-focus + vh-glass-strong halo', ':focus-visible'],
  ['Link', 'none', 'vh-link, underlined', 'none', '.vh-link, .vh-prose a'],
  ['Heading', 'none', 'vh-heading in vh-font-head', 'none', '.vh-h1, .vh-h2, .vh-h3'],
  ['Eyebrow / metadata', 'none', 'vh-accent-text (eyebrow) or vh-ink-dim, in vh-font-mono', 'none', '.vh-eyebrow, .vh-section-label'],
  ['Divider', 'gradient vh-fx-primary to vh-fx-accent at .38', 'none', 'none', '.vh-divider, hr'],
  ['Chart', 'none', 'labels vh-ink; axis vh-ink-dim', 'grid vh-line', 'series vh-chart-1 to vh-chart-4'],
];

/* ── scales, read from theme.css ───────────────────────────────────────────── */

function scales() {
  const fs_ = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'].map((k) => ({ name: `vh-fs-${k}`, value: cssVar(`vh-fs-${k}`) }));
  const space = ['1', '2', '3', '4', '5', '6', '7'].map((k) => ({ name: `vh-s${k}`, value: cssVar(`vh-s${k}`) }));
  const radius = ['sm', 'md', 'lg', 'pill'].map((k) => ({ name: `vh-r-${k}`, value: cssVar(`vh-r-${k}`) }));
  const lift = ['1', '2'].map((k) => ({ name: `vh-lift-${k}`, value: cssVar(`vh-lift-${k}`) }));
  const motion = [
    ['vh-t-fast', 'Hover colour, press.'], ['vh-t-mid', 'Card hover border.'], ['vh-t-hud', 'Lift and glow on a spring.'],
    ['vh-ease-spring', 'Anything that should feel driven.'], ['vh-ease-soft', 'Fades, shimmer.'], ['vh-ease-genjutsu', 'Scroll reveal (motion.js).'],
    ['vh-reveal-dur', 'Scroll reveal duration.'], ['vh-reveal-y', 'Scroll reveal travel.'],
  ].map(([n, u]) => ({ name: n, value: cssVar(n), usage: u }));
  return { fontSize: fs_, space, radius, lift, motion };
}

/* ── tokens.json (the repo's contract file) ────────────────────────────────── */

function contract() {
  const P = palettes();
  const m = mark.tokens();
  const S = scales();
  return {
    name: 'Lifecycle OS',
    version: 1,
    generated_by: 'scripts/build-design-system.js (do not edit by hand)',
    contract_doc: 'design/lifecycle-os/CONTRACT.md',
    rules: {
      text_aa: 4.5,
      text_aa_large: 3,
      non_text: 3,
      text_token_floor: core.TEXT_AA,
      dark_neutral: 'luminance < 0.12 and saturation < 0.25 (isDarkNeutral): never a section ground',
      light_only: 'One light theme. The surface is the brand\'s validated light surface; there is no dark theme.',
      no_literal: 'No colour literal in a component rule (theme.css DESIGN-SYSTEM:contract block, design-system.html).',
    },
    platform: {
      mark: { file: 'assets/lifecycle-os-mark.svg', ink: m.ink, tile: m.tile, line: m.line, rule: 'Neutral by scripts/audit-pages.js lowSat; never a tenant colour.' },
      wordmark: { text: mark.WORDMARK, font: mark.WORDMARK_FONT, weight: 700 },
      logos: mark.LOGO_SET.map((l) => ({ file: l.file, kind: l.kind, use: l.use })),
      rasters: mark.LOGO_RASTERS.map((r) => ({ file: r.file, w: r.w, h: r.h, from: r.from })),
      icons: mark.TARGETS.filter((t) => t.file.startsWith('assets/')).map((t) => ({ file: t.file, w: t.w, h: t.h, kind: t.kind, use: t.use })),
    },
    brand_tokens: BRAND_TOKENS.map(([name, derivation, usage]) => ({ name: `--${name}`, derivation, usage })),
    app_tokens: APP_TOKENS.map(([name, resolves, usage]) => ({ name: `--${name}`, resolves: `--${resolves}`, usage })),
    surfaces: SURFACES.map(([surface, ground, text, edge, shipped]) => ({ surface, ground, text, edge, shipped_in: shipped })),
    type: {
      families: {
        heading: '--vh-font-head (the active brand\'s heading stack, --brand-font-head)',
        body: '--vh-font-body (--brand-font-body)',
        mono: '--vh-font-mono (--brand-font-mono)',
        wordmark: '--los-font-wordmark (the platform\'s, never a tenant\'s)',
      },
      scale: S.fontSize,
    },
    spacing: S.space,
    radius: S.radius.concat([{ name: 'brand-radius-control', value: 'measured from the brand\'s own site, else --vh-r-sm' }, { name: 'brand-radius-card', value: 'measured, else --vh-r-lg' }]),
    elevation: S.lift,
    motion: S.motion.concat([{ name: 'prefers-reduced-motion', value: 'reduce', usage: 'Every animation and transition drops to .001ms; nothing that was hidden for an animation stays hidden.' }]),
    examples: P.map((p) => ({
      id: p.id, name: p.name, why: p.why, from: p.from, validates: p.valid, palette: p.palette,
      tokens: Object.fromEntries(Object.entries(p.tokens).filter(([k]) => !/font/.test(k))),
    })),
  };
}

/* ── CONTRACT.md generated tables ──────────────────────────────────────────── */

const GEN_BEGIN = '<!-- >>> DESIGN-SYSTEM:generated by scripts/build-design-system.js, do not edit by hand -->';
const GEN_END = '<!-- <<< DESIGN-SYSTEM:generated -->';
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');

function contractTables(c) {
  const L = [];
  L.push('### Surface to token');
  L.push('');
  L.push('| Surface | Ground | Text | Edge / line | Shipped in |');
  L.push('|---|---|---|---|---|');
  for (const s of c.surfaces) L.push(`| ${cell(s.surface)} | ${cell(s.ground)} | ${cell(s.text)} | ${cell(s.edge)} | ${cell(s.shipped_in)} |`);
  L.push('');
  L.push('### App tokens (`--vh-*`) and the brand token each resolves through');
  L.push('');
  L.push('| App token | Resolves through | Use |');
  L.push('|---|---|---|');
  for (const t of c.app_tokens) L.push(`| \`${t.name}\` | \`${t.resolves}\` | ${cell(t.usage)} |`);
  L.push('');
  L.push('### Brand tokens (`--brand-*`) and how `tokens()` derives each');
  L.push('');
  L.push('| Brand token | Derivation | Use |');
  L.push('|---|---|---|');
  for (const t of c.brand_tokens) L.push(`| \`${t.name}\` | ${cell(t.derivation)} | ${cell(t.usage)} |`);
  L.push('');
  L.push('### The derived tokens, computed for every gate palette');
  L.push('');
  const keys = ['--brand-primary', '--brand-on-primary', '--brand-primary-text', '--brand-accent-text', '--brand-ink-muted', '--brand-surface-sunken', '--brand-band', '--brand-on-band', '--brand-err-text', '--brand-focus'];
  L.push('| Palette | ' + keys.map((k) => `\`${k.replace('--brand-', '')}\``).join(' | ') + ' |');
  L.push('|---|' + keys.map(() => '---').join('|') + '|');
  for (const e of c.examples) L.push(`| ${cell(e.name)} | ` + keys.map((k) => `\`${e.tokens[k]}\``).join(' | ') + ' |');
  L.push('');
  return L.join('\n');
}

function renderContractMd(c) {
  const file = path.join(DS, 'CONTRACT.md');
  const src = fs.readFileSync(file, 'utf8');
  const bi = src.indexOf(GEN_BEGIN), ei = src.indexOf(GEN_END);
  if (bi < 0 || ei < 0) throw new Error('CONTRACT.md has no DESIGN-SYSTEM:generated markers');
  return src.slice(0, bi + GEN_BEGIN.length) + '\n' + contractTables(c) + '\n' + src.slice(ei);
}

/* ── DESIGN.md front matter (google-labs-code/design.md, alpha) ─────────────
   The same format the brand context pack emits for a BRAND (see
   api/_shared/brand-context-pack.js), here for the PLATFORM. Generated, so
   each value is read from the file that holds it; the prose below the front
   matter is written by hand. Each token carries its source as a YAML comment. */
const q = (v) => JSON.stringify(String(v));
const maxOf = (v) => { const m = String(v).match(/(\d+(?:\.\d+)?)px\s*\)?\s*$/); return m ? `${m[1]}px` : String(v); };

function designFrontMatter(c) {
  const m = c.platform.mark;
  const bare = core.tokens({ palette: {} });
  const sys = mark.WORDMARK_FONT.replace(/'/g, '');
  const mono = cssVar('vh-font-mono').replace(/^var\(--brand-font-mono,\s*/, '').replace(/\)$/, '').replace(/'/g, '');
  const fs_ = Object.fromEntries(c.type.scale.map((x) => [x.name.replace('vh-fs-', ''), x.value]));
  const L = ['---', 'version: alpha', 'name: "Lifecycle OS"',
    'description: ' + q("The design system of Lifecycle OS, a universal lifecycle-marketing platform: the platform's own neutral mark, and one surface contract every screen takes its colours from, derived from the ACTIVE brand."),
    'omitted:',
    '  - section: components',
    '    reason: ' + q("Every component colour is a role resolved from the active brand at run time (design/lifecycle-os/CONTRACT.md), which a static token reference cannot express without naming one brand's values as the platform's. Components are documented in prose and rendered live on /design-system."),
    'colors:',
    `  primary: ${q(m.ink)}  # assets/lifecycle-os-mark.svg --los-ink: the mark's ink, the platform's only identity colour`,
    `  on-primary: ${q('#FFFFFF')}  # the ground of the share card and the lockups`,
    `  surface: ${q('#FFFFFF')}  # the ground the logo set is drawn for`,
    `  surface-container: ${q(m.tile)}  # assets/lifecycle-os-mark.svg --los-tile`,
    `  on-surface: ${q(m.ink)}  # assets/lifecycle-os-mark.svg --los-ink`,
    `  outline: ${q(m.line)}  # assets/lifecycle-os-mark.svg --los-line`,
    `  error: ${q(bare['--brand-err'].toUpperCase())}  # tokens() default --brand-err, the state colour a brand without one gets`,
    'typography:',
    '  wordmark:  # scripts/build-platform-mark.js WORDMARK_FONT, the lockups',
    `    fontFamily: ${q(sys)}`, '    fontSize: "34px"', '    fontWeight: 700',
    `  headline-lg:  # theme.css --vh-fs-2xl ${fs_['2xl']}, .vh-h1`,
    `    fontFamily: ${q(sys)}`, `    fontSize: ${q(maxOf(fs_['2xl']))}`, '    fontWeight: 600', '    lineHeight: 1.1', '    letterSpacing: "-0.02em"',
    `  headline-md:  # theme.css --vh-fs-xl ${fs_.xl}, .vh-h2`,
    `    fontFamily: ${q(sys)}`, `    fontSize: ${q(maxOf(fs_.xl))}`, '    fontWeight: 600', '    lineHeight: 1.2', '    letterSpacing: "-0.01em"',
    `  title:  # theme.css --vh-fs-lg ${fs_.lg}, .vh-h3`,
    `    fontFamily: ${q(sys)}`, `    fontSize: ${q(maxOf(fs_.lg))}`, '    fontWeight: 600', '    lineHeight: 1.3',
    '  body:  # theme.css --vh-fs-md, .vh-body',
    `    fontFamily: ${q(sys)}`, `    fontSize: ${q(fs_.md)}`, '    fontWeight: 400', '    lineHeight: 1.55',
    '  body-sm:  # theme.css --vh-fs-sm, .vh-small',
    `    fontFamily: ${q(sys)}`, `    fontSize: ${q(fs_.sm)}`, '    fontWeight: 400', '    lineHeight: 1.5',
    '  label:  # theme.css --vh-fs-xs, .vh-eyebrow (mono, uppercase)',
    `    fontFamily: ${q(mono)}`, `    fontSize: ${q(fs_.xs)}`, '    fontWeight: 600', '    letterSpacing: "0.12em"',
    'rounded:',
  ];
  const rk = { 'vh-r-sm': 'sm', 'vh-r-md': 'md', 'vh-r-lg': 'lg', 'vh-r-pill': 'full' };
  for (const r of c.radius.filter((x) => rk[x.name])) L.push(`  ${rk[r.name]}: ${q(r.value)}  # theme.css --${r.name}`);
  L.push('spacing:');
  for (const sp of c.spacing) L.push(`  ${q(sp.name.replace('vh-s', ''))}: ${q(sp.value)}  # theme.css --${sp.name}`);
  L.push('---');
  return L.join('\n') + '\n';
}

function renderDesignMd(c) {
  const file = path.join(DS, 'DESIGN.md');
  const src = fs.readFileSync(file, 'utf8');
  if (!src.startsWith('---\n')) throw new Error('DESIGN.md must open with its front matter');
  const end = src.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('DESIGN.md front matter is not closed');
  return designFrontMatter(c) + src.slice(end + 5);
}

function outputs() {
  const c = contract();
  return {
    'design/lifecycle-os/tokens.json': JSON.stringify(c, null, 2) + '\n',
    'design/lifecycle-os/CONTRACT.md': renderContractMd(c),
    'design/lifecycle-os/DESIGN.md': renderDesignMd(c),
  };
}

module.exports = { palettes, contract, outputs, BRAND_TOKENS, APP_TOKENS, SURFACES, scales, cssVar };

if (require.main === module) {
  const CHECK = process.argv.includes('--check');
  let drift = 0;
  for (const [rel, body] of Object.entries(outputs())) {
    const abs = path.join(ROOT, rel);
    const cur = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (cur === body) { console.log(`in sync  ${rel}`); continue; }
    if (CHECK) { console.error(`DRIFTED  ${rel}`); drift++; continue; }
    fs.writeFileSync(abs, body);
    console.log(`wrote    ${rel}`);
  }
  const ai = process.argv.indexOf('--artifact');
  if (ai > 0) {
    const dir = process.argv[ai + 1];
    if (!dir) { console.error('--artifact needs a directory'); process.exit(1); }
    require('./lib/design-system-artifact.js').write(dir, contract());
  }
  if (CHECK && drift) { console.error('\nThe design system drifted from its sources: run node scripts/build-design-system.js'); process.exit(1); }
}
