'use strict';

/**
 * Copy + business framework library.
 *
 * Grounds every KNICKGASM generator in a named, proven structure instead of a
 * blank page. This operationalizes the retention knowledge base - Chase
 * Dimond's #1 rule (knowledge/retention/01-chase-dimond.md): "Build the
 * framework library first. Every future brief starts by picking a framework
 * (PAS, AIDA, BAB, 4Ps, FAB, star-story-solution)."
 *
 * Two layers:
 *   1. COPY_FRAMEWORKS - how a single email is STRUCTURED (the beats).
 *   2. STRATEGY_FRAMEWORKS - the business logic behind WHAT to send and how
 *      hard to push (hammer-vs-nurture, RFM whale/minnow, discount ladder,
 *      three multipliers, brand-first performance, merchandising-is-retention).
 *
 * Callers pick a framework deterministically (same inputs → same choice, so
 * plans are reproducible) and inject its brief block into the LLM prompt. The
 * chosen framework key is carried on the output so previews can show it.
 *
 * Pure data + pure functions. No I/O, no provider calls. Safe to require from
 * any _shared module.
 */

// Deterministic hash (same algorithm as lifecycle-calendar-generate.stableIndex).
function stableIndex(str, n) {
  if (n <= 1) return 0;
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

// ─── Layer 1: copywriting frameworks ─────────────────────────────────────────
// Each: key, name, full (expanded acronym), beats (ordered steps with a KNICKGASM
// gloss), when_to_use, example (a filled-in ecommerce line per Dimond's rule),
// source (KB attribution).

const COPY_FRAMEWORKS = {
  pas: {
    key: 'pas',
    name: 'PAS',
    full: 'Problem, Agitate, Solution',
    beats: [
      ['Problem', 'Name the small friction the reader already feels - the flat afternoon, the box gone cold, the same tired pair.'],
      ['Agitate', 'Make the cost of it vivid and human, never fear-based. No medical or anxiety claims - just the quiet ache of a duller ritual.'],
      ['Solution', 'Present the product as the calm resolution, with one clear next step.'],
    ],
    when_to_use: 'Win-back and problem-aware audiences; supplement and coffee benefit stories where a felt need already exists.',
    example: 'Problem: the 3pm slump. Agitate: another tote of nothing. Solution: a steadier pair of Coffee Collection.',
    source: 'Chase Dimond swipe library (01-chase-dimond.md)',
  },
  bab: {
    key: 'bab',
    name: 'BAB',
    full: 'Before, After, Bridge',
    beats: [
      ['Before', 'Their world today - honest, familiar, no judgement.'],
      ['After', 'The better ordinary once the ritual lands - sensory, specific, believable.'],
      ['Bridge', 'The product as the short path from one to the other, with a single CTA.'],
    ],
    when_to_use: 'Brand introductions, cross-grade (sneaker to coffee), and subscription framing - anywhere a gentle transformation reads true.',
    example: 'Before: a rushed morning. After: five slow minutes that are yours. Bridge: the coffee that makes the pause worth it.',
    source: 'Chase Dimond swipe library (01-chase-dimond.md)',
  },
  aida: {
    key: 'aida',
    name: 'AIDA',
    full: 'Attention, Interest, Desire, Action',
    beats: [
      ['Attention', 'A sensory hook in the first line - a scent, a sound, a moment.'],
      ['Interest', 'Why it is relevant now - the launch, the season, the reason to read on.'],
      ['Desire', 'Make it wanted with proof: sourcing, the gifts, honest prices.'],
      ['Action', 'One clear CTA, no competing links.'],
    ],
    when_to_use: 'Launch announcements and offer-forward closers where momentum matters.',
    example: 'Attention: a new colorway from the sneaker people you know. Interest: our first coffee. Desire: 7 gifts in every box. Action: see the coffee.',
    source: 'Chase Dimond swipe library (01-chase-dimond.md)',
  },
  fourps: {
    key: 'fourps',
    name: '4Ps',
    full: 'Promise, Picture, Proof, Push',
    beats: [
      ['Promise', 'The outcome the reader gets, stated plainly.'],
      ['Picture', 'Paint it - the ritual, the table, the morning.'],
      ['Proof', 'The evidence: the value math, the 7 gifts, the honest compare-at prices, the sourcing.'],
      ['Push', 'The ask, framed by the play\'s CTA rule.'],
    ],
    when_to_use: 'Subscription value-math, B2G1 and any offer where proof carries the decision.',
    example: 'Promise: the same pair for less. Picture: it arrives before you run out. Proof: £29.99 a pack on subscription vs £49.99, gifts worth over £105 a year. Push: start your subscription.',
    source: 'Chase Dimond swipe library (01-chase-dimond.md)',
  },
  fab: {
    key: 'fab',
    name: 'FAB',
    full: 'Feature, Advantage, Benefit',
    beats: [
      ['Feature', 'What it is - the concrete thing in the box.'],
      ['Advantage', 'What that does differently.'],
      ['Benefit', 'What it means for the reader\'s day.'],
    ],
    when_to_use: 'Education and unboxing sends where showing beats telling - walk each gift or product detail through F to B.',
    example: 'Feature: an electric frother in every order. Advantage: cafe foam at home. Benefit: the ritual feels like a treat, not a chore.',
    source: 'Chase Dimond swipe library (01-chase-dimond.md)',
  },
  sss: {
    key: 'sss',
    name: 'Star-Story-Solution',
    full: 'Star, Story, Solution',
    beats: [
      ['Star', 'The hero of the email - a one-of-one panel, a ritual, the coffee itself. The brand speaks as "we"; there is no founder or personal narrator.'],
      ['Story', 'Its origin and journey - where it is grown, how it is made, why it exists.'],
      ['Solution', 'Invite the reader into that story with one warm CTA.'],
    ],
    when_to_use: 'Origin and brand-story sends and editorial tone, where trust must precede any offer.',
    example: 'Star: a studio in the studio archives. Story: hand-painted, one-of-one, laced slowly. Solution: begin with one box.',
    source: 'Chase Dimond swipe library (01-chase-dimond.md)',
  },
};

// Preferred copy framework per lifecycle PLAY (lifecycle-cohorts.js keys).
const PLAY_FRAMEWORK = {
  brand_story_intro:       'sss',
  winback_warm:            'bab',
  gifts_unboxing_education:'fab',
  subscription_value_math: 'fourps',
  b2g1_offer:              'aida',
  cross_grade_launch_news: 'bab',
  new_launch_announcement: 'aida',
  occasion_bundle:         'fourps',
};

// Preferred copy framework per Plan-Calendar CONTENT TYPE (calendar-generate).
const CONTENT_TYPE_FRAMEWORK = {
  Launch:     'aida',
  Sale:       'fourps',
  Offer:      'fourps',
  Gift:       'fab',
  Seasonal:   'fourps',
  Bestseller: 'fab',
  Routine:    'bab',
  Discovery:  'sss',
  Education:  'fab',
  Story:      'sss',
  Winback:    'bab',
  Reactivation:'bab',
};

const FRAMEWORK_ORDER = ['sss', 'bab', 'pas', 'fab', 'aida', 'fourps'];

function frameworkByKey(k) {
  return COPY_FRAMEWORKS[String(k || '').toLowerCase()] || null;
}

// Deterministic pick for lifecycle mailers. An explicit override wins; then the
// play preference; else a stable hash rotation keyed by the slot so re-runs of
// the same plan always choose the same framework.
function pickCopyFramework({ framework = null, play_key = '', cohort_key = '', seed = '' } = {}) {
  const forced = frameworkByKey(framework);
  if (forced) return forced;
  const pref = PLAY_FRAMEWORK[play_key];
  if (pref && COPY_FRAMEWORKS[pref]) return COPY_FRAMEWORKS[pref];
  const key = FRAMEWORK_ORDER[stableIndex(`${seed}|${cohort_key}|${play_key}`, FRAMEWORK_ORDER.length)];
  return COPY_FRAMEWORKS[key];
}

// Deterministic pick for the Plan Calendar (RFM segments + content types).
function pickCopyFrameworkForCalendar({ framework = null, content_type = '', segment = '', seed = '' } = {}) {
  const forced = frameworkByKey(framework);
  if (forced) return forced;
  const pref = CONTENT_TYPE_FRAMEWORK[content_type];
  if (pref && COPY_FRAMEWORKS[pref]) return COPY_FRAMEWORKS[pref];
  const key = FRAMEWORK_ORDER[stableIndex(`${seed}|${segment}|${content_type}`, FRAMEWORK_ORDER.length)];
  return COPY_FRAMEWORKS[key];
}

// Multi-line brief block to append to the LLM user message.
function copyFrameworkBriefBlock(fw) {
  if (!fw) return '';
  const beats = fw.beats.map(([n, g], i) => `  ${i + 1}. ${n} - ${g}`).join('\n');
  return [
    `COPYWRITING FRAMEWORK - structure this email as ${fw.name} (${fw.full}):`,
    beats,
    `Map the framework onto the fields: the hero_headline + hero_subline carry the opening beat, the body_blocks walk the middle beats in order (one beat per block, in sequence), and the final beat lands on the cta_text. Do not name the framework in the copy - let the structure do the work.`,
    `Worked example (do not copy verbatim): ${fw.example}`,
  ].join('\n');
}

// One compact line for the system prompt.
function copyFrameworkSystemLine(fw) {
  if (!fw) return '';
  return `Structure the copy with the ${fw.name} framework (${fw.full}); the body_blocks must follow its beats in order.`;
}

// A compact menu directive for generators that pick their own framework
// (Mailer Studio). Lists the library and enforces Dimond's "framework-first"
// rule without prescribing which one.
function frameworkMenuDirective() {
  const menu = FRAMEWORK_ORDER.map((k) => {
    const f = COPY_FRAMEWORKS[k];
    return `${f.name} (${f.full})`;
  }).join('; ');
  return `COPYWRITING FRAMEWORK - do not write from scratch. First silently choose the single best-fit framework for this brief from: ${menu}. Then structure the email to that framework's beats in order (opening beat in the hero, middle beats across the sections, final beat on the CTA). Never name the framework in the copy.`;
}

// ─── Layer 2: business / strategy frameworks ─────────────────────────────────
// The logic behind WHAT to send and how hard to push. Sourced from the
// retention KB. These set the offer posture, not the sentence structure.

const STRATEGY_FRAMEWORKS = {
  hammer_vs_nurture: {
    key: 'hammer_vs_nurture',
    name: 'Hammer vs Nurture',
    idea: 'Match send intensity to intent. Engaged, high-intent contacts can take a direct offer ("hammer"); cold or lapsed contacts need value and story first ("nurture"). Mismatching burns deliverability and trust.',
    source: 'Jimmy Kim (03-jimmy-kim.md)',
  },
  rfm_priority: {
    key: 'rfm_priority',
    name: 'RFM whale / minnow priority',
    idea: 'Not every contact is worth the same touch. Prioritize by Recency, Frequency, Monetary value - spend the richest creative and the best offers where lifetime value is highest, and keep cold-list touches low-cost and low-pressure.',
    source: 'Drew Sanocki (04-drew-sanocki.md)',
  },
  three_multipliers: {
    key: 'three_multipliers',
    name: 'Three Multipliers',
    idea: 'Revenue = buyers x average order value x purchase frequency. Every campaign should move at least one lever deliberately: acquire a first order, lift AOV (bundles, Pack of 3), or raise frequency (subscription, replenishment).',
    source: 'Drew Sanocki (04-drew-sanocki.md)',
  },
  discount_ladder: {
    key: 'discount_ladder',
    name: 'Discount ladder',
    idea: 'Earn the sale with value before price. Climb the ladder in order: content and story, then education and proof, then existing mechanics (subscription pricing, B2G1, the 7 gifts) - only then any price lever. Never invent new codes.',
    source: 'Retention resource library (00-resource-library.md)',
  },
  brand_first_performance: {
    key: 'brand_first_performance',
    name: 'Brand-first performance',
    idea: 'Lead with brand codes, sourcing and education rather than discount hooks. It produces customers with better retention curves, not just cheaper clicks.',
    source: 'Cody Plofker (05-cody-plofker.md)',
  },
  merchandising_is_retention: {
    key: 'merchandising_is_retention',
    name: 'Merchandising is retention',
    idea: 'The reason a lapsed customer re-buys is usually the offer and its presentation, not the automation that delivered it. Treat the bundle, the gift stack and the page as retention levers.',
    source: 'Ari Murray (08-ari-murray.md)',
  },
};

// Which strategy frameworks apply to each lifecycle cohort, plus a one-line
// posture the brief should honour.
const COHORT_STRATEGY = {
  non_buyers_non_engagers: {
    frameworks: ['hammer_vs_nurture', 'brand_first_performance', 'discount_ladder', 'three_multipliers'],
    posture: 'NURTURE, not hammer. Cold and never-purchased: lead with brand codes, sourcing and story; climb the discount ladder slowly (value and the 7 gifts before any price lever). The multiplier in play is acquiring a first order - one clear, low-pressure step.',
  },
  tb_buyers_non_engagers: {
    frameworks: ['hammer_vs_nurture', 'merchandising_is_retention', 'three_multipliers', 'rfm_priority'],
    posture: 'Warm nurture toward cross-grade. They already bought sneaker, so reopen with familiarity, then let merchandising (the coffee bundle, the 7 gifts, the £105/yr subscription value) do the persuading. The multipliers in play are frequency and AOV via subscription - never a guilt or urgency hammer.',
  },
};

function strategyStanceForCohort(cohortKey) {
  return COHORT_STRATEGY[cohortKey] || null;
}

function strategyBriefBlock(cohortKey) {
  const s = strategyStanceForCohort(cohortKey);
  if (!s) return '';
  const named = s.frameworks.map((k) => STRATEGY_FRAMEWORKS[k] && STRATEGY_FRAMEWORKS[k].name).filter(Boolean).join(', ');
  return [
    `STRATEGY POSTURE (business frameworks: ${named}):`,
    `- ${s.posture}`,
  ].join('\n');
}

module.exports = {
  COPY_FRAMEWORKS,
  STRATEGY_FRAMEWORKS,
  PLAY_FRAMEWORK,
  CONTENT_TYPE_FRAMEWORK,
  COHORT_STRATEGY,
  frameworkByKey,
  pickCopyFramework,
  pickCopyFrameworkForCalendar,
  copyFrameworkBriefBlock,
  copyFrameworkSystemLine,
  frameworkMenuDirective,
  strategyStanceForCohort,
  strategyBriefBlock,
  stableIndex,
};
