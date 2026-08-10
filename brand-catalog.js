/* brand-catalog.js — one brand-aware catalogue resolver for every page.
 *
 * Pages used to fetch `/data/catalog/products_<region>.json` directly. That
 * file is the SHIPPED catalogue of tenant zero, so any other workspace - a news
 * brand, a health vertical, a brand mid-onboarding - was silently shown
 * KNICKGASM's sneakers as if they were its own products.
 *
 * Resolution order:
 *   1. The ACTIVE brand's own catalogue (`?action=brand&op=catalog`, the
 *      per-workspace product store).
 *   2. If the active brand IS tenant zero, the shipped JSON (same data, but
 *      served statically and CDN-cached).
 *   3. Otherwise an EMPTY list plus a `reason` - never another brand's products.
 *      Callers should render a "no catalogue connected" state from that.
 *
 * Usage:
 *   const { products, source, reason } = await BrandCatalog.load('us');
 *
 * `source` is 'brand' | 'shipped' | 'none'. Anything rendering products should
 * check it: `none` means say so, not fall back.
 */
(function () {
  'use strict';
  if (window.BrandCatalog) return;

  var CACHE = {};                     // region -> resolved result
  var SHIPPED_SLUG = 'knickgasm';     // tenant zero; the only brand the static JSON describes

  function activeBrand() {
    try {
      if (window.BrandContext && window.BrandContext.ready) return window.BrandContext.ready();
    } catch (_) {}
    return Promise.resolve(null);
  }

  function isTenantZero(brand) {
    if (!brand) return false;
    if (brand.is_default) return true;
    return String(brand.slug || '').toLowerCase() === SHIPPED_SLUG;
  }

  function fetchShipped(region) {
    return fetch('/data/catalog/products_' + encodeURIComponent(region) + '.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { return { products: rows || [], source: 'shipped', reason: '' }; })
      .catch(function () { return { products: [], source: 'none', reason: 'shipped catalogue unavailable' }; });
  }

  function fetchBrandCatalog(region) {
    var url = '/api/public-config?action=brand&op=catalog&region=' + encodeURIComponent(region);
    return fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var rows = (d && d.products) || [];
        // Normalise to the shape the static JSON uses (n/i/t/h/price/type), so
        // callers do not need two code paths.
        return rows.map(function (p) {
          return {
            n: p.title || p.n || '',
            i: p.image || p.i || '',
            imgs: p.images || p.imgs || undefined,
            t: p.tags || p.t || [],
            h: p.handle || p.h || '',
            price: p.price,
            compare_at: p.compare_at,
            type: p.type || p.product_type || '',
            subtitle: p.subtitle || '',
          };
        });
      })
      .catch(function () { return null; });
  }

  /* The brand's own offerings, with its matching PRESET as fallback. A
     workspace onboarded from a preset (a publisher, a health vertical) has no
     uploaded product CSV, but its offerings - sections, events, programmes,
     plans - ARE its catalogue, and every picker and generator should list
     them rather than an empty state. Never another brand's. */
  var OFFERINGS_CACHE = null;
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
    if (OFFERINGS_CACHE) return OFFERINGS_CACHE;
    OFFERINGS_CACHE = fetch('/api/public-config?action=brand&op=presets', { cache: 'force-cache' })
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
    return OFFERINGS_CACHE;
  }

  function load(region) {
    var key = String(region || 'us').toLowerCase();
    if (CACHE[key]) return Promise.resolve(CACHE[key]);

    var out = activeBrand().then(function (brand) {
      // No active brand: the gate is up; render nothing rather than tenant zero's
      // products leaking onto the screen behind it.
      if (!brand) return { products: [], source: 'none', reason: 'no active brand' };

      return fetchBrandCatalog(key).then(function (rows) {
        if (rows && rows.length) return { products: rows, source: 'brand', reason: '' };
        if (isTenantZero(brand)) return fetchShipped(key);
        // The brand's own offerings ARE its catalogue when no product store is
        // connected. Prices are never invented for them.
        return brandOfferings(brand).then(function (offs) {
          if (offs && offs.length) {
            return {
              products: offs.map(function (o) {
                return {
                  n: o.title || o.name || '', i: '', t: [String(o.kind || 'product')],
                  h: o.url || '', price: null, type: String(o.kind || 'product'),
                  subtitle: o.note || '', offering: true,
                };
              }),
              source: 'offerings', reason: '',
            };
          }
          return {
            products: [], source: 'none',
            reason: 'No catalogue is connected for ' + (brand.name || 'this brand') +
                    '. Import one from the brand setup; another brand\'s products are never substituted.',
          };
        });
      });
    }).catch(function () {
      return { products: [], source: 'none', reason: 'catalogue lookup failed' };
    });

    CACHE[key] = out;
    return out;
  }

  function invalidate() { CACHE = {}; }
  try { window.addEventListener('brandcontext:change', invalidate); } catch (_) {}

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
    SHIPPED_SLUG: SHIPPED_SLUG, DATE_BOUND: DATE_BOUND, TENANT_ZERO_DATA: TENANT_ZERO_DATA,
  };
})();
