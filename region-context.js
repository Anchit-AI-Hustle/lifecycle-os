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
  var state = { region: '', regions: [], loaded: false, explicit: false };
  var listeners = [];
  var pendingCode = '';   // a setActive that arrived before the brand did
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
    // Asked before the brand's market list has arrived. The brand can land
    // late - it is a network round trip, and on some pages it lands after the
    // layer has already settled on "no brand yet" - so remember the request
    // and honour it once we know whether the brand serves that market. Losing
    // it silently is how a deep link into a market ends up on another one.
    if (!state.regions.length) { pendingCode = c; return false; }
    // Only a market the brand actually serves. Anything else is refused rather
    // than stored, so a stale link or an old saved value cannot put the app in
    // a market the brand has no store URL, currency or catalogue for.
    var ok = state.regions.some(function (r) { return r.code === c; });
    if (!ok) return false;
    state.explicit = true;   // a choice, not our fallback
    if (state.region === c) return true;
    state.region = c;
    store().set(KEY, c);
    emit();
    return true;
  }

  function adopt(brand) {
    state.regions = regionsOf(brand);
    // A choice made while the brand was still in flight outranks the stored
    // one: it is the more recent instruction.
    if (pendingCode && state.regions.some(function (r) { return r.code === pendingCode; })) {
      store().set(KEY, pendingCode);
    }
    pendingCode = '';
    var saved = String(store().get(KEY) || '').toUpperCase();
    var valid = state.regions.some(function (r) { return r.code === saved; });
    // Fall back to the brand's FIRST declared region, which is the one its own
    // record leads with, rather than to a hardcoded default like US.
    state.region = valid ? saved : ((state.regions[0] && state.regions[0].code) || '');
    // Whether this is the user's CHOICE or merely our fallback. The bridge
    // below drives a page's own control only on a real choice: forcing the
    // brand's first region onto a page that legitimately defaults to something
    // else would be us inventing a decision nobody made.
    state.explicit = valid;
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

  var pending = 0;
  function scheduleSync() {
    if (pending) return;
    pending = setTimeout(function () { pending = 0; try { syncLegacyControls(); } catch (e) {} }, 60);
  }

  (function watchForSlots() {
    function scan() { try { mountAll(document); scheduleSync(); } catch (e) {} }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
    else scan();
    try {
      var mo = new MutationObserver(function (records) {
        var grew = false;
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            if (added[j] && added[j].nodeType === 1) { mountAll(added[j]); grew = true; }
          }
        }
        // Pages build their market controls in JS after a fetch, so the slot
        // scan is not enough: the control the shared choice has to drive
        // usually does not exist yet when this file runs.
        if (grew && !driving) scheduleSync();
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  })();

  /* ─── Bridge to the controls the pages already have ───────────────────────
   *
   * 27 pages consume a market and 17 carry their own control for it, written
   * six different ways: `data-market` chips (calendar), `.region-chip`
   * (knowledge base, landing pages), `.mkt-chip` / `.mkt-tab-btn` (Mailer
   * Studio), `<select id="market">` (research), `<select id="mktfilter">`
   * (smart brain). None of them share state with each other.
   *
   * Rewriting all 27 to read RegionContext is the right end state and is not
   * one change: several of those pages are thousands of lines of inline JS
   * built around their own market variable. So this adapts them in place,
   * two ways:
   *
   *   page control used  -> the shared choice follows it
   *   shared choice set  -> the page control is driven, with real events, so
   *                         the page's OWN handler runs and it re-renders
   *
   * Everything here is deliberately conservative. A control is only adopted
   * when its values resolve to markets THIS BRAND serves, and a chip only
   * when a sibling carries a different market code - so a lone "US" badge, a
   * status pill or a country label is never mistaken for a picker and never
   * clicked.
   */

  /** The market a page element stands for, or '' if it is not one. */
  function codeOf(el) {
    if (!el || !el.getAttribute) return '';
    var v = el.getAttribute('data-market') || el.getAttribute('data-mkt')
      || el.getAttribute('data-region') || '';
    if (!v && el.tagName === 'OPTION') v = el.value;
    if (!v) v = (el.textContent || '').trim();
    v = String(v).toUpperCase().replace(/[^A-Z]/g, '');
    return state.regions.some(function (r) { return r.code === v; }) ? v : '';
  }

  var CLICKABLE = 'button,a,[role="button"],[role="tab"],[data-market],[data-mkt],[data-region]';
  function ours(el) { return !!(el.closest && el.closest('[data-region-picker],.rgn-bar,#lifecycle-nav')); }

  /** A chip is a picker only if a SIBLING offers a different market. */
  function isLegacyChip(el) {
    if (!el || ours(el) || !el.matches || !el.matches(CLICKABLE)) return '';
    if (el.disabled) return '';
    // An anchor that actually navigates is never driven. A table of markets
    // whose row headers link elsewhere looks exactly like a chip row, and
    // clicking one would leave the page instead of filtering it. In-page
    // anchors are fine, and are how some of these pickers are written.
    if (el.tagName === 'A') {
      var href = el.getAttribute('href');
      if (href && !/^(#|javascript:)/i.test(href)) return '';
    }
    var code = codeOf(el);
    if (!code) return '';
    var kin = el.parentElement ? el.parentElement.children : [];
    for (var i = 0; i < kin.length; i++) {
      if (kin[i] !== el) { var other = codeOf(kin[i]); if (other && other !== code) return code; }
    }
    return '';
  }

  /** A select is a market picker only if it is PREDOMINANTLY market options. */
  function legacySelects() {
    var out = [];
    var sels = document.querySelectorAll('select');
    for (var i = 0; i < sels.length; i++) {
      var sel = sels[i];
      if (ours(sel)) continue;
      var known = 0;
      for (var j = 0; j < sel.options.length; j++) if (codeOf(sel.options[j])) known++;
      // At least two real markets, and at most two options that are not one
      // (which covers the usual "All markets" / placeholder entries).
      if (known >= 2 && sel.options.length - known <= 2) out.push(sel);
    }
    return out;
  }

  /* Re-entrancy guard: driving a page control fires a click or a change, which
     comes straight back through the listeners below. Without this the two
     halves of the bridge would answer each other. */
  var driving = false;

  /* Most pages build their chips in JS after a fetch, so the sync has to run
     again when they appear - and a driven click makes the page re-render them,
     which brings us straight back here. That settles, because the second pass
     sees the chip already marked active and does not click it. A page that
     marks its active chip some way this does not recognise would not settle,
     so drives are capped per market and the cap resets on a new choice. */
  var drives = 0;
  var drivesFor = '';
  var DRIVE_CAP = 8;
  var multi = [];   // groups proven to be multi-select filters

  function isOn(el) {
    return /\b(on|active|selected|is-active)\b/.test((el && el.className) || '')
      || (el && el.getAttribute && (el.getAttribute('aria-pressed') === 'true'
        || el.getAttribute('aria-selected') === 'true'));
  }

  /** How many markets a chip group currently has selected. */
  function activeCount(group) {
    var n = 0;
    var kids = (group && group.children) || [];
    for (var i = 0; i < kids.length; i++) if (codeOf(kids[i]) && isOn(kids[i])) n++;
    return n;
  }

  function syncLegacyControls() {
    if (!state.region || !state.explicit || driving) return;
    if (drivesFor !== state.region) { drivesFor = state.region; drives = 0; }
    if (drives >= DRIVE_CAP) return;
    driving = true;
    try {
      legacySelects().forEach(function (sel) {
        for (var i = 0; i < sel.options.length; i++) {
          if (codeOf(sel.options[i]) === state.region && sel.selectedIndex !== i) {
            sel.selectedIndex = i; drives++;
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      });
      var all = document.querySelectorAll(CLICKABLE);
      var seen = [];
      for (var k = 0; k < all.length; k++) {
        var el = all[k];
        if (isLegacyChip(el) !== state.region) continue;
        // One click per chip GROUP. Several groups on a page is normal (a
        // filter bar plus a tab strip); several chips for the same market
        // inside one group is not, and clicking each would re-run the page's
        // handler once per chip.
        if (seen.indexOf(el.parentElement) !== -1) continue;
        seen.push(el.parentElement);
        // Already the page's active choice: clicking would be a no-op at best
        // and a toggle-off at worst.
        if (isOn(el)) continue;
        if (multi.indexOf(el.parentElement) !== -1) continue;
        drives++;
        try { el.click(); } catch (e) {}
        // Some of these controls are multi-select FILTERS, not pickers: the
        // calendar plans across several markets at once and its chips toggle
        // independently, so our click widened the user's filter instead of
        // changing it. There is no way to tell that apart from the markup, but
        // there is afterwards - a single-select group leaves exactly one
        // market active. Anything else gets the click taken back and is left
        // alone from then on: quietly editing someone's filter is worse than
        // not following the picker.
        if (activeCount(el.parentElement) > 1) {
          multi.push(el.parentElement);
          try { el.click(); } catch (e) {}
        }
      }
    } finally { driving = false; }
  }

  /* One delegated listener for every picker on the page, however many are
     mounted, so a page never has to bind its own - and the same listener
     adopts the pages' own chips. */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var btn = t.closest('[data-region-set]');
    if (btn) { setActive(btn.getAttribute('data-region-set')); return; }
    if (driving) return;
    var node = t.closest(CLICKABLE);
    while (node) {
      var code = isLegacyChip(node);
      if (code) { setActive(code); return; }
      node = node.parentElement && node.parentElement.closest ? node.parentElement.closest(CLICKABLE) : null;
    }
  }, true);

  document.addEventListener('change', function (ev) {
    if (driving) return;
    var sel = ev.target;
    if (!sel || sel.tagName !== 'SELECT' || ours(sel)) return;
    if (legacySelects().indexOf(sel) === -1) return;
    var code = codeOf(sel.options[sel.selectedIndex]);
    if (code) setActive(code);
  }, true);

  onChange(function () { scheduleSync(); });

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
    /* Whether `region` is the user's CHOICE or our fallback to the brand's
       first market. Consumers that drive something expensive off a market
       should know which they are looking at. */
    get explicit() { return state.explicit; },
    ready: function () { return readyPromise; },
    setActive: setActive,
    onChange: onChange,
    mount: mount,
    mountAll: mountAll,
    label: label,
  };
})();
