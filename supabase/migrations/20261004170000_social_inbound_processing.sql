-- ============================================================================
-- 20261004170000_social_inbound_processing.sql
--
-- A verified webhook delivery is RECORDED once (20261004150000) and PROCESSED
-- once, and those are two different facts. The receiver records the event,
-- then hands it to dispatch-core.ingestWebhook; when that ingest fails it
-- answers 500 so the platform retries. Until this migration the retry met the
-- (provider, event_id) dedupe and was answered 200 as a duplicate, so an event
-- whose ingest failed was dropped for good - exactly when the 500 had asked
-- for another attempt (review of #132).
--
--   status        received   recorded; its ingest has not completed
--                 processed  the ingest completed; a redelivery is only acknowledged
--                 failed     the last ingest attempt failed; a redelivery resumes it
--   attempts      ingest attempts made so far
--   last_error    why the last attempt failed (no payload, no credential)
--   processed_at  when the ingest completed
--
-- Rows recorded before this migration take `received`: whether their ingest
-- completed is not known, and re-running an ingest is idempotent (the webhook
-- table merges duplicates; the job reconcile sets the same status again), so a
-- late redelivery of one of them resumes rather than being dropped.
--
-- Only the service role writes these columns; members keep their read.
-- Additive + idempotent.
-- ============================================================================

alter table public.social_inbound_events
  add column if not exists status       text not null default 'received',
  add column if not exists attempts     integer not null default 0,
  add column if not exists last_error   text,
  add column if not exists processed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'social_inbound_events_status_check'
      and conrelid = 'public.social_inbound_events'::regclass
  ) then
    alter table public.social_inbound_events
      add constraint social_inbound_events_status_check
      check (status in ('received', 'processed', 'failed'));
  end if;
end $$;

-- The redeliveries that matter are the unfinished ones.
create index if not exists social_inbound_events_unprocessed_idx
  on public.social_inbound_events (provider, received_at)
  where status <> 'processed';
