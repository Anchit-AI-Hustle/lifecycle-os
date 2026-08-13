// Bring your own integrations and your own AI keys, per brand workspace.
//
// Four things have to hold, and all four are about behaviour rather than shape:
//
//   1. a workspace's own model priority beats the platform's default order
//   2. a workspace's own key REPLACES the platform key for that provider, so a
//      brand that pays for its own account never quietly spends ours
//   3. a stored key is never handed back to the browser, in any response
//   4. one workspace can never read or spend another workspace's connection
//
// Nothing here talks to a real provider or a real database. global.fetch is
// replaced with a fixture that plays both Supabase (including the RLS decision,
// because that is the thing under test) and the model providers, and records
// every request so the assertions can be about what actually went out.
//
// Run: npx playwright test tests/workspace-connections.spec.js
const { test, expect } = require('@playwright/test');

const core = require('../api/_shared/workspace-connections-core.js');
const scopeMod = require('../api/_shared/request-scope.js');
const callLLM = require('../api/_shared/llm.js');

const SERVICE_KEY = 'service-role-key-for-tests';
const ENV_KEYS = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CONNECTION_SECRET_KEY',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3',
  'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY',
  'OPENROUTER_API_KEY', 'OpenRouter_API_KEY', 'GITHUB_MODELS_TOKEN', 'GITHUB_TOKEN',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL', 'SAKANA_BASE_URL',
  'APP_AI_PROVIDER', 'APP_AI_TIER',
];

const savedEnv = {};
let realFetch;

test.beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  realFetch = global.fetch;

  process.env.SUPABASE_URL = 'https://fixture.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key-for-tests';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  // 32 bytes of hex, the shape the module documents.
  process.env.CONNECTION_SECRET_KEY = 'a'.repeat(64);

  // Two platform keys, so "the workspace key replaced the platform key" is a
  // real substitution rather than the only key there was.
  process.env.ANTHROPIC_API_KEY = 'platform-anthropic-key';
  process.env.OPENAI_API_KEY = 'platform-openai-key';
  for (const k of ['OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'GEMINI_API_KEY', 'XAI_API_KEY',
    'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'OpenRouter_API_KEY',
    'GITHUB_MODELS_TOKEN', 'GITHUB_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
    'OLLAMA_BASE_URL', 'SAKANA_BASE_URL', 'APP_AI_PROVIDER', 'APP_AI_TIER']) delete process.env[k];
});

test.afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  global.fetch = realFetch;
});

/* ── the fixture world ────────────────────────────────────────────────────── */

/** Two brands owned by two different people, on one deployment. */
function world() {
  return {
    calls: [],
    users: { 'tok-a': { id: 'user-a', email: 'a@example.test' }, 'tok-b': { id: 'user-b', email: 'b@example.test' } },
    active: { 'user-a': 'ws-a', 'user-b': 'ws-b' },
    workspaces: {
      'ws-a': { id: 'ws-a', slug: 'alpha', name: 'Alpha', owner_id: 'user-a' },
      'ws-b': { id: 'ws-b', slug: 'beta', name: 'Beta', owner_id: 'user-b' },
    },
    connections: { 'ws-a': [], 'ws-b': [] },
    routing: {},
    secrets: {},                    // connection_id -> encrypted row
    providerReply: 'ok',
    providerStatus: {},             // host -> status to answer with
  };
}

function addConnection(w, wsId, { provider, category, config, secrets, id }) {
  const connId = id || `conn-${wsId}-${provider}`;
  const enc = secrets ? core.encryptSecrets(secrets) : null;
  w.connections[wsId].push({
    id: connId, workspace_id: wsId, provider,
    category: category || 'ai', auth_kind: 'api_key', label: provider,
    config: config || {}, secret_fields: secrets ? Object.keys(secrets) : [],
    secret_hint: secrets && secrets.api_key ? String(secrets.api_key).slice(-4) : '',
    status: 'active', updated_at: '2026-08-13T00:00:00Z',
  });
  if (enc) w.secrets[connId] = Object.assign({ connection_id: connId, workspace_id: wsId }, enc);
  return connId;
}

/** The RLS decision, stated once: you see a workspace only if you own it. */
function mayRead(w, token, wsId) {
  const user = w.users[token];
  const ws = w.workspaces[wsId];
  return !!(user && ws && ws.owner_id === user.id);
}

function json(body, status = 200) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

function paramOf(url, key) {
  const m = new RegExp(`[?&]${key}=eq\\.([^&]+)`).exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

function installFetch(w) {
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const headers = (opts && opts.headers) || {};
    const auth = String(headers.authorization || headers.Authorization || '');
    const token = auth.replace(/^Bearer\s+/i, '');
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    w.calls.push({ url: u, method, token, headers, body });

    /* ── Supabase ───────────────────────────────────────────────────────── */
    if (u.includes('/auth/v1/user')) {
      const user = w.users[token];
      return user ? json(user) : json({ message: 'invalid' }, 401);
    }
    if (u.includes('/rest/v1/brand_user_prefs')) {
      const user = w.users[token];
      return json(user && w.active[user.id] ? [{ active_workspace_id: w.active[user.id] }] : []);
    }
    if (u.includes('/rest/v1/brand_workspaces')) {
      const wsId = paramOf(u, 'id');
      return json(mayRead(w, token, wsId) ? [w.workspaces[wsId]] : []);
    }
    if (u.includes('/rest/v1/brand_workspace_members')) return json([]);

    if (u.includes('/rest/v1/workspace_connection_secrets')) {
      // Only the service role ever reaches this table, which is the whole point
      // of it being a separate table with no policy.
      if (token !== SERVICE_KEY) return json({ message: 'permission denied' }, 401);
      if (method === 'POST') {
        for (const row of body) w.secrets[row.connection_id] = row;
        return json(null, 201);
      }
      const ids = (/connection_id=in\.\(([^)]*)\)/.exec(u) || [])[1] || '';
      const wanted = decodeURIComponent(ids).split(',').map((s) => s.replace(/^"|"$/g, '')).filter(Boolean);
      return json(wanted.map((id) => w.secrets[id]).filter(Boolean));
    }

    if (u.includes('/rest/v1/workspace_connections')) {
      const wsId = paramOf(u, 'workspace_id') || (body && body[0] && body[0].workspace_id);
      if (!mayRead(w, token, wsId)) return json([]);
      if (method === 'POST') {
        const row = body[0];
        const list = w.connections[wsId];
        const at = list.findIndex((r) => r.provider === row.provider);
        const merged = Object.assign({ id: `conn-${wsId}-${row.provider}` }, at >= 0 ? list[at] : {}, row);
        if (at >= 0) list[at] = merged; else list.push(merged);
        return json([merged]);
      }
      if (method === 'PATCH') return json(null, 204);
      if (method === 'DELETE') {
        const provider = paramOf(u, 'provider');
        w.connections[wsId] = w.connections[wsId].filter((r) => r.provider !== provider);
        return json(null, 204);
      }
      const provider = paramOf(u, 'provider');
      const rows = w.connections[wsId].filter((r) => !provider || r.provider === provider);
      return json(rows);
    }

    if (u.includes('/rest/v1/workspace_ai_routing')) {
      const wsId = paramOf(u, 'workspace_id') || (body && body[0] && body[0].workspace_id);
      if (!mayRead(w, token, wsId)) return json([]);
      if (method === 'POST') { w.routing[wsId] = body[0]; return json(null, 201); }
      return json(w.routing[wsId] ? [w.routing[wsId]] : []);
    }

    /* ── model providers ────────────────────────────────────────────────── */
    const host = new URL(u).host;
    const status = w.providerStatus[host];
    if (status) return json({ error: { message: 'fixture failure' } }, status);

    if (host === 'api.anthropic.com') return json({ content: [{ text: w.providerReply }] });
    if (host === 'generativelanguage.googleapis.com') return json({ candidates: [{ content: { parts: [{ text: w.providerReply }] } }] });
    return json({ choices: [{ message: { content: w.providerReply } }] });   // every OpenAI-compatible host
  };
}

/** A request as a Vercel handler receives it. */
function req(token, query) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {}, query: query || {}, body: {}, method: 'GET' };
}

/** A response object that records instead of writing. */
function res() {
  const out = { code: 200, payload: null };
  out.status = (c) => { out.code = c; return out; };
  out.json = (p) => { out.payload = p; return out; };
  out.setHeader = () => {};
  return out;
}

function fresh() {
  const w = world();
  installFetch(w);
  core._resolvedCache.clear();
  return w;
}

/** Which provider hosts were called, in the order they were called. */
function providerHosts(w) {
  return w.calls
    .map((c) => new URL(c.url).host)
    .filter((h) => !h.includes('supabase'));
}

/* ── 1. the workspace's order beats the default ───────────────────────────── */

test('with no workspace routing the default cascade is unchanged', async () => {
  const w = fresh();
  const r = await callLLM({ userMessage: 'hi', overrides: null, stage: 'test' });
  expect(r.routing).toBe('platform');
  // The shipped order puts Anthropic first, and nothing here changed that.
  expect(providerHosts(w)[0]).toBe('api.anthropic.com');
});

test('a workspace order is followed instead of the platform order', async () => {
  const w = fresh();
  const r = await callLLM({
    userMessage: 'hi', stage: 'test',
    overrides: { order: ['openai', 'anthropic'], models: {}, keys: {}, bases: {}, fallback: true },
  });
  expect(providerHosts(w)[0]).toBe('api.openai.com');
  expect(r.provider).toBe('openai');
  expect(r.routing).toBe('workspace');
});

test('a workspace model list is used instead of the tier chain', async () => {
  const w = fresh();
  await callLLM({
    userMessage: 'hi', stage: 'test', tier: 'premium',
    overrides: { order: ['openai'], models: { openai: ['a-model-this-account-has'] }, keys: {}, bases: {}, fallback: false },
  });
  const call = w.calls.find((c) => c.url.includes('api.openai.com'));
  expect(call.body.model).toBe('a-model-this-account-has');
});

test('turning fallback off stops the cascade at the workspace providers', async () => {
  const w = fresh();
  w.providerStatus['api.openai.com'] = 500;
  await expect(callLLM({
    userMessage: 'hi', stage: 'test',
    overrides: { order: ['openai'], models: {}, keys: {}, bases: {}, fallback: false },
  })).rejects.toThrow(/All providers failed/);
  // A workspace that said "only these providers" must not have its prompt sent
  // to a provider it left out, even to rescue the run.
  expect(providerHosts(w).every((h) => h === 'api.openai.com')).toBe(true);
});

test('leaving fallback on lets the platform finish the job', async () => {
  const w = fresh();
  w.providerStatus['api.openai.com'] = 500;
  const r = await callLLM({
    userMessage: 'hi', stage: 'test',
    overrides: { order: ['openai'], models: {}, keys: {}, bases: {}, fallback: true },
  });
  expect(providerHosts(w)[0]).toBe('api.openai.com');
  expect(r.provider).toBe('anthropic');
});

/* ── 2. the workspace's key replaces the platform's ───────────────────────── */

test('a workspace key replaces the platform key for that provider', async () => {
  const w = fresh();
  await callLLM({
    userMessage: 'hi', stage: 'test',
    overrides: { order: ['openai'], models: {}, keys: { openai: 'workspace-openai-key' }, bases: {}, fallback: false },
  });
  const call = w.calls.find((c) => c.url.includes('api.openai.com'));
  expect(call.headers.Authorization).toBe('Bearer workspace-openai-key');
  // Replaced, not appended: the platform key must not be tried at all, or the
  // workspace is silently spending quota it did not pay for.
  const everySent = w.calls.map((c) => JSON.stringify(c.headers)).join(' ');
  expect(everySent).not.toContain('platform-openai-key');
});

test('a provider the workspace did not bring a key for still uses the platform key', async () => {
  const w = fresh();
  await callLLM({
    userMessage: 'hi', stage: 'test',
    overrides: { order: ['anthropic'], models: {}, keys: { openai: 'workspace-openai-key' }, bases: {}, fallback: false },
  });
  const call = w.calls.find((c) => c.url.includes('api.anthropic.com'));
  expect(call.headers['x-api-key']).toBe('platform-anthropic-key');
});

test('a stored key reaches the provider through the request scope alone', async () => {
  // This is the end to end shape: a browser request arrives, nothing passes a
  // key down the call stack, and the generation still runs on the workspace's
  // own account.
  const w = fresh();
  addConnection(w, 'ws-a', { provider: 'openai', secrets: { api_key: 'sk-alpha-owns-this' } });
  w.routing['ws-a'] = { workspace_id: 'ws-a', entries: [{ provider: 'openai', models: [], enabled: true }], use_platform_fallback: false };

  const r = await scopeMod.run(req('tok-a'), () => callLLM({ userMessage: 'hi', stage: 'test' }));

  expect(r.routing).toBe('workspace');
  expect(r.workspace_key).toBe(true);
  const call = w.calls.find((c) => c.url.includes('api.openai.com'));
  expect(call.headers.Authorization).toBe('Bearer sk-alpha-owns-this');
});

/* ── 3. a key is never handed back ────────────────────────────────────────── */

test('saving a key answers with a hint and never the key', async () => {
  const w = fresh();
  const request = req('tok-a');
  request.method = 'POST';
  request.query = { op: 'save' };
  request.body = { op: 'save', provider: 'openai', fields: { api_key: 'sk-secret-value-1234' } };

  const r = res();
  await core.handle(request, r);

  expect(r.code).toBe(200);
  expect(JSON.stringify(r.payload)).not.toContain('sk-secret-value-1234');
  expect(r.payload.connection.configured).toBe(true);
  expect(r.payload.connection.secret_hint).toBe('1234');
});

test('listing connections never carries a key, only that there is one', async () => {
  const w = fresh();
  addConnection(w, 'ws-a', { provider: 'anthropic', secrets: { api_key: 'sk-never-echo-me-9876' } });

  const r = res();
  await core.handle(req('tok-a', { op: 'list' }), r);

  const body = JSON.stringify(r.payload);
  expect(body).not.toContain('sk-never-echo-me-9876');
  expect(body).not.toContain('ciphertext');
  const conn = r.payload.connections.find((c) => c.provider === 'anthropic');
  expect(conn.configured).toBe(true);
  expect(conn.secret_hint).toBe('9876');
});

test('the sanitised view drops a secret even when the row carries one', () => {
  // Defence in depth against the next column somebody adds: the public view is
  // built field by field rather than by deleting known-bad keys.
  const view = core.sanitize({
    provider: 'openai', category: 'ai', config: { account_id: '123' },
    secret_fields: ['api_key'], secret_hint: '4321',
    api_key: 'sk-should-never-survive', ciphertext: 'AAAA', iv: 'BBBB',
  });
  expect(JSON.stringify(view)).not.toContain('sk-should-never-survive');
  expect(JSON.stringify(view)).not.toContain('AAAA');
  expect(view.secret_hint).toBe('4321');
});

test('the public registry exposes no key material and no invented sign-in flow', async () => {
  fresh();
  const r = res();
  await core.handle(req(null, { op: 'registry' }), r);

  expect(r.code).toBe(200);
  const body = JSON.stringify(r.payload);
  expect(body).not.toContain('platform-openai-key');
  expect(body).not.toContain('platform-anthropic-key');

  // Where a sign-in flow was not established it is reported as missing data,
  // not drawn as a button that goes nowhere.
  for (const id of ['meta_ads', 'google_ads', 'tiktok_ads', 'shopify']) {
    const p = r.payload.providers.find((x) => x.id === id);
    expect(p.oauth_note, `${id} must not silently claim an OAuth flow`).toMatch(/^\[DATA REQUIRED BEFORE LAUNCH:/);
  }
  // Every AI provider offers only model ids this platform already calls.
  const openai = r.payload.providers.find((x) => x.id === 'openai');
  expect(openai.known_models.length).toBeGreaterThan(0);

  // Which providers the PLATFORM has keys for is withheld from an anonymous
  // caller, the same line public-config draws around its pipeline payload.
  expect(openai.platform_default).toBeNull();
});

test('a signed-in member is told whether a platform key already covers them', async () => {
  fresh();
  const r = res();
  await core.handle(req('tok-a', { op: 'list' }), r);
  const openai = r.payload.providers.find((x) => x.id === 'openai');
  expect(openai.platform_default).toBe(true);
  const grok = r.payload.providers.find((x) => x.id === 'grok');
  expect(grok.platform_default).toBe(false);
});

test('an unauthenticated caller is refused, not served a workspace', async () => {
  fresh();
  const r = res();
  await core.handle(req(null, { op: 'list' }), r);
  expect(r.code).toBe(401);
  expect(r.payload.ok).toBe(false);
});

test('no key is stored unencrypted when there is nowhere to encrypt it', async () => {
  const w = fresh();
  const previous = process.env.CONNECTION_SECRET_KEY;
  delete process.env.CONNECTION_SECRET_KEY;
  try {
    const request = req('tok-a');
    request.method = 'POST';
    request.query = { op: 'save' };
    request.body = { op: 'save', provider: 'openai', fields: { api_key: 'sk-must-not-be-stored' } };
    const r = res();
    await core.handle(request, r);

    expect(r.code).toBe(503);
    expect(r.payload.error).toBe('connection_secrets_unavailable');
    // Refused means refused: nothing reached either table.
    expect(JSON.stringify(w.calls)).not.toContain('sk-must-not-be-stored');
    expect(Object.keys(w.secrets)).toHaveLength(0);
  } finally {
    process.env.CONNECTION_SECRET_KEY = previous;
  }
});

test('a base URL the server will call cannot be pointed at an internal address', async () => {
  const w = fresh();
  const request = req('tok-a');
  request.method = 'POST';
  request.query = { op: 'save' };
  request.body = { op: 'save', provider: 'ollama', fields: { base_url: 'http://169.254.169.254' } };

  const r = res();
  await core.handle(request, r);

  // The runtime POSTs prompts to this address, so an unguarded field would let
  // any workspace editor read a cloud metadata endpoint through a model answer.
  expect(r.code).toBe(400);
  expect(r.payload.message).toMatch(/private or internal network/i);
  expect(w.connections['ws-a']).toEqual([]);
});

test('a short passphrase is refused rather than stretched into a key', () => {
  const previous = process.env.CONNECTION_SECRET_KEY;
  process.env.CONNECTION_SECRET_KEY = 'too-short';
  try {
    expect(core.cryptoConfigured()).toBe(false);
    expect(() => core.encryptSecrets({ api_key: 'x' })).toThrow(/too short/i);
  } finally {
    process.env.CONNECTION_SECRET_KEY = previous;
  }
});

test('a key encrypted under a different master key is reported, not silently used', () => {
  const previous = process.env.CONNECTION_SECRET_KEY;
  const row = core.encryptSecrets({ api_key: 'sk-from-the-old-key' });
  process.env.CONNECTION_SECRET_KEY = 'b'.repeat(64);
  try {
    expect(core.decryptSecrets(row)).toBeNull();
  } finally {
    process.env.CONNECTION_SECRET_KEY = previous;
  }
});

/* ── 4. one workspace cannot reach another's ──────────────────────────────── */

test('another workspace\'s connections are invisible even when its id is named', async () => {
  const w = fresh();
  addConnection(w, 'ws-a', { provider: 'openai', secrets: { api_key: 'sk-alpha-private' } });

  const r = res();
  await core.handle(req('tok-b', { op: 'list', workspace_id: 'ws-a' }), r);

  expect(r.payload.connections).toEqual([]);
  expect(JSON.stringify(r.payload)).not.toContain('sk-alpha-private');
});

test('another workspace\'s key is never resolved into a generation', async () => {
  const w = fresh();
  addConnection(w, 'ws-a', { provider: 'openai', secrets: { api_key: 'sk-alpha-private' } });
  w.routing['ws-a'] = { workspace_id: 'ws-a', entries: [{ provider: 'openai', models: [], enabled: true }], use_platform_fallback: false };

  // Beta signs in and points the request at Alpha's workspace.
  const overrides = await core.llmOverridesFor(req('tok-b', { workspace_id: 'ws-a' }));
  expect(overrides).toBeNull();

  // And the generation that follows runs on the platform key, not Alpha's.
  const r = await scopeMod.run(req('tok-b', { workspace_id: 'ws-a' }), () => callLLM({ userMessage: 'hi', stage: 'test' }));
  expect(r.routing).toBe('platform');
  expect(JSON.stringify(w.calls)).not.toContain('sk-alpha-private');
});

test('the secret store is only ever asked for ids the caller could already see', async () => {
  const w = fresh();
  addConnection(w, 'ws-a', { provider: 'openai', secrets: { api_key: 'sk-alpha-private' } });
  addConnection(w, 'ws-b', { provider: 'openai', secrets: { api_key: 'sk-beta-private' } });

  await core.llmOverridesFor(req('tok-b'));

  // The service role bypasses RLS, so the protection is that it is never handed
  // an id the caller's own RLS-checked read did not return. An enumerating read
  // here would be the leak.
  const secretCalls = w.calls.filter((c) => c.url.includes('workspace_connection_secrets'));
  for (const c of secretCalls) {
    expect(c.url).toContain('conn-ws-b-openai');
    expect(c.url).not.toContain('conn-ws-a-openai');
  }
});

test('an editor check, not membership, guards a write', async () => {
  const w = fresh();
  // Beta is a member of nothing on Alpha, so the workspace read returns nothing
  // and the write is refused with a message rather than a silent no-op.
  const request = req('tok-b');
  request.method = 'POST';
  request.query = { op: 'save' };
  request.body = { op: 'save', workspace_id: 'ws-a', provider: 'openai', fields: { api_key: 'sk-beta-tried-it' } };

  const r = res();
  await core.handle(request, r);

  expect(r.code).toBe(404);
  expect(Object.keys(w.secrets)).toHaveLength(0);
});

/* ── the routing record itself ────────────────────────────────────────────── */

test('routing normalisation drops what it cannot verify instead of guessing', () => {
  const clean = core.normalizeRouting({
    entries: [
      { provider: 'openai', models: ['gpt-5-mini', 'gpt-5-mini'] },
      { provider: 'not-a-provider', models: ['x'] },
      { provider: 'openai', models: ['duplicate provider'] },
      { provider: 'anthropic', models: [], enabled: false },
    ],
    use_platform_fallback: false,
  });
  expect(clean.entries.map((e) => e.provider)).toEqual(['openai', 'anthropic']);
  expect(clean.entries[0].models).toEqual(['gpt-5-mini']);
  expect(clean.entries[1].enabled).toBe(false);
  expect(clean.use_platform_fallback).toBe(false);
});

test('a disabled step is skipped and a workspace with nothing set changes nothing', () => {
  const none = core.buildOverrides({ entries: [], use_platform_fallback: true }, [], new Map());
  expect(none).toBeNull();

  const some = core.buildOverrides(
    { entries: [{ provider: 'openai', models: ['m1'], enabled: true }, { provider: 'gemini', models: [], enabled: false }], use_platform_fallback: true },
    [], new Map(),
  );
  expect(some.order).toEqual(['openai']);
  expect(some.models.openai).toEqual(['m1']);
});

test('an account-specific provider carries its base URL as part of the credential', () => {
  const rows = [
    { id: 'c1', provider: 'cloudflare', status: 'active', config: { account_id: 'acct-123' }, secret_fields: ['api_key'] },
    { id: 'c2', provider: 'ollama', status: 'active', config: { base_url: 'https://ollama.example/' }, secret_fields: [] },
  ];
  const secrets = new Map([['c1', { api_key: 'cf-token' }]]);
  const out = core.buildOverrides({ entries: [], use_platform_fallback: true }, rows, secrets);
  expect(out.bases.cloudflare).toBe('https://api.cloudflare.com/client/v4/accounts/acct-123/ai/v1');
  expect(out.bases.ollama).toBe('https://ollama.example/v1');
  expect(out.keys.cloudflare).toBe('cf-token');
});
