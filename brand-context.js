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
  var EXEMPT = /^\/(onboarding|setup|start|login|privacy|terms|access-issues|access)(\.html)?\/?$/i;

  /* Names the shipped app hardcodes into visible copy. When a different brand
     is active these are re-labelled in text nodes. URLs are never touched. */
  var SHIPPED_NAME_RX = /\bKNICKGASM\b|\bKnickgasm\b/g;
  var SHIPPED_ASSISTANT = /\bKicksGPT\b/g;
  // Non-global twins for `.test()`. A /g regex is stateful across calls, so the
  // matching pass and the replacing pass must not share one.
  var SHIPPED_NAME_TEST = /\bKNICKGASM\b|\bKnickgasm\b/;
  var SHIPPED_ASSISTANT_TEST = /\bKicksGPT\b/;

  var state = { brand: null, needsOnboarding: false, workspaces: [], loaded: false };
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
    } catch (e) { log(e); }
  }

  /* ── re-labelling shipped copy ─────────────────────────────────────────── */

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, INPUT: 1, NOSCRIPT: 1, KBD: 1, SAMP: 1 };

  function relabel(brand) {
    if (!brand || !brand.name) return;
    // Only re-label when this is genuinely a different brand.
    if (/^knickgasm$/i.test(brand.name.trim())) return;
    var assistant = brand.name + ' Assistant';

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
          return (SHIPPED_NAME_TEST.test(v) || SHIPPED_ASSISTANT_TEST.test(v)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      var hits = [], n;
      while ((n = w.nextNode())) hits.push(n);
      hits.forEach(function (node) {
        SHIPPED_NAME_RX.lastIndex = 0; SHIPPED_ASSISTANT.lastIndex = 0;
        node.nodeValue = node.nodeValue
          .replace(SHIPPED_ASSISTANT, assistant)
          .replace(SHIPPED_NAME_RX, brand.name);
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

  async function api(op, opts) {
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
    if (!res.ok) { var e = new Error(json.error || json.message || ('HTTP ' + res.status)); e.status = res.status; e.payload = json; throw e; }
    return json;
  }

  function emit() {
    var detail = { brand: state.brand, needsOnboarding: state.needsOnboarding, workspaces: state.workspaces };
    listeners.forEach(function (fn) { try { fn(detail); } catch (e) { log(e); } });
    try { window.dispatchEvent(new CustomEvent('brandcontext:change', { detail: detail })); } catch (_) {}
  }

  function gateToOnboarding() {
    try {
      var p = location.pathname.replace(/\/+$/, '') || '/';
      if (EXEMPT.test(p)) return;
      if (sessionStorage.getItem('lc-onboarding-skip') === '1') return;
      location.replace(ONBOARDING_PATH + '?from=' + encodeURIComponent(p));
    } catch (e) { log(e); }
  }

  async function refresh() {
    try {
      var r = await api('active');
      state.brand = r.brand || null;
      state.needsOnboarding = !!r.needs_onboarding;
      state.workspaces = r.workspaces || [];
      state.loaded = true;
      if (state.brand) { writeCache(state.brand); paint(state.brand); }
      else writeCache(null);
      emit();
      if (!state.brand && state.needsOnboarding) gateToOnboarding();
      return state.brand;
    } catch (e) {
      // 401 means this session is not (or no longer) valid. Anything cached
      // belongs to a session we cannot verify, so stop showing it rather than
      // leaving another account's brand on screen indefinitely.
      if (e.status === 401) { clearCache(); state.brand = null; }
      else log(e);
      state.loaded = true;
      emit();
      return state.brand;
    } finally {
      readyResolve(state.brand);
    }
  }

  async function setActive(id) {
    var r = await api('activate', { body: { id: id } });
    state.brand = r.brand || null;
    if (state.brand) { writeCache(state.brand); paint(state.brand); }
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
  var cached = readCache();
  if (cached) { state.brand = cached; paint(cached); }

  // 2. Revalidate. Wait for auth to have a session, but never wait forever.
  function start() {
    var tries = 0;
    (function attempt() {
      if (token() || tries > 20) { refresh(); return; }
      tries++;
      setTimeout(attempt, 150);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.BrandContext = {
    get brand() { return state.brand; },
    get needsOnboarding() { return state.needsOnboarding; },
    get workspaces() { return state.workspaces; },
    get loaded() { return state.loaded; },
    ready: function () { return readyPromise; },
    refresh: refresh,
    setActive: setActive,
    list: list,
    api: api,
    paint: paint,
    token: token,
    clearCache: clearCache,
    onChange: function (fn) { if (typeof fn === 'function') { listeners.push(fn); if (state.loaded) fn({ brand: state.brand, needsOnboarding: state.needsOnboarding, workspaces: state.workspaces }); } },
  };
})();
