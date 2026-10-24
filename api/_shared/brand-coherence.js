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
    ['catalog_source', 'Catalogue', true], ['regions', 'Region store', true], ['regions.home', 'Home market', false],
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
      if (groups[id]) {
        groups[id].count += 1;
        if (c.severity === 'block' && groups[id].severity !== 'block') { groups[id].severity = 'block'; groups[id].message = c.message; }
        return;
      }
      c.id = id;
      c.label = LABEL[c.field] || c.field;
      c.count = 1;
      groups[id] = c;
      conflicts.push(c);
    }
    var domainsSeen = {};
    facts.forEach(function (x) { (domainsSeen[x.domain] = domainsSeen[x.domain] || {})[LABEL[x.field] || x.field] = true; });

    if (identity) {
      // Another brand's SITE on this record: a domain a value was read from or a
      // region's store is on. An asset host on that brand's domain is that site,
      // not a CDN (the live record: a nike.in store beside nike.com hosts).
      var siteDomains = [];
      facts.forEach(function (x) {
        if (x.via === 'declared' || x.via === 'hosted on' || sameBrand(x.domain, identity.domain)) return;
        if (siteDomains.indexOf(x.domain) < 0) siteDomains.push(x.domain);
      });
      facts.forEach(function (x) {
        if (sameBrand(x.domain, identity.domain)) return;
        // A region's store BLOCKS: the catalogue import reads it, so a store on
        // another site files that site's products as this brand's (2026-10-10).
        var block = x.field === 'asset_hosts'
          ? siteDomains.some(function (d) { return sameBrand(d, x.domain); })
          : !!IDENTITY[x.field] && x.via !== 'hosted on' && x.via !== 'declared';
        var msg = x.field === 'regions'
          ? 'The ' + x.value.split(' ')[0] + ' store URL ' + x.url + ' is on ' + x.domain + '; this brand\'s website is ' + identity.domain + '. A catalogue import reads a region\'s store, so it would file ' + x.domain + '\'s products as this brand\'s.'
          : (x.field === 'asset_hosts' && block
            ? 'Asset host ' + x.value + ' is on ' + x.domain + ', another brand\'s site on this record; this brand\'s website is ' + identity.domain + '.'
            : (LABEL[x.field] || x.field) + ' was ' + x.via + ' ' + x.domain + '; this brand\'s website is ' + identity.domain + '.');
        conflict({
          kind: 'cross_domain', field: x.field, severity: block ? 'block' : 'warn', domain: x.domain, expected: identity.domain,
          value: x.value, source_url: x.url, message: msg
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
    // A starter template is ANOTHER brand's identity (2026-10-11): on a brand
    // whose website is another site than the template's, nothing the
    // template filled - name, tagline, logo, colours, fonts, voice, store,
    // assets - is this brand's. Every such value BLOCKS.
    var tplHost = tpl ? hostOf(tpl.website) : '';
    if (tpl && tplHost && identity && !sameBrand(registrableDomain(tplHost), identity.domain)) {
      var plainT = isObj(bd.field_origin) ? bd.field_origin : {};
      var fosT = isObj(bd.field_origins) ? bd.field_origins : {};
      ['name', 'tagline', 'logo_url', 'regions', 'brand_data.brand_assets', 'asset_hosts', 'palette.primary', 'palette.accent', 'palette.ink',
        'palette.surface', 'palette.surface_alt', 'palette.muted', 'typography.heading', 'typography.body', 'voice.tone'].forEach(function (f) {
        var o = str((isObj(fosT[f]) && fosT[f].origin) || plainT[f]);
        var v = f === 'brand_data.brand_assets' ? bd.brand_assets : valueOf(rec, f);
        if (o !== 'preset' || !filled(v)) return;
        conflict({ kind: 'template', field: f, severity: 'block', domain: 'template:' + slugify(tpl.slug || tpl.name), expected: identity.domain,
          value: preview(v), source_url: str(tpl.website),
          message: (LABEL[f] || f) + ' came from the ' + str(tpl.name) + ' starter template (' + registrableDomain(tplHost) + '); this brand\'s website is ' + identity.domain + ', so it is not this brand\'s. Read ' + identity.domain + ' instead.' });
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
    live.forEach(function (c) { if (c.domain && c.domain.indexOf(':') < 0 && !(identity && sameBrand(c.domain, identity.domain)) && foreign.indexOf(c.domain) < 0) foreign.push(c.domain); });
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
    // A catalogue SET ASIDE when the record was written (another site's,
    // setAsideForeign) leaves its rows in the table: they are still another
    // brand's, rows with no page of their own included (2026-10-11).
    var bdc = isObj(rec.brand_data) && isObj(rec.brand_data.coherence) ? rec.brand_data.coherence : {};
    if (!hit && !str(cat.url) && Array.isArray(bdc.set_aside)) {
      bdc.set_aside.forEach(function (e) {
        if (isObj(e) && e.field === 'catalog_source' && str(e.domain) && !(c.identity && sameBrand(str(e.domain), c.identity.domain))) {
          hit = { domain: str(e.domain), id: 'set_aside:catalog_source:' + str(e.domain) };
        }
      });
    }
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

  /* ── ONE SITE PER BRAND, where values are WRITTEN and USED (2026-10-11) ──
     The operator: "if anywhere one url is being referenced in the brand, the
     same url only must be referenced ... throughout that brand for all
     context". The live workspace "Lenskart" (lenskart.com) still held a
     catalogue from delichic.co.in read off nike.in, because the rule above
     only warned or blocked ACTIVATION; a save was never refused and nothing
     took another site's values out of the record. The answers below are this
     rule's own verdict (brandCoherence's conflicts and sameBrand), never a
     second domain comparison. */

  /** The site this brand IS: its website's registrable domain ('' with no website). */
  function siteOf(record) {
    var h = hostOf(isObj(record) ? record.website : '');
    return h ? registrableDomain(h) : '';
  }
  /** Is `url` on this brand's site? A host with no identity (a CDN, a platform) and a brand with no website are not judged. */
  function urlOnSite(record, url) {
    var site = siteOf(record);
    var h = hostOf(url);
    if (!h || neutral(h) || !site) return { ok: true, judged: false, domain: h ? registrableDomain(h) : '', site: site };
    var d = registrableDomain(h);
    return { ok: sameBrand(d, site), judged: true, domain: d, site: site };
  }
  /** The fields a value read from another site is set aside from when the record is written. */
  var SET_ASIDE = ['tagline', 'logo_url', 'favicon_url', 'brand_data.legal_entity', 'brand_data.social', 'brand_data.imagery',
    'brand_data.brand_assets', 'brand_data.claims', 'brand_data.design_system', 'catalog_source', 'regions', 'asset_hosts'];
  /**
   * A store URL the person TYPED on another site is refused, with a sentence
   * naming both sites and the two ways forward. "Typed" means this save
   * introduces it: a store URL the record already held is judged by
   * setAsideForeign instead (a website change re-judges it). Null when fine.
   */
  function typedUrlRefusal(input, existing) {
    var b = isObj(input) ? input : {};
    var prev = isObj(existing) ? existing : {};
    var rec = { website: b.website !== undefined ? b.website : prev.website };
    var site = siteOf(rec);
    if (!site) return null;
    // Only a TYPED value is refused: one a read, a document or a template put
    // there carries its origin and is set aside by setAsideForeign instead.
    var bdo = isObj(b.brand_data) ? b.brand_data : (isObj(prev.brand_data) ? prev.brand_data : {});
    function machine(f) {
      var fos = isObj(bdo.field_origins) && isObj(bdo.field_origins[f]) ? bdo.field_origins[f] : null;
      var o = str((fos && fos.origin) || (isObj(bdo.field_origin) ? bdo.field_origin[f] : ''));
      return o !== '' && o !== 'user' && o !== 'default';
    }
    // A logo or icon is a FILE: it may be hosted anywhere (a CDN, an agency's
    // host) and is judged by the page it was found on, as the rule above
    // judges it. A store URL is a PAGE of a site: a catalogue import reads it.
    if (!Array.isArray(b.regions) || machine('regions')) return null;
    var had = (Array.isArray(prev.regions) ? prev.regions : []).map(function (r) { return isObj(r) ? str(r.store_url) : ''; });
    // A value this record already set aside, sent back by a form that still
    // holds it, is not typed now: it is set aside again, not refused.
    var pc = isObj(prev.brand_data) && isObj(prev.brand_data.coherence) ? prev.brand_data.coherence : {};
    (Array.isArray(pc.set_aside) ? pc.set_aside : []).forEach(function (e) {
      if (isObj(e) && e.field === 'regions' && isObj(e.value)) had.push(str(e.value.store_url));
    });
    for (var i = 0; i < b.regions.length; i++) {
      var r = b.regions[i];
      var u = isObj(r) ? str(r.store_url) : '';
      if (!u || had.indexOf(u) >= 0) continue;
      var v = urlOnSite(rec, u);
      if (v.ok) continue;
      var code = str(r.code).toUpperCase() || 'region';
      return {
        code: 'url_off_site', status: 409, field: 'regions', url: u, domain: v.domain, site: site,
        message: 'The ' + code + ' store URL ' + u + ' is on ' + v.domain + '; this brand\'s website is ' + site +
          ', and every URL a brand carries is on its own site. Make ' + v.domain + ' the website, start a new brand from it, or enter a store URL on ' + site + '.'
      };
    }
    return null;
  }
  function copyJson(v) { try { return JSON.parse(JSON.stringify(v)); } catch (_) { return null; } }
  /**
   * The record as it may be STORED: every value read from another site than
   * the website's is taken out and kept aside in brand_data.coherence.set_aside
   * (field, value, the site it came from, the reason), never applied, never
   * deleted. A conflict the person kept ("Keep this") is not set aside. Name,
   * website and design values (colours, fonts) stay, the latter withheld from
   * generation by forGeneration instead. `previous` is the stored record: its
   * history is carried, so a form that never saw it cannot erase it.
   * Returns { record, set_aside: [new] }.
   */
  function setAsideForeign(record, at, previous) {
    var rec = isObj(record) ? copyJson(record) : {};
    var pbd = isObj(previous) && isObj(previous.brand_data) && isObj(previous.brand_data.coherence) ? previous.brand_data.coherence : {};
    var history = Array.isArray(pbd.set_aside) ? pbd.set_aside : [];
    function finish(out) {
      var bd0 = isObj(rec.brand_data) ? rec.brand_data : {};
      var coh = isObj(bd0.coherence) ? bd0.coherence : {};
      var own = Array.isArray(coh.set_aside) ? coh.set_aside : [];
      var sig = function (e) { return str(e && e.field) + '|' + JSON.stringify(e && e.value); };
      var seen = [], all = [];
      history.concat(own, out).forEach(function (e) { var k = sig(e); if (seen.indexOf(k) >= 0) return; seen.push(k); all.push(e); });
      if (all.length) { coh.set_aside = all.slice(-40); bd0.coherence = coh; rec.brand_data = bd0; }
      return { record: rec, set_aside: out };
    }
    var c = brandCoherence(rec);
    if (!c.identity) return finish([]);
    var hits = c.conflicts.filter(function (x) {
      if (SET_ASIDE.indexOf(x.field) < 0) return false;
      if (x.kind === 'template') return x.severity === 'block';
      if (x.kind !== 'cross_domain') return false;
      return x.field === 'brand_data.design_system' || x.field === 'regions' || x.field === 'catalog_source' || x.severity === 'block';
    });
    if (!hits.length) return finish([]);
    var bd = isObj(rec.brand_data) ? rec.brand_data : {};
    rec.brand_data = bd;
    var when = str(at);
    var out = [];
    function keep(field, value, x) {
      out.push({ field: field, label: LABEL[field] || field, value: value, domain: x.domain, site: c.identity.domain, reason: x.message, at: when });
    }
    function doms(field) { return hits.filter(function (x) { return x.field === field; }); }
    function foreignPage(field, url) {
      // A template's values are the template's whatever their host.
      if (doms(field).some(function (x) { return str(x.domain).indexOf(':') >= 0; })) return true;
      var d = registrableDomain(hostOf(url));
      return !!d && doms(field).some(function (x) { return sameBrand(x.domain, d); });
    }
    hits.forEach(function (x) {
      var f = x.field;
      if (f === 'tagline' || f === 'logo_url' || f === 'favicon_url') { if (str(rec[f])) { keep(f, rec[f], x); rec[f] = ''; } return; }
      if (f === 'brand_data.legal_entity') { if (bd.legal_entity != null) { keep(f, bd.legal_entity, x); delete bd.legal_entity; } return; }
      if (f === 'brand_data.design_system') { if (bd.design_system != null) { keep(f, bd.design_system, x); delete bd.design_system; } return; }
      if (f === 'catalog_source') { if (isObj(rec.catalog_source) && str(rec.catalog_source.url)) { keep(f, rec.catalog_source, x); rec.catalog_source = {}; } }
    });
    function sift(field, arr, urlOf) {
      if (!Array.isArray(arr) || !doms(field).length) return arr;
      var x = doms(field)[0];
      return arr.filter(function (it) {
        if (isObj(it) && foreignPage(field, urlOf(it))) { keep(field, it, x); return false; }
        return true;
      });
    }
    bd.social = sift('brand_data.social', bd.social, function (it) { return it.source_url || ''; });
    bd.imagery = sift('brand_data.imagery', bd.imagery, function (it) { return it.page || it.url || ''; });
    bd.brand_assets = sift('brand_data.brand_assets', bd.brand_assets, function (it) { return it.found_on || it.url || ''; });
    if (doms('brand_data.claims').length && Array.isArray(bd.claims)) {
      var ex = isObj(bd.brand_extraction) && isObj(bd.brand_extraction.applied) ? bd.brand_extraction.applied : {};
      var foreign = [];
      Object.keys(ex).forEach(function (k) {
        if (/^claims\[\d+\]$/.test(k) && isObj(ex[k]) && foreignPage('brand_data.claims', ex[k].source_url)) foreign.push(scalar(ex[k].value));
      });
      var cx = doms('brand_data.claims')[0];
      bd.claims = bd.claims.filter(function (cl) {
        if (foreign.indexOf(scalar(isObj(cl) ? cl.text : cl)) >= 0) { keep('brand_data.claims', cl, cx); return false; }
        return true;
      });
    }
    if (doms('regions').length && Array.isArray(rec.regions)) {
      var rx = doms('regions')[0];
      rec.regions = rec.regions.map(function (r) {
        if (isObj(r) && str(r.store_url) && foreignPage('regions', r.store_url)) {
          keep('regions', { code: str(r.code), store_url: str(r.store_url) }, rx);
          var nr = copyJson(r); nr.store_url = ''; return nr;
        }
        return r;
      });
    }
    if (doms('asset_hosts').length && Array.isArray(rec.asset_hosts)) {
      var ax = doms('asset_hosts')[0];
      rec.asset_hosts = rec.asset_hosts.filter(function (h) {
        if (foreignPage('asset_hosts', 'https://' + str(h).replace(/^https?:\/\//, ''))) { keep('asset_hosts', str(h), ax); return false; }
        return true;
      });
    }
    return finish(out);
  }
  /**
   * ONE brand per record, and one record per brand (2026-10-11). A record
   * whose website is on one site may not be re-pointed at ANOTHER brand's site,
   * nor renamed into another brand: the answer is "start a new brand", and the
   * record is kept as it is. Null when the change is this brand's own.
   */
  function identityChangeRefusal(input, existing) {
    var b = isObj(input) ? input : {};
    var prev = isObj(existing) ? existing : {};
    var prevSite = siteOf(prev);
    if (!prevSite) return null;
    // A record is the brand AT its site when its name and its site agree:
    // the name was read from that site, or it reads as the brand that owns
    // the host. Such a record is not re-pointed at another brand's site. A
    // record whose name came from elsewhere (the outlier of a mixed record, a
    // typo'd website) may be corrected: that is the "make <domain> the
    // website" repair, and the coherence rule then lists what disagrees.
    var nsrc = sourceOf(prev, 'name');
    var nsrcHost = nsrc && nsrc.url ? hostOf(nsrc.url) : '';
    var established = nsrcHost ? sameBrand(registrableDomain(nsrcHost), prevSite)
      : (!!str(prev.name) && nameFitsHost(prev.name, hostOf(prev.website)));
    var nextUrl = b.website !== undefined ? b.website : prev.website;
    var nextSite = siteOf({ website: nextUrl });
    var name = str(prev.name) || 'this brand';
    // 2026-10-13: an UNestablished record was re-pointed freely, and that is
    // how one live row became Mamaearth, DelhiChic, Deli Chic and Lenskart in
    // turn, keeping each brand's slug, palette and assets. Re-pointing is now
    // only the repair of a mixed record: to the site its NAME was read from,
    // or a site its name fits. Anything else is another brand.
    var nameSite = nsrcHost ? registrableDomain(nsrcHost) : '';
    var repair = !established && ((nameSite && sameBrand(nameSite, nextSite)) || (!!str(prev.name) && nameFitsHost(prev.name, hostOf(nextUrl))));
    if (nextSite && !sameBrand(nextSite, prevSite) && !repair) {
      return {
        code: 'brand_change_refused', status: 409, field: 'website', domain: nextSite, site: prevSite,
        message: '"' + name + '" is the brand at ' + prevSite + '. A website on ' + nextSite + ' is another brand, so this record is not changed into it: start a new brand from ' + nextSite + ', and "' + name + '" is kept as it is.'
      };
    }
    var nn = str(b.name);
    if (nn && fold(nn) !== fold(prev.name) && str(prev.name)) {
      var host = hostOf(nextUrl);
      var shared = nameTokens(nn).some(function (w) { return nameTokens(prev.name).indexOf(w) >= 0; });
      // Any record with a website (2026-10-13, was: only one whose name fit
      // it): a new name that neither fits the site nor shares a word with the
      // old name is another brand.
      if (!nameFitsHost(nn, host) && !shared) {
        return {
          code: 'brand_change_refused', status: 409, field: 'name', domain: '', site: prevSite,
          message: '"' + nn + '" is not a name of the brand at ' + prevSite + ' ("' + name + '"). A record is one brand: start a new brand for "' + nn + '" from its own website, and "' + name + '" is kept as it is.'
        };
      }
    }
    return null;
  }
  /** Where a website points: its host without www, and its path. */
  function placeOf(url) {
    var h = hostOf(url).replace(/^www\./, '');
    var p = '';
    try { p = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(str(url)) ? str(url) : 'https://' + str(url)).pathname.replace(/\/+$/, '').toLowerCase(); } catch (_) { p = ''; }
    return { host: h, path: p };
  }
  /** Two websites on one registrable domain that are two PUBLICATIONS or
      sections of one owner (economictimes.indiatimes.com beside
      timesofindia.indiatimes.com, a /life-style/health-fitness section beside
      its home page): each on a subdomain of its own, or the same host under
      another path. www, the bare domain and another suffix are one place. */
  function distinctPlace(a, b) {
    var pa = placeOf(a), pb = placeOf(b);
    if (!pa.host || !pb.host) return false;
    if (pa.host !== pb.host) {
      return pa.host !== registrableDomain(pa.host) && pb.host !== registrableDomain(pb.host);
    }
    if (pa.path === pb.path) return false;
    // A locale path (/en, /en-gb) is the same publication in another language.
    var loc = /^\/[a-z]{2}([-_][a-z]{2})?$/;
    return !((pa.path === '' || loc.test(pa.path)) && (pb.path === '' || loc.test(pb.path)));
  }
  function sameName(a, b) { var x = fold(a), y = fold(b); return !!x && x === y; }
  /** Another record of the same account that is already this brand (same site by sameBrand), or null. */
  function duplicateBrand(record, others) {
    var site = siteOf(record);
    if (!site) return null;
    var id = str(isObj(record) ? record.id : '');
    var list = Array.isArray(others) ? others : [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!isObj(o) || (id && str(o.id) === id)) continue;
      var os = siteOf(o);
      if (os && sameBrand(os, site) && (sameName(o.name, record.name) || !distinctPlace(o.website, record.website))) {
        return {
          code: 'brand_exists', status: 409, field: 'website', existing_id: str(o.id), existing_name: str(o.name), site: site,
          message: '"' + (str(o.name) || os) + '" is already the brand at ' + os + ' in this account. Open the existing brand instead of creating a second one; one brand has one record.'
        };
      }
    }
    return null;
  }

  /** Fields a value from another site is withheld from GENERATION (and the shell's theme) on. */
  var WITHHELD = ['tagline', 'logo_url', 'favicon_url', 'brand_data.legal_entity', 'brand_data.social', 'brand_data.imagery',
    'brand_data.brand_assets', 'brand_data.claims', 'regions'];
  var DESIGN_FIELDS = ['palette.primary', 'palette.accent', 'palette.ink', 'palette.surface', 'palette.surface_alt', 'palette.muted',
    'typography.heading', 'typography.body', 'brand_data.design_system'];
  /**
   * The brand handed to GENERATION and to the shell's theme (moved here from
   * brand-runtime.coherentForGeneration so the device path answers the same).
   * Each BLOCKING identity conflict the person has neither kept nor overridden
   * with a recorded reason takes its value out (a marker where a generator
   * prints it, the item dropped from a list), and since 2026-10-11 a colour, a
   * type family or a measured design system READ FROM ANOTHER SITE is withheld
   * too: the brand's own typed values stand, else the neutral placeholder.
   * The stored record is untouched; `coherence_withheld` says what was held.
   */
  function forGeneration(brand) {
    if (!isObj(brand) || !isObj(brand.brand_data)) return brand;
    var verdict;
    try { verdict = brandCoherence(brand); } catch (_) { return brand; }
    if (!verdict || !verdict.conflicts.length) return brand;
    var coh = isObj(brand.brand_data.coherence) ? brand.brand_data.coherence : {};
    var overridden = [];
    (Array.isArray(coh.overrides) ? coh.overrides : []).forEach(function (o) {
      (isObj(o) && Array.isArray(o.conflicts) ? o.conflicts : []).forEach(function (id) { if (typeof id === 'string') overridden.push(id); });
    });
    var hits = verdict.conflicts.filter(function (x) {
      if (overridden.indexOf(x.id) >= 0) return false;
      if (x.severity === 'block' && WITHHELD.indexOf(x.field) >= 0) return true;
      return (x.kind === 'cross_domain' || (x.kind === 'template' && x.severity === 'block')) && DESIGN_FIELDS.indexOf(x.field) >= 0;
    });
    if (!hits.length) return brand;
    var name = str(brand.name) || 'this brand';
    function mark(what) { return '[DATA REQUIRED BEFORE LAUNCH: ' + what + ', ' + name + ']'; }
    function blocked(field) { return hits.filter(function (x) { return x.field === field; }).map(function (x) { return str(x.domain); }); }
    function onBlocked(field, url) {
      var ds = blocked(field);
      if (ds.some(function (d) { return d.indexOf(':') >= 0; })) return true;
      var d = registrableDomain(hostOf(url));
      return !!d && ds.some(function (b) { return sameBrand(b, d); });
    }
    function has(field) { return hits.some(function (x) { return x.field === field; }); }
    function shallow(o) { var c = {}; Object.keys(isObj(o) ? o : {}).forEach(function (k) { c[k] = o[k]; }); return c; }
    var out = shallow(brand);
    var bd = shallow(brand.brand_data);
    if (has('tagline')) out.tagline = '';
    if (has('logo_url')) out.logo_url = '';
    if (has('favicon_url')) out.favicon_url = '';
    if (has('brand_data.legal_entity')) {
      out.legal_entity = mark('legal entity');
      out.legal_name = '';
      bd.legal_entity = out.legal_entity;
    }
    function keepList(list, field, urlOf) {
      return Array.isArray(list) ? list.filter(function (x) { return !(isObj(x) && onBlocked(field, urlOf(x))); }) : list;
    }
    if (has('brand_data.social')) {
      var su = function (x) { return x.source_url || ''; };
      bd.social = keepList(bd.social, 'brand_data.social', su);
      out.social = keepList(out.social, 'brand_data.social', su);
      if (Array.isArray(out.social) && out.social.every(function (x) { return !(x && x.source_url); })) out.social = [];
    }
    if (has('brand_data.imagery')) {
      var iu = function (x) { return x.page || x.url || ''; };
      bd.imagery = keepList(bd.imagery, 'brand_data.imagery', iu);
      if (Array.isArray(out.imagery)) out.imagery = keepList(out.imagery, 'brand_data.imagery', iu);
    }
    if (has('brand_data.brand_assets')) {
      var au = function (x) { return x.found_on || x.url || ''; };
      bd.brand_assets = keepList(bd.brand_assets, 'brand_data.brand_assets', au);
      if (Array.isArray(out.brand_assets)) out.brand_assets = keepList(out.brand_assets, 'brand_data.brand_assets', au);
    }
    if (has('brand_data.claims')) {
      var applied = isObj(bd.brand_extraction) && isObj(bd.brand_extraction.applied) ? bd.brand_extraction.applied : {};
      var foreign = [];
      Object.keys(applied).forEach(function (k) {
        var a = applied[k];
        if (/^claims\[\d+\]$/.test(k) && isObj(a) && onBlocked('brand_data.claims', a.source_url || '')) foreign.push(String(a.value == null ? '' : a.value).trim());
      });
      var textOf = function (c) { return String(isObj(c) ? c.text : c || '').trim(); };
      var clean = function (list) { return Array.isArray(list) ? list.filter(function (c) { return foreign.indexOf(textOf(c)) < 0; }) : list; };
      out.claims = clean(out.claims); bd.claims = clean(bd.claims);
      if (Array.isArray(out.approved_claims)) out.approved_claims = clean(out.approved_claims);
    }
    if (has('regions') && Array.isArray(out.regions)) {
      out.regions = out.regions.map(function (r) {
        if (isObj(r) && r.store_url && onBlocked('regions', r.store_url)) { var nr = shallow(r); nr.store_url = ''; return nr; }
        return r;
      });
    }
    var pal = null, typ = null;
    DESIGN_FIELDS.forEach(function (f) {
      if (!has(f)) return;
      var leaf = f.split('.')[1];
      if (f.indexOf('palette.') === 0) { pal = pal || shallow(out.palette); delete pal[leaf]; }
      else if (f.indexOf('typography.') === 0) { typ = typ || shallow(out.typography); delete typ[leaf]; }
      else { delete bd.design_system; delete out.design_system; }
    });
    if (pal) out.palette = pal;
    if (typ) out.typography = typ;
    out.brand_data = bd;
    out.coherence_withheld = hits.map(function (x) { return { id: x.id, field: x.field, domain: x.domain }; });
    return out;
  }

  return { brandCoherence: brandCoherence, catalogIdentity: catalogIdentity, catalogRowForeign: catalogRowForeign, registrableDomain: registrableDomain, hostOf: hostOf, sameBrand: sameBrand, nameFitsHost: nameFitsHost, sourceOf: sourceOf, slugify: slugify, LABEL: LABEL, MULTI_LABEL_SUFFIXES: MULTI_LABEL_SUFFIXES,
    siteOf: siteOf, urlOnSite: urlOnSite, typedUrlRefusal: typedUrlRefusal, setAsideForeign: setAsideForeign, forGeneration: forGeneration,
    identityChangeRefusal: identityChangeRefusal, duplicateBrand: duplicateBrand };
})();
/* BRAND-COHERENCE:END */

module.exports = COHERENCE;
