/**
 * The same words on two sends of one market within a week are found and said.
 * Executed: the shipped module over sends it is handed, and over a campaign the
 * shipped builder made. Run: npx playwright test tests/copy-repeats.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CR = require(path.join(ROOT, 'api', '_shared', 'copy-repeats.js'));

test('the page loads the same module the server has', () => {
  expect(fs.readFileSync(path.join(ROOT, 'copy-repeats.js'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'api', '_shared', 'copy-repeats.js'), 'utf8'));
});

test('a repeat is the same market, at most seven days apart, the same folded words; it names both sends', () => {
  const sends = [
    { id: 'a', date: '2026-11-21', market: 'IN', subject: 'Take another look at sneakers', headline: 'Back for you' },
    { id: 'b', date: '2026-11-23', market: 'IN', subject: 'take another look at  Sneakers!', headline: 'Something new' },
    { id: 'c', date: '2026-11-23', market: 'US', subject: 'Take another look at sneakers', headline: 'Back for you' },   // other readers
    { id: 'd', date: '2026-12-05', market: 'IN', subject: 'Take another look at sneakers', headline: 'Back for you' },   // two weeks on
    { id: 'e', date: '2026-11-24', market: 'IN', subject: '', headline: '' }                                             // nothing to compare
  ];
  const out = CR.find(sends);
  expect(out.repeats).toHaveLength(1);
  expect(out.repeats[0]).toMatchObject({ field: 'subject', market: 'IN', days_apart: 2, a: { id: 'a' }, b: { id: 'b' } });
  expect(out.by_send.b[0]).toContain('2026-11-21');
  expect(out.by_send.a[0]).toContain('2026-11-23');
  expect(out.by_send.c).toBeUndefined();
  expect(out.by_send.d).toBeUndefined();
  // a wider window reaches the later send
  expect(CR.find(sends, { days: 14 }).repeats.some((r) => r.b.id === 'd')).toBe(true);
});

test('the lines are read off a campaign the shipped builder made', async () => {
  const saved = {}; for (const k of Object.keys(process.env)) if (/_API_KEY|^AWS_|^ANTHROPIC_|^OLLAMA|^SUPABASE/.test(k)) { saved[k] = process.env[k]; delete process.env[k]; }
  const realFetch = global.fetch; global.fetch = async (u) => { throw new Error('network blocked: ' + u); };
  try {
    const services = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const SBP = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
    const brand = { name: 'Brewfold', slug: 'brewfold', website: 'https://brewfold.example', regions: [{ code: 'IN', currency: 'INR', home: true }], palette: { primary: '#7a3b1e', accent: '#f2c14e', surface: '#ffffff', ink: '#1b1b1b' } };
    const mk = (id, date) => ({ id, date, market: 'IN', objective: 'reactivation', brand, cohort: { name: 'At Risk', size: 100 }, channels: ['email', 'meta', 'landing_page'], heroProduct: { title: 'House Blend 250g', price: 450, currency: 'INR', product_url: 'https://brewfold.example/p/house', image_url: 'https://brewfold.example/i/house.jpg' }, supportingProducts: [] });
    const cfg = services.smartConfig({});
    const c1 = await SBP.buildCampaign(mk('s1', '2026-11-21'), cfg, { noLLM: true, withCreatives: false });
    const c2 = await SBP.buildCampaign(mk('s2', '2026-11-22'), cfg, { noLLM: true, withCreatives: false });
    const l1 = CR.linesOf(c1);
    expect(l1.subject.length).toBeGreaterThan(3);
    // the same slot on the next day says the same subject: that is the repeat this finds
    const out = CR.find([Object.assign({ id: 's1', date: '2026-11-21', market: 'IN' }, l1), Object.assign({ id: 's2', date: '2026-11-22', market: 'IN' }, CR.linesOf(c2))]);
    expect(out.repeats.some((r) => r.field === 'subject')).toBe(true);
  } finally { global.fetch = realFetch; for (const [k, v] of Object.entries(saved)) process.env[k] = v; }
});

test('YouTube and Pinterest ads are judged by their own contracts: a video with nothing to play and a still with no brief block', () => {
  const C = require(path.join(ROOT, 'api', '_shared', 'asset-contracts.js'));
  expect(C.contractFor({ platform: 'youtube', creative_type: 'video' }).id).toBe('ad.youtube.video');
  expect(C.contractFor({ platform: 'youtube', creative_type: 'static' }).id).toBe('ad.youtube.static');
  expect(C.contractFor({ platform: 'pinterest', creative_type: 'static' }).id).toBe('ad.pinterest.static');
  expect(C.contractFor({ platform: 'pinterest', creative_type: 'video' }).id).toBe('ad.pinterest.video');
  const sev = (v) => v.map((x) => `${x.severity || x.level}:${x.slot}`);
  const vid = C.contractFor({ platform: 'youtube', creative_type: 'video' }).validate({ script: 'Open on the cup.', headline: 'House Blend' });
  expect(sev(vid).some((x) => /block:motion_html/.test(x))).toBe(true);
  const ok = C.contractFor({ platform: 'youtube', creative_type: 'video' }).validate({ script: 'Open on the cup.', headline: 'House Blend', creative: { motion_html: '<html></html>' } });
  expect(ok).toEqual([]);
  const pin = C.contractFor({ platform: 'pinterest', creative_type: 'static' }).validate({ headline: 'House Blend' });
  expect(sev(pin).some((x) => /block:creative_brief/.test(x))).toBe(true);
  // the only numbers are the organic ones the spec records, and they warn
  const long = C.contractFor({ platform: 'pinterest', creative_type: 'static' }).validate({ headline: 'x'.repeat(140), creative_brief: 'the cup on a table' });
  expect(sev(long)).toContain('warn:headline');
  expect(sev(long).some((x) => /^block:/.test(x))).toBe(false);
});
