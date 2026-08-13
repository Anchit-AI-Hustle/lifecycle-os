// brand-extract — what a brand's own site says about it, and what it does NOT.
//
// The value of this module is its refusals, so that is what is tested. Three
// fixture sites, no network:
//
//   1. a Shopify-ish store whose BRAND colour and whose CTA colour DISAGREE —
//      the one trap every naive extractor falls into;
//   2. a JSON-LD-rich publisher that declares everything properly;
//   3. a site with almost no structured data, which must come back nearly
//      EMPTY with markers rather than plausibly full.
//
// Run: npx playwright test tests/brand-extract.spec.js
const { test, expect } = require('@playwright/test');
const bx = require('../api/_shared/brand-extract.js');
const crawl = require('../api/_shared/site-crawl.js');

/* ── fixture plumbing ─────────────────────────────────────────────────────── */

/** url -> { body, contentType }. Anything not listed is a 404. */
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
const json = (b) => ({ body: JSON.stringify(b), contentType: 'application/manifest+json' });

/** No provider is reachable in a test, and that must be a reported gap. */
const noLlm = async () => { throw new Error('no provider configured in tests'); };

/* ── FIXTURE 1: the brand-colour vs CTA-colour trap ───────────────────────── */

const STORE_CSS = `
:root{
  --brand-primary:#1F5FD0;
  --primary:var(--brand-primary);
  --cta:#00A651;
  --ink:#14181F;
  --page-bg:#FFFFFF;
  --font-head:'Fraunces',Georgia,serif;
  --font-body:'Inter',system-ui,sans-serif;
}
html,body{background:var(--page-bg);color:var(--ink);font-family:var(--font-body)}
h1,h2,h3{font-family:var(--font-head)}
.btn,button[type="submit"]{background:var(--cta);color:#fff}
.divider{border-color:#E6E8EB}
.divider-2{border-color:#E6E8EB}
.divider-3{border-color:#E6E8EB}
.badge{background:oklch(0.7 0.15 145)}
@media (prefers-color-scheme: dark){body{background:#10131A}}
`;

const STORE_HOME = `<!doctype html><html><head>
<title>Northwind Books | Handbound editions</title>
<meta name="theme-color" content="#1F5FD0">
<meta property="og:site_name" content="Northwind Books">
<meta property="og:description" content="Handbound editions, made in Leeds.">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/theme.css">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@500;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<link rel="alternate" hreflang="en-GB" href="https://northwind.example/">
<link rel="alternate" hreflang="en-US" href="https://northwind.example/en-us">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Organization',
  name: 'Northwind Books', legalName: 'Northwind Books Trading Ltd',
  slogan: 'Books that outlive us',
  logo: 'https://northwind.example/logo.svg',
  sameAs: ['https://instagram.com/northwindbooks', 'https://www.linkedin.com/company/northwind'],
  address: { '@type': 'PostalAddress', streetAddress: '4 Kirkgate', addressLocality: 'Leeds', postalCode: 'LS1 6BY', addressCountry: 'GB' },
})}</script>
</head><body>
<header><img class="site-logo" src="https://cdn.shopify.com/s/files/northwind/logo.png" alt="Northwind Books logo"></header>
<h1>Books that outlive us</h1>
<p>We hand bind every edition in Leeds, in runs of two hundred, using paper we buy a year ahead.</p>
<ul class="trust-bar"><li>Free shipping over 40 pounds</li><li>30 day returns</li><li>Made in England</li></ul>
<a href="https://facebook.com/sharer/sharer.php?u=https://northwind.example/">Share on Facebook</a>
<a href="/about">About</a><a href="/policies/terms-of-service">Terms</a>
<footer><a href="https://instagram.com/northwindbooks">Instagram</a><p>&copy; 2026 Northwind Books Trading Ltd. All rights reserved.</p></footer>
</body></html>`;

const STORE = {
  'https://northwind.example/': html(STORE_HOME),
  'https://northwind.example/theme.css': css(STORE_CSS),
  'https://northwind.example/manifest.webmanifest': json({
    name: 'Northwind Books', short_name: 'Northwind', theme_color: '#1F5FD0',
    background_color: '#ffffff', icons: [{ src: '/icon-192.png', sizes: '192x192' }, { src: '/icon-512.png', sizes: '512x512' }],
  }),
  'https://northwind.example/about': html('<!doctype html><html><head><title>About | Northwind</title></head><body><h1>About</h1><p>Northwind Books was started in 2014 above a chip shop, with one press and a lot of optimism.</p></body></html>'),
  'https://northwind.example/policies/terms-of-service': html('<!doctype html><html><head><title>Terms</title></head><body><p>These terms are issued by Northwind Books Trading Ltd.</p></body></html>'),
};

const runStore = () => bx.extractBrand('https://northwind.example/', {
  brand: { website: 'https://northwind.example' }, fetchImpl: fixtureFetch(STORE), llm: noLlm,
});

/* ── FIXTURE 3: a site that declares almost nothing ───────────────────────── */

const BARE = {
  'https://plainshop.example/': html(`<!doctype html><html><head>
    <title>plainshop.example</title>
    <style>body{font-family:Arial,sans-serif;background:#fff;color:#333}
    .a{border-color:#ddd}.b{border-color:#ddd}.c{border-color:#ccc}</style>
    </head><body><h1>Welcome</h1><p>We sell things. Have a look around and get in touch.</p>
    <a href="/page2">More</a></body></html>`),
  'https://plainshop.example/page2': html('<!doctype html><html><head><title>More</title></head><body><p>More things.</p></body></html>'),
};

const runBare = () => bx.extractBrand('https://plainshop.example/', {
  brand: { website: 'https://plainshop.example' }, fetchImpl: fixtureFetch(BARE), llm: noLlm,
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE TRAP: brand colour is not the design system's action colour
   ═══════════════════════════════════════════════════════════════════════════ */

test('the declared BRAND colour and the CTA colour are never pooled', async () => {
  const r = await runStore();
  const p = r.fields.palette;

  // The brand colour comes from an identity-level declaration.
  expect(p.proposed.primary).toBe('#1f5fd0');
  expect(p.sources.primary.signal).toMatch(/theme-color|brand/);

  // The green the buttons are painted is present, and is NOT the primary.
  const actionValues = (p.roles.action || []).map((c) => c.value);
  expect(actionValues).toContain('#00a651');
  expect(p.proposed.primary).not.toBe('#00a651');
});

test('the disagreement is REPORTED, with both values and both sources', async () => {
  const r = await runStore();
  const c = (r.fields.palette.conflicts || []).find((x) => x.kind === 'brand_colour_vs_action_colour');
  expect(c).toBeTruthy();
  expect(c.identity.value).toBe('#1f5fd0');
  expect(c.action.value).toBe('#00a651');
  expect(c.identity.source_url).toBeTruthy();
  expect(c.action.source_url).toBeTruthy();
});

test('with NO identity signal the primary is left EMPTY, not filled from frequency', async () => {
  // Same site with every identity declaration removed. A frequency-ranked
  // extractor would hand back the button green as the brand colour.
  const stripped = Object.assign({}, STORE, {
    'https://northwind.example/': html(STORE_HOME
      .replace('<meta name="theme-color" content="#1F5FD0">', '')
      .replace('<link rel="manifest" href="/manifest.webmanifest">', '')),
    'https://northwind.example/theme.css': css(STORE_CSS.replace(/--brand-primary:#1F5FD0;/, '').replace(/var\(--brand-primary\)/, '#1F5FD0')),
  });
  const r = await bx.extractBrand('https://northwind.example/', {
    brand: { website: 'https://northwind.example' }, fetchImpl: fixtureFetch(stripped), llm: noLlm,
  });
  expect(r.fields.palette.proposed.primary).toBe('');
  expect(r.fields.palette.markers.join(' ')).toContain('[DATA REQUIRED BEFORE LAUNCH: palette.primary');
  expect(r.fields.palette.notes.join(' ')).toMatch(/identity-level colour signal/i);
  // The green is still offered — as a candidate, with its evidence.
  expect((r.fields.palette.roles.action || []).map((c) => c.value)).toContain('#00a651');
});

test('the CTA colour can OUTWEIGH the brand colour and still not become the primary', async () => {
  // The realistic shape of the trap, and the one a frequency ranker gets
  // wrong every time: the brand declares itself once, in a single custom
  // property, while the design system paints its green on twenty rules. By
  // weight the green wins outright. It is still not the brand colour.
  const loudCta = [':root{--brand-primary:#1F5FD0;--ink:#14181F;--page-bg:#FFFFFF}',
    'html,body{background:var(--page-bg);color:var(--ink)}']
    .concat(Array.from({ length: 20 }, (_, i) => `.btn-${i}{background:#00A651}`)).join('\n');
  const site = Object.assign({}, STORE, {
    'https://northwind.example/': html(STORE_HOME
      .replace('<meta name="theme-color" content="#1F5FD0">', '')
      .replace('<link rel="manifest" href="/manifest.webmanifest">', '')),
    'https://northwind.example/theme.css': css(loudCta),
  });
  const r = await bx.extractBrand('https://northwind.example/', {
    brand: { website: 'https://northwind.example' }, fetchImpl: fixtureFetch(site), llm: noLlm,
  });
  const identity = r.fields.palette.roles.identity || [];
  const action = r.fields.palette.roles.action || [];
  expect(identity.map((c) => c.value)).toContain('#1f5fd0');
  expect(action.map((c) => c.value)).toContain('#00a651');
  // The green scores higher, and the blue is still the proposed primary.
  expect(action[0].score).toBeGreaterThan(identity[0].score);
  expect(r.fields.palette.proposed.primary).toBe('#1f5fd0');
  expect(r.fields.palette.conflicts.map((c) => c.kind)).toContain('brand_colour_vs_action_colour');
});

test('a border colour repeated on many rules never outranks the brand colour', async () => {
  const r = await runStore();
  const support = (r.fields.palette.roles.support || []).map((c) => c.value);
  expect(support).toContain('#e6e8eb');                    // it is reported
  expect(r.fields.palette.proposed.primary).not.toBe('#e6e8eb');
  expect(r.fields.palette.proposed.accent).not.toBe('#e6e8eb');
});

/* ═══════════════════════════════════════════════════════════════════════════
   COLOUR PARSING
   ═══════════════════════════════════════════════════════════════════════════ */

test('every colour syntax a 2026 stylesheet uses is normalised to one hex', () => {
  expect(bx.parseColor('#1F5FD0')).toBe('#1f5fd0');
  expect(bx.parseColor('#abc')).toBe('#aabbcc');
  expect(bx.parseColor('#1f5fd0ff')).toBe('#1f5fd0');
  expect(bx.parseColor('rgb(31, 95, 208)')).toBe('#1f5fd0');
  expect(bx.parseColor('rgba(31 95 208 / 40%)')).toBe('#1f5fd0');
  expect(bx.parseColor('hsl(0, 100%, 50%)')).toBe('#ff0000');
  expect(bx.parseColor('white')).toBe('#ffffff');
  // oklch matters: Tailwind v4 ships whole palettes in it, and a parser
  // without it reports "declares no colours" about sites that declare nothing else.
  expect(bx.parseColor('oklch(0 0 0)')).toBe('#000000');
  expect(bx.parseColor('oklch(1 0 0)')).toBe('#ffffff');
  expect(bx.parseColor('oklch(0.7 0.15 145)')).toMatch(/^#[0-9a-f]{6}$/);
});

test('a colour syntax we cannot resolve is REPORTED, not silently dropped', async () => {
  const site = Object.assign({}, STORE, {
    'https://northwind.example/theme.css': css(STORE_CSS + '\n.x{color:lab(50% 40 59.5)}\n.y{background:color-mix(in srgb, red, blue)}'),
  });
  const r = await bx.extractBrand('https://northwind.example/', {
    brand: { website: 'https://northwind.example' }, fetchImpl: fixtureFetch(site), llm: noLlm,
  });
  const limits = r.limits.join(' ');
  expect(limits).toMatch(/lab\(\)/);
  expect(limits).toMatch(/color-mix\(\)/);
  expect(limits).toMatch(/NOT guessed at/);
});

test('a nonsense colour value yields nothing rather than a default', () => {
  for (const junk of ['', 'currentColor', 'transparent', 'var(--nope)', 'inherit', 'url(x.png)', 'not-a-colour']) {
    expect(bx.parseColor(junk)).toBe('');
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   CSS PARSING
   ═══════════════════════════════════════════════════════════════════════════ */

test('declarations keep the selector they were written on', () => {
  const rules = bx.cssRulesets('.btn{background:#0a0}.divider{border-color:#0a0}');
  expect(rules).toHaveLength(2);
  expect(bx.selectorRole('.btn')).toBe('action');
  expect(bx.selectorRole('.divider')).toBe('other');
});

test('a url() containing a semicolon does not split a declaration in half', () => {
  const rules = bx.cssRulesets('.a{background:url(data:image/png;base64,AAAA) no-repeat;color:#123456}');
  const props = rules[0].decls.map((d) => d.prop);
  expect(props).toContain('color');
  expect(rules[0].decls.find((d) => d.prop === 'color').value).toBe('#123456');
});

test('colours inside @media and @layer are read, colours inside @keyframes are not', () => {
  const rules = bx.cssRulesets(`
    @media (min-width:900px){ .btn{background:#111aaa} }
    @layer base { body{color:#222bbb} }
    @keyframes pulse { 0%{background:#ff0000} 100%{background:#00ff00} }
  `);
  const flat = JSON.stringify(rules);
  expect(flat).toContain('#111aaa');
  expect(flat).toContain('#222bbb');
  expect(flat).not.toContain('#ff0000');
});

test('custom properties resolve through var() chains', () => {
  const rules = bx.cssRulesets(':root{--base:#1F5FD0;--primary:var(--base);--btn:var(--primary)}');
  const { values } = bx.customProperties(rules);
  expect(values.get('--btn')).toBe('#1F5FD0');
});

test('a token NAME saying brand is a different signal from one saying primary', () => {
  expect(bx.tokenNameRole('--brand-primary')).toBe('identity');
  expect(bx.tokenNameRole('--color-brand')).toBe('identity');
  expect(bx.tokenNameRole('--primary')).toBe('action');
  expect(bx.tokenNameRole('--accent')).toBe('action');
  expect(bx.tokenNameRole('--page-bg')).toBe('surface');
  expect(bx.tokenNameRole('--ink')).toBe('ink');
  expect(bx.tokenNameRole('--spacing-4')).toBe('');
});

/* ═══════════════════════════════════════════════════════════════════════════
   IDENTITY FIELDS
   ═══════════════════════════════════════════════════════════════════════════ */

test('name, tagline and logo come from declared sources and carry them', async () => {
  const r = await runStore();
  expect(r.fields.name.value).toBe('Northwind Books');
  expect(r.fields.name.confidence).toBe('declared');
  expect(r.fields.name.source_url).toBe('https://northwind.example/');

  expect(r.fields.tagline.value).toBe('Books that outlive us');
  expect(r.fields.tagline.signal).toBe('json-ld:Organization.slogan');

  expect(r.fields.logo.value).toBe('https://northwind.example/logo.svg');
  expect(r.fields.logo.candidates.length).toBeGreaterThan(1);
  for (const c of r.fields.logo.candidates) expect(c.signal).toBeTruthy();
});

test('a subpage title is not offered as a brand-name candidate', async () => {
  const r = await runStore();
  expect(r.fields.name.candidates.map((c) => c.value)).not.toContain('About');
});

test('an ambiguous <title> offers BOTH halves rather than guessing one', () => {
  const page = '<html><head><title>Acme | Handmade boots</title></head><body></body></html>';
  const out = bx.nameCandidates({ html: page, url: 'https://acme.example/', meta: {}, ld: [], manifest: null, isHome: true });
  const vals = out.map((c) => c.value);
  expect(vals).toContain('Acme');
  expect(vals).toContain('Handmade boots');
});

test('a logo on an undeclared CDN is kept but FLAGGED, never silently adopted', async () => {
  const r = await runStore();
  const cdn = r.fields.logo.candidates.find((c) => c.value.includes('cdn.shopify.com'));
  expect(cdn).toBeTruthy();
  expect(cdn.off_origin).toBe(true);
  expect(cdn.host).toBe('cdn.shopify.com');
});

test('an inline <svg> logo is reported as having no URL, not given one', () => {
  const page = '<html><body><header><a class="logo"><svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg></a></header></body></html>';
  const out = bx.inlineSvgLogo(page, 'https://acme.example/');
  expect(out).toBeTruthy();
  expect(out.markup).toContain('<svg');
  expect(out.note).toMatch(/will not mint a URL/i);
  expect(out.url).toBeUndefined();
});

/* ═══════════════════════════════════════════════════════════════════════════
   TYPOGRAPHY
   ═══════════════════════════════════════════════════════════════════════════ */

test('heading and body families are told apart by the selectors they sit on', async () => {
  const r = await runStore();
  expect(r.fields.typography.heading[0].value).toBe('Fraunces');
  expect(r.fields.typography.body[0].value).toBe('Inter');
  expect(r.fields.typography.heading[0].source_url).toContain('theme.css');
});

test('a Google Fonts href is PARSED for family and weights, never fetched', async () => {
  const r = await runStore();
  const link = r.fields.typography.google_font_links[0];
  expect(link.families.map((f) => f.family)).toEqual(['Fraunces', 'Inter']);
  expect(link.families[0].weights).toBe('500;700');
  // fonts.googleapis.com is not one of the brand's hosts, so it must appear as
  // a skipped asset rather than as a fetch.
  expect(r.stylesheets.join(' ')).not.toContain('fonts.googleapis.com');
});

test('generic families are never reported as the brand typeface', () => {
  expect(bx.primaryFamily('system-ui,-apple-system,sans-serif')).toBe('');
  expect(bx.primaryFamily("'Instrument Sans',Helvetica,sans-serif")).toBe('Instrument Sans');
});

/* ═══════════════════════════════════════════════════════════════════════════
   CLAIMS, SOCIAL, LEGAL, REGIONS
   ═══════════════════════════════════════════════════════════════════════════ */

test('claims are VERBATIM sentences, unapproved, with their page', async () => {
  const r = await runStore();
  const vals = r.fields.claims.candidates.map((c) => c.value);
  expect(vals).toContain('Free shipping over 40 pounds');
  expect(vals).toContain('30 day returns');
  for (const c of r.fields.claims.candidates) {
    expect(c.approved).toBe(false);
    expect(c.verbatim).toBe(true);
    expect(c.source_url).toBeTruthy();
  }
  expect(r.fields.claims.note).toMatch(/not approved claims/i);
});

test('a trust bar is not glued into one run-on pseudo-sentence', async () => {
  // The naive version strips the whole document and splits on full stops, so a
  // three-item trust bar with no punctuation becomes one 130-character
  // "claim" nobody wrote. Quoting that is worse than quoting nothing.
  const r = await runStore();
  for (const c of r.fields.claims.candidates) {
    expect(c.value.length).toBeLessThan(80);
    expect(c.value).not.toMatch(/Terms|Instagram|Share/);
  }
});

test('a share button is not a social profile', async () => {
  const r = await runStore();
  const vals = r.fields.social.candidates.map((c) => c.value);
  expect(vals.join(' ')).not.toMatch(/sharer/);
  expect(vals).toContain('https://instagram.com/northwindbooks');
  expect(r.fields.social.candidates.find((c) => c.platform === 'linkedin')).toBeTruthy();
});

test('the legal entity is quoted, and the policy pages are listed', async () => {
  const r = await runStore();
  expect(r.fields.legal.candidates[0].value).toBe('Northwind Books Trading Ltd');
  expect(r.fields.legal.candidates[0].signal).toBe('json-ld:Organization.legalName');
  expect(r.fields.legal.documents.map((d) => d.url)).toContain('https://northwind.example/policies/terms-of-service');
});

test('hreflang gives a region but never a currency', async () => {
  const r = await runStore();
  const codes = r.fields.regions.candidates.map((c) => c.code).sort();
  expect(codes).toEqual(['GB', 'US']);
  for (const c of r.fields.regions.candidates) {
    expect(c.currency).toBe('');
    expect(c.currency_note).toMatch(/locale is not a currency/i);
    expect(c.signals.length).toBeGreaterThan(0);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   VOICE — observed, or absent
   ═══════════════════════════════════════════════════════════════════════════ */

test('with no model reachable the voice is a reported gap, not a generic tone', async () => {
  const r = await runStore();
  expect(r.fields.voice.value).toBeNull();
  expect(r.fields.voice.marker).toContain('[DATA REQUIRED BEFORE LAUNCH: voice.tone');
  expect(r.fields.voice.note).toMatch(/Nothing was invented/i);
});

test('observed voice is labelled as observed, and invented vocabulary is dropped', async () => {
  const samples = [
    { text: 'We hand bind every edition in Leeds, in runs of two hundred.', source_url: 'https://northwind.example/', where: 'p' },
    { text: 'Nothing about it is fast and that is the point.', source_url: 'https://northwind.example/', where: 'p' },
  ];
  const fakeLlm = async () => ({
    provider: 'test', model: 'fixture',
    text: JSON.stringify({
      tone: 'plain spoken, unhurried, made by hand',
      // "artisanal" and "premium" appear NOWHERE in the samples.
      preferred_vocabulary: ['hand bind', 'artisanal', 'premium'],
      notes: 'Short declarative sentences.',
      evidence: [{ quote: 'Nothing about it is fast and that is the point.', supports: 'unhurried' },
                 { quote: 'We are the world leader in books.', supports: 'invented' }],
    }),
  });
  const out = await bx.observeVoice(samples, { llm: fakeLlm });
  expect(out.value.tone).toContain('plain spoken');
  expect(out.value.preferred).toContain('hand bind');
  expect(out.value.preferred).not.toContain('artisanal');
  expect(out.value.preferred).not.toContain('premium');
  expect(out.evidence.map((e) => e.quote).join(' ')).not.toMatch(/world leader/);
  expect(out.provenance).toMatch(/OBSERVED/);
  expect(out.provenance).toMatch(/not the company's internal voice guideline/i);
});

test('a banned-phrase list is never observed from copy the brand DID publish', async () => {
  const fakeLlm = async () => ({ provider: 'test', model: 'fixture', text: JSON.stringify({ tone: 'warm', preferred_vocabulary: [], notes: '', evidence: [] }) });
  const out = await bx.observeVoice([{ text: 'A long enough sentence of real copy to sample from.', source_url: 'https://x.example/', where: 'p' }], { llm: fakeLlm });
  expect(out.value.banned).toEqual([]);
  expect(out.banned_note).toMatch(/cannot be observed/i);
});

test('voice.banned is always reported as still required', async () => {
  const r = await runStore();
  expect(r.markers.join(' ')).toContain('[DATA REQUIRED BEFORE LAUNCH: voice.banned phrases');
});

/* ═══════════════════════════════════════════════════════════════════════════
   HONEST DEGRADATION — the most important behaviour in the module
   ═══════════════════════════════════════════════════════════════════════════ */

test('a site that declares nothing produces an EMPTY report, not a plausible one', async () => {
  const r = await runBare();
  expect(r.ok).toBe(true);

  // No declared identity anywhere, so no brand colour is proposed.
  expect(r.fields.palette.proposed.primary).toBe('');
  expect(r.fields.palette.markers.join(' ')).toContain('palette.primary');

  // No Organization, no og:site_name, no manifest: the only name signal is the
  // <title>, and it is offered as WEAK.
  expect(r.fields.name.confidence).toBe('weak');

  // Nothing declared these at all.
  expect(r.fields.logo.value).toBeNull();
  expect(r.fields.logo.marker).toContain('[DATA REQUIRED BEFORE LAUNCH: logo URL');
  expect(r.fields.social.candidates).toEqual([]);
  expect(r.fields.legal.candidates).toEqual([]);
  expect(r.fields.claims.candidates).toEqual([]);
  expect(r.fields.regions.candidates).toEqual([]);
});

test('the empty report NAMES every gap in the spec marker format', async () => {
  const r = await runBare();
  const markers = r.markers.join('\n');
  for (const field of ['logo URL', 'palette.primary', 'social profiles', 'legal entity', 'regions', 'verifiable claims', 'voice.tone']) {
    expect(markers).toContain(`[DATA REQUIRED BEFORE LAUNCH: ${field},`);
  }
});

test('a bare site never borrows another brand\'s values to fill a gap', async () => {
  const r = await runBare();
  const blob = JSON.stringify(r);
  // Tenant zero's palette and typefaces are the nearest thing to hand, and are
  // exactly what a fallback would reach for.
  expect(blob).not.toMatch(/#D0473E|#6A33D8/i);
  expect(blob).not.toMatch(/Montserrat|Instrument Sans/i);
  expect(blob.toLowerCase()).not.toContain('northwind');
});

test('an unusable stylesheet is reported as unread rather than as no colours', async () => {
  const site = Object.assign({}, BARE);
  site['https://plainshop.example/'] = html('<html><head><title>x</title><link rel="stylesheet" href="/missing.css"></head><body><p>hi</p></body></html>');
  const r = await bx.extractBrand('https://plainshop.example/', {
    brand: { website: 'https://plainshop.example' }, fetchImpl: fixtureFetch(site), llm: noLlm,
  });
  expect(r.notes.join(' ')).toMatch(/unreachable asset \(404\).*missing\.css/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   SCOPE — the same rule the catalogue crawler holds to
   ═══════════════════════════════════════════════════════════════════════════ */

test('a URL outside the brand is refused outright', async () => {
  const r = await bx.extractBrand('https://competitor.example/', {
    brand: { website: 'https://northwind.example' }, fetchImpl: fixtureFetch(STORE), llm: noLlm,
  });
  expect(r.ok).toBe(false);
  expect(r.error).toBe('start_url_out_of_scope');
});

test('an off-origin stylesheet is skipped and said so', async () => {
  const site = Object.assign({}, STORE, {
    'https://northwind.example/': html(STORE_HOME.replace('<link rel="stylesheet" href="/theme.css">', '<link rel="stylesheet" href="https://cdn.evil.example/theme.css">')),
  });
  const r = await bx.extractBrand('https://northwind.example/', {
    brand: { website: 'https://northwind.example' }, fetchImpl: fixtureFetch(site), llm: noLlm,
  });
  expect(r.notes.join(' ')).toMatch(/skipped \(off-origin asset\): https:\/\/cdn\.evil\.example/);
  expect(r.stylesheets.join(' ')).not.toContain('evil.example');
});

test('every og:locale:alternate is read, not just the last one', () => {
  // metaTags() keys by tag name, so the repeated og:locale:alternate tags
  // collapse to one there. A ten-market site would report one market.
  const page = `<html><head>
    <meta property="og:locale" content="en_GB">
    <meta property="og:locale:alternate" content="fr_FR">
    <meta property="og:locale:alternate" content="de_DE">
    <meta property="og:locale:alternate" content="ja_JP">
  </head><body></body></html>`;
  const out = bx.regionCandidates({ html: page, url: 'https://acme.example/', meta: crawl.metaTags(page), ld: [] });
  expect(out.regions.map((r) => r.code).sort()).toEqual(['DE', 'FR', 'GB', 'JP']);
});

test('a site that redirects its home page still yields its palette', async () => {
  // Comparing the home page against the URL that was REQUESTED breaks the
  // moment a site redirects (http to https, `/` to `/en-gb`, a trailing slash
  // added). Every page then compares unequal, nothing counts as home, and the
  // entire CSS-derived palette and typography vanish from the report while it
  // still reads as a successful extraction.
  const redirecting = {
    'https://acme.example/': { body: '<!doctype html><html><head><title>Acme</title><link rel="stylesheet" href="/t.css"></head><body><h1>Acme</h1></body></html>', contentType: 'text/html', final: 'https://acme.example/en-gb/' },
    'https://acme.example/t.css': css(':root{--brand-primary:#1F5FD0;--ink:#14181F;--page-bg:#FFFFFF}html,body{background:var(--page-bg);color:var(--ink)}'),
  };
  const r = await bx.extractBrand('https://acme.example/', {
    brand: { website: 'https://acme.example' },
    fetchImpl: async (u) => {
      const row = redirecting[u.split('#')[0]];
      if (!row) return { ok: false, status: 404, body: '' };
      return { ok: true, status: 200, body: row.body, url: row.final || u, contentType: row.contentType };
    },
    llm: noLlm,
  });
  expect(r.start).toBe('https://acme.example/en-gb/');
  expect(r.fields.palette.proposed.primary).toBe('#1f5fd0');
  expect(r.fields.palette.proposed.ink).toBe('#14181f');
});

test('every value in the report is attributable to a page', async () => {
  const r = await runStore();
  const check = (list) => { for (const c of list || []) { expect(c.signal).toBeTruthy(); expect(c.source_url).toBeTruthy(); } };
  check(r.fields.name.candidates);
  check(r.fields.tagline.candidates);
  check(r.fields.logo.candidates);
  check(r.fields.social.candidates);
  check(r.fields.claims.candidates);
  check(r.fields.legal.candidates);
  check(r.fields.typography.heading);
  check(r.fields.typography.body);
  for (const [, list] of Object.entries(r.fields.palette.roles)) check(list);
});

test('the no-browser limits are stated in the report, not just in the code', async () => {
  const r = await runStore();
  const limits = r.limits.join(' ');
  expect(limits).toMatch(/No browser/);
  expect(limits).toMatch(/JavaScript|single-page/i);
  expect(limits).toMatch(/Cascade is approximated/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE CRAWL HOOKS — one crawler, two readers
   ═══════════════════════════════════════════════════════════════════════════ */

test('onPage observes every fetched page and cannot break the crawl', async () => {
  const site = {
    'https://northwind.example/': html('<a href="/p/a">A</a>'),
    'https://northwind.example/p/a': html('<p>a</p>'),
  };
  const seen = [];
  const out = await crawl.crawlSite('https://northwind.example/', {
    brand: { website: 'https://northwind.example' }, fetchImpl: fixtureFetch(site),
    onPage: (body, url) => { seen.push(url); throw new Error('observer exploded'); },
  });
  expect(out.ok).toBe(true);
  expect(seen).toHaveLength(2);
  expect(out.notes.join(' ')).toMatch(/observer failed/);
});

test('rank steers a small budget without widening scope', async () => {
  const site = {
    'https://northwind.example/': html('<a href="/products/1">1</a><a href="/products/2">2</a><a href="/about">About</a><a href="https://competitor.example/about">Rival</a>'),
    'https://northwind.example/products/1': html('<p>1</p>'),
    'https://northwind.example/products/2': html('<p>2</p>'),
    'https://northwind.example/about': html('<p>about</p>'),
    'https://competitor.example/about': html('<p>rival</p>'),
  };
  const out = await crawl.crawlSite('https://northwind.example/', {
    brand: { website: 'https://northwind.example' }, fetchImpl: fixtureFetch(site), maxPages: 2,
    rank: (u) => (/\/about/.test(u) ? 90 : 10),
  });
  expect(out.pages).toContain('https://northwind.example/about');
  expect(out.pages.join(' ')).not.toContain('competitor.example');
});

test('without rank the traversal is unchanged (strict FIFO)', async () => {
  const site = {
    'https://northwind.example/': html('<a href="/a">a</a><a href="/b">b</a>'),
    'https://northwind.example/a': html('<p>a</p>'),
    'https://northwind.example/b': html('<p>b</p>'),
  };
  const out = await crawl.crawlSite('https://northwind.example/', {
    brand: { website: 'https://northwind.example' }, fetchImpl: fixtureFetch(site),
  });
  expect(out.pages).toEqual(['https://northwind.example/', 'https://northwind.example/a', 'https://northwind.example/b']);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE ROUTER
   ═══════════════════════════════════════════════════════════════════════════ */

test('extract is an advertised brand operation', () => {
  const core = require('../api/_shared/brand-workspace-core.js');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', '_shared', 'brand-workspace-core.js'), 'utf8');
  expect(src).toContain("case 'extract'");
  expect(src).toMatch(/available:\s*\[[^\]]*'extract'/);
  expect(typeof core.assertPublicUrl).toBe('function');   // the SSRF guard runExtract reuses
});

test('extract adds no serverless function', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  expect(fs.existsSync(path.join(root, 'api', '_shared', 'brand-extract.js'))).toBe(true);
  expect(fs.existsSync(path.join(root, 'api', 'brand-extract.js'))).toBe(false);
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  expect(Object.keys(vercel.functions || {}).length).toBeLessThanOrEqual(12);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE WIZARD — a candidate only becomes the brand when the operator says so
   ═══════════════════════════════════════════════════════════════════════════ */

const ONBOARDING = 'file://' + require('path').resolve(__dirname, '..', 'onboarding.html');

/** The shape /api/brand?op=extract returns, trimmed to what the UI reads. */
const REPORT = {
  ok: true,
  start: 'https://northwind.example/',
  pages: ['https://northwind.example/'],
  pages_visited: 1,
  stylesheets: ['https://northwind.example/theme.css'],
  coverage_note: 'Every reachable page within the configured depth was visited.',
  limits: ['No browser: this reads published HTML and CSS, it does not render the page.'],
  notes: [],
  markers: ['[DATA REQUIRED BEFORE LAUNCH: voice.banned phrases, all, all]'],
  fields: {
    name: {
      value: 'Northwind Books', signal: 'json-ld:Organization.name', confidence: 'declared',
      source_url: 'https://northwind.example/', evidence: 'Northwind Books',
      candidates: [
        { value: 'Northwind Books', signal: 'json-ld:Organization.name', confidence: 'declared', source_url: 'https://northwind.example/', evidence: 'Northwind Books' },
        { value: 'Northwind', signal: 'manifest:short_name', confidence: 'strong', source_url: 'https://northwind.example/manifest.webmanifest', evidence: 'Northwind' },
      ],
    },
    tagline: { value: null, candidates: [], marker: '[DATA REQUIRED BEFORE LAUNCH: tagline, all, all]' },
    website: { value: 'https://northwind.example/', candidates: [] },
    logo: { value: null, candidates: [], marker: '[DATA REQUIRED BEFORE LAUNCH: logo URL, all, all]', inline_svg: null },
    palette: {
      proposed: { primary: '#1f5fd0', accent: '#00a651', ink: '#14181f', surface: '#ffffff', surface_alt: '', muted: '' },
      sources: { primary: { signal: 'meta:theme-color', source_url: 'https://northwind.example/', evidence: 'theme-color' }, accent: null, ink: null, surface: null, muted: null },
      conflicts: [{ kind: 'brand_colour_vs_action_colour', message: 'The site declares #1f5fd0 as its own colour but paints its primary action surfaces #00a651.', identity: { value: '#1f5fd0' }, action: { value: '#00a651' } }],
      notes: [], markers: [], validation: { ok: true, errors: [], warnings: [] },
      roles: { identity: [{ value: '#1f5fd0', score: 100, signal: 'meta:theme-color', source_url: 'https://northwind.example/', confidence: 'declared', evidence: 'theme-color', seen: [], neutral: false }] },
    },
    typography: {
      heading: [{ value: 'Fraunces', signal: 'css:custom-property --font-head', confidence: 'declared', source_url: 'https://northwind.example/theme.css', evidence: '--font-head', stack: "'Fraunces',Georgia,serif", google: true, weights: '500;700' }],
      body: [], mono: [], font_faces: [], google_font_links: [], markers: ['[DATA REQUIRED BEFORE LAUNCH: typography.body, all, all]'],
    },
    voice: { value: null, marker: '[DATA REQUIRED BEFORE LAUNCH: voice.tone, all, all]', note: 'No language model was reachable, so no voice was observed. Nothing was invented in its place.' },
    claims: { candidates: [{ value: 'Free shipping over 40 pounds', signal: 'html:trust/benefit element', confidence: 'strong', source_url: 'https://northwind.example/', evidence: 'Free shipping over 40 pounds', approved: false, verbatim: true }], note: 'These are VERBATIM sentences from the site, not approved claims.' },
    social: { candidates: [{ value: 'https://instagram.com/northwindbooks', platform: 'instagram', signal: 'json-ld:sameAs', confidence: 'declared', source_url: 'https://northwind.example/', evidence: 'sameAs' }] },
    legal: { candidates: [{ value: 'Northwind Books Trading Ltd', signal: 'json-ld:Organization.legalName', confidence: 'declared', source_url: 'https://northwind.example/', evidence: 'legalName', kind: 'legal_name' }], documents: [], note: '' },
    regions: { candidates: [{ code: 'GB', store_url: 'https://northwind.example/', currency: '', signals: [{ signal: 'link:alternate[hreflang]', source_url: 'https://northwind.example/' }], currency_note: 'A locale is not a currency.' }], currencies_seen: [] },
  },
};

async function openWizard(page, report) {
  await page.addInitScript((rep) => {
    window.__EXTRACT_CALLS__ = [];
    window.BrandContext = {
      ready: async () => null,
      list: async () => ({ workspaces: [], active_id: null }),
      setActive: async () => ({}),
      api: async (op, opts) => {
        window.__EXTRACT_CALLS__.push({ op, body: (opts || {}).body });
        if (op === 'extract') return rep;
        if (op === 'save') return { brand: { id: 'ws-test', slug: 'northwind' } };
        return {};
      },
    };
  }, report);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(ONBOARDING);
  await page.waitForSelector('#xRun');
  return errors;
}

test('step 1 offers to read the brand from its own website', async ({ page }) => {
  const errors = await openWizard(page, REPORT);
  await expect(page.locator('#xUrl')).toBeVisible();
  await expect(page.locator('#xRun')).toHaveText(/Read my site/);
  // The promise the UI makes has to be the one the server keeps.
  await expect(page.locator('.xtract').first()).toContainText('nothing is applied until you press Use');
  expect(errors).toEqual([]);
});

test('extracted values render with their source and are NOT applied automatically', async ({ page }) => {
  await openWizard(page, REPORT);
  await page.fill('#xUrl', 'https://northwind.example/');
  await page.click('#xRun');
  await page.waitForSelector('[data-xa="name"]');

  // Shown, with provenance.
  const panel = page.locator('.xtract').nth(1);
  await expect(panel).toContainText('Northwind Books');
  await expect(panel).toContainText('json-ld:Organization.name');
  await expect(panel).toContainText('https://northwind.example/');

  // Not applied: the form field is still empty until Use is pressed.
  await expect(page.locator('input[data-path="name"]')).toHaveValue('');
  await page.locator('[data-xa="name"][data-xi="0"]').click();
  await expect(page.locator('input[data-path="name"]')).toHaveValue('Northwind Books');
});

test('a lower-ranked candidate can be chosen instead of the top one', async ({ page }) => {
  await openWizard(page, REPORT);
  await page.fill('#xUrl', 'https://northwind.example/');
  await page.click('#xRun');
  await page.waitForSelector('[data-xa="name"][data-xi="1"]');
  await page.locator('[data-xa="name"][data-xi="1"]').click();
  await expect(page.locator('input[data-path="name"]')).toHaveValue('Northwind');
});

test('a field the site did not publish shows the marker, not a guess', async ({ page }) => {
  await openWizard(page, REPORT);
  await page.fill('#xUrl', 'https://northwind.example/');
  await page.click('#xRun');
  await page.waitForSelector('.xtract .marker');
  const markers = await page.locator('.xtract .marker').allTextContents();
  expect(markers.join(' ')).toContain('[DATA REQUIRED BEFORE LAUNCH: tagline');
  expect(markers.join(' ')).toContain('[DATA REQUIRED BEFORE LAUNCH: logo URL');
  await expect(page.locator('input[data-path="tagline"]')).toHaveValue('');
  await expect(page.locator('input[data-path="logo_url"]')).toHaveValue('');
});

test('the colour step shows the brand-vs-CTA conflict before anything is applied', async ({ page }) => {
  await openWizard(page, REPORT);
  await page.fill('#xUrl', 'https://northwind.example/');
  await page.click('#xRun');
  await page.waitForSelector('[data-xa="name"]');
  await page.locator('.step-pip[data-step="2"]').click();
  await page.waitForSelector('.xconflict');
  await expect(page.locator('.xconflict')).toContainText('not the same');
  await expect(page.locator('.xconflict')).toContainText('#00a651');
  // Until "Use this colour schema" is pressed the wizard keeps its own default.
  await expect(page.locator('input[type=text][data-path="palette.primary"]')).not.toHaveValue('#1f5fd0');
  await page.locator('[data-xa="palette-all"]').click();
  await expect(page.locator('input[type=text][data-path="palette.primary"]')).toHaveValue('#1f5fd0');
});

test('the typography step applies a family with its stack and weights', async ({ page }) => {
  await openWizard(page, REPORT);
  await page.fill('#xUrl', 'https://northwind.example/');
  await page.click('#xRun');
  await page.waitForSelector('[data-xa="name"]');
  await page.locator('.step-pip[data-step="3"]').click();
  await page.waitForSelector('[data-xa="font-heading"]');
  await expect(page.locator('.xtract')).toContainText('[DATA REQUIRED BEFORE LAUNCH: typography.body');
  await page.locator('[data-xa="font-heading"][data-xi="0"]').click();
  await expect(page.locator('.pv-h')).toHaveCSS('font-family', /Fraunces/);
});

test('claims are only added when the operator ticks them', async ({ page }) => {
  await openWizard(page, REPORT);
  await page.fill('#xUrl', 'https://northwind.example/');
  await page.click('#xRun');
  await page.waitForSelector('[data-xa="name"]');
  await page.locator('.step-pip[data-step="4"]').click();
  await page.waitForSelector('[data-xa="claims"]');
  await expect(page.locator('.xtract')).toContainText('not approved claims');
  // Pressing add with nothing ticked must not add anything.
  await page.locator('[data-xa="claims"]').click();
  await expect(page.locator('#toast')).toContainText('Tick the sentences');
  await page.locator('[data-xclaim="0"]').check();
  await page.locator('[data-xa="claims"]').click();
  await expect(page.locator('#toast')).toContainText('Added 1 claim');
});

test('an unreadable site says so instead of half-filling the form', async ({ page }) => {
  const failing = { ok: false, error: 'start_url_out_of_scope', message: 'That URL is not on this brand\'s own domain.' };
  await openWizard(page, failing);
  await page.fill('#xUrl', 'https://competitor.example/');
  await page.click('#xRun');
  const failed = page.locator('.xtract', { has: page.locator('h3:has-text("Could not read that site")') });
  await expect(failed).toContainText('not on this brand');
  await expect(page.locator('input[data-path="name"]')).toHaveValue('');
});

test('reopening a brand does not wipe the facts the extraction saved into it', async ({ page }) => {
  // brand_data is the overflow column that carries verifiable claims, social
  // profiles and the legal entity — the claims being the ONLY statements a
  // generator is allowed to present as fact. The wizard posts its whole model
  // on every save, so a model that never loaded brand_data replaced all of it
  // with {} the moment someone opened the brand and pressed Next.
  const SAVED = {
    id: 'ws-1', slug: 'northwind', name: 'Northwind Books', status: 'draft',
    palette: { primary: '#1f5fd0', ink: '#14181f', surface: '#ffffff' },
    regions: [{ code: 'GB', currency: 'GBP', store_url: 'https://northwind.example' }],
    brand_data: {
      claims: ['Free shipping over 40 pounds'],
      social: [{ platform: 'instagram', url: 'https://instagram.com/northwindbooks' }],
      legal_entity: 'Northwind Books Trading Ltd',
    },
  };
  await page.addInitScript((saved) => {
    window.__SAVES__ = [];
    window.BrandContext = {
      ready: async () => ({ id: 'ws-1' }),
      list: async () => ({ workspaces: [], active_id: 'ws-1' }),
      setActive: async () => ({}),
      api: async (op, opts) => {
        if (op === 'get') return { brand: saved };
        if (op === 'save') { window.__SAVES__.push((opts || {}).body.brand); return { brand: saved }; }
        return {};
      },
    };
  }, SAVED);
  await page.goto(ONBOARDING + '?id=ws-1&step=1');
  await page.waitForSelector('[data-go="next"]');
  await page.locator('[data-go="next"]').click();
  await page.waitForFunction(() => (window.__SAVES__ || []).length > 0);

  const sent = await page.evaluate(() => window.__SAVES__[0]);
  expect(sent.brand_data.claims).toEqual(['Free shipping over 40 pounds']);
  expect(sent.brand_data.legal_entity).toBe('Northwind Books Trading Ltd');
  expect(sent.brand_data.social).toHaveLength(1);
});
