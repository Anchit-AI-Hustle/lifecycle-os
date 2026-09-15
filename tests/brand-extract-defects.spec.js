/**
 * SEVEN DEFECTS IN READING A BRAND OFF ITS OWN SITE, each found by RUNNING the
 * extractor over a fixture and reading the report - none visible from the
 * parser's source, and every one reproduced here before it was fixed.
 * ---------------------------------------------------------------------------
 *   D5  Off-origin platform CDN stylesheets were DROPPED. A Shopify store links
 *       its theme.css from cdn.shopify.com, so it lost its entire design system:
 *       stylesheets [], palette empty, typography [], scale 0 rows, 9 markers.
 *       Off-origin IMAGES were collected and flagged; sheets were silently gone.
 *   D3  A `@media (prefers-color-scheme: dark)` block OVERWROTE the light
 *       palette. Nested rulesets were flattened with at:'' and custom properties
 *       are last-wins, so the DARK surface was proposed and #ffffff appeared
 *       nowhere - then validatePalette rejected the brand's own light palette.
 *   D4  The surface filter accepted a DARK NEUTRAL: `c.neutral || relLum > 0.6`
 *       let #0a1410 through as the page surface (body text then 1.01:1).
 *   D2  Every `--brand-*` token was filed as IDENTITY, so on a site using this
 *       repo's OWN canonical names (--brand-primary/accent/ink/surface) the
 *       accent, ink and surface came back empty with three markers; with an
 *       `--ok` token beside them, a success-green was proposed as the accent.
 *       D2b: `--brand-primary-text` - a readableAsText() DERIVATION - was
 *       selected as the PRIMARY on this repo's own theme.css.
 *   D6  <script> bodies were parsed as CSS and scanned for <img>. On the Mailer
 *       Studio page 10 of 12 "inline stylesheets" were JavaScript, the logo was
 *       `…/'+KNICKGASM_LOGO_URL+'` and 6 of 7 top images were JS expressions.
 *   D1  HTML entities were never decoded beyond six. `&copy; 2026 Tealight
 *       Trading Ltd.` yielded NO legal entity, a verbatim claim shipped
 *       `&pound;40 &mdash;`, and that `&mdash;` was invisible to scrubDashes().
 *   D7  brand-harvest passed an onPage observer that extractBrand never called:
 *       ok:true, pages_visited:6, image library ZERO. Its only guard was a
 *       source assertion (`expect(s).toMatch(/onPage/)`) that passed with the
 *       hook dead. The executed replacement lives in brand-harvest.spec.js.
 *
 * Every test EXECUTES extractBrand / proposePalette / harvest over fixtures via
 * an injected fetchImpl. Mutation-verified: restoring each defect fails its test.
 *
 * Run: npx playwright test tests/brand-extract-defects.spec.js
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const bx = require(path.join(ROOT, 'api', '_shared', 'brand-extract.js'));
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const { scrubDashes } = require(path.join(ROOT, 'api', '_shared', 'scenario-model.js'));

/* ── fixture plumbing (the storefront-and-sitemap harness) ───────────────── */

const page = (b) => ({ body: b, contentType: 'text/html; charset=utf-8' });
const sheet = (b) => ({ body: b, contentType: 'text/css' });
const txt = (b) => ({ body: b, contentType: 'text/plain' });

const fetchOf = (site, log) => async (u) => {
  const k = String(u).split('#')[0];
  if (log) log.push(k);
  const row = site[k] || site[k.replace(/\/$/, '')];
  return row
    ? { ok: true, status: 200, body: row.body, url: k, contentType: row.contentType }
    : { ok: false, status: 404, body: '', url: k, contentType: 'text/plain' };
};

const HOST = 'https://tealight.example';
const noLlm = async () => { throw new Error('no provider configured in tests'); };
const run = (site, log) => bx.extractBrand(`${HOST}/`, {
  brand: { website: HOST }, fetchImpl: fetchOf(site, log), llm: noLlm, voice: false,
});
const robots = { [`${HOST}/robots.txt`]: txt('User-agent: *\nAllow: /') };

/* ═══════════════════════════════════════════════════════════════════════════
   D5. A STYLESHEET LINKED FROM THE BRAND'S OWN PAGE IS THE BRAND'S STYLESHEET
   ═══════════════════════════════════════════════════════════════════════════ */

const SHOPIFY_CDN_CSS = 'https://cdn.shopify.com/s/files/1/0001/t/1/assets/theme.css';
const THEME_CSS = `
:root{--brand-primary:#0F62FE;--brand-accent:#FF7EB6;--brand-ink:#161616;--brand-surface:#FFFFFF}
html,body{background:var(--brand-surface);color:var(--brand-ink);font-family:"Inter",system-ui,sans-serif}
h1{font-size:56px;font-weight:700;font-family:"Tealight Serif",Georgia,serif}
`;
const storeLinking = (cssUrl) => Object.assign({
  [`${HOST}/`]: page(`<!doctype html><html><head><title>Tealight Co</title>
    <meta name="generator" content="Shopify">
    <link rel="stylesheet" href="${cssUrl}">
    </head><body class="shopify-section"><h1>Tealight Co</h1>
    <a href="/about">About</a>
    <a href="https://cdn.shopify.com/s/files/1/0001/pages/lookbook">A page on the CDN host</a>
    </body></html>`),
  [cssUrl]: sheet(THEME_CSS),
  [`${HOST}/about`]: page('<!doctype html><html><head><title>About</title></head><body><h1>About</h1></body></html>'),
}, robots);

test('D5: a theme.css on the platform CDN is read, and the store keeps its design system', async () => {
  const log = [];
  const r = await run(storeLinking(SHOPIFY_CDN_CSS), log);

  // The premise, measured before the fix: stylesheets [] and everything below empty.
  expect(r.stylesheets, 'the CDN-hosted stylesheet was not read').toContain(SHOPIFY_CDN_CSS);
  const entry = r.stylesheet_sources.find((s) => s.url === SHOPIFY_CDN_CSS);
  expect(entry).toBeTruthy();
  // Recorded as off-origin with its host - exactly as images are - never silently adopted.
  expect(entry.off_origin).toBe(true);
  expect(entry.host).toBe('cdn.shopify.com');
  expect(entry.platform).toBe('shopify');
  expect(r.stylesheets_off_origin).toBe(1);
  expect(r.notes.join(' ')).toMatch(/read \(off-origin, shopify platform CDN cdn\.shopify\.com\)/);

  const p = r.fields.palette.proposed;
  expect(p.primary).toBe('#0f62fe');
  expect(p.accent).toBe('#ff7eb6');
  expect(p.ink).toBe('#161616');
  expect(p.surface).toBe('#ffffff');
  expect(r.fields.palette.markers).toEqual([]);
  expect(r.fields.typography.heading.map((c) => c.value)).toContain('Tealight Serif');
  expect(r.fields.typography.body.map((c) => c.value)).toContain('Inter');
  const h1 = r.fields.typography.scale.find((s) => s.slot === 'h1');
  expect(h1 && h1.px, 'the 56px h1 on the CDN sheet was not read').toBe(56);

  // THE SCOPE OF THE PAGE CRAWL DID NOT WIDEN. The CDN host was touched for the
  // linked stylesheet and for nothing else - the "page" link on it was never
  // followed, because that is the SSRF and competitor rule.
  expect(log.filter((u) => /cdn\.shopify\.com/.test(u))).toEqual([SHOPIFY_CDN_CSS]);
});

test('D5: a stylesheet on an unknown third-party host stays skipped, and says so', async () => {
  const evil = 'https://cdn.evil.example/theme.css';
  const log = [];
  const r = await run(storeLinking(evil), log);
  expect(r.stylesheets).not.toContain(evil);
  expect(r.stylesheet_sources).toEqual([]);
  expect(r.notes.join(' ')).toMatch(/skipped \(off-origin asset\): https:\/\/cdn\.evil\.example\/theme\.css/);
  // Not even fetched.
  expect(log.some((u) => /evil\.example/.test(u))).toBe(false);
  // And the palette is honestly empty rather than borrowed from anywhere.
  expect(r.fields.palette.proposed.primary).toBe('');
});

test('D5: the widening is the platform table, host-only - a path-shaped signal admits no foreign host', () => {
  expect(bx.platformCdnOf('https://cdn.shopify.com/s/files/1/t.css')).toBe('shopify');
  expect(bx.platformCdnOf('https://static1.squarespace.com/x.css')).toBe('squarespace');
  expect(bx.platformCdnOf('https://static.parastorage.com/x.css')).toBe('wix');
  expect(bx.platformCdnOf('https://cdn11.bigcommerce.com/x.css')).toBe('bigcommerce');
  expect(bx.platformCdnOf('https://assets-global.website-files.com/x.css')).toBe('webflow');
  expect(bx.platformCdnOf('https://cdn.evil.example/theme.css')).toBe('');
  // `/wp-content/plugins/woocommerce/` is a WooCommerce signal ON THE BRAND'S
  // OWN ORIGIN; a foreign host carrying that path is still foreign.
  expect(bx.platformCdnOf('https://evil.example/wp-content/plugins/woocommerce/x.css')).toBe('');
});

/* ═══════════════════════════════════════════════════════════════════════════
   D3. THE DARK SCHEME IS A DIFFERENT PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

const SCHEME_CSS = `
:root{--brand-primary:#2E6F5E;--brand-accent:#E8B04B;--brand-surface:#FFFFFF;--brand-ink:#14181F}
html,body{background:var(--brand-surface);color:var(--brand-ink)}
h1{font-size:48px;color:#14181F}
@media (prefers-color-scheme: dark){
  :root{--brand-surface:#0B0F0D;--brand-ink:#EDF2EF}
  html,body{background:#0B0F0D;color:#EDF2EF}
  h1{color:#EDF2EF;font-size:40px}
}
@media print{html,body{background:#000000;color:#FFFFFF}}
@media (max-width:600px){:root{--brand-surface:#EEEEEE}h1{font-size:32px}}
`;
const schemeSite = (css) => Object.assign({
  [`${HOST}/`]: page(`<!doctype html><html><head><title>Tealight</title><link rel="stylesheet" href="/s.css"></head><body><h1>Tealight</h1></body></html>`),
  [`${HOST}/s.css`]: sheet(css),
}, robots);

test('D3: the light palette survives a prefers-color-scheme:dark block, and print', async () => {
  const r = await run(schemeSite(SCHEME_CSS));
  const p = r.fields.palette.proposed;
  expect(p.surface, 'the DARK surface overwrote the light one').toBe('#ffffff');
  expect(p.ink).toBe('#14181f');
  expect(p.primary).toBe('#2e6f5e');
  // A dark-only token appears NOWHERE in the proposal - nor print's, nor the
  // breakpoint's override of a root-level declaration.
  const flat = JSON.stringify(p).toLowerCase();
  for (const dark of ['#0b0f0d', '#edf2ef', '#000000', '#eeeeee']) expect(flat).not.toContain(dark);
  // The proposal passes the gate that blocks activation - the point of all this.
  const filled = Object.fromEntries(Object.entries(p).filter(([, v]) => v));
  expect(core.validatePalette(filled).ok).toBe(true);

  // Typography reads the same page: the h1 is 48px in its light colour, not
  // the dark scheme's or the phone breakpoint's.
  const h1 = r.fields.typography.scale.find((s) => s.slot === 'h1');
  expect(h1.px).toBe(48);
  expect(h1.color).toBe('#14181f');
});

test('D3: a token declared ONLY inside a responsive breakpoint is still read; one also at root level is the root\'s', async () => {
  const css = `
:root{--brand-primary:#2E6F5E;--brand-surface:#FFFFFF;--brand-ink:#14181F}
html,body{background:var(--brand-surface);color:var(--brand-ink)}
@media (min-width:900px){:root{--brand-accent:#E8B04B;--brand-surface:#F4F4F4}}
`;
  const r = await run(schemeSite(css));
  const p = r.fields.palette.proposed;
  expect(p.accent, 'a breakpoint-only token is still the site\'s token').toBe('#e8b04b');
  expect(p.surface, 'a breakpoint must never override the root-level declaration').toBe('#ffffff');
});

test('D3: every nested ruleset carries the at-rule it lives in', () => {
  const rules = bx.cssRulesets(`
    :root{--s:#fff}
    @media (prefers-color-scheme: dark){:root{--s:#000}}
    @media (max-width:600px){:root{--s:#eee}}
    @layer base{body{color:#222}}
    @supports (display:grid){@media print{body{background:#000}}}
  `);
  expect(rules.map((r) => r.at)).toEqual([
    '', '@media (prefers-color-scheme: dark)', '@media (max-width:600px)', '', '@supports (display:grid) @media print',
  ]);
  expect(bx.atExcluded('@media (prefers-color-scheme: dark)')).toBe(true);
  expect(bx.atExcluded('@media print')).toBe(true);
  expect(bx.atExcluded('@supports (display:grid) @media print')).toBe(true);
  expect(bx.atExcluded('@media (max-width:600px)')).toBe(false);
  expect(bx.atExcluded('@media (prefers-color-scheme: light)')).toBe(false);
  expect(bx.atExcluded('')).toBe(false);
  // customProperties honours it: the dark value never lands, the breakpoint never overrides.
  const { values } = bx.customProperties(rules);
  expect(values.get('--s')).toBe('#fff');
});

/* ═══════════════════════════════════════════════════════════════════════════
   D4. A SURFACE MUST BE LIGHT
   ═══════════════════════════════════════════════════════════════════════════ */

const surfaceCand = (value, score) => ({
  value, score, signal: 'css:background on html,body', source_url: `${HOST}/s.css`,
  confidence: 'weak', evidence: '', seen: [], neutral: bx.isNeutral(value),
});

test('D4: a dark neutral that outranks the white ground is never proposed as the surface', () => {
  // The measured input: isNeutral('#0a1410') is true, so the old
  // `c.neutral || relLum > 0.6` filter let black through.
  expect(bx.isNeutral('#0a1410')).toBe(true);
  const p = bx.proposePalette({ surface: [surfaceCand('#0a1410', 30), surfaceCand('#ffffff', 10)] });
  expect(p.proposed.surface).toBe('#ffffff');
  expect(p.sources.surface.signal).toBeTruthy();
});

test('D4: with ONLY a dark ground, nothing is proposed and the reason is stated', () => {
  const p = bx.proposePalette({ surface: [surfaceCand('#0a1410', 30)] });
  expect(p.proposed.surface).toBe('');
  expect(p.missing).toContain('surface');
  expect(p.notes.join(' ')).toMatch(/dark \(#0a1410/);
  // What the old filter's proposal met two steps later: the activation gate,
  // which measured body text on that ground at about 1:1 and refused it.
  const old = core.validatePalette({ primary: '#2e6f5e', ink: '#14181f', surface: '#0a1410' });
  expect(old.ok).toBe(false);
  expect(old.contrast.ink_on_surface).toBeLessThan(1.5);
});

test('D4: end to end - a dark-first site\'s ground loses to its light one, however many rules paint it', async () => {
  const css = `
:root{--brand-primary:#2E6F5E}
html{background:#0a1410}:root{background:#0a1410}body.dark{background:#0a1410}
body{background:#ffffff;color:#14181F}
`;
  const r = await run(schemeSite(css));
  // Premise: by weight the dark ground ranks first.
  expect(r.fields.palette.roles.surface[0].value).toBe('#0a1410');
  expect(r.fields.palette.proposed.surface).toBe('#ffffff');
});

/* ═══════════════════════════════════════════════════════════════════════════
   D2. THE ROLE WORD BEFORE THE BRAND PREFIX
   ═══════════════════════════════════════════════════════════════════════════ */

const CANONICAL_CSS = `
:root{--brand-primary:#E11D48;--brand-accent:#F59E0B;--brand-ink:#111827;--brand-surface:#FFFFFF;--ok:#3fa46a}
html,body{background:var(--brand-surface);color:var(--brand-ink)}
`;

test('D2: this repo\'s own canonical token names fill all four roles from their own tokens', async () => {
  const r = await run(schemeSite(CANONICAL_CSS));
  const { proposed: p, sources, markers, roles } = r.fields.palette;
  expect(p.primary).toBe('#e11d48');
  expect(p.accent, 'the accent fell through to something else').toBe('#f59e0b');
  expect(sources.accent.from_role).toBe('action');
  expect(sources.accent.signal).toContain('--brand-accent');
  expect(p.ink).toBe('#111827');
  expect(sources.ink.signal).toContain('--brand-ink');
  expect(p.surface).toBe('#ffffff');
  expect(sources.surface.signal).toContain('--brand-surface');
  expect(markers).toEqual([]);
  // Only the primary is an identity signal; the other three were not filed there.
  expect((roles.identity || []).map((c) => c.value)).toEqual(['#e11d48']);
  // And the success-green is a support candidate, never the accent.
  expect(p.accent).not.toBe('#3fa46a');
});

test('D2: the token name is read by its ROLE word, and a derived text token is never identity', () => {
  expect(bx.tokenNameRole('--brand-primary')).toBe('identity');
  expect(bx.tokenNameRole('--brand')).toBe('identity');
  expect(bx.tokenNameRole('--color-brand')).toBe('identity');
  expect(bx.tokenNameRole('--brand-accent')).toBe('action');
  expect(bx.tokenNameRole('--brand-ink')).toBe('ink');
  expect(bx.tokenNameRole('--brand-surface')).toBe('surface');
  expect(bx.tokenNameRole('--brand-line')).toBe('support');
  expect(bx.tokenNameRole('--brand-ok')).toBe('status');
  expect(bx.tokenNameRole('--ok')).toBe('status');
  // D2b: the derivations.
  for (const derived of ['--brand-primary-text', '--brand-accent-text', '--brand-on-primary', '--on-primary', '--accent-fg', '--primary-contrast']) {
    expect(bx.tokenNameRole(derived), `${derived} must never be identity`).not.toBe('identity');
    expect(bx.tokenNameRole(derived)).toBe('derived');
  }
  // But a site's TEXT colour is its ink, whatever prefix it wears.
  expect(bx.tokenNameRole('--brand-text')).toBe('ink');
  expect(bx.tokenNameRole('--on-surface')).toBe('ink');
  expect(bx.tokenNameRole('--text-primary')).toBe('ink');
});

test('D2b: on this repo\'s own theme.css, no *-text token is selected as the primary', () => {
  // theme.css DECLARES `--brand-primary-text: #d0473e` and REFERENCES
  // `--brand-primary` only through var() fallbacks. The old reader filed the
  // declared derivation as identity and proposed it as the brand colour.
  const themeCss = fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8');
  expect(themeCss).toMatch(/--brand-primary-text:\s*#d0473e/i);   // the premise, about the file
  const cs = bx.colourSightings({ html: '', url: `${HOST}/`, meta: {}, manifest: null, isHome: true, sheets: [{ url: `${HOST}/theme.css`, css: themeCss }] });
  const roles = bx.rankColours(cs.sightings);
  const p = bx.proposePalette(roles);
  expect((roles.identity || []).map((c) => c.signal).join(' ')).not.toMatch(/-text|-fg|on-/);
  expect(p.proposed.primary).not.toBe('#d0473e');
  if (p.sources.primary) expect(p.sources.primary.signal).not.toMatch(/-text|-fg|on-/);
  // The derivation is still offered - as a TEXT colour, below any declared ink.
  const derivedInk = (roles.ink || []).find((c) => /--brand-primary-text/.test(c.signal));
  expect(derivedInk).toBeTruthy();
  expect(derivedInk.signal).toContain('derived text token');
  expect(p.proposed.ink).not.toBe('#d0473e');
});

/* ═══════════════════════════════════════════════════════════════════════════
   D6. A <script> IS THE PROGRAM, NOT THE PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

const SCRIPTY_HOME = `<!doctype html><html><head><title>Tealight</title>
<style>:root{--brand-primary:#0F62FE;--brand-ink:#111111;--brand-surface:#FFFFFF}html,body{background:var(--brand-surface);color:var(--brand-ink)}</style>
<script>
var Shopify = Shopify || {}; Shopify.shop = "tealight-co.myshopify.com";
var tpl = '<style>:root{--brand-primary:#BADBAD}</style>';
var hero = '<img src="'+heroImg+'" alt="Hero shot">';
var logo = '<img class="logo" src="https://tealight.example/'+LOGO_URL+'" alt="logo">';
var m = '<meta name="theme-color" content="#BADBAD"><link rel="stylesheet" href="https://cdn.shopify.com/js-only.css">';
var f = '<footer><p>&copy; 2026 Not A Company Ltd.</p></footer>';
</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Tealight Co","logo":"https://tealight.example/logo.svg"}</script>
</head><body>
<header><img class="site-logo" src="/wordmark.png" alt="Tealight wordmark"></header>
<h1>Tealight</h1>
<img src="/real.jpg" alt="A real tealight">
<noscript><img src="/noscript-only.jpg" alt="No script"></noscript>
<template><img src="/template-only.jpg" alt="Template"></template>
<footer><p>&copy; 2026 Tealight Trading Ltd.</p></footer>
</body></html>`;

test('D6: script bodies are neither stylesheets nor markup - and what belongs in a script is still read', async () => {
  const log = [];
  const r = await run(Object.assign({ [`${HOST}/`]: page(SCRIPTY_HOME) }, robots), log);

  // One real <style>; the one inside a JS string is not a stylesheet.
  expect(r.inline_style_blocks).toBe(1);
  expect(r.fields.palette.proposed.primary).toBe('#0f62fe');
  expect(JSON.stringify(r).toLowerCase()).not.toContain('#badbad');
  // A <link> inside a JS string is not a stylesheet link either.
  expect(log.some((u) => /js-only\.css/.test(u))).toBe(false);

  // Images: the real one, and none of the JS expression, <noscript> or <template> ones.
  const images = r.fields.images.candidates.map((c) => c.value);
  expect(images).toEqual([`${HOST}/real.jpg`]);
  // Logo: the JSON-LD one (a script that IS the page's data) and the labelled
  // wordmark; never a string concatenation.
  const logos = r.fields.logo.candidates.map((c) => c.value);
  expect(logos).toContain(`${HOST}/logo.svg`);
  expect(logos).toContain(`${HOST}/wordmark.png`);
  for (const l of logos) expect(l).not.toContain("'+");
  // The legal entity is the footer's, not the one in a JS string.
  const legal = r.fields.legal.candidates.map((c) => c.value);
  expect(legal).toContain('Tealight Trading Ltd');
  expect(legal.join(' ')).not.toContain('Not A Company');
  // JSON-LD and the platform's global object live in scripts, and are still read.
  expect(r.fields.name.value).toBe('Tealight Co');
  expect(r.fields.storefront.platform.id).toBe('shopify');
});

test('D6: withoutScripts removes script, noscript and template bodies and nothing else', () => {
  const out = bx.withoutScripts('<p>a</p><script>x="<style>b</style>"</script><noscript><img src=n></noscript><template><img src=t></template><style>c</style><img src=k>');
  expect(out).not.toContain('<script');
  expect(out).not.toContain('src=n');
  expect(out).not.toContain('src=t');
  expect(out).toContain('<style>c</style>');
  expect(out).toContain('src=k');
  expect(out).toContain('<p>a</p>');
});

/* ═══════════════════════════════════════════════════════════════════════════
   D1. THE SITE'S TEXT, NOT ITS SOURCE
   ═══════════════════════════════════════════════════════════════════════════ */

const ENTITY_HOME = `<!doctype html><html><head><title>Tealight &amp; Co</title>
<meta name="description" content="Candles &amp; more &mdash; hand poured">
</head><body>
<h1>Tealight &amp; Co</h1>
<img src="/a.jpg" alt="Caf&eacute; &amp; Bar candle">
<ul class="trust-bar"><li>Free shipping over &pound;40 &mdash; UK only</li><li>30 day returns</li></ul>
<footer><p>&copy; 2026 Tealight Trading Ltd. All rights reserved.</p></footer>
</body></html>`;

test('D1: `&copy; 2026 Tealight Trading Ltd.` yields the legal entity', async () => {
  const r = await run(Object.assign({ [`${HOST}/`]: page(ENTITY_HOME) }, robots));
  const legal = r.fields.legal.candidates;
  expect(legal.map((c) => c.value), 'the copyright line was read as source, not text').toContain('Tealight Trading Ltd');
  expect(legal[0].signal).toBe('html:footer copyright line');
  expect(r.markers.join(' ')).not.toContain('legal entity');
});

test('D1: a verbatim claim carries £40 and an em dash scrubDashes can see', async () => {
  const r = await run(Object.assign({ [`${HOST}/`]: page(ENTITY_HOME) }, robots));
  const claim = r.fields.claims.candidates.find((c) => /Free shipping/.test(c.value));
  expect(claim).toBeTruthy();
  expect(claim.value).toBe('Free shipping over £40 — UK only');
  expect(claim.value).not.toMatch(/&pound;|&mdash;/);
  // The brand's no-em-dash rule now reaches it: the encoded dash bypassed scrubDashes.
  expect(scrubDashes(claim.value)).toBe('Free shipping over £40 - UK only');
  expect(scrubDashes('Free shipping over &pound;40 &mdash; UK only')).toContain('&mdash;');   // the old shape, still opaque to it
});

test('D1: attribute values, meta content and the title are text too', async () => {
  const r = await run(Object.assign({ [`${HOST}/`]: page(ENTITY_HOME) }, robots));
  expect(r.fields.images.candidates[0].alt).toBe('Café & Bar candle');
  expect(r.fields.tagline.value).toBe('Candles & more — hand poured');
  expect(r.fields.name.candidates.map((c) => c.value)).toContain('Tealight & Co');
});

test('D1: decimal and hex references decode; a double-encoded entity decodes exactly once', () => {
  const footer = (line) => bx.legalCandidates({ html: `<html><body><footer><p>${line}</p></footer></body></html>`, url: `${HOST}/`, ld: [] }).candidates.map((c) => c.value);
  expect(footer('&#169; 2026 Tealight Trading Ltd.')).toContain('Tealight Trading Ltd');
  expect(footer('&#xA9; 2026 Tealight Trading Ltd.')).toContain('Tealight Trading Ltd');
  expect(bx.decodeEntities('&amp;copy; is what the author wrote')).toBe('&copy; is what the author wrote');
  expect(bx.decodeEntities('&pound;40 &mdash; &hellip; &ldquo;x&rdquo; &reg; &trade; &deg;')).toBe('£40 — … “x” ® ™ °');
  // An unknown name and an invalid code point are left as written, never guessed.
  expect(bx.decodeEntities('&notathing; &#0; &#xD800;')).toBe('&notathing; &#0; &#xD800;');
});
