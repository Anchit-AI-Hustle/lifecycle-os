#!/usr/bin/env node
'use strict';
/**
 * selfhost-check.js — smoke test a running self-hosted stack, PASS/FAIL per line.
 * ---------------------------------------------------------------------------
 *   node scripts/selfhost-check.js                   reads selfhost/.env
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/selfhost-check.js
 *
 * What is checked, and why each line is there:
 *   mode        which DB_MODE selfhost/.env declares and where POSTGRES_HOST
 *               points — printed first so a FAIL below is read in context.
 *   auth        GET /auth/v1/health answers (the same probe auth.js sends).
 *   rest        GET /rest/v1/ with the ANON key is 200: Kong accepted the key
 *               and PostgREST is connected to the database.
 *   service     a service-role SELECT on brand_workspaces returns rows or [] —
 *               the key's `role` claim switched PostgREST into service_role.
 *   rls         an ANON select on brand_workspaces returns [] AND pg_class
 *               says row security is on for it. The second half matters:
 *               an empty table would make the first half pass on its own.
 *   bypassrls   pg_roles.rolbypassrls for service_role. Local: true. On a
 *               managed Postgres it is usually false (superuser needed) —
 *               reported, with the consequence, not hidden.
 *   realtime    a WebSocket to /realtime/v1/websocket opens and answers a
 *               Phoenix heartbeat. Also reports wal_level and the publication.
 *   storage     GET /storage/v1/bucket with the service key lists buckets, and
 *               the six this app uses are present.
 *
 * Structural checks run through postgres-meta (/pg/query, service key only,
 * the route Studio uses), so no psql is needed on the machine running this.
 */

const lib = require('./lib/selfhost-compose.js');
const { BUCKETS } = require('./selfhost-buckets.js');

const out = [];
function line(name, ok, detail, { warn = false } = {}) {
  const tag = ok ? 'PASS' : warn ? 'WARN' : 'FAIL';
  out.push({ name, ok: ok || warn, tag });
  console.log(`${tag}  ${name.padEnd(10)} ${detail || ''}`);
}

async function main() {
  let base = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let env = null;
  try { env = lib.loadKitEnv(); } catch (_) { /* running against a URL only */ }
  if (env) { base = base || env.SUPABASE_PUBLIC_URL; anon = anon || env.ANON_KEY; service = service || env.SERVICE_ROLE_KEY; }
  if (!base || !anon || !service) { console.error('need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (or selfhost/.env)'); process.exit(2); }
  base = base.replace(/\/+$/, '');

  // ── mode ──
  if (env) {
    const m = lib.dbMode(env);
    const where = m.mode === 'external' ? `POSTGRES_HOST=${env.POSTGRES_HOST} sslmode=${env.POSTGRES_SSLMODE}` : 'db container (supabase/postgres)';
    line('mode', m.problems.length === 0, `${m.mode} — ${where}${m.problems.length ? ' — ' + m.problems.join('; ') : ''}`);
  } else {
    console.log('mode        (no selfhost/.env read — checking the URL only)');
  }
  console.log(`target      ${base}`);

  const H = (key, extra) => ({ apikey: key, Authorization: `Bearer ${key}`, ...(extra || {}) });
  const get = async (path, key, extra) => {
    const r = await fetch(base + path, { headers: key ? H(key, extra) : (extra || {}) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: r.status, text, json };
  };
  const pgQuery = async (query) => {
    const r = await fetch(`${base}/pg/query`, { method: 'POST', headers: H(service, { 'Content-Type': 'application/json' }), body: JSON.stringify({ query }) });
    const text = await r.text();
    if (r.status !== 200) throw new Error(`pg-meta ${r.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  };

  // ── auth ──
  try {
    const r = await get('/auth/v1/health', anon);
    line('auth', r.status === 200, `/auth/v1/health → ${r.status} ${r.json ? (r.json.description || r.json.name || '') : ''}`);
  } catch (e) { line('auth', false, `unreachable: ${e.message}`); }

  // ── rest (anon key accepted, PostgREST connected) ──
  try {
    const r = await get('/rest/v1/', anon);
    line('rest', r.status === 200, `/rest/v1/ with anon key → ${r.status}${r.status === 200 ? ' (OpenAPI served; PostgREST is connected)' : ' ' + r.text.slice(0, 120)}`);
  } catch (e) { line('rest', false, `unreachable: ${e.message}`); }

  // ── service role ──
  try {
    const r = await get('/rest/v1/brand_workspaces?select=id&limit=1', service);
    line('service', r.status === 200 && Array.isArray(r.json), `service-role select brand_workspaces → ${r.status}, ${Array.isArray(r.json) ? r.json.length + ' row(s)' : r.text.slice(0, 120)}`);
  } catch (e) { line('service', false, e.message); }

  // ── RLS on ──
  let metaOk = true;
  try {
    const r = await get('/rest/v1/brand_workspaces?select=id&limit=5', anon);
    let rlsOn = null;
    try {
      const rows = await pgQuery("select relrowsecurity from pg_class where oid = 'public.brand_workspaces'::regclass");
      rlsOn = rows && rows[0] && rows[0].relrowsecurity === true;
    } catch (e) { metaOk = false; }
    const emptyForAnon = r.status === 200 && Array.isArray(r.json) && r.json.length === 0;
    line('rls', emptyForAnon && rlsOn !== false,
      `anon select brand_workspaces → ${r.status}, ${Array.isArray(r.json) ? r.json.length + ' row(s)' : r.text.slice(0, 80)}; pg_class.relrowsecurity=${rlsOn === null ? 'unknown (pg-meta unavailable)' : rlsOn}`);
  } catch (e) { line('rls', false, e.message); }

  // ── bypassrls for service_role ──
  try {
    const rows = await pgQuery("select rolname, rolbypassrls from pg_roles where rolname in ('service_role','anon','authenticated','authenticator') order by rolname");
    const svc = rows.find((x) => x.rolname === 'service_role');
    const ok = !!(svc && svc.rolbypassrls);
    line('bypassrls', ok, `service_role.rolbypassrls=${svc ? svc.rolbypassrls : 'role missing'}${ok ? '' : ' — the service key is RLS-filtered on this database (expected on a managed Postgres; see docs/self-hosted-supabase.md)'}`, { warn: !ok && env && env.DB_MODE === 'external' });
  } catch (e) { line('bypassrls', false, `pg-meta query failed: ${e.message}`); }

  // ── realtime ──
  try {
    let wal = 'unknown', pub = 'unknown';
    if (metaOk) {
      try {
        const rows = await pgQuery("select current_setting('wal_level') as wal_level, exists(select 1 from pg_publication where pubname='supabase_realtime') as pub");
        wal = rows[0].wal_level; pub = rows[0].pub;
      } catch (_) { /* reported as unknown */ }
    }
    if (typeof WebSocket === 'undefined') throw new Error('this check needs Node 22+ (global WebSocket); wal_level=' + wal + ', publication=' + pub);
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(anon)}&vsn=1.0.0`);
    const result = await new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, why: 'timeout (8s) waiting for the socket' }), 8000);
      ws.onopen = () => ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: '1' }));
      ws.onmessage = (ev) => { clearTimeout(t); try { const m = JSON.parse(ev.data); resolve({ ok: m.event === 'phx_reply', why: `heartbeat reply: ${m.event} ${JSON.stringify(m.payload)}` }); } catch (e) { resolve({ ok: false, why: 'unparseable frame' }); } ws.close(); };
      ws.onerror = (ev) => { clearTimeout(t); resolve({ ok: false, why: 'socket error: ' + (ev && ev.message ? ev.message : 'connection refused or upgrade rejected') }); };
    });
    line('realtime', result.ok, `${result.why}; wal_level=${wal}; publication supabase_realtime=${pub}`);
  } catch (e) { line('realtime', false, e.message); }

  // ── storage ──
  try {
    const r = await get('/storage/v1/bucket', service);
    const names = Array.isArray(r.json) ? r.json.map((b) => b.name || b.id) : [];
    const missing = BUCKETS.map((b) => b.id).filter((id) => !names.includes(id));
    line('storage', r.status === 200 && missing.length === 0, `/storage/v1/bucket → ${r.status}, ${names.length} bucket(s)${missing.length ? '; MISSING: ' + missing.join(', ') + ' (run node scripts/selfhost-buckets.js)' : '; all ' + BUCKETS.length + ' app buckets present'}`);
  } catch (e) { line('storage', false, e.message); }

  const failed = out.filter((x) => !x.ok);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: ${out.length - failed.length}/${out.length} checks passed${failed.length ? ' — ' + failed.map((x) => x.name).join(', ') : ''}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
