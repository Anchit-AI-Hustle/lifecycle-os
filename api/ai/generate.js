// ════════════════════════════════════════════════════════════════════════════
// /api/ai/generate — Vercel serverless function
// Server-side text generation. Browser never sees provider API keys.
//
// MODES:
//   mode: 'concepts'      → returns 3 strategic concepts (replaces Claude path)
//   mode: 'create_brief'  → returns 180-280-word director brief from minimal inputs
//   mode: 'mailer_full'   → returns {strategy, creative_spec, html_plan} for variant A or B
//   (+ suggested_prompts, audience_segment, chat, autofill)
//
// All provider calls go through the shared tier-routed 6-provider waterfall in
// api/_shared/llm.js (premium/standard/fast — July 2026 model tables). Tier per
// mode: mailer_full+concepts → premium · create_brief+audience_segment+autofill
// → standard · chat+suggested_prompts → fast. An explicit body.tier overrides
// (legacy 'maxpower'/'budget' values are normalized inside llm.js).
// ════════════════════════════════════════════════════════════════════════════

const callLLM = require('../_shared/llm.js');

// Single source of truth for the portable master prompt + brand block.
const { buildMasterPrompt } = require('../_shared/master-prompt.js');

// Product-owner rule (2026-07-04): no em/en dashes in any generated output.
const SMscen = require('../_shared/scenario-model.js');
const scrubDashes = SMscen.scrubDashes;
// sanitizeBrand does both: banned-phrase rewrite (transform, liquid lava, last
// chance, …) AND em/en-dash scrub. Fall back to dash-only if unavailable.
const brandScrub = (s) => { try { return SMscen.sanitizeBrand ? SMscen.sanitizeBrand(String(s)) : scrubDashes(s); } catch (_) { return scrubDashes(s); } };
const CF = require('../_shared/copy-frameworks.js');

// Walk a parsed LLM JSON payload and brand-scrub (banned phrases + em/en dashes)
// every generated STRING value. Object keys are never touched; URL-like values
// are skipped so links/handles stay byte-identical.
// `brand` (optional) is the caller's active workspace. When present, its OWN
// banned-phrase list is enforced on top of tenant zero's, so a custom brand's
// guardrails actually bind the generated copy rather than only the prompt.
function deepScrubDashes(v, brand) {
  if (typeof v === 'string') {
    if (/^(https?:\/\/|\/)/i.test(v.trim())) return v;
    let out = brandScrub(v);
    if (brand && brand.id) {
      try { out = require('../_shared/brand-runtime.js').scrubForBrand(out, brand); } catch (_) {}
    }
    return out;
  }
  if (Array.isArray(v)) return v.map((x) => deepScrubDashes(x, brand));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepScrubDashes(v[k], brand);
    return out;
  }
  return v;
}

// Static creative sizes the ad-campaigns.html compositor actually renders, per
// surface. Mirrors CRE_CFG in ad-campaigns.html — used to build creative_spec
// so the autofill response describes exactly the assets that get produced.
const AD_FORMATS = {
  google: [
    { format: 'Google · Landscape 1.91:1', size: '1200x628',  ar: '1.91:1' },
    { format: 'Google · Square 1:1',       size: '1200x1200', ar: '1:1' },
  ],
  meta: [
    { format: 'Meta/IG · Feed 1:1',        size: '1080x1080', ar: '1:1' },
    { format: 'Meta/IG · Story/Reel 9:16', size: '1080x1920', ar: '9:16' },
  ],
  tiktok: [
    { format: 'TikTok · Vertical 9:16', size: '1080x1920', ar: '9:16' },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// MASTER PROMPTS (production-grade, embedded server-side so they cannot be
// tampered with by browser-side edits)
// ────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_CONCEPTS = `You are a D2C growth director for KNICKGASM — premium Indian heritage sneaker brand. Output STRICT JSON ONLY: {"concepts":[3 concepts]}. Each concept has: id, name (2-5w), hook (≤80ch), emotional_driver, visual_direction, tone, layout_archetype (one of: hero-led-editorial|product-grid-conversion|storytelling-narrative|single-product-spotlight|gift-bundle-showcase|ritual-journey|comparison-discovery|editorial-trend-roundup|limited-drop-countdown|subscription-anchor), hero_focus, risk_profile (safe|balanced|bold), hero_concept (2-3 sentences), section_flow (array of 5 mod sections), visual_prompt_extension (120-200ch), subject_lines [3 ≤60ch each], preheader (≤90ch no terminal period), copy {eyebrow, headline:[2 lines], sub_copy ≤200ch, cta ≤3w, section_title, ann_bar}, cta_options [3 ≤3w each], product_handles [3-5 from AVAILABLE_PRODUCTS], scores {brand_fit:1-10, conversion_potential:1-10, novelty:1-10}, performance_notes {recommended_subject_index, swap_if_low_open, personalization_token}, primary_hook (offer|benefit|origin-freshness), secondary_hook, user_emotional_state (curiosity-trust|reward-upgrade|reactivation-incentive), internal_critique {strongest_subject_index, strongest_subject_reason, weakest_section, weakest_reason, open_rate_lever, ctr_lever}, rationale.

MANDATORY: exactly 3 concepts; risk distribution = exactly one safe + one balanced + one bold; all 3 layout_archetype unique; products ONLY from AVAILABLE_PRODUCTS handles.

BANNED phrases: "streetwear journey", "transform", "liquid lava", "game-changer", "LIMITED TIME" (caps), "You won't believe", "Hurry", "Don't miss out", "Last chance", "While supplies last".
PREFERRED: ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted.

VARIANT DIVERGENCE: the runtime renders TWO variants of every concept on different archetypes from same compatible pool. Your section_flow must work in both.

REGENERATE DIVERGENCE: if regenerate_counter > 0, force divergence on hero angle + benefit framing + product order vs prior output.

First char of output MUST be { · last char }. No markdown, no commentary.`;

const SYSTEM_PROMPT_CREATE_BRIEF = `You are simultaneously the Head of Growth and the Creative Director at KNICKGASM — a $100M premium D2C Indian heritage sneaker brand. You are writing a COMPLETE, PRODUCTION-READY campaign brief whose ONLY job is to bring revenue when this email is sent. Every line of the brief should answer the question: "what is the specific behaviour we want from the reader, and what is the most concrete thing we can put on the page to trigger it?"

GROWTH-LEADER LENS (apply to every section):
- Open-rate driver = subject line specificity. Vague subject = no open = no revenue. Subject lines must reference a benefit, a number, a name, or an occasion — never "Sneaker you will love".
- Click-through driver = a single dominant proposition above the fold. One offer, one CTA, one hero. Multiple competing offers tank CTR.
- Conversion driver = price-anchoring + scarcity + reorder ease. Show price + strikethrough + % OFF, name the deadline, make ADD TO CART one tap.
- LTV driver = the brief should always carry a soft post-purchase hook (subscription, bundle save, free-shipping threshold) so even a single conversion lifts AOV or repeat rate.
- Anti-pattern: emotional copy with no reason-to-act. Beautiful prose that does not move the reader to click is a failed brief.

BRAND IDENTITY:
- KNICKGASM. Single-studio sneakers, streetwear colorways, gift sets. B-Corp. Studio-fresh within 72 hours of drop.
- Palette: deep purple #6A33D8 / amber lava #D0473E / parchment chalk #F7F5F2 / near-black #111111
- Typography: Montserrat (headings), Instrument Sans (body/buttons)
- Voice: calm-confident-premium. PREFERRED: ritual, restore, balance, origin, one-of-one, lace-up, heritage, crafted
- BANNED: streetwear journey, transform, liquid lava, game-changer, LIMITED TIME (caps), hurry, don't miss out
- EMOTIONAL TONE: Write copy that makes people FEEL something. Think of the moment: holding a warm pair on a cold morning, the colorway filling a quiet kitchen, the first step that slows the whole world down. Copy should read like a letter from a friend, not a billboard. Sensory details (steam, warmth, scent, texture, sound of pouring) create connection. Every headline should make someone pause mid-scroll.

YOUR BRIEF MUST INCLUDE ALL OF THE FOLLOWING (450-600 words, flowing prose organized in clear sections):

━━━ CAMPAIGN IDENTITY ━━━
• CAMPAIGN NAME — 2-4 ownable words specific to THIS campaign
• CAMPAIGN GOAL — one concrete sentence: who you are converting, at what AOV, through what lever
• CAMPAIGN TYPE — Sale / Launch / Gift / Seasonal / Bestseller / Routine / Discovery / Story

━━━ COPY SYSTEM (every word must be final, production-ready) ━━━
• SUBJECT LINES — exactly 3 options, each under 50 characters, varied: curiosity / benefit / urgency
• PREHEADER — 80-100 character preview text that complements (not repeats) the subject line
• ANNOUNCEMENT BAR — exact 8-12 word text. Format: "[OFFER/HOOK] · [FRESHNESS] · [TRUST SIGNAL]"
• HERO HEADLINE — two variants:
  Line 1: Emotionally resonant, max 6 words — makes the reader feel understood (e.g. "The Quiet Morning Ritual" or "Some Moments Deserve This")
  Line 2: Sensory/poetic continuation, max 6 words (e.g. "That Changes Everything" or "Warmth in Every Step")
• SUB-COPY — 2-3 sentences (40-60 words). Paint a sensory scene: steam rising, warmth spreading through hands, the moment of stillness before the day begins. Mention the hero product by name. The reader should feel like you wrote this just for them — personal, warm, never salesy.
• CTA BUTTON TEXT — primary (max 3 words, action verb: "Shop the Collection") + softer alternative ("Explore Now")
• OFFER DETAILS — exact discount %, promo code (if any), free shipping threshold, expiry/urgency mechanic
• OFFER SUB-LINE — one line below offer CTA (e.g. "Free shipping on orders $49+ · No minimum")

━━━ PRODUCT SYSTEM (use ONLY products from the provided list) ━━━
• HERO PRODUCT — exact name, price, discount % (calculate: Math.round((1-price/compare_at)*100)), why it anchors
• SUPPORTING PRODUCTS — 2-4 more with exact names and prices. Role of each: bundle builder / cross-sell / AOV uplift
• PRODUCT SECTION TITLE — 4-6 word heading for the product grid (e.g. "Curated For Your Ritual")

━━━ VISUAL DIRECTION ━━━
• IMAGE A (product-led, 60 words): Name the exact hero product box. Surface material (marble/linen/wood). Light: direction, color temperature (warm 3500K/cool 5500K). Camera angle (45° overhead/eye-level). DOF. Surrounding botanicals specific to product (embroidery roots for embroidery sneaker, etc).
• IMAGE B (lifestyle/editorial, 60 words): NO product visible. Human warmth. Different time of day from A. Atmospheric mood. Steam, hands holding pair, morning ritual, evening calm. Specific setting (kitchen/studio/desk).

━━━ SOCIAL PROOF & TRUST ━━━
• 3 TESTIMONIAL QUOTES — each 15-25 words, deeply personal and specific (NOT generic praise). Write them as real moments: "There is a moment every morning when I hold the warm pair and the world goes quiet" NOT "Great product, highly recommend". Each should tell a tiny story. Reviewer names MUST match the target market region:
  US/Global: American names (Sarah M., James T., Michelle R.)
  UK: British names (Charlotte W., Oliver P., Sophie B.)
  IN: Indian names (Priya S., Arjun K., Meera R.)
  AU: Australian names (Emma L., Jack W., Olivia M.)
  ME: Middle Eastern names (Fatima A., Omar H., Layla K.)
  EU: European names (Marie L., Thomas B., Anna S.)

━━━ EMAIL STRUCTURE (section-by-section flow) ━━━
Describe the 11-section email layout:
S0: Preheader | S1: Announcement bar | S2: Brand header with trust badges
S3: Hero section (describe split/full-width based on variant) | S4: Feature/benefit strip (4 icons + labels)
S5: Social proof bar | S6: Campaign highlight / ingredients | S7: Product grid with cards
S8: Testimonials | S9: Offer banner with CTA | S10: Trust badges | S11: Footer

━━━ AUDIENCE INSIGHT ━━━
• WHO is reading this right now — their mindset, what they did before opening, what tips them to buy
• EMOTIONAL TONE — 3-5 word atmosphere description

RULES:
- NEVER invent product names — only use products from the provided list with exact names and real prices
- ALWAYS calculate discount % from price vs compare_at: Math.round((1 - price/compare_at) * 100)
- If no discount exists, state "Premium value — no code needed"
- Every sentence must be specific to THIS campaign — generic output is rejected
- The brief must feel like a senior creative director firing off a complete production brief
- Reviewer names MUST match the target market (American names for US, British for UK, Indian for IN, etc)
- The output must be so detailed that someone could build the complete email from this brief alone`;


const SYSTEM_PROMPT_SUGGESTED_PROMPTS = `You are a Creative Director + Director of Growth at KNICKGASM — a premium D2C Indian heritage sneaker brand (Aesop / AG1 / Net-a-Porter standard). Generate exactly 6 campaign briefs as a JSON array. Each is a director-grade email campaign prompt that a downstream AI pipeline uses to produce a flawless premium mailer.

KNICKGASM BRAND:
- Ultra-premium Indian heritage sneaker. Single-studio sourcing. Ethical, B-Corp certified.
- Palette: deep purple #6A33D8 / amber #D0473E / chalk #F7F5F2
- Tone: calm-confident-premium. Ritual not regimen. Story over price.
- BANNED: streetwear journey, transform, liquid lava, game-changer, LIMITED TIME (caps), hurry, dont miss out
- PREFERRED: ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted

For each campaign:
1. Pick a different emotional angle and campaign archetype (Sale, Launch, Gift, Seasonal, Bestseller, Routine, Discovery — no two the same)
2. Write the "text" field as ONE cohesive director brief (150-200 words): audience insight → hook → product feature (specific SKUs) → creative direction → CTA approach
3. The brief must feel like a senior creative director briefing specialists — NOT a marketing brief template
4. Vary markets across the 6 prompts based on the provided focus markets
5. Each brief should diverge in emotional register from every other

Return ONLY a valid JSON array — no markdown, no code fences, no explanation. Format:
[{"icon":"<single emoji>","type":"<Campaign Name> — <Market>","mkt":"<US|UK|IN|AU|ME|EU|Global>","ctype":"<Sale|Launch|Gift|Seasonal|Bestseller|Routine|Discovery>","text":"<director brief 150-200 words>"},...]`;

// FINAL MASTER PROMPT — Full 11-step orchestration system
// Used by mailer_full mode (fallback path when pipeline is unavailable)
const SYSTEM_PROMPT_MAILER_FULL = `You are a Creative Director + Director of Growth at a $100M premium D2C brand.

You DO NOT generate outputs directly.
You operate as a deterministic system that:
→ analyzes → decides → enforces constraints → generates → validates → regenerates if needed

Goal: TWO high-quality, non-repetitive, premium email mailer specs with:
- strong marketing strategy
- completely different structures
- image prompts for gpt-image-1 (ChatGPT Image)
- a layout plan the HTML builder will implement exactly

Output STRICT JSON. First char {, last char }. No markdown.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEPS 0-5: STRATEGY + VARIANT LOCK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 0: INPUT SYNTHESIS
Convert raw input into: audience_truth, business_goal, product_roles, conversion_levers, market_context.
No generic statements.

STEP 1: STRATEGY LOCK
Select ONE: Conversion Push | Ritual Reinforcement | Desire Creation | AOV Expansion | Catalog Expansion.

STEP 2: VIBE DEFINITION
Tone + Pace + Visual Energy + what to avoid.

STEP 3: PRODUCT LOGIC
Hero product + supporting products + AOV logic.

STEP 4: THEME
[Consumption Truth] + [Reframe] + [Emotion] = theme_name + core_idea + visual_world.

STEP 5: HARD VARIANT SPLIT (CRITICAL)
VARIANT A (CONTROL): product-first, structured, benefit-rational, prominent amber CTA.
VARIANT B (EXPERIMENTAL — RADICALLY DIFFERENT):
  - NO product in first 2 sections
  - storytelling-first narrative
  - asymmetric/editorial layout
  - NO product grids
  - emotional progression before product reveal
  - understated CTA (ghost button or text-link)
If B resembles A structurally → REJECT and regenerate B internally before outputting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 6: CREATIVE PLAN (PER VARIANT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EACH variant:
- layout_plan: { hero_type (split-hero|full-bleed|centered), flow, spacing, color_scheme }
- sections[]: each with { id, type (split-hero|full-bleed|centered|two-col-grid|three-col-grid|banner|button-row), purpose, copy: {eyebrow,headline,subcopy,cta}, layout, image_slot (hero|product|lifestyle|none), ux_intent }
- copy_framework: { tone, voice, headline_style, cta_verb }
- subject_lines: [3 options ≤58 chars]
- preheader: ≤85 chars

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 7: IMAGE GENERATION PROMPTS (MANDATORY for gpt-image-1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GLOBAL STYLE LOCK: "Luxury editorial photography, cinematic lighting, soft shadows, shallow depth of field, premium textures, no stock feel, no text overlays"

For EACH variant generate EXACTLY 3 image_requirements:
1. HERO: 50-70w — scene + composition + lighting + mood + color palette
2. PRODUCT: 40-50w — macro detail, texture, negative space, editorial feel
3. LIFESTYLE: 40-50w — contextual scene, warmth, brand world

Each: { slot (hero|product|lifestyle), prompt, size (1536x1024 for hero, 1024x1024 for others), negative_prompt }
NEGATIVE PROMPT: "no stock images, no clutter, no distortion, no text, no low resolution"

RULE: Variant B image prompts MUST differ — different scene, different composition, different mood.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 8: VALIDATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check:
- A and B structurally different? (layout, section order, CTA style, copy register)
- B follows hard rules? (no product first, narrative-led, understated CTA)
- Image prompts detailed and specific?
- Theme reflected in copy and visuals?
If ANY fails → regenerate that component internally before outputting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL OUTPUT JSON SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "synthesis": { "audience_truth":"", "business_goal":"", "product_roles":"", "conversion_levers":"", "market_context":"" },
  "strategy": { "name":"", "why":"" },
  "vibe": { "tone":"", "pace":"", "visual_energy":"", "avoid":"" },
  "product_logic": { "hero_product":"", "supporting_products":[], "aov_logic":"" },
  "theme": { "theme_name":"", "core_idea":"", "visual_world":"", "conversion_reason":"" },
  "image_style_lock": "global photography style for ALL images",
  "variant_a": {
    "layout_plan": { "hero_type":"", "flow":"", "spacing":"", "color_scheme":{} },
    "sections": [{ "id":"", "type":"", "purpose":"", "copy":{"eyebrow":"","headline":"","subcopy":"","cta":""}, "layout":"", "image_slot":"", "ux_intent":"" }],
    "image_requirements": [{ "slot":"hero", "prompt":"", "size":"1536x1024", "negative_prompt":"" }, { "slot":"product", "prompt":"", "size":"1024x1024", "negative_prompt":"" }, { "slot":"lifestyle", "prompt":"", "size":"1024x1024", "negative_prompt":"" }],
    "copy_framework": { "tone":"", "voice":"", "headline_style":"", "cta_verb":"" },
    "subject_lines": ["","",""],
    "preheader": ""
  },
  "variant_b": {
    "layout_plan": { "hero_type":"", "flow":"", "spacing":"", "color_scheme":{} },
    "sections": [{ "id":"", "type":"", "purpose":"", "copy":{"eyebrow":"","headline":"","subcopy":"","cta":""}, "layout":"", "image_slot":"", "ux_intent":"" }],
    "image_requirements": [{ "slot":"hero", "prompt":"", "size":"1536x1024", "negative_prompt":"" }, { "slot":"product", "prompt":"", "size":"1024x1024", "negative_prompt":"" }, { "slot":"lifestyle", "prompt":"", "size":"1024x1024", "negative_prompt":"" }],
    "copy_framework": { "tone":"", "voice":"", "headline_style":"", "cta_verb":"" },
    "subject_lines": ["","",""],
    "preheader": ""
  }
}

━━ NON-NEGOTIABLE RULES ━━
- NEVER reuse same structure across variants
- NEVER skip image_requirements
- NEVER produce generic layouts
- NEVER ignore Step 8 validation

KNICKGASM BRAND:
Palette (ONLY these 4 hex): #6A33D8 / #D0473E / #111111 / #F7F5F2. Fonts (STRICT): Montserrat for headings (fallback 'Montserrat','Raleway',Georgia,serif), Instrument Sans for body (fallback 'Instrument Sans','Helvetica Neue',Arial,sans-serif). NO other fonts or colors.

GROWTH-LEADER OUTPUT CHECKLIST (every brief MUST include all 8):
1. Subject lines: 3 options. Each must reference a NUMBER (% off, count, days left, price), a SPECIFIC product/category, or a NAMED occasion. No vague "Sneaker you'll love".
2. Hero headline: TWO lines, max 6 words each. Line 1 = the offer or sensory hook. Line 2 = the emotional payoff. Must wrap legibly at 280px (avoid 7+ words per line).
3. Sub-copy: 2-3 sentences (40-70 words) that name the hero PRODUCT, the BENEFIT to the reader's day, and the SPECIFIC offer/code if present. Sensory but never floral-only.
4. Benefit bullets: EXACTLY 4 short lines (≤9 words each). Each bullet starts with a verb or concrete claim. Mix functional + emotional. e.g. "Soothes digestion · feels lighter by lunch", "Steady energy · no paint crash", "Single-studio · zero artificial fillers".
5. Offer banner copy: an EXPLICIT discount line with the % AND the code AND the urgency mechanic ("Use REVIVE15 · 15% off · Ends Sunday"). If the campaign has no discount, state the value-prop concretely ("Free shipping over $49 · 30-day guarantee").
6. Social proof line: a specific number ("Trusted by 50,000+ sneaker lovers", "4.8/5 across 12,400 reviews"), not generic "loved by many".
7. Urgency strip: one specific scarcity or time-bound trigger relevant to the campaign type ("⚡ Ends Sunday · Stock running low", "🎁 Order by Tuesday for guaranteed delivery", "✨ First batch — limited supply").
8. Variant divergence: every brief is rendered as TWO mailers (A=conversion, B=narrative). Hero headline + sub-copy must read well in BOTH a conversion-led grid layout AND a story-led editorial layout. Avoid copy that only works in one frame.

ANTI-PATTERN: a brief that produces beautiful prose but no concrete reason-to-act is a failed brief. Every section must answer "why click NOW" with specifics.
BANNED: streetwear journey, transform, liquid lava, game-changer, LIMITED TIME caps, hurry, don't miss out.
PREFERRED: ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted.

First char { · last char }. No markdown. No commentary.`;

// ────────────────────────────────────────────────────────────────────────────
// HANDLER
// ────────────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // Landing-page generation is hosted here (via /api/ai/landing-page rewrite →
  // ?action=landing-page) so it does NOT add a 13th serverless function past the
  // Hobby 12-cap. The core handles its own CORS/method/body.
  if (req.query && req.query.action === 'landing-page') {
    return require('../_shared/landing-page-core.js')(req, res);
  }
  // CORS — allow same-origin + preview deploys
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-gemini-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // Provider waterfall + tier routing live in api/_shared/llm.js. Here we only
  // check that at least one key exists so misconfiguration stays a clean 500
  // (same legacy response shape), and extract the optional per-user Gemini key.
  // Strip BOM and non-ASCII (Vercel env via PowerShell can inject invisible chars).
  const _ck = s => { if (!s) return ''; return s.split('').filter(c => c.charCodeAt(0) < 128).join('').trim(); };
  const userGeminiKey = _ck(req.headers['x-user-gemini-key']);
  const anyKey = userGeminiKey ||
    ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY']
      .some(k => _ck(process.env[k]));
  if (!anyKey) {
    return res.status(500).json({ error: 'server_misconfigured', detail: 'No AI provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, XAI_API_KEY, GROQ_API_KEY, or CEREBRAS_API_KEY.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'invalid_json_body' }); }
  }
  body = body || {};

  const mode = body.mode || 'create_brief';
  const market = body.market || 'US';
  const markets = body.markets || [market];
  const theme = body.theme || body.type || '';
  const campaign_brief = body.campaign_brief || body.brief || body.prompt || '';
  const selected_products = Array.isArray(body.selected_products) ? body.selected_products : [];
  const variant = body.variant || 'A';
  const regenerate_counter = Number(body.regenerate_counter || 0);
  const previous_outputs_summary = body.previous_outputs_summary || '';
  const season = body.season || '';
  // Single mode: premium is the only tier. This is the user-facing content
  // generator (Studio, ads, landing pages), so every mode runs on the highest-
  // accuracy cascade. The Budget / Max Power picker was removed; an incoming
  // body.tier can no longer downgrade. (Background/bulk classifiers live in
  // other files and keep their own cost-appropriate tiers.)
  const tier = 'premium';

  let systemPrompt = SYSTEM_PROMPT_CREATE_BRIEF;
  let userMessage = '';
  let response_format = undefined;

  if (mode === 'suggested_prompts') {
    systemPrompt = SYSTEM_PROMPT_SUGGESTED_PROMPTS;
    response_format = { type: 'json_object' };
    const mktList = Array.isArray(markets) ? markets.join(', ') : market;
    const mktContext = {
      US: 'urban US professionals 30-55, $55+ AOV, values quality and origin story',
      UK: 'UK sneaker-culture audience, appreciate provenance and craft, premium gifters',
      IN: 'Indian domestic audience, value tradition and festivity',
      AU: 'Australian streetwear seekers, outdoor lifestyle, clean-label conscious',
      ME: 'Middle East audience, love rich hand-painted kicks and vibrant colorways',
      EU: 'European health-conscious shoppers, organic-certified, B-Corp story resonates',
      Global: 'International premium audience, discovery-minded, seeking authentic Indian heritage'
    };
    const mktDesc = (Array.isArray(markets) ? markets : [market]).map(m => `${m}: ${mktContext[m] || m}`).join('; ');
    userMessage = `MARKETS TO FOCUS ON: ${mktList}\nMARKET AUDIENCE: ${mktDesc}\nCAMPAIGN TYPE FILTER: ${theme || 'Mixed — generate variety across Sale, Launch, Gift, Seasonal, Bestseller, Routine'}\nSEASON CONTEXT: ${season || 'Year-round'}\n\nGenerate 6 diverse, elite director-grade campaign briefs now. Each must be a different emotional angle and conversion strategy. No two briefs should share the same archetype or hero product. Return only the JSON array.`;
  } else if (mode === 'concepts') {
    systemPrompt = SYSTEM_PROMPT_CONCEPTS;
    response_format = { type: 'json_object' };
    const productsBlock = selected_products.slice(0, 30).map(p => `- handle:${p.handle||p.id||''} | name:${p.name||p.n||''} | category:${p.category||''} | price:${p.price||''} | compare_at:${p.compare_at||''} | image:${p.image_url||p.i||''}`).join('\n');
    userMessage = `BRIEF: ${campaign_brief.substring(0, 800)}\nMARKET: ${market}\nTYPE: ${theme}\nVARIANT: ${variant}\nREGENERATE_COUNTER: ${regenerate_counter}\n${previous_outputs_summary ? 'PREVIOUS_OUTPUT_HASH: ' + previous_outputs_summary + '\n' : ''}\nAVAILABLE_PRODUCTS:\n${productsBlock || '(none provided — use category defaults)'}\n\nGenerate the JSON now.`;
  } else if (mode === 'mailer_full') {
    systemPrompt = SYSTEM_PROMPT_MAILER_FULL + '\n\n' + CF.frameworkMenuDirective();
    response_format = { type: 'json_object' };
    const productsBlock = selected_products.slice(0, 5).map(p => `- name:"${p.name||p.n||''}" | url:"${p.url||p.pdp_url||''}" | price:"${p.price||''}" | compare_price:"${p.compare_at||p.compare_price||''}" | image:"${p.image_url||p.i||''}"`).join('\n');
    userMessage = `INPUTS:\nmarket: ${market}\ntheme: ${theme}\ncampaign_brief: ${campaign_brief.substring(0, 1000)}\nvariant: ${variant}\nregenerate_counter: ${regenerate_counter}\n${previous_outputs_summary ? 'previous_outputs_summary: ' + previous_outputs_summary + '\n' : ''}selected_products:\n${productsBlock || '(none)'}\n\nReturn the strict JSON now.`;
  } else if (mode === 'audience_segment') {
    // Target User Segment generator — director-grade, growth-leader thinking.
    // Output is a paragraph of 60-120 words describing WHO will open this mailer
    // and convert. No bullet points. Plain text only.
    systemPrompt = `You are the Head of Growth at KNICKGASM, a $100M premium D2C Indian heritage sneaker brand. Given a campaign brief, market, and campaign type, write a precise Target User Segment description that the creative team will use to anchor copy, imagery, and CTAs.
WRITE 60–120 WORDS, plain text only (no bullets, no headers, no markdown). Cover, in this order:
1. WHO they are — age band (e.g. "30–55"), income/AOV bracket, role/lifestyle, key sneaker behaviour (daily drinker / gifter / discoverer / lapsed).
2. WHERE they are — name the COUNTRY of the target market only (e.g. "in the US", "in the UK", "in India"). DO NOT name specific cities, states, regions, neighbourhoods, or zip codes — the segment travels nation-wide and must read naturally to a customer in any city of that country.
3. WHAT they value — provenance, ritual, gift-giving, convenience, savings — pick 1–2 that align with the brief.
4. WHY they will convert on THIS specific brief — name the conversion trigger explicitly (offer ends Sunday / new drop just dropped / under $50 gift / 3-month subscription saves 15%).
5. ANTI-SEGMENT — one sentence on who NOT to target (so the creative team avoids generic copy).
HARD RULES:
- COUNTRY ONLY for geography. No city names, no regions ("the Midwest", "the South-East"), no neighbourhoods, no zip codes, no stadium-stat numbers ("12.4M households").
- Avoid demographic stats and percentages — describe behaviour and intent in plain English instead.
- Avoid platitudes ("sneaker lovers", "streetwear enthusiasts"). Reference the actual brief language.
- Specificity comes from BEHAVIOUR ("buys premium grocery weekly", "gifts 3-4 times a year") and TRIGGER ("the 15% off code", "the new drop"), not from city/stat name-dropping.
Return ONLY the segment text. No preamble, no quotes around it, no JSON.`;
    userMessage = `MARKET: ${market}\nCAMPAIGN TYPE: ${theme || 'Bestseller'}\nCAMPAIGN BRIEF:\n${(campaign_brief || '').substring(0, 1200)}\n${body.seed_segment ? 'SEED (refine, do not discard): ' + String(body.seed_segment).substring(0, 400) + '\n' : ''}\nWrite the Target User Segment now. Country-level geography only.`;
  } else if (mode === 'chat') {
    // ─────────────────────────────────────────────────────────────────
    // CHAT — conversational marketing copilot for the Mailer Studio.
    // Plain-text reply. Context (brief / type / markets / current mailer
    // copy) + short history are folded into the single user message so the
    // generic provider waterfall below handles it unchanged.
    // ─────────────────────────────────────────────────────────────────
    const ctx = body.chat_context || {};
    const histArr = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const userMsg = String(body.message || body.prompt || '').slice(0, 2000);
    systemPrompt = [
      'You are KNICKGASM Studio Assistant — a sharp, warm marketing copilot inside the KNICKGASM (premium Indian heritage sneaker) email Mailer Studio.',
      'Help the user brainstorm campaigns, sharpen subject lines and copy, critique the current mailer, and answer marketing questions.',
      'VOICE: warm, sensory, story-driven, premium. PREFER words like ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted.',
      "NEVER use: streetwear journey, transform, liquid lava, game-changer, LIMITED TIME (all caps), hurry, don't miss out, last chance, while supplies last.",
      'Brand palette is deep purple #6A33D8, lava #D0473E, near-black #111111, chalk #F7F5F2. Headings Montserrat, body Instrument Sans.',
      'Be concise and practical. Short paragraphs or tight lists. When asked for copy, give ready-to-paste options. Plain text only — no markdown headers.'
    ].join('\n');
    const ctxLines = [
      ctx.brief ? 'CURRENT CAMPAIGN BRIEF: ' + String(ctx.brief).slice(0, 800) : '',
      ctx.type ? 'CAMPAIGN TYPE: ' + ctx.type : '',
      ctx.markets ? 'MARKETS: ' + (Array.isArray(ctx.markets) ? ctx.markets.join(', ') : ctx.markets) : '',
      ctx.mailerText ? 'CURRENT MAILER COPY (excerpt):\n' + String(ctx.mailerText).slice(0, 1500) : ''
    ].filter(Boolean).join('\n');
    const transcript = histArr.map(m => (m.role === 'assistant' ? 'ASSISTANT' : 'USER') + ': ' + String(m.content || '').slice(0, 1000)).join('\n');
    userMessage = [
      ctxLines ? '--- STUDIO CONTEXT ---\n' + ctxLines + '\n' : '',
      transcript ? '--- CONVERSATION SO FAR ---\n' + transcript + '\n' : '',
      'USER: ' + userMsg,
      '\nReply as the assistant. Plain text.'
    ].filter(Boolean).join('\n');
  } else if (mode === 'autofill') {
    // ─────────────────────────────────────────────────────────────────
    // AUTOFILL — single-prompt → all form fields for the chosen surface.
    // Used by ad-campaigns.html (google/meta/tiktok) and landing-pages.html
    // (lp-mailer/lp-meta/lp-google/lp-tiktok).
    //
    // Input  : { mode:'autofill', surface:'<surface>', prompt:'<plain text>', market?, region? }
    // Output : STRICT JSON object whose keys match the form-field names for
    //          that surface. The frontend reads each key into its corresponding
    //          <input> / <textarea> / <select>.
    //
    // The system prompt is surface-specific because the field schema differs
    // per channel (Google needs keywords + URL, Meta needs audience + primary
    // text, TikTok needs hook + caption + hashtags, landing pages have a
    // hero / sub / offer / notes set).
    // ─────────────────────────────────────────────────────────────────
    response_format = { type: 'json_object' };
    const surface = String(body.surface || '').toLowerCase();
    const userPrompt = String(body.prompt || campaign_brief || '').trim().slice(0, 1600);
    const targetMarket = body.market || body.region || market || 'US';
    const referenceUrl = String(body.reference_url || '').trim();

    // Optional: fetch the reference URL + a tiny snippet of its text so the
    // LLM can mirror the structure/voice. Bounded fetch (5s timeout, 8KB cap).
    let referenceSnippet = '';
    if (referenceUrl && /^https?:\/\//i.test(referenceUrl)) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const rr = await fetch(referenceUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 KnickgasmRef/1.0' },
          signal: ctrl.signal,
          redirect: 'follow',
        }).catch(() => null);
        clearTimeout(t);
        if (rr && rr.ok) {
          const html = (await rr.text()).slice(0, 60000);
          // Strip tags + collapse whitespace
          referenceSnippet = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<head[\s\S]*?<\/head>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 8000);
        }
      } catch { /* ignore — reference is optional */ }
    }

    const BRAND_GUARDRAILS = `BRAND: KNICKGASM — premium D2C sneaker, one-of-one, studio-fresh in 72h, B-Corp.
PALETTE: deep purple #6A33D8 / amber lava #D0473E / chalk #F7F5F2 / black #111111.
BANNED: "streetwear journey", "transform", "liquid lava", "game-changer", "LIMITED TIME" (caps), "hurry", "don't miss out".
PREFERRED: ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted.
COUNTRY-LEVEL geo only. No cities. Currency: $ for US/Global, £ for UK, ₹ for India, € for EU.`;

    const SURFACE_SCHEMAS = {
      google: {
        what: 'a Google Search ad campaign',
        fields: `{
  "name": "<≤60 chars campaign name>",
  "type": "<Search|Performance Max|Display|Shopping|YouTube>",
  "budget": <integer daily budget in market currency, 20-200>,
  "market": "<US|UK|IN|Global|EU|AU|ME>",
  "url": "<final landing URL — start with /, never absolute>",
  "keywords": "<comma-separated 6-12 keywords, lowercase, no quotes>",
  "headlines": "<3-5 headlines, one per line, each ≤30 chars>",
  "desc": "<2 descriptions, one per line, each ≤90 chars>",
  "overlay_headline": "<headline BAKED onto the creative image — ≤6 words, sells the calm/happy end-state (P01), never an ingredient or feature>",
  "overlay_sub": "<supporting line baked under the headline — ≤8 words, sensory + concrete>",
  "offer": "<the EXACT on-creative offer baked into the image — the real P01 offer, e.g. 'Starter Pack · 65% OFF + free gifts'. Concise, ≤40 chars, fits an offer pill.>"
}`,
      },
      meta: {
        what: 'a Meta (Facebook + Instagram) ad campaign',
        fields: `{
  "name": "<≤60 chars campaign name>",
  "obj": "<Sales / Conversions|Traffic|Awareness|Engagement|Leads>",
  "budget": <integer daily budget, 20-200>,
  "market": "<US|UK|IN|Global|EU|AU|ME>",
  "place": "<Advantage+ (all)|Feed|Stories/Reels|Manual>",
  "aud": "<one-sentence audience targeting — interests + lookalike if relevant>",
  "primary": "<primary text, 60-180 chars, emotional + concrete + ends with implicit CTA>",
  "headline": "<≤40 chars headline>",
  "overlay_headline": "<headline BAKED onto the creative image — ≤6 words, sells the calm/happy end-state (P01), never an ingredient or feature>",
  "overlay_sub": "<supporting line baked under the headline — ≤8 words, sensory + concrete>",
  "offer": "<the EXACT on-creative offer baked into the image — the real P01 offer, e.g. 'Starter Pack · 65% OFF + free gifts'. Concise, ≤40 chars, fits an offer pill.>"
}`,
      },
      tiktok: {
        what: 'a TikTok ad campaign',
        fields: `{
  "name": "<≤60 chars campaign name>",
  "obj": "<Web Conversions|Traffic|Reach|App Promotion|Video Views|Lead Generation>",
  "budget": <integer daily budget, 20-200>,
  "market": "<US|UK|IN|Global|AU|ME>",
  "place": "<TikTok In-Feed|Spark Ads|TopView|Pangle Network>",
  "aud": "<one-line audience — interests, age, lifestyle>",
  "hook": "<≤80 chars opener — conversational, sounds native to TikTok, not marketing speak>",
  "caption": "<≤140 chars on-screen text — short phrases separated by · or , >",
  "creator": "<@handle if relevant, else empty string>",
  "hashtags": "<3-6 hashtags space-separated, lowercase, no marketing-speak>",
  "overlay_headline": "<headline BAKED onto the static 9:16 key-frame — ≤6 words, sells the calm/happy end-state (P01), never an ingredient or feature>",
  "overlay_sub": "<supporting line baked under the headline — ≤8 words, sensory + concrete>",
  "offer": "<the EXACT on-creative offer baked into the image — the real P01 offer, e.g. 'Starter Pack · 65% OFF + free gifts'. Concise, ≤40 chars, fits an offer pill.>"
}`,
      },
      'lp-mailer': {
        what: 'a landing page paired with a mailer',
        fields: `{
  "hero": "<hero headline — repeats the mailer's promise verbatim, ≤80 chars>",
  "sub": "<one line of reassurance / detail, ≤140 chars>",
  "offer": "<offer + promo code, e.g. FLASH25 — 25% off this week>",
  "notes": "<2-4 sentences on who lands here, the cohort intent, the conversion trigger>"
}`,
      },
      'lp-meta': {
        what: 'a landing page paired with a Meta ad',
        fields: `{
  "hero": "<≤40 chars hero, must match the ad headline verbatim>",
  "sub": "<one-sentence value prop, matches the ad's promise>",
  "offer": "<offer + promo code>",
  "notes": "<audience · placements · objective · why this offer for them>"
}`,
      },
      'lp-google': {
        what: 'a landing page paired with a Google search ad',
        fields: `{
  "hero": "<the target keyword(s), comma-separated — must appear verbatim on the page>",
  "sub": "<≤30 chars headline that exactly matches the keyword intent>",
  "offer": "<offer or discount>",
  "notes": "<match type · search intent · expected CVR · 2 sentences>"
}`,
      },
      'lp-tiktok': {
        what: 'a landing page paired with a TikTok ad',
        fields: `{
  "hero": "<the video's opening hook, verbatim — conversational, mobile-first>",
  "sub": "<top creator quote or social-proof line>",
  "offer": "<offer + promo code>",
  "notes": "<creator handle · hashtag · audience · 2 sentences>"
}`,
      },
    };

    const schema = SURFACE_SCHEMAS[surface];
    if (!schema) {
      return res.status(400).json({ ok: false, error: `Unknown surface "${surface}". Use one of: ${Object.keys(SURFACE_SCHEMAS).join(', ')}` });
    }

    systemPrompt = `You autofill ${schema.what} from a single user prompt.

${BRAND_GUARDRAILS}

OUTPUT FORMAT — return STRICT JSON ONLY, matching this exact shape (no markdown, no commentary, first character {, last character }):

${schema.fields}

RULES:
- Fill EVERY field with a concrete, on-brand value derived from the prompt.
- If the prompt doesn't specify a value, infer a sensible default from KNICKGASM's brand + the target market.
- Numbers (budget) must be plain integers, not strings.
- Strings must obey the character limits inside <…>.
- Never use the banned phrases.
- COUNTRY-LEVEL geography only.
- Currency in copy must match the market.

Target market for this autofill: ${targetMarket}.`;

    userMessage = `USER PROMPT:\n"""\n${userPrompt}\n"""\n\n${referenceSnippet ? `REFERENCE PAGE (mirror the structure, voice, length, conversion logic — but rewrite for KNICKGASM and the prompt above):\n"""\n${referenceSnippet}\n"""\n\n` : ''}Return the JSON object now. Do not include any text outside the JSON.`;
  } else if (mode === 'landing_page') {
    // FULL AI-written landing page — returns ONE complete, mobile-first HTML
    // document (no JSON). The client previews it in the inline modal and falls
    // back to its deterministic template if this fails. response_format stays
    // null so the model returns raw HTML; scrubDashes runs on the way out.
    const LP_STORE = { US:'https://knickgasm.com', UK:'https://knickgasm.com', IN:'https://knickgasm.in', Global:'https://knickgasm.com', EU:'https://knickgasm.com', AU:'https://knickgasm.com', ME:'https://knickgasm.com' };
    const lpRegion = (body.region || body.market || market || 'US');
    const lpBase = LP_STORE[lpRegion] || LP_STORE.US;
    const lpChannel = String(body.channel || 'landing');
    response_format = undefined;
    systemPrompt = [
      'You are a senior D2C conversion copywriter AND front-end developer for KNICKGASM, premium Indian heritage sneaker (B-Corp, one-of-one, studio-fresh within 72 hours of drop).',
      'Output ONE complete, production-ready, single-file HTML document, from <!doctype html> to </html>, with ALL CSS inline in a <style> block and NO external dependencies (no CDNs, no web fonts, no <script>). Return ONLY the HTML, no commentary before or after, no markdown fences.',
      '',
      'MOBILE-FIRST (hard requirement): design for a 360px phone first, then enhance up.',
      '- Include <meta name="viewport" content="width=device-width, initial-scale=1">.',
      '- Fluid type with clamp(); max-width containers centered; flex/grid that WRAPS on small screens (never fixed multi-column that overflows).',
      '- Tap targets at least 44px tall; body text at least 16px; comfortable line-height.',
      '- A STICKY bottom CTA bar on mobile (position:fixed; bottom:0) with the primary action; hide it on wide screens if it would duplicate.',
      '- Images use max-width:100%; height:auto. No horizontal scroll at any width.',
      '',
      'BRAND RULES (strict):',
      '- Colour palette ONLY: deep purple #6A33D8, lava #D0473E, near-black #111111, chalk #F7F5F2. No other colours.',
      "- Headings in a serif stack: 'Montserrat','Raleway',Georgia,serif. Body in a sans stack: 'Instrument Sans','Helvetica Neue',Arial,sans-serif.",
      '- Voice: warm, sensory, story-driven, premium. Prefer: ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted.',
      "- NEVER use: streetwear journey, transform, liquid lava, game-changer, LIMITED TIME (all caps), hurry, don't miss out, last chance, while supplies last.",
      '- NO founder voice or personal-name sign-offs; the brand speaks as "we". NO medical claims. NO em or en dashes anywhere (use commas, colons or plain hyphens).',
      `- Currency and store links must match the ${lpRegion} market. Primary CTA links point to ${lpBase}/collections/best-sellers (or a more specific collection if the brief implies one). Only use offers/prices given in the brief; invent no discount codes.`,
      '- Do NOT invent specific product names, prices, or product-page (/products/...) URLs. Unless the brief names a product, refer to offerings at category level ("one-of-one Jordan", "coffee collection") and link only to collection pages on the store base above.',
      '',
      CF.frameworkMenuDirective(),
      '',
      'REQUIRED SECTIONS in order: announcement bar (only if an offer exists); header wordmark "V A H D A M"; hero (headline + sub + primary CTA + a product-image placeholder box labelled so the user can drop an image URL); trust strip (one-of-one, studio-fresh 72h, B-Corp); 3 benefit blocks; product/offer block with the exact price/mechanic from the brief; social proof as 2 to 3 tiny personal-story testimonials (not star reviews); a short FAQ (3 Qs); final CTA; footer; and the sticky mobile CTA bar.',
    ].join('\n');
    userMessage = [
      `Channel intent: ${lpChannel} (write for how this channel's visitors arrive). Market: ${lpRegion}. Store base: ${lpBase}.`,
      `Hero headline: ${body.hero || '(write a strong, specific one)'}`,
      `Sub-headline: ${body.sub || '(write a supporting sensory line)'}`,
      `Offer / mechanic: ${body.offer || '(no explicit discount, sell on quality, provenance and ritual)'}`,
      body.notes ? `Extra notes / story / audience: ${body.notes}` : '',
      body.prompt ? `Free-text brief: ${body.prompt}` : '',
      '',
      'Return the complete HTML document now.',
    ].filter(Boolean).join('\n');
  } else {
    // create_brief mode (default)
    systemPrompt = SYSTEM_PROMPT_CREATE_BRIEF + '\n\n' + CF.frameworkMenuDirective();
    // Market context — informs audience psychology and visual direction
    const mktContext = {
      US:     'Urban US professionals 30-55. Value origin story + morning ritual. $55+ AOV. Expect premium provenance, not discounts.',
      UK:     'UK sneaker-culture audience. Provenance and craft matter. Premium gifting occasion. Appreciate studio names and drop seasons.',
      IN:     'Indian domestic audience. Value tradition, festivity, hand-painted kicks culture. Gifting + family occasions drive purchase.',
      AU:     'Australian streetwear seekers. Outdoor lifestyle, clean-label conscious. Ethical sourcing story resonates strongly.',
      ME:     'Middle East audience. Love rich hand-painted kicks and vibrant colorways. Gifting occasions, premium packaging, bold designs.',
      EU:     'European health-conscious shoppers. B-Corp + organic certification resonates. Provenance and sustainability over price.',
      Global: 'International premium audience. Discovery-minded. Seeking authentic Indian heritage and origin stories.'
    };
    const audienceCtx = mktContext[market] || `${market} market audience`;

    // Product block — name + price + discount % + image URL so the LLM can build a genuine product system
    const productsBlock = selected_products.length
      ? selected_products.slice(0, 6).map(p => {
          const name = p.name || p.n || '';
          const price = parseFloat(p.price) || 0;
          const compareAt = parseFloat(p.compare_at || p.compare_price) || 0;
          const imgUrl = p.image_url || p.i || '';
          const parts = [name];
          if (price) parts.push('$' + price.toFixed(2));
          if (compareAt && compareAt > price) {
            const disc = Math.round((1 - price / compareAt) * 100);
            parts.push('was $' + compareAt.toFixed(2) + ' (' + disc + '% off)');
          }
          if (p.category || p.type) parts.push(p.category || p.type);
          if (imgUrl) parts.push('image: ' + imgUrl);
          return '- ' + parts.join(' | ');
        }).join('\n')
      : null;

    // Variation knobs — different "angle" for each regen so consecutive
    // clicks give the user a genuinely different brief, not a paraphrase.
    const ANGLES = [
      'lead with the OFFER — discount %, urgency, code',
      'lead with the HERO PRODUCT — what makes this specific box special',
      'lead with the AUDIENCE MOMENT — the daily ritual the buyer is craving',
      'lead with the ORIGIN STORY — where the leaves come from',
      'lead with the SOCIAL PROOF — what tens of thousands of customers already know',
      'lead with the SEASONAL HOOK — why right now, this week',
      'lead with the PROBLEM-SOLUTION — what the buyer is silently trying to fix'
    ];
    const angle = ANGLES[(Number(regenerate_counter)||0) % ANGLES.length];
    const creativitySeed = body.creativity_seed || (Math.random().toString(36).slice(2,10));
    const userAudience = (body.target_audience || '').toString().substring(0,400);
    userMessage = [
      `CAMPAIGN TYPE: ${theme || 'General Campaign'}`,
      `MARKET: ${market} — ${audienceCtx}`,
      `SEED IDEA FROM USER: ${campaign_brief || '(none provided — derive a strong, specific campaign concept from the campaign type and market above)'}`,
      userAudience ? `TARGET AUDIENCE (already set by user — the brief MUST speak to this segment):\n${userAudience}` : '',
      productsBlock
        ? `PRODUCTS FROM THE LIVE KNICKGASM CATALOG (use EXACT names and prices verbatim — do NOT invent SKUs or prices):\n${productsBlock}`
        : `PRODUCTS: (none provided). Do NOT invent specific product names, prices, or URLs. Refer to KNICKGASM offerings at CATEGORY level only (for example "our one-of-one Jordan", "an coffee collection", "a embroidery themed sneaker") — no fabricated SKU names, no made-up prices, no product links.`,
      ``,
      `THIS GENERATION'S CREATIVE ANGLE: ${angle}.`,
      `CREATIVITY SEED: ${creativitySeed} — use this to deliberately diverge from any previous brief you've drafted for KNICKGASM. Different headline phrasing, different hero pick when sensible, different subject-line angles, different opening sentence.`,
      `REGENERATION #${regenerate_counter || 0}: each regeneration must read as a FRESH brief, not a paraphrase of the last one.`,
      ``,
      `HARD RULES:`,
      `1. Use ONLY the catalog products listed above. Reference them by EXACT name and EXACT price. Do not invent product names, do not invent or round prices, do not promote SKUs that are not in the list.`,
      `2. The hero product MUST be one of the products listed.`,
      `3. Geography in copy is COUNTRY-LEVEL only — say "the US" or "the UK" or "India". Do NOT name specific cities, states, regions, neighbourhoods, or zip codes. The brief travels nation-wide.`,
      `4. No demographic stats or percentages of the population. Describe BEHAVIOUR and INTENT in plain English.`,
      `5. Currency in copy must match the market: $ for US/Global, £ for UK, ₹ for India, € for EU, A$ for AU, AED for ME. Never mix currencies.`,
      `6. Honor the existing TARGET AUDIENCE block above (if present) — write the brief to land with THAT segment.`,
      ``,
      `Write the brief as flowing prose — no section headers, no numbered lists, no labeled fields.`,
      `Weave in all 12 elements naturally: campaign name, goal, hook (per the angle above), hero product (real catalog name), supporting products (real catalog names), audience insight (country-level), 3 subject lines, announcement bar text, two headline variants, two image directions (50 words each with surface/light/camera detail), CTA, and tone.`,
      `Every sentence must be specific to THIS campaign — generic output is rejected.`
    ].filter(Boolean).join('\n');
  }

  // ── Portable prompt ─────────────────────────────────────────────────────
  // The exact, self-contained instructions this tool used. Returned with EVERY
  // creation so the user can paste it into ChatGPT / Gemini / Claude and get the
  // same on-brand output externally. (The app itself generates on free tiers.)
  const _sp = Array.isArray(systemPrompt) ? systemPrompt.join('\n') : String(systemPrompt || '');
  const _um = Array.isArray(userMessage) ? userMessage.join('\n') : String(userMessage || '');
  const portable_prompt = (_sp + (_um ? '\n\n———\n\n' + _um : '')).trim();

  // ── Provider-specific call ──
  // Higher base temperature for create_brief + a per-regen bump so consecutive
  // briefs explore different copy territory (different hooks, different headline
  // phrasing). Caps at 1.1 to stay coherent.
  const baseTemp = mode === 'create_brief' ? 0.85 : 0.7;
  const temperature = Math.min(1.1, baseTemp + Math.min(0.25, (regenerate_counter || 0) * 0.08));
  // create_brief: 4000 tokens for 450-600 word detailed production brief with full structure
  const max_tokens = (mode === 'mailer_full' || mode === 'landing_page') ? 7000 : (mode === 'concepts' ? 4500 : (mode === 'suggested_prompts' ? 3000 : (mode === 'chat' ? 1200 : 4000)));

  // ── Active-brand override (Universal Brand Platform) ───────────────────────
  // The system prompts above are written for tenant zero. When the caller has
  // an active brand workspace, prepend that brand's constraint block and say
  // explicitly that it SUPERSEDES any brand named later in the prompt — so a
  // custom workspace gets its own identity, palette, typography, voice and
  // regions in the generated asset rather than tenant zero's. One insertion
  // point covers every mode. No active brand means no change at all.
  try {
    const _b = body && body.__brand;
    if (_b && _b.id) {
      const _rt = require('../_shared/brand-runtime.js');
      systemPrompt = [
        'OPERATIVE BRAND — this block OVERRIDES every brand name, palette, typeface, product,',
        'claim, URL and voice rule mentioned anywhere later in this prompt. Any other brand named',
        'below is an EXAMPLE OF FORM ONLY; never name it, never use its colours or products.',
        '',
        _rt.brandBlock(_b),
        '',
        '--- The rest of this prompt describes the TASK and the OUTPUT FORMAT. Follow its structure,',
        'but express everything as the operative brand above. ---',
        '',
        systemPrompt,
      ].join('\n');
    }
  } catch (_) { /* fall through to the shipped prompt rather than failing */ }

  // ── Shared tier-routed cascade (api/_shared/llm.js) ────────────────────────
  // The 6-provider waterfall (OpenAI/Anthropic/Gemini/Grok/Groq/Cerebras),
  // key rotation, demotion rules, and APP_AI_PROVIDER preference all live in
  // llm.js now. We map its result/throw back onto the legacy `result` shape so
  // every downstream branch (heuristic fallback, error mapping, JSON parse,
  // autofill creative_spec) is preserved exactly.
  let result = null;

  try {
    try {
      const out = await callLLM({
        systemPrompt,
        userMessage,
        responseFormat: response_format || null,
        maxTokens: max_tokens,
        temperature,
        timeoutMs: 30000,
        stage: 'generate:' + mode,
        tier,
        userGeminiKey,
      });
      result = { ok: true, text: out.text, provider: out.provider, model: out.model };
    } catch (llmErr) {
      // All providers failed (or a plain-400 bad request aborted the cascade).
      // Reconstruct the legacy failure result from the last provider error.
      const perr = Array.isArray(llmErr && llmErr._providerErrors) ? llmErr._providerErrors : [];
      const last = perr[perr.length - 1] || null;
      result = {
        ok: false,
        status: last ? (last.status || 0) : 0,
        error: last && last.provider ? (last.provider + '_error') : 'no_provider',
        detail: String((last && last.err) || (llmErr && llmErr.message) || 'All providers failed').substring(0, 400),
        provider: last ? last.provider : null,
        model: null,
        ...(last && last.status === 429 ? { retry_after: 30 } : {}),
      };
    }

    if (!result || !result.ok) {
      // ── HEURISTIC FALLBACK for create_brief mode ─────────────────────────
      // When all providers fail, generate a structured brief from inputs so the
      // "Enhance with AI" button always returns something useful.
      if (mode === 'create_brief') {
        console.warn('[generate] All providers failed for create_brief — using heuristic fallback');
        const typeMap = { Sale: 'conversion-focused flash sale', Launch: 'new product launch', Gift: 'premium gifting', Seasonal: 'seasonal campaign', Bestseller: 'bestseller showcase', Story: 'brand storytelling', Routine: 'daily ritual', Discovery: 'product discovery' };
        const typeDesc = typeMap[theme] || theme || 'premium campaign';
        const mktMap = { US: 'US professionals 30-55', UK: 'UK sneaker lovers', IN: 'Indian consumers', AU: 'Australian streetwear seekers', ME: 'Middle East audience', EU: 'European premium shoppers', Global: 'global audience' };
        const audience = mktMap[market] || 'premium sneaker audience';
        const prodNames = selected_products.slice(0, 3).map(p => p.name || p.n || '').filter(Boolean);
        const heroProduct = prodNames[0] || 'KNICKGASM Signature Collection';
        const supportProducts = prodNames.slice(1).join(' and ') || 'complementary streetwear colorways';

        const offerMatch = campaign_brief.match(/(\d{1,2})\s*%/);
        const offerPct = offerMatch ? offerMatch[1] : '20';
        const codeMatch = campaign_brief.match(/(?:code|coupon)\s+([A-Z0-9]{4,15})/i);
        const promoCode = codeMatch ? codeMatch[1].toUpperCase() : 'KNICKGASM' + offerPct;

        const heuristicBrief = `Our next ${typeDesc} targets ${audience}, aiming for an AOV exceeding $55 by leveraging the unmatched premium provenance of our one-of-one sneakers. We're leading with a compelling offer: experience the crisp clarity of our finest sneakers with up to ${offerPct}% off for a limited time using code ${promoCode}. This isn't just a discount: it's an invitation to elevate your daily ritual with studio-fresh sneakers, picked and packed within 72 hours of drop.\n\nOur hero product anchoring this campaign is ${heroProduct}, a one-of-one jewel perfect for a discerning morning ritual. To build a richer basket we'll feature ${supportProducts} as supporting products. These selections offer variety and cater to both the ritualistic black sneaker drinker and the health-conscious individual.\n\nOur audience craves moments of calm and intentionality. They're seeking authenticity and connection, a premium experience that integrates into their demanding lives. A truly authentic sneaker with a clear origin story tips them towards purchase.\n\nFor subject lines, test these: Your Morning Ritual, Elevated. | ${offerPct}% Off Premium Sneakers, Limited Time. | Freshness From The studio archives Awaits.`;

        return res.status(200).json({
          ok: true, mode, provider: 'heuristic', model: 'fallback-v1', text: brandScrub(heuristicBrief),
          portable_prompt,
          _heuristic: true,
          _llm_error: String((result && result.detail) || 'All providers failed').substring(0, 200)
        });
      }

      const is429 = result && result.status === 429;
      // Never forward Gemini/OpenAI's 404 (model not found) as our response status —
      // that confuses clients into thinking the endpoint doesn't exist. Use 503 instead.
      const clientStatus = !result ? 500
        : result.status === 404 ? 503
        : (result.status || 500);
      return res.status(clientStatus).json({
        error: result ? result.error : 'no_provider',
        detail: result ? result.detail : 'All providers failed',
        provider: result ? result.provider : null,
        model: result ? result.model : null,
        // Include retry_after so the frontend can show a countdown and auto-retry
        ...(is429 ? { retry_after: result.retry_after || 30, rate_limited: true } : {})
      });
    }

    const text = result.text || '';
    if (mode === 'concepts' || mode === 'mailer_full' || mode === 'suggested_prompts') {
      let parsed;
      // Robust JSON extraction: handles markdown fences, prose prefix/suffix (Gemini habit)
      const tryParse = (t) => {
        try { return JSON.parse(t); } catch (_) {}
        const s = t.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/m, '').trim();
        try { return JSON.parse(s); } catch (_) {}
        const bs = t.indexOf('{'), be = t.lastIndexOf('}');
        if (bs !== -1 && be > bs) { try { return JSON.parse(t.slice(bs, be + 1)); } catch (_) {} }
        // Also try array extraction for suggested_prompts
        const as = t.indexOf('['), ae = t.lastIndexOf(']');
        if (as !== -1 && ae > as) { try { return JSON.parse(t.slice(as, ae + 1)); } catch (_) {} }
        return null;
      };
      parsed = tryParse(text);
      if (!parsed) {
        return res.status(502).json({ error: 'json_parse_failed', provider: result.provider, raw: text.substring(0, 600) });
      }

      // ── Quality loop (mailer_full only, additive) ─────────────────────────
      // Bounded critique→revise pass (score on 'fast'; one 'premium' revision
      // if overall < 7; 25s hard time-box). Skip-on-error by design — the
      // response shape only GAINS a `quality` field, it never fails or changes.
      if (mode === 'mailer_full') {
        let data = parsed;
        let quality = null;
        try {
          const ql = require('../_shared/quality-loop.js');
          const out = await ql.runQualityLoop({ spec: parsed, brief: userMessage, userGeminiKey });
          data = out.spec || parsed;
          quality = out.quality || null;
        } catch (qe) {
          console.warn('[generate] quality loop unavailable: ' + String(qe && qe.message || qe).slice(0, 120));
        }
        return res.status(200).json({
          ok: true, mode, provider: result.provider, model: result.model, data: deepScrubDashes(data, body && body.__brand), portable_prompt,
          ...(quality ? { quality } : {})
        });
      }

      return res.status(200).json({ ok: true, mode, provider: result.provider, model: result.model, data: deepScrubDashes(parsed, body && body.__brand), portable_prompt });
    }

    // ── Autofill on an ad surface: also return the portable master_prompt and a
    //    structured creative_spec the compositor can render. creative_spec lists
    //    the EXACT static sizes ad-campaigns.html composites, each carrying the
    //    LLM-authored overlay copy (headline/sub) + the real P01 offer — so the
    //    canvas stops hardcoding 'Shop now'. Non-ad surfaces are unaffected.
    if (mode === 'autofill') {
      const surf = String(body.surface || '').toLowerCase();
      if (AD_FORMATS[surf]) {
        let fields = {};
        try { fields = JSON.parse(text); } catch (_) {
          const a = text.indexOf('{'), b = text.lastIndexOf('}');
          if (a !== -1 && b > a) { try { fields = JSON.parse(text.slice(a, b + 1)); } catch (_) {} }
        }
        fields = deepScrubDashes(fields, body && body.__brand);
        const overlay = {
          headline: fields.overlay_headline || '',
          sub: fields.overlay_sub || '',
          offer: fields.offer || '',
        };
        const creative_spec = AD_FORMATS[surf].map((f) => ({ size: f.size, format: f.format, ar: f.ar, overlay }));
        const targetMarket = body.market || body.region || market || 'US';
        const userPrompt = String(body.prompt || campaign_brief || '').trim().slice(0, 1600);
        const master_prompt = buildMasterPrompt({ brand: (body && body.__brand) || null,  assetType: 'ad', platform: surf, market: targetMarket, brief: userPrompt });
        return res.status(200).json({ ok: true, mode, provider: result.provider, model: result.model, text: brandScrub(text), creative_spec, master_prompt, portable_prompt });
      }
    }

    return res.status(200).json({ ok: true, mode, provider: result.provider, model: result.model, text: brandScrub(text), portable_prompt });

  } catch (e) {
    return res.status(500).json({ error: 'server_error', provider: 'cascade', detail: String(e && e.message || e).substring(0, 300) });
  }
};

// ── Multi-tenant + metering (Universal Brand Platform) ──────────────────────
// Two cross-cutting concerns are applied here rather than threaded through the
// long handler above:
//   1. BRAND. buildMasterPrompt() now accepts the caller's active brand, so a
//      custom workspace gets prompts built from ITS identity, palette, fonts,
//      voice and regions instead of tenant zero's. Resolution is cached and
//      falls back to the shipped brand, so behaviour is unchanged when no
//      workspace is active.
//   2. CREDITS. Declaring a price is not the same as charging it, so the
//      handler is wrapped by the meter. Each mode maps to its catalog key;
//      read-only/cheap conversational modes map to the assistant key.
const _credits = require('../_shared/credits-core.js');
const _brandRuntime = require('../_shared/brand-runtime.js');

const MODE_FEATURE = {
  create_brief: 'mailer.brief',
  concepts: 'mailer.concepts',
  mailer_full: 'mailer.generate',
  landing_page: 'landing.generate',
  autofill: 'ads.generate',
  audience_segment: 'analytics.narrative',
  suggested_prompts: 'assistant.chat',
  chat: 'assistant.chat',
};

const _rawHandler = module.exports;

async function _brandAwareHandler(req, res) {
  // Resolve once per request and hand it to the prompt builder via the body,
  // which every prompt site in this file already reads from.
  try {
    if (req.body && typeof req.body === 'object') {
      req.body.__brand = await _brandRuntime.resolve(req);
    }
  } catch (_) { /* tenant zero */ }
  return _rawHandler(req, res);
}

module.exports = _credits.metered(
  _brandAwareHandler,
  (req, body) => {
    if (req.query && req.query.action === 'landing-page') return 'landing.generate';
    return MODE_FEATURE[body.mode || 'create_brief'] || 'assistant.chat';
  }
);
