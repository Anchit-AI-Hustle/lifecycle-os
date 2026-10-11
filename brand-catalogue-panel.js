/* ── THE BRAND CATALOGUE, AS GENERATION SEES IT (2026-10-10, shared 2026-10-11)
   One module, two places: the "<brand> catalogue" panel on /brain
   (smart-brain.html) and the full page at /catalog (brand-catalogue.html),
   the Brand & Credits rail row the operator asked for ("catalog must be
   visible ... as an LHS item menu in the brand setup part").

   It READS through the paths generation already uses, and decides nothing of
   its own:
     - a brand on this device: BrandContext.catalogForGeneration(id), the rows
       a generator here may use (the coherence rule has already judged them),
       with the kept record's source and coverage beside it;
     - an account brand: its own rows (op=catalog, its workspace id, the
       session's token) and its import record (op=catalog-status), each row
       judged by the SAME rule (coherenceLib.catalogRowForeign over the
       server's catalog_identity verdict) - never a second domain comparison;
     - tenant zero (the server's owns_shipped answer, never a slug): its
       shipped catalogue through BrandCatalog, the only reader of /data/catalog/.
   Any other brand never asks for the shipped files. No rows is a marker with
   the step that fixes it.

   Roles only in the stylesheet below: grounds are the panel tokens, the
   marker its own token pair, an excluded count the warn edge (an ordinary
   state, not a failure). No colour literal.

   window.BrandCataloguePanel.mount(el, opts) -> controller
     opts.titleEl   element whose text becomes "<Brand> catalogue"
     opts.full      true on the full page: no height cap on the grid
     opts.maxShown  rows rendered per market (default 240)
     opts.onData    called with the read (or null) after every load
   controller: { reload(), render(), setQuery(q), get data() } */
(function (root) {
  'use strict';

  var STYLE_ID = 'bcp-style';
  var CSS = [
    '[data-bcp] .catsum{margin:.2em 0 .6em;font-size:13px;line-height:1.55;color:var(--vh-ink)}',
    '[data-bcp] .catcov{margin:8px 0 10px;padding:8px 12px;border-left:3px solid var(--vh-accent);background:var(--vh-panel-2);border-radius:0 10px 10px 0;font-size:12.5px;line-height:1.5;color:var(--vh-ink)}',
    '[data-bcp] .catcov ul{margin:4px 0 0;padding-left:18px}[data-bcp] .catcov li{margin:2px 0}',
    '[data-bcp] .catexcl{margin:8px 0 10px;padding:9px 12px;border:1px solid var(--vh-line);border-left:4px solid var(--vh-warn);border-radius:10px;background:var(--vh-panel-2);color:var(--vh-ink);font-size:12.5px;line-height:1.5}',
    '[data-bcp] .catmkts{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0 10px}',
    '[data-bcp] .catmkts-label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-right:4px;color:var(--vh-ink-dim)}',
    '[data-bcp] .mkchip{border:1px solid var(--vh-line-hot);background:var(--vh-panel);color:var(--vh-ink);padding:5px 12px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer}',
    '[data-bcp] .mkchip:hover{border-color:var(--vh-primary-text);color:var(--vh-ink)}',
    '[data-bcp] .mkchip.on{background:var(--vh-primary);color:var(--vh-on-primary);border-color:var(--vh-primary)}',
    '[data-bcp] .catmkts .mkchip:disabled{opacity:1;cursor:default}',
    '[data-bcp] .catgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(168px,100%),1fr));gap:10px;max-height:440px;overflow:auto;-webkit-overflow-scrolling:touch;padding:2px}',
    '[data-bcp][data-bcp-full] .catgrid{max-height:none;overflow:visible}',
    '[data-bcp] .catitem{display:flex;flex-direction:column;gap:6px;background:var(--vh-panel-2);border:1px solid var(--vh-line);border-radius:12px;padding:8px;min-width:0}',
    '[data-bcp] .catimg{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px;background:var(--vh-panel);border:1px solid var(--vh-line);display:block}',
    '[data-bcp] .catgap{width:100%;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;text-align:center;padding:8px;border-radius:8px;border:1px dashed var(--vh-marker-edge);background:var(--vh-marker-ground);color:var(--vh-ink);font-size:12px;line-height:1.35;overflow-wrap:anywhere}',
    '[data-bcp] .catname{font-size:13px;font-weight:700;color:var(--vh-ink);line-height:1.3;overflow-wrap:anywhere}',
    '[data-bcp] .catprice{font-size:13px;color:var(--vh-ink);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
    '[data-bcp] .catmeta{font-size:12px;color:var(--vh-ink-dim)}',
    '[data-bcp] .catmore{margin:8px 0 0;font-size:12px;color:var(--vh-ink-dim)}',
    '[data-bcp] a{color:var(--vh-link);text-decoration:underline;text-underline-offset:2px}',
  ].join('\n');

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function brandName(b) { return (b && b.name) || 'this brand'; }
  function marker(field, b, region) { return '[DATA REQUIRED BEFORE LAUNCH: ' + field + ', ' + brandName(b) + (region ? ', ' + region : '') + ']'; }
  function host(u) { try { return new URL(String(u)).hostname.replace(/^www\./, ''); } catch (_) { return ''; } }
  function region(r) { return String(r || '').trim().toUpperCase(); }
  function price(row, reg) {
    if (!row || row.price == null || row.price === '') return '';
    var v = Number(row.price);
    if (!isFinite(v)) return '';
    var RC = root.RegionContext;
    var own = String(row.currency || '').toUpperCase();
    try {
      var mk = RC && RC.localeOf ? RC.localeOf(reg || undefined) : null;
      // The market's own currency: RegionContext formats it. A row whose store
      // STATED another currency is printed in that one, never re-labelled.
      if (RC && RC.money && (!own || !mk || !mk.currency || mk.currency === own)) return RC.money(v, reg || undefined, { maximumFractionDigits: 2 });
      if (own) return new Intl.NumberFormat((mk && mk.locale) || 'en', { style: 'currency', currency: own, maximumFractionDigits: 2 }).format(v);
    } catch (_) {}
    return String(row.price);
  }
  function img(row) {
    var ok = function (u) { return (typeof u === 'string' && /^https:\/\//i.test(u)) ? u : ''; };
    if (ok(row.image_url)) return row.image_url;
    if (ok(row.img)) return row.img;
    if (ok(row.i)) return row.i;
    var list = Array.isArray(row.image_urls) ? row.image_urls : (Array.isArray(row.imgs) ? row.imgs : []);
    for (var i = 0; i < list.length; i++) { var x = list[i]; var u = ok(typeof x === 'string' ? x : (x && (x.src || x.url))); if (u) return u; }
    return '';
  }
  function title(row) { return String((row && (row.title || row.n || row.name || row.handle || row.h)) || ''); }
  function verdict(B, b) {
    if (!b) return null;
    if (b.catalog_identity && typeof b.catalog_identity === 'object') return b.catalog_identity;
    try { return B.coherenceLib ? B.coherenceLib.catalogIdentity(b) : null; } catch (_) { return null; }
  }
  function foreign(B, row, v) {
    if (!v) return false;
    try { return B.coherenceLib ? !!B.coherenceLib.catalogRowForeign(row, v) : !!v.excluded; } catch (_) { return !!v.excluded; }
  }

  /** The catalogue generation reads for brand b, by the path its storage takes. */
  async function read(B, b) {
    var isDevice = !!(B.device && B.device.isDeviceId && B.device.isDeviceId(b.id));
    if (isDevice) {
      var full = B.deviceCatalog ? B.deviceCatalog(b.id) : null;
      var gen = B.catalogForGeneration ? B.catalogForGeneration(b.id) : null;
      var rows = (gen && Array.isArray(gen.products)) ? gen.products : [];
      var stale = (full && Array.isArray(full.products)) ? full.products.filter(function (p) { return p && p.stale_at; }).length : 0;
      return { kind: 'device', rows: rows, excluded: (gen && gen.dropped) || 0, verdict: (gen && gen.excluded) || null,
        source: (full && full.source) || ((b.catalog_source && b.catalog_source.kind) ? b.catalog_source : null),
        coverage: (full && full.coverage) || null, resumable: !!(full && full.cursor), stale: stale, total: rows.length };
    }
    if (B.isTenantZero && B.isTenantZero(b)) {
      var BC = root.BrandCatalog;
      var opts = (root.RegionContext && root.RegionContext.options) ? root.RegionContext.options() : [];
      var mkts = opts.length ? opts.map(function (o) { return o.code; }) : [''];
      var srows = [];
      for (var i = 0; i < mkts.length; i++) {
        var m = mkts[i];
        var r = BC ? await BC.load(String(m).toLowerCase()) : null;
        ((r && r.products) || []).forEach(function (p) { srows.push(Object.assign({}, p, { region: m })); });
      }
      return { kind: 'shipped', rows: srows, excluded: 0, verdict: null, source: { kind: 'shipped' }, coverage: null, resumable: false, stale: 0, total: srows.length, perMarket: true };
    }
    var q = '&workspace_id=' + encodeURIComponent(b.id || '');
    var got = await B.api('catalog', { query: q + '&limit=500' });
    var status = null;
    try { status = await B.api('catalog-status', { query: q }); } catch (_) { status = null; }
    var all = ((got && got.products) || []).filter(function (p) { return p && !p.stale_at; });
    var v = verdict(B, b);
    var mine = all.filter(function (p) { return !foreign(B, p, v); });
    var live = (status && typeof status.live === 'number') ? status.live : all.length;
    return { kind: 'account', rows: mine, excluded: all.length - mine.length, verdict: (v && (v.excluded || all.length > mine.length)) ? v : null,
      source: (status && status.source && status.source.kind) ? status.source : ((b.catalog_source && b.catalog_source.kind) ? b.catalog_source : null),
      coverage: (status && status.coverage) || null, resumable: !!(status && status.resume_available), stale: (status && status.stale) || 0,
      total: live, readCap: all.length < live ? all.length : 0 };
  }

  function sourceLine(src) {
    if (!src) return '';
    var k = src.kind;
    var how = k === 'shopify' ? 'its store feed' : k === 'site_crawl' ? 'its own website' : k === 'csv' ? 'a CSV import' : k === 'json' ? 'a JSON import'
      : k === 'shipped' ? 'the catalogue shipped with this platform for this brand' : (k ? String(k) : 'an import');
    var h = host(src.url);
    var when = '';
    if (src.imported_at) { var d = new Date(src.imported_at); if (!isNaN(d)) when = ' on ' + d.toISOString().slice(0, 10); }
    return 'Read from ' + how + (h ? ' (' + h + ')' : '') + when + '.';
  }

  function mount(el, opts) {
    var o = opts || {};
    var maxShown = o.maxShown || 240;
    var view = { mkt: '', data: null, seq: 0, q: '' };
    if (!el) return null;
    injectStyle();
    el.setAttribute('data-bcp', '');
    if (o.full) el.setAttribute('data-bcp-full', '');
    var stepHref = function (b) { return '/onboarding?step=5' + (o.full && b && b.id ? '&id=' + encodeURIComponent(b.id) : ''); };

    function render() {
      var d = view.data;
      if (!d || d.error) return;
      var b = d.brand;
      var rows = d.rows;
      var parts = [];
      // Markets are the rows' own; the panel never invents one.
      var byMkt = {};
      rows.forEach(function (r) { var m = region(r.region); byMkt[m] = (byMkt[m] || 0) + 1; });
      var mkts = Object.keys(byMkt).sort(function (x, y) { return x === '' ? 1 : y === '' ? -1 : x.localeCompare(y); });
      var keyOf = function (m) { return m || '-'; };
      if (view.mkt && view.mkt !== '*' && !mkts.some(function (m) { return keyOf(m) === view.mkt; })) view.mkt = '';
      if (!view.mkt) {
        var home = region(root.RegionContext && root.RegionContext.home);
        view.mkt = d.perMarket ? keyOf((home && byMkt[home]) ? home : (mkts[0] || '')) : '*';
      }
      var mktLabel = function (m) { return m ? m : 'No market stated'; };
      var count = d.perMarket
        ? 'Products per market: ' + mkts.map(function (m) { return esc(mktLabel(m)) + ' <b>' + byMkt[m] + '</b>'; }).join(' · ')
        : '<b>' + rows.length + '</b> product' + (rows.length === 1 ? '' : 's') + ' generation can use' +
          (mkts.length ? ' (' + mkts.map(function (m) { return esc(mktLabel(m)) + ' ' + byMkt[m]; }).join(', ') + ')' : '');
      parts.push('<p class="catsum" data-cat-count="' + rows.length + '">' + count +
        (d.readCap ? '. Showing the first ' + d.readCap + ' of ' + d.total + ' in the catalogue' : '') +
        (d.stale ? '. ' + d.stale + ' the store no longer lists are kept but not used' : '') + '. ' + esc(sourceLine(d.source)) + '</p>');
      if (d.coverage && Array.isArray(d.coverage.sentences) && d.coverage.sentences.length) {
        parts.push('<div class="catcov"><b>' + (d.coverage.complete ? 'Catalogue read completely' : 'Catalogue read in part') + '</b>' +
          '<ul>' + d.coverage.sentences.slice(0, 12).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
          (d.resumable ? '<p class="catmeta" style="margin:4px 0 0">Continue the import on the <a href="' + esc(stepHref(b)) + '">brand setup\'s catalogue step</a>.</p>' : '') + '</div>');
      }
      if (d.excluded || (d.verdict && d.verdict.excluded)) {
        var v = d.verdict || {};
        var n = d.excluded || 0;
        parts.push('<div class="catexcl" data-cat-excluded="' + n + '"><b>' + n + ' excluded</b>: ' +
          (n === 1 ? 'one product was' : n + ' products were') + ' read from another brand\'s site' + (v.domain ? ' (' + esc(v.domain) + ')' : '') +
          ', so ' + (n === 1 ? 'it is' : 'they are') + ' never used for ' + esc(brandName(b)) + '.' + (v.sentence ? ' ' + esc(v.sentence) : '') + '</div>');
      }
      if (!rows.length) {
        parts.push('<p class="vh-status" data-cat-empty>' + esc(marker('product catalogue', b)) + ' None of ' + esc(brandName(b)) +
          '\'s own products are available to generation, so assets carry this marker where a product would be. <a href="' + esc(stepHref(b)) + '">Import the catalogue on the brand setup\'s catalogue step</a>.</p>');
        el.innerHTML = parts.join('');
        return;
      }
      if (mkts.length > 1 || d.perMarket) {
        var chip = function (code, label) {
          var on = view.mkt === code;
          return '<button type="button" class="mkchip' + (on ? ' on' : '') + '" data-catmkt="' + esc(code) + '" aria-pressed="' + on + '"' +
            (on ? ' disabled title="These products are shown now"' : '') + '>' + esc(label) + '</button>';
        };
        parts.push('<div class="catmkts"><span class="catmkts-label">Market</span>' +
          (d.perMarket ? '' : chip('*', 'All (' + rows.length + ')')) + mkts.map(function (m) { return chip(keyOf(m), mktLabel(m) + ' (' + byMkt[m] + ')'); }).join('') + '</div>');
      }
      var inMkt = rows.filter(function (r) { return view.mkt === '*' || keyOf(region(r.region)) === view.mkt; });
      var q = view.q.trim().toLowerCase();
      var shown = q ? inMkt.filter(function (r) { return title(r).toLowerCase().indexOf(q) >= 0; }) : inMkt;
      if (q) parts.push('<p class="catmeta" data-cat-matches="' + shown.length + '">' + shown.length + ' of ' + inMkt.length + ' match "' + esc(view.q.trim()) + '".</p>');
      var items = shown.slice(0, maxShown).map(function (r) {
        var reg = region(r.region);
        var t = title(r);
        var im = img(r);
        var pr = price(r, reg);
        var where = t + (reg ? ', ' + reg : '');
        return '<div class="catitem" role="listitem" data-cat-row>' +
          (im ? '<img class="catimg" loading="lazy" decoding="async" alt="' + esc(t) + '" src="' + esc(im) + '">'
              : '<div class="catgap">' + esc(marker('product image', b, where)) + '</div>') +
          '<div class="catname">' + esc(t || marker('product title', b)) + '</div>' +
          '<div class="catprice">' + esc(pr || marker('price', b, where)) + '</div>' +
          (reg ? '<div class="catmeta">' + esc(reg) + '</div>' : '') + '</div>';
      });
      parts.push('<div class="catgrid" role="list" aria-label="' + esc(brandName(b)) + ' catalogue">' + items.join('') + '</div>');
      if (shown.length > maxShown) parts.push('<p class="catmore">Showing ' + maxShown + ' of ' + shown.length + (q ? ' matching' : ' in this market') + '.</p>');
      el.innerHTML = parts.join('');
    }

    function done(data) { if (typeof o.onData === 'function') { try { o.onData(data); } catch (_) {} } }

    async function reload() {
      var seq = ++view.seq;
      var B = root.BrandContext;
      if (!B) { el.innerHTML = '<p class="vh-status">' + esc(marker('active brand', null)) + ' No brand layer is loaded on this page.</p>'; done(null); return; }
      var b = null;
      try { var first = await B.ready(); b = B.brand || first || null; } catch (_) { b = B.brand || null; }
      if (seq !== view.seq) return;
      if (!b) {
        view.data = null;
        el.innerHTML = '<p class="vh-status" data-cat-empty>No brand is active, so there is no catalogue to show. <a href="/onboarding">Set up or choose a brand</a>.</p>';
        done(null);
        return;
      }
      if (o.titleEl) o.titleEl.textContent = brandName(b) + ' catalogue';
      try {
        var r = await read(B, b);
        if (seq !== view.seq) return;
        view.data = Object.assign({ brand: b }, r);
        render();
        done(view.data);
      } catch (e) {
        if (seq !== view.seq) return;
        view.data = { brand: b, error: true };
        el.innerHTML = '';
        if (root.LifecycleFailure && root.LifecycleFailure.show) root.LifecycleFailure.show(el, e, { title: 'The catalogue could not be read' });
        else el.innerHTML = '<p class="vh-status">The catalogue could not be read: ' + esc((e && e.message) || e) + '</p>';
        done(view.data);
      }
    }

    el.addEventListener('click', function (ev) {
      var c = ev.target && ev.target.closest ? ev.target.closest('[data-catmkt]') : null;
      if (!c || c.disabled || !el.contains(c)) return;
      view.mkt = c.getAttribute('data-catmkt');
      render();
    });
    root.addEventListener('brandcontext:change', function () { view.mkt = ''; reload(); });
    reload();

    return {
      reload: reload,
      render: render,
      setQuery: function (q) { view.q = String(q || ''); render(); },
      get data() { return view.data; },
    };
  }

  var api = { mount: mount, read: read, sourceLine: sourceLine, marker: marker, esc: esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.BrandCataloguePanel = api;
})(typeof window !== 'undefined' ? window : globalThis);
