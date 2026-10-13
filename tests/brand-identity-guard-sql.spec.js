// @ts-check
/**
 * supabase/migrations/20261013010000_brand_identity_guard.sql, EXECUTED on
 * PGlite (real Postgres in WebAssembly), 2026-10-13.
 *
 * Root cause of the two mixed live rows (repaired by 20261012180000): one
 * workspace row was re-pointed and renamed from brand to brand (Mamaearth,
 * DelhiChic, Deli Chic, Lenskart), keeping its slug, palette and assets, and a
 * region code was saved as typed ("IND"). The app rule is tightened; this
 * trigger refuses the same writes from ANY writer. Asserted:
 *   - the Lenskart sequence, replayed, is refused at the re-point;
 *   - the same brand under another suffix, the mixed-record repair, a first
 *     website, and a name that fits its new site are allowed;
 *   - "IND" is refused; IN, UK, GLOBAL are not;
 *   - the operator-approved repair setting lets a repair through;
 *   - the SQL brand label equals brand-coherence.js's for a set of hosts;
 *   - the repair migration still applies with the trigger installed.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIG = path.join(__dirname, '..', 'supabase', 'migrations');
const GUARD = '20261013010000_brand_identity_guard.sql';
const C = require('../api/_shared/brand-coherence.js');

async function database() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`
    create table public.brand_workspaces (
      id uuid primary key default gen_random_uuid(), owner_id uuid, name text, slug text, website text,
      regions jsonb not null default '[]'::jsonb, brand_data jsonb not null default '{}'::jsonb);`);
  await db.exec(fs.readFileSync(path.join(MIG, GUARD), 'utf8'));
  const add = async (name, website, regions, bd) => (await db.query(
    'insert into public.brand_workspaces (name, website, regions, brand_data) values ($1, $2, $3, $4) returning id',
    [name, website, JSON.stringify(regions || [{ code: 'IN' }]), JSON.stringify(bd || {})])).rows[0].id;
  const set = (id, cols) => {
    const keys = Object.keys(cols);
    return db.query(`update public.brand_workspaces set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`,
      [id, ...keys.map((k) => (typeof cols[k] === 'object' ? JSON.stringify(cols[k]) : cols[k]))]);
  };
  const refused = async (p) => { try { await p; return null; } catch (e) { return String(e.message); } };
  return { db, add, set, refused };
}

test('the live Lenskart sequence, replayed: the re-point to another brand\'s site is refused, and the record is kept', async () => {
  const { db, add, set, refused } = await database();
  const id = await add('Deli Chic', 'https://delichic.co.in', [{ code: 'IN' }],
    { brand_extraction: { applied: { name: { value: 'Mamaearth', source_url: 'https://mamaearth.in/collections/x' } } } });
  const err = await refused(set(id, { name: 'Lenskart', website: 'https://www.lenskart.com' }));
  expect(err).toMatch(/brand_change_refused/);
  expect(err).toMatch(/start a new brand/);
  const row = (await db.query('select name, website from public.brand_workspaces where id = $1', [id])).rows[0];
  expect(row).toEqual({ name: 'Deli Chic', website: 'https://delichic.co.in' });
});

test('allowed: the same brand under another suffix, a corporate sibling, a first website, the site the current name fits', async () => {
  const { add, set, refused } = await database();
  const nike = await add('Nike', 'https://www.nike.in');
  expect(await refused(set(nike, { website: 'https://www.nike.com/in' }))).toBeNull();
  expect(await refused(set(nike, { website: 'https://about.nikeinc.com' }))).toBeNull();
  const blank = await add('Lenskart', '');
  expect(await refused(set(blank, { website: 'https://www.lenskart.com' }))).toBeNull();
  // A typo'd website corrected to the one the name fits.
  const typo = await add('The Times of India', 'https://www.tmesofindia.example');
  expect(await refused(set(typo, { website: 'https://timesofindia.indiatimes.com' }))).toBeNull();
});

test('allowed: the repair of a mixed record, to the site its name was read from', async () => {
  const { add, set, refused } = await database();
  const id = await add('Mamaearth', 'https://www.nike.in', [{ code: 'IN' }],
    { field_origins: { name: { origin: 'site-parse', url: 'https://mamaearth.in/' } } });
  expect(await refused(set(id, { website: 'https://mamaearth.in' }))).toBeNull();
});

test('a region code that is not one market spelling is refused, on insert and on update', async () => {
  const { add, set, refused } = await database();
  expect(await refused(add('Nykaa', 'https://www.nykaa.com', [{ code: 'IND' }]))).toMatch(/region_code_invalid.*IND/);
  const id = await add('Nykaa', 'https://www.nykaa.com', [{ code: 'IN' }, { code: 'UK' }, { code: 'GLOBAL' }]);
  expect(await refused(set(id, { regions: [{ code: 'india' }] }))).toMatch(/region_code_invalid/);
});

test('an operator-approved repair runs with the repair setting, inside its own transaction only', async () => {
  const { db, add, refused } = await database();
  const id = await add('Deli Chic', 'https://delichic.co.in');
  await db.exec(`begin; select set_config('lifecycle.brand_repoint', 'repair', true);
    update public.brand_workspaces set website = 'https://www.lenskart.com', name = 'Lenskart' where id = '${id}'; commit;`);
  expect((await db.query('select website from public.brand_workspaces where id = $1', [id])).rows[0].website).toBe('https://www.lenskart.com');
  // The setting was local to that transaction.
  expect(await refused(db.query(`update public.brand_workspaces set website = 'https://delichic.co.in' where id = $1`, [id]))).toMatch(/brand_change_refused/);
});

test('parity: the SQL brand label is brand-coherence.js\'s for every host shape', async () => {
  const { db } = await database();
  const hosts = ['www.nike.in', 'nike.com', 'shop.nike.co.in', 'www.lenskart.sg', 'store.myshopify.com', 'a.b.store.myshopify.com',
    'timesofindia.indiatimes.com', 'delichic.co.in', 'www.mamaearth.in', 'news.bbc.co.uk', 'localhost', 'www.example.com.au', 'x.co.th'];
  for (const h of hosts) {
    const fromSql = (await db.query('select public.lc_brand_label($1) as l', [h])).rows[0].l;
    const reg = C.registrableDomain(h);
    const js = reg.indexOf('.') >= 0 ? reg.split('.')[0] : reg;
    expect(fromSql, h).toBe(js);
  }
});

test('the repair migration of 2026-10-12 still applies over the live rows with the guard installed', async () => {
  const ROWS = require('./fixtures/live-mixed-brands-2026-10-11.json');
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id bigserial primary key, bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select array[]::text[] $$;
    create table public.brand_workspaces (
      id uuid primary key, owner_id uuid, name text, slug text, status text, tagline text, legal_name text, industry text,
      website text, logo_url text, favicon_url text, onboarding_step int,
      palette jsonb not null default '{}'::jsonb, typography jsonb not null default '{}'::jsonb,
      voice jsonb not null default '{}'::jsonb, regions jsonb not null default '[]'::jsonb,
      brand_data jsonb not null default '{}'::jsonb, catalog_source jsonb not null default '{}'::jsonb,
      asset_hosts jsonb not null default '[]'::jsonb, created_at timestamptz, updated_at timestamptz, unique (owner_id, slug));
    create function public.is_brand_member(ws uuid, uid uuid) returns boolean language sql stable as $$ select true $$;
    create function public.is_brand_editor(ws uuid, uid uuid) returns boolean language sql stable as $$ select true $$;
    create table public.brand_catalog_products (id bigserial primary key, workspace_id uuid, title text, source_url text, product_url text, stale_at timestamptz);`);
  for (const f of ['20260814100000_brand_context_packs.sql', '20261004120000_brand_document_origin.sql']) await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
  for (const r of ROWS) {
    await db.query(`insert into public.brand_workspaces (id, owner_id, name, slug, status, website, palette, typography, voice, regions, brand_data, catalog_source, asset_hosts)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [r.id, r.owner_id, r.name, r.slug, r.status, r.website, r.palette, r.typography, r.voice, r.regions, r.brand_data, r.catalog_source || {}, JSON.stringify(r.asset_hosts || [])]);
  }
  await db.exec(fs.readFileSync(path.join(MIG, GUARD), 'utf8'));
  await db.exec(fs.readFileSync(path.join(MIG, '20261012180000_repair_mixed_brand_records.sql'), 'utf8'));
  const nykaa = (await db.query("select regions from public.brand_workspaces where name = 'Nykaa'")).rows[0];
  expect(nykaa.regions.map((x) => x.code)).toEqual(['IN']);
});

/* ── the runtime assertion: the app rule the trigger backs up ─────────────── */

test('runtime: an UNestablished record is no longer re-pointed or renamed into another brand (it was, and that is how the live row mixed)', () => {
  // The live row's state on 2026-10-05: named Mamaearth (read from mamaearth.in),
  // website on nike.in - a mixed record, so NOT established at its site.
  const mixed = { name: 'Mamaearth', website: 'https://www.nike.in',
    brand_data: { brand_extraction: { applied: { name: { value: 'Mamaearth', source_url: 'https://mamaearth.in/collections/x' } } } } };
  const re = C.identityChangeRefusal({ name: 'Deli Chic', website: 'https://delichic.co.in' }, mixed);
  expect(re && re.code, 'the next step the live row took: re-pointed at a third brand').toBe('brand_change_refused');
  expect(re.message).toMatch(/start a new brand/);
  const rename = C.identityChangeRefusal({ name: 'DelhiChic' }, mixed);
  expect(rename && rename.code, 'a name unrelated to the site and to the old name').toBe('brand_change_refused');
  // An established record (name fits its site) is refused as before.
  const est = { name: 'Deli Chic', website: 'https://delichic.co.in' };
  expect((C.identityChangeRefusal({ name: 'Lenskart', website: 'https://www.lenskart.com' }, est) || {}).code).toBe('brand_change_refused');
  // Still allowed: the repair to the name's own site, a variant spelling, a name that fits the site.
  expect(C.identityChangeRefusal({ website: 'https://mamaearth.in' }, { name: 'Mamaearth', website: 'https://www.nike.in',
    brand_data: { field_origins: { name: { origin: 'site-parse', url: 'https://mamaearth.in/' } } } })).toBeNull();
  expect(C.identityChangeRefusal({ name: 'Mamaearth India' }, mixed), 'shares a word with the old name').toBeNull();
  expect(C.identityChangeRefusal({ name: 'Nike' }, mixed), 'fits the site').toBeNull();
  expect(C.identityChangeRefusal({ website: 'https://www.nike.com' }, mixed), 'same brand, other suffix').toBeNull();
  expect(C.identityChangeRefusal({ name: 'Deli Chic Foods' }, est), 'an established record: shares a word').toBeNull();
});

test('runtime: a region code is saved as the one market spelling (IND -> IN, GB -> UK), on the server path', () => {
  const core = require('../api/_shared/brand-workspace-core.js');
  expect(core.normalizeRegions([{ code: 'IND' }, { code: 'gb' }, { code: 'global' }]).map((r) => r.code)).toEqual(['IN', 'UK', 'GLOBAL']);
});
