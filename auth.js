/* eslint-env browser */
/**
 * auth.js — Lifecycle OS shared auth + cross-step navigation header.
 *
 * Drop this <script> into any page in the project. It:
 *   1. Bootstraps the Supabase client from window.__SUPABASE__ (set in HTML head)
 *      OR from the /api/public-config endpoint at runtime.
 *   2. Forces a one-time Google sign-in if no active session.
 *   3. Renders a shared top-bar with cross-step navigation so any stage
 *      can jump to any other stage. The bar lives at the very top of the
 *      document — pages can still render their own headers below.
 *   4. Provides window.LifecycleAuth.{client, session, signOut} for any
 *      page that needs to read the user or query Supabase.
 *
 * Sign-in happens once; session persists in localStorage (Supabase default).
 * Open external links in a new tab; same-app links stay in same tab.
 */
(function () {
  'use strict';

  if (window.__LifecycleAuthBooted) return;
  window.__LifecycleAuthBooted = true;

  // ─── Shared design system: load /theme.css once on every page ───────────
  // theme.css is additive (design tokens + globally-safe polish + opt-in vh-*
  // components), so it never clobbers a page's own CSS. Injected here so every
  // page that ships auth.js inherits the system — including the Capacitor apps,
  // which are WebView shells over production. Also ensure the viewport opts into
  // safe-area (notch) insets so the theme's env() padding actually resolves.
  // The frozen "diff-version" snapshot must never change — it is a pinned
  // before/after reference (see diff-version/FROZEN_AT.txt). It is fully
  // self-themed, so we exempt it from the shared theme system entirely: no
  // theme.css injection, no green lock — it keeps its own dark theme.
  var IS_FROZEN_DIFF = /(^|\/)diff-version(\/|\.html|$)/.test(location.pathname);

  (function ensureTheme() {
    try {
      var d = document;
      if (IS_FROZEN_DIFF) { d.documentElement.setAttribute('data-theme', 'dark'); return; }
      if (!d.querySelector('link[data-vh-theme]')) {
        var l = d.createElement('link');
        l.rel = 'stylesheet';
        l.href = '/theme.css?v=20260718-light';
        l.setAttribute('data-vh-theme', '1');
        (d.head || d.documentElement).appendChild(l);
      }
      var vp = d.querySelector('meta[name="viewport"]');
      if (vp && !/viewport-fit/.test(vp.getAttribute('content') || '')) {
        vp.setAttribute('content', vp.getAttribute('content') + ', viewport-fit=cover');
      } else if (!vp) {
        vp = d.createElement('meta');
        vp.name = 'viewport';
        vp.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
        (d.head || d.documentElement).appendChild(vp);
      }
      // Locked theme: one green surface. No switcher. Force the attribute and
      // clear any stale saved variant so old localStorage can't resurface it.
      d.documentElement.setAttribute('data-theme', 'green');
      try { localStorage.removeItem('vh-theme'); } catch (_) {}
    } catch (_) {}
  })();

  // ─── Shared motion layer: load /motion.js once on every page ────────────
  // Additive scroll-reveal + depth choreography (Design DNA / Motion). It is
  // fully fail-safe (never hides content if it doesn't run) and self-skips the
  // frozen diff snapshot + reduced-motion users. Loaded deferred so it never
  // blocks first paint.
  (function ensureMotion() {
    try {
      if (IS_FROZEN_DIFF) return;
      var d = document;
      if (d.querySelector('script[data-vh-motion]')) return;
      var s = d.createElement('script');
      s.src = '/motion.js?v=20260719';
      s.defer = true;
      s.setAttribute('data-vh-motion', '1');
      (d.head || d.documentElement).appendChild(s);
    } catch (_) {}
  })();

  // ─── Universal brand layer + credit meter ───────────────────────────────
  // brand-context.js re-skins the whole app to the signed-in user's ACTIVE
  // brand workspace (palette, fonts, name, favicon) and sends a user with no
  // brand to /onboarding. credits.js renders the live balance pill, labels
  // every [data-credit-feature] element with its cost, and guards runs.
  // Both are additive, fail-safe and self-skip the frozen diff snapshot.
  // brand-context loads FIRST so credits can read the active workspace id.
  // ─── Same-origin API calls carry the session automatically ──────────────
  // The credit meter identifies the caller from a Supabase bearer token, and
  // several long-standing endpoints (/api/ai/generate, /api/ai/image,
  // /api/calendar) are now metered. Dozens of pages call them with only a
  // Content-Type header, so without this every signed-in user would get
  // 401 sign_in_required the moment the meter is configured.
  //
  // Rather than editing every call site, fetch is wrapped once here: a
  // SAME-ORIGIN request to /api/... gets the current access token attached,
  // and only when the caller has not set an Authorization header itself (so
  // CRON_SECRET callers and explicit tokens still win).
  //
  // Cross-origin requests are never touched — attaching the token to a third
  // party would leak the user's session.
  (function attachSessionToApiCalls() {
    try {
      if (window.__lcFetchPatched || typeof window.fetch !== 'function') return;
      window.__lcFetchPatched = true;
      var nativeFetch = window.fetch.bind(window);

      function currentToken() {
        try {
          var a = window.LifecycleAuth;
          if (a && a.session && a.session.access_token) return a.session.access_token;
        } catch (_) {}
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

      function isOwnApi(url) {
        try {
          var u = new URL(url, location.href);
          return u.origin === location.origin && /^\/api\//.test(u.pathname);
        } catch (_) { return false; }
      }

      window.fetch = function (input, init) {
        try {
          var url = (typeof input === 'string') ? input : (input && input.url) || '';
          if (!isOwnApi(url)) return nativeFetch(input, init);

          var token = currentToken();
          if (!token) return nativeFetch(input, init);

          // Request object: clone with the header added, leaving the body alone.
          if (typeof input !== 'string' && input && typeof Request !== 'undefined' && input instanceof Request) {
            if (input.headers && input.headers.get && input.headers.get('Authorization')) return nativeFetch(input, init);
            var req = new Request(input, init || undefined);
            if (!req.headers.get('Authorization')) req.headers.set('Authorization', 'Bearer ' + token);
            return nativeFetch(req);
          }

          var opts = Object.assign({}, init || {});
          var headers = new Headers((opts && opts.headers) || {});
          if (!headers.get('Authorization')) headers.set('Authorization', 'Bearer ' + token);
          opts.headers = headers;
          return nativeFetch(input, opts);
        } catch (_) {
          return nativeFetch(input, init);
        }
      };
    } catch (_) {}
  })();

  (function ensurePlatformRuntimes() {
    try {
      if (IS_FROZEN_DIFF) return;
      var d = document;
      [['/brand-context.js?v=20260809', 'data-vh-brand'], ['/credits.js?v=20260809', 'data-vh-credits']].forEach(function (pair) {
        if (d.querySelector('script[' + pair[1] + ']')) return;
        var s = d.createElement('script');
        s.src = pair[0];
        s.setAttribute(pair[1], '1');
        (d.head || d.documentElement).appendChild(s);
      });
    } catch (_) {}
  })();

  // Theme switcher removed — the theme is locked to green (see theme.css).
  // Clean up the old floating button if a cached page still has one.
  (function removeLegacyThemeSwitch() {
    function kill() { var b = document.getElementById('vh-theme-switch'); if (b) b.remove(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kill);
    else kill();
  })();

  // ─── PWA install: register the service worker once per page load ────────
  // This is what makes the address-bar install icon appear in Chrome / Edge
  // (and adds "Add to Home Screen" on iOS/Android) — alongside the manifest.
  //
  // Aggressive update path: every page load, ask the registration to update;
  // if a waiting SW exists, tell it to skipWaiting; once it takes control,
  // reload the page so the user instantly sees the new auth.js / shell.
  // Without this the user had to do a manual "hard reload" to see sidebar
  // changes — we now self-heal the cache on every navigation.
  // navigator.webdriver: automation (Playwright/CI) gets no service worker -
  // the first-install controllerchange reload would restart pages mid-test.
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !navigator.webdriver) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        // Trigger an update check on every page load.
        reg.update().catch(() => {});
        // If a new SW is already waiting (from a previous visit), activate now.
        if (reg.waiting) reg.waiting.postMessage('skipWaiting');
        // When a new SW takes over, reload once so the page uses the fresh shell.
        let didReload = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (didReload) return; didReload = true;
          // Defer slightly so any in-flight nav clicks finish.
          setTimeout(() => location.reload(), 50);
        });
        // Listen for "updatefound" → "installed" so we don't sit on a waiting SW.
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              sw.postMessage('skipWaiting');
            }
          });
        });
      } catch { /* SW registration failed — site still works */ }
    });
  }

  // ─── Brand mark (logo mark for the active brand; falls back to a monogram) ──
  // Two layered ideas fuse: a symmetric panel silhouette (the mark)
  // and a subtle V (the monogram) read through the panel's central vein.
  // Topped with a chalk steam curl — fresh craft, lifecycle. Both tile
  // and panel use linear gradients for depth so the mark reads as crafted
  // rather than flat at any size. Renders cleanly at 22px (mobile bar)
  // and 30px (desktop sidebar).
  const LOGO_SVG = `<svg class="lnav-mark" viewBox="0 0 32 32" aria-label="Lifecycle OS" xmlns="http://www.w3.org/2000/svg">
    <!-- Lifecycle OS product mark: a closed loop with an advancing arrowhead -
         the lifecycle that keeps running. Brand-NEUTRAL by construction: every
         colour resolves through the active brand's design tokens, so the mark
         re-skins with the workspace instead of carrying one tenant's palette.
         When the active brand supplies a logo_url, brand-context.js swaps this
         out for that image entirely. -->
    <rect width="32" height="32" rx="8" fill="var(--brand-primary, #D0473E)"/>
    <circle cx="16" cy="16" r="7.6" fill="none"
            stroke="var(--brand-on-primary, #FFFFFF)" stroke-width="2.1"
            stroke-linecap="round" stroke-dasharray="35 12" transform="rotate(-38 16 16)"/>
    <path d="M 22.6 9.6 L 23.9 13.3 L 20.1 12.4 Z" fill="var(--brand-on-primary, #FFFFFF)"/>
    <circle cx="16" cy="16" r="2.4" fill="var(--brand-accent, #6A33D8)"/>
  </svg>`;

  // ─── Information architecture (left-hand sidebar) ───────────────────
  // Flat items render as top-level links; `children` render as an expandable
  // group. `open:true` marks a feature that never requires sign-in.
  // Stroke icons (inherit currentColor). Brand glyphs (Google/Meta/TikTok) live
  // in BRAND below and render in their own official colours.
  const ICONS = {
    home:       '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9h5v-5h4v5h5v-9"/>',
    analysis:   '<path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="5"/><rect x="12" y="7" width="3" height="9"/><rect x="17" y="13" width="3" height="3"/>',
    competitor: '<path d="m21 21-4.3-4.3"/><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6"/>',
    mailer:     '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    calendar:   '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    ads:        '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15 8a4 4 0 0 1 0 8"/>',
    landing:    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
    kb:         '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M19 17H6a2 2 0 0 0-2 2"/>',
    discover:   '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/>',
    cohort:     '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9.5" r="2.3"/><path d="M16 14.4c2.6.4 4.5 2.6 4.5 5.6"/>',
    studio:     '<path d="M5 3v4M3 5h4M6 17v4M4 19h4"/><path d="m13 3 2.3 6.7L22 12l-6.7 2.3L13 21l-2.3-6.7L4 12l6.7-2.3z"/>',
    insights:   '<path d="M3 3v18h18"/><path d="m7 14 3-4 3 3 4-6"/><circle cx="7" cy="14" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="13" cy="13" r="1.2"/><circle cx="17" cy="7" r="1.2"/>',
    knickgasm:     '<path d="M12 21c-1-5-4-6.5-7-7 0-5 3.5-8 7-9 3.5 1 7 4 7 9-3 .5-6 2-7 7z"/><path d="M12 13c1.5-2 3.5-3 5.5-3.5"/>',
    social:     '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.7 6.8-4.4M8.6 13.3l6.8 4.4"/>',
    avatars:    '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><path d="M12 2.2v1.4M12 12.4v1.4M17.8 8h-1.4M7.6 8H6.2"/>',
  };
  // Real, full-colour brand glyphs. Each is a complete <svg> with its own
  // viewBox + official brand colours, so Meta / Google / TikTok read as the
  // actual app icons rather than generic line-art.
  const BRAND = {
    google: '<svg viewBox="0 0 24 24" width="18" height="18" class="lnav-ic lnav-brandic"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"/></svg>',
    meta:   '<svg viewBox="0 0 24 24" width="18" height="18" class="lnav-ic lnav-brandic" fill="none" stroke="#0866FF" stroke-width="2.2" stroke-linecap="round"><path d="M2.2 13.6c.9-4.2 2.6-6.6 4.8-6.6 2.8 0 4.3 3.7 6.5 7.2 1.6 2.6 2.8 3.8 4.3 3.8 1.7 0 2.6-1.7 2.6-4.2 0-3.5-1.6-6.6-4-6.6-2.7 0-4.4 3.3-6.6 6.8-1.6 2.5-2.9 4.2-4.6 4.2-1.4 0-2.3-1-2.6-2.4"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" width="18" height="18" class="lnav-ic lnav-brandic"><path fill="#25F4EE" d="M15.3 5.6a4.3 4.3 0 0 1-1-2.6h-1.9v12.4a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4 0 .6.1V11a5.5 5.5 0 1 0 4.3 5.4V8.9a7.3 7.3 0 0 0 3.3 1.2V7.5a4.3 4.3 0 0 1-2.8-1.9z"/><path fill="#FE2C55" d="M17.1 6.4a4.3 4.3 0 0 1-1-2.6h-1.9v12.4a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4 0 .6.1v-2.1a5.5 5.5 0 1 0 4.3 5.4V9.7A7.3 7.3 0 0 0 20 10.9V8.3a4.3 4.3 0 0 1-2.9-1.9z"/><path fill="#FFF" d="M16.2 6a4.3 4.3 0 0 1-1-2.6h-1.9v12.4a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4 0 .6.1V11.4a5.5 5.5 0 1 0 4.3 5.4V9.3a7.3 7.3 0 0 0 3.3 1.2V7.9A4.3 4.3 0 0 1 16.2 6z"/></svg>',
  };
  // ─── Information architecture ───────────────────────────────────────
  // Workflow-ordered IA (product-owner rule): Home pinned on top, then the
  // sections follow the SEQUENTIAL order a marketer actually works in —
  //   1. RESEARCH & BENCHMARK  = what others do, what we know, what our data says.
  //   2. PLAN                  = calendars + the UK program.
  //   3. DESIGN & CREATE       = where KNICKGASM produces its own assets.
  //   4. SHARE & TRACK         = the export/download library of finished work.
  //   5. ASSISTANTS            = cross-cutting conversational/autonomous helpers.
  // Every destination stays reachable — groups nest, nothing is deleted.
  // Version taxonomy (CLAUDE.md "Version taxonomy (V1 vs V2)"): `ver` badges an
  // item V1 (legacy base app) or V2 (Lifecycle OS, 2026-07-03 additions). Where
  // BOTH generations of the same capability exist, `draft` records Draft 1 vs
  // Draft 2 (e.g. Plan V1 = Draft 1 vs Mailer Calendar V2 = Draft 2 of
  // calendaring; Mailer Studio V1 = Draft 1 vs the Mailer Calendar's built
  // mailers = Draft 2 of mailer creation). The Draft label renders in tooltips
  // and the sub-item info panels — not in the row — to keep rows quiet.
  const NAV = [
    { id: 'appaudit',   label: 'Overall App Audit', href: '/audit',      icon: 'insights', ver: 'v2', match: ['/audit', '/app-audit', '/app-audit.html'] },
    { id: 'home',       label: 'Home',          href: '/',               icon: 'home',     match: ['/', '/index.html'] },
    { group: 'Brand & Credits', icon: 'studio', gid: 'platform', ver: 'v2', children: [
      { id: 'brand-setup',   label: 'Brand Setup',      href: '/onboarding', icon: 'studio', match: ['/onboarding', '/setup', '/start', '/onboarding.html'] },
      { id: 'brand-switch',  label: 'Switch Brand',     href: '/onboarding?step=6', icon: 'studio' },
      { id: 'brandinput',    label: 'Brand Kit',        href: '/brand',      icon: 'insights', match: ['/brand', '/brand.html'] },
      { id: 'about',         label: 'About this platform', href: '/about', icon: 'kb', match: ['/about', '/about.html'] },
      { id: 'credits',       label: 'Credits & Usage',  href: '/credits',    icon: 'insights', match: ['/credits', '/wallet', '/billing', '/credits.html'] },
    ]},
    { group: 'Market Study', icon: 'kb', gid: 'research', ver: 'v2', children: [
      { id: 'research',        label: 'Overview (all regions)', href: '/research',               icon: 'kb',       match: ['/research', '/growth-book', '/research.html'] },
      { id: 'research-us',     label: 'US Study',               href: '/research?region=us',     icon: 'insights' },
      { id: 'research-uk',     label: 'UK Study',               href: '/research?region=uk',     icon: 'insights' },
      { id: 'research-global', label: 'Global Study',           href: '/research?region=global', icon: 'insights' },
      { id: 'research-india',  label: 'India Study',            href: '/research?region=india',  icon: 'insights' },
    ]},
    { id: 'allinone',   label: 'Master Dashboard', href: '/master-dashboard', icon: 'analysis', ver: 'v2', match: ['/master-dashboard', '/master', '/all-in-one', '/os', '/dashboard-os', '/all-in-one.html'] },

    { section: 'Research & Benchmark' },
    { group: 'Competitor Benchmarking', icon: 'competitor', gid: 'competitor', ver: 'v1', children: [
      { id: 'comp-discover',label: 'Discover Brands',href: '/competitor-benchmarking.html#discover', icon: 'discover' },
      { id: 'comp-mailers', label: 'Mailers',        href: '/competitor-benchmarking.html#mailers',  icon: 'mailer' },
      { id: 'comp-meta',    label: 'Meta Ads',       href: '/competitor-benchmarking.html#meta',     icon: 'meta' },
      { id: 'comp-google',  label: 'Google Ads',     href: '/competitor-benchmarking.html#google',   icon: 'google' },
      { id: 'comp-tiktok',  label: 'TikTok Ads',     href: '/competitor-benchmarking.html#tiktok',   icon: 'tiktok' },
      { id: 'comp-landing', label: 'Landing Pages',  href: '/competitor-benchmarking.html#landing',  icon: 'landing' },
      { id: 'comp-insights',label: 'Insights',       href: '/competitor-benchmarking.html#insights', icon: 'insights' },
    ]},
    { group: 'Knowledge Base', icon: 'kb', gid: 'kb', ver: 'v1', children: [
      { id: 'kbv-mailers', label: 'Mailers',       href: '/knowledge-base.html#mailers', icon: 'mailer' },
      { id: 'kbv-meta',    label: 'Meta Ads',      href: '/knowledge-base.html#meta',    icon: 'meta' },
      { id: 'kbv-google',  label: 'Google Ads',    href: '/knowledge-base.html#google',  icon: 'google' },
      { id: 'kbv-tiktok',  label: 'TikTok Ads',    href: '/knowledge-base.html#tiktok',  icon: 'tiktok' },
      { id: 'kbv-landing', label: 'Landing Pages', href: '/knowledge-base.html#landing', icon: 'landing' },
    ]},
    { id: 'designintel', label: 'Design Intelligence', href: '/design-intel', icon: 'insights', ver: 'v2', match: ['/design-intel', '/design-intelligence', '/design-intelligence.html'] },
    { group: 'Data Analysis', icon: 'analysis', gid: 'dataanalysis', ver: 'v2', match: ['/data-analysis', '/data-analysis.html', '/analytics', '/dashboard.html', '/rfm', '/d2c-review', '/business-review', '/usa-d2c-report', '/usa-d2c-dashboard'], children: [
      { id: 'da-control',  label: 'Control Room',                  href: '/data-analysis?tab=control',              icon: 'analysis' },
      { id: 'da-acq',      label: 'Acquisition · Ads + LP',        href: '/data-analysis?tab=acq',                  icon: 'insights' },
      { id: 'da-ret',      label: 'Retention · Mailer + LP',       href: '/data-analysis?tab=ret',                  icon: 'insights' },
      { id: 'da-cohort',   label: 'Cohorts & Calendar',            href: '/data-analysis?tab=cohort',               icon: 'cohort' },
      { id: 'da-liveads',  label: 'Live Ads (Meta/Google/TikTok)', href: '/data-analysis?tab=live-ads',             icon: 'ads' },
      { id: 'da-mailer',   label: 'Mailer Intelligence',           href: '/data-analysis?tab=mailer-intelligence',  icon: 'insights' },
      { id: 'da-landing',  label: 'Landing Pages & Experiments',   href: '/data-analysis?tab=landing-intelligence', icon: 'landing' },
      { id: 'da-actions',  label: 'Actions & Outcomes',            href: '/data-analysis?tab=action-outcomes',      icon: 'insights' },
      { id: 'da-alerts',   label: 'Alert Settings',                href: '/data-analysis?tab=alert-settings',       icon: 'insights' },
      { id: 'da-review',   label: 'Sales & Business Review',       href: '/data-analysis?tab=review-overview',      icon: 'analysis', match: ['/d2c-review', '/business-review', '/usa-d2c-report', '/usa-d2c-dashboard'] },
    ]},
    { group: 'Cohorts', icon: 'cohort', gid: 'cohorts', ver: 'v1', children: [
      { id: 'coh-overview',   label: 'Overview',            href: '/cohorts?tab=overview',   icon: 'cohort' },
      { id: 'coh-engagement', label: 'Engagement Cohorts',  href: '/cohorts?tab=engagement', icon: 'insights' },
      { id: 'coh-englevel',   label: 'Engagement Levels',   href: '/cohorts?tab=englevel',   icon: 'insights' },
      { id: 'coh-product',    label: 'Product Cohorts',     href: '/cohorts?tab=product',    icon: 'cohort' },
      { id: 'coh-lifecycle',  label: 'Lifecycle Stages',    href: '/cohorts?tab=lifecycle',  icon: 'cohort' },
      { id: 'coh-rfm',        label: 'RFM Segments',        href: '/cohorts?tab=rfm',        icon: 'analysis' },
      { id: 'coh-behavioral', label: 'Behavioral',          href: '/cohorts?tab=behavioral', icon: 'cohort' },
    ]},
    { id: 'avatars', label: 'Avatars (Personas)', href: '/avatars', icon: 'avatars', ver: 'v2', match: ['/avatars', '/personas', '/avatars.html'] },

    { section: 'Plan' },
    // Automated Calendar Creation — the ONE calendar + asset-generation feature.
    // A single flat feature, NO sub-items: it combines the best logic of the
    // former Smart Brain engine, the Mailer Calendar and the Plan Calendar into
    // one automated calendar that plans every slot and pre-builds its full asset
    // bundle (mailer + ads + landing page). The older calendar surfaces stay
    // reachable by URL but are no longer separate nav features; this one
    // feature's match[] also lights up for them.
    { id: 'brain', label: 'Smart Brain', href: '/brain', icon: 'calendar', ver: 'v2', match: ['/brain', '/smart-brain', '/smart-brain.html', '/mailer-calendar', '/lifecycle-calendar.html', '/calendar.html', '/plan'] },
    { id: 'retentionplaybook', label: 'Retention Playbook', href: '/retention-playbook', icon: 'calendar', ver: 'v2', match: ['/retention-playbook', '/retention-playbook.html'] },
    // UK Non-Engagers Hub removed from the user-facing nav (route /uk-non-engagers
    // stays reachable directly); it is no longer a raw nav item.

    { section: 'Design & Create' },
    { id: 'frameworks', label: 'Frameworks', href: '/frameworks', icon: 'kb', ver: 'v2', match: ['/frameworks', '/frameworks.html'] },
    // Mailer Studio is an OPEN feature — works standalone without sign-in.
    { id: 'studio', label: 'Mailer Studio',   href: '/studio', open: true, icon: 'studio', ver: 'v1', draft: 'Draft 1', match: ['/studio', '/lifecycle_mailer_architect_v34.html', '/app', '/mailer'] },
    // Independent LHS item (product-owner request 2026-07-25): the master ads
    // knowledge base + performance dashboard compiled from the KT handover
    // (emails, spend workbook, social update deck) + live connector reads.
    { id: 'adsmaster', label: 'Ad Campaigns Master Dashboard', href: '/ads-master', icon: 'ads', ver: 'v2', match: ['/ads-master', '/ad-campaigns-master', '/ads-kb', '/ad-campaigns-master.html'] },
    { group: 'Ad Campaigns', icon: 'ads', gid: 'ads', ver: 'v1', children: [
      { id: 'ads-perf',    label: 'Ad Performance', href: '/ads-dashboard', icon: 'analysis', ver: 'v2', match: ['/ads-dashboard', '/ad-performance', '/ads-dashboard.html'] },
      { id: 'ads-cal',     label: 'Calendar',   href: '/ad-campaigns.html#calendar', icon: 'calendar' },
      { id: 'ads-meta',    label: 'Meta Ads',   href: '/ad-campaigns.html#meta',     icon: 'meta' },
      { id: 'ads-google',  label: 'Google Ads', href: '/ad-campaigns.html#google',   icon: 'google' },
      { id: 'ads-tiktok',  label: 'TikTok Ads', href: '/ad-campaigns.html#tiktok',   icon: 'tiktok' },
    ]},
    { group: '3D Storefront & Websites', icon: 'landing', gid: 'landing', ver: 'v2', match: ['/3d', '/storefront-3d', '/storefront-3d.html', '/shop-3d', '/store-3d', '/official-designs', '/official-designs.html', '/designs'], children: [
      { id: 'store3d-all', label: '3D Storefront (overview)', href: '/3d', icon: 'knickgasm', match: ['/3d', '/storefront-3d', '/storefront-3d.html', '/shop-3d'] },
      { id: 'web-us',     label: '🇺🇸 US Website',     href: '/3d/us',     icon: 'knickgasm', match: ['/3d/us', '/store-3d-us'] },
      { id: 'web-uk',     label: '🇬🇧 UK Website',     href: '/3d/uk',     icon: 'knickgasm', match: ['/3d/uk', '/store-3d-uk'] },
      { id: 'web-global', label: '🌍 Global Website',  href: '/3d/global', icon: 'knickgasm', match: ['/3d/global', '/store-3d-global'] },
      { id: 'web-india',  label: '🇮🇳 India Website',  href: '/3d/in',     icon: 'knickgasm', match: ['/3d/in', '/3d/india', '/store-3d-in'] },
      { id: 'lp-overview', label: 'Design References', href: '/website-designs', icon: 'landing', match: ['/website-designs', '/website-designs.html'] },
      { id: 'lp-templates', label: 'Landing Page Templates', href: '/landing-page-templates', icon: 'landing', match: ['/landing-page-templates', '/templates', '/template-gallery', '/template-gallery.html'] },
      { id: 'lp-best',    label: '★ Live: Agent Page', href: '/lp/best',  icon: 'knickgasm', match: ['/lp/best'] },
      { id: 'lp-best-3d', label: '★ 3D Agent Page (motion)', href: '/lp/best-3d', icon: 'knickgasm', match: ['/lp/best-3d'] },
      { id: 'lp-agent',   label: 'Landing Page with All-In-One Voice+Chat+Talk Agent',   href: '/lp/agent', icon: 'knickgasm', match: ['/lp/agent'] },
      { id: 'lp-mailers', label: 'For Mailers',    href: '/landing-pages.html#mailers',  icon: 'mailer' },
      { id: 'lp-meta',    label: 'For Meta Ads',   href: '/landing-pages.html#meta',     icon: 'meta' },
      { id: 'lp-google',  label: 'For Google Ads', href: '/landing-pages.html#google',   icon: 'google' },
      { id: 'lp-tiktok',  label: 'For TikTok Ads', href: '/landing-pages.html#tiktok',   icon: 'tiktok' },
    ]},

    { id: 'music', label: 'Music (Official Songs)', href: '/music', icon: 'knickgasm', ver: 'v2', match: ['/music', '/music.html'] },

    { section: 'Share & Track' },
    { id: 'social', label: 'Social Media OS', href: '/social', icon: 'social', ver: 'v2', match: ['/social', '/social-media', '/social-media.html'] },
    { id: 'assets', label: 'Created Assets', href: '/assets', icon: 'analysis', ver: 'v1', match: ['/assets', '/assets.html'] },
    { group: 'TeleSuite', icon: 'avatars', gid: 'telesuite', ver: 'v2', match: ['/telesuite', '/telesuite.html'], children: [
      { id: 'ts-home',       label: 'TeleSuite Home',           href: '/telesuite#home',                       icon: 'home' },
      { id: 'ts-products',   label: 'Products',                 href: '/telesuite#products',                   icon: 'kb' },
      { id: 'ts-kb',         label: 'Knowledge Base',           href: '/telesuite#knowledge-base',             icon: 'kb' },
      { id: 'ts-pitch',      label: 'AI Pitch Generator',       href: '/telesuite#pitch-generator',            icon: 'insights' },
      { id: 'ts-rebuttal',   label: 'AI Rebuttal Assistant',    href: '/telesuite#rebuttal-generator',         icon: 'insights' },
      { id: 'ts-transcribe', label: 'Audio Transcription',      href: '/telesuite#transcription',              icon: 'avatars' },
      { id: 'ts-transdb',    label: 'Transcription DB',         href: '/telesuite#transcription-dashboard',    icon: 'analysis' },
      { id: 'ts-scoring',    label: 'AI Call Scoring',          href: '/telesuite#call-scoring',               icon: 'insights' },
      { id: 'ts-scoredb',    label: 'Call Scoring DB',          href: '/telesuite#call-scoring-dashboard',     icon: 'analysis' },
      { id: 'ts-combined',   label: 'Combined Call Analysis',   href: '/telesuite#combined-call-analysis',     icon: 'insights' },
      { id: 'ts-combineddb', label: 'Combined Analysis DB',     href: '/telesuite#combined-call-analysis-dashboard', icon: 'analysis' },
      { id: 'ts-vsales',     label: 'AI Voice Sales Agent',     href: '/telesuite#voice-sales-agent',          icon: 'avatars' },
      { id: 'ts-vsalesdb',   label: 'Voice Sales DB',           href: '/telesuite#voice-sales-dashboard',      icon: 'analysis' },
      { id: 'ts-vsupport',   label: 'AI Voice Support Agent',   href: '/telesuite#voice-support-agent',        icon: 'avatars' },
      { id: 'ts-vsupportdb', label: 'Voice Support DB',         href: '/telesuite#voice-support-dashboard',    icon: 'analysis' },
      { id: 'ts-deck',       label: 'Training Material Creator',href: '/telesuite#create-training-deck',       icon: 'kb' },
      { id: 'ts-deckdb',     label: 'Material DB',              href: '/telesuite#training-material-dashboard',icon: 'analysis' },
      { id: 'ts-data',       label: 'AI Data Analyst',          href: '/telesuite#data-analysis',              icon: 'analysis' },
      { id: 'ts-datadb',     label: 'Data Analysis DB',         href: '/telesuite#data-analysis-dashboard',    icon: 'analysis' },
      { id: 'ts-batch',      label: 'Batch Audio Downloader',   href: '/telesuite#batch-audio-downloader',     icon: 'kb' },
      { id: 'ts-activity',   label: 'Global Activity Log',      href: '/telesuite#activity-dashboard',         icon: 'analysis' },
      { id: 'ts-clone',      label: 'Clone Full App',           href: '/telesuite#clone-app',                  icon: 'studio' },
      { id: 'ts-n8n',        label: 'n8n Workflow',             href: '/telesuite#n8n-workflow',               icon: 'studio' },
    ]},

    { section: 'Assistants' },
    // KicksGPT (internal team chat/info tool) and Knickgasm Agent (customer-facing
    // concierge) are conversational assistants and stay here. The former Smart
    // Brain moved to Plan and was renamed Automated Calendar Creation — it is a
    // calendar-creation feature, not a chat assistant, so it no longer lives here.
    { id: 'kicksgpt', label: 'Brand Assistant',   href: '/kicksgpt', icon: 'knickgasm', ver: 'v1', match: ['/kicksgpt', '/kicks', '/ask', '/kicksgpt.html'] },
    { id: 'agent',   label: 'Brand Agent', href: '/agent',   icon: 'knickgasm', ver: 'v1', match: ['/agent', '/agent.html'] },

    { section: 'Settings' },
    { id: 'connectors', label: 'Connectors', href: '/connectors', icon: 'insights', ver: 'v2', match: ['/connectors', '/connectors.html'] },
    { id: 'accessissues', label: 'Access Issues', href: '/access-issues', icon: 'insights', ver: 'v2', match: ['/access-issues', '/access', '/access-issues.html'] },

    // ── "Aman's version" (aka "Aman's code") — the frozen 3 Jul 2026 build ──
    // Hidden from the rail per product-owner request, but KEPT as a feature: the
    // code still lives under /diff-version and is reachable by direct URL. If the
    // owner refers to "Aman's code" / "Aman's version" anywhere, it means THIS
    // frozen snapshot. Uncomment the two lines below to restore it to the menu.
    // { section: 'Archive' },
    // { id: 'diffversion', label: "Aman's version", href: '/diff-version', icon: 'insights', ver: 'v2', draft: "Aman's code — frozen 3 Jul 2026 build", match: ['/diff-version', '/diff-version.html', '/diff-version/pages/mailer-calendar.html', '/diff-version/pages/uk-non-engagers.html', '/diff-version/pages/social-media.html'] },
  ];

  // ─── Feature IA (standing rule — see CLAUDE.md "LHS navigation IA rule") ──
  // EVERY feature item in this menu expands into the SAME five sub-items, in
  // this exact order: 1 What does it do? · 2 Who is it for? · 3 How does it
  // work? · 4 Input · 5 Step-by-Step Working. For content-producing features
  // (mailers, ads, landing pages, campaign plans) step 5 maps to the
  // multi-agent pipeline: Ideology → Data analysis + review + hypothesis →
  // Business & strategy decisions → Content → Design + layout + structure →
  // Audio/Video (where applicable) → Coding → Final compilation + presentation.
  // Content rules: double-quoted strings only (apostrophes are fine, never use
  // a double quote or backtick inside), text positions only (never attributes).
  const SUBQ = [
    ['what',  'What does it do?'],
    ['who',   'Who is it for?'],
    ['how',   'How does it work?'],
    ['input', 'Input'],
    ['steps', 'Step-by-Step Working'],
  ];
  // Each entry: { title, what, who, how, input, steps:[[name, detail, runsVia?]…], pipeline?:true }
  const INFO = {
    // Home is a plain landing link, not a content-producing feature, so it
    // deliberately has NO 5-sub-item IA entry — it renders as a simple link.
    brandinput: {
      title: 'Brand Kit',
      what: "The single brand-truth record for the platform: the four-colour palette, the two type families, the voice (tone, tagline, do and banned lists) and the footer identity blocks. Every generator in the OS reads this one record, so it is the place brand truth is set once instead of being retyped into each feature.",
      who: "The brand owner. Brand Setup (/onboarding) is where a NEW brand workspace is created and activated - this page is where the active brand's kit is fine-tuned afterwards.",
      how: "Reads and writes the lifecycle_brand_kit singleton in Supabase through /api/kb?action=brand-kit. Colours are validated as #RRGGBB and the body-text-on-background pair is contrast-checked against WCAG AA before a save is allowed to look healthy. The Verify panel compares the saved palette against the prompt-side brand block in api/_shared/master-prompt.js and flags drift, because generated copy reads that block rather than the database.",
      input: "Four hex colours, two font families with their CSS stacks, a tone line and tagline, the do and banned phrase lists, and the footer legal, contact and social values.",
      steps: [
        ['Ideology', 'One brand record, many consumers: never let a second copy of brand truth exist.'],
        ['Data analysis + review + hypothesis', 'Loads the saved singleton and compares it against the live store theme and the prompt block.'],
        ['Business & strategy decisions', 'The do and banned lists become the enforced gates every generated asset is scrubbed against.'],
        ['Content', 'Tone, tagline and the word lists feed straight into every generation prompt.'],
        ['Design + layout + structure', 'Palette and typography drive mailer, ad and landing-page rendering; the live preview shows the pairing before saving.'],
        ['Coding', 'Persisted via /api/kb?action=brand-kit (GET reads, POST upserts) - no thirteenth serverless function, it extends the existing KB router.'],
        ['Final compilation + presentation', 'Saved values are what the next generated asset uses. Runs via: /api/kb?action=brand-kit'],
      ],
    },
    appaudit: {
      title: 'Overall App Audit',
      what: "A live quality scorecard for the whole OS. Every feature is rated on four axes — accuracy (is the output factually true, no fabrication), implementation (code robustness), execution (does it work end-to-end in production), and results (does it drive a usable outcome). The confidence bar is 9.5: nothing is 'done' below it.",
      who: "The product owner and the growth team, as the single place to judge whether the app is trustworthy enough to run the brand.",
      how: "Scores come from deep code audits (file-level findings), not impressions. The page computes an overall from the audited features, surfaces the three systemic blockers that cap quality (fabrication, the stale prod key, and the missing Klaviyo/Shopify feeds), and lists the roadmap that lifts each feature to 9.5.",
      input: "Nothing to enter — it reads the recorded audit. The full written audit is downloadable as Markdown for offline analysis.",
      steps: [
        ['Ideology', 'Real-only, zero-fabrication quality: a feature is only as good as the truth of what it ships.'],
        ['Data analysis + review + hypothesis', 'Deep per-feature code audits produce file-level findings and four-axis scores.'],
        ['Business & strategy decisions', 'The three systemic blockers are identified and prioritised by blast radius.'],
        ['Content', 'Each feature gets a plain-English gap note: what to fix to reach 9.5.'],
        ['Design + layout + structure', 'Scores render as a ring + per-feature axis bars, colour-coded by threshold.'],
        ['Compilation + presentation', 'An overall rating, the blocker board, the scorecard and the roadmap, plus a downloadable Markdown audit.', '/audit']
      ]
    },
    adsmaster: {
      title: "Ad Campaigns Master Dashboard",
      what: "The single source of truth for the USA paid ads program (Target + Costco): a performance dashboard over the KT spend workbook (125 Meta ads, 13 campaigns, May to 20 Jul) plus the complete ads knowledge base - every sheet, deck, drive folder and platform link from the KT emails as single-click links, the creative learnings from the Social Update deck, benchmarks, the UGC-dashboard automation runbook, the Costco dark-post launch config, owners and open gaps. Zero fabrication: every figure cites its KT source or a live connector read.",
      who: "The paid ads team and anyone onboarding onto the ads program - it IS the knowledge transfer, in product form.",
      how: "Live-first, snapshot-honest: Live Now, Calendar and Tracker read /api/brain?action=ads-live, which unions BOTH live US Meta ad accounts (the DTC account and the Target/Costco retail account) from the warehouse and treats today as a partial day; when no live source is configured the page falls back to a committed snapshot and labels it as one. The Accounts tab renders the whole ad-account studio from data/ads/ad-accounts.json, built from the single registry in api/_shared/ads-snowflake-core.js. Knowledge comes from data/ads/master-kb.json and the ad-level export. Links that could not be resolved from this account are listed as pending-access with their owner, never invented.",
      input: "Nothing to enter. Filters: objective, delivery status, free-text search, sort metric on the ads table; group, status and search on the knowledge base. New KT files extend master-kb.json.",
      steps: [
        ["Ideology", "One master surface for the ads program: knowledge (links, owners, runbooks) and performance (spend, benchmarks, verdicts) belong together."],
        ["Data analysis + review + hypothesis", "KT files parsed (3 email threads, spend workbook, 28-slide social deck); rollups computed per campaign and objective; benchmarks derived from the data."],
        ["Business & strategy decisions", "Portfolio verdicts: Sales engine clears the $0.80 bench, JoinBrands UGC traffic is the cheapest click, Awareness is the drag, July TikTok reads zero. Accounts are scored on what each can actually measure - ROAS only where a pixel or Google conversion fires, CTR/CPC/CPM where checkout happens on target.com, Instacart or amazon.com and no sale can ever be attributed back to the ad."],
        ["Content", "Knowledge base compiled: 54 catalogued links (verified via the Google Drive connector where possible), people map, gaps register."],
        ["Design + layout + structure", "Eleven tabs - Live Now, Calendar, Tracker, Accounts, SOP, Overview, Campaigns & Ads, Creative Intel, Organic & UGC, Knowledge Base, Ops & Data Sources - in the brand palette, white and green only, every table sortable and filterable and every chart carrying duration tiles."],
        ["Coding", "Static page + committed JSON (no new serverless function; the Hobby 12-function limit is untouched).", "/ads-master"],
        ["Final compilation + presentation", "Live Snowflake rows via the Ads Analysis page; Google Slides KT presentation generated from the same knowledge base.", "/ads-dashboard"]
      ]
    },
    kicksgpt: {
      title: 'Brand Assistant',
      what: "INTERNAL TOOL, for the active brand's team only (not customer-facing). The brand assistant is the ACTIVE brand's own LLM: a conversational operator that actually RUNS the growth stack instead of just chatting: it queries analytics, reads competitor benchmarks, searches the knowledge base, and can generate calendars and campaign assets on explicit request.",
      who: "The operator (growth and retention team). Its recommendations span every cohort — the nine RFM segments (Champions through Lost) and the UK engagement cohorts (Non-Buyers/Non-Engagers and T&B Buyers/Non-Engagers).",
      how: "A provider-agnostic tool-calling loop: the model emits strict JSON actions, the server executes them against the same _shared cores the public API routes use, feeds results back, and loops (default 5 steps, up to 3 tools in parallel). Because tool calls are plain JSON, it works across the whole 6-provider text waterfall, including free tiers. An evidence contract forces every recommendation to quote exact tool-sourced figures.",
      input: "A plain-English question or instruction in the chat. Write and generate tools (generate_calendar, generate_assets_for_slot, run_agentic_campaign, klaviyo) fire only when you explicitly ask.",
      steps: [
        ['Prompt', 'You ask a question; the loop pins the first live LLM provider so later steps skip dead keys.', '/api/brain?action=brand-chat'],
        ['Plan a tool call', 'The model emits a strict JSON action — one tool, or a batch of up to 3 run in parallel.'],
        ['Execute tools', 'ask_analytics · run_analysis · list_cohorts · get_calendar · get_competitor_benchmarks · search_knowledge_base · list_campaigns · klaviyo — each reuses the exact logic behind the public routes.', '/api/brain?action=brand-tools (manifest)'],
        ['Loop on evidence', 'Results feed back into the conversation; repeated tool+args calls are deduped; up to 5 reasoning steps.'],
        ['Final answer', 'A final action with exact figures, target metric and expected impact, a complete hypothesis, and competitor benchmarks — shown with the full tool trace.'],
      ],
    },
    brain: {
      title: 'Smart Brain',
      what: "The one calendar feature of the OS — it combines the automated engine (formerly Smart Brain), the Cohort Mailer Calendar (Draft 2) and the 30-Day Plan Calendar (Draft 1). It maintains a rolling 90-day campaign plan in Supabase (smart_calendar_entries), refreshes it every morning by diff — never a wholesale rewrite — and turns every human-approved slot into a complete campaign: mailer + Meta/Google/TikTok ads + a landing page.",
      who: "Every customer cohort gets slots — RFM segments and engagement cohorts alike. The lifecycle team supervises: nothing ships without a human approve.",
      how: "Six services run in sequence — KB, Analysis, Competitor, Calendar, Generation, Review. A daily Vercel Cron (03:30 UTC, CRON_SECRET-protected) syncs the plan; the console at /brain lists tentative slots for approve/reject; approving generates all assets and mirrors them into ads_generated and landing_pages_generated. Platform push is Phase 2 (push_status: not_integrated_phase_2).",
      input: "Nothing daily — the cron drives it. From you: approve or reject decisions per slot, plus optional feedback that recalibrates future planning.",
      pipeline: true,
      steps: [
        ['Ideology', 'Each slot starts as a campaign concept — the occasion, the angle, the single idea the send must carry. Maximum ideation before any data is touched.'],
        ['Data analysis + review + hypothesis', 'The KB, Analysis, and Competitor services pull owned assets, RFM and cohort signals, and competitor benchmarks, then state a testable hypothesis per slot.', '/api/calendar?action=smart-brain-sync-daily'],
        ['Business & strategy decisions', 'The Calendar service decides cohort, product focus, offer mechanic, and send date — diff-updating the rolling 90-day plan.', '/api/calendar?action=smart-brain-plan'],
        ['Content', 'On approval, the Generation service LLM-writes the mailer copy plus Meta, Google, and TikTok ad copy.', '/api/calendar?action=smart-brain-approve'],
        ['Design + layout + structure', 'Brand-gated templates apply the 4-colour palette and Montserrat / Instrument Sans; hero creative comes from the image cascade.'],
        ['Coding', 'Assets compile to production HTML — a Klaviyo-ready mailer and a landing page served at /lp/:campaignId.'],
        ['Final compilation + presentation', 'The Review service scores the output; everything is mirrored into ads_generated and landing_pages_generated and presented in the /brain console.', '/api/brain?action=cron (daily)'],
      ],
    },
    agent: {
      title: 'Brand Agent',
      what: "CUSTOMER-FACING TOOL, the concierge your customers talk to. A conversational concierge: talk (text or voice) to an expert in the active brand that answers product questions and recommends only that brand's real catalogue. It is also the engine embedded in the agent landing pages at /lp/agent and /lp/best.",
      who: "Prospective and existing customers on-site; strongest for Non-Buyers who need guidance to a first purchase. The team uses this page to configure and demo agents.",
      how: "A chat UI over the shared 6-provider LLM waterfall, grounded in brand voice and the product catalog. Voice replies use ElevenLabs TTS with a browser-TTS fallback. Agent personas can be created, updated, and synced from this page.",
      input: "A visitor question — preferences, goals, or gifting needs. For the team: agent persona settings.",
      steps: [
        ['Ask', 'The visitor describes what they want — calm evenings, a coffee alternative, a gift.', '/api/brain?action=agent-chat'],
        ['Ground', 'The agent answers in brand voice, grounded in real catalog products and regional store URLs.'],
        ['Recommend', 'It proposes specific products with honest pricing and lacing guidance.'],
        ['Speak', 'Optional voice output via ElevenLabs, falling back to the browser voice.', '/api/brain?action=tts'],
        ['Convert', 'CTAs deep-link to the right regional store product page (US/UK/EU/AU/IN).'],
      ],
    },
    analysis: {
      title: 'Data Analysis',
      what: "The full D2C growth analytics workbench, built on the live US and UK market exports. A dashboard of every analysis a growth team needs — revenue and AOV trends, sales by channel, product type and day of week, discount exposure, new-vs-returning split, returning-customer rate, customer acquisition, cohort retention, and top products — with a US/UK market toggle. Every widget drills into a detailed page with the complete data table, a bigger chart, a growth read, and a CSV download. The legacy RFM Retention Intelligence tool (upload-and-score) still lives at /rfm.",
      who: "The growth and retention team. The dashboard analyses the whole customer base and every revenue cut; the drill-downs and cohort heatmap feed cohort, RFM and lifecycle targeting used everywhere else in the OS.",
      how: "Data is compiled from the exported market CSVs (data/market/{us,uk}) by scripts/build-market-analytics.js into a single client-side module, so the dashboard renders real numbers with no upload and no server round-trip. The upstream ingestion and DuckDB engine that produces these exports is the DTC Data Engine, surfaced natively in-app at /data-engine. The RFM tool at /rfm still parses uploaded CSV/XLSX in the browser and scores the nine RFM segments.",
      input: "Nothing to upload for the dashboard — it reads the compiled market exports. Pick the market (US or UK) and open any widget to drill in and download its CSV. For the RFM tool: CSV/XLSX order and customer exports.",
      steps: [
        ['Compile', 'Market CSV exports are compiled into a self-contained data module by scripts/build-market-analytics.js.', 'scripts/build-market-analytics.js'],
        ['Overview', 'KPI tiles and a widget grid render trends, mix, retention and top products for the selected market.'],
        ['Drill in', 'Any widget opens a detailed page: full data table, larger chart, and a concrete growth read.'],
        ['Cohort read', 'The retention heatmap normalises each acquisition quarter to 100% so LTV assumptions and sticky cohorts are visible.'],
        ['Hand off', 'Cuts feed cohort, RFM and lifecycle targeting; the RFM tool at /rfm scores uploaded data for the segment lens.'],
      ],
    },
    music: {
      title: 'Music (Official Songs)',
      what: "The library of the active brand's official music: the branding track (with lyrics) that plays in-app and drops into ad creatives, social videos and landing pages as a native, brand-owned audio and video bed.",
      who: "Anyone producing outward-facing content: ad creatives, Social Media OS videos, landing pages and event assets that need on-brand, cleared audio.",
      how: "A self-contained page that streams each official track, and exposes a Use-in-ad action that copies the hosted asset URL and hands off to the Ad Campaigns builder. Tracks are served from /assets/media and are usable anywhere in the OS.",
      input: "Nothing to upload, the official tracks are bundled with the app. From you: pick a track, preview it, then copy its URL, copy an embed snippet, or download it for the creative you are building.",
      steps: [
        ['Ideology', 'Brand music carries the Feel Alive voice into sound: warm, sensory, heritage-led.'],
        ['Content', 'The branding track (with lyrics) is the first official song; more can be added to the same library.'],
        ['Audio/Video', 'Stream and preview in-app; the file is the brand-owned audio and video bed for ads and social.'],
        ['Coding', 'Served natively from /assets/media; copy the hosted URL or an embed snippet, or download for the target creative.', '/music'],
        ['Compilation', 'Drop it into an ad creative or social post via the Ad Campaigns builder.', '/ads'],
      ],
    },
    research: {
      title: 'Market Study',
      what: "The single narrative reference for how the active brand grows: brand truth, the US and UK market intelligence, live performance pulled from the market exports, the four buyer avatars and the cohort model, the retention operating principles, the growth plays currently running, and the data engine underneath it all. It is the connective story that the operational features read from.",
      who: "The whole growth and retention team. It frames every cohort and avatar the OS targets, and turns the raw analytics into prioritised, named growth plays.",
      how: "A self-contained page organised into tabs: Overview, Brand Foundation, Market Intelligence, Live Performance (real numbers from the compiled market data), Growth Plays, Retention Playbooks (the knowledge/retention library), and Data Engine. It links out to Avatars, Cohorts, and the Data Analysis workbench, and cites the market study, schemas and retention config.",
      input: "Nothing to upload — the book compiles the market exports and the brand knowledge base. From you: read it before planning, and use its growth plays and avatar/cohort mapping to brief every campaign.",
      steps: [
        ['Brand truth', 'Positioning, voice, palette and lexicon set the non-negotiable creative frame.'],
        ['Market intelligence', 'US coffee and functional-beverage sizing, benchmarks and the competitor brand matrix set the opportunity.'],
        ['Live performance', 'Real US and UK numbers ground every claim; the full workbench is one click away.', '/data-analysis'],
        ['Growth plays', 'The prioritised, data-grounded moves, each mapped to an avatar and cohort.'],
        ['Data engine', 'The ingestion and competitor-capture pipeline (knickgasm_dtc_data_engine) that feeds every number.'],
      ],
    },
    avatars: {
      title: 'Avatars (Personas)',
      what: "The customer-persona layer of the OS: named, hyper-specific buyer avatars built on top of the cohort dictionary and the US coffee and functional-beverage market study. Each avatar bundles demographics, geography, price elasticity, core value driver, and churn triggers into one face a brief can target, so copy, imagery, and offers stay grounded in a real person rather than an abstract segment.",
      who: "The growth and creative team. The avatars translate the analytics cohorts (RFM segments, engagement cohorts, lifecycle stages) into behavioural buyer profiles for the active brand — e.g. the Identity Buyer, the Habitual Loyalist, the Gifting Connector, and the Curious Switcher.",
      how: "Personas are derived from the market-intelligence study (docs/market-intelligence) and the cohort model: each avatar maps to specific cohorts, carries hard planning numbers (age band, HHI, AOV, LTV:CAC, reactivation likelihood), and links to the schema that captures the same fields on a live profile (schemas/cohort-profile.json) and the retention triggers that fire for it (config/retention-triggers.yaml). Use the avatar name verbatim in a brief and every downstream tool inherits its targeting.",
      input: "Nothing to upload — the avatars are curated from the market study and the cohort dictionary. From you: pick the avatar a campaign targets, and read its value driver, elasticity, and churn triggers before writing the brief.",
      steps: [
        ['Read the market', 'The US coffee and functional-beverage landscape (TAM/SAM/SOM, brand matrix, regional matrix) frames who is worth winning and how they behave.'],
        ['Map to cohorts', 'Each avatar is pinned to the RFM segments, engagement cohorts, and product cohorts it represents, so it inherits real audiences.'],
        ['Load the profile fields', 'Demographics, geography, price elasticity, value driver, reactivation likelihood, and churn triggers are stated as hard planning numbers.'],
        ['Wire the triggers', 'The retention-trigger config names which automated webhooks fire for the avatar (churn risk, replenishment, win-back, VIP early access).'],
        ['Target in a brief', 'Name the avatar in any campaign and the mailer, ad, landing-page, and social tools inherit its voice, imagery, offer sensitivity, and cohort.'],
      ],
    },
    assets: {
      title: 'Created Assets',
      what: "The output shelf: every asset this OS has produced — mailers, Meta/Google/TikTok ads, landing pages — collected in one browsable place with previews, so finished work never gets lost in the tool that made it.",
      who: "The operator and reviewer. Each asset targets whichever cohort its originating campaign or slot was planned for.",
      how: "It reads the generation logs and stores the creation tools write to (mailer logs, the ads store, per-channel landing-page stores) and lists everything with preview, clone, and re-prompt affordances.",
      input: "Nothing to create here — the shelf fills up as Mailer Studio, Ad Campaigns, Landing Pages, and Smart Brain approvals produce work.",
      steps: [
        ['Collect', 'Assets register themselves as the creation tools save their output.'],
        ['Browse', 'Filter by type and channel — mailers, ads per platform, landing pages.'],
        ['Preview', 'Open any asset exactly as it will render.'],
        ['Reuse', 'Clone or re-prompt an asset back into its creation tool for the next iteration.'],
      ],
    },
    kb: {
      title: 'Knowledge Base',
      what: "The active brand's own reference library: our mailers, Meta/Google/TikTok ads, and landing pages, ingested and classified so every generator in this OS can ground itself in what the brand has actually shipped.",
      who: "The generation pipelines and the operator. It is not cohort-specific — it is the shared memory every cohort's campaigns draw on.",
      how: "A Supabase-backed router at /api/kb. Assets are ingested by URL with tags, classified by LLM, attributed to brands, and ranked; the page browses them by channel tab (Mailers / Meta / Google / TikTok / Landing Pages).",
      input: "URLs or captured emails to ingest, with tags. Bulk lists of top emails can be pushed in one call.",
      steps: [
        ['Ingest', 'Add an asset by URL with tags.', '/api/kb?action=ingest'],
        ['Classify', 'LLM classification tags each email with its angle, offer, and structure.', '/api/kb?action=classify-emails'],
        ['Brand-tag', 'Assets are attributed to brands, cross-referencing Competitor Benchmarking.', '/api/kb?action=brands'],
        ['Rank', 'Top-performing emails are ranked and kept fresh.', '/api/kb?action=top-emails'],
        ['Serve', 'Generators and the brand assistant search this library while writing new work.', '/api/kb?action=list'],
      ],
    },
    competitor: {
      title: 'Competitor Benchmarking',
      what: "Competitor intelligence: captures rival brands' marketing emails from a dedicated Gmail inbox into a Google Sheet, renders them for side-by-side study, and distils benchmarks — cadence, offer depth, creative angles. The competitor set is the ACTIVE brand's own universe. It also owns brand discovery.",
      who: "The strategy layer. Benchmarks feed the brand assistant's evidence contract, Smart Brain planning, and the human planner — informing campaigns for every cohort.",
      how: "One router dispatched by ?action=list|html|poll|sync. Poll reads the capture inbox over IMAP; parsed emails become rows (columns A–K) in the Google Sheet database; sync runs on a CRON_SECRET-protected schedule. Google auth is keyless via Workload Identity Federation (Vercel OIDC → Google STS → service-account impersonation), with a legacy JSON-key fallback.",
      input: "Subscribe the capture inbox to competitor newsletters — the system does the rest. Optionally add brands to discover and track.",
      steps: [
        ['Capture', 'Competitor emails arrive in the dedicated Gmail inbox, which is subscribed to rival brands.'],
        ['Poll', 'IMAP polling pulls new messages and parses brand, subject, offer, and full HTML.', '/api/competitor?action=poll'],
        ['Store', 'Each email becomes a row (columns A–K) in the Google Sheet via keyless WIF auth.', '/api/competitor?action=sync (cron)'],
        ['Browse', 'The page lists captured emails and renders their full HTML for study.', '/api/competitor?action=list · ?action=html'],
        ['Benchmark', 'Cadence, offer, and angle insights feed the brand assistant, Smart Brain, and human planning.'],
      ],
    },
    calendar: {
      title: 'Plan Calendar (30-day RFM plan)',
      what: "Generates a 30-day marketing calendar from your analytics: dated sends with segment, theme, offer mechanic, and a subject hint — festival-aware. Any planned row can be fed straight into mailer generation. This is Draft 1 (V1) of calendaring; Draft 2 is the Mailer Calendar (UK).",
      who: "The nine RFM segments from Data Analysis — Champions, Loyal, Promising, New, Need-Attention, About-to-Sleep, At-Risk, Hibernating, Lost.",
      how: "The page posts your analytics state to the calendar engine and renders the returned 30-day plan as a grid. Trigger-mailer feeds one row into the mailer engine for generation.",
      input: "Analytics state handed over from Data Analysis via localStorage (segments, insights), plus your date window.",
      pipeline: true,
      steps: [
        ['Ideology', 'Maximum ideation on themes: festivals, rituals, and seasonal moments the brand can own inside the window.'],
        ['Data analysis + review + hypothesis', 'RFM segment sizes, discount exposure, and recency curves define who is reachable and what each send must prove.'],
        ['Business & strategy decisions', 'Slots are allocated across segments and offer mechanics — frequency-capped, festival-aware, revenue-weighted.', '/api/calendar?action=generate'],
        ['Content', 'Each slot receives its campaign definition: audience, theme, angle, and subject hint.'],
        ['Final compilation + presentation', 'The 30-day grid renders; any row hands off to mailer generation in one click.', '/api/calendar?action=trigger-mailer'],
      ],
    },
    cohorts: {
      title: 'Cohorts',
      what: "The single source of truth for WHO we mail: explicit definitions of every audience — the nine RFM segments and the UK engagement cohorts — with their rules, objectives, and voice guides.",
      who: "It defines the cohorts themselves: RFM segments by recency/frequency thresholds (Champions through Lost), and the engagement cohorts — Cohort A: Non-Buyers/Non-Engagers, Cohort B: T&B Buyers/Non-Engagers.",
      how: "A reference page over the same definitions the planners consume. Lifecycle cohorts carry an objective, a voice guide, and a product-mix rotation (Cohort A is coffee-heavy at 4:1:1; Cohort B is T&B-first at 3:2:1).",
      input: "Nothing to use it. Definition changes are made in code and Supabase so every planner and generator inherits them consistently.",
      steps: [
        ['Define the rule', 'Each cohort is an explicit predicate — e.g. Champions = last order within 30 days AND 5+ orders; Cohort A = on the list, never purchased, not opening.'],
        ['Attach the objective', 'Every cohort carries its job — e.g. Cohort A: earn the open, earn the click, first purchase.'],
        ['Set the voice guide', 'Tone rules per cohort: no guilt or pressure for non-engagers; familiarity, never chasing, for lapsed buyers.'],
        ['Feed the planners', 'Calendar, Lifecycle Calendar, and Smart Brain all plan against these exact definitions.'],
      ],
    },
    studio: {
      title: 'Mailer Studio',
      what: "The main creation app: a 5-step wizard (Brief → Products → Generation → Review & Refine → Final HTML) that produces four mailer variants — A (Image · Hero close-up), B (Image · Lifestyle wide), T1 (Text · Editorial), T2 (Text · Founder note) — across 11 layout archetypes, with real catalog products and region-correct pricing. This is Draft 1 (V1) of mailer creation; Draft 2 is the Mailer Calendar's built mailers.",
      who: "Whatever cohort the brief targets — RFM segments handed over from the Calendar, or a manually described audience. Output is a compact (~1200–1500px) Klaviyo-ready HTML mailer.",
      how: "A multi-stage AI pipeline. Text runs through the 6-provider waterfall; images cascade Gemini native → Imagen → OpenAI gpt-image → Pollinations flux. Structural divergence between variants is forced (variant B always takes an alternate archetype). Brand gates enforce the 4-colour palette, Montserrat / Instrument Sans, and the banned-phrase list.",
      input: "A campaign brief (typed, AI-autofilled, or handed over from a calendar row), your market (US/UK/Global — selects catalog and currency), and product selections.",
      pipeline: true,
      steps: [
        ['Ideology', 'Max-creativity concepting: the brief expands into campaign concepts and suggested angles before anything is designed.', '/api/ai/generate (create_brief · concepts · suggested_prompts)'],
        ['Data analysis + review + hypothesis', 'Real catalog data (products, prices, handles) and analytics state ground every claim; each variant carries a hypothesis of why it should win.'],
        ['Business & strategy decisions', 'The strategy stage locks audience, offer mechanic, archetype per variant, and the success metric.', '/api/ai/pipeline/strategy'],
        ['Content', 'Variant copy is written — four structurally diverging variants, banned phrases blocked, brand voice enforced.', '/api/ai/pipeline/variant · /api/ai/generate (mailer_full)'],
        ['Design + layout + structure', 'One of 11 archetypes shapes the layout; hero imagery generates through the image cascade with catalog-aware prompts.', '/api/ai/pipeline/images · /api/ai/image'],
        ['Coding', 'Everything compiles to email-safe HTML — inline CSS, bulletproof CTAs, roughly two scrolls tall.', '/api/ai/pipeline/html'],
        ['Final compilation + presentation', 'Review & Refine critiques the result on four dimensions and presents final HTML to copy or download.', '/api/ai/pipeline/score'],
      ],
    },
    lifecycle: {
      title: 'Mailer Calendar (UK)',
      what: "The UK lifecycle mailer calendar: deterministically plans 14/30/45 days of sends for the two engagement cohorts by rotating a curated play library — then builds any planned send into a Klaviyo-ready mailer with exactly ONE brand-gated LLM call. This is Draft 2 (V2 — Lifecycle OS) of both calendaring and mailer creation; Draft 1 is the 30-day Calendar plus Mailer Studio.",
      who: "Cohort A — Non-Buyers/Non-Engagers (objective: earn the open, earn the click, first purchase) and Cohort B — T&B Buyers/Non-Engagers (objective: reactivate with familiarity, cross-grade to Coffee/Supplements subscription). UK market only (knickgasm.com).",
      how: "Two modes. PLAN is deterministic — no LLM: it rotates plays per cohort at your cadence (default 2/week), enforcing hard product rules (T&B is one-time only; Coffee and Supplements are subscription-first; supplements are never priced; no founder voice — templates restricted to pure/visual/editorial). BUILD makes one LLM call against locked facts and renders the brand template.",
      input: "Start date, plan window (14/30/45 days), cohort checkboxes, and sends-per-cohort-per-week. Nothing runs automatically — a human clicks Generate.",
      pipeline: true,
      steps: [
        ['Ideology', 'The play library IS the ideation layer: every play encodes a distinct psychological angle per cohort — story introduction, win-back, unboxing math, launch news.'],
        ['Data analysis + review + hypothesis', 'Every claim comes from locked facts — real UK handles, live prices and compare-at prices, the 7-gift list, the £105/year subscription gift value. Nothing outside the facts file may be claimed.'],
        ['Business & strategy decisions', 'The planner rotates product types by cohort mix (A coffee-heavy, B T&B-first), applies cadence and festival awareness, and enforces purchase-mode rules per product type.', '/api/calendar?action=lifecycle-generate'],
        ['Content', 'Build Mailer writes subject, preheader, and body in ONE brand-gated LLM call — banned phrases and founder voice hard-fail.', '/api/calendar?action=lifecycle-build-mailer'],
        ['Design + layout + structure', 'The play declares its template style (pure / visual / editorial), rendered in the 4-colour palette with Montserrat headings; optional hero creative via the image cascade.'],
        ['Coding', 'Output is a single centred 600px presentation table — all CSS inline, bulletproof CTAs, Klaviyo unsubscribe tags.'],
        ['Final compilation + presentation', 'Preview in a modal, copy the HTML, or download; built slots persist to Supabase (lifecycle_calendar_entries).', '/api/calendar?action=lifecycle-list'],
      ],
    },
    ukhub: {
      title: 'UK Non-Engagers Hub',
      what: "The Week-1 campaign hub for the UK non-engager program: 2 cohorts × 3 send slots × 2 creative variations = 12 finished, Klaviyo-paste-ready emails, with subject lines and preheaders parsed live from the actual email files.",
      who: "Cohort A — Non-Buyers/Non-Engagers and Cohort B — T&B Buyers/Non-Engagers. Sends are planned for 09:00 UK time.",
      how: "A static hub over the built email files (lifecycle-campaigns/2026-07-03_week1). Each slot offers V1 vs V2 — genuinely different psychological angles (e.g. sensory story vs question-led pattern-interrupt) — pick one or split-test. Preview, Copy HTML, and Download work per variation.",
      input: "None — the emails are pre-built against the locked facts file. You only choose which variation to ship.",
      steps: [
        ['Pick the slot', 'Six dated slots (Jul 3 / 6 / 9 × two cohorts), each with its objective spelled out.'],
        ['Compare angles', 'V1 vs V2 are distinct creative hypotheses, not copy tweaks — built for A/B testing.'],
        ['Preview', 'Renders the exact HTML in a modal iframe; subjects and preheaders are parsed live from each file.'],
        ['Copy or download', 'One click copies the full Klaviyo-ready HTML to the clipboard.'],
        ['Ship in Klaviyo', 'Paste into a Klaviyo campaign against the matching segment, scheduled for 09:00 UK.'],
      ],
    },
    ads: {
      title: 'Ad Campaigns',
      what: "Creates paid-social and search ad creatives — Meta, Google, TikTok — copy plus generated visuals, organised on its own calendar. Approved Smart Brain slots auto-generate their full ad set, mirrored into the ads_generated store.",
      who: "Prospecting and retargeting audiences per platform. Each ad set inherits the cohort of the campaign slot it came from.",
      how: "Per-platform tabs generate ad copy through the shared LLM waterfall and static creatives through the image cascade. Platform push is Phase 2 — assets are produced and reviewed here, not published automatically.",
      input: "A campaign or slot (from Smart Brain or the calendar tab), or a manual brief with product, platform, and audience.",
      pipeline: true,
      steps: [
        ['Ideology', 'Max-ideation on hooks and angles per platform — thumb-stopping concepts before any asset exists.'],
        ['Data analysis + review + hypothesis', 'Competitor ad benchmarks and owned KB assets define what to beat; every creative states the hypothesis it tests.'],
        ['Business & strategy decisions', 'Platform, audience, funnel stage, and offer mechanic are locked per ad set.'],
        ['Content', 'Platform-native copy — primary text, headlines, descriptions — in brand voice with banned phrases blocked.', '/api/ai/generate'],
        ['Design + layout + structure', 'Static creatives generate through the image cascade with catalog-aware prompts.', '/api/ai/image'],
        ['Audio/Video', 'Video ads: scripts and scene plans; video generation rungs are scaffolded to stub gracefully until keys exist.'],
        ['Coding', 'Assets are packaged to correct per-placement specs — ratios, durations, character limits.'],
        ['Final compilation + presentation', 'Everything mirrors into ads_generated for review; platform push remains Phase 2.', '/api/calendar?action=smart-brain-approve'],
      ],
    },
    landing: {
      title: 'Landing Pages',
      what: "Generates and serves brand-compliant HTML landing pages — presell and editorial pages matched to mailers and ads — including the live agent-embedded pages at /lp/best and /lp/agent.",
      who: "Traffic from each channel: pages exist for Mailers, for Meta, for Google, and for TikTok, inheriting the cohort of the campaign that links to them.",
      how: "Pages are LLM-generated to the /lp/:id serving contract, compiled by the LP compiler, stored in landing_pages_generated, and served live from the calendar router. Smart Brain approvals generate one automatically per campaign.",
      input: "A campaign or slot, or a manual brief: product, angle, source channel, and market.",
      pipeline: true,
      steps: [
        ['Ideology', 'Max-creativity page concepts: the presell narrative, the promise above the fold, the proof structure.'],
        ['Data analysis + review + hypothesis', 'Real product data and competitor landing-page intel ground every claim; each page states the conversion hypothesis it tests.'],
        ['Business & strategy decisions', 'Message matched to source channel and cohort — what the click was promised is what the page must deliver.'],
        ['Content', 'Long-form persuasion copy in brand voice — sensory, story-driven, no banned phrases.', '/api/ai/generate'],
        ['Design + layout + structure', 'Section architecture in the 4-colour palette with Montserrat / Instrument Sans; hero imagery via the image cascade.'],
        ['Coding', 'Compiles to a self-contained HTML page honouring the /lp/:id serving contract.'],
        ['Final compilation + presentation', 'Stored in landing_pages_generated and served live at /lp/:campaignId.', '/api/calendar?action=lp&id=…'],
      ],
    },
    officialdesigns: {
      title: 'Official Website Designs',
      what: "A true-to-brand 3D replica of the Knickgasm storefront and Meta-ads landers, rendered as a continuous WebGL scene of floating product panels and glassmorphic surfaces. Live catalog and pricing come from the regional Shopify storefront; historical metrics come from the Snowflake to Supabase daily mirror. It degrades automatically to a fast 2D brand layout on low-end, mobile, reduced-motion or crawler traffic so conversion is never sacrificed.",
      who: "Shoppers across the US, UK and Global regions, plus paid-social traffic landing on knickgasm.com and knickgasm.com — where the scene collapses into a single-product spatial checkout to minimise friction.",
      how: "The Knickgasm3DConnectorEngine (React context provider + data-orchestration middleware) resolves the region and lander from the hostname, connects Shopify and the Snowflake mirror, extracts the live theme colours and typography, injects them into the 3D materials and CSS custom properties, and renders the scene with three and react-three-fiber. Static pages mount the same engine through a no-build ESM bridge.",
      input: "Nothing from you at view time — the hostname decides region and lander mode. Operators can force a region or a 2D preview on the showcase page.",
      pipeline: true,
      steps: [
        ['Ideology', 'The spatial concept: floating mesh product panels over a unified viewport, brand-cloned lighting and surfaces.'],
        ['Data analysis + review + hypothesis', 'Shopify catalog and pricing are the live source; the Snowflake mirror supplies historical metrics that shape which products lead.', '/api/brain?action=snowflake-metrics'],
        ['Business & strategy decisions', 'Meta-ads landers isolate one product or bundle for zero-friction checkout; the full store shows the exploration constellation.'],
        ['Content', 'Product copy and pricing pulled live per region, formatted to the correct currency.'],
        ['Design + layout + structure', 'Live theme colours and Montserrat / Instrument Sans typography injected into shader uniforms and CSS variables for an exact brand replica.'],
        ['Coding', 'Rendered with three and react-three-fiber in the React app; mounted on static pages via the ESM bridge, with an automatic 2D fallback.', '/assets/knickgasm3d-bridge.js'],
        ['Final compilation + presentation', 'Served as the Official Website Designs showcase and reused inside landing-page templates.', '/official-designs'],
      ],
    },
    accessissues: {
      title: 'Access Issues',
      what: "A strictly read-only audit of Shopify account access and installed apps. It runs entirely in the browser over evidence you provide (user, role, group and activity CSV exports, an app register, login history, and HR/agency/contract context), aggregates effective access per user, and flags unnecessary users, excessive permissions, unused apps, duplicate functionality, security concerns, and avoidable cost. It emits findings and recommendations only.",
      who: "The operator and store owner. Read-only by architecture: it never authenticates to Shopify, never issues a GraphQL mutation, never requests a write scope, and cannot invite, suspend, remove, install or uninstall anything. Remediation stays with a human who approves and implements separately.",
      how: "Model A (offline audit): an authorized admin exports the CSVs and captures read-only app, billing and login evidence; this tool parses it locally and derives findings. Model B (controlled live read-only via Shopify CLI with read_* scopes only, no --allow-mutations) is run externally and its JSON pasted in as evidence. A governing read-only policy is applied to any AI narrative step.",
      input: "Shopify user CSV (required), plus optional role CSV, group CSV, activity-log CSV, app register (CSV/JSON), login-history JSON, and free-text HR/agency/contract context.",
      pipeline: true,
      steps: [
        ['Ideology', 'Least-privilege and no-change-by-architecture: the audit can never modify the account.'],
        ['Data analysis + review + hypothesis', 'Parses the exports locally, aggregates rows by user ID, and joins user to role to effective permissions and store access.'],
        ['Business & strategy decisions', 'Separates observed fact, inferred finding, missing evidence, and recommended action for every flag; never guesses missing justification.'],
        ['Content', 'Applies the rule engine: unnecessary users, excessive permissions, unused apps, duplicate functionality, security concerns, and an avoidable annual cost run-rate.'],
        ['Design + layout + structure', 'Renders a light, high-contrast findings dashboard with severity-ranked cards and exportable report.'],
        ['Coding', 'Runs client-side; an optional AI executive summary posts only the derived findings under a strict read-only policy.', '/api/brain?action=access-narrative'],
        ['Final compilation + presentation', 'Findings and recommendations only; a human approves and implements any remediation.', '/access-issues'],
      ],
    },
    social: {
      title: 'Social Media OS',
      what: "The daily social engine (V2 — Lifecycle OS): a 7-agent pipeline produces one complete day-package of posts across 11 platform formats — Instagram Feed, Reels and Stories, Facebook, TikTok, LinkedIn, X, Threads, Pinterest, YouTube Shorts, plus a long-form blog — every string brand-scrubbed, nothing published without a human approve.",
      who: "Followers and prospects per platform, UK market first. The operator reviews each day-package in the /social console and approves or skips per post.",
      how: "Seven bounded LLM agents run in sequence — each ONE call on the right provider tier, each with a deterministic fallback so the run never fails outright — inside a ~75s time box. A daily Vercel Cron (04:30 UTC) drives it; results persist to social_posts_generated in Supabase. Per-platform constraints (aspect, dims, char limits, hashtags, best time) live in a data spec, not prose. Platform push stays Phase 2 (push_status: not_integrated_phase_2).",
      input: "Nothing daily — the cron drives it; or hit Run Today in the console. From you: approve or skip per post. Product-focus rotation and festivals come from data/*.json; links use real knickgasm.com handles only.",
      pipeline: true,
      steps: [
        ['Ideology', "Premium-tier agent picks the day's creative theme — festival-aware, rotating product focus — maximum ideation before any data is touched.", '/api/brain?action=social-run-daily'],
        ['Data & Hypothesis', "Reads recent-post history from the DB to avoid repetition and states a performance hypothesis for the day's angle."],
        ['Strategy', "Locks objective, CTA, and destination link per platform — real knickgasm.com product handles only."],
        ['Content', "Writes per-platform copy — captions, titles, hashtags within each platform's limits — plus the 800-1200 word blog, in brand voice with banned phrases blocked."],
        ['Design', "Generates the hero image via the shared image cascade with per-platform crops; if generation fails it ships the exact image prompt instead."],
        ['Audio/Video', "Builds the storyboard and requests video via video-core for Reels, TikTok, and Shorts — stubbing gracefully when no video keys exist."],
        ['Compilation', "Fast-tier agent assembles the final day-package JSON, every string passes the brand scrub, and posts persist for review — approve or skip in the console.", '/api/brain?action=social-list · social-approve · social-skip'],
      ],
    },
  };

  // Expose the nav model so other pages (e.g. the homepage widget grid) can
  // mirror EVERY LHS item without drifting out of sync. Set synchronously on
  // script parse (auth.js is deferred → runs before DOMContentLoaded).
  try { window.__LC_NAV = NAV; } catch (_) {}
  try { window.__LC_NAV_INFO = { SUBQ, INFO }; } catch (_) {}

  // Flatten to a list of panel items for matching / open-page detection.
  function leafItems() {
    const out = [];
    NAV.forEach((n) => {
      if (n.section) return;            // section dividers have no panel
      if (n.children) n.children.forEach((c) => out.push(c));
      else out.push(n);
    });
    return out;
  }
  // currentStepId: pick the best-matching NAV panel for the current URL.
  // Priority order:
  //   1. EXACT match on full href (pathname + hash) — distinguishes sub-tabs
  //      like /ad-campaigns.html#calendar from /ad-campaigns.html#google.
  //   2. EXACT match on pathname against `match[]`.
  //   3. EXACT match on pathname against href's pathname part (fallback for
  //      sub-tabs whose container page is open with no hash yet).
  //   4. PREFIX match against `match[]` — but never against `/`.
  function currentStepId() {
    // A page whose tabs switch IN PLACE (no URL change) can name its own active
    // rail item via window.__LC_ACTIVE_ID. The URL is then not the source of
    // truth - the page is - so this override wins when it names a real leaf.
    try {
      const forced = window.__LC_ACTIVE_ID;
      if (forced && leafItems().some((it) => it.id === forced)) return forced;
    } catch (_) {}
    const p = location.pathname.toLowerCase();
    const s = (location.search || '').toLowerCase();  // e.g. ?region=us, ?tab=rfm
    const h = (location.hash || '').toLowerCase();     // e.g. #meta, #mailers
    const leaves = leafItems();

    // 1. EXACT full-href match, most-specific URL form first, so query- and
    //    hash-scoped sub-items (/research?region=us, /ad-campaigns.html#meta,
    //    /cohorts?tab=rfm) each light up their OWN row rather than the group's
    //    overview. Candidates go specific -> general.
    for (const cand of [p + s + h, p + s, p + h, p]) {
      for (const it of leaves) {
        if (it.href && it.href.toLowerCase() === cand) return it.id;
      }
    }
    // 2. match[] exact on pathname
    for (const it of leaves) {
      if ((it.match || []).some((m) => p === String(m).toLowerCase())) return it.id;
    }
    // 3. href pathname exact + URL carries no hash AND no query → first sub-tab
    //    of that page (container open, no specific sub-tab selected yet).
    if (!h && !s) {
      for (const it of leaves) {
        if (it.href) {
          const hp = it.href.split('#')[0].split('?')[0].toLowerCase();
          if (hp === p) return it.id;
        }
      }
    }
    // 4. match[] prefix (never `/`)
    for (const it of leaves) {
      if ((it.match || []).some((m) => m !== '/' && p.startsWith(String(m).toLowerCase() + '/'))) return it.id;
    }
    // 5. pathname-exact fallback IGNORING query/hash — when the URL carries a
    //    ?tab=/#hash that matched no specific sub-tab panel (steps 1-2), keep the
    //    page's OWN group/panel lit instead of falling through to Home. (Step 3
    //    only fires when there is no query/hash; this covers the query/hash case.)
    for (const it of leaves) {
      if (it.href) {
        const hp = it.href.split('#')[0].split('?')[0].toLowerCase();
        if (hp !== '/' && hp === p) return it.id;
      }
    }
    return 'home';
  }
  // Pages that must never gate behind the login wall.
  //
  // Internal tool: we do NOT force a Google sign-in to use any feature. The
  // optional "Sign in" chip stays in the nav (so profiles/Supabase still work
  // when signed in), but no page is blocked by the login wall. This avoids
  // lockouts from external OAuth redirect-URL/domain mismatches. To re-enable
  // forced auth on specific pages later, return `!!(item && item.open)` based
  // on a per-item flag instead of `true`.
  function isOpenPage() {
    const p = (location.pathname || '').toLowerCase();
    // Legal/consent pages are always open (Google OAuth review + never lock a
    // user out of the privacy/terms pages).
    if (/(^|\/)(privacy|terms)(\.html)?$/.test(p)) return true;
    // The HOMEPAGE must be publicly viewable (Google OAuth "app homepage"
    // requirement: not behind a login page, and it explains the app's purpose).
    // It renders a guest nav + a Sign in button, but is never walled.
    if (p === '/' || p === '' || /(^|\/)index(\.html)?$/.test(p)) return true;
    // Otherwise a page is open ONLY if its nav panel is explicitly flagged
    // open (Mailer Studio). Everything else requires Google sign-in.
    const id = currentStepId();
    const item = leafItems().find((s) => s.id === id);
    return !!(item && item.open);
  }

  // ─── Left-hand sidebar (global cross-feature navigation) ────────────
  function injectTopbar(user) {
    if (document.getElementById('lifecycle-nav')) return;
    const cur = currentStepId();
    const svg = (k) => BRAND[k]
      ? BRAND[k]
      : `<svg class="lnav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ''}</svg>`;

    // Standing IA rule (CLAUDE.md "LHS navigation IA rule"): the five common
    // "know about this feature" questions (What does it do? / Who is it for? /
    // How does it work? / Input / Step-by-Step Working) are the SAME for every
    // feature, so they no longer clutter the rail. Sanctioned rendering
    // (2026-07-09): a quiet `?` chip sits next to each feature/group label and
    // opens a POPUP that presents all five questions as headings with their
    // content. The rail itself now shows only the real feature links and their
    // group sub-sections. Order and presence of the five questions are
    // unchanged; they just live in the modal instead of an inline accordion.

    // The info key highlighted as "current": the current item's own INFO entry,
    // else the gid of the group that contains the current panel.
    let activeInfoKey = null;
    if (INFO[cur]) activeInfoKey = cur;
    else {
      for (const n of NAV) {
        if (n.children && n.gid && n.children.some((c) => c.id === cur)) { activeInfoKey = n.gid; break; }
      }
    }
    const infoBtn = (key, label) => INFO[key]
      ? `<button type="button" class="lnav-i${key === activeInfoKey ? ' on' : ''}" data-itoggle="${key}" title="Know about: ${label}" aria-label="Know about ${label}" aria-haspopup="dialog">?</button>`
      : '';

    // V1/V2 taxonomy badge — REMOVED from the rail (product-owner request) to cut
    // clutter. The `ver`/`draft` data is kept on each NAV item (it still feeds the
    // tooltip text and the `?` info popup / version taxonomy), but no visible chip
    // renders in the row. Return '' to drop the chip everywhere it was used.
    const verChip = () => '';

    // Build the nav markup. Internal nav stays in the same tab so the back
    // button works naturally; external links elsewhere in the app keep their
    // own target="_blank" where they're declared.
    const linkRow = (item) => {
      const isCur = item.id === cur;
      const a = `<a class="lnav-link${isCur ? ' active' : ''}" href="${item.href}" data-id="${item.id}" title="${item.label}">
        ${svg(item.icon)}<span class="lnav-txt">${item.label}</span>${verChip(item)}</a>`;
      if (!INFO[item.id]) return a;
      return `<div class="lnav-item">${a}${infoBtn(item.id, item.label)}</div>`;
    };
    // Double-layer nav: Tier-1 = top-level features (flat items + group headers),
    // Tier-2 = each feature's sub-sections. Groups start COLLAPSED — only the
    // group that owns the current page opens, keeping the rail calm. The caret
    // expands/collapses any group on demand.
    const navHtml = NAV.map((n) => {
      if (n.section) return `<div class="lnav-section">${n.section}</div>`;
      if (!n.children) return linkRow(n);
      const groupActive = n.children.some((c) => c.id === cur);
      return `<div class="lnav-group${groupActive ? ' open active-group' : ''}">
        <div class="lnav-item"><button class="lnav-ghead" type="button" title="${n.group}">${svg(n.icon)}<span class="lnav-txt">${n.group}</span>${verChip(n)}<svg class="lnav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>${n.gid ? infoBtn(n.gid, n.group) : ''}</div>
        <div class="lnav-gbody">${n.children.map(linkRow).join('')}</div>
      </div>`;
    }).join('');

    const initials = user ? (user.user_metadata?.name || user.email || '?').trim().slice(0, 1).toUpperCase() : '';
    const avatar = user
      ? (user.user_metadata?.avatar_url
          ? `<span class="lnav-avatar"><img src="${user.user_metadata.avatar_url}" alt=""></span>`
          : `<span class="lnav-avatar">${initials}</span>`)
      : '';
    const userHtml = user
      ? `<div class="lnav-user">${avatar}<span class="lnav-uname">${user.user_metadata?.name || user.email}</span>
           <button class="lnav-signout" id="lnav-signout" title="Sign out">⎋</button></div>`
      : `<div class="lnav-user"><a class="lnav-signin" id="lnav-signin" href="/">Sign in</a></div>`;

    const wrap = document.createElement('div');
    wrap.id = 'lifecycle-nav';
    wrap.innerHTML = `
      <style>
        :root { --lsb-w: 248px; }
        @media (min-width: 961px) { body { margin-left: var(--lsb-w) !important; } }
        #lifecycle-nav { font-family: 'Inter', system-ui, sans-serif; }

        /* Mobile top bar — FIXED so it stays pinned while the page scrolls.
           (A sticky element can't hold here: its wrapper #lifecycle-nav is only
           bar-height tall because the drawer + backdrop are position:fixed.)
           An in-flow spacer of the same height reserves layout space below. */
        #lifecycle-nav .lnav-mbar {
          display: none; align-items: center; gap: 12px;
          position: fixed; top: 0; left: 0; right: 0; z-index: 100;
          height: calc(50px + env(safe-area-inset-top, 0px));
          padding: env(safe-area-inset-top, 0px) 14px 0;
          background: rgba(7,14,11,0.97); backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(171,135,67,0.18);
        }
        #lifecycle-nav .lnav-mbar-spacer { display: none; }
        #lifecycle-nav .lnav-burger {
          background: transparent; border: 1px solid rgba(171,135,67,0.25);
          color: #111111; border-radius: 8px; width: 34px; height: 34px;
          font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        #lifecycle-nav .lnav-mbrand { display: flex; align-items: center; gap: 8px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: #6A33D8;
          text-transform: uppercase; text-decoration: none; }
        #lifecycle-nav .lnav-mbrand .lnav-mark { width: 22px; height: 22px; flex-shrink: 0; }

        #lifecycle-nav .lnav-backdrop {
          position: fixed; inset: 0; z-index: 109; background: rgba(0,0,0,0.55);
          opacity: 0; pointer-events: none; transition: opacity .2s;
        }
        #lifecycle-nav.open .lnav-backdrop { opacity: 1; pointer-events: auto; }

        /* Sidebar */
        #lifecycle-nav .lnav-side {
          position: fixed; left: 0; top: 0; z-index: 110;
          width: var(--lsb-w); height: 100vh;
          display: flex; flex-direction: column;
          background: #f4f2ec; border-right: 1px solid rgba(171,135,67,0.18);
          padding: 16px 12px 12px;
        }
        #lifecycle-nav .lnav-brand {
          display: flex; align-items: center; gap: 10px; text-decoration: none;
          padding: 4px 8px 16px; color: #6A33D8;
        }
        /* Brand mark — refreshed panel + steam SVG with gradient depth.
           Hover uses filter brightness so it works with the gradients
           (overriding fill would lose the gradient). */
        #lifecycle-nav .lnav-mark { width: 30px; height: 30px; flex-shrink: 0; display: block; transition: filter .2s, transform .2s; }
        #lifecycle-nav .lnav-brand:hover .lnav-mark,
        #lifecycle-nav .lnav-mbrand:hover .lnav-mark { filter: brightness(1.15) saturate(1.05); transform: translateY(-1px); }
        #lifecycle-nav .lnav-brand .lnav-bt { display: flex; flex-direction: column; line-height: 1.15; }
        #lifecycle-nav .lnav-brand .lnav-bt b { font-family: 'Lora', serif; font-size: 14px; color: #D0473E; font-weight: 600; }
        #lifecycle-nav .lnav-brand .lnav-bt small { font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: #6A33D8; }
        #lifecycle-nav .lnav-head { display: flex; align-items: center; gap: 6px; }
        #lifecycle-nav .lnav-head .lnav-brand { flex: 1; padding-right: 0; }
        #lifecycle-nav .lnav-collapse {
          flex-shrink: 0; width: 26px; height: 26px; margin-bottom: 16px;
          background: transparent; border: 1px solid rgba(171,135,67,0.22); border-radius: 7px;
          color: #556059; cursor: pointer; font-size: 14px; line-height: 1;
          display: flex; align-items: center; justify-content: center; transition: all .12s;
        }
        #lifecycle-nav .lnav-collapse:hover { border-color: #6A33D8; color: #111111; }

        /* ── Collapsed (icon-only) rail — desktop only ── */
        @media (min-width: 961px) {
          html.lnav-collapsed #lifecycle-nav .lnav-side { padding-left: 8px; padding-right: 8px; }
          html.lnav-collapsed #lifecycle-nav .lnav-bt,
          html.lnav-collapsed #lifecycle-nav .lnav-txt,
          html.lnav-collapsed #lifecycle-nav .lnav-caret,
          html.lnav-collapsed #lifecycle-nav .lnav-uname { display: none; }
          html.lnav-collapsed #lifecycle-nav .lnav-head { flex-direction: column-reverse; gap: 10px; }
          html.lnav-collapsed #lifecycle-nav .lnav-brand { justify-content: center; padding: 0; }
          html.lnav-collapsed #lifecycle-nav .lnav-link,
          html.lnav-collapsed #lifecycle-nav .lnav-ghead { justify-content: center; padding: 9px 0; }
          html.lnav-collapsed #lifecycle-nav .lnav-gbody { padding-left: 0; margin-left: 0; border-left: none; }
          html.lnav-collapsed #lifecycle-nav .lnav-user { justify-content: center; }
          /* Icon-only rail: hide the feature-IA toggles + sub-item lists. */
          html.lnav-collapsed #lifecycle-nav .lnav-i,
          html.lnav-collapsed #lifecycle-nav .lnav-info { display: none; }
        }

        #lifecycle-nav .lnav-scroll { flex: 1; overflow-y: auto; scrollbar-width: thin; margin: 0 -4px; padding: 0 4px; }
        #lifecycle-nav .lnav-scroll::-webkit-scrollbar { width: 6px; }
        #lifecycle-nav .lnav-scroll::-webkit-scrollbar-thumb { background: rgba(171,135,67,0.25); border-radius: 6px; }

        #lifecycle-nav .lnav-ic { width: 18px; height: 18px; flex-shrink: 0; }
        #lifecycle-nav .lnav-brandic { width: 18px; height: 18px; }
        /* Section divider label (KNOWLEDGE BASE / CREATE) */
        #lifecycle-nav .lnav-section {
          padding: 14px 11px 5px; margin-top: 4px;
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
          color: #6f8278;
        }
        html.lnav-collapsed #lifecycle-nav .lnav-section {
          text-align: center; padding: 10px 0 4px; font-size: 0;
        }
        html.lnav-collapsed #lifecycle-nav .lnav-section::before {
          content: ''; display: inline-block; width: 18px; height: 1px; background: rgba(171,135,67,0.3);
        }
        #lifecycle-nav .lnav-link {
          display: flex; align-items: center; gap: 11px;
          padding: 7px 11px; margin: 1px 0; border-radius: 9px;
          font-size: 13px; color: #556059; text-decoration: none;
          border: 1px solid transparent; transition: all .12s;
        }
        #lifecycle-nav .lnav-link:focus-visible,
        #lifecycle-nav .lnav-ghead:focus-visible,
        #lifecycle-nav .lnav-i:focus-visible,
        #lifecycle-nav .lnav-info-item:focus-visible {
          outline: 1px solid #6A33D8; outline-offset: 1px;
        }
        /* Labels wrap to at most TWO lines instead of truncating mid-word
           ("Calen…", "UK Non-Eng…"). Shared by links AND group headers.
           The row title attribute still carries the full name as a tooltip. */
        #lifecycle-nav .lnav-txt {
          flex: 1; min-width: 0; white-space: normal; overflow-wrap: break-word;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden; line-height: 1.3;
        }
        /* V1/V2 taxonomy badge — deliberately quiet (Draft info lives in the
           tooltip + info panels, not the row). */
        #lifecycle-nav .lnav-ver {
          flex-shrink: 0; font-size: 8px; font-weight: 600; letter-spacing: 0.08em;
          line-height: 1.4; padding: 1px 4px; border-radius: 4px; white-space: nowrap;
        }
        #lifecycle-nav .lnav-ver.v1 {
          color: #48524c; background: rgba(139,156,147,0.08);
        }
        #lifecycle-nav .lnav-ver.v2 {
          color: rgba(171,135,67,0.8); background: rgba(171,135,67,0.1);
        }
        html.lnav-collapsed #lifecycle-nav .lnav-ver { display: none; }
        #lifecycle-nav .lnav-link:hover { color: #111111; background: rgba(171,135,67,0.08); }
        /* Current item = the STRONGEST, darkest highlight: solid deep-purple fill
           with chalk text (chalk #FFFFFF on green #D0473E is high-contrast and fully
           legible) plus a bold lava left-accent. Applies to the active panel AND the
           active sub-item, so the selected sub-item reads darker than its parent. */
        #lifecycle-nav .lnav-link.active {
          color: #FFFFFF; background: #D0473E; border-color: rgba(171,135,67,0.55);
          box-shadow: inset 3px 0 0 #6A33D8; font-weight: 600;
        }
        #lifecycle-nav .lnav-link.active .lnav-ic { color: #6A33D8; }

        /* Groups */
        #lifecycle-nav .lnav-group { margin: 6px 0 2px; }
        #lifecycle-nav .lnav-ghead {
          width: 100%; display: flex; align-items: center; gap: 11px;
          padding: 7px 11px; border: none; background: transparent; cursor: pointer;
          font-family: inherit; font-size: 13px; color: #556059; text-align: left; border-radius: 9px;
        }
        #lifecycle-nav .lnav-ghead:hover { background: rgba(171,135,67,0.06); color: #111111; }
        /* Parent of the active sub-item ALSO reads as selected, but LIGHTER than
           the sub-item: a lava-tint fill + faint lava accent, so both show and the
           sub-item stays the darker/stronger of the two. */
        #lifecycle-nav .lnav-group.active-group .lnav-ghead { color: #D0473E; background: rgba(171,135,67,0.13); box-shadow: inset 3px 0 0 rgba(171,135,67,0.55); }
        #lifecycle-nav .lnav-group.active-group .lnav-ghead .lnav-ic { color: #6A33D8; }
        #lifecycle-nav .lnav-caret { width: 15px; height: 15px; color: #48524c; transition: transform .18s; }
        #lifecycle-nav .lnav-group.open .lnav-caret { transform: rotate(180deg); }
        #lifecycle-nav .lnav-gbody { display: none; padding-left: 14px; margin-left: 8px; border-left: 1px solid rgba(171,135,67,0.14); }
        #lifecycle-nav .lnav-group.open .lnav-gbody { display: block; }
        #lifecycle-nav .lnav-gbody .lnav-link { font-size: 12.5px; padding: 6px 10px; }

        /* ── Feature IA: row wrapper + "?" toggle + 5 fixed sub-items ── */
        #lifecycle-nav .lnav-item { display: flex; align-items: center; gap: 4px; min-width: 0; }
        #lifecycle-nav .lnav-item > .lnav-link,
        #lifecycle-nav .lnav-item > .lnav-ghead { flex: 1; min-width: 0; }
        #lifecycle-nav .lnav-i {
          flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
          background: transparent; border: 1px solid rgba(171,135,67,0.28);
          color: #6f8278; font-family: inherit; font-size: 10.5px; font-weight: 700; line-height: 1;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: all .12s; padding: 0;
        }
        #lifecycle-nav .lnav-i:hover { border-color: #6A33D8; color: #111111; }
        #lifecycle-nav .lnav-i.on { background: rgba(171,135,67,0.2); border-color: #6A33D8; color: #111111; }
        #lifecycle-nav .lnav-info { display: none; margin: 2px 0 4px 8px; padding-left: 12px; border-left: 1px dashed rgba(171,135,67,0.28); }
        #lifecycle-nav .lnav-info.open { display: block; }
        #lifecycle-nav .lnav-info-item {
          width: 100%; display: flex; align-items: center; gap: 8px;
          background: transparent; border: none; cursor: pointer; text-align: left;
          font-family: inherit; font-size: 11.5px; color: #8b9c93;
          padding: 5px 8px; border-radius: 7px; transition: all .12s;
        }
        #lifecycle-nav .lnav-info-item:hover { color: #111111; background: rgba(171,135,67,0.08); }
        #lifecycle-nav .lnav-info-n {
          flex-shrink: 0; width: 15px; height: 15px; border-radius: 4px;
          background: rgba(171,135,67,0.14); color: #6A33D8;
          font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center;
        }

        /* ── Feature info panel (overlay) ── */
        #lifecycle-nav .lnav-ipanel-backdrop {
          position: fixed; inset: 0; z-index: 125; background: rgba(0,0,0,0.6);
          display: none;
        }
        #lifecycle-nav .lnav-ipanel {
          position: fixed; z-index: 126;
          top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: min(560px, 94vw); max-height: min(78vh, 720px);
          background: #ffffff; border: 1px solid rgba(171,135,67,0.3);
          border-radius: 14px; box-shadow: 0 30px 80px rgba(0,0,0,0.7);
          display: none; flex-direction: column; overflow: hidden;
          font-family: 'Inter', system-ui, sans-serif;
        }
        #lifecycle-nav.ipanel-open .lnav-ipanel-backdrop { display: block; }
        #lifecycle-nav.ipanel-open .lnav-ipanel { display: flex; }
        #lifecycle-nav .lnav-ipanel-head {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 18px 20px 12px; border-bottom: 1px solid rgba(171,135,67,0.16);
        }
        #lifecycle-nav .lnav-ipanel-eyebrow {
          font-size: 10px; font-weight: 700; letter-spacing: 0.16em;
          text-transform: uppercase; color: #6A33D8; margin-bottom: 3px;
        }
        #lifecycle-nav .lnav-ipanel-title {
          font-family: 'Lora', Georgia, serif; font-size: 18px; font-weight: 600;
          color: #111111; letter-spacing: -0.01em; flex: 1;
        }
        #lifecycle-nav .lnav-ipanel-htxt { flex: 1; min-width: 0; }
        #lifecycle-nav .lnav-ipanel-close {
          flex-shrink: 0; width: 28px; height: 28px; border-radius: 8px;
          background: transparent; border: 1px solid rgba(171,135,67,0.25);
          color: #556059; font-size: 15px; line-height: 1; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        #lifecycle-nav .lnav-ipanel-close:hover { border-color: #6A33D8; color: #111111; }
        #lifecycle-nav .lnav-ipanel-body {
          padding: 16px 20px 20px; overflow-y: auto; scrollbar-width: thin;
          font-size: 13px; line-height: 1.65; color: #556059;
        }
        #lifecycle-nav .lnav-ipanel-body p { margin: 0 0 10px; }
        #lifecycle-nav .lnav-ipanel-q {
          font-family: 'Lora', Georgia, serif; font-size: 14.5px; font-weight: 600;
          color: #111111; margin: 18px 0 6px; padding-top: 12px;
          border-top: 1px solid rgba(171,135,67,0.16);
        }
        #lifecycle-nav .lnav-ipanel-q:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
        #lifecycle-nav .lnav-ipanel-note {
          font-size: 11.5px; color: #6A33D8; background: rgba(171,135,67,0.08);
          border: 1px solid rgba(171,135,67,0.2); border-radius: 8px;
          padding: 8px 12px; margin: 0 0 14px;
        }
        #lifecycle-nav .lnav-steps { margin: 0; padding: 0 0 0 4px; list-style: none; counter-reset: lstep; }
        #lifecycle-nav .lnav-steps li {
          counter-increment: lstep; position: relative;
          padding: 0 0 14px 34px; margin: 0;
        }
        #lifecycle-nav .lnav-steps li::before {
          content: counter(lstep); position: absolute; left: 0; top: 1px;
          width: 22px; height: 22px; border-radius: 50%;
          background: rgba(171,135,67,0.16); border: 1px solid rgba(171,135,67,0.35);
          color: #6A33D8; font-size: 10.5px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
        }
        #lifecycle-nav .lnav-steps li:not(:last-child)::after {
          content: ''; position: absolute; left: 10.5px; top: 26px; bottom: 2px;
          width: 1px; background: rgba(171,135,67,0.18);
        }
        #lifecycle-nav .lnav-steps b { display: block; color: #111111; font-size: 12.5px; margin-bottom: 2px; }
        #lifecycle-nav .lnav-steps .lnav-step-d { display: block; font-size: 12px; color: #556059; }
        #lifecycle-nav .lnav-steps .lnav-step-via {
          display: inline-block; margin-top: 4px; font-family: 'JetBrains Mono', monospace;
          font-size: 10px; color: #6f8278; background: rgba(171,135,67,0.08);
          border-radius: 5px; padding: 2px 7px;
        }

        /* User footer */
        #lifecycle-nav .lnav-user {
          display: flex; align-items: center; gap: 9px; margin-top: 8px;
          padding: 10px 8px 4px; border-top: 1px solid rgba(171,135,67,0.14); font-size: 12px; color: #556059;
        }
        #lifecycle-nav .lnav-avatar { width: 28px; height: 28px; border-radius: 50%;
          background: linear-gradient(135deg,#6A33D8,#D0473E); display: flex; align-items: center; justify-content: center;
          color: #FFFFFF; font-size: 12px; font-weight: 700; overflow: hidden; flex-shrink: 0; }
        #lifecycle-nav .lnav-avatar img { width: 100%; height: 100%; object-fit: cover; }
        #lifecycle-nav .lnav-uname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #lifecycle-nav .lnav-signout { background: transparent; border: 1px solid rgba(171,135,67,0.25);
          color: #556059; cursor: pointer; padding: 4px 8px; border-radius: 6px; font-size: 13px; flex-shrink: 0; }
        #lifecycle-nav .lnav-signout:hover { border-color: #6A33D8; color: #111111; }
        #lifecycle-nav .lnav-signin { color: #7a5f28; text-decoration: none; font-weight: 600; padding: 4px 8px; }

        @media (max-width: 960px) {
          #lifecycle-nav .lnav-mbar { display: flex; }
          #lifecycle-nav .lnav-mbar-spacer { display: block; height: var(--ltb-h, 50px); }
          #lifecycle-nav .lnav-side {
            width: min(var(--lsb-w), 86vw); height: 100dvh;
            transform: translateX(-100%); transition: transform .24s ease;
            box-shadow: 0 20px 60px rgba(0,0,0,0.6);
            padding-top: calc(16px + env(safe-area-inset-top, 0px));
          }
          #lifecycle-nav.open .lnav-side { transform: translateX(0); }
          /* On mobile the rail is a drawer, never the collapsed icon-rail. */
          html.lnav-collapsed { --lsb-w: 248px; }
        }
      </style>
      <div class="lnav-mbar">
        <button class="lnav-burger" id="lnav-burger" aria-label="Open navigation">☰</button>
        <a class="lnav-mbrand" href="/">${LOGO_SVG} <span style="margin-left:8px" class="lnav-mbrand-label">Lifecycle OS</span></a>
      </div>
      <div class="lnav-mbar-spacer"></div>
      <div class="lnav-backdrop" id="lnav-backdrop"></div>
      <aside class="lnav-side">
        <div class="lnav-head">
          <a class="lnav-brand" href="/">
            ${LOGO_SVG}
            <span class="lnav-bt"><b>Lifecycle OS</b><small class="lnav-brandname"></small></span>
          </a>
          <button class="lnav-collapse" id="lnav-collapse" type="button" title="Collapse sidebar" aria-label="Collapse sidebar">«</button>
        </div>
        <div class="lnav-scroll">${navHtml}</div>
        ${userHtml}
      </aside>
      <div class="lnav-ipanel-backdrop" id="lnav-ipanel-backdrop"></div>
      <div class="lnav-ipanel" id="lnav-ipanel" role="dialog" aria-modal="true" aria-labelledby="lnav-ipanel-title">
        <div class="lnav-ipanel-head">
          <div class="lnav-ipanel-htxt">
            <div class="lnav-ipanel-eyebrow" id="lnav-ipanel-eyebrow"></div>
            <div class="lnav-ipanel-title" id="lnav-ipanel-title"></div>
          </div>
          <button type="button" class="lnav-ipanel-close" id="lnav-ipanel-close" aria-label="Close">×</button>
        </div>
        <div class="lnav-ipanel-body" id="lnav-ipanel-body"></div>
      </div>
    `;
    document.body.insertBefore(wrap, document.body.firstChild);
    // Signal to embedded apps (e.g. Mailer Studio) that they're rendering
    // inside the Lifecycle OS shell, so they can hide their own duplicate
    // header / tabs / sign-out chrome.
    document.body.classList.add('lifecycle-os-mode');
    document.documentElement.classList.add('lifecycle-os-mode');

    // Publish --ltb-h (mobile top-bar height, else 0) so each page's own sticky
    // header offsets correctly beneath the bar on small screens.
    const publishHeight = () => {
      const mbar = wrap.querySelector('.lnav-mbar');
      const h = (mbar && getComputedStyle(mbar).display !== 'none')
        ? Math.ceil(mbar.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty('--ltb-h', h + 'px');
    };
    publishHeight();
    requestAnimationFrame(publishHeight);
    window.addEventListener('load', publishHeight);
    if (!window.__ltbResizeHooked) {
      window.__ltbResizeHooked = true;
      window.addEventListener('resize', publishHeight);
    }

    // Group expand/collapse (the head now sits inside a .lnav-item row, so
    // resolve the owning .lnav-group instead of assuming parentElement).
    wrap.querySelectorAll('.lnav-ghead').forEach((btn) => {
      btn.addEventListener('click', () => {
        const g = btn.closest('.lnav-group');
        if (g) g.classList.toggle('open');
      });
    });

    // ── Feature IA: the "?" chip opens a "know about this feature" popup that
    //    lays out all five common questions as headings with their content.
    //    Everything lives inside #lifecycle-nav so page CSS cannot collide, and
    //    it works signed-in or signed-out. Content is written via textContent
    //    so it never needs HTML-escaping.
    const ipanel = wrap.querySelector('#lnav-ipanel');
    const ipanelBody = wrap.querySelector('#lnav-ipanel-body');
    const ipanelTitle = wrap.querySelector('#lnav-ipanel-title');
    const ipanelEyebrow = wrap.querySelector('#lnav-ipanel-eyebrow');
    const closeIpanel = () => wrap.classList.remove('ipanel-open');
    const openInfoModal = (key) => {
      const f = INFO[key];
      if (!f || !ipanel) return;
      ipanelEyebrow.textContent = f.title;
      ipanelTitle.textContent = 'Know about this feature';
      ipanelBody.innerHTML = '';
      SUBQ.forEach(([sub, label]) => {
        const h = document.createElement('h4');
        h.className = 'lnav-ipanel-q';
        h.textContent = label;
        ipanelBody.appendChild(h);
        if (sub === 'steps') {
          if (f.pipeline) {
            const note = document.createElement('p');
            note.className = 'lnav-ipanel-note';
            note.textContent = 'Multi-agent pipeline: every step runs as its own specialist agent, maximum creativity, ideation and business-strategic thinking before anything ships.';
            ipanelBody.appendChild(note);
          }
          const ol = document.createElement('ol');
          ol.className = 'lnav-steps';
          (f.steps || []).forEach((st) => {
            const li = document.createElement('li');
            const b = document.createElement('b'); b.textContent = st[0]; li.appendChild(b);
            const d = document.createElement('span'); d.className = 'lnav-step-d'; d.textContent = st[1]; li.appendChild(d);
            if (st[2]) { const via = document.createElement('span'); via.className = 'lnav-step-via'; via.textContent = 'Runs via: ' + st[2]; li.appendChild(via); }
            ol.appendChild(li);
          });
          ipanelBody.appendChild(ol);
        } else {
          const p = document.createElement('p');
          p.textContent = f[sub] || '';
          ipanelBody.appendChild(p);
        }
      });
      ipanelBody.scrollTop = 0;
      wrap.classList.add('ipanel-open');
    };
    wrap.querySelectorAll('.lnav-i').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        openInfoModal(btn.dataset.itoggle);
      });
    });
    wrap.querySelector('#lnav-ipanel-close')?.addEventListener('click', closeIpanel);
    wrap.querySelector('#lnav-ipanel-backdrop')?.addEventListener('click', closeIpanel);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeIpanel(); });

    // Re-apply active state when the URL hash changes (e.g. user clicks
    // sub-tabs on ad-campaigns.html that just flip the hash). No re-render
    // — just toggle the `active` classes so the sidebar mirrors the new
    // sub-tab without losing scroll position or open-group state.
    const refreshActive = () => {
      const cur = currentStepId();
      wrap.querySelectorAll('.lnav-link').forEach((a) => {
        a.classList.toggle('active', a.dataset.id === cur);
      });
      wrap.querySelectorAll('.lnav-group').forEach((g) => {
        const hit = !!g.querySelector('.lnav-link.active');
        g.classList.toggle('active-group', hit);
        if (hit) g.classList.add('open'); // auto-expand the group that owns the active link
      });
    };
    window.addEventListener('hashchange', refreshActive);
    // Pages with in-place tabs call this after setting window.__LC_ACTIVE_ID.
    window.__LC_NAV_REFRESH = refreshActive;
    // Also refresh on history navigation (back/forward across hash routes).
    window.addEventListener('popstate', refreshActive);
    // AND on programmatic URL changes: region switches, detail panels, and the
    // calendar day-view use history.replaceState/pushState, which fire NEITHER
    // hashchange NOR popstate. Patch them once to emit a signal, and keep a
    // single window-level listener pointed at the latest refreshActive so the
    // highlight updates from every source without stacking listeners.
    window.__lnavRefresh = refreshActive;
    if (!window.__lnavHistoryPatched) {
      window.__lnavHistoryPatched = true;
      ['pushState', 'replaceState'].forEach((m) => {
        const orig = history[m];
        if (typeof orig !== 'function') return;
        history[m] = function () {
          const r = orig.apply(this, arguments);
          try { window.dispatchEvent(new Event('lnav:locationchange')); } catch (_) {}
          return r;
        };
      });
      window.addEventListener('lnav:locationchange', () => { try { window.__lnavRefresh && window.__lnavRefresh(); } catch (_) {} });
    }

    // Mobile drawer open/close
    const setOpen = (o) => wrap.classList.toggle('open', o);
    wrap.querySelector('#lnav-burger')?.addEventListener('click', () => setOpen(true));
    wrap.querySelector('#lnav-backdrop')?.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (wrap.classList.contains('ipanel-open')) { closeIpanel(); return; }
      setOpen(false);
    });
    // Same-tab nav clicks close the drawer.
    wrap.querySelectorAll('.lnav-link').forEach((a) => {
      if (!a.target) a.addEventListener('click', () => setOpen(false));
    });

    // ── Touch swipe: swipe RIGHT opens the LHS nav, swipe LEFT closes it ──
    // Mobile only. Opening starts from the left half of the screen (so it never
    // fights right-edge content); closing works from anywhere while open.
    // Attached ONCE globally (injectTopbar can re-run on auth changes) and it
    // resolves the live nav element at event time so it never holds a stale ref.
    if (!window.__lcSwipeHooked) {
      window.__lcSwipeHooked = true;
      const navEl = () => document.getElementById('lifecycle-nav');
      const setOpenG = (o) => { const n = navEl(); if (n) n.classList.toggle('open', o); };
      const isMobileNav = () => window.matchMedia('(max-width: 960px)').matches;
      const OPEN_FROM = 0.5;   // opening gesture must start in the left 50% of the viewport
      const THRESH = 55;       // min horizontal travel (px)
      let sx = 0, sy = 0, swiping = false;
      document.addEventListener('touchstart', (e) => {
        const n = navEl();
        if (!n || !isMobileNav() || e.touches.length !== 1) { swiping = false; return; }
        const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
        const open = n.classList.contains('open');
        swiping = open || sx <= window.innerWidth * OPEN_FROM;
      }, { passive: true });
      document.addEventListener('touchend', (e) => {
        if (!swiping) return;
        swiping = false;
        const n = navEl();
        if (!n || !isMobileNav()) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) < THRESH || Math.abs(dx) <= Math.abs(dy)) return; // horizontal-dominant only
        const open = n.classList.contains('open');
        if (dx > 0 && !open) setOpenG(true);        // swipe right → open
        else if (dx < 0 && open) setOpenG(false);   // swipe left → close
      }, { passive: true });
      // Resize cleanup: leaving mobile width should never strand an open drawer.
      window.addEventListener('resize', () => { if (!isMobileNav()) setOpenG(false); });
    }

    // Sign-in / sign-out wiring
    const signinBtn = wrap.querySelector('#lnav-signin');
    if (signinBtn) signinBtn.onclick = (e) => {
      if (window.LifecycleAuth?.client) {
        e.preventDefault();
        rememberReturnTo();
        window.LifecycleAuth.client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: location.origin + location.pathname },
        });
      }
    };
    const signoutBtn = wrap.querySelector('#lnav-signout');
    if (signoutBtn) signoutBtn.onclick = () => window.LifecycleAuth.signOut();

    // ── Collapse / expand the rail (icon-only), persisted across pages ──
    const COLLAPSE_KEY = 'lifecycle-nav-collapsed';
    const collapseBtn = wrap.querySelector('#lnav-collapse');
    const applyCollapsed = (c) => {
      document.documentElement.classList.toggle('lnav-collapsed', c);
      document.documentElement.style.setProperty('--lsb-w', c ? '64px' : '248px');
      if (collapseBtn) {
        collapseBtn.innerHTML = c ? '»' : '«';
        collapseBtn.title = c ? 'Expand sidebar' : 'Collapse sidebar';
      }
      publishHeight();
    };
    let collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch {}
    applyCollapsed(collapsed);
    if (collapseBtn) collapseBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
      applyCollapsed(collapsed);
    });
  }

  // ─── Login wall ─────────────────────────────────────────────────────
  function injectLoginWall(error) {
    if (document.getElementById('lifecycle-loginwall')) return;
    const wall = document.createElement('div');
    wall.id = 'lifecycle-loginwall';
    wall.innerHTML = `
      <style>
        #lifecycle-loginwall {
          position: fixed; inset: 0; z-index: 9999;
          background: #ffffff;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Inter', system-ui, sans-serif;
          padding: 20px;
        }
        #lifecycle-loginwall .llw-card {
          max-width: 460px; width: 100%;
          background: #ffffff; border: 1px solid rgba(171,135,67,0.25);
          border-radius: 16px; padding: 40px 36px;
          text-align: center; box-shadow: 0 20px 60px rgba(0,74,43,0.16);
        }
        #lifecycle-loginwall .llw-dot {
          width: 44px; height: 44px; border-radius: 50%;
          background: linear-gradient(135deg, #6A33D8, #D0473E);
          margin: 0 auto 18px;
        }
        #lifecycle-loginwall .llw-title {
          font-size: 12px; letter-spacing: 0.22em; color: #6A33D8;
          text-transform: uppercase; font-weight: 700;
          margin-bottom: 10px;
        }
        #lifecycle-loginwall h1 {
          font-family: 'Lora','Inter',serif; font-size: 26px;
          color: #111111; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em;
        }
        #lifecycle-loginwall h1 em { color: #6A33D8; font-style: italic; }
        #lifecycle-loginwall p {
          color: #556059; font-size: 13.5px; line-height: 1.6;
          margin: 0 0 24px;
        }
        #lifecycle-loginwall button {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 10px; padding: 13px 22px;
          background: #D0473E; color: #ffffff;
          border: none; border-radius: 9px;
          font-family: inherit; font-size: 14px; font-weight: 600;
          letter-spacing: 0.02em; cursor: pointer;
          width: 100%; transition: opacity .15s;
        }
        #lifecycle-loginwall button:hover  { opacity: 0.92; }
        #lifecycle-loginwall button:disabled { opacity: 0.5; cursor: not-allowed; }
        #lifecycle-loginwall .llw-foot {
          margin-top: 18px; font-size: 11px; color: #48524c;
          font-family: 'JetBrains Mono', monospace;
        }
        #lifecycle-loginwall .llw-err {
          color: #f87171; font-size: 12px; padding: 10px;
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3);
          border-radius: 8px; margin-bottom: 18px;
        }
        #lifecycle-loginwall .llw-config {
          color: #7a5510; font-size: 11px; padding: 12px;
          background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.4);
          border-radius: 8px; margin-top: 16px; text-align: left;
          font-family: 'JetBrains Mono', monospace; line-height: 1.6;
        }
      </style>
      <div class="llw-card">
        <div class="llw-dot"></div>
        <div class="llw-title">Lifecycle OS</div>
        <h1>Sign in to <em>continue</em></h1>
        <p>Used by the retention growth team. Sign in once with your Google account — the session keeps you signed in across Dashboard, Calendar, and Mailer Studio.</p>
        ${error ? `<div class="llw-err">${error}</div>` : ''}
        <button id="llw-btn" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
            <path fill="#FBBC04" d="M5.84 14.1A6.6 6.6 0 0 1 5.47 12c0-.73.13-1.44.36-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.3 9.14 5.38 12 5.38z"/>
          </svg>
          Sign in with Google
        </button>
        <div class="llw-foot">One-time sign-in · Session persists</div>
        ${window.__SUPABASE__?.url ? '' : `
          <div class="llw-config">
            <b>⚠ Supabase not configured yet.</b><br>
            The login wall is rendered, but no Supabase project URL is set.
            Once provisioned, set <code>SUPABASE_URL</code> + <code>SUPABASE_ANON_KEY</code>
            on Vercel and redeploy. Until then, Google sign-in click will be a no-op.
          </div>
        `}
      </div>
    `;
    document.body.appendChild(wall);

    document.getElementById('llw-btn').onclick = async function () {
      const btn = this;
      btn.disabled = true;
      btn.textContent = 'Redirecting to Google…';
      try {
        if (!window.LifecycleAuth.client) {
          btn.textContent = 'Supabase not configured';
          setTimeout(() => { btn.disabled = false; btn.innerHTML = btn.dataset.original || 'Sign in with Google'; }, 1800);
          return;
        }
        rememberReturnTo();
        const { error } = await window.LifecycleAuth.client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: location.origin + location.pathname },
        });
        if (error) throw error;
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Sign in with Google';
        const err = document.createElement('div');
        err.className = 'llw-err';
        err.textContent = 'Sign-in failed: ' + (e.message || e);
        btn.parentElement.insertBefore(err, btn);
      }
    };
  }

  function removeLoginWall() {
    const w = document.getElementById('lifecycle-loginwall');
    if (w) w.remove();
  }

  // Shown while an OAuth callback is being exchanged, so the login wall never
  // flashes over a successful sign-in that is a beat away from resolving.
  function injectSigningInOverlay() {
    if (document.getElementById('lifecycle-signingin')) return;
    const el = document.createElement('div');
    el.id = 'lifecycle-signingin';
    el.innerHTML = `
      <style>
        #lifecycle-signingin {
          position: fixed; inset: 0; z-index: 9999; background: #ffffff;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 18px; font-family: 'Inter', system-ui, sans-serif; color: #FFFFFF;
        }
        #lifecycle-signingin .lsi-ring {
          width: 40px; height: 40px; border-radius: 50%;
          border: 3px solid rgba(171,135,67,0.25); border-top-color: #6A33D8;
          animation: lsi-spin 0.8s linear infinite;
        }
        @keyframes lsi-spin { to { transform: rotate(360deg); } }
        #lifecycle-signingin .lsi-t { font-size: 13.5px; color: #556059; letter-spacing: 0.02em; }
      </style>
      <div class="lsi-ring"></div>
      <div class="lsi-t">Completing sign-in…</div>
    `;
    document.body.appendChild(el);
  }
  function removeSigningInOverlay() {
    const el = document.getElementById('lifecycle-signingin');
    if (el) el.remove();
  }

  // ─── Supabase bootstrap ─────────────────────────────────────────────
  async function loadSupabaseSDK() {
    if (window.supabase?.createClient) return window.supabase;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
      s.onload = () => resolve(window.supabase);
      s.onerror = () => reject(new Error('failed to load supabase-js'));
      document.head.appendChild(s);
    });
  }

  // Public Supabase config (anon key is safe on the client — it is designed to
  // ship in the browser and is already served to every visitor by
  // /api/public-config; RLS protects the data). Used as the LAST-RESORT fallback
  // so sign-in works even when the config fetch is unavailable — e.g. on Vercel
  // preview deployments where Deployment Protection redirects /api/public-config
  // to an auth page (HTML, not JSON), or any transient endpoint failure.
  const PUBLIC_SUPABASE_FALLBACK = {
    url: 'https://fswdwmkgggzyxrdzabnh.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZzd2R3bWtnZ2d6eXhyZHphYm5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3MDQ5MDUsImV4cCI6MjEwMTI4MDkwNX0.KB4za4F7mTjQOY5-gxBoWguGDlgMu_dsyg9Nb-H9614',
  };

  async function getConfig() {
    if (window.__SUPABASE__?.url && window.__SUPABASE__?.anonKey) return window.__SUPABASE__;
    try {
      const res = await fetch('/api/public-config');
      // Only trust a real JSON response — a protection/redirect page returns
      // HTML, which must NOT be treated as "no config" and must not throw.
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        if (data?.supabase?.url && data?.supabase?.anonKey) {
          window.__SUPABASE__ = data.supabase;
          return data.supabase;
        }
      }
    } catch { /* fall through to the public fallback below */ }
    // Last resort: the baked-in public config (keeps sign-in working on preview
    // deployments and offline). Real env-provided config always wins above.
    // NOT on localhost / file:// — there, returning null preserves the existing
    // "local preview" path (inject the top-bar, no login wall), which local dev
    // and the Playwright suite rely on. The fallback is only for real hosts
    // (preview/production) where /api/public-config may be blocked.
    const isLocalHost = location.protocol === 'file:' ||
      /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
    if (!isLocalHost && PUBLIC_SUPABASE_FALLBACK.url && PUBLIC_SUPABASE_FALLBACK.anonKey) {
      window.__SUPABASE__ = PUBLIC_SUPABASE_FALLBACK;
      return PUBLIC_SUPABASE_FALLBACK;
    }
    return null;
  }

  // ─── Access mode ─────────────────────────────────────────────────────────
  // Every signed-in user gets full, live access. The former demo/mock-mode
  // gate (which simulated write/generation calls for non-knickgasm.com accounts),
  // its fetch guard, and the demo banner have been removed. The mockMode /
  // __KNICKGASM_MOCK__ flags are kept, pinned to false, so anything that still
  // reads them simply sees "live".
  function applyAccessMode(user) {
    window.LifecycleAuth.internal = !!user;
    window.LifecycleAuth.mockMode = false;
    window.__KNICKGASM_MOCK__ = false;
  }

  // ─── OAuth redirect helpers (issue: sign-in not landing correctly) ──────
  // True while the browser is on a Supabase OAuth callback (PKCE ?code=, an
  // ?error=, or an implicit #access_token). During this window we must NOT
  // flash the login wall — detectSessionInUrl is exchanging the code and
  // onAuthStateChange will fire SIGNED_IN momentarily.
  function oauthCallbackInProgress() {
    try {
      const sp = new URLSearchParams(location.search || '');
      if (sp.has('code') || sp.has('error') || sp.has('error_description')) return true;
      const hash = location.hash || '';
      if (/access_token=|error=/.test(hash)) return true;
    } catch (_) {}
    return false;
  }
  // Remember where the user was so we can send them back after Google bounces
  // them to the Supabase Site URL (which happens when the exact path is not in
  // the redirect allow-list).
  function rememberReturnTo() {
    try { localStorage.setItem('lc-return-to', location.pathname + location.search + location.hash); } catch (_) {}
  }
  function restoreReturnTo() {
    let target = null;
    try { target = localStorage.getItem('lc-return-to'); localStorage.removeItem('lc-return-to'); } catch (_) {}
    if (!target) return;
    const targetPath = target.split('?')[0].split('#')[0];
    // Only redirect if we actually landed somewhere else (avoid loops / no-ops).
    if (targetPath && targetPath !== location.pathname) {
      location.replace(target);
    }
  }

  async function init() {
    window.LifecycleAuth = {
      client: null,
      session: null,
      user: null,
      internal: false,
      mockMode: false,
      signOut: async () => {
        if (window.LifecycleAuth.client) await window.LifecycleAuth.client.auth.signOut();
        window.LifecycleAuth.session = null;
        window.LifecycleAuth.user = null;
        // Drop this account's cached brand. A browser is often shared, and the
        // brand payload carries voice rules, regions and store URLs, so it must
        // not survive into the next person's session.
        try { if (window.BrandContext && window.BrandContext.clearCache) window.BrandContext.clearCache(); } catch (_) {}
        try { localStorage.removeItem('lc-brand-context'); localStorage.removeItem('lc-credits'); } catch (_) {}
        applyAccessMode(null);
        location.reload();
      },
    };

    const config = await getConfig();
    if (!config) {
      // No Supabase configured. On localhost / file:// (dev preview) there is no
      // backend to sign in against, so inject the cross-step top-bar and let the
      // UI run — exactly as the team would see it post-login. Open pages (Mailer
      // Studio) also never gate. In production (a real host) the other steps
      // still require sign-in, so show the wall there.
      const isLocal = location.protocol === 'file:' ||
        /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
      if (isLocal) {
        injectTopbar({ email: 'local@preview', user_metadata: { name: 'Local preview' } });
        return;
      }
      if (isOpenPage()) { injectTopbar(null); return; }
      injectLoginWall();
      return;
    }

    const sdk = await loadSupabaseSDK();
    const client = sdk.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
    window.LifecycleAuth.client = client;

    // Post-OAuth redirect is handled automatically by detectSessionInUrl:true
    // above (it exchanges the PKCE ?code= and cleans the URL). Calling
    // exchangeCodeForSession() again here would double-consume the single-use
    // code and fail — so we just wait for getSession() to resolve the session.
    const { data: { session } } = await client.auth.getSession();
    if (session?.user) {
      window.LifecycleAuth.session = session;
      window.LifecycleAuth.user = session.user;
      applyAccessMode(session.user);
      injectTopbar(session.user);
      restoreReturnTo();
      // Keep the Studio frictionless: only prompt for profile on the gated steps.
      if (!isOpenPage()) await maybeShowProfileModal(client, session.user);
    } else if (oauthCallbackInProgress()) {
      // Mid sign-in: the PKCE code is being exchanged by detectSessionInUrl and
      // onAuthStateChange will fire SIGNED_IN shortly. Show a "completing" state
      // rather than flashing the login wall. Fall back to the wall if the
      // exchange never resolves (bad/expired code).
      injectSigningInOverlay();
      setTimeout(async () => {
        const { data: { session: s2 } } = await client.auth.getSession();
        if (!s2?.user && !window.LifecycleAuth.session) {
          removeSigningInOverlay();
          if (!isOpenPage()) injectLoginWall('Sign-in did not complete. Please try again.');
          else injectTopbar(null);
        }
      }, 4500);
    } else if (isOpenPage()) {
      // Open feature (Mailer Studio) — no sign-in required; show nav as guest.
      injectTopbar(null);
    } else {
      injectLoginWall();
    }

    // Listen for sign-in / sign-out and react globally.
    client.auth.onAuthStateChange(async (_event, sess) => {
      window.LifecycleAuth.session = sess;
      window.LifecycleAuth.user = sess?.user || null;
      applyAccessMode(sess?.user || null);
      if (sess?.user) {
        removeSigningInOverlay();
        removeLoginWall();
        const existing = document.getElementById('lifecycle-nav');
        if (existing) existing.remove();   // rebuild so the guest "Sign in" becomes the user chip
        injectTopbar(sess.user);
        restoreReturnTo();
        if (!isOpenPage()) await maybeShowProfileModal(client, sess.user);
      } else {
        const tb = document.getElementById('lifecycle-nav');
        if (tb) tb.remove();
        if (isOpenPage()) injectTopbar(null);   // stay open — no wall on the Studio
        else injectLoginWall();
      }
    });
  }

  // ─── Profile modal — shown EXACTLY ONCE, after the user signs up ────────
  // Requirement: the profile popup appears only the first time a user signs
  // up + logs in. After that it must never auto-appear again — whether they
  // filled it or skipped it, on this device or any other.
  //
  // Source of truth is the server flag app_users.profile_prompted. It is set
  // true the moment the popup is shown for the first time. Subsequent logins,
  // even on a fresh device, read profile_prompted=true and skip the modal.
  // A local-storage flag (per user) is kept as a fast path so we do not even
  // round-trip to the DB on subsequent pages of the same session.
  function shownKey(user) { return 'lifecycle-profile-shown:' + (user?.id || 'anon'); }
  async function maybeShowProfileModal(client, user) {
    let alreadyLocal = false;
    try { alreadyLocal = localStorage.getItem(shownKey(user)) === '1'; } catch {}
    if (alreadyLocal) return;

    let row;
    try {
      const { data, error } = await client
        .from('app_users')
        .select('profile_completed, profile_prompted, name, mobile, region')
        .eq('id', user.id)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') {
        console.warn('[auth.js] app_users not readable:', error.message);
        return;
      }
      row = data;
    } catch (e) {
      console.warn('[auth.js] profile check failed:', e.message);
      return;
    }

    // Server says we have already prompted this user, OR profile is complete →
    // remember locally and never auto-show again.
    if (row?.profile_prompted || row?.profile_completed) {
      try { localStorage.setItem(shownKey(user), '1'); } catch {}
      return;
    }

    // Brand-new signup → show the popup ONCE, and mark prompted on both server
    // and device so it can never reappear on any future login.
    try { localStorage.setItem(shownKey(user), '1'); } catch {}
    client.from('app_users').update({ profile_prompted: true }).eq('id', user.id)
      .then(() => {}, () => {});
    showProfileModal(client, user, row);
  }

  function showProfileModal(client, user, currentRow) {
    if (document.getElementById('lifecycle-profile-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'lifecycle-profile-modal';
    modal.innerHTML = `
      <style>
        #lifecycle-profile-modal {
          position: fixed; inset: 0; z-index: 9000;
          background: rgba(0,0,0,0.72); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center; padding: 20px;
          font-family: 'Inter', system-ui, sans-serif;
        }
        #lifecycle-profile-modal .lpm-card {
          max-width: 460px; width: 100%;
          background: #ffffff; border: 1px solid rgba(171,135,67,0.25);
          border-radius: 14px; padding: 28px 26px; box-shadow: 0 30px 80px rgba(0,0,0,0.6);
        }
        #lifecycle-profile-modal .lpm-eyebrow { font-size: 11px; letter-spacing: 0.18em; color: #6A33D8; text-transform: uppercase; font-weight: 700; margin-bottom: 6px; }
        #lifecycle-profile-modal h2 { font-family: 'Lora','Inter',serif; font-size: 22px; color: #FFFFFF; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
        #lifecycle-profile-modal h2 em { color: #6A33D8; font-style: italic; }
        #lifecycle-profile-modal .lpm-sub { color: #556059; font-size: 13px; line-height: 1.55; margin: 0 0 18px; }
        #lifecycle-profile-modal label { display: block; font-size: 11px; color: #48524c; text-transform: uppercase; letter-spacing: 0.1em; margin: 12px 0 5px; font-weight: 600; }
        #lifecycle-profile-modal input, #lifecycle-profile-modal select {
          width: 100%; box-sizing: border-box;
          background: #ffffff; border: 1px solid rgba(171,135,67,0.2); border-radius: 8px;
          color: #111111; padding: 10px 12px; font-size: 13px; font-family: inherit;
        }
        #lifecycle-profile-modal input:focus, #lifecycle-profile-modal select:focus { outline: none; border-color: #6A33D8; }
        #lifecycle-profile-modal .lpm-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        #lifecycle-profile-modal .lpm-actions { display: flex; gap: 10px; margin-top: 22px; }
        #lifecycle-profile-modal button { font-family: inherit; font-size: 12.5px; padding: 11px 18px; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; letter-spacing: 0.02em; transition: opacity .15s; }
        #lifecycle-profile-modal .lpm-skip   { background: transparent; color: #556059; border: 1px solid rgba(171,135,67,0.25); }
        #lifecycle-profile-modal .lpm-skip:hover { color: #111111; }
        #lifecycle-profile-modal .lpm-save   { background: #6A33D8; color: #ffffff; flex: 1; }
        #lifecycle-profile-modal .lpm-save:hover { opacity: 0.92; }
        #lifecycle-profile-modal .lpm-foot { font-size: 11px; color: #48524c; margin-top: 14px; text-align: center; font-family: 'JetBrains Mono', monospace; }
        #lifecycle-profile-modal .lpm-err { color: #f87171; font-size: 12px; margin-top: 10px; padding: 8px; background: rgba(239,68,68,0.08); border-radius: 6px; }
      </style>
      <div class="lpm-card">
        <div class="lpm-eyebrow">Welcome to Lifecycle OS</div>
        <h2>Tell us a bit about <em>you</em></h2>
        <p class="lpm-sub">Helps us tailor the dashboard, calendar, and mailer suggestions to your region.
          <b>Skip anytime</b> — nothing here is required.</p>

        <label for="lpm-name">Name</label>
        <input id="lpm-name" type="text" placeholder="${(user.user_metadata?.name || '').replace(/"/g, '&quot;')}" value="${(currentRow?.name || user.user_metadata?.name || '').replace(/"/g, '&quot;')}" autocomplete="name">

        <div class="lpm-row">
          <div>
            <label for="lpm-mobile">Mobile</label>
            <input id="lpm-mobile" type="tel" placeholder="+91 98xxx-xxxxx" value="${(currentRow?.mobile || '').replace(/"/g, '&quot;')}" autocomplete="tel">
          </div>
          <div>
            <label for="lpm-region">Region</label>
            <select id="lpm-region">
              <option value="">—</option>
              <option value="IN">India</option>
              <option value="US">United States</option>
              <option value="UK">United Kingdom</option>
              <option value="EU">Europe</option>
              <option value="ME">Middle East</option>
              <option value="AU">Australia</option>
              <option value="CA">Canada</option>
              <option value="JP">Japan</option>
              <option value="SG">Singapore</option>
              <option value="Global">Other / Global</option>
            </select>
          </div>
        </div>

        <div id="lpm-err"></div>
        <div class="lpm-actions">
          <button class="lpm-skip" id="lpm-skip-btn" type="button">Skip for now</button>
          <button class="lpm-save" id="lpm-save-btn" type="button">Save profile</button>
        </div>
        <div class="lpm-foot">Stored only in your app_users row · visible only to you</div>
      </div>
    `;
    document.body.appendChild(modal);

    // Pre-fill region from previous row if any
    if (currentRow?.region) {
      modal.querySelector('#lpm-region').value = currentRow.region;
    }

    const close = () => modal.remove();

    modal.querySelector('#lpm-skip-btn').addEventListener('click', () => {
      // The "shown once" flag was already set in maybeShowProfileModal, so the
      // popup will not auto-appear again. Skipping just closes it; the user can
      // still fill their profile later if a profile entry point is added.
      try { localStorage.setItem(shownKey(user), '1'); } catch {}
      close();
    });

    modal.querySelector('#lpm-save-btn').addEventListener('click', async function () {
      const btn = this;
      btn.disabled = true; btn.textContent = 'Saving…';
      const name   = modal.querySelector('#lpm-name').value.trim()   || null;
      const mobile = modal.querySelector('#lpm-mobile').value.trim() || null;
      const region = modal.querySelector('#lpm-region').value        || null;
      try {
        const { error } = await client.from('app_users').update({
          name, mobile, region,
          profile_completed: true,
        }).eq('id', user.id);
        if (error) throw error;
        close();
      } catch (e) {
        const err = modal.querySelector('#lpm-err');
        err.className = 'lpm-err';
        err.textContent = 'Could not save: ' + (e.message || e);
        btn.disabled = false; btn.textContent = 'Save profile';
      }
    });
  }


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ── Markdown downloads render as PDF (print), for far better formatting ──────
// Product-owner rule: any markdown a user would "download" should instead come
// out as a nicely-formatted PDF. This self-contained block (no external libs,
// CSP-safe) (1) intercepts clicks on any <a href="*.md"> and (2) exposes
// window.__mdToPdf(text, title) for client-generated markdown (e.g. the social
// blog export). Both render the markdown to styled HTML in a new tab and open
// the print dialog, where the user saves as PDF.
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function inline(s) {
    // bold, italics, inline code, links — applied to already-escaped text.
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  }
  function mdToHtml(md) {
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [], i = 0;
    function flushList(tag, items) { if (items.length) out.push('<' + tag + '>' + items.map(function (x) { return '<li>' + inline(esc(x)) + '</li>'; }).join('') + '</' + tag + '>'); }
    while (i < lines.length) {
      var ln = lines[i];
      // Table block: a header row of pipes followed by a --- separator.
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        var cells = function (r) { return r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); }); };
        var head = cells(ln); i += 2; var body = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { body.push(cells(lines[i])); i++; }
        out.push('<table><thead><tr>' + head.map(function (h) { return '<th>' + inline(esc(h)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          body.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(esc(c)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>');
        continue;
      }
      var h = ln.match(/^(#{1,6})\s+(.*)$/);
      if (h) { out.push('<h' + h[1].length + '>' + inline(esc(h[2])) + '</h' + h[1].length + '>'); i++; continue; }
      if (/^\s*(---|___|\*\*\*)\s*$/.test(ln)) { out.push('<hr>'); i++; continue; }
      if (/^\s*[-*]\s+/.test(ln)) { var ul = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { ul.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; } flushList('ul', ul); continue; }
      if (/^\s*\d+\.\s+/.test(ln)) { var ol = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { ol.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; } flushList('ol', ol); continue; }
      if (/^\s*$/.test(ln)) { i++; continue; }
      var para = []; while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) { para.push(lines[i]); i++; }
      out.push('<p>' + inline(esc(para.join(' '))) + '</p>');
    }
    return out.join('\n');
  }
  var CSS = 'body{font-family:"Instrument Sans","Helvetica Neue",Arial,sans-serif;color:#111111;max-width:820px;margin:32px auto;padding:0 28px;line-height:1.6;}' +
    'h1,h2,h3,h4{font-family:"Montserrat","Raleway",Georgia,serif;color:#D0473E;line-height:1.25;margin:1.4em 0 .4em;}' +
    'h1{font-size:28px;border-bottom:2px solid #6A33D8;padding-bottom:8px;}h2{font-size:21px;}h3{font-size:17px;}' +
    'table{border-collapse:collapse;width:100%;margin:14px 0;font-size:13px;}th,td{border:1px solid #d9cba8;padding:7px 10px;text-align:left;vertical-align:top;}' +
    'th{background:#FFFFFF;color:#D0473E;}code{background:#f3eede;padding:1px 5px;border-radius:4px;font-size:.92em;}' +
    'a{color:#D0473E;}hr{border:0;border-top:1px solid #e5ddc7;margin:22px 0;}strong{color:#1b1612;}' +
    '.pdfbar{position:fixed;top:0;left:0;right:0;background:#D0473E;color:#fff;padding:10px 16px;font-size:13px;text-align:center;}' +
    '.pdfbar button{background:#6A33D8;color:#111111;border:0;border-radius:6px;padding:7px 16px;font-weight:700;cursor:pointer;margin-left:8px;}' +
    '@media print{.pdfbar{display:none;}body{margin:0;}}';
  function openPrintable(title, bodyHtml) {
    var w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to download the PDF.'); return; }
    w.document.open();
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + CSS + '</style></head><body>' +
      '<div class="pdfbar">Formatted for PDF — use your browser’s <b>Save as PDF</b><button onclick="window.print()">⬇ Save as PDF</button></div>' +
      '<div style="height:44px"></div>' + bodyHtml +
      '<scr' + 'ipt>window.addEventListener("load",function(){setTimeout(function(){try{window.print();}catch(e){}},400);});</scr' + 'ipt>' +
      '</body></html>');
    w.document.close();
  }
  window.__mdToPdf = function (mdText, title) { openPrintable(title || 'Lifecycle OS document', mdToHtml(mdText)); };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href$=".md"]') : null;
    if (!a) return;
    var url = a.getAttribute('href') || '';
    if (/^https?:\/\//i.test(url) && url.indexOf(location.origin) !== 0) return; // leave truly external links alone
    e.preventDefault();
    var title = (a.textContent || 'Lifecycle OS document').replace(/[⬇📄📖🧾👥🎁🖼📊]/g, '').trim().slice(0, 90) || 'Lifecycle OS document';
    fetch(url).then(function (r) { return r.text(); }).then(function (t) { window.__mdToPdf(t, title); }).catch(function () { window.open(url, '_blank'); });
  }, true);
})();
