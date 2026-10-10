-- Four views ran as their OWNER and were readable by anon and authenticated
-- (Supabase Security Advisor, 2026-10-10: "Security Definer View", CRITICAL).
-- A view without security_invoker reads its tables with the owner's rights, so
-- row-level security on brand_workspaces, brand_field_provenance, ci_offers and
-- every brand-scoped table was skipped for whoever queried the view. And the
-- default grants let anon (the public browser key) and every signed-in user
-- query them: v_unscoped_content and v_unscoped_analytics list rows across ALL
-- workspaces, v_brand_field_origins names every brand's field provenance.
--
-- The only code that reads any of them is api/_shared/ci-offers.js
-- (v_ci_offers_enriched) through supa.js with the SERVICE ROLE key, which
-- bypasses row-level security whatever the view says, so nothing the app does
-- changes. The other three are operator views no code reads.
--
-- Now: each view runs as the CALLER (security_invoker), anon and authenticated
-- hold no privilege on it, and service_role keeps SELECT.

alter view if exists public.v_ci_offers_enriched  set (security_invoker = on);
alter view if exists public.v_unscoped_content    set (security_invoker = on);
alter view if exists public.v_unscoped_analytics  set (security_invoker = on);
alter view if exists public.v_brand_field_origins set (security_invoker = on);

do $$
declare v text;
begin
  foreach v in array array['v_ci_offers_enriched','v_unscoped_content','v_unscoped_analytics','v_brand_field_origins'] loop
    if exists (select 1 from pg_views where schemaname = 'public' and viewname = v) then
      execute format('revoke all on public.%I from anon, authenticated', v);
      execute format('grant select on public.%I to service_role', v);
    end if;
  end loop;
end $$;
