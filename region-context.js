/* eslint-env browser */
/**
 * region-context.js — ONE active region, shared by every page.
 * ---------------------------------------------------------------------------
 * Region selection was present on 17 of 66 pages, implemented six different
 * ways (`data-mkt`, `data-market`, `data-region`, `#market`, `.mkt`,
 * `#mktfilter`), and none of them shared state. Two consequences, both bad:
 *
 *   1. Eight pages CONSUME a market heavily and never let you choose one.
 *      ad-campaigns.html refers to a market 78 times and has no picker at all,
 *      so it silently renders whatever the default is.
 *   2. Where a picker did exist, the choice did not travel. Picking UK on the
 *      calendar and moving to the studio put you back on US without saying so,
 *      which is the failure that produces a UK campaign carrying US prices.
 *
 * This is the shared layer, deliberately modelled on brand-context.js so the
 * two behave the same way:
 *
 *   window.RegionContext = { region, regions, ready(), setActive(code),
 *                            onChange(fn), mount(el), label(code) }
 *   Event: 'regioncontext:change' on window.
 *
 * THE REGION LIST IS THE BRAND'S OWN. It is read from the active brand's
 * `regions`, never from a hardcoded map. A brand that sells only in the UK must
 * not be offered a US market it does not serve, and offering one is how a
 * generator ends up asked for a store URL that does not exist.
 *
 * The choice is stored per BRAND (through LCStore), because a market only means
 * something inside a brand: switching brands must not carry the previous
 * brand's market across, and IN is not a market every brand has.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  if (window.__RegionContextBooted) return;
  window.__RegionContextBooted = true;

  var KEY = 'lc-active-region';
  var state = { region: '', regions: [], loaded: false };
  var listeners = [];
  var readyResolve;
  var readyPromise = new Promise(function (r) { readyResolve = r; });

  /* Readable names for the codes brands actually use. This is LABELLING ONLY:
     a code absent from here still works and simply shows as itself. It must
     never be read as the list of available markets, which is the brand's. */
  var LABELS = {
    US: 'United States', UK: 'United Kingdom', IN: 'India', EU: 'Europe',
    AU: 'Australia', AE: 'UAE', ME: 'Middle East', CA: 'Canada',
    SG: 'Singapore', GLOBAL: 'Global', WORLDWIDE: 'Global',
  };
  function label(code) {
    var c = String(code || '').toUpperCase();
    return LABELS[c] ? LABELS[c] + ' (' + c + ')' : c;
  }

  function store() {
    // LCStore scopes by brand. Without it a market choice would leak across a
    // brand switch, which is the bug this file exists to stop repeating.
    return window.LCStore || {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    };
  }

  function regionsOf(brand) {
    var list = (brand && Array.isArray(brand.regions)) ? brand.regions : [];
    return list
      .filter(function (r) { return r && r.code; })
      .map(function (r) {
        return {
          code: String(r.code).toUpperCase(),
          currency: r.currency || '',
          symbol: r.symbol || '',
          store_url: r.store_url || '',
        };
      });
  }

  function emit() {
    var payload = { region: state.region, regions: state.regions };
    listeners.forEach(function (fn) { try { fn(payload); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent('regioncontext:change', { detail: payload })); } catch (e) {}
  }

  function setActive(code) {
    var c = String(code || '').toUpperCase();
    // Only a market the brand actually serves. Anything else is refused rather
    // than stored, so a stale link or an old saved value cannot put the app in
    // a market the brand has no store URL, currency or catalogue for.
    var ok = state.regions.some(function (r) { return r.code === c; });
    if (!ok) return false;
    if (state.region === c) return true;
    state.region = c;
    store().set(KEY, c);
    emit();
    return true;
  }

  function adopt(brand) {
    state.regions = regionsOf(brand);
    var saved = String(store().get(KEY) || '').toUpperCase();
    var valid = state.regions.some(function (r) { return r.code === saved; });
    // Fall back to the brand's FIRST declared region, which is the one its own
    // record leads with, rather than to a hardcoded default like US.
    state.region = valid ? saved : ((state.regions[0] && state.regions[0].code) || '');
    state.loaded = true;
    if (state.region && !valid) store().set(KEY, state.region);
    emit();
    readyResolve(state.region);
  }

  /**
   * Render a picker into `el`. One row, sliding when it does not fit, per the
   * standing navigation rule. Returns the element so a caller can style it.
   *
   * A brand with a single region gets a static label instead of a control:
   * a picker with one option is a control that cannot do anything, and the
   * honest thing is to show which market this is.
   */
  function mount(el) {
    var host = (typeof el === 'string') ? document.querySelector(el) : el;
    if (!host) return null;
    // Mounting twice would register a second repaint listener on the same node
    // and leak one per call. The shared rail is re-rendered on sign-in, so this
    // is reached more than once in normal use, not only by a careless caller.
    if (host.getAttribute('data-rgn-mounted') === '1') return host;
    host.setAttribute('data-rgn-mounted', '1');

    function paint() {
      if (!state.regions.length) {
        host.innerHTML = '<span class="rgn-none">No market is configured for this brand yet.</span>';
        return;
      }
      if (state.regions.length === 1) {
        host.innerHTML = '<span class="rgn-solo">Market: <b>' + escapeHtml(label(state.regions[0].code)) + '</b></span>';
        return;
      }
      host.innerHTML = '<span class="rgn-label">Market</span>' + state.regions.map(function (r) {
        return '<button type="button" class="rgn-chip" data-region-set="' + escapeHtml(r.code) + '"'
          + ' aria-pressed="' + (r.code === state.region ? 'true' : 'false') + '">'
          + escapeHtml(r.code) + '</button>';
      }).join('');
    }

    host.classList.add('rgn-bar');
    paint();
    onChange(paint);
    return host;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return;
    listeners.push(fn);
    if (state.loaded) fn({ region: state.region, regions: state.regions });
  }

  /**
   * Mount into every `[data-region-picker]` slot, now and whenever one appears.
   *
   * This is what makes the control PRESENT EVERYWHERE rather than on the pages
   * whose author remembered it. auth.js puts one slot in the shared rail, so
   * every page inherits a picker without editing 66 files; a page that wants
   * the control somewhere specific (in its own toolbar, next to a filter row)
   * adds its own `data-region-picker` element and gets the same shared state.
   *
   * The observer is necessary rather than tidy: the rail is injected
   * asynchronously by auth.js and re-rendered once auth resolves, so the slot
   * usually does not exist when this file executes, and it can be replaced
   * afterwards.
   */
  function mountAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var found = scope.querySelectorAll ? scope.querySelectorAll('[data-region-picker]') : [];
    for (var i = 0; i < found.length; i++) mount(found[i]);
    if (scope !== document && scope.matches && scope.matches('[data-region-picker]')) mount(scope);
  }

  (function watchForSlots() {
    function scan() { try { mountAll(document); } catch (e) {} }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
    else scan();
    try {
      var mo = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            if (added[j] && added[j].nodeType === 1) mountAll(added[j]);
          }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  })();

  /* One delegated listener for every picker on the page, however many are
     mounted, so a page never has to bind its own. */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var btn = t.closest('[data-region-set]');
    if (btn) setActive(btn.getAttribute('data-region-set'));
  });

  /* The region list belongs to the brand, so this WAITS for the brand rather
     than racing it.
     Both scripts are injected by auth.js in the same pass, so BrandContext is
     frequently not defined yet when this runs. Adopting immediately in that
     case marked the layer "loaded" with an EMPTY region list, after which
     setActive refused every real market and a mounted picker rendered zero
     chips, until the brand arrived and repainted. Consumers that read `region`
     once, in between, silently got nothing. */
  function boot(waited) {
    var w = waited || 0;
    try {
      if (!window.BrandContext) {
        // Give the sibling script a moment to execute before concluding there
        // is no brand layer at all on this page.
        if (w < 3000) { setTimeout(function () { boot(w + 100); }, 100); return; }
        adopt(null);
        return;
      }
      var applied = false;
      window.BrandContext.onChange(function (s) { applied = true; adopt(s && s.brand); });
      // onChange fires immediately only once the brand layer has settled. When
      // it has not, ready() is what tells us the answer is final, including the
      // legitimate "signed out, no brand" answer.
      if (typeof window.BrandContext.ready === 'function') {
        window.BrandContext.ready().then(function () {
          if (!applied) adopt(window.BrandContext.brand || null);
        }).catch(function () { if (!applied) adopt(null); });
      } else if (!applied) {
        adopt(window.BrandContext.brand || null);
      }
    } catch (e) { adopt(null); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(0); });
  else boot(0);

  window.RegionContext = {
    get region() { return state.region; },
    get regions() { return state.regions; },
    get loaded() { return state.loaded; },
    ready: function () { return readyPromise; },
    setActive: setActive,
    onChange: onChange,
    mount: mount,
    mountAll: mountAll,
    label: label,
  };
})();
