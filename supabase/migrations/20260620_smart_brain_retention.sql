-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Brain retention + concurrency hardening.
--
-- Addresses three architectural weaknesses in the daily-loop write path:
--   1. RACE CONDITION  — the daily sync now writes tentative/rejected slots with
--      a conditional UPDATE filtered on status (optimistic lock in app code).
--      This index makes that id+status filter cheap.
--   2. INIT MISMATCH   — rejectEntry() clears generated_campaign_id/approved_*;
--      no schema change needed, columns already exist.
--   3. UNBOUNDED LOGS  — smart_brain_runs / smart_feedback / archived calendar
--      rows are pruned (>30 days) by pruneOldRecords() on every daily sync.
--      These created_at/updated_at indexes make the pruning DELETEs cheap, and
--      prune_smart_brain() below is an optional DB-side safety net.
-- ═══════════════════════════════════════════════════════════════════════════

-- Optimistic-lock filter: WHERE id = ? AND status IN ('tentative','rejected')
CREATE INDEX IF NOT EXISTS smart_cal_id_status_idx
  ON public.smart_calendar_entries (id, status);

-- Eviction filter for archived calendar rows: status='archived' AND updated_at < cutoff
CREATE INDEX IF NOT EXISTS smart_cal_archived_updated_idx
  ON public.smart_calendar_entries (status, updated_at);

-- Telemetry pruning supports: created_at < cutoff
CREATE INDEX IF NOT EXISTS smart_brain_runs_created_idx
  ON public.smart_brain_runs (created_at);
CREATE INDEX IF NOT EXISTS smart_feedback_created_idx
  ON public.smart_feedback (created_at);

-- Optional DB-side safety net (in addition to the app-level prune that runs each
-- daily sync). Schedule with pg_cron if available, e.g.:
--   SELECT cron.schedule('smart-brain-prune', '0 4 * * *', $$SELECT public.prune_smart_brain(30)$$);
CREATE OR REPLACE FUNCTION public.prune_smart_brain(retention_days INT DEFAULT 30)
RETURNS TABLE (runs_deleted BIGINT, feedback_deleted BIGINT, calendar_deleted BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  cutoff TIMESTAMPTZ := now() - make_interval(days => retention_days);
  r BIGINT; f BIGINT; c BIGINT;
BEGIN
  WITH d AS (DELETE FROM public.smart_brain_runs WHERE created_at < cutoff RETURNING 1)
    SELECT count(*) INTO r FROM d;
  WITH d AS (DELETE FROM public.smart_feedback WHERE created_at < cutoff RETURNING 1)
    SELECT count(*) INTO f FROM d;
  WITH d AS (DELETE FROM public.smart_calendar_entries WHERE status = 'archived' AND updated_at < cutoff RETURNING 1)
    SELECT count(*) INTO c FROM d;
  RETURN QUERY SELECT r, f, c;
END;
$$;
