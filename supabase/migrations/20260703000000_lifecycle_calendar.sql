-- ═══════════════════════════════════════════════════════════════════════════
-- Lifecycle calendar (UK retention program — engagement cohorts, not RFM).
--
-- On-demand cohort-native calendar: one row per date + cohort + market,
-- planned deterministically by api/_shared/lifecycle-calendar-generate.js and
-- upgraded in place when a mailer is built (mailer JSONB, status → 'built').
-- The planner NEVER overwrites rows whose status is 'built'.
--
-- Apply manually via the Supabase dashboard SQL editor (no migration runner).
-- Mirrors 20260610_smart_calendar_plan.sql conventions. Idempotent.
--
-- status lifecycle:
--   planned → built            (mailer generated + persisted into `mailer`)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lifecycle_calendar_entries (
  id            TEXT PRIMARY KEY,              -- lc_<date>_<cohortkey>_UK, stable across regenerations
  date          DATE NOT NULL,
  market        TEXT NOT NULL DEFAULT 'UK',
  cohort_key    TEXT NOT NULL,                 -- non_buyers_non_engagers | tb_buyers_non_engagers
  status        TEXT NOT NULL DEFAULT 'planned',  -- planned|built
  payload       JSONB NOT NULL,                -- full plan row from lifecycle-calendar-generate.js
  mailer        JSONB,                         -- built mailer (subject, html, meta) from lifecycle-mailer-build.js
  generated_by  TEXT,                          -- llm provider/model that wrote the mailer
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_cal_date_cohort_market_idx ON public.lifecycle_calendar_entries (date, cohort_key, market);
CREATE INDEX IF NOT EXISTS lifecycle_cal_status_idx ON public.lifecycle_calendar_entries (status, date);

ALTER TABLE public.lifecycle_calendar_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lifecycle_cal_read"  ON public.lifecycle_calendar_entries;
DROP POLICY IF EXISTS "lifecycle_cal_write" ON public.lifecycle_calendar_entries;
DROP POLICY IF EXISTS "lifecycle_cal_upd"   ON public.lifecycle_calendar_entries;
CREATE POLICY "lifecycle_cal_read"  ON public.lifecycle_calendar_entries FOR SELECT USING (true);
CREATE POLICY "lifecycle_cal_write" ON public.lifecycle_calendar_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "lifecycle_cal_upd"   ON public.lifecycle_calendar_entries FOR UPDATE USING (true) WITH CHECK (true);
