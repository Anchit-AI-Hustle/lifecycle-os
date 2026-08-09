-- ============================================================================
-- 20260809140000_telesuite.sql
-- TeleSuite — the AI tele-sales / tele-support suite, ported from
-- github.com/Anchit-AI-Hustle/AI-TeleSuite into this platform.
--
-- The original app kept everything in browser localStorage, so nothing survived
-- a device change and no dashboard could span a team. Here the same objects are
-- persisted per brand workspace:
--   telesuite_items  — Products and Knowledge Base entries (the context every
--                      TeleSuite generator is grounded in)
--   telesuite_runs   — one row per feature run: inputs, output, credits charged.
--                      This single table backs EVERY TeleSuite dashboard
--                      (transcription DB, call scoring DB, combined analysis DB,
--                      voice sales/support DB, material DB, data analysis DB and
--                      the global activity log) — they are filtered views of it,
--                      per the repo's shared-source-of-truth rule.
--
-- Scoped by workspace_id, so TeleSuite is per-brand like the rest of the app,
-- and readable only by that workspace's members.
-- ============================================================================

create table if not exists public.telesuite_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.brand_workspaces(id) on delete cascade,
  user_id      uuid not null default auth.uid(),
  kind         text not null,                     -- product | knowledge
  name         text not null,
  category     text,                              -- KB category / product line
  content      text,                              -- KB body, or product description
  attributes   jsonb not null default '{}'::jsonb,-- price, sku, USPs, links...
  source       text,                              -- upload | typed | catalog | generated
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.telesuite_items enable row level security;

create index if not exists telesuite_items_ws_idx   on public.telesuite_items (workspace_id, kind);
create index if not exists telesuite_items_name_idx on public.telesuite_items (workspace_id, name);

do $$ begin
  create policy "telesuite items by members" on public.telesuite_items
    for all using (public.is_brand_member(workspace_id, auth.uid()))
        with check (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

create table if not exists public.telesuite_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,
  user_id       uuid not null default auth.uid(),
  feature       text not null,                    -- pitch | rebuttal | transcription | call_scoring | ...
  title         text,
  status        text not null default 'complete', -- complete | failed | in_progress
  product       text,                             -- product this run was about
  input         jsonb not null default '{}'::jsonb,
  output        jsonb not null default '{}'::jsonb,
  score         numeric,                          -- headline number, if the feature has one
  duration_ms   integer,
  units         numeric,                          -- billable units (minutes, chars...)
  credits       integer not null default 0,       -- credits actually charged
  credit_ref    text,                             -- ledger hold id, for reconciliation
  provider      text,                             -- which LLM provider answered
  error         text,
  created_at    timestamptz not null default now()
);

alter table public.telesuite_runs enable row level security;

create index if not exists telesuite_runs_ws_idx      on public.telesuite_runs (workspace_id, created_at desc);
create index if not exists telesuite_runs_feature_idx on public.telesuite_runs (workspace_id, feature, created_at desc);

do $$ begin
  create policy "telesuite runs by members" on public.telesuite_runs
    for all using (public.is_brand_member(workspace_id, auth.uid()))
        with check (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.telesuite_runs;
exception when duplicate_object then null; when undefined_object then null; end $$;

comment on table public.telesuite_runs is
  'One row per TeleSuite feature run. Every TeleSuite dashboard is a filtered view of this table (shared source of truth) rather than its own store, and `credits` records what the run actually cost.';
