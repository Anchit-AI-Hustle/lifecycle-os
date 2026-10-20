-- ============================================================================
-- 20261020103000_paid_launches.sql
--
-- The paid launch pipeline (api/_shared/paid-launch-core.js): a brand's ad
-- account is read (account sync), a launch is PLANNED from the brand's own
-- assets with a stated daily budget split across its ad sets, and then BUILT
-- on the platform one step at a time (campaign -> ad sets with their budgets ->
-- creatives -> ads), every object created PAUSED. Turning the spend on is its
-- own approval, stamped with the operator who gave it.
--
--   paid_launches        one row per launch: the plan, every step with the id
--                        the platform gave it (so a re-run resumes and never
--                        creates an object twice), the run lease (one runner
--                        at a time), and who approved it going live.
--   paid_account_syncs   what an account sync read: every campaign and ad set
--                        with its status and budget, and the last 7 days of
--                        spend per ad set. A value the platform did not return
--                        is null, never zero.
--
-- No credential is stored here; tokens stay in workspace_connection_secrets.
-- Members read through RLS; only the service role writes, after the module has
-- checked the caller's role. anon gets nothing.
--
-- Additive + idempotent, same conventions as the migrations before it.
-- ============================================================================

create table if not exists public.paid_launches (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.brand_workspaces(id) on delete cascade,
  provider          text not null,                         -- meta
  ad_account_id     text not null,
  name              text not null,
  status            text not null default 'planned'
                    check (status in ('planned', 'building', 'blocked', 'failed', 'built', 'live', 'paused')),
  plan              jsonb not null default '{}'::jsonb,
  steps             jsonb not null default '[]'::jsonb,
  run_token         text,
  run_started_at    timestamptz,
  created_by        uuid,
  approved_by       uuid,
  approved_at       timestamptz,
  last_note         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists paid_launches_ws_idx on public.paid_launches (workspace_id, created_at desc);

create table if not exists public.paid_account_syncs (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.brand_workspaces(id) on delete cascade,
  provider          text not null,
  ad_account_id     text not null,
  currency          text,
  complete          boolean not null default true,
  campaigns         jsonb not null default '[]'::jsonb,
  ad_sets           jsonb not null default '[]'::jsonb,
  note              text,
  synced_by         uuid,
  synced_at         timestamptz not null default now()
);

create index if not exists paid_account_syncs_ws_idx on public.paid_account_syncs (workspace_id, provider, ad_account_id, synced_at desc);

alter table public.paid_launches enable row level security;
alter table public.paid_account_syncs enable row level security;

do $$ begin
  create policy "paid launches readable by members" on public.paid_launches
    for select to authenticated using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "paid account syncs readable by members" on public.paid_account_syncs
    for select to authenticated using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$
declare t text;
begin
  foreach t in array array['paid_launches', 'paid_account_syncs'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
