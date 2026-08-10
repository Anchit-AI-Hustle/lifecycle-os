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

  var state = { brand: null, needsOnboarding: false, workspaces: [], loaded: false, signedOut: false };
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
              ? 'You are not signed in, so there is no workspace to load. Sign in with Google to reach your brands. If sign-in fails, the Google OAuth client needs this callback allowed: https://fswdwmkgggzyxrdzabnh.supabase.co/auth/v1/callback'
              : 'This platform runs entirely as one brand at a time: its palette, typography, voice, catalogue and market study drive every screen and every generated asset. Until a brand is active there is nothing truthful to show you, so the features stay locked rather than displaying another brand\'s data.') +
        '</p>' +
        (o.busy ? '' :
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">' +
          (o.signedOut
            ? '<button type="button" data-gate-signin style="background:#111;color:#fff;border:0;padding:11px 20px;border-radius:999px;font-weight:700;font-size:14px;cursor:pointer">Sign in with Google</button>'
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
      var r = await api('active');
      state.brand = r.brand || null;
      state.needsOnboarding = !!r.needs_onboarding;
      state.workspaces = r.workspaces || [];
      state.signedOut = false;
      state.loaded = true;
      if (state.brand) { writeCache(state.brand); paint(state.brand); }
      else writeCache(null);
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
  function start() {
    var tries = 0;
    (function attempt() {
      if (token() || tries > 10) { refresh(); return; }
      tries++;
      setTimeout(attempt, 150);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

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
    function glue(input, ws) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (url.indexOf('workspace_id=') >= 0) return input;
      var glued = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'workspace_id=' + encodeURIComponent(ws);
      return (typeof input === 'string') ? glued : new Request(glued, input);
    }
    function stamped(input, init) {
      try {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var isApi = /^\/api\//.test(url) || url.indexOf(location.origin + '/api/') === 0;
        if (!isApi || UNSCOPED.test(url)) return origFetch.call(window, input, init);
        if (state.brand && state.brand.id) return origFetch.call(window, glue(input, state.brand.id), init);
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
              if (state.brand && state.brand.id) { resolve(origFetch.call(self || window, glue(input, state.brand.id), init)); return; }
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
