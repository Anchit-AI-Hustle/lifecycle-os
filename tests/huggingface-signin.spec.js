// Hugging Face as the person's own model (2026-11-01).
//
// A person can paste a Hugging Face access token, or press "Sign in with
// Hugging Face", and every text generator can then use Hugging Face Inference
// Providers in the person's ranked order, counted as their own key. Only what
// Hugging Face documents (read 2026-11-01):
//   https://huggingface.co/docs/hub/oauth                     (OAuth app, scopes incl. inference-api)
//   https://huggingface.co/.well-known/openid-configuration   (/oauth/authorize, /oauth/token, S256, refresh_token)
//   https://huggingface.co/docs/inference-providers/index      (router.huggingface.co/v1/chat/completions, Bearer)
//   https://huggingface.co/docs/inference-providers/tasks/chat-completion (usage.prompt_tokens / completion_tokens)
//
// Executed: the shipped connections router (workspace-connections-core.handle)
// over the fake project, with a fake Hugging Face that answers ONLY those
// documented URLs and throws on anything else; the shipped llm.js; the page in
// Chromium for the redirect and the return.
//
// Run: npx playwright test tests/huggingface-signin.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { FakeSupabase, makeReq, makeRes, envScope, response, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const signin = require(path.join(ROOT, 'api', '_shared', 'ai-account-signin.js'));
const llm = require(path.join(ROOT, 'api', '_shared', 'llm.js'));
const scope = require(path.join(ROOT, 'api', '_shared', 'request-scope.js'));

const HF_TOKEN_URL = 'https://huggingface.co/oauth/token';
const HF_ROUTER = 'https://router.huggingface.co/v1/chat/completions';
const VERIFIER = 'v'.repeat(43) + 'erifier-0123456789';
const CLIENT_ID = 'hf-client-0000-test';
const CLIENT_SECRET = 'hf-client-secret-XYZ';

const ENV = envScope(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY',
  'CONNECTION_SECRET_KEY', 'HF_OAUTH_CLIENT_ID', 'HF_OAUTH_CLIENT_SECRET', 'HF_TOKEN', 'HF_API_TOKEN', 'HUGGINGFACE_API_KEY', 'FREE_GENERATION',
  'OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY',
  'OPENROUTER_API_KEY', 'OpenRouter_API_KEY', 'DEEPSEEK_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'BEDROCK_API_KEY',
  'AWS_BEDROCK_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL', 'SAKANA_BASE_URL', 'SAKANA_API_KEY']);
let REAL_FETCH;
test.beforeAll(() => {
  ENV.save(); REAL_FETCH = global.fetch;
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'HF_OAUTH_CLIENT_ID', 'HF_OAUTH_CLIENT_SECRET',
    'OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY',
    'OPENROUTER_API_KEY', 'OpenRouter_API_KEY', 'DEEPSEEK_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'BEDROCK_API_KEY',
    'AWS_BEDROCK_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL', 'SAKANA_BASE_URL', 'SAKANA_API_KEY', 'HF_TOKEN', 'HF_API_TOKEN', 'HUGGINGFACE_API_KEY']) delete process.env[k];
  process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY; process.env.CONNECTION_SECRET_KEY = 'e'.repeat(64);
  process.env.FREE_GENERATION = 'off';
});
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; });
test.beforeEach(() => { llm.resetProviderCooldowns(); signin._hfCache.clear(); });

function withClient(mode) {
  if (mode === 'secret') { process.env.HF_OAUTH_CLIENT_ID = CLIENT_ID; process.env.HF_OAUTH_CLIENT_SECRET = CLIENT_SECRET; }
  else if (mode === 'public') { process.env.HF_OAUTH_CLIENT_ID = CLIENT_ID; delete process.env.HF_OAUTH_CLIENT_SECRET; }
  else { delete process.env.HF_OAUTH_CLIENT_ID; delete process.env.HF_OAUTH_CLIENT_SECRET; }
}

function world() {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addUser('tok-v', 'user-v', 'v@example.test')
    .addWorkspace('ws-a', 'user-a').addMember('ws-a', 'user-v', 'viewer')
    .setActive('user-a', 'ws-a').setActive('user-v', 'ws-a').syncIdentityTables();
  db.install();
  connections._resolvedCache && connections._resolvedCache.clear();
  return db;
}
async function call(token, op, body) {
  const res = makeRes();
  await connections.handle(makeReq({ token, query: { action: 'connections', op }, body, method: body ? 'POST' : 'GET' }), res);
  return res;
}

/**
 * A fake Hugging Face that answers exactly the documented endpoints. Anything
 * else under huggingface.co throws (and so does any other host, via the fake
 * project's own rule).
 */
function fakeHF(db, { token, chat } = {}) {
  const seen = { token: [], chat: [] };
  db.route((u) => /^https:\/\/([a-z0-9-]+\.)?huggingface\.co\//.test(u), (u, init, c) => {
    if (u === HF_TOKEN_URL && c.method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(String(init.body || '')));
      seen.token.push({ form, headers: c.headers });
      return typeof token === 'function' ? token(form, c) : (token || response(400, { error: 'invalid_grant' }));
    }
    if (u === HF_ROUTER && c.method === 'POST') {
      seen.chat.push({ body: c.body, headers: c.headers });
      return typeof chat === 'function' ? chat(c) : (chat || okChat());
    }
    throw new Error('undocumented Hugging Face URL: ' + c.method + ' ' + u);
  });
  return seen;
}
const okChat = (text) => ({ id: 'x', model: 'openai/gpt-oss-120b', choices: [{ index: 0, message: { role: 'assistant', content: text || 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 } });
const secretsOf = (db) => {
  const conn = db.table('workspace_connections').find((x) => x.provider === 'huggingface');
  const sec = conn && db.table('workspace_connection_secrets').find((x) => x.connection_id === conn.id);
  return { conn, sec, plain: sec ? connections.decryptSecrets(sec) : null };
};

/* ── 1. the card ──────────────────────────────────────────────────────────── */

test('the card: paste a token, with Hugging Face\'s own token page; sign-in only once the platform has its OAuth app; never a platform key', () => {
  withClient(null);
  process.env.HF_TOKEN = 'hf_PLATFORMSHOULDNEVERBEUSED';
  try {
    let hf = connections.registryView(true).find((p) => p.id === 'huggingface');
    expect(hf).toMatchObject({ category: 'ai', llm_provider: 'huggingface', platform_default: false });
    expect(hf.fields.map((f) => f.key)).toEqual(['api_key', 'model']);   // the sign-in fields are never drawn
    expect(hf.signin.available).toBe(false);
    expect(hf.signin.provider_signin.url).toBe('https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained');
    expect(hf.signin.note).toMatch(/OAuth app is not added/);
    expect(hf.fix_pages).toEqual({ keys: 'https://huggingface.co/settings/tokens', billing: 'https://huggingface.co/settings/billing' });
    withClient('secret');
    hf = connections.registryView(true).find((p) => p.id === 'huggingface');
    expect(hf.signin).toMatchObject({ available: true, kind: 'huggingface', client_id: CLIENT_ID, authorize_url: 'https://huggingface.co/oauth/authorize', scope: 'openid profile inference-api' });
    expect(JSON.stringify(hf)).not.toContain(CLIENT_SECRET);
  } finally { withClient(null); delete process.env.HF_TOKEN; }
});

/* ── 2. a pasted token, and its Test ──────────────────────────────────────── */

test('a pasted token is kept encrypted, never returned, and Test calls the router with it as Bearer', async () => {
  const db = world();
  const seen = fakeHF(db, { chat: okChat('ok') });
  const saved = await call('tok-a', 'save', { provider: 'huggingface', fields: { api_key: 'hf_PASTEDTOKEN1234' } });
  expect(saved.code, JSON.stringify(saved.payload)).toBe(200);
  expect(JSON.stringify(saved.payload)).not.toContain('PASTEDTOKEN');
  const { conn, sec, plain } = secretsOf(db);
  expect(conn.secret_hint).toBe('1234');
  expect(JSON.stringify(sec)).not.toContain('PASTEDTOKEN');
  expect(plain.api_key).toBe('hf_PASTEDTOKEN1234');
  const listed = await call('tok-a', 'list');
  expect(JSON.stringify(listed.payload)).not.toContain('PASTEDTOKEN');

  const t = await call('tok-a', 'check', { provider: 'huggingface' });
  expect(t.code, JSON.stringify(t.payload)).toBe(200);
  expect(t.payload).toMatchObject({ ok: true, connected: true });
  expect(t.payload.note).toMatch(/Hugging Face \(Inference Providers\) answered on openai\/gpt-oss-120b/);
  expect(seen.chat).toHaveLength(1);
  expect(seen.chat[0].headers.authorization).toBe('Bearer hf_PASTEDTOKEN1234');
  expect(seen.chat[0].body.model).toBe('openai/gpt-oss-120b');
  expect(seen.chat[0].body.messages.map((m) => m.role)).toEqual(['system', 'user']);
});

test('a refused token: Test quotes Hugging Face\'s own words (token redacted) and links its tokens page; a Test after a refusal still calls', async () => {
  const db = world();
  let n = 0;
  const seen = fakeHF(db, { chat: () => (++n === 1 ? response(401, { error: 'Invalid credentials in Authorization header hf_PASTEDTOKEN1234' }) : okChat()) });
  await call('tok-a', 'save', { provider: 'huggingface', fields: { api_key: 'hf_PASTEDTOKEN1234' } });
  const t = await call('tok-a', 'check', { provider: 'huggingface' });
  expect(t.payload.ok).toBe(false);
  expect(t.payload.note).toMatch(/refused this key \(the provider said: "Invalid credentials in Authorization header \[key\]"\)/);
  expect(JSON.stringify(t.payload)).not.toContain('PASTEDTOKEN');
  expect(t.payload.fix_url).toBe('https://huggingface.co/settings/tokens');
  // overrides.fresh: the next Test is sent, not skipped as cooling down.
  const t2 = await call('tok-a', 'check', { provider: 'huggingface' });
  expect(t2.payload.ok).toBe(true);
  expect(seen.chat).toHaveLength(2);
});

/* ── 3. Sign in with Hugging Face ─────────────────────────────────────────── */

test('the sign-in code is exchanged on the SERVER (Basic auth, PKCE verifier, exact redirect); the tokens are kept encrypted, never returned, and replace a pasted token', async () => {
  const db = world();
  withClient('secret');
  try {
    const seen = fakeHF(db, { token: { access_token: 'hf_oauth_ACCESSAAAA', refresh_token: 'hf_oauth_REFRESHBBBB', expires_in: 28800, scope: 'openid profile inference-api', token_type: 'bearer' } });
    await call('tok-a', 'save', { provider: 'huggingface', fields: { api_key: 'hf_PASTEDTOKEN1234' } });
    const r = await call('tok-a', 'ai-signin-exchange', { provider: 'huggingface', code: 'hf-code', code_verifier: VERIFIER, redirect_uri: 'https://app.example.test/ai-models' });
    expect(r.code, JSON.stringify(r.payload)).toBe(200);
    expect(r.payload).toMatchObject({ ok: true, provider: 'huggingface', signed_in: true });
    expect(JSON.stringify(r.payload)).not.toMatch(/ACCESSAAAA|REFRESHBBBB/);
    expect(seen.token).toHaveLength(1);
    expect(seen.token[0].form).toEqual({ grant_type: 'authorization_code', code: 'hf-code', redirect_uri: 'https://app.example.test/ai-models', code_verifier: VERIFIER });
    expect(seen.token[0].headers.authorization).toBe('Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'));
    const { conn, sec, plain } = secretsOf(db);
    expect(conn.label).toBe('Hugging Face (signed in)');
    expect(JSON.stringify(sec)).not.toMatch(/ACCESSAAAA|REFRESHBBBB/);
    expect(plain.hf_oauth_access).toBe('hf_oauth_ACCESSAAAA');
    expect(plain.hf_oauth_refresh).toBe('hf_oauth_REFRESHBBBB');
    expect(Number(plain.hf_oauth_expires_at)).toBeGreaterThan(Date.now() + 28000 * 1000);
    expect(plain.api_key, 'the older pasted token would outrank the sign-in').toBeUndefined();
    // And the other way: a token pasted after signing in replaces the sign-in.
    await call('tok-a', 'save', { provider: 'huggingface', fields: { api_key: 'hf_NEWPASTE5678' } });
    expect(Object.keys(secretsOf(db).plain).sort()).toEqual(['api_key']);
  } finally { withClient(null); }
});

test('a public OAuth app sends its client id in the body and no Authorization; a refused code, a viewer, no app and a bad redirect are each refused', async () => {
  let db = world();
  withClient('public');
  try {
    let seen = fakeHF(db, { token: { access_token: 'hf_oauth_PUBLIC', expires_in: 3600 } });
    const ok = await call('tok-a', 'ai-signin-exchange', { provider: 'huggingface', code: 'c1', code_verifier: VERIFIER, redirect_uri: 'https://app.example.test/connections' });
    expect(ok.code, JSON.stringify(ok.payload)).toBe(200);
    expect(seen.token[0].form.client_id).toBe(CLIENT_ID);
    expect(seen.token[0].headers.authorization).toBeUndefined();
    expect(ok.payload.message).toMatch(/sign in again/);          // no refresh token came back: said

    db = world();
    seen = fakeHF(db, { token: { access_token: 'x' } });
    const viewer = await call('tok-v', 'ai-signin-exchange', { provider: 'huggingface', code: 'c', code_verifier: VERIFIER, redirect_uri: 'https://app.example.test/ai-models' });
    expect(viewer.code).toBeGreaterThanOrEqual(400);
    expect(seen.token, 'the code was spent for a caller who cannot keep the token').toHaveLength(0);

    db = world();
    seen = fakeHF(db, { token: response(400, { error: 'invalid_grant', error_description: 'code expired' }) });
    const refused = await call('tok-a', 'ai-signin-exchange', { provider: 'huggingface', code: 'used', code_verifier: VERIFIER, redirect_uri: 'https://app.example.test/ai-models' });
    expect(refused.code).toBe(400);
    expect(refused.payload.message).toMatch(/refused the sign-in code/);
    expect(db.table('workspace_connections').length).toBe(0);

    db = world();
    fakeHF(db, { token: { access_token: 'hf_oauth_NOSCOPE', scope: 'openid profile' } });
    const noScope = await call('tok-a', 'ai-signin-exchange', { provider: 'huggingface', code: 'c', code_verifier: VERIFIER, redirect_uri: 'https://app.example.test/ai-models' });
    expect(noScope.code).toBe(400);
    expect(noScope.payload.message).toMatch(/Make inference requests/);

    const badRedirect = await call('tok-a', 'ai-signin-exchange', { provider: 'huggingface', code: 'c', code_verifier: VERIFIER, redirect_uri: 'javascript:alert(1)' });
    expect(badRedirect.code).toBe(400);
    withClient(null);
    const noApp = await call('tok-a', 'ai-signin-exchange', { provider: 'huggingface', code: 'c', code_verifier: VERIFIER, redirect_uri: 'https://app.example.test/ai-models' });
    expect(noApp.code).toBe(400);
    expect(noApp.payload.message).toMatch(/fine-grained token/);
  } finally { withClient(null); }
});

/* ── 4. renewal at call time ──────────────────────────────────────────────── */

async function seedSignedIn(db, fields) {
  const save = await connections.saveConnection(await require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js')).requireUser(makeReq({ token: 'tok-a' })),
    { workspace_id: 'ws-a', provider: 'huggingface', label: 'Hugging Face (signed in)', fields });
  return save;
}

test('an ended access token is renewed with the refresh token, used, the renewal kept, and cached to its expiry', async () => {
  const db = world();
  withClient('secret');
  try {
    let n = 0;
    const seen = fakeHF(db, { token: () => ({ access_token: 'hf_oauth_RENEWED' + (++n), refresh_token: 'hf_oauth_ROTATED' + n, expires_in: 3600 }) });
    await seedSignedIn(db, { hf_oauth_access: 'hf_oauth_OLDACCESS', hf_oauth_refresh: 'hf_oauth_REFRESH0', hf_oauth_expires_at: String(Date.now() - 1000) });
    connections._resolvedCache && connections._resolvedCache.clear();
    const ov = await connections.llmOverridesFor(makeReq({ token: 'tok-a', query: {}, body: {} }));
    expect(ov.keys.huggingface).toBe('hf_oauth_RENEWED1');
    expect(ov.configured).toContain('huggingface');
    expect(seen.token).toHaveLength(1);
    expect(seen.token[0].form).toEqual({ grant_type: 'refresh_token', refresh_token: 'hf_oauth_REFRESH0' });
    expect(seen.token[0].headers.authorization).toMatch(/^Basic /);
    // The renewal is written back (Hugging Face may rotate the refresh token).
    const plain = secretsOf(db).plain;
    expect(plain.hf_oauth_access).toBe('hf_oauth_RENEWED1');
    expect(plain.hf_oauth_refresh).toBe('hf_oauth_ROTATED1');
    expect(Object.keys(plain).some((k) => k.indexOf('__') === 0)).toBe(false);
    // The next request starts from the stored, current token: no second renewal.
    connections._resolvedCache && connections._resolvedCache.clear();
    const ov2 = await connections.llmOverridesFor(makeReq({ token: 'tok-a', query: {}, body: {} }));
    expect(ov2.keys.huggingface).toBe('hf_oauth_RENEWED1');
    expect(seen.token).toHaveLength(1);
    // A current access token is used as it is, with no call at all.
    expect(await signin.hfAccessToken({ hf_oauth_access: 'hf_oauth_LIVE', hf_oauth_expires_at: String(Date.now() + 3600e3) })).toBe('hf_oauth_LIVE');
    expect(seen.token).toHaveLength(1);
  } finally { withClient(null); }
});

test('a sign-in that ended and cannot be renewed leaves Hugging Face unconnected for the request, and Test says to sign in again', async () => {
  const db = world();
  withClient('secret');
  try {
    const seen = fakeHF(db, { token: response(400, { error: 'invalid_grant' }) });
    await seedSignedIn(db, { hf_oauth_access: 'hf_oauth_OLDACCESS', hf_oauth_refresh: 'hf_oauth_REVOKED', hf_oauth_expires_at: String(Date.now() - 1000) });
    connections._resolvedCache && connections._resolvedCache.clear();
    const ov = await connections.llmOverridesFor(makeReq({ token: 'tok-a', query: {}, body: {} }));
    expect(ov && ov.keys && ov.keys.huggingface).toBeFalsy();
    const t = await call('tok-a', 'check', { provider: 'huggingface' });
    expect(t.payload).toMatchObject({ ok: false, connected: false });
    expect(t.payload.fix).toMatch(/Sign in with Hugging Face again/);
    expect(seen.chat).toHaveLength(0);
    // An expired token with no refresh token is not sent either.
    expect(await signin.hfAccessToken({ hf_oauth_access: 'hf_oauth_OLD', hf_oauth_expires_at: String(Date.now() - 1) })).toBeNull();
  } finally { withClient(null); }
});

test('a signed-in Test sends the access token, and a refusal of it says to sign in again (not "make a new key")', async () => {
  const db = world();
  withClient('secret');
  try {
    const seen = fakeHF(db, { chat: response(401, { error: 'Unauthorized' }) });
    await seedSignedIn(db, { hf_oauth_access: 'hf_oauth_LIVEACCESS', hf_oauth_expires_at: String(Date.now() + 3600e3) });
    const t = await call('tok-a', 'check', { provider: 'huggingface' });
    expect(seen.chat[0].headers.authorization).toBe('Bearer hf_oauth_LIVEACCESS');
    expect(t.payload.ok).toBe(false);
    expect(t.payload.fix).toBe('Press Sign in with Hugging Face again.');
  } finally { withClient(null); }
});

/* ── 5. llm.js: the person's ranked order, their own key ──────────────────── */

function providerNet(answers) {
  const calls = [];
  const f = async (url, init) => {
    const u = String(url);
    const auth = ((init && init.headers) || {}).Authorization || '';
    let provider = null;
    if (u === HF_ROUTER) provider = 'huggingface';
    else if (u.startsWith('https://api.openai.com/')) provider = 'openai';
    if (!provider) throw new Error('unrouted host in the Hugging Face spec: ' + u);
    calls.push({ provider, url: u, auth, body: JSON.parse(init.body) });
    const a = answers[provider];
    const out = typeof a === 'function' ? a() : a;
    if (out && out.status) return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}

test('Hugging Face runs where the person ranked it, on their own token, its usage recorded as their own', async () => {
  global.fetch = providerNet({ huggingface: okChat('from hf'), openai: { choices: [{ message: { content: 'from openai' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } } });
  try {
    const ov = connections.buildOverrides({ entries: [{ provider: 'huggingface' }, { provider: 'openai' }] },
      [{ id: 'h1', provider: 'huggingface', status: 'active', config: { model: 'Qwen/Qwen2.5-7B-Instruct-1M:together' } }, { id: 'o1', provider: 'openai', status: 'active', config: {} }],
      new Map([['h1', { api_key: 'hf_OWN' }], ['o1', { api_key: 'sk-own' }]]));
    expect(ov.order).toEqual(['huggingface', 'openai']);
    const u = await scope.run({ headers: {} }, async () => {
      const out = await llm({ systemPrompt: 'sys', userMessage: 'hi', overrides: ov, maxTokens: 50 });
      expect(out).toMatchObject({ provider: 'huggingface', model: 'Qwen/Qwen2.5-7B-Instruct-1M:together', workspace_key: true, usage: { input_tokens: 11, output_tokens: 2 } });
      return scope.llmUsage();
    });
    expect(global.fetch.calls.map((c) => c.provider)).toEqual(['huggingface']);
    expect(global.fetch.calls[0].auth).toBe('Bearer hf_OWN');
    expect(u.by_provider).toEqual([expect.objectContaining({ provider: 'huggingface', key: 'own', input_tokens: 11, output_tokens: 2, tokens_reported: true })]);
    expect(u.platform_share).toBe(0);

    // Ranked second: OpenAI first, and only when it is refused does Hugging Face answer.
    global.fetch = providerNet({ openai: { status: 401, body: { error: { message: 'bad key' } } }, huggingface: okChat('hf after openai') });
    const ov2 = connections.buildOverrides({ entries: [{ provider: 'openai' }, { provider: 'huggingface' }] },
      [{ id: 'h1', provider: 'huggingface', status: 'active', config: {} }, { id: 'o1', provider: 'openai', status: 'active', config: {} }],
      new Map([['h1', { api_key: 'hf_OWN' }], ['o1', { api_key: 'sk-own' }]]));
    const out2 = await llm({ systemPrompt: 'sys', userMessage: 'hi', overrides: ov2, maxTokens: 50 });
    expect(global.fetch.calls.map((c) => c.provider)).toEqual(['openai', 'huggingface']);
    expect(out2.provider).toBe('huggingface');
    expect(global.fetch.calls[1].body.model).toBe('openai/gpt-oss-120b');
  } finally { global.fetch = REAL_FETCH; }
});

test('without the workspace\'s own Hugging Face connection, Hugging Face is never called, even with a token in the environment', async () => {
  process.env.HF_TOKEN = 'hf_ENV'; process.env.HF_API_TOKEN = 'hf_ENV2'; process.env.OPENAI_API_KEY = 'sk-platform';
  global.fetch = providerNet({ huggingface: okChat('should not'), openai: { choices: [{ message: { content: 'platform' } }] } });
  try {
    const out = await llm({ systemPrompt: 'sys', userMessage: 'hi', overrides: { order: ['huggingface', 'openai'], keys: {}, models: {}, fallback: true }, maxTokens: 20 });
    expect(out.provider).toBe('openai');
    expect(global.fetch.calls.map((c) => c.provider)).toEqual(['openai']);
    expect(llm.modelsFor('huggingface', 'premium')).toEqual(['openai/gpt-oss-120b']);
  } finally { global.fetch = REAL_FETCH; delete process.env.HF_TOKEN; delete process.env.HF_API_TOKEN; delete process.env.OPENAI_API_KEY; }
});

/* ── 6. the page ──────────────────────────────────────────────────────────── */

test('the page sends the person to Hugging Face with PKCE and finishes on the bare page address; a pasted hf_ token goes to the Hugging Face card', async ({ page }) => {
  test.setTimeout(150000);
  withClient('secret');
  const posts = []; const saves = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const send = (status, type, body) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', Connection: 'close' }); res.end(body); };
    if (u.pathname === '/auth.js') return send(200, 'text/javascript', 'window.LifecycleAuth={session:{access_token:"session-token"}};window.LifecycleStatus={decide:async function(){return null;}};window.LifecycleFailure={sentence:function(e){return e.message;},html:function(e){return e.message;},show:function(){}};');
    if (u.pathname === '/api/public-config' && u.searchParams.get('action') === 'connections') {
      const op = u.searchParams.get('op');
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const b = body ? JSON.parse(body) : {};
        if (op === 'ai-signin-exchange') { posts.push(b); return send(200, 'application/json', JSON.stringify({ ok: true, signed_in: true, message: 'Signed in with Hugging Face. Models on Inference Providers now run as you.' })); }
        if (op === 'save') { saves.push(b); return send(200, 'application/json', JSON.stringify({ ok: true })); }
        if (op === 'check') return send(200, 'application/json', JSON.stringify({ ok: true, note: 'Working.' }));
        const reg = connections.registryView(true).filter((p) => p.category === 'ai');
        return send(200, 'application/json', JSON.stringify({ ok: true, workspace_id: 'ws-a', connections: [], routing: { entries: [], use_platform_fallback: true }, providers: reg, secrets_storage: { encrypted: true, store: true } }));
      });
      return undefined;
    }
    if (u.pathname === '/ai-models') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(ROOT, 'brand-connections.html')));
    const f = path.join(ROOT, u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return send(200, f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', fs.readFileSync(f));
    return send(404, 'text/plain', 'nf');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
      if (route.request().url().startsWith('https://huggingface.co/oauth/authorize')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>hugging face sign-in</p>' });
      return route.abort('failed');
    });
    await page.goto(`${base}/ai-models`);
    const btn = page.locator('.conn[data-provider="huggingface"] [data-act="signin"]');
    await expect(btn).toBeVisible({ timeout: 30000 });
    await expect(btn).toHaveText('Sign in with Hugging Face (Inference Providers)');
    await btn.click();
    await page.waitForURL(/huggingface\.co\/oauth\/authorize/, { timeout: 30000 });
    const auth = new URL(page.url());
    expect(auth.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(auth.searchParams.get('redirect_uri')).toBe(`${base}/ai-models`);
    expect(auth.searchParams.get('response_type')).toBe('code');
    expect(auth.searchParams.get('scope')).toBe('openid profile inference-api');
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.toString()).not.toContain(CLIENT_SECRET);
    const st = auth.searchParams.get('state');
    await page.goto(`${base}/ai-models?code=hf-one-time&state=${encodeURIComponent(st)}`);
    await expect(page.locator('[data-signin-result="ok"]')).toContainText('Signed in with Hugging Face', { timeout: 30000 });
    expect(page.url()).not.toContain('hf-one-time');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ provider: 'huggingface', code: 'hf-one-time', redirect_uri: `${base}/ai-models` });
    expect(require('crypto').createHash('sha256').update(posts[0].code_verifier).digest('base64url')).toBe(auth.searchParams.get('code_challenge'));

    // The one box: an hf_ token is recognised as Hugging Face's.
    await page.fill('#quickKey', 'hf_' + 'a'.repeat(34));
    await page.click('#quickSave');
    await expect(page.locator('#quickNote')).toContainText('is connected and working', { timeout: 30000 });
    expect(saves[saves.length - 1]).toEqual({ provider: 'huggingface', fields: { api_key: 'hf_' + 'a'.repeat(34) } });
  } finally {
    withClient(null);
    await new Promise((r) => server.close(r));
  }
});
