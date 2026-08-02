-- ═══════════════════════════════════════════════════════════════════════════
-- Rename tables to clearer domain names
--   knickgasm_users     → app_users           (signup tracking for THIS app)
--   knickgasm_campaigns → mailers_generated   (every generated mailer record)
-- knickgasm_users name freed for a future "Knickgasm customer segments" table.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS public.knickgasm_users     RENAME TO app_users;
ALTER TABLE IF EXISTS public.knickgasm_campaigns RENAME TO mailers_generated;

-- Rename policies (they keep working but old names are confusing)
ALTER POLICY "anon read campaigns"   ON public.mailers_generated RENAME TO "anon read mailers";
ALTER POLICY "anon insert campaigns" ON public.mailers_generated RENAME TO "anon insert mailers";
ALTER POLICY "anon update campaigns" ON public.mailers_generated RENAME TO "anon update mailers";
ALTER POLICY "anon delete campaigns" ON public.mailers_generated RENAME TO "anon delete mailers";
ALTER POLICY "anon read users"       ON public.app_users         RENAME TO "anon read app_users";
ALTER POLICY "anon insert users"     ON public.app_users         RENAME TO "anon insert app_users";
ALTER POLICY "anon update users"     ON public.app_users         RENAME TO "anon update app_users";

-- Rename trigger + function for clarity
ALTER TRIGGER knickgasm_campaigns_cleanup ON public.mailers_generated RENAME TO mailers_generated_cleanup;
ALTER TRIGGER knickgasm_campaigns_updated ON public.mailers_generated RENAME TO mailers_generated_updated;
ALTER FUNCTION public.knickgasm_campaign_cleanup_storage() RENAME TO mailers_generated_cleanup_storage;
