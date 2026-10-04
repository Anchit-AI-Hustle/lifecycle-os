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

/**
 * What a consent overlay looks like, shared by the freeze below and by the
 * role measurement in render-capture.js (which must exclude a consent
 * container even where nothing hid it). Strings, because both run inside the
 * page. `names` is matched against an element's id, class and aria-label;
 * "cookie" alone is NOT a consent name (a bakery's product card is
 * `cookie-card`), only "cookie" followed by a banner-ish word.
 */
const CONSENT = {
  vendor: '#onetrust-consent-sdk,#onetrust-banner-sdk,#onetrust-pc-sdk,.optanon-alert-box-wrapper,#CybotCookiebotDialog,#CookiebotWidget,#usercentrics-root,#didomi-host,.didomi-popup,.qc-cmp2-container,#truste-consent-track,#truste-consent-content,#truste-consent-button,.truste_overlay,.truste_box_overlay,#consent_blackbar,#teconsent,.cc-window,.cookie-consent,#cookie-law-info-bar,#cmplz-cookiebanner-container,.osano-cm-window,#iubenda-cs-banner,.fc-consent-root',
  names: '(cookie[-_ ]?(consent|banner|notice|bar|law|popup|modal|dialog|policy|wall|accept|notification|settings|preferences|message|alert|box)|consent|gdpr|ccpa|onetrust|optanon|cookiebot|cybot|didomi|usercentrics|truste|trustarc|iubenda|osano|cmplz|qc-cmp)',
  words: '\\b(cookies?|consent|gdpr|ccpa|privacy (choices|preferences|settings)|tracking technologies)\\b',
};

/**
 * In the page: freeze motion, hide consent overlays, report what was done.
 *
 * A page's Content-Security-Policy may forbid inline styles (`style-src` with
 * no 'unsafe-inline'), and the reader's contexts honour CSP: an injected
 * <style> is then silently refused (review, 2026-10-04 - an overlay was
 * REPORTED hidden while it was still painted, and the zero-duration rules did
 * not apply). So the stylesheet is verified with a probe, the CSSOM route
 * (`el.style.setProperty`, which a CSP does not govern for script-set
 * properties) is used where it was refused, every hidden node is VERIFIED with
 * getComputedStyle (or removed from this throwaway DOM), and a node that could
 * not be hidden is reported as such, never as hidden.
 */
function freezeInPage(cfg) {
  const c = cfg || {};
  const out = { animations_finished: 0, animations_cancelled: 0, consent_hidden: [], consent_unhidden: [], freeze_route: '', clock: '', random: 0 };
  let sheetOk = false;
  try {
    let st = document.querySelector('style[data-lcos="freeze"]');
    if (!st) {
      st = document.createElement('style');
      st.setAttribute('data-lcos', 'freeze');
      st.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important;caret-color:transparent!important}'
        + '[data-lcos-probe]{outline-style:dotted!important}';
      (document.head || document.documentElement).appendChild(st);
    }
    const probe = document.createElement('i');
    probe.setAttribute('data-lcos-probe', '1');
    (document.body || document.documentElement).appendChild(probe);
    sheetOk = getComputedStyle(probe).outlineStyle === 'dotted';
    probe.remove();
  } catch (_) { sheetOk = false; }
  if (!sheetOk) {
    for (const el of document.querySelectorAll('*')) {
      const sty = el.style;
      if (!sty || typeof sty.setProperty !== 'function') continue;
      try {
        sty.setProperty('animation-duration', '0s', 'important');
        sty.setProperty('animation-delay', '0s', 'important');
        sty.setProperty('transition-duration', '0s', 'important');
        sty.setProperty('transition-delay', '0s', 'important');
      } catch (_) { /* a node that takes no style */ }
    }
  }
  out.freeze_route = sheetOk ? 'stylesheet' : 'cssom (the page\'s Content-Security-Policy refused an injected stylesheet)';
  try {
    for (const a of document.getAnimations()) {
      try {
        const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
        if (t && Number.isFinite(t.endTime) && t.endTime > 0) { a.finish(); out.animations_finished += 1; } else { a.cancel(); out.animations_cancelled += 1; }
      } catch (_) { try { a.cancel(); out.animations_cancelled += 1; } catch (__) { /* gone */ } }
    }
  } catch (_) { /* no Web Animations API */ }
  const NAMES = new RegExp(c.names || 'consent', 'i');
  const WORDS = new RegExp(c.words || 'consent', 'i');
  const done = new Set();
  // A wrapper that holds the page itself is never a consent overlay, whatever
  // its class says (`<div id="app" class="has-consent">`).
  const structural = (el) => el === document.body || el === document.documentElement || /^(MAIN|NAV|HEADER)$/.test(el.tagName) || !!el.querySelector('main,h1,nav,[role=navigation]');
  const hide = (el, why, vendor) => {
    if (!el || done.has(el)) return;
    done.add(el);
    // A vendor class on an app wrapper (`<div class="cookie-consent">` around
    // main/h1/nav) is still the page: hiding it blanked the whole read.
    if (structural(el)) { out.consent_skipped = (out.consent_skipped || []).concat([{ tag: el.tagName.toLowerCase(), id: el.id || '', why: `${vendor ? 'matches a consent vendor selector' : why} but holds the page itself (main, h1 or nav), so it was left alone` }]); return; }
    const rec = { tag: el.tagName.toLowerCase(), id: el.id || '', why };
    try { el.setAttribute('data-lcos-hidden', 'consent'); el.style.setProperty('display', 'none', 'important'); } catch (_) { /* read-only */ }
    let ok = false, how = 'display:none (inline, important)';
    try { ok = getComputedStyle(el).display === 'none'; } catch (_) { ok = false; }
    if (!ok) { try { el.remove(); ok = !document.contains(el); how = 'removed from the throwaway DOM'; } catch (_) { ok = false; } }
    rec.verified = ok;
    rec.how = ok ? how : 'could not be hidden';
    (ok ? out.consent_hidden : out.consent_unhidden).push(rec);
  };
  try { if (c.vendor) document.querySelectorAll(c.vendor).forEach((el) => hide(el, 'consent vendor container', true)); } catch (_) { /* bad selector in an old engine */ }
  try {
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of all) {
      if (done.has(el) || el.closest('[data-lcos-hidden]')) continue;
      const cs = getComputedStyle(el);
      const overlay = cs.position === 'fixed' || cs.position === 'sticky';
      const dialog = /^(dialog|alertdialog)$/i.test(el.getAttribute('role') || '') || el.getAttribute('aria-modal') === 'true' || el.tagName === 'DIALOG';
      const named = NAMES.test((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.getAttribute('aria-label') || ''));
      if (!overlay && !dialog && !named) continue;
      const worded = WORDS.test(String(el.innerText || el.textContent || '').slice(0, 1200));
      if (named && (overlay || dialog || worded)) hide(el, overlay ? 'named as a consent overlay' : (dialog ? 'a consent dialog' : 'named and worded as a consent container'));
      else if ((overlay || dialog) && worded) hide(el, dialog ? 'a dialog worded as consent' : 'worded as a consent overlay');
      if (out.consent_hidden.length + out.consent_unhidden.length > 20) break;
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
  const done = await page.evaluate(freezeInPage, CONSENT).catch(() => null);
  // Two frames, so the frozen styles are painted before anything is read.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))).catch(() => {});
  return done || { animations_finished: 0, animations_cancelled: 0, consent_hidden: [], consent_unhidden: [], freeze_route: 'not run', clock: '', random: 0 };
}

module.exports = { install, stabilise, freezeInPage, INIT, EPOCH, CONSENT };
