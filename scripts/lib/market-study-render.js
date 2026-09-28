/**
 * scripts/lib/market-study-render.js - the Market Study page, rendered from a
 * brand record. ONE implementation for two runtimes:
 *
 *   - Node, at build time: scripts/build-research-page.js renders the block for
 *     tenant zero and writes it into research.html between the BRAND-STUDY
 *     markers, and scripts/market-study-content.js re-exports these renderers
 *     for the .docx builder and the playbook hub.
 *   - The browser, at run time: the generator inlines THIS FILE into the page,
 *     so the client-side re-render for the signed-in user's ACTIVE brand runs
 *     the same functions. Two copies of the renderer is how the header card and
 *     the report body drifted apart: the body was generated from the record
 *     while the card above it stayed a hand-written paragraph about another
 *     company, and the runtime rename painted the active brand's name over it.
 *
 * EVERYTHING here reads the record or renders the marker. A region with no
 * study gets [DATA REQUIRED BEFORE LAUNCH: ...] by name; a position line is
 * rendered only when the record carries one WITH its source; a date only when
 * the record carries one; a document link only when the caller says one exists
 * for THIS brand. Nothing is written from memory and nothing is substituted
 * from another workspace.
 *
 * Keep this file free of Node-only APIs and of template literals with nested
 * quotes: it is embedded verbatim inside a <script> tag.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarketStudyRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var REGIONS = ['US', 'UK', 'Global', 'India'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function nameOf(brand) { return (brand && brand.name) || 'this brand'; }
  function marker(field, region, brand) {
    return '[DATA REQUIRED BEFORE LAUNCH: ' + field + ', ' + region + ', ' + nameOf(brand) + '.]';
  }
  function studyFor(brand, region) {
    var ms = brand && brand.market_study && typeof brand.market_study === 'object' ? brand.market_study : {};
    return ms[region] || null;
  }

  /* -- the honest empty state ------------------------------------------------
     Shown whenever the active brand has no study for this region. It names the
     brand so nobody mistakes another workspace's research for their own. */
  function emptyState(region, brand) {
    var name = esc(nameOf(brand));
    return '' +
      '<div class="card p-5">' +
        '<div class="font-head text-lg">No market study loaded for ' + name + ' (' + esc(region) + ')</div>' +
        '<p class="text-[13px] mt-2" style="color:var(--soft);">' +
          esc(marker('market study', region, brand)) + ' ' +
          'This platform never shows another brand\'s research in place of yours: market sizing, the ' +
          'competitive tiers and the strategic read are all specific to an industry, so a study belonging ' +
          'to a different workspace would be actively misleading here.' +
        '</p>' +
        '<p class="text-[13px] mt-2" style="color:var(--soft);">' +
          'To populate this tab, add a <code>market_study</code> block to the brand record ' +
          '(<code>data/brands/_default.json</code>, or the brand\'s profile under ' +
          '<code>data/brands/presets/</code>) with one entry per region. Every sizing row requires a ' +
          '<code>source</code>; rows without one are rejected rather than displayed.' +
        '</p>' +
      '</div>';
  }

  function sizingTable(rows) {
    var sourced = (rows || []).filter(function (r) { return r && r.source; });
    if (!sourced.length) return '';
    return '' +
      '<div class="card p-0 overflow-hidden">' +
        '<table class="grid-tbl w-full text-[13px]">' +
          '<thead><tr><th>Segment</th><th>Size</th><th>CAGR</th><th>Source</th></tr></thead><tbody>' +
          sourced.map(function (r) {
            return '<tr><td>' + esc(r.segment) + '</td><td>' + esc(r.size) + '</td>' +
                   '<td>' + esc(r.cagr || '-') + '</td><td>' + esc(r.source) + '</td></tr>';
          }).join('') +
          '</tbody></table>' +
      '</div>';
  }

  function tierCards(tiers) {
    if (!tiers || !tiers.length) return '';
    return '<div class="grid gap-3 md:grid-cols-2">' + tiers.map(function (t) {
      return '<div class="card p-5"><div class="font-head text-base">' + esc(t.name) + '</div>' +
             '<p class="text-[13px] mt-1" style="color:var(--soft);">' + esc(t.note) + '</p></div>';
    }).join('') + '</div>';
  }

  function bulletCard(title, items) {
    if (!items || !items.length) return '';
    return '<div class="card p-5"><div class="font-head text-base">' + esc(title) + '</div>' +
      '<ul class="mt-2 text-[13px] space-y-1" style="color:var(--soft);">' +
      items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
  }

  /** The report body for one region. */
  function reportInnerHTML(region, brand) {
    var s = studyFor(brand, region);
    if (!s) return emptyState(region, brand);
    return '<div class="space-y-3">' +
      '<div class="card p-5"><div class="font-head text-lg">' + esc(s.headline || (nameOf(brand) + ' ' + region + ' market study')) + '</div>' +
        '<p class="text-[12.5px] mt-1" style="color:var(--soft);">Every figure below carries its published source. Where a number is not published, the gap is listed rather than estimated.</p></div>' +
      sizingTable(s.sizing) +
      tierCards(s.tiers) +
      bulletCard('Strategic read', s.reads) +
      bulletCard('Known data gaps (not estimated)', s.gaps) +
    '</div>';
  }

  /* -- the header card ---------------------------------------------------------
     Title, who it is prepared for, and ONLY what the record states: a date if
     `prepared_on` is present, a position statement if `position` AND
     `position_source` are present, a document link if the caller found one for
     this brand (opts.docxUrl). The card that used to sit here was hand-written
     prose - a sibling brand's, with the name swapped - and read as fact. */
  function headerCardHTML(region, brand, opts) {
    var o = opts || {};
    var s = studyFor(brand, region);
    var name = esc(nameOf(brand));
    var subtitle = 'Prepared for ' + name + ' (' + esc(region) + ' market)';
    if (s && s.prepared_on) subtitle += ' &middot; ' + esc(s.prepared_on);
    subtitle += s ? ' &middot; every figure carries its published source.' : ' &middot; no study is on the record for this region.';
    var position;
    if (s && s.position && s.position_source) {
      position = '<p class="text-[14px] mt-3 leading-relaxed" style="color:#111111;"><b style="color:var(--brand-accent-text,#6A33D8);">' + name + ' position, ' + esc(region) + ':</b> ' +
        esc(s.position) + ' <span class="ms-note">Source: ' + esc(s.position_source) + '</span></p>';
    } else {
      position = '<p class="ms-note mt-3">' + esc(marker('market position statement with source', region, brand)) + '</p>';
    }
    var doc = o.docxUrl
      ? '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;"><a class="btn-lava text-[13px]" href="' + esc(o.docxUrl) + '" download>Download DOC</a></div>'
      : '';
    return '<div class="card p-5" style="border-color:var(--knickgasm-lava);">' +
      '<div class="font-head text-[20px] text-vink">' + esc(region) + ' Market Study &middot; ' + name + '</div>' +
      '<div class="text-[12.5px]" style="color:#556059;">' + subtitle + '</div>' +
      position + doc +
    '</div>';
  }

  /** One region's panel: the header card and the report body. */
  function panelHTML(region, brand, opts) {
    var o = opts || {};
    return '<div class="ms-panel" data-ms-region="' + esc(region.toLowerCase()) + '"' + (o.hidden ? ' style="display:none;"' : '') + '>' +
      headerCardHTML(region, brand, o) +
      '<div class="ms-report">' + reportInnerHTML(region, brand) + '</div>' +
    '</div>';
  }

  /* -- the competitive landscape ----------------------------------------------
     Rows come from market_study[region].tiers[].brands - the same structured
     entries the competitor universe seeds from on activation - never from a
     hand-kept grid. A tier whose note says it does not compete is still shown,
     labelled with its tier, because the study named it; what is never shown is
     a brand the record does not name. */
  function landscapeRows(brand) {
    var rows = [];
    REGIONS.forEach(function (region) {
      var s = studyFor(brand, region);
      if (!s || !Array.isArray(s.tiers)) return;
      s.tiers.forEach(function (t) {
        (Array.isArray(t.brands) ? t.brands : []).forEach(function (b) {
          if (!b || !b.name) return;
          rows.push({ region: region, tier: t.name || '', name: b.name, website: b.website || '', country: b.country || '', source: b.source || '' });
        });
      });
    });
    return rows;
  }

  function landscapeRowsHTML(brand) {
    return landscapeRows(brand).map(function (r) {
      var name = r.website
        ? '<a href="' + esc(r.website) + '" target="_blank" rel="noopener" style="color:#111111;text-decoration:underline;text-decoration-color:var(--knickgasm-lava)">' + esc(r.name) + '</a>'
        : esc(r.name);
      return '<tr data-regions="' + esc(r.region) + '"><td>' + name + '</td><td>' + esc(r.tier) + '</td><td>' + esc(r.country || '-') + '</td><td>' + esc(r.region) + '</td><td>' + esc(r.source || marker('verification source', r.region, brand)) + '</td></tr>';
    }).join('');
  }

  function landscapeRegions(brand) {
    var seen = {};
    landscapeRows(brand).forEach(function (r) { seen[r.region] = true; });
    return REGIONS.filter(function (r) { return seen[r]; });
  }

  function landscapeHTML(brand) {
    var name = esc(nameOf(brand));
    var regions = landscapeRegions(brand);
    var tabs = '<div id="regionTabs" class="lc-tabrow mb-4"><span class="text-[11px] uppercase tracking-widest font-bold" style="color:var(--brand-accent-text,#6A33D8);margin-right:4px">Benchmark table</span>' +
      regions.map(function (r, i) { return '<button type="button" class="rtab' + (i === 0 ? ' on' : '') + '" data-region="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') +
      (regions.length ? '<span class="text-[12px]" style="color:#556059;margin-left:6px">Filtering the competitor table to <b class="text-vink" id="rgLabel">' + esc(regions[0]) + '</b>.</span>' : '') +
      '</div>';
    var body = regions.length
      ? '<div class="card overflow-x-auto"><table class="grid" style="min-width:820px;">' +
          '<thead><tr><th>Brand</th><th>Tier</th><th>Country</th><th>Study region</th><th>Source</th></tr></thead>' +
          '<tbody>' + landscapeRowsHTML(brand) + '</tbody></table></div>' +
        '<p class="ms-note">Every row is a brand this record\'s own market study names, with the verification its source line records. Positioning, share and channel mix are not inferred: a study that does not state them lists them as gaps.</p>'
      : '<div class="card p-5"><div class="font-head text-lg">No competitor set on the record for ' + name + '</div>' +
          '<p class="text-[13px] mt-2" style="color:var(--soft);">' + esc(marker('competitor set', 'all regions', brand)) + ' ' +
          'Add <code>tiers[].brands</code> entries to a region\'s <code>market_study</code> block. Another workspace\'s competitors are deliberately not substituted.</p></div>';
    return '<div id="competitors" class="scroll-mt-6 mt-10">' +
      '<h2 class="text-vink text-[26px] font-bold">Competitive landscape</h2>' +
      '<hr class="divider mt-2 mb-5">' +
      tabs + body +
    '</div>';
  }

  /** The whole brand-derived block, in page order. */
  function blockHTML(brand, opts) {
    var o = opts || {};
    var docx = o.docx || {};
    return '<section id="regional-studies" class="mt-8 scroll-mt-6">' +
      '<div class="kicker mb-2">Regional Market Studies &middot; full reports</div>' +
      '<div id="msRegionTabs" class="lc-tabrow mb-4">' +
        '<span class="text-[11px] uppercase tracking-widest font-bold" style="color:var(--brand-accent-text,#6A33D8);margin-right:4px">Study</span>' +
        REGIONS.map(function (r, i) { return '<button type="button" class="rtab' + (i === 0 ? ' on' : '') + '" data-region="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') +
      '</div>' +
      REGIONS.map(function (r, i) { return panelHTML(r, brand, { hidden: i > 0, docxUrl: docx[r] || '' }); }).join('\n') +
    '</section>\n' +
    landscapeHTML(brand);
  }

  return {
    REGIONS: REGIONS,
    esc: esc,
    marker: marker,
    studyFor: studyFor,
    emptyState: emptyState,
    reportInnerHTML: reportInnerHTML,
    headerCardHTML: headerCardHTML,
    panelHTML: panelHTML,
    landscapeRows: landscapeRows,
    landscapeRowsHTML: landscapeRowsHTML,
    landscapeRegions: landscapeRegions,
    landscapeHTML: landscapeHTML,
    blockHTML: blockHTML,
  };
}));
