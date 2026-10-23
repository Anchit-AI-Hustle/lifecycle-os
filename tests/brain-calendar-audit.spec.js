'use strict';
/**
 * Smart Brain calendar creation, executed (2026-10-23). Each case is a defect
 * the calendar audit found by RUNNING the planner, kept here so it stays fixed:
 *
 *   1. offering slots rotated on the offset from TODAY, so every daily sync
 *      gave a date a new cohort and id, and duplicate slots piled up beside
 *      the old ones;
 *   2. a catalogue's per-market rows lost their market and currency, so a US
 *      slot showed an INR price as dollars, and a product CTA had no link;
 *   3. the plan read capped at 1,000 rows (tested in router-calendar's paging);
 *   4. the rotation scheduled up to 4 sends per cohort in a rolling 7 days,
 *      and the cap pass marked them BLOCKED without removing them;
 *   5. feasibility was $1,500 USD for every market, IN included;
 *   6. a dated event took every slot for 45 days;
 *   8. a brand with offerings and no market got the "no catalogue" plan;
 *   9. a slot listed fewer channels than approval builds.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = require('../api/_shared/smart-brain-plan.js');
const S = require('../lib/smart-brain/services.js');

const D2C = {
  id: 'ws-d2c', name: 'Brambleweld Larder', slug: 'brambleweld', website: 'https://brambleweld.example', industry: 'food',
  regions: [{ code: 'IN', home: true, currency: 'INR' }, { code: 'US', currency: 'USD' }],
  brand_data: { offerings: [
    { kind: 'product', name: 'Mango Pickle', price: 299, currency: 'INR', url: 'https://brambleweld.example/products/mango', handle: 'mango', region: 'IN' },
    { kind: 'product', name: 'Lime Pickle', price: 12, currency: 'USD', url: 'https://brambleweld.example/en-us/products/lime', handle: 'lime', region: 'US' },
    { kind: 'product', name: 'Garlic Chutney', price: 199, currency: 'INR', url: 'https://brambleweld.example/products/garlic', handle: 'garlic' },
    { kind: 'product', name: 'Chilli Oil', price: 249, currency: 'INR', url: 'https://brambleweld.example/products/chilli', handle: 'chilli', region: 'IN' },
  ] },
};

test('1. the same date keeps the same slot on the next daily sync', () => {
  const offs = P.__test_resolveBrandOfferings(D2C);
  const a = P.__test_offeringPlanEntries(D2C, offs, '2026-10-23', 14, '_t');
  const b = P.__test_offeringPlanEntries(D2C, offs, '2026-10-24', 14, '_t');
  const ids = new Map(a.map((e) => [`${e.date}|${e.market}`, e.id]));
  const heroes = new Map(a.map((e) => [`${e.date}|${e.market}`, e.heroProduct.title]));
  let overlap = 0;
  for (const e of b) {
    const k = `${e.date}|${e.market}`;
    if (!ids.has(k)) continue;
    overlap += 1;
    expect(e.id, `${k} changed id between syncs`).toBe(ids.get(k));
    expect(e.heroProduct.title, `${k} changed its product between syncs`).toBe(heroes.get(k));
  }
  expect(overlap).toBeGreaterThan(20);
});

test('2. each market plans only its own products, in its currency, linked to their pages', () => {
  const offs = P.__test_resolveBrandOfferings(D2C);
  const a = P.__test_offeringPlanEntries(D2C, offs, '2026-10-23', 14, '_t');
  for (const e of a) {
    const hp = e.heroProduct;
    if (e.market === 'US') expect(hp.currency, `${e.date} US hero ${hp.title}`).toBe('USD');
    if (e.market === 'IN') expect(hp.currency, `${e.date} IN hero ${hp.title}`).toBe('INR');
    expect(hp.product_url).toMatch(/^https:\/\/brambleweld\.example\//);
    expect(e.cta_url).toBe(hp.product_url);
  }
  expect(new Set(a.filter((e) => e.market === 'US').map((e) => e.heroProduct.title))).toEqual(new Set(['Lime Pickle']));
});

test('4 + 5. the plan holds every cohort to the cap, and a market with no target is not judged in dollars', () => {
  const zero = require('../api/_shared/brand-runtime.js').defaultBrand();
  const markets = zero.regions.map((r) => String(r.code).toUpperCase());
  const cfg = S.smartConfig({ markets });
  const names = ['Champions', 'Loyal Customers', 'Potential Loyalist', 'New Customers', 'Promising', 'Need Attention', 'About to Sleep', 'At Risk', "Can't Lose Them", 'Hibernating', 'Lost'];
  const prev = process.cwd();
  process.chdir(ROOT);
  let out;
  try {
    out = new S.CalendarIntelligenceService(cfg).generate({ analysis: { source: 't', cohorts: names.map((n, i) => ({ name: n, count: 5000 + i, rules: [] })), productScores: Array.from({ length: 30 }, (_, i) => ({ product: { sku: `S${i}`, title: `P${i}`, handle: `p${i}`, category: 'kicks' }, score: 0.5 })), winningCampaigns: [], mvtLearnings: [] }, startDate: '2026-10-23', brand: zero });
  } finally { process.chdir(prev); }
  const E = out.entries;
  expect(E.length).toBeGreaterThan(300);
  expect(E.filter((e) => e.reach.frequency_cap.status === 'BLOCKED').length).toBe(0);
  const by = new Map();
  for (const e of E) { const k = `${e.market}|${e.cohort.name}`; if (!by.has(k)) by.set(k, []); by.get(k).push(Date.parse(e.date) / 864e5); }
  let worst = 0;
  for (const days of by.values()) for (const d of days) worst = Math.max(worst, days.filter((x) => x <= d && x > d - 7).length);
  expect(worst, 'sends to one cohort in a rolling 7 days').toBeLessThanOrEqual(2);
  const IN = E.find((e) => e.market === 'IN');
  expect(IN.feasibility.daily_target).toBeNull();
  expect(IN.feasibility.currency).toBeNull();
  expect(IN.feasibility.note).toContain('[DATA REQUIRED BEFORE LAUNCH: daily revenue target');
  expect(IN.feasibility.note).not.toContain('$');
  for (const e of E) expect(e.channels).toEqual(S.BUILT_CHANNELS);
});

test('6. a dated event takes its milestone days, and the rest of the catalogue still rotates', () => {
  const media = {
    id: 'ws-news', name: 'Quillforth Gazette', slug: 'qg', website: 'https://quillforth.example', industry: 'news publishing',
    regions: [{ code: 'IN', home: true, currency: 'INR' }],
    brand_data: { offerings: [
      { kind: 'plan', name: 'Quillforth Plus', price: 99, period: 'month', signup_url: 'https://quillforth.example/plus' },
      { kind: 'section', name: 'Morning Brief', url: 'https://quillforth.example/brief' },
      { kind: 'event', name: 'Quillforth Summit', starts_at: '2026-11-05T10:00:00+05:30', registration_url: 'https://quillforth.example/summit' },
    ] },
  };
  const a = P.__test_offeringPlanEntries(media, P.__test_resolveBrandOfferings(media), '2026-10-23', 30, '_t');
  const summit = a.filter((e) => e.heroOffering.name === 'Quillforth Summit').map((e) => e.date);
  expect(summit.length, `the event's days: ${summit.join(', ')}`).toBeLessThanOrEqual(6);
  expect(summit).toContain('2026-11-04');
  expect(summit).toContain('2026-11-05');
  const before = a.filter((e) => e.date < '2026-11-05');
  expect(new Set(before.map((e) => e.heroOffering.name)).size).toBe(3);
});

test('8. a brand with offerings and no market plans its own offerings and names the gap', () => {
  const b = { id: 'ws-nm', name: 'Nomarket Co', slug: 'nm', website: 'https://nomarket.example', regions: [],
    brand_data: { offerings: [{ kind: 'product', name: 'Widget', price: 10, url: 'https://nomarket.example/w' }] } };
  const a = P.__test_offeringPlanEntries(b, P.__test_resolveBrandOfferings(b), '2026-10-23', 7, '_t');
  expect(a.length).toBe(7);
  for (const e of a) {
    expect(e.heroProduct.title).toBe('Widget');
    expect(e.data_gaps).toEqual(['[DATA REQUIRED BEFORE LAUNCH: home market, Nomarket Co]']);
  }
});
