-- Phase 3: The Daily D2C Digest. The learning agent runs every 12h; a midnight
-- synthesis reviews the clean (guardrail-passed) logs from the last 24h and
-- distils them into ONE operational daily lesson, instead of 50 tiny updates.
CREATE TABLE IF NOT EXISTS public.kb_daily_digest (
  id           BIGSERIAL PRIMARY KEY,
  digest_date  DATE NOT NULL,
  markets      TEXT[],                 -- markets represented in the window (US/UK)
  verticals    TEXT[],                 -- verticals represented (Sneaker/Coffee/Supplements/Streetwear)
  sources_n    INTEGER DEFAULT 0,      -- how many clean rows were synthesised
  digest_md    TEXT,                   -- the synthesised operational lesson (markdown)
  signals      JSONB,                  -- [{pattern, brands[], vertical, market, evidence}]
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kb_daily_digest_date_idx ON public.kb_daily_digest (digest_date);

ALTER TABLE public.kb_daily_digest ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "kb_daily_digest_read"  ON public.kb_daily_digest FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "kb_daily_digest_write" ON public.kb_daily_digest FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "kb_daily_digest_upd"   ON public.kb_daily_digest FOR UPDATE USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
