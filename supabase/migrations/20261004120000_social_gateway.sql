-- ============================================================================
-- 20261004120000_social_gateway.sql
--
-- The Social Integration Gateway: view + update for Meta, TikTok, Pinterest and
-- YouTube on top of the dispatch tables from 20260818140000. Every WRITE still
-- goes through dispatch_jobs (and so through the three switches); this file
-- adds what the gateway READS and REMEMBERS:
--
--   social_inbound_events    every VERIFIED webhook delivery, once. The unique
--                            (provider, event_id) index is what makes ingestion
--                            idempotent: a platform's retry of the same bytes
--                            is a duplicate key, not a second event.
--   social_metric_snapshots  one row per creative per day, so underperformance
--                            is measured against the brand's OWN history.
--   social_creative_flags    a creative below its brand's own median, or below
--                            a threshold the operator set; carries the OFFER of
--                            a regeneration and who decided on it.
--   social_gateway_settings  the operator's own thresholds, per workspace. No
--                            universal threshold lives anywhere in this schema.
--
-- No credential of any kind is stored here; tokens stay in
-- workspace_connection_secrets. Members read through RLS; only the service
-- role writes, except the thresholds, which an editor sets. anon gets nothing.
--
-- Additive + idempotent, same conventions as the migrations before it.
-- ============================================================================

-- ── 1. Verified inbound events ──────────────────────────────────────────────
create table if not exists public.social_inbound_events (
  id            uuid primary key default gen_random_uuid(),
  -- Null when no connection names the account the event is about: kept for
  -- diagnosis, never guessed onto a brand.
  workspace_id  uuid references public.brand_workspaces(id) on delete cascade,
  provider      text not null,
  -- The digest of the verified bytes unless the platform names its own id.
  event_id      text not null,
  account_id    text,
  event_type    text,
  kind          text,                                    -- comment | mention | publish_status | authorization | batch | other
  items         jsonb not null default '[]'::jsonb,
  payload       jsonb,
  received_at   timestamptz not null default now()
);

create unique index if not exists social_inbound_events_dedupe_idx
  on public.social_inbound_events (provider, event_id);
create index if not exists social_inbound_events_ws_idx
  on public.social_inbound_events (workspace_id, received_at desc);

alter table public.social_inbound_events enable row level security;
do $$ begin
  create policy "social inbound events readable by members" on public.social_inbound_events
    for select to authenticated
    using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 2. Metric snapshots ─────────────────────────────────────────────────────
create table if not exists public.social_metric_snapshots (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,
  provider      text not null,
  kind          text not null default 'organic',         -- organic | paid
  surface       text,
  external_id   text not null,
  name          text,
  -- Only the values the platform returned. An absent metric is absent, never 0.
  metrics       jsonb not null default '{}'::jsonb,
  captured_on   date not null default current_date,
  captured_at   timestamptz not null default now(),
  job_id        uuid references public.dispatch_jobs(id) on delete set null,
  asset_ref     text,
  slot_date     date
);

create unique index if not exists social_metric_snapshots_day_idx
  on public.social_metric_snapshots (workspace_id, provider, kind, external_id, captured_on);

alter table public.social_metric_snapshots enable row level security;
do $$ begin
  create policy "social metric snapshots readable by members" on public.social_metric_snapshots
    for select to authenticated
    using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 3. Underperformance flags ───────────────────────────────────────────────
create table if not exists public.social_creative_flags (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,
  provider      text not null,
  kind          text not null,
  external_id   text not null,
  metric        text not null,
  basis         text not null,                           -- own_median | operator_threshold
  value         double precision,
  median        double precision,
  threshold     double precision,
  reason        text,
  -- The regeneration OFFERED: feature key and credit price. Nothing runs from it.
  offer         jsonb,
  status        text not null default 'open',            -- open | regen_approved | dismissed
  decided_by    uuid,
  decided_at    timestamptz,
  job_id        uuid references public.dispatch_jobs(id) on delete set null,
  asset_ref     text,
  slot_date     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists social_creative_flags_one_idx
  on public.social_creative_flags (workspace_id, provider, external_id, metric, basis);

alter table public.social_creative_flags enable row level security;
do $$ begin
  create policy "social creative flags readable by members" on public.social_creative_flags
    for select to authenticated
    using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 4. The operator's thresholds ────────────────────────────────────────────
create table if not exists public.social_gateway_settings (
  workspace_id  uuid primary key references public.brand_workspaces(id) on delete cascade,
  thresholds    jsonb not null default '{"paid":{},"organic":{}}'::jsonb,
  updated_by    uuid,
  updated_at    timestamptz not null default now()
);

alter table public.social_gateway_settings enable row level security;
do $$ begin
  create policy "social gateway settings readable by members" on public.social_gateway_settings
    for select to authenticated
    using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "social gateway settings written by editors" on public.social_gateway_settings
    for all to authenticated
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 5. Grants ───────────────────────────────────────────────────────────────
-- anon gets nothing. Members select; the service role writes; an editor writes
-- only the thresholds.
do $$
declare t text;
begin
  foreach t in array array[
    'social_inbound_events', 'social_metric_snapshots', 'social_creative_flags', 'social_gateway_settings'
  ] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

grant insert, update on public.social_gateway_settings to authenticated;
