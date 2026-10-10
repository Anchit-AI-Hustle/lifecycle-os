'use strict';
/**
 * brand-invariant-fixtures.js - the brands tests/brand-content-invariant.spec.js
 * generates for, and the TOKENS that identify each of them. Not a spec.
 * ---------------------------------------------------------------------------
 * Every value here is deliberately unusual so that a sighting of it anywhere
 * is unambiguous: no real company uses these names, hexes, hosts or claims,
 * and no renderer has any of them as a default. The tenant-zero tokens are
 * DERIVED from data/brands/_default.json and from the built catalogue, so they
 * cannot drift from the record they describe.
 *
 *   QUILL    an Indian news brand (home IN, INR) with its own catalogue
 *   BRAMBLE  a British food brand (home UK, GBP) with its own catalogue
 *   BARE     a name and nothing else - every other fact must be a marker
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const QUILL = {
  slug: 'quillforth-gazette', name: 'Quillforth Gazette', tagline: 'Pune news, checked twice by the Quillforth desk',
  industry: 'news publishing', website: 'https://quillforth-gazette.example',
  logo_url: 'https://media.quillforth-gazette.example/logo-qfg.svg',
  palette: { primary: '#7B2D5E', accent: '#C8A13B', surface: '#FBF7EF', ink: '#2A1F33' },
  typography: { heading: { family: 'Zilla Slab', stack: "'Zilla Slab',Georgia,serif", google: true, weights: '600;700' }, body: { family: 'Karla', stack: "'Karla',Arial,sans-serif", google: true, weights: '400;600' } },
  voice: { tone: 'measured, civic and plain-spoken', preferred: ['ward ledger', 'checked twice'], banned: ['clickbait frenzy', 'shocking reveal'], no_em_dashes: true },
  regions: [{ code: 'IN', name: 'India', currency: 'INR', symbol: '₹', store_url: 'https://quillforth-gazette.example', home: true }],
  claims: ['Quillforth reporters file from all 14 Pune wards'],
  legal_entity: 'Quillforth Media LLP, Shivajinagar, Pune 411005, India',
  offerings: [{ kind: 'subscription', name: 'Quillforth Morning Ledger', url: 'https://quillforth-gazette.example/ledger' }],
  competitors: [{ name: 'Deccan Lanternpost', domain: 'deccan-lanternpost.example' }],
  catalogue: [
    { title: 'Quillforth Morning Ledger Annual', handle: 'quillforth-morning-ledger-annual', price: '1499.00', image: 'https://img.quillforth-cdn.example/ledger-annual.jpg', product_type: 'Subscription' },
    { title: 'Quillforth Ward Atlas Print', handle: 'quillforth-ward-atlas-print', price: '899.00', image: 'https://img.quillforth-cdn.example/ward-atlas.jpg', product_type: 'Print' },
  ],
};

const BRAMBLE = {
  slug: 'brambleweld-larder', name: 'Brambleweld Larder', tagline: 'Hedgerow preserves from the Brambleweld kitchen',
  industry: 'food and preserves', website: 'https://brambleweld-larder.example',
  logo_url: 'https://media.brambleweld-larder.example/bwl-mark.svg',
  palette: { primary: '#2E6B4A', accent: '#B5562B', surface: '#FFFDF6', ink: '#1E2A22' },
  typography: { heading: { family: 'Fraunces', stack: "'Fraunces',Georgia,serif", google: true, weights: '600;700' }, body: { family: 'Mulish', stack: "'Mulish',Arial,sans-serif", google: true, weights: '400;600' } },
  voice: { tone: 'warm, unhurried kitchen talk', preferred: ['hedgerow', 'small batch'], banned: ['superfood miracle', 'guilt-free'], no_em_dashes: true },
  regions: [{ code: 'UK', name: 'United Kingdom', currency: 'GBP', symbol: '£', store_url: 'https://brambleweld-larder.example', home: true }],
  claims: ['Every Brambleweld jar is cooked in Ludlow'],
  legal_entity: 'Brambleweld Larder Ltd, Ludlow SY8 1AX, United Kingdom',
  offerings: [{ kind: 'product', name: 'Brambleweld Damson Chutney', url: 'https://brambleweld-larder.example/products/brambleweld-damson-chutney' }],
  competitors: [{ name: 'Wrekin Pantry Co', domain: 'wrekin-pantry.example' }],
  catalogue: [
    { title: 'Brambleweld Damson Chutney', handle: 'brambleweld-damson-chutney', price: '6.50', image: 'https://cdn.brambleweld-larder.example/damson.jpg', product_type: 'Chutney' },
    { title: 'Brambleweld Sloe Jelly', handle: 'brambleweld-sloe-jelly', price: '5.75', image: 'https://cdn.brambleweld-larder.example/sloe.jpg', product_type: 'Jelly' },
  ],
};

const BARE = { slug: 'ozzlewick', name: 'Ozzlewick', catalogue: [] };

const BRANDS = [QUILL, BRAMBLE, BARE];

/** The record a workspace row / a carried device brand would hold (catalogue removed). */
function recordOf(b) {
  const r = Object.assign({}, b);
  delete r.catalogue;
  return r;
}

/**
 * The row brand_workspaces would hold for b: the schema's columns at the top
 * level and everything else inside brand_data, where a persisted workspace
 * keeps it (brand-runtime.normalizeBrand hoists it back out).
 */
function workspaceRow(b, id) {
  const r = recordOf(b);
  const data = {};
  for (const k of ['claims', 'legal_entity', 'offerings', 'competitors']) { if (r[k] !== undefined) data[k] = r[k]; delete r[k]; }
  return Object.assign(r, { id, slug: b.slug, status: 'active', brand_data: data, created_at: '2026-09-20T00:00:00.000Z' });
}

/** Tokens that identify brand b. Each is a [label, needle] pair; matching is case-insensitive. */
function tokensOf(b) {
  const out = [];
  const add = (label, v) => { if (v && String(v).trim().length >= 4) out.push([label, String(v)]); };
  add('name', b.name);
  if (b.website) add('domain', new URL(b.website).host);
  if (b.logo_url) add('logo host', new URL(b.logo_url).host);
  for (const k of ['primary', 'accent']) if (b.palette && b.palette[k]) add('palette.' + k, b.palette[k]);
  if (b.typography) for (const k of ['heading', 'body']) if (b.typography[k]) add('font.' + k, b.typography[k].family || b.typography[k]);
  for (const c of b.claims || []) add('claim', c);
  if (b.legal_entity) add('legal entity', b.legal_entity.split(',')[0]);
  for (const p of b.catalogue || []) { add('product', p.title); try { add('cdn', new URL(p.image).host); } catch (_) {} }
  for (const c of b.competitors || []) add('competitor', c.name);
  return out;
}

/* ── tenant zero, derived from its own record and its built catalogue ───── */
const ZERO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', '_default.json'), 'utf8'));

function zeroTokens() {
  const out = [];
  const add = (label, v) => { if (v && String(v).trim().length >= 4) out.push([label, String(v)]); };
  add('name', ZERO.name);
  add('domain', new URL(ZERO.website).host);
  add('palette.primary', ZERO.palette.primary);
  add('palette.accent', ZERO.palette.accent);
  const fam = (t) => (t && typeof t === 'object' ? t.family : t);
  add('font.heading', fam(ZERO.typography.heading));
  add('font.body', fam(ZERO.typography.body));
  add('legal entity', String(ZERO.legal_entity).split(',')[0]);
  add('legal address', 'Ghatkopar');
  for (const c of ZERO.claims || []) add('claim', c);
  // Preferred vocabulary that names the PRODUCT (generic words like "drop"
  // or "original" would match any brand's copy and prove nothing).
  for (const w of ['sneaker', 'hand-painted', 'colorway', 'Samay Raina', 'Rohit Sharma']) add('vocabulary', w);
  for (const c of ((ZERO.offers && ZERO.offers.codes) || [])) if (/[A-Z]{4,}\d*/.test(c.code) && c.code.length >= 6) add('offer code', c.code);
  // The sibling projects this fork came from (a tea brand, a wellness brand).
  for (const w of ['first-flush', 'BEGIN THE RITUAL', 'steaming pair', 'liquid gold']) add('sibling literal', w);
  // The CDN signature of tenant zero's built catalogue, and a few of its titles.
  const cat = path.join(ROOT, 'data', 'catalog', 'products_us.json');
  if (fs.existsSync(cat)) {
    const rows = JSON.parse(fs.readFileSync(cat, 'utf8'));
    const sig = {};
    for (const r of rows) { const m = /^https?:\/\/[^/]+\/s\/files\/\d+\/\d+\/\d+\/\d+/.exec(String(r.i || '')); if (m) sig[m[0]] = (sig[m[0]] || 0) + 1; }
    const top = Object.entries(sig).sort((a, b) => b[1] - a[1])[0];
    if (top) add('catalogue cdn', top[0].replace(/^https?:\/\//, ''));
    for (const r of rows.slice(0, 5)) add('catalogue product', r.n);
  }
  return out;
}

/** Every token that must NOT appear in output generated for brand `b`. */
function foreignTokens(b) {
  const out = zeroTokens().map(([l, v]) => ['tenant zero ' + l, v]);
  for (const o of BRANDS) if (o !== b) for (const [l, v] of tokensOf(o)) out.push([o.name + ' ' + l, v]);
  return out;
}

/** Find every foreign token in a haystack; returns [{label, needle, at}] with a short context. */
function leaksIn(text, b) {
  const s = String(text || '');
  const low = s.toLowerCase();
  const found = [];
  for (const [label, needle] of foreignTokens(b)) {
    const i = low.indexOf(String(needle).toLowerCase());
    if (i >= 0) found.push({ label, needle, at: s.slice(Math.max(0, i - 60), i + needle.length + 60).replace(/\s+/g, ' ') });
  }
  return found;
}

const MARKER = /\[DATA REQUIRED BEFORE LAUNCH:/;

module.exports = { QUILL, BRAMBLE, BARE, BRANDS, recordOf, workspaceRow, tokensOf, zeroTokens, foreignTokens, leaksIn, MARKER, ZERO, ROOT };
