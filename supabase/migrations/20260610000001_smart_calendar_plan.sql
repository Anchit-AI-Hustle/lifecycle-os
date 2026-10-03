-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Brain persistent rolling calendar.
--
-- The daily Smart Brain loop needs a durable tentative plan it can REVIEW and
-- UPDATE every day (instead of regenerating from scratch), while preserving
-- entries a human has already approved/finalised. One row per date+market.
--
-- status lifecycle:
--   tentative → (human) approved → final          (approved + assets generated)
--   tentative → (human) rejected → tentative      (regenerated on next sync)
--   any past date → archived                      (rolled out of the window)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.smart_calendar_entries (
  id            TEXT PRIMARY KEY,              -- cal_<date>_<market>, stable across syncs
  date          DATE NOT NULL,
  market        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'tentative',  -- tentative|approved|rejected|final|archived
  confidence    NUMERIC,
  payload       JSONB NOT NULL,                -- full calendar-entry object from CalendarIntelligenceService
  change_log    JSONB DEFAULT '[]'::jsonb,     -- [{at, kind, detail}] appended by each daily sync / review action
  generated_campaign_id TEXT,                  -- set when approval generates assets
  approved_by   TEXT,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS smart_cal_date_market_idx ON public.smart_calendar_entries (date, market);
CREATE INDEX IF NOT EXISTS smart_cal_status_idx ON public.smart_calendar_entries (status, date);

ALTER TABLE public.smart_calendar_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "smart_cal_read"  ON public.smart_calendar_entries;
DROP POLICY IF EXISTS "smart_cal_write" ON public.smart_calendar_entries;
DROP POLICY IF EXISTS "smart_cal_upd"   ON public.smart_calendar_entries;
CREATE POLICY "smart_cal_read"  ON public.smart_calendar_entries FOR SELECT USING (true);
CREATE POLICY "smart_cal_write" ON public.smart_calendar_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "smart_cal_upd"   ON public.smart_calendar_entries FOR UPDATE USING (true) WITH CHECK (true);
