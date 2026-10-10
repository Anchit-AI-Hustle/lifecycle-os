/* eslint-env browser */
/**
 * brand-knowledge.js - the active brand's knowledge documents, built from ITS
 * OWN record, for the viewer at /kb/brand/<doc> (brand-doc.html).
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS REPLACES (2026-10-05, production, a phone sign-in with the
 * brand "Deli Chic" active). The Brand Knowledge Base box on /knowledge-base
 * linked six static files under knowledge/brand/, written for tenant zero, and
 * auth.js intercepted every `a[href$=".md"]` and opened it in an about:blank
 * window: "KNICKGASM - Brand Foundation", a sneaker studio in Mumbai, its
 * endorsers, its fonts and hexes. Three things were wrong at once:
 *   1. another brand was shown tenant zero's documents;
 *   2. the document had no URL, so it could be neither bookmarked nor shared;
 *   3. the shell's rename ("KNICKGASM" -> the active name) put the active
 *      brand's name on the box above them, which made the leak read as theirs.
 *
 * THE RULE NOW. A document is the ACTIVE brand's, built from its record (and
 * its catalogue, its context pack, and the platform's own rules read from the
 * modules that apply them), or it says what is missing with the spec's marker
 * [DATA REQUIRED BEFORE LAUNCH: <field>, <brand>]. Nothing falls back to
 * another brand's text. Tenant zero keeps its own shipped markdown as its
 * content: those files ARE its knowledge base, and only it is served them.
 *
 * Pure where it can be: `build()`, `parseMarkdown()`, `docFromPath()` and the
 * marker run in Node too, so a test can drive them directly as well as through
 * the page. `render()` is the only part that needs a document. Every string is
 * written with textContent; no record value is ever parsed as markup.
 *
 * window.BrandKnowledge = { DOCS, docFromPath, hrefFor, marker, parseMarkdown,
 *   build, render, normalize, ZERO_FILES }
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BrandKnowledge = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ── the documents ────────────────────────────────────────────────────── */

  // `file` is tenant zero's own markdown for that document, shipped in the repo.
  // It is fetched only when the ACTIVE brand is tenant zero.
  var DOCS = [
    { id: 'foundation', title: 'Brand Foundation', blurb: 'Identity, story, voice, claims, palette and typography', file: '/knowledge/brand/01-brand-foundation.md' },
    { id: 'catalog', title: 'Product Catalog', blurb: 'This brand\'s own catalogue, offerings and where they come from', file: '/knowledge/brand/02-product-catalog.md' },
    { id: 'cohorts', title: 'Lifecycle Cohorts', blurb: 'The segments the planner applies and the objective each one gets', file: '/knowledge/brand/03-lifecycle-cohorts.md' },
    { id: 'offers', title: 'Offers & Mechanics', blurb: 'Discount codes, the cap, and offer depth by cohort', file: '/knowledge/brand/04-offers-and-mechanics.md' },
    { id: 'creative', title: 'Landing Pages & Creative', blurb: 'The contract each asset type is built to, in this brand\'s tokens', file: '/knowledge/brand/05-landing-pages-and-creative.md' },
    { id: 'market', title: 'Market Intelligence', blurb: 'Regions, home market, market study and competitor set', file: '/knowledge/brand/06-market-intelligence-summary.md' },
  ];
  var BASE = '/kb/brand';
  // Tenant zero's files by name, so a relative link between them inside its own
  // markdown lands on the document's route rather than on a raw .md file.
  var ZERO_FILES = {};
  DOCS.forEach(function (d) { ZERO_FILES[d.file.split('/').pop()] = d.id; });
  ZERO_FILES['00-index.md'] = '';

  function docById(id) {
    for (var i = 0; i < DOCS.length; i++) if (DOCS[i].id === id) return DOCS[i];
    return null;
  }
  function hrefFor(id) { return id ? BASE + '/' + id : BASE; }

  /**
   * What a URL asks for. The route is /kb/brand/<doc> (a vercel.json rewrite
   * onto brand-doc.html, which keeps the address in the bar) and the file also
   * answers ?doc=<id>; /kb/brand alone is the index. A generated or platform
   * markdown document opens with ?local=<key> or ?md=<path under /docs/>.
   *   -> { mode: 'index'|'doc'|'local'|'md'|'unknown', id, value }
   */
  function docFromPath(pathname, search) {
    var p = String(pathname || '').replace(/\/+$/, '');
    var q;
    try { q = new URLSearchParams(String(search || '')); } catch (_) { q = { get: function () { return null; } }; }
    var local = q.get('local');
    if (local) return /^[a-z0-9-]{6,64}$/i.test(local) ? { mode: 'local', value: local } : { mode: 'unknown', value: local };
    var md = q.get('md');
    if (md) return isPlatformDoc(md) ? { mode: 'md', value: md } : { mode: 'unknown', value: md };
    var m = p.match(/^\/kb\/brand\/([^/]+)$/);
    var id = (m && decodeURIComponent(m[1])) || q.get('doc') || '';
    if (!id) return { mode: 'index' };
    return docById(id) ? { mode: 'doc', id: id } : { mode: 'unknown', value: id };
  }
  /** A repo markdown file the viewer may render as itself: the platform's own
   *  docs only. knowledge/brand/ is NOT in it - those are one brand's, and are
   *  reached through that brand's route, never by path. */
  function isPlatformDoc(p) {
    var s = String(p || '');
    return /^\/docs\/[A-Za-z0-9._/-]+\.md$/.test(s) && s.indexOf('..') < 0 && s.indexOf('//') < 0;
  }
  /* Platform documents that were written ABOUT one workspace: they quote its
     products, copy and routes as findings, so they are shown to that
     workspace only (the server's answer, BrandContext.isTenantZero), and
     every other brand is told so. A dated audit is a record and is not
     rewritten to read as anyone else's. */
  var OPERATOR_ONLY = {
    '/docs/feature-audit-2026-07-12.md': 'This audit was written about the workspace this platform was first built for, and quotes its products and copy as findings.',
  };
  function operatorOnly(p) { return Object.prototype.hasOwnProperty.call(OPERATOR_ONLY, String(p || '')) ? OPERATOR_ONLY[p] : ''; }

  /* ── runs: the inline unit every block is made of ─────────────────────── */

  function str(v, max) { var s = String(v == null ? '' : v).trim(); return max ? s.slice(0, max) : s; }
  function t(s) { return { text: String(s == null ? '' : s) }; }
  function link(text, href) { return { text: String(text == null ? '' : text), href: href }; }
  /** The spec's marker, named for the brand and nothing else. */
  function marker(field, brandName, region) {
    var parts = [field, brandName || 'this brand'];
    if (region) parts.push(region);
    return '[DATA REQUIRED BEFORE LAUNCH: ' + parts.join(', ') + ']';
  }
  function mark(field, brandName, region) { return { text: marker(field, brandName, region), marker: true }; }
  function runs(v) {
    if (v == null) return [];
    if (Array.isArray(v)) return v.map(function (x) { return typeof x === 'string' ? t(x) : x; });
    if (typeof v === 'string') return [t(v)];
    return [v];
  }
  function safeHref(h) {
    var s = String(h || '').trim();
    if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
    if (/^\/[^/\s"'<>][^\s"'<>]*$/.test(s) || s === '/') return s;
    return '';
  }

  /* ── tenant zero's markdown, parsed to the same blocks ────────────────── */

  function inline(s) {
    var out = [];
    var rx = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(^|[^*\w])\*([^*\s][^*]*)\*/g;
    var last = 0, m;
    while ((m = rx.exec(s))) {
      var start = m.index + (m[5] != null ? m[5].length : 0);
      if (start > last) out.push(t(s.slice(last, start)));
      if (m[1] != null) out.push({ text: m[1], code: true });
      else if (m[2] != null) out.push(mdLink(m[2], m[3]));
      else if (m[4] != null) out.push({ text: m[4], strong: true });
      else out.push({ text: m[6], em: true });
      last = rx.lastIndex;
    }
    if (last < s.length) out.push(t(s.slice(last)));
    return out;
  }
  /** A link inside a markdown document: another of the brand's documents lands
   *  on its route; an absolute URL or path is kept; anything else is text. */
  function mdLink(text, href) {
    var file = String(href || '').replace(/^\.\//, '');
    if (Object.prototype.hasOwnProperty.call(ZERO_FILES, file)) return link(text, hrefFor(ZERO_FILES[file]));
    var safe = safeHref(href);
    return safe ? link(text, safe) : t(text);
  }

  function parseMarkdown(md) {
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [], i = 0;
    var cells = function (r) { return r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); }); };
    while (i < lines.length) {
      var ln = lines[i];
      if (/^\s*```/.test(ln)) {
        var code = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        out.push({ t: 'pre', text: code.join('\n') });
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        var head = cells(ln); i += 2; var body = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { body.push(cells(lines[i]).map(inline)); i++; }
        out.push({ t: 'table', head: head.map(inline), rows: body });
        continue;
      }
      var h = ln.match(/^(#{1,6})\s+(.*)$/);
      if (h) { out.push({ t: 'h' + Math.min(4, Math.max(1, h[1].length)), runs: inline(h[2].trim()) }); i++; continue; }
      if (/^\s*(---|___|\*\*\*)\s*$/.test(ln)) { out.push({ t: 'hr' }); i++; continue; }
      if (/^\s*>\s?/.test(ln)) {
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push({ t: 'quote', runs: inline(q.join(' ').trim()) });
        continue;
      }
      if (/^\s*[-*]\s+/.test(ln)) {
        var ul = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { ul.push(inline(lines[i].replace(/^\s*[-*]\s+/, ''))); i++; }
        out.push({ t: 'list', items: ul });
        continue;
      }
      if (/^\s*\d+\.\s+/.test(ln)) {
        var ol = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { ol.push(inline(lines[i].replace(/^\s*\d+\.\s+/, ''))); i++; }
        out.push({ t: 'olist', items: ol });
        continue;
      }
      if (/^\s*$/.test(ln)) { i++; continue; }
      var para = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i]) && !/^\s*```/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) { para.push(lines[i].trim()); i++; }
      out.push({ t: 'p', runs: inline(para.join(' ')) });
    }
    return out;
  }

  /* ── the record, read the way the server reads it ─────────────────────── */

  // Mirrors brand-runtime.normalizeBrand(): a persisted or device brand keeps
  // these inside brand_data; a preset or tenant zero carries them at the top.
  // A real column always wins.
  var HOISTED = ['offerings', 'claims', 'market_study', 'legal_entity', 'contact', 'social', 'asset_hosts', 'offers', 'competitors', 'description', 'story'];
  function normalize(brand) {
    var b = Object.assign({}, brand || {});
    var data = b.brand_data && typeof b.brand_data === 'object' ? b.brand_data : {};
    HOISTED.forEach(function (k) {
      var have = b[k];
      var present = Array.isArray(have) ? have.length > 0 : (have !== undefined && have !== null && have !== '');
      if (!present && data[k] !== undefined && data[k] !== null) b[k] = data[k];
    });
    return b;
  }

  var FAMILY = { US: 'US', USA: 'US', UK: 'UK', GB: 'UK', GBR: 'UK', IN: 'IN', IND: 'IN', INDIA: 'IN', GLOBAL: 'GLOBAL', WORLDWIDE: 'GLOBAL', INTL: 'GLOBAL', EU: 'EU', EUROPE: 'EU', AU: 'AU', AUSTRALIA: 'AU' };
  function family(v) { var k = String(v || '').toUpperCase().replace(/[^A-Z]/g, ''); return FAMILY[k] || k; }
  function regionsOf(b) {
    var list = Array.isArray(b.regions) ? b.regions.filter(function (r) { return r && r.code; }) : [];
    return list.map(function (r) { return Object.assign({}, r, { code: String(r.code).toUpperCase() }); });
  }
  function homeOf(regions) {
    for (var i = 0; i < regions.length; i++) if (regions[i].home === true) return regions[i];
    return null;
  }
  function studyFor(b, code) {
    var ms = b.market_study && typeof b.market_study === 'object' ? b.market_study : {};
    var keys = Object.keys(ms);
    for (var i = 0; i < keys.length; i++) if (family(keys[i]) === family(code)) return ms[keys[i]] || null;
    return null;
  }
  function pct(n) { var x = Number(n); return Number.isFinite(x) ? Math.round(x * 1000) / 10 + '%' : ''; }
  function listOf(v) {
    if (Array.isArray(v)) return v.map(function (x) { return typeof x === 'string' ? x : (x && (x.text || x.claim || x.name)) || ''; }).map(function (x) { return str(x, 300); }).filter(Boolean);
    return [];
  }
  function originOf(b, field) {
    var o = b.brand_data && b.brand_data.field_origins;
    var r = o && o[field];
    if (!r) return '';
    if (typeof r === 'string') return r;
    return [r.origin, r.source_url || r.source || ''].filter(Boolean).join(', ');
  }

  /* ── the six documents, for a brand that is not tenant zero ───────────── */

  /**
   * build(id, ctx) -> { title, lede, blocks }
   * ctx = { brand (full record), storage ('device'|'account'), catalog: {rows,
   *   error, loaded}, pack: context-pack response|null, packError, rules:
   *   platform-rules response|null, rulesError, nouns: {offering, audience,
   *   offeringPlural, audiencePlural}, tokens: {--brand-*} }
   */
  function build(id, ctx) {
    var c = ctx || {};
    var b = normalize(c.brand);
    var name = str(b.name, 120) || 'this brand';
    var doc = docById(id);
    if (!doc) return { title: 'Unknown document', lede: '', blocks: [{ t: 'p', runs: [t('There is no brand document called "' + str(id, 60) + '".')] }] };
    var fn = BUILDERS[id];
    var blocks = fn(b, name, c);
    return { title: name + ' · ' + doc.title, lede: doc.blurb + '.', blocks: blocks };
  }

  /* Readable names for the codes brands use. LABELLING ONLY (the same rule as
     region-context.js): a code absent here shows as itself, and this is never
     read as a list of markets - those are the brand's own `regions`. */
  var REGION_NAMES = {
    US: 'United States', UK: 'United Kingdom', GB: 'United Kingdom', IN: 'India', EU: 'Europe',
    AU: 'Australia', AE: 'UAE', ME: 'Middle East', CA: 'Canada', NZ: 'New Zealand', SG: 'Singapore',
    DE: 'Germany', FR: 'France', JP: 'Japan', GLOBAL: 'Global', WORLDWIDE: 'Global',
  };
  function regionName(c, code) {
    var k = String(code || '').toUpperCase();
    return REGION_NAMES[k] || k;
  }
  function regionLabel(c, code) {
    var k = String(code || '').toUpperCase();
    var n = regionName(c, k);
    return n === k ? k : n + ' (' + k + ')';
  }
  function storedWhere(c) {
    return c.storage === 'device'
      ? 'Built from the brand record saved on this device, and nothing else.'
      : 'Built from the brand record saved to this account, and nothing else.';
  }

  var BUILDERS = {
    foundation: function (b, name, c) {
      var out = [];
      var legal = str(b.legal_entity || b.legal_name, 200);
      out.push({ t: 'p', runs: [t(storedWhere(c) + ' Every value below is the record\'s own; a field the record does not hold says so with the launch marker.')] });
      out.push({ t: 'h2', runs: [t('Identity')] });
      out.push({ t: 'kv', rows: [
        ['Name', [t(name)]],
        ['Tagline', b.tagline ? [t(str(b.tagline, 300))] : [mark('tagline', name)]],
        ['Industry', b.industry ? [t(str(b.industry, 120))] : [mark('industry', name)]],
        ['Website', safeHref(b.website) ? [link(b.website, safeHref(b.website))] : [mark('website', name)]],
        ['Legal entity', legal ? [t(legal)] : [mark('legal entity', name)]],
        ['Logo', safeHref(b.logo_url) ? [link(b.logo_url, safeHref(b.logo_url))] : [mark('logo URL', name)]],
      ] });

      out.push({ t: 'h2', runs: [t('Story, in the brand\'s own words')] });
      var story = str(b.story || b.description, 2000);
      var pages = (c.pack && c.pack.knowledge && Array.isArray(c.pack.knowledge.pages)) ? c.pack.knowledge.pages : [];
      var said = pages.filter(function (p) { return p && p.declared_description; }).slice(0, 8);
      if (story) out.push({ t: 'p', runs: [t(story)] });
      if (said.length) {
        out.push({ t: 'p', runs: [t('What ' + name + '\'s own site says about itself, verbatim from each page\'s declared description (the brand context pack, ' + (c.pack.knowledge.ingested || said.length) + ' page(s) read):')] });
        out.push({ t: 'table', head: [[t('Page')], [t('Declared description')]], rows: said.map(function (p) {
          var href = safeHref(p.url);
          return [[href ? link(str(p.title, 140) || href, href) : t(str(p.title, 140))], [t(str(p.declared_description, 400))]];
        }) });
      }
      if (!story && !said.length) out.push({ t: 'p', runs: [mark('brand story', name)] });

      var v = b.voice || {};
      out.push({ t: 'h2', runs: [t('Voice')] });
      out.push({ t: 'kv', rows: [
        ['Tone', v.tone ? [t(str(v.tone, 400))] : [mark('voice tone', name)]],
        ['Notes', v.notes ? [t(str(v.notes, 800))] : [t('None recorded.')]],
        ['Preferred words', listOf(v.preferred).length ? [t(listOf(v.preferred).join(', '))] : [mark('preferred vocabulary', name)]],
        ['Banned words', listOf(v.banned).length ? [t(listOf(v.banned).join(', '))] : [mark('banned phrases', name)]],
        ['Dashes', [t(v.no_em_dashes === false ? 'The record allows em and en dashes.' : 'No em or en dashes in output copy: commas, colons or plain hyphens.')]],
      ] });

      out.push({ t: 'h2', runs: [t('Verifiable claims')] });
      var claims = listOf(b.claims);
      if (claims.length) {
        out.push({ t: 'p', runs: [t('The only claims a generated asset may state as fact for ' + name + '. Anything else needs a source first.')] });
        out.push({ t: 'list', items: claims.map(function (x) { return [t(x)]; }) });
      } else out.push({ t: 'p', runs: [mark('verifiable claims', name)] });

      out.push({ t: 'h2', runs: [t('Palette')] });
      var p = b.palette || {};
      var roles = [['primary', 'Primary'], ['accent', 'Accent'], ['ink', 'Ink (text)'], ['surface', 'Surface'], ['surface_alt', 'Surface, alternate'], ['muted', 'Muted']];
      var sw = [];
      roles.forEach(function (r) {
        var hex = str(p[r[0]]);
        if (/^#[0-9a-f]{6}$/i.test(hex) || /^#[0-9a-f]{3}$/i.test(hex)) sw.push({ role: r[1], hex: hex, origin: originOf(b, 'palette.' + r[0]) });
      });
      if (sw.length) out.push({ t: 'swatches', items: sw });
      var missingRoles = roles.slice(0, 4).filter(function (r) { return !/^#[0-9a-f]{3,6}$/i.test(str(p[r[0]])); });
      missingRoles.forEach(function (r) { out.push({ t: 'p', runs: [mark(r[1].toLowerCase() + ' colour', name)] }); });
      var tk = c.tokens || {};
      if (tk['--brand-primary-text'] || tk['--brand-accent-text']) {
        out.push({ t: 'kv', rows: [
          ['Primary as text', [t(str(tk['--brand-primary-text']) + ' (DERIVED from the primary, adjusted to read at AA on this brand\'s surface)')]],
          ['Accent as text', [t(str(tk['--brand-accent-text']) + ' (DERIVED from the accent, the same way)')]],
        ] });
      }

      out.push({ t: 'h2', runs: [t('Typography')] });
      var ty = b.typography || {};
      var face = function (slot, label) {
        var f = ty[slot] || {};
        var fam = str(f.family, 80);
        if (!fam) return [label, [mark(label.toLowerCase() + ' typeface', name)]];
        var bits = [fam];
        if (f.stack) bits.push('stack ' + str(f.stack, 200));
        if (f.weights) bits.push('weights ' + str(f.weights, 40));
        var o = originOf(b, 'typography.' + slot);
        if (o) bits.push('from ' + o);
        return [label, [t(bits.join(' · '))]];
      };
      out.push({ t: 'kv', rows: [face('heading', 'Headings'), face('body', 'Body')] });

      out.push({ t: 'h2', runs: [t('Design system (DESIGN.md)')] });
      var dmd = c.pack && c.pack.design_md;
      if (dmd) {
        out.push({ t: 'p', runs: [t('The DESIGN.md ' + name + '\'s context pack built from its own site' + (c.pack.pack && c.pack.pack.site_url ? ' (' + c.pack.pack.site_url + ')' : '') + ', in the open design.md format. Sections the site did not publish are declared omitted, with the reason.')] });
        if (c.pack.current === false && c.pack.stale_note) out.push({ t: 'note', runs: [t(c.pack.stale_note)] });
        out.push({ t: 'pre', text: String(dmd).slice(0, 20000) });
      } else {
        out.push({ t: 'p', runs: [mark('DESIGN.md (brand context pack)', name)] });
        out.push({ t: 'p', runs: [t(c.packError ? 'The context pack could not be read: ' + c.packError : 'No context pack has been built for this brand yet. Build one on the brand screen; it reads ' + name + '\'s own site and nothing else.'), t(' '), link('Open the brand screen', '/onboarding?step=6')] });
      }
      return out;
    },

    catalog: function (b, name, c) {
      var out = [];
      var nouns = c.nouns || {};
      out.push({ t: 'p', runs: [t('A generated asset for ' + name + ' uses ' + name + '\'s own catalogue, or no product at all. No other catalogue is used in its place.')] });
      out.push({ t: 'h2', runs: [t('Where the catalogue comes from')] });
      var src = b.catalog_source && typeof b.catalog_source === 'object' ? b.catalog_source : {};
      var srcRows = [];
      if (src.kind) srcRows.push(['Kind', [t(str(src.kind, 40))]]);
      if (safeHref(src.url)) srcRows.push(['Source', [link(src.url, safeHref(src.url))]]);
      else if (src.url) srcRows.push(['Source', [t(str(src.url, 200))]]);
      if (src.note) srcRows.push(['Note', [t(str(src.note, 400))]]);
      if (Array.isArray(src.offering_kinds) && src.offering_kinds.length) srcRows.push(['Offering kinds', [t(src.offering_kinds.map(function (x) { return str(x, 30); }).join(', '))]]);
      out.push(srcRows.length ? { t: 'kv', rows: srcRows } : { t: 'p', runs: [mark('catalogue source', name)] });

      var offerings = Array.isArray(b.offerings) ? b.offerings.filter(function (o) { return o && o.name; }) : [];
      out.push({ t: 'h2', runs: [t('Offerings on the record')] });
      if (offerings.length) {
        out.push({ t: 'table', head: [[t('Kind')], [t('Name')], [t('Address')], [t('Source')]], rows: offerings.slice(0, 80).map(function (o) {
          var href = safeHref(o.url);
          return [[t(str(o.kind, 30) || 'offering')], [t(str(o.name, 160))], [href ? link(href, href) : t('-')], [t(str(o.source, 160) || '-')]];
        }) });
      } else out.push({ t: 'p', runs: [mark((nouns.offeringPlural || 'offerings') + ' list', name)] });

      out.push({ t: 'h2', runs: [t('Catalogue rows')] });
      var cat = c.catalog || {};
      var rows = Array.isArray(cat.rows) ? cat.rows : [];
      if (cat.error) out.push({ t: 'note', runs: [t('The catalogue could not be read: ' + cat.error)] });
      if (rows.length) {
        var byRegion = {};
        rows.forEach(function (r) { var k = str(r.region).toUpperCase() || 'unassigned'; byRegion[k] = (byRegion[k] || 0) + 1; });
        out.push({ t: 'p', runs: [t(rows.length + ' row(s) read (' + Object.keys(byRegion).map(function (k) { return k + ' ' + byRegion[k]; }).join(', ') + ').' + (rows.length >= (cat.limit || 500) ? ' Only the first ' + rows.length + ' are listed here.' : ''))] });
        out.push({ t: 'table', head: [[t('Title')], [t('Type')], [t('Price')], [t('Region')], [t('Page')]], rows: rows.slice(0, 200).map(function (r) {
          var href = safeHref(r.product_url);
          var price = r.price != null && r.price !== '' ? str(r.price, 20) + (r.currency ? ' ' + str(r.currency, 8) : '') : '';
          return [[t(str(r.title, 160) || '-')], [t(str(r.product_type, 60) || '-')], price ? [t(price)] : [mark('price', name, str(r.region).toUpperCase())], [t(str(r.region).toUpperCase() || '-')], [href ? link('Open', href) : t('-')]];
        }) });
      } else if (!cat.error) {
        out.push({ t: 'p', runs: [mark('product catalogue', name)] });
        out.push({ t: 'p', runs: [t('Import the catalogue on the brand screen (store URL, CSV or the context pack). Until then every asset that would show a product renders this marker instead.'), t(' '), link('Open the brand screen', '/onboarding?step=5')] });
      }
      return out;
    },

    cohorts: function (b, name, c) {
      var out = [];
      var nouns = c.nouns || {};
      var aud = nouns.audience || 'customer';
      var r = c.rules && c.rules.cohorts;
      out.push({ t: 'p', runs: [t('The segments the planner sorts ' + name + '\'s ' + (nouns.audiencePlural || 'customers') + ' into, and the objective it briefs for each. The rules are the platform\'s and the same for every brand; the people in each segment, and how many, come from ' + name + '\'s own data.')] });
      out.push({ t: 'h2', runs: [t('Segment sizes')] });
      out.push({ t: 'p', runs: [mark('customer data (segment sizes)', name)] });
      out.push({ t: 'p', runs: [t('No size is estimated. A segment is sized only from ' + name + '\'s own connected customer data, per market.')] });
      if (!r) {
        out.push({ t: 'note', runs: [t('The cohort rules could not be read from the platform' + (c.rulesError ? ': ' + c.rulesError : '.') + ' Nothing is printed in their place.')] });
        return out;
      }
      out.push({ t: 'h2', runs: [t('RFM segments')] });
      out.push({ t: 'p', runs: [t(str(r.basis, 400))] });
      out.push({ t: 'table', head: [[t('Segment')], [t('Rule')], [t('Planning objective')]], rows: (r.rfm || []).map(function (s) {
        return [[{ text: str(s.name, 60), strong: true }], [t(str(s.rule, 120))], [t(str(s.objective, 120))]];
      }) });
      if (Array.isArray(r.replenishment) && r.replenishment.length) {
        out.push({ t: 'h3', runs: [t('Replenishment triggers')] });
        out.push({ t: 'p', runs: [t('Cohorts the planner adds when a ' + aud + '\'s own purchase history says the next order is due.')] });
        out.push({ t: 'table', head: [[t('Cohort')], [t('Planning objective')]], rows: r.replenishment.map(function (s) { return [[t(str(s.name, 80))], [t(str(s.objective, 120))]]; }) });
      }
      out.push({ t: 'p', runs: [t('Any other cohort name gets the objective "' + str(r.default_objective, 80) + '", the right answer for an audience the platform does not recognise.')] });
      return out;
    },

    offers: function (b, name, c) {
      var out = [];
      var rules = c.rules || null;
      var o = b.offers && typeof b.offers === 'object' ? b.offers : null;
      var codes = o && Array.isArray(o.codes) ? o.codes.filter(function (x) { return x && x.code; }) : [];
      var banned = o && Array.isArray(o.banned_codes) ? o.banned_codes.filter(function (x) { return x && x.code; }) : [];
      out.push({ t: 'p', runs: [t('The platform decides whether to discount, and how deep, from cohort behaviour. The CODE is ' + name + '\'s: it must exist in ' + name + '\'s own store, so a slot this brand has published no code for ships with no code and says so.')] });
      out.push({ t: 'h2', runs: [t('Discount ceiling')] });
      if (rules && rules.offers) {
        out.push({ t: 'kv', rows: [
          ['Platform ceiling', [t(pct(rules.offers.platform_cap) + ', for every brand')]],
          [name + '\'s cap', [t(pct(rules.offers.brand_cap) + (o && Number(o.discount_cap) > 0 ? ' (from the record)' : ' (no cap on the record, so the platform ceiling applies)'))]],
        ] });
      } else out.push({ t: 'note', runs: [t('The offer rules could not be read from the platform' + (c.rulesError ? ': ' + c.rulesError : '.'))] });

      out.push({ t: 'h2', runs: [t('Codes on the record')] });
      if (codes.length) {
        var cap = rules && rules.offers ? Number(rules.offers.brand_cap) : NaN;
        out.push({ t: 'table', head: [[t('Code')], [t('Rate')], [t('Slot')], [t('Minimum')], [t('Note')], [t('Status')]], rows: codes.slice(0, 60).map(function (x) {
          var over = Number.isFinite(cap) && Number(x.rate) > cap + 1e-9;
          return [[{ text: str(x.code, 40), code: true }], [t(pct(x.rate) || '-')], [t(str(x.slot, 40) || '-')], [t(x.min != null ? str(x.min, 12) : '-')], [t(str(x.note, 160) || '-')], [t(over ? 'Above the cap: never promoted' : 'Within the cap')]];
        }) });
      } else out.push({ t: 'p', runs: [mark('discount codes', name)] });
      if (banned.length) {
        out.push({ t: 'h3', runs: [t('Codes this brand has withdrawn')] });
        out.push({ t: 'list', items: banned.map(function (x) { return [{ text: str(x.code, 40), code: true }, t(x.rate ? ' (' + pct(x.rate) + ')' : '')]; }) });
      }

      out.push({ t: 'h2', runs: [t('Offer depth by cohort')] });
      var segs = rules && rules.cohorts ? (rules.cohorts.rfm || []).concat(rules.cohorts.replenishment || []) : [];
      if (segs.length) {
        out.push({ t: 'table', head: [[t('Cohort')], [t('Slot')], [t('Depth')], [t(name + '\'s code')], [t('Why')]], rows: segs.map(function (s) {
          var of = s.offer || {};
          var code = of.code ? [{ text: str(of.code, 40), code: true }] : (of.pct > 0 ? [mark('discount code for the "' + str(of.slot, 40) + '" offer slot', name)] : [t('No discount')]);
          // The planner's own rationale, minus its "no code is shown" clause: the
          // marker in the code column already says that, in the spec's form.
          var why = str(of.rationale, 300).replace(/\s*No code is shown:[^]*$/, '');
          return [[t(str(s.name, 80))], [t(str(of.slot, 40))], [t(of.pct > 0 ? pct(of.pct) : 'none')], code, [t(why)]];
        }) });
      } else if (rules) out.push({ t: 'p', runs: [t('No cohort offer rules were returned.')] });
      return out;
    },

    creative: function (b, name, c) {
      var out = [];
      var tk = c.tokens || {};
      out.push({ t: 'p', runs: [t('Every asset type has its own contract: the structure it has in its medium, the design rules of that surface, the order it is made in, and the check the finished asset is held to. The contracts are the platform\'s and the same for every brand; ' + name + '\'s own tokens below are what they are rendered in.')] });
      out.push({ t: 'h2', runs: [t(name + '\'s design tokens')] });
      var sw = [];
      [['--brand-primary', 'Primary'], ['--brand-accent', 'Accent'], ['--brand-ink', 'Ink'], ['--brand-surface', 'Surface'], ['--brand-primary-text', 'Primary as text'], ['--brand-accent-text', 'Accent as text']].forEach(function (r) {
        var hex = str(tk[r[0]]);
        if (/^#[0-9a-f]{3,6}$/i.test(hex)) sw.push({ role: r[1], hex: hex, origin: r[0] });
      });
      if (sw.length) out.push({ t: 'swatches', items: sw });
      else out.push({ t: 'p', runs: [mark('colour palette', name)] });
      var ty = b.typography || {};
      out.push({ t: 'kv', rows: [
        ['Headings', ty.heading && ty.heading.family ? [t(str(ty.heading.family, 80))] : [mark('heading typeface', name)]],
        ['Body', ty.body && ty.body.family ? [t(str(ty.body.family, 80))] : [mark('body typeface', name)]],
        ['Logo', safeHref(b.logo_url) ? [link(b.logo_url, safeHref(b.logo_url))] : [mark('logo URL', name)]],
      ] });
      out.push({ t: 'p', runs: [t('No section of a generated asset is ever painted black or a dark neutral, and text on a brand colour is derived to read at AA. Landing pages are served at /lp/<id> in these tokens.')] });

      var list = c.rules && Array.isArray(c.rules.contracts) ? c.rules.contracts : null;
      if (!list) {
        out.push({ t: 'note', runs: [t('The asset contracts could not be read from the platform' + (c.rulesError ? ': ' + c.rulesError : '.') + ' Nothing is printed in their place.')] });
        return out;
      }
      list.forEach(function (k) {
        out.push({ t: 'h2', runs: [t(str(k.label, 80) + ' (' + str(k.medium, 30) + ')')] });
        out.push({ t: 'table', head: [[t('Slot')], [t('Required')], [t('Limit')], [t('Why')]], rows: (k.structure || []).map(function (s) {
          return [[{ text: str(s.slot, 40), code: true }], [t(s.required ? 'yes' : 'no')], [t(s.max ? s.max + ' characters' + (s.verified ? ' (enforced)' : ' (advisory)') : 'none recorded')], [t(str(s.why, 300))]];
        }) });
        if ((k.design || []).length) { out.push({ t: 'h3', runs: [t('Design rules')] }); out.push({ t: 'list', items: k.design.map(function (d) { return [t(str(d, 500))]; }) }); }
        if ((k.algorithm || []).length) { out.push({ t: 'h3', runs: [t('How it is made')] }); out.push({ t: 'olist', items: k.algorithm.map(function (d) { return [t(str(d, 500))]; }) }); }
      });
      return out;
    },

    market: function (b, name, c) {
      var out = [];
      var regions = regionsOf(b);
      out.push({ t: 'p', runs: [t('The markets ' + name + ' serves, its home market, the study on the record for each, and the competitors the record names.')] });
      out.push({ t: 'h2', runs: [t('Regions')] });
      if (regions.length) {
        out.push({ t: 'table', head: [[t('Market')], [t('Currency')], [t('Store')], [t('Home')]], rows: regions.map(function (r) {
          var href = safeHref(r.store_url);
          return [[t(regionLabel(c, r.code))], [t(str(r.currency, 8) || '-')], [href ? link(href, href) : mark('region store URL', name, r.code)], [t(r.home === true ? 'Home market' : '')]];
        }) });
      } else out.push({ t: 'p', runs: [mark('regions', name)] });
      var home = homeOf(regions);
      out.push({ t: 'kv', rows: [['Home market', home ? [t(regionLabel(c, home.code))] : [mark('home market', name)]]] });

      out.push({ t: 'h2', runs: [t('Market study')] });
      if (regions.length) {
        out.push({ t: 'table', head: [[t('Market')], [t('Study on the record')]], rows: regions.map(function (r) {
          var s = studyFor(b, r.code);
          return [[t(regionName(c, r.code))], s ? [link('Open the ' + regionName(c, r.code) + ' study', '/research?region=' + encodeURIComponent(r.code.toLowerCase()))] : [mark('market study', name, regionName(c, r.code))]];
        }) });
      } else out.push({ t: 'p', runs: [mark('market study', name)] });

      out.push({ t: 'h2', runs: [t('Competitors on the record')] });
      var rows = [];
      (Array.isArray(b.competitors) ? b.competitors : []).forEach(function (x) {
        var nm = typeof x === 'string' ? x : x && (x.name || x.brand);
        if (nm) rows.push({ name: str(nm, 120), site: typeof x === 'object' ? safeHref(x.website || x.url) : '', where: 'competitors', tier: '' });
      });
      regions.forEach(function (r) {
        var s = studyFor(b, r.code);
        (s && Array.isArray(s.tiers) ? s.tiers : []).forEach(function (tier) {
          (Array.isArray(tier.brands) ? tier.brands : []).forEach(function (x) {
            if (x && x.name) rows.push({ name: str(x.name, 120), site: safeHref(x.website), where: regionName(c, r.code) + ' study', tier: str(tier.name, 120) });
          });
        });
      });
      if (rows.length) {
        out.push({ t: 'table', head: [[t('Competitor')], [t('Tier')], [t('From')]], rows: rows.slice(0, 120).map(function (x) {
          return [[x.site ? link(x.name, x.site) : t(x.name)], [t(x.tier || '-')], [t(x.where)]];
        }) });
      } else out.push({ t: 'p', runs: [mark('competitor set', name)] });
      out.push({ t: 'p', runs: [t('Another brand\'s competitor set is never used in its place. '), link('Competitor Benchmarking', '/competitor-benchmarking'), t(' holds the live universe; '), link('Market Study', '/research'), t(' holds the full study per region.')] });
      return out;
    },
  };

  /* ── rendering (browser) ──────────────────────────────────────────────── */

  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function fillRuns(node, rs) {
    runs(rs).forEach(function (r) {
      if (!r) return;
      var n;
      var href = r.href ? safeHref(r.href) : '';
      if (href) {
        n = el('a');
        n.setAttribute('href', href);
        if (/^https?:/i.test(href)) { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener'); }
      } else if (r.marker) n = el('span', 'kd-marker');
      else if (r.code) n = el('code');
      else if (r.strong) n = el('strong');
      else if (r.em) n = el('em');
      else { node.appendChild(document.createTextNode(String(r.text == null ? '' : r.text))); return; }
      n.textContent = String(r.text == null ? '' : r.text);
      node.appendChild(n);
    });
    return node;
  }
  function render(blocks, host) {
    (blocks || []).forEach(function (b) {
      if (!b) return;
      var n;
      switch (b.t) {
        case 'h1': case 'h2': case 'h3': case 'h4':
          n = fillRuns(el(b.t), b.runs); break;
        case 'p': n = fillRuns(el('p'), b.runs); break;
        case 'note': n = fillRuns(el('p', 'kd-note'), b.runs); n.setAttribute('role', 'status'); break;
        case 'quote': n = fillRuns(el('blockquote'), b.runs); break;
        case 'hr': n = el('hr'); break;
        case 'pre': n = el('pre'); n.textContent = String(b.text || ''); break;
        case 'list': case 'olist':
          n = el(b.t === 'olist' ? 'ol' : 'ul');
          (b.items || []).forEach(function (it) { n.appendChild(fillRuns(el('li'), it)); });
          break;
        case 'kv':
          n = el('dl', 'kd-kv');
          (b.rows || []).forEach(function (r) {
            n.appendChild(fillRuns(el('dt'), r[0]));
            n.appendChild(fillRuns(el('dd'), r[1]));
          });
          break;
        case 'table': {
          n = el('div', 'kd-table');
          var tb = el('table');
          var th = el('thead'); var tr = el('tr');
          (b.head || []).forEach(function (h) { tr.appendChild(fillRuns(el('th'), h)); });
          th.appendChild(tr); tb.appendChild(th);
          var body = el('tbody');
          (b.rows || []).forEach(function (row) {
            var r = el('tr');
            row.forEach(function (cell) { r.appendChild(fillRuns(el('td'), cell)); });
            body.appendChild(r);
          });
          tb.appendChild(body); n.appendChild(tb);
          break;
        }
        case 'swatches':
          n = el('div', 'kd-swatches');
          (b.items || []).forEach(function (s) {
            var card = el('div', 'kd-swatch');
            var chip = el('span', 'kd-chip');
            // The brand's OWN value, from its record or its token set: data, not
            // a colour this file decides.
            chip.style.backgroundColor = s.hex;
            var lab = el('span', 'kd-swatch-label');
            var role = el('strong'); role.textContent = s.role;
            var hex = el('code'); hex.textContent = s.hex;
            lab.appendChild(role); lab.appendChild(document.createTextNode(' ')); lab.appendChild(hex);
            if (s.origin) { var o = el('span', 'kd-origin'); o.textContent = s.origin; lab.appendChild(o); }
            card.appendChild(chip); card.appendChild(lab); n.appendChild(card);
          });
          break;
        default: return;
      }
      host.appendChild(n);
    });
    return host;
  }

  return {
    DOCS: DOCS, BASE: BASE, ZERO_FILES: ZERO_FILES,
    docById: docById, docFromPath: docFromPath, hrefFor: hrefFor, isPlatformDoc: isPlatformDoc, operatorOnly: operatorOnly,
    marker: marker, parseMarkdown: parseMarkdown, normalize: normalize,
    build: build, render: render, safeHref: safeHref,
  };
});
