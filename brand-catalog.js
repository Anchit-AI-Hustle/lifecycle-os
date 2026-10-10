/* brand-catalog.js — one brand-aware catalogue resolver for every page.
 *
 * Pages used to fetch `/data/catalog/products_<region>.json` directly. That
 * file is the SHIPPED catalogue of tenant zero, so any other workspace - a news
 * brand, a health vertical, a brand mid-onboarding - was silently shown
 * KNICKGASM's sneakers as if they were its own products. On 2026-10-05 a momos
 * restaurant's Google ad creatives were composed over tenant zero's sneaker
 * photos and captioned "composed from real Shopify catalog photos":
 * ad-campaigns.html did not load this file and fell back to that fetch.
 *
 * THIS FILE IS THE ONLY BROWSER CODE THAT MAY FETCH `/data/catalog/`, and only
 * for tenant zero (tests/catalog-provenance.spec.js records every request a
 * page makes and fails on any other).
 *
 * Resolution order:
 *   1. A brand kept ON THIS DEVICE (a phone sign-in, id `local-*`): the
 *      catalogue it imported (deviceCatalogImport / the context pack), kept
 *      beside it under the per-account namespace (BrandContext.deviceCatalog).
 *      Before 2026-10-05 this was never read: the resolver asked the server,
 *      which keeps no rows for a device brand, so an imported catalogue never
 *      reached a single page.
 *   2. An account brand: its own rows (`?action=brand&op=catalog`, scoped to
 *      its workspace id, with the session's token).
 *   3. If the active brand IS tenant zero, the shipped JSON.
 *   4. The brand's own offerings (no photos, no prices invented).
 *   5. Otherwise an EMPTY list plus a `reason` - never another brand's products.
 *
 * Rows never cross BRANDS. Within a brand the server twin's market rule applies
 * (brand-catalog-server.forRegion): the market's own rows, else the brand's
 * rows filed under the market it imported (`widened` names it, so a caption
 * can say so). Pass the MARKET (us, uk, in, global...), not a shipped file
 * name: the mapping to tenant zero's three files is here.
 *
 * Usage:
 *   const r = await BrandCatalog.load('us');
 *   r.products  - rows in the static JSON's short shape (n/i/imgs/t/h/price/
 *                 type) PLUS name/handle/img/url, so callers need one path;
 *   r.source    - 'device' | 'brand' | 'shipped' | 'offerings' | 'none';
 *   r.reason    - why the list is empty, in a sentence;
 *   r.brand     - { id, name, slug } of the brand the rows belong to;
 *   r.origin    - where the rows came from (the import record), or null.
 *   BrandCatalog.describe(r)            - one true sentence naming that source;
 *   BrandCatalog.marker(region, field)  - the DATA REQUIRED marker for a gap;
 *   BrandCatalog.storeBase(region), productUrl(row, region)
 *                                       - the ACTIVE brand's own store, never a literal host.
 */
(function () {
  'use strict';
  if (window.BrandCatalog) return;

  var CACHE = {};                     // brand id | region -> resolved result (account / shipped only)
  var SHIPPED_SLUG = 'knickgasm';     // tenant zero; the only brand the static JSON describes
  // The shipped files exist for these; every other market of tenant zero reads
  // the global file (the build puts the whole catalogue in each region file).
  var SHIPPED_FILE = { us: 'us', uk: 'uk', global: 'global' };
  // Region FAMILIES, so a row filed under GB answers a UK request.
  var FAMILY = { gb: 'uk', uk: 'uk', worldwide: 'global', ww: 'global', global: 'global', usa: 'us', us: 'us' };
  function fam(c) { c = String(c || '').trim().toLowerCase(); return FAMILY[c] || c; }

  function activeBrand() {
    try {
      var B = window.BrandContext;
      if (B && B.ready) {
        // ready() resolves ONCE, with the first brand; a switch since then is
        // on .brand, and that is the brand to answer for.
        return B.ready().then(function (first) { return B.brand || first || null; });
      }
    } catch (_) {}
    return Promise.resolve(null);
  }
  function brandNow() { try { return (window.BrandContext && window.BrandContext.brand) || null; } catch (_) { return null; } }

  /* Tenant zero by the SERVER's determination, never by a slug (2026-10-05):
     a slug is the client's to write, and the KNICKGASM preset in the gallery
     hands one to anybody who picks it (and it survives a rename). The rule is
     brand-context.js isTenantZero(); this copy is the same rule for a page
     that has no BrandContext (it then has no brand either). */
  function isTenantZero(brand) {
    if (!brand) return false;
    try { if (window.BrandContext && typeof window.BrandContext.isTenantZero === 'function') return !!window.BrandContext.isTenantZero(brand); } catch (_) {}
    if (isDeviceBrand(brand)) return false;
    if (brand.owns_shipped === true) return true;
    return brand.is_default === true && !brand.id;
  }
  function isDeviceBrand(brand) {
    var id = String((brand && brand.id) || '');
    try {
      var D = window.BrandContext && window.BrandContext.device;
      if (D && typeof D.isDeviceId === 'function') return !!D.isDeviceId(id);
    } catch (_) {}
    return /^local-/.test(id);
  }
  function brandRef(brand) {
    return brand ? { id: brand.id || '', name: brand.name || '', slug: String(brand.slug || '').toLowerCase() } : null;
  }

  function httpUrl(u) { return (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : ''; }
  function firstHttp(list) {
    if (!Array.isArray(list)) return '';
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      var u = httpUrl(typeof x === 'string' ? x : (x && (x.src || x.url)));
      if (u) return u;
    }
    return '';
  }
  /** One row shape for every source: the short keys existing callers read,
   *  plus name/handle/img/url. A row with no http image has img ''. */
  function normRow(p) {
    p = p || {};
    var imgs = Array.isArray(p.images) ? p.images : (Array.isArray(p.imgs) ? p.imgs : undefined);
    var img = httpUrl(p.image_url) || httpUrl(p.image) || httpUrl(p.i) || firstHttp(imgs);
    var name = String(p.title || p.n || p.name || '');
    var handle = String(p.handle || p.h || '');
    // The row's own fields are kept (a product page reads its format, paint,
    // notes...); the normalised keys are laid over them.
    return Object.assign({}, p, {
      n: name, i: img, imgs: imgs, t: p.tags || p.t || [], h: handle,
      price: p.price, compare_at: p.compare_at,
      type: p.type || p.product_type || '', subtitle: p.subtitle || '',
      region: p.region ? String(p.region).toLowerCase() : undefined,
      name: name, handle: handle, img: img,
      url: httpUrl(p.product_url) || httpUrl(p.url) || '',
    });
  }

  function fetchShipped(region, brand) {
    var file = SHIPPED_FILE[fam(region)] || 'global';
    return fetch('/data/catalog/products_' + encodeURIComponent(file) + '.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        return {
          products: (Array.isArray(rows) ? rows : []).map(normRow), source: 'shipped', reason: '',
          brand: brandRef(brand), origin: { kind: 'shipped', file: 'products_' + file + '.json' },
        };
      })
      .catch(function () { return { products: [], source: 'none', reason: 'shipped catalogue unavailable', brand: brandRef(brand), origin: null }; });
  }

  /** An account brand's own rows: scoped to ITS workspace id and sent with
   *  the session's token (BrandContext.api), never an unscoped read. */
  function fetchBrandCatalog(region, brand) {
    var B = window.BrandContext;
    // Every region of the brand's own rows; forRegion() narrows them the way
    // the server's renderers do, so a page and a generator agree.
    var q = '&workspace_id=' + encodeURIComponent(brand.id || '') + '&limit=500';
    var call;
    try {
      call = (B && typeof B.api === 'function')
        ? B.api('catalog', { query: q })
        : fetch('/api/public-config?action=brand&op=catalog' + q, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; });
    } catch (e) { call = Promise.reject(e); }
    return Promise.resolve(call)
      .then(function (d) { return forRegion(((d && d.products) || []).map(normRow), region); })
      .catch(function () { return null; });
  }

  /** A brand's OWN rows narrowed to one market - the server twin's rule
   *  (brand-catalog-server.forRegion): the market's own rows; else rows filed
   *  under no market; else the brand's rows for the market it imported, each
   *  still carrying that market, because a brand that imported ONE storefront
   *  stamped it with one region and it is still that brand's own data.
   *  Crossing BRANDS never happens here: every row passed in is the brand's. */
  function forRegion(all, region) {
    var want = fam(region);
    var exact = all.filter(function (p) { return p.region && fam(p.region) === want; });
    if (exact.length) return { rows: exact, widened: '' };
    var unregioned = all.filter(function (p) { return !p.region; });
    if (unregioned.length) return { rows: unregioned, widened: '' };
    var have = [];
    all.forEach(function (p) { var r = String(p.region || '').toUpperCase(); if (r && have.indexOf(r) < 0) have.push(r); });
    return { rows: all, widened: have.join(', ') };
  }

  /** A brand on this device: the catalogue kept beside it. Read fresh each
   *  time, because an import on the onboarding page lands here without an event. */
  /* ── Whose catalogue it is (2026-10-10) ─────────────────────────────────
     A record named Mamaearth carried a catalogue imported from another
     company's site, and every page composed that company's products under
     Mamaearth's name. The coherence rule (BrandContext.coherenceLib, the
     server's rule ported byte for byte) judges it: a catalogue it calls
     another brand's, that the person has not kept, contributes nothing, and
     each row is judged by the page it was read from. The account path reads
     the server's verdict off the shell (catalog_identity). */
  function verdictOf(brand) {
    if (!brand) return null;
    if (brand.catalog_identity && typeof brand.catalog_identity === 'object') return brand.catalog_identity;
    try { var L = window.BrandContext && window.BrandContext.coherenceLib; return L ? L.catalogIdentity(brand) : null; } catch (_) { return null; }
  }
  function foreignRow(row, v) {
    if (!v) return false;
    try { var L = window.BrandContext && window.BrandContext.coherenceLib; return L ? L.catalogRowForeign(row, v) : !!v.excluded; } catch (_) { return !!v.excluded; }
  }
  function excludedResult(brand, v) {
    return {
      products: [], source: 'none', brand: brandRef(brand), origin: null, catalog_excluded: v,
      reason: (v.marker || marker('', 'product catalogue', brand)) + ' ' + (v.sentence || ''),
    };
  }

  function deviceRows(brand, region) {
    var cat = null;
    try {
      var BC = window.BrandContext;
      cat = (BC && BC.catalogForGeneration) ? BC.catalogForGeneration(brand.id) : null;
    } catch (_) { cat = null; }
    // A product a complete re-import no longer found is kept beside the brand
    // (stale_at) but is not offered to anything that builds an asset.
    var all = ((cat && Array.isArray(cat.products)) ? cat.products : []).filter(function (p) { return p && !p.stale_at; }).map(normRow).filter(function (p) { return p.name || p.handle; });
    var narrowed = forRegion(all, region);
    var origin = (cat && cat.source && typeof cat.source === 'object') ? cat.source
      : (brand.catalog_source && typeof brand.catalog_source === 'object' && brand.catalog_source.kind ? brand.catalog_source : null);
    return { rows: narrowed.rows, widened: narrowed.widened, origin: origin, excluded: (cat && cat.excluded) || null };
  }

  /* The brand's own offerings, with its matching PRESET as fallback. A
     workspace onboarded from a preset (a publisher, a health vertical) has no
     uploaded product CSV, but its offerings - sections, events, programmes,
     plans - ARE its catalogue, and every picker and generator should list
     them rather than an empty state. Never another brand's. */
  var OFFERINGS_CACHE = {};
  function hostOf(u) { try { return String(u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase(); } catch (_) { return ''; } }
  function presetMatches(brand, preset) {
    if (!brand || !preset) return false;
    if (hostOf(brand.website) && hostOf(brand.website) === hostOf(preset.website)) return true;
    var bs = String(brand.slug || '').toLowerCase(), ps = String(preset.slug || '').toLowerCase();
    if (bs && ps && (bs.indexOf(ps) === 0 || ps.indexOf(bs) === 0)) return true;
    var bn = String(brand.name || '').trim().toLowerCase(), pn = String(preset.name || '').trim().toLowerCase();
    // Full-string containment only - never token overlap, which would match
    // "The Times of India" to "The Economic Times" on {the, times}.
    return !!(bn && pn && (bn === pn || bn.indexOf(pn) >= 0 || pn.indexOf(bn) >= 0));
  }
  function brandOfferings(brand) {
    if (Array.isArray(brand.offerings) && brand.offerings.length) return Promise.resolve(brand.offerings);
    if (brand.brand_data && Array.isArray(brand.brand_data.offerings) && brand.brand_data.offerings.length) {
      return Promise.resolve(brand.brand_data.offerings);
    }
    // Per brand: a cache shared across brands answered the SECOND brand with
    // the first one's preset offerings.
    var key = String(brand.id || brand.slug || brand.name || '');
    if (OFFERINGS_CACHE[key]) return OFFERINGS_CACHE[key];
    OFFERINGS_CACHE[key] = fetch('/api/public-config?action=brand&op=presets', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var list = (d && d.presets) || [];
        var hit = null;
        for (var i = 0; i < list.length; i++) if (presetMatches(brand, list[i])) { hit = list[i]; break; }
        if (!hit || !hit.slug) return [];
        return fetch('/api/public-config?action=brand&op=presets&slug=' + encodeURIComponent(hit.slug), { cache: 'force-cache' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (full) {
            var p = full && full.preset;
            return (p && Array.isArray(p.offerings)) ? p.offerings : [];
          });
      })
      .catch(function () { return []; });
    return OFFERINGS_CACHE[key];
  }

  /** No rows of its own for this region: the offerings, else an honest none. */
  function withoutRows(brand, region, why) {
    var v = verdictOf(brand);
    return brandOfferings(brand).then(function (offs) {
      // An offering whose page is another brand's is not this brand's either.
      offs = (offs || []).filter(function (o) { return !(o && (o.url || o.source_url) && foreignRow({ product_url: o.source_url || o.url }, v)); });
      if (offs && offs.length) {
        return {
          products: offs.map(function (o) {
            var r = normRow({ title: o.title || o.name || '', url: o.url || '', type: String(o.kind || 'product') });
            r.t = [String(o.kind || 'product')]; r.h = o.url || ''; r.handle = r.h; r.price = null;
            r.subtitle = o.note || ''; r.offering = true;
            return r;
          }),
          source: 'offerings', reason: why || '', brand: brandRef(brand), origin: { kind: 'offerings' },
        };
      }
      return {
        products: [], source: 'none', brand: brandRef(brand), origin: null,
        reason: why || ('No catalogue is connected for ' + (brand.name || 'this brand') +
                '. Import one from the brand setup; another brand\'s products are never substituted.'),
      };
    });
  }

  function load(region, opts) {
    // No region named: the brand's HOME market (2026-10-05), never 'us'.
    var key = fam(region || (window.RegionContext && window.RegionContext.home) || '') || '';
    var o = opts || {};
    return activeBrand().then(function (brand) {
      // No active brand: the gate is up; render nothing rather than tenant zero's
      // products leaking onto the screen behind it. A page that IS tenant zero's
      // public demo (the 3D storefront, the connector showcases) may ask for the
      // shipped default when there is no brand AT ALL - brand-context's
      // ownsShipped() rule - and never for a brand that is somebody else.
      if (!brand) {
        if (o.shippedPreview) return fetchShipped(key, null);
        return { products: [], source: 'none', reason: 'no active brand', brand: null, origin: null };
      }

      // 1. A brand on this device reads ONLY what it keeps on this device. The
      //    server keeps no rows for it, and tenant zero's shipped file is not
      //    its catalogue whatever it is called (isTenantZero is false for it).
      if (isDeviceBrand(brand)) {
        var dv = deviceRows(brand, key);
        if (dv.rows.length) return { products: dv.rows, source: 'device', reason: '', widened: dv.widened, brand: brandRef(brand), origin: dv.origin };
        if (dv.excluded) return excludedResult(brand, dv.excluded);
        return withoutRows(brand, key, '');
      }

      var ck = (brand.id || brand.slug || '') + '|' + key;
      if (CACHE[ck]) return CACHE[ck];
      var out = fetchBrandCatalog(key, brand).then(function (got) {
        var v = isTenantZero(brand) ? null : verdictOf(brand);
        if (got && v) {
          var mine = got.rows.filter(function (p) { return !foreignRow(p, v); });
          if (!mine.length && (v.excluded || got.rows.length)) return excludedResult(brand, v.excluded ? v : Object.assign({}, v, { sentence: 'Every product in this catalogue was read from another brand\'s site, so none is used for ' + (brand.name || 'this brand') + '.' }));
          got = { rows: mine, widened: got.widened };
        } else if (!got && v && v.excluded) return excludedResult(brand, v);
        if (got && got.rows.length) return { products: got.rows, source: 'brand', reason: '', widened: got.widened, brand: brandRef(brand), origin: (brand.catalog_source && brand.catalog_source.kind) ? brand.catalog_source : null };
        if (isTenantZero(brand)) return fetchShipped(key, brand);
        // The brand's own offerings ARE its catalogue when no product store is
        // connected. Prices are never invented for them.
        return withoutRows(brand, key, '');
      }).catch(function () {
        return { products: [], source: 'none', reason: 'catalogue lookup failed', brand: brandRef(brand), origin: null };
      });
      CACHE[ck] = out;
      return out;
    }).catch(function () {
      return { products: [], source: 'none', reason: 'catalogue lookup failed', brand: null, origin: null };
    });
  }

  function invalidate() { CACHE = {}; OFFERINGS_CACHE = {}; }
  try { window.addEventListener('brandcontext:change', invalidate); } catch (_) {}

  /* ── What a page may SAY about a catalogue ──────────────────────────────
     "Composed from real Shopify catalog photos" was printed under creatives
     built from another brand's photographs. The sentence is derived from the
     result now, and names the brand the rows belong to. */
  function marker(region, field, brand) {
    var b = brand || brandNow();
    return '[DATA REQUIRED BEFORE LAUNCH: ' + (field || 'product image') + ', ' +
      ((b && b.name) || 'brand name') + ', ' + (String(region || '').toUpperCase() || 'region') + ']';
  }
  function originLabel(o) {
    if (!o || typeof o !== 'object') return '';
    var k = String(o.kind || '');
    var host = hostOf(o.url);
    var what = k === 'shopify_public' ? 'its public store feed'
      : k === 'site_crawl' ? 'its own website'
      : k === 'csv' ? 'a CSV import'
      : k === 'json' ? 'a JSON import'
      : k === 'shipped' ? 'shipped catalogue (' + (o.file || 'data/catalog') + ')'
      : k ? k : '';
    return what + (host && (k === 'shopify_public' || k === 'site_crawl') ? ' at ' + host : '');
  }
  function describe(res) {
    res = res || {};
    var name = (res.brand && res.brand.name) || 'this brand';
    var n = (res.products || []).length;
    var o = originLabel(res.origin);
    var filed = res.widened ? '; filed under ' + res.widened : '';
    var count = n + (n === 1 ? ' product' : ' products');
    switch (res.source) {
      case 'device':  return name + '\'s own catalogue kept on this device' + (o ? ', imported from ' + o : '') + ' (' + count + filed + ')';
      case 'brand':   return name + '\'s own catalogue' + (o ? ', imported from ' + o : '') + ' (' + count + filed + ')';
      case 'shipped': return name + '\'s own ' + (o || 'shipped catalogue') + ' (' + count + ')';
      case 'offerings': return name + '\'s listed offerings (' + n + ', no product photos)';
      default: return res.reason || ('No catalogue is connected for ' + name + '.');
    }
  }

  /* The ACTIVE brand's own store. Pages carried `https://knickgasm.com` per
     region, so another brand's PDP links and "shop" buttons pointed at tenant
     zero's store. Read from the brand record (regions[].store_url, then
     website); '' when the record has neither, and the caller renders the
     marker. */
  function storeBase(region, brand) {
    var b = brand || brandNow();
    if (!b) return '';
    var want = fam(region);
    var regs = Array.isArray(b.regions) ? b.regions : [];
    for (var i = 0; i < regs.length; i++) {
      var r = regs[i] || {};
      if (want && fam(r.code || r.region) === want && httpUrl(r.store_url)) return r.store_url.replace(/\/+$/, '');
    }
    var home = null;
    for (var j = 0; j < regs.length; j++) if (regs[j] && regs[j].home && httpUrl(regs[j].store_url)) { home = regs[j]; break; }
    if (!want && home) return home.store_url.replace(/\/+$/, '');
    return httpUrl(b.website) ? b.website.replace(/\/+$/, '') : '';
  }
  function productUrl(row, region, brand) {
    row = row || {};
    var u = httpUrl(row.url);
    if (u) return u;
    var h = row.handle || row.h || '';
    if (/^https?:\/\//i.test(h)) return h;
    var base = storeBase(region, brand);
    if (!base || !h) return base || '';
    var b = brand || brandNow();
    var regs = (b && Array.isArray(b.regions)) ? b.regions : [];
    var pat = '';
    for (var i = 0; i < regs.length; i++) if (regs[i] && fam(regs[i].code) === fam(region) && regs[i].pdp_pattern) { pat = regs[i].pdp_pattern; break; }
    return (pat || '{base}/products/{handle}').replace('{base}', base).replace('{handle}', encodeURIComponent(h));
  }

  /* ── Offerings ───────────────────────────────────────────────────────────
     A brand's catalogue is not always products. A publisher's is sections,
     newsletters and subscriptions; a health vertical's is programmes (a daily
     morning series, a multi-week training plan) and date-bound events (a run,
     a yoga day). loadOfferings() returns them split the way a calendar needs:
     `upcoming` ramps to its date, `evergreen` can run any time, and `past` is
     handed back separately so nothing ever promotes a finished event. */
  var DATE_BOUND = { event: true, programme: true };

  function normOffering(o) {
    if (!o || typeof o !== 'object' || !o.name) return null;
    var kind = o.kind || 'product';
    return Object.assign({}, o, { kind: kind, dateBound: !!DATE_BOUND[kind] });
  }

  function loadOfferings(now) {
    return activeBrand().then(function (brand) {
      if (!brand) return { evergreen: [], upcoming: [], past: [], source: 'none', reason: 'no active brand' };
      var today = now ? new Date(now) : new Date();
      return brandOfferings(brand).then(function (raw) { return splitOfferings(brand, raw, today); });
    }).catch(function () {
      return { evergreen: [], upcoming: [], past: [], source: 'none', reason: 'offering lookup failed' };
    });
  }

  function splitOfferings(brand, raw, today) {
    {
      var list = (raw || []).map(normOffering).filter(Boolean);
      var out = { evergreen: [], upcoming: [], past: [], source: list.length ? 'brand' : 'none', reason: '' };
      list.forEach(function (o) {
        if (!o.dateBound) { out.evergreen.push(o); return; }
        var when = o.starts_at ? new Date(o.starts_at) : null;
        if (!when || isNaN(when.getTime())) { out.evergreen.push(o); return; }
        (when >= today ? out.upcoming : out.past).push(o);
      });
      out.upcoming.sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
      if (!list.length) {
        out.reason = 'No offerings are listed for ' + (brand.name || 'this brand') +
          '. Add products, events, programmes, sections or plans in the brand setup.';
      }
      return out;
    }
  }

  /* ── Shipped tenant-zero datasets ────────────────────────────────────────
     Several pages read static JSON that describes TENANT ZERO specifically -
     its analytics, its cohort sizes, its commercial moments, its product-type
     taxonomy, its verified asset library. Those are facts about one brand, so
     serving them to another workspace is exactly the cross-brand leak the
     platform must not have. loadData() returns them ONLY to tenant zero and
     otherwise returns null with a reason, so the caller renders an empty state.

     A dataset that is genuinely brand-independent does not belong here. */
  var TENANT_ZERO_DATA = {
    'analytics':     '/data/analytics/market-data.json',
    'cohort-sizes':  '/data/cohort-sizes.json',
    'moments':       '/data/festivals.json',
    'product-types': '/data/product-types.json',
    'brand-assets':  '/data/brand-assets/us.json',
    'live-shopify':  '/data/analytics/live-shopify.json',
  };

  function loadData(name) {
    var url = TENANT_ZERO_DATA[name];
    if (!url) return Promise.resolve({ data: null, source: 'none', reason: 'unknown dataset: ' + name });
    return activeBrand().then(function (brand) {
      if (!brand) return { data: null, source: 'none', reason: 'no active brand' };
      if (!isTenantZero(brand)) {
        return {
          data: null, source: 'none',
          reason: 'This dataset describes ' + SHIPPED_SLUG + ', not ' + (brand.name || 'this brand') +
                  '. Connect ' + (brand.name || 'the brand') + '\'s own data rather than reading another brand\'s numbers.',
        };
      }
      return fetch(url, { cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return { data: d, source: 'shipped', reason: '' }; })
        .catch(function () { return { data: null, source: 'none', reason: 'dataset unavailable' }; });
    }).catch(function () { return { data: null, source: 'none', reason: 'lookup failed' }; });
  }

  window.BrandCatalog = {
    load: load, loadOfferings: loadOfferings, loadData: loadData, invalidate: invalidate,
    describe: describe, marker: marker, storeBase: storeBase, productUrl: productUrl,
    isTenantZero: isTenantZero, region: fam,
    SHIPPED_SLUG: SHIPPED_SLUG, DATE_BOUND: DATE_BOUND, TENANT_ZERO_DATA: TENANT_ZERO_DATA,
  };
})();
