/**
 * A market is a country or a zone, never a word on a link (2026-10-24).
 * ---------------------------------------------------------------------------
 * Production, The Economic Times active: the rail's MARKET chips read "OK",
 * "TV", "IN", "US". The site reader took ANY two-letter link text as a country
 * code, so a "TV" link to /tv/ (the paper's video section) became Tuvalu's
 * store, and "OK" - no country at all - was saved as a market too.
 *
 * Executed here:
 *   1. the shipped site reader over a news-site page: "TV" and "OK" links,
 *      an hreflang naming no country, propose nothing; a link that NAMES a
 *      country ("India" -> /in/) still does;
 *   2. the shipped save rule drops a code that is no country or zone;
 *   3. the browser's market list (region-context.js in Chromium) leaves out a
 *      stored "OK", and its rule answers exactly as the server's.
 * ---------------------------------------------------------------------------
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const extract = require('../api/_shared/brand-extract.js');
const locale = require('../api/_shared/brand-locale.js');
const core = require('../api/_shared/brand-workspace-core.js');

const CODES = ['OK', 'TV', 'IN', 'US', 'UK', 'GB', 'EU', 'ME', 'GLOBAL', 'IND', 'TR', 'XX', 'ZZ', 'QQ', 'AE', 'XK'];

test('the site reader takes a country from a link only when the link NAMES the country', () => {
  const html = '<html><head>' +
    '<link rel="alternate" hreflang="en-ok" href="https://news.example/ok/">' +
    '</head><body>' +
    '<a href="https://news.example/tv/">TV</a>' +
    '<a href="https://news.example/ok/">OK</a>' +
    '<a href="https://news.example/in/">India</a>' +
    '</body></html>';
  const r = extract.regionCandidates({ html, url: 'https://news.example/', meta: {}, ld: [] });
  expect(r.regions.map((x) => x.code), 'a two-letter word on a link was read as a market').toEqual(['IN']);
});

test('a declared address or area served of "OK" proposes no home market', () => {
  expect(extract.countryCodeOf('OK')).toBe('');
  expect(extract.countryCodeOf('IN')).toBe('IN');
  expect(extract.countryCodeOf('India')).toBe('IN');
  const ld = [{ '@type': 'Organization', address: { '@type': 'PostalAddress', addressCountry: 'OK' }, areaServed: 'OK' }];
  const r = extract.regionCandidates({ html: '<html><body></body></html>', url: 'https://news.example/', meta: {}, ld });
  expect(r.regions.map((x) => x.code)).toEqual([]);
  const home = extract.homeMarket({ regions: r.regions, legal: { addressCountry: 'OK' }, homeUrl: 'https://news.example/', homeCurrencies: [] });
  expect(home.proposed || '').toBe('');
});

test('a saved market is a real country or a zone: "OK" is dropped, every real market is kept', () => {
  const rows = core.normalizeRegions([{ code: 'IN', home: true }, { code: 'OK' }, { code: 'XX' }, { code: 'US' }, { code: 'UK' }, { code: 'EU' }, { code: 'GLOBAL' }, { code: 'TR' }]);
  expect(rows.map((r) => r.code)).toEqual(['IN', 'US', 'UK', 'EU', 'GLOBAL', 'TR']);
  expect(rows[0].home).toBe(true);
});

test('the rail never offers a stored "OK", and the browser rule answers as the server rule does', async ({ page }) => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/region-context.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(ROOT, 'region-context.js'))); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await page.addInitScript(() => {
      const brand = { id: 'b1', name: 'Paper', regions: [{ code: 'OK' }, { code: 'IN', home: true }, { code: 'US' }] };
      window.BrandContext = { brand, onChange(fn) { fn({ brand }); }, ready: () => Promise.resolve() };
    });
    await page.goto('http://127.0.0.1:' + srv.address().port + '/');
    await page.addScriptTag({ url: '/region-context.js' });
    await page.waitForFunction(() => window.RegionContext && window.RegionContext.options().length > 0);
    const offered = await page.evaluate(() => window.RegionContext.options().map((o) => o.code));
    expect(offered).toEqual(['IN', 'US']);
    const browser = await page.evaluate((codes) => codes.map((c) => window.RegionContext.isMarket(c)), CODES);
    expect(browser).toEqual(CODES.map((c) => locale.isMarket(c)));
    expect(CODES.filter((c) => locale.isMarket(c))).toEqual(['TV', 'IN', 'US', 'UK', 'GB', 'EU', 'ME', 'GLOBAL', 'IND', 'TR', 'AE', 'XK']);
  } finally {
    await new Promise((r) => { try { srv.closeAllConnections(); } catch (_) {} srv.close(() => r()); });
  }
});
