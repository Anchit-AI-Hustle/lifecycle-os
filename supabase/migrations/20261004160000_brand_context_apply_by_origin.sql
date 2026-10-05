-- ============================================================================
-- 20261004160000_brand_context_apply_by_origin.sql
-- A save's lower-priority values are applied IN THE DATABASE, under the row
-- lock, by origin - never PATCHed first and checked after.
--
-- THE DEFECT (review of PR #127, 2026-10-04). The wizard's save PATCHed the
-- whole row - including fields whose value came from a brand guideline
-- document, a site read or a template - and only then asked
-- brand_fields_record_origin() whether that origin was allowed to win. Two
-- tabs: tab B saves a tagline the person TYPED (claimed `user`); tab A, opened
-- earlier, applies a guideline document and saves. A's PATCH wrote the
-- document's tagline over B's, then the provenance check correctly kept
-- `user` - so the database said a person typed a value no person typed, and
-- the value they did type was gone.
--
-- THE FIX. brand_context_apply() - already the ONE door an automatic value
-- comes through - takes the ORIGIN of each value (p_source -> field ->
-- 'origin', default 'auto', the site parser, exactly as every existing caller
-- sends it) and refuses a field whose recorded owner OUTRANKS that origin,
-- under a row lock on the workspace, so two saves cannot both read "nobody
-- owns it" and both write. The save path (brand-workspace-core.saveWorkspace)
-- PATCHes only what the person typed (the other fields keep the row's own
-- values, and the PATCH is conditional on the row's updated_at, retried on a
-- concurrent write), then sends every other carried field here.
--
--   user 50 > document 40 > site-render 30 > site-parse 20 (= auto) > preset 10
--
-- An equal rank replaces (a newer document replaces an older one; a fresh
-- site read replaces the last). `voice.banned` stays closed to every site
-- read (20260814100000's rule: it can never be machine-filled) and opens only
-- for a source a person chose: a guideline document they uploaded, or a
-- template they picked.
--
-- For an existing caller (the context pack, Suggest options) nothing changes:
-- no origin is sent, so it is `auto`, and `auto` is refused by exactly the
-- owners it was refused by before (user, document, site-render).
--
-- Additive and idempotent, like every migration here.
-- ============================================================================

create or replace function public.brand_context_apply(
  p_workspace uuid,
  p_fields    jsonb,
  p_source    jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  v jsonb;
  owner_origin text;
  inc text;
  leaf text;
  txt text;
  applied  text[] := '{}';
  skipped  text[] := '{}';
  ignored  text[] := '{}';
  kept jsonb := '[]'::jsonb;
  src jsonb;
begin
  if p_workspace is null then
    return jsonb_build_object('ok', false, 'error', 'workspace_required');
  end if;
  if not public.is_brand_editor(p_workspace, auth.uid()) then
    raise exception 'not an editor of this workspace';
  end if;

  -- One writer at a time per brand: the owner check and the write below see
  -- the same state, so two concurrent saves cannot both read "nobody owns it".
  perform 1 from public.brand_workspaces where id = p_workspace for update;

  for k, v in select key, value from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
    src := coalesce(p_source -> k, '{}'::jsonb);
    inc := coalesce(nullif(src ->> 'origin', ''), 'auto');
    if inc not in ('auto', 'site-parse', 'site-render', 'document', 'preset') then
      ignored := ignored || k;
      continue;
    end if;

    -- 4a. Does a person, or a source that outranks this one, own it?
    owner_origin := null;
    select origin into owner_origin
      from public.brand_field_provenance
     where workspace_id = p_workspace and field = k
       for update;
    if owner_origin is not null
       and public.brand_origin_rank(owner_origin) > public.brand_origin_rank(inc) then
      skipped := skipped || k;
      kept := kept || jsonb_build_object('field', k, 'origin', owner_origin);
      continue;
    end if;

    txt := case when jsonb_typeof(v) = 'string' then (v #>> '{}') else v::text end;

    if k in ('name', 'tagline', 'legal_name', 'industry', 'website', 'logo_url', 'favicon_url') then
      if txt is null or length(txt) = 0 then
        ignored := ignored || k;
        continue;
      end if;
      execute format('update public.brand_workspaces set %I = $1, updated_at = now() where id = $2', k)
        using txt, p_workspace;

    elsif k like 'palette.%' then
      leaf := split_part(k, '.', 2);
      if leaf not in ('primary', 'accent', 'ink', 'surface', 'surface_alt', 'muted') then
        ignored := ignored || k;
        continue;
      end if;
      update public.brand_workspaces
         set palette = jsonb_set(coalesce(palette, '{}'::jsonb), array[leaf], to_jsonb(txt), true),
             updated_at = now()
       where id = p_workspace;

    elsif k like 'typography.%' then
      leaf := split_part(k, '.', 2);
      if leaf not in ('heading', 'body', 'mono') then
        ignored := ignored || k;
        continue;
      end if;
      update public.brand_workspaces
         set typography = jsonb_set(coalesce(typography, '{}'::jsonb), array[leaf], v, true),
             updated_at = now()
       where id = p_workspace;

    elsif k like 'voice.%' then
      leaf := split_part(k, '.', 2);
      if not (leaf in ('tone', 'preferred', 'notes')
              or (leaf = 'banned' and inc in ('document', 'preset'))) then
        ignored := ignored || k;
        continue;
      end if;
      update public.brand_workspaces
         set voice = jsonb_set(coalesce(voice, '{}'::jsonb), array[leaf], v, true),
             updated_at = now()
       where id = p_workspace;

    elsif k like 'brand_data.%' then
      leaf := split_part(k, '.', 2);
      if leaf not in ('claims', 'social', 'legal_entity', 'context_pack', 'repositories') then
        ignored := ignored || k;
        continue;
      end if;
      update public.brand_workspaces
         set brand_data = jsonb_set(coalesce(brand_data, '{}'::jsonb), array[leaf], v, true),
             updated_at = now()
       where id = p_workspace;

    elsif k = 'regions' then
      update public.brand_workspaces set regions = v, updated_at = now() where id = p_workspace;

    else
      ignored := ignored || k;
      continue;
    end if;

    insert into public.brand_field_provenance
      (workspace_id, field, origin, source_url, signal, confidence, value_preview, set_by, set_at)
    values
      (p_workspace, k, inc, left(src ->> 'source_url', 500), left(src ->> 'signal', 500),
       left(src ->> 'confidence', 40), left(coalesce(src ->> 'value_preview', txt), 200), auth.uid(), now())
    on conflict (workspace_id, field) do update
      set origin = excluded.origin, source_url = excluded.source_url, signal = excluded.signal,
          confidence = excluded.confidence, value_preview = excluded.value_preview,
          set_by = excluded.set_by, set_at = now();

    applied := applied || k;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'applied', to_jsonb(applied),
    'skipped_user_owned', to_jsonb(skipped),
    'kept', kept,
    'ignored_not_applicable', to_jsonb(ignored)
  );
end;
$$;

grant execute on function public.brand_context_apply(uuid, jsonb, jsonb) to authenticated;
