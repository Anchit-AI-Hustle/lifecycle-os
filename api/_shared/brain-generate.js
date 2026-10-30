'use strict';

/**
 * brain-generate.js — Generation Engine (Module 5).
 *
 * For an approved calendar slot, generates the COMPLETE asset set:
 *   email slots        → HTML mailer (brand-compliant) + paired landing page
 *   google slots       → RSA campaign object (15 headlines / 4 descriptions / keywords)
 *   meta slots         → primary text / headline / description + creative brief + audience
 *   tiktok slots       → hook-script + creative brief + audience
 *   landing_* slots    → conversion-optimized landing page HTML
 * plus, for every campaign: funnel spec (creative → landing → mailer follow-up),
 * retargeting + lookalike audience definitions — platform-ready schema,
 * NO live push (phase 2 plugs into the same campaign_object).
 *
 * LLM-assisted copy via _shared/llm.js with a deterministic brand-compliant
 * fallback, so generation always succeeds.
 */

const { db, getConfig, getBrandKit, scrubBannedPhrases, idFor, todayIso, round } = require('./brain-core.js');
const analysis = require('./brain-analysis.js');

let callLLM = null;
try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }
// No em/en dashes in generated copy (matches the lifecycle builder). Safe no-op
// if scenario-model is unavailable.
let dashScrub = (s) => s;
try { const sm = require('./scenario-model.js'); if (sm && sm.scrubDashes) dashScrub = sm.scrubDashes; } catch (_) {}

// Knickgasm Campaign Hub compiler (ported from marketing_automation/) — premium,
// curated themed landing pages for the streetwear/coffee-collection campaigns it
// was built for. The brain routes to it when a slot matches; otherwise it uses
// the LLM long-form landing builder below.
let lpCompiler = null;
try { lpCompiler = require('./lp-compiler.js'); } catch (_) { lpCompiler = null; }
// Shared mailer renderer, the SAME one the Mailer Calendar / lifecycle builder
// uses, so Smart Brain mailers come out as the same two named types.
let renderTextVariant = null;
try { renderTextVariant = require('./calendar-trigger.js').helpers.renderTextVariant; } catch (_) { renderTextVariant = null; }
// Real hosted product photos (Shopify CDN) from the built catalog, so a mailer
// never renders with a missing image when the smart_products row has no image.
let catalogImage = { imageFor: () => null };
try { catalogImage = require('./catalog-image.js'); } catch (_) {}
// B1 real-only gate (env REAL_FACTS_ONLY). When ON, the flagship mailer + LP show
// ONLY approved testimonials/reviews for the SKU and DROP the fabricated
// competitor comparison; when OFF (default) behaviour is unchanged.
let brandFacts = { enabled: () => false, approvedReviews: () => [] };
try { brandFacts = require('./brand-facts.js'); } catch (_) {}
// Resolve testimonials for a slot under the gate: OFF => the given fallback
// (LLM/template testimonials); ON => approved reviews for the SKU, else [].
function gateTestis(fallbackTestis, slot, product) {
  if (!brandFacts.enabled()) return fallbackTestis;
  const sku = (product && (product.sku || product.id || product.handle || product.title)) || null;
  return brandFacts.approvedReviews(sku, slot && slot.market).map((r) => ({ quote: r.quote || '', name: r.author || 'Verified reviewer', location: '' }));
}
// Per-slot design strategy: gives each mailer its own influencer-informed
// archetype (layout order + copy angle) instead of one repeated template.
let designStrategy = { strategyFor: () => ({ key: 'hero-spotlight', hero: 'green', order: [], influencerAngle: '' }) };
try { designStrategy = require('./mailer-design-strategy.js'); } catch (_) {}
// Legal sender identity for email footers (CAN-SPAM: a real physical mailing
// address is required in every commercial email). Replaces the old
// {{ organization_address }} placeholder.
const ORG_NAME = 'Knickgasm Global, Inc';
const ORG_ADDRESS = '440 N Barranca Ave #2812, Covina, CA 91723, United States';

// Knickgasm's name, store and legal sender belong to tenant zero. Another
// workspace gets its own record, or a gap, never that brand's identity.
function isShippedBrand(brand) {
  try { return require('./brand-catalog-server.js').isTenantZeroBrand(brand) === true; } catch (_) { return false; }
}
function brandLabel(brand) {
  if (isShippedBrand(brand)) return 'KNICKGASM';
  const name = brand && String(brand.name || '').trim();
  return name || (brand && brand.slug ? brand.slug.toUpperCase() : 'The Brand');
}
function storeUrl(brand, market) {
  const listed = brand && brand.store_urls && brand.store_urls[market];
  if (listed) return String(listed).replace(/\/$/, '');
  if (isShippedBrand(brand)) return 'https://knickgasm.com';
  const site = brand && brand.website ? String(brand.website).replace(/\/$/, '') : '';
  return site || `https://${(brand && (brand.slug || brand.id)) || 'store'}.com`;
}
function collectionUrlFor(store, heroType, brand) {
  if (!isShippedBrand(brand)) return store;
  const cat = String(heroType || '').toLowerCase();
  const slug = /kicks/.test(cat) ? 'kicks-sneaker'
    : /green/.test(cat) ? 'green-sneaker'
    : /black/.test(cat) ? 'black-sneaker'
    : /themed|embroidery|streetwear|jacket|accessor/.test(cat) ? 'streetwear-sneaker'
    : 'all';
  return `${store}/collections/${slug}`;
}
function senderIdentity(brand) {
  if (isShippedBrand(brand)) {
    return { name: ORG_NAME, address: ORG_ADDRESS, from_name: 'KNICKGASM', from_email: 'hello@knickgasm.com' };
  }
  const label = brandLabel(brand);
  const legal = brand && (brand.legal_entity || brand.legal_name);
  let name = label;
  let address = `${label} Support, Online`;
  if (typeof legal === 'string' && legal.trim()) {
    const parts = legal.split(',');
    name = parts[0].trim() || name;
    const rest = parts.slice(1).join(',').trim();
    if (rest) address = rest;
  }
  let from_email = '';
  try {
    if (brand && brand.website) from_email = 'hello@' + new URL(brand.website).hostname.replace(/^www\./, '');
  } catch (_) { from_email = ''; }
  if (!from_email) from_email = `hello@${(brand && (brand.slug || brand.id)) || 'store'}.com`;
  return { name, address, from_name: label, from_email };
}

// Resolve the best real image URL for a product: its own row image, else the
// catalog photo by handle/title. Returns an https URL or null.
/**
 * The brand a generated slot belongs to. `getBrandKit()` returns a PALETTE kit,
 * not a workspace record, so it cannot answer "is this tenant zero"; the slot's
 * own stamped brand can, and that is what decides which catalogue is readable.
 */
function slotBrand(slot, kit) {
  const b = (slot && slot.brand) || null;
  if (b && (b.id || b.slug)) return b;
  return (kit && (kit.id || kit.slug)) ? kit : null;
}

function productImage(p, market, brand) {
  if (!p) return null;
  const direct = p.image || p.image_url || p.i;
  if (typeof direct === 'string' && /^https?:\/\//.test(direct)) return direct;
  // Brand-scoped: the shipped products_*.json is tenant zero's catalogue, so a
  // slot belonging to any other brand resolves against ITS rows or gets null.
  return catalogImage.imageFor({ handle: p.handle || p.h, title: p.title || p.n }, market, { brand }) || null;
}

// Match a calendar slot to a Campaign-Hub theme by keyword overlap. Returns
// { theme, variant } only on a real match, so a Jordan slot never gets a
// grail-drop page. null → fall back to the generic LLM landing page.
function pickCampaignHubLP(slot, products, brand) {
  if (!lpCompiler || !Array.isArray(lpCompiler.THEMES) || !lpCompiler.THEMES.length) return null;
  // The Campaign-Hub themes are a hand-written CONTENT LIBRARY for tenant zero:
  // its angles, its copy, its Shopify image URLs. There is no brand-agnostic
  // version of "Naruto on an Air Force 1", so any other brand must never be
  // served these pages - it falls through to the brand-derived generator.
  // The hub is tenant zero's content library. No brand, or a workspace that
  // only claims the slug, does not receive it (isTenantZeroBrand !== true).
  let zero = null;
  try { zero = require('./brand-catalog-server.js').isTenantZeroBrand(brand); } catch (_) { zero = null; }
  if (zero !== true) return null;
  const hay = [slot.theme, slot.angle, slot.cohort_id, slot.festival,
    ...(products || []).flatMap((p) => [p.title, p.category, ...((p.tags) || [])])].filter(Boolean).join(' ').toLowerCase();
  // Only consider the Hub for design/fandom/occasion intents (the themes the
  // campaign-hub landing pages are actually written for).
  const gate = /(grail-drop|anime|football|soccer|gaming|car|f1|formula|wedding|bride|groom|gift|pet|bling|crystal|embroider|celebrity|taylor|coffee-art|custom|hand-painted|one-of-one|airbrush|streetwear|collector)/;
  if (!gate.test(hay)) return null;
  const score = (t) => {
    const kws = `${t.name} ${t.slug} ${t.coreProblem} ${t.scientificHook}`.toLowerCase().match(/[a-z]{4,}/g) || [];
    return kws.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
  };
  let best = null, bestScore = 0;
  for (const t of lpCompiler.THEMES) { const sc = score(t); if (sc > bestScore) { bestScore = sc; best = t; } }
  if (!best || bestScore < 2) return null;
  // Variant: honour an explicit code on the slot, else the first (strongest) variant.
  const wantCode = (slot.source && slot.source.lp_variant) || (slot.metadata && slot.metadata.lp_variant);
  const variant = lpCompiler.FUNNEL_VARIANTS.find((v) => v.code === wantCode) || lpCompiler.FUNNEL_VARIANTS[0];
  return { theme: best, variant, score: bestScore };
}

async function llmJson(system, user, maxTokens = 1800) {
  if (!callLLM) return null;
  try {
    const out = await callLLM({ systemPrompt: system, userMessage: user, responseFormat: { type: 'json_object' }, maxTokens, temperature: 0.7, timeoutMs: 40000, stage: 'brain-generate', tier: 'premium' });
    const text = typeof out === 'string' ? out : (out.text || '');
    return OC.parseJsonLoose(text);
  } catch (_) { return null; }
}

// ── what the copy chief returns (output-contract.js) ───────────────────────
// The JSON shape this prompt used to carry seeded what nothing supplied:
// a testimonial "name" templated as "first name + city", three customer
// stories, "Free shipping over $35" and "about 40c a pair" as worked values,
// in the same prompt that said to invent no claims. Proof fields are filled
// only from what the request supplies, else the DATA REQUIRED marker; limits
// are the asset contracts' own.
const OC = require('./output-contract.js');
function slotCopySpec(slot, brand) {
  const L = require('./asset-contracts.js').slotLimit;
  const S = (n, note) => Object.assign({ type: 'string' }, n ? { max: n } : {}, note ? { note } : {});
  const pair = (a, b) => ({ type: 'object', of: { title: a || 'string', desc: b || { type: 'string', note: '1 sentence' } } });
  const proofNote = 'ONLY a review supplied in this request, verbatim; otherwise the DATA REQUIRED marker for approved reviews';
  return {
    id: 'brain-generate.copy', kind: 'data', format: 'json', brand: brandLabel(brand), region: slot && slot.market,
    returns: 'ONE JSON object holding the copy for this slot: the email, the Google, Meta and TikTok ads, and the landing page.',
    schema: {
      subject: S(L('email.mailer', 'subject')), preheader: S(L('email.mailer', 'preheader')), headline: 'string', subheadline: 'string',
      body_intro: S(null, '2-3 sentence sensory opening'), story: S(null, '4-5 sentence narrative for the angle'),
      cta_primary: 'string', cta_secondary: 'string',
      testimonial: { type: 'object', required: false, note: proofNote, of: { quote: 'string', name: 'string' } },
      google: { type: 'object', of: {
        headlines: { type: 'array', count: [3, 15], items: S(L('ad.google.rsa', 'headlines')) },
        descriptions: { type: 'array', count: [2, 4], items: S(L('ad.google.rsa', 'descriptions')) },
        callouts: { type: 'array', count: 4, items: S(25, 'a fact from the products or the brand record only') },
        sitelinks: { type: 'array', count: 4, items: { type: 'object', of: { text: S(25), desc: S(35) } } } } },
      meta: { type: 'object', of: {
        primary_text: S(L('ad.meta.static', 'primary_text')), primary_text_variants: { type: 'array', count: 3, items: S(L('ad.meta.static', 'primary_text')) },
        headline: S(L('ad.meta.static', 'headline')), headlines: { type: 'array', count: 3, items: S(L('ad.meta.static', 'headline')) },
        description: S(L('ad.meta.static', 'description')), creative_concept: S(null, 'one-line art direction for the hero image, no text in the image') } },
      tiktok: { type: 'object', of: { hook_line: S(null, 'the first 2 seconds, spoken'), script: S(null, '15 seconds, conversational'),
        shot_list: { type: 'array', count: 4, items: 'string' }, captions: { type: 'array', count: 3, items: 'string' } } },
      landing: { type: 'object', of: {
        hero_eyebrow: S(null, '3-5 words'), hero_headline: 'string', hero_sub: 'string',
        offer_bar: S(null, 'ONLY an offer this request supplies; an empty string when none'),
        trust_badges: { type: 'array', count: 4, items: S(null, 'a verifiable claim from the brand record') },
        problem: { type: 'object', of: { headline: 'string', body: 'string' } },
        mechanism: { type: 'object', of: { headline: 'string', steps: { type: 'array', count: 3, items: pair() } } },
        benefits: { type: 'array', count: 4, items: pair() },
        comparison: { type: 'object', of: { us_label: 'string', them_label: 'string' } },
        rows: { type: 'array', count: 4, items: { type: 'object', of: { feature: 'string', us: 'string', them: 'string' } } } } },
      testimonials: { type: 'array', required: false, items: { type: 'object', of: { quote: 'string', name: 'string', location: 'string' } }, note: proofNote + '; an empty array when none' },
      offer_stack: { type: 'object', of: { headline: 'string', items: { type: 'array', count: [3, 5], items: 'string' },
        price_note: S(null, 'ONLY a price this request supplies, else an empty string'), cta: 'string' } },
      faq: { type: 'array', count: 4, items: { type: 'object', of: { q: 'string', a: 'string' } } },
      guarantee: { type: 'object', required: false, note: 'ONLY a guarantee the brand record states', of: { headline: 'string', body: 'string' } },
    },
  };
}

// ── copy generation (LLM with deterministic fallback) ───────────────────────
async function generateCopy(slot, products, brand, library) {
  const ref = (library || []).slice(0, 3).map((c) => `"${c.hook}" (angle ${c.angle}, rev ${c.kpis ? c.kpis.revenue : 'n/a'})`).join('; ');
  const productLines = products.map((p) => `${p.title} — $${p.price} (${p.category})`).join('\n');
  const sys = `You are the lifecycle copy chief for ${brandLabel(brand)}.
Voice: ${brand.voice}. Use this lexicon where natural: ${(brand.preferred_lexicon || []).join(', ')}.
NEVER use: ${(brand.banned_phrases || []).join(', ')}.
QUALITY BAR — before you return, silently score every field 1-10 on: Clarity, Conversion pull, Brand-voice fit, Concrete proof (a specific detail/number, never a vague claim), and Format/character-limits. If any field scores below 8, rewrite it. Prefer a specific, sensory, benefit-led line over a generic category claim: a reason tied to THIS cohort/angle beats "origin-fresh sneaker" every time. Each headline/description must read better than the obvious generic version.
Return exactly what the OUTPUT REQUIREMENT at the end of the request states.`;
  const strat = designStrategy.strategyFor(slot);
  const user = `Create campaign copy for:
Channel: ${slot.channel} · Market: ${slot.market} · Cohort: ${slot.cohort_id || 'general'}
Theme: ${slot.theme} · Angle: ${slot.angle} · Festival: ${slot.festival || 'none'}
Reference hooks that worked before: ${ref || 'n/a'}
Design format for THIS mailer: ${strat.label}. ${strat.influencerAngle}
Write the copy so it fits that format specifically (this send must not read like a generic template).
Featured products:\n${productLines}

AD-COPY RULES (apply to google, meta and tiktok blocks):
- Make every headline and DESCRIPTION specific to this cohort (${slot.cohort_id || 'general'}) and angle (${slot.angle}). No generic "origin-fresh sneaker" filler that could belong to any send.
- Lead each ad description with the angle's benefit, then a concrete proof or offer, then a light CTA. It must read as a finished ad, never a label or the schema hint.
- Respect the character limits in the OUTPUT REQUIREMENT EXACTLY (count characters). If it does not fit, rewrite shorter — do not exceed.
- Use ONLY the product names/prices given above. Invent no discounts, promo codes, ratings, review counts, claims, or URLs. If an offer is not supplied, do not state one.
`;
  let copy = await llmJson(sys, OC.append(user, slotCopySpec(slot, brand)), 3400);
  if (!copy || !copy.headline) copy = fallbackCopy(slot, products, brand);
  // brand-compliance scrub on every string: banned phrases + no em/en dashes
  // (same no-dash rule the lifecycle builder enforces, for consistency).
  const walk = (o) => {
    if (typeof o === 'string') return dashScrub(scrubBannedPhrases(o, brand));
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)]));
    return o;
  };
  return clampAds(walk(copy));
}

// Enforce ad-platform character limits on every ad field, whatever the source
// (LLM or fallback), so a description is never rejected/truncated for being too
// long. Trims at a word boundary and strips trailing punctuation.
function clampStr(s, n) {
  s = String(s == null ? '' : s).trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-]+$/, '');
}
function clampAds(copy) {
  if (!copy) return copy;
  if (copy.meta) {
    if (copy.meta.headline) copy.meta.headline = clampStr(copy.meta.headline, 40);
    if (copy.meta.description) copy.meta.description = clampStr(copy.meta.description, 30);
    if (Array.isArray(copy.meta.headlines)) copy.meta.headlines = copy.meta.headlines.map((h) => clampStr(h, 40));
  }
  if (copy.google) {
    if (Array.isArray(copy.google.headlines)) copy.google.headlines = copy.google.headlines.map((h) => clampStr(h, 30));
    if (Array.isArray(copy.google.descriptions)) copy.google.descriptions = copy.google.descriptions.map((d) => clampStr(d, 90));
    if (Array.isArray(copy.google.callouts)) copy.google.callouts = copy.google.callouts.map((c) => clampStr(c, 25));
  }
  return copy;
}

function fallbackCopy(slot, products, brand) {
  const p = products[0] || { title: 'Featured Selection', price: 29.99, category: 'Collection' };
  const prodTitle = String(p.title || p.name || 'Featured Selection').trim();
  const prodCat = String(p.category || (brand && brand.industry) || 'Collection').trim();
  const bName = brandLabel(brand);
  const theme = slot.theme || 'Signature Essentials';
  const fest = slot.festival;
  const angle = slot.angle || theme;
  const cur = slot.market === 'UK' ? '£' : '$';
  const priceStr = p.price ? `${cur}${p.price}` : '';

  return {
    subject: fest ? `${fest}: Discover ${prodTitle} at ${bName}` : `Meet the new ${prodTitle}`,
    preheader: `${prodTitle} by ${bName} — designed for lasting quality and everyday performance`,
    headline: fest ? `Crafted for ${fest}` : `Meet the ${prodTitle}`,
    subheadline: `Designed with purpose by ${bName}`,
    body_intro: `Every detail matters. The ${prodTitle} brings together thoughtful design and premium craftsmanship for an elevated daily experience.`,
    story: `From material selection to the finishing touches, every piece is made to deliver comfort, performance, and enduring value. Designed to integrate seamlessly into your routine, it is built to perform day in and day out.`,
    cta_primary: `Explore ${prodTitle}`,
    cta_secondary: `Discover the collection`,
    testimonial: { quote: `The craftsmanship and attention to detail exceeded my expectations. Outstanding quality.`, name: `Verified Buyer` },
    google: {
      headlines: [
        clampStr(prodTitle, 30),
        clampStr(`${bName} Official`, 30),
        clampStr(`Discover ${prodTitle}`, 30),
        'Premium Quality & Design',
        'Built For Everyday Use',
        clampStr(`Shop ${bName} Online`, 30),
        'Crafted With Precision',
        'Explore New Arrivals',
        'Official Brand Store',
        'Direct Fast Shipping',
        'Designed To Endure',
        'Order Online Today',
      ],
      descriptions: [
        clampStr(`${angle}: Discover ${prodTitle} from ${bName}. Crafted for lasting everyday performance.`, 90),
        clampStr(`Explore the ${prodCat.toLowerCase()} collection. Dedicated support and fast, tracked dispatch.`, 90),
        clampStr(`Thoughtful craftsmanship and premium materials. Experience the ${bName} difference.`, 90),
        clampStr(`Elevate your daily routine with ${prodTitle}. Order online directly from ${bName}.`, 90),
      ],
      callouts: ['Quality guaranteed', 'Fast delivery', 'Dedicated support', 'Official store'],
      sitelinks: [
        { text: 'Featured Releases', desc: 'Browse our latest arrivals' },
        { text: 'Bestsellers', desc: 'Customer favorite selections' },
        { text: 'About Us', desc: 'Craftsmanship and our story' },
        { text: 'Support & FAQs', desc: 'Quick answers and assistance' },
      ],
    },
    meta: {
      primary_text: `Thoughtfully designed and built to last. Meet the ${prodTitle} from ${bName}. Created for everyday performance and elevated comfort.`,
      primary_text_variants: [
        `Discover what sets the ${prodTitle} apart. Premium build quality, clean aesthetics, and purposeful design by ${bName}.`,
        `Upgrade your daily essentials with ${bName}. Explore ${prodTitle} and experience craftsmanship made to endure.`,
        `Direct from ${bName} to you. Designed with care and backed by dedicated customer support.`,
      ],
      headline: clampStr(`Meet ${prodTitle}`, 40),
      headlines: [clampStr(`Meet ${prodTitle}`, 40), 'Crafted For You', 'Built To Last'],
      description: clampStr(`Shop ${bName}`, 30),
      creative_concept: `Minimalist high-definition product spotlight of ${prodTitle} on a clean, ambient architectural surface with natural lighting and soft shadows.`,
    },
    tiktok: {
      hook_line: `If you have been looking for an upgrade, this is for you.`,
      script: `If you have been looking for an upgrade, this is for you. This is ${prodTitle} from ${bName}. Built with thoughtful design and premium quality from day one. Tap the link to check it out.`,
      shot_list: [
        `0-2s: Close-up macro reveal of ${prodTitle}`,
        `3-6s: Hands-on demonstration showcasing texture and build quality`,
        `7-11s: Lifestyle context showing ${prodTitle} in everyday use`,
        `12-15s: Brand logo card with clear CTA button to explore the collection`,
      ],
      captions: [
        `The upgrade you have been looking for ✨`,
        `Crafted for everyday quality with ${bName}`,
        `Check out ${prodTitle} — tap link to explore`,
      ],
    },
    landing: {
      hero_eyebrow: fest ? `${fest} Spotlight` : `Signature Collection`,
      hero_headline: `Meet the ${prodTitle}`,
      hero_sub: `Thoughtfully crafted for those who appreciate lasting quality, comfort, and performance.`,
      offer_bar: `Explore the new collection with dedicated customer care and fast tracked shipping`,
      trust_badges: ['Premium Materials', 'Quality Inspected', 'Fast Dispatch', 'Customer Support'],
      problem: {
        headline: `Everyday essentials shouldn't compromise on durability`,
        body: `Too many products cut corners on materials or finishing. We focus on intentional design, dependable build quality, and lasting comfort you can rely on every single day.`,
      },
      mechanism: {
        headline: `The Craft Behind ${prodTitle}`,
        steps: [
          { title: 'Intentional Design', desc: 'Every feature is purposeful, stripped of unnecessary complexity to focus on what matters.' },
          { title: 'Quality Materials', desc: 'Selected for longevity, resilience, and daily comfort that holds up over time.' },
          { title: 'Thoroughly Verified', desc: 'Inspected for finish and performance before leaving our doors.' },
        ],
      },
      benefits: [
        { title: 'Enduring Comfort', desc: 'Engineered for seamless daily use without premature wear.' },
        { title: 'Premium Finish', desc: 'Clean aesthetics that fit effortlessly into your everyday style.' },
        { title: 'Reliable Build', desc: 'Crafted with attention to every seam, surface, and detail.' },
        { title: 'Direct Value', desc: 'Direct from our workshop to you without unnecessary retail markups.' },
      ],
      comparison: {
        us_label: bName,
        them_label: 'Standard Alternatives',
        rows: [
          { feature: 'Craftsmanship', us: 'Attention to every detail', them: 'Mass assembly shortcuts' },
          { feature: 'Materials', us: 'Selected for endurance', them: 'Cost-reduced substitutes' },
          { feature: 'Quality Control', us: 'Directly verified', them: 'Variable batch quality' },
          { feature: 'Support', us: 'Dedicated customer care', them: 'Automated ticket queues' },
        ],
      },
      testimonials: [
        { quote: `The craftsmanship and attention to detail exceeded my expectations. Outstanding quality.`, name: 'Verified Customer', location: 'Verified Order' },
      ],
      offer_stack: {
        headline: `What is included in your order`,
        items: [
          `${prodTitle} — delivered in premium protective packaging`,
          `Comprehensive product care guide`,
          `Full guarantee against manufacturing defects`,
          `Dedicated customer support`,
        ],
        price_note: priceStr ? `From ${priceStr}` : '',
        cta: `Explore ${prodTitle}`,
      },
      faq: [
        { q: `What makes ${prodTitle} different?`, a: `We focus on high-grade materials, careful finishing, and ergonomic design built to withstand daily use.` },
        { q: 'How long does delivery take?', a: 'Orders are processed promptly and shipped via tracked express courier with live updates.' },
        { q: 'What is your return policy?', a: 'If your item does not meet expectations, our customer support team is here to assist with easy returns or exchanges.' },
        { q: 'How do I care for it?', a: 'Each order comes with simple care instructions to keep your product looking and performing at its best.' },
      ],
      guarantee: { headline: `Our Quality Guarantee`, body: `We stand behind the craftsmanship of every product we deliver. If you encounter any issue, we will make it right.` },
    },
  };
}

// ── HTML builders (brand palette + typography enforced) ─────────────────────
function mailerHtml(slot, copy, products, brand, agentUrl) {
  const P = brand.palette;
  const heads = brand.typography.headings.fallback;
  const body = brand.typography.body.fallback;
  const store = storeUrl(brand, slot.market);
  const label = brandLabel(brand);
  const sender = senderIdentity(brand);
  const cur = slot.market === 'UK' ? '£' : '$';
  // Collection paths are tenant zero's catalogue. Another brand links its store.
  const heroType = ((products[0] && products[0].type) || '').toLowerCase();
  const collectionUrl = collectionUrlFor(store, heroType, brand);
  const esc = (s) => String(s == null ? '' : s).replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
  const L = copy.landing || {};
  const offerBar = L.offer_bar || `Welcome gift: free rope laces and lace tag with every custom pair`;
  const badges = (L.trust_badges && L.trust_badges.length ? L.trust_badges : ['100% original bases', 'Hand-painted', 'Water & scratch resistant', 'Ships to 60+ countries']).slice(0, 4);
  const steps = ((L.mechanism || {}).steps || []).slice(0, 3);
  const testis = gateTestis((L.testimonials && L.testimonials.length ? L.testimonials : [copy.testimonial].filter(Boolean).map((t) => ({ quote: t.quote, name: t.name, location: '' }))), slot, products[0] || null).slice(0, 2);
  const guarantee = L.guarantee || null;

  const badgeRow = badges.map((b) => `<td align="center" style="font-family:${body};font-size:11px;color:${P.forest_green};padding:4px 6px"><span style="color:${P.lava}">✦</span> ${esc(b)}</td>`).join('');
  const stepRow = steps.length ? `
  <tr><td style="padding:8px 26px 6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${steps.map((s) => `<td valign="top" align="center" style="width:33%;padding:10px 8px">
      <div style="font-family:${heads};font-size:14px;color:${P.forest_green};font-weight:700">${esc(s.title)}</div>
      <div style="font-family:${body};font-size:12px;color:${P.near_black}AA;line-height:1.55;margin-top:6px">${esc(s.desc)}</div>
    </td>`).join('')}
    </tr></table>
  </td></tr>` : '';
  const testiBlocks = testis.map((t) => `
    <div style="background:${P.chalk};border-left:3px solid ${P.lava};padding:16px 18px;text-align:left;margin-bottom:10px">
      <div style="font-family:${heads};font-size:14px;font-style:italic;color:${P.near_black};line-height:1.6">“${esc(t.quote)}”</div>
      <div style="font-family:${body};font-size:12px;color:${P.lava};margin-top:8px">- ${esc(t.name)}${t.location ? `, ${esc(t.location)}` : ''} &nbsp;★★★★★</div>
    </div>`).join('');
  const prods = products.slice(0, 3).map((p) => {
    const img = productImage(p, slot.market, slotBrand(slot, brand));
    // Always resolve a real PDP: explicit url, else build from the handle.
    const pdp = p.url || ((p.handle || p.h) ? `${store}/products/${p.handle || p.h}` : store);
    return `
    <td align="center" style="padding:10px;width:33%">
      <a href="${pdp}" target="_blank" style="text-decoration:none">
        <div style="background:${P.chalk};border:1px solid ${P.lava}33;border-radius:10px;padding:14px 10px 18px">
          ${img ? `<img src="${img}" alt="${esc(p.title)}" width="150" style="width:100%;max-width:150px;height:auto;border-radius:8px;display:block;margin:0 auto 12px"/>` : ''}
          <div style="font-family:${heads};font-size:15px;color:${P.near_black};line-height:1.35">${esc(p.title)}</div>
          <div style="font-family:${body};font-size:13px;color:${P.lava};margin-top:8px;font-weight:600">${cur}${p.price}</div>
        </div>
      </a>
    </td>`;
  }).join('');
  const heroPhoto = productImage(products[0] || {}, slot.market, slotBrand(slot, brand));
  const p0title = esc((products[0] || {}).title || label);
  const ctaBtn = (bg, fg) => `<a href="${store}" style="display:inline-block;margin-top:24px;background:${bg};color:${fg};font-family:${body};font-size:14px;font-weight:700;padding:14px 34px;border-radius:8px;text-decoration:none">${esc(copy.cta_primary)}</a>`;

  // ── Named sections — assembled per the archetype's order below ────────────
  const strat = designStrategy.strategyFor(slot);
  const kicker = esc(slot.festival || slot.theme || 'The Collection');
  const SEC = {
    // Green centred hero (bold, offer-forward).
    heroGreen: `<tr><td style="background:${P.forest_green};border-radius:14px;padding:46px 36px" align="center">
      <div style="font-family:${body};font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${P.lava};margin-bottom:14px">${kicker}</div>
      <div style="font-family:${heads};font-size:34px;line-height:1.2;color:${P.chalk};font-weight:700">${esc(copy.headline)}</div>
      <div style="font-family:${body};font-size:15px;line-height:1.6;color:${P.chalk}CC;margin-top:14px">${esc(copy.subheadline)}</div>
      ${ctaBtn(P.lava, P.near_black)}
    </td></tr>`,
    // Editorial photo-led hero (aspirational, image first, light copy). Falls
    // back to the green hero when no photo is available.
    heroEditorial: heroPhoto
      ? `<tr><td style="padding:0">
      <img src="${heroPhoto}" alt="${p0title}" width="620" style="width:100%;max-width:620px;height:auto;border-radius:14px 14px 0 0;display:block"/>
      <div style="background:${P.chalk};border:1px solid ${P.lava}33;border-top:0;border-radius:0 0 14px 14px;padding:30px 34px" align="center">
        <div style="font-family:${body};font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${P.lava};margin-bottom:12px">${kicker}</div>
        <div style="font-family:${heads};font-size:30px;line-height:1.22;color:${P.forest_green};font-weight:700">${esc(copy.headline)}</div>
        <div style="font-family:${body};font-size:15px;line-height:1.6;color:${P.near_black}CC;margin-top:12px">${esc(copy.subheadline)}</div>
        ${ctaBtn(P.forest_green, P.chalk)}
      </div></td></tr>`
      : `<tr><td style="background:${P.forest_green};border-radius:14px;padding:46px 36px" align="center">
      <div style="font-family:${heads};font-size:32px;line-height:1.2;color:${P.chalk};font-weight:700">${esc(copy.headline)}</div>
      <div style="font-family:${body};font-size:15px;line-height:1.6;color:${P.chalk}CC;margin-top:14px">${esc(copy.subheadline)}</div>
      ${ctaBtn(P.lava, P.near_black)}</td></tr>`,
    // Founder letter (personal, chalk, signed).
    founderNote: `<tr><td style="background:${P.chalk};border:1px solid ${P.lava}44;border-radius:14px;padding:34px 34px 28px">
      <div style="font-family:${body};font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${P.lava};margin-bottom:12px">A note from our founder</div>
      <div style="font-family:${heads};font-size:26px;line-height:1.25;color:${P.forest_green};font-weight:700">${esc(copy.headline)}</div>
      <div style="font-family:${body};font-size:15px;line-height:1.8;color:${P.near_black};margin-top:16px">${esc(copy.body_intro)}</div>
      <div style="font-family:${body};font-size:15px;line-height:1.8;color:${P.near_black};margin-top:12px">${esc(copy.story)}</div>
      <div style="font-family:${heads};font-size:16px;color:${P.forest_green};margin-top:18px">Warmly,<br>The ${esc(label)} family</div>
      ${ctaBtn(P.forest_green, P.chalk)}
    </td></tr>`,
    photoBand: heroPhoto
      ? `<tr><td style="padding:16px 0 0"><img src="${heroPhoto}" alt="${p0title}" width="620" style="width:100%;max-width:620px;height:auto;border-radius:14px;display:block"/></td></tr>`
      : '',
    badges: `<tr><td style="padding:14px 16px 2px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${badgeRow}</tr></table></td></tr>`,
    bodyStory: `<tr><td style="padding:22px 26px 6px">
      <div style="font-family:${body};font-size:15px;line-height:1.75;color:${P.near_black}">${esc(copy.body_intro)}</div>
      <div style="font-family:${body};font-size:15px;line-height:1.75;color:${P.near_black};margin-top:14px">${esc(copy.story)}</div>
    </td></tr>`,
    steps: stepRow,
    productGrid: `<tr><td style="padding:14px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${prods}</tr></table></td></tr>`,
    testimonials: testiBlocks ? `<tr><td style="padding:8px 26px 6px">${testiBlocks}</td></tr>` : '',
    guarantee: guarantee ? `<tr><td align="center" style="padding:6px 26px"><div style="border:1px dashed ${P.lava};border-radius:10px;padding:14px 18px"><span style="font-family:${heads};font-size:14px;color:${P.forest_green};font-weight:700">${esc(guarantee.headline)}</span> <span style="font-family:${body};font-size:12.5px;color:${P.near_black}AA">${esc(guarantee.body)}</span></div></td></tr>` : '',
    agentCta: `<tr><td align="center" style="padding:18px 26px 8px">
      <div style="border:1px solid ${P.lava}55;border-radius:12px;padding:20px 22px;background:#ffffff">
        <div style="font-family:${heads};font-size:17px;color:${P.forest_green}">Not sure where to begin?</div>
        <div style="font-family:${body};font-size:13px;color:${P.near_black}AA;line-height:1.6;margin-top:6px">Talk to our sneaker expert, ask about benefits, crafting, and which colorway fits your ritual. It answers, out loud, like a call.</div>
        <a href="${agentUrl}" style="display:inline-block;margin-top:12px;background:${P.forest_green};color:${P.chalk};font-family:${body};font-size:13px;font-weight:700;padding:11px 26px;border-radius:8px;text-decoration:none">Talk to the ${esc(label)} expert →</a>
      </div>
    </td></tr>`,
  };
  // Assemble the body in the archetype's order; badges always follow the hero
  // (first section). Unknown/empty keys are skipped. Fallback to a sane order.
  const order = (strat.order && strat.order.length) ? strat.order : ['heroGreen', 'photoBand', 'bodyStory', 'steps', 'productGrid', 'testimonials', 'guarantee', 'agentCta'];
  const bodyRows = order.map((k, i) => (SEC[k] || '') + (i === 0 ? SEC.badges : '')).join('\n  ');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(copy.subject)}</title></head>
<body style="margin:0;padding:0;background:${P.chalk}">
<div style="display:none;max-height:0;overflow:hidden">${esc(copy.preheader)}</div>
<div style="display:none;max-height:0;overflow:hidden">Design: ${esc(strat.label)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${P.chalk}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%">
  <tr><td align="center" style="background:${P.lava};border-radius:8px;padding:8px 14px;font-family:${body};font-size:12px;font-weight:700;color:${P.near_black}">${esc(offerBar)}</td></tr>
  <tr><td align="center" style="padding:18px 0 8px">
    <a href="${store}" target="_blank" style="text-decoration:none;display:inline-block">
      <div style="font-family:${heads};font-size:22px;letter-spacing:0.28em;color:${P.forest_green};font-weight:700">${esc(label)}</div>
      <div style="font-family:${body};font-size:10px;letter-spacing:0.22em;color:${P.lava};text-transform:uppercase;margin-top:4px">${esc(String(slot.market || '').toUpperCase())}</div>
    </a>
  </td></tr>
  ${bodyRows}
  <tr><td align="center" style="padding:8px 20px 26px">
    <a href="${collectionUrl}" target="_blank" style="display:inline-block;font-family:${body};font-size:13px;font-weight:700;color:${P.forest_green};border:1.5px solid ${P.lava};border-radius:8px;padding:11px 24px;text-decoration:none">${esc(copy.cta_secondary || 'Explore the collection')}</a>
  </td></tr>
  <tr><td align="center" style="background:${P.near_black};padding:24px 22px 30px">
    <div style="font-family:${heads};font-size:14px;letter-spacing:0.24em;color:${P.chalk}">${esc(label)}</div>
    <div style="font-family:${body};font-size:10.5px;letter-spacing:0.05em;color:${P.lava};margin:9px 0">${esc(sender.name)}</div>
    <div style="font-family:${body};font-size:11px;color:${P.chalk}99;line-height:1.7">${esc(sender.name)} &middot; ${esc(sender.address)}<br>You are receiving this as a valued ${esc(label)} ${esc(slot.market)} customer.<br>Manage preferences or unsubscribe from your account settings.</div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

// Build the same mailer taxonomy as the Mailer Studio / Mailer Calendar:
// two named types, two variants each: 2 Text (colour + type + structural
// elements, no media) and 2 Text + Visual (with a real product image). Uses the
// shared renderTextVariant so the look + quality match across features. The
// rich brand mailer becomes one of the Text + Visual variants. Falls back to
// just the rich mailer if the shared renderer is unavailable.
function mailerVariants(slot, copy, products, brand, agentUrl, richHtml) {
  if (!renderTextVariant) return null;
  const store = storeUrl(brand, slot.market);
  const p0 = products[0] || {};
  const heroImg = productImage(p0, slot.market, slotBrand(slot, brand)) || '';
  const S = {
    hero_headline: copy.headline,
    hero_subline: copy.subheadline,
    body_blocks: [
      copy.body_intro ? { heading: '', body: copy.body_intro } : null,
      copy.story ? { heading: '', body: copy.story } : null,
      (copy.testimonial && copy.testimonial.quote) ? { heading: '', body: `"${copy.testimonial.quote}" - ${copy.testimonial.name || ''}` } : null,
    ].filter(Boolean),
    cta_text: copy.cta_primary || 'Shop the edit',
  };
  const collectionUrl = collectionUrlFor(store, p0.type, brand);
  // `withGrid` gates the real product-image grid + collection CTA to the
  // Text + Visual variants; pure "Text" variants stay graphics-free per taxonomy.
  const mk = (style, img, withGrid) => renderTextVariant({
    style, subject: copy.subject, hero_headline: S.hero_headline, hero_subline: S.hero_subline,
    body_blocks: S.body_blocks, cta_text: S.cta_text, cta_url: store, market: slot.market,
    hero_product: p0.title || slot.theme || '', hero_image_url: img || undefined,
    // Flagship-parity: real inline product grid + derived collection CTA + offer bar.
    ...(withGrid ? { products, collection_url: collectionUrl, offer_bar: (copy.landing && copy.landing.offer_bar) || undefined } : {}),
  });
  return [
    { key: 'text_a', type: 'Text', label: 'Text · Concise', html: mk('pure') },
    { key: 'text_b', type: 'Text', label: 'Text · Editorial', html: mk('editorial') },
    { key: 'visual_a', type: 'Text + Visual', label: 'Text + Visual · Hero', html: mk('visual', heroImg, true) },
    { key: 'visual_b', type: 'Text + Visual', label: 'Text + Visual · Rich brand', html: richHtml },
  ];
}

function landingHtml(slot, copy, products, brand, agentUrl) {
  const P = brand.palette;
  const heads = brand.typography.headings.fallback;
  const body = brand.typography.body.fallback;
  const store = storeUrl(brand, slot.market);
  const label = brandLabel(brand);
  const sender = senderIdentity(brand);
  const cur = slot.market === 'UK' ? '£' : '$';
  const esc = (s) => String(s == null ? '' : s).replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
  const L = copy.landing || {};
  // Defensive defaults so an older/partial LLM response still renders well.
  const eyebrow = L.hero_eyebrow || slot.festival || slot.theme || 'Single-studio · Hand-painted';
  const heroH = L.hero_headline || copy.headline;
  const heroSub = L.hero_sub || copy.subheadline;
  const offerBar = L.offer_bar || `Welcome gift: free rope laces and lace tag with every custom pair`;
  const badges = (L.trust_badges && L.trust_badges.length ? L.trust_badges : ['Single-studio origin', 'Packed days after drop', 'Carbon & plastic neutral', '1M+ pairs poured']);
  const problem = L.problem || { headline: 'Most sneaker is older than you think', body: copy.body_intro };
  const mech = L.mechanism || { headline: 'Why origin-fresh tastes different', steps: [] };
  const benefits = (L.benefits && L.benefits.length ? L.benefits : (L.benefit_bullets || []).map((b) => ({ title: b, desc: '' })));
  // Real-only gate: drop the fabricated "vs Supermarket sneaker" comparison (its
  // disparaging claims are unverified), and show only approved testimonials.
  const comp = brandFacts.enabled() ? null : (L.comparison || null);
  const testis = gateTestis((L.testimonials && L.testimonials.length ? L.testimonials : [copy.testimonial].filter(Boolean).map((t) => ({ quote: t.quote, name: t.name, location: '' }))), slot, products[0]);
  const stack = L.offer_stack || { headline: 'What is in your first order', items: [], price_note: '', cta: copy.cta_primary };
  const faqList = L.faq || [];
  const guarantee = L.guarantee || { headline: 'Lace-up it risk-free', body: 'Love the panel or we will make it right.' };
  const agentStem = isShippedBrand(brand) ? 'knickgasm' : String((brand && brand.name) || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const agentId = `${agentStem}_${(slot.cohort_id || slot.market || 'general').toString().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

  const badgeRow = badges.slice(0, 4).map((b) => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:${P.chalk}DD"><span style="color:${P.lava}">✦</span>${esc(b)}</span>`).join('<span style="opacity:.4">·</span>');
  const steps = (mech.steps || []).slice(0, 3).map((s, i) => `
    <div class="card" style="animation-delay:${i * 90}ms;background:#fff;border:1px solid ${P.lava}33;border-radius:14px;padding:24px">
      <div style="width:34px;height:34px;border-radius:50%;background:${P.forest_green};color:${P.chalk};display:flex;align-items:center;justify-content:center;font-weight:700;font-family:${heads}">${i + 1}</div>
      <div style="font-family:${heads};font-size:18px;color:${P.near_black};margin:14px 0 6px">${esc(s.title)}</div>
      <div style="font-size:14px;color:${P.near_black}AA;line-height:1.6">${esc(s.desc)}</div>
    </div>`).join('');
  const benefitCards = benefits.slice(0, 4).map((b, i) => `
    <div class="card" style="animation-delay:${i * 70}ms;background:#fff;border:1px solid ${P.lava}33;border-radius:14px;padding:22px">
      <div style="color:${P.lava};font-size:20px">✦</div>
      <div style="font-family:${heads};font-size:17px;color:${P.near_black};margin:8px 0 6px">${esc(b.title)}</div>
      ${b.desc ? `<div style="font-size:14px;color:${P.near_black}AA;line-height:1.6">${esc(b.desc)}</div>` : ''}
    </div>`).join('');
  const prods = products.slice(0, 3).map((p, i) => `
    <a href="${p.url || store}" class="card" style="animation-delay:${i * 90}ms;text-decoration:none;background:#fff;border:1px solid ${P.lava}33;border-radius:14px;padding:26px 20px;display:block">
      <div style="font-family:${heads};font-size:18px;color:${P.near_black};line-height:1.35">${esc(p.title)}</div>
      <div style="font-size:13px;color:${P.near_black}88;margin-top:6px">${esc(p.category)}</div>
      <div style="font-size:15px;color:${P.lava};font-weight:700;margin-top:12px">${cur}${p.price}</div>
    </a>`).join('');
  const compTable = comp ? `
  <section style="padding:24px 0 72px"><div class="wrap" style="max-width:760px">
    <h3 style="font-family:${heads};font-size:26px;color:${P.forest_green};text-align:center;margin-bottom:24px">The difference, side by side</h3>
    <div style="overflow:hidden;border:1px solid ${P.lava}33;border-radius:14px;background:#fff">
      <table style="width:100%;border-collapse:collapse;font-size:14.5px">
        <thead><tr style="background:${P.forest_green};color:${P.chalk}">
          <th style="text-align:left;padding:14px 16px;font-family:${heads};font-weight:600"></th>
          <th style="padding:14px 16px;font-family:${heads};font-weight:700">${esc(comp.us_label || label)}</th>
          <th style="padding:14px 16px;font-family:${heads};font-weight:600;color:${P.chalk}AA">${esc(comp.them_label || 'Supermarket sneaker')}</th>
        </tr></thead>
        <tbody>${(comp.rows || []).map((r, i) => `<tr style="background:${i % 2 ? P.chalk : '#fff'}">
          <td style="padding:13px 16px;color:${P.near_black}99">${esc(r.feature)}</td>
          <td style="padding:13px 16px;text-align:center;font-weight:600;color:${P.forest_green}">${esc(r.us)}</td>
          <td style="padding:13px 16px;text-align:center;color:${P.near_black}88">${esc(r.them)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </div></section>` : '';
  const testiCards = testis.slice(0, 3).map((t, i) => `
    <div class="card" style="animation-delay:${i * 80}ms;background:#fff;border:1px solid ${P.lava}33;border-radius:14px;padding:24px">
      <div style="color:${P.lava};letter-spacing:2px">★★★★★</div>
      <div style="font-family:${heads};font-style:italic;font-size:16px;line-height:1.6;margin:10px 0;color:${P.near_black}">“${esc(t.quote)}”</div>
      <div style="font-size:12.5px;color:${P.lava};font-weight:600">- ${esc(t.name)}${t.location ? `, ${esc(t.location)}` : ''}</div>
    </div>`).join('');
  const stackItems = (stack.items || []).map((it) => `<li style="margin:10px 0;padding-left:28px;position:relative;line-height:1.6"><span style="position:absolute;left:0;color:${P.lava}">✓</span>${esc(it)}</li>`).join('');
  const faq = faqList.map((f) => `<details style="border-bottom:1px solid ${P.lava}33;padding:16px 0"><summary style="font-family:${heads};font-size:17px;color:${P.near_black};cursor:pointer;list-style:none">${esc(f.q)}</summary><p style="color:${P.near_black}BB;line-height:1.7;margin:10px 0 0">${esc(f.a)}</p></details>`).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heroH)} — ${esc(label)}</title>
<meta name="description" content="${esc(heroSub)}">
<style>
  *{box-sizing:border-box}
  body{margin:0;background:${P.chalk};color:${P.near_black};font-family:${body};padding-bottom:64px}
  .wrap{max-width:1040px;margin:0 auto;padding:0 22px}
  .fade{opacity:0;transform:translateY(18px);animation:up .7s ease forwards}
  .card{opacity:0;transform:translateY(18px) scale(.98);animation:up .6s ease forwards}
  @keyframes up{to{opacity:1;transform:none}}
  .cta{display:inline-block;background:${P.lava};color:${P.near_black};font-weight:700;font-size:15px;padding:16px 38px;border-radius:9px;text-decoration:none;transition:transform .2s, box-shadow .2s}
  .cta:hover{transform:translateY(-2px);box-shadow:0 14px 34px ${P.forest_green}44}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
  .obar{background:${P.lava};color:${P.near_black};text-align:center;font-size:13px;font-weight:600;padding:9px 14px}
  .stickb{position:fixed;left:0;right:0;bottom:0;z-index:50;background:${P.forest_green};display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;box-shadow:0 -6px 20px rgba(0,0,0,.18)}
  .stickb .p{color:${P.chalk};font-size:13px}.stickb .p b{color:${P.lava}}
  @media(max-width:760px){.split{grid-template-columns:1fr!important}.stickb .p{display:none}}
</style></head>
<body>
<div class="obar">${esc(offerBar)}</div>
<header style="background:${P.forest_green};padding:14px 0"><div class="wrap" style="display:flex;justify-content:space-between;align-items:center">
  <div style="font-family:${heads};letter-spacing:.3em;color:${P.chalk};font-weight:700">${esc(label)}</div>
  <a href="${agentUrl}" style="color:${P.lava};font-size:13px;text-decoration:none">🎙 Talk to our sneaker expert</a>
</div></header>

<section style="background:${P.forest_green};padding:72px 0 64px;text-align:center">
  <div class="wrap">
    <div class="fade" style="font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:${P.lava}">${esc(eyebrow)}</div>
    <h1 class="fade" style="animation-delay:.1s;font-family:${heads};font-size:clamp(34px,5vw,56px);color:${P.chalk};line-height:1.15;margin:18px auto;max-width:780px">${esc(heroH)}</h1>
    <p class="fade" style="animation-delay:.2s;color:${P.chalk}CC;font-size:17px;max-width:580px;margin:0 auto 30px;line-height:1.65">${esc(heroSub)}</p>
    <a class="cta fade" style="animation-delay:.3s" href="${store}">${esc(copy.cta_primary)}</a>
    <div class="fade" style="animation-delay:.4s;margin-top:26px;display:flex;gap:14px;flex-wrap:wrap;justify-content:center">${badgeRow}</div>
  </div>
</section>

<section style="padding:64px 0 24px"><div class="wrap" style="max-width:760px;text-align:center">
  <h2 style="font-family:${heads};font-size:30px;color:${P.forest_green}">${esc(problem.headline)}</h2>
  <p style="line-height:1.85;color:${P.near_black}CC;font-size:16px">${esc(problem.body)}</p>
</div></section>

<section style="padding:24px 0 56px"><div class="wrap">
  <h3 style="font-family:${heads};font-size:26px;color:${P.forest_green};text-align:center;margin-bottom:28px">${esc(mech.headline)}</h3>
  <div class="grid">${steps}</div>
</div></section>

<section style="padding:8px 0 56px"><div class="wrap">
  <div class="grid">${benefitCards}</div>
</div></section>

<section style="padding:8px 0 64px"><div class="wrap">
  <h3 style="font-family:${heads};font-size:24px;color:${P.forest_green};text-align:center;margin-bottom:28px">Laced most by this cohort</h3>
  <div class="grid">${prods}</div>
</div></section>

${compTable}

<section style="padding:8px 0 64px"><div class="wrap">
  <h3 style="font-family:${heads};font-size:26px;color:${P.forest_green};text-align:center;margin-bottom:28px">From people who switched</h3>
  <div class="grid">${testiCards}</div>
</div></section>

<section style="padding:8px 0 72px"><div class="wrap" style="max-width:760px">
  <div style="background:${P.forest_green};border-radius:18px;padding:40px;color:${P.chalk};text-align:center">
    <h3 style="font-family:${heads};font-size:26px;color:${P.chalk};margin:0 0 8px">${esc(stack.headline)}</h3>
    <ul style="list-style:none;padding:0;text-align:left;max-width:440px;margin:18px auto;font-size:15px;color:${P.chalk}EE">${stackItems}</ul>
    ${stack.price_note ? `<div style="color:${P.lava};font-weight:700;font-size:18px;margin:8px 0 18px">${esc(stack.price_note)}</div>` : ''}
    <a class="cta" href="${store}">${esc(stack.cta || copy.cta_primary)}</a>
  </div>
</div></section>

<section style="padding:0 0 24px"><div class="wrap" style="max-width:720px">
  <h3 style="font-family:${heads};font-size:24px;color:${P.forest_green}">Questions, answered</h3>${faq}
</div></section>

<section style="padding:24px 0 72px"><div class="wrap" style="max-width:640px;text-align:center">
  <div style="border:1px dashed ${P.lava};border-radius:14px;padding:28px;background:#fff">
    <div style="font-family:${heads};font-size:20px;color:${P.forest_green}">${esc(guarantee.headline)}</div>
    <p style="color:${P.near_black}AA;line-height:1.7;margin:8px 0 0">${esc(guarantee.body)}</p>
  </div>
  <div style="margin-top:34px"><a class="cta" href="${store}">${esc(copy.cta_secondary || copy.cta_primary)}</a></div>
  <div style="margin-top:14px"><a href="${agentUrl}" style="color:${P.forest_green};font-weight:700;text-decoration:none;font-size:14px">🎙 Or ask our sneaker expert anything →</a></div>
</div></section>

<footer style="background:${P.near_black};color:${P.chalk}99;text-align:center;padding:30px;font-size:12px">${esc(sender.name)} &middot; ${esc(sender.address)}</footer>

<div class="stickb">
  <div class="p"><b>${esc(offerBar)}</b></div>
  <a class="cta" style="padding:11px 26px;font-size:14px" href="${store}">${esc(copy.cta_primary)}</a>
</div>

<!-- Embedded voice agent (chat + voice) -->
<script src="/agent-widget.js" data-agent="${agentId}" data-collection="${esc(slot.market || '')}" defer></script>
</body></html>`;
}

// ── Platform-ready campaign objects (phase-2 push plugs in here) ────────────
function audienceSpec(slot, cohort) {
  const base = cohort ? { cohort_id: cohort.id, name: cohort.name, definition: cohort.definition, size: cohort.size } : { name: 'All engaged customers' };
  return {
    primary: base,
    retargeting: {
      name: `RT · ${slot.theme || slot.channel} · ${slot.market}`,
      rule: 'engaged with this campaign (open/click/video_view ≥ 50%) OR visited landing page, last 14d, excluding purchasers 7d',
      window_days: 14,
    },
    expansion: {
      lookalike: { source: base.name, ratio: slot.market === 'US' ? '1-3%' : '1-5%', note: 'similar-audience seed = cohort members with ≥2 orders' },
      interest_stack: ['premium sneaker', 'ayurveda', 'streetwear rituals', 'specialty grocery'],
    },
    exclusions: ['purchasers_last_7d', 'unsubscribed', 'refunded_last_90d'],
  };
}

function campaignObjects(slot, copy, cohort, products, brand) {
  const aud = audienceSpec(slot, cohort);
  const store = storeUrl(brand, slot.market);
  const sender = senderIdentity(brand);
  const utm = `utm_source={platform}&utm_medium={medium}&utm_campaign=${encodeURIComponent(slot.id)}`;
  const objs = [];
  if (slot.channel === 'email' || slot.channel === 'landing_email') {
    objs.push({
      platform: 'klaviyo',
      campaign_object: {
        type: 'campaign', name: `${slot.theme} · ${slot.market} · ${slot.slot_date}`,
        audience: aud, send_time_local: '09:30',
        message: { subject: copy.subject, preheader: copy.preheader, from_name: sender.from_name, from_email: sender.from_email, template_ref: `asset:mailer_html:${slot.id}` },
        ab_test: { dimension: 'subject', variants: [copy.subject, `${copy.headline}, inside`], split: 0.5, metric: 'open_rate' },
        followup: { trigger: 'no_open_48h', action: 'resend_new_subject' },
        utm,
      },
    });
  }
  if (slot.channel === 'google') {
    objs.push({
      platform: 'google_ads',
      campaign_object: {
        campaign: { name: `G·${slot.market}·${slot.slot_date}·${slot.theme}`, type: 'SEARCH', bidding: 'MAXIMIZE_CONVERSION_VALUE', budget_daily_usd: 80, geo: slot.market === 'UK' ? ['GB'] : ['US'] },
        ad_group: { name: slot.angle || 'core', keywords: (copy.google.headlines || []).slice(0, 6).map((h) => ({ text: h.toLowerCase(), match: 'PHRASE' })) },
        responsive_search_ad: { headlines: copy.google.headlines, descriptions: copy.google.descriptions, final_url: `${store}?${utm.replace('{platform}', 'google').replace('{medium}', 'cpc')}` },
        extensions: { callouts: copy.google.callouts || [], sitelinks: copy.google.sitelinks || [] },
        audience: aud,
      },
    });
  }
  if (slot.channel === 'meta') {
    objs.push({
      platform: 'meta_ads',
      campaign_object: {
        campaign: { name: `M·${slot.market}·${slot.slot_date}·${slot.theme}`, objective: 'OUTCOME_SALES', budget_daily_usd: 70 },
        ad_set: { optimization: 'OFFSITE_CONVERSIONS', audience: aud, placements: ['feed', 'stories', 'reels'] },
        creative: { primary_text: copy.meta.primary_text, primary_text_variants: copy.meta.primary_text_variants || [], headline: copy.meta.headline, headlines: copy.meta.headlines || [copy.meta.headline], description: copy.meta.description, cta: 'SHOP_NOW', link: `${store}?${utm.replace('{platform}', 'meta').replace('{medium}', 'paid_social')}`, brief: `${copy.meta.creative_concept || `1-second emotional scroll-stop — the calm of a quiet morning pair of ${products[0] ? products[0].title : 'sneaker'}, soft dawn light, steam, lava props on ${brand.palette.chalk} linen`}. Paid Meta creative for P01 (women 45+/busy mums): sell the HAPPINESS end-state (calmer mornings, steady energy, "like myself again"), NOT ingredients. BAKE the headline "${copy.meta.headline || ''}" + the offer INTO the creative as legible on-palette text overlay (Montserrat headline, Instrument Sans offer) in the safe zone. Palette: deep purple ${brand.palette.forest_green} / lava ${brand.palette.lava} / chalk ${brand.palette.chalk}.`, formats: ['1:1 static hero', '4:5 feed', '9:16 story/reel', '3-card carousel (studio → panel → pair)'] },
        ab_test: { dimension: 'primary_text', variants: copy.meta.primary_text_variants || ['static_hero', 'carousel_3p'], metric: 'roas' },
      },
    });
  }
  if (slot.channel === 'tiktok') {
    objs.push({
      platform: 'tiktok_ads',
      campaign_object: {
        campaign: { name: `T·${slot.market}·${slot.slot_date}·${slot.theme}`, objective: 'WEB_CONVERSIONS', budget_daily_usd: 50 },
        ad_group: { audience: aud, placements: ['tiktok'], optimization: 'CONVERSION' },
        creative: { hook_line: copy.tiktok.hook_line, script: copy.tiktok.script, shot_list: copy.tiktok.shot_list || [], captions: copy.tiktok.captions || [], format: 'ugc_voiceover_15s', link: `${store}?${utm.replace('{platform}', 'tiktok').replace('{medium}', 'paid_social')}`, brief: 'Creator-style kitchen shot, natural daylight, craft pour at 0:03 with steam bloom, on-screen captions per shot_list, end-card in deep purple with lava CTA. Vertical 9:16, sound-on, no licensed music.' },
      },
    });
  }
  if (slot.channel === 'landing_email' || slot.channel === 'landing_ads') {
    objs.push({
      platform: 'landing',
      campaign_object: { type: 'landing_page', name: `LP·${slot.market}·${slot.slot_date}`, html_ref: `asset:landing_html:${slot.id}`, paired_channel: (slot.source || {}).paired_channel || null, cro: { above_fold_cta: true, social_proof: true, faq_schema: true, voice_agent_entry: true } },
    });
  }
  return objs;
}

function funnelSpec(slot, cohort, copy) {
  return {
    id: idFor('fun', { slot: slot.id }),
    cohort_id: cohort ? cohort.id : null,
    slot_id: slot.id,
    name: `Funnel · ${slot.theme || slot.channel} · ${slot.market} · ${slot.slot_date}`,
    stages: [
      { step: 1, stage: 'creative', channel: slot.channel.startsWith('landing') ? ((slot.source || {}).paired_channel || 'email') : slot.channel, asset: 'ad_copy/mailer', goal: 'attention', kpi: slot.channel === 'email' ? 'open_rate' : 'ctr' },
      { step: 2, stage: 'landing', channel: 'landing', asset: 'landing_html', goal: 'conversion', kpi: 'cvr', cro: ['hero CTA above fold', 'voice-agent assist entry', 'testimonial proof', 'FAQ objections'] },
      { step: 3, stage: 'mailer_followup', channel: 'email', asset: 'mailer_html', goal: 'recover + repeat', kpi: 'rpr', trigger: 'visited LP, no purchase 48h → follow-up mailer; purchased → post-purchase ritual series' },
    ],
    retargeting: audienceSpec(slot, cohort).retargeting,
    audiences: audienceSpec(slot, cohort),
    created_at: new Date().toISOString(),
  };
}

// ── main entry ───────────────────────────────────────────────────────────────
async function generateForSlot(slotId, { persist = true } = {}) {
  // This engine is TENANT ZERO's (2026-10-10): its fallback copy, its landing
  // pages (the Campaign Hub compiler), its sender identity and its collection
  // slugs are one brand's content, so a slot generated here for any other
  // brand came back as that brand's sneaker copy under its own name. Another
  // brand's slot is built by the Smart Brain builder (smart-brain-preview /
  // approve), which derives every asset from that brand's own record.
  try {
    const rt = require('./brand-runtime.js');
    const sb = rt.scopedBrand(null, { allowTenantZero: true });
    if (require('./brand-catalog-server.js').isTenantZeroBrand(sb) !== true) {
      const name = (sb && sb.name) || 'this brand';
      const e = new Error(`This slot engine is built on another brand's content, so nothing was generated for ${name}. Build the slot from the Smart Brain calendar, which derives every asset from ${name}'s own record. [DATA REQUIRED BEFORE LAUNCH: slot assets from this brand's own record, ${name}]`);
      e.status = 409; e.code = 'slot_engine_not_this_brand';
      e.data_gaps = [`[DATA REQUIRED BEFORE LAUNCH: slot assets from this brand's own record, ${name}]`];
      throw e;
    }
  } catch (e) { if (e && e.code === 'slot_engine_not_this_brand') throw e; }
  const d = db();
  const [slotRows, brand] = await Promise.all([
    d.select('smart_calendar', { filters: { id: `eq.${slotId}` }, limit: 1 }),
    getBrandKit(),
  ]);
  const slot = slotRows[0];
  if (!slot) throw new Error(`slot ${slotId} not found`);

  const [cohortRows, lib] = await Promise.all([
    slot.cohort_id ? d.select('smart_cohorts', { filters: { id: `eq.${slot.cohort_id}` }, limit: 1 }) : Promise.resolve([]),
    analysis.filteredLibrary({ channel: slot.channel.startsWith('landing') ? 'email' : slot.channel, market: slot.market }),
  ]);
  const cohort = cohortRows[0] || null;

  // product selection: match cohort categories then top sellers
  const products = await d.select('smart_products', { filters: { market: `eq.${slot.market}` }, limit: 200 });
  const wantTags = cohort ? JSON.stringify(cohort.definition).toLowerCase() : '';
  const picked = products
    .map((p) => ({ p, rel: (p.tags || []).reduce((s, t) => s + (wantTags.includes(t) ? 1 : 0), 0) + ((slot.festival && (p.tags || []).includes('gift')) ? 2 : 0) }))
    .sort((a, b) => b.rel - a.rel || (b.p.tags || []).includes('bestseller') - (a.p.tags || []).includes('bestseller'))
    .slice(0, 3).map((x) => x.p)
    // Guarantee a real hosted photo on each product so the Text + Visual mailer
    // variants always render an image (the smart_products rows often lack one).
    .map((p) => ({ ...p, image: productImage(p, slot.market, slotBrand(slot, brand)) }));

  const copy = await generateCopy(slot, picked, brand, lib.items);
  const agentUrl = `/agent?ctx=${encodeURIComponent(slot.market)}&from=${encodeURIComponent(slot.id)}`;

  const funnel = funnelSpec(slot, cohort, copy);
  const objects = campaignObjects(slot, copy, cohort, picked, brand);

  const assets = [];
  const push = (type, name, content, meta = {}) => assets.push({ id: idFor('ast', { slot: slot.id, type, name }), slot_id: slot.id, type, name, content, meta, created_at: new Date().toISOString() });

  if (slot.channel === 'email') {
    const richHtml = mailerHtml(slot, copy, picked, brand, agentUrl);
    const variants = mailerVariants(slot, copy, picked, brand, agentUrl, richHtml);
    push('mailer_html', `Mailer · ${slot.theme} · ${slot.market}`, richHtml, { subject: copy.subject, preheader: copy.preheader, variants: variants || ['A: image hero', 'B: text editorial'] });
  }
  if (slot.channel.startsWith('landing')) {
    const store = storeUrl((slot && slot.brand) || brand, slot.market);
    const hub = pickCampaignHubLP(slot, picked, (slot && slot.brand) || (typeof entry !== "undefined" && entry && entry.brand) || null);
    if (hub) {
      // Premium curated themed LP from the Campaign Hub compiler.
      push('landing_html', `Landing · ${hub.theme.name} · ${slot.market}`, lpCompiler.compileHTML(hub.theme, hub.variant, store),
        { source: 'campaign_hub', theme: hub.theme.slug, variant: hub.variant.code, paired: (slot.source || {}).paired_channel || null });
    } else {
      push('landing_html', `Landing · ${slot.theme} · ${slot.market}`, landingHtml(slot, copy, picked, brand, agentUrl),
        { source: 'brain_llm', paired: (slot.source || {}).paired_channel || null });
    }
  }
  if (['google', 'meta', 'tiktok'].includes(slot.channel)) {
    push('ad_copy', `${slot.channel} copy · ${slot.market}`, JSON.stringify(slot.channel === 'google' ? copy.google : slot.channel === 'meta' ? copy.meta : copy.tiktok, null, 2), { angle: slot.angle });
    const brief = objects.find((o) => o.platform.includes(slot.channel === 'google' ? 'google' : slot.channel));
    if (brief) push('ad_creative_brief', `${slot.channel} creative brief`, JSON.stringify(((brief.campaign_object || {}).creative || (brief.campaign_object || {}).responsive_search_ad) || {}, null, 2));
  }
  push('audience_spec', `Audiences · ${slot.market}`, JSON.stringify(audienceSpec(slot, cohort), null, 2));
  push('funnel_spec', funnel.name, JSON.stringify(funnel, null, 2));

  // Carry the slot's real confidence onto every generated campaign (was a
  // hardcoded confidence:0). The planning analysis was stashed in the slot's
  // source column by brain-calendar.slotRow().
  const slotAnalysis = (slot.source && slot.source.analysis) || null;
  const slotConfidence = (typeof slot.confidence === 'number' && slot.confidence > 0) ? slot.confidence : (slotAnalysis && slotAnalysis.confidence && slotAnalysis.confidence.score) || 0;
  const genCampaigns = objects.map((o) => ({
    id: idFor('gen', { slot: slot.id, platform: o.platform }),
    slot_id: slot.id, funnel_id: funnel.id, platform: o.platform,
    campaign_object: o.campaign_object, status: 'pending_review',
    confidence: slotConfidence,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }));

  if (persist) {
    await d.upsert('smart_funnels', [funnel], 'id');
    const saved = await d.upsert('smart_generated_campaigns', genCampaigns, 'id');
    const withFk = assets.map((a) => ({ ...a, generated_campaign_id: (saved[0] || {}).id || null }));
    await d.upsert('smart_generated_assets', withFk, 'id');
    await d.update('smart_calendar', { id: `eq.${slot.id}` }, { status: 'generated', updated_at: new Date().toISOString() });
    // every campaign enters the human review queue (launch state: ALWAYS)
    await d.insert('smart_review_queue', genCampaigns.map((g) => ({ item_type: 'generated_campaign', item_id: g.id, state: 'pending' })));
  }
  // Surface the planning reasoning on the returned campaigns so the UI/API can
  // show WHY each was generated (kept off the persisted rows to stay schema-safe).
  const campaignsOut = genCampaigns.map((g) => ({ ...g, rationale: slot.rationale || (slotAnalysis && slotAnalysis.summary) || null, analysis: slotAnalysis }));
  return { ok: true, slot_id: slot.id, funnel, campaigns: campaignsOut, analysis: slotAnalysis, assets: assets.map((a) => ({ id: a.id, type: a.type, name: a.name, bytes: (a.content || '').length })), copy };
}

module.exports = { generateForSlot, mailerHtml, landingHtml, campaignObjects, audienceSpec, fallbackCopy, pickCampaignHubLP };
