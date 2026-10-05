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
      el.setAttribute('data-shipped-gated', '1');
      el.innerHTML = '<div class="card p-5" data-shipped-marker style="border:1px solid var(--brand-line,#e5e5e5);border-radius:14px;padding:20px;background:var(--brand-surface-alt,#fff)">' +
        '<div style="font-weight:700;margin-bottom:6px">' + escText(what) + ' is not on the record for ' + escText(name) + '</div>' +
        '<p style="margin:0;line-height:1.6;font-size:13.5px">[DATA REQUIRED BEFORE LAUNCH: ' + escText(what) + ', ' + escText(name) + '.] ' +
        'What shipped here was built from another workspace\'s own record and catalogue. This platform never shows one brand\'s material under another brand\'s name; add ' + escText(name) + '\'s own to populate it.</p></div>';
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
  var state = { brand: null, needsOnboarding: false, workspaces: [], loaded: false, signedOut: false, mode: '', deviceKey: '', refreshAgain: false };
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
    // 2026-09-28: the scan of Supabase's `sb-*-auth-token` entries is DISABLED.
    // The mobile+PIN session (auth.js) is the one session source; nothing can
    // produce a Supabase session any more, so an entry found there is a
    // leftover, not a person.
    // try {
    //   for (var i = 0; i < localStorage.length; i++) {
    //     var k = localStorage.key(i);
    //     if (!k || k.indexOf('-auth-token') < 0) continue;
    //     var v = JSON.parse(localStorage.getItem(k) || 'null');
    //     var s = v && (v.user || (v.currentSession && v.currentSession.user));
    //     if (s && s.id) return s.id;
    //   }
    // } catch (_) {}
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
     With ONE key for every mobile+PIN session, person B signing in saw person
     A's brands - name, voice rules, store URLs, legal entity - because "on this
     device" was read as "for whoever is at this device". The namespace is now
     the signed-in account's id: `<DEVICE_KEY>.<user id>`. The UNSCOPED key is
     kept for the no-session states only (no database, a database that does
     not answer, signed out), so onboarding without a backend keeps working
     exactly as before; a sign-in never silently adopts those anonymous rows
     (they were typed by nobody in particular, and adopting them would hand
     A's draft to whoever signs in next), and a sign-out never deletes them.
     The id comes from auth.js's session when it has booted, else from the
     stored session - this file paints the first frame BEFORE auth.js runs,
     and that frame must already be the right person's brand. */
  var MAUTH_SESSION_KEY = 'lifecycle.auth.session';
  function deviceUserId() {
    try {
      var a = window.LifecycleAuth;
      var s = a && a.session;
      if (s && s.provider === 'mobile-pin' && s.user && s.user.id) return String(s.user.id);
      // auth.js has decided and holds no session: a stored one it rejected
      // (expired, signed out elsewhere) must not open a namespace.
      var k = a && a.backend && a.backend.kind;
      if (k && k !== 'pending') return '';
    } catch (_) {}
    try {
      var raw = JSON.parse(localStorage.getItem(MAUTH_SESSION_KEY) || 'null');
      if (!raw || typeof raw !== 'object' || !raw.token || !raw.user || !raw.user.id) return '';
      if (raw.mode !== 'server' && raw.mode !== 'device' && raw.mode !== 'supabase') return '';
      if (raw.expires && !(new Date(raw.expires) > new Date())) return '';
      return String(raw.user.id);
    } catch (_) { return ''; }
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
  /**
   * The mobile+PIN session (2026-09-28), if that is who is signed in. In
   * server (Neon) and device mode it has NO Supabase JWT: brand_workspaces is
   * gated by auth.uid() and such an account has none, so its brands live in
   * the device store. In supabase mode (2026-10-03) it IS a Supabase user
   * with a real JWT, and modeFor() sends its brands to the account.
   */
  function mobileSession() {
    try {
      var a = window.LifecycleAuth;
      var s = a && a.session;
      if (s && s.provider === 'mobile-pin' && s.user) return { provider: 'mobile-pin', mode: s.mode || 'device', name: s.user.name || '', phone: s.user.phone || '', verified: s.verified !== false };
      var b = a && a.backend && a.backend.session;
      if (b && b.provider === 'mobile-pin') return b;
    } catch (_) {}
    return null;
  }
  function modeFor(kind) {
    if (KIND_DEVICE[kind]) return 'device';
    var ms = mobileSession();
    // A phone account IN SUPABASE AUTH (2026-10-03) has a Supabase identity
    // and a real JWT, so brand_workspaces answers it through RLS like any
    // account: its brands are saved to the ACCOUNT. Only while that session
    // cannot be checked (the project not answering) do they go to the device.
    if (ms && ms.mode === 'supabase' && ms.verified) return 'server';
    if (ms) return 'device';
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
        pdp_pattern: str(r.pdp_pattern, 200) || '{base}/products/{handle}',
        collection_pattern: str(r.collection_pattern, 200) || '{base}/collections/{slug}',
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
    var ink = p.ink || '#111111';
    var surface = p.surface || '#F7F5F2';
    var surfaceAlt = p.surface_alt || shade(surface, 0.6);
    var muted = p.muted || shade(ink, 0.35);
    var worstSurface = contrast(primary, surface) <= contrast(primary, surfaceAlt) ? surface : surfaceAlt;
    var t = brand && brand.typography ? brand.typography : {};
    var states = { ok: p.ok || '#1a7f37', warn: p.warn || '#c9a227', err: p.err || '#c0392b' };
    return Object.assign({
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
      '--brand-ok': states.ok,
      '--brand-warn': states.warn,
      '--brand-err': states.err,
      '--brand-font-head': (t.heading && t.heading.stack) || "'Montserrat',Georgia,serif",
      '--brand-font-body': (t.body && t.body.stack) || "system-ui,-apple-system,Segoe UI,sans-serif",
      '--brand-font-mono': (t.mono && t.mono.stack) || 'ui-monospace,SFMono-Regular,Menlo,monospace',
    }, contractTokensFor(primary, accent, ink, muted, surface, surfaceAlt, worstSurface, states), componentTokensFor(brand));
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
    return readableAsText(readableOn(ground, ink || '#111111', surface || '#ffffff'), ground, target || 4.5);
  }
  function contractTokensFor(primary, accent, ink, muted, surface, surfaceAlt, worstSurface, states) {
    var band = normHex(sectionGroundFor(primary, accent, surface)) || '#ffffff';
    var bandAccent = normHex(sectionGroundFor(accent, primary, surface)) || '#ffffff';
    var text = [ink, readableAsText(muted || shade(ink, 0.35), worstSurface, TEXT_AA),
      readableAsText(primary, worstSurface, TEXT_AA), readableAsText(accent, worstSurface, TEXT_AA),
      readableAsText(states.ok, worstSurface, TEXT_AA), readableAsText(states.warn, worstSurface, TEXT_AA),
      readableAsText(states.err, worstSurface, TEXT_AA)];
    return {
      '--brand-surface-sunken': sunkenSurfaceFor(surface, surfaceAlt, text),
      '--brand-band': band,
      '--brand-on-band': textOnFor(band, surface, ink, TEXT_AA),
      '--brand-band-accent': bandAccent,
      '--brand-on-band-accent': textOnFor(bandAccent, surface, ink, TEXT_AA),
      '--brand-ok-text': readableAsText(states.ok, worstSurface, TEXT_AA),
      '--brand-warn-text': readableAsText(states.warn, worstSurface, TEXT_AA),
      '--brand-err-text': readableAsText(states.err, worstSurface, TEXT_AA),
      '--brand-focus': readableAsText(accent, worstSurface, 3),
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

  /* ── the device store ─────────────────────────────────────────────────── */

  function readDevice() {
    var empty = { version: 1, active_id: '', workspaces: [] };
    try {
      var d = JSON.parse(localStorage.getItem(deviceKey()) || 'null');
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
      var key = deviceKey();
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
  function deviceProductCount(id) { var c = deviceCatalog(id); return c ? c.products.length : 0; }
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
    var rs = readSite(k, b, ms);
    return {
      mode: known ? modeFor(k) : (window.__LifecycleAuthBooted ? (state.mode || 'server') : 'server'),
      known: known,
      kind: known ? k : '',
      reachable: known ? b.reachable : null,
      signedIn: known ? !!b.signedIn : false,
      host: b.host || '',
      device_count: d.workspaces.length,
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
      server_actions: serverActions(k, ms),
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
  function serverActions(k, ms) {
    if (!k || k === 'pending') return { on: true, decided: false, state: 'undecided' };
    if (ms) {
      // A device sign-in on a deployment whose accounts now live in a database
      // that answers (Neon 'server', or Supabase Auth 'supabase' - #119 refuses
      // a device token while the project answers) is stale: sign in again.
      if (ms.mode === 'device' && accountStore && (accountStore.mode === 'server' || accountStore.mode === 'supabase')) return { on: false, decided: true, state: 'stale-device-session' };
      if (ms.mode === 'device') askAccountStore();
      var acct = ms.mode === 'server' || ms.mode === 'supabase';
      return { on: true, decided: acct || !!accountStore, state: acct ? 'server-session' : 'device-session' };
    }
    if (KIND_DEVICE[k]) return { on: false, decided: true, state: 'signed-out' };
    // A signed-in account with a database behind it, or the localhost preview.
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
  var accountStore = null, accountStoreAsked = false;
  function askAccountStore() {
    if (accountStoreAsked) return;
    var a = window.LifecycleAuth;
    var ask = a && a.mobile && typeof a.mobile.status === 'function' ? a.mobile.status : null;
    if (!ask) return;
    accountStoreAsked = true;
    Promise.resolve().then(ask).then(function (st) {
      accountStore = (st && typeof st === 'object') ? st : { mode: 'device', reason: 'status_unavailable', host: '', message: '' };
    }, function () {
      accountStore = { mode: 'device', reason: 'status_unavailable', host: '', message: '' };
    }).then(function () {
      try { window.dispatchEvent(new CustomEvent('brandcontext:storage', { detail: { account_store: accountStore } })); } catch (_) {}
    });
  }
  function readSite(k, b, ms) {
    var out = { on: true, decided: false, state: 'undecided', supabase: '', store: accountStore, host: (b && b.host) || '' };
    if (!k || k === 'pending') return out;
    if (ms && (ms.mode === 'server' || ms.mode === 'supabase')) { out.decided = true; out.state = 'checkable-session'; return out; }
    // A DEVICE-mode sign-in sends its token since 2026-09-30, and with no
    // database the server admits it as a device principal from a page - so it
    // is ON for the same reason a server-mode session is. The one exception is
    // a deployment whose accounts are now in a database that answers: this
    // token is not in it, and the server refuses (sign in again).
    if (ms && ms.mode === 'device') {
      askAccountStore();
      if (!accountStore) { out.state = 'device-session'; return out; }
      out.decided = true;
      if (accountStore.mode === 'server' || accountStore.mode === 'supabase') { out.on = false; out.state = 'stale-device-session'; return out; }
      out.state = 'device-session';
      return out;
    }
    // Everything that follows sends NO token.
    if (!ms && k !== 'unreachable' && k !== 'unconfigured' && k !== 'signed-out' && k !== 'sdk') {
      // The localhost preview, or a legacy session: the server judges, as before.
      out.decided = true; out.state = 'server-judges'; return out;
    }
    var supa = ms ? String((b && b.supabase) || 'pending') : (k === 'signed-out' ? 'reachable' : k);
    out.supabase = supa;
    if (supa === 'pending') return out;
    askAccountStore();
    out.decided = true;
    if (supa === 'sdk') { out.on = false; out.state = 'sdk'; return out; }
    if (supa !== 'unreachable' && supa !== 'unconfigured') {
      // A session could be checked (Supabase answers): the gate is real. The
      // account store changes only WHAT to say - whether signing in is the
      // remedy - so the words are not decided until it has answered.
      out.on = false; out.state = 'backend-answers'; out.decided = !!accountStore; return out;
    }
    if (!accountStore) { out.decided = false; return out; }
    if (accountStore.mode === 'server') { out.on = false; out.state = 'accounts-in-database'; return out; }
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
      if (mobileSession()) throw deviceFail(409, 'account_type_unsupported', 'A mobile-number account keeps its brands on this device: there is no record of it in the workspace database to sync to.');
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
      try { gateShipped(brand); } catch (e) { log(e); }
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
    applyTokens(brand.tokens);
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
      if (a && a.session && a.session.access_token && a.session.provider === 'mobile-pin') return a.session.access_token;
    } catch (_) {}
    // 2026-09-28: DISABLED - Supabase's project-scoped session keys. Nothing
    // can produce a Supabase session any more; see currentUserId().
    // try {
    //   for (var i = 0; i < localStorage.length; i++) {
    //     var k = localStorage.key(i);
    //     if (!k || k.indexOf('-auth-token') < 0) continue;
    //     var v = JSON.parse(localStorage.getItem(k) || 'null');
    //     var t = v && (v.access_token || (v.currentSession && v.currentSession.access_token));
    //     if (t) return t;
    //   }
    // } catch (_) {}
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
      var r = await serverApi(op, { body: body, query: o.query });
      if (!r || !Array.isArray(r.products)) throw deviceFail(502, 'catalog_not_returned', 'The server read the catalogue but did not hand the products back, so nothing was kept on this device.');
      // Imported by hand: the operator owns it, and a context pack run leaves
      // it alone (catalog_owned) exactly as a `user` provenance row would.
      if (!writeSide('catalog', id, { products: r.products, source: r.source || null, owned: true, region: r.region || '', imported_at: new Date().toISOString() })) {
        throw deviceFail(507, 'device_storage_unavailable', 'This browser refused to store the catalogue (storage is full or blocked), so nothing was kept.');
      }
      saveCatalogSource(id, r.source);
      var out = Object.assign({}, r);
      delete out.products;
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
        if (!writeSide('catalog', id, { products: rb.catalog_products, source: src, owned: false, imported_at: new Date().toISOString() })) {
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
      delete outb.device_pack; delete outb.catalog_products;
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
              ? 'You are not signed in, so there is no workspace to load. Sign in with Google to reach your brands, '
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
      // rail can be read; a started redirect leaves the page.
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
      // auth.js changed the session while this read was in flight (a server
      // session answered 401 during boot, say): what was just painted may be
      // another namespace's. Read again, once, from where brands live now.
      if (state.refreshAgain) { state.refreshAgain = false; refresh(); }
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
  //    in the rail's panel, a session ending mid-visit - re-read from wherever
  //    brands now live. "Wherever" is the MODE and the NAMESPACE: on a device
  //    with no database, signing in leaves the mode at 'device' and moves the
  //    store from the unscoped key to the account's, so a listener that only
  //    compared modes left the previous person's brand on screen.
  window.addEventListener('lifecycleauth:backend', function () {
    var m = knownMode();
    if (!m) return;
    if (!state.loaded) { state.refreshAgain = true; return; }
    if (m !== state.mode || deviceKey() !== state.deviceKey) refresh();
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
    /** The phone sign-in's token: auth.js's once it has booted, else the stored session (the first frame runs before it). */
    function phoneToken() {
      try {
        var a = window.LifecycleAuth;
        if (a && a.backend && a.backend.kind && a.backend.kind !== 'pending') {
          return (mobileSession() && typeof a.apiToken === 'function') ? (a.apiToken() || '') : '';
        }
        var raw = JSON.parse(localStorage.getItem(MAUTH_SESSION_KEY) || 'null');
        if (!raw || raw.provider !== 'mobile-pin' || typeof raw.token !== 'string' || !/^[A-Za-z0-9_-]{40,90}$/.test(raw.token)) return '';
        if (raw.mode !== 'server' && raw.mode !== 'device') return '';
        if (raw.expires && !(new Date(raw.expires) > new Date())) return '';
        return raw.token;
      } catch (_) { return ''; }
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
          if (!rq.headers.get('X-Lifecycle-Token')) rq.headers.set('X-Lifecycle-Token', t);
          return { input: rq, init: undefined };
        }
        var o = Object.assign({}, i2 || {});
        var h = new Headers(o.headers || {});
        if (!h.get('Authorization')) h.set('Authorization', 'Bearer ' + t);
        if (!h.get('X-Lifecycle-Token')) h.set('X-Lifecycle-Token', t);
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
      active: function () { return readDevice().active_id || ''; },
      count: function () { return readDevice().workspaces.length; },
    },
    // Uploaded brand files (IndexedDB, per account) and field origins (2026-10-04).
    files: files,
    provenance: { RANK: ORIGIN_RANK, rank: originRank, mayReplace: mayReplace, pendingHosting: pendingHosting },
    paintFiles: paintBrandFiles,
    tokensFor: tokensFor,
    fontsHrefFor: fontsHrefFor,
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
})();
