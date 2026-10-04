/**
 * A value the brand's own guideline document states outranks a website read,
 * and loses to what a person typed - IN THE DATABASE.
 * ---------------------------------------------------------------------------
 * supabase/migrations/20261004120000_brand_document_origin.sql is EXECUTED here,
 * after the migration it amends (20260814100000_brand_context_packs.sql), on a
 * real Postgres (PGlite: Postgres compiled to WebAssembly, so the plpgsql below
 * runs exactly as Postgres runs it, with no server to start and no root
 * account to refuse). Nothing is asserted on the SQL text: every claim is a
 * function called and a row read back.
 *
 * What the operator asked for, as rows:
 *   - an AUTOMATIC run (brand_context_apply, the context pack / site parser's
 *     one door) skips a field a document set, as it always skipped a typed one;
 *   - a save records a document's field as `document`, not as typed
 *     (brand_fields_record_origin), and NEVER demotes: a typed field stays
 *     typed, a document's field is not replaced by a site read or a preset;
 *   - a newer document replaces an older one (equal rank);
 *   - only an editor of the workspace may record anything;
 *   - the brand-assets bucket exists with editor-scoped writes.
 *
 * Run: npx playwright test tests/brand-document-origin-sql.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIG = path.join(__dirname, '..', 'supabase', 'migrations');
const OWNER = '11111111-1111-4111-8111-111111111111';
const VIEWER = '22222222-2222-4222-8222-222222222222';
const WS = '33333333-3333-4333-8333-333333333333';

/* The platform a migration runs on: Supabase's auth.uid(), its storage
   schema, and the two tables/functions 20260814100000 builds on. Minimal, and
   faithful where the functions under test read it. */
const PLATFORM = `
  create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id bigserial primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  create table public.brand_workspaces (
    id uuid primary key, owner_id uuid, name text, tagline text, legal_name text, industry text,
    website text, logo_url text, favicon_url text,
    palette jsonb not null default '{}'::jsonb, typography jsonb not null default '{}'::jsonb,
    voice jsonb not null default '{}'::jsonb, regions jsonb not null default '[]'::jsonb,
    brand_data jsonb not null default '{}'::jsonb, updated_at timestamptz);
  create function public.is_brand_member(ws uuid, uid uuid) returns boolean language sql stable as $$
    select exists (select 1 from public.brand_workspaces w where w.id = ws and w.owner_id = uid) $$;
  create function public.is_brand_editor(ws uuid, uid uuid) returns boolean language sql stable as $$
    select exists (select 1 from public.brand_workspaces w where w.id = ws and w.owner_id = uid) $$;
`;

async function database() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(PLATFORM);
  await db.exec(fs.readFileSync(path.join(MIG, '20260814100000_brand_context_packs.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(MIG, '20261004120000_brand_document_origin.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(MIG, '20261004160000_brand_context_apply_by_origin.sql'), 'utf8'));
  await db.query(`insert into public.brand_workspaces (id, owner_id, name, palette) values ($1, $2, 'Harbourlight Goods', '{"primary":"#111111"}')`, [WS, OWNER]);
  return {
    db,
    as: async (uid) => db.exec(`set test.uid = '${uid}'`),
    one: async (sql, args) => (await db.query(sql, args || [])).rows[0],
    origin: async (field) => {
      const r = (await db.query('select origin, source_url, signal from public.brand_field_provenance where workspace_id = $1 and field = $2', [WS, field])).rows[0];
      return r || null;
    },
    palette: async () => (await db.query('select palette from public.brand_workspaces where id = $1', [WS])).rows[0].palette,
  };
}

test.describe.configure({ mode: 'serial' });

test('a document field is recorded as document, and the automatic door then skips it', async () => {
  const d = await database();
  await d.as(OWNER);
  const rec = await d.one(`select public.brand_fields_record_origin($1, $2::jsonb) as r`, [WS, JSON.stringify({
    'palette.primary': { origin: 'document', source_url: 'brand-book.pdf#page=3', signal: 'p.3 l.4: "Primary  HEX #D0473E"', value_preview: '#d0473e' },
  })]);
  expect(rec.r.recorded).toEqual(['palette.primary']);
  expect(await d.origin('palette.primary')).toEqual({ origin: 'document', source_url: 'brand-book.pdf#page=3', signal: 'p.3 l.4: "Primary  HEX #D0473E"' });

  // The site parser (a context pack) now tries to set the same field, and a
  // field nobody owns. The first is skipped, the second applied.
  const out = await d.one(`select public.brand_context_apply($1, $2::jsonb, '{}'::jsonb) as r`, [WS, JSON.stringify({
    'palette.primary': '#00a651', 'palette.accent': '#b8531f',
  })]);
  expect(out.r.skipped_user_owned).toEqual(['palette.primary']);
  expect(out.r.applied).toEqual(['palette.accent']);
  const pal = await d.palette();
  expect(pal.primary, 'a website read overwrote the document\'s value').toBe('#111111');
  expect(pal.accent).toBe('#b8531f');
  expect((await d.origin('palette.accent')).origin).toBe('auto');
});

test('the automatic door still skips a typed field, and still applies over its own earlier value', async () => {
  const d = await database();
  await d.as(OWNER);
  await d.db.query(`select public.brand_fields_claim_user($1, $2)`, [WS, ['tagline']]);
  const first = await d.one(`select public.brand_context_apply($1, $2::jsonb, '{}'::jsonb) as r`, [WS, JSON.stringify({ tagline: 'From the site', name: 'Harbourlight' })]);
  expect(first.r.skipped_user_owned).toEqual(['tagline']);
  expect(first.r.applied).toEqual(['name']);
  // auto over auto: a newer site read replaces an older one, as before.
  const again = await d.one(`select public.brand_context_apply($1, $2::jsonb, '{}'::jsonb) as r`, [WS, JSON.stringify({ name: 'Harbourlight Goods Co' })]);
  expect(again.r.applied).toEqual(['name']);
});

test('recording never demotes: typed stays typed, a site read or a preset never replaces a document', async () => {
  const d = await database();
  await d.as(OWNER);
  await d.db.query(`select public.brand_fields_claim_user($1, $2)`, [WS, ['name']]);
  await d.db.query(`select public.brand_fields_record_origin($1, $2::jsonb)`, [WS, JSON.stringify({ 'typography.heading': { origin: 'document', signal: 'p.5 l.2' } })]);
  const r = (await d.one(`select public.brand_fields_record_origin($1, $2::jsonb) as r`, [WS, JSON.stringify({
    name: { origin: 'document', signal: 'Brand name: Harbourlight' },
    'typography.heading': { origin: 'site-parse', signal: 'css h1' },
    'palette.surface': { origin: 'preset', signal: 'gallery' },
  })])).r;
  expect(r.recorded).toEqual(['palette.surface']);
  expect(r.kept).toEqual(expect.arrayContaining([{ field: 'name', origin: 'user' }, { field: 'typography.heading', origin: 'document' }]));
  expect((await d.origin('name')).origin).toBe('user');
  expect((await d.origin('typography.heading')).origin).toBe('document');
  // And the lower rungs, in order: a site render outranks a site parse, which
  // outranks a preset.
  await d.db.query(`select public.brand_fields_record_origin($1, $2::jsonb)`, [WS, JSON.stringify({ 'palette.surface': { origin: 'site-parse' } })]);
  expect((await d.origin('palette.surface')).origin).toBe('site-parse');
  await d.db.query(`select public.brand_fields_record_origin($1, $2::jsonb)`, [WS, JSON.stringify({ 'palette.surface': { origin: 'site-render' } })]);
  expect((await d.origin('palette.surface')).origin).toBe('site-render');
  const back = (await d.one(`select public.brand_fields_record_origin($1, $2::jsonb) as r`, [WS, JSON.stringify({ 'palette.surface': { origin: 'site-parse' } })])).r;
  expect(back.kept).toEqual([{ field: 'palette.surface', origin: 'site-render' }]);
});

test('a newer document replaces an older one; "user" and unknown origins are not accepted here', async () => {
  const d = await database();
  await d.as(OWNER);
  await d.db.query(`select public.brand_fields_record_origin($1, $2::jsonb)`, [WS, JSON.stringify({ tagline: { origin: 'document', signal: 'v1 p.1' } })]);
  await d.db.query(`select public.brand_fields_record_origin($1, $2::jsonb)`, [WS, JSON.stringify({ tagline: { origin: 'document', signal: 'v2 p.1' } })]);
  expect((await d.origin('tagline')).signal).toBe('v2 p.1');
  const r = (await d.one(`select public.brand_fields_record_origin($1, $2::jsonb) as r`, [WS, JSON.stringify({
    industry: { origin: 'user' }, website: { origin: 'made-up' },
  })])).r;
  expect(r.ignored.sort()).toEqual(['industry', 'website']);
  expect(await d.origin('industry')).toBeNull();
  // A typed claim still overrides a document - a person's newest decision wins.
  await d.db.query(`select public.brand_fields_claim_user($1, $2)`, [WS, ['tagline']]);
  expect((await d.origin('tagline')).origin).toBe('user');
});

test('only an editor of the workspace may record an origin', async () => {
  const d = await database();
  await d.as(VIEWER);
  let err = null;
  try {
    await d.db.query(`select public.brand_fields_record_origin($1, $2::jsonb)`, [WS, JSON.stringify({ tagline: { origin: 'document' } })]);
  } catch (e) { err = e; }
  expect(err && String(err.message)).toMatch(/not an editor/);
  await d.as(OWNER);
  expect(await d.origin('tagline')).toBeNull();
});

test('a save claims only typed fields as the operator\'s and records a document\'s fields as document, with page and line', async () => {
  // The shipped save path (brand-workspace-core.claimUserOwnedFields), with the
  // two RPCs it calls captured at the network.
  const core = require('../api/_shared/brand-workspace-core.js');
  const saved = { url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY };
  process.env.SUPABASE_URL = 'https://fixture.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse((init && init.body) || 'null') });
    return new Response('1', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const input = {
      name: 'Harbourlight Goods', tagline: 'Light, made by hand',
      palette: { primary: '#1a6b3c', accent: '#b8531f', ink: '#111111' },
      brand_data: { field_origins: {
        name: { origin: 'user' },
        tagline: { origin: 'document', source: 'book.pdf', page: 1, line: 3, quote: 'Tagline: Light, made by hand', value: 'light, made by hand' },
        'palette.primary': { origin: 'document', source: 'book.pdf', page: 2, line: 2, quote: 'Primary - Harbour Green / HEX #1A6B3C', value: '#1a6b3c' },
        'palette.accent': { origin: 'site-parse', url: 'https://harbourlight.example/', signal: 'css --brand-accent' },
        'palette.ink': { origin: 'default' },
      } },
    };
    await core.claimUserOwnedFields({ token: 'user-jwt', user_id: OWNER }, WS, input);
    const claim = calls.find((c) => /rpc\/brand_fields_claim_user$/.test(c.url));
    const record = calls.find((c) => /rpc\/brand_fields_record_origin$/.test(c.url));
    expect(claim.body.p_fields).toEqual(['name']);
    expect(Object.keys(record.body.p_fields).sort()).toEqual(['palette.accent', 'palette.primary', 'tagline']);
    expect(record.body.p_fields['palette.primary']).toEqual({ origin: 'document', source_url: 'book.pdf#page=2', signal: 'p.2 l.2: "Primary - Harbour Green / HEX #1A6B3C"', confidence: 'stated', value_preview: '#1a6b3c' });
    expect(record.body.p_fields['palette.accent'].origin).toBe('site-parse');
    // A save with no origins at all is read exactly as before: every field typed.
    calls.length = 0;
    await core.claimUserOwnedFields({ token: 'user-jwt', user_id: OWNER }, WS, { name: 'X', palette: { primary: '#1a6b3c' } });
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['brand_fields_claim_user']);
    expect(calls[0].body.p_fields).toEqual(['name', 'palette.primary']);
  } finally {
    global.fetch = real;
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.anon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = saved.anon;
  }
});

test('deleting an account brand removes its hosted files under its workspace prefix first, and refuses to orphan them', async () => {
  // The shipped deleteWorkspace, with PostgREST and Storage modelled at the network.
  const core = require('../api/_shared/brand-workspace-core.js');
  const saved = { url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY };
  process.env.SUPABASE_URL = 'https://fixture.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const real = global.fetch;
  const run = async (storageDelete, listing) => {
    const calls = [];
    global.fetch = async (url, init) => {
      const u = new URL(String(url));
      const method = (init && init.method) || 'GET';
      calls.push({ method, path: u.pathname, body: init && init.body ? JSON.parse(init.body) : null, auth: init && init.headers && init.headers.authorization });
      const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.pathname === '/rest/v1/brand_workspaces' && method === 'GET') return ok([{ id: WS, owner_id: OWNER, name: 'Harbourlight Goods' }]);
      if (u.pathname === '/storage/v1/object/list/brand-assets') {
        if (listing === 'down') throw new Error('fetch failed');
        if (listing === 500) return new Response('{"message":"internal"}', { status: 500 });
        if (listing === 'no-bucket') return new Response('{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}', { status: 400 });
        return ok([{ name: 'aaa.png', id: '1' }, { name: 'bbb.woff2', id: '2' }, { name: 'folder', id: null }]);
      }
      if (u.pathname === '/storage/v1/object/brand-assets' && method === 'DELETE') return storageDelete === 200 ? ok([]) : new Response('{"message":"denied"}', { status: storageDelete });
      if (u.pathname === '/rest/v1/brand_workspaces' && method === 'DELETE') return ok([{ id: WS, name: 'Harbourlight Goods' }]);
      throw new Error('unexpected request ' + method + ' ' + u.pathname);
    };
    let result = null, error = null;
    try { result = await core.deleteWorkspace({ token: 'user-jwt', user_id: OWNER }, WS); } catch (e) { error = e; }
    return { calls, result, error };
  };
  try {
    const okRun = await run(200);
    expect(okRun.error).toBeNull();
    expect(okRun.result.storage_removed).toBe(2);
    const order = okRun.calls.map((c) => c.method + ' ' + c.path);
    expect(order).toEqual(['GET /rest/v1/brand_workspaces', 'POST /storage/v1/object/list/brand-assets', 'DELETE /storage/v1/object/brand-assets', 'DELETE /rest/v1/brand_workspaces']);
    expect(okRun.calls[1].body).toMatchObject({ prefix: WS });
    expect(okRun.calls[2].body).toEqual({ prefixes: [`${WS}/aaa.png`, `${WS}/bbb.woff2`] });
    expect(okRun.calls[2].auth).toBe('Bearer user-jwt');
    // Storage refuses: the brand is NOT deleted, and the sentence says why.
    const refused = await run(403);
    expect(refused.error && refused.error.status).toBe(502);
    expect(refused.error.message).toMatch(/2 hosted file\(s\).*nothing was deleted/);
    expect(refused.calls.some((c) => c.method === 'DELETE' && c.path === '/rest/v1/brand_workspaces')).toBe(false);
    // The LISTING fails: an unanswered list is not an empty folder, so the
    // brand is not deleted either (the files it could not see would be orphaned).
    for (const listing of [500, 'down']) {
      const blind = await run(200, listing);
      expect(blind.error && blind.error.status, `listing ${listing}`).toBe(502);
      expect(blind.error.message).toMatch(/could not be listed.*nothing was deleted/);
      expect(blind.calls.some((c) => c.method === 'DELETE'), `listing ${listing}: something was deleted`).toBe(false);
    }
    // No bucket at all (the migration not applied): nothing can be in it.
    const none = await run(200, 'no-bucket');
    expect(none.error).toBeNull();
    expect(none.result.storage_removed).toBe(0);
    expect(none.calls.map((c) => c.method + ' ' + c.path)).toEqual(['GET /rest/v1/brand_workspaces', 'POST /storage/v1/object/list/brand-assets', 'DELETE /rest/v1/brand_workspaces']);
  } finally {
    global.fetch = real;
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.anon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = saved.anon;
  }
});

test('the brand-assets bucket is public-read with editor-scoped writes under the workspace prefix', async () => {
  const d = await database();
  const b = await d.one(`select id, public from storage.buckets where id = 'brand-assets'`);
  expect(b).toEqual({ id: 'brand-assets', public: true });
  const pols = (await d.db.query(`select policyname, cmd, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'brand_assets_%' order by policyname`)).rows;
  expect(pols.map((p) => p.policyname)).toEqual(['brand_assets_editor_delete', 'brand_assets_editor_update', 'brand_assets_editor_write', 'brand_assets_public_read']);
  const write = pols.find((p) => p.policyname === 'brand_assets_editor_write');
  expect(write.cmd).toBe('INSERT');
  expect(write.with_check).toMatch(/is_brand_editor/);
  expect(write.with_check).toMatch(/foldername/);
  // Re-running the migration is a no-op, not an error (idempotent, like every one here).
  await d.db.exec(fs.readFileSync(path.join(MIG, '20261004120000_brand_document_origin.sql'), 'utf8'));
  expect((await d.db.query(`select count(*)::int as n from pg_policies where policyname like 'brand_assets_%'`)).rows[0].n).toBe(4);
});

/* ═══ two tabs: a stale document save never overwrites what a person typed ══
   The SHIPPED saveWorkspace, over PostgREST modelled on the same PGlite
   database (the migrations executed, the updated_at trigger installed), so
   the PATCH, the claim and brand_context_apply run against real Postgres. A
   `before` hook lets a test land another tab's write at an exact point. */
async function saveWorld() {
  const d = await database();
  await d.db.exec(`
    alter table public.brand_workspaces
      add column if not exists slug text, add column if not exists asset_hosts jsonb not null default '[]'::jsonb,
      add column if not exists catalog_source jsonb not null default '{}'::jsonb, add column if not exists status text default 'draft',
      add column if not exists onboarding_step int default 1, add column if not exists created_at timestamptz default now();
    update public.brand_workspaces set tagline = 'Old line', palette = '{"primary":"#111111","accent":"#b8531f"}'::jsonb, updated_at = now();
    create or replace function public.touch_brand_workspace() returns trigger language plpgsql as $t$
      begin new.updated_at = clock_timestamp(); return new; end $t$;
    create trigger brand_workspaces_touch before update on public.brand_workspaces
      for each row execute function public.touch_brand_workspace();
  `);
  const JSONB = new Set(['palette', 'typography', 'voice', 'regions', 'asset_hosts', 'catalog_source', 'brand_data']);
  const calls = [];
  const hooks = { before: null };
  const real = global.fetch;
  global.fetch = async (url, init) => {
    const u = new URL(String(url));
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : null;
    const call = { method, path: u.pathname, query: u.search, body };
    calls.push(call);
    if (hooks.before) await hooks.before(call);
    await d.as(OWNER);
    const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    const eq = (k) => { const v = u.searchParams.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
    if (u.pathname === '/rest/v1/brand_workspaces' && method === 'GET') {
      const rows = (await d.db.query('select to_jsonb(w) as j from public.brand_workspaces w where id = $1', [eq('id')])).rows;
      return ok(rows.map((r) => r.j));
    }
    if (u.pathname === '/rest/v1/brand_workspaces' && method === 'PATCH') {
      const cols = Object.keys(body);
      const args = [eq('id')];
      const sets = cols.map((c) => { args.push(JSON.stringify(body[c]) === undefined ? null : (JSONB.has(c) ? JSON.stringify(body[c]) : body[c])); return `${c} = $${args.length}${JSONB.has(c) ? '::jsonb' : ''}`; });
      let where = 'id = $1';
      if (eq('updated_at')) { args.push(eq('updated_at')); where += ` and updated_at = $${args.length}::timestamptz`; }
      const rows = (await d.db.query(`update public.brand_workspaces w set ${sets.join(', ')} where ${where} returning to_jsonb(w) as j`, args)).rows;
      return ok(rows.map((r) => r.j));
    }
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
    if (rpc && rpc[1] === 'brand_fields_claim_user') {
      return ok((await d.db.query('select public.brand_fields_claim_user($1, $2::text[]) as r', [body.p_workspace, body.p_fields])).rows[0].r);
    }
    if (rpc && rpc[1] === 'brand_context_apply') {
      return ok((await d.db.query('select public.brand_context_apply($1, $2::jsonb, $3::jsonb) as r', [body.p_workspace, JSON.stringify(body.p_fields), JSON.stringify(body.p_source || {})])).rows[0].r);
    }
    if (rpc && rpc[1] === 'brand_fields_record_origin') {
      return ok((await d.db.query('select public.brand_fields_record_origin($1, $2::jsonb) as r', [body.p_workspace, JSON.stringify(body.p_fields)])).rows[0].r);
    }
    throw new Error('unexpected request ' + method + ' ' + u.pathname);
  };
  const saved = { url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY };
  process.env.SUPABASE_URL = 'https://fixture.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const core = require('../api/_shared/brand-workspace-core.js');
  const auth = { token: 'user-jwt', user_id: OWNER };
  return {
    d, core, auth, calls, hooks,
    row: async () => (await d.db.query('select to_jsonb(w) as j from public.brand_workspaces w where id = $1', [WS])).rows[0].j,
    restore() {
      global.fetch = real;
      if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
      if (saved.anon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = saved.anon;
    },
  };
}
const BOOK = { source: 'harbourlight-brand-book.pdf', page: 1, line: 3 };
const typedSave = (tagline) => ({ id: WS, name: 'Harbourlight Goods', tagline, palette: { primary: '#111111', accent: '#b8531f' },
  // The colours are the form's untouched placeholders (origin 'default'): nobody's.
  brand_data: { field_origins: { name: { origin: 'user' }, tagline: { origin: 'user' }, 'palette.primary': { origin: 'default' }, 'palette.accent': { origin: 'default' } } } });
const staleDocumentSave = () => ({ id: WS, name: 'Harbourlight Goods', tagline: 'Light, made by hand', palette: { primary: '#1a6b3c', accent: '#b8531f' },
  brand_data: { field_origins: { name: { origin: 'user' },
    tagline: Object.assign({ origin: 'document', quote: 'Tagline: Light, made by hand', value: 'Light, made by hand' }, BOOK),
    'palette.primary': Object.assign({ origin: 'document', quote: 'Primary - Harbour Green / HEX #1A6B3C', value: '#1a6b3c' }, BOOK, { page: 2, line: 2 }),
    'palette.accent': { origin: 'default' } } } });

test('two tabs: a stale tab saving a guideline document never overwrites a value the other tab typed, and the record never says a person typed a document value', async () => {
  const w = await saveWorld();
  try {
    // Tab B: the person types a tagline and saves.
    await w.core.saveWorkspace(w.auth, typedSave('Typed in tab B'));
    expect((await w.d.origin('tagline')).origin).toBe('user');
    // Tab A, opened before that, applies a brand book and saves its stale form.
    const out = await w.core.saveWorkspace(w.auth, staleDocumentSave());
    const row = await w.row();
    expect(row.tagline, 'the stale document save overwrote what tab B typed').toBe('Typed in tab B');
    expect((await w.d.origin('tagline')).origin).toBe('user');
    // A field nobody typed takes the document's value, recorded as the document's.
    expect(row.palette.primary).toBe('#1a6b3c');
    expect(await w.d.origin('palette.primary')).toMatchObject({ origin: 'document', source_url: 'harbourlight-brand-book.pdf#page=2' });
    // What a person owns was never in a write that could replace it: the PATCH
    // carried the row's own tagline, and the database refused the document's.
    const patch = w.calls.filter((c) => c.method === 'PATCH').pop();
    expect(patch.body.tagline).toBe('Typed in tab B');
    expect(patch.query).toMatch(/updated_at=eq\./);
    const apply = w.calls.filter((c) => /rpc\/brand_context_apply$/.test(c.path)).pop();
    expect(apply.body.p_source.tagline.origin).toBe('document');
    expect(out.tagline, 'the save answered with a value the database does not hold').toBe('Typed in tab B');
  } finally { w.restore(); }
});

test('two tabs, interleaved: a typed save that lands between the stale tab\'s read and its write is not lost, and the stale write retries on the fresh row', async () => {
  const w = await saveWorld();
  try {
    let landed = false;
    w.hooks.before = async (call) => {
      // Tab B's typed save lands exactly between tab A's read and tab A's PATCH.
      if (!landed && call.method === 'PATCH') {
        landed = true;
        w.hooks.before = null;
        await w.core.saveWorkspace(w.auth, typedSave('Typed in tab B, mid-save'));
      }
    };
    await w.core.saveWorkspace(w.auth, staleDocumentSave());
    expect(landed).toBe(true);
    const row = await w.row();
    expect(row.tagline).toBe('Typed in tab B, mid-save');
    expect((await w.d.origin('tagline')).origin).toBe('user');
    expect(row.palette.primary).toBe('#1a6b3c');
    // Tab A's first PATCH matched nothing (the row had moved on) and it read again.
    const aPatches = w.calls.filter((c) => c.method === 'PATCH');
    expect(aPatches.length).toBe(3);   // A (refused: stale), B, A (on the fresh row)
  } finally { w.restore(); }
});

test('an apply landing between a typed save\'s claim and its write cannot take the field: the claim comes first', async () => {
  const w = await saveWorld();
  try {
    let landed = false;
    w.hooks.before = async (call) => {
      // Tab A's document apply runs while tab B is between its claim and its PATCH.
      if (!landed && call.method === 'PATCH') {
        landed = true;
        w.hooks.before = null;
        await w.d.as(OWNER);
        const r = (await w.d.db.query(`select public.brand_context_apply($1, $2::jsonb, $3::jsonb) as r`, [WS, JSON.stringify({ tagline: 'Light, made by hand' }), JSON.stringify({ tagline: { origin: 'document' } })])).rows[0].r;
        expect(r.skipped_user_owned).toEqual(['tagline']);
      }
    };
    await w.core.saveWorkspace(w.auth, typedSave('Typed in tab B'));
    expect(landed).toBe(true);
    expect((await w.row()).tagline).toBe('Typed in tab B');
    expect((await w.d.origin('tagline')).origin).toBe('user');
  } finally { w.restore(); }
});

test('brand_context_apply by origin: a document outranks a site read, a site read cannot take a document value, equal ranks replace, and voice.banned opens only to a document or a template', async () => {
  const d = await database();
  await d.as(OWNER);
  const apply = async (fields, source) => (await d.db.query(`select public.brand_context_apply($1, $2::jsonb, $3::jsonb) as r`, [WS, JSON.stringify(fields), JSON.stringify(source || {})])).rows[0].r;
  // A site read first, then a document over it: the document wins and is recorded.
  expect((await apply({ 'palette.primary': '#00a651' }, { 'palette.primary': { origin: 'site-render', source_url: 'https://harbourlight.example/' } })).applied).toEqual(['palette.primary']);
  expect((await d.origin('palette.primary')).origin).toBe('site-render');
  expect((await apply({ 'palette.primary': '#1a6b3c' }, { 'palette.primary': { origin: 'document', source_url: 'book.pdf#page=2' } })).applied).toEqual(['palette.primary']);
  expect((await d.palette()).primary).toBe('#1a6b3c');
  // A site read (no origin sent: `auto`, every existing caller) cannot take it back.
  const back = await apply({ 'palette.primary': '#00a651' });
  expect(back.skipped_user_owned).toEqual(['palette.primary']);
  expect(back.kept).toEqual([{ field: 'palette.primary', origin: 'document' }]);
  expect((await apply({ 'palette.primary': '#00a651' }, { 'palette.primary': { origin: 'site-render' } })).skipped_user_owned).toEqual(['palette.primary']);
  // A newer document replaces an older one.
  expect((await apply({ 'palette.primary': '#0b5130' }, { 'palette.primary': { origin: 'document' } })).applied).toEqual(['palette.primary']);
  expect((await d.palette()).primary).toBe('#0b5130');
  // voice.banned: never from a site read, from a document or a template.
  expect((await apply({ 'voice.banned': ['hurry'] })).ignored_not_applicable).toEqual(['voice.banned']);
  expect((await apply({ 'voice.banned': ['hurry'] }, { 'voice.banned': { origin: 'site-render' } })).ignored_not_applicable).toEqual(['voice.banned']);
  expect((await apply({ 'voice.banned': ['hurry'] }, { 'voice.banned': { origin: 'document' } })).applied).toEqual(['voice.banned']);
  // An origin the door does not know (a person's claim is not made here) is ignored.
  expect((await apply({ tagline: 'X' }, { tagline: { origin: 'user' } })).ignored_not_applicable).toEqual(['tagline']);
});
