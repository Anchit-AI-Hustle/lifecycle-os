// @ts-check
/**
 * supabase/migrations/20261012180000_repair_mixed_brand_records.sql, EXECUTED
 * (2026-10-12) on PGlite (real Postgres in WebAssembly) over the two live rows
 * it repairs, as read-only SELECTs returned them on 2026-10-11
 * (tests/fixtures/live-mixed-brands-2026-10-11.json; the owner id replaced).
 *
 * The operator approved the repair and chose to ship it as a migration. What
 * is asserted: each record afterwards describes its own brand by the coherence
 * rule itself (brand-coherence.js), the values read from another site are KEPT
 * in coherence.set_aside rather than deleted, a provenance origin the table's
 * own check refuses is never written, a second run changes nothing, and a
 * database without these rows is left as it was.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIG = path.join(__dirname, '..', 'supabase', 'migrations');
const REPAIR = '20261012180000_repair_mixed_brand_records.sql';
const ROWS = require('./fixtures/live-mixed-brands-2026-10-11.json');
const C = require('../api/_shared/brand-coherence.js');
// The live project's own column types (read-only, information_schema). The
// first version of this spec declared asset_hosts as text[]; the live column is
// jsonb, so the migration passed here and failed in the project (2026-10-12).
const LIVE_COLUMNS = require('./fixtures/live-brand-columns-2026-10-12.json');

const PLATFORM = `
  create role authenticated; create role anon;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id bigserial primary key, bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select array[]::text[] $$;
  create table public.brand_workspaces (
    id uuid primary key, owner_id uuid, name text, slug text, status text, tagline text, legal_name text, industry text,
    website text, logo_url text, favicon_url text, onboarding_step int,
    palette jsonb not null default '{}'::jsonb, typography jsonb not null default '{}'::jsonb,
    voice jsonb not null default '{}'::jsonb, regions jsonb not null default '[]'::jsonb,
    brand_data jsonb not null default '{}'::jsonb, catalog_source jsonb not null default '{}'::jsonb,
    asset_hosts jsonb not null default '[]'::jsonb, created_at timestamptz, updated_at timestamptz,
    unique (owner_id, slug));
  create function public.is_brand_member(ws uuid, uid uuid) returns boolean language sql stable as $$ select true $$;
  create function public.is_brand_editor(ws uuid, uid uuid) returns boolean language sql stable as $$ select true $$;
  create table public.brand_catalog_products (id bigserial primary key, workspace_id uuid, title text, source_url text, product_url text, stale_at timestamptz);
`;

async function database(withRows) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(PLATFORM);
  for (const f of ['20260814100000_brand_context_packs.sql', '20261004120000_brand_document_origin.sql']) {
    await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
  }
  if (withRows) {
    for (const r of ROWS) {
      await db.query(`insert into public.brand_workspaces (id, owner_id, name, slug, status, tagline, legal_name, industry, website, logo_url, favicon_url,
        onboarding_step, palette, typography, voice, regions, brand_data, catalog_source, asset_hosts, created_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [r.id, r.owner_id, r.name, r.slug, r.status, r.tagline, r.legal_name, r.industry, r.website, r.logo_url, r.favicon_url,
        r.onboarding_step, r.palette, r.typography, r.voice, r.regions, r.brand_data, r.catalog_source || {}, JSON.stringify(r.asset_hosts || []), r.created_at, r.updated_at]);
    }
    const L = ROWS.find((x) => x.name === 'Lenskart');
    await db.query(`insert into public.brand_catalog_products (workspace_id, title, source_url) values ($1, 'Chicken Salami', 'https://delichic.co.in/products/salami'), ($1, 'Round Frames', 'https://www.lenskart.com/round.html')`, [L.id]);
  }
  const run = () => db.exec(fs.readFileSync(path.join(MIG, REPAIR), 'utf8'));
  const row = async (name) => (await db.query('select * from public.brand_workspaces where name = $1', [name])).rows[0];
  return { db, run, row };
}

// Values on the record read from a page on another site (the coherence rule's
// own attribution). Before the repair the coherence check could NOT see them:
// the record's provenance had been relabelled as this site's - the defect.
const foreignApplied = (rec, own) => Object.entries(((rec.brand_data || {}).brand_extraction || {}).applied || {})
  .filter(([, v]) => { try { return !C.sameBrand(C.registrableDomain(new URL(v.source_url).host), own); } catch (_) { return false; } })
  .map(([k]) => k);
test('the tables here have the live project\'s column types', async () => {
  const { db } = await database(false);
  for (const table of ['brand_workspaces', 'brand_catalog_products']) {
    const rows = (await db.query(`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1`, [table])).rows;
    const here = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
    for (const [col, type] of Object.entries(LIVE_COLUMNS[table])) expect(here[col], table + '.' + col).toBe(type);
  }
});

const blocking = (rec) => (C.brandCoherence(rec).conflicts || []).filter((c) => c.severity === 'block');

test('the live rows are mixed before the repair (the fixture is what the repair is for)', async () => {
  const { row } = await database(true);
  const L = await row('Lenskart');
  expect(L.slug).toBe('mamaearth');
  expect(L.palette.primary).toBe('#ffa517');
  expect(foreignApplied(L, 'lenskart.com').length, 'values read from another site sit on the record').toBeGreaterThan(0);
  expect((await row('Nykaa')).slug).toBe('othertea-teas');
});

test('after the repair each record describes its own brand, and what came from another site is kept, not deleted', async () => {
  const { db, run, row } = await database(true);
  await run();
  const L = await row('Lenskart');
  expect(L.slug).toBe('lenskart');
  expect(L.palette.primary).toBe('#000042');
  expect(Array.isArray(L.asset_hosts)).toBe(true);
  expect(L.asset_hosts.every((h) => C.sameBrand(C.registrableDomain(h), 'lenskart.com'))).toBe(true);
  expect(blocking(L), JSON.stringify(blocking(L))).toEqual([]);
  expect(foreignApplied(L, 'lenskart.com')).toEqual([]);
  const aside = L.brand_data.coherence.set_aside;
  expect(aside.length).toBeGreaterThan(0);
  expect(aside.every((a) => !C.sameBrand(C.registrableDomain(new URL(a.source_url).host), 'lenskart.com'))).toBe(true);
  expect(L.brand_data.coherence.accepted).toEqual([]);
  // Another brand's products stay in the table, staled; its own are untouched.
  const prods = (await db.query('select title, stale_at from public.brand_catalog_products order by title')).rows;
  expect(prods.find((p) => p.title === 'Chicken Salami').stale_at).not.toBeNull();
  expect(prods.find((p) => p.title === 'Round Frames').stale_at).toBeNull();
  // Provenance: only origins the table's own check admits; the neutral body face has none.
  const prov = (await db.query('select field, origin from public.brand_field_provenance where workspace_id = $1', [L.id])).rows;
  expect(prov.find((p) => p.field === 'palette.primary').origin).toBe('site-render');
  expect(prov.find((p) => p.field === 'typography.body')).toBeUndefined();

  const N = await row('Nykaa');
  expect(N.slug).toBe('nykaa');
  expect(N.regions.map((r) => r.code)).toEqual(['IN']);
  expect(N.catalog_source.region).toBe('in');
  expect(blocking(N), JSON.stringify(blocking(N))).toEqual([]);
  expect(foreignApplied(N, 'nykaa.com')).toEqual([]);
});

test('a second run changes nothing, and a database without these rows is untouched', async () => {
  const { db, run, row } = await database(true);
  await run();
  const once = await row('Lenskart');
  await run();
  const twice = await row('Lenskart');
  expect(twice.brand_data.coherence.set_aside.length).toBe(once.brand_data.coherence.set_aside.length);
  expect(twice.brand_data.coherence.repairs.length).toBe(1);
  expect(twice.updated_at).toEqual(once.updated_at);

  const empty = await database(false);
  await empty.run();
  expect((await empty.db.query('select count(*)::int as n from public.brand_workspaces')).rows[0].n).toBe(0);
  expect((await empty.db.query('select count(*)::int as n from public.brand_field_provenance')).rows[0].n).toBe(0);
});
