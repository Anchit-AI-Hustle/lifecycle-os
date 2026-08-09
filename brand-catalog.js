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
        return {
          products: [], source: 'none',
          reason: 'No catalogue is connected for ' + (brand.name || 'this brand') +
                  '. Import one from the brand setup; another brand\'s products are never substituted.',
        };
      });
    }).catch(function () {
      return { products: [], source: 'none', reason: 'catalogue lookup failed' };
    });

    CACHE[key] = out;
    return out;
  }

  function invalidate() { CACHE = {}; }
  try { window.addEventListener('brandcontext:change', invalidate); } catch (_) {}

  window.BrandCatalog = { load: load, invalidate: invalidate, SHIPPED_SLUG: SHIPPED_SLUG };
})();
