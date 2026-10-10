'use strict';
/**
 * brand-catalog-server.js — the SERVER's answer to "whose products are these?".
 *
 * The browser already had one (`/brand-catalog.js`, `window.BrandCatalog`). The
 * server did not, and that is the whole bug: every image and product resolver on
 * this side read `data/catalog/products_{us,uk,global}.json` off disk with no
 * idea which workspace it was generating for. Those files are TENANT ZERO'S 436
 * hand-painted sneakers, so a news publisher's mailer was built from them and
 * shipped with a custom Nike Air Force 1 in the hero slot.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * An asset for brand X uses brand X's own catalogue, or NO asset at all.
 * There is no third option where another brand's photo renders under a caveat.
 *
 * ── THE THREE SOURCES, IN ORDER ────────────────────────────────────────────
 *   'brand'   the workspace's own rows in `brand_catalog_products`, filtered by
 *             workspace_id (the table onboarding imports into).
 *   'shipped' the static JSON — ONLY when the caller is tenant zero. Those files
 *             are not "the catalogue", they are one tenant's catalogue, and this
 *             is the same gate `market-analytics.ownsBundledExport()` puts on the
 *             bundled sales export. That helper is reused rather than answered a
 *             second time here.
 *   'none'    everything else: an empty product list plus a `reason`. Callers
 *             render image-free and emit
 *             `[DATA REQUIRED BEFORE LAUNCH: product image, <product>, <region>]`,
 *             exactly as scripts/build-july-mailers.js already does.
 *
 * ── WHY THERE IS A SYNC PATH AT ALL ────────────────────────────────────────
 * `catalog-image.js` is called from ~21 sites inside SYNCHRONOUS renderers
 * (emailHtml, renderVariant, lpHtml, the ad builders). A per-workspace read is
 * async, so the two are reconciled in two halves:
 *
 *   ASYNC  `withCatalog({brand, workspaceId}, fn)` resolves the workspace's rows
 *          ONCE and pins them to the async continuation of that one generation
 *          via AsyncLocalStorage. Called at the generation entry points
 *          (buildCampaign and friends), never per render.
 *   SYNC   `productsFor(market, {brand})` answers from that scope. With no scope
 *          it still applies the BRAND GATE synchronously: a brand that is not
 *          tenant zero never reads the shipped files, whatever else is true.
 *
 * A module-level `CACHE[region]` keyed by nothing — which is what catalog-image
 * had — is precisely the cross-brand leak `workspace-scope.js` warns about: a
 * warm Node runtime serves several workspaces from one process. Every cache
 * here is keyed by workspace id (or is the immutable shipped file, which belongs
 * to exactly one tenant by definition).
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 */

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const SCOPE = new AsyncLocalStorage();

/**
 * How many of a workspace's own products one generation may hold in memory.
 * It was 500 and read in ONE request ordered by title, so a brand that imported
 * 2,600 products reached every generator as its first 500 alphabetically, and
 * PostgREST's max_rows (1,000) would have cut a larger single read anyway
 * (measured 2026-10-10). Rows are read page by page now, up to this ceiling.
 */
const MAX_ROWS = 20000;
/** PostgREST's per-request cap (supabase/config.toml [api] max_rows). */
const PAGE_ROWS = 1000;
/** Per-workspace catalogue cache TTL. Short: an import must show up promptly. */
const TTL = 60_000;

// ── regions ────────────────────────────────────────────────────────────────
function regionKey(market) {
  // No market named: the brand-in-scope's HOME market, not 'US' (2026-10-05).
  // Any other market is ITS OWN key (ae, sg, eu...) - it used to be 'us', so
  // a brand's AE rows were looked up as US rows and an empty ask read the US
  // file. shippedRegion() below decides which of tenant zero's three files
  // backs a key; a brand's own rows are matched on the key itself.
  const m = String(market || require('./brand-locale.js').defaultMarket() || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!m) return '';
  if (m.startsWith('uk') || m === 'gb' || m === 'unitedkingdom') return 'uk';
  if (m === 'us' || m === 'usa' || m === 'unitedstates') return 'us';
  if (/^(global|worldwide|row|rest|intl|international)/.test(m)) return 'global';
  if (m === 'india' || m === 'ind') return 'in';
  return m;
}
/** Which SHIPPED file backs a region. `in` has no built file (see build-catalog.js). */
function shippedRegion(market) {
  const r = regionKey(market);
  return (r === 'us' || r === 'uk' || r === 'global') ? r : 'global';
}

// ── tenant zero ────────────────────────────────────────────────────────────
/**
 * Tenant zero's slug, read from the brand record rather than hardcoded, so a
 * rebrand of `data/brands/_default.json` cannot leave a stale literal behind.
 */
let _zeroSlug = null;
function tenantZeroSlug() {
  if (_zeroSlug !== null) return _zeroSlug;
  try {
    const b = require('./brand-runtime.js').defaultBrand() || {};
    _zeroSlug = String(b.slug || b.name || '').toLowerCase();
  } catch (_) { _zeroSlug = ''; }
  return _zeroSlug;
}

/**
 * Is this brand record tenant zero?
 *
 *   true   → it owns the shipped catalogue.
 *   false  → it demonstrably does not; the shipped files are off limits.
 *   null   → no brand was supplied, so the question is undecided and the caller
 *            falls through to the workspace/env rules below.
 *
 * `is_default` / an empty id is how brand-runtime marks the shipped brand, and
 * landing-fallback.js + brain-generate.js already gate on the slug the same way.
 */
function isTenantZeroBrand(brand) {
  if (!brand) return null;
  if (brand.is_default) return true;
  // The server's own determination, when the record carries it
  // (brand-runtime.resolve stamps it from the oldest workspace).
  if (brand.owns_shipped === true) return true;
  if (brand.owns_shipped === false) return false;
  const slug = String(brand.slug || brand.name || '').toLowerCase().trim();
  if (!slug) return null;
  const zero = tenantZeroSlug();
  const claims = !!zero && slug === zero;
  // A WORKSPACE record (it has an id) that merely carries tenant zero's slug
  // is not thereby tenant zero: `brand_workspaces.slug` is unique per OWNER,
  // so any owner can save it (2026-10-05). Undecided, so resolve() asks the
  // workspace rule (ownsBundledExport) and the sync paths use what that
  // pinned. A record with no id is the shipped file's own, and a carried
  // device record has its slug re-keyed (brand-runtime.carriedBrand).
  if (claims && brand.id) return null;
  return claims;
}

// ── the shipped files (tenant zero's own catalogue) ────────────────────────
// Safe to cache module-wide: this is one immutable file describing exactly one
// tenant, and it is only ever HANDED OUT to that tenant.
const SHIPPED = {};
function shipped(market) {
  const r = shippedRegion(market);
  if (SHIPPED[r]) return SHIPPED[r];
  let arr = [];
  try {
    const p = path.join(__dirname, '..', '..', 'data', 'catalog', `products_${r}.json`);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    arr = Array.isArray(raw) ? raw : (raw.products || raw.items || []);
  } catch (_) { arr = []; }
  SHIPPED[r] = Array.isArray(arr) ? arr : [];
  return SHIPPED[r];
}

// ── the workspace's own rows ───────────────────────────────────────────────
/**
 * `brand_catalog_products` rows → the shape every existing reader already
 * understands (n/i/imgs/t/h/price/type/subtitle), so no call site needs two
 * code paths. Nothing is invented: a row with no image_url simply has no image,
 * and the caller renders image-free.
 */
function fromRow(row) {
  if (!row || typeof row !== 'object') return null;
  const title = String(row.title || '').trim();
  const handle = String(row.handle || '').trim();
  if (!title && !handle) return null;
  const img = typeof row.image_url === 'string' && /^https?:\/\//.test(row.image_url) ? row.image_url : '';
  const cols = Array.isArray(row.collections) ? row.collections.map((c) => String(c).toLowerCase()) : [];
  return {
    n: title,
    i: img,
    // Every image the import read for this product (image_urls), the first
    // being image_url; the resolver's provenance rules apply to each.
    imgs: (() => {
      const all = [img].concat(Array.isArray(row.image_urls) ? row.image_urls : [])
        .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
      const uniq = [...new Set(all)].slice(0, 12);
      return uniq.length ? uniq : undefined;
    })(),
    t: cols,
    h: handle,
    sku: row.sku || '',
    price: row.price != null ? row.price : null,
    compare_at: row.compare_at != null ? row.compare_at : null,
    currency: row.currency || '',
    type: row.product_type || '',
    subtitle: '',
    product_url: typeof row.product_url === 'string' && /^https?:\/\//.test(row.product_url) ? row.product_url : '',
    // The page the import read this row from: catalogue identity judges a
    // row by it (catalogRowForeign), never by the CDN its photo is hosted on.
    source_url: typeof row.source_url === 'string' && /^https?:\/\//.test(row.source_url) ? row.source_url : '',
    region: String(row.region || '').toLowerCase(),
    __workspace_id: row.workspace_id || '',
  };
}

function serviceEnv() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  return (url && key) ? { url, key } : null;
}

/** True when this deployment is multi-tenant at all (a Supabase project exists). */
function supabaseConfigured() {
  return !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
}

const WS_CACHE = new Map();     // workspaceId -> { at, rows }

/**
 * Every product row this workspace owns, across regions, read with the
 * service-role key and EXPLICITLY filtered by workspace_id.
 *
 * The service-role key bypasses RLS, so the filter is the only thing standing
 * between one brand and another's catalogue — see workspace-scope.js, which
 * documents that obligation for every server path.
 */
async function workspaceRows(workspaceId) {
  const id = String(workspaceId || '');
  if (!id) return [];
  const hit = WS_CACHE.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.rows;
  const env = serviceEnv();
  if (!env) return [];
  const cols = 'region,sku,handle,title,product_type,collections,price,compare_at,currency,image_url,product_url,workspace_id';
  // Live rows only: a product a complete re-import no longer found is kept
  // (stale_at) but never built into an asset. A database without migration
  // 20261010002000 has no stale_at / image_urls, and reads the old columns.
  const shapes = [`${cols},image_urls,source_url&stale_at=is.null`, cols];
  try {
    let out = null;
    for (const shape of shapes) {
      const got = [];
      let failed = false;
      let prevFirst = null;
      // Advance by the rows RECEIVED and stop only on an EMPTY page: a short
      // page is what max_rows looks like, not the end.
      for (let offset = 0; offset < MAX_ROWS; ) {
        const q = 'brand_catalog_products'
          + `?select=${shape}`
          + `&workspace_id=eq.${encodeURIComponent(id)}`
          + `&order=title.asc,id.asc&limit=${PAGE_ROWS}&offset=${offset}`;
        const r = await fetch(`${env.url}/rest/v1/${q}`, {
          headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
        });
        if (!r.ok) { failed = true; break; }
        const page = await r.json().catch(() => null);
        if (!Array.isArray(page)) { failed = true; break; }
        if (!page.length) break;
        // A server (or a proxy in front of it) that ignores `offset` hands the
        // same page back for ever: the same first row twice is the end, not
        // more products.
        const first = JSON.stringify(page[0]);
        if (first === prevFirst) break;
        prevFirst = first;
        got.push(...page);
        offset += page.length;
      }
      if (!failed) { out = got; break; }
    }
    if (!out) return [];
    const rows = out.slice(0, MAX_ROWS).map(fromRow).filter(Boolean)
      // Defence in depth: PostgREST already filtered, but a row that somehow
      // carries another workspace's id is dropped rather than rendered.
      .filter((p) => !p.__workspace_id || String(p.__workspace_id) === id);
    WS_CACHE.set(id, { at: Date.now(), rows });
    return rows;
  } catch (_) { return []; }
}

/** Drop a workspace's cached catalogue (called after an import replaces it). */
function invalidate(workspaceId) {
  if (workspaceId) WS_CACHE.delete(String(workspaceId));
  else WS_CACHE.clear();
}

// ── reasons ────────────────────────────────────────────────────────────────
function noCatalogueReason(brand) {
  const name = (brand && brand.name) || 'this brand';
  return `No product catalogue is connected for ${name}. Import one in the brand setup; `
       + 'another brand\'s products, photos and prices are never substituted.';
}
const UNRESOLVED_REASON =
  'The catalogue for this generation could not be attributed to a workspace, so no product '
  + 'data was used. The shipped catalogue describes tenant zero only.';

function none(reason) { return { products: [], source: 'none', reason }; }

/* ── catalogue IDENTITY (2026-10-10) ────────────────────────────────────────
 *
 * Whose rows these are was answered by workspace_id alone: a row in this
 * workspace's table was this brand's product. The live record named Mamaearth
 * carried a catalogue imported from delichic.co.in, and every planner and
 * writer then used Deli Chic's chicken salami as Mamaearth's hero. The
 * coherence rule (brand-coherence.js) already called that catalogue another
 * brand's, but only at activation; a record activated before the rule, or
 * overridden, kept feeding it to generation.
 *
 * Generation now asks the SAME rule (catalogIdentity: brandCoherence's own
 * verdict, never a second domain comparison). A catalogue it judges another
 * brand's, that the person has not kept, contributes no product, photo,
 * name or claim; each remaining row is judged by the page it was read from
 * (catalogRowForeign). Tenant zero's shipped catalogue is not a row and is
 * not judged here.
 */
function catalogVerdict(brand) {
  if (!brand || typeof brand !== 'object') return null;
  if (isTenantZeroBrand(brand) === true) return null;
  try { return require('./brand-coherence.js').catalogIdentity(brand); } catch (_) { return null; }
}
/** The rows of `brand`'s catalogue a generator may use, and what was dropped. */
function identityFilter(rows, brand, verdict) {
  const v = verdict === undefined ? catalogVerdict(brand) : verdict;
  const list = Array.isArray(rows) ? rows : [];
  if (!v) return { rows: list, dropped: 0, verdict: null };
  const C = require('./brand-coherence.js');
  const kept = list.filter((p) => !C.catalogRowForeign(p, v));
  return { rows: kept, dropped: list.length - kept.length, verdict: v };
}
/** The reason a renderer turns into its marker: the marker, then the sentence. */
function foreignCatalogReason(verdict) {
  return `${verdict.marker} ${verdict.sentence}`.trim();
}
function excludedNone(verdict) {
  return Object.assign(none(foreignCatalogReason(verdict)), { catalog_excluded: verdict });
}
/** The workspace's own record, for a generation that named no brand. */
async function workspaceRecord(workspaceId) {
  const env = serviceEnv();
  if (!env || !workspaceId) return null;
  try { return await require('./workspace-scope.js').brandForWorkspace(env, workspaceId); } catch (_) { return null; }
}
/** Rows filtered by catalogue identity; the excluded state when nothing is left. */
function judged(rows, brand) {
  const f = identityFilter(rows, brand);
  if (f.rows.length) return { products: f.rows, source: 'brand', reason: '', zero: false, catalog_excluded: f.verdict && f.verdict.excluded ? f.verdict : null, dropped: f.dropped };
  if (f.verdict && (f.verdict.excluded || f.dropped)) return Object.assign(excludedNone(f.verdict.excluded ? f.verdict : Object.assign({}, f.verdict, {
    sentence: `Every product in this catalogue was read from another brand's site, so none is used for ${(brand && brand.name) || 'this brand'}.`,
  })), { zero: false });
  return null;
}

/* ── tenant zero's OTHER shipped data files ────────────────────────────────
 *
 * data/catalog/ was never the only one. `data/product-types.json` carries
 * tenant zero's product taxonomy, its real product titles and its store's
 * base_url; `data/festivals.json` is one market's calendar;
 * `data/cohort-sizes.json` and `data/analytics/*` are one company's numbers.
 * Every one of them was read straight off disk by modules that serve ALL
 * brands, with no gate at all.
 *
 * That is how /social kept generating one company's sneakers inside another
 * company's workspace after the catalogue itself had been fixed: the products
 * were never coming from the catalogue. They were coming from here.
 *
 * Same rule, same gate, one place: tenant zero may read its own files; a brand
 * that is demonstrably not tenant zero gets `null` and a reason the caller
 * turns into a DATA REQUIRED marker. The check is SYNC and runs before any
 * disk read, so it cannot be defeated by a cache or a missing await.
 */
const TENANT_ZERO_DATA = [
  'data/product-types.json',
  'data/festivals.json',
  'data/cohort-sizes.json',
  'data/linked-db.json',
];

function isTenantZeroDataFile(rel) {
  const r = String(rel || '').replace(/^\.?\//, '');
  return TENANT_ZERO_DATA.includes(r) || r.startsWith('data/analytics/') || r.startsWith('data/catalog/');
}

/**
 * Read one of tenant zero's shipped data files, for a brand that owns it.
 *
 * Returns `{ data, source: 'shipped' }` for tenant zero, and
 * `{ data: null, source: 'none', reason }` for anybody else - never a partial
 * or a substitute, because a plausible substitute is what shipped the bug.
 */
function tenantZeroData(rel, { brand = null, workspaceId = null } = {}) {
  if (!isTenantZeroDataFile(rel)) {
    // Not a tenant-zero file: nothing to gate, read it normally.
    return { data: readJsonRel(rel), source: 'shared', reason: '' };
  }
  const zero = isTenantZeroBrand(brand);
  if (zero === false) {
    return { data: null, source: 'none', reason: noCatalogueReason(brand, workspaceId) };
  }
  if (zero === null) {
    // No brand supplied. Fall back to whatever this generation pinned; if that
    // is another brand, the file is still off limits.
    const scope = currentScope();
    if (scope && scope.brand && isTenantZeroBrand(scope.brand) === false) {
      return { data: null, source: 'none', reason: noCatalogueReason(scope.brand, scope.key) };
    }
    // A workspace record that only CLAIMS tenant zero's slug: shipped only if
    // the workspace rule already pinned it as the owner.
    if (brand && brand.id && !(scope && scope.source === 'shipped')) {
      return { data: null, source: 'none', reason: noCatalogueReason(brand, workspaceId) };
    }
  }
  return { data: readJsonRel(rel), source: 'shipped', reason: '' };
}

function readJsonRel(rel) {
  const fs = require('fs');
  const path = require('path');
  for (const base of [path.join(__dirname, '..', '..'), process.cwd()]) {
    try {
      const f = path.join(base, rel);
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (_) { /* try the next root */ }
  }
  return null;
}

// ── the async half: resolve, then pin to the generation ────────────────────
/**
 * Resolve the catalogue that belongs to {brand, workspaceId}.
 *
 * Order is deliberate. The BRAND identity is decided first because it is
 * knowable offline and is the safety property: a named non-tenant-zero brand
 * must never reach the shipped files, whether or not Supabase is reachable,
 * whether or not its own import succeeded.
 */
async function resolve({ brand = null, workspaceId = null } = {}) {
  const zero = isTenantZeroBrand(brand);

  if (zero === true) return { products: null, source: 'shipped', reason: '', zero: true };

  const wsId = workspaceId || (brand && brand.id) || null;

  if (zero === false) {
    const v = catalogVerdict(brand);
    const rows = await workspaceRows(wsId);
    const j = rows.length ? judged(rows, brand) : null;
    if (j) return j;
    if (v && v.excluded) return Object.assign(excludedNone(v), { zero: false });
    return Object.assign(none(noCatalogueReason(brand)), { zero: false });
  }

  // No brand record: fall back to the workspace question, answered by the same
  // helper that gates the bundled sales export so the two cannot disagree.
  let owns = false;
  try { owns = await require('./market-analytics.js').ownsBundledExport(wsId); } catch (_) { owns = false; }
  if (owns) return { products: null, source: 'shipped', reason: '', zero: true };

  const rows = await workspaceRows(wsId);
  if (rows.length) {
    // No brand on the call: the workspace's own record decides whose rows
    // these are, exactly as it would for a call that named it.
    const rec = (brand && (brand.catalog_source || brand.website)) ? brand : await workspaceRecord(wsId);
    const j = rec ? judged(rows, rec) : null;
    if (j) return j;
    return { products: rows, source: 'brand', reason: '', zero: false };
  }
  return Object.assign(none(UNRESOLVED_REASON), { zero: false });
}

/**
 * Run `fn` with {brand, workspaceId}'s catalogue pinned to its async subtree.
 *
 * AsyncLocalStorage, not a module variable, for the reason request-scope.js
 * spells out: a warm runtime serves concurrent requests from one process, and a
 * shared variable would hand one brand another brand's products. The store
 * follows ONE generation's continuation chain and is invisible to every other,
 * so two brands generating at the same instant cannot see each other's rows.
 */
async function withCatalog(ctx, fn) {
  let resolved;
  try { resolved = await resolve(ctx || {}); }
  catch (_) { resolved = none(UNRESOLVED_REASON); }
  const store = {
    key: String((ctx && (ctx.workspaceId || (ctx.brand && ctx.brand.id))) || (ctx && ctx.brand && ctx.brand.slug) || ''),
    brand: (ctx && ctx.brand) || null,
    ...resolved,
  };
  return SCOPE.run(store, fn);
}

/** The pinned catalogue for the generation currently running, or null. */
function currentScope() { return SCOPE.getStore() || null; }

// ── the sync half: what every renderer actually calls ──────────────────────
/**
 * The products a renderer may use for `market`, for `brand`.
 *
 * Never throws, never returns another brand's rows. `source: 'none'` carries a
 * `reason` the caller turns into a DATA REQUIRED marker.
 */
function productsFor(market, { brand = null, workspaceId = null } = {}) {
  const scope = currentScope();

  // 1. An explicitly supplied brand is authoritative — it is what the renderer
  //    is building FOR, and it can disagree with an outer scope (the orphan-heal
  //    pass rebuilds slots from several workspaces inside one invocation).
  const zero = isTenantZeroBrand(brand);
  if (zero === true) return { products: shipped(market), source: 'shipped', reason: '' };
  // A record whose catalogue the coherence rule calls another brand's never
  // reaches a renderer, whatever the pinned scope holds (2026-10-10).
  const verdict = brand ? catalogVerdict(brand) : null;
  if (verdict && verdict.excluded && !(scope && sameTenant(scope, brand, workspaceId) && scope.source === 'brand' && identityFilter(scope.products, brand, verdict).rows.length)) {
    return excludedNone(verdict);
  }
  // A WORKSPACE record whose ownership nobody stamped (it may only carry
  // tenant zero's slug, which its owner wrote): what this generation pinned
  // for THIS tenant decides - resolve() asked the workspace rule - and nothing
  // else does. It never falls through to the no-Supabase shipped default below.
  if (zero === null && brand && brand.id) {
    if (scope && sameTenant(scope, brand, workspaceId)) {
      if (scope.source === 'shipped') return { products: shipped(market), source: 'shipped', reason: '' };
      if (scope.source === 'brand') return { products: forRegion(identityFilter(scope.products, brand, verdict).rows, market), source: 'brand', reason: '' };
      return Object.assign(none(scope.reason || noCatalogueReason(brand)), scope.catalog_excluded ? { catalog_excluded: scope.catalog_excluded } : {});
    }
    return none(noCatalogueReason(brand));
  }
  if (zero === false) {
    if (scope && scope.source === 'brand' && sameTenant(scope, brand, workspaceId)) {
      return { products: forRegion(identityFilter(scope.products, brand, verdict).rows, market), source: 'brand', reason: '' };
    }
    if (scope && scope.source === 'none' && sameTenant(scope, brand, workspaceId)) {
      return Object.assign(none(scope.reason || noCatalogueReason(brand)), scope.catalog_excluded ? { catalog_excluded: scope.catalog_excluded } : {});
    }
    return none(noCatalogueReason(brand));
  }

  // 2. No brand on the call: use whatever this generation was pinned to.
  if (scope) {
    if (scope.source === 'shipped') return { products: shipped(market), source: 'shipped', reason: '' };
    if (scope.source === 'brand') return { products: forRegion(scope.products, market), source: 'brand', reason: '' };
    return Object.assign(none(scope.reason || UNRESOLVED_REASON), scope.catalog_excluded ? { catalog_excluded: scope.catalog_excluded } : {});
  }

  // 3. Nothing known at all. With no Supabase project this is a script, a build
  //    step or a single-tenant dev box — the same case ownsBundledExport() calls
  //    "single-tenant dev" and answers true for, which keeps `npm run build:july`
  //    and the seed scripts working. With Supabase configured we are inside a
  //    multi-tenant deployment and an unattributed read is a leak waiting to
  //    happen, so it fails CLOSED.
  if (!supabaseConfigured()) return { products: shipped(market), source: 'shipped', reason: '' };
  return none(UNRESOLVED_REASON);
}

/**
 * Does the pinned scope describe the brand this call is for?
 *
 * Compared on every identifier both sides can offer, because the two rarely
 * arrive by the same route: the scope is pinned from a config's `workspace_id`
 * while the render site passes the brand RECORD, and a preset-shaped brand may
 * carry a slug but no id. A mismatch is not an error - it just means this call
 * is for a different brand than the one pinned, and the answer is `none`, never
 * the pinned brand's rows.
 */
function sameTenant(scope, brand, workspaceId) {
  const want = new Set([workspaceId, brand && brand.id, brand && brand.slug]
    .filter(Boolean).map(String));
  if (!want.size) return false;
  const have = [scope.key, scope.brand && scope.brand.id, scope.brand && scope.brand.slug]
    .filter(Boolean).map(String);
  return have.some((h) => want.has(h));
}

/** A workspace's rows narrowed to one region, with the documented widening. */
function forRegion(rows, market) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const r = regionKey(market);
  const exact = list.filter((p) => p.region === r);
  if (exact.length) return exact;
  // A brand that imported ONE catalogue (the common case: a single storefront)
  // stamped it with one region. Using it for another of that brand's regions is
  // still that brand's own data, so it is allowed; crossing BRANDS never is.
  const unregioned = list.filter((p) => !p.region);
  return unregioned.length ? unregioned : list;
}

/**
 * The zero-fabrication marker for a product slot with no approved image.
 * Shape per docs/campaign-orchestration-master-spec.md:
 *   [DATA REQUIRED BEFORE LAUNCH: field, product, region]
 */
function imageMarker(product, market) {
  const name = String(
    (product && (product.title || product.n || product.name || product.handle || product.h)) || 'hero product'
  ).replace(/[[\]]/g, '').trim().slice(0, 80) || 'hero product';
  const region = String(market || 'all').toUpperCase();
  return `[DATA REQUIRED BEFORE LAUNCH: product image, ${name}, ${region}]`;
}

module.exports = {
  tenantZeroData, isTenantZeroDataFile, TENANT_ZERO_DATA,
  withCatalog, resolve, productsFor, currentScope, invalidate,
  isTenantZeroBrand, tenantZeroSlug, shipped, shippedRegion, regionKey,
  imageMarker, noCatalogueReason, UNRESOLVED_REASON, fromRow, forRegion,
  catalogVerdict, identityFilter, foreignCatalogReason,
  supabaseConfigured, MAX_ROWS,
};
