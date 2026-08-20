'use strict';

/**
 * Creative evidence — what actually worked, put in front of the writer.
 *
 * THE GAP THIS CLOSES. The planner already worked out which of the brand's own
 * campaigns cleared its performance thresholds, pulled their hooks, and stamped
 * the winner onto the calendar slot as `ownDataReference`. It reached the
 * confidence score, the rationale and the review panel. It never reached the
 * copywriter. `strategyPrompt()` briefed the writer with the market, the cohort,
 * the product, the offer and a list of COMPETITOR hooks — and nothing at all
 * about what this brand's own audience had already responded to.
 *
 * So every send was written from rules and from other people's angles, while
 * the evidence sat one field away.
 *
 * Three kinds of evidence, and they are not interchangeable:
 *
 *   WINS       this brand's own campaigns that cleared its own thresholds,
 *              quoted with the real numbers that qualified them.
 *   FATIGUE    creatives running below the brand's own median, so a tired
 *              angle is not reused as if it were fresh.
 *   COMPETITOR what rivals are running, grouped by format, hook and CTA —
 *              awareness only, never to be copied.
 *
 * ── THE RULES THAT MATTER MORE THAN THE FEATURE ────────────────────────────
 *
 * 1. A WIN CARRIES ITS NUMBERS OR IT IS NOT A WIN. "Top performer" with no
 *    figure behind it is the single most dangerous line to hand a model: it
 *    reads as evidence and is a claim. Every win here prints the metric that
 *    qualified it. A campaign whose metrics are missing is dropped, not
 *    promoted on its name.
 *
 * 2. ROAS IS NULL FOR OWNED EMAIL, NOT ZERO. There is no spend behind a
 *    lifecycle send, so return on ad spend is undefined. `normalizeMetric`
 *    already returns null rather than a sentinel; this module says
 *    "not applicable, no spend attached" rather than printing 0, which a model
 *    would read as a campaign that lost money.
 *
 * 3. NO EVIDENCE IS A STATE, NOT AN EMPTY STRING. A brand that just onboarded
 *    has no history. The brief then SAYS there is none and tells the writer to
 *    work from the brand rules — because a prompt that simply omits the section
 *    invites the model to supply its own "what worked last time".
 *
 * 4. FATIGUE IS MEASURED AGAINST WHAT WE ACTUALLY HAVE. The industry phrasing
 *    is "CTR down 20% from peak", which needs a time series per creative. This
 *    repo stores campaign TOTALS, not a series, so that number cannot be
 *    computed and is not claimed. What can be computed honestly is a campaign
 *    sitting below this brand's own median, and that is what is reported, in
 *    those words. Where even a median is impossible (fewer than three
 *    campaigns), fatigue is reported `available:false` with the reason.
 *
 * 5. A COMPETITOR SET THAT COULD NOT BE READ IS NOT AN EMPTY ONE. Same rule the
 *    competitor universe already follows: `searched:false` never renders as
 *    "no competitor activity".
 */

/** Metrics that are real numbers rather than derived-from-nothing. */
function metricLine(p) {
  if (!p || typeof p !== 'object') return null;
  const bits = [];
  const pct = (v) => `${(Number(v) * 100).toFixed(1)}%`;
  if (Number(p.sends) > 0) bits.push(`${Number(p.sends).toLocaleString('en-US')} sent`);
  if (Number(p.openRate) > 0) bits.push(`${pct(p.openRate)} open`);
  if (Number(p.clickRate) > 0) bits.push(`${pct(p.clickRate)} click`);
  if (Number(p.conversionRate) > 0) bits.push(`${pct(p.conversionRate)} conversion`);
  if (Number(p.revenuePerRecipient) > 0) bits.push(`${Number(p.revenuePerRecipient).toFixed(2)} revenue per recipient`);
  // Rule 2: absent ROAS is stated, never printed as zero.
  if (p.roas === null || p.roas === undefined) {
    if (Number(p.spend) > 0) bits.push('return on ad spend not reported');
  } else if (Number(p.roas) > 0) {
    bits.push(`${Number(p.roas).toFixed(2)}x return on ad spend`);
  }
  return bits.length ? bits.join(', ') : null;
}

/** A campaign is usable evidence only if it can show a number. Rule 1. */
function asWin(c) {
  if (!c) return null;
  const line = metricLine(c.performance);
  if (!line) return null;
  const hooks = (Array.isArray(c.hooks) ? c.hooks : []).map((h) => String(h).trim()).filter(Boolean).slice(0, 4);
  return {
    name: String(c.name || c.campaign_id || 'an earlier campaign'),
    hooks,
    metrics: line,
  };
}

/** The brand's own middle, used as the fatigue baseline. Rule 4. */
function medianClickRate(campaigns) {
  const rates = (campaigns || [])
    .map((c) => Number(c && c.performance && c.performance.clickRate))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  // Fewer than three points is not a distribution, it is a coincidence.
  if (rates.length < 3) return null;
  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
}

/**
 * Campaigns running below the brand's own median click rate.
 *
 * Deliberately NOT called "down from peak": that needs a per-creative time
 * series this repo does not store, and naming it that way would be a claim
 * about data nobody has.
 */
function fatigueFrom(campaigns) {
  const list = Array.isArray(campaigns) ? campaigns.filter(Boolean) : [];
  if (!list.length) {
    return { available: false, reason: 'No campaign performance is connected for this brand yet.', items: [] };
  }
  const median = medianClickRate(list);
  if (median === null) {
    return {
      available: false,
      reason: 'Fewer than three campaigns carry a click rate, which is too few to establish this brand\'s own median.',
      items: [],
    };
  }
  const items = list
    .map((c) => ({ c, rate: Number(c.performance && c.performance.clickRate) }))
    .filter((x) => Number.isFinite(x.rate) && x.rate > 0 && x.rate < median)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3)
    .map((x) => ({
      name: String(x.c.name || x.c.campaign_id || 'an earlier campaign'),
      hooks: (Array.isArray(x.c.hooks) ? x.c.hooks : []).slice(0, 2),
      note: `${(x.rate * 100).toFixed(1)}% click against this brand's own median of ${(median * 100).toFixed(1)}%`,
    }));
  return { available: true, median, items };
}

/**
 * Competitor activity, grouped the way a media buyer reads it.
 *
 * `competitorContext` on a slot is per-channel with a flat trending-hook list.
 * Grouping by channel and counting the repeats is what turns a list into a
 * pattern: an angle three rivals are running is a signal, one rival running it
 * is an anecdote.
 */
function competitorFrom(entry) {
  const ctx = Array.isArray(entry && entry.competitorContext) ? entry.competitorContext : [];
  if (!ctx.length) {
    // Rule 5: absence of a benchmark object is absence of a READ, not evidence
    // that rivals are quiet.
    return { searched: false, reason: 'No competitor benchmark was attached to this slot.', patterns: [] };
  }
  const seen = new Map();
  let anyBenchmark = false;
  for (const c of ctx) {
    if (c && c.benchmark) anyBenchmark = true;
    for (const h of (c && c.trendingHooks) || []) {
      const hook = String((h && h.hook) || h || '').trim();
      if (!hook) continue;
      const key = hook.toLowerCase();
      const prev = seen.get(key) || { hook, channels: new Set(), count: 0 };
      prev.channels.add(String((c && c.channel) || 'unknown'));
      // MAX, not sum. `competitorContext` carries the SAME global trending-hook
      // list on every channel row, so adding them multiplied one sighting by the
      // number of channels — a hook seen 4 times was reported as "seen 16x".
      // Inflating the evidence is the same defect as inventing it.
      prev.count = Math.max(prev.count, Number((h && h.count) || 1));
      seen.set(key, prev);
    }
  }
  const patterns = [...seen.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((p) => ({ hook: p.hook, channels: [...p.channels], count: p.count }));

  if (!patterns.length) {
    return {
      searched: anyBenchmark,
      reason: anyBenchmark
        ? 'The competitor set was read and no repeated hook stood out.'
        : 'The competitor set could not be read for this slot, so nothing is claimed about rival activity.',
      patterns: [],
    };
  }
  return { searched: true, patterns };
}

/**
 * The whole pack for one slot.
 *
 * Reads only what the planner already stamps onto the entry, so this needs no
 * new plumbing and works inside the existing ~180-slot prebuild queue.
 */
function evidenceFor(entry) {
  const e = entry || {};
  // The planner stamps one winner as `ownDataReference` and, since this module
  // exists, the fuller set as `ownEvidence.campaigns`. Accept either.
  const pool = (e.ownEvidence && Array.isArray(e.ownEvidence.campaigns) && e.ownEvidence.campaigns.length)
    ? e.ownEvidence.campaigns
    : (e.ownDataReference ? [e.ownDataReference] : []);

  const fatigue = fatigueFrom(pool);
  // A CAMPAIGN CANNOT BE BOTH. Taking the first three of the pool put a
  // below-median campaign in the WORKED list while the FATIGUE list named the
  // same campaign as stale — the writer was told to build on the very angle it
  // was told not to re-run. Whatever the caller passed, anything under this
  // brand's own median is not a win here, and the rest are ordered by the
  // click rate that makes one stronger evidence than another.
  const tired = new Set(fatigue.items.map((f) => f.name));
  const wins = pool
    .filter((c) => c && !tired.has(String(c.name || c.campaign_id || 'an earlier campaign')))
    .filter((c) => !(fatigue.available && Number(c.performance && c.performance.clickRate) < fatigue.median))
    .sort((a, b) => Number((b.performance || {}).clickRate || 0) - Number((a.performance || {}).clickRate || 0))
    .map(asWin)
    .filter(Boolean)
    .slice(0, 3);
  const competitor = competitorFrom(e);

  const gaps = [];
  if (!wins.length) {
    gaps.push(`[DATA REQUIRED BEFORE LAUNCH: own campaign performance, ${(e.brand && e.brand.name) || 'this brand'}, ${e.market || 'all markets'}]`);
  }
  return { wins, fatigue, competitor, gaps };
}

/**
 * Render the pack as the block that goes into a prompt.
 *
 * Rule 3 lives here: with no wins the block does not vanish, it states the
 * absence and forbids the model from filling it. An omitted section is an
 * invitation; a stated one is a constraint.
 */
function evidenceBrief(pack) {
  const p = pack || { wins: [], fatigue: { available: false }, competitor: { searched: false } };
  const lines = ['EVIDENCE — what this brand\'s own audience has already responded to.'];

  if (p.wins && p.wins.length) {
    lines.push('WORKED (this brand\'s own campaigns, with the figures that qualified them):');
    for (const w of p.wins) {
      lines.push(`  - "${w.name}" — ${w.metrics}${w.hooks.length ? `. Hooks that carried it: ${w.hooks.map((h) => `"${h}"`).join(', ')}` : ''}`);
    }
    lines.push('  Build on the PATTERN behind these (the angle, the structure, the promise), not the wording. Reusing a line verbatim is how a programme repeats itself into fatigue.');
  } else {
    lines.push('WORKED: nothing yet. No campaign performance is connected for this brand, so there is no past winner to build on.');
    lines.push('  Write from the brand rules and the cohort. Do NOT invent a past campaign, a previous result, a benchmark or a figure to justify the angle.');
  }

  if (p.fatigue && p.fatigue.available && p.fatigue.items.length) {
    lines.push('TIRING (below this brand\'s own median click rate — do not re-run these angles):');
    for (const f of p.fatigue.items) {
      lines.push(`  - "${f.name}" — ${f.note}${f.hooks && f.hooks.length ? `. Angle: ${f.hooks.map((h) => `"${h}"`).join(', ')}` : ''}`);
    }
  } else if (p.fatigue) {
    lines.push(`TIRING: not measurable yet. ${p.fatigue.reason || ''} No angle is assumed stale.`);
  }

  if (p.competitor && p.competitor.searched && p.competitor.patterns.length) {
    lines.push('COMPETITORS are repeating these angles (awareness only — do NOT copy, and never present a rival\'s claim as ours):');
    for (const c of p.competitor.patterns) {
      lines.push(`  - "${c.hook}" (seen ${c.count}x on ${c.channels.join(', ')})`);
    }
  } else if (p.competitor) {
    const why = String(p.competitor.reason || 'The competitor set was not read for this slot').replace(/\.\s*$/, '');
    lines.push(`COMPETITORS: ${why}. This is NOT evidence that rivals are inactive, so do not say the category is quiet.`);
  }

  return lines.join('\n');
}

/** One call for the prompt sites. */
function briefFor(entry) { return evidenceBrief(evidenceFor(entry)); }

module.exports = {
  evidenceFor, evidenceBrief, briefFor,
  // exported for tests, because each carries a rule worth pinning on its own
  metricLine, asWin, medianClickRate, fatigueFrom, competitorFrom,
};
