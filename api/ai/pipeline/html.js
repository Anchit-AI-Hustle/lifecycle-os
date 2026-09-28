'use strict';
// ════════════════════════════════════════════════════════════════════════════
// /api/ai/pipeline/html  — Stage 4: AI HTML Email Builder
//
// Takes the locked variant plan (layout + sections + copy) from Stage 2 and
// the locked strategy from Stage 1 and produces a COMPLETE, table-based HTML
// email that follows the plan. Images are never sent through the model: the
// HTML carries the exact placeholder strings IMAGE_HERO_URL /
// IMAGE_PRODUCT_URL / IMAGE_LIFESTYLE_URL, which the client replaces with
// HOSTED urls (creative-image.js uploads a generated data URL and returns
// one). Not with the data URLs from Stage 3: a mailer that embeds base64 is
// blocked by its own contract (asset-contracts.js, email.mailer), because
// Gmail clips a message past roughly 102KB and most clients refuse to render
// base64 images at all.
//
// Gated, metered and brand-derived through api/_shared/pipeline-core.js since
// 2026-09-28 (see its header). Executing this stage for the first time found
// its own fallback painting two Variant B sections #0a1f13 - a dark neutral,
// the exact thing the design HARD rule forbids and asset-no-black-background
// could not see because this renderer was not on its list - and its section
// library carrying another category's proof lines as mandatory content. Both
// prompt and fallback are now built from tokens() so every ground is one the
// brand is allowed to paint and every text colour is derived for the ground
// it sits on.
//
// mailer_type: 'text' renders the TEXT type of the taxonomy (pure typographic,
// no image slots); anything else renders TEXT + GRAPHICS.
//
// POST body:  { variant, plan, strategy, brief, market?, audience?, products[],
//               mailer_type?, offer?, proof?, evidence?, regenerate_counter? }
// Response:   { ok, stage, variant, mailer_type, provider, model, html,
//               section_count, subject_lines, preheader, credits }
// ════════════════════════════════════════════════════════════════════════════

const P = require('../../_shared/pipeline-core.js');
const MF = require('../../_shared/mailer-format');
const brandRuntime = require('../../_shared/brand-runtime.js');

const W = P.MAILER.desktop.contentWidth;      // 600, read from the spec
const BODY_PX = P.MAILER.desktop.body.minFontPx;   // 15

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ── the prompt, built from this brand ──────────────────────────────────── */

function systemPrompt(ctx) {
  const b = ctx.brand;
  const t = ctx.tokens;
  const legal = ctx.legal;
  const text = ctx.mailerType === 'text';
  const logo = b.logo_url && !text
    ? `<img src="${b.logo_url}" alt="${esc(b.name)}" height="30" style="display:block;border:0;height:30px;width:auto">`
    : `<span style="font-family:${t.headingStack};font-size:22px;letter-spacing:.14em;color:${t.onSurface}">${esc(b.name)}</span>`;
  return `You are the HTML execution engine for ${b.name}'s email programme. You produce COMPLETE, conversion-optimised, email-client-safe HTML that implements the creative plan EXACTLY: no rewrites, no truncation, no invented content.

${ctx.briefing}

${text
    ? 'MAILER TYPE: TEXT. Pure typographic: NO <img> elements at all, no image placeholders. Weight, size, rules, colour bands and space carry the structure.'
    : `MAILER TYPE: TEXT + GRAPHICS. Photograph SLOTS use these EXACT placeholder strings as the src, which the client replaces with hosted urls: IMAGE_HERO_URL, IMAGE_PRODUCT_URL, IMAGE_LIFESTYLE_URL. Never a placeholder image service, never a data: url, never an invented url. Every <img> carries real alt text and width="${W}" or the cell width.`}

━━ RULES THAT OUTRANK EVERYTHING ELSE ━━
- NOTHING that was not supplied: no rating, star row, review count, units-sold line, testimonial, discount, code, shipping threshold, price or compare-at price unless it appears in the plan, the offer or the product data below. Where the structure needs one and none exists, write the DATA REQUIRED marker from the plan verbatim.
- Every section content-complete; no section that is only a headline and padding. Max 7 content sections. Max 3 products.
- Copy from the plan VERBATIM: do not paraphrase, shorten or "improve" a headline or a subcopy line.
- No em dashes or en dashes anywhere in the copy.

━━ HTML STRUCTURE (Outlook renders with the Word engine) ━━
- Table-based layout, ${W}px content column: <table width="${W}" class="email-container vh-m-container" ...> centred. No div layout, no flexbox, no grid, no JavaScript.
- Inline CSS on every element. The <head> <style> holds ONLY: the brand font import below, Outlook resets, and the responsive block.
- EVERY <td> with a CSS background also carries the matching bgcolor="" attribute. Outlook ignores the CSS.
- A CTA is a coloured CELL wrapping the link: <td class="btn" bgcolor="${t.accent}" style="background:${t.accent}"><a href="..." style="display:inline-block;padding:14px 32px;color:${t.onAccent};text-decoration:none;font-weight:700">LABEL</a></td>. Word paints the cell, not the anchor.
- Preheader immediately after <body>: <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">PREHEADER</div>
- Responsive block in <head>: ${P.MAILER.responsiveCss}
- Never href="#" on a CTA: every CTA points at the store url below. The footer's "Privacy Policy" and "Terms of Service" are plain labels with href="#" and no routing, and "Unsubscribe" points at {{UNSUBSCRIBE_URL}}.

━━ COLOUR AND TYPE (derived from the brand record; use ONLY these pairings) ━━
- Surface ground ${t.surface}: text ${t.onSurface}, muted text ${t.mutedOnSurface}, brand colour as text ${t.primaryAsText}, accent as text ${t.accentAsText}.
- Card ground ${t.surfaceAlt}: text ${t.onSurfaceAlt}.
- Primary band ${t.primary}: ALL text on it ${t.onPrimary} (never the accent on the primary; that pairing fails contrast).
- Accent fill on a CONTROL (a button) ${t.accent}: label ${t.onAccent}.
- Accent BAND (announcement bar, offer banner) ${t.accentBand}: text ${t.onAccentBand}. A band is a section, so it is never a dark neutral even when the control colour is.
- Never a black, near-black or dark-grey section background. Never text at reduced opacity. Never a colour outside this list.
- Headings ${t.headingStack}; body ${t.bodyStack}, ${BODY_PX}px or larger.
${t.fontImport ? `- Font import, verbatim, first in the <head> <style>: ${t.fontImport}` : '- No web font import: the brand record declares none, so use the stacks above as they are.'}

━━ SECTION LIBRARY (shape only; fill every bracket from the plan) ━━
HEADER: ${W}px table on ${t.surface}; centred ${logo}
ANNOUNCEMENT BAR (only if an offer was supplied): full-width cell on ${t.accentBand}, one line of ${t.onAccentBand} 13px bold uppercase text stating the supplied offer.
SPLIT HERO (Variant A): two cells of ${W / 2}px, class "vh-m-col", ${text ? 'copy in both cells (no image)' : 'image left (IMAGE_HERO_URL), copy right'}: eyebrow, <h1> in the heading face, subcopy, CTA cell.
FULL-BLEED HERO (Variant B): ${text ? '' : `IMAGE_HERO_URL at ${W}px wide, then `}a copy cell on ${t.primary}: eyebrow, <h1> at 40px, subcopy, ghost CTA (2px solid ${t.onPrimary} border, transparent fill, ${t.onPrimary} text).
BENEFIT STRIP: three or four "vh-m-col" cells on ${t.surfaceAlt}, one verifiable claim each (from the BRAND block only).
PRODUCT CARD: ${text ? '' : 'IMAGE_PRODUCT_URL, '}name, one-line description from the plan, supplied price (and struck-through compare-at only if supplied), CTA cell. No rating row, no urgency line.
PROOF: the supplied quote in the heading face, author only if supplied; with no proof supplied the section is the DATA REQUIRED marker in muted text.
OFFER BANNER (only if an offer was supplied): cell on ${t.accentBand}, headline and terms in ${t.onAccentBand}, ghost CTA.
CLOSING CTA: cell on ${t.surface} with the CTA cell.
FOOTER: cell on ${t.primary}, ${t.onPrimary} text at full opacity: "${esc(b.name)}", the legal sender line "${esc(legal.name)}, ${esc(legal.address)}", Unsubscribe · Privacy Policy · Terms of Service, and "© ${new Date().getFullYear()} ${esc(legal.name)}".

━━ FINAL CHECKLIST (fix inline before answering) ━━
- No text truncated; every plan headline and subcopy is complete.
- ${text ? 'No <img> anywhere.' : 'IMAGE_HERO_URL / IMAGE_PRODUCT_URL / IMAGE_LIFESTYLE_URL present as exact strings for the slots the plan uses.'}
- At least two CTAs (hero and closing). Every coloured <td> has bgcolor. Preheader present. Responsive block present.
- No leftover [BRACKET PLACEHOLDERS] except DATA REQUIRED markers. No invented figure anywhere.

━━ OUTPUT ━━
Return ONLY the complete HTML document. Start with <!DOCTYPE html>, end with </html>. No markdown fences, no commentary.`;
}

function userMessage(ctx, o) {
  const plan = o.plan;
  const strategy = o.strategy;
  const t = ctx.tokens;
  const sections = Array.isArray(plan.sections) ? plan.sections : [];
  const layout = plan.layout_plan || {};
  const cf = plan.copy_framework || {};
  const imageReqs = Array.isArray(plan.image_requirements) ? plan.image_requirements : [];
  const subjectLines = Array.isArray(plan.subject_lines) ? plan.subject_lines : [];
  const lock = strategy.strategic_lock || {};
  const structure = strategy.structure || {};
  const store = ctx.store;

  const sectionSpec = sections.map((s, i) => {
    const c = s.copy || {};
    return [
      `SECTION ${i + 1}: ${String(s.id || 'section').toUpperCase()}`,
      `  Type: ${s.type || 'centered'}`,
      `  Purpose: ${s.purpose || ''}`,
      `  Image slot: ${ctx.mailerType === 'text' ? 'none' : (s.image_slot || 'none')}`,
      `  Eyebrow: "${c.eyebrow || ''}"`,
      `  Headline: "${c.headline || ''}"   (verbatim, do not truncate)`,
      `  Subcopy: "${c.subcopy || ''}"   (verbatim, full sentence)`,
      `  CTA: "${c.cta || ''}"`,
      `  Layout: ${s.layout || ''}`,
      `  UX intent: ${s.ux_intent || ''}`,
    ].join('\n');
  }).join('\n\n');

  const imageSpec = ctx.mailerType === 'text'
    ? '  none (TEXT mailer)'
    : (imageReqs.map((r) => `  ${r.slot || 'hero'}: IMAGE_${String(r.slot || 'hero').toUpperCase()}_URL`).join('\n')
      || '  hero: IMAGE_HERO_URL\n  product: IMAGE_PRODUCT_URL\n  lifestyle: IMAGE_LIFESTYLE_URL');

  const offer = o.offer ? `OFFER (supplied; the only offer that exists): ${JSON.stringify(o.offer)}` : 'OFFER: none supplied. Write no discount, code or shipping threshold, and render no announcement bar or offer banner.';
  const proof = (o.proof && o.proof.length)
    ? `PROOF (supplied verbatim; quote exactly): ${JSON.stringify(o.proof)}`
    : `PROOF: none supplied. The proof section is ${P.marker('approved review', ((strategy.product_selection || {}).hero || {}).name || ctx.brand.name, ctx.market)} in muted text.`;

  return `━━ BUILD VARIANT ${o.variant} HTML EMAIL (${ctx.mailerType === 'text' ? 'TEXT' : 'TEXT + GRAPHICS'}) ━━
CAMPAIGN: ${o.brief ? o.brief.split(/[.!?\n]/)[0].trim().substring(0, 80) : (strategy.strategy || `${ctx.brand.name} campaign`).substring(0, 60)}
MARKET: ${ctx.market || P.marker('home market', ctx.brand.name)}
${o.audience ? `TARGET USER SEGMENT (write FOR this person; every line, every CTA speaks to them):\n${o.audience}\n` : ''}STRATEGY TYPE: ${strategy.strategy_type || ''}
STRATEGY: ${strategy.strategy || ''}
VARIANT: ${o.variant} - ${o.variant === 'B'
    ? `EXPERIMENTAL: story first, editorial, no product in the first two sections, sensory copy, ghost CTA, generous padding, opening sections on ${t.primary}`
    : `CONTROL: product first, benefit-led, filled accent CTA, structured conversion layout, opening sections on ${t.surface}`}
${o.regen > 0 ? `REGENERATE #${o.regen}: vary padding, section grounds within the allowed pairings and headline emphasis; keep the structure.` : ''}

━━ STRATEGIC LOCK ━━
Audience truth: ${lock.audience_truth || ''}
Business goal: ${lock.business_goal || ''}
Conversion trigger: ${lock.conversion_trigger || ''}

━━ THEME ━━
${JSON.stringify(strategy.theme || {}, null, 2)}

━━ VIBE ━━
${JSON.stringify(strategy.vibe || {}, null, 2)}

━━ LOCKED STRUCTURE ━━
Sections: ${(structure.sections || []).join(' → ') || '(the sections below)'}
Layout rules: ${structure.layout_rules || ''}
Visual system: ${JSON.stringify(structure.visual_system || {}, null, 2)}

━━ STORE AND LINKS ━━
Store base url: ${store.url || store.marker}
Every CTA links to a real url from the product data below or to the store base; never href="#" on a CTA.
Unsubscribe → {{UNSUBSCRIBE_URL}}
Add to CTA links: ?utm_source=email&utm_medium=mailer&utm_campaign=${encodeURIComponent(ctx.brand.slug || 'pipeline')}

━━ PRODUCTS (the only ones that exist; use their names, prices and urls exactly) ━━
${P.productLines(o.products, ctx, { max: 8 })}
Product system: ${(strategy.product_selection || {}).product_system || ''}

${offer}
${proof}

━━ LAYOUT PLAN ━━
Flow: ${layout.flow || ''}
Spacing: ${layout.spacing || '24-32px section padding; no section that is mostly empty'}
Hero layout: ${layout.hero || ''}

━━ COPY FRAMEWORK ━━
Tone: ${cf.tone || ''} · Voice: ${cf.voice || ''} · Headline style: ${cf.headline_style || ''} · CTA verb: ${cf.cta_verb || 'Shop'}

━━ SUBJECT LINES (reference only) ━━
${subjectLines.join(' | ') || '(none)'}
Preheader (hidden div after <body>): ${plan.preheader || subjectLines[0] || ''}

━━ IMAGE SLOTS ━━
${imageSpec}

━━ SECTIONS TO IMPLEMENT (in this exact order) ━━
${sectionSpec || `(no sections provided: build ${o.variant === 'B' ? '6' : '5'} content sections for Variant ${o.variant} from the plan and the products)`}

Build the HTML now. Start with <!DOCTYPE html>, end with </html>. Nothing before or after.`;
}

/* ── the mailer the app builds itself, when no model answers ───────────── */

/**
 * Brand-derived, gate-safe, and honest about gaps. Every ground is one of
 * tokens() (surface, surfaceAlt, primary, accent) and every text colour was
 * derived for the ground it sits on, so the rendered no-black-background and
 * AA gates hold for any brand record - including one whose primary is near
 * black, where the "dark" band becomes the accent or the surface.
 */
function heuristicHtml(ctx, o) {
  const b = ctx.brand;
  const t = ctx.tokens;
  const store = ctx.store;
  const legal = ctx.legal;
  const isB = o.variant === 'B';
  const text = ctx.mailerType === 'text';
  const plan = o.plan;
  const strategy = o.strategy;
  const sections = Array.isArray(plan.sections) ? plan.sections : [];
  const find = (...ids) => sections.find((s) => s && ids.includes(s.id)) || {};
  const copyOf = (s) => (s && s.copy) || {};

  const heroSection = find('hero', 'narrative');
  const productSection = find('product_reveal');
  const offerSection = find('offer_bar');
  const ctaSection = find('cta');
  const proofSection = find('social_proof');

  const heroProduct = (o.products && o.products[0]) || {};
  const heroName = String(copyOf(productSection).headline
    || ((strategy.product_selection || {}).hero || {}).name
    || heroProduct.name || heroProduct.n
    || P.marker('hero product', b.name, ctx.market));
  const heroHandle = heroProduct.handle || heroProduct.h || '';
  const utm = `?utm_source=email&utm_medium=mailer&utm_campaign=${encodeURIComponent(b.slug || 'pipeline')}`;
  const shopUrl = P.linkFor(store, utm);
  const pdpUrl = heroHandle ? P.linkFor(store, `/products/${encodeURIComponent(heroHandle)}${utm}`) : shopUrl;
  const currency = store.currency || '';
  const price = (heroProduct.price != null && heroProduct.price !== '') ? `${currency}${heroProduct.price}` : '';
  const compare = (heroProduct.compare_at != null && heroProduct.compare_at !== '') ? `${currency}${heroProduct.compare_at}` : '';

  const heroHeadline = String(copyOf(heroSection).headline || ((strategy.theme || {}).name) || heroName);
  const heroEyebrow = String(copyOf(heroSection).eyebrow || b.tagline || b.name);
  const heroSubcopy = String(copyOf(heroSection).subcopy || (isB ? `A closer look at ${heroName}, in the setting it was made for.` : `${heroName} from ${b.name}: what it is, and why it fits right now.`));
  const heroCta = String(copyOf(heroSection).cta || (isB ? 'See the story' : 'See it now'));
  const productCopy = String(copyOf(productSection).subcopy || ((strategy.product_selection || {}).hero || {}).why || `Made by ${b.name}.`);
  const productCta = String(copyOf(productSection).cta || (isB ? 'Explore it' : 'Add to cart'));
  const finalHeadline = String(copyOf(ctaSection).headline || (isB ? `More from ${b.name}` : `Shop ${b.name}`));
  const finalCta = String(copyOf(ctaSection).cta || (isB ? 'Explore the range' : 'Shop now'));
  const claims = Array.isArray(b.claims) ? b.claims.filter(Boolean).slice(0, 4) : [];
  const proof = (o.proof && o.proof[0]) || null;
  const offer = o.offer || null;
  const offerHeadline = offer ? String(copyOf(offerSection).headline || offer.headline || offer.label || '') : '';
  const offerDetail = offer ? String(copyOf(offerSection).subcopy || offer.detail || offer.terms || '') : '';

  const subjectLines = (Array.isArray(plan.subject_lines) && plan.subject_lines.length ? plan.subject_lines : [heroHeadline]).map((s) => String(s).substring(0, 60));
  let preheader = String(plan.preheader || b.tagline || `${heroName} from ${b.name}, with the details that matter`).substring(0, 90);
  // The preheader extends the subject; a copy of it wastes the inbox's second line.
  if (preheader.trim().toLowerCase() === String(subjectLines[0]).trim().toLowerCase()) preheader = `${heroName} from ${b.name}, with the details that matter`.substring(0, 90);

  const H = t.headingStack;
  const F = t.bodyStack;
  const pad = 'padding:28px 32px';

  const section = (bg, inner, style) =>
    `<table role="presentation" class="email-container vh-m-container" width="${W}" cellpadding="0" cellspacing="0" border="0" align="center" style="width:${W}px;max-width:${W}px;margin:0 auto;background:${bg}" bgcolor="${bg}">`
    + `<tr><td class="vh-m-pad" style="background:${bg};${style || pad}" bgcolor="${bg}">${inner}</td></tr></table>`;
  const button = (url, label, fill, fg) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>`
    + `<td class="btn vh-m-btn" bgcolor="${fill}" style="background:${fill};border-radius:3px;text-align:center">`
    + `<a href="${esc(url)}" style="display:inline-block;padding:14px 32px;font-family:${F};font-size:${BODY_PX}px;line-height:18px;font-weight:700;letter-spacing:.04em;color:${fg};text-decoration:none">${esc(label)}</a></td></tr></table>`;
  const ghost = (url, label, fg) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>`
    + `<td class="btn vh-m-btn" style="border:2px solid ${fg};border-radius:3px;text-align:center">`
    + `<a href="${esc(url)}" style="display:inline-block;padding:12px 30px;font-family:${F};font-size:${BODY_PX}px;line-height:18px;font-weight:700;letter-spacing:.04em;color:${fg};text-decoration:none">${esc(label)}</a></td></tr></table>`;
  const img = (src, alt, w) =>
    `<img src="${src}" alt="${esc(alt)}" width="${w}" class="vh-m-img" style="display:block;border:0;width:${w}px;max-width:100%;height:auto">`;
  const p = (txt, fg, size, extra) => `<p style="margin:0 0 14px;font-family:${F};font-size:${size || BODY_PX}px;line-height:1.6;color:${fg};${extra || ''}">${txt}</p>`;
  const eyebrow = (txt, fg) => `<p style="margin:0 0 8px;font-family:${F};font-size:13px;line-height:1.4;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${fg}">${esc(txt)}</p>`;

  const header = section(t.surface,
    (b.logo_url && !text)
      ? `<img src="${esc(b.logo_url)}" alt="${esc(b.name)}" height="30" style="display:block;margin:0 auto;border:0;height:30px;width:auto">`
      : `<p style="margin:0;font-family:${H};font-size:22px;line-height:1.3;letter-spacing:.14em;text-transform:uppercase;color:${t.onSurface};text-align:center">${esc(b.name)}</p>`,
    'padding:18px 32px;text-align:center');

  // A band, not a control: the accent goes through sectionGround here.
  const announcement = offer
    ? section(t.accentBand, `<p style="margin:0;font-family:${F};font-size:13px;line-height:1.5;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${t.onAccentBand};text-align:center">${esc(offerHeadline)}</p>`, 'padding:10px 20px')
    : '';

  let hero;
  if (isB) {
    const copyCell = `${eyebrow(heroEyebrow, t.onPrimary)}`
      + `<h1 style="margin:0 0 16px;font-family:${H};font-size:40px;line-height:1.1;font-weight:400;color:${t.onPrimary}">${esc(heroHeadline)}</h1>`
      + p(esc(heroSubcopy), t.onPrimary, 16, 'max-width:440px;margin-left:auto;margin-right:auto')
      + ghost(pdpUrl, heroCta, t.onPrimary);
    hero = (text ? '' : section(t.primary, img('IMAGE_HERO_URL', heroHeadline, W), 'padding:0'))
      + section(t.primary, copyCell, 'padding:48px 40px;text-align:center');
  } else {
    const copy = `${eyebrow(heroEyebrow, t.accentAsText)}`
      + `<h1 style="margin:0 0 14px;font-family:${H};font-size:28px;line-height:1.2;font-weight:700;color:${t.primaryAsText}">${esc(heroHeadline)}</h1>`
      + p(esc(heroSubcopy), t.onSurface)
      + button(pdpUrl, heroCta, t.accent, t.onAccent);
    hero = text
      ? section(t.surface, copy, 'padding:36px 32px')
      : section(t.surface,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`
        + `<td class="vh-m-col" width="${W / 2}" valign="middle" style="vertical-align:middle;padding:0;background:${t.surface}" bgcolor="${t.surface}">${img('IMAGE_HERO_URL', heroHeadline, W / 2)}</td>`
        + `<td class="vh-m-col vh-m-pad" width="${W / 2}" valign="middle" style="vertical-align:middle;padding:28px 24px;background:${t.surface}" bgcolor="${t.surface}">${copy}</td>`
        + `</tr></table>`, 'padding:0');
  }

  const claimCells = (claims.length ? claims : [P.marker('verifiable claims', b.name, ctx.market)])
    .map((c) => `<td class="vh-m-col" valign="top" style="padding:8px 10px;text-align:center;font-family:${F};font-size:13px;line-height:1.5;font-weight:700;color:${t.onSurfaceAlt};background:${t.surfaceAlt}" bgcolor="${t.surfaceAlt}">${esc(c)}</td>`)
    .join('');
  const benefits = section(t.surfaceAlt, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${claimCells}</tr></table>`, 'padding:20px 16px');

  const lifestyle = text ? '' : section(isB ? t.primary : t.surface, img('IMAGE_LIFESTYLE_URL', `${b.name}: ${heroName}`, W), 'padding:0');

  const priceLine = price
    ? p(`<strong>${esc(price)}</strong>${compare ? ` <span style="text-decoration:line-through">${esc(compare)}</span>` : ''}`, isB ? t.onPrimary : t.onSurface, 16)
    : '';
  const productInner = (isB ? eyebrow(String(copyOf(productSection).eyebrow || 'The product'), t.onPrimary) : '')
    + `<h2 style="margin:0 0 12px;font-family:${H};font-size:24px;line-height:1.3;font-weight:${isB ? 400 : 700};color:${isB ? t.onPrimary : t.primaryAsText}">${esc(heroName)}</h2>`
    + (text ? '' : `<div style="margin:0 auto 16px;width:${isB ? 400 : 260}px;max-width:100%">${img('IMAGE_PRODUCT_URL', heroName, isB ? 400 : 260)}</div>`)
    + priceLine
    + p(esc(productCopy), isB ? t.onPrimary : t.onSurface, BODY_PX, 'max-width:420px;margin-left:auto;margin-right:auto')
    + (isB ? ghost(pdpUrl, productCta, t.onPrimary) : button(pdpUrl, productCta, t.accent, t.onAccent));
  const product = section(isB ? t.primary : t.surface, productInner, 'padding:36px 32px;text-align:center');

  const proofInner = proof
    ? `<p style="margin:0 0 8px;font-family:${H};font-size:18px;line-height:1.5;font-style:italic;color:${t.onSurface}">&ldquo;${esc(String(proof.text || proof).replace(/[—–]/g, ', '))}&rdquo;</p>`
      + (proof.author ? p(esc(String(proof.author).replace(/[—–]/g, ', ')), t.mutedOnSurface, 13) : '')
    : p(esc(P.marker('approved review', heroName, ctx.market)), t.mutedOnSurface, 13);
  const proofBlock = section(t.surface, proofInner, 'padding:28px 36px;text-align:center');

  const offerBar = offer
    ? section(t.accentBand,
      `<h3 style="margin:0 0 8px;font-family:${H};font-size:20px;line-height:1.3;color:${t.onAccentBand}">${esc(offerHeadline)}</h3>`
      + (offerDetail ? p(esc(offerDetail), t.onAccentBand, 14) : '')
      + ghost(shopUrl, String(copyOf(offerSection).cta || 'See the offer'), t.onAccentBand),
      'padding:24px 28px;text-align:center')
    : '';

  const closing = section(t.surface,
    `<h3 style="margin:0 0 16px;font-family:${H};font-size:22px;line-height:1.3;color:${t.primaryAsText}">${esc(finalHeadline)}</h3>`
    + button(shopUrl, finalCta, t.accent, t.onAccent),
    'padding:32px 28px;text-align:center');

  const link = (href, label) => `<a href="${esc(href)}" style="font-family:${F};font-size:12px;color:${t.onPrimary};text-decoration:underline">${esc(label)}</a>`;
  const footer = section(t.primary,
    `<p style="margin:0 0 10px;font-family:${H};font-size:16px;line-height:1.3;letter-spacing:.12em;text-transform:uppercase;color:${t.onPrimary}">${esc(b.name)}</p>`
    + p(`${esc(legal.name)}, ${esc(legal.address)}`, t.onPrimary, 12)
    + `<p style="margin:0 0 10px;font-family:${F};font-size:12px;line-height:1.6;color:${t.onPrimary}">${link('{{UNSUBSCRIBE_URL}}', 'Unsubscribe')} &nbsp;&middot;&nbsp; ${link('#', 'Privacy Policy')} &nbsp;&middot;&nbsp; ${link('#', 'Terms of Service')}</p>`
    + p(`&copy; ${new Date().getFullYear()} ${esc(legal.name)}. All rights reserved.`, t.onPrimary, 11, 'margin:0'),
    'padding:28px 24px;text-align:center');

  const order = isB
    ? [header, hero, lifestyle, benefits, product, proofBlock, offerBar, closing, footer]
    : [announcement, header, hero, benefits, product, proofBlock, lifestyle, offerBar, closing, footer];

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${esc(subjectLines[0])}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
${t.fontImport ? t.fontImport + '\n' : ''}body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{mso-table-lspace:0;mso-table-rspace:0;border-collapse:collapse}
img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none;display:block}
body{margin:0;padding:0;width:100%!important;-webkit-font-smoothing:antialiased;font-family:${F}}
${P.MAILER.responsiveCss}
</style>
</head>
<body style="margin:0;padding:0;background:${t.surface}" bgcolor="${t.surface}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.surface}" bgcolor="${t.surface}"><tr><td align="center" style="padding:0;background:${t.surface}" bgcolor="${t.surface}">
${order.filter(Boolean).join('\n')}
</td></tr></table>
</body>
</html>`;

  return {
    html: brandRuntime.scrubHtmlForBrand(html, b),
    subjectLines,
    preheader,
    sectionCount: order.filter(Boolean).length,
  };
}

/* ── handler ────────────────────────────────────────────────────────────── */

async function handler(req, res) {
  const ctx = await P.admit(req, res);
  if (!ctx) return;
  const body = ctx.body;
  const o = {
    variant: String(body.variant || 'A').toUpperCase() === 'B' ? 'B' : 'A',
    plan: (body.plan && typeof body.plan === 'object') ? body.plan : {},
    strategy: (body.strategy && typeof body.strategy === 'object') ? body.strategy : {},
    brief: String(body.brief || '').substring(0, 500),
    audience: String(body.audience || (body.strategy && body.strategy.audience) || '').substring(0, 500),
    products: Array.isArray(body.products) ? body.products : [],
    offer: (body.offer && typeof body.offer === 'object') ? body.offer : null,
    proof: Array.isArray(body.proof) ? body.proof : [],
    regen: Number(body.regenerate_counter) || 0,
  };
  ctx.tokens = P.tokens(ctx.brand);
  ctx.store = P.storeFor(ctx.brand, ctx.market);
  ctx.currency = ctx.store.currency;
  ctx.legal = P.legalFor(ctx.brand);
  ctx.briefing = P.briefing(ctx, 'email.mailer');

  const plan = o.plan;
  const subjectLines = Array.isArray(plan.subject_lines) ? plan.subject_lines : [];
  const sections = Array.isArray(plan.sections) ? plan.sections : [];

  try {
    const { text, provider, model, quota_warning, exhausted_keys } = await P.llm({
      systemPrompt: systemPrompt(ctx),
      userMessage: userMessage(ctx, o),
      responseFormat: null,    // HTML output, not JSON
      maxTokens: 10000,
      temperature: 0.3 + Math.min(0.15, o.regen * 0.05),
      timeoutMs: 80000,        // 80s internal; vercel maxDuration 90s (10s headroom)
      stage: 'html-' + o.variant + '[regen=' + o.regen + ']',
      tier: 'premium',
      userGeminiKey: ctx.userGeminiKey,
    });

    let html = String(text || '').trim();
    html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    // The store placeholder resolves to THIS brand's store for THIS market; a
    // brand with none on record gets the marker, never another brand's domain.
    html = html.split('{{STORE_BASE}}').join(ctx.store.url || ctx.store.marker);
    // The brand's own banned phrases and dashes, as a last net.
    html = brandRuntime.scrubHtmlForBrand(html, ctx.brand);
    // The brand's font import, guaranteed regardless of model adherence.
    if (ctx.tokens.fontImport && !html.includes(ctx.tokens.fontImport) && /<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => m + '<style>' + ctx.tokens.fontImport + '</style>');
    }

    if (!html || html.length < 600) {
      return res.status(502).json({
        ok: false, error: 'html_too_short', variant: o.variant, provider,
        message: 'The model returned fewer than 600 characters, which is a refusal or a truncation, not a mailer.',
        raw: html.substring(0, 300),
      });
    }
    if (!/<table/i.test(html) && !/<!doctype/i.test(html)) {
      throw new Error('html_invalid_structure: the model response has no <table> or <!DOCTYPE>; using the heuristic fallback');
    }
    if (!/<\/html>/i.test(html)) {
      throw new Error('html_truncated: the model output (' + html.length + ' chars) has no </html>; using the heuristic fallback');
    }
    if (ctx.mailerType !== 'text') {
      const missing = ['IMAGE_HERO_URL', 'IMAGE_PRODUCT_URL', 'IMAGE_LIFESTYLE_URL'].filter((s) => !html.includes(s));
      if (missing.length === 3) {
        return res.status(502).json({
          ok: false, error: 'html_missing_images', variant: o.variant, provider,
          message: 'The HTML carries none of the image placeholders, so the client cannot place the hosted images.',
          missing,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      stage: 'html',
      variant: o.variant,
      mailer_type: ctx.mailerType,
      provider,
      model,
      html: MF.withSubjectMeta(html, { subject: subjectLines[0], alts: subjectLines.slice(1, 3), preheader: plan.preheader || '' }),
      section_count: sections.length,
      subject_lines: subjectLines,
      preheader: plan.preheader || '',
      ...(quota_warning ? { quota_warning: true, exhausted_keys } : {}),
    });
  } catch (e) {
    console.warn('[html] All providers failed for variant ' + o.variant + ' - using heuristic HTML fallback');
    const built = heuristicHtml(ctx, o);
    return res.status(200).json({
      ok: true,
      stage: 'html',
      variant: o.variant,
      mailer_type: ctx.mailerType,
      provider: 'heuristic',
      model: 'fallback-v2',
      html: MF.withSubjectMeta(built.html, { subject: built.subjectLines[0], alts: built.subjectLines.slice(1, 3), preheader: built.preheader }),
      _heuristic: true,
      _llm_error: String(e.message || e).substring(0, 200),
      section_count: built.sectionCount,
      subject_lines: built.subjectLines,
      preheader: built.preheader,
    });
  }
}

module.exports = P.mount(handler, 'mailer.generate');
