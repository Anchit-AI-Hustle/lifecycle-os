-- ============================================================================
-- 20260814100000_brand_context_packs.sql
-- The per-brand CONTEXT PACK, and the precedence rule that protects what the
-- user typed from a later automatic run.
--
-- WHAT A PACK IS
-- When a brand is onboarded with a URL, the platform reads that brand off its
-- own site and files the result as ONE record: a design.md, a knowledge base
-- built from that domain and nothing else, a catalogue, and a GitHub repository
-- search. That record is the brand's standing context for every feature.
--
-- KEYED TO URL **AND** NAME
-- `brand_key` is generated from the site host and the folded brand name, and is
-- unique per workspace. Three consequences, all deliberate:
--   * Re-running for the same brand UPDATES the pack instead of duplicating it.
--   * Two workspaces whose brands share a name never collide - workspace_id is
--     part of the key.
--   * Moving a brand to a different domain, or renaming it, starts a NEW pack
--     rather than silently overwriting the one describing the old site. A pack
--     is a report about a specific site on a specific day; overwriting it with
--     a report about a different site would destroy the provenance that makes
--     every value in it checkable.
--
-- ZERO FABRICATION (docs/campaign-orchestration-master-spec.md)
-- Nothing in a pack is invented. Every stored fact carries the URL it was read
-- from and the signal that produced it, and a field the site did not publish is
-- stored as a [DATA REQUIRED BEFORE LAUNCH: …] marker in `markers`, never as a
-- plausible value. The GitHub search records whether it could reach GitHub at
-- all, so "no repositories" and "not searched" are never confused.
--
-- Conventions from prior migrations: public schema, RLS on, additive and
-- idempotent, member-read / editor-write via is_brand_member + is_brand_editor.
-- ============================================================================

-- ── 1. brand_context_packs ──────────────────────────────────────────────────
create table if not exists public.brand_context_packs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,

  -- The key. site_host is the brand URL's host with a leading www. removed;
  -- folded_name is the brand name reduced to [a-z0-9]. Both are written by the
  -- application (api/_shared/brand-context-pack.js packKey) so the same brand
  -- always folds the same way.
  site_url      text not null,
  site_host     text not null,
  brand_name    text not null,
  folded_name   text not null,
  brand_key     text generated always as (site_host || '|' || folded_name) stored,

  -- Queue state. A whole-site crawl, a catalogue import and a knowledge ingest
  -- do not fit one serverless invocation, so the pack row IS the queue: one
  -- stage advances per call, `queue_state` carries the resumable cursor, and the
  -- worker re-fires itself until stage = 'done'. Same shape as the smart-brain
  -- prebuild chain (api/_shared/smart-brain-plan.js prebuildAssets).
  status        text not null default 'queued',    -- queued | running | complete | failed
  stage         text not null default 'extract',   -- extract | catalog | knowledge | repos | done
  queue_state   jsonb not null default '{}'::jsonb,
  attempts      int  not null default 0,
  batches       int  not null default 0,
  last_error    text,

  -- The pack itself.
  design_md     text,                               -- the rendered design.md
  design        jsonb not null default '{}'::jsonb, -- structured design facts + their sources
  knowledge     jsonb not null default '{}'::jsonb, -- ingest manifest: pages, counts, refusals
  catalog       jsonb not null default '{}'::jsonb, -- import result + provenance
  repos         jsonb not null default '{}'::jsonb, -- GitHub search: reachability + candidates
  sources       jsonb not null default '[]'::jsonb, -- every URL this pack touched
  markers       jsonb not null default '[]'::jsonb, -- [DATA REQUIRED BEFORE LAUNCH: …]
  limits        jsonb not null default '[]'::jsonb, -- what the method cannot see (no browser, …)
  log           jsonb not null default '[]'::jsonb, -- per-stage timeline

  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, brand_key)
);

create index if not exists brand_context_packs_ws_idx     on public.brand_context_packs (workspace_id);
create index if not exists brand_context_packs_status_idx on public.brand_context_packs (status)
  where status in ('queued', 'running');

alter table public.brand_context_packs enable row level security;

do $$ begin
  create policy brand_context_packs_read on public.brand_context_packs
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy brand_context_packs_write on public.brand_context_packs
    for all using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 2. brand_field_provenance — who last set each brand field ───────────────
-- The precedence rule the product actually promises is "a field the user typed,
-- or a catalogue they uploaded, is never overwritten by a later automatic run".
-- Left implicit that is a statement about CALL ORDER, and call order is exactly
-- what changes when somebody adds a cron, a retry or a second entry point.
--
-- So it is recorded instead: one row per (workspace, field), naming the ORIGIN
-- of the value currently in brand_workspaces. 'user' means a human supplied or
-- confirmed it. 'auto' means a machine read it off the site.
create table if not exists public.brand_field_provenance (
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,
  field         text not null,              -- dotted path: name, palette.primary, typography.body, catalog
  origin        text not null check (origin in ('user', 'auto')),
  source_url    text,
  signal        text,
  confidence    text,
  value_preview text,
  set_by        uuid,
  set_at        timestamptz not null default now(),
  primary key (workspace_id, field)
);

alter table public.brand_field_provenance enable row level security;

do $$ begin
  create policy brand_field_provenance_read on public.brand_field_provenance
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy brand_field_provenance_write on public.brand_field_provenance
    for all using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 3. brand_fields_claim_user — a human touched these fields ───────────────
-- Called by brand-workspace-core.saveWorkspace() with exactly the fields the
-- operator's save actually carried. A user claim always wins and always
-- overwrites, including over a previous 'auto' claim: the newest human decision
-- is the one that stands.
create or replace function public.brand_fields_claim_user(p_workspace uuid, p_fields text[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  f text;
  n int := 0;
begin
  if p_workspace is null or p_fields is null then return 0; end if;
  if not public.is_brand_editor(p_workspace, auth.uid()) then
    raise exception 'not an editor of this workspace';
  end if;
  foreach f in array p_fields loop
    if f is null or length(f) = 0 then continue; end if;
    insert into public.brand_field_provenance (workspace_id, field, origin, signal, set_by, set_at)
    values (p_workspace, f, 'user', 'supplied by the operator', auth.uid(), now())
    on conflict (workspace_id, field) do update
      set origin = 'user', signal = 'supplied by the operator',
          source_url = null, confidence = null,
          set_by = auth.uid(), set_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ── 4. brand_context_apply — the ONE door an automatic value may come through ─
-- Everything a machine read off a site is applied to the brand record HERE and
-- nowhere else, and this function refuses any field whose provenance says a
-- human owns it. That is what makes the precedence structural rather than a
-- convention: a future caller, cron or retry that forgets the rule cannot get
-- past this function, because the check is inside it.
--
-- A direct PostgREST update of brand_workspaces is still allowed, and is
-- correct: a direct write is a USER write, and a user write is allowed to win.
-- The side that needs constraining is the automatic side, which has one door.
--
-- p_fields is a flat map of dotted path -> jsonb value, e.g.
--   {"tagline": "\"Handbound editions\"", "palette.primary": "\"#1F5FD0\"",
--    "typography.body": {"family":"Inter","stack":"…"}}
-- Anything not on the whitelist below is ignored and reported, so a caller
-- cannot reach an arbitrary column through this function.
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
    -- 4a. Does a human own this field already?
    select origin into owner_origin
      from public.brand_field_provenance
     where workspace_id = p_workspace and field = k;
    if owner_origin = 'user' then
      skipped := skipped || k;
      continue;
    end if;

    txt := case when jsonb_typeof(v) = 'string' then (v #>> '{}') else v::text end;

    -- 4b. Apply, by whitelist. `format('%I')` is only ever handed a literal
    -- from the IN-list below, never the raw key.
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
      -- voice.banned is deliberately NOT applicable: a phrase a brand refuses
      -- to use cannot be observed from the phrases it did use, so no automatic
      -- run may ever populate it.
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

    -- 4c. Record that a MACHINE set it, with the page it came from.
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

-- The two functions are SECURITY DEFINER and check the caller's role
-- themselves, so `authenticated` may execute them. They are the sanctioned
-- doors, not a bypass: neither can write a field the whitelist above does not
-- name, and brand_context_apply can never overwrite a user-owned field.
grant execute on function public.brand_fields_claim_user(uuid, text[]) to authenticated;
grant execute on function public.brand_context_apply(uuid, jsonb, jsonb)  to authenticated;

-- ── 5. Operator view: what is machine-observed vs human-owned, per brand ────
create or replace view public.v_brand_field_origins as
  select w.id            as workspace_id,
         w.name          as brand_name,
         p.field,
         p.origin,
         p.source_url,
         p.signal,
         p.confidence,
         p.set_at
    from public.brand_workspaces w
    join public.brand_field_provenance p on p.workspace_id = w.id;
