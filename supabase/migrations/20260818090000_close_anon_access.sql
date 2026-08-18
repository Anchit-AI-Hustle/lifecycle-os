-- Close anonymous access to customer data and to the generation tables.
--
-- Three findings, all confirmed against this repo:
--
--   1. public.smart_users and public.smart_orders have NO row level security
--      anywhere in the migration history. smart_users holds email,
--      total_spend, orders_count, last_order_at, accepts_marketing;
--      smart_orders holds user_id, total, product_sku. The anon key is public
--      by design - it is safe ONLY while RLS holds, and here it did not.
--
--   2. 20260719120000 granted `select, insert, update, delete ... to anon` on
--      smart_generated_campaigns and smart_brain_runs, with policies of
--      `using (true)` / `with check (true)`. That is anonymous read AND write:
--      anyone with the published anon key could read every workspace's
--      campaigns, or insert and delete rows in them.
--
--   3. api/_shared/supa.js prefers SUPABASE_SERVICE_ROLE_KEY but FALLS BACK to
--      the anon key. So on a deployment with no service key, the server's own
--      reads of these tables have been travelling as `anon` - which is exactly
--      why the missing RLS mattered rather than being theoretical.
--
-- ⚠️ OPERATIONAL PRECONDITION. After this migration, server paths that read
-- these tables REQUIRE a real SUPABASE_SERVICE_ROLE_KEY (the service role
-- bypasses RLS). The repo already lists that key as a launch dependency. If it
-- is not set, those reads will now return empty instead of silently reading as
-- anon - which is the correct failure: no data is better than everyone's data.
--
-- Written to be re-runnable.

-- ── 1. Customer data: RLS on, anon out ────────────────────────────────────
alter table if exists public.smart_users  enable row level security;
alter table if exists public.smart_orders enable row level security;

revoke all on public.smart_users  from anon;
revoke all on public.smart_orders from anon;

-- No policy for anon is created on purpose. These tables are read by server
-- paths under the service role; a browser has no business reading another
-- customer's email and lifetime spend, so there is nothing to grant.
do $$ begin
  drop policy if exists "smart_users_authenticated_read"  on public.smart_users;
  drop policy if exists "smart_orders_authenticated_read" on public.smart_orders;
exception when undefined_table then null; end $$;

-- ── 2. Generation tables: authenticated only, and no anonymous writes ─────
do $$ begin
  revoke all on public.smart_generated_campaigns from anon;
  revoke all on public.smart_brain_runs          from anon;
exception when undefined_table then null; end $$;

do $$ begin
  -- `using (true)` let any caller holding ANY key see every workspace's rows.
  drop policy if exists "sgc_read"  on public.smart_generated_campaigns;
  drop policy if exists "sgc_write" on public.smart_generated_campaigns;
  drop policy if exists "sgc_upd"   on public.smart_generated_campaigns;
  drop policy if exists "sbr_read"  on public.smart_brain_runs;
  drop policy if exists "sbr_write" on public.smart_brain_runs;
exception when undefined_table then null; end $$;

-- Signed-in users only. Where the table carries a workspace_id, membership is
-- what decides - the same is_brand_member gate the rest of the brand content
-- uses - so one tenant cannot read another's generated campaigns.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'smart_generated_campaigns'
               and column_name = 'workspace_id') then
    create policy "sgc_member_read" on public.smart_generated_campaigns
      for select to authenticated
      using (workspace_id is null or public.is_brand_member(workspace_id, auth.uid()));
    create policy "sgc_member_write" on public.smart_generated_campaigns
      for insert to authenticated
      with check (workspace_id is null or public.is_brand_member(workspace_id, auth.uid()));
    create policy "sgc_member_upd" on public.smart_generated_campaigns
      for update to authenticated
      using (workspace_id is null or public.is_brand_member(workspace_id, auth.uid()))
      with check (workspace_id is null or public.is_brand_member(workspace_id, auth.uid()));
  else
    create policy "sgc_auth_read"  on public.smart_generated_campaigns for select to authenticated using (true);
    create policy "sgc_auth_write" on public.smart_generated_campaigns for insert to authenticated with check (true);
    create policy "sgc_auth_upd"   on public.smart_generated_campaigns for update to authenticated using (true) with check (true);
  end if;
exception when duplicate_object then null; when undefined_table then null; end $$;

do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'smart_brain_runs'
               and column_name = 'workspace_id') then
    create policy "sbr_member_read" on public.smart_brain_runs
      for select to authenticated
      using (workspace_id is null or public.is_brand_member(workspace_id, auth.uid()));
    create policy "sbr_member_write" on public.smart_brain_runs
      for insert to authenticated
      with check (workspace_id is null or public.is_brand_member(workspace_id, auth.uid()));
  else
    create policy "sbr_auth_read"  on public.smart_brain_runs for select to authenticated using (true);
    create policy "sbr_auth_write" on public.smart_brain_runs for insert to authenticated with check (true);
  end if;
exception when duplicate_object then null; when undefined_table then null; end $$;

-- Deletion is never a browser action on either table; the service role does it.
-- Nothing above grants delete to anyone.

-- ── 4. The compat views from the 20260810140000 rename ────────────────────
--
-- Not in the audit; found by the test written for §2. That migration renamed
-- six tables and left a `create or replace view <old_name>` behind for
-- compatibility, then granted `select, insert, update, delete` on each view to
-- `anon`. One of them is knickgasm_users -> lifecycle_users, so this is the
-- same class of exposure as smart_users: a users table, writable through a
-- view, by anyone holding the published anon key.
--
-- Revoked here rather than by editing 20260810140000, which has already run on
-- deployed databases; rewriting applied history would leave the two out of step.
do $$
declare v text;
begin
  foreach v in array array[
    'knickgasm_brand_kit', 'knickgasm_market_config', 'knickgasm_collections',
    'knickgasm_products',  'knickgasm_campaigns',     'knickgasm_users'
  ] loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke all on public.%I from anon', v);
      execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', v);
    end if;
  end loop;
end $$;
