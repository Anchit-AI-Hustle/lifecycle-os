// supabase/migrations/20261009230000_close_always_true_brand_policies.sql, EXECUTED on real Postgres
// (PGlite: Postgres compiled to WebAssembly).
//
// Measured on the hosted project on 2026-10-09: 64 brand tables still carried permissive
// `using (true)` / `with check (true)` policies for PUBLIC beside their is_brand_member() ones.
// Permissive policies are OR'd, so anyone with the publishable key could read, insert,
// update and delete every brand's rows. This spec builds that shape, with the policy names
// the real migrations used, runs the migration, and then asks the database as each role:
//   - anon reads and writes nothing in a brand table;
//   - a member of brand A sees and changes only A's rows, and cannot insert into B;
//   - a shared table keeps its public READ, loses its public WRITE;
//   - the /lp/:id tables (smart_generated_campaigns) keep their anon read on purpose;
//   - a table with RLS off gets it turned on;
//   - a second run is a no-op.
//
// Run: npx playwright test tests/close-open-policies-sql.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migrations', '20261009230000_close_always_true_brand_policies.sql');
const A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const B = 'bbbbbbbb-0000-0000-0000-00000000000b';
const UA = '11111111-1111-1111-1111-111111111111';

const SCHEMA = `
  create schema auth;
  create role authenticated;
  create role anon;
  create role service_role bypassrls;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  create table public.brand_workspaces (id uuid primary key, owner_id uuid not null);
  create function public.is_brand_member(ws uuid, uid uuid) returns boolean language sql stable security definer as $$
    select exists (select 1 from public.brand_workspaces w where w.id = ws and w.owner_id = uid)
  $$;
  insert into public.brand_workspaces values ('${A}', '${UA}'), ('${B}', '22222222-2222-2222-2222-222222222222');

  -- a brand table, with the policies the old migrations left (names as on the hosted project)
  create table public.ads_generated (id serial primary key, workspace_id uuid, name text);
  alter table public.ads_generated enable row level security;
  create policy ads_read  on public.ads_generated for select using (true);
  create policy ads_write on public.ads_generated for insert with check (true);
  create policy ads_upd   on public.ads_generated for update using (true) with check (true);
  create policy ads_del   on public.ads_generated for delete using (true);
  create policy ads_generated_ws_read   on public.ads_generated for select using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
  create policy ads_generated_ws_insert on public.ads_generated for insert with check (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
  create policy ads_generated_ws_update on public.ads_generated for update using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
  create policy ads_generated_ws_delete on public.ads_generated for delete using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
  create policy "anon read mailers" on public.ads_generated for select to anon using (true);
  create policy svc on public.ads_generated for all to service_role using (true) with check (true);

  -- a shared reference table: its read stays public, its writes go
  create table public.smart_festivals_global (id serial primary key, name text);
  alter table public.smart_festivals_global enable row level security;
  create policy fest_read  on public.smart_festivals_global for select using (true);
  create policy fest_write on public.smart_festivals_global for insert with check (true);

  -- /lp/:id serves this on the anon key by design: untouched
  create table public.smart_generated_campaigns (id serial primary key, workspace_id uuid);
  alter table public.smart_generated_campaigns enable row level security;
  create policy sgc_read on public.smart_generated_campaigns for select using (true);

  -- a table that never had RLS
  create table public.ci_notification_log (id serial primary key, workspace_id uuid);

  grant all on all tables in schema public to anon, authenticated;
  grant all on all sequences in schema public to anon, authenticated;
  insert into public.ads_generated (workspace_id, name) values ('${A}', 'a1'), ('${B}', 'b1');
  insert into public.smart_festivals_global (name) values ('diwali');
  insert into public.smart_generated_campaigns (workspace_id) values ('${B}');
`;

async function boot() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(SCHEMA);
  return db;
}

// Run one statement as a role (and, for authenticated, as a user) inside a rolled-back transaction.
async function as(db, role, uid, sql) {
  await db.exec('begin');
  try {
    await db.exec(`set local test.uid = '${uid || ''}'`);
    await db.exec(`set local role ${role}`);
    const r = await db.query(sql);
    return { rows: r.rows, affected: r.affectedRows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec('rollback');
  }
}

const policyNames = async (db, table) =>
  (await db.query(`select policyname from pg_policies where schemaname='public' and tablename=$1 order by 1`, [table])).rows.map((r) => r.policyname);

test.describe('20261009230000 closes the always-true policies', () => {
  test('before: the old policies let anon read every brand (the defect this migration exists for)', async () => {
    const db = await boot();
    const r = await as(db, 'anon', null, 'select name from public.ads_generated order by name');
    expect(r.rows.map((x) => x.name)).toEqual(['a1', 'b1']);
  });

  test('after: anon reads and writes nothing; a member sees and changes only its own brand', async () => {
    const db = await boot();
    await db.exec(fs.readFileSync(MIGRATION, 'utf8'));

    const anonRead = await as(db, 'anon', null, 'select count(*)::int n from public.ads_generated');
    expect(anonRead.rows[0].n).toBe(0);
    const anonWrite = await as(db, 'anon', null, `insert into public.ads_generated (workspace_id, name) values ('${A}', 'x')`);
    expect(anonWrite.error).toMatch(/row-level security/);

    const mine = await as(db, 'authenticated', UA, 'select name from public.ads_generated order by name');
    expect(mine.rows.map((x) => x.name)).toEqual(['a1']);
    const touchB = await as(db, 'authenticated', UA, `update public.ads_generated set name='x' where workspace_id='${B}'`);
    expect(touchB.affected).toBe(0);
    const delB = await as(db, 'authenticated', UA, `delete from public.ads_generated where workspace_id='${B}'`);
    expect(delB.affected).toBe(0);
    const intoB = await as(db, 'authenticated', UA, `insert into public.ads_generated (workspace_id, name) values ('${B}', 'x')`);
    expect(intoB.error).toMatch(/row-level security/);
    const noWs = await as(db, 'authenticated', UA, `insert into public.ads_generated (name) values ('x')`);
    expect(noWs.error).toMatch(/row-level security/);
    const intoA = await as(db, 'authenticated', UA, `insert into public.ads_generated (workspace_id, name) values ('${A}', 'a2')`);
    expect(intoA.error).toBeUndefined();

    // Only the always-true policies went; the membership ones and the service role's stay.
    expect(await policyNames(db, 'ads_generated')).toEqual([
      'ads_generated_ws_delete', 'ads_generated_ws_insert', 'ads_generated_ws_read', 'ads_generated_ws_update', 'svc',
    ]);
  });

  test('a shared table keeps its public read and loses its public write; /lp/:id stays readable; RLS is turned on', async () => {
    const db = await boot();
    await db.exec(fs.readFileSync(MIGRATION, 'utf8'));

    expect(await policyNames(db, 'smart_festivals_global')).toEqual(['fest_read']);
    const read = await as(db, 'anon', null, 'select count(*)::int n from public.smart_festivals_global');
    expect(read.rows[0].n).toBe(1);
    const write = await as(db, 'anon', null, `insert into public.smart_festivals_global (name) values ('x')`);
    expect(write.error).toMatch(/row-level security/);

    expect(await policyNames(db, 'smart_generated_campaigns')).toEqual(['sgc_read']);
    const lp = await as(db, 'anon', null, 'select count(*)::int n from public.smart_generated_campaigns');
    expect(lp.rows[0].n).toBe(1);

    const rls = await db.query(`select relrowsecurity from pg_class where relname='ci_notification_log'`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const anonLog = await as(db, 'anon', null, 'select count(*)::int n from public.ci_notification_log');
    expect(anonLog.rows[0].n).toBe(0);
  });

  test('a second run changes nothing', async () => {
    const db = await boot();
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    await db.exec(sql);
    const before = (await db.query(`select tablename, policyname from pg_policies where schemaname='public' order by 1,2`)).rows;
    await db.exec(sql);
    const after = (await db.query(`select tablename, policyname from pg_policies where schemaname='public' order by 1,2`)).rows;
    expect(after).toEqual(before);
  });
});
