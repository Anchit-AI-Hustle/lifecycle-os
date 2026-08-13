// brand-context-pack — the per-brand context pack, and what it refuses to say.
//
// The pack's whole value is that a reader can trust it, so this tests the
// refusals first: that a colour is never promoted into `primary` by frequency,
// that a page's copy is never paraphrased, that a repository is never called
// this brand's on a name match, and that "we could not look" is never recorded
// as "there is nothing there".
//
// Three fixtures, no network:
//   1. a store whose BRAND colour and CTA colour disagree, with a full token set
//   2. a site that publishes almost NOTHING, which must degrade honestly
//   3. an in-memory store, to drive the queue end to end
//
// Run: npx playwright test tests/brand-context-pack.spec.js
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const pack = require('../api/_shared/brand-context-pack.js');
const bx = require('../api/_shared/brand-extract.js');
const crawl = require('../api/_shared/site-crawl.js');

/* ── fixture plumbing ─────────────────────────────────────────────────────── */

function fixtureFetch(site) {
  return async (url) => {
    const key = url.split('#')[0];
    if (!(key in site)) return { ok: false, status: 404, body: '' };
    const row = site[key];
    return { ok: true, status: 200, body: row.body, url: key, contentType: row.contentType || 'text/html' };
  };
}
const html = (b) => ({ body: b, contentType: 'text/html; charset=utf-8' });
const css = (b) => ({ body: b, contentType: 'text/css' });

/* ── FIXTURE 1: a site that publishes a real design system ───────────────── */

const RICH_CSS = `
:root{
  --brand-primary:#1F5FD0;
  --cta:#00A651;
  --ink:#14181F;
  --page-bg:#FFFFFF;
  --muted:#5B6472;
  --font-head:'Fraunces',Georgia,serif;
  --font-body:'Inter',system-ui,sans-serif;
  --radius-sm:4px;
  --radius-md:10px;
  --radius-lg:20px;
  --space-1:4px;
  --space-2:8px;
  --space-4:16px;
  --shadow-md:0 2px 8px rgba(0,0,0,.12);
  --duration-fast:120ms;
}
html,body{background:var(--page-bg);color:var(--ink);font-family:var(--font-body)}
h1,h2,h3{font-family:var(--font-head)}
.btn,button[type="submit"]{background:var(--cta);color:#fff}
`;

const RICH_HOME = `<!doctype html><html><head>
<title>Northwind Books | Handbound editions</title>
<meta name="theme-color" content="#1F5FD0">
<meta name="description" content="Northwind Books binds every edition by hand in Leeds.">
<meta property="og:site_name" content="Northwind Books">
<link rel="stylesheet" href="/assets/site.css">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Organization',
  name: 'Northwind Books', url: 'https://northwind.example',
  legalName: 'Northwind Books Limited',
  sameAs: ['https://github.com/northwind-books', 'https://instagram.com/northwindbooks'],
})}</script>
</head><body>
<h1>Northwind Books</h1>
<h2>Handbound editions</h2>
<p>Every edition is sewn and cased by hand in our Leeds bindery. We have bound books since 1974.</p>
<a href="/about">About</a> <a href="/collections/winter">Winter</a>
</body></html>`;

const RICH_ABOUT = `<!doctype html><html><head>
<title>About | Northwind Books</title>
<meta name="description" content="A bindery in Leeds, working since 1974.">
<link rel="stylesheet" href="/assets/site.css">
</head><body>
<h1>About the bindery</h1>
<h2>Since 1974</h2>
<p>Northwind Books Limited is registered in England and Wales.</p>
<a href="/">Home</a>
</body></html>`;

const RICH_SITE = {
  'https://northwind.example/': html(RICH_HOME),
  'https://northwind.example/about': html(RICH_ABOUT),
  'https://northwind.example/collections/winter': html('<!doctype html><html><head><title>Winter</title></head><body><h1>Winter</h1><a href="/">Home</a></body></html>'),
  'https://northwind.example/assets/site.css': css(RICH_CSS),
};

/* ── FIXTURE 2: a site that publishes almost nothing ─────────────────────── */

const THIN_SITE = {
  'https://quietco.example/': html('<!doctype html><html><head><title>Quiet Co</title></head>'
    + '<body><h1>Quiet Co</h1><p>Hello.</p><a href="/page-two">More</a></body></html>'),
  'https://quietco.example/page-two': html('<!doctype html><html><head><title>More</title></head>'
    + '<body><h1>More</h1><p>Still hello.</p></body></html>'),
};

const BRAND_RICH = { name: 'Northwind Books', website: 'https://northwind.example' };
const BRAND_THIN = { name: 'Quiet Co', website: 'https://quietco.example' };

async function reportFor(site, brand) {
  return bx.extractBrand(brand.website, {
    brand, voice: false, maxPages: 6, fetchImpl: fixtureFetch(site),
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE KEY — url AND name
   ═══════════════════════════════════════════════════════════════════════════ */

test('the pack is keyed to the URL AND the name, so lookalikes cannot collide', () => {
  const a = pack.packKey('https://acme.example', 'Acme');
  const b = pack.packKey('https://acme-tools.example', 'Acme');
  const c = pack.packKey('https://acme.example', 'Acme Tools');

  // Same name, different site → different pack.
  expect(a.brand_key).not.toBe(b.brand_key);
  // Same site, different brand → different pack.
  expect(a.brand_key).not.toBe(c.brand_key);
  // Both halves are present in the key, so neither alone can merge two brands.
  expect(a.brand_key).toBe('acme.example|acme');
});

test('re-running for the same brand lands on the SAME key, so it updates', () => {
  const first = pack.packKey('https://www.Northwind.example/', 'Northwind Books');
  const again = pack.packKey('http://northwind.example/uk?utm_source=x', 'northwind books ltd.');
  expect(again.brand_key).toBe(first.brand_key);
});

test('a key needs both halves and reports when it does not have them', () => {
  expect(pack.packKey('', 'Acme').ok).toBe(false);
  expect(pack.packKey('https://acme.example', '').ok).toBe(false);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. DESIGN.md — conformance to google-labs-code/design.md
   ═══════════════════════════════════════════════════════════════════════════ */

test('DESIGN.md carries the spec front matter and its sections, each exactly once', async () => {
  const report = await reportFor(RICH_SITE, BRAND_RICH);
  const doc = pack.renderDesignMd(report, BRAND_RICH, { brand_key: 'northwind.example|northwindbooks' });
  const t = doc.markdown;

  // Front matter delimiters, and `name` (the only required key).
  expect(t.startsWith('---\n')).toBe(true);
  expect(t).toMatch(/^version: alpha$/m);
  expect(t).toMatch(/^name: "Northwind Books"$/m);

  // The spec's sections, in the spec's order.
  const headings = [...t.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  expect(headings).toEqual([
    'Overview', 'Colors', 'Typography', 'Layout',
    'Elevation & Depth', 'Shapes', 'Components', "Do's and Don'ts",
  ]);
  // A duplicate heading rejects the whole file under the spec.
  expect(new Set(headings).size).toBe(headings.length);
});

test('every token the mapping produced actually reaches the front matter', async () => {
  // The front matter is the normative half of a DESIGN.md, and a renderer that
  // drops part of it still produces a document that reads as complete. So the
  // emitted YAML is compared against the mapping, key by key, rather than spot
  // checked: a `push` that took one argument instead of rest args once kept
  // only the FIRST line of every token block — `primary` and nothing else, and
  // a `typography.heading` with no properties under it — and every assertion
  // about the mapping still passed.
  const report = await reportFor(RICH_SITE, BRAND_RICH);
  const t = pack.designMdTokens(report, BRAND_RICH);
  const front = pack.renderDesignMd(report, BRAND_RICH, {}).markdown.split('\n---\n')[0];

  for (const [k, v] of Object.entries(t.colors)) {
    expect(front, `colors.${k} is in the mapping but missing from the emitted YAML`).toContain(`${k}: "${v}"`);
  }
  for (const [k, v] of Object.entries(t.typography)) {
    expect(front).toMatch(new RegExp(`^ {2}${k}:`, 'm'));
    expect(front, `typography.${k}.fontFamily was dropped`).toContain(`fontFamily: ${pack.yamlStr(v.fontFamily)}`);
  }
  for (const [k, v] of Object.entries(t.rounded)) expect(front).toContain(`${k}: "${v}"`);
  for (const [k, v] of Object.entries(t.spacing)) expect(front).toContain(`"${k}": "${v}"`);

  // Every omitted section, with its reason, survives too.
  for (const o of t.omitted) {
    expect(front).toContain(`- section: ${o.section}`);
    expect(front).toContain('reason: "');
  }
  // A sanity floor: this fixture publishes a real system, so a near-empty
  // front matter can never be read as "correct, the site had nothing".
  expect(Object.keys(t.colors).length).toBeGreaterThanOrEqual(6);
  expect(front.split('\n').filter((l) => /^ {2}\S/.test(l)).length).toBeGreaterThanOrEqual(10);
});

test('`primary` comes ONLY from an identity signal, never from the most-used colour', async () => {
  const report = await reportFor(RICH_SITE, BRAND_RICH);
  const t = pack.designMdTokens(report, BRAND_RICH);

  // theme-color / --brand-primary says #1F5FD0. The buttons are #00A651.
  expect(t.colors.primary.toLowerCase()).toBe('#1f5fd0');
  // The CTA colour becomes `secondary`, because it genuinely differs...
  expect(t.colors.secondary.toLowerCase()).toBe('#00a651');
  // ...and the disagreement is REPORTED rather than resolved for the brand.
  expect(t.conflicts.length).toBeGreaterThan(0);
  expect(t.conflicts[0].kind).toBe('brand_colour_vs_action_colour');
});

test('a site with no identity colour gets NO colors section, not a guessed one', async () => {
  const report = await reportFor(THIN_SITE, BRAND_THIN);
  const t = pack.designMdTokens(report, BRAND_THIN);

  // The spec requires `primary` when `colors` is present, and nothing here can
  // honestly fill it — so the whole section is declared omitted, with a reason.
  expect(t.colors).toBe(null);
  const omission = t.omitted.find((o) => o.section === 'colors');
  expect(omission).toBeTruthy();
  expect(omission.reason).toMatch(/identity/i);
  expect(t.markers.join(' ')).toContain('[DATA REQUIRED BEFORE LAUNCH: colors.primary');

  const doc = pack.renderDesignMd(report, BRAND_THIN, {});
  // No colour token may appear in the front matter at all.
  const front = doc.markdown.split('\n---\n')[0];
  expect(front).not.toMatch(/^colors:/m);
  expect(front).toMatch(/^omitted:/m);
  expect(front).toMatch(/^ {2}- section: colors$/m);
});

test('text tokens are contrast-adjusted, and the adjustment is stated', async () => {
  // A brand whose colour is light: used raw as text it is unreadable.
  const LIGHT_CSS = RICH_CSS.replace('--brand-primary:#1F5FD0', '--brand-primary:#F2E14C');
  const site = Object.assign({}, RICH_SITE, {
    'https://northwind.example/': html(RICH_HOME.replace('content="#1F5FD0"', 'content="#F2E14C"')),
    'https://northwind.example/assets/site.css': css(LIGHT_CSS),
  });
  const report = await reportFor(site, BRAND_RICH);
  const t = pack.designMdTokens(report, BRAND_RICH);
  const core = require('../api/_shared/brand-workspace-core.js');

  // The FILL keeps the brand's own colour...
  expect(t.colors.primary.toLowerCase()).toBe('#f2e14c');
  // ...and the TEXT token is a readable version of it, not the raw value.
  expect(t.colors['primary-text'].toLowerCase()).not.toBe('#f2e14c');
  expect(core.contrast(t.colors['primary-text'], t.colors.surface)).toBeGreaterThanOrEqual(4.5);
  // Raw yellow on white would have failed, which is the point.
  expect(core.contrast('#F2E14C', '#FFFFFF')).toBeLessThan(4.5);

  // And it is disclosed, with the before/after ratios.
  const adj = t.adjustments.find((a) => a.token === 'primary-text');
  expect(adj).toBeTruthy();
  expect(adj.ratio_after).toBeGreaterThan(adj.ratio_before);
  const doc = pack.renderDesignMd(report, BRAND_RICH, {});
  expect(doc.markdown).toContain('Contrast adjustments, and why');
});

test('radius and spacing scales come from NAMED tokens, and are omitted when absent', async () => {
  const rich = pack.designMdTokens(await reportFor(RICH_SITE, BRAND_RICH), BRAND_RICH);
  expect(rich.rounded).toMatchObject({ sm: '4px', md: '10px', lg: '20px' });
  expect(rich.spacing).toMatchObject({ 1: '4px', 2: '8px', 4: '16px' });

  const thin = pack.designMdTokens(await reportFor(THIN_SITE, BRAND_THIN), BRAND_THIN);
  expect(thin.rounded).toBe(null);
  expect(thin.spacing).toBe(null);
  expect(thin.omitted.map((o) => o.section)).toEqual(expect.arrayContaining(['rounded', 'spacing', 'components']));
});

test('a typography scale is never invented — only fontFamily is emitted', async () => {
  const t = pack.designMdTokens(await reportFor(RICH_SITE, BRAND_RICH), BRAND_RICH);
  expect(t.typography.body.fontFamily).toContain('Inter');
  // No fontSize / lineHeight / letterSpacing, because none can be observed
  // without resolving the cascade.
  for (const tok of Object.values(t.typography)) {
    expect(Object.keys(tok)).toEqual(['fontFamily']);
  }
  expect(t.markers.join(' ')).toContain('typography scale');
});

test('the thin site produces a thin document full of markers, not a plausible one', async () => {
  const report = await reportFor(THIN_SITE, BRAND_THIN);
  const doc = pack.renderDesignMd(report, BRAND_THIN, {});

  expect(doc.markers.length).toBeGreaterThan(3);
  // Nothing was fabricated to fill the gaps.
  expect(doc.markdown).not.toMatch(/#[0-9a-fA-F]{6}/);
  expect(doc.markdown).toContain('[DATA REQUIRED BEFORE LAUNCH:');
  // And the reader is told this is a limit of the METHOD, not a fact about the brand.
  expect(doc.markdown).toMatch(/computed styles/i);
});

test('the no-browser limitation is stated rather than left implied', async () => {
  const report = await reportFor(RICH_SITE, BRAND_RICH);
  const doc = pack.renderDesignMd(report, BRAND_RICH, {});
  expect(doc.markdown).toMatch(/browser-based extractor/i);
  expect(doc.markdown).toMatch(/absent \*{0,2}OBSERVATION/i);
  expect(doc.markdown).toMatch(/not that the brand has none/i);
});

test('YAML values are quoted, so a font stack cannot corrupt the front matter', () => {
  expect(pack.yamlStr("'Fraunces',Georgia,serif")).toBe('"\'Fraunces\',Georgia,serif"');
  expect(pack.yamlStr('he said "hi"')).toBe('"he said \\"hi\\""');
  // Levels a YAML parser would otherwise read as booleans.
  expect(pack.yamlKey('on')).toBe('"on"');
  expect(pack.yamlKey('2xl')).toBe('"2xl"');
  expect(pack.yamlKey('on-surface')).toBe('on-surface');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2b. ONLY THE EXACT CORRECT OPTION
   The product has already shown this user two confidently-wrong things. A
   confidently-wrong colour or typeface is the same class of error, so every
   remaining edge where something plausible could be picked is pinned here.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A site that declares a brand colour but NO action colour, and loads a font
 *  it never uses. Everything here is a near-miss on purpose. */
const NEARMISS_CSS = `
:root{ --brand-primary:#1F5FD0; --ink:#14181F; --page-bg:#FFFFFF; }
html,body{background:var(--page-bg);color:var(--ink)}
/* A saturated colour used all over the page and on NO action selector. It is
   the highest-weighted thing left once identity, surface and ink are taken —
   exactly the colour a frequency ranking hands back as "the accent". */
.badge{background:#E2571F}
.tag{background:#E2571F}
.pill{background:#E2571F}
.callout{background:#E2571F}
.divider{border-color:#E6E8EB}
`;
const NEARMISS_SITE = {
  'https://nearmiss.example/': html(`<!doctype html><html><head>
<title>Nearmiss</title><meta name="theme-color" content="#1F5FD0">
<link rel="stylesheet" href="/s.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400">
</head><body><h1>Nearmiss</h1><p>Hello.</p></body></html>`),
  'https://nearmiss.example/s.css': css(NEARMISS_CSS),
};
const BRAND_NEARMISS = { name: 'Nearmiss', website: 'https://nearmiss.example' };

test('a frequency-ranked colour never becomes `secondary` either', async () => {
  const report = await reportFor(NEARMISS_SITE, BRAND_NEARMISS);
  const t = pack.designMdTokens(report, BRAND_NEARMISS);

  // The site declares a brand colour, so `primary` is filled...
  expect(t.colors.primary.toLowerCase()).toBe('#1f5fd0');
  // ...but it declares no ACTION colour. The extractor's proposal falls back to
  // the highest-weighted leftover, which is correct for a wizard where a human
  // confirms and wrong for a token consumed without one.
  expect(t.colors.secondary).toBeUndefined();
  // It is reported rather than silently dropped.
  const refused = t.not_observed.find((n) => n.token === 'secondary');
  expect(refused).toBeTruthy();
  expect(refused.why).toMatch(/highest-weighted remaining colour/i);
  expect(t.markers.join(' ')).toContain('[DATA REQUIRED BEFORE LAUNCH: colors.secondary');

  // And it never reaches the emitted YAML.
  const front = pack.renderDesignMd(report, BRAND_NEARMISS, {}).markdown.split('\n---\n')[0];
  expect(front).not.toMatch(/^ {2}secondary:/m);
  expect(front).not.toContain('#e2571f');
});

test('a font the page LOADS but is never shown to use is not emitted as a token', async () => {
  const report = await reportFor(NEARMISS_SITE, BRAND_NEARMISS);
  // The extractor does surface the loaded families...
  expect((report.fields.typography.heading || []).length).toBeGreaterThan(0);
  expect(report.fields.typography.heading[0].confidence).toBe('weak');

  // ...and the pack refuses to turn a download into a design decision.
  const t = pack.designMdTokens(report, BRAND_NEARMISS);
  expect(t.typography).toBe(null);
  const refused = t.not_observed.find((n) => n.token === 'typography.heading');
  expect(refused).toBeTruthy();
  expect(refused.why).toMatch(/no CSS rule was found that renders/i);
  const omission = t.omitted.find((o) => o.section === 'typography');
  expect(omission.reason).toMatch(/loads web fonts but publishes no CSS rule/i);

  const front = pack.renderDesignMd(report, BRAND_NEARMISS, {}).markdown.split('\n---\n')[0];
  expect(front).not.toMatch(/^typography:/m);
  expect(front).not.toContain('Playfair');
});

test('a family proven USED is still emitted, so the rule is not just "refuse everything"', async () => {
  const t = pack.designMdTokens(await reportFor(RICH_SITE, BRAND_RICH), BRAND_RICH);
  expect(t.typography.heading.fontFamily).toContain('Fraunces');
  expect(t.typography.body.fontFamily).toContain('Inter');
});

test('every derived value says what it was derived from', async () => {
  const report = await reportFor(RICH_SITE, BRAND_RICH);
  const t = pack.designMdTokens(report, BRAND_RICH);

  // The computed tokens are exactly the ones a reader must not mistake for
  // something the site published.
  const names = t.derived.map((d) => d.token).sort();
  expect(names).toEqual(expect.arrayContaining(['on-primary', 'primary-text']));
  for (const d of t.derived) {
    expect(d.from, `${d.token} does not name its input`).toBeTruthy();
    expect(d.how, `${d.token} does not say how it was computed`).toBeTruthy();
    // The YAML comment beside the value says DERIVED, not a page URL.
    expect(t.sources.colors[d.token]).toMatch(/^DERIVED from /);
  }
  const doc = pack.renderDesignMd(report, BRAND_RICH, {});
  expect(doc.markdown).toContain('### Derived, not observed');
  expect(doc.markdown).toMatch(/not read from the site/);
});

test('the proposal carries the confidence and the role it came from', async () => {
  const rich = await reportFor(RICH_SITE, BRAND_RICH);
  expect(rich.fields.palette.sources.primary.from_role).toBe('identity');
  expect(rich.fields.palette.sources.primary.confidence).toBe('declared');
  expect(rich.fields.palette.sources.primary.ranked_not_declared).toBe(false);
  expect(rich.fields.palette.sources.accent.from_role).toBe('action');

  // The near-miss site's accent is a leftover, and says so — this is the flag
  // the wizard needs to stop showing it as if the site had declared it.
  const near = await reportFor(NEARMISS_SITE, BRAND_NEARMISS);
  expect(near.fields.palette.sources.accent.from_role).toBe('support');
  expect(near.fields.palette.sources.accent.ranked_not_declared).toBe(true);
});

test('the pack records which option each field took, and out of how many', async () => {
  const report = await reportFor(RICH_SITE, BRAND_RICH);
  const t = pack.designMdTokens(report, BRAND_RICH);
  const byField = Object.fromEntries(t.selection.map((s) => [s.field, s]));

  const p = byField['colors.primary'];
  expect(p.value.toLowerCase()).toBe('#1f5fd0');
  expect(p.signal).toBeTruthy();
  expect(p.source_url).toContain('northwind.example');
  expect(p.candidates_considered).toBeGreaterThan(0);
  expect(p.rank_taken).not.toBeNull();
  expect(['top-candidate', 'only-candidate']).toContain(p.chosen_by);
  expect(p.rule).toMatch(/identity signal only/);

  // Derived and refused entries are in the same record, distinguishable.
  expect(t.selection.some((s) => s.derived === true && s.chosen_by === 'computed')).toBe(true);
  expect(byField['typography.heading'].confidence).toBeTruthy();

  const doc = pack.renderDesignMd(report, BRAND_RICH, {});
  expect(doc.markdown).toContain('### Which option was chosen, and why');
});

test('a refused option is recorded as refused, not merely absent', async () => {
  const t = pack.designMdTokens(await reportFor(NEARMISS_SITE, BRAND_NEARMISS), BRAND_NEARMISS);
  const refusals = t.selection.filter((s) => s.chosen_by === 'refused');
  expect(refusals.length).toBeGreaterThanOrEqual(2);
  for (const r of refusals) {
    expect(r.refused_candidate).toBeTruthy();
    expect(r.why).toBeTruthy();
  }
});

test('a page that redirects OFF-ORIGIN is never ingested', async () => {
  // An in-scope URL that answers with another company's page: a retired path
  // 301'd to a partner, a region gate bouncing to a marketplace. Scope was
  // checked on the URL we asked for; this checks the one that answered.
  const impl = async (url) => {
    if (url === 'https://northwind.example/') {
      return { ok: true, status: 200, url,
        body: '<html><body><a href="/partners">Partners</a></body></html>' };
    }
    if (url === 'https://northwind.example/partners') {
      // followed a redirect and landed somewhere else entirely
      return { ok: true, status: 200, url: 'https://competitor.example/their-page',
        body: '<html><head><title>Competitor</title></head><body><h1>Competitor products</h1></body></html>' };
    }
    return { ok: false, status: 404, body: '' };
  };
  const out = await crawl.crawlSite('https://northwind.example/', {
    brand: BRAND_RICH, fetchImpl: impl, maxPages: 5, maxDepth: 2,
  });
  expect(out.pages).toEqual(['https://northwind.example/']);
  expect(out.pages).not.toContain('https://northwind.example/partners');
  expect(out.notes.join(' ')).toMatch(/redirected off-origin/);
  // and nothing from that body was taken
  expect(JSON.stringify(out.offerings)).not.toContain('Competitor');
});

test('an in-origin redirect is still followed', async () => {
  const impl = async (url) => {
    if (url === 'https://northwind.example/') {
      return { ok: true, status: 200, url: 'https://www.northwind.example/en-gb/',
        body: '<html><head><title>Northwind</title></head><body><h1>Northwind</h1></body></html>' };
    }
    return { ok: false, status: 404, body: '' };
  };
  const out = await crawl.crawlSite('https://northwind.example/', {
    brand: BRAND_RICH, fetchImpl: impl, maxPages: 3, maxDepth: 1,
  });
  expect(out.pages.length).toBe(1);
  expect(out.notes.join(' ')).not.toMatch(/redirected off-origin/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. KNOWLEDGE — verbatim, or a marker
   ═══════════════════════════════════════════════════════════════════════════ */

test('a page is stored with its OWN description and headings, verbatim', () => {
  const rec = pack.knowledgeRecord(RICH_HOME, 'https://northwind.example/?utm_source=news');
  expect(rec.row.summary).toBe('Northwind Books binds every edition by hand in Leeds.');
  expect(rec.row.key_points).toEqual(['Northwind Books', 'Handbound editions']);
  expect(rec.declared_description).toBe(true);
  // Tracking params never become part of a page's identity.
  expect(rec.row.url).toBe('https://northwind.example/');
  expect(rec.row.tags).toContain('brand-site');
  // The verbatim body is kept, so nothing downstream has to trust a summary.
  expect(rec.row.raw_text).toContain('sewn and cased by hand');
});

test('a page that declares no description gets a MARKER, never a written summary', () => {
  const rec = pack.knowledgeRecord(THIN_SITE['https://quietco.example/'].body, 'https://quietco.example/');
  expect(rec.declared_description).toBe(false);
  expect(rec.row.summary).toContain('[DATA REQUIRED BEFORE LAUNCH: page description');
  expect(rec.row.status).toBe('fetched');
  // The page's own words are still there; only the paraphrase is missing.
  expect(rec.row.raw_text).toContain('Hello.');
});

test('the url identity matches the KB router\'s, so a page cannot be filed twice', () => {
  const kbUrl = require('../api/_shared/kb-url.js');
  const a = kbUrl.urlHash('https://northwind.example/about?utm_campaign=x');
  const b = kbUrl.urlHash('https://northwind.example/about/');
  expect(a).toBe(b);
  expect(pack.knowledgeRecord('<html></html>', 'https://northwind.example/about/').row.url_hash).toBe(a);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. THE CRAWL IS RESUMABLE, AND STILL SAME-ORIGIN
   ═══════════════════════════════════════════════════════════════════════════ */

test('a resumed batch continues instead of re-fetching the first pages', async () => {
  const fetched = [];
  const impl = async (url) => {
    const key = url.split('#')[0];
    if (!(key in RICH_SITE)) return { ok: false, status: 404, body: '' };
    fetched.push(key);
    return { ok: true, status: 200, body: RICH_SITE[key].body, url: key };
  };

  const first = await crawl.crawlSite('https://northwind.example/', {
    brand: BRAND_RICH, fetchImpl: impl, maxPages: 2, maxDepth: 3,
  });
  expect(first.pages).toContain('https://northwind.example/');
  expect(first.pages.length).toBe(2);

  const seen = new Set(first.pages);
  const alreadyRead = first.pages[1];          // a page batch 1 consumed
  fetched.length = 0;
  const second = await crawl.crawlSite('https://northwind.example/', {
    brand: BRAND_RICH, fetchImpl: impl, maxPages: 4, maxDepth: 3,
    // A real persisted frontier contains pages an earlier batch already read:
    // two pages link to a third, so the third is queued twice and only one of
    // those sightings was consumed. Re-fetching it is the whole failure mode,
    // and it costs the brand's own site a duplicate request every batch
    // forever, so the seed here deliberately carries one.
    frontier: [{ url: alreadyRead, depth: 1 }].concat(first.frontier_remaining),
    skip: (u) => seen.has(u),
  });
  // Asserted on the FETCHES, not on `pages`: a page can be absent from `pages`
  // while the request that proved it was already read still went out.
  expect(fetched).not.toContain(alreadyRead);
  expect(fetched).not.toContain('https://northwind.example/');
  expect(second.pages).not.toContain(alreadyRead);
  // ...and the batch still makes progress on the pages nobody has read yet.
  expect(second.pages.length).toBeGreaterThan(0);
  expect(second.pages.every((p) => !seen.has(p))).toBe(true);
});

test('a frontier cannot smuggle an off-origin URL back into the crawl', async () => {
  const attempted = [];
  const impl = async (url) => {
    attempted.push(url);
    const key = url.split('#')[0];
    if (!(key in RICH_SITE)) return { ok: false, status: 404, body: '' };
    return { ok: true, status: 200, body: RICH_SITE[key].body, url: key };
  };
  const out = await crawl.crawlSite('https://northwind.example/', {
    brand: BRAND_RICH, fetchImpl: impl, maxPages: 5, maxDepth: 2,
    // A stored frontier round-trips through a database; a row in it is not
    // evidence that the URL is still this brand's.
    frontier: [{ url: 'https://competitor.example/steal-me', depth: 1 }],
  });
  // The assertion has to be that the request was never MADE. Checking `pages`
  // only proves the fixture 404'd it — a real competitor host would answer 200
  // and the page would be ingested as this brand's own.
  expect(attempted.join(' ')).not.toContain('competitor.example');
  expect(out.pages.join(' ')).not.toContain('competitor.example');
});

test('omitting the new hooks changes nothing about the existing traversal', async () => {
  const a = await crawl.crawlSite('https://northwind.example/', { brand: BRAND_RICH, fetchImpl: fixtureFetch(RICH_SITE), maxPages: 5, maxDepth: 3 });
  const b = await crawl.crawlSite('https://northwind.example/', { brand: BRAND_RICH, fetchImpl: fixtureFetch(RICH_SITE), maxPages: 5, maxDepth: 3, frontier: [], skip: null });
  expect(b.pages).toEqual(a.pages);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. GITHUB — searched, or honestly not searched
   ═══════════════════════════════════════════════════════════════════════════ */

const ghOk = (items) => async () => ({ ok: true, status: 200, body: JSON.stringify({ items }) });
const ghDead = (status, error) => async () => ({ ok: false, status, body: '', error });

test('a name match is NEVER recorded as the brand\'s repository', async () => {
  const out = await pack.searchGithubRepos(BRAND_RICH, { fields: {} }, {
    fetchImpl: ghOk([
      { full_name: 'someone/rebuilding-northwind-with-tailwind', html_url: 'https://github.com/someone/rebuilding-northwind-with-tailwind', owner: { login: 'someone' } },
      { full_name: 'student/Northwind', html_url: 'https://github.com/student/Northwind', owner: { login: 'student' } },
    ]),
  });
  expect(out.searched).toBe(true);
  expect(out.verified).toEqual([]);
  expect(out.unverified.length).toBe(2);
  for (const c of out.unverified) {
    expect(c.verification).toBe('unverified');
    expect(c.basis).toBe('name-match');
  }
  expect(out.note).toMatch(/name match/i);
  expect(out.markers.join(' ')).toContain('official GitHub repository');
});

test('a repository is verified only by evidence independent of its name', async () => {
  // The brand's own site links to github.com/northwind-books.
  const report = { fields: { social: { candidates: [{ platform: 'github', value: 'https://github.com/northwind-books', source_url: 'https://northwind.example/' }] } } };
  const out = await pack.searchGithubRepos(BRAND_RICH, report, {
    fetchImpl: ghOk([
      { full_name: 'northwind-books/press-kit', html_url: 'https://github.com/northwind-books/press-kit', owner: { login: 'northwind-books' } },
      { full_name: 'unrelated/northwind', html_url: 'https://github.com/unrelated/northwind', owner: { login: 'unrelated' }, homepage: 'https://example.org' },
      { full_name: 'contractor/nw-site', html_url: 'https://github.com/contractor/nw-site', owner: { login: 'contractor' }, homepage: 'https://northwind.example/' },
    ]),
  });
  expect(out.verified.map((r) => r.full_name).sort()).toEqual(['contractor/nw-site', 'northwind-books/press-kit']);
  expect(out.verified.find((r) => r.full_name === 'northwind-books/press-kit').basis).toBe('declared-owner');
  expect(out.verified.find((r) => r.full_name === 'contractor/nw-site').basis).toBe('homepage-match');
  expect(out.unverified.map((r) => r.full_name)).toEqual(['unrelated/northwind']);
});

test('an unreachable GitHub is recorded as UNSEARCHED, never as "none found"', async () => {
  const out = await pack.searchGithubRepos(BRAND_RICH, { fields: {} }, {
    fetchImpl: ghDead(403, 'blocked by egress policy'),
  });
  expect(out.searched).toBe(false);
  expect(out.reachable).toBe(false);
  expect(out.candidates).toEqual([]);
  expect(out.note).toContain('NOT SEARCHED');
  expect(out.note).toMatch(/not a finding that none exist/i);
  expect(out.markers.join(' ')).toContain('search unreachable');
  // The specific reason survives, so an operator can act on it.
  expect(out.failures[0].reason).toMatch(/403/);
});

test('a published DESIGN.md is separated into the brand\'s own vs a third party\'s', async () => {
  const impl = async (url) => (
    /northwind-books\/press-kit/.test(url) || /brands-design-md/.test(url)
      ? { ok: true, status: 200, body: '---\nname: "Northwind Books"\n---\n## Overview\n' }
      : { ok: true, status: 404, body: '' }
  );
  const out = await pack.findPublishedDesignMd(
    BRAND_RICH,
    [{ full_name: 'northwind-books/press-kit', default_branch: 'main' }],
    { fetchImpl: impl },
  );
  expect(out.own_repo.length).toBe(1);
  expect(out.own_repo[0].note).toMatch(/Prefer this/i);
  expect(out.third_party.length).toBeGreaterThan(0);
  // A community library's file is someone ELSE's reading of the brand.
  expect(out.third_party[0].note).toMatch(/THIRD PARTY/);
  expect(out.third_party[0].note).toMatch(/not treated as brand truth/i);
});

test('an unreachable raw.githubusercontent is not read as "no published DESIGN.md"', async () => {
  const out = await pack.findPublishedDesignMd(BRAND_RICH, [], { fetchImpl: ghDead(403, 'blocked') });
  expect(out.searched).toBe(false);
  expect(out.found).toEqual([]);
  expect(out.note).toContain('NOT SEARCHED');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. USER DATA WINS
   ═══════════════════════════════════════════════════════════════════════════ */

test('a save claims exactly the fields the operator actually sent', () => {
  const core = require('../api/_shared/brand-workspace-core.js');
  const claimed = core.claimedFields({
    name: 'Northwind Books',
    tagline: '',                                   // empty: not a claim
    palette: { primary: '#1F5FD0', accent: '' },   // only the one they set
    typography: { body: { family: 'Inter' } },
    voice: { tone: 'plain', banned: [] },          // empty list: not a claim
    regions: [{ code: 'UK' }],
  });
  expect(claimed).toEqual(['name', 'palette.primary', 'typography.body', 'voice.tone', 'regions']);
  expect(claimed).not.toContain('tagline');
  expect(claimed).not.toContain('palette.accent');
  expect(claimed).not.toContain('voice.banned');
});

test('the precedence rule lives in the DATABASE, not in call order', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260814100000_brand_context_packs.sql'), 'utf8');

  // One door for automatic values...
  expect(sql).toMatch(/create or replace function public\.brand_context_apply/);
  // ...which runs as definer and checks the caller's role itself...
  expect(sql).toMatch(/brand_context_apply[\s\S]*?security definer/);
  expect(sql).toMatch(/brand_context_apply[\s\S]*?is_brand_editor\(p_workspace, auth\.uid\(\)\)/);
  // ...and refuses a field a person owns, inside the function.
  expect(sql).toMatch(/if owner_origin = 'user' then[\s\S]{0,120}?skipped := skipped \|\| k;[\s\S]{0,40}?continue;/);
  // The user-claim side exists too, or nothing would ever be marked as owned.
  expect(sql).toMatch(/create or replace function public\.brand_fields_claim_user/);
  // voice.banned can never be machine-filled.
  expect(sql).toMatch(/voice\.banned is deliberately NOT applicable/);
  expect(sql).toMatch(/leaf not in \('tone', 'preferred', 'notes'\)/);
});

test('the pack table is keyed on workspace + brand_key, and is not world-readable', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260814100000_brand_context_packs.sql'), 'utf8');
  expect(sql).toMatch(/brand_key\s+text generated always as \(site_host \|\| '\|' \|\| folded_name\) stored/);
  expect(sql).toMatch(/unique \(workspace_id, brand_key\)/);
  expect(sql).toMatch(/alter table public\.brand_context_packs enable row level security/);
  expect(sql).toMatch(/brand_context_packs_read[\s\S]*?is_brand_member/);
  expect(sql).toMatch(/brand_context_packs_write[\s\S]*?is_brand_editor/);
  expect(sql).not.toMatch(/using \(true\)/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. THE QUEUE — one step per call, resumable, convergent
   ═══════════════════════════════════════════════════════════════════════════ */

/** An in-memory stand-in for the PostgREST calls the pack makes. */
function fakeStore({ brand, provenance = {} , site = RICH_SITE }) {
  const packs = [];
  const kb = [];
  const applied = [];
  const call = async (q, opts) => {
    const o = opts || {};
    if (q.startsWith('brand_workspaces?')) return [brand];
    if (q.startsWith('brand_field_provenance?')) {
      return Object.entries(provenance).map(([field, origin]) => ({ field, origin }));
    }
    if (q.startsWith('kb_knowledge?')) { kb.push(...o.body); return null; }
    if (q.startsWith('rpc/brand_context_apply')) {
      const out = { applied: [], skipped_user_owned: [] };
      for (const k of Object.keys(o.body.p_fields || {})) {
        (provenance[k] === 'user' ? out.skipped_user_owned : out.applied).push(k);
      }
      applied.push(out);
      return out;
    }
    if (q.startsWith('brand_context_packs?')) {
      if (o.method === 'POST') {
        const row = Object.assign({ id: 'pack-1' }, o.body[0]);
        const i = packs.findIndex((p) => p.brand_key === row.brand_key);
        const key = pack.packKey(row.site_url, row.brand_name);
        row.brand_key = key.brand_key;
        if (i >= 0) { packs[i] = Object.assign(packs[i], row); return [packs[i]]; }
        packs.push(row); return [row];
      }
      if (o.method === 'PATCH') {
        const id = /id=eq\.([^&]+)/.exec(q)[1];
        const row = packs.find((p) => p.id === id);
        Object.assign(row, o.body);
        return [row];
      }
      const key = (/brand_key=eq\.([^&]+)/.exec(q) || [])[1];
      const found = key ? packs.filter((p) => p.brand_key === decodeURIComponent(key)) : packs;
      return found.slice(0, 1);
    }
    return null;
  };
  return { kind: 'fake', call, _packs: packs, _kb: kb, _applied: applied, _site: site };
}

test('the queue advances one stage per call and converges on done', async () => {
  const store = fakeStore({ brand: BRAND_RICH });
  const ctx = { fetchImpl: fixtureFetch(RICH_SITE), githubFetch: ghDead(403, 'no egress'), voice: false, knowledgePagesPerBatch: 2 };

  // No operator token: the catalogue stage declines rather than half-importing.
  let step = await pack.startPack(store, 'ws-1', { brand: BRAND_RICH, ctx });
  expect(step.pack.catalog.ran).toBe(false);
  expect(step.pack.catalog.skipped).toBe('no_operator_token');
  expect(step.stage).toBe('extract');

  const seen = new Set(['catalog']);
  let guard = 0;
  while (!step.done && guard++ < 25) {
    seen.add(step.stage);
    step = await pack.advancePack(store, step.pack, Object.assign({ brand: BRAND_RICH }, ctx));
  }
  expect(step.done).toBe(true);
  expect(step.remaining).toBe(0);
  expect(guard).toBeLessThan(25);                       // it converges, it does not spin
  expect([...seen]).toEqual(expect.arrayContaining(['catalog', 'extract', 'knowledge', 'repos']));

  const final = step.pack;
  expect(final.status).toBe('complete');
  expect(final.design_md).toContain('## Overview');
  expect(final.knowledge.ingested).toBeGreaterThan(0);
  expect(final.repos.searched).toBe(false);             // honest, not empty
  expect(store._kb.every((r) => r.workspace_id === 'ws-1')).toBe(true);
});

test('the knowledge stage stays on its own stage until its frontier drains', async () => {
  const store = fakeStore({ brand: BRAND_RICH });
  const ctx = { fetchImpl: fixtureFetch(RICH_SITE), githubFetch: ghDead(0, 'x'), voice: false, knowledgePagesPerBatch: 1 };
  let step = await pack.startPack(store, 'ws-1', { brand: BRAND_RICH, ctx });
  step = await pack.advancePack(store, step.pack, Object.assign({ brand: BRAND_RICH }, ctx));  // extract
  expect(step.stage).toBe('knowledge');

  const first = await pack.advancePack(store, step.pack, Object.assign({ brand: BRAND_RICH }, ctx));
  expect(first.stage).toBe('knowledge');                          // still here: more to do
  expect(first.pack.knowledge.ingested).toBe(1);
  expect(first.pack.queue_state.knowledge.frontier.length).toBeGreaterThan(0);

  const second = await pack.advancePack(store, first.pack, Object.assign({ brand: BRAND_RICH }, ctx));
  expect(second.pack.knowledge.ingested).toBe(2);                 // resumed, not restarted
  expect(second.pack.knowledge.pages.map((p) => p.url)).toEqual([...new Set(second.pack.knowledge.pages.map((p) => p.url))]);
});

test('a catalogue the user supplied is never replaced by an automatic run', async () => {
  const store = fakeStore({ brand: BRAND_RICH, provenance: { catalog: 'user' } });
  const step = await pack.startPack(store, 'ws-1', {
    brand: BRAND_RICH,
    auth: { token: 'tok', user_id: 'u1' },   // a real operator token, so the only
    ctx: { fetchImpl: fixtureFetch(RICH_SITE), voice: false },   // reason to skip is ownership
  });
  expect(step.pack.catalog.ran).toBe(false);
  expect(step.pack.catalog.skipped).toBe('user_owned');
  expect(step.pack.catalog.note).toMatch(/supplied by a person/i);
});

test('applying a pack skips the fields a person owns', async () => {
  const store = fakeStore({ brand: BRAND_RICH, provenance: { 'palette.primary': 'user', tagline: 'auto' } });
  const out = await pack.applyPack(store, 'ws-1', {
    'palette.primary': '#000000',
    tagline: 'Handbound editions',
  }, {});
  expect(out.skipped_user_owned).toEqual(['palette.primary']);
  expect(out.applied).toEqual(['tagline']);
});

test('a stale pack is reported as stale rather than served as current', async () => {
  const store = fakeStore({ brand: BRAND_RICH });
  await pack.startPack(store, 'ws-1', { brand: BRAND_RICH, ctx: { fetchImpl: fixtureFetch(RICH_SITE), voice: false } });
  // The brand later moves house.
  const moved = { name: 'Northwind Books', website: 'https://northwind.co.example' };
  const store2 = fakeStore({ brand: moved });
  store2._packs.push(Object.assign({}, store._packs[0]));
  const ctx = await pack.contextFor(store2, 'ws-1');
  expect(ctx.current).toBe(false);
  expect(ctx.stale_note).toMatch(/different site or name/);
  expect(ctx.stale_note).toMatch(/kept, not overwritten/);
});

test('the prompt block tells a model what it must NOT conclude', async () => {
  const store = fakeStore({ brand: BRAND_RICH });
  let step = await pack.startPack(store, 'ws-1', { brand: BRAND_RICH, ctx: { fetchImpl: fixtureFetch(RICH_SITE), githubFetch: ghDead(403, 'x'), voice: false } });
  let guard = 0;
  while (!step.done && guard++ < 25) step = await pack.advancePack(store, step.pack, { brand: BRAND_RICH, fetchImpl: fixtureFetch(RICH_SITE), githubFetch: ghDead(403, 'x'), voice: false });
  const ctx = await pack.contextFor(store, 'ws-1');
  const block = pack.contextBlock(ctx);
  expect(block).toContain('NOT SEARCHED');
  expect(block).toMatch(/do not state that this brand has no public code/i);
  expect(block).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
});
