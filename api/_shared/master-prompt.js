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

/*
 * These describe what the FINISHED email contains, not what to write about it.
 *
 * V2 previously opened item 2 with "Section-by-section layout: for each section
 * give the COPY and the VISUAL". That is an instruction to produce a PLAN, and
 * it sat in the same prompt as a deliverable line saying "not a
 * section-by-section outline". Given a contradiction, a model resolves it, and
 * a breakdown is easier to produce than a finished email — so the outline is
 * what came back. Both halves now ask for the same artefact.
 */
function mailerContract(variant, cf) {
  cf = cf || creativeFacts(null);
  if (variant === 'V1') {
    return `ASSET: Email mailer — VARIANT V1 (TYPOGRAPHIC, no imagery).
A finished email that stands on its own with zero images: type, rules, colour and space do all the work. Not a copy deck, and not a description of an email — the email.
It must CONTAIN, in this order:
1. Subject lines and preheader (give 3 subject options ≤50 chars and 1 preheader ≤90 chars above the HTML).
2. An editorial hero headline and an opening line that earns the scroll.
3. Body: 2–3 short story-driven paragraphs (origin, everyday use, why-now).
4. A benefit triplet, 3 crisp lines.
5. One short personal testimonial — only if one was supplied. None supplied, omit the block rather than writing one.
6. CTA copy linking to the destination store URL.
Compact, around two scrolls. Because there are no images, every structural cue has to be typographic: weight, size, rules and generous space.`;
  }
  return `ASSET: Email mailer — VARIANT V2 (TYPOGRAPHIC + VISUAL).
The same persuasion as V1, laid out with imagery. A finished email, not a layout plan and not a set of section notes.
It must CONTAIN, in this order:
1. Subject lines and preheader (3 options and 1 preheader, above the HTML).
2. A hero: headline, opening line, and a hero image as an <img> pointing at a hosted URL I supplied. Where I supplied no image for a slot, leave the slot out and put the shot description in an HTML comment beside it — never a placeholder service, never an invented URL.
3. Body sections carrying the argument, each with its own copy and, where an image was supplied, its own visual.
4. A motion slot — an animated GIF or a short product video — placed where it earns attention, with its brief in an HTML comment. If it is a video, score it to ${cf.audio}. Never a licensed or trending sound.
5. A benefit strip, social proof (only from supplied proof), an offer bar (only if an offer was supplied), and one CTA.
Email-client-safe throughout: bgcolor on every coloured cell for Outlook, and around two to three scrolls in total.
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
    deliverable(assetType, platform, variant),
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
    ``,
    outputFormat(assetType, platform),
  ].filter((l) => l !== '').join('\n').trim();
}

/**
 * WHAT THE OPERATOR IS OWED, STATED FIRST.
 *
 * These prompts are built to be pasted into ChatGPT, Gemini or Claude and come
 * back with the FINISHED THING. That was not what happened: a mailer prompt
 * pasted into Gemini returned a product photograph, because the copy the
 * operator grabbed was an element brief and nothing in the prompt said which
 * kind it was.
 *
 * So an asset prompt now opens by naming its deliverable in one line, before
 * any brand block or product list, and closes by pinning the output format. A
 * model that reads only the first and last paragraph still produces the right
 * artefact.
 *
 * The distinction this enforces:
 *   ASSET prompt    returns the complete, usable artefact (the whole mailer,
 *                   the whole landing page, the whole ad unit).
 *   ELEMENT prompt  returns one part of it (a hero photograph, a headline).
 *                   Those live on `creative_brief` and are labelled as such.
 */
function deliverable(assetType, platform, variant) {
  const t = String(assetType || 'mailer').toLowerCase();
  if (t === 'ad') {
    return `DELIVERABLE: ONE COMPLETE ${String(platform).toUpperCase()} AD UNIT, ready to upload. Not a concept, not a moodboard, not only an image brief. Every field the platform requires, plus the creative, plus the reasoning.`;
  }
  if (t === 'landing_page' || t === 'lp') {
    return 'DELIVERABLE: ONE COMPLETE, SELF-CONTAINED LANDING PAGE as a single HTML document I can save and open. Not a wireframe, not a section list, not a description of a page.';
  }
  return `DELIVERABLE: ONE COMPLETE EMAIL MAILER (${variant === 'V1' ? 'text-only' : 'text and visual'}), ready to paste into an ESP. Not a plan, not a section-by-section outline, not only a hero image. The finished email.`;
}

/**
 * The last thing the model reads, and the most literal.
 *
 * "Produce a mailer" is ambiguous to a model that can also produce a picture of
 * one. Naming the artefact, the container and what must NOT come back removes
 * the ambiguity.
 */
function outputFormat(assetType, platform) {
  const t = String(assetType || 'mailer').toLowerCase();
  const common = 'Return the artefact itself and nothing else: no preamble, no explanation of what you did, no markdown fence around the whole answer, no follow-up questions.';

  if (t === 'ad') {
    return [
      'OUTPUT FORMAT — return ALL of these, in this order, with these exact headings:',
      '1. COPY — every field this platform requires, each on its own line, each within its character limit.',
      '2. CREATIVE — a complete, self-contained HTML block that renders the ad unit at the correct aspect ratio, using ONLY hosted image URLs I have supplied (never base64, never a placeholder service).',
      '3. IMAGE BRIEF — the shot description, only if a photograph still needs to be produced.',
      '4. WHY — two lines on the angle and who it is for.',
      common,
    ].join('\n');
  }

  if (t === 'landing_page' || t === 'lp') {
    return [
      'OUTPUT FORMAT: ONE HTML document, complete and self-contained.',
      'It must start with <!doctype html> and end with </html>. All CSS inline in a <style> block. No external stylesheet, no framework, no build step.',
      'Every image is an <img> pointing at a hosted URL I supplied. Never base64. Never a placeholder image service. If I supplied no image for a slot, leave the slot out rather than inventing a source.',
      'The page must render correctly with JavaScript disabled.',
      common,
    ].join('\n');
  }

  return [
    'OUTPUT FORMAT: ONE email HTML document, complete and paste-ready.',
    'Table-based layout (Outlook renders with the Word engine), max 600px content column, all CSS inline on the elements. No <style> in the head that the layout depends on, no flexbox or grid, no JavaScript.',
    'Every image is an <img> with a hosted URL I supplied plus real alt text. Never base64: Gmail clips a message past roughly 102KB and the mailer would be cut mid-layout.',
    'The email must read completely with images disabled.',
    'Before the HTML, give: 3 subject lines, 1 preheader, and the plain-text version.',
    common,
  ].join('\n');
}

/* ═══ Element prompts ═════════════════════════════════════════════════════
 *
 * The other half of the same fix. An image brief is a perfectly good prompt —
 * it just does not produce a mailer, and the operator who pastes it has no way
 * to know that from the text. So an element prompt now says, in its first line,
 * that it produces ONE PART, names the part, names the asset the part belongs
 * to, and points at the prompt that produces the whole thing.
 *
 * Deliberately NOT wrapped in the brand block: this is a shot description going
 * to an image model, and burying it under six paragraphs of typography rules is
 * how a hero photograph comes back with text baked into it.
 */
const PROMPT_KIND = { ASSET: 'asset', ELEMENT: 'element' };

const ELEMENT_LABEL = {
  image: 'ONE STILL PHOTOGRAPH',
  hero: 'ONE HERO PHOTOGRAPH',
  video: 'ONE VIDEO CLIP',
  copy: 'ONE BLOCK OF COPY',
};

/**
 * Wrap a raw element brief so it announces what it produces.
 * @param {string} brief   the shot/copy description as authored
 * @param {object} o
 * @param {'image'|'hero'|'video'|'copy'} [o.produces]
 * @param {string} [o.partOf]  human name of the asset this element sits inside
 * @returns {string}
 */
function buildElementPrompt(brief, o = {}) {
  const text = String(brief || '').trim();
  if (!text) return '';
  const produces = ELEMENT_LABEL[String(o.produces || 'image').toLowerCase()] || ELEMENT_LABEL.image;
  const partOf = String(o.partOf || 'the finished asset').trim();
  const head = `DELIVERABLE: ${produces} — ONE ELEMENT of ${partOf}, not the asset itself. Do not return an email, an ad unit or a page. Return only this element.`;
  const foot = (produces === ELEMENT_LABEL.copy)
    ? 'Return the copy only. No commentary.'
    : 'Return the image only. No text baked into the image, no watermark, no logo, no border, no collage of options. One frame.';
  return [head, '', text, '', foot].join('\n');
}

/**
 * The one call a UI needs: everything copyable for an asset, each labelled with
 * what it returns. A surface that renders this list cannot show an element
 * prompt without also showing the asset prompt beside it.
 *
 * An ASSET row does not carry its own text — it carries `from`, the field on
 * the asset that already holds it. Copying a ~5KB prompt into a second place on
 * the same object is how the two drift, and it doubles a payload that is
 * already ~180 slots wide in the prebuild queue. An ELEMENT row DOES carry
 * text, because the wrapped form exists nowhere else.
 *
 * @param {object} asset   a built asset (email / ad / landing page)
 * @param {'mailer'|'ad'|'landing_page'} assetType
 * @param {object} [opt]
 * @param {boolean} [opt.inline]  also resolve `text` on asset rows
 * @returns {Array<{id,label,kind,produces,from?,text?}>}
 */
function promptsFor(asset, assetType, opt = {}) {
  const a = asset || {};
  const t = String(assetType || 'mailer').toLowerCase();
  const out = [];
  const assetName = t === 'ad'
    ? `a complete ${String(a.platform || '').toUpperCase() || 'paid'} ad unit`
    : (t === 'landing_page' || t === 'lp') ? 'a complete landing page' : 'a complete email mailer';

  const asAsset = (id, from, label, produces) => {
    const text = String(a[from] || '').trim();
    if (!text) return;
    const row = { id, label, kind: PROMPT_KIND.ASSET, produces, from };
    if (opt.inline) row.text = text;
    out.push(row);
  };
  const asElement = (id, label, produces, text) => {
    const s = String(text || '').trim();
    if (s) out.push({ id, label, kind: PROMPT_KIND.ELEMENT, produces, text: s });
  };

  // The complete artefact ALWAYS comes first. Ordering is not cosmetic here:
  // the operator copies the first thing that looks like the job.
  if (t === 'mailer') {
    asAsset('master_prompt_v2', a.master_prompt_v2 ? 'master_prompt_v2' : 'master_prompt',
      'Complete mailer, text and visual', 'the whole email');
    asAsset('master_prompt_v1', 'master_prompt_v1', 'Complete mailer, text only', 'the whole email');
  } else {
    asAsset('master_prompt', 'master_prompt',
      `Complete ${t === 'ad' ? 'ad unit' : 'landing page'}`, `the whole ${t === 'ad' ? 'ad' : 'page'}`);
  }

  // Then the parts, each stating that it is a part.
  asElement('creative_brief', 'Hero image only', 'one photograph',
    buildElementPrompt(a.creative_brief || (a.creative && a.creative.brief), { produces: 'hero', partOf: assetName }));
  asElement('script', 'Video clip only', 'one clip',
    buildElementPrompt(a.script, { produces: 'video', partOf: assetName }));

  return out;
}

// `brandBlockFor(brand)` lets any prompt site swap tenant zero's block for the
// caller's active brand without importing brand-runtime directly.
function brandBlockFor(brand) {
  if (!brand || !brand.id) return BRAND_BLOCK;
  try { return require('./brand-runtime.js').brandBlock(brand); }
  catch (_) { return BRAND_BLOCK; }
}

module.exports = {
  buildMasterPrompt, BRAND_BLOCK, brandBlockFor, regionFacts, REGION,
  buildElementPrompt, promptsFor, deliverable, outputFormat, PROMPT_KIND,
};
