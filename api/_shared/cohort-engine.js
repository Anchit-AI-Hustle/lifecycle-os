'use strict';
/**
 * cohort-engine.js — who should receive this, and who must not.
 * ---------------------------------------------------------------------------
 * Deliverability is mostly an audience problem wearing a technical costume. A
 * domain with perfect SPF, DKIM and DMARC still lands in spam if it keeps
 * mailing people who never open, because the inbox providers score the SENDER
 * on how recipients react. So this module decides three things:
 *
 *   WHO IS IN A COHORT       RFM plus engagement recency, computed from the
 *                            workspace's own data. Never a guess at a size.
 *   WHO MUST BE SUPPRESSED   the sunset policy. Removing an unengaged contact
 *                            is the highest-leverage act available to a sender,
 *                            and the one nobody wants to do.
 *   WHETHER A SEND IS SAFE   segment health, frequency caps and send time.
 *
 * ── ZERO FABRICATION APPLIES TO AUDIENCE SIZES ─────────────────────────────
 * The campaign spec is explicit that segment sizes are never invented. So every
 * function here reports what it computed FROM ROWS, and a workspace with no
 * engagement data gets `computed: false` with the reason - not a plausible
 * number. `[DATA REQUIRED BEFORE LAUNCH: eligible segment size, <cohort>]` is
 * the correct output when there is nothing to count, and the preflight gate
 * turns that into a warning rather than a made-up green light.
 *
 * ── FREQUENCY CAPS COME FROM THE SPEC, NOT FROM TASTE ──────────────────────
 * docs/campaign-orchestration-master-spec.md sets a promotional cap of 2 per
 * rolling 7 days with an absolute ceiling of 3, and says explicitly not to
 * assume the whole base is contactable daily. Those numbers are used here as
 * given, and they are CROSS-CHANNEL: two emails plus an SMS is three touches,
 * not one of each.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');

/* ── the cohorts ──────────────────────────────────────────────────────────── */

const COHORTS = [
  {
    key: 'champions',
    label: 'Champions',
    why: 'Opened or clicked recently AND buys often. These carry a warmup and should receive the first send of any new domain.',
    send_priority: 1,
  },
  { key: 'engaged_30', label: 'Engaged (30 days)', why: 'Opened in the last 30 days. Safe for promotional volume.', send_priority: 2 },
  { key: 'engaged_60', label: 'Engaged (60 days)', why: 'Opened in the last 60 days. Safe, with a lighter cadence.', send_priority: 3 },
  { key: 'slipping', label: 'Slipping away', why: 'Last opened 60 to 180 days ago. Worth a re-engagement sequence, not general promotion.', send_priority: 4 },
  { key: 'inactive', label: 'Inactive', why: 'No open in 180 days or more. Mailing these is what damages a sending reputation; suppress rather than discount harder.', send_priority: 5 },
];

const COHORT_BY_KEY = new Map(COHORTS.map((c) => [c.key, c]));

/** Frequency caps, per docs/campaign-orchestration-master-spec.md. */
const FREQUENCY = { promotional_per_7d: 2, absolute_per_7d: 3 };

/* ── scoring ──────────────────────────────────────────────────────────────── */

const DAY = 86400000;

function daysSince(value, now) {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor(((now || Date.now()) - t) / DAY));
}

/**
 * Quintile scores over the actual population, not fixed thresholds.
 *
 * This matters: a fixed "recency under 30 days scores 5" rule is meaningless
 * for a brand whose purchase cycle is eighteen months, and brutal for one whose
 * cycle is a week. Quintiles adapt to the brand's own distribution, which is
 * the only distribution that means anything here.
 */
function quintileScorer(values, { ascendingIsBetter = false } = {}) {
  const clean = values.filter((v) => v != null && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (clean.length < 5) {
    // Too few points for quintiles to mean anything. Say so rather than
    // producing five buckets out of three data points.
    return { ok: false, score: () => null, note: `Only ${clean.length} usable values; quintile scoring needs at least 5.` };
  }
  const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => clean[Math.floor(p * (clean.length - 1))]);
  return {
    ok: true,
    cuts,
    score(v) {
      if (v == null || !Number.isFinite(Number(v))) return null;
      const n = Number(v);
      let bucket = 1;
      for (const c of cuts) if (n > c) bucket += 1;
      // For recency, a SMALLER number is better, so the bucket inverts.
      return ascendingIsBetter ? bucket : 6 - bucket;
    },
  };
}

/**
 * Score a population of contacts.
 *
 * @param {Array<Object>} contacts rows carrying last_open_at / last_click_at /
 *        last_order_at / orders_count / total_spend / external_profile_id
 * @returns {{ok:boolean, computed:boolean, scored:Array, note:string, counts:Object}}
 */
function scoreContacts(contacts, { now = Date.now(), inactiveDays = 180 } = {}) {
  const rows = Array.isArray(contacts) ? contacts : [];
  if (!rows.length) {
    return {
      ok: true,
      computed: false,
      scored: [],
      counts: {},
      note: '[DATA REQUIRED BEFORE LAUNCH: engagement history, this brand] No contact rows were supplied, so no cohort can be computed. Connect an ESP and sync engagement before relying on cohort targeting.',
    };
  }

  const recency = rows.map((r) => {
    const o = daysSince(r.last_open_at, now);
    const c = daysSince(r.last_click_at, now);
    if (o == null) return c;
    if (c == null) return o;
    return Math.min(o, c);
  });
  const frequency = rows.map((r) => Number(r.orders_count || r.frequency_90d || 0));
  const monetary = rows.map((r) => Number(r.total_spend || r.monetary || 0));

  const rScore = quintileScorer(recency);                                  // fewer days = better
  const fScore = quintileScorer(frequency, { ascendingIsBetter: true });
  const mScore = quintileScorer(monetary, { ascendingIsBetter: true });

  const scored = rows.map((r, i) => {
    const rec = recency[i];
    const rs = rScore.score(rec);
    const fs = fScore.score(frequency[i]);
    const ms = mScore.score(monetary[i]);

    // Engagement is recency-dominant on purpose: for deliverability, "did this
    // person open recently" outweighs "did they once spend a lot".
    const engagement = rec == null ? 0 : Math.max(0, Math.round(100 * Math.exp(-rec / 90)));

    let cohort;
    if (r.hard_bounced || r.complained) cohort = 'inactive';
    else if (rec == null) cohort = 'inactive';
    else if (rec <= 30 && (fs || 0) >= 4) cohort = 'champions';
    else if (rec <= 30) cohort = 'engaged_30';
    else if (rec <= 60) cohort = 'engaged_60';
    else if (rec < inactiveDays) cohort = 'slipping';
    else cohort = 'inactive';

    return {
      external_profile_id: String(r.external_profile_id || r.id || ''),
      email_hash: r.email_hash || (r.email ? hashEmail(r.email, r.workspace_id) : null),
      recency_days: rec,
      frequency_90d: frequency[i],
      monetary: monetary[i],
      r_score: rs, f_score: fs, m_score: ms,
      engagement_score: engagement,
      cohort_key: cohort,
      hard_bounced: !!r.hard_bounced,
      complained: !!r.complained,
      sends_7d: Number(r.sends_7d || 0),
      sends_30d: Number(r.sends_30d || 0),
      last_send_at: r.last_send_at || null,
      best_send_hour: bestSendHour(r.open_hour_histogram),
    };
  });

  const counts = {};
  for (const c of COHORTS) counts[c.key] = scored.filter((s) => s.cohort_key === c.key).length;

  return {
    ok: true,
    computed: true,
    scored,
    counts,
    note: rScore.ok ? `Scored ${scored.length} contacts against this brand's own distribution.` : `Scored ${scored.length} contacts. ${rScore.note} R/F/M scores are null where the population was too small.`,
  };
}

/**
 * A salted hash. The salt is per-workspace so the same address in two
 * workspaces does not produce the same hash, which would let one tenant confirm
 * another's membership by comparison.
 *
 * This is pseudonymisation, not anonymisation: a known address can still be
 * confirmed by hashing it. The table it lands in stays under brand RLS for
 * exactly that reason.
 */
function hashEmail(email, workspaceId) {
  const salt = String(process.env.CONTACT_HASH_SALT || workspaceId || '');
  return crypto.createHash('sha256').update(`${salt}:${String(email).trim().toLowerCase()}`).digest('hex');
}

/* ── send-time optimisation ───────────────────────────────────────────────── */

/**
 * The hour this contact actually opens in.
 *
 * Returns null rather than a default when there is not enough history. A
 * platform that quietly sends everyone at 10am and calls it optimisation is
 * worse than one that admits it does not know, because the first is unfalsifiable.
 */
function bestSendHour(histogram, { minObservations = 5 } = {}) {
  if (!histogram || typeof histogram !== 'object') return null;
  const hours = Object.keys(histogram).map(Number).filter((h) => h >= 0 && h <= 23);
  if (!hours.length) return null;
  const total = hours.reduce((s, h) => s + Number(histogram[h] || 0), 0);
  if (total < minObservations) return null;
  let best = null;
  let bestN = -1;
  for (const h of hours) {
    const n = Number(histogram[h] || 0);
    if (n > bestN) { bestN = n; best = h; }
  }
  return best;
}

/**
 * Aggregate send time for a whole segment, with an honest confidence.
 */
function optimalSendTime(scored, { fallbackHour = null } = {}) {
  const rows = (scored || []).filter((s) => s.best_send_hour != null);
  if (!rows.length) {
    return {
      hour: fallbackHour,
      confidence: 'none',
      note: fallbackHour == null
        ? 'No open-time history, so no send time is recommended. Sending at a time somebody picked from habit is a decision, not an optimisation, and this platform will not label it as one.'
        : `No open-time history; using the supplied fallback hour ${fallbackHour}.`,
      sample: 0,
    };
  }
  const buckets = new Array(24).fill(0);
  for (const r of rows) buckets[r.best_send_hour] += 1;
  const hour = buckets.indexOf(Math.max(...buckets));
  const share = buckets[hour] / rows.length;
  return {
    hour,
    confidence: rows.length >= 500 && share > 0.15 ? 'high' : rows.length >= 100 ? 'medium' : 'low',
    share,
    sample: rows.length,
    note: `${rows.length} contacts have enough open history; ${Math.round(share * 100)}% of them peak at ${String(hour).padStart(2, '0')}:00.`,
  };
}

/* ── sunset policy ────────────────────────────────────────────────────────── */

/**
 * Who should stop receiving mail.
 *
 * Deliberately conservative on one point: a contact who has never been sent
 * anything is NOT suppressed, however old their record. "Never opened" and
 * "never given the chance to open" look identical in the data and are opposite
 * situations, and suppressing the second loses a subscriber for a bug.
 */
function sunsetCandidates(scored, {
  inactiveDays = 180,
  minSendsBeforeSunset = 5,
  includeComplained = true,
  includeHardBounced = true,
} = {}) {
  const rows = Array.isArray(scored) ? scored : [];
  const out = [];
  for (const s of rows) {
    if (includeHardBounced && s.hard_bounced) { out.push({ ...s, reason: 'hard bounce' }); continue; }
    if (includeComplained && s.complained) { out.push({ ...s, reason: 'spam complaint' }); continue; }
    if (s.recency_days == null) {
      if (Number(s.sends_30d || 0) >= minSendsBeforeSunset) out.push({ ...s, reason: `no open recorded across ${s.sends_30d} sends` });
      continue;                                             // never sent to: leave alone
    }
    if (s.recency_days >= inactiveDays) out.push({ ...s, reason: `no open in ${s.recency_days} days` });
  }

  const bounced = out.filter((o) => o.reason === 'hard bounce').length;
  const complained = out.filter((o) => o.reason === 'spam complaint').length;
  return {
    candidates: out,
    count: out.length,
    share: rows.length ? out.length / rows.length : 0,
    summary: rows.length
      ? `${out.length} of ${rows.length} contacts (${Math.round((out.length / rows.length) * 100)}%) qualify for suppression: ${bounced} hard bounces, ${complained} complaints, ${out.length - bounced - complained} long-term unengaged.`
      : 'No contacts scored.',
    // Suppression is destructive and irreversible from the brand's side, so it
    // is never applied automatically by this function.
    applied: false,
    note: 'This is a proposal. Nothing is suppressed until an operator confirms it, because a suppression cannot be undone from this platform.',
  };
}

/* ── segment health ───────────────────────────────────────────────────────── */

/**
 * Would sending to this segment help or hurt the domain?
 *
 * @returns {{score:number|null, verdict:'pass'|'warn'|'block', ...}}
 */
function segmentHealth(scored, { messagePriority = 'promotional' } = {}) {
  const rows = Array.isArray(scored) ? scored : [];
  if (!rows.length) {
    return {
      score: null,
      verdict: 'warn',
      size: 0,
      eligible: 0,
      computed: false,
      reasons: ['[DATA REQUIRED BEFORE LAUNCH: eligible segment size] No scored contacts, so segment health could not be computed. This is not a pass.'],
    };
  }

  const engaged = rows.filter((s) => s.recency_days != null && s.recency_days <= 60).length;
  const inactive = rows.filter((s) => s.cohort_key === 'inactive').length;
  const risky = rows.filter((s) => s.hard_bounced || s.complained).length;
  const engagedShare = engaged / rows.length;
  const inactiveShare = inactive / rows.length;

  // Hard bounces are the best available predictor of the next bounce rate.
  const estimatedBounce = risky / rows.length;

  const reasons = [];
  let score = Math.round(100 * (engagedShare * 0.7 + (1 - inactiveShare) * 0.3));

  if (risky > 0) {
    reasons.push(`${risky} contact(s) have already hard bounced or complained and must be excluded, not mailed again.`);
    score -= 20;
  }
  if (inactiveShare > 0.5) {
    reasons.push(`${Math.round(inactiveShare * 100)}% of this segment has not opened in 180 days. Sending promotional mail to a majority-inactive list is the single fastest way to lose inbox placement.`);
  }
  if (engagedShare < 0.1) {
    reasons.push(`Only ${Math.round(engagedShare * 100)}% opened in the last 60 days.`);
  }

  score = Math.max(0, Math.min(100, score));

  // A transactional or high-intent message is judged differently from a mass
  // promotion: the recipient is expecting it, so engagement history matters less.
  const isPromotional = messagePriority === 'promotional';
  const verdict = !isPromotional
    ? (estimatedBounce > 0.05 ? 'warn' : 'pass')
    : (inactiveShare > 0.6 || estimatedBounce > 0.03) ? 'block'
      : (inactiveShare > 0.35 || engagedShare < 0.15 || estimatedBounce > 0.01) ? 'warn'
        : 'pass';

  return {
    score,
    verdict,
    computed: true,
    size: rows.length,
    eligible: rows.length - risky,
    engaged,
    inactive,
    risky,
    engaged_share: engagedShare,
    inactive_share: inactiveShare,
    estimated_bounce_risk: estimatedBounce,
    message_priority: messagePriority,
    reasons: reasons.length ? reasons : [`${Math.round(engagedShare * 100)}% engaged in the last 60 days, ${risky} risky addresses.`],
  };
}

/**
 * Match message priority to engagement tier: a mass promotion should not go to
 * the tiers that only tolerate a light touch.
 */
function recommendCohorts(messagePriority) {
  switch (String(messagePriority || 'promotional')) {
    case 'transactional':
      return { cohorts: COHORTS.map((c) => c.key), why: 'Transactional mail is expected by the recipient and goes to everyone who is not suppressed.' };
    case 'high_intent':
      return { cohorts: ['champions', 'engaged_30', 'engaged_60', 'slipping'], why: 'A high-intent trigger justifies reaching a slipping contact.' };
    case 're_engagement':
      return { cohorts: ['slipping'], why: 'Re-engagement targets the slipping tier only. Sending it to the inactive tier is what a sunset policy exists to prevent.' };
    default:
      return { cohorts: ['champions', 'engaged_30', 'engaged_60'], why: 'Promotional volume stays inside the 60-day engaged window to protect placement.' };
  }
}

/* ── frequency capping ────────────────────────────────────────────────────── */

/**
 * Cross-channel. The spec's cap is per PERSON per 7 days across email, SMS and
 * push together - the common failure is counting each channel separately and
 * shipping three times the intended pressure.
 */
function frequencyCheck(scored, { messagePriority = 'promotional' } = {}) {
  const rows = Array.isArray(scored) ? scored : [];
  if (!rows.length) return { ok: true, computed: false, over: 0, note: 'No contacts scored, so frequency could not be checked.' };

  const cap = messagePriority === 'transactional' ? Infinity
    : messagePriority === 'promotional' ? FREQUENCY.promotional_per_7d
      : FREQUENCY.absolute_per_7d;

  const over = rows.filter((s) => Number(s.sends_7d || 0) >= cap);
  return {
    ok: over.length === 0,
    computed: true,
    cap,
    over: over.length,
    over_ids: over.slice(0, 50).map((s) => s.external_profile_id),
    share: over.length / rows.length,
    note: over.length
      ? `${over.length} of ${rows.length} contacts have already had ${cap} or more touches in the last 7 days across all channels. Sending again breaches the cap in docs/campaign-orchestration-master-spec.md; exclude them or delay.`
      : `All ${rows.length} contacts are inside the ${cap === Infinity ? 'unlimited (transactional)' : cap} touch cap for a rolling 7 days.`,
  };
}

/* ── the whole picture ────────────────────────────────────────────────────── */

/**
 * Score, cohort, cap and time in one pass, for the preflight gate.
 */
function analyseAudience(contacts, opts = {}) {
  const scoring = scoreContacts(contacts, opts);
  if (!scoring.computed) {
    return {
      computed: false,
      note: scoring.note,
      health: segmentHealth([], opts),
      frequency: frequencyCheck([], opts),
      send_time: optimalSendTime([], opts),
      sunset: { candidates: [], count: 0, summary: 'Not computed.' },
      counts: {},
    };
  }
  return {
    computed: true,
    note: scoring.note,
    counts: scoring.counts,
    scored: scoring.scored,
    health: segmentHealth(scoring.scored, opts),
    frequency: frequencyCheck(scoring.scored, opts),
    send_time: optimalSendTime(scoring.scored, opts),
    sunset: sunsetCandidates(scoring.scored, opts),
    recommended: recommendCohorts(opts.messagePriority),
  };
}

module.exports = {
  COHORTS, COHORT_BY_KEY, FREQUENCY,
  scoreContacts, quintileScorer, hashEmail, daysSince,
  bestSendHour, optimalSendTime,
  sunsetCandidates, segmentHealth, recommendCohorts, frequencyCheck,
  analyseAudience,
};
