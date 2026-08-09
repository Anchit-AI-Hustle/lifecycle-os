'use strict';
// ════════════════════════════════════════════════════════════════════════════
// /api/ai/pipeline/strategy  — Stage 1: Master Strategic Lock
//
// THE MOST IMPORTANT STAGE. Runs FIRST. Locks EVERYTHING.
// Downstream stages are pure execution — no thinking happens after this.
//
// Architecture: think → lock → execute (NOT execute → patch → regen)
//
// POST body:  { brief, market, type, products[], regenerate_counter? }
// Response:   {
//   ok, stage,
//   strategic_lock, product_selection, strategy_type, strategy, reasoning,
//   vibe, theme, structure, image_style_lock,
//   variant_a_concept, variant_b_concept
// }
// ════════════════════════════════════════════════════════════════════════════

const { corsHeaders, parseJSON } = require('../../_shared/llm');
const callLLM = require('../../_shared/llm');

const SYSTEM = `You are a Creative Director + Director of Growth at KNICKGASM — a $100M premium D2C Indian heritage sneaker brand.

You do NOT generate mailers directly.
You operate in TWO phases only:
  1) STRATEGIC THINKING — lock everything before any creative starts
  2) EXECUTION CONTRACTS — structured output that downstream stages implement with zero ambiguity

Bad upstream thinking = broken downstream mailer. Think hard. Lock everything. Never leave a decision unmade.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 PHASE 1 — FULL STRATEGIC LOCK (run this FIRST, before any creative)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1 — AUDIENCE & BUSINESS TRUTH
Read the campaign brief carefully. Extract:
- audience_truth: real behavioral insight about this specific audience right now (NOT generic "they love sneaker")
- business_goal: the ONE measurable thing this mailer must achieve
- purchase_barrier: the specific reason this audience is not buying today
- conversion_trigger: the precise thing that will make them act NOW

STEP 2 — PRODUCT SELECTION (AFTER thinking, not before)
Products must directly serve the conversion trigger. No random SKU selection.
- hero_product: the single product that most directly resolves the purchase_barrier
- supporting_products: max 3 SKUs that expand AOV or create a system (not random picks)
- product_system: how these products work together as a purchase story

STEP 3 — CAMPAIGN STRATEGY TYPE
Choose exactly ONE:
- "Conversion Push" — discount/urgency/price anchor, acquisition or reactivation
- "Repeat Purchase" — habit reinforcement, subscription trigger, loyalty
- "AOV Expansion" — bundle logic, upgrade, system selling
- "Brand Building" — origin story, provenance, ritual, no hard sell

Justify WHY this type for THIS audience + goal.

STEP 4 — VIBE & POSITIONING
Define the emotional atmosphere that will make this audience respond:
- emotional_tone: the feeling the reader should have (specific, not generic)
- pace: fast/punchy for urgency, slow/editorial for ritual
- visual_energy: describe the energy level and texture
- positioning: how KNICKGASM is framed in this specific email (premium provenance / accessible ritual / expert authority / trusted daily companion)
- avoid: specific execution choices that would make this feel generic or off-brand for THIS brief

STEP 5 — THEME CREATION
Theme = [User reality] + [Reframe] + [Emotion]
- theme.name: 2-4 words, ownable, specific to THIS brief (NOT "Sneaker Ritual" / "Heritage Drop" — those are banned)
- theme.core_idea: 1 sentence: the consumption truth being reframed
- theme.emotional_driver: 1 sentence: the emotional state this unlocks in the reader
- theme.conversion_logic: why this theme will drive the specific business_goal
- theme.visual_world: 50-70w specific photographic scene a photographer can execute — name surface material, light direction, time of day, one unusual compositional choice

STEP 6 — STRUCTURE LOCK (FINAL — DOWNSTREAM CANNOT CHANGE THIS)
Define the exact section sequence for BOTH variants:
- sections[]: ordered list of section IDs the mailer must contain (from: hero, narrative, context, product_reveal, benefit_strip, social_proof, lifestyle_moment, origin_proof, offer_bar, cta)
- layout_rules: binding layout constraints (max sections, column rules, CTA treatment)
- visual_system: locked design language (color_palette, typography, spacing_rhythm, image_style)

This structure is FINAL. Variant stage will implement it — not redesign it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 PHASE 2 — VARIANT EXECUTION CONTRACTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Now create TWO execution contracts for the SAME strategy with STRUCTURALLY OPPOSITE implementations.
These are NOT two versions of the same mailer — they are two completely different creative executions of the same business goal.
A reader who sees both should feel they are from the same brand but a completely different creative direction.

VARIANT A — CONTROL (Conversion-optimised):
- Product in FIRST section — no delay
- Structured hierarchy: product hero → benefits → proof → offer → CTA
- Copy register: precise, benefit-specific, authoritative
- Layout: split-hero or centered product with copy adjacent
- Color scheme: LIGHT — chalk background #FFFFFF, dark green text, amber accents
- hero_scene: studio-adjacent, product prominent, benefit-clear, morning/afternoon light
- Section flow: top-down conversion funnel, compact, no excess whitespace

VARIANT B — EXPERIMENTAL (Story-first, FORCED STRUCTURAL DIFFERENCE):
HARD RULES — ALL must be true. Verify each before outputting:
□ NO product visible in first 2 sections — narrative or lifestyle opens the email
□ Narrative or lifestyle section comes BEFORE product reveal
□ Copy register: sensory, poetic, evocative — reader FEELS before they SEE product
□ Layout: full-bleed editorial, NO product grid, generous whitespace (64px+ padding)
□ CTA: ghost-button or text-link ONLY — NOT prominent amber filled button
□ hero_scene: atmospheric, lifestyle, DIFFERENT time of day from A, NO studio feel
□ template_key MUST DIFFER from Variant A's template_key
□ COLOR SCHEME INVERTED: B must use dark background (#D0473E or #0a1f13) with light (#FFFFFF / #e8dcc8) text for at least the first 2 sections — NOT chalk background like A
□ SECTION ORDER DIFFERENT: B must NOT open with the same section type as A. If A opens hero→product, B must open narrative→lifestyle or context→mood
□ HEADLINE STYLE: B headlines must be poetic/indirect/sensory (e.g., "The hill is quiet at 7,000 feet.") — NOT benefit-direct like A

DIVERGENCE ENFORCEMENT:
If Variant B resembles A on ANY of the above → rewrite the failing sections entirely from a different emotional entry point. Do not output until all 10 boxes above are checked and true.

COLOR DIVERGENCE REQUIREMENT (mandatory):
- variant_a_concept must specify: color_approach = "light-chalk" (background #FFFFFF, green text)
- variant_b_concept must specify: color_approach = "dark-inverted" (background #D0473E, chalk text) for hero/narrative sections

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERFORMANCE MARKETING PRINCIPLES — APPLY TO EVERY STRATEGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These are embedded learnings from real KNICKGASM mailer performance data. Every strategy MUST account for them:

1. OFFER ABOVE THE FOLD — Discount/offer must be visible in the first scroll (Section 1 or 2). Never bury the price benefit.
2. PRICE ALWAYS VISIBLE — Every product must show a price AND compare-at price. No price = no conversion.
3. EXPLICIT CTA — Every section with a product must have an explicit ADD TO CART or SHOP NOW button. Never rely on the image being clickable.
4. SHORT AND HIGH-IMPACT — Max 6-7 sections. Every section must earn its place. No padding.
5. EMOTIONAL STORYTELLING — Emotional copy improves conversion. For gifting campaigns: "She'll enjoy it every day and remember you" is mandatory hero subcopy.
6. CTA TAGLINE RECALL — For gifting: "MAKE HER SMILE, GIFT RIGHT!" near the CTA button. Repeat on second scroll for recall.
7. MAX 2-3 PRODUCTS in product section. More than 3 causes decision paralysis and lowers click-through.
8. URGENCY (when applicable) — "Hurry Now Before They Finish" or shipping deadline language increases urgency-driven conversion.

MANDATORY SECTION STRUCTURE (both variants must follow this order):
[S1] Announcement bar — offer + code + free shipping, visible immediately
[S2] Brand header
[S3] Hero — MOST IMPORTANT: emotional headline + subcopy + price + offer badge + CTA + CTA tagline
[S4] Benefit strip — max 4 benefit points, visual-first
[S5] Product section — MAX 2-3 products, each with: image, name, price/strikethrough, ADD TO CART button
[S6] Offer reinforcement — repeat badge + urgency (if applicable)
[S7] Footer

The structure.sections array in your output MUST reflect this order exactly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KNICKGASM BRAND CONSTRAINTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Palette: deep purple #D0473E / amber lava #6A33D8 / chalk #FFFFFF
Audience: urban professionals 30-55, health-conscious, value quality + story over price
BANNED phrases: wellness journey / transform / liquid gold / game-changer / LIMITED TIME (caps) / Last chance / While supplies last
PREFERRED: ritual / restore / balance / origin / one-of-one / hand-painted / lace-up / heritage / crafted
IMAGE STYLE: luxury editorial photography — cinematic lighting, shallow DOF, tactile textures, no stock photography look, no clutter, no artificial lighting
IMAGE GENERATION: a multi-provider cascade renders your scene prompts (exact model varies by tier/availability) — prompts must be photorealistic, premium editorial, no text in image, minimal props (1-2), natural lighting, realistic product context

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT: STRICT JSON ONLY — first char {, last char }. No markdown, no commentary.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCHEMA (all fields required):
{
  "strategic_lock": {
    "audience_truth": "specific behavioral insight — NOT generic",
    "business_goal": "the one measurable thing this mailer achieves",
    "purchase_barrier": "why they are NOT buying today",
    "conversion_trigger": "what will make them act NOW"
  },
  "product_selection": {
    "hero": { "name": "exact product name from list", "handle": "shopify_handle", "why": "1 sentence: how it resolves the purchase_barrier" },
    "supporting": [{ "name": "...", "handle": "...", "role": "AOV / expansion / system", "why": "..." }],
    "product_system": "1 sentence: how these products work together as a purchase story",
    "aov_logic": "1 sentence: how supporting products increase order value"
  },
  "strategy_type": "Conversion Push | Repeat Purchase | AOV Expansion | Brand Building",
  "strategy": "name the full strategy in your own words — e.g. 'First-flush urgency via one-of-one scarcity for US premium buyers'",
  "reasoning": "2 sentences: why THIS strategy_type + strategy for THIS audience right now",
  "vibe": {
    "emotional_tone": "specific feeling — e.g. 'quiet confidence and morning stillness'",
    "pace": "slow/editorial OR fast/punchy — and why",
    "visual_energy": "specific visual atmosphere description",
    "positioning": "how KNICKGASM is framed: premium provenance / accessible ritual / expert authority / trusted companion",
    "avoid": "specific execution choices that would feel generic for THIS brief"
  },
  "theme": {
    "name": "2-4 words, ownable, brief-specific",
    "core_idea": "1 sentence: consumption truth being reframed",
    "emotional_driver": "1 sentence: emotional state unlocked in reader",
    "conversion_logic": "1 sentence: why this theme drives the business_goal",
    "visual_world": "50-70w specific photographer-executable scene"
  },
  "structure": {
    "sections": ["hero", "context", "product_reveal", "benefit_strip", "social_proof", "offer_bar", "cta"],
    "layout_rules": "binding layout constraints for both variants",
    "visual_system": {
      "color_palette": "primary / secondary / accent usage rule",
      "typography": "heading font / body font / size guidance",
      "spacing_rhythm": "section gap / internal padding rule",
      "image_style": "photography direction tied to this specific brief"
    }
  },
  "image_style_lock": "50-70w global photography style directive — specific camera type, light source, surface material, depth of field, color temperature, compositional energy. Ownable to THIS brief — not generic.",
  "variant_a_concept": {
    "emotional_angle": "the emotional entry point for Variant A",
    "headline_register": "tone and register — e.g. 'direct benefit-led declarative'",
    "template_key": "launch | sale | story | gift | routine | discovery | bestseller | seasonal | editorial | founder",
    "color_approach": "light-chalk — background #FFFFFF, primary text #D0473E, amber accents #6A33D8",
    "opening_section": "hero (product visible in section 1)",
    "hero_scene": "50-70w specific photographic scene — composition, foreground, background, light direction, mood"
  },
  "variant_b_concept": {
    "emotional_angle": "MUST differ from A — different emotional entry point entirely",
    "headline_register": "MUST differ from A — poetic-sensory, NOT benefit-direct",
    "template_key": "MUST differ from A's template_key (choose a different one from the list)",
    "color_approach": "dark-inverted — background #D0473E for first 2 sections, chalk text #FFFFFF, amber accent — OPPOSITE of A",
    "opening_section": "narrative or lifestyle (NO product in first 2 sections)",
    "hero_scene": "50-70w scene — DIFFERENT composition axis, time of day (e.g. dusk/evening if A is morning), human context, atmospheric mood — NOT studio"
  },
  "variant_divergence_contract": {
    "layout_difference": "1 sentence: specific structural difference between A and B layouts",
    "color_difference": "A uses light chalk bg / B uses dark green bg for opening sections",
    "copy_difference": "1 sentence: how A and B copy registers differ",
    "section_order_difference": "1 sentence: how A and B section sequences differ",
    "product_treatment_difference": "A: product grid in section 1 / B: editorial single product reveal after section 2"
  }
}`;

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

  const brief = (body.brief || '').toString().substring(0, 700);
  const market = (body.market || 'US').toString();
  const type = (body.type || '').toString();
  const products = Array.isArray(body.products) ? body.products : [];
  const regenerate_counter = Number(body.regenerate_counter) || 0;

  const productsBlock = products.slice(0, 15)
    .map(p => `- ${p.name || p.n || '?'} | ${p.price ? '$' + p.price : ''} | ${p.category || ''} | handle:${p.handle || p.id || '?'} | image:${p.image_url || p.i || ''}`)
    .join('\n');

  const marketContext = {
    US: 'Urban US professionals 30-55. $55+ AOV. Value origin story, clean-label, daily ritual.',
    UK: 'UK sneaker-culture audience. Appreciate provenance, craft, premium gifting.',
    IN: 'Indian domestic audience. Value tradition, festivity, hand-painted kicks culture.',
    AU: 'Australian streetwear seekers. Outdoor lifestyle, clean-label, ethical sourcing.',
    ME: 'Middle East audience. Love rich hand-painted kicks, vibrant colorways, gifting occasions.',
    EU: 'European health-conscious shoppers. B-Corp story resonates, organic-certified.',
    Global: 'International premium audience. Discovery-minded, seeking authentic Indian heritage.'
  };

  // Derive a campaign name from brief + type for grounded context
  const campaignType = type || 'Campaign';
  const campaignName = brief
    ? brief.split(/[.!?\n]/)[0].trim().substring(0, 80) || (campaignType + ' · ' + market)
    : (campaignType + ' · ' + market);

  // ── User message: starts with campaign context, not a generic header ─────
  const userMessage = `CAMPAIGN: ${campaignName}
BRIEF: ${brief || '(no brief — derive a strong one from campaign type and market)'}
OBJECTIVE: ${type ? type + ' campaign' : 'Derive objective from brief'} for ${market} market
AUDIENCE: ${market} — ${marketContext[market] || market}
PRODUCTS AVAILABLE: ${productsBlock ? '\n' + productsBlock : '(none — infer appropriate KNICKGASM sneaker products from brief)'}
${regenerate_counter > 0 ? `\nREGENERATE #${regenerate_counter}: ALL fields must differ from the previous run — new hero scene, new emotional angle, different strategy emphasis, different product selection if possible.` : ''}

Run Phase 1 → Phase 2 now. Think deeply before locking. Every field matters.`;

  try {
    const { text, provider, model, quota_warning, exhausted_keys } = await callLLM({
      systemPrompt: SYSTEM,
      userMessage,
      responseFormat: { type: 'json_object' },
      maxTokens: 3000,
      temperature: 0.65 + Math.min(0.3, regenerate_counter * 0.1),
      timeoutMs: 38000,        // 38s internal; vercel maxDuration 45s (7s headroom)
      stage: 'strategy[regen=' + regenerate_counter + ']',
      tier: 'premium',
      userGeminiKey
    });

    let parsed;
    try { parsed = parseJSON(text); }
    catch (e) { return res.status(502).json({ error: 'json_parse_failed', provider, raw: text.substring(0, 400) }); }

    // Validate divergence between variants — check all 5 dimensions
    const a = parsed.variant_a_concept || {};
    const b = parsed.variant_b_concept || {};

    const divergenceIssues = [];
    if (a.emotional_angle === b.emotional_angle)    divergenceIssues.push('same emotional_angle');
    if (a.headline_register === b.headline_register) divergenceIssues.push('same headline_register');
    if (a.template_key === b.template_key)           divergenceIssues.push('same template_key');
    if (a.opening_section === b.opening_section)     divergenceIssues.push('same opening_section');
    // Critical: B must be dark-inverted, A must be light-chalk
    const aIsDark = (a.color_approach || '').toLowerCase().includes('dark');
    const bIsLight = (b.color_approach || '').toLowerCase().includes('chalk') || (b.color_approach || '').toLowerCase().includes('light');
    if (aIsDark)  divergenceIssues.push('Variant A incorrectly specifies dark color_approach — must be light-chalk');
    if (bIsLight) divergenceIssues.push('Variant B incorrectly specifies light/chalk color_approach — must be dark-inverted');

    if (divergenceIssues.length > 0) {
      parsed._divergence_warning = 'Divergence issues: ' + divergenceIssues.join('; ') + '. Downstream variant stage will enforce separation.';
    }

    // Auto-correct color_approach if LLM got it wrong (defensive fix)
    if (!a.color_approach || aIsDark) {
      a.color_approach = 'light-chalk — background #FFFFFF, primary text #D0473E, amber accents #6A33D8';
      parsed.variant_a_concept = a;
    }
    if (!b.color_approach || bIsLight) {
      b.color_approach = 'dark-inverted — background #D0473E for first 2 sections, chalk text #FFFFFF, amber accent — OPPOSITE of A';
      parsed.variant_b_concept = b;
    }
    if (!b.opening_section || b.opening_section === a.opening_section || b.opening_section.toLowerCase().includes('hero')) {
      b.opening_section = 'narrative or lifestyle (NO product in first 2 sections)';
      parsed.variant_b_concept = b;
    }

    // Ensure strategy_type is present (backward compat for older output)
    if (!parsed.strategy_type && parsed.strategy) {
      const s = (parsed.strategy || '').toLowerCase();
      if (s.includes('conversion') || s.includes('sale') || s.includes('discount')) parsed.strategy_type = 'Conversion Push';
      else if (s.includes('repeat') || s.includes('habit') || s.includes('routine')) parsed.strategy_type = 'Repeat Purchase';
      else if (s.includes('aov') || s.includes('bundle') || s.includes('expand')) parsed.strategy_type = 'AOV Expansion';
      else parsed.strategy_type = 'Brand Building';
    }

    return res.status(200).json({
      ok: true, provider, model, stage: 'strategy',
      ...(quota_warning ? { quota_warning: true, exhausted_keys } : {}),
      ...parsed
    });

  } catch (e) {
    // ── HEURISTIC FALLBACK: generate a reasonable strategy without LLM ──────
    console.warn('[strategy] All providers failed — using heuristic fallback');
    const heroProduct = products[0] || { name: 'KNICKGASM Signature Sneaker Collection', handle: 'signature-collection' };
    const supporting = products.slice(1, 4).map(p => ({
      name: p.name || p.n || 'KNICKGASM Sneaker',
      handle: p.handle || p.id || 'knickgasm-sneaker',
      role: 'AOV expansion',
      why: 'Complements the hero product for a curated set'
    }));

    const briefWords = (brief || 'Premium Sneaker Campaign').trim();
    const isGifting = /gift|mother|father|valentine|birthday|anniversary/i.test(briefWords);
    const isSeasonal = /summer|winter|spring|autumn|monsoon|holiday|festiv/i.test(briefWords);
    const isSale = /sale|discount|offer|deal|flash|clearance/i.test(briefWords);

    const stratType = isSale ? 'Conversion Push' : isGifting ? 'AOV Expansion' : isSeasonal ? 'Brand Building' : 'Brand Building';
    const emotionalTone = isGifting ? 'warm generosity and thoughtful celebration'
      : isSale ? 'smart discovery and rewarding value'
      : 'quiet confidence and curated craftsmanship';
    const pace = isSale ? 'fast/punchy — urgency drives action' : 'slow/editorial — let the story breathe';

    const heuristic = {
      ok: true, provider: 'heuristic', model: 'fallback-v1', stage: 'strategy',
      _heuristic: true,
      _llm_error: String(e.message || e).substring(0, 300),
      provider_errors: e._providerErrors || [],
      strategic_lock: {
        audience_truth: `${market} premium sneaker buyers who appreciate origin stories and artisan craftsmanship — browsing but need a compelling reason to add to cart today`,
        business_goal: `Drive qualified clicks and conversion for ${market} market via ${briefWords.substring(0, 60)}`,
        purchase_barrier: 'Too many premium options — needs a clear reason why KNICKGASM is the smarter, more authentic choice',
        conversion_trigger: isGifting ? 'Curated gift sets that feel personal and premium without the decision fatigue'
          : isSale ? 'Clear value anchor with price comparison and urgency'
          : 'Single-studio provenance story that no supermarket brand can replicate'
      },
      product_selection: {
        hero: { name: heroProduct.name || heroProduct.n || 'KNICKGASM Signature Sneaker', handle: heroProduct.handle || heroProduct.id || 'signature-sneaker', why: 'Best expression of the campaign brief — anchors the story' },
        supporting,
        product_system: 'Hero drives interest, supporting products expand the order into a curated experience',
        aov_logic: 'Bundle logic: hero + 1-2 complementary colorways = complete ritual set'
      },
      strategy_type: stratType,
      strategy: `${stratType} via ${isGifting ? 'curated gifting narrative' : isSale ? 'price-anchored urgency' : 'one-of-one provenance storytelling'} for ${market} premium audience`,
      reasoning: `${stratType} is the right approach because the brief "${briefWords.substring(0, 50)}" signals ${isGifting ? 'a gifting occasion where AOV expansion through sets is natural' : isSale ? 'a value-driven moment where price anchoring and urgency convert browsers to buyers' : 'a brand-forward moment where origin story and craft differentiate KNICKGASM from commodity alternatives'}. The ${market} audience responds to authenticity and specificity over generic sneaker marketing.`,
      vibe: {
        emotional_tone: emotionalTone,
        pace,
        visual_energy: 'Warm natural light, tactile surfaces, intentional stillness — premium editorial not catalog',
        positioning: isGifting ? 'premium provenance gifting' : 'accessible daily ritual with artisan roots',
        avoid: 'Generic stock photography, cluttered layouts, aggressive discount language, streetwear clichés'
      },
      theme: {
        name: briefWords.split(/\s+/).slice(0, 4).join(' '),
        core_idea: `Reframing ${isGifting ? 'gifting' : 'daily sneaker'} from commodity habit to intentional ritual through one-of-one Indian heritage`,
        emotional_driver: `The reader feels ${isGifting ? 'like a thoughtful curator choosing something meaningful' : 'quietly rewarded for choosing craft over convenience'}`,
        conversion_logic: `${stratType === 'Conversion Push' ? 'Price anchor + urgency removes hesitation' : 'Story-driven emotional investment makes the purchase feel personal, not transactional'}`,
        visual_world: 'Morning light through a kitchen window falling on a wooden surface. A single pair of golden sneaker, steam visible. Fresh sneaker panels in a small ceramic bowl beside it. Shallow depth of field, warm color temperature, overhead compositional angle slightly off-center. The scene feels real, unhurried, editorially composed but not staged.'
      },
      structure: {
        sections: ['hero', 'context', 'product_reveal', 'benefit_strip', 'social_proof', 'offer_bar', 'cta'],
        layout_rules: 'Max 7 sections. Single-column mobile-first. CTA visible without scroll. Product section max 3 items.',
        visual_system: {
          color_palette: 'Primary: deep purple #D0473E. Secondary: chalk #FFFFFF. Accent: amber lava #6A33D8. Variant A uses chalk bg, Variant B uses dark bg.',
          typography: 'Headings: serif, 28-36px. Body: sans-serif, 14-16px. Generous line-height 1.6.',
          spacing_rhythm: 'Section gap: 32-48px. Internal padding: 24-32px. Breathing room between elements.',
          image_style: 'Luxury editorial — cinematic warm light, shallow DOF, tactile textures, no stock look'
        }
      },
      image_style_lock: 'Shot on medium-format digital with 80mm lens. Natural window light, warm 4500K color temperature. Shallow depth of field f/2.8. Tactile surfaces: raw linen, aged wood, matte ceramic. One hero product prominent, 1-2 supporting props maximum. No text overlays, no artificial lighting, no clutter. The image should feel like a premium lifestyle magazine editorial.',
      variant_a_concept: {
        emotional_angle: 'Direct confidence — the product speaks for itself with clarity and authority',
        headline_register: 'Direct benefit-led declarative — clear, precise, action-oriented',
        template_key: isSale ? 'sale' : isGifting ? 'gift' : 'bestseller',
        color_approach: 'light-chalk — background #FFFFFF, primary text #D0473E, amber accents #6A33D8',
        opening_section: 'hero (product visible in section 1)',
        hero_scene: 'Clean morning light studio-adjacent scene. KNICKGASM sneaker package centered on a chalk linen surface. A freshly crafted pair beside it, steam catching the light. Warm amber tones, shallow focus on the product, soft shadow falling left. Overhead angle, slightly off-center composition. Premium, confident, conversion-clear.'
      },
      variant_b_concept: {
        emotional_angle: 'Atmospheric immersion — the reader feels the origin before seeing the product',
        headline_register: 'Poetic-sensory and evocative — reader feels before they see',
        template_key: isSale ? 'story' : isGifting ? 'editorial' : 'story',
        color_approach: 'dark-inverted — background #D0473E for first 2 sections, chalk text #FFFFFF, amber accent — OPPOSITE of A',
        opening_section: 'narrative or lifestyle (NO product in first 2 sections)',
        hero_scene: 'Golden hour on a Jordan hillside. Sneaker bushes stretching to the horizon under warm dusk light. A weathered wooden table in the foreground holds a single steaming pair. Atmospheric haze, deep greens and amber sky. Full-bleed editorial composition, the product is secondary to the mood. The reader should feel transported to the studio.'
      },
      variant_divergence_contract: {
        layout_difference: 'A uses centered product-hero layout; B uses full-bleed editorial with generous whitespace',
        color_difference: 'A uses light chalk bg (#FFFFFF) with dark text; B uses dark green bg (#D0473E) with chalk text for opening sections',
        copy_difference: 'A is direct and benefit-specific; B is sensory, poetic, and narrative-led',
        section_order_difference: 'A opens hero→product; B opens narrative→lifestyle→product reveal',
        product_treatment_difference: 'A: product grid in section 1; B: editorial single product reveal after section 2'
      }
    };

    return res.status(200).json(heuristic);
  }
};
