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
function subjectFor(brand) {
  const offs = (brand && Array.isArray(brand.offerings) && brand.offerings) || [];
  const kinds = new Set(offs.map((o) => o && o.kind).filter(Boolean));
  const cs = (brand && brand.catalog_source) || {};
  if (cs.kind && cs.kind !== 'none' && cs.kind !== 'manual') kinds.add('product');
  const industry = (brand && brand.industry) ? String(brand.industry) : '';
  const ctx = industry ? ` The brand operates in ${industry}.` : '';

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
 */
const NEVER = 'NEVER render: logos, wordmarks, watermarks, UI or inbox chrome, star ratings, review counts, award badges, price tags, certification marks, or any garbled or invented lettering. If text is not explicitly requested, render none at all.';

const QUALITY = 'Gallery-print resolution, true-to-life colour, natural soft lighting, fine material texture, correct anatomy, balanced composition. Avoid blur, noise, banding, compression artifacts, plastic skin, warped shapes, duplicated objects and oversaturation.';

/**
 * Build the preamble for one brand and mode.
 * `mode` is one of MODES; anything unrecognised falls back to a photograph.
 */
function buildPreamble(brand, mode) {
  const name = (brand && brand.name) || 'this brand';
  const subject = subjectFor(brand);
  const palette = paletteBrief(brand);
  const type = typographyBrief(brand);
  const m = MODES.includes(String(mode)) ? String(mode) : 'photo';

  const head = {
    photo: `Photoreal lifestyle photograph for ${name}. Pure photography, NOT a mockup, layout or design frame. Show ${subject.scene}`,
    design: `High-fidelity flat design mockup of a complete marketing email for ${name}, shown as it would appear in an inbox. This is a LAYOUT, not a photograph: header band, body, a single prominent call-to-action button, and a footer.`,
    ad: `Scroll-stopping paid social ad creative for ${name}: a photoreal scene WITH a clean marketing text overlay rendered as part of the image, so it reads as a finished ad rather than a bare photograph. Render ONLY the supplied headline and offer line, spelled exactly as given, in a clear safe-zone band. Show ${subject.scene}`,
    ambient: `Photoreal ambient backdrop for ${name}. Show ${subject.ambient}`,
    reels: `Cinematic 9:16 opening frame for a ${name} social video, graded like a film still. Strong foreground, midground and background separation for parallax, one clear subject, and generous negative space in the upper third where kinetic type will be layered later. Show ${subject.scene}`,
  }[m];

  const textPolicy = (m === 'ad')
    ? 'The ONLY text in frame is the supplied headline and offer line. No other words, and never a claim, statistic or rating that was not supplied.'
    : (m === 'design')
      ? 'Any body copy is illegible placeholder texture rather than real sentences; render no claim, statistic or rating.'
      : 'NO text anywhere in frame.';

  return [head, subject.caution, palette, type, textPolicy, NEVER, QUALITY]
    .filter(Boolean).join(' ') + '\n\n';
}

module.exports = { buildPreamble, subjectFor, paletteBrief, MODES, NEVER };
