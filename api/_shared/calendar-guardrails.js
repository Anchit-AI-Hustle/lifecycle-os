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
 *   6. Sneakers & botanicals only — Coffee and Themed Supplement are out of scope.
 *   7. Revenue-per-recipient (RPR) — small premium lists can out-earn big cold
 *      ones; RPR surfaces the true highest-value send.
 *
 * Pure + deterministic (no network, no LLM). Safe to require from any _shared
 * core, the export builder, or bundle into a client page.
 */

// 1) ── Discount cap + code registry ────────────────────────────────────────
const DISCOUNT_CAP = 0.15; // 15% ceiling. Anything above is do-not-promote.

// Real KNICKGASM code registry. rate = fractional discount; min = order minimum.
// Everything at or below DISCOUNT_CAP is cleared ("safe"); above it is banned.
const CODES = {
  // At-cap (15%) — the workhorse lifecycle codes, each with a semantic home.
  SUMMER15: { rate: 0.15, note: 'Seasonal / affinity default' },
  VIP15:    { rate: 0.15, note: 'VIP + one-of-one prestige' },
  KNICKGASM15: { rate: 0.15, note: 'General at-cap / replenishment' },
  NEW15:    { rate: 0.15, note: 'First-purchase activation' },
  CART15:   { rate: 0.15, note: 'Cart / checkout recovery' },
  IAMBACK:  { rate: 0.15, note: 'Winback (lapsed buyers)' },
  BACK15:   { rate: 0.15, note: 'Winback alternate' },
  SAVE15:   { rate: 0.15, min: 75, note: 'High-AOV / gifting, min $75' },
  // Light (10%) — low-friction nudges for discovery + browse.
  HELLO10:  { rate: 0.10, note: 'Browse / sampler discovery' },
  KNICKGASM10: { rate: 0.10, note: 'Cross-category nudge' },
};

// Codes that BREACH the cap and must never appear in a campaign email.
const BANNED_CODES = {
  SHUBHDA35: 0.35, GREEN30: 0.30, ANGELS30: 0.30, HOME20: 0.20, ICED20: 0.20,
  DEAL20: 0.20, RECOVER20: 0.20, SMILE20: 0.20, SAVINGS20: 0.20,
  INSIDER20: 0.20, VIP20: 0.20, VAH20: 0.20,
};

function isCodeSafe(code) {
  const c = String(code || '').toUpperCase();
  if (BANNED_CODES[c] != null) return false;
  if (CODES[c]) return CODES[c].rate <= DISCOUNT_CAP + 1e-9;
  return null; // unknown code — caller decides
}

// 6) ── Scope: sneakers & botanicals only ───────────────────────────────────────
const OUT_OF_SCOPE_TYPES = [/coffee/i, /themed\s*supplement/i, /supplement/i, /capsule/i];
function inTeaScope(productType) {
  const t = String(productType || '');
  return !OUT_OF_SCOPE_TYPES.some((re) => re.test(t));
}

// 2+3) ── Offer depth + code by cohort/objective intent ─────────────────────
// Returns { depth: 'none'|'ten'|'fif', pct, code, min, rationale }.
function offerFor(cohortName, objective) {
  const s = `${cohortName || ''} ${objective || ''}`.toLowerCase();
  const mk = (depth, pct, code, rationale) => {
    const min = (CODES[code] && CODES[code].min) || null;
    return { depth, pct, code: pct > 0 ? code : '', min, rationale };
  };
  // No discount — protect margin, build loyalty right after a purchase.
  if (/post.?purchase|nurture|thank|onboarding|welcome ritual/.test(s) && !/new sub|non.?buyer|activation/.test(s)) {
    return mk('none', 0, '', 'No discount right after purchase: protect margin, deepen the ritual before the next window.');
  }
  // At-cap 15% for the high-intent lifecycle cohorts, each to its semantic code.
  if (/vip|champion|single.?studio|prestige|connoisseur/.test(s)) return mk('fif', 0.15, 'VIP15', 'VIP / prestige tier earns the full at-cap recognition offer.');
  // Cart / checkout recovery is at-cap; a bare "browse abandon" is NOT (it drops
  // to the light discovery nudge below), so match cart/checkout specifically.
  if (/cart|checkout/.test(s))                                     return mk('fif', 0.15, 'CART15', 'High-intent cart recovery: at-cap incentive closes the loop.');
  if (/winback|win.?back|lapsed|at.?risk|non.?engager/.test(s))    return mk('fif', 0.15, 'IAMBACK', 'Lapsed buyers need the strongest allowed offer to re-activate.');
  if (/new sub|first.?purchase|activation|non.?buyer/.test(s))     return mk('fif', 0.15, 'NEW15', 'First-purchase activation: at-cap offer to convert a 0-order subscriber.');
  if (/gift|gifting|high.?aov/.test(s))                            return mk('fif', 0.15, 'SAVE15', 'Gifting / high-AOV: at-cap with a $75 minimum that self-selects intent.');
  if (/replenish|subscribe|subscription|repeat|loyal/.test(s))     return mk('fif', 0.15, 'KNICKGASM15', 'Replenishment / subscription: at-cap to lock in the repeat ritual.');
  if (/affinity|black|green|kicks|streetwear|themed|iced|summer/.test(s)) return mk('fif', 0.15, 'SUMMER15', 'Affinity cohort with high repurchase intent: seasonal at-cap offer.');
  // Light 10% for low-commitment discovery / browse / sampler / cross-sell.
  if (/browse|discovery|sampler|variety|undecided|cross.?sell|cross.?category/.test(s)) return mk('ten', 0.10, 'HELLO10', 'Discovery / browse: a light nudge, not a deep cut.');
  // Default: light nudge with a general code.
  return mk('ten', 0.10, 'KNICKGASM10', 'General audience: light 10% nudge.');
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
  DISCOUNT_CAP, CODES, BANNED_CODES, isCodeSafe,
  inTeaScope, OUT_OF_SCOPE_TYPES,
  offerFor, isEspPending, suppressionFor,
  revenuePerRecipient, stockSwapNote,
};
