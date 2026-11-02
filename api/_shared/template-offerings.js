'use strict';
/**
 * Which starter template's offerings belong to a brand (2026-11-03).
 *
 * Production, /brain for "The Times of India": the ads were for "Marathon
 * training plan (multi-week)", an offering of the TOI Health & Fitness
 * TEMPLATE. Both templates sit on the same host (timesofindia.indiatimes.com),
 * and a template's offerings were handed to any record whose
 * brand_data.template named it AND whose website was on that host. A record
 * made from the Health & Fitness template and then renamed / pointed at the
 * Times of India home page kept getting the vertical's programmes.
 *
 * A template's offerings are a brand's only when the record IS that template:
 * the same template slug and the same website (host AND path: two sections of
 * one site are two brands). A rename is the person's and keeps them. Anything
 * less and the record is another brand that shares a host or a template label.
 *
 * Slots planned before this rule may still name such an offering. An offering
 * whose name only a template the brand is NOT carries (and which the brand's
 * own record does not state in its own words) is another brand's, and the
 * planner treats a slot naming it exactly as one naming another brand's product.
 */
const fs = require('fs');
const path = require('path');

let _presets = null;
function presets() {
  if (_presets) return _presets;
  const out = [];
  try {
    const dir = path.join(process.cwd(), 'data', 'brands', 'presets');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || f === 'index.json') continue;
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (p && p.slug) out.push({ slug: String(p.slug).trim().toLowerCase(), name: p.name || '', website: p.website || '', offerings: Array.isArray(p.offerings) ? p.offerings : [] });
      } catch (_) { /* a broken preset file is not a template */ }
    }
  } catch (_) { /* no preset directory */ }
  _presets = out;
  return out;
}

function fold(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ''); }
function site(u) {
  const s = String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[?#]/)[0];
  const i = s.indexOf('/');
  const host = i < 0 ? s : s.slice(0, i);
  const p = i < 0 ? '' : s.slice(i).replace(/\/+$/, '');
  return { host, path: p };
}
function templateSlugOf(brand) {
  const t = brand && (brand.template || (brand.brand_data && brand.brand_data.template));
  if (!t) return '';
  const s = String(typeof t === 'object' ? (t.slug || '') : t).trim().toLowerCase();
  return /^[a-z0-9-]{1,60}$/.test(s) ? s : '';
}

/** Is this record the template's brand (slug, host and path all agree)? */
function presetMatches(brand, preset) {
  if (!brand || !preset) return false;
  const t = templateSlugOf(brand);
  const ps = String(preset.slug || '').trim().toLowerCase();
  if (!t || !ps || t !== ps) return false;
  const b = site(brand.website);
  const p = site(preset.website);
  // The name is the person's to change (a brand made from a template may be
  // renamed and stay that template's brand); the website is not.
  return !!b.host && b.host === p.host && b.path === p.path;
}

/** The template's offerings when the record is that template, else []. */
function templateOfferings(brand) {
  const t = templateSlugOf(brand);
  if (!t) return [];
  const p = presets().find((x) => x.slug === t);
  return p && presetMatches(brand, p) ? p.offerings : [];
}

function ownOfferings(brand) {
  const d = brand && brand.brand_data;
  if (d && Array.isArray(d.offerings) && d.offerings.length) return d.offerings;
  return brand && Array.isArray(brand.offerings) ? brand.offerings : [];
}

/**
 * Offering names that belong to a template this brand is not. A name the
 * brand's own record also states counts as its own UNLESS that record's entry
 * is a copy of the template's (same name and same source line).
 */
function foreignTemplateOfferings(brand) {
  const out = new Map();
  if (!brand || typeof brand !== 'object') return out;
  const own = new Map();
  for (const o of ownOfferings(brand)) if (o && (o.name || o.title)) own.set(fold(o.name || o.title), o);
  // Only templates this record could have picked up offerings from: the one
  // its record names, or one on its own host. Every other template's names
  // ("India", "Videos") are just words another brand may also use.
  const tpl = templateSlugOf(brand);
  const host = site(brand.website).host;
  for (const p of presets()) {
    if (presetMatches(brand, p)) continue;
    if (!(tpl && p.slug === tpl) && !(host && site(p.website).host === host)) continue;
    for (const o of p.offerings) {
      const k = fold(o && (o.name || o.title));
      if (!k) continue;
      const mine = own.get(k);
      if (mine && !(mine.source && o.source && String(mine.source) === String(o.source))) continue;
      if (!out.has(k)) out.set(k, { name: o.name || o.title, template: p.name || p.slug });
    }
  }
  // A name the brand's own matching template also carries is its own.
  for (const o of templateOfferings(brand)) out.delete(fold(o && (o.name || o.title)));
  return out;
}

/** Is this offering (by name) another template's? Returns {name, template} or null. */
function offeringFromOtherTemplate(o, foreign) {
  if (!o || !foreign || !foreign.size) return null;
  return foreign.get(fold(o.name || o.title)) || null;
}

/** The verdict for a slot that names another template's offering, else null. */
function slotTemplateVerdict(entry, brand) {
  if (!entry || !brand) return null;
  const foreign = foreignTemplateOfferings(brand);
  if (!foreign.size) return null;
  // Offerings, and a hero that is not a catalogue row (no sku, handle or page).
  const hp = entry.heroProduct;
  const heroIsOffering = hp && !hp.placeholder && !hp.sku && !hp.handle && !hp.url && !hp.product_url;
  const items = [entry.heroOffering, entry.offering, heroIsOffering ? hp : null].filter(Boolean);
  for (const it of items) {
    const hit = offeringFromOtherTemplate(it, foreign);
    if (hit) {
      const name = brand.name || 'this brand';
      return {
        template: hit.template, offering: hit.name, domain: '',
        marker: `[DATA REQUIRED BEFORE LAUNCH: offerings, ${name}]`,
        sentence: `"${hit.name}" is an offering of the ${hit.template} template, not of ${name}; it is not used for ${name}.`,
      };
    }
  }
  return null;
}

function _reset() { _presets = null; }

module.exports = { presetMatches, templateOfferings, foreignTemplateOfferings, offeringFromOtherTemplate, slotTemplateVerdict, templateSlugOf, _reset };
