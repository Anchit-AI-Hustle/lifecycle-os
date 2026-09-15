-- selfhost-bootstrap-db.sql — make a plain Postgres carry what the Supabase
-- services and this app's migrations assume is already there.
-- ---------------------------------------------------------------------------
-- The supabase/postgres image runs init scripts at first boot (migrations/db/
-- init-scripts/0000000000000{0,1,2,3}-*.sql in github.com/supabase/postgres)
-- that create the roles, schemas, extensions and helper functions every
-- service and every RLS policy in supabase/migrations/ depends on. A managed
-- Postgres such as Neon runs none of them. This file is that bootstrap,
-- rewritten for a database where YOU ARE NOT A SUPERUSER:
--
--   - everything is guarded (IF NOT EXISTS / OR REPLACE / an EXCEPTION
--     block), so re-running is a no-op — tests/self-hosted-supabase.spec.js
--     parses this file and fails on any unguarded CREATE;
--   - statements that need SUPERUSER in the upstream scripts are either
--     dropped (see "NOT REPRODUCED" at the end) or attempted with a fallback
--     that RAISES A WARNING naming what was lost, never silently.
--
-- Run (scripts/selfhost-migrate.sh does this for you in external mode):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v pw="$POSTGRES_PASSWORD" \
--        -f scripts/selfhost-bootstrap-db.sql
--
-- VERIFIED against the upstream init scripts as read on 2026-09-15:
--   roles anon/authenticated/service_role/authenticator and their grants,
--   the `extensions` schema with uuid-ossp + pgcrypto, the auth schema with
--   uid()/role()/email(), usage grants, default privileges, the empty
--   `supabase_realtime` publication, the statement timeouts.
-- NOT VERIFIED against a live Neon project (none was reachable from where
--   this was written): whether `bypassrls` is granted (expected NOT — see
--   the warning below and docs/self-hosted-supabase.md), and whether
--   GoTrue's, storage-api's and Realtime's own migrations then run as the
--   non-superuser owner role.

-- The password for the `authenticator` login role, passed as a psql variable
-- so it never sits in this file. (`-v pw=…` — the migrate script sets it.)
select set_config('selfhost.pw', :'pw', false);

-- ── 1. Extensions (init-script 00000000000000, lines 23-25) ──────────────
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
-- pgjwt is installed by the upstream image but nothing in supabase/migrations
-- calls sign()/verify(), so it is deliberately not required here.

-- ── 2. The API roles PostgREST switches into (init-script 00000000000000,
--       lines 29-37; storage-api's installer does the same and is turned off
--       in external mode because of the bypassrls step) ─────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    begin
      create role service_role nologin noinherit bypassrls;
    exception when insufficient_privilege then
      -- Postgres: "must be superuser to create bypassrls users". Neon has no
      -- superuser, so this is the expected branch there. Consequence: the
      -- service-role key is SUBJECT TO RLS on this database. The app's
      -- server paths that rely on bypassing RLS (~40 service-role call
      -- sites) need the workaround in docs/self-hosted-supabase.md
      -- ("service_role on a managed Postgres").
      create role service_role nologin noinherit;
      raise warning 'service_role created WITHOUT bypassrls (superuser required). Service-role reads are RLS-filtered on this database; see docs/self-hosted-supabase.md.';
    end;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute format('create role authenticator login noinherit password %L', current_setting('selfhost.pw'));
  else
    execute format('alter role authenticator with login noinherit password %L', current_setting('selfhost.pw'));
  end if;
end $$;

-- GRANT of membership is idempotent (a repeat is a NOTICE, not an error).
grant anon to authenticator;
grant authenticated to authenticator;
grant service_role to authenticator;

-- Short statement timeouts for the browser-facing roles, as upstream.
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';

-- ── 3. Schema access (init-script 00000000000000, lines 39-45) ───────────
-- Default privileges bind to the role running THIS file, which is the same
-- role that later runs the app migrations (POSTGRES_USER), so every table
-- those migrations create is visible to the API roles — RLS then decides rows.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ── 4. auth schema + the JWT claim helpers behind 128 policy checks
--       (init-script 00000000000001, lines 3 and 93-109). GoTrue creates the
--       tables itself (CREATE TABLE IF NOT EXISTS) — only the schema and the
--       functions have to pre-exist. ───────────────────────────────────────
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Both GUC shapes are read. PostgREST with PGRST_DB_USE_LEGACY_GUCS=false
-- (this kit) sets `request.jwt.claims` (one JSON value) and NOT the legacy
-- `request.jwt.claim.sub`; the upstream init script's original one-GUC body
-- would return NULL here and every auth.uid() policy would deny everyone.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- ── 5. storage schema (init-script 00000000000002). storage-api creates
--       storage.buckets / storage.objects at boot; the app's migrations then
--       INSERT buckets and add policies on storage.objects. ────────────────
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;
alter default privileges in schema storage grant all on functions to anon, authenticated, service_role;
alter default privileges in schema storage grant all on sequences to anon, authenticated, service_role;

-- ── 6. Realtime's housekeeping schema (docker/volumes/db/realtime.sql) ────
create schema if not exists _realtime;

-- ── 7. The CDC publication (init-script 00000000000000, line 5). Two app
--       migrations ALTER it (20260527 lifecycle.*, 20260621 dtc.*) and fail
--       if it is absent; Realtime reads it. Empty, as upstream creates it. ──
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ── 8. The applier's ledger (scripts/selfhost-migrate.sh) ─────────────────
create schema if not exists selfhost;
create table if not exists selfhost.applied_files (
  filename   text primary key,
  sha256     text not null,
  applied_at timestamptz not null default now()
);

-- ── NOT REPRODUCED (superuser-only upstream; consequences in the runbook) ─
--   * `alter user supabase_admin with superuser …`, supabase_replication_admin,
--     supabase_etl_admin, supabase_read_only_user, dashboard_user — service
--     accounts of the hosted platform; the services here log in as YOUR
--     owner role instead (AUTH_DB_USER etc. in .env).
--   * pg_net + supabase_functions schema (webhooks.sql), the pg_cron/pg_net
--     event triggers (init-script 00000000000003) — Studio's Database
--     Webhooks page; this app has no webhooks.
--   * `alter database … set app.settings.jwt_secret` (jwt.sql) — read by
--     pgjwt-based SQL, which this app has none of.
--   * supautils-managed policies on realtime.* — Realtime's own README says
--     its migrations need a superuser, which is why Realtime in external
--     mode is "confirm on your project".

-- ── Report ────────────────────────────────────────────────────────────────
select rolname, rolcanlogin, rolbypassrls, rolinherit
  from pg_roles
 where rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
 order by rolname;
select current_setting('wal_level') as wal_level,
       exists (select 1 from pg_publication where pubname = 'supabase_realtime') as publication_present;
