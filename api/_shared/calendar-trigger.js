'use strict';
const OfferingCampaign = require('./offering-campaign.js');

/**
 * /api/calendar/trigger-mailer
 *
 * Takes ONE calendar row from /api/calendar/generate and runs it through
 * the existing pipeline stages to produce the full HTML mailer:
 *   strategy → variant → images → html → score
 *
 * Body: { entry: <calendar-row>, market_override?: 'US' }
 *
 * Returns: { ok, html, subject, archetype, variants: { V1, V2 }, runs: [...] }
 *
 * IMPORTANT: This does NOT actually send the email — it produces the artefact.
 * Sending is a separate, intentionally-gated endpoint to be added later.
 */

const llm = require('../_shared/llm.js');
const { buildMasterPrompt } = require('../_shared/master-prompt.js');
const CF = require('../_shared/copy-frameworks.js');
const fs = require('fs');
const path = require('path');

// ─── KNICKGASM store URLs (verified per CLAUDE.md) ─────────────────────────────
function regionBase(market) {
  const m = String(market || '').toUpperCase();
  const map = {
    US: 'https://knickgasm.com',
    UK: 'https://knickgasm.com',
    IN: 'https://knickgasm.com',
    EU: 'https://knickgasm.com',
    AU: 'https://knickgasm.com',
    CA: 'https://knickgasm.com',
    JP: 'https://knickgasm.com',
    SG: 'https://knickgasm.com',
    ME: 'https://knickgasm.com',
    GLOBAL: 'https://knickgasm.com',
  };
  return map[m] || 'https://knickgasm.com';
}

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/['’.]/g, '').replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Best-effort SKU→handle lookup from the built catalog (data/catalog/products_<region>.json).
const _catalogCache = {};
function lookupHandle(market, sku) {
  if (!sku) return null;
  const region = ({ US: 'usa', UK: 'uk' })[String(market || '').toUpperCase()] || 'global';
  if (!(region in _catalogCache)) {
    _catalogCache[region] = null;
    try {
      const p = path.join(__dirname, '..', '..', 'data', 'catalog', `products_${region}.json`);
      if (fs.existsSync(p)) _catalogCache[region] = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { /* ignore */ }
  }
  const cat = _catalogCache[region];
  if (!Array.isArray(cat)) return null;
  const hit = cat.find((p) => (p.sku || p.variant_sku) === sku || p.s === sku);
  return hit ? (hit.h || hit.handle || null) : null;
}

// Map a content type / festival to a sensible collection slug.
function collectionForEntry(entry) {
  const tags = (entry.festival_tags || []).map((t) => String(t).toLowerCase());
  if (tags.includes('gift')) return 'gift-sets';
  switch (String(entry.content_type || '').toLowerCase()) {
    case 'launch':   return 'new-arrivals';
    case 'editorial':return 'bestsellers';
    case 'winback':  return 'bestsellers';
    case 'lifecycle':return 'sneaker';
    case 'promo':    return 'bestsellers';
    default:         return 'bestsellers';
  }
}

// Resolve the single CTA destination for a calendar entry → a real KNICKGASM URL.
function ctaUrlForEntry(entry, market) {
  const base = regionBase(market);
  // 1. Precise product page if we know the handle (or can resolve it from the SKU).
  const handle = entry.hero_handle || lookupHandle(market, entry.hero_sku);
  if (handle) return `${base}/products/${handle}`;
  // 2. Otherwise the relevant collection page.
  const slug = collectionForEntry(entry);
  if (slug) return `${base}/collections/${slug}`;
  // 3. Last resort: on-site search for the hero product so the link still lands somewhere real.
  if (entry.hero_product) return `${base}/search?q=${encodeURIComponent(entry.hero_product)}`;
  return base;
}

function buildBriefFromEntry(entry, fw) {
  const framework = fw || CF.pickCopyFrameworkForCalendar({ framework: entry.framework, content_type: entry.content_type, segment: entry.segment, seed: `${entry.date}_${entry.segment}` });
  const parts = [
    `Campaign date: ${entry.date}`,
    `Market: ${entry.market}`,
    `Audience segment: ${entry.segment}${entry.segment_size ? ` (~${entry.segment_size} customers)` : ''}`,
    `Content type: ${entry.content_type}`,
    `Layout archetype: ${entry.archetype}`,
    `Hero product: ${entry.hero_product || entry.hero_sku}`,
    entry.festival ? `Cultural moment: ${entry.festival} (weight ${entry.festival_weight}/10)` : null,
    `Subject-line direction: ${entry.subject_hint}`,
    (entry.feedback && String(entry.feedback).trim()) ? `\nREVIEWER FEEDBACK to incorporate on this regeneration (highest priority, override earlier guidance where it conflicts): ${String(entry.feedback).trim()}` : null,
    '',
    'Strategist guidance:',
    `- Stay strictly on KNICKGASM brand voice: warm, sensory, story-driven. No "transform", no "streetwear journey", no all-caps urgency.`,
    `- Match the archetype layout convention (see project brand spec).`,
    `- One CTA, one hero product, optional 2-3 supporting products.`,
    `- For ${entry.segment}: ${segmentVoiceGuide(entry.segment, entry.content_type)}`,
    '',
    CF.copyFrameworkBriefBlock(framework),
  ].filter(Boolean).join('\n');

  return parts;
}

// Derive on-brand copy from a calendar entry when the LLM strategy stage cannot
// return parseable JSON. Keeps the mailer build alive instead of 503-ing.
function heuristicStrategy(entry, market, framework) {
  const seg = entry.segment || 'you';
  const type = String(entry.content_type || '').toLowerCase();
  const subjectHint = entry.subject_hint || '';

  // What is this send actually about? An offering can be an event, a
  // programme, a section, a plan or a service - not only a product. The
  // fallback used to assume a product and shipped shopping copy (plus prose
  // inherited from a previous brand), which read as nonsense for an event.
  const offering = entry.heroOffering || entry.offering || null;
  const plan = offering ? OfferingCampaign.planSend(offering, entry.date) : null;

  // A finished event must not be written about as if it were upcoming.
  if (plan && !plan.viable) {
    return {
      subject_line: `[SLOT NOT VIABLE]`,
      preview_text: plan.reason.slice(0, 90),
      hero_headline: 'Nothing to promote for this slot',
      hero_subline: plan.reason,
      body_blocks: [{ heading: 'Why this is empty', body: plan.reason }],
      cta_text: '',
      not_viable: true,
    };
  }

  const name = (plan && plan.offering.name) || entry.hero_product || entry.hero_sku || 'this';
  const kind = plan ? plan.kind : 'product';
  const cta = plan ? plan.cta
    : (type === 'promo' ? 'Shop now' : type === 'launch' ? 'Discover it' : type === 'winback' ? 'Come back' : 'See more');

  // Copy shaped by what the reader is being asked to DO.
  let subject, preview, headline, subline, body_blocks;
  if (kind === 'event') {
    const when = String(plan.offering.starts_at || '').slice(0, 10);
    const days = plan.days_until;
    subject = subjectHint || (plan.phase === 'follow-up' ? `Thank you for joining ${name}` : `${name}, ${when}`);
    preview = plan.phase === 'follow-up'
      ? `How ${name} went, and what is next.`
      : `${when}${days > 0 ? ` - ${days} day${days === 1 ? '' : 's'} away` : ' - today'}.`;
    headline = plan.phase === 'follow-up' ? `That is a wrap on ${name}` : name;
    subline = plan.job;
    body_blocks = plan.phase === 'follow-up'
      ? [{ heading: 'Thank you', body: `${name} has happened. This is a note of thanks and a look at what comes next - nothing here asks anyone to register.` }]
      : [
          { heading: 'What it is', body: `${name}${plan.offering.venue ? `, at ${plan.offering.venue}` : ''}${when ? `, on ${when}` : ''}.` },
          { heading: 'Who it is for', body: `Written for the ${seg} segment: why this is worth their time.` },
          { heading: 'How to take part', body: plan.cta_url ? `Registration: ${plan.cta_url}` : '[DATA REQUIRED BEFORE LAUNCH: registration link]' },
        ];
  } else if (kind === 'programme') {
    subject = subjectHint || `${name}, every ${plan.offering.cadence || 'week'}`;
    preview = `A routine you can actually keep.`;
    headline = name;
    subline = plan.job;
    body_blocks = [
      { heading: 'The routine', body: `${name} runs ${plan.offering.cadence || 'on a regular cadence'}${plan.offering.duration ? ` over ${plan.offering.duration}` : ''}.` },
      { heading: 'What changes', body: 'What the reader can expect by the end, stated without promising an outcome that cannot be evidenced.' },
    ];
  } else if (kind === 'section' || kind === 'plan') {
    subject = subjectHint || name;
    preview = kind === 'plan' ? 'What your subscription unlocks.' : 'Worth your next five minutes.';
    headline = name;
    subline = plan.job;
    body_blocks = [{ heading: 'Why now', body: `Why ${name} is worth returning to for the ${seg} segment.` }];
  } else if (kind === 'service') {
    subject = subjectHint || `Commission ${name}`;
    preview = plan.offering.lead_time ? `Made to order, ${plan.offering.lead_time}.` : 'Made to order.';
    headline = name;
    subline = plan.job;
    body_blocks = [
      { heading: 'How it works', body: `Brief, then made to order${plan.offering.lead_time ? ` in ${plan.offering.lead_time}` : ''}.` },
    ];
  } else {
    subject = (subjectHint || `${name}`).toString().slice(0, 60);
    preview = `Chosen for the ${seg} segment.`;
    headline = (subjectHint ? subjectHint.split(/[.!?]/)[0] : name).toString().split(/\s+/).slice(0, 8).join(' ');
    subline = `Why this one, for this reader, now.`;
    body_blocks = [
      { heading: 'What it is', body: `${name}: the facts the catalogue actually states, never invented ones.` },
      { heading: 'Why this reader', body: `What makes it right for the ${seg} segment.` },
    ];
  }

  return {
    subject_line: String(subject).slice(0, 60),
    preview_text: String(preview).slice(0, 90),
    hero_headline: String(headline),
    hero_subline: String(subline),
    body_blocks,
    cta_text: cta,
    cta_url: plan ? plan.cta_url : null,
    campaign_phase: plan ? plan.phase : 'evergreen',
  };
}

function segmentVoiceGuide(segment, contentType) {
  const map = {
    Champions:        'reward, don\'t discount. Surface something new or limited.',
    Loyal:            'depth, story, origin. Editorial tone over promo.',
    Promising:        'continuity — show the next step in the ritual.',
    New:              'guide the second step. Teach crafting, suggest pairings.',
    'Need-Attention': 'soft re-engagement, no aggressive discount yet.',
    'About-to-Sleep': 'gentle reminder + curated 3-pick. Question-based subject.',
    'At-Risk':        'one personal note, one fair offer, single CTA.',
    Hibernating:      'short brand note from the team (never a founder or personal voice), no discount, link to one curated read.',
    Lost:             'do not send.',
  };
  return map[segment] || 'professional, warm, on-brand.';
}

async function safeCall(fn, label) {
  try {
    return { ok: true, data: await fn(), label };
  } catch (e) {
    return { ok: false, error: e.message || String(e), label };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const entry = body.entry;
  if (!entry || !entry.market || !entry.segment) {
    return res.status(400).json({ error: 'body.entry must include at minimum { market, segment, archetype, hero_sku }' });
  }

  const market = body.market_override || entry.market;

  const framework = CF.pickCopyFrameworkForCalendar({ framework: entry.framework, content_type: entry.content_type, segment: entry.segment, seed: `${entry.date}_${entry.segment}` });
  const brief = buildBriefFromEntry(entry, framework);
  const runs  = [];

  // ── Stage 1: Strategy (subject + headline + bullets + CTA) ──
  const strategy = await safeCall(async () => {
    const out = await llm({
      systemPrompt:
        'You are KNICKGASM\'s lifecycle copywriter. Produce a strict JSON object with keys: ' +
        'subject_line (string, ≤ 60 chars), preview_text (string, ≤ 90 chars), ' +
        'hero_headline (string, ≤ 8 words), hero_subline (string, ≤ 18 words), ' +
        'body_blocks (array of {heading, body}), cta_text (string, ≤ 4 words). ' +
        'Use KNICKGASM brand voice (warm, sensory, story-driven). ' +
        CF.copyFrameworkSystemLine(framework) + ' No banned phrases.',
      userMessage: brief,
      responseFormat: { type: 'json_object' },
      maxTokens: 3000,
      temperature: 0.75,
      stage: 'strategy',
      tier: 'premium',
    });
    return (llm.parseJSON ? llm.parseJSON(out.text) : JSON.parse(out.text));
  }, 'strategy');

  // Graceful fallback: a parse/provider failure on the copy JSON must NOT dead-end
  // the whole mailer build. Derive on-brand copy from the calendar entry itself so
  // the mailer still renders (mirrors the heuristic fallback in ai/pipeline/strategy.js).
  let S, strategyHeuristic = false;
  if (strategy.ok && strategy.data && strategy.data.subject_line) {
    S = strategy.data;
    runs.push({ stage: 'strategy', ok: true, error: null });
  } else {
    strategyHeuristic = true;
    S = heuristicStrategy(entry, market, framework);
    runs.push({ stage: 'strategy', ok: true, error: null, heuristic: true, llm_error: strategy.ok ? 'empty_or_invalid_copy_json' : strategy.error });
  }

  // Brand scrub — every LLM copy string passes sanitizeBrand (CLAUDE.md banned
  // phrases → preferred lexicon) before it reaches a rendered mailer. Failure
  // to load the scrubber never blocks the request.
  try {
    const { sanitizeBrand } = require('../_shared/scenario-model.js');
    S.subject_line  = sanitizeBrand(S.subject_line);
    S.preview_text  = sanitizeBrand(S.preview_text);
    S.hero_headline = sanitizeBrand(S.hero_headline);
    S.hero_subline  = sanitizeBrand(S.hero_subline);
    S.cta_text      = sanitizeBrand(S.cta_text);
    if (Array.isArray(S.body_blocks)) {
      S.body_blocks = S.body_blocks.map((b) => ({
        ...b,
        heading: sanitizeBrand(b && b.heading),
        body: sanitizeBrand(b && b.body),
      }));
    }
  } catch (e) {
    console.warn('[calendar-trigger] sanitizeBrand unavailable: ' + String(e && e.message || e).slice(0, 120));
  }

  const ctaUrl = ctaUrlForEntry(entry, market);

  // ── Stage 2: EXACTLY 2 variants per region ───────────────────────────────
  //   V1 — COMPLETE TEXTUAL content only (pure copy, no imagery).
  //   V2 — TEXTUAL + VISUAL (images/gifs/videos). Visual source cascade:
  //          (1) provided hosted media URL → (2) auto-generated animated GIF
  //          from product image frames → (3) AI-generated video (last resort).
  // Each variant carries the same strategy so they read as a coherent campaign,
  // plus a portable `master_prompt` (built from the shared master-prompt module).
  // Products in scope for the master prompt (hero + any supporting picks on entry).
  const promptProducts = [
    { title: entry.hero_product || entry.hero_sku, handle: entry.hero_handle, sku: entry.hero_sku, price: entry.hero_price },
    ...((Array.isArray(entry.supporting_products) ? entry.supporting_products : [])),
  ].filter((p) => p && (p.title || p.handle || p.sku));

  const sharedText = {
    subject: S.subject_line,
    hero_headline: S.hero_headline,
    hero_subline: S.hero_subline,
    body_blocks: S.body_blocks || [],
    cta_text: S.cta_text || 'Shop the edit',
    cta_url: ctaUrl,
    market,
    // Flagship-parity: real inline product grid + derived collection CTA.
    products: promptProducts,
    collection_url: `${regionBase(market)}/collections/${collectionForEntry(entry)}`,
  };

  const variants = {
    V1: {
      kind: 'text',
      type: 'V1',
      label: 'V1 · Complete Text (no imagery)',
      style: 'pure',
      preview_text: S.preview_text,
      cta_url: ctaUrl,
      html: renderTextVariant({ ...sharedText, style: 'pure' }),
      master_prompt: buildMasterPrompt({
        assetType: 'mailer', variant: 'V1', market, brief, products: promptProducts, cohort: entry.segment,
      }),
    },
    V2: {
      kind: 'text+visual',
      type: 'V2',
      label: 'V2 · Text + Visual',
      style: 'visual',
      preview_text: S.preview_text,
      cta_url: ctaUrl,
      html: renderTextVariant({ ...sharedText, style: 'visual', hero_product: entry.hero_product, hero_sku: entry.hero_sku }),
      // Visual source cascade, in priority order:
      //   1. provided hosted media URL (product image/GIF/MP4), if present on the entry
      //   2. auto-generated animated GIF from product image frames
      //   3. AI-generated video (last resort)
      visual_cascade: ['hosted_media_url', 'auto_gif_from_product_frames', 'ai_generated_video'],
      hosted_media_url: entry.hero_media_url || entry.hero_video_url || null,
      hero_image_brief:
        `On-brand KNICKGASM email visual for "${S.subject_line}". Hero ${entry.hero_product || entry.hero_sku}. ` +
        `Editorial photography or gentle product-frame motion (animated GIF), one-of-one provenance, ` +
        `elegant negative space, cinematic light. Brand palette only (violet #D0473E, lava #6A33D8, chalk #FFFFFF). ` +
        `Mood: warm, restrained, gift-worthy. No on-image text.`,
      master_prompt: buildMasterPrompt({
        assetType: 'mailer', variant: 'V2', market, brief, products: promptProducts, cohort: entry.segment,
      }),
    },
  };

  // ── OPTIONAL real hero image for the V2 visual variant ────────────────────
  // Runs the existing image cascade in-process (creative-image.js mock-req/res
  // shim), hard time-boxed at 30s. Failure-silent by design: any error, timeout,
  // or missing provider keeps V2 exactly as rendered above (brand-palette hero
  // block, no imagery). A provided hosted media URL always wins over generation.
  if (!variants.V2.hosted_media_url) {
    let timer = null;
    try {
      const { generateCreativeImage, uploadCreative } = require('../_shared/creative-image.js');
      const gen = await Promise.race([
        generateCreativeImage(variants.V2.hero_image_brief, { size: '1536x1024' }),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), 30000); }),
      ]);
      // image.js never 502s — on total failure it returns an on-brand SVG
      // placeholder (provider 'placeholder'). Only a REAL generated photo may
      // upgrade the variant; placeholders keep the current no-image render.
      const isReal = gen && gen.image &&
        gen.provider !== 'placeholder' &&
        String(gen.image).indexOf('data:image/svg') !== 0;
      if (isReal) {
        // Prefer a small hosted URL (Supabase Storage) over a multi-MB data-URL.
        const hosted = await uploadCreative(gen.image, `calendar-v2-${slugify(entry.date || entry.segment || 'hero')}`).catch(() => null);
        const heroImageUrl = hosted || gen.image;
        variants.V2.hero_image_url = heroImageUrl;
        variants.V2.hero_image_provider = gen.provider || null;
        variants.V2.html = renderTextVariant({
          ...sharedText, style: 'visual',
          hero_product: entry.hero_product, hero_sku: entry.hero_sku,
          hero_image_url: heroImageUrl,
        });
        runs.push({ stage: 'hero-image', ok: true, error: null });
      } else {
        runs.push({ stage: 'hero-image', ok: false, error: 'skipped_or_unavailable' });
      }
    } catch (e) {
      runs.push({ stage: 'hero-image', ok: false, error: String(e && e.message || e).slice(0, 160) });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ── Expose the 4-variant grid the calendar modal + Studio handoff expect ──
  // Type A (image-led) and Type B (text-led), two each. B1/B2 reuse the built
  // text mailers so they render as full HTML previews; A1/A2 are image-led
  // variants carrying an editorial hero brief (and the generated hero image when
  // available) so every tab loads real content instead of "Variant unavailable".
  const heroBriefBase = variants.V2.hero_image_brief;
  variants.A1 = {
    kind: 'image', type: 'A1', label: 'A1 · Image · Hero close-up',
    cta_url: ctaUrl, preview_text: S.preview_text,
    hero_image_url: variants.V2.hero_image_url || null,
    hero_image_provider: variants.V2.hero_image_provider || null,
    hero_image_brief: `${heroBriefBase} Composition: tight hero close-up of ${entry.hero_product || entry.hero_sku} on a chalk linen surface, shallow depth of field, warm morning light.`,
    master_prompt: variants.V2.master_prompt,
  };
  variants.A2 = {
    kind: 'image', type: 'A2', label: 'A2 · Image · Lifestyle wide',
    cta_url: ctaUrl, preview_text: S.preview_text,
    hero_image_url: variants.V2.hero_image_url || null,
    hero_image_provider: variants.V2.hero_image_provider || null,
    hero_image_brief: `${heroBriefBase} Composition: wide lifestyle scene showing the offering in genuine use by its audience, generous negative space, natural light. Never invent a setting the brand does not actually have.`,
    master_prompt: variants.V2.master_prompt,
  };
  variants.B1 = { ...variants.V2, kind: 'text', type: 'B1', label: 'B1 · Text + Visual' };
  variants.B2 = { ...variants.V1, kind: 'text', type: 'B2', label: 'B2 · Complete Text' };

  return res.status(200).json({
    ok: true,
    entry,
    strategy: S,
    framework: framework.key,
    framework_name: `${framework.name} (${framework.full})`,
    cta_url: ctaUrl,
    variants,
    runs,
    ...(strategyHeuristic ? { strategy_heuristic: true } : {}),
  });
};

// ─── Text-variant renderer (brand-compliant) ───────────────────────────────
// Public wrapper: renders the variant body, then stamps the lava-standard
// subject-metadata header (mailer-format.js) so every mailer path is uniform.
const MF = require('./mailer-format.js');
function renderTextVariant(opts) {
  const html = _renderVariantBody(opts || {});
  return MF.withSubjectMeta(html, {
    subject: opts && opts.subject,
    alts: (opts && opts.subject_alts) || [],
    preheader: (opts && opts.preheader) || (opts && opts.preview_text) || '',
  });
}
// Legal sender identity for email footers (CAN-SPAM: a real physical mailing
// address is required in every commercial email). SAME constants the flagship
// engine (brain-generate.js) uses, so every mailer path carries an identical
// compliant footer.
const ORG_NAME = 'Knickgasm Global, Inc';
const ORG_ADDRESS = '440 N Barranca Ave #2812, Covina, CA 91723, United States';
// Real hosted product photos (Shopify CDN) resolved by handle/title, the SAME
// source the flagship mailer uses, so a product tile never renders imageless.
let _catImg = null;
try { _catImg = require('./catalog-image.js'); } catch (_) {}
function _productImg(p, market) {
  if (!p) return null;
  const hd = (u) => (_catImg && _catImg.hd ? (_catImg.hd(u, 600) || u) : u);
  const d = p.image || p.image_url || p.i;
  if (typeof d === 'string' && /^https?:\/\//.test(d)) return hd(d);
  if (_catImg && _catImg.imageFor) {
    return _catImg.imageFor({ handle: p.handle || p.h, title: p.title || p.n }, market, { width: 600 }) || null;
  }
  return null;
}
// Real per-product copy pulled from the catalog (the same content the PDP
// carries): a short subtitle or design-note line. Used to enrich grid cards so
// each section shows genuine product content, never invented blurbs.
function _productNote(p, market) {
  if (!p) return '';
  let s = p.note || p.subtitle || p.tasting_notes || '';
  if (!s && _catImg && _catImg.match) {
    const row = _catImg.match({ handle: p.handle || p.h, title: p.title || p.n }, market);
    if (row) s = row.subtitle || row.tasting_notes || '';
  }
  return s ? String(s) : '';
}

function _brandClaims() {
  // Only claims the brand itself states. No fallback copy: an unstated claim is
  // not written, because a trust bar is exactly where an invented one would do
  // the most damage.
  try { return (require('./brand-runtime.js').defaultBrand().claims || []).slice(0, 3); }
  catch (_) { return []; }
}

function _renderVariantBody({ style, subject, hero_headline, hero_subline, body_blocks, cta_text, cta_url, market, hero_product, hero_sku, hero_image_url, hero_prompt, products, offer_bar, collection_url }) {
  const brandClaims = _brandClaims();
  // CTA points at the resolved product/collection page; the brand domain still
  // falls back per-market if no specific destination was provided.
  const baseUrl = cta_url || regionBase(market);
  const store = regionBase(market);
  const cur = String(market || '').toUpperCase() === 'UK' ? '£' : '$';
  const HEAD = "'Montserrat','Raleway',Georgia,serif";
  const BODY = "'Instrument Sans','Helvetica Neue',Arial,sans-serif";

  const palette = {
    green: '#D0473E', lava: '#6A33D8', ink: '#111111', chalk: '#FFFFFF',
  };

  // ── Flagship-parity shared fragments (identical logic to brain-generate.js) ──
  // Brand header: KNICKGASM wordmark linking to the market store (the ONLY header
  // link, matching the flagship's logo→store rule).
  const brandHeader = `
      <tr><td align="center" style="padding:18px 0 6px;">
        <a href="${store}" target="_blank" style="text-decoration:none;display:inline-block;">
          <div style="font-family:${HEAD};font-size:22px;letter-spacing:0.28em;color:${palette.green};font-weight:700;">KNICKGASM</div>
          <div style="font-family:${BODY};font-size:10px;letter-spacing:0.22em;color:${palette.lava};text-transform:uppercase;margin-top:4px;">${esc(market)} · One-of-One Sneaker</div>
        </a>
      </td></tr>`;
  // Optional lava offer bar (only when an offer string is supplied).
  const offerBarRow = offer_bar ? `
      <tr><td align="center" style="background:${palette.lava};padding:9px 14px;font-family:${BODY};font-size:12px;font-weight:700;color:${palette.ink};">${esc(offer_bar)}</td></tr>` : '';
  // Compact product grid: real inline images + PDP links, up to 3 across one row
  // (never one-product-per-vertical-section). Matches the flagship grid exactly.
  const gridProducts = Array.isArray(products) ? products.filter(Boolean).slice(0, 3) : [];
  const productGrid = gridProducts.length ? `
      <tr><td style="padding:16px 20px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${gridProducts.map((p) => {
    const img = _productImg(p, market);
    const note = _productNote(p, market);
    const pdp = p.url || ((p.handle || p.h) ? `${store}/products/${p.handle || p.h}` : baseUrl);
    const price = (p.price != null && p.price !== '') ? `${cur}${p.price}` : '';
    return `<td align="center" valign="top" style="width:33%;padding:8px;">
          <a href="${pdp}" target="_blank" style="text-decoration:none;">
            <div style="background:${palette.chalk};border:1px solid ${palette.lava}33;border-radius:10px;padding:12px 8px 16px;">
              ${img ? `<img src="${esc(img)}" alt="${esc(p.title || p.n || '')}" width="140" style="width:100%;max-width:140px;height:auto;border-radius:8px;display:block;margin:0 auto 10px;" />` : ''}
              <div style="font-family:${HEAD};font-size:14px;color:${palette.ink};line-height:1.35;">${esc(p.title || p.n || '')}</div>
              ${note ? `<div style="font-family:${BODY};font-size:11px;color:#7a6e5a;margin-top:4px;line-height:1.4;">${esc(note)}</div>` : ''}
              ${price ? `<div style="font-family:${BODY};font-size:13px;color:${palette.lava};margin-top:6px;font-weight:600;">${price}</div>` : ''}
            </div>
          </a></td>`;
  }).join('')}
        </tr></table>
      </td></tr>` : '';
  // Secondary outline CTA → collection page (derived, or provided).
  const collectionHref = collection_url || `${store}/collections/bestsellers`;
  const secondaryCta = `
      <tr><td align="center" style="padding:6px 24px 6px;">
        <a href="${collectionHref}" target="_blank" style="display:inline-block;font-family:${BODY};font-size:13px;font-weight:700;color:${palette.green};border:1.5px solid ${palette.lava};border-radius:8px;padding:11px 24px;text-decoration:none;">Explore the collection</a>
      </td></tr>`;
  // CAN-SPAM footer — nothing clickable except the brand mark (in the header).
  // Brand HARD rule: NEVER a black / near-black section background. The footer
  // sits on deep purple (#D0473E); chalk + lava text stay high-contrast on it.
  const brandFooter = `
      <tr><td align="center" style="background:${palette.green};padding:22px 20px 28px;">
        <div style="font-family:${HEAD};font-size:14px;letter-spacing:0.24em;color:${palette.chalk};">KNICKGASM</div>
        ${brandClaims.length ? `<div style="font-family:${BODY};font-size:10.5px;letter-spacing:0.05em;color:${palette.lava};margin:8px 0;">${brandClaims.join(" &middot; ")}</div>` : ""}
        <div style="font-family:${BODY};font-size:11px;color:${palette.chalk}99;line-height:1.7;">${ORG_NAME} &middot; ${ORG_ADDRESS}<br>You are receiving this as a valued KNICKGASM ${esc(market)} customer. Carbon &amp; plastic neutral.<br>Manage preferences or unsubscribe from your account settings.</div>
      </td></tr>`;

  const blocks = (body_blocks || []).map((b) => `
    <tr><td style="padding:18px 32px 0;">
      <p style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:20px;color:${palette.green};margin:0 0 6px;letter-spacing:0.2px;">${esc(b.heading || '')}</p>
      <p style="font-family:'Instrument Sans','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.65;color:${palette.ink};margin:0;">${esc(b.body || '')}</p>
    </td></tr>`).join('');

  // ── V2 · Text + Visual: same editorial copy with a botanical lava divider
  //    and a brand palette hero block. Visual elements stay light and on-brand.
  if (style === 'visual') {
    const heroLabel = hero_product ? esc(hero_product) : 'Today on the detailing table';
    // Real hero photograph if we have one; otherwise, when a generation prompt
    // is supplied, emit the lava-standard IMAGE GENERATION PROMPT comment + a
    // PASTE_IMAGE_URL_HERE slot the asset agent fills. With neither, the
    // variant renders as before (brand-palette hero block only).
    const heroImgRow = hero_image_url ? `
      <tr><td style="padding:20px 32px 0;">
        <img src="${esc(hero_image_url)}" width="536" alt="${heroLabel}" style="display:block;width:100%;height:auto;border-radius:6px;" />
      </td></tr>` : (hero_prompt ? `
      <tr><td style="padding:20px 32px 0;">
        ${MF.assetSlot({ kind: 'image', slot: 'hero', displayW: 536, displayH: 340, prompt: hero_prompt, alt: hero_product || 'hero' })}
      </td></tr>` : '');
    return `<!doctype html>
<html><body style="margin:0;padding:0;background:${palette.chalk};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${palette.chalk};">
  <tr><td align="center" style="padding:36px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #ece4d2;">
      ${offerBarRow}${brandHeader}${heroImgRow}
      <tr><td style="padding:20px 32px 0;">
        <!-- Brand-palette hero block (no external image needed) -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${palette.green};border-radius:6px;">
          <tr><td style="padding:34px 26px;text-align:center;">
            <div style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:11px;letter-spacing:0.18em;color:${palette.lava};text-transform:uppercase;margin-bottom:8px;">${heroLabel}</div>
            <div style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:26px;line-height:1.2;color:${palette.chalk};font-weight:500;">${esc(hero_headline)}</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:22px 32px 0;">
        <p style="font-family:'Instrument Sans','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.65;color:${palette.ink};margin:0;">${esc(hero_subline)}</p>
      </td></tr>
      <!-- Botanical-style lava divider -->
      <tr><td style="padding:20px 32px 0;text-align:center;">
        <div style="display:inline-block;height:1px;width:38%;background:${palette.lava};vertical-align:middle;"></div>
        <span style="display:inline-block;vertical-align:middle;color:${palette.lava};font-family:'Montserrat','Raleway',Georgia,serif;font-size:14px;padding:0 12px;">✦</span>
        <div style="display:inline-block;height:1px;width:38%;background:${palette.lava};vertical-align:middle;"></div>
      </td></tr>
      ${blocks}
      ${productGrid}
      <tr><td style="padding:26px 32px 8px;text-align:center;border-top:1px solid #ece4d2;">
        <a href="${baseUrl}" style="display:inline-block;background:${palette.green};color:${palette.chalk};text-decoration:none;padding:14px 30px;font-family:'Instrument Sans',sans-serif;font-size:14px;letter-spacing:1.4px;text-transform:uppercase;">${esc(cta_text)}</a>
      </td></tr>
      ${secondaryCta}
      ${brandFooter}
    </table>
  </td></tr>
</table>
</body></html>`;
  }

  // ── V1 · Pure Text: simple, monospace-free, no decorative blocks at all.
  if (style === 'pure') {
    const textBlocks = (body_blocks || []).map((b) => `
      <p style="font-family:'Instrument Sans','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.7;color:${palette.ink};margin:0 0 14px;">
        ${b.heading ? `<strong style="color:${palette.green};">${esc(b.heading)}: </strong>` : ''}${esc(b.body || '')}
      </p>`).join('');
    return `<!doctype html>
<html><body style="margin:0;padding:0;background:#fff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 8px;">
        <p style="font-family:'Instrument Sans','Helvetica Neue',Arial,sans-serif;font-size:11px;letter-spacing:0.16em;color:${palette.lava};text-transform:uppercase;margin:0 0 10px;">KNICKGASM · ${esc(market)}</p>
        <h1 style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:28px;line-height:1.25;color:${palette.green};margin:0 0 10px;font-weight:500;">${esc(hero_headline)}</h1>
        <p style="font-family:'Instrument Sans','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.65;color:${palette.ink};margin:0 0 22px;">${esc(hero_subline)}</p>
        ${textBlocks}
        <p style="font-family:'Instrument Sans',sans-serif;font-size:14px;line-height:1.6;color:${palette.ink};margin:24px 0 6px;">
          <a href="${baseUrl}" style="color:${palette.green};text-decoration:underline;font-weight:600;">${esc(cta_text)} →</a>
        </p>
        <p style="font-family:'Instrument Sans',sans-serif;font-size:11px;color:#7a6e5a;margin:18px 0 0;">The KNICKGASM team</p>
        <p style="font-family:'Instrument Sans',sans-serif;font-size:11px;line-height:1.7;color:#9a8f7c;margin:20px 0 0;border-top:1px solid #ece4d2;padding-top:16px;">${ORG_NAME}, ${ORG_ADDRESS}<br>You are receiving this as a valued KNICKGASM ${esc(market)} customer. Manage preferences or unsubscribe from your account settings.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  }

  if (style === 'founder') {
    return `<!doctype html>
<html><body style="margin:0;padding:0;background:${palette.chalk};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${palette.chalk};">
  <tr><td align="center" style="padding:36px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #ece4d2;">
      ${offerBarRow}${brandHeader}
      <tr><td style="padding:24px 32px 0;">
        <p style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:30px;line-height:1.25;color:${palette.green};margin:0 0 10px;font-weight:500;">${esc(hero_headline)}</p>
        <p style="font-family:'Instrument Sans','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.6;color:${palette.ink};margin:0 0 8px;">${esc(hero_subline)}</p>
        <p style="font-family:'Instrument Sans',sans-serif;font-size:13px;color:#7a6e5a;margin:0;">A note from the detailing table</p>
      </td></tr>
      ${blocks}
      ${productGrid}
      <tr><td style="padding:26px 32px 8px;text-align:center;">
        <a href="${baseUrl}" style="display:inline-block;background:${palette.green};color:${palette.chalk};text-decoration:none;padding:14px 30px;font-family:'Instrument Sans',sans-serif;font-size:14px;letter-spacing:1.4px;text-transform:uppercase;">${esc(cta_text)}</a>
      </td></tr>
      ${secondaryCta}
      ${brandFooter}
    </table>
  </td></tr>
</table>
</body></html>`;
  }

  // editorial style (default)
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${palette.chalk};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${palette.chalk};">
  <tr><td align="center" style="padding:36px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #ece4d2;">
      ${offerBarRow}${brandHeader}
      <tr><td style="padding:20px 32px 0;border-bottom:1px solid #ece4d2;">
        <h1 style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:34px;line-height:1.18;color:${palette.green};margin:0 0 8px;font-weight:500;letter-spacing:-0.3px;">${esc(hero_headline)}</h1>
        <p style="font-family:'Instrument Sans','Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.55;color:${palette.ink};margin:0 0 24px;">${esc(hero_subline)}</p>
      </td></tr>
      ${blocks}
      ${productGrid}
      <tr><td style="padding:26px 32px 8px;text-align:center;border-top:1px solid #ece4d2;">
        <a href="${baseUrl}" style="display:inline-block;background:${palette.green};color:${palette.chalk};text-decoration:none;padding:14px 30px;font-family:'Instrument Sans',sans-serif;font-size:14px;letter-spacing:1.4px;text-transform:uppercase;">${esc(cta_text)}</a>
      </td></tr>
      ${secondaryCta}
      ${brandFooter}
    </table>
  </td></tr>
</table>
</body></html>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

// ─── Named helper exports (additive — zero behavior change) ─────────────────
// module.exports stays the HTTP handler above; these let sibling _shared
// modules (lifecycle-mailer-build.js) reuse the exact same brand-compliant
// renderer instead of copying it.
module.exports.helpers = { renderTextVariant, regionBase, lookupHandle, esc };
