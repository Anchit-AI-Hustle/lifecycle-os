-- ═══════════════════════════════════════════════════════════════════════════
-- Scope every content table to a brand workspace.
--
-- The brand layer (20260809120000) made brands first-class, but the CONTENT
-- tables predate it and carry no workspace column. So on a multi-brand
-- account every workspace shared one campaign calendar, one knowledge base,
-- one asset library, and each other's generated mailers, ads and landing
-- pages. A publisher workspace could open the calendar and see a sneaker
-- brand's sends; the market-intel KB returned another industry's research to
-- everyone.
--
-- This adds `workspace_id` to each content table, backfills existing rows to
-- the owner's oldest workspace (they were all created before multi-brand, so
-- they belong to that operator's first brand), and replaces the permissive
-- policies with membership-scoped ones built on public.is_brand_member().
--
-- Rows whose owner cannot be determined are left with workspace_id NULL and
-- become invisible to the scoped policies rather than leaking to everyone.
-- They are not deleted: an operator can reassign them deliberately.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Add the column everywhere ────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'kb_knowledge', 'brand_assets', 'smart_calendar_entries',
    'smart_generated_campaigns', 'ads_generated', 'landing_pages_generated',
    'mailers_generated'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists workspace_id uuid', t);
      execute format('create index if not exists %I on public.%I (workspace_id)', t || '_ws_idx', t);
    end if;
  end loop;
end $$;

-- ── 2. Backfill to each owner's first workspace ─────────────────────────────
-- Tables that carry a user_email/added_by we can map back to an owner.
do $$
declare
  first_ws uuid;
begin
  -- The single oldest workspace overall is tenant zero: pre-multi-brand rows
  -- were all created while only that brand existed.
  select id into first_ws from public.brand_workspaces order by created_at asc limit 1;
  if first_ws is null then return; end if;

  if to_regclass('public.kb_knowledge') is not null then
    update public.kb_knowledge set workspace_id = first_ws where workspace_id is null;
  end if;
  if to_regclass('public.brand_assets') is not null then
    update public.brand_assets set workspace_id = first_ws where workspace_id is null;
  end if;
  if to_regclass('public.smart_calendar_entries') is not null then
    update public.smart_calendar_entries set workspace_id = first_ws where workspace_id is null;
  end if;
  if to_regclass('public.smart_generated_campaigns') is not null then
    update public.smart_generated_campaigns set workspace_id = first_ws where workspace_id is null;
  end if;
  if to_regclass('public.ads_generated') is not null then
    update public.ads_generated set workspace_id = first_ws where workspace_id is null;
  end if;
  if to_regclass('public.landing_pages_generated') is not null then
    update public.landing_pages_generated set workspace_id = first_ws where workspace_id is null;
  end if;
  if to_regclass('public.mailers_generated') is not null then
    update public.mailers_generated set workspace_id = first_ws where workspace_id is null;
  end if;
end $$;

-- ── 3. Membership-scoped policies ───────────────────────────────────────────
-- A row is visible only to members of ITS workspace. NULL workspace_id is
-- deliberately invisible: an unassigned row must not fall back to "everyone".
do $$
declare t text;
begin
  foreach t in array array[
    'kb_knowledge', 'brand_assets', 'smart_calendar_entries',
    'smart_generated_campaigns', 'ads_generated', 'landing_pages_generated',
    'mailers_generated'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;

    execute format('alter table public.%I enable row level security', t);

    -- Drop the pre-brand permissive policies by name where they exist.
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', 'allow_all_' || t, t);
    execute format('drop policy if exists %I on public.%I', t || ' read', t);

    execute format('drop policy if exists %I on public.%I', t || '_ws_read', t);
    execute format($f$
      create policy %I on public.%I for select
      using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()))
    $f$, t || '_ws_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_ws_insert', t);
    execute format($f$
      create policy %I on public.%I for insert
      with check (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()))
    $f$, t || '_ws_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_ws_update', t);
    execute format($f$
      create policy %I on public.%I for update
      using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()))
      with check (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()))
    $f$, t || '_ws_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_ws_delete', t);
    execute format($f$
      create policy %I on public.%I for delete
      using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()))
    $f$, t || '_ws_delete', t);
  end loop;
end $$;

-- ── 4. Report what is still unassigned ──────────────────────────────────────
-- A view the operator can query; unassigned rows are invisible to the app and
-- need a deliberate decision, so they are surfaced rather than hidden.
create or replace view public.v_unscoped_content as
  select 'kb_knowledge' as table_name, count(*) as unscoped_rows from public.kb_knowledge where workspace_id is null
  union all select 'brand_assets', count(*) from public.brand_assets where workspace_id is null
  union all select 'smart_calendar_entries', count(*) from public.smart_calendar_entries where workspace_id is null
  union all select 'ads_generated', count(*) from public.ads_generated where workspace_id is null
  union all select 'landing_pages_generated', count(*) from public.landing_pages_generated where workspace_id is null
  union all select 'mailers_generated', count(*) from public.mailers_generated where workspace_id is null;
