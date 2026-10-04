'use strict';
/**
 * scripts/lib/preset-observation.js — turn ONE rendered read of a starter
 * brand's own site into the observation the preset builder absorbs.
 * ---------------------------------------------------------------------------
 * The read itself is not done here. It is done by the platform's one rendered
 * reader, `api/_shared/brand-render.js` (`readSite` / `readRendered`): headless
 * Chromium, computed styles by element ROLE, every value carrying the page,
 * role, selector and viewport it was measured on. A second reader beside it
 * would drift from it - this repo has recorded that defect class more than
 * once - so the preset harvester only MAPS the reader's design manifest onto
 * the preset's palette and type slots, and says where each value came from.
 *
 * THE RULES, each one a sentence a reviewer can hold the code to:
 *
 *  - A blocked, timed-out or unavailable read is an OBSERVATION, not an empty
 *    one. It carries `renderer` and the reason, and NO palette. The builder
 *    leaves that preset on the neutral default and the gallery says why
 *    ("<host> blocked an automated read on <date>"). A block page is not a
 *    palette, and a palette from memory is not a read.
 *  - Every hex in the palette is one the manifest measured, or it is DERIVED
 *    from one the manifest measured and labelled so, with the exact value kept
 *    beside it. The only values not read from the site are the four
 *    functional tokens (line/ok/warn/err) every preset shares, labelled as such.
 *  - `primary` is the reader's own choice (identity first, the rendered call to
 *    action when it is the only brand colour). A monochrome site - a black
 *    call to action and no chromatic colour anywhere - keeps that black: it is
 *    what the brand renders. Nothing renders: no primary, no palette.
 *  - A typeface is the family the role RENDERS in. A proprietary web font the
 *    app cannot load is named, marked `loadable: false` and shown in the
 *    site's own fallback stack; it is never swapped for a lookalike.
 *
 * Pure: no browser, no network, no file system.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));

const FORMAT = 'preset-observation/2';
const RENDERERS = ['rendered', 'blocked', 'timeout', 'unavailable'];

/** Functional tokens every preset shares. Not this brand's colours. */
const SEMANTIC = { line: '#e4e4e4', ok: '#1a7f37', warn: '#c9a227', err: '#c0392b' };
const SEMANTIC_NOTE = 'functional token shared by every preset, not a colour read from this brand';
/** A consent or cookie banner is its vendor's design, not the brand's. */
const CONSENT = /consent|cookie|onetrust|truste|gdpr|didomi|usercentrics|osano|cookiebot/i;
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|math|emoji|-apple-system|blinkmacsystemfont)$/i;

function hostOf(url) {
  try { return new URL(String(url || '')).hostname; } catch (_) { return String(url || ''); }
}

function hex(v) { return core.normHex(v) || ''; }

/** A surface the app's text tokens can be built against. */
function lightSurface(h) {
  return !!h && !core.isDarkNeutral(h) && core.luminance(h) >= 0.5;
}

function sourceOf(c) {
  const s = (c && c.source) || {};
  return {
    page: s.page || '', role: s.role || '', selector: s.selector || '',
    viewport: s.viewport || '', property: s.property || '', signal: s.signal || '',
  };
}

/**
 * The read's failure, labelled with one of the reader's three words. A
 * reader that answered with something else is `unavailable`: never guess
 * that a site blocked us.
 */
function failureRenderer(r) {
  const w = String((r && (r.renderer || r.code)) || '').toLowerCase();
  if (w === 'blocked' || w === 'timeout') return w;
  if (/took longer than|timed? ?out/i.test(String((r && (r.reason || r.message)) || ''))) return 'timeout';
  return 'unavailable';
}

/** One sentence for the gallery, per state. `at` is YYYY-MM-DD. */
function readSentence(attempt) {
  if (!attempt || !attempt.renderer) return '';
  const host = attempt.host || 'The site';
  const at = attempt.at || 'an unrecorded date';
  if (attempt.renderer === 'blocked') return `${host} blocked an automated read on ${at}.`;
  if (attempt.renderer === 'timeout') return `${host} did not answer an automated read within its time limit on ${at}.`;
  if (attempt.renderer === 'unavailable') return `${host} could not be read on ${at}${attempt.reason ? `: ${String(attempt.reason).replace(/\.$/, '')}` : ''}.`;
  if (attempt.renderer === 'rendered' && attempt.reason) return `${host} was read on ${at}, and ${String(attempt.reason).replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/\.$/, '')}.`;
  return '';
}

/* ── palette ─────────────────────────────────────────────────────────────── */

function rolesOf(manifest) {
  return (manifest && manifest.read && manifest.read.desktop && manifest.read.desktop.roles) || {};
}

/**
 * The palette a preset can activate with, from the manifest's measured colours.
 * Returns { ok, palette, evidence, reason, gate }.
 *
 * The reader decides what each colour IS (identity, action, body copy). This
 * decides only what a PRESET can use, and every refusal is recorded beside the
 * value taken instead (`evidence.primary.passed_over`):
 *  - a colour measured on a consent or cookie widget is that vendor's, not
 *    the brand's;
 *  - a "brand colour" that measures under 1.5:1 against the page is a tint of
 *    the page (a pale header, the palest step of a token scale) and cannot
 *    carry the app's primary role - buttons and bands in it would vanish. The
 *    next colour the site renders is taken, in the reader's own order.
 */
function paletteFromManifest(manifest) {
  const m = manifest || {};
  const colors = m.colors || {};
  const rd = rolesOf(m);
  const page = m.url || m.start || '';
  const evidence = {};
  const take = (role, value, c, extra) => {
    evidence[role] = Object.assign({ value, exact: value, derived: false, source: sourceOf(c) }, extra || {});
  };
  const derive = (role, value, exact, note, c) => {
    evidence[role] = { value, exact: exact || '', derived: true, note, source: sourceOf(c) };
  };
  const roleSource = (role, r, property) => ({ page, role, selector: (r && r.selector) || '', viewport: 'desktop', property, signal: 'computed' });

  // surface first: whether a colour is a tint of the page depends on it.
  const surfaceExact = hex(colors.surface && colors.surface.value);
  let surface = surfaceExact;
  if (lightSurface(surfaceExact)) take('surface', surfaceExact, colors.surface);
  else {
    surface = '#ffffff';
    derive('surface', surface, surfaceExact,
      surfaceExact
        ? `DERIVED: the site paints its page ${surfaceExact}, a dark ground. A preset's page surface must be light (every text token is built against it, and a dark-neutral surface is refused activation), so the surface is white and the exact value is kept here.`
        : 'DERIVED: the read measured no page ground, so the surface is white.',
      colors.surface);
  }

  // primary: the reader's choice first, then what else the site renders.
  const passedOver = [];
  const usable = (value, source, label) => {
    const h = hex(value);
    if (!h) return false;
    if (CONSENT.test((source && source.selector) || '')) { passedOver.push({ value: h, from: label, why: 'measured on a consent or cookie banner, which is not an identity signal (its styling is often the consent vendor\'s)' }); return false; }
    const vsPage = core.contrast(h, surface);
    if (vsPage < 1.5 || (surfaceExact && core.contrast(h, surfaceExact) < 1.5)) { passedOver.push({ value: h, from: label, why: `${Math.min(vsPage, surfaceExact ? core.contrast(h, surfaceExact) : vsPage)}:1 against the page, a tint of the page that cannot carry buttons or bands` }); return false; }
    return true;
  };
  const candidates = [];
  if (colors.primary) candidates.push({ value: colors.primary.value, source: sourceOf(colors.primary), from_role: colors.primary.from_role || '', signal: colors.primary.signal || 'computed', label: 'the reader\'s primary' });
  if (colors.accent && /action|identity/.test(colors.accent.from_role || '')) candidates.push({ value: colors.accent.value, source: sourceOf(colors.accent), from_role: colors.accent.from_role, signal: colors.accent.from_role === 'action' ? 'the primary call to action, as rendered' : 'identity colour, as rendered', label: 'the reader\'s accent' });
  for (const c of ((m.identity && m.identity.candidates) || [])) {
    if (c && !c.neutral) candidates.push({ value: c.value, source: sourceOf(c), from_role: 'identity', signal: c.signal || 'identity colour', label: c.signal || 'an identity candidate' });
  }
  const btn = rd.button_primary && rd.button_primary.style ? rd.button_primary.style.background : '';
  if (btn) candidates.push({ value: btn, source: roleSource('primary call to action', rd.button_primary, 'background-color'), from_role: 'action', signal: 'the primary call to action, as rendered; the site renders no chromatic brand colour that reads on its page, so its identity is monochrome', label: 'the primary call to action' });
  const hdr = rd.header && rd.header.style ? rd.header.style.background : '';
  if (hdr) candidates.push({ value: hdr, source: roleSource('header', rd.header, 'background-color'), from_role: 'identity', signal: 'header background as rendered; the site renders no other colour that reads on its page', label: 'the header background' });
  let primary = '';
  for (const c of candidates) {
    if (!usable(c.value, c.source, c.label)) continue;
    primary = hex(c.value);
    evidence.primary = { value: primary, exact: primary, derived: false, from_role: c.from_role, signal: c.signal, source: c.source };
    break;
  }
  const seen = new Set();
  const passed = passedOver.filter((p) => { const k = p.value + p.why; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!primary) {
    return {
      ok: false, palette: null, evidence: Object.assign(evidence, { primary: { value: '', passed_over: passed } }),
      reason: passed.length
        ? `the rendered site shows no brand colour a preset can use (${passed.map((p) => `${p.value} from ${p.from}: ${p.why}`).join('; ')})`
        : 'The rendered site shows no brand colour: no identity colour, no filled call to action and no coloured header.',
    };
  }
  if (passed.length) evidence.primary.passed_over = passed;

  // ink: body copy as rendered; if it does not read on the page, the heading
  // or navigation text the site renders; only then a derivation.
  const inkExact = hex(colors.ink && colors.ink.value);
  let ink = '';
  if (inkExact && core.contrast(inkExact, surface) >= 4.5) { ink = inkExact; take('ink', inkExact, colors.ink); }
  else {
    const textRoles = [
      // Navigation text first: it is set in the site's running text colour far
      // more often than a heading, which is often set in the brand colour.
      ['navigation link', rd.nav_link], ['h1', rd.headings && rd.headings.h1], ['display heading', rd.display], ['body link', rd.link],
    ];
    for (const [name, r] of textRoles) {
      const c = hex(r && r.type && r.type.color);
      if (!c || core.contrast(c, surface) < 4.5) continue;
      ink = c;
      evidence.ink = {
        value: c, exact: inkExact, derived: true, from_role: name,
        note: inkExact
          ? `The body copy as rendered (${inkExact}) measures ${core.contrast(inkExact, surface)}:1 on ${surface}; the ${name} text the site renders (${c}) reads there, so it is the ink.`
          : `The read found no body copy; the ${name} text the site renders (${c}) is the ink.`,
        source: roleSource(name, r, 'color'),
      };
      break;
    }
    if (!ink && inkExact) {
      // Light text from a dark page, now on a light one: taken well past AA,
      // so body copy reads as body copy and not as a faded caption.
      ink = core.readableAsText(inkExact, surface, 12);
      derive('ink', ink, inkExact, `DERIVED from ${inkExact}: the body copy as rendered measures ${core.contrast(inkExact, surface)}:1 on ${surface}, and no other text the site renders reads there, so it is darkened until it does (${core.contrast(ink, surface)}:1).`, colors.ink);
    } else if (!ink) {
      ink = core.readableAsText(primary, surface, 12);
      derive('ink', ink, '', `DERIVED from ${primary}: the read found no text colour that reads on ${surface}, so the primary is darkened until it does (${core.contrast(ink, surface)}:1).`, colors.primary);
    }
  }

  // surface_alt: a light card colour the site renders, else the surface.
  const altExact = hex(colors.surface_alt && colors.surface_alt.value);
  let surfaceAlt = surface;
  if (altExact && lightSurface(altExact) && core.contrast(ink, altExact) >= 4.5) {
    surfaceAlt = altExact;
    take('surface_alt', altExact, colors.surface_alt);
  } else {
    derive('surface_alt', surfaceAlt, altExact, altExact
      ? `DERIVED: the site's card colour ${altExact} cannot carry the body text at AA, so cards use the page surface.`
      : 'DERIVED: the read found no card colour, so cards use the page surface.', colors.surface_alt);
  }

  // muted: secondary text as rendered, AA or derived.
  const mutedExact = hex(colors.muted && colors.muted.value);
  let muted = ink;
  if (mutedExact && core.contrast(mutedExact, surface) >= 4.5) { muted = mutedExact; take('muted', mutedExact, colors.muted); }
  else if (mutedExact) {
    muted = core.readableAsText(mutedExact, surface, 4.5);
    derive('muted', muted, mutedExact, `DERIVED from ${mutedExact}: secondary text as rendered measures ${core.contrast(mutedExact, surface)}:1, adjusted to AA.`, colors.muted);
  } else derive('muted', muted, '', 'DERIVED: the read found no secondary text style, so it is the body ink.', colors.ink);

  // accent: the reader's second colour when it is a usable one, else the
  // primary repeated (said) rather than a colour the site does not use.
  const accentExact = hex(colors.accent && colors.accent.value);
  const accentConsent = !!accentExact && CONSENT.test((colors.accent.source && colors.accent.source.selector) || '');
  let accent = primary;
  if (accentExact && accentExact !== primary && !accentConsent && core.contrast(accentExact, surface) >= 1.5) {
    accent = accentExact;
    take('accent', accentExact, colors.accent, { from_role: colors.accent.from_role || '' });
  } else {
    const other = accentExact && accentExact !== primary;
    evidence.accent = {
      value: primary, exact: other ? accentExact : '', derived: true,
      note: other
        ? `The second colour the reader found (${accentExact}) ${accentConsent ? 'was measured on a consent or cookie banner' : `is a tint of the page (${core.contrast(accentExact, surface)}:1)`}, so the accent repeats the primary.`
        : 'The site renders one brand colour; the accent repeats the primary rather than borrowing a colour the site does not use.',
      source: evidence.primary.source,
    };
  }

  const palette = Object.assign({ primary, accent, ink, surface, surface_alt: surfaceAlt, muted }, SEMANTIC);
  for (const role of Object.keys(SEMANTIC)) evidence[role] = { value: SEMANTIC[role], exact: '', derived: false, note: SEMANTIC_NOTE, source: { page: '', role: '', selector: '', viewport: '', property: '', signal: 'functional' } };

  let gate = core.validatePalette(palette);
  if (!gate.ok && gate.errors.every((e) => e.field === 'primary')) {
    // Neither the ink nor the surface reaches 4.5:1 on the primary: take the
    // ink further from the primary, as long as it still reads on the page.
    let darker = '';
    for (let t = 0.05; t <= 1.0001 && !darker; t += 0.05) {
      const c = core.shade(palette.ink, -t);
      if (core.contrast(c, primary) >= 4.5 && core.contrast(c, surface) >= 4.5) darker = c;
    }
    if (darker) {
      const trial = Object.assign({}, palette, { ink: darker });
      const g2 = core.validatePalette(trial);
      if (g2.ok) {
        derive('ink', darker, (evidence.ink && evidence.ink.exact) || inkExact, `DERIVED from ${palette.ink}: no text colour reached 4.5:1 on the primary ${primary}, so the ink is darkened until it does (still ${core.contrast(darker, surface)}:1 on the page).`, colors.ink);
        palette.ink = darker;
        gate = g2;
      }
    }
  }
  if (!gate.ok) {
    return { ok: false, palette: null, evidence, gate: { errors: gate.errors, warnings: gate.warnings }, reason: `the colours it renders fail the palette gate (${gate.errors.map((e) => e.message).join(' ')})` };
  }
  return { ok: true, palette: Object.assign({}, palette, gate.palette), evidence, gate: { errors: [], warnings: gate.warnings } };
}

/* ── typography ──────────────────────────────────────────────────────────── */

function quoted(f) { return GENERIC.test(f) ? f : `'${String(f).replace(/'/g, '')}'`; }

function slotFrom(f, slot) {
  if (!f || !f.family) return null;
  const family = String(f.family).trim();
  const kind = f.kind || f.family_kind || '';
  const google = f.google === true;
  const parts = String(f.stack || '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  if (!parts.length || parts[0].toLowerCase() !== family.toLowerCase()) parts.unshift(family);
  if (!parts.some((p) => GENERIC.test(p))) parts.push(slot === 'heading' ? 'sans-serif' : 'sans-serif');
  const stack = parts.slice(0, 6).map(quoted).join(',');
  const weightsRead = (Array.isArray(f.weights) ? f.weights : String(f.weights || '').split(/[;,\s]+/))
    .map((w) => String(w).trim()).filter((w) => /^\d{3}$/.test(w));
  const weights = weightsRead.length ? [...new Set(weightsRead)].sort().join(';') : (slot === 'heading' ? '600;700' : '400;500;600');
  const generic = kind === 'generic' || GENERIC.test(family);
  const loadable = google || kind === 'local' || generic;
  let note;
  if (google) note = f.google_self_hosted ? 'Google Fonts family the site hosts itself; the app loads it from Google Fonts.' : 'Google Fonts family the site loads; the app loads it too.';
  else if (kind === 'webfont') note = `${family} (brand font, shown in fallback): a web font served from the brand's own host, which this app does not load. Text renders in the site's own fallback stack.`;
  else if (kind === 'local' || generic) note = 'A system font stack: each device picks the face, exactly as on the site.';
  else note = 'No face in the declared stack could be confirmed as rendering.';
  return {
    family, stack, google, weights, kind: kind || 'none', loadable,
    weights_read: weightsRead.length > 0,
    note,
    signal: `computed font-family of the ${slot === 'heading' ? 'heading' : 'body copy'} role`,
    source: sourceOf(f),
  };
}

function typographyFromManifest(manifest) {
  const fonts = (manifest && manifest.fonts) || {};
  let heading = slotFrom(fonts.heading, 'heading');
  const body = slotFrom(fonts.body, 'body');
  if (!heading && body) heading = Object.assign({}, body, { note: `${body.note} The site renders no distinct heading face, so headings use the body face.`, signal: 'the body copy face; no distinct heading face was rendered' });
  if (!heading || !body) return null;
  return { heading, body };
}

/* ── assets ──────────────────────────────────────────────────────────────── */

function assetsFromManifest(manifest) {
  const a = (manifest && manifest.assets) || {};
  const out = [];
  const seen = new Set();
  const add = (url, role, alt, foundOn, signal) => {
    const u = String(url || '').trim();
    if (!/^https:\/\//i.test(u) || seen.has(u)) return;
    seen.add(u);
    out.push({ url: u, role, alt: String(alt || '').replace(/\s+/g, ' ').slice(0, 140), found_on: foundOn || '', signal });
  };
  let logoUrl = '';
  let logoSignal = '';
  if (a.logo && /^https:\/\//i.test(a.logo.url || '')) {
    logoUrl = a.logo.url;
    logoSignal = `the logo element as rendered (${(a.logo.source && a.logo.source.selector) || 'logo'})`;
  } else if (a.favicon && /^https:\/\//i.test(a.favicon.url || '')) {
    logoUrl = a.favicon.url;
    logoSignal = `the icon the page declares (link rel=${a.favicon.rel || 'icon'})`;
  }
  if (logoUrl) add(logoUrl, 'logo', '', (manifest && manifest.url) || '', logoSignal);
  for (const img of a.images || []) {
    if (out.length >= 8) break;
    add(img.url || img.src, img.role === 'logo' ? 'logo' : (img.role === 'hero' || img.hero ? 'hero' : 'photograph'), img.alt, img.page || (manifest && manifest.url) || '', 'image rendered on the page');
  }
  return { logo_url: logoUrl, logo_signal: logoSignal, assets: out };
}

/* ── the regression score ────────────────────────────────────────────────── */

const REG_KEYS = ['ok', 'done', 'score', 'mismatch', 'partial', 'reason'];

/** The scalar part of the reader's regression result, never its images. */
function regressionSummary(r) {
  if (!r || typeof r !== 'object') return null;
  const out = {};
  for (const k of REG_KEYS) {
    const v = r[k];
    if (v == null) continue;
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 300);
  }
  // Per surface (landing page, mailer, ad creative): the reader reports an
  // object keyed by surface name.
  if (r.surfaces && typeof r.surfaces === 'object') {
    out.surfaces = {};
    for (const [name, v] of Object.entries(r.surfaces)) {
      if (!v || typeof v !== 'object') continue;
      const row = {};
      for (const k of ['score', 'mismatch', 'done', 'tokens_off', 'regions_off']) if (v[k] != null && typeof v[k] !== 'object') row[k] = v[k];
      out.surfaces[name] = row;
    }
  }
  if (Array.isArray(r.iterations)) out.iterations = r.iterations.length;
  if (Array.isArray(r.repairs)) out.repairs = r.repairs.length;
  if (r.limits && r.limits.mismatch_limit != null) out.mismatch_limit = r.limits.mismatch_limit;
  return Object.keys(out).length ? out : null;
}

/* ── the observation ─────────────────────────────────────────────────────── */

function readerInfo(result, manifest) {
  const info = (result && result.renderer_info) || (manifest && manifest.renderer) || {};
  return {
    module: 'api/_shared/brand-render.js',
    manifest_version: (manifest && manifest.version) || '',
    browser: info.source || '',
    chromium: info.version || info.chromium || '',
  };
}

/** A read that did not produce a manifest. */
function failureObservation(preset, result, observedAt) {
  const renderer = failureRenderer(result);
  const reason = String((result && (result.reason || result.message)) || 'The reader gave no reason.').slice(0, 500);
  const host = hostOf(preset.website);
  return {
    format: FORMAT,
    ok: false,
    palette_ok: false,
    slug: preset.slug,
    start: preset.website,
    landed: preset.website,
    observed_at: observedAt,
    renderer,
    reason,
    read_attempt: { renderer, at: observedAt, host, reason },
    reader: readerInfo(result, null),
    note: readSentence({ renderer, at: observedAt, host, reason }) + ' Nothing was filled in from it; the preset stays on the neutral default.',
  };
}

/** A read that produced a manifest. */
function observationFromRead(preset, result, observedAt) {
  if (!result || !result.ok || !result.manifest) return failureObservation(preset, result, observedAt);
  const manifest = result.manifest;
  const landed = manifest.url || preset.website;
  const host = hostOf(landed);
  const pal = paletteFromManifest(manifest);
  const type = typographyFromManifest(manifest);
  const assets = assetsFromManifest(manifest);
  const base = {
    format: FORMAT,
    ok: true,
    slug: preset.slug,
    start: preset.website,
    landed,
    observed_at: observedAt,
    read_at: manifest.read_at || '',
    renderer: 'rendered',
    reader: readerInfo(result, manifest),
    pages: (manifest.pages || []).map((p) => ({ url: p.url, role: p.role })),
    viewports: manifest.viewports || {},
    partial: !!manifest.partial,
    regression: regressionSummary(result.regression),
    conflicts: (manifest.conflicts || []).map((c) => ({ kind: c.kind, message: c.message })),
    markers: (manifest.markers || []).slice(0, 20),
    logo_url: assets.logo_url,
    logo_signal: assets.logo_signal,
    assets: assets.assets,
  };
  if (!pal.ok) {
    return Object.assign(base, {
      palette_ok: false,
      palette: null,
      palette_evidence: pal.evidence,
      palette_reason: pal.reason,
      typography: type,
      read_attempt: { renderer: 'rendered', at: observedAt, host, reason: pal.reason },
      note: readSentence({ renderer: 'rendered', at: observedAt, host, reason: pal.reason }) + ' The preset stays on the neutral default.',
    });
  }
  const p = pal.evidence.primary;
  const source = `Rendered ${landed} in Chromium${base.reader.chromium ? ' ' + base.reader.chromium : ''} on ${observedAt}. `
    + `Primary ${pal.palette.primary} from ${p.signal || 'the rendered page'}`
    + (p.source && p.source.selector ? ` (${p.source.selector})` : '') + '.'
    + (type ? ` Headings ${type.heading.family}, body ${type.body.family}, as rendered.` : '');
  return Object.assign(base, {
    palette_ok: true,
    palette: pal.palette,
    palette_evidence: pal.evidence,
    palette_warnings: (pal.gate && pal.gate.warnings || []).map((w) => w.message),
    typography: type,
    source,
  });
}

module.exports = {
  FORMAT, RENDERERS, SEMANTIC,
  observationFromRead, failureObservation, failureRenderer, readSentence,
  paletteFromManifest, typographyFromManifest, assetsFromManifest, regressionSummary, hostOf,
};
