#!/usr/bin/env node
'use strict';
/**
 * scripts/build-research-page.js - render the brand-derived block of
 * research.html (the Market Study page) from the DEFAULT brand's own record.
 *
 * WHAT IT OWNS. Everything between the two markers in research.html:
 *
 *     <!-- BRAND-STUDY:START -->  ...  <!-- BRAND-STUDY:END -->
 *
 * That is ONE study panel per region the brand serves (header card AND report
 * body), the competitive landscape, the renderer itself
 * (scripts/lib/market-study-render.js, inlined so the browser runs the SAME
 * code) and the runtime that re-renders the block for the signed-in user's
 * ACTIVE brand. Never hand-edit inside the markers: run this script. It fails
 * loudly if the markers are missing rather than quietly patching nothing.
 *
 * WHY THE HEADER CARD IS GENERATED TOO. The first version of this script
 * generated only the `.ms-report` bodies and left the card above each one as
 * hand-written HTML. That card carried a sibling wellness brand's market study
 * with the name swapped at fork time ("Rivals import airbrush; <brand> owns it
 * and is already in ~1,000 Target stores"). It was false for tenant zero, and
 * brand-context.js then renamed the text node for every other tenant - so The
 * Times of India was told it owned airbrush and sat in Target. A brand's page
 * carries what its record states, or the DATA REQUIRED marker.
 *
 * WHY THERE IS NO TYPED REGION LIST. The page used to carry four static
 * panels (US/UK/Global/India, US selected) whatever the brand, so an Indian
 * news brand whose rail already said "Market: India (IN)" landed on a US
 * study by default and was offered markets it does not serve. Tabs and panels
 * are the brand's own `regions`, its HOME market selected, the same field
 * region-context.js reads; a brand with no regions gets the marker.
 *
 * A .docx link is offered only when a document exists on disk for THIS brand's
 * slug and region AND the region has a study to put in it; the runtime never
 * offers one for a different active brand, because those files were generated
 * from tenant zero's record (scripts/build-market-study-docs.js).
 *
 * Run: node scripts/build-research-page.js   (wired into npm run build)
 */
const fs = require('fs');
const path = require('path');
const msc = require('./market-study-content.js');
const render = require('./lib/market-study-render.js');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'research.html');
const RENDER_FILE = path.join(__dirname, 'lib', 'market-study-render.js');
const START = '<!-- BRAND-STUDY:START -->';
const END = '<!-- BRAND-STUDY:END -->';

const brand = msc.defaultBrand();
const slug = String(brand.slug || brand.name || 'brand').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();
const regions = render.regionsOf(brand);

/* Documents are named by the docx builder's convention (<slug>_<R>_Market_Study
   .docx with R = US/UK/Global/India); a region code is matched to that name by
   family, so IN finds "India" and GLOBAL finds "Global". */
const docx = {};
regions.forEach((r) => {
  if (!render.studyFor(brand, r.code)) return;
  const label = render.REGIONS.find((R) => render.family(R) === render.family(r.code)) || r.code;
  const file = `${slug}_${label}_Market_Study.docx`;
  if (fs.existsSync(path.join(ROOT, 'docs', 'market-study', file))) docx[r.code] = `/docs/market-study/${file}`;
});

const RUNTIME = `
/* Market Study follows the ACTIVE brand. The block above was rendered at build
   time for the brand named in data-ms-built-for; at run time the whole block -
   tab rows, header cards, report bodies and competitive landscape - is
   re-rendered from the signed-in user's ACTIVE brand by the same renderer: its
   regions, its HOME market, ITS record. Document links are offered only to the
   brand the page was built for (those files were generated from its record).
   Region selection goes through region-context.js when it is present (the
   shared choice, family-matched codes, a ?region= deep link honoured only for a
   market the brand serves) and through the renderer's own tables otherwise.
   A brand with no study for a region gets the explicit DATA REQUIRED state,
   never a substitute; a brand with no regions gets the marker, never a shipped
   default. */
(function () {
  var host = document.getElementById('brand-study');
  var R = window.MarketStudyRender;
  if (!host || !R) return;
  var builtFor = String(host.getAttribute('data-ms-built-for') || '').toLowerCase();
  var DOCX = __DOCX__;
  var activeBrand = null;
  var rendered = false;

  function rc() { return window.RegionContext || null; }
  function fam(v) { var r = rc(); return r ? r.family(v) : R.family(v); }
  function regionName(c) { var r = rc(); return r ? r.name(c) : R.name(c); }
  function regions() { return R.regionsOf(activeBrand); }
  function resolve(v) { var r = rc(); if (r && r.loaded) return r.resolve(v); return R.resolveIn(regions(), v); }
  function home() { var r = rc(); if (r && r.loaded) return r.home; return R.homeOf(regions()); }
  function slugOf(b) { return String((b && b.slug) || '').toLowerCase(); }
  function deepLink() { try { return new URLSearchParams(location.search).get('region') || ''; } catch (_) { return ''; } }

  /* ── selection: the study panels and the benchmark filter ─────────────── */
  function showStudy(code) {
    var resolved = resolve(code) || home();
    host.querySelectorAll('.ms-panel[data-ms-region]').forEach(function (p) {
      p.style.display = (resolved && fam(p.getAttribute('data-ms-region')) === fam(resolved)) ? '' : 'none';
    });
    host.querySelectorAll('#msRegionTabs .rtab[data-region]').forEach(function (t) {
      t.classList.toggle('on', fam(t.getAttribute('data-region')) === fam(resolved));
    });
    return resolved;
  }
  function applyBench(code) {
    var resolved = resolve(code) || home();
    host.querySelectorAll('#competitors tr[data-regions]').forEach(function (tr) {
      var d = tr.getAttribute('data-regions') || '';
      tr.style.display = (d === 'ALL' || d.split(',').some(function (x) { return fam(x) === fam(resolved); })) ? '' : 'none';
    });
    host.querySelectorAll('#regionTabs .rtab[data-region]').forEach(function (t) {
      t.classList.toggle('on', fam(t.getAttribute('data-region')) === fam(resolved));
    });
    var l = document.getElementById('rgLabel'); if (l) l.textContent = resolved ? regionName(resolved) : 'no market configured';
  }
  host.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.rtab[data-region]') : null;
    if (!t) return;
    if (t.closest('#msRegionTabs')) {
      var rg = showStudy(t.getAttribute('data-region'));
      try { history.replaceState(null, '', '?region=' + String(rg).toLowerCase() + '#regional-studies'); } catch (_) {}
    } else if (t.closest('#regionTabs')) {
      applyBench(t.getAttribute('data-region'));
    }
  });

  /* ── the block, for the ACTIVE brand ──────────────────────────────────── */
  function initialStudy() {
    var q = deepLink();
    var r = rc();
    return (q && resolve(q)) || (r && r.loaded && r.region) || home();
  }
  function render() {
    if (!activeBrand) return;
    var sel = initialStudy();
    host.innerHTML = R.blockHTML(activeBrand, { docx: slugOf(activeBrand) === builtFor ? DOCX : {}, region: sel });
    host.setAttribute('data-ms-rendered-for', slugOf(activeBrand) || String(activeBrand.name || ''));
    rendered = true;
    applyBench(home());
    if (deepLink()) { var sec = document.getElementById('regional-studies'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  /* The shell payload may omit market_study: fetch the full record. */
  function full(b) {
    if (!b || b.market_study !== undefined || !b.id) return Promise.resolve(b);
    return fetch('/api/public-config?action=brand&op=get&id=' + encodeURIComponent(b.id), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (f) { return (f && f.brand) || b; })
      .catch(function () { return b; });
  }
  function withBrand(b) {
    if (!b) return;
    full(b).then(function (fb) { activeBrand = fb; render(); }).catch(function () {});
  }
  /* The shared region layer lands after the brand (it reads the brand); once
     it has, the selection follows it: the study opens on the shared choice
     unless a deep link named a market this brand serves. */
  function followRegions(waited) {
    var w = waited || 0;
    var r = rc();
    if (!r) { if (w < 6000) setTimeout(function () { followRegions(w + 100); }, 100); return; }
    r.onChange(function () {
      if (!rendered) return;
      var q = deepLink();
      showStudy((q && resolve(q)) || r.region || r.home);
    });
  }
  function boot() {
    // No brand layer at all (a file:// open): the built block is the page, its
    // tabs work through the renderer's own tables, and nothing is re-rendered.
    if (!window.BrandContext) { applyBench(R.homeOf(R.regionsOf(null)) || ''); return; }
    var p = window.BrandContext.ready ? window.BrandContext.ready() : Promise.resolve(window.BrandContext.brand);
    Promise.resolve(p).then(function (b) { withBrand(b || window.BrandContext.brand); }).catch(function () {});
    try {
      window.addEventListener('brandcontext:change', function (ev) {
        var b = ev && ev.detail && ev.detail.brand;
        if (b && slugOf(b) !== slugOf(activeBrand)) withBrand(b);
      });
    } catch (_) {}
    followRegions(0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
`.replace('__DOCX__', JSON.stringify(docx));

const renderSrc = fs.readFileSync(RENDER_FILE, 'utf8');
if (/<\/script/i.test(renderSrc)) throw new Error('market-study-render.js cannot contain "</script": it is inlined into a script tag');

const block = [
  START,
  `<!-- generated by scripts/build-research-page.js from brand.regions and brand.market_study, built for "${slug}". Do not hand-edit between the markers; run the script. -->`,
  `<div id="brand-study" data-ms-built-for="${slug}">`,
  render.blockHTML(brand, { docx }),
  '</div>',
  '<script>',
  renderSrc,
  '</script>',
  '<script>',
  RUNTIME,
  '</script>',
  END,
].join('\n');

let html = fs.readFileSync(FILE, 'utf8');
const a = html.indexOf(START);
const b = html.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error(`research.html: the ${START} / ${END} markers are missing or out of order; nothing was written.`);
  process.exit(1);
}
html = html.slice(0, a) + block + html.slice(b + END.length);
fs.writeFileSync(FILE, html, 'utf8');

const withStudy = regions.filter((r) => render.studyFor(brand, r.code)).map((r) => r.code);
const competitors = render.landscapeRows(brand).length;
console.log(`research.html: rebuilt the brand-study block for ${brand.name}` +
  ` (regions: ${regions.map((r) => r.code + (r.home ? ' (home)' : '')).join(', ') || 'none'}; with study: ${withStudy.join(', ') || 'none'};` +
  ` ${competitors} competitor rows; documents: ${Object.keys(docx).join(', ') || 'none'})`);
