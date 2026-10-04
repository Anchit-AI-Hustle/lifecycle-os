'use strict';
/**
 * scripts/lib/preset-observation.js — turn the rendered reads of a starter
 * brand's OWN material into the observation the preset builder absorbs.
 * ---------------------------------------------------------------------------
 * The reads themselves are not done here. They are done by the platform's one
 * rendered reader, `api/_shared/brand-render.js` (`readSite` for a page,
 * `readImage` for a logo file): headless Chromium, computed styles by element
 * ROLE, every value carrying the page, role, selector and viewport it was
 * measured on. A second reader beside it would drift from it - this repo has
 * recorded that defect class more than once - so the preset harvester only
 * MAPS what the reader measured onto the preset's palette and type slots, and
 * says where each value came from.
 *
 * WHICH READS. The brand's home page, and the brand's OTHER own material named
 * in the preset's `identity_sources` (a guidelines, press or newsroom page, its
 * logo file) - each on the brand's own registrable domain or linked from a
 * page read there (scripts/lib/brand-ownership.js), never a third party's.
 * A home page that refuses an automated reader is not forced: the brand's
 * other pages are read instead, honestly identified, and say so.
 *
 * THE RULES, each one a sentence a reviewer can hold the code to:
 *
 *  - A blocked, timed-out or unavailable read is an OBSERVATION, not an empty
 *    one. It carries `renderer` and the reason, and NO palette. When no read
 *    of the brand's own material yields one, the builder leaves the preset on
 *    the neutral default and the gallery says why.
 *  - Every hex in the palette is one a read measured, or it is DERIVED from one
 *    a read measured and labelled so, with the exact value kept beside it, and
 *    every value names the page it came from and the date. The only values not
 *    read are the four functional tokens (line/ok/warn/err) every preset
 *    shares, labelled as such.
 *  - `primary` is the STRONGEST identity signal (identity-signals.js KINDS:
 *    the logo's own paint and pixels, a labelled swatch on the brand's own
 *    guidelines page, the mask-icon colour, then theme-color, tokens, the
 *    header), raised by every OTHER kind of signal that agrees with it. A
 *    signal measured on a consent banner is the vendor's, never taken; the
 *    same colour from the logo is taken from the logo. A tint of the page is
 *    passed over. A neutral logo is recorded, never promoted. A site with no
 *    chromatic signal at all keeps the black call to action it renders
 *    (monochrome), and says whether its logo agrees.
 *  - `accent` exists only when the brand genuinely renders a SECOND colour;
 *    it is never the primary repeated.
 *  - A typeface is the family the role RENDERS in. A proprietary web font the
 *    app cannot load is named, marked `loadable: false` and shown in the
 *    site's own fallback stack; it is never swapped for a lookalike.
 *
 * Pure: no browser, no network, no file system.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const signals = require(path.join(ROOT, 'api', '_shared', 'identity-signals.js'));

const FORMAT = 'preset-observation/3';
const RENDERERS = ['rendered', 'blocked', 'timeout', 'unavailable'];

/** Functional tokens every preset shares. Not this brand's colours. */
const SEMANTIC = { line: '#e4e4e4', ok: '#1a7f37', warn: '#c9a227', err: '#c0392b' };
const SEMANTIC_NOTE = 'functional token shared by every preset, not a colour read from this brand';
/** A consent or cookie banner is its vendor's design, not the brand's. */
const CONSENT = /consent|cookie|onetrust|truste|gdpr|didomi|usercentrics|osano|cookiebot/i;
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|math|emoji|-apple-system|blinkmacsystemfont)$/i;
/** Two colours this close (CIEDE2000) are the same colour, read twice. */
const SAME = 5;
/** A second colour has to be at least this far from the primary to be one. */
const DISTINCT = 10;
/** Each other KIND of signal that agrees raises a candidate by this much. */
const CORROBORATION = 12;
/** What can be a SECOND brand colour: an action or link colour the site
    renders, or a declared identity colour. Not an icon tile, a header fill or
    a splash background - those are surfaces, not a brand's second colour. */
const ACCENT_KINDS = new Set(['action', 'link', 'logo-svg', 'logo-image', 'guideline-swatch', 'mask-icon', 'logo-text', 'theme-color', 'manifest-theme', 'tile-color', 'token']);

function hostOf(url) {
  try { return new URL(String(url || '')).hostname; } catch (_) { return String(url || ''); }
}

function hex(v) { return (core.normHex(v) || '').toLowerCase(); }
function dE(a, b) { return require(path.join(ROOT, 'api', '_shared', 'render-regression.js')).deltaE2000(a, b); }

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

/** The signal KIND of a reader colour that carries no `kind` (older manifests). */
function kindFromSignal(signal, fromRole) {
  const s = String(signal || '');
  if (fromRole === 'action') return 'action';
  if (/theme-color/.test(s)) return 'theme-color';
  if (/manifest/.test(s)) return 'manifest-theme';
  if (/logo/.test(s)) return 'logo-svg';
  if (/header/.test(s)) return 'header';
  if (fromRole === 'link') return 'link';
  return 'token';
}

const LINK_KIND = { score: 35, label: 'body link colour, as rendered' };
function strengthOf(kind) { return kind === 'link' ? LINK_KIND.score : ((signals.KINDS[kind] || {}).score || 0); }

/**
 * Every colour candidate one read offers, each with its kind, strength,
 * signal, source and the read it came from. `read`: { manifest, url, role,
 * observed_at, owned } or, for a logo FILE, { image: { url, pixels }, mark }.
 */
function candidatesOf(read) {
  const out = [];
  const add = (value, kind, signal, source, label, extra) => {
    const v = hex(value);
    if (!v) return;
    out.push(Object.assign({ value: v, kind, strength: strengthOf(kind), signal, source: sourceOf({ source }), label: label || signal, read }, extra || {}));
  };
  if (read.image) {
    const mark = read.mark || signals.markIdentity(read.image.pixels);
    if (mark.verdict === 'colour') add(mark.hex, 'logo-image', `the brand's own logo file, its pixels (${Math.round(mark.share_of_chromatic * 100)}% of its coloured pixels)`, { page: read.image.url || read.url, role: 'logo file', selector: '', viewport: '', property: 'pixels', signal: 'rendered' }, 'the brand\'s logo file');
    return out;
  }
  const m = read.manifest || {};
  const colors = m.colors || {};
  const rd = rolesOf(m);
  const page = m.url || m.start || read.url || '';
  if (colors.primary) add(colors.primary.value, colors.primary.kind || kindFromSignal(colors.primary.signal, colors.primary.from_role), colors.primary.signal || 'the reader\'s primary', colors.primary.source, 'the reader\'s primary', { from_role: colors.primary.from_role || '' });
  if (colors.accent && /action|identity|link/.test(colors.accent.from_role || '')) add(colors.accent.value, kindFromSignal(colors.accent.signal, colors.accent.from_role), colors.accent.from_role === 'action' ? 'the primary call to action, as rendered' : (colors.accent.signal || 'identity colour, as rendered'), colors.accent.source, 'the reader\'s accent', { from_role: colors.accent.from_role });
  for (const c of ((m.identity && m.identity.candidates) || [])) {
    if (!c) continue;
    add(c.value, c.kind || kindFromSignal(c.signal), c.signal || 'identity colour', c.source, c.signal || 'an identity candidate', { from_role: 'identity' });
  }
  const btn = rd.button_primary && rd.button_primary.style ? rd.button_primary.style.background : '';
  if (btn) add(btn, 'action', 'the primary call to action, as rendered', { page, role: 'primary call to action', selector: rd.button_primary.selector || '', viewport: 'desktop', property: 'background-color', signal: 'computed' }, 'the primary call to action', { from_role: 'action' });
  const hdr = rd.header && rd.header.style ? rd.header.style.background : '';
  if (hdr) add(hdr, 'header', 'header background as rendered', { page, role: 'header', selector: rd.header.selector || '', viewport: 'desktop', property: 'background-color', signal: 'computed' }, 'the header background', { from_role: 'identity' });
  // One value from one kind of signal in one read is one candidate.
  const seen = new Set();
  return out.filter((c) => { const k = `${c.kind}|${c.value}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Where a value came from, for the evidence: the read, its page, its date. */
function readRef(read) {
  return {
    read_url: (read && (read.url || (read.manifest && read.manifest.url) || (read.image && read.image.url))) || '',
    read_role: (read && read.role) || 'home',
    observed_at: (read && read.observed_at) || '',
    owned: (read && read.owned) || null,
  };
}

/**
 * The palette a preset can activate with, from every read of the brand's own
 * material. `reads[0]`, when it has a manifest, is the DESIGN read: the page
 * whose surface, text colours and type the preset takes (the home page when
 * it rendered). Returns { ok, palette, evidence, reason, gate }.
 */
function paletteFromReads(readsIn) {
  const reads = (readsIn || []).filter(Boolean);
  const design = reads.find((r) => r.manifest) || null;
  const m = (design && design.manifest) || {};
  const colors = m.colors || {};
  const rd = rolesOf(m);
  const page = m.url || m.start || '';
  const designRef = readRef(design);
  const evidence = {};
  const take = (role, value, c, extra) => {
    evidence[role] = Object.assign({ value, exact: value, derived: false, source: sourceOf(c) }, designRef, extra || {});
  };
  const derive = (role, value, exact, note, c, ref) => {
    evidence[role] = Object.assign({ value, exact: exact || '', derived: true, note, source: sourceOf(c) }, ref || designRef);
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
        : (design ? 'DERIVED: the read measured no page ground, so the surface is white.' : 'DERIVED: no page of the brand\'s could be rendered (only its logo file was read), so the surface is white.'),
      colors.surface);
  }

  // Every candidate from every read, judged and scored.
  const all = [];
  for (const r of reads) for (const c of candidatesOf(r)) all.push(c);
  const passedOver = [];
  const isConsent = (c) => CONSENT.test((c.source && c.source.selector) || '');
  const tintRatio = (v) => Math.min(core.contrast(v, surface), surfaceExact ? core.contrast(v, surfaceExact) : Infinity);
  const usable = [];
  for (const c of all) {
    if (isConsent(c)) {
      const by = all.find((o) => o !== c && !isConsent(o) && signals.chromatic(o.value) && dE(o.value, c.value) <= SAME);
      passedOver.push({ value: c.value, from: c.label, why: by
        ? `measured on a consent or cookie banner; the same colour is the brand's by ${by.signal}, which is taken from there instead`
        : 'measured on a consent or cookie banner, which is not an identity signal (its styling is often the consent vendor\'s)' });
      continue;
    }
    const tr = tintRatio(c.value);
    if (tr < 1.5) { passedOver.push({ value: c.value, from: c.label, why: `${tr}:1 against the page, a tint of the page that cannot carry buttons or bands` }); continue; }
    usable.push(c);
  }
  const chromaticC = usable.filter((c) => signals.chromatic(c.value));
  // One mark read two ways (its SVG paint and its pixels) is ONE signal:
  // agreement is counted between FAMILIES of signal, not kinds.
  const family = (k) => (/^logo-/.test(k) ? 'logo' : (k === 'theme-color' || k === 'manifest-theme' ? 'browser-colour' : k));
  for (const c of chromaticC) {
    const agree = new Map();
    for (const o of chromaticC) if (o !== c && family(o.kind) !== family(c.kind) && dE(o.value, c.value) <= SAME && !agree.has(family(o.kind))) agree.set(family(o.kind), o);
    c.corroborated_by = [...agree.values()].slice(0, 4).map((o) => ({ kind: o.kind, value: o.value, signal: o.signal, page: o.source.page || readRef(o.read).read_url }));
    c.score = c.strength + CORROBORATION * Math.min(3, agree.size);
  }
  chromaticC.sort((a, b) => b.score - a.score || b.strength - a.strength);
  let chosen = chromaticC[0] || null;
  let monochrome = null;
  if (!chosen) {
    // No chromatic signal anywhere: a site whose call to action is black (or
    // near it) is monochrome, and keeps that black. Never a grey header.
    const act = usable.find((c) => c.kind === 'action' && core.luminance(c.value) < 0.05);
    if (act) {
      chosen = act;
      const logoNeutral = reads.map((r) => r.manifest && r.manifest.identity && r.manifest.identity.logo_colours).filter(Boolean)
        .map((lc) => signals.markIdentity((lc.paints && lc.paints.length ? lc.paints : lc.pixels) || [])).find((v) => v.verdict === 'neutral');
      monochrome = { logo: logoNeutral ? logoNeutral.hex : '' };
    }
  }
  const seen = new Set();
  const passed = passedOver.filter((p) => { const k = p.value + p.why; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!chosen) {
    return {
      ok: false, palette: null, evidence: Object.assign(evidence, { primary: { value: '', passed_over: passed } }),
      reason: passed.length
        ? `the rendered site shows no brand colour a preset can use (${passed.map((p) => `${p.value} from ${p.from}: ${p.why}`).join('; ')})`
        : 'The rendered site shows no brand colour: no identity colour, no filled call to action and no coloured header.',
    };
  }
  const primary = chosen.value;
  const signalText = monochrome
    ? `the primary call to action, as rendered; the site renders no chromatic brand colour that reads on its page, so its identity is monochrome${monochrome.logo ? ` (its logo mark is ${monochrome.logo}, also neutral)` : ''}`
    : chosen.signal;
  evidence.primary = Object.assign({
    value: primary, exact: primary, derived: false, kind: chosen.kind, strength: chosen.strength, score: chosen.score || chosen.strength,
    from_role: chosen.kind === 'action' ? 'action' : 'identity', signal: signalText, source: chosen.source,
  }, readRef(chosen.read));
  if ((chosen.corroborated_by || []).length) evidence.primary.corroborated_by = chosen.corroborated_by;
  const outranked = chromaticC.filter((c) => c !== chosen && dE(c.value, primary) > SAME).slice(0, 4)
    .map((c) => ({ value: c.value, kind: c.kind, signal: c.signal, score: c.score, page: c.source.page || readRef(c.read).read_url }));
  if (outranked.length) evidence.primary.outranked = outranked;
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
      evidence.ink = Object.assign({
        value: c, exact: inkExact, derived: true, from_role: name,
        note: inkExact
          ? `The body copy as rendered (${inkExact}) measures ${core.contrast(inkExact, surface)}:1 on ${surface}; the ${name} text the site renders (${c}) reads there, so it is the ink.`
          : `The read found no body copy; the ${name} text the site renders (${c}) is the ink.`,
        source: roleSource(name, r, 'color'),
      }, designRef);
      break;
    }
    if (!ink && inkExact) {
      // Light text from a dark page, now on a light one: taken well past AA,
      // so body copy reads as body copy and not as a faded caption.
      ink = core.readableAsText(inkExact, surface, 12);
      derive('ink', ink, inkExact, `DERIVED from ${inkExact}: the body copy as rendered measures ${core.contrast(inkExact, surface)}:1 on ${surface}, and no other text the site renders reads there, so it is darkened until it does (${core.contrast(ink, surface)}:1).`, colors.ink);
    } else if (!ink) {
      ink = core.readableAsText(primary, surface, 12);
      derive('ink', ink, '', `DERIVED from ${primary}: the read found no text colour that reads on ${surface}, so the primary is darkened until it does (${core.contrast(ink, surface)}:1).`, chosen, readRef(chosen.read));
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

  // accent: a SECOND colour the brand renders - an identity or action colour
  // clearly apart from the primary. None: no accent, and the reason.
  const second = chromaticC.filter((c) => c !== chosen && dE(c.value, primary) > DISTINCT && ACCENT_KINDS.has(c.kind))
    .sort((a, b) => b.score - a.score)[0] || null;
  let accent = '';
  if (second) {
    accent = second.value;
    evidence.accent = Object.assign({ value: accent, exact: accent, derived: false, kind: second.kind, from_role: second.kind === 'action' ? 'action' : (second.kind === 'link' ? 'link' : 'identity'), signal: second.signal, source: second.source }, readRef(second.read));
  } else {
    const ra = hex(colors.accent && colors.accent.value);
    const raRefused = ra && ra !== primary ? passed.find((p) => p.value === ra) : null;
    evidence.accent = Object.assign({
      value: '', exact: raRefused ? ra : '', derived: false, absent: true,
      note: raRefused
        ? `The second colour the reader found (${ra}) ${/consent/.test(raRefused.why) ? 'was measured on a consent or cookie banner' : `is a tint of the page (${core.contrast(ra, surface)}:1)`}, so this preset has no accent.`
        : (monochrome
          ? 'The site renders no chromatic colour at all; this preset has no accent rather than one the site does not use.'
          : 'The site renders one brand colour; this preset has no accent rather than the primary repeated or a colour the site does not use.'),
    }, designRef);
  }

  const palette = Object.assign({ primary }, accent ? { accent } : {}, { ink, surface, surface_alt: surfaceAlt, muted }, SEMANTIC);
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
  const out = Object.assign({}, palette, gate.palette);
  if (!accent) delete out.accent;
  return { ok: true, palette: out, evidence, gate: { errors: [], warnings: gate.warnings } };
}

/** One manifest on its own: the home page read alone. */
function paletteFromManifest(manifest) {
  return paletteFromReads([{ manifest, role: 'home', url: (manifest && manifest.url) || '' }]);
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

/** One read's outcome, as the observation lists it. */
function readRow(entry, observedAt) {
  const r = entry.result || null;
  const row = {
    url: entry.url, role: entry.role, what: entry.what || '', kind: entry.kind || 'page',
    owned: entry.owned || null, at: observedAt, attempts: entry.attempts || (r ? 1 : 0),
  };
  if (entry.refused) return Object.assign(row, { renderer: 'refused', ok: false, reason: entry.refused });
  if (!r) return Object.assign(row, { renderer: 'unavailable', ok: false, reason: 'not read' });
  if (r.ok && r.manifest) return Object.assign(row, { renderer: 'rendered', ok: true, landed: r.manifest.url || entry.url });
  if (r.ok && r.image) return Object.assign(row, { renderer: 'image', ok: true, landed: r.image.url || entry.url, mark: r.mark ? { verdict: r.mark.verdict, hex: r.mark.hex || '' } : null });
  return Object.assign(row, { renderer: failureRenderer(r), ok: false, reason: String(r.reason || r.message || 'The reader gave no reason.').slice(0, 400) });
}

/**
 * The observation for one brand from every read of its own material.
 * `home`: readSite's result for the preset's website. `sources`: the identity
 * sources, each { url, kind: 'page'|'image', what, owned, result } or
 * { url, refused: reason } (not the brand's own, so never read).
 */
function observationFromReads(preset, home, sources, observedAt) {
  const srcs = (sources || []).filter(Boolean);
  const homeOk = !!(home && home.ok && home.manifest);
  const rows = [readRow({ url: preset.website, role: 'home', what: 'home page', result: home, attempts: home && home.attempts, owned: { how: 'website', host: hostOf(preset.website) } }, observedAt)]
    .concat(srcs.map((s) => readRow(Object.assign({ role: 'identity source' }, s), observedAt)));
  const okSources = srcs.filter((s) => !s.refused && s.result && s.result.ok && (s.result.manifest || s.result.image));
  if (!homeOk && !okSources.length) {
    const base = failureObservation(preset, home || { ok: false, renderer: 'unavailable', reason: 'not read' }, observedAt);
    if (srcs.length) {
      base.reads = rows;
      base.note = readSentence(base.read_attempt) + ' ' + sourcesSentence(rows) + ' Nothing was filled in; the preset stays on the neutral default.';
    }
    return base;
  }
  // The DESIGN read: the home page when it rendered, else the first of the
  // brand's own pages that did. Its surface, text and type are the preset's.
  const reads = [];
  if (homeOk) reads.push({ manifest: home.manifest, url: preset.website, role: 'home', observed_at: observedAt, owned: rows[0].owned });
  for (const s of okSources) {
    if (s.result.manifest) reads.push({ manifest: s.result.manifest, url: s.url, role: 'identity source', what: s.what || '', observed_at: observedAt, owned: s.owned });
    else reads.push({ image: s.result.image, mark: s.result.mark, url: s.url, role: 'identity source', what: s.what || '', observed_at: observedAt, owned: s.owned });
  }
  const designRead = reads.find((r) => r.manifest) || null;
  const manifest = designRead ? designRead.manifest : null;
  const designResult = homeOk ? home : (okSources.find((s) => s.result.manifest) || {}).result;
  const landed = manifest ? (manifest.url || preset.website) : preset.website;
  const host = hostOf(landed);
  const pal = paletteFromReads(reads);
  const type = manifest ? typographyFromManifest(manifest) : null;
  const assets = manifest ? assetsFromManifest(manifest) : { logo_url: '', logo_signal: '', assets: [] };
  const homeRow = rows[0];
  const base = {
    format: FORMAT,
    ok: true,
    slug: preset.slug,
    start: preset.website,
    landed,
    observed_at: observedAt,
    read_at: manifest ? (manifest.read_at || '') : '',
    // `renderer` is the HOME page's outcome; `reads` lists every read.
    renderer: homeOk ? 'rendered' : homeRow.renderer,
    reason: homeOk ? '' : homeRow.reason,
    reads: rows,
    design_read: designRead ? { url: designRead.url, role: designRead.role, landed } : null,
    reader: readerInfo(designResult, manifest),
    pages: manifest ? (manifest.pages || []).map((p) => ({ url: p.url, role: p.role })) : [],
    viewports: manifest ? (manifest.viewports || {}) : {},
    partial: !!(manifest && manifest.partial),
    regression: homeOk ? regressionSummary(home.regression) : null,
    conflicts: manifest ? (manifest.conflicts || []).map((c) => ({ kind: c.kind, message: c.message })) : [],
    markers: manifest ? (manifest.markers || []).slice(0, 20) : [],
    logo_url: assets.logo_url,
    logo_signal: assets.logo_signal,
    assets: assets.assets,
  };
  if (!homeOk) base.home_attempt = { renderer: homeRow.renderer, at: observedAt, host: hostOf(preset.website), reason: homeRow.reason };
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
  const from = p.read_url && hostOf(p.read_url) !== host ? ` on ${p.read_url}` : '';
  const source = (homeOk ? `Rendered ${landed}` : `${hostOf(preset.website)} refused an automated read (${homeRow.renderer}); read the brand's own ${designRead ? designRead.url : p.read_url}`)
    + ` in Chromium${base.reader.chromium ? ' ' + base.reader.chromium : ''} on ${observedAt}. `
    + `Primary ${pal.palette.primary} from ${p.signal || 'the rendered page'}`
    + (p.source && p.source.selector ? ` (${p.source.selector})` : '') + from + '.'
    + ((p.corroborated_by || []).length ? ` Agreed by ${p.corroborated_by.map((c) => c.kind).join(', ')}.` : '')
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

/** "Its own pages about.example.com (blocked) ... were also tried." */
function sourcesSentence(rows) {
  const s = (rows || []).filter((r) => r.role === 'identity source');
  if (!s.length) return '';
  return `Its own other material was tried too: ${s.map((r) => `${hostOf(r.url)} (${r.renderer === 'refused' ? 'not shown to be the brand\'s' : r.renderer})`).join(', ')}.`;
}

/** A single read (the home page alone), as before identity sources existed. */
function observationFromRead(preset, result, observedAt) {
  if (!result || !result.ok || !result.manifest) return failureObservation(preset, result, observedAt);
  return observationFromReads(preset, result, [], observedAt);
}

module.exports = {
  FORMAT, RENDERERS, SEMANTIC,
  observationFromRead, observationFromReads, failureObservation, failureRenderer, readSentence, sourcesSentence,
  paletteFromManifest, paletteFromReads, candidatesOf, typographyFromManifest, assetsFromManifest, regressionSummary, hostOf,
};
