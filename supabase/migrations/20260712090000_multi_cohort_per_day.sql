-- Multi-cohort-per-day calendar (2026-07-12)
-- The Automated Calendar now schedules 3-4 distinct cohort sends per day per
-- market (config.cohortsPerDay) to hit the >=70-80k USD/month revenue target.
-- Each cohort is its own row, keyed by id = cal_<date>_<market>_<cohort-slug>.
--
-- The old UNIQUE index on (date, market) allowed only ONE row per day+market and
-- must be dropped; the primary key (id, which now includes the cohort) still
-- guarantees uniqueness. A plain (non-unique) index on (date, market) is kept for
-- the range queries the planner runs.
DROP INDEX IF EXISTS public.smart_cal_date_market_idx;
CREATE INDEX IF NOT EXISTS smart_cal_date_market_idx ON public.smart_calendar_entries (date, market);

-- The id scheme changed from cal_<date>_<market> to cal_<date>_<market>_<cohort>.
-- Clear the OLD-format, not-yet-decided rows so the next daily sync repopulates
-- the day with the new 3-4-cohort rows instead of doubling up. Human-approved /
-- finalised rows are KEPT (their decisions must stay approved), old id and all.
DELETE FROM public.smart_calendar_entries
 WHERE status IN ('tentative', 'rejected', 'needs_human_verification')
   AND id ~ '^cal_[0-9]{4}-[0-9]{2}-[0-9]{2}_[a-z]+$';

