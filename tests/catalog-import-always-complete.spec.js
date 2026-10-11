/**
 * "Ensure that import catalog always imports the complete catalog correctly."
 * ---------------------------------------------------------------------------
 * Two live records the day after the whole-store importer shipped
 * (2026-10-11), modelled on 127.0.0.1 (this container cannot reach either
 * site: the fixtures are the DOCUMENTED sitemap shapes and the shapes the live
 * coverage implies - tests/lib/catalog-fixture-stores.js):
 *
 *   Nykaa    not Shopify, no platform declared, region stored "IND":
 *            "Found 0 of the 21 products the site declares ... stopped at
 *            feed page 1 (429, 4 waits, 7 s) ... PARTIAL" - every Continue
 *            import hit the same 429 on a feed the store does not have.
 *   Lenskart "The site's sitemaps (they do not say which URLs are products)
 *            list 21 URLs ... 21 pages declare no product ... Complete" - the
 *            21 were CHILD SITEMAPS listed in a <urlset>, read as pages, and a
 *            run of 0 products was called complete. On another day: "Found
 *            450 of 2,430 ... PARTIAL" and someone had to press Continue
 *            import five more times.
 *
 * Every case runs the SHIPPED paths: importCatalog (account, over
 * tests/lib/fake-supabase.js with brand_catalog_merge modelled from its
 * migration), deviceCatalogImport (a device brand), the chain through the
 * SHIPPED api/public-config.js served on a real socket, the browser pages in
 * Chromium, and scripts/catalog-probe.js. Nothing reads module source except
 * the workflow file, which IS the thing under test there.
 *
 * Run: npx playwright test tests/catalog-import-always-complete.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const { startStores } = require('./lib/catalog-fixture-stores.js');
const { FakeSupabase, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');
const { installMerge } = require('./lib/catalog-merge-fake.js');
const { serve } = require('./router-harness.js');
const core = require('../api/_shared/brand-workspace-core.js');
const imp = require('../api/_shared/catalog-import.js');
const bcs = require('../api/_shared/brand-catalog-server.js');

const OWNER = '11111111-1111-4111-8111-111111111111';
const WS = '33333333-3333-4333-8333-333333333333';
const PHONE = { ok: true, provider: 'mobile-pin', mode: 'device', user_id: 'device:abc', token: 'MPINtokenFIXTURE0123456789abcdefghijklmnopqrs' };
const SELF = 'https://self.lifecycle.test';
const SECRET = 'cron-secret-for-the-chain-0123456789';

test.describe.configure({ mode: 'serial' });

let st;
test.beforeAll(async () => { st = await startStores(); });
test.afterAll(async () => { if (st) await st.close(); });

const ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SELF_BASE_URL', 'VERCEL_URL', 'CRON_SECRET'];
function world(brand, { chain } = {}) {
  st.reset();
  const saved = {};
  for (const k of ENV) saved[k] = process.env[k];
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  delete process.env.SELF_BASE_URL; delete process.env.VERCEL_URL; delete process.env.CRON_SECRET;
  if (chain) { process.env.SELF_BASE_URL = SELF; process.env.CRON_SECRET = SECRET; }
  const db = new FakeSupabase();
  db.addUser('tok-owner', OWNER, 'owner@market.example');
  db.addWorkspace(WS, OWNER, Object.assign({ name: 'Market', slug: 'market', website: '', regions: [], asset_hosts: [], catalog_source: {}, catalog_import: {}, brand_data: {}, palette: {}, typography: {}, voice: {}, updated_at: new Date().toISOString() }, brand || {}));
  db.syncIdentityTables();
  installMerge(db);
  db.route((u) => st.isFixture(u), (u, init) => st.routeFetch(u, init));
  const fired = [];
  if (chain) db.route((u) => String(u).startsWith(SELF), (u, init, call) => { fired.push(call); return chain(u, init, call); });
  db.install();
  st.installDns();
  bcs.invalidate();
  return {
    db, fired,
    owner: { ok: true, token: 'tok-owner', user_id: OWNER },
    rows: () => db.table('brand_catalog_products').filter((r) => r.workspace_id === WS),
    wsRow: () => db.table('brand_workspaces').find((w) => w.id === WS),
    restore() {
      db.restore(); st.restore();
      for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      bcs.invalidate();
    },
  };
}
function deviceWorld() { st.reset(); st.install(); return { restore() { st.restore(); } }; }
const hitsOf = (host, rx) => (st.hits[host] || []).filter((h) => rx.test(h.path));
const said = (cov) => (cov && cov.sentences ? cov.sentences.join(' ') : '');

/** POST to a served router over a real socket; resolves when it answers. */
function post(port, pathQ, body, headers) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body || {});
    const req = http.request({ hostname: '127.0.0.1', port, path: pathQ, method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) }, headers || {}) }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch (_) { j = null; } resolve({ status: res.statusCode, out: j }); });
    });
    req.on('error', reject); req.end(raw);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Nykaa: a non-Shopify store whose /products.json 429s is read from its
      sitemaps, completely, under the canonical market
   ═══════════════════════════════════════════════════════════════════════════ */

test('a store that declares no platform and whose /products.json answers 429 is read WHOLE from its own nested sitemaps, under market "in" (stored "IND"), in INR', async () => {
  test.setTimeout(120_000);
  const w = world({ website: 'https://bigmarket.example', regions: [{ code: 'IND', home: true }] });
  try {
    // An older import filed two rows under "ind": nothing ever found them.
    for (const h of ['old-a', 'old-b']) w.db.insert('brand_catalog_products', { workspace_id: WS, region: 'ind', handle: h, sku: null, title: h, source: 'sitemap_jsonld', stale_at: null, last_seen_run: 'old' });
    // The wizard sends the record's code lower-cased: "ind".
    const out = await core.importCatalog(w.owner, { workspace_id: WS, region: 'ind', kind: 'storefront', url: 'https://bigmarket.example' });
    expect(out.region).toBe('in');
    expect(out.complete).toBe(true);
    const T = st.stores['bigmarket.example'].truth;
    const live = w.rows().filter((r) => !r.stale_at && r.region === 'in');
    expect(live).toHaveLength(T.products - T.shells);
    expect(new Set(live.map((r) => r.currency))).toEqual(new Set(['INR']));
    // The feed was PROBED once, never retried, never the reason to stop.
    expect(hitsOf('bigmarket.example', /^\/products\.json/)).toHaveLength(1);
    expect(said(out.coverage)).toContain('was tried once; it answered 429, asked to slow down, so the site\'s own sitemaps and product pages were read instead');
    // The denominator is every product the product sitemaps list, once: the
    // 21 "featured" duplicates on the brand's own sitemap host do not inflate
    // it, and category sitemaps (product_cat-*) are not products.
    expect(said(out.coverage)).toContain(`Found ${(T.products - T.shells).toLocaleString('en-US')} of the ${T.products.toLocaleString('en-US')} products the site declares in the site's product sitemaps`);
    // On the brand's own sibling domain (bigmarket.in, the coherence rule's
    // sameBrand): read. On another brand's site: never asked.
    expect(hitsOf('bigmarket.in', /products-featured\.xml/)).toHaveLength(1);
    expect(st.hits['othermarket.example'] || []).toHaveLength(0);
    expect(hitsOf('bigmarket.example', /^\/c\//)).toHaveLength(0);
    // Four levels deep, gzipped and plain children, all 70 read once.
    // Children of the product index whose own names do not say "product"
    // (/sitemaps/p/a/7.xml.gz) are product sitemaps all the same.
    expect(hitsOf('bigmarket.example', /^\/sitemaps\/p\/a\/\d+\.xml\.gz$/)).toHaveLength(35);
    // The child that answered 429 + Retry-After: 1 was waited for and read.
    const b3 = hitsOf('bigmarket.example', /^\/sitemaps\/p\/b\/3\.xml$/);
    expect(b3).toHaveLength(2);
    expect(b3[1].at - b3[0].at).toBeGreaterThanOrEqual(950);
    // Application shells: said, not called "no product".
    expect(said(out.coverage)).toContain(`${T.shells} pages declare their product only after JavaScript runs`);
    expect(said(out.coverage)).toContain(`Complete: every URL the source lists was visited; ${T.shells} of them did not yield a product`);
    // __NEXT_DATA__ stating the product verbatim is read, and the
    // "recommended" product beside it is never taken for this page's.
    const nx = live.filter((r) => r.raw && r.raw.declared === 'embedded-json');
    expect(nx).toHaveLength(T.next);
    for (const r of nx) { expect(r.title).not.toBe('Other Product'); expect(r.price).toBeGreaterThan(1); expect(r.currency).toBe('INR'); expect(r.image_url).toMatch(/^https:\/\/bigmarket\.example\/media\/item-/); }
    // The "ind" rows of the same source family are kept, marked stale.
    const old = w.rows().filter((r) => r.region === 'ind');
    expect(old).toHaveLength(2);
    expect(old.every((r) => !!r.stale_at)).toBe(true);
  } finally { w.restore(); }
});

test('a market code is the canonical one from the region table, or the import is refused - never filed under a code no reader looks up', async () => {
  for (const [given, want] of [['IND', 'in'], ['India', 'in'], ['GB', 'uk'], ['usa', 'us'], ['de', 'de'], ['GLOBAL', 'global']]) expect(imp.canonRegion(given)).toBe(want);
  expect(imp.canonRegion('XYZ')).toBe('');
  expect(bcs.regionKey(imp.canonRegion('IND'))).toBe('in');
  const d = deviceWorld();
  try {
    await expect(core.importCatalog(PHONE, { region: 'XYZ', kind: 'storefront', url: 'https://bigmarket.example', brand: { website: 'https://bigmarket.example' } })).rejects.toMatchObject({ status: 400, code: 'region_unknown' });
    expect(Object.keys(st.hits)).toHaveLength(0);   // refused before any request
  } finally { d.restore(); }
});

test('the sitemaps are a resumable queue: a step that runs out of time mid-enumeration says "so far", never a declared total, and the next step carries on', async () => {
  test.setTimeout(150_000);
  const d = deviceWorld();
  st.stores['bigmarket.example'].smDelayMs = 60;
  try {
    const brand = { website: 'https://bigmarket.example', regions: [{ code: 'IN', home: true }] };
    let r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://bigmarket.example', brand, budgetMs: 2600 });
    const seen = [r];
    for (let i = 0; i < 80 && !r.complete; i++) {
      expect(r.progressed).toBe(true);
      expect(r.drive).toBe(true);
      r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://bigmarket.example', brand, cursor: r.cursor, budgetMs: 2600 });
      seen.push(r);
    }
    expect(r.complete).toBe(true);
    const mid = seen.filter((x) => /still being read/.test(said(x.coverage)));
    expect(mid.length).toBeGreaterThan(0);
    for (const x of mid) expect(said(x.coverage)).not.toContain('the site declares');
    expect(said(r.coverage)).toContain('of the 1,050 products the site declares');
    // Every sitemap read once (b/3 twice: its 429, then the read).
    const perSm = {};
    for (const h of hitsOf('bigmarket.example', /^\/sitemap/)) perSm[h.path] = (perSm[h.path] || 0) + 1;
    for (const [p, n] of Object.entries(perSm)) expect(n, p).toBe(p === '/sitemaps/p/b/3.xml' ? 2 : 1);
  } finally { d.restore(); }
});

test('a sitemap whose Retry-After is longer than a step may wait is kept at the head of the queue, never dropped: the next step waits the time asked, then reads it', async () => {
  test.setTimeout(150_000);
  const d = deviceWorld();
  st.stores['bigmarket.example'].longRetry = 25;
  try {
    const brand = { website: 'https://bigmarket.example', regions: [{ code: 'IN', home: true }] };
    // A call too short to wait 25 s stops at the sitemap, keeping it.
    const first = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://bigmarket.example', brand, budgetMs: 20000 });
    expect(first.complete).toBe(false);
    expect(first.coverage.stopped).toMatchObject({ reason: 'rate_limited', retry_after: '25' });
    expect(first.coverage.not_before).toBeTruthy();
    const next = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://bigmarket.example', brand, cursor: first.cursor, budgetMs: 40000 });
    let r = next;
    for (let i = 0; i < 5 && !r.complete; i++) r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://bigmarket.example', brand, cursor: r.cursor, budgetMs: 40000 });
    expect(r.complete).toBe(true);
    const b7 = hitsOf('bigmarket.example', /^\/sitemaps\/p\/b\/7\.xml$/);
    expect(b7).toHaveLength(2);
    expect(b7[1].at - b7[0].at).toBeGreaterThanOrEqual(24500);
    expect(said(r.coverage)).toContain('of the 1,050 products the site declares');
  } finally { d.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Lenskart: a <urlset> whose 21 entries are child sitemaps
   ═══════════════════════════════════════════════════════════════════════════ */

test('a <urlset> listing 21 CHILD SITEMAPS (some gzipped) is read as an index: 2,430 products, no sitemap fetched as a page', async () => {
  test.setTimeout(120_000);
  const d = deviceWorld();
  try {
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://lensshop.example', brand: { website: 'https://lensshop.example' } });
    expect(r.complete).toBe(true);
    expect(r.products).toHaveLength(2430);
    expect(new Set(r.products.map((p) => p.handle)).size).toBe(2430);
    const kids = hitsOf('lensshop.example', /^\/sitemap\//);
    expect(kids).toHaveLength(21);
    expect(said(r.coverage)).not.toContain('declare no product');
    expect(said(r.coverage)).toContain('list 2,430 URLs');
  } finally { d.restore(); }
});

test('a read that finds NO product is never called complete: it says what it reached, and that a 200 HTML page at /sitemap.xml is not a sitemap', async () => {
  const d = deviceWorld();
  try {
    let err = null;
    try { await core.importCatalog(PHONE, { region: 'us', kind: 'storefront', url: 'https://emptyshop.example', brand: { website: 'https://emptyshop.example' } }); } catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(err.status).toBe(400);
    expect(err.message).not.toContain('Complete: every product');
    expect(err.message).toContain('NOT COMPLETE: no product was read');
    expect(err.message).toContain('answered an HTML page (text/html), not a sitemap');
    expect(err.message).toMatch(/\d+ linked pages? crawled/);
    expect(err.coverage.complete).toBe(false);
    expect(err.coverage.empty).toBe(true);
  } finally { d.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. The import continues BY ITSELF until the store is read
   ═══════════════════════════════════════════════════════════════════════════ */

test('a 2,430-product store reaches complete with no human press: each step fires the next through the shipped router, every page read once', async () => {
  test.setTimeout(180_000);
  const srv = await serve('api/public-config.js');
  const bodies = [];
  const w = world({ website: 'https://lensshop.example', regions: [{ code: 'IN', home: true }] }, {
    chain: (u, init) => {
      const q = new URL(u);
      const headers = {};
      for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
      bodies.push({ path: q.pathname + q.search, auth: headers.authorization, body: JSON.parse(init.body) });
      // Fire-and-forget, as on the deployment: the step runs on its own.
      post(srv.port, q.pathname + q.search, JSON.parse(init.body), { authorization: headers.authorization }).catch(() => {});
      return { ok: true, accepted: true };
    },
  });
  st.stores['lensshop.example'].delayMs = 4;
  try {
    const first = await core.importCatalog(w.owner, { workspace_id: WS, region: 'in', kind: 'storefront', url: 'https://lensshop.example', budgetMs: 2500 });
    expect(first.complete).toBe(false);
    expect(first.continuing).toBe(true);
    expect(said(first.coverage)).toContain('It is continuing by itself');
    expect((await core.catalogStatus(w.owner, WS)).continuing).toBe(true);
    // A person pressing Continue import meanwhile is told it is moving.
    await expect(core.importCatalog(w.owner, { workspace_id: WS, continue: true })).rejects.toMatchObject({ status: 409, code: 'import_continuing' });
    const t0 = Date.now();
    while (Date.now() - t0 < 150_000) {
      const imp0 = w.wsRow().catalog_import;
      if (imp0 && !imp0.cursor && imp0.chain && (imp0.chain.done || imp0.chain.stopped)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const fin = w.wsRow().catalog_import;
    expect(fin.cursor).toBe(null);
    expect(fin.chain.done).toBe(true);
    expect(fin.chain.depth).toBeGreaterThan(2);
    expect(w.rows().filter((r) => !r.stale_at)).toHaveLength(2430);
    expect(w.wsRow().catalog_source.complete).toBe(true);
    const perPage = {};
    for (const h of hitsOf('lensshop.example', /^\/frames\//)) perPage[h.path] = (perPage[h.path] || 0) + 1;
    expect(Object.keys(perPage)).toHaveLength(2430);
    expect(Math.max(...Object.values(perPage))).toBe(1);
    // Every link of the chain: the scheduler's secret, the one op, POST.
    expect(bodies.length).toBe(fin.chain.depth - 1);
    for (const b of bodies) {
      expect(b.path).toBe('/api/public-config?action=brand&op=catalog-chain');
      expect(b.auth).toBe(`Bearer ${SECRET}`);
      expect(b.body).toMatchObject({ workspace_id: WS, budget_ms: 2500 });
    }
    // The chain's merges ran as the service role, naming the workspace.
    const merges = w.db.calls.filter((c) => /rpc\/brand_catalog_merge/.test(c.url) && c.token === SERVICE_KEY);
    expect(merges.length).toBeGreaterThan(0);
    expect(merges.every((c) => c.body.p_workspace === WS)).toBe(true);
    expect((await core.catalogStatus(w.owner, WS)).continuing).toBe(false);
  } finally { w.restore(); await srv.close(); }
});

test('the chain op: only the scheduler\'s secret, POST only; a token is claimed ONCE (a duplicate fire runs nothing), and a stale token is superseded', async () => {
  test.setTimeout(120_000);
  const srv = await serve('api/public-config.js');
  const w = world({ website: 'https://lensshop.example', regions: [{ code: 'IN', home: true }] }, { chain: () => ({ ok: true }) });   // recorded, not run
  st.stores['lensshop.example'].delayMs = 4;
  try {
    const first = await core.importCatalog(w.owner, { workspace_id: WS, region: 'in', kind: 'storefront', url: 'https://lensshop.example', budgetMs: 2500 });
    expect(first.continuing).toBe(true);
    const token = w.wsRow().catalog_import.chain.token;
    expect(w.fired).toHaveLength(1);
    const Q = '/api/public-config?action=brand&op=catalog-chain';
    expect((await post(srv.port, Q, { workspace_id: WS, token }, {})).status).toBe(401);
    expect((await post(srv.port, Q, { workspace_id: WS, token }, { authorization: 'Bearer not-the-secret-not-the-secret-0000' })).status).toBe(401);
    const before = w.rows().length;
    // The same token, twice at once: exactly one step runs.
    const [a, b] = await Promise.all([
      post(srv.port, Q, { workspace_id: WS, token, budget_ms: 2500 }, { authorization: `Bearer ${SECRET}` }),
      post(srv.port, Q, { workspace_id: WS, token, budget_ms: 2500 }, { authorization: `Bearer ${SECRET}` }),
    ]);
    const outs = [a.out, b.out];
    expect(outs.filter((o) => o && /^(claimed_elsewhere|superseded)$/.test(o.skipped || ''))).toHaveLength(1);
    const ran = outs.find((o) => o && !o.skipped);
    expect(ran.progressed).toBe(true);
    expect(w.rows().length).toBeGreaterThan(before);
    // The old token after the step moved on: nothing runs.
    const again = await post(srv.port, Q, { workspace_id: WS, token, budget_ms: 2500 }, { authorization: `Bearer ${SECRET}` });
    expect(again.out.skipped).toBe('superseded');
    // Two invocations that both READ the row before either claims it: the
    // conditional claim on the token lets exactly one through.
    const t2 = w.wsRow().catalog_import.chain.token;
    const pair = await Promise.all([imp.chainStep({ workspace_id: WS, token: t2, budget_ms: 2500 }), imp.chainStep({ workspace_id: WS, token: t2, budget_ms: 2500 })]);
    expect(pair.filter((o) => o.skipped === 'claimed_elsewhere')).toHaveLength(1);
    expect(pair.filter((o) => !o.skipped)).toHaveLength(1);
  } finally { w.restore(); await srv.close(); }
});

test('the chain stops instead of looping: a step that read nothing new, a Retry-After longer than a step may wait (honoured by the daily refresh), a deployment that cannot address itself', async () => {
  const stopNoMove = imp.chainAfter({ complete: false, progressed: false, coverage: { stopped: { reason: 'unreachable', at: 'URL 3 of 9' } } }, 4);
  expect(stopNoMove.active).toBe(false);
  expect(imp.chainSentence(stopNoMove)).toContain('the last step read nothing new (the store stopped answering at URL 3 of 9)');
  const longWait = imp.chainAfter({ complete: false, progressed: true, coverage: { stopped: { reason: 'rate_limited', at: 'feed page 2', wait_ms: 600000 } } }, 2);
  expect(longWait.active).toBe(false);
  expect(Date.parse(longWait.resume_after)).toBeGreaterThan(Date.now() + 500000);
  const shortWait = imp.chainAfter({ complete: false, progressed: false, coverage: { stopped: { reason: 'rate_limited', at: 'x', wait_ms: 5000 } } }, 2);
  const saved = { s: process.env.SELF_BASE_URL, c: process.env.CRON_SECRET, v: process.env.VERCEL_URL };
  try {
    delete process.env.SELF_BASE_URL; delete process.env.VERCEL_URL; delete process.env.CRON_SECRET;
    const noSelf = imp.chainAfter({ complete: false, progressed: true, coverage: {} }, 2);
    expect(noSelf).toMatchObject({ active: false, browser: true });
    process.env.SELF_BASE_URL = SELF; process.env.CRON_SECRET = SECRET;
    expect(imp.chainAfter({ complete: false, progressed: true, coverage: {} }, 2).active).toBe(true);
    expect(imp.chainAfter({ complete: false, progressed: true, coverage: {} }, imp.CHAIN.maxSteps + 1).active).toBe(false);
    expect(shortWait.active || shortWait.browser).toBeTruthy();   // a wait a step can afford keeps it going
  } finally { for (const [k, v] of [['SELF_BASE_URL', saved.s], ['CRON_SECRET', saved.c], ['VERCEL_URL', saved.v]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }

  // The daily refresh leaves a waiting import alone until its time.
  const w = world({ website: 'https://slowshop.example', regions: [{ code: 'US', home: true }] });
  try {
    const first = await core.importCatalog(w.owner, { workspace_id: WS, region: 'us', kind: 'storefront', url: 'https://slowshop.example', budgetMs: 2500 });
    expect(first.complete).toBe(false);
    w.wsRow().catalog_import.chain = { active: false, resume_after: new Date(Date.now() + 3600e3).toISOString() };
    expect((await imp.refreshDue({ maxWorkspaces: 2, budgetMs: 10000 })).due).toBe(0);
    w.wsRow().catalog_import.chain.resume_after = new Date(Date.now() - 1000).toISOString();
    expect((await imp.refreshDue({ maxWorkspaces: 2, budgetMs: 10000 })).due).toBe(1);
  } finally { w.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. What the operator sees
   ═══════════════════════════════════════════════════════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
function appServer() {
  return http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
}
const BRAND = { id: WS, slug: 'lens', name: 'Lens Shop', website: 'https://lensshop.example', palette: { primary: '#1F4E79', accent: '#C8102E', ink: '#1A1A1A', surface: '#FFFFFF', surface_alt: '#F6F7F9', muted: '#5A6270' }, typography: { heading: { family: 'Inter' }, body: { family: 'Inter' } }, voice: {}, brand_data: {}, regions: [{ code: 'IN', home: true, store_url: 'https://lensshop.example', currency: 'INR' }] };

test('onboarding follows an import that is continuing on the server: "X of Y products read, continuing by itself", then complete - nothing pressed', async ({ page }) => {
  test.setTimeout(120_000);
  const cov = (found, done) => ({ found, complete: done, declared: { count: null, urls: 2430 }, sentences: [done ? 'Complete: every product the source lists was read.' : `Found ${found} products. PARTIAL. It is continuing by itself: step 2 was started automatically and resumes exactly there, so nothing needs pressing.`] });
  const statuses = [{ ok: true, coverage: cov(900, false), resume_available: true, continuing: true, chain: { active: true }, live: 900 }, { ok: true, coverage: cov(2430, true), resume_available: false, continuing: false, live: 2430 }];
  const srv = appServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const calls = [];
  try {
    await page.route('**/api/public-config**', async (route) => {
      const u = new URL(route.request().url());
      const op = u.searchParams.get('op') || '';
      let sent = null; try { sent = JSON.parse(route.request().postData() || 'null'); } catch (_) { sent = null; }
      calls.push({ op, sent });
      let payload;
      if (op === 'catalog-import') payload = { ok: true, imported: 450, complete: false, resume_available: true, continuing: true, progressed: true, coverage: cov(450, false), live: 450 };
      else if (op === 'catalog-status') payload = calls.filter((c) => c.op === 'catalog-import').length ? (statuses.length > 1 ? statuses.shift() : statuses[0]) : { ok: true, coverage: null, resume_available: false };
      else if (op === 'save') payload = { ok: true, brand: BRAND };
      else payload = { ok: true, brand: BRAND, workspaces: [], active_id: BRAND.id, pack: null, presets: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('http://127.0.0.1:' + srv.address().port + '/onboarding.html', { waitUntil: 'load' });
    await expect(page.locator('#title')).toContainText('Edit Lens Shop', { timeout: 15000 });
    const pip = page.locator('.step-pip[data-step="5"]');
    await pip.waitFor({ state: 'visible', timeout: 15000 });
    await pip.click({ force: true });
    await page.fill('#impUrl', 'https://lensshop.example');
    await page.locator('#doImport').click();
    await expect(page.locator('#impStatus')).toContainText('of 2430 products read, continuing by itself', { timeout: 10000 });
    await expect(page.locator('#impContinue')).toHaveCount(0);   // nothing to press while it moves
    await expect(page.locator('#impCoverage')).toContainText('Catalogue read completely', { timeout: 20000 });
    expect(calls.filter((c) => c.op === 'catalog-import')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'catalog-status').length).toBeGreaterThanOrEqual(2);
  } finally { await new Promise((r) => srv.close(r)); }
});

test('onboarding: an EARLIER import\'s coverage is shown only as labelled history beside a new failure, and the failure is said once - no toast over the panel', async ({ page }) => {
  test.setTimeout(90_000);
  const old = { found: 54, complete: true, base: 'https://old-source.example', declared: { count: 66 }, sentences: ['Found 54 of the 66 products the site declares in the site\'s product sitemaps.', 'Complete: every URL the source lists was visited; 12 of them did not yield a product, for the reasons above.'] };
  const srv = appServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await page.route('**/api/public-config**', async (route) => {
      const op = new URL(route.request().url()).searchParams.get('op') || '';
      if (op === 'catalog-import') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'import_failed', message: 'No usable product rows were found in that source. NOT COMPLETE: no product was read.' }) });
      let payload;
      if (op === 'catalog-status') payload = { ok: true, coverage: old, resume_available: false };
      else if (op === 'save') payload = { ok: true, brand: BRAND };
      else payload = { ok: true, brand: BRAND, workspaces: [], active_id: BRAND.id, pack: null, presets: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('http://127.0.0.1:' + srv.address().port + '/onboarding.html', { waitUntil: 'load' });
    await expect(page.locator('#title')).toContainText('Edit Lens Shop', { timeout: 15000 });
    const pip = page.locator('.step-pip[data-step="5"]');
    await pip.waitFor({ state: 'visible', timeout: 15000 });
    await pip.click({ force: true });
    const box = page.locator('#impCoverage');
    await expect(box).toContainText('Catalogue read completely', { timeout: 10000 });
    await page.fill('#impUrl', 'https://lensshop.example');
    await page.locator('#doImport').click();
    await expect(page.locator('#impStatus')).toContainText('NOT COMPLETE', { timeout: 10000 });
    await expect(box).toHaveAttribute('data-history', '1');
    await expect(box).toContainText('Earlier import (history, not this import)');
    await expect(box).not.toContainText('Catalogue read completely');
    await page.waitForTimeout(400);
    // Read at once: a toast hides itself after a few seconds, and an
    // auto-retrying assertion would wait for that and pass.
    expect(await page.locator('#toast').evaluate((e) => getComputedStyle(e).display)).toBe('none');
  } finally { await new Promise((r) => srv.close(r)); }
});

test('/connections follows an import continuing by itself until it is complete, with no Continue button while it moves', async ({ page }) => {
  test.setTimeout(90_000);
  const cov = (found, done) => ({ found, complete: done, declared: { count: 2430 }, sentences: [done ? 'Complete: every product the source lists was read.' : `Found ${found} of the 2,430 products the site declares. It is continuing by itself.`] });
  const statuses = [{ ok: true, coverage: cov(450, false), resume_available: true, continuing: true, live: 450 }, { ok: true, coverage: cov(1800, false), resume_available: true, continuing: true, live: 1800 }, { ok: true, coverage: cov(2430, true), resume_available: false, continuing: false, live: 2430 }];
  const srv = appServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const calls = [];
  try {
    await page.route('**/api/public-config**', async (route) => {
      const u = new URL(route.request().url());
      const action = u.searchParams.get('action') || '';
      const op = u.searchParams.get('op') || '';
      calls.push({ action, op });
      let payload;
      if (action === 'brand' && op === 'catalog-status') payload = statuses.length > 1 ? statuses.shift() : statuses[0];
      else if (action === 'connections') payload = { ok: true, providers: [], connections: [], routing: { entries: [], use_platform_fallback: true }, secrets_storage: {} };
      else payload = { ok: true, brand: BRAND, workspaces: [], active_id: BRAND.id };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('http://127.0.0.1:' + srv.address().port + '/brand-connections.html', { waitUntil: 'load' });
    const card = page.locator('#catalogCard');
    await expect(card).toContainText('450 of 2430 products read, continuing by itself', { timeout: 15000 });
    await expect(page.locator('#catalogContinue')).toHaveCount(0);
    await expect(card).toContainText('Product catalogue: read completely', { timeout: 20000 });
    expect(calls.filter((c) => c.op === 'catalog-import')).toHaveLength(0);
  } finally { await new Promise((r) => srv.close(r)); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4b. What the probe found on the REAL stores (2026-10-11, runs 38111611525
       and 38111613094), reproduced: Lenskart's per-market locale subtrees and
       Nykaa's blog "product-reviews" sitemaps, product index and throttling
   ═══════════════════════════════════════════════════════════════════════════ */

test('EVERY regional store the brand publishes is read, each product filed under the market of the store it came from, in that store\'s currency: IN, US, AE and SA from one import', async () => {
  test.setTimeout(150_000);
  const w = world({ website: 'https://lensworld.example', regions: [{ code: 'IN', home: true }] });
  try {
    const T = st.stores['lensworld.example'].truth;
    const out = await core.importCatalog(w.owner, { workspace_id: WS, region: 'in', kind: 'storefront', url: 'https://lensworld.example' });
    expect(out.complete).toBe(true);
    const live = w.rows().filter((r) => !r.stale_at);
    const by = (reg) => live.filter((r) => r.region === reg);
    expect(by('in')).toHaveLength(T.inProducts - T.inStale - T.inWrongCurrency);
    expect(by('us')).toHaveLength(T.us);
    expect(by('ae')).toHaveLength(T.ae);
    expect(by('sa')).toHaveLength(T.sa);
    for (const [reg, cur, rx] of [['in', 'INR', /^https:\/\/lensworld\.example\/frame-/], ['us', 'USD', /\/en-us\//], ['ae', 'AED', /\/en-ae\//], ['sa', 'SAR', /\/ar-sa\//]]) {
      expect(new Set(by(reg).map((r) => r.currency)), reg).toEqual(new Set([cur]));
      expect(by(reg).every((r) => rx.test(r.product_url)), reg).toBe(true);
    }
    // One line per market, then each market's own account.
    expect(out.coverage.sentences[0]).toContain(`IN: ${T.inProducts - T.inStale - T.inWrongCurrency} of ${T.inDeclared} · US: ${T.us} of ${T.us} · AE: ${T.ae} of ${T.ae} · SA: ${T.sa} of ${T.sa}`);
    expect(said(out.coverage)).toContain('SA store https://lensworld.example/ar-sa (found from the site\'s sitemap /ar-sa/sitemap.xml, prices in SAR)');
    expect(said(out.coverage)).toContain('US store https://lensworld.example/en-us (found from the site\'s hreflang="en-us", prices in USD)');
    // Every market recorded beside the brand, with where it came from.
    expect(w.wsRow().catalog_source.markets.map((m) => m.code)).toEqual(['IN', 'US', 'AE', 'SA']);
    expect(out.markets.map((m) => [m.code, m.currency, m.complete])).toEqual([['IN', 'INR', true], ['US', 'USD', true], ['AE', 'AED', true], ['SA', 'SAR', true]]);
    expect(out.live_by_market).toMatchObject({ us: T.us, ae: T.ae, sa: T.sa });
    // What the IN store's own read says.
    expect(said(out.coverage)).toContain(`${T.inWrongCurrency} products priced in another currency than IN's INR were not filed under IN`);
    expect(said(out.coverage)).toContain(`${T.inStale} URLs the sitemaps list answered 404 or 410`);
    expect(said(out.coverage)).toContain('feeds/catalogue.xml is an XML document whose root element is <rss>');
    expect(said(out.coverage)).not.toContain('extra-sitemap.xml');
    expect(hitsOf('lensworld.example', /categories\.xml|pages\.xml/)).toHaveLength(0);
  } finally { w.restore(); }
});

test('a brand with two regional DOMAINS (twinbrand.example, twinbrand.co.uk tied by hreflang) is read on both: US rows in USD from one, UK rows in GBP from the other', async () => {
  test.setTimeout(90_000);
  const d = deviceWorld();
  try {
    const r = await core.importCatalog(PHONE, { region: 'us', kind: 'storefront', url: 'https://twinbrand.example', brand: { website: 'https://twinbrand.example', regions: [{ code: 'US', home: true }] } });
    expect(r.complete).toBe(true);
    const us = r.products.filter((p) => p.region === 'us');
    const uk = r.products.filter((p) => p.region === 'uk');
    expect(us).toHaveLength(20);
    expect(uk).toHaveLength(15);
    expect(us.every((p) => p.currency === 'USD' && /^https:\/\/twinbrand\.example\//.test(p.product_url))).toBe(true);
    expect(uk.every((p) => p.currency === 'GBP' && /^https:\/\/twinbrand\.co\.uk\//.test(p.product_url))).toBe(true);
    expect(r.markets.map((m) => [m.code, m.store_url])).toEqual([['US', 'https://twinbrand.example'], ['UK', 'https://twinbrand.co.uk']]);
    // The completed markets are said, so the device stales each market alone.
    expect(r.completed_regions.sort()).toEqual(['uk', 'us']);
  } finally { d.restore(); }
});

test('a store that GEO-REDIRECTS one market\'s pages into another market\'s store: what comes back is filed under THAT market (its store, its currency), said per market, never under the asked one, with no disguise', async () => {
  test.setTimeout(150_000);
  const d = deviceWorld();
  st.stores['lensworld.example'].geo = 'US';
  const was = process.env.VERCEL_REGION;
  process.env.VERCEL_REGION = 'iad1';
  try {
    const T = st.stores['lensworld.example'].truth;
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://lensworld.example', brand: { website: 'https://lensworld.example' } });
    expect(r.products.filter((p) => p.region === 'in')).toHaveLength(0);
    const redirected = r.products.filter((p) => p.region === 'us' && /\/en-us\/frame-0\d{3}\.html$/.test(p.product_url));
    expect(redirected.length).toBeGreaterThan(0);
    expect(redirected.every((p) => p.currency === 'USD')).toBe(true);
    // The US store's own products are read as its own market too.
    expect(r.products.filter((p) => p.region === 'us').length).toBeGreaterThanOrEqual(T.us);
    expect(r.products.filter((p) => p.region === 'ae')).toHaveLength(T.ae);
    expect(said(r.coverage)).toContain('lensworld.example sent requests for its IN pages to its US store (/en-us/)');
    expect(said(r.coverage)).toContain('the store chooses its store by the visitor\'s location, and this server reads from iad1 (Washington, D.C., US)');
    expect(said(r.coverage)).toContain('filed under US, the market whose store and prices they carry, never under IN');
    expect(r.coverage.sentences[0]).toContain('IN: 0 of 600 (sent to the US store from here)');
    expect(r.markets.find((m) => m.code === 'IN')).toMatchObject({ blocked: true, complete: false });
    expect(r.complete).toBe(false);
    expect(r.resume_available).toBe(false);
    // It gave the IN store up after a few: never 600 pages read to file nothing under IN.
    expect(hitsOf('lensworld.example', /^\/frame-\d+\.html$/).length).toBeLessThanOrEqual(imp.LIMITS.geoRedirectsToStop + imp.LIMITS.pdpConcurrency);
    // No disguise: no cookie, no forwarded address, no Accept-Language but
    // Node's own "*", the platform's own user agent.
    const all = st.hits['lensworld.example'] || [];
    expect([...new Set(all.map((h) => h.lang))].filter((x) => x && x !== '*')).toEqual([]);
    expect(all.every((h) => !h.cookie && !h.forwarded && h.ua === imp.USER_AGENT)).toBe(true);
    delete process.env.VERCEL_REGION;
    st.reset(); st.stores['lensworld.example'].geo = 'US';
    const r2 = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://lensworld.example', brand: { website: 'https://lensworld.example' } });
    expect(said(r2.coverage)).toContain('this server reads from outside IN as far as this server can tell');
  } finally { if (was === undefined) delete process.env.VERCEL_REGION; else process.env.VERCEL_REGION = was; d.restore(); }
});

test('a self-chaining import walks EVERY market until each is complete, then marks only each market\'s own unseen rows stale', async () => {
  test.setTimeout(180_000);
  const srv = await serve('api/public-config.js');
  const w = world({ website: 'https://lensworld.example', regions: [{ code: 'IN', home: true }] }, {
    chain: (u, init) => {
      const q = new URL(u);
      const headers = {};
      for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
      post(srv.port, q.pathname + q.search, JSON.parse(init.body), { authorization: headers.authorization }).catch(() => {});
      return { ok: true };
    },
  });
  st.stores['lensworld.example'].delayMs = 3;
  try {
    // Last week's read left a US product the store no longer lists.
    w.db.insert('brand_catalog_products', { workspace_id: WS, region: 'us', handle: 'retired-frame', sku: null, title: 'Retired', source: 'sitemap_jsonld', stale_at: null, last_seen_run: 'old' });
    w.db.insert('brand_catalog_products', { workspace_id: WS, region: 'uk', handle: 'kept-uk', sku: null, title: 'Other market', source: 'sitemap_jsonld', stale_at: null, last_seen_run: 'old' });
    const first = await core.importCatalog(w.owner, { workspace_id: WS, region: 'in', kind: 'storefront', url: 'https://lensworld.example', budgetMs: 2500 });
    expect(first.complete).toBe(false);
    expect(first.continuing).toBe(true);
    const t0 = Date.now();
    while (Date.now() - t0 < 150_000) {
      const i0 = w.wsRow().catalog_import;
      if (i0 && !i0.cursor && i0.chain && (i0.chain.done || i0.chain.stopped)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const fin = w.wsRow().catalog_import;
    expect(fin.chain.done).toBe(true);
    const live = w.rows().filter((r) => !r.stale_at);
    const T = st.stores['lensworld.example'].truth;
    expect(live.filter((r) => r.region === 'us' && r.handle !== 'retired-frame')).toHaveLength(T.us);
    expect(live.filter((r) => r.region === 'sa')).toHaveLength(T.sa);
    expect(w.rows().find((r) => r.handle === 'retired-frame').stale_at).toBeTruthy();   // US read whole: its unseen row is stale
    expect(w.rows().find((r) => r.handle === 'kept-uk').stale_at).toBeFalsy();          // a market not read is never touched
    expect(fin.coverage.sentences[0]).toContain(`US: ${T.us} of ${T.us}`);
  } finally { w.restore(); await srv.close(); }
});

test('onboarding: the markets an import finds are ADDED to the brand\'s regions (with where they came from) through the ordinary save; the typed home row is untouched; the progress line counts every market', async ({ page }) => {
  test.setTimeout(90_000);
  const markets = [
    { code: 'IN', currency: 'INR', store_url: 'https://lensworld.example', source: 'the site\'s hreflang="en-in"', found: 567, declared: 600, complete: true },
    { code: 'US', currency: 'USD', store_url: 'https://lensworld.example/en-us', source: 'the site\'s hreflang="en-us"', found: 40, declared: 130, complete: false },
    { code: 'AE', currency: 'AED', store_url: 'https://lensworld.example/en-ae', source: 'the site\'s hreflang="en-ae"', found: 0, declared: null, complete: false },
  ];
  const typedHome = { code: 'IN', home: true, store_url: 'https://lensworld.example', currency: 'INR' };
  const B = Object.assign({}, BRAND, { regions: [typedHome] });
  const srv = appServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const saves = [];
  try {
    await page.route('**/api/public-config**', async (route) => {
      const op = new URL(route.request().url()).searchParams.get('op') || '';
      let sent = null; try { sent = JSON.parse(route.request().postData() || 'null'); } catch (_) { sent = null; }
      let payload;
      if (op === 'catalog-import') payload = { ok: true, imported: 607, complete: false, resume_available: true, continuing: false, drive: false, progressed: true, markets, coverage: { found: 607, complete: false, markets, sentences: ['Every regional store the brand publishes: 3 markets. IN: 567 of 600 · US: 40 of 130 · AE: 0 (not read yet).'] }, live: 567 };
      else if (op === 'catalog-status') payload = { ok: true, coverage: null, resume_available: false };
      else if (op === 'save') { saves.push(sent); payload = { ok: true, brand: Object.assign({}, B, (sent && (sent.brand || sent)) || {}) }; }
      else payload = { ok: true, brand: B, workspaces: [], active_id: B.id, pack: null, presets: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('http://127.0.0.1:' + srv.address().port + '/onboarding.html', { waitUntil: 'load' });
    await expect(page.locator('#title')).toContainText('Edit Lens Shop', { timeout: 15000 });
    const pip = page.locator('.step-pip[data-step="5"]');
    await pip.waitFor({ state: 'visible', timeout: 15000 });
    await pip.click({ force: true });
    await page.fill('#impUrl', 'https://lensworld.example');
    await page.locator('#doImport').click();
    await expect(page.locator('#impStatus')).toContainText('Markets this store publishes were added to the brand\'s regions: US, AE', { timeout: 10000 });
    const last = saves[saves.length - 1];
    const regs = (last.brand || last).regions;
    expect(regs[0]).toMatchObject({ code: 'IN', home: true, store_url: 'https://lensworld.example' });
    expect(regs.slice(1).map((r) => [r.code, r.currency, r.store_url, r.home])).toEqual([['US', 'USD', 'https://lensworld.example/en-us', false], ['AE', 'AED', 'https://lensworld.example/en-ae', false]]);
    expect(regs[1].source).toContain('site read: the site\'s hreflang="en-us"');
    await expect(page.locator('#impCoverage')).toContainText('IN: 567 of 600 · US: 40 of 130');
  } finally { await new Promise((r) => srv.close(r)); }
});

test('a resumed read re-reads robots.txt first: one that still cannot be read stops it again, never a crawl of a site that has not said what may be read', async () => {
  test.setTimeout(60_000);
  const d = deviceWorld();
  st.stores['robots.example'].robotsStatus = 503;
  try {
    const brand = { website: 'https://robots.example', regions: [{ code: 'UK', home: true }] };
    const first = await core.importCatalog(PHONE, { region: 'uk', kind: 'storefront', url: 'https://robots.example', brand });
    expect(first.complete).toBe(false);
    expect(first.cursor).toBeTruthy();
    const again = await core.importCatalog(PHONE, { region: 'uk', kind: 'storefront', url: 'https://robots.example', brand, cursor: first.cursor });
    expect(again.complete).toBe(false);
    expect(said(again.coverage)).toContain('RFC 9309 says to treat that as "disallow everything", so nothing was read');
    expect(hitsOf('robots.example', /^\/(?!robots\.txt)/)).toHaveLength(0);
  } finally { d.restore(); }
});

test('product sitemaps are typed by the WORDS of their path: blog "product-reviews" sitemaps are not products and are never read; the store\'s own product index is read FIRST', async () => {
  test.setTimeout(120_000);
  for (const [u, want] of [
    ['https://x.example/beauty-blog/sitemaps/product-reviews/top-brands.xml', 'non-product'],
    ['https://x.example/beauty-blog/sitemaps/product-launches-reviews/a.xml', 'non-product'],
    ['https://x.example/sitemap-v2/sitemap-products-index.xml', 'product'],
    ['https://x.example/products.xml', 'product'],
    ['https://x.example/product-sitemap2.xml.gz', 'product'],
    ['https://x.example/product_cat-sitemap.xml', 'non-product'],
    ['https://x.example/sitemap-v2/sitemap-dp-index.xml', 'other'],
  ]) expect(imp.sitemapClass(u, false), u).toBe(want);
  expect(imp.sitemapClass('https://x.example/sitemaps/p/a/7.xml.gz', true)).toBe('product');
  expect(imp.sitemapClass('https://x.example/blog/7.xml', true)).toBe('non-product');

  const d = deviceWorld();
  try {
    const T = st.stores['beautymart.example'].truth;
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://beautymart.example', brand: { website: 'https://beautymart.example' } });
    expect(r.complete).toBe(true);
    expect(r.products).toHaveLength(T.products);
    expect(hitsOf('beautymart.example', /^\/beauty-blog\//)).toHaveLength(0);
    expect(hitsOf('beautymart.example', /sitemap-(reviews|categories)-index/)).toHaveLength(0);
    const sm = hitsOf('beautymart.example', /\.xml$/).map((h) => h.path);
    // (The first read of the root index is the market discovery's.) The
    // import's own walk reads the product index right after the root index.
    const rootAt = sm.lastIndexOf('/sitemap-v2/sitemap-index.xml');
    expect(sm[rootAt + 1]).toBe('/sitemap-v2/sitemap-products-index.xml');
    expect(said(r.coverage)).toContain('of the 700 products the site declares');
    expect(said(r.coverage)).toMatch(/3 sitemaps of pages that are not products/);
    expect(said(r.coverage)).toContain('was tried once; it answered 429');
  } finally { d.restore(); }
});

test('a store that drops parallel connections is THROTTLING, not dead pages: the read slows to one at a time, backs off, retries every failed page and reads them all', async () => {
  test.setTimeout(150_000);
  const d = deviceWorld();
  const B = st.stores['beautymart.example'];
  B.maxInflight = 2; B.pdpDelayMs = 15;
  try {
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://beautymart.example', brand: { website: 'https://beautymart.example' } });
    expect(B.dropped).toBeGreaterThan(0);                     // the store really did drop connections
    expect(r.complete).toBe(true);
    expect(r.products).toHaveLength(B.truth.products);        // and every product was read in the end
    expect(said(r.coverage)).toMatch(/The store stopped answering requests made in parallel \d+ times? \(throttling, not missing pages\): the importer slowed to [12] at a time/);
    expect(said(r.coverage)).not.toMatch(/did not answer even when read one at a time/);
  } finally { d.restore(); }
});

test('a store that refuses even one request at a time stops the step as THROTTLED with a wait and its place kept - no page is written off', async () => {
  test.setTimeout(150_000);
  const d = deviceWorld();
  const B = st.stores['beautymart.example'];
  B.maxInflight = -1;                                       // every product page dropped
  try {
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://beautymart.example', brand: { website: 'https://beautymart.example' }, budgetMs: 45000 });
    expect(r.complete).toBe(false);
    expect(r.coverage.stopped).toMatchObject({ reason: 'throttled', wait_ms: 60000 });
    expect(r.coverage.not_before).toBeTruthy();
    expect(r.coverage.skipped.unreachable || 0).toBe(0);
    expect(said(r.coverage)).toContain('the store kept refusing requests even one at a time');
    expect(r.cursor).toBeTruthy();
    expect(r.drive).toBe(true);
  } finally { d.restore(); }
});

test('the per-market limit is a stated LIMIT with the numbers (never "mores"), and the first URLs the sitemaps list are the ones read', async () => {
  test.setTimeout(120_000);
  const d = deviceWorld();
  const was = imp.LIMITS.maxProducts;
  imp.LIMITS.maxProducts = 300;
  try {
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://beautymart.example', brand: { website: 'https://beautymart.example' } });
    expect(r.products).toHaveLength(300);
    expect(said(r.coverage)).toContain('of the 700 products the site declares');
    expect(said(r.coverage)).toContain('LIMIT: this importer reads at most 300 product URLs per market per import');
    expect(said(r.coverage)).toContain('the first 300 the sitemaps list were read and 400 more were not');
    expect(said(r.coverage)).not.toMatch(/mores\b/);
    expect(r.products.map((p) => p.title).slice(0, 2)).toEqual(['Serum 0001', 'Serum 0002']);
  } finally { imp.LIMITS.maxProducts = was; d.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4c. The re-run on the real stores (runs 38115336341 Lenskart, 38115338157
       Nykaa): the root store missing, store choice, the 20,000 cap, throttling
   ═══════════════════════════════════════════════════════════════════════════ */

test('the ROOT store is always a market - the one asked for - even when the root\'s hreflang names another country: IN at "/" is read and listed first', async () => {
  test.setTimeout(90_000);
  const d = deviceWorld();
  st.stores['lensworld.example'].rootHreflangUs = true;
  try {
    const T = st.stores['lensworld.example'].truth;
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://lensworld.example', brand: { website: 'https://lensworld.example' } });
    expect(r.markets[0]).toMatchObject({ code: 'IN', store_url: 'https://lensworld.example', currency: 'INR' });
    expect(r.products.filter((p) => p.region === 'in')).toHaveLength(T.inProducts - T.inStale - T.inWrongCurrency);
    expect(r.products.filter((p) => p.region === 'us').every((p) => /\/en-us\//.test(p.product_url))).toBe(true);
    expect(said(r.coverage)).toContain('points US\'s store at the site\'s root, which is IN\'s store here');
    // No market asked: the brand's HOME market is the root's.
    st.reset(); st.stores['lensworld.example'].rootHreflangUs = true;
    const home = await core.importCatalog(PHONE, { kind: 'storefront', url: 'https://lensworld.example', brand: { website: 'https://lensworld.example', regions: [{ code: 'IN', home: true }] } });
    expect(home.markets[0]).toMatchObject({ code: 'IN', store_url: 'https://lensworld.example' });
  } finally { d.restore(); }
});

test('a market whose pages are geo-redirected is still in the per-market line, saying where they were sent', async () => {
  test.setTimeout(120_000);
  const d = deviceWorld();
  st.stores['lensworld.example'].geo = 'US';
  try {
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://lensworld.example', brand: { website: 'https://lensworld.example' } });
    expect(r.coverage.sentences[0]).toContain('IN: 0 of 600 (sent to the US store from here)');
  } finally { d.restore(); }
});

test('STORE CHOICE THE SITE OFFERS: the page a geo-redirect lands on names this market\'s address in its own hreflang (?country=in); that is used, said, and the market is read whole - with no cookie, header or address invented', async () => {
  test.setTimeout(120_000);
  const d = deviceWorld();
  const L = st.stores['lensworld.example'];
  L.geo = 'US'; L.geoSelector = true;
  try {
    const T = L.truth;
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://lensworld.example', brand: { website: 'https://lensworld.example' } });
    const inRows = r.products.filter((p) => p.region === 'in');
    expect(inRows).toHaveLength(T.inProducts - T.inStale - T.inWrongCurrency);
    expect(new Set(inRows.map((p) => p.currency))).toEqual(new Set(['INR']));
    expect(r.markets.find((m) => m.code === 'IN')).toMatchObject({ complete: true, blocked: false });
    expect(said(r.coverage)).toContain('offers IN\'s store itself: the page it sends to names IN\'s address for the same product in its own hreflang');
    expect(said(r.coverage)).toContain('the ?country=in parameter');
    expect(said(r.coverage)).toContain('no cookie, header or address was invented');
    // Learned once: after the first redirect the IN address is asked for directly.
    const plain = hitsOf('lensworld.example', /^\/frame-\d+\.html$/);
    expect(plain.length).toBeLessThanOrEqual(imp.LIMITS.pdpConcurrency);
    const all = st.hits['lensworld.example'] || [];
    expect([...new Set(all.map((h) => h.lang))].filter((x) => x && x !== '*')).toEqual([]);
    expect(all.every((h) => !h.cookie && !h.forwarded && h.ua === imp.USER_AGENT)).toBe(true);
  } finally { d.restore(); }
});

test('NO CAP for an account brand: the product URL queue is a table (service role, workspace on every query), the cursor stays a small pointer, every URL is read, and a finished run leaves no rows', async () => {
  test.setTimeout(180_000);
  const w = world({ website: 'https://lensshop.example', regions: [{ code: 'IN', home: true }] });
  const was = imp.LIMITS.maxProducts;
  imp.LIMITS.maxProducts = 300;                     // the old cursor cap, far below the store's 2,430
  st.stores['lensshop.example'].delayMs = 4;
  try {
    let r = await core.importCatalog(w.owner, { workspace_id: WS, region: 'in', kind: 'storefront', url: 'https://lensshop.example', budgetMs: 2500 });
    expect(r.complete).toBe(false);
    const queued = w.db.table('brand_catalog_import_queue');
    expect(queued.length).toBeGreaterThan(imp.LIMITS.maxProducts);   // already past the old cap, in the table
    expect(queued.every((x) => x.workspace_id === WS)).toBe(true);
    // The cursor is a pointer: no URL list on the brand's row.
    expect(JSON.stringify(w.wsRow().catalog_import).length).toBeLessThan(60000);
    // Every queue call named the workspace, as the service role.
    const qCalls = w.db.calls.filter((c) => /brand_catalog_import_queue/.test(c.url));
    expect(qCalls.length).toBeGreaterThan(0);
    expect(qCalls.every((c) => c.token === SERVICE_KEY && c.url.includes(`workspace_id=eq.${WS}`) || (c.method === 'POST' && Array.isArray(c.body) && c.body.every((x) => x.workspace_id === WS)))).toBe(true);
    // A member's own token cannot write it.
    const own = await fetch(`${BASE}/rest/v1/brand_catalog_import_queue`, { method: 'POST', headers: { apikey: ANON_KEY, Authorization: 'Bearer tok-owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: WS, run_id: 'x', market: 'in', url: 'https://lensshop.example/x' }) });
    expect(own.status).toBe(403);
    for (let i = 0; i < 40 && !r.complete; i++) r = await core.importCatalog(w.owner, { workspace_id: WS, continue: true, budgetMs: 2500 });
    expect(r.complete).toBe(true);
    expect(w.rows().filter((x) => !x.stale_at && x.region === 'in')).toHaveLength(2430);
    expect(said(r.coverage)).not.toContain('LIMIT:');
    expect(w.db.table('brand_catalog_import_queue').filter((x) => x.workspace_id === WS)).toHaveLength(0);
    const perPage = {};
    for (const h of hitsOf('lensshop.example', /^\/frames\//)) perPage[h.path] = (perPage[h.path] || 0) + 1;
    expect(Object.keys(perPage)).toHaveLength(2430);
    expect(Math.max(...Object.values(perPage))).toBe(1);
  } finally { imp.LIMITS.maxProducts = was; w.restore(); }
});

test('SQL: brand_catalog_import_queue - one row per (workspace, run, market, url), a state CHECK, members read it, a member cannot write it', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const MIG = path.join(ROOT, 'supabase', 'migrations');
  await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;`);
  await db.exec(fs.readFileSync(path.join(MIG, '20260809120000_brand_workspaces.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(MIG, '20261011054000_catalog_import_queue.sql'), 'utf8'));
  const OTHER = '99999999-9999-4999-8999-999999999999';
  await db.query(`insert into public.brand_workspaces (id, owner_id, slug, name) values ($1, $2, 'q', 'Q')`, [WS, OWNER]);
  const ins = (u) => db.query(`insert into public.brand_catalog_import_queue (workspace_id, run_id, market, url, seq) values ($1, 'r1', 'in', $2, 1) on conflict (workspace_id, run_id, market, url) do nothing returning id`, [WS, u]);
  expect((await ins('https://q.example/a')).rows).toHaveLength(1);
  expect((await ins('https://q.example/a')).rows).toHaveLength(0);          // listed twice, queued once
  await expect(db.query(`insert into public.brand_catalog_import_queue (workspace_id, run_id, market, url, state) values ($1, 'r1', 'in', 'https://q.example/b', 'maybe')`, [WS])).rejects.toThrow(/brand_catalog_import_queue_state_chk/);
  await db.exec(`grant usage on schema public to authenticated; grant select on public.brand_workspaces, public.brand_workspace_members to authenticated;`);
  await db.exec(`set test.uid = '${OWNER}'; set role authenticated;`);
  expect((await db.query('select url from public.brand_catalog_import_queue')).rows.map((x) => x.url)).toEqual(['https://q.example/a']);
  await expect(db.query(`insert into public.brand_catalog_import_queue (workspace_id, run_id, market, url) values ($1, 'r1', 'in', 'https://q.example/c')`, [WS])).rejects.toThrow(/permission denied/);
  await db.exec(`set test.uid = '${OTHER}';`);
  expect((await db.query('select url from public.brand_catalog_import_queue')).rows).toHaveLength(0);   // not a member: nothing
});

test('robots.txt Crawl-delay is the rate from the first request: one page at a time, that far apart, and the rest is estimated honestly - never called complete early', async () => {
  test.setTimeout(120_000);
  const d = deviceWorld();
  try {
    const brand = { website: 'https://crawlshop.example' };
    let r = await core.importCatalog(PHONE, { region: 'uk', kind: 'storefront', url: 'https://crawlshop.example', brand, budgetMs: 6000 });
    expect(r.complete).toBe(false);
    expect(said(r.coverage)).toContain('robots.txt asks for 1 s between requests (Crawl-delay)');
    expect(said(r.coverage)).toMatch(/At the rate this store answers \(about \d+ pages a minute, one request every 1 s\), the \d+ product pages still to read take about \d+ minutes?\. The import keeps going until then and is not complete before\./);
    for (let i = 0; i < 10 && !r.complete; i++) r = await core.importCatalog(PHONE, { region: 'uk', kind: 'storefront', url: 'https://crawlshop.example', brand, cursor: r.cursor, budgetMs: 6000 });
    expect(r.complete).toBe(true);
    const at = hitsOf('crawlshop.example', /^\/item\//).map((h) => h.at).sort((a, b) => a - b);
    expect(at).toHaveLength(12);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1], `request ${i}`).toBeGreaterThanOrEqual(950);
  } finally { d.restore(); }
});

test('sustained THROTTLING is met with a steady polite rate that keeps going across steps until every page is read - not a stop at the 17th URL', async () => {
  test.setTimeout(180_000);
  const d = deviceWorld();
  const S = st.stores['slowmarket.example'];
  S.minGapMs = 600;
  try {
    const brand = { website: 'https://slowmarket.example' };
    let r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://slowmarket.example', brand, budgetMs: 15000 });
    let steps = 1;
    for (; steps < 12 && !r.complete; steps++) {
      expect(r.coverage.stopped && r.coverage.stopped.reason).not.toBe('throttled');
      r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://slowmarket.example', brand, cursor: r.cursor, budgetMs: 15000 });
    }
    expect(S.dropped).toBeGreaterThan(0);                                      // the store did throttle
    expect(r.complete).toBe(true);
    expect(r.products.length + 0).toBeGreaterThan(0);
    expect(said(r.coverage)).toMatch(/then to one request every \d+(\.\d)? s/);
    expect(said(r.coverage)).not.toMatch(/did not answer even when read one at a time/);
  } finally { d.restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. The probe a runner can dispatch at a real store
   ═══════════════════════════════════════════════════════════════════════════ */

test('the catalogue probe workflow is dispatch-only and read-only, and its script runs the shipped importer step by step and reports the sitemap tree', async () => {
  test.setTimeout(120_000);
  const YAML = require('yaml');
  const raw = fs.readFileSync(path.join(ROOT, '.github/workflows/catalog-probe.yml'), 'utf8');
  const wf = YAML.parse(raw);
  expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
  expect(wf.permissions).toEqual({ contents: 'read' });
  expect(raw).not.toMatch(/secrets\./);
  for (const job of Object.values(wf.jobs)) {
    expect(job.permissions === undefined || JSON.stringify(job.permissions) === '{"contents":"read"}').toBe(true);
    for (const s of job.steps) {
      // Inputs reach the shell only through env, never interpolated into it.
      if (s.run) expect(s.run).not.toMatch(/\$\{\{/);
      if (s.uses && /checkout/.test(s.uses)) expect(s.with && s.with['persist-credentials']).toBe(false);
    }
    expect(job.steps.some((s) => s.run && /node scripts\/catalog-probe\.js/.test(s.run))).toBe(true);
  }
  const { probe, summary } = require('../scripts/catalog-probe.js');
  const d = deviceWorld();
  try {
    const out = await probe({ url: 'https://lensshop.example', region: 'IN', steps: 4, budgetMs: 30000 });
    expect(out.complete).toBe(true);
    expect(out.found).toBe(2430);
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.sitemaps.filter((s) => /sitemap-\d+\.xml/.test(s.url))).toHaveLength(21);
    expect(out.sitemaps.find((s) => /\/sitemap\.xml$/.test(s.url)).kind).toBe('index (a urlset listing sitemaps)');
    const md = summary(out);
    expect(md).toContain('## Catalogue probe: https://lensshop.example (IN)');
    expect(md).toContain('| https://lensshop.example/sitemap/sitemap-01.xml | urlset | 116 |');
    expect(new Set((st.hits['lensshop.example'] || []).map((h) => h.ua))).toEqual(new Set([imp.USER_AGENT]));
  } finally { d.restore(); }
});
