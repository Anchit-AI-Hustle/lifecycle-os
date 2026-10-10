'use strict';
/**
 * brand-knowledge-rules.js - the PLATFORM's rules, as the brand knowledge
 * documents print them (/kb/brand/<doc>, brand-doc.html).
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. The Brand Knowledge Base box on /knowledge-base linked six
 * static markdown files written for tenant zero (knowledge/brand/0N-*.md), and
 * auth.js opened each in an about:blank window styled with tenant zero's fonts
 * and hexes. Every other brand was shown another company's sneaker studio, its
 * Mumbai address and its endorsers, under its own name (the shell renamed the
 * text node), at an address nobody could bookmark or share.
 *
 * A brand's documents are now built FROM ITS OWN RECORD, in the browser, by
 * brand-knowledge.js (a device brand lives only in the browser). Two of the six
 * documents also print rules that belong to the platform rather than to any
 * brand: the cohort rules the planner applies, and the contract every asset
 * type is built to. Those rules live in server modules, and re-typing them in
 * a page is how a page and the planner come to disagree. So this module READS
 * them from the modules that apply them, and the brand router serves the result
 * on `?action=brand&op=platform-rules`:
 *
 *   contracts     asset-contracts.list()            (the same rules validate())
 *   rfm           rfm-core.segmentFor() enumerated over every quintile pair, so
 *                 the rule printed for a segment is the one that assigns it
 *   objectives    services.objectiveFor()           (what the planner briefs)
 *   offers        calendar-guardrails.offerFor()    (slot, depth, and the code
 *                 THIS brand declared for that slot, or the marker)
 *
 * Public, like `defaults` and `presets`: it is rules, not a tenant's data. It
 * reads no table, calls no model and fetches nothing. The only input is the
 * brand's own `offers` block, which a device brand carries because the server
 * has no row for it; it is bounded and used only to pick a code per slot.
 *
 * NOT a function file (api/_shared/ is outside the Hobby 12-function cap).
 */

const contracts = require('./asset-contracts.js');
const rfm = require('./rfm-core.js');
const guardrails = require('./calendar-guardrails.js');

function str(v, max) { const s = String(v == null ? '' : v).trim(); return max ? s.slice(0, max) : s; }

/**
 * The brand's own offers block, bounded. Codes are the brand's facts: kept as
 * given (code, rate, slot, min, note), never extended.
 */
function offersOf(brand) {
  const b = brand && typeof brand === 'object' ? brand : {};
  const o = (b.offers && typeof b.offers === 'object') ? b.offers
    : (b.brand_data && b.brand_data.offers && typeof b.brand_data.offers === 'object') ? b.brand_data.offers : null;
  if (!o) return null;
  const code = (c) => (c && typeof c === 'object' && str(c.code)) ? {
    code: str(c.code, 40), rate: Number(c.rate) || 0, slot: str(c.slot, 40),
    min: c.min != null && Number.isFinite(Number(c.min)) ? Number(c.min) : null, note: str(c.note, 160),
  } : null;
  const out = {
    codes: (Array.isArray(o.codes) ? o.codes : []).slice(0, 60).map(code).filter(Boolean),
    banned_codes: (Array.isArray(o.banned_codes) ? o.banned_codes : []).slice(0, 60).map(code).filter(Boolean),
  };
  const cap = Number(o.discount_cap);
  if (Number.isFinite(cap) && cap > 0) out.discount_cap = cap;
  return out;
}

/** "R 4 to 5, FM 4 to 5" from the cells a segment owns. */
function span(nums) {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const runs = [];
  for (const n of s) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a} to ${b}`)).join(' or ');
}

/**
 * Every segment rfm-core can emit, derived by walking the whole quintile space
 * through segmentFor() itself, in the order a segment is first reached from
 * the best scores down. A new segment arrives here the day it is added there.
 */
function rfmSegments() {
  const cells = new Map();
  const order = [];
  for (let r = 5; r >= 1; r--) {
    for (let f = 5; f >= 1; f--) {
      for (let m = 5; m >= 1; m--) {
        const seg = rfm.segmentFor(r, f, m);
        const fm = Math.round((f + m) / 2);
        if (!cells.has(seg.key)) { cells.set(seg.key, { key: seg.key, name: seg.name, pairs: new Set() }); order.push(seg.key); }
        cells.get(seg.key).pairs.add(`${r}:${fm}`);
      }
    }
  }
  return order.map((k) => {
    const c = cells.get(k);
    // Group the recency scores that share the same set of frequency+monetary
    // scores, so the printed rule reads as the function decides.
    const byR = new Map();
    for (const p of c.pairs) {
      const [r, fm] = p.split(':').map(Number);
      if (!byR.has(r)) byR.set(r, []);
      byR.get(r).push(fm);
    }
    const groups = new Map();
    for (const [r, fms] of byR) {
      const sig = [...new Set(fms)].sort().join(',');
      if (!groups.has(sig)) groups.set(sig, { rs: [], fms: [...new Set(fms)] });
      groups.get(sig).rs.push(r);
    }
    const rule = [...groups.values()]
      .sort((a, b) => Math.max(...b.rs) - Math.max(...a.rs))
      .map((g) => `R ${span(g.rs)}, FM ${span(g.fms)}`).join('; ');
    return { key: c.key, name: c.name, rule, cells: [...c.pairs].sort() };
  });
}

/**
 * The rules, for one brand's offers. `brand` may be null: the cohort and
 * contract rules do not depend on it, and every code slot then reports the
 * marker, which is the truth about a brand that declared no codes.
 */
function platformRules(brand) {
  const services = require('../../lib/smart-brain/services.js');
  const name = str(brand && brand.name, 120) || 'this brand';
  const offers = offersOf(brand);
  const forOffers = { name, offers: offers || undefined };
  const cohort = (segName) => {
    const objective = services.objectiveFor(segName, null);
    return { objective, offer: guardrails.offerFor(segName, objective, forOffers) };
  };

  const segments = rfmSegments().map((s) => Object.assign(s, cohort(s.name)));
  const replenishment = Object.values(services.REPLENISHMENT_COHORT_NAMES || {}).map((n) => Object.assign({ name: n }, cohort(n)));

  return {
    ok: true,
    brand: name,
    cohorts: {
      basis: 'Recency (R) and the average of Frequency and Monetary (FM), each scored 1 to 5 by quintile within one market\'s own customers. One segment per customer.',
      rfm: segments,
      replenishment,
      default_objective: services.objectiveFor('', null),
    },
    offers: {
      platform_cap: guardrails.DISCOUNT_CAP,
      brand_cap: guardrails.capOf(forOffers),
      declared: offers,
    },
    contracts: contracts.list().map((c) => ({
      id: c.id, medium: c.medium, label: c.label,
      structure: (c.structure || []).map((s) => ({ slot: s.slot, required: !!s.required, max: s.max == null ? null : s.max, why: s.why || '', verified: !!s.verified, source: s.source || '' })),
      design: c.design || [], algorithm: c.algorithm || [],
      verified_limits: c.verified_limits, advisory_limits: c.advisory_limits,
    })),
    sources: {
      rfm: 'api/_shared/rfm-core.js segmentFor()',
      objectives: 'lib/smart-brain/services.js objectiveFor()',
      offers: 'api/_shared/calendar-guardrails.js offerFor()',
      contracts: 'api/_shared/asset-contracts.js list()',
    },
  };
}

module.exports = { platformRules, rfmSegments, offersOf };
