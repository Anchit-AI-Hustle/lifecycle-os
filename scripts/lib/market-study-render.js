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
 * THE REGION LIST IS THE BRAND'S OWN. Tabs, panels and the benchmark filter are
 * built from `brand.regions` (region-context.js reads the same field), the HOME
 * market selected; a brand with no regions gets the marker, never a shipped
 * list. A study is keyed by whatever the record wrote ("India", "IN", "Global")
 * and matched to the region code by family, the same equivalence table
 * region-context.js keeps, so "India" on the record answers for IN.
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

  /* The file-naming convention of the .docx builder
     (scripts/build-market-study-docs.js): <slug>_<R>_Market_Study.docx. It is a
     naming list, never the list of markets a page offers. */
  var REGIONS = ['US', 'UK', 'Global', 'India'];

  /* The codes pages and records spell the SAME market with. Mirrors
     region-context.js FAMILY; equivalence only, never a list of markets. */
  var FAMILY = {
    US: 'US', USA: 'US', UNITEDSTATES: 'US', AMERICA: 'US',
    UK: 'UK', GB: 'UK', GBR: 'UK', UNITEDKINGDOM: 'UK', BRITAIN: 'UK',
    IN: 'IN', IND: 'IN', INDIA: 'IN',
    GLOBAL: 'GLOBAL', WORLDWIDE: 'GLOBAL', ROW: 'GLOBAL', INTL: 'GLOBAL', INTERNATIONAL: 'GLOBAL', WW: 'GLOBAL',
    EU: 'EU', EUROPE: 'EU', AU: 'AU', AUS: 'AU', AUSTRALIA: 'AU', ME: 'ME', MIDDLEEAST: 'ME', AE: 'AE', UAE: 'AE'
  };
  /* Labelling only (region-context.js NAMES): a code absent here shows as itself. */
  var NAMES = { IN: 'India', GLOBAL: 'Global', WORLDWIDE: 'Global', EU: 'Europe', AU: 'Australia', ME: 'Middle East', GB: 'UK' };
  var NONE = '[DATA REQUIRED BEFORE LAUNCH: regions, all, all]';

  function family(v) {
    var k = String(v || '').toUpperCase().replace(/[^A-Z]/g, '');
    return FAMILY[k] || k;
  }
  function name(code) {
    var c = String(code || '').toUpperCase();
    return NAMES[c] || c;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function nameOf(brand) { return (brand && brand.name) || 'this brand'; }
  function marker(field, region, brand) {
    return '[DATA REQUIRED BEFORE LAUNCH: ' + field + ', ' + region + ', ' + nameOf(brand) + '.]';
  }

  /* The brand's OWN regions: { code, home }. Exactly one home: the flagged
     row, else the row the record leads with; none at all is an empty list. */
  function regionsOf(brand) {
    var list = (brand && Array.isArray(brand.regions)) ? brand.regions : [];
    var out = [];
    list.forEach(function (r) {
      if (!r || !r.code) return;
      out.push({ code: String(r.code).toUpperCase(), home: r.home === true });
    });
    if (out.length && !out.some(function (r) { return r.home; })) out[0].home = true;
    return out;
  }
  function homeOf(regions) {
    for (var i = 0; i < regions.length; i++) if (regions[i].home) return regions[i].code;
    return (regions[0] && regions[0].code) || '';
  }
  /** The brand's own code for a value spelt any way the family table knows, or ''. */
  function resolveIn(regions, v) {
    var f = family(v);
    if (!f) return '';
    for (var i = 0; i < regions.length; i++) if (family(regions[i].code) === f) return regions[i].code;
    return '';
  }
  /* A brand's market_study is keyed by whatever it wrote ("India", "IN",
     "Global"); the region code is matched to that key by family. */
  function studyFor(brand, code) {
    var ms = brand && brand.market_study && typeof brand.market_study === 'object' ? brand.market_study : {};
    var f = family(code);
    var keys = Object.keys(ms);
    for (var i = 0; i < keys.length; i++) if (family(keys[i]) === f) return ms[keys[i]] || null;
    return null;
  }

  /* -- the honest empty state ------------------------------------------------
     Shown whenever the active brand has no study for this region. It names the
     brand so nobody mistakes another workspace's research for their own. */
  function emptyState(code, brand) {
    var bn = esc(nameOf(brand));
    var region = esc(name(code));
    return '' +
      '<div class="card p-5">' +
        '<div class="font-head text-lg">No market study loaded for ' + bn + ' (' + region + ')</div>' +
        '<p class="text-[13px] mt-2" style="color:var(--soft);">' +
          esc(marker('market study', name(code), brand)) + ' ' +
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
  function reportInnerHTML(code, brand) {
    var s = studyFor(brand, code);
    if (!s) return emptyState(code, brand);
    return '<div class="space-y-3">' +
      '<div class="card p-5"><div class="font-head text-lg">' + esc(s.headline || (nameOf(brand) + ' ' + name(code) + ' market study')) + '</div>' +
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
  function headerCardHTML(code, brand, opts) {
    var o = opts || {};
    var s = studyFor(brand, code);
    var bn = esc(nameOf(brand));
    var region = esc(name(code));
    var subtitle = 'Prepared for ' + bn + ' (' + region + ' market)';
    if (s && s.prepared_on) subtitle += ' &middot; ' + esc(s.prepared_on);
    subtitle += s ? ' &middot; every figure carries its published source.' : ' &middot; no study is on the record for this region.';
    var position;
    if (s && s.position && s.position_source) {
      position = '<p class="text-[14px] mt-3 leading-relaxed" style="color:var(--vh-ink,#111111);"><b style="color:var(--brand-accent-text,#6A33D8);">' + bn + ' position, ' + region + ':</b> ' +
        esc(s.position) + ' <span class="ms-note">Source: ' + esc(s.position_source) + '</span></p>';
    } else {
      position = '<p class="ms-note mt-3">' + esc(marker('market position statement with source', name(code), brand)) + '</p>';
    }
    var doc = o.docxUrl
      ? '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;"><a class="btn-lava text-[13px]" href="' + esc(o.docxUrl) + '" download>Download DOC</a></div>'
      : '';
    return '<div class="card p-5" style="border-color:var(--vh-accent,var(--brand-accent));">' +
      '<div class="font-head text-[20px] text-vink">' + region + ' Market Study &middot; ' + bn + '</div>' +
      '<div class="text-[12.5px]" style="color:var(--soft);">' + subtitle + '</div>' +
      position + doc +
    '</div>';
  }

  /** One region's panel: the header card and the report body. */
  function panelHTML(code, brand, opts) {
    var o = opts || {};
    return '<div class="ms-panel" data-ms-region="' + esc(String(code).toLowerCase()) + '"' + (o.hidden ? ' style="display:none;"' : '') + '>' +
      headerCardHTML(code, brand, o) +
      '<div class="ms-report">' + reportInnerHTML(code, brand) + '</div>' +
    '</div>';
  }

  /* One tab row: the brand's regions (home flagged), or the marker. */
  function tabButton(r, on) {
    return '<button type="button" class="rtab' + (on ? ' on' : '') + '" data-region="' + esc(r.code) + '"' +
      (r.home ? ' data-home="1" title="Home market"' : '') + '>' + esc(name(r.code)) + '</button>';
  }
  function tabsHTML(regions, selected) {
    if (!regions.length) return '<span class="rtab" data-region-none="1" style="cursor:default">' + esc(NONE) + '</span>';
    return regions.map(function (r) { return tabButton(r, family(r.code) === family(selected)); }).join('');
  }

  /* -- the competitive landscape ----------------------------------------------
     Rows come from market_study[region].tiers[].brands - the same structured
     entries the competitor universe seeds from on activation - never from a
     hand-kept grid. A tier whose note says it does not compete is still shown,
     labelled with its tier, because the study named it; what is never shown is
     a brand the record does not name. */
  function landscapeRows(brand) {
    var rows = [];
    regionsOf(brand).forEach(function (r) {
      var s = studyFor(brand, r.code);
      if (!s || !Array.isArray(s.tiers)) return;
      s.tiers.forEach(function (t) {
        (Array.isArray(t.brands) ? t.brands : []).forEach(function (b) {
          if (!b || !b.name) return;
          rows.push({ region: r.code, tier: t.name || '', name: b.name, website: b.website || '', country: b.country || '', source: b.source || '' });
        });
      });
    });
    return rows;
  }

  function landscapeRowsHTML(brand, selected) {
    return landscapeRows(brand).map(function (r) {
      var nm = r.website
        ? '<a href="' + esc(r.website) + '" target="_blank" rel="noopener" style="color:var(--vh-ink,#111111);text-decoration:underline;text-decoration-color:var(--vh-accent,var(--brand-accent))">' + esc(r.name) + '</a>'
        : esc(r.name);
      var hidden = selected && family(r.region) !== family(selected);
      return '<tr data-regions="' + esc(r.region) + '"' + (hidden ? ' style="display:none;"' : '') + '><td>' + nm + '</td><td>' + esc(r.tier) + '</td><td>' + esc(r.country || '-') + '</td><td>' + esc(name(r.region)) + '</td><td>' + esc(r.source || marker('verification source', name(r.region), brand)) + '</td></tr>';
    }).join('');
  }

  function landscapeRegions(brand) {
    var seen = {};
    landscapeRows(brand).forEach(function (r) { seen[r.region] = true; });
    return regionsOf(brand).map(function (r) { return r.code; }).filter(function (c) { return seen[c]; });
  }

  function landscapeHTML(brand, selected) {
    var bn = esc(nameOf(brand));
    var regions = regionsOf(brand);
    var sel = resolveIn(regions, selected) || homeOf(regions);
    var tabs = '<div id="regionTabs" class="lc-tabrow mb-4"><span class="text-[11px] uppercase tracking-widest font-bold" style="color:var(--brand-accent-text,#6A33D8);margin-right:4px">Benchmark table</span>' +
      '<span id="regionTabsHost" style="display:contents">' + tabsHTML(regions, sel) + '</span>' +
      '<span class="text-[12px]" style="color:var(--soft);margin-left:6px">Filtering the competitor table to <b class="text-vink" id="rgLabel">' + esc(sel ? name(sel) : 'no market configured') + '</b>.</span>' +
      '</div>';
    var body = landscapeRows(brand).length
      ? '<div class="card overflow-x-auto"><table class="grid" style="min-width:820px;">' +
          '<thead><tr><th>Brand</th><th>Tier</th><th>Country</th><th>Study region</th><th>Source</th></tr></thead>' +
          '<tbody>' + landscapeRowsHTML(brand, sel) + '</tbody></table></div>' +
        '<p class="ms-note">Every row is a brand this record\'s own market study names, with the verification its source line records. Positioning, share and channel mix are not inferred: a study that does not state them lists them as gaps.</p>'
      : '<div class="card p-5"><div class="font-head text-lg">No competitor set on the record for ' + bn + '</div>' +
          '<p class="text-[13px] mt-2" style="color:var(--soft);">' + esc(marker('competitor set', 'all regions', brand)) + ' ' +
          'Add <code>tiers[].brands</code> entries to a region\'s <code>market_study</code> block. Another workspace\'s competitors are deliberately not substituted.</p></div>';
    return '<div id="competitors" class="scroll-mt-6 mt-10">' +
      '<h2 class="text-vink text-[26px] font-bold">Competitive landscape</h2>' +
      '<hr class="divider mt-2 mb-5">' +
      tabs + body +
    '</div>';
  }

  /** The whole brand-derived block, in page order: one panel per region the
   *  brand serves, the selected one (opts.region, else HOME) shown. */
  function blockHTML(brand, opts) {
    var o = opts || {};
    var docx = o.docx || {};
    var regions = regionsOf(brand);
    var sel = resolveIn(regions, o.region) || homeOf(regions);
    return '<section id="regional-studies" class="mt-8 scroll-mt-6">' +
      '<div class="kicker mb-2">Regional Market Studies &middot; full reports</div>' +
      '<div id="msRegionTabs" class="lc-tabrow mb-4">' +
        '<span class="text-[11px] uppercase tracking-widest font-bold" style="color:var(--brand-accent-text,#6A33D8);margin-right:4px">Study</span>' +
        '<span id="msRegionTabsHost" style="display:contents">' + tabsHTML(regions, sel) + '</span>' +
      '</div>' +
      regions.map(function (r) { return panelHTML(r.code, brand, { hidden: family(r.code) !== family(sel), docxUrl: docx[r.code] || docx[family(r.code)] || '' }); }).join('\n') +
    '</section>\n' +
    landscapeHTML(brand, sel);
  }

  return {
    REGIONS: REGIONS,
    NONE: NONE,
    esc: esc,
    family: family,
    name: name,
    marker: marker,
    regionsOf: regionsOf,
    homeOf: homeOf,
    resolveIn: resolveIn,
    studyFor: studyFor,
    emptyState: emptyState,
    reportInnerHTML: reportInnerHTML,
    headerCardHTML: headerCardHTML,
    panelHTML: panelHTML,
    tabsHTML: tabsHTML,
    landscapeRows: landscapeRows,
    landscapeRowsHTML: landscapeRowsHTML,
    landscapeRegions: landscapeRegions,
    landscapeHTML: landscapeHTML,
    blockHTML: blockHTML
  };
}));
