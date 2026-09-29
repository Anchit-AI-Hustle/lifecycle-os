// The OAuth handshake, EXECUTED through the shipped router: ?op=oauth-start,
// ?op=oauth-callback and ?op=oauth-disconnect on
// api/_shared/workspace-connections-core.js, with api/_shared/oauth-core.js
// and the secrets vault running unmodified over the in-memory Supabase in
// tests/lib/fake-supabase.js. The platforms (Klaviyo, Meta, Google) answer only
// where a case routes them; any other outbound call throws.
//
// The callback carries no Supabase JWT - it is a browser redirect from the
// platform - so the `state` parameter is the entire authentication of that
// request. What has to hold:
//
//   - start writes ONE state row with the PKCE verifier server-side and never
//     returns the verifier; the URL's code_challenge is the S256 hash of THAT
//     row's verifier;
//   - the callback consumes the state atomically, exchanges the code WITH the
//     verifier, and stores the grant AES-256-GCM encrypted: the token reaches
//     the platform and the ciphertext, and appears in no response, redirect or
//     readable row;
//   - a TAMPERED state is refused before any exchange and leaves the genuine
//     state usable (the mutation that drops the state filter fails here);
//   - a state is single use, expires, and must name the platform that answered;
//   - a deployment that cannot store a secret refuses to START a sign-in
//     (503, nothing written), and a callback that finds the vault gone refuses
//     before burning the one-time code - rather than exchanging a token it
//     then has to drop;
//   - disconnect removes the credential and its secret and says what the
//     platform did, without claiming a revocation it did not get.
//
// Run: npx playwright test tests/oauth-handshake-executed.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const { FakeSupabase, makeReq, makeRes, envScope, response, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const oauth = require(path.join(ROOT, 'api', '_shared', 'oauth-core.js'));

const KL_TOKEN = 'https://a.klaviyo.com/oauth/token';
const KL_ACCOUNTS = 'https://a.klaviyo.com/api/accounts/';
const CALLBACK = 'https://app.example.test/api/public-config?action=connections&op=oauth-callback&provider=';

const ENV = envScope([
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'CONNECTION_SECRET_KEY', 'PUBLIC_BASE_URL', 'VERCEL_URL',
  'KLAVIYO_OAUTH_CLIENT_ID', 'KLAVIYO_OAUTH_CLIENT_SECRET', 'META_APP_ID', 'META_APP_SECRET',
  'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'LIVE_CONNECTORS',
]);
let REAL_FETCH;

test.beforeAll(() => {
  ENV.save();
  REAL_FETCH = global.fetch;
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'd'.repeat(64);
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
  process.env.KLAVIYO_OAUTH_CLIENT_ID = 'kl-client';
  process.env.KLAVIYO_OAUTH_CLIENT_SECRET = 'kl-secret';
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'VERCEL_URL', 'META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'LIVE_CONNECTORS']) delete process.env[k];
});
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; });
test.afterEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'd'.repeat(64);
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
  for (const k of ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET']) delete process.env[k];
});

/* ── the world ──────────────────────────────────────────────────────────── */

function world() {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addUser('tok-v', 'user-v', 'v@example.test').addUser('tok-b', 'user-b', 'b@example.test')
    .addWorkspace('ws-a', 'user-a').addWorkspace('ws-b', 'user-b').addMember('ws-a', 'user-v', 'viewer')
    .setActive('user-a', 'ws-a').setActive('user-v', 'ws-a').syncIdentityTables();
  db.install();
  connections._resolvedCache.clear();
  return db;
}

function connect(db, provider, secrets, extra) {
  const conn = db.insert('workspace_connections', Object.assign({
    workspace_id: 'ws-a', provider, category: 'lifecycle', auth_kind: 'oauth', label: provider, config: {},
    secret_fields: Object.keys(secrets), secret_hint: 'xxxx', status: 'active', connect_kind: 'oauth',
  }, extra || {}));
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: conn.id, workspace_id: 'ws-a' }, connections.encryptSecrets(secrets)));
  return conn;
}

/** Drive the shipped router exactly as api/public-config.js does. */
async function handle({ token, query, body, method, headers }) {
  const res = makeRes();
  await connections.handle(makeReq({ token, query: Object.assign({ action: 'connections' }, query || {}), body, method, headers }), res);
  return res;
}
const start = (token, body) => handle({ token, query: { op: 'oauth-start' }, body, method: 'POST' });
const callback = (query) => handle({ query: Object.assign({ op: 'oauth-callback' }, query), method: 'GET' });
const states = (db) => db.table('oauth_authorization_states');
const conns = (db) => db.table('workspace_connections');
const secrets = (db) => db.table('workspace_connection_secrets');

/** Klaviyo answers the exchange and the account lookup; counts the exchanges. */
function klaviyoAnswers(db, grant) {
  const seen = { exchanges: [] };
  db.route((u) => u === KL_TOKEN, (_u, _i, call) => { seen.exchanges.push(call); return grant || { access_token: 'kl-at-1', refresh_token: 'kl-rt-1', expires_in: 600, scope: 'accounts:read campaigns:write' }; });
  db.route((u) => u === KL_ACCOUNTS, () => ({ data: [{ id: 'acct-1', attributes: { contact_information: { organization_name: 'Alpha Co' } } }] }));
  return seen;
}

/* ── 1. the round trip ──────────────────────────────────────────────────── */

test('the handshake round-trips: a single-use state with the verifier server-side, the code exchanged with that verifier, the grant stored encrypted', async () => {
  const db = world();
  const s = await start('tok-a', { provider: 'klaviyo', scopes: ['accounts:read', 'campaigns:write', 'templates:write', 'not:a-scope'], return_to: '/publishing' });
  expect(s.code).toBe(200);
  expect(s.payload.ok).toBe(true);

  const u = new URL(s.payload.url);
  const p = u.searchParams;
  expect(u.origin + u.pathname).toBe('https://www.klaviyo.com/oauth/authorize');
  expect(p.get('client_id')).toBe('kl-client');
  expect(p.get('response_type')).toBe('code');
  expect(p.get('redirect_uri')).toBe(CALLBACK + 'klaviyo');
  expect(p.get('scope'), 'a scope the adapter cannot explain is not requested').toBe('accounts:read campaigns:write templates:write');
  expect(p.get('code_challenge_method')).toBe('S256');
  const state = p.get('state');
  expect(state).toBe(s.payload.state);
  expect(state.length).toBeGreaterThanOrEqual(43);

  const row = states(db)[0];
  expect(states(db)).toHaveLength(1);
  expect(row).toMatchObject({ state, workspace_id: 'ws-a', provider: 'klaviyo', user_id: 'user-a', return_to: '/publishing', scopes: ['accounts:read', 'campaigns:write', 'templates:write'], redirect_uri: CALLBACK + 'klaviyo' });
  expect(Date.parse(row.expires_at) - Date.now()).toBeGreaterThan(9 * 60_000);
  expect(Date.parse(row.expires_at) - Date.now()).toBeLessThanOrEqual(oauth.STATE_TTL_MS);
  expect(row.code_verifier.length).toBeGreaterThanOrEqual(43);
  expect(oauth.challengeFor(row.code_verifier), 'the challenge is the hash of THIS row\'s verifier').toBe(p.get('code_challenge'));
  expect(JSON.stringify(s.payload), 'the verifier never leaves the server').not.toContain(row.code_verifier);
  expect(row.consumed_at).toBeFalsy();
  expect(db.external()).toHaveLength(0);

  const seen = klaviyoAnswers(db);
  const cb = await callback({ provider: 'klaviyo', state, code: 'auth-code-1' });
  expect(cb.code).toBe(302);
  expect(cb.head.Location).toBe('/publishing?oauth=connected&provider=klaviyo');
  expect(cb.headers['cache-control']).toBe('no-store');
  expect(cb.writes.map((w) => w[0])).toEqual(['writeHead', 'end']);

  expect(seen.exchanges).toHaveLength(1);
  const ex = seen.exchanges[0];
  expect(ex.method).toBe('POST');
  expect(ex.headers.authorization).toBe('Basic ' + Buffer.from('kl-client:kl-secret').toString('base64'));
  const form = new URLSearchParams(ex.body);
  expect(form.get('grant_type')).toBe('authorization_code');
  expect(form.get('code')).toBe('auth-code-1');
  expect(form.get('redirect_uri')).toBe(row.redirect_uri);
  expect(form.get('code_verifier')).toBe(row.code_verifier);
  expect(form.get('client_secret'), 'Klaviyo takes the client secret as Basic auth, not in the body').toBeNull();
  expect(states(db)[0].consumed_at).toBeTruthy();

  const conn = conns(db).find((c) => c.workspace_id === 'ws-a' && c.provider === 'klaviyo');
  expect(conn).toMatchObject({ connect_kind: 'oauth', oauth_scopes: ['accounts:read', 'campaigns:write'], status: 'active', secret_fields: ['access_token', 'refresh_token'], secret_hint: 'at-1', external_account_id: 'acct-1', external_account_label: 'Alpha Co', last_check_ok: true, refresh_failure_count: 0, revoked_at: null });
  expect(Date.parse(conn.token_expires_at) - Date.now()).toBeGreaterThan(500_000);
  const sec = secrets(db).find((x) => x.connection_id === conn.id);
  expect(sec.alg).toBe('aes-256-gcm');
  expect(connections.decryptSecrets(sec)).toEqual({ access_token: 'kl-at-1', refresh_token: 'kl-rt-1' });

  const everything = JSON.stringify([cb.head, cb.headers, cb.payload, cb.ended, conns(db), secrets(db), states(db)]);
  expect(everything).not.toContain('kl-at-1');
  expect(everything).not.toContain('kl-rt-1');

  // What the hub now shows: configured, a hint, never the key.
  const list = await handle({ token: 'tok-a', query: { op: 'list' } });
  const shown = list.payload.connections.find((c) => c.provider === 'klaviyo');
  expect(shown).toMatchObject({ configured: true, secret_hint: 'at-1' });
  expect(JSON.stringify(list.payload)).not.toContain('kl-at-1');
});

/* ── 2. the state is the authentication ─────────────────────────────────── */

test('a tampered state is refused before any exchange, and the genuine state is left intact for its owner', async () => {
  const db = world();
  const seen = klaviyoAnswers(db);
  const s = await start('tok-a', { provider: 'klaviyo' });
  const state = s.payload.state;

  const forged = state.slice(0, -1) + (state.endsWith('A') ? 'B' : 'A');
  const cb = await callback({ provider: 'klaviyo', state: forged, code: 'stolen-code' });
  expect(cb.code).toBe(302);
  expect(cb.head.Location).toBe('/connections?oauth=error&reason=state_expired');
  expect(seen.exchanges, 'no code is exchanged on a state this deployment did not issue').toHaveLength(0);
  expect(conns(db)).toHaveLength(0);
  expect(secrets(db)).toHaveLength(0);
  expect(states(db)[0].consumed_at, 'the real state is untouched').toBeFalsy();

  // A state that was never issued at all, and a missing one.
  const unknown = await callback({ provider: 'klaviyo', state: 'A'.repeat(43), code: 'c' });
  expect(unknown.head.Location).toBe('/connections?oauth=error&reason=state_expired');
  const none = await callback({ provider: 'klaviyo', code: 'c' });
  expect(none.head.Location).toBe('/connections?oauth=error&reason=missing_state');
  expect(seen.exchanges).toHaveLength(0);

  // The owner's own callback still completes.
  const real = await callback({ provider: 'klaviyo', state, code: 'auth-code-2' });
  expect(real.head.Location).toBe('/connections?oauth=connected&provider=klaviyo');
  expect(seen.exchanges).toHaveLength(1);
  expect(new URLSearchParams(seen.exchanges[0].body).get('code')).toBe('auth-code-2');
  expect(secrets(db)).toHaveLength(1);
});

test('a state is single-use, expires after ten minutes, must name the platform that answered, and a refusal upstream exchanges nothing', async () => {
  const db = world();
  let grant = { access_token: 'kl-at-1', refresh_token: 'kl-rt-1', expires_in: 600 };
  const seen = { exchanges: [] };
  db.route((u) => u === KL_TOKEN, (_u, _i, call) => { seen.exchanges.push(call); return typeof grant === 'function' ? grant() : grant; });
  db.route((u) => u === KL_ACCOUNTS, () => ({ data: [] }));

  const s1 = await start('tok-a', { provider: 'klaviyo', return_to: '/connections' });
  expect((await callback({ provider: 'klaviyo', state: s1.payload.state, code: 'c1' })).head.Location).toMatch(/oauth=connected/);
  expect(seen.exchanges).toHaveLength(1);
  const replay = await callback({ provider: 'klaviyo', state: s1.payload.state, code: 'c2' });
  expect(replay.head.Location).toBe('/connections?oauth=error&reason=state_expired');
  expect(seen.exchanges, 'a consumed state buys no second exchange').toHaveLength(1);

  const s2 = await start('tok-a', { provider: 'klaviyo' });
  const row2 = states(db).find((r) => r.state === s2.payload.state);
  row2.expires_at = new Date(Date.now() - 1).toISOString();
  const late = await callback({ provider: 'klaviyo', state: s2.payload.state, code: 'c3' });
  expect(late.head.Location).toMatch(/reason=state_expired/);
  expect(row2.consumed_at).toBeFalsy();
  expect(seen.exchanges).toHaveLength(1);

  const s3 = await start('tok-a', { provider: 'klaviyo' });
  const wrong = await callback({ provider: 'meta', state: s3.payload.state, code: 'c4' });
  expect(wrong.head.Location).toBe('/connections?oauth=error&reason=provider_mismatch');
  expect(states(db).find((r) => r.state === s3.payload.state).consumed_at, 'a state presented to the wrong platform is burned').toBeTruthy();
  expect(seen.exchanges).toHaveLength(1);

  const s4 = await start('tok-a', { provider: 'klaviyo' });
  const denied = await callback({ provider: 'klaviyo', state: s4.payload.state, error: 'access_denied', error_description: 'The user denied the request.' });
  expect(denied.head.Location).toBe('/connections?oauth=denied&provider=klaviyo');
  expect(seen.exchanges).toHaveLength(1);

  const s5 = await start('tok-a', { provider: 'klaviyo' });
  const nocode = await callback({ provider: 'klaviyo', state: s5.payload.state });
  expect(nocode.head.Location).toBe('/connections?oauth=error&reason=missing_code');
  expect(seen.exchanges).toHaveLength(1);

  // The platform refuses the exchange: reported, nothing stored beyond the first grant.
  grant = () => response(400, { error: 'invalid_grant' });
  const s6 = await start('tok-a', { provider: 'klaviyo' });
  const refused = await callback({ provider: 'klaviyo', state: s6.payload.state, code: 'c6' });
  expect(refused.head.Location).toBe('/connections?oauth=error&reason=exchange_failed');
  expect(seen.exchanges).toHaveLength(2);
  expect(secrets(db)).toHaveLength(1);
  expect(connections.decryptSecrets(secrets(db)[0]).access_token).toBe('kl-at-1');

  // The platform is unreachable: the same honest refusal.
  grant = () => { throw new Error('ECONNRESET'); };
  const s7 = await start('tok-a', { provider: 'klaviyo' });
  expect((await callback({ provider: 'klaviyo', state: s7.payload.state, code: 'c7' })).head.Location).toBe('/connections?oauth=error&reason=exchange_failed');
});

/* ── 3. what start refuses ──────────────────────────────────────────────── */

test('oauth-start refuses what it cannot honour: no app registered, a platform without OAuth, a viewer, an unknown platform, no session, no store', async () => {
  const db = world();
  let r = await start('tok-a', { provider: 'meta' });
  expect(r.code).toBe(503);
  expect(r.payload.error).toBe('oauth_app_not_registered');
  expect(r.payload.message).toMatch(/META_APP_ID/);

  r = await start('tok-a', { provider: 'braze' });
  expect(r.code).toBe(400);
  expect(r.payload.message).toMatch(/does not use OAuth/);

  r = await start('tok-v', { provider: 'klaviyo' });
  expect(r.code).toBe(403);
  expect(r.payload.message).toMatch(/viewer/);

  r = await start('tok-a', { provider: 'nope' });
  expect(r.code).toBe(400);
  r = await start('tok-a', { provider: 'klaviyo', scopes: ['bogus:scope'] });
  expect(r.code).toBe(400);
  expect(r.payload.message).toMatch(/No recognised scopes/);
  r = await start(null, { provider: 'klaviyo' });
  expect(r.code).toBe(401);
  expect(states(db), 'none of those wrote a state').toHaveLength(0);

  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  r = await start('tok-a', { provider: 'klaviyo' });
  expect(r.code).toBe(503);
  expect(r.payload.error).toBe('oauth_store_unavailable');
  expect(states(db)).toHaveLength(0);
});

/* ── 4. each platform, the way it documents ─────────────────────────────── */

test('Meta is exchanged by GET with query parameters and no PKCE; Google by form body with client credentials, PKCE, and offline access requested', async () => {
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-secret';
  process.env.GOOGLE_ADS_CLIENT_ID = 'g-client';
  process.env.GOOGLE_ADS_CLIENT_SECRET = 'g-secret';
  const db = world();

  const ms = await start('tok-a', { provider: 'meta', scopes: ['pages_manage_posts'] });
  expect(ms.code).toBe(200);
  const mu = new URL(ms.payload.url);
  expect(mu.host).toBe('www.facebook.com');
  expect(mu.searchParams.get('code_challenge')).toBeNull();
  expect(mu.searchParams.get('scope')).toBe('pages_manage_posts');
  let metaExchange = null;
  db.route((u) => u.startsWith('https://graph.facebook.com/') && u.includes('/oauth/access_token'), (_u, _i, call) => { metaExchange = call; return { access_token: 'm-at-1', expires_in: 5184000 }; });
  db.route((u) => u.startsWith('https://graph.facebook.com/') && /\/me\?/.test(u), () => ({ id: 'me-1', name: 'Alpha Page' }));
  db.route((u) => u.includes('/debug_token'), () => ({ data: { scopes: ['pages_manage_posts'], expires_at: 0 } }));
  const mcb = await callback({ provider: 'meta', state: ms.payload.state, code: 'm-code' });
  expect(mcb.head.Location).toBe('/connections?oauth=connected&provider=meta');
  expect(metaExchange.method).toBe('GET');
  const mq = new URL(metaExchange.url).searchParams;
  expect(mq.get('client_id')).toBe('meta-app');
  expect(mq.get('client_secret')).toBe('meta-secret');
  expect(mq.get('code')).toBe('m-code');
  expect(mq.get('redirect_uri')).toBe(CALLBACK + 'meta');
  const metaConn = conns(db).find((c) => c.provider === 'meta_ads');             // organic + paid share one connection row
  expect(metaConn).toMatchObject({ external_account_id: 'me-1', external_account_label: 'Alpha Page', oauth_scopes: ['pages_manage_posts'], secret_fields: ['access_token'] });
  expect(connections.decryptSecrets(secrets(db).find((x) => x.connection_id === metaConn.id))).toEqual({ access_token: 'm-at-1' });

  const gs = await start('tok-a', { provider: 'google_ads' });
  const gu = new URL(gs.payload.url);
  expect(gu.host).toBe('accounts.google.com');
  expect(gu.searchParams.get('access_type')).toBe('offline');
  expect(gu.searchParams.get('prompt')).toBe('consent');
  expect(gu.searchParams.get('code_challenge')).toBeTruthy();
  expect(gu.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/adwords');
  let googleExchange = null;
  db.route((u) => u === 'https://oauth2.googleapis.com/token', (_u, _i, call) => { googleExchange = call; return { access_token: 'g-at-1', refresh_token: 'g-rt-1', expires_in: 3600, scope: 'https://www.googleapis.com/auth/adwords' }; });
  const gcb = await callback({ provider: 'google_ads', state: gs.payload.state, code: 'g-code' });
  expect(gcb.head.Location).toBe('/connections?oauth=connected&provider=google_ads');
  const gf = new URLSearchParams(googleExchange.body);
  expect(gf.get('client_id')).toBe('g-client');
  expect(gf.get('client_secret')).toBe('g-secret');
  expect(gf.get('code_verifier')).toBe(states(db).find((r) => r.state === gs.payload.state).code_verifier);
  const gConn = conns(db).find((c) => c.provider === 'google_ads');
  expect(gConn.secret_fields.sort()).toEqual(['access_token', 'refresh_token']);
  // Google's identity check needs a customer id and developer token this
  // connection does not carry yet, so the grant is stored and the account is
  // left unidentified rather than guessed.
  expect(gConn.external_account_id).toBeUndefined();
  expect(JSON.stringify([conns(db), secrets(db), mcb.head, gcb.head])).not.toMatch(/m-at-1|g-at-1|g-rt-1/);
});

/* ── 5. disconnect ──────────────────────────────────────────────────────── */

test('oauth-disconnect removes the credential and its secret, and says what happened at the provider without claiming a revocation it did not get', async () => {
  const db = world();
  connect(db, 'klaviyo', { access_token: 'kl-at-9', refresh_token: 'kl-rt-9' });
  let r = await handle({ token: 'tok-v', query: { op: 'oauth-disconnect' }, body: { provider: 'klaviyo' }, method: 'POST' });
  expect(r.code).toBe(403);
  expect(conns(db)).toHaveLength(1);

  r = await handle({ token: 'tok-a', query: { op: 'oauth-disconnect' }, body: { provider: 'klaviyo' }, method: 'POST' });
  expect(r.code).toBe(200);
  expect(r.payload).toMatchObject({ ok: true, removed: 'klaviyo' });
  expect(r.payload.note).toMatch(/does not expose a revoke endpoint/);
  expect(conns(db)).toHaveLength(0);
  expect(secrets(db), 'the secret goes with the connection').toHaveLength(0);
  expect(db.external()).toHaveLength(0);

  // Google documents a revoke endpoint: it is called with the refresh token,
  // and a refusal there is reported rather than papered over.
  let status = 200;
  db.route((u) => u === 'https://oauth2.googleapis.com/revoke', (_u, init) => {
    expect(String(init.body)).toBe('token=g-rt-1');
    return response(status, {});
  });
  connect(db, 'google_ads', { access_token: 'g-at-1', refresh_token: 'g-rt-1' });
  r = await handle({ token: 'tok-a', query: { op: 'oauth-disconnect', provider: 'google_ads' }, method: 'GET' });
  expect(r.payload.note).toMatch(/revoked at Google/);
  expect(conns(db)).toHaveLength(0);
  expect(db.external()).toHaveLength(1);

  status = 400;
  connect(db, 'google_ads', { access_token: 'g-at-2', refresh_token: 'g-rt-1' });
  r = await handle({ token: 'tok-a', query: { op: 'oauth-disconnect', provider: 'google_ads' }, method: 'GET' });
  expect(r.payload.ok).toBe(true);
  expect(r.payload.note).toMatch(/did not confirm/);
  expect(conns(db)).toHaveLength(0);
  expect(secrets(db)).toHaveLength(0);

  // Meta: removed here, and the operator is told to remove the app there too.
  connect(db, 'meta_ads', { access_token: 'm-at-1' });
  r = await handle({ token: 'tok-a', query: { op: 'oauth-disconnect', provider: 'meta' }, method: 'GET' });
  expect(r.payload).toMatchObject({ ok: true, removed: 'meta_ads' });
  expect(r.payload.note).toMatch(/Meta does not expose a revoke endpoint/);
  expect(conns(db)).toHaveLength(0);
});

/* ── 6. keeping a grant fresh, without the queue ────────────────────────── */

test('ensureFreshToken: nothing connected needs a reconnect, a pasted key never refreshes, a live token is used as is', async () => {
  const db = world();
  expect(await oauth.ensureFreshToken('ws-a', 'klaviyo')).toMatchObject({ ok: false, reconnect_required: true });
  expect(await oauth.ensureFreshToken('ws-a', 'no_such_platform')).toMatchObject({ ok: false });

  connect(db, 'klaviyo', { api_key: 'pk_live_1' }, { auth_kind: 'api_key', connect_kind: 'api_key' });
  expect(await oauth.ensureFreshToken('ws-a', 'klaviyo')).toEqual({ ok: true, credentials: { api_key: 'pk_live_1' }, refreshed: false });

  await handle({ token: 'tok-a', query: { op: 'oauth-disconnect', provider: 'klaviyo' }, method: 'GET' });
  connect(db, 'klaviyo', { access_token: 'kl-at-1', refresh_token: 'kl-rt-1' }, { token_expires_at: new Date(Date.now() + 3600_000).toISOString() });
  expect(await oauth.ensureFreshToken('ws-a', 'klaviyo')).toMatchObject({ ok: true, refreshed: false, credentials: { access_token: 'kl-at-1' } });
  expect(db.external(), 'a token with an hour to go is not refreshed').toHaveLength(0);

  // A caller that already holds the connection and credentials is not made to re-read them.
  db.clearCalls();
  const held = { credentials: { access_token: 'held', api_key: '' }, connection: { token_expires_at: null } };
  expect(await oauth.ensureFreshToken('ws-a', 'klaviyo', held)).toMatchObject({ ok: true, refreshed: false });
  expect(db.calls).toHaveLength(0);
});

test('the callback URL is built from this deployment\'s own origin, and the client id comes only from the environment', () => {
  delete process.env.PUBLIC_BASE_URL;
  expect(oauth.callbackUrl({ headers: { 'x-forwarded-host': 'lifecycle.example.test' } }, 'meta')).toBe('https://lifecycle.example.test/api/public-config?action=connections&op=oauth-callback&provider=meta');
  expect(oauth.callbackUrl({ headers: { host: 'localhost:3000' } }, 'klaviyo')).toBe('http://localhost:3000/api/public-config?action=connections&op=oauth-callback&provider=klaviyo');
  expect(oauth.callbackUrl({ headers: {} }, 'klaviyo')).toBe('/api/public-config?action=connections&op=oauth-callback&provider=klaviyo');
  process.env.PUBLIC_BASE_URL = 'https://app.example.test///';
  expect(oauth.callbackUrl({ headers: { host: 'ignored.example' } }, 'klaviyo')).toBe(CALLBACK + 'klaviyo');
  expect(oauth.clientIdFor('klaviyo')).toBe('kl-client');
  expect(oauth.clientIdFor('meta')).toBe('');
  expect(oauth.clientIdFor('braze')).toBe('');
});

/* ═══ found by running it ═════════════════════════════════════════════════ */

// safeReturnTo() keeps a query string on purpose - `/publishing?tab=hub` is a
// real destination, and the existing spec asserts it survives. The callback
// then appended its outcome with a second `?`, so the page received
// `tab=hub?oauth=connected` and no `oauth` parameter: the connection had
// succeeded and the page could not say so.
test('a return_to that already carries a query string still receives the oauth status', async () => {
  const db = world();
  klaviyoAnswers(db);
  const s = await start('tok-a', { provider: 'klaviyo', return_to: '/publishing?tab=hub' });
  const cb = await callback({ provider: 'klaviyo', state: s.payload.state, code: 'c' });
  const landed = new URL(cb.head.Location, 'https://app.example.test');
  expect(landed.pathname).toBe('/publishing');
  expect(landed.searchParams.get('tab')).toBe('hub');
  expect(landed.searchParams.get('oauth')).toBe('connected');
  expect(landed.searchParams.get('provider')).toBe('klaviyo');

  const s2 = await start('tok-a', { provider: 'klaviyo', return_to: '/publishing?tab=hub' });
  const denied = await callback({ provider: 'klaviyo', state: s2.payload.state, error: 'access_denied' });
  const back = new URL(denied.head.Location, 'https://app.example.test');
  expect(back.searchParams.get('tab')).toBe('hub');
  expect(back.searchParams.get('oauth')).toBe('denied');
  expect(oauth.landing('/connections', { oauth: 'error', reason: 'x' })).toBe('/connections?oauth=error&reason=x');
});

// With no CONNECTION_SECRET_KEY the sign-in could be STARTED, the operator
// consented at the platform, the code was exchanged, and persistGrant then
// threw 503 out of the callback - which sits outside the router's try/catch,
// so the browser navigation ended on a JSON 500, with the code spent and the
// state consumed. The vault is now checked before the operator is sent
// anywhere, and again before the code is exchanged.
test('a deployment that cannot store a secret refuses to start a sign-in, and a callback that finds the vault gone refuses before burning the code', async () => {
  const db = world();
  const seen = klaviyoAnswers(db);

  // No vault: the sign-in is refused up front, with the cause, and nothing is written.
  delete process.env.CONNECTION_SECRET_KEY;
  let r = await start('tok-a', { provider: 'klaviyo' });
  expect(r.code).toBe(503);
  expect(r.payload.error).toBe('connection_secrets_unavailable');
  expect(r.payload.message).toMatch(/CONNECTION_SECRET_KEY/);
  expect(states(db)).toHaveLength(0);
  process.env.CONNECTION_SECRET_KEY = 'too-short';
  r = await start('tok-a', { provider: 'klaviyo' });
  expect(r.code).toBe(503);
  expect(r.payload.message).toMatch(/too short/);
  expect(states(db)).toHaveLength(0);

  // The key was present at start and rotated away before the callback (a
  // deploy in between). The one-time code is NOT exchanged for a token this
  // deployment would then have to drop: the callback refuses with a reason.
  process.env.CONNECTION_SECRET_KEY = 'd'.repeat(64);
  const s = await start('tok-a', { provider: 'klaviyo' });
  delete process.env.CONNECTION_SECRET_KEY;
  const cb = await callback({ provider: 'klaviyo', state: s.payload.state, code: 'code-that-must-not-be-burned' });
  expect(cb.code).toBe(302);
  expect(cb.head.Location).toBe('/connections?oauth=error&reason=vault_unavailable');
  expect(seen.exchanges).toHaveLength(0);
  expect(conns(db)).toHaveLength(0);
  expect(secrets(db)).toHaveLength(0);
  expect(JSON.stringify(db.tables)).not.toContain('code-that-must-not-be-burned');

  // The state store itself failing during a callback is a redirect with a
  // reason, never a JSON body on a browser navigation, and never the row.
  process.env.CONNECTION_SECRET_KEY = 'd'.repeat(64);
  const s3 = await start('tok-a', { provider: 'klaviyo' });
  db.failures.oauth_authorization_states = 500;
  const down = await callback({ provider: 'klaviyo', state: s3.payload.state, code: 'c3' });
  expect(down.code).toBe(302);
  expect(down.head.Location).toBe('/connections?oauth=error&reason=callback_failed');
  expect(down.payload).toBeNull();
  expect(seen.exchanges).toHaveLength(0);
});
