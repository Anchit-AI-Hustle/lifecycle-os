-- ═══════════════════════════════════════════════════════════════════════════
-- KNICKGASM Knowledge Base — single source of truth in Supabase
-- Tables: brand_kit (singleton), market_config, products, collections
-- The HTML loads these at boot into window.KB and stops using hard-coded JS.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Brand kit (singleton — only one row, id = 1) ----------------------------
CREATE TABLE IF NOT EXISTS public.lifecycle_brand_kit (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  palette         JSONB NOT NULL,         -- {primary,accent,bg,text}
  typography      JSONB NOT NULL,         -- {primary:{family,stack,usage,weights}, secondary:{…}}
  voice           JSONB NOT NULL,         -- {tone,dos[],donts[]}
  footer_blocks   JSONB NOT NULL,         -- {legal,contact,social[]}
  guide_pdf_url   TEXT,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 2. Market config -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lifecycle_market_config (
  market           TEXT PRIMARY KEY,         -- 'US','UK','IN','Global','ME','AU','EU'
  display_name     TEXT NOT NULL,
  flag             TEXT,
  base_url         TEXT NOT NULL,
  currency         TEXT NOT NULL,
  currency_symbol  TEXT NOT NULL,
  shipping_note    TEXT,
  language         TEXT DEFAULT 'en',
  collections      JSONB,                    -- {category: handle}
  featured_heroes  JSONB,                    -- string[] hero product names
  is_active        BOOLEAN DEFAULT true,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- 3. Products (real catalog scraped from live Knickgasm storefronts) -----------
CREATE TABLE IF NOT EXISTS public.lifecycle_products (
  id              BIGSERIAL PRIMARY KEY,
  shopify_id      BIGINT,
  market          TEXT NOT NULL REFERENCES public.lifecycle_market_config(market) ON DELETE CASCADE,
  handle          TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT,
  vendor          TEXT,
  product_type    TEXT,
  subtitle        TEXT,
  description     TEXT,
  ingredients     JSONB,
  image_url       TEXT NOT NULL,
  image_alt       TEXT,
  price           NUMERIC,
  compare_at      NUMERIC,
  currency        TEXT,
  sku             TEXT,
  tags            JSONB,
  pdp_url         TEXT NOT NULL,
  is_featured     BOOLEAN DEFAULT false,
  is_bestseller   BOOLEAN DEFAULT false,
  is_active       BOOLEAN DEFAULT true,
  refreshed_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (market, handle)
);
CREATE INDEX IF NOT EXISTS vp_market_category   ON public.lifecycle_products(market, category);
CREATE INDEX IF NOT EXISTS vp_market_active     ON public.lifecycle_products(market) WHERE is_active;
CREATE INDEX IF NOT EXISTS vp_market_featured   ON public.lifecycle_products(market, is_featured) WHERE is_featured;
CREATE INDEX IF NOT EXISTS vp_market_bestseller ON public.lifecycle_products(market, is_bestseller) WHERE is_bestseller;

-- 4. Collections -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lifecycle_collections (
  id              BIGSERIAL PRIMARY KEY,
  market          TEXT NOT NULL REFERENCES public.lifecycle_market_config(market) ON DELETE CASCADE,
  handle          TEXT NOT NULL,
  title           TEXT,
  description     TEXT,
  url             TEXT NOT NULL,
  product_handles JSONB,
  refreshed_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (market, handle)
);

-- 5. RLS — anon SELECT only on KB tables -------------------------------------
ALTER TABLE public.lifecycle_brand_kit       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifecycle_market_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifecycle_products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifecycle_collections     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read brand_kit"      ON public.lifecycle_brand_kit;
DROP POLICY IF EXISTS "anon read market_config"  ON public.lifecycle_market_config;
DROP POLICY IF EXISTS "anon read products"       ON public.lifecycle_products;
DROP POLICY IF EXISTS "anon read collections"    ON public.lifecycle_collections;

CREATE POLICY "anon read brand_kit"     ON public.lifecycle_brand_kit     FOR SELECT USING (true);
CREATE POLICY "anon read market_config" ON public.lifecycle_market_config FOR SELECT USING (true);
CREATE POLICY "anon read products"      ON public.lifecycle_products      FOR SELECT USING (true);
CREATE POLICY "anon read collections"   ON public.lifecycle_collections   FOR SELECT USING (true);
-- INSERT/UPDATE intentionally disabled for anon — only service_role can mutate
