// Deliverability and audience maths, and the honesty rules around them.
//
// The recurring failure in this domain is not a wrong calculation, it is a
// confident answer to a question nobody actually asked the network. Three
// specific lies are tested against here:
//
//   "not listed"    when the blocklist refused to answer
//   "score 40/F"    when the DNS lookup timed out rather than the record failing
//   "send at 10am"  when there is no open history at all
//
// Run: npx playwright test tests/deliverability-cohorts.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const deliver = require(path.join(ROOT, 'api', '_shared', 'deliverability-core.js'));
const cohorts = require(path.join(ROOT, 'api', '_shared', 'cohort-engine.js'));

/* ═══ SPF ═════════════════════════════════════════════════════════════════ */

test('the SPF ten-lookup limit is counted, not assumed', async () => {
  // Ten is the RFC 7208 limit and exceeding it is a permerror: SPF then fails
  // for every message, which is invisible until deliverability collapses.
  const record = 'v=spf1 include:a.example include:b.example a mx ptr exists:c.example -all';
  const { count } = await deliver.countSpfLookups(record, 'example.com', 0, new Set());
  // 3 includes/exists + a + mx + ptr = 6 at this level, plus whatever nests.
  expect(count).toBeGreaterThanOrEqual(6);
});

test('a mutually recursive include chain terminates instead of hanging', async () => {
  const seen = new Set(['loop.example']);
  const out = await deliver.countSpfLookups('v=spf1 include:loop.example -all', 'loop.example', 0, seen);
  expect(out.count).toBe(1);          // counted once, not followed forever
});

test('a blocklist refusal is never reported as clean', () => {
  // Spamhaus answers a refused query with 127.255.255.x, which naive code reads
  // as a listing and lazy code reads as clean. Both are wrong.
  expect(deliver.isRefusalCode('127.255.255.254')).toBe(true);
  expect(deliver.isRefusalCode('127.255.255.252')).toBe(true);
  expect(deliver.isRefusalCode('127.0.0.2'), 'a real listing must not be mistaken for a refusal').toBe(false);
  expect(deliver.isRefusalCode('127.0.0.11')).toBe(false);
});

/* ═══ scoring honesty ═════════════════════════════════════════════════════ */

test('an unavailable lookup is excluded from the score, not failed', () => {
  const withSpf = deliver.scoreDomain([
    { type: 'SPF', passed: true, found: true, parsed: { all: '-all' } },
    { type: 'DKIM', passed: true, parsed: { selectors: [{ selector: 's1', revoked: false }] } },
    { type: 'DMARC', found: true, passed: true, parsed: { policy: 'reject', rua: 'mailto:x@y.z' } },
    { type: 'MX', passed: true },
  ], { checked: true, listed: [] });

  const spfUnavailable = deliver.scoreDomain([
    { type: 'SPF', unavailable: true, passed: null, findings: [{ message: 'lookup timed out' }] },
    { type: 'DKIM', passed: true, parsed: { selectors: [{ selector: 's1', revoked: false }] } },
    { type: 'DMARC', found: true, passed: true, parsed: { policy: 'reject', rua: 'mailto:x@y.z' } },
    { type: 'MX', passed: true },
  ], { checked: true, listed: [] });

  // Both are perfect on everything that COULD be checked, so both score 100.
  // A domain must never be marked down for our network trouble.
  expect(withSpf.score).toBe(100);
  expect(spfUnavailable.score).toBe(100);
  // ...but the second says out loud that it is a partial audit.
  expect(spfUnavailable.partial).toBe(true);
  expect(spfUnavailable.max_possible).toBeLessThan(withSpf.max_possible);
  expect(spfUnavailable.coverage_note).toMatch(/excluded rather than counted as failures/);
});

test('a genuinely missing SPF does lose points', () => {
  const missing = deliver.scoreDomain([
    { type: 'SPF', found: false, passed: false },
    { type: 'DKIM', passed: true, parsed: { selectors: [{ selector: 's', revoked: false }] } },
    { type: 'DMARC', found: true, passed: true, parsed: { policy: 'reject', rua: 'x' } },
    { type: 'MX', passed: true },
  ], { checked: true, listed: [] });
  expect(missing.score).toBeLessThan(100);
  expect(missing.partial).toBe(false);
});

test('nothing checkable produces no score rather than a zero', () => {
  const out = deliver.scoreDomain([
    { type: 'SPF', unavailable: true, findings: [{ message: 'x' }] },
    { type: 'DKIM', unavailable: true, findings: [{ message: 'x' }] },
    { type: 'DMARC', unavailable: true, findings: [{ message: 'x' }] },
    { type: 'MX', unavailable: true, findings: [{ message: 'x' }] },
  ], { checked: false, note: 'no resolver' });
  expect(out.score).toBeNull();
  expect(out.grade).toBe('?');
  expect(out.coverage_note).toMatch(/not a verdict on the domain/);
});

/* ═══ content ═════════════════════════════════════════════════════════════ */

test('a missing unsubscribe is the heaviest single content signal', () => {
  const out = deliver.analyzeContent({ subject: 'Hello', html: '<p>' + 'word '.repeat(60) + '</p>' });
  expect(out.has_unsubscribe).toBe(false);
  const unsub = out.signals.find((s) => /unsubscribe/i.test(s.signal));
  expect(unsub).toBeTruthy();
  expect(unsub.weight).toBeGreaterThanOrEqual(5);
});

test('an image-only email is flagged, and a normal one is not', () => {
  const imageOnly = deliver.analyzeContent({ subject: 'Drop', html: '<img src="a"><img src="b"> unsubscribe' });
  expect(imageOnly.signals.some((s) => /image-only|image\(s\) and only/i.test(s.signal))).toBe(true);

  const normal = deliver.analyzeContent({
    subject: 'Your order shipped',
    html: '<p>' + 'word '.repeat(150) + '<img src="a"><a href="https://b.example/u">unsubscribe</a></p>',
  });
  expect(normal.band).toBe('clean');
});

test('the spam analyser says what it did not check', () => {
  const out = deliver.analyzeContent({ subject: 'x', html: 'unsubscribe' });
  expect(out.not_checked.join(' ')).toMatch(/SpamAssassin/);
  expect(out.not_checked.join(' ')).toMatch(/inbox placement/i.test('Inbox placement') ? /placement/i : /placement/i);
});

/* ═══ warmup ══════════════════════════════════════════════════════════════ */

test('the ramp starts small, ends at target, and never jumps', () => {
  const plan = deliver.buildWarmupPlan({ startOn: '2026-09-01', targetDaily: 10000 });
  expect(plan[0].cap).toBeLessThanOrEqual(50);
  expect(plan[plan.length - 1].cap).toBe(10000);
  for (let i = 1; i < plan.length; i += 1) {
    // A step bigger than ~1.5x is what a receiving domain reads as a
    // compromised account.
    expect(plan[i].cap / plan[i - 1].cap).toBeLessThanOrEqual(1.6);
  }
});

test('the ramp mails the most engaged first, and widens whatever its length', () => {
  // Widening is a fraction of the ramp, not a fixed day number: a ramp to 5,000
  // converges in ~13 days and one to 500,000 takes ~25. Fixed thresholds left
  // the short ramp stuck on its first tier throughout.
  for (const target of [2000, 5000, 500000]) {
    const plan = deliver.buildWarmupPlan({ startOn: '2026-09-01', targetDaily: target, days: 60 });
    const tiers = plan.map((d) => d.cohort_tier);
    expect(plan[0].cohort_tier, `target ${target} must start with champions`).toBe('champions');
    expect(new Set(tiers).size, `target ${target} must widen its audience across the ramp`).toBeGreaterThan(1);
    expect(tiers.indexOf('champions')).toBeLessThan(tiers.lastIndexOf('engaged_60'));
  }
});

test('a warmup never widens to lapsed contacts', () => {
  // Adding the slipping or inactive tiers to a ramp collapses the engagement
  // rate at exactly the moment the domain is trying to establish one.
  for (const target of [500, 10000, 1000000]) {
    const tiers = deliver.buildWarmupPlan({ startOn: '2026-09-01', targetDaily: target, days: 90 }).map((d) => d.cohort_tier);
    expect(tiers).not.toContain('slipping');
    expect(tiers).not.toContain('inactive');
  }
});

test('the throttle pauses on bounces or complaints, and not on noise', () => {
  expect(deliver.evaluateWarmupSafety({ sent: 1000, bounced: 25, complained: 0 }).pause).toBe(true);
  expect(deliver.evaluateWarmupSafety({ sent: 10000, bounced: 10, complained: 9 }).pause).toBe(true);
  expect(deliver.evaluateWarmupSafety({ sent: 1000, bounced: 5, complained: 0 }).pause).toBe(false);
  // 20 bounces out of 40 is 50%, but 40 is far too small a sample to act on.
  expect(deliver.evaluateWarmupSafety({ sent: 40, bounced: 20 }).verdict).toBe('insufficient_data');
});

/* ═══ cohorts ═════════════════════════════════════════════════════════════ */

const NOW = Date.parse('2026-08-18T00:00:00Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();

function population() {
  const rows = [];
  for (let i = 0; i < 20; i += 1) rows.push({ external_profile_id: 'hot' + i, last_open_at: ago(3), orders_count: 10, total_spend: 800, sends_7d: 0 });
  for (let i = 0; i < 20; i += 1) rows.push({ external_profile_id: 'warm' + i, last_open_at: ago(40), orders_count: 2, total_spend: 100, sends_7d: 0 });
  for (let i = 0; i < 20; i += 1) rows.push({ external_profile_id: 'cold' + i, last_open_at: ago(400), orders_count: 1, total_spend: 20, sends_7d: 0 });
  return rows;
}

test('cohorts split by engagement recency', () => {
  const out = cohorts.analyseAudience(population(), { now: NOW });
  expect(out.counts.inactive).toBe(20);
  expect(out.counts.champions + out.counts.engaged_30).toBe(20);
  expect(out.counts.engaged_60).toBe(20);
});

test('an empty audience is a warning with a marker, never a computed zero', () => {
  const out = cohorts.analyseAudience([]);
  expect(out.computed).toBe(false);
  expect(out.note).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
  expect(out.health.verdict).toBe('warn');
  expect(out.health.score).toBeNull();
});

test('a majority-inactive list blocks promotional sending', () => {
  const rows = [];
  for (let i = 0; i < 70; i += 1) rows.push({ external_profile_id: 'd' + i, last_open_at: ago(400), orders_count: 1, total_spend: 10 });
  for (let i = 0; i < 30; i += 1) rows.push({ external_profile_id: 'a' + i, last_open_at: ago(5), orders_count: 5, total_spend: 200 });
  const out = cohorts.analyseAudience(rows, { now: NOW, messagePriority: 'promotional' });
  expect(out.health.verdict).toBe('block');

  // The same list is acceptable for a transactional message, because the
  // recipient is expecting it.
  const txn = cohorts.analyseAudience(rows, { now: NOW, messagePriority: 'transactional' });
  expect(txn.health.verdict).not.toBe('block');
});

test('the frequency cap counts touches across channels, not per channel', () => {
  const rows = [
    { external_profile_id: 'a', last_open_at: ago(2), orders_count: 3, sends_7d: 2 },
    { external_profile_id: 'b', last_open_at: ago(2), orders_count: 3, sends_7d: 0 },
  ];
  const out = cohorts.analyseAudience(rows, { now: NOW, messagePriority: 'promotional' });
  expect(cohorts.FREQUENCY.promotional_per_7d).toBe(2);
  expect(out.frequency.ok).toBe(false);
  expect(out.frequency.over).toBe(1);
});

test('a contact who was never sent to is not suppressed for never opening', () => {
  const scored = cohorts.scoreContacts([
    { external_profile_id: 'never-mailed', last_open_at: null, sends_30d: 0, orders_count: 0, total_spend: 0 },
    { external_profile_id: 'mailed-often', last_open_at: null, sends_30d: 12, orders_count: 0, total_spend: 0 },
    { external_profile_id: 'a', last_open_at: ago(1), orders_count: 1, total_spend: 1 },
    { external_profile_id: 'b', last_open_at: ago(2), orders_count: 2, total_spend: 2 },
    { external_profile_id: 'c', last_open_at: ago(3), orders_count: 3, total_spend: 3 },
  ], { now: NOW });
  const sunset = cohorts.sunsetCandidates(scored.scored);
  const ids = sunset.candidates.map((c) => c.external_profile_id);
  // "never opened" and "never given the chance to open" look identical in the
  // data and are opposite situations.
  expect(ids).not.toContain('never-mailed');
  expect(ids).toContain('mailed-often');
});

test('suppression is proposed and never applied automatically', () => {
  const scored = cohorts.scoreContacts(population(), { now: NOW });
  const sunset = cohorts.sunsetCandidates(scored.scored);
  expect(sunset.applied).toBe(false);
  expect(sunset.note).toMatch(/until an operator confirms/i);
});

test('no send time is recommended without open history', () => {
  const out = cohorts.optimalSendTime([{ best_send_hour: null }, { best_send_hour: null }]);
  expect(out.hour).toBeNull();
  expect(out.confidence).toBe('none');
  expect(out.note).toMatch(/will not label it as one/);
});

test('a send hour needs enough observations before it is claimed', () => {
  expect(cohorts.bestSendHour({ 9: 2, 10: 1 })).toBeNull();       // only 3 opens
  expect(cohorts.bestSendHour({ 9: 20, 14: 4 })).toBe(9);
});

test('contact hashes are per workspace, so one tenant cannot confirm another\'s list', () => {
  const a = cohorts.hashEmail('person@example.com', 'workspace-a');
  const b = cohorts.hashEmail('person@example.com', 'workspace-b');
  expect(a).not.toBe(b);
  expect(a).toMatch(/^[0-9a-f]{64}$/);
});

test('quintile scoring refuses to invent buckets from too few points', () => {
  const tiny = cohorts.quintileScorer([1, 2, 3]);
  expect(tiny.ok).toBe(false);
  expect(tiny.score(2)).toBeNull();
  expect(cohorts.quintileScorer([1, 2, 3, 4, 5, 6]).ok).toBe(true);
});
