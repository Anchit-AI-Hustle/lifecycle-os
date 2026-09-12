/**
 * A brand's LOGO, its ICONS and its IMAGERY are three different things.
 * ---------------------------------------------------------------------------
 * Setup-from-URL used to pool all three into one bag and rank them together.
 * Manifest icons and apple-touch-icons were pushed at `declared` while the
 * site's own labelled wordmark was only `strong`, so rankCandidates put a
 * 512px square PWA tile FIRST: a site publishing both had its app icon chosen
 * as the brand logo, and that is what then went into every mailer, ad and
 * landing page where a wordmark belongs.
 *
 * Measured before the fix on the fixture below: logo = /icon-512.png, with the
 * page's own `<img src="/img/logo.svg" alt="ACME Roasters">` ranked under it.
 *
 * There was also no `icons` field and no `images` field at all. Icons were only
 * ever logo runners-up, and the brand's photography - its share card, the
 * images its structured data attaches to each product, its in-content shots -
 * was crawled and then thrown away, so generation had markers where the brand's
 * own pictures should have been.
 *
 * WHAT THIS ASSERTS, and why the fixture is shaped as it is: five INTERLINKED
 * pages, because the interesting imagery is never on the front door - a product
 * photograph lives on the product page, and a collector that only reads the
 * home page finds none of it.
 *
 * Run: npx playwright test tests/brand-icons-images.spec.js
 */
const { test, expect } = require('@playwright/test');
const bx = require('../api/_shared/brand-extract.js');

// The repo's own fixture shape: a PLAIN object with a string `body`, never a
// Response-like with .text(). Getting this wrong makes every field come back
// null and reads as "the extractor picks up nothing" - the harness lying.
const html = (b) => ({ body: b, contentType: 'text/html; charset=utf-8' });
const css  = (b) => ({ body: b, contentType: 'text/css' });
const json = (b) => ({ body: JSON.stringify(b), contentType: 'application/manifest+json' });
const txt  = (b) => ({ body: b, contentType: 'text/plain' });

const CSS = `
:root{--acme-ink:#12232E;--acme-brand:#0F7B6C;--acme-action:#C2410C;}
body{font-family:"Sohne",Helvetica,sans-serif;font-size:16px;color:#12232E;background:#FFFDF8}
h1{font-family:"Canela",Georgia,serif;font-size:44px;font-weight:700;line-height:1.08;letter-spacing:-0.02em;color:#12232E}
h2{font-family:"Canela",Georgia,serif;font-size:30px;font-weight:600;line-height:1.15}
a{color:#0F7B6C;text-decoration:underline}
.btn{background:#C2410C;color:#FFFFFF;font-weight:600;border-radius:6px}
`;

const SITE = {
  'https://acme.example/': html(`<!doctype html><html lang="en"><head>
    <title>ACME Roasters - Small-batch coffee, roasted to order</title>
    <meta name="description" content="Small-batch coffee, roasted to order in Bristol.">
    <meta name="theme-color" content="#0F7B6C">
    <meta property="og:image" content="https://acme.example/img/og-hero.jpg">
    <meta property="og:site_name" content="ACME Roasters">
    <link rel="manifest" href="/manifest.json">
    <link rel="icon" href="/favicon-32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="stylesheet" href="/theme.css">
    </head><body>
    <header><img src="/img/logo.svg" alt="ACME Roasters"></header>
    <h1>Small-batch coffee, roasted to order</h1>
    <p>We roast in Bristol every Tuesday and ship the same week. Nothing sits in a warehouse.</p>
    <nav><a href="/about">About</a> <a href="/collections/all">Shop</a>
      <a href="/products/ethiopia-guji">Ethiopia Guji</a> <a href="/products/brazil-cerrado">Brazil Cerrado</a>
      <a href="/policies/terms">Terms</a></nav>
    <a href="https://instagram.com/acmeroasters">Instagram</a>
    <a href="https://www.linkedin.com/company/acmeroasters">LinkedIn</a>
    </body></html>`),
  'https://acme.example/theme.css': css(CSS),
  'https://acme.example/manifest.json': json({ name:'ACME Roasters', short_name:'ACME',
    theme_color:'#0F7B6C', background_color:'#FFFDF8',
    icons:[{src:'/icon-192.png',sizes:'192x192'},{src:'/icon-512.png',sizes:'512x512'}] }),
  'https://acme.example/about': html(`<!doctype html><html><head><title>About | ACME Roasters</title>
    <link rel="stylesheet" href="/theme.css"></head><body><h1>About</h1>
    <p>ACME Roasters Ltd has roasted in Bristol since 2016. Registered in England, company no. 09876543.</p>
    <a href="/collections/all">Shop</a></body></html>`),
  'https://acme.example/collections/all': html(`<!doctype html><html><head><title>Shop | ACME Roasters</title></head><body>
    <h1>All coffee</h1>
    <a href="/products/ethiopia-guji"><img src="/img/guji.jpg" alt="Ethiopia Guji"></a>
    <a href="/products/brazil-cerrado"><img src="/img/cerrado.jpg" alt="Brazil Cerrado"></a>
    </body></html>`),
  'https://acme.example/products/ethiopia-guji': html(`<!doctype html><html><head>
    <title>Ethiopia Guji | ACME Roasters</title>
    <meta property="og:image" content="https://acme.example/img/guji-1200.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
      "name":"Ethiopia Guji","image":["https://acme.example/img/guji-1200.jpg"],
      "description":"Peach, jasmine, bergamot.",
      "offers":{"@type":"Offer","price":"14.50","priceCurrency":"GBP","availability":"InStock"}}</script>
    </head><body><h1>Ethiopia Guji</h1><p>Peach, jasmine, bergamot.</p><span class="price">£14.50</span>
    <img src="/img/guji-detail.jpg" alt="Ethiopia Guji bag"></body></html>`),
  'https://acme.example/products/brazil-cerrado': html(`<!doctype html><html><head>
    <title>Brazil Cerrado | ACME Roasters</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
      "name":"Brazil Cerrado","image":["https://acme.example/img/cerrado-1200.jpg"],
      "offers":{"@type":"Offer","price":"12.00","priceCurrency":"GBP"}}</script>
    </head><body><h1>Brazil Cerrado</h1><span class="price">£12.00</span></body></html>`),
  'https://acme.example/policies/terms': html(`<!doctype html><html><head><title>Terms</title></head><body>
    <p>These terms are issued by ACME Roasters Ltd, 12 Feeder Road, Bristol BS2 0SB.</p></body></html>`),
  'https://acme.example/robots.txt': txt('User-agent: *\nAllow: /'),
};

const seen = [];
const fetchImpl = async (u) => {
  const k = String(u).split('#')[0];
  seen.push(k);
  const row = SITE[k] || SITE[k.replace(/\/$/, '')];
  if (!row) return { ok: false, status: 404, body: '' };
  return { ok: true, status: 200, body: row.body, url: k, contentType: row.contentType };
};
const noLlm = async () => { throw new Error('no provider configured in this probe'); };


const run = () => bx.extractBrand('https://acme.example/', {
  brand: { website: 'https://acme.example' }, fetchImpl, llm: noLlm,
});

test('the crawl follows the site\'s interlinked pages, not just the home page', async () => {
  test.setTimeout(180000);
  const r = await run();
  // A collector that reads one page finds no product photography at all, so
  // this is the premise every assertion below depends on.
  expect(r.pages_visited, 'the crawl did not follow the interlinked pages').toBeGreaterThanOrEqual(6);
  for (const p of ['/about', '/collections/all', '/products/ethiopia-guji', '/products/brazil-cerrado']) {
    expect(seen.some((u) => u.endsWith(p)), `never fetched ${p}`).toBe(true);
  }
  expect(r.stylesheets.length, 'the stylesheet was never read').toBeGreaterThan(0);
  expect(r.manifest_url, 'the manifest was never read').toContain('manifest.json');
});

test('the LOGO is the wordmark the site labelled, never a square app icon', async () => {
  test.setTimeout(180000);
  const f = (await run()).fields;
  // THE REGRESSION. If this ever returns an icon again, every generated asset
  // gets an app tile where the wordmark belongs.
  expect(f.logo.value, 'a square app icon was chosen as the brand logo').toBe('https://acme.example/img/logo.svg');
  expect(f.logo.signal).toBe('html:img[logo]');
  expect(f.logo.value).not.toMatch(/icon-\d+\.png|apple-touch-icon|favicon/);
});

test('ICONS are their own field, with the sizes the site declared', async () => {
  test.setTimeout(180000);
  const f = (await run()).fields;
  const vals = f.icons.candidates.map((c) => c.value);
  expect(f.icons.count, 'no icon set was collected').toBeGreaterThanOrEqual(4);
  for (const want of ['/icon-192.png', '/icon-512.png', '/favicon-32.png', '/apple-touch-icon.png']) {
    expect(vals.some((v) => v.endsWith(want)), `icon missing: ${want}`).toBe(true);
  }
  // Sizes are what the site DECLARED. Nothing is measured: reading real pixel
  // dimensions would mean fetching every image.
  const byUrl = Object.fromEntries(f.icons.candidates.map((c) => [c.value.split('/').pop(), c]));
  expect(byUrl['icon-512.png'].size_px).toBe(512);
  expect(byUrl['favicon-32.png'].size_px).toBe(32);
  expect(byUrl['favicon-32.png'].purpose).toBe('favicon');
  // And the wordmark is NOT in here - that is the whole point of the split.
  expect(vals.some((v) => v.endsWith('logo.svg')), 'the logo leaked into the icon set').toBe(false);
});

test('IMAGES are collected from every page, each carrying the page it came from', async () => {
  test.setTimeout(180000);
  const f = (await run()).fields;
  const by = Object.fromEntries(f.images.candidates.map((c) => [c.value.split('/').pop(), c]));
  expect(f.images.count, 'no brand imagery was collected').toBeGreaterThanOrEqual(6);

  // Structured-data product photography, from the PRODUCT pages - the rows a
  // home-page-only collector never sees.
  expect(by['guji-1200.jpg'].signal).toBe('json-ld:Product.image');
  expect(by['guji-1200.jpg'].source_url).toContain('/products/ethiopia-guji');
  expect(by['guji-1200.jpg'].subject).toBe('Ethiopia Guji');
  expect(by['cerrado-1200.jpg'].source_url).toContain('/products/brazil-cerrado');
  // The share card, and in-content shots that carry real alt text.
  expect(by['og-hero.jpg'].kind).toBe('share-card');
  expect(by['guji.jpg'].signal).toBe('html:img[alt]');
  expect(by['guji.jpg'].alt).toBe('Ethiopia Guji');

  // Logos and icons must not be double-counted as photography.
  const vals = Object.keys(by);
  for (const junk of ['logo.svg', 'icon-192.png', 'icon-512.png', 'favicon-32.png', 'apple-touch-icon.png']) {
    expect(vals.includes(junk), `${junk} leaked into brand imagery`).toBe(false);
  }
  // Off-origin imagery is FLAGGED, not silently adopted: a CDN is normal and a
  // hotlinked stock photo is not the brand's to use, and this cannot tell them
  // apart. Nothing here is off-origin, so the count must say zero rather than
  // being absent.
  expect(f.images.off_origin_count).toBe(0);
});

test('a site publishing none of it gets markers, not invented URLs', async () => {
  test.setTimeout(180000);
  const bare = { 'https://plain.example/': html('<!doctype html><html><head><title>plain</title></head><body><p>Hello.</p></body></html>') };
  const r = await bx.extractBrand('https://plain.example/', {
    brand: { website: 'https://plain.example' },
    fetchImpl: async (u) => { const row = bare[String(u).split('#')[0]];
      return row ? { ok: true, status: 200, body: row.body, url: u, contentType: row.contentType } : { ok: false, status: 404, body: '' }; },
    llm: noLlm,
  });
  expect(r.fields.icons.count).toBe(0);
  expect(r.fields.icons.marker, 'an empty icon set must say so').toMatch(/DATA REQUIRED/);
  expect(r.fields.images.count).toBe(0);
  expect(r.fields.images.marker, 'empty imagery must say so').toMatch(/DATA REQUIRED/);
});
