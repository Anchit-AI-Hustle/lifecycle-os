'use strict';
/**
 * brand-extract.js — read a WHOLE brand off its own website.
 * ---------------------------------------------------------------------------
 * `/onboarding` asks the operator to type their brand in by hand: name,
 * tagline, logo, six colours, two typefaces, voice, banned phrases, regions.
 * The only thing the platform could read from a URL was the product CATALOGUE
 * (site-crawl.js). Everything that makes the app LOOK and SOUND like the brand
 * was manual, which is both the slowest part of onboarding and the part most
 * likely to be wrong (nobody remembers their own hex codes).
 *
 * This reads the rest of the brand from the same site, from the same crawl.
 *
 * ── THE CONTRACT: CANDIDATES WITH EVIDENCE, NEVER A CONFIDENT GUESS ─────────
 * Every value returned carries the URL it came from and the SIGNAL that
 * produced it. Nothing is written into the brand record by this module; it
 * returns a ranked candidate list per field and the operator confirms. A field
 * with no signal comes back empty with the spec's marker:
 *
 *     [DATA REQUIRED BEFORE LAUNCH: <field>, <product>, <region>]
 *
 * "100% correct" about an uncertain signal means REPORTING it as uncertain.
 * A site that publishes nothing machine-readable must produce an almost-empty
 * report, not a plausible one.
 *
 * ── THE BRAND-COLOUR vs DESIGN-SYSTEM-COLOUR TRAP ──────────────────────────
 * This is the single failure every naive extractor shares. A company's BRAND
 * colour and the colour of its primary BUTTON are different facts, and a tool
 * that ranks hexes by frequency returns them undistinguished — so an operator
 * activating the result gets a shell painted in whatever the checkout button
 * happened to be.
 *
 * Colours here are never pooled. Each sighting is classified by the ROLE the
 * site itself gave it, and the roles are reported separately:
 *
 *   identity  the site declaring its own colour, independent of any element:
 *             <meta name="theme-color">, manifest theme_color, a custom
 *             property whose NAME says brand (--brand, --brand-primary),
 *             <link rel="mask-icon" color>, a fill inside the logo mark.
 *   action    the design system's interactive colour: --primary / --accent /
 *             --cta / --button-*, and backgrounds on button/CTA selectors.
 *   surface   the page ground (html/body background).
 *   ink       body copy colour.
 *   support   everything else, frequency-ranked by property and selector
 *             weight, offered only as candidates.
 *
 * `proposed.primary` is filled ONLY from an identity signal, and the action
 * colour becomes the accent. When the two disagree the report carries a
 * `conflicts` entry naming both values and both sources, so the operator can
 * swap them knowingly. When there is NO identity signal, `proposed.primary`
 * stays EMPTY with a marker: the most-used colour on a page is a different
 * fact from the brand colour, and offering it as the brand colour is the exact
 * mistake this design exists to avoid.
 *
 * ── WHAT NO-BROWSER COSTS ──────────────────────────────────────────────────
 * Vercel serverless cannot run a headless browser, so this is CSS and HTML
 * PARSING, not rendering. Concretely it cannot see:
 *   * computed styles — a colour that only exists after the cascade, or that a
 *     framework writes onto elements at runtime;
 *   * anything injected by JavaScript — SPA-rendered headers, consent-gated
 *     themes, A/B-test palettes, client-side theme switchers;
 *   * which of several declared values actually WINS on screen (specificity
 *     and order are approximated by weighting, not resolved);
 *   * content behind a login, a region gate, or an interaction.
 * Those limits are returned to the caller in `limits[]` so a thin report is
 * legible as "the site did not publish this" rather than "the brand has none".
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * Mounted on the existing brand router: /api/brand?op=extract.
 * ---------------------------------------------------------------------------
 */

const siteCrawl = require('./site-crawl.js');

/**
 * Budgets. api/public-config.js runs with maxDuration 120s, and this whole
 * operation has to fit inside ONE invocation, so the three phases are bounded
 * separately rather than sharing one hopeful timeout:
 *   crawl 35s + assets 20s + one model call 25s = 80s worst case.
 * Every budget that runs out is REPORTED in `notes`, so a thin report is never
 * mistaken for a site that publishes nothing.
 */
const DEFAULTS = {
  maxPages: 14,
  maxDepth: 2,
  maxStylesheets: 8,
  perRequestMs: 7000,
  totalMs: 35000,
  assetMs: 20000,
  voiceMs: 25000,
  maxCssChars: 900000,     // per sheet
  maxTotalCssChars: 2500000,
  userAgent: 'LifecycleOS-BrandExtractor/1.0 (+brand identity discovery; respects robots.txt)',
};

/** The spec's missing-data marker. Never a value, always a report. */
function MARKER(field, product, region) {
  return `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${product || 'all'}, ${region || 'all'}]`;
}

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 300);

/* ═══════════════════════════════════════════════════════════════════════════
   1. COLOUR PARSING
   Everything is normalised to #rrggbb so two spellings of one colour rank as
   one colour. A syntax we cannot parse is COUNTED and reported, never dropped
   silently — an unreported drop looks identical to "the site has no colours".
   ═══════════════════════════════════════════════════════════════════════════ */

/** CSS Level 1 + the handful that actually turn up in production stylesheets. */
const NAMED_COLORS = {
  black: '#000000', silver: '#c0c0c0', gray: '#808080', grey: '#808080', white: '#ffffff',
  maroon: '#800000', red: '#ff0000', purple: '#800080', fuchsia: '#ff00ff', magenta: '#ff00ff',
  green: '#008000', lime: '#00ff00', olive: '#808000', yellow: '#ffff00', navy: '#000080',
  blue: '#0000ff', teal: '#008080', aqua: '#00ffff', cyan: '#00ffff', orange: '#ffa500',
};

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');

function hslToHex(h, s, l) {
  const hh = ((h % 360) + 360) % 360 / 360, ss = Math.max(0, Math.min(1, s)), ll = Math.max(0, Math.min(1, l));
  if (ss === 0) return toHex(ll * 255, ll * 255, ll * 255);
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const chan = (t) => {
    let x = t; if (x < 0) x += 1; if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return toHex(chan(hh + 1 / 3) * 255, chan(hh) * 255, chan(hh - 1 / 3) * 255);
}

/**
 * oklch()/oklab() → sRGB. Worth the maths rather than a "cannot parse" note:
 * Tailwind v4 and most 2025+ design systems ship their entire palette in oklch,
 * so a parser without it reports "this site declares no colours" about sites
 * that declare nothing but colours.
 */
function oklabToHex(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  const g = lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
    return v * 255;
  });
  return toHex(g[0], g[1], g[2]);
}

const numOf = (t) => {
  const s = String(t).trim();
  if (s.endsWith('%')) return { v: parseFloat(s) / 100, pct: true };
  const m = /^(-?[\d.]+)(deg|rad|grad|turn)?$/.exec(s);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (m[2] === 'rad') v = v * 180 / Math.PI;
  else if (m[2] === 'grad') v = v * 0.9;
  else if (m[2] === 'turn') v = v * 360;
  return { v, pct: false };
};

/**
 * One colour token in, #rrggbb out (or '' when it is not a colour we can
 * resolve). Alpha is parsed but deliberately DISCARDED from the hex: a brand
 * palette is opaque, and a 12%-alpha tint of the brand colour is the same
 * brand colour, not a second one.
 */
function parseColor(raw) {
  let s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/!important\s*$/, '').trim();
  if (NAMED_COLORS[s]) return NAMED_COLORS[s];

  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length === 6 || h.length === 8) return '#' + h.slice(0, 6);
    return '';
  }

  const fn = /^(rgba?|hsla?|oklch|oklab)\s*\(([^)]*)\)$/.exec(s);
  if (!fn) return '';
  const name = fn[1];
  // Both the legacy comma syntax and the modern `a b c / alpha` space syntax.
  const parts = fn[2].replace(/\//g, ' / ').split(/[\s,]+/).filter(Boolean);
  const slash = parts.indexOf('/');
  const args = slash >= 0 ? parts.slice(0, slash) : parts;

  if (name === 'rgb' || name === 'rgba') {
    if (args.length < 3) return '';
    const c = args.slice(0, 3).map(numOf);
    if (c.some((x) => !x)) return '';
    return toHex(...c.map((x) => (x.pct ? x.v * 255 : x.v)));
  }
  if (name === 'hsl' || name === 'hsla') {
    if (args.length < 3) return '';
    const h = numOf(args[0]), sa = numOf(args[1]), l = numOf(args[2]);
    if (!h || !sa || !l) return '';
    return hslToHex(h.v, sa.pct ? sa.v : sa.v / 100, l.pct ? l.v : l.v / 100);
  }
  if (name === 'oklch') {
    if (args.length < 3) return '';
    const L = numOf(args[0]), C = numOf(args[1]), H = numOf(args[2]);
    if (!L || !C || !H) return '';
    // numOf already divides a percentage by 100, and oklch lightness is 0..1,
    // so L needs nothing further. Chroma's percentage reference IS 0.4.
    const c = C.pct ? C.v * 0.4 : C.v;
    const hRad = H.v * Math.PI / 180;
    return oklabToHex(L.v, c * Math.cos(hRad), c * Math.sin(hRad));
  }
  if (name === 'oklab') {
    if (args.length < 3) return '';
    const L = numOf(args[0]), A = numOf(args[1]), B = numOf(args[2]);
    if (!L || !A || !B) return '';
    return oklabToHex(L.v, A.pct ? A.v * 0.4 : A.v, B.pct ? B.v * 0.4 : B.v);
  }
  return '';
}

/** Colour functions we cannot resolve — reported by name so the gap is visible. */
const UNPARSED_COLOR_FN = /\b(lab|lch|color|color-mix|light-dark|device-cmyk)\s*\(/gi;

/* ── colour classification helpers ──────────────────────────────────────── */

function rgbOf(hex) {
  const h = String(hex || '#000000');
  return [parseInt(h.slice(1, 3), 16) || 0, parseInt(h.slice(3, 5), 16) || 0, parseInt(h.slice(5, 7), 16) || 0];
}
function relLum(hex) {
  return rgbOf(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); })
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
}
function satOf(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const l = (mx + mn) / 2;
  return l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
}
/**
 * A neutral is not a BRAND colour candidate — it is a surface or an ink
 * candidate. Kept in those buckets rather than thrown away, because the page
 * ground and the body copy colour are exactly the two neutrals the palette
 * needs.
 */
function isNeutral(hex) {
  const l = relLum(hex), s = satOf(hex);
  return s < 0.12 || l > 0.93 || l < 0.02;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. CSS PARSING
   Enough of a parser to attribute a declaration to the selector it was written
   on, which is the whole point: `background:#0a0` on `.btn` is a different
   fact from `border-color:#0a0` on `.divider`.
   ═══════════════════════════════════════════════════════════════════════════ */

function stripComments(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Split a declaration block on `;` at paren depth 0, respecting quotes. */
function splitDecls(body) {
  const out = [];
  let buf = '', depth = 0, quote = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { buf += c; if (c === quote && body[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if (c === ';' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

function declsOf(body) {
  const out = [];
  for (const chunk of splitDecls(body)) {
    const i = chunk.indexOf(':');
    if (i < 0) continue;
    const prop = chunk.slice(0, i).trim().toLowerCase();
    const value = chunk.slice(i + 1).trim();
    if (!prop || !value || prop.includes('{')) continue;
    out.push({ prop, value });
  }
  return out;
}

/**
 * Flatten a stylesheet into `{selector, decls, at}` rulesets.
 *
 * Conditional group rules (@media, @supports, @layer, @container) are RECURSED
 * INTO rather than skipped, because a large share of a modern site's palette
 * lives inside a `@media (prefers-color-scheme: dark)` or an `@layer base`.
 * @keyframes is skipped outright: its body is nested rulesets of animation
 * steps, and an interpolated colour is not a brand fact.
 */
function cssRulesets(css, depth) {
  const d = depth || 0;
  if (d > 6) return [];
  const s = stripComments(css);
  const out = [];
  let i = 0, prelude = '';
  while (i < s.length) {
    const c = s[i];
    if (c === '{') {
      const sel = prelude.trim();
      prelude = '';
      let nest = 1, j = i + 1;
      while (j < s.length && nest > 0) {
        if (s[j] === '{') nest++;
        else if (s[j] === '}') nest--;
        j++;
      }
      const body = s.slice(i + 1, Math.max(i + 1, j - 1));
      i = j;
      if (!sel) continue;
      if (/^@(?:-\w+-)?keyframes\b/i.test(sel)) continue;
      if (sel.startsWith('@')) {
        const at = (sel.match(/^@[\w-]+/) || [''])[0].toLowerCase();
        if (at === '@font-face' || at === '@property' || at === '@page' || at === '@counter-style') {
          out.push({ selector: sel, at, decls: declsOf(body) });
        } else {
          for (const r of cssRulesets(body, d + 1)) out.push(r);
        }
        continue;
      }
      // Nested CSS: a ruleset body may itself contain rulesets.
      if (/[{]/.test(body)) {
        const own = body.replace(/[^{}]*\{[\s\S]*?\}/g, ' ');
        out.push({ selector: sel, at: '', decls: declsOf(own) });
        for (const r of cssRulesets(body, d + 1)) out.push({ selector: sel + ' ' + r.selector, at: r.at, decls: r.decls });
      } else {
        out.push({ selector: sel, at: '', decls: declsOf(body) });
      }
      continue;
    }
    if (c === '}') { prelude = ''; i++; continue; }
    prelude += c;
    if (prelude.length > 8000) prelude = prelude.slice(-4000);
    i++;
  }
  return out;
}

/**
 * Custom properties, with one-level-at-a-time `var()` resolution.
 *
 * `--primary: var(--brand-blue)` is the normal shape of a real design system,
 * and a reader that does not follow the reference sees a palette of the string
 * "var(--brand-blue)". Five passes is plenty for any chain a human wrote, and
 * a cycle simply stops resolving rather than hanging.
 */
function customProperties(rulesets) {
  const raw = new Map();
  const origin = new Map();
  for (const r of rulesets) {
    for (const d of r.decls) {
      if (!d.prop.startsWith('--')) continue;
      if (!raw.has(d.prop)) origin.set(d.prop, r.selector);
      raw.set(d.prop, d.value);
    }
  }
  for (let pass = 0; pass < 5; pass++) {
    let moved = false;
    for (const [k, v] of raw) {
      const m = /^var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)$/.exec(String(v).trim());
      if (!m) continue;
      const target = raw.has(m[1]) ? raw.get(m[1]) : (m[2] || '').trim();
      if (target && target !== v) { raw.set(k, target); moved = true; }
    }
    if (!moved) break;
  }
  return { values: raw, origin };
}

/* ── weighting ─────────────────────────────────────────────────────────────
   A frequency count over a stylesheet ranks the divider colour above the brand
   colour, because there are more dividers than buttons. Sightings are weighted
   by WHAT the colour was doing (property) and WHERE (selector) instead. */

function propWeight(prop) {
  if (prop === 'background' || prop === 'background-color') return 3;
  if (prop === 'color') return 2;
  if (prop === 'fill') return 2;
  if (prop === 'stroke') return 1.5;
  if (prop === 'background-image') return 1;
  if (prop.startsWith('border') && prop.endsWith('color')) return 0.8;
  if (prop === 'border') return 0.8;
  if (prop === 'outline' || prop === 'outline-color') return 0.5;
  if (prop === 'box-shadow' || prop === 'text-shadow') return 0.3;
  if (prop === 'accent-color' || prop === 'caret-color') return 1;
  return 0.6;
}

const RX_ACTION_SEL = /(?:^|[\s,>+~(])(?:button|\.btn\b|\.button\b|\.cta\b|\.buy\b|\.checkout\b|\.add-to-cart\b|\.shopify-payment-button|\[type=['"]?(?:submit|button))/i;
const RX_IDENTITY_SEL = /(?:logo|wordmark|brandmark|\.brand\b)/i;
const RX_GROUND_SEL = /(?:^|[\s,])(?:html|body|:root)(?=$|[\s,:.\[{])/i;
const RX_CHROME_SEL = /(?:header|nav\b|footer|masthead|topbar|site-head|announcement)/i;
const RX_HEADING_SEL = /(?:^|[\s,>+~])h[1-6](?=$|[\s,:.\[])/i;
const RX_LINK_SEL = /(?:^|[\s,>+~])a(?=$|[\s,:.\[])/i;

function selectorRole(sel) {
  const s = String(sel || '');
  if (RX_ACTION_SEL.test(s)) return 'action';
  if (RX_IDENTITY_SEL.test(s)) return 'identity';
  if (RX_GROUND_SEL.test(s)) return 'ground';
  if (RX_CHROME_SEL.test(s)) return 'chrome';
  if (RX_HEADING_SEL.test(s)) return 'heading';
  if (RX_LINK_SEL.test(s)) return 'link';
  return 'other';
}

const ROLE_WEIGHT = { action: 4, identity: 4, chrome: 3, ground: 3, heading: 2, link: 2, other: 1 };

/**
 * What a custom property's NAME claims about itself.
 *
 * This is the load-bearing distinction. `--brand-primary` is the site telling
 * us its BRAND colour. `--primary` is the site telling us its DESIGN SYSTEM's
 * primary role, which is usually the same colour and sometimes deliberately is
 * not. They are bucketed apart and compared, never merged.
 */
function tokenNameRole(name) {
  const n = String(name || '').toLowerCase();
  if (/brand/.test(n)) return 'identity';
  if (/(?:^|-)(?:primary|accent|cta|action|btn|button|link|highlight|theme)(?:-|$)/.test(n)) return 'action';
  if (/(?:^|-)(?:bg|background|surface|paper|canvas|page|body-bg)(?:-|$)/.test(n)) return 'surface';
  if (/(?:^|-)(?:ink|fg|foreground|text|copy|body-color|on-surface)(?:-|$)/.test(n)) return 'ink';
  if (/(?:^|-)(?:muted|subtle|secondary|dim|meta)(?:-|$)/.test(n)) return 'muted';
  if (/(?:^|-)(?:border|line|divider|rule|outline)(?:-|$)/.test(n)) return 'support';
  if (/(?:^|-)(?:success|ok|warn|warning|error|danger|info)(?:-|$)/.test(n)) return 'status';
  return '';
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. HTML HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function absolute(href, base) {
  try { return new URL(String(href || '').trim(), base).toString().split('#')[0]; } catch (_) { return ''; }
}
function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; }
}

function attrs(tag) {
  const out = {};
  for (const m of String(tag).matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4]);
  }
  return out;
}

const tagsOf = (html, name) => [...String(html).matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);

function textBetween(html, tag) {
  const out = [];
  for (const m of String(html).matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))) out.push(m[1]);
  return out;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}

/** The <head>, which is where every declared identity signal lives. */
function headOf(html) {
  const m = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(String(html));
  return m ? m[1] : String(html).slice(0, 40000);
}

function footerOf(html) {
  const m = /<footer\b[^>]*>([\s\S]*?)<\/footer>/i.exec(String(html));
  return m ? m[1] : '';
}

const jsonLdNodes = (html) => siteCrawl.jsonLdBlocks(html);
const metaOf = (html) => siteCrawl.metaTags(html);

function ldType(node) {
  const t = node && node['@type'];
  const list = Array.isArray(t) ? t : [t];
  return list.filter(Boolean).map((x) => String(x).toLowerCase());
}
const isOrgNode = (n) => ldType(n).some((t) => t === 'organization' || t === 'corporation' || t === 'localbusiness' || t === 'store' || t === 'onlinestore' || t === 'brand' || /business|shop|restaurant|agency/.test(t));

/* ═══════════════════════════════════════════════════════════════════════════
   4. PER-FIELD SIGNAL COLLECTION
   Each collector returns candidates in PRIORITY ORDER, and every candidate
   carries { value, signal, source_url, confidence, evidence }.
   ═══════════════════════════════════════════════════════════════════════════ */

const CONF = { declared: 'declared', strong: 'strong', weak: 'weak' };

function cand(value, signal, sourceUrl, confidence, evidence, extra) {
  if (!value) return null;
  return Object.assign({
    value: typeof value === 'string' ? clip(value, 500) : value,
    signal, source_url: sourceUrl || '', confidence: confidence || CONF.weak,
    evidence: clip(evidence, 300),
  }, extra || {});
}

/** Trailing separators and the tagline half of a <title>. */
const TITLE_SPLIT = /\s+[|–—·•:>\-]{1,2}\s+/;

function nameCandidates(ctx) {
  const { html, url, meta, ld, manifest, isHome } = ctx;
  const out = [];
  for (const n of ld) {
    if (!n || typeof n !== 'object') continue;
    const types = ldType(n);
    if (!(isOrgNode(n) || types.includes('website'))) continue;
    const rawType = String(Array.isArray(n['@type']) ? n['@type'][0] : (n['@type'] || 'Organization'));
    const v = typeof n.name === 'string' ? n.name : '';
    if (v) out.push(cand(v, `json-ld:${rawType}.name`, url, CONF.declared, v));
    if (typeof n.alternateName === 'string' && n.alternateName) {
      out.push(cand(n.alternateName, 'json-ld:alternateName', url, CONF.strong, n.alternateName));
    }
  }
  if (meta['og:site_name']) out.push(cand(meta['og:site_name'], 'opengraph:og:site_name', url, CONF.declared, meta['og:site_name']));
  if (meta['application-name']) out.push(cand(meta['application-name'], 'meta:application-name', url, CONF.strong, meta['application-name']));
  if (manifest && manifest.name) out.push(cand(manifest.name, 'manifest:name', manifest.__url, CONF.declared, manifest.name));
  if (manifest && manifest.short_name) out.push(cand(manifest.short_name, 'manifest:short_name', manifest.__url, CONF.strong, manifest.short_name));

  // <title> is a last resort AND an ambiguous one. "Acme | Handmade boots" and
  // "Handmade boots | Acme" are both common, so BOTH halves are offered as
  // separate weak candidates rather than a rule that silently picks wrong.
  // Only the HOME page's title is read: a subpage title's other half is the
  // page name ("About | Acme"), which is not a brand-name candidate at all.
  const title = isHome ? clip((textBetween(html, 'title')[0] || ''), 200) : '';
  if (title) {
    const parts = title.split(TITLE_SPLIT).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1) out.push(cand(parts[0], 'html:title', url, CONF.weak, title));
    else if (parts.length > 1) {
      out.push(cand(parts[parts.length - 1], 'html:title(last segment)', url, CONF.weak, title));
      out.push(cand(parts[0], 'html:title(first segment)', url, CONF.weak, title));
    }
  }
  if (isHome && meta['twitter:site'] && /^@/.test(meta['twitter:site'])) {
    out.push(cand(meta['twitter:site'].replace(/^@/, ''), 'meta:twitter:site', url, CONF.weak, meta['twitter:site']));
  }
  return out.filter(Boolean);
}

function taglineCandidates(ctx) {
  const { html, url, meta, ld, isHome } = ctx;
  const out = [];
  for (const n of ld) {
    if (!n || typeof n !== 'object') continue;
    const rawType = String(Array.isArray(n['@type']) ? n['@type'][0] : (n['@type'] || 'Organization'));
    if (typeof n.slogan === 'string' && n.slogan) out.push(cand(n.slogan, `json-ld:${rawType}.slogan`, url, CONF.declared, n.slogan));
    if (isOrgNode(n) && typeof n.description === 'string' && n.description) {
      out.push(cand(n.description, `json-ld:${rawType}.description`, url, CONF.strong, n.description));
    }
  }
  if (meta['og:description']) out.push(cand(meta['og:description'], 'opengraph:og:description', url, CONF.strong, meta['og:description']));
  if (meta.description) out.push(cand(meta.description, 'meta:description', url, CONF.strong, meta.description));
  if (isHome) {
    const h1 = stripTags(textBetween(html, 'h1')[0] || '');
    if (h1) out.push(cand(h1, 'html:h1(home hero)', url, CONF.weak, h1));
  }
  return out.filter(Boolean);
}

/**
 * Logo candidates, ALL of them, ranked. Deliberately not collapsed to one:
 * a favicon, an apple-touch-icon, an og:image and a header <img class="logo">
 * are four different pictures and only the operator knows which one is the
 * logo they want the platform to use.
 *
 * OFF-ORIGIN candidates are KEPT and FLAGGED rather than dropped. A brand's
 * logo very often sits on a CDN it never declared as an asset host, so the
 * catalogue crawler's rule (same-origin or nothing) would return no logo at
 * all for most Shopify stores. Dropping it silently and flagging it are both
 * honest; dropping it is just less useful. Nothing is auto-applied either way.
 */
function logoCandidates(ctx) {
  const { html, url, meta, ld, manifest, hosts } = ctx;
  const out = [];
  const push = (raw, signal, conf, evidence) => {
    const abs = absolute(raw, url);
    if (!abs || !/^https?:/i.test(abs)) return;
    const off = !siteCrawl.inScope(abs, hosts);
    out.push(cand(abs, signal, url, conf, evidence, off ? { off_origin: true, host: hostOf(abs) } : { off_origin: false }));
  };

  for (const n of ld) {
    if (!n || typeof n !== 'object' || !isOrgNode(n)) continue;
    const lg = n.logo;
    const u = typeof lg === 'string' ? lg : (lg && (lg.url || lg.contentUrl)) || '';
    if (u) push(u, 'json-ld:Organization.logo', CONF.declared, 'schema.org Organization.logo');
  }
  // AN ICON IS NOT A LOGO, and this bag used to conflate them.
  //
  // Manifest icons and apple-touch-icons were pushed at `declared`, and the
  // site's own labelled wordmark at `strong`. rankCandidates sorts by
  // confidence, so a 512px square PWA tile beat `<img class="logo">` every
  // time: a real site publishing both had its APP ICON chosen as the brand
  // logo, and that is what then went into every mailer, ad and landing page
  // where a wordmark belongs.
  //
  // The site labelling an image "logo" is the strongest statement about its
  // logo that a page can make, so that ranks first here. Square app icons are
  // still collected — they are the right art for a favicon or an avatar — but
  // as `icons`, their own field, and they enter the LOGO bag only as a weak
  // last resort so a site with no labelled wordmark still gets something.
  for (const tag of tagsOf(html, 'img')) {
    const a = attrs(tag);
    const hay = [a.class, a.id, a.alt, a.src, a['data-src'], a.title].join(' ').toLowerCase();
    if (!/logo|wordmark|brandmark/.test(hay)) continue;
    const src = a.src || a['data-src'] || a['data-srcset'] || '';
    if (src) push(String(src).split(/\s|,/)[0], 'html:img[logo]', CONF.declared, clip(tag, 200));
  }
  if (manifest && Array.isArray(manifest.icons)) {
    const sized = manifest.icons
      .map((ic) => ({ src: ic && ic.src, area: Math.max(0, ...String((ic && ic.sizes) || '').split(/\s+/).map((s) => { const m = /^(\d+)x(\d+)$/i.exec(s); return m ? +m[1] * +m[2] : 0; })) }))
      .filter((x) => x.src).sort((a, b) => b.area - a.area);
    for (const ic of sized.slice(0, 3)) {
      push(absolute(ic.src, manifest.__url || url), `manifest:icons(${ic.area ? Math.round(Math.sqrt(ic.area)) + 'px' : 'unsized'})`, CONF.weak, 'web app manifest icon - a square app tile, not a wordmark');
    }
  }
  const head = headOf(html);
  for (const tag of tagsOf(head, 'link')) {
    const a = attrs(tag);
    const rel = String(a.rel || '').toLowerCase();
    if (!a.href) continue;
    if (/apple-touch-icon/.test(rel)) push(a.href, 'link:apple-touch-icon', CONF.weak, tag);
    else if (/(^|\s)mask-icon(\s|$)/.test(rel)) push(a.href, 'link:mask-icon', CONF.weak, tag);
    else if (/(^|\s)(icon|shortcut icon)(\s|$)/.test(rel)) push(a.href, 'link:icon(favicon)', CONF.weak, tag);
  }
  if (meta['og:image']) push(meta['og:image'], 'opengraph:og:image', CONF.weak, 'og:image is often a share card, not a logo');
  if (meta['twitter:image']) push(meta['twitter:image'], 'meta:twitter:image', CONF.weak, 'twitter:image is often a share card, not a logo');
  return out.filter(Boolean);
}

/**
 * The brand's ICON SET, as its own field rather than mixed into the logo bag.
 *
 * A favicon, an apple-touch-icon and a manifest icon are square marks for a
 * tab, a home screen and an app tile. They are the right art for an avatar or
 * a favicon and the WRONG art where a wordmark belongs, which is why they are
 * reported separately with their declared size and purpose instead of being
 * ranked against the logo.
 *
 * Sizes are taken from what the site DECLARED (`sizes`, the manifest's own
 * field). Nothing is measured: reading the pixel dimensions would mean
 * fetching every image, and a declared size that turns out to be wrong is the
 * site's statement, reported as such.
 */
function iconCandidates(ctx) {
  const { html, url, manifest, hosts } = ctx;
  const out = [];
  const push = (raw, signal, conf, evidence, extra) => {
    const abs = absolute(raw, url);
    if (!abs || !/^https?:/i.test(abs)) return;
    const off = !siteCrawl.inScope(abs, hosts);
    out.push(cand(abs, signal, url, conf, evidence,
      Object.assign({ off_origin: off, host: off ? hostOf(abs) : '' }, extra || {})));
  };
  const px = (sizes) => {
    const n = Math.max(0, ...String(sizes || '').split(/\s+/)
      .map((t) => { const m = /^(\d+)x(\d+)$/i.exec(t); return m ? Math.min(+m[1], +m[2]) : 0; }));
    return n || null;
  };
  if (manifest && Array.isArray(manifest.icons)) {
    for (const ic of manifest.icons) {
      if (!ic || !ic.src) continue;
      push(absolute(ic.src, manifest.__url || url), 'manifest:icons', CONF.declared,
        'web app manifest icon', { size_px: px(ic.sizes), sizes: ic.sizes || '', purpose: ic.purpose || '', mime: ic.type || '' });
    }
  }
  for (const tag of tagsOf(headOf(html), 'link')) {
    const a = attrs(tag);
    const rel = String(a.rel || '').toLowerCase();
    if (!a.href) continue;
    if (/apple-touch-icon/.test(rel)) push(a.href, 'link:apple-touch-icon', CONF.declared, tag, { size_px: px(a.sizes), sizes: a.sizes || '', purpose: 'ios-home-screen' });
    else if (/(^|\s)mask-icon(\s|$)/.test(rel)) push(a.href, 'link:mask-icon', CONF.declared, tag, { size_px: null, purpose: 'safari-pinned-tab', color: a.color || '' });
    else if (/(^|\s)(icon|shortcut icon)(\s|$)/.test(rel)) push(a.href, 'link:icon', CONF.declared, tag, { size_px: px(a.sizes), sizes: a.sizes || '', purpose: 'favicon', mime: a.type || '' });
  }
  return out.filter(Boolean);
}

/**
 * The brand's own IMAGERY, so generation has real photographs to work from
 * instead of a marker.
 *
 * Only images the site published about ITSELF: its share card, the images its
 * own structured data attaches to a product or article, and in-content <img>
 * that carry real alt text. Everything records the page it was found on, so an
 * operator can see which product a photograph belongs to.
 *
 * DELIBERATE EXCLUSIONS. Anything already collected as a logo or an icon (a
 * wordmark is not photography). Sprites, spacers, tracking pixels and data:
 * URIs. Off-origin images are kept but FLAGGED: a CDN on another host is
 * normal, and a hotlinked stock photo is not the brand's to use, and this
 * module cannot tell those apart - so it reports the host and lets the
 * operator decide rather than silently adopting it.
 */
function imageCandidates(ctx) {
  const { html, url, meta, ld, hosts } = ctx;
  const out = [];
  const seen = new Set();
  const JUNK = /(sprite|spacer|pixel|1x1|blank|placeholder|loading|skeleton|tracking)/i;
  const push = (raw, signal, conf, evidence, extra) => {
    const first = String(raw || '').split(/\s|,/)[0];
    const abs = absolute(first, url);
    if (!abs || !/^https?:/i.test(abs)) return;      // skips data: and inline
    if (JUNK.test(abs)) return;
    const k = abs.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    const off = !siteCrawl.inScope(abs, hosts);
    out.push(cand(abs, signal, url, conf, evidence,
      Object.assign({ off_origin: off, host: off ? hostOf(abs) : '' }, extra || {})));
  };

  // Structured data the site attached to a product or article: the strongest
  // statement that an image belongs to a specific thing it sells.
  for (const n of ld) {
    if (!n || typeof n !== 'object') continue;
    const type = String(n['@type'] || '').toLowerCase();
    if (!/product|article|offer|imageobject/.test(type)) continue;
    const imgs = Array.isArray(n.image) ? n.image : (n.image ? [n.image] : []);
    for (const im of imgs) {
      const u = typeof im === 'string' ? im : (im && (im.url || im.contentUrl)) || '';
      if (u) push(u, `json-ld:${n['@type']}.image`, CONF.declared, `structured data for ${clip(n.name || type, 80)}`, { subject: n.name || '', kind: 'product' });
    }
  }
  if (meta['og:image']) push(meta['og:image'], 'opengraph:og:image', CONF.strong, 'the page share card', { kind: 'share-card' });
  if (meta['twitter:image']) push(meta['twitter:image'], 'meta:twitter:image', CONF.strong, 'the page share card', { kind: 'share-card' });

  // In-content <img> with real alt text. No alt means the site itself treats it
  // as decoration, and decoration is not brand imagery.
  for (const tag of tagsOf(html, 'img')) {
    const a = attrs(tag);
    const hay = [a.class, a.id, a.alt, a.src, a.title].join(' ').toLowerCase();
    if (/logo|wordmark|brandmark|icon|favicon/.test(hay)) continue;   // logo/icon fields own these
    const alt = String(a.alt || '').trim();
    if (!alt) continue;
    const src = a.src || a['data-src'] || a['data-srcset'] || a.srcset || '';
    if (src) push(src, 'html:img[alt]', CONF.strong, clip(tag, 200), { alt, kind: 'content' });
  }
  return out.filter(Boolean);
}

/**
 * An inline <svg> logo has no URL, so it cannot become `logo_url`. Reporting
 * the markup and saying plainly that it must be exported and hosted beats both
 * silence and a fabricated URL.
 */
function inlineSvgLogo(html, url) {
  const scope = (/<header\b[\s\S]*?<\/header>/i.exec(html) || [''])[0] || String(html).slice(0, 20000);
  for (const m of scope.matchAll(/<svg\b[\s\S]{0,20000}?<\/svg>/gi)) {
    const svg = m[0];
    const around = scope.slice(Math.max(0, m.index - 200), m.index + 200).toLowerCase();
    if (!/logo|wordmark|brand/.test(around) && !/logo|wordmark|brand/.test(svg.slice(0, 300).toLowerCase())) continue;
    return {
      signal: 'html:inline <svg> in header',
      source_url: url,
      markup: svg.slice(0, 20000),
      note: 'The header logo is an inline <svg>, which has no URL of its own. Export it from the site and host it, then paste that URL — this platform will not mint a URL that does not exist.',
    };
  }
  return null;
}

/* ── palette ───────────────────────────────────────────────────────────── */

/**
 * Every colour sighting on one page, already classified by role. `sheets` are
 * the CSS bodies attributed to this page (inline <style> blocks plus whatever
 * linked stylesheets were fetched).
 */
function colourSightings(ctx) {
  const { html, url, meta, manifest, sheets, isHome } = ctx;
  const sightings = [];
  const unparsed = new Map();
  const add = (hex, role, weight, signal, sourceUrl, evidence) => {
    if (!hex) return;
    sightings.push({ hex, role, weight, signal, source_url: sourceUrl || url, evidence: clip(evidence, 220) });
  };

  // ── identity: the site declaring its own colour, with no element involved.
  if (meta['theme-color']) {
    add(parseColor(meta['theme-color']), 'identity', 100, 'meta:theme-color', url, `<meta name="theme-color" content="${clip(meta['theme-color'], 40)}">`);
  }
  // The manifest is ONE document for the whole site. Counting it once per page
  // would let a 20-page crawl inflate a single declaration into 20 sightings
  // and drown every other signal, so it is read on the home page only.
  if (isHome && manifest && manifest.theme_color) {
    add(parseColor(manifest.theme_color), 'identity', 90, 'manifest:theme_color', manifest.__url || url, `"theme_color": "${clip(manifest.theme_color, 40)}"`);
  }
  if (isHome && manifest && manifest.background_color) {
    add(parseColor(manifest.background_color), 'surface', 60, 'manifest:background_color', manifest.__url || url, `"background_color": "${clip(manifest.background_color, 40)}"`);
  }
  for (const tag of tagsOf(headOf(html), 'link')) {
    const a = attrs(tag);
    if (/mask-icon/i.test(String(a.rel || '')) && a.color) {
      add(parseColor(a.color), 'identity', 70, 'link:mask-icon[color]', url, clip(tag, 160));
    }
  }

  for (const sheet of sheets) {
    const css = sheet.css || '';
    for (const m of css.matchAll(UNPARSED_COLOR_FN)) {
      const fn = m[1].toLowerCase();
      unparsed.set(fn, (unparsed.get(fn) || 0) + 1);
    }
    const rules = cssRulesets(css);
    const { values, origin } = customProperties(rules);

    // ── custom properties: the site's own names for its own colours.
    for (const [name, rawVal] of values) {
      const hex = parseColor(rawVal);
      if (!hex) continue;
      const role = tokenNameRole(name);
      if (!role) continue;
      const w = role === 'identity' ? 80 : role === 'action' ? 55 : 40;
      add(hex, role === 'support' || role === 'status' ? 'support' : role, w,
        `css:custom-property ${name}`, sheet.url, `${name}: ${clip(rawVal, 60)};  (declared on ${clip(origin.get(name) || '?', 60)})`);
    }

    // ── declarations, weighted by property and by the selector they sit on.
    for (const r of rules) {
      if (r.at) continue;
      const selRole = selectorRole(r.selector);
      for (const d of r.decls) {
        if (d.prop.startsWith('--')) continue;
        if (!/color|background|fill|stroke|shadow|outline|border/.test(d.prop)) continue;
        // Resolve `var(--x)` against this sheet's own tokens before parsing.
        let raw = d.value;
        const vm = /var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/.exec(raw);
        if (vm) raw = values.has(vm[1]) ? values.get(vm[1]) : (vm[2] || '').trim();
        // A shorthand like `border: 1px solid #ccc` needs its colour token.
        let hex = parseColor(raw);
        if (!hex) {
          const tok = String(raw).match(/#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch|oklab)\s*\([^)]*\)/);
          if (tok) hex = parseColor(tok[0]);
        }
        if (!hex) continue;

        const weight = propWeight(d.prop) * (ROLE_WEIGHT[selRole] || 1);
        let role = 'support';
        if (selRole === 'action' && /^background/.test(d.prop)) role = 'action';
        else if (selRole === 'identity' && /^(background|fill|color)/.test(d.prop)) role = 'identity';
        else if (selRole === 'ground' && /^background/.test(d.prop)) role = 'surface';
        else if (selRole === 'ground' && d.prop === 'color') role = 'ink';
        add(hex, role, weight, `css:${d.prop} on ${clip(r.selector, 60)}`, sheet.url, `${clip(r.selector, 80)} { ${d.prop}: ${clip(d.value, 60)} }`);
      }
    }
  }
  return { sightings, unparsed: [...unparsed.entries()].map(([fn, n]) => ({ fn, occurrences: n })) };
}

/** Collapse sightings into ranked, evidence-carrying candidates per role. */
function rankColours(sightings) {
  const byRole = {};
  for (const s of sightings) {
    const bucket = byRole[s.role] || (byRole[s.role] = new Map());
    const row = bucket.get(s.hex) || { value: s.hex, score: 0, sightings: [] };
    row.score += s.weight;
    if (row.sightings.length < 6) row.sightings.push({ signal: s.signal, source_url: s.source_url, evidence: s.evidence });
    bucket.set(s.hex, row);
  }
  const out = {};
  for (const [role, bucket] of Object.entries(byRole)) {
    out[role] = [...bucket.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((r) => ({
        value: r.value,
        score: Math.round(r.score * 10) / 10,
        signal: r.sightings[0] ? r.sightings[0].signal : '',
        source_url: r.sightings[0] ? r.sightings[0].source_url : '',
        confidence: role === 'identity' ? CONF.declared : (role === 'action' ? CONF.strong : CONF.weak),
        evidence: r.sightings[0] ? r.sightings[0].evidence : '',
        seen: r.sightings,
        neutral: isNeutral(r.value),
      }));
  }
  return out;
}

/**
 * Turn ranked roles into a PROPOSAL — and refuse to when the evidence does not
 * support one.
 *
 * The rules, in full:
 *   * `primary` is only filled from an IDENTITY signal. No identity signal
 *     means an empty primary and a marker, however many colours the site has.
 *   * When identity and action disagree, the disagreement is REPORTED and the
 *     action colour becomes the accent candidate. The operator resolves it.
 *   * `surface` and `ink` come from the page ground; a dark-neutral ground is
 *     reported, not silently replaced (validatePalette blocks it downstream).
 *   * Nothing is derived, mixed, lightened or invented to fill a gap.
 */
function proposePalette(roles) {
  const firstBrandy = (list) => (list || []).find((c) => !c.neutral) || null;
  const identity = firstBrandy(roles.identity);
  const action = firstBrandy(roles.action);
  const support = firstBrandy(roles.support);
  const conflicts = [];
  const notes = [];

  const surfaceList = (roles.surface || []).filter((c) => c.neutral || relLum(c.value) > 0.6);
  const surface = surfaceList[0] || (roles.surface || [])[0] || null;
  const inkList = (roles.ink || []).filter((c) => relLum(c.value) < 0.5);
  const ink = inkList[0] || (roles.ink || [])[0] || null;

  if (identity && action && identity.value !== action.value) {
    conflicts.push({
      kind: 'brand_colour_vs_action_colour',
      message: `The site declares ${identity.value} as its own colour (${identity.signal}) but paints its primary action surfaces ${action.value} (${action.signal}). These are different facts and only you know which one is the brand primary. Both are offered; nothing was chosen for you.`,
      identity: { value: identity.value, signal: identity.signal, source_url: identity.source_url },
      action: { value: action.value, signal: action.signal, source_url: action.source_url },
    });
  }
  if (!identity) {
    notes.push('No identity-level colour signal was found (no theme-color, no manifest theme_color, no --brand-* custom property, no mask-icon colour). The primary is left empty on purpose: the most-used colour on a page is not the same fact as the brand colour.');
  }

  // The accent is the action colour whenever that is a DIFFERENT colour from
  // the primary. When the site paints its buttons in its own brand colour
  // there is no second colour to propose, and the next-ranked support colour is
  // offered instead of repeating the primary.
  const accentPick = (action && (!identity || action.value !== identity.value)) ? action : support;
  const muted = (roles.muted || [])[0] || null;
  /**
   * Every proposal carries the CONFIDENCE and the ROLE it came from.
   *
   * Without these a consumer cannot tell a colour the site DECLARED from one
   * that merely ranked highest among the leftovers - and both the wizard and
   * the DESIGN.md renderer were presenting the two identically, which is how a
   * frequency-ranked divider colour comes to be shown as a brand's accent with
   * the same authority as its own theme-color.
   */
  const src = (c, fromRole) => (c ? {
    signal: c.signal, source_url: c.source_url, evidence: c.evidence,
    confidence: c.confidence || CONF.weak,
    from_role: fromRole,
    // Said plainly, because "support" means "nothing in the site said this is a
    // brand colour; it is simply the most-weighted thing left".
    ranked_not_declared: fromRole === 'support' || fromRole === 'muted',
  } : null);

  const proposed = {
    primary: identity ? identity.value : '',
    accent: accentPick ? accentPick.value : '',
    ink: ink ? ink.value : '',
    surface: surface ? surface.value : '',
    surface_alt: '',            // no site declares a "card" colour; the operator picks it
    muted: muted ? muted.value : '',
  };
  const sources = {
    primary: src(identity, 'identity'),
    accent: src(accentPick, accentPick && action && accentPick.value === action.value ? 'action' : 'support'),
    ink: src(ink, 'ink'),
    surface: src(surface, 'surface'),
    muted: src(muted, 'muted'),
  };
  // Every empty role is a reported gap, never a filled-in default. surface_alt
  // and muted are optional in the brand record, so their absence is not a gap.
  const missing = Object.entries(proposed).filter(([k, v]) => !v && k !== 'surface_alt' && k !== 'muted').map(([k]) => k);
  return { proposed, sources, conflicts, notes, missing };
}

/* ── typography ────────────────────────────────────────────────────────── */

const GENERIC_FAMILIES = /^(?:sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|-apple-system|blinkmacsystemfont|inherit|initial|unset|revert|emoji|math|fangsong)$/i;

function familiesOf(stack) {
  return String(stack || '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}
function primaryFamily(stack) {
  for (const f of familiesOf(stack)) if (!GENERIC_FAMILIES.test(f) && !/^var\(/.test(f)) return f;
  return '';
}

/** Google Fonts hrefs are PARSED, never fetched — the href already names the family and its weights. */
function googleFontLinks(html, url) {
  const out = [];
  for (const tag of tagsOf(html, 'link')) {
    const a = attrs(tag);
    const href = String(a.href || '');
    if (!/fonts\.googleapis\.com\/css/i.test(href)) continue;
    let u; try { u = new URL(href, url); } catch (_) { continue; }
    const fams = [];
    for (const [k, v] of u.searchParams) {
      if (k.toLowerCase() !== 'family') continue;
      // css2:  family=Inter:wght@400;700        css:  family=Inter:400,700|Lora
      for (const chunk of String(v).split('|')) {
        const [famRaw, spec] = chunk.split(':');
        const family = String(famRaw || '').replace(/\+/g, ' ').trim();
        if (!family) continue;
        const weights = (String(spec || '').match(/\d{3}/g) || []).filter((w, i, arr) => arr.indexOf(w) === i).join(';');
        fams.push({ family, weights });
      }
    }
    if (fams.length) out.push({ href: u.toString(), families: fams, source_url: url });
  }
  return out;
}

function typographyCandidates(ctx) {
  const { html, url, sheets } = ctx;
  const heading = [], body = [], mono = [], faces = [];
  const links = googleFontLinks(html, url);

  for (const sheet of sheets) {
    const rules = cssRulesets(sheet.css || '');
    const { values, origin } = customProperties(rules);

    for (const [name, val] of values) {
      const n = name.toLowerCase();
      if (!/font|type|family/.test(n)) continue;
      const fam = primaryFamily(val);
      if (!fam) continue;
      const c = cand(fam, `css:custom-property ${name}`, sheet.url, CONF.declared, `${name}: ${clip(val, 90)};  (declared on ${clip(origin.get(name) || '?', 50)})`, { stack: clip(val, 200) });
      if (/head|title|display|hero|serif-display/.test(n)) heading.push(c);
      else if (/mono|code/.test(n)) mono.push(c);
      else if (/body|text|base|sans|copy|paragraph|default/.test(n)) body.push(c);
      else { heading.push(c); body.push(c); }   // ambiguous name: offered to both, chosen by neither
    }

    for (const r of rules) {
      if (r.at === '@font-face') {
        const fam = r.decls.find((d) => d.prop === 'font-family');
        if (fam) {
          const f = primaryFamily(fam.value);
          if (f) faces.push(cand(f, 'css:@font-face', sheet.url, CONF.declared, `@font-face { font-family: ${clip(fam.value, 60)} }`));
        }
        continue;
      }
      if (r.at) continue;
      const decl = r.decls.find((d) => d.prop === 'font-family' || d.prop === 'font');
      if (!decl) continue;
      let stack = decl.value;
      if (decl.prop === 'font') {
        const m = /(?:\d+(?:\.\d+)?(?:px|rem|em|%|pt)(?:\s*\/\s*[\d.]+\w*)?)\s+(.+)$/.exec(stack);
        stack = m ? m[1] : '';
      }
      const vm = /var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/.exec(stack);
      if (vm) stack = values.has(vm[1]) ? values.get(vm[1]) : (vm[2] || '').trim();
      const fam = primaryFamily(stack);
      if (!fam) continue;
      const role = selectorRole(r.selector);
      const c = cand(fam, `css:font-family on ${clip(r.selector, 60)}`, sheet.url, role === 'heading' || role === 'ground' ? CONF.strong : CONF.weak,
        `${clip(r.selector, 80)} { font-family: ${clip(decl.value, 70)} }`, { stack: clip(stack, 200) });
      if (role === 'heading') heading.push(c);
      else if (role === 'ground') body.push(c);
      else if (/mono|code|pre|kbd/i.test(r.selector)) mono.push(c);
    }
  }

  // A Google Fonts href proves the family is LOADED, not what it is used for,
  // and the order families appear in the href means nothing. So it only ever
  // fills a slot nothing better claimed, and it fills it WEAKLY: the operator
  // is being told "your site loads this", not "this is your heading face".
  for (const l of links) {
    for (const f of l.families) {
      const c = cand(f.family, 'link:fonts.googleapis.com', l.source_url, CONF.weak,
        `family=${f.family}${f.weights ? ':wght@' + f.weights : ''} — loaded by the page, but no rule was found saying where it is used`,
        { google: true, weights: f.weights || '' });
      if (!heading.length) heading.push(c);
      if (!body.length && (l.families.length > 1 ? f !== l.families[0] : true)) body.push(c);
    }
  }

  const dedupe = (list) => {
    const seen = new Set(), out = [];
    for (const c of list.filter(Boolean)) {
      const k = c.value.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(c);
    }
    return out.slice(0, 8);
  };
  const known = new Set(links.flatMap((l) => l.families.map((f) => f.family.toLowerCase())));
  const mark = (list) => list.map((c) => Object.assign({}, c, {
    google: c.google === true || known.has(c.value.toLowerCase()),
    weights: c.weights || (links.flatMap((l) => l.families).find((f) => f.family.toLowerCase() === c.value.toLowerCase()) || {}).weights || '',
  }));
  return {
    heading: mark(dedupe(heading)), body: mark(dedupe(body)), mono: mark(dedupe(mono)),
    font_faces: dedupe(faces), google_font_links: links,
  };
}

/* ── type scale, weight, rhythm and text colour ────────────────────────────
   WHAT THIS REPLACED, and why the old answer was wrong. Until now the extractor
   read font FAMILIES and nothing else, and both this module and the context
   pack said so in as many words: "Font size, weight, line-height and letter
   spacing cannot be observed", followed by a
   [DATA REQUIRED BEFORE LAUNCH: typography scale] marker. That was an honest
   statement of a limit that did not exist. A `font-size` on `h1` is published in
   exactly the same stylesheet, on exactly the same selector, as the
   `font-family` beside it — the module simply never looked at the property.

   So these are read with the SAME rules and the SAME honesty as families:
     · a named custom property (`--text-lg`, `--font-size-base`, `--leading-tight`)
       is `declared` — the site is stating its own scale;
     · a declaration on a bare `h1`..`h6`, `body` or `:root` selector is `strong`;
     · anything else is `weak`, offered and not chosen.
   The caveats that apply to colour apply here unchanged and are repeated in
   `limits`: no browser renders the page, so a size set by JavaScript or won by a
   cascade this module approximates is not what a visitor sees.

   TEXT COLOUR is gathered here too, not in the palette. The palette's job is the
   brand's colours by ROLE; this is what colour a heading, a paragraph and a link
   are actually painted, which is a typographic fact and the thing an operator
   means when they ask what their font colours are. */

const TYPE_TOKEN_GROUPS = [
  ['size', /(?:^|-)(?:font-?size|text|fs|type|step)(?:-|\d|$)/,
    /^(?:[\d.]+(?:px|rem|em|pt|%)|clamp\(.+\)|calc\(.+\))$/i],
  ['weight', /(?:^|-)(?:font-?weight|weight|fw)(?:-|\d|$)/,
    /^(?:[1-9]00|1000|normal|bold|lighter|bolder)$/i],
  ['leading', /(?:^|-)(?:line-?height|leading|lh)(?:-|\d|$)/,
    /^(?:[\d.]+(?:px|rem|em|%)?|normal)$/i],
  ['tracking', /(?:^|-)(?:letter-?spacing|tracking|ls)(?:-|\d|$)/,
    /^(?:-?[\d.]+(?:px|rem|em)|normal)$/i],
];

/** The typographic slot a selector speaks for: h1..h6, body, link or button. */
function typeSlot(sel) {
  const s = String(sel || '');
  const h = /(?:^|[\s,>+~])h([1-6])(?=$|[\s,:.\[{])/i.exec(s);
  if (h) return 'h' + h[1];
  // `html` / `:root` is the ROOT, not the body, and conflating them loses the
  // real body size. A site that sets `html { font-size: 62.5% }` — the standard
  // "1rem = 10px" trick — was reported as having 62.5% body text, because that
  // rule reached the body slot first and the actual `body { font-size: 1.6rem }`
  // then lost the tie. The root is captured on its own, by rootFontSize().
  const isRoot = /(?:^|[\s,])(?:html|:root)(?=$|[\s,:.\[{])/i.test(s);
  const namesBody = /(?:^|[\s,>+~])body(?=$|[\s,:.\[{])/i.test(s);
  if (isRoot && !namesBody) return '';
  const role = selectorRole(s);
  if (role === 'ground') return 'body';
  if (role === 'link') return 'link';
  if (role === 'action') return 'button';
  if (/(?:^|[\s,>+~])p(?=$|[\s,:.\[{])/i.test(s)) return 'body';

  // CLASS-NAMED HEADINGS. Reading only bare `h1`..`h6` looked correct and was
  // nearly useless in practice: run over 197KB of this repo's own Mailer Studio
  // CSS it returned two rows, because that page — like most modern sites, and
  // like every Tailwind or Shopify theme — styles `.vh-h1` and `.title`, never
  // `h1`. A class literally named `h1` or `heading-2` is the site stating which
  // typographic role that rule is for, so it is read, and it stays `weak`
  // because a class is not the element.
  //
  // TWO RULES, both learned by running this over real CSS rather than reasoning
  // about it. A first version allowed any prefix and matched the role word
  // anywhere, which handed `.nav-title` the h1 slot and `.copy-preview-hl` the
  // body slot — a title inside a component is that component's title, not the
  // page's heading scale, and `copy-preview-hl` is not body copy.
  //   1. The role word must END the class name. `.copy-preview-hl` is out;
  //      `.copy` and `.vh-h1` are in.
  //   2. A component prefix disqualifies it outright. A heading inside a card,
  //      a modal or a nav is scoped to that component by definition.
  const COMPONENT = /^(?:nav|navbar|header|footer|menu|card|chip|badge|modal|dialog|tooltip|toast|popover|sidebar|aside|panel|tab|accordion|drawer|banner|alert|widget|table|form|input|field|label|crumb|breadcrumb|pagination|pager|slide|carousel|thumb|avatar|icon|logo)$/i;
  const okPrefix = (pre) => !pre || !COMPONENT.test(pre.replace(/-$/, ''));

  let m = /(?:^|[\s,>+~])\.((?:[\w]+-)?)h(?:eading)?-?([1-6])(?![\w-])/i.exec(s);
  if (m && okPrefix(m[1])) return 'h' + m[2];
  m = /(?:^|[\s,>+~])\.((?:[\w]+-)?)(?:title|headline|display)(?![\w-])/i.exec(s);
  if (m && okPrefix(m[1])) return 'h1';
  m = /(?:^|[\s,>+~])\.((?:[\w]+-)?)(?:subtitle|subhead|subheading)(?![\w-])/i.exec(s);
  if (m && okPrefix(m[1])) return 'h2';
  m = /(?:^|[\s,>+~])\.((?:[\w]+-)?)(?:body|copy|paragraph|prose|rte)(?![\w-])/i.exec(s);
  if (m && okPrefix(m[1])) return 'body';
  m = /(?:^|[\s,>+~])\.((?:[\w]+-)?)(?:link|anchor)(?![\w-])/i.exec(s);
  if (m && okPrefix(m[1])) return 'link';
  return '';
}

/** Every comma-separated part is one simple selector: no descendant, no combinator. */
function isSimpleSelector(sel) {
  const parts = String(sel || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => !/[\s>+~]/.test(p));
}

const TYPE_PROPS = ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'font-style', 'color'];
const TYPE_KEY = {
  'font-size': 'size', 'font-weight': 'weight', 'line-height': 'line_height',
  'letter-spacing': 'letter_spacing', 'text-transform': 'transform', 'font-style': 'style', color: 'color',
};

/**
 * A size in px where that can be said without inventing anything.
 *
 * `rem` is resolved against the root size the site DECLARED, not against a
 * guessed 16 — a site that sets `html { font-size: 62.5% }` (a common trick)
 * has a 10px root, and reporting its 1.6rem body as 25.6px would be a fabricated
 * number wearing a unit. When the root is unknown the browser default is used
 * and the assumption is recorded on the candidate rather than hidden in it.
 * `em` is deliberately NOT converted: it is relative to the parent, and this
 * module does not build a box tree, so there is no parent to resolve against.
 */
function sizeInPx(value, rootPx) {
  const v = String(value || '').trim();
  let m = /^([\d.]+)px$/i.exec(v);
  if (m) return { px: +m[1], assumed: false };
  m = /^([\d.]+)rem$/i.exec(v);
  if (m) return { px: +(+m[1] * (rootPx.value || 16)).toFixed(2), assumed: !rootPx.declared };
  m = /^([\d.]+)pt$/i.exec(v);
  if (m) return { px: +(+m[1] * (4 / 3)).toFixed(2), assumed: false };
  return null;
}

/**
 * The declared root font size, so `rem` means something.
 * Only `html`/`:root` counts, and a percentage is resolved off the 16px browser
 * default because that is what a percentage there is defined against.
 */
function rootFontSize(rules, values) {
  for (const r of rules) {
    if (r.at || !/(?:^|[\s,])(?:html|:root)(?=$|[\s,:.\[{])/i.test(r.selector || '')) continue;
    const d = (r.decls || []).find((x) => x.prop === 'font-size');
    if (!d) continue;
    let v = String(d.value || '').trim();
    const vm = /var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/.exec(v);
    if (vm) v = values.has(vm[1]) ? values.get(vm[1]) : (vm[2] || '').trim();
    let m = /^([\d.]+)px$/i.exec(v);
    if (m) return { value: +m[1], declared: true, evidence: `${clip(r.selector, 40)} { font-size: ${v} }` };
    m = /^([\d.]+)%$/i.exec(v);
    if (m) return { value: +(16 * (+m[1] / 100)).toFixed(2), declared: true, evidence: `${clip(r.selector, 40)} { font-size: ${v} }` };
  }
  return { value: 16, declared: false, evidence: 'No root font-size was declared; the 16px browser default is assumed.' };
}

/**
 * The site's type scale, weights, rhythm and text colours.
 *
 * Returns `{ tokens, slots, scale, root_font_size }` — `tokens` are the named
 * scales the site declares, `slots` is per-role (h1..h6, body, link, button)
 * with one best candidate per property, and `scale` is the ordered size ladder
 * an operator can read at a glance.
 */
function typeScaleCandidates(ctx) {
  const tokens = {};
  for (const [group] of TYPE_TOKEN_GROUPS) tokens[group] = [];
  const slots = {};
  const bump = (slot, key, c) => {
    if (!c) return;
    slots[slot] = slots[slot] || {};
    const prev = slots[slot][key];
    if (!prev || CONF_ORDER[c.confidence] < CONF_ORDER[prev.confidence]) slots[slot][key] = c;
  };

  let root = { value: 16, declared: false, evidence: '' };
  for (const sheet of (ctx.sheets || [])) {
    const rules = cssRulesets(sheet.css || '');
    const { values, origin } = customProperties(rules);
    const r0 = rootFontSize(rules, values);
    if (r0.declared && !root.declared) root = r0; else if (!root.evidence) root = r0;

    // 1. Named scales — the site stating its own system.
    for (const [name, val] of values) {
      const n = name.toLowerCase();
      const v = String(val || '').trim();
      for (const [group, nameRx, valRx] of TYPE_TOKEN_GROUPS) {
        if (!nameRx.test(n) || !valRx.test(v)) continue;
        // `--text-muted: #667` is a colour, not a size. The value pattern above
        // already rejects it, which is why both halves are checked.
        tokens[group].push(cand(v, `css:custom-property ${name}`, sheet.url, CONF.declared,
          `${name}: ${clip(v, 60)};  (declared on ${clip(origin.get(name) || '?', 40)})`,
          Object.assign({ token: name }, group === 'size' ? { px: (sizeInPx(v, root) || {}).px || null } : {})));
        break;
      }
    }

    // 2. Measured declarations, per typographic slot.
    for (const r of rules) {
      if (r.at) continue;
      const slot = typeSlot(r.selector);
      if (!slot) continue;
      // STRENGTH IS THE SHAPE OF THE SELECTOR, not whether it is an element.
      // Marking every class `weak` was wrong in a way that mattered: `.vh-h1` is
      // the site NAMING its heading style, which is evidence of the same kind as
      // `h1`, and treating it as weak meant class-based sites — most of the web
      // — emitted no scale at all. What genuinely weakens a declaration is being
      // SCOPED: `.hero .title` is the title inside a hero, not the brand's h1.
      // So a simple selector (no descendant or sibling combinator) is strong;
      // anything compound is weak. Component-prefixed classes were already
      // rejected outright by typeSlot.
      const bare = isSimpleSelector(r.selector);
      for (const prop of TYPE_PROPS) {
        const d = (r.decls || []).find((x) => x.prop === prop);
        if (!d) continue;
        let v = String(d.value || '').trim();
        const vm = /var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/.exec(v);
        const viaToken = !!vm;
        if (vm) v = values.has(vm[1]) ? values.get(vm[1]) : (vm[2] || '').trim();
        if (!v || /^(?:inherit|initial|unset|revert)$/i.test(v)) continue;

        let extra = { via_token: viaToken ? vm[1] : '' };
        if (prop === 'font-size') {
          const px = sizeInPx(v, root);
          if (px) extra = Object.assign(extra, { px: px.px, px_assumed_root: px.assumed });
        }
        if (prop === 'color') {
          const hex = parseColor(v);
          if (!hex) continue;
          extra = Object.assign(extra, { hex });
        }
        bump(slot, TYPE_KEY[prop], cand(v, `css:${prop} on ${clip(r.selector, 50)}`, sheet.url,
          bare ? CONF.strong : CONF.weak, `${clip(r.selector, 70)} { ${prop}: ${clip(d.value, 50)} }`, extra));
      }
    }
  }

  const dedupe = (list) => {
    const seen = new Set(), out = [];
    for (const c of list.filter(Boolean)) {
      const k = (c.token || '') + '|' + c.value.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(c);
    }
    return out.sort((a, b) => (a.px || 0) - (b.px || 0)).slice(0, 24);
  };
  for (const g of Object.keys(tokens)) tokens[g] = dedupe(tokens[g]);

  // The ladder, largest first — the shape an operator recognises as "the scale".
  const ORDER = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'link', 'button'];
  // A row earns its place with a size, a weight OR a colour. Requiring a size
  // dropped the link row entirely — `a { color: … }` is the single most useful
  // thing an operator means by "my font colours", and it almost never carries a
  // font-size.
  const scale = ORDER
    .filter((s) => slots[s] && (slots[s].size || slots[s].weight || slots[s].color))
    .map((s) => ({
      slot: s,
      size: slots[s].size ? slots[s].size.value : '',
      px: slots[s].size ? (slots[s].size.px || null) : null,
      weight: slots[s].weight ? slots[s].weight.value : '',
      line_height: slots[s].line_height ? slots[s].line_height.value : '',
      letter_spacing: slots[s].letter_spacing ? slots[s].letter_spacing.value : '',
      color: slots[s].color ? slots[s].color.hex : '',
      confidence: (slots[s].size || slots[s].weight || slots[s].color).confidence,
      source_url: (slots[s].size || slots[s].weight || slots[s].color).source_url,
    }));

  return { tokens, slots, scale, root_font_size: root };
}

/* ── non-colour design tokens (spacing, radius, elevation, motion) ─────────
   A design system is not only its palette and its two typefaces. Radius,
   spacing rhythm, shadow depth and transition timing are the difference between
   a page that looks like the brand and a page that merely uses its colours.

   These are taken ONLY from custom properties whose NAME says what they are -
   `--radius-lg`, `--space-4`, `--shadow-md`. A measured value off a single rule
   (`padding: 14px` on one card) is not a system token, it is one measurement,
   and presenting it as the brand's spacing scale is exactly the kind of
   confident guess this module exists to refuse. A site that ships no named
   tokens therefore reports none, and design.md carries the marker. */

const TOKEN_GROUPS = [
  ['radius', /(?:^|-)(?:radius|rounded|corner)(?:-|$)/, /^-?[\d.]+(?:px|rem|em|%)$|^(?:0|9999px|50%)$/],
  ['spacing', /(?:^|-)(?:space|spacing|gap|gutter|size)(?:-|\d|$)/, /^-?[\d.]+(?:px|rem|em|ch|vw|vh)$/],
  ['shadow', /(?:^|-)(?:shadow|elevation)(?:-|$)/, /./],
  ['motion', /(?:^|-)(?:duration|transition|ease|easing|timing|motion)(?:-|$)/, /./],
  ['border', /(?:^|-)(?:border-width|stroke-width|hairline)(?:-|$)/, /^-?[\d.]+(?:px|rem|em)$/],
  ['breakpoint', /(?:^|-)(?:breakpoint|screen|bp)(?:-|$)/, /^[\d.]+(?:px|rem|em)$/],
];

/**
 * Named, non-colour design tokens the site's own stylesheets declare.
 * Returns `{ radius: [cand], spacing: [cand], … }`, each carrying the sheet it
 * was declared in and the selector it was declared on.
 */
function designTokenCandidates(ctx) {
  const out = {};
  for (const [group] of TOKEN_GROUPS) out[group] = [];
  for (const sheet of (ctx.sheets || [])) {
    const rules = cssRulesets(sheet.css || '');
    const { values, origin } = customProperties(rules);
    for (const [name, rawVal] of values) {
      const n = String(name).toLowerCase();
      const val = clip(rawVal, 120);
      if (!val || /^var\(/.test(val)) continue;              // unresolved reference: reported by nobody as a value
      if (parseColor(val)) continue;                          // a colour belongs to the palette, not here
      for (const [group, nameRx, valueRx] of TOKEN_GROUPS) {
        if (!nameRx.test(n)) continue;
        if (!valueRx.test(val)) continue;
        out[group].push(cand(val, `css:custom-property ${name}`, sheet.url, CONF.declared,
          `${name}: ${val};  (declared on ${clip(origin.get(name) || '?', 50)})`, { token: name }));
        break;                                                // one group per token, first match wins
      }
    }
  }
  for (const k of Object.keys(out)) {
    const seen = new Set();
    out[k] = out[k].filter((c) => c && !seen.has(c.token) && seen.add(c.token)).slice(0, 16);
  }
  return out;
}

/* ── social profiles ───────────────────────────────────────────────────── */

const SOCIAL_HOSTS = [
  ['instagram', /(^|\.)instagram\.com$/i], ['facebook', /(^|\.)facebook\.com$/i], ['x', /(^|\.)(twitter|x)\.com$/i],
  ['linkedin', /(^|\.)linkedin\.com$/i], ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/i], ['tiktok', /(^|\.)tiktok\.com$/i],
  ['pinterest', /(^|\.)pinterest\.(com|[a-z]{2,3}(\.[a-z]{2})?)$/i], ['threads', /(^|\.)threads\.(net|com)$/i],
  ['snapchat', /(^|\.)snapchat\.com$/i], ['reddit', /(^|\.)reddit\.com$/i], ['whatsapp', /(^|\.)(wa\.me|whatsapp\.com)$/i],
  ['telegram', /(^|\.)(t\.me|telegram\.me)$/i], ['github', /(^|\.)github\.com$/i], ['spotify', /(^|\.)spotify\.com$/i],
  ['discord', /(^|\.)(discord\.gg|discord\.com)$/i], ['medium', /(^|\.)medium\.com$/i], ['substack', /(^|\.)substack\.com$/i],
  ['vimeo', /(^|\.)vimeo\.com$/i], ['twitch', /(^|\.)twitch\.tv$/i], ['bluesky', /(^|\.)bsky\.(app|social)$/i],
];

/** A SHARE button is not a profile. `?url=`, /sharer, /intent/ are the tells. */
const SHARE_RX = /(\/sharer|\/share\b|\/intent\/|[?&](?:url|u|text|via)=)/i;

function platformOf(u) {
  const h = hostOf(u);
  if (!h) return '';
  for (const [name, rx] of SOCIAL_HOSTS) if (rx.test(h) || rx.test('.' + h)) return name;
  return '';
}

function socialCandidates(ctx) {
  const { html, url, ld } = ctx;
  const out = [];
  const seen = new Set();
  const push = (raw, signal, conf, evidence) => {
    const abs = absolute(raw, url);
    if (!abs || !/^https?:/i.test(abs)) return;
    const platform = platformOf(abs);
    if (!platform) return;
    if (SHARE_RX.test(abs)) return;
    const key = platform + '|' + abs.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cand(abs, signal, url, conf, evidence, { platform }));
  };

  for (const n of ld) {
    if (!n || typeof n !== 'object') continue;
    const same = n.sameAs;
    for (const s of (Array.isArray(same) ? same : same ? [same] : [])) push(s, 'json-ld:sameAs', CONF.declared, 'schema.org sameAs');
  }
  const foot = footerOf(html);
  for (const [scope, signal, conf] of [[foot, 'html:footer link', CONF.strong], [html, 'html:page link', CONF.weak]]) {
    if (!scope) continue;
    for (const m of String(scope).matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      push(m[1] || m[2], signal, conf, clip(m[0], 160));
    }
  }
  return out.filter(Boolean);
}

/* ── verifiable claims ─────────────────────────────────────────────────── */

/**
 * A claim is a VERBATIM sentence the site published that asserts a checkable
 * fact. Nothing here parses a value out of prose: the candidate IS the
 * sentence, quoted exactly, with the page it was on. Paraphrasing it would be
 * fabrication, and so would deriving "free shipping over $50" into a
 * `{threshold: 50}` field the site never declared in that shape.
 *
 * Every claim comes back `approved: false`. The spec (§1.9) allows only claims
 * approved for the exact product, region and channel; this can propose the
 * candidate list, never the approval.
 */
const CLAIM_PATTERNS = [
  { rx: /\b(?:free|complimentary)\s+(?:standard\s+|express\s+|worldwide\s+)?(?:shipping|delivery|returns?|exchanges?)\b/i, kind: 'shipping' },
  { rx: /\b(?:ships?|shipping|delivery|deliver)\s+(?:to\s+)?(?:worldwide|internationally|over|in)\b/i, kind: 'shipping' },
  { rx: /\b\d+\s*[-–]?\s*day\s+(?:returns?|money[- ]back|guarantee|trial|warranty|delivery|shipping)\b/i, kind: 'guarantee' },
  { rx: /\b(?:money[- ]back|satisfaction)\s+guarantee\b/i, kind: 'guarantee' },
  { rx: /\b(?:lifetime|\d+[- ]year)\s+(?:warranty|guarantee)\b/i, kind: 'guarantee' },
  { rx: /\b(?:certified|certification)\b.{0,40}\b(?:organic|fair\s?trade|b\s?corp|iso|gots|fsc|leaping\s?bunny|vegan|halal|kosher)\b/i, kind: 'certification' },
  { rx: /\b(?:b\s?corp|fair\s?trade|carbon[- ]neutral|climate[- ]neutral|cruelty[- ]free|vegan|100%\s+recycled|plastic[- ]free)\b/i, kind: 'certification' },
  // Case-insensitive on the verb, case-SENSITIVE on the place: an /i flag here
  // turns "made in the same week" into an origin claim. The place has to look
  // like a proper noun.
  { rx: /\b(?:[Mm]ade|[Hh]and-?[Mm]ade|[Hh]and-?[Cc]rafted|[Aa]ssembled|[Dd]esigned|[Pp]rinted|[Ww]oven|[Rr]oasted|[Bb]rewed|[Bb]ottled|[Ff]orged)\s+in\s+(?!the\b|our\b|a\b|house\b|small\b)[A-Z][\w' ]{2,30}/, kind: 'origin' },
  { rx: /\b100%\s+[a-z][\w -]{2,40}\b/i, kind: 'material' },
  { rx: /\b(?:made\s+(?:from|with)|crafted\s+from)\s+[a-z][\w -]{2,40}\b/i, kind: 'material' },
];

function sentencesOf(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\s*[•·|]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 220);
}

/**
 * Visible copy, one BLOCK at a time.
 *
 * Stripping the whole document and splitting on sentence punctuation does not
 * work on real marketing pages: a trust bar is three list items with no full
 * stops between them, so the naive version emits
 * "Free shipping over 40 pounds 30 day returns Made in England Terms ..." as
 * one "claim". Quoting that is worse than quoting nothing, because it looks
 * verbatim and is not a sentence anybody wrote. Blocks preserve the authored
 * boundaries.
 */
const BLOCK_TAG_RX = /<(li|p|h[1-6]|blockquote|figcaption|dd|dt|summary|td|figure)\b([^>]*)>([\s\S]{0,1500}?)<\/\1>/gi;

function blockTexts(html) {
  const out = [];
  for (const m of String(html).matchAll(BLOCK_TAG_RX)) {
    // A block containing another of the same tag is a wrapper, and its text is
    // its children's text repeated; the children are matched on their own.
    if (new RegExp(`<${m[1]}\\b`, 'i').test(m[3])) continue;
    const text = stripTags(m[3]);
    if (text) out.push({ text, tag: m[1].toLowerCase(), attr: String(m[2] || '').toLowerCase(), index: m.index });
  }
  return out;
}

const TRUST_ATTR_RX = /trust|badge|guarantee|shipping|usp\b|benefit|feature|promise|icon-?bar|marquee|announcement|value-?prop|assurance/;

/** Where the matching close tag for an open tag at `from` is. */
function closeIndex(html, tag, from) {
  const rx = new RegExp(`<(/?)${tag}\\b`, 'gi');
  rx.lastIndex = from;
  let depth = 0, m;
  while ((m = rx.exec(html))) {
    if (m[1]) { depth--; if (depth <= 0) return m.index; }
    else depth++;
    if (m.index - from > 20000) break;
  }
  return Math.min(html.length, from + 6000);
}

/** Byte ranges the site itself framed as a trust / benefit / promise strip. */
function trustRanges(html) {
  const ranges = [];
  for (const m of String(html).matchAll(/<(ul|ol|div|section|nav|aside)\b([^>]*)>/gi)) {
    if (!TRUST_ATTR_RX.test(String(m[2] || '').toLowerCase())) continue;
    ranges.push([m.index, closeIndex(html, m[1], m.index)]);
    if (ranges.length >= 24) break;
  }
  return ranges;
}

function claimCandidates(ctx) {
  const { html, url } = ctx;
  const out = [];
  const seen = new Set();
  const ranges = trustRanges(html);
  const inTrust = (i) => ranges.some(([a, b]) => i >= a && i <= b);
  const push = (sentence, kind, signal, conf) => {
    const s = clip(sentence, 220);
    if (!s || s.length < 8) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cand(s, signal, url, conf, s, { kind, approved: false, verbatim: true }));
  };

  for (const block of blockTexts(html)) {
    if (out.length >= 40) break;
    // A framed block (the site put it in a trust bar, or labelled the element
    // itself) is a stronger candidate than the same sentence in body copy.
    const framed = TRUST_ATTR_RX.test(block.attr) || inTrust(block.index);
    for (const s of sentencesOf(block.text)) {
      const hit = CLAIM_PATTERNS.find((p) => p.rx.test(s));
      if (!hit) continue;
      push(s, hit.kind, framed ? 'html:trust/benefit element' : `html:<${block.tag}> copy`, framed ? CONF.strong : CONF.weak);
    }
  }
  return out.filter(Boolean);
}

/* ── legal entity ──────────────────────────────────────────────────────── */

const LEGAL_DOC_RX = /\/(?:policies|policy|legal|terms|imprint|impressum|privacy|refund-policy|terms-of-service|terms-and-conditions|shipping-policy)(?:\/|$|\?)/i;

function legalCandidates(ctx) {
  const { html, url, ld } = ctx;
  const out = [];
  const docs = [];

  for (const n of ld) {
    if (!n || typeof n !== 'object' || !isOrgNode(n)) continue;
    if (typeof n.legalName === 'string' && n.legalName) out.push(cand(n.legalName, 'json-ld:Organization.legalName', url, CONF.declared, n.legalName, { kind: 'legal_name' }));
    for (const idField of ['vatID', 'taxID', 'duns', 'leiCode', 'iso6523Code']) {
      if (typeof n[idField] === 'string' && n[idField]) out.push(cand(n[idField], `json-ld:Organization.${idField}`, url, CONF.declared, n[idField], { kind: 'registration_id' }));
    }
    const addr = n.address;
    const a = Array.isArray(addr) ? addr[0] : addr;
    if (a && typeof a === 'object') {
      const line = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry && (a.addressCountry.name || a.addressCountry)]
        .filter((x) => typeof x === 'string' && x.trim()).join(', ');
      if (line) out.push(cand(line, 'json-ld:Organization.address', url, CONF.declared, line, { kind: 'address' }));
    } else if (typeof addr === 'string' && addr.trim()) {
      out.push(cand(addr, 'json-ld:Organization.address', url, CONF.declared, addr, { kind: 'address' }));
    }
  }

  // The copyright line, quoted verbatim. Never normalised into a company name:
  // "© 2026 Acme Trading Ltd." and "Acme Trading Ltd" are not the same string
  // and only the operator knows which one the registrar has.
  const foot = footerOf(html) || String(html).slice(-20000);
  for (const m of stripTags(foot).matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?[\s,]*([^.|©]{2,90})/gi)) {
    const line = clip(m[1], 90).replace(/\s*(?:all rights reserved.*)$/i, '').trim();
    if (line && /[A-Za-z]{2}/.test(line)) out.push(cand(line, 'html:footer copyright line', url, CONF.weak, clip(m[0], 160), { kind: 'legal_name' }));
  }

  for (const m of String(html).matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const href = absolute(m[1] || m[2], url);
    if (!href || !LEGAL_DOC_RX.test(href)) continue;
    const label = stripTags(m[3]);
    if (!docs.some((d) => d.url === href)) docs.push({ url: href, label: clip(label, 80), source_url: url });
  }
  return { candidates: out.filter(Boolean), documents: docs.slice(0, 20) };
}

/* ── regions and stores ────────────────────────────────────────────────── */

/**
 * hreflang, locale switchers and per-region currency, each reported as what it
 * actually is. A locale is NOT a currency: `en-GB` does not prove the store
 * prices in GBP, so currency is only ever filled from a declared priceCurrency
 * and is otherwise left empty with a marker.
 */
function regionCandidates(ctx) {
  const { html, url, meta, ld } = ctx;
  const rows = new Map();
  const touch = (code) => {
    const c = String(code || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return null;
    if (!rows.has(c)) rows.set(c, { code: c, store_url: '', currency: '', signals: [] });
    return rows.get(c);
  };

  for (const tag of tagsOf(html, 'link')) {
    const a = attrs(tag);
    if (!/alternate/i.test(String(a.rel || '')) || !a.hreflang || !a.href) continue;
    const parts = String(a.hreflang).split('-');
    const region = parts.length > 1 ? parts[parts.length - 1] : '';
    const r = touch(region);
    if (!r) continue;
    const abs = absolute(a.href, url);
    if (abs && !r.store_url) r.store_url = abs;
    r.signals.push({ signal: 'link:alternate[hreflang]', source_url: url, evidence: clip(tag, 160) });
  }
  // og:locale:alternate is repeated once per locale, and metaTags() keys by
  // name so only the LAST one survives there. Read the tags directly or a
  // ten-market site reports one market.
  for (const tag of tagsOf(html, 'meta')) {
    const a = attrs(tag);
    const key = String(a.property || a.name || '').toLowerCase();
    if (key !== 'og:locale' && key !== 'og:locale:alternate') continue;
    const region = String(a.content || '').split(/[-_]/)[1] || '';
    const r = touch(region);
    if (r) r.signals.push({ signal: `opengraph:${key}`, source_url: url, evidence: clip(tag, 120) });
  }
  // Shopify and friends render the country picker as <option value="GB">.
  for (const m of String(html).matchAll(/<(?:select|input)\b[^>]*name\s*=\s*["']?(?:country_code|country|localization\[country_code\])["']?[\s\S]{0,6000}?<\/select>/gi)) {
    for (const o of m[0].matchAll(/<option\b[^>]*value\s*=\s*["']([A-Za-z]{2})["']/g)) {
      const r = touch(o[1]);
      if (r) r.signals.push({ signal: 'html:country selector', source_url: url, evidence: clip(o[0], 90) });
    }
  }
  // A declared price currency IS a currency fact — but only for the page it
  // was declared on, so it is attached to that page's own region if one is known.
  const currencies = [];
  for (const n of ld) {
    if (!n || typeof n !== 'object') continue;
    const offers = Array.isArray(n.offers) ? n.offers : (n.offers ? [n.offers] : []);
    for (const o of offers) {
      if (o && typeof o === 'object' && o.priceCurrency) {
        currencies.push({ currency: String(o.priceCurrency).toUpperCase().slice(0, 8), signal: 'json-ld:Offer.priceCurrency', source_url: url });
      }
    }
  }
  if (meta['product:price:currency']) currencies.push({ currency: String(meta['product:price:currency']).toUpperCase().slice(0, 8), signal: 'opengraph:product:price:currency', source_url: url });

  return { regions: [...rows.values()], currencies };
}

/* ── voice sampling ────────────────────────────────────────────────────── */

const ABOUT_RX = /\/(?:about|about-us|our-story|story|who-we-are|mission|pages\/about)/i;

function voiceSamples(ctx) {
  const { html, url, isHome } = ctx;
  const out = [];
  const push = (text, where) => {
    const t = clip(text, 400);
    if (t && t.length >= 25) out.push({ text: t, source_url: url, where });
  };
  for (const h of textBetween(html, 'h1').slice(0, 2)) push(stripTags(h), 'h1');
  for (const h of textBetween(html, 'h2').slice(0, 6)) push(stripTags(h), 'h2');
  if (isHome || ABOUT_RX.test(url)) {
    for (const p of textBetween(html, 'p').slice(0, 25)) {
      const t = stripTags(p);
      if (t.length >= 60) push(t, 'p');
    }
  }
  return out.slice(0, 30);
}

/**
 * Voice, OBSERVED from the brand's own public copy — never presented as the
 * company's internal guidelines (CLAUDE.md's preset-provenance rule).
 *
 * The prompt is built so that a refusal is the correct output: an LLM that
 * cannot find the tone in the excerpts is told to return nulls rather than a
 * generic marketing description. A provider outage returns null too — an
 * absent voice is a reported gap, and "warm and authentic" would be a
 * fabrication dressed as an extraction.
 *
 * `banned` is ALWAYS empty. A phrase a brand refuses to use cannot be observed
 * from the phrases it did use; that is an operator decision and is reported as
 * a DATA REQUIRED marker instead.
 */
async function observeVoice(samples, opts) {
  const o = opts || {};
  if (!samples.length) {
    return { value: null, marker: MARKER('voice.tone'), note: 'No page copy long enough to observe a voice from was found.' };
  }
  const callLLM = o.llm || require('./llm.js');
  const corpus = samples.map((s, i) => `[${i + 1}] (${s.where}, ${s.source_url})\n${s.text}`).join('\n\n');
  const system = [
    'You describe the tone of voice OBSERVED in public marketing copy. You are not writing brand guidelines and you must never present your description as the company\'s own internal rules.',
    'Rules you must not break:',
    '1. Describe only what is visible in the excerpts. Never infer values, positioning, audience or history that the text does not show.',
    '2. Every observation must be supported by a VERBATIM quote from the excerpts. If you cannot quote it, do not write it.',
    '3. "preferred_vocabulary" may contain ONLY words or phrases that appear verbatim in the excerpts.',
    '4. If the excerpts are too thin or too generic to observe a tone, return {"tone": null} and say why in "why_not". Returning null is a correct answer; a plausible guess is not.',
    '5. Never output em dashes or en dashes.',
    'Return ONLY JSON: {"tone": string|null, "preferred_vocabulary": string[], "notes": string, "evidence": [{"quote": string, "supports": string}], "why_not": string}',
  ].join('\n');
  try {
    const r = await callLLM({
      systemPrompt: system,
      userMessage: `Excerpts from the brand's own website:\n\n${corpus.slice(0, 12000)}`,
      responseFormat: { type: 'json_object' },
      maxTokens: 900, temperature: 0.2, stage: 'brand-extract:voice',
      timeoutMs: o.voiceMs || DEFAULTS.voiceMs,
    });
    const parsed = (require('./llm.js').parseJSON ? require('./llm.js').parseJSON(r.text) : JSON.parse(r.text)) || {};
    if (!parsed || !parsed.tone) {
      return { value: null, marker: MARKER('voice.tone'), note: clip(parsed && parsed.why_not, 300) || 'The site copy did not show an observable tone.', model: r.provider ? `${r.provider}/${r.model}` : '' };
    }
    // Only vocabulary that really is in the excerpts survives.
    const hay = corpus.toLowerCase();
    const preferred = (Array.isArray(parsed.preferred_vocabulary) ? parsed.preferred_vocabulary : [])
      .map((w) => clip(w, 60)).filter((w) => w && hay.includes(w.toLowerCase())).slice(0, 24);
    const evidence = (Array.isArray(parsed.evidence) ? parsed.evidence : [])
      .map((e) => ({ quote: clip(e && e.quote, 220), supports: clip(e && e.supports, 160) }))
      .filter((e) => e.quote && hay.includes(e.quote.toLowerCase().slice(0, 40))).slice(0, 8);
    return {
      value: {
        tone: clip(parsed.tone, 400),
        preferred,
        banned: [],
        no_em_dashes: true,
        notes: clip(parsed.notes, 1200),
      },
      provenance: 'OBSERVED from the brand\'s own public copy on the pages listed. This is not the company\'s internal voice guideline and must not be presented as one.',
      evidence,
      sources: [...new Set(samples.map((s) => s.source_url))],
      model: r.provider ? `${r.provider}/${r.model}` : '',
      banned_note: 'A banned-phrase list cannot be observed from copy a brand DID publish. It is left empty for you to fill in.',
    };
  } catch (err) {
    return { value: null, marker: MARKER('voice.tone'), note: `No language model was reachable, so no voice was observed (${clip(err && err.message, 120)}). Nothing was invented in its place.` };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. FETCHING ASSETS (stylesheets + manifest)
   crawlSite deliberately refuses anything that is not HTML, which is right for
   a page crawl and useless here: the palette and the typography live in .css
   and the manifest lives in .webmanifest. This is the ONLY extra fetcher, it
   is bounded, and it applies the same scope rule as the crawl.
   ═══════════════════════════════════════════════════════════════════════════ */

async function defaultAssetFetch(url, timeoutMs, ua) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // redirect:'manual' — a public host must not be able to bounce an asset
    // fetch onto an internal one. One hop is followed by the caller, and only
    // after it has been re-checked against the scope rules.
    const r = await fetch(url, {
      redirect: 'manual', signal: ctrl.signal,
      headers: { 'User-Agent': ua, Accept: 'text/css,application/manifest+json,application/json;q=0.9,*/*;q=0.5' },
    });
    if (r.status >= 300 && r.status < 400) {
      return { ok: false, status: r.status, body: '', redirect: r.headers.get('location') || '' };
    }
    if (!r.ok) return { ok: false, status: r.status, body: '' };
    return { ok: true, status: r.status, body: await r.text(), url: r.url || url, contentType: String(r.headers.get('content-type') || '') };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: String((e && e.message) || e) };
  } finally { clearTimeout(t); }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. ORCHESTRATION
   ═══════════════════════════════════════════════════════════════════════════ */

const CONF_ORDER = { declared: 0, strong: 1, weak: 2 };

/**
 * Highest-confidence first, one row per distinct value. `sort` is stable, so
 * within a confidence band the order signals were collected in is preserved —
 * which is the priority order each collector wrote them in.
 */
function rankCandidates(list, limit) {
  const seen = new Set(), out = [];
  for (const c of list.filter(Boolean).slice().sort((a, b) => (CONF_ORDER[a.confidence] ?? 3) - (CONF_ORDER[b.confidence] ?? 3))) {
    const k = String(c.value).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(c);
  }
  return out.slice(0, limit || 10);
}


const fieldOf = (list, field) => {
  const ranked = rankCandidates(list);
  return ranked.length
    ? { value: ranked[0].value, source_url: ranked[0].source_url, signal: ranked[0].signal, confidence: ranked[0].confidence, evidence: ranked[0].evidence, candidates: ranked }
    : { value: null, candidates: [], marker: MARKER(field) };
};

/**
 * Read a brand off its own site.
 *
 * `fetchImpl(url, timeoutMs) -> {ok,status,body,url,contentType}` is injectable
 * for the same reason site-crawl's is: what this module REFUSES to conclude is
 * its entire value, and that has to be testable without a network.
 */
async function extractBrand(startUrl, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const brand = o.brand || { website: startUrl };
  const hosts = siteCrawl.allowedHosts(brand.website ? brand : { website: startUrl, regions: brand.regions, asset_hosts: brand.asset_hosts });
  if (!hosts.size) hosts.add(hostOf(startUrl));

  const rawFetch = o.fetchImpl || ((u, ms) => defaultAssetFetch(u, ms, o.userAgent));
  // The page crawl must only ever see HTML; the asset fetcher must see CSS and
  // JSON. Both come off the one injectable fetcher so a test drives one map.
  const pageFetch = async (u, ms) => {
    const r = await rawFetch(u, ms);
    if (r && r.ok && r.contentType && !/text\/html|application\/xhtml/i.test(r.contentType)) return { ok: false, status: r.status, body: '' };
    return r;
  };

  const pages = new Map();     // url -> html
  const notes = [];
  const limits = [
    'No browser: this reads published HTML and CSS, it does not render the page. Colours applied by JavaScript, themes chosen at runtime, and anything a single-page app paints after load are invisible to it.',
    'Cascade is approximated, not resolved: a declaration is weighted by its property and its selector, not by which rule actually wins on screen.',
    'Content behind a login, a consent wall, a region gate or an interaction is not read.',
    'The type scale is attributed by SELECTOR, not by what renders. A size on `h1`, on `.h1` or on a class '
      + 'named for the role is read; a utility-first site that sets every size with classes like `text-2xl` '
      + 'publishes no rule this can attribute to a heading, and reads as having no scale rather than as having '
      + 'one this could not see.',
  ];

  // Identity pages first. A BFS that just takes the first N links off a store
  // homepage fills its budget with products and never reaches /about or the
  // policy pages, which is where the legal entity and half the claims live.
  const rank = (u) => {
    const p = (() => { try { return new URL(u).pathname.toLowerCase(); } catch (_) { return ''; } })();
    if (p === '/' || p === '') return 100;
    if (ABOUT_RX.test(p)) return 90;
    if (/\/(?:contact|contact-us|pages\/contact)/.test(p)) return 80;
    if (LEGAL_DOC_RX.test(p)) return 70;
    if (/\/(?:pages|blog|collections)\//.test(p)) return 30;
    if (/\/products?\//.test(p)) return 10;
    return 50;
  };

  const crawl = await siteCrawl.crawlSite(startUrl, {
    brand, fetchImpl: pageFetch, rank,
    maxPages: o.maxPages, maxDepth: o.maxDepth,
    perRequestMs: o.perRequestMs, totalMs: o.totalMs, userAgent: o.userAgent,
    onPage: (html, url) => { if (pages.size < o.maxPages) pages.set(url, html); },
  });
  if (!crawl.ok) {
    return {
      ok: false,
      error: crawl.error || 'crawl_failed',
      message: crawl.error === 'start_url_out_of_scope'
        ? 'That URL is not on this brand\'s own domain. A brand may only be extracted from its own site.'
        : 'The site could not be read.',
      fields: {}, markers: [], limits,
    };
  }
  // A crawl that succeeded and read NOTHING is the one outcome an operator
  // cannot act on without being told why. The crawl already knows - it recorded
  // the status of every attempt - so the reason is classified here rather than
  // flattened to "no page could be read", which is the same sentence for a
  // typo, a robots rule and a bot filter.
  const diagnosis = pages.size ? null : diagnoseEmptyCrawl(startUrl, crawl);
  if (diagnosis) notes.push(diagnosis.message);

  // The home page is the FIRST page the crawl actually read, not the URL that
  // was asked for. Comparing against the requested URL breaks the moment a site
  // redirects (http to https, `/` to `/en-gb`, a trailing slash added): every
  // page then compares unequal, nothing is treated as home, and the whole
  // CSS-derived palette and typography silently disappear from the report.
  const pageList = [...pages.entries()];
  const homeUrl = pageList.length ? pageList[0][0] : crawl.start;

  // ── manifest + stylesheets, once, from the pages we actually read.
  let manifest = null;
  const sheetUrls = [];
  const inlineSheets = [];
  for (const [url, html] of pages) {
    const head = headOf(html);
    for (const tag of tagsOf(head, 'link')) {
      const a = attrs(tag);
      const rel = String(a.rel || '').toLowerCase();
      if (!a.href) continue;
      if (/manifest/.test(rel) && !manifest) sheetUrls.push({ kind: 'manifest', url: absolute(a.href, url), from: url });
      else if (/(^|\s)stylesheet(\s|$)/.test(rel)) sheetUrls.push({ kind: 'css', url: absolute(a.href, url), from: url });
    }
    for (const m of String(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      inlineSheets.push({ url, css: m[1].slice(0, o.maxCssChars), origin: 'inline <style>' });
    }
  }

  const fetchedSheets = [];
  let cssBudget = o.maxTotalCssChars;
  const assetDeadline = Date.now() + o.assetMs;
  const seenAsset = new Set();
  for (const item of sheetUrls) {
    if (Date.now() > assetDeadline) { notes.push('Asset time box reached; later stylesheets were not read. Colour and typography evidence below is from the sheets that were.'); break; }
    if (!item.url || seenAsset.has(item.url)) continue;
    seenAsset.add(item.url);
    if (item.kind === 'css' && fetchedSheets.length >= o.maxStylesheets) continue;
    if (item.kind === 'manifest' && manifest) continue;
    if (!siteCrawl.inScope(item.url, hosts)) {
      notes.push(`skipped (off-origin asset): ${item.url}`);
      continue;
    }
    let r = await rawFetch(item.url, o.perRequestMs);
    if (r && !r.ok && r.redirect) {
      const hop = absolute(r.redirect, item.url);
      if (hop && siteCrawl.inScope(hop, hosts) && !seenAsset.has(hop)) {
        seenAsset.add(hop);
        r = await rawFetch(hop, o.perRequestMs);
        if (r && r.ok) r.url = hop;
      } else {
        notes.push(`skipped (asset redirected off-origin): ${item.url}`);
        continue;
      }
    }
    if (!r || !r.ok || !r.body) { notes.push(`unreachable asset (${(r && r.status) || 0}): ${item.url}`); continue; }
    if (item.kind === 'manifest') {
      try { manifest = JSON.parse(r.body); manifest.__url = item.url; }
      catch (_) { notes.push(`manifest is not valid JSON: ${item.url}`); }
      continue;
    }
    const css = String(r.body).slice(0, Math.min(o.maxCssChars, Math.max(0, cssBudget)));
    cssBudget -= css.length;
    fetchedSheets.push({ url: item.url, css, origin: 'linked stylesheet' });
    if (cssBudget <= 0) { notes.push('CSS budget reached; later stylesheets were not read.'); break; }
  }
  if (!inlineSheets.length && !fetchedSheets.length) {
    notes.push('No stylesheet could be read, so no colour or typography evidence was available from CSS.');
  }

  // ── per-page collection.
  const bags = { name: [], tagline: [], logo: [], icons: [], images: [], social: [], claims: [], legal: [], docs: [], sightings: [], unparsed: new Map(), regions: new Map(), currencies: [], samples: [] };
  let typography = { heading: [], body: [], mono: [], font_faces: [], google_font_links: [] };
  let typeScale = null;
  let designTokens = null;
  let inlineSvg = null;

  for (const [url, html] of pageList) {
    const isHome = url === homeUrl;
    // The linked stylesheets are site-wide, so they are evidence exactly once,
    // on the home page. A page's own inline <style> belongs to that page only —
    // attributing every page's inline CSS to the home page would count the same
    // shared header block once per page and let it drown the real signals.
    const ctx = {
      html, url, isHome, hosts, meta: metaOf(html), ld: jsonLdNodes(html), manifest,
      sheets: isHome
        ? inlineSheets.filter((s) => s.url === homeUrl).concat(fetchedSheets)
        : inlineSheets.filter((s) => s.url === url),
    };

    bags.name.push(...nameCandidates(ctx));
    bags.tagline.push(...taglineCandidates(ctx));
    bags.logo.push(...logoCandidates(ctx));
    // Collected on EVERY page, not just the home page: a product photograph
    // lives on the product page, and imagery is the one field where the
    // interesting rows are never on the front door.
    bags.icons.push(...iconCandidates(ctx));
    bags.images.push(...imageCandidates(ctx));
    bags.social.push(...socialCandidates(ctx));
    bags.claims.push(...claimCandidates(ctx));
    const legal = legalCandidates(ctx);
    bags.legal.push(...legal.candidates);
    for (const d of legal.documents) if (!bags.docs.some((x) => x.url === d.url)) bags.docs.push(d);
    const reg = regionCandidates(ctx);
    for (const r of reg.regions) {
      const prev = bags.regions.get(r.code);
      if (prev) { prev.signals.push(...r.signals); if (!prev.store_url) prev.store_url = r.store_url; }
      else bags.regions.set(r.code, r);
    }
    bags.currencies.push(...reg.currencies);
    bags.samples.push(...voiceSamples(ctx));
    if (!inlineSvg) inlineSvg = inlineSvgLogo(html, url);

    if (isHome) {
      const cs = colourSightings(ctx);
      bags.sightings.push(...cs.sightings);
      for (const u of cs.unparsed) bags.unparsed.set(u.fn, (bags.unparsed.get(u.fn) || 0) + u.occurrences);
      typography = typographyCandidates(ctx);
      typeScale = typeScaleCandidates(ctx);
      designTokens = designTokenCandidates(ctx);
    } else {
      // Non-home pages still contribute their own inline <style> and their
      // declared theme-color, which regional storefronts often differ on.
      const cs = colourSightings(ctx);
      bags.sightings.push(...cs.sightings.filter((s) => s.role === 'identity' || s.role === 'action'));
    }
  }

  // ── ranking.
  const roles = rankColours(bags.sightings);
  const palette = proposePalette(roles);
  const unparsedList = [...bags.unparsed.entries()].map(([fn, n]) => ({ fn, occurrences: n }));
  if (unparsedList.length) {
    limits.push(`Colour syntaxes this parser does not resolve were present and were NOT guessed at: ${unparsedList.map((u) => `${u.fn}() x${u.occurrences}`).join(', ')}.`);
  }

  const fields = {
    name: fieldOf(bags.name, 'brand name'),
    tagline: fieldOf(bags.tagline, 'tagline'),
    website: {
      value: homeUrl, source_url: homeUrl, signal: 'crawl:resolved home page', confidence: CONF.declared,
      evidence: homeUrl === crawl.start ? 'The URL you supplied.' : `You supplied ${crawl.start}, which resolved to this page.`,
      candidates: [],
    },
    logo: Object.assign(fieldOf(bags.logo, 'logo URL'), { inline_svg: inlineSvg }),
    // Icons and imagery are SETS, not a single winning value, so they are
    // reported as ranked lists rather than through fieldOf(). An operator
    // picking a favicon wants to see the sizes on offer; one briefing a
    // creative wants the photographs, each with the page it came from.
    icons: (() => {
      const ranked = rankCandidates(bags.icons, 24);
      return ranked.length
        ? { candidates: ranked, count: ranked.length,
            note: 'Square app marks (favicon, home-screen, manifest). Sizes are what the site DECLARED; nothing was measured. These are not the logo - see `logo`.' }
        : { candidates: [], count: 0, marker: MARKER('icons') };
    })(),
    images: (() => {
      const ranked = rankCandidates(bags.images, 60);
      const offOrigin = ranked.filter((c) => c.off_origin).length;
      return ranked.length
        ? { candidates: ranked, count: ranked.length, off_origin_count: offOrigin,
            note: 'The brand\'s own published imagery, each row carrying the page it was found on. '
              + (offOrigin ? offOrigin + ' are hosted off-origin: a CDN is normal and a hotlinked stock photo is not the brand\'s to use, and this cannot tell them apart, so they are flagged rather than adopted. ' : '')
              + 'Logos and icons are excluded - they have their own fields.' }
        : { candidates: [], count: 0, marker: MARKER('brand imagery') };
    })(),
    palette: {
      proposed: palette.proposed,
      sources: palette.sources,
      conflicts: palette.conflicts,
      notes: palette.notes,
      roles,
      markers: palette.missing.map((k) => MARKER(`palette.${k}`)),
    },
    typography: {
      heading: typography.heading, body: typography.body, mono: typography.mono,
      font_faces: typography.font_faces, google_font_links: typography.google_font_links,
      // The scale, the weights, the rhythm and the text colours. These used to
      // be declared unobservable and shipped as a marker; they are published in
      // the same stylesheets as the families and are read the same way.
      scale: (typeScale && typeScale.scale) || [],
      slots: (typeScale && typeScale.slots) || {},
      tokens: (typeScale && typeScale.tokens) || { size: [], weight: [], leading: [], tracking: [] },
      root_font_size: (typeScale && typeScale.root_font_size) || null,
      markers: [].concat(
        typography.heading.length ? [] : [MARKER('typography.heading')],
        typography.body.length ? [] : [MARKER('typography.body')],
        // A site that publishes no size anywhere genuinely has none to read, and
        // that is a different statement from "this cannot be read".
        (typeScale && typeScale.scale.length) ? [] : [MARKER('typography scale (size, weight, line-height, letter-spacing)')],
      ),
    },
    // Radius / spacing / elevation / motion, from NAMED tokens only. Empty is a
    // real answer: it means the site ships no named scale, not that it has none.
    design_tokens: Object.assign({
      groups: designTokens || {},
      note: 'Only custom properties whose NAME declares what they are were taken. A padding measured off one rule is one measurement, not a spacing scale, so nothing was inferred from usage.',
    }, {
      markers: designTokens && Object.values(designTokens).some((l) => l.length)
        ? [] : [MARKER('design tokens (radius, spacing, elevation, motion)')],
    }),
    voice: null,   // filled below
    claims: {
      candidates: rankCandidates(bags.claims, 24),
      note: 'These are VERBATIM sentences from the site, not approved claims. Under the operating spec only a claim approved for the exact product, region and channel may be used in an asset, so each one starts unapproved.',
    },
    social: { candidates: rankCandidates(bags.social, 20) },
    legal: {
      candidates: rankCandidates(bags.legal),
      documents: bags.docs,
      note: bags.legal.length ? '' : 'No legal entity was declared. It is usually in a terms or imprint page, or in the footer copyright line.',
    },
    regions: {
      candidates: [...bags.regions.values()].map((r) => Object.assign({}, r, {
        currency: '',
        currency_note: 'A locale is not a currency. Currency is only ever taken from a declared price currency, so this is left for you to set.',
      })),
      currencies_seen: bags.currencies.filter((c, i, a) => a.findIndex((x) => x.currency === c.currency) === i).slice(0, 12),
    },
  };

  if (o.voice === false) {
    fields.voice = { value: null, marker: MARKER('voice.tone'), note: 'Voice observation was not requested.' };
  } else {
    fields.voice = await observeVoice(bags.samples, o);
  }

  const markers = [];
  for (const [k, f] of Object.entries(fields)) {
    if (f && f.marker) markers.push(f.marker);
    if (f && Array.isArray(f.markers)) markers.push(...f.markers);
    if (k === 'claims' && !fields.claims.candidates.length) markers.push(MARKER('verifiable claims'));
    if (k === 'social' && !fields.social.candidates.length) markers.push(MARKER('social profiles'));
    if (k === 'legal' && !fields.legal.candidates.length) markers.push(MARKER('legal entity'));
    if (k === 'regions' && !fields.regions.candidates.length) markers.push(MARKER('regions'));
  }
  markers.push(MARKER('voice.banned phrases'));   // never observable, always the operator's

  return {
    ok: true,
    start: homeUrl,
    hosts: [...hosts],
    pages: [...pages.keys()],
    pages_visited: pages.size,
    stylesheets: fetchedSheets.map((s) => s.url),
    inline_style_blocks: inlineSheets.length,
    manifest_url: manifest ? manifest.__url : '',
    stopped: crawl.stopped,
    coverage_note: crawl.coverage_note,
    fields,
    markers: [...new Set(markers)],
    limits,
    notes: notes.concat(crawl.notes || []).slice(0, 60),
    // Present ONLY when nothing was read, and the single thing the page should
    // show first in that case.
    diagnosis,
  };
}

/**
 * Why did a successful crawl read nothing?
 *
 * The crawl records the outcome of every attempt in `notes` ("unreachable
 * (403): …", "skipped (robots.txt): …"). Collapsing all of those into one
 * sentence was the bug an operator hit with a site behind a bot filter: the
 * page said "Read 0 page(s)" and the reason, which the server already had, was
 * never shown. Each branch below names a DIFFERENT next action, which is the
 * whole point of separating them.
 */
function diagnoseEmptyCrawl(startUrl, crawl) {
  const notes = (crawl && crawl.notes) || [];
  const statuses = notes
    .map((n) => /unreachable \((\d+)\)/.exec(String(n)))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const robots = notes.filter((n) => /skipped \(robots\.txt\)/.test(String(n))).length;
  const host = (() => { try { return new URL(startUrl).hostname; } catch (_) { return startUrl; } })();
  const worst = (code) => statuses.filter((s) => s === code).length;

  if (robots && !statuses.length) {
    return {
      reason: 'robots_disallowed',
      message: `${host} publishes a robots.txt that disallows the pages this reader would have fetched, and this platform honours it. Nothing was read.`,
      next_steps: [
        'Fill the brand in by hand below, or start from a template profile.',
        'If you own this domain, allow the paths you want read in robots.txt and try again.',
      ],
    };
  }
  if (worst(403) || worst(401) || worst(429)) {
    return {
      reason: 'blocked_by_site',
      message: `${host} answered ${worst(429) ? 'a rate limit' : 'a refusal'} to an automated request (HTTP ${worst(403) ? 403 : worst(401) ? 401 : 429}). That is bot protection on the site, not a problem with the address: a browser opening the same URL will usually load it fine.`,
      next_steps: [
        'Fill the brand in by hand below, or start from a template profile - it takes a minute and nothing here is guessed for you.',
        'Try the exact host your site actually serves on (with or without www), in case only one variant is protected.',
        'If you own the domain, allow this reader through your bot filter, then re-run.',
      ],
    };
  }
  if (worst(404) || worst(410)) {
    return {
      reason: 'not_found',
      message: `${host} returned "not found" for that address.`,
      next_steps: ['Check the URL, including the path and any locale prefix your site uses.'],
    };
  }
  if (statuses.some((s) => s >= 500)) {
    return {
      reason: 'site_error',
      message: `${host} returned a server error, so nothing could be read. This is usually temporary.`,
      next_steps: ['Try again in a few minutes.'],
    };
  }
  if (statuses.some((s) => s === 0)) {
    return {
      reason: 'unreachable',
      message: `${host} could not be reached at all - the name did not resolve, or the connection timed out.`,
      next_steps: ['Check the spelling of the domain.', 'Confirm the site is publicly reachable and not behind a VPN or a private network.'],
    };
  }
  return {
    reason: 'no_html',
    message: `${host} answered, but nothing it returned was an HTML page this reader could parse. A site rendered entirely by JavaScript publishes almost nothing in its HTML, and there is no browser here to run it.`,
    next_steps: [
      'Fill the brand in by hand below, or start from a template profile.',
      'If your site has a server-rendered page (an about or policy page often is), paste that URL instead.',
    ],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. THE `op=extract` ENTRY POINT
   Mounted on the existing brand router (api/_shared/brand-workspace-core.js),
   not on a new api/*.js file: the Hobby plan caps this project at 12
   serverless functions and it is at the cap.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Runs the extraction for an authenticated caller. The URL is SSRF-checked
 * before anything leaves the runtime — this fetches an address supplied by any
 * signed-in user, which is the same exposure the catalogue importer has and
 * gets the same guard.
 */
async function runExtract(auth, { url, workspace_id, voice = true, max_pages } = {}) {
  const core = require('./brand-workspace-core.js');
  const raw = String(url || '').trim();
  if (!raw) { const e = new Error('A website URL is required.'); e.status = 400; throw e; }
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const base = await core.assertPublicUrl(candidate);

  let brand = { website: base };
  if (workspace_id) {
    try {
      const ws = await core.getWorkspace(auth, workspace_id);
      if (ws) brand = { website: ws.website || base, regions: ws.regions, asset_hosts: ws.asset_hosts };
    } catch (_) { /* an unreadable workspace just means a narrower scope */ }
  }
  // The supplied URL is always in scope even when the saved record names a
  // different site: the operator is telling us where the brand lives.
  brand.asset_hosts = [].concat(brand.asset_hosts || [], [hostOf(base)]).filter(Boolean);

  const report = await extractBrand(base, {
    brand, voice: voice !== false,
    maxPages: Math.max(3, Math.min(30, +max_pages || DEFAULTS.maxPages)),
  });

  // Whatever the palette proposal is, it is put through the SAME gate that
  // blocks activation, so the wizard shows the real verdict rather than a
  // proposal that will be rejected two steps later.
  if (report.ok && report.fields && report.fields.palette) {
    const p = report.fields.palette.proposed || {};
    const filled = Object.fromEntries(Object.entries(p).filter(([, v]) => v));
    report.fields.palette.validation = Object.keys(filled).length
      ? core.validatePalette(filled)
      : { ok: false, errors: [{ field: 'primary', message: 'Nothing was extracted to validate.' }], warnings: [], contrast: {} };
  }
  return report;
}

module.exports = {
  extractBrand, runExtract, observeVoice, MARKER, DEFAULTS,
  // colour
  parseColor, isNeutral, relLum, satOf,
  // css
  cssRulesets, customProperties, splitDecls, declsOf, selectorRole, tokenNameRole, propWeight,
  colourSightings, rankColours, proposePalette,
  // fields
  nameCandidates, taglineCandidates, logoCandidates, iconCandidates, imageCandidates, inlineSvgLogo, typographyCandidates, designTokenCandidates,
  typeScaleCandidates, typeSlot, sizeInPx, rootFontSize, isSimpleSelector,
  socialCandidates, claimCandidates, legalCandidates, regionCandidates, voiceSamples,
  googleFontLinks, primaryFamily, blockTexts, trustRanges,
  // helpers
  stripTags, headOf, footerOf, attrs, rankCandidates,
};
