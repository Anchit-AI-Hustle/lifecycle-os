'use strict';
/**
 * brand-coherence.js — does this brand record describe ONE brand?
 * ---------------------------------------------------------------------------
 * Found on the live project (2026-10-10): the only brand stored was named
 * "Mamaearth", slugged "food-for-thought", with its website set to
 * https://www.nike.in, its social profiles, imagery, favicon and legal entity
 * read from mamaearth.in, and its catalogue imported from delichic.co.in.
 * Four companies in one record, and nothing in the product said so, because
 * nothing in the product had a rule that a brand's IDENTITY facts belong to
 * one brand. Every field had a source; nobody compared the sources.
 *
 * The rule, stated once:
 *   - A brand's IDENTITY SOURCE is its website's registrable domain.
 *   - Every site-derived value carries the URL it was read from
 *     (brand_data.field_origins[f].url, brand_data.brand_extraction.applied[f]
 *     .source_url, social[].source_url, imagery[].page, catalog_source.url).
 *   - A value read from ANOTHER registrable domain is a conflict, reported
 *     with the field, the value, the domain it came from and the page.
 *   - IDENTITY fields (name, tagline, logo, app icon, social profiles, legal
 *     entity, imagery, brand assets, claims, catalogue) from another domain
 *     BLOCK activation - overridable, and the override is recorded. Design
 *     values (colours, fonts, measured design system, tone, home market) and
 *     the softer signals (a typed name that matches nothing in the domain, a
 *     slug made from an earlier name) WARN.
 *   - Nothing is resolved here. A conflict says what disagrees and offers
 *     "keep" or "clear"; the person picks. A brand with no website is not
 *     given one: if its sourced facts come from two domains, every one of
 *     them is a conflict.
 *
 * "Another domain" uses the same ownership rule as scripts/lib/brand-ownership.js
 * (the preset harvester's): same registrable domain, the same brand label under
 * another suffix (nike.in / nike.com), or a corporate sibling (hmgroup.com).
 * Shared CDNs and social platforms carry no identity of their own, so a value
 * HOSTED there is judged only by the page it was read from.
 *
 * PORTED IDENTICALLY to the browser: the block between the BRAND-COHERENCE
 * markers below is byte-for-byte the block in brand-context.js, and
 * tests/brand-record-coherence.spec.js asserts both the text and the output
 * (the device path judges a brand exactly as the server does).
 *
 * Pure: no I/O, no clock. Not a function file (api/_shared/), still 12/12.
 * ---------------------------------------------------------------------------
 */

/* BRAND-COHERENCE:BEGIN */
var COHERENCE = (function () {
  var MULTI_LABEL_SUFFIXES = ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in',
    'co.jp', 'ne.jp', 'or.jp', 'com.br', 'co.nz', 'com.mx', 'com.sg', 'com.hk', 'co.kr', 'com.cn', 'com.tw', 'co.za',
    'com.tr', 'com.ar', 'co.id', 'com.my', 'com.ph', 'com.vn', 'co.th', 'com.sa', 'com.eg'];
  /* A host under one of these is its OWN site (store.myshopify.com is a store, not Shopify). */
  var PRIVATE_SUFFIXES = ['myshopify.com', 'github.io', 'vercel.app', 'netlify.app', 'pages.dev', 'wixsite.com', 'blogspot.com',
    'wordpress.com', 'herokuapp.com', 'web.app', 'firebaseapp.com'];
  /* Hosts that carry no brand identity: a CDN, a storage bucket, a social platform. */
  var NEUTRAL_HOSTS = ['shopify.com', 'shopifycdn.com', 'shopifycdn.net', 'cloudinary.com', 'imgix.net', 'cloudfront.net', 'akamaized.net',
    'akamaihd.net', 'fastly.net', 'googleusercontent.com', 'gstatic.com', 'googleapis.com', 'ggpht.com', 'wp.com', 'squarespace-cdn.com',
    'wixstatic.com', 'amazonaws.com', 'b-cdn.net', 'jsdelivr.net', 'unpkg.com', 'fbcdn.net', 'cdninstagram.com', 'twimg.com', 'ytimg.com',
    'supabase.co', 'vercel-storage.com', 'githubusercontent.com', 'imagekit.io', 'ctfassets.net', 'sanity.io', 'storyblok.com',
    'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'youtube.com', 'youtu.be', 'linkedin.com', 'pinterest.com', 'tiktok.com',
    'threads.net', 'snapchat.com', 'whatsapp.com', 'wa.me', 't.me', 'medium.com'];
  var CORPORATE_TAIL = /^(?:group|groups|inc|corp|corporate|global|holding|holdings)$/;
  var NAME_STOP = ['the', 'and', 'of', 'inc', 'ltd', 'llc', 'llp', 'plc', 'pvt', 'private', 'limited', 'company', 'co', 'gmbh', 'corp', 'official', 'store', 'shop'];

  /* Which fields are checked, how each is labelled, and whether a foreign
     source BLOCKS (identity) or WARNS (design and softer signals). */
  var FIELDS = [
    ['name', 'Brand name', true], ['tagline', 'Tagline', true], ['logo_url', 'Logo', true], ['favicon_url', 'App icon', true],
    ['brand_data.legal_entity', 'Legal entity', true], ['brand_data.social', 'Social profiles', true],
    ['brand_data.imagery', 'Imagery', true], ['brand_data.brand_assets', 'Brand assets', true], ['brand_data.claims', 'Claims', true],
    ['catalog_source', 'Catalogue', true], ['regions', 'Region store', false], ['regions.home', 'Home market', false],
    ['palette.primary', 'Primary colour', false], ['palette.accent', 'Accent colour', false], ['palette.ink', 'Text colour', false],
    ['palette.surface', 'Page surface', false], ['palette.surface_alt', 'Card surface', false], ['palette.muted', 'Secondary text', false],
    ['typography.heading', 'Heading font', false], ['typography.body', 'Body font', false],
    ['brand_data.design_system', 'Measured design system', false], ['voice.tone', 'Tone of voice', false],
    ['asset_hosts', 'Asset hosts', false], ['website', 'Website', true], ['slug', 'Slug', false]
  ];
  var LABEL = {}, IDENTITY = {};
  FIELDS.forEach(function (f) { LABEL[f[0]] = f[1]; IDENTITY[f[0]] = f[2]; });
  /* The older key a site read wrote some fields under. */
  var ALT_KEY = { 'brand_data.legal_entity': 'legal_entity', 'brand_data.social': 'social', 'brand_data.imagery': 'imagery', 'brand_data.design_system': 'design_system' };

  function str(v) { return v == null ? '' : String(v).trim(); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function hostOf(url) {
    var s = str(url);
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+([\/?#:]|$)/i.test(s)) return '';
      s = 'https://' + s;
    }
    try {
      var u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\d?\./, '');
    } catch (_) { return ''; }
  }
  function endsWith(h, suffix) { return h === suffix || h.slice(-(suffix.length + 1)) === '.' + suffix; }
  function registrableDomain(host) {
    var h = str(host).toLowerCase().replace(/\.$/, '');
    if (!h) return '';
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.indexOf(':') >= 0 || h.indexOf('.') < 0) return h;
    var parts = h.split('.');
    for (var i = 0; i < PRIVATE_SUFFIXES.length; i++) {
      var p = PRIVATE_SUFFIXES[i];
      if (endsWith(h, p) && h !== p) return parts.slice(-(p.split('.').length + 1)).join('.');
    }
    if (parts.length <= 2) return h;
    var last2 = parts.slice(-2).join('.');
    return MULTI_LABEL_SUFFIXES.indexOf(last2) >= 0 ? parts.slice(-3).join('.') : last2;
  }
  function neutral(host) {
    var h = str(host).toLowerCase();
    if (!h) return true;
    for (var i = 0; i < NEUTRAL_HOSTS.length; i++) if (endsWith(h, NEUTRAL_HOSTS[i])) return true;
    return false;
  }
  function brandLabel(domain) {
    var d = str(domain);
    if (!d || /^\d{1,3}(\.\d{1,3}){3}$/.test(d) || d.indexOf(':') >= 0) return '';
    var label = d.split('.')[0];
    return /^\d+$/.test(label) ? '' : label;
  }
  function corporateSibling(a, b) {
    if (!a || !b || a === b || b.indexOf(a) !== 0) return false;
    var rest = b.slice(a.length);
    if (rest.charAt(0) === '-') rest = rest.slice(1);
    return CORPORATE_TAIL.test(rest);
  }
  /** One brand's domains: the same registrable domain, the same label under
      another suffix (nike.in / nike.com), or a corporate sibling. */
  function sameBrand(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    var la = brandLabel(a), lb = brandLabel(b);
    if (la && la === lb) return true;
    return corporateSibling(la, lb) || corporateSibling(lb, la);
  }
  function fold(s) {
    var t = str(s).toLowerCase();
    try { t = t.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (_) { /* old engine */ }
    return t.replace(/[^a-z0-9]+/g, '');
  }
  function slugify(v) { return str(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48); }
  function nameTokens(name) {
    var t = str(name).toLowerCase();
    try { t = t.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (_) { /* old engine */ }
    return t.split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 3 && NAME_STOP.indexOf(w) < 0; });
  }
  /** Does a NAME read as the brand that owns this host? Containment either way
      over the host's labels, or every word of the name inside them. */
  function nameFitsHost(name, host) {
    var n = fold(name);
    var h = str(host).toLowerCase();
    if (!n || !h) return true;
    var reg = registrableDomain(h);
    var suffixLen = reg.split('.').length - 1;
    var labels = h.split('.');
    labels = labels.slice(0, Math.max(1, labels.length - suffixLen)).map(fold).filter(Boolean);
    var joined = labels.join('');
    for (var i = 0; i < labels.length; i++) {
      var l = labels[i];
      if (l === n) return true;
      if (l.length >= 3 && (n.indexOf(l) >= 0 || l.indexOf(n) >= 0)) return true;
    }
    if (n.length >= 3 && joined.indexOf(n) >= 0) return true;
    var toks = nameTokens(name);
    return toks.length > 0 && toks.every(function (w) { return joined.indexOf(w) >= 0; });
  }
  function firstUrl(s) { var m = /https?:\/\/\S+/i.exec(str(s)); return m ? m[0] : ''; }

  function getAt(o, p) {
    var ks = p.split('.'), n = o;
    for (var i = 0; i < ks.length; i++) { if (!n || typeof n !== 'object') return undefined; n = n[ks[i]]; }
    return n;
  }
  /** The current value of a checked field, as the record holds it. */
  function valueOf(rec, f) {
    if (f.indexOf('brand_data.') === 0) return getAt(rec.brand_data || {}, f.slice(11));
    if (f === 'regions.home') {
      var h = (Array.isArray(rec.regions) ? rec.regions : []).filter(function (r) { return r && r.home === true; })[0];
      return h ? str(h.code).toUpperCase() : '';
    }
    return getAt(rec, f);
  }
  function scalar(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim().toLowerCase();
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return null;
  }
  function filled(v) {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  }
  /**
   * Where the CURRENT value of a field came from: { url, origin, signal } or
   * null. A record of a read describes the current value only when it says
   * the same thing - a value typed after a read is the person's, and a read
   * record left beside it is history, not a source.
   */
  function sourceOf(rec, f) {
    var bd = isObj(rec.brand_data) ? rec.brand_data : {};
    var cur = valueOf(rec, f);
    if (!filled(cur)) return null;
    var fos = isObj(bd.field_origins) ? bd.field_origins : {};
    var plain = isObj(bd.field_origin) ? bd.field_origin : {};
    var fo = isObj(fos[f]) ? fos[f] : null;
    var origin = str((fo && fo.origin) || plain[f]);
    if (origin === 'document') return { url: '', origin: 'document', signal: str(fo && fo.source) };
    if (origin === 'preset') return { url: '', origin: 'preset', signal: str(fo && fo.source) };
    var ex = isObj(bd.brand_extraction) && isObj(bd.brand_extraction.applied) ? bd.brand_extraction.applied : {};
    var ap = isObj(ex[f]) ? ex[f] : (ALT_KEY[f] && isObj(ex[ALT_KEY[f]]) ? ex[ALT_KEY[f]] : null);
    var cs = scalar(cur);
    if (fo && str(fo.url) && origin !== 'user') {
      var fv = scalar(fo.value);
      if (cs === null || fv === null || !fv || fv === cs) return { url: firstUrl(fo.url), origin: origin, signal: str(fo.signal) };
    }
    if (ap && str(ap.source_url)) {
      var av = scalar(ap.value);
      // A string record that matches the value describes it, even after the
      // person pressed "Use your site's" (origin user): it is still that
      // site's fact. A structured value is described only while no person
      // has claimed the field.
      if ((cs !== null && av && av === cs) || ((cs === null || !av) && origin !== 'user' && origin !== 'document')) {
        return { url: firstUrl(ap.source_url), origin: origin || str(ap.origin) || 'site-parse', signal: str(ap.signal) };
      }
    }
    return null;
  }

  /**
   * brandCoherence(record) -> {
   *   identity: { website, host, domain } | null,
   *   domains:  [{ domain, fields: [label...] }],
   *   conflicts:[{ id, kind, field, label, severity, domain, expected, value, source_url, count, message }],
   *   accepted: [id...]  (conflicts the person kept, recorded in brand_data.coherence.accepted),
   *   blocking, ok, summary }
   */
  function brandCoherence(record) {
    var rec = isObj(record) ? record : {};
    var bd = isObj(rec.brand_data) ? rec.brand_data : {};
    var coh = isObj(bd.coherence) ? bd.coherence : {};
    var acceptedIds = (Array.isArray(coh.accepted) ? coh.accepted : []).map(function (a) { return isObj(a) ? str(a.id) : str(a); }).filter(Boolean);
    var websiteHost = hostOf(rec.website);
    var identity = websiteHost ? { website: str(rec.website), host: websiteHost, domain: registrableDomain(websiteHost) } : null;
    var facts = [];   // { field, domain, url, value, origin, via }
    function add(field, url, value, via, origin) {
      var h = hostOf(url);
      if (!h || neutral(h)) return;
      facts.push({ field: field, domain: registrableDomain(h), url: str(url), value: value, via: via, origin: origin || '' });
    }
    function preview(v) {
      if (v == null) return '';
      if (typeof v === 'string') return v.length > 90 ? v.slice(0, 87) + '...' : v;
      if (Array.isArray(v)) return v.length + ' item(s)';
      if (isObj(v) && v.family) return str(v.family);
      return typeof v === 'object' ? 'measured' : String(v);
    }
    // An asset's page: the brand_assets row that names it (a preset carries
    // them top-level, a saved brand under brand_data).
    var assets = Array.isArray(bd.brand_assets) ? bd.brand_assets : (Array.isArray(rec.brand_assets) ? rec.brand_assets : []);
    function foundOn(url) {
      var u = str(url);
      for (var i = 0; i < assets.length; i++) if (isObj(assets[i]) && str(assets[i].url) === u && str(assets[i].found_on)) return str(assets[i].found_on);
      return '';
    }
    var assetPages = {};
    assets.forEach(function (a) { if (isObj(a) && str(a.found_on)) assetPages[hostOf(a.url)] = registrableDomain(hostOf(a.found_on)); });
    FIELDS.forEach(function (row) {
      var f = row[0];
      if (f === 'website' || f === 'slug' || f === 'regions' || f === 'asset_hosts' || f === 'catalog_source') return;
      if (f === 'brand_data.social' || f === 'brand_data.imagery' || f === 'brand_data.brand_assets' || f === 'brand_data.claims') return;
      var s = sourceOf(rec, f);
      if (s && s.url) add(f, s.url, preview(valueOf(rec, f)), 'read from', s.origin);
      else if ((f === 'logo_url' || f === 'favicon_url') && filled(rec[f]) && !s) {
        if (foundOn(rec[f])) add(f, foundOn(rec[f]), preview(rec[f]), 'read from', 'preset');
        else add(f, rec[f], preview(rec[f]), 'hosted on', '');
      }
    });
    // Per-item fields: each item carries the page it was read from.
    (Array.isArray(bd.social) ? bd.social : []).forEach(function (x) {
      if (!isObj(x)) return;
      if (str(x.source_url)) add('brand_data.social', x.source_url, str(x.url), 'read from', 'site-parse');
    });
    (Array.isArray(bd.imagery) ? bd.imagery : []).forEach(function (x) {
      if (!isObj(x)) return;
      if (str(x.page)) add('brand_data.imagery', x.page, str(x.url), 'read from', 'site-render');
      else add('brand_data.imagery', x.url, str(x.url), 'hosted on', '');
    });
    assets.forEach(function (x) {
      if (!isObj(x)) return;
      if (str(x.found_on)) add('brand_data.brand_assets', x.found_on, str(x.url), 'read from', '');
      else add('brand_data.brand_assets', x.url, str(x.url), 'hosted on', '');
    });
    var ex = isObj(bd.brand_extraction) && isObj(bd.brand_extraction.applied) ? bd.brand_extraction.applied : {};
    var claims = Array.isArray(bd.claims) ? bd.claims.map(function (c) { return scalar(isObj(c) ? c.text : c); }) : [];
    Object.keys(ex).forEach(function (k) {
      if (!/^claims\[\d+\]$/.test(k) || !isObj(ex[k])) return;
      var v = scalar(ex[k].value);
      if (v && claims.indexOf(v) >= 0) add('brand_data.claims', ex[k].source_url, str(ex[k].value), 'read from', 'site-parse');
    });
    var cat = isObj(rec.catalog_source) ? rec.catalog_source : {};
    if (str(cat.url)) add('catalog_source', cat.url, str(cat.url) + (cat.row_count != null ? ' (' + cat.row_count + ' products)' : ''), 'imported from', '');
    (Array.isArray(rec.regions) ? rec.regions : []).forEach(function (r) {
      if (isObj(r) && str(r.store_url)) add('regions', r.store_url, str(r.code) + ' ' + str(r.store_url), 'store on', '');
    });
    // A declared asset host is judged by the page its assets were found on,
    // when the record says (a brand's own CDN under another name, an agency
    // host serving the brand's own newsroom image).
    (Array.isArray(rec.asset_hosts) ? rec.asset_hosts : []).forEach(function (h) {
      var hh = hostOf('https://' + str(h).replace(/^https?:\/\//, ''));
      if (assetPages[hh]) { facts.push({ field: 'asset_hosts', domain: assetPages[hh], url: 'https://' + hh, value: str(h), via: 'declared', origin: '' }); return; }
      add('asset_hosts', 'https://' + hh, str(h), 'declared', '');
    });

    var conflicts = [];
    var groups = {};
    function conflict(c) {
      var id = c.kind + ':' + c.field + ':' + (c.domain || '');
      if (groups[id]) { groups[id].count += 1; return; }
      c.id = id;
      c.label = LABEL[c.field] || c.field;
      c.count = 1;
      groups[id] = c;
      conflicts.push(c);
    }
    var domainsSeen = {};
    facts.forEach(function (x) { (domainsSeen[x.domain] = domainsSeen[x.domain] || {})[LABEL[x.field] || x.field] = true; });

    if (identity) {
      facts.forEach(function (x) {
        if (sameBrand(x.domain, identity.domain)) return;
        var block = !!IDENTITY[x.field] && x.via !== 'hosted on' && x.via !== 'declared' && x.via !== 'store on';
        conflict({
          kind: 'cross_domain', field: x.field, severity: block ? 'block' : 'warn', domain: x.domain, expected: identity.domain,
          value: x.value, source_url: x.url,
          message: (LABEL[x.field] || x.field) + ' was ' + x.via + ' ' + x.domain + '; this brand\'s website is ' + identity.domain + '.'
        });
      });
    } else {
      // No website: no identity source to measure against, and none is chosen
      // here. Sourced facts from more than one brand's domains are a mix.
      var brands = [];
      facts.forEach(function (x) {
        if (x.via === 'declared' || x.via === 'hosted on' || x.via === 'store on') return;
        if (!brands.some(function (d) { return sameBrand(d, x.domain); })) brands.push(x.domain);
      });
      if (brands.length > 1) {
        facts.forEach(function (x) {
          if (x.via === 'declared' || x.via === 'hosted on' || x.via === 'store on') return;
          conflict({
            kind: 'mixed_sources', field: x.field, severity: IDENTITY[x.field] ? 'block' : 'warn', domain: x.domain, expected: '',
            value: x.value, source_url: x.url,
            message: (LABEL[x.field] || x.field) + ' was ' + x.via + ' ' + x.domain + ', and this record holds values read from ' + brands.join(', ') + '. It has no website to say which is the brand.'
          });
        });
      }
    }

    var name = str(rec.name);
    var nameSrc = sourceOf(rec, 'name');
    if (identity && name && !(nameSrc && nameSrc.url) && !nameFitsHost(name, identity.host)) {
      conflict({ kind: 'name_domain', field: 'name', severity: 'warn', domain: identity.domain, expected: identity.domain, value: name, source_url: '',
        message: 'The name "' + name + '" does not match the website ' + identity.host + '. Check that both are this brand\'s.' });
    }
    var slug = str(rec.slug);
    if (slug && name) {
      var fs = fold(slug), fn = fold(name);
      var st = nameTokens(slug.replace(/-/g, ' '));
      var tokensFit = st.length > 0 && st.every(function (w) { return fn.indexOf(w) >= 0; });
      if (fs && fn && fs.indexOf(fn) < 0 && fn.indexOf(fs) < 0 && !tokensFit) {
        conflict({ kind: 'slug_name', field: 'slug', severity: 'warn', domain: '', expected: slugify(name), value: slug, source_url: '',
          message: 'The slug "' + slug + '" was made from another name; this brand is "' + name + '" (' + slugify(name) + ').' });
      }
    }
    // A template's identity under a brand that is not that template.
    var tpl = isObj(bd.template) ? bd.template : null;
    if (tpl && str(tpl.name) && fold(tpl.name) !== fold(name)) {
      var plainO = isObj(bd.field_origin) ? bd.field_origin : {};
      var fosO = isObj(bd.field_origins) ? bd.field_origins : {};
      ['website', 'tagline', 'logo_url', 'regions', 'brand_data.brand_assets', 'asset_hosts'].forEach(function (f) {
        var o = str((isObj(fosO[f]) && fosO[f].origin) || plainO[f]);
        if (o !== 'preset' || !filled(f === 'brand_data.brand_assets' ? bd.brand_assets : rec[f])) return;
        conflict({ kind: 'template', field: f, severity: (f === 'website' || f === 'logo_url' || f === 'brand_data.brand_assets') ? 'block' : 'warn',
          domain: 'template:' + slugify(tpl.slug || tpl.name), expected: '', value: preview(f === 'brand_data.brand_assets' ? bd.brand_assets : rec[f]), source_url: '',
          message: (LABEL[f] || f) + ' came from the ' + str(tpl.name) + ' template; this brand is "' + name + '".' });
      });
    }
    // A brand document that describes another brand.
    var doc = isObj(bd.brand_document) && isObj(bd.brand_document.describes) ? bd.brand_document.describes : null;
    if (doc) {
      var dh = hostOf(doc.website);
      if (dh && identity && !sameBrand(registrableDomain(dh), identity.domain)) {
        conflict({ kind: 'document', field: 'brand_data.brand_document', severity: 'block', domain: registrableDomain(dh), expected: identity.domain,
          value: str(bd.brand_document.name), source_url: str(doc.website),
          message: 'The brand guidelines applied (' + str(bd.brand_document.name) + ') describe ' + registrableDomain(dh) + '; this brand\'s website is ' + identity.domain + '.' });
      } else if (str(doc.name) && name && fold(doc.name).indexOf(fold(name)) < 0 && fold(name).indexOf(fold(doc.name)) < 0) {
        conflict({ kind: 'document', field: 'brand_data.brand_document', severity: 'warn', domain: 'document:' + fold(doc.name), expected: '',
          value: str(bd.brand_document.name), source_url: '',
          message: 'The brand guidelines applied (' + str(bd.brand_document.name) + ') name "' + str(doc.name) + '"; this brand is "' + name + '".' });
      }
    }
    LABEL['brand_data.brand_document'] = 'Brand guidelines';

    var accepted = [];
    var live = conflicts.filter(function (c) {
      if (acceptedIds.indexOf(c.id) >= 0) { accepted.push(c.id); return false; }
      return true;
    });
    live.forEach(function (c) { c.label = LABEL[c.field] || c.field; });
    var blocking = live.some(function (c) { return c.severity === 'block'; });
    var domains = Object.keys(domainsSeen).sort().map(function (d) { return { domain: d, fields: Object.keys(domainsSeen[d]).sort() }; });
    var foreign = [];
    live.forEach(function (c) { if (c.domain && c.domain.indexOf(':') < 0 && foreign.indexOf(c.domain) < 0) foreign.push(c.domain); });
    var summary = !live.length ? 'Every sourced value on this brand comes from ' + (identity ? identity.domain : 'one place') + '.'
      : (blocking ? 'This record mixes brands: ' : 'Check this record: ') + live.length + ' value(s) ' +
        (foreign.length ? 'come from ' + foreign.join(', ') + (identity ? ', not ' + identity.domain : '') : 'disagree with each other') + '.';
    return { identity: identity, domains: domains, conflicts: live, accepted: accepted, blocking: blocking, ok: live.length === 0, summary: summary };
  }

  /**
   * catalogIdentity(record) - may a generator use the catalogue on this
   * record as THIS brand's products? (2026-10-10)
   *
   * The rule above judged a foreign catalogue only at activation, so a record
   * activated before the rule existed (or overridden) kept handing another
   * company's products to every planner and writer: a brand named Mamaearth
   * got mailers for another company's chicken salami. The answer here is
   * brandCoherence's OWN verdict, never a second domain comparison: a
   * catalogue conflict that BLOCKS (cross_domain or mixed_sources on
   * catalog_source) and that the person has not kept excludes the catalogue.
   *
   * `allowed` lists the registrable domains a product row may come from: the
   * website's, the catalogue source's when it is not excluded, and any
   * catalogue domain the person KEPT. catalogRowForeign() judges one row by
   * the page it describes (source_url, else product_url); a row with no page
   * belongs to the catalogue it arrived in, so it follows that verdict.
   */
  function catalogIdentity(record) {
    var rec = isObj(record) ? record : {};
    var c = brandCoherence(rec);
    var cat = isObj(rec.catalog_source) ? rec.catalog_source : {};
    var hit = null;
    c.conflicts.forEach(function (x) { if (!hit && x.field === 'catalog_source' && x.severity === 'block') hit = x; });
    var kept = [];
    c.accepted.forEach(function (id) {
      var m = /^(?:cross_domain|mixed_sources):catalog_source:(.+)$/.exec(id);
      if (m && kept.indexOf(m[1]) < 0) kept.push(m[1]);
    });
    var srcDomain = registrableDomain(hostOf(cat.url));
    var allowed = [];
    function allow(d) { if (d && allowed.indexOf(d) < 0) allowed.push(d); }
    if (c.identity) allow(c.identity.domain);
    if (srcDomain && !hit) allow(srcDomain);
    kept.forEach(allow);
    var name = str(rec.name) || 'this brand';
    var marker = '[DATA REQUIRED BEFORE LAUNCH: product catalogue, ' + name + ']';
    var sentence = hit
      ? 'The catalogue on this record was imported from ' + hit.domain + (c.identity ? ', not from ' + c.identity.domain + ' (this brand\'s website)' : '') +
        ', so none of its products, photos or claims are used for ' + name + '. Import ' + name + '\'s own catalogue, or keep this one in brand setup if it is ' + name + '\'s.'
      : '';
    return {
      excluded: !!hit, domain: hit ? hit.domain : '', conflict_id: hit ? hit.id : '', identity_domain: c.identity ? c.identity.domain : '',
      source_domain: srcDomain, allowed: allowed, kept: kept, marker: marker, sentence: sentence
    };
  }
  /** Does ONE product row come from another brand's site, under this verdict? */
  function catalogRowForeign(row, verdict) {
    if (!isObj(row) || !isObj(verdict)) return false;
    var u = str(row.source_url) || str(row.product_url) || str(row.url);
    var h = hostOf(u);
    if (!h || neutral(h)) return !!verdict.excluded;
    if (!verdict.allowed || !verdict.allowed.length) return !!verdict.excluded;
    var d = registrableDomain(h);
    return !verdict.allowed.some(function (a) { return sameBrand(a, d); });
  }

  return { brandCoherence: brandCoherence, catalogIdentity: catalogIdentity, catalogRowForeign: catalogRowForeign, registrableDomain: registrableDomain, hostOf: hostOf, sameBrand: sameBrand, nameFitsHost: nameFitsHost, sourceOf: sourceOf, slugify: slugify, LABEL: LABEL, MULTI_LABEL_SUFFIXES: MULTI_LABEL_SUFFIXES };
})();
/* BRAND-COHERENCE:END */

module.exports = COHERENCE;
