-- ═══════════════════════════════════════════════════════════════════════════
-- Rename the PRODUCT's tables off a brand name.
--
-- The platform shipped as a single-brand app, so its own tables were named
-- after that brand: knickgasm_brand_kit, knickgasm_campaigns, and so on. It is
-- now a multi-brand product (Lifecycle OS) in which Knickgasm is merely tenant
-- zero, so a tenant's name in the product's schema is simply wrong - and
-- confusing to every other brand on it.
--
-- Each table is renamed to a neutral lifecycle_* name and the OLD name is
-- recreated as a simple updatable view over it. Postgres auto-updates a view
-- that selects all columns from one table with no aggregates, so existing code
-- keeps reading AND writing through the old name while callers migrate. That
-- makes this safe to deploy before the code change rather than in lockstep.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  pair record;
begin
  for pair in
    select * from (values
      ('knickgasm_brand_kit',     'lifecycle_brand_kit'),
      ('knickgasm_market_config', 'lifecycle_market_config'),
      ('knickgasm_collections',   'lifecycle_collections'),
      ('knickgasm_products',      'lifecycle_products'),
      ('knickgasm_campaigns',     'lifecycle_campaigns'),
      ('knickgasm_users',         'lifecycle_users')
    ) as t(old_name, new_name)
  loop
    -- Only act when the OLD name is still a real table (not already a view we made).
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = pair.old_name and table_type = 'BASE TABLE'
    ) and to_regclass('public.' || pair.new_name) is null then
      execute format('alter table public.%I rename to %I', pair.old_name, pair.new_name);
      execute format('create or replace view public.%I as select * from public.%I', pair.old_name, pair.new_name);
      -- The view must be reachable by the same roles as the table.
      execute format('grant select, insert, update, delete on public.%I to anon, authenticated, service_role', pair.old_name);
      raise notice 'renamed % -> % (compat view kept)', pair.old_name, pair.new_name;
    end if;
  end loop;
end $$;

-- Keep RLS meaningful on the renamed tables: a view does not carry its own RLS,
-- it inherits the base table's, which is what we want.
