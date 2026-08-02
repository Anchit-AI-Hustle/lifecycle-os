-- ═══════════════════════════════════════════════════════════════════════════
-- kb_files: add `region` column so uploads can be tagged by market.
-- The Knowledge Base Files tab now picks a region per upload (All / US / UK /
-- Global / India). Existing rows stay NULL (treated as "All regions").
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.kb_files
  ADD COLUMN IF NOT EXISTS region TEXT
    CHECK (region IS NULL OR region IN ('US','UK','Global','India','EU','AU','ME'));

CREATE INDEX IF NOT EXISTS kb_files_region_idx ON public.kb_files (region);

-- Optional: add a `feature_tag` separate from `category` if we want the
-- distinction later. For now `category` already carries the feature
-- (mailers/meta/google/tiktok/landing/brand/products/references/other).
