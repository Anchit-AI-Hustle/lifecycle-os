-- Root cause of /lp/:id 404s (2026-07-19): the live smart_generated_campaigns
-- table carried the V1 brain-generate schema (id, slot_id, funnel_id, platform,
-- campaign_object jsonb, ...) with NOT NULL platform/slot_id/funnel_id and NO
-- `payload` column. The V2 smart-brain-plan pipeline (previewEntry/approveEntry/
-- prebuild/heal + landingPageResolve) persists and reads a `payload jsonb` column
-- via rows shaped {id, payload, status, updated_at}. Against the V1 table every V2
-- write silently landed nothing (missing column + NOT NULL violations), so approved
-- slots pointed at campaign ids that were never stored and /lp/:id could not serve.
--
-- Reconcile the table so it supports BOTH the V1 (campaign_object) and V2 (payload)
-- shapes. Verified live: after this, a {id, payload, status} upsert persists and
-- /lp/:id renders the stored landing-page html.
alter table public.smart_generated_campaigns add column if not exists payload jsonb;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='smart_generated_campaigns' and column_name='platform') then
    alter table public.smart_generated_campaigns alter column platform drop not null;
  end if;
end $$;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='smart_generated_campaigns' and column_name='slot_id') then
    alter table public.smart_generated_campaigns alter column slot_id drop not null;
  end if;
end $$;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='smart_generated_campaigns' and column_name='funnel_id') then
    alter table public.smart_generated_campaigns alter column funnel_id drop not null;
  end if;
end $$;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='smart_generated_campaigns' and column_name='campaign_object') then
    alter table public.smart_generated_campaigns alter column campaign_object drop not null;
  end if;
end $$;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='smart_generated_campaigns' and column_name='confidence') then
    alter table public.smart_generated_campaigns alter column confidence set default 0;
  end if;
end $$;
alter table public.smart_generated_campaigns alter column created_at set default now();
alter table public.smart_generated_campaigns alter column updated_at set default now();
