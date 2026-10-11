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
    const first = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: 'https://bigmarket.example', brand, budgetMs: 40000 });
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
