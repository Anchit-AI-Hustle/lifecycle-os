/**
 * A cohort name is an internal classification. Never say it to the customer.
 * ---------------------------------------------------------------------------
 * Found by BUILDING a campaign and reading the copy rather than reviewing the
 * template. `entry.cohort.name` is what rfm-core emits — "At Risk",
 * "Hibernating", "About to Sleep", "Can't Lose Them", "Lost" — and it was
 * interpolated directly into the words a reader receives:
 *
 *     subject       "Alpha 01 for At Risk"
 *     video hook    "Lost: Alpha 01 is here"
 *     landing blurb "Why About to Sleep keep coming back to it."
 *     LP eyebrow    "Hibernating edit"
 *
 * Three defects in one string. It tells a customer how the business has
 * classified them; it is not English; and it is internal analytics leaving the
 * building. The segment still picks the objective, the offer depth and the hero
 * — it simply never speaks.
 *
 * This drives EVERY segment rfm-core can emit, not the two someone thought of.
 * The list is read from the module, so a segment added there arrives here
 * automatically instead of being silently uncovered.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const sbPlan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const rfm = require(path.join(ROOT, 'api', '_shared', 'rfm-core.js'));

/**
 * Every segment name the classifier can produce, derived by walking the whole
 * quintile space rather than by copying a list that would then drift.
 */
function allSegmentNames() {
  const names = new Set();
  for (let r = 1; r <= 5; r++) {
    for (let f = 1; f <= 5; f++) {
      for (let m = 1; m <= 5; m++) names.add(rfm.segmentFor(r, f, m).name);
    }
  }
  return [...names];
}

const SEGMENTS = allSegmentNames();

function slotFor(cohortName) {
  return {
    id: `coh-${cohortName.replace(/\W+/g, '-').toLowerCase()}`,
    date: '2026-09-02', market: 'US',
    objective: 'reactivation and replenishment',
    cohort: { name: cohortName, size: 2000, rules: ['r'] },
    channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
    confidence: 0.8,
    heroProduct: { sku: 'A', title: 'Alpha 01', handle: 'alpha-01' },
    offer: { code: null, depth: 'none', pct: 0, why: 'n/a' },
    rationale: 'Lapsed buyers.',
  };
}

/** Every string a CUSTOMER can read, with a label saying where it came from. */
function customerCopy(campaign) {
  const out = [];
  const push = (where, v) => { if (typeof v === 'string' && v.trim()) out.push([where, v]); };
  const e = (campaign.assets && campaign.assets.email) || {};
  push('email.subject', e.subject);
  push('email.preheader', e.preheader);
  push('email.html', e.html);
  for (const a of (campaign.assets && campaign.assets.ads) || []) {
    for (const k of ['primary_text', 'headline', 'description', 'caption', 'hook', 'cta']) {
      push(`ad.${a.platform}.${a.creative_type}.${k}`, a[k]);
    }
    for (const o of [a.overlay || {}]) {
      for (const k of Object.keys(o)) push(`ad.${a.platform}.${a.creative_type}.overlay.${k}`, o[k]);
    }
  }
  const lps = campaign.assets && (campaign.assets.landing_pages || (campaign.assets.landing_page ? [campaign.assets.landing_page] : []));
  for (const lp of lps || []) {
    push('landing.title', lp.title);
    push('landing.blurb', lp.blurb);
    push('landing.html', lp.html);
  }
  return out;
}

test.describe('no internal segment label reaches the reader', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the segment list was actually derived', () => {
    // A check that enumerated nothing would pass for every campaign.
    expect(SEGMENTS.length).toBeGreaterThanOrEqual(8);
    for (const n of ['At Risk', 'Hibernating', 'Lost', 'Champions']) {
      expect(SEGMENTS, `${n} is no longer produced — update this test deliberately`).toContain(n);
    }
  });

  for (const name of SEGMENTS) {
    test(`"${name}" never appears in the copy built for it`, async () => {
      const campaign = await sbPlan.buildCampaign(
        slotFor(name), smartConfig({}), { noLLM: true, withCreatives: false },
      );

      const copy = customerCopy(campaign);
      // The assertion is only meaningful if there was copy to inspect.
      expect(copy.length, 'no customer-facing copy was produced to check').toBeGreaterThan(3);

      const hits = copy
        .filter(([, v]) => new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(v))
        .map(([where, v]) => {
          const i = v.toLowerCase().indexOf(name.toLowerCase());
          return `${where}: …${v.slice(Math.max(0, i - 40), i + name.length + 40).replace(/\s+/g, ' ')}…`;
        });

      expect(hits, `the segment label "${name}" is in copy the customer reads:\n${hits.join('\n')}`).toEqual([]);
    });
  }
});

test('the reader is still addressed, just not by their segment', async () => {
  // Removing the label must not leave the copy with no audience at all. The
  // second person is true for every segment, which is why it replaced them.
  const campaign = await sbPlan.buildCampaign(
    slotFor('At Risk'), smartConfig({}), { noLLM: true, withCreatives: false },
  );
  const subject = campaign.assets.email.subject || '';
  const preheader = campaign.assets.email.preheader || '';
  expect(`${subject} ${preheader}`.toLowerCase()).toMatch(/\byou\b/);
});

test('the segment still drives the plan, it just does not speak', async () => {
  // The fix must not have severed the targeting. The cohort has to survive on
  // the campaign for the operator, the ESP segment and the audience brief.
  const campaign = await sbPlan.buildCampaign(
    slotFor('Hibernating'), smartConfig({}), { noLLM: true, withCreatives: false },
  );
  const asJson = JSON.stringify(campaign);
  expect(asJson, 'the cohort vanished from the campaign entirely').toMatch(/Hibernating/);
});
