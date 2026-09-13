'use strict';
/**
 * storefront-detect.js — what the brand's site is actually BUILT ON, read from
 * what the site itself publishes.
 * ---------------------------------------------------------------------------
 * The platform could read a brand's colours, typography, voice, claims, logo,
 * icons, imagery, legal entity and regions off its own URL, and it could import
 * that brand's catalogue. What it could never say was the one thing an operator
 * checks FIRST, and the one thing every competing onboarding flow opens with:
 * WHICH STORE IS THIS.
 *
 * That gap was measured, not assumed. Running `brand-extract.extractBrand()`
 * over a fixture that declares Shopify four separate ways — `<meta
 * name="generator" content="Shopify">`, `Shopify.shop = "…myshopify.com"`, a
 * `cdn.shopify.com` script and `class="shopify-section"` — produced a report
 * with **zero** occurrences of the string "shopify" anywhere in it. Four
 * published declarations, none read.
 *
 * It is not cosmetic. `importCatalog` decides between a product FEED and a site
 * CRAWL by trying `/products.json` and seeing what happens, so:
 *
 *   * every non-Shopify store pays a wasted request and a 502 on every import;
 *   * the failure an operator sees leads with "Public product feed not
 *     available at that URL", which reads like their store is broken when the
 *     real answer is "your platform does not publish one, and it does not need
 *     to";
 *   * nothing anywhere records what the store runs on, so the answer is
 *     re-derived by trial and error on every single import.
 *
 * ── DETECTION IS EVIDENCE, NOT A GUESS ─────────────────────────────────────
 * Every signal here is something the site PUBLISHES about itself: a generator
 * meta tag, a platform's own global JavaScript object, its own CDN host, its
 * own namespaced class names. Nothing is inferred from layout, wording, or the
 * shape of a URL. Each hit carries the page it was seen on and the exact text
 * that matched, the same contract as every other candidate in this pipeline.
 *
 * ── "NOT DETECTED" IS NOT "NOT A STORE" ────────────────────────────────────
 * A headless storefront, a bespoke build, or a platform that ships no
 * fingerprint publishes nothing for this to read. That is a statement about
 * the SIGNALS, and this module says so in those words. It never downgrades to
 * "no store found", and it never blocks a catalogue import: the site-crawl
 * route reads declared structured data and works regardless of platform.
 *
 * ── NO ENDPOINT A PLATFORM'S DOCS DID NOT GIVE US ──────────────────────────
 * Detecting BigCommerce does not conjure a BigCommerce product feed. The only
 * unauthenticated catalogue feed this repo may call is Shopify's
 * `/products.json`, which it already calls. Every other platform routes to the
 * site crawl and `catalogRouteFor()` says why in a sentence the operator can
 * act on. Adding a guessed endpoint here would be the same defect class as an
 * unverified adapter endpoint in `adapters/`.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const CONF = { declared: 'declared', strong: 'strong', weak: 'weak' };
const CONF_ORDER = { declared: 0, strong: 1, weak: 2 };

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 200);

/** The spec's missing-data marker. Never a value, always a report. */
function MARKER(field, product, region) {
  return `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${product || 'all'}, ${region || 'all'}]`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE SIGNAL TABLE

   `where` says WHICH published surface the pattern is matched against, because
   the same word means different things in different places. "shopify" inside a
   generator meta tag is the site declaring its platform; "shopify" inside body
   prose is a blog post about Shopify. Only the first is evidence.

     generator   the <meta name="generator"> content, verbatim
     html        the page source, for a platform's own global object or its own
                 namespaced class names
     asset       a URL the page references (script/link/img), for a platform's
                 own CDN host

   `kind` separates a COMMERCE platform from a CMS. A WooCommerce site is also
   a WordPress site, and reporting only "WordPress" would send the catalogue
   import down the wrong route; reporting only "WooCommerce" would lose the CMS
   an operator may well want to know about. Both are kept, in their own slots.
   ═══════════════════════════════════════════════════════════════════════════ */

const PLATFORMS = [
  {
    id: 'shopify', name: 'Shopify', kind: 'commerce',
    signals: [
      { where: 'generator', rx: /shopify/i, confidence: CONF.declared, why: 'the site declares Shopify in its own generator meta tag' },
      { where: 'html', rx: /Shopify\s*\.\s*(?:shop|theme|routes|currency)\s*=/, confidence: CONF.declared, why: 'the page defines Shopify\'s own global storefront object' },
      { where: 'html', rx: /([a-z0-9-]+\.myshopify\.com)/i, confidence: CONF.declared, why: 'the page names a myshopify.com store domain' },
      { where: 'asset', rx: /cdn\.shopify(?:cdn)?\.(?:com|net)/i, confidence: CONF.strong, why: 'assets are served from Shopify\'s own CDN' },
      { where: 'html', rx: /class=["'][^"']*\bshopify-(?:section|payment-button|block)\b/i, confidence: CONF.strong, why: 'the markup uses Shopify\'s own namespaced class names' },
    ],
  },
  {
    id: 'woocommerce', name: 'WooCommerce', kind: 'commerce',
    signals: [
      { where: 'generator', rx: /woocommerce/i, confidence: CONF.declared, why: 'the site declares WooCommerce in its own generator meta tag' },
      { where: 'asset', rx: /\/wp-content\/plugins\/woocommerce\//i, confidence: CONF.declared, why: 'the page loads WooCommerce\'s own plugin assets' },
      { where: 'html', rx: /class=["'][^"']*\bwoocommerce(?:-page|-js)?\b/i, confidence: CONF.strong, why: 'the markup uses WooCommerce\'s own body classes' },
    ],
  },
  {
    id: 'bigcommerce', name: 'BigCommerce', kind: 'commerce',
    signals: [
      { where: 'generator', rx: /bigcommerce/i, confidence: CONF.declared, why: 'the site declares BigCommerce in its own generator meta tag' },
      { where: 'asset', rx: /cdn\d*\.bigcommerce\.com/i, confidence: CONF.strong, why: 'assets are served from BigCommerce\'s own CDN' },
    ],
  },
  {
    id: 'salesforce_b2c', name: 'Salesforce B2C Commerce', kind: 'commerce',
    signals: [
      { where: 'asset', rx: /\/on\/demandware\.(?:static|store)\//i, confidence: CONF.declared, why: 'assets are served from Demandware\'s own path scheme, which is Salesforce B2C Commerce' },
    ],
  },
  {
    id: 'magento', name: 'Magento / Adobe Commerce', kind: 'commerce',
    signals: [
      { where: 'generator', rx: /magento|adobe commerce/i, confidence: CONF.declared, why: 'the site declares Magento in its own generator meta tag' },
      { where: 'asset', rx: /\/static\/version\d+\/frontend\//i, confidence: CONF.strong, why: 'assets use Magento\'s own versioned static path scheme' },
      { where: 'html', rx: /\bMagento_[A-Z][A-Za-z]+\b/, confidence: CONF.strong, why: 'the page references Magento\'s own namespaced modules' },
    ],
  },
  {
    id: 'shopware', name: 'Shopware', kind: 'commerce',
    signals: [
      { where: 'generator', rx: /shopware/i, confidence: CONF.declared, why: 'the site declares Shopware in its own generator meta tag' },
    ],
  },
  {
    id: 'prestashop', name: 'PrestaShop', kind: 'commerce',
    signals: [
      { where: 'generator', rx: /prestashop/i, confidence: CONF.declared, why: 'the site declares PrestaShop in its own generator meta tag' },
      { where: 'html', rx: /\bvar\s+prestashop\s*=/i, confidence: CONF.strong, why: 'the page defines PrestaShop\'s own global object' },
    ],
  },
  {
    id: 'ecwid', name: 'Ecwid', kind: 'commerce',
    signals: [
      { where: 'asset', rx: /app\.ecwid\.com|ecwid\.com\/script\.js/i, confidence: CONF.declared, why: 'the page loads Ecwid\'s own storefront script' },
    ],
  },
  {
    id: 'squarespace', name: 'Squarespace', kind: 'cms',
    signals: [
      { where: 'generator', rx: /squarespace/i, confidence: CONF.declared, why: 'the site declares Squarespace in its own generator meta tag' },
      { where: 'html', rx: /Static\s*\.\s*SQUARESPACE_CONTEXT/, confidence: CONF.declared, why: 'the page defines Squarespace\'s own global context object' },
      { where: 'asset', rx: /static\d*\.squarespace\.com/i, confidence: CONF.strong, why: 'assets are served from Squarespace\'s own CDN' },
    ],
  },
  {
    id: 'wix', name: 'Wix', kind: 'cms',
    signals: [
      { where: 'generator', rx: /wix\.com|wix website builder/i, confidence: CONF.declared, why: 'the site declares Wix in its own generator meta tag' },
      { where: 'asset', rx: /static\.parastorage\.com|static\.wixstatic\.com/i, confidence: CONF.strong, why: 'assets are served from Wix\'s own CDN' },
    ],
  },
  {
    id: 'webflow', name: 'Webflow', kind: 'cms',
    signals: [
      { where: 'generator', rx: /webflow/i, confidence: CONF.declared, why: 'the site declares Webflow in its own generator meta tag' },
      { where: 'asset', rx: /(?:assets(?:-global)?|cdn\.prod)\.website-files\.com/i, confidence: CONF.strong, why: 'assets are served from Webflow\'s own CDN' },
    ],
  },
  {
    id: 'wordpress', name: 'WordPress', kind: 'cms',
    signals: [
      { where: 'generator', rx: /wordpress/i, confidence: CONF.declared, why: 'the site declares WordPress in its own generator meta tag' },
      { where: 'asset', rx: /\/wp-(?:content\/themes|includes)\//i, confidence: CONF.strong, why: 'the page loads WordPress\'s own theme or core assets' },
    ],
  },
  {
    id: 'drupal', name: 'Drupal', kind: 'cms',
    signals: [
      { where: 'generator', rx: /drupal/i, confidence: CONF.declared, why: 'the site declares Drupal in its own generator meta tag' },
    ],
  },
  {
    id: 'ghost', name: 'Ghost', kind: 'cms',
    signals: [
      { where: 'generator', rx: /ghost/i, confidence: CONF.declared, why: 'the site declares Ghost in its own generator meta tag' },
    ],
  },
];

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));

/* ═══════════════════════════════════════════════════════════════════════════
   READING THE PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The generator meta tag's content, verbatim. Matched on its own rather than as
 * part of the page body, because it is the one surface where a platform name is
 * unambiguously the site declaring its own platform.
 */
function generatorOf(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = /name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    const val = (name && (name[1] != null ? name[1] : (name[2] != null ? name[2] : name[3])) || '').toLowerCase();
    if (val !== 'generator') continue;
    const content = /content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    const c = content && (content[1] != null ? content[1] : (content[2] != null ? content[2] : content[3]));
    if (c) out.push(clip(c, 200));
  }
  return out;
}

/**
 * Every URL the page references. A platform's own CDN host is one of the most
 * reliable things a site publishes about itself, and it lives in src/href
 * attributes rather than in the prose this module refuses to read.
 */
function assetUrls(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/(?:src|href|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const v = m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3]);
    if (v) out.push(String(v).slice(0, 400));
  }
  return out;
}

/**
 * The store's own handle on its platform, where the platform publishes one.
 * Shopify is currently the only one that does so in the page: `*.myshopify.com`
 * is the canonical store identifier and is worth keeping, because it is the
 * value an operator pastes into a Shopify integration.
 */
function handleFrom(html) {
  const m = /([a-z0-9][a-z0-9-]*\.myshopify\.com)/i.exec(String(html || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * Collect platform signals from ONE page.
 *
 * Shaped like every other candidate collector in brand-extract.js — it takes
 * the same `ctx` and returns a flat list — so it rides the existing crawl
 * rather than adding a second pass over the same HTML.
 */
function storefrontSignals(ctx) {
  const { html, url } = ctx || {};
  if (!html) return [];
  const body = String(html);
  const generators = generatorOf(body);
  const assets = assetUrls(body).join('\n');
  const out = [];

  for (const p of PLATFORMS) {
    for (const s of p.signals) {
      const hay = s.where === 'generator' ? generators.join('\n') : (s.where === 'asset' ? assets : body);
      if (!hay) continue;
      const m = s.rx.exec(hay);
      if (!m) continue;
      out.push({
        platform: p.id,
        name: p.name,
        kind: p.kind,
        signal: `${s.where}:${p.id}`,
        confidence: s.confidence,
        source_url: url || '',
        evidence: clip(m[0], 160),
        why: s.why,
      });
    }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CATALOGUE ROUTE

   What a detected platform actually means for reading that brand's products.
   The honest answer for almost every platform is "crawl the declared structured
   data", which is what importCatalog already falls back to — the value of
   detection is that it stops being a fallback arrived at through a failed
   request, and starts being the route chosen on purpose, with a reason.
   ═══════════════════════════════════════════════════════════════════════════ */

function catalogRouteFor(platformId) {
  if (platformId === 'shopify') {
    return {
      kind: 'shopify_public',
      path: '/products.json',
      note: 'Shopify publishes an unauthenticated product feed at /products.json. It is read first; a store that has disabled it falls through to the site crawl.',
    };
  }
  const p = BY_ID.get(platformId);
  if (p) {
    return {
      kind: 'site_crawl',
      path: null,
      note: `${p.name} publishes no unauthenticated product feed this platform is permitted to call, so the catalogue is read from the structured data the site declares on its own pages. Nothing is lost by this: it is the same route every non-Shopify store already takes, chosen deliberately instead of after a failed request.`,
    };
  }
  return {
    kind: 'site_crawl',
    path: null,
    note: 'No platform was identified, so the catalogue is read from the structured data the site declares on its own pages. That route does not depend on knowing the platform.',
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE REPORT
   ═══════════════════════════════════════════════════════════════════════════ */

/** Highest-confidence first; ties keep the order the signals were collected in. */
function rankSignals(list) {
  return list
    .filter(Boolean)
    .slice()
    .sort((a, b) => (CONF_ORDER[a.confidence] ?? 3) - (CONF_ORDER[b.confidence] ?? 3));
}

/**
 * Fold every page's signals into one answer.
 *
 * A platform is scored by its BEST signal, not by how many it emitted: one
 * generator meta tag is the site declaring its platform outright, and it
 * outranks any number of CDN-host sightings. Counting hits would let a site
 * that references another platform's CDN in three places outrank its own
 * declaration.
 */
function summarise(signals, opts) {
  const o = opts || {};
  const ranked = rankSignals(signals);

  const byPlatform = new Map();
  for (const s of ranked) {
    const prev = byPlatform.get(s.platform);
    if (prev) { prev.signals.push(s); continue; }
    byPlatform.set(s.platform, {
      id: s.platform, name: s.name, kind: s.kind,
      confidence: s.confidence, source_url: s.source_url, evidence: s.evidence, why: s.why,
      signals: [s],
    });
  }

  const all = [...byPlatform.values()]
    .sort((a, b) => (CONF_ORDER[a.confidence] ?? 3) - (CONF_ORDER[b.confidence] ?? 3));
  const commerce = all.filter((c) => c.kind === 'commerce');
  const cms = all.filter((c) => c.kind === 'cms');

  // The commerce platform is the answer to "which store is this". A CMS is
  // reported beside it, never instead of it: a WooCommerce site is a WordPress
  // site, and collapsing the two would route its catalogue import as if it had
  // no store at all.
  const platform = commerce[0] || null;

  // Two commerce platforms declared at once is a real, reportable state — a
  // migration half-finished, or an embedded storefront on someone else's CMS.
  // Resolving it by picking the higher-ranked one would hide it.
  const conflicts = commerce.length > 1
    ? [{
      field: 'store platform',
      message: `More than one commerce platform is declared on this site: ${commerce.map((c) => `${c.name} (${c.confidence})`).join(', ')}. `
        + 'That usually means a migration in progress or an embedded storefront on another platform. It is reported rather than resolved, because picking one would hide it.',
      candidates: commerce.map((c) => ({ id: c.id, name: c.name, confidence: c.confidence, source_url: c.source_url })),
    }]
    : [];

  const detected = !!platform;
  const route = catalogRouteFor(platform ? platform.id : null);

  return {
    detected,
    platform: platform
      ? {
        id: platform.id, name: platform.name, kind: platform.kind,
        confidence: platform.confidence, source_url: platform.source_url,
        evidence: platform.evidence, why: platform.why,
        store_handle: o.storeHandle || '',
      }
      : null,
    cms: cms[0]
      ? {
        id: cms[0].id, name: cms[0].name, confidence: cms[0].confidence,
        source_url: cms[0].source_url, evidence: cms[0].evidence, why: cms[0].why,
      }
      : null,
    candidates: all.map((c) => ({
      id: c.id, name: c.name, kind: c.kind, confidence: c.confidence,
      source_url: c.source_url, evidence: c.evidence, why: c.why,
      signal_count: c.signals.length,
    })),
    conflicts,
    catalog_route: route,
    // The distinction this module exists to keep: a site that publishes no
    // fingerprint has told us nothing about whether it is a store, and saying
    // "no store" there would be an invented fact.
    note: detected
      ? `Detected from what the site publishes about itself: ${platform.why}.`
      : 'No commerce or CMS platform declared itself on the pages that were read. That is a statement about the SIGNALS, not about the site: a headless storefront, a bespoke build, or a platform that ships no fingerprint all look like this. The catalogue is read from the site\'s own declared structured data either way, so nothing is blocked by it.',
    marker: detected ? '' : MARKER('store platform'),
  };
}

/**
 * The whole-site answer, from the pages a crawl already read.
 *
 * `pages` is `[[url, html], …]` — the shape brand-extract already holds — or an
 * array of `{url, html}`. Passing the pages rather than fetching them is the
 * point: this rides the existing crawl and never opens a connection of its own.
 */
function detectStorefront(pages, opts) {
  const rows = [];
  let handle = '';
  for (const entry of (pages || [])) {
    const url = Array.isArray(entry) ? entry[0] : (entry && entry.url);
    const html = Array.isArray(entry) ? entry[1] : (entry && entry.html);
    if (!html) continue;
    rows.push(...storefrontSignals({ html, url }));
    if (!handle) handle = handleFrom(html);
  }
  return summarise(rows, Object.assign({ storeHandle: handle }, opts || {}));
}

module.exports = {
  detectStorefront, storefrontSignals, summarise, catalogRouteFor,
  generatorOf, assetUrls, handleFrom, rankSignals,
  PLATFORMS, CONF, MARKER,
};
