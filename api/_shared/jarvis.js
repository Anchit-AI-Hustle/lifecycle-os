'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// "Knickgasm Jarvis" — lightweight intent layer ported from Knickgasm-Super-App
// (src/lib/jarvis.ts) to CommonJS for the web app during the consolidation merge.
//
// It reads plain text (the assistant's reply + the user's message) — no server
// tool-calls — and turns it into tappable navigation actions:
//   • product → the storefront PDP ({base}/products/{handle}) via the real catalog
//   • tab     → an internal Lifecycle-OS page (/studio, /analytics, /plan, …) or
//               the storefront (shop/cart), only when the user explicitly asks
//
// Collections are intentionally NOT emitted here: the dest's collection slugs
// live behind collectionUrl()/heroMap in the page JS, so guessing them server-
// side would risk 404 links. Products + tabs are the high-confidence subset.
// ─────────────────────────────────────────────────────────────────────────────

const catalogServer = require('./brand-catalog-server.js');

// Market → storefront base (VERIFIED, per CLAUDE.md). Unknown markets fall back to .com
const STORE_BASE = {
  US: 'https://knickgasm.com',
  UK: 'https://knickgasm.com',
  IN: 'https://knickgasm.com',
  EU: 'https://knickgasm.com',
  AU: 'https://knickgasm.com',
  ME: 'https://knickgasm.com',
  GLOBAL: 'https://knickgasm.com',
};

// Words too generic to identify a product on their own.
const STOP = new Set([
  'sneaker', 'sneakers', 'kicks', 'the', 'and', 'with', 'for', 'knickgasm', 'colorway', 'colorways',
  'organic', 'loose', 'panel', 'green', 'black', 'themed', 'streetwear', 'spiced',
  'hand-painted', 'gift', 'set', 'pack', 'box', 'bags', 'premium', 'pure',
]);

function tokenize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

// The catalogue Jarvis may navigate: the ACTIVE brand's own products. Reading
// data/catalog/products_*.json directly meant every workspace's assistant
// offered to open tenant zero's PDPs, so a publisher's navigation suggestions
// were sneaker product pages on a store it does not own.
function loadCatalog(market, brand) {
  return catalogServer.productsFor(market, { brand: brand || null }).products;
}

function matchProducts(text, products) {
  const lc = ` ${String(text).toLowerCase()} `;
  const scored = [];
  for (const p of products) {
    const name = p.n || p.name || '';
    const handle = p.h || p.handle || '';
    if (!name || !handle) continue;
    const nameLc = name.toLowerCase();
    const toks = tokenize(name).filter((w) => w.length >= 4 && !STOP.has(w));
    if (toks.length === 0) continue;
    let matched = 0;
    let distinctive = 0;
    for (const w of toks) {
      if (lc.includes(w)) {
        matched += 1;
        if (w.length >= 6) distinctive += 1; // e.g. lakadong, embroidery, dunks, jordan
      }
    }
    const full = text.toLowerCase().includes(nameLc);
    if (!(full || matched >= 2 || distinctive >= 1)) continue;
    scored.push({ name, handle, score: (full ? 100 : 0) + matched * 2 + distinctive });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}

const NAV_VERB = /\b(open|go|goto|show|take me|navigate|view|see|bring up|jump to|head to)\b/;

// Internal Lifecycle-OS routes (per vercel.json rewrites) + storefront jumps.
const TABS = [
  { re: /\b(studio|mailer|emailer|newsletter|email builder)\b/, href: '/studio', label: 'Open Mailer Studio' },
  { re: /\b(analytics|dashboard|rfm|cohort|cohorts|metrics|performance)\b/, href: '/analytics', label: 'Open Analytics' },
  { re: /\b(calendar|plan|planner|schedule|roadmap)\b/, href: '/plan', label: 'Open Calendar' },
  { re: /\b(ad|ads|campaign|campaigns|creative|creatives|paid social)\b/, href: '/ads', label: 'Open Ad Campaigns' },
  { re: /\b(competitor|competitors|benchmark|benchmarking|intel)\b/, href: '/competitor', label: 'Open Competitor Intel' },
  { re: /\b(knowledge|kb|library|knowledge base)\b/, href: '/kb', label: 'Open Knowledge Base' },
];

/**
 * The storefront to navigate to. A brand's OWN regional store URL wins; the
 * STORE_BASE map below it describes tenant zero's storefronts only, so it is
 * used only when no brand record says otherwise (which is tenant zero's case).
 */
function storeBaseFor(market, brand) {
  if (brand && (brand.id || brand.slug)) {
    let f = null;
    try { f = require('./brand-runtime.js').regionFacts(brand, market); } catch (_) { f = null; }
    if (f && f.store) return 'https://' + f.store;
    if (brand.website) return String(brand.website).replace(/\/$/, '');
    // A brand with no store URL on file gets no storefront link at all, rather
    // than another company's domain.
    return '';
  }
  return STORE_BASE[market] || STORE_BASE.US;
}

/**
 * detectNavActions(userText, assistantText, opts) → NavAction[]
 *   opts.market: 'US' | 'UK' | 'IN' | 'EU' | 'AU' | 'ME' | 'GLOBAL' (default 'US')
 *   opts.brand:  the ACTIVE brand record; decides both the catalogue that may be
 *                searched and the storefront that may be linked.
 * NavAction = { key, kind: 'product'|'tab', label, href }
 */
function detectNavActions(userText, assistantText, opts) {
  const market = String((opts && opts.market) || 'US').toUpperCase();
  const brand = (opts && opts.brand) || null;
  const base = storeBaseFor(market, brand);
  const products = loadCatalog(market, brand);
  const corpus = `${assistantText || ''}\n${userText || ''}`;
  const actions = [];
  const seen = new Set();
  const push = (a) => { if (!seen.has(a.key)) { seen.add(a.key); actions.push(a); } };

  for (const m of matchProducts(corpus, products)) {
    push({ key: `product:${m.handle}`, kind: 'product', label: `Open ${m.name}`, href: `${base}/products/${m.handle}` });
  }

  // Storefront + internal tabs: only when the USER explicitly asked to navigate.
  const uLc = String(userText || '').toLowerCase();
  if (NAV_VERB.test(uLc)) {
    if (base && /\b(cart|bag|basket|checkout)\b/.test(uLc)) push({ key: 'tab:cart', kind: 'tab', label: 'Open Cart', href: `${base}/cart` });
    if (base && /\b(shop|store|catalog|browse|buy|homepage|home screen)\b/.test(uLc)) push({ key: 'tab:shop', kind: 'tab', label: 'Open Shop', href: base });
    for (const t of TABS) {
      if (t.re.test(uLc)) push({ key: `tab:${t.href}`, kind: 'tab', label: t.label, href: t.href });
    }
  }

  return actions.slice(0, 4);
}

module.exports = { detectNavActions };
