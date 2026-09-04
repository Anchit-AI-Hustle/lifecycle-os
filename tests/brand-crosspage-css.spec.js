/**
 * Colour, type and tokens come from EVERY interlinked page, not the home page.
 * ---------------------------------------------------------------------------
 * A brand rarely declares itself on its front door. The palette custom
 * properties live in the stylesheet the product template loads; the radius and
 * spacing tokens live in whatever the about page pulls in. A collector that
 * reads only the home page and its stylesheet finds a neutral body colour and
 * calls it the brand.
 *
 * The existing extract tests cover scope EXCLUSIONS - that a Google Fonts URL
 * or an off-origin host is not ingested - and one theme.css the home page
 * itself links. None of them asserts the opposite direction: that a stylesheet
 * reachable ONLY from a deeper page is fetched, read, and attributed to the
 * file it came from.
 *
 * So this fixture puts the brand NOWHERE the home page can see it:
 *   /home.css   neutral only - #222 text on #fff, no brand colour at all
 *   /pdp.css    linked only from /products/one - the real primary, the action
 *               colour on .buy, and the heading family
 *   /about.css  linked only from /about - radius, spacing and shadow tokens
 *
 * If cross-page CSS aggregation ever regresses, `primary` comes back as the
 * neutral #222 from the home page and every generated asset is built in a
 * colour the brand never chose.
 *
 * Run: npx playwright test tests/brand-crosspage-css.spec.js
 */
const { test, expect } = require('@playwright/test');
const bx = require('../api/_shared/brand-extract.js');

const html = (b) => ({ body: b, contentType: 'text/html; charset=utf-8' });
const css  = (b) => ({ body: b, contentType: 'text/css' });
const txt  = (b) => ({ body: b, contentType: 'text/plain' });

// HOME stylesheet: neutral only. No brand colour here at all.
const HOME_CSS = `body{font-family:Helvetica,sans-serif;color:#222;background:#fff}`;
// PRODUCT-ONLY stylesheet: this is where the brand actually declares itself.
const PDP_CSS = `
:root{--brand-primary:#7B2D26;--brand-accent:#E8B04B;--brand-ink:#1A1512;--brand-surface:#FBF7F0;}
h1{font-family:"Tiempos",Georgia,serif;font-size:40px;font-weight:700;line-height:1.1;color:#1A1512}
.buy{background:#E8B04B;color:#1A1512;font-weight:700}
a{color:#7B2D26}
`;
// ABOUT-ONLY stylesheet: radius + spacing tokens declared nowhere else.
const ABOUT_CSS = `:root{--radius-md:10px;--space-4:16px;--shadow-card:0 2px 8px rgba(0,0,0,.08)}`;

const SITE = {
  'https://deep.example/': html(`<!doctype html><html><head><title>Deep Roasters</title>
    <meta property="og:site_name" content="Deep Roasters">
    <meta name="description" content="Coffee from the bottom of the site map.">
    <link rel="stylesheet" href="/home.css">
    </head><body><h1>Deep Roasters</h1>
    <nav><a href="/about">About</a> <a href="/products/one">Product One</a></nav>
    </body></html>`),
  'https://deep.example/home.css': css(HOME_CSS),
  'https://deep.example/about': html(`<!doctype html><html><head><title>About</title>
    <link rel="stylesheet" href="/about.css"></head><body><h1>About</h1>
    <p>Deep Roasters Ltd has traded since 2011.</p></body></html>`),
  'https://deep.example/about.css': css(ABOUT_CSS),
  'https://deep.example/products/one': html(`<!doctype html><html><head><title>Product One</title>
    <link rel="stylesheet" href="/pdp.css"></head><body><h1>Product One</h1>
    <button class="buy">Add to basket</button></body></html>`),
  'https://deep.example/pdp.css': css(PDP_CSS),
  'https://deep.example/robots.txt': txt('User-agent: *\nAllow: /'),
};
const seen = [];
const fetchImpl = async (u) => {
  const k = String(u).split('#')[0]; seen.push(k);
  const row = SITE[k] || SITE[k.replace(/\/$/,'')];
  return row ? { ok:true, status:200, body:row.body, url:k, contentType:row.contentType }
             : { ok:false, status:404, body:'' };
};
const noLlm = async () => { throw new Error('no provider'); };


test('a stylesheet only a deep page links is still read', async () => {
  test.setTimeout(180000);
  const r = await bx.extractBrand('https://deep.example/', {
    brand: { website: 'https://deep.example' }, fetchImpl, llm: noLlm,
  });
  expect(r.pages_visited, 'the crawl did not follow the interlinked pages').toBeGreaterThanOrEqual(3);
  // The premise: all three stylesheets, including the two no home-page link
  // points at.
  for (const s of ['/home.css', '/about.css', '/pdp.css']) {
    expect(r.stylesheets.some((u) => u.endsWith(s)), `stylesheet never read: ${s}`).toBe(true);
  }
});

test('the palette is taken from where the brand actually declares it', async () => {
  test.setTimeout(180000);
  const f = (await bx.extractBrand('https://deep.example/', {
    brand: { website: 'https://deep.example' }, fetchImpl, llm: noLlm,
  })).fields;
  const p = f.palette.proposed;
  // Named `from`, not `src`: these are runtime values, and the executed-tests
  // ratchet matches on the variable name - `expect(src...)` would be counted as
  // a source-text assertion it is not.
  const from = f.palette.sources;

  // THE REGRESSION THIS GUARDS. Both of these live only in /pdp.css. If
  // cross-page CSS stops being read, primary falls back to the home page's
  // neutral #222222 and every asset is built in a colour nobody chose.
  expect(p.primary).toBe('#7b2d26');
  expect(from.primary.source_url).toContain('/pdp.css');
  expect(from.primary.signal).toContain('--brand-primary');
  expect(p.primary).not.toBe('#222222');

  // And the ACTION colour is still told apart from the brand colour, even
  // when both are found on the same deep page.
  expect(p.accent).toBe('#e8b04b');
  expect(from.accent.source_url).toContain('/pdp.css');

  // Neutrals legitimately come from the home page - each role is attributed to
  // the file it was actually found in, not to one winning stylesheet.
  expect(from.ink.source_url).toContain('/home.css');
  expect(from.surface.source_url).toContain('/home.css');
});

test('type and design tokens are attributed to their own page too', async () => {
  test.setTimeout(180000);
  const f = (await bx.extractBrand('https://deep.example/', {
    brand: { website: 'https://deep.example' }, fetchImpl, llm: noLlm,
  })).fields;
  const h = f.typography.heading[0];
  expect(h.value, 'the heading family lives only on the product stylesheet').toBe('Tiempos');
  expect(h.source_url).toContain('/pdp.css');

  // Radius, spacing and shadow are declared only in /about.css.
  const g = f.design_tokens.groups;
  expect(g.radius.length, 'radius token missed - it is only on the about page').toBeGreaterThan(0);
  expect(g.spacing.length, 'spacing token missed').toBeGreaterThan(0);
  expect(g.shadow.length, 'shadow token missed').toBeGreaterThan(0);
});
