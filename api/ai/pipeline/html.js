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

// ─────────────────────────────────────────────────────────────────────────────
// MASTER SYSTEM PROMPT — Steps 9-10 of the final master orchestration system
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM = `You are the HTML execution engine for KNICKGASM's email marketing platform — a $100M premium D2C Indian heritage sneaker brand. Your outputs directly impact revenue.

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

③ EXPLICIT ADD TO CART — Every product card has a full-width "🛒 ADD TO CART" button (dark green #D0473E, display:block). Never rely on clicking the product image.

④ SHORT AND HIGH-IMPACT — MAX 7 SECTIONS. Every section earns its place. No filler, no padding-only sections.

⑤ MAX 2-3 PRODUCTS in product section. Never render more than 3. Use 2-col or 3-col grid accordingly.

⑥ MANDATORY COPY INSERTIONS (apply verbatim when relevant):
   → Hero subcopy (gifting): ends with "She'll enjoy it every day and remember you."
   → CTA tagline (gifting): "MAKE HER SMILE, GIFT RIGHT!" — placed below hero CTA button
   → Urgency (when applicable): "Hurry Now Before They Finish"
   → Offer repeat on second scroll: badge + punchline in [S6] offer reinforcement section

⑦ SOCIAL PROOF PER PRODUCT: "⭐⭐⭐⭐⭐ ([N] reviews)" and "🔥 [N] units sold in the last 24 hours" — specific numbers, not "50K+ reviews" generic

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
   - First 2–3 sections: dark background (#D0473E) with chalk text (#FFFFFF) — mandatory
   - No product in sections 1–2. Narrative/lifestyle/mood opens the email
   - Ghost-button CTA only: border:2px solid [matching text color]; background:transparent
   - Single editorial product with large image, not a product grid
   - Headline 44px+ serif, evocative poetic copy, 60px+ section padding (editorial needs air)

⑤ MISSING MARKETING SIGNALS — No ratings, no social proof numbers, no price context.
   FIX: Include ⭐ 4.8/5 · India's largest sneaker customisers in product sections; use compare-at pricing where available; add "Free Shipping on $49+" in offer sections; include 1-2 trust badge rows (Farm Direct · B-Corp · Water & scratch resistant · Ships Worldwide).

⑥ NON-RESPONSIVE LAYOUT — Split columns and product grids break on mobile (portrait mode issue).
   FIX: Wrap the email in a <style> block with @media rules. Use MSO conditional comments for Outlook. Inner columns must stack on mobile. Add float:none!important and max-width:100%!important to .col2/.col3 to fix portrait orientation reflow in email clients.

⑦ HIDDEN DISCOUNT — Offer/discount not visible in first 500px. Buyer has to scroll to find the price.
   FIX: Inside the hero section (BEFORE the CTA button), include a prominent offer badge as a dark block:
   <div style="display:inline-block;background:#D0473E;color:#FFFFFF;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:10px 18px;margin-bottom:14px;line-height:1.5">UP TO [X%] OFF<br><span style="font-size:9px;font-weight:400;color:#6A33D8;letter-spacing:0.04em">ON SELECTED [PRODUCT CATEGORY]</span></div>

⑧ WEAK ADD TO CART — Small inline "Add to Cart" link colorways into product card. No urgency signals on products.
   FIX: Product cards MUST use a FULL-WIDTH dark green button spanning the entire card width:
   <a href="..." style="display:block;background:#D0473E;color:#FFFFFF;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;text-decoration:none;padding:11px 16px;text-align:center">🛒 ADD TO CART</a>
   AND add "🔥 [N] units sold in the last 24 hours" (N=25-90) above the price for social proof urgency.

⑨ MISSING GIFTING TAGLINE — CTA button has no emotional reinforcement for gifting campaigns.
   FIX: For any gift/Mother's Day/holiday campaign, add this line BELOW the hero CTA button:
   <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#6A33D8;margin-top:10px">MAKE HER SMILE, GIFT RIGHT!</div>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HTML STRUCTURE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Table-based layout, 600px max-width center wrapper
- Inline CSS for all structural styles. <style> block in <head> for media queries + Outlook resets ONLY
- No div layout, no flexbox, no CSS grid
- Images: <img src="PLACEHOLDER" width="600" height="auto" style="display:block;border:0;max-width:100%">
- Full email: <!DOCTYPE html> … </html>

━━ BRAND ASSETS — EXACT, NEVER SUBSTITUTE ━━
- Fonts: in the <head> <style>, before app rules, include verbatim:
  @font-face{font-family:"Montserrat";src:url("https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w0aXp-p7K4KLjztg.woff2") format("woff2");}
  @font-face{font-family:"Instrument Sans";src:url("https://fonts.gstatic.com/s/instrumentsans/v4/pximypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr-yp2JGEJOH9npSTF-Tf8kywN2u7ZWwUbNA.woff2") format("woff2");}
  Headings use 'Montserrat', Georgia, 'Times New Roman', serif. Body/UI uses 'Instrument Sans', 'Helvetica Neue', Arial, sans-serif.
- Header logo: use this image ONLY (no text wordmark) — <img src="https://www.knickgasm.com/cdn/shop/files/logo-website_3.png?v=1756808809&width=310" alt="KNICKGASM" height="30" style="display:block;border:0">
- Footer: "Privacy Policy" and "Terms of Service" are plain labels with href="#", no target/onclick.

━━ OUTLOOK (MSO) COMPATIBILITY — MANDATORY ━━
Outlook ignores CSS background-color on <td>. You MUST add bgcolor="" attribute on EVERY colored <td>.
Failure to do this = dark sections appear white in Outlook (breaks Variant B entirely).

RULE: Every <td> with a CSS background value MUST also have the matching bgcolor attribute.
Examples:
  <td style="background:#D0473E" bgcolor="#D0473E">        ← dark section
  <td style="background:#FFFFFF" bgcolor="#FFFFFF">        ← chalk section
  <td style="background:#6A33D8" bgcolor="#6A33D8">        ← amber announcement bar
  <td style="background:#f5efe0" bgcolor="#f5efe0">        ← trust badge bar
  <td style="background:#ffffff" bgcolor="#ffffff">        ← white section

Apply bgcolor to EVERY <td> that has a background color — no exceptions.

━━ PREHEADER TEXT — add immediately after <body> tag ━━
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:inherit;opacity:0;mso-hide:all">[PREHEADER_TEXT]</div>

━━ RESPONSIVE <style> BLOCK — always include in <head> ━━
<style>
  /* Outlook reset */
  table{border-collapse:collapse!important}
  a{color:#6A33D8}
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

── ANNOUNCEMENT BAR (always add this before KNICKGASM header) ──
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#6A33D8" bgcolor="#6A33D8">
  <tr><td style="text-align:center;padding:9px 16px" bgcolor="#6A33D8">
    <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff">[OFFER LINE — e.g. FREE SHIPPING ON ORDERS $49+ &nbsp;·&nbsp; USE CODE: KNICKGASM15]</span>
  </td></tr>
</table>

── KNICKGASM HEADER ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#D0473E;max-width:600px;margin:0 auto" bgcolor="#D0473E">
  <tr>
    <td width="200" style="padding:10px 16px 10px 24px;vertical-align:middle;background:#D0473E" bgcolor="#D0473E">
      <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;color:rgba(253,246,232,0.5);letter-spacing:0.08em">EST. 2015 · NEW DELHI, INDIA</span>
    </td>
    <td style="text-align:center;padding:14px 16px;vertical-align:middle;background:#D0473E" bgcolor="#D0473E">
      <div style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:28px;color:#FFFFFF;letter-spacing:0.18em;font-weight:400;line-height:1">KNICKGASM<span style="font-size:14px;vertical-align:super;letter-spacing:0">®</span></div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:8.5px;color:#6A33D8;letter-spacing:0.22em;text-transform:uppercase;margin-top:4px">PREMIUM INDIAN SNEAKERS · DIRECT FROM SOURCE</div>
    </td>
    <td width="200" style="text-align:right;padding:10px 24px 10px 16px;vertical-align:middle;background:#D0473E" bgcolor="#D0473E">
      <a href="https://knickgasm.com/collections/all" style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;color:#6A33D8;text-decoration:none;letter-spacing:0.06em">SHOP ALL →</a>
    </td>
  </tr>
</table>

── TRUST BADGES BAR (add after header or before CTA) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#f5efe0;max-width:600px;margin:0 auto" bgcolor="#f5efe0">
  <tr>
    <td style="text-align:center;padding:10px 16px;border-top:1px solid #e8dcc8;border-bottom:1px solid #e8dcc8;background:#f5efe0" bgcolor="#f5efe0">
      <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;color:#4a7a5a;letter-spacing:0.08em">
        🌿 100% PURE INDIAN SNEAKER &nbsp;·&nbsp; ✦ ETHICALLY SOURCED &nbsp;·&nbsp; 🌱 DIRECT FROM FARMS &nbsp;·&nbsp; ★ 4.8/5 · 50K+ REVIEWS
      </span>
    </td>
  </tr>
</table>

── SPLIT-HERO (image 55% left, copy 45% right — Variant A default) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;max-width:600px;margin:0 auto" bgcolor="#FFFFFF">
  <tr>
    <!--[if mso]><td width="330" valign="top"><![endif]-->
    <td class="col2 hero-img" width="330" valign="top" style="vertical-align:top;padding:0;background:#FFFFFF" bgcolor="#FFFFFF">
      <img src="IMAGE_HERO_URL" width="330" height="auto" class="hero-img" style="display:block;border:0;width:330px;max-width:330px" alt="[PRODUCT NAME] — KNICKGASM">
    </td>
    <!--[if mso]></td><td width="270" valign="middle"><![endif]-->
    <td class="col2 mobile-pad" width="270" valign="middle" style="vertical-align:middle;padding:28px 24px 28px 20px;background:#FFFFFF" bgcolor="#FFFFFF">
      <span class="mobile-text" style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#6A33D8;display:block;margin-bottom:8px">[EYEBROW]</span>
      <h1 class="mobile-h1" style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:30px;line-height:1.15;color:#D0473E;font-weight:700;margin:0 0 12px 0">[HEADLINE — use verbatim from plan]</h1>
      <!-- BENEFIT BULLETS — always include 2-3 short benefit lines derived from product -->
      <ul style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:13px;line-height:1.7;color:#3d5a40;margin:0 0 14px 0;padding:0 0 0 16px">
        <li>[BENEFIT 1 — specific product attribute or drop detail]</li>
        <li>[BENEFIT 2 — origin, studio name, or quality certification]</li>
        <li>[BENEFIT 3 — use occasion or daily ritual context]</li>
      </ul>
      <p class="mobile-text" style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:13px;line-height:1.65;color:#4a5568;margin:0 0 14px 0">[SUBCOPY — full sentence from plan. For gifting: end with "She'll enjoy it every day and remember you."]</p>
      <!-- OFFER BADGE — visible in first scroll, before CTA — MANDATORY for discount campaigns -->
      <div style="display:inline-block;background:#D0473E;color:#FFFFFF;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:10px 18px;margin-bottom:14px;line-height:1.5">UP TO [X%] OFF<br><span style="font-size:9px;font-weight:400;color:#6A33D8;letter-spacing:0.04em">ON SELECTED [PRODUCT CATEGORY e.g. GIFTS]</span></div>
      <br>
      <a href="{{STORE_BASE}}/products/[HANDLE]" style="display:inline-block;background:#6A33D8;color:#ffffff;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:13px 28px">[CTA e.g. SHOP GIFTS]</a>
      <!-- GIFTING TAGLINE — for gift/Mother's Day/holiday campaigns -->
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#6A33D8;margin-top:10px">MAKE HER SMILE, GIFT RIGHT!</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;color:#8a9a8a;margin-top:8px">🚚 Free shipping on orders $49+</div>
    </td>
    <!--[if mso]></td><![endif]-->
  </tr>
</table>

── FULL-BLEED HERO (image full width, copy below — Variant B default) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background:#D0473E" bgcolor="#D0473E">
  <tr><td style="padding:0;background:#D0473E" bgcolor="#D0473E">
    <img src="IMAGE_HERO_URL" width="600" height="auto" style="display:block;border:0;width:100%;max-width:600px" alt="[CAMPAIGN MOOD] — KNICKGASM">
  </td></tr>
  <tr><td class="mobile-pad" style="padding:40px 48px;background:#D0473E;text-align:center" bgcolor="#D0473E">
    <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#6A33D8;display:block;margin-bottom:12px">[EYEBROW]</span>
    <h1 class="mobile-h1" style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:44px;line-height:1.1;color:#FFFFFF;font-weight:400;margin:0 0 18px 0;letter-spacing:-0.01em">[HEADLINE — use verbatim from plan]</h1>
    <p class="mobile-text" style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:15px;line-height:1.75;color:rgba(253,246,232,0.75);margin:0 0 24px 0;max-width:460px;margin-left:auto;margin-right:auto">[SUBCOPY — full sentence from plan]</p>
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
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #e5ddd0" bgcolor="#FFFFFF">
  <tr><td style="padding:0;background:#FFFFFF" bgcolor="#FFFFFF">
    <img src="IMAGE_PRODUCT_URL" width="100%" height="auto" style="display:block;border:0;max-width:100%" alt="[FULL PRODUCT NAME] — KNICKGASM Premium Sneaker">
  </td></tr>
  <tr><td style="padding:12px 12px 4px;text-align:left;background:#FFFFFF" bgcolor="#FFFFFF">
    <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11px;color:#6A33D8;margin-bottom:3px">⭐⭐⭐⭐⭐ <span style="color:#888;font-size:10px">([REVIEW_COUNT — realistic number e.g. 70] reviews)</span></div>
    <div style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:15px;color:#D0473E;font-weight:600;line-height:1.3;margin-bottom:4px">[FULL PRODUCT NAME — no truncation]</div>
    <!-- URGENCY LINE — social proof, use realistic N between 25-90 -->
    <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;color:#cc4400;font-weight:600;margin-bottom:7px">🔥 [N] units sold in the last 24 hours</div>
    <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:14px;font-weight:700;color:#D0473E;margin-bottom:4px">
      $[PRICE] <span style="font-size:10px;color:#aaa;text-decoration:line-through;font-weight:400">$[ORIG_PRICE]</span>
      &nbsp;<span style="font-size:9px;font-weight:800;color:#2a7a3a">[X%] OFF</span>
    </div>
  </td></tr>
  <!-- FULL-WIDTH ADD TO CART — spans entire card width, dark green background -->
  <tr><td style="padding:8px 12px 12px;background:#FFFFFF" bgcolor="#FFFFFF">
    <a href="{{STORE_BASE}}/products/[HANDLE]" style="display:block;background:#D0473E;color:#FFFFFF;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;text-decoration:none;padding:11px 0;text-align:center">🛒 ADD TO CART</a>
  </td></tr>
</table>

── BENEFIT STRIP / ICON ROW ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#D0473E;max-width:600px;margin:0 auto" bgcolor="#D0473E">
  <tr>
    <td width="150" style="padding:16px 8px;text-align:center;vertical-align:top;background:#D0473E" bgcolor="#D0473E">
      <div style="font-size:20px;margin-bottom:5px">🌿</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;font-weight:700;color:#6A33D8;letter-spacing:0.1em;text-transform:uppercase">FARM DIRECT</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:9.5px;color:rgba(253,246,232,0.65);margin-top:3px">Source to pair</div>
    </td>
    <td width="150" style="padding:16px 8px;text-align:center;vertical-align:top;background:#D0473E" bgcolor="#D0473E">
      <div style="font-size:20px;margin-bottom:5px">♻️</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;font-weight:700;color:#6A33D8;letter-spacing:0.1em;text-transform:uppercase">B-CORP CERTIFIED</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:9.5px;color:rgba(253,246,232,0.65);margin-top:3px">Ethical sourcing</div>
    </td>
    <td width="150" style="padding:16px 8px;text-align:center;vertical-align:top;background:#D0473E" bgcolor="#D0473E">
      <div style="font-size:20px;margin-bottom:5px">⭐</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;font-weight:700;color:#6A33D8;letter-spacing:0.1em;text-transform:uppercase">4.8/5 RATING</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:9.5px;color:rgba(253,246,232,0.65);margin-top:3px">India's largest sneaker customisers</div>
    </td>
    <td width="150" style="padding:16px 8px;text-align:center;vertical-align:top;background:#D0473E" bgcolor="#D0473E">
      <div style="font-size:20px;margin-bottom:5px">🚚</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;font-weight:700;color:#6A33D8;letter-spacing:0.1em;text-transform:uppercase">FREE SHIPPING</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:9.5px;color:rgba(253,246,232,0.65);margin-top:3px">Orders $49+</div>
    </td>
  </tr>
</table>

── SOCIAL PROOF STRIP ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#f5efe0;border-top:1px solid #e8dcc8;border-bottom:1px solid #e8dcc8;max-width:600px;margin:0 auto" bgcolor="#f5efe0">
  <tr><td style="padding:14px 24px;text-align:center;background:#f5efe0" bgcolor="#f5efe0">
    <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11px;color:#D0473E;font-weight:700">⭐⭐⭐⭐⭐</span>
    <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11px;color:#4a5568;margin-left:8px">Made on 100% original brand sneakers · Water & scratch resistant · Ships worldwide</span>
  </td></tr>
</table>

── TESTIMONIAL (2-col layout) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;max-width:600px;margin:0 auto" bgcolor="#FFFFFF">
  <tr>
    <td class="col2" width="290" style="padding:20px 10px 20px 24px;vertical-align:top;background:#FFFFFF" bgcolor="#FFFFFF">
      <div style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:17px;font-style:italic;color:#D0473E;line-height:1.6;border-left:3px solid #6A33D8;padding-left:14px;margin-bottom:10px">"[REAL REVIEW TEXT — specific and authentic, 1-2 sentences]"</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10.5px;color:#888;letter-spacing:0.06em">— [FIRST NAME], [CITY, STATE]</div>
    </td>
    <td class="col2" width="290" style="padding:20px 24px 20px 10px;vertical-align:top;background:#FFFFFF" bgcolor="#FFFFFF">
      <div style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:17px;font-style:italic;color:#D0473E;line-height:1.6;border-left:3px solid #6A33D8;padding-left:14px;margin-bottom:10px">"[REAL REVIEW TEXT — specific and authentic, 1-2 sentences]"</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10.5px;color:#888;letter-spacing:0.06em">— [FIRST NAME], [CITY, STATE]</div>
    </td>
  </tr>
</table>

── OFFER BANNER (Variant A — prominent) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#D0473E;max-width:600px;margin:0 auto" bgcolor="#D0473E">
  <tr><td class="mobile-pad" style="text-align:center;padding:20px 32px;background:#D0473E" bgcolor="#D0473E">
    <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:rgba(212,135,58,0.8);margin-bottom:6px">[OFFER EYEBROW e.g. LIMITED BATCH · THIS SEASON ONLY]</div>
    <div style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:26px;color:#FFFFFF;font-weight:600;margin-bottom:6px">[OFFER HEADLINE e.g. Save 20% on Your First Order]</div>
    <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:12px;color:rgba(253,246,232,0.7);margin-bottom:14px">[OFFER DETAIL — code: KNICKGASM20 · min order $49 · ends [DATE]]</div>
    <a href="{{STORE_BASE}}/collections/all" style="display:inline-block;background:#6A33D8;color:#ffffff;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:13px 36px">[CTA TEXT e.g. SHOP NOW]</a>
  </td></tr>
</table>

── SUBTLE OFFER ROW (Variant B — inline, understated) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#D0473E;border-top:1px solid rgba(212,135,58,0.25);max-width:600px;margin:0 auto" bgcolor="#D0473E">
  <tr><td style="padding:14px 32px;text-align:center;background:#D0473E" bgcolor="#D0473E">
    <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11.5px;color:rgba(253,246,232,0.75)">
      [OFFER TEXT — e.g. 'Complimentary shipping on orders above $49. Use code KNICKGASM at checkout.']
    </span>
  </td></tr>
</table>

── PRIMARY CTA SECTION (Variant A — amber button, prominent) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;max-width:600px;margin:0 auto" bgcolor="#FFFFFF">
  <tr><td class="mobile-pad" style="text-align:center;padding:28px 40px;background:#FFFFFF" bgcolor="#FFFFFF">
    <a href="{{STORE_BASE}}/collections/all" style="display:inline-block;background:#6A33D8;color:#ffffff;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:16px 52px">[CTA TEXT e.g. SHOP THE COLLECTION]</a>
    <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10.5px;color:#888;margin-top:10px">Free shipping on $49+ · Easy returns · water & scratch resistant</div>
  </td></tr>
</table>

── GHOST CTA SECTION (Variant B — understated, on dark background) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#D0473E;max-width:600px;margin:0 auto" bgcolor="#D0473E">
  <tr><td style="text-align:center;padding:40px 48px;background:#D0473E" bgcolor="#D0473E">
    <a href="{{STORE_BASE}}/collections/all" style="display:inline-block;border:1.5px solid rgba(253,246,232,0.7);background:transparent;color:#FFFFFF;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 44px">[CTA TEXT e.g. DISCOVER THE COLLECTION]</a>
    <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;color:rgba(253,246,232,0.4);margin-top:12px;letter-spacing:0.06em">[SUBTEXT e.g. Complimentary shipping on orders $49+]</div>
  </td></tr>
</table>

── EDITORIAL PRODUCT FEATURE (Variant B — large single product reveal, section 3+) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;max-width:600px;margin:0 auto" bgcolor="#FFFFFF">
  <tr><td style="padding:0;background:#FFFFFF" bgcolor="#FFFFFF">
    <img src="IMAGE_PRODUCT_URL" width="600" height="auto" style="display:block;border:0;max-width:100%" alt="[FULL PRODUCT NAME] — KNICKGASM Premium Sneaker">
  </td></tr>
  <tr><td class="mobile-pad" style="padding:32px 48px;text-align:center;background:#FFFFFF" bgcolor="#FFFFFF">
    <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#6A33D8;display:block;margin-bottom:10px">[CATEGORY · ESTATE NAME · ORIGIN REGION]</span>
    <h2 class="mobile-h2" style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:34px;color:#D0473E;font-weight:600;line-height:1.2;margin:0 0 14px 0">[FULL PRODUCT NAME — from plan]</h2>
    <p class="mobile-text" style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:14px;line-height:1.75;color:#4a5568;margin:0 0 18px 0">[PRODUCT DESCRIPTION — 2 evocative sentences. Use origin, drop, sensory detail. Never truncate.]</p>
    <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;color:#888;margin-bottom:18px">⭐ 4.8/5 &nbsp;·&nbsp; India's largest sneaker customisers &nbsp;·&nbsp; One-of-One &nbsp;·&nbsp; Hand-Painted</div>
    <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:16px;font-weight:700;color:#D0473E;margin-bottom:18px">$[PRICE] <span style="font-size:12px;color:#aaa;text-decoration:line-through;font-weight:400">$[COMPARE]</span></div>
    <a href="{{STORE_BASE}}/products/[HANDLE]" style="display:inline-block;border:2px solid #D0473E;background:transparent;color:#D0473E;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:13px 40px">[CTA e.g. EXPLORE THIS SNEAKER]</a>
  </td></tr>
</table>

── ORIGIN / PROVENANCE SECTION (Variant B narrative — image left, story right) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto" bgcolor="#D0473E">
  <tr>
    <td class="col2" width="300" style="padding:0;vertical-align:top">
      <img src="IMAGE_LIFESTYLE_URL" width="300" height="auto" style="display:block;border:0;width:300px;max-width:100%" alt="[ESTATE NAME] sneaker studio — KNICKGASM">
    </td>
    <td class="col2 mobile-pad" width="300" valign="middle" style="vertical-align:middle;padding:32px 28px;background:#D0473E" bgcolor="#D0473E">
      <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:9.5px;letter-spacing:0.16em;text-transform:uppercase;color:#6A33D8;display:block;margin-bottom:10px">[REGION · ALTITUDE ft. · HARVEST SEASON]</span>
      <h3 class="mobile-h2" style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:26px;color:#FFFFFF;font-weight:400;line-height:1.25;margin:0 0 14px 0">[SECTION HEADLINE — poetic, place-anchored]</h3>
      <p class="mobile-text" style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:13px;line-height:1.75;color:rgba(253,246,232,0.72);margin:0 0 16px 0">[ORIGIN STORY — 2-3 evocative sentences about drop, altitude, the farmers, the landscape. Specific, not generic.]</p>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;color:rgba(212,135,58,0.7);letter-spacing:0.08em">✦ One-of-One &nbsp; ✦ Hand-Painted &nbsp; ✦ First-Flush</div>
    </td>
  </tr>
</table>

── KNICKGASM FOOTER (always last — include on every email) ──
<table width="600" class="email-container" cellpadding="0" cellspacing="0" border="0" style="background:#D0473E;max-width:600px;margin:0 auto" bgcolor="#D0473E">
  <tr>
    <td style="padding:28px 32px 12px;text-align:center;background:#D0473E" bgcolor="#D0473E">
      <div style="font-family:'Montserrat','Raleway',Georgia,serif;font-size:22px;color:#FFFFFF;letter-spacing:0.14em;margin-bottom:8px">KNICKGASM<span style="font-size:11px;vertical-align:super;letter-spacing:0">®</span> India</div>
      <div style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:10px;color:#7a9a7a;line-height:2;margin-bottom:14px">One-of-One Heritage Sneakers &nbsp;·&nbsp; B-Corp Certified &nbsp;·&nbsp; Hand-Painted &nbsp;·&nbsp; Free Shipping $49+</div>
      <div style="margin-bottom:14px">
        <a href="{{STORE_BASE}}/collections/all" style="color:#6A33D8;text-decoration:none;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11px;margin:0 10px">Shop All Sneakers</a>
        <a href="{{STORE_BASE}}/pages/our-story" style="color:#6A33D8;text-decoration:none;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11px;margin:0 10px">Our Story</a>
        <a href="{{STORE_BASE}}/collections/bestsellers" style="color:#6A33D8;text-decoration:none;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11px;margin:0 10px">Bestsellers</a>
        <a href="{{STORE_BASE}}/collections/gift-sets" style="color:#6A33D8;text-decoration:none;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:11px;margin:0 10px">Gift Sets</a>
      </div>
      <div style="border-top:1px solid rgba(253,246,232,0.12);padding-top:12px;margin-top:4px">
        <a href="{{UNSUBSCRIBE_URL}}" style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:9.5px;color:rgba(253,246,232,0.35);text-decoration:underline;margin:0 8px">Unsubscribe</a>
        <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:9.5px;color:rgba(253,246,232,0.25)">|</span>
        <a href="{{STORE_BASE}}/pages/privacy-policy" style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:9.5px;color:rgba(253,246,232,0.35);text-decoration:underline;margin:0 8px">Privacy Policy</a>
        <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:9.5px;color:rgba(253,246,232,0.25)">·</span>
        <span style="font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;font-size:9.5px;color:rgba(253,246,232,0.25);margin-left:8px">© KNICKGASM 2026. All rights reserved.</span>
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

4. SOCIAL PROOF NEAR CTA: Place "⭐ 4.8/5 · India's largest sneaker customisers" or a short testimonial directly above or below the main CTA.

5. TRUST BADGES: Include the 4-icon trust bar (Farm Direct · B-Corp · Rating · Free Shipping) at least once — after header or before CTA.

6. SCARCITY / URGENCY (subtle): "First-flush dropped" or "Limited studio batch" create legitimate urgency without discount language.

7. PRODUCT CATALOG DENSITY: Show at least 2-3 products in the email. Even Brand Building emails can show a curated trio. This drives catalog discovery and AOV.

8. FREE SHIPPING THRESHOLD: Always mention "Free shipping on $49+" — it directly increases AOV.

9. MULTIPLE CTAs: Include at least 2 CTA opportunities: once in hero section, once at the end. For product grids, each card has its own Add-to-Cart link.

10. SPECIFICITY OVER VAGUENESS: "India's largest sneaker customisers" beats "thousands of customers". "First-flush, 7,000ft elevation" beats "premium quality".

11. SOCIAL PROOF URGENCY IN PRODUCT CARDS: Add "🔥 [N] units sold in the last 24 hours" text below the product name. Use realistic N between 25-90. Pair with explicit review count: "⭐⭐⭐⭐⭐ (N reviews)" not just a generic "50K+ reviews" line. Specificity = credibility.

12. OFFER CONTINUITY: Show the discount at two points — (a) as a badge inside the hero section visible without scrolling, AND (b) as a "% OFF" label on each product card. Never surface the offer only once in the email.

13. FULL-WIDTH ADD TO CART: Product card CTAs must span the FULL card width using display:block. Use dark green background (#D0473E). Text: "🛒 ADD TO CART" all-caps. Never use a small inline button — it gets missed on mobile.

14. GIFTING CAMPAIGN TAGLINE: For any campaign involving gifts, Mother's Day, birthdays, or celebrating her: add "MAKE HER SMILE, GIFT RIGHT!" as a small uppercase line directly below the hero CTA button. This emotional hook lifts gifting click-through.

15. EMOTIONAL HERO SUBCOPY (GIFTING): For gifting-context campaigns, end the hero subcopy with: "She'll enjoy it every day and remember you." — this single line consistently outperforms generic product copy on gifting mailers by building emotional purchase justification.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION CONTENT REQUIREMENTS (every section must be filled):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HERO SECTION must include:
- Eyebrow label (product category / campaign name)
- Full headline from plan (no truncation)
- 2-3 benefit bullets (derive from product type if not in plan)
- Full subcopy sentence (gifting campaigns: end with "She'll enjoy it every day and remember you.")
- Offer badge: dark rectangle "UP TO [X%] OFF ON SELECTED [CATEGORY]" BEFORE the CTA button
- Primary CTA button
- Gifting campaigns: "MAKE HER SMILE, GIFT RIGHT!" tagline below CTA button
- "Free shipping" micro-line

PRODUCT SECTION must include per card:
- Product image (use IMAGE_PRODUCT_URL placeholder for first, exact product URL for others)
- Star rating with explicit review count (e.g., "⭐⭐⭐⭐⭐ (70 reviews)" — specific count, not generic)
- Product name (full, not truncated)
- "🔥 [N] units sold in the last 24 hours" urgency line (N between 25-90)
- Price with strikethrough compare-at AND "[X%] OFF" badge in green
- FULL-WIDTH "🛒 ADD TO CART" button spanning entire card (display:block, dark green bg #D0473E)

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
□ Free shipping $49+ mentioned at least once
□ HTML is valid — all tables closed, no broken nesting
□ Responsive <style> block with Outlook reset present in <head>
□ EVERY <td> with background-color CSS also has matching bgcolor="" attribute
□ Preheader <div> present immediately after <body> tag
□ Variant B: dark opening sections (#D0473E bg), ghost CTA, no product grid, 44px+ headlines
□ Variant A: chalk background (#FFFFFF bg), amber CTA (#6A33D8), product in section 1, benefit bullets
━━ QA SELF-CHECK — CONFIRM ALL BEFORE OUTPUTTING ━━
✔ Offer visible above the fold (announcement bar + hero badge)
✔ CTA button present in hero section (above fold)
✔ Price visible on every product (current + strikethrough + % OFF)
✔ ≤3 products in product section
✔ ADD TO CART button on every product card (full-width, dark green)
✔ No hallucinated data — all copy from the plan or derived from real product info
✔ "She'll enjoy it every day and remember you." in gifting hero subcopy
✔ "MAKE HER SMILE, GIFT RIGHT!" tagline below gifting CTA
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
BANNED: wellness journey, transform, liquid gold, game-changer, LIMITED TIME (all-caps), hurry, don't miss out, last chance
PREFERRED: ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted, first-flush

━━ OUTPUT FORMAT ━━
Return ONLY the complete HTML email string.
Start with <!DOCTYPE html>
End with </html>
No markdown fences. No commentary. No text before or after the HTML.`;

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
  const storeUrlMap = {
    'US': 'https://knickgasm.com',
    'UK': 'https://knickgasm.com',
    'IN': 'https://knickgasm.com',
    'EU': 'https://knickgasm.com',
    'AU': 'https://knickgasm.com',
    'Global': 'https://knickgasm.com'
  };
  const storeBase = storeUrlMap[market] || storeUrlMap['US'];

  const productsBlock = allProds.length > 0
    ? allProds.map((p, i) => {
        const handle = p.handle || p.h || '';
        const productUrl = handle ? (storeBase + '/products/' + handle) : (storeBase + '/collections/all');
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
    : '  (no products specified — derive appropriate KNICKGASM products from strategy and brief)';

  // Campaign name derived from brief — used as context header instead of a generic label
  const campaignName = brief
    ? brief.split(/[.!?\n]/)[0].trim().substring(0, 80)
    : ((strategy.strategy || 'KNICKGASM Campaign').substring(0, 60));

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
"Shop All" → ${storeBase}/collections/all
"Gift Sets" → ${storeBase}/collections/gift-sets
"Bestsellers" → ${storeBase}/collections/bestsellers
"Our Story" → ${storeBase}/pages/our-story
Unsubscribe → {{UNSUBSCRIBE_URL}}
Add UTM params to CTA links: ?utm_source=email&utm_medium=mailer&utm_campaign=knickgasm_studio

━━ PRODUCTS (with real prices, images & URLs — use these EXACTLY) ━━
${productsBlock}
Product system: ${(strategy.product_selection || {}).product_system || ''}
AOV logic: ${(strategy.product_selection || {}).aov_logic || ''}

PRODUCT CARD REQUIREMENT: For each product, show:
- Product image: use the Image URL from product data above (or IMAGE_PRODUCT_URL placeholder if not available)
- Star rating: ⭐ 4.8/5 · [realistic review count e.g. 70-200 reviews]
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
Preheader text (insert after <body> tag as hidden div): ${plan.preheader || subjectLines[0] || 'Premium Indian heritage sneakers, direct from source.'}

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
5. KNICKGASM Header (dark green #D0473E — bgcolor on all tds, 3-column: EST date · KNICKGASM® · SHOP ALL)
6. Trust badges bar (light chalk background, 4 trust signals: 🌿 Pure Indian Sneaker · ✦ Ethically Sourced · 🌱 Farm Direct · ★ 4.8/5)
7. All sections from the plan IN ORDER — each content-complete, bgcolor on every colored td
8. Social proof strip (⭐⭐⭐⭐⭐ rating + review count)
9. KNICKGASM Footer (dark green, logo + 4 nav links + unsubscribe/privacy + copyright)
10. </body></html>

CRITICAL: Every <td> with background color MUST have matching bgcolor="" attribute — non-negotiable for Outlook.
Every section must be content-complete — no section should consist of empty padding.
Product cards must include image, rating, name, description, price, and CTA.
Output starts <!DOCTYPE html>, ends </html>. Nothing before or after.`;

  try {
    const { text, provider, model, quota_warning, exhausted_keys } = await callLLM({
      systemPrompt: SYSTEM,
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
    const _MARKET_BASE = {
      US: 'https://knickgasm.com',
      UK: 'https://knickgasm.com',
      IN: 'https://knickgasm.com',
      Global: 'https://knickgasm.com',
      ME: 'https://knickgasm.com',
      AU: 'https://knickgasm.com',
      EU: 'https://knickgasm.com'
    };
    const _resolvedBase = _MARKET_BASE[market] || _MARKET_BASE.US;
    // 1) Substitute the template placeholder
    html = html.split('{{STORE_BASE}}').join(_resolvedBase);
    // 2) Defensive: if the LLM hard-coded a bad domain, rewrite to the market base
    html = html.replace(/https?:\/\/(?:www\.)?knickgasm\.com(?!\/cdn)/g, _resolvedBase);

    // ── BRAND FONTS — deterministically guarantee the exact KNICKGASM @font-face
    //    are present in <head>, regardless of LLM adherence (Brand Asset Engine).
    const _BRAND_FONTFACE = '<style>'
      + '@font-face{font-family:"Montserrat";src:url("https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w0aXp-p7K4KLjztg.woff2") format("woff2");}'
      + '@font-face{font-family:"Instrument Sans";src:url("https://fonts.gstatic.com/s/instrumentsans/v4/pximypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr-yp2JGEJOH9npSTF-Tf8kywN2u7ZWwUbNA.woff2") format("woff2");}'
      + '</style>';
    if (!/Montserrat-01\.ttf/.test(html) && /<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => m + _BRAND_FONTFACE);
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
    const heuristicStoreBase = storeBase || 'https://knickgasm.com';
    const heuristicShopUrl = heuristicStoreBase + '/collections/all?utm_source=email&utm_medium=mailer&utm_campaign=knickgasm_studio';
    const heuristicHeroProduct = clientProducts[0] || {};
    const heuristicHeroHandle = heuristicHeroProduct.handle || '';
    const heuristicHeroUrl = heuristicHeroHandle ? (heuristicStoreBase + '/products/' + heuristicHeroHandle + '?utm_source=email&utm_medium=mailer&utm_campaign=knickgasm_studio') : heuristicShopUrl;
    const heuristicHeroPrice = heuristicHeroProduct.price || '';
    const heuristicHeroCompare = heuristicHeroProduct.compare_at || '';

    const heroHeadline = (heroSection.copy || {}).headline || (heuristicHeroProduct.name ? heuristicHeroProduct.name : (isB ? 'A Ritual Worth Slowing Down For' : 'Premium Indian Heritage Sneakers'));
    const heroSubcopy = (heroSection.copy || {}).subcopy || (isB ? 'Where morning mist meets hand-painted leaves, a ritual begins.' : 'Discover one-of-one sneakers crafted with heritage and precision.');
    const heroCta = (heroSection.copy || {}).cta || (isB ? 'Discover the Origin' : 'Shop Now');
    const productName = (productSection.copy || {}).headline || ((strategy.product_selection || {}).hero || {}).name || (heuristicHeroProduct.name || 'KNICKGASM Signature Collection');
    const productCopy = (productSection.copy || {}).subcopy || 'Premium one-of-one sneaker, hand-painted at peak design.';
    const productCta = (productSection.copy || {}).cta || (isB ? 'Explore This Colorway' : 'Add to Cart');
    const offerHeadline = (offerSection.copy || {}).headline || (heuristicHeroPrice ? 'Get ' + heuristicHeroProduct.name + ' Now' : 'Free Shipping on Orders $50+');
    const offerSubcopy = (offerSection.copy || {}).subcopy || 'Shop now at knickgasm.com';
    const finalCta = (ctaSection.copy || {}).cta || (isB ? 'Explore the Collection' : 'Shop Now');
    const proofCopy = (proofSection.copy || {}).subcopy || '"Absolutely love the rich design and colorway. Best sneaker I\'ve ordered online." — Verified Buyer';
    const subjectLines = plan.subject_lines || [(isB ? 'A sneaker worth slowing down for' : heroHeadline)];
    const preheader = plan.preheader || 'Premium one-of-one sneakers, crafted for your ritual';

    const bgColor = isB ? '#D0473E' : '#FFFFFF';
    const textColor = isB ? '#FFFFFF' : '#D0473E';
    const accentColor = '#6A33D8';

    const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${heroHeadline}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
@font-face{font-family:"Montserrat";src:url("https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w0aXp-p7K4KLjztg.woff2") format("woff2");}
@font-face{font-family:"Instrument Sans";src:url("https://fonts.gstatic.com/s/instrumentsans/v4/pximypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr-yp2JGEJOH9npSTF-Tf8kywN2u7ZWwUbNA.woff2") format("woff2");}
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{mso-table-lspace:0;mso-table-rspace:0}
img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none;display:block}
body{margin:0;padding:0;width:100%!important;-webkit-font-smoothing:antialiased;font-family:"Instrument Sans","Helvetica Neue",Arial,sans-serif}
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
<body style="margin:0;padding:0;background:#FFFFFF" bgcolor="#FFFFFF">
<!-- PREHEADER -->
<div style="display:none;font-size:1px;color:#FFFFFF;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheader}</div>

<!-- OUTER WRAPPER -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFFFF" bgcolor="#FFFFFF"><tr><td align="center" style="padding:0">

<!-- ANNOUNCEMENT BAR -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${accentColor};padding:10px 20px;text-align:center;font-family:Arial,sans-serif;font-size:13px;color:#ffffff;letter-spacing:0.5px" bgcolor="${accentColor}">
✦ FREE SHIPPING ON ORDERS $50+ &nbsp;|&nbsp; CODE: HERITAGE
</td></tr>
</table>

<!-- HEADER -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:#D0473E;padding:16px 24px;text-align:center;font-family:Georgia,serif;font-size:12px;color:#a89f91;letter-spacing:2px" bgcolor="#D0473E">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="text-align:left;font-family:Arial,sans-serif;font-size:11px;color:#a89f91;letter-spacing:1px" class="mobile-hide">EST. 2015</td>
<td style="text-align:center"><img src="https://www.knickgasm.com/cdn/shop/files/logo-website_3.png?v=1756808809&width=310" alt="KNICKGASM" height="30" style="display:inline-block;border:0;height:30px;width:auto"></td>
<td style="text-align:right;font-family:Arial,sans-serif;font-size:11px;color:${accentColor};letter-spacing:1px" class="mobile-hide"><a href="${heuristicShopUrl}" style="color:${accentColor};text-decoration:none">SHOP ALL &rarr;</a></td>
</tr></table>
</td></tr>
</table>

<!-- TRUST BADGES -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:#FFFFFF;padding:10px 16px;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#6b6255;letter-spacing:0.3px" bgcolor="#FFFFFF">
&#127807; Pure Indian Sneaker &nbsp;&bull;&nbsp; ✦ Ethically Sourced &nbsp;&bull;&nbsp; &#127793; Farm Direct &nbsp;&bull;&nbsp; ★ 4.8/5
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
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#D0473E;padding:48px 40px;text-align:center" bgcolor="#D0473E">
<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:12px;color:${accentColor};letter-spacing:2px;text-transform:uppercase">${(heroSection.copy || {}).eyebrow || 'A STORY IN EVERY STEEP'}</p>
<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:32px;color:#FFFFFF;line-height:1.2;font-weight:normal">${heroHeadline}</h1>
<p style="margin:0 0 28px;font-family:Arial,sans-serif;font-size:15px;color:#c9bfb0;line-height:1.6;max-width:440px;margin-left:auto;margin-right:auto">${heroSubcopy}</p>
<a href="${heuristicHeroUrl}" style="display:inline-block;padding:14px 36px;font-family:Arial,sans-serif;font-size:13px;color:#FFFFFF;border:1px solid #FFFFFF;text-decoration:none;letter-spacing:1px">${heroCta}</a>
</td></tr></table>
` : `
<!-- VARIANT A: Split hero -->
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="col2" width="300" style="vertical-align:middle;background:${bgColor}" bgcolor="${bgColor}">
<img src="IMAGE_HERO_URL" alt="${heroHeadline}" width="300" class="hero-img" style="width:300px;height:auto;display:block">
</td>
<td class="col2" width="300" style="vertical-align:middle;background:${bgColor};padding:32px 28px" bgcolor="${bgColor}">
<p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:12px;color:${accentColor};letter-spacing:2px;text-transform:uppercase">${(heroSection.copy || {}).eyebrow || 'NEW ARRIVAL'}</p>
<h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:28px;color:#D0473E;line-height:1.2">${heroHeadline}</h1>
<p style="margin:0 0 24px;font-family:Arial,sans-serif;font-size:14px;color:#4a4540;line-height:1.6">${heroSubcopy}</p>
<a href="${heuristicHeroUrl}" style="display:inline-block;padding:14px 32px;background:${accentColor};font-family:Arial,sans-serif;font-size:13px;color:#ffffff;text-decoration:none;letter-spacing:0.5px;border-radius:2px">${heroCta}</a>
</td>
</tr></table>
`}
</td></tr>
</table>

<!-- BENEFIT STRIP -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${isB ? '#0a1f13' : '#ffffff'};padding:28px 20px;text-align:center" bgcolor="${isB ? '#0a1f13' : '#ffffff'}">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="col3" width="150" style="text-align:center;padding:8px;font-family:Arial,sans-serif;font-size:12px;color:${isB ? '#c9bfb0' : '#6b6255'};letter-spacing:0.5px">&#127807;<br>One-of-One</td>
<td class="col3" width="150" style="text-align:center;padding:8px;font-family:Arial,sans-serif;font-size:12px;color:${isB ? '#c9bfb0' : '#6b6255'};letter-spacing:0.5px">✦<br>Hand-Painted</td>
<td class="col3" width="150" style="text-align:center;padding:8px;font-family:Arial,sans-serif;font-size:12px;color:${isB ? '#c9bfb0' : '#6b6255'};letter-spacing:0.5px">&#127793;<br>Farm to Pair</td>
<td class="col3" width="150" style="text-align:center;padding:8px;font-family:Arial,sans-serif;font-size:12px;color:${isB ? '#c9bfb0' : '#6b6255'};letter-spacing:0.5px">★<br>Premium Heritage</td>
</tr></table>
</td></tr>
</table>

<!-- PRODUCT SECTION -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${isB ? '#D0473E' : '#ffffff'};padding:36px 24px;text-align:center" bgcolor="${isB ? '#D0473E' : '#ffffff'}">
${isB ? `<p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:12px;color:${accentColor};letter-spacing:2px;text-transform:uppercase">THE COLLECTION</p>` : ''}
<h2 style="margin:0 0 12px;font-family:Georgia,serif;font-size:24px;color:${textColor};line-height:1.3">${productName}</h2>
<img src="IMAGE_PRODUCT_URL" alt="${productName}" width="${isB ? 400 : 260}" style="width:${isB ? 400 : 260}px;height:auto;display:block;margin:16px auto;border-radius:4px">
<p style="margin:12px auto 20px;font-family:Arial,sans-serif;font-size:14px;color:${isB ? '#c9bfb0' : '#4a4540'};line-height:1.6;max-width:420px">${productCopy}</p>
<a href="${heuristicHeroUrl}" style="display:inline-block;padding:14px 32px;${isB ? 'border:1px solid #FFFFFF;color:#FFFFFF' : 'background:' + accentColor + ';color:#ffffff'};font-family:Arial,sans-serif;font-size:13px;text-decoration:none;letter-spacing:0.5px;border-radius:2px">${productCta}</a>
</td></tr>
</table>

<!-- SOCIAL PROOF -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${isB ? '#0a1f13' : '#FFFFFF'};padding:32px 36px;text-align:center" bgcolor="${isB ? '#0a1f13' : '#FFFFFF'}">
<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:14px;color:${accentColor}">★★★★★</p>
<p style="margin:0 0 8px;font-family:Georgia,serif;font-size:16px;color:${textColor};font-style:italic;line-height:1.5">${proofCopy}</p>
<p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:${isB ? '#8a8175' : '#8a8175'};letter-spacing:1px">15,000+ 5-STAR REVIEWS</p>
</td></tr>
</table>

<!-- LIFESTYLE IMAGE -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${isB ? '#D0473E' : '#ffffff'};padding:0" bgcolor="${isB ? '#D0473E' : '#ffffff'}">
<img src="IMAGE_LIFESTYLE_URL" alt="Sneaker lifestyle" width="600" style="width:600px;height:auto;display:block">
</td></tr>
</table>

<!-- OFFER BAR -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${accentColor};padding:24px 28px;text-align:center" bgcolor="${accentColor}">
<h3 style="margin:0 0 8px;font-family:Georgia,serif;font-size:20px;color:#ffffff">${offerHeadline}</h3>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:13px;color:#fff5eb">${offerSubcopy}</p>
<a href="${heuristicShopUrl}" style="display:inline-block;padding:12px 28px;background:#D0473E;font-family:Arial,sans-serif;font-size:13px;color:#FFFFFF;text-decoration:none;letter-spacing:0.5px;border-radius:2px">${(offerSection.copy || {}).cta || 'Shop the Collection'}</a>
</td></tr>
</table>

<!-- FINAL CTA -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:${bgColor};padding:36px 28px;text-align:center" bgcolor="${bgColor}">
<h3 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;color:${textColor}">${(ctaSection.copy || {}).headline || (isB ? 'Begin Your Ritual' : 'Shop KNICKGASM Today')}</h3>
<a href="${heuristicShopUrl}" style="display:inline-block;padding:16px 40px;${isB ? 'border:1px solid #FFFFFF;color:#FFFFFF' : 'background:' + accentColor + ';color:#ffffff'};font-family:Arial,sans-serif;font-size:14px;text-decoration:none;letter-spacing:0.5px;border-radius:2px">${finalCta}</a>
</td></tr>
</table>

<!-- FOOTER -->
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="background:#D0473E;padding:28px 24px;text-align:center" bgcolor="#D0473E">
<p style="margin:0 0 12px;font-family:Georgia,serif;font-size:18px;color:#FFFFFF;letter-spacing:2px">KNICKGASM&reg;</p>
<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:12px;color:#8a8175">
<a href="${heuristicStoreBase}/collections/all" style="color:${accentColor};text-decoration:none">Shop All</a> &nbsp;&bull;&nbsp;
<a href="${heuristicStoreBase}/pages/our-story" style="color:${accentColor};text-decoration:none">Our Story</a> &nbsp;&bull;&nbsp;
<a href="${heuristicStoreBase}/collections/gift-sets" style="color:${accentColor};text-decoration:none">Gifting</a> &nbsp;&bull;&nbsp;
<a href="${heuristicStoreBase}/pages/contact" style="color:${accentColor};text-decoration:none">Contact</a>
</p>
<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;color:#6b6255;line-height:1.5">
You received this email because you signed up at knickgasm.com<br>
<a href="{{UNSUBSCRIBE_URL}}" style="color:#8a8175;text-decoration:underline">Unsubscribe</a> &nbsp;|&nbsp; <a href="${heuristicStoreBase}/pages/privacy-policy" style="color:#8a8175;text-decoration:underline">Privacy Policy</a>
</p>
<p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#4a4540">&copy; 2026 KNICKGASM. All Rights Reserved.</p>
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
