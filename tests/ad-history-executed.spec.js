// The brand's OWN paid-ad history, EXECUTED (2026-11-01).
//
// Creative evidence briefed the writer with the brand's own EMAIL campaigns and
// with competitor ads; the brand's own past ADS were never read. ad-history.js
// reads them from the connected ad accounts and hands them to the brief.
// Driven through the SHIPPED code - api/brain.js?action=ad-history is a thin
// mount of ad-history.handle, called here with the request the router builds -
// over the in-memory Supabase (tests/lib/fake-supabase.js) and the fake
// platforms (tests/lib/fake-social-platforms.js), which answer only documented
// endpoints and throw on anything else.
//
// What has to hold, each asserted on what was sent or stored:
//   - import pages both Meta edges by Meta's own cursor; the creative copy is
//     kept as returned; a metric Meta did not return is null, never 0; ctr is a
//     ratio; conversions only when Meta returned exactly one;
//   - LIVE_CONNECTORS off reads nothing and stores nothing;
//   - a re-import upserts (one row per ad), keeps first_seen, moves the metrics;
//   - a viewer cannot import (nothing sent) but can list;
//   - another workspace is never read, and every store query names the workspace;
//   - Google Ads is read for the last 30 days through its verified reader and
//     says so; TikTok and Pinterest are said, not called;
//   - evidence: the brief states the metric and the median rule, a winner prints
//     its numbers, under three rated ads there is no median and no winner;
//   - Smart Brain's build carries the ads to the brief; Winning angles' control
//     cites the brand's own ad above its median, with its figures.
//
// Run: npx playwright test tests/ad-history-executed.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const { FakeSupabase, makeReq, makeRes, envScope, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');
const { installPlatforms } = require('./lib/fake-social-platforms.js');

const ROOT = path.resolve(__dirname, '..');
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const history = require(path.join(ROOT, 'api', '_shared', 'ad-history.js'));
const evidence = require(path.join(ROOT, 'api', '_shared', 'creative-evidence.js'));
const angleLab = require(path.join(ROOT, 'api', '_shared', 'ad-angle-lab.js'));

const ENV = envScope(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY',
  'CONNECTION_SECRET_KEY', 'LIVE_CONNECTORS', 'META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN']);
let REAL_FETCH;
function baseEnv() {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'e'.repeat(64);
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-app-secret';
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'LIVE_CONNECTORS']) delete process.env[k];
  history.resetCache();
}
test.beforeAll(() => { ENV.save(); REAL_FETCH = global.fetch; baseEnv(); });
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; });
test.afterEach(() => baseEnv());

const AUTH_A = { ok: true, token: 'tok-a', user_id: 'user-a', email: 'a@example.test' };
const AUTH_V = { ok: true, token: 'tok-v', user_id: 'user-v', email: 'v@example.test' };
const DAY = 86400000;

const ADS = [
  { id: 'ad-1', name: 'Fit in a minute', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: new Date(Date.now() - 20 * DAY).toISOString(),
    creative: { id: 'cr-1', body: 'Find the frame that fits your face in a minute.', title: 'Frames that fit', image_url: 'https://cdn.brand.example/a1.jpg', object_url: 'https://brand.example/p/1', call_to_action_type: 'SHOP_NOW' } },
  { id: 'ad-2', name: 'Two pairs', effective_status: 'PAUSED', created_time: new Date(Date.now() - 40 * DAY).toISOString(),
    creative: { id: 'cr-2', object_story_spec: { link_data: { message: 'Two pairs for the price of one.', name: 'Two pairs, one price', description: 'Every frame', link: 'https://brand.example/p/2', picture: 'https://cdn.brand.example/a2.jpg' } } } },
  { id: 'ad-3', name: 'Everyday', effective_status: 'ACTIVE', created_time: new Date(Date.now() - 60 * DAY).toISOString(), creative: { id: 'cr-3', body: 'Eyewear made for every day.', title: 'Everyday eyewear' } },
  { id: 'ad-4', name: 'Old video', effective_status: 'ACTIVE', created_time: new Date(Date.now() - 90 * DAY).toISOString(), creative: { id: 'cr-4', video_id: 'v-44', body: 'Watch it fit.' } },
  // Created long before the window and not measured in it: not part of this import.
  { id: 'ad-old', name: 'Archived', effective_status: 'ARCHIVED', created_time: new Date(Date.now() - 400 * DAY).toISOString(), creative: { id: 'cr-9', body: 'Old line.' } },
];
const INSIGHTS = [
  { ad_id: 'ad-1', ad_name: 'Fit in a minute', spend: '120.50', impressions: '10000', clicks: '300', ctr: '3.0', conversions: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '12' }], cost_per_conversion: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '10.04' }], purchase_roas: [{ action_type: 'omni_purchase', value: '2.4' }] },
  { ad_id: 'ad-2', ad_name: 'Two pairs', spend: '80.00', impressions: '9000', clicks: '90', ctr: '1.0', conversions: [{ action_type: 'a', value: '3' }, { action_type: 'b', value: '3' }] },
  { ad_id: 'ad-3', ad_name: 'Everyday', spend: '50.00', impressions: '8000', clicks: '160', ctr: '2.0' },
  // Meta returned no clicks and no ctr for this one: unknown, not zero.
  { ad_id: 'ad-4', ad_name: 'Old video', spend: '10.00', impressions: '500' },
];

function connectMeta(db, ws, config) {
  const conn = db.insert('workspace_connections', {
    workspace_id: ws, provider: 'meta_ads', category: 'ads', auth_kind: 'oauth', label: 'meta', config: Object.assign({ ad_account_id: '77' }, config || {}),
    secret_fields: ['access_token'], secret_hint: 'xxxx', status: 'active', connect_kind: 'oauth', oauth_scopes: ['ads_read'],
    token_expires_at: new Date(Date.now() + 30 * DAY).toISOString(), refresh_failure_count: 0, revoked_at: null,
  });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: conn.id, workspace_id: ws }, connections.encryptSecrets({ access_token: `meta-tok-${ws}` })));
}

function world(opts) {
  const o = opts || {};
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addUser('tok-v', 'user-v', 'v@example.test')
    .addWorkspace('ws-a', 'user-a').addWorkspace('ws-b', 'user-b').addMember('ws-a', 'user-v', 'viewer')
    .setActive('user-a', 'ws-a').setActive('user-v', 'ws-a').syncIdentityTables();
  const H = Object.assign({ account: 'act_77', currency: 'INR', pageSize: 2, ads: ADS.map((x) => JSON.parse(JSON.stringify(x))), insights: INSIGHTS.map((x) => JSON.parse(JSON.stringify(x))) }, o.history || {});
  const seen = installPlatforms(db, { metaAdHistory: H });
  db.install();
  connections._resolvedCache.clear();
  connectMeta(db, 'ws-a');
  return { db, seen, H };
}

async function call(op, { auth = AUTH_A, body, query, ws = 'ws-a', method } = {}) {
  const res = makeRes();
  await history.handle(makeReq({ token: auth.token, query: Object.assign({ action: 'ad-history', op }, query || {}), body, method }), res, { auth, workspaceId: ws, body: body || {} });
  return { code: res.code, body: res.payload };
}
const rows = (db) => db.table('brand_ad_history');

test('import: both Meta edges paged by Meta\'s own cursor; copy as returned; absent metrics null, never 0; ctr a ratio; one conversion value or none', async () => {
  const { db, seen, H } = world();
  process.env.LIVE_CONNECTORS = 'on';
  const r = await call('import', { body: { days: 180 } });
  expect(r.code, JSON.stringify(r.body)).toBe(200);
  const meta = r.body.platforms.find((p) => p.provider === 'meta');
  expect(meta.ok).toBe(true);
  expect(meta.ads).toBe(4);            // ad-old ran before the window and was not measured in it
  expect(meta.with_metrics).toBe(4);
  expect(meta.complete).toBe(true);

  const adsCalls = seen.meta.filter((c) => c.path.endsWith('/act_77/ads'));
  expect(adsCalls.map((c) => c.query.after || '')).toEqual(['', '2', '4']);   // 5 ads, 2 a page
  const insCalls = seen.meta.filter((c) => c.path.endsWith('/act_77/insights'));
  expect(insCalls.map((c) => c.query.after || '')).toEqual(['', '2']);
  expect(insCalls.every((c) => c.query.level === 'ad')).toBe(true);
  const tr = H.time_ranges[0];
  expect((Date.parse(tr.until) - Date.parse(tr.since)) / DAY).toBe(179);
  for (const c of seen.meta) expect(c.query.access_token).toBe('meta-tok-ws-a');

  const by = Object.fromEntries(rows(db).map((x) => [x.ad_id, x]));
  expect(Object.keys(by).sort()).toEqual(['ad-1', 'ad-2', 'ad-3', 'ad-4']);
  expect(by['ad-1']).toMatchObject({ workspace_id: 'ws-a', provider: 'meta', account_id: 'act_77', currency: 'INR', primary_text: 'Find the frame that fits your face in a minute.', headline: 'Frames that fit', image_url: 'https://cdn.brand.example/a1.jpg', landing_url: 'https://brand.example/p/1', cta: 'SHOP_NOW', status: 'ACTIVE' });
  expect(by['ad-1'].metrics).toEqual({ spend: 120.5, impressions: 10000, clicks: 300, ctr: 0.03, conversions: 12, cost_per_result: 10.04, roas: 2.4 });
  // From object_story_spec.link_data when the creative has no body/title of its own.
  expect(by['ad-2']).toMatchObject({ primary_text: 'Two pairs for the price of one.', headline: 'Two pairs, one price', description: 'Every frame', landing_url: 'https://brand.example/p/2', image_url: 'https://cdn.brand.example/a2.jpg' });
  // Two conversion action types: not added together, so not known.
  expect(by['ad-2'].metrics.conversions).toBe(null);
  expect(by['ad-2'].metrics.roas).toBe(null);
  // Meta returned no clicks or ctr: null, never 0.
  expect(by['ad-4'].metrics.clicks).toBe(null);
  expect(by['ad-4'].metrics.ctr).toBe(null);
  expect(by['ad-4'].metrics.spend).toBe(10);
  expect(by['ad-4'].video_id).toBe('v-44');
  expect(by['ad-4'].video_url).toBe(null);
  expect(Object.values(by).every((x) => x.first_seen && x.last_seen)).toBe(true);

  const run = db.table('brand_ad_history_runs').find((x) => x.provider === 'meta');
  expect(run).toMatchObject({ workspace_id: 'ws-a', ok: true, ads: 4, with_metrics: 4, ran_by: 'user-a', source: 'manual' });
  // Not built platforms are said, and nothing was sent to them.
  expect(r.body.platforms.find((p) => p.provider === 'tiktok_ads')).toMatchObject({ ok: false, built: false });
  expect(r.body.platforms.find((p) => p.provider === 'pinterest')).toMatchObject({ ok: false, built: false });
  expect(seen.tiktok_ads).toHaveLength(0);
  expect(seen.pinterest).toHaveLength(0);
  // Google is not connected on this brand: said, not read.
  expect(r.body.platforms.find((p) => p.provider === 'google_ads')).toMatchObject({ ok: false, connected: false });
});

test('LIVE_CONNECTORS off: nothing is read from the platform and nothing is stored', async () => {
  const { db, seen } = world();
  const r = await call('import', { body: {} });
  expect(r.code).toBe(200);
  const meta = r.body.platforms.find((p) => p.provider === 'meta');
  expect(meta).toMatchObject({ ok: false, live: false });
  expect(meta.note).toMatch(/LIVE_CONNECTORS/);
  expect(seen.meta).toHaveLength(0);
  expect(rows(db)).toHaveLength(0);
});

test('re-import upserts: one row per ad, first_seen kept, metrics and last_seen move', async () => {
  const { db, H } = world();
  process.env.LIVE_CONNECTORS = 'on';
  await call('import', { body: {} });
  const first = Object.fromEntries(rows(db).map((x) => [x.ad_id, { first: x.first_seen, last: x.last_seen }]));
  H.insights[0].clicks = '450';
  H.insights[0].ctr = '4.5';
  await new Promise((r) => setTimeout(r, 15));
  const again = await call('import', { body: {} });
  expect(again.body.platforms.find((p) => p.provider === 'meta')).toMatchObject({ inserted: 0, updated: 4 });
  expect(rows(db)).toHaveLength(4);
  const ad1 = rows(db).find((x) => x.ad_id === 'ad-1');
  expect(ad1.metrics.clicks).toBe(450);
  expect(ad1.metrics.ctr).toBeCloseTo(0.045, 10);
  expect(ad1.first_seen).toBe(first['ad-1'].first);
  expect(Date.parse(ad1.last_seen)).toBeGreaterThan(Date.parse(first['ad-1'].last));
  expect(db.table('brand_ad_history_runs')).toHaveLength(2);
});

test('a viewer cannot import (nothing is sent) and can list; a GET import is refused', async () => {
  const { db, seen } = world();
  process.env.LIVE_CONNECTORS = 'on';
  const v = await call('import', { auth: AUTH_V, body: {} });
  expect(v.code).toBe(403);
  expect(v.body.message).toMatch(/viewer/);
  expect(seen.meta).toHaveLength(0);
  const g = await call('import', { method: 'GET' });
  expect(g.code).toBe(405);
  await call('import', { body: {} });
  const list = await call('list', { auth: AUTH_V });
  expect(list.code).toBe(200);
  expect(list.body.ads.map((x) => x.ad_id).sort()).toEqual(['ad-1', 'ad-2', 'ad-3', 'ad-4']);
  expect(rows(db).length).toBe(4);
});

test('another workspace is never read: its rows stay out, a non-member is refused, every store query names the workspace', async () => {
  const { db } = world();
  process.env.LIVE_CONNECTORS = 'on';
  db.insert('brand_ad_history', { workspace_id: 'ws-b', provider: 'meta', account_id: 'act_99', ad_id: 'b-1', name: 'Another brand\'s ad', metrics: { ctr: 0.5 } });
  db.insert('brand_ad_history_runs', { workspace_id: 'ws-b', provider: 'meta', ok: true, ads: 1, ran_at: new Date().toISOString() });
  await call('import', { body: {} });
  const list = await call('list');
  expect(list.body.ads.some((x) => x.workspace_id !== 'ws-a')).toBe(false);
  const st = await call('status');
  expect(st.body.platforms.find((p) => p.provider === 'meta').ads).toBe(4);
  const nope = await call('list', { ws: 'ws-b' });
  expect(nope.code).toBe(404);
  const ev = await history.evidenceAds('ws-a');
  expect(ev.ads.some((x) => x.ad_id === 'b-1')).toBe(false);
  const storeCalls = db.calls.filter((c) => /\/rest\/v1\/brand_ad_history/.test(c.url));
  expect(storeCalls.length).toBeGreaterThan(0);
  for (const c of storeCalls) {
    const named = /workspace_id=eq\.ws-a/.test(c.url) || (c.method === 'POST' && JSON.stringify(c.body || '').includes('"workspace_id":"ws-a"'));
    expect(named, `${c.method} ${c.url}`).toBe(true);
  }
});

test('Google Ads: read for the last 30 days through its verified reader, said so; an absent cost stays null', async () => {
  const { db, seen } = world();
  process.env.LIVE_CONNECTORS = 'on';
  const row = db.insert('workspace_connections', {
    workspace_id: 'ws-a', provider: 'google_ads', category: 'ads', auth_kind: 'oauth', label: 'google_ads', config: { customer_id: '111-222-3333' },
    secret_fields: ['access_token', 'refresh_token', 'developer_token'], secret_hint: 'xxxx', status: 'active', connect_kind: 'oauth', oauth_scopes: ['https://www.googleapis.com/auth/adwords'],
    token_expires_at: new Date(Date.now() + 30 * DAY).toISOString(), refresh_failure_count: 0, revoked_at: null,
  });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: row.id, workspace_id: 'ws-a' }, connections.encryptSecrets({ access_token: 'ya29.gads-1', refresh_token: '1//gads', developer_token: 'dev-tok-1' })));
  connections._resolvedCache.clear();
  const r = await call('import', { body: {} });
  const g = r.body.platforms.find((p) => p.provider === 'google_ads');
  expect(g, JSON.stringify(r.body)).toMatchObject({ ok: true, ads: 2 });
  expect(g.note).toMatch(/last 30 days/);
  expect(g.window.days).toBe(30);
  expect(seen.google_ads[0].sent.query).toMatch(/DURING LAST_30_DAYS/);
  const g902 = rows(db).find((x) => x.provider === 'google_ads' && x.ad_id === '902');
  expect(g902.metrics.spend).toBe(null);
  expect(g902.metrics.impressions).toBe(2000);
  expect(g902.primary_text).toBe(null);
});

const asAds = (list) => ({ imported: true, ads: list.map((x, i) => Object.assign({ provider: 'meta', ad_id: `a${i}`, name: `Ad ${i}`, currency: 'INR' }, x)) });

test('evidence: the metric and the per-platform median are stated; a winner carries its figures; under three rated ads no winner is named', async () => {
  // Rates 0.04, 0.03, 0.02, 0.01 -> median 0.025.
  const pack = evidence.evidenceFor({ __ownAds: asAds([
    { metrics: { ctr: 0.04, impressions: 5000, clicks: 200, spend: 90 }, headline: 'Frames that fit', primary_text: 'Find the frame that fits your face.' },
    { metrics: { ctr: 0.03, impressions: 4000, clicks: 120 } },
    { metrics: { ctr: 0.02, impressions: 3000, clicks: 60 } },
    { metrics: { ctr: 0.01, impressions: 2000, clicks: 20 }, headline: 'Tired line' },
    { metrics: { ctr: null, impressions: 100, clicks: null } },
  ]) });
  const pl = pack.ads.platforms[0];
  expect(pl.median).toBeCloseTo(0.025, 10);
  expect(pl.rated).toBe(4);
  expect(pl.worked.map((w) => w.name)).toEqual(['Ad 0', 'Ad 1']);
  expect(pl.tiring.map((w) => w.name)).toEqual(['Ad 3', 'Ad 2']);
  const brief = evidence.evidenceBrief(pack);
  expect(brief).toContain('click-through rate (clicks / impressions, as the platform reported it)');
  expect(brief).toContain('median 2.50% across 4 ads');
  expect(brief).toMatch(/WORKED - "Ad 0": 4\.00% click-through, 5,000 impressions, 200 clicks, 90\.00 INR spent\. Copy: headline "Frames that fit"/);
  expect(brief).toMatch(/TIRING - "Ad 3": 1\.00% click-through/);
  expect(brief).not.toMatch(/ROAS|return on ad spend/);       // nothing returned, nothing printed

  const thin = evidence.evidenceBrief(evidence.evidenceFor({ __ownAds: asAds([{ metrics: { ctr: 0.05 } }, { metrics: { ctr: 0.01 } }]) }));
  expect(thin).toContain('too few for a median');
  expect(thin).not.toContain('WORKED -');

  const none = evidence.evidenceBrief(evidence.evidenceFor({ __ownAds: { imported: true, ads: [] } }));
  expect(none).toContain('no ad ran in the import window');
  // Never imported: the brief says nothing about ads.
  expect(evidence.briefFor({})).not.toContain('OWN ADS');
});

test('Smart Brain carries the imported ads into the build; Winning angles\' control cites the brand\'s own ad above its median', async () => {
  const { db } = world();
  process.env.LIVE_CONNECTORS = 'on';
  await call('import', { body: {} });
  history.resetCache();
  const ev = await history.evidenceAds('ws-a');
  expect(ev.imported).toBe(true);
  expect(evidence.briefFor({ __ownAds: ev })).toMatch(/WORKED - "Fit in a minute": 3\.00% click-through, 10,000 impressions, 300 clicks, 120\.50 INR spent, 12 conversions, 10\.04 INR per result, 2\.40x return on ad spend/);

  const sb = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
  const entry = { id: 'slot-1', date: '2026-11-03', market: 'IN', workspace_id: 'ws-a', channels: ['email'],
    brand: { name: 'Frameworks', website: 'https://brand.example', regions: [{ code: 'IN', home: true }] },
    cohort: { name: 'Champions' }, objective: 'premium bundle expansion', heroProduct: { title: 'Round frame' } };
  try { await sb.buildCampaign(entry, { workspace_id: 'ws-a' }, { noLLM: true, withCreatives: false }); } catch (_) { /* the build itself is not under test */ }
  expect(entry.__ownAds && entry.__ownAds.ads.map((x) => x.ad_id).sort()).toEqual(['ad-1', 'ad-2', 'ad-3', 'ad-4']);
  expect(Object.keys(entry)).not.toContain('__ownAds');

  const out = await angleLab.run({ brand: { name: 'Frameworks', tagline: 'Eyewear made for every day', claims: ['Frames that fit every face'] }, market: 'IN', competitors: [], deps: { ownAds: ev, ciAds: null, fetchMetaAds: async () => ({ ok: true, ads: [] }), callLLM: async () => { throw new Error('every provider is down'); } } });
  expect(out.ok).toBe(true);
  const control = out.briefs.find((b) => b.basis === 'control');
  expect(control.own_ad_evidence).toMatchObject({ platform: 'Meta', ad: 'Fit in a minute' });
  expect(control.own_ad_evidence.figures).toContain('3.00% click-through');
  expect(control.evidence).toContain('ran above your own median click-through rate');
  expect(rows(db).length).toBe(4);
});

test('a brand kept on this device: status is one sentence, import is refused, nothing is read', async () => {
  const { seen } = world();
  process.env.LIVE_CONNECTORS = 'on';
  const st = await call('status', { ws: null });
  expect(st.code).toBe(200);
  expect(st.body.storage).toBe('device');
  expect(st.body.message).toMatch(/kept on this device/);
  const im = await call('import', { ws: null, body: {} });
  expect(im.code).toBe(409);
  expect(seen.meta).toHaveLength(0);
});
