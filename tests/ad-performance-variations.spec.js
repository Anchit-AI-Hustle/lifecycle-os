// Ads ranked by cost per result, winning ads spawn variations, ad history read
// during setup (2026-11-02, three gaps against usefastlane.ai). EXECUTED.
//
// Everything runs through the SHIPPED code: ad-history.handle (what
// api/brain.js?action=ad-history mounts) over the in-memory Supabase
// (tests/lib/fake-supabase.js) and the fake Meta and Google Ads APIs
// (tests/lib/fake-social-platforms.js, which throw on any undocumented call);
// the model is a script installed where llm.js is resolved; the pages are the
// shipped brand-connections.html and onboarding.html in Chromium.
//
// What has to hold, each asserted on what was computed, sent or shown:
//   - cost per result is the platform's own figure (Meta's cost_per_conversion)
//     or spend / results as returned (Google: cost_micros over
//     metrics.conversions), never computed from a missing figure (null + why),
//     never pooled across platforms or currencies, a median and a winner only
//     from 3 or more ads that carry it;
//   - the OWN ADS brief ranks by cost per result where it can and says so,
//     else by click-through rate and says why; Winning angles' control cites it;
//   - variations: only of a winner; the hook pattern, the format and the
//     platform's own limits held in code (a draft that breaks one is dropped,
//     never cut), copy-grounded, each with variation_of; owner/editor only;
//     no model = the brand's own lines, labelled;
//   - the /connections card ranks, offers "Make variations" on winners only,
//     and hands the variations to Paid launch, at 1280 and 390;
//   - the setup run reads a connected account's past ads and says what it
//     found, per platform with the brand's own median.
//
// Run: npx playwright test tests/ad-performance-variations.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { FakeSupabase, makeReq, makeRes, envScope, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');
const { installPlatforms } = require('./lib/fake-social-platforms.js');

const ROOT = path.resolve(__dirname, '..');
const req = (rel) => require(path.join(ROOT, rel));
const connections = req('api/_shared/workspace-connections-core.js');
const history = req('api/_shared/ad-history.js');
const perf = req('api/_shared/ad-performance.js');
const evidence = req('api/_shared/creative-evidence.js');
const angleLab = req('api/_shared/ad-angle-lab.js');
const LLM_PATH = path.join(ROOT, 'api', '_shared', 'llm.js');

const ENV = envScope(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY',
  'CONNECTION_SECRET_KEY', 'LIVE_CONNECTORS', 'META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'BRAND_RENDER']);
let REAL_FETCH;
const DAY = 86400000;
function baseEnv() {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'e'.repeat(64);
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-app-secret';
  process.env.LIVE_CONNECTORS = 'on';
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) delete process.env[k];
  history.resetCache();
}
test.beforeAll(() => { ENV.save(); REAL_FETCH = global.fetch; baseEnv(); });
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; uninstallLlm(); });
test.afterEach(() => { global.fetch = REAL_FETCH; uninstallLlm(); baseEnv(); });

/* ── the model, scripted where llm.js is resolved ─────────────────────────── */
let LLM = null;
function installLlm(answer) {
  LLM = { calls: [] };
  const fn = async (opts) => { LLM.calls.push(opts); if (typeof answer === 'function') return answer(opts); if (answer instanceof Error) throw answer; return { text: JSON.stringify(answer), provider: 'script', model: 'script' }; };
  require.cache[LLM_PATH] = { id: LLM_PATH, filename: LLM_PATH, loaded: true, exports: fn };
}
function uninstallLlm() { delete require.cache[LLM_PATH]; }

/* ── the brand and its accounts ──────────────────────────────────────────── */
const AUTH_A = { ok: true, token: 'tok-a', user_id: 'user-a', email: 'a@example.test' };
const AUTH_V = { ok: true, token: 'tok-v', user_id: 'user-v', email: 'v@example.test' };
const BRAND = { name: 'Frameworks', tagline: 'Eyewear made for every day', claims: ['Frames that fit every face', 'Free eye test in store', 'Lenses cut in 48 hours'] };
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const one = (v) => [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: String(v) }];
const META_ADS = [
  { id: 'ad-1', name: 'Slip', effective_status: 'ACTIVE', created_time: ago(10), creative: { body: 'Tired of frames that slip? Frames that fit every face.', title: 'Frames that fit', image_url: 'https://cdn.brand.example/1.jpg' } },
  { id: 'ad-2', name: 'Two pairs', effective_status: 'ACTIVE', created_time: ago(20), creative: { body: 'Two pairs for the price of one.', image_url: 'https://cdn.brand.example/2.jpg' } },
  { id: 'ad-3', name: 'Everyday', effective_status: 'ACTIVE', created_time: ago(30), creative: { body: 'Eyewear made for every day.', image_url: 'https://cdn.brand.example/3.jpg' } },
  { id: 'ad-4', name: 'Nothing sold', effective_status: 'PAUSED', created_time: ago(40), creative: { body: 'Lenses cut in 48 hours.', image_url: 'https://cdn.brand.example/4.jpg' } },
  { id: 'ad-5', name: 'Spend only', effective_status: 'PAUSED', created_time: ago(50), creative: { body: 'Free eye test in store.', video_id: 'v-5' } },
];
const META_INSIGHTS = [
  // Meta's own cost per result (exactly one action value): reported.
  { ad_id: 'ad-1', spend: '100', impressions: '10000', clicks: '200', ctr: '2.0', conversions: one(25), cost_per_conversion: one('4.00') },
  // No cost_per_conversion, but spend and one conversion value: worked out as spend / results.
  { ad_id: 'ad-2', spend: '90', impressions: '9000', clicks: '450', ctr: '5.0', conversions: one(9) },
  { ad_id: 'ad-3', spend: '60', impressions: '8000', clicks: '80', ctr: '1.0', conversions: one(3) },
  // Spent, and Meta reported 0 results: no cost per result (not "infinity"), counted apart.
  { ad_id: 'ad-4', spend: '50', impressions: '4000', clicks: '40', ctr: '1.0', conversions: one(0) },
  // Spend only: results not returned, so no cost per result, and never 0.
  { ad_id: 'ad-5', spend: '30', impressions: '3000', clicks: '30', ctr: '1.0' },
];

function connectMeta(db, ws) {
  const conn = db.insert('workspace_connections', {
    workspace_id: ws, provider: 'meta_ads', category: 'ads', auth_kind: 'oauth', label: 'meta', config: { ad_account_id: '77' },
    secret_fields: ['access_token'], secret_hint: 'xxxx', status: 'active', connect_kind: 'oauth', oauth_scopes: ['ads_read'],
    token_expires_at: new Date(Date.now() + 30 * DAY).toISOString(), refresh_failure_count: 0, revoked_at: null,
  });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: conn.id, workspace_id: ws }, connections.encryptSecrets({ access_token: `meta-tok-${ws}` })));
}
function connectGoogle(db, ws) {
  const row = db.insert('workspace_connections', {
    workspace_id: ws, provider: 'google_ads', category: 'ads', auth_kind: 'oauth', label: 'google_ads', config: { customer_id: '111-222-3333' },
    secret_fields: ['access_token', 'refresh_token', 'developer_token'], secret_hint: 'xxxx', status: 'active', connect_kind: 'oauth', oauth_scopes: ['https://www.googleapis.com/auth/adwords'],
    token_expires_at: new Date(Date.now() + 30 * DAY).toISOString(), refresh_failure_count: 0, revoked_at: null,
  });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: row.id, workspace_id: ws }, connections.encryptSecrets({ access_token: 'ya29.gads-1', refresh_token: '1//gads', developer_token: 'dev-tok-1' })));
}

function world(o) {
  const opts = o || {};
  const db = opts.db || new FakeSupabase();
  if (!opts.db) {
    db.addUser('tok-a', 'user-a', 'a@example.test').addUser('tok-v', 'user-v', 'v@example.test')
      .addWorkspace('ws-a', 'user-a').addMember('ws-a', 'user-v', 'viewer').setActive('user-a', 'ws-a').setActive('user-v', 'ws-a').syncIdentityTables();
  }
  const seen = installPlatforms(db, {
    metaAdHistory: { account: 'act_77', currency: 'INR', pageSize: 3, ads: JSON.parse(JSON.stringify(opts.ads || META_ADS)), insights: JSON.parse(JSON.stringify(opts.insights || META_INSIGHTS)) },
    googleAdRows: opts.googleAdRows,
  });
  db.install();
  connections._resolvedCache.clear();
  connectMeta(db, opts.ws || 'ws-a');
  if (opts.google) connectGoogle(db, opts.ws || 'ws-a');
  return { db, seen };
}

async function call(op, { auth = AUTH_A, body, query, ws = 'ws-a', method, brand = BRAND } = {}) {
  const res = makeRes();
  await history.handle(makeReq({ token: auth.token, query: Object.assign({ action: 'ad-history', op }, query || {}), body, method }), res, { auth, workspaceId: ws, body: body || {}, brand });
  return { code: res.code, body: res.payload };
}

/* ═══ 1. ranked by cost per result ═══════════════════════════════════════ */

test('cost per result: the platform\'s own figure or spend / results as returned; never from a missing figure; per platform and currency; a median from 3', async () => {
  const { seen } = world({ google: true, googleAdRows: [
    { id: '901', status: 'ENABLED', impressions: '5000', clicks: '100', ctr: 0.02, costMicros: '12500000', conversions: 5 },
    { id: '902', status: 'ENABLED', impressions: '4000', clicks: '40', ctr: 0.01, costMicros: '30000000', conversions: 3 },
    { id: '903', status: 'ENABLED', impressions: '3000', clicks: '90', ctr: 0.03, costMicros: '8000000', conversions: 4 },
    // Google returned no conversions for this one: no cost per result, never 0.
    { id: '904', status: 'PAUSED', impressions: '2000', clicks: '10', ctr: 0.005, costMicros: '5000000' },
  ] });
  const imp = await call('import', { body: { days: 180 } });
  expect(imp.code, JSON.stringify(imp.body)).toBe(200);
  // Google was asked for conversions, documented on the ad_group_ad field list.
  expect(seen.google_ads[0].sent.query).toMatch(/metrics\.cost_micros, metrics\.conversions FROM ad_group_ad/);

  const st = await call('status');
  const R = st.body.performance.ranking;
  expect(R.metric).toMatch(/cost per result.*lower is better/);
  const meta = R.platforms.find((g) => g.provider === 'meta');
  const g = R.platforms.find((x) => x.provider === 'google_ads');
  // Never pooled: one group per platform, each in its own currency (Google's is not read).
  expect(R.platforms.map((x) => `${x.provider}|${x.currency}`).sort()).toEqual(['google_ads|null', 'meta|INR']);
  // Meta: ad-1 4.00 reported, ad-2 90 / 9 = 10, ad-3 60 / 3 = 20.
  expect(meta.ranked.map((r) => [r.ad_id, r.cost_per_result, r.basis, r.rank])).toEqual([['ad-1', 4, 'reported', 1], ['ad-2', 10, 'computed', 2], ['ad-3', 20, 'computed', 3]]);
  expect(meta.median_cpr).toBe(10);
  expect(meta.ranked.map((r) => r.verdict)).toEqual(['below_median', 'at_median', 'above_median']);
  expect(meta.unrated).toEqual([
    { ad_id: 'ad-4', name: 'Nothing sold', reason: 'spent with no result reported', no_result: true },
    { ad_id: 'ad-5', name: 'Spend only', reason: 'results not returned', no_result: false },
  ]);
  expect(meta.basis_note).toBe('1 of 3 as Meta reported it, 2 worked out as spend / results, both as Meta returned them.');
  // Google: 12.5 / 5 = 2.5, 30 / 3 = 10, 8 / 4 = 2; 904 has no conversions.
  expect(g.ranked.map((r) => [r.ad_id, r.cost_per_result])).toEqual([['903', 2], ['901', 2.5], ['902', 10]]);
  expect(g.median_cpr).toBe(2.5);
  expect(g.unrated).toEqual([{ ad_id: '904', name: '904', reason: 'results not returned', no_result: false }]);
  // The stored metric for an absent figure stays null.
  const list = await call('list');
  const stored = Object.fromEntries(list.body.ads.map((x) => [x.ad_id, x.metrics]));
  expect(stored['ad-5'].conversions).toBe(null);
  expect(stored['ad-5'].cost_per_result).toBe(null);
  expect(stored['904'].conversions).toBe(null);
  expect(stored['901'].conversions).toBe(5);
  // Winners on the basis each platform could judge.
  const W = Object.fromEntries(st.body.performance.winners.map((w) => [w.provider, w]));
  expect(W.meta).toMatchObject({ basis: 'cost_per_result', currency: 'INR', median: 10, rated: 3 });
  expect(W.meta.winners.map((x) => x.ad_id)).toEqual(['ad-1']);
  expect(W.meta.losers.map((x) => x.ad_id)).toEqual(['ad-3']);
  expect(W.google_ads.winners.map((x) => x.ad_id)).toEqual(['903']);

  // Under three ads carrying it: no median, no verdict, the reason said.
  const thin = perf.rankByCostPerResult([
    { provider: 'meta', ad_id: 'x', currency: 'INR', metrics: { cost_per_result: 3 } },
    { provider: 'meta', ad_id: 'y', currency: 'INR', metrics: { spend: 10, conversions: 2 } },
    { provider: 'meta', ad_id: 'z', currency: 'INR', metrics: { spend: null, conversions: 4 } },
  ]).platforms[0];
  expect(thin.median_cpr).toBe(null);
  expect(thin.ranked.every((r) => r.verdict === null)).toBe(true);
  expect(thin.reason).toMatch(/2 of these 3 Meta ads carry a cost per result, under 3/);
  expect(thin.unrated[0].reason).toBe('spend not returned');
  // Two currencies on one platform are two lists, never one.
  const two = perf.rankByCostPerResult([
    { provider: 'meta', ad_id: 'a', currency: 'INR', metrics: { cost_per_result: 100 } },
    { provider: 'meta', ad_id: 'b', currency: 'USD', metrics: { cost_per_result: 2 } },
  ]);
  expect(two.platforms.map((x) => [x.currency, x.ranked.length])).toEqual([['INR', 1], ['USD', 1]]);
});

test('evidence: OWN ADS ranks by cost per result where 3+ ads carry it and says so; else by click-through rate, saying why; Winning angles cites it', async () => {
  world();
  await call('import', { body: { days: 180 } });
  history.resetCache();
  const ev = await history.evidenceAds('ws-a');
  const brief = evidence.briefFor({ __ownAds: ev });
  expect(brief).toContain('Meta: ranked by cost per result (spend / results, as the platform reported them; lower is better). Median 10.00 INR per result across 3 ads that carry one.');
  expect(brief).toMatch(/WORKED - "Slip": 2\.00% click-through, 10,000 impressions, 200 clicks, 100\.00 INR spent, 25 conversions, 4\.00 INR per result/);
  expect(brief).toMatch(/TIRING - "Everyday": /);
  expect(brief).not.toMatch(/WORKED - "Two pairs"/);   // the best click-through rate, but not the cheapest result

  // CTR fallback: the same ads with no result figures say which basis and why.
  const ctrOnly = evidence.briefFor({ __ownAds: { imported: true, ads: [
    { provider: 'meta', ad_id: 'c1', name: 'C1', metrics: { ctr: 0.04 } }, { provider: 'meta', ad_id: 'c2', name: 'C2', metrics: { ctr: 0.02 } }, { provider: 'meta', ad_id: 'c3', name: 'C3', metrics: { ctr: 0.01 } },
  ] } });
  expect(ctrOnly).toMatch(/Meta: median 2\.00% across 3 ads with a reported rate \(ranked by click-through rate, not cost per result: 0 of these 3 Meta ads carry a cost per result, under 3/);

  const out = await angleLab.run({ brand: BRAND, market: 'IN', competitors: [], deps: { ownAds: ev, hero: null, ciAds: null, fetchMetaAds: async () => ({ ok: true, ads: [] }), callLLM: async () => { throw new Error('down'); } } });
  const control = out.briefs.find((b) => b.basis === 'control');
  expect(control.own_ad_evidence).toMatchObject({ platform: 'Meta', ad: 'Slip', basis: 'cost_per_result', median_cost_per_result: 10, median_ctr: null });
  expect(control.evidence).toContain('Your own Meta ad "Slip" cost less per result than your own median (10.00 INR)');
});

/* ═══ 2. winning ads spawn variations ════════════════════════════════════ */

test('variations: only of a winner; pattern, format and limits held in code; grounded; each carries variation_of; the prompt closes on its contract', async () => {
  world();
  await call('import', { body: {} });
  const long = 'Tired of frames that slip? ' + 'Frames that fit every face, all day long, at home and at work and on the road. '.repeat(2);
  installLlm({ variants: [
    { primary_text: 'Tired of glasses sliding down? Frames that fit every face.', headline: 'Frames that fit' },
    { primary_text: 'Frames that fit every face.', headline: 'Fit' },                            // a statement: not the winner's "question"
    { primary_text: long, headline: 'Long' },                                                      // over 125: dropped, never cut
    { primary_text: 'Tired of cheap frames? Our award-winning frames fit every face.', headline: 'x' },   // a claim the brand does not state
    { primary_text: 'Tired of frames that slip? Frames that fit every face.', headline: 'Same' },  // the winner itself
    { primary_text: 'Still squinting at screens? Free eye test in store.', headline: 'An eye test that is free of charge every single day here' },
  ] });
  const r = await call('variations', { body: { ad_id: 'ad-1', n: 4 } });
  expect(r.code, JSON.stringify(r.body)).toBe(200);
  expect(r.body).toMatchObject({ ok: true, pattern: 'question', format: 'image', by: 'model', limits: { contract: 'ad.meta.static', primary_text: 125, headline: 40 } });
  expect(r.body.source).toMatchObject({ ad_id: 'ad-1', basis: 'cost_per_result', value: 4, median: 10, currency: 'INR' });
  expect(r.body.variations.map((v) => v.primary_text)).toEqual([
    'Tired of glasses sliding down? Frames that fit every face.',
    'Still squinting at screens? Free eye test in store.',
  ]);
  // A headline over 40 is left blank, never cut; the variation stays.
  expect(r.body.variations[1].headline).toBe(null);
  for (const v of r.body.variations) {
    expect(v.variation_of).toMatchObject({ ad_id: 'ad-1', provider: 'meta', basis: 'cost_per_result', value: 4, median: 10, currency: 'INR' });
    expect(v.variation_of.figures).toContain('4.00 INR per result');
    expect(v.brief).toMatchObject({ basis: 'variation', primary_text: v.primary_text, angle_name: expect.stringContaining('of "Slip"') });
    expect(angleLab.hookPattern(v.primary_text)).toBe('question');
  }
  const why = r.body.dropped.map((d) => d.why).join(' | ');
  expect(why).toMatch(/opens as "statement", not the winning ad's "question"/);
  expect(why).toMatch(/over 125 characters/);
  expect(why).toMatch(/states award/);
  expect(r.body.gaps[0]).toMatch(/2 of 4 variations/);
  // One model call, closed by its own contract.
  expect(LLM.calls).toHaveLength(1);
  const p = LLM.calls[0];
  expect(p.responseFormat).toEqual({ type: 'json_object' });
  expect(p.userMessage).toMatch(/Keep its hook pattern \("question"/);
  expect(p.userMessage).toMatch(/It cost 4\.00 INR per result against this brand's own median of 10\.00 on Meta/);
  const oc = req('api/_shared/output-contract.js').read(p.userMessage);
  expect(oc).toMatchObject({ id: 'ad-history.variations', format: 'json', trailing: '' });

  // Not a winner (dearer than the median): refused with where it stands; no model call.
  installLlm({ variants: [] });
  const lose = await call('variations', { body: { ad_id: 'ad-3' } });
  expect(lose.code).toBe(409);
  expect(lose.body.error).toBe('not_a_winner');
  expect(lose.body.message).toMatch(/did not beat this brand's own median cost per result on Meta/);
  expect(LLM.calls).toHaveLength(0);
});

test('variations: a viewer is refused and nothing is written; a GET is refused; a device brand gets one sentence; no model = the brand\'s own lines, labelled', async () => {
  world();
  await call('import', { body: {} });
  installLlm(new Error('every provider is down'));
  const v = await call('variations', { auth: AUTH_V, body: { ad_id: 'ad-1' } });
  expect(v.code).toBe(403);
  expect(LLM.calls).toHaveLength(0);
  expect((await call('variations', { method: 'GET' })).code).toBe(405);
  expect((await call('variations', { ws: null, body: {} })).code).toBe(409);

  // No ad named: the winner furthest past its own median (ad-1, 60% under it).
  const r = await call('variations', { body: { n: 6 } });
  expect(r.code, JSON.stringify(r.body)).toBe(200);
  expect(r.body.by).toBe('brand_lines');
  expect(r.body.note).toMatch(/No model answered/);
  expect(r.body.source.ad_id).toBe('ad-1');
  expect(r.body.variations.length).toBeGreaterThan(0);
  const g = req('api/_shared/copy-grounding.js');
  const facts = g.factsFor(BRAND, { description: 'Tired of frames that slip? Frames that fit every face. Frames that fit' });
  for (const x of r.body.variations) {
    expect(angleLab.hookPattern(x.primary_text)).toBe('question');
    expect(x.primary_text.length).toBeLessThanOrEqual(125);
    expect(g.unbacked(x.primary_text, facts)).toEqual([]);
    expect(x.by).toBe('brand_lines');
    expect(x.primary_text).not.toMatch(/[–—]/);
  }
  // Never padded: fewer than asked is said.
  if (r.body.variations.length < 6) expect(r.body.gaps.join(' ')).toMatch(/without inventing/);
});

/* ═══ 3. the /connections card, in Chromium ══════════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const APP = 'http://localhost:4982';
const WS = '7b1f8c2a-1111-4222-8333-944455556678';
const PAGE_AUTH = { ok: true, token: 'tok-p', user_id: 'user-p', email: 'p@example.test' };
const PAGE_BRAND = Object.assign({
  id: WS, slug: 'frameworks', status: 'active', onboarding_step: 6, website: 'https://brand.example',
  palette: { primary: '#1D3A8A', accent: '#16A3A3', ink: '#14161C', surface: '#FFFFFF' },
  typography: { heading: { family: 'Inter', stack: "'Inter',system-ui,sans-serif" }, body: { family: 'Inter', stack: "'Inter',system-ui,sans-serif" } },
  voice: { tone: 'clear' }, regions: [{ code: 'IN', currency: 'INR', home: true }], brand_data: {},
}, BRAND);

function serve(route, u) {
  const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\//, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
  return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
}

for (const width of [1280, 390]) {
  test(`/connections at ${width}px: ranked by cost per result, "Make variations" only on a winner, variations handed to Paid launch`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
    const db = new FakeSupabase();
    db.addUser('tok-p', 'user-p', 'p@example.test').addWorkspace(WS, 'user-p').setActive('user-p', WS).syncIdentityTables();
    // Google too: its winner (903) has no copy, because Google's copy is not read.
    world({ db, ws: WS, google: true, googleAdRows: [
      { id: '901', status: 'ENABLED', impressions: '5000', clicks: '100', ctr: 0.02, costMicros: '12500000', conversions: 5 },
      { id: '902', status: 'ENABLED', impressions: '4000', clicks: '40', ctr: 0.01, costMicros: '30000000', conversions: 3 },
      { id: '903', status: 'ENABLED', impressions: '3000', clicks: '90', ctr: 0.03, costMicros: '8000000', conversions: 4 },
    ] });
    installLlm(new Error('every provider is down'));
    const thrown = [];
    page.on('pageerror', (e) => thrown.push(String(e.message || e)));
    page.on('dialog', (d) => { thrown.push('a native dialog opened: ' + d.message()); d.dismiss(); });
    await page.route(/^https?:\/\//, async (route) => {
      const r0 = route.request();
      const u = new URL(r0.url());
      if (u.origin !== APP) return r0.resourceType() === 'script' ? route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }) : route.abort('failed');
      if (!u.pathname.startsWith('/api/')) {
        if (u.pathname === '/publishing') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Publishing</title><p>publishing</p>' });
        return serve(route, u);
      }
      const action = u.searchParams.get('action');
      const json = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (action === 'ad-history') {
        const body = r0.method() === 'POST' ? JSON.parse(r0.postData() || '{}') : null;
        const res = makeRes();
        await history.handle(makeReq({ token: PAGE_AUTH.token, query: Object.fromEntries(u.searchParams.entries()), body, method: r0.method() }), res, { auth: PAGE_AUTH, workspaceId: WS, body: body || {}, brand: BRAND });
        return json(res.payload, res.code);
      }
      if (action === 'auth') return json({ ok: true, mode: 'google' });
      if (action === 'brand') {
        const op = u.searchParams.get('op');
        if (op === 'presets') return json({ ok: true, presets: [] });
        if (op === 'catalog-status') return json({ ok: true });
        return json({ ok: true, brand: PAGE_BRAND, workspaces: [PAGE_BRAND], active_id: WS });
      }
      if (action === 'connections') return json({ ok: true, providers: [], connections: [], routing: { entries: [] }, storage: {} });
      return json({ ok: true });
    });
    await page.goto(APP + '/brand-connections.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.name === 'Frameworks', null, { timeout: 20000 });
    const card = page.locator('#adHistoryCard');
    await expect(card).toBeVisible({ timeout: 15000 });
    await page.locator('#adHistoryImport').click();
    const rank = card.locator('[data-ah-ranking]');
    await expect(rank.locator('tr[data-ah-rank]')).toHaveCount(6, { timeout: 15000 });
    await expect(rank.locator('[data-ah-rank-platform="meta"] [data-ah-median]')).toHaveText('10 INR');
    await expect(rank.locator('tr[data-ah-rank]').nth(0)).toHaveAttribute('data-ah-rank', '903');
    await expect(rank.locator('tr[data-ah-rank]').nth(3)).toHaveAttribute('data-ah-rank', 'ad-1');
    await expect(rank.locator('tr[data-ah-rank="ad-1"] td[data-label="Cost per result"]')).toHaveText('4 INR');
    await expect(rank.locator('tr[data-ah-rank="ad-1"] td[data-label="How"]')).toHaveText('as reported');
    await expect(rank.locator('tr[data-ah-rank="ad-2"] td[data-label="How"]')).toHaveText('spend / results');
    await expect(rank.locator('[data-ah-unrated]')).toContainText('2 of 5 carry no cost per result: 1 spent with no result reported, 1 results not returned.');
    // Only a winner can be varied.
    await expect(rank.locator('[data-ah-vary]')).toHaveCount(1);
    // Google's cheapest ad is a winner with no copy: no button, the reason instead (review of #413).
    await expect(rank.locator('tr[data-ah-rank="903"] [data-ah-vary]')).toHaveCount(0);
    await expect(rank.locator('tr[data-ah-rank="903"] [data-ah-no-copy]')).toContainText('Google Ads did not return this ad\'s copy, so there is nothing to vary.');
    await expect(rank.locator('tr[data-ah-rank="ad-1"] [data-ah-vary]')).toBeVisible();
    // The ads table names the currency beside a cost per result.
    await expect(card.locator('tr[data-ah-ad="ad-1"] td[data-label="Cost per result"]')).toHaveText('4 INR');

    await rank.locator('tr[data-ah-rank="ad-1"] [data-ah-vary]').click();
    const vr = card.locator('[data-ah-var-result]');
    await expect(vr).toBeVisible({ timeout: 15000 });
    await expect(vr).toContainText('Variations of "Slip"');
    await expect(vr).toContainText('4 INR per result against your median 10 INR');
    await expect(vr.locator('[data-ah-var-by="brand_lines"]')).toContainText('No model answered');
    const n = await vr.locator('[data-ah-var]').count();
    expect(n).toBeGreaterThan(0);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);

    await page.locator('#adVarLaunch').click();
    await page.waitForURL(/\/publishing\?tab=launch/, { timeout: 10000 });
    const handed = await page.evaluate(() => JSON.parse(sessionStorage.getItem('lifecycle.launch.briefs') || 'null'));
    expect(handed.briefs).toHaveLength(n);
    expect(handed.briefs[0]).toMatchObject({ basis: 'variation', variation_of: { ad_id: 'ad-1', basis: 'cost_per_result' } });
    expect(thrown).toEqual([]);
  });
}

/* ═══ 4. the setup run reads the connected account's past ads ═══════════ */

/**
 * Press "Set up from my website" on an existing account brand. Brand ops go
 * through the shipped brand router; ad history through the shipped reader over
 * the fake Meta account; the site readers answer canned. `o.connect` false =
 * no ad account; `o.adHistory` answers ad-history instead of the reader;
 * `o.extract` replaces the read's fields.
 */
async function runSetup(browser, o) {
  const opts = o || {};
  const F = require('./lib/brand-invariant-fixtures.js');
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.owner.sig';
  const OWNER = 'aaaaaaaa-0000-4000-8000-0000000000c8';
  const HOST = 'http://127.0.0.1:9';
  const SITE = 'https://brambleweld-larder.example';
  const core = req('api/_shared/brand-workspace-core.js');
  const db = req('tests/lib/brand-save-fake.js').makeDb(TOKEN, OWNER);
  process.env.BRAND_RENDER = 'off';
  db.table('brand_workspaces').push(Object.assign(F.workspaceRow(F.BRAMBLE, 'ws-bwl'), { owner_id: OWNER, onboarding_step: 1, created_at: db.tick(), updated_at: db.tick() }));
  db.table('brand_user_prefs').push({ user_id: OWNER, active_workspace_id: 'ws-bwl' });
  if (opts.connect === false) { installPlatforms(db, {}); db.install(); } else world({ db, ws: 'ws-bwl' });
  const auth = { ok: true, token: TOKEN, user_id: OWNER, email: 'owner@example.test' };
  const brainOps = [];
  const fields = Object.assign({ name: { value: 'Brambleweld Larder', source_url: SITE + '/', signal: 'og:site_name', candidates: [{ value: 'Brambleweld Larder', source_url: SITE + '/', signal: 'og:site_name' }] }, tagline: { value: '', candidates: [] }, logo: { value: '', candidates: [] }, palette: { proposed: {}, sources: {}, conflicts: [] }, typography: { heading: [], body: [], scale: [] }, claims: { candidates: [] }, social: { candidates: [] }, legal: { candidates: [] } }, opts.extract || {});
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => {
      window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
    });
    await context.route((u) => !String(u).startsWith(HOST), (route) => {
      if (route.request().resourceType() !== 'script') return route.abort('failed');
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
    });
    await context.route(HOST + '/**', async (route) => {
      const u = new URL(route.request().url());
      const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (!u.pathname.startsWith('/api/')) return serve(route, u);
      const action = u.searchParams.get('action'), op = u.searchParams.get('op');
      if (!action) return json({ ok: true });
      if (action === 'auth') return op === 'status' ? json({ ok: true, mode: 'device', reason: 'no_database_url', host: '' }) : json({ ok: false }, 401);
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (_) { body = {}; }
      if (action === 'ad-history') {
        brainOps.push(op);
        if (opts.adHistory) { const a = opts.adHistory(op); return json(a.body, a.status); }
        const res = makeRes();
        await history.handle(makeReq({ token: TOKEN, query: Object.fromEntries(u.searchParams), body: route.request().method() === 'POST' ? body : undefined, method: route.request().method() }), res, { auth, workspaceId: u.searchParams.get('workspace_id'), body, brand: null });
        return json(res.payload, res.code);
      }
      if (action !== 'brand') return json({ ok: true });
      if (op === 'presets' || op === 'defaults') return json({ ok: true, presets: [] });
      if (op === 'extract') return json({ ok: true, start: SITE, pages_visited: 2, stylesheets: [], limits: [], read: { method: 'parsed' }, fields });
      if (op === 'catalog-import') return json({ ok: true, imported: 4, own: 4, complete: true });
      if (op === 'catalog-status') return json({ ok: true });
      if (op === 'context-build') return json({ ok: true, done: true, pack: { site_url: SITE, stage: 'done' } });
      if (op === 'context-pack') return json({ ok: true, pack: { site_url: SITE, stage: 'done' }, current: true });
      const r = makeReq({ token: TOKEN, query: Object.fromEntries(u.searchParams), body: route.request().method() === 'POST' ? body : undefined, method: route.request().method() });
      const res = makeRes();
      await core.handle(r, res);
      return json(res.payload, res.code);
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.goto(HOST + '/onboarding.html?step=1&id=ws-bwl', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded && window.BrandContext.brand && window.BrandContext.brand.id === 'ws-bwl', null, { timeout: 20000 });
    await page.fill('#xUrl', SITE);
    await page.click('#xSetup');
    await page.waitForFunction(() => {
      const run = document.querySelector('[data-setup-run]');
      return run && !run.hasAttribute('aria-busy') && !document.querySelector('[data-setup-log] li[data-state="running"]');
    }, null, { timeout: 30000 });
    const steps = await page.$$eval('[data-setup-log] li', (els) => els.map((e) => [e.getAttribute('data-setup-step'), e.getAttribute('data-state'), e.querySelector('.srun-text').textContent]));
    const connect = await page.$$eval('[data-setup-connect]', (els) => els.map((e) => e.getAttribute('href')));
    return { steps, brainOps, db, errors, connect, say: JSON.stringify(steps) };
  } finally {
    await context.close();
  }
}

test('"Set up from my website" reads a connected Meta account\'s past ads and says per platform how many and the brand\'s own median', async ({ browser }) => {
  const r = await runSetup(browser);
  const ads = r.steps.find((s) => s[0] === 'ads');
  expect(ads, r.say).toBeTruthy();
  expect(ads[1], ads[2]).toBe('done');
  expect(ads[2]).toBe('Read your past ads. Meta ads: 5 ads, median cost per result 10.00 INR. Connections shows each ad and its figures.');
  expect(r.brainOps).toEqual(['status', 'import', 'status']);
  expect(r.db.table('brand_ad_history').filter((x) => x.workspace_id === 'ws-bwl')).toHaveLength(5);
  // It never stopped the run: Review came after it.
  expect(r.steps.map((s) => s[0]).slice(-2), r.say).toEqual(['ads', 'review']);
  expect(r.steps.find((s) => s[0] === 'review')[1]).not.toBe('failed');
  expect(r.errors).toEqual([]);
});

test('setup with no ad account connected says so in one sentence with the way to Connections; a refused read is said; neither stops the run', async ({ browser }) => {
  const none = await runSetup(browser, { connect: false });
  const ads = none.steps.find((s) => s[0] === 'ads');
  expect(ads, none.say).toEqual(['ads', 'skipped', 'No Meta or Google Ads account is connected to Brambleweld Larder yet. Connect one on Connections and its past ads are read there.']);
  expect(none.connect).toEqual(['/connections']);
  expect(none.brainOps).toEqual(['status']);           // nothing imported
  expect(none.steps.map((s) => s[0]).slice(-1)).toEqual(['review']);

  const down = await runSetup(browser, { adHistory: () => ({ status: 503, body: { ok: false, error: 'ad_history_store_unavailable', message: 'This deployment has no store for ad history.' } }) });
  const d = down.steps.find((s) => s[0] === 'ads');
  expect(d[1], down.say).toBe('failed');
  expect(d[2]).toMatch(/^We could not read your past ads\./);
  expect(down.steps.find((s) => s[0] === 'review')[1], down.say).not.toBe('running');
  expect(down.errors).toEqual([]);
});

test('a setup step that throws never leaves its row "running": it says it stopped, and the run ends', async ({ browser }) => {
  // A read that came back without its tagline and logo fields made a step throw
  // (found while building this); the Brand row then kept its clock going for ever.
  const r = await runSetup(browser, { extract: { tagline: undefined, logo: undefined } });
  expect(r.steps.filter((s) => s[1] === 'running'), r.say).toEqual([]);
  const stopped = r.steps.filter((s) => s[1] === 'failed' && /This step stopped before it finished/.test(s[2]));
  expect(stopped.length, r.say).toBeGreaterThan(0);
});

/* ═══ 5. review of #413 (Cursor Bugbot), each executed ═══════════════════ */

test('review 1: the op is read where the meter reads it - a POST with op=variations only in the body runs nothing', async () => {
  world();
  await call('import', { body: {} });
  installLlm({ variants: [{ primary_text: 'Tired of glasses sliding down? Frames that fit every face.', headline: 'Fit' }] });
  // brain.js meters on the QUERY's op; the body naming variations must not run the model.
  const hidden = await call('', { body: { op: 'variations', ad_id: 'ad-1' } });
  expect(hidden.code).toBe(400);
  expect(hidden.body.error).toBe('op_in_query');
  const mixed = await call('status', { body: { op: 'variations', ad_id: 'ad-1' } });
  expect(mixed.code).toBe(400);
  expect(LLM.calls).toHaveLength(0);
  // Named in the query (as the pages do), with or without the same op in the body, it runs.
  const ok = await call('variations', { body: { op: 'variations', ad_id: 'ad-1' } });
  expect(ok.code, JSON.stringify(ok.body)).toBe(200);
  expect(LLM.calls).toHaveLength(1);
});

test('review 2: a winner whose copy the platform did not return says so on status, and is never offered variations', async () => {
  world({ google: true, googleAdRows: [
    { id: '901', status: 'ENABLED', impressions: '5000', clicks: '100', ctr: 0.02, costMicros: '12500000', conversions: 5 },
    { id: '902', status: 'ENABLED', impressions: '4000', clicks: '40', ctr: 0.01, costMicros: '30000000', conversions: 3 },
    { id: '903', status: 'ENABLED', impressions: '3000', clicks: '90', ctr: 0.03, costMicros: '8000000', conversions: 4 },
  ] });
  await call('import', { body: {} });
  const st = await call('status');
  const g = st.body.performance.winners.find((w) => w.provider === 'google_ads');
  expect(g.winners[0]).toMatchObject({ ad_id: '903', has_copy: false, no_copy_reason: 'Google Ads did not return this ad\'s copy, so there is nothing to vary.' });
  const m = st.body.performance.winners.find((w) => w.provider === 'meta');
  expect(m.winners[0]).toMatchObject({ ad_id: 'ad-1', has_copy: true, no_copy_reason: '' });
  const rankedG = st.body.performance.ranking.platforms.find((x) => x.provider === 'google_ads').ranked.find((r) => r.ad_id === '903');
  expect(rankedG.has_copy).toBe(false);
  // And the reader agrees: asked anyway, it refuses with the same reason.
  installLlm({ variants: [] });
  const r = await call('variations', { body: { ad_id: '903' } });
  expect(r.code).toBe(409);
  expect(r.body.error).toBe('no_copy');
  expect(LLM.calls).toHaveLength(0);
});

test('review 3: status, variations and the writer\'s evidence judge the SAME rows, so a ranked winner is never refused as "not a winner"', async () => {
  const { db } = world();
  const old = new Date(Date.now() - 100 * DAY).toISOString();
  // Three rated ads seen long ago (the winner among them), then 340 newer ads with no figures.
  [['w-1', 2], ['w-2', 5], ['w-3', 9]].forEach(([id, cpr]) => db.insert('brand_ad_history', { workspace_id: 'ws-a', provider: 'meta', account_id: 'act_77', ad_id: id, name: id, currency: 'INR', primary_text: 'Frames that fit every face.', headline: 'Fit', image_url: 'https://cdn.brand.example/w.jpg', metrics: { cost_per_result: cpr, ctr: 0.01 }, last_seen: old }));
  for (let i = 0; i < 340; i++) db.insert('brand_ad_history', { workspace_id: 'ws-a', provider: 'meta', account_id: 'act_77', ad_id: `n-${String(i).padStart(3, '0')}`, name: `n${i}`, currency: 'INR', primary_text: 'Eyewear made for every day.', metrics: { impressions: 10 }, last_seen: new Date(Date.now() - i * 1000).toISOString() });
  db.insert('brand_ad_history_runs', { workspace_id: 'ws-a', provider: 'meta', ok: true, ads: 343, ran_at: new Date().toISOString() });
  const st = await call('status');
  const statusWinner = st.body.performance.winners.find((w) => w.provider === 'meta').winners[0].ad_id;
  installLlm(new Error('down'));
  const v = await call('variations', { body: { ad_id: statusWinner } });
  expect(v.code, JSON.stringify(v.body)).toBe(200);
  history.resetCache();
  const ev = evidence.evidenceFor({ __ownAds: await history.evidenceAds('ws-a') });
  const evWinner = ev.ads.platforms.find((p) => p.provider === 'meta').worked[0];
  expect([statusWinner, v.body.source.ad_id, evWinner && evWinner.ad_id]).toEqual(['w-1', 'w-1', 'w-1']);
  // One read: the same order and limit every time.
  const reads = db.calls.filter((c) => /\/rest\/v1\/brand_ad_history\?select=\*/.test(c.url)).map((c) => decodeURIComponent(c.url.replace(/.*\?/, '')));
  expect(new Set(reads).size).toBe(1);
  expect(reads[0]).toMatch(/order=last_seen\.desc,ad_id\.asc&limit=1000/);
});

test('review 4: a winner ranked on a computed cost per result prints that figure, labelled, in OWN ADS, Winning angles and variation_of', async () => {
  const ads = [
    { provider: 'meta', ad_id: 'c1', name: 'C1', currency: 'INR', primary_text: 'Tired of frames that slip? Frames that fit every face.', image_url: 'https://x/1.jpg', metrics: { spend: 10, conversions: 5, ctr: 0.01 } },
    { provider: 'meta', ad_id: 'c2', name: 'C2', currency: 'INR', primary_text: 'Eyewear made for every day.', image_url: 'https://x/2.jpg', metrics: { spend: 50, conversions: 5, ctr: 0.05 } },
    { provider: 'meta', ad_id: 'c3', name: 'C3', currency: 'INR', primary_text: 'Free eye test in store.', image_url: 'https://x/3.jpg', metrics: { spend: 90, conversions: 3, ctr: 0.03 } },
  ];
  const label = '2.00 INR per result (worked out: spend / results, as the platform reported them)';
  const brief = evidence.briefFor({ __ownAds: { imported: true, ads } });
  expect(brief).toContain(`WORKED - "C1": 1.00% click-through, 10.00 INR spent, 5 conversions, ${label}`);
  const out = await angleLab.run({ brand: BRAND, market: 'IN', competitors: [], deps: { ownAds: { imported: true, ads }, hero: null, ciAds: null, fetchMetaAds: async () => ({ ok: true, ads: [] }), callLLM: async () => { throw new Error('down'); } } });
  expect(out.briefs.find((b) => b.basis === 'control').evidence).toContain(label);
  const V = req('api/_shared/ad-variations.js');
  const r = await V.variationsFor({ ads, brand: BRAND, adId: 'c1', deps: { callLLM: async () => { throw new Error('down'); } } });
  expect(r.source.figures).toContain(label);
  for (const x of r.variations) expect(x.variation_of.figures).toContain(label);
  // A reported figure keeps its plain wording.
  expect(evidence.adFigures({ cost_per_result: 4 }, 'INR')).toBe('4.00 INR per result');
});
