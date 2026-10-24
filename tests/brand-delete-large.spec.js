/**
 * Deleting a brand that holds a lot of data (2026-10-24).
 * ---------------------------------------------------------------------------
 * Production, /onboarding: Delete permanently on "TOI News Notification"
 * answered "Nothing was deleted. supabase DELETE brand_workspaces?id=eq... ->
 * 500: canceling statement due to statement timeout". One DELETE of the brand
 * row cascades to every row the brand owns (catalogue, import queue, ledgers),
 * and a large brand ran past PostgREST's statement timeout.
 *
 * Executed: the shipped deleteWorkspace over a modelled PostgREST that cancels
 * any single statement removing more than STATEMENT_LIMIT rows, as the live
 * one did. The big tables now go first in bounded batches (service role, after
 * the owner check); a press that runs out of time keeps the brand and says
 * how far it got; the next press finishes.
 */
const { test, expect } = require('@playwright/test');

const WS = '11111111-2222-4333-8444-555555555555';
const OWNER = '99999999-8888-4777-8666-555555555555';
const STATEMENT_LIMIT = 6000;

function world({ catalogue = 12000, queue = 9000, timeoutEvery = false } = {}) {
  const rows = { brand_catalog_products: catalogue, brand_catalog_import_queue: queue };
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(String(url));
    const method = (init && init.method) || 'GET';
    const table = u.pathname.replace('/rest/v1/', '');
    calls.push({ method, table, limit: u.searchParams.get('limit'), auth: init && init.headers && init.headers.authorization });
    const json = (b, status = 200, headers = {}) => new Response(JSON.stringify(b), { status, headers: Object.assign({ 'content-type': 'application/json' }, headers) });
    const timeout = () => json({ code: '57014', message: 'canceling statement due to statement timeout' }, 500);
    if (u.pathname === '/storage/v1/object/list/brand-assets') return json([]);
    if (table === 'brand_workspaces' && method === 'GET') return json([{ id: WS, owner_id: OWNER, name: 'TOI News Notification' }]);
    if (table === 'brand_workspaces' && method === 'DELETE') {
      const cascade = Object.values(rows).reduce((a, b) => a + b, 0);
      if (cascade > STATEMENT_LIMIT) return timeout();
      return json([{ id: WS, name: 'TOI News Notification' }]);
    }
    if (method === 'DELETE') {
      if (!(table in rows)) return new Response(null, { status: 204, headers: { 'content-range': '*/0' } });
      const want = Number(u.searchParams.get('limit')) || Infinity;
      if (timeoutEvery || Math.min(want, rows[table]) > STATEMENT_LIMIT) return timeout();
      const n = Math.min(want, rows[table]);
      rows[table] -= n;
      return new Response(null, { status: 204, headers: { 'content-range': `*/${n}` } });
    }
    throw new Error('unexpected ' + method + ' ' + u.pathname);
  };
  return { rows, calls, fetchImpl };
}

async function withEnv(fn) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.SUPABASE_URL = 'https://fixture.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  const real = global.fetch;
  try { return await fn(); } finally {
    global.fetch = real;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('a brand with more rows than one statement can remove is deleted: the big tables go first in batches, the brand row last', async () => {
  await withEnv(async () => {
    const core = require('../api/_shared/brand-workspace-core.js');
    const w = world();
    global.fetch = w.fetchImpl;
    const out = await core.deleteWorkspace({ token: 'user-jwt', user_id: OWNER }, WS);
    expect(out).toMatchObject({ ok: true, deleted: WS, name: 'TOI News Notification' });
    expect(w.rows).toEqual({ brand_catalog_products: 0, brand_catalog_import_queue: 0 });
    const purges = w.calls.filter((c) => c.method === 'DELETE' && c.table !== 'brand_workspaces');
    expect(purges.every((c) => Number(c.limit) > 0 && Number(c.limit) <= 5000)).toBe(true);
    expect(purges.every((c) => c.auth === 'Bearer service')).toBe(true);
    const last = w.calls[w.calls.length - 1];
    expect(last).toMatchObject({ method: 'DELETE', table: 'brand_workspaces', auth: 'Bearer user-jwt' });
  });
});

test('a press that runs out of time keeps the brand, says how far it got, and the next press finishes', async () => {
  await withEnv(async () => {
    const core = require('../api/_shared/brand-workspace-core.js');
    // Every batch is cancelled: nothing can be purged, so the brand row is never sent.
    const stuck = world({ timeoutEvery: true });
    global.fetch = stuck.fetchImpl;
    let err = null;
    try { await core.deleteWorkspace({ token: 'user-jwt', user_id: OWNER }, WS); } catch (e) { err = e; }
    expect(err && err.status).toBe(409);
    expect(err.message).toMatch(/still there\. Press Delete permanently again to continue/);
    expect(stuck.calls.some((c) => c.method === 'DELETE' && c.table === 'brand_workspaces')).toBe(false);
    // A budget spent part-way: some rows go, the brand stays; the next press completes.
    const w = world();
    const first = await core.purgeBrandRows(WS, { budgetMs: -1, fetchImpl: w.fetchImpl });
    expect(first.done).toBe(false);
    global.fetch = w.fetchImpl;
    const out = await core.deleteWorkspace({ token: 'user-jwt', user_id: OWNER }, WS);
    expect(out.ok).toBe(true);
  });
});

test('a batch the database still cancels is halved, never skipped', async () => {
  await withEnv(async () => {
    const core = require('../api/_shared/brand-workspace-core.js');
    const w = world({ catalogue: 20000, queue: 0 });
    const out = await core.purgeBrandRows(WS, { batch: 8000, fetchImpl: w.fetchImpl });
    expect(out).toEqual({ done: true, deleted: 20000 });
    const sizes = w.calls.filter((c) => c.table === 'brand_catalog_products').map((c) => Number(c.limit));
    expect(sizes[0]).toBe(8000);
    expect(sizes[1]).toBe(4000);
  });
});
