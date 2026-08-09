-- ═══════════════════════════════════════════════════════════════════════════
-- Finish brand isolation: scope EVERY brand-content table, and purge content
-- that belongs to a different industry entirely.
--
-- 20260810120000 scoped the seven tables the campaign pipeline writes. But the
-- database holds far more brand content than that - the competitor universe,
-- the captured competitor emails and ads, the KB corpus, cohorts, social posts,
-- the imported commerce data. All of it was global, so:
--   * a health-media workspace opened Competitor Benchmarking and was shown a
--     sneaker brand's competitor set, and
--   * that set was itself stale: 40 of 60 rows were the PREVIOUS brand's coffee
--     and supplement competitors, plus 9 token-swap artifacts ("Bird &
--     Colorway" was Bird & Blend Tea, "Clipper Sneakers" was Clipper Teas,
--     "The Republic of Sneaker" was The Republic of Tea).
--
-- Two jobs here: SCOPE the tables, and DELETE the content that is not this
-- platform's to show. Deleting is right rather than reassigning - none of those
-- rows describe any brand on the platform.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Purge the previous brand's competitive universe ──────────────────────
-- Category tells us plainly: coffee and supplements are not any current
-- tenant's market. The token-swapped names are relics of a find-and-replace.
delete from public.competitor_brands
 where lower(coalesce(category, '')) in ('coffee', 'supplements', 'functional coffee', 'streetwear beverages')
    or name in (
      'Bird & Colorway', 'Clipper Sneakers', 'Craft Sneaker Company',
      'The Republic of Sneaker', 'Sneaker Forte', 'Sneaker Forté',
      'Buddha Sneakers', 'Sneaker Drops', 'Tiesta Sneaker', 'The Sneaker Spot'
    );

-- The same relics leak through the captured-email and ads tables.
do $$
begin
  if to_regclass('public.competitor_emails_classified') is not null then
    delete from public.competitor_emails_classified
     where lower(coalesce(brand, '')) similar to '%(coffee|espresso|tea|supplement|collagen)%';
  end if;
end $$;

-- ── 2. Scope the remaining brand-content tables ─────────────────────────────
do $$
declare
  t text;
  first_ws uuid;
begin
  select id into first_ws from public.brand_workspaces order by created_at asc limit 1;

  foreach t in array array[
    'competitor_brands', 'competitor_emails_classified', 'competitor_landing_pages',
    'ci_ads', 'ci_emails', 'ci_funnels', 'ci_landing_pages', 'ci_offers',
    'ci_screenshots', 'ci_creative_tags', 'ci_asset_versions',
    'kb_campaigns', 'kb_files', 'kb_top_emails', 'kb_daily_digest',
    'cohorts', 'calendar_slots', 'campaign_specs', 'calendar_feedback',
    'social_posts_generated', 'smart_products', 'smart_campaigns',
    'smart_generated_assets', 'smart_cohorts', 'smart_orders', 'smart_users',
    'smart_events', 'smart_competitor_campaigns', 'smart_competitor_signals',
    'smart_sales_history', 'smart_festivals', 'smart_funnels',
    'klaviyo_campaigns', 'klaviyo_events', 'klaviyo_metrics', 'klaviyo_segments',
    'shopify_orders', 'webengage_events', 'performance_metrics',
    'pagedeck_pages', 'pagedeck_experiments', 'pagedeck_competitor_pages',
    'mvt_experiments', 'saved_items', 'uploaded_files'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;

    execute format('alter table public.%I add column if not exists workspace_id uuid', t);
    execute format('create index if not exists %I on public.%I (workspace_id)', t || '_ws_idx', t);

    -- Existing rows predate multi-brand, so they belong to tenant zero.
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

    execute format('drop policy if exists %I on public.%I', t || '_ws_delete', t);
    execute format($f$create policy %I on public.%I for delete
      using (workspace_id is not null and public.is_brand_member(workspace_id::uuid, auth.uid()))$f$, t || '_ws_delete', t);
  end loop;
end $$;

-- ── 3. Widen the unscoped-content report ────────────────────────────────────
create or replace view public.v_unscoped_content as
select table_name, unscoped_rows from (
  select 'kb_knowledge' as table_name, count(*) as unscoped_rows from public.kb_knowledge where workspace_id is null
  union all select 'brand_assets', count(*) from public.brand_assets where workspace_id is null
  union all select 'smart_calendar_entries', count(*) from public.smart_calendar_entries where workspace_id is null
  union all select 'ads_generated', count(*) from public.ads_generated where workspace_id is null
  union all select 'landing_pages_generated', count(*) from public.landing_pages_generated where workspace_id is null
  union all select 'mailers_generated', count(*) from public.mailers_generated where workspace_id is null
  union all select 'competitor_brands', count(*) from public.competitor_brands where workspace_id is null
  union all select 'cohorts', count(*) from public.cohorts where workspace_id is null
) s
where unscoped_rows > 0;
