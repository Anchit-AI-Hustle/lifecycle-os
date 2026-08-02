/* Knickgasm3DConnectorEngine - generated from knickgasm-3d-connector-engine.ts by esbuild. Do not edit by hand. */
var Knickgasm3D = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // knickgasm-3d-connector-engine.ts
  var knickgasm_3d_connector_engine_exports = {};
  __export(knickgasm_3d_connector_engine_exports, {
    DataResolver: () => DataResolver,
    Knickgasm3DConnectorEngine: () => Knickgasm3DConnectorEngine,
    __brand: () => __brand,
    __regions: () => __regions,
    applyBrandCssVars: () => applyBrandCssVars,
    augmentBrandFromTheme: () => augmentBrandFromTheme,
    buildViewportPlan: () => buildViewportPlan,
    createReactBinding: () => createReactBinding,
    decideRenderMode: () => decideRenderMode,
    default: () => knickgasm_3d_connector_engine_default,
    mountViewport: () => mountViewport,
    prefersReducedMotion: () => prefersReducedMotion,
    resolveRoute: () => resolveRoute,
    supportsWebGL: () => supportsWebGL
  });
  var PALETTE = {
    forestGreen: "#6A33D8",
    lava: "#D0473E",
    ink: "#111111",
    chalk: "#F7F5F2"
  };
  var FONTS = {
    heading: "'Montserrat','Raleway',Georgia,serif",
    body: "'Instrument Sans','Helvetica Neue',Arial,sans-serif"
  };
  function hexToVec3(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return [0, 0, 0];
    const n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function baseBrandTokens() {
    return {
      palette: { ...PALETTE },
      uniforms: {
        forestGreen: hexToVec3(PALETTE.forestGreen),
        lava: hexToVec3(PALETTE.lava),
        ink: hexToVec3(PALETTE.ink),
        chalk: hexToVec3(PALETTE.chalk)
      },
      fonts: { ...FONTS },
      surface: { ambientLevel: 0.45, keyLightLevel: 1, bloom: 0.15 }
    };
  }
  var REGIONS = {
    us: {
      key: "us",
      code: "US",
      label: "United States",
      currency: "$",
      storefrontHost: "www.knickgasm.com",
      tryHost: "knickgasm.com",
      catalogPath: "/data/catalog/products_us.json"
    },
    uk: {
      key: "uk",
      code: "UK",
      label: "United Kingdom",
      currency: "\xA3",
      storefrontHost: "knickgasm.com",
      tryHost: "knickgasm.com",
      catalogPath: "/data/catalog/products_uk.json"
    },
    global: {
      key: "global",
      code: "Global",
      label: "Global",
      currency: "$",
      storefrontHost: "knickgasm.com",
      tryHost: "try.knickgasm.com",
      catalogPath: "/data/catalog/products_global.json"
    }
  };
  var META_LANDER_PATTERNS = [
    { re: /^try\.knickgasm\.co\.uk$/i, region: "uk" },
    { re: /^try\.knickgasm\.global$/i, region: "global" },
    { re: /^try\.knickgasm\.com$/i, region: "us" }
  ];
  var STOREFRONT_PATTERNS = [
    { re: /(^|\.)knickgasm\.co\.uk$/i, region: "uk" },
    { re: /(^|\.)uk\.knickgasm(sneakers)?\.com$/i, region: "uk" },
    { re: /(^|\.)knickgasm\.global$/i, region: "global" },
    { re: /(^|\.)knickgasm(sneakers)?\.com$/i, region: "us" }
  ];
  function resolveRoute(hostname, pathname = "", forced) {
    const host = String(hostname || "").toLowerCase().replace(/:\d+$/, "");
    let isMetaLander = false;
    let region = forced != null ? forced : null;
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
    if (!isMetaLander && /(^|\/)try(\/|$)/i.test(pathname)) isMetaLander = true;
    const landerHandle = extractHandle(pathname);
    return { region: REGIONS[region != null ? region : "global"], isMetaLander, landerHandle };
  }
  function extractHandle(pathname) {
    if (!pathname) return null;
    const cleaned = pathname.replace(/[?#].*$/, "");
    const products = /\/products\/([a-z0-9][a-z0-9-]*)/i.exec(cleaned);
    if (products) return products[1].toLowerCase();
    const seg = cleaned.split("/").filter(Boolean);
    if (seg.length === 1 && /^[a-z0-9][a-z0-9-]{2,}$/i.test(seg[0]) && !RESERVED.has(seg[0].toLowerCase())) {
      return seg[0].toLowerCase();
    }
    return null;
  }
  var RESERVED = /* @__PURE__ */ new Set(["index", "home", "cart", "checkout", "collections", "pages", "account", "try", "lp"]);
  function getFetch(cfg) {
    const f = cfg.fetchImpl || (typeof fetch !== "undefined" ? fetch : void 0);
    if (!f) throw new Error("No fetch implementation available (pass EngineConfig.fetchImpl on Node < 18).");
    return f;
  }
  async function fetchJson(cfg, url, init, source) {
    const f = getFetch(cfg);
    const controller = new AbortController();
    const outer = init.signal;
    if (outer) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener("abort", () => controller.abort(), { once: true });
    }
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await f(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        return err({ code: res.status === 404 ? "not_found" : "bad_response", message: `HTTP ${res.status} from ${source}`, source });
      }
      const data = await res.json();
      return ok(data);
    } catch (e) {
      const aborted = e && (e.name === "AbortError" || e.code === 20);
      return err({
        code: aborted ? outer && outer.aborted ? "aborted" : "timeout" : "network",
        message: aborted ? `Request to ${source} timed out or was aborted` : `Network error reaching ${source}: ${(e == null ? void 0 : e.message) || e}`,
        source,
        cause: e
      });
    } finally {
      clearTimeout(timer);
    }
  }
  function ok(value) {
    return { ok: true, value };
  }
  function err(error) {
    return { ok: false, error };
  }
  var TtlCache = class {
    constructor(ttlMs, now) {
      this.ttlMs = ttlMs;
      this.now = now;
      __publicField(this, "map", /* @__PURE__ */ new Map());
    }
    get(key) {
      const hit = this.map.get(key);
      if (!hit) return void 0;
      if (this.now() - hit.at > this.ttlMs) {
        this.map.delete(key);
        return void 0;
      }
      return hit.v;
    }
    set(key, v) {
      this.map.set(key, { at: this.now(), v });
    }
    clear() {
      this.map.clear();
    }
  };
  var wallClock = () => Date.now();
  var STOREFRONT_QUERY = `
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
  var DataResolver = class {
    constructor(cfg, now = wallClock) {
      this.cfg = cfg;
      this.now = now;
      __publicField(this, "catalogCache");
      __publicField(this, "metricCache");
      this.catalogCache = new TtlCache(cfg.cacheTtlMs, now);
      this.metricCache = new TtlCache(cfg.cacheTtlMs, now);
    }
    /**
     * Resolve the region catalog Shopify-first, degrading through the documented
     * fallback chain. Always returns a value on any reachable tier; only returns
     * Err if every tier fails.
     */
    async resolveCatalog(region, opts = {}) {
      var _a;
      const cacheKey = `catalog:${region.key}:${(_a = opts.limit) != null ? _a : "all"}`;
      const cached = this.catalogCache.get(cacheKey);
      if (cached) return ok(cached.map((p) => ({ ...p, source: "engine_cache" })));
      if (this.cfg.storefrontToken && region.myshopifyDomain) {
        const live = await this.fromStorefrontApi(region, opts);
        if (live.ok && live.value.length) {
          this.catalogCache.set(cacheKey, live.value);
          return live;
        }
      }
      const pub = await this.fromProductsJson(region, opts);
      if (pub.ok && pub.value.length) {
        this.catalogCache.set(cacheKey, pub.value);
        return pub;
      }
      const built = await this.fromCatalogJson(region, opts);
      if (built.ok && built.value.length) {
        this.catalogCache.set(cacheKey, built.value);
        return built;
      }
      return err({
        code: "bad_response",
        message: "Catalog could not be resolved from Storefront API, products.json, or built catalog JSON.",
        source: "none"
      });
    }
    async fromStorefrontApi(region, opts) {
      var _a, _b, _c, _d;
      const url = `https://${region.myshopifyDomain}/api/${this.cfg.storefrontApiVersion}/graphql.json`;
      const out = [];
      let cursor = null;
      const pageSize = Math.min((_a = opts.limit) != null ? _a : 250, 250);
      for (let guard = 0; guard < 20; guard++) {
        const res = await fetchJson(
          this.cfg,
          url,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Storefront-Access-Token": this.cfg.storefrontToken
            },
            body: JSON.stringify({ query: STOREFRONT_QUERY, variables: { first: pageSize, cursor } }),
            signal: opts.signal
          },
          "shopify_storefront_api"
        );
        if (!res.ok) return res;
        const conn = (_c = (_b = res.value) == null ? void 0 : _b.data) == null ? void 0 : _c.products;
        if (!conn) return err({ code: "bad_response", message: "Storefront API returned no products connection", source: "shopify_storefront_api" });
        for (const edge of conn.edges || []) {
          out.push(normalizeStorefrontNode(edge.node, region));
          if (opts.limit && out.length >= opts.limit) return ok(out);
        }
        if (!((_d = conn.pageInfo) == null ? void 0 : _d.hasNextPage)) break;
        cursor = conn.pageInfo.endCursor;
      }
      return ok(out);
    }
    async fromProductsJson(region, opts) {
      var _a, _b;
      const limit = Math.min((_a = opts.limit) != null ? _a : 250, 250);
      const url = `https://${region.storefrontHost}/products.json?limit=${limit}`;
      const res = await fetchJson(this.cfg, url, { headers: { Accept: "application/json" }, signal: opts.signal }, "shopify_products_json");
      if (!res.ok) return res;
      const list = Array.isArray((_b = res.value) == null ? void 0 : _b.products) ? res.value.products : [];
      const out = list.map((p) => normalizeProductsJson(p, region));
      return ok(opts.limit ? out.slice(0, opts.limit) : out);
    }
    async fromCatalogJson(region, opts) {
      var _a;
      const url = `${this.cfg.apiBase}${region.catalogPath}`;
      const res = await fetchJson(this.cfg, url, { headers: { Accept: "application/json" }, signal: opts.signal }, "catalog_json");
      if (!res.ok) return res;
      const list = Array.isArray(res.value) ? res.value : ((_a = res.value) == null ? void 0 : _a.products) || [];
      const out = list.map((p) => normalizeCatalogJson(p, region));
      return ok(opts.limit ? out.slice(0, opts.limit) : out);
    }
    /**
     * Historical / deep metrics — Snowflake mirror only (Shopify has none of this).
     * Reads the same endpoint snowflake-sync-core.js exposes. Returns a typed
     * `not_configured` error (never throws) while SNOWFLAKE_* env is unset, so the
     * UI can show a graceful "deep metrics not connected" state.
     */
    async resolveMetrics(region, params = {}) {
      var _a, _b, _c;
      const cacheKey = `metrics:${region.key}:${params.metric || "*"}:${params.window || "*"}`;
      const cached = this.metricCache.get(cacheKey);
      if (cached) return ok(cached);
      const q = new URLSearchParams({ action: "snowflake-metrics", region: region.key });
      if (params.metric) q.set("metric", params.metric);
      if (params.window) q.set("window", params.window);
      const url = `${this.cfg.apiBase}/api/brain?${q.toString()}`;
      const res = await fetchJson(this.cfg, url, { headers: { Accept: "application/json" }, signal: params.signal }, "snowflake_mirror");
      if (!res.ok) return res;
      if (((_a = res.value) == null ? void 0 : _a.connected) === false) {
        return err({
          code: "not_configured",
          message: ((_b = res.value) == null ? void 0 : _b.reason) || "Snowflake mirror is not connected yet (SNOWFLAKE_* env not set).",
          source: "snowflake_mirror"
        });
      }
      const rows = Array.isArray((_c = res.value) == null ? void 0 : _c.rows) ? res.value.rows : [];
      const norm = rows.map((r) => {
        var _a2, _b2, _c2, _d, _e, _f, _g, _h, _i, _j;
        return {
          metric: String((_b2 = (_a2 = r.metric) != null ? _a2 : r.METRIC) != null ? _b2 : ""),
          region: String((_d = (_c2 = r.region) != null ? _c2 : r.REGION) != null ? _d : region.key),
          value: Number((_f = (_e = r.value) != null ? _e : r.VALUE) != null ? _f : 0),
          window: String((_h = (_g = r.window) != null ? _g : r.WINDOW) != null ? _h : ""),
          capturedAt: String((_j = (_i = r.captured_at) != null ? _i : r.CAPTURED_AT) != null ? _j : ""),
          source: "snowflake_mirror"
        };
      });
      this.metricCache.set(cacheKey, norm);
      return ok(norm);
    }
    clearCache() {
      this.catalogCache.clear();
      this.metricCache.clear();
    }
  };
  function pdpUrl(region, handle) {
    return `https://${region.storefrontHost}/products/${handle}`;
  }
  function normalizeStorefrontNode(node, region) {
    var _a, _b, _c, _d, _e, _f, _g;
    const amount = (_b = (_a = node == null ? void 0 : node.priceRange) == null ? void 0 : _a.minVariantPrice) == null ? void 0 : _b.amount;
    const compare = (_d = (_c = node == null ? void 0 : node.compareAtPriceRange) == null ? void 0 : _c.minVariantPrice) == null ? void 0 : _d.amount;
    const images = (((_e = node == null ? void 0 : node.images) == null ? void 0 : _e.edges) || []).map((e) => {
      var _a2;
      return (_a2 = e == null ? void 0 : e.node) == null ? void 0 : _a2.url;
    }).filter(Boolean);
    return {
      handle: String((node == null ? void 0 : node.handle) || ""),
      title: String((node == null ? void 0 : node.title) || ""),
      image: ((_f = node == null ? void 0 : node.featuredImage) == null ? void 0 : _f.url) || images[0] || null,
      images,
      price: amount != null ? `${region.currency}${fmtMoney(amount)}` : null,
      compareAt: compare != null && compare !== amount ? `${region.currency}${fmtMoney(compare)}` : null,
      available: (_g = node == null ? void 0 : node.availableForSale) != null ? _g : null,
      category: (node == null ? void 0 : node.productType) || null,
      url: pdpUrl(region, String((node == null ? void 0 : node.handle) || "")),
      source: "shopify_storefront_api"
    };
  }
  function normalizeProductsJson(p, region) {
    var _a;
    const variant = Array.isArray(p == null ? void 0 : p.variants) ? p.variants[0] : null;
    const images = Array.isArray(p == null ? void 0 : p.images) ? p.images.map((im) => im == null ? void 0 : im.src).filter(Boolean) : [];
    const priceNum = variant == null ? void 0 : variant.price;
    const compareNum = variant == null ? void 0 : variant.compare_at_price;
    return {
      handle: String((p == null ? void 0 : p.handle) || ""),
      title: String((p == null ? void 0 : p.title) || ""),
      image: images[0] || null,
      images,
      price: priceNum != null ? `${region.currency}${fmtMoney(priceNum)}` : null,
      compareAt: compareNum != null && compareNum !== priceNum ? `${region.currency}${fmtMoney(compareNum)}` : null,
      available: variant ? (_a = variant.available) != null ? _a : null : null,
      category: (p == null ? void 0 : p.product_type) || null,
      url: pdpUrl(region, String((p == null ? void 0 : p.handle) || "")),
      source: "shopify_products_json"
    };
  }
  function normalizeCatalogJson(p, region) {
    const images = Array.isArray(p == null ? void 0 : p.imgs) ? p.imgs.filter(Boolean) : [];
    const handle = String((p == null ? void 0 : p.h) || "");
    return {
      handle,
      title: String((p == null ? void 0 : p.n) || ""),
      image: (p == null ? void 0 : p.i) || images[0] || null,
      images,
      price: (p == null ? void 0 : p.price) ? withCurrency(String(p.price), region) : null,
      compareAt: (p == null ? void 0 : p.compare_at) ? withCurrency(String(p.compare_at), region) : null,
      available: null,
      // built catalog is not live inventory
      category: (p == null ? void 0 : p.category) || (p == null ? void 0 : p.type) || null,
      url: pdpUrl(region, handle),
      source: "catalog_json"
    };
  }
  function fmtMoney(v) {
    const n = typeof v === "number" ? v : parseFloat(v);
    if (!isFinite(n)) return String(v);
    return n.toFixed(2).replace(/\.00$/, "");
  }
  function withCurrency(raw, region) {
    return /^[£$€]/.test(raw) ? raw : `${region.currency}${raw.replace(/^[^\d]*/, "")}`;
  }
  async function augmentBrandFromTheme(cfg, region, opts = {}) {
    var _a;
    const base = baseBrandTokens();
    if (!hostAllowed(region.storefrontHost, cfg.themeAllowlist)) return base;
    const url = `https://${region.storefrontHost}/?sections=header`;
    const res = await fetchJson(cfg, url, { headers: { Accept: "application/json" }, signal: opts.signal }, "shopify_storefront_api");
    if (!res.ok) return base;
    const s = ((_a = res.value) == null ? void 0 : _a.settings) || {};
    return {
      ...base,
      surface: {
        ambientLevel: clamp(numOr(s.ambient_level, base.surface.ambientLevel), 0, 1),
        keyLightLevel: clamp(numOr(s.key_light_level, base.surface.keyLightLevel), 0, 2),
        bloom: clamp(numOr(s.bloom, base.surface.bloom), 0, 1)
      }
    };
  }
  function hostAllowed(host, allowlist) {
    const h = host.toLowerCase().replace(/^www\./, "");
    return allowlist.some((a) => {
      const e = a.toLowerCase().replace(/^www\./, "");
      return h === e || h.endsWith("." + e);
    });
  }
  function numOr(v, d) {
    const n = Number(v);
    return isFinite(n) ? n : d;
  }
  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }
  function applyBrandCssVars(brand, target) {
    const el = target || (typeof document !== "undefined" ? document.documentElement : null);
    if (!el || !el.style) return;
    el.style.setProperty("--v-deep-purple", brand.palette.forestGreen);
    el.style.setProperty("--v-lava", brand.palette.lava);
    el.style.setProperty("--v-ink", brand.palette.ink);
    el.style.setProperty("--v-chalk", brand.palette.chalk);
    el.style.setProperty("--v-font-heading", brand.fonts.heading);
    el.style.setProperty("--v-font-body", brand.fonts.body);
  }
  function buildViewportPlan(route, reducedMotion) {
    if (route.isMetaLander) {
      return {
        mode: "meta_checkout",
        showGlobalNav: false,
        isolatedHandle: route.landerHandle,
        layers: ["hero", "product", "proof", "checkout"],
        reducedMotion
      };
    }
    return {
      mode: "store_explore",
      showGlobalNav: true,
      isolatedHandle: null,
      layers: ["nav", "hero", "product", "proof", "ambient"],
      reducedMotion
    };
  }
  function supportsWebGL() {
    if (typeof document === "undefined") return false;
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"));
    } catch {
      return false;
    }
  }
  function prefersReducedMotion() {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }
  function decideRenderMode(cfg, reducedMotion) {
    if (!cfg.enable3D) return "2d_fallback";
    if (reducedMotion) return "2d_fallback";
    if (!supportsWebGL()) return "2d_fallback";
    return "3d";
  }
  async function mountViewport(cfg, o) {
    var _a, _b;
    const reduced = prefersReducedMotion();
    const mode = decideRenderMode(cfg, reduced);
    if (mode === "2d_fallback" || !o.loadRenderer) {
      return { mode: "2d_fallback", dispose: () => {
      } };
    }
    try {
      const renderer = await o.loadRenderer();
      const handle = (_a = renderer == null ? void 0 : renderer.createKnickgasmScene) == null ? void 0 : _a.call(renderer, { canvas: o.canvas, brand: o.brand, plan: o.plan });
      return { mode: "3d", dispose: () => {
        var _a2;
        return (_a2 = handle == null ? void 0 : handle.dispose) == null ? void 0 : _a2.call(handle);
      } };
    } catch (e) {
      const ee = { code: "unsupported", message: `3D renderer failed to load; using 2D fallback: ${(e == null ? void 0 : e.message) || e}`, source: "none", cause: e };
      (_b = o.onError) == null ? void 0 : _b.call(o, ee);
      return { mode: "2d_fallback", dispose: () => {
      } };
    }
  }
  var DEFAULT_CONFIG = {
    apiBase: "",
    storefrontApiVersion: "2024-10",
    timeoutMs: 12e3,
    cacheTtlMs: 5 * 60 * 1e3,
    enable3D: true,
    themeAllowlist: ["knickgasm.com", "knickgasm.com", "knickgasm.com", "knickgasm.com", "knickgasm.com"]
  };
  var Knickgasm3DConnectorEngine = class {
    constructor(partial = {}, now = wallClock) {
      __publicField(this, "config");
      __publicField(this, "data");
      __publicField(this, "state");
      __publicField(this, "listeners", /* @__PURE__ */ new Set());
      __publicField(this, "inflight", null);
      __publicField(this, "_catalog", []);
      this.config = { ...DEFAULT_CONFIG, ...partial };
      this.data = new DataResolver(this.config, now);
      const { host, path } = currentLocation();
      const route = resolveRoute(host, path, this.config.forcedRegion);
      const reduced = prefersReducedMotion();
      this.state = {
        status: "idle",
        region: route.region,
        isMetaLander: route.isMetaLander,
        viewport: buildViewportPlan(route, reduced),
        brand: baseBrandTokens(),
        renderMode: decideRenderMode(this.config, reduced),
        lastError: null
      };
    }
    getState() {
      return this.state;
    }
    /** Convenience flag mirroring the brief's required boolean. */
    get isMetaLander() {
      return this.state.isMetaLander;
    }
    subscribe(fn) {
      this.listeners.add(fn);
      fn(this.state);
      return () => this.listeners.delete(fn);
    }
    set(patch) {
      this.state = { ...this.state, ...patch };
      for (const l of this.listeners) {
        try {
          l(this.state);
        } catch {
        }
      }
    }
    /**
     * Boot: resolve brand tokens + region catalog concurrently, set loading /
     * ready / degraded / error states, and apply CSS vars in the browser.
     * Safe to call more than once; a new call aborts the previous in-flight boot.
     */
    async init(opts = {}) {
      var _a;
      (_a = this.inflight) == null ? void 0 : _a.abort();
      const controller = new AbortController();
      this.inflight = controller;
      this.set({ status: "loading", lastError: null });
      const region = this.state.region;
      const brandP = opts.augmentTheme ? augmentBrandFromTheme(this.config, region, { signal: controller.signal }).catch(() => baseBrandTokens()) : Promise.resolve(baseBrandTokens());
      const catalogP = this.data.resolveCatalog(region, { signal: controller.signal, limit: opts.catalogLimit });
      const [brand, catalog] = await Promise.all([brandP, catalogP]);
      if (controller.signal.aborted) {
        return err({ code: "aborted", message: "init superseded by a newer init() call" });
      }
      applyBrandCssVars(brand);
      if (!catalog.ok) {
        this.set({ status: "error", brand, lastError: catalog.error });
        return err(catalog.error);
      }
      this.set({ status: catalog.value.length ? "ready" : "degraded", brand });
      this._catalog = catalog.value;
      return ok(this.state);
    }
    /** The catalog resolved during init (Shopify-first). */
    getCatalog() {
      return this._catalog;
    }
    /** The single product a Meta lander isolates, resolved from the catalog. */
    getIsolatedProduct() {
      const h = this.state.viewport.isolatedHandle;
      if (!h) return null;
      return this._catalog.find((p) => p.handle === h) || null;
    }
    /** Re-resolve route from a new URL (SPA navigation). */
    updateRoute(hostname, pathname) {
      const route = resolveRoute(hostname, pathname, this.config.forcedRegion);
      const reduced = this.state.viewport.reducedMotion;
      this.set({
        region: route.region,
        isMetaLander: route.isMetaLander,
        viewport: buildViewportPlan(route, reduced)
      });
    }
    dispose() {
      var _a;
      (_a = this.inflight) == null ? void 0 : _a.abort();
      this.listeners.clear();
      this.data.clearCache();
    }
  };
  function currentLocation() {
    if (typeof window !== "undefined" && window.location) {
      return { host: window.location.hostname, path: window.location.pathname };
    }
    return { host: "", path: "" };
  }
  function createReactBinding(React) {
    const Ctx = React.createContext(null);
    function Provider(props) {
      const engineRef = React.useRef(null);
      if (!engineRef.current) engineRef.current = new Knickgasm3DConnectorEngine(props.config || {});
      const engine = engineRef.current;
      const [state, setState] = React.useState(engine.getState());
      React.useEffect(() => {
        const off = engine.subscribe(setState);
        engine.init().catch(() => {
        });
        return () => {
          off();
          engine.dispose();
        };
      }, [engine]);
      return React.createElement(Ctx.Provider, { value: { engine, state } }, props.children);
    }
    function useEngine() {
      const v = React.useContext(Ctx);
      if (!v) throw new Error("useEngine must be used within <Provider>");
      return v;
    }
    return { Provider, useEngine };
  }
  var __brand = { PALETTE, FONTS };
  var __regions = REGIONS;
  var knickgasm_3d_connector_engine_default = Knickgasm3DConnectorEngine;
  return __toCommonJS(knickgasm_3d_connector_engine_exports);
})();
