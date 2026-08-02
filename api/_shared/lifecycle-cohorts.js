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
    // Product-type rotation weights: coffee-heavy, with an occasional T&B
    // sampler as the low-commitment first step; supplements as a light touch.
    product_mix: { coffee: 4, tb: 1, supplements: 1 },
  },
  tb_buyers_non_engagers: {
    key: 'tb_buyers_non_engagers',
    label: 'Cohort B — T&B Buyers / Non-Engagers',
    objective:
      'Reactivate with familiarity, then cross-grade to Coffee/Supplements subscription. ' +
      'They bought Sneakers & Botanicals before and have gone quiet.',
    voice_guide:
      'Welcome back an old friend — acknowledge the relationship without guilt. Start from the ' +
      'sneakers they already know, then introduce what is new from the same sneaker people. Never make ' +
      'them feel watched or chased.',
    // T&B-familiar first, then coffee/supplements cross-grade.
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
      'Sensory ritual narrative — origin, one-of-one sourcing, what the first pair feels like. ' +
      'Soft mention of the 7 free gifts with every coffee order; no hard offer.',
    applicable_product_types: ['coffee', 'tb'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'Invite a single low-pressure purchase: "Try the {product}" / "Begin with one box".',
      subscription_priority:
        'Soft-lead to the product page; mention subscription pricing exists without making the ' +
        'email about it: "See the coffee" first, subscribe framing secondary.',
    },
    template_style: 'editorial',
    min_gap_days: 10,
  },
  winback_warm: {
    key: 'winback_warm',
    name: 'Warm win-back',
    when_to_use:
      'Lapsed buyers (Cohort B) — reopen the relationship with familiarity, not discounts. ' +
      'Pairs well with a seasonal moment (e.g. Wimbledon afternoon sneaker).',
    mechanic:
      '"Your box, still here" familiarity + honest compare-at prices from the store export. ' +
      'No discount codes, no urgency — the season and the memory do the work.',
    applicable_product_types: ['tb'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'Replenishment CTA: "Restock your {product}" / "Lace-up it again". One-time purchase only.',
      subscription_priority: 'Not applicable — this play is T&B (one-time) territory.',
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
      'Walk through the 7 free gifts (Electric Frother, Recipe Booklet, Plantable Paper, Colorway ' +
      'Bean Pouch, Mystery Gift of 5 Lace Sets, Wooden Scoop, Stainless Steel Straw) that come ' +
      'with EVERY coffee order, plus why airbrush in coffee — no medical claims.',
    applicable_product_types: ['coffee'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'N/A for this play — coffee is subscription-priority.',
      subscription_priority:
        'Subscription-first CTA with the value math visible: "Subscribe at £29.99" with the ' +
        '£49.99 one-time price as the honest comparison.',
    },
    template_style: 'visual',
    min_gap_days: 10,
  },
  subscription_value_math: {
    key: 'subscription_value_math',
    name: 'Subscription value math',
    when_to_use:
      'Audiences already aware of the product — make the subscription case with plain arithmetic.',
    mechanic:
      'Pack of 1: £29.99 subscription vs £49.99 one-time. Plus the subscription-only hook: ' +
      'gifts worth more than £105 across the year, arriving with refills. Numbers, calmly stated.',
    applicable_product_types: ['coffee', 'supplements'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'N/A for this play.',
      subscription_priority:
        'Primary CTA is subscribe ("Start your subscription"); one-time purchase is the quiet ' +
        'secondary option, never the headline. For supplements, never state a price — CTA to the product page.',
    },
    template_style: 'pure',
    min_gap_days: 10,
  },
  b2g1_offer: {
    key: 'b2g1_offer',
    name: 'B2G1 offer (Pack of 3)',
    when_to_use:
      'Offer-forward closer after story + education touches have landed — the strongest existing ' +
      'mechanic, used sparingly.',
    mechanic:
      'Pack of 3 subscription at £59.99 = 2 × £29.99 — buy two packs, the third is free (B2G1). ' +
      'One-time Pack of 3 is £99.99. A soft deadline ("closes Sunday") is allowed; no countdown ' +
      'clocks, no caps urgency, no invented codes.',
    applicable_product_types: ['coffee'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'N/A for this play.',
      subscription_priority:
        'Subscribe-to-the-Pack-of-3 is the single CTA: "Claim the third pack" / "Subscribe to the Pack of 3".',
    },
    template_style: 'visual',
    min_gap_days: 14,
  },
  cross_grade_launch_news: {
    key: 'cross_grade_launch_news',
    name: 'Cross-grade launch news',
    when_to_use:
      'Existing T&B buyers (Cohort B) — introduce coffee/supplements as news from the sneaker people ' +
      'they already trust: "from the sneaker people you know, our first coffee".',
    mechanic:
      'Brand-voice launch narrative anchored in the existing sneaker relationship, plus the 7 gifts ' +
      'and the £105/yr subscription gift hook as the reasons to cross over now.',
    applicable_product_types: ['coffee', 'supplements'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'N/A for this play.',
      subscription_priority:
        'Subscription-first CTA; frame as joining early from the inside track. Supplements: no prices, product-page CTA only.',
    },
    template_style: 'editorial',
    min_gap_days: 12,
  },
  new_launch_announcement: {
    key: 'new_launch_announcement',
    name: 'New-launch announcement',
    when_to_use:
      'Genuinely new products with zero purchase history (supplements) — the truthful ' +
      '"be among the first" founding-customer angle.',
    mechanic:
      'Straight launch news: what it is, why it exists, who it is for. "Be among the first" is ' +
      'TRUE and allowed for supplements. No prices for supplements — ever. No medical claims.',
    applicable_product_types: ['supplements', 'coffee'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'N/A for this play.',
      subscription_priority:
        'Subscription-first framing ("Be first — subscribe from day one"), product-page CTA; a ' +
        'T&B sampler may appear as a PS, framed one-time only.',
    },
    template_style: 'editorial',
    min_gap_days: 14,
  },
  occasion_bundle: {
    key: 'occasion_bundle',
    name: 'Occasion / seasonal bundle',
    when_to_use:
      'A festival or cultural moment on the calendar (from data/festivals.json) — let the ' +
      'occasion pick the products, e.g. Wimbledon afternoon sneaker.',
    mechanic:
      'Seasonal curation around the moment. T&B: real compare-at prices only. Coffee: existing ' +
      'subscription pricing. No occasion-specific codes may be invented.',
    applicable_product_types: ['tb', 'coffee'],
    cta_framing_by_purchase_mode: {
      one_time_only: 'One-time seasonal purchase: "Set the table" / "Shop the {occasion} pick".',
      subscription_priority: 'Subscription remains the primary CTA even inside a seasonal frame.',
    },
    template_style: 'visual',
    min_gap_days: 10,
  },
};

// ─── Purchase-mode resolution ────────────────────────────────────────────────
// T&B is strictly one-time; coffee + supplements are subscription-priority.
// Kept in code (not just JSON) so callers without the JSON loaded stay correct.
function purchaseModeForProductType(productType) {
  const t = String(productType || '').toLowerCase();
  if (t === 'tb') return 'one_time_only';
  if (t === 'coffee' || t === 'supplements') return 'subscription_priority';
  return 'one_time_only'; // safe default: never over-claim subscription
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
