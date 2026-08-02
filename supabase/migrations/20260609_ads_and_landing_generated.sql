-- ═══════════════════════════════════════════════════════════════════════════
-- Generated ADS + generated LANDING PAGES (our own output — not competitor capture)
-- Mirrors the mailers_generated pattern so the unified /assets dashboard can
-- count + list every asset the suite has produced, cross-device.
--
--   1. ads_generated            — one row per saved Google / Meta / TikTok ad
--   2. landing_pages_generated  — one row per saved landing page
--
-- Both are anon-insert/read/update/delete (same posture as mailers_generated;
-- the anon key is public and the data is non-sensitive marketing copy).
-- Creative images are uploaded to the existing "mailer-assets" Storage bucket
-- under the ads/ prefix; only the resulting public URL is stored here.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. ads_generated ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ads_generated (
  id             BIGSERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ DEFAULT now(),
  user_name      TEXT,
  user_email     TEXT,
  channel        TEXT,                          -- 'google' | 'meta' | 'tiktok'
  name           TEXT,                          -- campaign name
  market         TEXT,
  objective      TEXT,                          -- obj / type, per channel
  budget         TEXT,
  url            TEXT,                           -- final/landing URL (google)
  audience       TEXT,
  copy           JSONB,                          -- full per-channel copy blob
  creative_url   TEXT,                           -- hosted creative image (Storage)
  creative_prompt TEXT,                          -- prompt used to generate it
  origin         TEXT
);
CREATE INDEX IF NOT EXISTS ads_created_idx    ON public.ads_generated (created_at DESC);
CREATE INDEX IF NOT EXISTS ads_channel_idx    ON public.ads_generated (channel);
CREATE INDEX IF NOT EXISTS ads_user_email_idx ON public.ads_generated (user_email);

ALTER TABLE public.ads_generated ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ads_read"  ON public.ads_generated;
DROP POLICY IF EXISTS "ads_write" ON public.ads_generated;
DROP POLICY IF EXISTS "ads_upd"   ON public.ads_generated;
DROP POLICY IF EXISTS "ads_del"   ON public.ads_generated;
CREATE POLICY "ads_read"  ON public.ads_generated FOR SELECT USING (true);
CREATE POLICY "ads_write" ON public.ads_generated FOR INSERT WITH CHECK (true);
CREATE POLICY "ads_upd"   ON public.ads_generated FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "ads_del"   ON public.ads_generated FOR DELETE USING (true);

-- ── 2. landing_pages_generated ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.landing_pages_generated (
  id             BIGSERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ DEFAULT now(),
  user_name      TEXT,
  user_email     TEXT,
  paired_with    TEXT,                           -- 'mailer' | 'meta' | 'google' | 'tiktok'
  name           TEXT,
  market         TEXT,
  hero           TEXT,
  sub            TEXT,
  offer          TEXT,
  notes          TEXT,
  payload        JSONB,                          -- full landing-page record
  origin         TEXT
);
CREATE INDEX IF NOT EXISTS lpg_created_idx    ON public.landing_pages_generated (created_at DESC);
CREATE INDEX IF NOT EXISTS lpg_paired_idx     ON public.landing_pages_generated (paired_with);
CREATE INDEX IF NOT EXISTS lpg_user_email_idx ON public.landing_pages_generated (user_email);

ALTER TABLE public.landing_pages_generated ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lpg_read"  ON public.landing_pages_generated;
DROP POLICY IF EXISTS "lpg_write" ON public.landing_pages_generated;
DROP POLICY IF EXISTS "lpg_upd"   ON public.landing_pages_generated;
DROP POLICY IF EXISTS "lpg_del"   ON public.landing_pages_generated;
CREATE POLICY "lpg_read"  ON public.landing_pages_generated FOR SELECT USING (true);
CREATE POLICY "lpg_write" ON public.landing_pages_generated FOR INSERT WITH CHECK (true);
CREATE POLICY "lpg_upd"   ON public.landing_pages_generated FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "lpg_del"   ON public.landing_pages_generated FOR DELETE USING (true);
