'use strict';
/**
 * image-prompt.js — the visual brief for a generated image, built from the BRAND.
 * ---------------------------------------------------------------------------
 * api/ai/image.js used to hold five hardcoded preambles, each naming one
 * tenant, its four hex colours and its product category:
 *
 *   "Photoreal product lifestyle photograph for <TENANT> premium sneaker brand
 *    ... deep-purple #D0473E, lava #6A33D8, chalk #FFFFFF ... a freshly crafted
 *    pair of kicks with rising steam, loose sneaker panels ..."
 *
 * Every brand on the platform got that. A publisher asking for a hero image for
 * a markets briefing received a photograph of sneakers in another company's
 * palette, and it looked deliberate, because it was: it was deliberately wrong.
 *
 * Everything brand-shaped is now derived:
 *
 *   palette      the brand's own colours, named by ROLE so the model can use
 *                them correctly rather than being handed four bare hexes
 *   typography   the brand's own families
 *   subject      chosen from what the brand actually SELLS. A store gets a
 *                product stage; a publisher gets an editorial scene; an event
 *                brand gets a venue. Nobody gets someone else's category.
 *
 * WHAT IS NOT DERIVED, on purpose. The anti-fabrication rules are constant for
 * every brand and every mode: no text, no logos, no readable lettering on
 * packaging, no invented ratings or claims. A generated image is the easiest
 * place in the whole product to fabricate a fact - a model will happily render
 * an award badge or a "4.9 stars" burst that no brand ever earned - so those
 * rules are not the brand's to relax.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const MODES = ['photo', 'design', 'ad', 'ambient', 'reels'];

/** Colour roles, described rather than dumped, so the model places them well. */
function paletteBrief(brand) {
  const p = (brand && brand.palette) || {};
  const parts = [];
  if (p.primary) parts.push(`${p.primary} primary (dominant brand colour, and the fill for any primary action)`);
  if (p.accent) parts.push(`${p.accent} accent (highlights, rules and small emphasis only)`);
  if (p.surface) parts.push(`${p.surface} surface (the light ground)`);
  if (p.ink) parts.push(`${p.ink} ink (text and fine detail)`);
  if (!parts.length) return 'No brand palette has been supplied, so use a restrained neutral scheme and no invented brand colours.';
  return `Use ONLY these brand colours, in these roles: ${parts.join('; ')}.`;
}

function typographyBrief(brand) {
  const t = (brand && brand.typography) || {};
  const h = t.heading && t.heading.family;
  const b = t.body && t.body.family;
  if (!h && !b) return '';
  return `Where type appears it is ${h ? `${h} for headlines` : 'a single restrained display face'}${b ? ` and ${b} for supporting lines` : ''}.`;
}

/**
 * What the brand sells decides what the picture IS.
 *
 * This is the difference between a usable asset and an embarrassing one: a
 * newspaper does not have packaging, an event does not have a product shot, and
 * a service brand's hero is the work rather than an object on a table.
 */
const playbooks = require('./asset-playbooks.js');

function subjectFor(brand) {
  const offs = (brand && Array.isArray(brand.offerings) && brand.offerings) || [];
  const kinds = new Set(offs.map((o) => o && o.kind).filter(Boolean));
  const cs = (brand && brand.catalog_source) || {};
  if (cs.kind && cs.kind !== 'none' && cs.kind !== 'manual') kinds.add('product');
  const industry = (brand && brand.industry) ? String(brand.industry) : '';
  const ctx = industry ? ` The brand operates in ${industry}.` : '';

  const model = playbooks.businessModel(brand);

  if (model === 'market_data') {
    return {
      scene: `a high-end financial intelligence editorial or conceptual still: an authentic trading environment, financial district architecture at dusk, or sleek abstract data geometry in the brand's palette.${ctx} No product, no packaging, no merchandise, and NO fake charts or tickers.`,
      ambient: 'a sophisticated dark or slate terminal backdrop with subtle mathematical grid texture, generous negative space for live financial charts or headline overlays, and NO product.',
      caution: 'NEVER render fake candlestick charts, fabricated ticker symbols, synthetic percentage gains (+300%), or made-up prices. Any data visualization must come from real supplied numbers, never generated. All screens in frame must show abstract light texture with no readable numbers.',
    };
  }

  if (model === 'news_media') {
    return {
      scene: `an editorial documentary photograph or journalistic still appropriate to this publication's domain (e.g. city hall, port terminal, newsroom atmosphere, or reading moment).${ctx} No product, no packaging, no merchandise.`,
      ambient: 'a clean, dignified editorial backdrop with generous white space for headline and lead copy, and no product of any kind.',
      caution: 'NEVER render fake breaking news banners, simulated headlines, or synthetic politicians/people. Any paper, document, or screen must have illegible texture, not readable words.',
    };
  }

  if (kinds.has('product')) {
    return {
      scene: `a photoreal lifestyle scene staging the kind of product this brand sells, on a real surface with natural light and shallow depth of field.${ctx}`,
      ambient: 'an atmospheric scene in the brand\'s world with NO product and NO packaging in frame, since the real product photograph is composited separately.',
      caution: 'Any packaging in frame carries NO readable lettering: keep labels out of focus, angled away, or out of frame entirely.',
    };
  }
  if (kinds.has('section') || kinds.has('programme')) {
    return {
      scene: `an editorial photograph or restrained conceptual still for a content brand: a reading, working or listening moment that suits the subject.${ctx} No product, no packaging, no merchandise.`,
      ambient: 'a quiet editorial backdrop with generous empty space for a headline, and no product of any kind.',
      caution: 'Never render a newspaper, screen or page with readable text: any implied copy must be illegible texture, not words.',
    };
  }
  if (kinds.has('event')) {
    return {
      scene: `a venue or gathering scene appropriate to this brand's events: the space, the light and the anticipation, shot editorially.${ctx}`,
      ambient: 'an empty venue or setting before the event, with room for a date and headline to be laid over it.',
      caution: 'No signage, banners or screens carrying readable text; no crowd faces in sharp focus.',
    };
  }
  if (kinds.has('service')) {
    return {
      scene: `the work itself: hands, tools, materials and the craft this brand performs, shot close and warm.${ctx} The outcome, not a boxed object.`,
      ambient: 'the workspace with no person and no finished piece in frame, lit for a headline overlay.',
      caution: 'No branded workwear, no readable signage, no invented certificates or awards.',
    };
  }
  return {
    scene: `a restrained lifestyle scene that suits this brand without inventing a product for it.${ctx}`,
    ambient: 'a clean, uncluttered backdrop with generous negative space and no product in frame.',
    caution: 'Invent nothing the brand has not supplied: no product forms, no packaging, no signage.',
  };
}

/**
 * Constant for every brand. A generated image is the easiest place in the
 * product to fabricate a fact, so this is not the brand's to soften.
 *
 * THE REALITY RULE. The first list covers things that would be *invented* -
 * a rating nobody gave, a certification nobody issued. The second covers a
 * subtler failure: things that are real, and therefore must be PHOTOGRAPHED
 * rather than generated. A model's rendering of a brand's actual packaging is
 * a plausible fake of a real object, and a generated "customer" is a person
 * who does not exist presented as one who does. Both are fabrications even
 * though neither is an invented statistic, and a generator asked for one will
 * always produce something rather than refuse.
 *
 * The remedy is the one this repo uses everywhere else: emit the gap instead
 * of filling it. A brief that needs real packaging or a real person gets a
 * labelled empty slot naming the shot required, which is a photography brief
 * a human can act on - not a synthetic stand-in that ships.
 */
const NEVER = 'NEVER render: logos, wordmarks, watermarks, UI or inbox chrome, star ratings, review counts, award badges, price tags, certification marks, or any garbled or invented lettering. For financial, stock market, or news publications: NEVER render fake candlestick charts, synthetic portfolio balances, simulated price tickers, or fabricated financial return figures. If text is not explicitly requested, render none at all. NEVER depict the brand\'s actual retail packaging, labels or a named or identifiable real person: those are photographed, never generated. If the brief requires one, render the scene without it and leave the composition space for it rather than approximating it.';

const QUALITY = 'Gallery-print resolution, true-to-life colour, natural soft lighting, fine material texture, correct anatomy, balanced composition. Avoid blur, noise, banding, compression artifacts, plastic skin, warped shapes, duplicated objects and oversaturation.';

// A photograph of a scene reads as a phone in a real room, never a studio
// render (render-rules.js, "Kill the AI Tell", 2026-10-25): its quality line
// asks for real texture and correct anatomy, not studio light or a grade.
const REAL_QUALITY = 'High resolution, true-to-life colour, fine material and skin texture, correct anatomy and hands. Avoid blur, compression artifacts, plastic skin, warped shapes, duplicated objects and oversaturation.';

/**
 * Build the preamble for one brand and mode.
 * `mode` is one of MODES; anything unrecognised falls back to a photograph.
 */
// Pollinations keeps only the first 1,500 characters of a prompt, and the full
// preamble runs past that, so its tail (the packaging ban included) never
// arrived. A provider with that cap gets this short form, the anti-fabrication
// ban FIRST and the render rules in one line, so neither is cut (2026-10-25).
const NEVER_SHORT = 'NEVER render: logos, wordmarks, readable text, star ratings, review counts, badges, price tags, or the brand\'s actual retail packaging or labels (those are photographed, never generated), no identifiable real person, and no fake candlestick charts, price tickers, portfolio balances or return figures.';

/**
 * The guard a 1,500-character provider gets FIRST, ahead of any variable
 * subject text: the short ban (an ad or a design mockup may carry the text it
 * was given, never invented text) and the render rules in one line.
 */
function compactGuard(mode, opt) {
  const m = MODES.includes(String(mode)) ? String(mode) : 'photo';
  const named = opt && opt.product && String(opt.product.title || '').trim();
  const ban = (m === 'ad' || m === 'design')
    ? NEVER_SHORT.replace('readable text', 'any text beyond the lines supplied (never an invented claim, statistic or rating)')
    : NEVER_SHORT;
  // The brand kind's own ban (news: no synthetic politicians or people; market
  // data: no fake charts) rides the guard too, so it is never cut off.
  const caution = named ? 'Show only this product; no other product, and no readable lettering on its packaging.'
    : (opt && opt.brand ? (subjectFor(opt.brand).caution || '') : '');
  if (m === 'design') return [ban, caution].filter(Boolean).join(' ');
  const objLine = named ? 'Show only the product: add no other object.'
    : 'One ordinary object out of place (a mug, a cable), never a product, packaging, logo or text.';
  return `${ban}${caution ? ' ' + caution : ''} Phone-camera realism: a third of a stop under, mixed warm and cool light, window spill; no cinema grade, empty set or magazine framing. ${objLine}`;
}

function buildPreamble(brand, mode, opt) {
  const name = (brand && brand.name) || 'this brand';
  // A caller photographing a NAMED catalogue product (opt.product = { title,
  // category }) gets that product as the scene. Without it the brand's kind of
  // offering decides, and a brand with none is told to invent no product - the
  // two must not both be said in one prompt (2026-10-10).
  const named = opt && opt.product && String(opt.product.title || '').trim();
  const subject = named ? Object.assign({}, subjectFor(brand), {
    scene: `the brand's own product, ${named}${opt.product.category ? ` (${String(opt.product.category).slice(0, 80)})` : ''}, exactly as it appears in its catalogue photograph, on a real surface with natural light and shallow depth of field.${brand && brand.industry ? ` The brand operates in ${brand.industry}.` : ''}`,
    caution: 'Show only this product; no other product, and no readable lettering on its packaging.',
  }) : subjectFor(brand);
  const palette = paletteBrief(brand);
  const type = typographyBrief(brand);
  const m = MODES.includes(String(mode)) ? String(mode) : 'photo';

  const head = {
    photo: `Photoreal lifestyle photograph for ${name}. Pure photography, NOT a mockup, layout or design frame. Show ${subject.scene}`,
    design: `High-fidelity flat design mockup of a complete marketing email for ${name}, shown as it would appear in an inbox. This is a LAYOUT, not a photograph: header band, body, a single prominent call-to-action button, and a footer.`,
    ad: `Scroll-stopping paid social ad creative for ${name}: a photoreal scene WITH a clean marketing text overlay rendered as part of the image, so it reads as a finished ad rather than a bare photograph. Render ONLY the supplied headline and offer line, spelled exactly as given, in a clear safe-zone band. Show ${subject.scene}`,
    ambient: `Photoreal ambient backdrop for ${name}. Show ${subject.ambient}`,
    reels: `9:16 opening frame for a ${name} social video, shot like a phone in a real room. Foreground, midground and background separation for parallax, one clear subject, and generous negative space in the upper third where kinetic type will be layered later. Show ${subject.scene}`,
  }[m];

  const textPolicy = (m === 'ad')
    ? 'The ONLY text in frame is the supplied headline and offer line. No other words, and never a claim, statistic or rating that was not supplied.'
    : (m === 'design')
      ? 'Any body copy is illegible placeholder texture rather than real sentences; render no claim, statistic or rating.'
      : 'NO text anywhere in frame.';

  const lock = brand && brand.brand_data && brand.brand_data.style_lock;
  const style = lock ? [lock.photo_style && `Photo style, the brand's own: ${String(lock.photo_style).slice(0, 400)}.`,
    Array.isArray(lock.rules) && lock.rules.length && `Never break: ${lock.rules.slice(0, 5).map((r) => String(r).slice(0, 160)).join(' ')}`].filter(Boolean).join(' ') : '';
  // Every mode that renders a real-looking scene carries the render rules; a
  // design mockup is a layout and keeps the studio quality line.
  const real = m !== 'design';
  const realism = real ? require('./render-rules.js').rules({ medium: 'image', people: m !== 'ambient' && !named, productOnly: !!named }) : '';
  // The short form for a 1,500-character provider: the scene, palette and
  // text policy. Its bans and rules are compactGuard(), which the caller puts
  // FIRST, ahead of the subject line (image.js).
  // A saved style lock and the brand's type are kept, bounded, so a fallback
  // picture still wears the brand's look; the guard ahead of it is never cut.
  if (opt && opt.compact) {
    const shortStyle = lock ? [lock.photo_style && `Photo style: ${String(lock.photo_style).slice(0, 160)}.`,
      Array.isArray(lock.rules) && lock.rules.length && `Never break: ${lock.rules.slice(0, 2).map((r) => String(r).slice(0, 80)).join(' ')}`].filter(Boolean).join(' ') : '';
    return [head, shortStyle, palette, type && String(type).slice(0, 200), textPolicy].filter(Boolean).join(' ') + '\n\n';
  }
  // The rules ride right after the scene: Pollinations keeps only the first
  // 1,500 characters, and a long style lock or palette must not push them out.
  return [head, realism, subject.caution, style, palette, type, textPolicy, NEVER, real ? REAL_QUALITY : QUALITY]
    .filter(Boolean).join(' ') + '\n\n';
}

module.exports = { buildPreamble, compactGuard, subjectFor, paletteBrief, MODES, NEVER, NEVER_SHORT, QUALITY, REAL_QUALITY };
