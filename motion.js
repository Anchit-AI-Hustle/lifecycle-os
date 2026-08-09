/* motion.js — Lifecycle OS shared motion + depth layer (Design DNA / Motion).
 * Loaded on every page by auth.js. STRICTLY ADDITIVE and fail-safe:
 *  - Content is only ever hidden-then-revealed when JS is running AND the user has
 *    NOT asked for reduced motion. If JS fails or is disabled, nothing is hidden.
 *  - A hard safety timer reveals every tracked element after 3.5s, so content can
 *    never get stuck invisible (e.g. an element an observer missed).
 *  - Nav, the LHS rail, headers, overlays and fixed/sticky chrome are excluded.
 *  - GSAP (ScrollTrigger) is loaded ONLY when a page actually uses [data-parallax];
 *    if it fails to load, reveals still work. Zero hard dependency.
 * Genjutsu-style depth = the cubic-bezier(.16,1,.3,1) rise + optional scrub parallax.
 */
(function () {
  'use strict';
  if (window.__vhMotionBooted) return;
  window.__vhMotionBooted = true;

  var root = document.documentElement;
  // Skip the frozen diff snapshot (self-themed, pinned reference).
  if (/(^|\/)diff-version(\/|\.html|$)/.test(location.pathname)) return;
  // Explicit page opt-out.
  if (root.getAttribute('data-motion') === 'off') return;

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (reduce) { root.classList.add('vh-reduce'); return; } // CSS keeps everything visible

  // Reveal GRANULAR items (cards, tiles, headings) — never big <section> wrappers,
  // whose block-level opacity would hide their own children before they reveal.
  var REVEAL_SEL = [
    '.card', '[class*="card"]', '.tile', '[class*="tile"]',
    '.kpi', '.sig', '.w', '.pcard', '.coltile', '.metric', '.stat',
    'main h1', 'main h2', '.sec-h', '.sec-eyebrow', '.sec-sub'
  ].join(',');
  var MAX_TRACK = 160; // cap work on very large pages
  var io = null, tracked = [], booted = false;

  function excluded(el) {
    if (el.__vhReveal) return true;
    if (el.closest('#lifecycle-nav, nav, header, .topbar, .lnav, [data-no-motion]')) return true;
    var cs;
    try { cs = getComputedStyle(el); } catch (_) { return true; }
    if (cs.position === 'fixed' || cs.position === 'sticky') return true;
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    // skip nested reveal targets (a revealed ancestor already animates this)
    if (el.parentElement && el.parentElement.closest('.vh-reveal')) return true;
    return false;
  }

  function markAndObserve(el, idxInParent) {
    el.__vhReveal = true;
    el.classList.add('vh-reveal');
    el.style.setProperty('--vh-delay', Math.min((idxInParent || 0) * 55, 320) + 'ms');
    tracked.push(el);
    if (io) io.observe(el); else el.classList.add('vh-in');
  }

  function scan() {
    if (tracked.length >= MAX_TRACK) return;
    var nodes = document.querySelectorAll(REVEAL_SEL);
    var perParent = new Map();
    for (var i = 0; i < nodes.length && tracked.length < MAX_TRACK; i++) {
      var el = nodes[i];
      if (excluded(el)) continue;
      var p = el.parentNode;
      var n = perParent.get(p) || 0; perParent.set(p, n + 1);
      markAndObserve(el, n);
    }
  }

  function loadGSAPIfNeeded() {
    if (!document.querySelector('[data-parallax]')) return; // opt-in only
    if (window.gsap && window.ScrollTrigger) return enhanceParallax();
    var base = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/';
    inject(base + 'gsap.min.js', function () {
      inject(base + 'ScrollTrigger.min.js', enhanceParallax, noop);
    }, noop);
  }
  function inject(src, ok, fail) {
    var s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = ok || noop; s.onerror = fail || noop; document.head.appendChild(s);
  }
  function noop() {}
  function enhanceParallax() {
    if (!window.gsap || !window.ScrollTrigger) return;
    try { gsap.registerPlugin(ScrollTrigger); } catch (_) { return; }
    document.querySelectorAll('[data-parallax]').forEach(function (el) {
      if (el.__vhParallax) return; el.__vhParallax = true;
      var depth = parseFloat(el.getAttribute('data-parallax')) || 0.2;
      try {
        gsap.to(el, { yPercent: -depth * 100, ease: 'none',
          scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
      } catch (_) {}
    });
  }

  function boot() {
    if (booted) return; booted = true;
    root.classList.add('vh-motion-ready');
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (ents) {
        ents.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('vh-in'); io.unobserve(e.target); } });
      }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    }
    scan();
    loadGSAPIfNeeded();

    // Re-scan for late/dynamically-injected content (debounced, time-boxed).
    var t = null;
    var mo = new MutationObserver(function () {
      if (t) return;
      t = setTimeout(function () { t = null; scan(); loadGSAPIfNeeded(); }, 250);
    });
    try { mo.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
    setTimeout(function () { try { mo.disconnect(); } catch (_) {} }, 15000);

    // HARD SAFETY: never leave tracked content hidden.
    setTimeout(function () { tracked.forEach(function (el) { el.classList.add('vh-in'); }); }, 3500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
