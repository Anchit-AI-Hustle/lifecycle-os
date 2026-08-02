-- ═══════════════════════════════════════════════════════════════════════════
-- Allow UPDATE on knickgasm_campaigns
-- The save flow does INSERT → upload images → UPDATE row with hosted URLs.
-- Without an UPDATE policy the second step silently fails under RLS.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "anon update campaigns" ON public.knickgasm_campaigns;
CREATE POLICY "anon update campaigns"
  ON public.knickgasm_campaigns
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
