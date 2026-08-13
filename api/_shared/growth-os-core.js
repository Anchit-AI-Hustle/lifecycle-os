'use strict';
/**
 * growth-os-core.js — the growth operating picture, built for ANY brand.
 * ---------------------------------------------------------------------------
 * Every brand that onboards gets the same depth of growth thinking that a good
 * product-growth lead would hand you in week one:
 *
 *   1. an experiment roadmap, scored and ordered
 *   2. a funnel audit with the leak ranked and an action against each stage
 *   3. graded audits of the surfaces that carry the conversion
 *   4. a north-star metric with its input metrics and channel metrics
 *   5. a cohort framework
 *   6. a 30-60-90 execution plan
 *   7. a day-by-day first-week playbook
 *   8. a competitive picture with a positioning read
 *
 * WHY IT IS NOT ONE HARDCODED DASHBOARD. That list is generic; the CONTENT of
 * it is not. A D2C store's funnel ends in a cart and its north star is revenue
 * per visitor. A publisher has no cart: its funnel ends in a habit, its north
 * star is return visits, and telling it to raise "average order value" is
 * noise. So the model is chosen from what the brand actually SELLS - the
 * offering kind (see offering-kinds.js) - and the copy is instantiated with
 * that brand's own offerings, regions and claims.
 *
 * WHY IT DOES NOT CALL AN LLM. This is the page a new operator opens first. It
 * has to render completely, identically and instantly for every brand, with no
 * key, no quota and no latency. Everything here is deterministic.
 *
 * ── THE DATA RULE ──────────────────────────────────────────────────────────
 * This module states where every number came from, and it never presents a
 * modelled number as a measurement. Each figure carries a `basis`:
 *
 *   measured   read from this brand's own connected data
 *   modelled   a sector benchmark, shown as a RANGE, labelled in the UI
 *   unset      nothing to show; the UI prints a dash and names the connection
 *              that would fill it
 *
 * A modelled range is never written into the `actual` field. The dashboard
 * therefore opens honest: the shape of the funnel is populated, the brand's own
 * numbers are blank until something real is connected, and the difference is
 * visible rather than implied.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * Mounted at /api/brain?action=growth-os.
 * ---------------------------------------------------------------------------
 */

const brandRuntime = require('./brand-runtime.js');
const offeringKinds = require('./offering-kinds.js');

// ── Model selection ─────────────────────────────────────────────────────────

/**
 * Tie-break order, used only when two kinds are equally represented. A
 * date-bound kind wins a tie because getting its timing wrong is unrecoverable.
 */
const KIND_PRIORITY = ['event', 'programme', 'plan', 'service', 'section', 'product'];

/**
 * A brand reaches this module in one of two shapes and they do not agree.
 *
 *   tenant zero and the presets are JSON files with `offerings`, `claims` and
 *   `market_study` at the top level;
 *
 *   a persisted workspace is a `brand_workspaces` row, and those columns do not
 *   exist on it - the extensible facts live inside `brand_data` (the convention
 *   smart-brain-plan.js already follows for offerings).
 *
 * Reading only the top level therefore works perfectly for tenant zero and
 * returns nothing for every brand an actual user onboarded, which is the worst
 * possible split: it would hand a real publisher the product funnel and an
 * empty competitive tab while looking correct in every local test.
 */
function brandField(brand, key) {
  if (!brand) return undefined;
  if (brand[key] !== undefined && brand[key] !== null) return brand[key];
  const data = brand.brand_data;
  if (data && typeof data === 'object' && data[key] !== undefined && data[key] !== null) return data[key];
  return undefined;
}

const brandOfferings = (b) => (Array.isArray(brandField(b, 'offerings')) ? brandField(b, 'offerings') : []);
const brandClaims = (b) => (Array.isArray(brandField(b, 'claims')) ? brandField(b, 'claims').filter(Boolean) : []);
const brandStudy = (b) => {
  const s = brandField(b, 'market_study');
  return (s && typeof s === 'object') ? s : null;
};
const brandCatalogSource = (b) => {
  const c = brandField(b, 'catalog_source');
  return (c && typeof c === 'object') ? c : {};
};

/**
 * Which growth model fits this brand.
 *
 * Chosen by WEIGHT of what the brand actually offers, not by mere presence.
 * Presence is the tempting rule and it is wrong: a catalogue of four products
 * plus one bundled subscription would be run as a subscription business, and a
 * publisher that lists one annual event would be run as an events business.
 * Both misread the funnel and the north star for the other ninety per cent.
 *
 * A live product feed counts as the catalogue in its own right. Where one is
 * configured, the `offerings` array holds only the extras that sit ALONGSIDE
 * the feed, so counting that array alone would let a single side service
 * outvote an entire store.
 */
function primaryKind(brand) {
  const offs = brandOfferings(brand);
  const counts = {};
  for (const o of offs) {
    if (o && offeringKinds.isKind(o.kind)) counts[o.kind] = (counts[o.kind] || 0) + 1;
  }

  const cs = brandCatalogSource(brand);
  const hasLiveFeed = cs.kind && cs.kind !== 'none' && cs.kind !== 'manual';
  if (hasLiveFeed) counts.product = (counts.product || 0) + 1000;

  const ranked = Object.entries(counts).sort(
    (a, b) => (b[1] - a[1]) || (KIND_PRIORITY.indexOf(a[0]) - KIND_PRIORITY.indexOf(b[0])),
  );
  if (ranked.length) return ranked[0][0];

  // Nothing offered yet: fall back to what the brand declared it will sell.
  const declared = Array.isArray(cs.offering_kinds) ? cs.offering_kinds : [];
  for (const k of KIND_PRIORITY) if (declared.includes(k)) return k;
  return 'product';
}

/**
 * Every model this brand could legitimately be viewed through, so the UI can
 * offer a real switch rather than a guess. A brand that both sells products and
 * runs events deserves to look at either lens.
 */
function availableKinds(brand) {
  const offs = brandOfferings(brand);
  const set = new Set(offs.map((o) => o && o.kind).filter((k) => offeringKinds.isKind(k)));
  const cs = brandCatalogSource(brand);
  if (cs.kind && cs.kind !== 'none' && cs.kind !== 'manual') set.add('product');
  for (const k of (Array.isArray(cs.offering_kinds) ? cs.offering_kinds : [])) {
    if (offeringKinds.isKind(k)) set.add(k);
  }
  if (!set.size) set.add('product');
  return KIND_PRIORITY.filter((k) => set.has(k))
    .map((k) => ({ kind: k, label: (offeringKinds.spec(k) || {}).label || k }));
}

/**
 * The funnel, per kind. `benchmark` is a modelled RANGE for the sector and is
 * always rendered as such; `actual` stays null until real data is connected.
 * `leak` marks the stage that is usually the largest single loss, which is what
 * orders the priority actions below it.
 */
const FUNNEL_MODELS = {
  product: {
    conversion_noun: 'order',
    stages: [
      { key: 'land', stage: 'Visit to offer view', benchmark: [35, 50], leak: false, note: 'Visitors who reach a specific offer rather than bouncing from the entry page.' },
      { key: 'intent', stage: 'Offer view to cart', benchmark: [6, 12], leak: true, note: 'The single largest loss in almost every catalogue. Intent forms or dies on this surface.' },
      { key: 'checkout', stage: 'Cart to checkout', benchmark: [55, 70], leak: false, note: 'Loss here is cost surprise: shipping, duties and taxes revealed late.' },
      { key: 'convert', stage: 'Checkout to purchase', benchmark: [55, 70], leak: false, note: 'Payment friction, especially for buyers outside the home region.' },
    ],
    overall: { stage: 'Session to order', benchmark: [1.2, 2.5] },
  },
  section: {
    conversion_noun: 'returning reader',
    stages: [
      { key: 'land', stage: 'Visit to article read', benchmark: [45, 65], leak: false, note: 'Readers who actually start a piece rather than bouncing off the index.' },
      { key: 'intent', stage: 'One article to two', benchmark: [12, 22], leak: true, note: 'The habit hinge. A reader who takes a second piece in one session is the one who comes back.' },
      { key: 'checkout', stage: 'Depth to newsletter signup', benchmark: [2, 5], leak: false, note: 'The only durable channel a publisher owns outright.' },
      { key: 'convert', stage: 'Signup to return within seven days', benchmark: [25, 40], leak: false, note: 'Whether the first send earns the second visit.' },
    ],
    overall: { stage: 'Visit to returning reader', benchmark: [8, 16] },
  },
  programme: {
    conversion_noun: 'retained subscriber',
    stages: [
      { key: 'land', stage: 'Visit to programme page', benchmark: [25, 40], leak: false, note: 'Whether the programme is findable from where people actually arrive.' },
      { key: 'intent', stage: 'Programme page to signup', benchmark: [8, 16], leak: true, note: 'Commitment is the ask here, not money. The page has to make the cadence feel achievable.' },
      { key: 'checkout', stage: 'Signup to first session completed', benchmark: [45, 65], leak: false, note: 'Activation. A subscriber who never completes session one effectively never joined.' },
      { key: 'convert', stage: 'First session to week four retained', benchmark: [30, 45], leak: false, note: 'Where a cadence programme is won or lost.' },
    ],
    overall: { stage: 'Visit to week-four retained', benchmark: [1.5, 4] },
  },
  plan: {
    conversion_noun: 'paid subscriber',
    stages: [
      { key: 'land', stage: 'Visit to plan page', benchmark: [15, 30], leak: false, note: 'How much of the audience ever sees the offer at all.' },
      { key: 'intent', stage: 'Plan page to checkout start', benchmark: [8, 15], leak: true, note: 'Tier clarity and the value case carry this stage.' },
      { key: 'checkout', stage: 'Checkout start to paid', benchmark: [50, 70], leak: false, note: 'Payment friction and second thoughts about the commitment.' },
      { key: 'convert', stage: 'First term to renewal', benchmark: [55, 75], leak: false, note: 'Renewal is decided by usage in the first two weeks, not by the renewal email.' },
    ],
    overall: { stage: 'Visit to paid subscriber', benchmark: [0.8, 2] },
  },
  event: {
    conversion_noun: 'registration',
    stages: [
      { key: 'land', stage: 'Visit to event page', benchmark: [30, 45], leak: false, note: 'Whether the date and the promise are visible from the entry point.' },
      { key: 'intent', stage: 'Event page to registration start', benchmark: [10, 20], leak: true, note: 'Date, place, cost and what actually happens have to be answered above the fold.' },
      { key: 'checkout', stage: 'Registration start to registered', benchmark: [55, 75], leak: false, note: 'Form length is the usual culprit.' },
      { key: 'convert', stage: 'Registered to attended', benchmark: [50, 70], leak: false, note: 'Reminder cadence in the final week decides this, not the signup flow.' },
    ],
    overall: { stage: 'Visit to attendance', benchmark: [1, 3] },
  },
  service: {
    conversion_noun: 'booking',
    stages: [
      { key: 'land', stage: 'Visit to service page', benchmark: [25, 40], leak: false, note: 'Whether the offer is reachable from the entry point.' },
      { key: 'intent', stage: 'Service page to enquiry', benchmark: [3, 8], leak: true, note: 'A high-consideration ask. Proof of past work and a clear lead time carry it.' },
      { key: 'checkout', stage: 'Enquiry to quote accepted', benchmark: [30, 50], leak: false, note: 'Response time dominates. Hours, not days.' },
      { key: 'convert', stage: 'Quote to booking', benchmark: [50, 70], leak: false, note: 'Certainty about delivery date is what closes it.' },
    ],
    overall: { stage: 'Visit to booking', benchmark: [0.5, 1.5] },
  },
};

/** North star and inputs, per kind. Ranges are modelled; actuals stay unset. */
const KPI_MODELS = {
  product: {
    north_star: { name: 'Revenue per visitor', why: 'It moves only when traffic quality, conversion and order value all improve, so it cannot be gamed by any one team.' },
    inputs: [
      { name: 'Conversion rate, all sessions', benchmark: [1.2, 2.5], unit: '%' },
      { name: 'Average order value', benchmark: null, unit: 'currency', note: 'Set from the brand catalogue once orders are connected.' },
      { name: 'Repeat purchase rate, ninety days', benchmark: [20, 35], unit: '%' },
      { name: 'Subscription or repeat-plan share of orders', benchmark: [5, 15], unit: '%' },
      { name: 'Twelve-month customer value', benchmark: null, unit: 'currency' },
    ],
  },
  section: {
    north_star: { name: 'Return visits per reader per month', why: 'A publisher is paid for habit. One-off traffic spikes flatter every other metric and change nothing.' },
    inputs: [
      { name: 'Articles per session', benchmark: [1.3, 2.2], unit: 'count' },
      { name: 'Seven-day return rate', benchmark: [18, 32], unit: '%' },
      { name: 'Newsletter signup rate per session', benchmark: [0.5, 2], unit: '%' },
      { name: 'Registered share of sessions', benchmark: [5, 20], unit: '%' },
      { name: 'Scroll depth on lead pieces', benchmark: [45, 65], unit: '%' },
    ],
  },
  programme: {
    north_star: { name: 'Subscribers active at week four', why: 'The only number that separates a programme people joined from a programme people are doing.' },
    inputs: [
      { name: 'Signup to first-session completion', benchmark: [45, 65], unit: '%' },
      { name: 'Week-four retention', benchmark: [30, 45], unit: '%' },
      { name: 'Sessions completed per subscriber per week', benchmark: null, unit: 'count' },
      { name: 'Reactivation rate after a missed week', benchmark: [15, 30], unit: '%' },
    ],
  },
  plan: {
    north_star: { name: 'Net revenue retention', why: 'It carries acquisition, churn and expansion in one number, so it cannot be flattered by a good month of signups.' },
    inputs: [
      { name: 'Visit to paid conversion', benchmark: [0.8, 2], unit: '%' },
      { name: 'Trial or first-term to renewal', benchmark: [55, 75], unit: '%' },
      { name: 'Monthly churn', benchmark: [3, 8], unit: '%' },
      { name: 'Share of subscribers active in first fourteen days', benchmark: [50, 70], unit: '%' },
    ],
  },
  event: {
    north_star: { name: 'Registrations per thousand visits', why: 'Normalises for the traffic spike every event gets, so the page and the offer are what is being judged.' },
    inputs: [
      { name: 'Event page to registration', benchmark: [10, 20], unit: '%' },
      { name: 'Registered to attended', benchmark: [50, 70], unit: '%' },
      { name: 'Repeat attendance across occurrences', benchmark: [20, 35], unit: '%' },
    ],
  },
  service: {
    north_star: { name: 'Booked value per enquiry', why: 'Ties demand generation to what was actually delivered, rather than to lead count.' },
    inputs: [
      { name: 'Service page to enquiry', benchmark: [3, 8], unit: '%' },
      { name: 'Enquiry to booking', benchmark: [20, 40], unit: '%' },
      { name: 'Median response time to an enquiry', benchmark: null, unit: 'hours' },
    ],
  },
};

/** Channel metrics are the same shape whatever the brand sells. */
const CHANNEL_METRICS = [
  { name: 'Paid social return on ad spend', connect: 'the paid social account' },
  { name: 'Paid search return on ad spend', connect: 'the search ads account' },
  { name: 'Blended acquisition cost', connect: 'ad platforms plus orders' },
  { name: 'Owned-channel revenue per contact per month', connect: 'the lifecycle platform' },
  { name: 'Organic share of new visitors', connect: 'site analytics' },
  { name: 'Second-region performance against the home region', connect: 'site analytics, split by region' },
];

// ── Surface audits ──────────────────────────────────────────────────────────

/**
 * The surfaces that carry conversion, per kind, and what to grade on each.
 *
 * Grades are deliberately NOT pre-filled. An audit is an observation, and this
 * module has not seen the brand's pages: shipping a grade here would be exactly
 * the fabrication the product forbids. Each line ships as an ungraded checklist
 * item with the test to apply, and the operator grades it.
 */
const SURFACE_AUDITS = {
  product: [
    { surface: 'Entry page', items: [
      { item: 'Value proposition', test: 'Can a first-time visitor say what you sell and who it is for, in one read, without scrolling?' },
      { item: 'Segmented entry', test: 'Is there a distinct path for someone buying for themselves and someone buying as a gift?' },
      { item: 'Owned-channel capture', test: 'Is there a reason to leave an email address above the fold, not only on exit?' },
      { item: 'Proof placement', test: 'Is the strongest verifiable claim visible before the first scroll?' },
      { item: 'Mobile load', test: 'Does the entry page reach interactive in under two and a half seconds on a mid-range phone?' },
    ] },
    { surface: 'Offer page', items: [
      { item: 'Outcome before origin', test: 'Does the first line say what the buyer gets, rather than where the item came from?' },
      { item: 'Unit framing', test: 'Is the price expressed in a unit the buyer thinks in, as well as in total?' },
      { item: 'Repeat or bundle path', test: 'Is there a route to a second item or a repeating order, and is its saving shown in money?' },
      { item: 'Delivery certainty', test: 'Is a delivery date shown, not a shipping speed?' },
      { item: 'Objection handling', test: 'Are returns, sizing and materials answered on the page rather than behind a link?' },
    ] },
  ],
  section: [
    { surface: 'Section front', items: [
      { item: 'Lead promise', test: 'Does the top of the section say what a reader gets by staying, not just what is newest?' },
      { item: 'Second-piece path', test: 'Is the next piece offered before the end of the current one?' },
      { item: 'Owned-channel capture', test: 'Is there a signup with a specific promise, rather than a generic newsletter box?' },
      { item: 'Load and interruption', test: 'Do interstitials fire before the reader has reached the first paragraph?' },
    ] },
    { surface: 'Article page', items: [
      { item: 'Time to first paragraph', test: 'How much furniture sits between the headline and the first sentence?' },
      { item: 'Attribution and date', test: 'Is every claim attributed and dated, visibly?' },
      { item: 'Related depth', test: 'Are related pieces genuinely related, or the most recent?' },
      { item: 'Registration ask', test: 'Is the ask placed after value has been delivered rather than before it?' },
    ] },
  ],
  programme: [
    { surface: 'Programme page', items: [
      { item: 'Cadence clarity', test: 'Is it obvious how often this happens and how long each session takes?' },
      { item: 'Achievability', test: 'Does the page answer "can I actually keep this up" for a beginner?' },
      { item: 'First session preview', test: 'Can someone see what session one is before committing?' },
      { item: 'Progress model', test: 'Is there a visible sense of progression rather than an open-ended feed?' },
    ] },
    { surface: 'Session one', items: [
      { item: 'Time to value', test: 'Does the first session deliver something usable on its own?' },
      { item: 'Next-step prompt', test: 'Does it end by scheduling the next one rather than just ending?' },
      { item: 'Missed-session recovery', test: 'Is there a path back in after a missed week that does not require starting over?' },
    ] },
  ],
  plan: [
    { surface: 'Plan page', items: [
      { item: 'Tier legibility', test: 'Can a visitor pick a tier in one read without comparing footnotes?' },
      { item: 'Value case', test: 'Is the benefit expressed in outcomes rather than in features?' },
      { item: 'Commitment terms', test: 'Are cancellation and renewal terms stated plainly on the page?' },
    ] },
    { surface: 'First fourteen days', items: [
      { item: 'Activation moment', test: 'Is there one defined action that predicts renewal, and is it prompted?' },
      { item: 'Unused-subscription rescue', test: 'Does anything happen when a subscriber goes quiet in week one?' },
    ] },
  ],
  event: [
    { surface: 'Event page', items: [
      { item: 'The four facts', test: 'Are date, place, cost and what happens all answered above the fold?' },
      { item: 'Registration length', test: 'How many fields stand between intent and registered?' },
      { item: 'Proof of the last one', test: 'Is there evidence of a previous occurrence for a first-time attendee?' },
    ] },
    { surface: 'Pre-event sequence', items: [
      { item: 'Reminder cadence', test: 'Is there a reminder in the final week and on the day?' },
      { item: 'Attendance friction', test: 'Are joining details reachable without searching an inbox?' },
    ] },
  ],
  service: [
    { surface: 'Service page', items: [
      { item: 'Scope clarity', test: 'Is it clear what is and is not included before an enquiry?' },
      { item: 'Evidence of past work', test: 'Is there work shown that resembles what this visitor wants?' },
      { item: 'Lead time and price band', test: 'Are both stated, at least as a range, before the form?' },
    ] },
    { surface: 'Enquiry handling', items: [
      { item: 'Response time', test: 'Is the first human reply inside the working day?' },
      { item: 'Enquiry form length', test: 'Does the form ask only what is needed to quote?' },
    ] },
  ],
};

// ── Experiment library ──────────────────────────────────────────────────────

/**
 * Growth levers, expressed as templates. `when` gates a lever to the kinds it
 * makes sense for, and `text` is instantiated with the brand's own facts, so a
 * publisher never reads an experiment about carts.
 *
 * Impact and ease are properties of the lever and are fixed. CONFIDENCE is not:
 * it is computed per brand, and it is lower when the experiment rests on a
 * number this brand has not measured. That is what stops the roadmap from
 * looking equally certain about everything on day one.
 */
const LEVERS = [
  {
    id: 'owned-capture', kinds: ['product', 'section', 'programme', 'plan', 'event', 'service'],
    name: 'Capture the exit', levers: ['cac'], impact: 8, ease: 9,
    metrics: ['Acquisition cost', 'Owned audience'],
    hypothesis: (c) => `Most of ${c.brand} traffic leaves without becoming reachable again. Offering a specific, useful reason to leave an address at exit intent converts a share of otherwise lost sessions into an owned contact, which lowers the effective cost of every later ${c.conversionNoun}.`,
    grounding: () => 'Applies to every brand: an unreachable visitor has to be bought again.',
  },
  {
    id: 'outcome-headline', kinds: ['product', 'programme', 'plan', 'service', 'event'],
    name: 'Outcome before origin', levers: ['cvr'], impact: 8, ease: 9,
    metrics: ['Conversion rate'],
    hypothesis: (c) => `The primary ${c.offerNoun} page leads with what the thing IS. Leading instead with what the visitor GETS, and moving provenance below it, should lift the ${c.leakStage.toLowerCase()} rate, because a first-time visitor buys an outcome and only a returning one cares about the making.`,
    grounding: (c) => c.offerExample ? `Tested first on ${c.offerExample}.` : 'Tested on the highest-traffic offer page.',
  },
  {
    id: 'second-piece', kinds: ['section'],
    name: 'Earn the second piece', levers: ['ltv'], impact: 9, ease: 7,
    metrics: ['Articles per session', 'Return rate'],
    hypothesis: () => 'Readers who take a second piece in one session return far more often than those who take one. Placing a genuinely related next piece before the end of the current one, rather than after it, should raise depth and with it the seven-day return rate.',
    grounding: () => 'Depth is the strongest available predictor of return for a content brand.',
  },
  {
    id: 'unit-framing', kinds: ['product', 'plan'],
    name: 'Price in the unit people think in', levers: ['cvr'], impact: 6, ease: 9,
    metrics: ['Conversion rate'],
    hypothesis: (c) => `${c.brand} shows a total price. Showing the same price in the unit the buyer actually consumes, alongside the total, reframes it from a lump sum to a small recurring cost and should lift the ${c.leakStage.toLowerCase()} rate without discounting.`,
    grounding: () => 'Requires no discount and no engineering beyond a template field.',
  },
  {
    id: 'repeat-path', kinds: ['product'],
    name: 'Make the repeat path the default', levers: ['ltv', 'cvr'], impact: 9, ease: 7,
    metrics: ['Repeat rate', 'Customer value'],
    hypothesis: (c) => `Where an offer is genuinely consumable, presenting the repeating option as the pre-selected choice, with the saving shown in money rather than as a percentage, should raise the repeat share of orders materially. Loss framing outperforms percentage framing consistently, and ${c.brand} currently asks the buyer to opt in.`,
    grounding: () => 'Only apply to offers that are genuinely repeat-eligible; a one-off purchase framed as a subscription damages trust.',
  },
  {
    id: 'bundle', kinds: ['product', 'service'],
    name: 'Complete the set', levers: ['aov'], impact: 7, ease: 6,
    metrics: ['Order value'],
    hypothesis: (c) => `Adding a companion-offer module to the top ${c.offerNoun} pages, chosen by what is genuinely used together rather than by what is merely also popular, should raise order value without touching acquisition cost.`,
    grounding: (c) => (c.hasLiveFeed
      ? 'Pairs are drawn from the connected catalogue.'
      : c.offerCount > 1 ? `The catalogue has ${c.offerCount} offerings to pair from.`
        : 'Needs at least two offerings before it can run.'),
    // There is nothing to pair on a workspace with one offering, so the lever
    // needs a precondition rather than only a grounding note that says so. A
    // live catalogue counts: its pairs exist even though the offerings array
    // beside it is short.
    requires: (c) => c.hasLiveFeed || c.offerCount > 1,
  },
  {
    id: 'delivery-certainty', kinds: ['product'],
    name: 'A date, not a speed', levers: ['cvr'], impact: 7, ease: 7,
    metrics: ['Conversion rate'],
    hypothesis: () => 'Replacing a shipping speed with a named arrival date on the offer page and in the cart removes the largest remaining unknown at the point of decision, and should lift both cart entry and checkout completion.',
    grounding: () => 'Effect is strongest on gift-intent traffic, where the date is the product.',
  },
  {
    id: 'region-parity', kinds: ['product', 'plan', 'section', 'programme', 'event', 'service'],
    name: 'Second-region parity', levers: ['cvr'], impact: 7, ease: 6,
    metrics: ['Conversion rate by region'],
    hypothesis: (c) => `${c.brand} serves ${c.regionList}. A secondary region almost always underperforms the home region for reasons that are fixable rather than structural: currency shown late, delivery or availability unclear, and trust signals written for the home market. Correcting those should close most of the gap.`,
    grounding: (c) => c.regionCount > 1 ? `${c.regionCount} regions are configured, so the comparison is available immediately.` : 'Only one region is configured, so this cannot run yet.',
    requires: (c) => c.regionCount > 1,
  },
  {
    id: 'lapse-recovery', kinds: ['product', 'plan', 'programme', 'section'],
    name: 'Reach people at the lapse point', levers: ['ltv'], impact: 8, ease: 8,
    metrics: ['Repeat rate', 'Customer value'],
    hypothesis: (c) => `A message timed to the point where a ${c.audienceNoun} typically goes quiet, rather than on a fixed calendar, recovers a meaningful share of them at close to zero marginal acquisition cost. The timing has to come from this brand's own interval, not from a default.`,
    grounding: () => 'Blocked until the real lapse interval is measured; a guessed interval performs worse than no message.',
    needsMeasurement: true,
  },
  {
    id: 'onboarding-sequence', kinds: ['plan', 'programme', 'section'],
    name: 'Earn the second visit', levers: ['ltv'], impact: 8, ease: 7,
    metrics: ['Retention', 'Activation'],
    hypothesis: (c) => `Retention for ${c.brand} is decided in the first fortnight, not at renewal. A short sequence that drives one defined activation action, rather than describing the whole offering, should raise the share still active at week four.`,
    grounding: () => 'Requires agreeing which single action predicts retention before it can be built.',
  },
  {
    id: 'proof-placement', kinds: ['product', 'plan', 'service', 'event', 'programme'],
    name: 'Move the proof up', levers: ['cvr'], impact: 6, ease: 9,
    metrics: ['Conversion rate'],
    hypothesis: (c) => `${c.brand} states ${c.claimCount} verifiable claim${c.claimCount === 1 ? '' : 's'} that currently sit below the decision point. Moving the strongest one above it should lift conversion, using only claims the brand can already stand behind.`,
    grounding: (c) => c.claimExample ? `Strongest available claim: "${c.claimExample}".` : 'Blocked until at least one verifiable claim is recorded on the brand record.',
    requires: (c) => c.claimCount > 0,
  },
  {
    id: 'intent-landing', kinds: ['product', 'plan', 'service', 'event', 'programme', 'section'],
    name: 'A page per intent', levers: ['cvr', 'cac'], impact: 8, ease: 6,
    metrics: ['Conversion rate', 'Acquisition cost'],
    hypothesis: (c) => `Paid traffic currently lands on a general page and has to navigate to the thing it was promised. Building one dedicated page per major intent, matched to the promise in the ad, should convert that traffic materially better and lower blended acquisition cost.`,
    grounding: () => 'Highest-return version of this is one page per campaign theme, not one per offering.',
  },
  {
    id: 'form-length', kinds: ['event', 'service', 'plan'],
    name: 'Cut the form', levers: ['cvr'], impact: 7, ease: 9,
    metrics: ['Conversion rate'],
    hypothesis: () => 'Every field between intent and completion costs completions. Removing fields not needed to fulfil, and collecting the rest afterwards, should raise completion with no change to demand.',
    grounding: () => 'Cheapest experiment on this list; usually a same-day change.',
  },
  {
    id: 'reminder-cadence', kinds: ['event'],
    name: 'Own the final week', levers: ['cvr'], impact: 8, ease: 8,
    metrics: ['Attendance rate'],
    hypothesis: (c) => `Attendance for ${c.brand} events is decided by the reminder sequence in the final week, not by the registration flow. A reminder at one week, one day and on the morning should raise the registered-to-attended rate.`,
    grounding: (c) => c.nextEvent ? `Next date-bound offering: ${c.nextEvent}.` : 'Runs against the next scheduled occurrence.',
  },
  {
    id: 'search-surface', kinds: ['product', 'section', 'plan', 'service'],
    name: 'Match the words people search', levers: ['cac'], impact: 6, ease: 8,
    metrics: ['Acquisition cost', 'Organic share'],
    hypothesis: (c) => `${c.brand} titles and descriptions are written in brand language. Rewriting them in the language the audience actually searches, while keeping the voice, should improve click-through and lower acquisition cost on both paid and organic surfaces.`,
    grounding: () => 'Do this without adopting any phrase the brand has banned.',
  },
  {
    id: 'response-time', kinds: ['service'],
    name: 'Answer inside the day', levers: ['cvr'], impact: 9, ease: 7,
    metrics: ['Enquiry to booking'],
    hypothesis: () => 'For a considered service the first reply time predicts the booking better than anything on the page. Guaranteeing a reply inside the working day, and saying so on the page, should lift the enquiry-to-booking rate.',
    grounding: () => 'Only promise it on the page once the operational commitment is real.',
  },
];

const LEVER_LABELS = {
  cvr: 'Conversion',
  aov: 'Order value',
  ltv: 'Retention and value',
  cac: 'Acquisition cost',
};

// ── Instantiation ───────────────────────────────────────────────────────────

function offeringNoun(kind) {
  return ({
    product: 'offer', section: 'section', programme: 'programme',
    plan: 'plan', event: 'event', service: 'service',
  })[kind] || 'offer';
}

function audienceNoun(kind) {
  return ({
    product: 'buyer', section: 'reader', programme: 'participant',
    plan: 'subscriber', event: 'attendee', service: 'client',
  })[kind] || 'customer';
}

/** Facts drawn from the brand record. Nothing here is invented. */
function contextFor(brand, kind) {
  const offs = brandOfferings(brand);
  const regions = Array.isArray(brand.regions) ? brand.regions.filter((r) => r && r.code) : [];
  const claims = brandClaims(brand);
  const split = offeringKinds.forCalendar(offs);
  const model = FUNNEL_MODELS[kind] || FUNNEL_MODELS.product;
  const leak = model.stages.find((s) => s.leak) || model.stages[1] || model.stages[0];

  return {
    brand: brand.name || 'this brand',
    kind,
    offerNoun: offeringNoun(kind),
    audienceNoun: audienceNoun(kind),
    conversionNoun: model.conversion_noun,
    leakStage: leak.stage,
    offerCount: offs.length,
    offerExample: (offs[0] && offs[0].name) || '',
    hasLiveFeed: (() => {
      const cs = brandCatalogSource(brand);
      return !!(cs.kind && cs.kind !== 'none' && cs.kind !== 'manual');
    })(),
    regionCount: regions.length,
    regionList: regions.length
      ? regions.map((r) => r.code).join(', ')
      : 'a single region',
    claimCount: claims.length,
    claimExample: claims[0] || '',
    nextEvent: (split.upcoming[0] && split.upcoming[0].name) || '',
  };
}

/**
 * Confidence, computed rather than asserted.
 *
 * Everything starts at a deliberately modest 6: on day one, with nothing
 * measured, no growth claim about a brand deserves more. It rises when the
 * experiment rests on a fact this brand has actually supplied, and falls when
 * it depends on a number nobody has measured yet.
 */
function confidenceFor(lever, ctx, hasMeasuredData) {
  let c = 6;
  if (hasMeasuredData) c += 2;
  if (lever.needsMeasurement && !hasMeasuredData) c -= 2;
  if (lever.id === 'proof-placement' && ctx.claimCount > 0) c += 1;
  if (lever.id === 'region-parity' && ctx.regionCount > 1) c += 1;
  if (lever.id === 'bundle' && ctx.offerCount > 2) c += 1;
  if (lever.id === 'reminder-cadence' && ctx.nextEvent) c += 1;
  return Math.max(1, Math.min(10, c));
}

function buildExperiments(brand, kind, hasMeasuredData) {
  const ctx = contextFor(brand, kind);
  const out = [];

  for (const lever of LEVERS) {
    if (!lever.kinds.includes(kind)) continue;

    // An experiment is blocked by a missing PRECONDITION or by a missing
    // MEASUREMENT, and both must count. Checking only `requires` let
    // lapse-recovery render as ready while its own grounding said it was
    // blocked until the real interval is measured: it entered the ready count
    // and the funnel's recommended actions for every day-one brand, telling the
    // operator to ship the one message the lever itself warns is worse than
    // nothing when the timing is guessed.
    const missingPrecondition = typeof lever.requires === 'function' && !lever.requires(ctx);
    const missingMeasurement = !!lever.needsMeasurement && !hasMeasuredData;
    const blocked = missingPrecondition || missingMeasurement;

    const confidence = confidenceFor(lever, ctx, hasMeasuredData);
    const ice = Math.round(((lever.impact + confidence + lever.ease) / 3) * 10) / 10;

    out.push({
      id: lever.id,
      name: lever.name,
      levers: lever.levers,
      lever_labels: lever.levers.map((l) => LEVER_LABELS[l] || l),
      hypothesis: brandRuntime.scrubForBrand(lever.hypothesis(ctx), brand),
      grounding: brandRuntime.scrubForBrand(
        typeof lever.grounding === 'function' ? lever.grounding(ctx) : '', brand,
      ),
      metrics: lever.metrics,
      impact: lever.impact,
      confidence,
      ease: lever.ease,
      ice,
      // "blocked" is a real state, not a soft warning: an experiment whose
      // precondition is absent must not sit in the queue looking runnable.
      status: blocked ? 'blocked' : 'ready',
      blocked_reason: !blocked ? ''
        : missingMeasurement
          ? 'Needs a measured baseline first. Connect analytics, because running this on a guessed interval performs worse than not running it.'
          : (typeof lever.grounding === 'function' ? lever.grounding(ctx) : 'A precondition is missing.'),
    });
  }

  out.sort((a, b) => (b.ice - a.ice) || a.name.localeCompare(b.name));
  return out.map((e, i) => ({ ...e, rank: i + 1 }));
}

// ── Funnel, KPIs, cohorts ───────────────────────────────────────────────────

function buildFunnel(kind, hasMeasuredData) {
  const model = FUNNEL_MODELS[kind] || FUNNEL_MODELS.product;
  const stages = model.stages.map((s) => ({
    key: s.key,
    stage: s.stage,
    actual: null,
    basis: hasMeasuredData ? 'unset' : 'modelled',
    benchmark: s.benchmark,
    benchmark_label: `${s.benchmark[0]} to ${s.benchmark[1]}%`,
    is_primary_leak: !!s.leak,
    note: s.note,
  }));
  return {
    stages,
    overall: {
      stage: model.overall.stage,
      actual: null,
      basis: 'modelled',
      benchmark: model.overall.benchmark,
      benchmark_label: `${model.overall.benchmark[0]} to ${model.overall.benchmark[1]}%`,
    },
  };
}

function buildKpis(kind, brand, hasMeasuredData) {
  const model = KPI_MODELS[kind] || KPI_MODELS.product;
  const currency = ((brand.regions || [])[0] || {}).symbol || '';
  return {
    north_star: {
      name: model.north_star.name,
      why: model.north_star.why,
      actual: null,
      basis: 'unset',
      connect: 'site analytics',
    },
    inputs: model.inputs.map((m) => ({
      name: m.name,
      actual: null,
      basis: m.benchmark ? (hasMeasuredData ? 'unset' : 'modelled') : 'unset',
      benchmark: m.benchmark,
      benchmark_label: m.benchmark
        ? (m.unit === '%' ? `${m.benchmark[0]} to ${m.benchmark[1]}%` : `${m.benchmark[0]} to ${m.benchmark[1]}`)
        : '',
      unit: m.unit === 'currency' ? (currency || 'currency') : m.unit,
      note: m.note || '',
    })),
    channels: CHANNEL_METRICS.map((c) => ({
      name: c.name, actual: null, basis: 'unset', connect: c.connect,
    })),
  };
}

function buildCohorts(kind) {
  const base = [
    {
      name: 'Acquisition cohort',
      group_by: 'First channel the person arrived through',
      track: 'Cost to acquire, first-visit behaviour, and thirty, sixty and ninety day return rate, per channel. This is what tells you which channel buys people who stay.',
    },
    {
      name: 'First-offering cohort',
      group_by: `First ${offeringNoun(kind)} the person took`,
      track: 'What they take next, value at six months, and how many convert to a repeating relationship. Some entry points produce far better long-term audiences than others, and it is rarely the most popular one.',
    },
    {
      name: 'Seasonal cohort',
      group_by: 'Month of first interaction',
      track: 'Whether people acquired in a peak period come back outside it. This is the number that decides how much a peak-season audience is really worth.',
    },
  ];
  if (kind === 'section' || kind === 'programme') {
    base.push({
      name: 'Depth cohort',
      group_by: 'How much they consumed in their first session',
      track: 'Return rate by first-session depth. It usually shows a sharp threshold, and that threshold is the activation target worth designing for.',
    });
  }
  return base;
}

// ── Plans ───────────────────────────────────────────────────────────────────

function buildPlan(brand, kind, ctx) {
  const noun = offeringNoun(kind);
  const aud = audienceNoun(kind);
  return [
    {
      phase: 'Days 1 to 30', title: 'Measure before you touch anything',
      groups: [
        { title: 'Instrument', items: [
          'Connect site analytics and confirm each funnel stage on this page has a real number behind it, split by region.',
          'Put session recording and heat mapping on the entry page, the primary ' + noun + ' page and the completion flow.',
          'Connect the lifecycle platform and export current performance for every live message.',
          `Export the last ninety days of ${ctx.conversionNoun}s with channel attribution, so the cohort views can be built.`,
        ] },
        { title: 'Look at the real thing', items: [
          `Watch thirty real sessions end to end. Watch, do not sample metrics.`,
          `Talk to eight to ten ${aud}s about what nearly stopped them.`,
          'Read the most recent negative and positive feedback you hold, and separate objections from preferences.',
          `Rank offerings by both traffic and by value. They are rarely the same list, and the gap is usually the fastest win available.`,
        ] },
        { title: 'Ship only what needs no measurement', items: [
          'Run the experiments on this page marked ready and rated easy. They do not depend on a baseline.',
          'Fix anything the surface audit grades badly on the primary ' + noun + ' page.',
        ] },
      ],
    },
    {
      phase: 'Days 31 to 60', title: 'Run the roadmap',
      groups: [
        { title: 'Test', items: [
          'Run the top-ranked experiments in parallel where they touch different surfaces, in sequence where they touch the same one.',
          'Fix the sample size and the stop date before each test starts, and write them down.',
          'Keep one surface untouched as a control while the others move.',
        ] },
        { title: 'Build', items: [
          'Build the dedicated intent pages for the campaign themes that carry the most paid spend.',
          'Build the lapse-point message once the real interval is known, not before.',
        ] },
        { title: 'Unblock', items: [
          'Clear the preconditions behind any experiment still marked blocked on this page.',
        ] },
      ],
    },
    {
      phase: 'Days 61 to 90', title: 'Scale what won, stop what did not',
      groups: [
        { title: 'Scale', items: [
          'Roll winning changes across every comparable surface, not just the tested one.',
          'Raise spend only on channels whose cohorts show the return rate holding at ninety days.',
        ] },
        { title: 'Stop', items: [
          'End losing tests and revert them. A test kept alive because it was expensive to build is the most common source of drift.',
        ] },
        { title: 'Report', items: [
          'Report what moved, what did not, and what was learned about the audience, with the numbers attached.',
          'Re-rank this roadmap with measured confidence in place of modelled confidence.',
        ] },
      ],
    },
  ];
}

function buildWeekOne(brand, kind, ctx) {
  const noun = offeringNoun(kind);
  const aud = audienceNoun(kind);
  return [
    { day: 'Days 1 and 2', title: 'Access and baseline', tasks: [
      'Get access to site analytics, the lifecycle platform, the ad accounts and the commerce or content back end.',
      'Install session recording on the entry page, the primary ' + noun + ' page and the completion flow.',
      'Pull each funnel stage on this page as a real number, split by region.',
      `Export ninety days of ${ctx.conversionNoun}s with channel attribution.`,
      'List the ten offerings with the most traffic and the ten with the most value.',
    ] },
    { day: 'Days 3 and 4', title: 'Audit and form hypotheses', tasks: [
      'Watch thirty recorded sessions, including ten that ended without completing.',
      'Grade every line of the surface audit on this page against the real pages.',
      'Review every live lifecycle message and record its actual performance.',
      'Check load time on the entry page and the top three ' + noun + ' pages, on a mid-range phone.',
      'Write the funnel up with real numbers and mark where the largest single loss actually is.',
    ] },
    { day: 'Day 5', title: 'Go through it as a customer', tasks: [
      `Complete the whole journey yourself, end to end, paying real money where that applies.`,
      'Do the same on two comparable brands and capture every step.',
      'Note where they remove doubt and where you leave it in place.',
      `Search the terms a ${aud} would actually use and record where this brand appears.`,
    ] },
    { day: 'Days 6 and 7', title: 'Prioritise and start', tasks: [
      'Re-rank the experiment roadmap on this page using what you measured, replacing modelled confidence with real confidence.',
      'Write a one-page brief for the top five: hypothesis, control, variant, metric, sample size and stop date.',
      'Agree the testing tool and start the first two.',
      'Send a summary that leads with what the data shows and ends with the five bets, so the reasoning is reviewable.',
    ] },
  ];
}

// ── Competitive picture ─────────────────────────────────────────────────────

/**
 * Built ONLY from the brand's own market_study record. When a brand has not
 * supplied one, this returns the gap rather than a plausible-looking competitor
 * set: naming a company as someone's competitor is a factual claim, and an
 * invented one is both wrong and repeatable.
 */
function buildCompetitive(brand) {
  const study = brandStudy(brand) || {};
  const markets = Object.keys(study);
  if (!markets.length) {
    return {
      available: false,
      gap: '[DATA REQUIRED BEFORE LAUNCH: market study, all, all]',
      note: 'No market study is recorded for this brand. Competitor names, market sizing and positioning are factual claims, so none are shown here until they are supplied and sourced. Add them on the brand record, or run competitor discovery for this brand.',
      markets: [],
    };
  }
  return {
    available: true,
    markets: markets.map((m) => {
      const s = study[m] || {};
      return {
        market: m,
        headline: s.headline || '',
        sizing: Array.isArray(s.sizing) ? s.sizing : [],
        tiers: Array.isArray(s.tiers) ? s.tiers : [],
        reads: Array.isArray(s.reads) ? s.reads : [],
        gaps: Array.isArray(s.gaps) ? s.gaps : [],
      };
    }),
  };
}

// ── Headline metrics ────────────────────────────────────────────────────────

/**
 * The top strip. Deliberately made of things that are TRUE for this brand on
 * day one - what it sells, where, what it can claim - rather than performance
 * figures nobody has measured. A dashboard that opens with five invented
 * numbers teaches the reader that its numbers are decorative.
 */
function headlineMetrics(brand, kind, experiments, funnel) {
  const offs = brandOfferings(brand);
  const regions = Array.isArray(brand.regions) ? brand.regions.filter((r) => r && r.code) : [];
  const claims = brandClaims(brand);
  const ready = experiments.filter((e) => e.status === 'ready');
  const leak = funnel.stages.find((s) => s.is_primary_leak);

  return [
    {
      label: 'Growth model', value: (offeringKinds.spec(kind) || {}).label || kind,
      basis: 'measured', note: 'Chosen from what this brand sells, which decides the funnel and the north star.',
    },
    // A brand with a live product feed has a catalogue even though its
    // `offerings` array is empty: that array holds only what sits ALONGSIDE the
    // feed. Reporting the array length alone would tell a store with hundreds
    // of live items that it has none on record.
    (() => {
      const cs = brandCatalogSource(brand);
      const live = cs.kind && cs.kind !== 'none' && cs.kind !== 'manual';
      if (live) {
        return {
          label: 'Catalogue', value: offs.length ? `Live feed plus ${offs.length}` : 'Live feed',
          basis: 'measured',
          note: `Pulled from ${cs.url ? String(cs.url).replace(/^https?:\/\//, '') : 'the connected product feed'}${offs.length ? ', alongside the offerings recorded by hand.' : '.'}`,
        };
      }
      return {
        label: 'Offerings on record', value: String(offs.length),
        basis: 'measured',
        note: offs.length ? 'Recorded on the brand record.' : 'None recorded, so offering-level experiments cannot run.',
      };
    })(),
    // `regions.length || 1` would invent a region for a brand that has none and
    // stamp it measured, on the exact day-one record this page exists to be
    // honest about. Report the real count, including zero.
    {
      label: 'Regions live', value: String(regions.length),
      basis: 'measured',
      note: regions.length > 1 ? 'Region parity is testable immediately.'
        : regions.length === 1 ? 'One region, so cross-region comparison is unavailable.'
          : 'No region configured, so no store URL, currency or market can be resolved for any asset.',
    },
    {
      label: 'Experiments ready', value: `${ready.length} of ${experiments.length}`,
      basis: 'measured', note: 'Ready means every precondition is already satisfied.',
    },
    {
      label: 'Largest expected leak', value: leak ? leak.stage : '',
      basis: 'modelled',
      note: 'Sector pattern, not a measurement of this brand. Confirm it against real analytics before acting.',
    },
    {
      label: 'Verifiable claims', value: String(claims.length),
      basis: 'measured',
      note: claims.length ? 'Only these may be used as proof in any asset.' : 'None recorded, so no proof claim may be used in an asset yet.',
    },
  ];
}

// ── Assembly ────────────────────────────────────────────────────────────────

/**
 * The whole picture for one brand.
 *
 * `hasMeasuredData` is a hard input, not a guess: until something real is
 * connected it stays false, and everything downstream renders as modelled.
 */
function build(brand, opts) {
  const o = opts || {};
  const b = brand || brandRuntime.defaultBrand();
  const kind = o.kind && offeringKinds.isKind(o.kind) ? o.kind : primaryKind(b);
  const hasMeasuredData = !!o.hasMeasuredData;

  const ctx = contextFor(b, kind);
  const experiments = buildExperiments(b, kind, hasMeasuredData);
  const funnel = buildFunnel(kind, hasMeasuredData);
  const competitive = buildCompetitive(b);

  const gaps = [];
  if (!((b.regions || []).filter((r) => r && r.code).length)) gaps.push('[DATA REQUIRED BEFORE LAUNCH: regions and store URLs, all, all]');
  if (!brandClaims(b).length) gaps.push('[DATA REQUIRED BEFORE LAUNCH: verifiable claims, all, all]');
  if (!brandOfferings(b).length && !brandCatalogSource(b).kind) gaps.push('[DATA REQUIRED BEFORE LAUNCH: offerings, all, all]');
  if (!competitive.available) gaps.push(competitive.gap);
  if (!hasMeasuredData) gaps.push('[DATA REQUIRED BEFORE LAUNCH: connected analytics, all, all]');

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    brand: {
      name: b.name || '', tagline: b.tagline || '', industry: b.industry || '',
      website: b.website || '', logo_url: b.logo_url || '',
      regions: (b.regions || []).filter((r) => r && r.code).map((r) => ({ code: r.code, currency: r.currency, symbol: r.symbol, store_url: r.store_url })),
    },
    model: {
      kind,
      label: (offeringKinds.spec(kind) || {}).label || kind,
      available: availableKinds(b),
      is_override: !!(o.kind && offeringKinds.isKind(o.kind) && o.kind !== primaryKind(b)),
      why: `Selected from this brand's offering kinds. ${(offeringKinds.spec(kind) || {}).lifecycle || ''}`.trim(),
      audience_noun: ctx.audienceNoun,
      conversion_noun: ctx.conversionNoun,
    },
    data_policy: {
      has_measured_data: hasMeasuredData,
      legend: {
        measured: 'Read from this brand\'s own record or connected data.',
        modelled: 'A sector benchmark shown as a range. Not a measurement of this brand.',
        unset: 'Nothing to show yet. Connect the named source to fill it.',
      },
      statement: hasMeasuredData
        ? 'Figures marked measured come from connected data. Ranges marked modelled remain sector benchmarks.'
        : 'No analytics source is connected, so this brand has no measured performance figures. Every range on this page is a sector benchmark, shown as a range and labelled modelled. Nothing here is presented as this brand\'s own result.',
    },
    headline_metrics: headlineMetrics(b, kind, experiments, funnel),
    experiments,
    lever_filters: Object.entries(LEVER_LABELS).map(([k, v]) => ({ key: k, label: v })),
    funnel,
    surface_audits: SURFACE_AUDITS[kind] || SURFACE_AUDITS.product,
    kpis: buildKpis(kind, b, hasMeasuredData),
    cohorts: buildCohorts(kind),
    plan: buildPlan(b, kind, ctx),
    week_one: buildWeekOne(b, kind, ctx),
    competitive,
    gaps,
  };
}

// ── HTTP ────────────────────────────────────────────────────────────────────

async function handle(req, res) {
  const q = (req && req.query) || {};
  const brand = await brandRuntime.resolve(req);

  // NOTE: there is deliberately no `?measured=1`. An earlier version took that
  // flag from the query string, and it was a lie switch: it relabelled the
  // honesty chips and rewrote the data-policy statement to say figures came
  // from connected data, while loading no figures at all. Anyone could hand
  // themselves a dashboard that claimed to be measured and was still empty.
  //
  // `hasMeasuredData` is therefore not something a caller can assert. It turns
  // true only when a real analytics reader is wired in and actually returns
  // values, at which point `build` receives them and stamps `basis: 'measured'`
  // on the ones it filled. Until then every performance figure stays unset and
  // every range stays labelled modelled, which is the truth.
  const payload = build(brand, { kind: q.kind });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(payload);
}

module.exports = { handle, build, primaryKind, availableKinds, FUNNEL_MODELS, KPI_MODELS, LEVERS };
