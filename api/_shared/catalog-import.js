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
 * ── AND IT KEEPS GOING BY ITSELF (2026-10-11) ────────────────────────────────
 * Measured on two live records the day after: Nykaa (not Shopify, platform
 * undetected, region stored as "IND") read 0 products, stuck at "feed page 1"
 * behind a 429 on /products.json, with a denominator of "21 products"; Lenskart
 * read 450 of 2,430 and waited for someone to press Continue import, five more
 * times. Now:
 *   - the Shopify feed is PROBED once, without retries, when no platform
 *     declared itself; anything but a page of products sends the read to the
 *     site's own sitemaps (a 429 on a feed that may not exist is not a reason
 *     to stop reading a store);
 *   - the sitemaps are enumerated as a resumable queue on the cursor: nested
 *     indexes to LIMITS.maxSitemapDepth, a child of a product index is a
 *     product sitemap whatever its own name, a category sitemap
 *     (product_cat-*, product-category-*) is not, a sitemap that answers 429
 *     waits its Retry-After and is read on the next step instead of being
 *     dropped, a sitemap on the brand's own registrable domain (a subdomain, a
 *     sitemap host) is read, and the total is called "declared" only once
 *     every sitemap has been read ("so far" until then);
 *   - a market code is the canonical one (brand-locale family(): IND -> in,
 *     GB -> uk), or the import is refused: rows filed under "ind" were never
 *     found by a generator, which looks up "in";
 *   - a step reports `progressed`, and the account path CHAINS: after a step
 *     that stopped part-way and moved, it fires the next step at the
 *     deployment's own URL (CRON_SECRET-guarded op=catalog-chain, the
 *     prebuild queue's pattern), which claims the step on the row so two
 *     chains never run one cursor, and fires the next, until the store is
 *     read. A step that read nothing new stops the chain and says why; a
 *     Retry-After a step can wait is waited at the start of the next step;
 *     a longer one ends the chain and the daily refresh resumes it after the
 *     time the store asked for. A device brand has no row to chain on: its
 *     browser drives the same steps until complete.
 *
 * NOT a function file (api/_shared/ -> outside the Hobby 12-function cap).
 */

const zlib = require('zlib');
const crypto = require('crypto');
const crawl = require('./site-crawl.js');
const COH = require('./brand-coherence.js');
const LOC = require('./brand-locale.js');

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
  maxSitemaps: 3000,          // per import run, across every step: a stated ceiling
  maxSitemapDepth: 6,         // index -> index -> ... -> urlset
  maxSitemapTries: 3,         // a sitemap that times out is retried on the next step, then reported
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

/**
 * The canonical market code rows are filed under, lower case, from the ONE
 * region table (brand-locale.js FAMILY + COUNTRY): "IND" and "India" -> "in",
 * "GB" -> "uk", "usa" -> "us". '' when the code names no market the table
 * knows, and the import refuses rather than file rows under a code no
 * generator looks up (2026-10-11: the live Nykaa record's "IND" filed nothing
 * a reader could find, brand-catalog-server.regionKey asks for "in").
 */
const ZONES = new Set(Object.values(LOC.FAMILY));
function canonRegion(code) {
  const f = LOC.family(code);
  if (!f) return '';
  return (ZONES.has(f) || LOC.COUNTRY[f]) ? f.toLowerCase() : '';
}
/** The other spellings of one market (for "ind" rows left by an older import of "in"). */
function regionAliases(reg) {
  const want = canonRegion(reg);
  if (!want) return [];
  return Object.keys(LOC.FAMILY).filter((k) => LOC.FAMILY[k].toLowerCase() === want).map((k) => k.toLowerCase()).filter((k) => k !== want);
}

/** Market codes as a person writes them -> ISO country + the hreflang regions that name it. */
function regionCountry(region) {
  const c = LOC.countryOf(region);
  if (c) return c;
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
async function getText(url, ctx, { accept, timeoutMs, scope } = {}) {
  const guard = ctx.guard;
  const ok = scope || ctx.inScope || ((u) => crawl.inScope(u, ctx.hosts));
  let at = url;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    if (!ok(at)) return { ok: false, status: 0, url: at, reason: 'off_scope' };
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
  const retries = opts && Number.isFinite(opts.retries) ? opts.retries : LIMITS.maxRetries;
  for (let attempt = 0; ; attempt++) {
    const r = await getText(url, ctx, opts);
    if (r.status !== 429 && r.status !== 503) return r;
    ctx.stats.rate_limited += 1;
    const asked = retryAfterMs(r.retryAfter);
    const wait = asked != null ? asked : 1000 * Math.pow(2, attempt);
    const left = ctx.deadline - Date.now();
    if (attempt >= retries || wait > LIMITS.maxRetryAfterMs || wait > left - 1000) {
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
  // robots.txt of any origin this read may touch (a sitemap on the brand's
  // sibling domain included): the wider of the two scopes.
  const r = await getText(origin + '/robots.txt', ctx, { accept: 'text/plain', scope: ctx.sitemapScope });
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
  let declaredBy = 'json-ld';
  if (!node) {
    // The page's own server-delivered application data (Next.js __NEXT_DATA__,
    // a type="application/json" block): a schema.org Product inside it is the
    // same declaration as JSON-LD, read as such.
    const app = embeddedJson(html);
    for (const j of app) { const n = findNode(j, (o) => typeIs(o, 'productgroup') || typeIs(o, 'product')); if (n) { node = n; declaredBy = 'embedded schema.org'; break; } }
    if (!node) {
      const plain = embeddedProduct(app, html, pageUrl);
      if (plain) {
        return { row: {
          region, title: plain.title, handle: handleFromUrl(pageUrl) || null, sku: plain.sku, description: null, product_type: null, collections: [],
          price: plain.price, compare_at: null, currency: plain.currency, image_url: plain.images[0] || null, image_urls: plain.images, variants: [],
          product_url: pageUrl, in_stock: null, tags: [], source, source_url: pageUrl,
          raw: { declared: 'embedded-json', keys: plain.keys },
        } };
      }
    }
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
        raw: { declared: declaredBy, type: typeIs(node, 'productgroup') ? 'ProductGroup' : 'Product' },
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
  return { skip: scriptRendered(html) ? 'script_rendered' : 'no_product_declared' };
}

/** The JSON a page delivers in its own <script type="application/json"> blocks (Next.js __NEXT_DATA__ among them). */
function embeddedJson(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/type=["']application\/json["']/i.test(m[1]) && !/id=["']__NEXT_DATA__["']/i.test(m[1])) continue;
    if (m[2].length > 3000000) continue;
    try { out.push(JSON.parse(m[2])); } catch (_) { /* not JSON: nothing declared */ }
    if (out.length >= 6) break;
  }
  return out;
}
/** Depth-first search for the first object a predicate accepts (bounded). */
function findNode(v, pred, depth = 0, budget = { n: 0 }) {
  if (!v || typeof v !== 'object' || depth > 14 || ++budget.n > 60000) return null;
  if (!Array.isArray(v) && pred(v)) return v;
  for (const k of Object.keys(v)) { const x = findNode(v[k], pred, depth + 1, budget); if (x) return x; }
  return null;
}
/**
 * A product the page's application data STATES verbatim: one object carrying
 * a title, a price, an ISO currency and an http image under the plain names a
 * store uses for them - and whose title is the page's own title (so a
 * "you may also like" product elsewhere in the data is never taken for this
 * page's). Anything less is not a declaration, and nothing is taken.
 */
const EMB = { title: ['name', 'title', 'productName'], price: ['price', 'sellingPrice', 'salePrice', 'finalPrice', 'offerPrice'], currency: ['currency', 'priceCurrency', 'currencyCode'], image: ['image', 'imageUrl', 'image_url', 'imageURL', 'thumbnail', 'images'] };
function embeddedProduct(app, html, pageUrl) {
  if (!app.length) return null;
  const meta = crawl.metaTags(html);
  const pageTitle = String(meta['og:title'] || ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html)) || [])[1]) || '').toLowerCase();
  if (!pageTitle) return null;
  const pick = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return [k, o[k]]; return null; };
  for (const j of app) {
    const hit = findNode(j, (o) => {
      const t = pick(o, EMB.title), p = pick(o, EMB.price), c = pick(o, EMB.currency), i = pick(o, EMB.image);
      if (!t || !p || !c || !i) return false;
      if (typeof t[1] !== 'string' || !t[1].trim() || !pageTitle.includes(t[1].trim().toLowerCase())) return false;
      if (typeof p[1] === 'object' || num(p[1]) == null) return false;
      if (!/^[A-Z]{3}$/.test(String(c[1]))) return false;
      return imagesOf(i[1], pageUrl).length > 0;
    });
    if (hit) {
      const t = pick(hit, EMB.title), p = pick(hit, EMB.price), c = pick(hit, EMB.currency), i = pick(hit, EMB.image);
      return { title: str(t[1], 300), price: num(p[1]), currency: String(c[1]), images: imagesOf(i[1], pageUrl), sku: str(hit.sku, 120) || null, keys: [t[0], p[0], c[0], i[0]] };
    }
  }
  return null;
}

/**
 * A page that, as served, is an application shell: next to no text, and a
 * script bundle (or a mount point a framework renders into). Its product, if
 * it has one, appears only after JavaScript runs. This importer reads pages as
 * served and does not run a browser per product (one headless page per product
 * is seconds each; a store of thousands does not fit a function's time), so
 * the coverage SAYS how many pages are like this rather than calling them
 * pages with no product.
 */
function scriptRendered(html) {
  const h = String(html || '');
  if (!/<script\b/i.test(h)) return false;
  const text = h.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const mount = /<(?:div|main)\b[^>]*\bid=["'](?:root|app|__next|__nuxt|svelte|main-app)["']/i.test(h);
  return text.length < 160 || (mount && text.length < 400);
}

/* ── sitemaps ───────────────────────────────────────────────────────────── */

/* A sitemap whose own name says it lists products, and NOT a sitemap of the
   product CATEGORIES, tags or brands (WooCommerce's product_cat-sitemap.xml,
   product_tag-sitemap.xml, product-category-sitemap.xml): counting those as
   products put category pages into the denominator and the read queue. */
/* 2026-10-11, the live probe of Nykaa: blog sitemaps such as
   /beauty-blog/sitemaps/product-reviews/top-brands.xml were typed "product"
   because their path CONTAINED "product", and the read spent its budget on
   1,060 blog pages. A sitemap is classified by the WORDS of its path (split on
   / - _ . and digits), not by a substring: a word that names a non-product
   subtree (blog, reviews, category, pages, ...) makes it non-product whatever
   else it says; "product"/"products" makes it a product sitemap; a child of a
   product index is one too. */
const NON_PRODUCT_WORDS = new Set(['blog', 'blogs', 'article', 'articles', 'news', 'review', 'reviews', 'category', 'categories', 'cat', 'cats', 'collection', 'collections', 'brand', 'brands', 'page', 'pages', 'tag', 'tags', 'author', 'authors', 'help', 'faq', 'faqs', 'post', 'posts', 'video', 'videos', 'guide', 'guides', 'search', 'press', 'careers', 'attribute', 'attributes', 'type', 'types']);
function sitemapWords(u) {
  let p = '';
  try { p = new URL(u).pathname.toLowerCase(); } catch (_) { p = String(u || '').toLowerCase(); }
  return p.replace(/\.(?:xml|txt)(?:\.gz)?$|\.gz$/, '').split(/[\/\-_.\d]+/).filter(Boolean);
}
/** 'product' | 'non-product' | 'other', from the sitemap's own path; a child of a product index inherits 'product'. */
function sitemapClass(u, parentTyped) {
  const w = sitemapWords(u);
  if (w.some((x) => NON_PRODUCT_WORDS.has(x))) return 'non-product';
  if (w.some((x) => x === 'product' || x === 'products')) return 'product';
  return parentTyped ? 'product' : 'other';
}
const isProductSitemap = (u) => sitemapClass(u, false) === 'product';

/**
 * Every sitemap the site declares, as a queue on the cursor: index -> index ->
 * urlset to LIMITS.maxSitemapDepth, gzipped included, read until this step's
 * time is spent and RESUMED by the next step (a marketplace declares hundreds
 * of sitemaps of up to 50,000 URLs each; one invocation used to read 60 and
 * call what it had found "the products the site declares").
 *
 *   - a child of a product sitemap index is a product sitemap whatever its own
 *     name (/sitemaps/products/index.xml -> /sitemaps/products/a/1.xml.gz);
 *   - a sitemap that answers 429 / 503 waits its Retry-After (getPolite); one
 *     the step cannot afford stays at the head of the queue and the step stops
 *     there with the wait recorded - it is never dropped;
 *   - a sitemap on the brand's own registrable domain (a sitemap host, a
 *     subdomain) is read; one on another site is not, and is named;
 *   - product URLs are de-duplicated (a "featured" sitemap repeating products
 *     listed elsewhere does not inflate the total).
 *
 * Product URLs (from product sitemaps) go to `st.pending`; the rest are kept in
 * `st.other` only while no product sitemap has been seen (a site that does not
 * say which URLs are products is read whole).
 */
async function enumerateSitemaps(st, ctx) {
  const sm = st.sm;
  const seen = new Set(sm.seen || []);
  const typed = new Set(st.pending || []);
  const other = new Set(st.other || []);
  const cap = LIMITS.maxProducts;
  const inBase = (u) => { try { return !st.prefix || new URL(u).pathname.startsWith(st.prefix + '/'); } catch (_) { return false; } };
  const note = (t) => { if (sm.notes.length < 40) sm.notes.push(t); };
  let stop = null;
  if (!sm.other_markets) sm.other_markets = {};
  if (!sm.non_product) sm.non_product = { count: 0, examples: [] };
  const queueItem = (u, parent) => {
    const cls = sitemapClass(u, !!(parent && parent.typed));
    return { url: u, depth: parent ? parent.depth + 1 : 0, typed: cls === 'product', cls, foreign: (parent && parent.foreign) || (foreignLocale(u, st) || {}).prefix || '' };
  };
  const market = (f) => (sm.other_markets[f.prefix] = sm.other_markets[f.prefix] || { prefix: f.prefix, country: f.country, sitemaps: 0, products: 0 });
  while (sm.queue.length && Date.now() < ctx.deadline - 2000) {
    // Product sitemaps FIRST: the read never spends its time on a blog
    // before the store's own product index.
    let at = sm.queue.findIndex((q) => q && q.typed && !q.foreign);
    if (at < 0) at = 0;
    if (at > 0) sm.queue.unshift(sm.queue.splice(at, 1)[0]);
    const item = sm.queue[0];
    if (!item || !item.url || seen.has(item.url)) { sm.queue.shift(); continue; }
    if (item.cls === undefined) Object.assign(item, queueItem(item.url, null), { depth: item.depth || 0 });
    // A subtree that lists no products (blog, reviews, categories, pages):
    // never read for a catalogue, and counted.
    if (item.cls === 'non-product') {
      sm.queue.shift(); seen.add(item.url);
      sm.non_product.count += 1;
      if (sm.non_product.examples.length < 3) sm.non_product.examples.push(item.url);
      continue;
    }
    // Another MARKET's locale subtree (/en-us/ for an IN import): its product
    // sitemaps are read only to COUNT what belongs to that market; nothing
    // from them is queued for this one, and anything else there is skipped.
    const fl = item.foreign ? { prefix: item.foreign, country: (foreignLocale(item.url, st) || {}).country || (sm.other_markets[item.foreign] || {}).country || '' } : null;
    if (fl && !item.typed && !/sitemap|index/.test(sitemapWords(item.url).join(' '))) { sm.queue.shift(); seen.add(item.url); market(fl).sitemaps += 1; continue; }
    if (sm.read >= LIMITS.maxSitemaps) {
      sm.unread += sm.queue.length; sm.queue = [];
      note(`This importer reads at most ${LIMITS.maxSitemaps.toLocaleString('en-US')} sitemaps per import; ${sm.unread.toLocaleString('en-US')} more were declared and not read.`);
      break;
    }
    if (!ctx.sitemapScope(item.url)) { sm.queue.shift(); seen.add(item.url); note(`A sitemap on another site was not read: ${item.url}`); continue; }
    if (!(await allowed(item.url, ctx))) { sm.queue.shift(); seen.add(item.url); note(`robots.txt disallows the sitemap ${item.url}, so it was not read.`); continue; }
    const r = await getPolite(item.url, ctx, { accept: 'application/xml,text/xml,*/*', scope: ctx.sitemapScope });
    if (r.reason === 'rate_limited') { stop = { reason: 'rate_limited', at: `sitemap ${item.url}`, retry_after: r.retry_after, wait_ms: r.wait_ms }; break; }
    if (r.reason === 'timeout') {
      item.tries = (item.tries || 0) + 1;
      if (item.tries < LIMITS.maxSitemapTries) { stop = { reason: 'timeout', at: `sitemap ${item.url}` }; break; }
    }
    sm.queue.shift();
    seen.add(item.url);
    sm.read += 1;
    st.progress = (st.progress || 0) + 1;
    if (!r.ok) { note(`The sitemap ${item.url} did not answer (${r.status || r.reason}).`); continue; }
    const kind = sitemapKind(r.body);
    if (kind === 'html' || kind === 'unknown' || kind === 'xml') {
      // A bot challenge, a login wall or a "not found" page answered 200: it
      // is not a sitemap, and nothing in it is a list of this store's URLs.
      sm.not_sitemaps += 1;
      const root = kind === 'xml' ? xmlRoot(r.body) : '';
      note(kind === 'html' ? `${item.url} answered an HTML page (${r.contentType || 'no content type'}), not a sitemap, so nothing was taken from it.`
        : kind === 'xml' ? `${item.url} is an XML document whose root element is <${root || 'none'}>, not a sitemap's <urlset> or <sitemapindex>, so nothing was taken from it.`
          : `${item.url} answered ${String(r.body || '').trim() ? 'something that is not a sitemap' : 'an empty body'} (${r.contentType || 'no content type'}), so nothing was taken from it.`);
      continue;
    }
    sm.found = true;
    const locs = kind === 'text' ? textSitemapLocs(r.body) : crawl.locsFrom(r.body);
    if (kind === 'urlset') {
      // A <urlset> that lists SITEMAPS rather than pages (the 2026-10-11 live
      // shape: 21 child sitemaps read as 21 "pages" that declare no product,
      // on two stores of thousands): each such entry is a child sitemap.
      const kids = locs.filter((l) => looksLikeSitemap(httpAbs(l, item.url)));
      if (kids.length) {
        sm.nested_in_urlset += kids.length;
        for (const c of kids) {
          const u = httpAbs(c, item.url);
          if (!u || seen.has(u) || item.depth + 1 >= LIMITS.maxSitemapDepth) continue;
          sm.queue.push(queueItem(u, item));
        }
        if (kids.length === locs.length) { sm.indexes += 1; if (sm.sources.length < 200) sm.sources.push({ url: item.url, kind: 'index (a urlset listing sitemaps)', declared: locs.length }); continue; }
        const set = new Set(kids);
        locs.splice(0, locs.length, ...locs.filter((l) => !set.has(l)));
      }
    }
    if (kind === 'index') {
      sm.indexes += 1;
      if (sm.sources.length < 200) sm.sources.push({ url: item.url, kind: 'index', declared: locs.length });
      if (item.depth + 1 >= LIMITS.maxSitemapDepth) { note(`The sitemap index ${item.url} nests deeper than ${LIMITS.maxSitemapDepth} levels; its children were not read.`); continue; }
      for (const c of locs) {
        const u = httpAbs(c, item.url);
        if (!u || seen.has(u)) continue;
        sm.queue.push(queueItem(u, item));
      }
      continue;
    }
    if (sm.sources.length < 200) sm.sources.push({ url: item.url, kind: 'urlset', declared: locs.length, products: !!item.typed, market: item.foreign || undefined });
    if (!locs.length) note(`The sitemap ${item.url} is a <urlset> that lists no URLs.`);
    sm.urlsets += 1;
    if (item.foreign) {
      const f = market({ prefix: item.foreign, country: (foreignLocale(item.url, st) || {}).country || '' });
      f.sitemaps += 1;
      if (item.typed) f.products += locs.length;
      continue;
    }
    if (item.typed) {
      if (!sm.typed_any) { sm.typed_any = true; other.clear(); }
      for (const loc of locs) {
        const u = httpAbs(loc, item.url);
        if (!u || !inBase(u) || typed.has(u)) continue;
        const lf = foreignLocale(u, st);
        if (lf) { market(lf).products += 1; continue; }
        typed.add(u);
        sm.typed_total += 1;
        if (st.pending.length < cap) st.pending.push(u); else sm.overflow += 1;
      }
    } else if (!sm.typed_any) {
      for (const loc of locs) {
        const u = httpAbs(loc, item.url);
        if (!u || !inBase(u) || other.has(u) || u.replace(/\/$/, '') === st.base || foreignLocale(u, st)) continue;
        if (other.size >= cap) { sm.overflow += 1; continue; }
        other.add(u);
      }
    }
  }
  st.other = sm.typed_any ? [] : [...other];
  sm.seen = [...seen].slice(-6000);
  if (!sm.queue.length) sm.done = true;
  return stop;
}

/** What a sitemap response IS: an index, a urlset, a text sitemap (one URL per line), an HTML page, or unknown. */
function sitemapKind(body) {
  const all = String(body || '').replace(/^\uFEFF/, '');
  const b = all.slice(0, 4000).trim();
  if (crawl.isSitemapIndex(all)) return 'index';
  // Anywhere in the body: a long comment or stylesheet header can push the
  // root element past any fixed prefix (the live "pages.xml ... text/xml").
  if (/<(?:[a-z0-9]+:)?urlset\b/i.test(all) || /<url>\s*<loc>/i.test(all)) return 'urlset';
  if (/<html\b|<!doctype html|<body\b/i.test(b)) return 'html';
  const lines = b.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length && lines.every((x) => /^https?:\/\/\S+$/i.test(x))) return 'text';
  return /^<\?xml|^</.test(b) ? 'xml' : 'unknown';
}
/** The root element of an XML document, for saying what a non-sitemap IS. */
function xmlRoot(body) {
  const s = String(body || '').replace(/^\uFEFF/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/i, '');
  const m = /<([A-Za-z_][\w:.-]*)/.exec(s);
  return m ? m[1] : '';
}
/** A text sitemap (sitemaps.org): one absolute URL per line, UTF-8. */
function textSitemapLocs(body) {
  return String(body || '').split(/\r?\n/).map((x) => x.trim()).filter((x) => /^https?:\/\/\S+$/i.test(x));
}
/** A URL that names a sitemap, not a page: *.xml / *.xml.gz / *.txt(.gz), or "sitemap" in its path. */
function looksLikeSitemap(u) {
  try { const p = new URL(u).pathname.toLowerCase(); return /\.(?:xml|txt)(?:\.gz)?$/.test(p) || /\.gz$/.test(p) || /sitemap/.test(p); } catch (_) { return false; }
}

/**
 * The market a URL's locale path belongs to, when it is ANOTHER market than
 * this import's: the site's own hreflang alternates (st.locale_prefixes,
 * prefix -> country) first, else a locale-shaped first segment (/en-us/,
 * /ar-sa/, /en_gb/). The live Lenskart probe: an IN import read /en-us/,
 * /en-ae/, /en-sa/, /ar-sa/, /en-th/ and /th-th/ product sitemaps and filed
 * USD rows under IN. null when the URL is this market's (or carries no locale).
 */
function foreignLocale(u, st) {
  let p;
  try { p = new URL(u).pathname; } catch (_) { return null; }
  const own = regionCountry(st.region);
  if (st.prefix && (p === st.prefix || p.startsWith(st.prefix + '/'))) return null;
  for (const f of (st.locale_prefixes || [])) {
    if (f.country && f.country !== own && (p === f.prefix || p.startsWith(f.prefix + '/'))) return { prefix: f.prefix, country: f.country };
  }
  const m = /^\/([a-z]{2})[-_]([a-z]{2})(?=\/|$)/i.exec(p);
  if (m) {
    let c = m[2].toUpperCase();
    if (c === 'UK') c = 'GB';
    if (c !== own) return { prefix: `/${m[1].toLowerCase()}-${m[2].toLowerCase()}`, country: c };
  }
  return null;
}
/** The locale path prefixes the start page's hreflang alternates declare, with their market. */
function localePrefixes(html, start) {
  const out = [];
  let host = '';
  try { host = new URL(start).host; } catch (_) { return out; }
  for (const m of String(html || '').matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag)) continue;
    const hl = (/hreflang=["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    const href = (/href=["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    const country = (hl.split('-')[1] || '').toUpperCase();
    if (!country) continue;
    let u; try { u = new URL(href, start); } catch (_) { continue; }
    if (u.host !== host) continue;
    const prefix = u.pathname.replace(/\/$/, '');
    if (!prefix) continue;
    out.push({ prefix, country: country === 'UK' ? 'GB' : country });
  }
  return out.slice(0, 60);
}
/** The currency a market prices in, from the one country table; '' for a zone (EU, GLOBAL). */
function marketCurrency(reg) {
  const c = LOC.countryOf(reg);
  return c && LOC.COUNTRY[c] ? LOC.COUNTRY[c][0] : '';
}

/** Once every sitemap is read: the read queue and the denominator. */
function finishSitemaps(st, stats) {
  const sm = st.sm;
  if (!sm.typed_any) st.pending = (st.other || []).slice(0, LIMITS.maxProducts);
  st.other = [];
  if (sm.overflow) stats.cap_urls = (stats.cap_urls || 0) + sm.overflow;
  st.declared = sm.found
    ? { count: sm.typed_any ? sm.typed_total : null, urls: st.pending.length + (sm.typed_any ? 0 : sm.overflow), by: sm.typed_any ? 'the site\'s product sitemaps' : 'the site\'s sitemaps (they do not say which URLs are products)', complete: !sm.unread }
    : null;
  st.sitemap = { found: sm.found, sources: sm.sources.slice(0, 200), notes: sm.notes.slice(0, 20), typed: !!sm.typed_any, read: sm.read, indexes: sm.indexes, urlsets: sm.urlsets };
  if (st.route === 'pages') st.route = sm.found ? 'sitemap' : 'crawl';
}

/* ── the cursor and the run ─────────────────────────────────────────────── */

function freshStats() {
  return {
    found: 0, by_source: { feed: 0, sitemap_jsonld: 0, crawl: 0 },
    skipped: { robots: 0, off_scope: 0, no_product_declared: 0, script_rendered: 0, no_title: 0, unreachable: 0, timed_out: 0, duplicate: 0, cap: 0 },
    missing: { price: 0, image: 0, currency: 0 },
    missing_examples: [],
    robots_examples: [],
    unreachable_examples: [],
    script_examples: [],
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
 * at "URL 439 of 2430"). Markets are compared canonically: a cursor written
 * for "ind" is a place in the IN store.
 */
function cursorProblem(c, { region, url, identity } = {}) {
  if (!c || typeof c !== 'object' || c.v !== LIMITS.cursorVersion) return 'it was written by another version of this importer';
  const a = canonRegion(c.region) || String(c.region || '').toLowerCase();
  const b = canonRegion(region) || String(region || '').toLowerCase();
  if (a !== b) return `it reads market ${a.toUpperCase() || 'unset'}, not ${b.toUpperCase() || 'unset'}`;
  if (!['feed', 'sitemap', 'crawl', 'pages'].includes(c.route)) return 'it holds no place to resume from';
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
 *   region     the market these rows are filed under (canonicalised here)
 *   brand      { website, regions[], asset_hosts[] } - the scope, as the row gives it
 *   cursor     a previous step's cursor, to resume; null to start a run
 *   guard      async (url) => void, throwing for a private/internal address
 *   budgetMs   this step's share of the invocation
 *
 * Returns { rows, cursor, complete, progressed, coverage, storefront, base, run }.
 * `progressed` is false when the step moved nothing forward (no sitemap read,
 * no page or feed page advanced): a chain stops on it instead of looping.
 */
async function step({ url, region, brand, cursor, guard, budgetMs, now }) {
  const started = now || Date.now();
  const reg = canonRegion(region) || String(region || '').toLowerCase();
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
  for (const [k, v] of Object.entries(freshStats().skipped)) if (stats.skipped[k] == null) stats.skipped[k] = v;
  if (!Array.isArray(stats.script_examples)) stats.script_examples = [];
  stats.steps += 1;
  stats.requests = 0;
  // The brand's own registrable domain: the website's, else the URL given's.
  const identity = own.identity || COH.registrableDomain(COH.hostOf(url));
  const sameDomain = (u) => { try { return !!identity && COH.registrableDomain(COH.hostOf(u)) === identity; } catch (_) { return false; } };
  const ctx = {
    hosts, robots: {}, deadline: started + (budgetMs || LIMITS.stepBudgetMs), stats, guard: guard || (async () => {}),
    // A page is the brand's when it is on the brand's hosts or under its own
    // registrable domain (m.brand.com, shop.brand.com).
    inScope: (u) => crawl.inScope(u, hosts) || sameDomain(u),
    // A SITEMAP may also sit on a sibling the coherence rule calls the same
    // brand (brand.in beside brand.com): that rule's ownership function,
    // never a second domain comparison.
    sitemapScope: (u) => crawl.inScope(u, hosts) || sameDomain(u) || (!!identity && COH.sameBrand(COH.registrableDomain(COH.hostOf(u)), identity)),
  };
  const rows = [];
  const seen = new Set((prev && prev.seen_keys) || []);
  const wantCurrency = marketCurrency(reg);
  const keep = (row) => {
    // A row priced in another market's currency is not this market's row
    // (2026-10-11: /en-us/ pages in USD filed under IN).
    if (wantCurrency && row.currency && String(row.currency).toUpperCase() !== wantCurrency) {
      stats.skipped.wrong_currency = (stats.skipped.wrong_currency || 0) + 1;
      if ((stats.currency_examples = stats.currency_examples || []).length < 3) stats.currency_examples.push(`${row.product_url || row.title} (${row.currency})`);
      return false;
    }
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

  let st = prev ? JSON.parse(JSON.stringify(prev)) : null;
  if (st) st.region = reg;
  let storefront = (prev && prev.storefront) || null;
  let stopped = null;
  const progressBefore = st ? (st.progress || 0) : 0;

  if (!st) {
    // ── a fresh run: decide the store and the platform; the sitemaps are
    // enumerated below, as a queue this step and the next ones work through.
    const start = url.replace(/\/$/, '');
    const robotsHome = await robotsFor(new URL(start).origin, ctx);
    if (robotsHome.rules === 'all') {
      stopped = { reason: 'robots_unreachable', at: `${new URL(start).origin}/robots.txt answered ${robotsHome.status || robotsHome.reason}` };
      st = { v: LIMITS.cursorVersion, run, region: reg, start, base: start, base_from: 'the URL given', route: 'feed', page: 1, declared: null, currency: '', storefront: null, progress: 0 };
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
      const declaredSm = (rbase.sitemaps || []).map((u) => httpAbs(u, origin)).filter(Boolean);
      const firstSm = declaredSm.length ? declaredSm : [origin + '/sitemap.xml'];
      st = {
        v: LIMITS.cursorVersion, run, region: reg, start, base: rb.base, base_from: rb.from,
        identity: own.identity || '',
        foreign_stores: foreignStores.filter((f) => regionCountry(f.code) === regionCountry(reg)).slice(0, 5),
        currency: declaredCurrency(baseHtml),
        storefront,
        prefix: new URL(rb.base).pathname.replace(/\/$/, ''),
        locale_prefixes: localePrefixes(homeHtml, start),
        sm: { queue: firstSm.map((u) => ({ url: u, depth: 0, typed: isProductSitemap(u) })), seen: [], sources: [], notes: [], read: 0, indexes: 0, urlsets: 0, found: false, done: false, typed_any: false, typed_total: 0, overflow: 0, unread: 0, not_sitemaps: 0, nested_in_urlset: 0, from_robots: declaredSm.length > 0 },
        sitemap: null,
        declared: null,
        // The feed only for a store that IS Shopify or does not say what it is
        // (then it is PROBED once: see the feed below). A store that declares
        // another platform is read from its own sitemaps (or its pages).
        route: storefront && storefront.id && storefront.id !== 'shopify' ? 'pages' : 'feed',
        page: 1,
        pending: [],
        other: [],
        pos: 0,
        progress: 1,
      };
    }
  }

  // ── the store asked to wait (Retry-After) at the end of the last step: wait
  // it out here when this step can afford it, else stop before any request.
  if (!stopped && st.not_before) {
    const wait = st.not_before - Date.now();
    if (wait > 0) {
      if (wait <= ctx.deadline - Date.now() - 5000) { stats.waited_ms += wait; await sleep(wait); }
      else stopped = { reason: 'rate_limited', at: st.waited_at || 'the last place read', retry_after: st.retry_after || null, wait_ms: wait, waiting: true };
    }
    if (!stopped) { delete st.not_before; delete st.retry_after; delete st.waited_at; }
  }

  // ── the site's sitemaps, resumable.
  if (!stopped && st.sm && !st.sm.done) {
    const halt = await enumerateSitemaps(st, ctx);
    if (halt) stopped = halt;
    else if (!st.sm.done) stopped = { reason: 'time', at: `sitemap ${st.sm.read + 1} of at least ${st.sm.read + st.sm.queue.length} (enumerating the site's sitemaps)` };
    if (st.sm.done) finishSitemaps(st, stats);
  }

  // ── the feed.
  if (!stopped && st.route === 'feed') {
    const feedPath = `${st.base}/products.json`;
    // Shopify, declared by the store itself: the feed is the route and a
    // rate limit is waited out. Undeclared: the feed is PROBED - one request,
    // no retries - and anything but a page of products moves the read to the
    // site's own sitemaps (2026-10-11: Nykaa, not Shopify, stuck at "feed
    // page 1" behind a 429 on a feed it does not have).
    const declaredShopify = !!(st.storefront && st.storefront.id === 'shopify');
    const pagesRoute = () => (st.sm && st.sm.found ? 'sitemap' : 'crawl');
    if (!(await allowed(feedPath, ctx))) {
      st.feed_refused = 'robots';
      st.route = pagesRoute();
    } else {
      while (Date.now() < ctx.deadline - 2000) {
        if (st.page > LIMITS.maxFeedPages) { stats.skipped.cap += 1; st.route = 'done'; st.feed_cap = true; break; }
        const feedUrl = `${feedPath}?limit=${LIMITS.feedPageSize}&page=${st.page}`;
        const probing = !declaredShopify && st.page === 1 && !st.feed_confirmed;
        const r = await getPolite(feedUrl, ctx, probing ? { accept: 'application/json', retries: 0 } : { accept: 'application/json' });
        let list = null;
        if (r.ok) { try { const j = JSON.parse(r.body); list = Array.isArray(j && j.products) ? j.products : null; } catch (_) { list = null; } }
        if (probing && !(list && list.length)) {
          st.feed_refused = r.reason === 'rate_limited' ? 'answered 429, asked to slow down'
            : (r.ok ? (list ? 'answered an empty list' : 'not_a_feed') : `answered ${r.status || r.reason}`);
          st.feed_probe = true;
          st.route = pagesRoute();
          st.progress = (st.progress || 0) + 1;
          break;
        }
        if (r.reason === 'rate_limited') { stopped = { reason: 'rate_limited', at: `feed page ${st.page}`, retry_after: r.retry_after, wait_ms: r.wait_ms }; break; }
        if (r.reason === 'timeout') { stopped = { reason: 'timeout', at: `feed page ${st.page}` }; break; }
        if (!list) {
          if (st.page === 1) {
            // No feed here: the store has it off, or it is not a Shopify store.
            st.feed_refused = r.ok ? 'not_a_feed' : `answered ${r.status || r.reason}`;
            st.route = pagesRoute();
            st.progress = (st.progress || 0) + 1;
            break;
          }
          stopped = { reason: 'unreachable', at: `feed page ${st.page} (${r.status || r.reason})` };
          break;
        }
        if (!list.length) { st.route = 'done'; st.progress = (st.progress || 0) + 1; break; }   // an EMPTY page is the end; a short one is not
        st.feed_confirmed = true;
        stats.feed_pages += 1;
        if (st.page === 1) st.pending = [];               // the feed answers: the sitemap list is only the denominator now
        for (const p of list) {
          const row = rowFromFeed(p, { region: reg, base: st.base, currency: st.currency, feedUrl });
          if (!row) { stats.skipped.no_title += 1; continue; }
          if (keep(row)) stats.by_source.feed += 1;
        }
        st.page += 1;
        st.progress = (st.progress || 0) + 1;
      }
      if (!stopped && st.route === 'feed') stopped = { reason: 'time', at: `feed page ${st.page}` };
    }
  }

  // ── the sitemap's product pages.
  //
  // THROTTLING (2026-10-11, the live Nykaa probe: 1,297 product pages "did
  // not answer" - the store dropping parallel connections, not 1,297 dead
  // pages). A page that fails with no answer, a 403 or a 5xx is RETRIED, never
  // written off on its first try; when at least half a batch fails that way
  // the read halves its parallelism (to one at a time) and backs off, and it
  // speeds up again after a run of answers. A page is reported unreachable
  // only after failing at one-at-a-time three times. A store that refuses even
  // one at a time stops the step ('throttled') with a wait; the next step
  // (or the chain) resumes after it. A 404/410 is a page the sitemap lists and
  // the store no longer has: counted apart, as stale entries.
  if (!stopped && st.route === 'sitemap') {
    const pending = Array.isArray(st.pending) ? st.pending : [];
    if (!Array.isArray(st.retry)) st.retry = [];
    if (!st.conc) st.conc = LIMITS.pdpConcurrency;
    const fetchOne = async (it) => {
      const u = it.u;
      if (!ctx.inScope(u)) return { it, skip: 'off_scope' };
      if (!(await allowed(u, ctx))) return { it, skip: 'robots' };
      const r = await getPolite(u, ctx, { accept: 'text/html' });
      if (r.reason === 'rate_limited') return { it, stop: { reason: 'rate_limited', retry_after: r.retry_after, wait_ms: r.wait_ms } };
      if (r.reason === 'timeout') return { it, stop: { reason: 'timeout' } };
      if (r.status === 404 || r.status === 410) return { it, skip: 'not_found', status: r.status };
      if (!r.ok && (r.status === 0 || r.status === 403 || r.status >= 500)) return { it, transient: r.status || r.reason };
      if (!r.ok) return { it, skip: 'unreachable', status: r.status || r.reason };
      if (r.url !== u && !ctx.inScope(r.url)) return { it, skip: 'off_scope' };
      return Object.assign({ it }, rowFromPage(r.body, r.url, { region: reg, source: 'sitemap_jsonld' }));
    };
    while ((st.pos < pending.length || st.retry.length) && Date.now() < ctx.deadline - 1500) {
      const retrying = st.retry.length > 0 && (st.pos >= pending.length || st.retry_due);
      const batch = retrying ? st.retry.splice(0, st.conc) : pending.slice(st.pos, st.pos + st.conc).map((u) => ({ u, tries: 0 }));
      st.retry_due = false;
      const results = await Promise.all(batch.map(fetchOne));
      let halt = null, advanced = 0, failed = 0, answered = 0;
      for (let i = 0; i < results.length; i++) {
        const x = results[i];
        if (x.stop) {
          halt = Object.assign({ at: retrying ? `a retried URL (${x.it.u})` : `URL ${st.pos + advanced + 1} of ${pending.length}` }, x.stop);
          if (retrying) st.retry.unshift(...results.slice(i).map((y) => y.it));
          break;
        }
        advanced += 1;
        if (x.transient != null) {
          failed += 1;
          x.it.tries = (x.it.tries || 0) + 1;
          x.it.last = x.transient;
          if (x.it.tries >= 3 && st.conc === 1) {
            stats.skipped.unreachable += 1;
            if (stats.unreachable_examples.length < 10) stats.unreachable_examples.push(`${x.it.u} (${x.transient})`);
          } else st.retry.push(x.it);
          continue;
        }
        answered += 1;
        if (x.skip) {
          stats.skipped[x.skip] = (stats.skipped[x.skip] || 0) + 1;
          if (x.skip === 'robots' && stats.robots_examples.length < 10) stats.robots_examples.push(x.it.u);
          if ((x.skip === 'unreachable' || x.skip === 'not_found') && stats.unreachable_examples.length < 10) stats.unreachable_examples.push(`${x.it.u} (${x.status})`);
          if (x.skip === 'script_rendered' && stats.script_examples.length < 10) stats.script_examples.push(x.it.u);
          continue;
        }
        if (x.row && keep(x.row)) stats.by_source.sitemap_jsonld += 1;
      }
      if (!retrying) st.pos += advanced;
      st.progress = (st.progress || 0) + answered + (retrying ? 0 : advanced - answered - failed);
      if (halt) { stopped = halt; break; }
      if (failed && failed * 3 >= batch.length) {
        // The store is shedding parallel requests: fewer at a time, a pause,
        // and the failed pages again before new ones.
        stats.throttled = (stats.throttled || 0) + 1;
        stats.min_conc = Math.min(stats.min_conc || LIMITS.pdpConcurrency, Math.max(1, Math.floor(st.conc / 2)));
        st.fail_streak = (st.fail_streak || 0) + 1;
        if (st.conc === 1 && st.fail_streak >= 4 && !answered) {
          stopped = { reason: 'throttled', at: `URL ${st.pos} of ${pending.length}`, wait_ms: 60000 };
          break;
        }
        // The level that failed is the ceiling from now on: speed returns up
        // to one below it, never back to where the store shed requests.
        st.ceiling = Math.max(1, st.conc - 1);
        st.conc = Math.max(1, Math.floor(st.conc / 2));
        st.ok_streak = 0;
        st.retry_due = true;
        const wait = Math.min(8000, 1000 * Math.pow(2, Math.min(3, st.fail_streak - 1)));
        if (wait < ctx.deadline - Date.now() - 2000) { stats.throttle_waited_ms = (stats.throttle_waited_ms || 0) + wait; await sleep(wait); }
      } else if (!failed) {
        st.fail_streak = 0;
        st.ok_streak = (st.ok_streak || 0) + batch.length;
        if (st.ok_streak >= 24 && st.conc < (st.ceiling || LIMITS.pdpConcurrency)) { st.conc += 1; st.ok_streak = 0; }
        if (st.retry.length) st.retry_due = true;
      }
    }
    if (!stopped) {
      if (st.pos >= pending.length && !st.retry.length) st.route = 'done';
      else stopped = { reason: 'time', at: st.pos < pending.length ? `URL ${st.pos + 1} of ${pending.length}` : `${st.retry.length} URL(s) to retry` };
    }
  }

  // ── no sitemap: the interlinked pages, resumable.
  if (!stopped && st.route === 'crawl') {
    const visited = new Set(st.visited || []);
    const before = visited.size;
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
        else if (got.skip === 'script_rendered') { stats.skipped.script_rendered += 1; if (stats.script_examples.length < 10) stats.script_examples.push(pageUrl); }
      },
    });
    st.visited = [...visited].slice(-3000);
    st.frontier = (out.frontier_remaining || []).slice(0, 400);
    st.progress = (st.progress || 0) + (visited.size - before);
    if (out.stopped === 'exhausted' || !st.frontier.length) st.route = 'done';
    else stopped = { reason: 'time', at: `${visited.size} pages read, ${st.frontier.length} queued` };
  }

  // A wait the store asked for, kept for the next step to honour.
  if (stopped && (stopped.reason === 'rate_limited' || stopped.reason === 'throttled') && stopped.wait_ms && !stopped.waiting) {
    st.not_before = Date.now() + stopped.wait_ms;
    st.retry_after = stopped.retry_after || null;
    st.waited_at = stopped.at;
  }
  const complete = st.route === 'done';
  st.seen_keys = [...seen].slice(-(LIMITS.maxProducts * 2));
  st.stats = stats;
  const progressed = (st.progress || 0) > progressBefore || rows.length > 0;
  const coverage = coverageOf(st, stats, { complete, stopped, region: reg });
  coverage.progressed = progressed;
  return {
    rows, run, base: st.base, storefront,
    complete, progressed,
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
  const sm = st.sm || null;
  if (sm && !sm.done) {
    // Still enumerating: what the sitemaps read so far list, never a total.
    s.push(`Found ${plural(found, 'product')} so far. The site's sitemaps are still being read (${plural(sm.read, 'sitemap')} read, at least ${plural(sm.queue.length, 'more')} to go)${sm.typed_any ? `; its product sitemaps list ${plural(sm.typed_total, 'product')} so far` : ''}, so the total it declares is not known yet.`);
  } else if (declared) s.push(`Found ${found.toLocaleString('en-US')} of the ${plural(declared, 'product')} the site declares in ${st.declared.by}.`);
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
  else if (st.feed_probe) s.push(`No commerce platform declared itself on the pages read, so Shopify's product feed (/products.json) was tried once; it ${st.feed_refused === 'not_a_feed' ? 'is not a product feed' : st.feed_refused}, so ${st.route === 'crawl' || (st.sm && !st.sm.found) ? 'the site\'s linked pages were' : 'the site\'s own sitemaps and product pages were'} read instead.`);
  if (st.declared && st.declared.complete === false) s.push(`The total above is what the sitemaps read list: this importer reads at most ${LIMITS.maxSitemaps.toLocaleString('en-US')} sitemaps per import and the site declares more.`);
  if (sm && sm.done && sm.notes && sm.notes.length) for (const n of sm.notes.slice(0, 3)) s.push(n);
  const k = stats.skipped;
  if (k.robots) s.push(`${plural(k.robots, 'page')} skipped because robots.txt disallows ${k.robots === 1 ? 'it' : 'them'}${stats.robots_examples.length ? ` (e.g. ${stats.robots_examples.slice(0, 2).join(', ')})` : ''}.`);
  if (k.off_scope) s.push(`${plural(k.off_scope, 'URL')} skipped because ${k.off_scope === 1 ? 'it is' : 'they are'} not on the brand's own hosts.`);
  if (k.no_product_declared) s.push(`${plural(k.no_product_declared, 'page')} in the sitemap declare no product (no JSON-LD Product and no OpenGraph product tags), so nothing was taken from ${k.no_product_declared === 1 ? 'it' : 'them'}.`);
  if (k.script_rendered) s.push(`${plural(k.script_rendered, 'page')} declare${k.script_rendered === 1 ? 's' : ''} ${k.script_rendered === 1 ? 'its' : 'their'} product only after JavaScript runs (the page as served is an application shell with no JSON-LD or OpenGraph product${stats.script_examples && stats.script_examples.length ? `, e.g. ${stats.script_examples[0]}` : ''}); this importer reads pages as served, so nothing was taken from ${k.script_rendered === 1 ? 'it' : 'them'}. A CSV or JSON export of the catalogue covers them.`);
  if (k.no_title) s.push(`${plural(k.no_title, 'product')} skipped because ${k.no_title === 1 ? 'it states' : 'they state'} no title.`);
  if (k.not_found) s.push(`${plural(k.not_found, 'URL')} the sitemaps list answered 404 or 410: the sitemap lists pages the store no longer has (stale entries), so there was nothing to read.`);
  if (stats.throttled) s.push(`The store stopped answering requests made in parallel ${plural(stats.throttled, 'time')} (throttling, not missing pages): the importer slowed to ${stats.min_conc || 1} at a time, backed off (${Math.round((stats.throttle_waited_ms || 0) / 1000)} s in all) and read every failed page again.`);
  if (k.unreachable) s.push(`${plural(k.unreachable, 'page')} did not answer even when read one at a time, three times${stats.unreachable_examples.length ? ` (e.g. ${stats.unreachable_examples[0]})` : ''}.`);
  if (k.wrong_currency) s.push(`${plural(k.wrong_currency, 'product')} priced in another currency than ${R}'s ${marketCurrency(region)} ${k.wrong_currency === 1 ? 'was' : 'were'} not filed under ${R}${stats.currency_examples && stats.currency_examples.length ? ` (e.g. ${stats.currency_examples[0]})` : ''}: a row belongs to the market whose prices it carries.`);
  if (stats.rate_limited) s.push(`The store asked to slow down ${plural(stats.rate_limited, 'time')}; every Retry-After was obeyed (${Math.round(stats.waited_ms / 1000)} s waited in all).`);
  if (k.duplicate) s.push(`${plural(k.duplicate, 'duplicate')} (the same handle or URL listed twice) counted once.`);
  const capUrls = (stats.cap_urls || 0) + (k.cap || 0);
  if (capUrls) s.push(`LIMIT: this importer reads at most ${LIMITS.maxProducts.toLocaleString('en-US')} product URLs per market per import (the list of URLs still to read travels on the brand's row between steps), so the first ${LIMITS.maxProducts.toLocaleString('en-US')} the sitemaps list were read and ${capUrls.toLocaleString('en-US')} more were not.`);
  const om = st.sm && st.sm.other_markets ? Object.values(st.sm.other_markets) : [];
  for (const f of om.slice(0, 12)) s.push(`${f.prefix}/ is the ${f.country || 'another market\'s'} store${f.products ? `: ${plural(f.products, 'product')} in its product sitemaps` : ''}, not read for ${R}.`);
  if (st.sm && st.sm.non_product && st.sm.non_product.count) s.push(`${plural(st.sm.non_product.count, 'sitemap')} of pages that are not products (blog, reviews, categories, pages${st.sm.non_product.examples.length ? `, e.g. ${st.sm.non_product.examples[0]}` : ''}) ${st.sm.non_product.count === 1 ? 'was' : 'were'} not read for the catalogue.`);
  const m = stats.missing;
  if (m.price) s.push(`${plural(m.price, 'product')} state no price; ${m.price === 1 ? 'it carries' : 'they carry'} ${MARKER('price', '<product>', R)} rather than a number.`);
  if (m.image) s.push(`${plural(m.image, 'product')} state no image; ${m.image === 1 ? 'it carries' : 'they carry'} ${MARKER('product image', '<product>', R)}.`);
  if (m.currency) s.push(`${plural(m.currency, 'price')} carry no currency the store declared; ${MARKER('currency', '<product>', R)}.`);
  if (stopped) {
    const why = stopped.reason === 'rate_limited'
      ? `the store asked to slow down (429${stopped.retry_after ? `, Retry-After ${stopped.retry_after}` : ''}) at ${stopped.at}`
      : stopped.reason === 'throttled' ? `the store kept refusing requests even one at a time at ${stopped.at} (throttling); the next step waits ${Math.round((stopped.wait_ms || 0) / 1000)} s and retries`
      : stopped.reason === 'robots_unreachable'
        ? `robots.txt could not be read (${stopped.at}); RFC 9309 says to treat that as "disallow everything", so nothing was read`
        : stopped.reason === 'timeout' ? `a request timed out at ${stopped.at}`
          : stopped.reason === 'unreachable' ? `the store stopped answering at ${stopped.at}`
            : `this run's time ran out at ${stopped.at}`;
    s.push(`PARTIAL: ${why}. Continue import resumes exactly there; the daily refresh also continues it.`);
  } else if (complete && found === 0) {
    // A read that found NOTHING is never called complete (2026-10-11: "Complete:
    // every product the source lists was read" beside 0 products, on a store
    // of thousands). Say what it reached and what it could not.
    const reached = [];
    if (st.sm) reached.push(`${plural(st.sm.read || 0, 'sitemap')} read${st.sm.not_sitemaps ? ` (${st.sm.not_sitemaps} answered something that is not a sitemap)` : ''}`);
    if (st.declared && (st.declared.count || st.declared.urls)) reached.push(`${plural(st.declared.count || st.declared.urls, 'URL')} they list visited`);
    if (stats.feed_pages) reached.push(`${plural(stats.feed_pages, 'feed page')} read`);
    if (Array.isArray(st.visited) && st.visited.length) reached.push(`${plural(st.visited.length, 'linked page')} crawled`);
    s.push(`NOT COMPLETE: no product was read. The importer reached the end of what it could see (${reached.join('; ') || 'nothing it could read'}) and none of it declared a product a page carries as served. This is not the store's catalogue; import a CSV or JSON export, or add structured product data to the product pages.`);
  } else if (complete && declared && found < declared) {
    s.push(`Complete: every URL the source lists was visited; ${plural(declared - found, 'of them', 'of them')} did not yield a product, for the reasons above.`);
  } else if (complete) {
    s.push('Complete: every product the source lists was read.');
  }
  return {
    route: st.route === 'done' ? (stats.by_source.feed ? 'feed' : stats.by_source.sitemap_jsonld ? 'sitemap' : 'crawl') : st.route,
    region: R, base: st.base, base_from: st.base_from, start: st.start || st.base, currency: st.currency || null,
    foreign_stores: Array.isArray(st.foreign_stores) ? st.foreign_stores : [],
    declared: st.declared || (sm && !sm.done && sm.typed_any ? { count: sm.typed_total, urls: null, by: 'the site\'s product sitemaps read so far', partial: true } : null), found,
    by_source: stats.by_source, skipped: stats.skipped, missing: stats.missing,
    missing_examples: stats.missing_examples.slice(0, 10),
    robots_examples: stats.robots_examples.slice(0, 10),
    complete: complete && found > 0, empty: complete && found === 0, stopped: stopped || null, resume_available: !complete,
    not_before: st.not_before ? new Date(st.not_before).toISOString() : null,
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

async function serviceCall(env, pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${env.url}/rest/v1/${pathAndQuery}`, {
    method, cache: 'no-store', headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!r.ok) { const e = new Error(`supabase ${method} ${pathAndQuery.split('?')[0]} -> ${r.status}: ${(json && json.message) || text}`); e.status = r.status; throw e; }
  return json;
}

const STORE_KINDS = ['shopify_public', 'site_crawl', 'storefront', 'site'];
const REFRESH_AFTER_MS = 20 * 3600 * 1000;

/* ── the import CONTINUES BY ITSELF (2026-10-11) ─────────────────────────────
   The live Lenskart record read 450 of 2,430 products in one call and then
   waited for a person to press Continue import (or for the next day's cron).
   A store read is a convergent queue on the brand's row, the same shape as
   smart-brain-plan.prebuildAssets(): each step persists its cursor, then fires
   the NEXT step as an independent invocation of this deployment's own URL
   (fire-and-forget, a 3 s handoff - the child keeps running after the parent's
   connection drops), until the store is read.

     - the next step is POST /api/public-config?action=brand&op=catalog-chain,
       accepted only with the scheduler's CRON_SECRET (constant-time), so the
       chain needs no person's token (which would expire mid-catalogue);
     - the row carries `catalog_import.chain = { token, depth, active, ... }`;
       a step runs only for the token it was fired with and CLAIMS it with a
       conditional PATCH on that token, so a duplicate fire, a stale fire after
       a person restarted the import, or two chains never read one cursor;
     - a step that moved nothing forward (no sitemap, page or feed page) ends
       the chain and says why - never a hot loop; so does LIMITS-sized depth;
     - a Retry-After the next step can wait is waited at its start; a longer
       one ends the chain and records when the store may be asked again (the
       daily refresh honours it);
     - a deployment that cannot address itself (no SELF_BASE_URL / VERCEL_URL)
       or has no CRON_SECRET says so, and the browser drives the steps instead.
   The daily cron stays as the backstop. */
const CHAIN = {
  maxSteps: 400,
  stepMs: 90000,          // a chained step's budget: public-config.js allows 120 s
  maxWaitMs: 80000,       // the longest Retry-After a next step waits at its start
  handoffMs: 3000,
  liveMs: 150000,         // a chain whose last move is younger than this is running
};

function selfBaseUrl() {
  if (process.env.SELF_BASE_URL) return String(process.env.SELF_BASE_URL).replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return '';
}
function chainUnavailable() {
  if (!selfBaseUrl()) return 'this deployment cannot address itself (no SELF_BASE_URL or VERCEL_URL)';
  if (!process.env.CRON_SECRET) return 'this deployment has no CRON_SECRET to authorise its own next step';
  if (typeof fetch !== 'function') return 'this runtime has no fetch';
  return '';
}

/**
 * What happens after a step: keep going (fire the next), or stop and why.
 * `parsed` is rowsFromStore's answer, `depth` the step about to be fired.
 */
function chainAfter(parsed, depth, { server = true } = {}) {
  const at = new Date().toISOString();
  if (parsed.complete) return { active: false, done: true, depth, updated_at: at };
  const stop = parsed.coverage && parsed.coverage.stopped;
  if (stop && stop.reason === 'robots_unreachable') return { active: false, depth, updated_at: at, stopped: 'robots.txt could not be read, so nothing may be read until it answers' };
  if (stop && (stop.reason === 'rate_limited' || stop.reason === 'throttled') && stop.wait_ms > CHAIN.maxWaitMs) {
    const until = new Date(Date.now() + stop.wait_ms).toISOString();
    return { active: false, depth, updated_at: at, resume_after: until, stopped: `the store asked to wait ${Math.round(stop.wait_ms / 1000)} s (Retry-After), longer than a step may wait; it is read again after ${until}, by the daily refresh or Continue import` };
  }
  if (!parsed.progressed && !(stop && (stop.reason === 'rate_limited' || stop.reason === 'throttled'))) {
    return { active: false, depth, updated_at: at, stopped: `the last step read nothing new${stop ? ` (${stop.reason === 'timeout' ? 'a request timed out' : stop.reason === 'unreachable' ? 'the store stopped answering' : 'its time ran out'} at ${stop.at})` : ''}, so it was not started again automatically` };
  }
  if (depth > CHAIN.maxSteps) return { active: false, depth, updated_at: at, stopped: `it has run ${CHAIN.maxSteps} steps in a row` };
  if (!server) return { active: false, depth, updated_at: at, browser: true };
  const why = chainUnavailable();
  if (why) return { active: false, depth, updated_at: at, browser: true, why };
  return { active: true, fire: true, token: crypto.randomUUID(), depth, updated_at: at };
}

/** The sentence the coverage carries about who continues the import. */
function chainSentence(chain) {
  if (!chain || chain.done) return '';
  if (chain.active) return `It is continuing by itself: step ${chain.depth + 1} was started automatically and resumes exactly there, so nothing needs pressing.`;
  if (chain.browser && !chain.stopped) return `It continues from this page: the next step is started automatically while the page is open${chain.why ? ` (the server does not start it itself: ${chain.why})` : ''}, and Continue import or the daily refresh resumes it later.`;
  if (chain.stopped) return `It is not continuing by itself: ${chain.stopped}.`;
  return '';
}

/** A chain that moved recently is running; Continue import and the cron leave it alone. */
function chainBusy(imp, now) {
  const c = imp && imp.chain;
  if (!c || !c.active) return false;
  const t = Date.parse(c.claimed_at || c.updated_at || 0) || 0;
  return (now || Date.now()) - t < CHAIN.liveMs;
}

/** Fire the next step and return once it has started (or after the handoff window). */
async function fireNext({ workspace_id, token, depth, budget_ms }) {
  const why = chainUnavailable();
  if (why) return { fired: false, reason: why };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAIN.handoffMs);
  try {
    await fetch(`${selfBaseUrl()}/api/public-config?action=brand&op=catalog-chain`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: JSON.stringify({ workspace_id, token, depth, budget_ms: budget_ms || undefined }),
    });
  } catch (_) { /* expected: the child runs longer than the handoff window */ }
  finally { clearTimeout(timer); }
  return { fired: true };
}

/** Rows a previous import filed under another spelling of this market ("ind" for "in"), staled by a complete run. */
async function staleAliasRegions(call, { workspace, reg, run, family }) {
  for (const alias of regionAliases(reg)) {
    try { await call('rpc/brand_catalog_merge', { p_workspace: workspace, p_region: alias, p_rows: [], p_run: run, p_complete: true, p_family: family, p_state: null, p_source: null }); }
    catch (_) { /* an older database without the merge: nothing to stale */ }
  }
}

/**
 * One step of a workspace's store import, as the service role: resume the
 * cursor on its row (or read the store again from the start), merge what was
 * read, record the state + chain in the same transaction, and fire the next
 * step when there is one to fire. Shared by the daily refresh and the chain.
 */
async function continueWorkspace(env, w, { budgetMs, by, depth = 0 } = {}) {
  const imp = w.catalog_import || {};
  const src = w.catalog_source || {};
  const resume = imp.cursor ? imp : null;
  const region = canonRegion((resume && resume.region) || src.region || imp.region || '') || String((resume && resume.region) || src.region || imp.region || '').toLowerCase();
  // The URL the import was asked for (the cursor's start), never the store
  // another brand's site supplied: a recorded source on another domain than
  // the website refreshes from the website, and its cursor is not resumed.
  let url = (resume && ((resume.cursor && resume.cursor.start) || resume.url)) || src.url || imp.url;
  const ident = identityOf(w);
  if (ident && url && !COH.sameBrand(COH.registrableDomain(COH.hostOf(url)), ident) && w.website) url = w.website;
  const cursorIn = resume && !cursorProblem(resume.cursor, { region, url, identity: ident }) ? resume.cursor : null;
  if (!region) throw new Error('no market recorded for this catalogue');
  const core = require('./brand-workspace-core.js');
  const parsed = await core.rowsFromStore(url, region, w, { cursor: cursorIn, budgetMs });
  const run = parsed.run;
  const complete = !!parsed.complete;
  const kind = src.kind && /site/.test(src.kind) ? 'site_crawl' : 'shopify_public';
  const chain = chainAfter(parsed, depth + 1);
  const sentence = chainSentence(chain);
  if (sentence && parsed.coverage && Array.isArray(parsed.coverage.sentences)) parsed.coverage.sentences.push(sentence);
  const source = core.catalogSourceRecord(parsed, kind === 'site_crawl' ? 'site' : 'storefront', url, parsed.rows.length, run, region);
  source.refreshed_by = by || 'daily refresh';
  const state = { run, kind: kind === 'site_crawl' ? 'site' : 'storefront', url: parsed.start || url, base: parsed.base || '', region, cursor: complete ? null : parsed.cursor, coverage: core.coverageSummary(parsed.coverage), updated_at: new Date().toISOString(), refreshed_by: by || 'daily refresh', chain: Object.assign({}, chain, { fire: undefined }) };
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
  if (complete) await staleAliasRegions((p, body) => serviceCall(env, p, { method: 'POST', body }), { workspace: w.id, reg: region, run, family: familyOf(kind) });
  try { require('./brand-catalog-server.js').invalidate(w.id); } catch (_) { /* cache only */ }
  let fired = null;
  if (chain.fire) fired = await fireNext({ workspace_id: w.id, token: chain.token, depth: chain.depth, budget_ms: budgetMs });
  return { workspace_id: w.id, continued: !!cursorIn, found: parsed.coverage.found, complete, progressed: !!parsed.progressed, inserted: merged.inserted, updated: merged.updated, staled: merged.staled, chain: state.chain, fired: !!(fired && fired.fired) };
}

/**
 * One link of the chain (op=catalog-chain, CRON_SECRET only). Runs only when
 * the row still names `token`, claims it first, then continues the import.
 */
async function chainStep({ workspace_id, token, budget_ms } = {}) {
  const env = serviceEnv();
  if (!env) return { ok: false, skipped: 'no_service_role', note: 'No Supabase service role on this deployment, so there is no workspace catalogue to continue.' };
  const id = String(workspace_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !token) return { ok: false, skipped: 'bad_request' };
  const rows = await serviceCall(env, `brand_workspaces?select=id,website,regions,asset_hosts,catalog_source,catalog_import&id=eq.${encodeURIComponent(id)}&limit=1`);
  const w = Array.isArray(rows) && rows[0];
  const imp = (w && w.catalog_import) || {};
  if (!w || !imp.cursor || !imp.chain || !imp.chain.active || imp.chain.token !== token) return { ok: true, skipped: 'superseded' };
  // The claim: only one invocation moves this token on.
  const claimed = Object.assign({}, imp, { chain: Object.assign({}, imp.chain, { token: crypto.randomUUID(), claimed_at: new Date().toISOString() }) });
  const got = await serviceCall(env, `brand_workspaces?id=eq.${encodeURIComponent(id)}&catalog_import->chain->>token=eq.${encodeURIComponent(token)}&select=id`, { method: 'PATCH', body: { catalog_import: claimed }, prefer: 'return=representation' });
  if (!Array.isArray(got) || !got.length) return { ok: true, skipped: 'claimed_elsewhere' };
  w.catalog_import = claimed;
  const budget = Math.max(1000, Math.min(Number(budget_ms) || CHAIN.stepMs, CHAIN.stepMs));
  const out = await continueWorkspace(env, w, { budgetMs: budget, by: 'continuing by itself', depth: imp.chain.depth || 0 });
  return Object.assign({ ok: true }, out);
}

/**
 * Keep every brand's store catalogue current, a few brands per run: an import
 * that stopped part-way CONTINUES from its cursor first; then the brand whose
 * last read is oldest is read again from the start (a complete re-read is what
 * marks a product the store dropped as stale). A catalogue a person uploaded
 * (CSV / JSON) has no store to re-read and is never touched. An import that is
 * continuing by itself is left to its chain; one whose store asked to wait is
 * left until that time.
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
  const waiting = (w) => { const c = w.catalog_import && w.catalog_import.chain; const t = c && c.resume_after ? Date.parse(c.resume_after) : 0; return t && t > started; };
  const partial = list.filter((w) => w.catalog_import && w.catalog_import.cursor && !chainBusy(w.catalog_import, started) && !waiting(w)).sort((a, b) => at(a) - at(b));
  const stale = list.filter((w) => !(w.catalog_import && w.catalog_import.cursor) && started - at(w) > REFRESH_AFTER_MS).sort((a, b) => at(a) - at(b));
  const due = partial.concat(stale);
  const picked = due.slice(0, maxWorkspaces);
  const refreshed = [];
  for (let i = 0; i < picked.length; i++) {
    const w = picked[i];
    const left = budgetMs - (Date.now() - started);
    if (left < 4000) break;
    const share = Math.floor(left / (picked.length - i));
    try {
      refreshed.push(await continueWorkspace(env, w, { budgetMs: share, by: 'daily refresh', depth: 0 }));
    } catch (e) {
      refreshed.push({ workspace_id: w.id, continued: !!(w.catalog_import && w.catalog_import.cursor), error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  return {
    ok: true, due: due.length, refreshed,
    note: due.length > picked.length ? `${due.length - picked.length} more catalogue(s) are due and are taken on the next runs, oldest first.` : '',
  };
}

module.exports = {
  refreshDue, chainStep, continueWorkspace, chainAfter, chainSentence, chainBusy, fireNext, staleAliasRegions, selfBaseUrl, CHAIN,
  step, mergeRows, familyOf, rowKey, coverageOf,
  rowFromFeed, rowFromPage, enumerateSitemaps, isProductSitemap, sitemapClass, foreignLocale, marketCurrency, scriptRendered, parseRobots, robotsAllows, retryAfterMs,
  regionalBase, ownScope, identityOf, cursorProblem, foreignStoreSentence, declaredCurrency, handleFromUrl, canonRegion, regionAliases, LIMITS, USER_AGENT, MARKER,
};
