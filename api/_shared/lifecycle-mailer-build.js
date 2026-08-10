'use strict';

/**
 * Lifecycle mailer builder - one calendar row → one brand-compliant mailer.
 *
 * Flow:
 *   row (from lifecycle-calendar-generate.js, by id or inline)
 *   → brief (cohort voice_guide + play mechanic + locked product facts from
 *     data/product-types.json + purchase-mode-correct CTA rules + brand gates)
 *   → ONE llm() call via llm.js - same JSON contract as calendar-trigger.js:
 *     { subject_line, preview_text, hero_headline, hero_subline, body_blocks[], cta_text }
 *   → sanitizeBrand()/assertNoBanned() from scenario-model.js on every LLM string
 *     (single shared banned list - no third copy)
 *   → HTML via renderTextVariant imported from calendar-trigger.js helpers
 *     (style is the play's template_style: pure|visual|editorial - NEVER founder)
 *   → optional hero creative via creative-image.js (silent skip on failure)
 *   → if Supabase is configured: persist into the row's mailer JSONB, status='built'.
 */

const llm = require('./llm.js');
const SM = require('./scenario-model.js');
const { helpers } = require('./calendar-trigger.js');
const { COHORTS, PLAYS, ALLOWED_TEMPLATE_STYLES, purchaseModeForProductType } = require('./lifecycle-cohorts.js');
const { loadProductTypes } = require('./lifecycle-calendar-generate.js');
const CF = require('./copy-frameworks.js');

const { buildEntryAnalysis } = require('./output-reasoning.js');

const catalogImage = require('./catalog-image.js');


// ─── Brief builder ───────────────────────────────────────────────────────────

function productFactsBlock(productType) {
  const PT = loadProductTypes();
  if (productType === 'tb') {
    const lines = PT.types.tb.products.map((p) =>
      `- ${p.title} - £${p.price_gbp.toFixed(2)}${p.compare_at_gbp ? ` (compare-at £${p.compare_at_gbp.toFixed(2)}, a live store price - honest to cite)` : ''} - ${PT.store.base_url}/products/${p.handle}`);
    return [
      'PRODUCT FACTS - Custom Sneakers (ONE-TIME PURCHASE ONLY - never use subscription language):',
      '- Every pair is hand-painted one-of-one on a 100% original base sneaker, finished water and scratch resistant, made to order in 10 to 15 days.',
      ...lines,
    ].join('\n');
  }
  if (productType === 'coffee') {
    const c = PT.types.coffee;
    return [
      'PRODUCT FACTS - coffee-ART Collection (ONE-TIME PURCHASE ONLY - never use subscription language).',
      '- The coffee-ART collection is a PAINT THEME, not a drink: coffee-dip washes and latte-swirl motifs hand-painted onto original sneakers. Never write beverage copy.',
      ...c.packs.map((pk) => `- ${pk.label}: £${pk.one_time_gbp.toFixed(2)}.`),
      `- Base-model ladder framing: ${(c.packs.find((x) => x.b2g1_framing) || {}).b2g1_framing || 'state the price ladder by base model; never invent a bundle or a discount code.'}`,
      `- What EVERY order includes as standard (this is NOT a free-gift list - do not write gift-with-purchase copy): ${c.gifts.join(', ')}.`,
      `- The honest hook: ${c.sub_gift_hook}`,
      `- Product URL: ${PT.store.base_url}/products/${c.handle} (verified against the live catalog - do not invent others).`,
      '- These are the ONLY prices that exist. NO discount codes or bundles may be invented.',
    ].join('\n');
  }
  const s = PT.types.supplements;
  return [
    'PRODUCT FACTS - Accessories (ONE-TIME PURCHASE ONLY; low-ticket attachment items that finish a pair):',
    ...s.products.map((p) => `- ${p.title} - ${PT.store.base_url}/products/${p.handle}`),
    '- This lane is deliberately routed PRICE-FREE - never state a price for accessories. CTA to the product page only.',
  ].join('\n');
}

function ctaRulesBlock(purchaseMode) {
  if (purchaseMode === 'one_time_only') {
    return 'CTA RULES: This product is ONE-TIME purchase only. The CTA must be a simple purchase/replenishment invitation. Do NOT use the words subscribe, subscription, refill plan, or any recurring-purchase framing anywhere in the email.';
  }
  // KNICKGASM runs no subscription of any kind, so this branch should never be
  // reached; it stays as a hard backstop that still forbids recurring framing.
  return 'CTA RULES: KNICKGASM has NO subscription program. The CTA must be a simple one-time purchase invitation to the product page. Never write subscribe, subscription, refill plan, auto-ship, or any recurring-purchase framing.';
}

function brandGatesBlock() {
  return [
    'BRAND GATES (hard fail if violated):',
    '- Palette: only deep purple #D0473E, lava #6A33D8, near-black #111111, chalk #FFFFFF. Never mention other colors.',
    "- Fonts are fixed by the template (Montserrat headings, Instrument Sans body) - do not reference fonts in copy.",
    '- BANNED phrases (any casing unless noted): "wellness journey", "transform", "liquid gold", "game-changer", "LIMITED TIME" in caps, "hurry", "don\'t miss out", "last chance", "while supplies last".',
    '- NO FOUNDER VOICE - no founder letters, no "from our founder/CEO", no personal-name sign-offs, no first-person-singular ("I") narration. The brand speaks as "we".',
    '- NO health, medical or performance claims of ANY kind - KNICKGASM sells hand-painted sneakers, not remedies. The only claims allowed are: 100% original base sneakers, hand-painted by India\'s best artists, water and scratch resistant, made to order in 10 to 15 days, express shipping to 60+ countries, worn organically by Samay Raina, Rohit Sharma and Shraddha Kapoor.',
    '- No invented discounts or codes. Only the exact prices/mechanics in the product facts.',
    '- Voice: warm, sensory, story-driven. Preferred words: ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted.',
    '- Exemplar sentence: "There is a moment when the right pair of kicks stops being footwear and starts being a signature."',
  ].join('\n');
}

function buildBrief(entry, fw) {
  const cohort = COHORTS[entry.cohort_key] || { label: entry.cohort_label || entry.cohort_key, objective: '', voice_guide: '' };
  const play = PLAYS[entry.play_key] || { name: entry.play_key, mechanic: '', cta_framing_by_purchase_mode: {} };
  const purchaseMode = entry.purchase_mode || purchaseModeForProductType(entry.product_type);
  const ctaFraming = (play.cta_framing_by_purchase_mode || {})[purchaseMode] || '';
  const framework = fw || CF.pickCopyFramework({ framework: entry.framework, play_key: entry.play_key, cohort_key: entry.cohort_key, seed: entry.id || entry.date });

  return [
    `Campaign date: ${entry.date} · Market: ${entry.market || 'UK'} (store: knickgasm.com, currency GBP £)`,
    `Cohort: ${cohort.label}`,
    `Cohort objective: ${cohort.objective}`,
    `Cohort voice guide: ${cohort.voice_guide}`,
    '',
    `Play: ${play.name}`,
    `Play mechanic: ${play.mechanic}`,
    ctaFraming ? `Play CTA framing for this purchase mode: ${ctaFraming}` : null,
    entry.festival ? `Cultural moment: ${entry.festival} (weight ${entry.festival_weight}/10) - weave it in lightly.` : null,
    `Hero product: ${entry.hero_product}${entry.hero_price ? ` - ${entry.hero_price}` : ''}`,
    `Subject-line direction: ${entry.subject_hint || ''}`,
    '',
    CF.strategyBriefBlock(entry.cohort_key),
    '',
    productFactsBlock(entry.product_type),
    '',
    ctaRulesBlock(purchaseMode),
    '',
    CF.copyFrameworkBriefBlock(framework),
    '',
    brandGatesBlock(),
  ].filter(Boolean).join('\n');
}

// ─── LLM call (single call, same contract as calendar-trigger.js) ───────────

async function writeCopy(brief, frameworkLine) {
  const out = await llm({
    systemPrompt:
      'You are KNICKGASM\'s lifecycle copywriter. Produce a strict JSON object with keys: ' +
      'subject_line (string, ≤ 60 chars), preview_text (string, ≤ 90 chars), ' +
      'hero_headline (string, ≤ 8 words), hero_subline (string, ≤ 18 words), ' +
      'body_blocks (array of {heading, body}), cta_text (string, ≤ 4 words). ' +
      'Use KNICKGASM brand voice (warm, sensory, story-driven). ' +
      (frameworkLine ? frameworkLine + ' ' : '') +
      'Obey every brand gate, ' +
      'CTA rule and product fact in the brief exactly - no invented prices, no banned phrases, ' +
      'no founder voice, no medical claims.',
    userMessage: brief,
    responseFormat: { type: 'json_object' },
    maxTokens: 3000,
    temperature: 0.7,
    timeoutMs: 40000,
    stage: 'lifecycle-mailer',
    tier: 'premium', // single mode: lifecycle mailer copy always runs premium
  });
  const json = (llm.parseJSON ? llm.parseJSON(out.text) : JSON.parse(out.text));
  if (!json || !json.subject_line || !json.hero_headline) throw new Error('LLM copy JSON incomplete');

  // Critic agent — parity with the /studio quality loop the Mailer Calendar V2
  // previously lacked: score the copy and, if weak, take ONE bounded revision.
  // Fully fail-soft (returns the original copy on any error/timeout), so the
  // build never fails because the critic did. (_shared/feature-agent.js critic role.)
  let copy = json;
  let quality = null;
  try {
    const { runCritic } = require('./feature-agent.js');
    const crit = await runCritic({
      feature: 'lifecycle email copy',
      content: json,
      context: brief,
      rubric: {
        passThreshold: 7,
        dimensions: [
          { key: 'copy_quality', label: 'copy', guide: '10 = premium, sensory, brand-voice, concrete reason to act; 0 = generic.' },
          { key: 'brand_safety', label: 'brand gates', guide: '10 = no banned phrases, no invented prices/claims, no medical/founder voice; 0 = violations.' },
          { key: 'offer_clarity', label: 'clarity + limits', guide: '10 = subject <=60 chars, preview <=90, cta <=4 words, one clear promise; 0 = vague or over-length.' },
        ],
        shapeOk: (r) => r && r.subject_line && r.hero_headline,
      },
      timeBoxMs: 15000,
    });
    if (crit && crit.content) copy = crit.content;
    quality = crit && crit.quality || null;
  } catch (_) { /* keep original copy */ }

  return { copy, provider: out.provider || null, model: out.model || null, quality };
}

// Sanitize every LLM-authored string through the shared brand scrub, then
// tripwire-assert nothing banned survived (scenario-model owns the one list).
function sanitizeCopy(copy, where) {
  const clean = {
    subject_line: SM.sanitizeBrand(copy.subject_line),
    preview_text: SM.sanitizeBrand(copy.preview_text || ''),
    hero_headline: SM.sanitizeBrand(copy.hero_headline),
    hero_subline: SM.sanitizeBrand(copy.hero_subline || ''),
    cta_text: SM.sanitizeBrand(copy.cta_text || 'See the collection'),
    body_blocks: (Array.isArray(copy.body_blocks) ? copy.body_blocks : []).map((b) => ({
      heading: SM.sanitizeBrand(b && b.heading ? b.heading : ''),
      body: SM.sanitizeBrand(b && b.body ? b.body : ''),
    })),
  };
  const flat = [clean.subject_line, clean.preview_text, clean.hero_headline, clean.hero_subline, clean.cta_text]
    .concat(clean.body_blocks.map((b) => `${b.heading} ${b.body}`)).join(' ');
  SM.assertNoBanned(flat, where);
  return clean;
}

// ─── Hero image resolution - CORRECT IMAGES ONLY ────────────────────────────
// We never ship an AI-generated hero (those can render garbled text/artifacts).
// Text + Visual variants use the REAL catalog product image when the slot has
// one; otherwise a clean, on-brand PLACEHOLDER of the ideal size that the user
// drops a real image URL into (the exact prompt to generate one rides in the
// variant metadata). This guarantees every shipped image is correct.

function placeholderImage(label, w, h) {
  const t = String(label || 'Product image').replace(/[<&>]/g, ' ').slice(0, 42);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="#FFFFFF"/>` +
    `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" fill="none" stroke="#6A33D8" stroke-width="2" stroke-dasharray="9 7"/>` +
    `<text x="50%" y="45%" text-anchor="middle" fill="#D0473E" font-family="Georgia,serif" font-size="21">${t}</text>` +
    `<text x="50%" y="59%" text-anchor="middle" fill="#6A33D8" font-family="Arial,Helvetica,sans-serif" font-size="13">Drop your image URL here · ${w} x ${h}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Stable non-crypto hash of a slot's identity → a deterministic gallery index, so
// the SAME slot always resolves the SAME photo but DIFFERENT slots (even of the
// same product) get DIFFERENT real photos. Not a security context.
function slotHash(entry) {
  const key = String(entry.id || `${entry.date || ''}|${entry.cohort_key || entry.cohort_label || ''}|${entry.hero_handle || entry.hero_product || ''}|${entry.play_key || ''}`);
  let h = 5381;
  for (let i = 0; i < key.length; i++) { h = ((h << 5) + h) + key.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

function resolveHero(entry, w, h) {
  // Real, already-hosted product image is the guarantee. Prefer an explicit
  // hero_image on the slot; otherwise resolve the product's own catalog photo.
  // For UNIQUENESS, rotate through the product's REAL PDP gallery keyed by the
  // slot's identity, so two slots featuring the same product don't repeat one
  // shot — while every image is still a genuine hosted product photo (zero
  // fabrication). Only fall back to the fillable placeholder when the catalog
  // genuinely has no photo for this handle.
  if (entry.hero_image && /^https?:\/\//.test(entry.hero_image)) {
    return { url: entry.hero_image, mode: 'catalog', size: `${w}x${h}`, prompt: null };
  }
  const gallery = catalogImage.imagesFor(entry.hero_handle || entry.hero_product || entry, entry.market, { width: Math.max(w, 1200) }) || [];
  if (gallery.length) {
    const idx = slotHash(entry) % gallery.length;
    return { url: gallery[idx], mode: 'catalog', size: `${w}x${h}`, prompt: null, gallery_index: idx, gallery_size: gallery.length };
  }
  const real = catalogImage.imageFor(entry.hero_handle || entry.hero_product || entry, entry.market);
  if (real) {
    return { url: real, mode: 'catalog', size: `${w}x${h}`, prompt: null };
  }
  const prompt =
    `On-brand KNICKGASM email hero for "${entry.hero_product || entry.product_type}". Editorial product ` +
    `photography, one-of-one provenance, elegant negative space, warm cinematic light. Brand palette ` +
    `only (violet #D0473E, lava #6A33D8, chalk #FFFFFF). No text on the image. Ideal size ${w} x ${h}.`;
  return { url: placeholderImage(entry.hero_product || 'Product image', w, h), mode: 'placeholder', size: `${w}x${h}`, prompt };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function supaIfConfigured() {
  try {
    const supa = require('./supa.js');
    supa.env();
    return supa;
  } catch (_) { return null; }
}

async function loadEntryById(id) {
  const supa = supaIfConfigured();
  if (!supa) return null;
  const rows = await supa.select('lifecycle_calendar_entries', { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
  const row = rows && rows[0];
  return row ? (row.payload || null) : null;
}

// Load a slot's ALREADY-BUILT mailer (persisted by a prior build) so View/Download
// return instantly instead of regenerating. Returns { payload, mailer } or null.
async function loadPersistedMailer(id) {
  const supa = supaIfConfigured();
  if (!supa) return null;
  const rows = await supa.select('lifecycle_calendar_entries', { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
  const row = rows && rows[0];
  if (!row) return null;
  return { payload: row.payload || null, mailer: row.mailer || null, status: row.status || null };
}

async function persistMailer(id, mailer) {
  const supa = supaIfConfigured();
  if (!supa || !id) return { persisted: false, reason: supa ? 'no_entry_id' : 'supabase_not_configured' };
  try {
    await supa.update('lifecycle_calendar_entries',
      { mailer, status: 'built', generated_by: mailer.generated_by || null, updated_at: new Date().toISOString() },
      { id: `eq.${id}` });
    return { persisted: true };
  } catch (e) {
    console.warn('[lifecycle-mailer] persistence failed (mailer still returned):', e.message);
    return { persisted: false, reason: e.message };
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

async function buildLifecycleMailer({ id = null, entry = null, force = false } = {}) {
  // Retrieve-first: if this slot was already built and persisted, return it
  // instantly (no LLM) so View/Download load immediately. Only a real regenerate
  // (force:true) rebuilds. Zero fabrication: we return exactly what was saved.
  if (id && !force) {
    const saved = await loadPersistedMailer(id).catch(() => null);
    const savedMailer = saved && saved.mailer;
    const savedVariants = savedMailer && Array.isArray(savedMailer.variants) ? savedMailer.variants : null;
    if (savedMailer && (savedVariants ? savedVariants.length : (savedMailer.html || savedMailer.subject))) {
      return {
        ok: true, id, entry: saved.payload || entry, mailer: savedMailer,
        variants: savedVariants && savedVariants.length ? savedVariants : [savedMailer],
        persisted: true, retrieved: true, persistence: { persisted: true, retrieved: true },
      };
    }
  }
  let row = entry;
  if (!row && id) row = await loadEntryById(id);
  if (!row) throw new Error('entry not found - pass { entry } inline or an { id } that exists in lifecycle_calendar_entries');
  if (!row.cohort_key || !row.product_type) throw new Error('entry must include cohort_key and product_type (a row from lifecycle-generate)');

  const PT = loadProductTypes();
  const ctaUrl = row.hero_handle
    ? `${PT.store.base_url}/products/${row.hero_handle}`
    : (row.product_type === 'coffee' && PT.types.coffee.collection_slug
        ? `${PT.store.base_url}/collections/${PT.types.coffee.collection_slug}`
        : PT.store.base_url);

  // Two diverging framework angles → two premium copy sets, generated in
  // parallel (same wall-clock as one call). A = the play's preferred framework;
  // B = a deterministically-chosen different one, so the two directions read
  // genuinely differently rather than being the same copy in two skins.
  const fwA = CF.pickCopyFramework({ framework: row.framework, play_key: row.play_key, cohort_key: row.cohort_key, seed: row.id || row.date });
  const otherKeys = Object.keys(CF.COPY_FRAMEWORKS).filter((k) => k !== fwA.key);
  const fwB = CF.frameworkByKey(otherKeys[CF.stableIndex(`${row.id || row.date}|b`, otherKeys.length)]) || fwA;

  // Partial-failure tolerant: if one premium copy call fails we still ship with
  // the one that succeeded (both diverge only by framework). Fail only if BOTH
  // reject.
  const [pA, pB] = await Promise.allSettled([
    writeCopy(buildBrief(row, fwA), CF.copyFrameworkSystemLine(fwA)),
    writeCopy(buildBrief(row, fwB), CF.copyFrameworkSystemLine(fwB)),
  ]);
  if (pA.status !== 'fulfilled' && pB.status !== 'fulfilled') {
    throw new Error('mailer copy generation failed for both variants: ' + String((pA.reason && pA.reason.message) || pA.reason));
  }
  const rA = pA.status === 'fulfilled' ? pA.value : pB.value;
  const rB = pB.status === 'fulfilled' ? pB.value : pA.value;
  const SA = sanitizeCopy(rA.copy, `lifecycle-mailer:${row.id || row.play_key}:a`);
  const SB = sanitizeCopy(rB.copy, `lifecycle-mailer:${row.id || row.play_key}:b`);

  // Real catalog image if the slot has one; else a clean placeholder to fill.
  const hero = resolveHero(row, 536, 340);

  const market = row.market || 'UK';
  // Flagship-parity: real inline product grid (hero + supporting picks) resolved
  // by handle/title, and a derived collection CTA for the secondary button.
  const gridProducts = [
    { title: row.hero_product, handle: row.hero_handle, price: row.hero_price },
    ...((Array.isArray(row.supporting_products) ? row.supporting_products : [])),
  ].filter((p) => p && (p.title || p.handle));
  const collectionUrl = (row.product_type === 'coffee' && PT.types.coffee.collection_slug)
    ? `${PT.store.base_url}/collections/${PT.types.coffee.collection_slug}`
    : `${PT.store.base_url}/collections/bestsellers`;
  const meta = (S) => ({
    subject_line: S.subject_line, preview_text: S.preview_text,
    hero_headline: S.hero_headline, hero_subline: S.hero_subline, cta_text: S.cta_text,
  });
  // The product grid (real photos) is a Text + Visual element; pure "Text"
  // variants stay graphics-free per taxonomy. `withGrid` opts it in.
  const render = (S, style, opts = {}) => {
    const { withGrid, ...rest } = opts;
    return helpers.renderTextVariant({
      style, subject: S.subject_line, preheader: S.preview_text,
      hero_headline: S.hero_headline, hero_subline: S.hero_subline,
      body_blocks: S.body_blocks, cta_text: S.cta_text, cta_url: ctaUrl, market,
      hero_product: row.hero_product, collection_url: collectionUrl,
      ...(withGrid ? { products: gridProducts } : {}),
      ...rest,
    });
  };

  // Only a REAL catalog photo is embedded as a live <img>. When the slot has no
  // catalog image we pass the generation prompt so the renderer emits the
  // lava-standard IMAGE GENERATION PROMPT comment + PASTE_IMAGE_URL_HERE slot,
  // which the asset agent (asset-agent.js) later fills with a generated image.
  const heroImg = hero.mode === 'catalog' ? hero.url : null;

  // Exactly the two named mailer types, two variants each (mailer taxonomy):
  //   Text          = colour + type + structural elements (buttons, tables,
  //                   dividers, badges), NO images / video / gif.
  //   Text + Visual = the same, plus a hero image (real catalog or a fillable slot).
  const variants = [
    { key: 'text_a',   type: 'Text',          label: `Text · ${fwA.name}`,          framework: fwA.key, image: null, ...meta(SA), html: render(SA, 'pure') },
    { key: 'text_b',   type: 'Text',          label: `Text · ${fwB.name}`,          framework: fwB.key, image: null, ...meta(SB), html: render(SB, 'editorial') },
    { key: 'visual_a', type: 'Text + Visual', label: `Text + Visual · ${fwA.name}`, framework: fwA.key, image: hero, ...meta(SA), html: render(SA, 'visual', { hero_image_url: heroImg, hero_prompt: hero.prompt, withGrid: true }) },
    { key: 'visual_b', type: 'Text + Visual', label: `Text + Visual · ${fwB.name}`, framework: fwB.key, image: hero, ...meta(SB), html: render(SB, 'visual', { hero_image_url: heroImg, hero_prompt: hero.prompt, withGrid: true }) },
  ];

  const primary = variants[2]; // visual_a, for backward-compatible top-level fields
  const provider = rA.provider || rB.provider || null;
  const model = rA.model || rB.model || null;

  const mailer = {
    built_at: new Date().toISOString(),
    entry_id: row.id || null,
    cohort_key: row.cohort_key,
    play_key: row.play_key,
    frameworks: [fwA.key, fwB.key],
    purchase_mode: row.purchase_mode || purchaseModeForProductType(row.product_type),
    // Backward-compatible top-level fields mirror the primary (visual A) variant.
    subject_line: primary.subject_line,
    preview_text: primary.preview_text,
    hero_headline: primary.hero_headline,
    hero_subline: primary.hero_subline,
    cta_text: primary.cta_text,
    cta_url: ctaUrl,
    html: primary.html,
    image: hero,
    // The four deliverables: 2 Text + 2 Text + Visual.
    variants,
    generated_by: provider ? `${provider}${model ? `/${model}` : ''}` : null,
    // Complete "why this mailer looks the way it does" analysis. Reuses the
    // calendar entry's data-grounded analysis (cohort/product/festival/
    // confidence) and layers in the copy-framework + variant reasoning.
    analysis: (() => {
      const base = row.analysis || buildEntryAnalysis({
        cohort: { name: row.cohort_label || row.cohort_key },
        product: { title: row.hero_product, category: row.product_type },
        festival: row.festival ? { name: row.festival, weight: row.festival_weight, tags: row.festival_tags || [] } : null,
        channels: ['email'],
        objective: row.play_name || row.play_key,
        market,
        dataSource: 'lifecycle-cohorts',
      });
      return {
        summary: `Four mailers for ${row.cohort_label || row.cohort_key} built on ${row.hero_product} via the "${row.play_name || row.play_key}" play.`,
        why_this_slot: base.summary,
        drivers: base.drivers,
        hypothesis: base.hypothesis,
        expected_impact: base.expected_impact,
        confidence: base.confidence,
        copy_frameworks: [
          { key: fwA.key, name: fwA.name, why: `Primary voice for this ${row.cohort_label || row.cohort_key} send; best fit for the "${row.play_name || row.play_key}" play.` },
          { key: fwB.key, name: fwB.name, why: 'Structural contrast variant so the A/B forces a genuinely different narrative, not a reworded twin.' },
        ],
        variant_logic: variants.map((v) => ({ key: v.key, type: v.type, framework: v.framework, why: v.type === 'Text' ? 'Pure typographic build — deliverable for image-free, high-deliverability sends.' : 'Adds a real catalog photo (or a fillable slot) for a richer hero.' })),
        purchase_mode_rule: (row.purchase_mode || purchaseModeForProductType(row.product_type)) === 'one_time_only'
          ? 'One-time product: no subscription language anywhere in the copy.'
          : 'No subscription exists: the one-time product-page CTA still applies.',
        evidence: base.evidence,
      };
    })(),
  };

  // Embed the variants INTO the persisted mailer so a later retrieve-first returns
  // all 4 variants (not just a single fallback).
  if (!Array.isArray(mailer.variants) || !mailer.variants.length) mailer.variants = variants;
  const persistence = await persistMailer(row.id, mailer);

  return { ok: true, id: row.id || null, entry: row, mailer, variants, persisted: persistence.persisted, persistence };
}

module.exports = { buildLifecycleMailer, buildBrief, sanitizeCopy };
