'use strict';
/**
 * asset-style.js - each asset gets its own composition (2026-10-23).
 *
 * The operator: "ensure that styles of assets designs and everything is
 * updated and uniquely created every single time for every asset for every
 * brand". Every slot used to render the same layout for a brand, day after
 * day. A RECIPE is now chosen per (brand, slot, asset): the brand's own
 * palette, type, radii and logo never change (they are the brand), but the
 * composition does: the mail's hero framing, grid width, split block and
 * outline button; the landing page's hero arrangement; a motion ad's type
 * position and opening camera move.
 *
 * Deterministic: the same slot rebuilt shows the same design (what a reviewer
 * approved is what ships), and neighbouring slots differ. Only options the
 * renderers support and the brand's data can fill are chosen; a block the
 * data cannot fill is still left out by the renderer.
 */
const crypto = require('crypto');

function seedOf(...parts) {
  const h = crypto.createHash('sha256').update(parts.map((p) => String(p == null ? '' : p)).join('|')).digest();
  return h.readUInt32BE(0);
}
const pick = (arr, n) => arr[n % arr.length];

/** The recipe for one asset of one slot of one brand. */
function recipe(entry, asset) {
  const e = entry || {};
  const brandKey = (e.brand && (e.brand.id || e.brand.slug || e.brand.name)) || '';
  const slotKey = e.id || `${e.date || ''}|${e.market || ''}|${(e.cohort && e.cohort.name) || ''}`;
  const s = seedOf(brandKey, slotKey, asset);
  const b = (k) => (s >>> k) & 0xff;
  // 'mail:visual', 'landing:<campaign>': the kind decides the options, the
  // whole name seeds the choice (so a slot's variants differ too).
  const kind = String(asset || '').split(':')[0];
  if (kind === 'mail') {
    return {
      id: `mail-${s.toString(36)}`,
      hero_full_width: pick([true, true, false], b(0)),      // full-bleed twice as often as framed
      grid_columns: pick([2, 3], b(8)),
      split_feature: pick([false, true], b(16)),
      secondary_outline: pick([false, true], b(24)),
    };
  }
  if (kind === 'ad') {
    return {
      id: `ad-${s.toString(36)}`,
      text_at: pick(['top', 'middle', 'lower'], b(0)),
      move_offset: b(8) % 4,
    };
  }
  if (kind === 'landing') {
    return {
      id: `lp-${s.toString(36)}`,
      hero: pick(['media-right', 'media-left', 'media-top'], b(0)),
    };
  }
  return { id: `${asset}-${s.toString(36)}` };
}

/** Apply a mail recipe over the studied layout: the study decides what the category uses, the recipe varies within it. */
function mailLayout(studied, r) {
  const base = Object.assign({}, studied || {});
  const out = Object.assign({}, base, {
    hero_full_width: r.hero_full_width,
    grid_columns: r.grid_columns,
    grid_max: r.grid_columns === 3 ? 3 : 4,
    secondary_outline: base.secondary_outline === false ? r.secondary_outline : base.secondary_outline,
  });
  // A block the category's mail does not use stays off; the recipe only turns
  // on what the study allows (split_feature is the one optional extra).
  if (base.split_feature === true) out.split_feature = r.split_feature;
  out.recipe = r.id;
  return out;
}

module.exports = { recipe, mailLayout, seedOf };
