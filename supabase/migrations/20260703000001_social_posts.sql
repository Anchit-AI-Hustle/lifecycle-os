-- ═══════════════════════════════════════════════════════════════════════════
-- SOCIAL MEDIA OS — generated social posts (our own output)
-- One row per platform post produced by the daily multi-agent pipeline
-- (api/_shared/social-core.js, ?action=social-run-daily on /api/brain).
--
-- payload  = the full post object (copy, hashtags, cta, link, best_time_utc,
--            theme, objective, media …) as emitted by the compilation agent.
-- media    = mirror of payload.media (image_url|image_prompt, video storyboard
--            + job / would_request stub) for direct querying.
-- status   = draft | approved | posted | skipped        (human review loop)
-- push_status stays 'not_integrated_phase_2' until platform push ships.
--
-- Permissive RLS, same posture as ads_generated / landing_pages_generated
-- (anon key is public; this is non-sensitive marketing copy). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.social_posts_generated (
  id           BIGSERIAL PRIMARY KEY,
  date         DATE NOT NULL,
  platform     TEXT NOT NULL,                 -- instagram|facebook|tiktok|linkedin|x|pinterest|youtube|threads|blog
  format       TEXT,                          -- feed|reels|stories|video|post|pin|shorts|article
  payload      JSONB,                         -- full post object from the pipeline
  media        JSONB,                         -- image_url|image_prompt / video storyboard + job stub
  status       TEXT DEFAULT 'draft',          -- draft|approved|posted|skipped
  push_status  TEXT DEFAULT 'not_integrated_phase_2',
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_posts_date_idx     ON public.social_posts_generated (date DESC);
CREATE INDEX IF NOT EXISTS social_posts_platform_idx ON public.social_posts_generated (platform);
CREATE INDEX IF NOT EXISTS social_posts_status_idx   ON public.social_posts_generated (status);

ALTER TABLE public.social_posts_generated ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "social_posts_read"  ON public.social_posts_generated;
DROP POLICY IF EXISTS "social_posts_write" ON public.social_posts_generated;
DROP POLICY IF EXISTS "social_posts_upd"   ON public.social_posts_generated;
DROP POLICY IF EXISTS "social_posts_del"   ON public.social_posts_generated;
CREATE POLICY "social_posts_read"  ON public.social_posts_generated FOR SELECT USING (true);
CREATE POLICY "social_posts_write" ON public.social_posts_generated FOR INSERT WITH CHECK (true);
CREATE POLICY "social_posts_upd"   ON public.social_posts_generated FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "social_posts_del"   ON public.social_posts_generated FOR DELETE USING (true);
