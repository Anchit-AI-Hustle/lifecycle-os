// WHICH MARKET IS HOME, and does every region control open on it.
//
// The rail said "Market: India (IN)" for an Indian news brand while /research
// opened on a US study, /retention-playbook filtered to US, the Studio's
// target-market chips offered seven markets with US on, and the calendar
// planned for US. Each control carried its own typed list and its own typed
// default, and the brand record had no way to say which market was HOME.
//
// Two halves, both EXECUTED:
//   (a) the extractor derives a home market from what the site publishes
//       (x-default, ccTLD, legal address, home-page price currency, store
//       country), proposes only from strong signals, and reports a conflict
//       rather than resolving one - run over fixture sites, no network;
//   (b) in Chromium, every region control on the real pages is built from the
//       ACTIVE brand's own regions and opens on its home, for an India-only
//       brand, for tenant zero, and for a brand with no regions at all.
//
// Run: npx playwright test tests/brand-regions.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
// op=extract RENDERS the site in a browser first (2026-10-04, brand-render.js).
// This spec is about the gate and the parser path, so the browser read is
// switched off with the operator's own switch; the rendered path has its own
// specs (rendered-brand-read*.spec.js), which switch it back on.
process.env.BRAND_RENDER = 'off';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const bx = require('../api/_shared/brand-extract.js');
const sd = require('../api/_shared/storefront-detect.js');
const core = require('../api/_shared/brand-workspace-core.js');
const rt = require('../api/_shared/brand-runtime.js');

/* ═══════════════════════════════════════════════════════════════════════════
   (a) HOME-MARKET DERIVATION, over fixture sites
   ═══════════════════════════════════════════════════════════════════════════ */

const html = (b) => ({ body: b, contentType: 'text/html; charset=utf-8' });
const fetchOf = (site) => async (u) => {
  const k = String(u).split('#')[0];
  const row = site[k] || site[k.replace(/\/$/, '')];
  return row
    ? { ok: true, status: 200, body: row.body, url: k, contentType: row.contentType }
    : { ok: false, status: 404, body: '', url: k, contentType: 'text/plain' };
};
const noLlm = async () => { throw new Error('no provider in tests'); };
const run = (start, site) => bx.extractBrand(start, { brand: { website: start }, fetchImpl: fetchOf(site), llm: noLlm, voice: false });

const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const product = (currency) => ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Thing', offers: { '@type': 'Offer', price: '10', priceCurrency: currency } });
const org = (country) => ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme', address: { '@type': 'PostalAddress', streetAddress: '1 Road', addressLocality: 'Town', addressCountry: country } });

test('an .in site with INR offers and an x-default pointing at itself: home IN, with its signals', async () => {
  const site = {
    'https://acme.in/': html(`<!doctype html><html lang="en-IN"><head><title>Acme</title>
      <link rel="alternate" hreflang="en-IN" href="https://acme.in/">
      <link rel="alternate" hreflang="en-US" href="https://acme.in/us">
      <link rel="alternate" hreflang="x-default" href="https://acme.in/">
      <meta property="og:locale" content="en_IN">
      ${product('INR')}${org('IN')}</head><body><h1>Acme</h1><p>Hand made things, shipped everywhere.</p></body></html>`),
  };
  const r = await run('https://acme.in/', site);
  expect(r.ok).toBe(true);
  const home = r.fields.regions.home;
  expect(home.proposed).toBe('IN');
  expect(home.conflict).toBeNull();
  expect(home.marker).toBe('');
  const signals = home.signals.map((s) => s.signal);
  expect(signals).toContain('link:alternate[hreflang=x-default]');
  expect(signals).toContain('host:ccTLD .in');
  expect(signals).toContain('json-ld:Offer.priceCurrency (INR)');
  expect(signals).toContain('json-ld:Organization.address');
  // Every signal carries the page it came from.
  for (const s of home.signals) expect(s.source_url).toBe('https://acme.in/');
  // Weak signals corroborate and are listed as such, never counted as strong.
  expect(home.corroborators.map((c) => c.signal).sort()).toEqual(['html:<html lang>', 'opengraph:og:locale']);
  expect(home.considered.every((s) => s.confidence !== 'weak')).toBe(true);
  // The home region is a candidate flagged home; the other hreflang region is not.
  const byCode = Object.fromEntries(r.fields.regions.candidates.map((c) => [c.code, c]));
  expect(byCode.IN.home).toBe(true);
  expect(byCode.US.home).toBe(false);
  // Currency filled ONLY because the home page declared it on its own offers.
  expect(byCode.IN.currency).toBe('INR');
  expect(byCode.US.currency).toBe('');
  expect(r.markers).not.toContain(bx.MARKER('home market'));
});

test('a .com site with hreflang en-US/en-GB, USD offers and a US legal address: home US', async () => {
  const site = {
    'https://acme.com/': html(`<!doctype html><html lang="en"><head><title>Acme</title>
      <link rel="alternate" hreflang="en-US" href="https://acme.com/">
      <link rel="alternate" hreflang="en-GB" href="https://acme.com/uk">
      ${product('USD')}${org('United States')}</head><body><h1>Acme</h1></body></html>`),
  };
  const r = await run('https://acme.com/', site);
  const home = r.fields.regions.home;
  expect(home.proposed).toBe('US');
  const signals = home.signals.map((s) => s.signal);
  // .com is NOT a signal, and the report says so rather than staying silent.
  expect(signals.some((s) => /ccTLD/.test(s))).toBe(false);
  expect(home.notes.join(' ')).toMatch(/\.com is not a country signal/);
  // USD is NOT a strong signal (review finding 4): it is the pricing currency
  // of global .com storefronts. The address alone proposes US; USD corroborates.
  expect(signals).not.toContain('json-ld:Offer.priceCurrency (USD)');
  expect(signals).toContain('json-ld:Organization.address');   // "United States", a NAME, resolved to US
  expect(home.corroborators.map((c) => c.signal + '=' + c.code)).toContain('json-ld:Offer.priceCurrency (USD)=US');
  // The home page declared USD and the home is US, so the US row carries it.
  expect(r.fields.regions.candidates.find((c) => c.code === 'US').currency).toBe('USD');
  expect(r.fields.regions.candidates.map((c) => c.code).sort()).toEqual(['GB', 'US']);
  expect(r.fields.regions.candidates.find((c) => c.code === 'GB').home).toBe(false);
});

test('a site with no signals: no home, a marker, and nothing invented', async () => {
  const site = {
    'https://plainshop.com/': html('<!doctype html><html><head><title>plainshop</title></head><body><h1>Welcome</h1><p>We sell things.</p></body></html>'),
  };
  const r = await run('https://plainshop.com/', site);
  const home = r.fields.regions.home;
  expect(home.proposed).toBe('');
  expect(home.conflict).toBeNull();
  expect(home.marker).toBe(bx.MARKER('home market'));
  expect(r.fields.regions.candidates).toEqual([]);
  expect(r.markers).toContain(bx.MARKER('home market'));
  expect(r.markers).toContain(bx.MARKER('regions'));
});

test('ccTLD says UK while x-default and the legal address say IN: a CONFLICT, nothing proposed', async () => {
  const site = {
    'https://acme.co.uk/': html(`<!doctype html><html><head><title>Acme</title>
      <link rel="alternate" hreflang="en-IN" href="https://acme.co.uk/">
      <link rel="alternate" hreflang="en-GB" href="https://acme.co.uk/gb">
      <link rel="alternate" hreflang="x-default" href="https://acme.co.uk/">
      ${org('India')}</head><body><h1>Acme</h1></body></html>`),
  };
  const r = await run('https://acme.co.uk/', site);
  const home = r.fields.regions.home;
  expect(home.proposed).toBe('');
  expect(home.conflict).not.toBeNull();
  expect(home.conflict.candidates.map((c) => c.code).sort()).toEqual(['GB', 'IN']);
  // Both sides are shown with the signals that put them there.
  const gb = home.conflict.candidates.find((c) => c.code === 'GB');
  const inn = home.conflict.candidates.find((c) => c.code === 'IN');
  expect(gb.signals.map((s) => s.signal)).toContain('host:ccTLD .co.uk');
  expect(inn.signals.map((s) => s.signal)).toEqual(expect.arrayContaining(['link:alternate[hreflang=x-default]', 'json-ld:Organization.address']));
  expect(r.fields.regions.candidates.every((c) => c.home === false)).toBe(true);
  expect(r.markers).toContain(bx.MARKER('home market'));
});

test('<html lang> and og:locale alone NEVER propose a home market', async () => {
  // The mutation this guards: promoting the weak corroborators to strong.
  const site = {
    'https://acme.com/': html('<!doctype html><html lang="en-IN"><head><title>Acme</title><meta property="og:locale" content="en_IN"></head><body><h1>Acme</h1></body></html>'),
  };
  const r = await run('https://acme.com/', site);
  const home = r.fields.regions.home;
  expect(home.proposed).toBe('');
  expect(home.marker).toBe(bx.MARKER('home market'));
  expect(home.corroborators.length).toBe(2);
  expect(home.notes.join(' ')).toMatch(/never propose a market on their own/i);
  // And the pure function agrees, driven directly.
  const direct = bx.homeMarket({ homeUrl: 'https://acme.com/', regions: [], legal: [], homeCurrencies: [], lang: { code: 'IN', signal: 'html:<html lang>', source_url: 'https://acme.com/', evidence: 'x' } });
  expect(direct.proposed).toBe('');
});

test('the storefront platform\'s own declared country is a home signal, read off the crawl', async () => {
  const site = {
    'https://acme.com/': html(`<!doctype html><html><head><title>Acme</title>
      <script>window.Shopify = window.Shopify || {}; Shopify.shop = "acme-store.myshopify.com"; Shopify.country = "IN"; Shopify.locale = "en";</script>
      </head><body><h1>Acme</h1></body></html>`),
  };
  const r = await run('https://acme.com/', site);
  expect(r.fields.storefront.detected).toBe(true);
  expect(r.fields.storefront.platform.id).toBe('shopify');
  expect(r.fields.storefront.platform.store_country).toBe('IN');
  expect(r.fields.storefront.platform.store_locale).toBe('en');
  const home = r.fields.regions.home;
  expect(home.proposed).toBe('IN');
  expect(home.signals.map((s) => s.signal)).toContain('html:Shopify.country');
  // The unit reader, on its own: nothing published, nothing returned.
  expect(sd.storeLocaleFrom('<html><body>hello</body></html>', 'https://x/')).toBeNull();
});

test('EUR on the home page names a currency zone, not a home market', () => {
  const out = bx.homeMarket({ homeUrl: 'https://acme.com/', regions: [], legal: [], homeCurrencies: [{ currency: 'EUR', signal: 'json-ld:Offer.priceCurrency', source_url: 'https://acme.com/' }] });
  expect(out.proposed).toBe('');
  expect(out.corroborators).toEqual([]);                       // EUR names no country at all
  expect(out.notes.join(' ')).toMatch(/EUR .* priced in by many countries/);
});

test('review finding 4: USD alone never proposes US, and beside a real signal it manufactures no conflict', async () => {
  // A global .com storefront pricing in USD, and nothing else published.
  const usdOnly = {
    'https://acme.com/': html(`<!doctype html><html><head><title>Acme</title>${product('USD')}</head><body><h1>Acme</h1></body></html>`),
  };
  const r = await run('https://acme.com/', usdOnly);
  expect(r.fields.regions.home.proposed).toBe('');
  expect(r.fields.regions.home.marker).toBe(bx.MARKER('home market'));
  expect(r.fields.regions.home.considered).toEqual([]);         // nothing strong was even considered
  expect(r.fields.regions.home.corroborators.map((c) => c.signal + '=' + c.code)).toEqual(['json-ld:Offer.priceCurrency (USD)=US']);
  expect(r.fields.regions.home.notes.join(' ')).toMatch(/USD .* priced in by many countries/);
  expect(r.fields.regions.candidates).toEqual([]);              // no region was invented from a currency
  // A UK business that prices in dollars: GB from its own suffix, no conflict.
  const ukUsd = {
    'https://acme.co.uk/': html(`<!doctype html><html><head><title>Acme</title>${product('USD')}</head><body><h1>Acme</h1></body></html>`),
  };
  const uk = await run('https://acme.co.uk/', ukUsd);
  expect(uk.fields.regions.home.proposed).toBe('GB');
  expect(uk.fields.regions.home.conflict).toBeNull();
  expect(uk.fields.regions.candidates.map((c) => c.code + ':' + c.currency)).toEqual(['GB:']);   // USD is not GB's declared currency
  // The table itself: the country-unique currencies stay, the zone ones are out.
  expect(bx.CURRENCY_COUNTRY.USD).toBeUndefined();
  expect(bx.CURRENCY_COUNTRY.EUR).toBeUndefined();
  for (const cur of ['INR', 'GBP', 'JPY', 'AUD', 'CAD']) expect(bx.CURRENCY_COUNTRY[cur], cur).toBeTruthy();
});

test('review finding 3: x-default is matched on the query string, so ?country= alternates resolve to ONE region', async () => {
  // Storefronts that publish their regions as the same path with a country
  // parameter. A comparison that dropped the query read every alternate as
  // the x-default page and proposed nothing.
  const site = {
    'https://acme.com/': html(`<!doctype html><html><head><title>Acme</title>
      <link rel="alternate" hreflang="en-US" href="https://acme.com/?country=US">
      <link rel="alternate" hreflang="en-GB" href="https://acme.com/?country=GB&utm=x">
      <link rel="alternate" hreflang="x-default" href="https://acme.com/?utm=x&country=GB">
      </head><body><h1>Acme</h1></body></html>`),
  };
  const r = await run('https://acme.com/', site);
  const home = r.fields.regions.home;
  expect(home.proposed).toBe('GB');
  expect(home.signals.map((s) => s.signal)).toEqual(['link:alternate[hreflang=x-default]']);
  expect(home.notes.join(' ')).not.toMatch(/shared by more than one/);
  // The comparison itself: order-insensitive on keys, sensitive on values.
  expect(bx.sameUrl('https://acme.com/?a=1&b=2', 'https://ACME.com/?b=2&a=1')).toBe(true);
  expect(bx.sameUrl('https://acme.com/?country=US', 'https://acme.com/?country=GB')).toBe(false);
  expect(bx.sameUrl('https://acme.com/', 'https://acme.com')).toBe(true);
});

test('generic suffixes are not country signals; the data table decides', () => {
  for (const host of ['acme.com', 'acme.co', 'acme.io', 'acme.ai', 'acme.me', 'acme.shop', 'acme.eu']) {
    expect(bx.ccTldOf(host).code, host).toBe('');
  }
  expect(bx.ccTldOf('www.acme.co.uk')).toEqual({ code: 'GB', suffix: 'co.uk' });
  expect(bx.ccTldOf('acme.in')).toEqual({ code: 'IN', suffix: 'in' });
  expect(bx.ccTldOf('shop.acme.com.au')).toEqual({ code: 'AU', suffix: 'com.au' });
  expect(bx.countryCodeOf('India')).toBe('IN');
  expect(bx.countryCodeOf('gb')).toBe('GB');
  expect(bx.countryCodeOf('Narnia')).toBe('');
});

test('the record persists exactly one home, and the runtime resolves it', () => {
  const two = core.normalizeRegions([{ code: 'us', home: true }, { code: 'in', home: true }, { code: 'uk' }]);
  expect(two.map((r) => r.home)).toEqual([true, false, false]);
  const none = core.normalizeRegions([{ code: 'us' }, { code: 'in' }]);
  expect(none.some((r) => r.home)).toBe(false);
  expect(rt.homeRegion({ regions: [{ code: 'US' }, { code: 'IN', home: true }] })).toBe('IN');   // the flag wins over list order
  expect(rt.homeRegion({ regions: [{ code: 'US' }, { code: 'IN' }] })).toBe('US');               // else the record leads with it
  expect(rt.homeRegion({ regions: [] })).toBe('');                                               // a gap, not a literal
  expect(rt.homeRegion(null)).toBe('');
  // Readiness reports a missing home market rather than promoting a row.
  const r = core.readiness({ name: 'X', regions: [{ code: 'US' }, { code: 'IN' }] });
  expect(r.missing.map((m) => m.field)).toContain('home market');
});

test('tenant zero declares its regions and its home market', () => {
  const zero = rt.defaultBrand();
  expect(zero.regions.map((r) => r.code)).toEqual(expect.arrayContaining(['US', 'UK', 'IN', 'GLOBAL']));
  expect(zero.regions.filter((r) => r.home === true).map((r) => r.code)).toEqual(['IN']);
  expect(rt.homeRegion(zero)).toBe('IN');
  // The brand block the generators read says which market is home.
  expect(rt.brandBlock(zero)).toMatch(/IN \(HOME market\)/);
  // Every shipped preset with regions names one home.
  const dir = path.join(ROOT, 'data', 'brands', 'presets');
  let withRegions = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!p.regions || !p.regions.length) continue;
    withRegions++;
    expect(p.regions.filter((r) => r.home === true).length, f).toBe(1);
  }
  expect(withRegions).toBeGreaterThanOrEqual(5);
});

/* ═══════════════════════════════════════════════════════════════════════════
   (b) THE PAGES, in Chromium, for three brands
   ═══════════════════════════════════════════════════════════════════════════ */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

/* The brands. The Times of India preset is what the live screenshot showed;
   tenant zero is the record every default used to be hardcoded around; and a
   brand with no regions is the state nothing may paper over with US. */
const TOI = Object.assign({ id: 'ws_toi' }, JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands/presets/times-of-india.json'), 'utf8')));
const ZERO = Object.assign({ id: 'ws_zero' }, JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands/_default.json'), 'utf8')));
const NONE = { id: 'ws_none', slug: 'noregions', name: 'No Regions Co', palette: { primary: '#1F4E79', accent: '#C8102E', ink: '#1A1A1A', surface: '#FFFFFF' }, typography: { heading: { family: 'Inter' }, body: { family: 'Inter' } }, voice: {}, regions: [] };

async function open(page, brand, file) {
  await page.route('**/api/public-config**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand, workspaces: [] }),
  }));
  await page.goto(base + '/' + file, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded === true, null, { timeout: 20000 });
}

const codesOf = (b) => b.regions.map((r) => String(r.code).toUpperCase());
const homeOf = (b) => { const h = b.regions.find((r) => r.home); return h ? String(h.code).toUpperCase() : (b.regions[0] ? String(b.regions[0].code).toUpperCase() : ''); };

test('the rail reads the brand\'s home market', async ({ page }) => {
  await open(page, TOI, 'about.html');
  await expect(page.locator('#lifecycle-nav .lnav-region .rgn-solo')).toContainText('India (IN)');
  expect(await page.evaluate(() => window.RegionContext.home)).toBe('IN');

  await open(page, ZERO, 'about.html');
  const chips = page.locator('#lifecycle-nav .lnav-region .rgn-chip');
  await expect(chips).toHaveCount(codesOf(ZERO).length);
  await expect(page.locator('#lifecycle-nav .lnav-region .rgn-chip[data-region-set="IN"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#lifecycle-nav .lnav-region .rgn-chip[data-region-set="IN"]')).toHaveAttribute('data-home', '1');
  await expect(page.locator('#lifecycle-nav .lnav-region .rgn-chip[data-region-set="US"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.RegionContext.region)).toBe('IN');

  await open(page, NONE, 'about.html');
  await expect(page.locator('#lifecycle-nav .lnav-region .rgn-none')).toContainText('No market is configured');
  expect(await page.evaluate(() => window.RegionContext.home)).toBe('');
});

test('/research: both tab rows are the brand\'s regions and open on its home study', async ({ page }) => {
  let measured = 0;
  for (const brand of [TOI, ZERO]) {
    // A US deep link, exactly what the rail's "US Study" row sends. A brand
    // that has no US market lands on its HOME study, not on a US one.
    await open(page, brand, 'research.html?region=us');
    const codes = codesOf(brand); const home = homeOf(brand);
    const study = page.locator('#msRegionTabs .rtab[data-region]');
    await expect(study).toHaveCount(codes.length);
    const bench = page.locator('#regionTabs .rtab[data-region]');
    await expect(bench).toHaveCount(codes.length);
    measured += codes.length * 2;
    expect((await study.evaluateAll((els) => els.map((e) => e.getAttribute('data-region')))).sort()).toEqual(codes.slice().sort());
    const on = await study.evaluateAll((els) => els.filter((e) => e.classList.contains('on')).map((e) => e.getAttribute('data-region')));
    expect(on, brand.name + ' study tab on').toEqual([codes.includes('US') ? 'US' : home]);
    // The visible panel is the one for that market, and only that one.
    const visible = await page.locator('.ms-panel[data-ms-region]').evaluateAll((els) => els.filter((e) => e.style.display !== 'none').map((e) => e.getAttribute('data-ms-region')));
    expect(visible.length).toBe(1);
    expect(await page.evaluate((v) => window.RegionContext.family(v), visible[0])).toBe(await page.evaluate((v) => window.RegionContext.family(v), on[0]));
    // The visible panel is rendered for THIS brand, not for the brand the page was built for.
    const visibleText = await page.locator('.ms-panel[data-ms-region]').evaluateAll((els) => els.filter((e) => e.style.display !== 'none').map((e) => e.textContent).join('\n'));
    expect(visibleText).toContain(brand.name);
    expect(visibleText).not.toMatch(/KNICKGASM position/);   // the built-in tenant-zero card is gone for every brand
    const benchOn = await bench.evaluateAll((els) => els.filter((e) => e.classList.contains('on')).map((e) => e.getAttribute('data-region')));
    expect(benchOn).toEqual([home]);
    await expect(page.locator('#rgLabel')).toHaveText(await page.evaluate((h) => window.RegionContext.name(h), home));
  }
  expect(measured).toBeGreaterThanOrEqual(10);

  // A brand with no regions: the marker, no tabs, no US, no panel shown.
  await open(page, NONE, 'research.html');
  await expect(page.locator('#msRegionTabs .rtab[data-region]')).toHaveCount(0);
  await expect(page.locator('#msRegionTabs [data-region-none]')).toContainText('[DATA REQUIRED BEFORE LAUNCH: regions');
  await expect(page.locator('#regionTabs [data-region-none]')).toHaveCount(1);
  expect(await page.locator('#msRegionTabs').textContent()).not.toMatch(/\bUS\b/);
  const shown = await page.locator('.ms-panel[data-ms-region]').evaluateAll((els) => els.filter((e) => e.style.display !== 'none').length);
  expect(shown).toBe(0);
});

test('/retention-playbook: region chips are the brand\'s, home selected, All only when there is a choice', async ({ page }) => {
  await open(page, TOI, 'retention-playbook.html');
  const toi = page.locator('#mktchips [data-mkt]');
  await expect(toi).toHaveCount(1);                       // one market: no "All"
  await expect(toi.first()).toHaveAttribute('data-mkt', 'IN');
  await expect(toi.first()).toHaveClass(/\bon\b/);
  expect(await page.locator('#mktchips').textContent()).not.toMatch(/\bUS\b/);

  await open(page, ZERO, 'retention-playbook.html');
  const zero = page.locator('#mktchips [data-mkt]');
  await expect(zero).toHaveCount(codesOf(ZERO).length + 1);   // All + each region
  const on = await zero.evaluateAll((els) => els.filter((e) => e.classList.contains('on')).map((e) => e.getAttribute('data-mkt')));
  expect(on).toEqual(['IN']);
  await expect(page.locator('#mktchips [data-mkt="IN"]')).toHaveAttribute('data-home', '1');

  await open(page, NONE, 'retention-playbook.html');
  await expect(page.locator('#mktchips [data-mkt]')).toHaveCount(0);
  await expect(page.locator('#mktchips')).toContainText('[DATA REQUIRED BEFORE LAUNCH: regions');
});

test('the Studio\'s target-market chips are the brand\'s, home on, and its state follows', async ({ page }) => {
  await open(page, TOI, 'lifecycle_mailer_architect_v34.html');
  await expect(page.locator('#mktChips .mkt-chip')).toHaveCount(1);
  await expect(page.locator('#mktChips .mkt-chip[data-mkt="IN"]')).toHaveClass(/\bon\b/);
  expect(await page.evaluate(() => ({ m: window.S.market, ms: window.S.markets, a: window.S.activeMarket }))).toEqual({ m: 'IN', ms: ['IN'], a: 'IN' });
  expect(await page.locator('#mktChips').textContent()).not.toMatch(/United States/);

  await open(page, ZERO, 'lifecycle_mailer_architect_v34.html');
  await expect(page.locator('#mktChips .mkt-chip')).toHaveCount(codesOf(ZERO).length);
  const on = await page.locator('#mktChips .mkt-chip').evaluateAll((els) => els.filter((e) => e.classList.contains('on')).map((e) => e.getAttribute('data-mkt')));
  expect(on).toEqual(['IN']);
  expect(await page.evaluate(() => window.S.market)).toBe('IN');
  // resetAll goes back to the HOME market, not to US.
  await page.evaluate(() => { window.toggleMarket('US', document.querySelector('#mktChips .mkt-chip[data-mkt="US"]')); window.resetAll(); });
  expect(await page.evaluate(() => window.S.markets)).toEqual(['IN']);

  await open(page, NONE, 'lifecycle_mailer_architect_v34.html');
  await expect(page.locator('#mktChips .mkt-chip')).toHaveCount(0);
  await expect(page.locator('#mktChips')).toContainText('[DATA REQUIRED BEFORE LAUNCH: regions');
  expect(await page.evaluate(() => window.S.market)).toBe('');
});

test('/calendar: the market chips are the brand\'s and the plan is asked for its home market', async ({ page }) => {
  const asked = [];
  await page.route('**/api/calendar**', async (route) => {
    try { asked.push(JSON.parse(route.request().postData() || '{}').markets); } catch (_) { asked.push(null); }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, plan: [], meta: {}, markets: [] }) });
  });
  await open(page, TOI, 'calendar.html');
  await expect(page.locator('#marketChips .filter-chip')).toHaveCount(1);
  await expect(page.locator('#marketChips .filter-chip[data-market="IN"]')).toHaveClass(/\bactive\b/);
  await expect.poll(() => asked.length, { timeout: 10000 }).toBeGreaterThan(0);
  expect(asked[0]).toEqual(['IN']);     // never ['US']

  await open(page, ZERO, 'calendar.html');
  await expect(page.locator('#marketChips .filter-chip')).toHaveCount(codesOf(ZERO).length);
  const active = await page.locator('#marketChips .filter-chip').evaluateAll((els) => els.filter((e) => e.classList.contains('active')).map((e) => e.getAttribute('data-market')));
  expect(active).toEqual(['IN']);

  await open(page, NONE, 'calendar.html');
  await expect(page.locator('#marketChips .filter-chip')).toHaveCount(0);
  await expect(page.locator('#marketChips')).toContainText('[DATA REQUIRED BEFORE LAUNCH: regions');
});

test('the aggregating pages offer All plus the brand\'s regions, never a typed list', async ({ page }) => {
  // dashboard.html and knowledge-base.html aggregate across markets, so All
  // stays their default; the regions beside it are the brand's own.
  await open(page, TOI, 'dashboard.html');
  await expect(page.locator('#regionChips .filter-chip')).toHaveCount(2);      // All + IN
  await expect(page.locator('#regionChips .filter-chip[data-region="IN"]')).toHaveCount(1);
  expect(await page.locator('#regionChips').textContent()).not.toMatch(/\bUS\b/);

  await open(page, TOI, 'knowledge-base.html');
  await expect(page.locator('#kbRegions .region-chip[data-region]')).toHaveCount(2);   // All + IN
  await expect(page.locator('#kbRegions .region-chip[data-region="IN"]')).toHaveCount(1);
  expect(await page.locator('#kbRegions').textContent()).not.toMatch(/\bUS\b/);

  await open(page, ZERO, 'landing-pages.html');
  const groups = page.locator('.regions[data-regions]');
  await expect(groups).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const chips = groups.nth(i).locator('.region-chip[data-region]');
    await expect(chips).toHaveCount(codesOf(ZERO).length);
    const on = await chips.evaluateAll((els) => els.filter((e) => e.classList.contains('active')).map((e) => e.getAttribute('data-region')));
    expect(on).toEqual(['IN']);
  }
});

/* ── the wizard: the two review findings on onboarding.html ─────────────── */

/* Serve the wizard for `brand` with every brand API op answered in-page, and
   hand back the calls it made so a test can assert what LEFT the page. */
async function openWizard(page, brand, opts) {
  const o = opts || {};
  const calls = [];
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/api/public-config**', async (route) => {
    const u = new URL(route.request().url());
    const op = u.searchParams.get('op') || '';
    let body = null; try { body = JSON.parse(route.request().postData() || 'null'); } catch (_) { body = null; }
    calls.push({ op, body });
    let payload;
    if (op === 'extract') payload = o.report || { ok: false, message: 'no report in this test' };
    else if (op === 'catalog-import') payload = { ok: true, imported: 3, skipped: 0 };
    else if (op === 'save') payload = { ok: true, brand: Object.assign({}, brand, { id: brand.id }) };
    else payload = { ok: true, brand, workspaces: [], active_id: brand.id, pack: null, presets: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.goto(base + '/onboarding.html', { waitUntil: 'load' });
  await page.locator('.step-pip[data-step="1"]').waitFor({ state: 'visible', timeout: 15000 });
  // boot() reads the brand asynchronously and retitles the page once it has
  // applied it; acting before that races the record's own regions.
  await expect(page.locator('#title')).toContainText('Edit ' + brand.name, { timeout: 15000 });
  return calls;
}
/* force:true and a visible-wait first, for the reason onboarding-review-loop.spec.js records. */
async function clickPip(page, n) {
  const pip = page.locator(`.step-pip[data-step="${n}"]`);
  await pip.waitFor({ state: 'visible', timeout: 15000 });
  await pip.click({ force: true, timeout: 15000 });
}
const WIZ = { palette: { primary: '#1F4E79', accent: '#C8102E', ink: '#1A1A1A', surface: '#FFFFFF', surface_alt: '#F6F7F9', muted: '#5A6270' }, typography: { heading: { family: 'Inter' }, body: { family: 'Inter' } }, voice: {}, brand_data: {} };
const IN_BRAND = Object.assign({}, WIZ, { id: 'ws_in', slug: 'inco', name: 'IN Co', website: 'https://acme.com', regions: [{ code: 'IN', currency: 'INR', symbol: '₹', store_url: 'https://acme.com', home: true, pdp_pattern: '{base}/products/{handle}', collection_pattern: '{base}/collections/{slug}' }] });
/* A real report from the extractor, so the wizard is driven with the exact
   shape it receives in production rather than a hand-built stand-in. */
async function reportFor(start, site) {
  const r = await run(start, site);
  r.fields.palette.validation = { ok: true, errors: [], warnings: [], contrast: {} };   // runExtract adds this; extractBrand alone does not
  return r;
}

test('review finding 1: the catalogue import refuses without a home market, and imports for the home when there is one', async ({ page }) => {
  // A NEW brand starts with no regions. The import used to fall to "us".
  const calls = await openWizard(page, Object.assign({}, WIZ, { id: 'ws_none', slug: 'noregions', name: 'No Regions Co', website: 'https://noregions.example', regions: [] }));
  await clickPip(page, 5);
  const btn = page.locator('#doImport');
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveAttribute('aria-disabled', 'true');
  const gate = page.locator('#impGate');
  await expect(gate).toBeVisible();
  // The marker names the brand, never "all, all" - the spec's `field, product,
  // region` slots are filled only where they apply (the marker builder that
  // arrived with the device store), and this gate goes through that builder.
  await expect(gate).toContainText('[DATA REQUIRED BEFORE LAUNCH: home market, No Regions Co]');
  await expect(gate).not.toContainText('all, all');
  // The reason is a statement in the accent rule, not a failure frame.
  await expect(page.locator('#impStatus .vh-failure')).toHaveCount(0);
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-accent-text').trim());
  const gateColor = await gate.evaluate((el) => getComputedStyle(el).color);
  const toRgb = (hex) => { const h = hex.replace('#', ''); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; };
  if (/^#[0-9a-f]{6}$/i.test(accent)) expect(gateColor).toBe(toRgb(accent));
  // Even with the control forced enabled, the handler itself refuses: nothing leaves.
  await page.fill('#impUrl', 'https://noregions.example');
  await page.evaluate(() => { const b = document.getElementById('doImport'); b.disabled = false; b.click(); });
  await page.waitForTimeout(400);
  expect(calls.filter((c) => c.op === 'catalog-import')).toHaveLength(0);
  await expect(btn).toBeDisabled();                       // re-gated by the refusal
  await expect(page.locator('#impStatus .vh-failure')).toHaveCount(0);

  // The same brand with a home market: the request carries THAT market.
  const calls2 = await openWizard(page, Object.assign({}, IN_BRAND, { regions: IN_BRAND.regions.concat([{ code: 'US', currency: 'USD', symbol: '$', store_url: 'https://acme.com/us' }]) }));
  await clickPip(page, 5);
  await expect(page.locator('#doImport')).toBeEnabled();
  await expect(page.locator('#impGate')).toBeHidden();
  await page.fill('#impUrl', 'https://acme.com');
  await page.locator('#doImport').click();
  await expect.poll(() => calls2.filter((c) => c.op === 'catalog-import').length, { timeout: 10000 }).toBe(1);
  expect(calls2.find((c) => c.op === 'catalog-import').body.region).toBe('in');
});

test('review finding 2: a re-read that proposes no home keeps the operator\'s home; a new proposal replaces it and says so', async ({ page }) => {
  // The site publishes regions (en-US / en-GB) but no strong home signal.
  const noProposal = await reportFor('https://acme.com/', {
    'https://acme.com/': html(`<!doctype html><html><head><title>Acme</title>
      <link rel="alternate" hreflang="en-US" href="https://acme.com/us">
      <link rel="alternate" hreflang="en-GB" href="https://acme.com/gb">
      </head><body><h1>Acme</h1></body></html>`),
  });
  expect(noProposal.fields.regions.candidates.map((c) => c.code).sort()).toEqual(['GB', 'US']);
  expect(noProposal.fields.regions.home.proposed).toBe('');

  let calls = await openWizard(page, IN_BRAND, { report: noProposal });
  await page.fill('#xUrl', 'https://acme.com');
  await page.locator('#xRun').click();
  await expect.poll(() => calls.filter((c) => c.op === 'extract').length, { timeout: 10000 }).toBe(1);
  await clickPip(page, 5);
  await page.locator('[data-xa="regions"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-xa="regions"]').click();
  const codes = await page.locator('#regions [data-r="code"]').evaluateAll((els) => els.map((e) => e.value).sort());
  expect(codes).toEqual(['GB', 'IN', 'US']);                     // the operator's own market is not dropped
  const homeChecked = () => page.locator('#regions [data-home-i]').evaluateAll((els) => els.filter((e) => e.checked).map((e) => e.closest('.region-row').querySelector('[data-r="code"]').value));
  expect(await homeChecked()).toEqual(['IN']);                    // and is still home
  // What gets PERSISTED: press Next, read the save.
  await page.locator('[data-go="next"]').click();
  await expect.poll(() => calls.filter((c) => c.op === 'save').length, { timeout: 10000 }).toBeGreaterThan(0);
  let saved = calls.filter((c) => c.op === 'save').pop().body.brand;
  expect(saved.regions.filter((r) => r.home === true).map((r) => r.code)).toEqual(['IN']);
  expect(saved.brand_data.brand_extraction.applied['regions.home']).toMatchObject({ value: 'IN', origin: 'user' });

  // A re-read whose own signals DO propose a home (.co.uk): GB replaces IN, and the record says what it replaced.
  const proposal = await reportFor('https://acme.co.uk/', {
    'https://acme.co.uk/': html(`<!doctype html><html><head><title>Acme</title>
      <link rel="alternate" hreflang="en-GB" href="https://acme.co.uk/">
      <link rel="alternate" hreflang="en-US" href="https://acme.co.uk/us">
      </head><body><h1>Acme</h1></body></html>`),
  });
  expect(proposal.fields.regions.home.proposed).toBe('GB');
  calls = await openWizard(page, IN_BRAND, { report: proposal });
  await page.fill('#xUrl', 'https://acme.co.uk');
  await page.locator('#xRun').click();
  await expect.poll(() => calls.filter((c) => c.op === 'extract').length, { timeout: 10000 }).toBe(1);
  await clickPip(page, 5);
  await page.locator('[data-xa="regions"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-xa="regions"]').click();
  expect(await homeChecked()).toEqual(['GB']);
  await page.locator('[data-go="next"]').click();
  await expect.poll(() => calls.filter((c) => c.op === 'save').length, { timeout: 10000 }).toBeGreaterThan(0);
  saved = calls.filter((c) => c.op === 'save').pop().body.brand;
  expect(saved.regions.filter((r) => r.home === true).map((r) => r.code)).toEqual(['GB']);
  expect(saved.brand_data.brand_extraction.applied['regions.home']).toMatchObject({ value: 'GB', replaced: 'IN' });
});

test('a page chip spelt "India" is bridged to the record\'s IN', async ({ page }) => {
  // Before, codeOf() uppercased and stripped, so "India" became INDIA and
  // matched nothing: the India chips on four pages were never driven.
  await page.route('**/legacy.html', (route) => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><body><div id="chips"><button class="chip on" data-region="US">US</button><button class="chip" data-region="India">India</button></div>'
      + '<script src="/brand-context.js"></script><script src="/region-context.js"></script>',
  }));
  await page.route('**/api/public-config**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: ZERO, workspaces: [] }),
  }));
  await page.goto(base + '/legacy.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded === true, null, { timeout: 10000 });
  await page.locator('[data-region="India"]').click();
  expect(await page.evaluate(() => window.RegionContext.region)).toBe('IN');
  expect(await page.evaluate(() => window.RegionContext.resolve('india'))).toBe('IN');
  expect(await page.evaluate(() => window.RegionContext.resolve('GB'))).toBe('UK');
  expect(await page.evaluate(() => window.RegionContext.resolve('JP'))).toBe('');
});
