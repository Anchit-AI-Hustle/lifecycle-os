/**
 * A verified webhook delivery is RECORDED once and PROCESSED once - in the
 * database (2026-10-04, review of #132).
 * ---------------------------------------------------------------------------
 * supabase/migrations/20261004180000_social_inbound_processing.sql is EXECUTED
 * here, after the migration it amends (20261004150000_social_gateway.sql), on
 * a real Postgres (PGlite). Nothing is asserted on the SQL text: every claim is
 * a row written and read back.
 *
 *   - a row recorded BEFORE the migration takes `received`, so a late
 *     redelivery of it resumes rather than being dropped;
 *   - a new row starts `received` with no attempts;
 *   - status is one of received / processed / failed, and nothing else;
 *   - the migration is idempotent (applied twice, no error, no change).
 *
 * Run: npx playwright test tests/social-inbound-processing-sql.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIG = path.join(__dirname, '..', 'supabase', 'migrations');
const WS = '33333333-3333-4333-8333-333333333333';

/* What 20261004150000 builds on: Supabase's roles and auth.uid(), the brand
   workspace table and its membership functions, and dispatch_jobs. */
const PLATFORM = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.brand_workspaces (id uuid primary key, owner_id uuid);
  create table public.dispatch_jobs (id uuid primary key default gen_random_uuid());
  create function public.is_brand_member(ws uuid, uid uuid) returns boolean language sql stable as $$
    select exists (select 1 from public.brand_workspaces w where w.id = ws and w.owner_id = uid) $$;
  create function public.is_brand_editor(ws uuid, uid uuid) returns boolean language sql stable as $$
    select exists (select 1 from public.brand_workspaces w where w.id = ws and w.owner_id = uid) $$;
`;
const read = (f) => fs.readFileSync(path.join(MIG, f), 'utf8');

test('the processing state: an existing row resumes, a new row starts received, only three states exist, and the migration is idempotent', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(PLATFORM);
  await db.exec(read('20261004150000_social_gateway.sql'));
  await db.query(`insert into public.brand_workspaces (id) values ($1)`, [WS]);
  // Recorded before the migration: whether its ingest finished is not known.
  await db.query(`insert into public.social_inbound_events (workspace_id, provider, event_id) values ($1, 'meta', 'sha256:before')`, [WS]);

  await db.exec(read('20261004180000_social_inbound_processing.sql'));
  const before = (await db.query(`select status, attempts, last_error, processed_at from public.social_inbound_events where event_id = 'sha256:before'`)).rows[0];
  expect(before).toEqual({ status: 'received', attempts: 0, last_error: null, processed_at: null });

  await db.query(`insert into public.social_inbound_events (workspace_id, provider, event_id) values ($1, 'tiktok', 'sha256:new')`, [WS]);
  expect((await db.query(`select status, attempts from public.social_inbound_events where event_id = 'sha256:new'`)).rows[0]).toEqual({ status: 'received', attempts: 0 });

  // The receiver's two outcomes are accepted; anything else is refused.
  await db.query(`update public.social_inbound_events set status = 'failed', attempts = 1, last_error = 'dispatch store down' where event_id = 'sha256:new'`);
  await db.query(`update public.social_inbound_events set status = 'processed', attempts = 2, processed_at = now() where event_id = 'sha256:new'`);
  await expect(db.query(`update public.social_inbound_events set status = 'done' where event_id = 'sha256:new'`)).rejects.toThrow(/social_inbound_events_status_check/);
  await expect(db.query(`insert into public.social_inbound_events (provider, event_id, status) values ('meta', 'sha256:x', 'skipped')`)).rejects.toThrow(/social_inbound_events_status_check/);

  // Still one event per (provider, event_id): the dedupe the resume relies on.
  await expect(db.query(`insert into public.social_inbound_events (provider, event_id) values ('tiktok', 'sha256:new')`)).rejects.toThrow(/duplicate key/);

  // Applied again: no error, nothing changed.
  await db.exec(read('20261004180000_social_inbound_processing.sql'));
  const rows = (await db.query(`select event_id, status, attempts from public.social_inbound_events order by event_id`)).rows;
  expect(rows).toEqual([{ event_id: 'sha256:before', status: 'received', attempts: 0 }, { event_id: 'sha256:new', status: 'processed', attempts: 2 }]);
  const idx = (await db.query(`select indexname from pg_indexes where tablename = 'social_inbound_events' and indexname = 'social_inbound_events_unprocessed_idx'`)).rows;
  expect(idx).toHaveLength(1);
  await db.close();
});
