-- =============================================================================
-- Unified Data Analysis control plane
-- Business-review consolidation, hourly analysis, anomaly delivery, action
-- outcome measurement, and PageDeck landing-page intelligence mirrors.
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.analytics_alert_settings (
  id                 text primary key default 'default',
  enabled            boolean not null default true,
  cadence_hours      integer not null default 1 check (cadence_hours between 1 and 24),
  sender_email       text not null default 'anchit.tandon@knickgasm.com',
  channels           jsonb not null default '{"gmail":true,"google_chat":false,"sms":false}'::jsonb,
  recipients         jsonb not null default '{"email":["anchit.tandon@knickgasm.com"],"sms":[]}'::jsonb,
  thresholds         jsonb not null default '{}'::jsonb,
  cooldown_minutes   integer not null default 180 check (cooldown_minutes between 15 and 1440),
  quiet_hours        jsonb not null default '{"enabled":true,"timezone":"Asia/Kolkata","start_hour":22,"end_hour":7,"critical_bypass":true}'::jsonb,
  updated_by         text,
  updated_at         timestamptz not null default now(),
  constraint analytics_alert_sender_locked check (lower(sender_email) = 'anchit.tandon@knickgasm.com')
);

insert into public.analytics_alert_settings (
  id, enabled, cadence_hours, sender_email, channels, recipients, thresholds,
  cooldown_minutes, quiet_hours
) values (
  'default', true, 1, 'anchit.tandon@knickgasm.com',
  '{"gmail":true,"google_chat":false,"sms":false}'::jsonb,
  '{"email":["anchit.tandon@knickgasm.com"],"sms":[]}'::jsonb,
  '{"ad_roas_min":1.5,"ad_ctr_drop_pct":0.25,"ad_spend_spike_pct":0.5,"ad_spend_no_conversion":200,"mailer_open_rate_min":0.2,"mailer_click_rate_min":0.015,"mailer_unsubscribe_rate_max":0.005,"landing_conversion_rate_min":0.02,"action_error_rate_max":0.1,"connector_stale_hours":3}'::jsonb,
  180,
  '{"enabled":true,"timezone":"Asia/Kolkata","start_hour":22,"end_hour":7,"critical_bypass":true}'::jsonb
) on conflict (id) do nothing;

create table if not exists public.analytics_hourly_runs (
  id                 bigserial primary key,
  started_at         timestamptz not null,
  finished_at        timestamptz,
  trigger            text not null default 'schedule',
  status             text not null default 'success',
  cadence_hours      integer not null default 1,
  markets            text[] not null default '{}'::text[],
  payload            jsonb not null default '{}'::jsonb,
  anomalies          jsonb not null default '[]'::jsonb,
  alert_result       jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create index if not exists analytics_hourly_runs_started_idx on public.analytics_hourly_runs (started_at desc);
create index if not exists analytics_hourly_runs_status_idx on public.analytics_hourly_runs (status, started_at desc);

create table if not exists public.analytics_anomaly_state (
  fingerprint        text primary key,
  status             text not null default 'open',
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  last_sent_at       timestamptz,
  occurrence_count   integer not null default 1,
  severity           text,
  detail             jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);
create index if not exists analytics_anomaly_state_open_idx on public.analytics_anomaly_state (status, last_seen_at desc);

create table if not exists public.analytics_action_outcomes (
  id                    uuid primary key default gen_random_uuid(),
  action_type           text not null,
  action_id             text,
  channel               text,
  market                text,
  owner                 text,
  status                text not null default 'recommended',
  recommended_at        timestamptz,
  approved_at           timestamptz,
  launched_at           timestamptz,
  measured_at           timestamptz,
  baseline_metric       text,
  baseline_value        numeric,
  observed_metric       text,
  observed_value        numeric,
  incremental_revenue   numeric,
  cost                  numeric,
  roi                    numeric,
  experiment_id         text,
  guardrail_breach      boolean not null default false,
  rolled_back           boolean not null default false,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists analytics_action_outcomes_action_uidx
  on public.analytics_action_outcomes (action_id) where action_id is not null;
create index if not exists analytics_action_outcomes_status_idx on public.analytics_action_outcomes (status, created_at desc);
create index if not exists analytics_action_outcomes_experiment_idx on public.analytics_action_outcomes (experiment_id) where experiment_id is not null;

-- PageDeck / authorised export mirrors. These tables are deliberately generic:
-- the adapter also retains the full source payload in raw so newly exported
-- fields are available without a destructive schema change.
create table if not exists public.pagedeck_pages (
  id                    text primary key,
  name                  text,
  url                   text,
  market                text,
  status                text,
  visitors              bigint,
  page_views            bigint,
  avg_view_duration     numeric,
  external_clicks       bigint,
  ctr                    numeric,
  conversions           bigint,
  conversion_rate       numeric,
  revenue               numeric,
  aov                    numeric,
  bounce_rate           numeric,
  scroll_depth          numeric,
  load_ms               numeric,
  source                text,
  raw                   jsonb not null default '{}'::jsonb,
  updated_at            timestamptz not null default now()
);
create index if not exists pagedeck_pages_market_idx on public.pagedeck_pages (market, updated_at desc);

create table if not exists public.pagedeck_experiments (
  id                    text primary key,
  name                  text,
  status                text,
  started_at            timestamptz,
  ended_at              timestamptz,
  variants              jsonb not null default '[]'::jsonb,
  winner                text,
  lift                  numeric,
  confidence            numeric,
  significant           boolean,
  sample_ratio_mismatch boolean,
  revenue_impact        numeric,
  raw                   jsonb not null default '{}'::jsonb,
  updated_at            timestamptz not null default now()
);
create index if not exists pagedeck_experiments_status_idx on public.pagedeck_experiments (status, updated_at desc);

create table if not exists public.pagedeck_competitor_pages (
  id                    text primary key,
  brand                 text,
  page                  text,
  url                   text,
  page_type             text,
  offer                 text,
  first_seen            timestamptz,
  last_seen             timestamptz,
  active_days           integer,
  linked_ads            integer,
  estimated_spend       numeric,
  conversion_rate       numeric,
  source                text,
  raw                   jsonb not null default '{}'::jsonb,
  updated_at            timestamptz not null default now()
);
create index if not exists pagedeck_competitor_brand_idx on public.pagedeck_competitor_pages (brand, last_seen desc);

alter table public.analytics_alert_settings enable row level security;
alter table public.analytics_hourly_runs enable row level security;
alter table public.analytics_anomaly_state enable row level security;
alter table public.analytics_action_outcomes enable row level security;
alter table public.pagedeck_pages enable row level security;
alter table public.pagedeck_experiments enable row level security;
alter table public.pagedeck_competitor_pages enable row level security;

-- Authenticated operators can read the control-plane output. Mutations are made
-- through the server-side API with the service-role key, which bypasses RLS.
do $$ begin create policy "authenticated read alert settings" on public.analytics_alert_settings for select to authenticated using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "authenticated read hourly runs" on public.analytics_hourly_runs for select to authenticated using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "authenticated read anomaly state" on public.analytics_anomaly_state for select to authenticated using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "authenticated read action outcomes" on public.analytics_action_outcomes for select to authenticated using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "authenticated read pagedeck pages" on public.pagedeck_pages for select to authenticated using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "authenticated read pagedeck experiments" on public.pagedeck_experiments for select to authenticated using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "authenticated read pagedeck competitors" on public.pagedeck_competitor_pages for select to authenticated using (true); exception when duplicate_object then null; end $$;
