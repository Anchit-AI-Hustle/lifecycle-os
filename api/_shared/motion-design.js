'use strict';

/**
 * motion-design.js — depth, motion and interaction for every generated asset,
 * defined ONCE and consumed by the mailer renderers, the landing-page builder,
 * the static ad compositor and the animated video unit.
 *
 * ── What "3D/4D/5D" means here, concretely ──────────────────────────────────
 *   3D  depth      perspective/translateZ parallax, layered lighting, tilt
 *   4D  motion     time-based animation (keyframes, kinetic type, light sweeps)
 *   5D  response   the asset reacts to the viewer (scroll position, pointer)
 *
 * ── The honesty constraint that shapes the split ────────────────────────────
 * Email clients run NO JavaScript and most strip scroll behaviour, so "scroll
 * effects in a mailer" is not a thing that can ship — a mailer built that way
 * would simply break in Gmail and Outlook. Each surface therefore gets the
 * richest layer its medium actually supports:
 *
 *   mailers        4D motion via CSS keyframes (Apple Mail & friends) with a
 *                  STATIC-COMPLETE fallback, plus 3D-feel depth from layered
 *                  light and shadow, which renders everywhere.
 *   landing pages  the full set: scroll-driven reveals, parallax hero, pointer
 *                  tilt — this is where scroll effects genuinely live.
 *   static ads     3D depth: vignette, directional light, accent edge glow, film
 *                  grain. Composed units, so no client restrictions.
 *   video units    true 3D parallax: perspective + translateZ layer separation
 *                  on top of the existing Ken Burns / kinetic type.
 *
 * ── The email rule that must never be broken ────────────────────────────────
 * The hidden "before" state of an entrance animation (opacity:0) must live
 * INSIDE the same gated @media block as its @keyframes. A client that keeps
 * inline/embedded styles but strips animation would otherwise paint the mailer
 * permanently invisible. Every class below follows that rule, and the test
 * suite renders with animations disabled to prove the fallback is complete.
 */

// ── Mailers: email-safe 4D + depth ──────────────────────────────────────────
// Gate: `screen` excludes print; prefers-reduced-motion respects the reader's
// OS setting. Outlook (Word engine) ignores <style> media blocks entirely and
// gets the static design, which is complete on its own.
const EMAIL_MOTION_GATE = '@media screen and (prefers-reduced-motion: no-preference)';

function emailMotionCss() {
  return [
    EMAIL_MOTION_GATE + '{',
    // Entrance: rise + settle. Hidden state INSIDE the gate (see module doc).
    '.mx-rise{opacity:0;animation:mxRise .8s cubic-bezier(.22,.9,.32,1) forwards}',
    '.mx-rise-2{opacity:0;animation:mxRise .8s cubic-bezier(.22,.9,.32,1) .15s forwards}',
    '.mx-rise-3{opacity:0;animation:mxRise .8s cubic-bezier(.22,.9,.32,1) .3s forwards}',
    '@keyframes mxRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
    // CTA light sweep: a moving highlight across the button face. Pure
    // background-position animation, so the static frame is just the button.
    '.mx-shine{background-size:200% 100%!important;animation:mxShine 3.2s ease-in-out 1.2s 2}',
    '@keyframes mxShine{0%{background-position:120% 0}100%{background-position:-80% 0}}',
    // Gentle float for accents (badges, logo marks): 6s, small amplitude,
    // so it reads as life rather than distraction.
    '.mx-float{animation:mxFloat 6s ease-in-out infinite}',
    '@keyframes mxFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}',
    '}',
  ].join('\n');
}

// Depth that renders in EVERY client, including Outlook: light and shadow are
// plain CSS backgrounds/box-shadows, no animation involved. Palette-safe: the
// glows are derived from the brand's own accent and primary, shadows are neutral black alpha
// (a shadow is not a section background, so the no-dark-backgrounds rule is
// untouched).
const emailDepth = {
  // Radial light falling on the hero band from the top: turns a flat colorway
  // into a lit stage. `base` is the band's own colour, so the light never
  // introduces an off-palette tint - it only brightens what is already there.
  heroLight(base) {
    return `background-image:radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,.14) 0%, rgba(255,255,255,.05) 38%, rgba(0,0,0,.12) 100%);background-color:${base};`;
  },
  // Card lift: two shadows (ambient + key) plus a hairline accent edge. Reads as
  // a physical card on every engine that supports box-shadow; degrades to the
  // border alone on engines that do not.
  cardLift(accent) {
    return `border:1px solid ${accent}55;box-shadow:0 1px 2px rgba(23,23,23,.06),0 12px 28px -14px rgba(23,23,23,.28);`;
  },
  // CTA face for the shine sweep: the brand primary with an accent highlight band that
  // the mx-shine animation moves. Static clients just see the primary button.
  ctaShineFace(primary, accent) {
    return `background-image:linear-gradient(105deg,${primary} 40%,${accent}66 50%,${primary} 60%);background-color:${primary};`;
  },
};

// ── Landing pages: full 3D/4D/5D ────────────────────────────────────────────
// No-JS safety: the reveal classes only hide content when the <html> element
// carries .sx-on, which is added BY the script itself. No JS -> no .sx-on ->
// everything visible. Reduced-motion users get instant reveals.
function landingMotionCss() {
  return [
    'html.sx-on .sx{opacity:0;transform:translateY(26px);transition:opacity .7s cubic-bezier(.22,.9,.32,1),transform .7s cubic-bezier(.22,.9,.32,1)}',
    'html.sx-on .sx.sx-in{opacity:1;transform:none}',
    'html.sx-on .sx-l{transform:translateX(-30px) translateY(8px)}',
    'html.sx-on .sx-r{transform:translateX(30px) translateY(8px)}',
    'html.sx-on .sx-l.sx-in,html.sx-on .sx-r.sx-in{transform:none}',
    // 3D tilt cards: perspective on the parent, transform set by JS.
    '.tilt3d{transform-style:preserve-3d;transition:transform .35s ease,box-shadow .35s ease;will-change:transform}',
    '.tilt3d:hover{box-shadow:0 24px 48px -20px rgba(23,23,23,.35)}',
    // Parallax hero layers: translated by scroll JS; harmless static without it.
    '.plx{will-change:transform}',
    '@media (prefers-reduced-motion: reduce){html.sx-on .sx{opacity:1;transform:none;transition:none}.tilt3d,.plx{transform:none!important;transition:none}}',
  ].join('\n');
}

function landingMotionJs() {
  // Plain ES5-ish, inlined into the page; no dependencies. Everything is
  // feature-detected and wrapped so a very old browser simply gets the static page.
  return `(function(){
  try{
    var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('sx-on');
    var io = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('sx-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    var els = document.querySelectorAll('.sx');
    for (var i=0;i<els.length;i++){ els[i].style.transitionDelay = ((i%4)*70)+'ms'; io.observe(els[i]); }
    if (reduced) return; // reveals still fire (instantly, via CSS); skip parallax + tilt
    // Parallax: hero layers drift at different rates. rAF-throttled.
    var plx = [].slice.call(document.querySelectorAll('[data-plx]'));
    if (plx.length){ var tick=false;
      var onScroll=function(){ if(tick) return; tick=true;
        requestAnimationFrame(function(){ tick=false; var y=window.pageYOffset||0;
          plx.forEach(function(el){ var f=parseFloat(el.getAttribute('data-plx'))||0.2;
            el.style.transform='translate3d(0,'+(y*f).toFixed(1)+'px,0)'; }); }); };
      addEventListener('scroll', onScroll, {passive:true}); onScroll(); }
    // 5D: pointer tilt on product cards. Small angles; resets on leave.
    [].slice.call(document.querySelectorAll('.tilt3d')).forEach(function(card){
      card.addEventListener('mousemove', function(ev){
        var r=card.getBoundingClientRect();
        var rx=((ev.clientY-r.top)/r.height-.5)*-7, ry=((ev.clientX-r.left)/r.width-.5)*9;
        card.style.transform='perspective(900px) rotateX('+rx.toFixed(2)+'deg) rotateY('+ry.toFixed(2)+'deg) translateZ(6px)';
      });
      card.addEventListener('mouseleave', function(){ card.style.transform=''; });
    });
  }catch(_){/* static page is the fallback for everything above */}
})();`;
}

// ── Static ads: 3D depth stack ──────────────────────────────────────────────
// Layered over the hero inside the composed unit. All static, so it survives
// screenshotting/export to PNG unchanged. Grain is an inline SVG feTurbulence
// data URI — no external request, keeps the unit self-contained.
// The data URI lives inside a DOUBLE-quoted style="" attribute, so it must
// contain no raw quote of either kind: an inner double quote terminates the
// attribute (Codex caught exactly that — the grain never rendered), and a raw
// single quote would collide with the url('') delimiter. Every internal quote
// is percent-encoded (%27) instead.
const AD_GRAIN =
  "url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%27120%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%272%27/%3E%3CfeColorMatrix values=%270 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.05 0%27/%3E%3C/filter%3E%3Crect width=%27120%27 height=%27120%27 filter=%27url(%23n)%27/%3E%3C/svg%3E')";

function adDepthLayers(accent) {
  // Order matters: light falls first, vignette frames, grain unifies, the accent
  // hairline reads as print finishing. pointer-events:none throughout.
  const layer = (style) => `<div style="position:absolute;inset:0;pointer-events:none;${style}"></div>`;
  return [
    // Directional key light from the upper left - gives the flat hero a lit,
    // dimensional read without touching the palette.
    layer('background:radial-gradient(90% 70% at 28% 8%, rgba(255,255,255,.16) 0%, rgba(255,255,255,0) 55%);'),
    // Cinematic vignette: pulls the eye to centre, deepens the scrim corners.
    layer('background:radial-gradient(130% 110% at 50% 45%, rgba(0,0,0,0) 58%, rgba(0,0,0,.32) 100%);'),
    // Film grain: kills the "flat digital gradient" look on large fills.
    layer(`background-image:${AD_GRAIN};opacity:.5;mix-blend-mode:overlay;`),
    // Accent interior hairline: a finishing edge, inset so exports keep it.
    layer(`border:1px solid ${accent}59;border-radius:inherit;margin:10px;`),
  ].join('');
}

// ── Video units: true 3D parallax ───────────────────────────────────────────
// The scene gets perspective; each visual layer sits at its own depth and
// scales to compensate (translateZ shrinks apparent size, the scale factor
// restores footprint), so layers separate in Z instead of only sliding in X/Y.
function video3dCss() {
  return [
    '.scene3d{perspective:1000px;perspective-origin:50% 42%}',
    '.z-back{transform:translateZ(-140px) scale(1.14)}',
    '.z-mid{transform:translateZ(-60px) scale(1.06)}',
    '.z-front{transform:translateZ(40px) scale(.96)}',
    '@keyframes zdrift{0%{transform:translateZ(-140px) scale(1.14) translateX(0)}100%{transform:translateZ(-140px) scale(1.14) translateX(-2.2%)}}',
  ].join('\n');
}

module.exports = {
  EMAIL_MOTION_GATE, emailMotionCss, emailDepth,
  landingMotionCss, landingMotionJs,
  adDepthLayers, AD_GRAIN,
  video3dCss,
};
