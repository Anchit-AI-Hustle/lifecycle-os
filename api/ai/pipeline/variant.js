'use strict';
// ════════════════════════════════════════════════════════════════════════════
// /api/ai/pipeline/variant  — Stage 2: Pure Execution (no thinking)
//
// The strategy is LOCKED in Stage 1. This stage turns it into one variant's
// creative plan: sections, layout, copy, image requirements. A and B are
// called separately with structurally opposite implementations of the SAME
// locked strategy.
//
// Gated, metered and brand-derived through api/_shared/pipeline-core.js since
// 2026-09-28 (see its header). The execution rules no longer mandate a rating,
// a review count or a units-sold line per product card: proof appears only
// where it was supplied, and a gap is written as the DATA REQUIRED marker.
//
// POST body:  { strategy_output, variant: 'A'|'B', brief, market?, products[],
//               mailer_type?, offer?, proof?, evidence?, regenerate_counter? }
// Response:   { ok, stage, variant, provider, model, layout_plan, sections[],
//               image_requirements[], copy_framework, subject_lines[],
//               preheader, credits }
// ════════════════════════════════════════════════════════════════════════════

const P = require('../../_shared/pipeline-core.js');

/**
 * What this stage returns: the OUTPUT REQUIREMENT its prompt ends with and the
 * spec the answer is read by. Subject and preheader limits are the email
 * contract's own (asset-contracts.js), read, never re-typed.
 */
function outputSpec(ctx, variant) {
  const t = ctx.tokens;
  const text = ctx.mailerType === 'text';
  const scheme = variant === 'B'
    ? `background ${t.primary}, primary ${t.onPrimary}, accent ${t.accent}, text ${t.onPrimary}; opening sections on the primary`
    : `background ${t.surface}, primary ${t.primaryAsText}, accent ${t.accent}, text ${t.onSurface}`;
  const img = (slot, size, what) => ({ type: 'object', of: {
    slot: { type: 'string', enum: slot }, prompt: { type: 'string', note: `55-70 words: ${what}. No text, no logos` },
    size: { type: 'string', enum: size }, negative_prompt: 'string' } });
  return {
    id: 'pipeline.variant', kind: 'data', format: 'json', brand: ctx.brand.name, region: ctx.market,
    returns: `ONE JSON object: the creative plan for VARIANT ${variant} (sections with their final copy, layout, image slots, subject lines, preheader). A plan the HTML stage executes, not HTML.`,
    forbid: ['HTML', 'a rendered email'],
    schema: {
      variant: { type: 'string', enum: [variant] },
      layout_plan: { type: 'object', of: {
        hero: 'string', benefit_section: 'string', product_section: 'string', proof_section: 'string', offer_section: 'string', cta_section: 'string',
        color_scheme: { type: 'object', note: scheme },
        spacing: 'string', flow: { type: 'string', enum: [variant === 'B' ? 'editorial-narrative' : 'structured-conversion'] } } },
      sections: { type: 'array', count: [3, 9], items: { type: 'object', of: {
        id: { type: 'string', enum: ['announcement_bar', 'brand_header', 'hero', 'narrative', 'lifestyle', 'context', 'product_reveal', 'benefit_strip', 'social_proof', 'offer_bar', 'offer_inline', 'cta', 'footer'] },
        type: { type: 'string', enum: ['split-hero', 'full-bleed', 'centered', 'two-col-grid', 'three-col-grid', 'banner', 'button-row'] },
        purpose: { type: 'string', note: 'one sentence' },
        copy: { type: 'object', of: { eyebrow: 'string', headline: { type: 'string', note: '8 words at most' }, subcopy: { type: 'string', note: '40 words at most, a full sentence' }, cta: { type: 'string', note: '4 words at most' } } },
        layout: { type: 'string', note: 'a precise table-structure instruction for the HTML stage' },
        image_slot: { type: 'string', enum: text ? ['none'] : ['hero', 'product', 'lifestyle', 'none'] },
        ux_intent: 'string' } } },
      image_requirements: text
        ? { type: 'array', count: 0, note: 'empty: a TEXT mailer has no photographs' }
        : { type: 'array', count: 3, items: img(['hero', 'product', 'lifestyle'], ['1536x1024', '1024x1024'], 'exact subject, surface, light source and direction, camera angle, time of day, colour temperature, compositional focus'), note: 'in this order: hero (1536x1024), product (1024x1024), lifestyle (1024x1024)' },
      copy_framework: { type: 'object', of: { tone: 'string', voice: 'string', headline_style: 'string', cta_verb: 'string' } },
      subject_lines: { type: 'array', count: 3, items: { type: 'string', max: P.slotLimit('email.mailer', 'subject') } },
      preheader: { type: 'string', max: P.slotLimit('email.mailer', 'preheader'), note: 'extends the subject rather than repeating it, no terminal period' },
    },
  };
}

function systemPrompt(ctx, variant) {
  const t = ctx.tokens;
  const b = ctx.brand;
  const common = `You are building VARIANT ${variant} of a locked campaign strategy for ${b.name}.
YOUR ROLE: EXECUTOR, NOT THINKER. Strategy, theme, structure, products and vibe are already decided. Implement them exactly. Do not invent strategy, change the product selection or add a product that was not supplied.

${ctx.briefing}

${ctx.mailerType === 'text'
    ? 'MAILER TYPE: TEXT. Pure typographic. No photographs, no image slots: image_slot is "none" on every section and image_requirements is an empty array. Weight, size, rules, colour bands and space carry the structure.'
    : 'MAILER TYPE: TEXT + GRAPHICS. Typography plus built graphic elements (bands, buttons, labels, dividers, price tables in the brand palette) with photograph SLOTS the operator fills from the brand catalogue. Never describe a photograph as if it exists.'}

RULES THAT OUTRANK THE VARIANT RULES:
- A price, a compare-at price, a discount, a code, a shipping threshold, a rating, a review count, a units-sold figure or a testimonial appears ONLY if it was supplied. Nothing supplied means the section carries the DATA REQUIRED marker or is left out; never a plausible number.
- Max 3 products in the product section. Every section content-complete; no filler.
- Copy uses the voice, preferred words and banned list in the BRAND block. No em dashes or en dashes in any copy field.
- Subject lines and the preheader stay inside the limits in the OUTPUT REQUIREMENT: the inbox truncates past them.

REGENERATION (regenerate_counter > 0): change the headline angle, the CTA wording, the benefit framing and the hero scene; never repeat a previous headline or CTA.

OUTPUT: the OUTPUT REQUIREMENT at the end of this prompt names every key, its type and its limit. Return exactly that object.`;

  if (variant === 'B') {
    return `${common}

━━ VARIANT B EXECUTION RULES (all must hold; verify before answering) ━━
- Opening sections on the brand PRIMARY (${t.primary}) with ${t.onPrimary} text: the inverse of A, which opens on the surface.
- No product in the first two sections; narrative, lifestyle or mood opens.
- Copy sensory and evocative: the reader feels the setting before seeing the product.
- Hero full-bleed (image across the column, copy stacked below) or stacked; never split.
- Single editorial product treatment, not a grid.
- Proof is an origin or provenance passage drawn from the brand's verifiable claims, not star ratings.
- Offer, if one was supplied, as a subtle inline line rather than a banner.
- CTA as a ghost button (2px border in the text colour, transparent fill) or a text link; never a filled accent button.
- Section padding at least 48px; headline at least 40px.
- template_key different from Variant A's.
- Section order: brand_header → narrative → lifestyle → product_reveal → offer_inline (only if an offer exists) → cta → footer.`;
  }

  return `${common}

━━ VARIANT A EXECUTION RULES (non-negotiable) ━━
- Product visible in the FIRST content section. No story build-up.
- Opening sections on the brand SURFACE (${t.surface}) with ${t.onSurface} text; the accent (${t.accent}) for the CTA fill with ${t.onAccent} text.
- Hero: split (image 55% left, copy 45% right) or centred with the product image dominant.
- Benefits: a compact icon strip with short captions drawn from the brand's verifiable claims.
- Products: 2 or 3 product cards with name, supplied price if any, and a CTA each.
- Offer, if one was supplied, as a prominent horizontal banner.
- CTA: one prominent filled button, max 4 words.
- Copy register: precise, benefit-led, authoritative.
- Section order: announcement_bar (only if an offer exists) → brand_header → hero → benefit_strip → product_reveal → offer_bar (only if an offer exists) → footer.`;
}

function userMessage(ctx, o) {
  return P.OC.append(task(ctx, o), outputSpec(ctx, o.variant));
}

function task(ctx, o) {
  const s = o.strategy_output || {};
  const lock = s.strategic_lock || {};
  const structure = s.structure || {};
  const sections = Array.isArray(structure.sections) ? structure.sections : [];
  const concept = s[o.variant === 'B' ? 'variant_b_concept' : 'variant_a_concept'] || {};
  const sel = s.product_selection || {};
  const hero = sel.hero || {};
  const supporting = Array.isArray(sel.supporting) ? sel.supporting : [];
  const offer = o.offer ? `OFFER (supplied; the only offer that exists): ${JSON.stringify(o.offer)}` : 'OFFER: none supplied. Write no discount, code or shipping threshold.';
  const proof = (Array.isArray(o.proof) && o.proof.length)
    ? `PROOF (supplied verbatim; quote exactly, never paraphrase): ${JSON.stringify(o.proof)}`
    : `PROOF: none supplied. A proof section carries ${P.marker('approved review', hero.name || ctx.brand.name, ctx.market)} rather than a written one.`;

  return `━━ LOCKED STRATEGY (implement exactly; do not change) ━━
CAMPAIGN: ${(o.brief.split(/[.!?\n]/)[0] || '').trim().substring(0, 80) || `${ctx.brand.name} campaign`}
STRATEGY TYPE: ${s.strategy_type || ''}
STRATEGY: ${s.strategy || ''}
REASONING: ${s.reasoning || ''}

STRATEGIC LOCK:
- Audience truth: ${lock.audience_truth || ''}
- Business goal: ${lock.business_goal || ''}
- Purchase barrier: ${lock.purchase_barrier || ''}
- Conversion trigger: ${lock.conversion_trigger || ''}

━━ THEME (locked) ━━
${JSON.stringify(s.theme || {}, null, 2)}

━━ VIBE (locked) ━━
${JSON.stringify(s.vibe || {}, null, 2)}

━━ STRUCTURE CONTRACT (implement these sections in order; FINAL) ━━
Sections: ${sections.length ? sections.join(' → ') : '(derive from the variant rules)'}
Layout rules: ${structure.layout_rules || ''}
Visual system: ${JSON.stringify(structure.visual_system || {}, null, 2)}

━━ IMAGE STYLE LOCK ━━
${s.image_style_lock || 'Editorial photography, natural light, shallow depth of field, no stock look.'}

━━ VARIANT ${o.variant} EXECUTION CONTRACT ━━
Emotional angle: ${concept.emotional_angle || ''}
Headline register: ${concept.headline_register || ''}
Template key: ${concept.template_key || ''}
Colour approach: ${concept.color_approach || ''}
Hero scene direction: ${concept.hero_scene || ''}

━━ PRODUCTS (use these only) ━━
HERO: ${hero.name || P.marker('hero product', ctx.brand.name, ctx.market)}${hero.why ? ` (${hero.why})` : ''}
SUPPORTING: ${supporting.map((p) => p.name + (p.role ? ' [' + p.role + ']' : '')).join(', ') || '(none)'}
PRODUCT SYSTEM: ${sel.product_system || ''}
MARKET: ${ctx.market || P.marker('home market', ctx.brand.name)} · store ${ctx.store.url || ctx.store.marker}
CATALOGUE MATCHES:
${P.productLines(o.products, ctx, { max: 5 })}

${offer}
${proof}
${o.regenerate_counter > 0 ? `\nREGENERATE #${o.regenerate_counter}: change the hero scene, the copy emphasis and the layout variation. Keep the strategy; vary the execution.` : ''}

Implement Variant ${o.variant} now. Follow the locked structure exactly. Generate every section, its copy and its image requirements.`;
}

/**
 * The plan written without a model. Brand-derived, product-bound, and silent
 * where nothing was supplied: no testimonial, no code, no threshold, no
 * figure. The proof section carries the marker so its absence is visible.
 */
function heuristic(ctx, o, err) {
  const b = ctx.brand;
  const t = ctx.tokens;
  const isB = o.variant === 'B';
  const text = ctx.mailerType === 'text';
  const s = o.strategy_output || {};
  // Only what the record and the strategy state (2026-10-17 audit): the
  // operator's BRIEF was the headline and the subject, and the copy was this
  // function's own brief. pipeline-core.fallbackCopy() is shared with html.js.
  const fc = P.fallbackCopy(ctx, o, s);
  const product = fc.product;
  const heroName = product || b.name; // image prompts only; never printed as a product
  const themeName = fc.headline;
  const claims = fc.claims;
  const proofSupplied = Array.isArray(o.proof) && o.proof.length ? o.proof[0] : null;
  const scheme = isB
    ? { background: t.primary, primary: t.onPrimary, accent: t.accent, text: t.onPrimary }
    : { background: t.surface, primary: t.primaryAsText, accent: t.accent, text: t.onSurface };

  const sections = [
    {
      id: isB ? 'narrative' : 'hero',
      type: text ? 'centered' : (isB ? 'full-bleed' : 'split-hero'),
      purpose: isB ? 'Atmosphere first; the reader feels the setting before the product.' : 'Immediate product impact; the hero drives the first impression.',
      copy: {
        eyebrow: fc.tagline && fc.tagline !== themeName ? fc.tagline : '',
        headline: String(themeName).substring(0, 60),
        subcopy: fc.sub !== fc.tagline ? fc.sub : '',
        cta: fc.cta,
      },
      layout: text ? 'Single column, typographic hero, 32px padding' : (isB ? 'Full-width image, copy stacked below on the primary, 48px padding' : 'Two cells: 55% image, 45% copy, vertically centred'),
      image_slot: text ? 'none' : 'hero',
      ux_intent: isB ? 'Curiosity and immersion' : 'Clarity: product and benefit visible at once',
    },
    {
      id: isB ? 'context' : 'benefit_strip',
      type: isB ? 'centered' : 'three-col-grid',
      purpose: isB ? 'Build the narrative before the product reveal.' : 'Quick-scan benefits that reinforce the decision.',
      copy: {
        headline: isB ? `Why ${b.name}` : '',
        subcopy: claims.join(' · '),
        cta: '',
      },
      layout: isB ? 'Centred text block, max-width 480px, generous space' : 'Three equal cells, one claim each',
      image_slot: (isB && !text) ? 'lifestyle' : 'none',
      ux_intent: isB ? 'Deepen investment' : 'Rational reinforcement',
    },
    {
      id: 'product_reveal',
      type: isB ? 'centered' : 'two-col-grid',
      purpose: 'The product, its supplied price if any, and a clear action.',
      copy: {
        eyebrow: '',
        headline: product,
        subcopy: fc.why,
        cta: fc.cta,
      },
      layout: isB ? 'Single product, full-width image, centred copy below' : 'Image left, name, price and CTA right',
      image_slot: text ? 'none' : 'product',
      ux_intent: 'Consideration and add-to-cart',
    },
    {
      id: 'social_proof',
      type: 'centered',
      purpose: proofSupplied ? 'Trust through a supplied customer voice.' : 'Proof slot, empty until an approved review is supplied.',
      copy: {
        headline: '',
        subcopy: proofSupplied
          ? `"${String(proofSupplied.text || proofSupplied).trim()}"${proofSupplied.author ? ` — ${proofSupplied.author}` : ''}`.replace(/[—–]/g, ', ')
          : '',
        cta: '',
      },
      layout: 'Centred quote in the heading face; author line below only when one was supplied',
      image_slot: 'none',
      ux_intent: 'Trust',
    },
  ];
  if (o.offer) {
    sections.push({
      id: 'offer_bar',
      type: 'banner',
      purpose: 'The supplied offer, with its terms.',
      copy: {
        eyebrow: 'Offer',
        headline: String(o.offer.headline || o.offer.label || '').substring(0, 60),
        subcopy: String(o.offer.detail || o.offer.terms || '').substring(0, 160),
        cta: 'See the offer',
      },
      layout: isB ? 'Single inline line on the primary' : 'Full-width accent banner, centred text, CTA below',
      image_slot: 'none',
      ux_intent: 'Value and a reason to act now',
    });
  }
  sections.push({
    id: 'cta',
    type: 'button-row',
    purpose: 'Final call to action.',
    copy: { headline: isB ? `More from ${b.name}` : b.name, subcopy: '', cta: fc.cta },
    layout: isB ? 'Ghost button, centred, generous padding' : 'Filled accent button, centred',
    image_slot: 'none',
    ux_intent: 'Final conversion capture',
  });

  const imageRequirements = text ? [] : [
    { slot: 'hero', prompt: isB
      ? `Late-afternoon light across a lived-in space, ${heroName} secondary to the mood, full-bleed composition, warm haze, shallow depth of field. No text, no logos.`
      : `${heroName} centred on a plain light surface, morning side light from the left, shallow focus, soft shadow, overhead angle slightly off centre. No text, no logos.`,
      size: '1536x1024', negative_prompt: 'no text overlays, no logos, no UI elements, no email layout, no stock look, no artificial lighting, no clutter' },
    { slot: 'product', prompt: `Close-up of ${heroName} on a tactile surface, natural sidelight from a window, warm colour temperature, shallow depth of field. No text, no logos.`,
      size: '1024x1024', negative_prompt: 'no text overlays, no logos, no UI elements, no stock look, no artificial lighting' },
    { slot: 'lifestyle', prompt: `Hands with ${heroName} in a real everyday setting, warm natural light, intimate framing. No text, no logos.`,
      size: '1024x1024', negative_prompt: 'no text overlays, no logos, no UI elements, no stock look, no artificial lighting' },
  ];

  // A section with nothing true to say is left out, not filled.
  const drop = { benefit_strip: !claims.length, context: !claims.length, product_reveal: !product, social_proof: !proofSupplied };
  for (let i = sections.length - 1; i >= 0; i--) if (drop[sections[i].id]) sections.splice(i, 1);
  const layoutOf = (id) => (sections.find((x) => x.id === id) || {}).layout || 'none';
  const subject = String(themeName).substring(0, 60);
  const uniq = (list) => list.map((x) => String(x || '').substring(0, 60)).filter((x, i, a) => x && a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  return {
    ok: true, provider: 'heuristic', model: 'fallback-v2', stage: 'variant', variant: o.variant,
    _heuristic: true,
    _llm_error: String((err && err.message) || err || '').substring(0, 200),
    layout_plan: {
      hero: sections[0].layout,
      benefit_section: 'Three equal cells, one claim each',
      product_section: layoutOf('product_reveal'),
      proof_section: layoutOf('social_proof'),
      offer_section: o.offer ? (isB ? 'Inline line on the primary' : 'Full-width accent banner') : 'none (no offer supplied)',
      cta_section: isB ? 'Ghost button, centred' : 'Filled accent button, centred',
      color_scheme: scheme,
      spacing: '32px between sections, 24px internal padding',
      flow: isB ? 'editorial-narrative' : 'structured-conversion',
    },
    sections,
    image_requirements: imageRequirements,
    copy_framework: {
      tone: isB ? 'sensory, evocative' : 'precise, authoritative',
      voice: (b.voice && b.voice.tone) || (isB ? 'storytelling guide' : 'confident product expert'),
      headline_style: isB ? 'indirect, sensory' : 'benefit-first, declarative',
      cta_verb: fc.cta,
    },
    subject_lines: uniq([subject, product ? `${product}, from ${b.name}` : b.name, fc.tagline, claims[0]]).slice(0, 3),
    preheader: String((fc.tagline && fc.tagline !== subject ? fc.tagline : claims[0]) || '').substring(0, 90),
    data_gaps: fc.gaps.concat(proofSupplied ? [] : [P.marker('approved review', product || b.name, ctx.market)]),
  };
}

async function handler(req, res) {
  const ctx = await P.admit(req, res);
  if (!ctx) return;
  const body = ctx.body;
  const o = {
    strategy_output: (body.strategy_output && typeof body.strategy_output === 'object') ? body.strategy_output : {},
    variant: String(body.variant || 'A').toUpperCase() === 'B' ? 'B' : 'A',
    brief: String(body.brief || '').substring(0, 500),
    products: Array.isArray(body.products) ? body.products : [],
    offer: (body.offer && typeof body.offer === 'object') ? body.offer : null,
    proof: Array.isArray(body.proof) ? body.proof : [],
    regenerate_counter: Number(body.regenerate_counter) || 0,
  };
  ctx.tokens = P.tokens(ctx.brand);
  ctx.store = P.storeFor(ctx.brand, ctx.market);
  ctx.currency = ctx.store.currency;
  ctx.briefing = P.briefing(ctx, 'email.mailer');

  try {
    const { text, provider, model, quota_warning, exhausted_keys } = await P.llm({
      systemPrompt: systemPrompt(ctx, o.variant),
      userMessage: userMessage(ctx, o),
      responseFormat: { type: 'json_object' },
      maxTokens: 3500,
      temperature: 0.55 + Math.min(0.2, o.regenerate_counter * 0.08),
      timeoutMs: 46000,        // 46s internal; vercel maxDuration 55s (9s headroom)
      stage: 'variant-' + o.variant + '[regen=' + o.regenerate_counter + ']',
      tier: 'premium',
      userGeminiKey: ctx.userGeminiKey,
    });

    let parsed;
    try { parsed = P.parseJSON(text); }
    catch (_) {
      return res.status(502).json({ ok: false, error: 'json_parse_failed', provider, variant: o.variant, message: 'The model did not return valid JSON for the variant plan.', raw: String(text || '').substring(0, 400) });
    }
    const output_check = P.OC.validate(parsed, outputSpec(ctx, o.variant));
    parsed.variant = o.variant;
    // A text mailer has no image slots, whatever the model answered.
    if (ctx.mailerType === 'text') {
      parsed.image_requirements = [];
      for (const s of Array.isArray(parsed.sections) ? parsed.sections : []) if (s && typeof s === 'object') s.image_slot = 'none';
    }

    return res.status(200).json({
      ok: true, provider, model, stage: 'variant', variant: o.variant, mailer_type: ctx.mailerType, output_check,
      ...(quota_warning ? { quota_warning: true, exhausted_keys } : {}),
      ...parsed,
    });
  } catch (e) {
    console.warn('[variant] All providers failed for variant ' + o.variant + ' - using heuristic fallback');
    return res.status(200).json(Object.assign(heuristic(ctx, o, e), { mailer_type: ctx.mailerType }));
  }
}

module.exports = P.mount(handler, 'mailer.variant');
