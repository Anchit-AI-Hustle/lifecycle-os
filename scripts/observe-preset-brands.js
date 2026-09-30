#!/usr/bin/env node
'use strict';
/**
 * scripts/observe-preset-brands.js — read each starter brand's own site
 * in a browser and write the colours, type and images it actually paints.
 *
 *   node scripts/observe-preset-brands.js
 *   node scripts/observe-preset-brands.js --slug nike
 *
 * The CSS harvest (`npm run harvest:presets`) never executes the page, so a
 * storefront that paints its identity after load, or that only states it as
 * the logo's own colour, comes back grey. This script loads the page, reads
 * the declared theme colour, the logo's computed colour, the fonts in use
 * and the image URLs the page itself requests, and writes
 * `data/brands/presets/<slug>.observed.json`.
 *
 * It does not edit the preset. `build-brand-presets.js` copies a value across
 * only when this file recorded it and the palette still passes the same gate
 * as any brand. A site that answers with a block page writes `ok: false` and
 * the preset stays on the neutral default — an empty observation is not a
 * brand that publishes nothing, and a block page is not a palette.
 *
 * chooseSchema() is pure and is what the tests call. Nothing in it is a
 * colour remembered from somewhere else: every hex it returns is one the
 * snapshot already holds.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'brands', 'presets');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));

const WIDGET = /jdgm|judge\.me|spr-|shopify-product-reviews|cookie|consent|grecaptcha|framer-link|nector-|swiper|podium-cds-color-scrim/i;
const SHADE = /shade|swatch|lipstic|prod_label|badge|chip|rating/i;
const GENERIC_FAMILY = /^(?:sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|-apple-system|blinkmacsystemfont|inherit|initial|unset|revert|emoji|math)$/i;
const BLOCK_PAGE = /unable to give you access|access denied|just a moment|attention required|cf-browser-verification|site maintenance|something went wrong|pardon our interruption|verify you are human|captcha/i;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function normHex(v) {
  let s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (!s.startsWith('#')) s = '#' + s;
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(s)) return '';
  if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return s;
}

function rgb(hex) {
  const h = normHex(hex);
  if (!h) return null;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function luminance(hex) {
  const parts = rgb(hex);
  if (!parts) return 1;
  const chan = parts.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function chroma(hex) {
  const parts = rgb(hex);
  if (!parts) return 0;
  return Math.max(...parts) - Math.min(...parts);
}

function isWhite(hex) { return normHex(hex) === '#ffffff'; }

/**
 * A theme-color of white is the browser chrome. A light grey is a disabled
 * fill or a pressed icon, not a brand colour. Near-black still counts: some
 * marks are black.
 */
function usableIdentity(hex) {
  const h = normHex(hex);
  if (!h || isWhite(h)) return false;
  if (luminance(h) > 0.65 && chroma(h) < 40) return false;
  return true;
}

/** A custom property that names the brand colour, not a state, a vendor, or text. */
function brandColorVar(name) {
  const n = String(name || '');
  if (!n || WIDGET.test(n)) return false;
  if (/disabled|pressed|hover|focus|text-color|icon|on_brand|scrim|inverse|border|link|^--(vc|vjs|ot)-/i.test(n)) return false;
  return /(?:^|--)(?:color-)?(?:brand|primary)(?:-color)?$/i.test(n)
    || /theme-?color|brand-?color|color-primary|primary-blue|colorPrimary/i.test(n);
}

const PAINT_SKIP = /vjs-|hidden|modal|cookie|consent|trustarc|onetrust|cart-count|gnb-cart|badge|notification|\bdot\b|slider-dot|swiper|cookielaw|highlight|graphic|chart|sprite|ally-switcher/i;
const BUTTON_PAINT = /button|cta|announcement|\bbtn\b/i;
const ASSET_SKIP = /cookielaw|onetrust|trustarc|doubleclick|scorecardresearch|google-analytics|facebook\.com|gstatic|1x1|pixel|spacer|tracking|beacon|sprite/i;

/** 3 = a linked icon, 2 = an svg named logo, 1 = a small file named logo, 0 = not a logo. */
function logoRank(url) {
  const u = String(url || '');
  if (!/^https:\/\//i.test(u) || ASSET_SKIP.test(u)) return 0;
  if (/[?&](?:height|width)=1\b/i.test(u)) return 0;
  const file = u.split('?')[0].toLowerCase();
  if (/hero_|banner|campaign|sprite/.test(file)) return 0;
  if (/touch-icon|favicon|pwa-icon|app_ico|android-icon|\/icons?\//.test(file)) return 3;
  if (/logo|wordmark/.test(file) && /\.svg$/.test(file)) return 2;
  if (/logo|wordmark/.test(file)) return 1;
  return 0;
}

function firstFamily(stack) {
  for (const part of String(stack || '').split(',')) {
    const f = part.trim().replace(/^["']|["']$/g, '');
    if (!f || GENERIC_FAMILY.test(f) || /^\d/.test(f) || f.length > 48) continue;
    return f;
  }
  return '';
}

function quoteFamily(family) {
  return "'" + String(family).replace(/'/g, '') + "'";
}

function fontStack(family, raw) {
  const rest = String(raw || '').split(',').slice(1).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const tail = rest.length ? rest.join(', ') : 'Arial, sans-serif';
  return quoteFamily(family) + ', ' + tail;
}

const SEMANTIC = { line: '#e4e4e4', ok: '#1a7f37', warn: '#c9a227', err: '#c0392b' };

/**
 * Turn a page snapshot into a palette, a type pair and an asset list.
 * Every returned hex is taken from the snapshot. Semantic line/ok/warn/err
 * are the same functional tokens every other preset already carries; they
 * are labelled as such and are not read as the brand's colours.
 *
 * @returns {object|null} null when the page did not publish a primary that
 *   passes the palette gate.
 */
function chooseSchema(snapshot) {
  const snap = snapshot || {};
  const evidence = {};
  const push = (role, hex, signal, sourceUrl) => {
    const h = normHex(hex);
    if (!h) return;
    evidence[role] = { value: h, signal, source_url: sourceUrl || snap.landed || '' };
  };

  const surfaceHex = (() => {
    const h = normHex(snap.surface);
    if (h && luminance(h) >= 0.85 && !core.isDarkNeutral(h)) return h;
    return '#ffffff';
  })();
  push('surface', surfaceHex, normHex(snap.surface) === surfaceHex ? 'computed background of body' : 'light page surface; the page ground was not a light colour', snap.landed);

  const inkCandidate = normHex(snap.ink);
  const inkHex = inkCandidate && luminance(inkCandidate) < 0.45 && core.contrast(inkCandidate, surfaceHex) >= 4.5
    ? inkCandidate
    : '#111111';
  push('ink', inkHex, inkHex === inkCandidate ? 'computed color of body' : 'body text that clears AA on the page surface', snap.landed);

  let surfaceAlt = '#f6f6f6';
  let surfaceAltSignal = 'no card colour was declared; a light neutral so the schema is complete';
  const tints = (snap.lightTints || [])
    .map((t) => ({ hex: normHex(t.hex), n: t.n || 0 }))
    .filter((t) => t.hex && !isWhite(t.hex) && luminance(t.hex) >= 0.9 && core.contrast(inkHex, t.hex) >= 4.5);
  if (tints.length) {
    tints.sort((a, b) => b.n - a.n);
    surfaceAlt = tints[0].hex;
    surfaceAltSignal = 'computed light background repeated on the page';
  }
  push('surface_alt', surfaceAlt, surfaceAltSignal, snap.landed);

  const mutedHex = '#666666';
  push('muted', mutedHex, 'secondary text token that clears AA; the page did not declare one', snap.landed);

  const primaryCandidates = [];
  const addPrimary = (hex, signal) => {
    const h = normHex(hex);
    if (!usableIdentity(h) || h === surfaceHex) return;
    if (primaryCandidates.some((c) => c.hex === h)) return;
    primaryCandidates.push({ hex: h, signal });
  };
  if (snap.theme) addPrimary(snap.theme, 'meta theme-color');
  if (snap.manifestTheme) addPrimary(snap.manifestTheme, 'manifest theme_color');
  if (snap.tile) addPrimary(snap.tile, 'meta msapplication-TileColor');
  for (const v of snap.vars || []) {
    if (!v || !brandColorVar(v.name) || WIDGET.test(v.selector || '')) continue;
    addPrimary(v.hex, 'css custom property ' + v.name);
  }
  const paints = (snap.paints || [])
    .filter((p) => p && !SHADE.test(p.sample || '') && !WIDGET.test(p.sample || '') && !PAINT_SKIP.test(p.sample || ''))
    .map((p) => ({ hex: normHex(p.hex), n: p.n || 0, sample: p.sample || '' }))
    .filter((p) => usableIdentity(p.hex) && chroma(p.hex) >= 18 && p.n >= 4);
  paints.sort((a, b) => b.n - a.n);
  const paintSignal = (p) => 'computed background of ' + (p.sample || 'a repeated element') + ' (' + p.n + ' elements)';
  for (const p of paints.filter((row) => BUTTON_PAINT.test(row.sample || ''))) addPrimary(p.hex, paintSignal(p));
  if (snap.logoIsVector && snap.logoColor) addPrimary(snap.logoColor, 'computed color of the home logo');
  for (const p of paints.filter((row) => !BUTTON_PAINT.test(row.sample || ''))) addPrimary(p.hex, paintSignal(p));

  const accentPool = [];
  const addAccent = (hex, signal) => {
    const h = normHex(hex);
    if (!h || isWhite(h) || h === surfaceHex) return;
    if (accentPool.some((c) => c.hex === h)) return;
    accentPool.push({ hex: h, signal });
  };
  for (const v of snap.vars || []) {
    if (!v || WIDGET.test(v.name || '') || !/accent/i.test(v.name || '')) continue;
    addAccent(v.hex, 'css custom property ' + v.name);
  }
  for (const p of paints) addAccent(p.hex, 'computed background of ' + (p.sample || 'a repeated element'));
  addAccent(inkHex, 'text colour, used where the brand publishes no second colour');

  let chosen = null;
  for (const primary of primaryCandidates) {
    const accents = accentPool.filter((a) => a.hex !== primary.hex).concat([{ hex: primary.hex, signal: 'the brand publishes one colour' }]);
    for (const accent of accents) {
      const palette = Object.assign({
        primary: primary.hex, accent: accent.hex, ink: inkHex, surface: surfaceHex,
        surface_alt: surfaceAlt, muted: mutedHex,
      }, SEMANTIC);
      const gate = core.validatePalette(palette);
      if (!gate.ok) continue;
      chosen = { palette: gate.palette, primary, accent };
      break;
    }
    if (chosen) break;
  }
  if (!chosen) return null;

  push('primary', chosen.primary.hex, chosen.primary.signal, snap.landed);
  push('accent', chosen.accent.hex, chosen.accent.signal, snap.landed);
  for (const role of Object.keys(SEMANTIC)) {
    evidence[role] = { value: SEMANTIC[role], signal: 'functional token shared by every preset, not a colour read from this brand', source_url: '' };
  }

  const google = new Set((snap.googleFamilies || []).map((f) => String(f).toLowerCase()));
  const typography = {};
  for (const slot of [['heading', snap.headingFont], ['body', snap.bodyFont]]) {
    const family = firstFamily(slot[1]);
    if (!family) continue;
    typography[slot[0]] = {
      family,
      stack: fontStack(family, slot[1]),
      google: google.has(family.toLowerCase()),
      weights: slot[0] === 'heading' ? '600;700' : '400;500;600',
      signal: 'computed font-family of ' + (slot[0] === 'heading' ? 'h1' : 'body'),
    };
  }

  const assets = [];
  const seen = new Set();
  const take = (url, role, alt, signal) => {
    const u = String(url || '').trim();
    if (!/^https:\/\//i.test(u) || seen.has(u)) return;
    if (ASSET_SKIP.test(u)) return;
    seen.add(u);
    assets.push({ url: u, role, alt: String(alt || '').replace(/\s+/g, ' ').slice(0, 140), found_on: snap.landed || '', signal });
  };
  const logoPick = [snap.logoUrl].concat(snap.icons || [], (snap.images || []).map((img) => img && img.url))
    .filter((u) => logoRank(u) > 0)
    .sort((a, b) => logoRank(b) - logoRank(a))[0];
  if (logoPick) take(logoPick, 'logo', snap.logoAlt || '', snap.logoSignal || 'logo or icon the page links');
  for (const img of snap.images || []) {
    if (assets.length >= 8) break;
    take(img.url, img.role || 'photograph', img.alt || '', 'img on the page');
  }

  const logo = assets.find((a) => a.role === 'logo');
  const primaryEv = evidence.primary;
  const source = 'Read from ' + (snap.landed || snap.start || 'the brand site')
    + ' on ' + (snap.observed_at || '')
    + '. Primary ' + primaryEv.value + ' from ' + primaryEv.signal + '.';

  return {
    palette: chosen.palette,
    evidence,
    typography,
    logo_url: logo ? logo.url : '',
    logo_signal: logo ? logo.signal : '',
    assets,
    source,
  };
}

/** What the rendered page publishes. No Node closures: Playwright serializes this. */
function extractSnapshot() {
  const hexOf = (c) => {
    const raw = String(c || '').trim().toLowerCase();
    if (!raw || raw === 'transparent') return '';
    const m = raw.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?|[\d.]+))?/);
    if (m) {
      let alpha = 1;
      if (m[4] != null) {
        alpha = String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      }
      if (alpha < 0.45) return '';
      const h = (n) => Number(n).toString(16).padStart(2, '0');
      return ('#' + h(m[1]) + h(m[2]) + h(m[3])).toLowerCase();
    }
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) {
      let h = raw.slice(1);
      if (h.length === 3) h = h.split('').map((x) => x + x).join('');
      return ('#' + h.slice(0, 6)).toLowerCase();
    }
    return '';
  };

  const interesting = /brand|primary|accent|theme/i;
  const skipVar = /jdgm|judge|spr-|review|cookie|consent|grecaptcha|framer-link|nector|swiper|podium-cds-color-scrim/i;
  const vars = [];
  const walk = (rules, href) => {
    if (!rules) return;
    for (const rule of rules) {
      if (rule.cssRules) walk(rule.cssRules, href);
      if (!rule.style) continue;
      for (let i = 0; i < rule.style.length; i++) {
        const name = rule.style[i];
        if (!name.startsWith('--') || !interesting.test(name) || skipVar.test(name)) continue;
        const hex = hexOf(rule.style.getPropertyValue(name));
        if (!hex) continue;
        vars.push({ name, hex, selector: String(rule.selectorText || '').slice(0, 80) });
        if (vars.length >= 40) return;
      }
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    walk(rules, sheet.href);
  }

  const paintBag = new Map();
  const tintBag = new Map();
  const nodes = document.body ? document.body.querySelectorAll('a, button, header, div, span, section') : [];
  let seenNodes = 0;
  for (const el of nodes) {
    if (++seenNodes > 1800) break;
    const bg = hexOf(getComputedStyle(el).backgroundColor);
    if (!bg || bg === '#ffffff') continue;
    const r = parseInt(bg.slice(1, 3), 16);
    const g = parseInt(bg.slice(3, 5), 16);
    const b = parseInt(bg.slice(5, 7), 16);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const sample = String(el.className || el.tagName || '').slice(0, 70);
    if (spread < 16 && (r + g + b) / 3 > 220) {
      const t = tintBag.get(bg) || { hex: bg, n: 0 };
      t.n += 1;
      tintBag.set(bg, t);
      continue;
    }
    if (spread < 16) continue;
    const cur = paintBag.get(bg) || { hex: bg, n: 0, sample: '' };
    cur.n += 1;
    if (!cur.sample) cur.sample = sample;
    paintBag.set(bg, cur);
  }

  const meta = (name) => {
    const el = document.querySelector('meta[name="' + name + '"]');
    return el ? hexOf(el.content || el.getAttribute('content') || '') : '';
  };
  const logoLink = document.querySelector('a[aria-label*="home" i], a[aria-label*="logo" i], header a[class*="logo" i], a[class*="Logo"]');
  const logoImg = document.querySelector('img[src*="logo" i], img[alt*="logo" i], a[class*="logo" i] img, header a[aria-label*="logo" i] img');
  let logoUrl = '';
  let logoAlt = '';
  let logoSignal = '';
  const skipAsset = /cookielaw|onetrust|trustarc|doubleclick|scorecardresearch|gstatic|1x1|pixel|spacer/i;
  if (logoImg && /^https?:/i.test(logoImg.currentSrc || logoImg.src || '') && !skipAsset.test(logoImg.currentSrc || logoImg.src || '')) {
    logoUrl = logoImg.currentSrc || logoImg.src;
    logoAlt = logoImg.alt || '';
    logoSignal = 'img on the page whose address or alt says logo';
  }
  if (!logoUrl) {
    const icons = [...document.querySelectorAll('link[rel*="icon" i], link[rel="apple-touch-icon" i]')];
    let best = null;
    let bestW = -1;
    for (const link of icons) {
      const href = link.href || '';
      if (!/^https?:/i.test(href) || !/\.(png|jpe?g|webp|svg)(\?|$)/i.test(href)) continue;
      if (skipAsset.test(href)) continue;
      const w = parseInt((link.sizes && link.sizes.value || '').split('x')[0], 10) || ( /apple-touch/i.test(link.rel) ? 180 : 32);
      if (w > bestW) { bestW = w; best = href; }
    }
    if (best) {
      logoUrl = best;
      logoSignal = 'touch icon or favicon the page links';
    }
  }

  const images = [];
  const seenImg = new Set();
  for (const img of Array.from(document.images)) {
    const url = img.currentSrc || img.src || '';
    if (!/^https?:/i.test(url) || seenImg.has(url)) continue;
    if (/cookielaw|onetrust|trustarc|doubleclick|1x1|pixel|spacer|tracking|analytics/i.test(url)) continue;
    const w = img.naturalWidth || 0;
    if (w && w < 160) continue;
    seenImg.add(url);
    const blob = (img.alt || '') + ' ' + (img.className || '') + ' ' + url;
    const file = url.split('?')[0].toLowerCase();
    const role = /logo|wordmark|favicon|touch-icon|pwa-icon|android-icon/.test(file) ? 'logo' : /hero|banner|masthead/i.test(blob) ? 'hero' : 'photograph';
    images.push({ url, alt: (img.alt || '').slice(0, 140), w, role });
    if (images.length >= 12) break;
  }

  const googleFamilies = [];
  for (const link of document.querySelectorAll('link[href*="fonts.googleapis.com"]')) {
    const href = link.href || '';
    const fams = href.match(/family=([^&]+)/g) || [];
    for (const f of fams) {
      googleFamilies.push(decodeURIComponent(f.slice(7)).split(':')[0].replace(/\+/g, ' '));
    }
  }

  const h1 = document.querySelector('h1');
  const og = document.querySelector('meta[property="og:image"]');
  let ogUrl = og ? (og.content || '') : '';
  try { if (ogUrl) ogUrl = new URL(ogUrl, location.href).href; } catch (e) { ogUrl = ''; }
  if (/^https?:/i.test(ogUrl)) images.unshift({ url: ogUrl, alt: '', w: 1200, role: 'share' });

  return {
    landed: location.href,
    title: document.title || '',
    bodyLen: document.body ? (document.body.innerText || '').length : 0,
    theme: meta('theme-color'),
    tile: meta('msapplication-TileColor'),
    manifestHref: (document.querySelector('link[rel="manifest"]') || {}).href || '',
    vars,
    paints: [...paintBag.values()].sort((a, b) => b.n - a.n).slice(0, 12),
    lightTints: [...tintBag.values()].sort((a, b) => b.n - a.n).slice(0, 6),
    icons: [...document.querySelectorAll('link[rel*="icon" i], link[rel="apple-touch-icon" i]')]
      .map((link) => link.href || '')
      .filter((href) => /^https?:/i.test(href)),
    logoIsVector: !!(logoLink && logoLink.querySelector('svg')),
    logoColor: (logoLink && logoLink.querySelector('svg')) ? hexOf(getComputedStyle(logoLink).color) : '',
    ink: hexOf(getComputedStyle(document.body).color),
    surface: hexOf(getComputedStyle(document.body).backgroundColor),
    headingFont: h1 ? getComputedStyle(h1).fontFamily : '',
    bodyFont: getComputedStyle(document.body).fontFamily,
    googleFamilies,
    logoUrl,
    logoAlt,
    logoSignal,
    images,
  };
}

async function manifestTheme(page, href) {
  if (!href) return '';
  try {
    const res = await page.request.get(href, { timeout: 8000 });
    if (!res.ok()) return '';
    const json = await res.json();
    const raw = json && (json.theme_color || json.themeColor);
    return normHex(raw);
  } catch (_) {
    return '';
  }
}

function blocked(status, snap) {
  if (status >= 400) return true;
  const text = ((snap && snap.title) || '') + ' ' + ((snap && snap.bodyLen < 80) ? (snap.title || '') : '');
  if (BLOCK_PAGE.test((snap && snap.title) || '')) return true;
  if (!snap || snap.bodyLen < 280) return true;
  return false;
}

async function observeOne(page, preset, observedAt) {
  const start = preset.website;
  let status = 0;
  let snap = null;
  let error = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 28000 });
      status = res ? res.status() : 0;
      error = '';
    } catch (e) {
      error = String((e && e.message) || e).split('\n')[0];
      status = 0;
    }
    await page.waitForTimeout(attempt === 0 ? 1600 : 2800);
    if (!/^https?:/i.test(page.url())) continue;
    try {
      snap = await page.evaluate(extractSnapshot);
    } catch (e) {
      error = String((e && e.message) || e).split('\n')[0];
      snap = null;
      continue;
    }
    if (snap && !blocked(status, snap)) break;
  }
  if (!snap || blocked(status, snap)) {
    return {
      ok: false,
      slug: preset.slug,
      start,
      landed: snap && snap.landed || start,
      observed_at: observedAt,
      status,
      title: snap && snap.title || '',
      note: error || ('The page did not serve the brand site (status ' + status + ', title ' + JSON.stringify(snap && snap.title || '') + '). Nothing was filled in from it.'),
    };
  }
  snap.manifestTheme = await manifestTheme(page, snap.manifestHref);
  snap.observed_at = observedAt;
  snap.start = start;
  const schema = chooseSchema(snap);
  if (!schema) {
    return {
      ok: false,
      slug: preset.slug,
      start,
      landed: snap.landed,
      observed_at: observedAt,
      status,
      title: snap.title,
      note: 'The page loaded, and it did not publish a primary colour that passes the palette gate. The preset is left on the neutral default rather than given a colour the page did not declare.',
      snapshot_summary: {
        theme: snap.theme, logoColor: snap.logoColor, paints: snap.paints, vars: (snap.vars || []).slice(0, 8),
      },
    };
  }
  return {
    ok: true,
    palette_ok: true,
    slug: preset.slug,
    start,
    landed: snap.landed,
    observed_at: observedAt,
    status,
    title: snap.title,
    source: schema.source,
    palette: schema.palette,
    evidence: schema.evidence,
    typography: schema.typography,
    logo_url: schema.logo_url,
    logo_signal: schema.logo_signal,
    assets: schema.assets,
  };
}

async function main() {
  const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  const only = arg('slug', '');
  const targets = index.presets.filter((p) => (only ? p.slug === only : true));
  if (!targets.length) {
    console.error(only ? 'No preset matched --slug ' + only : 'No presets.');
    process.exit(1);
  }
  const { chromium } = require('playwright');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (_) {
    browser = await chromium.launch({ headless: true });
  }
  const observedAt = new Date().toISOString().slice(0, 10);
  const queue = targets.slice();
  let ok = 0;
  let failed = 0;
  const workers = Math.min(3, queue.length);
  async function worker() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await context.newPage();
    while (queue.length) {
      const preset = queue.shift();
      process.stdout.write('  ' + preset.slug.padEnd(18) + ' ' + preset.website + ' ... ');
      const out = await observeOne(page, preset, observedAt);
      const file = path.join(DIR, preset.slug + '.observed.json');
      fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
      if (out.ok) {
        ok += 1;
        console.log((out.palette.primary || '') + '  ' + (out.logo_url ? 'logo' : 'no logo') + '  ' + (out.assets || []).length + ' asset(s)');
      } else {
        failed += 1;
        console.log('NOT APPLIED');
        console.log('      ' + String(out.note || '').slice(0, 160));
      }
    }
    await context.close();
  }
  console.log('\nObserving ' + targets.length + ' brand site(s).\n');
  await Promise.all(Array.from({ length: workers }, () => worker()));
  await browser.close();
  console.log('\n  applied observation: ' + ok + '   left on the default: ' + failed + '\n');
  if (!ok) process.exitCode = 1;
}

module.exports = { chooseSchema, normHex, extractSnapshot };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
