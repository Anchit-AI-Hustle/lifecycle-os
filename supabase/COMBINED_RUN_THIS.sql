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
