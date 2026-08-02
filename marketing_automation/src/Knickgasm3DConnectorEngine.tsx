/**
 * Knickgasm3DConnectorEngine.tsx
 * ---------------------------------------------------------------------------
 * The absolute 3D engine, multi-region routing pipeline, data-sync framework,
 * and external asset connector for the Knickgasm system.
 *
 * This single file is a React 19 context provider + data-orchestration
 * middleware. It runs inside the `marketing_automation/` Vite app (the only
 * bundled React surface in this repo). For the vanilla static HTML pages
 * (home, landing pages, LHS nav) it is consumed through the no-build ESM
 * bridge at `assets/knickgasm3d-bridge.js`, which mounts a compiled build of the
 * engine into a `<div data-knickgasm3d>` mount point.
 *
 * What it does
 *   1. Dual-data resolution — Shopify Storefront (US/UK/Global) is the primary
 *      source for catalog, pricing and live inventory; a Snowflake→Supabase
 *      daily mirror is the fallback for historical analytics / deep metrics.
 *   2. Domain routing — regex host parsing detects Meta-ads landers
 *      (`knickgasm.com`, `knickgasm.com`) and exposes `isMetaLander`,
 *      collapsing the scene into a single-product spatial checkout.
 *   3. Strictly-3D rendering — a continuous WebGL scene (three +
 *      @react-three/fiber) of floating mesh / glassmorphic panels, with an
 *      automatic fast 2D fallback for low-end / mobile / reduced-motion /
 *      no-WebGL / crawler traffic (progressive enhancement — protects ad
 *      conversion without abandoning the 3D vision).
 *   4. Brand style injection — pulls the live Shopify theme's structural
 *      variables (primary green, accent lava, surface, typography) and injects
 *      them into shader uniforms + CSS custom properties, falling back to the
 *      documented brand constants when the live theme can't be read.
 *
 * A note on the "MCP / Framer" asset connector: live discovery of Framer /
 * Framer Motion presets over an MCP server needs an interactive OAuth session,
 * which is not available at build time. So this file bakes in the well-known
 * Framer Motion spring presets as constants AND exposes a pluggable
 * `configureAssetSource()` hook so a live MCP/Framer connector can be wired in
 * later without touching call sites. Nothing here fabricates a connection it
 * does not have — unconfigured connectors return typed, inspectable stubs
 * (the same `{ connected:false, wouldRequest }` pattern the repo uses for
 * Klaviyo / Snowflake).
 *
 * @module Knickgasm3DConnectorEngine
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Html,
  RoundedBox,
  Environment,
  Float,
  ContactShadows,
  PerspectiveCamera,
  AdaptiveDpr,
  Preload,
} from '@react-three/drei';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. STRICT TYPE DEFINITIONS
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The four Knickgasm regional storefronts the engine can bind to. */
export type Region = 'us' | 'uk' | 'global';

/** Render tier resolved from device / environment capability detection. */
export type RenderTier = '3d' | '2d';

/** Theme variation: dark background + light text, or light background + dark text. */
export type RenderVariant = 'dark' | 'light';

/** Lifecycle of any single connector or the engine as a whole. */
export type ConnectorPhase = 'idle' | 'connecting' | 'ready' | 'error' | 'stub';

/** A typed result envelope so every async path is total (no thrown surprises). */
export type EngineResult<T> =
  | { ok: true; data: T; source: DataSource; tookMs: number }
  | { ok: false; error: EngineError; source: DataSource };

export type DataSource = 'shopify-storefront' | 'shopify-public' | 'snowflake-mirror' | 'brand-constants' | 'stub';

export interface EngineError {
  code:
    | 'NETWORK'
    | 'NOT_CONFIGURED'
    | 'PARSE'
    | 'NOT_FOUND'
    | 'RATE_LIMIT'
    | 'WEBGL_UNAVAILABLE'
    | 'UNKNOWN';
  message: string;
  cause?: unknown;
  /** For unconfigured connectors: the request that WOULD have been made. */
  wouldRequest?: { method: string; url: string; body?: unknown };
}

/** Brand theme extracted from Shopify (or the documented brand fallback). */
export interface BrandTheme {
  /** Primary deep purple. */
  primary: string;
  /** Accent lava. */
  accent: string;
  /** Near-black ink. */
  ink: string;
  /** Chalk surface. */
  surface: string;
  headingFont: string;
  bodyFont: string;
  /** 0..1 ambient light level applied to the 3D scene. */
  surfaceLightLevel: number;
  origin: 'live-theme' | 'brand-constants';
}

/** Normalized Shopify product from either the Storefront API or /products.json. */
export interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  /** Region-formatted price string, e.g. "$24.00" / "£19.00". */
  priceDisplay: string;
  priceAmount: number;
  currency: string;
  available: boolean;
  imageUrl: string | null;
  /** PDP url on the correct regional storefront. */
  url: string;
}

/** Historical / deep-metric record from the Snowflake→Supabase mirror. */
export interface AnalyticsRecord {
  metric: string;
  region: Region;
  value: number;
  window: string;
  capturedAt: string;
}

/** Framer Motion spring preset (documented values; MCP-pluggable). */
export interface SpringPreset {
  name: string;
  stiffness: number;
  damping: number;
  mass: number;
}

/** Live brand tokens surfaced with the route (shape mirrors the architecture spec). */
export interface RouteThemeTokens {
  primaryGreen: string;
  accentGold: string;
  bodyFont: string;
}

/**
 * Result of host parsing for multi-region + Meta-ads routing.
 * Field names mirror the architecture diagram's region resolver:
 * { detectedRegion, isMetaLander, currency, themeTokens }.
 */
export interface RouteResolution {
  host: string;
  detectedRegion: Region;
  isMetaLander: boolean;
  currency: string;
  themeTokens: RouteThemeTokens;
  /** When a lander, the single product/bundle handle to isolate (if in path). */
  isolatedHandle: string | null;
  storeBase: string;
}

/** The value exposed by the context to every consumer. */
export interface Knickgasm3DContextValue {
  phase: ConnectorPhase;
  route: RouteResolution;
  theme: BrandTheme;
  tier: RenderTier;
  products: ShopifyProduct[];
  loading: boolean;
  error: EngineError | null;
  /** Sourcing-hierarchy resolver: Shopify first, Snowflake mirror fallback. */
  resolveData: <T = unknown>(query: DataQuery) => Promise<EngineResult<T>>;
  refreshCatalog: () => Promise<void>;
  triggerSnowflakeSync: () => Promise<EngineResult<{ queued: boolean }>>;
  springPreset: (name: keyof typeof FRAMER_SPRING_PRESETS) => SpringPreset;
  variant: RenderVariant;
  /** Resolved scene backdrop + foreground for the active variant. */
  sceneBg: string;
  sceneFg: string;
}

/** A unit of work for the data-orchestration middleware. */
export interface DataQuery {
  kind: 'catalog' | 'product' | 'inventory' | 'copy' | 'historical' | 'metric';
  handle?: string;
  metric?: string;
  window?: string;
}

export interface Knickgasm3DConnectorEngineProps {
  children?: ReactNode;
  /** Force a region instead of deriving from the hostname (useful in Vite dev). */
  regionOverride?: Region;
  /** Force a render tier (mostly for testing / storybook). */
  tierOverride?: RenderTier;
  /** Theme variation: 'dark' (default) or 'light'. */
  variant?: RenderVariant;
  /** Fill the whole viewport with the canvas. Default true. */
  fullViewport?: boolean;
  /** Render the 3D store scene as the provider's own child. Default true. */
  renderScene?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. BRAND + REGION CONSTANTS (source of truth: Brand style guide)
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The ONLY four brand colours + the two mandated font families. */
export const BRAND = {
  primary: '#6A33D8', // deep purple
  accent: '#D0473E', // lava
  ink: '#111111', // near-black
  surface: '#F7F5F2', // chalk
  headingFont: "'Montserrat','Raleway',Georgia,serif",
  bodyFont: "'Instrument Sans','Helvetica Neue',Arial,sans-serif",
} as const;

const BRAND_THEME_FALLBACK: BrandTheme = {
  primary: BRAND.primary,
  accent: BRAND.accent,
  ink: BRAND.ink,
  surface: BRAND.surface,
  headingFont: BRAND.headingFont,
  bodyFont: BRAND.bodyFont,
  surfaceLightLevel: 0.62,
  origin: 'brand-constants',
};

/**
 * Regional storefront + Meta-ads lander map.
 * Store bases match the VERIFIED market URLs in CLAUDE.md; the `try.*` hosts
 * are the Meta-ads landers (also present in this app's compiler.ts links).
 */
export const STORE_DOMAINS: Record<
  Region,
  { storeBase: string; landerHosts: RegExp[]; currency: string }
> = {
  us: {
    storeBase: 'https://knickgasm.com',
    landerHosts: [/^try\.knickgasm\.com$/i],
    currency: 'USD',
  },
  uk: {
    storeBase: 'https://knickgasm.com',
    landerHosts: [/^try\.knickgasm\.co\.uk$/i],
    currency: 'GBP',
  },
  global: {
    storeBase: 'https://knickgasm.com',
    landerHosts: [/^try\.knickgasm\.global$/i],
    currency: 'USD',
  },
};

/** Master regex used for fast lander detection across all regions. */
const META_LANDER_RE = /^try\.knickgasm\.(com|co\.uk|global)$/i;

/**
 * Curated Framer Motion spring presets (documented public values). These stand
 * in for live MCP/Framer discovery; swap the source via `configureAssetSource`.
 */
export const FRAMER_SPRING_PRESETS = {
  gentle: { name: 'gentle', stiffness: 120, damping: 14, mass: 1 },
  snappy: { name: 'snappy', stiffness: 400, damping: 28, mass: 0.8 },
  bouncy: { name: 'bouncy', stiffness: 300, damping: 10, mass: 1 },
  molasses: { name: 'molasses', stiffness: 80, damping: 20, mass: 1.4 },
  panel: { name: 'panel', stiffness: 210, damping: 22, mass: 1 },
} as const satisfies Record<string, SpringPreset>;

/** Where the client asks the backend to trigger a Snowflake→Supabase pull. */
export const SNOWFLAKE_SYNC_ENDPOINT = '/api/snowflake-sync';

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. PLUGGABLE ASSET SOURCE (MCP / Framer connector seam)
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface AssetSource {
  getSpringPreset(name: string): SpringPreset;
  /** Optional live physics-preset discovery (wired to an MCP server later). */
  discoverPresets?(): Promise<SpringPreset[]>;
}

const defaultAssetSource: AssetSource = {
  getSpringPreset(name) {
    const key = name as keyof typeof FRAMER_SPRING_PRESETS;
    return FRAMER_SPRING_PRESETS[key] ?? FRAMER_SPRING_PRESETS.panel;
  },
};

let activeAssetSource: AssetSource = defaultAssetSource;

/**
 * Inject a live asset connector (e.g. an MCP-backed Framer Motion presets
 * source) at runtime. Call once during app bootstrap before mounting.
 */
export function configureAssetSource(source: AssetSource): void {
  activeAssetSource = source;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. DOMAIN ROUTING ENGINE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Parse a hostname + pathname into region + Meta-ads-lander routing.
 * Pure and synchronous — safe to call in render and on the server.
 */
export function parseRoute(
  host: string,
  pathname: string = '',
  regionOverride?: Region,
): RouteResolution {
  const cleanHost = (host || '').trim().toLowerCase().replace(/:\d+$/, '');
  const isMetaLander = META_LANDER_RE.test(cleanHost);

  let region: Region = regionOverride ?? 'us';
  if (!regionOverride) {
    if (/\.co\.uk$/i.test(cleanHost) || cleanHost === 'knickgasm.com') region = 'uk';
    else if (/\.global$/i.test(cleanHost)) region = 'global';
    else region = 'us';
  }

  // Meta landers isolate a single product/bundle taken from the first path seg
  // (e.g. knickgasm.com/face_puffiness_v1 → "face_puffiness_v1").
  let isolatedHandle: string | null = null;
  if (isMetaLander) {
    const seg = pathname.split('/').filter(Boolean)[0];
    isolatedHandle = seg ? decodeURIComponent(seg) : null;
  }

  return {
    host: cleanHost,
    detectedRegion: region,
    isMetaLander,
    currency: STORE_DOMAINS[region].currency,
    // Live brand tokens (values stay locked to the brand style guide).
    themeTokens: { primaryGreen: BRAND.primary, accentGold: BRAND.accent, bodyFont: BRAND.bodyFont },
    isolatedHandle,
    storeBase: STORE_DOMAINS[region].storeBase,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. CAPABILITY DETECTION → RENDER TIER (3D vs fast 2D fallback)
 * ═══════════════════════════════════════════════════════════════════════════ */

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
}

function isCrawler(): boolean {
  if (typeof navigator === 'undefined') return true; // SSR / prerender → 2D
  return /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|lighthouse|headless/i.test(
    navigator.userAgent || '',
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isLowPowerDevice(): boolean {
  if (typeof navigator === 'undefined') return true;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency;
  if (typeof mem === 'number' && mem <= 2) return true;
  if (typeof cores === 'number' && cores <= 2) return true;
  return false;
}

/**
 * Resolve the render tier. 3D is only used when WebGL is present, the device is
 * not obviously low-power, motion is allowed and the visitor is not a crawler.
 * Everything else falls back to a fast 2D brand layout.
 */
export function detectRenderTier(override?: RenderTier): RenderTier {
  if (override) return override;
  if (isCrawler()) return '2d';
  if (prefersReducedMotion()) return '2d';
  if (!hasWebGL()) return '2d';
  if (isLowPowerDevice()) return '2d';
  return '3d';
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. CONNECTORS — Shopify Storefront (+ public fallback) & Snowflake mirror
 * ═══════════════════════════════════════════════════════════════════════════ */

const STOREFRONT_TOKEN =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SHOPIFY_STOREFRONT_TOKEN) ||
  '';

const STOREFRONT_API_VERSION = '2024-10';

function now(): number {
  // Guard: some sandboxes stub Date; keep it defensive.
  try {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  } catch {
    return 0;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 12000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shopify connector. Prefers the authenticated Storefront GraphQL API when a
 * token is present; otherwise degrades to the PUBLIC `/products.json` endpoint
 * — which is the only mode authorized in this repo (Admin connector is not).
 */
export class ShopifyStorefrontConnector {
  constructor(private readonly region: Region) {}

  private get base(): string {
    return STORE_DOMAINS[this.region].storeBase;
  }

  private get currency(): string {
    return STORE_DOMAINS[this.region].currency;
  }

  private formatPrice(amount: number): string {
    const symbol = this.currency === 'GBP' ? '£' : '$';
    return `${symbol}${amount.toFixed(2)}`;
  }

  private normalizePublic(p: any): ShopifyProduct {
    const variant = p?.variants?.[0] ?? {};
    const amount = Number.parseFloat(variant.price ?? '0') || 0;
    const image = p?.images?.[0]?.src ?? null;
    return {
      id: String(p?.id ?? p?.handle ?? ''),
      handle: String(p?.handle ?? ''),
      title: String(p?.title ?? ''),
      description: String(p?.body_html ?? '').replace(/<[^>]+>/g, '').slice(0, 400),
      priceAmount: amount,
      priceDisplay: this.formatPrice(amount),
      currency: this.currency,
      available: variant.available !== false,
      imageUrl: image,
      url: `${this.base}/products/${p?.handle ?? ''}`,
    };
  }

  /** Fetch the catalog. Storefront GraphQL if token, else public products.json. */
  async fetchCatalog(limit = 24): Promise<EngineResult<ShopifyProduct[]>> {
    const started = now();
    if (STOREFRONT_TOKEN) {
      try {
        const res = await fetchWithTimeout(
          `${this.base}/api/${STOREFRONT_API_VERSION}/graphql.json`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
            },
            body: JSON.stringify({
              query: `query($n:Int!){products(first:$n){edges{node{id handle title description
                featuredImage{url} variants(first:1){edges{node{availableForSale
                price{amount currencyCode}}}}}}}}`,
              variables: { n: limit },
            }),
          },
        );
        if (!res.ok) throw new Error(`storefront ${res.status}`);
        const json: any = await res.json();
        const edges = json?.data?.products?.edges ?? [];
        const products: ShopifyProduct[] = edges.map((e: any) => {
          const n = e.node;
          const v = n?.variants?.edges?.[0]?.node ?? {};
          const amount = Number.parseFloat(v?.price?.amount ?? '0') || 0;
          return {
            id: String(n.id),
            handle: String(n.handle),
            title: String(n.title),
            description: String(n.description ?? '').slice(0, 400),
            priceAmount: amount,
            priceDisplay: this.formatPrice(amount),
            currency: v?.price?.currencyCode ?? this.currency,
            available: v?.availableForSale !== false,
            imageUrl: n?.featuredImage?.url ?? null,
            url: `${this.base}/products/${n.handle}`,
          };
        });
        return { ok: true, data: products, source: 'shopify-storefront', tookMs: now() - started };
      } catch (cause) {
        // Fall through to public mode rather than fail hard.
      }
    }

    try {
      const res = await fetchWithTimeout(`${this.base}/products.json?limit=${limit}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`public ${res.status}`);
      const json: any = await res.json();
      const products = (json?.products ?? []).map((p: any) => this.normalizePublic(p));
      return { ok: true, data: products, source: 'shopify-public', tookMs: now() - started };
    } catch (cause) {
      return {
        ok: false,
        source: 'shopify-public',
        error: { code: 'NETWORK', message: 'Shopify catalog fetch failed', cause },
      };
    }
  }

  /**
   * Extract structural theme variables from the live storefront. We read the
   * public settings_data via the theme editor JSON when reachable; when CORS or
   * availability blocks it, we return the documented brand constants (never a
   * fabricated theme).
   */
  async fetchThemeStyle(): Promise<EngineResult<BrandTheme>> {
    const started = now();
    try {
      // Public, cache-friendly settings surface. May be CORS-blocked in-browser;
      // that's expected and handled by the fallback below.
      const res = await fetchWithTimeout(
        `${this.base}/?sections=header`,
        { method: 'GET', headers: { Accept: 'text/html' } },
        6000,
      );
      if (!res.ok) throw new Error(`theme ${res.status}`);
      const html = await res.text();
      const grabHex = (re: RegExp, fallback: string) => {
        const m = html.match(re);
        return m && /^#?[0-9a-f]{6}$/i.test(m[1]) ? (m[1].startsWith('#') ? m[1] : `#${m[1]}`) : fallback;
      };
      const theme: BrandTheme = {
        primary: grabHex(/--color-primary:\s*(#?[0-9a-f]{6})/i, BRAND.primary),
        accent: grabHex(/--color-accent:\s*(#?[0-9a-f]{6})/i, BRAND.accent),
        ink: grabHex(/--color-foreground:\s*(#?[0-9a-f]{6})/i, BRAND.ink),
        surface: grabHex(/--color-background:\s*(#?[0-9a-f]{6})/i, BRAND.surface),
        headingFont: BRAND.headingFont,
        bodyFont: BRAND.bodyFont,
        surfaceLightLevel: 0.62,
        origin: 'live-theme',
      };
      return { ok: true, data: theme, source: 'shopify-public', tookMs: now() - started };
    } catch (cause) {
      // Graceful, brand-true fallback — the design signature is documented.
      return { ok: true, data: BRAND_THEME_FALLBACK, source: 'brand-constants', tookMs: now() - started };
    }
  }
}

/**
 * Snowflake bridge. In this repo the warehouse is NOT queried directly from the
 * browser — a daily server-side job mirrors Snowflake into Supabase (see
 * `api/_shared/snowflake-sync-core.js`). This connector therefore reads the
 * Supabase mirror for historical/deep metrics and can request a fresh pull via
 * the sync webhook. If the mirror endpoint isn't configured it returns a typed
 * stub instead of throwing.
 */
export class SnowflakeMirrorConnector {
  constructor(private readonly region: Region) {}

  async queryHistorical(metric: string, window = '30d'): Promise<EngineResult<AnalyticsRecord[]>> {
    const started = now();
    const url = `/api/brain?action=snowflake-metrics&region=${this.region}&metric=${encodeURIComponent(
      metric,
    )}&window=${encodeURIComponent(window)}`;
    try {
      const res = await fetchWithTimeout(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (res.status === 404 || res.status === 501) {
        return {
          ok: false,
          source: 'stub',
          error: {
            code: 'NOT_CONFIGURED',
            message: 'Snowflake mirror not configured; run the daily sync first.',
            wouldRequest: { method: 'GET', url },
          },
        };
      }
      if (!res.ok) throw new Error(`mirror ${res.status}`);
      const json: any = await res.json();
      const rows: AnalyticsRecord[] = (json?.rows ?? []).map((r: any) => ({
        metric: String(r.metric ?? metric),
        region: (r.region ?? this.region) as Region,
        value: Number(r.value ?? 0),
        window: String(r.window ?? window),
        capturedAt: String(r.captured_at ?? r.capturedAt ?? ''),
      }));
      return { ok: true, data: rows, source: 'snowflake-mirror', tookMs: now() - started };
    } catch (cause) {
      return {
        ok: false,
        source: 'snowflake-mirror',
        error: { code: 'NETWORK', message: 'Snowflake mirror query failed', cause },
      };
    }
  }

  /** Ask the backend to pull fresh data from Snowflake into Supabase now. */
  async triggerSync(): Promise<EngineResult<{ queued: boolean }>> {
    const started = now();
    try {
      const res = await fetchWithTimeout(SNOWFLAKE_SYNC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region: this.region, source: 'engine' }),
      });
      if (res.status === 404 || res.status === 501) {
        return {
          ok: false,
          source: 'stub',
          error: {
            code: 'NOT_CONFIGURED',
            message: 'Snowflake sync endpoint not deployed / SNOWFLAKE_* env not set.',
            wouldRequest: { method: 'POST', url: SNOWFLAKE_SYNC_ENDPOINT, body: { region: this.region } },
          },
        };
      }
      if (!res.ok) throw new Error(`sync ${res.status}`);
      const json: any = await res.json().catch(() => ({}));
      return { ok: true, data: { queued: json?.queued !== false }, source: 'snowflake-mirror', tookMs: now() - started };
    } catch (cause) {
      return {
        ok: false,
        source: 'snowflake-mirror',
        error: { code: 'NETWORK', message: 'Could not reach Snowflake sync endpoint', cause },
      };
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. STYLE INJECTION — CSS custom properties from the resolved theme
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Push the resolved brand theme into global CSS custom properties. */
export function injectBrandCSSVars(theme: BrandTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // Var names mirror the architecture spec (--knickgasm-green/-lava/-font); values
  // stay locked to the brand style guide.
  root.style.setProperty('--knickgasm-green', theme.primary);
  root.style.setProperty('--knickgasm-lava', theme.accent);
  root.style.setProperty('--knickgasm-ink', theme.ink);
  root.style.setProperty('--knickgasm-surface', theme.surface);
  root.style.setProperty('--knickgasm-head-font', theme.headingFont);
  root.style.setProperty('--knickgasm-font', theme.bodyFont);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. REACT CONTEXT + PROVIDER
 * ═══════════════════════════════════════════════════════════════════════════ */

const Knickgasm3DContext = createContext<Knickgasm3DContextValue | null>(null);

/** Consume the engine. Throws a helpful error if used outside the provider. */
export function useKnickgasm3D(): Knickgasm3DContextValue {
  const ctx = useContext(Knickgasm3DContext);
  if (!ctx) {
    throw new Error('useKnickgasm3D must be used within <Knickgasm3DConnectorEngine>.');
  }
  return ctx;
}

/**
 * The provider = context + data-orchestration middleware. It resolves the
 * route, detects the render tier, connects Shopify + the Snowflake mirror,
 * injects the brand theme, and (optionally) renders the 3D store scene.
 */
export function Knickgasm3DConnectorEngine({
  children,
  regionOverride,
  tierOverride,
  variant = 'dark',
  fullViewport = true,
  renderScene = true,
}: Knickgasm3DConnectorEngineProps) {
  const sceneBg = variant === 'light' ? '#ffffff' : BRAND.ink;
  const sceneFg = variant === 'light' ? BRAND.ink : BRAND.surface;
  const route = useMemo<RouteResolution>(() => {
    if (typeof window === 'undefined') {
      return parseRoute('knickgasm.com', '/', regionOverride);
    }
    return parseRoute(window.location.hostname, window.location.pathname, regionOverride);
  }, [regionOverride]);

  const [tier] = useState<RenderTier>(() => detectRenderTier(tierOverride));
  const [phase, setPhase] = useState<ConnectorPhase>('idle');
  const [theme, setTheme] = useState<BrandTheme>(BRAND_THEME_FALLBACK);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<EngineError | null>(null);

  const shopify = useMemo(() => new ShopifyStorefrontConnector(route.detectedRegion), [route.detectedRegion]);
  const snowflake = useMemo(() => new SnowflakeMirrorConnector(route.detectedRegion), [route.detectedRegion]);

  const refreshCatalog = useCallback(async () => {
    // Meta landers only need the single isolated product/bundle.
    const limit = route.isMetaLander ? 4 : 24;
    const res = await shopify.fetchCatalog(limit);
    if (res.ok) {
      const list = route.isolatedHandle
        ? res.data.filter((p) => p.handle === route.isolatedHandle).concat(res.data).slice(0, limit)
        : res.data;
      setProducts(list);
      setError(null);
    } else {
      setError(res.error);
    }
  }, [shopify, route.isMetaLander, route.isolatedHandle]);

  // Boot sequence: theme first (drives materials), then catalog.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase('connecting');
      setLoading(true);
      try {
        const themeRes = await shopify.fetchThemeStyle();
        if (!cancelled && themeRes.ok) {
          setTheme(themeRes.data);
          injectBrandCSSVars(themeRes.data);
        }
        await refreshCatalog();
        if (!cancelled) setPhase('ready');
      } catch (cause) {
        if (!cancelled) {
          setError({ code: 'UNKNOWN', message: 'Engine boot failed', cause });
          setPhase('error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopify, refreshCatalog]);

  /**
   * Data-orchestration middleware. Enforces the sourcing hierarchy:
   *   catalog / product / inventory / copy → Shopify (native, live)
   *   historical / metric                  → Snowflake mirror (Supabase)
   */
  const resolveData = useCallback(
    async <T,>(query: DataQuery): Promise<EngineResult<T>> => {
      switch (query.kind) {
        case 'catalog':
        case 'inventory':
        case 'copy': {
          const r = await shopify.fetchCatalog();
          return r as unknown as EngineResult<T>;
        }
        case 'product': {
          const r = await shopify.fetchCatalog();
          if (!r.ok) return r as unknown as EngineResult<T>;
          const found = r.data.find((p) => p.handle === query.handle);
          if (!found) {
            return { ok: false, source: 'shopify-public', error: { code: 'NOT_FOUND', message: `No product ${query.handle}` } };
          }
          return { ok: true, data: found as unknown as T, source: r.source, tookMs: r.tookMs };
        }
        case 'historical':
        case 'metric': {
          const r = await snowflake.queryHistorical(query.metric ?? 'orders', query.window);
          return r as unknown as EngineResult<T>;
        }
        default:
          return { ok: false, source: 'stub', error: { code: 'UNKNOWN', message: 'Unknown query kind' } };
      }
    },
    [shopify, snowflake],
  );

  const triggerSnowflakeSync = useCallback(() => snowflake.triggerSync(), [snowflake]);

  const springPreset = useCallback(
    (name: keyof typeof FRAMER_SPRING_PRESETS) => activeAssetSource.getSpringPreset(name),
    [],
  );

  const value: Knickgasm3DContextValue = useMemo(
    () => ({
      phase,
      route,
      theme,
      tier,
      products,
      loading,
      error,
      resolveData,
      refreshCatalog,
      triggerSnowflakeSync,
      springPreset,
      variant,
      sceneBg,
      sceneFg,
    }),
    [phase, route, theme, tier, products, loading, error, resolveData, refreshCatalog, triggerSnowflakeSync, springPreset, variant, sceneBg, sceneFg],
  );

  return (
    <Knickgasm3DContext.Provider value={value}>
      {renderScene ? (
        <Knickgasm3DViewport fullViewport={fullViewport} />
      ) : null}
      {children}
    </Knickgasm3DContext.Provider>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 9. THE VIEWPORT — 3D scene with automatic 2D fallback
 * ═══════════════════════════════════════════════════════════════════════════ */

function Knickgasm3DViewport({ fullViewport }: { fullViewport: boolean }) {
  const { tier } = useKnickgasm3D();
  const style: React.CSSProperties = fullViewport
    ? { position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: 0 }
    : { position: 'relative', width: '100%', height: '70vh', minHeight: 420 };

  if (tier === '2d') {
    return (
      <div style={style} data-v3d-tier="2d">
        <Fallback2DStore />
      </div>
    );
  }
  return (
    <div style={style} data-v3d-tier="3d">
      <Scene3DErrorBoundary fallback={<Fallback2DStore />}>
        <ThreeStoreScene />
      </Scene3DErrorBoundary>
    </div>
  );
}

/** Error boundary — any runtime WebGL/scene failure drops to the 2D layout. */
class Scene3DErrorBoundary extends React.Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn('[Knickgasm3D] scene error, falling back to 2D:', error);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

/** Canvas-level loading state shown while assets/GPU warm up. */
function CanvasLoader() {
  return (
    <Html center>
      <div
        style={{
          fontFamily: BRAND.bodyFont,
          color: BRAND.surface,
          background: 'rgba(0,74,43,0.72)',
          padding: '10px 18px',
          borderRadius: 999,
          backdropFilter: 'blur(8px)',
          fontSize: 13,
          letterSpacing: '0.04em',
        }}
      >
        Lacing the scene…
      </div>
    </Html>
  );
}

function ThreeStoreScene() {
  const { theme, route, products, loading, sceneBg } = useKnickgasm3D();
  const primary = new THREE.Color(theme.primary);
  const accent = new THREE.Color(theme.accent);

  // Meta-ads landers isolate ONE spatial product/bundle → zero-friction checkout.
  const visible = route.isMetaLander ? products.slice(0, 1) : products.slice(0, 8);

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
      style={{ background: 'transparent' }}
      shadows
    >
      <color attach="background" args={[sceneBg]} />
      <fog attach="fog" args={[sceneBg, 8, 24]} />
      <AdaptiveDpr pixelated />
      <PerspectiveCamera makeDefault position={[0, 0.4, route.isMetaLander ? 5 : 8]} fov={45} />

      <ambientLight intensity={theme.surfaceLightLevel} />
      <directionalLight position={[5, 8, 5]} intensity={1.1} color={accent} castShadow />
      <pointLight position={[-6, -2, 4]} intensity={0.5} color={primary} />

      <Suspense fallback={<CanvasLoader />}>
        <Environment preset="studio" />
        {loading ? (
          <CanvasLoader />
        ) : (
          <ProductConstellation products={visible} isLander={route.isMetaLander} theme={theme} />
        )}
        <ContactShadows position={[0, -2.4, 0]} opacity={0.35} scale={20} blur={2.6} far={4} />
        <Preload all />
      </Suspense>

      <SlowOrbit enabled={!route.isMetaLander} />
    </Canvas>
  );
}

/** Gentle auto-orbit for the exploration view; static for lander checkout. */
function SlowOrbit({ enabled }: { enabled: boolean }) {
  const { camera } = useThree();
  const t = useRef(0);
  useFrame((_, delta) => {
    if (!enabled) return;
    t.current += delta * 0.08;
    const r = 8;
    camera.position.x = Math.sin(t.current) * r;
    camera.position.z = Math.cos(t.current) * r;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

/** Floating mesh product panels arranged as a spatial constellation. */
function ProductConstellation({
  products,
  isLander,
  theme,
}: {
  products: ShopifyProduct[];
  isLander: boolean;
  theme: BrandTheme;
}) {
  if (products.length === 0) {
    return (
      <Html center>
        <PanelCard title="Catalog loading" subtitle="Fetching live products from Shopify" theme={theme} />
      </Html>
    );
  }
  const radius = 3.4;
  return (
    <group>
      {products.map((p, i) => {
        const angle = (i / products.length) * Math.PI * 2;
        const pos: [number, number, number] = isLander
          ? [0, 0, 0]
          : [Math.cos(angle) * radius, Math.sin(angle * 0.6) * 1.1, Math.sin(angle) * radius];
        return <ProductPanel key={p.id || i} product={p} position={pos} theme={theme} big={isLander} />;
      })}
    </group>
  );
}

/** A single glassmorphic product panel floating in space. */
function ProductPanel({
  product,
  position,
  theme,
  big,
}: {
  product: ShopifyProduct;
  position: [number, number, number];
  theme: BrandTheme;
  big: boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!mesh.current) return;
    // Subtle billboard so panels always face the camera-ish.
    mesh.current.lookAt(state.camera.position);
  });
  const w = big ? 3.2 : 2.2;
  const h = big ? 3.8 : 2.7;
  return (
    <Float speed={1.4} rotationIntensity={0.2} floatIntensity={0.6}>
      <group position={position}>
        <RoundedBox ref={mesh} args={[w, h, 0.12]} radius={0.12} smoothness={6} castShadow>
          <meshPhysicalMaterial
            color={theme.surface}
            transmission={0.55}
            thickness={0.5}
            roughness={0.18}
            metalness={0.05}
            clearcoat={0.6}
            emissive={new THREE.Color(theme.primary)}
            emissiveIntensity={0.06}
            transparent
            opacity={0.94}
          />
          <Html
            transform
            distanceFactor={big ? 3.2 : 2.6}
            position={[0, 0, 0.08]}
            style={{ pointerEvents: 'auto' }}
          >
            <PanelCard
              title={product.title}
              subtitle={product.priceDisplay}
              href={product.url}
              image={product.imageUrl}
              cta={big ? 'Add to cart' : 'View'}
              theme={theme}
            />
          </Html>
        </RoundedBox>
      </group>
    </Float>
  );
}

/** The 2D DOM card rendered inside a 3D panel (drei <Html>). */
function PanelCard({
  title,
  subtitle,
  href,
  image,
  cta,
  theme,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  image?: string | null;
  cta?: string;
  theme: BrandTheme;
}) {
  return (
    <div
      style={{
        width: 220,
        borderRadius: 16,
        overflow: 'hidden',
        background: 'rgba(251,245,234,0.86)',
        border: `1px solid ${theme.accent}55`,
        boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
        fontFamily: theme.bodyFont,
        color: theme.ink,
        backdropFilter: 'blur(6px)',
      }}
    >
      {image ? (
        <img src={image} alt={title} style={{ width: '100%', height: 130, objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ height: 90, background: theme.primary }} />
      )}
      <div style={{ padding: 14 }}>
        <div style={{ fontFamily: theme.headingFont, fontSize: 16, lineHeight: 1.2, marginBottom: 6 }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 14, color: theme.primary, fontWeight: 700 }}>{subtitle}</div> : null}
        {href ? (
          <a
            href={href}
            style={{
              display: 'inline-block',
              marginTop: 10,
              padding: '8px 16px',
              borderRadius: 999,
              background: theme.primary,
              color: theme.surface,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {cta ?? 'View'}
          </a>
        ) : null}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 10. FAST 2D FALLBACK STORE (brand-true, ships to low-end / crawler traffic)
 * ═══════════════════════════════════════════════════════════════════════════ */

function Fallback2DStore() {
  const { products, theme, route, loading, error, sceneBg, sceneFg } = useKnickgasm3D();
  const list = route.isMetaLander ? products.slice(0, 1) : products.slice(0, 12);
  const subFg = sceneFg === theme.ink ? '#556059' : `${theme.surface}aa`;
  return (
    <div
      style={{
        width: '100%',
        minHeight: '100%',
        background: sceneBg,
        color: sceneFg,
        fontFamily: theme.bodyFont,
        padding: '48px 24px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontFamily: theme.headingFont, color: sceneFg, fontSize: 34, marginBottom: 6 }}>
          {route.isMetaLander ? 'Your ritual, one tap away' : 'Knickgasm'}
        </h1>
        <p style={{ color: subFg, marginBottom: 28, maxWidth: 560 }}>
          {route.isMetaLander
            ? 'A single, considered choice. Fast checkout, nothing in the way.'
            : 'Single-studio, hand-painted. Lace-up a moment that restores.'}
        </p>
        {loading ? (
          <p style={{ color: theme.accent }}>Loading the catalog…</p>
        ) : error ? (
          <p style={{ color: theme.accent }}>Catalog is briefly unavailable. Please refresh.</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: route.isMetaLander ? '1fr' : 'repeat(auto-fill, minmax(220px,1fr))',
              gap: 18,
            }}
          >
            <AnimatePresence>
              {list.map((p, i) => (
                <motion.a
                  key={p.id || i}
                  href={p.url}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', ...FRAMER_SPRING_PRESETS.panel, delay: i * 0.03 }}
                  style={{
                    display: 'block',
                    background: theme.surface,
                    color: theme.ink,
                    borderRadius: 16,
                    overflow: 'hidden',
                    textDecoration: 'none',
                    border: `1px solid ${theme.accent}33`,
                  }}
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.title} style={{ width: '100%', height: 160, objectFit: 'cover' }} />
                  ) : (
                    <div style={{ height: 120, background: theme.primary }} />
                  )}
                  <div style={{ padding: 14 }}>
                    <div style={{ fontFamily: theme.headingFont, fontSize: 17, marginBottom: 4 }}>{p.title}</div>
                    <div style={{ color: theme.primary, fontWeight: 700 }}>{p.priceDisplay}</div>
                    <div
                      style={{
                        marginTop: 10,
                        padding: '9px 16px',
                        borderRadius: 999,
                        background: theme.primary,
                        color: theme.surface,
                        textAlign: 'center',
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      {route.isMetaLander ? 'Add to cart' : 'View'}
                    </div>
                  </div>
                </motion.a>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

export default Knickgasm3DConnectorEngine;
