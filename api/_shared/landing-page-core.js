const callLLM = require('./llm.js');
const SM = require('./scenario-model.js');
const brandRuntime = require('./brand-runtime.js');
const offeringKinds = require('./offering-kinds.js');
const { runDesignLoop } = require('./lp-design-loop.js');
let DESIGN = null;
try { DESIGN = require('../../data/design-intelligence.js'); } catch (_) { DESIGN = null; }

const scrub = (value) => {
  try { return SM.sanitizeBrand ? SM.sanitizeBrand(String(value || '')) : SM.scrubDashes(String(value || '')); }
  catch (_) { return String(value || '').replace(/[\u2013\u2014]/g, '-'); }
};

// Tenant zero's region map, used only when the ACTIVE brand has no region row
// for the requested market. It is a fallback of last resort, not the default:
// resolveStore() below prefers the caller's own brand every time.
const STORE = {
  US: 'https://knickgasm.com',
  UK: 'https://knickgasm.com',
  India: 'https://knickgasm.in',
  IN: 'https://knickgasm.in',
  Global: 'https://knickgasm.com',
  EU: 'https://knickgasm.com',
  AU: 'https://knickgasm.com',
  ME: 'https://knickgasm.com',
};

/**
 * One market can be written more than one way across this app: the UI offers a
 * readable "India" while a brand record stores the ISO "IN", and the STORE map
 * below carries both because both reach it. An exact string comparison would
 * therefore miss a brand's India storefront and quietly fall through to its
 * global website, sending India traffic to the wrong checkout.
 */
const MARKET_ALIASES = {
  INDIA: 'IN', BHARAT: 'IN',
  USA: 'US', 'UNITED STATES': 'US', AMERICA: 'US',
  UK: 'UK', GB: 'UK', 'UNITED KINGDOM': 'UK', BRITAIN: 'UK',
  UAE: 'ME', 'MIDDLE EAST': 'ME',
  AUSTRALIA: 'AU', EUROPE: 'EU', WORLDWIDE: 'GLOBAL', INTERNATIONAL: 'GLOBAL',
};
function canonicalMarket(code) {
  const raw = String(code || '').trim().toUpperCase();
  return MARKET_ALIASES[raw] || raw;
}

/**
 * The store base for THIS brand and THIS market. Never another brand's domain,
 * and never another market's.
 *
 * The market must match EXACTLY. brandRuntime.regionFacts() falls back to the
 * first configured region when the requested one is absent, which is right for
 * a prompt that just needs a currency example and wrong here: the page tells
 * the model its links must match the requested market, and the market picker
 * offers every market, so a brand configured only for UK would have sent US
 * traffic to a UK checkout while the page claimed to be the US page.
 */
function resolveStore(brand, market) {
  const want = canonicalMarket(market);
  const regions = (brand && Array.isArray(brand.regions)) ? brand.regions : [];
  const hit = regions.find((r) => r && canonicalMarket(r.code) === want);
  if (hit && hit.store_url) return 'https://' + String(hit.store_url).replace(/^https?:\/\//, '');

  // No region row for this market. The brand's OWN website comes next, and it
  // must come before the tenant-zero map: isDefault() keys off the presence of
  // a workspace id, so any brand object without one - a preset, a record passed
  // in directly - would otherwise be handed tenant zero's storefront.
  if (brand && brand.website) return brand.website;

  // Tenant zero keeps a per-market map here rather than on its record. Two
  // conditions, because neither alone is sufficient: isDefault() is true for
  // ANY brand object without a workspace id, so it alone would hand tenant
  // zero's storefront to a half-filled onboarding record; and slugs are only
  // unique per owner, so a persisted workspace may legitimately carry tenant
  // zero's slug. The shipped default is the record that matches the slug AND
  // has no workspace id at all.
  const zero = brandRuntime.defaultBrand() || {};
  const isZero = brand && zero.slug
    && String(brand.slug || '') === String(zero.slug)
    && brandRuntime.isDefault(brand);
  if (isZero && STORE[canonicalMarket(market)]) return STORE[canonicalMarket(market)];
  if (isZero && STORE[market]) return STORE[market];

  return '[DATA REQUIRED BEFORE LAUNCH: region store URL, all, ' + market + ']';
}

/**
 * The interactive-state section is the one part of the design system that
 * assumed a physical product ("pick a colourway"). What a reader of a news
 * section or a member on a plan should be offered instead is different, so the
 * axis is chosen from what the brand actually sells.
 */
function sensoryAxis(brand) {
  // A persisted brand_workspaces row keeps offerings under brand_data; only the
  // preset JSON files carry them at the top level. Reading one shape would give
  // every onboarded brand the generic fallback.
  const offs = (Array.isArray(brand && brand.offerings) && brand.offerings)
    || (brand && brand.brand_data && Array.isArray(brand.brand_data.offerings) && brand.brand_data.offerings)
    || [];
  const kinds = new Set(offs.map((o) => o && o.kind).filter(Boolean));
  const cs = (brand && brand.catalog_source)
    || (brand && brand.brand_data && brand.brand_data.catalog_source) || {};
  if (cs.kind && cs.kind !== 'none' && cs.kind !== 'manual') kinds.add('product');
  if (kinds.has('section') || kinds.has('programme')) {
    return 'four selectable reader states such as Morning, Commute, Evening, Weekend, each changing which content is surfaced';
  }
  if (kinds.has('event')) {
    return 'four selectable states covering the run-up to the date such as Announced, Early, Final week, Day of, each changing the copy and the call to action';
  }
  if (kinds.has('plan')) {
    return 'four selectable states covering the tiers or usage levels on offer, each changing which benefits are shown';
  }
  if (kinds.has('service')) {
    return 'four selectable states covering the stages of the engagement such as Enquiry, Scope, Delivery, Aftercare';
  }
  return 'at least four selectable states drawn from real, supplied attributes of the offering, never invented ones';
}

/**
 * Wall-clock this handler may spend in total. The design loop only starts with
 * whatever is left after generation, and skips entirely when that is too small
 * to finish a full-document revision, so adding the pass cannot push a request
 * past the platform's function timeout.
 *
 * Must stay UNDER the maxDuration set for the function that serves this route
 * (api/ai/generate.js, 120s in vercel.json) with room for the response. A
 * budget above that ceiling would let the loop run the request off the end of
 * the function and lose a page that had already generated successfully.
 */
const BUDGET_MS = Number(process.env.LP_BUDGET_MS || 0) || 110000;

module.exports = async function handler(req, res) {
  const startedAt = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'invalid_json_body' }); }
  }

  // The ACTIVE brand, resolved server-side. Everything brand-shaped in the
  // prompt below is derived from this: another tenant must never receive tenant
  // zero's palette, fonts, vocabulary or storefront.
  const brand = await brandRuntime.resolve(req);

  const market = String(body.market || body.region || 'US');
  const channel = String(body.channel || 'landing');
  const store = resolveStore(brand, market);
  const motionProfile = String(body.motion_profile || 'immersive-balanced');
  const brief = String(body.brief || body.prompt || '').slice(0, 9000);
  if (brief.trim().length < 20) return res.status(400).json({ error: 'brief_required' });

  // Design-intelligence directive (from data/design-intelligence.js): when the
  // caller requests a variation (big-number-hero, problem-solution-presell,
  // social-proof-led, long-form-story), inject that design pattern.
  const designVariation = String(body.design_variation || body.variation || '');
  const designDirective = (DESIGN && designVariation) ? DESIGN.directivePrompt('landing_page', designVariation) : '';

  const brandName = (brand && brand.name) || 'this brand';
  const systemPrompt = `You are a senior conversion copywriter, interaction designer, and front-end developer for ${brandName}.

OUTPUT CONTRACT
Return ONLY one complete production-ready HTML document from <!doctype html> to </html>. No markdown fences or commentary. Use inline CSS and a small inline JavaScript block. No external libraries, CDNs, Google Fonts, remote JS, React, Three.js, Framer runtime, or Motion runtime. The page must work by opening the downloaded HTML file directly.

BRAND CONSTRAINTS (authoritative, derived from this brand's own record)
${brandRuntime.brandBlock(brand)}

APPLYING THOSE TOKENS
Declare the palette and the two families as CSS custom properties on :root and reference them everywhere; no colour or family may appear that is not in the block above. Apply the heading family to h1, h2, h3, h4, .heading, .title, .subhead, .eyebrow. Apply the body family to body, p, li, span, button, input, label, .body-text. Primary CTA: brand primary background with the surface colour as its text. Secondary CTA: accent border or background. Default section background is the brand surface. Use the accent for rule lines, badges, hover and active states.

FRAMER AND MOTION-INSPIRED INTERACTION SYSTEM
Treat 3D, 4D and 5D as concrete interaction layers, not labels pasted onto the page.

3D SPATIAL DEPTH
- Build an above-the-fold stage for whatever this brand actually offers, using CSS perspective, transform-style: preserve-3d and layered planes. Compose it from shapes and type that suit that offering; do not assume a physical package.
- The stage responds subtly to pointer position using requestAnimationFrame and rotateX/rotateY. Touch users get a gentle automatic orbit.
- Cards use restrained hover and press depth similar to Framer component hover/press effects.
- Never rely on an image to fake the entire 3D scene. Use semantic HTML/CSS shapes and an optional labelled image slot.

4D TIME AND SCROLL
- Use scroll progress as a timeline, inspired by Framer Scroll Transform and Motion useScroll/useTransform patterns.
- Include one sticky storytelling section where product scale, rotation, opacity or ingredient positions interpolate smoothly as the user scrolls.
- Reveal sections with IntersectionObserver. Use transform and opacity only for performance.
- Add a thin progress indicator tied to document scroll.
- Motion must guide attention toward proof and CTA, never delay access to content.

5D PARTICIPATION AND SENSORY STATE
- Include an interactive component offering ${sensoryAxis(brand)}.
- Changing state must update visible copy and at least one visual property using accessible buttons and aria-pressed.
- Add a Pause Motion control.
- Respect prefers-reduced-motion. In reduced motion, all content is immediately visible and interactions still work without continuous movement.

MOTION PROFILE
Requested profile: ${motionProfile}.
- subtle-premium: restrained reveals, maximum 4deg card tilt, slow orbit.
- immersive-balanced: visible spatial hero, scroll transforms, sensory state changes, no excessive looping.
- editorial-cinematic: larger sticky scroll sequence and stronger depth, while preserving readability and mobile performance.

CONVERSION ARCHITECTURE
Mobile-first at 360px. No horizontal overflow. Tap targets at least 44px. Required order: announcement bar when offer exists, header, hero with one dominant CTA and spatial product stage, trust strip, benefits, sticky 4D origin or product story, product or offer block with only supplied commercial facts, interactive 5D sensory section, social proof framed as representative themes unless exact quotes are supplied, FAQ, final CTA, footer, sticky mobile CTA.

TECHNICAL QUALITY
- Semantic HTML, accessible labels, visible focus states, responsive clamp typography.
- Inline JS must be defensive and under roughly 8KB.
- Use requestAnimationFrame for pointer transforms and passive scroll listeners.
- Avoid layout-shifting animation and heavy box-shadow animation.
- All content must remain readable when JavaScript is disabled.
- Currency and links must match ${market}. Primary store base: ${store}.
- Channel intent: ${channel}. Match message continuity to how visitors arrive.`;

  const userMessage = `Create the final page from this exact input. Preserve every supplied factual detail and offer, but do not invent missing facts.\n\n${brief}`
    + (designDirective ? `\n\n${designDirective}` : '');

  try {
    const out = await callLLM({
      tier: 'premium',
      systemPrompt,
      userMessage,
      temperature: 0.65,
      // 15000 exceeds the free-tier per-minute token budgets (Groq ~6K TPM,
      // Cerebras ~8K output), which forced an instant 429 and left no working
      // fallback rung. 8000 fits the free rungs so the cascade can actually
      // complete; paid providers (if keyed) still get the full budget.
      maxTokens: 8000,
      timeoutMs: 110000,
      stage: 'landing-page-spatial',
    });
    let html = scrub(out && out.text);
    // The caller-side scrubber enforces tenant zero's banned list; the ACTIVE
    // brand's own list is applied on top so a custom brand's forbidden phrases
    // are stripped too.
    html = brandRuntime.scrubHtmlForBrand(html, brand);
    html = String(html).replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (!/<!doctype/i.test(html) || !/<body/i.test(html) || !/<\/html>/i.test(html)) {
      return res.status(502).json({ error: 'invalid_html_generation' });
    }

    // Bounded design pass. It returns the original page on any error, timeout
    // or truncated revision, so this can never turn a good response into a bad
    // one; the only thing at stake is whether the page got better.
    const spent = Date.now() - startedAt;
    const { html: finalHtml, quality } = await runDesignLoop({
      html, brand, brief, market, store, channel,
      timeBoxMs: Math.max(0, BUDGET_MS - spent),
    });

    return res.status(200).json({ ok: true, html: finalHtml, quality });
  } catch (error) {
    const msg = error && error.message ? error.message : String(error);
    const busy = /rate limit|rate.?limit|quota|429|credit|balance|insufficient|overloaded/i.test(msg);
    return res.status(busy ? 503 : 500).json({
      error: busy ? 'providers_busy' : 'generation_failed',
      detail: busy
        ? 'AI providers are rate-limited or out of quota right now. Please retry in a minute. For reliable generation, add a paid provider key (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY) in Vercel.'
        : msg
    });
  }
};


// Exposed for tests. The handler is the module's export, so these hang off it
// rather than replacing it: the store resolver and the interaction axis are the
// two pieces of per-brand logic worth pinning independently of an LLM call.
module.exports.resolveStore = resolveStore;
module.exports.sensoryAxis = sensoryAxis;
