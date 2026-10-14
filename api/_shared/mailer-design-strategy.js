'use strict';

/**
 * Per-slot mailer DESIGN strategy — so every mailer gets its own independent,
 * relevant layout instead of one repeated template.
 *
 * Each slot is matched to an archetype drawn from how top D2C creators /
 * influencers actually structure high-performing email content:
 *
 *   founder-note        Founder / creator authenticity — a personal letter, no
 *                       hard sell. (post-purchase, nurture, thank-you)
 *   ugc-testimonial     A wall of real customer voices leads. (winback,
 *                       at-risk, non-engagers — proof rebuilds trust)
 *   ritual-tutorial     Day-in-the-life "how I actually use it" steps first.
 *                       (new subscriber, activation, first-purchase)
 *   editorial-lookbook  Aspirational, photo-led, minimal copy. (VIP,
 *                       one-of-one, prestige)
 *   gift-guide          A curated gift-guide grid leads. (gifting, high-AOV)
 *   comparison-discovery Honest "why this vs that" + try-it framing.
 *                       (discovery, sampler, cross-sell)
 *   hero-spotlight      One hero product, big close-up. (affinity default)
 *
 * The archetype drives BOTH the section ORDER in the mailer (so the design is
 * genuinely different) and an influencerAngle line injected into the copy
 * prompt (so the words match the format). Deterministic: the same slot always
 * gets the same design, and a per-slot rotation seed keeps a run of similar
 * cohorts from all looking identical.
 */

const playbooks = require('./asset-playbooks.js');

// Ordered, most-specific-first. `order` lists the mailer body sections in the
// sequence this archetype renders them (header/footer are always fixed).
const ARCHETYPES = {
  // ── Commerce / Lifestyle Archetypes ──
  'founder-note': {
    label: 'Founder note',
    hero: 'founder',
    influencerAngle: 'Write as a warm, first-person note from the studio founder or lead director to one person. No hard sell. Creator-authenticity voice: honest, specific, a small behind-the-origin detail. The story field should read like a personal letter and end with a signature line (name, role).',
    order: ['founderNote', 'productGrid', 'testimonials'],
  },
  'ugc-testimonial': {
    label: 'Customer-voice wall',
    hero: 'green',
    influencerAngle: 'Lead with social proof, the way a creator reposts real customer stories. Testimonials must read as genuine tiny stories from named people, not review blurbs. Copy earns back a lapsed reader by showing other real people came back.',
    order: ['heroGreen', 'testimonials', 'productGrid'],
  },
  'ritual-tutorial': {
    label: 'Day-in-the-life ritual',
    hero: 'editorial',
    influencerAngle: 'Frame it as a creator tutorial / day-in-the-life: "here is exactly how I make it part of my morning". The mechanism steps are the how-to. Approachable, first-time-friendly, zero jargon.',
    order: ['heroEditorial', 'steps', 'productGrid'],
  },
  'editorial-lookbook': {
    label: 'Editorial lookbook',
    hero: 'editorial',
    influencerAngle: 'Aspirational editorial voice, like a creator lookbook. Fewer words, more atmosphere. Sensory and restrained; let the origin and craft carry it. No discount-led urgency.',
    order: ['heroEditorial', 'bodyStory', 'productGrid'],
  },
  'gift-guide': {
    label: 'Curated gift guide',
    hero: 'green',
    influencerAngle: 'Frame as a curated gift-guide roundup, the way creators post "my picks for ___". Each product is a considered recommendation with a one-line reason it makes a great gift.',
    order: ['heroGreen', 'productGrid', 'testimonials'],
  },
  'comparison-discovery': {
    label: 'Honest comparison',
    hero: 'green',
    influencerAngle: 'Honest "here is why this is different, try it for yourself" discovery voice, like a creator doing a genuine comparison. Lower the risk of trying something new; make the first step tiny.',
    order: ['heroGreen', 'bodyStory', 'productGrid'],
  },
  'hero-spotlight': {
    label: 'Hero spotlight',
    hero: 'editorial',
    influencerAngle: 'Single-offering hero spotlight, a big close-up the way a curator features one favourite. All attention on this piece: its origin, its purpose, the moment it belongs to.',
    order: ['heroEditorial', 'productGrid', 'testimonials'],
  },

  // ── Information & Financial Media Archetypes ──
  'briefing-digest': {
    label: 'Executive briefing digest',
    hero: 'editorial',
    influencerAngle: 'Authoritative, clear editorial briefing voice. Smart brevity: lead with the big story, why it matters, scannable data points, and curated radar items. Zero fluff.',
    order: ['heroEditorial', 'bodyStory', 'bullets', 'proUpsell'],
  },
  'top-story-lead': {
    label: 'Deep-dive lead story',
    hero: 'editorial',
    influencerAngle: 'Compelling investigative or analytical narrative. Hook the reader with one non-consensus development, walk through the causal drivers and second-order impacts.',
    order: ['heroEditorial', 'bodyStory', 'dataCallout'],
  },
  'data-snapshot': {
    label: 'Market data & catalyst radar',
    hero: 'terminal',
    influencerAngle: 'Sharp financial analyst intelligence voice. Lead with verified macro/micro catalysts, key market pulse indicators, and sector rotation takeaways. Crisp, objective, non-advice.',
    order: ['marketPulse', 'catalystStory', 'sectorRadar', 'disclaimer'],
  },
  'explainer': {
    label: 'Concept or market explainer',
    hero: 'editorial',
    influencerAngle: 'Educational clarity: take a complex economic, news or industry development and explain exactly how the mechanism works in plain, engaging English.',
    order: ['heroEditorial', 'steps', 'bodyStory'],
  },
  'paywall-upsell': {
    label: 'Premium tier / Pro unlock',
    hero: 'green',
    influencerAngle: 'High-value preview of member-exclusive research, model alerts or subscriber deep-dives. Make the value of joining the paid tier undeniable.',
    order: ['heroGreen', 'featureGrid', 'testimonials'],
  },
};

const DEFAULT_KEY = 'hero-spotlight';

// Deterministic hash so the same slot always resolves to the same design.
function stableIndex(str, n) {
  if (n <= 1) return 0;
  let h = 0; const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

// Pick the archetype key for a slot from its cohort / objective / product /
// festival and brand business model.
function archetypeKeyFor(slot = {}, brand = null) {
  const b = brand || slot.brand || null;
  const model = playbooks.businessModel(b);

  const s = [slot.theme, slot.angle, slot.objective, slot.festival, slot.cohort_name,
    slot.cohort && (slot.cohort.name || slot.cohort.key), slot.cohort_id]
    .filter(Boolean).join(' ').toLowerCase();
  const seed = slot.id || slot.date || s;

  if (model === 'market_data') {
    if (/pro|vip|paid|premium|upgrade|tier|unlock/.test(s)) return 'paywall-upsell';
    if (/explain|how|guide|mechanic|education|understand/.test(s)) return 'explainer';
    if (/lead|deep|earnings|investigat|macro/.test(s)) return 'top-story-lead';
    if (/brief|digest|summary|roundup|wrap/.test(s)) return 'briefing-digest';
    // Market data default rotation
    const rot = ['data-snapshot', 'top-story-lead', 'briefing-digest', 'explainer'];
    return rot[stableIndex(seed, rot.length)];
  }

  if (model === 'news_media') {
    if (/pro|vip|paid|premium|membership|member|upgrade/.test(s)) return 'paywall-upsell';
    if (/explain|how|guide|background|analysis/.test(s)) return 'explainer';
    if (/lead|investigat|exclusive|feature|deep/.test(s)) return 'top-story-lead';
    // News media default rotation
    const rot = ['briefing-digest', 'top-story-lead', 'explainer'];
    return rot[stableIndex(seed, rot.length)];
  }

  // Commerce & generic
  if (/gift|gifting|high.?aov/.test(s)) return 'gift-guide';
  if (/winback|win.?back|lapsed|at.?risk|non.?engager|dormant|churn/.test(s)) return 'ugc-testimonial';
  if (/new sub|first.?purchase|activation|non.?buyer|welcome|onboard/.test(s)) return 'ritual-tutorial';
  if (/vip|champion|single.?studio|prestige|connoisseur|premium/.test(s)) return 'editorial-lookbook';
  if (/post.?purchase|nurture|thank|loyal|repeat|subscribe|replenish/.test(s)) return 'founder-note';
  if (/browse|discovery|sampler|variety|undecided|cross.?sell|cross.?category/.test(s)) return 'comparison-discovery';
  // Affinity / general: rotate between spotlight, tutorial and lookbook so a run
  // of affinity sends still varies.
  if (/affinity|black|green|kicks|streetwear|themed|iced|summer|catalog|lifestyle|apparel|wellness|beauty|curated|craft|edition/.test(s)) {
    const rot = ['hero-spotlight', 'ritual-tutorial', 'editorial-lookbook'];
    return rot[stableIndex(seed, rot.length)];
  }
  return DEFAULT_KEY;
}

function strategyFor(slot = {}, brand = null) {
  const b = brand || slot.brand || null;
  const key = archetypeKeyFor(slot, b);
  const a = ARCHETYPES[key] || ARCHETYPES[DEFAULT_KEY];
  let angle = a.influencerAngle;
  if (b && b.name && angle.includes('studio founder')) {
    angle = angle.replace('studio founder', `${b.name} founder`);
  }
  return { key, ...a, influencerAngle: angle };
}

module.exports = { strategyFor, archetypeKeyFor, ARCHETYPES, DEFAULT_KEY };
