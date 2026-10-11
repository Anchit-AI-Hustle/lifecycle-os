-- 20261011054000_catalog_import_queue.sql
--
-- The product URL queue of a store import, as a table of its own (2026-10-11).
--
-- WHY. The live Nykaa probe: its product sitemaps declare 340,398 URLs. The
-- list of URLs still to read used to ride on the brand's row inside the
-- import cursor (brand_workspaces.catalog_import.cursor), so it was capped at
-- 20,000 per market - about 4.3 MB of JSON written on every step; 340,398
-- would be about 73 MB per step. The operator requires the complete
-- catalogue. Here each URL is a row and the cursor is a small pointer.
--
-- SHAPE. One row per (workspace, run, market, url) - unique, so a URL listed
-- by two sitemaps, or re-listed on a later step, is queued once. `seq` keeps
-- the order the sitemaps list them in; `state` is pending | done | failed;
-- `tries` and `next_at` carry the retry of a page that did not answer
-- (throttling is retried later, never written off on its first try).
--
-- ACCESS. Read by the brand's members (RLS, the same rule as
-- brand_catalog_products), written by the SERVICE ROLE only: the import runs
-- as the service role and names the workspace on every query
-- (api/_shared/catalog-import.js dbQueue). A finished run's rows are deleted.

create table if not exists public.brand_catalog_import_queue (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.brand_workspaces(id) on delete cascade,
  run_id       text not null,
  market       text not null,
  url          text not null,
  seq          bigint not null default 0,
  state        text not null default 'pending',
  tries        integer not null default 0,
  next_at      timestamptz not null default 'epoch',
  created_at   timestamptz not null default now(),
  constraint brand_catalog_import_queue_state_chk check (state in ('pending', 'done', 'failed')),
  constraint brand_catalog_import_queue_url_chk check (url ~* '^https?://')
);

create unique index if not exists brand_catalog_import_queue_key
  on public.brand_catalog_import_queue (workspace_id, run_id, market, url);
create index if not exists brand_catalog_import_queue_next
  on public.brand_catalog_import_queue (workspace_id, run_id, market, state, next_at, seq);

alter table public.brand_catalog_import_queue enable row level security;

do $$ begin
  create policy "import queue readable by members" on public.brand_catalog_import_queue
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- No write policy: a member's token cannot write it. The service role
-- bypasses RLS and is the only writer.
revoke all on public.brand_catalog_import_queue from anon;
revoke insert, update, delete on public.brand_catalog_import_queue from authenticated;
grant select on public.brand_catalog_import_queue to authenticated;
grant all on public.brand_catalog_import_queue to service_role;

comment on table public.brand_catalog_import_queue is
  'Product URLs a store import still has to read, per workspace, run and market. Service-role writes only; the workspace is named on every query. Replaces the 20,000-URL list that rode on brand_workspaces.catalog_import.';
