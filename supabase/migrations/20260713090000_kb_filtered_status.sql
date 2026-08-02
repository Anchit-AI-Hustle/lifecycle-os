-- Allow the ingest guardrail to mark off-context knowledge rows as 'filtered'
-- (US/UK D2C sneaker/coffee/supplements/streetwear only). Extends the existing status
-- CHECK constraint on kb_knowledge without dropping data.
ALTER TABLE public.kb_knowledge DROP CONSTRAINT IF EXISTS kb_knowledge_status_check;
ALTER TABLE public.kb_knowledge
  ADD CONSTRAINT kb_knowledge_status_check
  CHECK (status IN ('queued','fetched','summarized','failed','filtered'));

-- Zero-drift metadata tags: every kept knowledge row carries a hard market +
-- vertical tag so the analysis layer can inject a metadata filter (RAG sandbox)
-- and the AI physically cannot read outside the US/UK sneaker/coffee/supplements/
-- streetwear box. NULL where unknown.
ALTER TABLE public.kb_knowledge ADD COLUMN IF NOT EXISTS market   TEXT;
ALTER TABLE public.kb_knowledge ADD COLUMN IF NOT EXISTS vertical TEXT;
CREATE INDEX IF NOT EXISTS kb_knowledge_market_idx   ON public.kb_knowledge (market);
CREATE INDEX IF NOT EXISTS kb_knowledge_vertical_idx ON public.kb_knowledge (vertical);
