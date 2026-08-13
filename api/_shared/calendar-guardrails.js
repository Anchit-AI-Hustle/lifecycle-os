'use strict';

/**
 * Calendar guardrails — the planning conventions distilled from the build-ready
 * daily-calendar reference (KNICKGASM USA 21-day dashboard). These are the RULES a
 * human planner applies before a send is safe to ship, encoded once so every
 * generated calendar, export and dashboard inherits the same rigor:
 *
 *   1. Discount cap (15%) + a real code registry — codes above the cap must
 *      NEVER appear in a campaign; at-or-below-cap codes are cleared for use.
 *   2. Offer depth by cohort intent — post-purchase nurture protects margin
 *      (no discount), discovery/browse gets a light 10%, high-intent lifecycle
 *      cohorts get the full at-cap 15%.
 *   3. Cohort -> the correct semantic code (VIP15 for VIP, NEW15 for new subs,
 *      CART15 for cart, IAMBACK for winback, SAVE15 (min $75) for gifting, ...).
 *   4. ESP-pending gating — affinity / behavioural cohorts whose size only
 *      resolves in Klaviyo are flagged, and their revenue projection is withheld
 *      until the real size lands (no fabricated numbers).
 *   5. Progressive suppression — each send excludes the cohorts already mailed
 *      in the window so no subscriber is over-mailed.
 *   6. Custom sneakers & apparel only — drinkware, gift cards and digital/service
 *      SKUs are out of scope for the lifecycle calendar.
 *   7. Revenue-per-recipient (RPR) — small premium lists can out-earn big cold
 *      ones; RPR surfaces the true highest-value send.
 *
 * Pure + deterministic (no network, no LLM). Safe to require from any _shared
 * core, the export builder, or bundle into a client page.
 */

// 1) ── Discount cap + code registry ────────────────────────────────────────
//
// The CAP is policy and belongs here: it is a rule about how deep this platform
// will ever discount, and it holds for every brand.
//
// The CODES do not. A discount code is a fact that exists in one brand's store,
// and this module used to carry ten of tenant zero's real ones - SUMMER15,
// VIP15, KNICKGASM15 - as the registry every brand's calendar drew from. A code
// invented for a brand that never created it does not merely name the wrong
// company: a customer types it at checkout and it fails. So the registry now
// comes from the brand's own record (`offers.codes`), and a brand that lists
// none gets NO code, not a plausible one.
//
// The banned list is likewise per brand - a code that breached the cap in one
// store means nothing in another. (Tenant zero's list carried `VAH20`, a
// leftover of the previous brand, which is gone.)
const DISCOUNT_CAP = 0.15; // 15% ceiling. Anything above is do-not-promote.

/** The brand's own code registry, keyed by code. `{}` when it declares none. */
function codesOf(brand) {
  const list = (brand && brand.offers && Array.isArray(brand.offers.codes)) ? brand.offers.codes : [];
  const out = {};
  for (const c of list) {
    if (!c || !c.code) continue;
    out[String(c.code).toUpperCase()] = { rate: Number(c.rate) || 0, min: c.min || null, note: c.note || '', slot: c.slot || '' };
  }
  return out;
}

/** Codes this brand has declared as breaching its cap. */
function bannedOf(brand) {
  const list = (brand && brand.offers && Array.isArray(brand.offers.banned_codes)) ? brand.offers.banned_codes : [];
  const out = {};
  for (const c of list) { if (c && c.code) out[String(c.code).toUpperCase()] = Number(c.rate) || 0; }
  return out;
}

/** This brand's cap, falling back to the platform ceiling. */
function capOf(brand) {
  const v = brand && brand.offers && Number(brand.offers.discount_cap);
  return Number.isFinite(v) && v > 0 ? Math.min(v, DISCOUNT_CAP) : DISCOUNT_CAP;
}

function isCodeSafe(code, brand) {
  const c = String(code || '').toUpperCase();
  const CODES = codesOf(brand), BANNED_CODES = bannedOf(brand);
  if (BANNED_CODES[c] != null) return false;
  if (CODES[c]) return CODES[c].rate <= capOf(brand) + 1e-9;
  return null; // unknown code — caller decides
}

// 6) ── Scope: custom sneakers & apparel only ──────────────────────────────────
// Anything that is not a customisable physical product (mugs/drinkware, gift
// cards, digital or service SKUs) is out of scope for the lifecycle calendar.
// Function name inTeaScope() is kept: it is exported and consumed elsewhere.
const OUT_OF_SCOPE_TYPES = [/mug/i, /drinkware/i, /gift\s*card/i, /e-?gift/i, /digital/i, /service/i];
function inTeaScope(productType) {
  const t = String(productType || '');
  return !OUT_OF_SCOPE_TYPES.some((re) => re.test(t));
}

// 2+3) ── Offer depth + code by cohort/objective intent ─────────────────────
// Returns { depth: 'none'|'ten'|'fif', pct, code, min, slot, rationale, data_gaps }.
//
// The DEPTH and the reasoning are the platform's to decide: they come from the
// cohort's behaviour, which is the brand's own data, and the logic holds for
// any brand. The CODE is not. It is selected from the brand's own registry by
// the SLOT this decision lands in, and when the brand has declared no code for
// that slot the offer ships without one and says so. Ten literal codes used to
// live in this function - one brand's real codes, handed to every brand.
const SLOT_RULES = [
  { slot: 'post_purchase', depth: 'none', pct: 0,
    match: (s) => /post.?purchase|nurture|thank|onboarding|welcome ritual/.test(s) && !/new sub|non.?buyer|activation/.test(s),
    why: 'No discount right after purchase: protect margin, deepen the relationship before the next window.' },
  { slot: 'vip',          depth: 'fif', pct: 0.15, match: (s) => /vip|champion|single.?studio|prestige|connoisseur/.test(s),
    why: 'VIP / prestige tier earns the full at-cap recognition offer.' },
  // Cart / checkout recovery is at-cap; a bare "browse abandon" is NOT - it
  // falls through to the light discovery nudge below.
  { slot: 'cart',         depth: 'fif', pct: 0.15, match: (s) => /cart|checkout/.test(s),
    why: 'High-intent cart recovery: at-cap incentive closes the loop.' },
  { slot: 'winback',      depth: 'fif', pct: 0.15, match: (s) => /winback|win.?back|lapsed|at.?risk|non.?engager/.test(s),
    why: 'Lapsed buyers need the strongest allowed offer to re-activate.' },
  { slot: 'activation',   depth: 'fif', pct: 0.15, match: (s) => /new sub|first.?purchase|activation|non.?buyer/.test(s),
    why: 'First-purchase activation: at-cap offer to convert a 0-order subscriber.' },
  { slot: 'high_aov',     depth: 'fif', pct: 0.15, match: (s) => /gift|gifting|high.?aov/.test(s),
    why: 'Gifting / high-AOV: at-cap, with any order minimum the brand attaches to that code.' },
  { slot: 'replenishment', depth: 'fif', pct: 0.15, match: (s) => /replenish|subscribe|subscription|repeat|loyal/.test(s),
    why: 'Replenishment / repeat purchase: at-cap to lock in the next order.' },
  { slot: 'seasonal',     depth: 'fif', pct: 0.15, match: (s) => /affinity|themed|seasonal|summer|winter|festival/.test(s),
    why: 'Affinity cohort with high repurchase intent: seasonal at-cap offer.' },
  { slot: 'discovery',    depth: 'ten', pct: 0.10, match: (s) => /browse|discovery|sampler|variety|undecided|cross.?sell|cross.?category/.test(s),
    why: 'Discovery / browse: a light nudge, not a deep cut.' },
];

function offerFor(cohortName, objective, brand) {
  const s = `${cohortName || ''} ${objective || ''}`.toLowerCase();
  const rule = SLOT_RULES.find((r) => r.match(s))
    || { slot: 'general', depth: 'ten', pct: 0.10, why: 'General audience: light 10% nudge.' };

  const pct = Math.min(rule.pct, capOf(brand));
  if (pct <= 0) return { depth: 'none', pct: 0, code: '', min: null, slot: rule.slot, rationale: rule.why, data_gaps: [] };

  // The brand's own code for this slot, else any code of theirs at the right
  // depth, else none. Never a code this brand has not declared.
  const CODES = codesOf(brand);
  const entries = Object.entries(CODES);
  const bySlot = entries.find(([, c]) => c.slot === rule.slot && c.rate <= pct + 1e-9);
  const byRate = entries.find(([, c]) => Math.abs(c.rate - pct) < 1e-9);
  const picked = bySlot || byRate || null;

  if (!picked) {
    return {
      depth: rule.depth, pct, code: '', min: null, slot: rule.slot,
      rationale: `${rule.why} No code is shown: this brand has published none for the "${rule.slot}" slot.`,
      data_gaps: [`[DATA REQUIRED BEFORE LAUNCH: discount code for the "${rule.slot}" offer slot, ${(brand && brand.name) || 'brand'}]`],
    };
  }
  return { depth: rule.depth, pct, code: picked[0], min: picked[1].min || null, slot: rule.slot, rationale: rule.why, data_gaps: [] };
}

// 4) ── ESP-pending gating ──────────────────────────────────────────────────
// A cohort whose size only resolves inside the ESP (Klaviyo) — affinity,
// behavioural (browse/cart), and product-type-filter segments. When pending we
// carry the qualitative plan but WITHHOLD the revenue projection.
function isEspPending(cohort) {
  if (cohort && typeof cohort === 'object') {
    if (cohort.status) return /klaviyo_pending|esp|pending/i.test(cohort.status);
    if (cohort.size == null && cohort.count == null) return true;
  }
  const s = String((cohort && (cohort.name || cohort.key)) || cohort || '').toLowerCase();
  return /affinity|browse|abandon|cross.?category|non.?buyer|residual|top picks|broad|replenish|heavy /.test(s)
    && !/cart recovery/.test(s); // cart recovery has a concrete abandoned-checkout count
}

// 5) ── Progressive suppression ─────────────────────────────────────────────
// Each send excludes every cohort already mailed earlier in the window so no
// subscriber is hit twice. Returns a human-readable suppression instruction.
function suppressionFor(index, priorCohortNames, extra) {
  const priors = (priorCohortNames || []).filter(Boolean);
  const parts = [];
  if (!priors.length) parts.push('None (first / highest-priority send in the window).');
  else if (priors.length <= 3) parts.push('Exclude prior recipients: ' + priors.join('; ') + '.');
  else parts.push(`Exclude all ${priors.length} cohorts already mailed in the window (dedupe send pressure).`);
  if (extra) parts.push(String(extra));
  return parts.join(' ');
}

// 7) ── Revenue-per-recipient ───────────────────────────────────────────────
// RPR = expected revenue / recipient. Uses the send's AOV and a conversion rate
// derived from CTR (a fraction of clickers convert). Lets a small premium list
// (e.g. one-of-one, AOV ~$62) out-rank a large cold one on true value.
function revenuePerRecipient({ aov, deliverRate = 0.97, ctr = 0.02, clickToBuy = 0.12 } = {}) {
  const a = +aov || 0;
  const convPerRecipient = deliverRate * ctr * clickToBuy;
  return +(a * convPerRecipient).toFixed(3);
}

// Stock-aware note: given a hero and a same-category in-stock alternate, describe
// a swap when the hero is out of stock. Pure helper the builder can call.
function stockSwapNote(hero, alternate) {
  if (!hero || hero.inStock !== false) return null;
  if (!alternate) return `${hero.title || 'Hero SKU'} is out of stock — pick an in-stock same-category replacement before send.`;
  return `Stock swap: ${hero.title} = 0 units. Swapped to ${alternate.title} (in stock, same category).`;
}

module.exports = {
  DISCOUNT_CAP, codesOf, bannedOf, capOf, isCodeSafe,
  inTeaScope, OUT_OF_SCOPE_TYPES,
  offerFor, isEspPending, suppressionFor,
  revenuePerRecipient, stockSwapNote,
};
