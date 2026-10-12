// @ts-check
/**
 * scripts/market-probe.js — which of a brand's regional stores can be read
 * from where the reader runs (2026-10-11).
 *
 * The operator chose readers in each country for every brand whose regional
 * stores send a server elsewhere. Before a server is created, the probe says
 * which markets of which brands are affected. Executed here over the fixture
 * Lenskart shape (tests/lib/catalog-fixture-stores.js lensworld.example):
 * every locale's store from the site's own hreflang and sitemaps, and, with
 * geo='US', the India (root) product pages sent to /en-us/ in USD.
 */
const { test, expect } = require('@playwright/test');
const { startStores } = require('./lib/catalog-fixture-stores.js');

let st;
test.beforeAll(async () => { st = await startStores(); st.install(); });
test.afterAll(async () => { if (st) { st.restore(); await st.close(); } });
test.beforeEach(() => st.reset());

const probe = () => require('../scripts/market-probe.js');

test('a store that sends one market\'s pages to another market\'s store is named, per market, and the readable ones are not', async () => {
  st.stores['lensworld.example'].geo = 'US';
  const r = await probe().probeBrand({ name: 'Lensworld', url: 'https://lensworld.example', region: 'IN' }, { steps: 2, stepMs: 20000 });
  expect(r.error).toBe('');
  const by = Object.fromEntries(r.markets.map((m) => [m.code.toUpperCase(), m]));
  expect(Object.keys(by).sort()).toEqual(['AE', 'IN', 'SA', 'US']);
  expect(by.IN.verdict, JSON.stringify(by.IN)).toBe('geo-redirect');
  expect(by.IN.why).toMatch(/sent to the (US|\/en-us) store/);
  expect(by.US.verdict, JSON.stringify(by.US)).toBe('reachable');
  // Nothing pretended a location.
  const hits = st.hits['lensworld.example'] || [];
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.filter((h) => h.cookie || (h.lang && h.lang !== '*') || h.forwarded), 'a request named a location (cookie, Accept-Language or X-Forwarded-For)').toEqual([]);
  expect(new Set(hits.map((h) => h.ua)).size).toBe(1);
  // The summary names the market and the brand.
  const md = probe().summary([r], 'the fixture');
  expect(md).toMatch(/\| IN \| Lensworld \(geo-redirect\) \|/);
});

test('with no geo-redirect, every market of the same store reads as reachable', async () => {
  const r = await probe().probeBrand({ name: 'Lensworld', url: 'https://lensworld.example', region: 'IN' }, { steps: 1, stepMs: 20000 });
  const verdicts = Object.fromEntries(r.markets.map((m) => [m.code.toUpperCase(), m.verdict]));
  expect(verdicts.IN).toBe('reachable');
  expect(Object.values(verdicts).filter((v) => v === 'geo-redirect')).toEqual([]);
});

test('a store page that redirects to another country\'s locale path is classified as a geo-redirect, one that answers is reachable', () => {
  const { classify } = probe();
  const m = { code: 'in', country: 'IN', store_url: 'https://shop.example', prefix: '' };
  expect(classify(m, { status: 200, hops: [{ status: 302 }, { status: 200 }], final: 'https://shop.example/en-us/' }).verdict).toBe('geo-redirect');
  expect(classify(m, { status: 200, hops: [{ status: 200 }], final: 'https://shop.example/' }).verdict).toBe('reachable');
  expect(classify({ code: 'ae', country: 'AE', store_url: 'https://shop.example/en-ae', prefix: '/en-ae' }, { status: 200, hops: [{ status: 302 }, { status: 200 }], final: 'https://shop.example/en-us/' }).verdict).toBe('geo-redirect');
  expect(classify(m, { status: 403, hops: [{ status: 403 }], final: 'https://shop.example/' }).verdict).toBe('blocked');
  expect(classify(m, { robots: true, hops: [] }).verdict).toBe('robots');
});

test('the regional store probe workflow is dispatch-only and read-only, and runs the probe script', () => {
  const fs = require('fs'), path = require('path');
  const YAML = require('yaml');
  const raw = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/market-probe.yml'), 'utf8');
  const wf = YAML.parse(raw);
  expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
  expect(wf.permissions).toEqual({ contents: 'read' });
  expect(raw).not.toMatch(/secrets\./);
  for (const job of Object.values(wf.jobs)) {
    expect(job.permissions).toBeUndefined();
    for (const s of job.steps) {
      if (s.run) expect(s.run, 'an input interpolated into a shell').not.toMatch(/\$\{\{/);
      if (s.uses && /checkout/.test(s.uses)) expect(s.with && s.with['persist-credentials']).toBe(false);
    }
  }
  expect(wf.jobs.probe.steps.some((s) => s.run && /node scripts\/market-probe\.js --presets/.test(s.run))).toBe(true);
});

test('a store whose robots.txt disallows something else is not reported as disallowed (the probe passes robots.txt the full URL)', async () => {
  // lensworld.example publishes a robots.txt; its store pages are allowed.
  const r = await probe().probeBrand({ name: 'Lensworld', url: 'https://lensworld.example', region: 'IN' }, { steps: 0 });
  expect(r.markets.length).toBeGreaterThan(0);
  expect(r.markets.filter((m) => m.verdict === 'robots'), JSON.stringify(r.markets)).toEqual([]);
});

test('a site with no regional store still says what its home page answered from here', async () => {
  const r = await probe().probeBrand({ name: 'Emptyshop', url: 'https://emptyshop.example', region: 'IN' }, { steps: 0 });
  if (!r.markets.length) {
    expect(r.home && r.home.verdict, JSON.stringify(r)).toBeTruthy();
    expect(probe().summary([r], 'the fixture')).toMatch(/Its home page from here: /);
  }
});
