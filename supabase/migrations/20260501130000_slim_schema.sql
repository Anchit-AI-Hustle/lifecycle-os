-- ═══════════════════════════════════════════════════════════════════════════
-- KNICKGASM Mailer Studio — slim schema (only what the app actually uses)
-- Applied 2026-05-01 13:50 UTC. Drops unused analytics views + catalog table.
-- The app reads/writes these two tables only:
--   • knickgasm_campaigns  (saveMailerToDashboard inserts; renderDashboard reads)
--   • knickgasm_users      (auth signup upsert)
-- ═══════════════════════════════════════════════════════════════════════════

-- Remove analytics views that no client code references
DROP VIEW  IF EXISTS public.knickgasm_campaigns_by_type   CASCADE;
DROP VIEW  IF EXISTS public.knickgasm_campaigns_by_user   CASCADE;
DROP VIEW  IF EXISTS public.knickgasm_campaigns_by_market CASCADE;
DROP VIEW  IF EXISTS public.knickgasm_campaigns_by_regen  CASCADE;

-- Remove catalog snapshots table — no client writes ever happened here
DROP TABLE IF EXISTS public.knickgasm_catalog_snapshots CASCADE;

-- Remove legacy duplicate tables (replaced by knickgasm_users / knickgasm_campaigns)
DROP TABLE IF EXISTS public.app_users        CASCADE;
DROP TABLE IF EXISTS public.campaign_history CASCADE;

-- (knickgasm_campaigns and knickgasm_users remain unchanged with all their data)
