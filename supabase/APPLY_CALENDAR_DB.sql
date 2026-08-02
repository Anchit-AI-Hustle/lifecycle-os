-- ═══════════════════════════════════════════════════════════════════════════
-- KNICKGASM Lifecycle OS — Automated Calendar persistence: ONE-PASTE apply file.
--
-- Paste this whole file into the Supabase SQL editor and Run. It creates exactly
-- the four tables the Automated Calendar (/brain) reads and writes, plus the
-- storage bucket for generated creatives. It is IDEMPOTENT and SAFE to re-run:
-- every object uses IF NOT EXISTS, and every policy is dropped-then-created.
--
-- After running this, the calendar's daily sync will actually PERSIST (the plan
-- flips from stored:false to stored:true) and the prebuild queue can fill each
-- slot's assets.
--
-- IMPORTANT — the app must connect with the SERVICE ROLE key, or RLS will block
-- writes. In Vercel (Production + Preview) set:
--   SMART_BRAIN_SUPABASE_URL                  = https://<your-ref>.supabase.co
--   SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY     = <the service_role secret>
-- (These take precedence over a linked anon key, which is why writes were
--  silently blocked before.)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Rolling calendar plan — one row per date+market, diff-updated each sync.
CREATE TABLE IF NOT EXISTS public.smart_calendar_entries (
  id            TEXT PRIMARY KEY,
  date          DATE NOT NULL,
  market        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'tentative',
  confidence    NUMERIC,
  payload       JSONB NOT NULL,
  change_log    JSONB DEFAULT '[]'::jsonb,
  generated_campaign_id TEXT,
  approved_by   TEXT,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS smart_cal_date_market_idx ON public.smart_calendar_entries (date, market);
CREATE INDEX IF NOT EXISTS smart_cal_status_idx ON public.smart_calendar_entries (status, date);

-- 2) Generated campaign bundles (the prebuilt/approved funnel per slot).
CREATE TABLE IF NOT EXISTS public.smart_generated_campaigns (
  id                 TEXT PRIMARY KEY,
  payload            JSONB NOT NULL,
  status             TEXT NOT NULL DEFAULT 'needs_human_verification',
  human_verified_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- 3) Daily sync run log.
CREATE TABLE IF NOT EXISTS public.smart_brain_runs (
  id          TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 4) Human feedback (approve/reject notes, feeds future planning).
CREATE TABLE IF NOT EXISTS public.smart_feedback (
  id          BIGSERIAL PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id   TEXT,
  verdict     TEXT NOT NULL,
  notes       TEXT,
  reviewer    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  metadata    JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS smart_feedback_target_idx ON public.smart_feedback (target_type, target_id, created_at DESC);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- The service_role key bypasses RLS (that is how the server writes). These
-- permissive policies additionally let the anon key READ for the dashboard.
ALTER TABLE public.smart_calendar_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_generated_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_brain_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_feedback            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smart_cal_read"  ON public.smart_calendar_entries;
DROP POLICY IF EXISTS "smart_cal_write" ON public.smart_calendar_entries;
DROP POLICY IF EXISTS "smart_cal_upd"   ON public.smart_calendar_entries;
CREATE POLICY "smart_cal_read"  ON public.smart_calendar_entries FOR SELECT USING (true);
CREATE POLICY "smart_cal_write" ON public.smart_calendar_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "smart_cal_upd"   ON public.smart_calendar_entries FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "smart_gc_read"  ON public.smart_generated_campaigns;
DROP POLICY IF EXISTS "smart_gc_write" ON public.smart_generated_campaigns;
DROP POLICY IF EXISTS "smart_gc_upd"   ON public.smart_generated_campaigns;
CREATE POLICY "smart_gc_read"  ON public.smart_generated_campaigns FOR SELECT USING (true);
CREATE POLICY "smart_gc_write" ON public.smart_generated_campaigns FOR INSERT WITH CHECK (true);
CREATE POLICY "smart_gc_upd"   ON public.smart_generated_campaigns FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "smart_runs_read"  ON public.smart_brain_runs;
DROP POLICY IF EXISTS "smart_runs_write" ON public.smart_brain_runs;
CREATE POLICY "smart_runs_read"  ON public.smart_brain_runs FOR SELECT USING (true);
CREATE POLICY "smart_runs_write" ON public.smart_brain_runs FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "smart_fb_read"  ON public.smart_feedback;
DROP POLICY IF EXISTS "smart_fb_write" ON public.smart_feedback;
CREATE POLICY "smart_fb_read"  ON public.smart_feedback FOR SELECT USING (true);
CREATE POLICY "smart_fb_write" ON public.smart_feedback FOR INSERT WITH CHECK (true);

-- ── Storage bucket for generated creatives (public read) ────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('smart-brain-creatives', 'smart-brain-creatives', true)
ON CONFLICT (id) DO NOTHING;

-- Done. Now redeploy is not required; just run one calendar sync (open /brain,
-- it autogenerates, or POST ?action=smart-brain-sync-daily) and the plan will
-- persist (stored:true) and the prebuild queue will populate each slot.
