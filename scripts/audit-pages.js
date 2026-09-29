#!/usr/bin/env node
'use strict';
/**
 * scripts/audit-pages.js — check EVERY element and every word of every page.
 *
 *   node scripts/audit-pages.js           full report        (npm run audit:pages)
 *   node scripts/audit-pages.js --fail    exit 1 on any BLOCKER (CI gate)
 *   node scripts/audit-pages.js --page=x  audit one file (relative to the repo, or absolute)
 *
 * Also a module: `auditPage(file, html)` returns the findings for one page, and
 * tests/audit-pages.spec.js drives it over fixture pages so a rule that stops
 * seeing text fails a test instead of shipping a green CI.
 *
 * WHY THIS EXISTS. Cross-brand and wrong-industry content kept resurfacing one
 * screenshot at a time: the market study, the analytics workbench, the
 * competitor set, the mailer trust bar. Each was found by eye, which does not
 * scale to 65 pages and ~240k words and does not prevent the next one. This
 * turns "every element and every word is correct" into something a machine
 * checks on every build.
 *
 * WHAT IT CHECKS (BLOCKER = fails the build, WARN = reported only)
 *   1. Wrong-industry vocabulary        BLOCKER  tea/coffee/supplement relics
 *   2. Fabricated proof                 BLOCKER  ratings, review/customer counts
 *   3. Off-palette colour               BLOCKER  hexes outside the brand set
 *   4. Banned phrases                   BLOCKER  from the brand record itself
 *   5. Em/en dashes in copy             BLOCKER  standing product rule
 *   6. Fabricated/dead asset URLs       BLOCKER  CDN paths that cannot exist
 *   7. Broken internal links            BLOCKER  hrefs with no route or file
 *   8. Hardcoded brand name in shell    WARN     should resolve per brand
 *   9. Product-only assumptions         WARN     wrong for non-commerce brands
 *
 * Pages are classified first: an APP page is product surface and must be
 * brand-neutral; a BRAND ASSET (tenant zero's own landing pages, presells,
 * its agent) may legitimately name and describe that brand.
 *
 * TWO TEXTS, and which rule reads which. A page yields
 *   `text`   - everything a visitor can read (code stripped, nothing else), and
 *   `chrome` - the same with the blocks GATED to one tenant removed (see
 *              chromeOf below): what every OTHER tenant sees.
 * A rule that is skipped on BRAND_ASSET pages (`!isAsset`) asks "is the shell
 * neutral" and reads `chrome`; a rule that applies EVERYWHERE - fabricated
 * proof, banned phrases, dashes - reads `text`, because the owning tenant still
 * sees a gated block, and rule 2 says a fabricated rating is a blocker
 * everywhere. Stripping the gated blocks once, up front, had exempted them
 * from every rule (post-merge review of PR #102).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const BRAND = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands/_default.json'), 'utf8'));
const PALETTE = Object.values(BRAND.palette || {}).filter((v) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)).map((v) => v.toUpperCase());
const BANNED = (BRAND.voice && BRAND.voice.banned) || [];

// Tenant zero's OWN marketing pages. These describe that brand on purpose.
/* Generated artefacts and frozen demos: tenant zero's OWN output, which may
   legitimately name tenant zero and its products. An APP surface may not.

   `agent.html` used to be on this list and should never have been. It is a live
   app page - shell, nav, credit meter, the customer-facing concierge - not an
   artefact, and listing it here meant NO brand rule ran against it. That is how
   it shipped telling every tenant's customers to ask about "colorways" and
   whether "airbrush actually works" while the audit reported zero blockers. An
   exclusion list is a place bugs go to hide, so entries have to earn their
   place: an artefact is something the app GENERATED, not merely a page that
   looks brand-heavy. */
const BRAND_ASSET = /(landing|presell|grail-drop|coffee-collection|storefront-3d|_sbtest|template-gallery|website-designs|official-designs|premium-experience|daily-email-calendar|usa-d2c-dashboard|usa-july|uk-non-engagers|lifecycle-campaign|avatars|diff-version|all-in-one|access-issues)/i;

// Vocabulary from the previous brand's industry. Anything here in an APP page
// is a relic of the rebrand, not deliberate copy.
const WRONG_INDUSTRY = [
  'ashwagandha', 'adaptogen', 'turmeric latte', 'masala chai', 'darjeeling',
  'oolong', 'matcha latte', 'loose leaf', 'teabag', 'tea bag', 'chamomile',
  'wellness journey', 'ayurveda', 'ayurvedic', 'mushroom coffee', 'arabica',
  'robusta', 'espresso', 'cold brew', 'french press', 'steeping', 'infusion',
  'gut health', 'collagen', 'probiotic', 'detox tea', 'herbal tea',
];

// Numeric proof the brand does not publish. Ratings and counts read as
// authoritative, so an invented one is the most damaging kind of copy.
const FABRICATED = [
  { rx: /\bRated\s+\d(?:\.\d)?\s*\/\s*5\b/gi, what: 'star rating' },
  { rx: /\b[\d,]{3,}\+?\s*(?:reviews|ratings)\b/gi, what: 'review count' },
  { rx: /\b[\d,]{4,}\+?\s*(?:customers|subscribers|members|users)\b/gi, what: 'customer count' },
  { rx: /\b\d+\s*million\s+(?:customers|users|readers|cups|pairs)\b/gi, what: 'audience claim' },
  { rx: /\b100%\s*(?:Natural|Organic|Pure)\b/gi, what: 'purity claim' },
];

const NEUTRAL_HEX = /^#(?:[0-9A-F])\1{5}$|^#(?:FFFFFF|000000|F5F5F5|EBEBEB|F7F7F7|FAFAFA|EEEEEE|DDDDDD|CCCCCC|999999|666666|333333|111111|1A1A1A|F6F6F6|F4F4F4|E3E3E3|D2D2D7|6E6E73)$/i;

// Status and data-visualisation colours are FUNCTIONAL, not brand: a chart
// needs more than four hues and a positive/negative signal must stay legible
// whatever the brand palette is. Only non-brand, non-functional hues count.
// Third-party PLATFORM colours identify an ad channel (Google, Meta, TikTok,
// YouTube, LinkedIn). They are not the tenant's brand and must not be
// re-themed: a Google Ads tile is supposed to look like Google.
const PLATFORM = /^#(?:4285F4|34A853|FBBC05|EA4335|FE2C55|25F4EE|1877F2|0A66C2|FF0000|25D366|E60023|FFFC00|1DA1F2|E1306C|5865F2)$/i;
const FUNCTIONAL = /^#(?:DC2626|7C3AED|4F46E5|374151|2D3748|1F2937|4B5563|6366F1|8B5CF6|10B981|059669|D97706|EA580C|0891B2|1A7F37|147014|0A7D33|16A34A|18794E|2F8F57|1D6B45|3FA46A|5FB487|8FD3B0|C9A227|B45309|F59E0B|9A7420|C0392B|B91C1C|EF4444|E89A9A|9B3A2E|1D4ED8|305C89|4B8BF5|6A3D7A|7424B5)$/i;

// A grey with a slight tint is still a NEUTRAL, not a brand colour: a
// slate/blue-grey UI scale (#0E1116, #F5F7FA) carries no brand meaning.
// Saturation, not the literal value, is what separates the two - the brand
// colours sit far above this threshold (#D0473E ~60%, #6A33D8 ~68%).
// Module-level (not inside the page loop) because the platform-identity gate
// imports it: the platform mark has to be neutral by the SAME definition this
// audit applies to page CSS, not by a second one that can drift.
const lowSat = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return true;
  // At the extremes, saturation is mathematically large but visually absent:
  // #0E1116 is near-black with a 3/255 blue lean. Judge those by lightness.
  if (l <= 0.12 || l >= 0.92) return (mx - mn) <= 0.06;
  const d = mx - mn;
  return (l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)) <= 0.16;
};

// Tenant vocabulary hardcoded into app chrome (rule 7b). Exported so the test
// fixture takes a word the RULE matches rather than one typed from memory.
const TENANT_VOCAB = /\b(sneakers?|kicks|hand-painted|grails?|colorways?|streetwear|rituals?)\b/gi;

/* ── text extraction ──────────────────────────────────────────────────────── */

/** Same length, same newlines: indices and line numbers survive the strip. */
const blank = (s) => s.replace(/[^\n]/g, ' ');

/**
 * Remove comments, scripts and styles - ONE left-to-right pass, the earliest
 * opener wins, the way a browser tokenises. Three separate regex passes have
 * an order-dependent hole either way round: a `<script>` opener inside a
 * comment (scripts first) or a `<!--` inside a script string (comments first)
 * eats real markup up to the next genuine closer. An unterminated opener runs
 * to the end of the file, which is also what a browser does with it.
 */
function stripCode(html) {
  const OPEN = /<!--|<script\b|<style\b/gi;
  let out = '', cursor = 0, m;
  while ((m = OPEN.exec(html))) {
    const start = m.index;
    const kind = m[0].toLowerCase();
    let end;
    if (kind === '<!--') {
      const c = html.indexOf('-->', start + 4);
      end = c < 0 ? html.length : c + 3;
    } else {
      const closeRx = new RegExp('</' + kind.slice(1) + '\\s*>', 'gi');
      closeRx.lastIndex = start;
      const c = closeRx.exec(html);
      end = c ? c.index + c[0].length : html.length;
    }
    out += html.slice(cursor, start) + blank(html.slice(start, end));
    cursor = end;
    OPEN.lastIndex = end;
  }
  return out + html.slice(cursor);
}

/**
 * The index just past the close tag that balances an element of `tag` whose
 * body starts at `bodyStart`, or -1 when nothing balances it. Runs on markup
 * with code already stripped, so a tag inside a comment or a string cannot
 * open or close anything here.
 */
function balancedEnd(markup, tag, bodyStart) {
  const openRx = new RegExp('<' + tag + '\\b', 'gi');
  const closeRx = new RegExp('</' + tag + '\\s*>', 'gi');
  let depth = 1, p = bodyStart;
  while (depth > 0) {
    openRx.lastIndex = p; closeRx.lastIndex = p;
    const o = openRx.exec(markup), c = closeRx.exec(markup);
    if (!c) return -1;
    if (o && o.index < c.index) { depth++; p = o.index + o[0].length; }
    else { depth--; p = c.index + c[0].length; }
  }
  return p;
}

/**
 * Remove balanced elements matched by `openRx` (group 1 = tag name, group 2 =
 * the attribute that gated it), FAILING CLOSED: an element that never closes
 * is left in place - it earns no exemption - and is reported in `unbalanced`
 * with its position, so it gets fixed rather than hidden. The old walk
 * advanced to the end of the file on a missing close and swallowed everything
 * after it, blockers included.
 */
function stripBalanced(markup, openRx, label) {
  const rx = new RegExp(openRx.source, 'gi');
  let out = '', cursor = 0, m;
  const unbalanced = [];
  while ((m = rx.exec(markup))) {
    const start = m.index;
    if (start < cursor) continue;                       // nested inside one already removed
    const tag = m[1].toLowerCase();
    const bodyStart = markup.indexOf('>', start) + 1;
    const end = balancedEnd(markup, tag, bodyStart);
    if (end < 0) {
      unbalanced.push({ tag, gate: m[2] || label, index: start });
      rx.lastIndex = bodyStart;                         // keep scanning: a balanced gate beside it still counts
      continue;
    }
    out += markup.slice(cursor, start) + blank(markup.slice(start, end));
    cursor = end;
    rx.lastIndex = end;
  }
  return { out: out + markup.slice(cursor), unbalanced };
}

/* Elements GATED to one brand are that brand's own material shipped inside an
   app page, not app chrome, and are excluded from the CHROME rules the way
   whole BRAND_ASSET pages are. The key is the attribute the RUNTIME consumes,
   never a comment anyone could add for a free pass:
     data-ms-built-for   the Market Study block research.html ships for the
                         brand it names (scripts/build-research-page.js); at run
                         time the whole block is re-rendered from the ACTIVE
                         brand's record, so tenant zero's study never renders
                         under another brand's name.
     data-shipped-for    a tenant's own artefact gallery (avatars, playbook,
                         music beds, templates); brand-context.gateShipped()
                         replaces the element with the DATA REQUIRED marker for
                         any other brand.
   research.html had 10 "sneaker"s before the generated block was visible HTML
   and 24 after, all inside tenant zero's own study; rule 7b read them as chrome.
   The element is removed by a balanced walk on its own tag name, so the rest of
   the page - which IS chrome - is still audited. */
const GATE = /<([a-z][a-z0-9-]*)\b[^>]*\b(data-(?:ms-built-for|shipped-for))=/;
function stripBrandGatedBlocks(markup) { return stripBalanced(markup, GATE, 'data-gated'); }

// Market-study report bodies are BRAND DATA, not app chrome: they are generated
// from the active brand's own market_study record (see
// scripts/build-research-page.js) and re-render client-side per brand. Tenant
// zero's study legitimately names its own industry there.
const MS_REPORT = /<(div)\b[^>]*\bclass="(ms-report)"/;
function stripBrandDataBlocks(markup) { return stripBalanced(markup, MS_REPORT, 'class="ms-report"'); }

/** Markup (code already stripped) to the words a visitor reads. */
function textOf(markup) {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

/** Everything the page's OWNER reads. */
function visibleText(html) { return textOf(stripCode(html)); }

/** What every OTHER tenant reads: the gated blocks removed, fail-closed. */
function chromeOf(html) {
  const code = stripCode(html);
  const g = stripBrandGatedBlocks(code);
  const d = stripBrandDataBlocks(g.out);
  return { text: textOf(d.out), unbalanced: [...g.unbalanced, ...d.unbalanced] };
}

function lineOf(html, index) { return html.slice(0, index).split('\n').length; }

/* ── routes ───────────────────────────────────────────────────────────────── */

// Routes the app actually serves.
const ROUTES = new Set();
try {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  for (const r of vercel.rewrites || []) if (r.source) ROUTES.add(r.source.split('?')[0]);
  for (const r of vercel.redirects || []) if (r.source) ROUTES.add(r.source.split('?')[0]);
} catch (_) {}

function routeExists(href) {
  const clean = href.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
  if (clean === '/' ) return true;
  if (ROUTES.has(clean)) return true;
  if (fs.existsSync(path.join(ROOT, clean.replace(/^\//, '')))) return true;
  if (fs.existsSync(path.join(ROOT, clean.replace(/^\//, '') + '.html'))) return true;
  // Dynamic routes are matched by pattern in vercel.json.
  for (const r of ROUTES) if (r.includes(':') && routePattern(r).test(clean)) return true;
  return false;
}

/**
 * A vercel.json dynamic source as a RegExp.
 *
 * The literal parts have to be ESCAPED. Building the pattern by substituting
 * into the raw string crashed the whole audit the moment a catch-all redirect
 * (`/:path*`) appeared in the config: `:path` became `[^/]+` and the trailing
 * `*` was left behind as a quantifier with nothing to repeat, so the tool died
 * with a SyntaxError instead of auditing anything.
 *
 * `:name*` matches one or more segments including the slashes between them;
 * `:name` matches exactly one. That is what Vercel means by each.
 */
function routePattern(source) {
  const parts = String(source).split(/(:[a-zA-Z][a-zA-Z0-9]*\*?)/);
  const body = parts.map((p) => {
    if (!p.startsWith(':')) return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return p.endsWith('*') ? '.+' : '[^/]+';
  }).join('');
  return new RegExp('^' + body + '$');
}

/* ── one page ─────────────────────────────────────────────────────────────── */

/** Audit one page. Returns its findings: { file, severity, rule, detail, line }. */
function auditPage(file, html) {
  const findings = [];
  const add = (severity, rule, detail, line) => findings.push({ file, severity, rule, detail, line: line || 0 });

  const isAsset = BRAND_ASSET.test(file);
  const text = visibleText(html);                 // the owner's view: every rule that applies EVERYWHERE
  const chrome = chromeOf(html);                  // every other tenant's view: the `!isAsset` rules
  for (const u of chrome.unbalanced) {
    add('WARN', 'gated-unbalanced',
      `<${u.tag} ${u.gate}> never closes, so it earns NO exemption: its content is audited as chrome until the markup is balanced`,
      lineOf(html, u.index));
  }

  // 1. Wrong-industry vocabulary (app pages only; a brand asset may say "coffee"
  //    when the brand genuinely sells a coffee-THEMED product).
  if (!isAsset) {
    for (const term of WRONG_INDUSTRY) {
      const rx = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      let hit = null;
      for (const mm of chrome.text.matchAll(rx)) {
        const around = chrome.text.slice(Math.max(0, mm.index - 120), mm.index + 120);
        if (/banned|do not use|never use|forbidden|avoid these|donts|"default"\s*:\s*\[/i.test(around)) continue;
        hit = mm; break;
      }
      if (hit) add('BLOCKER', 'wrong-industry', `"${hit[0]}" - relic of the previous brand's industry`);
    }
  }

  // 2. Fabricated proof (everywhere: a brand asset must not invent either).
  for (const { rx, what } of FABRICATED) {
    const m = text.match(rx);
    if (m) add('BLOCKER', 'fabricated-proof', `${what}: "${m[0]}"${m.length > 1 ? ` (+${m.length - 1} more)` : ''} - the brand publishes no such figure`);
  }

  // 3. Off-palette colour in page CSS.
  const cssOnly = (() => {
    let out = '';
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) out += m[1] + '\n';
    for (const m of html.matchAll(/style="([^"]*)"/gi)) out += m[1] + '\n';
    return out;
  })();
  const hexes = [...new Set((cssOnly.match(/#[0-9A-Fa-f]{6}\b/g) || []).map((h) => h.toUpperCase()))];
  const off = hexes.filter((h) => !PALETTE.includes(h) && !NEUTRAL_HEX.test(h) && !FUNCTIONAL.test(h) && !PLATFORM.test(h) && !lowSat(h));
  if (off.length && !isAsset) {
    add(off.length > 12 ? 'BLOCKER' : 'WARN', 'off-palette', `${off.length} non-brand colour(s): ${off.slice(0, 6).join(', ')}`);
  }

  // 4. Banned phrases straight from the brand record.
  //    Two things are NOT violations and must not be flagged:
  //      - technical homonyms: "perspective transform", "text-transform"
  //      - a page that DOCUMENTS the rule list (the styleguide, the playbook's
  //        config viewer). Those legitimately print the words they forbid.
  const TECHNICAL = /(perspective|text|css|3d|matrix|scale|rotate|translate)[\s-]transform|transform\s*:/i;
  const DOCUMENTS_RULES = /banned|do not use|never use|forbidden|avoid these|donts|"default"\s*:\s*\[/i;
  for (const phrase of BANNED) {
    const rx = new RegExp(`\\b${String(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    let hit = false;
    for (const m of text.matchAll(rx)) {
      const around = text.slice(Math.max(0, m.index - 120), m.index + 120);
      if (TECHNICAL.test(around) || DOCUMENTS_RULES.test(around)) continue;
      hit = true; break;
    }
    if (hit) add('BLOCKER', 'banned-phrase', `"${phrase}" used as copy (not as a documented rule)`);
  }

  // 5. Em/en dashes in visible copy (standing rule).
  const dash = text.match(/[—–]/g);
  if (dash) add('WARN', 'dash', `${dash.length} em/en dash(es) in copy - use commas, colons or plain hyphens`);

  // 6. Asset URLs that cannot exist.
  const badCdn = html.match(/https:\/\/cdn\.shopify\.com\/s\/files\/1\/[a-z]+\//gi);
  if (badCdn) add('BLOCKER', 'fabricated-url', `${badCdn.length} CDN path(s) with a non-numeric shop id - these 404`);

  // 7. Internal links that go nowhere.
  const hrefs = [...html.matchAll(/href="(\/[^"#][^"]*)"/g)];
  const broken = new Set();
  for (const h of hrefs) {
    const href = h[1];
    if (href.startsWith('//') || href.startsWith('/api/')) continue;
    if (/\.(css|js|png|jpg|jpeg|svg|webmanifest|ico|woff2?|mp4|wav|docx?)$/i.test(href)) {
      if (!fs.existsSync(path.join(ROOT, href.replace(/^\//, '').split('?')[0]))) broken.add(href);
      continue;
    }
    if (!routeExists(href)) broken.add(href);
  }
  if (broken.size) add('BLOCKER', 'broken-link', `${broken.size} internal link(s) with no route or file: ${[...broken].slice(0, 5).join(', ')}`);

  // 7b. Tenant vocabulary hardcoded into app chrome. The app surface renders
  //     for EVERY brand, so no tenant's product language belongs in it - not
  //     even tenant zero's. (Its own campaign hubs are classified as brand
  //     assets above and are allowed their own vocabulary.)
  if (!isAsset) {
    let tHit = null;
    for (const mm of chrome.text.matchAll(TENANT_VOCAB)) {
      const around = chrome.text.slice(Math.max(0, mm.index - 100), mm.index + 100);
      if (/banned|donts|forbidden|"default"\s*:\s*\[/i.test(around)) continue;   // documented rules
      tHit = mm; break;
    }
    if (tHit) add('BLOCKER', 'tenant-vocab', `"${tHit[0]}" hardcoded in app chrome - the shell renders for every brand`);
  }

  // 7c. A page that promises real-only data must not be ABLE to render invented
  //     numbers. dashboard.html tells the user it never displays synthetic
  //     figures, and keeps a full synthetic generator in the file with a comment
  //     saying it is deliberately never called. A comment is not an enforcement:
  //     one restored call site and the page shows fabricated money while still
  //     promising it does not, and nothing would catch it. So the promise is
  //     checked against the call graph.
  const PROMISES_REAL = /does not display sample or synthetic|never fabricates numbers|runs on your real [^.]*data only/i.test(text);
  if (PROMISES_REAL) {
    // Scanned against CODE, not prose. The comment that explains why the
    // generator is never called says "genSeed() ... is retained but
    // deliberately never called", and counting that sentence as a call site
    // would make this rule fire on exactly the page that is doing the right
    // thing, which is the fastest way to get a check deleted.
    const codeOnly = html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');

    const fabricators = [...codeOnly.matchAll(/function\s+(gen(?:Seed|Synthetic|Demo|Sample)[A-Za-z]*|makeSynthetic[A-Za-z]*|fabricate[A-Za-z]*)\s*\(/g)]
      .map((m) => m[1]);
    for (const fn of [...new Set(fabricators)]) {
      // Every occurrence of `name(` including the definition itself; more than
      // one means something actually calls it.
      const uses = codeOnly.match(new RegExp(`(?<![.\\w$])${fn}\\s*\\(`, 'g')) || [];
      if (uses.length > 1) {
        add('BLOCKER', 'fabricator-reachable',
          `${fn}() is reachable (${uses.length - 1} call site(s)) on a page that tells the user it shows no synthetic numbers`);
      }
    }
  }

  // 7d. Brand-scoped working state must be stored per brand.
  //     Every page here holds state between steps in localStorage: the analytics
  //     handed from the dashboard to the calendar to the studio, the approved
  //     slots, the ad set, the currency. Under a flat key, switching brands
  //     shows the PREVIOUS brand's numbers and offers under the new brand's
  //     name - the most convincing kind of wrong, because everything is
  //     labelled correctly. window.LCStore (brand-context.js) appends the active
  //     workspace id; these keys must go through it.
  const BRAND_SCOPED_STATE = /^(?:knickgasm-(?:retention-data|cal-approved|studio-handoff|ads-v1|currency|last-agent-lp)|d2c_brand_profile)$/;
  for (const m of html.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*['"]([\w.-]+)['"]/g)) {
    if (!BRAND_SCOPED_STATE.test(m[1])) continue;
    if (isAsset) continue;                    // a tenant's own artefact page keeps its own state
    add('BLOCKER', 'unscoped-brand-state',
      `localStorage key "${m[1]}" holds brand-specific state but is not scoped to a brand - use LCStore.get/set/remove so a brand switch cannot inherit it`,
      lineOf(html, m.index));
  }

  // 7e. Text must stay legible whatever the brand's palette is.
  //     A rule that paints its own background from a brand token but hardcodes
  //     a light text colour is only readable while that token happens to be
  //     dark. Onboard a brand with a light primary and the text disappears
  //     into it - white on white, correctly laid out and completely unreadable.
  //     brand-workspace-core computes --brand-on-primary and --brand-on-accent
  //     by picking the highest-contrast candidate for that brand, so a pairing
  //     built from a brand token must take its text colour from the matching
  //     on- token rather than assuming.
  const PRIMARY_BG = /^--(?:green|violet|brand-primary|primary|head)\b/;
  const ACCENT_BG = /^--(?:lava|brand-accent|accent)\b/;
  const LIGHT_TEXT = /(?:^|[;\s])color\s*:\s*#(?:fff|ffffff)\b/i;
  const declBlocks = [];
  for (const m of cssOnly.matchAll(/\{([^{}]*)\}/g)) declBlocks.push(m[1]);
  for (const m of html.matchAll(/style="([^"]*)"/g)) declBlocks.push(m[1]);
  for (const body of declBlocks) {
    const bg = body.match(/background(?:-color)?\s*:\s*var\(\s*(--[a-zA-Z0-9-]+)/);
    if (!bg) continue;
    const onToken = PRIMARY_BG.test(bg[1]) ? '--brand-on-primary'
      : ACCENT_BG.test(bg[1]) ? '--brand-on-accent' : null;
    if (!onToken) continue;
    if (!LIGHT_TEXT.test(body)) continue;
    add('BLOCKER', 'unreadable-pairing',
      `text is hardcoded light on a brand-token background (var(${bg[1]})) - use color:var(${onToken},#fff), which is contrast-computed per brand, or the text vanishes for any brand with a light ${onToken === '--brand-on-primary' ? 'primary' : 'accent'}`);
    break;                                   // one finding per file is enough to act on
  }

  // 7f. A table cell that cannot wrap must not be able to spill either.
  //     theme.css sets `table{table-layout:fixed;width:100%}` as a global
  //     default and relies on its own `overflow-wrap:break-word` to keep a long
  //     value inside its cell. A page that sets `white-space:nowrap` on td/th
  //     at higher specificity defeats that wrapping WITHOUT opting out of the
  //     fixed layout, and fixed layout divides the width equally regardless of
  //     content. The text then has nowhere to go: it overflows its cell and
  //     paints on top of the next column.
  //
  //     This is not hypothetical. The Live Ads table has fourteen columns, so
  //     each got about 64px, and Campaign and Ad group rendered as one
  //     superimposed unreadable string - on the table whose whole job is to say
  //     which ad a number belongs to.
  //
  //     Either opt out of the layout (`table-layout:auto` plus a scrolling
  //     wrapper) or clip (`overflow:hidden`, ideally with text-overflow and the
  //     full value on a title). Doing neither is the bug.
  {
    // Comments are stripped and the selector token needs a word boundary. Both
    // matter: the first version of this rule matched `th` inside the word "the"
    // in a CSS comment and reported a page with no <table> on it at all. A gate
    // that fails on prose is a gate people learn to ignore.
    const css = cssOnly.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const nowrapCell = /(?:^|[,{}\s])(?:table\s+)?(?:t[dh]|[.#][\w-]+\s+t[dh])(?![\w-])[^{}]*\{[^{}]*white-space\s*:\s*nowrap/i;
    const optsOut = /table-layout\s*:\s*auto/i.test(css);
    const clips = /t[dh](?![\w-])[^{}]*\{[^{}]*overflow\s*:\s*hidden/i.test(css);
    if (nowrapCell.test(css) && !optsOut && !clips) {
      const m = css.match(nowrapCell);
      add('BLOCKER', 'table-cell-overlap',
        'table cells are white-space:nowrap under the global table-layout:fixed default, so a value wider than its equal-share column paints over the next one - set table-layout:auto on the table (with a scrolling wrapper) or overflow:hidden on the cells',
        lineOf(html, m.index));
    }
  }

  // 8. Hardcoded brand identity on an APP page.
  if (!isAsset) {
    const brandHits = (chrome.text.match(/\bKNICKGASM\b|\bKnickgasm\b/g) || []).length;
    if (brandHits) add('WARN', 'hardcoded-brand', `brand name appears ${brandHits}x in visible copy - app surface should resolve the ACTIVE brand`);
  }

  // 8b. Tenant zero's PRODUCT VOCABULARY on an app page.
  //
  // Rule 8 catches the brand NAME, and that is exactly why this shipped: the
  // /agent page told The Times of India's readers to ask "whether a colorway is
  // worth it" and "does airbrush actually work?", and the audit passed it with
  // zero blockers. A product noun is not the brand name, so the name swap in
  // brand-context.js cannot fix it and this audit could not see it.
  //
  // Nouns from tenant zero's own record (sneakers, colorways, hand-painted) and
  // its market (a "Namaste" greeting shown to a US brand) belong to ONE tenant.
  // An app surface either writes them neutrally or derives them from the active
  // brand's offerings[].kind - see BrandContext.nouns().
  if (!isAsset) {
    const VOCAB = /\b(sneakers?|colorways?|airbrush(?:ed|ing)?|streetwear|hand-painted|grail|Namaste)\b/gi;
    const hits = [...new Set((chrome.text.match(VOCAB) || []).map((h) => h.toLowerCase()))];
    if (hits.length) {
      add('WARN', 'tenant-zero-vocabulary',
        `visible copy uses tenant zero's product vocabulary (${hits.join(', ')}) - an app surface must be neutral or derive the noun from the active brand`);
    }
  }

  // 9. Product-only assumptions in shared UI copy.
  if (!isAsset) {
    for (const rx of [/\bShop the edit\b/i, /\bAdd to cart\b/i, /\byour cart\b/i]) {
      const m = chrome.text.match(rx);
      if (m) add('WARN', 'product-assumption', `"${m[0]}" assumes the brand sells products`);
    }
  }

  return findings;
}

/* ── the CLI ──────────────────────────────────────────────────────────────── */

function pageFiles(one) {
  if (one) return [one];
  return fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
}

function main(argv) {
  const ARGS = argv.slice(2);
  const FAIL_MODE = ARGS.includes('--fail');
  const ONE = (ARGS.find((a) => a.startsWith('--page=')) || '').split('=')[1];

  const files = pageFiles(ONE);
  const findings = [];
  for (const file of files) {
    const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
    let html;
    try { html = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
    findings.push(...auditPage(path.basename(file), html));
  }

  // ── Report ──────────────────────────────────────────────────────────────
  const byFile = {};
  for (const f of findings) (byFile[f.file] = byFile[f.file] || []).push(f);
  const blockers = findings.filter((f) => f.severity === 'BLOCKER');
  const warns = findings.filter((f) => f.severity === 'WARN');

  const withFindings = Object.keys(byFile).sort();
  for (const f of withFindings) {
    const rows = byFile[f];
    const b = rows.filter((r) => r.severity === 'BLOCKER').length;
    console.log(`\n${f}  (${b} blocker, ${rows.length - b} warn)`);
    for (const r of rows) console.log(`  ${r.severity.padEnd(7)} ${r.rule.padEnd(18)} ${r.detail}${r.line ? ` (line ${r.line})` : ''}`);
  }

  const clean = files.length - withFindings.length;
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`Pages audited: ${files.length}   clean: ${clean}   with findings: ${withFindings.length}`);
  console.log(`BLOCKERS: ${blockers.length}   WARNINGS: ${warns.length}`);
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  console.log('By rule:', Object.entries(byRule).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ') || 'none');

  if (FAIL_MODE && blockers.length) {
    console.error(`\nFAIL: ${blockers.length} blocker(s). Every element and every word of an app page must be correct for the active brand.`);
    return 1;
  }
  return 0;
}

module.exports = {
  auditPage, visibleText, chromeOf, stripCode, stripBrandGatedBlocks, stripBrandDataBlocks, balancedEnd,
  WRONG_INDUSTRY, TENANT_VOCAB, FABRICATED, BRAND_ASSET, NEUTRAL_HEX, lowSat,
};

if (require.main === module) process.exit(main(process.argv));
