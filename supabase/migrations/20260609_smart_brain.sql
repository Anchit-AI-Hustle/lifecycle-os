-- KNICKGASM Smart Brain schema assumptions for the linked database.
-- These tables are intentionally namespaced with smart_* so the MVP can link
-- to a provided analytical database without touching production platform data.

create table if not exists public.smart_products (
  id text primary key,
  sku text,
  title text not null,
  handle text,
  category text,
  market text,
  price numeric,
  tags jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.smart_assets (
  id text primary key,
  asset_type text not null,
  format text,
  url text,
  title text,
  hook text,
  alt text,
  tags jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.smart_campaigns (
  id text primary key,
  name text not null,
  channel text not null,
  market text,
  campaign_type text,
  subject text,
  headline text,
  hook text,
  sent_at timestamptz,
  cohort_key text,
  hero_sku text,
  metadata jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.smart_campaign_assets (
  campaign_id text not null,
  asset_id text not null,
  role text,
  metadata jsonb default '{}'::jsonb,
  primary key (campaign_id, asset_id)
);

create table if not exists public.smart_campaign_metrics (
  id bigserial primary key,
  campaign_id text not null,
  creative_id text,
  channel text not null,
  market text,
  sends numeric default 0,
  impressions numeric default 0,
  opens numeric default 0,
  clicks numeric default 0,
  conversions numeric default 0,
  revenue numeric default 0,
  spend numeric default 0,
  observed_at timestamptz default now(),
  cohort_key text,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.smart_users (
  id text primary key,
  email text,
  market text,
  total_spend numeric default 0,
  orders_count integer default 0,
  last_order_at timestamptz,
  accepts_marketing boolean default true,
  tags jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.smart_orders (
  id text primary key,
  user_id text,
  market text,
  total numeric default 0,
  created_at timestamptz,
  product_sku text,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.smart_events (
  id bigserial primary key,
  user_id text,
  event_type text not null,
  campaign_id text,
  creative_id text,
  occurred_at timestamptz default now(),
  properties jsonb default '{}'::jsonb
);

-- Competitive stream is explicitly separate from own-data campaign tables.
create table if not exists public.smart_competitor_campaigns (
  id text primary key,
  brand text not null,
  channel text not null,
  campaign_type text,
  asset_type text,
  format text,
  subject text,
  headline text,
  hook text,
  asset_url text,
  landing_url text,
  observed_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.smart_mvt_results (
  id bigserial primary key,
  campaign_id text,
  variable text,
  winner text,
  lift numeric,
  confidence numeric,
  observed_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.smart_feedback (
  id bigserial primary key,
  target_type text not null,
  target_id text,
  verdict text not null,
  notes text,
  reviewer text,
  created_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.smart_generated_campaigns (
  id text primary key,
  payload jsonb not null,
  status text not null default 'needs_human_verification',
  human_verified_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.smart_brain_runs (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now()
);

create index if not exists smart_campaign_metrics_campaign_idx on public.smart_campaign_metrics (campaign_id, observed_at desc);
create index if not exists smart_competitor_campaigns_channel_idx on public.smart_competitor_campaigns (channel, observed_at desc);
create index if not exists smart_feedback_target_idx on public.smart_feedback (target_type, target_id, created_at desc);
