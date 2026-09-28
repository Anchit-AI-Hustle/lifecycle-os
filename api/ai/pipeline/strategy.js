'use strict';
// ════════════════════════════════════════════════════════════════════════════
// /api/ai/pipeline/strategy  — Stage 1: Master Strategic Lock
//
// Runs FIRST. Locks audience truth, product selection, strategy type, vibe,
// theme, structure and the two variant concepts; downstream stages execute.
//
// Gated, metered and brand-derived through api/_shared/pipeline-core.js since
// 2026-09-28 (see its header for what executing this stage found). The prompt
// is built from the ACTIVE brand's record plus the asset contract and the
// evidence block; nothing in it names a tenant, a palette hex or a "learning
// from real performance data" that no data supports.
//
// POST body:  { brief, market?, type?, products[], mailer_type?, evidence?,
//               regenerate_counter? }
// Response:   { ok, stage, provider, model, strategic_lock, product_selection,
//               strategy_type, strategy, reasoning, vibe, theme, structure,
//               image_style_lock, variant_a_concept, variant_b_concept,
//               variant_divergence_contract, credits }
// ════════════════════════════════════════════════════════════════════════════

const P = require('../../_shared/pipeline-core.js');

/**
 * The two colour approaches are DERIVED, so the strings the model is asked to
 * echo can never carry another brand's hexes. Variant A opens on the surface;
 * Variant B opens on the primary. When the primary is light, B still opens on
 * it and diverges by structure (full-bleed, narrative-first) rather than by
 * luminance - the rule that no section is a dark neutral outranks "dark".
 */
function approaches(t) {
  return {
    A: `light: background ${t.surface}, text ${t.onSurface}, accent ${t.accent}`,
    B: `inverted: background ${t.primary} for the opening sections, text ${t.onPrimary}, accent ${t.accent} (opposite of A)`,
  };
}

function systemPrompt(ctx) {
  const b = ctx.brand;
  const t = ctx.tokens;
  const ap = approaches(t);
  const typeNote = ctx.mailerType === 'text'
    ? 'This mailer is the TEXT type: pure typographic, no photographs. Every visual cue is type, colour and space.'
    : 'This mailer is the TEXT + GRAPHICS type: typography plus built graphic elements, with photograph slots the operator fills.';
  return `You are a Creative Director and Director of Growth for ${b.name}. You do NOT write the mailer. You THINK, then you LOCK every decision so the downstream stages can execute with zero ambiguity.

${ctx.briefing}

${typeNote}

━━ PHASE 1 — STRATEGIC LOCK (before any creative) ━━
STEP 1 — AUDIENCE AND BUSINESS TRUTH. From the brief only: audience_truth (a specific behavioural insight about THIS audience now, not a generic one), business_goal (the ONE measurable thing this mailer must achieve), purchase_barrier, conversion_trigger. If the brief does not support an insight, say so in the field rather than inventing one.
STEP 2 — PRODUCT SELECTION. Only from the products supplied. hero_product resolves the purchase_barrier; supporting max 3, each with a role. If no products were supplied, the hero is the DATA REQUIRED marker, never a guess.
STEP 3 — STRATEGY TYPE. Exactly one of "Conversion Push", "Repeat Purchase", "AOV Expansion", "Brand Building". Justify it for THIS audience and goal.
STEP 4 — VIBE. emotional_tone, pace, visual_energy, positioning, avoid - all specific to this brief and this brand's voice.
STEP 5 — THEME. name (2-4 words, ownable), core_idea, emotional_driver, conversion_logic, visual_world (a scene a photographer could execute: surface, light direction, time of day, one unusual compositional choice; no text in frame).
STEP 6 — STRUCTURE LOCK. sections[] in order (from: announcement_bar, brand_header, hero, narrative, context, product_reveal, benefit_strip, social_proof, lifestyle_moment, origin_proof, offer_bar, cta, footer), layout_rules, visual_system. Max 7 content sections. This is FINAL.

━━ PHASE 2 — TWO EXECUTION CONTRACTS, STRUCTURALLY OPPOSITE ━━
VARIANT A — CONTROL: product visible in the first content section; hero → benefits → proof → offer → CTA; copy precise and benefit-led; split or centred hero; color_approach "${ap.A}".
VARIANT B — EXPERIMENTAL: no product in the first two sections; narrative or lifestyle opens; copy sensory and evocative; full-bleed editorial layout; ghost or text-link CTA; a different template_key from A; a different time of day in hero_scene; color_approach "${ap.B}".
If B resembles A on any of these, rewrite B from a different emotional entry point before answering.

━━ RULES THAT OUTRANK EVERYTHING ABOVE ━━
- An offer, a price, a code, a shipping threshold, a rating, a review count or a testimonial appears ONLY if it was supplied in the brief or the products. None supplied means none written; use the DATA REQUIRED marker where the structure needs one.
- Every section must earn its place; no filler. Max 3 products in the product section.
- Use only the palette, typography, claims and voice in the BRAND block. Never a colour or font from anywhere else.

OUTPUT: STRICT JSON ONLY - first character {, last character }. No markdown, no commentary.
SCHEMA (all fields required):
{
  "strategic_lock": { "audience_truth": "", "business_goal": "", "purchase_barrier": "", "conversion_trigger": "" },
  "product_selection": {
    "hero": { "name": "exact name from the supplied list, or the DATA REQUIRED marker", "handle": "", "why": "" },
    "supporting": [{ "name": "", "handle": "", "role": "AOV / expansion / system", "why": "" }],
    "product_system": "", "aov_logic": ""
  },
  "strategy_type": "Conversion Push | Repeat Purchase | AOV Expansion | Brand Building",
  "strategy": "", "reasoning": "",
  "vibe": { "emotional_tone": "", "pace": "", "visual_energy": "", "positioning": "", "avoid": "" },
  "theme": { "name": "", "core_idea": "", "emotional_driver": "", "conversion_logic": "", "visual_world": "" },
  "structure": {
    "sections": ["announcement_bar", "brand_header", "hero", "benefit_strip", "product_reveal", "offer_bar", "footer"],
    "layout_rules": "",
    "visual_system": { "color_palette": "", "typography": "", "spacing_rhythm": "", "image_style": "" }
  },
  "image_style_lock": "50-70 words: camera, light source, surface, depth of field, colour temperature, compositional energy - ownable to this brief",
  "variant_a_concept": { "emotional_angle": "", "headline_register": "", "template_key": "launch | sale | story | gift | routine | discovery | bestseller | seasonal | editorial | founder", "color_approach": "${ap.A}", "opening_section": "hero (product visible in section 1)", "hero_scene": "" },
  "variant_b_concept": { "emotional_angle": "", "headline_register": "", "template_key": "must differ from A", "color_approach": "${ap.B}", "opening_section": "narrative or lifestyle (no product in the first 2 sections)", "hero_scene": "" },
  "variant_divergence_contract": { "layout_difference": "", "color_difference": "", "copy_difference": "", "section_order_difference": "", "product_treatment_difference": "" }
}`;
}

function userMessage(ctx, o) {
  const campaignType = o.type || 'Campaign';
  const campaignName = o.brief
    ? (o.brief.split(/[.!?\n]/)[0].trim().substring(0, 80) || (campaignType + ' · ' + ctx.market))
    : (campaignType + ' · ' + ctx.market);
  const store = ctx.store;
  return `CAMPAIGN: ${campaignName}
BRIEF: ${o.brief || '(no brief supplied - derive the objective from the campaign type and the market, and say in strategic_lock that the brief was empty)'}
OBJECTIVE: ${o.type ? o.type + ' campaign' : 'derive from the brief'} for the ${ctx.market || 'home'} market
MARKET: ${ctx.market || P.marker('home market', ctx.brand.name)} · store ${store.url || store.marker}${store.currency ? ` · currency ${store.currency}` : ''}
PRODUCTS AVAILABLE (the only ones that exist for this mailer):
${P.productLines(o.products, ctx, { max: 15 })}
${o.regenerate_counter > 0 ? `\nREGENERATE #${o.regenerate_counter}: every field must differ from the previous run - new hero scene, new emotional angle, different strategy emphasis, different product selection if the list allows.` : ''}

Run Phase 1 then Phase 2 now. Think before locking. Every field matters.`;
}

/**
 * Divergence is enforced here as well as asked for. The colour check reads the
 * DERIVED approach strings, so it holds for any brand rather than for the one
 * whose hexes used to be hardcoded in the comparison.
 */
function enforceDivergence(parsed, ctx) {
  const ap = approaches(ctx.tokens);
  const a = parsed.variant_a_concept || {};
  const b = parsed.variant_b_concept || {};
  const issues = [];
  if (a.emotional_angle && a.emotional_angle === b.emotional_angle) issues.push('same emotional_angle');
  if (a.headline_register && a.headline_register === b.headline_register) issues.push('same headline_register');
  if (a.template_key && a.template_key === b.template_key) issues.push('same template_key');
  if (a.opening_section && a.opening_section === b.opening_section) issues.push('same opening_section');
  const aInverted = /^inverted/i.test(String(a.color_approach || ''));
  const bLight = /^light/i.test(String(b.color_approach || ''));
  if (aInverted) issues.push('Variant A specified the inverted colour approach; it must be light');
  if (bLight) issues.push('Variant B specified the light colour approach; it must be inverted');
  if (issues.length) parsed._divergence_warning = 'Divergence issues: ' + issues.join('; ') + '. Downstream variant stage will enforce separation.';

  if (!a.color_approach || aInverted) a.color_approach = ap.A;
  if (!b.color_approach || bLight) b.color_approach = ap.B;
  if (!b.opening_section || b.opening_section === a.opening_section || /hero/i.test(String(b.opening_section))) {
    b.opening_section = 'narrative or lifestyle (no product in the first 2 sections)';
  }
  parsed.variant_a_concept = a;
  parsed.variant_b_concept = b;

  if (!parsed.strategy_type && parsed.strategy) {
    const s = String(parsed.strategy).toLowerCase();
    parsed.strategy_type = /conversion|sale|discount/.test(s) ? 'Conversion Push'
      : /repeat|habit|routine/.test(s) ? 'Repeat Purchase'
        : /aov|bundle|expand/.test(s) ? 'AOV Expansion' : 'Brand Building';
  }
  return parsed;
}

/**
 * The strategy written without a model, from the brief and the brand record
 * only. It names no product the caller did not supply, no offer, no figure and
 * no scene borrowed from another category; the hero with no products is the
 * marker, carried as `placeholder: true` so nothing downstream string-matches.
 */
function heuristic(ctx, o, err) {
  const b = ctx.brand;
  const t = ctx.tokens;
  const ap = approaches(t);
  const market = ctx.market || 'all';
  const name = (p) => p.name || p.n || p.title || P.marker('product name', b.name, market);
  const handle = (p) => p.handle || p.h || p.id || '';
  const products = Array.isArray(o.products) ? o.products.filter(Boolean) : [];
  const hero = products[0]
    ? { name: name(products[0]), handle: handle(products[0]), why: 'First product supplied for this brief; it anchors the mailer.' }
    : { name: P.marker('hero product', b.name, market), handle: '', why: 'No product was supplied, so the hero slot is a gap to fill, not a guess.', placeholder: true };
  const supporting = products.slice(1, 4).map((p) => ({ name: name(p), handle: handle(p), role: 'AOV expansion', why: 'Supplied alongside the hero; extends the order.' }));

  const briefWords = (o.brief || `${b.name} campaign`).trim();
  const isGifting = /gift|birthday|anniversary|occasion/i.test(briefWords);
  const isSale = /sale|discount|offer|deal|code|clearance|% off/i.test(briefWords);
  const stratType = isSale ? 'Conversion Push' : isGifting ? 'AOV Expansion' : 'Brand Building';
  const heroName = hero.name;

  return {
    ok: true, provider: 'heuristic', model: 'fallback-v2', stage: 'strategy',
    _heuristic: true,
    _llm_error: String((err && err.message) || err || '').substring(0, 300),
    provider_errors: (err && err._providerErrors) || [],
    strategic_lock: {
      audience_truth: `Readers in ${market} who have shown interest in ${b.name} and have not acted on this brief yet. No behavioural data was attached, so nothing more specific is claimed.`,
      business_goal: `Qualified clicks and orders in ${market} for: ${briefWords.substring(0, 80)}`,
      purchase_barrier: 'No stated reason to act today. The mailer supplies one from the brief and any supplied offer, never from an invented claim.',
      conversion_trigger: isSale ? 'The supplied offer, shown above the fold with its terms.'
        : isGifting ? `A clear gifting use for ${heroName}.`
          : `A specific reason ${heroName} fits right now, drawn from the brief.`,
    },
    product_selection: {
      hero,
      supporting,
      product_system: supporting.length ? 'The hero carries the story; the supporting products extend the order.' : 'One product carries the whole mailer.',
      aov_logic: supporting.length ? 'Hero plus one supporting product read as a set.' : 'No supporting products were supplied, so no bundle is proposed.',
    },
    strategy_type: stratType,
    strategy: `${stratType} for the ${market} market, written from the brief "${briefWords.substring(0, 50)}" and the brand voice.`,
    reasoning: `${stratType} fits because the brief ${isSale ? 'carries an offer, so value and a clear deadline convert' : isGifting ? 'names an occasion, so a set reads as a considered gift' : 'names no offer, so the brand story and the product itself do the work'}. Every claim in the mailer comes from the brand record or the supplied products.`,
    vibe: {
      emotional_tone: isGifting ? 'warm and considered' : isSale ? 'clear and decisive' : 'confident and specific',
      pace: isSale ? 'fast and punchy; the offer leads' : 'measured and editorial; the story leads',
      visual_energy: 'Natural light, real surfaces, one subject in frame, no clutter.',
      positioning: `${b.name} as ${b.tagline ? b.tagline : 'the specific choice for this reader'}`,
      avoid: 'Stock imagery, generic superlatives, any figure or review that was not supplied, any phrase in the banned list.',
    },
    theme: {
      name: briefWords.split(/\s+/).slice(0, 4).join(' '),
      core_idea: `${heroName}, made specific for the person reading.`,
      emotional_driver: isGifting ? 'The reader feels they have chosen well for someone.' : 'The reader feels this was written for them, not for a segment.',
      conversion_logic: stratType === 'Conversion Push' ? 'The offer removes hesitation and the deadline resolves it.' : 'Specific detail makes the product feel chosen rather than sold.',
      visual_world: 'The hero product on a plain surface in soft natural side light, shallow depth of field, one supporting prop at most, warm colour temperature, an off-centre overhead angle. No text in frame.',
    },
    structure: {
      sections: ['brand_header', 'hero', 'benefit_strip', 'product_reveal', 'social_proof', 'cta', 'footer'],
      layout_rules: `Single column, ${P.MAILER.desktop.contentWidth}px content column, CTA visible in the first scroll, product section max 3 items.`,
      visual_system: {
        color_palette: `Primary ${t.primary} · accent ${t.accent} · surface ${t.surface} · text ${t.ink}. Variant A opens on the surface; Variant B opens on the primary.`,
        typography: `Headings ${t.headingStack}; body ${t.bodyStack}.`,
        spacing_rhythm: 'Section padding 24-32px; 16px between elements; no section under 100px of useful content.',
        image_style: 'Editorial photography, natural light, shallow depth of field, no stock look. Photographs only where the operator supplies them.',
      },
    },
    image_style_lock: 'Medium-format look, 80mm equivalent, natural window light at 4500K, shallow depth of field around f/2.8, tactile surfaces, one hero subject and at most one prop, no text or logo in frame.',
    variant_a_concept: {
      emotional_angle: 'Direct confidence; the product speaks first.',
      headline_register: 'Direct, benefit-led, declarative.',
      template_key: isSale ? 'sale' : isGifting ? 'gift' : 'bestseller',
      color_approach: ap.A,
      opening_section: 'hero (product visible in section 1)',
      hero_scene: `${heroName} centred on a plain light surface, morning side light from the left, shallow focus, soft shadow. Overhead, slightly off centre.`,
    },
    variant_b_concept: {
      emotional_angle: 'Atmosphere first; the reader feels the setting before seeing the product.',
      headline_register: 'Sensory, indirect, place-anchored.',
      template_key: isSale ? 'story' : 'editorial',
      color_approach: ap.B,
      opening_section: 'narrative or lifestyle (no product in the first 2 sections)',
      hero_scene: `Late-afternoon light across a lived-in space, ${heroName} secondary to the mood, full-bleed composition, warm haze, no studio feel.`,
    },
    variant_divergence_contract: {
      layout_difference: 'A: centred product hero; B: full-bleed editorial with generous space.',
      color_difference: `A opens on ${t.surface}; B opens on ${t.primary}.`,
      copy_difference: 'A is direct and benefit-specific; B is sensory and narrative.',
      section_order_difference: 'A opens hero then product; B opens narrative then lifestyle then product.',
      product_treatment_difference: 'A: product grid in section 1; B: single editorial reveal after section 2.',
    },
  };
}

async function handler(req, res) {
  const ctx = await P.admit(req, res);
  if (!ctx) return;
  const body = ctx.body;
  const o = {
    brief: String(body.brief || '').substring(0, 700),
    type: String(body.type || ''),
    products: Array.isArray(body.products) ? body.products : [],
    regenerate_counter: Number(body.regenerate_counter) || 0,
  };
  ctx.tokens = P.tokens(ctx.brand);
  ctx.store = P.storeFor(ctx.brand, ctx.market);
  ctx.currency = ctx.store.currency;
  ctx.briefing = P.briefing(ctx, 'email.mailer');

  try {
    const { text, provider, model, quota_warning, exhausted_keys } = await P.llm({
      systemPrompt: systemPrompt(ctx),
      userMessage: userMessage(ctx, o),
      responseFormat: { type: 'json_object' },
      maxTokens: 3000,
      temperature: 0.65 + Math.min(0.3, o.regenerate_counter * 0.1),
      timeoutMs: 38000,        // 38s internal; vercel maxDuration 45s (7s headroom)
      stage: 'strategy[regen=' + o.regenerate_counter + ']',
      tier: 'premium',
      userGeminiKey: ctx.userGeminiKey,
    });

    let parsed;
    try { parsed = P.parseJSON(text); }
    catch (_) {
      return res.status(502).json({ ok: false, error: 'json_parse_failed', provider, message: 'The model did not return valid JSON for the strategy lock.', raw: String(text || '').substring(0, 400) });
    }

    return res.status(200).json({
      ok: true, provider, model, stage: 'strategy',
      ...(quota_warning ? { quota_warning: true, exhausted_keys } : {}),
      ...enforceDivergence(parsed, ctx),
    });
  } catch (e) {
    console.warn('[strategy] All providers failed - using heuristic fallback');
    return res.status(200).json(heuristic(ctx, o, e));
  }
}

module.exports = P.mount(handler, 'mailer.brief');
