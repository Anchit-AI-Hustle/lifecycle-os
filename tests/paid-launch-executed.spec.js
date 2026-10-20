// The paid launch pipeline, EXECUTED (2026-10-20).
//
// The operator: "pipeline must be built for direct platform updation with
// account sync and complete step by step asset updation like budget allotment
// everything". Driven through the SHIPPED code - api/brain.js?action=paid-launch
// is a thin mount of paid-launch-core.handle, called here with the request the
// router builds - over the in-memory Supabase (tests/lib/fake-supabase.js) and a
// stateful Meta ad account (tests/lib/fake-social-platforms.js opts.metaAccount)
// that answers only the documented Marketing API calls and enforces what the
// documentation states.
//
// What has to hold, each asserted on what was sent to Meta or stored:
//   - money: a stated budget becomes the account currency's smallest unit by
//     Meta's own offset table, and the split across ad sets adds up EXACTLY;
//   - sync: campaigns, ad sets, budgets and 7-day spend are read and kept; a
//     spend Meta did not return is null; LIVE_CONNECTORS off reads nothing;
//   - plan: a gap (no image, no landing page, EU without DSA fields, a
//     guaranteed outcome) blocks the build before any platform call;
//   - build: each switch off withholds the first step with its exact request and
//     sends nothing; with all three on, campaign -> ad sets (with budgets) ->
//     creatives -> ads, every one PAUSED, in that order; a re-run never creates
//     an object twice; a refused step stops the run and the next run resumes;
//     two runs at once build once;
//   - live: a viewer is refused; ads, then ad sets, then the campaign go
//     ACTIVE; the approver is the SESSION's user, never the body's;
//   - budget: a new total is re-split by the same shares and written per ad
//     set; a cut under Meta's floor is refused before the call.
//
// Run: npx playwright test tests/paid-launch-executed.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const { FakeSupabase, makeReq, makeRes, envScope, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');
const { installPlatforms } = require('./lib/fake-social-platforms.js');

const ROOT = path.resolve(__dirname, '..');
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const launch = require(path.join(ROOT, 'api', '_shared', 'paid-launch-core.js'));

const ENV = envScope(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY',
  'CONNECTION_SECRET_KEY', 'LIVE_CONNECTORS', 'META_ALLOW_WRITES', 'META_APP_ID', 'META_APP_SECRET']);
let REAL_FETCH;

function baseEnv() {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'e'.repeat(64);
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-app-secret';
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'LIVE_CONNECTORS', 'META_ALLOW_WRITES']) delete process.env[k];
}
test.beforeAll(() => { ENV.save(); REAL_FETCH = global.fetch; baseEnv(); });
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; });
test.afterEach(() => baseEnv());

const AUTH_A = { ok: true, token: 'tok-a', user_id: 'user-a', email: 'a@example.test' };
const AUTH_V = { ok: true, token: 'tok-v', user_id: 'user-v', email: 'v@example.test' };
const ACT = 'act_77';
const DAY = 86400000;

function world(opts) {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addUser('tok-v', 'user-v', 'v@example.test')
    .addWorkspace('ws-a', 'user-a').addMember('ws-a', 'user-v', 'viewer')
    .setActive('user-a', 'ws-a').setActive('user-v', 'ws-a').syncIdentityTables();
  const account = Object.assign({ id: ACT, currency: 'INR' }, (opts && opts.account) || {});
  const seen = installPlatforms(db, Object.assign({ metaAccount: account }, (opts && opts.platform) || {}));
  db.install();
  connections._resolvedCache.clear();
  const conn = db.insert('workspace_connections', {
    workspace_id: 'ws-a', provider: 'meta_ads', category: 'ads', auth_kind: 'oauth', label: 'meta',
    config: Object.assign({ ad_account_id: '77', page_id: 'page-1', publishing_enabled: true }, (opts && opts.config) || {}),
    secret_fields: ['access_token'], secret_hint: 'xxxx', status: 'active', connect_kind: 'oauth', oauth_scopes: ['ads_management', 'ads_read'],
    token_expires_at: new Date(Date.now() + 30 * DAY).toISOString(), refresh_failure_count: 0, revoked_at: null,
  });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: conn.id, workspace_id: 'ws-a' }, connections.encryptSecrets({ access_token: 'meta-tok' })));
  return { db, seen, account };
}

const live = () => { process.env.LIVE_CONNECTORS = 'on'; process.env.META_ALLOW_WRITES = '1'; };
const posts = (seen) => seen.meta.filter((c) => c.method === 'POST');

/** Drive the shipped handler the way brain.js mounts it. */
async function call(op, { auth = AUTH_A, body, query } = {}) {
  const res = makeRes();
  await launch.handle(makeReq({ token: auth.token, query: Object.assign({ action: 'paid-launch', op }, query || {}), body }), res, { auth, workspaceId: 'ws-a', body: body || {} });
  return { code: res.code, body: res.payload };
}

const IMG = 'https://cdn.brand.example/p/hero.jpg';
const LINK = 'https://brand.example/p/hero';
const BRIEFS = [
  { id: 'angle-1', angle_name: 'Fit worries', primary_text: 'Find the frame that fits your face in a minute.', headline: 'Frames that fit', image_url: IMG, link: LINK, share: 50 },
  { id: 'angle-2', angle_name: 'Price', primary_text: 'Two pairs for the price people expect for one.', headline: 'Two pairs, one price', image_url: IMG, link: LINK, share: 30 },
  { id: 'brief-control', basis: 'control', angle_name: 'Control', primary_text: 'Eyewear made for every day.', headline: 'Everyday eyewear', image_url: IMG, link: LINK, share: 20 },
];
const planBody = (extra) => Object.assign({ provider: 'meta', total_daily_budget: 1500, markets: ['IN'], objective: 'OUTCOME_TRAFFIC', source: { kind: 'briefs', briefs: BRIEFS } }, extra || {});

/* ── money ──────────────────────────────────────────────────────────────── */

test('money: Meta\'s currency offset, an exact split, and the test plan\'s rule', () => {
  expect(launch.toMinor(1500, 'INR')).toBe(150000);
  expect(launch.toMinor(5000, 'JPY')).toBe(5000);
  expect(launch.toMinor(12.5, 'USD')).toBe(1250);
  expect(launch.toMinor(100, 'XYZ')).toBe(null);
  for (const [total, shares] of [[150000, [50, 30, 20]], [1001, [33.3, 33.3, 33.4]], [7, [1, 1, 1]], [99999, [12.5, 37.5, 50]]]) {
    const out = launch.allocate(total, shares);
    expect(out.reduce((a, x) => a + x, 0)).toBe(total);
    expect(out.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
  }
  const rule = launch.sharesFor([{ control: true }, { weight: 90 }, { weight: 5 }, { weight: 5 }]);
  expect(Math.round(rule[0])).toBe(20);
  expect(rule.slice(1).every((s) => s >= 10 - 1e-9)).toBe(true);
  expect(Math.round(rule.reduce((a, x) => a + x, 0))).toBe(100);
  expect(launch.sharesFor([{}, {}, {}, {}]).map(Math.round)).toEqual([25, 25, 25, 25]);
  expect(launch.countryOf('UK')).toBe('GB');
  expect(launch.countryOf('GLOBAL')).toBe('');
});

/* ── sync ───────────────────────────────────────────────────────────────── */

test('sync: campaigns, ad sets, budgets and 7-day spend are read and kept; absent spend is null; off reads nothing', async () => {
  const { db, seen, account } = world();
  account.objects = {
    'cmp-9': { id: 'cmp-9', kind: 'campaign', fields: { name: 'Existing', objective: 'OUTCOME_TRAFFIC', status: 'ACTIVE', effective_status: 'ACTIVE' } },
    'as-9': { id: 'as-9', kind: 'adset', fields: { name: 'Existing set', campaign_id: 'cmp-9', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '50000' } },
    'as-10': { id: 'as-10', kind: 'adset', fields: { name: 'No spend yet', campaign_id: 'cmp-9', status: 'PAUSED', effective_status: 'PAUSED', daily_budget: '20000' } },
  };
  account.spend = { 'as-9': 312.4 };

  const off = await call('sync', { body: { provider: 'meta' } });
  expect(off.body.ok).toBe(false);
  expect(seen.meta.length).toBe(0);

  live();
  const r = await call('sync', { body: { provider: 'meta' } });
  expect(r.body.ok).toBe(true);
  expect(r.body.currency).toBe('INR');
  expect(r.body.campaigns.map((c) => c.id)).toEqual(['cmp-9']);
  const s9 = r.body.ad_sets.find((s) => s.id === 'as-9');
  expect(s9.daily_budget_minor).toBe(50000);
  expect(s9.last_7d.spend).toBe(312.4);
  expect(r.body.ad_sets.find((s) => s.id === 'as-10').last_7d).toBe(null);
  const kept = db.table('paid_account_syncs');
  expect(kept.length).toBe(1);
  expect(kept[0].workspace_id).toBe('ws-a');
  expect(kept[0].currency).toBe('INR');
  expect(posts(seen).length).toBe(0);
});

/* ── plan ───────────────────────────────────────────────────────────────── */

test('plan: the stated budget split exactly in the smallest unit, one ad set per brief, no platform call', async () => {
  const { seen } = world();
  live();
  await call('sync', { body: { provider: 'meta' } });
  const before = seen.meta.length;
  const r = await call('plan', { body: planBody() });
  expect(r.code).toBe(200);
  const L = r.body.launch;
  expect(L.status).toBe('planned');
  expect(L.plan.checks.blocking).toEqual([]);
  expect(L.plan.currency).toBe('INR');
  expect(L.plan.total_daily_budget_minor).toBe(150000);
  expect(L.plan.ad_sets.map((s) => s.daily_budget_minor)).toEqual([75000, 45000, 30000]);
  expect(L.plan.ad_sets.reduce((a, s) => a + s.daily_budget_minor, 0)).toBe(150000);
  expect(L.plan.ad_sets.every((s) => s.targeting.geo_locations.countries[0] === 'IN')).toBe(true);
  expect(L.steps.map((s) => s.kind)).toEqual(['campaign', 'adset', 'creative', 'ad', 'adset', 'creative', 'ad', 'adset', 'creative', 'ad']);
  expect(seen.meta.length).toBe(before);
});

test('plan: a gap blocks the build before any platform call (image, landing page, EU DSA fields, a guaranteed outcome)', async () => {
  const { seen } = world();
  live();
  await call('sync', { body: { provider: 'meta' } });
  const briefs = BRIEFS.map((b, i) => Object.assign({}, b, i === 0 ? { image_url: '' } : {}, i === 1 ? { primary_text: 'Guaranteed results in 7 days or your money back.' } : {}, i === 2 ? { link: 'http://brand.example' } : {}));
  const r = await call('plan', { body: planBody({ markets: ['IN', 'DE'], source: { kind: 'briefs', briefs } }) });
  const blocking = r.body.launch.plan.checks.blocking.join('\n');
  expect(r.body.launch.status).toBe('blocked');
  expect(blocking).toMatch(/DATA REQUIRED BEFORE LAUNCH: product image/);
  expect(blocking).toMatch(/DATA REQUIRED BEFORE LAUNCH: landing page URL/);
  expect(blocking).toMatch(/DSA payor and beneficiary/);
  expect(blocking).toMatch(/Compliance/);
  const before = seen.meta.length;
  const run = await call('run', { body: { launch_id: r.body.launch.id } });
  expect(run.code).toBe(409);
  expect(run.body.error).toBe('launch_blocked');
  expect(seen.meta.length).toBe(before);
});

test('plan: a Smart Brain campaign launches its own image ads, one ad set per market, equal split; its video is said, not sent', async () => {
  const { db } = world();
  live();
  await call('sync', { body: { provider: 'meta' } });
  db.insert('smart_generated_campaigns', { id: 'camp-1', workspace_id: 'ws-a', payload: {
    campaign_name: 'Autumn frames',
    landing_url: LINK,
    assets: { ads: [
      { platform: 'meta', creative_type: 'static', primary_text: 'Frames for autumn light.', headline: 'Autumn frames', creative: { image: IMG } },
      { platform: 'meta', creative_type: 'video', primary_text: 'Watch the frames.', headline: 'Autumn in motion' },
      { platform: 'google', creative_type: 'static', primary_text: 'not meta' },
    ] },
  } });
  const r = await call('plan', { body: planBody({ markets: ['IN', 'AE'], source: { kind: 'campaign', campaign_id: 'camp-1' } }) });
  const P = r.body.launch.plan;
  expect(P.checks.blocking).toEqual([]);
  expect(P.ad_sets.map((s) => s.countries)).toEqual([['IN'], ['AE']]);
  expect(P.ad_sets.map((s) => s.daily_budget_minor)).toEqual([75000, 75000]);
  expect(P.ad_sets.every((s) => s.ads.length === 1 && s.ads[0].link === LINK)).toBe(true);
  expect(P.checks.notes.join(' ')).toMatch(/video/i);
  // Another workspace's campaign is not this brand's.
  db.insert('smart_generated_campaigns', { id: 'camp-x', workspace_id: 'ws-other', payload: { assets: { ads: [] } } });
  const other = await call('plan', { body: planBody({ source: { kind: 'campaign', campaign_id: 'camp-x' } }) });
  expect(other.code).toBe(404);
});

/* ── build ──────────────────────────────────────────────────────────────── */

test('build: each switch off withholds the first step with its exact request and sends nothing', async () => {
  for (const off of ['LIVE_CONNECTORS', 'META_ALLOW_WRITES', 'publishing']) {
    const { seen, db } = world({ config: off === 'publishing' ? { publishing_enabled: false } : {} });
    db.insert('paid_account_syncs', { workspace_id: 'ws-a', provider: 'meta', ad_account_id: ACT, currency: 'INR', campaigns: [], ad_sets: [], synced_at: new Date().toISOString() });
    live();
    if (off !== 'publishing') delete process.env[off];
    const planned = await call('plan', { body: planBody() });
    const r = await call('run', { body: { launch_id: planned.body.launch.id } });
    expect(r.body.ok, off).toBe(false);
    const first = r.body.launch.steps[0];
    expect(first.status, off).toBe('withheld');
    expect(first.would_request.url, off).toContain(`/${ACT}/campaigns`);
    expect(first.would_request.body.status, off).toBe('PAUSED');
    expect(JSON.stringify(first.would_request), off).not.toContain('meta-tok');
    expect(r.body.launch.steps.slice(1).every((s) => s.status === 'pending'), off).toBe(true);
    expect(posts(seen).length, off).toBe(0);
    baseEnv();
  }
});

test('build: campaign -> ad sets with their budgets -> creatives -> ads, all PAUSED, in order; a re-run creates nothing twice', async () => {
  const { seen, account } = world();
  live();
  await call('sync', { body: { provider: 'meta' } });
  const planned = await call('plan', { body: planBody() });
  const id = planned.body.launch.id;
  const r = await call('run', { body: { launch_id: id } });
  expect(r.body.ok).toBe(true);
  expect(r.body.launch.status).toBe('built');
  expect(r.body.launch.steps.every((s) => s.status === 'done' && s.external_id)).toBe(true);
  const order = posts(seen).map((c) => c.path.split('/').pop());
  expect(order).toEqual(['campaigns', 'adsets', 'adcreatives', 'ads', 'adsets', 'adcreatives', 'ads', 'adsets', 'adcreatives', 'ads']);
  const sent = posts(seen);
  expect(sent[0].sent.special_ad_categories).toEqual([]);
  expect(sent[0].sent.is_adset_budget_sharing_enabled).toBe(false);
  expect(sent.filter((c) => c.path.endsWith('/adsets')).map((c) => c.sent.daily_budget)).toEqual([75000, 45000, 30000]);
  expect(sent.filter((c) => /\/(campaigns|adsets|ads)$/.test(c.path)).every((c) => c.sent.status === 'PAUSED')).toBe(true);
  const objs = Object.values(account.objects);
  expect(objs.filter((o) => o.kind === 'campaign').length).toBe(1);
  expect(objs.filter((o) => o.kind === 'ad').every((o) => o.fields.status === 'PAUSED')).toBe(true);

  const again = await call('run', { body: { launch_id: id } });
  expect(again.body.ok).toBe(true);
  expect(posts(seen).length).toBe(10);
});

test('build: a refused step stops the run; the next run resumes there and never re-creates the campaign', async () => {
  const { seen, account } = world({ platform: { metaFail: { path: 'adsets', times: 1, message: 'Invalid targeting' } } });
  live();
  await call('sync', { body: { provider: 'meta' } });
  const planned = await call('plan', { body: planBody() });
  const id = planned.body.launch.id;
  const first = await call('run', { body: { launch_id: id } });
  expect(first.body.launch.status).toBe('failed');
  expect(first.body.launch.steps[0].status).toBe('done');
  expect(first.body.launch.steps[1].status).toBe('failed');
  expect(first.body.launch.steps[1].error).toMatch(/Invalid targeting/);
  const second = await call('run', { body: { launch_id: id } });
  expect(second.body.launch.status).toBe('built');
  expect(Object.values(account.objects).filter((o) => o.kind === 'campaign').length).toBe(1);
  expect(posts(seen).filter((c) => c.path.endsWith('/campaigns')).length).toBe(1);
});

test('build: two runs at once build once', async () => {
  const { seen, account } = world();
  live();
  await call('sync', { body: { provider: 'meta' } });
  const planned = await call('plan', { body: planBody() });
  const id = planned.body.launch.id;
  const [a, b] = await Promise.all([call('run', { body: { launch_id: id } }), call('run', { body: { launch_id: id } })]);
  const errors = [a, b].map((x) => x.body.error).filter(Boolean);
  expect(errors).toEqual(['run_in_progress']);
  expect(Object.values(account.objects).filter((o) => o.kind === 'campaign').length).toBe(1);
  expect(posts(seen).length).toBe(10);
});

/* ── live and budget ────────────────────────────────────────────────────── */

test('live: a viewer is refused; ads, ad sets, then the campaign go ACTIVE; the approver is the session\'s user', async () => {
  const { seen, account } = world();
  live();
  await call('sync', { body: { provider: 'meta' } });
  const planned = await call('plan', { body: planBody() });
  const id = planned.body.launch.id;
  const viewerPlan = await call('plan', { auth: AUTH_V, body: planBody() });
  expect(viewerPlan.code).toBe(403);
  await call('run', { body: { launch_id: id } });
  const viewer = await call('go-live', { auth: AUTH_V, body: { launch_id: id } });
  expect(viewer.code).toBe(403);
  const n = posts(seen).length;
  const r = await call('go-live', { body: { launch_id: id, approved_by: 'someone-else' } });
  expect(r.body.ok).toBe(true);
  expect(r.body.launch.status).toBe('live');
  expect(r.body.launch.approved_by).toBe('user-a');
  const updates = posts(seen).slice(n).map((c) => account.objects[c.path.split('/').pop()].kind);
  expect(updates.slice(0, 3)).toEqual(['ad', 'ad', 'ad']);
  expect(updates.slice(3, 6)).toEqual(['adset', 'adset', 'adset']);
  expect(updates[6]).toBe('campaign');
  expect(Object.values(account.objects).filter((o) => o.kind !== 'creative').every((o) => o.fields.status === 'ACTIVE')).toBe(true);
  const paused = await call('pause', { body: { launch_id: id } });
  expect(paused.body.launch.status).toBe('paused');
  expect(Object.values(account.objects).find((o) => o.kind === 'campaign').fields.status).toBe('PAUSED');
});

test('budget: a new total is re-split by the same shares per ad set; a cut under Meta\'s floor is refused before the call', async () => {
  const { seen, account } = world();
  live();
  await call('sync', { body: { provider: 'meta' } });
  const planned = await call('plan', { body: planBody() });
  const id = planned.body.launch.id;
  const built = await call('run', { body: { launch_id: id } });
  const setIds = built.body.launch.steps.filter((s) => s.kind === 'adset').map((s) => s.external_id);

  const up = await call('budget', { body: { launch_id: id, total_daily_budget: 3000 } });
  expect(up.body.ok).toBe(true);
  expect(setIds.map((x) => Number(account.objects[x].fields.daily_budget))).toEqual([150000, 90000, 60000]);
  expect(up.body.launch.plan.total_daily_budget_minor).toBe(300000);

  // The first ad set has spent 1,200 this week; a cut to 150 (5% of 3,000... its
  // 50% share of 300) is under 10% above that, and is refused before any call.
  account.spend = { [setIds[0]]: 1200 };
  await call('sync', { body: { provider: 'meta' } });
  const n = posts(seen).length;
  const down = await call('budget', { body: { launch_id: id, total_daily_budget: 300 } });
  expect(down.code).toBe(409);
  expect(down.body.error).toBe('below_meta_floor');
  expect(posts(seen).length).toBe(n);
  expect(Number(account.objects[setIds[0]].fields.daily_budget)).toBe(150000);
});

test('status: what is built, what is not and why, and which switch is off', async () => {
  world();
  const r = await call('status');
  const meta = r.body.platforms.find((p) => p.id === 'meta');
  expect(meta.built).toBe(true);
  expect(meta.connected).toBe(true);
  expect(meta.switches.all_on).toBe(false);
  expect(meta.switches.off.join(' ')).toMatch(/LIVE_CONNECTORS/);
  for (const p of r.body.platforms.filter((x) => x.id !== 'meta')) expect(p.reason, p.id).toMatch(/not confirmed|unverified|could not be confirmed/);
});
