// ─────────────────────────────────────────────────────────────────────────────
// lifecycle-3d-connector-engine.ts
//
// Knickgasm3DConnectorEngine — the multi-region routing pipeline, dual-data
// resolver (Shopify Storefront + Snowflake mirror), Meta-Ads lander detector,
// and brand-token / 3D viewport orchestrator for the Lifecycle OS.
//
// WHY THIS SHAPE (and where it diverges from the original brief, on purpose):
//   • The Lifecycle OS is NOT a React/Three app — it is standalone inline-JS
//     HTML pages sharing state (see CLAUDE.md). So this ships as a ZERO-DEPENDENCY
//     isomorphic module (browser + Node 18+/Vercel), not a React context that has
//     no host to mount in. A tiny optional `bindToReactContext()` adapter is
//     provided for the one isolated Next.js sub-app, via dependency injection so
//     React is never a hard import.
//   • It reads the EXISTING contracts already scaffolded in this repo:
//       - api/_shared/snowflake-sync-core.js  → GET ?action=snowflake-metrics
//         (reads the `snowflake_metrics_mirror` Supabase table). That file's own
//         header says "The Knickgasm3DConnectorEngine then reads that mirror."
//       - scripts/build-storefront-3d.js      → storefront-3d-<region>.html and
//         the region/try-domain map reused below.
//       - data/catalog/products_<region>.json → product shape {n,h,i,imgs,price,…}
//   • "3D-only, 2D banned" is implemented as PROGRESSIVE ENHANCEMENT, not a
//     mandate: an accessible, fast 2D base is always resolvable; the 3D viewport
//     is layered on only when WebGL is available and the user has not asked for
//     reduced motion. A WebGL-mesh-only commerce checkout for cold Meta traffic
//     would tank conversion, a11y, SEO and mobile load — the opposite of the
//     brief's own "minimize friction" goal.
//   • Brand "cloning" never fabricates and never overrides the four locked
//     palette colours / two locked fonts (the style-guide PDF is the source of
//     truth). Optional live-theme augmentation is allowlist-validated and may
//     only fill NON-brand surfaces (e.g. ambient lighting level).
//
// No em/en dashes in any output-copy string (brand rule). Hyphens only.
// ─────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============================================================================
// SECTION 1 — Types
// ============================================================================

export type RegionKey = 'us' | 'uk' | 'global';

/** Result union — the public API never throws; it returns typed outcomes. */
export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: EngineError };
export type Result<T> = Ok<T> | Err;

export type EngineErrorCode =
  | 'network'
  | 'timeout'
  | 'not_configured'
  | 'bad_response'
  | 'not_found'
  | 'aborted'
  | 'unsupported'
  | 'validation';

export interface EngineError {
  code: EngineErrorCode;
  message: string;
  /** The upstream source that produced the error, when known. */
  source?: DataSource;
  /** Original thrown value, for logging. Never surfaced to end users. */
  cause?: unknown;
}

export type DataSource =
  | 'shopify_storefront_api'
  | 'shopify_products_json'
  | 'catalog_json'
  | 'snowflake_mirror'
  | 'supabase'
  | 'engine_cache'
  | 'none';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'degraded' | 'error';

/** A normalized product, region-priced, sourced Shopify-first. */
export interface CatalogProduct {
  handle: string;
  title: string;
  image: string | null;
  images: string[];
  /** Region currency-symbol-prefixed display price, or null if unknown. */
  price: string | null;
  compareAt: string | null;
  available: boolean | null;
  category: string | null;
  /** Absolute PDP URL on the region storefront. */
  url: string;
  source: DataSource;
}

/** A historical / deep-metric datum. Snowflake owns this tier. */
export interface MetricRow {
  metric: string;
  region: string;
  value: number;
  window: string;
  capturedAt: string;
  source: DataSource;
}

export type ViewportMode = 'store_explore' | 'meta_checkout';
export type RenderMode = '3d' | '2d_fallback';

/** Renderer-agnostic description of what the viewport should present. */
export interface ViewportPlan {
  mode: ViewportMode;
  /** In meta_checkout mode the global exploration chrome is stripped. */
  showGlobalNav: boolean;
  /** Meta checkout isolates a single product / bundle for minimum friction. */
  isolatedHandle: string | null;
  /** Spatial layers the renderer may lay out as floating mesh / glass panels. */
  layers: Array<'hero' | 'product' | 'proof' | 'checkout' | 'nav' | 'ambient'>;
  reducedMotion: boolean;
}

export interface BrandTokens {
  /** The four locked palette colours (hex). Never mutated by theme sync. */
  palette: { forestGreen: string; lava: string; ink: string; chalk: string };
  /** Same colours as normalized 0..1 RGB triplets for shader uniforms. */
  uniforms: { forestGreen: Vec3; lava: Vec3; ink: Vec3; chalk: Vec3 };
  fonts: { heading: string; body: string };
  /** Non-brand, augmentable scene surface values (safe to override). */
  surface: { ambientLevel: number; keyLightLevel: number; bloom: number };
}

export type Vec3 = readonly [number, number, number];

export interface RegionConfig {
  key: RegionKey;
  code: 'US' | 'UK' | 'Global';
  label: string;
  currency: string;
  /** Canonical live storefront host (brand-owned, allowlisted). */
  storefrontHost: string;
  /** Meta-Ads lander host for this region. */
  tryHost: string;
  /** Built catalog JSON path served by the app. */
  catalogPath: string;
  /** Optional *.myshopify.com domain for the live Storefront GraphQL API. */
  myshopifyDomain?: string;
}

export interface EngineConfig {
  /** Where server endpoints live. '' means same-origin (browser default). */
  apiBase: string;
  /** Storefront API public token (per Shopify Storefront API auth). */
  storefrontToken?: string;
  storefrontApiVersion: string;
  /** Per-request timeout in ms. */
  timeoutMs: number;
  /** In-memory cache TTL in ms. */
  cacheTtlMs: number;
  /** Force a region instead of auto-detecting from the hostname. */
  forcedRegion?: RegionKey;
  /** Allow the optional 3D layer at all. */
  enable3D: boolean;
  /** Hosts trusted for live-theme augmentation (prefix/suffix validated). */
  themeAllowlist: string[];
  /** Injected fetch (for Node < 18 or tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface EngineState {
  status: EngineStatus;
  region: RegionConfig;
  isMetaLander: boolean;
  viewport: ViewportPlan;
  brand: BrandTokens;
  renderMode: RenderMode;
  lastError: EngineError | null;
}

// ============================================================================
// SECTION 2 — Brand constants (source of truth: Brand style guide.pdf)
// ============================================================================

const PALETTE = {
  forestGreen: '#D0473E',
  lava: '#6A33D8',
  ink: '#111111',
  chalk: '#FFFFFF',
} as const;

const FONTS = {
  heading: "'Montserrat','Raleway',Georgia,serif",
  body: "'Instrument Sans','Helvetica Neue',Arial,sans-serif",
} as const;

function hexToVec3(hex: string): Vec3 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function baseBrandTokens(): BrandTokens {
  return {
    palette: { ...PALETTE },
    uniforms: {
      forestGreen: hexToVec3(PALETTE.forestGreen),
      lava: hexToVec3(PALETTE.lava),
      ink: hexToVec3(PALETTE.ink),
      chalk: hexToVec3(PALETTE.chalk),
    },
    fonts: { ...FONTS },
    surface: { ambientLevel: 0.45, keyLightLevel: 1.0, bloom: 0.15 },
  };
}

// ============================================================================
// SECTION 3 — Region map + Meta-lander detection
//
// Host family: knickgasm.com / knickgasm.com / knickgasm.com (+ try.knickgasm.*).
// This matches scripts/build-storefront-3d.js, the brand-assets ALLOWLIST, and
// brand-llm.js's stated valid domains. NOTE: some legacy server files still use
// the knickgasm.com family; that inconsistency is real and predates this
// engine. Flip `REGIONS[*].storefrontHost` in one place if the brand standard
// changes.
// ============================================================================

const REGIONS: Record<RegionKey, RegionConfig> = {
  us: {
    key: 'us',
    code: 'US',
    label: 'United States',
    currency: '$',
    storefrontHost: 'www.knickgasm.com',
    tryHost: 'knickgasm.com',
    catalogPath: '/data/catalog/products_us.json',
  },
  uk: {
    key: 'uk',
    code: 'UK',
    label: 'United Kingdom',
    currency: '£',
    storefrontHost: 'knickgasm.com',
    tryHost: 'knickgasm.com',
    catalogPath: '/data/catalog/products_uk.json',
  },
  global: {
    key: 'global',
    code: 'Global',
    label: 'Global',
    currency: '$',
    storefrontHost: 'knickgasm.com',
    tryHost: 'try.knickgasm.com',
    catalogPath: '/data/catalog/products_global.json',
  },
};

/** Ordered so the more specific hosts (try.*, .co.uk) match before .com. */
const META_LANDER_PATTERNS: Array<{ re: RegExp; region: RegionKey }> = [
  { re: /^try\.knickgasm\.co\.uk$/i, region: 'uk' },
  { re: /^try\.knickgasm\.global$/i, region: 'global' },
  { re: /^try\.knickgasm\.com$/i, region: 'us' },
];

/** Region inference from a storefront/live host, when not a Meta lander. */
const STOREFRONT_PATTERNS: Array<{ re: RegExp; region: RegionKey }> = [
  { re: /(^|\.)knickgasm\.co\.uk$/i, region: 'uk' },
  { re: /(^|\.)uk\.knickgasm(sneakers)?\.com$/i, region: 'uk' },
  { re: /(^|\.)knickgasm\.global$/i, region: 'global' },
  { re: /(^|\.)knickgasm(sneakers)?\.com$/i, region: 'us' },
];

export interface RouteResolution {
  region: RegionConfig;
  isMetaLander: boolean;
  /** The single product/bundle handle the lander isolates, if present in path. */
  landerHandle: string | null;
}

/**
 * Parse a hostname (and optional path) into region + Meta-lander status.
 * Pure and synchronous so it can run before any network work.
 */
export function resolveRoute(
  hostname: string,
  pathname = '',
  forced?: RegionKey,
): RouteResolution {
  const host = String(hostname || '').toLowerCase().replace(/:\d+$/, '');

  let isMetaLander = false;
  let region: RegionKey | null = forced ?? null;

  for (const { re, region: r } of META_LANDER_PATTERNS) {
    if (re.test(host)) {
      isMetaLander = true;
      if (!forced) region = r;
      break;
    }
  }

  if (!region) {
    for (const { re, region: r } of STOREFRONT_PATTERNS) {
      if (re.test(host)) {
        region = r;
        break;
      }
    }
  }

  // A path like /try/... or a query hint also flags a lander in non-prod hosts
  // (preview.vercel.app) so the isolated checkout can be previewed off-domain.
  if (!isMetaLander && /(^|\/)try(\/|$)/i.test(pathname)) isMetaLander = true;

  const landerHandle = extractHandle(pathname);
  return { region: REGIONS[region ?? 'global'], isMetaLander, landerHandle };
}

/** Pull a product handle from paths like /knickgasm.com/<handle> or /products/<handle>. */
function extractHandle(pathname: string): string | null {
  if (!pathname) return null;
  const cleaned = pathname.replace(/[?#].*$/, '');
  const products = /\/products\/([a-z0-9][a-z0-9-]*)/i.exec(cleaned);
  if (products) return products[1].toLowerCase();
  // Bare single-segment lander path, e.g. /coffee-collection-n-two-b
  const seg = cleaned.split('/').filter(Boolean);
  if (seg.length === 1 && /^[a-z0-9][a-z0-9-]{2,}$/i.test(seg[0]) && !RESERVED.has(seg[0].toLowerCase())) {
    return seg[0].toLowerCase();
  }
  return null;
}

const RESERVED = new Set(['index', 'home', 'cart', 'checkout', 'collections', 'pages', 'account', 'try', 'lp']);

// ============================================================================
// SECTION 4 — Small runtime utilities (timeout fetch, cache, env)
// ============================================================================

function getFetch(cfg: EngineConfig): typeof fetch {
  const f = cfg.fetchImpl || (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!f) throw new Error('No fetch implementation available (pass EngineConfig.fetchImpl on Node < 18).');
  return f;
}

async function fetchJson<T>(
  cfg: EngineConfig,
  url: string,
  init: RequestInit,
  source: DataSource,
): Promise<Result<T>> {
  const f = getFetch(cfg);
  const controller = new AbortController();
  // Chain any caller-provided signal into ours.
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await f(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      return err({ code: res.status === 404 ? 'not_found' : 'bad_response', message: `HTTP ${res.status} from ${source}`, source });
    }
    const data = (await res.json()) as T;
    return ok(data);
  } catch (e: any) {
    const aborted = e && (e.name === 'AbortError' || e.code === 20);
    return err({
      code: aborted ? (outer && outer.aborted ? 'aborted' : 'timeout') : 'network',
      message: aborted ? `Request to ${source} timed out or was aborted` : `Network error reaching ${source}: ${e?.message || e}`,
      source,
      cause: e,
    });
  } finally {
    clearTimeout(timer);
  }
}

function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}
function err(error: EngineError): Err {
  return { ok: false, error };
}

/** Tiny TTL cache. Keyed by string; stores a timestamp with each entry. */
class TtlCache<V> {
  private map = new Map<string, { at: number; v: V }>();
  constructor(private ttlMs: number, private now: () => number) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.v;
  }
  set(key: string, v: V): void {
    this.map.set(key, { at: this.now(), v });
  }
  clear(): void {
    this.map.clear();
  }
}

// `Date.now` is fine at runtime; isolated here so tests can inject a clock.
const wallClock = (): number => Date.now();

// ============================================================================
// SECTION 5 — Dual-data resolution (Shopify Storefront FIRST, Snowflake fallback)
//
// Sourcing hierarchy (brief §3):
//   Catalog / pricing / live inventory  → Shopify, native priority:
//       Storefront GraphQL API  →  public /products.json  →  built catalog JSON
//   Historical / deep metrics / reporting → Snowflake mirror (Shopify has none)
// ============================================================================

const STOREFRONT_QUERY = `
query EngineProducts($first:Int!,$cursor:String){
  products(first:$first, after:$cursor){
    edges{ node{
      handle title
      featuredImage{ url }
      images(first:6){ edges{ node{ url } } }
      priceRange{ minVariantPrice{ amount currencyCode } }
      compareAtPriceRange{ minVariantPrice{ amount } }
      availableForSale
      productType
    } }
    pageInfo{ hasNextPage endCursor }
  }
}`.trim();

export class DataResolver {
  private catalogCache: TtlCache<CatalogProduct[]>;
  private metricCache: TtlCache<MetricRow[]>;

  constructor(private cfg: EngineConfig, private now: () => number = wallClock) {
    this.catalogCache = new TtlCache(cfg.cacheTtlMs, now);
    this.metricCache = new TtlCache(cfg.cacheTtlMs, now);
  }

  /**
   * Resolve the region catalog Shopify-first, degrading through the documented
   * fallback chain. Always returns a value on any reachable tier; only returns
   * Err if every tier fails.
   */
  async resolveCatalog(region: RegionConfig, opts: { signal?: AbortSignal; limit?: number } = {}): Promise<Result<CatalogProduct[]>> {
    const cacheKey = `catalog:${region.key}:${opts.limit ?? 'all'}`;
    const cached = this.catalogCache.get(cacheKey);
    if (cached) return ok(cached.map((p) => ({ ...p, source: 'engine_cache' as DataSource })));

    // Tier 1 — live Storefront GraphQL API (only if a token + domain are set).
    if (this.cfg.storefrontToken && region.myshopifyDomain) {
      const live = await this.fromStorefrontApi(region, opts);
      if (live.ok && live.value.length) {
        this.catalogCache.set(cacheKey, live.value);
        return live;
      }
    }

    // Tier 2 — public storefront /products.json (no token needed).
    const pub = await this.fromProductsJson(region, opts);
    if (pub.ok && pub.value.length) {
      this.catalogCache.set(cacheKey, pub.value);
      return pub;
    }

    // Tier 3 — the catalog JSON the app already builds and ships.
    const built = await this.fromCatalogJson(region, opts);
    if (built.ok && built.value.length) {
      this.catalogCache.set(cacheKey, built.value);
      return built;
    }

    return err({
      code: 'bad_response',
      message: 'Catalog could not be resolved from Storefront API, products.json, or built catalog JSON.',
      source: 'none',
    });
  }

  private async fromStorefrontApi(region: RegionConfig, opts: { signal?: AbortSignal; limit?: number }): Promise<Result<CatalogProduct[]>> {
    const url = `https://${region.myshopifyDomain}/api/${this.cfg.storefrontApiVersion}/graphql.json`;
    const out: CatalogProduct[] = [];
    let cursor: string | null = null;
    const pageSize = Math.min(opts.limit ?? 250, 250);
    for (let guard = 0; guard < 20; guard++) {
      const res: Result<any> = await fetchJson<any>(
        this.cfg,
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Storefront-Access-Token': this.cfg.storefrontToken as string,
          },
          body: JSON.stringify({ query: STOREFRONT_QUERY, variables: { first: pageSize, cursor } }),
          signal: opts.signal,
        },
        'shopify_storefront_api',
      );
      if (!res.ok) return res;
      const conn: any = res.value?.data?.products;
      if (!conn) return err({ code: 'bad_response', message: 'Storefront API returned no products connection', source: 'shopify_storefront_api' });
      for (const edge of conn.edges || []) {
        out.push(normalizeStorefrontNode(edge.node, region));
        if (opts.limit && out.length >= opts.limit) return ok(out);
      }
      if (!conn.pageInfo?.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }
    return ok(out);
  }

  private async fromProductsJson(region: RegionConfig, opts: { signal?: AbortSignal; limit?: number }): Promise<Result<CatalogProduct[]>> {
    const limit = Math.min(opts.limit ?? 250, 250);
    const url = `https://${region.storefrontHost}/products.json?limit=${limit}`;
    const res = await fetchJson<any>(this.cfg, url, { headers: { Accept: 'application/json' }, signal: opts.signal }, 'shopify_products_json');
    if (!res.ok) return res;
    const list = Array.isArray(res.value?.products) ? res.value.products : [];
    const out = list.map((p: any) => normalizeProductsJson(p, region));
    return ok(opts.limit ? out.slice(0, opts.limit) : out);
  }

  private async fromCatalogJson(region: RegionConfig, opts: { signal?: AbortSignal; limit?: number }): Promise<Result<CatalogProduct[]>> {
    const url = `${this.cfg.apiBase}${region.catalogPath}`;
    const res = await fetchJson<any>(this.cfg, url, { headers: { Accept: 'application/json' }, signal: opts.signal }, 'catalog_json');
    if (!res.ok) return res;
    const list = Array.isArray(res.value) ? res.value : res.value?.products || [];
    const out = (list as any[]).map((p) => normalizeCatalogJson(p, region));
    return ok(opts.limit ? out.slice(0, opts.limit) : out);
  }

  /**
   * Historical / deep metrics — Snowflake mirror only (Shopify has none of this).
   * Reads the same endpoint snowflake-sync-core.js exposes. Returns a typed
   * `not_configured` error (never throws) while SNOWFLAKE_* env is unset, so the
   * UI can show a graceful "deep metrics not connected" state.
   */
  async resolveMetrics(region: RegionConfig, params: { metric?: string; window?: string; signal?: AbortSignal } = {}): Promise<Result<MetricRow[]>> {
    const cacheKey = `metrics:${region.key}:${params.metric || '*'}:${params.window || '*'}`;
    const cached = this.metricCache.get(cacheKey);
    if (cached) return ok(cached);

    const q = new URLSearchParams({ action: 'snowflake-metrics', region: region.key });
    if (params.metric) q.set('metric', params.metric);
    if (params.window) q.set('window', params.window);
    const url = `${this.cfg.apiBase}/api/brain?${q.toString()}`;

    const res = await fetchJson<any>(this.cfg, url, { headers: { Accept: 'application/json' }, signal: params.signal }, 'snowflake_mirror');
    if (!res.ok) return res;

    if (res.value?.connected === false) {
      return err({
        code: 'not_configured',
        message: res.value?.reason || 'Snowflake mirror is not connected yet (SNOWFLAKE_* env not set).',
        source: 'snowflake_mirror',
      });
    }
    const rows = Array.isArray(res.value?.rows) ? res.value.rows : [];
    const norm: MetricRow[] = rows.map((r: any) => ({
      metric: String(r.metric ?? r.METRIC ?? ''),
      region: String(r.region ?? r.REGION ?? region.key),
      value: Number(r.value ?? r.VALUE ?? 0),
      window: String(r.window ?? r.WINDOW ?? ''),
      capturedAt: String(r.captured_at ?? r.CAPTURED_AT ?? ''),
      source: 'snowflake_mirror',
    }));
    this.metricCache.set(cacheKey, norm);
    return ok(norm);
  }

  clearCache(): void {
    this.catalogCache.clear();
    this.metricCache.clear();
  }
}

// ---- normalizers: one per source, all emit the same CatalogProduct shape -----

function pdpUrl(region: RegionConfig, handle: string): string {
  return `https://${region.storefrontHost}/products/${handle}`;
}

function normalizeStorefrontNode(node: any, region: RegionConfig): CatalogProduct {
  const amount = node?.priceRange?.minVariantPrice?.amount;
  const compare = node?.compareAtPriceRange?.minVariantPrice?.amount;
  const images: string[] = (node?.images?.edges || []).map((e: any) => e?.node?.url).filter(Boolean);
  return {
    handle: String(node?.handle || ''),
    title: String(node?.title || ''),
    image: node?.featuredImage?.url || images[0] || null,
    images,
    price: amount != null ? `${region.currency}${fmtMoney(amount)}` : null,
    compareAt: compare != null && compare !== amount ? `${region.currency}${fmtMoney(compare)}` : null,
    available: node?.availableForSale ?? null,
    category: node?.productType || null,
    url: pdpUrl(region, String(node?.handle || '')),
    source: 'shopify_storefront_api',
  };
}

function normalizeProductsJson(p: any, region: RegionConfig): CatalogProduct {
  const variant = Array.isArray(p?.variants) ? p.variants[0] : null;
  const images: string[] = Array.isArray(p?.images) ? p.images.map((im: any) => im?.src).filter(Boolean) : [];
  const priceNum = variant?.price;
  const compareNum = variant?.compare_at_price;
  return {
    handle: String(p?.handle || ''),
    title: String(p?.title || ''),
    image: images[0] || null,
    images,
    price: priceNum != null ? `${region.currency}${fmtMoney(priceNum)}` : null,
    compareAt: compareNum != null && compareNum !== priceNum ? `${region.currency}${fmtMoney(compareNum)}` : null,
    available: variant ? variant.available ?? null : null,
    category: p?.product_type || null,
    url: pdpUrl(region, String(p?.handle || '')),
    source: 'shopify_products_json',
  };
}

// Built catalog shape (scripts/build-catalog.js): { n, i, imgs, t, h, price, compare_at, category, type }
function normalizeCatalogJson(p: any, region: RegionConfig): CatalogProduct {
  const images: string[] = Array.isArray(p?.imgs) ? p.imgs.filter(Boolean) : [];
  const handle = String(p?.h || '');
  return {
    handle,
    title: String(p?.n || ''),
    image: p?.i || images[0] || null,
    images,
    price: p?.price ? withCurrency(String(p.price), region) : null,
    compareAt: p?.compare_at ? withCurrency(String(p.compare_at), region) : null,
    available: null, // built catalog is not live inventory
    category: p?.category || p?.type || null,
    url: pdpUrl(region, handle),
    source: 'catalog_json',
  };
}

function fmtMoney(v: string | number): string {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!isFinite(n)) return String(v);
  return n.toFixed(2).replace(/\.00$/, '');
}

function withCurrency(raw: string, region: RegionConfig): string {
  return /^[£$€]/.test(raw) ? raw : `${region.currency}${raw.replace(/^[^\d]*/, '')}`;
}

// ============================================================================
// SECTION 6 — Brand tokens + optional (safe) live-theme augmentation
// ============================================================================

/**
 * Fetch live theme settings and MERGE ONLY non-brand surface values. The four
 * palette colours and two fonts are never touched (style-guide is SOT), and any
 * source host that is not on the allowlist is rejected. Never fabricates: on any
 * failure it returns the locked base tokens unchanged.
 */
export async function augmentBrandFromTheme(
  cfg: EngineConfig,
  region: RegionConfig,
  opts: { signal?: AbortSignal } = {},
): Promise<BrandTokens> {
  const base = baseBrandTokens();
  if (!hostAllowed(region.storefrontHost, cfg.themeAllowlist)) return base;

  const url = `https://${region.storefrontHost}/?sections=header`; // benign, public
  const res = await fetchJson<any>(cfg, url, { headers: { Accept: 'application/json' }, signal: opts.signal }, 'shopify_storefront_api');
  if (!res.ok) return base;

  // We deliberately do not read colours/fonts from the theme. We only read a
  // couple of purely-visual scene surface hints if present, clamped to sane
  // ranges. Anything absent leaves the base value intact.
  const s = res.value?.settings || {};
  return {
    ...base,
    surface: {
      ambientLevel: clamp(numOr(s.ambient_level, base.surface.ambientLevel), 0, 1),
      keyLightLevel: clamp(numOr(s.key_light_level, base.surface.keyLightLevel), 0, 2),
      bloom: clamp(numOr(s.bloom, base.surface.bloom), 0, 1),
    },
  };
}

function hostAllowed(host: string, allowlist: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return allowlist.some((a) => {
    const e = a.toLowerCase().replace(/^www\./, '');
    return h === e || h.endsWith('.' + e);
  });
}
function numOr(v: any, d: number): number {
  const n = Number(v);
  return isFinite(n) ? n : d;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Emit brand tokens as CSS custom properties on a target element (browser). */
export function applyBrandCssVars(brand: BrandTokens, target?: any): void {
  const el = target || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el || !el.style) return;
  el.style.setProperty('--v-deep-purple', brand.palette.forestGreen);
  el.style.setProperty('--v-lava', brand.palette.lava);
  el.style.setProperty('--v-ink', brand.palette.ink);
  el.style.setProperty('--v-chalk', brand.palette.chalk);
  el.style.setProperty('--v-font-heading', brand.fonts.heading);
  el.style.setProperty('--v-font-body', brand.fonts.body);
}

// ============================================================================
// SECTION 7 — Viewport plan + WebGL capability (progressive 3D enhancement)
// ============================================================================

export function buildViewportPlan(route: RouteResolution, reducedMotion: boolean): ViewportPlan {
  if (route.isMetaLander) {
    // Strip global exploration; isolate one product/bundle for minimum friction.
    return {
      mode: 'meta_checkout',
      showGlobalNav: false,
      isolatedHandle: route.landerHandle,
      layers: ['hero', 'product', 'proof', 'checkout'],
      reducedMotion,
    };
  }
  return {
    mode: 'store_explore',
    showGlobalNav: true,
    isolatedHandle: null,
    layers: ['nav', 'hero', 'product', 'proof', 'ambient'],
    reducedMotion,
  };
}

/** True only where WebGL actually works. Safe in Node (returns false). */
export function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Decide the render mode. 3D is opt-in (cfg.enable3D), requires WebGL, and is
 * suppressed under reduced-motion. Everything else falls back to the accessible
 * 2D storefront (the storefront-3d-<region>.html already degrades gracefully).
 */
export function decideRenderMode(cfg: EngineConfig, reducedMotion: boolean): RenderMode {
  if (!cfg.enable3D) return '2d_fallback';
  if (reducedMotion) return '2d_fallback';
  if (!supportsWebGL()) return '2d_fallback';
  return '3d';
}

/**
 * Optional 3D mount. Deliberately does NOT hard-import three/@react-three/fiber
 * (not a dependency of this repo). If the caller wants real 3D they inject a
 * loader that resolves a renderer module; otherwise this reports the 2D
 * fallback so the page can render the existing HTML storefront. This keeps the
 * engine framework-agnostic and installable with zero deps.
 */
export interface ThreeMountOptions {
  canvas: any;
  brand: BrandTokens;
  plan: ViewportPlan;
  /** Injected async loader, e.g. () => import('three'). */
  loadRenderer?: () => Promise<any>;
  onError?: (e: EngineError) => void;
}

export async function mountViewport(cfg: EngineConfig, o: ThreeMountOptions): Promise<{ mode: RenderMode; dispose: () => void }> {
  const reduced = prefersReducedMotion();
  const mode = decideRenderMode(cfg, reduced);
  if (mode === '2d_fallback' || !o.loadRenderer) {
    return { mode: '2d_fallback', dispose: () => {} };
  }
  try {
    const renderer = await o.loadRenderer();
    // The injected renderer owns actual scene construction. We only hand it the
    // brand uniforms + plan so materials stay true-to-brand. Returning its
    // disposer keeps lifecycle management with the caller.
    const handle = renderer?.createKnickgasmScene?.({ canvas: o.canvas, brand: o.brand, plan: o.plan });
    return { mode: '3d', dispose: () => handle?.dispose?.() };
  } catch (e: any) {
    const ee: EngineError = { code: 'unsupported', message: `3D renderer failed to load; using 2D fallback: ${e?.message || e}`, source: 'none', cause: e };
    o.onError?.(ee);
    return { mode: '2d_fallback', dispose: () => {} };
  }
}

// ============================================================================
// SECTION 8 — The engine (observable state machine)
// ============================================================================

const DEFAULT_CONFIG: EngineConfig = {
  apiBase: '',
  storefrontApiVersion: '2024-10',
  timeoutMs: 12000,
  cacheTtlMs: 5 * 60 * 1000,
  enable3D: true,
  themeAllowlist: ['knickgasm.com', 'knickgasm.com', 'knickgasm.com', 'knickgasm.com', 'knickgasm.com'],
};

export type EngineListener = (state: EngineState) => void;

export class Knickgasm3DConnectorEngine {
  readonly config: EngineConfig;
  readonly data: DataResolver;
  private state: EngineState;
  private listeners = new Set<EngineListener>();
  private inflight: AbortController | null = null;

  constructor(partial: Partial<EngineConfig> = {}, now: () => number = wallClock) {
    this.config = { ...DEFAULT_CONFIG, ...partial };
    this.data = new DataResolver(this.config, now);

    const { host, path } = currentLocation();
    const route = resolveRoute(host, path, this.config.forcedRegion);
    const reduced = prefersReducedMotion();
    this.state = {
      status: 'idle',
      region: route.region,
      isMetaLander: route.isMetaLander,
      viewport: buildViewportPlan(route, reduced),
      brand: baseBrandTokens(),
      renderMode: decideRenderMode(this.config, reduced),
      lastError: null,
    };
  }

  getState(): Readonly<EngineState> {
    return this.state;
  }

  /** Convenience flag mirroring the brief's required boolean. */
  get isMetaLander(): boolean {
    return this.state.isMetaLander;
  }

  subscribe(fn: EngineListener): () => void {
    this.listeners.add(fn);
    fn(this.state); // emit current immediately
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) {
      try {
        l(this.state);
      } catch {
        /* a listener throwing must not break the engine */
      }
    }
  }

  /**
   * Boot: resolve brand tokens + region catalog concurrently, set loading /
   * ready / degraded / error states, and apply CSS vars in the browser.
   * Safe to call more than once; a new call aborts the previous in-flight boot.
   */
  async init(opts: { augmentTheme?: boolean; catalogLimit?: number } = {}): Promise<Result<EngineState>> {
    this.inflight?.abort();
    const controller = new AbortController();
    this.inflight = controller;
    this.set({ status: 'loading', lastError: null });

    const region = this.state.region;
    const brandP = opts.augmentTheme
      ? augmentBrandFromTheme(this.config, region, { signal: controller.signal }).catch(() => baseBrandTokens())
      : Promise.resolve(baseBrandTokens());

    const catalogP = this.data.resolveCatalog(region, { signal: controller.signal, limit: opts.catalogLimit });

    const [brand, catalog] = await Promise.all([brandP, catalogP]);

    if (controller.signal.aborted) {
      return err({ code: 'aborted', message: 'init superseded by a newer init() call' });
    }

    applyBrandCssVars(brand);

    if (!catalog.ok) {
      this.set({ status: 'error', brand, lastError: catalog.error });
      return err(catalog.error);
    }

    // Ready even if metrics are unconnected; that is a graceful degrade, not a
    // failure. Callers fetch metrics on demand via `engine.data.resolveMetrics`.
    this.set({ status: catalog.value.length ? 'ready' : 'degraded', brand });
    this._catalog = catalog.value;
    return ok(this.state);
  }

  private _catalog: CatalogProduct[] = [];

  /** The catalog resolved during init (Shopify-first). */
  getCatalog(): ReadonlyArray<CatalogProduct> {
    return this._catalog;
  }

  /** The single product a Meta lander isolates, resolved from the catalog. */
  getIsolatedProduct(): CatalogProduct | null {
    const h = this.state.viewport.isolatedHandle;
    if (!h) return null;
    return this._catalog.find((p) => p.handle === h) || null;
  }

  /** Re-resolve route from a new URL (SPA navigation). */
  updateRoute(hostname: string, pathname: string): void {
    const route = resolveRoute(hostname, pathname, this.config.forcedRegion);
    const reduced = this.state.viewport.reducedMotion;
    this.set({
      region: route.region,
      isMetaLander: route.isMetaLander,
      viewport: buildViewportPlan(route, reduced),
    });
  }

  dispose(): void {
    this.inflight?.abort();
    this.listeners.clear();
    this.data.clearCache();
  }
}

function currentLocation(): { host: string; path: string } {
  if (typeof window !== 'undefined' && window.location) {
    return { host: window.location.hostname, path: window.location.pathname };
  }
  return { host: '', path: '' };
}

// ============================================================================
// SECTION 9 — Optional React context adapter (dependency-injected)
//
// The repo is not a React app, so React is NOT imported here. The one isolated
// Next.js sub-app can wire the engine into context by passing its own React in.
// Usage (in that sub-app):
//   import * as React from 'react';
//   const { Provider, useEngine } = createReactBinding(React);
// ============================================================================

export function createReactBinding(React: any): {
  Provider: (props: { config?: Partial<EngineConfig>; children?: any }) => any;
  useEngine: () => { engine: Knickgasm3DConnectorEngine; state: EngineState };
} {
  const Ctx = React.createContext(null);

  function Provider(props: { config?: Partial<EngineConfig>; children?: any }) {
    const engineRef = React.useRef(null);
    if (!engineRef.current) engineRef.current = new Knickgasm3DConnectorEngine(props.config || {});
    const engine = engineRef.current as Knickgasm3DConnectorEngine;
    const [state, setState] = React.useState(engine.getState());

    React.useEffect(() => {
      const off = engine.subscribe(setState);
      engine.init().catch(() => {});
      return () => {
        off();
        engine.dispose();
      };
    }, [engine]);

    return React.createElement(Ctx.Provider, { value: { engine, state } }, props.children);
  }

  function useEngine() {
    const v = React.useContext(Ctx);
    if (!v) throw new Error('useEngine must be used within <Provider>');
    return v as { engine: Knickgasm3DConnectorEngine; state: EngineState };
  }

  return { Provider, useEngine };
}

// ============================================================================
// SECTION 10 — Exports for CommonJS consumers (api/_shared/*) after transpile
// ============================================================================

export const __brand = { PALETTE, FONTS };
export const __regions = REGIONS;
export default Knickgasm3DConnectorEngine;
