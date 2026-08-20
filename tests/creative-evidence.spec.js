// What worked, put in front of the writer — and nothing that did not.
//
// THE GAP. The planner already worked out which of this brand's own campaigns
// cleared its thresholds, pulled their hooks, and stamped the winner on the
// calendar slot. It reached the confidence score, the rationale and the review
// panel, and never reached the copywriter: `strategyPrompt()` briefed the
// writer with the market, the cohort, the product, the offer and a list of
// COMPETITOR hooks. Every send was written from rules and other people's
// angles while the evidence sat one field away.
//
// The feature is easy. The rules are the part worth testing, because each one
// is a way this could quietly start lying to the model:
//
//   - a "top performer" with no number behind it reads as evidence and is a claim
//   - ROAS printed as 0 for owned email reads as a campaign that lost money
//   - an omitted section invites the model to supply its own "what worked"
//   - a hook counted once per channel row turns 4 sightings into 16
//   - a campaign in both the WORKED and TIRING lists contradicts itself
//
// Run: npx playwright test tests/creative-evidence.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ev = require(path.join(ROOT, 'api', '_shared', 'creative-evidence.js'));
const { smartConfig, CalendarIntelligenceService } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const sbPlan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));

const campaign = (name, over = {}) => ({
  name,
  hooks: [`${name} hook`],
  performance: Object.assign({ sends: 10000, openRate: 0.3, clickRate: 0.03, revenuePerRecipient: 1, roas: null }, over),
});

/* ═══ a win carries its numbers, or it is not a win ═══════════════════════ */

test('a campaign with no metrics is dropped, not promoted on its name', () => {
  // The dangerous case: a named "top performer" with nothing behind it.
  expect(ev.asWin({ name: 'Mystery Winner', hooks: ['x'] })).toBeNull();
  expect(ev.asWin({ name: 'Mystery Winner', performance: {} })).toBeNull();
  expect(ev.asWin({ name: 'Mystery Winner', performance: { sends: 0, clickRate: 0 } })).toBeNull();
});

test('every win in the brief prints the figure that qualified it', () => {
  const pack = ev.evidenceFor({ ownEvidence: { campaigns: [campaign('Winter Drop', { clickRate: 0.062, sends: 42000 })] } });
  expect(pack.wins).toHaveLength(1);
  expect(pack.wins[0].metrics).toMatch(/42,000 sent/);
  expect(pack.wins[0].metrics).toMatch(/6\.2% click/);
  // And it reaches the rendered brief, not just the object.
  expect(ev.evidenceBrief(pack)).toMatch(/6\.2% click/);
});

test('an owned-email campaign reports no ROAS rather than a zero', () => {
  // roas is null without spend. Printing 0 would read as a campaign that lost
  // money; omitting it silently would let the model assume one.
  const line = ev.metricLine({ sends: 1000, clickRate: 0.05, revenuePerRecipient: 2, roas: null, spend: 0 });
  expect(line).not.toMatch(/0\.00x/);
  expect(line).not.toMatch(/0x return/);
  expect(line).toMatch(/5\.0% click/);
  // With real spend and a real ratio it IS printed.
  expect(ev.metricLine({ sends: 1000, clickRate: 0.05, roas: 3.2, spend: 500 })).toMatch(/3\.20x return on ad spend/);
  // Spend but no reported ratio is stated, not guessed.
  expect(ev.metricLine({ sends: 1000, clickRate: 0.05, roas: null, spend: 500 })).toMatch(/not reported/);
});

/* ═══ no evidence is a state, not an empty string ═════════════════════════ */

test('a brand with no history is told so, and told not to invent one', () => {
  const brief = ev.briefFor({ market: 'UK', brand: { name: 'NewBrand' } });
  expect(brief).toMatch(/WORKED: nothing yet/);
  // The instruction that matters: a section that simply vanished would invite
  // the model to supply its own past winner.
  expect(brief).toMatch(/Do NOT invent a past campaign, a previous result, a benchmark or a figure/);
  expect(brief).not.toMatch(/undefined|NaN|\[object/);
});

test('a brand with no history reports the gap as a marker', () => {
  const pack = ev.evidenceFor({ market: 'UK', brand: { name: 'NewBrand' } });
  expect(pack.gaps.join(' ')).toMatch(/^\[DATA REQUIRED BEFORE LAUNCH: own campaign performance, NewBrand, UK\]$/);
});

test('a brand WITH history raises no such gap', () => {
  const pack = ev.evidenceFor({ ownEvidence: { campaigns: [campaign('Winter Drop')] } });
  expect(pack.gaps).toEqual([]);
});

/* ═══ fatigue is measured against what we actually have ═══════════════════ */

test('fatigue is not claimed from fewer than three campaigns', () => {
  // Two points is not a distribution. The industry phrasing is "CTR down 20%
  // from peak", which needs a per-creative time series this repo does not
  // store — so it is not claimed, and the reason is stated.
  const out = ev.fatigueFrom([campaign('A', { clickRate: 0.05 }), campaign('B', { clickRate: 0.01 })]);
  expect(out.available).toBe(false);
  expect(out.reason).toMatch(/too few to establish this brand's own median/);
  expect(out.items).toEqual([]);
});

test('fatigue names the brand\'s own median, and does not claim a peak', () => {
  const out = ev.fatigueFrom([
    campaign('High', { clickRate: 0.06 }),
    campaign('Mid', { clickRate: 0.03 }),
    campaign('Low', { clickRate: 0.01 }),
  ]);
  expect(out.available).toBe(true);
  expect(out.items.map((i) => i.name)).toEqual(['Low']);
  expect(out.items[0].note).toMatch(/against this brand's own median/);
  // The claim we cannot support must not appear anywhere in the rendered text.
  const brief = ev.evidenceBrief({ wins: [], fatigue: out, competitor: { searched: false } });
  expect(brief).not.toMatch(/from peak|since peak|down \d+% from/i);
});

test('a campaign is never both a win and a fatigue warning', () => {
  // The contradiction: "build on this" and "do not re-run this" about the same
  // campaign. Found by running the module, not by reading it.
  const pack = ev.evidenceFor({
    ownEvidence: {
      campaigns: [
        campaign('Strong', { clickRate: 0.062 }),
        campaign('Good', { clickRate: 0.048 }),
        campaign('Weak', { clickRate: 0.011 }),
        campaign('Weakest', { clickRate: 0.009 }),
      ],
    },
  });
  const wins = pack.wins.map((w) => w.name);
  const tired = pack.fatigue.items.map((f) => f.name);
  expect(wins.filter((n) => tired.includes(n)), 'a campaign appears as both a win and a fatigue warning').toEqual([]);
  expect(wins).toContain('Strong');
  expect(tired).toContain('Weakest');
});

/* ═══ competitor evidence is not inflated, and absence is not silence ═════ */

test('a hook repeated across channel rows is counted once, not once per channel', () => {
  // competitorContext carries the SAME global trending-hook list on every
  // channel row. Summing them multiplied one sighting by the channel count: a
  // hook seen 4 times was reported as "seen 16x". Inflating evidence is the
  // same defect as inventing it.
  const out = ev.competitorFrom({
    competitorContext: ['email', 'meta', 'google', 'tiktok'].map((channel) => ({
      channel, benchmark: {}, trendingHooks: [{ hook: 'one-of-one', count: 4 }],
    })),
  });
  expect(out.patterns).toHaveLength(1);
  expect(out.patterns[0].count, 'the sighting count was multiplied by the channel count').toBe(4);
  expect(out.patterns[0].channels).toHaveLength(4);
});

test('a competitor set that could not be read is never reported as quiet', () => {
  for (const entry of [{}, { competitorContext: [] }, { competitorContext: [{ channel: 'meta', benchmark: null, trendingHooks: [] }] }]) {
    const out = ev.competitorFrom(entry);
    expect(out.searched).toBe(false);
    const brief = ev.evidenceBrief({ wins: [], fatigue: { available: false }, competitor: out });
    expect(brief).toMatch(/NOT evidence that rivals are inactive/);
    expect(brief).not.toMatch(/\.\./);
  }
});

test('a competitor set that WAS read and found nothing says that instead', () => {
  const out = ev.competitorFrom({ competitorContext: [{ channel: 'meta', benchmark: { cpm: 1 }, trendingHooks: [] }] });
  expect(out.searched).toBe(true);
  expect(out.reason).toMatch(/no repeated hook stood out/);
});

test('competitor angles are marked awareness-only', () => {
  const brief = ev.briefFor({
    competitorContext: [{ channel: 'meta', benchmark: {}, trendingHooks: [{ hook: 'made to order', count: 3 }] }],
  });
  expect(brief).toMatch(/do NOT copy/i);
  expect(brief).toMatch(/never present a rival's claim as ours/i);
});

/* ═══ it reaches the writer ═══════════════════════════════════════════════ */

test('both prompt builders embed the evidence brief', () => {
  // The whole point. A pack that exists and never reaches a prompt is the bug
  // this replaces, so this asserts on the prompt builders themselves.
  const src = fs.readFileSync(path.join(ROOT, 'api/_shared/smart-brain-plan.js'), 'utf8');
  const strategy = src.slice(src.indexOf('function strategyPrompt'), src.indexOf('function strategyPrompt') + 2500);
  const copy = src.slice(src.indexOf('function copyPrompt'), src.indexOf('function copyPrompt') + 3000);
  expect(strategy, 'strategyPrompt does not brief the writer with evidence').toMatch(/creativeEvidence\.briefFor\(entry\)/);
  expect(copy, 'copyPrompt does not brief the writer with evidence').toMatch(/creativeEvidence\.briefFor\(entry\)/);
  // The flat competitor-hook line it replaces must be gone, or the writer gets
  // rival angles with no counterweight from its own results.
  expect(src, 'the old competitor-only hook line is still in a prompt').not.toMatch(/Competitor hooks trending/);
});

test('the planner puts the campaign SET on the slot, not just one winner', () => {
  const svc = new CalendarIntelligenceService(smartConfig({ markets: ['US'], cohortsPerDay: 1 }));
  const winners = [
    { id: 'c1', name: 'Winter Drop', hooks: ['a'], performance: { sends: 42000, clickRate: 0.062 } },
    { id: 'c2', name: 'Restock', hooks: ['b'], performance: { sends: 31000, clickRate: 0.048 } },
    { id: 'c3', name: 'Tired', hooks: ['c'], performance: { sends: 29000, clickRate: 0.011 } },
  ];
  const entry = svc.generate({
    analysis: { source: 't', cohorts: [{ name: 'At Risk', count: 2000, rules: [] }], productScores: [{ product: { sku: 'A', title: 'Alpha 01' }, score: 1 }], winningCampaigns: winners, mvtLearnings: [] },
    startDate: '2026-09-01', days: 1, brand: { name: 'TestBrand' },
  }).entries[0];

  expect(entry.ownEvidence, 'the slot carries no evidence set').toBeTruthy();
  expect(entry.ownEvidence.campaigns.length).toBe(3);
  // One rotating winner is still stamped for the rationale, and is not the brief.
  expect(entry.ownDataReference).toBeTruthy();

  const brief = ev.briefFor(entry);
  expect(brief).toMatch(/Winter Drop/);
  expect(brief).toMatch(/TIRING/);
});

test('a brand with no winners still plans, and the brief says the history is empty', () => {
  const svc = new CalendarIntelligenceService(smartConfig({ markets: ['US'], cohortsPerDay: 1 }));
  const entry = svc.generate({
    analysis: { source: 't', cohorts: [{ name: 'At Risk', count: 2000, rules: [] }], productScores: [{ product: { sku: 'A', title: 'Alpha 01' }, score: 1 }], winningCampaigns: [], mvtLearnings: [] },
    startDate: '2026-09-01', days: 1, brand: { name: 'NewBrand' },
  }).entries[0];
  expect(entry.ownEvidence).toBeNull();
  expect(ev.briefFor(entry)).toMatch(/WORKED: nothing yet/);
});

test('a real campaign build still passes its own contracts with evidence attached', async () => {
  test.setTimeout(180_000);
  const c = await sbPlan.buildCampaign({
    id: 'ev-build', date: '2026-09-02', market: 'US', objective: 'reactivation and replenishment',
    cohort: { name: 'At Risk', size: 2000, rules: ['r'] },
    channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], confidence: 0.8,
    heroProduct: { sku: 'A', title: 'Alpha 01', handle: 'alpha-01' },
    offer: { code: null, depth: 'none', pct: 0, why: 'n/a' }, rationale: 'x',
    ownEvidence: { campaigns: [campaign('Winter Drop', { clickRate: 0.062 }), campaign('Restock', { clickRate: 0.048 }), campaign('Tired', { clickRate: 0.011 })] },
  }, smartConfig({}), { noLLM: true, withCreatives: false });
  expect(c.contract_check.blocking).toBe(0);
  expect(c.contract_check.warnings).toBe(0);
});

/* ═══ the brief never leaks a number nobody measured ══════════════════════ */

test('the brief contains no figure that did not come from the data', () => {
  const brief = ev.briefFor({
    market: 'US', brand: { name: 'TestBrand' },
    ownEvidence: { campaigns: [campaign('Only One', { sends: 1234, clickRate: 0.0456 })] },
  });
  // Every percentage in the text must trace to a supplied metric.
  const pcts = [...brief.matchAll(/(\d+\.\d)%/g)].map((m) => m[1]);
  for (const p of pcts) expect(['4.6', '30.0'], `${p}% appears in the brief but was never measured`).toContain(p);
  expect(brief).toMatch(/1,234 sent/);
});
