/**
 * A brand's typography is its scale, not only its two family names.
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACED. The extractor read font FAMILIES and stopped, and both it
 * and the context pack said so in as many words:
 *
 *     'Only `fontFamily` is emitted. Font size, weight, line-height and letter
 *      spacing cannot be read reliably from a stylesheet parse …'
 *     markers.push(MARKER('typography scale (size, weight, line-height, …)'));
 *
 * That was an honest sentence about a limit that did not exist. A `font-size` on
 * `h1` is published in the same rule, in the same stylesheet, as the
 * `font-family` beside it. The module simply never read the property, and then
 * shipped a DATA REQUIRED marker for a fact its own input contained.
 *
 * Everything here EXECUTES the real modules against real CSS. Four of the five
 * defects below were found by running this over stylesheets in this repo rather
 * than by reasoning about the parser:
 *
 *   · `html { font-size: 62.5% }` — the standard "1rem = 10px" trick — was read
 *     as the BODY size, because html/:root and body were the same slot. The real
 *     `body { font-size: 1.6rem }` then lost the tie and the brand was recorded
 *     as having 62.5% body text.
 *   · The link row was dropped entirely, because a row needed a font-size and
 *     `a { color: … }` almost never has one — losing the single most useful
 *     thing an operator means by "my font colours".
 *   · Matching a role word anywhere in a class name gave the h1 slot to
 *     `.nav-title` and the body slot to `.copy-preview-hl`.
 *   · Reading only bare `h1`..`h6` returned two rows from 197KB of this repo's
 *     own Mailer Studio CSS, because it — like most of the web — styles `.vh-h1`
 *     and never `h1`.
 *
 * Run: npx playwright test tests/brand-type-scale.spec.js
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const bx = require(path.join(ROOT, 'api', '_shared', 'brand-extract.js'));
const cp = require(path.join(ROOT, 'api', '_shared', 'brand-context-pack.js'));

const sheet = (css, url = 'https://brand.test/a.css') => ({ sheets: [{ url, css }] });
const bySlot = (out) => Object.fromEntries(out.scale.map((r) => [r.slot, r]));

/* ═══ the scale is read at all ════════════════════════════════════════════ */

test('size, weight, line-height, letter-spacing and colour all come back', () => {
  const out = bx.typeScaleCandidates(sheet(`
    body { font-size: 16px; line-height: 1.6; color: #1a1a1a; }
    h1 { font-size: 48px; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; color: #111111; }
  `));
  const s = bySlot(out);
  expect(s.h1, 'no h1 row was produced').toBeTruthy();
  expect(s.h1.size).toBe('48px');
  expect(s.h1.px).toBe(48);
  expect(s.h1.weight).toBe('700');
  expect(s.h1.line_height).toBe('1.1');
  expect(s.h1.letter_spacing).toBe('-0.02em');
  expect(s.h1.color).toBe('#111111');
  expect(s.body.size).toBe('16px');
  expect(s.body.color).toBe('#1a1a1a');
});

test('a named scale the site declares is captured as declared', () => {
  const out = bx.typeScaleCandidates(sheet(`
    :root { --font-size-base: 1rem; --text-xl: 2rem; --font-weight-bold: 700;
            --leading-tight: 1.15; --tracking-wide: 0.08em; --text-muted: #667788; }
  `));
  expect(out.tokens.size.map((c) => c.token).sort()).toEqual(['--font-size-base', '--text-xl']);
  expect(out.tokens.weight.map((c) => c.token)).toEqual(['--font-weight-bold']);
  expect(out.tokens.leading.map((c) => c.token)).toEqual(['--leading-tight']);
  expect(out.tokens.tracking.map((c) => c.token)).toEqual(['--tracking-wide']);
  // `--text-muted: #667788` is a COLOUR whose name starts with `text`. Matching
  // on the name alone would file it as a font size.
  expect(out.tokens.size.some((c) => /muted/.test(c.token)), 'a colour was filed as a size').toBe(false);
  for (const c of out.tokens.size) expect(c.confidence).toBe('declared');
});

/* ═══ rem is resolved against the root the SITE declared ══════════════════ */

test('a 62.5% root makes 1.6rem sixteen pixels, not twenty-five', () => {
  const out = bx.typeScaleCandidates(sheet(`
    html { font-size: 62.5%; }
    body { font-size: 1.6rem; color: #222; }
  `));
  expect(out.root_font_size.value).toBe(10);
  expect(out.root_font_size.declared).toBe(true);
  const s = bySlot(out);
  // The whole point: 1.6rem against the DECLARED 10px root is 16px. Against a
  // guessed 16px root it would be 25.6 — a fabricated number wearing a unit.
  expect(s.body.px).toBe(16);
  expect(s.body.size).toBe('1.6rem');
});

test('html is the root and body is the body — they are never the same slot', () => {
  const out = bx.typeScaleCandidates(sheet(`
    html { font-size: 62.5%; }
    body { font-size: 1.6rem; }
  `));
  const s = bySlot(out);
  expect(s.body.size, 'the root declaration was reported as the body size').toBe('1.6rem');
});

test('an undeclared root is assumed and says so', () => {
  const out = bx.typeScaleCandidates(sheet('body { font-size: 1rem; }'));
  expect(out.root_font_size.declared).toBe(false);
  expect(out.root_font_size.value).toBe(16);
  expect(out.root_font_size.evidence).toMatch(/assumed/i);
});

test('em is never converted, because there is no parent to resolve it against', () => {
  const out = bx.typeScaleCandidates(sheet('h2 { font-size: 1.25em; }'));
  const s = bySlot(out);
  expect(s.h2.size).toBe('1.25em');
  expect(s.h2.px, 'em was converted as though it were rem').toBeNull();
});

/* ═══ which selectors may speak for a slot ════════════════════════════════ */

test('a class named for the role is read; a component-scoped one is not', () => {
  const cases = [
    ['h1', 'h1'], ['.h1', 'h1'], ['.vh-h1', 'h1'], ['.heading-2', 'h2'], ['.title', 'h1'],
    ['.subtitle', 'h2'], ['.copy', 'body'], ['body', 'body'], ['html, body', 'body'],
    ['a', 'link'], ['.link', 'link'], ['button', 'button'],
    // Rejected: a title inside a component is that component's, and a role word
    // buried in a longer name is not the role.
    ['.nav-title', ''], ['.card-title', ''], ['.modal-h2', ''], ['.footer-link', ''],
    ['.copy-preview-hl', ''], ['html', ''], [':root', ''],
  ];
  for (const [sel, want] of cases) {
    expect(bx.typeSlot(sel), `typeSlot(${JSON.stringify(sel)})`).toBe(want);
  }
});

test('a scoped selector is weak and loses to a simple one', () => {
  const out = bx.typeScaleCandidates(sheet(`
    h1 { font-size: 48px; }
    .hero .title { font-size: 99px; }
  `));
  const s = bySlot(out);
  expect(s.h1.size, 'a selector scoped inside a component won the slot').toBe('48px');
  expect(s.h1.confidence).toBe('strong');
});

test('a class-styled site is not reported as having no typography', () => {
  // Reading only bare elements returned almost nothing from real class-based
  // CSS, which is most of the web.
  const out = bx.typeScaleCandidates(sheet(`
    .vh-h1 { font-size: 44px; font-weight: 600; letter-spacing: -0.02em; }
    .vh-h2 { font-size: 26px; font-weight: 600; }
  `));
  const s = bySlot(out);
  expect(s.h1.size).toBe('44px');
  expect(s.h1.confidence, 'a class named for its role is evidence of the same kind as the element').toBe('strong');
  expect(s.h2.size).toBe('26px');
});

test('the link row survives without a font-size', () => {
  const out = bx.typeScaleCandidates(sheet('a { color: #0055ff; font-weight: 500; }'));
  const s = bySlot(out);
  expect(s.link, 'the link row was dropped for having no size').toBeTruthy();
  expect(s.link.color).toBe('#0055ff');
  expect(s.link.weight).toBe('500');
  expect(s.link.size).toBe('');
});

test('a var() reference resolves through the site\'s own tokens', () => {
  const out = bx.typeScaleCandidates(sheet(`
    :root { --text-xl: 2rem; }
    h2 { font-size: var(--text-xl); }
  `));
  const s = bySlot(out);
  expect(s.h2.size).toBe('2rem');
  expect(s.h2.px).toBe(32);
});

/* ═══ it holds up on this repo's own production CSS ═══════════════════════ */

test('the real theme.css yields a real scale', () => {
  // Not a fixture written to pass: a large stylesheet with custom properties,
  // clamp() sizes and class-named headings.
  const out = bx.typeScaleCandidates(sheet(fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8')));
  expect(out.scale.length, 'no rows came back from a real stylesheet').toBeGreaterThan(2);
  const s = bySlot(out);
  expect(s.h1, 'no h1 in a stylesheet that defines .vh-h1').toBeTruthy();
  expect(s.h1.size).toMatch(/clamp\(/);
  expect(s.h1.weight).toBe('600');
  expect(out.tokens.size.length, 'the --vh-fs-* scale was not picked up').toBeGreaterThanOrEqual(4);
});

/* ═══ what reaches DESIGN.md ══════════════════════════════════════════════ */

function designFor(css) {
  const ctx = sheet(css);
  const ts = bx.typeScaleCandidates(ctx);
  const typo = bx.typographyCandidates({ html: '', url: 'https://brand.test/', sheets: ctx.sheets });
  return cp.designMdTokens({
    fields: {
      typography: Object.assign({}, typo, {
        slots: ts.slots, scale: ts.scale, tokens: ts.tokens, root_font_size: ts.root_font_size,
      }),
      // A real primary, so the document has a Colors section for the observed
      // text colours to land in. With an empty palette `colors` is null.
      palette: { proposed: { primary: '#D0473E' }, sources: {}, conflicts: [], roles: {} },
      design_tokens: { groups: {} },
    },
  }, { name: 'Test' });
}

test('DESIGN.md carries the scale beside the family', () => {
  const out = designFor(`
    body { font-family: 'Inter', sans-serif; font-size: 16px; line-height: 1.6; color: #1a1a1a; }
    h1 { font-family: 'Fraunces', serif; font-size: 48px; font-weight: 700; letter-spacing: -0.02em; color: #111111; }
  `);
  expect(out.typography.heading.fontFamily).toContain('Fraunces');
  expect(out.typography.heading.fontSize).toBe('48px');
  expect(out.typography.heading.fontWeight).toBe('700');
  expect(out.typography.heading.letterSpacing).toBe('-0.02em');
  expect(out.typography.body.lineHeight).toBe('1.6');

  // Text colour is real, and it is emitted under COLORS, not typography.
  // google-labs-code/design.md defines typography as fontFamily, fontSize,
  // fontWeight, lineHeight, letterSpacing, fontFeature and fontVariation; the
  // official linter rejects a `color` key there. Named `-ink` rather than
  // `-text` because a `*-text` token in this document is the contrast-ADJUSTED
  // form of a brand colour, and these are read as published.
  expect(out.colors['heading-ink']).toBe('#111111');
  expect(out.colors['body-ink']).toBe('#1a1a1a');
  for (const tok of Object.values(out.typography)) {
    expect(Object.keys(tok), 'a key the design.md spec does not define was emitted')
      .not.toContain('color');
  }
  // The marker is for an ABSENT fact. Emitting it beside the fact it asks for
  // is how an operator learns the markers are noise.
  expect((out.markers || []).some((m) => /typography scale/i.test(m)),
    'the scale marker was emitted alongside an observed scale').toBe(false);
});

test('a scale that could only be read from a scoped selector is reported, not emitted', () => {
  const out = designFor(`
    h1 { font-family: 'Fraunces', serif; }
    body { font-family: 'Inter', sans-serif; }
    .hero .title { font-size: 99px; color: #abcdef; }
  `);
  expect(out.typography.heading.fontSize, 'a component-scoped size became a brand token').toBeUndefined();
  const reported = (out.not_observed || []).map((n) => n.token);
  expect(reported).toContain('typography.heading.fontSize');
  // A scoped colour is not emitted either.
  expect(out.colors['heading-ink']).toBeUndefined();
  // And the operator is told the gap exists.
  expect((out.markers || []).some((m) => /typography scale/i.test(m))).toBe(true);
});

test('a site with no published sizes gets the marker, and no invented numbers', () => {
  const out = designFor(`
    h1 { font-family: 'Fraunces', serif; }
    body { font-family: 'Inter', sans-serif; }
  `);
  expect(out.typography.heading.fontFamily).toContain('Fraunces');
  for (const k of ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']) {
    expect(out.typography.heading[k], `${k} was invented for a site that publishes none`).toBeUndefined();
  }
  expect((out.markers || []).some((m) => /typography scale/i.test(m))).toBe(true);
});

test('the module no longer claims the scale cannot be read', () => {
  // A claim about the FILE, and the right tool for it: the question is whether
  // the sentence is still shipped, not what any code does. It told operators a
  // true-sounding thing that was false, and it justified the marker above.
  const src = fs.readFileSync(path.join(ROOT, 'api/_shared/brand-context-pack.js'), 'utf8');
  expect(src).not.toMatch(/cannot be\s*'?\s*\+?\s*'?read reliably from a stylesheet parse/);
  expect(src).not.toMatch(/Only `fontFamily` is emitted\./);
});
