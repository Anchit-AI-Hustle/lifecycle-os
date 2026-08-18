'use strict';
/**
 * logo-brief.js — art-direct a logo from the brand's OWN record.
 * ---------------------------------------------------------------------------
 * Adapted from the logo step in Google's ADK `marketing-agency` sample
 * (google/adk-samples, Apache-2.0). This platform could already EXTRACT a logo
 * from a brand's site (brand-extract.js) and had no way to CREATE one, which is
 * a real gap for a brand that does not have one yet.
 *
 * ── WHAT THE SAMPLE DOES, AND WHY IT IS NOT ENOUGH HERE ────────────────────
 * The sample's logo agent is a one-line instruction ("generate or edit an image
 * based on prompt provided") wired straight to Imagen. It has no brand context
 * at all, so it produces a logo for the words in the prompt rather than for the
 * brand: the wrong palette, an arbitrary typeface, and no relationship to the
 * identity the operator has already spent the onboarding wizard establishing.
 *
 * This module builds the PROMPT from the brand record - its palette, its
 * typography, its positioning and what it actually sells - and hands it to the
 * image cascade this repo already runs (api/ai/image.js: Gemini native →
 * Imagen → OpenAI → Pollinations). No new provider, no new key, and the same
 * credit metering as every other generation.
 *
 * ── THE RULES A LOGO PROMPT HAS TO CARRY ───────────────────────────────────
 * Image models are poor at type and will happily render a wordmark with
 * mangled letters. So the brief:
 *   - asks for a MARK, not a wordmark, unless the operator explicitly wants
 *     lettering, and says why;
 *   - names the exact hex values, because "on brand" means nothing to a model;
 *   - forbids the photographic and 3D treatments that make a logo unusable at
 *     16px, in one colour, or on a dark surface;
 *   - refuses to invent an identity for a brand that has not described itself.
 *
 * Pure and synchronous: it returns a brief, and the caller spends the credits.
 * That keeps it testable without a provider and keeps the fabrication surface
 * where it can be inspected.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const runtime = require('./brand-runtime.js');

/** Treatments that look impressive in a preview and fail as a real logo. */
const FORBIDDEN = [
  'no photographic imagery',
  'no 3D rendering, bevels, extrusions or drop shadows',
  'no gradients (a logo must survive one-colour printing)',
  'no drop-in stock icons or clip art',
  'no text effects, outlines or letter distortion',
  'no background scene - the mark sits on a plain field',
  'no registered-trademark, copyright or watermark glyphs',
];

const STYLES = {
  mark: 'an abstract or emblematic MARK with no lettering',
  monogram: 'a MONOGRAM built from the brand initials only',
  wordmark: 'a WORDMARK setting the brand name as type',
};

function hex(v, fallback) {
  const s = String(v || '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(s) ? s : fallback;
}

/**
 * Build the logo brief.
 *
 * @returns {{ok:boolean, prompt?:string, style?:string, palette?:Object, missing?:string[], note?:string}}
 */
function logoBrief(brand, { style = 'mark', notes = '' } = {}) {
  const b = brand && !runtime.isUnresolved(brand) ? brand : null;
  const missing = [];

  if (!b || !b.name) {
    return {
      ok: false,
      missing: ['[DATA REQUIRED BEFORE LAUNCH: brand name]'],
      // A logo for a brand that has not said who it is would be a picture the
      // operator then has to justify backwards.
      note: 'No brand is resolved, so there is no identity to design for. Complete brand setup first: a logo generated from nothing is a stock graphic with a story attached afterwards.',
    };
  }

  const p = (b.palette && typeof b.palette === 'object') ? b.palette : {};
  const primary = hex(p.primary, '');
  const accent = hex(p.accent, '');
  const ink = hex(p.ink, '#111111');
  const surface = hex(p.surface, '#FFFFFF');

  if (!primary) missing.push('[DATA REQUIRED BEFORE LAUNCH: brand primary colour]');
  if (!b.industry && !b.positioning) missing.push('[DATA REQUIRED BEFORE LAUNCH: industry or positioning]');

  const chosen = STYLES[String(style).toLowerCase()] ? String(style).toLowerCase() : 'mark';

  const what = [b.industry, b.positioning].filter(Boolean).join('; ');
  const sells = (b.offerings || []).slice(0, 4)
    .map((o) => (typeof o === 'string' ? o : (o && (o.name || o.kind)))).filter(Boolean).join(', ');

  const colourLine = primary
    ? `Use ONLY these colours, by exact value: primary ${primary}${accent ? `, accent ${accent}` : ''}, ink ${ink}, on a plain ${surface} field.`
    : 'The brand has published no primary colour, so render the mark in a single flat black on white and leave colour to be applied later. Do not invent a brand colour.';

  const typeLine = chosen === 'wordmark' || chosen === 'monogram'
    ? `The lettering must read exactly "${chosen === 'monogram' ? initials(b.name) : b.name}". `
      + 'Image models frequently deform letterforms, so treat the spelling as a hard requirement and keep the type geometry simple and wide-countered. '
      + ((b.typography && b.typography.heading)
        ? `The brand sets headings in ${b.typography.heading}; match its weight and proportion rather than copying the exact face.`
        : 'No brand typeface is recorded, so use a plain geometric sans.')
    : 'The mark carries NO lettering. The brand name will be set beside it in the brand typeface, so anything the model renders as text would have to be removed.';

  const prompt = [
    `A flat vector brand logo for "${b.name}".`,
    what ? `The brand: ${what}.` : '',
    sells ? `It sells: ${sells}.` : '',
    `Design ${STYLES[chosen]}.`,
    colourLine,
    typeLine,
    'It must stay legible at 16 pixels, in a single colour, and reversed out of a dark surface.',
    'Centre it with even margin on all sides.',
    `Explicitly: ${FORBIDDEN.join('; ')}.`,
    String(notes || '').trim() ? `Operator direction: ${String(notes).trim()}` : '',
  ].filter(Boolean).join(' ');

  return {
    ok: true,
    style: chosen,
    prompt,
    palette: { primary, accent, ink, surface },
    forbidden: FORBIDDEN,
    missing,
    note: missing.length
      ? 'The brief was built, and the gaps above are stated in it rather than filled with a guess.'
      : 'Built entirely from this brand\'s own record.',
  };
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 3);
}

module.exports = { logoBrief, STYLES, FORBIDDEN, initials };
