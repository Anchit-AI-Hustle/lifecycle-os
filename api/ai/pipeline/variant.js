'use strict';
// ════════════════════════════════════════════════════════════════════════════
// /api/ai/pipeline/variant  — Stage 2: Pure Execution (no thinking)
//
// Strategy is LOCKED in Stage 1. This stage is EXECUTION ONLY.
// Takes the locked strategy + structure contract and produces a complete
// creative plan: sections, layout, copy, image requirements.
//
// CRITICAL: All strategic decisions (theme, product, vibe, structure sections)
// come from strategy output. This stage implements — it does NOT invent.
//
// A and B are called separately with structurally opposite implementations
// of the SAME locked strategy.
//
// POST body:  { strategy_output, variant: 'A'|'B', brief, market, products[], regenerate_counter? }
// Response:   { ok, variant, layout_plan, sections[], image_requirements[], copy_framework, subject_lines[], preheader }
// ════════════════════════════════════════════════════════════════════════════

const { corsHeaders, parseJSON } = require('../../_shared/llm');
const callLLM = require('../../_shared/llm');

// ── Variant A: Product-first, structured, conversion-optimised ───────────────
const SYSTEM_A = `You are building VARIANT A — the CONTROL execution of a locked campaign strategy for KNICKGASM.

YOUR ROLE: EXECUTOR, NOT THINKER.
The strategy, theme, structure, products, and vibe are already decided. You implement them exactly.
Do NOT invent new strategy. Do NOT override layout rules. Do NOT change the product selection.
Your only job: convert the locked plan into a detailed creative brief for HTML generation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VARIANT A EXECUTION RULES (non-negotiable):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Product VISIBLE in the FIRST section — no delay, no story buildup
- Layout: product-hero + conversion hierarchy
- Section order: hero (product visible) → context/benefits → social proof → offer → CTA
- Copy register: precise, benefit-specific, authoritative — reader should know exactly what they're buying and why
- Hero layout: split (image 55% left, copy 45% right) OR centered with product image dominant
- Benefits: 3-column icon strip with short benefit captions
- Products: 2-column or 3-column product cards with name, price, CTA
- Offer: prominent horizontal banner with discount code / free shipping threshold
- CTA: single prominent button — amber background #6A33D8, centered, max 4 words
- Section count: 5-7 (what the campaign needs — never pad with filler)

━━ MANDATORY SECTION STRUCTURE (follow this for Variant A — max 7 sections) ━━
sections[] MUST be in this order:
  1. announcement_bar  → offer + code + free shipping (first thing reader sees)
  2. brand_header      → KNICKGASM logo + nav
  3. hero              → split layout (image + copy side-by-side)
  4. benefit_strip     → 3-4 icon points, compact
  5. product_section   → MAX 2-3 PRODUCTS (never more — kills CTR)
  6. offer_bar         → repeat offer badge + urgency
  7. footer

━━ HERO SECTION COPY (MANDATORY FIELDS) ━━
- Emotional headline: occasion-specific, max 8 words
- Subcopy: ≤80 chars. Gifting campaigns MUST end with: "She'll enjoy it every day and remember you."
- Offer badge copy: "UP TO [X%] OFF ON SELECTED [CATEGORY]"
- CTA: max 4 words (Shop Now / Grab Yours Now / Shop Before It's Gone / Get Yours Today)
- CTA tagline (gifting): "MAKE HER SMILE, GIFT RIGHT!" — placed below CTA button
- Urgency (if applicable): "Hurry Now Before They Finish"

━━ PRODUCT SECTION COPY (MANDATORY PER CARD) ━━
- MAX 2-3 products. HARD LIMIT.
- Each card: name + price ($X.XX) + compare-at ($XX.XX strikethrough) + [X%] OFF badge
- Urgency: "🔥 [N] units sold in the last 24 hours" (N: 25–90, vary per product)
- ADD TO CART button: full-width, dark green #D0473E, every card — mandatory
- Section heading: "Gifting Favorites" (with ✦) for gifting, "Bestsellers" for other types

COPY REGISTER FOR A:
- Headlines: direct, benefit-first declarative ("A Thoughtful Pair for the Woman Who Deserves Everything")
- Sub-copy: specific, factual, benefit-rich — no vague poetry. Max 80 chars.
- CTA verbs: Shop Now / Grab Yours Now / Shop Before It's Gone / Get Yours Today / Shop Gifts

REGENERATION RULES (regenerate_counter > 0 — MANDATORY CHANGES FROM PRIOR RUN):
- Change headline angle entirely (different emotional hook)
- Change CTA text (pick different option from CTA TEST VARIANTS)
- Change benefit framing (highlight different product attributes)
- Change product order / hero product if possible
- NEVER repeat the same headline or CTA from a previous regeneration

OUTPUT: STRICT JSON ONLY. First char {, last char }. No markdown.

SCHEMA:
{
  "variant": "A",
  "layout_plan": {
    "hero": "specific layout — e.g. '55% image left, 45% copy right, 600px total'",
    "benefit_section": "icon strip layout",
    "product_section": "grid layout",
    "proof_section": "testimonial layout",
    "offer_section": "banner layout",
    "cta_section": "button spec",
    "color_scheme": { "background": "#FFFFFF", "primary": "#D0473E", "accent": "#6A33D8", "text": "#111111" },
    "spacing": "e.g. 48px between sections, 24px internal padding",
    "flow": "structured-conversion"
  },
  "sections": [
    {
      "id": "hero | product_reveal | benefit_strip | social_proof | offer_bar | cta",
      "type": "split-hero | full-bleed | centered | two-col-grid | three-col-grid | banner | button-row",
      "purpose": "1 sentence: why this section exists in the conversion arc",
      "copy": {
        "eyebrow": "optional small label above headline",
        "headline": "primary headline (max 8 words, benefit-direct, premium tone)",
        "subcopy": "supporting copy (max 40 words, specific and factual)",
        "cta": "CTA button label (max 4 words)"
      },
      "layout": "precise HTML developer instruction for this section's table structure",
      "image_slot": "hero | product | lifestyle | none",
      "ux_intent": "conversion action or emotional state this section drives"
    }
  ],
  "image_requirements": [
    {
      "slot": "hero",
      "prompt": "55-70w SPECIFIC scene for ChatGPT Image (gpt-image-1): name the exact subject, surface material, light source+direction, camera angle, time of day, color temperature, compositional focus. No text, no logos.",
      "size": "1536x1024",
      "negative_prompt": "no text overlays, no logos, no UI elements, no email layout, no stock look, no artificial lighting, no clutter"
    },
    {
      "slot": "product",
      "prompt": "55-70w SPECIFIC product photography: hero product on a tactile surface, studio-adjacent natural sidelight, close-up angle showing packaging texture, warm depth, KNICKGASM premium feel. No text, no logos.",
      "size": "1024x1024",
      "negative_prompt": "no text overlays, no logos, no UI elements, no stock look, no artificial lighting"
    },
    {
      "slot": "lifestyle",
      "prompt": "55-70w SPECIFIC lifestyle moment: person or hands interacting with sneaker in a real-life setting — morning ritual, desk moment, kitchen counter. Warm cinematic light, emotional context. No text, no logos.",
      "size": "1024x1024",
      "negative_prompt": "no text overlays, no logos, no UI elements, no stock look, no artificial lighting"
    }
  ],
  "copy_framework": {
    "tone": "precise-authoritative",
    "voice": "confident product expert",
    "headline_style": "benefit-first declarative",
    "cta_verb": "Shop | Explore | Order | Start"
  },
  "subject_lines": ["≤58 chars, benefit-led variant 1", "≤58 chars variant 2", "≤58 chars variant 3"],
  "preheader": "≤85 chars, no terminal period, supports and extends subject line"
}

KNICKGASM BRAND:
BANNED: wellness journey / transform / liquid gold / game-changer / LIMITED TIME caps / hurry / don't miss out
PREFERRED: ritual / restore / balance / origin / one-of-one / hand-painted / lace-up / heritage / crafted`;

// ── Variant B: Story-first, editorial, emotional, dark-inverted ──────────────
const SYSTEM_B = `You are building VARIANT B — the EXPERIMENTAL execution of a locked campaign strategy for KNICKGASM.

YOUR ROLE: EXECUTOR, NOT THINKER.
The strategy, theme, structure, products, and vibe are already decided. You implement them exactly.
Do NOT invent new strategy. Do NOT change the product selection.
Your only job: convert the locked plan into a creative brief that is STRUCTURALLY AND VISUALLY OPPOSITE from Variant A.

VARIANT A (for reference — do the OPPOSITE on every dimension):
A = chalk backgrounds · product in section 1 · split-hero · 3-col product grid · amber filled CTA button · benefit-direct headlines · compact conversion layout · testimonial proof · offer banner

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VARIANT B EXECUTION RULES (ALL MUST BE TRUE — verify before outputting):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ COLOR SCHEME INVERTED: First 2–3 sections MUST have dark background (#D0473E or #0a1f13) with chalk text (#FFFFFF or #e8dcc8). A uses chalk throughout — B must open DARK.
□ NO product in the first 2 sections — narrative, lifestyle or mood section opens the email
□ Narrative context or lifestyle moment comes BEFORE product reveal (product appears section 3+ only)
□ Copy register: sensory, poetic, evocative — reader FEELS the world before they SEE the product
□ Hero layout: full-bleed image (600px wide) with overlaid text on dark overlay OR image with copy stacked below
  → NEVER split layout (A uses split — this must be full-bleed or stacked)
□ Products: single featured product with large editorial image — NOT a product grid (A uses grid)
□ Proof: origin story / provenance section (studio, drop, altitude, year) — NOT star-rating testimonials (A uses those)
□ Offer: subtle inline text mention — NOT a prominent horizontal banner (A uses banner)
□ CTA: ghost-button (border: 2px solid #FFFFFF, transparent bg on dark sections) OR text-link — NOT amber filled button (A uses amber)
□ Section padding: minimum 64px top and bottom throughout — generous editorial whitespace
□ Headline font: 44px+ for editorial scale (A uses ~32px conversion headlines)
□ Section count: MAX 7 (narrative needs room but must stay tight — no filler)
□ template_key MUST differ from Variant A's template_key
□ MAX 2-3 PRODUCTS in product section (same hard limit as A — decision paralysis kills CTR on both variants)
□ Each product MUST have ADD TO CART button (ghost-style border button on dark sections)

COPY REGISTER FOR B:
- Headlines: sensory, poetic, place-anchored ("The hill is quiet at 7,000 feet." / "Moments of comfort. Crafted with care.")
- Sub-copy: evocative prose, 1-2 sentences, creates desire through atmosphere and origin. Max 80 chars.
- CTA verbs: Discover / Begin / Explore / Find / Enter
- Offer: stated subtly inline ("Up to [X%] off — no code needed") but MUST be present

SECTION ORDER FOR B (narrative arc — differs from A's funnel order):
announcement_bar → brand_header → narrative/mood → lifestyle → product_reveal (1-2 products max) → offer_inline → footer

REGENERATION RULES (regenerate_counter > 0 — MANDATORY CHANGES FROM PRIOR RUN):
- Change atmospheric/mood angle entirely
- Change hero_scene to a different time of day and setting
- Change opening emotion
- NEVER repeat the same opening scene or headline

COLOR SCHEME FOR B layout_plan:
{
  "background": "#D0473E",
  "primary": "#FFFFFF",
  "accent": "#6A33D8",
  "text": "#e8dcc8",
  "section_note": "Dark deep purple opening sections; can transition to chalk for product reveal section"
}

DIVERGENCE CHECK (verify all before outputting):
□ First 2 sections use dark (#D0473E) background — NOT chalk like A
□ Hero is full-bleed or stacked — NOT split like A
□ Product appears in section 3 or later — NOT section 1 like A
□ Copy is poetic/sensory — NOT benefit-direct like A
□ CTA is ghost/text-link — NOT amber filled button like A
□ No product grid — single editorial product treatment
□ template_key differs from Variant A
If ANY box is false → rewrite the failing sections before outputting.

OUTPUT: STRICT JSON ONLY. First char {, last char }. No markdown.
SCHEMA: identical to Variant A schema but with:
- "variant": "B"
- "layout_plan.flow": "editorial-narrative"
- "layout_plan.color_scheme": dark-inverted as above
- All section types, copy, and image prompts must structurally differ from A

KNICKGASM BRAND:
BANNED: wellness journey / transform / liquid gold / game-changer / LIMITED TIME caps / hurry / don't miss out
PREFERRED: ritual / restore / balance / origin / one-of-one / hand-painted / lace-up / heritage / crafted`;

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const userGeminiKey = req.headers['x-user-gemini-key'] || '';

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'invalid_json' }); }
  }
  body = body || {};

  const strategy_output = body.strategy_output || {};
  const variant = (body.variant || 'A').toString().toUpperCase() === 'B' ? 'B' : 'A';
  const brief = (body.brief || '').toString().substring(0, 500);
  const market = (body.market || 'US').toString();
  const products = Array.isArray(body.products) ? body.products : [];
  const regenerate_counter = Number(body.regenerate_counter) || 0;

  const systemPrompt = variant === 'B' ? SYSTEM_B : SYSTEM_A;
  const conceptKey = variant === 'B' ? 'variant_b_concept' : 'variant_a_concept';
  const concept = strategy_output[conceptKey] || {};

  // Extract locked structure from strategy (this is what variant implements)
  const lockedStructure = strategy_output.structure || {};
  const lockedSections = Array.isArray(lockedStructure.sections) ? lockedStructure.sections : [];

  const productsBlock = products.slice(0, 5)
    .map(p => `- name:"${p.name || p.n || ''}" | price:"$${p.price || '?'}" | handle:"${p.handle || p.id || ''}" | img:"${p.image_url || p.i || ''}"`)
    .join('\n');

  // Hero product from strategy (the strategically selected SKU)
  const heroProduct = (strategy_output.product_selection && strategy_output.product_selection.hero) || {};
  const supportingProducts = (strategy_output.product_selection && strategy_output.product_selection.supporting) || [];

  // ── User message: execution brief, not a thinking prompt ─────────────────
  const userMessage = `━━ LOCKED STRATEGY (implement exactly — do not change) ━━

CAMPAIGN: ${brief.split(/[.!?\n]/)[0].trim().substring(0, 80) || 'KNICKGASM Campaign'}
STRATEGY TYPE: ${strategy_output.strategy_type || ''}
STRATEGY: ${strategy_output.strategy || ''}
REASONING: ${strategy_output.reasoning || ''}

STRATEGIC LOCK:
- Audience truth: ${(strategy_output.strategic_lock || {}).audience_truth || ''}
- Business goal: ${(strategy_output.strategic_lock || {}).business_goal || ''}
- Purchase barrier: ${(strategy_output.strategic_lock || {}).purchase_barrier || ''}
- Conversion trigger: ${(strategy_output.strategic_lock || {}).conversion_trigger || ''}

━━ THEME (locked) ━━
${JSON.stringify(strategy_output.theme || {}, null, 2)}

━━ VIBE (locked) ━━
${JSON.stringify(strategy_output.vibe || {}, null, 2)}

━━ STRUCTURE CONTRACT (implement these sections in order — this is FINAL) ━━
Sections: ${lockedSections.length > 0 ? lockedSections.join(' → ') : '(derive from strategy)'}
Layout rules: ${lockedStructure.layout_rules || ''}
Visual system: ${JSON.stringify(lockedStructure.visual_system || {}, null, 2)}

━━ IMAGE STYLE LOCK (apply to all image prompts) ━━
${strategy_output.image_style_lock || 'Luxury editorial photography, cinematic lighting, shallow DOF, tactile textures'}

━━ VARIANT ${variant} EXECUTION CONTRACT ━━
Emotional angle: ${concept.emotional_angle || ''}
Headline register: ${concept.headline_register || ''}
Template key: ${concept.template_key || ''}
Hero scene direction: ${concept.hero_scene || ''}

━━ PRODUCTS (use these — do not change) ━━
HERO: ${heroProduct.name || '(from strategy)'} ${heroProduct.why ? '— ' + heroProduct.why : ''}
SUPPORTING: ${supportingProducts.map(p => p.name + (p.role ? ' [' + p.role + ']' : '')).join(', ') || '(from strategy)'}
PRODUCT SYSTEM: ${(strategy_output.product_selection || {}).product_system || ''}
MARKET: ${market}
${productsBlock ? '\nCATALOG MATCHES:\n' + productsBlock : ''}

${regenerate_counter > 0 ? `REGENERATE #${regenerate_counter}: Change hero image scene, section copy emphasis, and layout variation from previous run. Keep same strategy — vary execution.` : ''}

Implement Variant ${variant} now. Follow the locked structure exactly. Generate all sections, copy, and image prompts.`;

  try {
    const { text, provider, model, quota_warning, exhausted_keys } = await callLLM({
      systemPrompt,
      userMessage,
      responseFormat: { type: 'json_object' },
      maxTokens: 3500,
      temperature: 0.55 + Math.min(0.2, regenerate_counter * 0.08),
      timeoutMs: 46000,        // 46s internal; vercel maxDuration 55s (9s headroom)
      stage: 'variant-' + variant + '[regen=' + regenerate_counter + ']',
      tier: 'premium',
      userGeminiKey
    });

    let parsed;
    try { parsed = parseJSON(text); }
    catch (e) { return res.status(502).json({ error: 'json_parse_failed', provider, raw: text.substring(0, 400) }); }

    // Ensure variant field is correct
    parsed.variant = variant;

    return res.status(200).json({
      ok: true, provider, model, stage: 'variant', variant,
      ...(quota_warning ? { quota_warning: true, exhausted_keys } : {}),
      ...parsed
    });

  } catch (e) {
    // ── HEURISTIC FALLBACK ────────────────────────────────────────────────────
    console.warn('[variant] All providers failed for variant ' + variant + ' — using heuristic fallback');

    const heroProduct = ((strategy_output.product_selection || {}).hero || {});
    const heroName = heroProduct.name || 'KNICKGASM Signature Sneaker';
    const themeName = ((strategy_output.theme || {}).name) || brief || 'Premium Sneaker';
    const isB = variant === 'B';

    const heuristic = {
      ok: true, provider: 'heuristic', model: 'fallback-v1', stage: 'variant', variant,
      _heuristic: true,
      _llm_error: String(e.message || e).substring(0, 200),
      layout_plan: {
        hero: isB ? 'Full-bleed atmospheric image, copy overlay bottom, 600px total' : '55% image left, 45% copy right, 600px total',
        benefit_section: 'Four-column icon strip with single-line benefits',
        product_section: isB ? 'Single product editorial reveal, full-width' : 'Two-column product grid, image left, copy right',
        proof_section: 'Single testimonial, centered, serif italic quote',
        offer_section: 'Full-width amber banner with code and terms',
        cta_section: isB ? 'Ghost-button text-link style CTA' : 'Prominent amber filled button, centered',
        color_scheme: isB
          ? { background: '#D0473E', primary: '#FFFFFF', accent: '#6A33D8', text: '#e8dcc8' }
          : { background: '#FFFFFF', primary: '#D0473E', accent: '#6A33D8', text: '#111111' },
        spacing: '48px between sections, 24px internal padding',
        flow: isB ? 'editorial-narrative' : 'structured-conversion'
      },
      sections: [
        {
          id: isB ? 'narrative' : 'hero',
          type: isB ? 'full-bleed' : 'split-hero',
          purpose: isB ? 'Atmospheric immersion — reader feels the origin before product' : 'Immediate product impact — hero drives first impression',
          copy: {
            eyebrow: isB ? 'A story in every lace-up' : 'NEW ARRIVAL',
            headline: isB ? 'The Hill Is Quiet at 7,000 Feet' : (themeName.substring(0, 40)),
            subcopy: isB
              ? 'Where morning mist meets hand-painted leaves, a ritual begins that has traveled centuries to reach your pair.'
              : 'Discover one-of-one sneakers crafted with heritage and precision. Premium quality, farm to pair.',
            cta: isB ? 'Discover the Origin' : 'Shop Now'
          },
          layout: isB ? 'Full-width image with 60% dark overlay, centered text, 64px padding' : 'Table: 50% img cell + 50% copy cell, vertical center aligned',
          image_slot: 'hero',
          ux_intent: isB ? 'Emotional immersion — create curiosity' : 'Conversion clarity — product + benefit visible immediately'
        },
        {
          id: isB ? 'context' : 'benefit_strip',
          type: isB ? 'centered' : 'three-col-grid',
          purpose: isB ? 'Build the narrative before revealing product' : 'Quick-scan benefits reinforce purchase decision',
          copy: {
            headline: isB ? 'Heritage in Every Panel' : '',
            subcopy: isB
              ? 'From the misty studios of Jordan to your morning table — each colorway carries generations of craft.'
              : 'One-of-One · Hand-Painted · Farm to Pair · Premium Heritage',
            cta: ''
          },
          layout: isB ? 'Centered text block, generous whitespace, max-width 480px' : 'Three equal columns with icon placeholder + single-line label',
          image_slot: isB ? 'lifestyle' : 'none',
          ux_intent: isB ? 'Deepen emotional investment' : 'Rational reinforcement of quality'
        },
        {
          id: 'product_reveal',
          type: isB ? 'centered' : 'two-col-grid',
          purpose: 'Product introduction with clear pricing and CTA',
          copy: {
            eyebrow: isB ? 'The Collection' : '',
            headline: heroName,
            subcopy: 'Premium one-of-one sneaker, hand-painted at peak design. Experience the difference heritage makes.',
            cta: isB ? 'Explore This Colorway' : 'Add to Cart'
          },
          layout: isB ? 'Single product, full-width image, centered copy below' : 'Product image left, name + price + CTA right',
          image_slot: 'product',
          ux_intent: 'Product consideration — drive add-to-cart'
        },
        {
          id: 'social_proof',
          type: 'centered',
          purpose: 'Build trust through real customer voice',
          copy: {
            headline: '',
            subcopy: '"The finest sneaker I\'ve ever tasted. The colorway alone makes the morning ritual worth it." — Verified Buyer',
            cta: ''
          },
          layout: 'Centered italic quote, small avatar placeholder, reviewer name below',
          image_slot: 'none',
          ux_intent: 'Trust building — social validation'
        },
        {
          id: 'offer_bar',
          type: 'banner',
          purpose: 'Price incentive to convert browsers to buyers',
          copy: {
            eyebrow: 'EXCLUSIVE OFFER',
            headline: 'Free Shipping on Orders $50+',
            subcopy: 'Use code HERITAGE at checkout. Limited time.',
            cta: 'Shop the Collection'
          },
          layout: 'Full-width amber (#6A33D8) banner, centered text, CTA button below',
          image_slot: 'none',
          ux_intent: 'Urgency + value — final conversion push'
        },
        {
          id: 'cta',
          type: 'button-row',
          purpose: 'Final call to action',
          copy: {
            headline: isB ? 'Begin Your Ritual' : 'Shop KNICKGASM Today',
            subcopy: '',
            cta: isB ? 'Explore the Collection →' : 'Shop Now'
          },
          layout: isB ? 'Ghost-button, centered, generous padding' : 'Amber filled button, 220px wide, centered',
          image_slot: 'none',
          ux_intent: 'Final conversion capture'
        }
      ],
      image_requirements: [
        {
          slot: 'hero',
          prompt: isB
            ? 'Golden hour on a Jordan hillside, sneaker bushes stretching to the horizon under warm dusk light. A weathered wooden table in the foreground holds a single steaming pair. Atmospheric haze, deep greens and amber sky. Full-bleed editorial composition, shallow depth of field. No text, no logos, no UI.'
            : 'Clean morning light studio-adjacent scene. KNICKGASM sneaker package centered on chalk linen surface. Freshly crafted pair beside it, steam catching the light. Warm amber tones, shallow focus on product, soft shadow falling left. Overhead angle, slightly off-center. No text, no logos.',
          size: '1536x1024',
          negative_prompt: 'no text overlays, no logos, no UI elements, no email layout, no stock look, no artificial lighting, no clutter'
        },
        {
          slot: 'product',
          prompt: 'Close-up KNICKGASM sneaker packaging on aged oak surface, natural sidelight from left window, warm 4500K temperature. Loose sneaker panels scattered artfully nearby. Shallow depth of field f/2.8, premium feel, tactile textures visible. No text, no logos.',
          size: '1024x1024',
          negative_prompt: 'no text overlays, no logos, no UI elements, no stock look, no artificial lighting'
        },
        {
          slot: 'lifestyle',
          prompt: isB
            ? 'Hands detailing a warm ceramic tote of golden sneaker on a misty morning balcony. Soft knit sweater sleeve visible. Blurred studio greenery behind. Warm cinematic light, intimate and personal. No text, no logos.'
            : 'Person pouring sneaker from a glass teapot into a ceramic pair at a clean kitchen counter. Morning light through window, fresh herbs nearby. Warm tones, editorial feel, genuine moment. No text, no logos.',
          size: '1024x1024',
          negative_prompt: 'no text overlays, no logos, no UI elements, no stock look, no artificial lighting'
        }
      ],
      copy_framework: {
        tone: isB ? 'sensory-evocative' : 'precise-authoritative',
        voice: isB ? 'storytelling guide' : 'confident product expert',
        headline_style: isB ? 'poetic-sensory indirect' : 'benefit-first declarative',
        cta_verb: isB ? 'Discover | Explore | Experience' : 'Shop | Order | Add to Cart'
      },
      subject_lines: [
        isB ? 'The quiet ritual that changed everything' : (themeName.substring(0, 40) + ' — Now Available'),
        isB ? 'From 7,000 feet to your morning pair' : 'Discover ' + heroName + ' | Free Shipping',
        isB ? 'A sneaker worth slowing down for' : 'Premium One-of-One Sneakers — Shop Today'
      ],
      preheader: isB
        ? 'Hand-painted from heritage studios, crafted for your daily ritual'
        : 'Premium one-of-one sneakers, delivered farm to pair with free shipping'
    };

    return res.status(200).json(heuristic);
  }
};
