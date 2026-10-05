-- ============================================================================
-- 20261004170000_brand_workspace_save.sql
-- Saving an existing brand is ONE decision written in ONE statement:
-- claim + precedence + write, atomically, under the row lock.
--
-- Review of PR #143 (2026-10-04) found three ways the save that
-- 20261004160000 introduced could still go wrong, all from doing in several
-- requests what must be one decision:
--   * the typed fields were claimed (committed) before a write that could then
--     fail - a refused save left a field marked as the person's for a value
--     that was never saved, and later document/site values were refused for it;
--   * the wizard's placeholders (origin 'default') still rode the PATCH, so a
--     stale tab wrote one over a value another tab took from a document;
--   * the design rules judged the INCOMING values, so a stale tab's document
--     colour that precedence would refuse still rejected the whole save.
--
-- The caller (api/_shared/brand-workspace-core.js saveExisting) reads the row
-- and who owns each field, works out the EFFECTIVE row - what the person
-- typed; each other source's value only where it ranks at least as high as
-- the recorded owner; the row's own value everywhere else, placeholders
-- included - and validates THAT with the same design rules as before. This
-- function then, under the row lock:
--   1. answers `stale` (the caller decides again) if the row, or any owner the
--      decision rested on, changed since it was read - an owner can change
--      without the row (brand_fields_claim_user from the context pack);
--   2. refuses (`precedence`) to record any applied value over an owner that
--      outranks it, whatever the caller decided;
--   3. writes the effective row (only the record's own columns; never id,
--      owner, created/updated stamps), claims the typed fields as `user` and
--      records each applied value's origin - in the SAME transaction, so a
--      refused write claims nothing.
-- Who may save is the table's own update policy: the owner.
--
-- Additive and idempotent, like every migration here.
-- ============================================================================

create or replace function public.brand_workspace_save(
  p_workspace uuid,
  p_expected  timestamptz,
  p_seen      jsonb,
  p_row       jsonb,
  p_typed     text[],
  p_origins   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w   public.brand_workspaces%rowtype;
  r   public.brand_workspaces%rowtype;
  k   text;
  v   jsonb;
  have text;
  o   text;
begin
  if p_workspace is null then
    return jsonb_build_object('ok', false, 'error', 'workspace_required');
  end if;
  select * into w from public.brand_workspaces where id = p_workspace for update;
  if not found or w.owner_id is distinct from auth.uid() then
    -- Not found and not yours read the same, as RLS reads them.
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_expected is not null and w.updated_at is distinct from p_expected then
    return jsonb_build_object('ok', false, 'error', 'stale', 'reason', 'row');
  end if;
  for k, v in select key, value from jsonb_each(coalesce(p_seen, '{}'::jsonb)) loop
    have := null;
    select origin into have from public.brand_field_provenance where workspace_id = p_workspace and field = k;
    if have is distinct from nullif(v #>> '{}', '') then
      return jsonb_build_object('ok', false, 'error', 'stale', 'reason', 'owner', 'field', k);
    end if;
  end loop;

  -- Belt and braces: whatever the caller decided, no applied value is
  -- recorded over an owner that outranks it - the statement refuses instead.
  for k, v in select key, value from jsonb_each(coalesce(p_origins, '{}'::jsonb)) loop
    have := null;
    select origin into have from public.brand_field_provenance where workspace_id = p_workspace and field = k;
    if have is not null and public.brand_origin_rank(have) > public.brand_origin_rank(coalesce(v ->> 'origin', '')) then
      return jsonb_build_object('ok', false, 'error', 'precedence', 'field', k, 'owner', have);
    end if;
  end loop;

  r := jsonb_populate_record(w, coalesce(p_row, '{}'::jsonb));
  update public.brand_workspaces set
    slug = r.slug, name = r.name, legal_name = r.legal_name, tagline = r.tagline, industry = r.industry,
    website = r.website, logo_url = r.logo_url, favicon_url = r.favicon_url,
    palette = r.palette, typography = r.typography, voice = r.voice, regions = r.regions,
    asset_hosts = r.asset_hosts, catalog_source = r.catalog_source, brand_data = r.brand_data,
    status = r.status, onboarding_step = r.onboarding_step, updated_at = now()
  where id = p_workspace
  returning * into r;

  foreach k in array coalesce(p_typed, '{}'::text[]) loop
    if k is null or length(k) = 0 or length(k) > 80 then continue; end if;
    insert into public.brand_field_provenance (workspace_id, field, origin, signal, set_by, set_at)
    values (p_workspace, k, 'user', 'supplied by the operator', auth.uid(), now())
    on conflict (workspace_id, field) do update
      set origin = 'user', signal = 'supplied by the operator', source_url = null, confidence = null,
          value_preview = null, set_by = auth.uid(), set_at = now();
  end loop;

  for k, v in select key, value from jsonb_each(coalesce(p_origins, '{}'::jsonb)) loop
    o := coalesce(v ->> 'origin', '');
    if k is null or length(k) = 0 or length(k) > 80
       or o not in ('document', 'site-render', 'site-parse', 'preset') then
      continue;
    end if;
    insert into public.brand_field_provenance
      (workspace_id, field, origin, source_url, signal, confidence, value_preview, set_by, set_at)
    values
      (p_workspace, k, o, left(v ->> 'source_url', 500), left(v ->> 'signal', 500),
       left(v ->> 'confidence', 40), left(v ->> 'value_preview', 200), auth.uid(), now())
    on conflict (workspace_id, field) do update
      set origin = excluded.origin, source_url = excluded.source_url, signal = excluded.signal,
          confidence = excluded.confidence, value_preview = excluded.value_preview,
          set_by = excluded.set_by, set_at = now();
  end loop;

  return jsonb_build_object('ok', true, 'row', to_jsonb(r));
end;
$$;

revoke all on function public.brand_workspace_save(uuid, timestamptz, jsonb, jsonb, text[], jsonb) from public, anon;
grant execute on function public.brand_workspace_save(uuid, timestamptz, jsonb, jsonb, text[], jsonb) to authenticated;
