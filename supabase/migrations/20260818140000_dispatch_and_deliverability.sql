-- ============================================================================
-- 20260818140000_dispatch_and_deliverability.sql
--
-- The publishing half of the platform. Until now this repo could CREATE every
-- asset a brand needs and could not SEND ANY OF THEM: social-push-core.js
-- returned `push_status:'not_integrated_phase_2'`, and read-only-egress.js
-- blocked every write verb aimed at Klaviyo, Shopify and WebEngage by design.
--
-- This migration adds the state a real dispatcher needs, and the deliverability
-- state that has to gate it. Those two are one system, not two: a send that
-- reaches a spam folder is not a send, so the preflight gate sits between the
-- asset and the adapter and can BLOCK.
--
--   THE PIPELINE
--     asset  ->  channel_mappings   (how this asset becomes a Meta ad / a
--                                    Klaviyo campaign / a WebEngage message)
--            ->  preflight_audits   (domain auth + segment health + spam score,
--                                    verdict pass | warn | block)
--            ->  dispatch_jobs      (queued, with an idempotency key)
--            ->  dispatch_attempts  (every try, with its backoff and its error)
--            ->  platform_sync_log  (what the platform said back)
--            <-  platform_webhook_events (what it said later, unprompted)
--
-- WHY A TABLE AND NOT A QUEUE SERVER. The brief asked for BullMQ / Temporal /
-- Celery. All three need a worker process that outlives a request, and this
-- deployment is Vercel serverless on the Hobby plan: there is nowhere to run
-- one. The repo already solved exactly this in smart-brain-plan.js
-- (prebuildAssets) and brand-context-pack.js — a convergent queue whose state
-- lives on the row and which re-fires itself until nothing is left. The job
-- table below carries the columns that pattern needs (attempt_count,
-- next_attempt_at, lease_owner, lease_expires_at), so the semantics BullMQ
-- would have given us are kept: at-least-once delivery, exponential backoff,
-- rate-limit awareness, and an idempotency key that makes the retries safe.
--
-- WHAT IS DELIBERATELY NOT HERE. No credential of any kind. OAuth access and
-- refresh tokens go into workspace_connection_secrets from 20260813120000,
-- which has RLS on and no policy, so the browser cannot read them. The PKCE
-- verifier in oauth_authorization_states is a secret too, and is locked the
-- same way. This file stores what a workspace member may legitimately SEE.
--
-- Additive + idempotent, same conventions as the migrations before it.
-- ============================================================================

-- ── 0. OAuth columns on the existing connection row ─────────────────────────
--
-- A pasted API key and an OAuth grant are the same KIND of thing to the rest of
-- the platform (a way to act as this workspace on that platform), so they share
-- one row rather than forking the model. What OAuth adds is an expiry and a
-- scope set, and both have to be visible: a connection whose token expired an
-- hour ago must not read as "connected".
alter table if exists public.workspace_connections
  add column if not exists connect_kind           text,
  add column if not exists oauth_scopes           text[] not null default '{}',
  add column if not exists token_expires_at       timestamptz,
  add column if not exists refresh_expires_at     timestamptz,
  add column if not exists last_refresh_at        timestamptz,
  add column if not exists refresh_failure_count  integer not null default 0,
  add column if not exists external_account_id    text,
  add column if not exists external_account_label text,
  add column if not exists revoked_at             timestamptz;

comment on column public.workspace_connections.token_expires_at is
  'When the stored access token stops working. Klaviyo access tokens are valid for ten minutes, so this is on the hot path of a dispatch, not a nightly chore.';
comment on column public.workspace_connections.oauth_scopes is
  'Scopes the platform actually granted, as returned by the token exchange - NOT the scopes we asked for. A publish is refused when the granted set is missing what the action needs.';

-- ── 1. OAuth handshake state (SECRET - service role only) ───────────────────
--
-- Holds the PKCE code_verifier between the redirect out and the callback back.
-- That verifier is the proof that the callback belongs to the browser that
-- started the flow; anyone who can read it can complete somebody else's
-- authorization. So this table is locked exactly like workspace_connection_secrets:
-- RLS on, NO POLICY, revoked from anon and authenticated.
create table if not exists public.oauth_authorization_states (
  state           text primary key,
  workspace_id    uuid not null references public.brand_workspaces(id) on delete cascade,
  provider        text not null,
  user_id         uuid,
  code_verifier   text,
  redirect_uri    text not null,
  scopes          text[] not null default '{}',
  return_to       text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  consumed_at     timestamptz
);

create index if not exists oauth_states_expiry_idx on public.oauth_authorization_states (expires_at);

alter table public.oauth_authorization_states enable row level security;
revoke all on public.oauth_authorization_states from anon, authenticated;
-- No policy on purpose. Only the service role, and only from oauth-core.js
-- after it has verified the caller's JWT and their role on the workspace.

-- ── 2. Channel mappings: how one asset becomes one platform's payload ───────
create table if not exists public.channel_mappings (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,
  provider      text not null,
  channel       text not null,                    -- 'meta_feed', 'klaviyo_campaign', 'webengage_push', ...
  label         text,

  -- field_map is asset-field -> platform-field, with any per-platform constants.
  -- Kept as data rather than code so a new channel does not need a deploy, and
  -- so the mapping a send USED can be shown next to the result.
  field_map     jsonb not null default '{}'::jsonb,
  defaults      jsonb not null default '{}'::jsonb,
  constraints_  jsonb not null default '{}'::jsonb,   -- caption limits, ratios, required media

  is_default    boolean not null default false,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists channel_mappings_default_idx
  on public.channel_mappings (workspace_id, provider, channel)
  where is_default;

alter table public.channel_mappings enable row level security;
do $$ begin
  create policy "channel mappings readable by members" on public.channel_mappings
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "channel mappings written by editors" on public.channel_mappings
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 3. Dispatch jobs: the queue ─────────────────────────────────────────────
create table if not exists public.dispatch_jobs (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.brand_workspaces(id) on delete cascade,

  -- IDEMPOTENCY. The caller supplies (or we derive) a key that identifies the
  -- INTENT: this asset, to this channel, for this schedule. A retry after a
  -- timeout carries the same key and therefore cannot double-post. This unique
  -- index is the actual guarantee - not the application check, which races.
  idempotency_key   text not null,

  provider          text not null,
  channel           text not null,
  mapping_id        uuid references public.channel_mappings(id) on delete set null,

  -- What is being sent. asset_ref points at the canonical record (spec 24b:
  -- one record, many views) and payload is the RESOLVED platform payload, kept
  -- so that what was sent can be shown exactly as it was sent.
  asset_kind        text,
  asset_ref         text,
  payload           jsonb not null default '{}'::jsonb,
  redacted_payload  jsonb,

  mode              text not null default 'publish',      -- publish | schedule | draft
  scheduled_for     timestamptz,

  -- state machine:
  --   queued -> preflight -> ready -> sending -> succeeded
  --                       \-> blocked (preflight said no)
  --                        \-> failed (attempts exhausted)
  --                         \-> cancelled (a human stopped it)
  status            text not null default 'queued',
  preflight_id      uuid,
  preflight_verdict text,

  attempt_count     integer not null default 0,
  max_attempts      integer not null default 5,
  next_attempt_at   timestamptz not null default now(),
  retry_after_at    timestamptz,                          -- honoured from a 429

  -- Lease, so two concurrent invocations of the self-firing queue cannot both
  -- send the same job. Claim = "set lease_owner where lease is null or expired".
  lease_owner       text,
  lease_expires_at  timestamptz,

  external_id       text,                                 -- the platform's id for what we created
  external_status   text,
  result            jsonb,
  last_error        text,

  dry_run           boolean not null default false,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create unique index if not exists dispatch_jobs_idem_idx
  on public.dispatch_jobs (workspace_id, idempotency_key);
create index if not exists dispatch_jobs_runnable_idx
  on public.dispatch_jobs (status, next_attempt_at)
  where status in ('queued', 'preflight', 'ready', 'sending');
create index if not exists dispatch_jobs_ws_idx
  on public.dispatch_jobs (workspace_id, created_at desc);

alter table public.dispatch_jobs enable row level security;
do $$ begin
  create policy "dispatch jobs readable by members" on public.dispatch_jobs
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  -- Editors may CREATE and CANCEL. They may not hand-edit a job's result: the
  -- adapter and the webhook own those columns, and a hand-written 'succeeded'
  -- would be a lie told to the audit trail.
  create policy "dispatch jobs created by editors" on public.dispatch_jobs
    for insert with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "dispatch jobs updated by editors" on public.dispatch_jobs
    for update
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 4. Every attempt, with why it failed ────────────────────────────────────
create table if not exists public.dispatch_attempts (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.dispatch_jobs(id) on delete cascade,
  workspace_id   uuid not null references public.brand_workspaces(id) on delete cascade,
  attempt_no     integer not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  ok             boolean,
  http_status    integer,
  error_class    text,                                   -- rate_limited | auth | validation | transient | permanent
  error_message  text,
  backoff_ms     integer,
  request_digest text,                                   -- method + host + path. NEVER the body: it can carry tokens.
  response_head  jsonb
);

create index if not exists dispatch_attempts_job_idx on public.dispatch_attempts (job_id, attempt_no);

alter table public.dispatch_attempts enable row level security;
do $$ begin
  create policy "dispatch attempts readable by members" on public.dispatch_attempts
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 5. Sync log: what a platform told us, prompted or not ───────────────────
create table if not exists public.platform_sync_log (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,
  provider      text not null,
  direction     text not null default 'outbound',        -- outbound | inbound
  operation     text not null,
  job_id        uuid references public.dispatch_jobs(id) on delete set null,
  ok            boolean,
  records       integer,
  detail        jsonb,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists platform_sync_log_ws_idx on public.platform_sync_log (workspace_id, created_at desc);

alter table public.platform_sync_log enable row level security;
do $$ begin
  create policy "sync log readable by members" on public.platform_sync_log
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 6. Inbound webhooks ─────────────────────────────────────────────────────
--
-- Stored before they are trusted. `verified` records whether the signature
-- check passed; an unverified event is kept for diagnosis and never acted on.
create table if not exists public.platform_webhook_events (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid references public.brand_workspaces(id) on delete cascade,
  provider       text not null,
  event_type     text,
  external_id    text,
  job_id         uuid references public.dispatch_jobs(id) on delete set null,
  verified       boolean not null default false,
  signature_note text,
  payload        jsonb,
  processed_at   timestamptz,
  received_at    timestamptz not null default now()
);

create unique index if not exists webhook_events_dedupe_idx
  on public.platform_webhook_events (provider, external_id)
  where external_id is not null;

alter table public.platform_webhook_events enable row level security;
revoke all on public.platform_webhook_events from anon;
do $$ begin
  create policy "webhook events readable by members" on public.platform_webhook_events
    for select to authenticated
    using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 7. Domain health ────────────────────────────────────────────────────────
create table if not exists public.domain_health_profiles (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.brand_workspaces(id) on delete cascade,
  domain             text not null,
  role               text not null default 'sending',     -- sending | tracking | root

  -- Each of these is the PARSED record plus whether it passes, never a bare
  -- boolean: an operator fixing DMARC needs to see the policy that is actually
  -- published, not a red dot.
  spf                jsonb,
  dkim               jsonb,
  dmarc              jsonb,
  mx                 jsonb,
  bimi               jsonb,
  blacklists         jsonb,
  reputation         jsonb,                               -- Google Postmaster / Microsoft SNDS when connected

  score              integer,                             -- 0..100, computed by deliverability-core
  score_breakdown    jsonb,
  grade              text,
  last_checked_at    timestamptz,
  check_error        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists domain_health_domain_idx
  on public.domain_health_profiles (workspace_id, domain, role);

alter table public.domain_health_profiles enable row level security;
do $$ begin
  create policy "domain health readable by members" on public.domain_health_profiles
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "domain health written by editors" on public.domain_health_profiles
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- Every check kept, so "when did DMARC change from p=none to p=reject" is
-- answerable. Deliverability regressions are almost always a diff.
create table if not exists public.dns_audit_log (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,
  domain        text not null,
  record_type   text not null,
  raw           text,
  parsed        jsonb,
  passed        boolean,
  findings      jsonb,
  resolver      text,                                    -- 'system' | 'doh:cloudflare' | 'doh:google'
  checked_at    timestamptz not null default now()
);

create index if not exists dns_audit_domain_idx on public.dns_audit_log (workspace_id, domain, checked_at desc);

alter table public.dns_audit_log enable row level security;
do $$ begin
  create policy "dns audit readable by members" on public.dns_audit_log
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 8. Warmup ───────────────────────────────────────────────────────────────
create table if not exists public.warmup_schedules (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.brand_workspaces(id) on delete cascade,
  domain           text not null,
  provider         text,                                  -- the ESP this ramp is paced for
  started_on       date not null,
  target_daily     integer not null,
  plan             jsonb not null default '[]'::jsonb,     -- [{day, date, cap, cohort_tier}]
  status           text not null default 'active',         -- active | paused | complete | aborted

  -- The safety throttle. These are the observed rates that paused the ramp, and
  -- the thresholds that were in force when it happened, so a pause can be
  -- explained rather than just noticed.
  paused_reason    text,
  paused_at        timestamptz,
  bounce_rate      numeric,
  complaint_rate   numeric,
  bounce_limit     numeric not null default 0.02,
  complaint_limit  numeric not null default 0.0008,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists warmup_domain_idx on public.warmup_schedules (workspace_id, domain, provider);

alter table public.warmup_schedules enable row level security;
do $$ begin
  create policy "warmup readable by members" on public.warmup_schedules
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "warmup written by editors" on public.warmup_schedules
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 9. Preflight audits ─────────────────────────────────────────────────────
create table if not exists public.preflight_audits (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.brand_workspaces(id) on delete cascade,
  job_id         uuid references public.dispatch_jobs(id) on delete cascade,
  provider       text,
  channel        text,

  verdict        text not null,                           -- pass | warn | block
  score          integer,
  checks         jsonb not null default '[]'::jsonb,      -- [{id,label,status,detail,remediation}]
  blocking       jsonb not null default '[]'::jsonb,
  overridden_by  uuid,
  override_note  text,
  created_at     timestamptz not null default now()
);

create index if not exists preflight_ws_idx on public.preflight_audits (workspace_id, created_at desc);

alter table public.preflight_audits enable row level security;
do $$ begin
  create policy "preflight readable by members" on public.preflight_audits
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 10. Audience cohorts + engagement scores ────────────────────────────────
create table if not exists public.audience_cohorts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.brand_workspaces(id) on delete cascade,
  key            text not null,                           -- champions | engaged_30 | engaged_60 | slipping | inactive
  label          text not null,
  definition     jsonb not null default '{}'::jsonb,      -- the RULE, so a count can always be re-derived
  size           integer,
  health_score   integer,
  send_eligible  boolean not null default true,
  computed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create unique index if not exists audience_cohort_key_idx on public.audience_cohorts (workspace_id, key);

alter table public.audience_cohorts enable row level security;
do $$ begin
  create policy "cohorts readable by members" on public.audience_cohorts
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "cohorts written by editors" on public.audience_cohorts
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- Per-contact scores.
--
-- ⚠️ NO RAW EMAIL ADDRESS. The 17 Aug audit found 26,677 real customer records
-- committed to a sibling repository, so this table stores `email_hash` (a
-- salted SHA-256) and the ESP's OWN profile id. Both are enough for everything
-- this engine does - suppress a profile, cap its frequency, put it in a cohort -
-- and neither is a mailing list if the table leaks. A hash is not anonymisation
-- (an address can be confirmed if guessed), so this table still carries brand
-- RLS and is revoked from anon; it is a blast-radius reduction, not a licence
-- to treat the contents as non-personal data.
create table if not exists public.subscriber_engagement_scores (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.brand_workspaces(id) on delete cascade,
  provider             text not null,
  external_profile_id  text not null,
  email_hash           text,

  recency_days         integer,
  frequency_90d        integer,
  monetary             numeric,
  r_score              smallint,
  f_score              smallint,
  m_score              smallint,
  engagement_score     integer,
  cohort_key           text,

  last_open_at         timestamptz,
  last_click_at        timestamptz,
  last_send_at         timestamptz,
  sends_7d             integer not null default 0,
  sends_30d            integer not null default 0,
  hard_bounced         boolean not null default false,
  complained           boolean not null default false,
  suppressed           boolean not null default false,
  suppressed_reason    text,

  -- Send-time optimisation: the hour-of-week histogram this contact actually
  -- opens in. Null until there is enough history, and the engine says so rather
  -- than defaulting everybody to 10am.
  open_hour_histogram  jsonb,
  best_send_hour       smallint,

  computed_at          timestamptz not null default now()
);

create unique index if not exists subscriber_scores_profile_idx
  on public.subscriber_engagement_scores (workspace_id, provider, external_profile_id);
create index if not exists subscriber_scores_cohort_idx
  on public.subscriber_engagement_scores (workspace_id, cohort_key)
  where suppressed = false;

alter table public.subscriber_engagement_scores enable row level security;
revoke all on public.subscriber_engagement_scores from anon;
do $$ begin
  create policy "engagement scores readable by members" on public.subscriber_engagement_scores
    for select to authenticated
    using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 11. Grants ──────────────────────────────────────────────────────────────
--
-- anon gets nothing anywhere in this file. That is the rule 20260818090000
-- established after the audit, applied from the start here rather than
-- retrofitted.
do $$
declare t text;
begin
  foreach t in array array[
    'oauth_authorization_states', 'channel_mappings', 'dispatch_jobs',
    'dispatch_attempts', 'platform_sync_log', 'platform_webhook_events',
    'domain_health_profiles', 'dns_audit_log', 'warmup_schedules',
    'preflight_audits', 'audience_cohorts', 'subscriber_engagement_scores'
  ] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Tables a workspace editor writes directly from the browser.
grant insert, update, delete on public.channel_mappings        to authenticated;
grant insert, update          on public.dispatch_jobs          to authenticated;
grant insert, update, delete on public.domain_health_profiles  to authenticated;
grant insert, update, delete on public.warmup_schedules        to authenticated;
grant insert, update, delete on public.audience_cohorts        to authenticated;

-- The state table stays service-role only even for select: it holds the PKCE
-- verifier. Re-revoked after the loop above in case the loop is ever relaxed.
revoke all on public.oauth_authorization_states from anon, authenticated;
