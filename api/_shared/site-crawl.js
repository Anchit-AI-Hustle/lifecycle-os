'use strict';
/**
 * site-crawl.js — discover a brand's real offerings and imagery from its OWN site.
 * ---------------------------------------------------------------------------
 * Catalog ingestion could read exactly one thing: a Shopify `/products.json`
 * feed. Every brand without one - a publisher, an events programme, a service,
 * or any store not on Shopify - had no way to get its real offerings or its
 * real pictures into the platform, so its generated assets fell back to
 * DATA REQUIRED markers and placeholder imagery.
 *
 * This crawls the brand's own site instead, following interlinked pages, and
 * takes what the site itself declares.
 *
 * ── WHAT IS EXTRACTED, AND WHY ONLY THIS ────────────────────────────────────
 * Only DECLARED, structured facts:
 *
 *   JSON-LD      schema.org Product, Article, Event, Offer, ImageObject. This
 *                is the site telling us what a thing is, in a standard the site
 *                chose to publish.
 *   OpenGraph    og:title, og:image, og:type, product:price:amount. Same
 *                argument: published metadata, not inference.
 *   <img>        only images inside the page's main content, with their alt
 *                text, and only when structured data yielded none.
 *
 * Prose is NOT parsed into facts. Reading a price out of body text, or guessing
 * a product name from an <h1>, is how a crawler invents a catalogue that looks
 * right and is wrong. If the site does not declare it, this returns nothing for
 * it and the gap is reported.
 *
 * ── SCOPE IS THE HARD RULE ──────────────────────────────────────────────────
 * Same-origin only, from the brand's own URL. Every candidate link and every
 * image URL is resolved against the page it was found on and then checked
 * against the brand's own host and its declared asset hosts. A crawler that
 * follows off-site links would ingest a competitor's product as the brand's
 * own, which is the single worst thing this platform can do.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const DEFAULTS = {
  maxPages: 40,
  maxDepth: 3,
  perRequestMs: 8000,
  totalMs: 45000,
  userAgent: 'LifecycleOS-BrandCrawler/1.0 (+brand catalogue discovery; respects robots.txt)',
};

/** Never worth fetching: binaries, feeds, and endpoints that are not pages. */
const SKIP_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|gz|mp4|mp3|wav|woff2?|ttf|eot|css|js|json|xml|rss|atom)(?:$|\?)/i;
/** Paths that are never brand content and often infinite. */
const SKIP_PATH = /\/(?:cart|checkout|account|login|signin|register|search|wishlist|admin|wp-admin|cdn-cgi)(?:\/|$)/i;

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif)(?:$|\?)/i;

// ── URL scope ───────────────────────────────────────────────────────────────

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; }
}

/**
 * The hosts this crawl may touch: the brand's own site, its regional stores and
 * whatever it declared as asset hosts. Nothing else, ever.
 *
 * Deliberately NOT brand-assets-core's ALLOWLIST, which is a hardcoded list of
 * one tenant's domains. Reusing it would scope every brand's crawl to tenant
 * zero's storefront.
 */
function allowedHosts(brand) {
  const out = new Set();
  const add = (u) => { const h = hostOf(u); if (h) out.add(h); };
  if (brand && brand.website) add(brand.website);
  for (const r of (brand && Array.isArray(brand.regions) ? brand.regions : [])) {
    if (r && r.store_url) add(r.store_url);
  }
  for (const h of (brand && Array.isArray(brand.asset_hosts) ? brand.asset_hosts : [])) {
    const clean = String(h || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (clean) out.add(clean);
  }
  return out;
}

function inScope(url, hosts) {
  const h = hostOf(url);
  if (!h) return false;
  for (const a of hosts) if (h === a || h.endsWith('.' + a)) return true;
  return false;
}

function absolute(href, base) {
  try { return new URL(href, base).toString().split('#')[0]; } catch (_) { return ''; }
}

// ── Extraction ──────────────────────────────────────────────────────────────

function jsonLdBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      // A block may be one node, an array, or an @graph wrapper.
      const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
      for (const n of nodes) if (n && typeof n === 'object') out.push(n);
    } catch (_) { /* a malformed block is skipped, never guessed at */ }
  }
  return out;
}

const typeOf = (node) => {
  const t = node['@type'];
  return String(Array.isArray(t) ? t[0] : (t || '')).toLowerCase();
};

function metaTags(html) {
  const out = {};
  for (const m of html.matchAll(/<meta[^>]+>/gi)) {
    const tag = m[0];
    const key = (tag.match(/(?:property|name)=["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/content=["']([^"']*)["']/i) || [])[1];
    if (key && val != null) out[key.toLowerCase()] = val;
  }
  return out;
}

const firstImage = (v) => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return firstImage(v[0]);
  if (typeof v === 'object') return firstImage(v.url || v.contentUrl || '');
  return '';
};

const priceOf = (node) => {
  const offers = node.offers;
  const o = Array.isArray(offers) ? offers[0] : offers;
  if (!o || typeof o !== 'object') return {};
  return { price: o.price != null ? String(o.price) : '', currency: o.priceCurrency || '' };
};

/**
 * One page in, declared facts out. Returns offerings and images, each carrying
 * the page it came from so nothing is ever unattributable.
 */
function extract(html, pageUrl, hosts) {
  const offerings = [];
  const images = [];
  const seenImg = new Set();

  const pushImage = (raw, alt, source) => {
    const url = absolute(raw, pageUrl);
    if (!url || !inScope(url, hosts)) return;              // never another site's picture
    if (!IMAGE_EXT.test(url) && !/\/cdn\//i.test(url)) return;
    if (seenImg.has(url)) return;
    seenImg.add(url);
    images.push({ url, alt: String(alt || '').slice(0, 300), found_on: pageUrl, source });
  };

  for (const node of jsonLdBlocks(html)) {
    const t = typeOf(node);
    const img = firstImage(node.image);
    if (img) pushImage(img, node.name || node.headline || '', 'json-ld');

    if (t === 'product') {
      const { price, currency } = priceOf(node);
      offerings.push({
        kind: 'product', name: String(node.name || '').slice(0, 300),
        url: absolute(node.url || pageUrl, pageUrl), image: absolute(img, pageUrl) || '',
        sku: String(node.sku || node.mpn || '').slice(0, 120),
        price, currency,
        description: String(node.description || '').slice(0, 600),
        found_on: pageUrl, source: 'json-ld:Product',
      });
    } else if (t === 'event') {
      offerings.push({
        kind: 'event', name: String(node.name || '').slice(0, 300),
        url: absolute(node.url || pageUrl, pageUrl), image: absolute(img, pageUrl) || '',
        starts_at: String(node.startDate || ''), ends_at: String(node.endDate || ''),
        location: typeof node.location === 'object' ? String(node.location.name || '') : String(node.location || ''),
        found_on: pageUrl, source: 'json-ld:Event',
      });
    } else if (t === 'article' || t === 'newsarticle' || t === 'blogposting') {
      offerings.push({
        kind: 'section', name: String(node.headline || node.name || '').slice(0, 300),
        url: absolute(node.url || node.mainEntityOfPage || pageUrl, pageUrl),
        image: absolute(img, pageUrl) || '',
        published_at: String(node.datePublished || ''),
        found_on: pageUrl, source: 'json-ld:Article',
      });
    }
  }

  // OpenGraph, when JSON-LD did not describe this page.
  const meta = metaTags(html);
  if (!offerings.length && (meta['og:title'] || meta['og:image'])) {
    const ogType = String(meta['og:type'] || '').toLowerCase();
    const kind = ogType.includes('product') ? 'product' : ogType.includes('article') ? 'section' : '';
    if (kind) {
      offerings.push({
        kind, name: String(meta['og:title'] || '').slice(0, 300),
        url: absolute(meta['og:url'] || pageUrl, pageUrl),
        image: absolute(meta['og:image'] || '', pageUrl) || '',
        price: meta['product:price:amount'] || '', currency: meta['product:price:currency'] || '',
        description: String(meta['og:description'] || '').slice(0, 600),
        found_on: pageUrl, source: 'opengraph',
      });
    }
  }
  if (meta['og:image']) pushImage(meta['og:image'], meta['og:title'] || '', 'opengraph');

  // Content images, only as a last resort and only with real alt text, so the
  // asset library stays describable rather than a pile of unlabelled files.
  if (!images.length) {
    for (const m of html.matchAll(/<img[^>]+>/gi)) {
      const tag = m[0];
      const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1]
        || (tag.match(/\bdata-src=["']([^"']+)["']/i) || [])[1];
      const alt = (tag.match(/\balt=["']([^"']*)["']/i) || [])[1];
      if (!src || !alt) continue;                          // no alt: not describable, not kept
      pushImage(src, alt, 'img');
      if (images.length >= 12) break;
    }
  }

  return { offerings: offerings.filter((o) => o.name), images };
}

function linksFrom(html, pageUrl, hosts) {
  const out = new Set();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const url = absolute(m[1], pageUrl);
    if (!url || !/^https?:/i.test(url)) continue;
    if (!inScope(url, hosts)) continue;
    if (SKIP_EXT.test(url) || SKIP_PATH.test(url)) continue;
    out.add(url);
  }
  return [...out];
}

// ── robots.txt ──────────────────────────────────────────────────────────────

/**
 * A minimal, conservative robots read. It honours the `*` group's Disallow
 * prefixes, and it collects the `Sitemap:` directives. Anything it cannot parse
 * is treated as allowed, because this only ever visits the operator's OWN site
 * at their request - but the declared rules are still respected rather than
 * ignored outright.
 *
 * `Sitemap:` is GROUP-INDEPENDENT in the robots.txt spec: it applies to the
 * whole file and is conventionally written at the top, BEFORE the first
 * `User-agent` line. Reading it inside the `inStar` gate — the obvious place to
 * put it, right beside `disallow` — would therefore silently discard it on the
 * most common robots.txt layout there is. It is read outside the gate, and this
 * comment is here because the gated version looks correct.
 */
async function robotsInfo(origin, fetchImpl, timeoutMs) {
  const out = { disallow: [], sitemaps: [], read: false };
  try {
    const r = await fetchImpl(origin + '/robots.txt', timeoutMs);
    if (!r || !r.ok || !r.body) return out;
    out.read = true;
    let inStar = false;
    for (const line of String(r.body).split('\n')) {
      const s = line.split('#')[0].trim();
      if (!s) continue;
      const [rawK, ...rest] = s.split(':');
      const k = rawK.trim().toLowerCase();
      const v = rest.join(':').trim();
      if (k === 'user-agent') inStar = (v === '*');
      else if (k === 'sitemap' && v) out.sitemaps.push(v);
      else if (inStar && k === 'disallow' && v) out.disallow.push(v);
    }
    return out;
  } catch (_) { return out; }
}

/** Kept for callers that only ever wanted the Disallow prefixes. */
async function disallowedPaths(origin, fetchImpl, timeoutMs) {
  return (await robotsInfo(origin, fetchImpl, timeoutMs)).disallow;
}

// ── sitemaps ────────────────────────────────────────────────────────────────

/**
 * A SITE'S OWN LIST OF ITS OWN URLs.
 *
 * Without this, coverage is whatever a breadth-first walk of the home page's
 * navigation reaches inside `maxDepth`, and a store with hundreds of products
 * behind a paginated collection grid contributes the handful of products that
 * happen to be on page one. The site already publishes the answer, in a
 * standard it chose to publish it in (sitemaps.org), and `robots.txt` — which
 * this crawler already fetches on every run — conventionally points straight at
 * it. It was being fetched, parsed, and thrown away.
 *
 * Scope is re-checked on every single URL, including the sitemap URLs
 * themselves: `robots.txt` may legally declare a sitemap on another host, and
 * fetching one would take another company's URL list as this brand's. A
 * sitemap is a claim about a site, not a licence to leave it.
 *
 * One level of `<sitemapindex>` is followed, which is the shape every large
 * site uses. Deeper nesting is legal and vanishingly rare; it is capped rather
 * than recursed so a malformed or hostile index cannot fan out.
 */
const SITEMAP_LIMITS = {
  maxSitemaps: 6,        // the index plus its children
  maxUrls: 3000,         // declared URLs kept from all sitemaps combined
};

/** `<loc>` values, entity-decoded. Nothing else in a sitemap is a URL. */
function locsFrom(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const v = m[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
      .trim();
    if (v) out.push(v);
  }
  return out;
}

const isSitemapIndex = (xml) => /<sitemapindex\b/i.test(String(xml || ''));

async function readSitemaps(origin, declared, fetchImpl, opts) {
  const o = opts || {};
  const hosts = o.hosts;
  const timeoutMs = o.timeoutMs || 8000;
  const notes = [];
  const sources = [];
  const urls = [];
  const seenSitemap = new Set();

  // Declared first. Only when robots.txt names none do we try the conventional
  // location - a site that declares its sitemaps has told us where they are,
  // and guessing a seventh is not an improvement on being told.
  const queue = (declared && declared.length ? declared.slice() : [origin + '/sitemap.xml'])
    .map((u) => absolute(u, origin))
    .filter(Boolean);
  const guessed = !(declared && declared.length);

  let fetched = 0;
  while (queue.length && fetched < SITEMAP_LIMITS.maxSitemaps) {
    const sm = queue.shift();
    if (!sm || seenSitemap.has(sm)) continue;
    seenSitemap.add(sm);
    if (!inScope(sm, hosts)) { notes.push(`skipped (sitemap off-origin): ${sm}`); continue; }

    fetched += 1;
    let r;
    try { r = await fetchImpl(sm, timeoutMs); } catch (_) { r = null; }
    if (!r || !r.ok || !r.body) {
      // A guessed /sitemap.xml that is not there is the normal case and is not
      // worth a note; a sitemap robots.txt DECLARED and did not serve is.
      if (!guessed) notes.push(`unreachable sitemap (${(r && r.status) || 0}): ${sm}`);
      continue;
    }
    // A sitemap reached by an off-origin redirect is off-origin, same rule the
    // page crawl applies to the URL that ANSWERED rather than the one asked for.
    const landed = r.url || sm;
    if (landed !== sm && !inScope(landed, hosts)) { notes.push(`skipped (sitemap redirected off-origin): ${sm} -> ${landed}`); continue; }

    const body = String(r.body);
    const locs = locsFrom(body);
    sources.push({ url: sm, kind: isSitemapIndex(body) ? 'index' : 'urlset', declared: locs.length });
    if (isSitemapIndex(body)) { for (const child of locs) queue.push(absolute(child, sm)); continue; }
    for (const loc of locs) {
      const abs = absolute(loc, sm);
      if (abs) urls.push(abs);
      if (urls.length >= SITEMAP_LIMITS.maxUrls) break;
    }
    if (urls.length >= SITEMAP_LIMITS.maxUrls) { notes.push(`sitemap URL cap (${SITEMAP_LIMITS.maxUrls}) reached; later entries were not read.`); break; }
  }

  return { found: sources.length > 0, guessed, sources, urls, notes };
}

// ── Crawl ───────────────────────────────────────────────────────────────────

async function defaultFetch(url, timeoutMs, ua) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml' },
    });
    const ct = String(r.headers.get('content-type') || '');
    if (!r.ok || !/text\/html|application\/xhtml/i.test(ct)) return { ok: false, status: r.status, body: '' };
    return { ok: true, status: r.status, body: await r.text(), url: r.url || url };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: String((e && e.message) || e) };
  } finally { clearTimeout(t); }
}

/**
 * Breadth-first over the brand's own site.
 *
 * `fetchImpl` is injectable so the extraction can be tested against fixtures
 * without a network: this module's value is in what it refuses to take, and
 * that has to be testable offline.
 *
 * Two optional hooks let a second reader ride along on ONE crawl rather than
 * running a second one with its own copy of the scope, robots and SSRF rules -
 * which is how those rules drift apart and how a brand ends up double-fetched:
 *
 *   onPage(html, url, depth)  observe each fetched page body. A throw from an
 *                             observer is swallowed; a reader must never be
 *                             able to abort the crawl it is watching.
 *   rank(url, depth) -> num   higher is visited sooner. Scope is unaffected -
 *                             this only reorders the queue, so a caller can
 *                             steer a small budget toward the pages it needs
 *                             (brand-extract wants /about and the policy pages;
 *                             a plain BFS off a store homepage spends the whole
 *                             budget on products). Omitted = strict FIFO, the
 *                             existing behaviour, byte for byte.
 *
 * Two more make ONE crawl RESUMABLE across serverless invocations, which is what
 * a whole-site knowledge ingest needs and what a second crawler would otherwise
 * have been written for:
 *
 *   frontier[]                {url, depth} rows to seed the queue with instead
 *                             of `startUrl`. `startUrl` still defines scope,
 *                             origin and robots, so a resumed batch cannot widen
 *                             beyond the site the first batch was pointed at.
 *                             Every seeded URL is scope-checked like any other.
 *   skip(url) -> bool         true = do not fetch and do not queue. The caller
 *                             passes the set it has ALREADY visited in earlier
 *                             batches, so batch 2 continues where batch 1 ran
 *                             out instead of re-fetching the same first N pages.
 *
 * `frontier_remaining` comes back for the caller to persist: it is the queue at
 * the moment the budget ran out, which is exactly the seed for the next batch.
 * Both are optional and change nothing when omitted.
 */
async function crawlSite(startUrl, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const brand = o.brand || null;
  const hosts = allowedHosts(brand && brand.website ? brand : { website: startUrl, regions: (brand || {}).regions, asset_hosts: (brand || {}).asset_hosts });
  if (!hosts.size) hosts.add(hostOf(startUrl));

  const fetchImpl = o.fetchImpl
    ? (u, ms) => o.fetchImpl(u, ms)
    : (u, ms) => defaultFetch(u, ms, o.userAgent);

  // ROBOTS.TXT AND SITEMAP.XML ARE NOT PAGES.
  //
  // `robots.txt` is text/plain and a sitemap is XML. A caller that wraps
  // `fetchImpl` to keep non-HTML out of its page reader - which brand-extract
  // does, and must, so a stylesheet is never parsed as a page - was thereby
  // also filtering these two, and BOTH silently failed: every robots.txt read
  // as unreachable, so the disallow list came back empty and the crawler's own
  // user-agent string ("respects robots.txt") was not true for that caller.
  // Nothing errored; the rule simply stopped applying one layer above where it
  // was implemented.
  //
  // So the non-page fetcher is its own parameter. It defaults to `fetchImpl`,
  // which is exactly what every existing caller already got.
  const assetFetch = o.assetFetch
    ? (u, ms) => o.assetFetch(u, ms)
    : fetchImpl;

  const start = absolute(startUrl, startUrl);
  if (!start || !inScope(start, hosts)) {
    return { ok: false, error: 'start_url_out_of_scope', offerings: [], images: [], pages: [], hosts: [...hosts] };
  }

  const origin = new URL(start).origin;
  let robotsRead = { disallow: [], sitemaps: [], read: false };
  try { robotsRead = await robotsInfo(origin, assetFetch, o.perRequestMs); } catch (_) {}
  const robots = robotsRead.disallow;
  const blockedByRobots = (u) => {
    try {
      const p = new URL(u).pathname;
      return robots.some((rule) => rule !== '/' && p.startsWith(rule));
    } catch (_) { return false; }
  };

  const skip = typeof o.skip === 'function' ? o.skip : null;
  const deadline = Date.now() + o.totalMs;
  const seen = new Set([start]);
  // A resumed batch is seeded from the caller's persisted frontier. Scope is
  // re-checked here rather than trusted: the frontier round-trips through a
  // database, and a stored row is not evidence that a URL is still on this
  // brand's own site.
  const seeded = [];
  for (const row of (Array.isArray(o.frontier) ? o.frontier : [])) {
    const u = absolute((row && row.url) || row, start);
    if (!u || !inScope(u, hosts) || seen.has(u)) continue;
    if (SKIP_EXT.test(u) || SKIP_PATH.test(u)) continue;
    seen.add(u);
    seeded.push({ url: u, depth: Math.max(0, Number((row && row.depth) || 0)) });
  }
  let queue = seeded.length ? seeded : [{ url: start, depth: 0 }];
  const pages = [];
  const offerings = [];
  const images = [];
  const notes = [];

  // ── the site's own URL list.
  //
  // Only on a FRESH crawl. A resumed batch arrives with the frontier the first
  // batch persisted, which already carries whatever the sitemap contributed;
  // re-reading it would re-queue pages batch one has visited and spend the
  // budget arriving where it started.
  //
  // Seeded at depth 1, which is the truthful model: the sitemap asserts these
  // pages belong to the site, exactly as a link from the home page would, so
  // they expand onward under the same `maxDepth` a linked page gets. Depth 0
  // would hand them a level of expansion the home page itself does not have.
  let sitemap = { found: false, checked: false, sources: [], declared: 0, seeded: 0 };
  if (!seeded.length && o.sitemap !== false) {
    const sm = await readSitemaps(origin, robotsRead.sitemaps, assetFetch, { hosts, timeoutMs: o.perRequestMs });
    notes.push(...sm.notes);
    let added = 0;
    for (const u of sm.urls) {
      if (seen.has(u)) continue;
      if (!inScope(u, hosts)) continue;
      if (SKIP_EXT.test(u) || SKIP_PATH.test(u)) continue;
      seen.add(u);
      queue.push({ url: u, depth: 1 });
      added += 1;
    }
    sitemap = {
      found: sm.found,
      checked: true,
      // "robots.txt named these" and "we tried the conventional location" are
      // different levels of evidence and are not flattened into one boolean.
      from: sm.guessed ? 'conventional /sitemap.xml' : 'robots.txt Sitemap directive',
      sources: sm.sources,
      declared: sm.urls.length,
      seeded: added,
    };
  }

  while (queue.length && pages.length < o.maxPages && Date.now() < deadline) {
    const { url, depth } = queue.shift();
    if (skip && skip(url)) continue;
    if (blockedByRobots(url)) { notes.push(`skipped (robots.txt): ${url}`); continue; }

    const r = await fetchImpl(url, o.perRequestMs);
    if (!r || !r.ok || !r.body) { notes.push(`unreachable (${(r && r.status) || 0}): ${url}`); continue; }

    // A page reached by a redirect OFF-ORIGIN is off-origin.
    //
    // Requests follow redirects, so an in-scope URL can answer with another
    // company's page: a retired /partners path 301'd to a partner's site, a
    // regional gate bouncing to a marketplace, a link-shortener on the brand's
    // own domain. Scope was checked on the URL we ASKED for and never on the
    // one that answered, so that body was parsed, its products taken as this
    // brand's and its pages filed into this brand's knowledge base - the single
    // worst thing this crawler can do, arrived at without following a single
    // off-site link.
    const landed = r.url || url;
    if (landed !== url && !inScope(landed, hosts)) {
      notes.push(`skipped (redirected off-origin): ${url} -> ${landed}`);
      continue;
    }

    pages.push(url);
    if (typeof o.onPage === 'function') {
      try { o.onPage(r.body, r.url || url, depth); }
      catch (e) { notes.push(`observer failed on ${url}: ${(e && e.message) || e}`); }
    }
    const got = extract(r.body, r.url || url, hosts);
    offerings.push(...got.offerings);
    images.push(...got.images);

    if (depth < o.maxDepth) {
      for (const link of linksFrom(r.body, r.url || url, hosts)) {
        if (seen.has(link)) continue;
        seen.add(link);
        if (skip && skip(link)) continue;
        queue.push({ url: link, depth: depth + 1 });
      }
      // Reordering only. Array.prototype.sort is stable, so equal ranks keep
      // their FIFO order and a caller with no `rank` gets the same traversal
      // it always got.
      if (typeof o.rank === 'function') {
        queue.sort((a, b) => (Number(o.rank(b.url, b.depth)) || 0) - (Number(o.rank(a.url, a.depth)) || 0));
      }
    }
  }

  // De-duplicate on identity, keeping the first sighting and its attribution.
  const dedupe = (rows, key) => {
    const out = [], seenKey = new Set();
    for (const r of rows) {
      const k = key(r);
      if (!k || seenKey.has(k)) continue;
      seenKey.add(k); out.push(r);
    }
    return out;
  };

  const stopped = Date.now() >= deadline ? 'time_box'
    : pages.length >= o.maxPages ? 'page_limit' : 'exhausted';

  return {
    ok: true,
    start, hosts: [...hosts],
    pages, pages_visited: pages.length, stopped,
    // What the site declared about its own URLs, and what that contributed.
    // `found:false` after `checked:true` means the site publishes no sitemap;
    // `checked:false` means this was a resumed batch that inherited a frontier.
    // Neither is "the site has no other pages", and they are not the same thing.
    sitemap,
    // What was still queued when the budget ran out. A caller that persists
    // this and feeds it back as `frontier` resumes exactly here; a caller that
    // ignores it behaves as it always did.
    frontier_remaining: queue.slice(0, 400),
    offerings: dedupe(offerings, (r) => `${r.kind}|${(r.url || '').toLowerCase()}|${r.name.toLowerCase()}`),
    images: dedupe(images, (r) => r.url.toLowerCase()),
    notes: notes.slice(0, 50),
    // Said out loud rather than implied: a crawl that stopped early has seen
    // part of the site, and a caller that treats it as the whole catalogue
    // would silently drop offerings.
    coverage_note: (stopped === 'exhausted'
      ? 'Every reachable page within the configured depth was visited.'
      : `Stopped on the ${stopped === 'time_box' ? 'time box' : 'page limit'} after ${pages.length} pages. This is a PARTIAL view of the site; raise maxPages or maxDepth, or re-run, before treating it as the full catalogue.`)
      // A page count means something different depending on where the URLs came
      // from. "40 of 40 pages" off a home-page walk and "40 of 812 the site
      // declares" are the same number and opposite statements about coverage,
      // and only the second one tells the operator to raise the budget.
      + (sitemap.found && sitemap.declared
        ? ` The site's own sitemap declares ${sitemap.declared} URL(s); ${sitemap.seeded} were in scope and queued, and ${pages.length} page(s) were read within the budget.`
        : (sitemap.checked ? ' The site publishes no sitemap this reader could read, so coverage is whatever its interlinked pages reach within the depth limit.' : '')),
  };
}

module.exports = {
  crawlSite, extract, linksFrom, allowedHosts, inScope, jsonLdBlocks, metaTags, DEFAULTS,
  robotsInfo, disallowedPaths, readSitemaps, locsFrom, isSitemapIndex, SITEMAP_LIMITS,
};
