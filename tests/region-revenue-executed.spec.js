// Revenue by region, EXECUTED over the in-memory PostgREST (2026-10-11).
//
// The operator: "As a founder, I would look at revenue and sales of each
// region. This app must support that. Multiple region selection must be
// allowed too."
//
// api/_shared/region-revenue-server.js and region-revenue.js run UNMODIFIED
// against tests/lib/fake-supabase.js, which enforces RLS (a user's token sees
// only workspaces they own or belong to), the editor-only write policy of
// 20261011045000_brand_fx_rates.sql, and PostgREST's max_rows (1,000 rows a
// request whatever `limit` asks), so a reader that stops on a short page
// fails here exactly as it would against the real server. The caller is
// verified by the real requireUser() against the fake GoTrue.
//
// What has to hold:
//   - each region's figures are exact, from that region's orders only (IN in
//     INR, US in USD, UK in GBP), paged past max_rows;
//   - another workspace's orders never reach this one, and a stranger's token
//     reads nothing (every region the marker);
//   - a market with no orders is the marker for THAT market, never 0;
//   - no combined total across currencies without entered rates; with them,
//     the exact conversion, each rate with its date and who entered it; an
//     inverse rate is never used; a viewer cannot enter one;
//   - net only where refunds are stated on every order; one source per region
//     (store orders preferred, never added to synced orders).
//
// Run: npx playwright test tests/region-revenue-executed.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { FakeSupabase, envScope, makeReq, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const RR = require(path.join(ROOT, 'api', '_shared', 'region-revenue.js'));
const server = require(path.join(ROOT, 'api', '_shared', 'region-revenue-server.js'));
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const wsScope = require(path.join(ROOT, 'api', '_shared', 'workspace-scope.js'));

const ENV = envScope(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY']);

const BRAND = {
  name: 'Brambleweld Larder',
  regions: [
    { code: 'IN', currency: 'INR', home: true },
    { code: 'US', currency: 'USD' },
    { code: 'UK', currency: 'GBP' },
    { code: 'AU', currency: 'AUD' },
  ],
};
const TODAY = new Date().toISOString().slice(0, 10);
function day(back) { return new Date(Date.parse(TODAY + 'T00:00:00Z') - back * 86400000).toISOString().slice(0, 10); }
function at(back) { return day(back) + 'T10:00:00Z'; }

let db;
const IN_COUNT = 1203;   // past max_rows (1,000): a reader that trusts a short page reads 1,000

function world() {
  db = new FakeSupabase();
  db.addUser('tok-owner', 'u-owner', 'founder@brambleweld.example');
  db.addUser('tok-viewer', 'u-viewer', 'viewer@brambleweld.example');
  db.addUser('tok-stranger', 'u-stranger', 'someone@else.example');
  db.addWorkspace('ws-zero', 'u-zero', { created_at: '2020-01-01T00:00:00Z', name: 'Tenant zero' });
  db.addWorkspace('ws-a', 'u-owner', { created_at: '2026-01-01T00:00:00Z', name: BRAND.name });
  db.addWorkspace('ws-b', 'u-stranger', { created_at: '2026-02-01T00:00:00Z', name: 'Quillforth Gazette' });
  db.addMember('ws-a', 'u-viewer', 'viewer');
  db.syncIdentityTables();
  const t = db.table('smart_orders');
  // IN: 1,203 orders inside the last 30 days, 100 INR each, customers c0..c99
  // (each first seen in the window); refunds NOT stated on every order.
  for (let i = 0; i < IN_COUNT; i++) {
    t.push({ id: 'in-' + i, workspace_id: 'ws-a', user_id: 'c' + (i % 100), market: i % 2 ? 'India' : 'IN', total: 100, created_at: at(i % 30), product_sku: 'MANGO-1', metadata: i < 5 ? { refund: 0 } : {} });
  }
  // US: 4 orders in window (refunds stated on all), 1 in the previous period,
  // one customer returning (seen before the window).
  t.push({ id: 'us-0', workspace_id: 'ws-a', user_id: 'u1', market: 'US', total: 50, created_at: at(40), product_sku: 'JAM', metadata: { refund: 0, quantity: 1 } });
  t.push({ id: 'us-1', workspace_id: 'ws-a', user_id: 'u1', market: 'US', total: 40, created_at: at(3), product_sku: 'JAM', metadata: { refund: 10, quantity: 2 } });
  t.push({ id: 'us-2', workspace_id: 'ws-a', user_id: 'u2', market: 'US', total: 60, created_at: at(2), product_sku: 'TEA', metadata: { refund: 0, quantity: 1 } });
  t.push({ id: 'us-3', workspace_id: 'ws-a', user_id: 'u3', market: 'USA', total: 25.5, created_at: at(1), product_sku: 'JAM', metadata: { refund: 0, quantity: 1 } });
  t.push({ id: 'us-4', workspace_id: 'ws-a', user_id: null, market: 'US', total: 10, created_at: at(0), product_sku: 'TEA', metadata: { refund: 0, quantity: 3 } });
  t.push({ id: 'us-x', workspace_id: 'ws-a', user_id: 'u9', market: 'US', total: 999, created_at: at(1), metadata: { financial_status: 'voided' } });
  // UK synced orders that ALSO arrive as store orders: the store's are read, never both.
  t.push({ id: 'uk-s1', workspace_id: 'ws-a', user_id: 'k1', market: 'UK', total: 30, created_at: at(5) });
  // A market the brand does not serve: unattributed, never folded in.
  t.push({ id: 'de-1', workspace_id: 'ws-a', user_id: 'd1', market: 'DE', total: 70, created_at: at(4) });
  // Another workspace's IN orders: must never reach ws-a.
  for (let i = 0; i < 50; i++) t.push({ id: 'b-' + i, workspace_id: 'ws-b', user_id: 'x' + i, market: 'IN', total: 100000, created_at: at(2) });
  const sh = db.table('shopify_orders');
  sh.push({ id: 'sh1', workspace_id: 'ws-a', shopify_order_id: '9001', total_price: 30, currency: 'GBP', created_at_shopify: at(5), raw_payload: { shipping_address: { country_code: 'GB' }, customer: { id: 77 }, refunds: [], total_discounts: '0.00', line_items: [{ sku: 'JAM', title: 'Bramble Jam', quantity: 1, price: '30.00' }] } });
  sh.push({ id: 'sh2', workspace_id: 'ws-a', shopify_order_id: '9002', total_price: 45, currency: 'GBP', created_at_shopify: at(6), raw_payload: { shipping_address: { country_code: 'GB' }, customer: { id: 78 }, refunds: [{ transactions: [{ kind: 'refund', amount: '5.00' }] }], total_discounts: '2.00', line_items: [{ sku: 'TEA', title: 'Smoked Tea', quantity: 2, price: '22.50' }] } });
  db.table('brand_catalog_products').push(
    { id: 'p1', workspace_id: 'ws-a', region: 'US', sku: 'JAM', handle: 'bramble-jam', title: 'Bramble Jam (US)' },
    { id: 'p2', workspace_id: 'ws-a', region: 'UK', sku: 'JAM', handle: 'bramble-jam', title: 'Bramble Jam' },
    { id: 'p3', workspace_id: 'ws-b', region: 'US', sku: 'TEA', handle: 'gazette-tea', title: 'Another brand tea' },
  );
  db.install();
}

async function caller(token) {
  const a = await core.requireUser(makeReq({ token }));
  expect(a.ok, 'the fake GoTrue verified the caller').toBe(true);
  return a;
}
async function read(token, query, ws) {
  const out = await server.handle('read', { auth: await caller(token), workspaceId: ws || 'ws-a', brand: BRAND, query: query || {} });
  expect(out.status).toBe(200);
  return out.body;
}

test.describe.configure({ mode: 'serial' });
test.beforeEach(() => {
  ENV.save();
  process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  wsScope.invalidate();
  world();
});
test.afterEach(() => { db.restore(); ENV.restore(); wsScope.invalidate(); });

test('each region is exact, in its own currency, paged past max_rows, from its own orders only', async () => {
  const r = await read('tok-owner', { regions: 'IN,US,UK', days: 30 });
  expect(r.selected).toEqual(['IN', 'US', 'UK']);
  const IN = r.results.IN;
  expect(IN.available).toBe(true);
  expect(IN.currency).toBe('INR');
  expect(IN.figures.orders.value, 'every IN order read, past the 1,000-row page').toBe(IN_COUNT);
  expect(IN.figures.revenue.value).toBe(IN_COUNT * 100);
  expect(IN.figures.customers.value).toBe(100);
  expect(IN.figures.new_customers.value).toBe(100);
  expect(IN.figures.returning_customers.value).toBe(0);
  expect(IN.figures.net.value, 'refunds stated on 5 of 1,203 orders: no net').toBeNull();
  expect(IN.figures.net.basis).toMatch(/not stated on every order/);
  expect(IN.figures.revenue.window).toEqual({ from: day(29), to: TODAY });
  expect(IN.source.kind).toBe('smart_orders');

  const US = r.results.US;
  expect(US.currency).toBe('USD');
  expect(US.figures.orders.value, 'the voided order is not a sale').toBe(4);
  expect(US.figures.revenue.value).toBe(135.5);
  expect(US.figures.refunds.value).toBe(10);
  expect(US.figures.net.value).toBe(125.5);
  expect(US.figures.units.value).toBe(7);
  expect(US.figures.aov.value).toBe(33.88);
  expect(US.figures.customers.value, 'the order naming no customer is not counted').toBe(3);
  expect(US.figures.customers.basis).toMatch(/1 order name no customer|1 order names? no customer/);
  expect(US.figures.returning_customers.value, 'u1 ordered in US before the window').toBe(1);
  expect(US.figures.new_customers.value).toBe(2);
  expect(US.previous.available).toBe(false);   // the orders read start 40 days back, after the previous period began (59 days back)
  const jam = US.top_products.rows.find((p) => p.sku === 'JAM');
  expect(jam.title, 'joined to the US catalogue row, never another brand\'s').toBe('Bramble Jam (US)');
  expect(jam.in_catalogue).toBe(true);
  const tea = US.top_products.rows.find((p) => p.sku === 'TEA');
  expect(tea.in_catalogue, 'another workspace\'s TEA row is not this brand\'s catalogue').toBe(false);

  const UK = r.results.UK;
  expect(UK.source.kind, 'store orders preferred for UK').toBe('shopify_orders');
  expect(UK.currency).toBe('GBP');
  expect(UK.figures.orders.value, 'the synced copy of a store order is not added').toBe(2);
  expect(UK.figures.revenue.value).toBe(75);
  expect(UK.figures.refunds.value).toBe(5);
  expect(UK.figures.net.value).toBe(70);
  expect(UK.figures.discounts.value).toBe(2);
  expect(UK.figures.units.value).toBe(3);

  const smart = r.sources.find((s) => s.kind === 'smart_orders');
  expect(smart.unattributed, 'the DE order is no market of this brand').toBe(1);
  expect(smart.unattributed_markets).toEqual(['DE']);
  // No figure anywhere carries the other workspace's 100,000 orders.
  expect(JSON.stringify(r)).not.toContain('10000000');
});

test('a market with no orders is the marker for that market, never zero and never another market\'s number', async () => {
  const r = await read('tok-owner', { regions: 'AU,US' });
  const AU = r.results.AU;
  expect(AU.available).toBe(false);
  expect(AU.marker).toBe('[DATA REQUIRED BEFORE LAUNCH: order history, Brambleweld Larder, AU]');
  expect(AU.figures).toBeUndefined();
  expect(r.totals.regions_without_data).toEqual(['AU']);
  expect(r.totals.by_currency.map((b) => b.currency)).toEqual(['USD']);
});

test('no single total across currencies without entered rates; the exact conversion with them', async () => {
  const r = await read('tok-owner', { regions: 'IN,US,UK' });
  expect(r.totals.combined).toBeNull();
  expect(r.totals.combined_reason).toMatch(/no rate has been entered for USD to INR, GBP to INR/);
  expect(r.totals.by_currency).toEqual([
    { currency: 'INR', revenue: IN_COUNT * 100, orders: IN_COUNT, regions: ['IN'] },
    { currency: 'USD', revenue: 135.5, orders: 4, regions: ['US'] },
    { currency: 'GBP', revenue: 75, orders: 2, regions: ['UK'] },
  ]);

  // An INVERSE rate (INR -> USD) does not convert USD to INR.
  const owner = await caller('tok-owner');
  let s = await server.handle('fx-save', { auth: owner, workspaceId: 'ws-a', body: { from: 'INR', to: 'USD', rate: 0.012, as_of: day(1) } });
  expect(s.status).toBe(200);
  expect((await read('tok-owner', { regions: 'IN,US' })).totals.combined).toBeNull();

  s = await server.handle('fx-save', { auth: owner, workspaceId: 'ws-a', body: { from: 'USD', to: 'INR', rate: 83.25, as_of: day(2) } });
  expect(s.status).toBe(200);
  s = await server.handle('fx-save', { auth: owner, workspaceId: 'ws-a', body: { from: 'GBP', to: 'INR', rate: 105, as_of: day(2) } });
  expect(s.status).toBe(200);
  expect(s.body.rate.entered_by).toBe('founder@brambleweld.example');
  // A newer rate for the same pair supersedes the older one.
  await server.handle('fx-save', { auth: owner, workspaceId: 'ws-a', body: { from: 'GBP', to: 'INR', rate: 110, as_of: day(1) } });

  const r2 = await read('tok-owner', { regions: 'IN,US,UK', base: 'INR' });
  const c = r2.totals.combined;
  expect(c.currency).toBe('INR');
  expect(c.converted).toBe(true);
  expect(c.revenue).toBe(Math.round((IN_COUNT * 100 + 135.5 * 83.25 + 75 * 110) * 100) / 100);
  expect(c.rates_used.map((u) => [u.from, u.to, u.rate, u.as_of, u.entered_by])).toEqual([
    ['USD', 'INR', 83.25, day(2), 'founder@brambleweld.example'],
    ['GBP', 'INR', 110, day(1), 'founder@brambleweld.example'],
  ]);
  const stored = db.table('brand_fx_rates');
  expect(stored.every((x) => x.workspace_id === 'ws-a' && x.entered_by === 'u-owner')).toBe(true);
});

test('a viewer cannot enter a rate, a bad rate is refused, and nothing is stored', async () => {
  const viewer = await caller('tok-viewer');
  const v = await server.handle('fx-save', { auth: viewer, workspaceId: 'ws-a', body: { from: 'USD', to: 'INR', rate: 80, as_of: day(1) } });
  expect(v.status).toBe(403);
  expect(v.body.message).toMatch(/viewer/);
  const owner = await caller('tok-owner');
  for (const bad of [{ from: 'USD', to: 'USD', rate: 1, as_of: day(1) }, { from: 'USD', to: 'INR', rate: -2, as_of: day(1) }, { from: 'USD', to: 'INR', rate: 80, as_of: '2999-01-01' }, { from: 'US', to: 'INR', rate: 80, as_of: day(1) }]) {
    const o = await server.handle('fx-save', { auth: owner, workspaceId: 'ws-a', body: bad });
    expect(o.status, JSON.stringify(bad)).toBe(400);
  }
  expect(db.table('brand_fx_rates')).toEqual([]);
  // The viewer still READS.
  const r = await read('tok-viewer', { regions: 'US' });
  expect(r.results.US.figures.orders.value).toBe(4);
});

test('a stranger naming the workspace reads nothing: every region is the marker', async () => {
  const r = await read('tok-stranger', { regions: 'IN,US' }, 'ws-a');
  expect(r.results.IN.available).toBe(false);
  expect(r.results.US.available).toBe(false);
  expect(r.results.IN.marker).toBe('[DATA REQUIRED BEFORE LAUNCH: order history, Brambleweld Larder, IN]');
  expect(r.totals.combined).toBeNull();
  // and the other brand's own workspace answers its own orders, never ws-a's
  const b = await read('tok-stranger', { regions: 'IN' }, 'ws-b');
  expect(b.results.IN.figures.orders.value).toBe(50);
});

test('a store that does not answer is said, never read as no orders', async () => {
  db.failures.smart_orders = 503;
  const r = await read('tok-owner', { regions: 'IN,UK' });
  expect(r.results.IN.available).toBe(false);
  expect(r.results.IN.reason).toMatch(/smart_orders could not be read/);
  expect(r.results.UK.available, 'the store orders still answered').toBe(true);
  expect(r.sources.find((s) => s.kind === 'smart_orders').error).toMatch(/could not be read/);
});

test('a selection is held to the brand\'s own markets; none asked is home', async () => {
  const r = await read('tok-owner', { regions: 'US,FR,India' });
  expect(r.selected).toEqual(['US', 'IN']);
  expect(r.refused).toEqual(['FR']);
  expect(r.refused_message).toMatch(/FR is not among Brambleweld Larder's markets/);
  expect((await read('tok-owner', {})).selected).toEqual(['IN']);
  expect((await read('tok-owner', { regions: 'all' })).selected).toEqual(['IN', 'US', 'UK', 'AU']);
});

test('another brand never gets tenant zero\'s bundled export', async () => {
  // US has no orders here, and the export compiled into the build has US.
  db.tables.smart_orders = db.table('smart_orders').filter((o) => o.market !== 'US' && o.market !== 'USA');
  const r = await read('tok-owner', { regions: 'US' });
  expect(r.bundled_export).toBe(false);
  expect(r.results.US.available).toBe(false);
  expect(r.results.US.marker).toBe('[DATA REQUIRED BEFORE LAUNCH: order history, Brambleweld Larder, US]');
});

/* ── the pure module ─────────────────────────────────────────────────────── */

test('the browser copy of region-revenue.js is byte-identical to the server\'s', () => {
  expect(fs.readFileSync(path.join(ROOT, 'region-revenue.js'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'api', '_shared', 'region-revenue.js'), 'utf8'));
});

test('a region with orders in two currencies shows each, never a sum', () => {
  const regions = [{ code: 'US', currency: 'USD', home: true }];
  const rows = [
    { id: '1', user_id: 'a', market: 'US', total: 10, created_at: at(1), metadata: { currency: 'USD' } },
    { id: '2', user_id: 'b', market: 'US', total: 20, created_at: at(1), metadata: { currency: 'CAD' } },
  ];
  const out = RR.aggregate(RR.fromSmartOrders(rows, regions).orders, { regions, selected: ['US'], days: 7, brand: 'X' });
  const US = out.regions.US;
  expect(US.currency).toBeNull();
  expect(US.figures.revenue.value).toBeNull();
  expect(US.by_currency).toEqual([{ currency: 'USD', revenue: 10, orders: 1 }, { currency: 'CAD', revenue: 20, orders: 1 }]);
  const t = RR.totals(out.regions, { base: 'USD', rates: [] }, 'X');
  expect(t.combined).toBeNull();
});

test('a CSV export is read per order, a window before the first order is unknown, not zero', () => {
  const regions = [{ code: 'IN', currency: 'INR', home: true }, { code: 'UK', currency: 'GBP' }];
  const csv = 'Name,Created at,Total,Currency,Shipping Country,Lineitem sku,Lineitem quantity,Lineitem price,Customer ID\n'
    + '#1,' + at(2) + ',500,INR,India,A,2,250,c1\n'
    + '#1,,,,,B,1,0,\n'
    + '#2,' + at(1) + ',40,GBP,GB,A,1,40,c2\n';
  const p = RR.fromCsv(csv, regions);
  expect(p.orders.map((o) => [o.id, o.region, o.gross, o.units])).toEqual([['#1', 'IN', 500, 3], ['#2', 'UK', 40, 1]]);
  const out = RR.aggregate(p.orders, { regions, selected: ['IN', 'UK'], days: 30, granularity: 'day', brand: 'X' });
  const pts = out.regions.IN.trend.points;
  expect(pts[0].revenue, 'a day before the first order read').toBeNull();
  expect(pts.find((q) => q.key === day(2)).revenue).toBe(500);
  expect(pts.find((q) => q.key === day(0)).revenue, 'a day after the first order with none is a measured zero').toBe(0);
  const old = RR.aggregate(p.orders, { regions, selected: ['IN'], from: '2020-01-01', to: '2020-01-31', brand: 'X' });
  expect(old.regions.IN.available).toBe(false);
  expect(old.regions.IN.marker).toMatch(/order history 2020-01-01 to 2020-01-31, X, IN/);
});
