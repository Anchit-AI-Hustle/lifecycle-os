'use strict';
/**
 * pipeline-core.js — the one door every mailer-pipeline stage goes through.
 * ---------------------------------------------------------------------------
 * api/ai/pipeline/{strategy,variant,images,html,score}.js are five of the
 * twelve serverless functions this deployment may have. Until 2026-09-28 they
 * were also the five the 2026-08-23 finding never reached. Executing them for
 * the first time (tests/pipeline-executed.spec.js) found, in order:
 *
 *   1. NO CALLER GATE. Each stage opened with corsHeaders() - a wildcard - and
 *      went straight to callLLM. The unauthenticated LLM proxy that was closed
 *      on generate.js and image.js was still open on five sibling routes, and a
 *      grep for requireCaller under api/ai/ looked complete because those two
 *      files had it.
 *   2. NO METER. Nothing under api/ai/pipeline/ was wrapped in credits.metered,
 *      so a signed-in caller ran five model calls per mailer for free while the
 *      same work on generate.js was charged.
 *   3. NO REQUEST SCOPE. A workspace's own provider keys and model order
 *      (workspace-connections-core) are read by llm.js from the request scope;
 *      an unwrapped handler has none, so every pipeline call spent the
 *      PLATFORM's keys whatever the workspace had configured.
 *   4. ONE TENANT'S PROMPT FOR EVERY TENANT. The system prompts named tenant
 *      zero, its palette hexes, its fonts, its logo URL, its store domains and
 *      its legal footer - and, underneath a search-and-replace rebrand, a tea
 *      brand's: "first-flush", "7,000 feet", "farm direct", "steaming pair".
 *      A brand onboarded yesterday got a mailer built from all of it.
 *   5. INSTRUCTIONS TO FABRICATE. "⭐⭐⭐⭐⭐ ([N] reviews)", "🔥 [N] units sold
 *      in the last 24 hours (N: 25-90)", "4.8/5 · 50K+ REVIEWS" and a
 *      templated testimonial were mandatory per product card. Seeding a shape
 *      with values is an instruction to invent them (the 2026-08-14 finding),
 *      and none of it was reachable by gateProof().
 *   6. A BLACK SECTION in the html stage's own fallback: #0a1f13 on the benefit
 *      strip and the proof block of Variant B, which no source sweep of the
 *      renderers listed in asset-no-black-background.spec.js could see because
 *      this renderer was not on the list.
 *
 * So the five stages now share exactly one entry sequence, defined here:
 *
 *   admit()     the caller gate (require-caller), the method and body checks,
 *               and the brand resolved for THIS request (brand-runtime), pinned
 *               on the request so scopedBrand() finds it deeper down.
 *   briefing()  the blocks a generation prompt must carry: the brand
 *               block (brand-runtime.brandBlock), the asset contract the
 *               validator will apply (asset-contracts.brief), the evidence
 *               block (creative-evidence.briefFor) - or its explicit no-evidence
 *               state, never an omitted section - and the compliance rules the
 *               dispatch gate will lint the copy against (compliance-lint.brief).
 *   tokens()    a section palette derived from the brand's own record through
 *               sectionGround()/textOn(), so no ground can be a dark neutral
 *               and no text can sit under AA, whichever brand is active.
 *   mount()     credits.metered + request-scope.wrap, in that order, the same
 *               wrappers generate.js and image.js carry - and the refund rule:
 *               a stage that answers with its heuristic fallback, a placeholder
 *               or a skipped score did not deliver what was paid for, so the
 *               hold is released rather than settled (the image.js precedent).
 *
 * llm.js is resolved at CALL time rather than at require time, deliberately:
 * the module IS the function (module.exports = async function callLLM), so a
 * test that replaces it in require.cache must be honoured by a stage that was
 * loaded earlier. A stage that captured the real function in a top-level const
 * could never be driven with a scripted model.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const brandRuntime = require('./brand-runtime.js');
const core = require('./brand-workspace-core.js');
const contracts = require('./asset-contracts.js');
const evidence = require('./creative-evidence.js');
const specs = require('./asset-specs.js');

/** The spec's own marker shape: [DATA REQUIRED BEFORE LAUNCH: field, product, region]. */
function marker(field, product, region) {
  return `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${product || 'all'}, ${region || 'all'}]`;
}

/** Strip BOM and non-ASCII from a header value (Vercel env via PowerShell can inject invisible chars). */
function cleanKey(s) {
  if (!s) return '';
  return String(s).split('').filter((c) => c.charCodeAt(0) < 128).join('').trim();
}

/* ── the gate ───────────────────────────────────────────────────────────── */

/**
 * Admit a request to a pipeline stage, or answer it and return null.
 *
 * The caller gate runs FIRST and its refusal is honoured - the shape the
 * 2026-08-23 finding turned on was `await requireCaller(req, res)` with the
 * false return discarded. Nothing below the gate may cost money.
 */
async function admit(req, res) {
  const { requireCaller } = require('./require-caller.js');
  if (!(await requireCaller(req, res))) return null;
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-user-gemini-key');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed', message: 'This pipeline stage accepts POST only.' });
    return null;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (_) {
      res.status(400).json({ ok: false, error: 'invalid_json', message: 'The request body is not valid JSON.' });
      return null;
    }
  }
  body = (body && typeof body === 'object') ? body : {};

  // The brand this generation is FOR. resolve() never throws: with no session
  // or no active workspace it answers tenant zero, exactly as generate.js does.
  const brand = await brandRuntime.resolve(req, { auth: req.__caller || undefined });
  req.__brand = brand;
  // No control opens on a literal market: a slot with none named is the
  // brand's HOME market, and a brand with no regions has a gap to report.
  const market = String(body.market || brandRuntime.homeRegion(brand) || '').toUpperCase();

  return {
    body, brand, market,
    userGeminiKey: cleanKey(req.headers && req.headers['x-user-gemini-key']),
    mailerType: String(body.mailer_type || '').toLowerCase() === 'text' ? 'text' : 'text_graphics',
  };
}

/* ── the brand, as a section palette ────────────────────────────────────── */

/**
 * Colours a renderer may paint with, derived from THIS brand's record.
 *
 * Every ground goes through sectionGround() (never a dark neutral, chain ends
 * at the brand's own surface) and every text colour through textOn() or
 * readableAsText() against the ground it will actually sit on. A near-black
 * primary therefore yields a band painted with the accent or the surface, and
 * a light primary used as text is darkened until it reads. No literal from any
 * other tenant's palette appears here.
 */
function tokens(brand) {
  const b = brand || {};
  const p = b.palette || {};
  const t = b.typography || {};
  const hex = (v) => (core.normHex(v) ? v : '');

  const surface = core.sectionGround(p.surface, '#ffffff');
  const surfaceAlt = core.sectionGround(p.surface_alt, surface);
  const primary = core.sectionGround(p.primary, p.accent, surface);
  // A control is not a section, so the accent may be dark; what matters on it
  // is the label, and onAccent is derived for exactly that ground.
  const accent = hex(p.accent) || hex(p.primary) || primary;
  // The accent used as a SECTION (an announcement bar, an offer banner) is a
  // band, and a band goes through sectionGround like every other ground. The
  // first run of the rendered gate found this exact split missing: a brand
  // whose accent is #0d0d0d got a black announcement bar, painted by a token
  // that was correct for its buttons.
  const accentBand = core.sectionGround(p.accent, p.primary, surfaceAlt);
  const ink = hex(p.ink) || '#111111';

  const stack = (slot, fallback) => {
    const f = t[slot];
    if (f && f.stack) return f.stack;
    if (f && f.family) return `'${String(f.family).replace(/'/g, '')}',${fallback}`;
    return fallback;
  };

  return {
    surface, surfaceAlt, primary, accent, accentBand, ink,
    onPrimary: core.textOn(primary, surface, ink),
    onAccent: core.textOn(accent, surface, ink),
    onAccentBand: core.textOn(accentBand, surface, ink),
    onSurface: core.readableAsText(ink, surface, 4.5),
    onSurfaceAlt: core.readableAsText(ink, surfaceAlt, 4.5),
    mutedOnSurface: core.readableAsText(hex(p.muted) || ink, surface, 4.5),
    // The brand colour used AS text on its own surface, darkened only as far
    // as AA needs (a light primary is otherwise invisible).
    primaryAsText: core.readableAsText(hex(p.primary) || ink, surface, 4.5),
    accentAsText: core.readableAsText(accent, surface, 4.5),
    // Whether the primary is a genuinely dark ground, which is what lets
    // Variant B "open dark" on it. A light primary still opens on it - the
    // divergence then comes from structure rather than luminance.
    primaryIsDark: core.luminance(primary) < 0.5,
    headingStack: stack('heading', 'Georgia,"Times New Roman",serif'),
    bodyStack: stack('body', 'Arial,Helvetica,sans-serif'),
    fontImport: brandRuntime.fontImport(t),
  };
}

/* ── the store, the legal sender and the logo, from the record ──────────── */

/** The store this market links to. A missing one is a gap, never another brand's domain. */
function storeFor(brand, market) {
  const b = brand || {};
  const facts = brandRuntime.regionFacts(b, market);
  if (facts && facts.store) {
    return { url: 'https://' + String(facts.store).replace(/\/$/, ''), currency: facts.currency || '', code: facts.code || market, marker: '' };
  }
  const site = String(b.website || '').replace(/\/$/, '');
  if (site) return { url: site, currency: '', code: market, marker: '' };
  return { url: '', currency: '', code: market, marker: marker('region store URL', b.name, market) };
}

/** A link for a CTA. With no store on record the href IS the marker, so the gap is visible in the link itself. */
function linkFor(store, pathAndQuery) {
  if (!store || !store.url) return (store && store.marker) || marker('region store URL');
  return store.url + (pathAndQuery || '');
}

/** The legal sender line a commercial email must carry (CAN-SPAM), from the record or as a gap. */
function legalFor(brand) {
  const b = brand || {};
  const legal = b.legal_entity || b.legal_name || '';
  if (typeof legal === 'string' && legal.trim()) {
    const parts = legal.split(',');
    return { name: parts[0].trim(), address: parts.slice(1).join(',').trim() || marker('sender postal address', b.name) };
  }
  return { name: b.name || marker('legal sender name'), address: marker('sender postal address', b.name) };
}

/* ── the three blocks every generation prompt carries ───────────────────── */

/**
 * BRAND + CONTRACT + EVIDENCE, rendered once per request.
 *
 * `body.evidence` may carry what the planner stamps on a slot (ownEvidence,
 * ownDataReference, competitorContext). With nothing supplied the evidence
 * block states that there is no history and forbids inventing one - an
 * omitted section is an invitation, a stated one is a constraint.
 */
function briefing(ctx, contractId) {
  const c = ctx || {};
  const supplied = (c.body && c.body.evidence && typeof c.body.evidence === 'object') ? c.body.evidence : {};
  const entry = Object.assign({}, supplied, { brand: c.brand, market: c.market });
  return [
    brandRuntime.brandBlock(c.brand),
    '',
    contracts.brief(contractId || 'email.mailer'),
    '',
    evidence.briefFor(entry),
    '',
    // The rules the dispatch gate lints this copy against, briefed from the
    // same brand and market (compliance-lint.js), so writer and gate agree.
    require('./compliance-lint.js').brief({ brand: c.brand, market: c.market }),
  ].join('\n');
}

/**
 * The products the CALLER supplied, as prompt lines. Nothing is inferred: with
 * none supplied the model is told to write the marker, not to guess a product.
 */
function productLines(products, ctx, opts) {
  const o = opts || {};
  const list = (Array.isArray(products) ? products : []).filter(Boolean).slice(0, o.max || 15);
  const b = (ctx && ctx.brand) || {};
  const market = (ctx && ctx.market) || 'all';
  if (!list.length) {
    return `(none supplied) Do NOT invent a product, price, handle, image or URL. Where a product is needed write ${marker('product', b.name, market)}.`;
  }
  const currency = (ctx && ctx.currency) || '';
  return list.map((p, i) => {
    const name = p.name || p.n || p.title || marker('product name', b.name, market);
    const handle = p.handle || p.h || p.id || '';
    const price = (p.price != null && p.price !== '') ? `${currency}${p.price}` : '';
    const compare = (p.compare_at != null && p.compare_at !== '') ? `${currency}${p.compare_at}` : (p.compare_at_price ? `${currency}${p.compare_at_price}` : '');
    const image = p.image_url || p.i || '';
    return `  ${i + 1}. ${name}${p.role ? ` [${p.role}]` : ''}`
      + `${price ? ` · price ${price}` : ' · price not supplied'}${compare ? ` (was ${compare})` : ''}`
      + `${p.category ? ` · ${p.category}` : ''}`
      + `${handle ? ` · handle ${handle}` : ''}`
      + `${image ? ` · image ${image}` : ' · no image supplied'}`
      + (p.why ? `\n     why: ${p.why}` : '');
  }).join('\n');
}

/* ── the model, resolved when it is called ──────────────────────────────── */

function llm(opts) { return require('./llm.js')(opts); }
function parseJSON(text) { return require('./llm.js').parseJSON(text); }

/* ── the wrappers a shipped AI route carries ────────────────────────────── */

/**
 * Mount a stage handler the way generate.js and image.js are mounted: metered
 * on `featureKey` (a key missing from credit-catalog.js throws rather than
 * running free), then wrapped in the request scope so llm.js can honour this
 * workspace's own keys and model order.
 *
 * The refund rule is the image.js precedent: a 200 that carries a heuristic
 * fallback, a placeholder image or a skipped score is not what the caller paid
 * for, so the reservation is released. Anything non-2xx is released by the
 * meter itself.
 */
function mount(handler, featureKey, opts) {
  const credits = require('./credits-core.js');
  const scope = require('./request-scope.js');
  const cfg = Object.assign({
    successIf: (payload) => !(payload && (payload._heuristic === true || payload._scoring_skipped === true || payload.placeholder === true)),
  }, opts || {});
  return scope.wrap(credits.metered(handler, () => featureKey, null, cfg));
}

/** The mailer numbers, read from the spec rather than re-typed. */
const MAILER = specs.MAILER;

module.exports = {
  admit, briefing, tokens, storeFor, linkFor, legalFor, productLines, marker,
  llm, parseJSON, mount, MAILER,
};
