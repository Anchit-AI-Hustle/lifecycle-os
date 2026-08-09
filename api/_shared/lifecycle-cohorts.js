'use strict';

/**
 * Lifecycle cohort + play library for the UK retention program.
 *
 * Two engagement-based cohorts (NOT RFM segments — these are Klaviyo-style
 * engagement cohorts) and a library of email "plays" the on-demand lifecycle
 * calendar rotates through. Consumed by:
 *   api/_shared/lifecycle-calendar-generate.js  (planner)
 *   api/_shared/lifecycle-mailer-build.js       (brief builder)
 *
 * HARD BUSINESS RULE — NO FOUNDER VOICE anywhere in this program:
 * no founder letters, no "from our founder", no personal-name sign-offs.
 * The brand speaks as "we". Therefore every play's template_style is
 * restricted to 'pure' | 'visual' | 'editorial' (the calendar-trigger
 * renderer's non-founder branches). The 'founder' branch must NEVER be
 * selected — validated at module load below.
 *
 * Facts source of truth: data/product-types.json (locked from
 * lifecycle-campaigns/2026-07-03_week1/facts.md).
 *
 * PRODUCT-TYPE KEYS are stable identifiers shared with the planner, the mailer
 * builder and data/product-types.json, so they are NOT renamed. What they mean
 * for KNICKGASM:
 *   'tb'          -> Custom Sneakers: the hero line, hand-painted one-of-one
 *                    pairs on 100% original bases (Nike Air Force 1 from
 *                    GBP 91.85), made to order in 10-15 days.
 *   'coffee'      -> the coffee-ART Collection: coffee-dip washes and latte-swirl
 *                    motifs PAINTED onto original sneakers (Court Vision base
 *                    GBP 89.09 · Air Force 1 GBP 108.27 · Air Jordan 1 Low
 *                    GBP 141.91). A paint theme, never a drink.
 *   'supplements' -> Accessories: Chunky Rope Laces and Lace Tags (Custom) that
 *                    finish a pair — low-ticket attachment, routed price-free
 *                    to the PDP.
 * KNICKGASM runs NO subscription of any kind: every lane is one-time purchase.
 * The purchase-mode key 'subscription_priority' is retained only for consumer
 * compatibility and is never selected.
 */

// Renderer styles this program is allowed to use (calendar-trigger.js branches).
const ALLOWED_TEMPLATE_STYLES = ['pure', 'visual', 'editorial'];

// ─── Cohorts ─────────────────────────────────────────────────────────────────

const COHORTS = {
  non_buyers_non_engagers: {
    key: 'non_buyers_non_engagers',
    label: 'Cohort A — Non-Buyers / Non-Engagers',
    objective:
      'Earn the open, earn the click, first purchase. They are on the list, never purchased, ' +
      'and have not opened or clicked recently.',
    voice_guide:
      'No guilt, no pressure. Introduce the brand as if for the first time — warm, sensory, ' +
      'story-driven. Lead with what a pair feels like, not what it costs. One clear idea per email.',
    // Rotation weights: coffee-ART led for discovery (a distinctive, scroll-
    // stopping theme), with the wider custom-sneaker range and a low-ticket
    // accessory as the low-commitment first step.
    product_mix: { coffee: 4, tb: 1, supplements: 1 },
  },
  tb_buyers_non_engagers: {
    key: 'tb_buyers_non_engagers',
    label: 'Cohort B — Custom-Sneaker Buyers / Non-Engagers',
    objective:
      'Reactivate with familiarity, then cross-grade to the coffee-ART collection and the ' +
      'accessories that finish a pair. They already own a custom pair and have gone quiet.',
    voice_guide:
      'Welcome back an old friend — acknowledge the relationship without guilt. Start from the ' +
      'sneakers they already own, then introduce what is new from the same studio. Never make ' +
      'them feel watched or chased.',
    // Their own lane first (familiar), then coffee-ART and accessory cross-grade.
    product_mix: { tb: 3, coffee: 2, supplements: 1 },
  },
};

// ─── Play library ────────────────────────────────────────────────────────────
// Each play: what it is, when the planner should reach for it, the offer
// mechanic it is allowed to use (no invented discount codes — ever), which
// product types it applies to, and how the CTA must be framed per purchase
// mode. min_gap_days keeps the same play from repeating too soon per cohort.

const PLAYS = {
  brand_story_intro: {
    key: 'brand_story_intro',
    name: 'Brand / origin story introduction',
    when_to_use:
      'Cold audiences meeting the brand (again) for the first time — lead sends for Cohort A, ' +
      'or any slot where trust must precede any offer.',
    mechanic:
      'Studio narrative — the Mumbai studio, the artists, why every pair starts on a 100% original ' +
      'sneaker and is painted once and never repeated. Soft mention that rope laces and a custom ' +
      'lace tag can ride along with the pair; no hard offer.',
    applicable_product_types: ['coffee', 'tb'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'Invite a single low-pressure purchase: "Try the {product}" / "Begin with one pair".',
      subscription_priority:
        'Not applicable — no subscription exists. Soft-lead to the product page: "See the designs" ' +
        'first, the made-to-order timeline second.',
    },
    template_style: 'editorial',
    min_gap_days: 10,
  },
  winback_warm: {
    key: 'winback_warm',
    name: 'Warm win-back',
    when_to_use:
      'Lapsed buyers (Cohort B) — reopen the relationship with familiarity, not discounts. ' +
      'Pairs well with a cultural moment (e.g. a new anime season, a derby weekend, wedding season).',
    mechanic:
      '"Your pair, still here" familiarity + honest compare-at prices from the store export. ' +
      'No discount codes, no urgency — the moment and the memory do the work.',
    applicable_product_types: ['tb'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'Replenishment CTA: "Restock your {product}" / "Re-lace them". One-time purchase only.',
      subscription_priority: 'Not applicable — every KNICKGASM lane is one-time purchase.',
    },
    template_style: 'visual',
    min_gap_days: 12,
  },
  gifts_unboxing_education: {
    key: 'gifts_unboxing_education',
    name: 'Gifts / unboxing education',
    when_to_use:
      'Second-touch for audiences who opened but did not click, or any slot that needs proof ' +
      'over poetry — show exactly what arrives in the box.',
    mechanic:
      'Walk through exactly what arrives: the hand-painted pair on its original box, and the ' +
      'accessories that can ride with it (Chunky Rope Laces £6.29, Lace Tags (Custom) £7.27, ' +
      'Ultimate Sneaker Care Kit £13.63), plus how the paint is sealed water and scratch ' +
      'resistant. No invented gifts, no health or performance claims.',
    applicable_product_types: ['coffee'],
    cta_framing_by_purchase_mode: {
      one_time_only:
        'Single-pair CTA with the honest numbers visible: the coffee-ART Court Vision at £89.09, ' +
        'the Air Force 1 at £108.27, made to order in 10 to 15 days, real compare-at prices only.',
      subscription_priority: 'Not applicable — no subscription exists.',
    },
    template_style: 'visual',
    min_gap_days: 10,
  },
  subscription_value_math: {
    key: 'subscription_value_math',
    name: 'One-of-one value math',
    when_to_use:
      'Audiences already aware of the product — make the value case with plain arithmetic.',
    mechanic:
      'A custom Air Force 1 starts at £91.85 against its live compare-at from the store export: you are ' +
      'buying an original silhouette plus an artwork that exists exactly once. Show the coffee-ART base ' +
      'ladder as the honest step-up (Court Vision £89.09, Air Force 1 £108.27, Air Jordan 1 Low £141.91). ' +
      'Numbers, calmly stated, straight from the catalog — never an invented bundle or code.',
    applicable_product_types: ['coffee', 'supplements'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'N/A for this play.',
      subscription_priority:
        'Not applicable — no subscription exists. Route the CTA to the product page and let the ' +
        'catalog price carry it; for accessories, stay price-free and link the PDP.',
    },
    template_style: 'pure',
    min_gap_days: 10,
  },
  b2g1_offer: {
    key: 'b2g1_offer',
    name: 'Base-model step-up ladder',
    when_to_use:
      'Offer-forward closer after story + education touches have landed — the strongest existing ' +
      'mechanic, used sparingly. (Key kept as b2g1_offer for downstream consumers.)',
    mechanic:
      'Same hand-painted coffee-ART artwork, stepped up a base model: Court Vision £89.09, ' +
      'Air Force 1 £108.27, Air Jordan 1 Low £141.91. State the ladder so the reader picks their ' +
      'silhouette. A soft deadline ("closes Sunday") is allowed; no countdown clocks, no caps ' +
      'urgency, never an invented bundle or discount code.',
    applicable_product_types: ['coffee'],
    cta_framing_by_purchase_mode: {
      one_time_only:
        'One CTA on the chosen base: "Pick your base" / "See it on the Air Force 1". One-time purchase only.',
      subscription_priority: 'Not applicable — no subscription exists.',
    },
    template_style: 'visual',
    min_gap_days: 14,
  },
  cross_grade_launch_news: {
    key: 'cross_grade_launch_news',
    name: 'Cross-grade launch news',
    when_to_use:
      'Existing custom-sneaker buyers (Cohort B) — introduce the coffee-ART collection and the ' +
      'finishing accessories as news from the studio they already trust: "from the artists who ' +
      'painted your pair, a new theme".',
    mechanic:
      'Brand-voice launch narrative anchored in the pair they already own, plus the one-of-one promise ' +
      'and the 10-15 day made-to-order build as the reasons to cross over now.',
    applicable_product_types: ['coffee', 'supplements'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'N/A for this play.',
      subscription_priority:
        'Not applicable. Use the one-time CTA: product-page link, catalog price for sneakers, price-free for accessories.',
    },
    template_style: 'editorial',
    min_gap_days: 12,
  },
  new_launch_announcement: {
    key: 'new_launch_announcement',
    name: 'New-launch announcement',
    when_to_use:
      'Genuinely new designs and collection capsules with no purchase history — the truthful ' +
      '"be among the first" founding-customer angle. Because every pair is a one-of-one, first ' +
      'really does mean first.',
    mechanic:
      'Straight launch news: what it is, why it exists, who it is for. "Be among the first" is TRUE ' +
      'for a new capsule. Quote only catalog prices. No health or performance claims, ever.',
    applicable_product_types: ['supplements', 'coffee'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'N/A for this play.',
      subscription_priority:
        'Not applicable. Use "Be first — claim the pair" with a product-page CTA; a low-ticket ' +
        'accessory may appear as a PS, framed one-time only.',
    },
    template_style: 'editorial',
    min_gap_days: 14,
  },
  occasion_bundle: {
    key: 'occasion_bundle',
    name: 'Occasion / seasonal bundle',
    when_to_use:
      'A festival or cultural moment on the calendar (from data/festivals.json) — let the ' +
      'occasion pick the products, e.g. a wedding pair for the season, a derby-weekend football pair.',
    mechanic:
      'Seasonal curation around the moment. Custom pairs: real catalog pricing, live compare-at values ' +
      'and the honest 10-15 day build time. Accessories: PDP link, no price. No occasion-specific codes ' +
      'may be invented.',
    applicable_product_types: ['tb', 'coffee'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'One-time seasonal purchase: "Shop the {occasion} pick".',
      subscription_priority: 'Not applicable — the one-time pair CTA holds even inside a seasonal frame.',
    },
    template_style: 'visual',
    min_gap_days: 10,
  },
};

// ─── Purchase-mode resolution ────────────────────────────────────────────────
// EVERY KNICKGASM lane is one-time: custom sneakers ('tb'), the coffee-ART
// collection ('coffee') and accessories ('supplements'). There is no
// subscription program, so 'subscription_priority' is never returned — the mode
// key survives only because downstream consumers still switch on it.
// Kept in code (not just JSON) so callers without the JSON loaded stay correct.
function purchaseModeForProductType(productType) {
  const t = String(productType || '').toLowerCase();
  if (t === 'tb' || t === 'coffee' || t === 'supplements') return 'one_time_only';
  return 'one_time_only'; // safe default: never claim a subscription
}

// ─── Load-time invariants (fail fast, never in a request path) ───────────────
for (const p of Object.values(PLAYS)) {
  if (!ALLOWED_TEMPLATE_STYLES.includes(p.template_style)) {
    throw new Error(
      `[lifecycle-cohorts] play "${p.key}" has forbidden template_style "${p.template_style}" — allowed: ${ALLOWED_TEMPLATE_STYLES.join('|')}`
    );
  }
}

module.exports = {
  COHORTS,
  PLAYS,
  ALLOWED_TEMPLATE_STYLES,
  purchaseModeForProductType,
};
