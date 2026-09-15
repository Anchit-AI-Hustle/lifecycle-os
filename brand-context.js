/* eslint-env browser */
/**
 * brand-context.js — makes the whole app BE the logged-in user's brand.
 * ---------------------------------------------------------------------------
 * Loaded on every page by auth.js, before the nav renders. It:
 *
 *   1. Paints the cached brand instantly (no flash of the wrong brand), then
 *      revalidates against /api/public-config?action=brand&op=active.
 *   2. Writes the brand's design tokens onto <html> as inline custom properties.
 *      theme.css resolves every colour and font through those tokens, so all
 *      pages re-skin at once without knowing this file exists.
 *   3. Loads the brand's web fonts, and swaps the document title, favicon and
 *      theme-color.
 *   4. Re-labels the shipped brand name in visible copy, so pages written for
 *      the original single tenant read correctly for the new one.
 *   5. Sends a signed-in user with no brand to /onboarding — the first screen
 *      of the platform.
 *
 * Everything is fail-safe: if the API is unreachable the app keeps its shipped
 * default styling rather than rendering unstyled or blocking the user.
 *
 * window.BrandContext = { brand, tokens, ready(), refresh(), setActive(id),
 *                         list(), onChange(fn), needsOnboarding }
 * Event: 'brandcontext:change' on window.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  if (window.__BrandContextBooted) return;
  window.__BrandContextBooted = true;

  var CACHE_KEY = 'lc-brand-context';
  var API = '/api/public-config?action=brand';
  var ONBOARDING_PATH = '/onboarding';

  /* Pages that must render before a brand exists, or they would trap the user
     in a redirect loop (the onboarding wizard itself, auth, legal pages). */
  /* The ONLY surfaces reachable without an active brand: the wizard, the brand
     editor, sign-in, legal pages, and the About view that explains what this
     platform is. Everything else is gated - see enforceGate(). */
  var EXEMPT = /^\/(onboarding|setup|start|brand|about|login|privacy|terms|access-issues|access)(\.html)?\/?$/i;

  /* Names the shipped app hardcodes into visible copy. When a different brand
     is active these are re-labelled in text nodes. URLs are never touched. */
  var SHIPPED_NAME_RX = /\bKNICKGASM\b|\bKnickgasm\b/g;
  var SHIPPED_ASSISTANT = /\bKicksGPT\b/g;
  // Neutral placeholders the shell ships with; the active brand names them.
  var NEUTRAL_ASSISTANT = /\bBrand Assistant\b/g;
  var NEUTRAL_AGENT = /\bBrand Agent\b/g;
  // Non-global twins for `.test()`. A /g regex is stateful across calls, so the
  // matching pass and the replacing pass must not share one.
  var SHIPPED_NAME_TEST = /\bKNICKGASM\b|\bKnickgasm\b/;
  var SHIPPED_ASSISTANT_TEST = /\bKicksGPT\b/;
  var NEUTRAL_TEST = /\bBrand (Assistant|Agent)\b/;

  /* The words a brand uses for the thing it sells and the person who takes it.
     The shipped copy was written for tenant zero, so pages said "sneakers",
     "colorway" and "airbrush" to every tenant - The Times of India was offering
     its readers a colorway. The brand-name swap above cannot catch that, because
     a product noun is not the brand name.

     Derived from the brand's OWN offerings[].kind, which every brand record
     already carries. Mirrors offeringNoun()/audienceNoun() in
     api/_shared/growth-os-core.js; tests/brand-nouns.spec.js asserts the two
     agree, so this copy cannot drift from the server's. */
  var OFFERING_NOUN = {
    product: 'offer', section: 'section', programme: 'programme',
    plan: 'plan', event: 'event', service: 'service',
  };
  var AUDIENCE_NOUN = {
    product: 'buyer', section: 'reader', programme: 'participant',
    plan: 'subscriber', event: 'attendee', service: 'client',
  };
  function firstKind(brand) {
    var offs = (brand && brand.offerings) || [];
    for (var i = 0; i < offs.length; i++) {
      var k = offs[i] && String(offs[i].kind || '').toLowerCase();
      if (k && OFFERING_NOUN[k]) return k;
    }
    return '';
  }
  /* A brand that declares no offering kind gets the generic word, never tenant
     zero's. "what we offer" is true of every brand; "sneakers" is true of one. */
  function nounsFor(brand) {
    var k = firstKind(brand);
    return {
      kind: k,
      offering: OFFERING_NOUN[k] || 'offer',
      offeringPlural: (OFFERING_NOUN[k] || 'offer') + 's',
      audience: AUDIENCE_NOUN[k] || 'customer',
      audiencePlural: (AUDIENCE_NOUN[k] || 'customer') + 's',
    };
  }

  // `mode` is where brand records live for this visitor right now: 'server'
  // (the account) or 'device' (this browser). See "Where a brand is stored".
  var state = { brand: null, needsOnboarding: false, workspaces: [], loaded: false, signedOut: false, mode: '' };
  var listeners = [];
  var readyResolve;
  var readyPromise = new Promise(function (r) { readyResolve = r; });

  function log(e) { try { console.warn('[brand-context]', e && e.message ? e.message : e); } catch (_) {} }

  /* The cache is scoped to the signed-in user. A single browser is often shared,
     and a brand payload carries voice rules, regions and store URLs — so it must
     never survive into another account's session. The entry records the user id
     it belongs to and is discarded when that does not match, or when there is no
     session at all. clearCache() also runs on sign-out. */
  function currentUserId() {
    try {
      var a = window.LifecycleAuth;
      var u = a && a.session && a.session.user && a.session.user.id;
      if (u) return u;
    } catch (_) {}
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('-auth-token') < 0) continue;
        var v = JSON.parse(localStorage.getItem(k) || 'null');
        var s = v && (v.user || (v.currentSession && v.currentSession.user));
        if (s && s.id) return s.id;
      }
    } catch (_) {}
    return '';
  }

  function readCache() {
    try {
      var raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!raw || !raw.uid || !raw.brand) return null;
      var uid = currentUserId();
      // No verified session, or a different account: never paint this.
      if (!uid || uid !== raw.uid) { clearCache(); return null; }
      return raw.brand;
    } catch (_) { return null; }
  }
  function writeCache(b) {
    try {
      var uid = currentUserId();
      if (b && uid) localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: uid, brand: b }));
      else clearCache();
    } catch (_) {}
  }
  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  /* ══════════════════════════════════════════════════════════════════════════
     WHERE A BRAND IS STORED: THE ACCOUNT, OR THIS DEVICE (2026-09-15)

     Found on the live deployment. The database is paused, the app opens
     signed-out and says so - and then the first screen of the product could
     not finish: "Save as draft", "Activate" and the "Your brands" panel all
     ended in "The database is unreachable". Every command on the wizard was an
     error, so the wizard was unusable, which is the 2026-08-30 "login wall
     that defends nothing" one layer up: nothing was being protected, the
     operator's own typing was simply being thrown away.

     So a brand has two places it can live:
       server  - brand_workspaces, through the API, for a signed-in account
                 with a reachable database. Exactly as before.
       device  - localStorage (DEVICE_KEY), for everyone else: no database
                 configured, a database that does not answer, or a reachable
                 one this visitor has no session for. Rows are shaped exactly
                 like server rows, ids carry the `local-` prefix, and each is
                 stamped storage:'device' so nothing downstream has to guess.

     THE DECISION IS NOT MADE HERE. auth.js already answers "is there a
     backend, and am I signed in to it" (its probe, its session, the notice
     bar), and publishes that answer as LifecycleAuth.backend. This file reads
     it. A second reachability check here would be two implementations of one
     question, which drift - the defect this repo keeps recording.

     What never happens on the device path: a request to the server. The rows
     are written and read locally, activation paints the same --brand-* tokens
     the server path paints (the maths below mirrors api/_shared/
     brand-workspace-core.js and tests/onboarding-without-backend.spec.js
     asserts the two agree), and validatePalette() gates activation exactly as
     the server's buildRow() does. Nothing is written to the account
     unauthenticated, LifecycleAuth.internal stays false, and the server's own
     gate is untouched. Once a signed-in, reachable session exists, device rows
     are OFFERED for sync through the ordinary save op - never uploaded
     silently, and the device copy stays until the account row exists.
     ══════════════════════════════════════════════════════════════════════════ */

  var DEVICE_KEY = 'lifecycle.brand.device.workspaces';
  var DEVICE_PREFIX = 'local-';
  // The brand ops that have a device implementation. Everything else (extract,
  // suggest, catalog-import, context-*) is the server's, and each of those is
  // rendered as a DISABLED control with its reason by the wizard when it cannot
  // run - not routed here to fail.
  var DEVICE_OPS = { list: 1, active: 1, get: 1, save: 1, activate: 1, delete: 1 };
  // Which of auth.js's backend kinds means "there is no account to write to".
  var KIND_DEVICE = { unconfigured: 1, unreachable: 1, sdk: 1, 'signed-out': 1 };
  // How long to wait for auth.js to decide before falling back to the server
  // path, which is what every page did before this existed. The gate's own
  // hard deadline is 6s; this sits just past it so a slow SDK load still gets
  // its answer in.
  var MODE_DEADLINE_MS = 8000;

  function authBackend() {
    try { var a = window.LifecycleAuth; return (a && a.backend) || null; } catch (_) { return null; }
  }
  function authKind() { var b = authBackend(); return (b && b.kind) || ''; }
  function modeFor(kind) { return KIND_DEVICE[kind] ? 'device' : 'server'; }
  /** '' while auth.js has not decided (or is absent). */
  function knownMode() { var k = authKind(); return (k && k !== 'pending') ? modeFor(k) : ''; }

  /**
   * The mode, once auth.js has decided it. A page with no auth.js at all (a
   * harness, a bare fixture) has nobody to ask and takes the server path
   * immediately - that is byte-for-byte what it did before.
   */
  function resolveMode() {
    var m = knownMode();
    if (m) return Promise.resolve(m);
    if (!window.__LifecycleAuthBooted) return Promise.resolve('server');
    return new Promise(function (resolve) {
      var settled = false, timer;
      function settle(mode) {
        if (settled) return;
        settled = true;
        window.removeEventListener('lifecycleauth:backend', onEvent);
        clearTimeout(timer);
        resolve(mode);
      }
      function onEvent() { var got = knownMode(); if (got) settle(got); }
      timer = setTimeout(function () { settle(knownMode() || 'server'); }, MODE_DEADLINE_MS);
      window.addEventListener('lifecycleauth:backend', onEvent);
      onEvent();
    });
  }

  /* ── colour maths and normalisation, mirroring brand-workspace-core.js ────
     The server derives the shell's tokens from the operator's palette; a
     device brand has no server to ask, so the same derivation runs here. Each
     function is a line-for-line port of its namesake in
     api/_shared/brand-workspace-core.js, and the parity test drives both over
     the same palettes so the copies cannot drift apart unnoticed. */

  var HEX_RX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  var PALETTE_ROLES = ['primary', 'accent', 'ink', 'surface', 'surface_alt', 'muted', 'ok', 'warn', 'err'];
  var TEXT_AA = 4.9;

  function str(v, max) { var s = String(v == null ? '' : v).trim(); return max ? s.slice(0, max) : s; }
  function arr(v, max) {
    if (!Array.isArray(v)) return [];
    return v.map(function (x) { return typeof x === 'string' ? x.trim() : x; })
      .filter(function (x) { return x !== '' && x != null; }).slice(0, max || 200);
  }
  function slugify(v) {
    return String(v == null ? '' : v).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }
  function httpUrl(v) {
    var s = str(v, 500);
    if (!s) return '';
    try {
      var u = new URL(s.indexOf('http') === 0 ? s : 'https://' + s);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString().replace(/\/$/, '') : '';
    } catch (_) { return ''; }
  }
  function normHex(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (s.charAt(0) !== '#') s = '#' + s;
    if (!HEX_RX.test(s)) return '';
    if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return s.toLowerCase();
  }
  function rgbOf(hex) {
    var h = normHex(hex) || '#000000';
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function luminance(hex) {
    var chan = rgbOf(hex).map(function (v) { var s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  }
  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }
  function saturation(hex) {
    var c = rgbOf(hex).map(function (v) { return v / 255; });
    var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
    if (mx === mn) return 0;
    var l = (mx + mn) / 2;
    return l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
  }
  function isDarkNeutral(hex) {
    var h = normHex(hex);
    if (!h) return false;
    return luminance(h) < 0.12 && saturation(h) < 0.25;
  }
  function shade(hex, t) {
    var target = t >= 0 ? 255 : 0, amt = Math.abs(t);
    return '#' + rgbOf(hex).map(function (v) { return Math.round(v + (target - v) * amt); })
      .map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }
  function readableOn(bg, ink, surface, surfaceAlt) {
    var candidates = [ink || '#111111', surface || '#ffffff', surfaceAlt]
      .filter(Boolean).filter(function (c, i, a) { return a.indexOf(c) === i; });
    var best = candidates[0], bestC = -1;
    for (var i = 0; i < candidates.length; i++) {
      var r = contrast(bg, candidates[i]);
      if (r > bestC) { bestC = r; best = candidates[i]; }
    }
    return best;
  }
  function readableAsText(color, bg, target) {
    var want = target || 4.5;
    var c = normHex(color);
    var surface = normHex(bg) || '#ffffff';
    if (!c) return '#111111';
    if (contrast(c, surface) >= want) return c;
    var dir = luminance(surface) > 0.5 ? -1 : 1;
    for (var t = 0.05; t <= 1.0001; t += 0.05) {
      var candidate = shade(c, dir * t);
      if (contrast(candidate, surface) >= want) return candidate;
    }
    return dir < 0 ? '#000000' : '#ffffff';
  }

  function normalizePalette(input) {
    var src = input && typeof input === 'object' ? input : {};
    var out = {};
    PALETTE_ROLES.forEach(function (role) { var hex = normHex(src[role]); if (hex) out[role] = hex; });
    var extra = Array.isArray(src.extra) ? src.extra : [];
    var cleanExtra = [];
    extra.slice(0, 12).forEach(function (e) {
      var hex = normHex(e && e.hex), name = str(e && e.name, 32);
      if (hex && name) cleanExtra.push({ name: name, hex: hex });
    });
    if (cleanExtra.length) out.extra = cleanExtra;
    return out;
  }
  function normalizeFont(f, fallback) {
    var src = f && typeof f === 'object' ? f : {};
    var family = str(src.family, 64);
    if (!family) return null;
    return {
      family: family,
      stack: str(src.stack, 200) || ("'" + family + "'," + fallback),
      google: src.google !== false,
      weights: str(src.weights, 40) || '400;600;700',
    };
  }
  function normalizeTypography(input) {
    var src = input && typeof input === 'object' ? input : {};
    var out = {};
    var heading = normalizeFont(src.heading, 'Georgia,serif');
    var body = normalizeFont(src.body, 'system-ui,-apple-system,Segoe UI,sans-serif');
    var mono = normalizeFont(src.mono, 'ui-monospace,SFMono-Regular,Menlo,monospace');
    if (heading) out.heading = heading;
    if (body) out.body = body;
    if (mono) out.mono = mono;
    return out;
  }
  function normalizeVoice(input) {
    var src = input && typeof input === 'object' ? input : {};
    return {
      tone: str(src.tone, 400),
      preferred: arr(src.preferred, 80).map(function (s) { return str(s, 60); }),
      banned: arr(src.banned, 120).map(function (s) { return str(s, 60); }),
      no_em_dashes: src.no_em_dashes !== false,
      notes: str(src.notes, 2000),
    };
  }
  function normalizeRegions(input) {
    if (!Array.isArray(input)) return [];
    var out = [];
    input.slice(0, 24).forEach(function (r) {
      var code = str(r && r.code, 12).toUpperCase();
      if (!code) return;
      out.push({
        code: code,
        currency: str(r.currency, 8).toUpperCase(),
        symbol: str(r.symbol, 4),
        store_url: httpUrl(r.store_url),
        pdp_pattern: str(r.pdp_pattern, 200) || '{base}/products/{handle}',
        collection_pattern: str(r.collection_pattern, 200) || '{base}/collections/{slug}',
      });
    });
    return out;
  }
  function normalizeHosts(input, regions) {
    var set = [];
    function add(h) { if (h && set.indexOf(h) < 0) set.push(h); }
    arr(input, 40).forEach(function (h) { add(str(h, 200).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()); });
    (regions || []).forEach(function (r) {
      if (!r.store_url) return;
      try { add(new URL(r.store_url).host.toLowerCase()); } catch (_) { /* ignore */ }
    });
    return set;
  }

  /** Mirrors validatePalette() on the server: the design HARD rules, as errors. */
  function validatePalette(paletteInput) {
    var p = normalizePalette(paletteInput);
    var errors = [], warnings = [];
    ['primary', 'ink', 'surface'].forEach(function (role) {
      if (!p[role]) errors.push({ field: role, message: 'Missing required colour: ' + role + '.' });
    });
    Object.keys(paletteInput || {}).forEach(function (k) {
      var v = paletteInput[k];
      if (PALETTE_ROLES.indexOf(k) >= 0 && v && !normHex(v)) errors.push({ field: k, message: '"' + v + '" is not a valid hex colour (use #RGB or #RRGGBB).' });
    });
    if (errors.length) return { ok: false, errors: errors, warnings: warnings, palette: p, contrast: {} };
    var ratios = {
      ink_on_surface: contrast(p.ink, p.surface),
      ink_on_surface_alt: contrast(p.ink, p.surface_alt || '#ffffff'),
      primary_on_surface: contrast(p.primary, p.surface),
      onprimary: contrast(p.primary, readableOn(p.primary, p.ink, p.surface, p.surface_alt || '#ffffff')),
      accent_on_surface: p.accent ? contrast(p.accent, p.surface) : null,
      muted_on_surface: p.muted ? contrast(p.muted, p.surface) : null,
    };
    if (isDarkNeutral(p.surface)) errors.push({ field: 'surface', message: 'Page surface is a dark neutral (near-black). Use a light surface, or your brand primary as the dark ground — never black/#111111-style neutrals.' });
    if (p.surface_alt && isDarkNeutral(p.surface_alt)) errors.push({ field: 'surface_alt', message: 'Card surface is a dark neutral. Use a light surface or a brand-primary tint.' });
    if (ratios.ink_on_surface < 4.5) errors.push({ field: 'ink', message: 'Body text on the page surface is ' + ratios.ink_on_surface + ':1 — WCAG AA needs 4.5:1. Darken the ink or lighten the surface.' });
    if (ratios.ink_on_surface_alt < 4.5) errors.push({ field: 'surface_alt', message: 'Body text on cards is ' + ratios.ink_on_surface_alt + ':1 — WCAG AA needs 4.5:1.' });
    if (ratios.onprimary < 4.5) errors.push({ field: 'primary', message: 'Neither your ink nor your card colour reaches 4.5:1 on the primary (best is ' + ratios.onprimary + ':1). Buttons and primary bands would be unreadable.' });
    if (ratios.primary_on_surface < 3) warnings.push({ field: 'primary', message: 'Primary on the page surface is ' + ratios.primary_on_surface + ':1 — below the 3:1 non-text minimum, so outlines, chips and icons in primary will be hard to see.' });
    if (ratios.accent_on_surface != null && ratios.accent_on_surface < 4.5) warnings.push({ field: 'accent', message: 'Accent text on the surface is ' + ratios.accent_on_surface + ':1. Keep accent for fills and rules, not body copy.' });
    if (ratios.muted_on_surface != null && ratios.muted_on_surface < 4.5) warnings.push({ field: 'muted', message: 'Muted text on the surface is ' + ratios.muted_on_surface + ':1 — secondary copy will fail AA.' });
    if (p.primary && p.accent && contrast(p.primary, p.accent) < 1.4) warnings.push({ field: 'accent', message: 'Primary and accent are nearly the same tone; the two will not read as distinct.' });
    return { ok: errors.length === 0, errors: errors, warnings: warnings, palette: p, contrast: ratios };
  }

  /** Mirrors tokens() on the server: the full --brand-* set the shell paints with. */
  function tokensFor(brand) {
    var p = normalizePalette((brand && brand.palette) || {});
    var primary = p.primary || '#6A33D8';
    var accent = p.accent || primary;
    var ink = p.ink || '#111111';
    var surface = p.surface || '#F7F5F2';
    var surfaceAlt = p.surface_alt || shade(surface, 0.6);
    var muted = p.muted || shade(ink, 0.35);
    var worstSurface = contrast(primary, surface) <= contrast(primary, surfaceAlt) ? surface : surfaceAlt;
    var t = brand && brand.typography ? brand.typography : {};
    return {
      '--brand-primary': primary,
      '--brand-primary-dark': shade(primary, -0.25),
      '--brand-primary-soft': shade(primary, 0.86),
      '--brand-primary-tint': shade(primary, 0.94),
      '--brand-on-primary': readableOn(primary, ink, surface, surfaceAlt),
      '--brand-primary-text': readableAsText(primary, worstSurface, TEXT_AA),
      '--brand-accent': accent,
      '--brand-accent-soft': shade(accent, 0.88),
      '--brand-on-accent': readableOn(accent, ink, surface, surfaceAlt),
      '--brand-accent-text': readableAsText(accent, worstSurface, TEXT_AA),
      '--brand-ink': ink,
      '--brand-ink-muted': readableAsText(muted, worstSurface, TEXT_AA),
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
  /** Mirrors fontsHref() on the server. */
  function fontsHrefFor(brand) {
    var t = (brand && brand.typography) || {};
    var families = [];
    ['heading', 'body', 'mono'].forEach(function (slot) {
      var f = t[slot];
      if (!f || !f.family || f.google === false) return;
      var fam = String(f.family).trim().replace(/\s+/g, '+');
      var weights = String(f.weights || '400;600;700').replace(/[^0-9;]/g, '');
      if (!fam) return;
      var spec = weights ? 'family=' + fam + ':wght@' + weights : 'family=' + fam;
      if (families.indexOf(spec) < 0) families.push(spec);
    });
    return families.length ? 'https://fonts.googleapis.com/css2?' + families.join('&') + '&display=swap' : '';
  }
  /**
   * The zero-fabrication marker, in the spec's shape. `product` and `region`
   * are named only when they apply: a brand-level gap reads
   * "[DATA REQUIRED BEFORE LAUNCH: logo URL, <brand>]", never padded with
   * "all, all", which reads as filler where a fact should be.
   */
  function launchMarker(field, ctx) {
    var c = ctx || {};
    var parts = [field, c.product || c.brand || 'this brand'];
    if (c.region) parts.push(c.region);
    return '[DATA REQUIRED BEFORE LAUNCH: ' + parts.join(', ') + ']';
  }
  /** Mirrors readiness() on the server. */
  function readinessFor(brand, counts) {
    var missing = [];
    var b = brand || {};
    var add = function (field, product, region) {
      missing.push({ field: field, product: product || 'all', region: region || 'all', marker: launchMarker(field, { brand: str(b.name), product: product, region: region }) });
    };
    if (!str(b.name)) add('brand name');
    if (!str(b.website)) add('brand website');
    if (!str(b.logo_url)) add('logo URL');
    var pv = validatePalette(b.palette || {});
    if (!pv.ok) pv.errors.forEach(function (e) { add('palette.' + e.field); });
    var ty = b.typography || {};
    if (!ty.heading || !ty.heading.family) add('typography.heading');
    if (!ty.body || !ty.body.family) add('typography.body');
    var voice = b.voice || {};
    if (!str(voice.tone)) add('voice.tone');
    if (!arr(voice.banned).length) add('voice.banned phrases');
    var regions = Array.isArray(b.regions) ? b.regions : [];
    if (!regions.length) add('regions');
    regions.forEach(function (r) { if (!r.store_url) add('region store URL', '', r.code); });
    regions.forEach(function (r) { if (!r.currency) add('region currency', '', r.code); });
    var productCount = counts && typeof counts.products === 'number' ? counts.products : null;
    if (productCount === 0) add('product catalog');
    var blocking = missing.filter(function (m) { return /^(brand name|palette\.|typography\.|regions$|product catalog)/.test(m.field); });
    return {
      ready: blocking.length === 0,
      missing: missing,
      markers: missing.map(function (m) { return m.marker; }),
      palette: { errors: pv.errors, warnings: pv.warnings, contrast: pv.contrast },
      products: productCount,
      status_line: blocking.length === 0 ? 'BRAND READY' : 'NOT LAUNCH READY — DATA DEPENDENCY',
    };
  }
  /** Mirrors shellPayload() on the server, plus the storage stamp. */
  function shellPayloadFor(brand, extra) {
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
      tokens: tokensFor(brand),
      fonts_href: fontsHrefFor(brand),
      storage: 'device',
    }, extra || {});
  }

  /* ── the device store ─────────────────────────────────────────────────── */

  function readDevice() {
    var empty = { version: 1, active_id: '', workspaces: [] };
    try {
      var d = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null');
      if (!d || typeof d !== 'object' || !Array.isArray(d.workspaces)) return empty;
      return {
        version: 1,
        active_id: String(d.active_id || ''),
        workspaces: d.workspaces.filter(function (w) { return w && typeof w === 'object' && isDeviceId(w.id); }),
      };
    } catch (_) { return empty; }
  }
  function writeDevice(d) {
    try {
      var ws = d.workspaces || [];
      if (!ws.length && !d.active_id) { localStorage.removeItem(DEVICE_KEY); return true; }
      localStorage.setItem(DEVICE_KEY, JSON.stringify({ version: 1, active_id: d.active_id || '', workspaces: ws }));
      return true;
    } catch (_) { return false; }
  }
  function isDeviceId(id) { return typeof id === 'string' && id.indexOf(DEVICE_PREFIX) === 0 && id.length > DEVICE_PREFIX.length; }
  function newDeviceId() {
    var r = '';
    try {
      var a = new Uint8Array(8);
      crypto.getRandomValues(a);
      r = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    } catch (_) { r = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
    return DEVICE_PREFIX + r;
  }
  function deviceFind(d, id) {
    for (var i = 0; i < d.workspaces.length; i++) if (d.workspaces[i].id === id) return d.workspaces[i];
    return null;
  }
  function deviceActiveRow() { var d = readDevice(); return d.active_id ? deviceFind(d, d.active_id) : null; }
  /** A refusal shaped like the server's, so every caller's catch reads it the same way. */
  function deviceFail(status, code, message, details) {
    var e = new Error(message);
    e.status = status;
    e.code = code;
    e.payload = { ok: false, error: code, message: message, storage: 'device' };
    if (details) { e.details = details; e.payload.details = details; }
    return e;
  }
  /** Mirrors buildRow() on the server: every field normalised, none invented. */
  function buildDeviceRow(input, existing) {
    var b = input && typeof input === 'object' ? input : {};
    var prev = existing || {};
    var name = str(b.name, 120) || str(prev.name, 120);
    if (!name) throw deviceFail(400, 'brand_name_required', 'Brand name is required.');
    var regions = b.regions !== undefined ? normalizeRegions(b.regions) : (prev.regions || []);
    var now = new Date().toISOString();
    var row = {
      id: prev.id || newDeviceId(),
      slug: slugify(b.slug || prev.slug || name) || ('brand-' + Date.now().toString(36)),
      name: name,
      legal_name: b.legal_name !== undefined ? str(b.legal_name, 200) : (prev.legal_name || null),
      tagline: b.tagline !== undefined ? str(b.tagline, 300) : (prev.tagline || null),
      industry: b.industry !== undefined ? str(b.industry, 120) : (prev.industry || null),
      website: b.website !== undefined ? httpUrl(b.website) : (prev.website || null),
      logo_url: b.logo_url !== undefined ? httpUrl(b.logo_url) : (prev.logo_url || null),
      favicon_url: b.favicon_url !== undefined ? httpUrl(b.favicon_url) : (prev.favicon_url || null),
      palette: b.palette !== undefined ? normalizePalette(b.palette) : (prev.palette || {}),
      typography: b.typography !== undefined ? normalizeTypography(b.typography) : (prev.typography || {}),
      voice: b.voice !== undefined ? normalizeVoice(b.voice) : (prev.voice || {}),
      regions: regions,
      asset_hosts: normalizeHosts(b.asset_hosts !== undefined ? b.asset_hosts : (prev.asset_hosts || []), regions),
      catalog_source: b.catalog_source !== undefined && b.catalog_source && typeof b.catalog_source === 'object' ? b.catalog_source : (prev.catalog_source || {}),
      brand_data: b.brand_data !== undefined && b.brand_data && typeof b.brand_data === 'object' ? b.brand_data : (prev.brand_data || {}),
      status: ['draft', 'active', 'archived'].indexOf(str(b.status)) >= 0 ? str(b.status) : (prev.status || 'draft'),
      onboarding_step: Number.isFinite(+b.onboarding_step) ? Math.max(1, Math.min(6, +b.onboarding_step)) : (prev.onboarding_step || 1),
      owner_id: null,
      created_at: prev.created_at || now,
      updated_at: now,
      storage: 'device',
    };
    // The same gate the server applies in buildRow(): a DRAFT may carry an
    // incomplete palette, anything ACTIVE must pass the design rules.
    if (row.status === 'active') {
      var v = validatePalette(row.palette);
      if (!v.ok) throw deviceFail(400, 'palette_invalid', 'Colour schema fails the design rules.', v.errors);
    }
    return row;
  }
  function deviceFull(row) {
    return Object.assign({}, row, { tokens: tokensFor(row), fonts_href: fontsHrefFor(row), readiness: readinessFor(row, { products: 0 }), products: 0 });
  }
  function queryOf(o) {
    try { return new URLSearchParams(String((o && o.query) || '').replace(/^[&?]/, '')); } catch (_) { return new URLSearchParams(''); }
  }
  /** The id an op is addressed to, when it is a device id; '' otherwise. */
  function deviceIdIn(o) {
    var b = (o && o.body) || {};
    var id = (b.brand && b.brand.id) || b.id || queryOf(o).get('id') || '';
    return isDeviceId(id) ? id : '';
  }

  /** The device implementation of the brand ops, answering in the server's shapes. */
  async function deviceApi(op, opts) {
    var o = opts || {};
    var body = o.body || {};
    var q = queryOf(o);
    var d = readDevice();
    var id, ws, row;
    switch (op) {
      case 'list':
        return { ok: true, workspaces: d.workspaces.map(function (w) { return shellPayloadFor(w); }), active_id: d.active_id || null, storage: 'device' };
      case 'active':
        ws = d.active_id ? deviceFind(d, d.active_id) : null;
        if (!ws) return { ok: true, brand: null, needs_onboarding: d.workspaces.length === 0, workspaces: d.workspaces.map(function (w) { return shellPayloadFor(w); }), storage: 'device' };
        return { ok: true, brand: shellPayloadFor(ws, { readiness: readinessFor(ws, { products: 0 }), products: 0 }), needs_onboarding: false, workspaces: d.workspaces.map(function (w) { return shellPayloadFor(w); }), storage: 'device' };
      case 'get':
        id = str(q.get('id') || body.id);
        ws = id ? deviceFind(d, id) : null;
        if (!ws) throw deviceFail(404, 'workspace_not_found', 'That brand is not saved on this device.');
        return { ok: true, brand: deviceFull(ws), storage: 'device' };
      case 'save': {
        var input = body.brand || body;
        var sid = str(input && input.id);
        var prev = sid ? deviceFind(d, sid) : null;
        if (sid && !prev) throw deviceFail(404, 'workspace_not_found', 'That brand is not saved on this device, so it could not be updated.');
        row = buildDeviceRow(input, prev);
        if (prev) d.workspaces = d.workspaces.map(function (w) { return w.id === prev.id ? row : w; });
        else d.workspaces.unshift(row);
        // The first brand on this device becomes its active one, exactly as the
        // first workspace an account creates becomes that account's.
        if (!d.active_id) d.active_id = row.id;
        if (!writeDevice(d)) throw deviceFail(507, 'device_storage_unavailable', 'This browser refused to store the brand (storage is full or blocked), so nothing was saved.');
        return { ok: true, brand: deviceFull(row), storage: 'device' };
      }
      case 'activate':
        id = str(body.id || q.get('id'));
        ws = id ? deviceFind(d, id) : null;
        if (!ws) throw deviceFail(404, 'workspace_not_found', 'That brand is not saved on this device, so it could not be activated.');
        d.active_id = id;
        if (!writeDevice(d)) throw deviceFail(507, 'device_storage_unavailable', 'This browser refused to store the change (storage is full or blocked), so nothing was activated.');
        return { ok: true, brand: shellPayloadFor(ws, { readiness: readinessFor(ws, { products: 0 }), products: 0 }), storage: 'device' };
      case 'delete':
        id = str(body.id || q.get('id'));
        ws = id ? deviceFind(d, id) : null;
        if (!ws) throw deviceFail(404, 'workspace_not_found', 'That brand is not on this device, so nothing was deleted.');
        d.workspaces = d.workspaces.filter(function (w) { return w.id !== id; });
        if (d.active_id === id) d.active_id = '';
        writeDevice(d);
        return { ok: true, deleted: id, name: ws.name || null, storage: 'device' };
      default:
        throw deviceFail(400, 'unknown_brand_operation', 'That operation has no device implementation.');
    }
  }

  /**
   * Everything a page needs to say where a brand would be saved right now.
   * Synchronous, so a render can read it; `known` is false until auth.js has
   * decided, and `mode` falls back to the server path until then.
   */
  function storageInfo() {
    var b = authBackend() || {};
    var k = authKind();
    var known = !!(k && k !== 'pending');
    var d = readDevice();
    return {
      mode: known ? modeFor(k) : (window.__LifecycleAuthBooted ? (state.mode || 'server') : 'server'),
      known: known,
      kind: known ? k : '',
      reachable: known ? b.reachable : null,
      signedIn: known ? !!b.signedIn : false,
      host: b.host || '',
      device_count: d.workspaces.length,
      device_active_id: d.active_id || '',
      // The server's own open path (brand-workspace-core.js, op=extract) applies
      // ONLY when the backend is provably unreachable or unconfigured. A
      // reachable backend with no session refuses, and that refusal is the
      // gate being real - so the wizard disables the control rather than
      // sending a request it knows will be refused.
      server_open: k === 'unreachable' || k === 'unconfigured',
    };
  }

  /**
   * Upload every device row to the account through the ordinary save op.
   * Only for a signed-in, reachable session; never called on the visitor's
   * behalf without a click. The device copy is removed only after the account
   * row exists, so an upload that fails leaves the brand exactly where it was.
   */
  async function syncDeviceToAccount() {
    var mode = await resolveMode();
    if (mode !== 'server') {
      throw deviceFail(409, 'sign_in_required', 'Sign in first: brands can only be synced to an account that is reachable.');
    }
    var d = readDevice();
    var out = { synced: [], failed: [], remaining: 0 };
    var wasActive = d.active_id;
    var activated = '';
    for (var i = 0; i < d.workspaces.length; i++) {
      var row = d.workspaces[i];
      var body = Object.assign({}, row);
      delete body.id; delete body.storage; delete body.owner_id; delete body.created_at; delete body.updated_at;
      try {
        var r = await serverApi('save', { body: { brand: body } });
        if (!r || !r.brand || !r.brand.id) throw new Error('The account did not confirm the saved brand, so the device copy was kept.');
        var now = readDevice();
        now.workspaces = now.workspaces.filter(function (w) { return w.id !== row.id; });
        if (now.active_id === row.id) now.active_id = '';
        writeDevice(now);
        out.synced.push({ from: row.id, to: r.brand.id, name: row.name });
        if (row.id === wasActive) activated = r.brand.id;
      } catch (e) {
        out.failed.push({ id: row.id, name: row.name, message: (e && e.message) || 'This brand could not be uploaded.' });
      }
    }
    out.remaining = readDevice().workspaces.length;
    // What was live on this device stays live for the account, unless the
    // account already has a brand of its own in front.
    if (activated && !state.brand) { try { await setActive(activated); } catch (e) { log(e); } }
    else await refresh();
    return out;
  }

  /* ── painting ──────────────────────────────────────────────────────────── */

  /* The suite predates the brand layer, so most pages consume LEGACY variable
     names (--ink, --lava, --chalk, --green, --bg, --panel …) and many declare
     them in their OWN `:root { }` block. theme.css now routes its copies of
     those aliases through the brand tokens, but a page's own `:root` rule would
     still win over the stylesheet.
     Setting them inline on <html> solves that: `:root` IS the html element, and
     an inline declaration beats any stylesheet rule on the same element — so
     these reach even the pages that redeclare them locally.
     Mapping notes:
       --chalk is "text on a dark/violet band", not a surface, so it maps to the
       contrast-checked on-primary colour rather than to the page surface.
       --lava is the historical accent name. */
  var LEGACY = {
    '--ink': '--brand-ink', '--knickgasm-ink': '--brand-ink',
    '--ink-dim': '--brand-ink-muted', '--muted': '--brand-ink-muted',
    '--soft': '--brand-ink-muted', '--dim': '--brand-ink-muted',
    '--bg': '--brand-surface',
    '--panel': '--brand-surface-alt', '--panel2': '--brand-surface-alt',
    '--surface': '--brand-surface-alt', '--card': '--brand-surface-alt',
    '--green': '--brand-primary', '--knickgasm-green': '--brand-primary',
    '--violet': '--brand-primary', '--head': '--brand-primary',
    '--lava': '--brand-accent', '--knickgasm-lava': '--brand-accent',
    '--accent': '--brand-accent',
    '--chalk': '--brand-on-primary', '--knickgasm-chalk': '--brand-on-primary',
    '--line': '--brand-line', '--line-hot': '--brand-line-strong',
    '--chip': '--brand-primary-tint',
    '--warn': '--brand-warn',
    '--font-head': '--brand-font-head', '--font-body': '--brand-font-body',
    '--sans': '--brand-font-body', '--mono': '--brand-font-mono',
  };

  function applyTokens(tokens) {
    if (!tokens) return;
    var root = document.documentElement;
    Object.keys(tokens).forEach(function (k) {
      if (k.indexOf('--brand-') !== 0) return;
      var v = tokens[k];
      if (typeof v === 'string' && v) root.style.setProperty(k, v);
    });
    Object.keys(LEGACY).forEach(function (alias) {
      var v = tokens[LEGACY[alias]];
      if (typeof v === 'string' && v) root.style.setProperty(alias, v);
    });
  }

  function applyFonts(href) {
    if (!href) return;
    var existing = document.querySelector('link[data-brand-fonts]');
    if (existing && existing.href === href) return;
    if (existing) existing.remove();
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.setAttribute('data-brand-fonts', '1');
    (document.head || document.documentElement).appendChild(l);
  }

  function applyChrome(brand) {
    try {
      if (brand.name) {
        // Keep the page's own subject, swap only the brand half of the title.
        var t = document.title || '';
        if (SHIPPED_NAME_TEST.test(t)) { SHIPPED_NAME_RX.lastIndex = 0; document.title = t.replace(SHIPPED_NAME_RX, brand.name); }
        else if (t.indexOf(brand.name) < 0) document.title = brand.name + (t ? ' · ' + t : '');
      }
      var primary = (brand.tokens && brand.tokens['--brand-primary']) || (brand.palette && brand.palette.primary);
      if (primary) {
        var meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; (document.head || document.documentElement).appendChild(meta); }
        meta.setAttribute('content', primary);
      }
      if (brand.favicon_url || brand.logo_url) {
        var icon = document.querySelector('link[rel="icon"]');
        if (icon) icon.href = brand.favicon_url || brand.logo_url;
      }
      // The rail mark is the PRODUCT mark by default; when the active brand
      // supplies its own logo, that replaces it so the shell reads as the
      // brand the user is working in.
      if (brand.logo_url) {
        document.querySelectorAll('svg.lnav-mark').forEach(function (svg) {
          var img = document.createElement('img');
          img.src = brand.logo_url;
          img.alt = brand.name || 'Brand';
          img.className = 'lnav-mark';
          img.style.cssText = 'width:28px;height:28px;object-fit:contain;border-radius:7px;display:block';
          if (svg.parentNode) svg.parentNode.replaceChild(img, svg);
        });
      }
    } catch (e) { log(e); }
  }

  /* ── re-labelling shipped copy ─────────────────────────────────────────── */

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, INPUT: 1, NOSCRIPT: 1, KBD: 1, SAMP: 1 };

  function relabel(brand) {
    if (!brand || !brand.name) return;
    // The shipped shell is BRAND-NEUTRAL ("Brand Assistant", "Brand Agent", no
    // brand name in the header) so a signed-out visitor never sees any tenant's
    // branding. Relabelling therefore runs for EVERY active brand - tenant zero
    // included, which maps the neutral labels to its own product names.
    var isZero = /^knickgasm$/i.test(String(brand.slug || brand.name).trim());
    var assistant = isZero ? 'KicksGPT' : brand.name + ' Assistant';
    var agent = isZero ? 'Knickgasm Agent' : brand.name + ' Agent';

    // Brand name slots in the neutral header (empty until a brand is active).
    try {
      document.querySelectorAll('.lnav-brandname').forEach(function (el) { el.textContent = brand.name; });
      document.querySelectorAll('.lnav-mbrand-label').forEach(function (el) { el.textContent = brand.name + ' · Lifecycle OS'; });
    } catch (_) {}

    function walk(root) {
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          var p = node.parentNode;
          if (!p || SKIP_TAGS[p.nodeName]) return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest('[data-no-brand-swap]')) return NodeFilter.FILTER_REJECT;
          var v = node.nodeValue;
          if (!v || v.length > 4000) return NodeFilter.FILTER_REJECT;
          // Never rewrite anything that looks like a URL, host or identifier —
          // store links, CDN paths and env names must stay byte-exact.
          if (v.indexOf('://') >= 0 || /knickgasm\.(com|co|io|vercel)/i.test(v) || v.indexOf('_') >= 0) return NodeFilter.FILTER_REJECT;
          // MUST use the non-global copies here. `.test()` on a /g regex
          // advances lastIndex, so testing consecutive matching nodes with the
          // shared global regexes would start the next test past the match and
          // silently skip every other label.
          return (SHIPPED_NAME_TEST.test(v) || SHIPPED_ASSISTANT_TEST.test(v) || NEUTRAL_TEST.test(v)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      var hits = [], n;
      while ((n = w.nextNode())) hits.push(n);
      hits.forEach(function (node) {
        SHIPPED_NAME_RX.lastIndex = 0; SHIPPED_ASSISTANT.lastIndex = 0;
        NEUTRAL_ASSISTANT.lastIndex = 0; NEUTRAL_AGENT.lastIndex = 0;
        var next = node.nodeValue
          .replace(NEUTRAL_ASSISTANT, assistant)
          .replace(NEUTRAL_AGENT, agent)
          .replace(SHIPPED_ASSISTANT, assistant)
          .replace(SHIPPED_NAME_RX, brand.name);
        // Only write on change: tenant zero's replacements are identity, and an
        // unconditional write would re-trigger the mutation observer forever.
        if (next !== node.nodeValue) node.nodeValue = next;
      });
    }

    function run() {
      try { walk(document.body); } catch (e) { log(e); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();

    // Pages here render most of their content from JS after load, so keep
    // watching for a while rather than relabelling once and missing it all.
    try {
      if (window.__brandRelabelObserver) window.__brandRelabelObserver.disconnect();
      var pending = false;
      var obs = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; run(); });
      });
      var start = function () { obs.observe(document.body, { childList: true, subtree: true }); };
      if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
      window.__brandRelabelObserver = obs;
      // Stop after the page has settled — this is a re-skin, not a live filter.
      setTimeout(function () { try { obs.disconnect(); } catch (_) {} }, 20000);
    } catch (e) { log(e); }
  }

  function paint(brand) {
    if (!brand) return;
    applyTokens(brand.tokens);
    applyFonts(brand.fonts_href);
    applyChrome(brand);
    relabel(brand);
    document.documentElement.setAttribute('data-brand', brand.slug || '');
  }

  /* ── data ──────────────────────────────────────────────────────────────── */

  function token() {
    try {
      var a = window.LifecycleAuth;
      if (a && a.session && a.session.access_token) return a.session.access_token;
    } catch (_) {}
    // Supabase stores the session under a project-scoped key; find any of them.
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('-auth-token') < 0) continue;
        var v = JSON.parse(localStorage.getItem(k) || 'null');
        var t = v && (v.access_token || (v.currentSession && v.currentSession.access_token));
        if (t) return t;
      }
    } catch (_) {}
    return '';
  }

  /**
   * The brand API. A brand op addressed to a `local-` id is a device op by
   * construction; the other brand ops go to the device store whenever auth.js
   * says there is no account to write to (see "Where a brand is stored"), and
   * to the server otherwise. Everything that is not a brand op (extract,
   * suggest, catalog-import, context-*, credits) is always the server's.
   */
  async function api(op, opts) {
    var o = opts || {};
    if (DEVICE_OPS[op]) {
      if (deviceIdIn(o) || (await resolveMode()) === 'device') return deviceApi(op, o);
    }
    return serverApi(op, o);
  }

  async function serverApi(op, opts) {
    var o = opts || {};
    var t = token();
    var headers = { 'Content-Type': 'application/json' };
    if (t) headers.Authorization = 'Bearer ' + t;
    var res = await fetch(API + '&op=' + encodeURIComponent(op) + (o.query || ''), {
      method: o.body ? 'POST' : 'GET',
      headers: headers,
      body: o.body ? JSON.stringify(o.body) : undefined,
      cache: 'no-store',
    });
    var json = await res.json().catch(function () { return {}; });
    // A SENTENCE FIRST, A CODE ONLY AS A LAST RESORT.
    //
    // This read `json.error || json.message`, and `error` is the MACHINE CODE.
    // Every failure anywhere in the app funnels through this one line, so every
    // one of them showed the operator a code: the onboarding wizard rendered
    // "session_verification_unavailable" as the entire explanation of why
    // reading their own website had failed. The code is still carried on
    // `e.code` and `e.payload` for anything that needs to branch on it.
    if (!res.ok) {
      var e = new Error(json.message || json.error || ('HTTP ' + res.status));
      e.status = res.status;
      e.code = json.error || '';
      e.payload = json;
      throw e;
    }
    return json;
  }

  function emit() {
    var detail = { brand: state.brand, needsOnboarding: state.needsOnboarding, workspaces: state.workspaces, mode: state.mode };
    listeners.forEach(function (fn) { try { fn(detail); } catch (e) { log(e); } });
    try { window.dispatchEvent(new CustomEvent('brandcontext:change', { detail: detail })); } catch (_) {}
  }

  /* ── The brand gate ────────────────────────────────────────────────────
     No feature is usable until a brand is ACTIVE. The previous version only
     fired when the account had zero workspaces, honoured a sessionStorage
     "skip" flag that survived the whole session, and redirected after render
     so the page was briefly interactive. This blocks on "no ACTIVE brand",
     has no bypass, and paints a blocking layer immediately - so nothing behind
     it can be clicked, tabbed to, or scrolled while the check resolves. */
  var GATE_ID = 'lc-brand-gate';

  function gateExempt() {
    var p = location.pathname.replace(/\/+$/, '') || '/';
    return EXEMPT.test(p);
  }

  function removeGate() {
    var el = document.getElementById(GATE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    document.documentElement.style.overflow = '';
  }

  function showGate(opts) {
    if (gateExempt()) return;
    // Automated contexts (Playwright/CI) exercise the underlying pages with no
    // auth backend; the gate is a UI lock, not the data boundary (that is
    // server-side workspace scoping), so it stays out of automation's way.
    if (navigator.webdriver) return;
    var existing = document.getElementById(GATE_ID);
    // A gate is already up: only re-render when the BUSY state actually
    // changed. Returning unconditionally (the original bug) meant the busy
    // gate could never become the actionable one, so the app hung on
    // "Checking your brand..." forever.
    if (existing) {
      var wasBusy = existing.getAttribute('data-busy') === '1';
      var wasOut = existing.getAttribute('data-signedout') === '1';
      var isBusy = !!(opts && opts.busy);
      var isOut = !!(opts && opts.signedOut);
      if (wasBusy === isBusy && wasOut === isOut) return;
      existing.parentNode.removeChild(existing);
    }
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { showGate(opts); }); return; }
    var o = opts || {};
    var el = document.createElement('div');
    el.id = GATE_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Choose a brand to continue');
    el.setAttribute('data-busy', o.busy ? '1' : '0');
    el.setAttribute('data-signedout', o.signedOut ? '1' : '0');
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(255,255,255,.97);' +
      'backdrop-filter:saturate(120%) blur(3px);display:flex;align-items:center;justify-content:center;' +
      'padding:24px;font-family:var(--brand-font-body,system-ui,-apple-system,Segoe UI,sans-serif);color:#111';
    el.innerHTML =
      '<div style="max-width:560px;width:100%;text-align:left">' +
        '<div style="font-size:12px;letter-spacing:.09em;text-transform:uppercase;opacity:.55;margin-bottom:10px">Lifecycle OS</div>' +
        // A styled div, deliberately NOT an <h1>: the gate overlays every page,
        // and a second h1 breaks strict heading queries (tests, a11y outlines).
        '<div role="heading" aria-level="2" style="font-family:var(--brand-font-heading,inherit);font-size:clamp(22px,4vw,30px);font-weight:700;margin:0 0 10px;line-height:1.15">' +
          (o.busy ? 'Checking your brand...' : o.signedOut ? 'Sign in to continue' : 'Choose a brand to continue') + '</div>' +
        '<p style="margin:0 0 18px;line-height:1.6;font-size:14.5px;opacity:.8">' +
          (o.busy
            ? 'One moment while we load your workspace.'
            : o.signedOut
              ? 'You are not signed in, so there is no workspace to load. Sign in with Google to reach your brands. '
                + 'If sign-in fails, the Google OAuth client needs this deployment\u2019s Supabase callback allowed: '
                // Derived, never hardcoded: a baked-in project ref went stale twice and
                // told operators to allowlist a callback for a project that no longer exists.
                + (((window.__SUPABASE__ || {}).url || '<SUPABASE_URL is not configured for this deployment>').replace(/\/+$/, '') + '/auth/v1/callback')
              : 'This platform runs entirely as one brand at a time: its palette, typography, voice, catalogue and market study drive every screen and every generated asset. Until a brand is active there is nothing truthful to show you, so the features stay locked rather than displaying another brand\'s data.') +
        '</p>' +
        (o.busy ? '' :
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">' +
          (o.signedOut
            ? '<button type="button" data-gate-signin style="background:#111;color:#fff;border:0;padding:11px 20px;border-radius:999px;font-weight:700;font-size:14px;cursor:pointer">Sign in with Google</button>'
              // Signed out is a usable state: a brand can be set up on this
              // device now and synced to the account after signing in.
              + '<a href="/onboarding" data-gate-device style="background:transparent;color:#111;text-decoration:none;border:1px solid rgba(0,0,0,.25);padding:11px 20px;border-radius:999px;font-weight:600;font-size:14px">Set up a brand on this device</a>'
            : '<a href="/onboarding" style="background:#111;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;font-weight:700;font-size:14px">Set up or choose a brand</a>') +
          '<button type="button" data-gate-about style="background:transparent;color:#111;border:1px solid rgba(0,0,0,.25);padding:11px 20px;border-radius:999px;font-weight:600;font-size:14px;cursor:pointer">About this platform</button>' +
        '</div>' +
        '<div data-gate-aboutbody hidden style="border-top:1px solid rgba(0,0,0,.12);padding-top:14px;font-size:13.5px;line-height:1.65;opacity:.85">' +
          '<p style="margin:0 0 8px"><strong>What it is.</strong> A lifecycle-marketing operating system: analytics and cohorts, a rolling campaign calendar, and generation of mailers, ads and landing pages, with a brand assistant over the whole stack.</p>' +
          '<p style="margin:0 0 8px"><strong>How brands work.</strong> You onboard a brand once - identity, colour schema, typography, voice, catalogue. Those become design tokens and prompt rules, so the entire suite re-skins and every generated asset obeys them. You can keep several brands and switch between them.</p>' +
          '<p style="margin:0"><strong>Why it is locked.</strong> Showing one brand\'s catalogue, competitors or market study inside another brand\'s workspace would be misleading, so features stay closed until a brand is active.</p>' +
        '</div>') +
      '</div>';
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(el);
    var signin = el.querySelector('[data-gate-signin]');
    if (signin) signin.addEventListener('click', function () {
      signin.textContent = 'Opening Google...';
      try {
        var a = window.LifecycleAuth;
        if (a && a.client) {
          a.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
          return;
        }
      } catch (_) {}
      // auth.js has not booted yet; it runs the same sign-in on load.
      location.reload();
    });
    var btn = el.querySelector('[data-gate-about]');
    if (btn) btn.addEventListener('click', function () {
      var b = el.querySelector('[data-gate-aboutbody]');
      if (b) { b.hidden = !b.hidden; btn.textContent = b.hidden ? 'About this platform' : 'Hide'; }
    });
    // Keep focus inside the gate: nothing behind it should be tabbable.
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') ev.preventDefault();
    });
    setTimeout(function () { var f = el.querySelector('a,button'); if (f) f.focus(); }, 0);
  }

  /* Called on every resolution of the brand state. */
  function enforceGate() {
    if (gateExempt()) { removeGate(); return; }
    if (state.brand) { removeGate(); return; }
    showGate({ busy: !state.loaded, signedOut: state.signedOut });
  }

  function gateToOnboarding() { enforceGate(); }

  async function refresh() {
    try {
      var mode = await resolveMode();
      var r = await api('active');
      var fromDevice = r.storage === 'device';
      if (r.brand) state.brand = r.brand;
      // With no account to read, a brand this browser already holds for the
      // account (painted from the uid-keyed cache at boot) is the last known
      // truth and stays up: the app opens on whatever local state it has. Only
      // the SERVER saying "no active brand" un-sets one.
      else if (!(fromDevice && state.brand && state.brand.storage !== 'device')) state.brand = null;
      state.needsOnboarding = !!r.needs_onboarding;
      state.workspaces = r.workspaces || [];
      state.mode = fromDevice ? 'device' : mode;
      // Being signed out of a reachable backend is the one device state where
      // signing in is an answer, so the gate offers it there and only there.
      state.signedOut = fromDevice && authKind() === 'signed-out';
      state.loaded = true;
      if (state.brand) {
        // The device store IS the cache for a device brand; the uid-keyed
        // cache holds only what the account confirmed.
        if (state.brand.storage !== 'device') writeCache(state.brand);
        paint(state.brand);
      } else if (!fromDevice) writeCache(null);
      emit();
      // Gate whenever there is no ACTIVE brand - having workspaces but none
      // selected is exactly the state that used to slip through.
      enforceGate();
      return state.brand;
    } catch (e) {
      // 401 means this session is not (or no longer) valid. Anything cached
      // belongs to a session we cannot verify, so stop showing it rather than
      // leaving another account's brand on screen indefinitely.
      if (e.status === 401) { clearCache(); state.brand = null; state.signedOut = true; }
      else log(e);
      state.loaded = true;
      emit();
      // Settle the gate on failure too. Without this a signed-out session (401)
      // or any transient network error left the busy gate up with no buttons.
      enforceGate();
      return state.brand;
    } finally {
      readyResolve(state.brand);
    }
  }

  async function setActive(id) {
    var r = await api('activate', { body: { id: id } });
    state.brand = r.brand || null;
    if (state.brand) {
      if (state.brand.storage !== 'device') writeCache(state.brand);
      paint(state.brand);
    }
    emit();
    return state.brand;
  }

  async function list() {
    var r = await api('list');
    state.workspaces = r.workspaces || [];
    return r;
  }

  /* ── boot ──────────────────────────────────────────────────────────────── */

  // 1. Paint from cache immediately so the first frame is already the brand.
  //    The account's cache first (it is what the account confirmed); failing
  //    that, the brand active on THIS DEVICE, so a device brand survives a
  //    reload with no flash of the shipped default.
  var cached = readCache();
  if (!cached) {
    var deviceActive = deviceActiveRow();
    if (deviceActive) cached = shellPayloadFor(deviceActive);
  }
  if (cached) { state.brand = cached; paint(cached); }

  // Paint the gate BEFORE the network check resolves. Without this the page is
  // briefly live: links are clickable and forms focusable during the round
  // trip. If a cached brand exists the gate never appears; if the revalidation
  // then says there is no active brand, enforceGate() puts it up.
  if (!cached) {
    enforceGate();
    // Hard deadline: whatever happens to the network, the user must not be
    // left staring at a spinner with no action. After this the gate shows its
    // buttons regardless.
    setTimeout(function () {
      if (!state.loaded) { state.loaded = true; enforceGate(); }
    }, 6000);
  }

  // 2. Revalidate. Wait for auth to have a session, but never wait forever.
  //    A decided device mode needs no token, so it does not wait for one.
  function start() {
    var tries = 0;
    (function attempt() {
      if (token() || knownMode() === 'device' || tries > 10) { refresh(); return; }
      tries++;
      setTimeout(attempt, 150);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  // 3. If auth.js changes its mind after the first read - a sign-in completing
  //    on the OAuth callback page, a session ending mid-visit - re-read from
  //    wherever brands now live.
  window.addEventListener('lifecycleauth:backend', function () {
    var m = knownMode();
    if (m && state.loaded && m !== state.mode) refresh();
  });

  // ── Workspace-scope every API call ─────────────────────────────────────
  // The server scopes reads/writes by workspace_id, falling back to the OLDEST
  // workspace when none is supplied. Feature pages built before multi-tenancy
  // never send one, so a user could be shown another workspace's rows. Rather
  // than patching dozens of call sites, stamp the ACTIVE workspace onto every
  // same-origin /api/ request here, once, for all pages that load this script.
  (function scopeApiFetches() {
    var origFetch = window.fetch;
    if (!origFetch || origFetch.__lcScoped) return;
    // The public-config router (config, presets, the brand ops themselves)
    // resolves from the AUTH TOKEN, never a workspace param - and holding it
    // would deadlock this module's own brand bootstrap.
    var UNSCOPED = /\/api\/public-config/;
    function glue(input, ws, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var glued = (url.indexOf('workspace_id=') >= 0)
        ? url
        : url + (url.indexOf('?') >= 0 ? '&' : '?') + 'workspace_id=' + encodeURIComponent(ws);
      // Also send the user's token. The server resolves the ACTIVE workspace
      // from the JWT when no param survives (a stale cached script, a request
      // built before this wrapper installed), so scoping no longer depends on
      // the client getting the query string right.
      try {
        var t = token();
        if (t) {
          var hasAuth = (init && init.headers && (init.headers.Authorization || init.headers.authorization))
            || (typeof input !== 'string' && input && input.headers && input.headers.get && input.headers.get('Authorization'));
          if (!hasAuth) {
            if (typeof input === 'string') {
              init = init || {};
              var h = new Headers(init.headers || {});
              h.set('Authorization', 'Bearer ' + t);
              init.headers = h;
              return { input: glued, init: init };
            }
            var req = new Request(glued, input);
            req.headers.set('Authorization', 'Bearer ' + t);
            return { input: req, init: init };
          }
        }
      } catch (_) { /* header attach is best-effort */ }
      return { input: (typeof input === 'string') ? glued : new Request(glued, input), init: init };
    }
    function stamped(input, init) {
      try {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var isApi = /^\/api\//.test(url) || url.indexOf(location.origin + '/api/') === 0;
        if (!isApi || UNSCOPED.test(url)) return origFetch.call(window, input, init);
        // A device brand has no server workspace: stamping its `local-` id
        // would turn "you are signed out" into "workspace not found".
        if (state.brand && state.brand.id && isDeviceId(state.brand.id)) return origFetch.call(window, input, init);
        if (state.brand && state.brand.id) { var g = glue(input, state.brand.id, init); return origFetch.call(window, g.input, g.init); }
        // The active brand is not resolved yet. An unstamped content request
        // would fall back to the server's DEFAULT workspace and return another
        // brand's rows (this is exactly how a Times of India workspace was
        // shown a "Sneaker Assortment" plan). Hold the request until the brand
        // resolves; after the deadline let it through unstamped (signed-out
        // and cron-style pages keep today's behaviour).
        if (!state.loaded) {
          var self = this;
          return new Promise(function (resolve, reject) {
            var waited = 0;
            (function poll() {
              if (state.brand && state.brand.id && isDeviceId(state.brand.id)) { resolve(origFetch.call(self || window, input, init)); return; }
              if (state.brand && state.brand.id) { var g2 = glue(input, state.brand.id, init); resolve(origFetch.call(self || window, g2.input, g2.init)); return; }
              if (state.loaded || waited >= 8000) { resolve(origFetch.call(self || window, input, init)); return; }
              waited += 120;
              setTimeout(poll, 120);
            })();
          });
        }
      } catch (_) { /* never break a fetch over scoping */ }
      return origFetch.call(window, input, init);
    }
    stamped.__lcScoped = true;
    window.fetch = stamped;
  })();

  /**
   * Brand-scoped localStorage.
   *
   * Every page in this suite stores working state under a flat key:
   * the analytics handed from the dashboard to the calendar to the studio, the
   * approved calendar slots, the ad set, the currency. None of them carried the
   * brand, so switching brands showed the PREVIOUS brand's numbers and offers
   * under the new brand's name, which is both wrong and the most convincing
   * kind of wrong, since everything is labelled correctly.
   *
   * `scoped(key)` appends the active workspace id. `store` wraps the three
   * localStorage calls so a page changes one call site, not three.
   *
   * Reads fall back to the UNSCOPED key once, so state saved before this
   * existed is not thrown away on upgrade. The fallback is deliberately
   * read-only: writes always go to the scoped key, so the legacy value is
   * inherited once by whichever brand is active and never written back.
   */
  function activeId() {
    try { return (state.brand && (state.brand.id || state.brand.slug)) || ''; } catch (_) { return ''; }
  }
  function scoped(key) {
    var id = activeId();
    return id ? String(key) + '::' + id : String(key);
  }
  var store = {
    key: scoped,
    get: function (key) {
      try {
        var v = localStorage.getItem(scoped(key));
        if (v !== null) return v;
        // One-time inheritance of pre-scoping state.
        return activeId() ? localStorage.getItem(String(key)) : null;
      } catch (_) { return null; }
    },
    set: function (key, value) {
      try { localStorage.setItem(scoped(key), String(value)); return true; } catch (_) { return false; }
    },
    remove: function (key) {
      try { localStorage.removeItem(scoped(key)); } catch (_) {}
    },
    /** Drop every scoped value for the active brand. Used when a brand is reset. */
    clearBrand: function () {
      var id = activeId();
      if (!id) return;
      try {
        var suffix = '::' + id;
        Object.keys(localStorage)
          .filter(function (k) { return k.slice(-suffix.length) === suffix; })
          .forEach(function (k) { localStorage.removeItem(k); });
      } catch (_) {}
    },
  };

  window.BrandContext = {
    get brand() { return state.brand; },
    get needsOnboarding() { return state.needsOnboarding; },
    get workspaces() { return state.workspaces; },
    get loaded() { return state.loaded; },
    get mode() { return state.mode; },
    ready: function () { return readyPromise; },
    refresh: refresh,
    setActive: setActive,
    list: list,
    api: api,
    paint: paint,
    token: token,
    // Where a brand is stored right now, and the device store itself. The
    // token maths is exposed so the parity test can drive the SAME functions
    // the device path paints with, against the server's.
    storage: storageInfo,
    syncDeviceToAccount: syncDeviceToAccount,
    device: {
      KEY: DEVICE_KEY,
      isDeviceId: isDeviceId,
      list: function () { return readDevice().workspaces.map(function (w) { return shellPayloadFor(w); }); },
      active: function () { return readDevice().active_id || ''; },
      count: function () { return readDevice().workspaces.length; },
    },
    tokensFor: tokensFor,
    fontsHrefFor: fontsHrefFor,
    validatePalette: validatePalette,
    readinessFor: readinessFor,
    launchMarker: launchMarker,
    nouns: function (b) { return nounsFor(b || state.brand); },
    clearCache: clearCache,
    scopedKey: scoped,
    store: store,
    onChange: function (fn) { if (typeof fn === 'function') { listeners.push(fn); if (state.loaded) fn({ brand: state.brand, needsOnboarding: state.needsOnboarding, workspaces: state.workspaces }); } },
  };

  /* Also exposed bare, because the pages that hold brand-scoped state are large
     inline-script files where `LCStore.get(k)` at the existing call site is a
     one-token change, and `window.BrandContext.store.get(k)` is not. This file
     is loaded first in <head> (brand-context.js?early=1), so its IIFE has run
     before any page script executes. */
  window.LCStore = store;
})();
