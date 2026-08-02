-- ═══════════════════════════════════════════════════════════════════════════
-- KNICKGASM Mailer Studio — schema upgrade
-- Adds the new fields the v17+ HTML saves: image matrix, regen history,
-- canvas filter state, extended copy fields. Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.knickgasm_campaigns
  -- Computed copy (extended)
  ADD COLUMN IF NOT EXISTS feature_strip          JSONB,
  ADD COLUMN IF NOT EXISTS ingredients            JSONB,
  ADD COLUMN IF NOT EXISTS section_title          TEXT,
  ADD COLUMN IF NOT EXISTS product_section_title  TEXT,

  -- Canvas filter state (Step 4)
  ADD COLUMN IF NOT EXISTS canvas_market          TEXT,
  ADD COLUMN IF NOT EXISTS canvas_variant         TEXT,

  -- Image generation matrix (every region × variant)
  ADD COLUMN IF NOT EXISTS image_prompts_full     JSONB,
  ADD COLUMN IF NOT EXISTS generated_images       JSONB,
  ADD COLUMN IF NOT EXISTS image_seeds            JSONB,
  ADD COLUMN IF NOT EXISTS canvas_data_url        TEXT,

  -- Regen history (extended)
  ADD COLUMN IF NOT EXISTS regen_count            INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_feedback          TEXT;

-- Indexes for analytics on the new fields
CREATE INDEX IF NOT EXISTS vc_canvas_variant_idx ON public.knickgasm_campaigns(canvas_variant);
CREATE INDEX IF NOT EXISTS vc_regen_count_idx    ON public.knickgasm_campaigns(regen_count);

-- A new view: campaigns by regen activity (which prompts needed the most iteration)
CREATE OR REPLACE VIEW public.knickgasm_campaigns_by_regen AS
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

GRANT SELECT ON public.knickgasm_campaigns_by_regen TO anon;
