// ad-rows-core — the three platform-shape traps, pinned.
//
// This module exists because Meta, Google and TikTok disagree about units,
// nesting and rate encoding. Each test below is one way a consumer that skipped
// the mapper has actually got the number wrong.
//
// Run: npx playwright test tests/ad-rows.spec.js
const { test, expect } = require('@playwright/test');
const rows = require('../api/_shared/ad-rows-core.js');

test('Google cost is micros, not currency', () => {
  // 12_340_000 micros is 12.34, not 12.34 million. Reading costMicros as a
  // plain number overstates spend a millionfold and makes ROAS ~0.
  const out = rows.googleRows({
    ok: true, platform: 'google', level: 'campaign',
    data: [{ results: [{ campaign: { id: '1', name: 'Brand' }, metrics: { costMicros: 12340000, impressions: 1000, clicks: 50, conversions: 5, conversionsValue: 100 } }] }],
  });
  expect(out).toHaveLength(1);
  expect(out[0].spend).toBeCloseTo(12.34, 6);
  expect(out[0].roas).toBeCloseTo(100 / 12.34, 6);
});

test('Google averageCpc is micros too', () => {
  const out = rows.googleRows({
    ok: true, platform: 'google', level: 'campaign',
    data: [{ results: [{ campaign: { id: '1' }, metrics: { costMicros: 1000000, clicks: 10, averageCpc: 100000 } }] }],
  });
  expect(out[0].cpc).toBeCloseTo(0.1, 6);
});

test('Google searchStream batches are all read, not just the first', () => {
  // The response is an array of batches. Treating it as a flat list silently
  // drops every campaign after the first batch.
  const out = rows.googleRows({
    ok: true, platform: 'google', level: 'campaign',
    data: [
      { results: [{ campaign: { id: '1', name: 'A' }, metrics: { costMicros: 1000000 } }] },
      { results: [{ campaign: { id: '2', name: 'B' }, metrics: { costMicros: 2000000 } }] },
    ],
  });
  expect(out).toHaveLength(2);
  expect(rows.rollup(out).spend).toBeCloseTo(3, 6);
});

test('Meta purchases are taken once, not summed across action types', () => {
  // The same order appears under purchase, omni_purchase and the pixel action
  // type. Summing them triples revenue.
  const out = rows.metaRows({
    ok: true, platform: 'meta', level: 'campaign',
    data: [{
      campaign_id: 'c1', campaign_name: 'Prospecting', spend: 100, impressions: 10000, clicks: 200,
      actions: [
        { action_type: 'purchase', value: '10' },
        { action_type: 'omni_purchase', value: '10' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '10' },
      ],
      action_values: [
        { action_type: 'purchase', value: '500' },
        { action_type: 'omni_purchase', value: '500' },
      ],
    }],
  });
  expect(out[0].conversions).toBe(10);
  expect(out[0].revenue).toBe(500);
  expect(out[0].roas).toBeCloseTo(5, 6);
});

test('Meta ctr is a percentage and becomes a fraction', () => {
  const out = rows.metaRows({
    ok: true, platform: 'meta', level: 'campaign',
    data: [{ campaign_id: 'c1', spend: 10, impressions: 1000, clicks: 20, ctr: '2.0' }],
  });
  expect(out[0].ctr).toBeCloseTo(0.02, 6);
});

test('TikTok rates above 1 are percentages, at or below 1 are fractions', () => {
  const pct = rows.tiktokRows({
    ok: true, platform: 'tiktok', level: 'campaign',
    data: { list: [{ dimensions: { campaign_id: '1' }, metrics: { spend: 10, impressions: 1000, clicks: 30, ctr: 3 } }] },
  });
  expect(pct[0].ctr).toBeCloseTo(0.03, 6);

  const frac = rows.tiktokRows({
    ok: true, platform: 'tiktok', level: 'campaign',
    data: { list: [{ dimensions: { campaign_id: '1' }, metrics: { spend: 10, impressions: 1000, clicks: 30, ctr: 0.03 } }] },
  });
  expect(frac[0].ctr).toBeCloseTo(0.03, 6);
});

test('every platform reports rates in the same units after mapping', () => {
  // Same underlying performance expressed three ways; the common row must agree.
  const meta = rows.metaRows({ ok: true, platform: 'meta', level: 'campaign', data: [{ campaign_id: 'm', spend: 100, impressions: 10000, clicks: 200, ctr: '2.0' }] });
  const google = rows.googleRows({ ok: true, platform: 'google', level: 'campaign', data: [{ results: [{ campaign: { id: 'g' }, metrics: { costMicros: 100000000, impressions: 10000, clicks: 200, ctr: 0.02 } }] }] });
  const tiktok = rows.tiktokRows({ ok: true, platform: 'tiktok', level: 'campaign', data: { list: [{ dimensions: { campaign_id: 't' }, metrics: { spend: 100, impressions: 10000, clicks: 200, ctr: 2 } }] } });

  for (const r of [meta[0], google[0], tiktok[0]]) {
    expect(r.spend).toBeCloseTo(100, 6);
    expect(r.ctr).toBeCloseTo(0.02, 6);
  }
});

test('an account with no conversions returns null ROAS, never zero', () => {
  // Retail-media and awareness accounts report zero purchases by construction.
  // A 0 reads as "sold nothing" and drags a blended ROAS toward zero; a null
  // says "not measurable from these rows".
  const out = rows.rollup([
    { spend: 500, impressions: 100000, clicks: 1200, conversions: 0, revenue: 0, reach: 60000 },
  ]);
  expect(out.roas).toBeNull();
  expect(out.cpa).toBeNull();
  expect(out.conversion_rate).toBeNull();
  expect(out.revenue_trustworthy).toBe(false);
  expect(out.revenue_note).toContain('null rather than 0');
  // The metrics that ARE measurable still come through.
  expect(out.ctr).toBeCloseTo(0.012, 6);
  expect(out.cpm).toBeCloseTo(5, 6);
});

test('rollup reports ROAS once any row actually converts', () => {
  const out = rows.rollup([
    { spend: 500, impressions: 100000, clicks: 1200, conversions: 0, revenue: 0, reach: 0 },
    { spend: 500, impressions: 50000, clicks: 800, conversions: 40, revenue: 3000, reach: 0 },
  ]);
  expect(out.revenue_trustworthy).toBe(true);
  expect(out.roas).toBeCloseTo(3, 6);
  expect(out.revenue_note).toBeNull();
});

test('a failed or unknown platform response yields no rows, not fabricated ones', () => {
  expect(rows.rowsFor({ ok: false, platform: 'meta', data: [{ spend: 999 }] })).toEqual([]);
  expect(rows.rowsFor({ ok: true, platform: 'pinterest', data: [{ spend: 999 }] })).toEqual([]);
  expect(rows.rowsFor(null)).toEqual([]);
  expect(rows.rollup([]).entities).toBe(0);
});
