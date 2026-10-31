-- 2026-10-31. Two production fixes the operator asked for, applied by the
-- Supabase GitHub integration when this file reaches main (no dashboard or
-- token needed).
--
-- 1. Only Google can create an account.
--    The project's Email provider is still on server-side, so anyone holding
--    the public anon key could sign up with an email and password.
--    verifyCaller() and data-analysis-core.authorize() already refuse such an
--    account, but the account itself was still created. This trigger refuses
--    to create any auth user whose provider is not Google, which is the
--    database-side equivalent of switching the Email provider off. Users that
--    already exist are untouched. GoTrue writes raw_app_meta_data.provider on
--    the insert ('google' for a Google sign-in), so the check is made there.
--
-- 2. The Times of India keeps only its home market, IN.
--    An earlier site read added UK and US to its record (fixed for new reads in
--    onboarding.html applyMarkets). This trims existing rows to the IN entry,
--    marks it home, and marks products filed under the removed markets stale
--    (kept, never deleted). A row with no IN entry is left as it is.

create or replace function public.lifecycle_refuse_non_google_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A row with no provider recorded is let through (no provider to judge);
  -- GoTrue stamps 'email', 'phone', 'anonymous' or the OAuth name on sign-up.
  if coalesce(new.raw_app_meta_data->>'provider', 'google') <> 'google' then
    raise exception 'Only Google sign-in can create a Lifecycle OS account (provider %).',
      coalesce(new.raw_app_meta_data->>'provider', 'unknown')
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.lifecycle_refuse_non_google_signup() from public, anon, authenticated;

drop trigger if exists lifecycle_google_only_signup on auth.users;
create trigger lifecycle_google_only_signup
  before insert on auth.users
  for each row execute function public.lifecycle_refuse_non_google_signup();

do $$
declare
  r record;
  kept jsonb;
begin
  if to_regclass('public.brand_workspaces') is null then
    return;
  end if;
  for r in
    select id, regions from public.brand_workspaces
    where (name ilike '%times of india%' or coalesce(website, '') ilike '%timesofindia%')
      and jsonb_typeof(regions) = 'array'
  loop
    select coalesce(jsonb_agg(e || '{"home": true}'::jsonb), '[]'::jsonb)
      into kept
      from jsonb_array_elements(r.regions) e
     where upper(coalesce(e->>'code', '')) in ('IN', 'IND', 'INDIA');
    if jsonb_array_length(kept) = 0 or kept = r.regions then
      continue;
    end if;
    update public.brand_workspaces set regions = kept where id = r.id;
    if to_regclass('public.brand_catalog_products') is not null
       and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'brand_catalog_products'
                      and column_name = 'stale_at') then
      execute 'update public.brand_catalog_products set stale_at = now()
                where workspace_id = $1 and lower(region) in (''uk'', ''gb'', ''us'')
                  and stale_at is null'
        using r.id;
    end if;
  end loop;
end;
$$;
