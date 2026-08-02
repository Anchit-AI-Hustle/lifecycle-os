-- ═══════════════════════════════════════════════════════════════════════════
-- Knowledge Base file storage + Competitor landing-page capture
-- Two independent additions in one migration:
--   1. kb_files       — index of any file uploaded to the "knowledge-base"
--                       Supabase Storage bucket. Bucket created via the
--                       Storage API call below; rows added by the dashboard
--                       once an upload completes.
--   2. competitor_landing_pages — one row per captured landing page that a
--                       competitor email or ad links to. Filled by a future
--                       Playwright pass in competitor-intelligence-hub.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Storage bucket: knowledge-base (public, all file types) ──────────────
-- Note: bucket creation via SQL requires the storage schema. If your project
-- uses the Supabase Dashboard exclusively, create the bucket there instead
-- (Storage → New bucket → name "knowledge-base" → public ON → no mime/size limit).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('knowledge-base', 'knowledge-base', true, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Allow anyone to read (public bucket) and only authenticated users to upload.
-- Adjust the INSERT policy if you want anonymous uploads (set role to public).
DROP POLICY IF EXISTS "kb_read_public"  ON storage.objects;
DROP POLICY IF EXISTS "kb_write_public" ON storage.objects;

CREATE POLICY "kb_read_public" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'knowledge-base');

CREATE POLICY "kb_write_public" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'knowledge-base');

-- ── 2. kb_files index ───────────────────────────────────────────────────────
-- Mirrors the storage object with searchable metadata (category, tags, notes).
CREATE TABLE IF NOT EXISTS public.kb_files (
  id            BIGSERIAL PRIMARY KEY,
  storage_path  TEXT NOT NULL UNIQUE,           -- e.g. "brand/style-guide.pdf"
  file_name     TEXT NOT NULL,                  -- original filename
  mime_type     TEXT,                           -- whatever the browser detected
  size_bytes    BIGINT,
  category      TEXT,                           -- "brand" | "products" | "logos" | "other"
  tags          JSONB,                          -- ["pdf","style-guide","2026"]
  notes         TEXT,
  public_url    TEXT,                           -- pre-resolved public CDN url
  uploaded_by   TEXT,                           -- user email or "system"
  uploaded_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_files_category_idx ON public.kb_files (category);
CREATE INDEX IF NOT EXISTS kb_files_uploaded_at_idx ON public.kb_files (uploaded_at DESC);

ALTER TABLE public.kb_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kb_files_read"  ON public.kb_files;
DROP POLICY IF EXISTS "kb_files_write" ON public.kb_files;
CREATE POLICY "kb_files_read"  ON public.kb_files FOR SELECT USING (true);
CREATE POLICY "kb_files_write" ON public.kb_files FOR INSERT WITH CHECK (true);
CREATE POLICY "kb_files_upd"   ON public.kb_files FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "kb_files_del"   ON public.kb_files FOR DELETE USING (true);

-- ── 3. competitor_landing_pages ─────────────────────────────────────────────
-- One row per *unique* landing-page URL we captured for a competitor brand.
-- Triggered by the Playwright extension in competitor-intelligence-hub: when
-- an email is synced, all outbound links are deduped, fetched, screenshotted,
-- and a row is inserted here.
CREATE TABLE IF NOT EXISTS public.competitor_landing_pages (
  id              BIGSERIAL PRIMARY KEY,
  url             TEXT NOT NULL,
  url_hash        TEXT NOT NULL,                -- sha1(url) — dedupe key
  brand           TEXT,
  source_email_id TEXT,                         -- sheet row id of the email that linked to it
  source_kind     TEXT DEFAULT 'mailer' CHECK (source_kind IN ('mailer','ad','manual')),
  title           TEXT,
  promo_codes     TEXT,
  html_snippet    TEXT,                         -- first ~10KB of rendered HTML
  screenshot_url  TEXT,                         -- Drive or Storage URL
  status          TEXT DEFAULT 'captured' CHECK (status IN ('queued','captured','failed','redirected')),
  captured_at     TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS landing_pages_url_hash_uq
  ON public.competitor_landing_pages (url_hash);
CREATE INDEX IF NOT EXISTS landing_pages_brand_idx
  ON public.competitor_landing_pages (brand);
CREATE INDEX IF NOT EXISTS landing_pages_captured_at_idx
  ON public.competitor_landing_pages (captured_at DESC);

ALTER TABLE public.competitor_landing_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lp_read"  ON public.competitor_landing_pages;
DROP POLICY IF EXISTS "lp_write" ON public.competitor_landing_pages;
CREATE POLICY "lp_read"  ON public.competitor_landing_pages FOR SELECT USING (true);
CREATE POLICY "lp_write" ON public.competitor_landing_pages FOR INSERT WITH CHECK (true);
CREATE POLICY "lp_upd"   ON public.competitor_landing_pages FOR UPDATE USING (true) WITH CHECK (true);
