'use strict';
/**
 * render-stabilise.js — ONE frozen state, for the site AND for our clone.
 * ---------------------------------------------------------------------------
 * A measurement is only comparable with another taken in the same state. A
 * page in motion (a transition half-way, a carousel between slides, a clock in
 * the hero, a random A/B pick) gives a different answer every time it is read,
 * and a comparison between two moving things measures the motion. So both
 * sides of every comparison - the brand's site as captured, and our landing
 * page / mailers / ad as rendered for the regression - go through the SAME
 * three steps:
 *
 *   install(context)  before any page loads: Date, performance.now and
 *                     Math.random are pinned (a fixed epoch, a seeded PRNG).
 *                     The clocks ADVANCE 1 ms per read rather than stopping
 *                     dead, so a page that busy-waits on Date.now() still
 *                     terminates; the sequence is the same on every run.
 *   stabilise(page)   after load: network idle and web fonts (each bounded),
 *                     every animation and transition zeroed and the running
 *                     ones finished (finite) or cancelled (infinite), fixed
 *                     and sticky CONSENT overlays hidden, two frames settled.
 *   consent           an overlay is HIDDEN in this throwaway context, never
 *                     dismissed by clicking its button: pressing "accept" is
 *                     consenting to tracking on someone's behalf, and a hidden
 *                     element also cannot lend its colours to the brand (a
 *                     consent banner's black-and-orange is the CMP vendor's,
 *                     not the brand's - the 40-brand harvest found exactly that).
 */

const EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0);   // 2026-01-01T00:00:00Z
const SEED = 0x9e3779b9;

/** The init script (a string, so it is sent to the page as written). */
const INIT = `(() => {
  if (window.__lcosStable) return;
  const EPOCH = ${EPOCH};
  let tick = 0;
  const now = () => EPOCH + (tick++);
  const RD = Date;
  function D(...a) {
    if (!new.target) return new RD(now()).toString();
    return a.length ? new RD(...a) : new RD(now());
  }
  D.prototype = RD.prototype;
  D.now = now; D.parse = RD.parse; D.UTC = RD.UTC;
  try { Object.defineProperty(window, 'Date', { value: D, configurable: true, writable: true }); } catch (_) { window.Date = D; }
  let ptick = 0;
  try { const p = Object.getPrototypeOf(performance); Object.defineProperty(p, 'now', { value: () => (ptick += 1), configurable: true }); } catch (_) { /* leave it */ }
  let s = ${SEED} >>> 0;
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__lcosStable = { epoch: EPOCH };
})();`;

async function install(context) {
  await context.addInitScript({ content: INIT });
}

/** In the page: freeze motion, hide consent overlays, report what was done. */
function freezeInPage() {
  const out = { animations_finished: 0, animations_cancelled: 0, consent_hidden: [], clock: '', random: 0 };
  try {
    if (!document.querySelector('style[data-lcos="freeze"]')) {
      const s = document.createElement('style');
      s.setAttribute('data-lcos', 'freeze');
      s.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important;caret-color:transparent!important}'
        + '[data-lcos-hidden]{display:none!important}';
      (document.head || document.documentElement).appendChild(s);
    }
  } catch (_) { /* a CSP that forbids inline style: the animations are still stopped below */ }
  try {
    for (const a of document.getAnimations()) {
      try {
        const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
        if (t && Number.isFinite(t.endTime)) { a.finish(); out.animations_finished += 1; } else { a.cancel(); out.animations_cancelled += 1; }
      } catch (_) { try { a.cancel(); out.animations_cancelled += 1; } catch (__) { /* gone */ } }
    }
  } catch (_) { /* no Web Animations API */ }
  // Consent overlays: FIXED or STICKY, and named or worded as consent. The
  // vendor containers are listed because several render their words into a
  // shadow root or an iframe where the text test cannot see them.
  const VENDOR = '#onetrust-consent-sdk,#onetrust-banner-sdk,#CybotCookiebotDialog,#usercentrics-root,#didomi-host,.qc-cmp2-container,#truste-consent-track,.cc-window,.cookie-consent,#cookie-law-info-bar,#cmplz-cookiebanner-container,.osano-cm-window,#iubenda-cs-banner,.fc-consent-root';
  const WORDS = /\b(cookies?|consent|gdpr|ccpa|privacy (choices|preferences|settings)|tracking technologies)\b/i;
  const NAMES = /(cookie|consent|gdpr|cmp|onetrust|cookiebot|didomi|usercentrics|truste|iubenda|osano|privacy-banner)/i;
  const hide = (el, why) => {
    if (!el || el.hasAttribute('data-lcos-hidden')) return;
    el.setAttribute('data-lcos-hidden', 'consent');
    out.consent_hidden.push({ tag: el.tagName.toLowerCase(), id: el.id || '', why });
  };
  try { document.querySelectorAll(VENDOR).forEach((el) => hide(el, 'consent vendor container')); } catch (_) { /* bad selector in an old engine */ }
  try {
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of all) {
      if (el.closest('[data-lcos-hidden]')) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const named = NAMES.test((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.getAttribute('aria-label') || ''));
      const worded = WORDS.test(String(el.innerText || '').slice(0, 1200));
      if (named || worded) hide(el, named ? 'named as a consent overlay' : 'worded as a consent overlay');
      if (out.consent_hidden.length > 12) break;
    }
  } catch (_) { /* nothing to hide */ }
  out.clock = new Date().toISOString();
  out.random = Math.random();
  return out;
}

/**
 * Bring a loaded page to the frozen state. `deadline` bounds every wait.
 * Returns what was done (recorded on the manifest and the regression report).
 */
async function stabilise(page, { deadline, idleMs = 2500, fontsMs = 3000 } = {}) {
  const left = () => (deadline ? deadline - Date.now() : 10000);
  await page.waitForLoadState('networkidle', { timeout: Math.max(200, Math.min(idleMs, left() - 1500)) }).catch(() => {});
  await Promise.race([
    page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true)),
    new Promise((r) => setTimeout(r, Math.max(150, Math.min(fontsMs, left() - 1500)))),
  ]).catch(() => {});
  const done = await page.evaluate(freezeInPage).catch(() => null);
  // Two frames, so the frozen styles are painted before anything is read.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))).catch(() => {});
  return done || { animations_finished: 0, animations_cancelled: 0, consent_hidden: [], clock: '', random: 0 };
}

module.exports = { install, stabilise, freezeInPage, INIT, EPOCH };
