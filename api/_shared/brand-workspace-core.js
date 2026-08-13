'use strict';
/**
 * brand-workspace-core.js — the multi-tenant brand layer of the platform.
 * ---------------------------------------------------------------------------
 * This is what turns a single-brand Lifecycle OS into a UNIVERSAL brand
 * marketing lifecycle platform: every logged-in user onboards their own brands
 * (identity + colour schema + typography + voice guardrails + regions +
 * catalog), picks one ACTIVE workspace, and the whole app — shell palette,
 * fonts, name, nav, and every generator — runs as that brand.
 *
 * NOT a function file (lives under api/_shared/ → excluded from the Hobby
 * 12-serverless-function cap). Routed from api/public-config.js ?action=brand.
 *
 * Zero-fabrication contract (docs/campaign-orchestration-master-spec.md):
 *   * Nothing is ever invented. Every stored value came from the operator or
 *     from a source they pointed at, and catalog rows keep `source` + `raw`.
 *   * Missing data is REPORTED, never filled: readiness() emits
 *       [DATA REQUIRED BEFORE LAUNCH: <field>, <product>, <region>]
 *   * Design HARD rules are enforced at save time, not at render time:
 *     no dark-neutral page surface, WCAG-AA contrast on every text/background
 *     pairing the shell will actually use.
 *
 * Auth model: any authenticated Supabase user may own workspaces (this is a
 * platform, not the single-tenant operator console), so this module does NOT
 * use data-analysis-core's `@knickgasm.com` domain gate. Reads/writes go
 * through PostgREST with the CALLER'S JWT so the RLS policies in
 * supabase/migrations/20260809120000_brand_workspaces.sql are the authority.
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const MAX_CATALOG_ROWS = 5000;      // per import, keeps a serverless call bounded
const MAX_UPLOAD_CHARS = 6e6;       // ~6MB of pasted/uploaded text

/* ── env ──────────────────────────────────────────────────────────────────── */

function env() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !(anon || service)) throw new Error('SUPABASE_URL or SUPABASE_*_KEY missing');
  return { url: String(url).replace(/\/$/, ''), anon: anon || service, service: service || '' };
}

function bearer(req) {
  const h = String((req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : '';
}

/** Verify the caller is a signed-in Supabase user. No domain allowlist. */
async function requireUser(req) {
  const token = bearer(req);
  if (!token) return { ok: false, status: 401, error: 'sign_in_required', hint: 'Send Authorization: Bearer <Supabase access token>.' };
  let e;
  try { e = env(); } catch (err) { return { ok: false, status: 503, error: 'supabase_not_configured', detail: err.message }; }
  try {
    const r = await fetch(`${e.url}/auth/v1/user`, {
      headers: { apikey: e.anon, authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!r.ok) return { ok: false, status: 401, error: 'invalid_session' };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, status: 401, error: 'invalid_session' };
    return { ok: true, token, user_id: user.id, email: String(user.email || '').toLowerCase() };
  } catch (err) {
    return { ok: false, status: 503, error: 'session_verification_unavailable', detail: err.message };
  }
}

/** PostgREST call made AS THE CALLER, so RLS decides what they can touch. */
async function restAs(token, pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = env();
  const headers = { apikey: e.anon, authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) {
    const msg = (json && (json.message || json.hint)) || text || res.statusText;
    const err = new Error(`supabase ${method} ${pathAndQuery} -> ${res.status}: ${msg}`);
    err.status = res.status === 401 || res.status === 403 ? res.status : 502;
    throw err;
  }
  return json;
}

/* ── colour maths (WCAG) ──────────────────────────────────────────────────── */

const HEX_RX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normHex(v) {
  let s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (!s.startsWith('#')) s = '#' + s;
  if (!HEX_RX.test(s)) return '';
  if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return s.toLowerCase();
}

function rgb(hex) {
  const h = normHex(hex) || '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function luminance(hex) {
  const chan = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

/** WCAG contrast ratio, 1..21. */
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

function saturation(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const l = (mx + mn) / 2;
  return l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
}

/** The spec's design HARD rule: no black / near-black / dark-neutral surfaces. */
function isDarkNeutral(hex) {
  const h = normHex(hex);
  if (!h) return false;
  return luminance(h) < 0.12 && saturation(h) < 0.25;
}

/** Mix `hex` toward white (t>0) or black (t<0) — used to derive shell tints. */
function shade(hex, t) {
  const target = t >= 0 ? 255 : 0;
  const amt = Math.abs(t);
  const out = rgb(hex).map((v) => Math.round(v + (target - v) * amt));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Pick whichever of the brand's own text-capable colours reads best on `bg`.
 * Candidates are the ink, the PAGE surface and the card surface - all palette
 * colours the shell already renders text in. Excluding the page surface was a
 * real defect: a brand whose primary passes AA against its white page (a
 * symmetric pairing the validator itself reports) was still blocked because
 * only ink and the slightly-grey card colour were tried as button text.
 */
function readableOn(bg, ink, surface, surfaceAlt) {
  const candidates = [ink || '#111111', surface || '#ffffff', surfaceAlt]
    .filter(Boolean)
    .filter((c, i, a) => a.indexOf(c) === i);
  let best = candidates[0], bestC = -1;
  for (const c of candidates) {
    const r = contrast(bg, c);
    if (r > bestC) { bestC = r; best = c; }
  }
  return best;
}

/* ── brand normalisation ──────────────────────────────────────────────────── */

const DEFAULT_BRAND = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'brands', '_default.json'), 'utf8')); }
  catch (_) { return null; }
})();

function slugify(v) {
  return String(v == null ? '' : v).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function str(v, max) {
  const s = String(v == null ? '' : v).trim();
  return max ? s.slice(0, max) : s;
}

function arr(v, max) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '' && x != null).slice(0, max || 200);
}

function httpUrl(v) {
  const s = str(v, 500);
  if (!s) return '';
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString().replace(/\/$/, '') : '';
  } catch (_) { return ''; }
}

const PALETTE_ROLES = ['primary', 'accent', 'ink', 'surface', 'surface_alt', 'muted', 'ok', 'warn', 'err'];

function normalizePalette(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const role of PALETTE_ROLES) {
    const hex = normHex(src[role]);
    if (hex) out[role] = hex;
  }
  const extra = Array.isArray(src.extra) ? src.extra : [];
  const cleanExtra = [];
  for (const e of extra.slice(0, 12)) {
    const hex = normHex(e && e.hex);
    const name = str(e && e.name, 32);
    if (hex && name) cleanExtra.push({ name, hex });
  }
  if (cleanExtra.length) out.extra = cleanExtra;
  return out;
}

function normalizeFont(f, fallback) {
  const src = f && typeof f === 'object' ? f : {};
  const family = str(src.family, 64);
  if (!family) return null;
  // A stack is only ever built from the operator's own family + a generic
  // fallback; we never substitute a different brand's typeface.
  const stack = str(src.stack, 200) || `'${family}',${fallback}`;
  return {
    family,
    stack,
    google: src.google !== false,
    weights: str(src.weights, 40) || '400;600;700',
  };
}

function normalizeTypography(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  const heading = normalizeFont(src.heading, 'Georgia,serif');
  const body = normalizeFont(src.body, 'system-ui,-apple-system,Segoe UI,sans-serif');
  const mono = normalizeFont(src.mono, 'ui-monospace,SFMono-Regular,Menlo,monospace');
  if (heading) out.heading = heading;
  if (body) out.body = body;
  if (mono) out.mono = mono;
  return out;
}

function normalizeVoice(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    tone: str(src.tone, 400),
    preferred: arr(src.preferred, 80).map((s) => str(s, 60)),
    banned: arr(src.banned, 120).map((s) => str(s, 60)),
    no_em_dashes: src.no_em_dashes !== false,
    notes: str(src.notes, 2000),
  };
}

function normalizeRegions(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const r of input.slice(0, 24)) {
    const code = str(r && r.code, 12).toUpperCase();
    if (!code) continue;
    out.push({
      code,
      currency: str(r.currency, 8).toUpperCase(),
      symbol: str(r.symbol, 4),
      store_url: httpUrl(r.store_url),
      pdp_pattern: str(r.pdp_pattern, 200) || '{base}/products/{handle}',
      collection_pattern: str(r.collection_pattern, 200) || '{base}/collections/{slug}',
    });
  }
  return out;
}

function normalizeHosts(input, regions) {
  const set = new Set();
  for (const h of arr(input, 40)) {
    const host = str(h, 200).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (host) set.add(host);
  }
  // A region's own store host is, by definition, brand-owned.
  for (const r of regions || []) {
    if (!r.store_url) continue;
    try { set.add(new URL(r.store_url).host.toLowerCase()); } catch (_) { /* ignore */ }
  }
  return [...set];
}

/**
 * Validate a colour schema against the design HARD rules.
 * Returns { ok, errors:[], warnings:[], contrast:{} } — errors block save.
 */
function validatePalette(paletteInput) {
  const p = normalizePalette(paletteInput);
  const errors = [], warnings = [];

  for (const role of ['primary', 'ink', 'surface']) {
    if (!p[role]) errors.push({ field: role, message: `Missing required colour: ${role}.` });
  }
  for (const [k, v] of Object.entries(paletteInput || {})) {
    if (PALETTE_ROLES.includes(k) && v && !normHex(v)) {
      errors.push({ field: k, message: `"${v}" is not a valid hex colour (use #RGB or #RRGGBB).` });
    }
  }
  if (errors.length) return { ok: false, errors, warnings, palette: p, contrast: {} };

  const ratios = {
    ink_on_surface: contrast(p.ink, p.surface),
    ink_on_surface_alt: contrast(p.ink, p.surface_alt || '#ffffff'),
    primary_on_surface: contrast(p.primary, p.surface),
    onprimary: contrast(p.primary, readableOn(p.primary, p.ink, p.surface, p.surface_alt || '#ffffff')),
    accent_on_surface: p.accent ? contrast(p.accent, p.surface) : null,
    muted_on_surface: p.muted ? contrast(p.muted, p.surface) : null,
  };

  // HARD rule: never a black / near-black / dark-neutral page surface.
  if (isDarkNeutral(p.surface)) {
    errors.push({ field: 'surface', message: 'Page surface is a dark neutral (near-black). Use a light surface, or your brand primary as the dark ground — never black/#111111-style neutrals.' });
  }
  if (p.surface_alt && isDarkNeutral(p.surface_alt)) {
    errors.push({ field: 'surface_alt', message: 'Card surface is a dark neutral. Use a light surface or a brand-primary tint.' });
  }
  // HARD rule: WCAG-AA on every pairing the shell actually renders.
  if (ratios.ink_on_surface < 4.5) {
    errors.push({ field: 'ink', message: `Body text on the page surface is ${ratios.ink_on_surface}:1 — WCAG AA needs 4.5:1. Darken the ink or lighten the surface.` });
  }
  if (ratios.ink_on_surface_alt < 4.5) {
    errors.push({ field: 'surface_alt', message: `Body text on cards is ${ratios.ink_on_surface_alt}:1 — WCAG AA needs 4.5:1.` });
  }
  if (ratios.onprimary < 4.5) {
    errors.push({ field: 'primary', message: `Neither your ink nor your card colour reaches 4.5:1 on the primary (best is ${ratios.onprimary}:1). Buttons and primary bands would be unreadable.` });
  }
  if (ratios.primary_on_surface < 3) {
    warnings.push({ field: 'primary', message: `Primary on the page surface is ${ratios.primary_on_surface}:1 — below the 3:1 non-text minimum, so outlines, chips and icons in primary will be hard to see.` });
  }
  if (ratios.accent_on_surface != null && ratios.accent_on_surface < 4.5) {
    warnings.push({ field: 'accent', message: `Accent text on the surface is ${ratios.accent_on_surface}:1. Keep accent for fills and rules, not body copy.` });
  }
  if (ratios.muted_on_surface != null && ratios.muted_on_surface < 4.5) {
    warnings.push({ field: 'muted', message: `Muted text on the surface is ${ratios.muted_on_surface}:1 — secondary copy will fail AA.` });
  }
  if (p.primary && p.accent && contrast(p.primary, p.accent) < 1.4) {
    warnings.push({ field: 'accent', message: 'Primary and accent are nearly the same tone; the two will not read as distinct.' });
  }

  return { ok: errors.length === 0, errors, warnings, palette: p, contrast: ratios };
}

/**
 * Derive the full CSS-variable set the shell paints with. Everything is derived
 * from the operator's own colours — no colour is introduced from outside the
 * supplied schema except pure white/black mixes of those colours.
 */
function tokens(brand) {
  const p = normalizePalette((brand && brand.palette) || {});
  const primary = p.primary || '#6A33D8';
  const accent = p.accent || primary;
  const ink = p.ink || '#111111';
  const surface = p.surface || '#F7F5F2';
  const surfaceAlt = p.surface_alt || shade(surface, 0.6);
  const muted = p.muted || shade(ink, 0.35);
  const t = brand && brand.typography ? brand.typography : {};

  return {
    '--brand-primary': primary,
    '--brand-primary-dark': shade(primary, -0.25),
    '--brand-primary-soft': shade(primary, 0.86),
    '--brand-primary-tint': shade(primary, 0.94),
    '--brand-on-primary': readableOn(primary, ink, surface, surfaceAlt),
    '--brand-accent': accent,
    '--brand-accent-soft': shade(accent, 0.88),
    '--brand-on-accent': readableOn(accent, ink, surface, surfaceAlt),
    '--brand-ink': ink,
    '--brand-ink-muted': muted,
    '--brand-surface': surface,
    '--brand-surface-alt': surfaceAlt,
    '--brand-line': shade(ink, 0.84),
    '--brand-line-strong': shade(ink, 0.68),
    '--brand-ok': p.ok || '#1a7f37',
    '--brand-warn': p.warn || '#c9a227',
    '--brand-err': p.err || '#c0392b',
    '--brand-font-head': (t.heading && t.heading.stack) || "'Montserrat',Georgia,serif",
    '--brand-font-body': (t.body && t.body.stack) || "system-ui,-apple-system,Segoe UI,sans-serif",
    '--brand-font-mono': (t.mono && t.mono.stack) || 'ui-monospace,SFMono-Regular,Menlo,monospace',
  };
}

/** Google Fonts stylesheet URL for whichever families are marked google:true. */
function fontsHref(brand) {
  const t = (brand && brand.typography) || {};
  const families = [];
  for (const slot of ['heading', 'body', 'mono']) {
    const f = t[slot];
    if (!f || !f.family || f.google === false) continue;
    const fam = String(f.family).trim().replace(/\s+/g, '+');
    const weights = String(f.weights || '400;600;700').replace(/[^0-9;]/g, '');
    if (!fam) continue;
    const spec = weights ? `family=${fam}:wght@${weights}` : `family=${fam}`;
    if (!families.includes(spec)) families.push(spec);
  }
  if (!families.length) return '';
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

/* ── readiness (the zero-fabrication gate) ────────────────────────────────── */

/**
 * What is still missing before this brand can launch anything. Reported, never
 * filled in. Marker format is the spec's:
 *   [DATA REQUIRED BEFORE LAUNCH: <field>, <product>, <region>]
 */
function readiness(brand, counts) {
  const missing = [];
  const add = (field, product, region) => missing.push({
    field, product: product || 'all', region: region || 'all',
    marker: `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${product || 'all'}, ${region || 'all'}]`,
  });

  const b = brand || {};
  if (!str(b.name)) add('brand name');
  if (!str(b.website)) add('brand website');
  if (!str(b.logo_url)) add('logo URL');

  const pv = validatePalette(b.palette || {});
  if (!pv.ok) for (const e of pv.errors) add(`palette.${e.field}`);

  const ty = b.typography || {};
  if (!ty.heading || !ty.heading.family) add('typography.heading');
  if (!ty.body || !ty.body.family) add('typography.body');

  const voice = b.voice || {};
  if (!str(voice.tone)) add('voice.tone');
  if (!arr(voice.banned).length) add('voice.banned phrases');

  const regions = Array.isArray(b.regions) ? b.regions : [];
  if (!regions.length) add('regions');
  for (const r of regions) if (!r.store_url) add('region store URL', 'all', r.code);
  for (const r of regions) if (!r.currency) add('region currency', 'all', r.code);

  const productCount = counts && typeof counts.products === 'number' ? counts.products : null;
  if (productCount === 0) add('product catalog');

  const blocking = missing.filter((m) => /^(brand name|palette\.|typography\.|regions$|product catalog)/.test(m.field));
  return {
    ready: blocking.length === 0,
    missing,
    markers: missing.map((m) => m.marker),
    palette: { errors: pv.errors, warnings: pv.warnings, contrast: pv.contrast },
    products: productCount,
    // Mirrors the spec's launch-gate language rather than inventing a new one.
    status_line: blocking.length === 0
      ? 'BRAND READY'
      : 'NOT LAUNCH READY — DATA DEPENDENCY',
  };
}

/* ── catalog import ───────────────────────────────────────────────────────── */

/** RFC4180-ish CSV parser (quotes, escaped quotes, embedded newlines, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

const COLUMN_ALIASES = {
  title: ['title', 'name', 'product', 'product name', 'product title', 'item'],
  handle: ['handle', 'slug', 'url handle', 'permalink'],
  sku: ['sku', 'variant sku', 'id', 'product id', 'item code', 'style code'],
  description: ['description', 'body', 'body (html)', 'body html', 'details'],
  product_type: ['type', 'product type', 'category', 'product category'],
  collections: ['collection', 'collections', 'category path', 'product collection'],
  price: ['price', 'variant price', 'selling price', 'mrp', 'amount'],
  compare_at: ['compare at price', 'compare_at_price', 'variant compare at price', 'was price', 'list price'],
  currency: ['currency', 'currency code'],
  image_url: ['image', 'image src', 'image url', 'featured image', 'img', 'image_link'],
  product_url: ['url', 'product url', 'link', 'product link'],
  in_stock: ['available', 'in stock', 'in_stock', 'status', 'stock'],
  tags: ['tags', 'tag', 'keywords'],
};

function mapHeaders(headers) {
  const map = {};
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    let idx = lower.findIndex((h) => aliases.includes(h));
    if (idx < 0) idx = lower.findIndex((h) => h && aliases.some((a) => h.includes(a)));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

function num(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}

function boolish(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  if (['true', 'yes', 'y', '1', 'active', 'in stock', 'available'].includes(s)) return true;
  if (['false', 'no', 'n', '0', 'draft', 'archived', 'out of stock', 'sold out'].includes(s)) return false;
  return null;
}

function splitList(v) {
  return String(v == null ? '' : v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
}

function rowsFromCsv(text, region) {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], columns: {}, skipped: 0 };
  const headers = grid[0];
  const map = mapHeaders(headers);
  if (map.title == null) {
    const err = new Error('Could not find a product title/name column in the CSV header.');
    err.status = 400;
    throw err;
  }
  const rows = [];
  let skipped = 0;
  for (const line of grid.slice(1, MAX_CATALOG_ROWS + 1)) {
    const get = (f) => (map[f] == null ? '' : line[map[f]]);
    const title = str(get('title'), 300);
    if (!title) { skipped++; continue; }
    const raw = {};
    headers.forEach((h, i) => { if (String(h || '').trim()) raw[String(h).trim()] = line[i] == null ? '' : String(line[i]); });
    rows.push({
      region,
      title,
      handle: str(get('handle'), 200) || slugify(title),
      sku: str(get('sku'), 120) || null,
      description: str(get('description'), 4000) || null,
      product_type: str(get('product_type'), 120) || null,
      collections: splitList(get('collections')),
      price: num(get('price')),
      compare_at: num(get('compare_at')),
      currency: str(get('currency'), 8).toUpperCase() || null,
      image_url: httpUrl(get('image_url')) || null,
      product_url: httpUrl(get('product_url')) || null,
      in_stock: boolish(get('in_stock')),
      tags: splitList(get('tags')),
      raw,
      source: 'csv',
    });
  }
  return { rows, columns: map, skipped };
}

function rowsFromJson(text, region) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; }
  catch (_) { const e = new Error('That is not valid JSON.'); e.status = 400; throw e; }
  const list = Array.isArray(data) ? data
    : Array.isArray(data && data.products) ? data.products
    : Array.isArray(data && data.items) ? data.items : null;
  if (!list) { const e = new Error('Expected a JSON array of products, or an object with a "products" array.'); e.status = 400; throw e; }
  const rows = [];
  let skipped = 0;
  for (const p of list.slice(0, MAX_CATALOG_ROWS)) {
    if (!p || typeof p !== 'object') { skipped++; continue; }
    const title = str(p.title || p.name || p.n, 300);
    if (!title) { skipped++; continue; }
    rows.push({
      region,
      title,
      handle: str(p.handle || p.h || p.slug, 200) || slugify(title),
      sku: str(p.sku || p.id, 120) || null,
      description: str(p.description || p.body_html || p.body, 4000) || null,
      product_type: str(p.product_type || p.type || p.category, 120) || null,
      collections: Array.isArray(p.collections) ? arr(p.collections, 30).map((c) => str(typeof c === 'object' ? (c.title || c.handle) : c, 120)) : splitList(p.collections),
      price: num(p.price != null ? p.price : (Array.isArray(p.variants) && p.variants[0] ? p.variants[0].price : null)),
      compare_at: num(p.compare_at_price != null ? p.compare_at_price : (Array.isArray(p.variants) && p.variants[0] ? p.variants[0].compare_at_price : null)),
      currency: str(p.currency, 8).toUpperCase() || null,
      image_url: httpUrl(p.image_url || p.img || (p.image && (p.image.src || p.image.url)) || (Array.isArray(p.images) && p.images[0] && (p.images[0].src || p.images[0].url))) || null,
      product_url: httpUrl(p.product_url || p.url || p.link) || null,
      in_stock: typeof p.available === 'boolean' ? p.available : boolish(p.available != null ? p.available : p.status),
      tags: Array.isArray(p.tags) ? arr(p.tags, 30).map((t) => str(t, 60)) : splitList(p.tags),
      raw: p,
      source: 'json',
    });
  }
  return { rows, columns: {}, skipped };
}

/* ── SSRF guard for the storefront importer ───────────────────────────────────
   The importer fetches a URL supplied by any signed-in user, from inside the
   serverless runtime. Without a guard that is a server-side request forgery
   primitive against anything the runtime can reach (cloud metadata endpoints,
   internal services). Everything below is refused:
     * non-http(s) schemes and non-standard ports
     * loopback / private / link-local / CGNAT / unique-local literals
     * the cloud metadata addresses and *.internal / *.local style names
     * any hostname whose DNS resolution lands on one of those ranges
     * redirects (fetch is issued with redirect:'manual'), so a public host
       cannot bounce us onto an internal one
   DNS rebinding between the check and the connect is not fully preventable
   without pinning the socket to the resolved IP, which needs a custom agent;
   blocking redirects and re-validating every hop removes the practical paths. */

const BLOCKED_HOST_RX = /^(localhost|.*\.localhost|.*\.internal|.*\.local|.*\.home\.arpa|metadata|metadata\.google\.internal)$/i;

function isPrivateV4(octets) {
  const [a, b] = octets;
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;                    // this-host, private, loopback
  if (a === 169 && b === 254) return true;                              // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;                     // private
  if (a === 192 && b === 168) return true;                              // private
  if (a === 192 && b === 0) return true;                                // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true;                    // CGNAT
  if (a >= 224) return true;                                            // multicast + reserved
  return false;
}

/**
 * Expand an IPv6 literal to its eight 16-bit groups.
 * Returns null if it does not parse as IPv6.
 *
 * This matters because Node canonicalises `[::ffff:127.0.0.1]` to
 * `::ffff:7f00:1` — the loopback address written in HEX. A guard that only
 * strips a literal `::ffff:` prefix and hands the rest to an IPv4 parser sees
 * `7f00:1`, fails to parse it, and lets loopback through. The mapped address
 * has to be DECODED, not string-matched.
 */
function v6Groups(host) {
  let h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');  // strip zone id
  if (!/^[0-9a-f:.]*$/.test(h) || h.indexOf(':') < 0) return null;

  // A trailing dotted quad (::ffff:127.0.0.1) becomes two hex groups.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (dotted) {
    const o = dotted.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    const hi = ((o[0] << 8) | o[1]).toString(16);
    const lo = ((o[2] << 8) | o[3]).toString(16);
    h = h.slice(0, dotted.index) + hi + ':' + lo;
  }

  const halves = h.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;

  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = head.concat(Array(halves.length === 2 ? fill : 0).fill('0'), tail);
  if (groups.length !== 8) return null;

  const out = [];
  for (const g of groups) {
    if (g === '') return null;
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function isPrivateIp(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) return isPrivateV4(v4.slice(1).map(Number));

  const g = v6Groups(h);
  if (!g) return false;

  // Unspecified :: and loopback ::1
  if (g.every((x) => x === 0)) return true;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;

  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d — decode and
  // apply the IPv4 rules to the embedded address.
  const firstSixZero = g.slice(0, 5).every((x) => x === 0);
  if (firstSixZero && (g[5] === 0xffff || g[5] === 0)) {
    const o = [(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff];
    if (!(o[0] === 0 && o[1] === 0 && o[2] === 0 && o[3] === 0)) return isPrivateV4(o);
  }
  // NAT64 well-known prefix 64:ff9b::/96 also embeds an IPv4 address.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateV4([(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff]);
  }

  if ((g[0] & 0xfe00) === 0xfc00) return true;                          // unique-local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true;                          // link-local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true;                          // multicast ff00::/8
  return false;
}

async function assertPublicUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch (_) { const e = new Error('That is not a valid URL.'); e.status = 400; throw e; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') { const e = new Error('Only http and https URLs can be imported.'); e.status = 400; throw e; }
  if (u.port && u.port !== '80' && u.port !== '443') { const e = new Error('Only the standard http and https ports can be imported.'); e.status = 400; throw e; }

  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOST_RX.test(host) || isPrivateIp(host)) {
    const e = new Error('That address is on a private or internal network, so it cannot be imported.');
    e.status = 400; throw e;
  }

  // Resolve the name and refuse if ANY answer is on an internal range.
  try {
    const dns = require('dns').promises;
    const answers = await dns.lookup(host, { all: true, verbatim: true });
    for (const a of answers) {
      if (isPrivateIp(a.address)) {
        const e = new Error('That hostname resolves to a private or internal address, so it cannot be imported.');
        e.status = 400; throw e;
      }
    }
  } catch (err) {
    if (err && err.status === 400) throw err;
    // A resolution failure is reported as unreachable, not silently allowed.
    const e = new Error(`Could not resolve ${host}.`);
    e.status = 400; throw e;
  }
  return u.toString().replace(/\/$/, '');
}

/**
 * Import from a PUBLIC storefront the operator owns. Read-only: GET only, no
 * credentials, no redirects, only the standard Shopify public products feed,
 * and only after the SSRF guard above clears the destination. Facts are copied
 * verbatim from the store; nothing is synthesised.
 */
/**
 * Catalogue from the brand's OWN SITE, for every brand without a product feed.
 *
 * rowsFromStorefront can read exactly one thing: a Shopify /products.json. A
 * publisher, an events programme, a service, or any store not on Shopify had no
 * route in at all, so its assets fell back to DATA REQUIRED markers.
 *
 * This crawls the brand's interlinked pages and takes only what the site itself
 * DECLARES in structured data. See _shared/site-crawl.js for why nothing is
 * read out of prose.
 */
async function rowsFromSite(startUrl, region, brand) {
  const { crawlSite } = require('./site-crawl.js');
  const candidate = httpUrl(startUrl) || (brand && brand.website) || '';
  if (!candidate) { const e = new Error('A site URL is required to crawl.'); e.status = 400; throw e; }
  // Same SSRF guard the storefront import uses: a public host must not be able
  // to bounce this onto an internal one.
  const base = await assertPublicUrl(candidate);

  const out = await crawlSite(base, { brand: brand || { website: base } });
  if (!out.ok) {
    const e = new Error(out.error === 'start_url_out_of_scope'
      ? 'That URL is not on this brand\'s own domain. A catalogue may only be crawled from the brand\'s own site.'
      : 'The site crawl could not start.');
    e.status = 400; throw e;
  }

  const rows = [];
  for (const o of out.offerings) {
    const title = str(o.name, 300);
    if (!title) continue;
    rows.push({
      region,
      title,
      handle: slugify(title),
      sku: str(o.sku, 120) || null,
      description: str(o.description, 4000) || null,
      product_type: str(o.kind, 120) || null,
      collections: [],
      price: num(o.price),
      compare_at: null,
      currency: str(o.currency, 8).toUpperCase() || null,
      image_url: httpUrl(o.image) || null,
      product_url: httpUrl(o.url) || null,
      in_stock: null,
      tags: [],
      source: 'site_crawl',
    });
    if (rows.length >= MAX_CATALOG_ROWS) break;
  }

  return {
    rows, base,
    // Carried through so the caller can surface it rather than presenting a
    // partial crawl as the whole catalogue.
    crawl: {
      pages_visited: out.pages_visited, stopped: out.stopped,
      coverage_note: out.coverage_note, images: out.images, notes: out.notes,
    },
  };
}

async function rowsFromStorefront(storeUrl, region) {
  const candidate = httpUrl(storeUrl);
  if (!candidate) { const e = new Error('Store URL is not a valid http(s) URL.'); e.status = 400; throw e; }
  const base = await assertPublicUrl(candidate);
  const rows = [];
  let page = 1, skipped = 0;
  while (page <= 10 && rows.length < MAX_CATALOG_ROWS) {
    const url = `${base}/products.json?limit=250&page=${page}`;
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store', redirect: 'manual' });
    } catch (err) { const e = new Error(`Could not reach ${base}: ${err.message}`); e.status = 502; throw e; }
    if (res.status >= 300 && res.status < 400) {
      const e = new Error(`${base} redirected the request. Enter the store's canonical URL directly (redirects are not followed, so a public host cannot bounce the import onto an internal one).`);
      e.status = 400; throw e;
    }
    if (!res.ok) {
      if (page === 1) { const e = new Error(`${base}/products.json returned ${res.status}. Public product feed not available at that URL.`); e.status = 502; throw e; }
      break;
    }
    let json;
    try { json = await res.json(); } catch (_) { break; }
    const list = Array.isArray(json && json.products) ? json.products : [];
    if (!list.length) break;
    for (const p of list) {
      const parsed = rowsFromJson({ products: [p] }, region);
      for (const r of parsed.rows) {
        r.source = 'shopify_public';
        if (!r.product_url && r.handle) r.product_url = `${base}/products/${r.handle}`;
        rows.push(r);
      }
      skipped += parsed.skipped;
    }
    page++;
  }
  return { rows: rows.slice(0, MAX_CATALOG_ROWS), columns: {}, skipped, base };
}

/* ── workspace operations ─────────────────────────────────────────────────── */

/**
 * Every brand write goes through here so the in-memory caches downstream cannot
 * outlive the row they describe.
 *
 * brand-runtime caches the workspace for 30s and workspace-scope caches both the
 * workspace row and the user's active workspace for 60s. Nothing used to clear
 * either, so for that window after a save or a brand switch the generators kept
 * building from the previous brand: correct-looking assets carrying the wrong
 * identity, which nothing else in the system would ever notice.
 *
 * Required lazily because brand-runtime requires THIS module at load time; a
 * top-level require here would close the cycle.
 */
function invalidateBrandCaches({ userId, workspaceId } = {}) {
  try { require('./brand-runtime.js').invalidate(workspaceId); } catch (_) { /* cache clearing must never fail a write */ }
  try { require('./workspace-scope.js').invalidate({ userId, workspaceId }); } catch (_) { /* same */ }
}

const SELECT_COLS = 'id,slug,name,legal_name,tagline,industry,website,logo_url,favicon_url,palette,typography,voice,regions,asset_hosts,catalog_source,brand_data,status,onboarding_step,owner_id,created_at,updated_at';

async function listWorkspaces(auth) {
  const rows = await restAs(auth.token, `brand_workspaces?select=${SELECT_COLS}&order=updated_at.desc`);
  return Array.isArray(rows) ? rows : [];
}

async function getWorkspace(auth, id) {
  const rows = await restAs(auth.token, `brand_workspaces?select=${SELECT_COLS}&id=eq.${encodeURIComponent(id)}&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function productCount(auth, id) {
  try {
    const rows = await restAs(auth.token, `brand_catalog_products?select=id&workspace_id=eq.${encodeURIComponent(id)}&limit=${MAX_CATALOG_ROWS}`);
    return Array.isArray(rows) ? rows.length : 0;
  } catch (_) { return 0; }
}

async function activeWorkspaceId(auth) {
  const rows = await restAs(auth.token, `brand_user_prefs?select=active_workspace_id&user_id=eq.${encodeURIComponent(auth.user_id)}&limit=1`);
  return (Array.isArray(rows) && rows[0] && rows[0].active_workspace_id) || null;
}

/**
 * Give a newly-live brand its own competitor universe.
 *
 * Competitor Benchmarking is one of the first screens a new brand opens, and it
 * used to open empty for everyone because the universe lived in a Google Sheet
 * nobody had credentials for. Activation is the natural moment to fill it: it
 * is the point at which the brand record is complete enough to describe its own
 * market.
 *
 * Deliberately narrow. It derives ONLY from this brand's own record (its
 * competitor list and its market study), it makes no LLM or third-party call so
 * activation cannot hang on a provider, and it does nothing at all if the brand
 * already has a universe. Every failure is swallowed: a competitor set is
 * useful, but it is never a reason to block a user from activating their brand.
 */
async function seedCompetitorsOnActivation(auth, ws) {
  try {
    if (!ws || !ws.id || ws.status !== 'active') return null;
    const universe = require('./competitor-universe.js');
    const brandRuntime = require('./brand-runtime.js');
    return await universe.seedForWorkspace(universe.userStore(auth.token), ws.id, {
      brand: brandRuntime.normalizeBrand(ws),
      // Switching back to a brand that is already set up must be a no-op.
      onlyIfEmpty: true,
    });
  } catch (err) {
    console.warn('[brand] competitor seed skipped:', (err && err.message) || err);
    return null;
  }
}

async function setActive(auth, id) {
  const ws = await getWorkspace(auth, id);
  if (!ws) { const e = new Error('Workspace not found (or not yours).'); e.status = 404; throw e; }
  await restAs(auth.token, 'brand_user_prefs?on_conflict=user_id', {
    method: 'POST',
    body: [{ user_id: auth.user_id, active_workspace_id: id, updated_at: new Date().toISOString() }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  // Clear BEFORE the seeding call: everything downstream of this point resolves
  // the user's active workspace, and the cached answer is now the previous one.
  invalidateBrandCaches({ userId: auth.user_id, workspaceId: id });
  await seedCompetitorsOnActivation(auth, ws);
  return ws;
}

/** Build the exact row we persist — every field normalised, none invented. */
function buildRow(input, existing) {
  const b = input && typeof input === 'object' ? input : {};
  const prev = existing || {};
  const name = str(b.name, 120) || str(prev.name, 120);
  if (!name) { const e = new Error('Brand name is required.'); e.status = 400; throw e; }

  const regions = b.regions !== undefined ? normalizeRegions(b.regions) : (prev.regions || []);
  const row = {
    slug: slugify(b.slug || prev.slug || name) || `brand-${Date.now().toString(36)}`,
    name,
    legal_name: b.legal_name !== undefined ? str(b.legal_name, 200) : (prev.legal_name || null),
    tagline: b.tagline !== undefined ? str(b.tagline, 300) : (prev.tagline || null),
    industry: b.industry !== undefined ? str(b.industry, 120) : (prev.industry || null),
    website: b.website !== undefined ? httpUrl(b.website) : (prev.website || null),
    logo_url: b.logo_url !== undefined ? httpUrl(b.logo_url) : (prev.logo_url || null),
    favicon_url: b.favicon_url !== undefined ? httpUrl(b.favicon_url) : (prev.favicon_url || null),
    palette: b.palette !== undefined ? normalizePalette(b.palette) : (prev.palette || {}),
    typography: b.typography !== undefined ? normalizeTypography(b.typography) : (prev.typography || {}),
    voice: b.voice !== undefined ? normalizeVoice(b.voice) : (prev.voice || {}),
    regions,
    asset_hosts: normalizeHosts(b.asset_hosts !== undefined ? b.asset_hosts : (prev.asset_hosts || []), regions),
    catalog_source: b.catalog_source !== undefined && b.catalog_source && typeof b.catalog_source === 'object'
      ? b.catalog_source : (prev.catalog_source || {}),
    brand_data: b.brand_data !== undefined && b.brand_data && typeof b.brand_data === 'object'
      ? b.brand_data : (prev.brand_data || {}),
    status: ['draft', 'active', 'archived'].includes(str(b.status)) ? str(b.status) : (prev.status || 'draft'),
    onboarding_step: Number.isFinite(+b.onboarding_step) ? Math.max(1, Math.min(6, +b.onboarding_step)) : (prev.onboarding_step || 1),
  };

  // Colour schema is validated on save, so a broken palette can never reach the
  // shell. A DRAFT may still be saved with an incomplete palette (the wizard
  // saves as it goes); anything ACTIVE must pass — including an EMPTY palette,
  // which previously skipped the check entirely and let a direct API client
  // activate a brand with no colours at all, after which tokens() quietly
  // filled it with the shipped tenant's defaults.
  if (row.status === 'active') {
    const v = validatePalette(row.palette);
    if (!v.ok) { const e = new Error('Colour schema fails the design rules.'); e.status = 400; e.details = v.errors; throw e; }
  }
  return row;
}

async function saveWorkspace(auth, input) {
  const id = str(input && input.id);
  if (id) {
    const existing = await getWorkspace(auth, id);
    if (!existing) { const e = new Error('Workspace not found (or not yours).'); e.status = 404; throw e; }
    const row = buildRow(input, existing);
    const saved = await restAs(auth.token, `brand_workspaces?id=eq.${encodeURIComponent(id)}&select=${SELECT_COLS}`, {
      method: 'PATCH', body: row, prefer: 'return=representation',
    });
    invalidateBrandCaches({ userId: auth.user_id, workspaceId: id });
    return Array.isArray(saved) ? saved[0] : saved;
  }
  const row = buildRow(input, null);
  row.owner_id = auth.user_id;
  const created = await restAs(auth.token, `brand_workspaces?select=${SELECT_COLS}`, {
    method: 'POST', body: [row], prefer: 'return=representation',
  });
  const ws = Array.isArray(created) ? created[0] : created;
  // First workspace a user creates becomes their active one automatically.
  if (ws && ws.id && !(await activeWorkspaceId(auth))) await setActive(auth, ws.id);
  invalidateBrandCaches({ userId: auth.user_id, workspaceId: ws && ws.id });
  return ws;
}

async function deleteWorkspace(auth, id) {
  await restAs(auth.token, `brand_workspaces?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
  // Nothing survives a delete: the default-workspace cache is keyed on "oldest
  // row", which the delete may itself have removed.
  invalidateBrandCaches({ userId: auth.user_id, workspaceId: id });
  return { ok: true, deleted: id };
}

/** Owner or editor. A `viewer` may read a workspace but must not change it. */
async function assertCanWrite(auth, workspaceId, what) {
  const ws = await getWorkspace(auth, workspaceId);
  if (!ws) { const e = new Error('Workspace not found (or not yours).'); e.status = 404; throw e; }
  if (ws.owner_id === auth.user_id) return ws;
  let role = 'viewer';
  try {
    const rows = await restAs(auth.token, `brand_workspace_members?select=role&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(auth.user_id)}&limit=1`);
    if (Array.isArray(rows) && rows[0] && rows[0].role) role = String(rows[0].role);
  } catch (_) { /* least privilege on an unknown role */ }
  if (role !== 'owner' && role !== 'editor') {
    const e = new Error(`Your role on this brand is "${role}", which can view it but not ${what || 'change it'}. Ask the workspace owner for editor access.`);
    e.status = 403; throw e;
  }
  return ws;
}

async function importCatalog(auth, { workspace_id, region = 'us', kind, text, url, replace = true }) {
  // A replacement import can destroy the whole catalog, so membership is not
  // enough — this needs write permission. The RLS policy enforces it too
  // (20260809150000), but failing here gives the user a real message.
  const ws = await assertCanWrite(auth, workspace_id, 'import or replace its catalog');
  const reg = str(region, 12).toLowerCase() || 'us';
  const k = str(kind).toLowerCase();

  if (text && String(text).length > MAX_UPLOAD_CHARS) {
    const e = new Error(`That file is too large (max ${Math.round(MAX_UPLOAD_CHARS / 1e6)}MB of text per import).`);
    e.status = 413; throw e;
  }

  let parsed;
  if (k === 'storefront' || k === 'shopify_public') parsed = await rowsFromStorefront(url, reg);
  else if (k === 'site' || k === 'site_crawl') parsed = await rowsFromSite(url, reg, ws);
  else if (k === 'json') parsed = rowsFromJson(text, reg);
  else if (k === 'csv') parsed = rowsFromCsv(text, reg);
  else { const e = new Error('kind must be one of: csv, json, storefront, site.'); e.status = 400; throw e; }

  if (!parsed.rows.length) { const e = new Error('No usable product rows were found in that source.'); e.status = 400; throw e; }

  // De-dupe on the table's unique key before insert so one bad source row can't
  // abort the whole import.
  const batch = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : require('crypto').randomUUID();
  const seen = new Set();
  const payload = [];
  for (const r of parsed.rows) {
    const key = `${r.region}|${r.handle || ''}|${r.sku || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    payload.push(Object.assign({ workspace_id, import_batch: batch }, r));  // workspace_id/import_batch ignored by the RPC, used by the additive path
  }

  let inserted = 0;
  if (replace) {
    // ATOMIC REPLACE. Chunked upserts cannot be made all-or-nothing from here:
    // the unique key is (workspace_id, region, handle, sku), so an upsert
    // OVERWRITES a matching existing row in place, and a failure after the
    // first chunk would leave a mixture of old, overwritten and new rows that
    // skipping a final delete could not undo. The delete and the insert must
    // therefore happen in ONE database call, which is one transaction — that
    // is what brand_catalog_replace() does. A failure rolls the whole swap
    // back and the previous catalog survives untouched.
    const out = await restAs(auth.token, 'rpc/brand_catalog_replace', {
      method: 'POST',
      body: { p_workspace: workspace_id, p_region: reg, p_rows: payload, p_batch: batch },
    });
    inserted = (out && typeof out.inserted === 'number') ? out.inserted : payload.length;
  } else {
    // Additive import: no existing row is destroyed, so per-chunk failure is
    // recoverable by simply re-running it.
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500);
      await restAs(auth.token, 'brand_catalog_products?on_conflict=workspace_id,region,handle,sku', {
        method: 'POST', body: chunk, prefer: 'resolution=merge-duplicates,return=minimal',
      });
      inserted += chunk.length;
    }
  }

  const source = {
    kind: k === 'storefront' ? 'shopify_public' : (k === 'site' ? 'site_crawl' : k),
    url: (k === 'storefront' || k === 'site' || k === 'site_crawl') ? (parsed.base || httpUrl(url)) : '',
    imported_at: new Date().toISOString(),
    row_count: inserted,
    batch,
    region: reg,
    columns: parsed.columns || {},
  };
  await restAs(auth.token, `brand_workspaces?id=eq.${encodeURIComponent(workspace_id)}`, {
    method: 'PATCH', body: { catalog_source: source }, prefer: 'return=minimal',
  });
  // catalog_source lives on the workspace row that the generators read, so an
  // import that is not followed by this keeps planning from the old catalogue.
  invalidateBrandCaches({ userId: auth.user_id, workspaceId: workspace_id });

  return { ok: true, imported: inserted, skipped: parsed.skipped || 0, region: reg, source };
}

async function listCatalog(auth, { workspace_id, region, limit = 60 }) {
  const lim = Math.max(1, Math.min(500, +limit || 60));
  let q = `brand_catalog_products?select=id,region,sku,handle,title,product_type,collections,price,compare_at,currency,image_url,product_url,in_stock,source&workspace_id=eq.${encodeURIComponent(workspace_id)}&order=title.asc&limit=${lim}`;
  if (region) q += `&region=eq.${encodeURIComponent(String(region).toLowerCase())}`;
  const rows = await restAs(auth.token, q);
  return Array.isArray(rows) ? rows : [];
}

/** The payload the browser shell needs to become this brand. */
function shellPayload(brand, extra) {
  if (!brand) return null;
  return Object.assign({
    id: brand.id || null,
    slug: brand.slug || '',
    name: brand.name || '',
    tagline: brand.tagline || '',
    logo_url: brand.logo_url || '',
    favicon_url: brand.favicon_url || '',
    website: brand.website || '',
    status: brand.status || 'draft',
    onboarding_step: brand.onboarding_step || 1,
    palette: brand.palette || {},
    typography: brand.typography || {},
    voice: brand.voice || {},
    regions: brand.regions || [],
    tokens: tokens(brand),
    fonts_href: fontsHref(brand),
  }, extra || {});
}

/* ── the router (mounted at /api/public-config?action=brand) ──────────────── */

async function handle(req, res) {
  const q = (req && req.query) || {};
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const op = str(q.op || body.op).toLowerCase() || 'active';

  // `defaults` is the only unauthenticated op: it hands the sign-in screen the
  // shipped default brand so the shell is never unstyled before login.
  if (op === 'defaults') {
    const b = DEFAULT_BRAND;
    return res.status(200).json({ ok: true, brand: b ? shellPayload(b, { id: null, is_default: true }) : null });
  }
  // `presets` is unauthenticated like `defaults`: the onboarding gallery must
  // render before a workspace exists. Returns the starter brand library
  // (data/brands/presets), or one full record with ?slug=. These are TEMPLATES
  // built from each brand's own public site - never a licence to use the marks.
  if (op === 'presets') {
    try {
      const dir = path.join(process.cwd(), 'data', 'brands', 'presets');
      const slug = str(q.slug || body.slug).toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (slug) {
        const f = path.join(dir, `${slug}.json`);
        if (!fs.existsSync(f)) return res.status(404).json({ ok: false, error: 'preset_not_found' });
        return res.status(200).json({ ok: true, preset: JSON.parse(fs.readFileSync(f, 'utf8')) });
      }
      const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
      return res.status(200).json({ ok: true, ...idx });
    } catch (e) {
      return res.status(200).json({ ok: true, count: 0, presets: [], error: e.message });
    }
  }

  if (op === 'validate-palette') {
    return res.status(200).json(Object.assign({ ok: true }, validatePalette(body.palette || q.palette || {})));
  }

  const auth = await requireUser(req);
  if (!auth.ok) return res.status(auth.status || 401).json(auth);

  try {
    switch (op) {
      case 'list': {
        const rows = await listWorkspaces(auth);
        const active = await activeWorkspaceId(auth);
        return res.status(200).json({ ok: true, workspaces: rows.map((w) => shellPayload(w)), active_id: active, user: { id: auth.user_id, email: auth.email } });
      }
      case 'active': {
        const id = await activeWorkspaceId(auth);
        if (!id) {
          const all = await listWorkspaces(auth);
          // No active brand and nothing onboarded yet → the shell sends the user
          // to /onboarding. This is the "first screen asks for the brand" path.
          return res.status(200).json({ ok: true, brand: null, needs_onboarding: all.length === 0, workspaces: all.map((w) => shellPayload(w)), user: { id: auth.user_id, email: auth.email } });
        }
        const ws = await getWorkspace(auth, id);
        if (!ws) return res.status(200).json({ ok: true, brand: null, needs_onboarding: true, user: { id: auth.user_id, email: auth.email } });
        const products = await productCount(auth, id);
        return res.status(200).json({
          ok: true,
          brand: shellPayload(ws, { readiness: readiness(ws, { products }), products }),
          needs_onboarding: false,
          user: { id: auth.user_id, email: auth.email },
        });
      }
      case 'get': {
        const ws = await getWorkspace(auth, str(q.id || body.id));
        if (!ws) return res.status(404).json({ ok: false, error: 'workspace_not_found' });
        const products = await productCount(auth, ws.id);
        return res.status(200).json({ ok: true, brand: Object.assign({}, ws, { tokens: tokens(ws), fonts_href: fontsHref(ws), readiness: readiness(ws, { products }), products }) });
      }
      case 'save': {
        const ws = await saveWorkspace(auth, body.brand || body);
        const products = ws && ws.id ? await productCount(auth, ws.id) : 0;
        return res.status(200).json({ ok: true, brand: Object.assign({}, ws, { tokens: tokens(ws), fonts_href: fontsHref(ws), readiness: readiness(ws, { products }), products }) });
      }
      case 'activate': {
        const ws = await setActive(auth, str(body.id || q.id));
        const products = await productCount(auth, ws.id);
        return res.status(200).json({ ok: true, brand: shellPayload(ws, { readiness: readiness(ws, { products }), products }) });
      }
      case 'delete': {
        return res.status(200).json(await deleteWorkspace(auth, str(body.id || q.id)));
      }
      case 'catalog-import': {
        return res.status(200).json(await importCatalog(auth, {
          workspace_id: str(body.workspace_id || q.workspace_id),
          region: body.region || q.region || 'us',
          kind: body.kind || q.kind,
          text: body.text,
          url: body.url || q.url,
          replace: body.replace !== false,
        }));
      }
      case 'catalog': {
        const rows = await listCatalog(auth, {
          workspace_id: str(q.workspace_id || body.workspace_id),
          region: q.region || body.region,
          limit: q.limit || body.limit,
        });
        return res.status(200).json({ ok: true, products: rows, count: rows.length });
      }
      case 'readiness': {
        const ws = await getWorkspace(auth, str(q.id || body.id));
        if (!ws) return res.status(404).json({ ok: false, error: 'workspace_not_found' });
        return res.status(200).json({ ok: true, readiness: readiness(ws, { products: await productCount(auth, ws.id) }) });
      }
      default:
        return res.status(400).json({
          ok: false, error: 'unknown_brand_operation',
          available: ['defaults', 'list', 'active', 'get', 'save', 'activate', 'delete', 'catalog-import', 'catalog', 'readiness', 'validate-palette'],
        });
    }
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    return res.status(status).json({ ok: false, error: err.message || 'brand_operation_failed', details: err.details || undefined });
  }
}

module.exports = {
  handle,
  requireUser,
  restAs,
  // colour
  normHex, contrast, luminance, saturation, isDarkNeutral, shade, readableOn, validatePalette,
  // brand
  normalizePalette, normalizeTypography, normalizeVoice, normalizeRegions, tokens, fontsHref,
  readiness, shellPayload, slugify, DEFAULT_BRAND,
  // catalog
  parseCsv, rowsFromCsv, rowsFromJson, rowsFromStorefront, assertPublicUrl, isPrivateIp,
  // data access
  listWorkspaces, getWorkspace, activeWorkspaceId, setActive, saveWorkspace, deleteWorkspace,
  importCatalog, listCatalog, assertCanWrite, seedCompetitorsOnActivation,
};
