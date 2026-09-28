'use strict';
// ════════════════════════════════════════════════════════════════════════════
// /api/ai/pipeline/html  — Stage 4: AI HTML Email Builder
//
// Takes the locked variant plan (layout + sections + copy) from Stage 2
// and the locked strategy from Stage 1. Generates a COMPLETE production-ready
// HTML email that exactly follows the creative plan — a different structure
// every time because the plan is AI-generated.
//
// Images are NOT sent through the LLM (data URLs are too large for context).
// The HTML is returned with placeholder strings the client replaces with real
// data URLs from Stage 3.
//
// POST body:  { variant, plan, strategy, brief, market, regenerate_counter? }
// Response:   { ok, variant, html, section_count, subject_lines, preheader }
//
// Image placeholders in returned HTML (exact strings):
//   IMAGE_HERO_URL       → replaced by client with imgsA/B.hero data URL
//   IMAGE_PRODUCT_URL    → replaced by client with imgsA/B.product data URL
//   IMAGE_LIFESTYLE_URL  → replaced by client with imgsA/B.lifestyle data URL
// ════════════════════════════════════════════════════════════════════════════

const { corsHeaders } = require('../../_shared/llm');
const callLLM = require('../../_shared/llm');
const MF = require('../../_shared/mailer-format');
const brandRuntime = require('../../_shared/brand-runtime.js');

/* ── The ACTIVE brand's facts, for the prompt and the fallback email ─────────
   The system prompt below was written for tenant zero and, worse, carried a
   sibling brand's facts with the noun swapped: "EST. 2015 · NEW DELHI",
   "Free shipping on $49+", a 4.8/5 rating with 50K+ reviews, B-Corp and
   Farm Direct badges, two gifting taglines mandated verbatim, tenant zero's
   logo URL and fonts declared "EXACT, NEVER SUBSTITUTE". All of it reached the
   model for every workspace. Every fact now comes from the record handed to
   the handler, or is the DATA REQUIRED marker; the palette and typefaces are
   the brand's own tokens. A record with no palette gets a neutral mid-grey,
   never another tenant's colours, and never a dark neutral. */
function factsFor(b) {
  b = b || {};
  const d = b.brand_data || {};
  const pal = b.palette || {};
  const t = b.typography || {};
  const v = b.voice || {};
  const name = b.name || '[DATA REQUIRED BEFORE LAUNCH: brand name]';
  const marker = (f) => '[DATA REQUIRED BEFORE LAUNCH: ' + f + ', ' + name + ']';
  const claims = (b.claims || d.claims || []).filter((c) => typeof c === 'string' && c.trim());
  const claim = (i) => claims[i] || (i === 0 ? marker('verifiable claims') : '');
  const shipping = claims.find((c) => /shipping|deliver/i.test(c)) || '';
  const legal = b.legal_entity || d.legal_entity || marker('legal entity and address');
  const regions = Array.isArray(b.regions) ? b.regions : [];
  const store = (regions.find((r) => r && r.store_url) || {}).store_url || b.website || '';
  const headStack = (t.heading && t.heading.stack) || marker('heading typeface');
  const bodyStack = (t.body && t.body.stack) || marker('body typeface');
  const fam = (s) => String(s || '').split(',')[0].replace(/['"]/g, '').trim();
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const founded = b.founded || d.founded || '';
  // The brand's own Google Fonts sheet, the same one brand-context.js loads in
  // the browser; an empty string when no family on the record is a Google one.
  const fontsHref = b.fonts_href || (() => { try { return require('../../_shared/brand-workspace-core.js').fontsHref(b) || ''; } catch (_) { return ''; } })();
  return {
    name, store, host: String(store).replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    primary: pal.primary || '#6B6B6B', accent: pal.accent || pal.primary || '#6B6B6B', ink: pal.ink || '#111111', surface: pal.surface || '#FFFFFF',
    headStack, bodyStack, headFamily: fam(headStack) || 'heading family', bodyFamily: fam(bodyStack) || 'body family',
    fontsHref,
    fontRules: (fontsHref ? '@import url("' + fontsHref + '"); ' : '') + 'headings use ' + headStack + '; body/UI uses ' + bodyStack + '. Load no other family.',
    logoRule: b.logo_url
      ? 'use this image ONLY (no text wordmark) — <img src="' + b.logo_url + '" alt="' + esc(name) + '" height="30" style="display:block;border:0">'
      : 'no logo image is on the brand record; set the name "' + name + '" as a text wordmark in the heading family.',
    logoHtml: b.logo_url
      ? '<img src="' + b.logo_url + '" alt="' + esc(name) + '" height="30" style="display:inline-block;border:0;height:30px;width:auto">'
      : '<span style="font-family:' + headStack + ';font-size:22px;letter-spacing:0.14em">' + esc(name) + '</span>',
    tagline: b.tagline || '', taglineUpper: String(b.tagline || '').toUpperCase(),
    foundedLine: founded ? 'EST. ' + String(founded).toUpperCase() : '',
    legalLine: legal,
    claims, claim0: claim(0), claim1: claim(1), claim2: claim(2), claim3: claim(3),
    claimsMid: claims.length ? claims.slice(0, 4).join(' &nbsp;·&nbsp; ') : marker('verifiable claims'),
    claimsUpper: claims.length ? claims.slice(0, 4).map((c) => c.toUpperCase()).join(' &nbsp;·&nbsp; ') : marker('verifiable claims'),
    shippingLine: shipping,
    shippingOrNone: shipping ? '"' + shipping + '"' : '(none on the brand record: write none)',
    shippingSuffix: shipping ? ' &nbsp;·&nbsp; ' + shipping.toUpperCase() : '',
    shippingRule: shipping ? 'Mention "' + shipping + '" at least once — it is the brand\'s own claim.' : 'The brand record carries no shipping claim: write none.',
    shippingUpperOrTagline: shipping ? '✦ ' + shipping.toUpperCase() : String(b.tagline || name).toUpperCase(),
    preferred: Array.isArray(v.preferred) && v.preferred.length ? v.preferred.join(', ') : '(none on the brand record)',
    banned: Array.isArray(v.banned) && v.banned.length ? v.banned.join(', ') : '(none on the brand record beyond the platform rules)',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER SYSTEM PROMPT — Steps 9-10 of the final master orchestration system
// ─────────────────────────────────────────────────────────────────────────────
function systemFor(F) { return `You are the HTML execution engine for ${F.name}'s email marketing platform. Your outputs directly impact revenue.

You produce COMPLETE, CONVERSION-OPTIMISED HTML emails that:
→ Implement the creative plan EXACTLY — no rewrites, no truncation, no invented content
→ Apply the MASTER MARKETING PRINCIPLES below — these override everything else
→ Render correctly on desktop (600px) AND mobile (320-414px) with responsive stacking
→ Are completely different between Variant A and Variant B on every visual dimension

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MASTER MARKETING PRINCIPLES — NON-NEGOTIABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

① OFFER ABOVE THE FOLD — Discount badge/offer must appear in Section 1 (announcement bar) AND Section 3 (hero). The buyer must see the offer without scrolling.

② PRICE ALWAYS VISIBLE — Every product shows: current price + strikethrough compare-at + % OFF badge. If no price in plan → derive from product data. Never omit price.

③ EXPLICIT ADD TO CART — Every product card has a full-width "🛒 ADD TO CART" button (dark green ${F.primary}, display:block). Never rely on clicking the product image.

④ SHORT AND HIGH-IMPACT — MAX 7 SECTIONS. Every section earns its place. No filler, no padding-only sections.

⑤ MAX 2-3 PRODUCTS in product section. Never render more than 3. Use 2-col or 3-col grid accordingly.

⑥ COPY INSERTIONS — none are prescribed. Every line comes from the plan or the brand record; a tagline that is not on the record is not written. Offer repeat on second scroll: badge + punchline in [S6] offer reinforcement section

⑦ SOCIAL PROOF PER PRODUCT: only a rating, count or review that is on the brand record, verbatim. If the record carries none, write none, and never invent [N]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KNOWN FAILURE MODES — FIX THESE BEFORE GENERATING:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

① CONTENT STARVATION — Empty sections with minimal text and enormous padding.
   FIX: Every section must be content-complete. Hero sections include eyebrow + headline + 2-3 benefit bullets + price + CTA. Product sections include star rating, review count, short description, price anchoring. No section under 100px of useful content.

② TEXT TRUNCATION — Headlines or subcopy cut off mid-sentence.
   FIX: Never constrain text to fixed heights or use overflow:hidden. Use natural line wrapping. Subcopy should be the FULL sentence from the plan — not shortened.

③ WHITESPACE ABUSE — Sections with 60-80px top/bottom padding that render mostly empty.
   FIX: Max section padding: 28px top/bottom for content sections, 16px for tight sections. Only spacer sections may have up to 40px. Use padding to create rhythm, not as substitute for content.

④ VARIANT B = VARIANT A — Same amber button, same chalk background, same product-first structure.
   FIX FOR VARIANT B:
   - First 2–3 sections: dark background (${F.primary}) with chalk text (${F.surface}) — mandatory
   - No product in sections 1–2. Narrative/lifestyle/mood opens the email
   - Ghost-button CTA only: border:2px solid [matching text color]; background:transparent
   - Single editorial product with large image, not a product grid
   - Headline 44px+ serif, evocative poetic copy, 60px+ section padding (editorial needs air)

⑤ MISSING MARKETING SIGNALS — No ratings, no social proof numbers, no price context.
   FIX: Use compare-at pricing where available; add the brand's own shipping line ${F.shippingOrNone} in offer sections; include 1-2 trust badge rows built ONLY from the verifiable claims: ${F.claimsMid}.

⑥ NON-RESPONSIVE LAYOUT — Split columns and product grids break on mobile (portrait mode issue).
   FIX: Wrap the email in a <style> block with @media rules. Use MSO conditional comments for Outlook. Inner columns must stack on mobile. Add float:none!important and max-width:100%!important to .col2/.col3 to fix portrait orientation reflow in email clients.

⑦ HIDDEN DISCOUNT — Offer/discount not visible in first 500px. Buyer has to scroll to find the price.
   FIX: Inside the hero section (BEFORE the CTA button), include a prominent offer badge as a dark block:
   <div style="display:inline-block;background:${F.primary};color:${F.surface};font-family:${F.bodyStack};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:10px 18px;margin-bottom:14px;line-height:1.5">UP TO [X%] OFF<br><span style="font-size:9px;font-weight:400;color:${F.accent};letter-spacing:0.04em">ON SELECTED [PRODUCT CATEGORY]</span></div>

⑧ WEAK ADD TO CART — Small inline "Add to Cart" link blends into product card. No urgency signals on products.
   FIX: Product cards MUST use a FULL-WIDTH dark green button spanning the entire card width:
   <a href="..." style="display:block;background:${F.primary};color:${F.surface};font-family:${F.bodyStack};font-size:10px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;text-decoration:none;padding:11px 16px;text-align:center">🛒 ADD TO CART</a>

⑨ GIFTING CAMPAIGNS — no prescribed tagline; use the plan's copy and nothing the record does not carry.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HTML STRUCTURE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Table-based layout, 600px max-width center wrapper
- Inline CSS for all structural styles. <style> block in <head> for media queries + Outlook resets ONLY
- No div layout, no flexbox, no CSS grid
- Images: <img src="PLACEHOLDER" width="600" height="auto" style="display:block;border:0;max-width:100%">
- Full email: <!DOCTYPE html> … </html>

━━ BRAND ASSETS — EXACT, NEVER SUBSTITUTE ━━
- Fonts: ${F.fontRules}
- Header logo: ${F.logoRule}
- Footer: "Privacy Policy" and "Terms of Service" are plain labels with href="#", no target/onclick.

━━ OUTLOOK (MSO) COMPATIBILITY — MANDATORY ━━
Outlook ignores CSS background-color on <td>. You MUST add bgcolor="" attribute on EVERY colored <td>.
Failure to do this = dark sections appear white in Outlook (breaks Variant B entirely).

RULE: Every <td> with a CSS background value MUST also have the matching bgcolor attribute.
Examples:
  <td style="background:${F.primary}" bgcolor="${F.primary}">        ← dark section
  <td style="background:${F.surface}" bgcolor="${F.surface}">        ← chalk section
  <td style="background:${F.accent}" bgcolor="${F.accent}">        ← amber announcement bar
  <td style="background:#f5efe0" bgcolor="#f5efe0">        ← trust badge bar
  <td style="background:#ffffff" bgcolor="#ffffff">        ← white section

Apply bgcolor to EVERY <td> that has a background color — no exceptions.

━━ PREHEADER TEXT — add immediately after <body> tag ━━
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:inherit;opacity:0;mso-hide:all">[PREHEADER_TEXT]</div>

━━ RESPONSIVE <style> BLOCK — always include in <head> ━━
<style>
  /* Outlook reset */
  table{border-collapse:collapse!important}
  a{color:${F.accent}}
  @media only screen and (max-width:600px){
    .email-container{width:100%!important;max-width:100%!important}
    .col2,.col3{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;float:none!important}
    .col2 img,.col3 img{width:100%!important;max-width:100%!important;height:auto!important;display:block!important}
    .hero-img{width:100%!important;height:auto!important;max-width:100%!important}
    .hide-mobile{display:none!important}
    .show-mobile{display:block!important}
    .mobile-pad{padding:20px 16px!important}
    .mobile-h1{font-size:28px!important;line-height:1.25!important}
    .mobile-h2{font-size:22px!important}
    .mobile-text{font-size:14px!important;line-height:1.6!important}
    .mobile-center{text-align:center!important}
    img{max-width:100%!important;height:auto!important}
  }
</style>

━━ SECTION LIBRARY — EXACT HTML FOR EACH LAYOUT TYPE ━━

── ANNOUNCEMENT BAR (always add this before the ${F.name} header) ──
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${F.accent}" bgcolor="${F.accent}">
  <tr><td style="text-align:center;padding:9px 16px" bgcolor="${F.accent}">
    <span style="font-family:${F.bodyStack};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff">[OFFER LINE — the offer from the plan${F.shippingSuffix}; a code only if the plan names one]</span>
  </td></tr>
</table>

── ${F.name} HEADER ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:${F.primary};max-width:600px;margin:0 auto" bgcolor="${F.primary}">
  <tr>
    <td width="200" style="padding:10px 16px 10px 24px;vertical-align:middle;background:${F.primary}" bgcolor="${F.primary}">
      <span style="font-family:${F.bodyStack};font-size:10px;color:rgba(253,246,232,0.5);letter-spacing:0.08em">${F.foundedLine}</span>
    </td>
    <td style="text-align:center;padding:14px 16px;vertical-align:middle;background:${F.primary}" bgcolor="${F.primary}">
      <div style="font-family:${F.headStack};font-size:28px;color:${F.surface};letter-spacing:0.18em;font-weight:400;line-height:1">${F.name}</div>
      <div style="font-family:${F.bodyStack};font-size:8.5px;color:${F.accent};letter-spacing:0.22em;text-transform:uppercase;margin-top:4px">${F.taglineUpper}</div>
    </td>
    <td width="200" style="text-align:right;padding:10px 24px 10px 16px;vertical-align:middle;background:${F.primary}" bgcolor="${F.primary}">
      <a href="{{STORE_BASE}}" style="font-family:${F.bodyStack};font-size:10px;color:${F.accent};text-decoration:none;letter-spacing:0.06em">SHOP ALL →</a>
    </td>
  </tr>
</table>

── TRUST BADGES BAR (add after header or before CTA) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#f5efe0;max-width:600px;margin:0 auto" bgcolor="#f5efe0">
  <tr>
    <td style="text-align:center;padding:10px 16px;border-top:1px solid #e8dcc8;border-bottom:1px solid #e8dcc8;background:#f5efe0" bgcolor="#f5efe0">
      <span style="font-family:${F.bodyStack};font-size:10px;color:#4a7a5a;letter-spacing:0.08em">
        ${F.claimsUpper}
      </span>
    </td>
  </tr>
</table>

── SPLIT-HERO (image 55% left, copy 45% right — Variant A default) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:${F.surface};max-width:600px;margin:0 auto" bgcolor="${F.surface}">
  <tr>
    <!--[if mso]><td width="330" valign="top"><![endif]-->
    <td class="col2 hero-img" width="330" valign="top" style="vertical-align:top;padding:0;background:${F.surface}" bgcolor="${F.surface}">
      <img src="IMAGE_HERO_URL" width="330" height="auto" class="hero-img" style="display:block;border:0;width:330px;max-width:330px" alt="[PRODUCT NAME] — ${F.name}">
    </td>
    <!--[if mso]></td><td width="270" valign="middle"><![endif]-->
    <td class="col2 mobile-pad" width="270" valign="middle" style="vertical-align:middle;padding:28px 24px 28px 20px;background:${F.surface}" bgcolor="${F.surface}">
      <span class="mobile-text" style="font-family:${F.bodyStack};font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${F.accent};display:block;margin-bottom:8px">[EYEBROW]</span>
      <h1 class="mobile-h1" style="font-family:${F.headStack};font-size:30px;line-height:1.15;color:${F.primary};font-weight:700;margin:0 0 12px 0">[HEADLINE — use verbatim from plan]</h1>
      <!-- BENEFIT BULLETS — always include 2-3 short benefit lines derived from product -->
      <ul style="font-family:${F.bodyStack};font-size:13px;line-height:1.7;color:#3d5a40;margin:0 0 14px 0;padding:0 0 0 16px">
        <li>[BENEFIT 1 — specific product attribute or drop detail]</li>
        <li>[BENEFIT 2 — a verifiable claim from the brand record]</li>
        <li>[BENEFIT 3 — use occasion]</li>
      </ul>
      <p class="mobile-text" style="font-family:${F.bodyStack};font-size:13px;line-height:1.65;color:#4a5568;margin:0 0 14px 0">[SUBCOPY — full sentence from plan]</p>
      <!-- OFFER BADGE — visible in first scroll, before CTA — MANDATORY for discount campaigns -->
      <div style="display:inline-block;background:${F.primary};color:${F.surface};font-family:${F.bodyStack};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:10px 18px;margin-bottom:14px;line-height:1.5">UP TO [X%] OFF<br><span style="font-size:9px;font-weight:400;color:${F.accent};letter-spacing:0.04em">ON SELECTED [PRODUCT CATEGORY e.g. GIFTS]</span></div>
      <br>
      <a href="{{STORE_BASE}}/products/[HANDLE]" style="display:inline-block;background:${F.accent};color:#ffffff;font-family:${F.bodyStack};font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:13px 28px">[CTA e.g. SHOP GIFTS]</a>
      <div style="font-family:${F.bodyStack};font-size:10px;color:#8a9a8a;margin-top:8px">${F.shippingLine}</div>
    </td>
    <!--[if mso]></td><![endif]-->
  </tr>
</table>

── FULL-BLEED HERO (image full width, copy below — Variant B default) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background:${F.primary}" bgcolor="${F.primary}">
  <tr><td style="padding:0;background:${F.primary}" bgcolor="${F.primary}">
    <img src="IMAGE_HERO_URL" width="600" height="auto" style="display:block;border:0;width:100%;max-width:600px" alt="[CAMPAIGN MOOD] — ${F.name}">
  </td></tr>
  <tr><td class="mobile-pad" style="padding:40px 48px;background:${F.primary};text-align:center" bgcolor="${F.primary}">
    <span style="font-family:${F.bodyStack};font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${F.accent};display:block;margin-bottom:12px">[EYEBROW]</span>
    <h1 class="mobile-h1" style="font-family:${F.headStack};font-size:44px;line-height:1.1;color:${F.surface};font-weight:400;margin:0 0 18px 0;letter-spacing:-0.01em">[HEADLINE — use verbatim from plan]</h1>
    <p class="mobile-text" style="font-family:${F.bodyStack};font-size:15px;line-height:1.75;color:rgba(253,246,232,0.75);margin:0 0 24px 0;max-width:460px;margin-left:auto;margin-right:auto">[SUBCOPY — full sentence from plan]</p>
  </td></tr>
</table>

── TWO-COLUMN PRODUCT GRID (Variant A) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;max-width:600px;margin:0 auto" bgcolor="#ffffff">
  <tr>
    <td class="col2" width="294" style="padding:14px 7px 14px 14px;vertical-align:top;background:#ffffff" bgcolor="#ffffff">
      [PRODUCT CARD A — replace with full product card HTML]
    </td>
    <td class="col2" width="294" style="padding:14px 14px 14px 7px;vertical-align:top;background:#ffffff" bgcolor="#ffffff">
      [PRODUCT CARD B — replace with full product card HTML]
    </td>
  </tr>
</table>

── THREE-COLUMN PRODUCT GRID (Variant A dense layout) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;max-width:600px;margin:0 auto" bgcolor="#ffffff">
  <tr>
    <td class="col3" width="192" style="padding:10px 5px 10px 12px;vertical-align:top;background:#ffffff" bgcolor="#ffffff">[PRODUCT CARD — full HTML]</td>
    <td class="col3" width="192" style="padding:10px 5px;vertical-align:top;background:#ffffff" bgcolor="#ffffff">[PRODUCT CARD — full HTML]</td>
    <td class="col3" width="192" style="padding:10px 12px 10px 5px;vertical-align:top;background:#ffffff" bgcolor="#ffffff">[PRODUCT CARD — full HTML]</td>
  </tr>
</table>

── PRODUCT CARD (use inside grid cells — replace ALL bracketed placeholders with real content) ──
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${F.surface};border:1px solid #e5ddd0" bgcolor="${F.surface}">
  <tr><td style="padding:0;background:${F.surface}" bgcolor="${F.surface}">
    <img src="IMAGE_PRODUCT_URL" width="100%" height="auto" style="display:block;border:0;max-width:100%" alt="[FULL PRODUCT NAME] — ${F.name}">
  </td></tr>
  <tr><td style="padding:12px 12px 4px;text-align:left;background:${F.surface}" bgcolor="${F.surface}">
    <div style="font-family:${F.bodyStack};font-size:11px;color:${F.accent};margin-bottom:3px">⭐⭐⭐⭐⭐ <span style="color:#888;font-size:10px">([REVIEW_COUNT — realistic number e.g. 70] reviews)</span></div>
    <div style="font-family:${F.headStack};font-size:15px;color:${F.primary};font-weight:600;line-height:1.3;margin-bottom:4px">[FULL PRODUCT NAME — no truncation]</div>
    <!-- URGENCY LINE — social proof, use realistic N between 25-90 -->
    <div style="font-family:${F.bodyStack};font-size:10px;color:#cc4400;font-weight:600;margin-bottom:7px">🔥 [N] units sold in the last 24 hours</div>
    <div style="font-family:${F.bodyStack};font-size:14px;font-weight:700;color:${F.primary};margin-bottom:4px">
      $[PRICE] <span style="font-size:10px;color:#aaa;text-decoration:line-through;font-weight:400">$[ORIG_PRICE]</span>
      &nbsp;<span style="font-size:9px;font-weight:800;color:#2a7a3a">[X%] OFF</span>
    </div>
  </td></tr>
  <!-- FULL-WIDTH ADD TO CART — spans entire card width, dark green background -->
  <tr><td style="padding:8px 12px 12px;background:${F.surface}" bgcolor="${F.surface}">
    <a href="{{STORE_BASE}}/products/[HANDLE]" style="display:block;background:${F.primary};color:${F.surface};font-family:${F.bodyStack};font-size:10px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;text-decoration:none;padding:11px 0;text-align:center">🛒 ADD TO CART</a>
  </td></tr>
</table>

── BENEFIT STRIP / ICON ROW ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:${F.primary};max-width:600px;margin:0 auto" bgcolor="${F.primary}">
  <tr>
    <td width="150" style="padding:16px 8px;text-align:center;vertical-align:top;background:${F.primary}" bgcolor="${F.primary}">
      <div style="font-size:20px;margin-bottom:5px">🌿</div>
      <div style="font-family:${F.bodyStack};font-size:10px;font-weight:700;color:${F.accent};letter-spacing:0.1em;text-transform:uppercase">${F.claim0}</div>
      <div style="font-family:${F.bodyStack};font-size:9.5px;color:rgba(253,246,232,0.65);margin-top:3px"></div>
    </td>
    <td width="150" style="padding:16px 8px;text-align:center;vertical-align:top;background:${F.primary}" bgcolor="${F.primary}">
      <div style="font-size:20px;margin-bottom:5px">♻️</div>
      <div style="font-family:${F.bodyStack};font-size:10px;font-weight:700;color:${F.accent};letter-spacing:0.1em;text-transform:uppercase">${F.claim1}</div>
      <div style="font-family:${F.bodyStack};font-size:9.5px;color:rgba(253,246,232,0.65);margin-top:3px"></div>
    </td>
    <td width="150" style="padding:16px 8px;text-align:center;vertical-align:top;background:${F.primary}" bgcolor="${F.primary}">
      <div style="font-size:20px;margin-bottom:5px">⭐</div>
      <div style="font-family:${F.bodyStack};font-size:10px;font-weight:700;color:${F.accent};letter-spacing:0.1em;text-transform:uppercase">${F.claim2}</div>
      <div style="font-family:${F.bodyStack};font-size:9.5px;color:rgba(253,246,232,0.65);margin-top:3px">India's largest sneaker customisers</div>
    </td>
    <td width="150" style="padding:16px 8px;text-align:center;vertical-align:top;background:${F.primary}" bgcolor="${F.primary}">
      <div style="font-size:20px;margin-bottom:5px">🚚</div>
      <div style="font-family:${F.bodyStack};font-size:10px;font-weight:700;color:${F.accent};letter-spacing:0.1em;text-transform:uppercase">${F.claim3}</div>
      <div style="font-family:${F.bodyStack};font-size:9.5px;color:rgba(253,246,232,0.65);margin-top:3px">${F.shippingLine}</div>
    </td>
  </tr>
</table>

── SOCIAL PROOF STRIP ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#f5efe0;border-top:1px solid #e8dcc8;border-bottom:1px solid #e8dcc8;max-width:600px;margin:0 auto" bgcolor="#f5efe0">
  <tr><td style="padding:14px 24px;text-align:center;background:#f5efe0" bgcolor="#f5efe0">
    <span style="font-family:${F.bodyStack};font-size:11px;color:${F.primary};font-weight:700">⭐⭐⭐⭐⭐</span>
    <span style="font-family:${F.bodyStack};font-size:11px;color:#4a5568;margin-left:8px">${F.claimsMid}</span>
  </td></tr>
</table>

── TESTIMONIAL (2-col layout) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:${F.surface};max-width:600px;margin:0 auto" bgcolor="${F.surface}">
  <tr>
    <td class="col2" width="290" style="padding:20px 10px 20px 24px;vertical-align:top;background:${F.surface}" bgcolor="${F.surface}">
      <div style="font-family:${F.headStack};font-size:17px;font-style:italic;color:${F.primary};line-height:1.6;border-left:3px solid ${F.accent};padding-left:14px;margin-bottom:10px">"[REAL REVIEW TEXT — specific and authentic, 1-2 sentences]"</div>
      <div style="font-family:${F.bodyStack};font-size:10.5px;color:#888;letter-spacing:0.06em">— [FIRST NAME], [CITY, STATE]</div>
    </td>
    <td class="col2" width="290" style="padding:20px 24px 20px 10px;vertical-align:top;background:${F.surface}" bgcolor="${F.surface}">
      <div style="font-family:${F.headStack};font-size:17px;font-style:italic;color:${F.primary};line-height:1.6;border-left:3px solid ${F.accent};padding-left:14px;margin-bottom:10px">"[REAL REVIEW TEXT — specific and authentic, 1-2 sentences]"</div>
      <div style="font-family:${F.bodyStack};font-size:10.5px;color:#888;letter-spacing:0.06em">— [FIRST NAME], [CITY, STATE]</div>
    </td>
  </tr>
</table>

── OFFER BANNER (Variant A — prominent) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:${F.primary};max-width:600px;margin:0 auto" bgcolor="${F.primary}">
  <tr><td class="mobile-pad" style="text-align:center;padding:20px 32px;background:${F.primary}" bgcolor="${F.primary}">
    <div style="font-family:${F.bodyStack};font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:rgba(212,135,58,0.8);margin-bottom:6px">[OFFER EYEBROW e.g. LIMITED BATCH · THIS SEASON ONLY]</div>
    <div style="font-family:${F.headStack};font-size:26px;color:${F.surface};font-weight:600;margin-bottom:6px">[OFFER HEADLINE e.g. Save 20% on Your First Order]</div>
    <div style="font-family:${F.bodyStack};font-size:12px;color:rgba(253,246,232,0.7);margin-bottom:14px">[OFFER DETAIL — code: [CODE] · ends [DATE]]</div>
    <a href="{{STORE_BASE}}" style="display:inline-block;background:${F.accent};color:#ffffff;font-family:${F.bodyStack};font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:13px 36px">[CTA TEXT e.g. SHOP NOW]</a>
  </td></tr>
</table>

── SUBTLE OFFER ROW (Variant B — inline, understated) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:${F.primary};border-top:1px solid rgba(212,135,58,0.25);max-width:600px;margin:0 auto" bgcolor="${F.primary}">
  <tr><td style="padding:14px 32px;text-align:center;background:${F.primary}" bgcolor="${F.primary}">
    <span style="font-family:${F.bodyStack};font-size:11.5px;color:rgba(253,246,232,0.75)">
      [OFFER TEXT — the plan's offer; a shipping line only if it is the brand's own claim]
    </span>
  </td></tr>
</table>

── PRIMARY CTA SECTION (Variant A — amber button, prominent) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:${F.surface};max-width:600px;margin:0 auto" bgcolor="${F.surface}">
  <tr><td class="mobile-pad" style="text-align:center;padding:28px 40px;background:${F.surface}" bgcolor="${F.surface}">
    <a href="{{STORE_BASE}}" style="display:inline-block;background:${F.accent};color:#ffffff;font-family:${F.bodyStack};font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:16px 52px">[CTA TEXT e.g. SHOP THE COLLECTION]</a>
    <div style="font-family:${F.bodyStack};font-size:10.5px;color:#888;margin-top:10px">${F.shippingLine}</div>
  </td></tr>
</table>

── GHOST CTA SECTION (Variant B — understated, on dark background) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:${F.primary};max-width:600px;margin:0 auto" bgcolor="${F.primary}">
  <tr><td style="text-align:center;padding:40px 48px;background:${F.primary}" bgcolor="${F.primary}">
    <a href="{{STORE_BASE}}" style="display:inline-block;border:1.5px solid rgba(253,246,232,0.7);background:transparent;color:${F.surface};font-family:${F.bodyStack};font-size:12px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 44px">[CTA TEXT e.g. DISCOVER THE COLLECTION]</a>
    <div style="font-family:${F.bodyStack};font-size:10px;color:rgba(253,246,232,0.4);margin-top:12px;letter-spacing:0.06em">[SUBTEXT — the brand's own shipping claim, or nothing]</div>
  </td></tr>
</table>

── EDITORIAL PRODUCT FEATURE (Variant B — large single product reveal, section 3+) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:${F.surface};max-width:600px;margin:0 auto" bgcolor="${F.surface}">
  <tr><td style="padding:0;background:${F.surface}" bgcolor="${F.surface}">
    <img src="IMAGE_PRODUCT_URL" width="600" height="auto" style="display:block;border:0;max-width:100%" alt="[FULL PRODUCT NAME] — ${F.name}">
  </td></tr>
  <tr><td class="mobile-pad" style="padding:32px 48px;text-align:center;background:${F.surface}" bgcolor="${F.surface}">
    <span style="font-family:${F.bodyStack};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${F.accent};display:block;margin-bottom:10px">[CATEGORY · ESTATE NAME · ORIGIN REGION]</span>
    <h2 class="mobile-h2" style="font-family:${F.headStack};font-size:34px;color:${F.primary};font-weight:600;line-height:1.2;margin:0 0 14px 0">[FULL PRODUCT NAME — from plan]</h2>
    <p class="mobile-text" style="font-family:${F.bodyStack};font-size:14px;line-height:1.75;color:#4a5568;margin:0 0 18px 0">[PRODUCT DESCRIPTION — 2 sentences from the catalogue facts only. Never truncate.]</p>
    <div style="font-family:${F.bodyStack};font-size:10px;color:#888;margin-bottom:18px">${F.claimsMid}</div>
    <div style="font-family:${F.bodyStack};font-size:16px;font-weight:700;color:${F.primary};margin-bottom:18px">$[PRICE] <span style="font-size:12px;color:#aaa;text-decoration:line-through;font-weight:400">$[COMPARE]</span></div>
    <a href="{{STORE_BASE}}/products/[HANDLE]" style="display:inline-block;border:2px solid ${F.primary};background:transparent;color:${F.primary};font-family:${F.bodyStack};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:13px 40px">[CTA e.g. EXPLORE THIS SNEAKER]</a>
  </td></tr>
</table>

── ORIGIN / PROVENANCE SECTION (Variant B narrative — image left, story right) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto" bgcolor="${F.primary}">
  <tr>
    <td class="col2" width="300" style="padding:0;vertical-align:top">
      <img src="IMAGE_LIFESTYLE_URL" width="300" height="auto" style="display:block;border:0;width:300px;max-width:100%" alt="[ORIGIN] — ${F.name}">
    </td>
    <td class="col2 mobile-pad" width="300" valign="middle" style="vertical-align:middle;padding:32px 28px;background:${F.primary}" bgcolor="${F.primary}">
      <span style="font-family:${F.bodyStack};font-size:9.5px;letter-spacing:0.16em;text-transform:uppercase;color:${F.accent};display:block;margin-bottom:10px">[REGION · ALTITUDE ft. · HARVEST SEASON]</span>
      <h3 class="mobile-h2" style="font-family:${F.headStack};font-size:26px;color:${F.surface};font-weight:400;line-height:1.25;margin:0 0 14px 0">[SECTION HEADLINE — poetic, place-anchored]</h3>
      <p class="mobile-text" style="font-family:${F.bodyStack};font-size:13px;line-height:1.75;color:rgba(253,246,232,0.72);margin:0 0 16px 0">[ORIGIN STORY — only what the brand record states about its origin; nothing invented]</p>
      <div style="font-family:${F.bodyStack};font-size:10px;color:rgba(212,135,58,0.7);letter-spacing:0.08em">${F.claimsMid}</div>
    </td>
  </tr>
</table>

── ${F.name} FOOTER (always last — include on every email) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:${F.primary};max-width:600px;margin:0 auto" bgcolor="${F.primary}">
  <tr>
    <td style="padding:28px 32px 12px;text-align:center;background:${F.primary}" bgcolor="${F.primary}">
      <div style="font-family:${F.headStack};font-size:22px;color:${F.surface};letter-spacing:0.14em;margin-bottom:8px">${F.name}</div>
      <div style="font-family:${F.bodyStack};font-size:10px;color:#7a9a7a;line-height:2;margin-bottom:14px">${F.claimsMid}</div>
      <div style="margin-bottom:14px">
        <a href="{{STORE_BASE}}" style="color:${F.accent};text-decoration:none;font-family:${F.bodyStack};font-size:11px;margin:0 10px">Shop All</a>
      </div>
      <div style="border-top:1px solid rgba(253,246,232,0.12);padding-top:12px;margin-top:4px">
        <a href="{{UNSUBSCRIBE_URL}}" style="font-family:${F.bodyStack};font-size:9.5px;color:rgba(253,246,232,0.35);text-decoration:underline;margin:0 8px">Unsubscribe</a>
        <span style="font-family:${F.bodyStack};font-size:9.5px;color:rgba(253,246,232,0.25)">|</span>
        <span style="font-family:${F.bodyStack};font-size:9.5px;color:rgba(253,246,232,0.25)">·</span>
        <span style="font-family:${F.bodyStack};font-size:9.5px;color:rgba(253,246,232,0.25);margin-left:8px">${F.legalLine} · © ${F.name}. All rights reserved.</span>
      </div>
    </td>
  </tr>
</table>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROVEN D2C EMAIL MARKETING PATTERNS — APPLY THESE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ABOVE-THE-FOLD CTA: The primary CTA button must appear within the first 500px of content. Don't bury it after 3 sections.

2. PRICE ANCHORING: Always show [PRICE] next to a struck-through [COMPARE_PRICE] where applicable. This creates perceived value.

3. BENEFIT BULLETS IN HERO: 2-3 specific, concrete benefit bullets in the hero section outperform long subcopy paragraphs.

4. SOCIAL PROOF NEAR CTA: only proof that is on the brand record, verbatim, directly above or below the main CTA; otherwise none.

5. TRUST BADGES: Include the trust bar built from the verifiable claims (${F.claimsMid}) at least once — after header or before CTA.

6. SCARCITY / URGENCY (subtle): only a scarcity fact the plan or the record states (a real batch size or date) creates legitimate urgency; never an invented one.

7. PRODUCT CATALOG DENSITY: Show at least 2-3 products in the email. Even Brand Building emails can show a curated trio. This drives catalog discovery and AOV.

8. SHIPPING LINE: ${F.shippingRule}

9. MULTIPLE CTAs: Include at least 2 CTA opportunities: once in hero section, once at the end. For product grids, each card has its own Add-to-Cart link.

10. SPECIFICITY OVER VAGUENESS: a verifiable claim from the record beats "thousands of customers"; a catalogue fact beats "premium quality".

11. SOCIAL PROOF URGENCY IN PRODUCT CARDS: Add "🔥 [N] units sold in the last 24 hours" text below the product name. Use realistic N between 25-90. Pair with explicit review count: "⭐⭐⭐⭐⭐ (N reviews)" not just a generic "50K+ reviews" line. Specificity = credibility.

12. OFFER CONTINUITY: Show the discount at two points — (a) as a badge inside the hero section visible without scrolling, AND (b) as a "% OFF" label on each product card. Never surface the offer only once in the email.

13. FULL-WIDTH ADD TO CART: Product card CTAs must span the FULL card width using display:block. Use dark green background (${F.primary}). Text: "🛒 ADD TO CART" all-caps. Never use a small inline button — it gets missed on mobile.

14. GIFTING CAMPAIGNS: no prescribed tagline; the plan's copy only.

15. HERO SUBCOPY (GIFTING): the plan's sentence, verbatim; no prescribed closing line.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION CONTENT REQUIREMENTS (every section must be filled):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HERO SECTION must include:
- Eyebrow label (product category / campaign name)
- Full headline from plan (no truncation)
- 2-3 benefit bullets (derive from product type if not in plan)
- Full subcopy sentence, verbatim from the plan
- Offer badge: dark rectangle "UP TO [X%] OFF ON SELECTED [CATEGORY]" BEFORE the CTA button
- Primary CTA button
- Gifting campaigns: no prescribed tagline
- "Free shipping" micro-line

PRODUCT SECTION must include per card:
- Product image (use IMAGE_PRODUCT_URL placeholder for first, exact product URL for others)
- Star rating with explicit review count (e.g., "⭐⭐⭐⭐⭐ (70 reviews)" — specific count, not generic)
- Product name (full, not truncated)
- "🔥 [N] units sold in the last 24 hours" urgency line (N between 25-90)
- Price with strikethrough compare-at AND "[X%] OFF" badge in green
- FULL-WIDTH "🛒 ADD TO CART" button spanning entire card (display:block, dark green bg ${F.primary})

SOCIAL PROOF must include:
- Actual review text (2 reviews, quoted)
- Reviewer name + location
- Star count (visual ⭐⭐⭐⭐⭐)

FOOTER must include:
- Logo
- 4 navigation links
- Unsubscribe + Privacy links
- Copyright line

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 11: FINAL QUALITY CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before outputting, verify:
□ No text is truncated — all headlines and subcopy are complete sentences
□ All sections from the plan are implemented in order
□ IMAGE_HERO_URL / IMAGE_PRODUCT_URL / IMAGE_LIFESTYLE_URL used for all image slots
□ At least 2 CTAs in the email (hero + closing)
□ Product cards include ratings, description, and price
□ Trust badge row present at least once
□ The brand's own shipping claim, if the record carries one, mentioned at least once
□ HTML is valid — all tables closed, no broken nesting
□ Responsive <style> block with Outlook reset present in <head>
□ EVERY <td> with background-color CSS also has matching bgcolor="" attribute
□ Preheader <div> present immediately after <body> tag
□ Variant B: dark opening sections (${F.primary} bg), ghost CTA, no product grid, 44px+ headlines
□ Variant A: chalk background (${F.surface} bg), amber CTA (${F.accent}), product in section 1, benefit bullets
━━ QA SELF-CHECK — CONFIRM ALL BEFORE OUTPUTTING ━━
✔ Offer visible above the fold (announcement bar + hero badge)
✔ CTA button present in hero section (above fold)
✔ Price visible on every product (current + strikethrough + % OFF)
✔ ≤3 products in product section
✔ ADD TO CART button on every product card (full-width, dark green)
✔ No hallucinated data — all copy from the plan or derived from real product info
✔ Gifting hero subcopy is the plan's sentence, verbatim
✔ No tagline the record does not carry
✔ "🔥 N units sold in last 24 hours" on each product card
✔ Mobile-safe layout (responsive CSS, col2/col3 float:none)
✔ Max 7 sections — no filler sections
□ No [BRACKET PLACEHOLDERS] remaining — every bracket replaced with real content
□ IMAGE_HERO_URL / IMAGE_PRODUCT_URL / IMAGE_LIFESTYLE_URL present as exact strings
□ Responsive CSS: .col2/.col3 have float:none!important and max-width:100%!important for portrait fix

If ANY QA check fails → fix it inline before outputting the HTML.

━━ NON-NEGOTIABLE RULES ━━
- NEVER use href="#" — every link MUST point to a real URL from the STORE & LINKS section or product data. Dead links kill conversions.
- NEVER use the same padding value for every section — vary 16px / 20px / 24px / 28px / 32px
- NEVER produce a section with only a headline and blank space — every section must be content-complete
- NEVER leave [BRACKET PLACEHOLDERS] in the final output — replace EVERY bracket with real content from the plan
- ALWAYS use the copy from the plan sections VERBATIM — do not rewrite, paraphrase, or shorten
- EVERY <td> with a CSS background value MUST have a matching bgcolor="" HTML attribute (Outlook requirement)
- IMAGE_HERO_URL = exact placeholder string for hero image (never use a different format)
- IMAGE_PRODUCT_URL = exact placeholder string for product image
- IMAGE_LIFESTYLE_URL = exact placeholder string for lifestyle image

━━ BRAND VOCABULARY ━━
BANNED: ${F.banned}
PREFERRED: ${F.preferred}

━━ OUTPUT FORMAT ━━
Return ONLY the complete HTML email string.
Start with <!DOCTYPE html>
End with </html>
No markdown fences. No commentary. No text before or after the HTML.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────
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

  // The ACTIVE brand, the way api/ai/generate.js resolves it: the caller's own
  // workspace from the request. With none on the request the record is the
  // unresolved placeholder (markers, empty palette), never tenant zero.
  let brand = (body.__brand && (body.__brand.id || body.__brand.slug)) ? body.__brand : null;
  if (!brand) { try { brand = await brandRuntime.resolve(req); } catch (_) { brand = null; } }
  if (!brand || !(brand.id || brand.slug)) brand = brandRuntime.scopedBrand(null, { reason: 'html stage: no active workspace on the request' });
  const F = factsFor(brand);

  const variant      = (body.variant || 'A').toString().toUpperCase() === 'B' ? 'B' : 'A';
  const plan         = body.plan || {};
  const strategy     = body.strategy || {};
  const brief        = (body.brief || '').toString().substring(0, 500);
  const audience     = (body.audience || strategy.audience || '').toString().substring(0, 500);
  const market       = (body.market || 'US').toString();
  const regen        = Number(body.regenerate_counter) || 0;
  const clientProducts = Array.isArray(body.products) ? body.products : [];  // enriched product data from client

  const sections      = Array.isArray(plan.sections) ? plan.sections : [];
  const layoutPlan    = plan.layout_plan || {};
  const copyFramework = plan.copy_framework || {};
  const imageReqs     = Array.isArray(plan.image_requirements) ? plan.image_requirements : [];
  const subjectLines  = Array.isArray(plan.subject_lines) ? plan.subject_lines : [];

  // Section spec block — tells the LLM exactly what to build for each section
  const sectionSpec = sections.map((s, i) => {
    const c = s.copy || {};
    return [
      `SECTION ${i + 1}: ${(s.id || 'section').toUpperCase()}`,
      `  Type: ${s.type || 'centered'}`,
      `  Purpose: ${s.purpose || ''}`,
      `  Image slot: ${s.image_slot || 'none'}`,
      `  Eyebrow: "${c.eyebrow || ''}"`,
      `  Headline: "${c.headline || ''}"   ← USE VERBATIM, do NOT truncate`,
      `  Subcopy: "${c.subcopy || ''}"   ← USE VERBATIM, full sentence`,
      `  CTA: "${c.cta || ''}"`,
      `  Layout: ${s.layout || ''}`,
      `  UX intent: ${s.ux_intent || ''}`,
      `  CONTENT REQUIREMENT: Fill this section completely — no blank space. If hero/product section, add 2-3 benefit bullets derived from the product and headline.`,
    ].join('\n');
  }).join('\n\n');

  const imageSpec = imageReqs.map(r =>
    `  ${r.slot || 'hero'}: placeholder = IMAGE_${(r.slot || 'hero').toUpperCase()}_URL (exact string — client replaces with real image)`
  ).join('\n');

  const heroProduct  = (strategy.product_selection && strategy.product_selection.hero) || {};
  const supportProds = (strategy.product_selection && strategy.product_selection.supporting) || [];
  const lockedStructure = strategy.structure || {};

  // Rich product data block — passed to LLM for product cards
  // Prefer client-side enriched products (with prices, images, URLs) over strategy-only products
  const allProds = clientProducts.length > 0
    ? clientProducts
    : [
        heroProduct.name ? { name: heroProduct.name, handle: heroProduct.handle, role: 'HERO', why: heroProduct.why } : null,
        ...supportProds.map(p => ({ name: p.name, handle: p.handle, role: p.role || 'supporting', why: p.why }))
      ].filter(Boolean);

  // Market-specific store base URL for links
  // The ACTIVE brand's own store per region; the map that sat here was tenant zero's.
  const storeUrlMap = {};
  (Array.isArray(brand.regions) ? brand.regions : []).forEach((r) => { if (r && r.code && r.store_url) storeUrlMap[String(r.code).toUpperCase()] = r.store_url; });
  const storeBase = storeUrlMap[String(market).toUpperCase()] || F.store || '';

  const productsBlock = allProds.length > 0
    ? allProds.map((p, i) => {
        const handle = p.handle || p.h || '';
        const productUrl = handle ? (storeBase + '/products/' + handle) : storeBase;
        const price = p.price || '';
        const compareAt = p.compare_at || p.compare_at_price || '';
        const discountPct = (price && compareAt && parseFloat(compareAt) > parseFloat(price))
          ? Math.round((1 - parseFloat(price) / parseFloat(compareAt)) * 100) + '%'
          : '';
        const imageUrl = p.image_url || p.i || '';
        return [
          `  ${i + 1}. [${p.role || 'PRODUCT'}] ${p.name}`,
          `     Handle: ${handle}`,
          `     Product URL: ${productUrl}`,
          `     Image URL: ${imageUrl || 'IMAGE_PRODUCT_' + i + '_URL'}`,
          `     Price: ${price || 'check store'}${compareAt ? ' (was ' + compareAt + ' — ' + discountPct + ' OFF)' : ''}`,
          `     Category: ${p.category || ''}`,
          p.why ? `     Why selected: ${p.why}` : ''
        ].filter(Boolean).join('\n');
      }).join('\n\n')
    : '  (no products specified — use only products the brief or the strategy names for ' + F.name + '; never invent one)';

  // Campaign name derived from brief — used as context header instead of a generic label
  const campaignName = brief
    ? brief.split(/[.!?\n]/)[0].trim().substring(0, 80)
    : ((strategy.strategy || (F.name + ' campaign')).substring(0, 60));

  // Extract color scheme from variant plan for explicit injection
  const colorScheme = layoutPlan.color_scheme || {};
  const bgColor     = colorScheme.background || (variant === 'B' ? '#D0473E' : '#FFFFFF');
  const primColor   = colorScheme.primary    || (variant === 'B' ? '#FFFFFF' : '#D0473E');
  const accentColor = colorScheme.accent     || '#6A33D8';

  const userMessage = `━━ BUILD VARIANT ${variant} HTML EMAIL ━━

CAMPAIGN: ${campaignName}
MARKET: ${market}
${audience ? 'TARGET USER SEGMENT (write FOR this person — every line of copy, every visual, every CTA must speak to them; do not write for a generic shopper):\n' + audience + '\n' : ''}STRATEGY TYPE: ${strategy.strategy_type || ''}
STRATEGY: ${strategy.strategy || ''}
VARIANT: ${variant} — ${variant === 'B'
  ? 'EXPERIMENTAL: story-first, editorial, NO product in first 2 sections, sensory/poetic copy, ghost CTA, 64px+ padding, DARK OPENING SECTIONS'
  : 'CONTROL: product-first, benefit-rational, prominent amber CTA, structured conversion layout, LIGHT CHALK background'}

COLOR SCHEME FOR THIS VARIANT:
  Background: ${bgColor} (use this for the opening sections — MANDATORY)
  Primary text: ${primColor}
  Accent: ${accentColor}
  ${variant === 'B' ? '→ DARK BACKGROUND: sections 1-2 must use background:'+bgColor+' with color:'+primColor+' text. This is the primary visual differentiator from Variant A.' : '→ LIGHT BACKGROUND: use #FFFFFF for section backgrounds throughout.'}

${regen > 0 ? `REGENERATE #${regen}: Vary padding values, section backgrounds, headline emphasis — keep same structure.` : ''}

━━ STRATEGIC LOCK (your HTML must serve these) ━━
Audience truth: ${(strategy.strategic_lock || {}).audience_truth || ''}
Business goal: ${(strategy.strategic_lock || {}).business_goal || ''}
Conversion trigger: ${(strategy.strategic_lock || {}).conversion_trigger || ''}

━━ THEME (every section should reinforce this) ━━
Name: ${(strategy.theme || {}).name || ''}
Core idea: ${(strategy.theme || {}).core_idea || ''}
Emotional driver: ${(strategy.theme || {}).emotional_driver || ''}
Visual world: ${(strategy.theme || {}).visual_world || ''}

━━ VIBE ━━
Tone: ${(strategy.vibe || {}).emotional_tone || ''}
Pace: ${(strategy.vibe || {}).pace || ''}
Visual energy: ${(strategy.vibe || {}).visual_energy || ''}
Avoid: ${(strategy.vibe || {}).avoid || ''}

━━ LOCKED STRUCTURE (implement these sections — do not add or remove) ━━
Sections defined in strategy: ${(lockedStructure.sections || []).join(' → ') || '(use sections from plan below)'}
Layout rules: ${lockedStructure.layout_rules || ''}
Visual system: ${JSON.stringify(lockedStructure.visual_system || {}, null, 2)}

━━ STORE & LINKS ━━
Store base URL: ${storeBase}
All CTA/Shop links MUST use real URLs from the product data below. NEVER use href="#".
"Shop All" → ${storeBase} (the store home, a page that exists)
Every other link is a Product URL from the data below or the store home. NEVER invent a collection or page path.
Unsubscribe → {{UNSUBSCRIBE_URL}}
Add UTM params to CTA links: ?utm_source=email&utm_medium=mailer&utm_campaign=lifecycle_os_studio

━━ PRODUCTS (with real prices, images & URLs — use these EXACTLY) ━━
${productsBlock}
Product system: ${(strategy.product_selection || {}).product_system || ''}
AOV logic: ${(strategy.product_selection || {}).aov_logic || ''}

PRODUCT CARD REQUIREMENT: For each product, show:
- Product image: use the Image URL from product data above (or IMAGE_PRODUCT_URL placeholder if not available)
- Rating and review count ONLY when the brand record carries approved review data, verbatim; otherwise no rating line at all (never invent a rating or a count)
- Full product name (no truncation)
- 1-line evocative description derived from product name and type
- REAL price from product data: $XX.XX with strikethrough compare-at + % OFF badge
- "Add to Cart" CTA button linking to the Product URL from the data above — NEVER href="#"

━━ LAYOUT PLAN (from creative plan) ━━
Flow: ${layoutPlan.flow || ''}
Spacing: ${layoutPlan.spacing || 'max 28px between content sections — NO excessive whitespace'}
Hero layout: ${layoutPlan.hero || ''}
Color scheme: background=${((layoutPlan.color_scheme || {}).background) || '#FFFFFF'} primary=${((layoutPlan.color_scheme || {}).primary) || '#D0473E'} accent=${((layoutPlan.color_scheme || {}).accent) || '#6A33D8'}

━━ COPY FRAMEWORK ━━
Tone: ${copyFramework.tone || ''}
Voice: ${copyFramework.voice || ''}
Headline style: ${copyFramework.headline_style || ''}
CTA verb: ${copyFramework.cta_verb || 'Shop'}

━━ SUBJECT LINES (reference only — not rendered in HTML) ━━
${subjectLines.join(' | ') || '(none)'}
Preheader text (insert after <body> tag as hidden div): ${plan.preheader || subjectLines[0] || F.tagline || F.claim0}

━━ IMAGE SLOTS ━━
${imageSpec || '  hero: use placeholder IMAGE_HERO_URL\n  product: use placeholder IMAGE_PRODUCT_URL\n  lifestyle: use placeholder IMAGE_LIFESTYLE_URL'}
IMPORTANT: Use these EXACT placeholder strings — the client will replace them with real base64 images.
Do NOT use placeholder.com URLs. Do NOT use empty src="". Use IMAGE_HERO_URL / IMAGE_PRODUCT_URL / IMAGE_LIFESTYLE_URL exactly.

━━ SECTIONS TO IMPLEMENT (in this exact order) ━━

${sectionSpec || `(no sections provided — generate ${variant === 'B' ? '7' : '6'} sections for Variant ${variant})`}

━━ BUILD THE HTML NOW ━━
EMAIL STRUCTURE ORDER — follow this exactly:
1. <!DOCTYPE html> + <html lang="en"> + <head> with <meta charset="UTF-8">, <meta name="viewport">, <title>, responsive <style> block (includes Outlook reset + @media rules)
2. <body style="margin:0;padding:0;background:#FFFFFF"> with outer 600px centering wrapper table
3. PREHEADER — immediately after <body>: hidden div with preheader text (see template above)
4. Announcement bar (amber #6A33D8 background, offer/shipping line — bgcolor="#6A33D8" on td)
5. ${F.name} Header (${F.primary} — bgcolor on all tds, 3-column: ${F.foundedLine ? 'EST line' : 'blank'} · ${F.name} · SHOP ALL)
6. Trust badges bar (light background, the verifiable claims only: ${F.claimsMid})
7. All sections from the plan IN ORDER — each content-complete, bgcolor on every colored td
8. Social proof strip (only proof on the brand record; otherwise omit)
9. ${F.name} Footer (${F.primary}, logo + nav links + unsubscribe/privacy + the legal sender line)
10. </body></html>

CRITICAL: Every <td> with background color MUST have matching bgcolor="" attribute — non-negotiable for Outlook.
Every section must be content-complete — no section should consist of empty padding.
Product cards must include image, name, description, price, and CTA (a rating only if it is on the record).
Output starts <!DOCTYPE html>, ends </html>. Nothing before or after.`;

  try {
    const { text, provider, model, quota_warning, exhausted_keys } = await callLLM({
      systemPrompt: systemFor(F),
      userMessage,
      responseFormat: null,    // HTML output — not JSON
      maxTokens: 10000,        // Full email with 6-8 sections + header/footer easily exceeds 6K tokens
      temperature: 0.3 + Math.min(0.15, regen * 0.05), // Low = reliable HTML; slight bump on regen for variation
      timeoutMs: 80000,        // 80s internal; vercel maxDuration set to 90s (10s headroom for overhead)
      stage: 'html-' + variant + '[regen=' + regen + ']',
      tier: 'premium',
      userGeminiKey
    });

    let html = (text || '').trim();

    // Strip any markdown fences the LLM may have accidentally emitted
    html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    // ── URL SAFETY POST-PROCESS ────────────────────────────────────────────
    // The system prompt uses {{STORE_BASE}} as the canonical placeholder.
    // Substitute it (and any stray non-store domains) with the correct
    // market base so every link in the final mailer redirects correctly.
    // The market's store is the brand's OWN region store (resolved above). With
    // none on the record the placeholder stays visible in the output rather than
    // becoming a URL nobody verified. The map that sat here was tenant zero's.
    const _resolvedBase = storeBase || '{{STORE_BASE}}';
    // 1) Substitute the template placeholder
    html = html.split('{{STORE_BASE}}').join(_resolvedBase);
    // 2) Defensive: a link the model pointed at one of the brand's OTHER region
    //    stores is rewritten to this market's store — never to another brand's.
    Object.keys(storeUrlMap).forEach((code) => {
      const other = String(storeUrlMap[code] || '').replace(/\/+$/, '');
      if (!other || other === _resolvedBase) return;
      const host = other.replace(/^https?:\/\/(?:www\.)?/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp('https?://(?:www\\.)?' + host + '(?!/cdn)', 'g'), _resolvedBase);
    });

    // ── BRAND FONTS — guarantee the ACTIVE brand's own font stylesheet is in
    //    <head> regardless of model adherence. The block that sat here injected
    //    tenant zero's two @font-face rules into every workspace's email.
    if (F.fontsHref && html.indexOf(F.fontsHref) < 0 && /<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => m + '<style>@import url("' + F.fontsHref + '");</style>');
    }

    // Validation: must be actual HTML, not a refusal or truncated output
    if (!html || html.length < 600) {
      return res.status(502).json({
        error: 'html_too_short',
        variant,
        provider,
        detail: 'LLM returned < 600 chars — likely truncation or refusal',
        raw: html.substring(0, 300)
      });
    }
    if (!html.toLowerCase().includes('<table') && !html.toLowerCase().includes('<!doctype')) {
      console.warn('[html] LLM output has no valid HTML structure for variant ' + variant + ' — falling to heuristic');
      throw new Error('html_invalid_structure: LLM response has no <table> or <!DOCTYPE> — using heuristic fallback');
    }
    // Completeness check: truncated output falls through to heuristic fallback
    if (!html.toLowerCase().includes('</html>')) {
      console.warn('[html] LLM output truncated (' + html.length + ' chars) for variant ' + variant + ' — falling to heuristic');
      throw new Error('html_truncated: LLM output was ' + html.length + ' chars, missing </html> — using heuristic fallback');
    }

    // Placeholder validation: all three image slots must be present so the client can inject images
    const missingPlaceholders = ['IMAGE_HERO_URL', 'IMAGE_PRODUCT_URL', 'IMAGE_LIFESTYLE_URL']
      .filter(p => !html.includes(p));
    if (missingPlaceholders.length === 3) {
      // All three missing means the LLM ignored the image instructions entirely — reject
      return res.status(502).json({
        error: 'html_missing_images',
        variant,
        provider,
        detail: 'HTML contains no image placeholders — LLM did not follow image slot instructions',
        missing: missingPlaceholders
      });
    }

    return res.status(200).json({
      ok: true,
      stage: 'html',
      variant,
      provider,
      model,
      html: MF.withSubjectMeta(html, { subject: subjectLines[0], alts: subjectLines.slice(1, 3), preheader: plan.preheader || '' }),
      section_count: sections.length,
      subject_lines: subjectLines,
      preheader: plan.preheader || '',
      ...(quota_warning ? { quota_warning: true, exhausted_keys } : {})
    });

  } catch (e) {
    // ── HEURISTIC FALLBACK: Generate a complete HTML email without LLM ──────
    console.warn('[html] All providers failed for variant ' + variant + ' — using heuristic HTML fallback');

    const isB = variant === 'B';
    const planSections = (plan.sections || []);
    const heroSection = planSections.find(s => s.id === 'hero' || s.id === 'narrative') || {};
    const productSection = planSections.find(s => s.id === 'product_reveal') || {};
    const offerSection = planSections.find(s => s.id === 'offer_bar') || {};
    const ctaSection = planSections.find(s => s.id === 'cta') || {};
    const benefitSection = planSections.find(s => s.id === 'benefit_strip' || s.id === 'context') || {};
    const proofSection = planSections.find(s => s.id === 'social_proof') || {};

    // Market-specific store URL
    const heuristicStoreBase = storeBase || F.store || '{{STORE_BASE}}';
    const heuristicShopUrl = heuristicStoreBase + '/?utm_source=email&utm_medium=mailer&utm_campaign=lifecycle_os_studio';
    const heuristicHeroProduct = clientProducts[0] || {};
    const heuristicHeroHandle = heuristicHeroProduct.handle || '';
    const heuristicHeroUrl = heuristicHeroHandle ? (heuristicStoreBase + '/products/' + heuristicHeroHandle + '?utm_source=email&utm_medium=mailer&utm_campaign=lifecycle_os_studio') : heuristicShopUrl;
    const heuristicHeroPrice = heuristicHeroProduct.price || '';
    const heuristicHeroCompare = heuristicHeroProduct.compare_at || '';

    const heroHeadline = (heroSection.copy || {}).headline || (heuristicHeroProduct.name ? heuristicHeroProduct.name : (isB ? 'Worth Slowing Down For' : F.name));
    const heroSubcopy = (heroSection.copy || {}).subcopy || (F.tagline || F.claim0);
    const heroCta = (heroSection.copy || {}).cta || (isB ? 'Discover the story' : 'Shop now');
    const productName = (productSection.copy || {}).headline || ((strategy.product_selection || {}).hero || {}).name || (heuristicHeroProduct.name || (F.name + ' collection'));
    const productCopy = (productSection.copy || {}).subcopy || F.claim0;
    const productCta = (productSection.copy || {}).cta || (isB ? 'Explore this product' : 'Add to cart');
    const offerHeadline = (offerSection.copy || {}).headline || (heuristicHeroPrice ? 'Get ' + heuristicHeroProduct.name + ' now' : (F.shippingLine || F.tagline || F.claim0));
    const offerSubcopy = (offerSection.copy || {}).subcopy || (F.host ? 'Shop now at ' + F.host : 'Shop now');
    const finalCta = (ctaSection.copy || {}).cta || (isB ? 'Explore the Collection' : 'Shop Now');
    const proofCopy = (proofSection.copy || {}).subcopy || ('[DATA REQUIRED BEFORE LAUNCH: approved customer review, ' + F.name + ']');
    const subjectLines = plan.subject_lines || [heroHeadline];
    const preheader = plan.preheader || F.tagline || F.claim0;

    const bgColor = isB ? F.primary : F.surface;
    const textColor = isB ? F.surface : F.primary;
    const accentColor = F.accent;

    const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${heroHeadline}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{mso-table-lspace:0;mso-table-rspace:0}
img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none;display:block}
body{margin:0;padding:0;width:100%!important;-webkit-font-smoothing:antialiased;font-family:${F.bodyStack}}
.email-container{max-width:600px!important}
@media screen and (max-width:620px){
  .email-container{width:100%!important;max-width:100%!important}
  .col2,.col3{width:100%!important;display:block!important;padding:12px 16px!important}
  .mobile-hide{display:none!important}
  .mobile-full{width:100%!important}
  .mobile-pad{padding:16px!important}
  img.hero-img{width:100%!important;height:auto!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${F.surface}" bgcolor="${F.surface}">
<!-- PREHEADER -->
<div style="display:none;font-size:1px;color:${F.surface};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheader}</div>

<!-- OUTER WRAPPER -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${F.surface}" bgcolor="${F.surface}"><tr><td align="center" style="padding:0">

<!-- ANNOUNCEMENT BAR -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${accentColor};padding:10px 20px;text-align:center;font-family:Arial,sans-serif;font-size:13px;color:#ffffff;letter-spacing:0.5px" bgcolor="${accentColor}">
${F.shippingUpperOrTagline}
</td></tr>
</table>

<!-- HEADER -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${F.primary};padding:16px 24px;text-align:center;font-family:Georgia,serif;font-size:12px;color:#a89f91;letter-spacing:2px" bgcolor="${F.primary}">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="text-align:left;font-family:Arial,sans-serif;font-size:11px;color:#a89f91;letter-spacing:1px" class="mobile-hide">${F.foundedLine}</td>
<td style="text-align:center">${F.logoHtml}</td>
<td style="text-align:right;font-family:Arial,sans-serif;font-size:11px;color:${accentColor};letter-spacing:1px" class="mobile-hide"><a href="${heuristicShopUrl}" style="color:${accentColor};text-decoration:none">SHOP ALL &rarr;</a></td>
</tr></table>
</td></tr>
</table>

<!-- TRUST BADGES -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${F.surface};padding:10px 16px;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#6b6255;letter-spacing:0.3px" bgcolor="${F.surface}">
${F.claimsMid}
</td></tr>
</table>

<!-- HERO SECTION -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${bgColor};padding:0" bgcolor="${bgColor}">
${isB ? `
<!-- VARIANT B: Full-bleed editorial hero -->
<div style="position:relative;background:${bgColor}">
<img src="IMAGE_HERO_URL" alt="${heroHeadline}" width="600" class="hero-img" style="width:600px;height:auto;display:block">
</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${F.primary};padding:48px 40px;text-align:center" bgcolor="${F.primary}">
<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:12px;color:${accentColor};letter-spacing:2px;text-transform:uppercase">${(heroSection.copy || {}).eyebrow || 'THE STORY'}</p>
<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:32px;color:${F.surface};line-height:1.2;font-weight:normal">${heroHeadline}</h1>
<p style="margin:0 0 28px;font-family:Arial,sans-serif;font-size:15px;color:#c9bfb0;line-height:1.6;max-width:440px;margin-left:auto;margin-right:auto">${heroSubcopy}</p>
<a href="${heuristicHeroUrl}" style="display:inline-block;padding:14px 36px;font-family:Arial,sans-serif;font-size:13px;color:${F.surface};border:1px solid ${F.surface};text-decoration:none;letter-spacing:1px">${heroCta}</a>
</td></tr></table>
` : `
<!-- VARIANT A: Split hero -->
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="col2" width="300" style="vertical-align:middle;background:${bgColor}" bgcolor="${bgColor}">
<img src="IMAGE_HERO_URL" alt="${heroHeadline}" width="300" class="hero-img" style="width:300px;height:auto;display:block">
</td>
<td class="col2" width="300" style="vertical-align:middle;background:${bgColor};padding:32px 28px" bgcolor="${bgColor}">
<p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:12px;color:${accentColor};letter-spacing:2px;text-transform:uppercase">${(heroSection.copy || {}).eyebrow || 'NEW ARRIVAL'}</p>
<h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:28px;color:${F.primary};line-height:1.2">${heroHeadline}</h1>
<p style="margin:0 0 24px;font-family:Arial,sans-serif;font-size:14px;color:#4a4540;line-height:1.6">${heroSubcopy}</p>
<a href="${heuristicHeroUrl}" style="display:inline-block;padding:14px 32px;background:${accentColor};font-family:Arial,sans-serif;font-size:13px;color:#ffffff;text-decoration:none;letter-spacing:0.5px;border-radius:2px">${heroCta}</a>
</td>
</tr></table>
`}
</td></tr>
</table>

<!-- BENEFIT STRIP -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${isB ? '${F.primary}' : '#ffffff'};padding:28px 20px;text-align:center" bgcolor="${isB ? '${F.primary}' : '#ffffff'}">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${(F.claims.length ? F.claims.slice(0, 4) : [F.claim0]).map((c) => '<td class="col3" style="text-align:center;padding:8px;font-family:Arial,sans-serif;font-size:12px;color:' + (isB ? F.surface : F.ink) + ';letter-spacing:0.5px">' + c + '</td>').join('')}
</tr></table>
</td></tr>
</table>

<!-- PRODUCT SECTION -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${isB ? '${F.primary}' : '#ffffff'};padding:36px 24px;text-align:center" bgcolor="${isB ? '${F.primary}' : '#ffffff'}">
${isB ? `<p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:12px;color:${accentColor};letter-spacing:2px;text-transform:uppercase">THE COLLECTION</p>` : ''}
<h2 style="margin:0 0 12px;font-family:Georgia,serif;font-size:24px;color:${textColor};line-height:1.3">${productName}</h2>
<img src="IMAGE_PRODUCT_URL" alt="${productName}" width="${isB ? 400 : 260}" style="width:${isB ? 400 : 260}px;height:auto;display:block;margin:16px auto;border-radius:4px">
<p style="margin:12px auto 20px;font-family:Arial,sans-serif;font-size:14px;color:${isB ? '#c9bfb0' : '#4a4540'};line-height:1.6;max-width:420px">${productCopy}</p>
<a href="${heuristicHeroUrl}" style="display:inline-block;padding:14px 32px;${isB ? 'border:1px solid ${F.surface};color:${F.surface}' : 'background:' + accentColor + ';color:#ffffff'};font-family:Arial,sans-serif;font-size:13px;text-decoration:none;letter-spacing:0.5px;border-radius:2px">${productCta}</a>
</td></tr>
</table>

<!-- SOCIAL PROOF -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${isB ? '${F.primary}' : '${F.surface}'};padding:32px 36px;text-align:center" bgcolor="${isB ? '${F.primary}' : '${F.surface}'}">
<p style="margin:0 0 8px;font-family:Georgia,serif;font-size:16px;color:${textColor};font-style:italic;line-height:1.5">${proofCopy}</p>
</td></tr>
</table>

<!-- LIFESTYLE IMAGE -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${isB ? '${F.primary}' : '#ffffff'};padding:0" bgcolor="${isB ? '${F.primary}' : '#ffffff'}">
<img src="IMAGE_LIFESTYLE_URL" alt="${F.name}" width="600" style="width:600px;height:auto;display:block">
</td></tr>
</table>

<!-- OFFER BAR -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${accentColor};padding:24px 28px;text-align:center" bgcolor="${accentColor}">
<h3 style="margin:0 0 8px;font-family:Georgia,serif;font-size:20px;color:#ffffff">${offerHeadline}</h3>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:13px;color:#fff5eb">${offerSubcopy}</p>
<a href="${heuristicShopUrl}" style="display:inline-block;padding:12px 28px;background:${F.primary};font-family:Arial,sans-serif;font-size:13px;color:${F.surface};text-decoration:none;letter-spacing:0.5px;border-radius:2px">${(offerSection.copy || {}).cta || 'Shop the Collection'}</a>
</td></tr>
</table>

<!-- FINAL CTA -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${bgColor};padding:36px 28px;text-align:center" bgcolor="${bgColor}">
<h3 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;color:${textColor}">${(ctaSection.copy || {}).headline || (isB ? 'Explore the collection' : 'Shop ' + F.name + ' today')}</h3>
<a href="${heuristicShopUrl}" style="display:inline-block;padding:16px 40px;${isB ? 'border:1px solid ${F.surface};color:${F.surface}' : 'background:' + accentColor + ';color:#ffffff'};font-family:Arial,sans-serif;font-size:14px;text-decoration:none;letter-spacing:0.5px;border-radius:2px">${finalCta}</a>
</td></tr>
</table>

<!-- FOOTER -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${F.primary};padding:28px 24px;text-align:center" bgcolor="${F.primary}">
<p style="margin:0 0 12px;font-family:Georgia,serif;font-size:18px;color:${F.surface};letter-spacing:2px">${F.name}</p>
<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:12px;color:#8a8175">
<a href="${heuristicShopUrl}" style="color:${accentColor};text-decoration:none">Shop</a>
</p>
<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;color:#6b6255;line-height:1.5">
You received this email because you signed up at ${F.host}<br>
<a href="{{UNSUBSCRIBE_URL}}" style="color:#8a8175;text-decoration:underline">Unsubscribe</a>
</p>
<p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#4a4540">${F.legalLine}<br>&copy; ${F.name}. All Rights Reserved.</p>
</td></tr>
</table>

</td></tr></table>
</body>
</html>`;

    return res.status(200).json({
      ok: true,
      stage: 'html',
      variant,
      provider: 'heuristic',
      model: 'fallback-v1',
      html: MF.withSubjectMeta(html, { subject: subjectLines[0], alts: subjectLines.slice(1, 3), preheader }),
      _heuristic: true,
      _llm_error: String(e.message || e).substring(0, 200),
      section_count: 8,
      subject_lines: subjectLines,
      preheader
    });
  }
};
