-- ============================================================================
-- 20260809160000_catalog_replace_txn.sql
-- Make a replacement catalog import genuinely atomic.
--
-- The previous "stage and swap" did not actually stage. PostgREST has no
-- multi-statement transaction, so the import wrote rows in 500-row chunks with
-- `resolution=merge-duplicates` and deleted the leftovers afterwards. Because
-- the unique key is (workspace_id, region, handle, sku), an upsert OVERWRITES a
-- matching existing row in place. A failure after the first chunk therefore
-- left a mixture of old, overwritten and newly inserted rows, and skipping the
-- final delete could not restore what had already been changed.
--
-- The only way to get all-or-nothing here is to do the delete and the insert
-- inside ONE database call, which is one transaction. This function takes the
-- whole row set as jsonb and swaps the region's catalog atomically: if any row
-- fails, the whole statement rolls back and the previous catalog is untouched.
--
-- Rows are capped at 5000 by the caller (MAX_CATALOG_ROWS), so the payload
-- stays within a reasonable request size.
-- ============================================================================

create or replace function public.brand_catalog_replace(
  p_workspace uuid,
  p_region    text,
  p_rows      jsonb,
  p_batch     uuid default gen_random_uuid()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_deleted  int := 0;
begin
  -- Authorization is NOT inherited from the caller here (SECURITY DEFINER), so
  -- it must be checked explicitly: only an owner or editor may replace a
  -- workspace's catalog.
  if not public.is_brand_editor(p_workspace, auth.uid()) then
    raise exception 'not authorized to write this workspace''s catalog'
      using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a jsonb array';
  end if;

  -- One transaction: the old region is cleared and the new set written
  -- together. Any failure below rolls the delete back with it.
  delete from public.brand_catalog_products
   where workspace_id = p_workspace and region = p_region;
  get diagnostics v_deleted = row_count;

  insert into public.brand_catalog_products (
    workspace_id, region, sku, handle, title, description, product_type,
    collections, price, compare_at, currency, image_url, product_url,
    in_stock, tags, raw, source, import_batch
  )
  select
    p_workspace,
    p_region,
    nullif(r->>'sku', ''),
    nullif(r->>'handle', ''),
    r->>'title',
    nullif(r->>'description', ''),
    nullif(r->>'product_type', ''),
    coalesce(r->'collections', '[]'::jsonb),
    nullif(r->>'price', '')::numeric,
    nullif(r->>'compare_at', '')::numeric,
    nullif(r->>'currency', ''),
    nullif(r->>'image_url', ''),
    nullif(r->>'product_url', ''),
    case when r->>'in_stock' is null then null else (r->>'in_stock')::boolean end,
    coalesce(r->'tags', '[]'::jsonb),
    coalesce(r->'raw', '{}'::jsonb),
    coalesce(nullif(r->>'source', ''), 'manual'),
    p_batch
  from jsonb_array_elements(p_rows) as r
  where coalesce(r->>'title', '') <> ''
  on conflict (workspace_id, region, handle, sku) do nothing;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'ok', true, 'inserted', v_inserted, 'deleted', v_deleted,
    'batch', p_batch, 'region', p_region
  );
end $$;

comment on function public.brand_catalog_replace is
  'Atomically replace one region of a brand catalog. Delete + insert run in a single transaction, so a partial failure leaves the previous catalog intact. Checks is_brand_editor() explicitly because SECURITY DEFINER bypasses RLS.';

-- Callable by a signed-in user: the function does its own authorization check
-- and is scoped to the workspace passed in.
do $$ begin
  revoke all on function public.brand_catalog_replace(uuid, text, jsonb, uuid) from public, anon;
  grant execute on function public.brand_catalog_replace(uuid, text, jsonb, uuid) to authenticated, service_role;
end $$;
