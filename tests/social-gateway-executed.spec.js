// The Social Integration Gateway, EXECUTED (2026-10-04).
//
// Meta (Instagram + Facebook + Ads), TikTok, TikTok Ads, Pinterest and YouTube,
// driven through the SHIPPED code - the connections router for OAuth, the
// dispatch queue for every write, social-gateway-core.handle for reads, flags
// and live approval, platform-webhooks.receive for inbound deliveries, and
// refreshDueTokens for the cron - over the in-memory Supabase in
// tests/lib/fake-supabase.js and fake platforms in
// tests/lib/fake-social-platforms.js that answer exactly the documented
// endpoints the adapters use and THROW on anything else.
//
// What has to hold, each asserted on what was actually sent or stored:
//   - OAuth: each platform's own shape (TikTok's client_key and comma scopes,
//     Pinterest's HTTP Basic, Google's offline consent + PKCE), the grant
//     stored encrypted, the account the platform named kept for routing;
//   - refresh from the cron path: due within 7 days only; a refusal marks the
//     connection needs_reauth and the hub says so; a platform that did not
//     answer is retried, not condemned;
//   - reads need LIVE_CONNECTORS and nothing else; an absent metric is absent;
//   - every write is blocked by EACH missing switch on its own, with the exact
//     request it would have made and zero calls to the platform;
//   - paid writes are created PAUSED / DISABLED / private, and turning them on
//     is a separate live approval stamped with the operator who gave it;
//   - an UNVERIFIED endpoint refuses, whatever the switches say;
//   - webhooks verify over the raw bytes, a forgery is refused, a redelivery
//     is recorded once, and a routed event is written to platform_sync_log;
//   - underperformance is measured against the brand's own median or the
//     operator's own threshold, and a flag only OFFERS a metered regeneration.
//
// Run: npx playwright test tests/social-gateway-executed.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const { Readable } = require('stream');
const { FakeSupabase, makeReq, makeRes, envScope, nowIso, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');
const { installPlatforms, GRAPH, TT, PIN, YT, YT_UP, MEDIA, SESSION, GADS } = require('./lib/fake-social-platforms.js');

const ROOT = path.resolve(__dirname, '..');
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const dispatch = require(path.join(ROOT, 'api', '_shared', 'dispatch-core.js'));
const gateway = require(path.join(ROOT, 'api', '_shared', 'social-gateway-core.js'));
const webhooks = require(path.join(ROOT, 'api', '_shared', 'platform-webhooks.js'));
const registry = require(path.join(ROOT, 'api', '_shared', 'adapters', 'registry.js'));
const catalog = require(path.join(ROOT, 'api', '_shared', 'credit-catalog.js'));

const CALLBACK = 'https://app.example.test/api/public-config?action=connections&op=oauth-callback&provider=';
const SWITCH = { meta: 'META_ALLOW_WRITES', tiktok: 'TIKTOK_ALLOW_WRITES', tiktok_ads: 'TIKTOK_ALLOW_WRITES', pinterest: 'PINTEREST_ALLOW_WRITES', youtube: 'YOUTUBE_ALLOW_WRITES', google_ads: 'GOOGLE_ADS_ALLOW_WRITES' };
const ALL_SWITCHES = ['META_ALLOW_WRITES', 'TIKTOK_ALLOW_WRITES', 'PINTEREST_ALLOW_WRITES', 'YOUTUBE_ALLOW_WRITES', 'GOOGLE_ADS_ALLOW_WRITES'];

const ENV = envScope([
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'CONNECTION_SECRET_KEY', 'PUBLIC_BASE_URL', 'VERCEL_URL',
  'LIVE_CONNECTORS', 'CRON_SECRET', 'VERCEL_REGION', ...ALL_SWITCHES,
  'META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_WEBHOOK_TOLERANCE_SECONDS',
  'PINTEREST_APP_ID', 'PINTEREST_APP_SECRET', 'YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET', 'YOUTUBE_MAX_UPLOAD_BYTES',
  'GOOGLE_ADS_CLIENT_ID',
]);
let REAL_FETCH;
let REAL_LOOKUP;

function baseEnv() {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'e'.repeat(64);
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-app-secret';
  process.env.TIKTOK_CLIENT_KEY = 'tt-client-key';
  process.env.TIKTOK_CLIENT_SECRET = 'tt-client-secret';
  process.env.PINTEREST_APP_ID = 'pin-app';
  process.env.PINTEREST_APP_SECRET = 'pin-secret';
  process.env.YOUTUBE_OAUTH_CLIENT_ID = 'yt-client';
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = 'yt-secret';
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'VERCEL_URL', 'VERCEL_REGION', 'CRON_SECRET', 'GOOGLE_ADS_CLIENT_ID',
    'LIVE_CONNECTORS', 'META_WEBHOOK_VERIFY_TOKEN', 'TIKTOK_WEBHOOK_TOLERANCE_SECONDS', 'YOUTUBE_MAX_UPLOAD_BYTES', ...ALL_SWITCHES]) delete process.env[k];
}

test.beforeAll(() => {
  ENV.save();
  REAL_FETCH = global.fetch;
  REAL_LOOKUP = dns.promises.lookup;
  // The SSRF guard resolves the media host; only the brand's CDN is public here.
  dns.promises.lookup = async (host) => {
    if (host === 'cdn.brand.example') return [{ address: '93.184.216.34', family: 4 }];
    const e = new Error(`getaddrinfo ENOTFOUND ${host}`); e.code = 'ENOTFOUND'; throw e;
  };
  baseEnv();
});
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; dns.promises.lookup = REAL_LOOKUP; });
test.afterEach(() => baseEnv());

/* ── the world ──────────────────────────────────────────────────────────── */

const AUTH_A = { ok: true, token: 'tok-a', user_id: 'user-a', email: 'a@example.test' };
const AUTH_V = { ok: true, token: 'tok-v', user_id: 'user-v', email: 'v@example.test' };
const AUTH_B = { ok: true, token: 'tok-b', user_id: 'user-b', email: 'b@example.test' };

function world(opts) {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addUser('tok-v', 'user-v', 'v@example.test').addUser('tok-b', 'user-b', 'b@example.test')
    .addWorkspace('ws-a', 'user-a').addWorkspace('ws-b', 'user-b').addMember('ws-a', 'user-v', 'viewer')
    .setActive('user-a', 'ws-a').setActive('user-v', 'ws-a').setActive('user-b', 'ws-b').syncIdentityTables();
  const seen = installPlatforms(db, opts);
  db.install();
  connections._resolvedCache.clear();
  return { db, seen };
}

const CATEGORY = { meta_ads: 'ads', tiktok: 'social', tiktok_ads: 'ads', pinterest: 'social', youtube: 'social', google_ads: 'ads' };
const DAY = 86400000;

/** A stored connection with encrypted secrets, the way the OAuth callback leaves one. */
function connect(db, provider, secrets, extra) {
  const e = Object.assign({ ws: 'ws-a', config: {}, expiresInMs: 30 * DAY, scopes: [], status: 'active' }, extra || {});
  const row = db.insert('workspace_connections', {
    workspace_id: e.ws, provider, category: CATEGORY[provider] || 'social', auth_kind: 'oauth', label: provider,
    config: e.config, secret_fields: Object.keys(secrets), secret_hint: 'xxxx', status: e.status,
    connect_kind: 'oauth', oauth_scopes: e.scopes, token_expires_at: new Date(Date.now() + e.expiresInMs).toISOString(),
    refresh_failure_count: 0, revoked_at: null, external_account_id: e.account || null, external_account_label: null,
    last_check_note: e.note || '',
  });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: row.id, workspace_id: e.ws }, connections.encryptSecrets(secrets)));
  return row;
}

const conns = (db) => db.table('workspace_connections');
const jobs = (db) => db.table('dispatch_jobs');
const secretsOf = (db, row) => connections.decryptSecrets(db.table('workspace_connection_secrets').find((s) => s.connection_id === row.id));
const platformCalls = (db) => db.external().filter((c) => !c.url.startsWith(MEDIA));
const live = (...switches) => { process.env.LIVE_CONNECTORS = 'on'; for (const s of switches) process.env[s] = '1'; };

/** Drive the shipped connections router, as api/public-config.js does. */
async function connRouter(op, { token, query, body, method } = {}) {
  const res = makeRes();
  await connections.handle(makeReq({ token, query: Object.assign({ action: 'connections', op }, query || {}), body, method }), res);
  return res;
}

/** Drive the gateway as api/brain.js does: the verified caller and the workspace scoping resolved. */
async function gw(op, { auth = AUTH_A, ws = 'ws-a', query, body } = {}) {
  const res = makeRes();
  await gateway.handle(makeReq({ token: auth.token, query: Object.assign({ action: 'social-gateway', op }, query || {}), body, method: body ? 'POST' : 'GET' }), res, { auth, workspaceId: ws, body: body || {} });
  return res;
}

async function drain() { return dispatch.drain({ workspaceId: 'ws-a', selfFire: false }); }

/* ═══ 1. OAuth, per platform ════════════════════════════════════════════ */

test('TikTok: Login Kit with client_key and comma-separated scopes, the token exchanged as a form, the grant stored encrypted and the open_id kept for routing', async () => {
  const { db, seen } = world();
  const s = await connRouter('oauth-start', { token: 'tok-a', method: 'POST', body: { provider: 'tiktok', scopes: ['user.info.basic', 'video.list', 'video.publish', 'not.a.scope'], return_to: '/publishing' } });
  expect(s.code).toBe(200);
  const u = new URL(s.payload.url);
  expect(u.origin + u.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
  expect(u.searchParams.get('client_key'), 'TikTok names the client id client_key').toBe('tt-client-key');
  expect(u.searchParams.get('client_id')).toBeNull();
  expect(u.searchParams.get('scope'), 'a scope the adapter cannot explain is not requested; TikTok separates with commas').toBe('user.info.basic,video.list,video.publish');
  expect(u.searchParams.get('response_type')).toBe('code');
  expect(u.searchParams.get('redirect_uri')).toBe(CALLBACK + 'tiktok');
  expect(u.searchParams.get('code_challenge'), 'Login Kit for web documents no PKCE').toBeNull();
  expect(db.external()).toHaveLength(0);

  const cb = await connRouter('oauth-callback', { method: 'GET', query: { provider: 'tiktok', state: s.payload.state, code: 'tt-code-1', scopes: 'user.info.basic,video.list' } });
  expect(cb.code).toBe(302);
  expect(cb.head.Location).toBe('/publishing?oauth=connected&provider=tiktok');

  const ex = seen.tiktok.find((c) => c.path === '/v2/oauth/token/');
  const sentForm = new URLSearchParams(ex.sent);
  expect(Object.fromEntries(sentForm.entries())).toEqual({ grant_type: 'authorization_code', code: 'tt-code-1', redirect_uri: CALLBACK + 'tiktok', client_key: 'tt-client-key', client_secret: 'tt-client-secret' });
  expect(seen.tiktok.find((c) => c.path === '/v2/user/info/').headers.authorization).toBe('Bearer act.tt-1');

  const row = conns(db).find((c) => c.provider === 'tiktok');
  expect(row).toMatchObject({ workspace_id: 'ws-a', connect_kind: 'oauth', status: 'active', external_account_id: 'open-tt-1', external_account_label: 'Brand on TikTok', last_check_ok: true });
  expect(row.oauth_scopes).toEqual(['user.info.basic', 'video.list', 'video.publish', 'video.upload']);
  expect(Date.parse(row.token_expires_at) - Date.now()).toBeGreaterThan(86000 * 1000);
  expect(Date.parse(row.refresh_expires_at) - Date.now()).toBeGreaterThan(360 * DAY);
  expect(secretsOf(db, row)).toEqual({ access_token: 'act.tt-1', refresh_token: 'rft.tt-1' });
  const everything = JSON.stringify([cb.head, cb.payload, conns(db), db.table('workspace_connection_secrets'), db.table('oauth_authorization_states')]);
  expect(everything).not.toContain('act.tt-1');
  expect(everything).not.toContain('rft.tt-1');
});

test('Pinterest: client credentials as HTTP Basic, never in the form; YouTube: offline consent and PKCE, the verifier sent at the exchange', async () => {
  const { db, seen } = world();
  const p = await connRouter('oauth-start', { token: 'tok-a', method: 'POST', body: { provider: 'pinterest' } });
  const pu = new URL(p.payload.url);
  expect(pu.origin + pu.pathname).toBe('https://www.pinterest.com/oauth/');
  expect(pu.searchParams.get('client_id')).toBe('pin-app');
  expect(pu.searchParams.get('scope')).toBe('boards:read,pins:read,ads:read');
  const pcb = await connRouter('oauth-callback', { method: 'GET', query: { provider: 'pinterest', state: p.payload.state, code: 'pin-code' } });
  expect(pcb.head.Location).toBe('/connections?oauth=connected&provider=pinterest');
  const pex = seen.pinterest.find((c) => c.path === '/v5/oauth/token');
  expect(pex.headers.authorization).toBe('Basic ' + Buffer.from('pin-app:pin-secret').toString('base64'));
  expect(Object.fromEntries(new URLSearchParams(pex.sent).entries())).toEqual({ grant_type: 'authorization_code', code: 'pin-code', redirect_uri: CALLBACK + 'pinterest' });
  const prow = conns(db).find((c) => c.provider === 'pinterest');
  expect(secretsOf(db, prow)).toEqual({ access_token: 'pina_1', refresh_token: 'pinr_1' });
  expect(Date.parse(prow.refresh_expires_at) - Date.now()).toBeGreaterThan(59 * DAY);

  const y = await connRouter('oauth-start', { token: 'tok-a', method: 'POST', body: { provider: 'youtube', scopes: ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.upload'] } });
  const yu = new URL(y.payload.url);
  expect(yu.origin + yu.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(yu.searchParams.get('access_type'), 'without offline + consent Google returns no refresh token').toBe('offline');
  expect(yu.searchParams.get('prompt')).toBe('consent');
  expect(yu.searchParams.get('code_challenge_method')).toBe('S256');
  const state = db.table('oauth_authorization_states').find((r) => r.provider === 'youtube');
  const ycb = await connRouter('oauth-callback', { method: 'GET', query: { provider: 'youtube', state: y.payload.state, code: 'g-code' } });
  expect(ycb.head.Location).toBe('/connections?oauth=connected&provider=youtube');
  const yex = new URLSearchParams(seen.google.find((c) => c.method === 'POST').sent);
  expect(yex.get('code_verifier')).toBe(state.code_verifier);
  expect(yex.get('client_id')).toBe('yt-client');
  const yrow = conns(db).find((c) => c.provider === 'youtube');
  expect(yrow).toMatchObject({ external_account_id: 'UC-brand', external_account_label: 'Brand Channel' });
  expect(secretsOf(db, yrow)).toEqual({ access_token: 'ya29.yt-1', refresh_token: '1//yt-refresh-1' });
});

test('TikTok Ads has no sign-in to start: its advertiser authorisation URL was not confirmed, so nothing is written and nothing is called', async () => {
  const { db } = world();
  const r = await connRouter('oauth-start', { token: 'tok-a', method: 'POST', body: { provider: 'tiktok_ads' } });
  expect(r.code).toBe(400);
  expect(r.payload.message).toMatch(/does not use OAuth/);
  expect(db.table('oauth_authorization_states')).toHaveLength(0);
  expect(db.external()).toHaveLength(0);
});

/* ═══ 2. token refresh, from the cron path ══════════════════════════════ */

test('the daily refresh renews every token due within 7 days through each platform\'s own flow, marks a refused one needs_reauth, and leaves the rest alone', async () => {
  const { db, seen } = world({ pinterestRefresh: 'revoked' });
  const tt = connect(db, 'tiktok', { access_token: 'act.tt-1', refresh_token: 'rft.tt-1' }, { expiresInMs: 2 * DAY, account: 'open-tt-1' });
  const pin = connect(db, 'pinterest', { access_token: 'pina_1', refresh_token: 'pinr_1' }, { expiresInMs: 3 * DAY });
  const yt = connect(db, 'youtube', { access_token: 'ya29.yt-1', refresh_token: '1//yt-refresh-1' }, { expiresInMs: 10 * DAY });
  const meta = connect(db, 'meta_ads', { access_token: 'meta-old' }, { ws: 'ws-b', expiresInMs: 1 * DAY });

  const out = await gateway.refreshDueTokens({ withinDays: 7 });
  expect(out).toMatchObject({ ok: true, due: 3, refreshed: 2, needs_reauth: 1, retry: 0, window_days: 7 });

  // TikTok: grant_type=refresh_token with client_key, and the NEW refresh token kept.
  const ref = new URLSearchParams(seen.tiktok.find((c) => c.path === '/v2/oauth/token/').sent);
  expect(Object.fromEntries(ref.entries())).toEqual({ client_key: 'tt-client-key', client_secret: 'tt-client-secret', grant_type: 'refresh_token', refresh_token: 'rft.tt-1' });
  expect(secretsOf(db, tt)).toEqual({ access_token: 'act.tt-2', refresh_token: 'rft.tt-2' });
  const ttRow = conns(db).find((c) => c.id === tt.id);
  expect(ttRow).toMatchObject({ status: 'active', refresh_failure_count: 0, last_check_ok: true });
  expect(Date.parse(ttRow.token_expires_at) - Date.now()).toBeGreaterThan(86000 * 1000);

  // Meta: the long-lived exchange, the only extension Meta has.
  const metaCall = seen.meta.find((c) => c.path === '/v25.0/oauth/access_token');
  expect(metaCall.query).toMatchObject({ grant_type: 'fb_exchange_token', client_id: 'meta-app', fb_exchange_token: 'meta-old' });
  expect(secretsOf(db, meta)).toEqual({ access_token: 'meta-extended-2' });

  // Pinterest refused: needs_reauth, said in words, and the stored token untouched.
  const pinRow = conns(db).find((c) => c.id === pin.id);
  expect(pinRow).toMatchObject({ status: 'needs_reauth', refresh_failure_count: 1, last_check_ok: false });
  expect(pinRow.last_check_note).toMatch(/Pinterest could not be refreshed: .*Reconnect it on the Publishing page/);
  expect(secretsOf(db, pin)).toEqual({ access_token: 'pina_1', refresh_token: 'pinr_1' });

  // YouTube is not due: no call to Google at all.
  expect(seen.google).toHaveLength(0);
  expect(conns(db).find((c) => c.id === yt.id).last_refresh_at).toBeUndefined();

  // The hub says it, and the send path will not spend a refresh on it.
  const st = await gw('status');
  const pinView = st.payload.platforms.find((x) => x.id === 'pinterest');
  expect(pinView).toMatchObject({ connected: true, status: 'needs_reauth', can_write_now: false });
  expect(pinView.next[0]).toMatch(/Pinterest needs to be reconnected/);
  const fresh = await require(path.join(ROOT, 'api', '_shared', 'oauth-core.js')).ensureFreshToken('ws-a', 'pinterest');
  expect(fresh).toMatchObject({ ok: false, reconnect_required: true });

  // A second run finds nothing new to do for the refused one.
  db.clearCalls();
  const again = await gateway.refreshDueTokens({ withinDays: 7 });
  expect(again.results.map((r) => r.provider)).not.toContain('pinterest');
});

test('a platform that did not answer the refresh is retried on the next run, not condemned to needs_reauth', async () => {
  const { db } = world({ tiktokRefresh: 'down' });
  const tt = connect(db, 'tiktok', { access_token: 'act.tt-1', refresh_token: 'rft.tt-1' }, { expiresInMs: 1 * DAY });
  const out = await gateway.refreshDueTokens();
  expect(out).toMatchObject({ due: 1, refreshed: 0, needs_reauth: 0, retry: 1 });
  const row = conns(db).find((c) => c.id === tt.id);
  expect(row).toMatchObject({ status: 'active', refresh_failure_count: 1, last_check_ok: false });
  expect(row.last_check_note).toMatch(/will be retried/);
  expect(secretsOf(db, tt)).toEqual({ access_token: 'act.tt-1', refresh_token: 'rft.tt-1' });
});

test('with no store or no key the refresh says why and touches nothing', async () => {
  const { db } = world();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  expect(await gateway.refreshDueTokens()).toMatchObject({ ok: false, skipped: true });
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  delete process.env.CONNECTION_SECRET_KEY;
  expect(await gateway.refreshDueTokens()).toMatchObject({ ok: false, skipped: true });
  expect(db.calls).toHaveLength(0);
});

/* ═══ 3. reads ══════════════════════════════════════════════════════════ */

test('reads need LIVE_CONNECTORS and nothing else: Instagram media insights and Meta ad metrics, snapshots tied to the job and slot that made them, an absent metric left absent', async () => {
  const { db, seen } = world();
  connect(db, 'meta_ads', { access_token: 'meta-tok' }, { config: { ig_user_id: 'ig-1', page_id: 'page-1', ad_account_id: '123', publishing_enabled: false } });
  db.insert('dispatch_jobs', { workspace_id: 'ws-a', idempotency_key: 'k-m1', provider: 'meta', channel: 'instagram_feed', payload: {}, status: 'succeeded', external_id: 'm-1', asset_ref: 'slot-7', scheduled_for: '2026-10-10T09:00:00.000Z', attempt_count: 1, max_attempts: 5, next_attempt_at: nowIso() });

  // Switch off: the exact read, with the token redacted, and no call made.
  let r = await gw('read', { query: { provider: 'meta', kind: 'post_metrics', ids: 'm-1' } });
  expect(r.code).toBe(200);
  expect(r.payload).toMatchObject({ ok: false, live: false, connected: true, provider: 'meta', kind: 'post_metrics' });
  expect(r.payload.would_request.url).toContain(`${GRAPH}/m-1/insights?`);
  expect(r.payload.would_request.url).toContain('access_token=%5Bredacted%5D');
  expect(JSON.stringify(r.payload)).not.toContain('meta-tok');
  expect(platformCalls(db)).toHaveLength(0);

  // On - and the workspace publishing toggle and META_ALLOW_WRITES are still off: a read needs neither.
  live();
  r = await gw('read', { query: { provider: 'meta', kind: 'post_metrics', ids: 'm-1,m-2' } });
  expect(r.payload.ok).toBe(true);
  expect(r.payload.metrics).toEqual([
    { external_id: 'm-1', kind: 'organic', surface: 'instagram', values: { reach: 120, likes: 9, views: 300 } },
    { external_id: 'm-2', kind: 'organic', surface: 'instagram', values: { reach: 120, likes: 9, views: 300 } },
  ]);
  const insight = seen.meta.find((c) => c.path === '/v25.0/m-1/insights');
  expect(insight.method).toBe('GET');
  expect(insight.query.metric).toBe('reach,likes,comments,views');
  expect(insight.query.access_token).toBe('meta-tok');
  expect(insight.query.appsecret_proof).toBe(crypto.createHmac('sha256', 'meta-app-secret').update('meta-tok').digest('hex'));
  expect(r.payload.snapshots).toEqual({ stored: 2 });
  const snap = db.table('social_metric_snapshots').find((s) => s.external_id === 'm-1');
  expect(snap).toMatchObject({ workspace_id: 'ws-a', provider: 'meta', kind: 'organic', surface: 'instagram', asset_ref: 'slot-7', slot_date: '2026-10-10', metrics: { reach: 120, likes: 9, views: 300 } });
  expect(snap.job_id).toBe(jobs(db)[0].id);
  expect(db.table('platform_sync_log').find((l) => l.operation === 'read:post_metrics')).toMatchObject({ workspace_id: 'ws-a', provider: 'meta', direction: 'inbound', ok: true, records: 2 });

  r = await gw('read', { query: { provider: 'meta', kind: 'ad_metrics' } });
  expect(r.payload.rows).toEqual([
    { external_id: 'ad-1', name: 'Grail drop A', kind: 'paid', values: { spend: 120.5, impressions: 10000, clicks: 150, ctr: 1.5, roas: 2.4 }, period: { start: null, stop: null } },
    // Meta returned no purchase_roas for this ad: there is no ROAS, not a ROAS of 0.
    { external_id: 'ad-2', name: 'Grail drop B', kind: 'paid', values: { spend: 80, impressions: 9000, clicks: 45, ctr: 0.5 }, period: { start: null, stop: null } },
  ]);
  const adq = seen.meta.find((c) => c.path === '/v25.0/act_123/insights').query;
  expect(adq).toMatchObject({ level: 'ad', fields: 'ad_id,ad_name,spend,impressions,clicks,ctr,purchase_roas,date_start,date_stop', date_preset: 'last_30d' });

  // A viewer reads; another brand's member cannot read this one.
  expect((await gw('read', { auth: AUTH_V, query: { provider: 'meta', kind: 'ad_metrics' } })).payload.ok).toBe(true);
  const other = await gw('read', { auth: AUTH_B, query: { provider: 'meta', kind: 'ad_metrics' } });
  expect(other.code).toBe(404);
});

test('TikTok counts (a POST the docs call a read), YouTube comments and Pinterest Pin analytics read with no publish switch on; a platform not connected says so and calls nothing', async () => {
  const { db, seen } = world();
  connect(db, 'tiktok', { access_token: 'act.tt-1' });
  connect(db, 'youtube', { access_token: 'ya29.yt-1' });
  connect(db, 'pinterest', { access_token: 'pina_1' });
  live();

  const tt = await gw('read', { query: { provider: 'tiktok', kind: 'post_metrics', ids: 'v1,v2' } });
  expect(tt.payload.metrics).toEqual([
    { external_id: 'v1', kind: 'organic', surface: 'tiktok', values: { views: 1000, likes: 50, comments: 5 } },
    { external_id: 'v2', kind: 'organic', surface: 'tiktok', values: { views: 2000, likes: 100, comments: 5, shares: 2 } },
  ]);
  const q = seen.tiktok.find((c) => c.path === '/v2/video/query/');
  expect(q.method).toBe('POST');
  expect(q.query.fields).toBe('id,like_count,comment_count,share_count,view_count');
  expect(q.sent).toEqual({ filters: { video_ids: ['v1', 'v2'] } });

  const yt = await gw('read', { query: { provider: 'youtube', kind: 'comments', object_id: 'yt-vid-9' } });
  expect(yt.payload.comments).toEqual([{ id: 'thr-1', text: 'Is this a one-of-one?', at: '2026-10-02T09:00:00Z', object_id: 'yt-vid-9', surface: 'youtube' }]);
  expect(seen.youtube[0].query).toEqual({ part: 'snippet', videoId: 'yt-vid-9', maxResults: '20', textFormat: 'plainText' });

  const pin = await gw('read', { query: { provider: 'pinterest', kind: 'post_metrics', ids: 'pin-1' } });
  expect(pin.payload.metrics).toEqual([{ external_id: 'pin-1', kind: 'organic', surface: 'pinterest', values: { impressions: 400, saves: 12, outbound_clicks: 7 } }]);
  const pq = seen.pinterest.find((c) => c.path === '/v5/pins/pin-1/analytics').query;
  expect(pq.metric_types).toBe('ALL');
  expect(pq.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // TikTok documents no comment read: said, not answered empty.
  const none = await gw('read', { query: { provider: 'tiktok', kind: 'comments', object_id: 'v1' } });
  expect(none.payload).toMatchObject({ ok: false, supported: false });

  db.clearCalls();
  const notConnected = await gw('read', { auth: AUTH_B, ws: 'ws-b', query: { provider: 'youtube', kind: 'post_metrics', ids: 'x' } });
  expect(notConnected.payload).toMatchObject({ ok: false, connected: false });
  expect(notConnected.payload.note).toMatch(/YouTube is not connected on this brand/);
  expect(db.external()).toHaveLength(0);
});

/* ═══ 4. every write, blocked by EACH missing switch ════════════════════ */

const ORGANIC = [
  {
    name: 'a Facebook Page feed post', provider: 'meta_ads', adapter: 'meta', channel: 'facebook_page_feed',
    secrets: { access_token: 'meta-tok' }, config: { page_id: 'page-1' }, scopes: ['pages_manage_posts', 'pages_read_engagement'],
    asset: { message: 'Hand-painted, one of one.', link: 'https://brand.example/p/1' },
    sentTo: '/v25.0/page-1/feed', sentBody: { published: true, message: 'Hand-painted, one of one.', link: 'https://brand.example/p/1' }, externalId: 'page-1_post_1',
  },
  {
    name: 'a TikTok direct post', provider: 'tiktok', adapter: 'tiktok', channel: 'tiktok_video_post',
    secrets: { access_token: 'act.tt-1' }, config: {}, scopes: ['video.publish'],
    asset: { video_url: `${MEDIA}/clip.mp4`, caption: 'One of one #grail', privacy_level: 'SELF_ONLY', brand_content_toggle: false },
    sentTo: '/v2/post/publish/video/init/', sentBody: { post_info: { title: 'One of one #grail', privacy_level: 'SELF_ONLY', brand_content_toggle: false }, source_info: { source: 'PULL_FROM_URL', video_url: `${MEDIA}/clip.mp4` } }, externalId: 'v_pub_url~v2.1',
  },
  {
    name: 'a TikTok draft to the creator\'s inbox', provider: 'tiktok', adapter: 'tiktok', channel: 'tiktok_video_draft',
    secrets: { access_token: 'act.tt-1' }, config: {}, scopes: ['video.upload'],
    asset: { video_url: `${MEDIA}/clip.mp4` },
    sentTo: '/v2/post/publish/inbox/video/init/', sentBody: { source_info: { source: 'PULL_FROM_URL', video_url: `${MEDIA}/clip.mp4` } }, externalId: 'v_inbox_url~v2.1',
  },
  {
    name: 'a Pinterest Pin', provider: 'pinterest', adapter: 'pinterest', channel: 'pinterest_pin',
    secrets: { access_token: 'pina_1' }, config: { board_id: 'board-9' }, scopes: ['boards:read', 'boards:write', 'pins:read', 'pins:write'],
    asset: { image_url: `${MEDIA}/pin.jpg`, title: 'Grail rotation', description: 'Hand-painted on original pairs.', link: 'https://brand.example/p/2' },
    sentTo: '/v5/pins', sentBody: { board_id: 'board-9', media_source: { source_type: 'image_url', url: `${MEDIA}/pin.jpg` }, title: 'Grail rotation', description: 'Hand-painted on original pairs.', link: 'https://brand.example/p/2' }, externalId: 'pin-new-1',
  },
  {
    name: 'a YouTube upload', provider: 'youtube', adapter: 'youtube', channel: 'youtube_video_upload',
    secrets: { access_token: 'ya29.yt-1' }, config: {}, scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    asset: { video_url: `${MEDIA}/clip.mp4`, title: 'One of one', contains_synthetic_media: false },
    sentTo: '/upload/youtube/v3/videos', sentBody: { snippet: { title: 'One of one' }, status: { privacyStatus: 'private', containsSyntheticMedia: false } }, externalId: 'yt-vid-1',
  },
  {
    name: 'an Instagram comment reply', provider: 'meta_ads', adapter: 'meta', channel: 'instagram_comment_reply',
    secrets: { access_token: 'meta-tok' }, config: {}, scopes: ['instagram_manage_comments'],
    asset: { comment_id: 'c-1', message: 'Size 9 is in the next drop.' },
    sentTo: '/v25.0/c-1/replies', sentBody: { message: 'Size 9 is in the next drop.' }, externalId: 'reply-1',
  },
  {
    name: 'a YouTube comment reply', provider: 'youtube', adapter: 'youtube', channel: 'youtube_comment_reply',
    secrets: { access_token: 'ya29.yt-1' }, config: {}, scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    asset: { comment_id: 'thr-1', message: 'Yes: one of one.' },
    sentTo: '/youtube/v3/comments', sentBody: { snippet: { parentId: 'thr-1', textOriginal: 'Yes: one of one.' } }, externalId: 'yt-reply-1',
  },
];

for (const c of ORGANIC) {
  test(`${c.name} is blocked by each missing switch on its own, showing the exact request and calling nothing; with all three it is sent`, async () => {
    const sw = SWITCH[c.adapter];
    const cases = [
      { missing: 'live_connectors_off', publishing: true, env: () => { process.env[sw] = '1'; }, says: /LIVE_CONNECTORS/ },
      { missing: 'workspace_publishing_off', publishing: false, env: () => live(sw), says: /not enabled live publishing/ },
      { missing: 'platform_writes_off', publishing: true, env: () => live(), says: new RegExp(`${sw}=1`) },
    ];
    for (const k of cases) {
      baseEnv();
      const { db } = world();
      connect(db, c.provider, c.secrets, { config: Object.assign({ publishing_enabled: k.publishing }, c.config), scopes: c.scopes });
      k.env();
      const out = await dispatch.enqueue(AUTH_A, 'ws-a', { channel: c.channel, asset: c.asset, asset_ref: 'slot-1' });
      expect(out.ok, `${c.channel} enqueue: ${JSON.stringify(out.preflight && out.preflight.blocking)}`).toBe(true);
      await drain();
      const job = jobs(db)[0];
      expect(job.status, `${c.channel} with ${k.missing}`).toBe('blocked');
      expect(job.last_error).toMatch(k.says);
      expect(job.result.blocked_by).toBe(k.missing);
      expect(job.result.would_request.method).not.toBe('GET');
      expect(job.result.would_request.url).toContain(c.sentTo);
      expect(job.result.would_request.body).toEqual(c.sentBody);
      expect(platformCalls(db), `${c.channel}: nothing may reach the platform with ${k.missing}`).toHaveLength(0);
      expect(db.external().filter((x) => x.url.startsWith(MEDIA)), 'no media is fetched for a write that may not happen').toHaveLength(0);
      expect(JSON.stringify(job.result)).not.toContain(c.secrets.access_token);
    }

    baseEnv();
    const { db, seen } = world();
    connect(db, c.provider, c.secrets, { config: Object.assign({ publishing_enabled: true }, c.config), scopes: c.scopes });
    live(sw);
    await dispatch.enqueue(AUTH_A, 'ws-a', { channel: c.channel, asset: c.asset, asset_ref: 'slot-1' });
    await drain();
    const job = jobs(db)[0];
    expect(job.status, JSON.stringify(job.result)).toBe('succeeded');
    expect(job.external_id).toBe(c.externalId);
    const all = [].concat(seen.meta, seen.tiktok, seen.pinterest, seen.youtube);
    const sent = all.find((x) => x.path === c.sentTo && x.method !== 'GET');
    expect(sent, `${c.channel} reached ${c.sentTo}`).toBeTruthy();
    expect(sent.sent).toEqual(c.sentBody);
  });
}

test('a TikTok direct post asks creator_info first, and a privacy level this creator does not allow is refused before anything is posted', async () => {
  const { db, seen } = world();
  connect(db, 'tiktok', { access_token: 'act.tt-1' }, { config: { publishing_enabled: true }, scopes: ['video.publish'] });
  live('TIKTOK_ALLOW_WRITES');
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'tiktok_video_post', asset: { video_url: `${MEDIA}/clip.mp4`, caption: 'x', privacy_level: 'FOLLOWER_OF_CREATOR', brand_content_toggle: false } });
  await drain();
  expect(jobs(db)[0].status).toBe('failed');
  expect(jobs(db)[0].last_error).toMatch(/allows PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, SELF_ONLY; the asset asked for FOLLOWER_OF_CREATOR/);
  expect(seen.tiktok.map((x) => x.path)).toEqual(['/v2/post/publish/creator_info/query/']);

  // A disclosure the asset did not make is a gap the preflight blocks on, never a default.
  const gap = await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'tiktok_video_post', asset: { video_url: `${MEDIA}/clip.mp4`, caption: 'y' } });
  expect(gap.blocked).toBe(true);
  expect(gap.message).toMatch(/DATA REQUIRED BEFORE LAUNCH: brand_content_toggle/);
});

/* ═══ 5. paid drafts, and the live approval that turns them on ═════════ */

test('paid writes are created PAUSED (Meta ad, Pinterest campaign) or refused unverified with DISABLE in the request (TikTok Ads); nothing is created spending', async () => {
  const { db, seen } = world();
  connect(db, 'meta_ads', { access_token: 'meta-tok' }, { config: { publishing_enabled: true, ad_account_id: '123', page_id: 'page-1' }, scopes: ['ads_management'] });
  connect(db, 'pinterest', { access_token: 'pina_1' }, { config: { publishing_enabled: true, ad_account_id: '549' }, scopes: ['ads:write'] });
  connect(db, 'tiktok_ads', { access_token: 'tt-biz-token' }, { config: { publishing_enabled: true, advertiser_id: 'adv-1' } });
  live('META_ALLOW_WRITES', 'PINTEREST_ALLOW_WRITES', 'TIKTOK_ALLOW_WRITES');

  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'meta_ad', skip_mapping: true, asset_ref: 'slot-ad', payload: { caption: 'Hand-painted grails.', image_url: `${MEDIA}/a.jpg`, link: 'https://brand.example/p/1', headline: 'Grails', ad_account_id: '123', page_id: 'page-1', ad_set_id: 'adset-9' } });
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'pinterest_campaign_draft', asset: { name: 'Fall grails', objective_type: 'AWARENESS' }, asset_ref: 'slot-pin' });
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'tiktok_ads_ad', asset: { adgroup_id: 'ag-1', ad_text: 'Hand-painted grails.', video_id: 'vid-1' }, asset_ref: 'slot-tt' });
  await drain();

  const byChannel = (ch) => jobs(db).find((j) => j.channel === ch);
  const metaAd = seen.meta.find((c) => c.path === '/v25.0/act_123/ads');
  expect(metaAd.sent).toMatchObject({ adset_id: 'adset-9', creative: { creative_id: 'creative-1' }, status: 'PAUSED' });
  expect(byChannel('meta_ad')).toMatchObject({ status: 'succeeded', external_id: 'ad-new-1', external_status: 'paused' });

  const pinCamp = seen.pinterest.find((c) => c.path === '/v5/ad_accounts/549/campaigns');
  expect(pinCamp.sent, 'Pinterest creates a campaign ACTIVE when no status is sent').toEqual([{ name: 'Fall grails', objective_type: 'AWARENESS', status: 'PAUSED' }]);
  expect(byChannel('pinterest_campaign_draft')).toMatchObject({ status: 'succeeded', external_id: 'pcamp-1', external_status: 'paused' });

  const ttAd = byChannel('tiktok_ads_ad');
  expect(ttAd.status).toBe('blocked');
  expect(ttAd.result).toMatchObject({ endpoint_unverified: true, sent: false });
  expect(ttAd.result.would_request.url).toBe('https://business-api.tiktok.com/open_api/v1.3/ad/create/');
  expect(ttAd.result.would_request.body.creatives[0].operation_status).toBe('DISABLE');
  expect(seen.tiktok_ads, 'an unverified endpoint is never called').toHaveLength(0);
});

test('Google Ads: ad metrics read over the documented searchStream with LIVE_CONNECTORS alone (no ROAS invented, an absent cost left absent); a responsive search ad needs GOOGLE_ADS_ALLOW_WRITES and is created PAUSED', async () => {
  const { db, seen } = world();
  const gads = { access_token: 'ya29.gads-1', refresh_token: '1//gads', developer_token: 'dev-tok-1' };
  connect(db, 'google_ads', gads, { config: { customer_id: '111-222-3333', publishing_enabled: true }, scopes: ['https://www.googleapis.com/auth/adwords'] });

  live();   // LIVE_CONNECTORS only: the publish toggle is on, GOOGLE_ADS_ALLOW_WRITES is not, and a read needs neither
  const r = await gw('read', { query: { provider: 'google_ads', kind: 'ad_metrics' } });
  expect(r.payload.ok, JSON.stringify(r.payload)).toBe(true);
  expect(r.payload.rows).toEqual([
    { external_id: '901', kind: 'paid', status: 'ENABLED', values: { spend: 12.5, impressions: 5145, clicks: 91, ctr: 0.0177 } },
    { external_id: '902', kind: 'paid', status: 'PAUSED', values: { impressions: 2000, clicks: 10, ctr: 0.005 } },
  ]);
  for (const row of r.payload.rows) expect(row.values, 'Google ROAS is not read, so it is absent, never computed').not.toHaveProperty('roas');
  const q = seen.google_ads[0];
  expect(q.method).toBe('POST');
  expect(q.path).toMatch(/^\/v\d+\/customers\/1112223333\/googleAds:searchStream$/);
  expect(q.headers['developer-token']).toBe('dev-tok-1');
  expect(q.sent).toEqual({ query: 'SELECT ad_group_ad.ad.id, ad_group_ad.status, metrics.impressions, metrics.clicks, metrics.ctr, metrics.cost_micros FROM ad_group_ad WHERE segments.date DURING LAST_30_DAYS' });
  expect(r.payload.snapshots).toEqual({ stored: 2 });
  // A range the docs read here did not show is refused, not composed.
  const custom = await gw('read', { query: { provider: 'google_ads', kind: 'ad_metrics', since: '2026-09-01', until: '2026-09-30' } });
  expect(custom.payload).toMatchObject({ ok: false, supported: false });
  expect(seen.google_ads).toHaveLength(1);

  const payload = { customer_id: '1112223333', ad_group_id: '7', final_url: 'https://brand.example/p/1',
    headlines: ['Hand-painted grails', 'One of one pairs', 'Painted to order'], descriptions: ['Custom pairs painted by hand.', 'Shipped worldwide.'] };
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'google_search_ad', skip_mapping: true, asset_ref: 'slot-g', payload, idempotency_key: 'g-1' });
  await drain();
  const blocked = jobs(db).find((j) => j.idempotency_key === 'g-1');
  expect(blocked.status).toBe('blocked');
  expect(blocked.result.blocked_by).toBe('platform_writes_off');
  expect(blocked.last_error).toMatch(/GOOGLE_ADS_ALLOW_WRITES=1/);
  expect(blocked.result.would_request.body.operations[0].create.status).toBe('PAUSED');
  expect(seen.google_ads.filter((c) => /adGroupAds:mutate/.test(c.path)), 'nothing created with the switch off').toHaveLength(0);
  expect(JSON.stringify(blocked.result)).not.toContain('ya29.gads-1');

  live('GOOGLE_ADS_ALLOW_WRITES');
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'google_search_ad', skip_mapping: true, asset_ref: 'slot-g', payload, idempotency_key: 'g-2' });
  await drain();
  const made = seen.google_ads.find((c) => /adGroupAds:mutate$/.test(c.path));
  expect(made.sent.operations[0].create.status, 'a Google ad is created PAUSED; turning it on is a person\'s decision').toBe('PAUSED');
  expect(jobs(db).find((j) => j.idempotency_key === 'g-2')).toMatchObject({ status: 'succeeded', external_id: 'customers/1112223333/adGroupAds/7~903' });
});

test('LIVE APPROVAL is its own job: stamped with the operator who gave it (whatever the request claims), behind the three switches, and it sets the paused Meta ad ACTIVE', async () => {
  const { db, seen } = world();
  connect(db, 'meta_ads', { access_token: 'meta-tok' }, { config: { publishing_enabled: true, ad_account_id: '123' }, scopes: ['ads_management'] });
  const draft = db.insert('dispatch_jobs', { workspace_id: 'ws-a', idempotency_key: 'k-ad', provider: 'meta', channel: 'meta_ad', payload: {}, status: 'succeeded', external_id: 'ad-new-1', external_status: 'paused', asset_ref: 'slot-ad', attempt_count: 1, max_attempts: 5, next_attempt_at: nowIso() });
  const post = db.insert('dispatch_jobs', { workspace_id: 'ws-a', idempotency_key: 'k-post', provider: 'tiktok', channel: 'tiktok_video_post', payload: {}, status: 'succeeded', external_id: 'v_pub', attempt_count: 1, max_attempts: 5, next_attempt_at: nowIso() });

  // A viewer cannot approve spend.
  expect((await gw('live-approve', { auth: AUTH_V, body: { job_id: draft.id } })).code).toBe(403);
  // Only a paid draft has a live step.
  const notDraft = await gw('live-approve', { body: { job_id: post.id } });
  expect(notDraft.code).toBe(409);
  expect(notDraft.payload.error).toBe('not_a_draft');
  // Another brand's job is not this brand's to approve.
  expect((await gw('live-approve', { auth: AUTH_B, ws: 'ws-b', body: { job_id: draft.id } })).payload.error).toBe('job_not_found');

  const ok = await gw('live-approve', { body: { job_id: draft.id, approved_by: 'someone-else', note: 'Budget signed off.' } });
  expect(ok.code).toBe(200);
  expect(ok.payload).toMatchObject({ ok: true, approved_by: 'user-a', source_job_id: draft.id, live_channel: 'meta_live_approval' });
  const approval = jobs(db).find((j) => j.channel === 'meta_live_approval');
  expect(approval).toMatchObject({ created_by: 'user-a', idempotency_key: `live:${draft.id}`, asset_ref: 'slot-ad', status: 'queued' });
  expect(approval.payload).toMatchObject({ external_id: 'ad-new-1', approved_by: 'user-a', source_job_id: draft.id, note: 'Budget signed off.' });
  expect((await gw('live-approve', { body: { job_id: draft.id } })).payload.deduped, 'approving twice is one approval').toBe(true);

  // With the deployment switch off the approval stops, showing the exact update.
  live();
  await drain();
  let a = jobs(db).find((j) => j.channel === 'meta_live_approval');
  expect(a.status).toBe('blocked');
  expect(a.result.blocked_by).toBe('platform_writes_off');
  expect(a.result.would_request).toMatchObject({ method: 'POST', body: { status: 'ACTIVE' } });
  expect(seen.meta).toHaveLength(0);

  // All three on: a fresh approval job is sent.
  db.tables.dispatch_jobs = jobs(db).filter((j) => j.channel !== 'meta_live_approval');
  live('META_ALLOW_WRITES');
  await gw('live-approve', { body: { job_id: draft.id } });
  await drain();
  a = jobs(db).find((j) => j.channel === 'meta_live_approval');
  expect(a).toMatchObject({ status: 'succeeded', external_id: 'ad-new-1', external_status: 'active' });
  const activation = seen.meta.find((c) => c.path === '/v25.0/ad-new-1');
  expect(activation.method).toBe('POST');
  expect(activation.sent).toEqual({ status: 'ACTIVE' });
});

test('a live approval enqueued around the gateway still carries the session\'s operator, and one with no approver is refused by the adapter', async () => {
  const { db, seen } = world();
  connect(db, 'meta_ads', { access_token: 'meta-tok' }, { config: { publishing_enabled: true }, scopes: ['ads_management'] });
  live('META_ALLOW_WRITES');
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'meta_live_approval', skip_mapping: true, payload: { external_id: 'ad-x', approved_by: 'forged-operator' } });
  expect(jobs(db)[0].payload.approved_by).toBe('user-a');
  const MetaAdapter = registry.adapterFor('meta');
  const bare = await new MetaAdapter({ workspaceId: 'ws-a', credentials: { access_token: 't' }, publishEnabled: true }).dispatch('meta_live_approval', { external_id: 'ad-x' });
  expect(bare).toMatchObject({ ok: false, sent: false, error_class: 'validation' });
  expect(bare.error).toMatch(/operator who approved it/);
  expect(seen.meta).toHaveLength(0);
});

test('YouTube: uploaded PRIVATE through the resumable protocol, the media fetched only once every switch is on, and the live approval keeps every other status property', async () => {
  const { db, seen } = world();
  connect(db, 'youtube', { access_token: 'ya29.yt-1', refresh_token: '1//r' }, { config: { publishing_enabled: true }, scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl'] });
  live('YOUTUBE_ALLOW_WRITES');
  const asset = { video_url: `${MEDIA}/clip.mp4`, title: 'One of one', description: 'Hand-painted.', hashtags: ['#grail', '#custom'], self_declared_made_for_kids: false };
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'youtube_video_upload', asset, asset_ref: 'slot-yt' });
  await drain();
  const up = jobs(db)[0];
  expect(up, JSON.stringify(up.result)).toMatchObject({ status: 'succeeded', external_id: 'yt-vid-1', external_status: 'private' });

  const init = seen.youtube.find((c) => c.method === 'POST' && c.path === '/upload/youtube/v3/videos');
  expect(init.query).toEqual({ uploadType: 'resumable', part: 'snippet,status' });
  expect(init.sent).toEqual({ snippet: { title: 'One of one', description: 'Hand-painted.', tags: ['grail', 'custom'] }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } });
  expect(init.headers['x-upload-content-type']).toBe('video/mp4');
  expect(init.headers['x-upload-content-length']).toBe(String(Buffer.from('fake-mp4-bytes-0123456789').length));
  const put = seen.youtube.find((c) => c.method === 'PUT' && c.url === SESSION);
  expect(String(put.sent)).toBe('fake-mp4-bytes-0123456789');
  expect(seen.media).toHaveLength(1);

  const approve = await gw('live-approve', { body: { job_id: up.id } });
  expect(approve.payload.live_channel).toBe('youtube_live_approval');
  await drain();
  const a = jobs(db).find((j) => j.channel === 'youtube_live_approval');
  expect(a).toMatchObject({ status: 'succeeded', external_status: 'public' });
  const update = seen.youtube.find((c) => c.method === 'PUT' && c.path === '/youtube/v3/videos');
  expect(update.query).toEqual({ part: 'status' });
  // videos.update DELETES what it is not sent: every writable property is carried, read-only ones are not.
  expect(update.sent).toEqual({ id: 'yt-vid-1', status: { embeddable: true, license: 'youtube', privacyStatus: 'public', publicStatsViewable: true, selfDeclaredMadeForKids: false } });
});

test('YouTube refuses a redirecting media URL before any upload, and never PUTs bytes to a session host YouTube does not own', async () => {
  let { db, seen } = world();
  connect(db, 'youtube', { access_token: 'ya29.yt-1' }, { config: { publishing_enabled: true } });
  live('YOUTUBE_ALLOW_WRITES');
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'youtube_video_upload', asset: { video_url: `${MEDIA}/redirect.mp4`, title: 'x' } });
  await drain();
  expect(jobs(db)[0].status).toBe('failed');
  expect(jobs(db)[0].last_error).toMatch(/redirects are not followed/);
  expect(seen.youtube).toHaveLength(0);

  ({ db, seen } = world({ sessionHost: 'https://upload.evil.example' }));
  connect(db, 'youtube', { access_token: 'ya29.yt-1' }, { config: { publishing_enabled: true } });
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'youtube_video_upload', asset: { video_url: `${MEDIA}/clip.mp4`, title: 'x' } });
  await drain();
  expect(jobs(db)[0].status).toBe('failed');
  expect(jobs(db)[0].last_error).toMatch(/no upload session on its own upload host/);
  expect(seen.youtube.filter((c) => c.method === 'PUT')).toHaveLength(0);
});

test('comment moderation reaches the documented calls: Instagram hide=true as a query parameter, YouTube setModerationStatus rejected', async () => {
  const { db, seen } = world();
  connect(db, 'meta_ads', { access_token: 'meta-tok' }, { config: { publishing_enabled: true }, scopes: ['instagram_manage_comments'] });
  connect(db, 'youtube', { access_token: 'ya29.yt-1' }, { config: { publishing_enabled: true } });
  live('META_ALLOW_WRITES', 'YOUTUBE_ALLOW_WRITES');
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'instagram_comment_moderation', asset: { comment_id: 'c-9', action: 'hide' } });
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'youtube_comment_moderation', asset: { comment_id: 'yc-9', action: 'reject' } });
  await drain();
  expect(jobs(db).map((j) => j.status)).toEqual(['succeeded', 'succeeded']);
  const hide = seen.meta.find((c) => c.path === '/v25.0/c-9');
  expect(hide.method).toBe('POST');
  expect(hide.query.hide).toBe('true');
  const mod = seen.youtube.find((c) => c.path === '/youtube/v3/comments/setModerationStatus');
  expect(mod.query).toEqual({ id: 'yc-9', moderationStatus: 'rejected' });
});

/* ═══ 6. an unverified endpoint refuses, whatever the switches say ══════ */

test('every endpoint marked unverified refuses with the exact request and calls nothing, with every switch on', async () => {
  live(...ALL_SWITCHES);
  const called = [];
  global.fetch = async (url) => { called.push(String(url)); throw new Error(`an unverified endpoint escaped: ${url}`); };
  let checked = 0;
  for (const id of Object.keys(registry.ADAPTERS)) {
    const A = registry.ADAPTERS[id];
    for (const row of registry.endpointRows(A).filter((r) => !r.verified)) {
      const params = {};
      for (const m of String(row.url).matchAll(/\{([a-z_]+)\}/gi)) params[m[1]] = 'x';
      const out = await new A({ workspaceId: 'ws-a', credentials: { access_token: 'tok' }, connection: { config: { publishing_enabled: true } }, publishEnabled: true }).callEndpoint(row.op, { params, body: { probe: true } });
      expect(out, `${id}.${row.op}`).toMatchObject({ ok: false, sent: false, endpoint_unverified: true, error_class: 'blocked' });
      expect(out.would_request.method).toBe(row.method);
      checked += 1;
    }
  }
  expect(checked, 'TikTok Ads and Pinterest each carry unverified calls; the enumeration must find them').toBeGreaterThanOrEqual(5);
  expect(called).toEqual([]);
});

test('every verified gateway endpoint names the documentation page it was read on, on the platform\'s own docs host, and calls only the platform\'s own API host', () => {
  const DOCS = { meta: /developers\.facebook\.com/, tiktok: /developers\.tiktok\.com/, pinterest: /developers\.pinterest\.com/, youtube: /developers\.google\.com\/youtube/, google_ads: /developers\.google\.com\/google-ads/ };
  const HOSTS = { meta: ['graph.facebook.com'], tiktok: ['open.tiktokapis.com'], tiktok_ads: ['business-api.tiktok.com'], pinterest: ['api.pinterest.com'], youtube: ['www.googleapis.com'], google_ads: ['googleads.googleapis.com'] };
  for (const id of Object.keys(HOSTS)) {
    const rows = registry.endpointRows(registry.adapterFor(id));
    expect(rows.length, id).toBeGreaterThan(0);
    for (const r of rows) {
      expect(HOSTS[id], `${id}.${r.op} calls ${r.url}`).toContain(new URL(r.url.replace(/\{[a-z_]+\}/g, 'x')).host);
      expect(r.doc, `${id}.${r.op} must say where it came from`).toBeTruthy();
      if (r.verified && DOCS[id]) expect(r.doc, `${id}.${r.op}`).toMatch(DOCS[id]);
    }
  }
  const view = registry.registryView();
  for (const id of ['tiktok_ads', 'pinterest']) {
    const v = view.find((x) => x.id === id);
    expect(v.endpoints_verified, `${id} must admit its unverified calls in the hub`).toBe(false);
    expect(v.unverified_operations.length).toBeGreaterThan(0);
  }
  expect(view.find((x) => x.id === 'youtube').write_switch).toBe('YOUTUBE_ALLOW_WRITES');
  expect(view.find((x) => x.id === 'google_ads').write_switch).toBe('GOOGLE_ADS_ALLOW_WRITES');
});

/* ═══ 7. inbound webhooks ═══════════════════════════════════════════════ */

/** A delivery as it arrives: a stream of the exact bytes, never a parsed body. */
async function deliver(provider, bytes, headers) {
  const req = Readable.from([Buffer.from(bytes)]);
  req.method = 'POST';
  req.headers = headers || {};
  req.query = { action: 'dispatch-webhook', provider };
  const res = makeRes();
  const real = console.warn;
  console.warn = () => {};
  try { await webhooks.receive(req, res); } finally { console.warn = real; }
  return res;
}
const ttSign = (secret, t, raw) => `t=${t},s=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const metaSign = (secret, raw) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

test('TikTok: a delivery signed over "<t>.<raw body>" is recorded once under its event id, routed to the brand that connected the account, logged, and reconciles the job it names', async () => {
  const { db } = world();
  connect(db, 'tiktok', { access_token: 'act.tt-1' }, { account: 'open-tt-1' });
  db.insert('dispatch_jobs', { workspace_id: 'ws-a', idempotency_key: 'k-tt', provider: 'tiktok', channel: 'tiktok_video_post', payload: {}, status: 'succeeded', external_id: 'v_pub_url~v2.1', external_status: 'processing', attempt_count: 1, max_attempts: 5, next_attempt_at: nowIso() });
  // Pretty-printed on purpose: a verifier fed a re-serialisation would not match it.
  const raw = JSON.stringify({ client_key: 'tt-client-key', event: 'post.publish.complete', create_time: 1759500000, user_openid: 'open-tt-1', content: JSON.stringify({ publish_id: 'v_pub_url~v2.1', publish_type: 'DIRECT_PUBLISH' }) }, null, 2);
  const t = Math.floor(Date.now() / 1000);

  const r = await deliver('tiktok', raw, { 'tiktok-signature': ttSign('tt-client-secret', t, raw) });
  expect(r.code).toBe(200);
  expect(r.payload).toMatchObject({ ok: true, processed: true, verified: true, provider: 'tiktok', inbound: { recorded: true, routed: true } });
  const eventId = 'sha256:' + crypto.createHash('sha256').update(raw).digest('hex');
  const rows = db.table('social_inbound_events');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ provider: 'tiktok', event_id: eventId, workspace_id: 'ws-a', account_id: 'open-tt-1', event_type: 'post.publish.complete', kind: 'publish_status' });
  expect(rows[0].items[0]).toMatchObject({ kind: 'publish_status', object_id: 'v_pub_url~v2.1' });
  expect(jobs(db)[0].external_status).toBe('post.publish.complete');
  const log = db.table('platform_sync_log').filter((l) => l.direction === 'inbound');
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ workspace_id: 'ws-a', provider: 'tiktok', operation: 'webhook:post.publish.complete', ok: true, records: 1 });
  expect(db.table('platform_webhook_events')).toHaveLength(1);

  // The platform retries the same bytes: recorded once, not processed twice.
  const again = await deliver('tiktok', raw, { 'tiktok-signature': ttSign('tt-client-secret', t, raw) });
  expect(again.payload).toMatchObject({ ok: true, processed: false, duplicate: true, verified: true, event_id: eventId });
  expect(db.table('social_inbound_events')).toHaveLength(1);
  expect(db.table('platform_webhook_events')).toHaveLength(1);
  expect(db.table('platform_sync_log').filter((l) => l.direction === 'inbound')).toHaveLength(1);
});

test('TikTok: a forged signature, a tampered body, a stale timestamp, a missing header and a missing secret are each refused, and nothing is recorded', async () => {
  const { db } = world();
  connect(db, 'tiktok', { access_token: 'act.tt-1' }, { account: 'open-tt-1' });
  const raw = JSON.stringify({ event: 'post.publish.complete', user_openid: 'open-tt-1', content: '{"publish_id":"p1"}' });
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    ['forged', raw, { 'tiktok-signature': ttSign('not-the-secret', now, raw) }, 'signature_mismatch'],
    ['tampered', raw.replace('p1', 'p2'), { 'tiktok-signature': ttSign('tt-client-secret', now, raw) }, 'signature_mismatch'],
    ['stale', raw, { 'tiktok-signature': ttSign('tt-client-secret', now - 3600, raw) }, 'timestamp_out_of_tolerance'],
    ['no header', raw, {}, 'signature_header_missing'],
  ];
  for (const [name, bytes, headers, reason] of cases) {
    const r = await deliver('tiktok', bytes, headers);
    expect(r.code, name).toBe(200);
    expect(r.payload, name).toMatchObject({ ok: false, processed: false, verified: false, reason });
  }
  delete process.env.TIKTOK_CLIENT_SECRET;
  const noSecret = await deliver('tiktok', raw, { 'tiktok-signature': ttSign('tt-client-secret', now, raw) });
  expect(noSecret.payload.reason).toBe('secret_missing');
  expect(db.table('social_inbound_events')).toHaveLength(0);
  expect(db.table('platform_webhook_events')).toHaveLength(0);
  expect(db.table('platform_sync_log')).toHaveLength(0);
});

test('Meta: an Instagram comment delivery verified over the raw bytes is routed through the connection\'s Instagram account id; a forgery is refused; members read the inbox, other brands do not', async () => {
  const { db } = world();
  connect(db, 'meta_ads', { access_token: 'meta-tok' }, { config: { ig_user_id: '17841-ig', page_id: 'page-1' } });
  const raw = JSON.stringify({ object: 'instagram', entry: [{ id: '17841-ig', time: 1759500000, changes: [{ field: 'comments', value: { id: 'c-77', text: 'Need these in a 9', media: { id: 'm-1' } } }] }] }, null, 1);

  const forged = await deliver('meta', raw, { 'x-hub-signature-256': metaSign('not-the-secret', raw) });
  expect(forged.payload).toMatchObject({ processed: false, verified: false, reason: 'signature_mismatch' });
  expect(db.table('social_inbound_events')).toHaveLength(0);

  const r = await deliver('meta', raw, { 'x-hub-signature-256': metaSign('meta-app-secret', raw) });
  expect(r.payload).toMatchObject({ ok: true, processed: true, verified: true, inbound: { recorded: true, routed: true } });
  const row = db.table('social_inbound_events')[0];
  expect(row).toMatchObject({ provider: 'meta', workspace_id: 'ws-a', account_id: '17841-ig', event_type: 'comments', kind: 'comment' });
  expect(row.items).toEqual([{ kind: 'comment', field: 'comments', surface: 'instagram', account_id: '17841-ig', object_id: 'c-77', parent_id: 'm-1', text: 'Need these in a 9' }]);

  // An account no brand connected is kept for diagnosis and routed to nobody.
  const stray = JSON.stringify({ object: 'page', entry: [{ id: 'page-unknown', changes: [{ field: 'feed', value: { item: 'comment', comment_id: 'pc-1', post_id: 'p-1' } }] }] });
  const s = await deliver('meta', stray, { 'x-hub-signature-256': metaSign('meta-app-secret', stray) });
  expect(s.payload.inbound).toMatchObject({ recorded: true, routed: false });
  expect(db.table('social_inbound_events')[1].workspace_id).toBeNull();
  expect(db.table('platform_sync_log').filter((l) => l.direction === 'inbound')).toHaveLength(1);

  const inbox = await gw('inbox');
  expect(inbox.payload.events.map((e) => e.provider)).toEqual(['meta']);
  expect(inbox.payload.events[0].items[0].text).toBe('Need these in a 9');
  const theirs = await gw('inbox', { auth: AUTH_B, ws: 'ws-b' });
  expect(theirs.payload.events).toEqual([]);
});

test('Pinterest and YouTube deliveries are refused: no signature scheme was confirmed for either, so nothing is accepted unverified', async () => {
  const { db } = world();
  for (const provider of ['pinterest', 'youtube']) {
    const r = await deliver(provider, '{"anything":true}', { 'x-hub-signature': 'sha1=deadbeef' });
    expect(r.payload, provider).toMatchObject({ ok: false, processed: false, verified: false, reason: 'no_signature_scheme' });
  }
  expect(db.table('social_inbound_events')).toHaveLength(0);
});

/* ═══ 8. underperformance, against the brand's own data ═════════════════ */

test('a creative is flagged below the brand\'s OWN median (three or more) or the operator\'s OWN threshold; an absent metric is never a zero; no median under three', () => {
  const rows = [
    { provider: 'meta', kind: 'paid', external_id: 'ad-1', values: { ctr: 2.0, roas: 3 } },
    { provider: 'meta', kind: 'paid', external_id: 'ad-2', values: { ctr: 1.5 } },
    { provider: 'meta', kind: 'paid', external_id: 'ad-3', values: { ctr: 0.4, roas: 1.2 } },
    { provider: 'meta', kind: 'paid', external_id: 'ad-4', values: { ctr: 1.0, roas: 0.9 } },
    { provider: 'tiktok', kind: 'organic', surface: 'tiktok', external_id: 'v1', values: { views: 900 } },
    { provider: 'tiktok', kind: 'organic', surface: 'tiktok', external_id: 'v2', values: { views: 100 } },
  ];
  const out = gateway.computeUnderperformance(rows, { paid: { roas_min: 1.5 } });
  const key = (f) => `${f.external_id}:${f.metric}:${f.basis}`;
  expect(out.flags.map(key).sort()).toEqual([
    'ad-3:ctr:own_median', 'ad-3:roas:operator_threshold', 'ad-4:ctr:own_median', 'ad-4:roas:operator_threshold', 'ad-4:roas:own_median',
  ]);
  const ctr = out.groups.find((g) => g.metric === 'ctr');
  expect(ctr).toMatchObject({ available: true, median: 1.25, rows: 4 });
  // ad-2 reported no ROAS: it is not in the ROAS median and is not flagged.
  expect(out.groups.find((g) => g.metric === 'roas')).toMatchObject({ available: true, median: 1.2, rows: 3 });
  const tt = out.groups.find((g) => g.provider === 'tiktok');
  expect(tt).toMatchObject({ available: false, rows: 2 });
  expect(tt.reason).toMatch(/a median needs at least 3/);
  const f = out.flags.find((x) => x.external_id === 'ad-4' && x.basis === 'own_median' && x.metric === 'ctr');
  expect(f.reason).toBe('CTR 1 is below this brand\'s own median CTR of 1.25 across 4 Meta (Facebook, Instagram, Ads) paid creatives.');
  const quoted = catalog.quote('ads.generate');
  expect(f.offer).toMatchObject({ action: 'regenerate', feature_key: 'ads.generate', credits: quoted.total, requires_approval: true, runs_automatically: false });
  // No thresholds set: no threshold flags, and nothing invented to stand in for one.
  expect(gateway.computeUnderperformance(rows, null).flags.filter((x) => x.basis === 'operator_threshold')).toEqual([]);
});

test('thresholds are the operator\'s own and an editor\'s to set; flags are kept, and approving a regeneration records who and spends nothing', async () => {
  const { db } = world();
  for (const [id, ctr, roas] of [['ad-1', 2.0, 3], ['ad-2', 1.5, 2], ['ad-3', 0.4, 1.2]]) {
    db.insert('social_metric_snapshots', { workspace_id: 'ws-a', provider: 'meta', kind: 'paid', external_id: id, metrics: { ctr, roas }, captured_on: '2026-10-03', asset_ref: `slot-${id}`, slot_date: '2026-10-05' });
  }
  // An older snapshot of the same creative is not what is judged.
  db.insert('social_metric_snapshots', { workspace_id: 'ws-a', provider: 'meta', kind: 'paid', external_id: 'ad-1', metrics: { ctr: 0.1 }, captured_on: '2026-09-01' });

  expect((await gw('thresholds-save', { auth: AUTH_V, body: { thresholds: { paid: { roas_min: 1.5 } } } })).code).toBe(403);
  expect((await gw('thresholds-save', { body: { thresholds: { paid: { roas_min: -2 } } } })).code).toBe(400);
  const saved = await gw('thresholds-save', { body: { thresholds: { paid: { roas_min: 1.5, ctr_min: 1 } } } });
  expect(saved.payload.thresholds).toEqual({ paid: { roas_min: 1.5, ctr_min: 1 }, organic: {} });
  expect(db.table('social_gateway_settings')[0]).toMatchObject({ workspace_id: 'ws-a', updated_by: 'user-a' });

  const u = await gw('underperformance', { body: {} });
  expect(u.payload).toMatchObject({ ok: true, creatives: 3, stored: 4 });
  const flags = db.table('social_creative_flags');
  expect(flags.map((x) => `${x.external_id}:${x.metric}:${x.basis}`).sort()).toEqual(['ad-3:ctr:operator_threshold', 'ad-3:ctr:own_median', 'ad-3:roas:operator_threshold', 'ad-3:roas:own_median']);
  expect(flags[0]).toMatchObject({ workspace_id: 'ws-a', status: 'open', asset_ref: 'slot-ad-3', slot_date: '2026-10-05' });

  const listed = await gw('flags');
  expect(listed.payload.flags).toHaveLength(4);
  const target = flags.find((x) => x.basis === 'own_median' && x.metric === 'roas');
  expect((await gw('regen-approve', { auth: AUTH_V, body: { flag_id: target.id } })).code).toBe(403);
  db.clearCalls();
  const ok = await gw('regen-approve', { body: { flag_id: target.id } });
  expect(ok.payload).toMatchObject({ ok: true, flag: { status: 'regen_approved', decided_by: 'user-a' }, next: { feature_key: 'ads.generate', credits: catalog.quote('ads.generate').total, asset_ref: 'slot-ad-3' } });
  expect(db.calls.filter((c) => /rpc\/credit_/.test(c.url)), 'approving spends nothing by itself').toEqual([]);
  expect(jobs(db)).toHaveLength(0);
  expect(db.external()).toHaveLength(0);
  expect((await gw('regen-approve', { body: { flag_id: target.id } })).payload.error).toBe('not_open');

  // A recompute does not reopen what an editor decided.
  await gw('underperformance', { body: {} });
  expect(db.table('social_creative_flags').find((x) => x.id === target.id).status).toBe('regen_approved');
  expect((await gw('flag-dismiss', { body: { flag_id: flags.find((x) => x.basis === 'operator_threshold' && x.metric === 'ctr').id } })).payload.flag.status).toBe('dismissed');
});

/* ═══ 9. the honest state ═══════════════════════════════════════════════ */

test('status: with nothing connected, every platform says what to connect; with a connection, exactly which switch stands between it and a live write', async () => {
  const { db } = world();
  let st = await gw('status');
  expect(st.payload.platforms.map((p) => p.id)).toEqual(['meta', 'tiktok', 'tiktok_ads', 'pinterest', 'youtube', 'google_ads']);
  for (const p of st.payload.platforms) {
    expect(p, p.id).toMatchObject({ connected: false, status: 'not_connected', can_write_now: false });
    expect(p.next[0], p.id).toMatch(/Connect|Paste/);
  }
  expect(st.payload.platforms.find((p) => p.id === 'tiktok').next.join(' ')).toMatch(/TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET/);
  expect(st.payload.platforms.find((p) => p.id === 'tiktok_ads').next.join(' ')).toMatch(/unverified .* refuse to send/);
  expect(st.payload.note).toMatch(/LIVE_CONNECTORS is off/);
  expect(db.external()).toHaveLength(0);

  connect(db, 'tiktok', { access_token: 'act.tt-1' }, { config: { publishing_enabled: true } });
  live();
  st = await gw('status');
  let tt = st.payload.platforms.find((p) => p.id === 'tiktok');
  expect(tt).toMatchObject({ connected: true, status: 'active', can_write_now: false, switches: { live_connectors: true, workspace_publishing: true, platform_writes: false } });
  expect(tt.next).toEqual(['TIKTOK_ALLOW_WRITES is not set to 1 on the deployment, so TikTok writes build the exact request and stop.']);
  process.env.TIKTOK_ALLOW_WRITES = '1';
  tt = (await gw('status')).payload.platforms.find((p) => p.id === 'tiktok');
  expect(tt.can_write_now).toBe(true);
  expect(JSON.stringify(st.payload)).not.toContain('act.tt-1');

  // The connections cannot be read: said, and every platform shown as not connected.
  db.failures.workspace_connections = 503;
  st = await gw('status');
  expect(st.payload.store.reachable).toBe(false);
  expect(st.payload.platforms.every((p) => !p.connected)).toBe(true);
});

test('a brand kept on this device (no server workspace) gets the honest status, and every other operation says why it cannot run - nothing read, nothing written', async () => {
  const { db } = world();
  const device = { ok: true, token: 'device-token', user_id: 'device:abc', provider: 'mobile-pin', mode: 'device' };
  const st = await gw('status', { auth: device, ws: null });
  expect(st.code).toBe(200);
  expect(st.payload).toMatchObject({ ok: true, storage: 'device', workspace_id: null });
  expect(st.payload.platforms.every((p) => p.connected === false)).toBe(true);
  for (const op of ['read', 'inbox', 'underperformance', 'live-approve', 'thresholds-save']) {
    const r = await gw(op, { auth: device, ws: null, body: { provider: 'meta', kind: 'ad_metrics', job_id: 'x' } });
    expect(r.code, op).toBe(409);
    expect(r.payload.error, op).toBe('no_active_brand');
  }
  expect(db.calls, 'a device brand reaches neither the store nor a platform').toEqual([]);
  expect((await gw('nope')).code).toBe(400);
});

/* ═══ 10. review of #132 (2026-10-04) ═══════════════════════════════════ */

// P1: the Connect button asked for nothing but the read defaults, so every
// write channel was blocked at preflight with no way to grant more.
test('Connect asks for the scopes of exactly the write capabilities the operator chose, read from the adapter; reading only by default; never an undeclared scope; preflight names what was not granted', async () => {
  const { db } = world();
  const start = async (provider, capabilities) => {
    const r = await connRouter('oauth-start', { token: 'tok-a', method: 'POST', body: { provider, capabilities } });
    expect(r.code, `${provider} ${JSON.stringify(capabilities)}: ${JSON.stringify(r.payload)}`).toBe(200);
    const A = registry.adapterFor(provider);
    const declared = A.auth.scopes.map((s) => s.value);
    for (const s of r.payload.scopes) expect(declared, `${provider} requested ${s}`).toContain(s);
    // What the consent screen asks for is what was stored for the callback.
    const sep = A.auth.scope_separator || ' ';
    expect(new URL(r.payload.url).searchParams.get('scope').split(sep).sort()).toEqual([...r.payload.scopes].sort());
    const stateRow = db.table('oauth_authorization_states').find((x) => x.state === r.payload.state);
    expect([...stateRow.scopes].sort()).toEqual([...r.payload.scopes].sort());
    return r.payload;
  };
  const YT = (s) => `https://www.googleapis.com/auth/youtube.${s}`;

  // Nothing chosen: the read defaults, exactly as before.
  expect((await start('youtube', [])).scopes).toEqual([YT('readonly')]);
  // Publishing a video: the upload, and force-ssl because going live (private -> public) is a videos.update.
  expect((await start('youtube', ['post'])).scopes.sort()).toEqual([YT('force-ssl'), YT('readonly'), YT('upload')].sort());
  // Comments only: force-ssl, and no upload scope.
  const ytComments = await start('youtube', ['comments']);
  expect(ytComments.scopes.sort()).toEqual([YT('force-ssl'), YT('readonly')].sort());
  expect(ytComments.channels.sort()).toEqual(['youtube_comment_moderation', 'youtube_comment_reply']);
  expect((await start('tiktok', ['post'])).scopes.sort()).toEqual(['user.info.basic', 'video.list', 'video.publish', 'video.upload']);
  expect((await start('pinterest', ['ads'])).scopes.sort()).toEqual(['ads:read', 'ads:write', 'boards:read', 'pins:read']);
  const metaComments = await start('meta', ['comments']);
  expect(metaComments.scopes).toEqual(expect.arrayContaining(['instagram_manage_comments', 'pages_manage_engagement']));
  expect(metaComments.scopes, 'choosing comments does not ask for ad spend').not.toContain('ads_management');
  expect((await start('meta', ['ads'])).scopes).toContain('ads_management');
  // Every capability the hub offers, on every gateway platform, asks only for declared scopes.
  process.env.GOOGLE_ADS_CLIENT_ID = 'gads-client';
  for (const v of registry.registryView().filter((p) => p.auth_kind === 'oauth' && ['meta', 'tiktok', 'pinterest', 'youtube', 'google_ads'].includes(p.id))) {
    const all = await start(v.id, v.capabilities.map((k) => k.id));
    expect(all.not_requested, `${v.id} needs a scope it does not declare`).toEqual([]);
  }

  // Preflight then names the scope a connection was not granted.
  const oauth = require(path.join(ROOT, 'api', '_shared', 'oauth-core.js'));
  const upload = oauth.validateScopes('youtube', 'youtube_video_upload', ytComments.scopes, 'write');
  expect(upload.ok).toBe(false);
  expect(upload.note).toContain(YT('upload'));
  expect(oauth.validateScopes('youtube', 'youtube_comment_reply', ytComments.scopes, 'write').ok).toBe(true);
  expect(db.external(), 'starting a sign-in calls no platform').toEqual([]);
});

// P1: a webhook whose ingest failed after it was recorded was answered 500, and
// the platform's retry met the dedupe and got 200 - the event was lost.
test('a delivery whose ingest failed is RESUMED by the platform\'s retry, not acknowledged as a duplicate; only a processed event short-circuits', async () => {
  const { db } = world();
  connect(db, 'meta_ads', { access_token: 'meta-tok' }, { config: { ig_user_id: '17841-ig' } });
  // A job the event names (Meta's entry id), so the ingest has real work to do.
  db.insert('dispatch_jobs', { workspace_id: 'ws-a', idempotency_key: 'k-ig', provider: 'meta', channel: 'instagram_feed', payload: {}, status: 'succeeded', external_id: '17841-ig', external_status: 'published', attempt_count: 1, max_attempts: 5, next_attempt_at: nowIso() });
  const raw = JSON.stringify({ object: 'instagram', entry: [{ id: '17841-ig', changes: [{ field: 'comments', value: { id: 'c-90', text: 'Restock in a 10?', media: { id: 'm-9' } } }] }] });
  const sig = { 'x-hub-signature-256': metaSign('meta-app-secret', raw) };

  // The dispatch store goes down between the record and the ingest.
  db.failures.dispatch_jobs = 503;
  const first = await deliver('meta', raw, sig);
  expect(first.code, 'a failed ingest asks the platform to retry').toBe(500);
  let row = db.table('social_inbound_events')[0];
  expect(row).toMatchObject({ provider: 'meta', workspace_id: 'ws-a', status: 'failed', attempts: 1 });
  expect(row.last_error).toMatch(/dispatch store/);
  expect(jobs(db)[0].external_status).toBe('published');

  // The store is back and the platform retries the same bytes: the ingest RUNS.
  delete db.failures.dispatch_jobs;
  const retry = await deliver('meta', raw, sig);
  expect(retry.code).toBe(200);
  expect(retry.payload).toMatchObject({ ok: true, processed: true, verified: true, inbound: { recorded: false, resumed: true, marked_processed: true, routed: true } });
  expect(jobs(db)[0].external_status, 'the resumed ingest reconciled the job').toBe('updated');
  row = db.table('social_inbound_events')[0];
  expect(row).toMatchObject({ status: 'processed', attempts: 2, last_error: null });
  expect(row.processed_at).toBeTruthy();
  expect(db.table('social_inbound_events')).toHaveLength(1);
  expect(db.table('platform_sync_log').filter((l) => l.direction === 'inbound'), 'logged once, when first recorded').toHaveLength(1);

  // A later redelivery of the PROCESSED event is acknowledged, and nothing runs.
  db.clearCalls();
  const late = await deliver('meta', raw, sig);
  expect(late.code).toBe(200);
  expect(late.payload).toMatchObject({ ok: true, processed: false, duplicate: true, verified: true });
  expect(db.calls.filter((c) => /platform_webhook_events|dispatch_jobs/.test(c.url)), 'a processed event is not ingested again').toEqual([]);
  expect(db.table('social_inbound_events')[0]).toMatchObject({ status: 'processed', attempts: 2 });
});

// P2: thresholds for reach, impressions or likes were ignored whenever the
// creatives also reported views.
test('organic: every metric the operator set a threshold for is judged, beside the median on the primary metric; a creative that does not report it is not judged on it', () => {
  const rows = [
    { provider: 'meta', kind: 'organic', surface: 'instagram', external_id: 'p-1', values: { views: 900, likes: 40, reach: 500 } },
    { provider: 'meta', kind: 'organic', surface: 'instagram', external_id: 'p-2', values: { views: 800, likes: 3, reach: 450 } },
    { provider: 'meta', kind: 'organic', surface: 'instagram', external_id: 'p-3', values: { views: 700, reach: 90 } },   // reports no likes
  ];
  const keyed = (out) => out.flags.map((f) => `${f.external_id}:${f.metric}:${f.basis}`).sort();

  // No thresholds: the median on the primary metric (views), nothing else.
  expect(keyed(gateway.computeUnderperformance(rows, null))).toEqual(['p-3:views:own_median']);

  const out = gateway.computeUnderperformance(rows, { organic: { likes_min: 10, reach_min: 100 } });
  expect(keyed(out)).toEqual(['p-2:likes:operator_threshold', 'p-3:reach:operator_threshold', 'p-3:views:own_median']);
  // No median is taken on a threshold-only metric, and p-3's absent likes is not a zero.
  expect(out.flags.find((f) => f.metric === 'likes' && f.basis === 'own_median')).toBeUndefined();
  expect(out.flags.find((f) => f.external_id === 'p-3' && f.metric === 'likes')).toBeUndefined();
  expect(out.groups.find((g) => g.metric === 'likes')).toMatchObject({ basis: 'operator_threshold', rows: 2 });
  expect(out.flags.find((f) => f.metric === 'reach').reason).toBe('reach 90 is below the threshold of 100 set for this brand.');
});
