'use strict';

/**
 * Master-prompt builder — the single, portable "copy anywhere" prompt.
 *
 * Every generated asset (mailer / ad / landing page) carries a `master_prompt`:
 * one self-contained block a human can paste into a BLANK ChatGPT, Claude, or
 * Gemini session and get the same top-tier, on-brand output the app produces —
 * with zero prior context. So the brand rules, catalog facts, regional details,
 * and the exact output contract are all baked into the string itself.
 *
 * This module is also the single source of truth for the brand constraint block
 * (BRAND_BLOCK) — other prompt sites should import it rather than re-deriving it.
 */

const assetSpecs = require('./asset-specs');

// ── Brand constants (source of truth: Brand style guide.pdf) ────────────────
const BRAND_BLOCK = `BRAND: KNICKGASM — India's largest sneaker customisers. Hand-painted, one-of-one custom sneakers (Nike Air Force 1, Jordan 1, Dunks, Court Vision, Converse, Adidas Sambas), custom denim jackets and sneaker accessories. Made on 100% original brand sneakers by India's best artists; water & scratch resistant designs; express shipping worldwide (60+ countries).
VOICE: bold, energetic, youth street-culture, hype but authentic. Confident and playful, never corporate. Testimonials read like a friend flexing their new pair, not a review.
PALETTE (use ONLY these four — exact knickgasm.com theme): #D0473E lava red (primary accent, --color-primary on the live site) · #6A33D8 drip purple (secondary accent, sale/badge moments) · #111111 ink black (text + primary buttons) · #FFFFFF pure white (background).
CONTRAST (strict): on white bg → body text MUST be #111111, headings #111111 or #D0473E (never white text). On red/purple/ink bg → ALL text MUST be #FFFFFF white (never ink). Red as text on white MUST use font-weight 600/700. Buttons follow the live site: ink #111111 button with white text is the default CTA; red is accent, never full-page background.
TYPOGRAPHY (strict): Headings = 'Montserrat' 700/800 (fallback 'Raleway',Arial,sans-serif). Body = 'Instrument Sans' (fallback 'Helvetica Neue',Arial,sans-serif). Never introduce other fonts. For any HTML asset, inject these EXACT imports into the <head> <style> before app rules:
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Instrument+Sans:wght@400;500;600&display=swap');
LOGO (header, exact — never substitute): <img src="https://knickgasm.com/cdn/shop/files/knick_black.svg?v=1731481332" alt="KNICKGASM" /> at a restrained header height (~30px).
FOOTER: "Privacy Policy" and "Terms of Service" must be plain labels with href="#" and no target/onclick routing.
PREFERRED words: custom, hand-painted, one-of-one, grail, canvas, colorway, drop, rotation, crafted, original.
BANNED phrases (never use): "streetwear journey", "transform", "liquid gold", "game-changer", "LIMITED TIME" (in caps), "hurry", "don't miss out", "last chance", "while supplies last".
NEVER: off-palette tints, counterfeit/replica implications (always "made on 100% original brand sneakers"), fake scarcity, ALL-CAPS urgency, fabricated filenames/URLs/selectors.`;

// ── Regional facts ──────────────────────────────────────────────────────────
const REGION = {
  US: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: '$', locale: 'en-US' },
  UK: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: '£', locale: 'en-GB' },
  IN: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: '₹', locale: 'en-IN' },
  EU: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: '€', locale: 'en-IE' },
  AU: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: 'A$', locale: 'en-AU' },
  Global: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: '$', locale: 'en' },
};
function regionFacts(market) { return REGION[market] || REGION.Global; }

// ── Product context ─────────────────────────────────────────────────────────
function productLines(products = [], currency = '$') {
  const list = (Array.isArray(products) ? products : []).filter(Boolean).slice(0, 8);
  if (!list.length) return '(no specific products supplied — refer to KNICKGASM offerings at CATEGORY level only, e.g. "one-of-one Jordan" or "coffee collection". Do NOT invent a specific product name, price, or handle/URL.)';
  return list.map((p) => {
    const title = p.title || p.name || p.t || 'KNICKGASM sneaker';
    const price = p.price ?? p.p;
    const handle = p.handle || p.h;
    const cat = p.category || p.cat || p.c || 'sneaker';
    return `- ${title}${price != null ? ` (${currency}${price})` : ''}${cat ? ` · ${cat}` : ''}${handle ? ` · handle: ${handle}` : ''}`;
  }).join('\n');
}

// ── Per-asset output contracts ──────────────────────────────────────────────
// The visual cascade for every visual asset, in the order the operator chose:
const VISUAL_CASCADE = `VISUALS — use this source order: (1) if a hosted media URL is provided, embed it (product image/GIF/MP4, e.g. a Shopify product video); (2) else describe an auto-generated animated GIF (2–4 still frames, gentle Ken-Burns or cross-fade) the team can produce from product photography; (3) AI-generated video only as a last resort. Every visual must be photoreal, on-palette, text-free in the image itself (text lives in the layout, not burned into the photo) unless the asset is an ad creative.`;

function mailerContract(variant) {
  if (variant === 'V1') {
    return `ASSET: Email mailer — VARIANT V1 (COMPLETE TEXTUAL CONTENT, no imagery).
Produce a fully text-driven email that stands on its own with zero images.
Deliver, in order:
1. 3 subject-line options (≤50 chars) + 1 preheader (≤90 chars).
2. Editorial hero headline + opening line that earns the scroll.
3. Body: 2–3 short story-driven paragraphs (origin, ritual, why-now).
4. A benefit triplet (3 crisp lines).
5. One tiny personal testimonial (story, not a star rating).
6. Clear CTA copy + the destination store URL.
7. Plain-text version suitable for deliverability.
Compact (~two scrolls). No layout/visual instructions — pure copy.`;
  }
  return `ASSET: Email mailer — VARIANT V2 (TEXTUAL + VISUAL).
Produce the same persuasive copy as V1 PLUS a complete visual layout.
Deliver, in order:
1. 3 subject lines + preheader.
2. Section-by-section layout: for each section give the COPY and the VISUAL (hero, lifestyle, product packshot, motion moment).
3. At least one motion slot (animated GIF or short product video) with an exact creative brief and where it sits. If it is a video, name the KNICKGASM-owned audio bed it is scored to (/assets/media/knickgasm-brand-beat.wav hero · knickgasm-reels-loop.wav short · knickgasm-ad-underscore.wav under-voiceover) — original, royalty-free, 90 BPM F minor; never a licensed/trending sound.
4. Benefit strip, social proof, offer bar, CTA — each with copy + visual direction.
5. Responsive, email-client-safe structure (Outlook bgcolor on colored cells; max ~1200–1500px tall).
${VISUAL_CASCADE}`;
}

// The studio compositor (ad-campaigns.html) renders ONE still PNG per size with
// the text overlay baked in. Be honest about that: list the exact static sizes
// it produces and treat motion as an OPTIONAL hand-off brief, never a delivered
// asset. The text fields (headlines/captions/scripts) are still authored as copy.
function adContract(platform) {
  // Copy-field limits per platform (authored text). Produced creative SIZES are
  // sourced from asset-specs.js (single source of truth) so every placement size
  // stays canonical and complete across the whole app.
  const copyGuide = {
    google: 'Google (Responsive Search + Performance Max): 15 headlines (≤30 chars), 4 descriptions (≤90 chars), long headline (≤90), business name.',
    meta: 'Meta (Facebook/Instagram Feed + Reels + Stories): primary text (≤125 chars before truncation), headline (≤40), description.',
    instagram: 'Instagram (Feed + Reels + Stories): caption with hook in first line + hashtags.',
    tiktok: 'TikTok (In-Feed + Spark): native-feeling video script with a 0–2s hook, on-screen text beats, caption, and 3 hashtag options. AUDIO: score it to a KNICKGASM-owned original bed — /assets/media/knickgasm-reels-loop.wav (16s cutdown) or knickgasm-brand-beat.wav (32s hero) or knickgasm-ad-underscore.wav (under voiceover); 90 BPM, F minor, seamless loop, royalty-free. Give the exact beat-sync moments (which cut lands on which downbeat). NEVER specify a trending/licensed sound for a paid ad. Always burn in captions — most feed views start muted. The produced creative is a cover keyframe (the script is a brief for a separate shoot/edit).',
  };
  const sizeKey = assetSpecs.ADS[platform] ? platform : 'meta';
  // onlyProduced: list ONLY the sizes the compositor actually renders, so the
  // prompt never claims deliverables the flow does not generate.
  const spec = (copyGuide[platform] || copyGuide.meta) + ' PRODUCED at each placement — ' + assetSpecs.adSpecText(sizeKey, { onlyProduced: true });
  return `ASSET: Paid ad creative for ${platform.toUpperCase()} — a FULL ad, not just copy.
The PRODUCED creative is a still, photoreal, on-palette image at each size below, with the on-creative text overlay BAKED INTO the image — exactly like a real ${platform} ad. The text is part of the rendered creative, NOT a separate caption: specify the exact overlay wording, font (Montserrat headings / Instrument Sans body), colour (use ONLY #D0473E / #6A33D8 / #FFFFFF / #111111), size and pixel placement within the safe zones (on 9:16 keep all text clear of the bottom 20% platform-UI chrome), legible at a glance.

━━ STRATEGY — SELL THE FEELING OF OWNING A ONE-OF-ONE ━━
TARGET (P01): sneakerheads and fandom buyers 18-34 (anime, football, gaming, cars, F1, Taylor Swift), plus gift-buyers and couples shopping wedding pairs.
SELL THE EMOTIONAL END-STATE, never the technique. The promise is identity and status — "the only pair on earth," "they will ask you where you got them," "your fandom on your feet." NEVER lead with technique or spec lists (airbrush, brush detail, sealant, embroidery, crystal setting); a spec may appear only as the *reason* the payoff is believable.
THE 1-SECOND SCROLL-STOP: the visual must stop a scrolling sneakerhead in under one second — the artwork filling the frame, a recognisable character or crest on a recognisable silhouette. Do NOT lead with heavy text or process call-outs. Scaling depends on scroll-stop + engagement, not just the click.
CURATE, DON'T INVENT: structure the creative on proven, replicable D2C streetwear formats (UGC, before/after of the blank vs the painted pair, painting-process time-lapse, day-in-the-life on-foot), not novel concepts.
OFFER: transition cleanly from the emotional hook into the real proposition — a hand-painted one-of-one on a 100% original sneaker, made to order in 10-15 days, shipped express worldwide — a premium, frictionless CTA, never a cheap pop-up. Use only offers supplied in the brief; never invent a discount or a percentage.

Platform spec: ${spec}
Deliver: (a) every text field the platform requires; (b) for EACH static size above, a precise creative brief describing the still visual, the BAKED-IN overlay wording (headline + offer) + exact pixel placement + safe zones; (c) the destination URL.
VISUALS (produced asset): one still, on-palette, photoreal image per size with the overlay baked in — this is exactly what the studio compositor renders. If a hosted product image/MP4 URL is supplied, its first frame is used as the base still. Motion (animated GIF / short video) is an OPTIONAL follow-up brief for the team — describe it only as a next step, NEVER as a delivered asset here. To produce the actual video ad from this brief, hand it to OpenMontage (open-source agentic video pipeline): https://github.com/Open-Montage/OpenMontage
AUDIO for any video deliverable: use a KNICKGASM-owned original bed from /assets/media/ (knickgasm-brand-beat.wav 32s hero · knickgasm-reels-loop.wav 16s short · knickgasm-ad-underscore.wav 22s under-voiceover) — 90 BPM, F minor, seamless loop, royalty-free for paid media. State the bed by filename and the beat-sync points. Never a trending or licensed track.`;
}

function landingContract(facts) {
  return `ASSET: Landing page in the try.knickgasm.* presell style (reference: https://${facts.presell}/...).
Build a conversion-focused, single-scroll-friendly page using the brand palette/typography.
Sections, in order: sticky announcement bar · hero (headline + sub + primary CTA) · trust/credentials row · problem→solution narrative · product reveal with price (${facts.currency}) · design/collection grid · craft proof (original base sneaker, named artists, water & scratch resistant finish, 10-15 day build) · testimonials as mini-stories · FAQ (accordion) · risk-reversal/guarantee · sticky footer CTA.
Every CTA links to the regional store (https://${facts.store}/products/{handle}). Mobile-first, fast, self-contained HTML/CSS (inline), no external fonts/scripts.
${VISUAL_CASCADE}`;
}

/**
 * Build the single portable master prompt for one asset.
 * @param {object} o
 * @param {'mailer'|'ad'|'landing_page'} o.assetType
 * @param {string} [o.market]
 * @param {string} [o.brief]      campaign brief / objective
 * @param {Array}  [o.products]
 * @param {string} [o.variant]    mailer: 'V1' | 'V2'
 * @param {string} [o.platform]   ad: 'google'|'meta'|'instagram'|'tiktok'
 * @param {string} [o.cohort]
 * @param {string} [o.extra]      any extra constraints to append
 * @returns {string}
 */
function buildMasterPrompt(o = {}) {
  const { assetType = 'mailer', market = 'US', brief = '', products = [], variant = 'V2', platform = 'meta', cohort = '', extra = '' } = o;
  const facts = regionFacts(market);
  let contract;
  if (assetType === 'ad') contract = adContract(String(platform).toLowerCase());
  else if (assetType === 'landing_page' || assetType === 'lp') contract = landingContract(facts);
  else contract = mailerContract(variant === 'V1' ? 'V1' : 'V2');

  return [
    `You are KNICKGASM's senior lifecycle creative director. Produce best-in-class, ready-to-ship output. Follow every rule exactly.`,
    ``,
    BRAND_BLOCK,
    ``,
    `MARKET: ${market} · Store: https://${facts.store} · Currency: ${facts.currency}${cohort ? ` · Audience cohort: ${cohort}` : ''}`,
    brief ? `\nCAMPAIGN BRIEF:\n${String(brief).trim()}` : '',
    ``,
    `PRODUCTS IN SCOPE:\n${productLines(products, facts.currency)}`,
    ``,
    contract,
    ``,
    `QUALITY BAR: premium, specific, sensory, zero filler. No banned phrases. No medical claims. If you must assume a detail, choose the most on-brand option and proceed — do not ask questions.`,
    extra ? `\nADDITIONAL CONSTRAINTS:\n${String(extra).trim()}` : '',
  ].filter((l) => l !== '').join('\n').trim();
}

module.exports = { buildMasterPrompt, BRAND_BLOCK, regionFacts, REGION };
