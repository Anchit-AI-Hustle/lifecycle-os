/* brand-demo.js — per-brand DEMO datasets, derived from the ACTIVE brand.
 *
 * The analytics/report pages ship with one compiled dataset that describes
 * tenant zero. For any other active brand those numbers are someone else's
 * business, so the pages blank them. This module fills the gap the honest way:
 * a clearly-labelled DEMO dataset generated deterministically from the active
 * brand's OWN record (its offerings, regions and currency) — never another
 * brand's figures, never presented as real.
 *
 * Rules:
 *  - Tenant zero keeps its real compiled data; this module does nothing.
 *  - A brand with no offerings on record gets NOTHING from here (the page
 *    keeps its DATA REQUIRED empty state) — we do not invent a catalogue.
 *  - Every generated object carries __demo:true and a generated_note naming
 *    the brand, so no consumer can mistake it for real performance.
 *  - Deterministic: seeded by the brand slug, so refreshes do not reshuffle.
 */
(function () {
  'use strict';
  if (window.BrandDemo) return;

  var OWNER = 'knickgasm';

  /* seeded PRNG (mulberry32) so demo figures are stable per brand */
  function seedOf(str) {
    var h = 1779033703 ^ String(str).length;
    for (var i = 0; i < String(str).length; i++) {
      h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function isOwner(brand) {
    if (!brand || brand.is_default) return true;
    return String(brand.slug || brand.name || '').toLowerCase() === OWNER;
  }

  /* ── offerings: brand record first, then its matching preset ──────────── */
  function presetMatches(brand, preset) {
    if (!brand || !preset) return false;
    var host = function (u) { try { return String(u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase(); } catch (_) { return ''; } };
    if (host(brand.website) && host(brand.website) === host(preset.website)) return true;
    var bs = String(brand.slug || '').toLowerCase(), ps = String(preset.slug || '').toLowerCase();
    if (bs && ps && (bs.indexOf(ps) === 0 || ps.indexOf(bs) === 0)) return true;
    var bn = String(brand.name || '').toLowerCase(), pn = String(preset.name || '').toLowerCase();
    if (bn && pn && (bn.indexOf(pn) >= 0 || pn.indexOf(bn) >= 0)) return true;
    // token overlap, stopword-free: "The Times of India" and "The Economic
    // Times" share {the, times} and are NOT the same brand.
    var STOP = { the: 1, and: 1, for: 1 };
    var toks = function (s) { return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (t) { return t.length > 2 && !STOP[t]; }); };
    var a = toks(bn), b = toks(pn), hits = 0;
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) >= 0) hits++;
    return hits >= 2;
  }

  function fetchOfferings(brand) {
    var own = (brand && brand.brand_data && Array.isArray(brand.brand_data.offerings) && brand.brand_data.offerings.length)
      ? brand.brand_data.offerings : null;
    if (own) return Promise.resolve(own);
    // The gallery index is a trimmed view; the full record (with offerings)
    // is served per slug. Match on the index, then fetch the full preset.
    return fetch('/api/public-config?action=brand&op=presets', { cache: 'force-cache' })
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
  }

  /* ── the demo analytics dataset (LIFECYCLE_ANALYTICS shape) ───────────── */
  function buildAnalytics(brand, offerings) {
    if (!offerings || !offerings.length) return null;
    var rnd = mulberry32(seedOf(String(brand.slug || brand.name || 'brand')));
    var regions = (Array.isArray(brand.regions) && brand.regions.length) ? brand.regions : [{ code: 'IN', currency: 'INR', symbol: '₹' }];
    var currency = {};
    var markets = {};

    // Media brands (events/programmes/sections) transact in registrations and
    // subscriptions, so scale "order" economics accordingly.
    var kinds = offerings.map(function (o) { return String(o.kind || 'product'); });
    var isMedia = kinds.some(function (k) { return k === 'event' || k === 'programme' || k === 'section'; });
    var baseAov = isMedia ? 6 + rnd() * 14 : 40 + rnd() * 140;

    regions.slice(0, 3).forEach(function (rg) {
      var code = String(rg.code || 'IN').toUpperCase();
      currency[code] = rg.currency || 'INR';
      var scale = 0.6 + rnd() * 0.9;
      var monthly = [];
      var now = new Date(); now.setDate(1);
      var totOrders = 0, totSales = 0;
      for (var i = 23; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        var growth = 1 + (23 - i) * (0.02 + rnd() * 0.015);           // gentle up-trend
        var season = 1 + 0.22 * Math.sin(((d.getMonth() + 2) / 12) * Math.PI * 2); // festive bump
        var orders = Math.max(8, Math.round((isMedia ? 420 : 60) * scale * growth * season * (0.85 + rnd() * 0.3)));
        var aov = +(baseAov * (0.9 + rnd() * 0.2)).toFixed(2);
        var sales = +(orders * aov).toFixed(2);
        totOrders += orders; totSales += sales;
        monthly.push({ month: d.toISOString().slice(0, 10), orders: orders, sales: sales, aov: aov });
      }
      var weekly = [];
      for (var w = 25; w >= 0; w--) {
        var wd = new Date(); wd.setDate(wd.getDate() - wd.getDay() + 1 - w * 7);
        var wOrders = Math.max(2, Math.round(monthly[23].orders / 4 * (0.8 + rnd() * 0.4)));
        var wAov = +(baseAov * (0.9 + rnd() * 0.2)).toFixed(2);
        weekly.push({ week: wd.toISOString().slice(0, 10), orders: wOrders, sales: +(wOrders * wAov).toFixed(2), net: 0, aov: wAov });
      }
      var tops = offerings.slice(0, 12).map(function (o, idx) {
        var qty = Math.max(5, Math.round((totOrders / offerings.length) * (1.6 - idx * 0.1) * (0.7 + rnd() * 0.6)));
        return { title: o.title || o.name || 'Offering ' + (idx + 1), net: +(qty * baseAov).toFixed(2), gross: 0, orders: qty, quantity: qty };
      });
      var cohorts = [];
      for (var c = 5; c >= 1; c--) {
        var cd = new Date(now.getFullYear(), now.getMonth() - c * 3, 1);
        var ret = [100];
        var keep = isMedia ? 30 + rnd() * 15 : 14 + rnd() * 5;
        for (var s = 1; s < 8; s++) ret.push(c * 3 > s * 3 ? +(keep * Math.pow(0.82, s - 1)).toFixed(1) : null);
        cohorts.push({ cohort: cd.toISOString().slice(0, 10), base: Math.round(totOrders / 10 * (0.7 + rnd() * 0.6)), retention: ret });
      }
      var newC = Math.round(totOrders * (0.55 + rnd() * 0.15));
      markets[code] = {
        summary: {
          orders: totOrders, total_sales: +totSales.toFixed(2), net_sales: +(totSales * 0.94).toFixed(2),
          gross_sales: +(totSales * 1.07).toFixed(2), aov: +(totSales / totOrders).toFixed(2),
          quantity: Math.round(totOrders * 1.18), new_customers: newC,
          returning_customers: totOrders - newC, returning_rate: +((totOrders - newC) / totOrders).toFixed(4)
        },
        monthly: monthly, weekly: weekly,
        aov_trend: monthly.map(function (m) { return { month: m.month, aov: m.aov, orders: m.orders, sales: m.sales }; }),
        top_products: tops, cohort: cohorts
      };
    });

    return {
      __demo: true,
      generated_note: 'DEMO DATA - generated deterministically from ' + (brand.name || 'this brand') + "'s own offerings and regions. These are not real performance figures. Connect this brand's commerce or analytics exports to replace them.",
      brand: brand.name || '', currency: currency, markets: markets
    };
  }

  /* ── public surface ───────────────────────────────────────────────────── */
  var resolved = null;
  function ready() {
    if (resolved) return resolved;
    resolved = new Promise(function (res) {
      var started = Date.now(), injected = false;
      function go() {
        if (!(window.BrandContext && window.BrandContext.ready)) {
          // Some artifact pages never load the auth shell; pull in the brand
          // context ourselves so the owner check can still run. If it will not
          // load (signed-out static view), fail open to today's behaviour.
          if (!injected && Date.now() - started > 600) {
            injected = true;
            var s = document.createElement('script');
            s.src = '/brand-context.js?v=demo';
            document.head.appendChild(s);
          }
          if (Date.now() - started > 8000) { res({ brand: null, owner: true, analytics: null }); return; }
          setTimeout(go, 150); return;
        }
        window.BrandContext.ready().then(function (brand) {
          if (!brand || isOwner(brand)) { res({ brand: brand, owner: true, analytics: null }); return; }
          fetchOfferings(brand).then(function (offerings) {
            res({ brand: brand, owner: false, offerings: offerings, analytics: buildAnalytics(brand, offerings) });
          });
        }).catch(function () { res({ brand: null, owner: true, analytics: null }); });
      }
      go();
    });
    return resolved;
  }

  /* Owner-only artifact pages (tenant zero campaign reports): replace the page
     body with an honest note when another brand is active. */
  function guardOwnerArtifact(label) {
    ready().then(function (ctx) {
      if (ctx.owner) return;
      var name = (ctx.brand && ctx.brand.name) || 'the active brand';
      document.title = label + ' (tenant-zero artifact)';
      document.body.innerHTML =
        '<div style="max-width:680px;margin:80px auto;padding:26px 28px;border:1px solid #e3e3e3;border-radius:14px;font-family:var(--brand-font-body,system-ui,sans-serif);line-height:1.65">' +
        '<h1 style="font-family:var(--brand-font-heading,inherit);font-size:22px;margin:0 0 12px">This report belongs to another workspace</h1>' +
        '<p style="margin:0 0 10px;opacity:.85">' + label + ' is a campaign artifact built from tenant zero’s own catalogue and sends. It is not shown while <b>' + String(name).replace(/[<>&]/g, '') + '</b> is active, because none of its figures, products or creatives describe this brand.</p>' +
        '<p style="margin:0 0 18px;opacity:.85">Equivalent reports for this brand appear as its own campaigns run through the calendar and Smart Brain.</p>' +
        '<a href="/data-analysis" style="font-weight:700;color:var(--brand-primary,#2b6be4)">Open this brand’s analytics workbench →</a></div>';
    });
  }

  /* Feature pages whose DEFINITIONS are derived from tenant zero's own
     catalogue and orders (personas, the cohort dictionary): for any other
     active brand, replace the tenant-zero data with an honest brand-scoped
     state instead of showing another brand's customers. */
  function guardOwnerDataset(label, hint) {
    ready().then(function (ctx) {
      if (ctx.owner) return;
      var name = ((ctx.brand && ctx.brand.name) || 'the active brand').replace(/[<>&]/g, '');
      var main = document.querySelector('main') || document.body;
      main.innerHTML =
        '<div style="max-width:680px;margin:60px auto;padding:26px 28px;border:1px solid var(--brand-line,#e3e3e3);border-radius:14px;font-family:var(--brand-font-body,system-ui,sans-serif);line-height:1.65">' +
        '<h2 style="font-family:var(--brand-font-heading,inherit);font-size:21px;margin:0 0 12px">' + label + ' for ' + name + '</h2>' +
        '<p style="margin:0 0 10px;opacity:.85">[DATA REQUIRED BEFORE LAUNCH: ' + label.toLowerCase() + ', ' + name + '.] ' +
        'The definitions compiled into this build are derived from another brand\'s own catalogue and order history, so they are not shown here.</p>' +
        '<p style="margin:0;opacity:.85">' + (hint || 'Connect this brand\'s commerce or engagement exports and its own definitions build from that data.') + '</p></div>';
    });
  }

  window.BrandDemo = { ready: ready, isOwner: isOwner, guardOwnerArtifact: guardOwnerArtifact, guardOwnerDataset: guardOwnerDataset };
})();
