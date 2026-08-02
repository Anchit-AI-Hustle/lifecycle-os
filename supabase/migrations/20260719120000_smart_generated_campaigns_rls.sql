-- smart_generated_campaigns + smart_brain_runs were created (20260609_smart_brain.sql)
-- WITHOUT the anon RLS policies + grants their siblings have. Every other generated-
-- asset table is anon-open by design (smart_calendar_entries, ads_generated,
-- landing_pages_generated — "the anon key is public and the data is non-sensitive
-- marketing copy"; revenue numbers are stripped before assets are built). Because
-- the Smart-Brain DB adapter falls back to the anon key when SUPABASE_SERVICE_ROLE_KEY
-- is not set, a locked smart_generated_campaigns means /lp/:id (which reads the LP HTML
-- out of a persisted campaign row) cannot serve, and campaign persistence throws.
-- This aligns the two tables with the rest of the suite so /lp works on the anon key.

alter table public.smart_generated_campaigns enable row level security;
drop policy if exists "sgc_read"  on public.smart_generated_campaigns;
drop policy if exists "sgc_write" on public.smart_generated_campaigns;
drop policy if exists "sgc_upd"   on public.smart_generated_campaigns;
create policy "sgc_read"  on public.smart_generated_campaigns for select using (true);
create policy "sgc_write" on public.smart_generated_campaigns for insert with check (true);
create policy "sgc_upd"   on public.smart_generated_campaigns for update using (true) with check (true);
grant select, insert, update, delete on public.smart_generated_campaigns to anon, authenticated;

alter table public.smart_brain_runs enable row level security;
drop policy if exists "sbr_read"  on public.smart_brain_runs;
drop policy if exists "sbr_write" on public.smart_brain_runs;
create policy "sbr_read"  on public.smart_brain_runs for select using (true);
create policy "sbr_write" on public.smart_brain_runs for insert with check (true);
grant select, insert, update, delete on public.smart_brain_runs to anon, authenticated;
