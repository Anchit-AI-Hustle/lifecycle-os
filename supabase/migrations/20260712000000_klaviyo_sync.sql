-- ============================================================================
-- 20260712000000_klaviyo_sync.sql
-- Klaviyo read-only mirror tables (connector SINK).
--
-- Populated by the Klaviyo sync adapter (api/_shared/klaviyo-sync.js) via
-- read-only GET pulls only. The app reads cohort sizes, tracked metrics and
-- campaign performance from HERE (Supabase is the single store) instead of
-- calling Klaviyo at request time. Additive + idempotent (create if not exists);
-- writes go through the service-role key (bypasses RLS), reads via "read all".
-- ============================================================================

create table if not exists public.klaviyo_segments (
  id              text primary key,          -- Klaviyo segment id
  name            text,
  profile_count   integer,                   -- live segment size (the real cohort size)
  klaviyo_created timestamptz,
  klaviyo_updated timestamptz,
  raw             jsonb not null default '{}'::jsonb,
  synced_at       timestamptz not null default now()
);
create index if not exists klaviyo_segments_name_idx on public.klaviyo_segments (name);

create table if not exists public.klaviyo_metrics (
  id          text primary key,
  name        text,
  integration text,
  raw         jsonb not null default '{}'::jsonb,
  synced_at   timestamptz not null default now()
);

create table if not exists public.klaviyo_campaigns (
  id          text primary key,
  name        text,
  status      text,
  channel     text,
  send_time   timestamptz,
  raw         jsonb not null default '{}'::jsonb,
  synced_at   timestamptz not null default now()
);
create index if not exists klaviyo_campaigns_channel_idx on public.klaviyo_campaigns (channel);

alter table public.klaviyo_segments  enable row level security;
alter table public.klaviyo_metrics   enable row level security;
alter table public.klaviyo_campaigns enable row level security;

do $$ begin create policy "read all" on public.klaviyo_segments  for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin create policy "read all" on public.klaviyo_metrics   for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin create policy "read all" on public.klaviyo_campaigns for select using (true);
exception when duplicate_object then null; end $$;
