-- ============================================================================
-- 20260813120000_brand_competitors.sql
-- The per-brand competitor universe, in Postgres instead of a Google Sheet.
--
-- WHY THIS TABLE EXISTS
-- The competitor universe used to live in a second tab of one Google
-- Spreadsheet, read through a service account. That made a marketing feature
-- depend on Google credentials the deployment does not hold, so every brand saw
-- "0 brands" and a raw auth error where its competitors should be. Worse, one
-- spreadsheet is one universe: there is no place in it to say WHICH brand a
-- competitor belongs to, so a publisher and a sneaker studio would have shared
-- a single list. Moving the universe here fixes both at once, because the app
-- already runs on Supabase and Supabase already knows which workspace a row
-- belongs to.
--
-- The Sheet is not removed. When Google credentials are present the app still
-- mirrors rows into it as an export, which is the role a spreadsheet is good
-- at. Nothing REQUIRES it any more.
--
-- WHY NOT REUSE public.competitor_brands
-- That table is tenant zero shaped: its CHECK constraints allow only
-- ('sneaker','coffee','supplements','streetwear','gift','other') for category
-- and a fixed region list, and its unique key is (name, region) with no
-- workspace in it. A news brand cannot store a competitor there at all, and two
-- workspaces cannot both track the same competitor. Widening those constraints
-- in place would rewrite the meaning of existing rows, so the multi-tenant
-- universe gets its own table and the old one is left untouched.
--
-- ZERO FABRICATION
-- A competitor name is a factual claim about a real company, so every row
-- records where the claim came from (`source`, `evidence`) and how far it has
-- been checked (`verification`). A field nobody could evidence stays NULL and
-- is reported through `data_gaps` as
--   [DATA REQUIRED BEFORE LAUNCH: <field>, <competitor>, <region>]
-- rather than being filled with something plausible.
--
-- Idempotent and additive, in the style of the migrations before it.
-- ============================================================================

create table if not exists public.brand_competitors (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.brand_workspaces(id) on delete cascade,

  name           text not null,
  website        text,
  -- Normalised registrable host, lowercased, no scheme and no "www.". Empty
  -- string (not NULL) when unknown, so the dedupe key below stays total.
  domain         text not null default '',
  category       text,
  country        text,
  -- A positioning line is a claim about another company. It is only ever
  -- copied from a source that stated it; a discovery run leaves it NULL.
  positioning    text,
  newsletter_url text,

  -- Where this row came from:
  --   brand_record  - named in this brand's own market study or brand data
  --   seed          - the shipped, URL-verified list for tenant zero
  --   discovery     - proposed by a discovery run, not yet verified
  --   manual        - typed in by an operator
  --   import        - carried over from the legacy Google Sheet
  source         text not null default 'manual',
  evidence       text,
  -- verified   - the website was checked and belongs to this company
  -- unverified - a real name with no checked URL behind it yet
  verification   text not null default 'unverified',
  data_gaps      text[] not null default '{}',

  -- Written back by the auto-subscribe worker (workers/auto-subscribe.js).
  subscription_status    text not null default 'Not subscribed',
  date_subscribed        timestamptz,
  confirmation_required  text,
  confirmation_completed text,

  is_active      boolean not null default true,
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  created_at     timestamptz not null default now(),

  -- De-duplication is BY DOMAIN, because the same company is written a dozen
  -- ways ("Nike By You", "NIKE By You", "nike by you") but resolves to one
  -- host. A candidate with no domain yet still needs a stable key, so it falls
  -- back to its folded name; when the domain arrives later the row is updated
  -- rather than re-inserted.
  dedupe_key text generated always as (
    case when btrim(coalesce(domain, '')) <> ''
         then lower(btrim(domain))
         else 'name:' || lower(btrim(name))
    end
  ) stored
);

create unique index if not exists brand_competitors_ws_key_uq
  on public.brand_competitors (workspace_id, dedupe_key);
create index if not exists brand_competitors_ws_idx
  on public.brand_competitors (workspace_id);
create index if not exists brand_competitors_ws_active_idx
  on public.brand_competitors (workspace_id, is_active);
create index if not exists brand_competitors_source_idx
  on public.brand_competitors (workspace_id, source);

alter table public.brand_competitors enable row level security;

-- Same membership gate as every other brand-content table. A competitor set is
-- one of the most brand-specific things the platform holds, so it is readable
-- only by that workspace's members and never world-readable.
do $$ begin
  create policy "competitors readable by members" on public.brand_competitors
    for select using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "competitors written by members" on public.brand_competitors
    for all
    using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()))
    with check (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── Refresh bookkeeping ─────────────────────────────────────────────────────
-- The scheduled refresh runs off the existing daily cron and must not re-run
-- discovery for a workspace it just refreshed (the Hobby plan gives one shared
-- daily slot, and discovery costs an LLM call per brand). Recording the last
-- attempt per workspace is what lets the sweep spread its budget across brands
-- instead of spending it all on the first one.
create table if not exists public.brand_competitor_refresh (
  workspace_id  uuid primary key references public.brand_workspaces(id) on delete cascade,
  last_run_at   timestamptz not null default now(),
  last_source   text,
  last_added    int not null default 0,
  last_note     text
);

alter table public.brand_competitor_refresh enable row level security;

do $$ begin
  create policy "competitor refresh readable by members" on public.brand_competitor_refresh
    for select using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "competitor refresh written by members" on public.brand_competitor_refresh
    for all
    using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()))
    with check (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

comment on table public.brand_competitors is
  'Per-brand competitor universe. Replaces the Google Sheet "Competitors" tab, which required credentials the deployment does not hold and had no room for a tenant. De-duplicated by domain within a workspace. Every row records its provenance (source, evidence, verification); unevidenced fields stay NULL and are reported through data_gaps as [DATA REQUIRED BEFORE LAUNCH: ...].';
comment on column public.brand_competitors.dedupe_key is
  'Domain when known, else the folded name. The unique key with workspace_id, so the same company is stored once per brand and different brands never collide.';
comment on table public.brand_competitor_refresh is
  'Last scheduled competitor-discovery attempt per workspace, so the shared daily cron slot spreads its budget across brands instead of re-running the same one.';
