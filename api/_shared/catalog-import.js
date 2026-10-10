'use strict';
/**
 * catalog-import.js — read a brand's WHOLE catalogue from its own store, say
 * exactly what was not read, and resume where an invocation ran out.
 * ---------------------------------------------------------------------------
 * Measured on 2026-10-10 against fixture stores served on 127.0.0.1 through the
 * shipped import paths (tests/catalog-import-complete.spec.js), BEFORE this
 * module existed:
 *
 *   a Shopify store of 2,600 products      2,499 read (a 10-page feed cap), every
 *                                          variant and all but one image per
 *                                          product dropped, no currency; the
 *                                          device kept 2,000; the generators saw
 *                                          500 (brand-catalog-server MAX_ROWS)
 *   Shopify, feed off, 60 in its sitemap   1 read
 *   WooCommerce, 300 in gzipped sitemaps   2 read
 *   a UK store under /en-gb/               40 rows filed under UK at US prices,
 *                                          currency unknown
 *   robots.txt disallowing 5 of 40         2 read, and a DISALLOWED page fetched
 *   a slow store, 150 products             1 read
 *   a store that 429s with Retry-After     0 read: "no usable product rows"
 *
 * Every one of those has the same root: the importer read whatever one request
 * or one crawl happened to reach, and reported the count as the catalogue.
 * The sitemaps and robots.txt were fetched through a fetcher that refused any
 * response that was not text/html, so every XML sitemap and every text/plain
 * robots.txt read as "absent" in production - a crawler that says it respects
 * robots.txt fetched a disallowed page.
 *
 * ── THE ROUTES, CHOSEN ON PURPOSE ────────────────────────────────────────────
 *   feed      Shopify's unauthenticated /products.json (the one feed this repo
 *             already calls), at limit=250, page after page until a page comes
 *             back EMPTY: a short page is not the end (Shopify pages by
 *             position and drops products that are not on the online store, so
 *             page 4 of 11 can be one short). Every variant and every image is
 *             kept. Skipped when the store declares another platform.
 *   sitemap   the site's own list of its URLs (robots.txt `Sitemap:` lines,
 *             else /sitemap.xml), index -> child -> urlset, gzipped children
 *             included, then each product page's JSON-LD Product /
 *             ProductGroup / Offer / AggregateOffer (or its OpenGraph product
 *             tags). Typed product sitemaps (Shopify's sitemap_products_*,
 *             WooCommerce's product-sitemap*) give the DECLARED count.
 *   crawl     only when the site publishes no sitemap: site-crawl.js over its
 *             interlinked pages, resumable through its own frontier.
 *
 * For any other platform no endpoint is called that its own public docs do not
 * give: WooCommerce's Store API, BigCommerce's GraphQL storefront and the rest
 * are NOT called. Sitemap + JSON-LD is what every one of them publishes.
 *
 * ── WHAT IS NEVER DONE ───────────────────────────────────────────────────────
 *   - a price, an image or a title that the store did not state is never
 *     filled: the row keeps null and the coverage names it with the marker
 *     `[DATA REQUIRED BEFORE LAUNCH: field, product, region]`;
 *   - a currency is never assumed: the feed carries none, so it is read from
 *     the store's own page for that market (`Shopify.currency.active`), and a
 *     store that does not publish it leaves the currency null and says so;
 *   - a region is never read from another region's store: a UK import reads the
 *     UK store the brand declared (regions[].store_url) or the one the site's
 *     own hreflang names, and says which;
 *   - a store is never read from ANOTHER BRAND'S site (2026-10-10): a region's
 *     store_url, an hreflang alternate or an asset host is used only when its
 *     registrable domain is the same brand as the website's, by the coherence
 *     rule's own ownership function (brand-coherence.js sameBrand). The live
 *     "DelhiChic" record (website delichic.co.in) carried an IN store_url on
 *     nike.in, and 734 of Nike's products were filed as its catalogue. A store
 *     on another site is not read and the coverage says so in a sentence;
 *   - the URL the person gave is the source: a record's store_url replaces it
 *     only when the URL given IS the brand's website (the default the wizard
 *     fills), never when the person typed another store;
 *   - robots.txt is honoured (RFC 9309: groups, Allow/Disallow, `*` and `$`,
 *     the longest match wins); a robots.txt that answers 5xx or not at all is
 *     "disallow everything" per RFC 9309 2.3.1.4, and nothing is read;
 *   - the user agent is this platform's own, never a borrowed one;
 *   - a Retry-After is obeyed; one longer than the time left stops the step
 *     with the place to resume, never a retry storm and never "no products".
 *
 * ── ONE INVOCATION IS NOT ALWAYS ENOUGH ──────────────────────────────────────
 * `step()` reads until its budget is spent and returns the rows it read plus a
 * `cursor` (null when the source is exhausted). The cursor is persisted on the
 * EXISTING row - `brand_workspaces.catalog_source.cursor` on the account path,
 * the device's catalogue entry for a phone sign-in - and the next call
 * (Continue import, or the daily cron) resumes from it. No new function, no
 * new cron: the same convergent shape as smart-brain-plan.prebuildAssets and
 * the context-pack queue.
 *
 * NOT a function file (api/_shared/ -> outside the Hobby 12-function cap).
 */

const zlib = require('zlib');
const crypto = require('crypto');
const crawl = require('./site-crawl.js');
const COH = require('./brand-coherence.js');

const USER_AGENT = crawl.DEFAULTS.userAgent;
const ROBOTS_TOKEN = 'lifecycleos-brandcrawler';

const LIMITS = {
  feedPageSize: 250,
  maxFeedPages: 400,          // 100,000 products: a stated ceiling, never a silent one
  maxProducts: 20000,         // per region per import run, every route
  stepBudgetMs: 55000,        // one interactive call's share of a 120 s function
  perRequestMs: 12000,
  pdpConcurrency: 6,
  maxRetries: 3,
  maxRetryAfterMs: 20000,
  maxSitemaps: 60,
  maxSitemapDepth: 3,         // index -> index -> urlset
  maxSitemapBytes: 52428800,  // 50 MiB uncompressed, the sitemaps.org per-file limit
  maxRedirects: 5,
  cursorVersion: 1,
};

const MARKER = (field, product, region) => {
  const parts = [field];
  if (product) parts.push(String(product).replace(/[[\]]/g, '').slice(0, 80));
  if (region) parts.push(String(region).toUpperCase());
  return `[DATA REQUIRED BEFORE LAUNCH: ${parts.join(', ')}]`;
};

/* ── small helpers ─────────────────────────────────────────────────────── */

const str = (v, max) => { const s = String(v == null ? '' : v).trim(); return max ? s.slice(0, max) : s; };
const num = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const httpAbs = (v, base) => {
  try {
    const u = new URL(String(v || ''), base || undefined);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '';
  } catch (_) { return ''; }
};
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The handle a store gives a product: the last segment of its own URL. */
function handleFromUrl(u) {
  try {
    const segs = new URL(u).pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1] || '';
    return decodeURIComponent(last).toLowerCase().replace(/\.(?:html?|php|aspx?)$/, '').slice(0, 200);
  } catch (_) { return ''; }
}

/** Market codes as a person writes them -> ISO country + the hreflang regions that name it. */
function regionCountry(region) {
  const r = String(region || '').toUpperCase();
  if (r === 'UK') return 'GB';
  return r;
}

/* ── the one door for every request ─────────────────────────────────────── */

const hdr = (r, name) => { try { return r && r.headers && typeof r.headers.get === 'function' ? r.headers.get(name) : null; } catch (_) { return null; } };

/**
 * GET a URL on the brand's own hosts. Redirects are followed by HAND, hop by
 * hop, and every hop is re-checked against the brand's scope and the SSRF
 * guard - a public host must not be able to bounce this onto an internal one,
 * and an in-scope path that 301s to another company's site is not this
 * brand's page. A gzipped body (by magic bytes) is inflated, bounded.
 */
async function getText(url, ctx, { accept, timeoutMs } = {}) {
  const guard = ctx.guard;
  let at = url;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    if (!crawl.inScope(at, ctx.hosts)) return { ok: false, status: 0, url: at, reason: 'off_scope' };
    try { await guard(at); } catch (e) { return { ok: false, status: 0, url: at, reason: 'private_address', error: e.message }; }
    const ctrl = new AbortController();
    const ms = Math.max(1000, Math.min(timeoutMs || LIMITS.perRequestMs, ctx.deadline - Date.now()));
    const timer = setTimeout(() => ctrl.abort(), ms);
    let r;
    try {
      r = await fetch(at, { method: 'GET', redirect: 'manual', signal: ctrl.signal, cache: 'no-store', headers: { 'User-Agent': USER_AGENT, Accept: accept || '*/*' } });
    } catch (e) {
      clearTimeout(timer);
      ctx.stats.requests += 1;
      return { ok: false, status: 0, url: at, reason: ctrl.signal.aborted ? 'timeout' : 'unreachable', error: String((e && e.message) || e) };
    }
    ctx.stats.requests += 1;
    if (r.status >= 300 && r.status < 400 && hdr(r, 'location')) {
      clearTimeout(timer);
      at = httpAbs(hdr(r, 'location'), at);
      if (!at) return { ok: false, status: r.status, url, reason: 'bad_redirect' };
      continue;
    }
    let buf;
    // Bytes when the response offers them (gzip is detected by its magic
    // bytes), else its text: the one fetch seam is also answered by minimal
    // Response-shaped objects.
    try { buf = typeof r.arrayBuffer === 'function' ? Buffer.from(await r.arrayBuffer()) : Buffer.from(String(await r.text()), 'utf8'); } catch (e) { clearTimeout(timer); return { ok: false, status: r.status, url: at, reason: ctrl.signal.aborted ? 'timeout' : 'unreachable' }; }
    clearTimeout(timer);
    if (buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b) {
      try { buf = zlib.gunzipSync(buf, { maxOutputLength: LIMITS.maxSitemapBytes }); }
      catch (_) { return { ok: false, status: r.status, url: at, reason: 'bad_gzip' }; }
    }
    return {
      ok: r.ok, status: r.status, url: at, body: buf.toString('utf8'),
      contentType: String(hdr(r, 'content-type') || ''),
      retryAfter: hdr(r, 'retry-after'),
    };
  }
  return { ok: false, status: 0, url: at, reason: 'too_many_redirects' };
}

/** Retry-After as milliseconds: delta-seconds or an HTTP-date. null when absent. */
function retryAfterMs(v, now) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - (now || Date.now())) : null;
}

/**
 * getText with the rate-limit contract: 429 and 503 wait what the server asked
 * (Retry-After outranks our arithmetic), else back off 1 s, 2 s, 4 s. A wait
 * the step cannot afford stops it with `rate_limited` so the cursor resumes
 * here later, instead of hammering the store or calling the catalogue empty.
 */
async function getPolite(url, ctx, opts) {
  for (let attempt = 0; ; attempt++) {
    const r = await getText(url, ctx, opts);
    if (r.status !== 429 && r.status !== 503) return r;
    ctx.stats.rate_limited += 1;
    const asked = retryAfterMs(r.retryAfter);
    const wait = asked != null ? asked : 1000 * Math.pow(2, attempt);
    const left = ctx.deadline - Date.now();
    if (attempt >= LIMITS.maxRetries || wait > LIMITS.maxRetryAfterMs || wait > left - 1000) {
      return Object.assign({}, r, { ok: false, reason: 'rate_limited', wait_ms: wait, retry_after: r.retryAfter || null });
    }
    ctx.stats.waited_ms += wait;
    await sleep(wait);
  }
}

/* ── robots.txt (RFC 9309) ─────────────────────────────────────────────── */

const { parseRobots, robotsAllows } = crawl;

/** robots.txt for one origin, cached on the context. */
async function robotsFor(origin, ctx) {
  if (ctx.robots[origin]) return ctx.robots[origin];
  const r = await getText(origin + '/robots.txt', ctx, { accept: 'text/plain' });
  let out;
  if (r.ok) {
    const sitemaps = [];
    for (const line of String(r.body || '').split(/\r?\n/)) {
      const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line.split('#')[0]);
      if (m) sitemaps.push(m[1]);
    }
    out = { read: true, status: r.status, rules: parseRobots(r.body), sitemaps };
  } else if (r.status >= 400 && r.status < 500) {
    // RFC 9309 2.3.1.3: "unavailable" - the crawler may access any resource.
    out = { read: false, status: r.status, rules: [], sitemaps: [] };
  } else {
    // RFC 9309 2.3.1.4: "unreachable" - assume complete disallow.
    out = { read: false, status: r.status || 0, rules: 'all', sitemaps: [], unreachable: true, reason: r.reason || 'unreachable' };
  }
  ctx.robots[origin] = out;
  return out;
}

async function allowed(url, ctx) {
  let origin;
  try { origin = new URL(url).origin; } catch (_) { return false; }
  const rb = await robotsFor(origin, ctx);
  return robotsAllows(rb.rules, url);
}

/* ── which store, for which market ─────────────────────────────────────── */

/**
 * The store to read for this market, and how that was decided:
 *   1. the brand's own region row for this market names a store_url (only when
 *      the URL given is the brand's website, and only on the brand's own site);
 *   2. the start page's hreflang names an alternate for this market's country,
 *      on one of the brand's own hosts;
 *   3. the URL the operator gave.
 * `identity` is the website's registrable domain (identityOf), or '' when the
 * record names no website - then nothing is judged, as before. A store_url on
 * another brand's site is pushed onto `foreign` and not read.
 */
function regionalBase({ url, region, brand, homeHtml, hosts, identity, foreign }) {
  const want = regionCountry(region);
  const own = (u) => !identity || COH.sameBrand(COH.registrableDomain(COH.hostOf(u)), identity);
  const site = brand && brand.website ? httpAbs(/^https?:/i.test(brand.website) ? brand.website : `https://${brand.website}`) : '';
  const givenIsWebsite = !site || hostOf(url) === hostOf(site);
  for (const r of (brand && Array.isArray(brand.regions) ? brand.regions : [])) {
    const code = regionCountry(r && (r.code || r.region));
    if (code && code === want && r.store_url) {
      const u = httpAbs(/^https?:/i.test(r.store_url) ? r.store_url : `https://${r.store_url}`);
      if (!u) continue;
      if (!own(u)) {
        if (foreign) foreign.push({ code: String(r.code || region).toUpperCase(), url: u.replace(/\/$/, ''), domain: COH.registrableDomain(COH.hostOf(u)) });
        continue;
      }
      if (givenIsWebsite && crawl.inScope(u, hosts)) return { base: u.replace(/\/$/, ''), from: `the ${String(r.code || region).toUpperCase()} store URL on the brand's own record` };
    }
  }
  if (homeHtml && want && want !== 'GLOBAL') {
    for (const m of String(homeHtml).matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0];
      if (!/rel=["']?alternate/i.test(tag)) continue;
      const hl = (/hreflang=["']([^"']+)["']/i.exec(tag) || [])[1] || '';
      const href = (/href=["']([^"']+)["']/i.exec(tag) || [])[1] || '';
      const country = hl.split('-')[1];
      if (!country || country.toUpperCase() !== want) continue;
      const u = httpAbs(href, url);
      if (u && own(u) && crawl.inScope(u, hosts)) return { base: u.replace(/\/$/, ''), from: `the site's own hreflang="${hl}" alternate` };
    }
  }
  return { base: url.replace(/\/$/, ''), from: 'the URL given' };
}

/** The website's registrable domain - the identity a store must share - or ''. */
function identityOf(brand) {
  const w = brand && brand.website ? String(brand.website) : '';
  return w ? COH.registrableDomain(COH.hostOf(w)) : '';
}

/**
 * The scope a read may cover, without another brand's site: a region
 * store_url on another site is dropped, and so is an asset host that is the
 * SAME brand as such a store (nike.com beside a nike.in store) - another
 * brand's site, not a CDN. A brand CDN under another name (no foreign store
 * beside it) is kept. Returns { scope, foreign: [{ code, url, domain }], identity }.
 */
function ownScope(brand) {
  const scope = Object.assign({}, brand || {});
  const identity = identityOf(scope);
  const foreign = [];
  if (!identity) return { scope, foreign, identity };
  scope.regions = (Array.isArray(scope.regions) ? scope.regions : []).map((r) => {
    if (!r || !r.store_url) return r;
    const u = httpAbs(/^https?:/i.test(r.store_url) ? r.store_url : `https://${r.store_url}`);
    const d = u ? COH.registrableDomain(COH.hostOf(u)) : '';
    if (!d || COH.sameBrand(d, identity)) return r;
    foreign.push({ code: String(r.code || r.region || '').toUpperCase(), url: u.replace(/\/$/, ''), domain: d });
    const copy = Object.assign({}, r);
    delete copy.store_url;
    return copy;
  });
  if (foreign.length && Array.isArray(scope.asset_hosts)) {
    scope.asset_hosts = scope.asset_hosts.filter((h) => {
      const d = COH.registrableDomain(COH.hostOf('https://' + String(h || '').replace(/^https?:\/\//, '')));
      return !foreign.some((f) => COH.sameBrand(f.domain, d));
    });
  }
  return { scope, foreign, identity };
}

/** The sentence a store on another site gets, wherever it is reported. */
function foreignStoreSentence(f, identity) {
  return `The ${f.code || 'region'} store URL on this brand's record, ${f.url}, is on another site (${f.domain}), not this brand's website (${identity}), so it was not read; the brand's own site was read instead.`;
}

/** The currency a Shopify storefront page declares it is pricing this market in. */
function declaredCurrency(html) {
  const m = /Shopify\s*\.\s*currency\s*=\s*\{[^}]*["']active["']\s*:\s*["']([A-Za-z]{3})["']/.exec(String(html || ''));
  return m ? m[1].toUpperCase() : '';
}

/* ── rows ───────────────────────────────────────────────────────────────── */

/** One Shopify /products.json product -> one row, every variant and image kept. */
function rowFromFeed(p, { region, base, currency, feedUrl }) {
  const title = str(p && p.title, 300);
  if (!title) return null;
  const variants = (Array.isArray(p.variants) ? p.variants : []).slice(0, 100).map((v) => ({
    id: v && v.id != null ? String(v.id) : null,
    sku: str(v && v.sku, 120) || null,
    title: str(v && v.title, 120) || null,
    price: num(v && v.price),
    compare_at: num(v && v.compare_at_price),
    available: typeof (v && v.available) === 'boolean' ? v.available : null,
  }));
  const images = (Array.isArray(p.images) ? p.images : []).map((im) => httpAbs(im && (im.src || im.url))).filter(Boolean).slice(0, 30);
  const first = variants[0] || {};
  const handle = str(p.handle, 200) || null;
  const anyAvail = variants.some((v) => v.available === true) ? true : (variants.length && variants.every((v) => v.available === false) ? false : null);
  return {
    region, title, handle,
    sku: str(p.sku, 120) || (p.id != null ? String(p.id) : null),
    description: str(p.body_html, 4000) || null,
    product_type: str(p.product_type, 120) || null,
    collections: [],
    price: first.price != null ? first.price : null,
    compare_at: first.compare_at != null ? first.compare_at : null,
    currency: currency || null,
    image_url: images[0] || null,
    image_urls: images,
    variants,
    product_url: handle ? `${base}/products/${handle}` : null,
    in_stock: anyAvail,
    tags: (Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',')).map((t) => str(t, 60)).filter(Boolean).slice(0, 30),
    source: 'shopify_public',
    source_url: feedUrl,
    raw: { id: p.id, handle: p.handle, vendor: p.vendor || null, updated_at: p.updated_at || null, options: p.options || [] },
  };
}

const typeIs = (node, t) => {
  const v = node && node['@type'];
  return (Array.isArray(v) ? v : [v]).some((x) => String(x || '').toLowerCase() === t);
};

function imagesOf(v, pageUrl) {
  const out = [];
  const add = (x) => {
    if (!x) return;
    if (typeof x === 'string') { const u = httpAbs(x, pageUrl); if (u) out.push(u); return; }
    if (Array.isArray(x)) { x.forEach(add); return; }
    if (typeof x === 'object') add(x.url || x.contentUrl || '');
  };
  add(v);
  return [...new Set(out)].slice(0, 30);
}

function offersOf(node) {
  const o = node && node.offers;
  return (Array.isArray(o) ? o : (o ? [o] : [])).filter((x) => x && typeof x === 'object');
}

function priceOfOffer(o) {
  if (!o) return { price: null, currency: null, compare_at: null, available: null };
  const price = o.price != null ? num(o.price) : (o.lowPrice != null ? num(o.lowPrice) : null);
  let currency = str(o.priceCurrency, 8).toUpperCase() || null;
  let compare = null;
  const specs = Array.isArray(o.priceSpecification) ? o.priceSpecification : (o.priceSpecification ? [o.priceSpecification] : []);
  for (const s of specs) {
    if (!s || typeof s !== 'object') continue;
    const kind = String(s.priceType || '').toLowerCase();
    if (/listprice|strikethroughprice|msrp/.test(kind)) compare = num(s.price);
    if (!currency && s.priceCurrency) currency = str(s.priceCurrency, 8).toUpperCase();
  }
  const av = String(o.availability || '').toLowerCase();
  return { price, currency, compare_at: compare, available: av ? /instock|limitedavailability|preorder|presale/.test(av) : null };
}

/**
 * One product page -> its declared product, or null. JSON-LD Product or
 * ProductGroup (wherever it sits: bare, an array, an @graph), else the page's
 * OpenGraph product tags. Never a price read out of prose.
 */
function rowFromPage(html, pageUrl, { region, source }) {
  let node = null;
  for (const n of crawl.jsonLdBlocks(html)) {
    if (typeIs(n, 'productgroup')) { node = n; break; }
    if (typeIs(n, 'product') && !node) node = n;
  }
  if (node) {
    const title = str(node.name, 300);
    if (!title) return { skip: 'no_title' };
    const variants = [];
    for (const v of (Array.isArray(node.hasVariant) ? node.hasVariant : [])) {
      if (!v || typeof v !== 'object') continue;
      const pr = priceOfOffer(offersOf(v)[0]);
      variants.push({ id: null, sku: str(v.sku, 120) || null, title: str(v.name, 120) || null, price: pr.price, compare_at: pr.compare_at, available: pr.available, currency: pr.currency });
    }
    const offers = offersOf(node);
    if (!variants.length && offers.length > 1) {
      for (const o of offers.slice(0, 100)) {
        const pr = priceOfOffer(o);
        variants.push({ id: null, sku: str(o.sku, 120) || null, title: str(o.name, 120) || null, price: pr.price, compare_at: pr.compare_at, available: pr.available, currency: pr.currency });
      }
    }
    const head = offers.length ? priceOfOffer(offers[0]) : (variants[0] || { price: null, currency: null, compare_at: null, available: null });
    const images = imagesOf(node.image, pageUrl);
    if (!images.length) for (const v of (Array.isArray(node.hasVariant) ? node.hasVariant : [])) images.push(...imagesOf(v && v.image, pageUrl));
    const declaredUrl = httpAbs(node.url, pageUrl);
    const anyAvail = variants.length
      ? (variants.some((v) => v.available === true) ? true : (variants.every((v) => v.available === false) ? false : null))
      : head.available;
    return {
      row: {
        region, title,
        handle: handleFromUrl(pageUrl) || null,
        sku: str(node.sku || node.productGroupID || node.mpn, 120) || null,
        description: str(node.description, 4000) || null,
        product_type: str(typeof node.category === 'string' ? node.category : '', 120) || null,
        collections: [],
        price: head.price != null ? head.price : null,
        compare_at: head.compare_at != null ? head.compare_at : null,
        currency: head.currency || (variants[0] && variants[0].currency) || null,
        image_url: images[0] || null,
        image_urls: [...new Set(images)].slice(0, 30),
        variants: variants.map((v) => ({ id: v.id, sku: v.sku, title: v.title, price: v.price, compare_at: v.compare_at, available: v.available })),
        product_url: declaredUrl && hostOf(declaredUrl) === hostOf(pageUrl) ? declaredUrl : pageUrl,
        in_stock: anyAvail,
        tags: [],
        source,
        source_url: pageUrl,
        raw: { declared: 'json-ld', type: typeIs(node, 'productgroup') ? 'ProductGroup' : 'Product' },
      },
    };
  }
  const meta = crawl.metaTags(html);
  const ogType = String(meta['og:type'] || '').toLowerCase();
  if (ogType.includes('product') && meta['og:title']) {
    const img = httpAbs(meta['og:image'], pageUrl);
    return {
      row: {
        region, title: str(meta['og:title'], 300), handle: handleFromUrl(pageUrl) || null, sku: null,
        description: str(meta['og:description'], 4000) || null, product_type: null, collections: [],
        price: num(meta['product:price:amount'] || meta['og:price:amount']),
        compare_at: null,
        currency: str(meta['product:price:currency'] || meta['og:price:currency'], 8).toUpperCase() || null,
        image_url: img || null, image_urls: img ? [img] : [], variants: [],
        product_url: pageUrl, in_stock: null, tags: [], source, source_url: pageUrl,
        raw: { declared: 'opengraph' },
      },
    };
  }
  return { skip: 'no_product_declared' };
}

/* ── sitemaps ───────────────────────────────────────────────────────────── */

const PRODUCT_SITEMAP = /product/i;

/**
 * Every URL the site's own sitemaps declare, split into product URLs (from a
 * sitemap whose own name says it lists products) and the rest.
 */
async function readSitemaps(origin, declared, ctx) {
  const queue = (declared && declared.length ? declared : [origin + '/sitemap.xml']).map((u) => ({ url: httpAbs(u, origin), depth: 0, typed: PRODUCT_SITEMAP.test(u) }));
  const seen = new Set();
  const products = [], other = [], sources = [], notes = [];
  let fetched = 0;
  while (queue.length && fetched < LIMITS.maxSitemaps && Date.now() < ctx.deadline) {
    const sm = queue.shift();
    if (!sm.url || seen.has(sm.url)) continue;
    seen.add(sm.url);
    if (!crawl.inScope(sm.url, ctx.hosts)) { notes.push(`A sitemap on another host was not read: ${sm.url}`); continue; }
    if (!(await allowed(sm.url, ctx))) { notes.push(`robots.txt disallows the sitemap ${sm.url}, so it was not read.`); continue; }
    fetched += 1;
    const r = await getPolite(sm.url, ctx, { accept: 'application/xml,text/xml,*/*' });
    if (!r.ok) {
      if (declared && declared.length) notes.push(`The sitemap ${sm.url} did not answer (${r.status || r.reason}).`);
      continue;
    }
    const locs = crawl.locsFrom(r.body);
    if (crawl.isSitemapIndex(r.body)) {
      sources.push({ url: sm.url, kind: 'index', declared: locs.length });
      if (sm.depth + 1 >= LIMITS.maxSitemapDepth) { notes.push(`The sitemap index ${sm.url} nests deeper than ${LIMITS.maxSitemapDepth} levels; its children were not read.`); continue; }
      for (const c of locs) queue.push({ url: httpAbs(c, sm.url), depth: sm.depth + 1, typed: PRODUCT_SITEMAP.test(c) });
      continue;
    }
    sources.push({ url: sm.url, kind: 'urlset', declared: locs.length, products: sm.typed });
    for (const loc of locs) {
      const u = httpAbs(loc, sm.url);
      if (!u) continue;
      (sm.typed ? products : other).push(u);
    }
  }
  if (queue.length) notes.push(`${queue.length} more sitemap(s) were declared and not read (limit ${LIMITS.maxSitemaps} per run).`);
  return { found: sources.length > 0, sources, products: [...new Set(products)], other: [...new Set(other)], notes };
}

/* ── the cursor and the run ─────────────────────────────────────────────── */

function freshStats() {
  return {
    found: 0, by_source: { feed: 0, sitemap_jsonld: 0, crawl: 0 },
    skipped: { robots: 0, off_scope: 0, no_product_declared: 0, no_title: 0, unreachable: 0, timed_out: 0, duplicate: 0, cap: 0 },
    missing: { price: 0, image: 0, currency: 0 },
    missing_examples: [],
    robots_examples: [],
    unreachable_examples: [],
    requests: 0, rate_limited: 0, waited_ms: 0, feed_pages: 0, steps: 0,
  };
}

/** Validate a cursor that round-tripped through a database or a browser. */
function readCursor(c, opts) {
  return cursorProblem(c, opts) ? null : c;
}
/**
 * Why a cursor may NOT be resumed, in a sentence, or '' when it may. A cursor
 * is a place in ONE source: resuming it for another URL, another market, or a
 * store on another brand's site would keep reading the wrong store (the live
 * record: a store_url corrected to the brand's own site still resumed nike.in
 * at "URL 439 of 2430").
 */
function cursorProblem(c, { region, url, identity } = {}) {
  if (!c || typeof c !== 'object' || c.v !== LIMITS.cursorVersion) return 'it was written by another version of this importer';
  if (String(c.region || '') !== String(region || '')) return `it reads market ${String(c.region || '').toUpperCase() || 'unset'}, not ${String(region || '').toUpperCase() || 'unset'}`;
  if (!['feed', 'sitemap', 'crawl'].includes(c.route)) return 'it holds no place to resume from';
  if (url && c.start && hostOf(c.start) !== hostOf(url)) return `it was reading ${c.start}, and this import asks for ${String(url).replace(/\/$/, '')}`;
  if (identity && c.base && !COH.sameBrand(COH.registrableDomain(COH.hostOf(c.base)), identity)) return `it was reading ${c.base}, which is on another site (${COH.registrableDomain(COH.hostOf(c.base))}), not this brand's website (${identity})`;
  return '';
}

function noteMissing(row, stats) {
  const add = (field) => {
    stats.missing[field === 'product image' ? 'image' : field] += 1;
    if (stats.missing_examples.length < 20) stats.missing_examples.push(MARKER(field, row.title, row.region));
  };
  if (row.price == null) add('price');
  if (!row.image_url) add('product image');
  if (row.price != null && !row.currency) add('currency');
}

/**
 * Advance one import run by one invocation.
 *
 *   url        the store URL the operator gave (or the brand's website)
 *   region     the market these rows are filed under (lower case)
 *   brand      { website, regions[], asset_hosts[] } - the scope, as the row gives it
 *   cursor     a previous step's cursor, to resume; null to start a run
 *   guard      async (url) => void, throwing for a private/internal address
 *   budgetMs   this step's share of the invocation
 *
 * Returns { rows, cursor, complete, coverage, storefront, base, run }.
 */
async function step({ url, region, brand, cursor, guard, budgetMs, now }) {
  const started = now || Date.now();
  const reg = String(region || '').toLowerCase();
  // Another brand's site never joins the scope (2026-10-10): a region store or
  // asset host on another registrable domain is dropped here and named in the
  // coverage. A record with no website keeps its scope as given.
  const own = ownScope(brand);
  const scope = own.scope;
  if (!scope.website) scope.website = url;
  const hosts = crawl.allowedHosts(scope);
  if (!hosts.size) hosts.add(hostOf(url));
  const prev = readCursor(cursor, { region: reg, url, identity: own.identity });
  const run = (prev && prev.run) || crypto.randomUUID();
  const stats = prev && prev.stats ? JSON.parse(JSON.stringify(prev.stats)) : freshStats();
  stats.steps += 1;
  stats.requests = 0;
  const ctx = { hosts, robots: {}, deadline: started + (budgetMs || LIMITS.stepBudgetMs), stats, guard: guard || (async () => {}) };
  const rows = [];
  const seen = new Set((prev && prev.seen_keys) || []);
  const keep = (row) => {
    const key = `${row.handle || ''}|${(row.product_url || '').toLowerCase()}`;
    const hkey = `h:${row.handle || ''}`;
    if ((row.handle && seen.has(hkey)) || seen.has(key)) { stats.skipped.duplicate += 1; return false; }
    if (stats.found >= LIMITS.maxProducts) { stats.skipped.cap += 1; return false; }
    if (row.handle) seen.add(hkey);
    seen.add(key);
    noteMissing(row, stats);
    rows.push(row);
    stats.found += 1;
    return true;
  };

  let st = prev ? Object.assign({}, prev) : null;
  let storefront = (prev && prev.storefront) || null;
  let stopped = null;

  if (!st) {
    // ── a fresh run: decide the store, the platform and the route.
    const start = url.replace(/\/$/, '');
    const robotsHome = await robotsFor(new URL(start).origin, ctx);
    if (robotsHome.rules === 'all') {
      stopped = { reason: 'robots_unreachable', at: `${new URL(start).origin}/robots.txt answered ${robotsHome.status || robotsHome.reason}` };
      st = { v: LIMITS.cursorVersion, run, region: reg, start, base: start, base_from: 'the URL given', route: 'feed', page: 1, declared: null, currency: '', storefront: null };
    } else {
      let homeHtml = '';
      if (await allowed(start, ctx)) {
        const home = await getPolite(start, ctx, { accept: 'text/html' });
        if (home.ok) homeHtml = home.body;
      }
      // The ORIGINAL brand (not the trimmed scope), so a store on another site
      // is seen, skipped and named rather than silently absent.
      const foreignStores = own.foreign.slice();
      const rb = regionalBase({ url: start, region: reg, brand: Object.assign({}, brand || {}, { website: scope.website }), homeHtml, hosts, identity: own.identity, foreign: [] });
      let baseHtml = homeHtml;
      if (rb.base !== start && await allowed(rb.base, ctx)) {
        const page = await getPolite(rb.base, ctx, { accept: 'text/html' });
        baseHtml = page.ok ? page.body : '';
      }
      const sf = require('./storefront-detect.js').detectStorefront(baseHtml ? [[rb.base, baseHtml]] : []);
      storefront = sf && sf.detected ? { id: sf.platform.id, name: sf.platform.name, why: sf.platform.why, confidence: sf.platform.confidence, source_url: sf.platform.source_url, route: sf.catalog_route.kind, route_note: sf.catalog_route.note } : null;
      // The site's own declaration of its product URLs: the denominator.
      const origin = new URL(rb.base).origin;
      const rbase = await robotsFor(origin, ctx);
      const sm = await readSitemaps(origin, rbase.sitemaps, ctx);
      const prefix = new URL(rb.base).pathname.replace(/\/$/, '');
      const inBase = (u) => { try { return !prefix || new URL(u).pathname.startsWith(prefix + '/'); } catch (_) { return false; } };
      const typed = sm.products.filter(inBase);
      const candidates = typed.length ? typed : sm.other.filter((u) => inBase(u) && u.replace(/\/$/, '') !== rb.base);
      st = {
        v: LIMITS.cursorVersion, run, region: reg, start, base: rb.base, base_from: rb.from,
        identity: own.identity || '',
        foreign_stores: foreignStores.filter((f) => regionCountry(f.code) === regionCountry(reg)).slice(0, 5),
        currency: declaredCurrency(baseHtml),
        storefront,
        sitemap: { found: sm.found, sources: sm.sources.slice(0, 40), notes: sm.notes.slice(0, 20), typed: typed.length > 0 },
        declared: sm.found ? { count: typed.length || null, urls: candidates.length, by: typed.length ? 'the site\'s product sitemaps' : 'the site\'s sitemaps (they do not say which URLs are products)' } : null,
        route: storefront && storefront.id && storefront.id !== 'shopify' ? (sm.found ? 'sitemap' : 'crawl') : 'feed',
        page: 1,
        pending: candidates.slice(0, LIMITS.maxProducts * 2),
        pos: 0,
      };
      if (candidates.length > LIMITS.maxProducts * 2) stats.skipped.cap += candidates.length - LIMITS.maxProducts * 2;
    }
  }

  // ── the feed.
  if (!stopped && st.route === 'feed') {
    const feedPath = `${st.base}/products.json`;
    if (!(await allowed(feedPath, ctx))) {
      st.feed_refused = 'robots';
      st.route = st.sitemap && st.sitemap.found ? 'sitemap' : 'crawl';
    } else {
      while (Date.now() < ctx.deadline - 2000) {
        if (st.page > LIMITS.maxFeedPages) { stats.skipped.cap += 1; st.route = 'done'; st.feed_cap = true; break; }
        const feedUrl = `${feedPath}?limit=${LIMITS.feedPageSize}&page=${st.page}`;
        const r = await getPolite(feedUrl, ctx, { accept: 'application/json' });
        if (r.reason === 'rate_limited') { stopped = { reason: 'rate_limited', at: `feed page ${st.page}`, retry_after: r.retry_after, wait_ms: r.wait_ms }; break; }
        if (r.reason === 'timeout') { stopped = { reason: 'timeout', at: `feed page ${st.page}` }; break; }
        let list = null;
        if (r.ok) { try { const j = JSON.parse(r.body); list = Array.isArray(j && j.products) ? j.products : null; } catch (_) { list = null; } }
        if (!list) {
          if (st.page === 1) {
            // No feed here: the store has it off, or it is not a Shopify store.
            st.feed_refused = r.ok ? 'not_a_feed' : `answered ${r.status || r.reason}`;
            st.route = st.sitemap && st.sitemap.found ? 'sitemap' : 'crawl';
            break;
          }
          stopped = { reason: 'unreachable', at: `feed page ${st.page} (${r.status || r.reason})` };
          break;
        }
        if (!list.length) { st.route = 'done'; break; }   // an EMPTY page is the end; a short one is not
        stats.feed_pages += 1;
        if (st.page === 1) st.pending = [];               // the feed answers: the sitemap list is only the denominator now
        for (const p of list) {
          const row = rowFromFeed(p, { region: reg, base: st.base, currency: st.currency, feedUrl });
          if (!row) { stats.skipped.no_title += 1; continue; }
          if (keep(row)) stats.by_source.feed += 1;
        }
        st.page += 1;
      }
      if (!stopped && st.route === 'feed') stopped = { reason: 'time', at: `feed page ${st.page}` };
    }
  }

  // ── the sitemap's product pages.
  if (!stopped && st.route === 'sitemap') {
    const pending = Array.isArray(st.pending) ? st.pending : [];
    while (st.pos < pending.length && Date.now() < ctx.deadline - 1500) {
      const batch = pending.slice(st.pos, st.pos + LIMITS.pdpConcurrency);
      const results = await Promise.all(batch.map(async (u) => {
        if (!crawl.inScope(u, hosts)) return { u, skip: 'off_scope' };
        if (!(await allowed(u, ctx))) return { u, skip: 'robots' };
        const r = await getPolite(u, ctx, { accept: 'text/html' });
        if (r.reason === 'rate_limited') return { u, stop: { reason: 'rate_limited', retry_after: r.retry_after, wait_ms: r.wait_ms } };
        if (r.reason === 'timeout') return { u, stop: { reason: 'timeout' } };
        if (!r.ok) return { u, skip: 'unreachable', status: r.status || r.reason };
        if (r.url !== u && !crawl.inScope(r.url, hosts)) return { u, skip: 'off_scope' };
        return Object.assign({ u }, rowFromPage(r.body, r.url, { region: reg, source: 'sitemap_jsonld' }));
      }));
      let halt = null, advanced = 0;
      for (const x of results) {
        if (x.stop) { halt = Object.assign({ at: `URL ${st.pos + advanced + 1} of ${pending.length}` }, x.stop); break; }
        advanced += 1;
        if (x.skip) {
          stats.skipped[x.skip] = (stats.skipped[x.skip] || 0) + 1;
          if (x.skip === 'robots' && stats.robots_examples.length < 10) stats.robots_examples.push(x.u);
          if (x.skip === 'unreachable' && stats.unreachable_examples.length < 10) stats.unreachable_examples.push(`${x.u} (${x.status})`);
          continue;
        }
        if (x.row && keep(x.row)) stats.by_source.sitemap_jsonld += 1;
      }
      st.pos += advanced;
      if (halt) { stopped = halt; break; }
    }
    if (!stopped) {
      if (st.pos >= pending.length) st.route = 'done';
      else stopped = { reason: 'time', at: `URL ${st.pos + 1} of ${pending.length}` };
    }
  }

  // ── no sitemap: the interlinked pages, resumable.
  if (!stopped && st.route === 'crawl') {
    const visited = new Set(st.visited || []);
    const left = Math.max(2000, ctx.deadline - Date.now() - 1000);
    const out = await crawl.crawlSite(st.base, {
      brand: Object.assign({}, scope, { website: st.base }),
      totalMs: left, maxPages: 400, maxDepth: 4, perRequestMs: LIMITS.perRequestMs,
      frontier: Array.isArray(st.frontier) && st.frontier.length ? st.frontier : undefined,
      skip: (u) => visited.has(u),
      sitemap: false,
      fetchImpl: async (u) => {
        if (!(await allowed(u, ctx))) { stats.skipped.robots += 1; if (stats.robots_examples.length < 10) stats.robots_examples.push(u); return { ok: false, status: 0, body: '' }; }
        const r = await getPolite(u, ctx, { accept: 'text/html' });
        if (r.ok && /html/i.test(r.contentType || 'text/html')) return { ok: true, status: r.status, body: r.body, url: r.url };
        return { ok: false, status: r.status || 0, body: '' };
      },
      onPage: (html, pageUrl) => {
        visited.add(pageUrl);
        const got = rowFromPage(html, pageUrl, { region: reg, source: 'site_crawl' });
        if (got.row && keep(got.row)) stats.by_source.crawl += 1;
      },
    });
    st.visited = [...visited].slice(-3000);
    st.frontier = (out.frontier_remaining || []).slice(0, 400);
    if (out.stopped === 'exhausted' || !st.frontier.length) st.route = 'done';
    else stopped = { reason: 'time', at: `${visited.size} pages read, ${st.frontier.length} queued` };
  }

  const complete = st.route === 'done';
  st.seen_keys = [...seen].slice(-(LIMITS.maxProducts * 2));
  st.stats = stats;
  const coverage = coverageOf(st, stats, { complete, stopped, region: reg });
  return {
    rows, run, base: st.base, storefront,
    complete,
    cursor: complete ? null : st,
    coverage,
  };
}

/* ── coverage, in sentences ─────────────────────────────────────────────── */

function plural(n, one, many) { return `${n.toLocaleString('en-US')} ${n === 1 ? one : (many || one + 's')}`; }

function coverageOf(st, stats, { complete, stopped, region }) {
  const s = [];
  const R = String(region || '').toUpperCase();
  const declared = st.declared && st.declared.count;
  const found = stats.found;
  if (declared) s.push(`Found ${found.toLocaleString('en-US')} of the ${plural(declared, 'product')} the site declares in ${st.declared.by}.`);
  else if (st.declared && st.declared.urls) s.push(`Found ${plural(found, 'product')}. ${st.declared.by.charAt(0).toUpperCase() + st.declared.by.slice(1)} list ${plural(st.declared.urls, 'URL')}, so no product total is declared to compare against.`);
  else s.push(`Found ${plural(found, 'product')}. The site publishes no sitemap this importer could read, so it declares no total to compare against.`);
  const src = [];
  if (stats.by_source.feed) src.push(`${stats.by_source.feed.toLocaleString('en-US')} from the store's product feed (/products.json, ${plural(stats.feed_pages, 'page')})`);
  if (stats.by_source.sitemap_jsonld) src.push(`${stats.by_source.sitemap_jsonld.toLocaleString('en-US')} from product pages listed in its sitemap (their JSON-LD)`);
  if (stats.by_source.crawl) src.push(`${stats.by_source.crawl.toLocaleString('en-US')} from crawling its linked pages`);
  if (src.length) s.push(`Source: ${src.join('; ')}.`);
  s.push(`Market ${R || 'unset'}: read from ${st.base} (${st.base_from})${st.currency ? `, priced in ${st.currency} as that storefront declares` : ''}.`);
  for (const f of (Array.isArray(st.foreign_stores) ? st.foreign_stores : [])) s.push(foreignStoreSentence(f, st.identity));
  if (st.feed_refused === 'robots') s.push('robots.txt disallows the product feed, so it was not read.');
  else if (st.feed_refused && st.storefront && st.storefront.id === 'shopify') s.push(`The store's product feed was not available (${st.feed_refused}), so its sitemap and product pages were read instead.`);
  const k = stats.skipped;
  if (k.robots) s.push(`${plural(k.robots, 'page')} skipped because robots.txt disallows ${k.robots === 1 ? 'it' : 'them'}${stats.robots_examples.length ? ` (e.g. ${stats.robots_examples.slice(0, 2).join(', ')})` : ''}.`);
  if (k.off_scope) s.push(`${plural(k.off_scope, 'URL')} skipped because ${k.off_scope === 1 ? 'it is' : 'they are'} not on the brand's own hosts.`);
  if (k.no_product_declared) s.push(`${plural(k.no_product_declared, 'page')} in the sitemap declare no product (no JSON-LD Product and no OpenGraph product tags), so nothing was taken from ${k.no_product_declared === 1 ? 'it' : 'them'}.`);
  if (k.no_title) s.push(`${plural(k.no_title, 'product')} skipped because ${k.no_title === 1 ? 'it states' : 'they state'} no title.`);
  if (k.unreachable) s.push(`${plural(k.unreachable, 'page')} did not answer${stats.unreachable_examples.length ? ` (e.g. ${stats.unreachable_examples[0]})` : ''}.`);
  if (stats.rate_limited) s.push(`The store asked to slow down ${plural(stats.rate_limited, 'time')}; every Retry-After was obeyed (${Math.round(stats.waited_ms / 1000)} s waited in all).`);
  if (k.duplicate) s.push(`${plural(k.duplicate, 'duplicate')} (the same handle or URL listed twice) counted once.`);
  if (k.cap) s.push(`This importer reads at most ${LIMITS.maxProducts.toLocaleString('en-US')} products per market per run; ${plural(k.cap, 'more')} were not read.`);
  const m = stats.missing;
  if (m.price) s.push(`${plural(m.price, 'product')} state no price; ${m.price === 1 ? 'it carries' : 'they carry'} ${MARKER('price', '<product>', R)} rather than a number.`);
  if (m.image) s.push(`${plural(m.image, 'product')} state no image; ${m.image === 1 ? 'it carries' : 'they carry'} ${MARKER('product image', '<product>', R)}.`);
  if (m.currency) s.push(`${plural(m.currency, 'price')} carry no currency the store declared; ${MARKER('currency', '<product>', R)}.`);
  if (stopped) {
    const why = stopped.reason === 'rate_limited'
      ? `the store asked to slow down (429${stopped.retry_after ? `, Retry-After ${stopped.retry_after}` : ''}) at ${stopped.at}`
      : stopped.reason === 'robots_unreachable'
        ? `robots.txt could not be read (${stopped.at}); RFC 9309 says to treat that as "disallow everything", so nothing was read`
        : stopped.reason === 'timeout' ? `a request timed out at ${stopped.at}`
          : stopped.reason === 'unreachable' ? `the store stopped answering at ${stopped.at}`
            : `this run's time ran out at ${stopped.at}`;
    s.push(`PARTIAL: ${why}. Continue import resumes exactly there; the daily refresh also continues it.`);
  } else if (complete) {
    s.push('Complete: every product the source lists was read.');
  }
  return {
    route: st.route === 'done' ? (stats.by_source.feed ? 'feed' : stats.by_source.sitemap_jsonld ? 'sitemap' : 'crawl') : st.route,
    region: R, base: st.base, base_from: st.base_from, start: st.start || st.base, currency: st.currency || null,
    foreign_stores: Array.isArray(st.foreign_stores) ? st.foreign_stores : [],
    declared: st.declared || null, found,
    by_source: stats.by_source, skipped: stats.skipped, missing: stats.missing,
    missing_examples: stats.missing_examples.slice(0, 10),
    robots_examples: stats.robots_examples.slice(0, 10),
    complete, stopped: stopped || null, resume_available: !complete,
    requests: stats.requests, rate_limited: stats.rate_limited, waited_ms: stats.waited_ms, steps: stats.steps,
    sitemap: st.sitemap || null,
    platform: st.storefront || null,
    sentences: s,
  };
}

/* ── merging into what a brand already holds ───────────────────────────── */

/** The identity of a row inside one region: handle and sku, NULL equal to NULL. */
const rowKey = (r) => `${String(r.region || '').toLowerCase()}|${r.handle == null ? '' : r.handle}|${r.sku == null ? '' : r.sku}`;

/**
 * The same merge `brand_catalog_merge()` performs in the database, for the
 * catalogue a device keeps (brand-context.js mirrors this) and for the parity
 * test. Upsert by identity, never a duplicate; a row the source no longer lists
 * is marked stale - kept, never deleted - and only once a run has read the
 * WHOLE source (`complete`): a partial run cannot know what disappeared.
 */
function mergeRows(existing, incoming, { run, complete, family, at } = {}) {
  const when = at || new Date().toISOString();
  const out = (Array.isArray(existing) ? existing : []).map((r) => Object.assign({}, r));
  const index = new Map(out.map((r, i) => [rowKey(r), i]));
  let inserted = 0, updated = 0;
  for (const r of (Array.isArray(incoming) ? incoming : [])) {
    const k = rowKey(r);
    const row = Object.assign({}, r, { last_seen_run: run, last_seen_at: when, stale_at: null });
    if (index.has(k)) { out[index.get(k)] = Object.assign(out[index.get(k)], row); updated += 1; }
    else { index.set(k, out.length); out.push(row); inserted += 1; }
  }
  let staled = 0;
  if (complete) {
    const fam = new Set(family || []);
    const regions = new Set((incoming || []).map((r) => String(r.region || '').toLowerCase()));
    for (const r of out) {
      if (r.last_seen_run === run || r.stale_at) continue;
      if (fam.size && !fam.has(r.source)) continue;
      if (regions.size && !regions.has(String(r.region || '').toLowerCase())) continue;
      r.stale_at = when; staled += 1;
    }
  }
  return { rows: out, inserted, updated, staled };
}

/** The sources one route re-reads: a store import never stales a CSV, nor the reverse. */
function familyOf(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'csv' || k === 'json') return ['csv', 'json'];
  return ['shopify_public', 'sitemap_jsonld', 'site_crawl'];
}

/* ── the daily refresh (rides the EXISTING /api/brain?action=cron) ────────── */

function serviceEnv() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  return url && key ? { url, key } : null;
}

async function serviceCall(env, pathAndQuery, { method = 'GET', body } = {}) {
  const r = await fetch(`${env.url}/rest/v1/${pathAndQuery}`, {
    method, cache: 'no-store',
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!r.ok) { const e = new Error(`supabase ${method} ${pathAndQuery.split('?')[0]} -> ${r.status}: ${(json && json.message) || text}`); e.status = r.status; throw e; }
  return json;
}

const STORE_KINDS = ['shopify_public', 'site_crawl', 'storefront', 'site'];
const REFRESH_AFTER_MS = 20 * 3600 * 1000;

/**
 * Keep every brand's store catalogue current, a few brands per run: an import
 * that stopped part-way CONTINUES from its cursor first; then the brand whose
 * last read is oldest is read again from the start (a complete re-read is what
 * marks a product the store dropped as stale). A catalogue a person uploaded
 * (CSV / JSON) has no store to re-read and is never touched.
 *
 * Service role, with the workspace named explicitly on every write; the merge
 * function accepts a call with no user only from the service role.
 */
async function refreshDue({ maxWorkspaces = 2, budgetMs = 25000, now } = {}) {
  const env = serviceEnv();
  if (!env) return { ok: true, skipped: true, due: 0, refreshed: [], note: 'No Supabase service role on this deployment, so there are no workspace catalogues to refresh.' };
  const started = now || Date.now();
  const rows = await serviceCall(env, `brand_workspaces?select=id,website,regions,asset_hosts,catalog_source,catalog_import&catalog_source->>kind=in.(${STORE_KINDS.join(',')})&order=updated_at.asc&limit=200`);
  const list = (Array.isArray(rows) ? rows : []).filter((w) => w && w.catalog_source && (w.catalog_source.url || (w.catalog_import && w.catalog_import.url)));
  const at = (w) => Date.parse((w.catalog_import && w.catalog_import.updated_at) || w.catalog_source.imported_at || 0) || 0;
  const partial = list.filter((w) => w.catalog_import && w.catalog_import.cursor).sort((a, b) => at(a) - at(b));
  const stale = list.filter((w) => !(w.catalog_import && w.catalog_import.cursor) && started - at(w) > REFRESH_AFTER_MS).sort((a, b) => at(a) - at(b));
  const due = partial.concat(stale);
  const picked = due.slice(0, maxWorkspaces);
  const core = require('./brand-workspace-core.js');
  const refreshed = [];
  for (let i = 0; i < picked.length; i++) {
    const w = picked[i];
    const left = budgetMs - (Date.now() - started);
    if (left < 4000) break;
    const share = Math.floor(left / (picked.length - i));
    const imp = w.catalog_import || {};
    const src = w.catalog_source || {};
    const resume = imp.cursor ? imp : null;
    const region = String((resume && resume.region) || src.region || imp.region || '').toLowerCase();
    // The URL the import was asked for (the cursor's start), never the store
    // another brand's site supplied: a recorded source on another domain than
    // the website refreshes from the website, and its cursor is not resumed.
    let url = (resume && ((resume.cursor && resume.cursor.start) || resume.url)) || src.url || imp.url;
    const ident = identityOf(w);
    if (ident && url && !COH.sameBrand(COH.registrableDomain(COH.hostOf(url)), ident) && w.website) url = w.website;
    const cursorIn = resume && !cursorProblem(resume.cursor, { region, url, identity: ident }) ? resume.cursor : null;
    try {
      if (!region) throw new Error('no market recorded for this catalogue');
      const parsed = await core.rowsFromStore(url, region, w, { cursor: cursorIn, budgetMs: share });
      const run = parsed.run;
      const complete = !!parsed.complete;
      const kind = src.kind && /site/.test(src.kind) ? 'site_crawl' : 'shopify_public';
      const source = core.catalogSourceRecord(parsed, kind === 'site_crawl' ? 'site' : 'storefront', url, parsed.rows.length, run, region);
      source.refreshed_by = 'daily refresh';
      const state = { run, kind: kind === 'site_crawl' ? 'site' : 'storefront', url: parsed.start || url, base: parsed.base || '', region, cursor: complete ? null : parsed.cursor, coverage: core.coverageSummary(parsed.coverage), updated_at: new Date().toISOString(), refreshed_by: 'daily refresh' };
      const merged = { inserted: 0, updated: 0, staled: 0 };
      const rowsIn = parsed.rows;
      const chunks = [];
      for (let j = 0; j < rowsIn.length; j += 400) chunks.push(rowsIn.slice(j, j + 400));
      if (!chunks.length) chunks.push([]);
      for (let j = 0; j < chunks.length; j++) {
        const last = j === chunks.length - 1;
        const r = await serviceCall(env, 'rpc/brand_catalog_merge', { method: 'POST', body: {
          p_workspace: w.id, p_region: region, p_rows: chunks[j], p_run: run, p_complete: last && complete,
          p_family: familyOf(kind), p_state: last ? state : null, p_source: last ? source : null,
        } });
        merged.inserted += (r && r.inserted) || 0; merged.updated += (r && r.updated) || 0; merged.staled += (r && r.staled) || 0;
      }
      try { require('./brand-catalog-server.js').invalidate(w.id); } catch (_) { /* cache only */ }
      refreshed.push({ workspace_id: w.id, continued: !!resume, found: parsed.coverage.found, complete, inserted: merged.inserted, updated: merged.updated, staled: merged.staled });
    } catch (e) {
      refreshed.push({ workspace_id: w.id, continued: !!resume, error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  return {
    ok: true, due: due.length, refreshed,
    note: due.length > picked.length ? `${due.length - picked.length} more catalogue(s) are due and are taken on the next runs, oldest first.` : '',
  };
}

module.exports = {
  refreshDue,
  step, mergeRows, familyOf, rowKey, coverageOf,
  rowFromFeed, rowFromPage, readSitemaps, parseRobots, robotsAllows, retryAfterMs,
  regionalBase, ownScope, identityOf, cursorProblem, foreignStoreSentence, declaredCurrency, handleFromUrl, LIMITS, USER_AGENT, MARKER,
};
