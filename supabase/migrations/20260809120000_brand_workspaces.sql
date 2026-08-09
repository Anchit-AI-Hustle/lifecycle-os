-- ============================================================================
-- 20260809120000_brand_workspaces.sql
-- Universal Brand Marketing Lifecycle Platform — the multi-tenant brand layer.
--
-- Turns the single-brand Lifecycle OS into a platform that ANY brand can be
-- onboarded into. A "brand workspace" is one tenant: its identity, colour
-- schema, typography, voice guardrails, regions/store URLs and product catalog.
-- Every logged-in user gets their own workspaces, and the app (nav, palette,
-- fonts, title, generators) re-skins to whichever workspace is ACTIVE for that
-- user.
--
-- Zero-fabrication contract (docs/campaign-orchestration-master-spec.md):
--   * Nothing here is ever auto-invented. A field the operator did not supply
--     stays NULL and is surfaced as
--       [DATA REQUIRED BEFORE LAUNCH: <field>, <product>, <region>]
--     by brand-workspace-core.js `readiness()` — never filled with a guess.
--   * Catalog rows are only ever written from a source the operator supplied
--     (CSV/JSON upload or a public storefront URL they own), with the origin
--     recorded on every row in `source`.
--
-- Conventions from prior migrations: public schema, RLS enabled, additive +
-- idempotent (create if not exists / do $$ ... exception when duplicate_object).
-- Unlike the earlier single-tenant tables, these are NOT world-readable: a
-- workspace is private to its owner and members.
-- ============================================================================

-- ── 1. brand_workspaces — one row per brand (tenant) ────────────────────────
create table if not exists public.brand_workspaces (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid(),
  slug           text not null,                      -- url-safe tenant key
  name           text not null,                      -- display brand name
  legal_name     text,
  tagline        text,
  industry       text,
  website        text,
  logo_url       text,
  favicon_url    text,

  -- Colour schema. Shape (all optional, all operator-supplied hex):
  --   { "primary":"#6A33D8", "accent":"#D0473E", "ink":"#111111",
  --     "surface":"#F7F5F2", "surface_alt":"#ffffff", "muted":"#556059",
  --     "ok":"#1a7f37", "warn":"#c9a227", "err":"#c0392b",
  --     "extra":[{"name":"sand","hex":"#EADFCE"}] }
  palette        jsonb not null default '{}'::jsonb,

  -- { "heading":{"family":"Montserrat","stack":"'Montserrat',Georgia,serif","google":true,"weights":"400;600;700"},
  --   "body":{...}, "mono":{...} }
  typography     jsonb not null default '{}'::jsonb,

  -- { "tone":"warm, sensory", "preferred":["ritual"], "banned":["hurry"],
  --   "no_em_dashes":true, "reading_level":"", "notes":"" }
  voice          jsonb not null default '{}'::jsonb,

  -- [{ "code":"US","currency":"USD","symbol":"$","store_url":"https://…",
  --    "pdp_pattern":"{base}/products/{handle}",
  --    "collection_pattern":"{base}/collections/{slug}" }]
  regions        jsonb not null default '[]'::jsonb,

  -- Hosts a generated asset URL must prefix-match to count as origin-validated.
  asset_hosts    jsonb not null default '[]'::jsonb,

  -- { "kind":"csv|json|shopify_public|manual", "url":"", "imported_at":"",
  --   "row_count":0, "columns":{...} }  — provenance of the catalog import.
  catalog_source jsonb not null default '{}'::jsonb,

  -- Free-form operator-supplied brand data (positioning, ICP, offers, proof).
  -- Never machine-filled; the onboarding wizard writes exactly what was typed.
  brand_data     jsonb not null default '{}'::jsonb,

  status         text not null default 'draft',       -- draft | active | archived
  onboarding_step int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (owner_id, slug)
);

alter table public.brand_workspaces enable row level security;

-- ── 2. brand_workspace_members — shared access (owner keeps full control) ───
create table if not exists public.brand_workspace_members (
  workspace_id uuid not null references public.brand_workspaces(id) on delete cascade,
  user_id      uuid not null,
  role         text not null default 'editor',        -- owner | editor | viewer
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.brand_workspace_members enable row level security;

-- Membership test used by every policy below. SECURITY DEFINER so the policy on
-- brand_workspaces can consult members without recursing into the members
-- policy (which itself selects from brand_workspaces).
create or replace function public.is_brand_member(ws uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.brand_workspaces w where w.id = ws and w.owner_id = uid
  ) or exists (
    select 1 from public.brand_workspace_members m where m.workspace_id = ws and m.user_id = uid
  );
$$;

-- ── 3. brand_catalog_products — the per-brand product catalog ───────────────
-- Mirrors the shape of data/catalog/products_{region}.json so existing catalog
-- consumers keep working, but scoped to a workspace + carrying its provenance.
create table if not exists public.brand_catalog_products (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.brand_workspaces(id) on delete cascade,
  region       text not null default 'us',
  sku          text,
  handle       text,
  title        text not null,
  description  text,
  product_type text,
  collections  jsonb not null default '[]'::jsonb,
  price        numeric,
  compare_at   numeric,
  currency     text,
  image_url    text,
  product_url  text,
  in_stock     boolean,
  tags         jsonb not null default '[]'::jsonb,
  raw          jsonb not null default '{}'::jsonb,   -- the source row, verbatim
  source       text not null default 'manual',       -- csv | json | shopify_public | manual
  created_at   timestamptz not null default now(),
  unique (workspace_id, region, handle, sku)
);

alter table public.brand_catalog_products enable row level security;

create index if not exists brand_catalog_ws_idx     on public.brand_catalog_products (workspace_id);
create index if not exists brand_catalog_region_idx on public.brand_catalog_products (workspace_id, region);
create index if not exists brand_catalog_handle_idx on public.brand_catalog_products (workspace_id, handle);

-- ── 4. brand_user_prefs — which workspace is active FOR THIS USER ───────────
-- This is what makes "the app is customised for the user logged in" true: the
-- shell reads the caller's active workspace and re-skins to it.
create table if not exists public.brand_user_prefs (
  user_id             uuid primary key default auth.uid(),
  active_workspace_id uuid references public.brand_workspaces(id) on delete set null,
  updated_at          timestamptz not null default now()
);

alter table public.brand_user_prefs enable row level security;

-- ── 5. Policies ─────────────────────────────────────────────────────────────
do $$ begin
  create policy "workspace readable by members" on public.brand_workspaces
    for select using (owner_id = auth.uid() or public.is_brand_member(id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "workspace insert by owner" on public.brand_workspaces
    for insert with check (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "workspace update by owner" on public.brand_workspaces
    for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "workspace delete by owner" on public.brand_workspaces
    for delete using (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "members readable by members" on public.brand_workspace_members
    for select using (user_id = auth.uid() or public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "members managed by owner" on public.brand_workspace_members
    for all
    using (exists (select 1 from public.brand_workspaces w where w.id = workspace_id and w.owner_id = auth.uid()))
    with check (exists (select 1 from public.brand_workspaces w where w.id = workspace_id and w.owner_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "catalog readable by members" on public.brand_catalog_products
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "catalog written by members" on public.brand_catalog_products
    for all
    using (public.is_brand_member(workspace_id, auth.uid()))
    with check (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "prefs owned by user" on public.brand_user_prefs
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ── 6. updated_at touch ─────────────────────────────────────────────────────
create or replace function public.touch_brand_workspace()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$ begin
  create trigger brand_workspaces_touch before update on public.brand_workspaces
    for each row execute function public.touch_brand_workspace();
exception when duplicate_object then null; end $$;

comment on table public.brand_workspaces is
  'One row per onboarded brand (tenant). Identity + colour schema + typography + voice guardrails + regions + catalog provenance. Private to owner/members via RLS. No field is ever machine-invented: missing data is reported as [DATA REQUIRED BEFORE LAUNCH: ...] rather than filled.';
comment on table public.brand_catalog_products is
  'Per-brand product catalog imported from an operator-supplied source (CSV/JSON upload or a public storefront URL they own). `source` + `raw` preserve provenance so no product fact is ever fabricated.';
comment on table public.brand_user_prefs is
  'Per-user active workspace. The app shell reads this to re-skin palette, fonts, name and nav for the logged-in user.';
