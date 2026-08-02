-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: SECURITY DEFINER warnings on the 4 analytics views
-- By default Postgres CREATE VIEW runs as the view OWNER (= SECURITY DEFINER),
-- bypassing the calling user's RLS. Recreate them with `security_invoker=on`
-- so they respect the caller's permissions just like a regular query.
-- Requires Postgres 15+ (Supabase runs 15+).
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.knickgasm_campaigns_by_type;
DROP VIEW IF EXISTS public.knickgasm_campaigns_by_user;
DROP VIEW IF EXISTS public.knickgasm_campaigns_by_market;
DROP VIEW IF EXISTS public.knickgasm_campaigns_by_regen;

CREATE VIEW public.knickgasm_campaigns_by_type
WITH (security_invoker=on) AS
SELECT campaign_type, COUNT(*) AS total, MAX(created_at) AS last_at
FROM public.knickgasm_campaigns
GROUP BY campaign_type
ORDER BY total DESC;

CREATE VIEW public.knickgasm_campaigns_by_user
WITH (security_invoker=on) AS
SELECT user_email, user_name, COUNT(*) AS total, MAX(created_at) AS last_at
FROM public.knickgasm_campaigns
WHERE user_email IS NOT NULL AND user_email <> ''
GROUP BY user_email, user_name
ORDER BY total DESC;

CREATE VIEW public.knickgasm_campaigns_by_market
WITH (security_invoker=on) AS
SELECT primary_market AS market, COUNT(*) AS total, MAX(created_at) AS last_at
FROM public.knickgasm_campaigns
GROUP BY primary_market
ORDER BY total DESC;

CREATE VIEW public.knickgasm_campaigns_by_regen
WITH (security_invoker=on) AS
SELECT
  campaign_type,
  regen_count,
  COUNT(*) AS total,
  AVG(regen_count) OVER (PARTITION BY campaign_type) AS avg_regens_for_type,
  MAX(created_at) AS last_at
FROM public.knickgasm_campaigns
WHERE regen_count > 0
GROUP BY campaign_type, regen_count
ORDER BY regen_count DESC;

-- Re-grant SELECT to anon (DROP wiped the grants)
GRANT SELECT ON public.knickgasm_campaigns_by_type   TO anon;
GRANT SELECT ON public.knickgasm_campaigns_by_user   TO anon;
GRANT SELECT ON public.knickgasm_campaigns_by_market TO anon;
GRANT SELECT ON public.knickgasm_campaigns_by_regen  TO anon;
