/* eslint-env browser */
/**
 * credits.js — the credit meter, in the browser.
 * ---------------------------------------------------------------------------
 * Loaded on every page by auth.js. It gives the whole app three things:
 *
 *   1. A LIVE balance. The pill in the header subscribes to this user's wallet
 *      row over Supabase Realtime, so the moment any run debits credits — on
 *      this tab, another tab, or a scheduled job — the number moves. If
 *      Realtime is unavailable it falls back to updating from every API
 *      response that carries a balance, plus a slow poll.
 *
 *   2. A COST LABEL on every feature. Any element marked
 *          <button data-credit-feature="mailer.generate">Generate</button>
 *      automatically gets a chip showing what it costs and a popover
 *      explaining what consumes the credits. New elements are picked up as
 *      they are added to the page, so dynamically rendered UIs are covered.
 *
 *   3. A GUARD. Credits.guard(key) checks the balance before a run and opens
 *      the recharge panel instead of letting the user hit a 402.
 *
 * window.Credits = { balance, features, cost(key, units), chip(key), decorate(root),
 *                    guard(key, units), refresh(), applyReceipt(res), onChange(fn),
 *                    openRecharge() }
 * Event: 'credits:change' on window.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  if (window.__CreditsBooted) return;
  window.__CreditsBooted = true;

  var API = '/api/public-config?action=credits';
  var CACHE_KEY = 'lc-credits';

  var state = { balance: null, held: 0, low: false, features: {}, packs: [], configured: true, wallet: null, loaded: false };
  var listeners = [];

  function log(e) { try { console.warn('[credits]', e && e.message ? e.message : e); } catch (_) {} }
  function fmt(n) { return (Number(n) || 0).toLocaleString(); }

  function token() {
    try { if (window.BrandContext && window.BrandContext.token) return window.BrandContext.token(); } catch (_) {}
    try {
      var a = window.LifecycleAuth;
      if (a && a.session && a.session.access_token) return a.session.access_token;
    } catch (_) {}
    return '';
  }
  function workspaceId() {
    try { return (window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.id) || ''; } catch (_) { return ''; }
  }

  async function api(op, body) {
    var t = token();
    var headers = { 'Content-Type': 'application/json' };
    if (t) headers.Authorization = 'Bearer ' + t;
    var ws = workspaceId();
    var url = API + '&op=' + encodeURIComponent(op) + (ws ? '&workspace_id=' + encodeURIComponent(ws) : '');
    var res = await fetch(url, {
      method: body ? 'POST' : 'GET', headers: headers,
      body: body ? JSON.stringify(Object.assign({ workspace_id: ws || undefined }, body)) : undefined,
      cache: 'no-store',
    });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) { var e = new Error(json.message || json.error || ('HTTP ' + res.status)); e.status = res.status; e.payload = json; throw e; }
    return json;
  }

  function emit() {
    var d = { balance: state.balance, held: state.held, low: state.low, features: state.features };
    listeners.forEach(function (fn) { try { fn(d); } catch (e) { log(e); } });
    try { window.dispatchEvent(new CustomEvent('credits:change', { detail: d })); } catch (_) {}
    renderPill();
  }

  function setFeatures(list) {
    var map = {};
    (list || []).forEach(function (f) { map[f.key] = f; });
    state.features = map;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ features: list, packs: state.packs })); } catch (_) {}
  }

  /* ── cost lookup ───────────────────────────────────────────────────────── */

  function cost(key, units) {
    var f = state.features[key];
    if (!f) return null;
    var n = f.metered ? Math.max(1, Math.ceil(Number(units) > 0 ? Number(units) : (f.estimate || 1))) : 1;
    return { key: f.key, label: f.label, cost: f.cost, unit: f.unit, why: f.why, metered: !!f.metered, units: n, total: f.cost * n, free: f.cost === 0 };
  }

  function costText(key, units) {
    var q = cost(key, units);
    if (!q) return '';
    if (q.free) return 'Free';
    return (q.metered ? '~' : '') + fmt(q.total) + ' cr';
  }

  /* ── the header pill ───────────────────────────────────────────────────── */

  function ensureStyles() {
    if (document.getElementById('lc-credits-css')) return;
    var s = document.createElement('style');
    s.id = 'lc-credits-css';
    s.textContent = [
      '.lc-credit-pill{position:fixed;top:10px;right:12px;z-index:99999;display:inline-flex;align-items:center;gap:8px;',
      ' padding:7px 12px;border-radius:999px;cursor:pointer;font:600 12.5px/1 var(--vh-font-body,system-ui,sans-serif);',
      ' background:var(--brand-surface-alt,#fff);color:var(--brand-ink,#111);border:1px solid var(--brand-line,#dcdcdc);',
      ' box-shadow:0 2px 10px rgba(0,0,0,.10);transition:transform .12s ease,box-shadow .12s ease}',
      '.lc-credit-pill:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,.16)}',
      '.lc-credit-pill .lc-dot{width:8px;height:8px;border-radius:50%;background:var(--brand-primary,#6A33D8)}',
      '.lc-credit-pill.is-low .lc-dot{background:var(--brand-warn,#c9a227)}',
      '.lc-credit-pill.is-empty .lc-dot{background:var(--brand-err,#c0392b)}',
      '.lc-credit-pill .lc-add{padding:2px 8px;border-radius:999px;font-size:11px;',
      ' background:var(--brand-primary,#6A33D8);color:var(--brand-on-primary,#fff)}',
      // Reads as a status, not a promotion: this account is not billed.
      '.lc-free{margin-left:8px;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:700;',
      ' letter-spacing:.02em;text-transform:none;vertical-align:middle;',
      ' background:var(--surface-alt,#f4f4f4);color:var(--brand-accent-text,#6A33D8);',
      ' border:1px solid var(--line,#e3e3e3)}',
      '.lc-credit-pill.is-pulse{animation:lcCreditPulse .6s ease}',
      '@keyframes lcCreditPulse{0%{transform:scale(1)}35%{transform:scale(1.13)}100%{transform:scale(1)}}',
      '.lc-credit-chip{display:inline-flex;align-items:center;gap:4px;margin-left:7px;padding:2px 7px;border-radius:999px;',
      ' font:600 10.5px/1.5 var(--vh-font-body,system-ui,sans-serif);vertical-align:middle;white-space:nowrap;',
      ' background:color-mix(in srgb,var(--brand-primary,#6A33D8) 12%,transparent);color:var(--brand-primary-dark,#4a1fa0);',
      ' border:1px solid color-mix(in srgb,var(--brand-primary,#6A33D8) 26%,transparent);cursor:help}',
      '.lc-credit-chip.is-free{background:color-mix(in srgb,var(--brand-ok,#1a7f37) 12%,transparent);',
      ' color:var(--brand-ok,#1a7f37);border-color:color-mix(in srgb,var(--brand-ok,#1a7f37) 28%,transparent)}',
      '.lc-credit-chip.is-short{background:color-mix(in srgb,var(--brand-err,#c0392b) 12%,transparent);',
      ' color:var(--brand-err,#c0392b);border-color:color-mix(in srgb,var(--brand-err,#c0392b) 30%,transparent)}',
      '.lc-credit-sheet{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;',
      ' background:rgba(17,17,17,.45);padding:20px}',
      '.lc-credit-card{background:var(--brand-surface-alt,#fff);color:var(--brand-ink,#111);border-radius:16px;',
      ' max-width:640px;width:100%;max-height:86vh;overflow:auto;padding:26px;',
      ' font-family:var(--vh-font-body,system-ui,sans-serif);box-shadow:0 24px 70px rgba(0,0,0,.32)}',
      '.lc-credit-card h3{margin:0 0 4px;font:600 21px/1.2 var(--vh-font-head,Georgia,serif)}',
      '.lc-credit-card p.sub{margin:0 0 18px;color:var(--brand-ink-muted,#556);font-size:13.5px;line-height:1.6}',
      '.lc-pack{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:13px 15px;margin-bottom:9px;',
      ' border:1px solid var(--brand-line,#e2e2e2);border-radius:11px;cursor:pointer;background:var(--brand-surface,#faf9f7)}',
      '.lc-pack:hover{border-color:var(--brand-primary,#6A33D8)}',
      '.lc-pack b{font-size:15px}.lc-pack small{display:block;color:var(--brand-ink-muted,#556);font-weight:400;margin-top:3px}',
      // The price uses the contrast-adjusted primary token, never the raw
      // brand colour; the unpriced marker uses the same muted TEXT token as
      // the blurb, because there is no contrast-adjusted warn token to reach
      // for and a new hex here would be a fabricated brand value.
      '.lc-pack .lc-price{font-size:12px;font-weight:600;margin-top:6px;color:var(--brand-primary-text,#d0473e)}',
      '.lc-pack .lc-price-free{color:var(--brand-ok,#1a7f37)}',
      '.lc-pack .lc-price-none{color:var(--brand-ink-muted,#556);font-weight:500;font-style:italic;line-height:1.45}',
      '.lc-pack.lc-unpriced{cursor:default;border-style:dashed}',
      '.lc-pack.lc-unpriced:hover{border-color:var(--brand-line,#e6e6e6)}',
      '.lc-credit-card .lc-close{float:right;border:0;background:transparent;font-size:22px;cursor:pointer;line-height:1;color:var(--brand-ink-muted,#556)}',
      '@media (max-width:640px){.lc-credit-pill{top:auto;bottom:14px;right:14px}}',
      '@media (prefers-reduced-motion:reduce){.lc-credit-pill.is-pulse{animation:none}}',
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  var pillEl = null, pulseTimer = null;

  function renderPill() {
    if (!document.body) return;
    ensureStyles();
    if (!pillEl) {
      pillEl = document.createElement('button');
      pillEl.type = 'button';
      pillEl.className = 'lc-credit-pill';
      pillEl.setAttribute('data-no-brand-swap', '1');
      pillEl.title = 'Credits — click for usage and recharge';
      pillEl.addEventListener('click', function () { location.href = '/credits'; });
      document.body.appendChild(pillEl);
    }
    if (state.balance == null) {
      pillEl.innerHTML = '<span class="lc-dot"></span><span>Credits</span>';
      return;
    }
    pillEl.classList.toggle('is-low', !!state.low && state.balance > 0);
    pillEl.classList.toggle('is-empty', state.balance <= 0);
    pillEl.innerHTML =
      '<span class="lc-dot"></span><span>' + fmt(state.balance) + ' credits</span>' +
      (state.held ? '<span style="opacity:.6;font-weight:400">' + fmt(state.held) + ' held</span>' : '') +
      '<span class="lc-add">' + (state.balance <= 0 ? 'Recharge' : '+') + '</span>';
  }

  function pulse() {
    if (!pillEl) return;
    pillEl.classList.remove('is-pulse');
    void pillEl.offsetWidth;
    pillEl.classList.add('is-pulse');
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(function () { pillEl && pillEl.classList.remove('is-pulse'); }, 700);
  }

  /* ── per-feature cost chips ────────────────────────────────────────────── */

  function chipFor(key, units) {
    var q = cost(key, units);
    var el = document.createElement('span');
    el.className = 'lc-credit-chip' + (q && q.free ? ' is-free' : '');
    el.setAttribute('data-no-brand-swap', '1');
    if (!q) { el.textContent = '— cr'; el.title = 'This feature has no price declared yet.'; return el; }
    el.textContent = costText(key, units);
    el.title = q.free
      ? q.label + ': free. ' + (q.why || '')
      : q.label + ': ' + q.cost + ' credits ' + q.unit + '.' +
        (q.metered ? ' Charged on what you actually use; ' + q.units + ' units are reserved up front.' : '') +
        (q.why ? '\n' + q.why : '');
    if (state.balance != null && !q.free && state.balance < q.total) {
      el.classList.add('is-short');
      el.title += '\nYou have ' + fmt(state.balance) + ' credits — ' + fmt(q.total - state.balance) + ' short.';
    }
    return el;
  }

  /**
   * Label every element that declares a feature. Idempotent, so it can run on
   * every mutation without stacking chips.
   */
  function decorate(root) {
    if (!state.loaded) return;
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll('[data-credit-feature]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-credit-feature');
      var units = el.getAttribute('data-credit-units');
      var stamp = key + '|' + (units || '') + '|' + (state.balance == null ? '' : state.balance);
      if (el.getAttribute('data-credit-stamp') === stamp) continue;
      el.setAttribute('data-credit-stamp', stamp);
      var old = el.querySelector(':scope > .lc-credit-chip');
      if (old) old.remove();
      if (el.getAttribute('data-credit-chip') === 'off') continue;
      el.appendChild(chipFor(key, units));
    }
  }

  function watchDom() {
    try {
      var pending = false;
      var obs = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; decorate(document); });
      });
      var start = function () { obs.observe(document.body, { childList: true, subtree: true }); decorate(document); };
      if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    } catch (e) { log(e); }
  }

  /* ── guard + recharge ──────────────────────────────────────────────────── */

  function guard(key, units) {
    var q = cost(key, units);
    if (!q || q.free) return true;
    if (state.balance == null) return true;             // unknown: let the server decide
    if (state.balance >= q.total) return true;
    openRecharge({ short: q.total - state.balance, feature: q });
    return false;
  }

  function openRecharge(opts) {
    ensureStyles();
    var o = opts || {};
    var sheet = document.createElement('div');
    sheet.className = 'lc-credit-sheet';
    sheet.setAttribute('data-no-brand-swap', '1');
    // Same rule as the /credits page: a pack states its money price, and an
    // unpriced pack is not offered for sale. `data-pack` is what binds the
    // click handler below, so omitting it is what makes the card inert —
    // the styling only reflects that, it does not create it.
    var anyBuyable = state.comp || (state.packs || []).some(function (p) {
      return p && p.price && p.price.configured;
    });
    var packs = (state.packs || []).map(function (p) {
      var total = p.total_credits != null ? p.total_credits : (p.credits + (p.bonus || 0));
      var price = p.price || {};
      var buyable = state.comp || price.configured;
      var money = state.comp
        ? '<small class="lc-price lc-price-free">free on this account</small>'
        : price.configured
          ? '<small class="lc-price">' + price.display + '</small>'
          : '<small class="lc-price lc-price-none">' + (price.marker || 'No price set') + '</small>';
      return '<div class="lc-pack' + (buyable ? '' : ' lc-unpriced') + '"' +
        (buyable ? ' data-pack="' + p.key + '"' : ' aria-disabled="true"') + '>' +
        '<span><b>' + p.label + '</b><small>' + p.blurb + '</small>' + money + '</span>' +
        '<span style="text-align:right"><b>' + fmt(total) + '</b>' +
        (p.bonus ? '<small>' + fmt(p.credits) + ' + ' + fmt(p.bonus) + ' bonus</small>' : '<small>credits</small>') +
        '</span></div>';
    }).join('');

    sheet.innerHTML =
      '<div class="lc-credit-card" role="dialog" aria-modal="true" aria-label="Add credits">' +
        '<button class="lc-close" aria-label="Close">&times;</button>' +
        '<h3>Add credits' + (state.comp ? ' <span class="lc-free">free on this account</span>' : '') + '</h3>' +
        '<p class="sub">' +
          (o.short
            ? '<b>' + o.feature.label + '</b> costs ' + fmt(o.feature.total) + ' credits and you have ' + fmt(state.balance) + '. You need ' + fmt(o.short) + ' more.'
            : 'You have <b>' + fmt(state.balance) + '</b> credits. Every feature shows its cost before you run it.') +
        '</p>' +
        packs +
        '<p class="sub" style="margin:16px 0 0">' +
          // THREE states, not two. Telling a user to pick a pack when no pack
          // on this deployment has a price is an instruction they cannot
          // follow — and unpriced is the state every deployment starts in.
          (state.comp
            ? 'This account recharges free: picking a pack adds the credits immediately at no charge. Usage is still metered, so your spend stays visible in the ledger.'
            : anyBuyable
              ? 'Picking a pack records a recharge order. No payment processor is connected to this deployment, so an operator confirms the order before the credits land.'
              : 'No pack has a price on this deployment yet, so none can be ordered. An operator sets one before credits can be bought; your existing balance and every free feature are unaffected.') +
          ' <a href="/credits">See your full usage and ledger</a>.</p>' +
      '</div>';

    function close() { sheet.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    sheet.querySelector('.lc-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    // Only the priced (or complimentary) cards carry data-pack, so this binds
    // nothing to a pack that cannot be bought.
    sheet.querySelectorAll('.lc-pack[data-pack]').forEach(function (el) {
      el.addEventListener('click', async function () {
        el.style.opacity = '.6';
        try {
          var r = await api('recharge', { pack_key: el.getAttribute('data-pack') });
          if (r.credited) { await refresh(); pulse(); alert('Added ' + fmt(r.credits) + ' credits. New balance: ' + fmt(r.balance) + '.'); }
          else alert(r.message || 'Recharge order recorded.');
          close();
        } catch (err) { alert('Could not start the recharge: ' + err.message); el.style.opacity = ''; }
      });
    });
    document.body.appendChild(sheet);
  }

  /* ── live updates ──────────────────────────────────────────────────────── */

  /** Fold a balance carried on any API response straight into the pill. */
  function applyReceipt(res) {
    if (!res || typeof res !== 'object') return;
    var b = null;
    if (typeof res.balance === 'number') b = res.balance;
    else if (res.credits && typeof res.credits.balance === 'number') b = res.credits.balance;
    else if (res.wallet && typeof res.wallet.balance === 'number') b = res.wallet.balance;
    if (b == null) return;
    if (b !== state.balance) {
      state.balance = b;
      state.low = state.wallet ? b <= Number(state.wallet.low_balance_threshold || 0) : state.low;
      emit();
      pulse();
      decorate(document);
    }
  }

  var realtimeUp = false;

  function subscribeRealtime() {
    try {
      var client = window.LifecycleAuth && window.LifecycleAuth.client;
      var session = window.LifecycleAuth && window.LifecycleAuth.session;
      var uid = session && session.user && session.user.id;
      if (!client || !uid || !client.channel || realtimeUp) return;
      client.channel('credits:' + uid)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'credit_wallets', filter: 'user_id=eq.' + uid },
          function (payload) {
            var row = payload && payload.new;
            if (!row) return;
            // Exact match on the wallet this pill represents, treating "no
            // workspace" (the personal wallet) as a value in its own right.
            // A loose check let a personal-wallet update overwrite the active
            // brand's balance, and let any workspace's update through when no
            // brand was active.
            var ws = workspaceId() || null;
            if ((row.workspace_id || null) !== ws) return;
            state.wallet = row;
            state.held = Number(row.held) || 0;
            state.balance = Number(row.balance);
            state.low = state.balance <= Number(row.low_balance_threshold || 0);
            emit();
            pulse();
            decorate(document);
          })
        .subscribe(function (status) { if (status === 'SUBSCRIBED') realtimeUp = true; });
    } catch (e) { log(e); }
  }

  async function refresh() {
    try {
      var r = await api('balance');
      state.wallet = r.wallet || null;
      state.balance = r.wallet ? Number(r.wallet.balance) : null;
      state.held = r.wallet ? Number(r.wallet.held) : 0;
      state.low = !!r.low;
      // Server-decided, from the VERIFIED session email. The client never
      // asserts this; it only renders what the server already concluded.
      state.comp = !!r.comp;
      state.packs = r.packs || state.packs;
      if (r.features) setFeatures(r.features);
      state.loaded = true;
      emit();
      decorate(document);
      subscribeRealtime();
      return state;
    } catch (e) {
      if (e.status === 503 && e.payload) {
        // Meter not configured: still show what things cost, honestly.
        state.configured = false;
        if (e.payload.features) setFeatures(e.payload.features);
        state.packs = e.payload.packs || [];
      } else if (e.status !== 401) log(e);
      state.loaded = true;
      emit();
      decorate(document);
      return state;
    }
  }

  /* ── boot ──────────────────────────────────────────────────────────────── */

  (function bootCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && c.features) { setFeatures(c.features); state.packs = c.packs || []; state.loaded = true; }
    } catch (_) {}
  })();

  // The public price list needs no session, so features can be labelled even
  // before sign-in finishes.
  fetch(API + '&op=catalog', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j && j.features) { setFeatures(j.features); state.packs = j.packs || []; state.configured = j.configured !== false; state.loaded = true; emit(); decorate(document); } })
    .catch(function () {});

  function start() {
    renderPill();
    watchDom();
    var tries = 0;
    (function attempt() {
      if (token() || tries > 20) { refresh(); return; }
      tries++;
      setTimeout(attempt, 150);
    })();
    // Slow safety net in case Realtime is not enabled on the project.
    setInterval(function () { if (!realtimeUp && token()) refresh(); }, 60000);
    // Brand switch = different wallet.
    window.addEventListener('brandcontext:change', function () { if (token()) refresh(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.Credits = {
    get balance() { return state.balance; },
    get held() { return state.held; },
    get features() { return state.features; },
    get packs() { return state.packs; },
    get loaded() { return state.loaded; },
    get configured() { return state.configured; },
    // Whether THIS account recharges free, as the server decided it from the
    // verified session email. Exposed so a page can say so instead of telling a
    // complimentary account that an operator must confirm a recharge that has
    // already completed. The list of accounts is never sent to the browser —
    // only this boolean about the current one.
    get comp() { return !!state.comp; },
    cost: cost, costText: costText, chip: chipFor, decorate: decorate,
    guard: guard, refresh: refresh, applyReceipt: applyReceipt, openRecharge: openRecharge,
    api: api,
    onChange: function (fn) { if (typeof fn === 'function') { listeners.push(fn); if (state.loaded) fn({ balance: state.balance, held: state.held, low: state.low, features: state.features }); } },
  };
})();
