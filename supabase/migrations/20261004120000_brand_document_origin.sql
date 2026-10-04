-- ============================================================================
-- 20261004120000_brand_document_origin.sql
-- A brand GUIDELINE DOCUMENT is the brand's own declaration, so a value it
-- states outranks anything read off the website - and still loses to what a
-- person typed.
--
-- THE ORDER (one list, the same in SQL, api/_shared/brand-workspace-core.js and
-- brand-context.js's device store):
--
--   user        50  typed by the operator, or an explicit choice between two
--                   sources (a conflict the operator resolved is THEIR answer)
--   document    40  stated in a brand book / DESIGN.md / token file the
--                   operator uploaded or linked (onboarding "Upload my brand
--                   guidelines")
--   site-render 30  read off the brand's site in a real browser
--   site-parse  20  read off the brand's site by the CSS/HTML parser; `auto`
--                   is the name 20260814100000 gave it and is kept as an alias
--   preset      10  a starter profile from the gallery
--
-- WHY IN THE DATABASE. brand_context_apply() is the ONE door an automatic value
-- may come through (20260814100000). It refused only `user`. A document the
-- operator uploaded and applied would have been claimed `user` by the next
-- wizard save (claimedFields() claims every field a save carries) - right for
-- the refusal, wrong for the record, which then could not say where the value
-- came from. So the origin is recorded as `document`, and the door refuses
-- every origin that outranks the site parser, by RANK, so a later "Read my
-- site" (or a context pack built tomorrow) can never overwrite a value the
-- document gave. Same rule as before, one rung higher.
--
-- brand_fields_record_origin() is the save-time twin of
-- brand_fields_claim_user(): the wizard's save carries, per field, which source
-- its value came from (brand_data.field_origins), and a non-user origin is
-- recorded here instead of being claimed as typed. It NEVER demotes: a field a
-- person owns stays theirs, and a document's value is not replaced by a site's.
--
-- Additive and idempotent, like every migration here.
-- ============================================================================

-- ── 1. the origins the provenance row may name ──────────────────────────────
alter table public.brand_field_provenance
  drop constraint if exists brand_field_provenance_origin_check;
alter table public.brand_field_provenance
  add constraint brand_field_provenance_origin_check
  check (origin in ('user', 'document', 'site-render', 'site-parse', 'auto', 'preset'));

-- ── 2. the rank, in one place ───────────────────────────────────────────────
create or replace function public.brand_origin_rank(p_origin text)
returns int
language sql
immutable
as $$
  select case p_origin
    when 'user'        then 50
    when 'document'    then 40
    when 'site-render' then 30
    when 'site-parse'  then 20
    when 'auto'        then 20
    when 'preset'      then 10
    else 0
  end;
$$;

-- ── 3. the automatic door refuses anything that outranks the site parser ─────
-- The body is 20260814100000's, verbatim, except 4a: the refusal is by rank
-- (user, document, site-render) instead of the one literal 'user'.
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
  leaf text;
  txt text;
  applied  text[] := '{}';
  skipped  text[] := '{}';
  ignored  text[] := '{}';
  src jsonb;
begin
  if p_workspace is null then
    return jsonb_build_object('ok', false, 'error', 'workspace_required');
  end if;
  if not public.is_brand_editor(p_workspace, auth.uid()) then
    raise exception 'not an editor of this workspace';
  end if;

  for k, v in select key, value from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
    -- 4a. Does a person, or a source that outranks the site parser, own it?
    owner_origin := null;
    select origin into owner_origin
      from public.brand_field_provenance
     where workspace_id = p_workspace and field = k;
    if owner_origin is not null
       and public.brand_origin_rank(owner_origin) > public.brand_origin_rank('auto') then
      skipped := skipped || k;
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
      if leaf not in ('tone', 'preferred', 'notes') then
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

    src := coalesce(p_source -> k, '{}'::jsonb);
    insert into public.brand_field_provenance
      (workspace_id, field, origin, source_url, signal, confidence, value_preview, set_by, set_at)
    values
      (p_workspace, k, 'auto', src ->> 'source_url', src ->> 'signal', src ->> 'confidence',
       left(txt, 200), auth.uid(), now())
    on conflict (workspace_id, field) do update
      set origin = 'auto', source_url = excluded.source_url, signal = excluded.signal,
          confidence = excluded.confidence, value_preview = excluded.value_preview,
          set_by = excluded.set_by, set_at = now();

    applied := applied || k;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'applied', to_jsonb(applied),
    'skipped_user_owned', to_jsonb(skipped),
    'ignored_not_applicable', to_jsonb(ignored)
  );
end;
$$;

-- ── 4. a save records WHERE a non-typed value came from ─────────────────────
-- p_fields: { "<dotted field>": { "origin": "document", "source_url": "...",
--             "signal": "...", "confidence": "...", "value_preview": "..." } }
-- Only the non-user origins are accepted here (a person's claim goes through
-- brand_fields_claim_user, unchanged). A row is written when there is none, or
-- when the new origin ranks AT LEAST as high as the one recorded - so a newer
-- document replaces an older one, and nothing lower ever replaces anything
-- higher. Never a demotion: `kept` lists what was left alone, and by whom.
create or replace function public.brand_fields_record_origin(p_workspace uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  v jsonb;
  o text;
  have text;
  recorded text[] := '{}';
  kept jsonb := '[]'::jsonb;
  ignored text[] := '{}';
begin
  if p_workspace is null or p_fields is null then
    return jsonb_build_object('ok', false, 'error', 'workspace_required');
  end if;
  if not public.is_brand_editor(p_workspace, auth.uid()) then
    raise exception 'not an editor of this workspace';
  end if;
  for k, v in select key, value from jsonb_each(p_fields) loop
    o := coalesce(v ->> 'origin', '');
    if k is null or length(k) = 0 or length(k) > 80
       or o not in ('document', 'site-render', 'site-parse', 'preset') then
      ignored := ignored || k;
      continue;
    end if;
    have := null;
    select origin into have from public.brand_field_provenance
     where workspace_id = p_workspace and field = k;
    if have is not null and public.brand_origin_rank(have) > public.brand_origin_rank(o) then
      kept := kept || jsonb_build_object('field', k, 'origin', have);
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
    recorded := recorded || k;
  end loop;
  return jsonb_build_object('ok', true, 'recorded', to_jsonb(recorded), 'kept', kept, 'ignored', to_jsonb(ignored));
end;
$$;

grant execute on function public.brand_origin_rank(text) to authenticated;
grant execute on function public.brand_fields_record_origin(uuid, jsonb) to authenticated;

-- ── 5. Storage: the brand's own files (logo, icon, fonts, imagery, guide) ────
-- Generated mailers and ads must reference a HOSTED https URL: the
-- email.mailer contract BLOCKS embedded base64 (Gmail clips past ~102KB). A
-- signed-in account with a reachable project uploads here, from the browser,
-- with its own token; the key is `<workspace_id>/<sha256 of the bytes>.<ext>`,
-- the same shape as brand-review-media, so the first path segment scopes every
-- write and the hash makes a re-upload idempotent.
--
-- Reads are public because the URL is embedded in mailers that render outside
-- any session. Only files the operator chose to upload as their brand's are
-- placed here. Writes are EDITOR-scoped (a viewer may not replace a brand's
-- logo), checked against the same first path segment.
insert into storage.buckets (id, name, public)
values ('brand-assets', 'brand-assets', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'brand_assets_public_read'
  ) then
    create policy "brand_assets_public_read"
      on storage.objects for select
      using (bucket_id = 'brand-assets');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'brand_assets_editor_write'
  ) then
    create policy "brand_assets_editor_write"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'brand-assets'
        and public.is_brand_editor((storage.foldername(name))[1]::uuid, auth.uid())
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'brand_assets_editor_update'
  ) then
    create policy "brand_assets_editor_update"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'brand-assets'
        and public.is_brand_editor((storage.foldername(name))[1]::uuid, auth.uid())
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'brand_assets_editor_delete'
  ) then
    create policy "brand_assets_editor_delete"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'brand-assets'
        and public.is_brand_editor((storage.foldername(name))[1]::uuid, auth.uid())
      );
  end if;
end $$;
