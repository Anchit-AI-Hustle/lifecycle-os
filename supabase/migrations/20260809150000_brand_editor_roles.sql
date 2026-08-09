-- ============================================================================
-- 20260809150000_brand_editor_roles.sql
-- Split brand-workspace membership from WRITE permission.
--
-- `is_brand_member()` deliberately returns true for every member, including a
-- declared `viewer`. The catalog policy in 20260809120000 was written FOR ALL
-- using that function, so a viewer could call catalog-import with replacement
-- enabled and wipe or replace the workspace's entire product catalog. Reading
-- and writing need different tests.
--
-- Also adds the batch column that makes a replacement import atomic: new rows
-- are inserted under a fresh `import_batch`, and only once they are all in are
-- the previous rows deleted. A failure part-way through therefore leaves the
-- previous catalog intact instead of an empty or half-written one.
--
-- Additive + idempotent.
-- ============================================================================

-- ── 1. Write permission = owner or editor ───────────────────────────────────
create or replace function public.is_brand_editor(ws uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.brand_workspaces w where w.id = ws and w.owner_id = uid
  ) or exists (
    select 1 from public.brand_workspace_members m
     where m.workspace_id = ws and m.user_id = uid and m.role in ('owner', 'editor')
  );
$$;

comment on function public.is_brand_editor is
  'Write test for a brand workspace: the owner, or a member whose role is owner/editor. A `viewer` is deliberately excluded. Use is_brand_member for reads and this for writes.';

-- ── 2. Catalog: members read, editors write ─────────────────────────────────
drop policy if exists "catalog written by members" on public.brand_catalog_products;

do $$ begin
  create policy "catalog written by editors" on public.brand_catalog_products
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
-- "catalog readable by members" from the earlier migration is unchanged, so a
-- viewer keeps read access.

-- ── 3. TeleSuite: members read, editors write ───────────────────────────────
drop policy if exists "telesuite items by members" on public.telesuite_items;
drop policy if exists "telesuite runs by members" on public.telesuite_runs;

do $$ begin
  create policy "telesuite items readable by members" on public.telesuite_items
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "telesuite items written by editors" on public.telesuite_items
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "telesuite runs readable by members" on public.telesuite_runs
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "telesuite runs written by editors" on public.telesuite_runs
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 4. Atomic catalog replacement ───────────────────────────────────────────
alter table public.brand_catalog_products
  add column if not exists import_batch uuid;

create index if not exists brand_catalog_batch_idx
  on public.brand_catalog_products (workspace_id, region, import_batch);

comment on column public.brand_catalog_products.import_batch is
  'Stage-and-swap marker. A replacement import writes every new row under a fresh batch id and only then deletes rows from earlier batches, so a failure part-way through leaves the previous catalog intact.';
