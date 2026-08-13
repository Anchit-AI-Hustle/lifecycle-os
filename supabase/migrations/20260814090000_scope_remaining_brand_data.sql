-- ═══════════════════════════════════════════════════════════════════════════
-- Finish the job 20260810160000 started: the tables that are still SINGLETONS
-- or still deployment-wide, and therefore still show one brand's data to
-- another.
--
-- 20260810160000 scoped the content tables. What it left behind is a different
-- shape of the same bug - a table that CANNOT hold two brands' rows at all:
--
--   * lifecycle_brand_kit is literally `id INT PRIMARY KEY CHECK (id = 1)`.
--     Every brand's Brand Kit page read tenant zero's palette, typography and
--     voice, and every SAVE overwrote it for everyone else on the deployment.
--     The read policy was `USING (true)`, so it was world-readable too.
--
--   * kb_daily_digest is UNIQUE on digest_date alone, so the second brand to
--     synthesise a digest on a given day overwrote the first brand's.
--
--   * the analytics control plane (hourly runs, anomaly state, action outcomes,
--     alert settings) carries measured business performance - incremental
--     revenue, ROI, guardrail breaches - with no owner at all. Data Analysis
--     served it to whoever was signed in.
--
--   * analytics_alert_settings additionally pinned one named person's mailbox
--     in a CHECK constraint, so no other operator could ever save settings.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  first_ws uuid;
begin
  select id into first_ws from public.brand_workspaces order by created_at asc limit 1;

  -- ── 1. lifecycle_brand_kit: one row per brand, not one row full stop ──────
  if to_regclass('public.lifecycle_brand_kit') is not null then
    alter table public.lifecycle_brand_kit add column if not exists workspace_id uuid;
    -- The singleton check is what makes a second brand impossible.
    alter table public.lifecycle_brand_kit drop constraint if exists lifecycle_brand_kit_id_check;
    alter table public.lifecycle_brand_kit drop constraint if exists knickgasm_brand_kit_id_check;
    -- id stays the primary key (existing readers select on it); it is now the
    -- workspace's own id for every row a brand saves, and the historical row 1
    -- belongs to tenant zero.
    alter table public.lifecycle_brand_kit alter column id type text using id::text;
    alter table public.lifecycle_brand_kit alter column id drop default;
    if first_ws is not null then
      update public.lifecycle_brand_kit set workspace_id = first_ws where workspace_id is null;
    end if;
    create unique index if not exists lifecycle_brand_kit_ws_uidx
      on public.lifecycle_brand_kit (workspace_id);

    alter table public.lifecycle_brand_kit enable row level security;
    drop policy if exists "anon read brand_kit" on public.lifecycle_brand_kit;
    drop policy if exists lifecycle_brand_kit_ws_read on public.lifecycle_brand_kit;
    create policy lifecycle_brand_kit_ws_read on public.lifecycle_brand_kit for select
      using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
    drop policy if exists lifecycle_brand_kit_ws_write on public.lifecycle_brand_kit;
    create policy lifecycle_brand_kit_ws_write on public.lifecycle_brand_kit for insert
      with check (workspace_id is not null and public.is_brand_editor(workspace_id, auth.uid()));
    drop policy if exists lifecycle_brand_kit_ws_update on public.lifecycle_brand_kit;
    create policy lifecycle_brand_kit_ws_update on public.lifecycle_brand_kit for update
      using (workspace_id is not null and public.is_brand_editor(workspace_id, auth.uid()))
      with check (workspace_id is not null and public.is_brand_editor(workspace_id, auth.uid()));
  end if;

  -- ── 2. kb_daily_digest: one digest per brand per day ──────────────────────
  if to_regclass('public.kb_daily_digest') is not null then
    alter table public.kb_daily_digest add column if not exists workspace_id uuid;
    if first_ws is not null then
      update public.kb_daily_digest set workspace_id = first_ws where workspace_id is null;
    end if;
    drop index if exists public.kb_daily_digest_date_idx;
    create unique index if not exists kb_daily_digest_ws_date_uidx
      on public.kb_daily_digest (workspace_id, digest_date);
  end if;
end $$;

-- ── 3. The analytics control plane owns measured performance ────────────────
do $$
declare
  t text;
  first_ws uuid;
begin
  select id into first_ws from public.brand_workspaces order by created_at asc limit 1;

  foreach t in array array[
    'analytics_hourly_runs', 'analytics_anomaly_state',
    'analytics_action_outcomes', 'analytics_alert_settings'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I add column if not exists workspace_id uuid', t);
    execute format('create index if not exists %I on public.%I (workspace_id)', t || '_ws_idx', t);
    if first_ws is not null then
      execute format('update public.%I set workspace_id = %L where workspace_id is null', t, first_ws);
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ws_read', t);
    execute format($f$create policy %I on public.%I for select
      using (workspace_id is not null and public.is_brand_member(workspace_id::uuid, auth.uid()))$f$, t || '_ws_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_ws_write', t);
    execute format($f$create policy %I on public.%I for insert
      with check (workspace_id is not null and public.is_brand_member(workspace_id::uuid, auth.uid()))$f$, t || '_ws_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_ws_update', t);
    execute format($f$create policy %I on public.%I for update
      using (workspace_id is not null and public.is_brand_member(workspace_id::uuid, auth.uid()))
      with check (workspace_id is not null and public.is_brand_member(workspace_id::uuid, auth.uid()))$f$, t || '_ws_update', t);
  end loop;
end $$;

-- An action id is unique WITHIN a brand. Globally unique means the second brand
-- to record the same action id silently overwrites the first brand's outcome.
drop index if exists public.analytics_action_outcomes_action_uidx;
create unique index if not exists analytics_action_outcomes_ws_action_uidx
  on public.analytics_action_outcomes (workspace_id, action_id) where action_id is not null;

-- One named person's mailbox was pinned in a CHECK constraint, so every other
-- operator's save was rejected by the database. The sender is an environment
-- setting (live-connectors.senderIdentity), not a fact about the schema.
alter table public.analytics_alert_settings drop constraint if exists analytics_alert_sender_locked;
alter table public.analytics_alert_settings alter column sender_email drop not null;
alter table public.analytics_alert_settings alter column sender_email drop default;

-- ── 4. Dedupe keys are unique WITHIN a brand, not across the platform ───────
--
-- Every one of these was globally unique, which is a cross-brand write with no
-- error attached: the second brand to ingest the same URL, add the same
-- competitor, or capture the same creative either overwrote the first brand's
-- row through an upsert or was rejected outright. Both look like "it just does
-- not save" from the outside.
do $$
declare
  spec text[];
  specs text[][] := array[
    array['kb_knowledge',                 'kb_knowledge_url_hash_uq',                'url_hash'],
    array['competitor_brands',            'competitor_brands_name_region_uq',        'name, region'],
    array['competitor_emails_classified', 'competitor_emails_classified_key_uq',     'email_key'],
    array['competitor_landing_pages',     'landing_pages_url_hash_uq',               'url_hash'],
    array['ci_ads',                       'ci_ads_hash_uidx',                        'content_hash'],
    array['ci_emails',                    'ci_emails_hash_uidx',                     'content_hash'],
    array['ci_landing_pages',             'ci_lp_hash_uidx',                         'url_hash, content_hash'],
    array['ci_offers',                    'ci_offers_hash_uidx',                     'content_hash'],
    array['kb_campaigns',                 'kb_campaigns_src_uidx',                   'source_db_id'],
    array['cohorts',                      'cohorts_key_uidx',                        'cohort_key'],
    array['performance_metrics',          'perf_uidx',                               'grain, entity_id, metric_date']
  ];
begin
  foreach spec slice 1 in array specs loop
    if to_regclass('public.' || spec[1]) is null then continue; end if;
    execute format('drop index if exists public.%I', spec[2]);
    execute format('create unique index if not exists %I on public.%I (workspace_id, %s)',
                   spec[1] || '_ws_uidx', spec[1], spec[3]);
  end loop;
end $$;

-- Report what is still unattributed.
create or replace view public.v_unscoped_analytics as
select 'analytics_action_outcomes' as table_name, count(*) as unscoped_rows
  from public.analytics_action_outcomes where workspace_id is null
union all select 'analytics_hourly_runs', count(*) from public.analytics_hourly_runs where workspace_id is null
union all select 'analytics_anomaly_state', count(*) from public.analytics_anomaly_state where workspace_id is null
union all select 'lifecycle_brand_kit', count(*) from public.lifecycle_brand_kit where workspace_id is null
union all select 'kb_daily_digest', count(*) from public.kb_daily_digest where workspace_id is null;
