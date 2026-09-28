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
 * That is the four regional study panels (header card AND report body), the
 * competitive landscape, the renderer itself (scripts/lib/market-study-render.js,
 * inlined so the browser runs the SAME code) and the runtime that re-renders
 * the block for the signed-in user's ACTIVE brand. Never hand-edit inside the
 * markers: run this script. It fails loudly if the markers are missing rather
 * than quietly patching nothing.
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

const docx = {};
render.REGIONS.forEach((r) => {
  const file = `${slug}_${r}_Market_Study.docx`;
  if (render.studyFor(brand, r) && fs.existsSync(path.join(ROOT, 'docs', 'market-study', file))) docx[r] = `/docs/market-study/${file}`;
});

const RUNTIME = `
/* The Market Study follows the ACTIVE brand. The block above was rendered at
   build time for the brand named in data-ms-built-for; when the signed-in
   user's active brand is a different one, the whole block - header cards,
   report bodies and competitive landscape - is re-rendered from ITS record by
   the same renderer, with no document links (those files belong to the brand
   the page was built for). A brand with no study for a region gets the explicit
   DATA REQUIRED state, never a substitute. */
(function () {
  var host = document.getElementById('brand-study');
  var R = window.MarketStudyRender;
  if (!host || !R) return;
  var builtFor = String(host.getAttribute('data-ms-built-for') || '').toLowerCase();

  function wireStudyTabs() {
    var tabs = [].slice.call(host.querySelectorAll('#msRegionTabs .rtab'));
    var panels = [].slice.call(host.querySelectorAll('.ms-panel[data-ms-region]'));
    if (!tabs.length || !panels.length) return;
    function show(rg) {
      rg = String(rg || 'us').toLowerCase();
      if (!panels.some(function (p) { return p.getAttribute('data-ms-region') === rg; })) rg = 'us';
      panels.forEach(function (p) { p.style.display = (p.getAttribute('data-ms-region') === rg) ? '' : 'none'; });
      tabs.forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-region').toLowerCase() === rg); });
    }
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var rg = t.getAttribute('data-region').toLowerCase();
        show(rg);
        try { history.replaceState(null, '', '?region=' + rg + '#regional-studies'); } catch (_) {}
      });
    });
    var q = null; try { q = new URLSearchParams(location.search).get('region'); } catch (_) {}
    show(q || 'us');
    if (q) { var sec = document.getElementById('regional-studies'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  function wireLandscapeTabs() {
    var tabs = [].slice.call(host.querySelectorAll('#regionTabs .rtab'));
    if (!tabs.length) return;
    function apply(rg) {
      host.querySelectorAll('#competitors tr[data-regions]').forEach(function (tr) {
        var d = tr.getAttribute('data-regions');
        tr.style.display = (d === 'ALL' || d.split(',').indexOf(rg) > -1) ? '' : 'none';
      });
      tabs.forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-region') === rg); });
      var l = document.getElementById('rgLabel'); if (l) l.textContent = rg;
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { apply(t.getAttribute('data-region')); }); });
    apply(tabs[0].getAttribute('data-region'));
  }
  function wire() { wireStudyTabs(); wireLandscapeTabs(); }

  function render(b) {
    if (!b) return;
    var s = String(b.slug || '').toLowerCase();
    // The built block IS this brand's, document links included.
    if (s && s === builtFor) { host.setAttribute('data-ms-rendered-for', s); return; }
    host.innerHTML = R.blockHTML(b, {});
    host.setAttribute('data-ms-rendered-for', s || String(b.name || ''));
    wire();
  }
  /* The shell payload may omit market_study: fetch the full record. */
  function full(b) {
    if (!b || b.market_study !== undefined) return Promise.resolve(b);
    return fetch('/api/public-config?action=brand&op=get&id=' + encodeURIComponent(b.id || ''), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (f) { return (f && f.brand) || b; })
      .catch(function () { return b; });
  }
  function boot() {
    wire();
    var p = (window.BrandContext && window.BrandContext.ready)
      ? window.BrandContext.ready()
      : fetch('/api/public-config?action=brand&op=active', { credentials: 'same-origin' })
          .then(function (r) { return r.json(); }).then(function (d) { return d && d.brand; });
    Promise.resolve(p).then(function (b) { if (b) return full(b).then(render); }).catch(function () {});
    try {
      window.addEventListener('brandcontext:change', function (ev) {
        var b = ev && ev.detail && ev.detail.brand;
        if (b) full(b).then(render).catch(function () {});
      });
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
`;

const renderSrc = fs.readFileSync(RENDER_FILE, 'utf8');
if (/<\/script/i.test(renderSrc)) throw new Error('market-study-render.js cannot contain "</script": it is inlined into a script tag');

const block = [
  START,
  `<!-- generated by scripts/build-research-page.js from brand.market_study, built for "${slug}". Do not hand-edit between the markers; run the script. -->`,
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

const withStudy = render.REGIONS.filter((r) => render.studyFor(brand, r));
const competitors = render.landscapeRows(brand).length;
console.log(`research.html: rebuilt the brand-study block for ${brand.name}` +
  ` (with study: ${withStudy.join(', ') || 'none'}; ${competitors} competitor rows; documents: ${Object.keys(docx).join(', ') || 'none'})`);
