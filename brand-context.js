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
 *   3. Loads the brand's web fonts, and swaps the document title and
 *      theme-color. NOT the favicon: the tab icon is the platform's own mark
 *      (assets/lifecycle-os-mark.svg) for every brand - see fillBrandSlot().
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
  /* A sentence that carries a FACT is never renamed. The rename existed to fix
     chrome ("KNICKGASM Mailer Studio"); applied to prose it turned one tenant's
     facts into another's - "Rivals import airbrush; KNICKGASM owns it and is
     already in ~1,000 Target stores" was shown to The Times of India as a claim
     about itself. A number, a currency, a percentage, a claim of ownership or
     presence, a legal suffix: any of these marks the node as a statement about
     the shipped brand, and it stays exactly as shipped, where the cross-brand
     sweep (tests/cross-brand-leak.spec.js) can see it and it gets fixed at its
     source. The same refusal the URL guard below already applies. */
  var FACT_TEST = /[$£₹€]\s?\d|\d\s?%|\b\d[\d,]{2,}\b|\b(owns?|stores?|founded|est\.|pvt\.?|ltd\.?|limited|inc\.?|headquartered|based in)\b/i;

  /* Shipped material - the built catalogue, the 3D storefront, the audio beds,
     the playbook, tenant zero's personas and product cohorts - was built from
     ONE workspace's record and belongs to it. The rule is the server's
     (brand-catalog-server.ownsBundledExport): another brand gets its own or
     nothing, never the shipped one under a caveat. A page declares such a
     section with data-shipped-for="<slug>" (and data-shipped-label="<what>"),
     and it is replaced by the DATA REQUIRED marker for any other active brand. */
  var SHIPPED_SLUG = 'knickgasm';
  /* WHO IS TENANT ZERO IS THE SERVER'S DETERMINATION, NEVER A SLUG (2026-10-05).
     This read `slug === 'knickgasm'`, and a slug is the client's: an account
     owner may save any slug (unique per owner only), and a brand made on this
     device from the KNICKGASM preset in the gallery carries that slug - and
     KEEPS it when renamed, so "Deli Chic" started from that template was
     handed tenant zero's catalogue, storefront and audio. The server already
     refuses a carried slug (brand-runtime.carriedBrand re-keys it). Now:
       - a brand on this device owns no shipped material, whatever it is
         called: it owns what it imports (its store feed is one click away on
         the setup page, and that copy is its own, with its own provenance);
       - an account brand owns it only when the server says so: `owns_shipped`
         is stamped on op=active/get/list/save/activate by the same helper that
         gates the bundled sales export (market-analytics.ownsBundledExport,
         the oldest workspace);
       - the shipped default shell (op=defaults: is_default, no id) is the
         shipped brand itself. */
  function isTenantZero(b) {
    b = b || state.brand;
    if (!b) return false;
    if (isDeviceId(b.id)) return false;
    if (b.owns_shipped === true) return true;
    return b.is_default === true && !b.id;
  }
  /* No brand at all (a signed-out preview) keeps the shipped default. */
  function ownsShipped() { return !state.brand || isTenantZero(state.brand); }
  function escText(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function gateShipped(brand) {
    if (!brand || isTenantZero(brand)) return;
    var slug = String(brand.slug || '').toLowerCase();
    var name = brand.name || 'this brand';
    var nodes;
    try { nodes = document.querySelectorAll('[data-shipped-for]'); } catch (_) { return; }
    nodes.forEach(function (el) {
      if (el.getAttribute('data-shipped-gated') === '1') return;
      var owner = String(el.getAttribute('data-shipped-for') || '').toLowerCase();
      // Tenant zero's material is decided above (by the server, not the slug);
      // a slug that merely SAYS it is the shipped one is not let through here.
      if (owner && owner === slug && owner !== SHIPPED_SLUG) return;
      var what = el.getAttribute('data-shipped-label') || 'this material';
      var action = el.getAttribute('data-shipped-action') || '';
      el.setAttribute('data-shipped-gated', '1');
      el.innerHTML = '<div class="card p-5" data-shipped-marker style="border:1px solid var(--brand-line,#e5e5e5);border-radius:14px;padding:20px;background:var(--brand-surface-alt,#fff)">' +
        '<div style="font-weight:700;margin-bottom:6px">' + escText(what) + ' is not on the record for ' + escText(name) + '</div>' +
        '<p style="margin:0;line-height:1.6;font-size:13.5px">[DATA REQUIRED BEFORE LAUNCH: ' + escText(what) + ', ' + escText(name) + '.] ' +
        'What shipped here was built from another workspace\'s own record and catalogue. This platform never shows one brand\'s material under another brand\'s name; add ' + escText(name) + '\'s own to populate it.</p>' +
        /* The command the block offered stays in view, disabled, with the
           reason it cannot run: a gap the person can see, never a dead click. */
        (action ? '<button type="button" disabled data-shipped-action title="' + escText('Needs ' + name + '\'s own ' + what + '.') + '" style="margin-top:12px;padding:8px 14px;border-radius:8px;border:1px solid var(--vh-line);background:var(--vh-panel-2);color:var(--vh-ink-dim);font:inherit;cursor:not-allowed">' + escText(action) + '</button>' : '') +
        '</div>';
    });
  }

  /* A picture that belongs to tenant zero (its logo, a shipped photo) carries
     its URL in data-shipped-src, never in src (2026-10-05). An <img src> is
     fetched while the page parses, before any brand is known, so every page
     that printed one requested another company's file for every brand, and
     showed it until something replaced it. It is set here only when the
     shipped material is the active brand's own (no brand at all keeps the
     shipped default, as ownsShipped() says). For any other brand an image
     marked data-brand-logo takes that brand's own https logo; otherwise the
     brand's NAME stands in its place - never another company's picture. */
  function paintShippedImages(brand) {
    var nodes;
    try { nodes = document.querySelectorAll('img[data-shipped-src]'); } catch (_) { return; }
    var mine = !brand || isTenantZero(brand);
    var logo = (brand && /^https:\/\//i.test(String(brand.logo_url || ''))) ? brand.logo_url : '';
    nodes.forEach(function (img) {
      if (mine) {
        if (img.getAttribute('src') !== img.getAttribute('data-shipped-src')) img.setAttribute('src', img.getAttribute('data-shipped-src'));
        return;
      }
      if (logo && img.hasAttribute('data-brand-logo')) {
        if (img.getAttribute('src') !== logo) { img.setAttribute('src', logo); img.setAttribute('alt', brand.name || ''); }
        return;
      }
      var mark = document.createElement('span');
      mark.className = 'brand-wordmark';
      mark.setAttribute('data-shipped-replaced', '1');
      mark.style.cssText = 'display:inline-block;font-weight:800;letter-spacing:.08em;font-family:var(--brand-font-heading,inherit)';
      mark.textContent = (brand && brand.name) || '[DATA REQUIRED BEFORE LAUNCH: brand name]';
      if (img.parentNode) img.parentNode.replaceChild(mark, img);
    });
  }

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
  var state = { brand: null, needsOnboarding: false, workspaces: [], loaded: false, signedOut: false, mode: '', deviceKey: '', userId: '', refreshAgain: false };
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
    return storedGoogleUserId();
  }
  /* The Google session supabase-js keeps (`sb-<ref>-auth-token`), read ONLY
     for the first frame - this file paints before auth.js has booted. Once
     auth.js has decided, its answer is the only one: a stored session it did
     not accept (expired, signed out elsewhere) opens nothing. */
  function storedGoogleUserId() {
    try {
      var a = window.LifecycleAuth;
      var k0 = a && a.backend && a.backend.kind;
      if (k0 && k0 !== 'pending') return '';
    } catch (_) {}
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || !/^sb-[A-Za-z0-9-]+-auth-token$/.test(k)) continue;
        var v = JSON.parse(localStorage.getItem(k) || 'null');
        var s = v && (v.user || (v.currentSession && v.currentSession.user));
        if (s && s.id) return String(s.id);
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
  // Where publishing.html keeps a device brand's contact rules (LCStore, per brand id).
  var CONTACT_RULES_KEY = 'contact_fatigue_rules';
  var DEVICE_PREFIX = 'local-';
  /* THE DEVICE STORE IS PER ACCOUNT (review finding, 2026-09-29). A browser is
     shared: a family laptop, a shop's till, an agency's meeting-room machine.
     With ONE key for every signed-in person, person B signing in saw person
     A's brands. The namespace is the signed-in account's id:
     `<DEVICE_KEY>.<user id>` - since 2026-10-10 the Google account's Supabase
     user id (the mobile+PIN sign-in that used its own ids is switched off;
     auth.js copies what those accounts kept into the unscoped key on boot).
     The UNSCOPED key is kept for the no-session states (no database, a
     database that does not answer, signed out), so onboarding without a
     backend keeps working exactly as before. A sign-in never silently ADOPTS
     those anonymous rows; they are OFFERED for sync (syncableDevice()), never
     uploaded unasked, and a sign-out never deletes them. */
  function deviceUserId() {
    try {
      var a = window.LifecycleAuth;
      var s = a && a.session;
      if (s && s.user && s.user.id && s.access_token) return String(s.user.id);
      // auth.js has decided and holds no session: nothing opens a namespace.
      var k = a && a.backend && a.backend.kind;
      if (k && k !== 'pending') return '';
    } catch (_) {}
    return storedGoogleUserId();
  }
  /** The localStorage key brands live under RIGHT NOW: the account's, or the unscoped one. */
  function deviceKey() {
    var uid = deviceUserId();
    return uid ? DEVICE_KEY + '.' + uid : DEVICE_KEY;
  }
  // The brand ops that have a device implementation. extract and suggest are
  // the server's; catalog-import and context-* are the server's READ with the
  // result kept here for a device brand (deviceServerApi, 2026-10-03).
  var DEVICE_OPS = { list: 1, active: 1, get: 1, save: 1, activate: 1, delete: 1, readiness: 1, catalog: 1 };
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
  // The backend states in which nobody is signed in (auth.js LifecycleAuth.backend.kind).
  // 'local' (the localhost preview) and 'signed-in' are not among them.
  var NO_SESSION_KINDS = ['signed-out', 'unreachable', 'unconfigured', 'sdk'];
  /**
   * The mobile+PIN session, if that were who is signed in. Switched off on
   * 2026-10-10 (Google is the only sign-in): there is no such session, so this
   * answers null and every branch that keyed on it is the signed-out or the
   * Google branch. Kept as a function so the callers read the same as before.
   */
  function mobileSession() { return null; }
  function modeFor(kind) {
    if (KIND_DEVICE[kind]) return 'device';
    // A Google session (kind 'signed-in') or the localhost preview: the account.
    return 'server';
  }
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
  /** Mirrors readableOnSurfaces() on the server: text held on every ground. */
  function readableOnSurfaces(color, grounds, target) {
    var c = color;
    var gs = (grounds || []).filter(Boolean);
    for (var pass = 0; pass < 2; pass++) for (var i = 0; i < gs.length; i++) c = readableAsText(c, gs[i], target);
    return c;
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
    var out = {
      family: family,
      stack: str(src.stack, 200) || ("'" + family + "'," + fallback),
      google: src.google !== false,
      weights: str(src.weights, 40) || '400;600;700',
    };
    // Mirrors the server: a self-hosted family's https FILE, for @font-face.
    var file = str(src.src, 300);
    if (out.google === false && /^https:\/\/[^\s"'()<>]+$/i.test(file)) {
      out.src = file;
      var fmt = str(src.format, 12).toLowerCase();
      if (/^(woff2|woff|truetype|opentype|ttf|otf)$/.test(fmt)) out.format = fmt;
    }
    return out;
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
    // Exactly ONE home market, or none - the server's rule, kept here so a
    // device row carries the flag exactly as an account row would.
    var homeSeen = false;
    input.slice(0, 24).forEach(function (r) {
      var code = str(r && r.code, 12).toUpperCase();
      if (!code) return;
      var home = r.home === true && !homeSeen;
      if (home) homeSeen = true;
      out.push({
        code: code,
        currency: str(r.currency, 8).toUpperCase(),
        symbol: str(r.symbol, 4),
        store_url: httpUrl(r.store_url),
        pdp_pattern: str(r.pdp_pattern, 200),
        collection_pattern: str(r.collection_pattern, 200),
        home: home,
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
    var requestedInk = p.ink || '#111111';
    var surface = p.surface || '#F7F5F2';
    var surfaceAlt = p.surface_alt || shade(surface, 0.6);
    var muted = p.muted || shade(requestedInk, 0.35);
    // Old saved records can predate palette validation; never render low
    // contrast body text while their owner is updating the palette.
    var ink = readableOnSurfaces(requestedInk, [surface, surfaceAlt], TEXT_AA);
    var t = brand && brand.typography ? brand.typography : {};
    var states = { ok: p.ok || '#1a7f37', warn: p.warn || '#c9a227', err: p.err || '#c0392b' };
    return Object.assign({
      '--brand-primary': primary,
      '--brand-primary-dark': shade(primary, -0.25),
      '--brand-primary-soft': shade(primary, 0.86),
      '--brand-primary-tint': shade(primary, 0.94),
      '--brand-on-primary': readableOn(primary, ink, surface, surfaceAlt),
      '--brand-primary-text': readableOnSurfaces(primary, [surface, surfaceAlt], TEXT_AA),
      '--brand-accent': accent,
      '--brand-accent-soft': shade(accent, 0.88),
      '--brand-on-accent': readableOn(accent, ink, surface, surfaceAlt),
      '--brand-accent-text': readableOnSurfaces(accent, [surface, surfaceAlt], TEXT_AA),
      '--brand-ink': ink,
      '--brand-ink-muted': readableOnSurfaces(muted, [surface, surfaceAlt], TEXT_AA),
      '--brand-surface': surface,
      '--brand-surface-alt': surfaceAlt,
      '--brand-line': shade(ink, 0.84),
      '--brand-line-strong': shade(ink, 0.68),
      '--brand-ok': states.ok,
      '--brand-warn': states.warn,
      '--brand-err': states.err,
      '--brand-font-head': (t.heading && t.heading.stack) || "'Montserrat',Georgia,serif",
      '--brand-font-body': (t.body && t.body.stack) || "system-ui,-apple-system,Segoe UI,sans-serif",
      '--brand-font-mono': (t.mono && t.mono.stack) || 'ui-monospace,SFMono-Regular,Menlo,monospace',
    }, contractTokensFor(primary, accent, ink, muted, surface, surfaceAlt, states), componentTokensFor(brand));
  }
  /* Mirrors sectionGround() / textOn() / contractTokens() on the server: the
     design-system contract's derived tokens (design/lifecycle-os/CONTRACT.md).
     A brand band is never a dark neutral, text on it is derived, a state colour
     used as text is held to TEXT_AA, the focus ring to the 3:1 non-text floor. */
  function sectionGroundFor() {
    for (var i = 0; i < arguments.length; i++) {
      var h = normHex(arguments[i]);
      if (h && !isDarkNeutral(h)) return arguments[i];
    }
    return '#ffffff';
  }
  function textOnFor(ground, surface, ink, target) {
    var want = target || 4.5;
    var start = readableOn(ground, ink || '#111111', surface || '#ffffff');
    var first = readableAsText(start, ground, want);
    if (contrast(first, ground) >= want) return first;
    // Mirrors textOn(): a mid-tone ground needs the walk the other way.
    return textBothWaysFor(start, ground, want) || textBothWaysFor(start, ground, Math.min(want, 4.5)) || first;
  }
  function textBothWaysFor(start, ground, want) {
    var c = normHex(start) || '#111111';
    for (var t = 0.05; t <= 1.0001; t += 0.05) {
      for (var d = 0; d < 2; d++) {
        var cand = shade(c, (d === 0 ? -1 : 1) * t);
        if (contrast(cand, ground) >= want) return cand;
      }
    }
    return '';
  }
  function contractTokensFor(primary, accent, ink, muted, surface, surfaceAlt, states) {
    var band = normHex(sectionGroundFor(primary, accent, surface)) || '#ffffff';
    var bandAccent = normHex(sectionGroundFor(accent, primary, surface)) || '#ffffff';
    var text = [ink, readableOnSurfaces(muted || shade(ink, 0.35), [surface, surfaceAlt], TEXT_AA),
      readableOnSurfaces(primary, [surface, surfaceAlt], TEXT_AA), readableOnSurfaces(accent, [surface, surfaceAlt], TEXT_AA),
      readableOnSurfaces(states.ok, [surface, surfaceAlt], TEXT_AA), readableOnSurfaces(states.warn, [surface, surfaceAlt], TEXT_AA),
      readableOnSurfaces(states.err, [surface, surfaceAlt], TEXT_AA)];
    return {
      '--brand-surface-sunken': sunkenSurfaceFor(surface, surfaceAlt, text),
      '--brand-band': band,
      '--brand-on-band': textOnFor(band, surface, ink, TEXT_AA),
      '--brand-band-accent': bandAccent,
      '--brand-on-band-accent': textOnFor(bandAccent, surface, ink, TEXT_AA),
      '--brand-ok-text': readableOnSurfaces(states.ok, [surface, surfaceAlt], TEXT_AA),
      '--brand-warn-text': readableOnSurfaces(states.warn, [surface, surfaceAlt], TEXT_AA),
      '--brand-err-text': readableOnSurfaces(states.err, [surface, surfaceAlt], TEXT_AA),
      '--brand-focus': readableOnSurfaces(accent, [surface, surfaceAlt], 3),
    };
  }
  function sunkenSurfaceFor(surface, surfaceAlt, textColours) {
    var base = luminance(surface) <= luminance(surfaceAlt || surface) ? surface : surfaceAlt;
    var best = normHex(base) || '#ffffff';
    for (var t = 0.005; t <= 0.0401; t += 0.005) {
      var c = shade(base, -t);
      if (textColours.every(function (x) { return contrast(x, c) >= 4.5; })) best = c; else break;
    }
    return best;
  }
  /** Mirrors componentTokens() on the server: the measured control/card radii. */
  function componentTokensFor(brand) {
    var ds = brand && brand.brand_data && brand.brand_data.design_system;
    var out = {};
    var comp = (ds && ds.components) || null;
    if (!comp) return out;
    var b = comp.button && comp.button.primary && comp.button.primary.desktop;
    var c = comp.card && comp.card.desktop && comp.card.desktop.box;
    var n = function (v) { return typeof v === 'number' && isFinite(v) ? (Math.round(v * 100) / 100) + 'px' : ''; };
    if (b && n(b.radius)) out['--brand-radius-control'] = n(b.radius);
    if (c && n(c.radius)) out['--brand-radius-card'] = n(c.radius);
    return out;
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
    if (regions.length && !regions.some(function (r) { return r && r.home === true; })) add('home market');
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
      files: filesSummaryFor(brand),
      coherence: coherenceSummaryFor(brand),
      storage: 'device',
    }, extra || {});
  }
  /** Mirrors filesSummary() on the server: ids, family names and https URLs only. */
  function filesSummaryFor(brand) {
    var f = brand && brand.brand_data && brand.brand_data.brand_files;
    if (!f || typeof f !== 'object') return {};
    var https = function (u) { return (typeof u === 'string' && /^https:\/\//i.test(u.trim())) ? u.trim().slice(0, 500) : ''; };
    var one = function (x) { return (x && typeof x === 'object') ? { id: str(x.id, 80), hosted_url: https(x.hosted_url), url: https(x.url) } : null; };
    var out = {};
    if (one(f.logo)) out.logo = one(f.logo);
    if (one(f.favicon)) out.favicon = one(f.favicon);
    var fonts = f.fonts && typeof f.fonts === 'object' ? f.fonts : {};
    var fo = {};
    ['heading', 'body', 'mono'].forEach(function (slot) {
      var x = fonts[slot];
      if (x && typeof x === 'object') fo[slot] = Object.assign(one(x), { family: str(x.family, 64), format: str(x.format, 16) });
    });
    if (Object.keys(fo).length) out.fonts = fo;
    return out;
  }

  /* ── is this record ONE brand? (2026-10-10) ──────────────────────────────
     The server's api/_shared/brand-coherence.js, ported byte for byte (the
     block between the markers; tests/brand-record-coherence.spec.js diffs the
     text and the output), so a brand kept on this device is judged exactly as
     an account's: the website's registrable domain is the identity source, a
     value read from another domain is a conflict, an identity mix blocks
     activation unless overridden with a reason. */
  /* BRAND-COHERENCE:BEGIN */
  var COHERENCE = (function () {
    var MULTI_LABEL_SUFFIXES = ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in',
      'co.jp', 'ne.jp', 'or.jp', 'com.br', 'co.nz', 'com.mx', 'com.sg', 'com.hk', 'co.kr', 'com.cn', 'com.tw', 'co.za',
      'com.tr', 'com.ar', 'co.id', 'com.my', 'com.ph', 'com.vn', 'co.th', 'com.sa', 'com.eg'];
    /* A host under one of these is its OWN site (store.myshopify.com is a store, not Shopify). */
    var PRIVATE_SUFFIXES = ['myshopify.com', 'github.io', 'vercel.app', 'netlify.app', 'pages.dev', 'wixsite.com', 'blogspot.com',
      'wordpress.com', 'herokuapp.com', 'web.app', 'firebaseapp.com'];
    /* Hosts that carry no brand identity: a CDN, a storage bucket, a social platform. */
    var NEUTRAL_HOSTS = ['shopify.com', 'shopifycdn.com', 'shopifycdn.net', 'cloudinary.com', 'imgix.net', 'cloudfront.net', 'akamaized.net',
      'akamaihd.net', 'fastly.net', 'googleusercontent.com', 'gstatic.com', 'googleapis.com', 'ggpht.com', 'wp.com', 'squarespace-cdn.com',
      'wixstatic.com', 'amazonaws.com', 'b-cdn.net', 'jsdelivr.net', 'unpkg.com', 'fbcdn.net', 'cdninstagram.com', 'twimg.com', 'ytimg.com',
      'supabase.co', 'vercel-storage.com', 'githubusercontent.com', 'imagekit.io', 'ctfassets.net', 'sanity.io', 'storyblok.com',
      'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'youtube.com', 'youtu.be', 'linkedin.com', 'pinterest.com', 'tiktok.com',
      'threads.net', 'snapchat.com', 'whatsapp.com', 'wa.me', 't.me', 'medium.com'];
    var CORPORATE_TAIL = /^(?:group|groups|inc|corp|corporate|global|holding|holdings)$/;
    var NAME_STOP = ['the', 'and', 'of', 'inc', 'ltd', 'llc', 'llp', 'plc', 'pvt', 'private', 'limited', 'company', 'co', 'gmbh', 'corp', 'official', 'store', 'shop'];

    /* Which fields are checked, how each is labelled, and whether a foreign
       source BLOCKS (identity) or WARNS (design and softer signals). */
    var FIELDS = [
      ['name', 'Brand name', true], ['tagline', 'Tagline', true], ['logo_url', 'Logo', true], ['favicon_url', 'App icon', true],
      ['brand_data.legal_entity', 'Legal entity', true], ['brand_data.social', 'Social profiles', true],
      ['brand_data.imagery', 'Imagery', true], ['brand_data.brand_assets', 'Brand assets', true], ['brand_data.claims', 'Claims', true],
      ['catalog_source', 'Catalogue', true], ['regions', 'Region store', false], ['regions.home', 'Home market', false],
      ['palette.primary', 'Primary colour', false], ['palette.accent', 'Accent colour', false], ['palette.ink', 'Text colour', false],
      ['palette.surface', 'Page surface', false], ['palette.surface_alt', 'Card surface', false], ['palette.muted', 'Secondary text', false],
      ['typography.heading', 'Heading font', false], ['typography.body', 'Body font', false],
      ['brand_data.design_system', 'Measured design system', false], ['voice.tone', 'Tone of voice', false],
      ['asset_hosts', 'Asset hosts', false], ['website', 'Website', true], ['slug', 'Slug', false]
    ];
    var LABEL = {}, IDENTITY = {};
    FIELDS.forEach(function (f) { LABEL[f[0]] = f[1]; IDENTITY[f[0]] = f[2]; });
    /* The older key a site read wrote some fields under. */
    var ALT_KEY = { 'brand_data.legal_entity': 'legal_entity', 'brand_data.social': 'social', 'brand_data.imagery': 'imagery', 'brand_data.design_system': 'design_system' };

    function str(v) { return v == null ? '' : String(v).trim(); }
    function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    function hostOf(url) {
      var s = str(url);
      if (!s) return '';
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+([\/?#:]|$)/i.test(s)) return '';
        s = 'https://' + s;
      }
      try {
        var u = new URL(s);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        return u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\d?\./, '');
      } catch (_) { return ''; }
    }
    function endsWith(h, suffix) { return h === suffix || h.slice(-(suffix.length + 1)) === '.' + suffix; }
    function registrableDomain(host) {
      var h = str(host).toLowerCase().replace(/\.$/, '');
      if (!h) return '';
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.indexOf(':') >= 0 || h.indexOf('.') < 0) return h;
      var parts = h.split('.');
      for (var i = 0; i < PRIVATE_SUFFIXES.length; i++) {
        var p = PRIVATE_SUFFIXES[i];
        if (endsWith(h, p) && h !== p) return parts.slice(-(p.split('.').length + 1)).join('.');
      }
      if (parts.length <= 2) return h;
      var last2 = parts.slice(-2).join('.');
      return MULTI_LABEL_SUFFIXES.indexOf(last2) >= 0 ? parts.slice(-3).join('.') : last2;
    }
    function neutral(host) {
      var h = str(host).toLowerCase();
      if (!h) return true;
      for (var i = 0; i < NEUTRAL_HOSTS.length; i++) if (endsWith(h, NEUTRAL_HOSTS[i])) return true;
      return false;
    }
    function brandLabel(domain) {
      var d = str(domain);
      if (!d || /^\d{1,3}(\.\d{1,3}){3}$/.test(d) || d.indexOf(':') >= 0) return '';
      var label = d.split('.')[0];
      return /^\d+$/.test(label) ? '' : label;
    }
    function corporateSibling(a, b) {
      if (!a || !b || a === b || b.indexOf(a) !== 0) return false;
      var rest = b.slice(a.length);
      if (rest.charAt(0) === '-') rest = rest.slice(1);
      return CORPORATE_TAIL.test(rest);
    }
    /** One brand's domains: the same registrable domain, the same label under
        another suffix (nike.in / nike.com), or a corporate sibling. */
    function sameBrand(a, b) {
      if (!a || !b) return false;
      if (a === b) return true;
      var la = brandLabel(a), lb = brandLabel(b);
      if (la && la === lb) return true;
      return corporateSibling(la, lb) || corporateSibling(lb, la);
    }
    function fold(s) {
      var t = str(s).toLowerCase();
      try { t = t.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (_) { /* old engine */ }
      return t.replace(/[^a-z0-9]+/g, '');
    }
    function slugify(v) { return str(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48); }
    function nameTokens(name) {
      var t = str(name).toLowerCase();
      try { t = t.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (_) { /* old engine */ }
      return t.split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 3 && NAME_STOP.indexOf(w) < 0; });
    }
    /** Does a NAME read as the brand that owns this host? Containment either way
        over the host's labels, or every word of the name inside them. */
    function nameFitsHost(name, host) {
      var n = fold(name);
      var h = str(host).toLowerCase();
      if (!n || !h) return true;
      var reg = registrableDomain(h);
      var suffixLen = reg.split('.').length - 1;
      var labels = h.split('.');
      labels = labels.slice(0, Math.max(1, labels.length - suffixLen)).map(fold).filter(Boolean);
      var joined = labels.join('');
      for (var i = 0; i < labels.length; i++) {
        var l = labels[i];
        if (l === n) return true;
        if (l.length >= 3 && (n.indexOf(l) >= 0 || l.indexOf(n) >= 0)) return true;
      }
      if (n.length >= 3 && joined.indexOf(n) >= 0) return true;
      var toks = nameTokens(name);
      return toks.length > 0 && toks.every(function (w) { return joined.indexOf(w) >= 0; });
    }
    function firstUrl(s) { var m = /https?:\/\/\S+/i.exec(str(s)); return m ? m[0] : ''; }

    function getAt(o, p) {
      var ks = p.split('.'), n = o;
      for (var i = 0; i < ks.length; i++) { if (!n || typeof n !== 'object') return undefined; n = n[ks[i]]; }
      return n;
    }
    /** The current value of a checked field, as the record holds it. */
    function valueOf(rec, f) {
      if (f.indexOf('brand_data.') === 0) return getAt(rec.brand_data || {}, f.slice(11));
      if (f === 'regions.home') {
        var h = (Array.isArray(rec.regions) ? rec.regions : []).filter(function (r) { return r && r.home === true; })[0];
        return h ? str(h.code).toUpperCase() : '';
      }
      return getAt(rec, f);
    }
    function scalar(v) {
      if (v == null) return '';
      if (typeof v === 'string') return v.trim().toLowerCase();
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return null;
    }
    function filled(v) {
      if (v == null) return false;
      if (typeof v === 'string') return v.trim() !== '';
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return true;
    }
    /**
     * Where the CURRENT value of a field came from: { url, origin, signal } or
     * null. A record of a read describes the current value only when it says
     * the same thing - a value typed after a read is the person's, and a read
     * record left beside it is history, not a source.
     */
    function sourceOf(rec, f) {
      var bd = isObj(rec.brand_data) ? rec.brand_data : {};
      var cur = valueOf(rec, f);
      if (!filled(cur)) return null;
      var fos = isObj(bd.field_origins) ? bd.field_origins : {};
      var plain = isObj(bd.field_origin) ? bd.field_origin : {};
      var fo = isObj(fos[f]) ? fos[f] : null;
      var origin = str((fo && fo.origin) || plain[f]);
      if (origin === 'document') return { url: '', origin: 'document', signal: str(fo && fo.source) };
      if (origin === 'preset') return { url: '', origin: 'preset', signal: str(fo && fo.source) };
      var ex = isObj(bd.brand_extraction) && isObj(bd.brand_extraction.applied) ? bd.brand_extraction.applied : {};
      var ap = isObj(ex[f]) ? ex[f] : (ALT_KEY[f] && isObj(ex[ALT_KEY[f]]) ? ex[ALT_KEY[f]] : null);
      var cs = scalar(cur);
      if (fo && str(fo.url) && origin !== 'user') {
        var fv = scalar(fo.value);
        if (cs === null || fv === null || !fv || fv === cs) return { url: firstUrl(fo.url), origin: origin, signal: str(fo.signal) };
      }
      if (ap && str(ap.source_url)) {
        var av = scalar(ap.value);
        // A string record that matches the value describes it, even after the
        // person pressed "Use your site's" (origin user): it is still that
        // site's fact. A structured value is described only while no person
        // has claimed the field.
        if ((cs !== null && av && av === cs) || ((cs === null || !av) && origin !== 'user' && origin !== 'document')) {
          return { url: firstUrl(ap.source_url), origin: origin || str(ap.origin) || 'site-parse', signal: str(ap.signal) };
        }
      }
      return null;
    }

    /**
     * brandCoherence(record) -> {
     *   identity: { website, host, domain } | null,
     *   domains:  [{ domain, fields: [label...] }],
     *   conflicts:[{ id, kind, field, label, severity, domain, expected, value, source_url, count, message }],
     *   accepted: [id...]  (conflicts the person kept, recorded in brand_data.coherence.accepted),
     *   blocking, ok, summary }
     */
    function brandCoherence(record) {
      var rec = isObj(record) ? record : {};
      var bd = isObj(rec.brand_data) ? rec.brand_data : {};
      var coh = isObj(bd.coherence) ? bd.coherence : {};
      var acceptedIds = (Array.isArray(coh.accepted) ? coh.accepted : []).map(function (a) { return isObj(a) ? str(a.id) : str(a); }).filter(Boolean);
      var websiteHost = hostOf(rec.website);
      var identity = websiteHost ? { website: str(rec.website), host: websiteHost, domain: registrableDomain(websiteHost) } : null;
      var facts = [];   // { field, domain, url, value, origin, via }
      function add(field, url, value, via, origin) {
        var h = hostOf(url);
        if (!h || neutral(h)) return;
        facts.push({ field: field, domain: registrableDomain(h), url: str(url), value: value, via: via, origin: origin || '' });
      }
      function preview(v) {
        if (v == null) return '';
        if (typeof v === 'string') return v.length > 90 ? v.slice(0, 87) + '...' : v;
        if (Array.isArray(v)) return v.length + ' item(s)';
        if (isObj(v) && v.family) return str(v.family);
        return typeof v === 'object' ? 'measured' : String(v);
      }
      // An asset's page: the brand_assets row that names it (a preset carries
      // them top-level, a saved brand under brand_data).
      var assets = Array.isArray(bd.brand_assets) ? bd.brand_assets : (Array.isArray(rec.brand_assets) ? rec.brand_assets : []);
      function foundOn(url) {
        var u = str(url);
        for (var i = 0; i < assets.length; i++) if (isObj(assets[i]) && str(assets[i].url) === u && str(assets[i].found_on)) return str(assets[i].found_on);
        return '';
      }
      var assetPages = {};
      assets.forEach(function (a) { if (isObj(a) && str(a.found_on)) assetPages[hostOf(a.url)] = registrableDomain(hostOf(a.found_on)); });
      FIELDS.forEach(function (row) {
        var f = row[0];
        if (f === 'website' || f === 'slug' || f === 'regions' || f === 'asset_hosts' || f === 'catalog_source') return;
        if (f === 'brand_data.social' || f === 'brand_data.imagery' || f === 'brand_data.brand_assets' || f === 'brand_data.claims') return;
        var s = sourceOf(rec, f);
        if (s && s.url) add(f, s.url, preview(valueOf(rec, f)), 'read from', s.origin);
        else if ((f === 'logo_url' || f === 'favicon_url') && filled(rec[f]) && !s) {
          if (foundOn(rec[f])) add(f, foundOn(rec[f]), preview(rec[f]), 'read from', 'preset');
          else add(f, rec[f], preview(rec[f]), 'hosted on', '');
        }
      });
      // Per-item fields: each item carries the page it was read from.
      (Array.isArray(bd.social) ? bd.social : []).forEach(function (x) {
        if (!isObj(x)) return;
        if (str(x.source_url)) add('brand_data.social', x.source_url, str(x.url), 'read from', 'site-parse');
      });
      (Array.isArray(bd.imagery) ? bd.imagery : []).forEach(function (x) {
        if (!isObj(x)) return;
        if (str(x.page)) add('brand_data.imagery', x.page, str(x.url), 'read from', 'site-render');
        else add('brand_data.imagery', x.url, str(x.url), 'hosted on', '');
      });
      assets.forEach(function (x) {
        if (!isObj(x)) return;
        if (str(x.found_on)) add('brand_data.brand_assets', x.found_on, str(x.url), 'read from', '');
        else add('brand_data.brand_assets', x.url, str(x.url), 'hosted on', '');
      });
      var ex = isObj(bd.brand_extraction) && isObj(bd.brand_extraction.applied) ? bd.brand_extraction.applied : {};
      var claims = Array.isArray(bd.claims) ? bd.claims.map(function (c) { return scalar(isObj(c) ? c.text : c); }) : [];
      Object.keys(ex).forEach(function (k) {
        if (!/^claims\[\d+\]$/.test(k) || !isObj(ex[k])) return;
        var v = scalar(ex[k].value);
        if (v && claims.indexOf(v) >= 0) add('brand_data.claims', ex[k].source_url, str(ex[k].value), 'read from', 'site-parse');
      });
      var cat = isObj(rec.catalog_source) ? rec.catalog_source : {};
      if (str(cat.url)) add('catalog_source', cat.url, str(cat.url) + (cat.row_count != null ? ' (' + cat.row_count + ' products)' : ''), 'imported from', '');
      (Array.isArray(rec.regions) ? rec.regions : []).forEach(function (r) {
        if (isObj(r) && str(r.store_url)) add('regions', r.store_url, str(r.code) + ' ' + str(r.store_url), 'store on', '');
      });
      // A declared asset host is judged by the page its assets were found on,
      // when the record says (a brand's own CDN under another name, an agency
      // host serving the brand's own newsroom image).
      (Array.isArray(rec.asset_hosts) ? rec.asset_hosts : []).forEach(function (h) {
        var hh = hostOf('https://' + str(h).replace(/^https?:\/\//, ''));
        if (assetPages[hh]) { facts.push({ field: 'asset_hosts', domain: assetPages[hh], url: 'https://' + hh, value: str(h), via: 'declared', origin: '' }); return; }
        add('asset_hosts', 'https://' + hh, str(h), 'declared', '');
      });

      var conflicts = [];
      var groups = {};
      function conflict(c) {
        var id = c.kind + ':' + c.field + ':' + (c.domain || '');
        if (groups[id]) { groups[id].count += 1; return; }
        c.id = id;
        c.label = LABEL[c.field] || c.field;
        c.count = 1;
        groups[id] = c;
        conflicts.push(c);
      }
      var domainsSeen = {};
      facts.forEach(function (x) { (domainsSeen[x.domain] = domainsSeen[x.domain] || {})[LABEL[x.field] || x.field] = true; });

      if (identity) {
        facts.forEach(function (x) {
          if (sameBrand(x.domain, identity.domain)) return;
          var block = !!IDENTITY[x.field] && x.via !== 'hosted on' && x.via !== 'declared' && x.via !== 'store on';
          conflict({
            kind: 'cross_domain', field: x.field, severity: block ? 'block' : 'warn', domain: x.domain, expected: identity.domain,
            value: x.value, source_url: x.url,
            message: (LABEL[x.field] || x.field) + ' was ' + x.via + ' ' + x.domain + '; this brand\'s website is ' + identity.domain + '.'
          });
        });
      } else {
        // No website: no identity source to measure against, and none is chosen
        // here. Sourced facts from more than one brand's domains are a mix.
        var brands = [];
        facts.forEach(function (x) {
          if (x.via === 'declared' || x.via === 'hosted on' || x.via === 'store on') return;
          if (!brands.some(function (d) { return sameBrand(d, x.domain); })) brands.push(x.domain);
        });
        if (brands.length > 1) {
          facts.forEach(function (x) {
            if (x.via === 'declared' || x.via === 'hosted on' || x.via === 'store on') return;
            conflict({
              kind: 'mixed_sources', field: x.field, severity: IDENTITY[x.field] ? 'block' : 'warn', domain: x.domain, expected: '',
              value: x.value, source_url: x.url,
              message: (LABEL[x.field] || x.field) + ' was ' + x.via + ' ' + x.domain + ', and this record holds values read from ' + brands.join(', ') + '. It has no website to say which is the brand.'
            });
          });
        }
      }

      var name = str(rec.name);
      var nameSrc = sourceOf(rec, 'name');
      if (identity && name && !(nameSrc && nameSrc.url) && !nameFitsHost(name, identity.host)) {
        conflict({ kind: 'name_domain', field: 'name', severity: 'warn', domain: identity.domain, expected: identity.domain, value: name, source_url: '',
          message: 'The name "' + name + '" does not match the website ' + identity.host + '. Check that both are this brand\'s.' });
      }
      var slug = str(rec.slug);
      if (slug && name) {
        var fs = fold(slug), fn = fold(name);
        var st = nameTokens(slug.replace(/-/g, ' '));
        var tokensFit = st.length > 0 && st.every(function (w) { return fn.indexOf(w) >= 0; });
        if (fs && fn && fs.indexOf(fn) < 0 && fn.indexOf(fs) < 0 && !tokensFit) {
          conflict({ kind: 'slug_name', field: 'slug', severity: 'warn', domain: '', expected: slugify(name), value: slug, source_url: '',
            message: 'The slug "' + slug + '" was made from another name; this brand is "' + name + '" (' + slugify(name) + ').' });
        }
      }
      // A template's identity under a brand that is not that template.
      var tpl = isObj(bd.template) ? bd.template : null;
      if (tpl && str(tpl.name) && fold(tpl.name) !== fold(name)) {
        var plainO = isObj(bd.field_origin) ? bd.field_origin : {};
        var fosO = isObj(bd.field_origins) ? bd.field_origins : {};
        ['website', 'tagline', 'logo_url', 'regions', 'brand_data.brand_assets', 'asset_hosts'].forEach(function (f) {
          var o = str((isObj(fosO[f]) && fosO[f].origin) || plainO[f]);
          if (o !== 'preset' || !filled(f === 'brand_data.brand_assets' ? bd.brand_assets : rec[f])) return;
          conflict({ kind: 'template', field: f, severity: (f === 'website' || f === 'logo_url' || f === 'brand_data.brand_assets') ? 'block' : 'warn',
            domain: 'template:' + slugify(tpl.slug || tpl.name), expected: '', value: preview(f === 'brand_data.brand_assets' ? bd.brand_assets : rec[f]), source_url: '',
            message: (LABEL[f] || f) + ' came from the ' + str(tpl.name) + ' template; this brand is "' + name + '".' });
        });
      }
      // A brand document that describes another brand.
      var doc = isObj(bd.brand_document) && isObj(bd.brand_document.describes) ? bd.brand_document.describes : null;
      if (doc) {
        var dh = hostOf(doc.website);
        if (dh && identity && !sameBrand(registrableDomain(dh), identity.domain)) {
          conflict({ kind: 'document', field: 'brand_data.brand_document', severity: 'block', domain: registrableDomain(dh), expected: identity.domain,
            value: str(bd.brand_document.name), source_url: str(doc.website),
            message: 'The brand guidelines applied (' + str(bd.brand_document.name) + ') describe ' + registrableDomain(dh) + '; this brand\'s website is ' + identity.domain + '.' });
        } else if (str(doc.name) && name && fold(doc.name).indexOf(fold(name)) < 0 && fold(name).indexOf(fold(doc.name)) < 0) {
          conflict({ kind: 'document', field: 'brand_data.brand_document', severity: 'warn', domain: 'document:' + fold(doc.name), expected: '',
            value: str(bd.brand_document.name), source_url: '',
            message: 'The brand guidelines applied (' + str(bd.brand_document.name) + ') name "' + str(doc.name) + '"; this brand is "' + name + '".' });
        }
      }
      LABEL['brand_data.brand_document'] = 'Brand guidelines';

      var accepted = [];
      var live = conflicts.filter(function (c) {
        if (acceptedIds.indexOf(c.id) >= 0) { accepted.push(c.id); return false; }
        return true;
      });
      live.forEach(function (c) { c.label = LABEL[c.field] || c.field; });
      var blocking = live.some(function (c) { return c.severity === 'block'; });
      var domains = Object.keys(domainsSeen).sort().map(function (d) { return { domain: d, fields: Object.keys(domainsSeen[d]).sort() }; });
      var foreign = [];
      live.forEach(function (c) { if (c.domain && c.domain.indexOf(':') < 0 && foreign.indexOf(c.domain) < 0) foreign.push(c.domain); });
      var summary = !live.length ? 'Every sourced value on this brand comes from ' + (identity ? identity.domain : 'one place') + '.'
        : (blocking ? 'This record mixes brands: ' : 'Check this record: ') + live.length + ' value(s) ' +
          (foreign.length ? 'come from ' + foreign.join(', ') + (identity ? ', not ' + identity.domain : '') : 'disagree with each other') + '.';
      return { identity: identity, domains: domains, conflicts: live, accepted: accepted, blocking: blocking, ok: live.length === 0, summary: summary };
    }

    return { brandCoherence: brandCoherence, registrableDomain: registrableDomain, hostOf: hostOf, sameBrand: sameBrand, nameFitsHost: nameFitsHost, sourceOf: sourceOf, slugify: slugify, LABEL: LABEL, MULTI_LABEL_SUFFIXES: MULTI_LABEL_SUFFIXES };
  })();
  /* BRAND-COHERENCE:END */

  /* ── the device store ─────────────────────────────────────────────────── */

  function readDevice() { return readDeviceAt(deviceKey()); }
  function readDeviceAt(key) {
    var empty = { version: 1, active_id: '', workspaces: [] };
    try {
      var d = JSON.parse(localStorage.getItem(key) || 'null');
      if (!d || typeof d !== 'object' || !Array.isArray(d.workspaces)) return empty;
      return {
        version: 1,
        active_id: String(d.active_id || ''),
        workspaces: d.workspaces.filter(function (w) { return w && typeof w === 'object' && isDeviceId(w.id); }),
      };
    } catch (_) { return empty; }
  }
  function writeDevice(d, atKey) {
    try {
      var key = atKey || deviceKey();
      var ws = d.workspaces || [];
      if (!ws.length && !d.active_id) { localStorage.removeItem(key); return true; }
      localStorage.setItem(key, JSON.stringify({ version: 1, active_id: d.active_id || '', workspaces: ws }));
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
  /**
   * The device rows a signed-in account is OFFERED to sync: its own namespace
   * and the unscoped one (brands set up signed out, and those a mobile-number
   * sign-in kept, which auth.js copied there when it ended that sign-in).
   * Offering the unscoped rows exposes nothing: anyone at this browser sees
   * them by signing out. Nothing is uploaded without a click.
   */
  function syncableDevice() {
    var keys = [deviceKey()];
    if (keys[0] !== DEVICE_KEY) keys.push(DEVICE_KEY);
    var out = [], seen = {};
    keys.forEach(function (key) {
      readDeviceAt(key).workspaces.forEach(function (w) {
        if (seen[w.id]) return; seen[w.id] = 1;
        out.push({ key: key, row: w, active: readDeviceAt(key).active_id === w.id });
      });
    });
    return out;
  }
  function deviceActiveRow() { var d = readDevice(); return d.active_id ? deviceFind(d, d.active_id) : null; }

  /* ── what a device brand keeps beside itself (2026-10-03) ─────────────────
     A mobile-number sign-in keeps its brands on this device, and since
     2026-10-03 the catalogue and the context pack it builds are kept beside
     them: the server reads the store / the site and hands the result back
     (deviceCatalogImport, devicePackStep), because there is no database row
     for it to be filed under. Each lives under the SAME per-account namespace
     as the brand list, so another person signing in on this browser sees none
     of it, and deleting the brand deletes both. */
  function deviceSideKey(kind, id) { return deviceKey() + '.' + kind + '.' + id; }
  function readSide(kind, id) {
    if (!isDeviceId(id)) return null;
    try { var v = JSON.parse(localStorage.getItem(deviceSideKey(kind, id)) || 'null'); return v && typeof v === 'object' ? v : null; }
    catch (_) { return null; }
  }
  function writeSide(kind, id, value) {
    if (!isDeviceId(id)) return false;
    try {
      if (value == null) localStorage.removeItem(deviceSideKey(kind, id));
      else localStorage.setItem(deviceSideKey(kind, id), JSON.stringify(value));
      return true;
    } catch (_) { return false; }
  }
  /** The device catalogue for a brand: { products: [], source, owned }. */
  function deviceCatalog(id) {
    var c = readSide('catalog', id);
    return c && Array.isArray(c.products) ? c : null;
  }
  function deviceProductCount(id) { var c = deviceCatalog(id); return c ? c.products.filter(function (p) { return p && !p.stale_at; }).length : 0; }
  /** A refusal shaped like the server's, so every caller's catch reads it the same way. */
  function deviceFail(status, code, message, details) {
    var e = new Error(message);
    e.status = status;
    e.code = code;
    e.payload = { ok: false, error: code, message: message, storage: 'device' };
    if (details) { e.details = details; e.payload.details = details; }
    return e;
  }
  /** Mirrors slugFor() on the server: a slug follows the NAME on creation and
      is never inherited from a preset or another brand (2026-10-10). */
  function slugFor(b, prev, name) {
    var fromName = slugify(name);
    if (!prev || !prev.slug) return fromName || ('brand-' + Date.now().toString(36));
    var asked = slugify(b && b.slug);
    if (asked && asked !== prev.slug && asked === fromName) return asked;
    return prev.slug;
  }
  /** The brand-list badge, the server's coherenceSummary(). */
  function coherenceSummaryFor(brand) {
    if (!brand || !brand.brand_data) return null;
    var c = COHERENCE.brandCoherence(brand);
    return { ok: c.ok, blocking: c.blocking, count: c.conflicts.length, summary: c.summary };
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
      slug: slugFor(b, existing, name),
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
    var n = deviceProductCount(row.id);
    return Object.assign({}, row, { tokens: tokensFor(row), fonts_href: fontsHrefFor(row), readiness: readinessFor(row, { products: n }), products: n });
  }
  function queryOf(o) {
    try { return new URLSearchParams(String((o && o.query) || '').replace(/^[&?]/, '')); } catch (_) { return new URLSearchParams(''); }
  }
  /** The id an op is addressed to, when it is a device id; '' otherwise. */
  function deviceIdIn(o) {
    var b = (o && o.body) || {};
    var id = (b.brand && b.brand.id) || b.id || b.workspace_id || queryOf(o).get('id') || queryOf(o).get('workspace_id') || '';
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
        return { ok: true, brand: shellPayloadFor(ws, { readiness: readinessFor(ws, { products: deviceProductCount(ws.id) }), products: deviceProductCount(ws.id) }), needs_onboarding: false, workspaces: d.workspaces.map(function (w) { return shellPayloadFor(w); }), storage: 'device' };
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
        // The server's activateChecked(): a cross-domain identity mix blocks,
        // unless the person overrides it with a reason, which is recorded.
        var coh = COHERENCE.brandCoherence(ws);
        if (coh.blocking) {
          var reason = str(body.coherence_override && body.coherence_override.reason, 500);
          if (!reason) {
            var be = deviceFail(409, 'coherence_blocked', (ws.name || 'This brand') + ' mixes brands, so it was not activated: ' + coh.conflicts.filter(function (x) { return x.severity === 'block'; }).map(function (x) { return x.message; }).join(' ') + ' Keep or clear each value in the review step, or activate anyway with a reason.');
            be.payload.coherence = coh;
            throw be;
          }
          ws.brand_data = Object.assign({}, ws.brand_data || {});
          var cr = Object.assign({}, ws.brand_data.coherence || {});
          cr.overrides = (Array.isArray(cr.overrides) ? cr.overrides : []).concat([{ at: new Date().toISOString(), by: deviceUserId() || null, reason: reason, conflicts: coh.conflicts.filter(function (x) { return x.severity === 'block'; }).map(function (x) { return x.id; }) }]).slice(-20);
          ws.brand_data.coherence = cr;
        }
        d.active_id = id;
        if (!writeDevice(d)) throw deviceFail(507, 'device_storage_unavailable', 'This browser refused to store the change (storage is full or blocked), so nothing was activated.');
        return { ok: true, brand: shellPayloadFor(ws, { readiness: readinessFor(ws, { products: deviceProductCount(ws.id) }), products: deviceProductCount(ws.id) }), storage: 'device' };
      case 'delete':
        id = str(body.id || q.get('id'));
        ws = id ? deviceFind(d, id) : null;
        if (!ws) throw deviceFail(404, 'workspace_not_found', 'That brand is not on this device, so nothing was deleted.');
        d.workspaces = d.workspaces.filter(function (w) { return w.id !== id; });
        if (d.active_id === id) d.active_id = '';
        writeDevice(d);
        writeSide('catalog', id, null);
        writeSide('pack', id, null);
        // Its uploaded files go with it (logo, icon, fonts, imagery, the guide).
        try { await files.removeBrand(id); } catch (e) { log(e); }
        // The contact rules a device brand keeps (2026-10-04, publishing.html,
        // under LCStore's per-brand key) go with it too.
        try { localStorage.removeItem(CONTACT_RULES_KEY + '::' + id); } catch (_) {}
        return { ok: true, deleted: id, name: ws.name || null, storage: 'device' };
      case 'readiness':
        id = str(q.get('id') || body.id);
        ws = id ? deviceFind(d, id) : null;
        if (!ws) throw deviceFail(404, 'workspace_not_found', 'That brand is not saved on this device.');
        return { ok: true, readiness: readinessFor(ws, { products: deviceProductCount(id) }), storage: 'device' };
      case 'catalog': {
        id = str(q.get('workspace_id') || body.workspace_id);
        var cat = deviceCatalog(id);
        var reg = str(q.get('region') || body.region).toLowerCase();
        var lim = Math.max(1, Math.min(500, +(q.get('limit') || body.limit) || 60));
        var rows = (cat ? cat.products : []).filter(function (p) { return !reg || String(p.region || '').toLowerCase() === reg; });
        rows = rows.slice().sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || '')); }).slice(0, lim);
        return { ok: true, products: rows, count: rows.length, storage: 'device' };
      }
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
    var ms = known ? mobileSession() : null;
    var rs = readSite(k, b);
    return {
      mode: known ? modeFor(k) : (window.__LifecycleAuthBooted ? (state.mode || 'server') : 'server'),
      known: known,
      kind: known ? k : '',
      reachable: known ? b.reachable : null,
      signedIn: known ? !!b.signedIn : false,
      host: b.host || '',
      // In account mode the rows OFFERED for sync: this account's and the
      // ones kept for nobody in particular (see syncableDevice()).
      device_count: (known && modeFor(k) === 'server') ? syncableDevice().length : d.workspaces.length,
      device_active_id: d.active_id || '',
      // The mobile+PIN session (2026-09-28), when that is who is signed in, and
      // the ONE sentence for its state: a phone account is signed in AND its
      // workspaces are on this device, both at once - so neither "not signed
      // in" nor the account's own sentence says it alone.
      session: ms,
      account_sentence: ms ? accountSentence(ms) : '',
      // "Read my site": what the SERVER will answer to the request this browser
      // sends. See readSite().
      read_site: rs,
      server_open: rs.on,
      // Everything else on the wizard that the server runs for a person -
      // Suggest options, Import catalog, Build context pack. See serverActions().
      server_actions: serverActions(k),
    };
  }

  /* ── SIGNING IN WITH A PHONE NEVER TURNS A FEATURE OFF (2026-10-03) ───────
     A mobile-number sign-in's token is sent (auth.js apiToken(), 2026-09-30),
     and the server acts for it: a server-mode session is verified against the
     account database, and a device-mode one on a deployment with no database
     is admitted as a device principal from a page. So for a person signed in
     with a phone these controls are ON, and what the server answers is the
     judge. Two states are OFF, each with a remedy that works:
       - signed out: the server refuses a request with no session, and signing
         in (on any deployment) is what turns them on;
       - a sign-in kept on this device on a deployment that NOW keeps accounts
         in a database (the account store answers 'server'): that token is not
         in its session table, so the server refuses it, and signing in again
         is what turns them on. */
  function serverActions(k) {
    if (!k || k === 'pending') return { on: true, decided: false, state: 'undecided' };
    if (KIND_DEVICE[k]) return { on: false, decided: true, state: 'signed-out' };
    // A Google account with a database behind it, or the localhost preview.
    return { on: true, decided: true, state: 'account' };
  }

  /* ── "READ MY SITE" FOLLOWS THE SERVER'S RULE, NOT THE ACCOUNT TYPE (2026-09-29)
     The operator's words: "not working after signin". On production (Supabase
     paused, no DATABASE_URL) a visitor saw the control ON and a person signed in
     with a mobile number saw it OFF - "Not available on a mobile-number
     account". This read `kind`, and for a phone session auth.js publishes kind
     'signed-in' (who is here) with the Supabase state on `backend.supabase` (a
     separate fact), so EVERY device session read as "not open".

     But the server never sees an account type. It sees a request, and a
     device-mode token is never sent (auth.js apiToken()), so a person signed in
     on this device sends EXACTLY the request a visitor sends: no token. The
     decision is therefore made on the request, the way
     brand-workspace-core.js handle() makes it:
       - a server-mode session sends its token: verified, the server reads the
         site for the account; its database down, the server's own open path
         reads it without one. ON either way.
       - no token: ON while nothing could check a session - the workspace
         database (Supabase) down or unconfigured AND accounts not kept in a
         database that answers (auth.js's `status()`, one request per page
         load). Otherwise the server refuses, and so the control is OFF, with
         the reason for THIS person (onboarding.html extractNote()).
     Undecided (auth.js still probing, the account store not yet answered) is
     ON: the server judges, as LifecycleStatus.refusal() does for the same
     window. `state` names the branch so the page can say the right sentence. */
  // Since 2026-10-10 accounts live in ONE place, the Supabase project behind
  // Google sign-in, so the answer is decided from auth.js's record alone:
  //   - a Google session sends its token: the server reads the site for the
  //     account, ON.
  //   - no token, and the project ANSWERS: a session exists to be had, the
  //     server refuses - OFF, and signing in with Google is the remedy.
  //   - no token, and the project is down or not configured: nobody could
  //     present a session, the server's open path reads it - ON.
  //   - supabase-js did not load: this page cannot tell - OFF, said.
  function readSite(k, b) {
    var out = { on: true, decided: false, state: 'undecided', supabase: '', store: null, host: (b && b.host) || '' };
    if (!k || k === 'pending') return out;
    out.decided = true;
    if (k !== 'unreachable' && k !== 'unconfigured' && k !== 'signed-out' && k !== 'sdk') {
      // A Google session or the localhost preview: the server judges.
      out.state = 'server-judges'; return out;
    }
    var supa = k === 'signed-out' ? 'reachable' : k;
    out.supabase = supa;
    if (supa === 'sdk') { out.on = false; out.state = 'sdk'; return out; }
    if (supa === 'reachable') { out.on = false; out.state = 'backend-answers'; return out; }
    out.state = 'no-backend';
    return out;
  }

  /** "Signed in as <name> · workspaces are saved on this device[ · account in the database]". */
  function accountSentence(ms) {
    if (ms.mode === 'supabase' && ms.verified) return 'Signed in as ' + (ms.name || ms.phone || 'you') + ' · brands are saved to your account';
    var s = 'Signed in as ' + (ms.name || ms.phone || 'you') + ' · workspaces are saved on this device';
    if (ms.mode === 'server' || ms.mode === 'supabase') s += ' · account in the database';
    return s;
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
      throw deviceFail(409, 'sign_in_required', 'Sign in with Google first: brands can only be synced to an account that is reachable.');
    }
    var rows = syncableDevice();
    var out = { synced: [], failed: [], remaining: 0 };
    var activated = '';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i].row, key = rows[i].key;
      var body = Object.assign({}, row);
      delete body.id; delete body.storage; delete body.owner_id; delete body.created_at; delete body.updated_at;
      try {
        var r = await serverApi('save', { body: { brand: body } });
        if (!r || !r.brand || !r.brand.id) throw new Error('The account did not confirm the saved brand, so the device copy was kept.');
        var now = readDeviceAt(key);
        now.workspaces = now.workspaces.filter(function (w) { return w.id !== row.id; });
        if (now.active_id === row.id) now.active_id = '';
        writeDevice(now, key);
        out.synced.push({ from: row.id, to: r.brand.id, name: row.name });
        if (rows[i].active && !activated) activated = r.brand.id;
      } catch (e) {
        out.failed.push({ id: row.id, name: row.name, message: (e && e.message) || 'This brand could not be uploaded.' });
      }
    }
    out.remaining = syncableDevice().length;
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
    // Pages (index, about, data-analysis, brand-demo, this file's own report
    // panel) read --brand-font-heading, a name tokens() never emitted, so the
    // active brand's heading face never reached them (design/lifecycle-os/
    // CONTRACT.md). The contract's name is --brand-font-head; this keeps the
    // other spelling working.
    '--brand-font-heading': '--brand-font-head',
  };

  function applyTokens(tokens) {
    if (!tokens) return;
    var root = document.documentElement;
    Object.keys(tokens).forEach(function (k) {
      if (k.indexOf('--brand-') !== 0) return;
      var v = tokens[k];
      if (typeof v === 'string' && v) root.style.setProperty(k, v);
    });
    // The design-system tokens are OPTIONAL (a brand with no measured design
    // system has none), so one painted for the previous brand must be taken
    // off, or the next brand inherits its corner radius. Found by reverting a
    // rendered read in the wizard: the radius stayed.
    ['--brand-radius-control', '--brand-radius-card'].forEach(function (k) {
      if (!(typeof tokens[k] === 'string' && tokens[k])) root.style.removeProperty(k);
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
        var t = originalPageTitle || '';
        document.title = t;
        if (SHIPPED_NAME_TEST.test(t)) { SHIPPED_NAME_RX.lastIndex = 0; document.title = t.replace(SHIPPED_NAME_RX, brand.name); }
        else if (t.indexOf(brand.name) < 0) document.title = brand.name + (t ? ' · ' + t : '');
      }
      var primary = (brand.tokens && brand.tokens['--brand-primary']) || (brand.palette && brand.palette.primary);
      if (primary) {
        var meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; (document.head || document.documentElement).appendChild(meta); }
        meta.setAttribute('content', primary);
      }
      // The TAB ICON and the RAIL MARK are the PLATFORM's (2026-09-29). This
      // used to write brand.favicon_url || brand.logo_url onto <link rel=icon>
      // and replace every svg.lnav-mark with an <img> of the brand's logo, so
      // the product had no mark of its own anywhere a person looks first, and
      // with tenant zero active the tab wore that tenant's logo. The app IS the
      // brand in its palette, fonts, name and copy; it is not the brand in the
      // browser tab, which identifies the tool. The brand's logo goes in the
      // brand slot beside its name instead, from ITS record, or a monogram.
      fillBrandSlot(brand);
    } catch (e) { log(e); }
  }

  /**
   * The ACTIVE brand's logo, in the one place the shell shows the brand as a
   * brand: the slot beneath the platform wordmark (.lnav-brandlogo). From the
   * record's logo_url when it has one, else a monogram of the name on the
   * neutral chip. Never a file shipped for another tenant, never the tab icon.
   */
  function fillBrandSlot(brand) {
    var slots;
    try { slots = document.querySelectorAll('.lnav-brandlogo'); } catch (_) { return; }
    var url = httpUrl(brand && brand.logo_url);
    var name = String((brand && brand.name) || '').trim();
    slots.forEach(function (slot) {
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      if (url) {
        var img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.decoding = 'async';
        // A logo the record names but the host does not serve falls back to
        // the monogram rather than a broken-image glyph - and says which URL
        // failed, so the gap is visible to whoever owns the record instead of
        // being quietly papered over.
        img.onerror = function () {
          try {
            slot.removeChild(img);
            slot.textContent = name.charAt(0).toUpperCase();
            slot.setAttribute('data-brand-slot', 'monogram');
            slot.setAttribute('data-brand-logo-failed', url);
            slot.title = name + ' (logo did not load: ' + url + ')';
          } catch (_) {}
        };
        slot.appendChild(img);
        slot.setAttribute('data-brand-slot', 'logo');
        slot.title = name;
        slot.hidden = false;
      } else if (name) {
        slot.textContent = name.charAt(0).toUpperCase();
        slot.setAttribute('data-brand-slot', 'monogram');
        slot.title = name;
        slot.hidden = false;
      } else {
        slot.hidden = true;
      }
    });
  }

  /* ── re-labelling shipped copy ─────────────────────────────────────────── */

  var originalBrandText = new WeakMap();
  var originalPageTitle = document.title;
  var brandPaintVersion = 0;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, INPUT: 1, NOSCRIPT: 1, KBD: 1, SAMP: 1 };

  function relabel(brand) {
    if (!brand || !brand.name) return;
    // The shipped shell is BRAND-NEUTRAL ("Brand Assistant", "Brand Agent", no
    // brand name in the header) so a signed-out visitor never sees any tenant's
    // branding. Relabelling therefore runs for EVERY active brand - tenant zero
    // included, which maps the neutral labels to its own product names.
    var isZero = isTenantZero(brand);
    var assistant = isZero ? 'KicksGPT' : brand.name + ' Assistant';
    var agent = isZero ? 'Knickgasm Agent' : brand.name + ' Agent';

    // Brand name slots in the neutral header (empty until a brand is active).
    try {
      document.querySelectorAll('.lnav-brandname').forEach(function (el) { el.textContent = brand.name; });
      document.querySelectorAll('.lnav-mbrand-label').forEach(function (el) { el.textContent = 'Lifecycle OS'; });
    } catch (_) {}

    function walk(root) {
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          var p = node.parentNode;
          if (!p || SKIP_TAGS[p.nodeName]) return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest('[data-no-brand-swap]')) return NodeFilter.FILTER_REJECT;
          var saved = originalBrandText.get(node);
          var v = saved && node.nodeValue === saved.rendered ? saved.source : node.nodeValue;
          if (!v || v.length > 4000) return NodeFilter.FILTER_REJECT;
          // Never rewrite anything that looks like a URL, host or identifier —
          // store links, CDN paths and env names must stay byte-exact.
          if (v.indexOf('://') >= 0 || /knickgasm\.(com|co|io|vercel)/i.test(v) || v.indexOf('_') >= 0) return NodeFilter.FILTER_REJECT;
          // A statement of fact about the shipped brand is not chrome: leave it.
          if (FACT_TEST.test(v)) return NodeFilter.FILTER_REJECT;
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
        var saved = originalBrandText.get(node);
        var source = saved && node.nodeValue === saved.rendered ? saved.source : node.nodeValue;
        var next = source
          .replace(NEUTRAL_ASSISTANT, assistant)
          .replace(NEUTRAL_AGENT, agent)
          .replace(SHIPPED_ASSISTANT, assistant)
          .replace(SHIPPED_NAME_RX, brand.name);
        // Only write on change: tenant zero's replacements are identity, and an
        // unconditional write would re-trigger the mutation observer forever.
        originalBrandText.set(node, { source: source, rendered: next });
        if (next !== node.nodeValue) node.nodeValue = next;
      });
    }

    var version = brandPaintVersion;
    function run() {
      if (version !== brandPaintVersion) return;
      try { walk(document.body); } catch (e) { log(e); }
      try { gateShipped(brand); } catch (e) { log(e); }
      try { paintShippedImages(brand); } catch (e) { log(e); }
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

  /* ══════════════════════════════════════════════════════════════════════════
     BRAND FILES, AND WHERE A FIELD CAME FROM (2026-10-04)

     The operator can give the brand's logo, app icon, fonts, imagery and its
     guideline document as a FILE or as a URL (onboarding.html). A file has
     two homes:
       - HOSTED, when an account with a reachable project can upload it (the
         `brand-assets` bucket, key <workspace_id>/<sha256>.<ext>, migration
         20261004120000): its https URL goes on the record, and generated
         mailers and ads reference that URL.
       - THIS DEVICE, otherwise (production now: no database, Supabase
         paused): IndexedDB, not localStorage - a logo and two fonts already
         pass the ~5 MB localStorage gives a page. The shell and the previews
         paint from it; a generated asset carries the hosted-URL marker in its
         place (carry() sends `pending_hosting`, never the bytes).
     Files live under the SAME per-account namespace as the brands
     (deviceKey(): another person signing in on this browser sees none of
     them), and deleting a brand deletes its files.

     The record holds a REFERENCE, never bytes: brand_data.brand_files =
       { logo:{id,name,type,size,width,height,sha256,hosted_url,url,source},
         favicon:{...}, fonts:{heading:{...,family,format}, body:{...}},
         images:[{...}], document:{...} }

     FIELD ORIGINS - the device twin of brand_field_provenance. One order,
     the same as SQL brand_origin_rank() and brand-workspace-core ORIGIN_RANK:
       user 50 > document 40 > site-render 30 > site-parse 20 > preset 10 > default 0
     kept per field in brand_data.field_origins. A value may replace another
     only when its origin ranks at least as high; a person's explicit choice
     is `user`. */
  var ORIGIN_RANK = { user: 50, document: 40, 'site-render': 30, 'site-parse': 20, auto: 20, preset: 10, default: 0 };
  function originRank(o) { return Object.prototype.hasOwnProperty.call(ORIGIN_RANK, o) ? ORIGIN_RANK[o] : -1; }
  /** May a value from `incoming` replace one whose origin is `current`? */
  function mayReplace(current, incoming) { return !current || originRank(incoming) >= originRank(current); }

  /** The kinds of uploaded file a record holds with no hosted URL yet. */
  function pendingHosting(row) {
    var f = row && row.brand_data && row.brand_data.brand_files;
    if (!f || typeof f !== 'object') return [];
    var https = function (u) { return /^https:\/\//i.test(String(u || '')); };
    var unhosted = function (x) { return x && typeof x === 'object' && x.id && !https(x.hosted_url); };
    var out = [];
    if (unhosted(f.logo) && !https(row.logo_url)) out.push('logo');
    if (unhosted(f.favicon) && !https(row.favicon_url)) out.push('icon');
    var fonts = f.fonts && typeof f.fonts === 'object' ? f.fonts : {};
    if (Object.keys(fonts).some(function (k) { return unhosted(fonts[k]); })) out.push('font');
    if (Array.isArray(f.images) && f.images.some(unhosted)) out.push('image');
    return out;
  }

  var FILES_DB = 'lifecycle-brand-files', FILES_STORE = 'files';
  var filesDbPromise = null;
  function filesDb() {
    if (filesDbPromise) return filesDbPromise;
    filesDbPromise = new Promise(function (resolve, reject) {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('This browser has no IndexedDB, so files cannot be kept on this device.');
        var req = indexedDB.open(FILES_DB, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE, { keyPath: 'key' }).createIndex('owner', 'owner', { unique: false });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('This browser refused to open its file store (IndexedDB).')); };
        req.onblocked = function () { reject(new Error('The file store is open in another tab with an older version. Close other tabs of this app and try again.')); };
      } catch (e) { reject(e); }
    });
    filesDbPromise.catch(function () { filesDbPromise = null; });
    return filesDbPromise;
  }
  function filesTx(mode, fn) {
    return filesDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(FILES_STORE, mode);
        var holder = {};
        fn(t.objectStore(FILES_STORE), holder);
        t.oncomplete = function () { resolve(holder.value); };
        t.onerror = function () { reject(t.error || new Error('The file store refused the change.')); };
        t.onabort = function () { reject(t.error || new Error('The file store refused the change (storage full or blocked).')); };
      });
    });
  }
  function filesOwner(brandId) { return deviceKey() + '|' + String(brandId || ''); }
  var SINGLE_SLOT = { logo: 1, favicon: 1, 'font:heading': 1, 'font:body': 1, 'font:mono': 1, document: 1 };
  /** The slots whose files a generated asset references, and so may be hosted publicly. */
  var HOSTABLE = { logo: 1, favicon: 1, image: 1, 'font:heading': 1, 'font:body': 1, 'font:mono': 1 };
  var objectUrls = {};
  function byOwner(store, owner, cb) {
    var req = store.index('owner').openCursor(IDBKeyRange.only(owner));
    req.onsuccess = function () { var c = req.result; if (c) { cb(c); c.continue(); } };
  }
  function meta(rec) { if (!rec) return null; var m = Object.assign({}, rec); delete m.blob; delete m.key; delete m.owner; return m; }
  var files = {
    /** Keep a file for a brand. Single slots (logo, icon, a font slot, the guide) replace the previous one. */
    put: function (brandId, slot, blob, info) {
      var i = info || {};
      if (!brandId) return Promise.reject(new Error('A file needs a brand to belong to.'));
      if (!(blob instanceof Blob)) return Promise.reject(new Error('Nothing to keep: no file was given.'));
      var owner = filesOwner(brandId);
      var id = String(i.sha256 || '').slice(0, 64) || ('f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      var rec = {
        key: owner + '|' + slot + '|' + id, owner: owner, brand_id: String(brandId), slot: slot, id: id,
        name: str(i.name, 160) || 'file', type: blob.type || str(i.type, 80), size: blob.size,
        width: i.width || null, height: i.height || null, family: str(i.family, 64), format: str(i.format, 16),
        sha256: str(i.sha256, 64), added_at: new Date().toISOString(), blob: blob,
      };
      return filesTx('readwrite', function (store) {
        if (SINGLE_SLOT[slot]) byOwner(store, owner, function (c) { if (c.value.slot === slot && c.value.key !== rec.key) c.delete(); });
        store.put(rec);
      }).then(function () { return meta(rec); });
    },
    get: function (brandId, id) {
      var owner = filesOwner(brandId);
      return filesTx('readonly', function (store, h) {
        byOwner(store, owner, function (c) { if (c.value.id === id && !h.value) h.value = c.value; });
      });
    },
    list: function (brandId) {
      var owner = filesOwner(brandId);
      return filesTx('readonly', function (store, h) {
        h.value = [];
        byOwner(store, owner, function (c) { h.value.push(meta(c.value)); });
      });
    },
    remove: function (brandId, id) {
      var owner = filesOwner(brandId);
      return filesTx('readwrite', function (store, h) {
        h.value = 0;
        byOwner(store, owner, function (c) { if (c.value.id === id) { c.delete(); h.value++; } });
      });
    },
    /** Delete every file a brand keeps on this device (its delete runs this). */
    removeBrand: function (brandId) {
      if (!brandId) return Promise.resolve(0);
      var owner = filesOwner(brandId);
      return filesTx('readwrite', function (store, h) {
        h.value = 0;
        byOwner(store, owner, function (c) { c.delete(); h.value++; });
      });
    },
    /** Files kept for a brand before it had an id move to the id it was saved under. */
    adopt: function (fromId, toId) {
      if (!fromId || !toId || fromId === toId) return Promise.resolve(0);
      var from = filesOwner(fromId), to = filesOwner(toId);
      return filesTx('readwrite', function (store, h) {
        h.value = 0;
        byOwner(store, from, function (c) {
          var v = Object.assign({}, c.value, { owner: to, brand_id: String(toId) });
          v.key = to + '|' + v.slot + '|' + v.id;
          store.put(v); c.delete(); h.value++;
        });
      });
    },
    /** A blob: URL for painting (cached per file), or '' when there is no such file. */
    url: function (brandId, id) {
      var k = filesOwner(brandId) + '|' + id;
      if (objectUrls[k]) return Promise.resolve(objectUrls[k]);
      return files.get(brandId, id).then(function (rec) {
        if (!rec || !rec.blob) return '';
        objectUrls[k] = URL.createObjectURL(rec.blob);
        return objectUrls[k];
      });
    },
    /**
     * Host a kept file for an ACCOUNT brand: the brand-assets bucket, with the
     * person's own token, under <workspace_id>/<sha256>.<ext>. Resolves
     * { hosted:true, url } or { hosted:false, reason } - never throws, because
     * a file that could not be hosted is still kept here and marked.
     */
    host: function (workspaceId, rec) {
      var cfg = window.__SUPABASE__ || {};
      var t = token();
      // The bucket is PUBLIC: only delivery assets (logo, icon, fonts,
      // imagery) go there. A brand book is private and stays on the device,
      // whoever is signed in (review finding, 2026-10-04).
      if (!rec || !HOSTABLE[rec.slot]) return Promise.resolve({ hosted: false, reason: 'private' });
      if (!workspaceId || isDeviceId(workspaceId)) return Promise.resolve({ hosted: false, reason: 'device' });
      if (!cfg.url || !cfg.anonKey) return Promise.resolve({ hosted: false, reason: 'no_storage' });
      if (!t || t.split('.').length !== 3) return Promise.resolve({ hosted: false, reason: 'no_account_token' });
      var ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'application/pdf': 'pdf' }[rec.type] || 'bin';
      var objectPath = encodeURIComponent(workspaceId) + '/' + (rec.sha256 || rec.id) + '.' + ext;
      var base = String(cfg.url).replace(/\/+$/, '');
      return fetch(base + '/storage/v1/object/brand-assets/' + objectPath, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + t, apikey: cfg.anonKey, 'Content-Type': rec.type || 'application/octet-stream', 'x-upsert': 'true' },
        body: rec.blob,
      }).then(function (r) {
        if (!r.ok) return { hosted: false, reason: 'storage_' + r.status };
        return { hosted: true, url: base + '/storage/v1/object/public/brand-assets/' + objectPath };
      }, function () { return { hosted: false, reason: 'storage_unreachable' }; });
    },
    namespace: function () { return deviceKey(); },
  };

  /** Paint a brand's own logo and fonts from its files (shell + any page). */
  var registeredFaces = {};
  function paintBrandFiles(brand) {
    try {
      var summary = (brand && brand.files) || {};
      var id = brand && brand.id;
      if (!id) return;
      // The logo: a hosted https URL already paints through logo_url; a file
      // kept on this device paints from IndexedDB.
      var logo = summary.logo;
      if (logo && logo.id && !httpUrl(brand.logo_url)) {
        var src = logo.hosted_url || logo.url;
        (src ? Promise.resolve(src) : files.url(id, logo.id)).then(function (u) {
          if (!u) return;
          document.querySelectorAll('.lnav-brandlogo').forEach(function (slot) {
            while (slot.firstChild) slot.removeChild(slot.firstChild);
            var img = document.createElement('img');
            img.src = u; img.alt = '';
            slot.appendChild(img);
            slot.setAttribute('data-brand-slot', 'logo-file');
            slot.hidden = false;
          });
        }).catch(log);
      }
      // Fonts: registered with the FontFace API under the family the record
      // names, only while this brand is the one painted.
      var fonts = summary.fonts || {};
      Object.keys(fonts).forEach(function (slot) {
        var fx = fonts[slot];
        if (!fx || !fx.family || (!fx.id && !fx.hosted_url && !fx.url)) return;
        var key = id + '|' + slot + '|' + (fx.id || fx.hosted_url || fx.url);
        if (registeredFaces[key] || typeof FontFace === 'undefined') return;
        registeredFaces[key] = true;
        var source = fx.hosted_url || fx.url
          ? Promise.resolve('url(' + JSON.stringify(fx.hosted_url || fx.url) + ')')
          : files.get(id, fx.id).then(function (rec) { return rec && rec.blob ? rec.blob.arrayBuffer() : null; });
        source.then(function (s) {
          if (!s) { registeredFaces[key] = false; return; }
          var face = new FontFace(fx.family, s);
          return face.load().then(function (f) { document.fonts.add(f); document.documentElement.setAttribute('data-brand-font-' + slot, fx.family); });
        }).catch(function (e) { registeredFaces[key] = false; log(e); });
      });
    } catch (e) { log(e); }
  }

  function paint(brand) {
    if (!brand) return;
    brandPaintVersion++;
    // Regenerate foregrounds from the saved palette, including older records
    // whose cached tokens predate the contrast rules.
    applyTokens(brand.palette && Object.keys(brand.palette).length
      ? Object.assign({}, brand.tokens || {}, tokensFor(brand)) : brand.tokens);
    applyFonts(brand.fonts_href);
    applyChrome(brand);
    relabel(brand);
    document.documentElement.setAttribute('data-brand', brand.slug || '');
    paintBrandFiles(brand);
  }

  /* ── data ──────────────────────────────────────────────────────────────── */

  function token() {
    // A token the server can act on (2026-09-30): auth.js answers with the
    // server-mode token, and with the device-mode token on a standalone
    // deployment so features run. apiToken() is the one source.
    try {
      var a = window.LifecycleAuth;
      if (a && typeof a.apiToken === 'function') return a.apiToken() || '';
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
    if (DEVICE_SERVER_OPS[op] && deviceIdIn(o)) return deviceServerApi(op, o);
    var out = await serverApi(op, o);
    // An account brand's files kept on THIS device (not yet hosted) go with it.
    if (op === 'delete' && out && out.ok !== false) { try { await files.removeBrand(str((o.body || {}).id)); } catch (e) { log(e); } }
    return out;
  }

  /* ── THE SERVER READS, THE DEVICE KEEPS (2026-10-03) ──────────────────────
     The operator's words: "All features must work even with signin by number
     and pin". A mobile-number sign-in's brands are on this device, and the
     wizard turned two features OFF for it - "Import catalog" and "Build
     context pack", both "Not available on a mobile-number account" - because
     each was FILED in the workspace database. Reading a store, a CSV or a site
     never needed one. So for a brand on this device the server does the
     reading (it already does all of it) and hands the result back, and it is
     kept here beside the brand: the catalogue under `.catalog.<id>`, the pack
     row under `.pack.<id>`, in the same per-account namespace as the brands.
     The pack is a queue the BROWSER drives, one stage per call - exactly the
     client-driven fallback a deployment without a service key already used -
     carrying its own row each time. What the server answers is the judge: a
     visitor with no session is still refused, and that refusal is shown. */
  var DEVICE_SERVER_OPS = { 'catalog-import': 1, 'context-build': 1, 'context-pack': 1, 'context-design': 1, 'context-list': 1 };

  function deviceBrandBody(row) {
    var b = Object.assign({}, row);
    delete b.storage; delete b.owner_id; delete b.created_at; delete b.updated_at;
    return b;
  }

  async function deviceServerApi(op, o) {
    var id = deviceIdIn(o);
    var d = readDevice();
    var row = deviceFind(d, id);
    if (!row) throw deviceFail(404, 'workspace_not_found', 'That brand is not saved on this device.');
    var body = Object.assign({}, o.body || {});
    var stored = readSide('pack', id) || {};
    if (op === 'catalog-import') {
      body.brand = deviceBrandBody(row);
      var held = deviceCatalog(id);
      // Continue import: the cursor this device kept from the last step.
      if (body.continue === true) {
        if (!held || !held.cursor) throw deviceFail(409, 'nothing_to_continue', 'There is no unfinished catalogue import on this brand to continue. Import it again to read it from the start.');
        body.cursor = held.cursor;
        body.region = held.cursor.region || body.region;
      }
      var r = await serverApi(op, { body: body, query: o.query });
      if (!r || !Array.isArray(r.products)) throw deviceFail(502, 'catalog_not_returned', 'The server read the catalogue but did not hand the products back, so nothing was kept on this device.');
      // MERGED into what this device already keeps (upsert by identity, a
      // product the source no longer lists marked stale once the run is
      // complete) - the twin of the server's brand_catalog_merge().
      var merged = mergeDeviceCatalog(held ? held.products : [], r.products, { run: r.run, complete: !!r.complete && body.replace !== false, family: r.family || [] });
      var live = merged.rows.filter(function (x) { return !x.stale_at; }).length;
      // Imported by hand: the operator owns it, and a context pack run leaves
      // it alone (catalog_owned) exactly as a `user` provenance row would.
      if (!writeSide('catalog', id, { products: merged.rows, source: r.source || null, owned: true, region: r.region || '', imported_at: new Date().toISOString(), cursor: r.complete ? null : (r.cursor || null), run: r.run || null, coverage: r.coverage || null })) {
        throw deviceFail(507, 'device_storage_unavailable', 'This browser refused to store the catalogue (storage is full or blocked), so nothing was kept.');
      }
      saveCatalogSource(id, r.source);
      var out = Object.assign({}, r, { inserted: merged.inserted, updated: merged.updated, staled: merged.staled, live: live });
      delete out.products; delete out.cursor;
      return out;
    }
    if (op === 'context-build') {
      body.brand = deviceBrandBody(row);
      body.device_pack = stored.row || null;
      var cat = deviceCatalog(id);
      body.catalog_owned = !!(cat && cat.owned);
      var rb = await serverApi(op, { body: body, query: o.query });
      // The catalogue FIRST: if this browser will not keep it, the step is not
      // kept either, and the person is told - never a pack that reports
      // "N catalogue rows" while holding none (Codex, 2026-10-03).
      if (rb && Array.isArray(rb.catalog_products) && rb.catalog_products.length && !(cat && cat.owned)) {
        var src = (rb.device_pack && rb.device_pack.catalog && rb.device_pack.catalog.source) || null;
        var pc = rb.device_pack && rb.device_pack.catalog;
        var pm = mergeDeviceCatalog(cat ? cat.products : [], rb.catalog_products, { run: rb.catalog_run, complete: !!(pc && pc.complete), family: ['shopify_public', 'sitemap_jsonld', 'site_crawl'] });
        if (!writeSide('catalog', id, { products: pm.rows, source: src, owned: false, imported_at: new Date().toISOString(), cursor: rb.catalog_cursor || null, run: rb.catalog_run || null, coverage: (pc && pc.coverage) || null })) {
          throw deviceFail(507, 'device_storage_unavailable', 'The context pack read ' + rb.catalog_products.length + ' products from your store, but this browser refused to keep them (storage is full or blocked), so the build stopped here and nothing from this step was kept. Free some browser storage, or import a smaller catalogue (Paste CSV on step 5), then build again.');
        }
        saveCatalogSource(id, src);
      }
      if (rb && rb.device_pack) {
        if (!writeSide('pack', id, { row: rb.device_pack, context: rb.context || null })) {
          throw deviceFail(507, 'device_storage_unavailable', 'This browser refused to store the context pack (storage is full or blocked), so the step was not kept.');
        }
      }
      var outb = Object.assign({}, rb || {});
      delete outb.device_pack; delete outb.catalog_products; delete outb.catalog_cursor;
      return outb;
    }
    if (op === 'context-pack') {
      if (stored.context) return Object.assign({}, stored.context, { storage: 'device' });
      return {
        ok: true, workspace_id: id, pack: null, storage: 'device',
        brand: { name: row.name, website: row.website },
        note: row.website ? 'No context pack has been built for this brand yet.' : 'This brand has no website on its record, so there is nothing to read a context pack from.',
        markers: [launchMarker('brand context pack', { brand: row.name })],
      };
    }
    if (op === 'context-design') {
      var pr = stored.row;
      if (!pr || !pr.design_md) throw deviceFail(404, 'no_design_md', 'No DESIGN.md has been built for this brand yet.');
      return { ok: true, design_md: pr.design_md, design: pr.design || {}, brand_key: pr.brand_key, storage: 'device' };
    }
    if (op === 'context-list') {
      return { ok: true, packs: stored.context && stored.context.pack ? [stored.context.pack] : [], storage: 'device' };
    }
    throw deviceFail(400, 'unknown_brand_operation', 'That operation has no device implementation.');
  }
  /**
   * Merge one import step's rows into the catalogue this device keeps: the twin
   * of catalog-import.mergeRows() / brand_catalog_merge() (a parity test runs
   * both on the same input). Identity is region + handle + sku, an absent value
   * equal to an absent value; a row is updated in place, never duplicated; once
   * a run has read its WHOLE source, a row of the same source family it did not
   * see is marked stale (kept, never deleted).
   */
  function mergeDeviceCatalog(existing, incoming, opts) {
    var o = opts || {};
    var when = o.at || new Date().toISOString();
    var key = function (r) { return String(r.region || '').toLowerCase() + '|' + (r.handle == null ? '' : r.handle) + '|' + (r.sku == null ? '' : r.sku); };
    var out = (Array.isArray(existing) ? existing : []).map(function (r) { return Object.assign({}, r); });
    var index = {};
    out.forEach(function (r, i) { index[key(r)] = i; });
    var inserted = 0, updated = 0, staled = 0;
    (Array.isArray(incoming) ? incoming : []).forEach(function (r) {
      var k = key(r);
      var row = Object.assign({}, r, { last_seen_run: o.run, last_seen_at: when, stale_at: null });
      if (Object.prototype.hasOwnProperty.call(index, k)) { out[index[k]] = Object.assign(out[index[k]], row); updated += 1; }
      else { index[k] = out.length; out.push(row); inserted += 1; }
    });
    if (o.complete) {
      var fam = {}; (o.family || []).forEach(function (f) { fam[f] = 1; });
      var hasFam = (o.family || []).length > 0;
      var regions = {}; var hasRegions = false;
      (incoming || []).forEach(function (r) { regions[String(r.region || '').toLowerCase()] = 1; hasRegions = true; });
      out.forEach(function (r) {
        if (r.last_seen_run === o.run || r.stale_at) return;
        if (hasFam && !fam[r.source]) return;
        if (hasRegions && !regions[String(r.region || '').toLowerCase()]) return;
        r.stale_at = when; staled += 1;
      });
    }
    return { rows: out, inserted: inserted, updated: updated, staled: staled };
  }
  /** Record where the device catalogue came from on the brand row itself, as the account path records it on the workspace. */
  function saveCatalogSource(id, source) {
    if (!source) return;
    var d = readDevice();
    var w = deviceFind(d, id);
    if (!w) return;
    w.catalog_source = source;
    w.updated_at = new Date().toISOString();
    writeDevice(d);
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
              ? 'You are not signed in. Sign in with Google to keep your work under your name, '
                + 'or set up a brand on this device now: it is saved here either way.'
              : 'This platform runs entirely as one brand at a time: its palette, typography, voice, catalogue and market study drive every screen and every generated asset. Until a brand is active there is nothing truthful to show you, so the features stay locked rather than displaying another brand\'s data.') +
        '</p>' +
        (o.busy ? '' :
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">' +
          (o.signedOut
            ? '<button type="button" data-gate-signin style="background:#111;color:#fff;border:0;padding:11px 20px;border-radius:999px;font-weight:700;font-size:14px;cursor:pointer">Sign in with Google</button>'
              // Signed out is a usable state: a brand can be set up on this
              // device now.
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
      // Google is the sign-in. The gate steps aside so a refusal note in the
      // rail can be read (a host that is down is named, never navigated to);
      // a started redirect leaves the page.
      signin.textContent = 'Opening Google...';
      try {
        var a = window.LifecycleAuth;
        if (a && typeof a.openSignIn === 'function') { removeGate(); a.openSignIn(); return; }
      } catch (_) {}
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
      // The namespace this read is answered from, so the backend listener can
      // tell a sign-in or sign-out apart from a mode that did not change.
      state.deviceKey = deviceKey();
      state.userId = currentUserId();
      state.refreshAgain = false;
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
      // Nobody is signed in: the gate offers Sign in whatever the backend's
      // state. It used to offer it only when the account service answered, so
      // on a deployment whose project was paused (production, 2026-10-10) a
      // phone showed no way to sign in at all. When sign-in cannot open, the
      // gate says why in its own body, where a phone can read it.
      state.signedOut = fromDevice && !mobileSession() && NO_SESSION_KINDS.indexOf(authKind()) !== -1;
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
      // No active brand: the shipped default's own pictures (paint() runs
      // only for a brand, so this is the one place the no-brand state lands).
      if (!state.brand) { try { paintShippedImages(null); } catch (e2) { log(e2); } }
      readyResolve(state.brand);
      // auth.js changed the session while this read was in flight (a server
      // session answered 401 during boot, say): what was just painted may be
      // another namespace's. Read again, once, from where brands live now.
      if (state.refreshAgain) { state.refreshAgain = false; refresh(); }
    }
  }

  async function setActive(id, opts) {
    var body = { id: id };
    if (opts && opts.coherence_override) body.coherence_override = opts.coherence_override;
    var r = await api('activate', { body: body });
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
  //    in the rail's panel, a session ending mid-visit - re-read from wherever
  //    brands now live. "Wherever" is the MODE and the NAMESPACE: on a device
  //    with no database, signing in leaves the mode at 'device' and moves the
  //    store from the unscoped key to the account's, so a listener that only
  //    compared modes left the previous person's brand on screen.
  window.addEventListener('lifecycleauth:backend', function () {
    var m = knownMode();
    if (!m) return;
    if (!state.loaded) { state.refreshAgain = true; return; }
    if (m !== state.mode || deviceKey() !== state.deviceKey || currentUserId() !== state.userId) {
      state.brand = null; clearCache();
      refresh();
    }
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
    /* THE DEVICE BRAND TRAVELS WITH THE REQUEST (2026-10-03). A server brand
       is stamped above by workspace_id and the server reads the row. A phone
       sign-in's brand has no row: brand-runtime.resolve() takes the record
       from the request (only from a verified mobile+PIN session, for that
       request alone), and a page that did not send it was answered for an
       UNRESOLVED brand - Smart Brain's Daily Sync planned nothing, every
       generator printed DATA REQUIRED where the brand's own name belonged.
       Pages carried it one call site at a time (KicksGPT, the concierge); this
       carries it for every JSON POST to the routers that resolve a brand, so
       no page has to remember. Never overwrites a `brand` the page sent, and
       only for a phone sign-in: nobody else's request is touched. */
    var CARRY_ROUTERS = /^(?:https?:\/\/[^/]+)?\/api\/(?:brain|calendar|ai\/)/;
    /* The device brand's own CONTACT RULES travel the same way (2026-10-04):
       kept beside the brand on this device (publishing.html), read by the
       server for that request alone, so the calendars and the gate hold this
       brand to its own caps, cool-downs and quiet hours. */
    function keptContactRules() {
      try { var v = store.get(CONTACT_RULES_KEY); var o = v ? JSON.parse(v) : null; return o && typeof o === 'object' ? o : null; } catch (_) { return null; }
    }
    function carryInto(url, init) {
      try {
        if (!init || !CARRY_ROUTERS.test(url) || String(init.method || 'GET').toUpperCase() !== 'POST' || typeof init.body !== 'string') return init;
        if (!phoneToken()) return init;
        var body = JSON.parse(init.body);
        if (!body || typeof body !== 'object' || Array.isArray(body) || body.brand !== undefined) return init;
        var rec = carry();
        if (!rec) return init;
        body.brand = rec;
        if (body.contact_policy === undefined) { var cr = keptContactRules(); if (cr) body.contact_policy = cr; }
        return Object.assign({}, init, { body: JSON.stringify(body) });
      } catch (_) { return init; }
    }
    /* A request for a device brand goes out through THIS wrapper's captured
       fetch, which is the browser's own: auth.js loads deferred and wraps
       window.fetch later, so a page's first request (its plan, its list) left
       with no token at all - the server answered a signed-in phone sign-in as
       an anonymous visitor ("arrived without an active workspace"). Found
       2026-10-03 driving ad-campaigns.html against the shipped routers. The
       token is attached here, as glue() already does for a server brand. */
    /** The Google session's token once auth.js has booted; '' before, and for a visitor. */
    function phoneToken() {
      try {
        var a = window.LifecycleAuth;
        if (a && a.backend && a.backend.kind && a.backend.kind !== 'pending' && typeof a.apiToken === 'function') return a.apiToken() || '';
      } catch (_) {}
      return '';
    }
    function deviceSend(input, url, init) {
      var i2 = carryInto(url, init);
      try {
        var t = phoneToken();
        if (!t) return { input: input, init: i2 };
        if (typeof input !== 'string') {
          if (input && input.headers && input.headers.get && input.headers.get('Authorization')) return { input: input, init: i2 };
          var rq = new Request(input, i2 || undefined);
          rq.headers.set('Authorization', 'Bearer ' + t);
          return { input: rq, init: undefined };
        }
        var o = Object.assign({}, i2 || {});
        var h = new Headers(o.headers || {});
        if (!h.get('Authorization')) h.set('Authorization', 'Bearer ' + t);
        o.headers = h;
        return { input: input, init: o };
      } catch (_) { return { input: input, init: i2 }; }
    }
    function stamped(input, init) {
      try {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var isApi = /^\/api\//.test(url) || url.indexOf(location.origin + '/api/') === 0;
        if (!isApi || UNSCOPED.test(url)) return origFetch.call(window, input, init);
        // A device brand has no server workspace: stamping its `local-` id
        // would turn "you are signed out" into "workspace not found". For a
        // phone sign-in it CARRIES the record instead (carryInto below).
        if (state.brand && state.brand.id && isDeviceId(state.brand.id)) { var d0 = deviceSend(input, url, init); return origFetch.call(window, d0.input, d0.init); }
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
              if (state.brand && state.brand.id && isDeviceId(state.brand.id)) { var d1 = deviceSend(input, url, init); resolve(origFetch.call(self || window, d1.input, d1.init)); return; }
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

  /**
   * The active brand as a record a request can CARRY (2026-09-29). A brand
   * kept on this device has no workspace row on the server, so an agent
   * answering for it has nothing to read: the page sends the record with the
   * turn and the server uses it for that turn alone (brand-runtime.resolve
   * takes it only from a verified mobile+PIN session and stores nothing). A
   * server brand is already stamped by workspace_id, so nothing is carried
   * for it. Only the fields a generator prints, so a turn is not a kilobyte
   * of market study.
   */
  function carry() {
    var b = state.brand;
    if (!b || !b.id || !isDeviceId(b.id)) return null;
    var pick = ['name', 'slug', 'tagline', 'industry', 'website', 'logo_url', 'palette', 'typography', 'voice', 'regions', 'claims', 'offerings', 'competitors', 'catalog_source'];
    var out = {};
    for (var i = 0; i < pick.length; i++) if (b[pick[i]] !== undefined && b[pick[i]] !== null) out[pick[i]] = b[pick[i]];
    var data = b.brand_data && typeof b.brand_data === 'object' ? b.brand_data : {};
    ['claims', 'offerings', 'competitors'].forEach(function (k) { if (out[k] === undefined && data[k] !== undefined) out[k] = data[k]; });
    // An uploaded file with no hosted URL travels as its NAME only (never the
    // bytes): the generators print [DATA REQUIRED BEFORE LAUNCH: hosted logo
    // URL, <brand>] in its place (brand-runtime.hostedMarker, 2026-10-04).
    if (!/^https:\/\//i.test(String(out.logo_url || ''))) delete out.logo_url;
    var pend = pendingHosting(deviceFind(readDevice(), b.id) || b);
    if (pend.length) out.pending_hosting = pend;
    return out;
  }

  window.BrandContext = {
    get brand() { return state.brand; },
    activeBrand: function () { return state.brand; },
    carry: carry,
    // The catalogue a brand on this device keeps beside itself (2026-10-03):
    // { products, source, owned } or null. Read-only; imports go through api().
    deviceCatalog: function (id) { var c = deviceCatalog(id); return c ? JSON.parse(JSON.stringify(c)) : null; },
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
      // The key in use right now: the signed-in account's namespace, or the
      // unscoped key when nobody is signed in.
      key: deviceKey,
      isDeviceId: isDeviceId,
      list: function () { return readDevice().workspaces.map(function (w) { return shellPayloadFor(w); }); },
      // What a signed-in account is offered to sync (this account's rows and the unscoped ones).
      syncable: function () { return syncableDevice().map(function (x) { return shellPayloadFor(x.row); }); },
      active: function () { return readDevice().active_id || ''; },
      count: function () { return readDevice().workspaces.length; },
      // The device catalogue's merge, exposed for the parity test against the server's.
      mergeCatalog: mergeDeviceCatalog,
    },
    // Uploaded brand files (IndexedDB, per account) and field origins (2026-10-04).
    files: files,
    provenance: { RANK: ORIGIN_RANK, rank: originRank, mayReplace: mayReplace, pendingHosting: pendingHosting },
    paintFiles: paintBrandFiles,
    tokensFor: tokensFor,
    fontsHrefFor: fontsHrefFor,
    // Is this record ONE brand (2026-10-10)? The server's rule, ported.
    coherence: COHERENCE.brandCoherence,
    coherenceLib: COHERENCE,
    validatePalette: validatePalette,
    readinessFor: readinessFor,
    launchMarker: launchMarker,
    nouns: function (b) { return nounsFor(b || state.brand); },
    isTenantZero: isTenantZero,
    ownsShipped: ownsShipped,
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

  /* The stem every file this app hands a person is named with: the ACTIVE
     brand's slug, or the platform's name with no brand. Downloads were named
     knickgasm-* on every page, so another brand's calendar, mailers and
     landing pages arrived on disk under tenant zero's name. */
  window.lcFileStem = function () {
    var b = state.brand;
    var s = String((b && (b.slug || b.name)) || 'lifecycle-os').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'lifecycle-os';
  };
})();
