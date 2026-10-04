/* eslint-env browser */
/**
 * brand-document.js - read a brand GUIDELINE DOCUMENT, in the browser.
 * ---------------------------------------------------------------------------
 * The operator's words: "ensure user can upload a document for the design
 * schema to be followed too with all details like logo file or url, etc".
 *
 * A brand book is the brand's OWN declaration of itself, so the onboarding
 * wizard reads one as a third way to start (beside "Read my site" and the
 * preset gallery): a PDF, a DOCX, an image or SVG of a style sheet, a
 * DESIGN.md (the google-labs-code/design.md format this repo already writes),
 * a JSON token file (W3C DTCG, Style Dictionary, Tokens Studio, a Figma
 * variables export) or a CSS file of custom properties - as a FILE, or by URL.
 *
 * READ, NEVER PARAPHRASED. Every value this returns is text the document
 * contains, carrying where it was found: the file (or URL), the page, the
 * line, and the verbatim line itself. Nothing is inferred to fill a gap:
 *   - a field the document does not state is reported MISSING, and the wizard
 *     prints the spec's [DATA REQUIRED BEFORE LAUNCH: ...] marker for it;
 *   - a colour named in prose without a value ("our signature red") is NOT a
 *     value: it is listed under `named_without_value`;
 *   - a colour given only as CMYK or Pantone is listed under `print_only`. A
 *     CMYK conversion is offered, labelled `DERIVED from CMYK ...`, and is
 *     never applied by "Apply everything the document states"; Pantone has no
 *     public sRGB value this app may use, so none is computed at all;
 *   - an RGB triple IS a stated screen colour, so #rrggbb is just its other
 *     notation (signal says "from the stated RGB").
 *
 * WHY THE BROWSER. Vercel caps a request body at 4.5 MB and brand books are
 * routinely larger. A file is read here and never uploaded to be parsed; only
 * a linked document the host will not hand to a browser (no CORS) is fetched
 * by the server's op=document-fetch, behind assertPublicUrl, capped at 4 MB.
 * PDF text and embedded images come from pdf.js (jsdelivr, the same CDN the
 * pages already load from; isEvalSupported:false). DOCX is a zip: unpacked
 * with the browser's own DecompressionStream, no library.
 *
 * The pure parts (the line rules, DESIGN.md, token JSON, CSS) run in Node too,
 * so a test can drive them directly as well as through the page.
 *
 * window.BrandDocument = { read(file), readUrl(url), readBytes(bytes, meta),
 *   fromLines(lines, src), parseDesignMd, parseTokens, parseCss,
 *   sanitizeSvg, hexFromCmyk, LIMITS, PDFJS, PDFJS_WORKER }
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BrandDocument = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
  var PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  // A file is read in this browser, so the cap is about the tab, not a server.
  var LIMITS = { document: 80 * 1024 * 1024, images: 16, image_min_px: 16 };

  function err(message, code) { var e = new Error(message); e.code = code || 'document_unreadable'; return e; }
  function clean(s) { return String(s == null ? '' : s).replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function quoteOf(s) { var t = clean(s); return t.length > 220 ? t.slice(0, 217) + '...' : t; }
  function prov(src, ln) { return { source: src.name || '', url: src.url || '', page: ln.page || null, line: ln.line || null, quote: quoteOf(ln.text) }; }
  function hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return ('0' + n.toString(16)).slice(-2); }
  function normHex(v) {
    var s = String(v || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (/^[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 6);
    return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : '';
  }
  function rgbHex(r, g, b) { return '#' + hex2(r) + hex2(g) + hex2(b); }
  /** A naive (uncalibrated) CMYK→sRGB conversion, ALWAYS labelled derived. */
  function hexFromCmyk(c, m, y, k) {
    var C = c / 100, M = m / 100, Y = y / 100, K = k / 100;
    return rgbHex(255 * (1 - C) * (1 - K), 255 * (1 - M) * (1 - K), 255 * (1 - Y) * (1 - K));
  }

  /* ══ 1. THE LINE RULES ═════════════════════════════════════════════════════
     Input: [{ text, page, line }]. Every rule takes text the line contains;
     none writes a value the line does not hold. */

  var HEX_RX = /(?:^|[^\w&#])#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi;
  var HEXWORD_RX = /\bhex(?:adecimal)?\b\s*[:=]?\s*#?([0-9a-f]{6})(?![0-9a-f])/gi;
  var RGB_RX = /\brgb\s*\(?\s*:?\s*(\d{1,3})\s*[,/ ]\s*(\d{1,3})\s*[,/ ]\s*(\d{1,3})\s*\)?/gi;
  var RGBL_RX = /\bR\s*:?\s*(\d{1,3})\s*[,/]?\s*G\s*:?\s*(\d{1,3})\s*[,/]?\s*B\s*:?\s*(\d{1,3})\b/g;
  var CMYK_RX = /\bcmyk\s*\(?\s*:?\s*(\d{1,3})\s*%?\s*[,/ ]\s*(\d{1,3})\s*%?\s*[,/ ]\s*(\d{1,3})\s*%?\s*[,/ ]\s*(\d{1,3})\s*%?\s*\)?/gi;
  var CMYKL_RX = /\bC\s*:?\s*(\d{1,3})\s*%?\s*[,/]?\s*M\s*:?\s*(\d{1,3})\s*%?\s*[,/]?\s*Y\s*:?\s*(\d{1,3})\s*%?\s*[,/]?\s*K\s*:?\s*(\d{1,3})\s*%?/g;
  var PANTONE_RX = /\b(?:[Pp]antone|PANTONE|PMS|pms)\s*:?\s*((?:\d{3,5}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)(?:\s?(?:C|U|CP|UP|TCX|TPG|XGC))?)\b/g;

  function valueMatches(text) {
    var out = [];
    function scan(rx, kind, fn) {
      rx.lastIndex = 0; var m;
      while ((m = rx.exec(text))) {
        var start = m.index + (kind === 'hex' && m[0].charAt(0) !== '#' ? 1 : 0);
        var v = fn(m);
        if (v) out.push({ kind: kind, start: start, end: m.index + m[0].length, value: v, raw: m[0].trim() });
        if (m.index === rx.lastIndex) rx.lastIndex++;
      }
    }
    scan(HEXWORD_RX, 'hex', function (m) { return normHex(m[1]); });
    scan(HEX_RX, 'hex', function (m) { return normHex(m[1]); });
    scan(RGB_RX, 'rgb', function (m) { var a = [+m[1], +m[2], +m[3]]; return a.every(function (x) { return x <= 255; }) ? a : null; });
    scan(RGBL_RX, 'rgb', function (m) { var a = [+m[1], +m[2], +m[3]]; return a.every(function (x) { return x <= 255; }) ? a : null; });
    scan(CMYK_RX, 'cmyk', function (m) { var a = [+m[1], +m[2], +m[3], +m[4]]; return a.every(function (x) { return x <= 100; }) ? a : null; });
    scan(CMYKL_RX, 'cmyk', function (m) { var a = [+m[1], +m[2], +m[3], +m[4]]; return a.every(function (x) { return x <= 100; }) ? a : null; });
    scan(PANTONE_RX, 'pantone', function (m) { return clean(m[1]); });
    out.sort(function (a, b) { return a.start - b.start || b.end - a.end; });
    // Overlaps (HEX D0473E seen by two rules) keep the first, widest.
    var kept = [];
    out.forEach(function (v) { var last = kept[kept.length - 1]; if (!last || v.start >= last.end) kept.push(v); });
    return kept;
  }
  var VALUE_WORDS = /\b(hex(?:adecimal)?|rgb|cmyk|pantone|pms|colou?r(?:s)?|value|code|swatch|screen|print|web|digital)\b|[#:=|,;()\-–—•·/]|\bR\b|\bG\b|\bB\b/gi;
  function labelOf(s) { return clean(String(s || '').replace(VALUE_WORDS, ' ')); }
  function meaningful(label) { return /[A-Za-z]{2,}/.test(label); }

  var ROLE_RULES = [
    ['surface_alt', /\b(card|panel|tile|secondary background|alt(?:ernate)? background|surface alt)\b/],
    ['muted', /\b(muted|secondary text|caption|subtle|supporting text|grey text|gray text|meta text)\b/],
    ['ink', /\b(text|ink|body copy|copy colou?r|font colou?r|typography colou?r|foreground)\b/],
    ['surface', /\b(background|backdrop|page|surface|canvas|paper|base colou?r)\b/],
    ['ok', /\b(success|positive|confirmation)\b/],
    ['warn', /\b(warning|caution)\b/],
    ['err', /\b(error|danger|destructive)\b/],
    ['primary', /\b(primary|main|brand colou?r|core colou?r|hero colou?r|signature colou?r)\b/],
    ['accent', /\b(accent|highlight|secondary|tertiary|call to action|cta)\b/],
  ];
  var ACCENT_SCORE = [[/\baccent\b/, 4], [/\bhighlight\b/, 3], [/\b(call to action|cta)\b/, 3], [/\bsecondary\b/, 2], [/\btertiary\b/, 1]];
  function roleOf(label) {
    var l = String(label || '').toLowerCase();
    for (var i = 0; i < ROLE_RULES.length; i++) if (ROLE_RULES[i][1].test(l)) return ROLE_RULES[i][0];
    return '';
  }
  function accentScore(label) {
    var l = String(label || '').toLowerCase();
    for (var i = 0; i < ACCENT_SCORE.length; i++) if (ACCENT_SCORE[i][0].test(l)) return ACCENT_SCORE[i][1];
    return 0;
  }
  var COLOUR_WORDS = /\b(red|blue|green|yellow|orange|purple|violet|pink|black|white|grey|gray|navy|teal|gold|golden|silver|brown|beige|cream|magenta|cyan|maroon|burgundy|vermilion|crimson|indigo|turquoise|coral|lime|olive|charcoal|ivory|sand|mint|lavender|scarlet|amber|emerald|ochre)\b/i;

  /* Typography */
  var WEIGHTS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, book: 400, normal: 400, roman: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, heavy: 800, black: 900 };
  var TYPE_LABEL_RX = /^(?:(?:primary|secondary|brand|display|heading|headings|headline|headlines|title|titles|body|body copy|body text|paragraph|paragraphs|copy|text|mono|monospace|code|caption|captions|button|buttons|cta|ui)\s*)*(?:typeface|typefaces|font|fonts|family|type|typography)?$/i;
  var TYPE_WORD_RX = /\b(typeface|font|family|heading|headings|headline|headlines|display|title|body|paragraph|copy|mono|monospace|code|typography)\b/i;
  var FAMILY_STOP = /^(the|our|we|use|used|for|in|at|by|with|and|or|is|are|a|an|all|every|throughout|only|always|never|on|of|to|as|from|google|fonts?|typeface|family|regular|italic|oblique|sans|serif)$/i;
  var GENERIC_FAMILIES = /^(sans-serif|serif|monospace|system-ui|cursive|fantasy|ui-sans-serif|ui-serif|ui-monospace)$/i;

  function typeRole(label) {
    var l = String(label || '').toLowerCase();
    if (/\b(mono|monospace|code)\b/.test(l)) return 'mono';
    if (/\b(heading|headings|headline|headlines|display|title|titles|h[1-3])\b/.test(l)) return 'heading';
    if (/\b(body|paragraph|paragraphs|copy|text)\b/.test(l)) return 'body';
    if (/\bprimary\b/.test(l)) return 'heading';
    if (/\bsecondary\b/.test(l)) return 'body';
    if (/\b(button|buttons|cta|caption|captions|ui)\b/.test(l)) return '';
    if (/\b(typeface|font|fonts|family|type|typography)\b/.test(l)) return 'all';
    return '';
  }
  /** "Montserrat Bold 48/56px" -> { family, weights, size, line_height, google } */
  function parseFontSpec(value) {
    var v = clean(value).replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
    if (!v || /^[a-z]/.test(v)) return null;           // prose, not a name
    var stackMatch = /^([A-Z][\w .'&-]*?)\s*,\s*([^,]+(?:,[^,]+)*)$/.exec(v);
    var tokens = v.split(/\s+/);
    var fam = [];
    for (var i = 0; i < tokens.length && fam.length < 4; i++) {
      var t = tokens[i].replace(/[,;:)(]+$/, '');
      if (!t) break;
      if (WEIGHTS[t.toLowerCase()] || /^\d{3}$/.test(t) || /^\d/.test(t) && !fam.length) break;
      if (/^\d+(\.\d+)?(px|pt|rem|em|%)?(\/\d+(\.\d+)?(px|pt|rem|em|%)?)?$/.test(t)) break;
      if (FAMILY_STOP.test(t) && fam.length) break;
      if (FAMILY_STOP.test(t) && !fam.length) return null;
      if (!/^[A-Z0-9][A-Za-z0-9'&.-]*$/.test(t)) break;
      fam.push(t);
      if (/[,;]$/.test(tokens[i])) break;
    }
    if (!fam.length) return null;
    var family = fam.join(' ');
    if (GENERIC_FAMILIES.test(family) || family.length < 2) return null;
    var weights = [];
    var re = /\b(thin|hairline|extra\s?light|ultra\s?light|light|regular|book|normal|roman|medium|semi\s?bold|demi\s?bold|bold|extra\s?bold|ultra\s?bold|heavy|black)\b|\b([1-9]00)\b/gi, m;
    while ((m = re.exec(v))) {
      var w = m[2] ? +m[2] : WEIGHTS[m[1].toLowerCase().replace(/\s+/g, '')];
      if (w && weights.indexOf(w) < 0) weights.push(w);
    }
    var size = /(\d+(?:\.\d+)?)\s*(px|pt|rem|em)\b/i.exec(v);
    var pair = /\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(px|pt)?\b/.exec(v);
    var lh = /line[\s-]?height\s*:?\s*(\d+(?:\.\d+)?\s*(?:px|pt|%|em|rem)?)/i.exec(v);
    var ls = /(?:letter[\s-]?spacing|tracking)\s*:?\s*(-?\d+(?:\.\d+)?\s*(?:px|pt|em|%)?)/i.exec(v);
    return {
      family: family,
      stack: stackMatch ? v : '',
      weights: weights.sort(function (a, b) { return a - b; }),
      size: pair ? pair[1] + (pair[3] || (size ? size[2] : 'px')) : (size ? size[1] + size[2].toLowerCase() : ''),
      line_height: pair ? pair[2] + (pair[3] || (size ? size[2] : 'px')) : (lh ? clean(lh[1]) : ''),
      letter_spacing: ls ? clean(ls[1]) : '',
      google: /google\s*fonts?/i.test(v),
    };
  }

  var BULLET_RX = /^\s*(?:[•·▪▸►‣◦\-*–—✓✔✗✘×]|\d+[.)])\s+/;
  function splitList(v) {
    return String(v || '').split(/[,;•·|]|\s{2,}|\s\/\s/)
      .map(function (x) { return clean(x).replace(/^["'“”‘’]+|["'“”‘’.]+$/g, '').trim(); })
      .filter(function (x) { return x && x.length <= 60 && /[A-Za-z]/.test(x); })
      .slice(0, 40);
  }
  function labelled(text, rx) {
    // "<label><sep><value>" where the label matches rx exactly.
    var m = /^\s*([^:–—=]{1,48}?)\s*(?::|–|—|=|\s-\s)\s*(.+)$/.exec(text);
    if (!m) return null;
    var label = clean(m[1]).toLowerCase().replace(/^[•·\-*\d.)\s]+/, '');
    return rx.test(label) ? { label: label, value: clean(m[2]) } : null;
  }
  function isShortLabel(text) {
    var t = clean(text);
    return !!t && t.length <= 48 && t.split(' ').length <= 6 && !/[.!?]$/.test(t) && !/\d{2,}/.test(t) && /[A-Za-z]/.test(t);
  }

  var RX = {
    name: /^(brand name|brand|company name|name of the brand)$/,
    tagline: /^(tagline|strapline|slogan|brand line|brand promise|motto|claim line)$/,
    website: /^(website|web|site|url|web address|website address|online)$/,
    legal: /^(legal entity|legal name|registered name|registered company|registered entity|company registration|entity)$/,
    tone: /^(tone|tone of voice|voice|brand voice|brand personality|personality|our voice)$/,
    preferred: /^(words we use|words we love|words we like|preferred words|preferred vocabulary|preferred terms|preferred language|vocabulary|do say|we say|say|use these words|on-brand words)$/,
    banned: /^(banned|banned words|banned phrases|banned terms|words we don'?t use|words we never use|words we do not use|never say|don'?t say|do not say|avoid|avoid saying|avoid these words|forbidden|forbidden words|never use|blocklist|off-brand words)$/,
    claims: /^(claims|approved claims|verifiable claims|proof points|key claims|what we can say)$/,
    imagery: /^(image treatment|imagery|photography|photo style|photography style|image style)$/,
  };
  var FACT_LABELS = /^(brand name|brand|company name|tagline|strapline|slogan|website|web|url|legal entity|legal name|tone|tone of voice|voice|claims|words we use|banned|banned words)$/;
  var COMPONENT_LINE = /\b(button|buttons|cta|hover|card|cards|input|inputs|link|links|border|borders|shadow|shadows)\b/;
  var LEGAL_SUFFIX = /\b(private limited|pvt\.? ltd\.?|limited|ltd\.?|llc|l\.l\.c\.|inc\.?|incorporated|gmbh|s\.a\.|plc|llp|pty\.? ltd\.?|b\.v\.|s\.r\.l\.|co\.,? ltd\.?)(?=\W|$)/i;
  var LENGTH_RX = /(-?\d+(?:\.\d+)?)\s*(px|pt|rem|em|mm|cm|%)\b/i;

  function newReport(src, format) {
    return {
      ok: true, format: format, source: { name: src.name || '', url: src.url || '', size: src.size || 0, type: src.type || '' },
      pages: 0, lines_read: 0,
      fields: {
        name: null, tagline: null, website: null, legal_entity: null,
        palette: {}, palette_alternatives: [], extra: [], swatches: [], drawn_swatches: [],
        named_without_value: [], print_only: [],
        typography: {}, type_scale: [], fonts: [],
        logo: { images: [], rules: [] },
        voice: { tone: null, preferred: [], banned: [], no_em_dashes: null },
        claims: [],
        components: {}, rounded: {}, spacing: {}, rules: {},
      },
      images: [], notes: [], limits: [],
    };
  }

  function setOnce(obj, key, v) { if (!obj[key]) obj[key] = v; else return false; return true; }
  function comp(rep, name, propName, value, p) {
    var c = rep.fields.components[name] = rep.fields.components[name] || {};
    if (!c[propName]) c[propName] = { value: value, prov: p };
  }

  /** The heart: one pass over the lines. */
  function fromLines(lines, src, rep) {
    rep = rep || newReport(src || {}, 'text');
    src = src || {};
    var f = rep.fields;
    var swatches = [];
    var cur = null;            // swatch being filled
    var pendingLabel = null;   // { text, ln } from label-only line(s)
    var pendingType = null;    // { role, ln }
    var listMode = null;       // { kind: 'preferred'|'banned'|'claims'|'logo-misuse', ln }
    var sectionTone = null;    // ln of a "Tone of voice" heading
    var sectionImagery = null;

    function finish() { if (cur && (cur.hex || cur.rgb || cur.cmyk || cur.pantone)) swatches.push(cur); cur = null; }
    function startSwatch(label, ln) { finish(); cur = { label: clean(label), ln: ln, hex: '', rgb: null, cmyk: null, pantone: '' }; }

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var text = clean(ln.text);
      if (!text) { pendingLabel = null; listMode = null; continue; }
      rep.lines_read++;
      var p = prov(src, ln);
      var lower = text.toLowerCase();

      /* ── colours ── */
      // A component rule ("Buttons: background #1A6B3C") states a component's
      // colour, not a palette role: it is read by componentsFrom() only.
      var vals = COMPONENT_LINE.test(lower) ? [] : valueMatches(text);
      var compVals = vals.length ? vals : valueMatches(text);
      if (vals.length) {
        var prevEnd = 0;
        vals.forEach(function (v, idx) {
          var gap = labelOf(text.slice(prevEnd, v.start));
          prevEnd = v.end;
          if (meaningful(gap)) startSwatch(gap, ln);
          else if (idx === 0 && !cur && pendingLabel) { startSwatch(pendingLabel.text, pendingLabel.ln); cur.lines = [pendingLabel.ln]; }
          else if (!cur) startSwatch('', ln);
          var slot = v.kind === 'hex' ? 'hex' : v.kind;
          if (cur[slot]) { var keep = cur.label; startSwatch(keep && idx > 0 ? '' : keep, ln); }
          cur[slot] = v.value;
          cur.ln = cur.ln || ln;
          cur.lines = cur.lines || [];
          cur.lines.push(ln);
        });
        pendingLabel = null;
        // A colour line can still be a component rule ("Buttons: #D0473E").
      } else {
        if (cur && !isShortLabel(text)) finish();
        if (isShortLabel(text) && !labelled(text, FACT_LABELS)) {
          finish();
          pendingLabel = pendingLabel && (i - pendingLabel.i) === 1 && pendingLabel.text.split(' ').length <= 4
            ? { text: pendingLabel.text + ' ' + text, ln: ln, i: i } : { text: text, ln: ln, i: i };
        } else pendingLabel = null;
        // A role named in prose with a colour word and no value: NOT a value.
        if (!isShortLabel(text) && COLOUR_WORDS.test(text) && /colou?r/i.test(text)) {
          var role = roleOf(lower);
          if (role) f.named_without_value.push({ role: role, words: (text.match(COLOUR_WORDS) || [''])[0], prov: p });
        }
      }

      /* ── labelled facts ── */
      var hit;
      if ((hit = labelled(text, RX.name)) && hit.value.length <= 60 && !/[.!?]$/.test(hit.value) && !valueMatches(hit.value).length) setOnce(f, 'name', { value: hit.value.replace(/^["'“”]+|["'“”]+$/g, ''), prov: p });
      if ((hit = labelled(text, RX.tagline))) setOnce(f, 'tagline', { value: hit.value.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').slice(0, 300), prov: p });
      if ((hit = labelled(text, RX.website)) && /^(https?:\/\/|www\.)\S+$|^[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(hit.value)) setOnce(f, 'website', { value: /^https?:\/\//i.test(hit.value) ? hit.value : 'https://' + hit.value.replace(/^\/+/, ''), prov: p });
      if ((hit = labelled(text, RX.legal)) && hit.value.length <= 200) setOnce(f, 'legal_entity', { value: hit.value, prov: p });
      else if (!f.legal_entity && /©|\(c\)|copyright|registered/i.test(text) && LEGAL_SUFFIX.test(text)) {
        var lm = /(?:©|\(c\)|copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s*,?\s*(.+?(?:private limited|pvt\.? ltd\.?|limited|ltd\.?|llc|inc\.?|incorporated|gmbh|plc|llp|pty\.? ltd\.?|b\.v\.|s\.r\.l\.))(?=\W|$)/i.exec(text);
        if (lm) f.legal_entity = { value: clean(lm[1]), prov: p };
      }

      /* ── voice ── */
      if ((hit = labelled(text, RX.tone)) && hit.value.length <= 300) setOnce(f.voice, 'tone', { value: hit.value, prov: p });
      else if (sectionTone && !f.voice.tone && !isShortLabel(text) && text.length <= 300 && !BULLET_RX.test(text)) { f.voice.tone = { value: text, prov: p }; sectionTone = null; }
      if (RX.tone.test(lower.replace(/[:.]$/, '')) && isShortLabel(text)) sectionTone = ln;
      if ((hit = labelled(text, RX.preferred))) splitList(hit.value).forEach(function (w) { f.voice.preferred.push({ value: w, prov: p }); });
      if ((hit = labelled(text, RX.banned))) splitList(hit.value).forEach(function (w) { f.voice.banned.push({ value: w, prov: p }); });
      if ((hit = labelled(text, RX.claims))) hit.value.split(/;/).map(clean).filter(Boolean).forEach(function (c) { f.claims.push({ value: c, prov: p }); });
      if (/\bem[\s-]?dash(es)?\b/i.test(text) && /\b(never|no|avoid|don'?t|do not|without)\b/i.test(text)) setOnce(f.voice, 'no_em_dashes', { value: true, prov: p });

      // Lists under a heading: bullets until the next non-bullet line.
      var headingKey = lower.replace(/[:.]$/, '').trim();
      if (isShortLabel(text) && !vals.length) {
        listMode = RX.preferred.test(headingKey) ? { kind: 'preferred' } : RX.banned.test(headingKey) ? { kind: 'banned' }
          : RX.claims.test(headingKey) ? { kind: 'claims' } : null;
      } else if (listMode && BULLET_RX.test(ln.text || text)) {
        var item = clean(String(ln.text || text).replace(BULLET_RX, ''));
        if (listMode.kind === 'claims') { if (item.length <= 300) f.claims.push({ value: item, prov: p }); }
        else splitList(item).forEach(function (w) { f.voice[listMode.kind].push({ value: w, prov: p }); });
      } else if (listMode && !BULLET_RX.test(ln.text || text)) listMode = null;

      /* ── typography ── */
      var tl = labelled(text, /./);
      if (tl && TYPE_WORD_RX.test(tl.label) && TYPE_LABEL_RX.test(tl.label) && !vals.length) {
        var role2 = typeRole(tl.label);
        var spec = parseFontSpec(tl.value);
        if (spec && role2) takeType(f, rep, role2, spec, p, tl.label);
        pendingType = null;
      } else if (isShortLabel(text) && TYPE_WORD_RX.test(lower) && TYPE_LABEL_RX.test(lower.replace(/[:.]$/, '')) && !vals.length) {
        pendingType = { role: typeRole(lower), ln: ln, i: i };
      } else if (pendingType && i - pendingType.i <= 2 && !vals.length) {
        var spec2 = parseFontSpec(text);
        if (spec2 && pendingType.role) { takeType(f, rep, pendingType.role, spec2, prov(src, { page: ln.page, line: ln.line, text: clean(pendingType.ln.text) + ' / ' + text }), clean(pendingType.ln.text)); pendingType = null; }
      }

      /* ── logo rules ── */
      if (/clear\s*-?\s*space|clearspace|exclusion (zone|area)|safe (area|zone)|breathing room|minimum space/i.test(text) && /logo|mark|symbol|wordmark|clear/i.test(text)) {
        var cs = LENGTH_RX.exec(text);
        f.logo.rules.push({ kind: 'clear-space', text: text, value: cs ? cs[1] + cs[2] : '', prov: p });
        if (!f.rules['logo-clear-space']) f.rules['logo-clear-space'] = { value: text, prov: p };
        if (cs) comp(rep, 'logo', 'clearSpace', cs[1] + cs[2], p);
      }
      if (/\bmin(?:imum)?\.?\s*(?:size|width|height|reproduction)|smallest (?:size|use)/i.test(text) && /logo|mark|symbol|wordmark|min/i.test(text)) {
        var ms = LENGTH_RX.exec(text);
        f.logo.rules.push({ kind: 'min-size', text: text, value: ms ? ms[1] + ms[2] : '', prov: p });
        if (!f.rules['logo-min-size']) f.rules['logo-min-size'] = { value: text, prov: p };
        if (ms) comp(rep, 'logo', 'minSize', ms[1] + ms[2], p);
      }
      if (/\blogo\b/i.test(text) && /\b(don'?t|do not|never|avoid)\b/i.test(text) && text.length <= 240) f.logo.rules.push({ kind: 'misuse', text: text, value: '', prov: p });

      /* ── components: buttons, cards, radius, spacing, container, imagery ── */
      componentsFrom(rep, text, lower, p, compVals);
      if ((hit = labelled(text, RX.imagery)) && hit.value.length > 3) setOnce(f.rules, 'image-treatment', { value: hit.value, prov: p });
      else if (sectionImagery && !f.rules['image-treatment'] && !isShortLabel(text)) { f.rules['image-treatment'] = { value: text, prov: p }; sectionImagery = null; }
      if (isShortLabel(text) && RX.imagery.test(headingKey)) sectionImagery = ln;
    }
    finish();
    resolveSwatches(rep, swatches);
    return rep;
  }

  function takeType(f, rep, role, spec, p, label) {
    var rec = { family: spec.family, stack: spec.stack, weights: spec.weights, google: spec.google, size: spec.size, line_height: spec.line_height, letter_spacing: spec.letter_spacing, label: label, prov: p };
    var roles = role === 'all' ? ['heading', 'body'] : [role];
    roles.forEach(function (r) {
      if (!f.typography[r]) f.typography[r] = Object.assign({ applies: role === 'all' ? 'one typeface named for everything' : '' }, rec);
      else if (f.typography[r].family !== spec.family && role !== 'all') rep.notes.push('The document names more than one ' + r + ' typeface; the first is used (' + f.typography[r].family + '), "' + spec.family + '" is listed too (' + where(p) + ').');
    });
    if (spec.size || spec.line_height) rep.fields.type_scale.push({ slot: role === 'all' ? 'body' : role, family: spec.family, size: spec.size, line_height: spec.line_height, letter_spacing: spec.letter_spacing, weight: spec.weights[0] ? String(spec.weights[0]) : '', prov: p });
  }
  function where(p) { return [p.source, p.page ? 'p.' + p.page : '', p.line ? 'l.' + p.line : ''].filter(Boolean).join(' '); }

  function componentsFrom(rep, text, lower, p, vals) {
    var f = rep.fields;
    var isButton = /\b(button|buttons|cta|call to action)\b/.test(lower);
    var name = isButton ? (/\b(secondary|ghost|outline)\b/.test(lower) ? 'button-secondary' : 'button-primary') : (/\b(card|cards|tile|panel)\b/.test(lower) ? 'card' : (/\b(input|field|form)\b/.test(lower) ? 'input' : ''));
    if (isButton && /\bhover\b/.test(lower)) name += '-hover';
    var len = LENGTH_RX.exec(text);
    if (/(corner\s*)?radius|rounded|corners?\b|border-radius/.test(lower) && len) {
      if (name) comp(rep, name, 'rounded', len[1] + len[2].toLowerCase(), p);
      else if (!f.rounded.default) f.rounded.default = { value: len[1] + len[2].toLowerCase(), prov: p };
    }
    if (name) {
      // Colours by the word in front of them: "background #D0473E, text #FFFFFF".
      var bg = /(?:background|fill|bg)(?:\s*colou?r)?\s*[:=]?\s*(?:is\s*)?(#[0-9a-f]{3,6}\b)/i.exec(text);
      var fg = /(?:text|label|font|type)(?:\s*colou?r)?\s*[:=]?\s*(?:is\s*)?(#[0-9a-f]{3,6}\b)/i.exec(text);
      if (bg && normHex(bg[1])) comp(rep, name, 'backgroundColor', normHex(bg[1]), p);
      else if (vals.length === 1 && vals[0].kind === 'hex' && !fg) comp(rep, name, 'backgroundColor', vals[0].value, p);
      if (fg && normHex(fg[1])) comp(rep, name, 'textColor', normHex(fg[1]), p);
      if (!bg && vals.length === 0) {
        var ref = /\b(primary|accent|secondary)\s+colou?r\b/.exec(lower);
        if (ref && /\b(button|buttons|cta)\b.*\b(use|uses|are|is|in|filled|fill)\b|\b(use|uses|are|is|in|filled|fill)\b.*\b(button|buttons|cta)\b/.test(lower)) comp(rep, name, 'backgroundColor', '{colors.' + (ref[1] === 'secondary' ? 'accent' : ref[1]) + '}', p);
      }
      var pad = /padding\s*:?\s*((?:\d+(?:\.\d+)?\s*(?:px|rem|em|pt)\s*){1,4})/i.exec(text);
      if (pad) comp(rep, name, 'padding', clean(pad[1]), p);
      var h = /height\s*:?\s*(\d+(?:\.\d+)?\s*(?:px|rem|em|pt))/i.exec(text);
      if (h) comp(rep, name, 'height', clean(h[1]).replace(/\s+/g, ''), p);
      if (/\b(uppercase|all caps|capitali[sz]ed)\b/.test(lower) && isButton) comp(rep, name, 'textTransform', 'uppercase', p);
    }
    if (/\b(spacing|baseline grid|base unit|grid unit|spacing unit|gutter)\b/.test(lower) && len) {
      var key = /gutter/.test(lower) ? 'gutter' : 'base';
      if (!f.spacing[key]) f.spacing[key] = { value: len[1] + len[2].toLowerCase(), prov: p };
    }
    if (/\b(container|max(?:imum)?[\s-]width|content width|layout width|page width|grid width)\b/.test(lower) && len && /px|rem|em/.test(len[2])) comp(rep, 'container', 'width', len[1] + len[2].toLowerCase(), p);
  }

  /** Swatches -> roles. A role takes a STATED screen value (hex, or RGB) only. */
  function resolveSwatches(rep, swatches) {
    var f = rep.fields;
    var byRole = {};
    swatches.forEach(function (s) {
      var hex = s.hex || (s.rgb ? rgbHex(s.rgb[0], s.rgb[1], s.rgb[2]) : '');
      var from = s.hex ? 'hex' : (s.rgb ? 'rgb' : '');
      var role = roleOf(s.label);
      var p = prov({ name: rep.source.name, url: rep.source.url }, { page: s.ln.page, line: s.ln.line, text: (s.lines || [s.ln]).map(function (l) { return clean(l.text); }).filter(function (t, i, a) { return a.indexOf(t) === i; }).join(' / ') });
      var rec = { hex: hex, from: from, label: s.label, role: role, rgb: s.rgb, cmyk: s.cmyk, pantone: s.pantone, prov: p };
      f.swatches.push(rec);
      if (!hex) {
        // CMYK or Pantone only: a print value is not a screen value.
        f.print_only.push({
          label: s.label, role: role, cmyk: s.cmyk, pantone: s.pantone, prov: p,
          derived: s.cmyk ? { hex: hexFromCmyk(s.cmyk[0], s.cmyk[1], s.cmyk[2], s.cmyk[3]), note: 'DERIVED from CMYK ' + s.cmyk.join(' ') + ' by a naive uncalibrated conversion. Not stated by the document, and print colour does not convert to one screen value; use it only if you confirm it.' } : null,
          note: s.pantone && !s.cmyk ? 'Pantone ' + s.pantone + ' is stated with no screen value. Pantone\'s own sRGB references are licensed data this app does not hold, so no hex is computed.' : '',
        });
        return;
      }
      if (!role) { f.extra.push({ name: s.label || 'Unnamed colour', hex: hex, prov: p }); return; }
      (byRole[role] = byRole[role] || []).push(rec);
    });
    Object.keys(byRole).forEach(function (role) {
      var list = byRole[role];
      if (role === 'accent') list = list.slice().sort(function (a, b) { return accentScore(b.label) - accentScore(a.label); });
      f.palette[role] = list[0];
      list.slice(1).forEach(function (r) {
        if (r.hex === list[0].hex) return;
        f.palette_alternatives.push(r);
        f.extra.push({ name: r.label || role, hex: r.hex, prov: r.prov });
      });
    });
    // A role named in prose WITH a stated value elsewhere is not "without a value".
    f.named_without_value = f.named_without_value.filter(function (n) { return !f.palette[n.role]; });
  }

  /* ══ 2. DESIGN.md (google-labs-code/design.md) ════════════════════════════ */

  /** A YAML subset: nested maps, scalars, comments, `- ` lists. Flat paths with line numbers. */
  function yamlFlat(textIn, lineOffset) {
    var out = {};
    var stack = [{ indent: -1, path: [] }];
    var listIdx = {};
    String(textIn || '').split(/\r?\n/).forEach(function (raw, n) {
      if (!raw.trim() || /^\s*#/.test(raw)) return;
      var indent = raw.match(/^\s*/)[0].length;
      var body = raw.trim();
      var comment = '';
      var cm = /\s#\s?(.*)$/.exec(body.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, function (q) { return q.replace(/#/g, '\u0000'); }));
      if (cm) { comment = cm[1].replace(/\u0000/g, '#'); body = body.slice(0, cm.index).trim(); }
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      var parent = stack[stack.length - 1].path;
      if (body.indexOf('- ') === 0 || body === '-') {
        var key = parent.join('.');
        listIdx[key] = (listIdx[key] == null ? -1 : listIdx[key]) + 1;
        var itemPath = parent.concat(String(listIdx[key]));
        var rest = body.replace(/^-\s*/, '');
        stack.push({ indent: indent, path: itemPath });
        var kv0 = /^([^:]+):\s*(.*)$/.exec(rest);
        if (kv0) {
          var p0 = itemPath.concat(kv0[1].trim());
          if (kv0[2]) out[p0.join('.')] = { value: unq(kv0[2]), line: n + 1 + (lineOffset || 0), comment: comment, raw: raw.trim() };
          stack.push({ indent: indent + 2, path: itemPath });
        } else if (rest) out[itemPath.join('.')] = { value: unq(rest), line: n + 1 + (lineOffset || 0), comment: comment, raw: raw.trim() };
        return;
      }
      var kv = /^("[^"]+"|'[^']+'|[^:]+):\s*(.*)$/.exec(body);
      if (!kv) return;
      var k = unq(kv[1].trim());
      var path = parent.concat(k);
      if (kv[2] === '' || kv[2] === '|' || kv[2] === '>') { stack.push({ indent: indent, path: path }); return; }
      out[path.join('.')] = { value: unq(kv[2]), line: n + 1 + (lineOffset || 0), comment: comment, raw: raw.trim() };
    });
    return out;
  }
  function unq(v) {
    var s = String(v == null ? '' : v).trim();
    if (/^"(.*)"$/.test(s)) { try { return JSON.parse(s); } catch (_) { return s.slice(1, -1); } }
    if (/^'(.*)'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
    return s;
  }

  var DMD_COLOR_ROLE = {
    primary: 'primary', secondary: 'accent', accent: 'accent', tertiary: '',
    neutral: 'ink', ink: 'ink', text: 'ink', 'on-surface': 'ink', foreground: 'ink',
    background: 'surface', surface: 'surface', 'surface-container': 'surface_alt', 'surface-variant': 'surface_alt', card: 'surface_alt',
    muted: 'muted', 'on-surface-variant': 'muted', success: 'ok', warning: 'warn', error: 'err',
  };
  function parseDesignMd(textIn, src) {
    src = src || {};
    var rep = newReport(src, 'design-md');
    var f = rep.fields;
    var all = String(textIn || '').split(/\r?\n/);
    var fmEnd = -1;
    if (/^---\s*$/.test(all[0] || '')) for (var i = 1; i < all.length; i++) if (/^---\s*$/.test(all[i])) { fmEnd = i; break; }
    if (fmEnd > 0) {
      var flat = yamlFlat(all.slice(1, fmEnd).join('\n'), 1);
      var P = function (e) { return prov(src, { page: null, line: e.line, text: e.raw }); };
      Object.keys(flat).forEach(function (k) {
        var e = flat[k];
        var parts = k.split('.');
        var derived = /derived/i.test(e.comment);
        if (k === 'name' && e.value) f.name = { value: String(e.value), prov: P(e) };
        else if (parts[0] === 'colors' && parts.length === 2) {
          var hex = normHex(e.value);
          var key = parts[1];
          if (!hex) return;
          if (derived || /^on-/.test(key) && key !== 'on-surface' || /-text$/.test(key)) { rep.notes.push('Skipped ' + k + ' (' + (derived ? 'marked DERIVED in the file' : 'a contrast token derived from another colour') + ').'); return; }
          var role = Object.prototype.hasOwnProperty.call(DMD_COLOR_ROLE, key) ? DMD_COLOR_ROLE[key] : roleOf(key.replace(/[-_]/g, ' '));
          var rec = { hex: hex, from: 'hex', label: key, role: role, prov: P(e) };
          f.swatches.push(rec);
          if (role && !f.palette[role]) f.palette[role] = rec;
          else f.extra.push({ name: key, hex: hex, prov: P(e) });
        } else if (parts[0] === 'typography' && parts.length === 3) {
          var tok = parts[1], prop = parts[2];
          var slot = /^(headline|display|title|heading|h[1-6])/i.test(tok) ? 'heading' : (/^(body|paragraph|text)/i.test(tok) ? 'body' : (/^(mono|code)/i.test(tok) ? 'mono' : ''));
          var row = rep.fields.type_scale.filter(function (r) { return r.token === tok; })[0];
          if (!row) { row = { token: tok, slot: slot, family: '', size: '', line_height: '', letter_spacing: '', weight: '', prov: P(e) }; rep.fields.type_scale.push(row); }
          if (prop === 'fontFamily') row.family = String(e.value).split(',')[0].replace(/["']/g, '').trim();
          if (prop === 'fontSize') row.size = String(e.value);
          if (prop === 'lineHeight') row.line_height = String(e.value);
          if (prop === 'letterSpacing') row.letter_spacing = String(e.value);
          if (prop === 'fontWeight') row.weight = String(e.value);
          if (prop === 'fontFamily' && slot && !f.typography[slot] && row.family) {
            f.typography[slot] = { family: row.family, stack: String(e.value).indexOf(',') > 0 ? String(e.value) : '', weights: [], google: false, size: '', line_height: '', letter_spacing: '', label: 'typography.' + tok, prov: P(e) };
          }
        } else if ((parts[0] === 'rounded' || parts[0] === 'spacing') && parts.length === 2) {
          f[parts[0]][parts[1]] = { value: String(e.value), prov: P(e) };
        } else if (parts[0] === 'components' && parts.length === 3) {
          comp(rep, parts[1], parts[2], String(e.value), P(e));
        }
      });
      // Weights a typography scale names, per slot.
      ['heading', 'body', 'mono'].forEach(function (slot) {
        var t = f.typography[slot]; if (!t) return;
        rep.fields.type_scale.forEach(function (r) { if (r.slot === slot && r.family === t.family && /^\d{3}$/.test(r.weight) && t.weights.indexOf(+r.weight) < 0) t.weights.push(+r.weight); });
        t.weights.sort();
      });
    }
    // The prose sections are read by the same line rules.
    var bodyStart = fmEnd > 0 ? fmEnd + 1 : 0;
    var lines = all.slice(bodyStart).map(function (t, j) { return { text: t.replace(/^#+\s*/, '').replace(/\*\*|__|`/g, ''), page: null, line: bodyStart + j + 1 }; });
    var fromBody = fromLines(lines, src, newReport(src, 'design-md'));
    merge(rep, fromBody);
    return rep;
  }

  /** Fold `b` into `a`: `a`'s values win (the structured part outranks prose). */
  function merge(a, b) {
    var fa = a.fields, fb = b.fields;
    ['name', 'tagline', 'website', 'legal_entity'].forEach(function (k) { if (!fa[k] && fb[k]) fa[k] = fb[k]; });
    Object.keys(fb.palette).forEach(function (r) { if (!fa.palette[r]) fa.palette[r] = fb.palette[r]; });
    ['palette_alternatives', 'extra', 'swatches', 'drawn_swatches', 'named_without_value', 'print_only', 'type_scale', 'fonts', 'claims'].forEach(function (k) { fa[k] = fa[k].concat(fb[k]); });
    Object.keys(fb.typography).forEach(function (r) { if (!fa.typography[r]) fa.typography[r] = fb.typography[r]; });
    fa.logo.rules = fa.logo.rules.concat(fb.logo.rules);
    if (!fa.voice.tone) fa.voice.tone = fb.voice.tone;
    if (!fa.voice.no_em_dashes) fa.voice.no_em_dashes = fb.voice.no_em_dashes;
    fa.voice.preferred = fa.voice.preferred.concat(fb.voice.preferred);
    fa.voice.banned = fa.voice.banned.concat(fb.voice.banned);
    ['components'].forEach(function () {
      Object.keys(fb.components).forEach(function (n) {
        fa.components[n] = fa.components[n] || {};
        Object.keys(fb.components[n]).forEach(function (pp) { if (!fa.components[n][pp]) fa.components[n][pp] = fb.components[n][pp]; });
      });
    });
    ['rounded', 'spacing', 'rules'].forEach(function (k) { Object.keys(fb[k]).forEach(function (x) { if (!fa[k][x]) fa[k][x] = fb[k][x]; }); });
    a.lines_read += b.lines_read;
    a.notes = a.notes.concat(b.notes);
    return a;
  }

  /* ══ 3. TOKEN JSON (W3C DTCG, Style Dictionary, Tokens Studio, Figma) ═════ */

  /** JSON with a line number for every value. */
  function jsonWithLines(textIn) {
    var s = String(textIn || ''), i = 0, line = 1, lines = {};
    function ws() { for (;;) { var c = s[i]; if (c === '\n') { line++; i++; } else if (c === ' ' || c === '\t' || c === '\r') i++; else if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; } else break; } }
    function str() { var st = i; i++; while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; i++; } i++; return JSON.parse(s.slice(st, i)); }
    function val(path) {
      ws();
      var c = s[i], at = line;
      if (c === '{') {
        i++; var o = {}; ws();
        if (s[i] === '}') { i++; return o; }
        for (;;) { ws(); var k = str(); ws(); i++; o[k] = val(path.concat(k)); ws(); if (s[i] === ',') { i++; continue; } if (s[i] === '}') { i++; break; } throw err('That JSON file could not be parsed (line ' + line + ').', 'json_invalid'); }
        lines[path.join('\u0001')] = at; return o;
      }
      if (c === '[') {
        i++; var a = []; ws();
        if (s[i] === ']') { i++; return a; }
        for (;;) { a.push(val(path.concat(String(a.length)))); ws(); if (s[i] === ',') { i++; continue; } if (s[i] === ']') { i++; break; } throw err('That JSON file could not be parsed (line ' + line + ').', 'json_invalid'); }
        lines[path.join('\u0001')] = at; return a;
      }
      lines[path.join('\u0001')] = at;
      if (c === '"') return str();
      var m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i));
      if (!m) throw err('That JSON file could not be parsed (line ' + line + ').', 'json_invalid');
      i += m[0].length;
      return JSON.parse(m[0]);
    }
    var root = val([]);
    return { value: root, lineOf: function (path) { return lines[path.join('\u0001')] || null; } };
  }
  function colourFromToken(v) {
    if (typeof v === 'string') {
      var h = normHex(v); if (h) return { hex: h, from: 'hex' };
      var m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(v.trim());
      if (m) return { hex: rgbHex(+m[1], +m[2], +m[3]), from: 'rgb' };
      return null;
    }
    if (v && typeof v === 'object') {
      if (typeof v.hex === 'string' && normHex(v.hex)) return { hex: normHex(v.hex), from: 'hex' };
      if (Array.isArray(v.components) && (!v.colorSpace || v.colorSpace === 'srgb') && v.components.length >= 3) return { hex: rgbHex(v.components[0] * 255, v.components[1] * 255, v.components[2] * 255), from: 'srgb components' };
      if (typeof v.r === 'number' && typeof v.g === 'number' && typeof v.b === 'number') {
        var scale = (v.r <= 1 && v.g <= 1 && v.b <= 1) ? 255 : 1;
        return { hex: rgbHex(v.r * scale, v.g * scale, v.b * scale), from: 'rgb components' };
      }
    }
    return null;
  }
  function parseTokens(textIn, src) {
    src = src || {};
    var rep = newReport(src, 'tokens-json');
    var f = rep.fields;
    var parsed;
    try { parsed = jsonWithLines(textIn); } catch (e) { throw err(e.message || 'That JSON file could not be parsed.', 'json_invalid'); }
    var srcLines = String(textIn).split(/\r?\n/);
    var P = function (path, shown) { var l = parsed.lineOf(path); return prov(src, { page: null, line: l, text: shown || (l ? srcLines[l - 1] : path.join('.')) }); };
    var tokens = [];
    function walk(node, path, inheritedType) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      var type = node.$type || inheritedType || '';
      if (Object.prototype.hasOwnProperty.call(node, '$value')) { tokens.push({ path: path, type: type, value: node.$value, desc: node.$description || '' }); return; }
      if (Object.prototype.hasOwnProperty.call(node, 'value') && (typeof node.value !== 'object' || node.type) && !Object.keys(node).some(function (k) { return k !== 'value' && k !== 'type' && k !== 'description' && k !== 'comment' && k !== 'attributes' && k !== 'name' && k !== 'filePath' && k !== 'isSource' && k !== 'original' && k !== 'path' && node[k] && typeof node[k] === 'object' && (node[k].value !== undefined || node[k].$value !== undefined); })) {
        tokens.push({ path: path, type: node.type || type || '', value: node.value, desc: node.description || node.comment || '' }); return;
      }
      Object.keys(node).forEach(function (k) { if (k.charAt(0) !== '$') walk(node[k], path.concat(k), type); });
    }
    var root = parsed.value;
    // Figma variables: a REST export (meta.variables) or a plugin export (variables[]).
    var figmaVars = root && root.meta && root.meta.variables ? Object.keys(root.meta.variables).map(function (id) { return { v: root.meta.variables[id], path: ['meta', 'variables', id] }; })
      : (root && Array.isArray(root.variables) ? root.variables.map(function (v, n) { return { v: v, path: ['variables', String(n)] }; }) : null);
    if (figmaVars) {
      figmaVars.forEach(function (x) {
        var v = x.v || {};
        var modes = v.valuesByMode || {};
        var first = modes[Object.keys(modes)[0]];
        var t = String(v.resolvedType || '').toUpperCase();
        tokens.push({ path: String(v.name || '').split('/').filter(Boolean), at: x.path.concat('valuesByMode', Object.keys(modes)[0] || ''), type: t === 'COLOR' ? 'color' : (t === 'FLOAT' ? 'dimension' : (t === 'STRING' ? 'string' : '')), value: first, figma: true });
      });
    } else walk(root, [], '');
    // Aliases ({color.brand.primary}) resolve inside the same file.
    var byPath = {};
    tokens.forEach(function (t) { byPath[t.path.join('.')] = t; });
    function resolveAlias(v, depth) {
      if (typeof v !== 'string' || depth > 6) return v;
      var m = /^\{([^}]+)\}$/.exec(v.trim());
      if (!m) return v;
      var t = byPath[m[1]];
      return t ? resolveAlias(t.value, depth + 1) : v;
    }
    var familyTokens = [];
    tokens.forEach(function (t) {
      var at = t.at || t.path;
      var v = resolveAlias(t.value, 0);
      var name = t.path.join(' ').replace(/[-_]/g, ' ').toLowerCase();
      var type = String(t.type || '').toLowerCase();
      var isColour = type === 'color' || type === 'colour' || (!type && colourFromToken(v) && /colou?r/.test(name));
      if (isColour) {
        var c = colourFromToken(v);
        if (!c) return;
        var role = roleOf(name);
        var rec = { hex: c.hex, from: c.from, label: t.path.join('.'), role: role, prov: P(at) };
        f.swatches.push(rec);
        if (role && !f.palette[role]) f.palette[role] = rec;
        else if (role) f.palette_alternatives.push(rec);
        else if (f.extra.length < 24) f.extra.push({ name: t.path.join('.'), hex: c.hex, prov: P(at) });
        return;
      }
      if (type === 'fontfamily' || type === 'fontfamilies' || /font\s?famil/.test(name)) {
        var fam = Array.isArray(v) ? v[0] : String(v || '').split(',')[0];
        fam = String(fam || '').replace(/["']/g, '').trim();
        if (fam && !GENERIC_FAMILIES.test(fam)) familyTokens.push({ family: fam, stack: Array.isArray(v) ? v.join(',') : String(v), name: name, prov: P(at) });
        return;
      }
      if (type === 'typography' && v && typeof v === 'object') {
        var slot = /\b(heading|headline|display|title|h[1-6])\b/.test(name) ? 'heading' : (/\b(body|paragraph|text)\b/.test(name) ? 'body' : '');
        var famv = resolveAlias(v.fontFamily, 0);
        rep.fields.type_scale.push({ token: t.path.join('.'), slot: slot, family: String(famv || '').replace(/["']/g, '').split(',')[0].trim(), size: String(resolveAlias(v.fontSize, 0) || ''), weight: String(resolveAlias(v.fontWeight, 0) || ''), line_height: String(resolveAlias(v.lineHeight, 0) || ''), letter_spacing: String(resolveAlias(v.letterSpacing, 0) || ''), prov: P(at) });
        if (slot && famv && !f.typography[slot]) familyTokens.push({ family: String(famv).replace(/["']/g, '').split(',')[0].trim(), stack: String(famv), name: name + ' ' + slot, prov: P(at), slot: slot });
        return;
      }
      var dim = typeof v === 'string' ? v : (v && typeof v === 'object' && v.value != null ? v.value + (v.unit || '') : (typeof v === 'number' && t.figma ? v + 'px' : ''));
      if (!dim || !/^-?\d+(\.\d+)?\s*(px|rem|em|pt|%)?$/.test(String(dim).trim())) return;
      var last = t.path[t.path.length - 1];
      if (/\b(radius|radii|rounded|corner|corners)\b/.test(name)) { if (!f.rounded[last]) f.rounded[last] = { value: String(dim).trim(), prov: P(at) }; }
      else if (/\b(spacing|space|spaces|gap|gutter)\b/.test(name)) { if (!f.spacing[last]) f.spacing[last] = { value: String(dim).trim(), prov: P(at) }; }
    });
    // Families: a slot named in the token, else one family for everything.
    familyTokens.forEach(function (ft) {
      var slot = ft.slot || (/\b(heading|headline|display|title)\b/.test(ft.name) ? 'heading' : (/\b(body|text|paragraph|base)\b/.test(ft.name) ? 'body' : (/\b(mono|code)\b/.test(ft.name) ? 'mono' : '')));
      if (slot && !f.typography[slot]) f.typography[slot] = { family: ft.family, stack: ft.stack.indexOf(',') > 0 ? ft.stack : '', weights: [], google: false, size: '', line_height: '', letter_spacing: '', label: ft.name, prov: ft.prov };
    });
    var unslotted = familyTokens.filter(function (ft) { return !ft.slot && !/\b(heading|headline|display|title|body|text|paragraph|base|mono|code)\b/.test(ft.name); });
    var distinct = unslotted.map(function (x) { return x.family; }).filter(function (x, n, a) { return a.indexOf(x) === n; });
    if (distinct.length === 1 && !f.typography.heading && !f.typography.body) {
      ['heading', 'body'].forEach(function (s) { f.typography[s] = { family: unslotted[0].family, stack: '', weights: [], google: false, size: '', line_height: '', letter_spacing: '', label: unslotted[0].name, applies: 'one typeface named for everything', prov: unslotted[0].prov }; });
    } else if (distinct.length > 1) rep.notes.push('The token file names ' + distinct.length + ' font families without saying which is for headings and which for body (' + distinct.join(', ') + '); none was assigned. Pick them on the Typography step.');
    rep.lines_read = srcLines.length;
    return rep;
  }

  /* ══ 4. CSS custom properties, @font-face, and rules on h1/body ══════════ */
  function parseCss(textIn, src) {
    src = src || {};
    var rep = newReport(src, 'css');
    var f = rep.fields;
    var css = String(textIn || '').replace(/\/\*[\s\S]*?\*\//g, function (c) { return c.replace(/[^\n]/g, ' '); });
    var srcLines = String(textIn || '').split(/\r?\n/);
    var lineAt = function (idx) { return css.slice(0, idx).split('\n').length; };
    var P = function (idx) { var l = lineAt(idx); return prov(src, { page: null, line: l, text: srcLines[l - 1] }); };
    var vars = {};
    var rx = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}{]+)/g, m;
    while ((m = rx.exec(css))) vars[m[1]] = { value: clean(m[2]), idx: m.index };
    function resolveVar(v, d) { var mm = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)$/.exec(String(v).trim()); return mm && vars[mm[1]] && d < 6 ? resolveVar(vars[mm[1]].value, d + 1) : v; }
    Object.keys(vars).forEach(function (name) {
      var v = resolveVar(vars[name].value, 0);
      var label = name.replace(/^--/, '').replace(/[-_]/g, ' ').toLowerCase();
      var c = colourFromToken(v);
      if (c) {
        var role = roleOf(label);
        var rec = { hex: c.hex, from: c.from, label: name, role: role, prov: P(vars[name].idx) };
        f.swatches.push(rec);
        if (role && !f.palette[role]) f.palette[role] = rec;
        else if (!role && f.extra.length < 24) f.extra.push({ name: name, hex: c.hex, prov: P(vars[name].idx) });
        return;
      }
      if (/\bfont\b/.test(label) && /\b(family|head|heading|display|body|text|sans|serif|mono)\b/.test(label) && !/\b(size|weight|height)\b/.test(label)) {
        var fam = String(v).split(',')[0].replace(/["']/g, '').trim();
        var slot = /\b(head|heading|display|title)\b/.test(label) ? 'heading' : (/\b(body|text|base)\b/.test(label) ? 'body' : (/\bmono\b/.test(label) ? 'mono' : ''));
        if (fam && !GENERIC_FAMILIES.test(fam) && slot && !f.typography[slot]) f.typography[slot] = { family: fam, stack: String(v).indexOf(',') > 0 ? String(v) : '', weights: [], google: false, size: '', line_height: '', letter_spacing: '', label: name, prov: P(vars[name].idx) };
        return;
      }
      var dim = String(v).trim();
      if (/^-?\d+(\.\d+)?(px|rem|em)$/.test(dim)) {
        if (/\b(radius|rounded|corner)\b/.test(label)) f.rounded[name.replace(/^--/, '')] = { value: dim, prov: P(vars[name].idx) };
        else if (/\b(space|spacing|gap|gutter)\b/.test(label)) f.spacing[name.replace(/^--/, '')] = { value: dim, prov: P(vars[name].idx) };
      }
    });
    // @font-face: a file the brand serves for a family.
    var ff = /@font-face\s*\{([^}]*)\}/g;
    while ((m = ff.exec(css))) {
      var famm = /font-family\s*:\s*([^;]+)/i.exec(m[1]);
      var srcm = /url\(\s*['"]?([^'")]+)['"]?\s*\)\s*(?:format\(\s*['"]?([^'")]+)['"]?\s*\))?/i.exec(m[1]);
      if (famm && srcm) {
        var u = srcm[1];
        try { u = new URL(u, src.url || undefined).toString(); } catch (_) { /* relative, with no base */ }
        f.fonts.push({ family: famm[1].replace(/["']/g, '').trim(), url: u, format: srcm[2] || '', resolved: /^https?:\/\//.test(u), prov: P(m.index) });
      }
    }
    // Plain rules: h1..h3 / body / p font-family.
    var rule = /([^{}@]+)\{([^{}]*)\}/g;
    while ((m = rule.exec(css))) {
      var sel = clean(m[1]).toLowerCase();
      var famr = /font-family\s*:\s*([^;]+)/i.exec(m[2]);
      if (!famr) continue;
      var vfam = resolveVar(clean(famr[1]), 0);
      var fam1 = String(vfam).split(',')[0].replace(/["']/g, '').trim();
      if (!fam1 || GENERIC_FAMILIES.test(fam1) || /^var\(/.test(fam1)) continue;
      var slot2 = /(^|,|\s)(h1|h2|h3|\.heading|\.display|\.title)\b/.test(sel) ? 'heading' : (/(^|,|\s)(body|html|p)\b/.test(sel) ? 'body' : '');
      if (slot2 && !f.typography[slot2]) f.typography[slot2] = { family: fam1, stack: String(vfam).indexOf(',') > 0 ? String(vfam) : '', weights: [], google: false, size: '', line_height: '', letter_spacing: '', label: sel, prov: P(m.index + m[1].length) };
    }
    rep.lines_read = srcLines.length;
    return rep;
  }

  /* ══ 5. SVG: sanitise, read its text, tie drawn swatches to their labels ══ */
  var SVG_DROP = /^(script|foreignobject|iframe|object|embed|audio|video|handler|listener|animate|set|animatemotion|animatetransform)$/i;
  function sanitizeSvg(textIn) {
    if (typeof DOMParser === 'undefined') throw err('SVG can only be read in a browser.', 'no_dom');
    var doc = new DOMParser().parseFromString(String(textIn || ''), 'image/svg+xml');
    var svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw err('That SVG file could not be parsed.', 'svg_invalid');
    var removed = 0;
    (function walk(el) {
      Array.prototype.slice.call(el.children || []).forEach(function (c) {
        if (SVG_DROP.test(c.localName || c.nodeName)) { c.parentNode.removeChild(c); removed++; return; }
        walk(c);
      });
      Array.prototype.slice.call(el.attributes || []).forEach(function (a) {
        var n = a.name.toLowerCase(), v = String(a.value || '');
        if (/^on/.test(n) || ((n === 'href' || n === 'xlink:href' || n === 'src') && !/^#|^data:image\/(png|jpe?g|gif|webp);/i.test(v.trim())) || /javascript:/i.test(v)) { el.removeAttribute(a.name); removed++; }
      });
    })(svg);
    return { text: new XMLSerializer().serializeToString(svg), doc: doc, svg: svg, removed: removed };
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function fillOf(el) {
    var f = el.getAttribute('fill') || '';
    var st = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(el.getAttribute('style') || '');
    return normHex(clean(st ? st[1] : f).replace(/^#/, '#'));
  }
  function parseSvg(textIn, src) {
    src = src || {};
    var clean1 = sanitizeSvg(textIn);
    var svg = clean1.svg;
    var texts = Array.prototype.slice.call(svg.querySelectorAll('text')).map(function (t, n) {
      return { el: t, text: clean(t.textContent), x: num(t.getAttribute('x')), y: num(t.getAttribute('y')), n: n };
    }).filter(function (t) { return t.text; });
    var lines = texts.map(function (t) { return { text: t.text, page: null, line: t.n + 1 }; });
    var rep = fromLines(lines, src, newReport(src, 'svg'));
    // Drawn swatches: a filled shape with a label inside, under or beside it.
    var shapes = Array.prototype.slice.call(svg.querySelectorAll('rect,circle')).map(function (el) {
      var fill = fillOf(el);
      if (!fill) return null;
      var isC = el.localName === 'circle';
      var x = isC ? num(el.getAttribute('cx')) - num(el.getAttribute('r')) : num(el.getAttribute('x')) || 0;
      var y = isC ? num(el.getAttribute('cy')) - num(el.getAttribute('r')) : num(el.getAttribute('y')) || 0;
      var w = isC ? 2 * num(el.getAttribute('r')) : num(el.getAttribute('width'));
      var h = isC ? 2 * num(el.getAttribute('r')) : num(el.getAttribute('height'));
      if (!(w > 6 && h > 6) || x == null || y == null) return null;
      return { fill: fill, x: x, y: y, w: w, h: h };
    }).filter(Boolean);
    var vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    var W = num(svg.getAttribute('width')) || vb[2] || 0, H = num(svg.getAttribute('height')) || vb[3] || 0;
    shapes.forEach(function (s) {
      if (W && H && s.w >= W * 0.9 && s.h >= H * 0.9) return;    // the page background, not a swatch
      var best = null, bd = Infinity;
      texts.forEach(function (t) {
        if (t.x == null || t.y == null) return;
        var inside = t.x >= s.x - 4 && t.x <= s.x + s.w + 4 && t.y >= s.y && t.y <= s.y + s.h + 4;
        var below = t.x >= s.x - 12 && t.x <= s.x + s.w + 12 && t.y > s.y + s.h && t.y <= s.y + s.h + 48;
        var right = t.x > s.x + s.w && t.x <= s.x + s.w + 220 && t.y >= s.y && t.y <= s.y + s.h + 14;
        if (!(inside || below || right)) return;
        var d = Math.abs(t.y - (s.y + s.h)) + Math.abs(t.x - s.x) * 0.3;
        if (labelOf(t.text) && meaningful(labelOf(t.text)) && d < bd) { bd = d; best = t; }
      });
      if (!best) return;
      var label = labelOf(best.text);
      var role = roleOf(label);
      var rec = { hex: s.fill, from: 'drawn swatch', label: label, role: role, prov: prov(src, { page: null, line: best.n + 1, text: best.text + ' (swatch fill ' + s.fill + ')' }) };
      rep.fields.drawn_swatches.push(rec);
      // A drawn, labelled swatch fills a role ONLY when no text states one.
      if (role && !rep.fields.palette[role]) rep.fields.palette[role] = rec;
    });
    rep.svg_removed = clean1.removed;
    rep.svg_sanitized = clean1.text;
    return rep;
  }

  /* ══ 6. ZIP (DOCX) with the browser's own DecompressionStream ══════════════ */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw err('This browser cannot unpack a .docx (no DecompressionStream). Save the document as PDF and upload that.', 'no_decompression');
    var ds = new DecompressionStream('deflate-raw');
    var out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  async function unzip(buf) {
    var u8 = new Uint8Array(buf);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw err('That file is not a .docx (no zip directory).', 'docx_invalid');
    var n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
    var files = {};
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      var nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
      var local = dv.getUint32(off + 42, true);
      var name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen));
      files[name] = { method: method, csize: csize, local: local };
      off += 46 + nlen + xlen + clen;
    }
    return {
      names: Object.keys(files),
      read: async function (name) {
        var e = files[name]; if (!e) return null;
        var l = e.local, ln = dv.getUint16(l + 26, true), lx = dv.getUint16(l + 28, true);
        var data = u8.subarray(l + 30 + ln + lx, l + 30 + ln + lx + e.csize);
        return e.method === 0 ? data.slice() : (e.method === 8 ? inflateRaw(data) : Promise.reject(err('Unsupported zip compression in that file.', 'docx_invalid')));
      },
    };
  }
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  function wText(p) {
    var out = '';
    var walker = p.ownerDocument.createTreeWalker(p, 1);
    var n;
    while ((n = walker.nextNode())) {
      if (n.namespaceURI !== W_NS) continue;
      if (n.localName === 't') out += n.textContent;
      else if (n.localName === 'tab') out += '\t';
      else if (n.localName === 'br') out += ' ';
    }
    return out;
  }
  async function readDocx(buf, src) {
    var zip = await unzip(buf);
    var xml = await zip.read('word/document.xml');
    if (!xml) throw err('That file is not a Word document (no word/document.xml).', 'docx_invalid');
    var doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
    var rels = {};
    var relXml = await zip.read('word/_rels/document.xml.rels');
    if (relXml) {
      var rd = new DOMParser().parseFromString(new TextDecoder().decode(relXml), 'application/xml');
      Array.prototype.forEach.call(rd.getElementsByTagName('Relationship'), function (r) { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
    }
    var body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
    var lines = [], drawn = [], images = [];
    var paraNo = 0;
    function para(p, extra) {
      paraNo++;
      var t = wText(p);
      lines.push({ text: t, page: null, line: paraNo, part: extra || '' });
      // Pictures in this paragraph, with their alt text.
      Array.prototype.forEach.call(p.getElementsByTagName('*'), function (el) {
        if (el.localName === 'docPr') { p.__alt = (p.__alt || '') + ' ' + (el.getAttribute('descr') || '') + ' ' + (el.getAttribute('name') || '') + ' ' + (el.getAttribute('title') || ''); }
        if (el.localName === 'blip') {
          var rid = el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || el.getAttribute('r:embed');
          if (rid && rels[rid]) images.push({ target: 'word/' + rels[rid].replace(/^\/?word\//, '').replace(/^\.\.\//, ''), para: paraNo, alt: '', p: p });
        }
      });
    }
    Array.prototype.forEach.call(body ? body.childNodes : [], function (node) {
      if (node.nodeType !== 1 || node.namespaceURI !== W_NS) return;
      if (node.localName === 'p') para(node);
      else if (node.localName === 'tbl') {
        Array.prototype.forEach.call(node.getElementsByTagNameNS(W_NS, 'tr'), function (tr) {
          var cells = Array.prototype.filter.call(tr.childNodes, function (c) { return c.localName === 'tc'; });
          var texts = cells.map(function (c) { return clean(wText(c)); });
          paraNo++;
          lines.push({ text: texts.join('   '), page: null, line: paraNo, part: 'table' });
          // A cell shaded with a fill and labelled: a drawn swatch.
          cells.forEach(function (c, ci) {
            var shd = c.getElementsByTagNameNS(W_NS, 'shd')[0];
            var fill = shd && shd.getAttributeNS(W_NS, 'fill');
            var hex = fill && fill !== 'auto' ? normHex(fill) : '';
            if (!hex) return;
            var label = texts[ci] || texts[0] || '';
            if (meaningful(labelOf(label))) drawn.push({ hex: hex, label: labelOf(label), line: paraNo, text: texts.join('   ') });
          });
        });
      }
    });
    // Footers carry the legal line more often than the body does.
    for (var fn = 1; fn <= 3; fn++) {
      var fx = await zip.read('word/footer' + fn + '.xml');
      if (!fx) continue;
      var fd = new DOMParser().parseFromString(new TextDecoder().decode(fx), 'application/xml');
      Array.prototype.forEach.call(fd.getElementsByTagNameNS(W_NS, 'p'), function (p) { paraNo++; lines.push({ text: wText(p), page: null, line: paraNo, part: 'footer' }); });
    }
    var rep = fromLines(lines, src, newReport(src, 'docx'));
    rep.locator = 'paragraph';
    drawn.forEach(function (d) {
      var role = roleOf(d.label);
      var rec = { hex: d.hex, from: 'drawn swatch', label: d.label, role: role, prov: prov(src, { page: null, line: d.line, text: d.text + ' (cell fill ' + d.hex + ')' }) };
      rep.fields.drawn_swatches.push(rec);
      if (role && !rep.fields.palette[role]) rep.fields.palette[role] = rec;
    });
    for (var ii = 0; ii < images.length && rep.images.length < LIMITS.images; ii++) {
      var im = images[ii];
      var bytes = await zip.read(im.target);
      if (!bytes) continue;
      var ext = (im.target.split('.').pop() || '').toLowerCase();
      var type = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : '';
      if (!type) continue;
      var alt = clean(im.p.__alt || '');
      var near = lines.slice(Math.max(0, im.para - 3), im.para + 1).map(function (l) { return clean(l.text); }).join(' ');
      rep.images.push({ blob: new Blob([bytes], { type: type }), type: type, name: im.target.split('/').pop(), page: null, line: im.para, alt: alt, mentions_logo: /\blogo\b|\bwordmark\b|\blogotype\b/i.test(alt + ' ' + near), prov: prov(src, { page: null, line: im.para, text: alt || near || im.target }) });
    }
    return rep;
  }

  /* ══ 7. PDF, with pdf.js ═══════════════════════════════════════════════════ */
  var pdfjsPromise = null;
  function loadPdfJs() {
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = (async function () {
      var lib = (typeof window !== 'undefined' && window.pdfjsLib && window.pdfjsLib.getDocument) ? window.pdfjsLib : null;
      if (!lib) {
        var mod = await import(/* webpackIgnore: true */ PDFJS);
        lib = mod && mod.getDocument ? mod : (mod && mod.default && mod.default.getDocument ? mod.default : null);
      }
      if (!lib || !lib.getDocument) throw err('The PDF reader could not be loaded from ' + new URL(PDFJS).host + ', so this PDF was not read. Check the connection, or upload the document as DOCX, DESIGN.md or a token file.', 'pdfjs_unavailable');
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    })();
    pdfjsPromise.catch(function () { pdfjsPromise = null; });
    return pdfjsPromise;
  }
  function textLinesOfPage(content, pageNo) {
    var items = (content.items || []).filter(function (it) { return it && typeof it.str === 'string' && it.transform; });
    var rows = [];
    items.forEach(function (it) {
      var y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || it.height || 10;
      var row = rows.filter(function (r) { return Math.abs(r.y - y) <= Math.max(2, h * 0.35); })[0];
      if (!row) { row = { y: y, h: h, items: [] }; rows.push(row); }
      row.items.push({ x: x, w: it.width || 0, s: it.str });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r, n) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      var t = '', lastEnd = null;
      r.items.forEach(function (it) {
        if (lastEnd != null) { var gap = it.x - lastEnd; t += gap > r.h * 2.2 ? '   ' : (gap > r.h * 0.15 && !/\s$/.test(t) && !/^\s/.test(it.s) ? ' ' : ''); }
        t += it.s; lastEnd = it.x + it.w;
      });
      return { text: t, page: pageNo, line: n + 1, y: r.y };
    }).filter(function (l) { return clean(l.text); }).map(function (l, n) { l.line = n + 1; return l; });
  }
  async function pageImages(lib, page, pageNo, src, pageText, rep) {
    var ops;
    try { ops = await page.getOperatorList(); } catch (_) { return; }
    var OPS = lib.OPS;
    for (var i = 0; i < ops.fnArray.length && rep.images.length < LIMITS.images; i++) {
      var fn = ops.fnArray[i], args = ops.argsArray[i];
      var img = null;
      if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        var id = args[0];
        img = await new Promise(function (resolve) {
          var store = String(id).indexOf('g_') === 0 ? page.commonObjs : page.objs;
          var done = false;
          try { store.get(id, function (o) { done = true; resolve(o); }); } catch (_) { resolve(null); }
          setTimeout(function () { if (!done) resolve(null); }, 4000);
        });
      } else if (fn === OPS.paintInlineImageXObject) img = args[0];
      if (!img) continue;
      var blob = await imageToPng(img);
      if (!blob) continue;
      var mentions = /\blogo\b|\bwordmark\b|\blogotype\b|\bbrand ?mark\b/i.test(pageText);
      var logoLine = mentions ? (pageText.split('\n').filter(function (l) { return /\blogo\b|\bwordmark\b|\blogotype\b|\bbrand ?mark\b/i.test(l); })[0] || '') : '';
      rep.images.push({ blob: blob, type: 'image/png', name: 'page' + pageNo + '-image' + (rep.images.length + 1) + '.png', width: img.width, height: img.height, page: pageNo, line: null, alt: '', mentions_logo: mentions, prov: prov(src, { page: pageNo, line: null, text: logoLine || ('embedded image ' + img.width + 'x' + img.height + ' on page ' + pageNo) }) });
    }
  }
  async function imageToPng(img) {
    try {
      var w = img.width, h = img.height;
      if (!w || !h || w < LIMITS.image_min_px || h < LIMITS.image_min_px) return null;
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
      else if (img.data) {
        var id = ctx.createImageData(w, h), d = img.data, o = id.data;
        if (d.length === w * h * 4) o.set(d);
        else if (d.length === w * h * 3) { for (var a = 0, b = 0; a < d.length; a += 3, b += 4) { o[b] = d[a]; o[b + 1] = d[a + 1]; o[b + 2] = d[a + 2]; o[b + 3] = 255; } }
        else if (d.length === w * h) { for (var c = 0, e = 0; c < d.length; c++, e += 4) { o[e] = o[e + 1] = o[e + 2] = d[c]; o[e + 3] = 255; } }
        else return null;
        ctx.putImageData(id, 0, 0);
      } else return null;
      return await new Promise(function (resolve) { canvas.toBlob(function (b) { resolve(b); }, 'image/png'); });
    } catch (_) { return null; }
  }
  async function readPdf(buf, src) {
    var lib = await loadPdfJs();
    var pdf;
    try {
      pdf = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false }).promise;
    } catch (e) {
      if (e && /password/i.test(e.name || e.message || '')) throw err('That PDF is password-protected, so it cannot be read. Upload an unlocked copy.', 'pdf_password');
      throw err('That PDF could not be opened: ' + ((e && e.message) || 'it is damaged or not a PDF') + '.', 'pdf_invalid');
    }
    var lines = [];
    var rep = newReport(src, 'pdf');
    rep.pages = pdf.numPages;
    var pagesWithText = 0;
    for (var n = 1; n <= pdf.numPages; n++) {
      var page = await pdf.getPage(n);
      var tc = await page.getTextContent();
      var pl = textLinesOfPage(tc, n);
      if (pl.length) pagesWithText++;
      lines = lines.concat(pl);
      await pageImages(lib, page, n, src, pl.map(function (l) { return l.text; }).join('\n'), rep);
    }
    var read = fromLines(lines, src, rep);
    if (!pagesWithText) read.limits.push('This PDF has no text layer (a scan, or type converted to outlines), so nothing could be read as text. Type the values, or upload the source document (DOCX, DESIGN.md or a token file).');
    else if (pagesWithText < pdf.numPages) read.limits.push((pdf.numPages - pagesWithText) + ' of ' + pdf.numPages + ' page(s) have no text layer; anything shown only as a picture on them was not read.');
    read.limits.push('A logo drawn as vector paths (not an embedded image) cannot be lifted out of a PDF: upload the logo file itself.');
    read.limits.push('Colour swatches drawn as shapes are not read from a PDF: only colour values the document states in text are.');
    try { await pdf.destroy(); } catch (_) {}
    return read;
  }

  /* ══ 8. one entry point ════════════════════════════════════════════════════ */
  function kindOf(name, type, head) {
    var n = String(name || '').toLowerCase(), t = String(type || '').toLowerCase();
    var sig = head || '';
    if (/%PDF-/.test(sig.slice(0, 1024)) || /\.pdf$/.test(n) || t === 'application/pdf') return 'pdf';
    if (/\.docx$/.test(n) || /wordprocessingml/.test(t)) return 'docx';
    if (/^(design|brand)[-_. ]?.*\.md$|\.design\.md$/.test(n) || /^---[\s\S]*?\b(colors|typography)\s*:/.test(sig.slice(0, 4000)) && /\.md$|markdown/.test(n + t)) return 'design-md';
    if (/\.(md|markdown)$/.test(n) || /markdown/.test(t)) return /^---\s*\n/.test(sig) ? 'design-md' : 'text';
    if (/\.json$/.test(n) || /json/.test(t) || /^\s*[{[]/.test(sig)) return 'tokens-json';
    if (/\.css$/.test(n) || t === 'text/css') return 'css';
    if (/\.svg$/.test(n) || t === 'image/svg+xml' || /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(sig)) return 'svg';
    if (/\.(png|jpe?g|webp|gif)$/.test(n) || /^image\//.test(t)) return 'image';
    if (/\.(txt)$/.test(n) || /^text\//.test(t)) return 'text';
    if (/\.doc$/.test(n)) return 'doc';
    return '';
  }

  async function readBytes(buf, meta) {
    var m = meta || {};
    var src = { name: m.name || 'document', url: m.url || '', size: buf.byteLength, type: m.type || '' };
    var head = '';
    try { head = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf).subarray(0, 4096)); } catch (_) {}
    var kind = kindOf(src.name, src.type, head);
    var text = function () { return new TextDecoder('utf-8').decode(new Uint8Array(buf)); };
    var rep;
    if (kind === 'pdf') rep = await readPdf(buf, src);
    else if (kind === 'docx') rep = await readDocx(buf, src);
    else if (kind === 'design-md') rep = parseDesignMd(text(), src);
    else if (kind === 'tokens-json') rep = parseTokens(text(), src);
    else if (kind === 'css') rep = parseCss(text(), src);
    else if (kind === 'svg') {
      rep = parseSvg(text(), src);
      rep.images.push({ blob: new Blob([rep.svg_sanitized], { type: 'image/svg+xml' }), type: 'image/svg+xml', name: src.name, page: null, line: null, alt: '', sanitized: true, mentions_logo: /\blogo\b/i.test(src.name), prov: prov(src, { page: null, line: null, text: 'the SVG file itself (scripts and event handlers removed: ' + rep.svg_removed + ')' }) });
    } else if (kind === 'image') {
      rep = newReport(src, 'image');
      rep.images.push({ blob: new Blob([buf], { type: src.type || 'image/png' }), type: src.type || 'image/png', name: src.name, page: null, line: null, alt: '', mentions_logo: /\blogo\b/i.test(src.name), prov: prov(src, { page: null, line: null, text: 'the image file itself' }) });
      rep.limits.push('This is a picture with no text layer, and this app does not read text out of pictures. Its colours cannot be tied to a role (primary, accent...) without reading the labels beside them, so none were taken: type them in on the Colour step, or upload the guideline as PDF, DOCX, DESIGN.md or a token file. You can still use the image itself as your logo below.');
      rep.needs_operator = true;
    } else if (kind === 'text') {
      var tl = text().split(/\r?\n/).map(function (t, i) { return { text: t.replace(/^#+\s*/, '').replace(/\*\*|__|`/g, ''), page: null, line: i + 1 }; });
      rep = fromLines(tl, src, newReport(src, 'text'));
    } else if (kind === 'doc') {
      throw err('That is an old Word .doc file, which a browser cannot read. Save it as .docx or PDF and upload that.', 'doc_legacy');
    } else {
      throw err('That kind of file cannot be read as brand guidelines. Upload a PDF, a Word .docx, a DESIGN.md, a JSON token file, a CSS file, an SVG or an image.', 'unsupported_type');
    }
    rep.source.kind = kind;
    rep.locator = rep.locator || (kind === 'pdf' ? 'page' : 'line');
    finishReport(rep);
    return rep;
  }

  /** De-duplicate lists, and name every field the document did not state. */
  function finishReport(rep) {
    var f = rep.fields;
    function dedupe(list) { var seen = {}; return list.filter(function (x) { var k = String(x.value).toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; }); }
    f.voice.preferred = dedupe(f.voice.preferred);
    f.voice.banned = dedupe(f.voice.banned);
    f.claims = dedupe(f.claims);
    var seenX = {};
    f.extra = f.extra.filter(function (e) { var k = e.hex + '|' + e.name; if (seenX[k] || Object.keys(f.palette).some(function (r) { return f.palette[r].hex === e.hex && f.palette[r].label === e.name; })) return false; seenX[k] = 1; return true; }).slice(0, 12);
    // Logo images: one the document itself puts beside the word "logo" first.
    rep.images.sort(function (a, b) { return (b.mentions_logo ? 1 : 0) - (a.mentions_logo ? 1 : 0); });
    f.logo.images = rep.images;
    var missing = [];
    ['name', 'tagline', 'website', 'legal_entity'].forEach(function (k) { if (!f[k]) missing.push(k === 'legal_entity' ? 'legal entity' : k === 'name' ? 'brand name' : k); });
    ['primary', 'accent', 'ink', 'surface'].forEach(function (r) { if (!f.palette[r]) missing.push('palette.' + r); });
    ['heading', 'body'].forEach(function (s) { if (!f.typography[s]) missing.push('typography.' + s); });
    if (!rep.images.some(function (i) { return i.mentions_logo; })) missing.push('logo');
    if (!f.voice.tone) missing.push('voice.tone');
    if (!f.voice.banned.length) missing.push('voice.banned phrases');
    rep.missing = missing;
    return rep;
  }

  async function read(file) {
    if (!file) throw err('Choose a file first.', 'no_file');
    if (file.size > LIMITS.document) throw err('That file is ' + (file.size / 1048576).toFixed(1) + ' MB; the largest document this page reads is ' + (LIMITS.document / 1048576) + ' MB.', 'too_large');
    if (!file.size) throw err('That file is empty.', 'empty');
    var buf = await file.arrayBuffer();
    return readBytes(buf, { name: file.name, type: file.type });
  }

  /**
   * A document by URL: straight from the host when it allows a browser to read
   * it (CORS), else through the server's op=document-fetch, which runs the SSRF
   * guard on every hop. `viaServer(url)` is supplied by the page.
   */
  async function readUrl(rawUrl, opts) {
    var o = opts || {};
    var url = String(rawUrl || '').trim();
    if (!url) throw err('Paste the address of your brand guidelines first.', 'url_required');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
    var u;
    try { u = new URL(url); } catch (_) { throw err('That is not a web address.', 'url_invalid'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw err('Only http and https addresses can be read.', 'url_invalid');
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/i.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname) || /\.(internal|local|localhost)$/i.test(u.hostname)) {
      throw err('That address is on a private or internal network, so it is not read.', 'url_private');
    }
    var direct = null, directErr = null;
    if (!o.serverOnly) {
      try {
        var r = await fetch(u.toString(), { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'follow' });
        if (r.ok) direct = { buf: await r.arrayBuffer(), type: (r.headers.get('content-type') || '').split(';')[0], name: decodeURIComponent((new URL(r.url || u.toString()).pathname.split('/').pop()) || 'document'), url: r.url || u.toString() };
        else directErr = err(u.host + ' answered ' + r.status + ', so nothing was read.', 'url_status');
      } catch (e) { directErr = e; }
    }
    if (!direct) {
      if (typeof o.viaServer !== 'function') throw directErr || err('That host does not let a browser read the file directly.', 'cors');
      direct = await o.viaServer(u.toString());
    }
    if (direct.buf.byteLength > LIMITS.document) throw err('That document is too large to read here.', 'too_large');
    if (/^text\/html/.test(direct.type) && !/\.(md|txt|css|json)$/i.test(direct.name)) throw err(u.host + ' returned a web page, not a document: the link most likely needs a sign-in or points at a viewer. Share it publicly, or download it and choose it with "Upload a file".', 'html_page');
    return readBytes(direct.buf, { name: direct.name, type: direct.type, url: direct.url || u.toString() });
  }

  /* ══ 9. a content hash, in every context ══════════════════════════════════
     crypto.subtle exists only in a secure context, and the file store keys a
     file by its content either way; this is the same SHA-256, in plain JS. */
  function sha256js(bytes) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length, withPad = ((l + 9 + 63) >> 6) << 6;
    var m = new Uint8Array(withPad); m.set(bytes); m[l] = 0x80;
    var bits = l * 8, dv = new DataView(m.buffer);
    dv.setUint32(withPad - 4, bits >>> 0); dv.setUint32(withPad - 8, Math.floor(bits / 4294967296));
    var w = new Uint32Array(64);
    for (var off = 0; off < withPad; off += 64) {
      for (var t = 0; t < 16; t++) w[t] = dv.getUint32(off + t * 4);
      for (t = 16; t < 64; t++) {
        var s0 = ((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^ ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^ (w[t - 15] >>> 3);
        var s1 = ((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^ ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  }
  async function sha256(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
        var d = await crypto.subtle.digest('SHA-256', u8);
        return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }
    } catch (_) { /* not a secure context */ }
    return sha256js(u8);
  }

  return {
    read: read, readUrl: readUrl, readBytes: readBytes, fromLines: fromLines, finishReport: finishReport,
    parseDesignMd: parseDesignMd, parseTokens: parseTokens, parseCss: parseCss, parseSvg: parseSvg,
    sanitizeSvg: sanitizeSvg, hexFromCmyk: hexFromCmyk, kindOf: kindOf, sha256: sha256, sha256js: sha256js,
    parseFontSpec: parseFontSpec, valueMatches: valueMatches, roleOf: roleOf,
    LIMITS: LIMITS, PDFJS: PDFJS, PDFJS_WORKER: PDFJS_WORKER,
  };
});
