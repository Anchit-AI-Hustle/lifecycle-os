import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MaterialUniforms,
  McpSpatialAdapter,
  ResolvedCatalogProduct,
  ShopifyProduct,
  ShopifyStorefrontPayload,
  ShopifyThemeSettings,
  SnowflakeQueryPayload,
  SpatialRenderer,
  SpatialLayout,
  SpatialTextureLoader,
  KnickgasmRegion,
  KnickgasmRegionState,
} from './types';

export * from './types';

const META_LANDERS = {
  US: /^https?:\/\/try\.knickgasm\.com(?:[/:?#]|$)/i,
  UK: /^https?:\/\/try\.knickgasm\.co\.uk(?:[/:?#]|$)/i,
} as const;

const REGION_HOSTS: Record<KnickgasmRegion, RegExp> = {
  US: /(?:^|\.)knickgasm(?:sneakers)?\.com$/i,
  UK: /(?:^|\.)(?:knickgasm\.co\.uk|uk\.knickgasm\.com)$/i,
  GLOBAL: /.*/,
};

const DEFAULT_THEME: ShopifyThemeSettings = {
  colors: { primary: '#6A33D8', accent: '#D0473E' },
  typography: { bodyFamily: 'Instrument Sans' },
  assets: {},
};

export interface Knickgasm3DEngineOptions {
  url?: string;
  storefrontEndpoints: Record<KnickgasmRegion, string>;
  storefrontTokens: Record<KnickgasmRegion, string>;
  snowflakeEndpoint: string;
  fetcher?: typeof fetch;
  renderer?: SpatialRenderer | null;
  /** Inject `(url, signal) => new THREE.TextureLoader().loadAsync(url)` at the canvas boundary. */
  textureLoader?: SpatialTextureLoader;
  mcp?: McpSpatialAdapter;
}

export interface Knickgasm3DEngineResult extends KnickgasmRegionState {
  products: ResolvedCatalogProduct[];
  uniforms: MaterialUniforms;
  layout: SpatialLayout;
  renderer: SpatialRenderer | null;
  loading: boolean;
  error: Error | null;
  mcp: { animation: Record<string, unknown>; physics: Record<string, unknown> } | null;
  refresh(): void;
}

export function routeKnickgasmRequest(rawUrl: string): Pick<KnickgasmRegionState, 'detectedRegion' | 'isMetaLander' | 'currency'> {
  const absolute = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  if (META_LANDERS.US.test(absolute)) return { detectedRegion: 'US', isMetaLander: true, currency: 'USD' };
  if (META_LANDERS.UK.test(absolute)) return { detectedRegion: 'UK', isMetaLander: true, currency: 'GBP' };

  let host = '';
  try { host = new URL(absolute).hostname; } catch { /* invalid URLs safely use Global */ }
  const detectedRegion: KnickgasmRegion = REGION_HOSTS.UK.test(host)
    ? 'UK'
    : REGION_HOSTS.US.test(host) ? 'US' : 'GLOBAL';
  return { detectedRegion, isMetaLander: false, currency: detectedRegion === 'UK' ? 'GBP' : 'USD' };
}

function assertOk(response: Response, source: string): Response {
  if (!response.ok) throw new Error(`${source} returned HTTP ${response.status}`);
  return response;
}

function themeFromMetaobject(payload: ShopifyStorefrontPayload): ShopifyThemeSettings {
  const fields = Object.fromEntries(payload.data.metaobject?.fields.map(({ key, value }) => [key, value]) ?? []);
  const color = (key: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(fields[key] ?? '') ? fields[key] : fallback;
  return {
    colors: {
      primary: color('primary_green', DEFAULT_THEME.colors.primary),
      accent: color('accent_gold', DEFAULT_THEME.colors.accent),
    },
    typography: { bodyFamily: fields.body_font?.trim() || DEFAULT_THEME.typography.bodyFamily },
    assets: {
      environmentMapUrl: fields.environment_map_url || undefined,
      productTextureUrl: fields.product_texture_url || undefined,
    },
  };
}

export async function fetchShopifyCatalog(
  endpoint: string,
  token: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<{ products: ShopifyProduct[]; theme: ShopifyThemeSettings }> {
  const query = `query KnickgasmSpatialCatalog {
    products(first: 100) { nodes { id handle title description productType vendor updatedAt
      featuredImage { url altText width height }
      variants(first: 100) { nodes { id title availableForSale quantityAvailable
        price { amount currencyCode } compareAtPrice { amount currencyCode }
        image { url altText width height } } } } }
    metaobject(handle: {type: "knickgasm_spatial_theme", handle: "active"}) {
      fields { key value }
    }
  }`;
  const response = assertOk(await fetcher(endpoint, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': token },
    body: JSON.stringify({ query }),
  }), 'Shopify');
  const payload = await response.json() as ShopifyStorefrontPayload;
  if (payload.errors?.length) throw new Error(`Shopify GraphQL: ${payload.errors.map(error => error.message).join('; ')}`);
  return { products: payload.data.products.nodes, theme: themeFromMetaobject(payload) };
}

export async function fetchSnowflakeSupplements(
  endpoint: string,
  productIds: string[],
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<SnowflakeQueryPayload> {
  if (!productIds.length) return { columns: [], rows: [], queryId: 'not-requested' };
  const response = assertOk(await fetcher(endpoint, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ operation: 'product_supplements', productIds }),
  }), 'Snowflake adapter');
  return response.json() as Promise<SnowflakeQueryPayload>;
}

export function resolveShopifyFirst(
  products: ShopifyProduct[],
  supplements: SnowflakeQueryPayload,
): ResolvedCatalogProduct[] {
  const analytics = new Map(supplements.rows.map(row => [row.productId, row]));
  // Product, variant, price, and inventory fields are never spread from Snowflake.
  return products.map(product => ({ ...product, source: 'shopify', analytics: analytics.get(product.id) ?? null }));
}

function setCssTheme(theme: ShopifyThemeSettings): void {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  style.setProperty('--knickgasm-primary-green', theme.colors.primary);
  style.setProperty('--knickgasm-accent-lava', theme.colors.accent);
  style.setProperty('--knickgasm-body-font', JSON.stringify(theme.typography.bodyFamily));
}

function loadTexture(
  url: string | undefined,
  textureLoader: SpatialTextureLoader | undefined,
  signal: AbortSignal,
) {
  if (!url || !textureLoader) return Promise.resolve(null);
  return textureLoader(url, signal).catch(() => null);
}

export async function injectTheme(
  theme: ShopifyThemeSettings,
  uniforms: MaterialUniforms,
  signal: AbortSignal,
  textureLoader?: SpatialTextureLoader,
): Promise<void> {
  setCssTheme(theme);
  uniforms.uPrimaryGreen.value = theme.colors.primary;
  uniforms.uAccentGold.value = theme.colors.accent;
  const [environment, product] = await Promise.all([
    loadTexture(theme.assets.environmentMapUrl, textureLoader, signal),
    loadTexture(theme.assets.productTextureUrl, textureLoader, signal),
  ]);
  if (!signal.aborted) {
    uniforms.uEnvironmentMap.value?.dispose();
    uniforms.uProductTexture.value?.dispose();
    uniforms.uEnvironmentMap.value = environment;
    uniforms.uProductTexture.value = product;
  }
}

export function createSpatialLayout(isMetaLander: boolean): SpatialLayout {
  return {
    canvas: { dpr: [1, 2], camera: { position: [0, 0.25, 7], fov: 38 } },
    stage: { position: [0, -0.1, 0], rotation: [0, -0.08, 0], scale: 1 },
    checkoutPlane: isMetaLander ? {
      position: [1.7, -0.15, 0.8], size: [2.25, 3.1],
      motion: {
        initial: { opacity: 0, x: 1.2, rotateY: -0.2 },
        animate: { opacity: 1, x: 0, rotateY: 0 },
        exit: { opacity: 0, x: 0.8, rotateY: -0.12 },
        transition: { type: 'spring', stiffness: 170, damping: 24, mass: 0.8 },
      },
    } : null,
  };
}

export function useKnickgasm3DEngine(options: Knickgasm3DEngineOptions): Knickgasm3DEngineResult {
  const requestUrl = options.url ?? (typeof window === 'undefined' ? 'https://knickgasm.com/' : window.location.href);
  const route = useMemo(() => routeKnickgasmRequest(requestUrl), [requestUrl]);
  const uniforms = useRef<MaterialUniforms>({
    uPrimaryGreen: { value: DEFAULT_THEME.colors.primary }, uAccentGold: { value: DEFAULT_THEME.colors.accent },
    uEnvironmentMap: { value: null }, uProductTexture: { value: null },
  }).current;
  const [products, setProducts] = useState<ResolvedCatalogProduct[]>([]);
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);
  const [mcpState, setMcpState] = useState<Knickgasm3DEngineResult['mcp']>(null);

  useEffect(() => {
    const controller = new AbortController();
    const fetcher = options.fetcher ?? fetch;
    setLoading(true); setError(null);
    void (async () => {
      try {
        const shopify = await fetchShopifyCatalog(
          options.storefrontEndpoints[route.detectedRegion], options.storefrontTokens[route.detectedRegion],
          fetcher, controller.signal,
        );
        // Snowflake failure is supplemental and must not make the authoritative catalog unavailable.
        const snowflake = await fetchSnowflakeSupplements(
          options.snowflakeEndpoint, shopify.products.map(product => product.id), fetcher, controller.signal,
        ).catch((): SnowflakeQueryPayload => ({ columns: [], rows: [], queryId: 'fallback' }));
        const mcpResult = options.mcp ? await Promise.all([
          options.mcp.animation('knickgasm-product-orbit', controller.signal),
          options.mcp.physics('knickgasm-glass-spring', controller.signal),
        ]) : null;
        await injectTheme(shopify.theme, uniforms, controller.signal, options.textureLoader);
        if (!controller.signal.aborted) {
          setProducts(resolveShopifyFirst(shopify.products, snowflake));
          setTheme(shopify.theme);
          setMcpState(mcpResult ? { animation: mcpResult[0], physics: mcpResult[1] } : null);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [options.fetcher, options.mcp, options.snowflakeEndpoint, options.storefrontEndpoints,
    options.storefrontTokens, options.textureLoader, revision, route.detectedRegion, uniforms]);

  useEffect(() => () => {
    uniforms.uEnvironmentMap.value?.dispose();
    uniforms.uProductTexture.value?.dispose();
  }, [uniforms]);

  return {
    ...route, products, uniforms, loading, error, renderer: options.renderer ?? null, mcp: mcpState,
    themeTokens: { primaryGreen: theme.colors.primary, accentGold: theme.colors.accent, bodyFont: theme.typography.bodyFamily },
    layout: createSpatialLayout(route.isMetaLander), refresh: () => setRevision(value => value + 1),
  };
}
