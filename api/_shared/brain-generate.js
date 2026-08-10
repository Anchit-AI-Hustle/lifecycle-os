'use strict';

/**
 * brain-generate.js — Generation Engine (Module 5).
 *
 * For an approved calendar slot, generates the COMPLETE asset set:
 *   email slots        → HTML mailer (brand-compliant) + paired landing page
 *   google slots       → RSA campaign object (15 headlines / 4 descriptions / keywords)
 *   meta slots         → primary text / headline / description + creative brief + audience
 *   tiktok slots       → hook-script + creative brief + audience
 *   landing_* slots    → conversion-optimized landing page HTML
 * plus, for every campaign: funnel spec (creative → landing → mailer follow-up),
 * retargeting + lookalike audience definitions — platform-ready schema,
 * NO live push (phase 2 plugs into the same campaign_object).
 *
 * LLM-assisted copy via _shared/llm.js with a deterministic brand-compliant
 * fallback, so generation always succeeds.
 */

const { db, getConfig, getBrandKit, scrubBannedPhrases, idFor, todayIso, round } = require('./brain-core.js');
const analysis = require('./brain-analysis.js');

let callLLM = null;
try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }
// No em/en dashes in generated copy (matches the lifecycle builder). Safe no-op
// if scenario-model is unavailable.
let dashScrub = (s) => s;
try { const sm = require('./scenario-model.js'); if (sm && sm.scrubDashes) dashScrub = sm.scrubDashes; } catch (_) {}

// Knickgasm Campaign Hub compiler (ported from marketing_automation/) — premium,
// curated themed landing pages for the streetwear/coffee-collection campaigns it
// was built for. The brain routes to it when a slot matches; otherwise it uses
// the LLM long-form landing builder below.
let lpCompiler = null;
try { lpCompiler = require('./lp-compiler.js'); } catch (_) { lpCompiler = null; }
// Shared mailer renderer, the SAME one the Mailer Calendar / lifecycle builder
// uses, so Smart Brain mailers come out as the same two named types.
let renderTextVariant = null;
try { renderTextVariant = require('./calendar-trigger.js').helpers.renderTextVariant; } catch (_) { renderTextVariant = null; }
// Real hosted product photos (Shopify CDN) from the built catalog, so a mailer
// never renders with a missing image when the smart_products row has no image.
let catalogImage = { imageFor: () => null };
try { catalogImage = require('./catalog-image.js'); } catch (_) {}
// B1 real-only gate (env REAL_FACTS_ONLY). When ON, the flagship mailer + LP show
// ONLY approved testimonials/reviews for the SKU and DROP the fabricated
// competitor comparison; when OFF (default) behaviour is unchanged.
let brandFacts = { enabled: () => false, approvedReviews: () => [] };
try { brandFacts = require('./brand-facts.js'); } catch (_) {}
// Resolve testimonials for a slot under the gate: OFF => the given fallback
// (LLM/template testimonials); ON => approved reviews for the SKU, else [].
function gateTestis(fallbackTestis, slot, product) {
  if (!brandFacts.enabled()) return fallbackTestis;
  const sku = (product && (product.sku || product.id || product.handle || product.title)) || null;
  return brandFacts.approvedReviews(sku, slot && slot.market).map((r) => ({ quote: r.quote || '', name: r.author || 'Verified reviewer', location: '' }));
}
// Per-slot design strategy: gives each mailer its own influencer-informed
// archetype (layout order + copy angle) instead of one repeated template.
let designStrategy = { strategyFor: () => ({ key: 'hero-spotlight', hero: 'green', order: [], influencerAngle: '' }) };
try { designStrategy = require('./mailer-design-strategy.js'); } catch (_) {}
// Legal sender identity for email footers (CAN-SPAM: a real physical mailing
// address is required in every commercial email). Replaces the old
// {{ organization_address }} placeholder.
const ORG_NAME = 'Knickgasm Global, Inc';
const ORG_ADDRESS = '440 N Barranca Ave #2812, Covina, CA 91723, United States';

// Resolve the best real image URL for a product: its own row image, else the
// catalog photo by handle/title. Returns an https URL or null.
function productImage(p, market) {
  if (!p) return null;
  const direct = p.image || p.image_url || p.i;
  if (typeof direct === 'string' && /^https?:\/\//.test(direct)) return direct;
  return catalogImage.imageFor({ handle: p.handle || p.h, title: p.title || p.n }, market) || null;
}

// Match a calendar slot to a Campaign-Hub theme by keyword overlap. Returns
// { theme, variant } only on a real match, so a Jordan slot never gets a
// grail-drop page. null → fall back to the generic LLM landing page.
function pickCampaignHubLP(slot, products) {
  if (!lpCompiler || !Array.isArray(lpCompiler.THEMES) || !lpCompiler.THEMES.length) return null;
  const hay = [slot.theme, slot.angle, slot.cohort_id, slot.festival,
    ...(products || []).flatMap((p) => [p.title, p.category, ...((p.tags) || [])])].filter(Boolean).join(' ').toLowerCase();
  // Only consider the Hub for design/fandom/occasion intents (the themes the
  // campaign-hub landing pages are actually written for).
  const gate = /(grail-drop|anime|football|soccer|gaming|car|f1|formula|wedding|bride|groom|gift|pet|bling|crystal|embroider|celebrity|taylor|coffee-art|custom|hand-painted|one-of-one|airbrush|streetwear|collector)/;
  if (!gate.test(hay)) return null;
  const score = (t) => {
    const kws = `${t.name} ${t.slug} ${t.coreProblem} ${t.scientificHook}`.toLowerCase().match(/[a-z]{4,}/g) || [];
    return kws.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
  };
  let best = null, bestScore = 0;
  for (const t of lpCompiler.THEMES) { const sc = score(t); if (sc > bestScore) { bestScore = sc; best = t; } }
  if (!best || bestScore < 2) return null;
  // Variant: honour an explicit code on the slot, else the first (strongest) variant.
  const wantCode = (slot.source && slot.source.lp_variant) || (slot.metadata && slot.metadata.lp_variant);
  const variant = lpCompiler.FUNNEL_VARIANTS.find((v) => v.code === wantCode) || lpCompiler.FUNNEL_VARIANTS[0];
  return { theme: best, variant, score: bestScore };
}

async function llmJson(system, user, maxTokens = 1800) {
  if (!callLLM) return null;
  try {
    const out = await callLLM({ systemPrompt: system, userMessage: user, responseFormat: { type: 'json_object' }, maxTokens, temperature: 0.7, timeoutMs: 40000, stage: 'brain-generate', tier: 'premium' });
    const text = typeof out === 'string' ? out : (out.text || '');
    return JSON.parse(text.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, '$1'));
  } catch (_) { return null; }
}

// ── copy generation (LLM with deterministic fallback) ───────────────────────
async function generateCopy(slot, products, brand, library) {
  const ref = (library || []).slice(0, 3).map((c) => `"${c.hook}" (angle ${c.angle}, rev ${c.kpis ? c.kpis.revenue : 'n/a'})`).join('; ');
  const productLines = products.map((p) => `${p.title} — $${p.price} (${p.category})`).join('\n');
  const sys = `You are the lifecycle copy chief for KNICKGASM, a premium one-of-one sneaker & streetwear brand.
Voice: ${brand.voice}. Use this lexicon where natural: ${(brand.preferred_lexicon || []).join(', ')}.
NEVER use: ${(brand.banned_phrases || []).join(', ')}.
QUALITY BAR — before you return, silently score every field 1-10 on: Clarity, Conversion pull, Brand-voice fit, Concrete proof (a specific detail/number, never a vague claim), and Format/character-limits. If any field scores below 8, rewrite it. Prefer a specific, sensory, benefit-led line over a generic category claim: a reason tied to THIS cohort/angle beats "origin-fresh sneaker" every time. Each headline/description must read better than the obvious generic version.
Return STRICT JSON only.`;
  const strat = designStrategy.strategyFor(slot);
  const user = `Create campaign copy for:
Channel: ${slot.channel} · Market: ${slot.market} · Cohort: ${slot.cohort_id || 'general'}
Theme: ${slot.theme} · Angle: ${slot.angle} · Festival: ${slot.festival || 'none'}
Reference hooks that worked before: ${ref || 'n/a'}
Design format for THIS mailer: ${strat.label}. ${strat.influencerAngle}
Write the copy so it fits that format specifically (this send must not read like a generic template).
Featured products:\n${productLines}

AD-COPY RULES (apply to google, meta and tiktok blocks):
- Make every headline and DESCRIPTION specific to this cohort (${slot.cohort_id || 'general'}) and angle (${slot.angle}). No generic "origin-fresh sneaker" filler that could belong to any send.
- Lead each ad description with the angle's benefit, then a concrete proof or offer, then a light CTA. It must read as a finished ad, never a label or the schema hint.
- Respect platform limits EXACTLY (count characters): Google headlines <=30, Google descriptions <=90, Meta headline <=40, Meta description <=30. If it does not fit, rewrite shorter — do not exceed.
- Use ONLY the product names/prices given above. Invent no discounts, promo codes, ratings, review counts, claims, or URLs. If an offer is not supplied, do not state one.

JSON shape:
{"subject":"","preheader":"","headline":"","subheadline":"","body_intro":"2-3 sentence sensory opening","story":"4-5 sentence narrative for the angle","cta_primary":"","cta_secondary":"","testimonial":{"quote":"tiny personal story, 2 sentences","name":"first name + city"},"google":{"headlines":["12 short headlines ≤30 chars"],"descriptions":["4 descriptions ≤90 chars"],"callouts":["4 callouts ≤25 chars e.g. Free shipping over $35"],"sitelinks":[{"text":"≤25 chars","desc":"≤35 chars"},{"text":"","desc":""},{"text":"","desc":""},{"text":"","desc":""}]},"meta":{"primary_text":"best single primary text","primary_text_variants":["unaware-stage hook","problem-aware angle","solution-aware/offer angle"],"headline":"≤40 chars","headlines":["3 headline options ≤40 chars"],"description":"≤30 chars","creative_concept":"one-line art direction for the hero image"},"tiktok":{"hook_line":"first 2s spoken hook","script":"15s spoken script, conversational","shot_list":["4 beats: 0-2s hook / 3-6s problem / 7-11s product+proof / 12-15s CTA"],"captions":["3 on-screen caption lines"]},"landing":{"hero_eyebrow":"3-5 word kicker","hero_headline":"big emotional promise","hero_sub":"1-2 sentence support","offer_bar":"short sticky offer line e.g. Free sampler + free shipping over $35","trust_badges":["4 very short proof points"],"problem":{"headline":"name the pain","body":"3-4 sentences on what they settle for today"},"mechanism":{"headline":"why origin-fresh changes it","steps":[{"title":"","desc":"1 sentence"},{"title":"","desc":"1 sentence"},{"title":"","desc":"1 sentence"}]},"benefits":[{"title":"","desc":"1 sentence"},{"title":"","desc":"1 sentence"},{"title":"","desc":"1 sentence"},{"title":"","desc":"1 sentence"}],"comparison":{"us_label":"KNICKGASM","them_label":"Supermarket sneaker","rows":[{"feature":"","us":"","them":""},{"feature":"","us":"","them":""},{"feature":"","us":"","them":""},{"feature":"","us":"","them":""}]},"testimonials":[{"quote":"2 sentence story","name":"first name","location":"city"},{"quote":"2 sentence story","name":"first name","location":"city"},{"quote":"2 sentence story","name":"first name","location":"city"}],"offer_stack":{"headline":"what you get","items":["3-5 included lines, each with a small value note"],"price_note":"value framing e.g. about 40c a pair","cta":"buy CTA"},"faq":[{"q":"","a":""},{"q":"","a":""},{"q":"","a":""},{"q":"","a":""}],"guarantee":{"headline":"risk reversal","body":"1-2 sentences"}}}`;
  let copy = await llmJson(sys, user, 3400);
  if (!copy || !copy.headline) copy = fallbackCopy(slot, products);
  // brand-compliance scrub on every string: banned phrases + no em/en dashes
  // (same no-dash rule the lifecycle builder enforces, for consistency).
  const walk = (o) => {
    if (typeof o === 'string') return dashScrub(scrubBannedPhrases(o, brand));
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)]));
    return o;
  };
  return clampAds(walk(copy));
}

// Enforce ad-platform character limits on every ad field, whatever the source
// (LLM or fallback), so a description is never rejected/truncated for being too
// long. Trims at a word boundary and strips trailing punctuation.
function clampStr(s, n) {
  s = String(s == null ? '' : s).trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-]+$/, '');
}
function clampAds(copy) {
  if (!copy) return copy;
  if (copy.meta) {
    if (copy.meta.headline) copy.meta.headline = clampStr(copy.meta.headline, 40);
    if (copy.meta.description) copy.meta.description = clampStr(copy.meta.description, 30);
    if (Array.isArray(copy.meta.headlines)) copy.meta.headlines = copy.meta.headlines.map((h) => clampStr(h, 40));
  }
  if (copy.google) {
    if (Array.isArray(copy.google.headlines)) copy.google.headlines = copy.google.headlines.map((h) => clampStr(h, 30));
    if (Array.isArray(copy.google.descriptions)) copy.google.descriptions = copy.google.descriptions.map((d) => clampStr(d, 90));
    if (Array.isArray(copy.google.callouts)) copy.google.callouts = copy.google.callouts.map((c) => clampStr(c, 25));
  }
  return copy;
}

function fallbackCopy(slot, products) {
  const p = products[0] || { title: 'Original Hand-painted Kicks', price: 19.99, category: 'Kicks' };
  const theme = slot.theme || 'Morning Ritual';
  const fest = slot.festival;
  const angle = slot.angle || theme;   // weave the slot's angle into ad copy so fallback is not identical per slot
  return {
    subject: fest ? `${fest}: a gift they will lace-up all season` : `There is a moment the right pair restores`,
    preheader: `${p.title}, hand-painted at origin — crafted for your ${String(theme).toLowerCase()}`,
    headline: fest ? `Crafted for ${fest}` : `The ${theme}, restored`,
    subheadline: `Single-studio sneakers, shipped studio-fresh from India`,
    body_intro: `There is a moment when the right pair of kicks does more than warm your hands. It slows the morning down, just enough to taste it.`,
    story: `Every ${p.category.toLowerCase()} we ship begins at a one of one, hand-painted and packed at origin within days of plucking. No warehouses, no years on a shelf — just the drop, sealed at its peak. That freshness is why the first lace-up tastes the way the studios smell at dawn. It is a small ritual with an outsized return: balance, restored daily.`,
    cta_primary: `Lace-up the ritual`,
    cta_secondary: `Explore the collection`,
    testimonial: { quote: `I started with one box in January. My kitchen now has a shelf my family calls the apothecary.`, name: `Sarah, Austin` },
    google: {
      headlines: ['One-of-One Indian Sneakers', 'Studio-Fresh, Origin Packed', `${p.category} From India`, 'Hand-Painted At Origin', 'Lace-up A Better Morning', 'Heritage Sneakers, Crafted', 'From Studio To Pair', 'The Daily Ritual Upgrade', 'Award-Winning Sneakers', 'Fresh Drop Sneakers', 'Balance In Every Lace-up', 'Origin-Direct Sneakers'],
      descriptions: [`${angle}: hand-painted one-of-one sneakers, shipped studio-fresh from India.`, 'From studio to pair in days, not years. Taste the difference origin-fresh makes.', 'Premium sneakers and streetwear colorways, packed at source. Free shipping over $35.', 'A ritual worth keeping: heritage sneakers, hand-painted and crafted at origin.'],
      callouts: ['Free shipping over $35', 'Packed at origin', 'Carbon & plastic neutral', 'Single-studio'],
      sitelinks: [
        { text: 'Best-Selling Sneakers', desc: 'Start where most people begin' },
        { text: 'Streetwear Colorways', desc: 'Embroidery, pastel & more' },
        { text: 'Gift Sets', desc: 'Crafted for the season' },
        { text: 'The Sneaker Expert', desc: 'Ask anything, get a pick' },
      ],
    },
    meta: {
      primary_text: `From a one of one in India to your morning — hand-painted, packed at origin, shipped studio-fresh. ${p.title} is where most people begin.`,
      primary_text_variants: [
        `Your sneaker is probably older than you think. Supermarket leaves can sit a year before the first lace-up. Ours is packed at the studio days after drop — taste the difference.`,
        `Tired of flat, dusty sneaker? Single-studio, whole-panel, origin-packed. ${p.title} lace-ups like the studio smells at dawn.`,
        `Start the ritual: free sampler + free shipping on your first order. Hand-painted one-of-one sneakers, shipped studio-fresh from India.`,
      ],
      headline: `The ritual, restored`,
      headlines: ['The ritual, restored', 'Origin-fresh, in days', 'Sneaker worth slowing down for'],
      description: `Origin-fresh one-of-one`,
      creative_concept: `Calm morning pair of ${p.title} on chalk linen, steam visible, lava props, soft dawn light — emotional, premium (headline + offer baked in for the ad creative).`,
    },
    tiktok: {
      hook_line: `This sneaker was on a bush in Airforce eleven days ago.`,
      script: `This sneaker was on a bush in Airforce eleven days ago. Most sneaker sits in warehouses for years — this one is packed at the studio the week it is picked. You craft it, and it tastes like the studio smells at dawn. That is the whole difference. Lace-up one pair and you will taste it.`,
      shot_list: ['0-2s: hold the box to camera — "eleven days ago this was on a bush"', '3-6s: cut to supermarket shelf — "most sneaker sits for years"', '7-11s: pour + steam bloom, close-up of panel — proof of freshness', '12-15s: step + smile, end-card deep purple with lava CTA'],
      captions: ['Sneaker you can smell from across the room', 'Packed at the studio, not a warehouse', 'Lace-up one pair — you’ll taste it'],
    },
    landing: {
      hero_eyebrow: fest ? `${fest} · Single-studio` : `Single-studio · Hand-painted`,
      hero_headline: fest ? `Crafted for ${fest}` : `The daily ritual, restored`,
      hero_sub: `One-of-one custom sneakers, hand-painted on 100% original silhouettes and shipped express from Mumbai.`,
      offer_bar: `Welcome gift: free rope laces and lace tag with every custom pair`,
      trust_badges: ['100% original base sneakers', 'Hand-painted one-of-one', 'Water & scratch resistant', 'Ships to 60+ countries'],
      problem: {
        headline: `Every pair on the shelf is a pair somebody else already owns`,
        body: `A stock colourway is made a hundred thousand times over. It says nothing about the person wearing it. You lace it up out of habit, not because it means anything.`,
      },
      mechanism: {
        headline: `How a one-of-one is made`,
        steps: [
          { title: 'Start on an original', desc: 'A 100% original Nike Air Force 1, Jordan, Dunk, Converse or Adidas Samba — we customise, never replicate.' },
          { title: 'Hand-painted in the Mumbai studio', desc: 'Brush and airbrush work by India\'s best sneaker artists, built up in layers over 10 to 15 days.' },
          { title: 'Sealed and shipped', desc: 'Cured to be water and scratch resistant, then sent express to 60+ countries.' },
        ],
      },
      benefits: [
        { title: 'Studio-fresh colorway', desc: 'The first lace-up smells the way the studio does at dawn.' },
        { title: 'Single-studio traceability', desc: 'Every box names the studio it came from.' },
        { title: 'Blended for balance', desc: 'Real botanicals, never design-sprayed.' },
        { title: 'Ritual that pays back', desc: 'About 50 pairs a box — a daily reset for the price of a habit.' },
      ],
      comparison: {
        us_label: 'KNICKGASM',
        them_label: 'Supermarket sneaker',
        rows: [
          { feature: 'Freshness', us: 'Packed days after drop', them: 'Often 1+ year old' },
          { feature: 'Source', us: 'Named one of one', them: 'Anonymous colorway' },
          { feature: 'Panel grade', us: 'Whole-panel, hand-painted', them: 'Dust & fannings' },
          { feature: 'Footprint', us: 'Carbon & plastic neutral', them: 'Rarely disclosed' },
        ],
      },
      testimonials: [
        { quote: `I started with one box in January. My kitchen now has a shelf my family calls the apothecary.`, name: 'Sarah', location: 'Austin' },
        { quote: `The first pair actually smelled like something. I did not know sneaker could do that.`, name: 'Daniel', location: 'Leeds' },
        { quote: `Switched my whole morning to this. Calmer start, and I look forward to it now.`, name: 'Priya', location: 'San Jose' },
      ],
      offer_stack: {
        headline: `What is in your first order`,
        items: [`${p.title} — the place most people begin`, 'A free origin sampler to find your next favourite', 'Crafting card with lace-up times for each panel', 'Free shipping on your welcome order'],
        price_note: `From ${slot.market === 'UK' ? '£' : '$'}${p.price} — about ${slot.market === 'UK' ? '40p' : '40c'} a pair`,
        cta: 'Start the ritual',
      },
      faq: [
        { q: 'How fresh is it really?', a: 'We pack at origin within days of plucking and ship direct — months fresher than store-shelf sneaker.' },
        { q: 'How long does a box last?', a: 'A 100g box lace-ups roughly 50 pairs — about seven weeks of a daily ritual.' },
        { q: 'What if I do not love it?', a: 'Our panel is guaranteed. If a box is not for you, we will make it right — no fuss.' },
        { q: 'Can the sneaker expert help me choose?', a: 'Yes — tap “Talk to our sneaker expert” and ask about taste, paint, or crafting. It answers out loud, like a call.' },
      ],
      guarantee: { headline: `Lace-up it risk-free`, body: `Love the panel or we will make it right. Every order is backed by our studio-fresh promise.` },
    },
  };
}

// ── HTML builders (brand palette + typography enforced) ─────────────────────
function mailerHtml(slot, copy, products, brand, agentUrl) {
  const P = brand.palette;
  const heads = brand.typography.headings.fallback;
  const body = brand.typography.body.fallback;
  const store = (brand.store_urls || {})[slot.market] || 'https://knickgasm.com';
  const cur = slot.market === 'UK' ? '£' : '$';
  // Collection CTA target, derived from the hero product's category so the
  // secondary CTA lands on the right collection (falls back to all-sneakers).
  const heroType = ((products[0] && products[0].type) || '').toLowerCase();
  const collectionUrl = /kicks/.test(heroType) ? `${store}/collections/kicks-sneaker`
    : /green/.test(heroType) ? `${store}/collections/green-sneaker`
    : /black/.test(heroType) ? `${store}/collections/black-sneaker`
    : /themed|embroidery|streetwear|jacket|accessor/.test(heroType) ? `${store}/collections/streetwear-sneaker`
    : `${store}/collections/all`;
  const esc = (s) => String(s == null ? '' : s).replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
  const L = copy.landing || {};
  const offerBar = L.offer_bar || `Welcome gift: free rope laces and lace tag with every custom pair`;
  const badges = (L.trust_badges && L.trust_badges.length ? L.trust_badges : ['100% original bases', 'Hand-painted', 'Water & scratch resistant', 'Ships to 60+ countries']).slice(0, 4);
  const steps = ((L.mechanism || {}).steps || []).slice(0, 3);
  const testis = gateTestis((L.testimonials && L.testimonials.length ? L.testimonials : [copy.testimonial].filter(Boolean).map((t) => ({ quote: t.quote, name: t.name, location: '' }))), slot, p).slice(0, 2);
  const guarantee = L.guarantee || null;

  const badgeRow = badges.map((b) => `<td align="center" style="font-family:${body};font-size:11px;color:${P.forest_green};padding:4px 6px"><span style="color:${P.lava}">✦</span> ${esc(b)}</td>`).join('');
  const stepRow = steps.length ? `
  <tr><td style="padding:8px 26px 6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${steps.map((s) => `<td valign="top" align="center" style="width:33%;padding:10px 8px">
      <div style="font-family:${heads};font-size:14px;color:${P.forest_green};font-weight:700">${esc(s.title)}</div>
      <div style="font-family:${body};font-size:12px;color:${P.near_black}AA;line-height:1.55;margin-top:6px">${esc(s.desc)}</div>
    </td>`).join('')}
    </tr></table>
  </td></tr>` : '';
  const testiBlocks = testis.map((t) => `
    <div style="background:${P.chalk};border-left:3px solid ${P.lava};padding:16px 18px;text-align:left;margin-bottom:10px">
      <div style="font-family:${heads};font-size:14px;font-style:italic;color:${P.near_black};line-height:1.6">“${esc(t.quote)}”</div>
      <div style="font-family:${body};font-size:12px;color:${P.lava};margin-top:8px">- ${esc(t.name)}${t.location ? `, ${esc(t.location)}` : ''} &nbsp;★★★★★</div>
    </div>`).join('');
  const prods = products.slice(0, 3).map((p) => {
    const img = productImage(p, slot.market);
    // Always resolve a real PDP: explicit url, else build from the handle.
    const pdp = p.url || ((p.handle || p.h) ? `${store}/products/${p.handle || p.h}` : store);
    return `
    <td align="center" style="padding:10px;width:33%">
      <a href="${pdp}" target="_blank" style="text-decoration:none">
        <div style="background:${P.chalk};border:1px solid ${P.lava}33;border-radius:10px;padding:14px 10px 18px">
          ${img ? `<img src="${img}" alt="${esc(p.title)}" width="150" style="width:100%;max-width:150px;height:auto;border-radius:8px;display:block;margin:0 auto 12px"/>` : ''}
          <div style="font-family:${heads};font-size:15px;color:${P.near_black};line-height:1.35">${esc(p.title)}</div>
          <div style="font-family:${body};font-size:13px;color:${P.lava};margin-top:8px;font-weight:600">${cur}${p.price}</div>
        </div>
      </a>
    </td>`;
  }).join('');
  const heroPhoto = productImage(products[0] || {}, slot.market);
  const p0title = esc((products[0] || {}).title || 'KNICKGASM');
  const ctaBtn = (bg, fg) => `<a href="${store}" style="display:inline-block;margin-top:24px;background:${bg};color:${fg};font-family:${body};font-size:14px;font-weight:700;padding:14px 34px;border-radius:8px;text-decoration:none">${esc(copy.cta_primary)}</a>`;

  // ── Named sections — assembled per the archetype's order below ────────────
  const strat = designStrategy.strategyFor(slot);
  const kicker = esc(slot.festival || slot.theme || 'The Collection');
  const SEC = {
    // Green centred hero (bold, offer-forward).
    heroGreen: `<tr><td style="background:${P.forest_green};border-radius:14px;padding:46px 36px" align="center">
      <div style="font-family:${body};font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${P.lava};margin-bottom:14px">${kicker}</div>
      <div style="font-family:${heads};font-size:34px;line-height:1.2;color:${P.chalk};font-weight:700">${esc(copy.headline)}</div>
      <div style="font-family:${body};font-size:15px;line-height:1.6;color:${P.chalk}CC;margin-top:14px">${esc(copy.subheadline)}</div>
      ${ctaBtn(P.lava, P.near_black)}
    </td></tr>`,
    // Editorial photo-led hero (aspirational, image first, light copy). Falls
    // back to the green hero when no photo is available.
    heroEditorial: heroPhoto
      ? `<tr><td style="padding:0">
      <img src="${heroPhoto}" alt="${p0title}" width="620" style="width:100%;max-width:620px;height:auto;border-radius:14px 14px 0 0;display:block"/>
      <div style="background:${P.chalk};border:1px solid ${P.lava}33;border-top:0;border-radius:0 0 14px 14px;padding:30px 34px" align="center">
        <div style="font-family:${body};font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${P.lava};margin-bottom:12px">${kicker}</div>
        <div style="font-family:${heads};font-size:30px;line-height:1.22;color:${P.forest_green};font-weight:700">${esc(copy.headline)}</div>
        <div style="font-family:${body};font-size:15px;line-height:1.6;color:${P.near_black}CC;margin-top:12px">${esc(copy.subheadline)}</div>
        ${ctaBtn(P.forest_green, P.chalk)}
      </div></td></tr>`
      : `<tr><td style="background:${P.forest_green};border-radius:14px;padding:46px 36px" align="center">
      <div style="font-family:${heads};font-size:32px;line-height:1.2;color:${P.chalk};font-weight:700">${esc(copy.headline)}</div>
      <div style="font-family:${body};font-size:15px;line-height:1.6;color:${P.chalk}CC;margin-top:14px">${esc(copy.subheadline)}</div>
      ${ctaBtn(P.lava, P.near_black)}</td></tr>`,
    // Founder letter (personal, chalk, signed).
    founderNote: `<tr><td style="background:${P.chalk};border:1px solid ${P.lava}44;border-radius:14px;padding:34px 34px 28px">
      <div style="font-family:${body};font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${P.lava};margin-bottom:12px">A note from our founder</div>
      <div style="font-family:${heads};font-size:26px;line-height:1.25;color:${P.forest_green};font-weight:700">${esc(copy.headline)}</div>
      <div style="font-family:${body};font-size:15px;line-height:1.8;color:${P.near_black};margin-top:16px">${esc(copy.body_intro)}</div>
      <div style="font-family:${body};font-size:15px;line-height:1.8;color:${P.near_black};margin-top:12px">${esc(copy.story)}</div>
      <div style="font-family:${heads};font-size:16px;color:${P.forest_green};margin-top:18px">Warmly,<br>The KNICKGASM family</div>
      ${ctaBtn(P.forest_green, P.chalk)}
    </td></tr>`,
    photoBand: heroPhoto
      ? `<tr><td style="padding:16px 0 0"><img src="${heroPhoto}" alt="${p0title}" width="620" style="width:100%;max-width:620px;height:auto;border-radius:14px;display:block"/></td></tr>`
      : '',
    badges: `<tr><td style="padding:14px 16px 2px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${badgeRow}</tr></table></td></tr>`,
    bodyStory: `<tr><td style="padding:22px 26px 6px">
      <div style="font-family:${body};font-size:15px;line-height:1.75;color:${P.near_black}">${esc(copy.body_intro)}</div>
      <div style="font-family:${body};font-size:15px;line-height:1.75;color:${P.near_black};margin-top:14px">${esc(copy.story)}</div>
    </td></tr>`,
    steps: stepRow,
    productGrid: `<tr><td style="padding:14px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${prods}</tr></table></td></tr>`,
    testimonials: testiBlocks ? `<tr><td style="padding:8px 26px 6px">${testiBlocks}</td></tr>` : '',
    guarantee: guarantee ? `<tr><td align="center" style="padding:6px 26px"><div style="border:1px dashed ${P.lava};border-radius:10px;padding:14px 18px"><span style="font-family:${heads};font-size:14px;color:${P.forest_green};font-weight:700">${esc(guarantee.headline)}</span> <span style="font-family:${body};font-size:12.5px;color:${P.near_black}AA">${esc(guarantee.body)}</span></div></td></tr>` : '',
    agentCta: `<tr><td align="center" style="padding:18px 26px 8px">
      <div style="border:1px solid ${P.lava}55;border-radius:12px;padding:20px 22px;background:#ffffff">
        <div style="font-family:${heads};font-size:17px;color:${P.forest_green}">Not sure where to begin?</div>
        <div style="font-family:${body};font-size:13px;color:${P.near_black}AA;line-height:1.6;margin-top:6px">Talk to our sneaker expert, ask about benefits, crafting, and which colorway fits your ritual. It answers, out loud, like a call.</div>
        <a href="${agentUrl}" style="display:inline-block;margin-top:12px;background:${P.forest_green};color:${P.chalk};font-family:${body};font-size:13px;font-weight:700;padding:11px 26px;border-radius:8px;text-decoration:none">Talk to the Knickgasm expert →</a>
      </div>
    </td></tr>`,
  };
  // Assemble the body in the archetype's order; badges always follow the hero
  // (first section). Unknown/empty keys are skipped. Fallback to a sane order.
  const order = (strat.order && strat.order.length) ? strat.order : ['heroGreen', 'photoBand', 'bodyStory', 'steps', 'productGrid', 'testimonials', 'guarantee', 'agentCta'];
  const bodyRows = order.map((k, i) => (SEC[k] || '') + (i === 0 ? SEC.badges : '')).join('\n  ');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(copy.subject)}</title></head>
<body style="margin:0;padding:0;background:${P.chalk}">
<div style="display:none;max-height:0;overflow:hidden">${esc(copy.preheader)}</div>
<div style="display:none;max-height:0;overflow:hidden">Design: ${esc(strat.label)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${P.chalk}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%">
  <tr><td align="center" style="background:${P.lava};border-radius:8px;padding:8px 14px;font-family:${body};font-size:12px;font-weight:700;color:${P.near_black}">${esc(offerBar)}</td></tr>
  <tr><td align="center" style="padding:18px 0 8px">
    <a href="${store}" target="_blank" style="text-decoration:none;display:inline-block">
      <div style="font-family:${heads};font-size:22px;letter-spacing:0.28em;color:${P.forest_green};font-weight:700">KNICKGASM</div>
      <div style="font-family:${body};font-size:10px;letter-spacing:0.22em;color:${P.lava};text-transform:uppercase;margin-top:4px">${esc(String(market || '').toUpperCase())}</div>
    </a>
  </td></tr>
  ${bodyRows}
  <tr><td align="center" style="padding:8px 20px 26px">
    <a href="${collectionUrl}" target="_blank" style="display:inline-block;font-family:${body};font-size:13px;font-weight:700;color:${P.forest_green};border:1.5px solid ${P.lava};border-radius:8px;padding:11px 24px;text-decoration:none">${esc(copy.cta_secondary || 'Explore the collection')}</a>
  </td></tr>
  <tr><td align="center" style="background:${P.near_black};padding:24px 22px 30px">
    <div style="font-family:${heads};font-size:14px;letter-spacing:0.24em;color:${P.chalk}">KNICKGASM</div>
    <div style="font-family:${body};font-size:10.5px;letter-spacing:0.05em;color:${P.lava};margin:9px 0">Single-studio · Hand-painted · Shipped fresh from origin</div>
    <div style="font-family:${body};font-size:11px;color:${P.chalk}99;line-height:1.7">${ORG_NAME} &middot; ${ORG_ADDRESS}<br>You are receiving this as a valued KNICKGASM ${esc(slot.market)} customer. Carbon &amp; plastic neutral.<br>Manage preferences or unsubscribe from your account settings.</div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

// Build the same mailer taxonomy as the Mailer Studio / Mailer Calendar:
// two named types, two variants each: 2 Text (colour + type + structural
// elements, no media) and 2 Text + Visual (with a real product image). Uses the
// shared renderTextVariant so the look + quality match across features. The
// rich brand mailer becomes one of the Text + Visual variants. Falls back to
// just the rich mailer if the shared renderer is unavailable.
function mailerVariants(slot, copy, products, brand, agentUrl, richHtml) {
  if (!renderTextVariant) return null;
  const store = (brand.store_urls || {})[slot.market] || 'https://knickgasm.com';
  const p0 = products[0] || {};
  const heroImg = productImage(p0, slot.market) || '';
  const S = {
    hero_headline: copy.headline,
    hero_subline: copy.subheadline,
    body_blocks: [
      copy.body_intro ? { heading: '', body: copy.body_intro } : null,
      copy.story ? { heading: '', body: copy.story } : null,
      (copy.testimonial && copy.testimonial.quote) ? { heading: '', body: `"${copy.testimonial.quote}" - ${copy.testimonial.name || ''}` } : null,
    ].filter(Boolean),
    cta_text: copy.cta_primary || 'Shop the edit',
  };
  const collectionUrl = /kicks/.test(((p0.type) || '').toLowerCase()) ? `${store}/collections/kicks-sneaker`
    : /green/.test(((p0.type) || '').toLowerCase()) ? `${store}/collections/green-sneaker`
    : `${store}/collections/all`;
  // `withGrid` gates the real product-image grid + collection CTA to the
  // Text + Visual variants; pure "Text" variants stay graphics-free per taxonomy.
  const mk = (style, img, withGrid) => renderTextVariant({
    style, subject: copy.subject, hero_headline: S.hero_headline, hero_subline: S.hero_subline,
    body_blocks: S.body_blocks, cta_text: S.cta_text, cta_url: store, market: slot.market,
    hero_product: p0.title || slot.theme || '', hero_image_url: img || undefined,
    // Flagship-parity: real inline product grid + derived collection CTA + offer bar.
    ...(withGrid ? { products, collection_url: collectionUrl, offer_bar: (copy.landing && copy.landing.offer_bar) || undefined } : {}),
  });
  return [
    { key: 'text_a', type: 'Text', label: 'Text · Concise', html: mk('pure') },
    { key: 'text_b', type: 'Text', label: 'Text · Editorial', html: mk('editorial') },
    { key: 'visual_a', type: 'Text + Visual', label: 'Text + Visual · Hero', html: mk('visual', heroImg, true) },
    { key: 'visual_b', type: 'Text + Visual', label: 'Text + Visual · Rich brand', html: richHtml },
  ];
}

function landingHtml(slot, copy, products, brand, agentUrl) {
  const P = brand.palette;
  const heads = brand.typography.headings.fallback;
  const body = brand.typography.body.fallback;
  const store = (brand.store_urls || {})[slot.market] || 'https://knickgasm.com';
  const cur = slot.market === 'UK' ? '£' : '$';
  const esc = (s) => String(s == null ? '' : s).replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
  const L = copy.landing || {};
  // Defensive defaults so an older/partial LLM response still renders well.
  const eyebrow = L.hero_eyebrow || slot.festival || slot.theme || 'Single-studio · Hand-painted';
  const heroH = L.hero_headline || copy.headline;
  const heroSub = L.hero_sub || copy.subheadline;
  const offerBar = L.offer_bar || `Welcome gift: free rope laces and lace tag with every custom pair`;
  const badges = (L.trust_badges && L.trust_badges.length ? L.trust_badges : ['Single-studio origin', 'Packed days after drop', 'Carbon & plastic neutral', '1M+ pairs poured']);
  const problem = L.problem || { headline: 'Most sneaker is older than you think', body: copy.body_intro };
  const mech = L.mechanism || { headline: 'Why origin-fresh tastes different', steps: [] };
  const benefits = (L.benefits && L.benefits.length ? L.benefits : (L.benefit_bullets || []).map((b) => ({ title: b, desc: '' })));
  // Real-only gate: drop the fabricated "vs Supermarket sneaker" comparison (its
  // disparaging claims are unverified), and show only approved testimonials.
  const comp = brandFacts.enabled() ? null : (L.comparison || null);
  const testis = gateTestis((L.testimonials && L.testimonials.length ? L.testimonials : [copy.testimonial].filter(Boolean).map((t) => ({ quote: t.quote, name: t.name, location: '' }))), slot, products[0]);
  const stack = L.offer_stack || { headline: 'What is in your first order', items: [], price_note: '', cta: copy.cta_primary };
  const faqList = L.faq || [];
  const guarantee = L.guarantee || { headline: 'Lace-up it risk-free', body: 'Love the panel or we will make it right.' };
  const agentId = `knickgasm_${(slot.cohort_id || slot.market || 'sneaker').toString().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

  const badgeRow = badges.slice(0, 4).map((b) => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:${P.chalk}DD"><span style="color:${P.lava}">✦</span>${esc(b)}</span>`).join('<span style="opacity:.4">·</span>');
  const steps = (mech.steps || []).slice(0, 3).map((s, i) => `
    <div class="card" style="animation-delay:${i * 90}ms;background:#fff;border:1px solid ${P.lava}33;border-radius:14px;padding:24px">
      <div style="width:34px;height:34px;border-radius:50%;background:${P.forest_green};color:${P.chalk};display:flex;align-items:center;justify-content:center;font-weight:700;font-family:${heads}">${i + 1}</div>
      <div style="font-family:${heads};font-size:18px;color:${P.near_black};margin:14px 0 6px">${esc(s.title)}</div>
      <div style="font-size:14px;color:${P.near_black}AA;line-height:1.6">${esc(s.desc)}</div>
    </div>`).join('');
  const benefitCards = benefits.slice(0, 4).map((b, i) => `
    <div class="card" style="animation-delay:${i * 70}ms;background:#fff;border:1px solid ${P.lava}33;border-radius:14px;padding:22px">
      <div style="color:${P.lava};font-size:20px">✦</div>
      <div style="font-family:${heads};font-size:17px;color:${P.near_black};margin:8px 0 6px">${esc(b.title)}</div>
      ${b.desc ? `<div style="font-size:14px;color:${P.near_black}AA;line-height:1.6">${esc(b.desc)}</div>` : ''}
    </div>`).join('');
  const prods = products.slice(0, 3).map((p, i) => `
    <a href="${p.url || store}" class="card" style="animation-delay:${i * 90}ms;text-decoration:none;background:#fff;border:1px solid ${P.lava}33;border-radius:14px;padding:26px 20px;display:block">
      <div style="font-family:${heads};font-size:18px;color:${P.near_black};line-height:1.35">${esc(p.title)}</div>
      <div style="font-size:13px;color:${P.near_black}88;margin-top:6px">${esc(p.category)}</div>
      <div style="font-size:15px;color:${P.lava};font-weight:700;margin-top:12px">${cur}${p.price}</div>
    </a>`).join('');
  const compTable = comp ? `
  <section style="padding:24px 0 72px"><div class="wrap" style="max-width:760px">
    <h3 style="font-family:${heads};font-size:26px;color:${P.forest_green};text-align:center;margin-bottom:24px">The difference, side by side</h3>
    <div style="overflow:hidden;border:1px solid ${P.lava}33;border-radius:14px;background:#fff">
      <table style="width:100%;border-collapse:collapse;font-size:14.5px">
        <thead><tr style="background:${P.forest_green};color:${P.chalk}">
          <th style="text-align:left;padding:14px 16px;font-family:${heads};font-weight:600"></th>
          <th style="padding:14px 16px;font-family:${heads};font-weight:700">${esc(comp.us_label || 'KNICKGASM')}</th>
          <th style="padding:14px 16px;font-family:${heads};font-weight:600;color:${P.chalk}AA">${esc(comp.them_label || 'Supermarket sneaker')}</th>
        </tr></thead>
        <tbody>${(comp.rows || []).map((r, i) => `<tr style="background:${i % 2 ? P.chalk : '#fff'}">
          <td style="padding:13px 16px;color:${P.near_black}99">${esc(r.feature)}</td>
          <td style="padding:13px 16px;text-align:center;font-weight:600;color:${P.forest_green}">${esc(r.us)}</td>
          <td style="padding:13px 16px;text-align:center;color:${P.near_black}88">${esc(r.them)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </div></section>` : '';
  const testiCards = testis.slice(0, 3).map((t, i) => `
    <div class="card" style="animation-delay:${i * 80}ms;background:#fff;border:1px solid ${P.lava}33;border-radius:14px;padding:24px">
      <div style="color:${P.lava};letter-spacing:2px">★★★★★</div>
      <div style="font-family:${heads};font-style:italic;font-size:16px;line-height:1.6;margin:10px 0;color:${P.near_black}">“${esc(t.quote)}”</div>
      <div style="font-size:12.5px;color:${P.lava};font-weight:600">- ${esc(t.name)}${t.location ? `, ${esc(t.location)}` : ''}</div>
    </div>`).join('');
  const stackItems = (stack.items || []).map((it) => `<li style="margin:10px 0;padding-left:28px;position:relative;line-height:1.6"><span style="position:absolute;left:0;color:${P.lava}">✓</span>${esc(it)}</li>`).join('');
  const faq = faqList.map((f) => `<details style="border-bottom:1px solid ${P.lava}33;padding:16px 0"><summary style="font-family:${heads};font-size:17px;color:${P.near_black};cursor:pointer;list-style:none">${esc(f.q)}</summary><p style="color:${P.near_black}BB;line-height:1.7;margin:10px 0 0">${esc(f.a)}</p></details>`).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heroH)} — KNICKGASM</title>
<meta name="description" content="${esc(heroSub)}">
<style>
  *{box-sizing:border-box}
  body{margin:0;background:${P.chalk};color:${P.near_black};font-family:${body};padding-bottom:64px}
  .wrap{max-width:1040px;margin:0 auto;padding:0 22px}
  .fade{opacity:0;transform:translateY(18px);animation:up .7s ease forwards}
  .card{opacity:0;transform:translateY(18px) scale(.98);animation:up .6s ease forwards}
  @keyframes up{to{opacity:1;transform:none}}
  .cta{display:inline-block;background:${P.lava};color:${P.near_black};font-weight:700;font-size:15px;padding:16px 38px;border-radius:9px;text-decoration:none;transition:transform .2s, box-shadow .2s}
  .cta:hover{transform:translateY(-2px);box-shadow:0 14px 34px ${P.forest_green}44}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
  .obar{background:${P.lava};color:${P.near_black};text-align:center;font-size:13px;font-weight:600;padding:9px 14px}
  .stickb{position:fixed;left:0;right:0;bottom:0;z-index:50;background:${P.forest_green};display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;box-shadow:0 -6px 20px rgba(0,0,0,.18)}
  .stickb .p{color:${P.chalk};font-size:13px}.stickb .p b{color:${P.lava}}
  @media(max-width:760px){.split{grid-template-columns:1fr!important}.stickb .p{display:none}}
</style></head>
<body>
<div class="obar">${esc(offerBar)}</div>
<header style="background:${P.forest_green};padding:14px 0"><div class="wrap" style="display:flex;justify-content:space-between;align-items:center">
  <div style="font-family:${heads};letter-spacing:.3em;color:${P.chalk};font-weight:700">KNICKGASM</div>
  <a href="${agentUrl}" style="color:${P.lava};font-size:13px;text-decoration:none">🎙 Talk to our sneaker expert</a>
</div></header>

<section style="background:${P.forest_green};padding:72px 0 64px;text-align:center">
  <div class="wrap">
    <div class="fade" style="font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:${P.lava}">${esc(eyebrow)}</div>
    <h1 class="fade" style="animation-delay:.1s;font-family:${heads};font-size:clamp(34px,5vw,56px);color:${P.chalk};line-height:1.15;margin:18px auto;max-width:780px">${esc(heroH)}</h1>
    <p class="fade" style="animation-delay:.2s;color:${P.chalk}CC;font-size:17px;max-width:580px;margin:0 auto 30px;line-height:1.65">${esc(heroSub)}</p>
    <a class="cta fade" style="animation-delay:.3s" href="${store}">${esc(copy.cta_primary)}</a>
    <div class="fade" style="animation-delay:.4s;margin-top:26px;display:flex;gap:14px;flex-wrap:wrap;justify-content:center">${badgeRow}</div>
  </div>
</section>

<section style="padding:64px 0 24px"><div class="wrap" style="max-width:760px;text-align:center">
  <h2 style="font-family:${heads};font-size:30px;color:${P.forest_green}">${esc(problem.headline)}</h2>
  <p style="line-height:1.85;color:${P.near_black}CC;font-size:16px">${esc(problem.body)}</p>
</div></section>

<section style="padding:24px 0 56px"><div class="wrap">
  <h3 style="font-family:${heads};font-size:26px;color:${P.forest_green};text-align:center;margin-bottom:28px">${esc(mech.headline)}</h3>
  <div class="grid">${steps}</div>
</div></section>

<section style="padding:8px 0 56px"><div class="wrap">
  <div class="grid">${benefitCards}</div>
</div></section>

<section style="padding:8px 0 64px"><div class="wrap">
  <h3 style="font-family:${heads};font-size:24px;color:${P.forest_green};text-align:center;margin-bottom:28px">Laced most by this cohort</h3>
  <div class="grid">${prods}</div>
</div></section>

${compTable}

<section style="padding:8px 0 64px"><div class="wrap">
  <h3 style="font-family:${heads};font-size:26px;color:${P.forest_green};text-align:center;margin-bottom:28px">From people who switched</h3>
  <div class="grid">${testiCards}</div>
</div></section>

<section style="padding:8px 0 72px"><div class="wrap" style="max-width:760px">
  <div style="background:${P.forest_green};border-radius:18px;padding:40px;color:${P.chalk};text-align:center">
    <h3 style="font-family:${heads};font-size:26px;color:${P.chalk};margin:0 0 8px">${esc(stack.headline)}</h3>
    <ul style="list-style:none;padding:0;text-align:left;max-width:440px;margin:18px auto;font-size:15px;color:${P.chalk}EE">${stackItems}</ul>
    ${stack.price_note ? `<div style="color:${P.lava};font-weight:700;font-size:18px;margin:8px 0 18px">${esc(stack.price_note)}</div>` : ''}
    <a class="cta" href="${store}">${esc(stack.cta || copy.cta_primary)}</a>
  </div>
</div></section>

<section style="padding:0 0 24px"><div class="wrap" style="max-width:720px">
  <h3 style="font-family:${heads};font-size:24px;color:${P.forest_green}">Questions, answered</h3>${faq}
</div></section>

<section style="padding:24px 0 72px"><div class="wrap" style="max-width:640px;text-align:center">
  <div style="border:1px dashed ${P.lava};border-radius:14px;padding:28px;background:#fff">
    <div style="font-family:${heads};font-size:20px;color:${P.forest_green}">${esc(guarantee.headline)}</div>
    <p style="color:${P.near_black}AA;line-height:1.7;margin:8px 0 0">${esc(guarantee.body)}</p>
  </div>
  <div style="margin-top:34px"><a class="cta" href="${store}">${esc(copy.cta_secondary || copy.cta_primary)}</a></div>
  <div style="margin-top:14px"><a href="${agentUrl}" style="color:${P.forest_green};font-weight:700;text-decoration:none;font-size:14px">🎙 Or ask our sneaker expert anything →</a></div>
</div></section>

<footer style="background:${P.near_black};color:${P.chalk}99;text-align:center;padding:30px;font-size:12px">${ORG_NAME} &middot; ${ORG_ADDRESS}<br>Single-studio &middot; Carbon &amp; plastic neutral</footer>

<div class="stickb">
  <div class="p"><b>${esc(offerBar)}</b></div>
  <a class="cta" style="padding:11px 26px;font-size:14px" href="${store}">${esc(copy.cta_primary)}</a>
</div>

<!-- Embedded all-in-one KNICKGASM voice agent (chat + voice), like the reference LP -->
<script src="/agent-widget.js" data-agent="${agentId}" data-collection="${esc(slot.market || '')}" defer></script>
</body></html>`;
}

// ── Platform-ready campaign objects (phase-2 push plugs in here) ────────────
function audienceSpec(slot, cohort) {
  const base = cohort ? { cohort_id: cohort.id, name: cohort.name, definition: cohort.definition, size: cohort.size } : { name: 'All engaged customers' };
  return {
    primary: base,
    retargeting: {
      name: `RT · ${slot.theme || slot.channel} · ${slot.market}`,
      rule: 'engaged with this campaign (open/click/video_view ≥ 50%) OR visited landing page, last 14d, excluding purchasers 7d',
      window_days: 14,
    },
    expansion: {
      lookalike: { source: base.name, ratio: slot.market === 'US' ? '1-3%' : '1-5%', note: 'similar-audience seed = cohort members with ≥2 orders' },
      interest_stack: ['premium sneaker', 'ayurveda', 'streetwear rituals', 'specialty grocery'],
    },
    exclusions: ['purchasers_last_7d', 'unsubscribed', 'refunded_last_90d'],
  };
}

function campaignObjects(slot, copy, cohort, products, brand) {
  const aud = audienceSpec(slot, cohort);
  const store = (brand.store_urls || {})[slot.market] || 'https://knickgasm.com';
  const utm = `utm_source={platform}&utm_medium={medium}&utm_campaign=${encodeURIComponent(slot.id)}`;
  const objs = [];
  if (slot.channel === 'email' || slot.channel === 'landing_email') {
    objs.push({
      platform: 'klaviyo',
      campaign_object: {
        type: 'campaign', name: `${slot.theme} · ${slot.market} · ${slot.slot_date}`,
        audience: aud, send_time_local: '09:30',
        message: { subject: copy.subject, preheader: copy.preheader, from_name: 'KNICKGASM', from_email: 'hello@knickgasm.com', template_ref: `asset:mailer_html:${slot.id}` },
        ab_test: { dimension: 'subject', variants: [copy.subject, `${copy.headline}, inside`], split: 0.5, metric: 'open_rate' },
        followup: { trigger: 'no_open_48h', action: 'resend_new_subject' },
        utm,
      },
    });
  }
  if (slot.channel === 'google') {
    objs.push({
      platform: 'google_ads',
      campaign_object: {
        campaign: { name: `G·${slot.market}·${slot.slot_date}·${slot.theme}`, type: 'SEARCH', bidding: 'MAXIMIZE_CONVERSION_VALUE', budget_daily_usd: 80, geo: slot.market === 'UK' ? ['GB'] : ['US'] },
        ad_group: { name: slot.angle || 'core', keywords: (copy.google.headlines || []).slice(0, 6).map((h) => ({ text: h.toLowerCase(), match: 'PHRASE' })) },
        responsive_search_ad: { headlines: copy.google.headlines, descriptions: copy.google.descriptions, final_url: `${store}?${utm.replace('{platform}', 'google').replace('{medium}', 'cpc')}` },
        extensions: { callouts: copy.google.callouts || [], sitelinks: copy.google.sitelinks || [] },
        audience: aud,
      },
    });
  }
  if (slot.channel === 'meta') {
    objs.push({
      platform: 'meta_ads',
      campaign_object: {
        campaign: { name: `M·${slot.market}·${slot.slot_date}·${slot.theme}`, objective: 'OUTCOME_SALES', budget_daily_usd: 70 },
        ad_set: { optimization: 'OFFSITE_CONVERSIONS', audience: aud, placements: ['feed', 'stories', 'reels'] },
        creative: { primary_text: copy.meta.primary_text, primary_text_variants: copy.meta.primary_text_variants || [], headline: copy.meta.headline, headlines: copy.meta.headlines || [copy.meta.headline], description: copy.meta.description, cta: 'SHOP_NOW', link: `${store}?${utm.replace('{platform}', 'meta').replace('{medium}', 'paid_social')}`, brief: `${copy.meta.creative_concept || `1-second emotional scroll-stop — the calm of a quiet morning pair of ${products[0] ? products[0].title : 'sneaker'}, soft dawn light, steam, lava props on ${brand.palette.chalk} linen`}. Paid Meta creative for P01 (women 45+/busy mums): sell the HAPPINESS end-state (calmer mornings, steady energy, "like myself again"), NOT ingredients. BAKE the headline "${copy.meta.headline || ''}" + the offer INTO the creative as legible on-palette text overlay (Montserrat headline, Instrument Sans offer) in the safe zone. Palette: deep purple ${brand.palette.forest_green} / lava ${brand.palette.lava} / chalk ${brand.palette.chalk}.`, formats: ['1:1 static hero', '4:5 feed', '9:16 story/reel', '3-card carousel (studio → panel → pair)'] },
        ab_test: { dimension: 'primary_text', variants: copy.meta.primary_text_variants || ['static_hero', 'carousel_3p'], metric: 'roas' },
      },
    });
  }
  if (slot.channel === 'tiktok') {
    objs.push({
      platform: 'tiktok_ads',
      campaign_object: {
        campaign: { name: `T·${slot.market}·${slot.slot_date}·${slot.theme}`, objective: 'WEB_CONVERSIONS', budget_daily_usd: 50 },
        ad_group: { audience: aud, placements: ['tiktok'], optimization: 'CONVERSION' },
        creative: { hook_line: copy.tiktok.hook_line, script: copy.tiktok.script, shot_list: copy.tiktok.shot_list || [], captions: copy.tiktok.captions || [], format: 'ugc_voiceover_15s', link: `${store}?${utm.replace('{platform}', 'tiktok').replace('{medium}', 'paid_social')}`, brief: 'Creator-style kitchen shot, natural daylight, craft pour at 0:03 with steam bloom, on-screen captions per shot_list, end-card in deep purple with lava CTA. Vertical 9:16, sound-on, no licensed music.' },
      },
    });
  }
  if (slot.channel === 'landing_email' || slot.channel === 'landing_ads') {
    objs.push({
      platform: 'landing',
      campaign_object: { type: 'landing_page', name: `LP·${slot.market}·${slot.slot_date}`, html_ref: `asset:landing_html:${slot.id}`, paired_channel: (slot.source || {}).paired_channel || null, cro: { above_fold_cta: true, social_proof: true, faq_schema: true, voice_agent_entry: true } },
    });
  }
  return objs;
}

function funnelSpec(slot, cohort, copy) {
  return {
    id: idFor('fun', { slot: slot.id }),
    cohort_id: cohort ? cohort.id : null,
    slot_id: slot.id,
    name: `Funnel · ${slot.theme || slot.channel} · ${slot.market} · ${slot.slot_date}`,
    stages: [
      { step: 1, stage: 'creative', channel: slot.channel.startsWith('landing') ? ((slot.source || {}).paired_channel || 'email') : slot.channel, asset: 'ad_copy/mailer', goal: 'attention', kpi: slot.channel === 'email' ? 'open_rate' : 'ctr' },
      { step: 2, stage: 'landing', channel: 'landing', asset: 'landing_html', goal: 'conversion', kpi: 'cvr', cro: ['hero CTA above fold', 'voice-agent assist entry', 'testimonial proof', 'FAQ objections'] },
      { step: 3, stage: 'mailer_followup', channel: 'email', asset: 'mailer_html', goal: 'recover + repeat', kpi: 'rpr', trigger: 'visited LP, no purchase 48h → follow-up mailer; purchased → post-purchase ritual series' },
    ],
    retargeting: audienceSpec(slot, cohort).retargeting,
    audiences: audienceSpec(slot, cohort),
    created_at: new Date().toISOString(),
  };
}

// ── main entry ───────────────────────────────────────────────────────────────
async function generateForSlot(slotId, { persist = true } = {}) {
  const d = db();
  const [slotRows, brand] = await Promise.all([
    d.select('smart_calendar', { filters: { id: `eq.${slotId}` }, limit: 1 }),
    getBrandKit(),
  ]);
  const slot = slotRows[0];
  if (!slot) throw new Error(`slot ${slotId} not found`);

  const [cohortRows, lib] = await Promise.all([
    slot.cohort_id ? d.select('smart_cohorts', { filters: { id: `eq.${slot.cohort_id}` }, limit: 1 }) : Promise.resolve([]),
    analysis.filteredLibrary({ channel: slot.channel.startsWith('landing') ? 'email' : slot.channel, market: slot.market }),
  ]);
  const cohort = cohortRows[0] || null;

  // product selection: match cohort categories then top sellers
  const products = await d.select('smart_products', { filters: { market: `eq.${slot.market}`, active: 'eq.true' }, limit: 200 });
  const wantTags = cohort ? JSON.stringify(cohort.definition).toLowerCase() : '';
  const picked = products
    .map((p) => ({ p, rel: (p.tags || []).reduce((s, t) => s + (wantTags.includes(t) ? 1 : 0), 0) + ((slot.festival && (p.tags || []).includes('gift')) ? 2 : 0) }))
    .sort((a, b) => b.rel - a.rel || (b.p.tags || []).includes('bestseller') - (a.p.tags || []).includes('bestseller'))
    .slice(0, 3).map((x) => x.p)
    // Guarantee a real hosted photo on each product so the Text + Visual mailer
    // variants always render an image (the smart_products rows often lack one).
    .map((p) => ({ ...p, image: productImage(p, slot.market) }));

  const copy = await generateCopy(slot, picked, brand, lib.items);
  const agentUrl = `/agent?ctx=${encodeURIComponent(slot.market)}&from=${encodeURIComponent(slot.id)}`;

  const funnel = funnelSpec(slot, cohort, copy);
  const objects = campaignObjects(slot, copy, cohort, picked, brand);

  const assets = [];
  const push = (type, name, content, meta = {}) => assets.push({ id: idFor('ast', { slot: slot.id, type, name }), slot_id: slot.id, type, name, content, meta, created_at: new Date().toISOString() });

  if (slot.channel === 'email') {
    const richHtml = mailerHtml(slot, copy, picked, brand, agentUrl);
    const variants = mailerVariants(slot, copy, picked, brand, agentUrl, richHtml);
    push('mailer_html', `Mailer · ${slot.theme} · ${slot.market}`, richHtml, { subject: copy.subject, preheader: copy.preheader, variants: variants || ['A: image hero', 'B: text editorial'] });
  }
  if (slot.channel.startsWith('landing')) {
    const store = (brand.store_urls || {})[slot.market] || 'https://knickgasm.com';
    const hub = pickCampaignHubLP(slot, picked);
    if (hub) {
      // Premium curated themed LP from the Campaign Hub compiler.
      push('landing_html', `Landing · ${hub.theme.name} · ${slot.market}`, lpCompiler.compileHTML(hub.theme, hub.variant, store),
        { source: 'campaign_hub', theme: hub.theme.slug, variant: hub.variant.code, paired: (slot.source || {}).paired_channel || null });
    } else {
      push('landing_html', `Landing · ${slot.theme} · ${slot.market}`, landingHtml(slot, copy, picked, brand, agentUrl),
        { source: 'brain_llm', paired: (slot.source || {}).paired_channel || null });
    }
  }
  if (['google', 'meta', 'tiktok'].includes(slot.channel)) {
    push('ad_copy', `${slot.channel} copy · ${slot.market}`, JSON.stringify(slot.channel === 'google' ? copy.google : slot.channel === 'meta' ? copy.meta : copy.tiktok, null, 2), { angle: slot.angle });
    const brief = objects.find((o) => o.platform.includes(slot.channel === 'google' ? 'google' : slot.channel));
    if (brief) push('ad_creative_brief', `${slot.channel} creative brief`, JSON.stringify(((brief.campaign_object || {}).creative || (brief.campaign_object || {}).responsive_search_ad) || {}, null, 2));
  }
  push('audience_spec', `Audiences · ${slot.market}`, JSON.stringify(audienceSpec(slot, cohort), null, 2));
  push('funnel_spec', funnel.name, JSON.stringify(funnel, null, 2));

  // Carry the slot's real confidence onto every generated campaign (was a
  // hardcoded confidence:0). The planning analysis was stashed in the slot's
  // source column by brain-calendar.slotRow().
  const slotAnalysis = (slot.source && slot.source.analysis) || null;
  const slotConfidence = (typeof slot.confidence === 'number' && slot.confidence > 0) ? slot.confidence : (slotAnalysis && slotAnalysis.confidence && slotAnalysis.confidence.score) || 0;
  const genCampaigns = objects.map((o) => ({
    id: idFor('gen', { slot: slot.id, platform: o.platform }),
    slot_id: slot.id, funnel_id: funnel.id, platform: o.platform,
    campaign_object: o.campaign_object, status: 'pending_review',
    confidence: slotConfidence,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }));

  if (persist) {
    await d.upsert('smart_funnels', [funnel], 'id');
    const saved = await d.upsert('smart_generated_campaigns', genCampaigns, 'id');
    const withFk = assets.map((a) => ({ ...a, generated_campaign_id: (saved[0] || {}).id || null }));
    await d.upsert('smart_generated_assets', withFk, 'id');
    await d.update('smart_calendar', { id: `eq.${slot.id}` }, { status: 'generated', updated_at: new Date().toISOString() });
    // every campaign enters the human review queue (launch state: ALWAYS)
    await d.insert('smart_review_queue', genCampaigns.map((g) => ({ item_type: 'generated_campaign', item_id: g.id, state: 'pending' })));
  }
  // Surface the planning reasoning on the returned campaigns so the UI/API can
  // show WHY each was generated (kept off the persisted rows to stay schema-safe).
  const campaignsOut = genCampaigns.map((g) => ({ ...g, rationale: slot.rationale || (slotAnalysis && slotAnalysis.summary) || null, analysis: slotAnalysis }));
  return { ok: true, slot_id: slot.id, funnel, campaigns: campaignsOut, analysis: slotAnalysis, assets: assets.map((a) => ({ id: a.id, type: a.type, name: a.name, bytes: (a.content || '').length })), copy };
}

module.exports = { generateForSlot, mailerHtml, landingHtml, campaignObjects, audienceSpec, fallbackCopy, pickCampaignHubLP };
