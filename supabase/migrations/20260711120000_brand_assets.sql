-- ============================================================================
-- 20260711120000_brand_assets.sql
-- KNICKGASM Lifecycle OS — approved-assets service (brand_assets).
--
-- The single source of truth for REAL, origin-validated creative assets that
-- mailers / ads / landing pages are allowed to embed. Every asset URL is either
-- (a) verified — pulled from a PDP on the KNICKGASM allowlist and served from a
-- brand-owned CDN host, or (b) a labelled placeholder — NEVER a fabricated URL.
--
-- Conventions from prior migrations:
--   * public schema, RLS enabled, `read all` select policy (true)
--   * writes happen via the service-role key from serverless / seed scripts
--   * created_at, jsonb-free minimal columns, indexes on hot columns
-- Additive + idempotent (create if not exists / on conflict).
-- ============================================================================

create table if not exists public.brand_assets (
  id               uuid primary key default gen_random_uuid(),
  sku_key          text not null,                       -- e.g. 'spiderman_af1'
  asset_type       text not null,                       -- product | lifestyle | logo | gif | video
  url              text not null,                       -- REAL working URL (brand CDN / Storage / GDrive / GitHub)
  alt              text,
  width            int,
  height           int,
  source_pdp       text,                                -- PDP the asset was pulled from
  origin_validated boolean not null default false,
  status           text not null default 'verified',    -- verified | placeholder
  region           text not null default 'us',          -- us | uk | global
  created_at       timestamptz not null default now(),
  unique (sku_key, asset_type, url)
);

alter table public.brand_assets enable row level security;

do $$ begin
  create policy "read all" on public.brand_assets for select using (true);
exception when duplicate_object then null; end $$;

create index if not exists brand_assets_sku_idx    on public.brand_assets (sku_key);
create index if not exists brand_assets_type_idx   on public.brand_assets (asset_type);
create index if not exists brand_assets_status_idx on public.brand_assets (status);
create index if not exists brand_assets_region_idx on public.brand_assets (region);

comment on table  public.brand_assets is
  'Approved-assets service: origin-validated brand creative. status=verified only for URLs on the KNICKGASM allowlist; everything unverifiable is status=placeholder (never a fabricated URL).';
comment on column public.brand_assets.origin_validated is
  'true only when the host prefix-matches the KNICKGASM allowlist (knickgasm.com, knickgasm.com, knickgasm.com, knickgasm.com, knickgasm.com).';
