-- Snowflake → Supabase daily mirror for the Knickgasm3DConnectorEngine.
-- The engine reads historical / deep metrics from this table (Shopify stays the
-- live source for catalog + pricing). Populated by api/_shared/snowflake-sync-core.js
-- on the daily cron and via POST /api/snowflake-sync. Idempotent on `key`.

create table if not exists public.snowflake_metrics_mirror (
  key          text primary key,
  metric       text not null,
  region       text not null default 'global',
  value        double precision not null default 0,
  window       text not null default '30d',
  captured_at  timestamptz not null default now(),
  synced_at    timestamptz not null default now()
);

create index if not exists idx_sf_mirror_region_metric
  on public.snowflake_metrics_mirror (region, metric, window, captured_at desc);

comment on table public.snowflake_metrics_mirror is
  'Daily Snowflake pull mirrored for the Knickgasm3DConnectorEngine historical/metric data tier.';
