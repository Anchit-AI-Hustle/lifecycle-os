export type KnickgasmRegion = 'US' | 'UK' | 'GLOBAL';

/** Minimal resource contract implemented by Three.js Texture without coupling this package to Three. */
export interface DisposableTexture {
  dispose(): void;
}

/** Renderer is owned by the canvas host so the data engine remains SSR and test safe. */
export interface SpatialRenderer {
  dispose(): void;
  setPixelRatio?(ratio: number): void;
  setSize?(width: number, height: number, updateStyle?: boolean): void;
}

export type SpatialTextureLoader = (
  url: string,
  signal: AbortSignal,
) => Promise<DisposableTexture | null>;

export interface MoneyV2 {
  amount: string;
  currencyCode: string;
}

export interface ShopifyImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

export interface ShopifyProductVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  quantityAvailable: number | null;
  price: MoneyV2;
  compareAtPrice: MoneyV2 | null;
  image: ShopifyImage | null;
}

export interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  productType: string;
  vendor: string;
  featuredImage: ShopifyImage | null;
  variants: { nodes: ShopifyProductVariant[] };
  updatedAt: string;
}

export interface ShopifyThemeSettings {
  colors: { primary: string; accent: string };
  typography: { bodyFamily: string };
  assets: { environmentMapUrl?: string; productTextureUrl?: string };
}

export interface ShopifyStorefrontPayload {
  data: {
    products: { nodes: ShopifyProduct[] };
    metaobject: { fields: Array<{ key: string; value: string }> } | null;
  };
  errors?: Array<{ message: string; path?: Array<string | number> }>;
}

export interface SnowflakeProductSupplement {
  productId: string;
  affinityScore: number | null;
  repeatPurchaseRate: number | null;
  merchandisingCopy: string | null;
  lastComputedAt: string;
}

export interface SnowflakeQueryPayload {
  columns: Array<keyof SnowflakeProductSupplement>;
  rows: SnowflakeProductSupplement[];
  queryId: string;
}

export interface ResolvedCatalogProduct extends ShopifyProduct {
  source: 'shopify';
  analytics: SnowflakeProductSupplement | null;
}

export interface KnickgasmRegionState {
  detectedRegion: KnickgasmRegion;
  isMetaLander: boolean;
  currency: 'USD' | 'GBP';
  themeTokens: {
    primaryGreen: string;
    accentGold: string;
    bodyFont: string;
  };
}

export interface MaterialUniforms {
  uPrimaryGreen: { value: string };
  uAccentGold: { value: string };
  uEnvironmentMap: { value: DisposableTexture | null };
  uProductTexture: { value: DisposableTexture | null };
}

export interface SpatialLayout {
  canvas: { dpr: [number, number]; camera: { position: [number, number, number]; fov: number } };
  stage: { position: [number, number, number]; rotation: [number, number, number]; scale: number };
  checkoutPlane: null | {
    position: [number, number, number];
    size: [number, number];
    motion: { initial: object; animate: object; exit: object; transition: object };
  };
}

export interface McpSpatialAdapter {
  template(name: string, context: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  animation(name: string, signal: AbortSignal): Promise<Record<string, unknown>>;
  physics(name: string, signal: AbortSignal): Promise<Record<string, unknown>>;
}
