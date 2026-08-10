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

// ── Brand constants ─────────────────────────────────────────────────────────
// DERIVED, never hand-written. The single source of brand truth is
// data/brands/_default.json (tenant zero); brand-runtime.brandBlock() renders
// it into the prompt block below at require-time. A hardcoded copy here is what
// previously let the palette be right in the CSS and wrong in the prompt.
//
// Per-request, brand-aware callers should prefer brandRuntime.brandBlock(brand)
// with the resolved workspace; BRAND_BLOCK stays exported as tenant zero's
// block so existing callers keep working unchanged.
const brandRuntime = require('./brand-runtime.js');
const BRAND_BLOCK = brandRuntime.brandBlock(brandRuntime.defaultBrand());

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
function productLines(products = [], currency = '$', brandName = brandRuntime.defaultBrand().name) {
  const list = (Array.isArray(products) ? products : []).filter(Boolean).slice(0, 8);
  if (!list.length) return `(no specific products supplied — refer to ${brandName} offerings at CATEGORY level only. Do NOT invent a specific product name, price, or handle/URL.)`;
  return list.map((p) => {
    const title = p.title || p.name || p.t || `${brandName} product`;
    const price = p.price ?? p.p;
    const handle = p.handle || p.h;
    const cat = p.category || p.cat || p.c || '';
    return `- ${title}${price != null ? ` (${currency}${price})` : ''}${cat ? ` · ${cat}` : ''}${handle ? ` · handle: ${handle}` : ''}`;
  }).join('\n');
}

// ── Brand-derived creative facts ────────────────────────────────────────────
// Everything a contract needs that used to be hardcoded tenant-zero copy
// (audio beds, audience, proposition, palette hexes) now derives from the
// ACTIVE brand record, with an explicit DATA-REQUIRED marker where the brand
// has not supplied the fact — never another brand's value.
function creativeFacts(brand) {
  const zero = brandRuntime.defaultBrand();
  const b = (brand && brand.id) ? brand : zero;
  const isZero = !brand || !brand.id || String(b.slug || '') === String(zero.slug || '');
  const name = b.name || zero.name || 'the brand';
  const p = b.palette || {};
  const hexes = ['primary', 'accent', 'surface', 'ink'].map((k) => p[k]).filter(Boolean);
  const paletteList = hexes.length ? hexes.join(' / ') : '[DATA REQUIRED BEFORE LAUNCH: brand palette, all, all]';
  const t = b.typography || {};
  const fonts = `${(t.heading && t.heading.family) || '[DATA REQUIRED BEFORE LAUNCH: heading font]'} headings / ${(t.body && t.body.family) || '[DATA REQUIRED BEFORE LAUNCH: body font]'} body`;
  const claims = (Array.isArray(b.claims) && b.claims.length)
    ? b.claims.join(' · ')
    : '[DATA REQUIRED BEFORE LAUNCH: verifiable brand claims, all, all]';
  const industry = b.industry || 'its industry';
  // The named .wav beds are tenant zero's own repo assets. No other brand may
  // be scored to them; a brand without a bed on file gets a marker, not a loan.
  const audio = isZero
    ? `a ${name}-owned original bed from /assets/media/ (knickgasm-brand-beat.wav 32s hero · knickgasm-reels-loop.wav 16s short · knickgasm-ad-underscore.wav 22s under-voiceover) — 90 BPM, F minor, seamless loop, royalty-free for paid media. State the bed by filename and the beat-sync points`
    : `a ${name}-owned, original, royalty-free audio bed; if none is on file for this brand, write [DATA REQUIRED BEFORE LAUNCH: brand audio bed, all, all] instead of naming one`;
  return { name, isZero, paletteList, fonts, claims, industry, audio };
}

// ── Per-asset output contracts ──────────────────────────────────────────────
// The visual cascade for every visual asset, in the order the operator chose:
const VISUAL_CASCADE = `VISUALS — use this source order: (1) if a hosted media URL is provided, embed it (product image/GIF/MP4, e.g. a Shopify product video); (2) else describe an auto-generated animated GIF (2–4 still frames, gentle Ken-Burns or cross-fade) the team can produce from product photography; (3) AI-generated video only as a last resort. Every visual must be photoreal, on-palette, text-free in the image itself (text lives in the layout, not burned into the photo) unless the asset is an ad creative.`;

function mailerContract(variant, cf) {
  cf = cf || creativeFacts(null);
  if (variant === 'V1') {
    return `ASSET: Email mailer — VARIANT V1 (COMPLETE TEXTUAL CONTENT, no imagery).
Produce a fully text-driven email that stands on its own with zero images.
Deliver, in order:
1. 3 subject-line options (≤50 chars) + 1 preheader (≤90 chars).
2. Editorial hero headline + opening line that earns the scroll.
3. Body: 2–3 short story-driven paragraphs (origin, everyday use, why-now).
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
3. At least one motion slot (animated GIF or short product video) with an exact creative brief and where it sits. If it is a video, score it to ${cf.audio}. Never a licensed/trending sound.
4. Benefit strip, social proof, offer bar, CTA — each with copy + visual direction.
5. Responsive, email-client-safe structure (Outlook bgcolor on colored cells; max ~1200–1500px tall).
${VISUAL_CASCADE}`;
}

// The studio compositor (ad-campaigns.html) renders ONE still PNG per size with
// the text overlay baked in. Be honest about that: list the exact static sizes
// it produces and treat motion as an OPTIONAL hand-off brief, never a delivered
// asset. The text fields (headlines/captions/scripts) are still authored as copy.
function adContract(platform, cf) {
  cf = cf || creativeFacts(null);
  // Copy-field limits per platform (authored text). Produced creative SIZES are
  // sourced from asset-specs.js (single source of truth) so every placement size
  // stays canonical and complete across the whole app.
  const copyGuide = {
    google: 'Google (Responsive Search + Performance Max): 15 headlines (≤30 chars), 4 descriptions (≤90 chars), long headline (≤90), business name.',
    meta: 'Meta (Facebook/Instagram Feed + Reels + Stories): primary text (≤125 chars before truncation), headline (≤40), description.',
    instagram: 'Instagram (Feed + Reels + Stories): caption with hook in first line + hashtags.',
    tiktok: `TikTok (In-Feed + Spark): native-feeling video script with a 0–2s hook, on-screen text beats, caption, and 3 hashtag options. AUDIO: score it to ${cf.audio}. Give the exact beat-sync moments (which cut lands on which downbeat). NEVER specify a trending/licensed sound for a paid ad. Always burn in captions — most feed views start muted. The produced creative is a cover keyframe (the script is a brief for a separate shoot/edit).`,
  };
  const sizeKey = assetSpecs.ADS[platform] ? platform : 'meta';
  // onlyProduced: list ONLY the sizes the compositor actually renders, so the
  // prompt never claims deliverables the flow does not generate.
  const spec = (copyGuide[platform] || copyGuide.meta) + ' PRODUCED at each placement — ' + assetSpecs.adSpecText(sizeKey, { onlyProduced: true });
  return `ASSET: Paid ad creative for ${platform.toUpperCase()} — a FULL ad, not just copy.
The PRODUCED creative is a still, photoreal, on-palette image at each size below, with the on-creative text overlay BAKED INTO the image — exactly like a real ${platform} ad. The text is part of the rendered creative, NOT a separate caption: specify the exact overlay wording, font (${cf.fonts}), colour (use ONLY ${cf.paletteList}), size and pixel placement within the safe zones (on 9:16 keep all text clear of the bottom 20% platform-UI chrome), legible at a glance.

━━ STRATEGY — SELL THE OUTCOME, NOT THE TECHNIQUE ━━
TARGET: the audience defined by THIS brand's own record and the campaign brief. Never borrow another brand's persona; if neither names an audience, write [DATA REQUIRED BEFORE LAUNCH: audience, campaign, market] instead of inventing one.
SELL THE EMOTIONAL END-STATE, never the technique. Lead with what the buyer's life looks like after — belonging, status, relief, mastery — whatever THIS brand's proposition genuinely delivers. A spec or process detail may appear only as the *reason* the payoff is believable, never as the hook.
THE 1-SECOND SCROLL-STOP: the visual must stop this brand's own audience in under one second, built from the brand's real offering imagery. Do NOT lead with heavy text or process call-outs. Scaling depends on scroll-stop + engagement, not just the click.
CURATE, DON'T INVENT: structure the creative on proven, replicable formats native to ${cf.industry} (UGC, before/after, process time-lapse, day-in-the-life), not novel concepts.
OFFER: transition cleanly from the emotional hook into the brand's real proposition, built ONLY from its verifiable claims (${cf.claims}) — a premium, frictionless CTA, never a cheap pop-up. Use only offers supplied in the brief; never invent a discount, a percentage, or a delivery promise.

Platform spec: ${spec}
Deliver: (a) every text field the platform requires; (b) for EACH static size above, a precise creative brief describing the still visual, the BAKED-IN overlay wording (headline + offer) + exact pixel placement + safe zones; (c) the destination URL.
VISUALS (produced asset): one still, on-palette, photoreal image per size with the overlay baked in — this is exactly what the studio compositor renders. If a hosted product image/MP4 URL is supplied, its first frame is used as the base still. Motion (animated GIF / short video) is an OPTIONAL follow-up brief for the team — describe it only as a next step, NEVER as a delivered asset here. To produce the actual video ad from this brief, hand it to OpenMontage (open-source agentic video pipeline): https://github.com/Open-Montage/OpenMontage
AUDIO for any video deliverable: use ${cf.audio}. Never a trending or licensed track.`;
}

function landingContract(facts, cf) {
  cf = cf || creativeFacts(null);
  return `ASSET: Landing page in a direct-response presell style (reference: https://${facts.presell}/...).
Build a conversion-focused, single-scroll-friendly page using the brand palette/typography.
Sections, in order: sticky announcement bar · hero (headline + sub + primary CTA) · trust/credentials row · problem→solution narrative · offering reveal with price (${facts.currency}) · collection/offering grid · proof section built ONLY from the brand's verifiable claims (${cf.claims}) · testimonials as mini-stories (only supplied ones; none supplied = omit the section) · FAQ (accordion) · risk-reversal/guarantee (only if the brand states one) · sticky footer CTA.
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
  const { assetType = 'mailer', market = 'US', brief = '', products = [], variant = 'V2', platform = 'meta', cohort = '', extra = '', brand = null } = o;

  // Multi-tenant: when the caller resolved an active brand workspace, the whole
  // prompt is built from THAT brand instead of tenant zero. `brand` comes from
  // _shared/brand-runtime.js `resolve(req)`. With no brand supplied this is
  // byte-identical to what it produced before, so every existing caller is
  // unaffected.
  let BLOCK = BRAND_BLOCK;
  let brandName = brandRuntime.defaultBrand().name;
  let facts = regionFacts(market);
  const cf = creativeFacts(brand);
  if (brand && brand.id) {
    try {
      BLOCK = brandRuntime.brandBlock(brand);
      brandName = brand.name || brandName;
      // A brand with no store for this market gets an explicit marker, never
      // tenant zero's store URL.
      facts = brandRuntime.regionFacts(brand, market) || {
        store: `[DATA REQUIRED BEFORE LAUNCH: region store URL, all, ${market}]`,
        presell: `[DATA REQUIRED BEFORE LAUNCH: region store URL, all, ${market}]`,
        currency: '', locale: 'en',
      };
    } catch (_) { /* fall back to tenant zero rather than failing a generation */ }
  }

  let contract;
  if (assetType === 'ad') contract = adContract(String(platform).toLowerCase(), cf);
  else if (assetType === 'landing_page' || assetType === 'lp') contract = landingContract(facts, cf);
  else contract = mailerContract(variant === 'V1' ? 'V1' : 'V2', cf);

  return [
    `You are ${brandName}'s senior lifecycle creative director. Produce best-in-class, ready-to-ship output. Follow every rule exactly.`,
    ``,
    BLOCK,
    ``,
    `MARKET: ${market} · Store: https://${facts.store} · Currency: ${facts.currency}${cohort ? ` · Audience cohort: ${cohort}` : ''}`,
    brief ? `\nCAMPAIGN BRIEF:\n${String(brief).trim()}` : '',
    ``,
    `PRODUCTS IN SCOPE:\n${productLines(products, facts.currency, brandName)}`,
    ``,
    contract,
    ``,
    `QUALITY BAR: premium, specific, sensory, zero filler. No banned phrases. No medical claims. If you must assume a detail, choose the most on-brand option and proceed — do not ask questions.`,
    extra ? `\nADDITIONAL CONSTRAINTS:\n${String(extra).trim()}` : '',
  ].filter((l) => l !== '').join('\n').trim();
}

// `brandBlockFor(brand)` lets any prompt site swap tenant zero's block for the
// caller's active brand without importing brand-runtime directly.
function brandBlockFor(brand) {
  if (!brand || !brand.id) return BRAND_BLOCK;
  try { return require('./brand-runtime.js').brandBlock(brand); }
  catch (_) { return BRAND_BLOCK; }
}

module.exports = { buildMasterPrompt, BRAND_BLOCK, brandBlockFor, regionFacts, REGION };
