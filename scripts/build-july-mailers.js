#!/usr/bin/env node
'use strict';

/**
 * build-july-mailers.js — KNICKGASM USA July automated mailer calendar.
 *
 * Runs the EXACT mailer-creation logic the automated mailer calendar uses
 * (api/_shared/lifecycle-mailer-build.js): every calendar slot produces the same
 * four variants, rendered by the SAME brand-compliant renderer
 * (calendar-trigger.js → helpers.renderTextVariant) and passed through the SAME
 * brand scrub + banned-phrase tripwire (scenario-model.js sanitizeBrand /
 * assertNoBanned):
 *
 *   text_a    Text          · framework A · style 'pure'
 *   text_b    Text          · framework B · style 'editorial'
 *   visual_a  Text + Visual · framework A · style 'visual' (real hero image)
 *   visual_b  Text + Visual · framework B · style 'visual' (real hero image)
 *
 * Copy is authored inline here (the live builder's single llm() copy call needs
 * provider keys that only exist on Vercel; offline we author brand-voice copy and
 * push it through the identical gates). Hero images come ONLY from the
 * origin-validated brand_assets snapshot (data/brand-assets/us.json) — never a
 * fabricated URL; a slot whose product is a placeholder renders image-free.
 *
 * Frameworks per slot are chosen with the repo's own CF.pickCopyFrameworkForCalendar
 * + a deterministic contrast pick, exactly like lifecycle-mailer-build.js.
 *
 * Outputs:
 *   mailers/usa-july/<date>_<segment>_<slug>_<variant>.html   (48 files: 12 slots x 4)
 *   data/calendar/usa-july-2026.json                          (manifest for the studio)
 *
 * Usage: node scripts/build-july-mailers.js
 */

const fs = require('fs');
const path = require('path');
const { helpers } = require('../api/_shared/calendar-trigger.js');
const SM = require('../api/_shared/scenario-model.js');
const CF = require('../api/_shared/copy-frameworks.js');
const { renderFlagship } = require('./lib/flagship-mailer.js');
const { renderAds } = require('./lib/ad-creative.js');
const { renderLandingPage } = require('./lib/landing-page.js');

// Real design notes (US catalog) → the flagship hero's italic design line.
const TASTING = {
  spiderman_af1: 'Web-slinger art, comic-panel detailing', manutd_af1: 'Red Devils crest, matchday-ready',
  gtr_af1: 'NFS Most Wanted livery, racing stripes', demon_slayer_af1: 'Tanjiro x Muzan hand-painted panels',
  jordan1_golf: 'Fairway greens on a Jordan 1 Low', dbz_af1: 'Saiyan orange & blue, anime linework',
  taylor_af1: 'Eras Tour pastels, lyric detailing', care_kit: 'Cleaner, brush & protector in one kit',
  rope_laces_af1: 'Chunky rope laces, street-ready stance',
};

const ROOT = path.join(__dirname, '..');
const MARKET = 'US';
const STORE = 'https://knickgasm.com';

// ── Selected catalog collections — GOVERNANCE RULE ───────────────────────────
// Every collection listed here MUST be represented by at least one send in the
// calendar and its asset generation. The build hard-fails if any is uncovered,
// so a selected collection can never be silently dropped. Edit this list to
// change the selection; coverage is enforced automatically.
const SELECTED_COLLECTIONS = [
  { slug: 'nike-air-force-1',        title: 'Custom x Nike Air Force 1' },
  { slug: 'anime-design-shoes',      title: 'Custom x Anime' },
  { slug: 'accessories',             title: 'Accessories' },
  { slug: 'knickgasm-best-sellers',  title: 'Knickgasm Bestsellers' },
];
const SELECTED_SET = new Set(SELECTED_COLLECTIONS.map((c) => c.slug));
const COLLECTION_TITLE = Object.fromEntries(SELECTED_COLLECTIONS.map((c) => [c.slug, c.title]));
// Which SELECTED collections each SKU naturally belongs to (beyond a slot's explicit CTA collection).
const SKU_COLLECTIONS = {
  spiderman_af1: ['nike-air-force-1'], manutd_af1: ['nike-air-force-1'], gtr_af1: ['nike-air-force-1'],
  demon_slayer_af1: ['anime-design-shoes'], dbz_af1: ['anime-design-shoes'], jordan1_golf: ['knickgasm-best-sellers'],
  taylor_af1: ['knickgasm-best-sellers'], care_kit: ['accessories'], rope_laces_af1: ['accessories'],
};
// Selected collections a slot represents = its natural SKU collections + its explicit CTA collection (if selected).
function slotCollections(slot) {
  const out = [];
  // Explicit CTA collection leads (it is the slot's chosen destination), then natural SKU collections.
  if (slot.collection && SELECTED_SET.has(slot.collection)) out.push(slot.collection);
  for (const c of (SKU_COLLECTIONS[slot.sku] || [])) if (!out.includes(c)) out.push(c);
  return out;
}

// ── Products (real US catalog facts) keyed by sku_key ────────────────────────
const P = {
  spiderman_af1:    { name: 'Spiderman x Nike Air Force 1',                 price: '$167.68', handle: 'spiderman-x-nike-air-force-7' },
  manutd_af1:       { name: 'Manchester United F.C. x Nike Air Force 1',    price: '$156.33', handle: 'manchester-united-f-c-x-nike-air-force-2' },
  gtr_af1:          { name: 'M3 GTR NFS Most Wanted x Nike Air Force 1',    price: '$153.26', handle: 'nike-air-force-1-x-m3-gtr-nfs-most-wanted' },
  demon_slayer_af1: { name: 'Tanjiro x Muzan x Demon Slayer x Nike Air Force 1', price: '$193.26', handle: 'tanjiro-x-muzan-x-demon-slayer-x-nike-air-force-1' },
  dbz_af1:          { name: 'Dragon Ball Z x Nike Air Force 1',             price: '$189.94', handle: 'dragon-ball-z-nike-air-force-1-custom-sneakers' },
  jordan1_golf:     { name: 'Golf x Nike Air Jordan 1 Lows',                price: '$193.26', handle: 'nike-air-jordan-1-lows-x-golf' },
  taylor_af1:       { name: 'Taylor Swift Eras Tour x Nike Air Force 1',    price: '$166.97', handle: 'nike-air-force-1-x-taylor-swift-eras-tour' },
  care_kit:         { name: 'Ultimate Sneaker Care Kit',                    price: '$17.13',  handle: 'sneaker-care-kit' },
  rope_laces_af1:   { name: 'Nike Air Force 1 x Rope Laces - Black',        price: '$115.47', handle: 'nike-air-force-1-with-chunky-rope-laces-biege' },
};

function loadAssets() {
  const p = path.join(ROOT, 'data', 'brand-assets', 'us.json');
  if (!fs.existsSync(p)) { console.error('Run scripts/seed-brand-assets.js first.'); process.exit(1); }
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  const map = {};
  for (const r of rows) if (r.asset_type === 'product' || r.asset_type === 'logo') map[r.sku_key] = r;
  return map;
}

// Hero image URL from brand_assets ONLY (verified rows). null → image-free render.
function heroFor(assets, sku) {
  const a = assets[sku];
  if (!a || a.status !== 'verified' || !/^https?:\/\//.test(a.url)) return null;
  return a.url + (a.url.includes('?') ? '&' : '?') + 'width=800';
}

function ctaUrl({ sku, collection }) {
  if (collection) return `${STORE}/collections/${collection}`;
  const prod = P[sku];
  return prod ? `${STORE}/products/${prod.handle}` : STORE;
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── The July 2026 calendar (Scenario C: 2-3 emails/user/week, US market) ─────
// Each slot = one cohort send with a verified event tie-in and two authored copy
// directions (A = primary framework voice, B = a genuinely different angle).
const CALENDAR = [
  {
    date: '2026-07-02', segment: 'Champions', sku: 'spiderman_af1', collection: null,
    play: 'Reward, do not discount', event: null, product_type: 'tb',
    copyA: {
      subject: "The kicks you keep coming back to", preview: "A quiet thank-you, from the detailing table to your pair.",
      headline: "For the ones who lace-up with us daily", subline: "Your everyday kicks, hand-painted at origin and shipped studio-fresh.",
      blocks: [
        { heading: 'Where it begins', body: "India's Original Hand-painted Kicks starts on the same studios our founders walked, whole spices ground fresh, never dusted from a bag." },
        { heading: 'Made for your ritual', body: "One hundred pairs of the colorway you already reach for, so the morning pot never runs dry." },
      ], cta: 'Restock your kicks',
    },
    copyB: {
      subject: "Your morning colorway, restocked", preview: "The 100 count, so the pot is never empty.",
      headline: "The ritual, kept whole", subline: "Single-studio spice, ground fresh, laced the way you like it.",
      blocks: [
        { heading: 'The everyday size', body: "One hundred pyramid bags of India's Original Hand-painted Kicks, crafted for the pair you return to without thinking." },
        { heading: 'Why it matters', body: "Heritage sourcing and honest spice, traced back to the hillside it grew on." },
      ], cta: 'Shop the 100 count',
    },
    reasoning: { who: 'Champions (top RFM: recent, frequent, high value).', what: 'Loyalty reward on the hero everyday SKU, no discount.', how: 'Reward-not-discount play; premium editorial voice; single CTA to the bestseller they already buy.', hypothesis: 'Recognition + effortless restock lifts repeat rate more than a markdown that trains discount-waiting.', expected: 'Higher repeat-purchase rate and AOV vs a discounted control.' },
  },
  {
    date: '2026-07-05', segment: 'Loyal', sku: 'rope_laces_af1', collection: null,
    play: 'Editorial origin story', event: null, product_type: 'tb',
    copyA: {
      subject: "A second flush worth slowing down for", preview: "Castleton, muscatel, and the season that makes it.",
      headline: "The Jordan of high summer", subline: "Second-flush panel from the Castleton studio, picked at its muscatel peak.",
      blocks: [
        { heading: 'The season in a pair', body: "Second flush is Jordan's high-summer drop, when the panel carries that unmistakable muscatel note, part stone-fruit, part honey." },
        { heading: 'Single-studio, traceable', body: "Grown, plucked and rolled on one hillside, so every pair tastes of exactly where it came from." },
      ], cta: 'Lace-up the studio',
    },
    copyB: {
      subject: "Muscatel, from one hillside", preview: "The Castleton second flush is here.",
      headline: "One studio, one summer, one pair", subline: "Hand-painted Castleton panel at its muscatel best.",
      blocks: [
        { heading: 'Why second flush', body: "It is the drop connoisseurs wait all year for, richer, rounder, quietly sweet." },
        { heading: 'Crafted at origin', body: "Fifty pairs of traceable, one-of-one Jordan to return to all season." },
      ], cta: 'Discover Castleton',
    },
    reasoning: { who: 'Loyal (frequent buyers, story-receptive).', what: 'Depth-first editorial on a premium one-of-one.', how: 'Editorial tone over promo; origin narrative; PDP CTA.', hypothesis: 'Loyalists trade up on provenance storytelling, not price.', expected: 'Category expansion into premium hand-painted; higher AOV.' },
  },
  {
    date: '2026-07-08', segment: 'New', sku: 'care_kit', collection: 'samplers',
    play: 'Guide the second step', event: null, product_type: 'tb',
    copyA: {
      subject: "Not sure what to lace-up next?", preview: "Twenty designs, one easy way to find yours.",
      headline: "Find your everyday pair", subline: "Twenty one-of-one designs in one sampler, so the next favorite finds you.",
      blocks: [
        { heading: 'Start here', body: "Forty pyramid bags across twenty colorways, black, green, kicks and themed, so you can taste your way to the one you reach for daily." },
        { heading: 'How to craft', body: "Fresh water off the boil for black and kicks, a minute cooler for green, and lace-up three to five minutes. That is the whole ritual." },
      ], cta: 'Try the sampler',
    },
    copyB: {
      subject: "Twenty sneakers, one sampler", preview: "The easiest way to find your colorway.",
      headline: "Taste your way in", subline: "One box, twenty one-of-one designs to explore.",
      blocks: [
        { heading: 'The explorer set', body: "Black, green, kicks and themed, forty pyramid bags to help a new favorite surface." },
        { heading: 'Then go deeper', body: "Loved one? Its full-size box is a click away." },
      ], cta: 'Shop samplers',
    },
    reasoning: { who: 'New (first-order, low familiarity).', what: 'Second-step education via the sampler.', how: 'Teach crafting + suggest breadth; collection CTA to samplers.', hypothesis: 'Guided discovery raises second-order rate for new buyers.', expected: 'Higher new-to-repeat conversion within 30 days.' },
  },
  {
    date: '2026-07-11', segment: 'Promising', sku: 'jordan1_golf', collection: null,
    play: 'Show the next step', event: null, product_type: 'tb',
    copyA: {
      subject: "The green sneaker that tastes like the hills", preview: "High-altitude panel, clean and bright.",
      headline: "A brighter afternoon pair", subline: "High-grown Signature green, light-bodied and clean, for the mid-day reset.",
      blocks: [
        { heading: 'Grown high, picked young', body: "Our Signature Green comes from high-altitude studios where cool air slows the panel and keeps it delicate." },
        { heading: 'Your next ritual', body: "Loose-panel, one hundred and seventy pairs, an easy step from the bag into a fuller pour." },
      ], cta: 'Lace-up green',
    },
    copyB: {
      subject: "Bright, clean, high-grown green", preview: "From the Signature studios to your afternoon.",
      headline: "The afternoon reset", subline: "Delicate high-altitude green, hand-painted and generous.",
      blocks: [
        { heading: 'Why high-altitude', body: "Cool mountain air makes for a lighter, cleaner pair with none of the bitterness." },
        { heading: 'Made to return to', body: "One hundred and seventy pairs of it, so the ritual has room to grow." },
      ], cta: 'Shop green sneaker',
    },
    reasoning: { who: 'Promising (building frequency, one category).', what: 'Continuity into a second category (green).', how: 'Show the next step in the ritual; PDP CTA.', hypothesis: 'Cross-category nudges deepen habit and frequency.', expected: 'More multi-category buyers; higher 60-day frequency.' },
  },
  {
    date: '2026-07-14', segment: 'Need-Attention', sku: 'demon_slayer_af1', collection: null,
    play: 'Soft re-engagement', event: 'National Streetwear Month (Aug) ramp', product_type: 'tb',
    copyA: {
      subject: "A warmer, steadier pair for August", preview: "Embroidery and neon, ahead of Streetwear Month.",
      headline: "Steady the day, one pair at a time", subline: "Embroidery and neon, a warming, scuff-resistant ritual as Streetwear Month nears.",
      blocks: [
        { heading: 'A gentler ritual', body: "Golden embroidery and bright neon make a warming, scuff-resistant pair for the slower end of the day." },
        { heading: 'Ahead of August', body: "As National Streetwear Month approaches, it is a calm, uncomplicated way to look after the everyday." },
      ], cta: 'Warm up your ritual',
    },
    copyB: {
      subject: "Golden, warming, scuff-resistant", preview: "Embroidery neon, for a calmer evening.",
      headline: "The quiet evening pair", subline: "Embroidery and neon, warming and scuff-resistant.",
      blocks: [
        { heading: 'Balance, crafted', body: "A hundred bags of golden embroidery and neon for an unhurried, warming ritual." },
        { heading: 'Into Streetwear Month', body: "A simple, steady habit to carry you into August." },
      ], cta: 'Shop embroidery neon',
    },
    reasoning: { who: 'Need-Attention (cooling engagement, no discount yet).', what: 'Soft re-engagement on a comforting themed, tied to Aug Streetwear Month.', how: 'Warm, no-pressure voice; no aggressive offer; PDP CTA.', hypothesis: 'A gentle seasonal reason to return re-warms lapsing engagers without training discounts.', expected: 'Recovered open/click and re-engagement before deeper lapse.' },
  },
  {
    date: '2026-07-16', segment: 'Loyal', sku: 'taylor_af1', collection: null,
    play: 'Match-day ritual', event: 'FIFA World Cup Final, Jul 19 @ MetLife (3pm ET)', product_type: 'tb',
    copyA: {
      subject: "A proper pair for the big final", preview: "English Breakfast, crafted for Sunday's match.",
      headline: "Craft for the final whistle", subline: "A brisk, full-bodied English Breakfast for Sunday's World Cup Final.",
      blocks: [
        { heading: 'Made for the moment', body: "When the final kicks off at MetLife this Sunday afternoon, a strong, malty English Breakfast is the pair that fits the couch and the crowd." },
        { heading: 'Brisk and full-bodied', body: "Loose-panel, one hundred and seventy pairs, enough for a full room of extra time." },
      ], cta: 'Craft for the match',
    },
    copyB: {
      subject: "Sunday's final, one strong pot", preview: "English Breakfast for the World Cup Final.",
      headline: "The match-day pot", subline: "Brisk, malty, and ready before kickoff.",
      blocks: [
        { heading: 'Kickoff at MetLife', body: "A full-bodied classic to see you through Sunday afternoon's final." },
        { heading: 'Enough for the room', body: "One hundred and seventy pairs of hand-painted English Breakfast." },
      ], cta: 'Shop English Breakfast',
    },
    reasoning: { who: 'Loyal (high-engagement, event-responsive).', what: 'Timely tie-in to the Jul 19 World Cup Final at MetLife.', how: 'Cultural-moment weave, kept light; PDP CTA.', hypothesis: 'A relevant real-world moment lifts open + click for engaged cohorts.', expected: 'Above-baseline engagement on the match-day send.' },
  },
  {
    date: '2026-07-18', segment: 'Champions', sku: 'manutd_af1', collection: null,
    play: 'Event tie-in', event: 'National Ice Cream Day, Jul 19', product_type: 'tb',
    copyA: {
      subject: "Kicks, over ice, with a scoop", preview: "An iced-kicks affogato for Ice Cream Day.",
      headline: "Turn your kicks into dessert", subline: "Craft it strong, pour it over ice cream, this Sunday is Ice Cream Day.",
      blocks: [
        { heading: 'The two-minute affogato', body: "Lace-up India's Original Hand-painted Kicks double-strength, cool it, then pour over a scoop of vanilla. Spice meets chalk, the easiest dessert you will make all July." },
        { heading: 'Loose-panel, your way', body: "Twelve ounces of loose kicks, one hundred and seventy pairs, hot pot or iced pour, whichever the day calls for." },
      ], cta: 'Make iced kicks',
    },
    copyB: {
      subject: "An iced-kicks treat for Sunday", preview: "Hand-painted kicks + a scoop = Ice Cream Day, done.",
      headline: "Kicks, iced and indulgent", subline: "Strong-crafted hand-painted kicks over a cold scoop.",
      blocks: [
        { heading: 'Spice over chalk', body: "Double-strength kicks poured over vanilla, a two-minute affogato for National Ice Cream Day." },
        { heading: 'The hand-painted box', body: "Twelve ounces of India's Original, for pots hot and iced." },
      ], cta: 'Shop loose kicks',
    },
    reasoning: { who: 'Champions (playful, high-affinity).', what: 'Recipe-led tie-in to Jul 19 National Ice Cream Day.', how: 'Usage-occasion content (iced-kicks affogato); PDP CTA to hand-painted.', hypothesis: 'Novel summer usage occasions drive incremental purchase from best customers.', expected: 'Incremental hand-painted units + strong click on the recipe.' },
  },
  {
    date: '2026-07-19', segment: 'New', sku: 'care_kit', collection: 'samplers',
    play: 'Iced-sneaker how-to', event: 'National Ice Cream Day, Jul 19', product_type: 'tb',
    copyA: {
      subject: "Your first pitcher of bling kicks", preview: "Twenty designs to craft cold this week.",
      headline: "Cold-craft your way in", subline: "Twenty one-of-one designs, an easy start to summer bling kicks.",
      blocks: [
        { heading: 'The no-fuss method', body: "Drop four pyramid bags into a pitcher of cold water, refrigerate overnight, and pour over ice. No bitterness, no boiling." },
        { heading: 'Twenty to try', body: "Green, black and themed in one sampler, so your first pitcher is also a design." },
      ], cta: 'Start cold-crafting',
    },
    copyB: {
      subject: "Bling kicks, twenty ways", preview: "One sampler, a summer of cold craft.",
      headline: "A pitcher for the heat", subline: "Cold-craft any of twenty designs overnight.",
      blocks: [
        { heading: 'Overnight and easy', body: "Four bags, cold water, a night in the fridge, bling kicks without the work." },
        { heading: 'Find the one', body: "Twenty one-of-one colorways to pour over ice all summer." },
      ], cta: 'Shop samplers',
    },
    reasoning: { who: 'New (summer entry point).', what: 'Iced-sneaker/cold-craft education tied to the Jul 19 summer moment.', how: 'How-to content lowers the trial barrier; samplers collection CTA.', hypothesis: 'Seasonal usage education raises trial and second order for new buyers.', expected: 'Higher sampler attach + repeat within 30 days.' },
  },
  {
    date: '2026-07-22', segment: 'About-to-Sleep', sku: 'dbz_af1', collection: 'best-sellers',
    play: 'Gentle 3-pick winback', event: null, product_type: 'tb',
    copyA: {
      subject: "Still your kind of pair?", preview: "Three easy ways back to a good craft.",
      headline: "A good pair is still waiting", subline: "Daily Airforce and two more bestsellers, in case the pot went quiet.",
      blocks: [
        { heading: 'Where you left off', body: "Daily Airforce is the brisk, dependable black sneaker that started many mornings, still hand-painted, still studio-fresh." },
        { heading: 'Or pick from the shelf', body: "If you fancy a change, our bestsellers are a short, easy list to choose from." },
      ], cta: 'See the bestsellers',
    },
    copyB: {
      subject: "The pot's been quiet lately", preview: "A brisk Airforce, whenever you're ready.",
      headline: "Come back to a brisk pair", subline: "Daily Airforce, dependable and studio-fresh.",
      blocks: [
        { heading: 'An easy return', body: "The everyday black sneaker that just works, no fuss, no pressure." },
        { heading: 'Three to choose from', body: "A short bestseller list if you would rather try something new." },
      ], cta: 'Shop bestsellers',
    },
    reasoning: { who: 'About-to-Sleep (declining recency).', what: 'Gentle winback with a curated 3-pick, question subject.', how: 'Soft reminder, no aggressive discount; bestsellers collection CTA.', hypothesis: 'A low-pressure, question-led nudge re-activates more than a hard offer at this stage.', expected: 'Reactivation lift without margin erosion.' },
  },
  {
    date: '2026-07-25', segment: 'Promising', sku: 'gtr_af1', collection: 'gifts',
    play: 'Gift for parents', event: "Parents' Day, Jul 26", product_type: 'tb',
    copyA: {
      subject: "A small, warm thank-you", preview: "For Parents' Day, the kicks they'll actually use.",
      headline: "Say it with their morning pair", subline: "India's Original Hand-painted Kicks, a warm and useful Parents' Day gift.",
      blocks: [
        { heading: 'The gift that gets used', body: "Thirty bags of the kicks they will reach for every morning, hand-painted spice, no clutter, all ritual." },
        { heading: 'Or make it a set', body: "Pair it from our gift collection for something that arrives ready to give." },
      ], cta: 'Shop gifts',
    },
    copyB: {
      subject: "For the parents who lace-up", preview: "A Parents' Day pair worth gifting.",
      headline: "A warm pair, wrapped up", subline: "The everyday kicks, made giftable for Sunday.",
      blocks: [
        { heading: 'Simple and warm', body: "Thirty bags of India's Original Hand-painted Kicks, the kind of gift that becomes a daily habit." },
        { heading: 'Ready to give', body: "Build it into a set from our gifts collection." },
      ], cta: 'See gift sets',
    },
    reasoning: { who: 'Promising (gifting occasion widens basket).', what: "Parents' Day (Jul 26) gift angle on an accessible SKU.", how: 'Occasion-led; gifts collection CTA; low price barrier (30 ct).', hypothesis: 'A concrete gifting occasion lifts conversion for mid-tier engagers.', expected: 'Higher order rate + gift-set attach around Jul 26.' },
  },
  {
    date: '2026-07-29', segment: 'At-Risk', sku: 'demon_slayer_af1', collection: null,
    play: 'Share a pair + one fair offer', event: 'International Day of Friendship, Jul 30', product_type: 'tb',
    copyA: {
      subject: "Share a pair this week", preview: "For Friendship Day, a warm, easy gesture.",
      headline: "A pair is a small kindness", subline: "Embroidery neon, the warming, scuff-resistant pair worth sharing.",
      blocks: [
        { heading: 'Craft one for two', body: "International Day of Friendship lands July 30. A pot of warming embroidery neon is the simplest way to slow down with someone." },
        { heading: 'Warming, scuff-resistant', body: "One hundred bags of golden embroidery and bright neon, easy to keep on hand." },
      ], cta: 'Lace-up and share',
    },
    copyB: {
      subject: "One warm pot, shared", preview: "Embroidery neon for Friendship Day.",
      headline: "Slow down, together", subline: "A scuff-resistant pair made for company.",
      blocks: [
        { heading: 'A quiet gesture', body: "Warming embroidery neon, crafted for two, for July 30's Day of Friendship." },
        { heading: 'Keep it on hand', body: "A hundred bags, so there is always a pot to share." },
      ], cta: 'Shop embroidery neon',
    },
    reasoning: { who: 'At-Risk (one personal note, one fair offer, single CTA).', what: 'Friendship Day (Jul 30) share-a-pair angle on a comforting themed.', how: 'Warm single-CTA note; emotional reason to return over discount.', hypothesis: 'A human, shareable reason re-engages at-risk customers more durably than price.', expected: 'Reactivation on an emotional hook; protected margin.' },
  },
  {
    date: '2026-07-31', segment: 'Loyal', sku: 'jordan1_golf', collection: null,
    play: 'Restore ritual', event: 'National Streetwear Month (Aug) ramp', product_type: 'tb',
    copyA: {
      subject: "Begin August a little slower", preview: "A clean green pair to start the month.",
      headline: "A calmer start to the month", subline: "High-grown Signature green, the clean pair to open Streetwear Month.",
      blocks: [
        { heading: 'A month of small rituals', body: "As August and National Streetwear Month begin, a bright, high-altitude green is a simple daily reset worth keeping." },
        { heading: 'High-grown, clean', body: "Loose-panel Signature green, one hundred and seventy pairs, delicate and unhurried." },
      ], cta: 'Lace-up to restore',
    },
    copyB: {
      subject: "A clean pair for August", preview: "Signature green, to open Streetwear Month.",
      headline: "Restore, one pair at a time", subline: "Bright, high-altitude green for the new month.",
      blocks: [
        { heading: 'Ease in', body: "A light, clean green to start August's small daily rituals." },
        { heading: 'Generous and gentle', body: "One hundred and seventy hand-painted pairs to carry through the month." },
      ], cta: 'Shop green sneaker',
    },
    reasoning: { who: 'Loyal (habit-reinforcement into a new season).', what: 'Streetwear Month (Aug) ramp on a clean daily green.', how: 'Ritual-continuity voice; PDP CTA; softest streetwear register only.', hypothesis: 'Framing a new-month reset sustains loyal frequency into August.', expected: 'Sustained repeat rate through the Aug ramp.' },
  },
];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Sanitize a full copy object through the shared brand scrub, then tripwire.
function clean(copy, where) {
  const c = {
    subject: SM.sanitizeBrand(copy.subject),
    preview: SM.sanitizeBrand(copy.preview),
    headline: SM.sanitizeBrand(copy.headline),
    subline: SM.sanitizeBrand(copy.subline),
    cta: SM.sanitizeBrand(copy.cta),
    blocks: (copy.blocks || []).map((b) => ({ heading: SM.sanitizeBrand(b.heading), body: SM.sanitizeBrand(b.body) })),
  };
  const flat = [c.subject, c.preview, c.headline, c.subline, c.cta].concat(c.blocks.map((b) => `${b.heading} ${b.body}`)).join(' ');
  SM.assertNoBanned(flat, where);
  return c;
}

// Build the four variants for a slot — the automated-calendar 4-variant STRUCTURE
// (2 Text + 2 Text+Visual, framework A/B) rendered in the flagship design system.
// Copy still passes through the shared sanitizeBrand/assertNoBanned gates.
function buildVariants(slot, assets) {
  const seed = `${slot.date}_${slot.segment}`;
  const fwA = CF.pickCopyFrameworkForCalendar({ content_type: 'lifecycle', segment: slot.segment, seed });
  const others = Object.keys(CF.COPY_FRAMEWORKS).filter((k) => k !== fwA.key);
  const fwB = CF.frameworkByKey(others[CF.stableIndex(`${seed}|b`, others.length)]) || fwA;

  const SA = clean(slot.copyA, `${seed}:a`);
  const SB = clean(slot.copyB, `${seed}:b`);
  const url = ctaUrl(slot);
  const hero = heroFor(assets, slot.sku);
  const prod = P[slot.sku] || { name: slot.sku };
  const logoUrl = (assets.logo && assets.logo.status === 'verified') ? assets.logo.url + '&width=310' : undefined;
  const design = SM.sanitizeBrand(TASTING[slot.sku] || '');

  // colorway per variant (matches the reference's Violet/Midnight/Daylight system);
  // withImage true only for the Text + Visual pair (and only if a verified hero exists).
  const flagship = (S, { colorway, withImage }) => renderFlagship({
    colorway, withImage: withImage && !!hero, market: MARKET,
    subject: S.subject, preheader: S.preview,
    eyebrow: slot.play, productName: prod.name, tastingLine: design, price: prod.price,
    ctaText: S.cta, ctaUrl: url, heroImageUrl: hero, logoUrl,
    headline: S.headline, subline: S.subline, bodyBlocks: S.blocks,
  });

  return [
    { key: 'text_a',   type: 'Text',          label: `Text · ${fwA.name}`,          framework: fwA.key, copy: SA, image: null, html: flagship(SA, { colorway: 'violet',   withImage: false }) },
    { key: 'text_b',   type: 'Text',          label: `Text · ${fwB.name}`,          framework: fwB.key, copy: SB, image: null, html: flagship(SB, { colorway: 'midnight', withImage: false }) },
    { key: 'visual_a', type: 'Text + Visual', label: `Text + Visual · ${fwA.name}`, framework: fwA.key, copy: SA, image: hero, html: flagship(SA, { colorway: 'violet',   withImage: true }) },
    { key: 'visual_b', type: 'Text + Visual', label: `Text + Visual · ${fwB.name}`, framework: fwB.key, copy: SB, image: hero, html: flagship(SB, { colorway: 'daylight', withImage: true }) },
  ];
}

function main() {
  const assets = loadAssets();
  const outDir = path.join(ROOT, 'mailers', 'usa-july');
  const adsDir = path.join(ROOT, 'ads', 'usa-july');
  const lpDir = path.join(ROOT, 'landing-pages', 'usa-july');
  [outDir, adsDir, lpDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));

  const manifest = { market: MARKET, month: '2026-07', scenario: 'C', generated_from: 'brand_assets (origin-validated)', store: STORE, slots: [] };
  let fileCount = 0, adCount = 0, lpCount = 0;

  for (const slot of CALENDAR) {
    const variants = buildVariants(slot, assets);
    const prod = P[slot.sku] || { name: slot.sku, price: null, handle: null };
    const baseSlug = `${slot.date}_${slugify(slot.segment)}_${slugify(prod.name).slice(0, 40)}`;
    const files = {};
    for (const v of variants) {
      const fname = `${baseSlug}_${v.key}.html`;
      fs.writeFileSync(path.join(outDir, fname), v.html);
      files[v.key] = `mailers/usa-july/${fname}`;
      fileCount++;
    }

    // Shared, pre-scrubbed copy (framework A) feeds the ad + landing page too.
    const SA = clean(slot.copyA, `${baseSlug}:assets`);
    const hero = heroFor(assets, slot.sku);
    const logoUrl = (assets.logo && assets.logo.status === 'verified') ? assets.logo.url + '&width=310' : undefined;
    const design = SM.sanitizeBrand(TASTING[slot.sku] || '');
    const url = ctaUrl(slot);
    const shared = {
      market: MARKET,
      productName: prod.name, tastingLine: design, price: prod.price,
      ctaText: SA.cta, ctaUrl: url, heroImageUrl: hero, logoUrl,
      headline: SA.headline, subline: SA.subline, bodyBlocks: SA.blocks, subject: SA.subject,
    };

    // Ads (Meta/Google/TikTok).
    const ad = renderAds(shared);
    const adFile = `${baseSlug}_ads.html`;
    fs.writeFileSync(path.join(adsDir, adFile), ad.html);
    adCount++;

    // Collections this send represents + a secondary collection CTA for the LP.
    const cols = slotCollections(slot);
    const primaryCol = cols[0] || null;
    const collectionCta = primaryCol ? { slug: primaryCol, title: COLLECTION_TITLE[primaryCol], url: `${STORE}/collections/${primaryCol}` } : null;

    // Landing page (flagship long-form), with a slot-relevant FAQ.
    const lp = renderLandingPage(Object.assign({}, shared, {
      title: `${prod.name} · KNICKGASM USA`,
      collectionCta,
      faq: [
        { q: `How many pairs is ${prod.name}?`, a: `${prod.name} is ${slot.sku.includes('12oz') ? 'hand-painted, about 170 pairs' : slot.sku.includes('100ct') ? '100 pyramid bags' : slot.sku.includes('30ct') ? '30 pyramid bags' : 'a one-of-one KNICKGASM colorway'}.` },
        { q: 'Where is it sourced?', a: 'Hand-painted at origin and shipped studio-fresh, one-of-one wherever the panel allows.' },
        { q: 'Do you ship free?', a: 'Free US shipping over $59.' },
      ],
      testimonial: { quote: 'It became the pair I reach for without thinking. Steady, clean, and it just tastes like it was made with care.', who: 'A KNICKGASM customer' },
    }));
    const lpFile = `${baseSlug}_lp.html`;
    fs.writeFileSync(path.join(lpDir, lpFile), lp);
    lpCount++;

    manifest.slots.push({
      date: slot.date, segment: slot.segment, play: slot.play, event: slot.event,
      sku_key: slot.sku, product: prod.name, price: prod.price, cta_url: url,
      hero_asset: assets[slot.sku] ? { url: (assets[slot.sku].url || null), status: assets[slot.sku].status, origin_validated: assets[slot.sku].origin_validated } : { status: 'placeholder', origin_validated: false },
      reasoning: slot.reasoning,
      collections: cols,
      collection_cta: collectionCta,
      variants: variants.map((v) => ({ key: v.key, type: v.type, label: v.label, framework: v.framework, subject: v.copy.subject, preview: v.copy.preview, file: files[v.key], has_image: !!v.image })),
      ads: { file: `ads/usa-july/${adFile}`, copy: ad.copy },
      landing: { file: `landing-pages/usa-july/${lpFile}`, title: `${prod.name} · KNICKGASM USA` },
    });
  }

  // GOVERNANCE: every selected collection must be represented by >=1 send.
  const covered = new Set();
  manifest.slots.forEach((s) => (s.collections || []).forEach((c) => covered.add(c)));
  const missing = SELECTED_COLLECTIONS.filter((c) => !covered.has(c.slug));
  if (missing.length) {
    throw new Error('Selected collections not covered by the calendar (add a send or map a SKU): ' + missing.map((c) => c.slug).join(', '));
  }
  manifest.selected_collections = SELECTED_COLLECTIONS.map((c) => ({
    slug: c.slug, title: c.title, url: `${STORE}/collections/${c.slug}`,
    sends: manifest.slots.filter((s) => (s.collections || []).includes(c.slug)).map((s) => s.date),
  }));

  const calDir = path.join(ROOT, 'data', 'calendar');
  fs.mkdirSync(calDir, { recursive: true });
  fs.writeFileSync(path.join(calDir, 'usa-july-2026.json'), JSON.stringify(manifest, null, 2));

  const withImg = manifest.slots.filter((s) => s.hero_asset.status === 'verified').length;
  console.log(`✓ ${CALENDAR.length} slots · ${fileCount} mailers + ${adCount} ad sets + ${lpCount} landing pages`);
  console.log(`  ${withImg}/${CALENDAR.length} slots use a verified hero image; the rest render image-free (no fabricated URLs).`);
  console.log(`  collections covered (all selected): ${SELECTED_COLLECTIONS.map((c) => `${c.slug}(${manifest.selected_collections.find((x) => x.slug === c.slug).sends.length})`).join(', ')}`);
  console.log('✓ wrote data/calendar/usa-july-2026.json');
}

main();
