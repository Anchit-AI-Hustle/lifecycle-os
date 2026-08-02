-- Pure-GET 12h polling ingestion layer. Three ISOLATED tables, one per platform,
-- each with a UNIQUE constraint on the platform's own primary id so a twice-daily
-- poll is idempotent (upsert / ON CONFLICT DO NOTHING). raw_payload keeps the full
-- source object; the hot query columns are extracted + indexed. Populated by
-- ingest/poll_12h_ingest.py (or api/_shared/poll-ingest.js) using the service role.

-- 1. Shopify orders (Admin API GET /orders.json?created_at_min=...)
create table if not exists public.shopify_orders (
  id                  uuid default gen_random_uuid() primary key,
  shopify_order_id    text unique not null,
  email               text,
  total_price         numeric,
  currency            text,
  created_at_shopify  timestamptz,
  raw_payload         jsonb default '{}'::jsonb,
  inserted_at         timestamptz default timezone('utc'::text, now()) not null
);
create index if not exists idx_shopify_created  on public.shopify_orders (created_at_shopify);
create index if not exists idx_shopify_email     on public.shopify_orders (email);
create index if not exists idx_shopify_payload   on public.shopify_orders using gin (raw_payload);

-- 2. Klaviyo events (Events API GET /api/events?filter=greater-than(datetime,...))
create table if not exists public.klaviyo_events (
  id                uuid default gen_random_uuid() primary key,
  klaviyo_event_id  text unique not null,
  metric_name       text,
  profile_id        text,
  timestamp         timestamptz,
  raw_payload       jsonb default '{}'::jsonb,
  inserted_at       timestamptz default timezone('utc'::text, now()) not null
);
create index if not exists idx_klaviyo_metric    on public.klaviyo_events (metric_name);
create index if not exists idx_klaviyo_time       on public.klaviyo_events (timestamp);
create index if not exists idx_klaviyo_profile    on public.klaviyo_events (profile_id);
create index if not exists idx_klaviyo_payload    on public.klaviyo_events using gin (raw_payload);

-- 3. WebEngage events (bulk/data-export GET, filtered to the last 12h)
create table if not exists public.webengage_events (
  id                  uuid default gen_random_uuid() primary key,
  webengage_event_id  text unique not null,
  event_name          text,
  user_id             text,
  event_time          timestamptz,
  raw_payload         jsonb default '{}'::jsonb,
  inserted_at         timestamptz default timezone('utc'::text, now()) not null
);
create index if not exists idx_we_event_name  on public.webengage_events (event_name);
create index if not exists idx_we_event_time  on public.webengage_events (event_time);
create index if not exists idx_we_user        on public.webengage_events (user_id);
create index if not exists idx_we_payload     on public.webengage_events using gin (raw_payload);

-- Service-role writes only; app reads. RLS on with permissive read (service role
-- bypasses RLS for the bulk upsert anyway).
do $$ begin
  alter table public.shopify_orders  enable row level security;
  alter table public.klaviyo_events  enable row level security;
  alter table public.webengage_events enable row level security;
exception when others then null; end $$;
do $$ begin create policy "shopify_orders_read"  on public.shopify_orders  for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "klaviyo_events_read"  on public.klaviyo_events  for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "webengage_events_read" on public.webengage_events for select using (true); exception when duplicate_object then null; end $$;
