-- ═══════════════════════════════════════════════════════════════════════════
-- Materialise strategic-depth fields as first-class columns so SQL analytics
-- can pivot on segment / impact / send_window without unpacking JSONB.
-- The HTML save flow already populates strategy_full.depth in JSONB; these
-- columns are projections of that for query convenience.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.mailers_generated
  ADD COLUMN IF NOT EXISTS campaign_title      TEXT,
  ADD COLUMN IF NOT EXISTS target_segment      TEXT,
  ADD COLUMN IF NOT EXISTS segment_size        TEXT,
  ADD COLUMN IF NOT EXISTS segment_rationale   TEXT,
  ADD COLUMN IF NOT EXISTS campaign_intent     TEXT,
  ADD COLUMN IF NOT EXISTS expected_impact     JSONB,
  ADD COLUMN IF NOT EXISTS justification       TEXT,
  ADD COLUMN IF NOT EXISTS send_window         TEXT,
  ADD COLUMN IF NOT EXISTS layout_chosen       TEXT;

CREATE INDEX IF NOT EXISTS mg_target_segment_idx ON public.mailers_generated(target_segment);
CREATE INDEX IF NOT EXISTS mg_send_window_idx    ON public.mailers_generated(send_window);

-- Backfill from existing strategy_full.depth (one-time)
UPDATE public.mailers_generated
   SET target_segment    = COALESCE(target_segment,    strategy_full->'depth'->'segment'->>'primary'),
       segment_size      = COALESCE(segment_size,      strategy_full->'depth'->'segment'->>'size'),
       segment_rationale = COALESCE(segment_rationale, strategy_full->'depth'->'segment'->>'rationale'),
       campaign_intent   = COALESCE(campaign_intent,   strategy_full->'depth'->>'intent'),
       expected_impact   = COALESCE(expected_impact,   strategy_full->'depth'->'expected_impact'),
       justification     = COALESCE(justification,     strategy_full->'depth'->>'justification'),
       send_window       = COALESCE(send_window,       strategy_full->'depth'->>'send_window'),
       layout_chosen     = COALESCE(layout_chosen,     strategy_full->'depth'->>'layout_variant')
 WHERE strategy_full ? 'depth';
