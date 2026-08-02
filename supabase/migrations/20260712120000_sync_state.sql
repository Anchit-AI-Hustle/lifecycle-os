-- Shared-source-of-truth engine (spec §24b; api/_shared/sync-core.js).
-- Two side-tables so the canonical rows themselves are not altered:
--   sync_state     — freshness of each canonical record / generated asset
--   sync_audit_log — the full change history the audit contract requires
-- Keyed by (record_type, record_id) so any feature can look up freshness by id.

create table if not exists public.sync_state (
  record_type    text not null,
  record_id      text not null,
  version        text,
  source_version jsonb not null default '{}'::jsonb,
  status         text not null default 'CURRENT',
  dependencies   jsonb not null default '{}'::jsonb,
  synced_at      timestamptz not null default now(),
  validated_at   timestamptz not null default now(),
  primary key (record_type, record_id)
);
create index if not exists sync_state_status_idx on public.sync_state (status);
create index if not exists sync_state_type_idx   on public.sync_state (record_type);

create table if not exists public.sync_audit_log (
  id                  bigint generated always as identity primary key,
  at                  timestamptz not null default now(),
  record_type         text,
  record_id           text,
  previous_value      jsonb,
  new_value           jsonb,
  source              text,
  initiated_by        text,
  actor               text default 'system',
  reason              text,
  affected_outputs    jsonb default '[]'::jsonb,
  regeneration_result text,
  validation_result   text
);
create index if not exists sync_audit_record_idx on public.sync_audit_log (record_type, record_id);
create index if not exists sync_audit_at_idx      on public.sync_audit_log (at desc);

-- RLS: service-role writes; anon may read freshness (statuses are not secret).
alter table public.sync_state     enable row level security;
alter table public.sync_audit_log enable row level security;
do $$ begin
  create policy "anon read sync_state" on public.sync_state for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon read sync_audit" on public.sync_audit_log for select using (true);
exception when duplicate_object then null; end $$;
