'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// rfm-core.js — statistically-grounded RFM segmentation (replaces the hardcoded
// absolute-threshold cohorts). Per market: data-relative quintiles for Recency,
// Frequency, Monetary → the standard 11 lifecycle segments, MUTUALLY EXCLUSIVE
// (one primary segment per user). Behavioural interests (kicks, gift, discount)
// are OVERLAY TAGS, never competing cohorts — so sizing never double-counts.
//
// Pure + testable (no I/O). Not a function file (under api/_shared/).
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86400000;

function daysSince(ts, now) { return ts ? Math.max(0, Math.floor((now - new Date(ts).getTime()) / DAY)) : null; }

// Quintile rank 1..5 for a value given the sorted ascending sample.
// `reverse` = smaller-is-better (recency days): fewer days → higher score.
function quintile(value, sortedAsc, reverse) {
  if (value == null || !sortedAsc.length) return 1;
  // position = fraction of sample <= value
  let lo = 0, hi = sortedAsc.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedAsc[mid] <= value) lo = mid + 1; else hi = mid; }
  const frac = lo / sortedAsc.length;           // 0..1
  let q = Math.min(5, Math.max(1, Math.ceil(frac * 5)));
  return reverse ? (6 - q) : q;
}

// Map (R,F,M) quintiles → one of 11 standard lifecycle segments.
function segmentFor(r, f, m) {
  const fm = Math.round((f + m) / 2);
  if (r >= 4 && fm >= 4) return { key: 'champions', name: 'Champions' };
  if (r >= 3 && fm >= 4) return { key: 'loyal', name: 'Loyal Customers' };
  if (r >= 4 && fm >= 2 && fm <= 3) return { key: 'potential_loyalist', name: 'Potential Loyalist' };
  if (r === 5 && fm <= 1) return { key: 'new', name: 'New Customers' };
  if (r >= 4 && fm <= 1) return { key: 'promising', name: 'Promising' };
  if (r === 3 && fm <= 2) return { key: 'need_attention', name: 'Need Attention' };
  if (r === 3 && fm >= 3) return { key: 'about_to_sleep', name: 'About to Sleep' };
  if (r === 2 && fm >= 3) return { key: 'at_risk', name: 'At Risk' };
  if (r <= 1 && fm >= 4) return { key: 'cant_lose', name: "Can't Lose Them" };
  if (r === 2 && fm <= 2) return { key: 'hibernating', name: 'Hibernating' };
  return { key: 'lost', name: 'Lost' };
}

const INTEREST_TAGS = [
  { tag: 'core_silhouette', test: (u) => (u.categories || []).some((c) => ['af1', 'jordan', 'nike-other', 'converse', 'adidas'].includes(c)) },
  { tag: 'fandom', test: (u) => (u.categories || []).some((c) => ['anime', 'sport', 'gaming', 'auto', 'celebrity'].includes(c)) },
  { tag: 'occasion', test: (u) => (u.categories || []).some((c) => ['wedding', 'pets', 'bling'].includes(c)) },
  { tag: 'gift', test: (u) => (u.categories || []).some((c) => ['gift', 'accessories'].includes(c)) },
  { tag: 'discount_responsive', test: (u) => Number(u.discount_affinity) >= 0.25 },
  { tag: 'email_engaged', test: (u) => !!u.email_engaged },
];

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function round(n, d = 2) { const p = 10 ** d; return Math.round((Number(n) || 0) * p) / p; }

/**
 * scoreUsers(users, { now }) → users annotated with rfm {r,f,m,score,segment} +
 * interest tags. Quintiles are computed PER MARKET from that market's own
 * distribution, so cutoffs adapt to the base.
 */
function scoreUsers(users, { now = null } = {}) {
  // RECENCY IS MEASURED AGAINST TODAY, NEVER AGAINST A DATE IN THE SOURCE.
  // This defaulted to a literal 2026-07-12, so any caller that did not pass
  // `now` scored recency as of whatever day that literal happened to be - a
  // month stale within a month of being written, and silently so: quintile
  // cutoffs still looked plausible while "At Risk" and "Lost" were both
  // understated by exactly the drift. A wrong clock produces a wrong cohort with
  // no error anywhere.
  const t = now || Date.now();
  const byMarket = {};
  for (const u of users) (byMarket[u.market || 'US'] = byMarket[u.market || 'US'] || []).push(u);
  const out = [];
  for (const [market, mu] of Object.entries(byMarket)) {
    const recency = mu.map((u) => daysSince(u.last_order_at, t)).filter((x) => x != null).sort((a, b) => a - b);
    const freq = mu.map((u) => Number(u.orders_count) || 0).sort((a, b) => a - b);
    const mon = mu.map((u) => Number(u.total_spent) || 0).sort((a, b) => a - b);
    for (const u of mu) {
      const rec = daysSince(u.last_order_at, t);
      const r = quintile(rec, recency, true);
      const f = quintile(Number(u.orders_count) || 0, freq, false);
      const m = quintile(Number(u.total_spent) || 0, mon, false);
      const seg = segmentFor(r, f, m);
      const tags = INTEREST_TAGS.filter((it) => it.test(u)).map((it) => it.tag);
      out.push(Object.assign({}, u, { market, rfm: { r, f, m, score: `${r}${f}${m}`, segment: seg.key, segment_name: seg.name }, interest_tags: tags }));
    }
  }
  return out;
}

/**
 * buildRfmCohorts(users, { now }) → EXCLUSIVE cohorts (one per user), per market,
 * each with size + validated metrics. Interest tags are reported as overlays.
 */
function buildRfmCohorts(users, { now = null } = {}) {
  const at = now || Date.now();
  const scored = scoreUsers(users, { now: at });
  const groups = {};
  for (const u of scored) {
    const key = `${u.market}:${u.rfm.segment}`;
    (groups[key] = groups[key] || { market: u.market, segment: u.rfm.segment, segment_name: u.rfm.segment_name, members: [] }).members.push(u);
  }
  return Object.values(groups).map((g) => {
    const m = g.members;
    const overlays = {};
    for (const it of INTEREST_TAGS) overlays[it.tag] = m.filter((u) => (u.interest_tags || []).includes(it.tag)).length;
    // A member who has NEVER ordered has no recency. `daysSince(...) || 0` read
    // that absence as "ordered today" and averaged it in, so a cohort of
    // never-buyers reported an average recency of 0 days - the healthiest
    // possible number for the least engaged people in the base, and the exact
    // signal a winback plan reads to decide it is not needed. Never-ordered
    // members are excluded from the average and counted separately instead.
    const recencies = m.map((u) => daysSince(u.last_order_at, at)).filter((x) => x != null);
    return {
      id: `coh_${g.market.toLowerCase()}_${g.segment}`,
      name: `${g.segment_name} · ${g.market}`,
      market: g.market,
      segment: g.segment,
      size: m.length,
      exclusive: true,
      metrics: {
        avg_orders: round(mean(m.map((u) => Number(u.orders_count) || 0))),
        avg_spent: round(mean(m.map((u) => Number(u.total_spent) || 0))),
        avg_recency_days: recencies.length ? round(mean(recencies), 0) : null,
        recency_measured_for: recencies.length,
        never_ordered: m.length - recencies.length,
        email_engaged_pct: round(m.filter((u) => u.email_engaged).length / m.length, 3),
      },
      overlays,      // behavioural tags as counts, NOT separate cohorts
      source: 'rfm',
      active: true,
    };
  }).sort((a, b) => b.size - a.size);
}

module.exports = { scoreUsers, buildRfmCohorts, quintile, segmentFor, daysSince };
