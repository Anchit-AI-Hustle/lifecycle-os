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
  var state = { region: '', regions: [], home: '', brandName: '', brandTz: '', loaded: false, explicit: false };
  var listeners = [];
  var pendingCode = '';   // a setActive that arrived before the brand did
  var readyResolve;
  var readyPromise = new Promise(function (r) { readyResolve = r; });

  /* Readable names for the codes brands actually use. This is LABELLING ONLY:
     a code absent from here still works and simply shows as itself. It must
     never be read as the list of available markets, which is the brand's. */
  var LABELS = {
    US: 'United States', UK: 'United Kingdom', GB: 'United Kingdom', IN: 'India', EU: 'Europe',
    AU: 'Australia', AE: 'UAE', ME: 'Middle East', CA: 'Canada', NZ: 'New Zealand',
    SG: 'Singapore', DE: 'Germany', FR: 'France', JP: 'Japan', GLOBAL: 'Global', WORLDWIDE: 'Global',
  };
  /* The short form a chip shows. Pages used to write these by hand ("India",
     "Global") beside codes ("US", "UK"), which is the mix a filter row reads
     naturally, so the same mix is kept, derived rather than typed. */
  var NAMES = { IN: 'India', GLOBAL: 'Global', WORLDWIDE: 'Global', EU: 'Europe', AU: 'Australia', ME: 'Middle East', GB: 'UK' };
  function label(code) {
    var c = String(code || '').toUpperCase();
    return LABELS[c] ? LABELS[c] + ' (' + c + ')' : c;
  }
  function name(code) {
    var c = String(code || '').toUpperCase();
    return NAMES[c] || c;
  }

  /* The codes pages and records spell the SAME market with. A brand record
     says IN; a page chip says "India"; an extractor says GB where a record
     says UK. Matching on the family lets a page control be recognised (and
     driven) whichever spelling it used, without any page having to change its
     vocabulary. This is equivalence, not a list of markets: the markets are
     still only the brand's. */
  var FAMILY = {
    US: 'US', USA: 'US', UNITEDSTATES: 'US', AMERICA: 'US',
    UK: 'UK', GB: 'UK', GBR: 'UK', UNITEDKINGDOM: 'UK', BRITAIN: 'UK',
    IN: 'IN', IND: 'IN', INDIA: 'IN',
    GLOBAL: 'GLOBAL', WORLDWIDE: 'GLOBAL', ROW: 'GLOBAL', INTL: 'GLOBAL', INTERNATIONAL: 'GLOBAL', WW: 'GLOBAL',
    EU: 'EU', EUROPE: 'EU', AU: 'AU', AUS: 'AU', AUSTRALIA: 'AU', ME: 'ME', MIDDLEEAST: 'ME', AE: 'AE', UAE: 'AE',
  };
  function family(v) {
    var k = String(v || '').toUpperCase().replace(/[^A-Z]/g, '');
    return FAMILY[k] || k;
  }
  /** The brand's own code for a value spelt any of the ways above, or ''. */
  function resolveCode(v) {
    var f = family(v);
    if (!f) return '';
    for (var i = 0; i < state.regions.length; i++) {
      if (state.regions[i].code === String(v || '').toUpperCase() || family(state.regions[i].code) === f) return state.regions[i].code;
    }
    return '';
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
          locale: r.locale || '',
          timezone: r.timezone || r.time_zone || '',
          dial_code: r.dial_code || r.phone_cc || '',
          home: r.home === true,
        };
      });
  }

  /* ── LOCALE: currency, number format, time zone, dialling code ───────────
     The same COUNTRY table as api/_shared/brand-locale.js (facts about
     countries, never about a brand), held to it by
     tests/brand-locale-defaults.spec.js, which drives both over every code.
     A record's own value always wins; a time zone is filled only for a
     country that keeps ONE zone (the US is several, so a US brand that has
     not said which gets a marker, not US Eastern). Symbols are derived by
     Intl from the currency, never typed. */
  var COUNTRY = {
    IN: ['INR', 'Asia/Kolkata', '+91'], GB: ['GBP', 'Europe/London', '+44'], US: ['USD', '', '+1'], CA: ['CAD', '', '+1'],
    AU: ['AUD', '', '+61'], NZ: ['NZD', 'Pacific/Auckland', '+64'], IE: ['EUR', 'Europe/Dublin', '+353'], DE: ['EUR', 'Europe/Berlin', '+49'],
    FR: ['EUR', 'Europe/Paris', '+33'], ES: ['EUR', '', '+34'], IT: ['EUR', 'Europe/Rome', '+39'], NL: ['EUR', 'Europe/Amsterdam', '+31'],
    BE: ['EUR', 'Europe/Brussels', '+32'], AT: ['EUR', 'Europe/Vienna', '+43'], CH: ['CHF', 'Europe/Zurich', '+41'], PT: ['EUR', '', '+351'],
    SE: ['SEK', 'Europe/Stockholm', '+46'], DK: ['DKK', 'Europe/Copenhagen', '+45'], NO: ['NOK', 'Europe/Oslo', '+47'], FI: ['EUR', 'Europe/Helsinki', '+358'],
    PL: ['PLN', 'Europe/Warsaw', '+48'], JP: ['JPY', 'Asia/Tokyo', '+81'], KR: ['KRW', 'Asia/Seoul', '+82'], CN: ['CNY', 'Asia/Shanghai', '+86'],
    HK: ['HKD', 'Asia/Hong_Kong', '+852'], SG: ['SGD', 'Asia/Singapore', '+65'], MY: ['MYR', 'Asia/Kuala_Lumpur', '+60'], ID: ['IDR', '', '+62'],
    PH: ['PHP', 'Asia/Manila', '+63'], TH: ['THB', 'Asia/Bangkok', '+66'], VN: ['VND', 'Asia/Ho_Chi_Minh', '+84'], PK: ['PKR', 'Asia/Karachi', '+92'],
    BD: ['BDT', 'Asia/Dhaka', '+880'], LK: ['LKR', 'Asia/Colombo', '+94'], NP: ['NPR', 'Asia/Kathmandu', '+977'], AE: ['AED', 'Asia/Dubai', '+971'],
    SA: ['SAR', 'Asia/Riyadh', '+966'], QA: ['QAR', 'Asia/Qatar', '+974'], IL: ['ILS', 'Asia/Jerusalem', '+972'], TR: ['TRY', 'Europe/Istanbul', '+90'],
    EG: ['EGP', 'Africa/Cairo', '+20'], ZA: ['ZAR', 'Africa/Johannesburg', '+27'], NG: ['NGN', 'Africa/Lagos', '+234'], KE: ['KES', 'Africa/Nairobi', '+254'],
    BR: ['BRL', '', '+55'], MX: ['MXN', '', '+52'],
  };
  /* Typed for the reason brand-locale.js gives: ICU builds disagree. */
  var SYMBOL = { INR: '₹', GBP: '£', USD: '$', CAD: '$', AUD: '$', NZD: '$', EUR: '€', CHF: 'CHF', SEK: 'kr', DKK: 'kr', NOK: 'kr', PLN: 'zł', JPY: '¥', KRW: '₩', CNY: '¥', HKD: 'HK$', SGD: '$', MYR: 'RM', IDR: 'Rp', PHP: '₱', THB: '฿', VND: '₫', PKR: 'Rs', BDT: '৳', LKR: 'Rs', NPR: 'Rs', AED: 'AED', SAR: 'SAR', QAR: 'QAR', ILS: '₪', TRY: '₺', EGP: 'E£', ZAR: 'R', NGN: '₦', KES: 'Ksh', BRL: 'R$', MXN: '$' };
  function countryOf(code) {
    var f = family(code);
    if (f === 'UK') return 'GB';
    return COUNTRY[f] ? f : '';
  }
  /** The spec's marker, unpadded: field, brand, and a region only when one applies. */
  function marker(field, region) {
    return '[DATA REQUIRED BEFORE LAUNCH: ' + field + ', ' + (state.brandName || 'this brand') + (region ? ', ' + region : '') + ']';
  }
  function symbolOf(currency) {
    var c = String(currency || '').toUpperCase();
    return c ? (SYMBOL[c] || c) : '';
  }
  /**
   * Everything locale-shaped about one of the brand's markets (default: the
   * active one, else home): { market, currency, symbol, locale, timeZone,
   * dial, store_url, gaps[] }. A gap is a marker, never a borrowed value.
   */
  function localeOf(code) {
    var want = code ? resolveCode(code) : (state.region || state.home);
    var row = null;
    for (var i = 0; i < state.regions.length; i++) if (state.regions[i].code === want) row = state.regions[i];
    var cc = countryOf(want);
    var t = cc ? COUNTRY[cc] : null;
    var currency = String((row && row.currency) || (t && t[0]) || '').toUpperCase();
    var locale = (row && row.locale) || (cc ? 'en-' + cc : '');
    var timeZone = (row && row.timezone) || (want && want === state.home && state.brandTz) || (t && t[1]) || '';
    var gaps = [];
    if (!want) gaps.push(marker('home market'));
    else {
      if (!currency) gaps.push(marker('currency', want));
      if (!timeZone) gaps.push(marker('time zone', want));
    }
    return {
      market: want || '', country: cc, currency: currency, locale: locale, timeZone: timeZone,
      symbol: (row && row.symbol) || symbolOf(currency),
      dial: (row && row.dial_code) || (t && t[2]) || '', store_url: (row && row.store_url) || '', gaps: gaps,
    };
  }
  /** A price in the brand's currency and number format: 100000 in IN is ₹1,00,000. */
  function money(n, code, opts) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    var l = localeOf(code);
    if (!l.currency) return v.toLocaleString(l.locale || 'en') + ' ' + marker('currency', l.market || '');
    try {
      var o = { style: 'currency', currency: l.currency, maximumFractionDigits: 0 };
      if (opts) for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
      return new Intl.NumberFormat(l.locale || 'en', o).formatToParts(v)
        .map(function (p) { return p.type === 'currency' ? (l.symbol || p.value) : p.value; }).join('');
    } catch (e) { return (l.symbol || l.currency + ' ') + Math.round(v); }
  }
  /** A number in the brand's number format (en-IN groups lakhs). */
  function num(n, code, opts) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    var l = localeOf(code);
    try { return v.toLocaleString(l.locale || undefined, opts || { maximumFractionDigits: 0 }); } catch (e) { return String(v); }
  }

  /* The brand's HOME market: the region its record flags, else the one it
     leads with. This is the default every page control lands on; a brand
     with no regions has no home, and '' is the honest value for that. */
  function homeOf(regions) {
    for (var i = 0; i < regions.length; i++) if (regions[i].home) return regions[i].code;
    return (regions[0] && regions[0].code) || '';
  }

  /**
   * The list a page builds its own market control from: the brand's regions,
   * each as { code, name, label, home }, optionally with an aggregate row
   * first (`{ all: 'ALL' }` gives { code:'ALL', name:'All', all:true }). A
   * brand with no regions returns [] and the page renders its marker state -
   * never a shipped list, never another brand's.
   */
  function options(opts) {
    var o = opts || {};
    var out = state.regions.map(function (r) {
      return { code: r.code, name: name(r.code), label: label(r.code), home: r.code === state.home, all: false };
    });
    if (o.all && out.length) out.unshift({ code: String(o.all === true ? 'ALL' : o.all), name: o.allLabel || 'All', label: o.allLabel || 'All markets', home: false, all: true });
    return out;
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
    // a market the brand has no store URL, currency or catalogue for. A
    // spelling the brand's record does not use ("India" for IN) resolves to
    // the record's own code rather than being refused.
    c = resolveCode(c);
    if (!c) return false;
    state.explicit = true;   // a choice, not our fallback
    if (state.region === c) return true;
    state.region = c;
    store().set(KEY, c);
    emit();
    return true;
  }

  function adopt(brand) {
    state.regions = regionsOf(brand);
    state.brandName = (brand && typeof brand.name === 'string' && brand.name.trim()) || '';
    state.brandTz = (brand && (brand.timezone || brand.time_zone)) || '';
    state.home = homeOf(state.regions);
    // A choice made while the brand was still in flight outranks the stored
    // one: it is the more recent instruction.
    var pendingResolved = pendingCode ? resolveCode(pendingCode) : '';
    if (pendingResolved) store().set(KEY, pendingResolved);
    pendingCode = '';
    var saved = String(store().get(KEY) || '').toUpperCase();
    var valid = state.regions.some(function (r) { return r.code === saved; });
    // Fall back to the brand's HOME market - the region its own record flags,
    // else the one it leads with - rather than to a hardcoded default like US.
    state.region = valid ? saved : state.home;
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
        var isHome = r.code === state.home;
        return '<button type="button" class="rgn-chip" data-region-set="' + escapeHtml(r.code) + '"'
          + (isHome ? ' data-home="1"' : '')
          + ' title="' + escapeHtml(label(r.code) + (isHome ? ' - home market' : '')) + '"'
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
    // "India" on a chip and IN on the record are the same market; the bridge
    // used to compare the raw strings and never drove an India chip at all.
    return resolveCode(v);
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
  window.RegionContext = {
    get region() { return state.region; },
    get regions() { return state.regions; },
    /* The brand's HOME market, '' for a brand with none. Every page control
       defaults to it; a page that used to open on a literal US now opens here. */
    get home() { return state.home; },
    get loaded() { return state.loaded; },
    /* Whether `region` is the user's CHOICE or our fallback to the brand's
       home market. Consumers that drive something expensive off a market
       should know which they are looking at. */
    get explicit() { return state.explicit; },
    ready: function () { return readyPromise; },
    setActive: setActive,
    onChange: onChange,
    mount: mount,
    mountAll: mountAll,
    label: label,
    name: name,
    options: options,
    resolve: resolveCode,
    family: family,
    localeOf: localeOf,
    money: money,
    num: num,
    marker: marker,
    countryOf: countryOf,
    /* The country table, for the parity test against brand-locale.js. */
    _COUNTRY: COUNTRY,
    _SYMBOL: SYMBOL,
  };

  /* Booted AFTER window.RegionContext exists (2026-10-05). A brand layer that
     has already settled answers onChange synchronously, so adopt() and its
     'regioncontext:change' event used to fire while window.RegionContext was
     still undefined: a listener that read the shared choice in its handler
     (Smart Brain's agentic gate) read nothing, and nothing emitted again. */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(0); });
  else boot(0);
})();
