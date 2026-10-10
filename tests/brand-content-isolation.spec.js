/**
 * Every page, every brand, every document a page opens: nothing of tenant zero.
 * ---------------------------------------------------------------------------
 * WHY. The operator, on production with a brand of their own ("Deli Chic")
 * active, opened /knowledge-base and pressed a Brand Knowledge Base card: it
 * opened tenant zero's static markdown in an about:blank window - another
 * company's brand foundation, with no URL to it. Earlier sweeps had passed the
 * same pages, for two reasons this gate exists to remove:
 *
 *   1. NAME-ONLY CHECKS ARE FOOLED. brand-context.js renames the literal
 *      "KNICKGASM" to the active brand in page text, so tenant zero's prose
 *      READS as the active brand's ("The canonical Deli Chic truth ...") while
 *      describing sneakers. So tenant zero is detected by its CONTENT
 *      SIGNATURE, derived from its own record and its built catalogue (claims,
 *      tagline, legal entity and address, store hosts, preferred vocabulary,
 *      every product title and product line, the proof names its mailers
 *      carry, its palette as rendered colour) plus the sibling brand the fork
 *      came from (tea / wellness: scripts/audit-pages.js WRONG_INDUSTRY). And a
 *      SENTENCE whose brand name was swapped in at runtime is caught as such:
 *      the relabel is observed as it happens (the Text node's value setter is
 *      wrapped before any page script runs), so prose written about tenant zero
 *      cannot pass by wearing another name.
 *   2. OPENED WINDOWS WERE NEVER READ. An activation that opened a window,
 *      downloaded a file, made a blob, wrote an iframe or the clipboard was
 *      "worked locally", and what it produced was never inspected. Here every
 *      popup is a REAL window (window.open is not stubbed), every download is
 *      saved and read, every blob's bytes are read as they are made, every
 *      iframe and srcdoc is walked, and the clipboard is captured - and each
 *      runs through the same checks as the page. A user-facing document at
 *      about:blank / blob: / data: is itself a defect: a person cannot link to
 *      it, return to it or tell where it came from.
 *
 * WHAT IS FLAGGED, per page and per brand:
 *   (a) signature      tenant zero's or the sibling's content, in any text, attribute,
 *                      title, meta tag, canvas string, iframe, popup, download,
 *                      blob or clipboard write - or its palette as a COMPUTED colour
 *   (b) no-url         a user-facing document opened at about:blank, blob: or data:
 *   (c) foreign-asset  an image / icon / media URL on tenant zero's hosts (its store,
 *                      its Shopify CDN path, the bundled data/catalog files, its mark)
 *   (d) dead-link      a same-origin link that resolves to nothing on this
 *                      deployment's own vercel.json (redirects -> files -> rewrites,
 *                      host-conditioned redirects ignored, as Vercel applies them)
 *   (e) name-swapped   a sentence written about tenant zero with its name replaced
 *                      by the active brand's at runtime: static prose, not the record
 *
 * HOW. Chromium, the real pages served as a real host. The person is signed in
 * the way production signs people in today: a mobile number + PIN kept on the
 * device (no DATABASE_URL), the active brand in the per-account device store,
 * and the /api/ routers that matter are the SHIPPED ones (tests/agents-harness,
 * production's configuration). Two brands, neither tenant zero: a rich preset
 * (The Times of India) and a BARE operator-made brand with only a name and a
 * URL (Deli Chic) whose palette and type are the onboarding wizard's own
 * starting values, read from the wizard, because that is exactly what a brand
 * made by typing two fields carries. For each page: load, read everything,
 * then press every control the signed-out sweep presses (same selector, same
 * de-duplication by signature), reading what each press rendered and every
 * document it produced. Links are resolved, not followed; a same-origin
 * DOCUMENT a link offers (html, md) that is not itself a swept page is read
 * one hop deep, because a link IS an offer of that document.
 *
 * Pages are not hand-listed: every root page, every rewrite destination, every
 * file that loads the shell, and every rail destination (read from the
 * rendered rail's own model). Excluded files carry their reason.
 *
 * The sweep prints the inventory (page -> defect, where, excerpt, and the
 * source file:line that produces it) and fails on any defect not in
 * OWNED_ELSEWHERE. Every count is asserted non-trivial first: a check that
 * inspects nothing passes everything.
 *
 * Run: npx playwright test tests/brand-content-isolation.spec.js --project=desktop-1280
 *      BCI_PAGES=a.html,b.html narrows a local run; CI never sets it.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./agents-harness');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'http://app.example.test';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (_) { return false; } };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
const { WRONG_INDUSTRY } = require(path.join(ROOT, 'scripts', 'audit-pages.js'));
const workspaceCore = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));

const ZERO = JSON.parse(read('data/brands/_default.json'));
const ZERO_SLUG = String(ZERO.slug || 'knickgasm').toLowerCase();
const TOI = JSON.parse(read('data/brands/presets/times-of-india.json'));
const VERCEL = JSON.parse(read('vercel.json'));
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ══ routing: the deployment's own rules, in Vercel's order ═══════════════════ */

// Host-conditioned redirects (the old domains -> the canonical one) do not apply
// to a request on this host. Counting them made `/:path*` match EVERY path, which
// is how the signed-out sweep's dead-link check came to pass every link.
const REDIRECTS = (VERCEL.redirects || []).filter((r) => !r.has);
const REWRITES = (VERCEL.rewrites || []).filter((r) => !r.has);
function compileSource(source) {
  const keys = [];
  const rx = '^' + source.split('/').map((seg) => {
    const m = seg.match(/^:([A-Za-z_]\w*)(\*)?$/);
    if (m) { keys.push(m[1]); return m[2] ? '(.*)' : '([^/]+)'; }
    return esc(seg);
  }).join('/') + '/?$';
  return { rx: new RegExp(rx), keys };
}
const COMPILED_REDIRECTS = REDIRECTS.map((r) => Object.assign({}, r, compileSource(r.source)));
const COMPILED_REWRITES = REWRITES.map((r) => Object.assign({}, r, compileSource(r.source)));
function substitute(dest, keys, m) {
  let out = dest;
  keys.forEach((k, i) => { out = out.split(':' + k).join(m[i + 1] || ''); });
  return out;
}
/** A filesystem path for a URL path, or '' - a directory serves its index.html. */
function fileFor(p) {
  const rel = decodeURIComponent(p).replace(/^\/+/, '');
  if (rel.includes('..')) return '';
  if (rel === '') return 'index.html';
  if (exists(rel)) return rel;
  const idx = rel.replace(/\/$/, '') + '/index.html';
  if (exists(idx)) return idx;
  return '';
}
/**
 * Where a same-origin URL path lands: { kind: 'file'|'api'|'dead', file, path }.
 * Redirects first, then the filesystem, then rewrites - Vercel's order.
 */
function resolveRoute(pathname, depth) {
  const d = depth || 0;
  if (d > 6) return { kind: 'dead', path: pathname, why: 'redirect loop' };
  const p = pathname.split('#')[0].split('?')[0] || '/';
  for (const r of COMPILED_REDIRECTS) {
    const m = p.match(r.rx);
    if (!m) continue;
    const dest = substitute(r.destination, r.keys, m);
    if (/^https?:\/\//i.test(dest)) return { kind: 'external', path: dest };
    return resolveRoute(dest, d + 1);
  }
  if (/^\/api\//.test(p)) {
    const base = p.replace(/^\//, '').replace(/\/$/, '');
    if (exists(base + '.js') || exists(base + '/index.js')) return { kind: 'api', path: p };
  }
  const f = fileFor(p);
  if (f) return { kind: 'file', file: f, path: p };
  for (const r of COMPILED_REWRITES) {
    const m = p.match(r.rx);
    if (!m) continue;
    const dest = substitute(r.destination, r.keys, m).split('?')[0];
    if (/^\/api\//.test(dest)) return { kind: 'api', path: dest };
    const df = fileFor(dest);
    return df ? { kind: 'file', file: df, path: p } : { kind: 'dead', path: p, why: 'rewrite to a missing file: ' + dest };
  }
  return { kind: 'dead', path: p, why: 'no file, rewrite or redirect' };
}

/* ══ the pages: derived, never hand-kept ══════════════════════════════════════ */

const SHELL_TAG = /<script[^>]+src=["'][^"']*\bauth\.js/;
function walkHtml(dir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'test-results' || e.name === 'coverage') continue;
    const rel = dir ? dir + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!['tests', 'android', 'ios', 'marketing_automation', 'mobile', 'mobile-shell', 'output', 'supabase', 'node_modules'].includes(e.name)) walkHtml(rel, out); }
    else if (e.name.endsWith('.html')) out.push(rel);
  }
  return out;
}
const ALL_HTML = walkHtml('', []);

/**
 * Files that are tenant zero's OWN artefacts, each with its reason. They are
 * not app pages; what matters is that no other brand is OFFERED them, and the
 * one-hop link check below is what holds that: a link to one of these, on a
 * page rendered for another brand, is a defect at the link.
 */
const EXCLUDED = [
  // NOT excluded: the frozen diff-version snapshot. It is tenant zero's own
  // build, reachable by URL; for any other brand auth.js withholds it
  // (gateFrozenSnapshot), and this sweep holds that by reading it.
  { rx: /^knickgasm-[^/]+\.html$/, why: 'generated tenant-zero mailer artefact at the root, not an app page' },
  { rx: /^coffee-collection-landing-(no|with)-agent\.html$/, why: 'tenant zero\'s own public landing pages (no shell; a buyer\'s page, not an app page); website-designs.json marks them as its own, and the one-hop check fails any page that offers them' },
  { rx: /^docs\/(deck|prd-deck)\.html$/, why: 'tenant zero\'s internal decks (/deck, /prd-deck), linked from no page; the one-hop check fails any page that offers them' },
  { rx: /^lifecycle-usa-d2c-dashboard\.html$/, why: 'tenant zero\'s own US business review; offered only through Data Analysis\'s review tab, which withholds it from every other brand (swept there)' },
  { rx: /^lifecycle-usa-july-calendar-mailer-studio\.html$/, why: 'generated tenant-zero calendar artefact (build:july), rewrite-only, no rail row' },
  { rx: /^landing-pages\/final\//, why: 'tenant zero\'s own finished landing pages (/templates/*, /lp/grail-*, /lp/best*); a link to one is checked one hop deep from every page that offers it' },
  { rx: /^playbook\//, why: 'tenant zero\'s own generated playbook (scripts/gen-playbook-hub.js, from its market study): no shell and no brand layer, reachable only by its URL; the one-hop check fails any page that offers it' },
  { rx: /^_/, why: 'underscore-prefixed scratch file, not deployed as a page' },
];
const excludedWhy = (rel) => { const e = EXCLUDED.find((x) => x.rx.test(rel)); return e ? e.why : ''; };

const rootPages = ALL_HTML.filter((f) => !f.includes('/'));
const rewritePages = REWRITES.map((r) => r.destination.split('?')[0].replace(/^\//, '')).filter((f) => /\.html$/.test(f) && exists(f));
const shellPages = ALL_HTML.filter((f) => SHELL_TAG.test(read(f)));
// A file a redirect sends elsewhere (/data-analysis-contrast.html ->
// /data-analysis) is never served as itself: its destination is swept.
const servedAsItself = (f) => { const r = resolveRoute('/' + f); return r.kind === 'file' && r.file === f; };
const PAGES_ALL = Array.from(new Set([].concat(rootPages, rewritePages, shellPages))).filter((f) => !excludedWhy(f) && servedAsItself(f)).sort();
const ONLY = (process.env.BCI_PAGES || '').split(',').map((s) => s.trim()).filter(Boolean);
const PAGES = ONLY.length ? PAGES_ALL.filter((f) => ONLY.includes(f)) : PAGES_ALL;
const PAGE_SET = new Set(PAGES_ALL);

/* ══ the brands: two, neither tenant zero ════════════════════════════════════ */

/**
 * The onboarding wizard's own starting palette and type: what a brand made by
 * typing only a name and a URL carries. Read from the wizard's model, so the
 * fixture is the wizard's and not a guess at it.
 */
function wizardDefaults() {
  const src = read('onboarding.html');
  const pal = src.match(/var brand = \{[\s\S]*?palette:\s*(\{[^}]*\})/);
  const head = src.match(/heading:\s*\{\s*family:\s*'([^']+)',\s*stack:\s*"([^"]+)"/);
  const body = src.match(/body:\s*\{\s*family:\s*'([^']+)',\s*stack:\s*"([^"]+)"/);
  if (!pal || !head || !body) throw new Error('could not read the wizard\'s starting palette/typography from onboarding.html');
  // eslint-disable-next-line no-new-func
  const palette = Function('return (' + pal[1] + ')')();
  return {
    palette,
    typography: { heading: { family: head[1], stack: head[2], google: true }, body: { family: body[1], stack: body[2], google: true } },
  };
}
const WIZ = wizardDefaults();
function deviceRow(src, id) {
  return {
    id, slug: src.slug, name: src.name, legal_name: null, tagline: src.tagline || null, industry: src.industry || null,
    website: src.website || null, logo_url: src.logo_url || null, favicon_url: null,
    palette: src.palette || {}, typography: src.typography || {}, voice: src.voice || { tone: '', preferred: [], banned: [], no_em_dashes: true, notes: '' },
    regions: src.regions || [], asset_hosts: src.asset_hosts || [], catalog_source: src.catalog_source || {}, brand_data: src.brand_data || {},
    status: 'active', onboarding_step: 6, owner_id: null,
    created_at: '2026-10-04T00:00:00.000Z', updated_at: '2026-10-04T00:00:00.000Z', storage: 'device',
  };
}
const BRANDS = {
  'times-of-india': deviceRow(TOI, 'local-bcitoi0000000001'),
  // A brand an operator made by typing two fields, the shape production's
  // "Deli Chic" has: everything else is the wizard's starting value or empty.
  'deli-chic': deviceRow({ slug: 'deli-chic', name: 'Deli Chic', website: 'https://www.delichic.example', palette: WIZ.palette, typography: WIZ.typography }, 'local-bcideli000000001'),
};
for (const b of Object.values(BRANDS)) {
  const v = workspaceCore.validatePalette(b.palette);
  if (!v.ok) throw new Error(b.name + '\'s fixture palette would not activate: ' + JSON.stringify(v.errors));
}
const USER = { id: 'dev-bci0001', phone: '+919876543210', cc: '+91', local: '9876543210', name: 'Content Sweep' };

/* ══ tenant zero's signature, derived ════════════════════════════════════════ */

// Ordinary English that tenant zero lists as PREFERRED vocabulary; a news or
// food brand's own chrome may say "custom", "drop" or "original".
const COMMON_ENGLISH = new Set(['custom', 'canvas', 'drop', 'drops', 'rotation', 'crafted', 'original']);
// Catalogue product LINES that are ordinary words, not a product.
const COMMON_LINES = new Set(['laces', 'comet', 'denim jackets', 'undefined']);
function catalogue() {
  const rows = [];
  for (const r of ['us', 'uk', 'global']) {
    const f = path.join(ROOT, 'data', 'catalog', `products_${r}.json`);
    if (!fs.existsSync(f)) throw new Error('data/catalog/products_' + r + '.json is missing: run `npm run build` first (CI does). Tenant zero\'s product titles and image hosts are derived from it, and a gate that silently drops a signature class passes what it should fail.');
    rows.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  return rows;
}
const CATALOG = catalogue();

function zeroSignatures() {
  const sig = [];
  const add = (cls, label, rx) => sig.push({ cls, label, src: rx.source, flags: rx.flags.replace('g', '') });
  add('name', 'name: ' + ZERO.name, new RegExp('\\b' + esc(ZERO.name) + '\\b', 'i'));
  add('name', 'assistant: KicksGPT', /\bkicksgpt\b/i);
  const hosts = new Set([].concat(ZERO.asset_hosts || [], [ZERO.website], (ZERO.regions || []).map((r) => r.store_url)).filter(Boolean).map((h) => { try { return new URL(/^https?:/.test(h) ? h : 'https://' + h).hostname.replace(/^www\./, ''); } catch (_) { return ''; } }).filter(Boolean));
  for (const h of hosts) add('host', 'store host: ' + h, new RegExp(esc(h), 'i'));
  String(ZERO.legal_entity || '').split(/,\s*/).map((s) => s.trim()).filter((s) => s && !/^(india|usa|uk)$/i.test(s))
    .forEach((part) => add('legal', 'legal entity: ' + part, new RegExp(esc(part), 'i')));
  if (ZERO.tagline) add('claim', 'tagline: ' + ZERO.tagline, new RegExp(esc(ZERO.tagline), 'i'));
  (ZERO.claims || []).forEach((c) => add('claim', 'claim: ' + c, new RegExp(esc(c), 'i')));
  (((ZERO.voice || {}).preferred) || []).filter((w) => !COMMON_ENGLISH.has(String(w).toLowerCase()))
    .forEach((w) => add('vocab', 'preferred vocabulary: ' + w, new RegExp('\\b' + esc(w) + 's?\\b', 'i')));
  // The industry noun the record states ("Custom sneakers / D2C").
  String(ZERO.industry || '').split(/[\/,]/).map((s) => s.trim().replace(/^custom\s+/i, '')).filter((s) => s.length > 3 && !/^d2c$/i.test(s))
    .forEach((n) => add('vocab', 'industry noun: ' + n, new RegExp('\\b' + esc(n.replace(/s$/i, '')) + 's?\\b', 'i')));
  // Product LINES, from the catalogue's own `type` field (Nike Air Force 1,
  // Nike Air Jordan, Converse, Nike Dunks ...), the maker prefix dropped so the
  // line name alone matches.
  const lines = new Map();
  for (const p of CATALOG) {
    const t = String(p.type || '').trim();
    if (!t || COMMON_LINES.has(t.toLowerCase())) continue;
    const l = t.replace(/^nike\s+/i, '').replace(/([^as])s$/i, '$1').replace(/\s+mid$/i, '');
    if (!lines.has(l.toLowerCase())) lines.set(l.toLowerCase(), l);
  }
  for (const l of lines.values()) add('product', 'product line: ' + l, new RegExp('\\b' + esc(l) + 's?\\b', l === l.toUpperCase() ? '' : 'i'));
  // Every product title in the built catalogue, verbatim.
  const titles = Array.from(new Set(CATALOG.map((p) => String(p.n || '').trim()).filter((t) => t.length >= 10)));
  add('product', 'catalogue product title', new RegExp(titles.map(esc).sort((a, b) => b.length - a.length).join('|'), 'i'));
  // The words its studio and its proof bar use that no catalogue row carries.
  add('product', 'product vocabulary: Samba', /\bSamba\b/);
  add('product', 'product vocabulary: Mumbai studio', /\bMumbai studio\b/i);
  // The people its mailers' proof bar names (scripts/lib/flagship-mailer.js).
  ['Samay Raina', 'Rohit Sharma', 'Shraddha Kapoor'].forEach((n) => add('person', 'proof name: ' + n, new RegExp(esc(n), 'i')));
  return sig;
}
/** The sibling brand the fork came from: tea / wellness, asserted absent for every brand. */
function siblingSignatures() {
  const sig = [];
  const add = (label, rx) => sig.push({ cls: 'sibling', label, src: rx.source, flags: rx.flags.replace('g', '') });
  // The audit's own wrong-industry list, minus words a deli or a newsroom may
  // say about itself (a deli sells espresso; a paper reports on infusions).
  const OWN_USE = new Set(['espresso', 'infusion', 'arabica', 'robusta', 'cold brew', 'french press', 'collagen', 'probiotic', 'gut health', 'steeping']);
  WRONG_INDUSTRY.filter((w) => !OWN_USE.has(w)).forEach((w) => add('sibling: ' + w, new RegExp('\\b' + esc(w) + '\\b', 'i')));
  [['first-flush', /first[- ]flush/i], ['7,000 feet', /7,?000\s*(ft|feet)/i], ['farm direct', /farm[- ]direct/i], ['steaming pair', /steaming (pair|cup)/i],
    ['finest I have ever tasted', /finest .{0,40}ever tasted/i], ['a slower story', /a slower story/i], ['begin the ritual', /begin the ritual/i],
    ['garden-fresh', /garden-fresh/i], ['Target stores', /\btarget stores\b/i], ['airbrush', /\bairbrush/i], ['mushroom-led', /mushroom-led/i],
    ['calm-energy', /calm-energy/i],
    // The sibling's own product lines, which the fork's search-and-replace
    // renamed around but never removed: coffee, tea, supplements, "T&B".
    // Neither brand under sweep sells any of them (asserted below), so on
    // these pages they can only be the sibling's copy.
    ['coffee', /\bcoffees?\b/i], ['tea', /\bteas?\b/i], ['supplements', /\bsupplements?\b/i], ['T&B', /\bT&(?:amp;)?B\b/]].forEach(([l, rx]) => add('sibling: ' + l, rx));
  return sig;
}
const SIGNATURES = zeroSignatures().concat(siblingSignatures());

/** Tenant zero's palette as RENDERED colour: its identity colours and the text-safe variants tokens() derives from them. */
function zeroColours() {
  const t = workspaceCore.tokens(ZERO);
  const hex = new Set([ZERO.palette.primary, ZERO.palette.accent, t['--brand-primary-text'], t['--brand-accent-text'], t['--brand-primary-dark']].filter(Boolean).map((h) => h.toLowerCase()));
  // The neutrals (ink #111111, white surface, grey line) are every brand's; only identity colours sign.
  const rgb = (h) => { const x = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)).join(','); };
  return Array.from(hex).filter((h) => /^#[0-9a-f]{6}$/.test(h)).map((h) => ({ hex: h, rgb: rgb(h) }));
}
const ZERO_COLOURS = zeroColours();

/** Tenant zero's ASSET hosts: its store hosts, its Shopify file path (from the catalogue), the bundled catalogue files, its retired mark. */
function zeroAssetPatterns() {
  const out = new Set();
  for (const p of CATALOG) {
    try { const u = new URL(p.i); out.add((u.host + u.pathname.split('/').slice(0, 5).join('/')).toLowerCase()); } catch (_) { /* not attributable */ }
  }
  for (const h of [].concat(ZERO.asset_hosts || [], [ZERO.website])) {
    try { out.add(new URL(/^https?:/.test(h) ? h : 'https://' + h).hostname.replace(/^www\./, '').toLowerCase()); } catch (_) { /* skip */ }
  }
  out.add('/data/catalog/products_');
  // Tenant zero's mark; only the frozen diff-version snapshot may reference it
  // (tests/platform-identity.spec.js).
  out.add('app.example.test/favicon.png');
  return Array.from(out);
}
const ZERO_ASSETS = zeroAssetPatterns();

/**
 * Defects that ANOTHER change owns, recorded so this gate can land before it
 * and still cover the ground the day it does. A row an entry matches is
 * printed in the inventory (marked ~) and not failed; everything else fails.
 * An entry that matched NOTHING in a full run is printed as stale, to be
 * deleted so the gate holds that ground like any other. (Stale is reported,
 * not failed: two changes landing in sequence must not turn main red because
 * one of them fixed what the other's list still names.)
 */
/** Regions of a page another change owns, by DOM selector (a hit inside one carries `box`). */
const OWNED_BOXES = [
  // The Brand Knowledge Base box on /knowledge-base: its cards, its copy, its button.
  { owner: 'knowledge-docs', sel: 'div:has(> #brandKbGrid)' },
];
const OWNED_ELSEWHERE = [
  // The Markdown viewer that opens tenant zero's static brand documents at
  // about:blank, the routes serving them, and /research's Growth Book narrative.
  { owner: 'knowledge-docs', why: 'a region of a page the knowledge-docs work owns (OWNED_BOXES)', test: (d) => d.box === 'knowledge-docs' },
  { owner: 'knowledge-docs', why: 'the .md viewer (auth.js openPrintable) opens tenant zero\'s static documents at about:blank', test: (d) => /\.md\b/.test(d.via || '') },
  { owner: 'knowledge-docs', why: '/research (the Growth Book: its narrative, the #brand-study block, the regional studies and competitor table) and the growth-book/** pages', test: (d) => d.page === 'research.html' || /^growth-book\//.test(d.page) || /^growth-book\//.test(d.doc || '') },
  // Tenant zero's catalogue photos, prices, product handles and store links
  // rendered for another brand (ad-campaigns.html reading data/catalog
  // directly, storefront-3d.html's store bases).
  { owner: 'catalog-provenance', why: 'tenant zero\'s catalogue imagery and store URLs rendered for another brand', test: (d) => (d.flag === 'c' && !/^offered-document/.test(d.kind || '')) || (d.flag === 'a' && (d.label === 'catalogue product title' || (d.cls === 'host' && /https?:\/\/|\/(products|collections|cdn)\//.test(d.excerpt || '')))) },
  // Every page's colours belong to the brand-theme work (its own gate holds a
  // per-page baseline of tenant zero's exact hexes). This gate MEASURES the
  // colour and reports it there. Entries that matched nothing in a full run
  // (design-system's rail, locale-defaults' legal defaults, /knowledge/**)
  // were deleted: the list only shrinks.
  { owner: 'brand-theme', why: 'tenant zero\'s palette rendered as a page colour', test: (d) => d.cls === 'colour' },
];

/* ══ in-page instrumentation, before any page script ═════════════════════════ */

function instrument(args) {
  var B = window.__BCI = {
    relabels: [], blobs: [], clipboard: [], opened: [], prints: 0, canvas: [], added: [], touchedFrames: [],
    token: Math.random().toString(36).slice(2),
  };
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function pathOf(el) {
    var parts = [];
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 4; e = e.parentElement, i++) {
      parts.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList && e.classList.length ? '.' + Array.prototype.slice.call(e.classList, 0, 2).join('.') : ''));
    }
    return parts.join(' > ');
  }
  B.pathOf = pathOf;

  // (e) The relabel, observed as it happens: brand-context.js writes
  // node.nodeValue on every Text node it renames.
  try {
    var NV = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeValue');
    Object.defineProperty(Node.prototype, 'nodeValue', {
      configurable: true, enumerable: NV.enumerable,
      get: function () { return NV.get.call(this); },
      set: function (v) {
        try {
          if (this.nodeType === 3) {
            var old = NV.get.call(this);
            if (old && /knickgasm/i.test(old) && !/knickgasm/i.test(String(v))) B.relabels.push({ old: String(old).slice(0, 600), now: String(v).slice(0, 600), where: pathOf(this.parentElement), node: this });
          }
        } catch (_) {}
        return NV.set.call(this, v);
      },
    });
  } catch (_) {}

  // Every blob a page makes, read as it is made (the bytes a preview or a
  // download carries), and every window it opens - REAL windows, not stubs.
  var origCreate = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    var url = origCreate.apply(URL, arguments);
    try {
      var rec = { url: url, type: (obj && obj.type) || '', size: (obj && obj.size) || 0, text: null, from: pathOf(document.activeElement) };
      B.blobs.push(rec);
      if (obj && typeof obj.text === 'function' && /^(text\/|application\/(json|xml|xhtml|javascript)|image\/svg)|^$/.test(rec.type) && rec.size < 8e6) obj.text().then(function (t) { rec.text = t; }).catch(function () {});
    } catch (_) {}
    return url;
  };
  var origOpen = window.open;
  window.open = function (u) { try { B.opened.push({ url: String(u == null ? '' : u), from: pathOf(document.activeElement) }); } catch (_) {} return origOpen.apply(window, arguments); };
  window.print = function () { B.prints++; };
  try {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: function (t) { B.clipboard.push(String(t)); return Promise.resolve(); },
      write: function (items) { try { (items || []).forEach(function (it) { (it.types || []).forEach(function (ty) { it.getType(ty).then(function (b) { return b.text(); }).then(function (t) { B.clipboard.push(t); }); }); }); } catch (_) {} return Promise.resolve(); },
      readText: function () { return Promise.resolve(''); },
    } });
  } catch (_) {}
  var origExec = document.execCommand;
  document.execCommand = function (cmd) {
    if (/copy/i.test(cmd)) { try { B.clipboard.push(String(window.getSelection ? window.getSelection() : '')); } catch (_) {} return true; }
    return origExec ? origExec.apply(document, arguments) : false;
  };
  try {
    var P = CanvasRenderingContext2D.prototype;
    ['fillText', 'strokeText'].forEach(function (m) { var o = P[m]; P[m] = function (t) { try { if (B.canvas.length < 4000) B.canvas.push(String(t)); } catch (_) {} return o.apply(this, arguments); }; });
  } catch (_) {}

  // What each press RENDERED: nodes added, and frames whose document changed.
  var obs = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'childList') for (var j = 0; j < m.addedNodes.length; j++) { var a = m.addedNodes[j]; if (a.nodeType === 1 || a.nodeType === 3) B.added.push(a); }
      else if (m.type === 'attributes' && m.target && m.target.tagName === 'IFRAME') B.touchedFrames.push(m.target);
    }
    if (B.added.length > 20000) B.added.splice(0, B.added.length - 20000);
  });
  obs.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['srcdoc', 'src'] });

  // The person: signed in with a mobile number + PIN kept on this device, the
  // brand under sweep active in the per-account device store.
  try {
    var expires = new Date(Date.now() + 80 * 86400000).toISOString();
    var users = {}; users[args.user.phone] = Object.assign({}, args.user, { salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null, createdAt: expires, pinSetAt: expires });
    localStorage.setItem('lifecycle.auth.device.users', JSON.stringify(users));
    localStorage.setItem('lifecycle.auth.session', JSON.stringify({
      token: 'DEVICEtokenFIXTURE0123456789abcdefghijklmnopq', mode: 'device', provider: 'mobile-pin',
      user: { id: args.user.id, name: args.user.name, phone: args.user.phone }, expires: expires,
      storage: { mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' },
    }));
    localStorage.setItem('lifecycle.brand.device.workspaces.' + args.user.id, JSON.stringify({ version: 1, active_id: args.brand.id, workspaces: [args.brand] }));
    localStorage.removeItem('lc-brand-context');
  } catch (_) {}

  // CDN libraries the harness blocks, as no-op stand-ins: a page is measured on
  // its own code, not on a missing third-party global.
  function Noop() {}
  Noop.prototype.update = Noop.prototype.destroy = Noop.prototype.resize = function () {};
  Noop.register = function () {};
  function auto() { return new Proxy({}, { get: function (t, k) { if (typeof k === 'symbol') return undefined; if (!(k in t)) t[k] = auto(); return t[k]; } }); }
  Noop.defaults = auto();
  window.Chart = window.Chart || Noop;
  window.ChartDataLabels = window.ChartDataLabels || {};
  window.Papa = window.Papa || { parse: function (_, o) { if (o && o.complete) o.complete({ data: [], errors: [] }); return { data: [], errors: [] }; }, unparse: function () { return ''; } };
  window.JSZip = window.JSZip || function () { var z = { file: function () { return z; }, folder: function () { return z; }, generateAsync: function () { return Promise.resolve(new Blob([''])); } }; return z; };
  window.marked = window.marked || { parse: function (s) { return String(s || ''); }, setOptions: function () {} };
  window.html2canvas = window.html2canvas || function () { return Promise.resolve(document.createElement('canvas')); };
  window.lucide = window.lucide || { createIcons: function () {} };
  window.supabase = { createClient: function () {
    return {
      auth: { getSession: async function () { return { data: { session: null } }; }, getUser: async function () { return { data: { user: null } }; }, onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }, signInWithOAuth: async function () { return { error: null }; }, signOut: async function () { return {}; }, setSession: async function () { return { data: {}, error: null }; } },
      from: function () { var b = {}; ['select', 'eq', 'order', 'limit', 'insert', 'update', 'upsert', 'delete', 'in', 'neq', 'gte', 'lte', 'range', 'ilike', 'is', 'or'].forEach(function (k) { b[k] = function () { return b; }; }); b.maybeSingle = async function () { return { data: null, error: null }; }; b.single = async function () { return { data: null, error: { message: 'no rows' } }; }; b.then = function (r) { return Promise.resolve({ data: [], error: null }).then(r); }; return b; },
      channel: function () { var c = { on: function () { return c; }, subscribe: function () { return c; }, unsubscribe: function () {} }; return c; },
      removeChannel: function () {}, storage: { from: function () { return { upload: async function () { return { error: { message: 'offline' } }; }, getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } },
    };
  } };

  // The controls: the signed-out sweep's selector and de-duplication.
  var IGN = '#lc-authnotice, .lc-credit-pill, .lc-credit-chip, .lc-credit-sheet, #vah-agent-fab, #vah-agent-panel, .vhd-agent-fab, .vhd-agent-overlay, #lnav-signin-note, #lc-popup-blocked, #lifecycle-nav';
  var SEL = 'button, [role="button"], [role="tab"], input[type="button"], input[type="submit"], select, summary, a, [onclick], [data-tab], [data-region-set], [data-market], [data-mkt], .step-pip, .tab[tabindex], .chip[tabindex]';
  function vis(el) {
    if (!el || !el.isConnected) return false;
    try { if (el.closest('[hidden]')) return false; } catch (_) { return false; }
    var r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
    var d = el.closest('details');
    if (d && !d.open && !(el.matches('summary') && el.parentElement === d)) return false;
    return true;
  }
  B.enumerate = function (zeroSlug) {
    var out = [], seen = {}, n = 0;
    var all = document.querySelectorAll(SEL);
    for (var k = 0; k < all.length; k++) {
      var el = all[k];
      if (el.closest(IGN)) continue;
      if (el.matches('#lnav-signin, [data-sw-skip], input[type="file"]')) continue;
      // Choosing tenant zero's own template card loads tenant zero's record into
      // the form: that is the operator choosing that content, not a leak.
      var pre = el.closest('[data-preset]');
      if (pre && String(pre.getAttribute('data-preset')).toLowerCase() === zeroSlug) continue;
      var t = norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.title || '').slice(0, 60);
      if (/^(sign out|log out|logout|dismiss|delete|remove|reset)\b/i.test(t)) continue;
      var oc = el.getAttribute('onclick') || '';
      if (/signOut|location\.reload/.test(oc)) continue;
      if (!vis(el)) continue;
      if (!el.matches('button, select, a, input, summary') && el.querySelector(SEL)) continue;
      var tag = el.tagName.toLowerCase();
      var href = tag === 'a' ? (el.getAttribute('href') || '') : '';
      var kind = 'click';
      if (tag === 'a') {
        if (/^(https?:)?\/\//i.test(href) || /^mailto:|^tel:/i.test(href)) kind = 'external';
        // A link to a document the shell intercepts (.md) is pressed: what it
        // opens is the thing under test. Any other real link is resolved, not followed.
        else if (href && !/^#|^javascript:/i.test(href) && !oc && el.getAttribute('role') !== 'button' && !/\.md(?:[?#]|$)/i.test(href)) kind = 'link';
        else if (!href && !oc && !el.getAttribute('role') && !el.hasAttribute('data-tab')) continue;
      }
      if (tag === 'select') kind = el.options.length > 1 ? 'select' : 'inert';
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') kind = 'disabled';
      var cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).sort().join('.') : '';
      var sig = [tag, t.toLowerCase(), cls, oc.slice(0, 80), href.slice(0, 60), el.getAttribute('data-tab') || '', el.getAttribute('data-region-set') || '', el.getAttribute('data-market') || '', el.id ? '#' : '', kind].join('|');
      if (seen[sig]) continue;
      var i = n++;
      el.setAttribute('data-bci', String(i));
      seen[sig] = 1;
      out.push({ i: i, sig: sig, tag: tag, text: t, id: el.id || '', kind: kind, href: href, where: pathOf(el) });
    }
    return out;
  };
  B.snap = function () { B.added = []; B.touchedFrames = []; B.base = { blobs: B.blobs.length, clipboard: B.clipboard.length, opened: B.opened.length, prints: B.prints, canvas: B.canvas.length }; };
}

/* ══ the collector: one function for a page, a frame, a popup or a document ═══ */

/**
 * Reads a document (or the subtrees `roots` names) and returns HITS only:
 * signature matches in every text node, block, attribute, title, meta tag and
 * form value; tenant zero's identity colours in computed styles (pseudo
 * elements included); asset URLs; links. Recurses into same-origin frames and
 * srcdoc documents. Self-contained: it runs in popups that carry no
 * instrumentation.
 */
function COLLECT(args) {
  var rootsKey = args.roots || '';
  var sigs = args.sigs.map(function (s) { return { cls: s.cls, label: s.label, rx: new RegExp(s.src, s.flags) }; });
  var anyI = new RegExp(args.sigs.filter(function (s) { return s.flags.indexOf('i') >= 0; }).map(function (s) { return '(?:' + s.src + ')'; }).join('|'), 'i');
  var anyS = new RegExp(args.sigs.filter(function (s) { return s.flags.indexOf('i') < 0; }).map(function (s) { return '(?:' + s.src + ')'; }).join('|') || '(?!)');
  var zeroRgb = {}; args.colours.forEach(function (c) { zeroRgb[c.rgb] = c.hex; });
  var out = { text: [], colours: [], assets: [], links: [], frames: 0, nodes: 0, elements: 0, chars: 0 };
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1 };
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function pathOf(el) {
    var parts = [];
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 4; e = e.parentElement, i++) parts.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList && e.classList.length ? '.' + Array.prototype.slice.call(e.classList, 0, 2).join('.') : ''));
    return parts.join(' > ');
  }
  function sectionOf(el) {
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 12; e = e.parentElement, i++) {
      var h = e.querySelector && e.querySelector('h1,h2,h3,[class*="title"]');
      if (h && h !== el) return norm(h.textContent).slice(0, 80);
    }
    return '';
  }
  // Content explicitly attributed to its OWN brand (a preset card in the
  // gallery says whose template it is) is exempt; nothing else is.
  function attributed(el) {
    try { var p = el && el.closest && el.closest('[data-preset]'); return p ? String(p.getAttribute('data-preset')).toLowerCase() : ''; } catch (_) { return ''; }
  }
  // A region of a page that another change owns (args.boxes: owner + selector).
  function boxOf(el) {
    var bs = args.boxes || [];
    for (var i = 0; i < bs.length; i++) { try { if (el && el.closest && el.closest(bs[i].sel)) return bs[i].owner; } catch (_) {} }
    return '';
  }
  function visible(el) {
    try { return !!(el && el.checkVisibility && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); } catch (_) { return false; }
  }
  var seenHit = {};
  function scanText(s, el, kind, frame) {
    var t = String(s || '');
    if (!t.trim()) return;
    out.chars += t.length;
    if (!anyI.test(t) && !anyS.test(t)) return;
    for (var i = 0; i < sigs.length; i++) {
      var m = t.match(sigs[i].rx);
      if (!m) continue;
      var owner = attributed(el);
      var key = sigs[i].label + '|' + (el ? pathOf(el) : kind) + '|' + kind;
      if (seenHit[key]) continue;
      seenHit[key] = 1;
      var at = m.index;
      out.text.push({ cls: sigs[i].cls, label: sigs[i].label, match: m[0], kind: kind, frame: frame, where: el ? pathOf(el) : '', section: el ? sectionOf(el) : '', visible: el ? visible(el) : false, owner: owner, box: boxOf(el),
        excerpt: t.slice(Math.max(0, at - 90), at + m[0].length + 90).replace(/\s+/g, ' ').trim() });
    }
  }
  function rgbs(v) { var r = [], re = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/g, m; while ((m = re.exec(v || ''))) { if (m[4] !== undefined && +m[4] === 0) continue; r.push(m[1] + ',' + m[2] + ',' + m[3]); } return r; }
  function colourCheck(el, cs, pseudo, frame) {
    var props = ['background-color', 'background-image', 'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color', 'outline-color', 'box-shadow', 'fill', 'stroke', 'text-decoration-color', 'color'];
    for (var i = 0; i < props.length; i++) {
      var p = props[i], v = cs.getPropertyValue(p);
      if (!v || v === 'none') continue;
      if (/^border-(\w+)-color$/.test(p)) { var side = p.split('-')[1]; if (cs.getPropertyValue('border-' + side + '-style') === 'none' || parseFloat(cs.getPropertyValue('border-' + side + '-width')) === 0) continue; }
      if (p === 'outline-color' && (cs.getPropertyValue('outline-style') === 'none' || parseFloat(cs.getPropertyValue('outline-width')) === 0)) continue;
      if (p === 'text-decoration-color' && cs.getPropertyValue('text-decoration-line') === 'none') continue;
      if ((p === 'fill' || p === 'stroke') && !(el instanceof SVGElement)) continue;
      if (p === 'color' && !pseudo) {
        // Colour paints text: only where this element has its own text.
        var own = false;
        for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.nodeValue.trim()) { own = true; break; }
        if (!own) continue;
      }
      if (p === 'color' && pseudo && (cs.getPropertyValue('content') === 'none' || cs.getPropertyValue('content') === 'normal' || cs.getPropertyValue('content') === '""')) continue;
      var list = rgbs(v);
      for (var k = 0; k < list.length; k++) {
        if (!zeroRgb[list[k]]) continue;
        out.colours.push({ hex: zeroRgb[list[k]], prop: (pseudo || '') + p, where: pathOf(el), frame: frame, text: norm(el.textContent).slice(0, 60), owner: attributed(el), box: boxOf(el) });
        break;
      }
    }
  }
  function assetCheck(url, kind, el, frame) {
    if (!url) return;
    var u = String(url);
    if (/^data:/i.test(u)) return;
    var abs = u;
    try { abs = new URL(u, el && el.ownerDocument ? el.ownerDocument.baseURI : location.href).href; } catch (_) {}
    out.assets.push({ url: abs.slice(0, 400), kind: kind, where: el ? pathOf(el) : kind, frame: frame, owner: attributed(el), box: boxOf(el) });
  }
  function urlsIn(v) { var r = [], re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g, m; while ((m = re.exec(v || ''))) r.push(m[2]); return r; }

  function walkDoc(doc, frame, roots) {
    if (!doc) return;
    out.frames++;
    if (!roots) {
      scanText(doc.title, doc.documentElement, 'title', frame);
      doc.querySelectorAll('meta[content]').forEach(function (m) {
        var n = (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase();
        if (/^(description|og:|twitter:|application-name|apple-mobile-web-app-title|keywords|author)/.test(n)) {
          if (/image/.test(n)) assetCheck(m.getAttribute('content'), 'meta:' + n, m, frame);
          else scanText(m.getAttribute('content'), m, 'meta:' + n, frame);
        }
      });
      doc.querySelectorAll('link[href]').forEach(function (l) { if (/icon|apple-touch|manifest|preload|prefetch|image_src/i.test(l.getAttribute('rel') || '')) assetCheck(l.getAttribute('href'), 'link:' + l.getAttribute('rel'), l, frame); });
    }
    var list = roots || [doc.body || doc.documentElement];
    list.forEach(function (root) {
      if (!root || (root.nodeType !== 1 && root.nodeType !== 3)) return;
      if (root.nodeType === 3) { var pe = root.parentElement; if (pe && !SKIP[pe.nodeName]) scanText(root.nodeValue, pe, 'text', frame); return; }
      if (!root.isConnected && roots) return;
      var w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return (n.parentNode && SKIP[n.parentNode.nodeName]) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
      var n;
      while ((n = w.nextNode())) { out.nodes++; scanText(n.nodeValue, n.parentElement, 'text', frame); }
      var els = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
      for (var i = 0; i < els.length && i < 12000; i++) {
        var el = els[i];
        if (SKIP[el.nodeName]) continue;
        out.elements++;
        // Blocks too: a signature split across inline elements ("Air <b>Force</b> 1").
        if (/^(P|LI|H[1-6]|TD|TH|DD|DT|FIGCAPTION|BLOCKQUOTE|LABEL|BUTTON|A|SUMMARY|CAPTION|OPTION)$/.test(el.nodeName) && el.childElementCount && el.textContent.length < 3000) scanText(el.textContent, el, 'block', frame);
        ['alt', 'title', 'placeholder', 'aria-label', 'data-tip', 'data-tooltip'].forEach(function (a) { if (el.hasAttribute(a)) scanText(el.getAttribute(a), el, 'attr:' + a, frame); });
        if ((el.nodeName === 'TEXTAREA' || el.nodeName === 'INPUT') && el.type !== 'hidden' && el.type !== 'password') scanText(el.value, el, 'value', frame);
        if (el.nodeName === 'IMG') { assetCheck(el.currentSrc || el.getAttribute('src'), 'img', el, frame); }
        if (el.hasAttribute('srcset')) el.getAttribute('srcset').split(',').forEach(function (s) { assetCheck(s.trim().split(/\s+/)[0], 'srcset', el, frame); });
        if (/^(VIDEO|AUDIO|SOURCE|EMBED|TRACK)$/.test(el.nodeName) && el.getAttribute('src')) assetCheck(el.getAttribute('src'), el.nodeName.toLowerCase(), el, frame);
        if (el.nodeName === 'VIDEO' && el.getAttribute('poster')) assetCheck(el.getAttribute('poster'), 'poster', el, frame);
        if (el.nodeName === 'OBJECT' && el.getAttribute('data')) assetCheck(el.getAttribute('data'), 'object', el, frame);
        if (el.nodeName === 'IMAGE' && (el.getAttribute('href') || el.getAttribute('xlink:href'))) assetCheck(el.getAttribute('href') || el.getAttribute('xlink:href'), 'svg-image', el, frame);
        if ((el.nodeName === 'A' || el.nodeName === 'AREA') && el.getAttribute('href')) {
          var h = el.getAttribute('href');
          if (!/^(#|javascript:)/i.test(h)) {
            var abs = h; try { abs = new URL(h, doc.baseURI).href; } catch (_) {}
            out.links.push({ href: abs.slice(0, 400), raw: h.slice(0, 300), text: norm(el.textContent).slice(0, 80), where: pathOf(el), frame: frame, visible: visible(el), owner: attributed(el), section: sectionOf(el), box: boxOf(el), withdrawn: !!el.closest('[hidden],[data-shipped-gated]') });
            scanText(h, el, 'href', frame);
          }
        }
        if (el.nodeName === 'FORM' && el.getAttribute('action')) scanText(el.getAttribute('action'), el, 'form-action', frame);
        var view = doc.defaultView;
        if (view && el.isConnected && !args.textOnly) {
          var cs = view.getComputedStyle(el);
          if (cs.display !== 'none') {
            urlsIn(cs.getPropertyValue('background-image')).forEach(function (u) { assetCheck(u, 'css-background', el, frame); });
            if (cs.visibility !== 'hidden' && visible(el)) {
              colourCheck(el, cs, '', frame);
              ['::before', '::after'].forEach(function (ps) {
                var pcs = view.getComputedStyle(el, ps);
                var content = pcs.getPropertyValue('content');
                if (!content || content === 'none' || content === 'normal') return;
                if (content !== '""' && content !== "''") scanText(content.replace(/^["']|["']$/g, ''), el, 'css-content' + ps, frame);
                urlsIn(pcs.getPropertyValue('background-image')).forEach(function (u) { assetCheck(u, 'css-background' + ps, el, frame); });
                colourCheck(el, pcs, ps, frame);
              });
            }
          }
        }
        if (el.nodeName === 'IFRAME') {
          var d = null;
          try { d = el.contentDocument; } catch (_) { d = null; }
          var sub = frame + ' > iframe' + (el.id ? '#' + el.id : '');
          if (d && d.documentElement && (d.body && d.body.childNodes.length)) walkDoc(d, sub, null);
          else if (el.hasAttribute('srcdoc')) { try { walkDoc(new DOMParser().parseFromString(el.getAttribute('srcdoc'), 'text/html'), sub + '[srcdoc]', null); } catch (_) {} }
          if (el.getAttribute('src')) assetCheck(el.getAttribute('src'), 'iframe', el, frame);
        }
      }
    });
  }
  var roots = null;
  if (rootsKey === 'added' && window.__BCI) {
    var seenR = new Set();
    roots = [];
    window.__BCI.added.forEach(function (n) {
      if (!n.isConnected) return;
      for (var p = n.parentNode; p; p = p.parentNode) if (seenR.has(p)) return;
      seenR.add(n); roots.push(n);
    });
    window.__BCI.touchedFrames.forEach(function (f) { if (f.isConnected && !seenR.has(f)) { seenR.add(f); roots.push(f); } });
  }
  if (args.rootSel) roots = Array.prototype.slice.call(document.querySelectorAll(args.rootSel));
  walkDoc(document, args.frame || 'page', roots);
  if (window.__BCI && rootsKey !== 'added') {
    // Every relabel brand-context.js made on this page (or inside the roots
    // asked for), with the node's CURRENT state (a re-render may replace it).
    out.relabels = window.__BCI.relabels.filter(function (r) { return !roots || roots.some(function (x) { return r.node && x.contains(r.node); }); }).map(function (r) { return { old: r.old, now: r.now, where: r.where, connected: !!(r.node && r.node.isConnected), visible: !!(r.node && r.node.parentElement && visible(r.node.parentElement)), section: r.node && r.node.parentElement ? sectionOf(r.node.parentElement) : '', box: r.node && r.node.parentElement ? boxOf(r.node.parentElement) : null }; });
  }
  return out;
}

/* ══ checks in Node ════════════════════════════════════════════════════════ */

const ZERO_ASSET_RX = new RegExp(ZERO_ASSETS.map(esc).join('|'), 'i');
const SIG_RX = SIGNATURES.map((s) => Object.assign({}, s, { rx: new RegExp(s.src, s.flags) }));
function scanPlain(text) {
  const hits = [];
  const t = String(text || '');
  for (const s of SIG_RX) {
    const m = t.match(s.rx);
    if (m) hits.push({ cls: s.cls, label: s.label, match: m[0], excerpt: t.slice(Math.max(0, m.index - 90), m.index + m[0].length + 90).replace(/\s+/g, ' ').trim() });
  }
  return hits;
}
/** A document's readable text: markup removed, entities left (a signature is ASCII). */
function textOfMarkup(html) {
  return String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'");
}
function urlsOfText(text) { return (String(text || '').match(/https?:\/\/[^\s"'<>)]+/g) || []); }

/* ── where a hit comes from: file:line ──────────────────────────────────────── */
const SOURCE_CACHE = new Map();
function sourceOf(rel) { if (!SOURCE_CACHE.has(rel)) { let s = ''; try { s = read(rel); } catch (_) { s = ''; } SOURCE_CACHE.set(rel, s); } return SOURCE_CACHE.get(rel); }
function scriptsOf(pageRel) {
  const src = sourceOf(pageRel);
  const out = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi; let m;
  while ((m = re.exec(src))) { const s = m[1].split('?')[0]; if (/^https?:/i.test(s)) continue; const rel = s.startsWith('/') ? s.slice(1) : path.posix.join(path.posix.dirname(pageRel), s); if (exists(rel)) out.push(rel); }
  return out;
}
const SHARED_SOURCES = ['auth.js', 'brand-context.js', 'theme.css', 'region-context.js', 'credits.js', 'copilot.js', 'agent-widget.js', 'brand-demo.js', 'brand-catalog.js', 'brand-document.js', 'data-analysis-extensions.js', 'analysis-registry.js', 'motion.js'];
/** A tenant-zero hex used as a LITERAL (not a var() fallback), preferring the line that names the element's class. */
function locateHex(hex, where, pageRel) {
  const files = Array.from(new Set([pageRel].concat(scriptsOf(pageRel), SHARED_SOURCES)));
  const last = String(where || '').split(' > ').pop() || '';
  const hints = (last.match(/[.#][\w-]+/g) || []).map((x) => x.slice(1)).filter((x) => x.length > 2);
  const rx = new RegExp('(?<!var\\(--[\\w-]+,\\s?)' + hex.replace('#', '#'), 'i');
  let fallback = '';
  for (const f of files) {
    const lines = sourceOf(f).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!rx.test(lines[i])) continue;
      if (hints.some((h) => lines[i].includes(h))) return f + ':' + (i + 1);
      if (!fallback) fallback = f + ':' + (i + 1);
    }
  }
  return fallback;
}
/** The first file:line whose text contains a distinctive piece of `excerpt` (tenant zero's name restored where it was swapped). */
function locate(excerpt, match, pageRel, brandName) {
  const candidates = [];
  const raw = String(excerpt || '');
  const restored = brandName ? raw.split(brandName).join(ZERO.name) : raw;
  for (const t of [restored, raw]) {
    const at = t.indexOf(match);
    const pieces = [];
    if (at >= 0) { pieces.push(t.slice(Math.max(0, at - 30), at + match.length + 30)); pieces.push(t.slice(Math.max(0, at - 12), at + match.length + 12)); }
    pieces.push(match);
    for (const p of pieces) { const q = p.trim(); if (q.length >= 6 && !candidates.includes(q)) candidates.push(q); }
  }
  const files = Array.from(new Set([pageRel].concat(scriptsOf(pageRel), SHARED_SOURCES)));
  for (const q of candidates) {
    for (const f of files) {
      const s = sourceOf(f);
      const i = s.indexOf(q);
      if (i >= 0) return f + ':' + (s.slice(0, i).split('\n').length);
    }
  }
  return '';
}

/* ══ the harness ═══════════════════════════════════════════════════════════ */

let REAL = null, REAL_WORLD = null;
const GENERIC_OK = { ok: true, mode: 'device', unmetered: true, reply: 'Local demo reply.', answer: 'Local demo reply.', brand: null, workspaces: [], emails: [], brands: [], items: [], rows: [], runs: [], jobs: [], entries: [], campaigns: [], library: [], plan: [], data: [], results: [], list: [], presets: [], features: [], packs: [], providers: [], credits: { charged: 0 } };
const AUTH_STATUS = { ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' };
const API_REWRITE = {};
for (const r of REWRITES) if (/^\/api\//.test(r.source) && !/:/.test(r.source)) API_REWRITE[r.source] = r.destination;

/** The page-level half: listeners and the instrumentation. Run again for a replacement page. */
async function installPage(page, brand, log) {
  page.on('dialog', (d) => { log.dialogs.push(d.message().slice(0, 160)); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e).slice(0, 200)));
  page.on('download', (d) => log.downloads.push(d));
  // Every window this page opens, as a real window.
  page.on('popup', (p) => log.popups.push({ page: p, opener: page.url() }));
  page.on('request', (r) => { if (r.url().includes('/api/')) log.inflight++; });
  page.on('requestfinished', (r) => { if (r.url().includes('/api/')) log.inflight = Math.max(0, log.inflight - 1); });
  page.on('requestfailed', (r) => { if (r.url().includes('/api/')) log.inflight = Math.max(0, log.inflight - 1); });
  await page.addInitScript(instrument, { brand, user: USER });
}
async function install(context, page, brand, log) {
  await installPage(page, brand, log);
  // Everything off-host is answered or refused here, for the page AND its popups.
  await context.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const type = route.request().resourceType();
    if (type === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    if (type !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm
      ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
      : 'window.tailwind=window.tailwind||{};' });
  });
  await context.route(HOST + '/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/lp/')) {
      const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
      let pathname = u.pathname;
      const params = new URLSearchParams(u.search);
      if (API_REWRITE[pathname]) { const d = new URL(API_REWRITE[pathname], HOST); pathname = d.pathname; d.searchParams.forEach((v, k) => { if (!params.has(k)) params.set(k, v); }); }
      if (/^\/lp\/[^/]+$/.test(pathname) && !resolveRoute(pathname).file) { params.set('action', 'lp'); params.set('id', pathname.split('/')[2]); pathname = '/api/calendar'; }
      const action = params.get('action') || '';
      if (pathname === '/api/public-config' && !action && !params.get('health')) return json({ supabase: { url: 'https://live.supabase.co', anonKey: 'anon' } });
      if (pathname === '/api/public-config' && action === 'auth') return params.get('op') === 'status' ? json(AUTH_STATUS) : json({ ok: false, error: 'no_database', mode: 'device' }, 503);
      if (REAL && Object.prototype.hasOwnProperty.call(A.ROUTERS, pathname)) {
        const target = HOST + pathname + '?' + params.toString();
        return REAL({ request: () => ({ url: () => target, method: () => route.request().method(), headers: () => route.request().headers(), postDataBuffer: () => route.request().postDataBuffer() }), fulfill: (o) => route.fulfill(o) });
      }
      return json(GENERIC_OK);
    }
    const r = resolveRoute(u.pathname);
    if (r.kind !== 'file') return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found on this deployment' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(r.file)] || 'application/octet-stream', body: fs.readFileSync(path.join(ROOT, r.file)) });
  });
}

/**
 * page.evaluate with a deadline. A press can wedge a page's main thread (a
 * render loop, a runaway observer); an evaluate against a wedged page never
 * returns, and one hung page used to hold a whole shard until the test timed
 * out. A page that misses the deadline is marked wedged, reported as a harness
 * row, and replaced.
 */
function race(promise, ms, what) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('WEDGED: ' + (what || 'the page') + ' did not answer within ' + ms + ' ms')), ms); })]).finally(() => clearTimeout(t));
}
function ev(page, fn, arg, ms) {
  if (page.__bciWedged) return Promise.reject(new Error(page.__bciWedged));
  return race(page.evaluate(fn, arg), ms || 25_000, 'the page').catch((e) => { if (/^WEDGED/.test(e.message)) page.__bciWedged = e.message; throw e; });
}

async function load(page, rel, brand) {
  await page.goto(HOST + '/' + rel, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending', null, { timeout: 12_000 }).catch(() => {});
  await ev(page, () => Promise.race([(window.BrandContext && window.BrandContext.ready) ? window.BrandContext.ready() : null, new Promise((r) => setTimeout(r, 10_000))])).catch(() => {});
  await page.waitForFunction((slug) => !window.BrandContext || (window.BrandContext.brand && String(window.BrandContext.brand.slug || '').toLowerCase() === slug), brand.slug, { timeout: 6_000 }).catch(() => {});
  await page.waitForTimeout(900);
  return ev(page, () => ({ layer: !!window.BrandContext, slug: window.BrandContext && window.BrandContext.brand ? String(window.BrandContext.brand.slug || '') : '', shell: !!window.LifecycleAuth }));
}

function collectArgs(frame, extra) { return Object.assign({ sigs: SIGNATURES.map((s) => ({ cls: s.cls, label: s.label, src: s.src, flags: s.flags })), colours: ZERO_COLOURS, frame, boxes: OWNED_BOXES }, extra || {}); }

/** Turn one COLLECT result into defect rows. */
function defectsFrom(res, ctx, push) {
  for (const h of res.text) {
    if (h.owner) continue;   // a preset card in the gallery says whose template it is
    // Text nobody can see does not count - a guard that hides a block for this
    // brand has done its job - EXCEPT the document's title and meta tags, which
    // the tab and a share card show. Hidden panels a control reveals are read
    // again after every press, when they are visible.
    if (!h.visible && !/^(title|meta:)/.test(h.kind) && !ctx.anyVisibility) continue;
    push({ flag: 'a', kind: h.kind, where: h.where, section: h.section, excerpt: h.excerpt, label: h.label, match: h.match, frame: h.frame, visible: h.visible, cls: h.cls, box: h.box });
  }
  const seenC = new Set();
  for (const c of res.colours) {
    if (c.owner) continue;
    const k = c.hex + '|' + c.prop + '|' + c.where;
    if (seenC.has(k)) continue; seenC.add(k);
    push({ flag: 'a', kind: 'colour:' + c.prop, where: c.where, excerpt: c.hex + (c.text ? ' on "' + c.text + '"' : ''), label: 'palette colour ' + c.hex, match: c.hex, frame: c.frame, cls: 'colour', box: c.box });
  }
  for (const a of res.assets) {
    if (a.owner) continue;
    if (ZERO_ASSET_RX.test(a.url)) push({ flag: 'c', kind: 'asset:' + a.kind, where: a.where, excerpt: a.url, label: 'tenant zero asset', match: (a.url.match(ZERO_ASSET_RX) || [''])[0], frame: a.frame, box: a.box });
  }
  for (const l of res.links) {
    if (l.owner) continue;
    // A link the page has withdrawn ([hidden], a gated block) is not offered.
    if (l.withdrawn) continue;
    let u; try { u = new URL(l.href); } catch (_) { continue; }
    if (/^mailto:|^tel:/i.test(l.href)) { if (ZERO_ASSET_RX.test(l.href)) push({ flag: 'c', kind: 'link', where: l.where, excerpt: l.href, label: 'tenant zero address', match: l.href, frame: l.frame }); continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (u.origin !== HOST) {
      if (ZERO_ASSET_RX.test(u.host + u.pathname)) push({ flag: 'c', kind: 'link', where: l.where, excerpt: l.href + ' "' + l.text + '"', label: 'link to tenant zero\'s host', match: u.host, frame: l.frame });
      continue;
    }
    if (u.pathname === '/' + ctx.page && ctx.frameIsPage) continue;
    const r = resolveRoute(u.pathname);
    if (r.kind === 'dead') { push({ flag: 'd', kind: 'link', where: l.where, excerpt: l.raw + ' "' + l.text + '" - ' + r.why, label: 'dead link', match: u.pathname, frame: l.frame, visible: l.visible, box: l.box }); continue; }
    if (r.kind === 'file' && !PAGE_SET.has(r.file) && /\.(html?|md|txt)$/i.test(r.file)) ctx.offered.push({ file: r.file, link: l });
  }
  for (const r of (res.relabels || [])) {
    const words = r.old.split(/\s+/).filter(Boolean).length;
    if (words < 7 || r.old.length < 45) continue;   // chrome ("KNICKGASM Mailer Studio") is renamed on purpose
    // A renamed node the page has since replaced (a block re-rendered from the
    // active brand's record a moment after load) is not what the person reads.
    if (!r.connected) continue;
    push({ flag: 'e', kind: 'name-swapped', where: r.where, section: r.section, excerpt: r.now, label: 'tenant zero prose with the name swapped', match: r.old.slice(0, 60), original: r.old, visible: r.visible, connected: r.connected, box: r.box });
  }
}

/** The document a link offers, read one hop deep (static: no script runs in a .md or a shell-less page). */
const OFFER_CACHE = new Map();
function offeredDoc(file) {
  if (!OFFER_CACHE.has(file)) {
    const raw = sourceOf(file);
    const text = /\.html?$/i.test(file) ? textOfMarkup(raw) : raw;
    const assets = (raw.match(/(?:src|href|poster)=["']([^"']+)["']/gi) || []).map((x) => x.replace(/^[a-z]+=["']|["']$/gi, '')).concat(urlsOfText(raw)).filter((x) => ZERO_ASSET_RX.test(x));
    OFFER_CACHE.set(file, { hits: scanPlain(text), assets: Array.from(new Set(assets)).slice(0, 5) });
  }
  return OFFER_CACHE.get(file);
}

async function readPopup(p) {
  let url = '';
  try { await p.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {}); await p.waitForTimeout(500); url = p.url(); } catch (_) { url = (() => { try { return p.url(); } catch (__) { return ''; } })(); }
  let res = null;
  try { res = await race(p.evaluate(COLLECT, collectArgs('popup')), 20_000, 'a popup'); } catch (_) { res = null; }
  let html = '';
  try { html = (await race(p.content(), 10_000, 'a popup')).slice(0, 400); } catch (_) { html = ''; }
  try { await race(p.close({ runBeforeUnload: false }), 10_000, 'a popup'); } catch (_) {}
  return { url, res, html };
}

async function readDownload(d) {
  const name = d.suggestedFilename();
  let text = null;
  try {
    const f = await d.path();
    if (f && /\.(html?|md|txt|csv|json|svg|xml|ics|eml|js|css|tsv)$/i.test(name)) text = fs.readFileSync(f, 'utf8');
  } catch (_) { text = null; }
  return { name, url: d.url(), text };
}

/** One page under one brand: load, read, press every control, read what each produced. */
async function sweepPage(page, context, rel, brand, log, report) {
  const rows = [];
  const ctx = { page: rel, offered: [], frameIsPage: true };
  // The rail is the same element on every page: a hit inside it is the
  // rail's, reported once under "(rail)" rather than once per page.
  const push = (row) => rows.push(Object.assign({ page: /\blnav-|#lifecycle-nav/.test(row.where || '') && row.frame !== 'popup' ? '(rail)' : rel, brand: brand.slug, via: '' }, row));
  log.dialogs.length = 0; log.errors.length = 0; log.downloads.length = 0; log.popups.length = 0; log.inflight = 0;

  const settled = await load(page, rel, brand);
  // A page that settled on ANOTHER brand was measured under the wrong one. A
  // page whose brand layer painted no brand at all (the legal pages, which
  // render before a brand exists) is still read: what it shows is what the
  // visitor sees.
  if (settled.layer && settled.slug && settled.slug.toLowerCase() !== brand.slug) push({ flag: 'harness', kind: 'fixture', where: '', label: 'wrong brand', excerpt: `the page settled on brand "${settled.slug}", not "${brand.slug}"` });
  if (process.env.BCI_DEBUG) console.log('   · state', rel, JSON.stringify(await ev(page, () => ({ style: document.documentElement.style.cssText.slice(0, 600), accent: getComputedStyle(document.documentElement).getPropertyValue('--brand-accent'), brand: window.BrandContext && window.BrandContext.brand && { slug: window.BrandContext.brand.slug, palette: window.BrandContext.brand.palette, tokens: !!window.BrandContext.brand.tokens } }))));
  const first = await ev(page, COLLECT, collectArgs('page'));
  report.chars += first.chars; report.nodes += first.nodes; report.elements += first.elements;
  defectsFrom(first, ctx, push);

  const controls = await ev(page, (z) => window.__BCI.enumerate(z), ZERO_SLUG);
  report.controls += controls.filter((c) => ['click', 'select'].includes(c.kind)).length;
  for (let idx = 0; idx < controls.length; idx++) {
    const ctl = controls[idx];
    if (!['click', 'select'].includes(ctl.kind)) continue;
    const loc = page.locator(`[data-bci="${ctl.i}"]`).first();
    if (!(await race(loc.count(), 8000, 'a control').catch(() => 0))) { if (page.__bciWedged) throw new Error(page.__bciWedged); continue; }
    await ev(page, () => window.__BCI.snap()).catch(() => {});
    const before = { downloads: log.downloads.length, popups: log.popups.length };
    const urlBefore = page.url();
    const label = `${ctl.tag}${ctl.id ? '#' + ctl.id : ''} "${ctl.text || ''}"${ctl.href ? ' ' + ctl.href : ''}`;
    try {
      if (ctl.kind === 'select') {
        await race(loc.evaluate((el) => { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }), 8000, 'a select');
      } else {
        await loc.scrollIntoViewIfNeeded({ timeout: 800 }).catch(() => {});
        try { await loc.click({ timeout: 900, noWaitAfter: true }); }
        catch (e) { await race(loc.evaluate((el) => el.click()), 8000, 'a dispatched click').catch(() => {}); }
      }
    } catch (_) { continue; }
    report.pressed++;
    // Let the handler run: a beat for a synchronous one, and for one that asked
    // the server, until its requests settle (capped).
    const t0 = Date.now();
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(150);
      if (log.inflight > 0 && Date.now() - t0 < 3500) continue;
      if (Date.now() - t0 >= 400) break;
    }
    if (page.__bciWedged) throw new Error(page.__bciWedged);
    // What the press produced.
    const navigated = (() => { try { return new URL(page.url()).pathname !== new URL(urlBefore).pathname || !page.url().startsWith(HOST); } catch (_) { return true; } })();
    if (navigated) {
      const now = page.url();
      if (/^(about:|blob:|data:)/i.test(now)) push({ flag: 'b', kind: 'navigated', where: ctl.where, excerpt: now.slice(0, 120), label: 'the page itself was replaced by a document with no URL', via: label });
    } else {
      const artefacts = await ev(page, (b) => {
        const B = window.__BCI;
        return { blobs: B.blobs.slice(b.blobs).map((x) => ({ url: x.url, type: x.type, text: x.text, from: x.from })), clipboard: B.clipboard.slice(b.clipboard), opened: B.opened.slice(b.opened), canvas: B.canvas.slice(b.canvas) };
      }, await ev(page, () => window.__BCI.base)).catch(() => ({ blobs: [], clipboard: [], opened: [], canvas: [] }));
      const added = await ev(page, COLLECT, Object.assign(collectArgs('page'), { roots: 'added' })).catch(() => null);
      if (added) defectsFrom(added, ctx, (r) => push(Object.assign(r, { via: label })));
      // What the press REVEALED without adding a node (a tab panel shown, a
      // section expanded): the whole page's visible text, read again.
      const shown = await ev(page, COLLECT, collectArgs('page', { textOnly: true })).catch(() => null);
      if (shown) {
        const known = new Set(rows.map((x) => [x.flag, x.label, x.where, x.kind].join('|')));
        defectsFrom(shown, ctx, (r) => { if (r.flag === 'a' && !known.has([r.flag, r.label, r.where, r.kind].join('|'))) push(Object.assign(r, { via: label })); });
      }
      for (const b of artefacts.blobs) {
        report.blobs++;
        if (b.text) for (const h of scanPlain(textOfMarkup(b.text))) push({ flag: 'a', kind: 'blob:' + (b.type || '?'), where: b.from, excerpt: h.excerpt, label: h.label, match: h.match, via: label, cls: h.cls });
        if (b.text) for (const u of urlsOfText(b.text).filter((x) => ZERO_ASSET_RX.test(x)).slice(0, 3)) push({ flag: 'c', kind: 'blob-asset', where: b.from, excerpt: u, label: 'tenant zero asset', match: u, via: label });
      }
      for (const c of artefacts.clipboard) {
        report.clipboard++;
        for (const h of scanPlain(c)) push({ flag: 'a', kind: 'clipboard', where: ctl.where, excerpt: h.excerpt, label: h.label, match: h.match, via: label, cls: h.cls });
      }
      for (const c of artefacts.canvas) for (const h of scanPlain(c)) push({ flag: 'a', kind: 'canvas', where: ctl.where, excerpt: h.excerpt, label: h.label, match: h.match, via: label, cls: h.cls });
    }
    // Every window the press opened, read for real.
    for (const pp of log.popups.slice(before.popups)) {
      const got = await readPopup(pp.page);
      report.popups++;
      const scheme = (got.url.match(/^([a-z]+):/i) || ['', ''])[1].toLowerCase();
      if (['about', 'blob', 'data'].includes(scheme)) push({ flag: 'b', kind: 'popup:' + scheme, where: ctl.where, excerpt: (got.url.slice(0, 60) + ' · ' + textOfMarkup(got.html).replace(/\s+/g, ' ').trim().slice(0, 140)), label: 'a document opened with no URL', via: label });
      if (got.res) defectsFrom(got.res, { page: rel, offered: ctx.offered, frameIsPage: false }, (r) => push(Object.assign(r, { via: label + ' -> ' + (got.url || '').slice(0, 80) })));
    }
    log.popups.length = before.popups;
    for (const d of log.downloads.slice(before.downloads)) {
      const got = await readDownload(d);
      report.downloads++;
      for (const h of scanPlain(got.name.replace(/[-_.]+/g, ' '))) push({ flag: 'a', kind: 'download-name', where: ctl.where, excerpt: got.name, label: h.label, match: h.match, via: label, cls: h.cls });
      if (got.text != null) {
        for (const h of scanPlain(/\.html?$/i.test(got.name) ? textOfMarkup(got.text) : got.text)) push({ flag: 'a', kind: 'download:' + got.name, where: ctl.where, excerpt: h.excerpt, label: h.label, match: h.match, via: label, cls: h.cls });
        for (const u of urlsOfText(got.text).filter((x) => ZERO_ASSET_RX.test(x)).slice(0, 3)) push({ flag: 'c', kind: 'download-asset:' + got.name, where: ctl.where, excerpt: u, label: 'tenant zero asset', match: u, via: label });
      }
    }
    log.downloads.length = before.downloads;
    // A navigation or reload throws the markers away: reopen and re-mark.
    const token = await ev(page, () => window.__BCI && window.__BCI.token).catch(() => null);
    if (navigated || !token) {
      await load(page, rel, brand);
      const again = await ev(page, (z) => window.__BCI.enumerate(z), ZERO_SLUG).catch(() => []);
      const bySig = new Map(again.map((c) => [c.sig, c]));
      for (let k = idx + 1; k < controls.length; k++) { const m = bySig.get(controls[k].sig); if (m) controls[k].i = m.i; else controls[k].kind = 'gone'; }
    }
  }
  // The final state, read whole (what the presses left on screen).
  const last = await ev(page, COLLECT, collectArgs('page')).catch(() => null);
  const already = new Set(rows.map((r) => [r.flag, r.label, r.where, r.kind].join('|')));
  if (last) defectsFrom(last, ctx, (r) => { if (!already.has([r.flag, r.label, r.where, r.kind].join('|'))) push(Object.assign(r, { via: r.via || '(after every press)' })); });

  // The documents this page's links OFFER, one hop deep.
  const offeredSeen = new Set();
  for (const o of ctx.offered) {
    if (offeredSeen.has(o.file)) continue; offeredSeen.add(o.file);
    const doc = offeredDoc(o.file);
    report.offered++;
    for (const h of doc.hits.slice(0, 3)) push({ flag: 'a', kind: 'offered-document', where: o.link.where, section: o.link.section, excerpt: h.excerpt, label: h.label, match: h.match, doc: o.file, via: 'link "' + o.link.text + '" -> ' + o.file, cls: h.cls, visible: o.link.visible });
    for (const a of doc.assets.slice(0, 2)) push({ flag: 'c', kind: 'offered-document-asset', where: o.link.where, excerpt: a, label: 'tenant zero asset', match: a, doc: o.file, via: 'link "' + o.link.text + '" -> ' + o.file });
  }

  // De-duplicate (one row per flag/label/where/via) and attach the source line.
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = [r.flag, r.label, r.where, r.kind, r.via, r.doc || ''].join('|');
    if (seen.has(k)) continue; seen.add(k);
    if (r.cls === 'colour') r.source = locateHex(r.match, r.where, rel);
    else if (r.flag === 'a' || r.flag === 'e') r.source = r.doc ? r.doc : locate(r.original || r.excerpt, r.original ? r.original.slice(0, 40) : r.match, rel, brand.name);
    r.owned = OWNED_ELSEWHERE.find((o) => o.test(r)) || null;
    out.push(r);
  }
  return out;
}

/**
 * The rail's `?` chips, pressed once per brand: the five-question panel each
 * opens is user-facing copy, written into the same panel on every page, so it
 * is read once here rather than on every page (the page sweep leaves the rail alone).
 */
async function sweepRail(page, brand, report) {
  const rows = [];
  const keys = await ev(page, () => Array.from(document.querySelectorAll('#lifecycle-nav button.lnav-i[data-itoggle]')).map((b) => b.getAttribute('data-itoggle')));
  for (const k of keys) {
    await ev(page, (key) => { const b = document.querySelector('#lifecycle-nav button.lnav-i[data-itoggle="' + key + '"]'); if (b) b.click(); }, k);
    await page.waitForTimeout(80);
    const res = await ev(page, COLLECT, collectArgs('rail', { rootSel: '#lnav-ipanel' })).catch(() => null);
    if (res) defectsFrom(res, { page: '(rail)', offered: [], frameIsPage: false }, (r) => rows.push(Object.assign({ page: '(rail)', brand: brand.slug }, r, { via: 'rail ? ' + k })));
    report.railPanels++;
  }
  await page.keyboard.press('Escape').catch(() => {});
  const seen = new Set();
  return rows.filter((r) => { const key = [r.flag, r.label, r.via, r.kind].join('|'); if (seen.has(key)) return false; seen.add(key); return true; })
    .map((r) => Object.assign(r, { source: r.cls === 'colour' ? locateHex(r.match, r.where, 'index.html') : locate(r.original || r.excerpt, r.original ? r.original.slice(0, 40) : r.match, 'index.html', brand.name), owned: OWNED_ELSEWHERE.find((o) => o.test(r)) || null }));
}

/* ══ the inventory ═══════════════════════════════════════════════════════════ */

function printInventory(title, rows, report) {
  const lines = [];
  lines.push(`\n${'═'.repeat(110)}\n${title}: ${report.pages} pages, ${report.nodes} text nodes, ${report.elements} elements, ${report.chars} chars, ${report.pressed} presses of ${report.controls} controls, ${report.popups} popups, ${report.downloads} downloads, ${report.blobs} blobs, ${report.clipboard} clipboard writes, ${report.offered} offered documents, ${report.railPanels || 0} rail panels\n${'═'.repeat(110)}`);
  const byPage = new Map();
  for (const r of rows) { if (!byPage.has(r.page)) byPage.set(r.page, []); byPage.get(r.page).push(r); }
  for (const [p, rs] of Array.from(byPage.entries()).sort()) {
    lines.push(`\n▸ ${p} (${rs.length})`);
    for (const r of rs) lines.push(`  ${r.owned ? '~ [' + r.owned.owner + ']' : '✗'} (${r.flag}) ${r.kind} · ${r.label}${r.where ? ' @ ' + r.where : ''}${r.via ? ' · via ' + r.via : ''}${r.source ? ' · ' + r.source : ''}\n        ${String(r.excerpt || '').slice(0, 200)}`);
  }
  const perEntry = OWNED_ELSEWHERE.map((o) => `${o.owner}: ${rows.filter((r) => r.owned === o).length} · ${o.why}`);
  lines.push('\nOWNED ELSEWHERE (reported, not failed; an entry at 0 across a full run is stale and should be deleted):\n  ' + perEntry.join('\n  '));
  console.log(lines.join('\n'));
  try {
    const dir = process.env.BCI_REPORT_DIR || os.tmpdir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `bci-${title.replace(/\W+/g, '-')}.json`), JSON.stringify({ report, rows: rows.map((r) => Object.assign({}, r, { owned: r.owned ? r.owned.owner : null })) }, null, 1));
  } catch (_) { /* the report is a convenience */ }
}

/* ══ the tests ══════════════════════════════════════════════════════════════ */

test('the page list, the brands and the signatures are real', () => {
  expect(PAGES_ALL.length, 'too few pages').toBeGreaterThan(60);
  for (const f of ['knowledge-base.html', 'research.html', 'smart-brain.html', 'lifecycle_mailer_architect_v34.html', 'onboarding.html', 'index.html', 'diff-version.html', 'playbook.html']) expect(PAGES_ALL).toContain(f);
  expect(PAGES_ALL, 'a tenant-zero artefact with no shell is not an app page').not.toContain('playbook/index.html');
  expect(excludedWhy('playbook/index.html')).toMatch(/generated playbook/);
  expect(PAGES_ALL, 'a redirected file is swept as its destination, not as itself').not.toContain('data-analysis-contrast.html');
  expect(PAGES_ALL.some((f) => /^growth-book\//.test(f)), 'shell-carrying pages outside the root were not found').toBe(true);
  for (const b of Object.values(BRANDS)) expect(String(b.slug).toLowerCase()).not.toBe(ZERO_SLUG);
  expect(BRANDS['deli-chic'].palette.primary.toLowerCase()).not.toBe(ZERO.palette.primary.toLowerCase());
  const labels = SIGNATURES.map((s) => s.label);
  for (const want of ['claim: ', 'legal entity: ', 'product line: ', 'store host: ', 'preferred vocabulary: ', 'sibling: ']) expect(labels.some((l) => l.startsWith(want)), 'no "' + want + '" signature was derived').toBe(true);
  expect(ZERO_COLOURS.length).toBeGreaterThanOrEqual(3);
  // The sibling's product words are signatures only because neither brand under
  // sweep uses them: a brand that sold coffee could not be swept with them.
  for (const b of Object.values(BRANDS)) {
    const own = JSON.stringify(b);
    for (const sg of SIGNATURES) expect(new RegExp(sg.src, sg.flags).test(own), b.name + '\'s own record matches the signature "' + sg.label + '"').toBe(false);
  }
  expect(ZERO_ASSETS.some((a) => /cdn\.shopify\.com\/s\/files/.test(a)), 'tenant zero\'s image host was not derived from the catalogue').toBe(true);
  // The routing model is Vercel's: a host-conditioned catch-all does not make every path live.
  expect(resolveRoute('/definitely-not-a-route').kind).toBe('dead');
  expect(resolveRoute('/kb').file).toBe('knowledge-base.html');
  expect(resolveRoute('/lp/abc123').kind).toBe('api');
  expect(resolveRoute('/ads-master').file).toBe('data-analysis.html');
});

test.describe.configure({ mode: 'parallel' });
test.beforeAll(async () => { REAL_WORLD = await A.world({ serverMode: false }); REAL = A.forward(REAL_WORLD.port); });
test.afterAll(async () => { if (REAL_WORLD) await REAL_WORLD.close(); REAL = null; REAL_WORLD = null; });

// The frozen snapshot is tenant zero's own build (auth.js gateFrozenSnapshot).
// The shard sweep reads it like any page; this holds the decision itself: for
// every other brand each snapshot page is REPLACED by the sentence that says
// whose it is, so no word of the snapshot is on screen, and no rail row offers it.
const SNAPSHOT_PAGES = PAGES_ALL.filter((f) => /^diff-version(\.html$|\/)/.test(f));
for (const [, brand] of Object.entries(BRANDS)) {
  test(`${brand.name}: tenant zero's frozen snapshot is withheld on every page of it`, async ({ browser }) => {
    test.setTimeout(120_000);
    expect(SNAPSHOT_PAGES.length, 'the snapshot pages were not enumerated').toBeGreaterThanOrEqual(4);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const log = { dialogs: [], errors: [], downloads: [], popups: [], inflight: 0 };
    await install(context, page, brand, log);
    try {
      for (const f of SNAPSHOT_PAGES) {
        await page.goto(HOST + '/' + f, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('body[data-snapshot-withheld="1"]', { timeout: 15_000 }).catch(() => {});
        const seen = await page.evaluate(() => ({
          withheld: document.body && document.body.getAttribute('data-snapshot-withheld'),
          text: document.body ? document.body.innerText : '',
          shown: getComputedStyle(document.documentElement).visibility,
          links: Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')).filter((h) => /diff-version/.test(h)),
          icons: Array.from(document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]')).map((l) => l.href),
          title: document.title,
        }));
        expect(seen.withheld, `${f} is shown under ${brand.name}`).toBe('1');
        expect(seen.text, f).toContain('another brand');
        expect(seen.text, f).toContain(brand.name);
        expect(scanPlain(seen.text).map((h) => h.label + ': ' + h.match), f).toEqual([]);
        expect(seen.shown, f + ' was left hidden').not.toBe('hidden');
        expect(seen.links, f + ' offers the snapshot').toEqual([]);
        // The tab is shown too: the snapshot's own icon is tenant zero's mark.
        expect(seen.icons.filter((u) => ZERO_ASSET_RX.test(u)), f + ' keeps tenant zero\'s icon in the tab').toEqual([]);
        expect(seen.icons.some((u) => /lifecycle-os-mark/.test(u)), f + ' has no platform icon').toBe(true);
        expect(scanPlain(seen.title), f + ' title').toEqual([]);
      }
      // And no app page's rail offers it.
      await page.goto(HOST + '/index.html', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#lifecycle-nav a', { state: 'attached', timeout: 15_000 });
      expect(await page.locator('#lifecycle-nav a[href*="diff-version"]').count()).toBe(0);
    } finally { await context.close(); }
  });
}

// Smart Brain's "Detailed page" is reached only after a slot's assets were
// previewed, which the sweep's backend cannot produce, so it is driven here
// with a previewed slot in place: the mailer opens IN the page (no window, no
// about:blank document) and its download is named for the active brand.
test('Deli Chic: Smart Brain opens a detailed page in place, with a download named for the brand', async ({ browser }) => {
  test.setTimeout(120_000);
  const brand = BRANDS['deli-chic'];
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const log = { dialogs: [], errors: [], downloads: [], popups: [], inflight: 0 };
  await install(context, page, brand, log);
  const popups = [];
  context.on('page', (p) => { if (p !== page) popups.push(p.url()); });
  try {
    await page.goto(HOST + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.openDetailPage === 'function' && window.BrandContext && window.BrandContext.brand, null, { timeout: 30_000 });
    await page.evaluate(() => {
      /* global PLAN, PREVIEW_CACHE */
      PLAN = [{ id: 'bci-slot-1', title: 'Detail check' }];
      PREVIEW_CACHE['bci-slot-1'] = { email_html: '<!doctype html><title>m</title><h1>BCI detail body</h1>' };
      window.openDetailPage(0, null);
    });
    const frame = page.locator('#sbdetail iframe');
    await expect(frame).toHaveCount(1);
    expect(await frame.getAttribute('srcdoc')).toContain('BCI detail body');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.click('#sbdetail-dl')]);
    expect(dl.suggestedFilename()).toMatch(/^deli-chic-/);
    await page.click('#sbdetail-x');
    await expect(page.locator('#sbdetail')).toHaveCount(0);
    expect(popups, 'the detailed page opened a window').toEqual([]);
  } finally { await context.close(); }
});

const SHARDS = Number(process.env.BCI_SHARDS || 3);
for (const [key, brand] of Object.entries(BRANDS)) {
  for (let s = 0; s < SHARDS; s++) {
    const files = PAGES.filter((_, i) => i % SHARDS === s);
    if (!files.length) continue;
    test(`${brand.name}: pages shard ${s + 1}/${SHARDS} carry nothing of tenant zero, and every document they open has a URL`, async ({ browser }) => {
      test.setTimeout(3_000_000);
      const open = async () => { const c = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } }); const p = await c.newPage(); await install(c, p, brand, log); return [c, p]; };
      const log = { dialogs: [], errors: [], downloads: [], popups: [], inflight: 0 };
      let [context, page] = await open();
      const report = { pages: 0, nodes: 0, elements: 0, chars: 0, controls: 0, pressed: 0, popups: 0, downloads: 0, blobs: 0, clipboard: 0, offered: 0, railPanels: 0 };
      const rows = [];
      for (const f of files) {
        // A page the BROWSER lost (renderer crash, context gone under load) is
        // not a finding about the page: the sweep reopens and reads it again.
        // Only a second failure, or a page that wedged, is reported.
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const got = await sweepPage(page, context, f, brand, log, report);
            // The rail's panels, once per brand, on the first page that carries the rail.
            if (s === 0 && !report.railPanels) got.push(...await sweepRail(page, brand, report));
            rows.push(...got);
            break;
          } catch (e) {
            const lost = page.isClosed() || /closed|crash/i.test(String(e.message));
            if (!lost || attempt === 2) rows.push({ page: f, brand: brand.slug, flag: 'harness', kind: 'sweep', where: '', excerpt: String(e.message).split('\n')[0].slice(0, 200), label: 'the sweep could not finish this page' });
            // A wedged or lost page is replaced, so one runaway page cannot hold the shard.
            if (lost) { await context.close().catch(() => {}); [context, page] = await open(); log.inflight = 0; }
            else if (page.__bciWedged) { await page.close({ runBeforeUnload: false }).catch(() => {}); page = await context.newPage(); log.inflight = 0; await installPage(page, brand, log); }
            if (!lost) break;
          }
        }
        report.pages++;
        console.log(`[bci] ${key} ${report.pages}/${files.length} ${f}: ${rows.filter((r) => r.page === f).length} rows`);
      }
      await context.close();
      const seenRow = new Set();
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r.page !== '(rail)') continue;
        const k = [r.flag, r.label, r.kind, r.where, r.doc || ''].join('|');
        if (seenRow.has(k)) rows.splice(i, 1); else seenRow.add(k);
      }
      printInventory(`${key} shard ${s + 1}`, rows, report);

      expect(report.pages).toBe(files.length);
      expect(report.nodes, 'too few text nodes read to mean anything').toBeGreaterThan(files.length * 20);
      expect(report.pressed, 'too few controls pressed to mean anything').toBeGreaterThan(files.length);
      if (s === 0) expect(report.railPanels, 'the rail\'s ? panels were not read').toBeGreaterThan(20);
      const failing = rows.filter((r) => !r.owned).map((r) => `${r.page} · (${r.flag}) ${r.kind} · ${r.label} @ ${r.where}${r.via ? ' via ' + r.via : ''}${r.source ? ' [' + r.source + ']' : ''} · ${String(r.excerpt || '').slice(0, 140)}`);
      expect(failing, `\n  ${failing.join('\n  ')}\n`).toEqual([]);
    });
  }
}
