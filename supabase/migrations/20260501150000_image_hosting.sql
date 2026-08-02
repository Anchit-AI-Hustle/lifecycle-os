-- ═══════════════════════════════════════════════════════════════════════════
-- Image hosting architecture
-- Adds explicit URL columns + public Storage bucket so every image used in a
-- mailer is fetchable as a stable hosted URL (no base64 in DB rows).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Schema columns ----------------------------------------------------------
ALTER TABLE public.knickgasm_campaigns
  ADD COLUMN IF NOT EXISTS hero_image_url    TEXT,  -- Knickgasm product image (already hosted)
  ADD COLUMN IF NOT EXISTS canvas_image_url  TEXT,  -- Storage URL of canvas snapshot
  ADD COLUMN IF NOT EXISTS mailer_image_urls JSONB, -- {US:{A:url,B:url}, UK:{...}, …}
  ADD COLUMN IF NOT EXISTS thumbnail_url     TEXT;  -- compact preview for the dashboard

-- 2. Public Storage bucket ---------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('mailer-assets','mailer-assets', true, 10485760,
        ARRAY['image/png','image/jpeg','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE
   SET public = true,
       file_size_limit    = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3. Anon RLS policies on bucket objects -------------------------------------
DROP POLICY IF EXISTS "anon read mailer-assets"   ON storage.objects;
DROP POLICY IF EXISTS "anon write mailer-assets"  ON storage.objects;
DROP POLICY IF EXISTS "anon update mailer-assets" ON storage.objects;
CREATE POLICY "anon read mailer-assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'mailer-assets');
CREATE POLICY "anon write mailer-assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'mailer-assets');
CREATE POLICY "anon update mailer-assets"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'mailer-assets');
