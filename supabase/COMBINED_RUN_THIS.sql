-- ═══════════════════════════════════════════════════════════════════════════
-- KNICKGASM Mailer Studio — COMPLETE schema (for fresh Supabase project)
-- Idempotent: safe to re-run. Creates only the 2 tables the app uses.
-- Paste this into Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Table 1: Campaigns ──────────────────────────────────────────────────────
-- Every generated mailer is recorded here. JSONB columns enable rich queries
-- (e.g. analytics on hero category, market preference, regen patterns).
CREATE TABLE IF NOT EXISTS public.mailers_generated (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- WHO
  user_name TEXT,
  user_email TEXT,

  -- THE TASK (Step 1 input)
  prompt_short TEXT,                 -- truncated 200-char preview
  prompt_full TEXT,                  -- complete user prompt
  active_prompt TEXT,                -- prompt + regen feedback
  campaign_type TEXT,                -- Sale | Launch | Gift | Bestseller | …
  primary_market TEXT,
  markets JSONB,                     -- ["US","UK","IN"]

  -- THE GOALS (Step 2 product selection)
  hero_product_name TEXT,
  hero_product_image TEXT,
  hero_category TEXT,
  product_names JSONB,
  product_full JSONB,

  -- THE OFFER & OCCASION
  offer_text TEXT,
  offer_code TEXT,
  offer_pct TEXT,
  occasion JSONB,

  -- COMPUTED COPY
  headline JSONB,
  sub_copy TEXT,
  cta TEXT,
  ann_bar TEXT,
  feature_strip JSONB,
  ingredients JSONB,
  section_title TEXT,
  product_section_title TEXT,

  -- LAYOUT VARIANTS (Step 5 output — both A & B)
  layout_variant TEXT,
  canvas_market TEXT,
  canvas_variant TEXT,
  variant_a_html TEXT,
  variant_b_html TEXT,
  market_mailers JSONB,
  variant_a_image_prompt TEXT,
  variant_b_image_prompt TEXT,
  image_prompts_full JSONB,
  generated_images JSONB,
  image_seeds JSONB,
  canvas_data_url TEXT,

  -- REGEN HISTORY
  regen_count INT DEFAULT 0,
  last_feedback TEXT,
  feedback_history JSONB,

  -- AUDIT TRAIL
  reasoning JSONB,
  strategy_full JSONB,

  -- TECHNICAL META
  build_version TEXT,
  user_agent TEXT,
  origin TEXT
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mailers_generated_updated ON public.mailers_generated;
CREATE TRIGGER mailers_generated_updated
  BEFORE UPDATE ON public.mailers_generated
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS vc_created_idx        ON public.mailers_generated(created_at DESC);
CREATE INDEX IF NOT EXISTS vc_user_email_idx     ON public.mailers_generated(user_email);
CREATE INDEX IF NOT EXISTS vc_campaign_type_idx  ON public.mailers_generated(campaign_type);
CREATE INDEX IF NOT EXISTS vc_primary_market_idx ON public.mailers_generated(primary_market);
CREATE INDEX IF NOT EXISTS vc_hero_category_idx  ON public.mailers_generated(hero_category);
CREATE INDEX IF NOT EXISTS vc_canvas_variant_idx ON public.mailers_generated(canvas_variant);

-- ── Table 2: Users (sign-up tracking) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  joined_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vu_last_seen_idx ON public.app_users(last_seen_at DESC);

-- ── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE public.mailers_generated ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read campaigns"   ON public.mailers_generated;
DROP POLICY IF EXISTS "anon insert campaigns" ON public.mailers_generated;
CREATE POLICY "anon read campaigns"   ON public.mailers_generated FOR SELECT USING (true);
CREATE POLICY "anon insert campaigns" ON public.mailers_generated FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "anon read users"   ON public.app_users;
DROP POLICY IF EXISTS "anon insert users" ON public.app_users;
DROP POLICY IF EXISTS "anon update users" ON public.app_users;
CREATE POLICY "anon read users"   ON public.app_users FOR SELECT USING (true);
CREATE POLICY "anon insert users" ON public.app_users FOR INSERT WITH CHECK (true);
CREATE POLICY "anon update users" ON public.app_users FOR UPDATE USING (true);

-- ── Shared-source-of-truth engine (spec §24b; api/_shared/sync-core.js) ──────
create table if not exists public.sync_state (
  record_type    text not null,
  record_id      text not null,
  version        text,
  source_version jsonb not null default '{}'::jsonb,
  status         text not null default 'CURRENT',
  dependencies   jsonb not null default '{}'::jsonb,
  synced_at      timestamptz not null default now(),
  validated_at   timestamptz not null default now(),
  primary key (record_type, record_id)
);
create index if not exists sync_state_status_idx on public.sync_state (status);
create index if not exists sync_state_type_idx   on public.sync_state (record_type);
create table if not exists public.sync_audit_log (
  id                  bigint generated always as identity primary key,
  at                  timestamptz not null default now(),
  record_type         text, record_id text,
  previous_value      jsonb, new_value jsonb,
  source              text, initiated_by text, actor text default 'system', reason text,
  affected_outputs    jsonb default '[]'::jsonb,
  regeneration_result text, validation_result text
);
create index if not exists sync_audit_record_idx on public.sync_audit_log (record_type, record_id);
create index if not exists sync_audit_at_idx      on public.sync_audit_log (at desc);
alter table public.sync_state     enable row level security;
alter table public.sync_audit_log enable row level security;
do $$ begin create policy "anon read sync_state" on public.sync_state for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "anon read sync_audit" on public.sync_audit_log for select using (true); exception when duplicate_object then null; end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- UNIVERSAL BRAND PLATFORM: brand workspaces, credits, TeleSuite (2026-08-09)
-- Appended from supabase/migrations/2026080912/13/14*.sql — apply in this order:
-- brand_workspaces first (credits + telesuite reference it and is_brand_member).
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ============================================================================
-- 20260809130000_credits.sql
-- Platform credit system — every feature in the app costs credits.
--
-- Model:
--   * ONE wallet per (user, brand workspace). Credits are spent by the signed-in
--     user against the brand they are working on, so per-brand cost is visible.
--   * The wallet balance is DERIVED state; `credit_ledger` is the append-only
--     truth. Every movement (grant, top-up, hold, spend, refund, expiry) is a
--     row carrying the feature it belongs to and the balance after it.
--   * Spending is a two-phase hold -> settle so a feature that fails mid-run
--     never silently burns credits:
--        credit_hold(...)   reserves and debits available balance
--        credit_settle(...) charges the real amount, releasing any difference
--        credit_release(...) returns the whole hold on failure
--   * All three are SECURITY DEFINER plpgsql functions that take a row lock, so
--     two concurrent runs can never overdraw. The client can NEVER write to
--     credit_wallets or credit_ledger directly (no insert/update policy) —
--     balance only ever moves through these functions.
--
-- Real-time: credit_wallets is added to the `supabase_realtime` publication, so
-- the browser subscribes to its own wallet row and the balance in the header
-- updates the instant a run debits it.
-- ============================================================================

-- ── 1. Wallets ──────────────────────────────────────────────────────────────
create table if not exists public.credit_wallets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  workspace_id  uuid references public.brand_workspaces(id) on delete cascade,
  balance       bigint not null default 0 check (balance >= 0),
  held          bigint not null default 0 check (held >= 0),
  lifetime_granted bigint not null default 0,
  lifetime_spent   bigint not null default 0,
  low_balance_threshold bigint not null default 100,
  currency      text not null default 'CREDITS',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One wallet per user per workspace. `workspace_id IS NULL` = the user's
-- personal wallet (used before any brand is onboarded), so a partial unique
-- index is needed for each case.
create unique index if not exists credit_wallets_user_ws_idx
  on public.credit_wallets (user_id, workspace_id) where workspace_id is not null;
create unique index if not exists credit_wallets_user_personal_idx
  on public.credit_wallets (user_id) where workspace_id is null;

alter table public.credit_wallets enable row level security;

do $$ begin
  create policy "wallet readable by owner" on public.credit_wallets
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
-- Deliberately NO insert/update/delete policy: balance moves only via the
-- SECURITY DEFINER functions below.

-- ── 2. Append-only ledger ───────────────────────────────────────────────────
create table if not exists public.credit_ledger (
  id            bigserial primary key,
  wallet_id     uuid not null references public.credit_wallets(id) on delete cascade,
  user_id       uuid not null,
  workspace_id  uuid,
  kind          text not null,         -- grant | topup | hold | spend | refund | release | adjust | expiry
  feature_key   text,                  -- e.g. 'mailer.generate', 'telesuite.call_scoring'
  feature_label text,
  units         numeric,               -- how many billable units this covered
  unit_label    text,                  -- 'per mailer', 'per minute of audio', ...
  delta         bigint not null,       -- signed change to available balance
  balance_after bigint not null,
  hold_id       uuid,                  -- links hold -> settle/release
  ref           text,                  -- run id / order id / campaign id
  note          text,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

alter table public.credit_ledger enable row level security;

do $$ begin
  create policy "ledger readable by owner" on public.credit_ledger
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- The welcome grant must land exactly once per wallet even if two tabs (or two
-- API calls) touch a brand-new wallet at the same instant. The application
-- pre-check is racy by nature, so THIS index is the real guard: the loser of
-- the race gets a unique violation, which credits-core treats as "already
-- granted" rather than granting a second time.
create unique index if not exists credit_ledger_welcome_once_idx
  on public.credit_ledger (wallet_id) where ref = 'welcome' and kind = 'grant';

create index if not exists credit_ledger_wallet_idx  on public.credit_ledger (wallet_id, created_at desc);
create index if not exists credit_ledger_feature_idx on public.credit_ledger (user_id, feature_key);
create index if not exists credit_ledger_hold_idx    on public.credit_ledger (hold_id) where hold_id is not null;

-- ── 3. Price overrides (the code catalog is the default) ────────────────────
-- api/_shared/credit-catalog.js is the versioned source of truth for what each
-- feature costs. This table only exists so an operator can override a price
-- without a deploy. A missing row simply means "use the catalog price".
create table if not exists public.credit_prices (
  feature_key text primary key,
  cost        bigint not null check (cost >= 0),
  unit_label  text,
  note        text,
  updated_at  timestamptz not null default now()
);

alter table public.credit_prices enable row level security;

do $$ begin
  create policy "prices readable by all signed-in" on public.credit_prices
    for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;

-- ── 4. Recharge orders ──────────────────────────────────────────────────────
-- A top-up is only credited when an order reaches status='paid'. Nothing here
-- takes a payment: `provider` + `provider_ref` record whichever processor the
-- operator wires up, and `credit_grant()` is what actually moves the balance.
create table if not exists public.credit_orders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid(),
  workspace_id uuid references public.brand_workspaces(id) on delete set null,
  pack_key     text not null,
  credits      bigint not null check (credits > 0),
  amount_minor bigint,                 -- price in the smallest currency unit
  currency     text,
  status       text not null default 'pending',  -- pending | paid | failed | cancelled
  provider     text,
  provider_ref text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.credit_orders enable row level security;

do $$ begin
  create policy "orders readable by owner" on public.credit_orders
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "orders created by owner" on public.credit_orders
    for insert with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
-- Status transitions are made server-side with the service role, never by the
-- browser: a client cannot mark its own order paid.

create index if not exists credit_orders_user_idx on public.credit_orders (user_id, created_at desc);

-- ── 5. Wallet resolution ────────────────────────────────────────────────────
create or replace function public.credit_wallet_id(p_user uuid, p_workspace uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_user is null then raise exception 'user required'; end if;

  if p_workspace is null then
    select id into v_id from public.credit_wallets where user_id = p_user and workspace_id is null;
  else
    select id into v_id from public.credit_wallets where user_id = p_user and workspace_id = p_workspace;
  end if;

  if v_id is not null then return v_id; end if;

  insert into public.credit_wallets (user_id, workspace_id)
  values (p_user, p_workspace)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    if p_workspace is null then
      select id into v_id from public.credit_wallets where user_id = p_user and workspace_id is null;
    else
      select id into v_id from public.credit_wallets where user_id = p_user and workspace_id = p_workspace;
    end if;
  end if;
  return v_id;
end $$;

-- ── 6. Grant / top-up ───────────────────────────────────────────────────────
create or replace function public.credit_grant(
  p_user uuid, p_workspace uuid, p_amount bigint,
  p_kind text default 'grant', p_ref text default null,
  p_note text default null, p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_wallet uuid; v_balance bigint;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  v_wallet := public.credit_wallet_id(p_user, p_workspace);

  update public.credit_wallets
     set balance = balance + p_amount,
         lifetime_granted = lifetime_granted + p_amount,
         updated_at = now()
   where id = v_wallet
  returning balance into v_balance;

  insert into public.credit_ledger (wallet_id, user_id, workspace_id, kind, delta, balance_after, ref, note, meta)
  values (v_wallet, p_user, p_workspace, coalesce(p_kind, 'grant'), p_amount, v_balance, p_ref, p_note, coalesce(p_meta, '{}'::jsonb));

  return jsonb_build_object('ok', true, 'wallet_id', v_wallet, 'balance', v_balance, 'granted', p_amount);
end $$;

-- ── 7. Hold (reserve before running a feature) ──────────────────────────────
create or replace function public.credit_hold(
  p_user uuid, p_workspace uuid, p_amount bigint,
  p_feature text, p_label text default null, p_unit_label text default null,
  p_units numeric default 1, p_ref text default null, p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_wallet uuid; v_balance bigint; v_hold uuid := gen_random_uuid();
begin
  if p_amount is null or p_amount < 0 then raise exception 'amount must be >= 0'; end if;
  v_wallet := public.credit_wallet_id(p_user, p_workspace);

  -- Lock the wallet row so two concurrent runs cannot both pass the check.
  select balance into v_balance from public.credit_wallets where id = v_wallet for update;

  if v_balance < p_amount then
    return jsonb_build_object(
      'ok', false, 'error', 'insufficient_credits',
      'balance', v_balance, 'required', p_amount, 'short_by', p_amount - v_balance,
      'feature_key', p_feature, 'wallet_id', v_wallet);
  end if;

  update public.credit_wallets
     set balance = balance - p_amount, held = held + p_amount, updated_at = now()
   where id = v_wallet
  returning balance into v_balance;

  insert into public.credit_ledger (wallet_id, user_id, workspace_id, kind, feature_key, feature_label, units, unit_label, delta, balance_after, hold_id, ref, meta)
  values (v_wallet, p_user, p_workspace, 'hold', p_feature, p_label, p_units, p_unit_label, -p_amount, v_balance, v_hold, p_ref, coalesce(p_meta, '{}'::jsonb));

  return jsonb_build_object('ok', true, 'hold_id', v_hold, 'wallet_id', v_wallet, 'balance', v_balance, 'held', p_amount);
end $$;

-- ── 8. Settle (charge the real amount, return the rest) ─────────────────────
create or replace function public.credit_settle(
  p_hold uuid, p_actual bigint default null,
  p_units numeric default null, p_ref text default null, p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h record; v_wallet uuid; v_balance bigint; v_held bigint; v_actual bigint; v_refund bigint;
begin
  select * into h from public.credit_ledger where hold_id = p_hold and kind = 'hold' limit 1;
  if h is null then raise exception 'unknown hold %', p_hold; end if;
  if exists (select 1 from public.credit_ledger where hold_id = p_hold and kind in ('spend','release')) then
    raise exception 'hold % already settled', p_hold;
  end if;

  v_wallet := h.wallet_id;
  v_held := -h.delta;
  v_actual := greatest(0, least(coalesce(p_actual, v_held), v_held));  -- never charge more than reserved
  v_refund := v_held - v_actual;

  update public.credit_wallets
     set held = held - v_held,
         balance = balance + v_refund,
         lifetime_spent = lifetime_spent + v_actual,
         updated_at = now()
   where id = v_wallet
  returning balance into v_balance;

  insert into public.credit_ledger (wallet_id, user_id, workspace_id, kind, feature_key, feature_label, units, unit_label, delta, balance_after, hold_id, ref, meta)
  values (v_wallet, h.user_id, h.workspace_id, 'spend', h.feature_key, h.feature_label,
          coalesce(p_units, h.units), h.unit_label, 0, v_balance, p_hold, coalesce(p_ref, h.ref), coalesce(p_meta, '{}'::jsonb));

  if v_refund > 0 then
    insert into public.credit_ledger (wallet_id, user_id, workspace_id, kind, feature_key, feature_label, delta, balance_after, hold_id, ref, note)
    values (v_wallet, h.user_id, h.workspace_id, 'refund', h.feature_key, h.feature_label, v_refund, v_balance, p_hold, coalesce(p_ref, h.ref), 'unused portion of the reservation');
  end if;

  return jsonb_build_object('ok', true, 'charged', v_actual, 'refunded', v_refund, 'balance', v_balance, 'wallet_id', v_wallet);
end $$;

-- ── 9. Release (feature failed — give it all back) ──────────────────────────
create or replace function public.credit_release(p_hold uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare h record; v_balance bigint; v_held bigint;
begin
  select * into h from public.credit_ledger where hold_id = p_hold and kind = 'hold' limit 1;
  if h is null then raise exception 'unknown hold %', p_hold; end if;
  if exists (select 1 from public.credit_ledger where hold_id = p_hold and kind in ('spend','release')) then
    return jsonb_build_object('ok', true, 'already_settled', true);
  end if;

  v_held := -h.delta;
  update public.credit_wallets
     set held = held - v_held, balance = balance + v_held, updated_at = now()
   where id = h.wallet_id
  returning balance into v_balance;

  insert into public.credit_ledger (wallet_id, user_id, workspace_id, kind, feature_key, feature_label, delta, balance_after, hold_id, ref, note)
  values (h.wallet_id, h.user_id, h.workspace_id, 'release', h.feature_key, h.feature_label, v_held, v_balance, p_hold, h.ref, coalesce(p_note, 'run failed — reservation returned'));

  return jsonb_build_object('ok', true, 'released', v_held, 'balance', v_balance);
end $$;

-- ── 10. Usage rollup (what the wallet page charts) ──────────────────────────
create or replace function public.credit_usage(p_user uuid, p_workspace uuid default null, p_days int default 30)
returns table (feature_key text, feature_label text, runs bigint, credits bigint, last_used timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select l.feature_key,
         max(l.feature_label) as feature_label,
         count(*) filter (where l.kind = 'spend') as runs,
         coalesce(-sum(l.delta) filter (where l.kind = 'hold'), 0)
           - coalesce(sum(l.delta) filter (where l.kind in ('refund','release')), 0) as credits,
         max(l.created_at) as last_used
    from public.credit_ledger l
   where l.user_id = p_user
     and (p_workspace is null or l.workspace_id = p_workspace)
     and l.feature_key is not null
     and l.created_at >= now() - make_interval(days => greatest(1, p_days))
   group by l.feature_key
   order by credits desc;
$$;

-- ── 11. Lock the money functions to the server ──────────────────────────────
-- These are SECURITY DEFINER, so anyone allowed to EXECUTE them bypasses RLS.
-- A signed-in browser must never be able to call credit_grant() and top itself
-- up, or call credit_settle() to zero out a charge. Only the service role (used
-- by api/_shared/credits-core.js, after it has verified the caller's JWT) may
-- execute them. credit_usage() is locked down too: it is SECURITY DEFINER and
-- takes p_user as an argument, so leaving it open would let any signed-in user
-- read another user's spending by passing their id. The server calls it with
-- the service role after verifying whose wallet is being asked about.
do $$
declare fn text;
begin
  foreach fn in array array[
    'credit_wallet_id(uuid,uuid)',
    'credit_grant(uuid,uuid,bigint,text,text,text,jsonb)',
    'credit_hold(uuid,uuid,bigint,text,text,text,numeric,text,jsonb)',
    'credit_settle(uuid,bigint,numeric,text,jsonb)',
    'credit_release(uuid,text)',
    'credit_usage(uuid,uuid,int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;

-- ── 12. Real-time: let the browser watch its own wallet row ─────────────────
do $$ begin
  alter publication supabase_realtime add table public.credit_wallets;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.credit_ledger;
exception when duplicate_object then null; when undefined_object then null; end $$;

comment on table public.credit_wallets is
  'Derived balance per (user, brand workspace). Only the credit_* SECURITY DEFINER functions may move it; there is no client insert/update policy. Published to supabase_realtime so the app header updates the instant a feature debits.';
comment on table public.credit_ledger is
  'Append-only truth for every credit movement, tagged with the feature that caused it. hold -> spend/release pairs are linked by hold_id so a failed run is always refunded.';


-- ============================================================================
-- 20260809140000_telesuite.sql
-- TeleSuite — the AI tele-sales / tele-support suite, ported from
-- github.com/Anchit-AI-Hustle/AI-TeleSuite into this platform.
--
-- The original app kept everything in browser localStorage, so nothing survived
-- a device change and no dashboard could span a team. Here the same objects are
-- persisted per brand workspace:
--   telesuite_items  — Products and Knowledge Base entries (the context every
--                      TeleSuite generator is grounded in)
--   telesuite_runs   — one row per feature run: inputs, output, credits charged.
--                      This single table backs EVERY TeleSuite dashboard
--                      (transcription DB, call scoring DB, combined analysis DB,
--                      voice sales/support DB, material DB, data analysis DB and
--                      the global activity log) — they are filtered views of it,
--                      per the repo's shared-source-of-truth rule.
--
-- Scoped by workspace_id, so TeleSuite is per-brand like the rest of the app,
-- and readable only by that workspace's members.
-- ============================================================================

create table if not exists public.telesuite_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.brand_workspaces(id) on delete cascade,
  user_id      uuid not null default auth.uid(),
  kind         text not null,                     -- product | knowledge
  name         text not null,
  category     text,                              -- KB category / product line
  content      text,                              -- KB body, or product description
  attributes   jsonb not null default '{}'::jsonb,-- price, sku, USPs, links...
  source       text,                              -- upload | typed | catalog | generated
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.telesuite_items enable row level security;

create index if not exists telesuite_items_ws_idx   on public.telesuite_items (workspace_id, kind);
create index if not exists telesuite_items_name_idx on public.telesuite_items (workspace_id, name);

do $$ begin
  create policy "telesuite items by members" on public.telesuite_items
    for all using (public.is_brand_member(workspace_id, auth.uid()))
        with check (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

create table if not exists public.telesuite_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,
  user_id       uuid not null default auth.uid(),
  feature       text not null,                    -- pitch | rebuttal | transcription | call_scoring | ...
  title         text,
  status        text not null default 'complete', -- complete | failed | in_progress
  product       text,                             -- product this run was about
  input         jsonb not null default '{}'::jsonb,
  output        jsonb not null default '{}'::jsonb,
  score         numeric,                          -- headline number, if the feature has one
  duration_ms   integer,
  units         numeric,                          -- billable units (minutes, chars...)
  credits       integer not null default 0,       -- credits actually charged
  credit_ref    text,                             -- ledger hold id, for reconciliation
  provider      text,                             -- which LLM provider answered
  error         text,
  created_at    timestamptz not null default now()
);

alter table public.telesuite_runs enable row level security;

create index if not exists telesuite_runs_ws_idx      on public.telesuite_runs (workspace_id, created_at desc);
create index if not exists telesuite_runs_feature_idx on public.telesuite_runs (workspace_id, feature, created_at desc);

do $$ begin
  create policy "telesuite runs by members" on public.telesuite_runs
    for all using (public.is_brand_member(workspace_id, auth.uid()))
        with check (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.telesuite_runs;
exception when duplicate_object then null; when undefined_object then null; end $$;

comment on table public.telesuite_runs is
  'One row per TeleSuite feature run. Every TeleSuite dashboard is a filtered view of this table (shared source of truth) rather than its own store, and `credits` records what the run actually cost.';

-- ============================================================================
-- 20260809150000_brand_editor_roles.sql
-- Split brand-workspace membership from WRITE permission.
--
-- `is_brand_member()` deliberately returns true for every member, including a
-- declared `viewer`. The catalog policy in 20260809120000 was written FOR ALL
-- using that function, so a viewer could call catalog-import with replacement
-- enabled and wipe or replace the workspace's entire product catalog. Reading
-- and writing need different tests.
--
-- Also adds the batch column that makes a replacement import atomic: new rows
-- are inserted under a fresh `import_batch`, and only once they are all in are
-- the previous rows deleted. A failure part-way through therefore leaves the
-- previous catalog intact instead of an empty or half-written one.
--
-- Additive + idempotent.
-- ============================================================================

-- ── 1. Write permission = owner or editor ───────────────────────────────────
create or replace function public.is_brand_editor(ws uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.brand_workspaces w where w.id = ws and w.owner_id = uid
  ) or exists (
    select 1 from public.brand_workspace_members m
     where m.workspace_id = ws and m.user_id = uid and m.role in ('owner', 'editor')
  );
$$;

comment on function public.is_brand_editor is
  'Write test for a brand workspace: the owner, or a member whose role is owner/editor. A `viewer` is deliberately excluded. Use is_brand_member for reads and this for writes.';

-- ── 2. Catalog: members read, editors write ─────────────────────────────────
drop policy if exists "catalog written by members" on public.brand_catalog_products;

do $$ begin
  create policy "catalog written by editors" on public.brand_catalog_products
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
-- "catalog readable by members" from the earlier migration is unchanged, so a
-- viewer keeps read access.

-- ── 3. TeleSuite: members read, editors write ───────────────────────────────
drop policy if exists "telesuite items by members" on public.telesuite_items;
drop policy if exists "telesuite runs by members" on public.telesuite_runs;

do $$ begin
  create policy "telesuite items readable by members" on public.telesuite_items
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "telesuite items written by editors" on public.telesuite_items
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "telesuite runs readable by members" on public.telesuite_runs
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "telesuite runs written by editors" on public.telesuite_runs
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 4. Atomic catalog replacement ───────────────────────────────────────────
alter table public.brand_catalog_products
  add column if not exists import_batch uuid;

create index if not exists brand_catalog_batch_idx
  on public.brand_catalog_products (workspace_id, region, import_batch);

comment on column public.brand_catalog_products.import_batch is
  'Stage-and-swap marker. A replacement import writes every new row under a fresh batch id and only then deletes rows from earlier batches, so a failure part-way through leaves the previous catalog intact.';

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

-- ============================================================================
-- 20260809170000_fulfil_order_txn.sql
-- Make recharge fulfilment atomic in BOTH directions.
--
-- The application-level compare-and-set stopped the double grant, but it opened
-- the opposite hole: the order was flipped to `paid` first, and if the
-- subsequent credit_grant call failed (a transient network or database error)
-- the order stayed `paid` forever while no credits were ever added. Every retry
-- then short-circuited on "already fulfilled". A customer could pay and never
-- receive the pack.
--
-- Both movements have to happen together, so they live in one function: the
-- pending -> paid transition and the ledger grant are a single transaction.
-- Either both land or neither does, and a retry after a failure still works
-- because the order is still `pending`.
-- ============================================================================

create or replace function public.credit_fulfil_order(
  p_order    uuid,
  p_provider text default null,
  p_ref      text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_claimed int;
  v_grant jsonb;
begin
  select * into o from public.credit_orders where id = p_order;
  if o is null then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  -- Claim the order. The WHERE on status = 'pending' is the compare-and-set:
  -- exactly one concurrent caller can win it.
  update public.credit_orders
     set status = 'paid',
         provider = coalesce(p_provider, provider),
         provider_ref = coalesce(p_ref, provider_ref),
         updated_at = now()
   where id = p_order and status = 'pending';
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    -- Someone else already fulfilled it, or it is not payable. Report whether
    -- the credits actually landed so a caller can tell the difference.
    return jsonb_build_object(
      'ok', true, 'credited', false, 'status', o.status,
      'already_fulfilled', exists (
        select 1 from public.credit_ledger where ref = p_order::text and kind = 'topup'
      ));
  end if;

  -- Same transaction: if this raises, the UPDATE above rolls back with it and
  -- the order returns to `pending`, so a retry can fulfil it properly.
  v_grant := public.credit_grant(
    o.user_id, o.workspace_id, o.credits,
    'topup', o.id::text, 'Recharge: ' || o.pack_key,
    jsonb_build_object('pack', o.pack_key, 'provider', p_provider)
  );

  return jsonb_build_object(
    'ok', true, 'credited', true, 'credits', o.credits,
    'balance', v_grant->'balance', 'order_id', o.id, 'pack_key', o.pack_key);
end $$;

comment on function public.credit_fulfil_order is
  'Atomically mark a recharge order paid AND grant its credits. Both happen in one transaction, so a failed grant rolls the status back to pending and the retry works — the previous split version could leave an order paid with no credits ever added.';

-- A pack must never be credited twice for the same order, whatever the caller
-- does. This is the backstop behind the compare-and-set above.
create unique index if not exists credit_ledger_topup_once_idx
  on public.credit_ledger (ref) where kind = 'topup' and ref is not null;

do $$ begin
  revoke all on function public.credit_fulfil_order(uuid, text, text) from public, anon, authenticated;
  grant execute on function public.credit_fulfil_order(uuid, text, text) to service_role;
end $$;

-- ============================================================================
-- 20260809180000_welcome_grant_per_user.sql
-- The trial grant is per ACCOUNT, not per wallet.
--
-- Wallets are per (user, brand workspace), and the welcome grant was landing on
-- the first touch of EACH wallet. Any signed-in user can create and activate an
-- unlimited number of brand workspaces, so that was an unlimited credit faucet:
-- create a workspace, take another 500 credits, spend them, repeat.
--
-- The entitlement belongs to the user, so the uniqueness does too. The old
-- per-wallet index is replaced with a per-user one; a second workspace's wallet
-- now starts empty, which is the correct behaviour for an account-level trial.
--
-- Existing deployments: any duplicate welcome grants already issued are left
-- alone (the ledger is append-only truth and must not be rewritten); the index
-- is created only if that is possible, and the application check below it still
-- prevents new ones either way.
-- ============================================================================

drop index if exists public.credit_ledger_welcome_once_idx;

do $$
begin
  create unique index credit_ledger_welcome_once_user_idx
    on public.credit_ledger (user_id) where ref = 'welcome' and kind = 'grant';
exception
  when unique_violation then
    -- A deployment that already issued more than one welcome grant to a user
    -- cannot take the unique index. Say so loudly rather than failing the
    -- migration: credits-core still checks per user before granting, so no NEW
    -- duplicate can be created.
    raise warning 'credit_ledger already contains multiple welcome grants for at least one user; the per-user unique index was not created. New duplicates are still prevented in credits-core.wallet(). Reconcile the existing rows if the balances matter.';
  when duplicate_table then null;
end $$;

comment on table public.credit_ledger is
  'Append-only truth for every credit movement, tagged with the feature that caused it. hold -> spend/release pairs are linked by hold_id so a failed run is always refunded. The welcome grant is unique per USER (not per wallet), because a user can create unlimited workspaces.';
