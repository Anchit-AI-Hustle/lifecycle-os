-- ============================================================================
-- 20261004093700_contact_ledger_fatigue.sql
-- One cross-channel contact ledger + per-brand contact (fatigue) rules.
--
-- The operator's roadmap: "if a user received an SMS at 10:00 AM, the
-- Algorithmic Calendar must automatically suppress scheduled marketing emails
-- or WhatsApp messages for 48 hours to prevent opt-out spikes." The rules and
-- the judge live in api/_shared/contact-fatigue.js; the reads and writes in
-- api/_shared/contact-ledger.js. This file is the storage and the boundary.
--
--   contact_touch_ledger   one row per message that reached one person:
--                          channel, message class, when, and WHO as the ESP's
--                          own profile id and/or a per-workspace salted SHA-256
--                          of the address / number. NEVER the address or the
--                          number: the CHECK constraints below refuse a hash
--                          column that is not 64 hex characters and a profile
--                          id that is itself an address or a phone number, so
--                          the guarantee is the database's, not only the code's.
--   contact_fatigue_rules  a brand's own rules (caps, cool-downs, quiet hours,
--                          event map). The code holds them to the spec on every
--                          read, so a hand-written row cannot loosen a cap.
--   dispatch_jobs.contact_touch
--                          the touch a job will make (channel, class, HASHED
--                          recipients), so the ledger records it when the
--                          platform accepts the send.
--
-- Boundary, the same shape as subscriber_engagement_scores
-- (20260818140000): RLS on, members READ through is_brand_member, nothing is
-- granted to anon. The ledger has NO write policy and authenticated gets
-- SELECT only: what reached a customer is written by the service role (the
-- dispatch queue, a verified ingest), never hand-edited by a member. The rules
-- are written by editors (is_brand_editor) as themselves.
-- ============================================================================

-- ── 1. The ledger ───────────────────────────────────────────────────────────
create table if not exists public.contact_touch_ledger (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.brand_workspaces(id) on delete cascade,

  provider             text,
  external_profile_id  text,
  email_hash           text,
  phone_hash           text,

  channel              text not null,
  message_class        text not null,
  occurred_at          timestamptz not null,
  cohort_key           text,
  region               text,

  source               text not null,          -- dispatch | esp_event
  source_ref           text not null,          -- the job id / the ESP's event id
  subject_key          text not null,          -- sha256 over the identifiers: the dedupe column
  dispatch_job_id      uuid references public.dispatch_jobs(id) on delete set null,

  created_at           timestamptz not null default now(),

  constraint contact_touch_channel_chk
    check (channel in ('email', 'sms', 'whatsapp', 'push', 'in_app')),
  constraint contact_touch_class_chk
    check (message_class in ('promotional', 'transactional', 'triggered-lifecycle')),
  constraint contact_touch_source_chk
    check (source in ('dispatch', 'esp_event')),
  constraint contact_touch_identity_chk
    check (external_profile_id is not null or email_hash is not null or phone_hash is not null),
  -- No raw PII, structurally.
  constraint contact_touch_email_hash_chk
    check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  constraint contact_touch_phone_hash_chk
    check (phone_hash is null or phone_hash ~ '^[0-9a-f]{64}$'),
  constraint contact_touch_profile_not_pii_chk
    check (external_profile_id is null or (external_profile_id !~ '@' and external_profile_id !~ '^\+?[0-9[:space:]().-]{7,24}$')),
  constraint contact_touch_subject_key_chk
    check (subject_key ~ '^[0-9a-f]{64}$')
);

-- A re-delivered event, or a job reconciled twice, is ONE touch.
create unique index if not exists contact_touch_dedupe_idx
  on public.contact_touch_ledger (workspace_id, source, source_ref, subject_key);
create index if not exists contact_touch_ws_time_idx
  on public.contact_touch_ledger (workspace_id, occurred_at desc);
create index if not exists contact_touch_profile_idx
  on public.contact_touch_ledger (workspace_id, external_profile_id) where external_profile_id is not null;
create index if not exists contact_touch_email_idx
  on public.contact_touch_ledger (workspace_id, email_hash) where email_hash is not null;
create index if not exists contact_touch_phone_idx
  on public.contact_touch_ledger (workspace_id, phone_hash) where phone_hash is not null;
create index if not exists contact_touch_cohort_idx
  on public.contact_touch_ledger (workspace_id, cohort_key, occurred_at desc) where cohort_key is not null;

alter table public.contact_touch_ledger enable row level security;
revoke all on public.contact_touch_ledger from anon;
revoke all on public.contact_touch_ledger from authenticated;
grant select on public.contact_touch_ledger to authenticated;
grant all on public.contact_touch_ledger to service_role;
do $$ begin
  create policy "contact touches readable by members" on public.contact_touch_ledger
    for select to authenticated
    using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

comment on table public.contact_touch_ledger is
  'One row per message that reached one person, across email/SMS/WhatsApp/push/in-app. Pseudonymous (ESP profile id + per-workspace salted SHA-256), never an address or a number. Written by the service role only; read by brand members.';

-- ── 2. A brand's own rules ──────────────────────────────────────────────────
create table if not exists public.contact_fatigue_rules (
  workspace_id  uuid primary key references public.brand_workspaces(id) on delete cascade,
  rules         jsonb not null default '{}'::jsonb,
  updated_by    uuid,
  updated_at    timestamptz not null default now()
);

alter table public.contact_fatigue_rules enable row level security;
revoke all on public.contact_fatigue_rules from anon;
grant select, insert, update on public.contact_fatigue_rules to authenticated;
grant all on public.contact_fatigue_rules to service_role;
do $$ begin
  create policy "contact rules readable by members" on public.contact_fatigue_rules
    for select to authenticated
    using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "contact rules written by editors" on public.contact_fatigue_rules
    for insert to authenticated
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "contact rules updated by editors" on public.contact_fatigue_rules
    for update to authenticated
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 3. The touch a dispatch job will make ───────────────────────────────────
alter table public.dispatch_jobs add column if not exists contact_touch jsonb;
comment on column public.dispatch_jobs.contact_touch is
  'The channel, message class and HASHED recipients this job contacts; recorded into contact_touch_ledger when the platform accepts the send.';
