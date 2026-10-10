-- ============================================================================
-- 20261010002000_catalog_import_merge.sql
-- A catalogue import UPSERTS, never duplicates, never silently deletes, and
-- resumes where an invocation ran out.
--
-- Measured on 2026-10-10 (tests/catalog-import-complete.spec.js):
--   * brand_catalog_replace() deleted the region and re-inserted it, so a
--     product the source stopped listing simply vanished, and the generators
--     could not tell "discontinued" from "never imported";
--   * the table's unique key (workspace_id, region, handle, sku) treats NULL as
--     distinct, so every row with no sku could be inserted twice by an additive
--     import;
--   * catalog_source was written with a PATCH on brand_workspaces, whose update
--     policy is OWNER only: an editor's import wrote its rows and then recorded
--     nothing about where they came from (a 204 with zero rows changed);
--   * a store too large for one invocation had nowhere to keep its place.
--
-- brand_catalog_merge() is the one door now:
--   - upsert by (workspace, region, handle, sku) with NULL equal to NULL, under a
--     per-(workspace, region) advisory lock so two concurrent steps cannot both
--     insert the same product;
--   - every row it writes is stamped with the import RUN and stale_at cleared;
--   - when the run has read the WHOLE source (p_complete), every row of the
--     same source family the run did not see is marked stale_at = now(). Kept,
--     never deleted: a product that disappeared is a fact about the store, and
--     deleting it would also delete the evidence;
--   - the import state (cursor + coverage) and catalog_source are written on the
--     brand's own row in the SAME transaction, for an editor as for the owner.
-- Editors and owners only (is_brand_editor); a call with no user is the service
-- role (the daily refresh) - execute is revoked from anon and public.
-- ============================================================================

alter table public.brand_catalog_products
  add column if not exists image_urls    jsonb not null default '[]'::jsonb,
  add column if not exists variants      jsonb not null default '[]'::jsonb,
  add column if not exists source_url    text,
  add column if not exists last_seen_run uuid,
  add column if not exists last_seen_at  timestamptz,
  add column if not exists stale_at      timestamptz,
  add column if not exists updated_at    timestamptz;

create index if not exists brand_catalog_live_idx
  on public.brand_catalog_products (workspace_id, region) where stale_at is null;

comment on column public.brand_catalog_products.stale_at is
  'Set when a COMPLETE re-import of the same source no longer listed this product. The row is kept; readers that build assets skip it.';
comment on column public.brand_catalog_products.image_urls is
  'Every image the source states for this product, in its order. image_url is the first.';
comment on column public.brand_catalog_products.variants is
  'Every variant the source states: [{id, sku, title, price, compare_at, available}]. Nothing is filled in.';

-- The import's place in a source too large for one invocation, and its coverage.
-- Not in the columns every brand read selects, so a long cursor costs nothing
-- outside the importer.
alter table public.brand_workspaces
  add column if not exists catalog_import jsonb not null default '{}'::jsonb;

create or replace function public.brand_catalog_merge(
  p_workspace uuid,
  p_region    text,
  p_rows      jsonb,
  p_run       uuid,
  p_complete  boolean default false,
  p_family    text[]  default array['shopify_public','sitemap_jsonld','site_crawl'],
  p_state     jsonb   default null,
  p_source    jsonb   default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          jsonb;
  v_inserted int := 0;
  v_updated  int := 0;
  v_stale    int := 0;
  v_hit      int;
  v_handle   text;
  v_sku      text;
begin
  -- SECURITY DEFINER bypasses RLS, so the check is explicit: a signed-in caller
  -- must be an editor of THIS workspace. A call with no user can only be the
  -- service role (execute is not granted to anon).
  if auth.uid() is not null and not public.is_brand_editor(p_workspace, auth.uid()) then
    raise exception 'not authorized to write this workspace''s catalog' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a jsonb array';
  end if;
  if p_run is null then
    raise exception 'p_run is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('brand_catalog:' || p_workspace::text || ':' || coalesce(p_region, '')));

  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'title', '') = '' then continue; end if;
    v_handle := nullif(r->>'handle', '');
    v_sku    := nullif(r->>'sku', '');
    update public.brand_catalog_products set
      title        = r->>'title',
      description  = nullif(r->>'description', ''),
      product_type = nullif(r->>'product_type', ''),
      collections  = coalesce(r->'collections', '[]'::jsonb),
      price        = nullif(r->>'price', '')::numeric,
      compare_at   = nullif(r->>'compare_at', '')::numeric,
      currency     = nullif(r->>'currency', ''),
      image_url    = nullif(r->>'image_url', ''),
      image_urls   = coalesce(r->'image_urls', '[]'::jsonb),
      variants     = coalesce(r->'variants', '[]'::jsonb),
      product_url  = nullif(r->>'product_url', ''),
      in_stock     = case when r->>'in_stock' is null then null else (r->>'in_stock')::boolean end,
      tags         = coalesce(r->'tags', '[]'::jsonb),
      raw          = coalesce(r->'raw', '{}'::jsonb),
      source       = coalesce(nullif(r->>'source', ''), 'manual'),
      source_url   = nullif(r->>'source_url', ''),
      import_batch = p_run,
      last_seen_run = p_run,
      last_seen_at  = now(),
      stale_at      = null,
      updated_at    = now()
    where workspace_id = p_workspace and region = p_region
      and handle is not distinct from v_handle and sku is not distinct from v_sku;
    get diagnostics v_hit = row_count;
    if v_hit > 0 then
      v_updated := v_updated + 1;
    else
      insert into public.brand_catalog_products (
        workspace_id, region, sku, handle, title, description, product_type, collections,
        price, compare_at, currency, image_url, image_urls, variants, product_url, in_stock,
        tags, raw, source, source_url, import_batch, last_seen_run, last_seen_at, stale_at, updated_at
      ) values (
        p_workspace, p_region, v_sku, v_handle, r->>'title', nullif(r->>'description', ''),
        nullif(r->>'product_type', ''), coalesce(r->'collections', '[]'::jsonb),
        nullif(r->>'price', '')::numeric, nullif(r->>'compare_at', '')::numeric, nullif(r->>'currency', ''),
        nullif(r->>'image_url', ''), coalesce(r->'image_urls', '[]'::jsonb), coalesce(r->'variants', '[]'::jsonb),
        nullif(r->>'product_url', ''),
        case when r->>'in_stock' is null then null else (r->>'in_stock')::boolean end,
        coalesce(r->'tags', '[]'::jsonb), coalesce(r->'raw', '{}'::jsonb),
        coalesce(nullif(r->>'source', ''), 'manual'), nullif(r->>'source_url', ''),
        p_run, p_run, now(), null, now()
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  if p_complete then
    update public.brand_catalog_products set stale_at = now()
     where workspace_id = p_workspace and region = p_region
       and stale_at is null
       and last_seen_run is distinct from p_run
       and source = any(p_family);
    get diagnostics v_stale = row_count;
  end if;

  if p_state is not null or p_source is not null then
    update public.brand_workspaces set
      catalog_import = coalesce(p_state, catalog_import),
      catalog_source = coalesce(p_source, catalog_source)
     where id = p_workspace;
  end if;

  return jsonb_build_object(
    'ok', true, 'inserted', v_inserted, 'updated', v_updated, 'staled', v_stale,
    'run', p_run, 'region', p_region,
    'live', (select count(*) from public.brand_catalog_products where workspace_id = p_workspace and region = p_region and stale_at is null)
  );
end $$;

comment on function public.brand_catalog_merge is
  'Upsert one step of a catalogue import (NULL sku/handle equal), mark rows the source no longer lists stale once the run is complete (never delete), and record the import state on the brand row in the same transaction. Editors/owners, or the service role.';

do $$ begin
  revoke all on function public.brand_catalog_merge(uuid, text, jsonb, uuid, boolean, text[], jsonb, jsonb) from public, anon;
  grant execute on function public.brand_catalog_merge(uuid, text, jsonb, uuid, boolean, text[], jsonb, jsonb) to authenticated, service_role;
end $$;
