-- Close the always-true policies that opened every brand's rows to everyone.
-- ---------------------------------------------------------------------------
-- Measured on the hosted project (2026-10-09): 64 tables that carry a
-- workspace_id still had permissive policies `using (true)` / `with check
-- (true)` for role PUBLIC (or authenticated) BESIDE their is_brand_member()
-- policies. Permissive policies are OR'd, so the membership check decided
-- nothing: anyone holding the publishable key - which ships in the browser -
-- could read, insert, update and delete every brand's ads, mailers, landing
-- pages, knowledge base, cohorts, calendars, agents and workspace_members.
--
-- Why they survived: 20260810120000 dropped the old policies by GUESSED names
-- (`<t>_read`, `allow_all_<t>`); the real names were `ads_read`, `smart_cal_read`,
-- `lpg_read`, `anon read mailers`, ... and no guess covered `_upd`/`_del`.
-- 20260810160000 then added the member policies without dropping anything.
--
-- This migration decides by WHAT a policy says, not by its name:
--   1. every public table with a workspace_id column: drop each policy whose
--      USING or WITH CHECK is exactly `true` and whose roles are not only
--      service_role. The is_brand_member()/is_brand_editor() policies stay, so
--      a member keeps full access to their own brand and nothing else.
--   2. every other public table: drop the always-true WRITE policies
--      (INSERT/UPDATE/DELETE/ALL) for non-service roles. Shared reference reads
--      (festivals, prompt templates, connector registry) are left as they are.
--   3. RLS forced ON for every public table that has it off (none measured on
--      the hosted project; a fresh database built from these migrations had three).
-- The server reads and writes with the service role, which bypasses RLS, so no
-- server path changes. Two tables are deliberately excluded:
-- smart_generated_campaigns and smart_brain_runs, which serve /lp/:id on the
-- anon key by design (20260719120000; pinned in signed-out-usable.spec.js).
-- Idempotent: a second run finds nothing to drop.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  excluded text[] := array['smart_generated_campaigns', 'smart_brain_runs'];
begin
  for r in
    select p.tablename, p.policyname, p.cmd,
           exists (
             select 1 from pg_attribute a
             join pg_class c on c.oid = a.attrelid
             join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = p.tablename
               and a.attname = 'workspace_id' and not a.attisdropped
           ) as scoped
    from pg_policies p
    where p.schemaname = 'public'
      and not (p.tablename = any (excluded))
      and (coalesce(p.qual, '') = 'true' or coalesce(p.with_check, '') = 'true')
      and not (p.roles <@ array['service_role']::name[])
  loop
    if r.scoped or r.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') then
      execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
      raise notice 'dropped % on % (%)', r.policyname, r.tablename, r.cmd;
    end if;
  end loop;

  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    raise notice 'enabled RLS on %', r.relname;
  end loop;
end $$;
